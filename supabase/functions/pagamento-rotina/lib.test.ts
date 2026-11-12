// Testes da função "pagamento-rotina". Rodar com: node --experimental-strip-types --test supabase/functions/pagamento-rotina/lib.test.ts
// Banco e provedor simulados; o caminho com o banco de verdade está em tests/banco/pagamento-ponta-a-ponta.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Rpc } from '../_shared/base.ts';
import { ErroProvedor, type Foto, type Provedor } from '../_shared/provedor.ts';
import { autorizado, enviarDevolucao, rodar, TOKEN_INTERNO, tratar } from './lib.ts';

const TOKEN = 'f'.repeat(64);
const cab = (h: Record<string, string> = { 'x-imed-token': TOKEN }) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const foto = (situacao: Foto['situacao'], devolvido = 0): Foto => ({ situacao, valor_cents: 10000, tarifa_cents: 199, devolvido_cents: devolvido, paga_em: null, provedor_estorno_id: devolvido ? 'est_1' : null });
const ENVIO = { status: 'ok', refund_id: 'dev-1', charge_id: 'cob-1', provedor_cobranca_id: 'pay_1', valor_cents: 10000, integral: false, taxa_cents: 1500, clinica_cents: 8500, total: true, wallet_id: 'wal_teste', chave_idempotencia: 'chave-idem-1', tentativas: 1 };

function cenario(o: { acoes?: Record<string, unknown>[]; banco?: Record<string, unknown | ((a: Record<string, unknown>) => unknown)>; provedor?: Partial<Provedor>; semProvedor?: boolean; relogio?: number[] } = {}) {
  const chamadas: { fn: string; args: Record<string, unknown> }[] = [];
  const noProvedor: { op: string; dados: unknown[] }[] = [];
  const padrao: Record<string, unknown> = {
    check_internal_token: (a: Record<string, unknown>) => a.p_name === TOKEN_INTERNO && a.p_token === TOKEN,
    pag_due: { status: 'ok', acoes: o.acoes ?? [] },
    pag_charge_abort: { status: 'ok' }, pag_sync_apply: { status: 'ok', resultado: 'aplicado' },
    pag_refund_sent: ENVIO, pag_refund_done: { status: 'ok', valor_cents: 10000 }, pag_refund_failed: { status: 'ok', tentativas: 1 },
    pag_reconcile_apply: { status: 'ok' },
  };
  const rpc: Rpc = async (fn, args = {}) => {
    chamadas.push({ fn, args });
    const r = o.banco && fn in o.banco ? o.banco[fn] : padrao[fn];
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? (r as (a: Record<string, unknown>) => unknown)(args) : r;
  };
  const anota = (op: string, r: unknown) => async (...dados: unknown[]) => { noProvedor.push({ op, dados }); if (r instanceof Error) throw r; return r; };
  const provedor = {
    nome: 'asaas', consultar: anota('consultar', foto('paga')), apagar: anota('apagar', foto('apagada')),
    devolver: anota('devolver', { estornoId: 'est_1', foto: foto('devolvida', 10000) }),
    listar: anota('listar', [{ provedor_cobranca_id: 'pay_1', situacao: 'paga', valor_cents: 10000, repasse_cents: 8500, tarifa_cents: 199, devolvido_cents: 0 }]),
    ...(o.provedor ?? {}),
  } as unknown as Provedor;
  let i = 0;
  const agora = () => (o.relogio ? o.relogio[Math.min(i++, o.relogio.length - 1)] : 1000);
  return { chamadas, noProvedor, deps: { rpc, provedor: o.semProvedor ? null : provedor, agora } };
}
const fns = (c: { chamadas: { fn: string }[] }) => c.chamadas.map((x) => x.fn).filter((f) => f !== 'pag_due');
const ops = (c: { noProvedor: { op: string }[] }) => c.noProvedor.map((x) => x.op);

test('quem pode chamar: só com o token interno "pagamentos" (formato conferido antes de ir ao banco)', async () => {
  const c = cenario();
  assert.equal(await autorizado(cab(), c.deps.rpc), true);
  assert.deepEqual(c.chamadas[0], { fn: 'check_internal_token', args: { p_name: 'pagamentos', p_token: TOKEN } });
  for (const h of [cab({}), cab({ 'x-imed-token': '' }), cab({ 'x-imed-token': 'curto' }), cab({ 'x-imed-token': 'G'.repeat(64) }), cab({ 'x-imed-token': `${TOKEN}0` })]) {
    const n = c.chamadas.length;
    assert.equal(await autorizado(h, c.deps.rpc), false);
    assert.equal(c.chamadas.length, n, 'formato errado: nem pergunta ao banco');
  }
  assert.equal(await autorizado(cab({ 'x-imed-token': 'e'.repeat(64) }), c.deps.rpc), false, 'token de outro nome ou errado');
  const fora = cenario({ banco: { check_internal_token: new Error('banco fora') } });
  assert.equal(await autorizado(cab(), fora.deps.rpc), false);
  const r = await tratar(cab({}), null, c.deps);
  assert.deepEqual([r.http, r.corpo], [403, { ok: false, status: 'forbidden' }]);
});

test('cada ação de pag_due vira a chamada certa; a conciliação só quando a chamada pede', async () => {
  const acoes = [
    { acao: 'abortar', request_id: 'ped-1' },
    { acao: 'apagar', charge_id: 'cob-2', provedor_cobranca_id: 'pay_2' },
    { acao: 'consultar', charge_id: 'cob-3', provedor_cobranca_id: 'pay_3' },
    { acao: 'enviar_devolucao', refund_id: 'dev-1', charge_id: 'cob-1' },
    { acao: 'reaplicar', event_id: 9, charge_id: 'cob-4', provedor_cobranca_id: 'pay_4' },
    { acao: 'conciliar', dia: '2026-11-15', janela: 'd1' },
  ];
  const c = cenario({ acoes });
  const r = await rodar({ conciliar: false, limiteMs: 60_000 }, c.deps);
  assert.deepEqual(r, { feito: { abortar: 1, apagar: 1, consultar: 1, enviar_devolucao: 1, reaplicar: 1 }, falhou: {}, puladas: 1, restam: 0 });
  assert.deepEqual(fns(c), ['pag_charge_abort', 'pag_sync_apply', 'pag_sync_apply', 'pag_refund_sent', 'pag_refund_done', 'pag_sync_apply']);
  assert.deepEqual(ops(c), ['apagar', 'consultar', 'devolver', 'consultar']);
  assert.deepEqual(c.chamadas[1].args, { p_request: 'ped-1' });
  assert.deepEqual(c.chamadas[2].args, { p_charge: 'cob-2', p_foto: foto('apagada'), p_event: null }, 'apagar aplica a foto que o provedor devolveu (paga no último segundo = paga)');
  assert.deepEqual(c.chamadas.at(-1)?.args, { p_charge: 'cob-4', p_foto: foto('paga'), p_event: 9 });
  const m = cenario({ acoes });
  const rm = await rodar({ conciliar: true, limiteMs: 60_000 }, m.deps);
  assert.equal(rm.feito.conciliar, 1);
  assert.deepEqual(m.chamadas.at(-1), { fn: 'pag_reconcile_apply', args: { p_dia: '2026-11-15', p_janela: 'd1',
    p_linhas: [{ provedor_cobranca_id: 'pay_1', situacao: 'paga', valor_cents: 10000, repasse_cents: 8500, tarifa_cents: 199, devolvido_cents: 0 }] } });
});

test('uma ação que falha não para as outras; sem tempo, o resto fica para a próxima passada', async () => {
  const acoes = [
    { acao: 'consultar', charge_id: 'cob-1', provedor_cobranca_id: 'pay_1' }, { acao: 'abortar', request_id: 'ped-1' },
    { acao: 'apagar', charge_id: 'cob-2', provedor_cobranca_id: 'pay_2' },
  ];
  const c = cenario({ acoes, provedor: { consultar: async () => { throw new ErroProvedor(503, 'fora_do_ar'); } } });
  assert.deepEqual(await rodar({ conciliar: false, limiteMs: 60_000 }, c.deps), { feito: { abortar: 1, apagar: 1 }, falhou: { consultar: 1 }, puladas: 0, restam: 0 });
  const lento = cenario({ acoes, relogio: [0, 10, 50_000] });
  const r = await rodar({ conciliar: false, limiteMs: 45_000 }, lento.deps);
  assert.deepEqual([r.feito, r.restam], [{ consultar: 1 }, 2]);
});

test('sem o provedor configurado: só solta reserva sem cobrança (nada é apagado, consultado nem devolvido)', async () => {
  const c = cenario({ semProvedor: true, acoes: [{ acao: 'abortar', request_id: 'ped-1' }, { acao: 'apagar', charge_id: 'c', provedor_cobranca_id: 'p' }, { acao: 'enviar_devolucao', refund_id: 'd' }] });
  assert.deepEqual(await rodar({ conciliar: true, limiteMs: 60_000 }, c.deps), { feito: { abortar: 1 }, falhou: { sem_provedor: 2 }, puladas: 0, restam: 0 });
  assert.deepEqual(fns(c), ['pag_charge_abort']);
});

test('devolução: enviada com os valores do banco e a chave; total sem valor; integral não tira da clínica', async () => {
  const c = cenario();
  assert.equal(await enviarDevolucao('dev-1', { rpc: c.deps.rpc, provedor: c.deps.provedor! }), 'ok');
  assert.deepEqual(c.noProvedor[0].dados, ['pay_1', { valorCents: 10000, clinicaCents: 8500, walletId: 'wal_teste', total: true, chave: 'chave-idem-1' }]);
  assert.deepEqual(c.chamadas.at(-1), { fn: 'pag_refund_done', args: { p_refund: 'dev-1', p_provedor_estorno_id: 'est_1' } });
  const integral = cenario({ banco: { pag_refund_sent: { ...ENVIO, integral: true, taxa_cents: null, clinica_cents: null } } });
  await enviarDevolucao('dev-1', { rpc: integral.deps.rpc, provedor: integral.deps.provedor! });
  assert.equal((integral.noProvedor[0].dados[1] as { clinicaCents: number }).clinicaCents, 0);
  for (const st of ['done', 'undone', 'wait', 'not_refundable', 'not_found']) {
    const n = cenario({ banco: { pag_refund_sent: { status: st } } });
    assert.equal(await enviarDevolucao('dev-1', { rpc: n.deps.rpc, provedor: n.deps.provedor! }), st);
    assert.deepEqual(ops(n), [], `${st}: nada vai ao provedor`);
  }
});

test('devolução RECUSADA pelo provedor (4xx): volta para a fila com o código; SEM RESPOSTA: fica "enviada" (não se sabe se o dinheiro saiu)', async () => {
  const recusa = cenario({ provedor: { devolver: async () => { throw new ErroProvedor(400, 'invalid_refund_value'); } } });
  assert.equal(await enviarDevolucao('dev-1', { rpc: recusa.deps.rpc, provedor: recusa.deps.provedor! }), 'falhou');
  assert.deepEqual(recusa.chamadas.at(-1), { fn: 'pag_refund_failed', args: { p_refund: 'dev-1', p_codigo: 'invalid_refund_value' } });
  for (const erro of [new ErroProvedor(0, 'tempo_esgotado'), new ErroProvedor(503, 'fora_do_ar'), new ErroProvedor(429, 'limite')]) {
    const c = cenario({ provedor: { devolver: async () => { throw erro; } } });
    assert.equal(await enviarDevolucao('dev-1', { rpc: c.deps.rpc, provedor: c.deps.provedor! }), 'sem_resposta');
    assert.deepEqual(fns(c), ['pag_refund_sent'], 'nem "concluída" nem "falhou": a próxima passada consulta antes de reenviar');
  }
});

test('reenviar devolução sem resposta: CONSULTA antes; se o dinheiro já voltou, só conclui (não devolve duas vezes)', async () => {
  let enviadas = 0;
  const ja = cenario({
    acoes: [{ acao: 'reenviar_devolucao', refund_id: 'dev-1', charge_id: 'cob-1' }],
    banco: { pag_refund_sent: () => (++enviadas === 1 ? ENVIO : { status: 'done' }) },
    provedor: { consultar: async () => foto('devolvida', 10000) },
  });
  const r = await rodar({ conciliar: false, limiteMs: 60_000 }, ja.deps);
  assert.deepEqual(r.feito, { reenviar_devolucao: 1 });
  assert.deepEqual(fns(ja), ['pag_refund_sent', 'pag_sync_apply', 'pag_refund_sent'], 'a situação consultada conclui a devolução no banco');
  assert.deepEqual(ops(ja), [], 'nenhuma devolução nova no provedor');
  const nao = cenario({ acoes: [{ acao: 'reenviar_devolucao', refund_id: 'dev-1', charge_id: 'cob-1' }] });
  await rodar({ conciliar: false, limiteMs: 60_000 }, nao.deps);
  assert.deepEqual(ops(nao), ['consultar', 'devolver'], 'o dinheiro não voltou: reenvia com a MESMA chave');
  assert.equal((nao.noProvedor[1].dados[1] as { chave: string }).chave, 'chave-idem-1');
});

test('tratar: responde o que fez, sem dado de ninguém; { conciliar: true } liga a conciliação', async () => {
  const c = cenario({ acoes: [{ acao: 'conciliar', dia: '2026-11-15', janela: 'd1' }] });
  const r = await tratar(cab(), { conciliar: true }, c.deps);
  assert.deepEqual(r, { http: 200, corpo: { ok: true, status: 'ok', provedor: true, feito: { conciliar: 1 }, falhou: {}, puladas: 0, restam: 0 } });
  const s = cenario({ acoes: [{ acao: 'conciliar', dia: '2026-11-15', janela: 'd1' }] });
  assert.deepEqual((await tratar(cab(), null, s.deps)).corpo.feito, {});
  const fora = cenario({ banco: { pag_due: new Error('banco fora') } });
  assert.equal((await tratar(cab(), null, fora.deps)).http, 500);
});
