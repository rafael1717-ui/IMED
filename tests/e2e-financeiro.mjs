// Teste de ponta a ponta da aba "Financeiro" do painel da clínica (iMed Pagamentos, fase P2b), num navegador de verdade
// (Playwright), com o Supabase simulado. O banco de mentira responde como as funções pag_clinic_status e
// pag_clinic_statement da P1 (formato da migração pagamentos_base_parte_4): confere a permissão financeiro.ver, o
// período de até 92 dias e soma os totais. Estados: sem recebimento (o de hoje), banco sem as funções, em análise,
// desligado, ligado com extrato, vazio, erro com "Tentar de novo", papel sem a permissão. Computador (1024 px), celular
// (360 px), teclado, tema escuro e, com o axe-core por perto, acessibilidade.
// TODOS os valores e nomes daqui são SIMULADOS (não são preço, taxa nem movimento de clínica nenhuma).
// Rodar: node tests/e2e-financeiro.mjs   (E2E_PORT muda a porta; SHOTS=pasta salva capturas; ONLY="trecho" roda só os
//        cenários com esse texto; AXE_PATH=<pasta>/node_modules/axe-core; FOTOS=pasta grava as fotos em 2x)
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, vigiarChaves } from './regra-chaves.mjs';
import { ROLE_PERMS } from '../assets/js/agenda-core.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const FOTOS = process.env.FOTOS || '';
const ONLY = process.env.ONLY || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const PORT = Number(process.env.E2E_PORT) || 8796;
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

// axe-core (fora do site): AXE_PATH (arquivo, pasta do pacote ou pasta com node_modules) ou o node_modules do projeto.
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
const USER = 'uuuuuuuu-0000-4000-8000-000000000001';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const CLINIC = { id: C1, name: 'Clínica Simulada do Financeiro', kind: 'imagem', address_line: 'Rua de Teste, 1', city: 'São Paulo', state: 'SP', cep: null, cnes: '7654321',
  phone: null, whatsapp: null, email: null, website: null, specialties: [], opening_hours: null, accepts_online_booking: true, status: 'published', is_demo: false, insurances: [], timezone: 'America/Sao_Paulo' };
const NOME_PROIBIDO = 'Paciente Que Não Pode Aparecer';
// Situações do recebimento, no formato de pag_clinic_status. A taxa e o preço mínimo são números de teste, diferentes
// dos que aparecem na arquitetura: a tela tem de mostrar o que o banco mandar, não um número dela.
const ST = (o = {}) => ({
  status: 'ok', clinic_id: C1, situacao: 'ativa', meios: ['pix'], carteira_final: '0001', emitida_por: 'imed', termos_versao: 'v1',
  aceito_em: '2026-11-10T14:00:00+00:00', conferida_em: '2026-11-11T14:00:00+00:00', payment_mode: 'online', vendas_online_ligadas: true, recebendo: true,
  taxa: { tipo: 'percentual', bps: 1250, cents: null, da_clinica: false, vale_de: '2026-11-01T00:00:00+00:00' }, preco_minimo_cents: 3000,
  pode_configurar: false, pode_estornar: false, ...o,
});
const SEM = () => ST({ situacao: 'nao_ligada', meios: [], carteira_final: null, emitida_por: null, termos_versao: null, aceito_em: null, conferida_em: null, payment_mode: 'no_local', vendas_online_ligadas: false, recebendo: false });
const ANALISE = () => ST({ situacao: 'em_conferencia', conferida_em: null, payment_mode: 'no_local', vendas_online_ligadas: false, recebendo: false });
// Exames pagos (um por linha, como a função manda). Os campos de paciente NÃO existem na função de verdade: estão aqui
// só para provar que, mesmo se um dia vierem, a tela não os mostra.
const L = (dia, cobranca, exam, preco, o = {}) => {
  const taxa = Math.floor((preco * 1250) / 10000);
  return { dia, cobranca, meio: 'pix', situacao: 'aprovada', exam_code: exam, starts_at: `${dia}T17:30:00+00:00`, preco_cents: preco, taxa_cents: taxa, clinica_cents: preco - taxa,
    devolvido_cents: 0, previsao: dia, patient_name: NOME_PROIBIDO, patient_phone: '11900000000', ...o };
};
const LINHAS = () => [
  L('2026-10-20', 'aa000001', 'rx', 9000),
  L('2026-11-03', 'aa000002', 'rm', 64000),
  L('2026-11-05', 'aa000003', 'usg', 18000, { situacao: 'devolvida', devolvido_cents: 18000 }),
  L('2026-11-10', 'aa000004', 'tc', 42000, { situacao: 'devolvida_parcial', devolvido_cents: 10000 }),
  L('2026-11-12', 'aa000005', 'mamo', 15050, { situacao: 'contestada' }),
];

const clone = (x) => JSON.parse(JSON.stringify(x));
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
const NOFN = (fn) => ({ code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` });
const dias = (a, b) => (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000;

// O extrato como o banco faz: confere o período, filtra pelo dia do pagamento e SOMA os totais (a tela não soma nada).
function extrato(db, body) {
  const { p_de: de, p_ate: ate } = body;
  if (!de || !ate || ate < de || dias(de, ate) > 92) return { status: 'invalid' };
  const linhas = db.fin.linhas.filter((l) => l.dia >= de && l.dia <= ate);
  const soma = (k) => linhas.reduce((t, l) => t + l[k], 0);
  // a devolução divide na mesma proporção da cobrança (como o banco fecha a conta): parte da clínica primeiro, o resto é taxa
  const devClinica = linhas.reduce((t, l) => t + Math.round((l.devolvido_cents * l.clinica_cents) / l.preco_cents), 0);
  return { status: 'ok', de, ate, linhas, totais: { valor_cents: soma('preco_cents'), taxa_cents: soma('taxa_cents'), clinica_cents: soma('clinica_cents'), devolvido_cents: soma('devolvido_cents'),
    taxa_devolvida_cents: soma('devolvido_cents') - devClinica, clinica_devolvida_cents: devClinica, cobrancas: linhas.length } };
}

// role: papel da pessoa logada na clínica (null = sem vínculo). admin: equipe do IMED.
async function newPage(browser, { mobile = false, width = 1024, role = 'owner', admin = false, theme = null, dsf = 1, fin = {}, bypassCSP = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 360, height: 780 } : { width, height: 900 }, deviceScaleFactor: dsf, isMobile: mobile, hasTouch: mobile,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', colorScheme: theme === 'dark' ? 'dark' : 'light', bypassCSP });
  await context.clock.setFixedTime(new Date(NOW));
  // fin: { status: resposta de pag_clinic_status, linhas, missing (banco sem as funções), erro / erroExtrato: { status, body }, delay }
  const db = { role, admin, fin: { status: SEM(), linhas: [], missing: false, erro: null, erroExtrato: null, ...clone(fin) }, once: {} };
  const log = [];
  await context.addInitScript(([s, t]) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (t) localStorage.setItem('imed_tema', t);
      if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('imed_session', JSON.stringify(s)); sessionStorage.setItem('__seeded', '1'); }
    } catch { /* sem armazenamento */ }
  }, [{ access_token: 'tok-init', refresh_token: 'ref', expires_at: Math.floor(Date.parse(NOW) / 1000) + 3600, user: { id: USER, email: 'pessoa@exemplo.test' } }, theme === 'dark' ? 'escuro' : null]);
  const podeVer = () => db.admin || (db.role && 'financeiro.ver' in ROLE_PERMS[db.role]);
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const rest = url.pathname.replace('/rest/v1/', '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    log.push({ path: rest, body });
    const fn = rest.replace('rpc/', '');
    if (db.once[fn]) { const r = db.once[fn]; delete db.once[fn]; return json(route, r.body ?? r, r.http || 200); }
    switch (rest) {
      case 'rpc/is_imed_admin': return json(route, db.admin);
      case 'rpc/agenda_me': return json(route, { status: 'ok', user_id: USER, clinics: db.role ? [{ clinic_id: C1, name: CLINIC.name, role: db.role, timezone: CLINIC.timezone, agenda_mode: 'pedido', agenda_active: false, online: false, permissions: ROLE_PERMS[db.role] }] : [], imed: { admin: db.admin, permissions: [] } });
      case 'rpc/agenda_my_invites': return json(route, { status: 'ok', invites: [] });
      case 'clinics': return json(route, db.role || db.admin ? [CLINIC] : []);
      // pedidos da clínica: um pedido com o nome que NÃO pode aparecer no financeiro (o papel Financeiro nem os pede)
      case 'rpc/agenda_requests': return json(route, db.role && 'pedidos.ver' in ROLE_PERMS[db.role] ? { status: 'ok', timezone: CLINIC.timezone, requests: [{ id: 'rrrrrrrr-0000-4000-8000-000000000001', created_at: NOW, exam_code: 'rm', preferred_date: '2026-11-20', preferred_period: 'manha', patient_name: NOME_PROIBIDO, patient_phone: '11900000000', status: 'pending' }] } : { status: 'forbidden' });
      case 'rpc/pag_clinic_status': {
        if (db.fin.delay) await new Promise((r) => setTimeout(r, db.fin.delay));
        if (db.fin.missing) return json(route, NOFN('pag_clinic_status(p_clinic)'), 404);
        if (db.fin.erro) return json(route, db.fin.erro.body, db.fin.erro.status);
        if (body?.p_clinic !== C1 || !podeVer()) return json(route, { status: 'forbidden' });
        return json(route, db.fin.status);
      }
      case 'rpc/pag_clinic_statement': {
        if (db.fin.missing) return json(route, NOFN('pag_clinic_statement(p_clinic, p_de, p_ate)'), 404);
        if (db.fin.erroExtrato) return json(route, db.fin.erroExtrato.body, db.fin.erroExtrato.status);
        if (body?.p_clinic !== C1 || !podeVer()) return json(route, { status: 'forbidden' });
        return json(route, extrato(db, body));
      }
      default:
        if (req.method() === 'GET') return json(route, []);
        return json(route, NOFN(fn), 404);
    }
  });
  const page = await context.newPage();
  const errors = [];
  const baixados = [];
  page.on('request', (r) => { const u = r.url(); if (u.startsWith(BASE) && /\.js$/.test(u)) baixados.push(u.slice(BASE.length)); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push(`diálogo inesperado: ${d.message()}`); d.dismiss(); });
  return { context, page, log, db, errors, baixados };
}

const calls = (log, fn) => log.filter((e) => e.path === `rpc/${fn}`);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const texto = async (page, sel) => norm(await page.textContent(sel));
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
const noOverflow = async (page) => {
  const [w, sw] = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
  const vw = page.viewportSize().width;
  assert.ok(w <= vw && sw <= vw, `sem rolagem lateral (janela ${w}px, conteúdo ${sw}px, aparelho ${vw}px)`);
};
const focusId = (page) => page.evaluate(() => document.activeElement?.id || '');
// Abre o painel e a aba Financeiro (o papel Financeiro já cai nela).
async function abrir(page, { clicar = true } = {}) {
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-financeiro');
  if (clicar) await page.click('#tab-financeiro');
  await page.waitForSelector('#fiSituacao, #fiRoot .cl-note');
}
async function runAxe(page, sel = '#panel') {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (s) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document.querySelector(s), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] });
    return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  }, sel);
}

const results = [];
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
async function scenario(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const t = new Promise((_, f) => { const x = setTimeout(() => f(new Error(`passou de ${LIMITE_MS / 1000} s: ${name}`)), LIMITE_MS); x.unref?.(); });
  try { await Promise.race([comChaves(fn), t]); results.push(['ok', name]); console.log(`ok  ${name}`); } catch (e) { results.push(['FALHOU', name]); console.log(`FALHOU  ${name}\n   ${e.stack}`); }
}
const browser = vigiarChaves(await chromium.launch());

await scenario('sem recebimento (o de hoje): a dona vê a aba Financeiro com "ainda não disponível" e nada mais; a aba só é baixada quando alguém a abre', async () => {
  const { page, log, errors, context, baixados } = await newPage(browser);
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-pedidos');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Pedidos|Agenda|Configurar agenda|Dados da clínica|Exames e preços|Financeiro|Equipe');
  assert.ok(!baixados.some((f) => /financeiro/.test(f)), 'financeiro.js não vem com a página');
  assert.equal(calls(log, 'pag_clinic_status').length, 0, 'nada do financeiro é pedido antes de abrir a aba');
  // pelo teclado: da aba "Exames e preços", seta para a direita
  await page.focus('#tab-exames');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('#fiSituacao[data-estado="indisponivel"]');
  assert.equal(await focusId(page), 'tab-financeiro');
  assert.equal(await page.getAttribute('#panel', 'aria-labelledby'), 'tab-financeiro');
  assert.ok(baixados.includes('assets/js/financeiro.js') && baixados.includes('assets/js/financeiro-core.js'));
  assert.equal(await texto(page, '#fiSituacao .fi-k'), 'Recebimento on-line');
  assert.equal(await texto(page, '#fiStT'), 'Recebimento on-line ainda não disponível');
  assert.equal(await texto(page, '#fiSituacao .fi-st-x'), 'Hoje os pacientes pagam direto na clínica, como sempre. Quando o pagamento pelo site estiver disponível para a sua clínica, a situação e o extrato aparecem aqui.');
  // e nada mais: sem taxa, sem lista do que falta, sem extrato, sem botão
  assert.equal(await page.locator('#fiCond, #fiFalta, #fiExtrato, #panel button, #panel select, #panel input').count(), 0);
  assert.doesNotMatch(await texto(page, '#panel'), /%|R\$/, 'nenhum número (taxa, preço) aparece para quem não tem o recebimento');
  assert.deepEqual(calls(log, 'pag_clinic_status').map((c) => c.body), [{ p_clinic: C1 }]);
  assert.equal(calls(log, 'pag_clinic_statement').length, 0, 'sem recebimento, o extrato nem é pedido (nem fica registro de leitura)');
  await noOverflow(page);
  await shot(page, 'fi-01-sem-recebimento');
  // sair da aba e voltar: busca de novo (uma chamada por abertura), sem erro
  await page.click('#tab-dados');
  await page.click('#tab-financeiro');
  await page.waitForSelector('#fiSituacao[data-estado="indisponivel"]');
  assert.equal(calls(log, 'pag_clinic_status').length, 2);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('banco sem as funções do pagamento (a produção de hoje): a mesma mensagem honesta, sem erro e sem "Tentar de novo"', async () => {
  const { page, log, errors, context } = await newPage(browser, { fin: { missing: true } });
  await abrir(page);
  assert.equal(await page.getAttribute('#fiSituacao', 'data-estado'), 'indisponivel');
  assert.equal(await texto(page, '#fiStT'), 'Recebimento on-line ainda não disponível');
  assert.equal(await page.locator('#fiRetry, #fiExtrato, #fiFalta, #fiRoot .cl-note').count(), 0);
  assert.equal(calls(log, 'pag_clinic_statement').length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('em análise: a situação, os números que o banco informou (taxa e preço mínimo) e o que falta para ligar; extrato vazio', async () => {
  const { page, log, errors, context } = await newPage(browser, { fin: { status: ANALISE() } });
  await abrir(page);
  assert.equal(await page.getAttribute('#fiSituacao', 'data-estado'), 'analise');
  assert.equal(await texto(page, '#fiStT'), 'Em análise');
  assert.match(await texto(page, '#fiSituacao .fi-st-x'), /^A conta da clínica no meio de pagamento \(carteira com final 0001\) foi informada em 10\/11\/2026 e a equipe do IMED está conferindo\. Enquanto isso, o pagamento continua direto na clínica\.$/);
  // os números são os do banco simulado (12,5% e R$ 30,00), não os da arquitetura
  assert.deepEqual(await page.$$eval('#fiCond > div', (d) => d.map((x) => [x.querySelector('dt').textContent, x.querySelector('dd').textContent])), [
    ['Taxa do IMED', '12,5% do valor de cada exame pago pelo site'], ['Como o paciente paga', 'Pix'], ['Preço mínimo', 'Exame abaixo de R$ 30,00 (ou sem preço informado) continua com pagamento no local.']]);
  assert.equal(await texto(page, '#fiFaltaT'), 'O que falta para ligar (faltam 3 passos)');
  assert.deepEqual(await page.$$eval('.fi-passos li', (l) => l.map((x) => [x.dataset.passo, x.className, x.querySelector('.bd').textContent])), [
    ['conta', 'fi-ok', 'Feito'], ['conferida', 'fi-pend', 'Falta'], ['unidade', 'fi-pend', 'Falta'], ['geral', 'fi-pend', 'Falta']]);
  assert.match(await texto(page, '[data-passo="conta"]'), /carteira com final 0001 · termos aceitos em 10\/11\/2026/);
  assert.match(await texto(page, '[data-passo="conferida"]'), /A equipe do IMED está conferindo\./);
  // o extrato: este mês (dias de São Paulo), vazio
  await page.waitForSelector('#fiVazio');
  assert.deepEqual(calls(log, 'pag_clinic_statement').map((c) => c.body), [{ p_clinic: C1, p_de: '2026-11-01', p_ate: '2026-11-13' }]);
  assert.equal(await texto(page, '#fiVazio'), 'Nenhum pagamento pelo site neste período.');
  assert.match(await texto(page, '#fiPerTxt'), /^Pagamentos de 01\/11\/2026 a 13\/11\/2026\./);
  assert.equal(await page.locator('#fiTotais, #fiTabela').count(), 0, 'sem pagamento: nenhum total inventado');
  assert.equal(await page.inputValue('#fiPer'), 'mes');
  assert.ok(await page.locator('#fiDeBox').isHidden() && await page.locator('#fiAteBox').isHidden());
  assert.doesNotMatch(await texto(page, '#panel'), /ligar o recebimento agora|colar|carteira:/i, 'a aba só lê: não há formulário para ligar');
  await shot(page, 'fi-02-analise');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('desligado: conta conferida com a unidade no local, com a chave geral fechada, e conta suspensa pelo IMED', async () => {
  let { page, errors, context } = await newPage(browser, { fin: { status: ST({ payment_mode: 'no_local', recebendo: false }) } });
  await abrir(page);
  assert.equal(await page.getAttribute('#fiSituacao', 'data-estado'), 'desligado');
  assert.equal(await texto(page, '#fiStT'), 'Desligado');
  assert.match(await texto(page, '#fiSituacao .fi-st-x'), /os pacientes pagam direto na clínica\. Veja abaixo o que falta\.$/);
  assert.equal(await texto(page, '#fiFaltaT'), 'O que falta para ligar (falta 1 passo)');
  assert.deepEqual(await page.$$eval('.fi-passos li', (l) => l.map((x) => x.className)), ['fi-ok', 'fi-ok', 'fi-pend', 'fi-ok']);
  assert.match(await texto(page, '[data-passo="unidade"]'), /Hoje a unidade está em “pagamento no local”\./);
  assert.match(await texto(page, '[data-passo="conferida"]'), /conferida em 11\/11\/2026/);
  await page.waitForSelector('#fiVazio');
  assert.deepEqual(errors, []);
  await context.close();
  // a chave geral do IMED fechada (mesmo que a resposta diga "recebendo", a tela não mostra "Ligado")
  ({ page, errors, context } = await newPage(browser, { fin: { status: ST({ vendas_online_ligadas: false, recebendo: true }) } }));
  await abrir(page);
  assert.equal(await page.getAttribute('#fiSituacao', 'data-estado'), 'desligado');
  assert.deepEqual(await page.$$eval('.fi-passos li', (l) => l.map((x) => x.className)), ['fi-ok', 'fi-ok', 'fi-ok', 'fi-pend']);
  assert.match(await texto(page, '[data-passo="geral"]'), /O IMED ainda não abriu o pagamento pelo site \(vale para todas as clínicas\)\./);
  assert.deepEqual(errors, []);
  await context.close();
  // suspensa: desligado, com o motivo que a clínica precisa saber; o extrato do que já foi pago continua
  ({ page, errors, context } = await newPage(browser, { fin: { status: ST({ situacao: 'suspensa', payment_mode: 'no_local', recebendo: false }), linhas: LINHAS() } }));
  await abrir(page);
  assert.equal(await page.getAttribute('#fiSituacao', 'data-estado'), 'desligado');
  assert.match(await texto(page, '#fiSituacao .fi-st-x'), /^A equipe do IMED suspendeu o recebimento on-line desta clínica\./);
  assert.match(await texto(page, '[data-passo="conferida"]'), /suspenso pela equipe do IMED: fale com o IMED\./);
  await page.waitForSelector('#fiTabela');
  assert.equal(await page.locator('#fiTabela tbody tr').count(), 4, 'o que já foi pago neste mês continua no extrato');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('ligado com extrato: totais somados pelo banco, um exame por linha com a situação, período pronto e datas à mão; nenhum nome de paciente', async () => {
  const { page, log, db, errors, context } = await newPage(browser, { fin: { status: ST(), linhas: LINHAS() } });
  await abrir(page);
  assert.equal(await page.getAttribute('#fiSituacao', 'data-estado'), 'ligado');
  assert.equal(await texto(page, '#fiStT'), 'Ligado');
  assert.equal(await page.locator('#fiFalta').count(), 0, 'ligado: não há o que falta');
  assert.equal(await page.locator('#fiCond > div').count(), 3);
  await page.waitForSelector('#fiTabela');
  // novembro: 4 exames; os totais são os do banco simulado
  assert.deepEqual(await page.$$eval('#fiTotais [data-total]', (k) => k.map((x) => [x.dataset.total, x.querySelector('b').textContent.replace(/\s/g, ' ')])), [
    ['pago', 'R$ 1.390,50'], ['clinica', 'R$ 1.216,69'], ['taxa', 'R$ 173,81'], ['devolvido', 'R$ 280,00']]);
  assert.equal(await texto(page, '[data-total="pago"] small'), '4 pagamentos pelo site');
  assert.equal(await texto(page, '[data-total="clinica"] small'), 'R$ 245,00 voltaram para os pacientes');
  assert.equal(await texto(page, '[data-total="taxa"] small'), 'R$ 35,00 voltaram para os pacientes');
  const linhas = await page.$$eval('#fiTabela tbody tr', (trs) => trs.map((tr) => [tr.dataset.sit, ...[...tr.cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim())]));
  assert.deepEqual(linhas, [
    ['pago', '03/11/2026Pix · pagamento aa000002', 'Ressonânciaexame em 03/11 às 14:30', 'R$ 640,00', 'R$ 80,00', 'R$ 560,00', 'Pago'],
    ['devolvido', '05/11/2026Pix · pagamento aa000003', 'Ultrassomexame em 05/11 às 14:30', 'R$ 180,00', 'R$ 22,50', 'R$ 157,50', 'DevolvidoDevolvido: R$ 180,00'],
    ['devolvido_parte', '10/11/2026Pix · pagamento aa000004', 'Tomografiaexame em 10/11 às 14:30', 'R$ 420,00', 'R$ 52,50', 'R$ 367,50', 'Devolvido em parteDevolvido: R$ 100,00'],
    ['contestado', '12/11/2026Pix · pagamento aa000005', 'Mamografiaexame em 12/11 às 14:30', 'R$ 150,50', 'R$ 18,81', 'R$ 131,69', 'Contestado'],
  ]);
  assert.equal(await texto(page, '#fiConta'), '4 exames pagos pelo site no período.');
  assert.deepEqual(await page.$$eval('#fiTabela thead th', (t) => t.map((x) => [x.textContent, x.scope])), [['Pago em', 'col'], ['Exame', 'col'], ['Valor do exame', 'col'], ['Taxa do IMED', 'col'], ['Parte da clínica', 'col'], ['Situação', 'col']]);
  assert.match(await page.getAttribute('.fi-tbwrap', 'aria-label'), /^Tabela: pagamentos pelo site, de 01\/11\/2026 a 13\/11\/2026$/);
  // nenhum dado de paciente, mesmo o banco de mentira tendo mandado
  assert.doesNotMatch(await page.textContent('#panel'), /Paciente Que|11900000000|9 ?0000-?0000/);
  await shot(page, 'fi-03-ligado-extrato');
  // período pronto: mês passado (busca na hora; o leitor de tela ouve o resumo)
  await page.selectOption('#fiPer', 'mes_passado');
  await page.waitForFunction(() => document.querySelectorAll('#fiTabela tbody tr').length === 1);
  assert.deepEqual(calls(log, 'pag_clinic_statement').at(-1).body, { p_clinic: C1, p_de: '2026-10-01', p_ate: '2026-10-31' });
  assert.equal(await texto(page, '#fiFala'), '1 exame pago pelo site de 01/10/2026 a 31/10/2026: R$ 90,00 pagos pelos pacientes, R$ 78,75 para a clínica.');
  assert.equal(await texto(page, '[data-total="pago"] small'), '1 pagamento pelo site');
  assert.equal(await texto(page, '[data-total="clinica"] small'), 'vai para a conta da clínica no meio de pagamento');
  assert.equal(await texto(page, '#fiConta'), '1 exame pago pelo site no período.');
  // datas à mão: os campos aparecem, o foco vai para o primeiro, e nada é pedido antes de a pessoa mandar
  const antes = calls(log, 'pag_clinic_statement').length;
  await page.selectOption('#fiPer', 'datas');
  assert.ok(await page.locator('#fiDeBox').isVisible() && await page.locator('#fiAteBox').isVisible());
  assert.equal(await focusId(page), 'fiDe');
  assert.equal(await texto(page, '#fiVerT'), 'Ver período');
  await page.click('#fiVer');
  assert.equal(await texto(page, '#fiDeErr'), 'Escolha o primeiro dia.');
  assert.equal(await texto(page, '#fiAteErr'), 'Escolha o último dia.');
  assert.equal(await page.getAttribute('#fiDe', 'aria-invalid'), 'true');
  assert.equal(await focusId(page), 'fiDe');
  await page.fill('#fiDe', '2026-07-01');
  await page.fill('#fiAte', '2026-11-13');
  await page.keyboard.press('Enter');
  assert.match(await texto(page, '#fiAteErr'), /^O extrato mostra até 93 dias de cada vez\./);
  assert.equal(await focusId(page), 'fiAte');
  await page.fill('#fiDe', '2026-11-20');
  await page.click('#fiVer');
  assert.equal(await texto(page, '#fiAteErr'), 'O último dia não pode ser antes do primeiro.');
  assert.equal(calls(log, 'pag_clinic_statement').length, antes, 'com erro nas datas, nada vai para o banco');
  await page.fill('#fiDe', '2026-10-15');
  await page.fill('#fiAte', '2026-11-05');
  await page.click('#fiVer');
  await page.waitForFunction(() => document.querySelectorAll('#fiTabela tbody tr').length === 3);
  assert.deepEqual(calls(log, 'pag_clinic_statement').at(-1).body, { p_clinic: C1, p_de: '2026-10-15', p_ate: '2026-11-05' });
  assert.equal(await page.getAttribute('#fiDe', 'aria-invalid'), null);
  assert.equal(await texto(page, '#fiAteErr'), '');
  // o banco recusa o período (regra dele): aviso simples, sem número velho na tela
  db.once.pag_clinic_statement = { status: 'invalid' };
  await page.click('#fiVer');
  await page.waitForSelector('#fiExBox .cl-note.warn');
  assert.equal(await texto(page, '#fiExBox'), 'O banco não aceitou este período. Escolha outras datas e tente de novo.');
  assert.equal(await page.locator('#fiTabela, #fiTotais').count(), 0);
  // de volta a "este mês"
  await page.selectOption('#fiPer', 'mes');
  await page.waitForFunction(() => document.querySelectorAll('#fiTabela tbody tr').length === 4);
  assert.ok(await page.locator('#fiDeBox').isHidden());
  assert.equal(await texto(page, '#fiVerT'), 'Atualizar');
  // a aba só chama as duas funções de leitura
  assert.deepEqual([...new Set(log.filter((e) => /^rpc\/pag_/.test(e.path)).map((e) => e.path))].sort(), ['rpc/pag_clinic_statement', 'rpc/pag_clinic_status']);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('papéis: o Financeiro vê só a aba Financeiro (sem pedidos, sem agenda, sem nome de paciente); recepção e profissional não veem a aba; a equipe do IMED vê', async () => {
  let { page, log, errors, context } = await newPage(browser, { role: 'finance', fin: { status: ST(), linhas: LINHAS() } });
  await abrir(page, { clicar: false });
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Financeiro');
  assert.equal(await page.locator('#noTabs').count(), 0);
  assert.match(await texto(page, '#clinicTitle + p'), /Seu papel: Financeiro/);
  await page.waitForSelector('#fiTabela');
  assert.equal(await page.locator('#fiTabela tbody tr').count(), 4);
  // nenhuma leitura de pedido, agenda ou paciente foi feita por esta conta
  assert.deepEqual(log.filter((e) => /agenda_requests|appointment_requests|agenda_view|agenda_search|agenda_request_detail|agenda_version/.test(e.path)).map((e) => e.path), []);
  assert.doesNotMatch(await page.textContent('#app'), /Paciente Que|11900000000/);
  assert.match(await texto(page, '#fiExtrato .cl-help'), /Aqui não aparece o nome do paciente/);
  assert.deepEqual(errors, []);
  await context.close();
  // recepção e profissional: sem a aba, e as funções do financeiro nem são chamadas
  for (const role of ['reception', 'professional']) {
    ({ page, log, errors, context } = await newPage(browser, { role, fin: { status: ST(), linhas: LINHAS() } }));
    await page.goto(`${BASE}painel.html`);
    await page.waitForSelector('[role=tab]');
    assert.equal(await page.locator('#tab-financeiro').count(), 0, `${role} não vê a aba`);
    await page.waitForTimeout(150);
    assert.equal(log.filter((e) => /^rpc\/pag_/.test(e.path)).length, 0, `${role}: nenhuma função do financeiro chamada`);
    await context.close();
  }
  // papel com a aba, mas o banco diz que não pode (a permissão mudou): aviso, sem números
  let db;
  ({ page, log, db, errors, context } = await newPage(browser, { role: 'manager', fin: { status: ST(), linhas: LINHAS() } }));
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-financeiro');
  db.once.pag_clinic_status = { status: 'forbidden' };
  await page.click('#tab-financeiro');
  await page.waitForSelector('#fiRoot .cl-note.warn');
  assert.equal(await texto(page, '#fiRoot'), 'Sua conta não tem permissão para ver o financeiro desta clínica.');
  assert.equal(await page.locator('#fiSituacao, #fiExtrato').count(), 0);
  assert.equal(calls(log, 'pag_clinic_statement').length, 0, 'sem permissão, o extrato nem é pedido');
  assert.deepEqual(errors, []);
  await context.close();
  // equipe do IMED (sem vínculo com a clínica): escolhe a clínica e vê o financeiro dela
  ({ page, log, errors, context } = await newPage(browser, { role: null, admin: true, fin: { status: ANALISE() } }));
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#clinicPick');
  await page.selectOption('#clinicPick', C1);
  await page.waitForSelector('#tab-financeiro');
  await page.click('#tab-financeiro');
  await page.waitForSelector('#fiSituacao[data-estado="analise"]');
  assert.deepEqual(calls(log, 'pag_clinic_status').at(-1).body, { p_clinic: C1 });
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('erros: o banco falha na situação e no extrato → aviso e "Tentar de novo" (que funciona); resposta que a tela não entende', async () => {
  const { page, log, db, errors, context } = await newPage(browser, { fin: { status: ST(), linhas: LINHAS(), erro: { status: 500, body: { message: 'erro interno' } } } });
  await abrir(page);
  await page.waitForSelector('#fiRetry');
  assert.equal(await page.getAttribute('#fiRoot .cl-note.err', 'role'), 'alert');
  assert.match(await texto(page, '#fiRoot .cl-note'), /Tente de novo/);
  assert.equal(await page.locator('#fiSituacao').count(), 0, 'com erro, nenhuma situação é mostrada (nem "não disponível")');
  db.fin.erro = null;
  db.fin.erroExtrato = { status: 500, body: { message: 'erro interno' } };
  await page.focus('#fiRetry');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#fiSituacao[data-estado="ligado"]');
  // a situação veio; o extrato falhou
  await page.waitForSelector('#fiExRetry');
  assert.equal(await page.getAttribute('#fiExBox .cl-note.err', 'role'), 'alert');
  assert.equal(await page.locator('#fiTabela, #fiTotais').count(), 0);
  db.fin.erroExtrato = null;
  await page.click('#fiExRetry');
  await page.waitForSelector('#fiTabela');
  assert.equal(await page.locator('#fiTabela tbody tr').count(), 4);
  assert.equal(calls(log, 'pag_clinic_status').length, 2);
  // resposta estranha do extrato: erro com "Tentar de novo"; da situação também
  db.once.pag_clinic_statement = { status: 'ok', linhas: 'muitas' };
  await page.click('#fiVer');
  await page.waitForSelector('#fiExRetry');
  assert.equal(await texto(page, '#fiExBox .cl-note'), 'O banco respondeu de um jeito que esta tela não entende. Tente de novo em instantes.');
  await page.click('#fiExRetry');
  await page.waitForSelector('#fiTabela');
  db.once.pag_clinic_status = { status: 'ok', situacao: 'outra_coisa' };
  await page.click('#tab-dados');
  await page.click('#tab-financeiro');
  await page.waitForSelector('#fiRetry');
  assert.equal(await texto(page, '#fiRoot .cl-note'), 'O banco respondeu de um jeito que esta tela não entende. Tente de novo em instantes.');
  await page.click('#fiRetry');
  await page.waitForSelector('#fiSituacao[data-estado="ligado"]');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('trocar de aba enquanto o banco responde: a resposta atrasada do financeiro não pinta por cima da outra aba', async () => {
  const { page, errors, context } = await newPage(browser, { fin: { status: ST(), linhas: LINHAS(), delay: 500 } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-financeiro');
  await page.click('#tab-financeiro');
  await page.click('#tab-dados');
  await page.waitForTimeout(900);
  assert.equal(await page.locator('#fiSituacao, #fiRoot').count(), 0, 'a aba Dados continua sendo a aba Dados');
  assert.equal(await page.getAttribute('#panel', 'aria-labelledby'), 'tab-dados');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (360 px): sem rolagem lateral nos dois estados, o extrato vira cartões com o nome de cada coluna, alvos de 44 px; tema escuro', async () => {
  let { page, errors, context } = await newPage(browser, { mobile: true });
  await abrir(page);
  await page.waitForSelector('#fiSituacao[data-estado="indisponivel"]');
  await noOverflow(page);
  await shot(page, 'fi-10-celular-sem-recebimento');
  assert.deepEqual(errors, []);
  await context.close();
  ({ page, errors, context } = await newPage(browser, { mobile: true, fin: { status: ST({ payment_mode: 'no_local', recebendo: false }), linhas: LINHAS() } }));
  await abrir(page);
  await page.waitForSelector('#fiTabela');
  await noOverflow(page);
  // cartões: cada célula com o nome da coluna, e o cabeçalho da tabela fora da vista (continua para o leitor de tela)
  assert.equal(await page.$eval('#fiTabela tbody td', (td) => getComputedStyle(td).display), 'grid');
  assert.deepEqual(await page.$$eval('#fiTabela tbody tr:first-child td', (t) => t.map((x) => getComputedStyle(x, '::before').content.replace(/"/g, ''))), ['Pago em', 'Exame', 'Valor do exame', 'Taxa do IMED', 'Parte da clínica', 'Situação']);
  const fora = await page.$$eval('#fiRoot *', (els) => els.filter((el) => { const r = el.getBoundingClientRect(); return !el.closest('thead, .sr') && r.width > 0 && (r.right > window.innerWidth + 0.5 || r.left < -0.5); }).map((el) => el.className || el.tagName).slice(0, 5));
  assert.deepEqual(fora, [], 'nada passa da borda da tela');
  const pequenos = await page.$$eval('#panel select, #panel button, #panel input[type="date"]', (els) => els.filter((el) => el.offsetParent && el.getBoundingClientRect().height < 43.5).map((el) => `${el.id}:${Math.round(el.getBoundingClientRect().height)}`));
  assert.deepEqual(pequenos, [], 'alvos de toque com 44 px');
  await page.selectOption('#fiPer', 'datas');
  await noOverflow(page);
  await page.click('#fiVer');
  await noOverflow(page);
  await shot(page, 'fi-11-celular-extrato');
  assert.deepEqual(errors, []);
  await context.close();
  // tema escuro: cartões e campos com as cores do tema (nenhum fundo branco)
  ({ page, errors, context } = await newPage(browser, { theme: 'dark', fin: { status: ANALISE(), linhas: LINHAS() } }));
  await abrir(page);
  await page.waitForSelector('#fiVazio, #fiTabela');
  const bg = await page.evaluate(() => ['#fiSituacao', '.fi-passos li', '#fiPer', '.fi-st-ic'].map((s) => getComputedStyle(document.querySelector(s)).backgroundColor));
  for (const c of bg) assert.notEqual(c, 'rgb(255, 255, 255)', `fundo escuro (${bg.join(', ')})`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await shot(page, 'fi-12-escuro');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('acessibilidade (axe): a aba nos 4 estados, com erro no período, no computador, no celular e no escuro, sem violação grave', async () => {
  if (!AXE) { console.log('   aviso - axe-core não encontrado: auditoria pulada (use AXE_PATH=<pasta>/node_modules/axe-core)'); return; }
  const casos = [['sem recebimento', { fin: {} }], ['em análise', { fin: { status: ANALISE() } }], ['desligado', { fin: { status: ST({ payment_mode: 'no_local', recebendo: false }), linhas: LINHAS() } }],
    ['ligado com extrato', { fin: { status: ST(), linhas: LINHAS() } }]];
  for (const extra of [{}, { mobile: true }, { theme: 'dark' }]) {
    for (const [nome, o] of casos) {
      const { page, errors, context } = await newPage(browser, { ...o, ...extra, bypassCSP: true });
      await abrir(page);
      await page.waitForSelector('#fiSituacao');
      if (await page.locator('#fiExtrato').count()) await page.waitForSelector('#fiVazio, #fiTabela');
      const onde = `${nome}${extra.mobile ? ', celular' : ''}${extra.theme ? ', escuro' : ''}`;
      assert.deepEqual(await runAxe(page), [], onde);
      if (nome === 'ligado com extrato') {
        await page.selectOption('#fiPer', 'datas');
        await page.click('#fiVer');
        assert.deepEqual(await runAxe(page), [], `${onde}, com erro nas datas`);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  const { page, context } = await newPage(browser, { fin: { erro: { status: 500, body: { message: 'x' } } }, bypassCSP: true });
  await abrir(page);
  await page.waitForSelector('#fiRetry');
  assert.deepEqual(await runAxe(page), [], 'erro com "Tentar de novo"');
  await context.close();
});

// Fotos (só com FOTOS=pasta): dados simulados, em 2x. Não confere nada: os cenários de cima já conferiram.
if (FOTOS) {
  await scenario('fotos: aba Financeiro sem recebimento e ligada com extrato, no computador e no celular', async () => {
    const foto = async (nome, opts) => {
      const { page, context } = await newPage(browser, { dsf: 2, ...opts });
      await abrir(page);
      await page.waitForSelector('#fiSituacao');
      if (await page.locator('#fiExtrato').count()) await page.waitForSelector('#fiVazio, #fiTabela');
      await page.evaluate(() => document.fonts.ready);
      // só para a foto: o topo fixo não cobre o meio da página inteira
      await page.addStyleTag({ content: '.pt-top{position:static!important}' });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(FOTOS, `${nome}.png`), fullPage: true });
      await context.close();
    };
    await foto('financeiro-sem-recebimento-computador', { width: 1280 });
    await foto('financeiro-sem-recebimento-celular', { mobile: true });
    await foto('financeiro-ligado-extrato-computador', { width: 1280, fin: { status: ST(), linhas: LINHAS() } });
    await foto('financeiro-ligado-extrato-celular', { mobile: true, fin: { status: ST(), linhas: LINHAS() } });
    await foto('financeiro-em-analise-computador', { width: 1280, fin: { status: ANALISE() } });
    await foto('financeiro-ligado-extrato-escuro', { width: 1280, theme: 'dark', fin: { status: ST(), linhas: LINHAS() } });
  });
}

await browser.close();
server.close();
const bad = results.filter(([r]) => r !== 'ok');
console.log(`\n${results.length - bad.length}/${results.length} cenários ok`);
if (bad.length) process.exit(1);
