// Teste de ponta a ponta da parte "Pagamentos on-line" do painel de gestão (iMed Pagamentos, fase P2b), num navegador
// de verdade (Playwright), com o Supabase simulado. O banco de mentira responde como as funções admin_pag_resumo,
// admin_pag_lista, admin_pag_conciliacao e admin_pag_chave_geral da P1 (formato da migração pagamentos_base_parte_4).
// Estados: banco sem as funções (a produção de hoje), tudo desligado e vazio, com cobranças e diferenças, a chave geral
// (ligar e desligar com confirmação), erros com "Tentar de novo", conta sem a permissão; computador, celular (360 px),
// teclado, tema escuro e, com o axe-core por perto, acessibilidade.
// TODOS os valores e nomes daqui são SIMULADOS (não são movimento, taxa nem clínica de verdade).
// Rodar: node tests/e2e-gestao-pagamentos.mjs   (E2E_PORT muda a porta; SHOTS=pasta salva capturas; ONLY="trecho";
//        AXE_PATH=<pasta>/node_modules/axe-core; FOTOS=pasta grava as fotos em 2x)
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, vigiarChaves } from './regra-chaves.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const FOTOS = process.env.FOTOS || '';
const ONLY = process.env.ONLY || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const PORT = Number(process.env.E2E_PORT) || 8797;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try { res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); } catch { res.writeHead(404).end('não encontrado'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;
for (const d of [SHOTS, FOTOS]) if (d) await mkdir(d, { recursive: true });

function findAxe() {
  const tries = [];
  if (process.env.AXE_PATH) {
    const p = resolve(process.env.AXE_PATH);
    tries.push(() => require.resolve(p));
    tries.push(() => createRequire(join(p, 'noop.js')).resolve('axe-core'));
  }
  tries.push(() => require.resolve('axe-core'));
  for (const t of tries) {
    try { const f = t(); if (f && existsSync(f)) { const min = join(dirname(f), 'axe.min.js'); return existsSync(min) ? min : f; } } catch { /* próximo */ }
  }
  return null;
}
const AXE = findAxe();

/* ======================= dados simulados (nenhum dado real) ======================= */
const NOW = '2026-11-13T15:00:00Z'; // sexta-feira, 12:00 em São Paulo
const USER_ID = 'uuuuuuuu-0000-4000-8000-000000000001';
const CA = 'cccccccc-0000-4000-8000-00000000000a';
const CB = 'cccccccc-0000-4000-8000-00000000000b';
const PEDIDO = 'eeeeeeee-0000-4000-8000-000000000001';   // id de agendamento: a função manda, a tela nunca mostra
const C = (n, criado, clinica, situacao, valor, o = {}) => {
  const taxa = Math.floor((valor * 1500) / 10000);
  const paga = ['aprovada', 'devolvida', 'devolvida_parcial', 'contestada'].includes(situacao);
  return { id: `${String(n).repeat(8)}-0000-4000-8000-00000000000${n}`, criado_em: criado, clinic_id: clinica, clinic_name: clinica === CA ? 'Clínica Simulada A' : 'Clínica Simulada B', finalidade: 'agendamento', meio: 'pix',
    situacao, valor_cents: valor, taxa_cents: taxa, clinica_cents: valor - taxa, tarifa_meio_cents: paga ? 199 : null, devolvido_cents: 0, paga_em: paga ? criado.replace(':00+', ':45+') : null, tentativa: 1, request_id: PEDIDO, fee_bps: 1500, ...o };
};
const COBRANCAS = () => [
  C(4, '2026-11-13T14:50:00+00:00', CB, 'aguardando', 45000),
  C(1, '2026-11-12T12:30:00+00:00', CA, 'aprovada', 13323),
  C(2, '2026-11-11T18:05:00+00:00', CA, 'devolvida', 20000, { devolvido_cents: 20000 }),
  C(3, '2026-11-10T13:00:00+00:00', CB, 'expirada', 9000, { tentativa: 2 }),
  C(5, '2026-10-20T15:00:00+00:00', CA, 'aprovada', 64000),
];
const RODADAS = () => [
  { id: 'r2', dia: '2026-11-12', janela: 'd1', comecou: '2026-11-13T07:17:00+00:00', terminou: '2026-11-13T07:17:03+00:00', situacao: 'concluida', contadores: { linhas: 2, pagas_aqui: 1, achadas: 2, novas: 2, criticas: 1, por_tipo: { falta_aqui: 1, tarifa: 1 } } },
  { id: 'r1', dia: '2026-11-11', janela: 'd1', comecou: '2026-11-12T07:17:00+00:00', terminou: '2026-11-12T07:17:02+00:00', situacao: 'concluida', contadores: { linhas: 1, pagas_aqui: 1, achadas: 1, novas: 1, criticas: 0, por_tipo: { situacao: 1 } } },
];
const DIFERENCAS = () => [
  { id: 7, tipo: 'falta_aqui', gravidade: 'critica', critica: true, criado_em: '2026-11-13T07:17:01+00:00', charge_id: null, provedor_cobranca_id: 'pay_simulado_0009', nosso: null, deles: { situacao: 'paga', valor_cents: 20000 }, resolvida_em: null, resolucao: null, dia: '2026-11-12' },
  { id: 8, tipo: 'tarifa', gravidade: 'informativa', critica: false, criado_em: '2026-11-13T07:17:02+00:00', charge_id: '11111111-0000-4000-8000-000000000001', provedor_cobranca_id: 'pay_simulado_0001', nosso: { tarifa_cents: 199 }, deles: { tarifa_cents: 99 }, resolvida_em: null, resolucao: null, dia: '2026-11-12' },
  { id: 5, tipo: 'situacao', gravidade: 'alta', critica: false, criado_em: '2026-11-12T07:17:01+00:00', charge_id: '22222222-0000-4000-8000-000000000002', provedor_cobranca_id: 'pay_simulado_0002', nosso: { situacao: 'aprovada', devolvido_cents: 0 }, deles: { situacao: 'devolvida', devolvido_cents: 20000 }, resolvida_em: '2026-11-12T13:00:00+00:00', resolucao: 'devolucao_conferida', dia: '2026-11-11' },
];
const CHEIO = () => ({ ligada: true, charges: COBRANCAS(), runs: RODADAS(), diffs: DIFERENCAS(), contas: { ativa: 2, em_conferencia: 1 }, avisos: 1 });

const clone = (x) => JSON.parse(JSON.stringify(x));
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
const NOFN = (fn) => ({ code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` });
const diaSP = (iso) => new Date(Date.parse(iso) - 3 * 3600000).toISOString().slice(0, 10);
const dias = (a, b) => (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000;

// As funções admin_pag_* de mentira, com as regras do contrato (permissão, período, motivo em código).
function pagRpc(fn, body, db) {
  const p = db.pag;
  if (!/^admin_pag_/.test(fn)) return undefined;
  if (p.delay?.[fn]) return { espera: p.delay[fn], ...pagRpc(fn, body, { ...db, pag: { ...p, delay: null } }) };
  if (p.missing) return { http: 404, body: NOFN(fn) };
  if (p.erro?.[fn]) return { http: p.erro[fn].status, body: p.erro[fn].body };
  if (!db.admin || p.semPermissao) return { body: { status: 'forbidden' } };
  const noPeriodo = (iso) => { const d = diaSP(iso); return d >= body.p_de && d <= body.p_ate; };
  const periodoOk = () => body.p_de && body.p_ate && body.p_ate >= body.p_de && dias(body.p_de, body.p_ate) <= 366;
  if (fn === 'admin_pag_resumo') {
    if (!periodoOk()) return { body: { status: 'invalid' } };
    const pagas = p.charges.filter((c) => c.paga_em && noPeriodo(c.paga_em));
    const soma = (l, k) => l.reduce((t, c) => t + (c[k] || 0), 0);
    const extrato = {};
    const poe = (k, v) => { if (v) extrato[k] = v; };
    poe('recebido', soma(pagas, 'valor_cents')); poe('taxa_imed', soma(pagas, 'taxa_cents')); poe('repasse_clinica', soma(pagas, 'clinica_cents'));
    poe('tarifa_meio', soma(pagas, 'tarifa_meio_cents')); poe('devolucao', -soma(pagas, 'devolvido_cents'));
    const cobrancas = {};
    for (const c of p.charges.filter((x) => noPeriodo(x.criado_em))) cobrancas[c.situacao] = (cobrancas[c.situacao] || 0) + 1;
    const abertas = p.diffs.filter((d) => !d.resolvida_em);
    return { body: { status: 'ok', de: body.p_de, ate: body.p_ate, fonte: 'cobrado_pelo_site', vendas_online_ligadas: p.ligada, extrato, cobrancas, contas: p.contas,
      atencao: { diferencas_criticas: abertas.filter((d) => d.critica).length, diferencas_abertas: abertas.length, devolucoes_na_fila: 0, devolucoes_com_falha: 0, avisos_pendentes: p.avisos || 0, contestacoes_abertas: 0,
        ultima_conciliacao: p.runs.find((r) => r.situacao === 'concluida' && r.janela !== 'manual')?.dia ?? null } } };
  }
  if (fn === 'admin_pag_lista') {
    if (!periodoOk()) return { body: { status: 'invalid' } };
    const l = p.charges.filter((c) => noPeriodo(c.criado_em) && (!body.p_situacao || c.situacao === body.p_situacao)).sort((a, b) => b.criado_em.localeCompare(a.criado_em));
    return { body: { status: 'ok', cobrancas: l.slice(0, Math.min(Math.max(body.p_limit ?? 100, 1), 500)) } };
  }
  if (fn === 'admin_pag_conciliacao') {
    const abertas = p.diffs.filter((d) => !d.resolvida_em);
    return { body: { status: 'ok', criticas_abertas: abertas.filter((d) => d.critica).length, rodadas: p.runs, diferencas: body.p_so_abertas === false ? p.diffs : abertas } };
  }
  if (fn === 'admin_pag_chave_geral') {
    if (p.semOperar) return { body: { status: 'forbidden' } };
    if (typeof body.p_motivo !== 'string' || !/^[a-z][a-z0-9_]{2,59}$/.test(body.p_motivo) || /[0-9]{4,}/.test(body.p_motivo)) return { body: { status: 'reason_required' } };
    if (typeof body.p_ligar !== 'boolean') return { body: { status: 'invalid' } };
    p.ligada = body.p_ligar;
    p.trilha.push({ ligada: body.p_ligar, motivo: body.p_motivo });
    return { body: { status: 'ok', vendas_online_ligadas: body.p_ligar } };
  }
  return { http: 404, body: NOFN(fn) };
}

async function newPage(browser, { mobile = false, width = 1280, admin = true, theme = null, dsf = 1, pag = {}, bypassCSP = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 360, height: 780 } : { width, height: 900 }, deviceScaleFactor: dsf, isMobile: mobile, hasTouch: mobile,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', colorScheme: theme === 'dark' ? 'dark' : 'light', bypassCSP });
  await context.clock.setFixedTime(new Date(NOW));
  const db = { admin, pag: { missing: false, ligada: false, charges: [], runs: [], diffs: [], contas: {}, avisos: 0, erro: null, delay: null, semPermissao: false, semOperar: false, trilha: [], ...clone(pag) } };
  const log = [];
  await context.addInitScript(([s, t]) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (t) localStorage.setItem('imed_tema', t);
      if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('imed_session', JSON.stringify(s)); sessionStorage.setItem('__seeded', '1'); }
    } catch { /* sem armazenamento */ }
  }, [{ access_token: 'tok-init', refresh_token: 'ref', expires_at: Math.floor(Date.parse(NOW) / 1000) + 3600, user: { id: USER_ID, email: 'equipe@imed.test' } }, theme === 'dark' ? 'escuro' : null]);
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const rest = url.pathname.replace('/rest/v1/', '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    log.push({ path: rest, body });
    if (rest === 'rpc/is_imed_admin') return json(route, db.admin);
    if (rest.startsWith('rpc/')) {
      const r = pagRpc(rest.slice(4), body, db);
      if (r?.espera) await new Promise((ok) => setTimeout(ok, r.espera));
      if (r) return json(route, r.body, r.http || 200);
    }
    // o resto do painel (números, cobranças registradas à mão, central da agenda) não é deste teste: como num banco
    // que ainda não tem essas funções, cada parte mostra o próprio aviso
    if (req.method() === 'GET') return json(route, []);
    return json(route, NOFN(rest.replace('rpc/', '')), 404);
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push(`diálogo inesperado: ${d.message()}`); d.dismiss(); });
  return { context, page, log, db, errors };
}

const calls = (log, fn) => log.filter((e) => e.path === `rpc/${fn}`);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const texto = async (page, sel) => norm(await page.textContent(sel));
const shot = async (page, name) => { if (SHOTS) await page.locator('#sec-pagamentos').screenshot({ path: join(SHOTS, `${name}.png`) }); };
const noOverflow = async (page) => {
  const [w, sw] = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
  const vw = page.viewportSize().width;
  assert.ok(w <= vw && sw <= vw, `sem rolagem lateral (janela ${w}px, conteúdo ${sw}px, aparelho ${vw}px)`);
};
const focusId = (page) => page.evaluate(() => document.activeElement?.id || '');
const kpis = (page) => page.$$eval('#pgKpis [data-kpi]', (k) => k.map((x) => [x.dataset.kpi, x.querySelector('.gs-kpi-v').textContent.replace(/\s/g, ' ')]));
async function abrir(page, espera = '#pgPainel table, #pgPainel .gs-empty') {
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-pagamentos');
  await page.waitForSelector(espera);
}
async function runAxe(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document.querySelector('#sec-pagamentos'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] });
    return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  });
}

const results = [];
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
async function scenario(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const t = new Promise((_, f) => { const x = setTimeout(() => f(new Error(`passou de ${LIMITE_MS / 1000} s: ${name}`)), LIMITE_MS); x.unref?.(); });
  try { await Promise.race([comChaves(fn), t]); results.push(['ok', name]); console.log(`ok  ${name}`); } catch (e) { results.push(['FALHOU', name]); console.log(`FALHOU  ${name}\n   ${e.stack}`); }
}
const browser = vigiarChaves(await chromium.launch());
const SEM_SITE = 'O IMED ainda não recebe pagamentos pelo site; aqui a equipe registra as cobranças feitas por fora (Pix, cartão, boleto).';

await scenario('banco sem as funções do pagamento (a produção de hoje): a parte entra no trilho e avisa que ainda não está ligada no banco; nada quebra', async () => {
  const { page, log, errors, context } = await newPage(browser, { pag: { missing: true } });
  await abrir(page, '#sec-pagamentos #pgCorpo .cl-note.warn');
  assert.equal(await texto(page, '#sec-pagamentos-h'), 'Pagamentos on-line');
  assert.equal(await texto(page, '#pgCorpo'), 'Os pagamentos on-line ainda não estão ligados no banco. Esta parte aparece aqui depois que a atualização do banco do pagamento for aplicada.');
  assert.match(await texto(page, '#sec-pagamentos > .cl-help'), /Aqui não aparece dado de paciente nem de quem pagou: só valores, situações e nomes de clínica\./);
  // no trilho, entre "Faturamento e cobrança" e "Agenda das clínicas", com o ícone
  assert.deepEqual(await page.$$eval('.gs-toc a', (a) => a.map((x) => x.getAttribute('href')).slice(-3)), ['#sec-cobranca', '#sec-pagamentos', '#sec-agenda']);
  assert.equal(await texto(page, '.gs-toc a[href="#sec-pagamentos"]'), 'Pagamentos on-line');
  assert.equal(await page.locator('.gs-toc a[href="#sec-pagamentos"] i.fa-landmark[aria-hidden="true"]').count(), 1);
  assert.deepEqual(await page.evaluate(() => [...document.querySelector('#app').children].map((el) => el.id || [...el.classList].at(-1)).slice(-3)), ['sec-cobranca', 'sec-pagamentos', 'sec-agenda']);
  assert.equal(await page.locator('#pgTopo, #pgPainel, #pgChaveBtn, #sec-pagamentos button').count(), 0, 'sem o banco: nenhum número, nenhum botão');
  assert.equal(await texto(page, '#cobHonesto'), SEM_SITE, 'a frase de "Faturamento e cobrança" continua a de hoje');
  assert.equal(calls(log, 'admin_pag_resumo').length, 1, 'uma pergunta só ao banco');
  assert.equal(calls(log, 'admin_pag_lista').length + calls(log, 'admin_pag_conciliacao').length, 0);
  // "Atualizar números" pergunta de novo (a migração pode ter sido aplicada) e continua sem quebrar
  await page.click('#gsRefresh');
  await page.waitForFunction(() => true);
  await page.waitForTimeout(200);
  assert.equal(calls(log, 'admin_pag_resumo').length, 2);
  assert.equal(await page.locator('#pgCorpo .cl-note.warn').count(), 1);
  await shot(page, 'pg-01-sem-banco');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('tudo desligado e vazio (o banco com o pagamento aplicado e nada ligado): chave desligada, zeros do banco, listas vazias', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await abrir(page);
  assert.equal(await page.getAttribute('#pgChave', 'data-ligada'), 'false');
  assert.equal(await texto(page, '#pgChaveEstado'), 'Desligada');
  assert.match(await texto(page, '#pgChave .gs-pg-t'), /^Nenhuma cobrança nova nasce, em nenhuma clínica\./);
  assert.match(await texto(page, '#pgChaveBtn'), /^Ligar… o pagamento pelo site \(pede confirmação\)$/);
  // o período é o da página (30 dias, em dias de São Paulo)
  assert.deepEqual(calls(log, 'admin_pag_resumo')[0].body, { p_de: '2026-10-15', p_ate: '2026-11-13' });
  assert.deepEqual(calls(log, 'admin_pag_lista')[0].body, { p_de: '2026-10-15', p_ate: '2026-11-13', p_clinic: null, p_situacao: null, p_limit: 100 });
  assert.match(await texto(page, '#pgPeriodo'), /^Números de 15\/10\/2026 a 13\/11\/2026, no horário de São Paulo, só do que foi cobrado pelo site/);
  assert.deepEqual(await kpis(page), [['pg-recebido', 'R$ 0,00'], ['pg-taxa', 'R$ 0,00'], ['pg-repasse', 'R$ 0,00'], ['pg-tarifa', 'R$ 0,00'], ['pg-devolvido', 'R$ 0,00'], ['pg-cobrancas', '0']]);
  assert.match(await texto(page, '#pgAtencao'), /^Nada pendente agora/);
  assert.ok((await page.getAttribute('#pgAtencao', 'class')).includes('ok'));
  assert.equal(await texto(page, '#pgContas'), 'Nenhuma clínica informou a conta no meio de pagamento ainda.');
  assert.equal(await texto(page, '#pgCobVazia'), 'Nenhuma cobrança pelo site no período.');
  assert.equal(await texto(page, '#pgCobConta'), '0 cobranças criadas de 15/10/2026 a 13/11/2026. O período é o do alto da página.');
  assert.equal(await texto(page, '#cobHonesto'), SEM_SITE);
  // conciliação: nenhuma conferência ainda
  await page.click('#pgTab-conciliacao');
  await page.waitForSelector('#pgRodVazia');
  assert.match(await texto(page, '#pgConcResumo'), /^Nenhuma conferência feita ainda\. Ela roda sozinha de madrugada, depois que o pagamento for ligado\.$/);
  assert.equal(await texto(page, '#pgDifT'), 'Diferenças abertas (0)');
  assert.equal(await texto(page, '#pgDifVazia'), 'Nenhuma diferença aberta.');
  assert.equal(await page.locator('#pgCritN').isHidden(), true);
  assert.deepEqual(calls(log, 'admin_pag_conciliacao')[0].body, { p_so_abertas: true });
  await shot(page, 'pg-02-vazio');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('com cobranças: números do período, o que precisa de atenção, a lista com filtro e o período da página; nenhum dado de paciente nem id de agendamento', async () => {
  const { page, log, errors, context } = await newPage(browser, { pag: CHEIO() });
  await abrir(page, '#pgCobTb');
  assert.equal(await texto(page, '#pgChaveEstado'), 'Ligada');
  assert.equal(await page.getAttribute('#pgChave', 'data-ligada'), 'true');
  assert.deepEqual(await kpis(page), [['pg-recebido', 'R$ 973,23'], ['pg-taxa', 'R$ 145,98'], ['pg-repasse', 'R$ 827,25'], ['pg-tarifa', 'R$ 5,97'], ['pg-devolvido', 'R$ 200,00'], ['pg-cobrancas', '5']]);
  assert.equal(await texto(page, '[data-kpi="pg-cobrancas"] small'), '2 pagas · 1 aguardando');
  assert.deepEqual(await page.$$eval('#pgAtencao li', (l) => l.map((x) => [x.dataset.at, x.textContent])), [['diferencas_criticas', '1 diferença crítica aberta na conciliação'], ['avisos_pendentes', '1 aviso do meio de pagamento ainda não aplicado']]);
  assert.ok((await page.getAttribute('#pgAtencao', 'class')).includes('err'), 'diferença crítica: aviso vermelho');
  assert.equal(await texto(page, '#pgContas'), 'Clínicas: 2 com a conta ativa, 1 em conferência e 0 suspensas. Última conferência concluída com o meio de pagamento: o dia 12/11/2026.');
  assert.equal(await texto(page, '#pgCritN'), '1 diferença crítica aberta');
  // com a chave ligada, a frase de "Faturamento e cobrança" muda junto (§9)
  assert.equal(await texto(page, '#cobHonesto'), 'Aqui ficam as cobranças feitas por fora (Pix, cartão, boleto), registradas pela equipe. O que foi pago pelo site está em “Pagamentos on-line”, logo abaixo.');
  // a lista: da mais nova para a mais antiga
  assert.deepEqual(await page.$$eval('#pgCobTb thead th', (t) => t.map((x) => x.textContent)), ['Clínica', 'Criada em', 'Situação', 'Valor', 'Taxa do IMED', 'Parte da clínica', 'Tarifa do meio', 'Devolvido']);
  const linhas = await page.$$eval('#pgCobTb tbody tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
  assert.deepEqual(linhas, [
    ['Clínica Simulada BExame agendado · Pix · 44444444', '13/11/2026 às 11:50', 'Aguardando pagamento', 'R$ 450,00', 'R$ 67,50', 'R$ 382,50', 'ainda não informada', '—'],
    ['Clínica Simulada AExame agendado · Pix · 11111111', '12/11/2026 às 09:30paga em 12/11/2026 às 09:30', 'Paga', 'R$ 133,23', 'R$ 19,98', 'R$ 113,25', 'R$ 1,99', '—'],
    ['Clínica Simulada AExame agendado · Pix · 22222222', '11/11/2026 às 15:05paga em 11/11/2026 às 15:05', 'Devolvida', 'R$ 200,00', 'R$ 30,00', 'R$ 170,00', 'R$ 1,99', 'R$ 200,00'],
    ['Clínica Simulada BExame agendado · Pix · 33333333', '10/11/2026 às 10:002ª tentativa', 'Venceu sem pagamento', 'R$ 90,00', 'R$ 13,50', 'R$ 76,50', 'ainda não informada', '—'],
    ['Clínica Simulada AExame agendado · Pix · 55555555', '20/10/2026 às 12:00paga em 20/10/2026 às 12:00', 'Paga', 'R$ 640,00', 'R$ 96,00', 'R$ 544,00', 'R$ 1,99', '—'],
  ]);
  assert.equal(await texto(page, '#pgCobConta'), '5 cobranças criadas de 15/10/2026 a 13/11/2026. O período é o do alto da página.');
  const html = await page.innerHTML('#sec-pagamentos');
  assert.ok(!html.includes(PEDIDO) && !html.includes('eeeeeeee') && !/request_id|patient|paciente [A-Z]/.test(html), 'o id do agendamento (que a função manda) nunca chega à tela');
  await shot(page, 'pg-03-cobrancas');
  // filtro por situação: pede ao banco (e o foco volta ao filtro)
  await page.selectOption('#pgFiltro', 'aprovada');
  await page.waitForFunction(() => document.querySelectorAll('#pgCobTb tbody tr').length === 2);
  assert.deepEqual(calls(log, 'admin_pag_lista').at(-1).body, { p_de: '2026-10-15', p_ate: '2026-11-13', p_clinic: null, p_situacao: 'aprovada', p_limit: 100 });
  assert.equal(await texto(page, '#pgCobConta'), '2 cobranças criadas de 15/10/2026 a 13/11/2026 (só: paga). O período é o do alto da página.');
  assert.equal(await focusId(page), 'pgFiltro');
  await page.selectOption('#pgFiltro', 'contestada');
  await page.waitForSelector('#pgCobVazia');
  assert.equal(await texto(page, '#pgCobVazia'), 'Nenhuma cobrança com essa situação no período.');
  await page.selectOption('#pgFiltro', '');
  await page.waitForFunction(() => document.querySelectorAll('#pgCobTb tbody tr').length === 5);
  // o período da página (7 dias) vale aqui também
  await page.check('input[name="gsDias"][value="7"]');
  await page.waitForFunction(() => document.querySelectorAll('#pgCobTb tbody tr').length === 4);
  assert.deepEqual(calls(log, 'admin_pag_resumo').at(-1).body, { p_de: '2026-11-07', p_ate: '2026-11-13' });
  assert.deepEqual(calls(log, 'admin_pag_lista').at(-1).body, { p_de: '2026-11-07', p_ate: '2026-11-13', p_clinic: null, p_situacao: null, p_limit: 100 });
  await page.waitForFunction(() => document.querySelector('[data-kpi="pg-cobrancas"] .gs-kpi-v')?.textContent === '4');
  assert.deepEqual((await kpis(page)).slice(0, 2), [['pg-recebido', 'R$ 333,23'], ['pg-taxa', 'R$ 49,98']]);
  // "Atualizar" da lista busca o resumo e a lista de novo
  const n = [calls(log, 'admin_pag_resumo').length, calls(log, 'admin_pag_lista').length];
  await page.click('#pgCobAtualizar');
  await page.waitForFunction(() => document.activeElement?.id === 'pgCobAtualizar');
  assert.deepEqual([calls(log, 'admin_pag_resumo').length, calls(log, 'admin_pag_lista').length], [n[0] + 1, n[1] + 1]);
  // só as funções de leitura foram chamadas (a chave geral, só com confirmação)
  assert.deepEqual([...new Set(log.filter((e) => /^rpc\/admin_pag_/.test(e.path)).map((e) => e.path))].sort(), ['rpc/admin_pag_lista', 'rpc/admin_pag_resumo']);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('conciliação: abas pelo teclado, a última conferência, as diferenças com os dois lados, "Todas" e as últimas conferências', async () => {
  const { page, log, errors, context } = await newPage(browser, { pag: CHEIO() });
  await abrir(page, '#pgCobTb');
  await page.focus('#pgTab-cobrancas');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('#pgDifTb');
  assert.equal(await focusId(page), 'pgTab-conciliacao');
  assert.equal(await page.getAttribute('#pgTab-conciliacao', 'aria-selected'), 'true');
  assert.equal(await page.getAttribute('#pgPainel', 'aria-labelledby'), 'pgTab-conciliacao');
  assert.equal(await texto(page, '#pgConcResumo'), '1 diferença crítica aberta. Última conferência: o dia 12/11/2026 (do dia anterior), concluída. 2 cobranças comparadas; 2 diferenças achadas.');
  assert.ok((await page.getAttribute('#pgConcResumo', 'class')).includes('err'));
  assert.equal(await texto(page, '#pgDifT'), 'Diferenças abertas (2)');
  const difs = await page.$$eval('#pgDifTb tbody tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
  assert.deepEqual(difs, [
    ['O meio de pagamento recebeu e o IMED não registrou o pagamentoCrítica', '12/11/2026', '—', 'paga · valor R$ 200,00', 'sem cobrança no IMED', 'Abertadesde 13/11/2026 às 04:17'],
    ['A tarifa do meio de pagamento veio diferente da esperadaInformativa', '12/11/2026', 'tarifa R$ 1,99', 'tarifa R$ 0,99', '11111111', 'Abertadesde 13/11/2026 às 04:17'],
  ]);
  assert.match(await texto(page, '.gs-pg-fechar'), /Fechar uma diferença, com o motivo, ainda é feito pelo banco/);
  assert.equal(await page.locator('#pgPainel button:not([data-pg-refresh])').count(), 0, 'a conciliação é só leitura: nenhum botão de resolver');
  const rod = await page.$$eval('#pgRodTb tbody tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
  assert.deepEqual(rod, [['12/11/2026do dia anterior', '13/11/2026 às 04:17', 'Concluída', '2', '21 crítica'], ['11/11/2026do dia anterior', '12/11/2026 às 04:17', 'Concluída', '1', '1']]);
  await shot(page, 'pg-04-conciliacao');
  // todas (inclusive as fechadas)
  await page.check('#pgDif-todas');
  await page.waitForFunction(() => document.querySelectorAll('#pgDifTb tbody tr').length === 3);
  assert.deepEqual(calls(log, 'admin_pag_conciliacao').at(-1).body, { p_so_abertas: false });
  assert.equal(await texto(page, '#pgDifT'), 'Diferenças (3)');
  assert.match(await texto(page, '#pgDifTb tbody tr:last-child'), /Fechada12\/11\/2026 às 10:00 · devolucao_conferida$/);
  assert.match(await texto(page, '#pgDifTb tbody tr:last-child'), /paga · devolvido R\$ 0,00.*devolvida · devolvido R\$ 200,00/);
  // voltar para as cobranças pelo teclado (Home)
  await page.focus('#pgTab-conciliacao');
  await page.keyboard.press('Home');
  await page.waitForSelector('#pgCobTb');
  assert.equal(await focusId(page), 'pgTab-cobrancas');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('chave geral: desligar e ligar só com confirmação e motivo (para ligar, também o "entendi"); "Voltar" não chama o banco; conta sem a permissão', async () => {
  const { page, log, db, errors, context } = await newPage(browser, { pag: CHEIO() });
  await abrir(page, '#pgCobTb');
  // desligar: abre o quadro, o foco vai para o motivo, e o botão da chave some enquanto o quadro está aberto
  await page.click('#pgChaveBtn');
  await page.waitForSelector('#pgQuadro');
  assert.equal(await focusId(page), 'pgMotivo');
  assert.equal(await page.locator('#pgChaveBtn').count(), 0);
  assert.match(await texto(page, '#pgQuadroT'), /^Desligar o pagamento pelo site\? Na hora, nenhuma cobrança nova nasce, em nenhuma clínica/);
  assert.equal(await page.locator('#pgCiente').count(), 0, 'para desligar, basta o motivo');
  // voltar: nada é chamado
  await page.click('#pgChaveVoltar');
  assert.equal(await page.locator('#pgQuadro').count(), 0);
  assert.equal(await focusId(page), 'pgChaveBtn');
  assert.equal(calls(log, 'admin_pag_chave_geral').length, 0);
  // confirmar sem motivo: erro no campo, nada vai para o banco
  await page.click('#pgChaveBtn');
  await page.click('#pgChaveOk');
  assert.equal(await texto(page, '#pgMotivoErr'), 'Escolha o motivo.');
  assert.equal(await page.getAttribute('#pgMotivo', 'aria-invalid'), 'true');
  assert.equal(await focusId(page), 'pgMotivo');
  assert.equal(calls(log, 'admin_pag_chave_geral').length, 0);
  await page.selectOption('#pgMotivo', 'incidente');
  await page.click('#pgChaveOk');
  await page.waitForFunction(() => document.querySelector('#pgChaveEstado')?.textContent === 'Desligada');
  assert.deepEqual(calls(log, 'admin_pag_chave_geral').map((c) => c.body), [{ p_ligar: false, p_motivo: 'incidente' }]);
  assert.deepEqual(db.pag.trilha, [{ ligada: false, motivo: 'incidente' }]);
  assert.equal(await texto(page, '#pgMsg'), 'Pagamento pelo site desligado: nenhuma cobrança nova nasce. O motivo ficou registrado.');
  assert.equal(await page.locator('#pgQuadro').count(), 0);
  assert.equal(await focusId(page), 'pgChaveBtn');
  assert.equal(await texto(page, '#cobHonesto'), SEM_SITE, 'desligada: a frase de "Faturamento e cobrança" volta junto');
  // ligar: motivo E a caixa "entendi"; o texto diz quantas clínicas estão prontas (número do banco)
  await page.click('#pgChaveBtn');
  assert.match(await texto(page, '#pgQuadroT'), /^Ligar o pagamento pelo site\? Na hora, toda clínica com a conta conferida e a unidade no modo on-line passa a cobrar o paciente pelo site\. Hoje há 2 clínicas com a conta ativa\./);
  assert.deepEqual(await page.$$eval('#pgMotivo option', (o) => o.map((x) => x.value)), ['', 'abertura_do_piloto', 'retomada_apos_incidente', 'retomada_apos_manutencao', 'teste_da_equipe']);
  await page.selectOption('#pgMotivo', 'retomada_apos_incidente');
  await page.click('#pgChaveOk');
  assert.equal(await texto(page, '#pgCienteErr'), 'Marque a caixa para confirmar que entendeu.');
  assert.equal(await focusId(page), 'pgCiente');
  assert.equal(calls(log, 'admin_pag_chave_geral').length, 1, 'sem o "entendi", nada vai para o banco');
  await page.check('#pgCiente');
  await page.focus('#pgChaveOk');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#pgChaveEstado')?.textContent === 'Ligada');
  assert.deepEqual(calls(log, 'admin_pag_chave_geral').at(-1).body, { p_ligar: true, p_motivo: 'retomada_apos_incidente' });
  assert.equal(await texto(page, '#pgMsg'), 'Pagamento pelo site ligado. O motivo ficou registrado.');
  assert.match(await texto(page, '#cobHonesto'), /^Aqui ficam as cobranças feitas por fora/);
  // conta que vê mas não opera (papel financeiro da equipe): o banco recusa e a tela explica; nada muda
  db.pag.semOperar = true;
  await page.click('#pgChaveBtn');
  await page.selectOption('#pgMotivo', 'manutencao');
  await page.click('#pgChaveOk');
  await page.waitForSelector('#pgQuadroErr .cl-note.err');
  assert.equal(await texto(page, '#pgQuadroErr'), 'Só o administrador do IMED liga ou desliga o pagamento pelo site.');
  assert.equal(await texto(page, '#pgChaveEstado'), 'Ligada');
  assert.equal(await page.locator('#pgQuadro').count(), 1, 'o quadro fica aberto, com o erro');
  // o banco fora do ar: o erro aparece no quadro e a pessoa pode tentar de novo
  db.pag.semOperar = false;
  db.pag.erro = { admin_pag_chave_geral: { status: 500, body: { message: 'erro interno' } } };
  await page.click('#pgChaveOk');
  await page.waitForFunction(() => /Tente de novo/.test(document.querySelector('#pgQuadroErr')?.textContent || ''));
  assert.equal(db.pag.ligada, true);
  db.pag.erro = null;
  await page.click('#pgChaveOk');
  await page.waitForFunction(() => document.querySelector('#pgChaveEstado')?.textContent === 'Desligada');
  assert.deepEqual(db.pag.trilha.at(-1), { ligada: false, motivo: 'manutencao' });
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('erros: o banco falha no resumo e na lista → aviso e "Tentar de novo"; conta sem a permissão financeira; atualização que falha não apaga o que estava', async () => {
  let { page, log, db, errors, context } = await newPage(browser, { pag: { ...CHEIO(), erro: { admin_pag_resumo: { status: 500, body: { message: 'erro interno' } } } } });
  await abrir(page, '#pgRetry');
  assert.equal(await page.getAttribute('#pgCorpo .cl-note.err', 'role'), 'alert');
  assert.equal(await page.locator('#pgTopo, #pgPainel').count(), 0, 'com erro: nenhum número');
  db.pag.erro = { admin_pag_lista: { status: 500, body: { message: 'erro interno' } } };
  await page.focus('#pgRetry');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#pgTabRetry');
  assert.equal(await texto(page, '#pgChaveEstado'), 'Ligada', 'o resumo veio');
  assert.equal(await page.locator('#pgCobTb').count(), 0);
  db.pag.erro = null;
  await page.click('#pgTabRetry');
  await page.waitForSelector('#pgCobTb');
  // atualização que falha: os dados de antes ficam e a tela avisa
  db.pag.erro = { admin_pag_lista: { status: 500, body: { message: 'x' } }, admin_pag_resumo: { status: 500, body: { message: 'x' } } };
  await page.click('#pgCobAtualizar');
  await page.waitForSelector('#pgMsg .cl-note.err');
  assert.equal(await texto(page, '#pgMsg'), 'Não foi possível atualizar agora. Os dados abaixo ainda são os de antes.');
  assert.equal(await page.locator('#pgCobTb tbody tr').count(), 5);
  assert.equal(await texto(page, '#pgChaveEstado'), 'Ligada');
  assert.deepEqual(errors, []);
  await context.close();
  // a conta entrou no painel, mas o banco não dá a leitura do financeiro: aviso, sem número
  ({ page, log, db, errors, context } = await newPage(browser, { pag: { ...CHEIO(), semPermissao: true } }));
  await abrir(page, '#pgCorpo .cl-note.warn');
  assert.equal(await texto(page, '#pgCorpo'), 'Esta conta não tem permissão para ver os pagamentos on-line.');
  assert.equal(calls(log, 'admin_pag_lista').length, 0);
  assert.deepEqual(errors, []);
  await context.close();
  // quem não é da equipe: a parte nem existe (o painel inteiro não abre)
  ({ page, log, errors, context } = await newPage(browser, { admin: false, pag: CHEIO() }));
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('.gs-deny');
  assert.equal(await page.locator('#sec-pagamentos').count(), 0);
  assert.equal(log.filter((e) => /admin_pag_/.test(e.path)).length, 0, 'nenhuma função do pagamento é chamada');
  await context.close();
});

await scenario('celular (360 px): sem rolagem lateral, tabelas em cartões com o nome de cada coluna, alvos de 44 px, quadro de confirmação; tema escuro', async () => {
  let { page, errors, context } = await newPage(browser, { mobile: true, pag: CHEIO() });
  await abrir(page, '#pgCobTb');
  await noOverflow(page);
  assert.equal(await page.$eval('#pgCobTb tbody td', (td) => getComputedStyle(td).display), 'grid');
  assert.deepEqual(await page.$$eval('#pgCobTb tbody tr:first-child > *', (t) => t.map((x) => getComputedStyle(x, '::before').content.replace(/"/g, ''))), ['Clínica', 'Criada em', 'Situação', 'Valor', 'Taxa do IMED', 'Parte da clínica', 'Tarifa do meio', 'Devolvido']);
  const fora = () => page.$$eval('#sec-pagamentos *', (els) => els.filter((el) => { const r = el.getBoundingClientRect(); return !el.closest('thead, .sr, caption') && r.width > 0 && (r.right > window.innerWidth + 0.5 || r.left < -0.5); }).map((el) => `${el.tagName}.${el.className}`).slice(0, 5));
  assert.deepEqual(await fora(), [], 'nada passa da borda da tela');
  const pequenos = () => page.$$eval('#sec-pagamentos button, #sec-pagamentos select, #sec-pagamentos .gs-seg label, #sec-pagamentos .cl-check', (els) => els.filter((el) => el.offsetParent && el.getBoundingClientRect().height < 43.5).map((el) => `${el.id || el.className}:${Math.round(el.getBoundingClientRect().height)}`));
  assert.deepEqual(await pequenos(), [], 'alvos de toque com 44 px');
  await shot(page, 'pg-10-celular-cobrancas');
  await page.click('#pgTab-conciliacao');
  await page.waitForSelector('#pgDifTb');
  await noOverflow(page);
  assert.deepEqual(await fora(), []);
  assert.deepEqual(await pequenos(), []);
  await shot(page, 'pg-11-celular-conciliacao');
  await page.locator('#pgChaveBtn').scrollIntoViewIfNeeded();
  await page.click('#pgChaveBtn');
  await page.waitForSelector('#pgQuadro');
  await page.click('#pgChaveOk');
  await noOverflow(page);
  assert.deepEqual(await fora(), []);
  assert.deepEqual(await pequenos(), []);
  await shot(page, 'pg-12-celular-quadro');
  assert.deepEqual(errors, []);
  await context.close();
  ({ page, errors, context } = await newPage(browser, { theme: 'dark', pag: CHEIO() }));
  await abrir(page, '#pgCobTb');
  const bg = await page.evaluate(() => ['#pgChave', '#pgKpis .gs-kpi', '#pgFiltro', '.gs-pg-chave-ic'].map((s) => getComputedStyle(document.querySelector(s)).backgroundColor));
  for (const c of bg) assert.notEqual(c, 'rgb(255, 255, 255)', `fundo escuro (${bg.join(', ')})`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await shot(page, 'pg-13-escuro');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('acessibilidade (axe): a parte sem banco, vazia, com cobranças, na conciliação e com o quadro de confirmação com erro, no computador, no celular e no escuro', async () => {
  if (!AXE) { console.log('   aviso - axe-core não encontrado: auditoria pulada (use AXE_PATH=<pasta>/node_modules/axe-core)'); return; }
  for (const extra of [{}, { mobile: true }, { theme: 'dark' }]) {
    const onde = extra.mobile ? 'celular' : extra.theme ? 'escuro' : 'computador';
    let { page, errors, context } = await newPage(browser, { ...extra, bypassCSP: true, pag: { missing: true } });
    await abrir(page, '#pgCorpo .cl-note.warn');
    assert.deepEqual(await runAxe(page), [], `${onde}: banco sem as funções`);
    await context.close();
    ({ page, errors, context } = await newPage(browser, { ...extra, bypassCSP: true }));
    await abrir(page);
    assert.deepEqual(await runAxe(page), [], `${onde}: vazio`);
    await context.close();
    ({ page, errors, context } = await newPage(browser, { ...extra, bypassCSP: true, pag: CHEIO() }));
    await abrir(page, '#pgCobTb');
    assert.deepEqual(await runAxe(page), [], `${onde}: cobranças`);
    await page.click('#pgTab-conciliacao');
    await page.waitForSelector('#pgDifTb');
    await page.check('#pgDif-todas');
    await page.waitForFunction(() => document.querySelectorAll('#pgDifTb tbody tr').length === 3);
    assert.deepEqual(await runAxe(page), [], `${onde}: conciliação`);
    await page.click('#pgChaveBtn');
    await page.click('#pgChaveOk');
    assert.deepEqual(await runAxe(page), [], `${onde}: quadro de desligar, com erro`);
    await page.selectOption('#pgMotivo', 'incidente');
    await page.click('#pgChaveOk');
    await page.waitForFunction(() => document.querySelector('#pgChaveEstado')?.textContent === 'Desligada');
    await page.click('#pgChaveBtn');
    await page.click('#pgChaveOk');
    assert.deepEqual(await runAxe(page), [], `${onde}: quadro de ligar, com erros`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

// Fotos (só com FOTOS=pasta): dados simulados, em 2x. Não confere nada: os cenários de cima já conferiram.
if (FOTOS) {
  await scenario('fotos: Pagamentos on-line no computador (claro e escuro) e no celular', async () => {
    const foto = async (nome, opts, antes = null, tela = false) => {
      const { page, context } = await newPage(browser, { dsf: 2, pag: CHEIO(), ...opts });
      await abrir(page, opts.pag?.missing ? '#pgCorpo .cl-note.warn' : '#pgCobTb, #pgCobVazia');
      if (antes) await antes(page);
      await page.evaluate(() => document.fonts.ready);
      // só para a foto: o topo fixo (e, na foto só da parte, a barra do período) não cobre o que é fotografado
      await page.addStyleTag({ content: `.pt-top{position:static!important}${tela ? '' : '.gs-ctl,.gs-toc{position:static!important}'}` });
      await page.locator('#sec-pagamentos').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      if (tela) {
        // a parte dentro do painel, com o trilho lateral à vista
        await page.evaluate(() => { const r = document.querySelector('#sec-pagamentos').getBoundingClientRect(); window.scrollBy(0, r.top - 84); });
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(FOTOS, `${nome}.png`) });
      } else await page.locator('#sec-pagamentos').screenshot({ path: join(FOTOS, `${nome}.png`) });
      await context.close();
    };
    const conc = async (page) => { await page.click('#pgTab-conciliacao'); await page.waitForSelector('#pgDifTb'); };
    await foto('gestao-pagamentos-computador-claro', { width: 1440 }, null, true);
    await foto('gestao-pagamentos-computador-escuro', { width: 1440, theme: 'dark' }, null, true);
    await foto('gestao-pagamentos-cobrancas-claro', { width: 1440 });
    await foto('gestao-pagamentos-conciliacao-claro', { width: 1440 }, conc);
    await foto('gestao-pagamentos-conciliacao-escuro', { width: 1440, theme: 'dark' }, conc);
    await foto('gestao-pagamentos-celular', { mobile: true });
    await foto('gestao-pagamentos-celular-conciliacao', { mobile: true }, conc);
    await foto('gestao-pagamentos-desligado-vazio', { width: 1440, pag: {} });
    await foto('gestao-pagamentos-sem-banco', { width: 1440, pag: { missing: true } });
    await foto('gestao-pagamentos-confirmar-ligar', { width: 1440, pag: { ...CHEIO(), ligada: false } }, async (page) => { await page.click('#pgChaveBtn'); await page.waitForSelector('#pgQuadro'); });
  });
}

await browser.close();
server.close();
const bad = results.filter(([r]) => r !== 'ok');
console.log(`\n${results.length - bad.length}/${results.length} cenários ok`);
if (bad.length) process.exit(1);
