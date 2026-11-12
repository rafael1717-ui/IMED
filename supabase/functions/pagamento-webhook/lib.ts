// Lógica da função "pagamento-webhook" (iMed Pagamentos, P2a; arquitetura do pagamento §4.4 e §6.1): o aviso que o
// meio de pagamento manda quando uma cobrança muda. Não usa APIs do Deno (roda e é testada no Node).
//
//   1. Sem o segredo configurado (ou menor que 32 caracteres): recusa TUDO (503). Com ele: o cabeçalho do aviso tem de
//      ser igual ao segredo, comparado em tempo constante; senão 401.
//   2. O aviso é só a CAMPAINHA: grava-se o id, o tipo e o hash do corpo (nunca o corpo: ele traz dados do pagador), e a
//      situação aplicada é a CONSULTADA no provedor (pag_sync_apply). Aviso falso com o segredo certo não confirma nada.
//   3. Responde 200 assim que o aviso está GRAVADO. Se consultar ou aplicar falhar, a rotina reaplica (o aviso fica
//      "pendente"): assim a fila de avisos do provedor não é penalizada por erro nosso. Só responde erro (500) quando
//      nem gravar deu: aí o provedor tenta de novo.
//   4. Aviso repetido (mesmo id): o banco responde "repetido" e nada muda. Aviso de outra coisa (sem cobrança): 200.
import { resp, sha256Hex, tempoConstante, type Cabecalhos, type Resposta, type Rpc } from '../_shared/base.ts';
import type { EnvGet } from '../_shared/chaves.ts';
import type { Leitor, Provedor } from '../_shared/provedor.ts';

// leitor: quem sabe ler o aviso deste provedor (existe mesmo sem a chave da API: sem ela o aviso é gravado e a rotina
// aplica depois). provedor: para consultar a cobrança (null = sem a chave da API configurada).
export interface Deps { rpc: Rpc; provedor: Provedor | null; env: EnvGet; leitor: Leitor }
export const TAMANHO_MAXIMO = 64 * 1024;
export const SEGREDO_MINIMO = 32;

const r = (http: number, status: string, extra: Record<string, unknown> = {}): Resposta => ({ http, corpo: { ok: http === 200, status, ...extra } });

// O segredo do aviso: configurado, com pelo menos 32 caracteres e sem espaço (as regras do "authToken" do provedor).
export function segredoConfigurado(env: EnvGet): string {
  const s = env('ASAAS_WEBHOOK_TOKEN') ?? '';
  return s.length >= SEGREDO_MINIMO && s.length <= 255 && !/\s/.test(s) ? s : '';
}

export async function receber(cabecalhos: Cabecalhos, corpoTexto: string, d: Deps): Promise<Resposta> {
  const segredo = segredoConfigurado(d.env);
  if (!segredo) return r(503, 'not_configured');
  if (!tempoConstante(d.leitor.segredoDoAviso(cabecalhos), segredo)) return r(401, 'unauthorized');
  if (corpoTexto.length > TAMANHO_MAXIMO) return r(413, 'too_large');
  let json: unknown;
  try { json = JSON.parse(corpoTexto); } catch { return r(400, 'invalid_json'); }
  const aviso = d.leitor.lerAviso(json);
  if (!aviso) return r(400, 'invalid');
  // aviso que não é de cobrança (outro assunto da conta): nada a fazer, e a fila do provedor não pode parar por isso
  if (!aviso.cobrancaId) return r(200, 'ignorado');

  let gravado: Record<string, unknown>;
  try {
    gravado = resp(await d.rpc('pag_event_store', {
      p_provedor: d.leitor.nome, p_evento_id: aviso.id, p_tipo: aviso.tipo, p_provedor_cobranca_id: aviso.cobrancaId,
      p_situacao: aviso.situacao, p_valor_cents: aviso.valorCents, p_ocorrido_em: aviso.ocorridoEm, p_hash: await sha256Hex(corpoTexto),
    }));
  } catch {
    return r(500, 'erro');   // nem gravou: o provedor reenvia
  }
  if (gravado.status === 'sem_cobranca') return r(200, 'sem_cobranca');
  if (gravado.status === 'invalid') return r(200, 'ignorado');   // formato que o banco não guarda: reenviar não muda nada
  if (gravado.status !== 'ok' && gravado.status !== 'repetido') return r(500, 'erro');
  // repetido e já aplicado: nada a fazer. Repetido e ainda pendente (a primeira entrega gravou e caiu): aplica agora.
  if (gravado.status === 'repetido' && gravado.resultado !== 'pendente') return r(200, 'repetido');
  if (!gravado.charge_id || !d.provedor) return r(200, 'gravado', { aplicado: false });
  try {
    const foto = await d.provedor.consultar(aviso.cobrancaId);
    const ap = resp(await d.rpc('pag_sync_apply', { p_charge: gravado.charge_id, p_foto: foto, p_event: gravado.event_id }));
    if (ap.status !== 'ok') return r(200, 'gravado', { aplicado: false });
    return r(200, gravado.status === 'repetido' ? 'repetido' : 'aplicado', { aplicado: true, resultado: ap.resultado ?? null, acao: ap.acao ?? null });
  } catch {
    return r(200, 'gravado', { aplicado: false });   // a rotina reaplica (pag_due: "reaplicar")
  }
}
