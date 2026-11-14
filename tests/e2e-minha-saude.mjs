// Teste de ponta a ponta do "Minha Saúde", etapa 1 (minha-saude.html), num navegador de verdade (Playwright), com o
// Supabase simulado EM MEMÓRIA no mesmo contrato da migração ws_minha_saude (saude_*) e da teleconsulta (tele_status,
// tele_patient_documents, tele_patient_document_pdf).
// Cenários: sem conta (só o que é deste aparelho, abas pelo teclado, documentos, PDF baixado, nada novo guardado no
// aparelho, nenhuma função da conta chamada); com conta (guardar na conta, a consulta em outro aparelho, entrada
// antiga, tirar da conta com confirmação, sair de todos os aparelhos); guardar desligado e banco de antes; respostas
// de recusa; trava depois de 30 minutos parado; celular de 360 px e tema escuro.
// Rodar com: node tests/e2e-minha-saude.mjs   (SHOTS=pasta salva capturas; E2E_PORT muda a porta; ONLY="trecho")
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, vigiarChaves } from './regra-chaves.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const PORT = Number(process.env.E2E_PORT) || 4791;
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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('não encontrado'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const NOW = '2026-11-14T15:00:00Z'; // 12:00 em São Paulo
const USER = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const EMAIL = 'paciente@exemplo.test';
const C1 = 'c1111111-1111-4111-8111-111111111111';
const C2 = 'c2222222-2222-4222-8222-222222222222';
const C3 = 'c3333333-3333-4333-8333-333333333333';
const TOK = (n) => String(n).repeat(64);
const D = (n) => `d${n}000000-0000-4000-8000-00000000000${n}`;
const PDF = Buffer.from('%PDF-1.7 documento de teste').toString('base64');
const MEDICA = { full_name: 'Dra. Teste da Silva', crm: '123456', crm_uf: 'SP', rqe: null, specialty: null };
// As consultas que existem no banco simulado (o aparelho guarda só id e código; a conta, só o vínculo).
const CONSULTAS = () => ({
  [C1]: { token: TOK(1), status: 'ended', created_at: '2026-11-12T14:00:00Z', ended_at: '2026-11-12T14:30:00Z', doctor: MEDICA, docs: [
    { id: D(1), kind: 'receita', code: '2222233333', status: 'emitido', created_at: '2026-11-12T14:20:00Z', signed: true, signed_at: '2026-11-12T14:40:00Z', pdf: true, payload: { itens: ['conteúdo reservado'] } },
    { id: D(2), kind: 'atestado', code: '4444455555', status: 'emitido', created_at: '2026-11-12T14:22:00Z', signed: false, signed_at: null, pdf: false, payload: { texto: 'conteúdo reservado' } },
    { id: D(3), kind: 'exames', code: '6666677777', status: 'cancelado', cancel_reason: 'emitido por engano', created_at: '2026-11-12T14:25:00Z', cancelled_at: '2026-11-12T14:26:00Z', signed: true, signed_at: '2026-11-12T14:25:30Z', pdf: true, payload: null },
  ] },
  [C2]: { token: TOK(2), status: 'ended', created_at: '2026-11-05T13:00:00Z', ended_at: '2026-11-05T13:20:00Z', doctor: MEDICA, docs: [] },
  [C3]: { token: TOK(3), status: 'in_call', created_at: '2026-11-14T14:50:00Z', ended_at: null, doctor: MEDICA, docs: [] },
});
const APPTS = [
  { type: 'pedido', id: 'b1111111-1111-4111-8111-111111111111', code: 'IMED-B1111111', token: 't'.repeat(64), name: 'Clínica Boa Imagem', slot: '2026-11-20T13:00:00.000Z', tz: 'America/Sao_Paulo', date: '2026-11-20', status: 'confirmado' },
  { type: 'pedido', id: 'b2222222-2222-4222-8222-222222222222', token: 'u'.repeat(64), name: 'Laboratório Central', date: '2026-11-25', status: 'pendente' },
];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
const NOFN = (fn) => ({ code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache`, details: null, hint: null });

// aparelho: ids das consultas guardadas neste aparelho (a 1ª é a "atual"). conta: { ligado, recente, vinculos: [ids] }
// ou null (sem entrar). semFuncoes: banco de antes (as funções saude_* não existem).
async function newPage(browser, { mobile = false, width = 1280, theme = null, logged = false, aparelho = [], appts = [], conta = { ligado: true, recente: true, vinculos: [] }, semFuncoes = false, once = {}, bypassCSP = false } = {}) {
  const context = await browser.newContext({
    bypassCSP, // só para injetar o axe (a página tem script-src 'self')
    viewport: mobile ? { width, height: 780 } : { width, height: 900 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', acceptDownloads: true, colorScheme: theme === 'dark' ? 'dark' : 'light',
  });
  await context.clock.install({ time: new Date(NOW) });
  const db = { consultas: CONSULTAS(), ligado: conta.ligado, recente: conta.recente, vinculos: new Map((conta.vinculos || []).map((id) => [id, USER])), semFuncoes, once: { ...once }, trilha: [] };
  const log = [];
  const sessao = logged ? { access_token: 'tok-init', refresh_token: 'ref', expires_at: Math.floor(Date.parse(NOW) / 1000) + 3600, user: { id: USER, email: EMAIL } } : null;
  const hist = aparelho.map((id) => ({ id, token: db.consultas[id].token, at: db.consultas[id].created_at, saved: '2026-11-13T12:00:00Z' }));
  await context.addInitScript(([s, h, a, t]) => {
    try {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('imed_lgpd', '1');
      if (t) localStorage.setItem('imed_tema', t);
      if (s) localStorage.setItem('imed_session', JSON.stringify(s));
      if (h.length) localStorage.setItem('imed_tele_hist', JSON.stringify(h));
      if (a.length) localStorage.setItem('imed_appts', JSON.stringify(a));
    } catch { /* sem armazenamento */ }
  }, [sessao, hist, appts, theme === 'dark' ? 'escuro' : null]);
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
    const auth = req.headers().authorization || '';
    const entrou = /^Bearer tok-/.test(auth);
    const path = url.pathname;
    log.push({ path, q: url.search, body, entrou });
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
    if (path === '/auth/v1/token') return json(route, { access_token: 'tok-novo', refresh_token: 'ref2', expires_in: 3600, user: { id: USER, email: EMAIL } });
    if (path === '/auth/v1/user') return entrou ? json(route, { id: USER, email: EMAIL }) : json(route, { msg: 'invalid' }, 401);
    const fn = path.replace('/rest/v1/rpc/', '');
    if (db.once[fn]) { const r = db.once[fn]; delete db.once[fn]; return json(route, r); }
    const pelaChave = () => { const c = db.consultas[body?.p_id]; return c && c.token === body?.p_token ? c : null; };
    const docDaLista = (d) => ({ id: d.id, kind: d.kind, code: d.code, created_at: d.created_at, cancelled_at: d.cancelled_at ?? null, cancel_reason: d.cancel_reason ?? null, signed: d.signed, signed_at: d.signed_at });
    switch (fn) {
      case 'tele_status': { const c = pelaChave(); return json(route, c ? [{ status: c.status, position: null, doctors_online: 1, doctor: c.doctor, created_at: c.created_at, ended_at: c.ended_at, patient_name: 'Nome Reservado do Paciente', exams: [], indication: null, guidance: 'orientação reservada' }] : []); }
      case 'tele_patient_documents': { const c = pelaChave(); return json(route, c ? c.docs.map((d) => ({ ...docDaLista(d), status: d.status, payload: d.status === 'emitido' ? d.payload : null, doctor_snapshot: {}, patient_snapshot: { name: 'Nome Reservado do Paciente' } })) : []); }
      case 'tele_patient_document_pdf': { const c = pelaChave(); const d = c?.docs.find((x) => x.id === body.p_doc); if (!d) return json(route, { code: 'P0001', message: 'nao_encontrado' }, 400); return json(route, d.pdf ? PDF : null); }
    }
    if (fn.startsWith('saude_')) {
      if (db.semFuncoes) return json(route, NOFN(fn), 404);
      if (!entrou) return json(route, { code: '42501', message: 'permission denied for function' }, 401);
      const meu = (id) => db.vinculos.get(id) === USER;
      switch (fn) {
        case 'saude_minhas_consultas':
          return json(route, { status: 'ok', can_save: db.ligado, recent: db.recente, items: [...db.vinculos].filter(([, u]) => u === USER).map(([id]) => { const c = db.consultas[id]; return { consultation_id: id, saved_at: '2026-11-13T18:00:00Z', consultation_status: c.status, created_at: c.created_at, ended_at: c.ended_at, doctor: { name: c.doctor.full_name, crm: c.doctor.crm, crm_uf: c.doctor.crm_uf }, documents: c.docs.filter((d) => d.status === 'emitido').length }; }) });
        case 'saude_guardar': {
          if (!db.ligado) return json(route, { status: 'off' });
          const c = db.consultas[body?.p_consulta];
          if (!c || c.token !== body?.p_token) { db.trilha.push('codigo_errado'); return json(route, { status: 'not_found' }); }
          if (meu(body.p_consulta)) return json(route, { status: 'ok', unchanged: true });
          if (db.vinculos.has(body.p_consulta)) return json(route, { status: 'already_linked' });
          db.vinculos.set(body.p_consulta, USER);
          return json(route, { status: 'ok' });
        }
        case 'saude_vinculo_revogar': if (!meu(body?.p_consulta)) return json(route, { status: 'not_found' }); db.vinculos.delete(body.p_consulta); return json(route, { status: 'ok' });
        case 'saude_documentos': {
          if (!meu(body?.p_consulta)) return json(route, { status: 'not_found' });
          if (!db.recente) return json(route, { status: 'reauth' });
          return json(route, { status: 'ok', items: db.consultas[body.p_consulta].docs.map((d) => ({ ...docDaLista(d), document_status: d.status, has_pdf: d.pdf })) });
        }
        case 'saude_documento_pdf': {
          const par = Object.entries(db.consultas).find(([id, c]) => meu(id) && c.docs.some((d) => d.id === body?.p_doc));
          if (!par) return json(route, { status: 'not_found' });
          if (!db.recente) return json(route, { status: 'reauth' });
          const d = par[1].docs.find((x) => x.id === body.p_doc);
          if (d.status === 'cancelado') return json(route, { status: 'cancelled' });
          return json(route, d.pdf ? { status: 'ok', kind: d.kind, code: d.code, pdf: PDF } : { status: 'no_pdf' });
        }
      }
    }
    return json(route, { message: `não simulado: ${path}` }, 404);
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push(`diálogo inesperado: ${d.message()}`); d.dismiss(); });
  return { context, page, log, db, errors };
}

const chamadas = (log, fn) => log.filter((e) => e.path === `/rest/v1/rpc/${fn}`);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
const focusId = (page) => page.evaluate(() => document.activeElement?.id || '');
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const semRolagem = async (page) => { const sw = await page.evaluate(() => document.documentElement.scrollWidth); assert.ok(sw <= page.viewportSize().width, `sem rolagem lateral (${sw}px em ${page.viewportSize().width}px)`); };
const abrir = async (page, aba = '') => { await page.goto(`${BASE}minha-saude.html${aba ? `#${aba}` : ''}`); await page.waitForFunction(() => !document.querySelector('#msConsultas[aria-busy]') && document.querySelector('#msConsultas')?.children.length > 0); };
const cartao = (page, id) => page.locator(`#msC-${id}`);

const results = [];
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try { await Promise.race([comChaves(fn), limite(name)]); results.push(['ok', name]); console.log(`ok  ${name}`); } catch (e) { results.push(['FALHOU', name]); console.log(`FALHOU  ${name}\n   ${e.stack || e.message}`); }
}
const browser = vigiarChaves(await chromium.launch());

await scenario('sem conta: só o que é deste aparelho; abas pelo teclado; documentos com a situação por extenso; PDF baixado; nada novo guardado no aparelho', async () => {
  const { page, log, errors, context } = await newPage(browser, { aparelho: [C1, C2], appts: APPTS });
  const antes = () => page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort()));
  await abrir(page);
  const chaves = await antes();
  assert.equal(await page.title(), 'Minha Saúde · IMED');
  assert.equal(await page.getAttribute('meta[name="robots"]', 'content'), 'noindex');
  assert.equal(await page.locator('script[src*="visitas"]').count(), 0, 'página de saúde sem contador de visitas');
  assert.equal(await page.isVisible('#signedOut'), true);
  assert.ok(await page.locator('#loginForm [data-senha]').count(), 'o quadro de entrada tem e-mail e senha');
  // aba Agendamentos (a primeira): os dois deste aparelho, com o link para Minha conta
  assert.deepEqual(await page.locator('#msTabs [role="tab"]').evaluateAll((els) => els.map((e) => [e.textContent, e.getAttribute('aria-selected'), e.tabIndex])),
    [['Agendamentos', 'true', 0], ['Consultas e documentos', 'false', -1], ['Na minha conta', 'false', -1]]);
  assert.deepEqual(await page.locator('#msAgLista .ms-ag').evaluateAll((els) => els.map((e) => [e.querySelector('h3').textContent, [...e.querySelectorAll('p')].map((p) => p.textContent.trim()), e.querySelector('a').getAttribute('href')])), [
    ['Clínica Boa Imagem', ['20/11/2026 às 10:00', 'Código IMED-B1111111'], 'conta.html#pedido-b1111111-1111-4111-8111-111111111111'],
    ['Laboratório Central', ['25/11/2026 (data preferida)', 'Código IMED-B2222222'], 'conta.html#pedido-b2222222-2222-4222-8222-222222222222'],
  ]);
  // abas pelo teclado: seta para a direita, Home e End
  await page.focus('#msTab-agendamentos');
  await page.keyboard.press('ArrowRight');
  assert.equal(await focusId(page), 'msTab-consultas');
  assert.equal(await page.isVisible('#msPanel-consultas'), true);
  assert.equal(await page.isVisible('#msPanel-agendamentos'), false);
  await page.keyboard.press('End');
  assert.equal(await focusId(page), 'msTab-conta');
  assert.match(norm(await page.textContent('#msGuardadas')), /Entre na sua conta, no quadro acima/);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  // as duas consultas deste aparelho, a mais nova primeiro
  assert.deepEqual(await page.locator('#msConsultas .ms-card').evaluateAll((els) => els.map((e) => [e.querySelector('h3').textContent, e.querySelector('p').textContent.trim(), [...e.querySelectorAll('.ms-tag')].map((t) => t.textContent)])), [
    ['Teleconsulta de 12/11/2026', 'Dra. Teste da Silva · CRM-SP 123456', ['Encerrada', 'Neste aparelho']],
    ['Teleconsulta de 05/11/2026', 'Dra. Teste da Silva · CRM-SP 123456', ['Encerrada', 'Neste aparelho']],
  ]);
  assert.equal(await page.locator('[data-guardar]').count(), 0, 'sem conta, sem "Guardar na minha conta"');
  assert.doesNotMatch(await page.textContent('#msConsultas'), /Guardar na conta|guardá-la/, 'sem entrar não dá para saber se guardar está ligado: a tela não promete nem nega');
  assert.doesNotMatch(await page.textContent('#msConsultas'), /Nome Reservado|orientação reservada/, 'nada do conteúdo da consulta na lista');
  // os documentos só aparecem depois do toque
  assert.equal(await cartao(page, C1).locator('.ms-doc').count(), 0);
  const botao = cartao(page, C1).locator('[data-docs]');
  assert.equal(await botao.getAttribute('aria-expanded'), 'false');
  await botao.focus();
  await page.keyboard.press('Enter');
  await cartao(page, C1).locator('.ms-docs').waitFor();
  assert.equal(await focusId(page), `msDocsT-${C1}`, 'o foco vai para o título dos documentos');
  assert.deepEqual(await cartao(page, C1).locator('.ms-doc').evaluateAll((els) => els.map((e) => [...e.querySelector('div').children].map((c) => c.textContent))), [
    ['Receita', 'Assinado pelo médico em 12/11/2026 às 11:40', 'Código de conferência: 22222-33333'],
    ['Atestado médico', 'Aguardando a assinatura do médico. Sem a assinatura, o documento ainda não vale.', 'Código de conferência: 44444-55555'],
    ['Solicitação de exames', 'Cancelado pelo médico: emitido por engano', 'Código de conferência: 66666-77777'],
  ]);
  assert.deepEqual(await cartao(page, C1).locator('.ms-doc').evaluateAll((els) => els.map((e) => [!!e.querySelector('[data-pdf]'), e.querySelector('a')?.getAttribute('href') ?? null])),
    [[true, 'documento.html?c=2222233333'], [false, 'documento.html?c=4444455555'], [false, null]], 'só o assinado baixa; o cancelado não baixa nem leva à conferência');
  assert.doesNotMatch(await cartao(page, C1).textContent(), /conteúdo reservado|Nome Reservado/, 'o conteúdo do documento não vai para a tela');
  // baixar o PDF assinado
  const [download] = await Promise.all([page.waitForEvent('download'), cartao(page, C1).locator('[data-pdf]').click()]);
  assert.equal(download.suggestedFilename(), 'IMED-receita-22222-33333-assinado.pdf');
  assert.match(norm(await cartao(page, C1).locator('.ms-msg').textContent()), /PDF assinado baixado\./);
  assert.deepEqual(chamadas(log, 'tele_patient_document_pdf').at(-1).body, { p_id: C1, p_token: TOK(1), p_doc: D(1) });
  // a consulta sem documentos
  await cartao(page, C2).locator('[data-docs]').click();
  await page.waitForFunction((id) => /não emitiu documentos/.test(document.querySelector(`#msDocs-${id}`)?.textContent || ''), C2);
  // esconder devolve o foco ao botão
  await cartao(page, C1).locator('[data-docs]').click();
  assert.equal(await cartao(page, C1).locator('.ms-doc').count(), 0);
  assert.equal(await cartao(page, C1).locator('[data-docs]').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(log.filter((e) => /saude_/.test(e.path)), [], 'sem conta, nenhuma função da conta é chamada');
  assert.equal(await antes(), chaves, 'a página não guarda nada novo no aparelho');
  await shot(page, 'ms-1-sem-conta');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('com conta: guardar na conta manda o código do aparelho; a consulta aparece em "Na minha conta"; tirar pede confirmação', async () => {
  const { page, log, db, errors, context } = await newPage(browser, { logged: true, aparelho: [C1, C3] });
  await abrir(page, 'consultas');
  assert.equal(norm(await page.textContent('#meEmail')), EMAIL);
  // a consulta em andamento não guarda nem abre documentos aqui: leva de volta para a consulta
  assert.equal(await cartao(page, C3).locator('[data-guardar], [data-docs]').count(), 0);
  assert.equal(await cartao(page, C3).locator('a[href="teleconsulta.html"]').first().textContent().then(norm), 'Voltar para a consulta');
  assert.match(norm(await cartao(page, C3).textContent()), /Depois que a consulta terminar, você pode guardá-la na sua conta\./);
  const guardar = cartao(page, C1).locator('[data-guardar]');
  assert.equal(norm(await guardar.textContent()), 'Guardar na minha conta');
  await guardar.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction((id) => /Consulta guardada na sua conta/.test(document.querySelector(`#msMsg-${id}`)?.textContent || ''), C1);
  assert.deepEqual(chamadas(log, 'saude_guardar').map((e) => e.body), [{ p_consulta: C1, p_token: TOK(1) }]);
  assert.equal(db.vinculos.get(C1), USER);
  assert.deepEqual(await cartao(page, C1).locator('.ms-tag').allTextContents(), ['Encerrada', 'Neste aparelho', 'Na sua conta', '2 documentos']);
  assert.equal(await cartao(page, C1).locator('[data-guardar]').count(), 0, 'já guardada: o botão some');
  // os documentos agora vêm pela conta
  await cartao(page, C1).locator('[data-docs]').click();
  await cartao(page, C1).locator('.ms-docs').waitFor();
  assert.deepEqual(chamadas(log, 'saude_documentos').map((e) => e.body), [{ p_consulta: C1 }]);
  assert.equal(chamadas(log, 'tele_patient_documents').length, 0);
  const [download] = await Promise.all([page.waitForEvent('download'), cartao(page, C1).locator('[data-pdf]').click()]);
  assert.equal(download.suggestedFilename(), 'IMED-receita-22222-33333-assinado.pdf');
  assert.deepEqual(chamadas(log, 'saude_documento_pdf').at(-1).body, { p_doc: D(1) });
  // aba "Na minha conta"
  await page.click('#msTab-conta');
  assert.deepEqual(await page.locator('#msGuardadas .ms-card').evaluateAll((els) => els.map((e) => [e.querySelector('h3').textContent, [...e.querySelectorAll('p')].map((p) => p.textContent.trim())])),
    [['Teleconsulta de 12/11/2026', ['Dra. Teste da Silva · CRM-SP 123456', 'Guardada na conta em 13/11/2026 às 15:00']]]);
  assert.match(norm(await page.textContent('.ms-quem')), /a clínica onde você marca exames não vê suas consultas nem seus documentos/);
  await page.click(`[data-tirar="${C1}"]`);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.tirarSim), C1, 'o foco vai para a confirmação');
  assert.match(norm(await page.textContent(`#msQ-${C1}`)), /Tirar esta consulta da sua conta\? Os documentos deixam de abrir pela conta\. O registro do médico não muda/);
  await page.click(`[data-tirar-nao="${C1}"]`);
  assert.equal(db.vinculos.has(C1), true, '"Não tirar" não tira');
  await page.click(`[data-tirar="${C1}"]`);
  await page.click(`[data-tirar-sim="${C1}"]`);
  await page.waitForFunction(() => /Nenhuma teleconsulta guardada na sua conta/.test(document.querySelector('#msGuardadas')?.textContent || ''));
  assert.equal(db.vinculos.has(C1), false);
  assert.equal(await focusId(page), 'msGuardadasT');
  await page.click('#msTab-consultas');
  assert.deepEqual(await cartao(page, C1).locator('.ms-tag').allTextContents(), ['Encerrada', 'Neste aparelho'], 'volta a ser só deste aparelho, e pode ser guardada de novo');
  assert.equal(await cartao(page, C1).locator('[data-guardar]').count(), 1);
  await shot(page, 'ms-2-com-conta');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('em outro aparelho: a consulta guardada abre pela conta; entrada antiga pede para entrar de novo; sair fecha em todos os aparelhos', async () => {
  let { page, log, errors, context } = await newPage(browser, { logged: true, conta: { ligado: true, recente: true, vinculos: [C1] } });
  await abrir(page);
  // sem agendamento e sem consulta neste aparelho: começa em Agendamentos (vazio), e a conta traz a consulta
  assert.match(norm(await page.textContent('#msAgLista')), /Nenhum agendamento neste aparelho\./);
  await page.click('#msTab-consultas');
  assert.deepEqual(await cartao(page, C1).locator('.ms-tag').allTextContents(), ['Encerrada', 'Na sua conta', '2 documentos']);
  assert.equal(await cartao(page, C1).locator('a[href="teleconsulta.html"]').count(), 0, 'fora do aparelho da consulta não há atalho para a página da teleconsulta');
  await cartao(page, C1).locator('[data-docs]').click();
  await cartao(page, C1).locator('.ms-docs').waitFor();
  assert.equal(await cartao(page, C1).locator('.ms-doc').count(), 3);
  assert.equal(chamadas(log, 'tele_status').length, 0, 'nenhum código de aparelho é usado');
  assert.deepEqual(errors, []);
  await context.close();

  // entrada com mais de 12 horas: a lista aparece, os documentos pedem nova entrada
  ({ page, log, errors, context } = await newPage(browser, { logged: true, conta: { ligado: true, recente: false, vinculos: [C1] } }));
  await abrir(page, 'consultas');
  await cartao(page, C1).locator('[data-docs]').click();
  await page.waitForSelector('[data-sair]');
  assert.match(norm(await cartao(page, C1).textContent()), /os documentos só abrem com entrada feita há menos de 12 horas\. Saia e entre de novo\./);
  assert.equal(await cartao(page, C1).locator('.ms-doc').count(), 0);
  await page.click('[data-sair]');
  await page.waitForSelector('#signedOut:not([hidden])');
  assert.deepEqual(log.filter((e) => e.path === '/auth/v1/logout').map((e) => e.q), ['?scope=global'], 'sair encerra a conta em todos os aparelhos');
  assert.equal(await focusId(page), 'email');
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_session')), null);
  assert.match(norm(await page.textContent('#msConsultas')), /Nenhuma teleconsulta neste aparelho\./, 'sem a conta, o que era dela some da tela');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('neste aparelho com a entrada antiga: a consulta guardada continua abrindo pelo código do aparelho', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true, aparelho: [C1], conta: { ligado: true, recente: false, vinculos: [C1] } });
  await abrir(page, 'consultas');
  await cartao(page, C1).locator('[data-docs]').click();
  await cartao(page, C1).locator('.ms-docs').waitFor();
  assert.equal(await cartao(page, C1).locator('.ms-doc').count(), 3);
  assert.equal(chamadas(log, 'saude_documentos').length, 1, 'tentou pela conta');
  assert.equal(chamadas(log, 'tele_patient_documents').length, 1, 'e abriu pelo aparelho');
  assert.equal(await cartao(page, C1).locator('[data-pdf]').getAttribute('data-via'), 'aparelho');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('guardar desligado, banco de antes e recusas: a tela diz a verdade e não quebra', async () => {
  // desligado (como vai nascer na produção): sem botão, com a explicação
  let { page, log, errors, context } = await newPage(browser, { logged: true, aparelho: [C1], conta: { ligado: false, recente: true, vinculos: [] } });
  await abrir(page, 'consultas');
  assert.equal(await page.locator('[data-guardar]').count(), 0);
  assert.match(norm(await cartao(page, C1).textContent()), /Guardar na conta ainda não está disponível\. Por enquanto esta consulta aparece só neste aparelho\./);
  await page.click('#msTab-conta');
  assert.match(norm(await page.textContent('#msGuardadas')), /Guardar teleconsultas na conta ainda não está disponível/);
  assert.deepEqual(errors, []);
  await context.close();

  // banco de antes (sem as funções saude_*): tudo o que é do aparelho funciona
  ({ page, log, errors, context } = await newPage(browser, { logged: true, aparelho: [C1], semFuncoes: true }));
  await abrir(page, 'consultas');
  assert.equal(await page.locator('[data-guardar]').count(), 0);
  await cartao(page, C1).locator('[data-docs]').click();
  await cartao(page, C1).locator('.ms-docs').waitFor();
  assert.equal(await cartao(page, C1).locator('.ms-doc').count(), 3);
  await page.click('#msTab-conta');
  assert.match(norm(await page.textContent('#msGuardadas')), /ainda não está disponível/);
  assert.equal(chamadas(log, 'saude_minhas_consultas').length, 1, 'perguntou uma vez e seguiu sem');
  assert.deepEqual(errors, []);
  await context.close();

  // recusas do banco ao guardar: cada uma com a sua frase, e o botão continua lá
  for (const [status, frase] of [['already_linked', /já está guardada em outra conta/], ['too_many', /Muitas tentativas seguidas\. Espere uma hora/], ['not_found', /Não achamos esta consulta/], ['off', /ainda não está disponível/]]) {
    ({ page, errors, context } = await newPage(browser, { logged: true, aparelho: [C1], once: { saude_guardar: { status } } }));
    await abrir(page, 'consultas');
    await cartao(page, C1).locator('[data-guardar]').click();
    await page.waitForFunction((id) => document.querySelector(`#msMsg-${id} .ms-nota.warn`), C1);
    assert.match(norm(await cartao(page, C1).locator('.ms-msg').textContent()), frase, status);
    assert.equal(await cartao(page, C1).locator('[data-guardar]:not([disabled])').count(), 1, status);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('30 minutos sem mexer com documentos à mostra: a página fecha os documentos; "Continuar usando" volta', async () => {
  const { page, errors, context } = await newPage(browser, { aparelho: [C1] });
  await abrir(page, 'consultas');
  await cartao(page, C1).locator('[data-docs]').click();
  await cartao(page, C1).locator('.ms-docs').waitFor();
  await context.clock.fastForward('29:00');
  assert.equal(await page.isVisible('#msLock'), false, 'aos 29 minutos, nada');
  assert.equal(await cartao(page, C1).locator('.ms-doc').count(), 3);
  await context.clock.fastForward('02:00');
  await page.waitForSelector('#msLock:not([hidden])');
  assert.match(norm(await page.textContent('#msLock')), /os documentos foram fechados depois de 30 minutos sem uso/);
  assert.equal(await page.locator('.ms-doc').count(), 0, 'nenhum documento na tela');
  await page.click('#msDestravar');
  assert.equal(await page.isVisible('#msLock'), false);
  assert.equal(await focusId(page), 'msConsultasT');
  assert.equal(await cartao(page, C1).locator('[data-docs]').getAttribute('aria-expanded'), 'false', 'os documentos voltam fechados: a pessoa abre de novo');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular de 360 px e tema escuro: sem rolagem lateral, botões de 44 px, cartões com a cor do tema', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, width: 360, theme: 'dark', logged: true, aparelho: [C1, C2], appts: APPTS, conta: { ligado: true, recente: true, vinculos: [C2] } });
  await abrir(page);
  await semRolagem(page);
  await page.click('#msTab-consultas');
  await cartao(page, C1).locator('[data-docs]').click();
  await cartao(page, C1).locator('.ms-docs').waitFor();
  await semRolagem(page);
  const alturas = await page.locator('#msTabs [role="tab"], #msPanel-consultas .btn, #logoutBtn').evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)));
  assert.ok(alturas.length >= 8 && alturas.every((h) => h >= 44), `alvos de toque com 44 px ou mais (${alturas})`);
  const fundos = await page.evaluate(() => ['.ms-card', '.ms-doc', '#msTabs [role="tab"][aria-selected="false"]'].map((s) => getComputedStyle(document.querySelector(s)).backgroundColor));
  for (const c of fundos) assert.notEqual(c, 'rgb(255, 255, 255)', `fundo do tema escuro (${fundos.join(' | ')})`);
  await shot(page, 'ms-3-celular-escuro');
  await page.click('#msTab-conta');
  await semRolagem(page);
  await shot(page, 'ms-4-celular-escuro-conta');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('acessibilidade (axe, WCAG 2.2 A e AA e boas práticas): claro e escuro, computador e celular, com os documentos e a confirmação à mostra', async () => {
  if (!AXE) { console.log('   aviso - axe-core não encontrado: auditoria pulada (use AXE_PATH=<pasta>/node_modules/axe-core)'); return; }
  for (const [mobile, theme] of [[false, null], [false, 'dark'], [true, null], [true, 'dark']]) {
    const { page, errors, context } = await newPage(browser, { bypassCSP: true, mobile, width: mobile ? 390 : 1280, theme, logged: true, aparelho: [C1, C2], appts: APPTS, conta: { ligado: true, recente: true, vinculos: [C2] } });
    await abrir(page);
    const auditar = async (onde) => {
      await page.addScriptTag({ path: AXE });
      const v = await page.evaluate(async () => {
        const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] });
        return r.violations.map((x) => `${x.id} (${x.impact}): ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      });
      assert.deepEqual(v, [], `${onde}, ${mobile ? 'celular' : 'computador'}, ${theme === 'dark' ? 'escuro' : 'claro'}`);
    };
    await auditar('agendamentos');
    await page.click('#msTab-consultas');
    await cartao(page, C1).locator('[data-docs]').click();
    await cartao(page, C1).locator('.ms-docs').waitFor();
    await auditar('consultas com os documentos abertos');
    await page.click('#msTab-conta');
    await page.click(`[data-tirar="${C2}"]`);
    await auditar('na minha conta, com a confirmação de tirar');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // sem conta (o quadro de entrada à mostra)
  const { page, context } = await newPage(browser, { bypassCSP: true, aparelho: [C1] });
  await abrir(page);
  await page.addScriptTag({ path: AXE });
  const v = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`));
  assert.deepEqual(v, [], 'sem conta');
  await context.close();
});

await scenario('todo ícone da página está no recorte de ícones do site', async () => {
  const css = await readFile(join(ROOT, 'assets/vendor/fa/css/icones.min.css'), 'utf8');
  const fontes = (await readFile(join(ROOT, 'assets/js/minha-saude.js'), 'utf8')) + (await readFile(join(ROOT, 'minha-saude.html'), 'utf8'));
  const usados = [...new Set(fontes.match(/fa-[a-z0-9-]+/g))].filter((n) => !['fa-solid', 'fa-regular', 'fa-brands'].includes(n));
  assert.ok(usados.length >= 8);
  for (const n of usados) assert.ok(new RegExp(`\\.${n}:before[,{]`).test(css), `${n} fora do recorte de ícones`);
});

await browser.close();
server.close();
const bad = results.filter(([r]) => r !== 'ok');
console.log(`\n${results.length - bad.length}/${results.length} cenários ok`);
if (bad.length) process.exit(1);
