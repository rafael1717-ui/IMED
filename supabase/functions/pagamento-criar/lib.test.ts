// Testes da função "pagamento-criar". Rodar com: node --experimental-strip-types --test supabase/functions/pagamento-criar/lib.test.ts
// Banco, provedor e Turnstile simulados; o caminho com o banco de verdade está em tests/banco/pagamento-ponta-a-ponta.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Contagem, Fetch, Rpc } from '../_shared/base.ts';
import { ErroBanco } from '../_shared/base.ts';
import { ErroProvedor, type Foto, type Provedor } from '../_shared/provedor.ts';
import { conferirTurnstile, configuracao, lerPedido, LIMITE, tratar, TURNSTILE_URL, type Deps } from './lib.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const CLINICA = '22222222-2222-4222-8222-222222222222';
const PROC = '33333333-3333-4333-8333-333333333333';
const CHAVE = '44444444-4444-4444-8444-444444444444';
const COBRANCA = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'a'.repeat(64);
const CPF = '52998224725';
const pedido = (extra: Record<string, unknown> = {}) => ({
  action: 'criar', clinic: CLINICA, items: [{ procedure_id: PROC, starts_at: '2026-11-17T12:00:00Z' }],
  patient: { name: 'Maria  Paciente ', phone: '(11) 98765-4321', email: 'Maria@Exemplo.Test', consent: true, cpf: 'não devia ir', notes: 'dado de saúde' },
  id: ID, token: TOKEN, key: CHAVE, payer: { name: 'Maria Paciente', cpf: '529.982.247-25' }, captcha: 'desafio-ok', ...extra,
});
const AMBIENTE: Record<string, string> = { TURNSTILE_SECRET_KEY: 'segredo-do-turnstile-de-teste', PAG_CPF_HMAC_KEY: 'chave-do-hmac-de-teste-com-32-letras!' };

// Banco simulado: responde como as funções da P1 (o formato vem de pagamentos_base_parte_2 e 3) e anota as chamadas.
function cenario(o: { banco?: Record<string, unknown | ((a: Record<string, unknown>) => unknown)>; ambiente?: Record<string, string>; semProvedor?: boolean; provedor?: Partial<Provedor> } = {}) {
  const chamadas: { fn: string; args: Record<string, unknown> }[] = [];
  const noProvedor: { op: string; dados: unknown }[] = [];
  const padrao: Record<string, unknown> = {
    agenda_pay_hold: { status: 'ok', id: ID, request_status: 'hold', slot_start: '2026-11-17T12:00:00+00:00', slot_end: '2026-11-17T12:30:00+00:00', hold_expires_at: '2026-11-16T12:10:00+00:00', total_cents: 13323, payment_mode: 'online' },
    pag_payer_upsert: { status: 'ok', payer_id: 'pagador-1', provedor_cliente_id: null },
    pag_payer_attach: { status: 'ok', provedor_cliente_id: 'cus_000001' },
    pag_charge_open: { status: 'ok', charge_id: COBRANCA, situacao: 'criada', meio: 'pix', valor_cents: 13323, taxa_cents: 1998, clinica_cents: 11325, emitida_por: 'imed', wallet_id: 'wal_teste', expira_em: '2026-11-16T12:08:00+00:00', tentativa: 1, referencia: COBRANCA, provedor_cobranca_id: null, descricao: 'IMED · agendamento 11111111', provedor_cliente_id: null },
    pag_charge_attach: { status: 'ok', expira_em: '2026-11-16T12:08:00+00:00' },
    pag_charge_abort: { status: 'ok' },
    pag_charge_lookup: { status: 'ok', charge_id: COBRANCA, situacao: 'aguardando', provedor_cobranca_id: 'pay_000001', request_status: 'awaiting_payment' },
    pag_sync_apply: { status: 'ok', resultado: 'aplicado', situacao: 'aprovada', acao: 'nenhuma', request_status: 'confirmed' },
  };
  const rpc: Rpc = async (fn, args = {}) => {
    chamadas.push({ fn, args });
    const r = o.banco && fn in o.banco ? o.banco[fn] : padrao[fn];
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? (r as (a: Record<string, unknown>) => unknown)(args) : r;
  };
  const foto = (situacao: Foto['situacao']): Foto => ({ situacao, valor_cents: 13323, tarifa_cents: 199, devolvido_cents: 0, paga_em: null, provedor_estorno_id: null });
  const provedor: Provedor = {
    nome: 'asaas',
    criarCliente: async (p) => { noProvedor.push({ op: 'criarCliente', dados: p }); return 'cus_000001'; },
    criarCobranca: async (c) => { noProvedor.push({ op: 'criarCobranca', dados: c }); return { id: 'pay_000001', copiaCola: '00020126-copia-e-cola' }; },
    buscarPorReferencia: async (r) => { noProvedor.push({ op: 'buscarPorReferencia', dados: r }); return null; },
    consultar: async (id) => { noProvedor.push({ op: 'consultar', dados: id }); return foto('paga'); },
    copiaCola: async (id) => { noProvedor.push({ op: 'copiaCola', dados: id }); return '00020126-copia-e-cola-antiga'; },
    apagar: async (id) => { noProvedor.push({ op: 'apagar', dados: id }); return foto('apagada'); },
    devolver: async () => ({ estornoId: null, foto: foto('devolvida') }),
    listar: async () => [],
    segredoDoAviso: () => '',
    lerAviso: () => null,
    ...(o.provedor ?? {}),
  };
  const turnstile: { url: string; corpo: string }[] = [];
  const fetchFn: Fetch = async (url, init) => {
    turnstile.push({ url, corpo: String(init?.body ?? '') });
    return new Response(JSON.stringify({ success: new URLSearchParams(String(init?.body)).get('response') === 'desafio-ok' }), { status: 200 });
  };
  const amb = o.ambiente ?? AMBIENTE;
  const contagem: Contagem = new Map();
  const deps: Deps = {
    rpc, provedor: o.semProvedor ? null : provedor, env: (n) => amb[n], fetch: fetchFn, agora: () => Date.parse('2026-11-16T12:00:00Z'),
    usuario: async (a) => (a === 'Bearer tok-maria' ? '99999999-9999-4999-8999-999999999999' : null), contagem,
  };
  const chamar = (corpo: unknown, quem = { ip: '203.0.113.7', autorizacao: '' }) => tratar(corpo, quem, deps);
  return { chamar, chamadas, noProvedor, turnstile, deps };
}
const fns = (c: { chamadas: { fn: string }[] }) => c.chamadas.map((x) => x.fn);

test('lerPedido: só os campos da lista seguem; CPF e formato conferidos', () => {
  const p = lerPedido(pedido());
  assert.ok(p);
  assert.deepEqual(p.paciente, { name: 'Maria Paciente', phone: '11987654321', consent: true, email: 'maria@exemplo.test' }, 'sem campo extra (cpf, notes)');
  assert.deepEqual(p.pagador, { nome: 'Maria Paciente', cpf: '52998224725' });
  assert.deepEqual(p.itens, [{ procedure_id: PROC, starts_at: '2026-11-17T12:00:00.000Z' }]);
  const outra = lerPedido(pedido({ patient: { name: 'Mãe', phone: '11987654321', consent: true, for_other: true, other_name: ' Filho  Dela ', relationship: 'Filho ou filha', other_minor: true, guardian_consent: true } }));
  assert.deepEqual(outra?.paciente, { name: 'Mãe', phone: '11987654321', consent: true, for_other: true, other_name: 'Filho Dela', relationship: 'Filho ou filha', other_minor: true, guardian_consent: true, other_consent: false });
  const ruins: Record<string, unknown>[] = [
    { payer: { name: 'Maria', cpf: '52998224724' } }, { payer: { name: 'M', cpf: CPF } }, { payer: null }, { id: 'x' }, { token: 'curto' }, { token: `${TOKEN} ` },
    { clinic: 'x' }, { key: '' }, { items: [] }, { items: Array(5).fill({ procedure_id: PROC, starts_at: '2026-11-17T12:00:00Z' }) },
    { items: [{ procedure_id: PROC, starts_at: 'amanhã' }] }, { patient: { name: 'Maria', phone: '11987654321', consent: false } },
    { patient: { name: 'Maria', phone: '123', consent: true } }, { action: 'apagar' },
  ];
  for (const r of ruins) assert.equal(lerPedido(pedido(r)), null, JSON.stringify(r).slice(0, 60));
  for (const r of [null, 'x', [], 42]) assert.equal(lerPedido(r), null);
  assert.deepEqual(lerPedido({ action: 'conferir', id: ID, token: TOKEN })?.acao, 'conferir');
});

test('FECHADA POR PADRÃO: sem o segredo do Turnstile recusa tudo, antes de tocar no banco', async () => {
  const c = cenario({ ambiente: { PAG_CPF_HMAC_KEY: AMBIENTE.PAG_CPF_HMAC_KEY } });
  const r = await c.chamar(pedido());
  assert.deepEqual([r.http, r.corpo.status], [503, 'captcha_not_configured']);
  assert.deepEqual(c.chamadas, [], 'nenhuma chamada ao banco');
  assert.deepEqual(c.noProvedor, [], 'nenhuma chamada ao provedor');
  assert.deepEqual(configuracao((n) => ({ TURNSTILE_SECRET_KEY: ' ' } as Record<string, string>)[n], null), { turnstile: false, hmac: false, provedor: false });
});

test('sem a chave do HMAC (ou curta) ou sem o provedor: recusa, sem tocar no banco', async () => {
  const casos: Parameters<typeof cenario>[0][] = [{ ambiente: { TURNSTILE_SECRET_KEY: 's' } }, { ambiente: { TURNSTILE_SECRET_KEY: 's', PAG_CPF_HMAC_KEY: 'curta' } }, { semProvedor: true }];
  for (const o of casos) {
    const c = cenario(o);
    const r = await c.chamar(pedido());
    assert.deepEqual([r.http, r.corpo.status], [503, 'payments_not_configured']);
    assert.deepEqual(c.chamadas, []);
  }
});

test('Turnstile: código errado ou ausente → 403, sem tocar no banco; o segredo vai só para o Cloudflare', async () => {
  const c = cenario();
  for (const captcha of ['errado', '', undefined]) {
    const r = await c.chamar(pedido({ captcha }));
    assert.deepEqual([r.http, r.corpo.status], [403, 'captcha_failed']);
  }
  assert.deepEqual(c.chamadas, []);
  assert.equal(c.turnstile.length, 1, 'sem código, nem chama o Cloudflare');
  assert.equal(c.turnstile[0].url, TURNSTILE_URL);
  assert.equal(new URLSearchParams(c.turnstile[0].corpo).get('secret'), AMBIENTE.TURNSTILE_SECRET_KEY);
  assert.equal(new URLSearchParams(c.turnstile[0].corpo).get('remoteip'), '203.0.113.7');
  const cai: Fetch = async () => { throw new TypeError('fetch failed'); };
  assert.equal(await conferirTurnstile(cai, 's', 'x', 'ip'), false, 'Cloudflare fora do ar: não passa');
  const erro500: Fetch = async () => new Response('{}', { status: 500 });
  assert.equal(await conferirTurnstile(erro500, 's', 'x', 'ip'), false);
});

test('caminho feliz: reserva → pagador → cobrança aqui → cliente e cobrança no provedor → anexa; a resposta só tem o que o paciente vê', async () => {
  const c = cenario();
  const r = await c.chamar(pedido(), { ip: '203.0.113.7', autorizacao: 'Bearer tok-maria' });
  assert.equal(r.http, 200);
  assert.deepEqual(fns(c), ['agenda_pay_hold', 'pag_payer_upsert', 'pag_charge_open', 'pag_payer_attach', 'pag_charge_attach']);
  assert.deepEqual(c.noProvedor.map((x) => x.op), ['criarCliente', 'criarCobranca']);
  // o banco recebe a escolha e a conta de quem está logado; nunca um valor vindo do navegador
  assert.deepEqual(c.chamadas[0].args, {
    p_clinic: CLINICA, p_items: [{ procedure_id: PROC, starts_at: '2026-11-17T12:00:00.000Z' }],
    p_patient: { name: 'Maria Paciente', phone: '11987654321', consent: true, email: 'maria@exemplo.test' }, p_id: ID, p_token: TOKEN,
    p_user: '99999999-9999-4999-8999-999999999999',
  });
  const hmac = String(c.chamadas[1].args.p_cpf_hmac);
  assert.match(hmac, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(c.chamadas).includes(CPF), 'o CPF em texto NUNCA vai para o banco');
  assert.deepEqual(c.chamadas[2].args, { p_request: ID, p_token: TOKEN, p_meio: 'pix', p_key: CHAVE, p_payer: 'pagador-1' });
  // §6.3: o provedor recebe só nome e CPF de quem paga, o valor, a divisão, a descrição fixa e a referência
  assert.deepEqual(c.noProvedor[0].dados, { nome: 'Maria Paciente', cpf: CPF });
  assert.deepEqual(c.noProvedor[1].dados, {
    referencia: COBRANCA, valorCents: 13323, clinicaCents: 11325, walletId: 'wal_teste', descricao: 'IMED · agendamento 11111111',
    clienteId: 'cus_000001', vencimento: '2026-11-16',
  });
  assert.deepEqual(c.chamadas[4].args, { p_charge: COBRANCA, p_provedor_id: 'pay_000001', p_expira: null, p_copia_cola: '00020126-copia-e-cola' });
  assert.deepEqual(r.corpo, {
    ok: true, status: 'ok', id: ID, request_status: 'awaiting_payment', slot_start: '2026-11-17T12:00:00+00:00', slot_end: '2026-11-17T12:30:00+00:00',
    hold_expires_at: '2026-11-16T12:10:00+00:00', total_cents: 13323,
    payment: { situacao: 'aguardando', meio: 'pix', valor_cents: 13323, expira_em: '2026-11-16T12:08:00+00:00', pix_copia_cola: '00020126-copia-e-cola' },
    agora: '2026-11-16T12:00:00.000Z',
  });
  const txt = JSON.stringify(r.corpo);
  for (const proibido of ['wal_teste', 'taxa', 'clinica_cents', 'pay_000001', 'cus_000001', COBRANCA, CPF]) assert.ok(!txt.includes(proibido), `a resposta não traz ${proibido}`);
});

test('pagador que já tem cadastro no provedor não é criado de novo', async () => {
  const c = cenario({ banco: { pag_payer_upsert: { status: 'ok', payer_id: 'pagador-1', provedor_cliente_id: 'cus_antigo' } } });
  assert.equal((await c.chamar(pedido())).corpo.status, 'ok');
  assert.deepEqual(c.noProvedor.map((x) => x.op), ['criarCobranca']);
  assert.equal((c.noProvedor[0].dados as { clienteId: string }).clienteId, 'cus_antigo');
  assert.ok(!fns(c).includes('pag_payer_attach'));
});

test('respostas do banco passam para o site como estão (sem inventar): horário pego, chave geral desligada, limite...', async () => {
  const casos: [Record<string, unknown>, Record<string, unknown>][] = [
    [{ status: 'slot_taken', seq: 1, alternatives: ['2026-11-17T12:30:00+00:00', 7] }, { ok: false, status: 'slot_taken', alternatives: ['2026-11-17T12:30:00+00:00'] }],
    [{ status: 'payments_off' }, { ok: false, status: 'payments_off' }],
    [{ status: 'payment_not_available' }, { ok: false, status: 'payment_not_available' }],
    [{ status: 'payment_pending' }, { ok: false, status: 'payment_pending' }],
    [{ status: 'too_many_expired' }, { ok: false, status: 'too_many_expired' }],
    [{ status: 'below_minimum', min_cents: 2000 }, { ok: false, status: 'below_minimum', min_cents: 2000 }],
  ];
  for (const [banco, esperado] of casos) {
    const c = cenario({ banco: { agenda_pay_hold: banco } });
    const r = await c.chamar(pedido());
    assert.deepEqual([r.http, r.corpo], [200, esperado]);
    assert.deepEqual(fns(c), ['agenda_pay_hold'], 'parou na reserva: nenhuma cobrança');
    assert.deepEqual(c.noProvedor, []);
  }
  const estranho = cenario({ banco: { agenda_pay_hold: { status: 'coisa_nova', segredo: 'x' } } });
  assert.deepEqual((await estranho.chamar(pedido())).corpo, { ok: false, status: 'erro' });
  const conflito = cenario({ banco: { agenda_pay_hold: new ErroBanco(409, '23P01') } });
  assert.deepEqual((await conflito.chamar(pedido())).corpo, { ok: false, status: 'slot_taken' }, 'restrição de exclusão = horário pego');
});

test('cobrança recusada pelo banco: a reserva NOVA é solta na hora; reserva repetida de antes fica como estava', async () => {
  const c = cenario({ banco: { pag_charge_open: { status: 'fee_not_configured' } } });
  const r = await c.chamar(pedido());
  assert.deepEqual(r.corpo, { ok: false, status: 'fee_not_configured', released: true });
  assert.equal(fns(c).at(-1), 'pag_charge_abort');
  const rep = cenario({ banco: { agenda_pay_hold: { status: 'ok', replay: true, id: ID }, pag_charge_open: { status: 'too_many_attempts' } } });
  assert.deepEqual((await rep.chamar(pedido())).corpo, { ok: false, status: 'too_many_attempts', released: false });
  assert.ok(!fns(rep).includes('pag_charge_abort'));
});

test('PROVEDOR FORA DO AR: a reserva é solta na hora e o paciente vê "pagamento indisponível"', async () => {
  const c = cenario({ provedor: { criarCobranca: async () => { throw new ErroProvedor(0, 'sem_resposta'); } } });
  const r = await c.chamar(pedido());
  assert.deepEqual([r.http, r.corpo], [502, { ok: false, status: 'provider_unavailable', released: true }]);
  assert.ok(fns(c).includes('pag_charge_abort'));
  assert.ok(!fns(c).includes('pag_charge_attach'));
  // não dá para saber se a cobrança nasceu lá: procura pela referência (aqui não achou nada)
  assert.deepEqual(c.noProvedor.map((x) => x.op), ['criarCliente', 'buscarPorReferencia']);
  const orfa = cenario({ provedor: {
    criarCobranca: async () => { throw new ErroProvedor(0, 'tempo_esgotado'); },
    buscarPorReferencia: async () => ({ id: 'pay_orfa', foto: { situacao: 'aguardando', valor_cents: 1, tarifa_cents: null, devolvido_cents: 0, paga_em: null, provedor_estorno_id: null } }),
  } });
  assert.equal((await orfa.chamar(pedido())).corpo.status, 'provider_unavailable');
  assert.deepEqual(orfa.noProvedor.map((x) => `${x.op}:${x.dados && typeof x.dados === 'string' ? x.dados : ''}`).at(-1), 'apagar:pay_orfa', 'a cobrança órfã é apagada no provedor');
  const cliente = cenario({ provedor: { criarCliente: async () => { throw new ErroProvedor(400, 'invalid_cpfCnpj'); } } });
  const rc = await cliente.chamar(pedido());
  assert.deepEqual(rc.corpo, { ok: false, status: 'provider_unavailable', released: true });
  assert.deepEqual(cliente.noProvedor, [], 'falhou antes de pedir a cobrança: nada para procurar lá');
});

test('reserva que venceu enquanto o provedor respondia: nada confirmado; a cobrança criada lá é apagada', async () => {
  const c = cenario({ banco: { pag_charge_attach: { status: 'hold_expired', acao: 'apagar' } } });
  const r = await c.chamar(pedido());
  assert.deepEqual(r.corpo, { ok: false, status: 'hold_expired' });
  assert.equal(c.noProvedor.at(-1)?.op, 'apagar');
});

test('retomar: cobrança viva que já existe (página reaberta, botão tocado de novo) não cria outra', async () => {
  for (const banco of [
    { pag_charge_open: { status: 'charge_exists', charge_id: COBRANCA, situacao: 'aguardando', provedor_cobranca_id: 'pay_000001' } },
    { pag_charge_open: { status: 'ok', replay: true, charge_id: COBRANCA, situacao: 'aguardando', provedor_cobranca_id: 'pay_000001' } },
  ]) {
    const c = cenario({ banco });
    assert.deepEqual((await c.chamar(pedido())).corpo, { ok: true, status: 'ok', retomar: true, id: ID });
    assert.deepEqual(c.noProvedor, [], 'nada criado no provedor');
    assert.ok(!fns(c).includes('pag_charge_abort'));
  }
});

test('mesma chave, criação que caiu no meio: acha a cobrança pela referência em vez de criar outra', async () => {
  const aberta = { status: 'ok', replay: true, charge_id: COBRANCA, situacao: 'criada', valor_cents: 13323, clinica_cents: 11325, wallet_id: 'wal_teste', referencia: COBRANCA, descricao: 'IMED · agendamento 11111111', provedor_cobranca_id: null };
  const c = cenario({ banco: { pag_charge_open: aberta }, provedor: {
    buscarPorReferencia: async () => ({ id: 'pay_antiga', foto: { situacao: 'aguardando', valor_cents: 13323, tarifa_cents: null, devolvido_cents: 0, paga_em: null, provedor_estorno_id: null } }),
  } });
  const r = await c.chamar(pedido());
  assert.equal((r.corpo.payment as { pix_copia_cola: string }).pix_copia_cola, '00020126-copia-e-cola-antiga');
  assert.deepEqual(c.noProvedor.map((x) => x.op), ['copiaCola'], 'nenhuma cobrança nova');
  assert.equal(c.chamadas.at(-1)?.args.p_provedor_id, 'pay_antiga');
});

test('"já paguei" (conferir): acha a cobrança pelo código, consulta o provedor e aplica a situação consultada', async () => {
  const c = cenario();
  const r = await c.chamar({ action: 'conferir', id: ID, token: TOKEN });
  assert.deepEqual(r.corpo, { ok: true, status: 'ok', situacao: 'aprovada', request_status: 'confirmed' });
  assert.deepEqual(fns(c), ['pag_charge_lookup', 'pag_sync_apply']);
  assert.deepEqual(c.chamadas[0].args, { p_request: ID, p_token: TOKEN });
  assert.equal((c.chamadas[1].args.p_foto as Foto).situacao, 'paga', 'a foto é a consultada, nunca algo vindo do navegador');
  assert.equal(c.turnstile.length, 0, 'conferir não cria nada: não gasta o Turnstile');
  const errado = cenario({ banco: { pag_charge_lookup: { status: 'not_found' } } });
  assert.deepEqual((await errado.chamar({ action: 'conferir', id: ID, token: 'b'.repeat(64) })).corpo, { ok: false, status: 'not_found' });
  assert.deepEqual(errado.noProvedor, []);
  const fora = cenario({ provedor: { consultar: async () => { throw new ErroProvedor(503, 'fora_do_ar'); } } });
  assert.deepEqual([(await fora.chamar({ action: 'conferir', id: ID, token: TOKEN })).http], [502]);
  assert.deepEqual((await cenario({ semProvedor: true }).chamar({ action: 'conferir', id: ID, token: TOKEN })).corpo, { ok: false, status: 'payments_not_configured' });
});

test('pedido malformado → 400; limite por IP em cada instância', async () => {
  const c = cenario();
  assert.deepEqual([(await c.chamar({})).http, (await c.chamar(pedido({ payer: { name: 'Maria', cpf: '1' } }))).http], [400, 400]);
  assert.deepEqual(c.chamadas, []);
  const l = cenario({ banco: { agenda_pay_hold: { status: 'payments_off' } } });
  const codigos = [];
  for (let i = 0; i < LIMITE.criar.max + 2; i++) codigos.push((await l.chamar(pedido())).http);
  assert.deepEqual(codigos, [...Array(LIMITE.criar.max).fill(200), 429, 429]);
  assert.equal((await l.chamar(pedido(), { ip: '198.51.100.9', autorizacao: '' })).http, 200, 'outro IP conta à parte');
});
