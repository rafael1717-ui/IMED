// Lógica da função "pagamento-rotina" (iMed Pagamentos, P2a; arquitetura do pagamento §4.4, §5.4 e §6.1): o que o
// pg_cron manda fazer a cada minuto (e, de madrugada, com a conciliação). Não usa APIs do Deno (roda e é testada no Node).
//
// Executa o que public.pag_due() pedir, uma ação de cada vez, cada uma na própria transação do banco:
//   abortar ............. reserva paga online sem cobrança no provedor há mais de 60 s: solta o horário
//   apagar .............. cobrança vencida ou cancelada: apaga no provedor; se foi paga no último segundo, o provedor
//                         recusa e a situação consultada (paga) é aplicada no lugar
//   consultar/reaplicar . cobrança perto de vencer sem aviso, ou aviso gravado e ainda não aplicado
//   enviar_devolucao .... devolução pedida: envia ao provedor (uma por vez por cobrança; a chave evita devolver duas vezes)
//   reenviar_devolucao .. devolução enviada sem resposta: CONSULTA antes (se o dinheiro já voltou, só conclui)
//   conciliar ........... compara as cobranças do dia com o provedor e grava as diferenças (não corrige nada); só quando
//                         a chamada pede (a da madrugada)
// Uma ação que falha não para as outras: fica para a próxima passada. Sem o provedor configurado, só "abortar" roda.
import { ehObjeto, resp, type Cabecalhos, type Resposta, type Rpc } from '../_shared/base.ts';
import { codigoDoErro, ErroProvedor, type Provedor } from '../_shared/provedor.ts';

export interface Deps { rpc: Rpc; provedor: Provedor | null; agora: () => number }
export interface Opcoes { conciliar: boolean; limiteMs: number; so?: string[] | null }
export interface Resultado { feito: Record<string, number>; falhou: Record<string, number>; puladas: number; restam: number }
export const TOKEN_INTERNO = 'pagamentos';   // nome em private.app_tokens (migração pagamentos_rotina)

// Quem pode chamar: só o próprio banco (pg_cron + pg_net), com o token interno no cabeçalho x-imed-token.
export async function autorizado(h: Cabecalhos, rpc: Rpc): Promise<boolean> {
  const tok = h.get('x-imed-token') ?? '';
  if (!/^[0-9a-f]{64}$/.test(tok)) return false;
  try { return (await rpc('check_internal_token', { p_name: TOKEN_INTERNO, p_token: tok })) === true; } catch { return false; }
}

const soma = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

// Envia UMA devolução. Recusa do provedor (4xx): volta para a fila com o código do erro (o dinheiro não saiu). Sem
// resposta (rede, tempo esgotado, 5xx): fica "enviada" e a próxima passada CONSULTA antes de reenviar.
export async function enviarDevolucao(refundId: string, d: { rpc: Rpc; provedor: Provedor }): Promise<string> {
  const env = resp(await d.rpc('pag_refund_sent', { p_refund: refundId }));
  if (env.status !== 'ok') return String(env.status);   // done, undone, wait, not_refundable...
  try {
    const feito = await d.provedor.devolver(String(env.provedor_cobranca_id), {
      valorCents: Number(env.valor_cents), clinicaCents: env.integral === true ? 0 : Number(env.clinica_cents ?? 0),
      walletId: typeof env.wallet_id === 'string' ? env.wallet_id : null, total: env.total === true, chave: String(env.chave_idempotencia),
    });
    return String(resp(await d.rpc('pag_refund_done', { p_refund: refundId, p_provedor_estorno_id: feito.estornoId })).status);
  } catch (e) {
    if (e instanceof ErroProvedor && e.definitivo) {
      await d.rpc('pag_refund_failed', { p_refund: refundId, p_codigo: codigoDoErro(e) });
      return 'falhou';
    }
    return 'sem_resposta';
  }
}

export async function rodar(o: Opcoes, d: Deps): Promise<Resultado> {
  const inicio = d.agora();
  const out: Resultado = { feito: {}, falhou: {}, puladas: 0, restam: 0 };
  const devido = resp(await d.rpc('pag_due'));
  const acoes = Array.isArray(devido.acoes) ? devido.acoes.filter(ehObjeto) : [];
  for (let i = 0; i < acoes.length; i++) {
    const a = acoes[i];
    const acao = String(a.acao);
    if ((acao === 'conciliar' && !o.conciliar) || (o.so && !o.so.includes(acao))) { out.puladas++; continue; }
    if (d.agora() - inicio > o.limiteMs) { out.restam = acoes.length - i; break; }
    try {
      if (acao === 'abortar') {
        await d.rpc('pag_charge_abort', { p_request: a.request_id });
      } else if (!d.provedor) {
        soma(out.falhou, 'sem_provedor');
        continue;
      } else if (acao === 'apagar') {
        await d.rpc('pag_sync_apply', { p_charge: a.charge_id, p_foto: await d.provedor.apagar(String(a.provedor_cobranca_id)), p_event: null });
      } else if (acao === 'consultar' || acao === 'reaplicar') {
        await d.rpc('pag_sync_apply', {
          p_charge: a.charge_id, p_foto: await d.provedor.consultar(String(a.provedor_cobranca_id)), p_event: a.event_id ?? null,
        });
      } else if (acao === 'enviar_devolucao') {
        await enviarDevolucao(String(a.refund_id), { rpc: d.rpc, provedor: d.provedor });
      } else if (acao === 'reenviar_devolucao') {
        // enviada sem resposta: se o dinheiro já voltou no provedor, a situação consultada conclui a devolução aqui
        // (pag_sync_apply) e pag_refund_sent responde "done"; se não voltou, reenvia com a mesma chave
        const env = resp(await d.rpc('pag_refund_sent', { p_refund: a.refund_id }));
        if (env.status === 'ok') {
          const foto = await d.provedor.consultar(String(env.provedor_cobranca_id));
          if (foto.situacao === 'devolvida' || foto.situacao === 'devolvida_parcial') {
            await d.rpc('pag_sync_apply', { p_charge: a.charge_id, p_foto: foto, p_event: null });
          }
          await enviarDevolucao(String(a.refund_id), { rpc: d.rpc, provedor: d.provedor });
        }
      } else if (acao === 'conciliar') {
        await d.rpc('pag_reconcile_apply', { p_dia: a.dia, p_linhas: await d.provedor.listar(String(a.dia)), p_janela: a.janela });
      } else {
        out.puladas++;
        continue;
      }
      soma(out.feito, acao);
    } catch {
      soma(out.falhou, acao);
    }
  }
  return out;
}

export async function tratar(cabecalhos: Cabecalhos, corpo: unknown, d: Deps, limiteMs = 45_000): Promise<Resposta> {
  if (!(await autorizado(cabecalhos, d.rpc))) return { http: 403, corpo: { ok: false, status: 'forbidden' } };
  try {
    const r = await rodar({ conciliar: ehObjeto(corpo) && corpo.conciliar === true, limiteMs }, d);
    return { http: 200, corpo: { ok: true, status: 'ok', provedor: !!d.provedor, ...r } };
  } catch {
    return { http: 500, corpo: { ok: false, status: 'erro' } };
  }
}
