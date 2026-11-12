// Testes da função "pagamento-webhook". Rodar com: node --experimental-strip-types --test supabase/functions/pagamento-webhook/lib.test.ts
// Banco e provedor simulados; o caminho com o banco de verdade está em tests/banco/pagamento-ponta-a-ponta.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex, type Rpc } from '../_shared/base.ts';
import { leitorAsaas } from '../_shared/asaas.ts';
import { ErroProvedor, type Foto, type Provedor } from '../_shared/provedor.ts';
import { receber, SEGREDO_MINIMO, segredoConfigurado, TAMANHO_MAXIMO } from './lib.ts';

const SEGREDO = 'segredo-de-teste-do-aviso-com-mais-de-32-letras';
const AVISO = { id: 'evt_0001', event: 'PAYMENT_RECEIVED', dateCreated: '2026-11-16T12:03:00Z',
  payment: { id: 'pay_000001', status: 'RECEIVED', value: 133.23, customer: 'cus_000001', description: 'IMED · agendamento 11111111' } };
const cab = (h: Record<string, string> = { 'asaas-access-token': SEGREDO }) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const foto = (situacao: Foto['situacao']): Foto => ({ situacao, valor_cents: 13323, tarifa_cents: 199, devolvido_cents: 0, paga_em: '2026-11-16', provedor_estorno_id: null });

function cenario(o: { banco?: Record<string, unknown>; segredo?: string | null; consultar?: () => Promise<Foto>; semProvedor?: boolean } = {}) {
  const chamadas: { fn: string; args: Record<string, unknown> }[] = [];
  const consultas: string[] = [];
  const padrao: Record<string, unknown> = {
    pag_event_store: { status: 'ok', event_id: 7, charge_id: 'cobranca-1' },
    pag_sync_apply: { status: 'ok', resultado: 'aplicado', situacao: 'aprovada', acao: 'nenhuma', request_status: 'confirmed' },
  };
  const rpc: Rpc = async (fn, args = {}) => {
    chamadas.push({ fn, args });
    const r = o.banco && fn in o.banco ? o.banco[fn] : padrao[fn];
    if (r instanceof Error) throw r;
    return r;
  };
  const provedor = { ...leitorAsaas, consultar: async (id: string) => { consultas.push(id); return o.consultar ? await o.consultar() : foto('paga'); } } as unknown as Provedor;
  const amb: Record<string, string> = o.segredo === null ? {} : { ASAAS_WEBHOOK_TOKEN: o.segredo ?? SEGREDO };
  const deps = { rpc, provedor: o.semProvedor ? null : provedor, env: (n: string) => amb[n], leitor: leitorAsaas };
  return { chamadas, consultas, receber: (h = cab(), corpo: unknown = AVISO) => receber(h, typeof corpo === 'string' ? corpo : JSON.stringify(corpo), deps) };
}
const fns = (c: { chamadas: { fn: string }[] }) => c.chamadas.map((x) => x.fn);

test('SEM SEGREDO CONFIGURADO RECUSA TUDO (inclusive quem manda o cabeçalho vazio ou qualquer coisa)', async () => {
  for (const segredo of [null, '', 'curto', 'x'.repeat(SEGREDO_MINIMO - 1), `com espaco ${'x'.repeat(40)}`, 'x'.repeat(256)]) {
    const c = cenario({ segredo });
    for (const h of [cab({}), cab({ 'asaas-access-token': '' }), cab({ 'asaas-access-token': segredo ?? '' }), cab()]) {
      const r = await c.receber(h);
      assert.deepEqual([r.http, r.corpo.status], [503, 'not_configured']);
    }
    assert.deepEqual(c.chamadas, [], 'nada gravado');
  }
  assert.equal(segredoConfigurado(() => undefined), '');
  assert.equal(segredoConfigurado(() => SEGREDO), SEGREDO);
});

test('segredo errado, ausente ou quase certo → 401, sem gravar nada; o certo passa', async () => {
  const c = cenario();
  for (const errado of ['', 'outro-segredo-com-mais-de-32-caracteres-aqui', `${SEGREDO}x`, SEGREDO.slice(0, -1), SEGREDO.toUpperCase()]) {
    const r = await c.receber(cab({ 'asaas-access-token': errado }));
    assert.deepEqual([r.http, r.corpo.status], [401, 'unauthorized'], errado);
  }
  assert.equal((await c.receber(cab({}))).http, 401, 'sem o cabeçalho');
  assert.equal((await c.receber(cab({ authorization: `Bearer ${SEGREDO}` }))).http, 401, 'em outro cabeçalho não vale');
  assert.deepEqual(c.chamadas, []);
  assert.equal((await c.receber()).http, 200);
});

test('aviso novo: grava (só id, tipo, cobrança, situação, valor, quando e o HASH do corpo), consulta o provedor e aplica a situação CONSULTADA', async () => {
  const c = cenario();
  const r = await c.receber();
  assert.deepEqual([r.http, r.corpo], [200, { ok: true, status: 'aplicado', aplicado: true, resultado: 'aplicado', acao: 'nenhuma' }]);
  assert.deepEqual(fns(c), ['pag_event_store', 'pag_sync_apply']);
  assert.deepEqual(c.chamadas[0].args, {
    p_provedor: 'asaas', p_evento_id: 'evt_0001', p_tipo: 'PAYMENT_RECEIVED', p_provedor_cobranca_id: 'pay_000001', p_situacao: 'RECEIVED',
    p_valor_cents: 13323, p_ocorrido_em: '2026-11-16T12:03:00.000Z', p_hash: await sha256Hex(JSON.stringify(AVISO)),
  });
  assert.ok(!JSON.stringify(c.chamadas).includes('cus_000001'), 'nada do pagador vai para o banco');
  assert.deepEqual(c.consultas, ['pay_000001']);
  assert.deepEqual(c.chamadas[1].args, { p_charge: 'cobranca-1', p_foto: foto('paga'), p_event: 7 });
});

test('AVISO FALSO com o segredo certo não confirma nada: vale o que o provedor responde, não o corpo', async () => {
  const c = cenario({ consultar: async () => foto('aguardando') });
  await c.receber(cab(), { ...AVISO, payment: { ...AVISO.payment, status: 'RECEIVED', value: 999999 } });
  assert.equal((c.chamadas[1].args.p_foto as Foto).situacao, 'aguardando');
  assert.equal((c.chamadas[1].args.p_foto as Foto).valor_cents, 13323);
});

test('aviso repetido: 200 "repetido", sem consultar nem aplicar de novo', async () => {
  const c = cenario({ banco: { pag_event_store: { status: 'repetido', event_id: 7, resultado: 'aplicado', charge_id: 'cobranca-1' } } });
  const r = await c.receber();
  assert.deepEqual([r.http, r.corpo.status], [200, 'repetido']);
  assert.deepEqual(fns(c), ['pag_event_store']);
  assert.deepEqual(c.consultas, []);
});

test('repetido e ainda pendente (a primeira entrega gravou e caiu antes de aplicar): aplica agora', async () => {
  const c = cenario({ banco: { pag_event_store: { status: 'repetido', event_id: 7, resultado: 'pendente', charge_id: 'cobranca-1' } } });
  const r = await c.receber();
  assert.deepEqual([r.http, r.corpo.status, r.corpo.aplicado], [200, 'repetido', true]);
  assert.deepEqual(fns(c), ['pag_event_store', 'pag_sync_apply']);
});

test('responde 200 assim que o aviso está GRAVADO, mesmo se consultar ou aplicar falhar (a rotina reaplica)', async () => {
  for (const o of [
    { consultar: async () => { throw new ErroProvedor(503, 'fora_do_ar'); } },
    { banco: { pag_sync_apply: new Error('banco caiu') } },
    { banco: { pag_sync_apply: { status: 'invalid' } } },
    { semProvedor: true },
  ]) {
    const c = cenario(o as Parameters<typeof cenario>[0]);
    const r = await c.receber();
    assert.deepEqual([r.http, r.corpo], [200, { ok: true, status: 'gravado', aplicado: false }]);
    assert.equal(fns(c)[0], 'pag_event_store');
  }
});

test('nem gravar deu (banco fora): 500, para o provedor reenviar', async () => {
  for (const banco of [{ pag_event_store: new Error('banco fora') }, { pag_event_store: { status: 'forbidden' } }, { pag_event_store: null }]) {
    const c = cenario({ banco });
    assert.equal((await c.receber()).http, 500);
    assert.deepEqual(c.consultas, []);
  }
});

test('aviso de cobrança que não é nossa, de outro assunto ou em formato que o banco não guarda: 200 (a fila do provedor não para)', async () => {
  const sem = cenario({ banco: { pag_event_store: { status: 'sem_cobranca', event_id: 8 } } });
  assert.deepEqual([(await sem.receber()).http, (await sem.receber()).corpo.status], [200, 'sem_cobranca']);
  assert.deepEqual(sem.consultas, []);
  const outro = cenario();
  const r = await outro.receber(cab(), { id: 'evt_0002', event: 'ACCOUNT_STATUS_UPDATED' });
  assert.deepEqual([r.http, r.corpo.status], [200, 'ignorado']);
  assert.deepEqual(outro.chamadas, []);
  const inv = cenario({ banco: { pag_event_store: { status: 'invalid' } } });
  assert.deepEqual([(await inv.receber()).http, (await inv.receber()).corpo.status], [200, 'ignorado']);
});

test('corpo que não é JSON, sem id de evento ou grande demais → 4xx, sem gravar', async () => {
  const c = cenario();
  assert.equal((await c.receber(cab(), 'isto não é json')).http, 400);
  assert.equal((await c.receber(cab(), { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } })).http, 400);
  assert.equal((await c.receber(cab(), `{"id":"evt","event":"X","lixo":"${'x'.repeat(TAMANHO_MAXIMO)}"}`)).http, 413);
  assert.deepEqual(c.chamadas, []);
});
