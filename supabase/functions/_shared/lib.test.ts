// Testes das peças comuns do pagamento (base.ts), da camada do provedor (provedor.ts) e do adaptador do Asaas (asaas.ts).
// Rodar com: node --experimental-strip-types --test supabase/functions/_shared/lib.test.ts
// Tudo simulado: nenhum pedido sai desta máquina. As "chaves" são textos de teste, sem formato de chave de verdade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chaveDoSite, chavesDoSite, cpfValido, criarRpc, ErroBanco, hmacHex, horarioPego, limitado, origemPermitida, origensPadrao, sha256Hex, tempoConstante,
  type Contagem, type Fetch,
} from './base.ts';
import { avisoDoAsaas, criarAsaas, fotoDoAsaas, leitorAsaas } from './asaas.ts';
import { centavos, codigoDoErro, criarLeitor, criarProvedor, diaSP, ErroProvedor, reais, SITUACOES } from './provedor.ts';

const VETORES = JSON.parse(readFileSync(new URL('../../../tests/pagamento-vetores.json', import.meta.url), 'utf8'));
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const cab = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

test('CPF: os mesmos casos do site (tests/pagamento-vetores.json)', () => {
  for (const c of VETORES.cpf_validos) assert.equal(cpfValido(c), true, c);
  for (const c of VETORES.cpf_invalidos) assert.equal(cpfValido(c), false, c);
  assert.equal(cpfValido(null), false);
  assert.equal(cpfValido(52998224725), true, 'número também serve');
});

test('comparação em tempo constante: só o texto igual passa; vazio e tipos estranhos nunca', () => {
  assert.equal(tempoConstante('segredo-de-teste-com-mais-de-32-letras', 'segredo-de-teste-com-mais-de-32-letras'), true);
  assert.equal(tempoConstante('segredo-de-teste-com-mais-de-32-letras', 'segredo-de-teste-com-mais-de-32-letraX'), false);
  assert.equal(tempoConstante('segredo', 'segredo-maior'), false, 'tamanhos diferentes');
  assert.equal(tempoConstante('', ''), false, 'vazio nunca passa');
  assert.equal(tempoConstante(null, null), false);
  assert.equal(tempoConstante(undefined, 'x'), false);
});

test('SHA-256 e HMAC: 64 letras hexadecimais; o HMAC muda com a chave e não contém o CPF', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const a = await hmacHex('chave-de-teste-um-com-32-caracteres!!', '52998224725');
  const b = await hmacHex('chave-de-teste-dois-com-32-caracteres!', '52998224725');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.equal(a, await hmacHex('chave-de-teste-um-com-32-caracteres!!', '52998224725'), 'o mesmo CPF dá o mesmo resumo (não duplica o pagador)');
  assert.ok(!a.includes('52998224725'));
});

test('origem e limite por IP', () => {
  const o = origensPadrao('https://conta.github.io/SITE/', ['https://antiga.github.io/site/']);
  assert.deepEqual(o.slice(0, 2), ['https://conta.github.io', 'https://antiga.github.io']);
  assert.equal(origemPermitida('https://conta.github.io', o), true);
  assert.equal(origemPermitida('https://outro.exemplo', o), false);
  assert.equal(origemPermitida(null, o), true, 'sem Origin (servidor): a trava é a de cada função');
  const c: Contagem = new Map();
  const r = Array.from({ length: 5 }, () => limitado(c, 'ip', 1000, 3, 60_000));
  assert.deepEqual(r, [false, false, false, true, true]);
  assert.equal(limitado(c, 'ip', 1000 + 60_001, 3, 60_000), false, 'janela nova');
  assert.equal(limitado(c, 'outro', 1000, 3, 60_000), false);
});

test('chave do site: sempre conferida (sem chave publishable no ambiente, ninguém passa)', () => {
  const env = (v: Record<string, string>) => (n: string) => v[n];
  assert.deepEqual(chavesDoSite(env({})), []);
  assert.equal(chaveDoSite(cab({ apikey: 'qualquer' }), []), false);
  const chaves = chavesDoSite(env({ SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_teste"}' }));
  assert.deepEqual(chaves, ['sb_publishable_teste']);
  assert.equal(chaveDoSite(cab({ apikey: 'sb_publishable_teste' }), chaves), true);
  assert.equal(chaveDoSite(cab({ apikey: 'sb_publishable_outra' }), chaves), false);
  assert.equal(chaveDoSite(cab({ authorization: ['Bearer', chaves[0]].join(' ') }), chaves), false, 'a chave nova nunca vale em Authorization');
});

test('banco: a chave secreta vai só no apikey; erro vira só o código', async () => {
  const pedidos: { url: string; init?: RequestInit }[] = [];
  const ok: Fetch = async (url, init) => { pedidos.push({ url, init }); return reply({ status: 'ok' }); };
  const rpc = criarRpc(ok, 'http://banco.teste', { key: 'sb_secret_teste', legacy: false });
  assert.deepEqual(await rpc('pag_due', { a: 1 }), { status: 'ok' });
  assert.equal(pedidos[0].url, 'http://banco.teste/rest/v1/rpc/pag_due');
  const h = pedidos[0].init?.headers as Record<string, string>;
  assert.equal(h.apikey, 'sb_secret_teste');
  assert.equal(h.Authorization, undefined);
  assert.equal(pedidos[0].init?.body, '{"a":1}');
  const ruim: Fetch = async () => reply({ code: '23P01', message: 'conflito com o paciente Fulano', details: 'dados' }, 409);
  await assert.rejects(criarRpc(ruim, 'http://banco.teste', { key: 'k', legacy: false })('x'), (e: unknown) => {
    assert.ok(e instanceof ErroBanco);
    assert.equal(e.codigo, '23P01');
    assert.ok(!e.message.includes('Fulano'), 'a mensagem do banco não sai junto');
    assert.equal(horarioPego(e), true);
    return true;
  });
  await assert.rejects(criarRpc(ok, 'http://banco.teste', null)('x'), /sem_chave/);
  assert.equal(horarioPego(new ErroBanco(500, 'erro')), false);
});

test('provedor: sem a chave ou sem o endereço nos segredos, não existe (nenhum endereço fixo no código)', () => {
  const env = (v: Record<string, string>) => (n: string) => v[n];
  const f: Fetch = async () => reply({});
  assert.equal(criarProvedor(env({}), f), null);
  assert.equal(criarProvedor(env({ ASAAS_API_KEY: 'chave-de-teste' }), f), null, 'sem o endereço');
  assert.equal(criarProvedor(env({ ASAAS_API_URL: 'http://127.0.0.1:1' }), f), null, 'sem a chave');
  assert.equal(criarProvedor(env({ ASAAS_API_KEY: 'chave-de-teste', ASAAS_API_URL: 'endereco-sem-http' }), f), null);
  assert.equal(criarProvedor(env({ ASAAS_API_KEY: 'chave-de-teste', ASAAS_API_URL: 'http://127.0.0.1:1', PAG_PROVEDOR: 'outro' }), f), null);
  assert.equal(criarProvedor(env({ ASAAS_API_KEY: 'chave-de-teste', ASAAS_API_URL: 'http://127.0.0.1:1/' }), f)?.nome, 'asaas');
  assert.equal(criarLeitor(env({}))?.nome, 'asaas', 'o leitor de avisos não precisa da chave');
  assert.equal(criarLeitor(env({ PAG_PROVEDOR: 'outro' })), null);
  for (const arq of ['provedor.ts', 'asaas.ts', 'base.ts']) {
    const t = readFileSync(new URL(`./${arq}`, import.meta.url), 'utf8');
    assert.doesNotMatch(t, /https?:\/\/[a-z0-9.-]*asaas/i, `${arq}: nenhum endereço do meio de pagamento no código`);
  }
});

test('centavos e reais, dia de São Paulo e código de erro', () => {
  assert.equal(reais(13323), 133.23);
  assert.equal(centavos(133.23), 13323);
  assert.equal(centavos('99.9'), 9990);
  assert.equal(centavos(0.07), 7);
  for (let c = 1; c < 30000; c += 37) assert.equal(centavos(reais(c)), c, `ida e volta de ${c} centavos`);
  assert.equal(diaSP(Date.parse('2026-11-12T02:30:00Z')), '2026-11-11', '23:30 em São Paulo ainda é o dia anterior');
  assert.equal(diaSP(Date.parse('2026-11-12T03:00:00Z')), '2026-11-12');
  assert.equal(codigoDoErro(new ErroProvedor(400, 'invalid_refund_value')), 'invalid_refund_value');
  assert.equal(codigoDoErro(new ErroProvedor(400, 'Erro com CPF 52998224725!')), 'erro_com_cpf_n', 'número comprido nunca vai para o banco');
  assert.equal(codigoDoErro(new Error('qualquer')), 'erro_no_envio');
  assert.equal(new ErroProvedor(400, 'x').definitivo, true);
  for (const s of [0, 408, 429, 500, 503]) assert.equal(new ErroProvedor(s, 'x').definitivo, false, `HTTP ${s}: não se sabe se aconteceu`);
});

test('Asaas → foto neutra: situações conhecidas; a desconhecida não é adivinhada', () => {
  const p = (o: Record<string, unknown>) => fotoDoAsaas({ id: 'pay_1', value: 200, netValue: 198.01, ...o });
  assert.deepEqual(p({ status: 'PENDING' }), { situacao: 'aguardando', valor_cents: 20000, tarifa_cents: null, devolvido_cents: 0, paga_em: null, provedor_estorno_id: null });
  assert.equal(p({ status: 'OVERDUE' }).situacao, 'aguardando');
  assert.deepEqual(p({ status: 'RECEIVED', paymentDate: '2026-11-11' }), { situacao: 'paga', valor_cents: 20000, tarifa_cents: 199, devolvido_cents: 0, paga_em: '2026-11-11', provedor_estorno_id: null });
  assert.equal(p({ status: 'CONFIRMED' }).situacao, 'paga');
  assert.equal(p({ status: 'RECEIVED', refundedValue: 50 }).situacao, 'devolvida_parcial');
  assert.equal(p({ status: 'RECEIVED', refundedValue: 50 }).devolvido_cents, 5000);
  assert.deepEqual([p({ status: 'REFUNDED', refundedValue: 200, refunds: [{ id: 'est_1' }, { id: 'est_2' }] })].map((f) => [f.situacao, f.provedor_estorno_id]), [['devolvida', 'est_2']]);
  assert.equal(p({ status: 'PENDING', deleted: true }).situacao, 'apagada');
  assert.equal(p({ status: 'RECEIVED', deleted: true }).situacao, 'paga', 'apagada e paga: vale o dinheiro');
  for (const s of ['CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL']) assert.equal(p({ status: s }).situacao, 'contestada');
  assert.throws(() => p({ status: 'ALGUMA_NOVA' }), /situacao_desconhecida/);
  assert.throws(() => fotoDoAsaas(null), /resposta_invalida/);
  assert.throws(() => fotoDoAsaas({ value: 1 }), /resposta_invalida/);
  assert.ok(SITUACOES.includes(p({ status: 'RECEIVED' }).situacao));
});

test('Asaas: aviso lido só com o que guardamos (id, tipo, cobrança, situação, valor, quando)', () => {
  const a = avisoDoAsaas({ id: 'evt_1', event: 'PAYMENT_RECEIVED', dateCreated: '2026-11-11 10:00:00', payment: { id: 'pay_1', status: 'RECEIVED', value: 133.23, customer: 'cus_1', description: 'x' } });
  assert.deepEqual(Object.keys(a ?? {}).sort(), ['cobrancaId', 'id', 'ocorridoEm', 'situacao', 'tipo', 'valorCents']);
  assert.equal(a?.cobrancaId, 'pay_1');
  assert.equal(a?.valorCents, 13323);
  assert.equal(avisoDoAsaas({ id: 'evt_2', event: 'OUTRA_COISA' })?.cobrancaId, null, 'aviso que não é de cobrança');
  for (const ruim of [null, 'x', {}, { id: 'evt' }, { event: 'X' }, { id: '', event: 'X' }]) assert.equal(avisoDoAsaas(ruim), null);
  assert.equal(leitorAsaas.segredoDoAviso(cab({ 'asaas-access-token': 'abc' })), 'abc');
  assert.equal(leitorAsaas.segredoDoAviso(cab({})), '');
});

// Um "Asaas" mínimo, em memória, só para conferir o que o adaptador manda.
function falso() {
  const pedidos: { metodo: string; caminho: string; corpo: unknown; cabecalhos: Record<string, string> }[] = [];
  const st = { apagar: 'ok' as 'ok' | 'paga', fora: false, paginas: 1 };
  const f: Fetch = async (url, init) => {
    const u = new URL(url);
    const corpo = init?.body ? JSON.parse(String(init.body)) : null;
    pedidos.push({ metodo: init?.method ?? 'GET', caminho: u.pathname + u.search, corpo, cabecalhos: init?.headers as Record<string, string> });
    if (st.fora) throw new TypeError('fetch failed');
    if (u.pathname === '/v3/customers') return reply({ id: 'cus_000001' });
    if (u.pathname === '/v3/payments' && init?.method === 'POST') return reply({ id: 'pay_000001', status: 'PENDING', value: corpo.value });
    if (u.pathname === '/v3/payments' && u.searchParams.has('externalReference')) {
      return reply({ data: u.searchParams.get('externalReference') === 'ref-1' ? [{ id: 'pay_000009', status: 'PENDING', value: 10, externalReference: 'ref-1' }] : [] });
    }
    if (u.pathname === '/v3/payments') {
      const off = Number(u.searchParams.get('offset'));
      return reply({ hasMore: off / 100 + 1 < st.paginas, data: [{ id: `pay_p${off}`, status: 'RECEIVED', value: 100, netValue: 98.01, split: [{ walletId: 'w', fixedValue: 85 }] }] });
    }
    if (u.pathname.endsWith('/pixQrCode')) return reply({ payload: '00020126-copia-e-cola', encodedImage: 'x', expirationDate: '2027-11-11' });
    if (u.pathname.endsWith('/refund')) return reply({ id: 'pay_000001', status: 'REFUNDED', value: 100, netValue: 98.01, refundedValue: 100, refundId: 'est_000001' });
    if (init?.method === 'DELETE') return st.apagar === 'ok' ? reply({ deleted: true, id: 'pay_000001' }) : reply({ errors: [{ code: 'ja_paga', description: 'Cobrança de Fulano de Tal já paga' }] }, 400);
    return reply({ id: 'pay_000001', status: 'RECEIVED', value: 100, netValue: 98.01, paymentDate: '2026-11-11' });
  };
  return { f, pedidos, st, prov: criarAsaas({ url: 'http://asaas.teste', chave: 'chave-de-teste' }, f) };
}

test('Asaas: o que vai na criação é só o da lista (§6.3): pagador sem telefone nem e-mail; cobrança sem exame nem data', async () => {
  const { prov, pedidos } = falso();
  assert.equal(await prov.criarCliente({ nome: 'Maria Pagadora', cpf: '52998224725' }), 'cus_000001');
  assert.deepEqual(pedidos[0].corpo, { name: 'Maria Pagadora', cpfCnpj: '52998224725', notificationDisabled: true });
  assert.equal(pedidos[0].cabecalhos.access_token, 'chave-de-teste');
  assert.ok(!pedidos[0].caminho.includes('chave-de-teste'), 'a chave nunca vai no endereço');
  const c = await prov.criarCobranca({ referencia: 'ref-uuid', valorCents: 13323, clinicaCents: 11325, walletId: 'wal_teste', descricao: 'IMED · agendamento ABCDEF12', clienteId: 'cus_000001', vencimento: '2026-11-11' });
  assert.deepEqual(c, { id: 'pay_000001', copiaCola: '00020126-copia-e-cola' });
  assert.deepEqual(pedidos[1].corpo, {
    customer: 'cus_000001', billingType: 'PIX', value: 133.23, dueDate: '2026-11-11', description: 'IMED · agendamento ABCDEF12',
    externalReference: 'ref-uuid', split: [{ walletId: 'wal_teste', fixedValue: 113.25 }],
  });
  assert.equal(pedidos[2].caminho, '/v3/payments/pay_000001/pixQrCode');
});

test('Asaas: consultar, achar pela referência, apagar (apagada, ou paga se o provedor recusar) e listar com páginas', async () => {
  const { prov, pedidos, st } = falso();
  assert.equal((await prov.consultar('pay_000001')).situacao, 'paga');
  assert.equal((await prov.buscarPorReferencia('ref-1'))?.id, 'pay_000009');
  assert.equal(await prov.buscarPorReferencia('ref-2'), null);
  assert.equal((await prov.apagar('pay_000001')).situacao, 'apagada');
  st.apagar = 'paga';
  assert.equal((await prov.apagar('pay_000001')).situacao, 'paga', 'recusou apagar: vale a situação consultada');
  st.paginas = 3;
  const linhas = await prov.listar('2026-11-10');
  assert.deepEqual(linhas.map((l) => l.provedor_cobranca_id), ['pay_p0', 'pay_p100', 'pay_p200']);
  assert.deepEqual(linhas[0], { provedor_cobranca_id: 'pay_p0', situacao: 'paga', valor_cents: 10000, repasse_cents: 8500, tarifa_cents: 199, devolvido_cents: 0 });
  assert.ok(pedidos.at(-1)?.caminho.startsWith('/v3/payments?dateCreated=2026-11-10&offset=200'));
});

test('Asaas: devolução total (sem valor) e parcial (com valor e a parte da clínica); a chave vai no cabeçalho', async () => {
  const { prov, pedidos } = falso();
  const total = await prov.devolver('pay_000001', { valorCents: 10000, clinicaCents: 8500, walletId: 'wal_teste', total: true, chave: 'chave-idem-1' });
  assert.deepEqual([total.estornoId, total.foto.situacao], ['est_000001', 'devolvida']);
  assert.deepEqual(pedidos[0].corpo, { splitRefunds: [{ walletId: 'wal_teste', value: 85 }] });
  assert.equal(pedidos[0].cabecalhos['x-chave-idempotencia'], 'chave-idem-1');
  await prov.devolver('pay_000001', { valorCents: 3333, clinicaCents: 2834, walletId: 'wal_teste', total: false, chave: 'chave-idem-2' });
  assert.deepEqual(pedidos[1].corpo, { value: 33.33, splitRefunds: [{ walletId: 'wal_teste', value: 28.34 }] });
  await prov.devolver('pay_000001', { valorCents: 10000, clinicaCents: 0, walletId: null, total: true, chave: 'chave-idem-3' });
  assert.deepEqual(pedidos[2].corpo, {}, 'devolução integral do que chegou: nada da carteira da clínica');
});

test('Asaas: erro vira só o código; fora do ar não é "definitivo" (não se sabe se aconteceu)', async () => {
  const { prov, st } = falso();
  st.fora = true;
  await assert.rejects(prov.consultar('pay_000001'), (e: unknown) => e instanceof ErroProvedor && e.codigo === 'sem_resposta' && !e.definitivo);
  await assert.rejects(prov.apagar('pay_000001'), (e: unknown) => e instanceof ErroProvedor && !e.definitivo, 'fora do ar: apagar não inventa situação');
  const recusa: Fetch = async () => reply({ errors: [{ code: 'invalid_split', description: 'Carteira de Fulano de Tal inválida' }] }, 400);
  await assert.rejects(criarAsaas({ url: 'http://asaas.teste', chave: 'k' }, recusa).criarCliente({ nome: 'A', cpf: '1' }), (e: unknown) => {
    assert.ok(e instanceof ErroProvedor && e.definitivo);
    assert.equal(e.codigo, 'invalid_split');
    assert.ok(!e.message.includes('Fulano'), 'a descrição do erro (pode citar o pagador) não sai junto');
    return true;
  });
  const estranho: Fetch = async () => reply({ id: 'x' });
  await assert.rejects(criarAsaas({ url: 'http://asaas.teste', chave: 'k' }, estranho).criarCliente({ nome: 'A', cpf: '1' }), /resposta_invalida/);
});
