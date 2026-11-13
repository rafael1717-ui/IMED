// Testes da função "pagamento-clinica". Rodar com: node --experimental-strip-types --test supabase/functions/pagamento-clinica/lib.test.ts
// Banco e provedor simulados; o caminho com o banco de verdade está em tests/banco/pagamento-clinica.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Contagem, Fetch, Rpc } from '../_shared/base.ts';
import { criarRpcComo, ErroBanco } from '../_shared/base.ts';
import { criarAsaas } from '../_shared/asaas.ts';
import { ErroProvedor, type Carteira, type Provedor } from '../_shared/provedor.ts';
import { CARTEIRA_RE, lerPedido, LIMITE, termosEmVigor, TERMOS_RE, tratar, type Deps } from './lib.ts';

const CLINICA = '22222222-2222-4222-8222-222222222222';
const DONA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CARTEIRA = 'wal_teste_da_clinica_0001';
const TOKEN = 'Bearer tok-da-dona';
const pedido = (extra: Record<string, unknown> = {}) => ({ action: 'ligar', clinic: CLINICA, wallet: CARTEIRA, terms: 'v1', ...extra });
const AMBIENTE: Record<string, string> = { PAG_TERMOS_CLINICA: 'v1' };

// Banco simulado: responde como pag_clinic_status e pag_clinic_connect (formato da migração pagamentos_base_parte_4) e
// anota com QUAL sessão cada função foi chamada.
function cenario(o: { banco?: Record<string, unknown | ((a: Record<string, unknown>) => unknown)>; ambiente?: Record<string, string>; semProvedor?: boolean;
  carteira?: Carteira | Error; usuario?: string | null | Error } = {}) {
  const chamadas: { fn: string; args: Record<string, unknown>; como: string }[] = [];
  const noProvedor: string[] = [];
  const padrao: Record<string, unknown> = {
    pag_clinic_status: { status: 'ok', clinic_id: CLINICA, situacao: 'nao_ligada', pode_configurar: true, pode_estornar: true },
    pag_clinic_connect: { status: 'ok', situacao: 'em_conferencia' },
  };
  const rpcComo = (como: string): Rpc => async (fn, args = {}) => {
    chamadas.push({ fn, args, como });
    const r = o.banco && fn in o.banco ? o.banco[fn] : padrao[fn];
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? (r as (a: Record<string, unknown>) => unknown)(args) : r;
  };
  const provedor = {
    nome: 'asaas',
    conferirCarteira: async (w: string) => { noProvedor.push(w); if (o.carteira instanceof Error) throw o.carteira; return o.carteira ?? 'sem_como_saber'; },
  } as unknown as Provedor;
  const contagem: Contagem = new Map();
  const deps: Deps = {
    rpcComo, provedor: o.semProvedor ? null : provedor, env: (n) => (o.ambiente ?? AMBIENTE)[n], agora: () => 1_000_000,
    usuario: async () => { if (o.usuario instanceof Error) throw o.usuario; return o.usuario === undefined ? DONA : o.usuario; }, contagem,
  };
  return { deps, chamadas, noProvedor, contagem };
}
const quem = { ip: '203.0.113.7', autorizacao: TOKEN };

test('pedido: só as duas ações, clínica em uuid, carteira e versão dos termos no formato que o banco aceita', () => {
  assert.deepEqual(lerPedido(pedido()), { acao: 'ligar', clinica: CLINICA, carteira: CARTEIRA, termos: 'v1' });
  assert.deepEqual(lerPedido(pedido({ action: 'conferir', terms: undefined, extra: 'ignorado' })), { acao: 'conferir', clinica: CLINICA, carteira: CARTEIRA, termos: '' });
  assert.deepEqual(lerPedido(pedido({ wallet: `  ${CARTEIRA}  ` }))?.carteira, CARTEIRA, 'espaço em volta de quem colou');
  for (const ruim of [null, 'x', [], {}, pedido({ action: 'pausar' }), pedido({ action: 'conferir_conta' }), pedido({ clinic: 'abc' }), pedido({ wallet: 'curta' }), pedido({ wallet: 'com espaço no meio' }),
    pedido({ wallet: 'a'.repeat(81) }), pedido({ wallet: 12345678 }), pedido({ wallet: "x'; drop table--" }), pedido({ terms: '' }), pedido({ terms: 'V1' }), pedido({ terms: 'v 1' }), pedido({ terms: undefined })]) {
    assert.equal(lerPedido(ruim), null, JSON.stringify(ruim));
  }
  // as mesmas regras do banco (pag_clinic_connect)
  const sql = readFileSync(new URL(`../../migrations/${migracao()}`, import.meta.url), 'utf8');
  assert.ok(sql.includes(`coalesce(p_wallet, '') !~ '${CARTEIRA_RE.source}'`), 'carteira: a mesma regra do banco');
  assert.ok(sql.includes(`coalesce(p_termos_versao, '') !~ '${TERMOS_RE.source}'`), 'termos: a mesma regra do banco');
  assert.equal(termosEmVigor(() => undefined), null);
  assert.equal(termosEmVigor(() => ' v2 '), 'v2');
  assert.equal(termosEmVigor(() => 'Versão Um'), null, 'versão fora do formato não vale');
});
// A migração da P1 com as funções da clínica (o nome muda quando ela for aplicada: procura pelo sufixo).
function migracao(): string {
  const f = readdirSync(fileURLToPath(new URL('../../migrations/', import.meta.url))).find((x) => x.endsWith('_pagamentos_base_parte_4.sql'));
  assert.ok(f, 'migração *_pagamentos_base_parte_4.sql');
  return f;
}

test('fechada por padrão: sem o provedor recusa tudo antes do banco; "ligar" sem a versão dos termos também', async () => {
  const a = cenario({ semProvedor: true });
  for (const acao of ['conferir', 'ligar']) assert.deepEqual(await tratar(pedido({ action: acao }), quem, a.deps), { http: 503, corpo: { ok: false, status: 'provider_not_configured' } });
  assert.equal(a.chamadas.length, 0, 'o banco nem é consultado');
  const b = cenario({ ambiente: {} });
  assert.deepEqual(await tratar(pedido(), quem, b.deps), { http: 503, corpo: { ok: false, status: 'terms_not_configured' } });
  assert.equal(b.chamadas.length + b.noProvedor.length, 0);
  // conferir não aceita termos: funciona sem a versão configurada
  assert.equal((await tratar(pedido({ action: 'conferir' }), quem, b.deps)).http, 200);
  // a pessoa aceitou uma versão que não é a de hoje: nada é gravado e a resposta diz qual é a de hoje
  const c = cenario({ ambiente: { PAG_TERMOS_CLINICA: 'v2' } });
  assert.deepEqual(await tratar(pedido(), quem, c.deps), { http: 409, corpo: { ok: false, status: 'terms_outdated', termos: 'v2' } });
  assert.equal(c.chamadas.length + c.noProvedor.length, 0);
  assert.deepEqual(await tratar({ action: 'ligar' }, quem, cenario().deps), { http: 400, corpo: { ok: false, status: 'invalid' } });
});

test('sessão: sem token, com token que o Auth não reconhece ou com o Auth fora do ar, nada é consultado', async () => {
  for (const autorizacao of ['', 'tok-solto', 'Basic abc', 'Bearer ']) {
    const c = cenario();
    assert.deepEqual(await tratar(pedido(), { ip: '203.0.113.7', autorizacao }, c.deps), { http: 401, corpo: { ok: false, status: 'login_required' } });
    assert.equal(c.chamadas.length + c.noProvedor.length, 0);
  }
  const semConta = cenario({ usuario: null });
  assert.equal((await tratar(pedido(), quem, semConta.deps)).corpo.status, 'login_required');
  assert.equal(semConta.chamadas.length + semConta.noProvedor.length, 0);
  const authFora = cenario({ usuario: new Error('rede') });
  assert.deepEqual(await tratar(pedido(), quem, authFora.deps), { http: 503, corpo: { ok: false, status: 'unavailable' } });
});

test('permissão: quem decide é o banco, com a sessão de quem chamou; quem não é dono não chega ao provedor', async () => {
  for (const st of [{ status: 'forbidden' }, { status: 'ok', situacao: 'nao_ligada', pode_configurar: false }, { status: 'ok', situacao: 'ativa' }, 'lixo', null]) {
    const c = cenario({ banco: { pag_clinic_status: st } });
    assert.deepEqual(await tratar(pedido(), quem, c.deps), { http: 403, corpo: { ok: false, status: 'forbidden' } }, JSON.stringify(st));
    assert.deepEqual(c.chamadas, [{ fn: 'pag_clinic_status', args: { p_clinic: CLINICA }, como: TOKEN }], 'a pergunta vai com o token dela');
    assert.equal(c.noProvedor.length, 0, 'sem permissão, o meio de pagamento não é consultado');
  }
  const sus = cenario({ banco: { pag_clinic_status: { status: 'ok', situacao: 'suspensa', pode_configurar: true } } });
  assert.deepEqual(await tratar(pedido(), quem, sus.deps), { http: 409, corpo: { ok: false, status: 'suspended' } });
  assert.equal(sus.noProvedor.length, 0);
  // erros do banco: sessão vencida, sem permissão de execução, banco sem a função (migração não aplicada), fora do ar
  for (const [erro, http, status] of [[new ErroBanco(401, 'PGRST301'), 401, 'login_required'], [new ErroBanco(403, '42501'), 403, 'forbidden'],
    [new ErroBanco(404, 'PGRST202'), 503, 'not_available'], [new ErroBanco(500, 'erro'), 503, 'unavailable'], [new Error('rede'), 503, 'unavailable']] as const) {
    assert.deepEqual(await tratar(pedido(), quem, cenario({ banco: { pag_clinic_status: erro } }).deps), { http, corpo: { ok: false, status } });
  }
});

test('conferir: pergunta ao provedor e NÃO grava nada; a resposta só leva o final da carteira', async () => {
  const c = cenario();
  assert.deepEqual(await tratar(pedido({ action: 'conferir' }), quem, c.deps), { http: 200, corpo: { ok: true, status: 'ok', carteira: 'a_conferir', carteira_final: '0001' } });
  assert.deepEqual(c.chamadas.map((x) => x.fn), ['pag_clinic_status'], 'nenhuma gravação');
  assert.deepEqual(c.noProvedor, [CARTEIRA]);
  assert.equal((await tratar(pedido({ action: 'conferir' }), quem, cenario({ carteira: 'conferida' }).deps)).corpo.carteira, 'conferida');
  assert.deepEqual(await tratar(pedido({ action: 'conferir' }), quem, cenario({ carteira: 'propria' }).deps), { http: 422, corpo: { ok: false, status: 'own_wallet' } });
  assert.deepEqual(await tratar(pedido({ action: 'conferir' }), quem, cenario({ carteira: 'nao_existe' }).deps), { http: 422, corpo: { ok: false, status: 'wallet_not_found' } });
});

test('ligar: confere a carteira e grava carteira e aceite como a pessoa; a conta fica em conferência (nada é ativado)', async () => {
  const c = cenario();
  assert.deepEqual(await tratar(pedido(), quem, c.deps), { http: 200, corpo: { ok: true, status: 'ok', situacao: 'em_conferencia', unchanged: false, carteira: 'a_conferir', carteira_final: '0001' } });
  assert.deepEqual(c.chamadas, [
    { fn: 'pag_clinic_status', args: { p_clinic: CLINICA }, como: TOKEN },
    { fn: 'pag_clinic_connect', args: { p_clinic: CLINICA, p_wallet: CARTEIRA, p_termos_versao: 'v1' }, como: TOKEN },
  ]);
  assert.ok(!c.chamadas.some((x) => /admin_|pag_clinic_pause|chave_geral/.test(x.fn)), 'a função não ativa a conta, não liga a unidade nem a chave geral');
  // de novo, igual: o banco responde "sem mudança"
  const rep = cenario({ banco: { pag_clinic_connect: { status: 'ok', situacao: 'em_conferencia', unchanged: true } } });
  assert.equal((await tratar(pedido(), quem, rep.deps)).corpo.unchanged, true);
  // carteira recusada pelo provedor: nada é gravado
  for (const [carteira, status] of [['propria', 'own_wallet'], ['nao_existe', 'wallet_not_found']] as const) {
    const r = cenario({ carteira });
    assert.deepEqual(await tratar(pedido(), quem, r.deps), { http: 422, corpo: { ok: false, status } });
    assert.ok(!r.chamadas.some((x) => x.fn === 'pag_clinic_connect'), `${carteira}: nada gravado`);
  }
  // provedor fora do ar (não se sabe): nada é gravado e a pessoa tenta de novo; recusa do provedor: erro dele
  const fora = cenario({ carteira: new ErroProvedor(0, 'sem_resposta') });
  assert.deepEqual(await tratar(pedido(), quem, fora.deps), { http: 503, corpo: { ok: false, status: 'provider_unavailable' } });
  assert.ok(!fora.chamadas.some((x) => x.fn === 'pag_clinic_connect'));
  assert.deepEqual(await tratar(pedido(), quem, cenario({ carteira: new ErroProvedor(401, 'invalid_access_token') }).deps), { http: 502, corpo: { ok: false, status: 'provider_error' } });
  assert.deepEqual(await tratar(pedido(), quem, cenario({ carteira: new Error('qualquer') }).deps), { http: 503, corpo: { ok: false, status: 'provider_unavailable' } });
  // o que o banco responder na gravação
  for (const [st, http, status] of [['forbidden', 403, 'forbidden'], ['suspended', 409, 'suspended'], ['invalid', 400, 'invalid'], ['method_not_available', 400, 'method_not_available'], ['novidade', 500, 'erro']] as const) {
    assert.deepEqual(await tratar(pedido(), quem, cenario({ banco: { pag_clinic_connect: { status: st } } }).deps), { http, corpo: { ok: false, status } });
  }
  assert.deepEqual(await tratar(pedido(), quem, cenario({ banco: { pag_clinic_connect: new ErroBanco(500, 'erro') } }).deps), { http: 503, corpo: { ok: false, status: 'unavailable' } });
});

test('limites: por pessoa (e por IP), antes de consultar o banco e o provedor', async () => {
  const c = cenario();
  for (let i = 0; i < LIMITE.ligar.max; i++) assert.equal((await tratar(pedido(), quem, c.deps)).http, 200, `tentativa ${i + 1}`);
  const n = c.chamadas.length;
  assert.deepEqual(await tratar(pedido(), quem, c.deps), { http: 429, corpo: { ok: false, status: 'too_many', tentar_em_s: 600 } });
  assert.equal(c.chamadas.length, n, 'acima do limite, nada é consultado');
  // "conferir" tem a contagem dele
  assert.equal((await tratar(pedido({ action: 'conferir' }), quem, c.deps)).http, 200);
  // outra pessoa no mesmo IP ainda passa (até o limite do IP, 3 vezes maior)
  const outra = { ...c.deps, usuario: async () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  assert.equal((await tratar(pedido(), quem, outra)).http, 200);
});

test('o banco como a pessoa: a chave publishable no apikey e o token DELA em Authorization; sem token, nada é chamado', async () => {
  const pedidos: { url: string; init?: RequestInit }[] = [];
  const f: Fetch = async (url, init) => { pedidos.push({ url, init }); return new Response(JSON.stringify({ status: 'ok' }), { status: 200 }); };
  const como = criarRpcComo(f, 'http://banco.teste', { key: 'sb_publishable_teste', legacy: false });
  assert.deepEqual(await como(TOKEN)('pag_clinic_status', { p_clinic: CLINICA }), { status: 'ok' });
  assert.equal(pedidos[0].url, 'http://banco.teste/rest/v1/rpc/pag_clinic_status');
  const h = pedidos[0].init?.headers as Record<string, string>;
  assert.equal(h.apikey, 'sb_publishable_teste');
  assert.equal(h.Authorization, TOKEN);
  assert.equal(pedidos[0].init?.body, JSON.stringify({ p_clinic: CLINICA }));
  for (const sem of ['', 'tok', 'Bearer ']) await assert.rejects(como(sem)('pag_clinic_status'), /sem_chave/);
  await assert.rejects(criarRpcComo(f, 'http://banco.teste', null)(TOKEN)('x'), /sem_chave/);
  assert.equal(pedidos.length, 1);
  const ruim: Fetch = async () => new Response(JSON.stringify({ code: '42501', message: 'permission denied for function, usuária Fulana' }), { status: 403 });
  await assert.rejects(criarRpcComo(ruim, 'http://banco.teste', { key: 'k', legacy: false })(TOKEN)('x'), (e: unknown) => {
    assert.ok(e instanceof ErroBanco && e.codigo === '42501' && !e.message.includes('Fulana'));
    return true;
  });
});

test('adaptador do Asaas, carteira: só sabe dizer "é a do próprio IMED" ou "não dá para saber"; nunca cria cobrança', async () => {
  const pedidos: { metodo: string; caminho: string }[] = [];
  const com = (resposta: () => Response): Provedor => criarAsaas({ url: 'http://provedor.teste', chave: 'chave-de-teste' }, async (url, init) => {
    pedidos.push({ metodo: String(init?.method), caminho: url.replace('http://provedor.teste', '') });
    return resposta();
  });
  const lista = (ids: string[]) => () => new Response(JSON.stringify({ object: 'list', data: ids.map((id) => ({ object: 'wallet', id })) }), { status: 200 });
  assert.equal(await com(lista(['wal_do_imed_0001'])).conferirCarteira('wal_do_imed_0001'), 'propria');
  assert.equal(await com(lista(['wal_do_imed_0001'])).conferirCarteira(CARTEIRA), 'sem_como_saber', 'carteira de outra conta: o adaptador não afirma que existe');
  assert.equal(await com(() => new Response('{}', { status: 200 })).conferirCarteira(CARTEIRA), 'sem_como_saber', 'resposta em outro formato');
  assert.equal(await com(() => new Response(JSON.stringify({ errors: [{ code: 'not_found' }] }), { status: 404 })).conferirCarteira(CARTEIRA), 'sem_como_saber', 'o endpoint suposto não existe');
  await assert.rejects(com(() => new Response(JSON.stringify({ errors: [{ code: 'invalid_access_token' }] }), { status: 401 })).conferirCarteira(CARTEIRA), (e: unknown) => e instanceof ErroProvedor && e.definitivo);
  await assert.rejects(com(() => new Response('', { status: 503 })).conferirCarteira(CARTEIRA), (e: unknown) => e instanceof ErroProvedor && !e.definitivo);
  assert.ok(pedidos.length >= 6 && pedidos.every((p) => p.metodo === 'GET' && p.caminho === '/v3/wallets/'), 'só leitura: nenhuma cobrança, nenhum cliente');
  const fonte = readFileSync(new URL('../_shared/asaas.ts', import.meta.url), 'utf8');
  const trecho = fonte.slice(fonte.indexOf('async conferirCarteira'));
  assert.doesNotMatch(trecho, /'conferida'|'nao_existe'|POST|\/v3\/payments/, 'o adaptador não afirma o que o Asaas ainda não confirmou e não cria nada');
  assert.match(fonte, /A CONFERIR NO AMBIENTE DE TESTES \(pergunta S3/);
});

test('a função não usa a chave secreta do projeto e não registra o que a pessoa mandou', () => {
  const idx = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const lib = readFileSync(new URL('./lib.ts', import.meta.url), 'utf8');
  const semComentario = (t: string) => t.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(semComentario(idx), /secretKey|criarRpc\(|SECRET/, 'index.ts: nada com a chave secreta');
  assert.doesNotMatch(semComentario(lib), /secretKey|SECRET|console\./, 'lib.ts: sem chave secreta e sem registro');
  assert.match(idx, /const rpcComo = criarRpcComo\(fetch, SUPABASE_URL, PUBLIC_KEY\);/);
  const pos = ['origin_not_allowed', 'method_not_allowed', 'unauthorized', 'invalid_json'].map((s) => idx.indexOf(`'${s}'`));
  assert.ok(pos.every((p, i) => p > 0 && (i === 0 || p > pos[i - 1])), `travas na ordem (origem, método, chave, corpo): ${pos.join(', ')}`);
  // a permissão vem antes do provedor; o provedor, antes de gravar
  const t = semComentario(lib);
  const ordem = ["rpc('pag_clinic_status'", 'd.provedor.conferirCarteira(', "rpc('pag_clinic_connect'"].map((s) => t.indexOf(s));
  assert.ok(ordem.every((p, i) => p > 0 && (i === 0 || p > ordem[i - 1])), `permissão → provedor → gravar: ${ordem.join(', ')}`);
  assert.deepEqual([...new Set([...t.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]))].sort(), ['pag_clinic_connect', 'pag_clinic_status'], 'só estas duas funções do banco');
});
