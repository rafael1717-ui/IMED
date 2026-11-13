// Lógica da função "pagamento-clinica" (iMed Pagamentos, P2b; arquitetura do pagamento §6.1 e §7.2).
// Não usa APIs do Deno: recebe o banco (como a pessoa logada), o provedor e o ambiente por parâmetro, então roda (e é
// testada) no Node: lib.test.ts (com tudo simulado) e tests/banco/pagamento-clinica.mjs (banco de verdade + provedor de
// mentira).
//
// Duas ações, as duas para o(a) dono(a) da clínica (financeiro.configurar; quem confere é o BANCO, com a sessão dela):
//   conferir  confere no provedor a carteira que a clínica quer informar. Não grava nada.
//   ligar     confere a carteira e, se passou, grava a carteira e o aceite dos termos (pag_clinic_connect): a conta fica
//             "em conferência". NÃO ativa nada: quem ativa é a equipe do IMED (admin_pag_conta_conferir), depois quem
//             liga o modo on-line da unidade (pag_clinic_pause) e, por último, a chave geral. São 4 travas.
//
// FECHADA POR PADRÃO: sem o provedor configurado, recusa tudo (503) antes de tocar no banco; "ligar" sem a versão dos
// termos da clínica configurada (PAG_TERMOS_CLINICA: só existe depois de o contrato de adesão ser revisado pelo
// advogado) também recusa (503). A função NUNCA usa a chave secreta do projeto: tudo o que ela faz no banco, faz com o
// token de quem chamou; sem sessão, 401. Nunca cria cobrança, nunca move dinheiro, nunca guarda a carteira em registro.
//
// O QUE DEPENDE DO ASAAS DE VERDADE (a conferir no ambiente de testes): o que dá para conferir de uma carteira antes da
// primeira cobrança (pergunta S3). Hoje o adaptador só sabe dizer "é a carteira do próprio IMED" ou "não dá para
// saber"; os resultados "conferida" e "nao_existe" já são tratados aqui para quando o provedor souber responder.
import { ehObjeto, ehUuid, ErroBanco, limitado, resp, type Contagem, type Resposta, type Rpc } from '../_shared/base.ts';
import type { EnvGet } from '../_shared/chaves.ts';
import { ErroProvedor, type Carteira, type Provedor } from '../_shared/provedor.ts';

export interface Deps {
  /** O banco COMO A PESSOA LOGADA (PostgREST com o token dela): as permissões são as dela. */
  rpcComo: (autorizacao: string) => Rpc;
  provedor: Provedor | null;
  env: EnvGet;
  agora: () => number;
  /** A conta de quem está logado (id), a partir do cabeçalho Authorization que veio; null = sem sessão válida. */
  usuario: (autorizacao: string) => Promise<string | null>;
  contagem: Contagem;
}
export interface Quem { ip: string; autorizacao: string }

// Limites por pessoa e por IP em cada instância (a porta de entrada; quem decide de verdade é o banco).
export const LIMITE = { conferir: { max: 12, janelaMs: 10 * 60_000 }, ligar: { max: 6, janelaMs: 10 * 60_000 } } as const;
// As mesmas regras de formato de public.pag_clinic_connect (o banco confere de novo).
export const CARTEIRA_RE = /^[A-Za-z0-9_-]{8,80}$/;
export const TERMOS_RE = /^[a-z0-9][a-z0-9._-]{0,30}$/;

const falha = (http: number, status: string, extra: Record<string, unknown> = {}): Resposta => ({ http, corpo: { ok: false, status, ...extra } });

export interface Pedido { acao: 'conferir' | 'ligar'; clinica: string; carteira: string; termos: string }

// Lê e confere o formato do que veio do navegador. Só passam os campos da lista.
export function lerPedido(b: unknown): Pedido | null {
  if (!ehObjeto(b)) return null;
  const acao = b.action === 'ligar' ? 'ligar' : b.action === 'conferir' ? 'conferir' : null;
  if (!acao || !ehUuid(b.clinic)) return null;
  const carteira = typeof b.wallet === 'string' ? b.wallet.trim() : '';
  if (!CARTEIRA_RE.test(carteira)) return null;
  const termos = typeof b.terms === 'string' ? b.terms.trim() : '';
  if (acao === 'ligar' && !TERMOS_RE.test(termos)) return null;
  return { acao, clinica: b.clinic.toLowerCase(), carteira, termos: acao === 'ligar' ? termos : '' };
}

// A versão dos termos da clínica que vale hoje (não é segredo; fica no ambiente da função para mudar sem publicar
// código). Sem ela, ninguém liga: aceitar "termos" que não existem não é aceite.
export function termosEmVigor(env: EnvGet): string | null {
  const v = (env('PAG_TERMOS_CLINICA') ?? '').trim();
  return TERMOS_RE.test(v) ? v : null;
}
const final4 = (carteira: string): string => carteira.slice(-4);
const sessao = (autorizacao: string): boolean => /^Bearer\s+\S+$/i.test(autorizacao);

// Erro do banco chamado como a pessoa: sessão recusada vira 401; sem permissão de execução, 403; o resto, 503 (tentar
// de novo). Nunca a mensagem do banco.
function doBanco(e: unknown): Resposta {
  if (e instanceof ErroBanco) {
    if (e.status === 401 || e.codigo === 'PGRST301' || e.codigo === 'PGRST302' || e.codigo === 'PGRST303') return falha(401, 'login_required');
    if (e.status === 403 || e.codigo === '42501') return falha(403, 'forbidden');
    if (e.status === 404 || e.codigo === 'PGRST202' || e.codigo === '42883') return falha(503, 'not_available');
  }
  return falha(503, 'unavailable');
}

export async function tratar(corpo: unknown, quem: Quem, d: Deps): Promise<Resposta> {
  const pedido = lerPedido(corpo);
  if (!pedido) return falha(400, 'invalid');
  // fechada por padrão: sem o provedor, nada (nem o banco é consultado)
  if (!d.provedor) return falha(503, 'provider_not_configured');
  const termos = termosEmVigor(d.env);
  if (pedido.acao === 'ligar') {
    if (!termos) return falha(503, 'terms_not_configured');
    // a pessoa aceitou outra versão (a página estava velha): mostra a versão de hoje e pede o aceite de novo
    if (pedido.termos !== termos) return falha(409, 'terms_outdated', { termos });
  }
  // quem chama: precisa de sessão válida (o Auth do projeto confere o token)
  if (!sessao(quem.autorizacao)) return falha(401, 'login_required');
  let uid: string | null = null;
  try { uid = await d.usuario(quem.autorizacao); } catch { return falha(503, 'unavailable'); }
  if (!uid) return falha(401, 'login_required');
  const lim = LIMITE[pedido.acao];
  const agora = d.agora();
  // os dois são contados sempre (um não esconde o outro)
  const porPessoa = limitado(d.contagem, `${pedido.acao}:u:${uid}`, agora, lim.max, lim.janelaMs);
  const porIp = limitado(d.contagem, `${pedido.acao}:ip:${quem.ip}`, agora, lim.max * 3, lim.janelaMs);
  if (porPessoa || porIp) return falha(429, 'too_many', { tentar_em_s: Math.ceil(lim.janelaMs / 1000) });

  // a permissão: o banco diz, com a sessão dela, se ela pode configurar o financeiro DESTA clínica (só o dono). Vem
  // ANTES do provedor: quem não é dono não usa esta função para perguntar nada ao meio de pagamento.
  const rpc = d.rpcComo(quem.autorizacao);
  let st: Record<string, unknown>;
  try { st = resp(await rpc('pag_clinic_status', { p_clinic: pedido.clinica })); } catch (e) { return doBanco(e); }
  if (st.status !== 'ok' || st.pode_configurar !== true) return falha(403, 'forbidden');
  if (st.situacao === 'suspensa') return falha(409, 'suspended');

  // a carteira no provedor (sem mover dinheiro)
  let carteira: Carteira;
  try {
    carteira = await d.provedor.conferirCarteira(pedido.carteira);
  } catch (e) {
    return e instanceof ErroProvedor && e.definitivo ? falha(502, 'provider_error') : falha(503, 'provider_unavailable');
  }
  if (carteira === 'propria') return falha(422, 'own_wallet');
  if (carteira === 'nao_existe') return falha(422, 'wallet_not_found');
  const conferida = carteira === 'conferida' ? 'conferida' : 'a_conferir';
  if (pedido.acao === 'conferir') return { http: 200, corpo: { ok: true, status: 'ok', carteira: conferida, carteira_final: final4(pedido.carteira) } };

  // grava a carteira e o aceite, como a pessoa (o banco confere tudo de novo e registra na trilha do pagamento)
  let r: Record<string, unknown>;
  try {
    r = resp(await rpc('pag_clinic_connect', { p_clinic: pedido.clinica, p_wallet: pedido.carteira, p_termos_versao: pedido.termos }));
  } catch (e) { return doBanco(e); }
  switch (r.status) {
    case 'ok':
      return { http: 200, corpo: { ok: true, status: 'ok', situacao: typeof r.situacao === 'string' ? r.situacao : 'em_conferencia', unchanged: r.unchanged === true,
        carteira: conferida, carteira_final: final4(pedido.carteira) } };
    case 'forbidden': return falha(403, 'forbidden');
    case 'suspended': return falha(409, 'suspended');
    case 'invalid': return falha(400, 'invalid');
    case 'method_not_available': return falha(400, 'method_not_available');
    default: return falha(500, 'erro');
  }
}
