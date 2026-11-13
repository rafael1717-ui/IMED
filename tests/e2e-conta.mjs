// Teste de ponta a ponta de "Minha conta" (conta.html) e das páginas por cidade (cidades/**),
// num navegador de verdade (Playwright), com o Supabase (login, banco e funções) simulado.
// Rodar com: node tests/e2e-conta.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta node tests/e2e-conta.mjs  salva capturas de tela nessa pasta.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { comChaves, vigiarChaves } from './regra-chaves.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const REST = `${SUPA}/rest/v1/`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('não encontrado');
  }
});
const PORT = Number(process.env.E2E_PORT) || 8769; // E2E_PORT: outra porta para rodar em paralelo
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;

// ---------- dados simulados ----------
const ID = {
  d1: '11111111-1111-4111-8111-111111111111', // aparelho, concluído, sem avaliação
  d2: '22222222-2222-4222-8222-222222222222', // aparelho e conta (não pode duplicar)
  d4: '44444444-4444-4444-8444-444444444444', // aparelho, concluído; servidor diz que já foi avaliado
  a2: '55555555-5555-4555-8555-555555555555', // só na conta, concluído (servidor responde not_completed)
  a3: '66666666-6666-4666-8666-666666666666', // só na conta, cancelado
};
const TOK = { d1: 'a'.repeat(64), d2: 'b'.repeat(64), d4: 'c'.repeat(64) };
const DEVICE = [
  { type: 'pedido', code: 'IMED-11111111', id: ID.d1, token: TOK.d1, place_key: 'cnes:2077485', name: 'Hospital Santa Exemplo', exam: 'rm', items: ['Ressonância'], date: '2026-11-12', period: 'manha', status: 'pendente', created: '2026-10-29T12:00:00.000Z' },
  { type: 'pedido', code: 'IMED-22222222', id: ID.d2, token: TOK.d2, place_key: 'imed:x', name: 'Imagem Paulista', exam: 'tc', items: ['Tomografia'], date: '2026-11-20', period: 'tarde', status: 'pendente', created: '2026-10-28T12:00:00.000Z' },
  { type: 'pedido', code: 'IMED-44444444', id: ID.d4, token: TOK.d4, place_key: 'osm:node/1', name: 'Laboratório Vida', exam: 'lab', items: ['Exames de laboratório'], date: '2026-11-05', period: 'qualquer', status: 'pendente', created: '2026-10-27T12:00:00.000Z' },
  { type: 'pedido', code: 'IMED-OLD12345', name: 'Clínica Antiga', items: ['Raio-X'], date: '2026-10-01', period: 'noite', status: 'pendente', created: '2026-09-20T12:00:00.000Z' },
];
const LIVE = { [ID.d1]: { status: 'completed', reviewed: false }, [ID.d2]: { status: 'pending', reviewed: false }, [ID.d4]: { status: 'completed', reviewed: false } };
const ACCOUNT = [
  { id: ID.a2, created_at: '2026-10-29T15:00:00Z', place_name: 'Centro de Imagem Conta', place_source: 'cnes', place_ref: 'cnes:1', clinic_id: null, exam_code: 'usg', preferred_date: '2026-11-03', preferred_period: 'manha', status: 'completed' },
  { id: ID.d2, created_at: '2026-10-28T12:00:00Z', place_name: 'Imagem Paulista', place_source: 'imed', place_ref: null, clinic_id: 'x', exam_code: 'tc', preferred_date: '2026-11-20', preferred_period: 'tarde', status: 'confirmed' },
  { id: ID.a3, created_at: '2026-10-10T12:00:00Z', place_name: 'Clínica Cancelada', place_source: 'osm', place_ref: 'osm:n/2', clinic_id: null, exam_code: 'consulta', preferred_date: '2026-10-20', preferred_period: 'noite', status: 'cancelled' },
];
// Pedido de outro paciente que o RLS libera para membro de clínica/admin: nunca pode aparecer em "Meus pedidos".
const OTHER_ID = '77777777-7777-4777-8777-777777777777';
const OTHER = { id: OTHER_ID, user_id: 'user-outro', created_at: '2026-10-30T09:00:00Z', place_name: 'Clínica de Terceiro', place_source: 'imed', place_ref: null, clinic_id: 'x', exam_code: 'rm', preferred_date: '2026-11-05', preferred_period: 'manha', status: 'completed' };
const REVIEW_REPLY = { [ID.d1]: 'ok', [ID.d4]: 'already_reviewed', [ID.a2]: 'not_completed' };
const USER = { id: 'user-ana', email: 'ana@exemplo.com' };

// 130 estabelecimentos de "São Paulo" (simulados), em ordem alfabética, com tipos variados.
const KINDS = ['clinica', 'laboratorio', 'imagem', 'hospital'];
const ESTAB = Array.from({ length: 130 }, (_, i) => ({
  cnes: String(2000000 + i), name: `Estabelecimento ${String(i + 1).padStart(3, '0')}${i === 7 ? ' Cardio Vida' : ''}`, kind: KINDS[i % 4],
  address_line: `Rua Exemplo, ${i + 10}`, neighborhood: 'Bela Vista', cep: '01310100', phone: i % 3 === 0 ? '(11) 3141-1000' : (i === 1 ? '3141-2000 ramal 5' : null),
  shift: i % 5 === 0 ? 'Manhã e tarde' : null, open_24h: i % 4 === 3, sus: i % 2 === 0, services: [], lat: -23.56 + i / 10000, lng: -46.65,
}));

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } });
const preflight = (route) => route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });

// cancel: resposta do banco ao cancel_request (função; null = sem internet). account: pedidos da conta.
// claims: pedidos de cadastro de clínica da conta (função que responde a rota, para simular falha).
// live: situação ao vivo por pedido ({ [id]: { status, token } }) no lugar da LIVE; now: relógio fixo do navegador.
// booking: respostas de agenda_my_booking por pedido ({ [id]: resposta }); sem ela, not_found (pedido sem a agenda nova).
async function newPage(browser, { mobile = false, seed = DEVICE, timezoneId = 'America/Sao_Paulo', cancel = () => 'ok', account = ACCOUNT, claims = null, live = null, now = null, booking = {} } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId,
    serviceWorkers: 'block', acceptDownloads: true,
  });
  if (now) await context.clock.setFixedTime(new Date(now));
  await context.addInitScript((list) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (list && !sessionStorage.getItem('semeado')) { localStorage.setItem('imed_appts', JSON.stringify(list)); sessionStorage.setItem('semeado', '1'); }
    } catch { /* ignora */ }
  }, seed);
  const log = { otp: [], status: [], select: [], review: [], city: [], logout: 0, cancel: [], cancelAuth: [], claims: [], my: [] };
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route(`${SUPA}/auth/v1/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return preflight(route);
    const u = new URL(req.url());
    if (u.pathname === '/auth/v1/otp') { log.otp.push({ body: JSON.parse(req.postData()), redirect: u.searchParams.get('redirect_to') }); return json(route, {}); }
    if (u.pathname === '/auth/v1/user') return req.headers().authorization === 'Bearer tok-ana' ? json(route, USER) : json(route, { msg: 'invalid' }, 401);
    if (u.pathname === '/auth/v1/logout') { log.logout++; return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } }); }
    return json(route, { msg: 'não simulado' }, 404);
  });
  await context.route(`${REST}rpc/request_status`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    const b = JSON.parse(route.request().postData());
    log.status.push(b);
    if (live) return json(route, b.p_ids.map((id, i) => (live[id] && b.p_tokens[i] === live[id].token ? { id, status: live[id].status, reviewed: false } : null)).filter(Boolean));
    const out = b.p_ids.map((id, i) => ({ id, ok: LIVE[id] && b.p_tokens[i] === TOK[Object.keys(ID).find((k) => ID[k] === id)] }))
      .filter((x) => x.ok).map(({ id }) => ({ id, ...LIVE[id] }));
    return json(route, out);
  });
  await context.route(`${REST}appointment_requests**`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.select.push({ url: route.request().url(), auth: route.request().headers().authorization });
    if (route.request().headers().authorization !== 'Bearer tok-ana') return json(route, []);
    // Simula o RLS: sem filtro por user_id, a Ana (membro de clínica) também recebe o pedido de outro paciente.
    const f = new URL(route.request().url()).searchParams.get('user_id');
    const mine = account.map((r) => ({ ...r, user_id: USER.id, review_token_hash: 'f'.repeat(64) }));
    return json(route, f === `eq.${USER.id}` ? mine : [OTHER, ...mine]);
  });
  // O dono confere o próprio agendamento (iMed Agenda 5.2: a conta pergunta se foram vários exames marcados juntos).
  await context.route(`${REST}rpc/agenda_my_booking`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    const b = JSON.parse(route.request().postData());
    log.my.push({ body: b, auth: route.request().headers().authorization });
    return json(route, route.request().headers().authorization === 'Bearer tok-ana' && booking[b.p_id] ? booking[b.p_id] : { status: 'not_found' });
  });
  await context.route(`${REST}rpc/cancel_request`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    const b = JSON.parse(route.request().postData());
    log.cancel.push(b);
    log.cancelAuth.push(route.request().headers().authorization);
    const reply = cancel(b);
    return reply === null ? route.abort() : json(route, reply);
  });
  await context.route(`${REST}establishment_claims**`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.claims.push(route.request().url());
    if (claims) return claims(route);
    return json(route, [
      { id: 'kkkkkkkk-0000-4000-8000-000000000001', user_id: USER.id, created_at: '2026-10-20T12:00:00Z', cnes: '2077485', claimant_name: 'Ana Souza', role: 'gestor', status: 'pending' },
      { id: 'kkkkkkkk-0000-4000-8000-000000000002', user_id: 'user-outro', created_at: '2026-10-21T12:00:00Z', cnes: '6543210', claimant_name: 'Outra Pessoa', role: 'outro', status: 'pending' },
    ]);
  });
  await context.route(`${REST}rpc/submit_review`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    const b = JSON.parse(route.request().postData());
    log.review.push(b);
    return json(route, REVIEW_REPLY[b.p_request] ?? 'not_found');
  });
  await context.route(`${REST}rpc/city_establishments`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    const b = JSON.parse(route.request().postData());
    log.city.push(b);
    if (log.cityDelay) await new Promise((r) => setTimeout(r, log.cityDelay));
    const all = ESTAB.filter((e) => !b.p_kind || e.kind === b.p_kind);
    return json(route, all.slice(b.p_offset, b.p_offset + b.p_limit).map((e) => ({ ...e, total: all.length })));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, log, errors };
}

const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); } };
const noOverflow = async (page) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(o <= 0, `sem rolagem lateral (${o}px)`);
};
const results = [];
// Tempo máximo de cada cenário (E2E_CENARIO_S segundos, padrão 150): um cenário travado falha com o nome dele,
// em vez de segurar o arquivo inteiro até o limite do CI.
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  try { await Promise.race([comChaves(fn), limite(name)]); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 5).join('\n  ')}`); }
}
const login = `${BASE}conta.html#access_token=tok-ana&refresh_token=ref-ana&expires_in=3600&token_type=bearer&type=magiclink`;

const browser = vigiarChaves(await chromium.launch());

await scenario('sem login: pedidos deste aparelho com situação ao vivo e envio do link de entrada', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector('.ct-order');
  assert.equal(await page.isVisible('#signedOut'), true);
  assert.equal(await page.isVisible('#signedIn'), false);
  assert.equal(await page.textContent('#ordersTitle'), 'Pedidos deste aparelho');
  assert.equal(log.status.length, 1);
  assert.deepEqual(log.status[0].p_ids, [ID.d1, ID.d2, ID.d4]);
  assert.deepEqual(log.status[0].p_tokens, [TOK.d1, TOK.d2, TOK.d4]);
  assert.equal(log.select.length, 0, 'sem login não lê pedidos da conta');
  assert.equal(await page.locator('.ct-order').count(), 4);
  const d1 = page.locator(`#pedido-${ID.d1}`);
  assert.equal(await d1.locator('.ct-st').textContent(), 'Concluído');
  assert.match(await d1.textContent(), /Ressonância/);
  assert.match(await d1.textContent(), /IMED-11111111/);
  assert.match(await d1.textContent(), /quinta-feira, 12 de novembro de 2026/);
  assert.match(await d1.textContent(), /Manhã/);
  assert.equal(await d1.locator('[data-review]').count(), 1);
  assert.equal(await page.locator(`#pedido-${ID.d2} .ct-st`).textContent(), 'Aguardando contato');
  assert.equal(await page.locator(`#pedido-${ID.d2} [data-review]`).count(), 0);
  const old = page.locator('.ct-order', { hasText: 'Clínica Antiga' });
  assert.match(await old.locator('.ct-st').textContent(), /confirme com o local/);
  assert.match(await old.textContent(), /IMED-OLD12345/);
  await shot(page, 'conta-01-sem-login');

  await page.fill('#email', 'nao-e-email');
  await page.click('#loginBtn');
  assert.match(await page.textContent('#loginMsg'), /e-mail válido/);
  await page.fill('#email', 'Ana@Exemplo.com');
  await page.click('#loginBtn');
  await page.waitForSelector('#loginMsg.ok');
  assert.match(await page.textContent('#loginMsg'), /Enviamos um link para Ana@Exemplo\.com/);
  assert.equal(log.otp[0].body.email, 'ana@exemplo.com');
  assert.equal(log.otp[0].redirect, `${BASE}conta.html`);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('adicionar à agenda: só para o que ainda vai acontecer; .ics com data, período, preparo e lembrete', async () => {
  // Pedido antigo (sem código) para um dia que ainda vai chegar, com "qualquer horário".
  const QUALQUER = { type: 'pedido', code: 'IMED-55555555', name: 'Laboratório Qualquer Hora', exam: 'lab', items: ['Exames de laboratório'], date: '2026-11-25', period: 'qualquer', status: 'pendente', created: '2026-10-26T12:00:00.000Z' };
  // Relógio fixo: os pedidos são de novembro de 2026 e "ainda vai acontecer" depende do dia de hoje (pararia de passar em 21/11).
  const { page, errors, context } = await newPage(browser, { seed: [...DEVICE, QUALQUER], now: '2026-11-04T13:00:00Z' });
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector(`#pedido-${ID.d2} [data-ics]`);
  await page.waitForSelector(`#pedido-${ID.d1} .ct-st:has-text("Concluído")`);
  // Concluídos (d1, d4) e o pedido de uma data que já passou não oferecem lembrete (a mesma regra da página inicial).
  assert.equal(await page.locator(`#pedido-${ID.d1} [data-ics]`).count(), 0, 'concluído: sem lembrete');
  assert.equal(await page.locator(`#pedido-${ID.d4} [data-ics]`).count(), 0, 'concluído: sem lembrete');
  assert.equal(await page.locator('.ct-order', { hasText: 'Clínica Antiga' }).locator('[data-ics]').count(), 0, 'data que já passou: sem lembrete');
  // Pedido ainda aguardando o local: o lembrete avisa que o horário não está confirmado.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`#pedido-${ID.d2} [data-ics]`)]);
  assert.equal(dl.suggestedFilename(), 'imed-imed-22222222.ics');
  const ics = (await readFile(await dl.path(), 'utf8')).replace(/\r\n /g, '');
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;TZID=America\/Sao_Paulo:20261120T130000/);
  assert.match(ics, /DTEND;TZID=America\/Sao_Paulo:20261120T180000/);
  assert.match(ics, /SUMMARY:Exame: Tomografia — Imagem Paulista \(a confirmar\)\r\n/);
  assert.match(ics, /STATUS:TENTATIVE/);
  assert.match(ics, /Preparo: Se o exame usar contraste/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  // "Qualquer horário" vira evento de dia inteiro.
  const q = page.locator('.ct-order', { hasText: 'Laboratório Qualquer Hora' });
  const [dl2] = await Promise.all([page.waitForEvent('download'), q.locator('[data-ics]').click()]);
  const ics2 = await readFile(await dl2.path(), 'utf8');
  assert.match(ics2, /DTSTART;VALUE=DATE:20261125/);
  assert.match(ics2, /DTEND;VALUE=DATE:20261126/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('reserva com horário: mostra o horário marcado em São Paulo, "Confirmado" e .ics com a hora exata', async () => {
  const SLOT_ID = '88888888-8888-4888-8888-888888888888';
  const seed = [{ type: 'pedido', code: 'IMED-88888888', id: SLOT_ID, token: 'd'.repeat(64), place_key: 'imed:x', name: 'Imagem Paulista', exam: 'rm', items: ['Ressonância'], date: '2026-11-05', period: 'manha', slot: '2026-11-05T12:30:00.000Z', status: 'confirmado', created: '2026-10-30T10:00:00Z' }];
  // Aparelho no fuso de Tóquio: o horário mostrado precisa continuar sendo o de São Paulo (09:30). Relógio fixo na
  // véspera: o "Adicionar à agenda" só aparece com o horário ainda por vir (o teste parava de passar depois de 05/11).
  const { page, errors, context } = await newPage(browser, { seed, timezoneId: 'Asia/Tokyo', now: '2026-11-04T13:00:00Z' });
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector(`#pedido-${SLOT_ID}`);
  const card = await page.textContent(`#pedido-${SLOT_ID}`);
  assert.match(card, /Horário marcado/);
  assert.match(card, /5 de novembro de 2026 às 09:30/);
  assert.match(card, /Confirmado/, 'sem a situação ao vivo, mostra o que o aparelho guardou');
  assert.ok(!/Data preferida|Período/.test(card), 'com horário marcado não mostra data preferida nem período');
  assert.match(card, /às 09:30 \(horário de Brasília\)/, 'o aparelho está em outro fuso: a hora diz de onde é');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`#pedido-${SLOT_ID} [data-ics]`)]);
  const ics = (await readFile(await dl.path(), 'utf8')).replace(/\r\n /g, '');
  assert.match(ics, /DTSTART:20261105T123000Z\r\nDTEND:20261105T130000Z/, 'em UTC; sem o fim guardado, 30 min');
  assert.match(ics, /Horário: quinta-feira\\, 05 de novembro às 09:30 \(horário de Brasília\)\./);
  assert.match(ics, /Horário confirmado\. Chegue com 15 minutos de antecedência\./);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('horário direto (5.1): reserva de clínica em Manaus — hora da unidade, fim real no .ics e situação ao vivo', async () => {
  const SLOT_ID = '99999999-9999-4999-8999-999999999999';
  // marcado pela página do local: guarda o fim real, o fuso da unidade e o nome do procedimento
  const seed = [{ type: 'pedido', code: 'IMED-99999999', id: SLOT_ID, token: 'f'.repeat(64), place_key: 'imed:x', name: 'Imagem do Norte', exam: 'rm', items: ['Ressonância do joelho'],
    date: '2026-11-17', period: 'manha', slot: '2026-11-17T13:00:00.000Z', slot_end: '2026-11-17T13:45:00.000Z', tz: 'America/Manaus', status: 'confirmado', created: '2026-11-16T12:00:00Z' }];
  const { page, errors, context } = await newPage(browser, { seed, now: '2026-11-16T12:00:00Z', live: { [SLOT_ID]: { status: 'confirmed', token: 'f'.repeat(64) } } });
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector(`#pedido-${SLOT_ID} .st-confirmed`);
  const card = await page.textContent(`#pedido-${SLOT_ID}`);
  assert.match(card, /17 de novembro de 2026 às 09:00 \(horário de Manaus\)/, '13:00 UTC = 09:00 em Manaus; o aparelho (São Paulo) mostraria 10:00');
  assert.match(card, /Ressonância do joelho/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`#pedido-${SLOT_ID} [data-ics]`)]);
  const ics = (await readFile(await dl.path(), 'utf8')).replace(/\r\n /g, '');
  assert.match(ics, /DTSTART:20261117T130000Z\r\nDTEND:20261117T134500Z/, 'a duração real (45 min)');
  assert.match(ics, /Horário: terça-feira\\, 17 de novembro às 09:00 \(horário de Manaus\)\./);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('revisão 5.1: agendamento que está só na conta aparece no fuso da clínica (Manaus), não no de Brasília', async () => {
  const MAN = '88888888-8888-4888-8888-888888888888';
  const account = [{ id: MAN, created_at: '2026-11-16T12:00:00Z', place_name: 'Imagem do Norte', place_source: 'imed', place_ref: null, place_phone: null,
    clinic_id: 'c-norte', exam_code: 'rm', preferred_date: '2026-11-17', preferred_period: 'manha', slot_start: '2026-11-17T13:00:00+00:00',
    slot_end: '2026-11-17T13:30:00+00:00', status: 'confirmed', clinics: { timezone: 'America/Manaus' } }];
  const { page, log, errors, context } = await newPage(browser, { seed: [], account, now: '2026-11-16T12:00:00Z' });
  await page.goto(login);
  await page.waitForSelector(`#pedido-${MAN}`);
  const card = await page.textContent(`#pedido-${MAN}`);
  assert.match(card, /17 de novembro de 2026 às 09:00 \(horário de Manaus\)/, 'no aparelho em São Paulo mostraria 10:00');
  assert.ok(log.select.some((x) => /clinics\(timezone\)/.test(decodeURIComponent(x.url))), 'o fuso vem junto com o pedido da conta');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('vários exames (5.2) marcados em outro aparelho: a conta mostra o pacote inteiro, o lembrete tem um evento por exame e cancelar avisa que são todos', async () => {
  // Dados simulados. Na lista de pedidos da conta só vem o resumo (1º exame, começo e fim); os exames vêm de agenda_my_booking.
  const PK = '99999999-9999-4999-8999-999999999999';
  const UM = '99999999-9999-4999-8999-99999999999a';
  const linha = (id, fim) => ({ id, created_at: '2026-11-16T12:00:00Z', place_name: 'Clínica Simulada dos Exames', place_source: 'imed', place_ref: null, place_phone: '(11) 3000-0000',
    clinic_id: 'c-simulada', exam_code: 'rm', preferred_date: '2026-11-17', preferred_period: 'manha', slot_start: '2026-11-17T11:00:00+00:00', slot_end: fim, status: 'confirmed', clinics: { timezone: 'America/Sao_Paulo' } });
  const account = [linha(PK, '2026-11-17T12:00:00+00:00'), linha(UM, '2026-11-17T11:30:00+00:00')];
  const item = (seq, exam, nome, de, ate, prep = null, jejum = null) => ({ seq, exam_code: exam, procedure: nome, starts_at: de, ends_at: ate, status: 'confirmed', prep_text: prep, fasting_hours: jejum });
  const booking = {
    [PK]: { status: 'ok', id: PK, request_status: 'confirmed', agenda: true, timezone: 'America/Sao_Paulo', slot_start: '2026-11-17T11:00:00+00:00', slot_end: '2026-11-17T12:00:00+00:00',
      items: [item(1, 'rm', 'Ressonância do joelho', '2026-11-17T11:00:00+00:00', '2026-11-17T11:30:00+00:00', 'Retire objetos de metal.'),
        item(2, 'tc', 'Tomografia do tórax', '2026-11-17T11:40:00+00:00', '2026-11-17T12:00:00+00:00', null, 4)] },
    [UM]: { status: 'ok', id: UM, request_status: 'confirmed', agenda: true, timezone: 'America/Sao_Paulo', slot_start: '2026-11-17T11:00:00+00:00', slot_end: '2026-11-17T11:30:00+00:00',
      items: [item(1, 'rm', 'Ressonância do joelho', '2026-11-17T11:00:00+00:00', '2026-11-17T11:30:00+00:00')] },
  };
  const { page, log, errors, context } = await newPage(browser, { seed: [], account, booking, now: '2026-11-16T12:00:00Z' });
  await page.goto(login);
  await page.waitForSelector(`#pedido-${PK} .ct-parts`);
  assert.deepEqual(log.my.map((x) => [x.body, x.auth]).sort((a, b) => a[0].p_id.localeCompare(b[0].p_id)), [[{ p_id: PK }, 'Bearer tok-ana'], [{ p_id: UM }, 'Bearer tok-ana']],
    'uma pergunta por agendamento com horário que não está neste aparelho, com a conta de quem entrou');
  assert.equal((await page.textContent(`#pedido-${PK} .ct-parts dt`)).trim(), '2 exames marcados juntos');
  assert.deepEqual(await page.locator(`#pedido-${PK} .ct-parts li`).evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim())),
    ['08:00 às 08:30 Ressonância do joelho', '08:40 às 09:00 Tomografia do tórax']);
  assert.match(await page.innerText(`#pedido-${PK}`), /Dia\s+Terça-feira, 17 de novembro de 2026/);
  // o agendamento de um exame só continua como na 5.1
  assert.equal(await page.locator(`#pedido-${UM} .ct-parts`).count(), 0);
  assert.match(await page.textContent(`#pedido-${UM}`), /Horário marcado.*17 de novembro de 2026 às 08:00/s);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`#pedido-${PK} [data-ics]`)]);
  const ics = await readFile(await dl.path(), 'utf8');
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2, 'um evento por exame');
  assert.match(ics, /DTSTART:20261117T114000Z\r\nDTEND:20261117T120000Z\r\n/);
  assert.match(ics.replace(/\r\n /g, ''), /Preparo: Jejum de 4 horas\./);
  await page.click(`#pedido-${PK} [data-cancel]`);
  assert.match(await page.textContent(`#pedido-${PK} .ct-ask p`), /^Cancelar os 2 exames deste agendamento\? Eles foram marcados juntos e são cancelados juntos\./);
  await page.click(`#pedido-${PK} [data-cancel-yes]`);
  await page.waitForFunction((id) => /Cancelado/.test(document.querySelector(`#pedido-${id} .ct-st`)?.textContent ?? ''), PK);
  assert.deepEqual(log.cancel.map((b) => b.p_id), [PK], 'um cancelamento só, do agendamento inteiro');
  assert.match(await page.textContent('#toast'), /Os 2 exames foram cancelados\./);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('revisão 5.1: o lembrete (.ics) da conta leva o preparo informado pela clínica', async () => {
  const SLOT_ID = '77777777-7777-4777-8777-777777777777';
  const seed = [{ type: 'pedido', code: 'IMED-77777777', id: SLOT_ID, token: 'f'.repeat(64), place_key: 'imed:x', name: 'Imagem Paulista', exam: 'tc', items: ['Tomografia'],
    date: '2026-11-17', period: 'manha', slot: '2026-11-17T12:00:00.000Z', tz: 'America/Sao_Paulo', prep: 'Jejum de 4 horas. Suspenda a metformina 48 horas antes.', status: 'confirmado', created: '2026-11-16T12:00:00Z' }];
  const { page, errors, context } = await newPage(browser, { seed, now: '2026-11-16T12:00:00Z', live: { [SLOT_ID]: { status: 'confirmed', token: 'f'.repeat(64) } } });
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector(`#pedido-${SLOT_ID} [data-ics]`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`#pedido-${SLOT_ID} [data-ics]`)]);
  const ics = (await readFile(await dl.path(), 'utf8')).replace(/\r\n /g, '');
  assert.match(ics, /Preparo: Jejum de 4 horas\. Suspenda a metformina 48 horas antes\./);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('login pelo link (#access_token): pedidos da conta + aparelho, sem duplicar, e sair', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(login);
  await page.waitForSelector('#signedIn:not([hidden])');
  await page.waitForSelector('.ct-order');
  assert.equal(new URL(page.url()).hash, '', 'o token sai do endereço');
  assert.equal(await page.textContent('#meEmail'), 'ana@exemplo.com');
  assert.match(await page.textContent('#flash'), /você entrou/);
  // Os pedidos do aparelho aparecem primeiro; com a máquina lenta, os da conta chegam um pouco depois.
  await page.waitForFunction(() => document.querySelector('#ordersTitle')?.textContent === 'Meus pedidos');
  assert.equal(log.select.length, 1);
  assert.equal(log.select[0].auth, 'Bearer tok-ana');
  const selUrl = new URL(log.select[0].url);
  assert.equal(selUrl.searchParams.get('select'), 'id,user_id,created_at,place_name,place_source,place_ref,place_phone,clinic_id,exam_code,preferred_date,preferred_period,slot_start,slot_end,status,clinics(timezone)');
  assert.equal(selUrl.searchParams.get('user_id'), `eq.${USER.id}`, 'filtra pela conta');
  assert.equal(selUrl.searchParams.get('order'), 'created_at.desc');
  assert.equal(selUrl.searchParams.get('limit'), '50');
  assert.equal(await page.locator(`#pedido-${OTHER_ID}`).count(), 0, 'pedido de outro paciente não aparece');
  assert.doesNotMatch(await page.textContent('main'), /Clínica de Terceiro/);
  const ids = await page.$$eval('.ct-order', (els) => els.map((e) => e.id));
  assert.equal(ids.length, 6, 'quatro do aparelho + duas só da conta');
  assert.equal(ids.filter((x) => x === `pedido-${ID.d2}`).length, 1, 'pedido que está nos dois aparece uma vez');
  assert.equal(ids[0], `pedido-${ID.a2}`, 'mais novo primeiro');
  assert.equal(await page.locator(`#pedido-${ID.d2} .ct-st`).textContent(), 'Confirmado', 'situação da conta');
  assert.match(await page.locator(`#pedido-${ID.d2} .ct-where`).textContent(), /Na conta e neste aparelho/);
  assert.equal(await page.locator(`#pedido-${ID.a3} .ct-st`).textContent(), 'Cancelado');
  assert.match(await page.locator(`#pedido-${ID.a3}`).textContent(), /Consulta/);
  assert.match(await page.locator(`#pedido-${ID.a2}`).textContent(), /IMED-55555555/);
  await shot(page, 'conta-02-logado');
  await page.click('#logoutBtn');
  await page.waitForSelector('#signedOut:not([hidden])');
  assert.equal(log.logout, 1);
  assert.equal(await page.textContent('#ordersTitle'), 'Pedidos deste aparelho');
  await page.waitForFunction(() => document.querySelectorAll('.ct-order').length === 4);
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_session')), null);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('avaliar pelo link #pedido-<id>: estrelas acessíveis, comentário e agradecimento', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}conta.html#pedido-${ID.d1}`);
  await page.waitForSelector(`#rv-${ID.d1}:not([hidden])`);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('type'));
  assert.equal(focused, 'radio', 'foco vai para as estrelas');
  assert.equal(await page.locator(`#rv-${ID.d1} input[type=radio]`).count(), 5);
  assert.equal(await page.locator(`#rv-${ID.d1}`).getByLabel('4 estrelas').count(), 1);
  // Enviar sem nota pede a nota e não chama o banco.
  await page.click(`#rv-${ID.d1} button[type=submit]`);
  assert.match(await page.textContent(`#rv-${ID.d1} .ct-msg`), /de 1 a 5 estrelas/);
  assert.equal(log.review.length, 0);
  // Teclado: setas mudam a nota.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator(`#rv-${ID.d1} .ct-stars`).getAttribute('data-v'), '4');
  await page.fill(`#rv-${ID.d1} textarea`, '  Atendimento rápido e equipe atenciosa.  ');
  assert.match(await page.textContent(`#rv-${ID.d1} small`), /42 de 500/);
  await shot(page, 'conta-03-avaliar');
  await page.click(`#rv-${ID.d1} button[type=submit]`);
  await page.waitForSelector(`#pedido-${ID.d1} .ct-thanks`);
  assert.deepEqual(log.review[0], { p_request: ID.d1, p_token: TOK.d1, p_rating: 4, p_comment: 'Atendimento rápido e equipe atenciosa.' });
  assert.match(await page.textContent(`#pedido-${ID.d1} .ct-thanks`), /Obrigado pela avaliação/);
  assert.equal(await page.locator(`#pedido-${ID.d1} [data-review]`).count(), 0);
  // Já avaliado (servidor): mensagem clara.
  await page.click(`#pedido-${ID.d4} [data-review]`);
  await page.click(`#rv-${ID.d4} label[for="r-${ID.d4}-5"]`);
  await page.click(`#rv-${ID.d4} button[type=submit]`);
  await page.waitForSelector(`#pedido-${ID.d4} .ct-thanks`);
  assert.match(await page.textContent(`#pedido-${ID.d4} .ct-thanks`), /já foi avaliado/);
  assert.deepEqual(log.review[1], { p_request: ID.d4, p_token: TOK.d4, p_rating: 5, p_comment: null });
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedido da conta: avaliação sem código do aparelho e mensagem de "ainda não concluído"', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(login);
  await page.waitForSelector(`#pedido-${ID.a2} [data-review]`);
  await page.click(`#pedido-${ID.a2} [data-review]`);
  assert.equal(await page.getAttribute(`#pedido-${ID.a2} [data-review]`, 'aria-expanded'), 'true');
  await page.click(`#rv-${ID.a2} label[for="r-${ID.a2}-2"]`);
  await page.click(`#rv-${ID.a2} button[type=submit]`);
  await page.waitForFunction((id) => !document.querySelector(`#rv-${id} .ct-msg`).hidden, ID.a2);
  assert.deepEqual(log.review[0], { p_request: ID.a2, p_token: '', p_rating: 2, p_comment: null });
  assert.match(await page.textContent(`#rv-${ID.a2} .ct-msg`), /depois que o local marcar o atendimento como concluído/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('apagar pedidos deste aparelho pede confirmação e limpa a lista', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector('.ct-order');
  await page.click('#clearBtn');
  assert.equal(await page.isVisible('#clearConfirm'), true);
  await page.click('#clearNo');
  assert.equal(await page.isVisible('#clearConfirm'), false);
  assert.ok(await page.evaluate(() => localStorage.getItem('imed_appts')));
  await page.click('#clearBtn');
  await page.click('#clearYes');
  await page.waitForSelector('.ct-empty');
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_appts')), null);
  assert.equal(await page.isDisabled('#clearBtn'), true);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('página da cidade: lista do banco, carregar mais, abas por tipo, busca e reivindicar', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}cidades/sp/sao-paulo/`);
  await page.waitForSelector('.cd-item');
  assert.match(await page.title(), /^6\.548 clínicas, laboratórios e hospitais em São Paulo - SP \| IMED$/);
  assert.deepEqual(log.city[0], { p_city: 3550308, p_kind: null, p_limit: 60, p_offset: 0 });
  assert.equal(await page.locator('.cd-item').count(), 60);
  assert.match(await page.textContent('#cdCount'), /Mostrando 60 de 130/);
  const first = page.locator('.cd-item').first();
  assert.match(await first.textContent(), /Estabelecimento 001/);
  assert.match(await first.textContent(), /Rua Exemplo, 10 · Bela Vista · CEP 01310-100/);
  assert.equal(await first.locator('a.tel').getAttribute('href'), 'tel:+551131411000');
  const second = page.locator('.cd-item').nth(1);
  assert.match(await second.textContent(), /3141-2000 ramal 5/, 'telefone que não vira link continua aparecendo');
  assert.equal(await second.locator('a.tel').count(), 0);
  assert.match(await first.textContent(), /Atende SUS/);
  assert.match(await first.textContent(), /Turno: Manhã e tarde/);
  const claim = first.locator('a.claim');
  assert.equal(await claim.getAttribute('href'), '../../../reivindicar.html?cnes=2000000');
  assert.equal(await claim.evaluate((a) => a.href), `${BASE}reivindicar.html?cnes=2000000`);
  assert.match(await first.locator('a', { hasText: 'Ver no mapa' }).getAttribute('href'), /^https:\/\/www\.openstreetmap\.org\/\?mlat=-23\.560000&mlon=-46\.650000/);
  assert.equal(await first.locator('a', { hasText: 'Ficha oficial' }).getAttribute('href'), 'https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/3550302000000');
  assert.equal(await page.evaluate(() => new URL(document.querySelector('.cd-hero .btn-coral').href).pathname), '/perto.html');
  await shot(page, 'cidade-01-sao-paulo');

  await page.click('#cdMore');
  await page.waitForFunction(() => document.querySelectorAll('.cd-item').length === 120);
  assert.deepEqual(log.city[1], { p_city: 3550308, p_kind: null, p_limit: 60, p_offset: 60 });
  await page.click('#cdMore');
  await page.waitForFunction(() => document.querySelectorAll('.cd-item').length === 130);
  assert.equal(await page.isHidden('#cdMore'), true, 'acabou a lista: some o botão');

  await page.fill('#cdQ', 'cardio');
  await page.waitForFunction(() => document.querySelectorAll('.cd-item').length === 1);
  assert.match(await page.textContent('.cd-item h3'), /Cardio Vida/);
  assert.match(await page.textContent('#cdCount'), /1 de 130 carregados/);
  await page.fill('#cdQ', '');

  await page.click('.cd-tab[data-kind="hospital"]');
  await page.waitForFunction(() => document.querySelectorAll('.cd-item').length === 32);
  assert.deepEqual(log.city.at(-1), { p_city: 3550308, p_kind: 'hospital', p_limit: 60, p_offset: 0 });
  assert.equal(await page.getAttribute('.cd-tab[data-kind="hospital"]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('.cd-tab[data-kind=""]', 'aria-pressed'), 'false');
  const kinds = await page.$$eval('.cd-kind', (els) => [...new Set(els.map((e) => e.textContent.trim()))]);
  assert.deepEqual(kinds, ['Hospital']);
  const calls = log.city.length;
  await page.click('.cd-tab[data-kind=""]');
  await page.waitForFunction(() => document.querySelectorAll('.cd-item').length === 130);
  assert.equal(log.city.length, calls, 'volta para "Todos" sem buscar de novo');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('página da cidade: trocar de aba durante a carga não é ignorado', async () => {
  const { page, log, errors, context } = await newPage(browser);
  log.cityDelay = 600;
  await page.goto(`${BASE}cidades/sp/sao-paulo/`);
  await page.waitForFunction(() => document.querySelector('#cdList')?.getAttribute('aria-busy') === 'true');
  await page.click('.cd-tab[data-kind="laboratorio"]');
  assert.equal(await page.getAttribute('.cd-tab[data-kind="laboratorio"]', 'aria-pressed'), 'true', 'aba marcada na hora');
  assert.equal(await page.getAttribute('.cd-tab[data-kind=""]', 'aria-pressed'), 'false');
  await page.waitForFunction(() => document.querySelectorAll('.cd-item').length === 33);
  assert.deepEqual(log.city.map((c) => c.p_kind), [null, 'laboratorio']);
  const kinds = await page.$$eval('.cd-kind', (els) => [...new Set(els.map((e) => e.textContent.trim()))]);
  assert.deepEqual(kinds, ['Laboratório']);
  assert.equal(await page.getAttribute('#cdList', 'aria-busy'), null);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('página por tipo, índice das cidades e celular (390 px) sem rolagem lateral', async () => {
  const { page, log, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(`${BASE}cidades/sp/sao-paulo/hospitais.html`);
  await page.waitForSelector('.cd-item');
  assert.deepEqual(log.city[0], { p_city: 3550308, p_kind: 'hospital', p_limit: 60, p_offset: 0 });
  assert.match(await page.title(), /^289 hospitais em São Paulo - SP/);
  await noOverflow(page);
  await shot(page, 'cidade-02-celular-hospitais');
  await page.goto(`${BASE}cidades/`);
  assert.equal(await page.locator('.cd-state h2', { hasText: 'Distrito Federal' }).count(), 1);
  await page.click('a:has-text("Campinas")');
  await page.waitForSelector('.cd-item');
  assert.equal(new URL(page.url()).pathname, '/cidades/sp/campinas/');
  assert.equal(log.city.at(-1).p_city, 3509502);
  await noOverflow(page);
  await page.goto(`${BASE}cidades/`);
  await noOverflow(page);
  await shot(page, 'cidade-03-celular-indice');
  await page.goto(`${BASE}conta.html#pedido-${ID.d1}`);
  await page.waitForSelector(`#rv-${ID.d1}:not([hidden])`);
  await noOverflow(page);
  await shot(page, 'conta-04-celular-avaliar');
  await page.goto('about:blank');
  await page.goto(login);
  await page.waitForSelector('#signedIn:not([hidden])');
  await page.waitForSelector('.ct-order');
  await noOverflow(page);
  await shot(page, 'conta-05-celular-logado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('cancelar pedido pelo site: pede confirmação, usa o código do aparelho e mostra "Cancelado"', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector(`#pedido-${ID.d2} .ct-st:has-text("Aguardando contato")`);
  // só o pedido ainda ativo (aguardando contato) pode ser cancelado; concluídos e sem código, não
  assert.deepEqual(await page.$$eval('[data-cancel]', (b) => b.map((x) => x.dataset.cancel)), [ID.d2]);
  await page.click(`[data-cancel="${ID.d2}"]`);
  assert.match(await page.textContent(`#pedido-${ID.d2} .ct-ask`), /Cancelar pelo IMED é grátis\. A clínica vê o cancelamento no painel dela\./);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.cancelYes), ID.d2, 'foco no "Sim, cancelar"');
  await shot(page, 'conta-08-cancelar');
  await page.click(`[data-cancel-no="${ID.d2}"]`);
  assert.equal(await page.locator('.ct-ask').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.cancel), ID.d2, 'o foco volta para o botão');
  assert.equal(log.cancel.length, 0, '"Não" não cancela');
  await page.click(`[data-cancel="${ID.d2}"]`);
  await page.click(`[data-cancel-yes="${ID.d2}"]`);
  await page.waitForFunction((id) => document.querySelector(`#pedido-${id} .ct-st`)?.textContent === 'Cancelado', ID.d2);
  assert.deepEqual(log.cancel, [{ p_id: ID.d2, p_token: TOK.d2 }]);
  assert.equal(await page.locator(`#pedido-${ID.d2} [data-cancel]`).count(), 0, 'cancelado não oferece cancelar de novo');
  assert.equal(await page.locator(`#pedido-${ID.d2} [data-ics]`).count(), 0, 'cancelado não oferece lembrete na agenda');
  // d2 é de uma clínica parceira: ela vê o cancelamento no painel dela.
  assert.match(await page.textContent('#toast'), /^Pedido cancelado\. A clínica vê o cancelamento no painel dela\.$/);
  assert.match(await page.textContent(`#pedido-${ID.d2} .ct-note`), /Cancelado por você\. A clínica vê o cancelamento no painel dela\./);
  assert.equal(await page.evaluate(() => document.activeElement?.id), `pedido-${ID.d2}`);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(saved.find((a) => a.id === ID.d2).status, 'cancelado', 'o aparelho guarda a situação nova');
  assert.equal(saved.find((a) => a.id === ID.d2).token, TOK.d2, 'o código continua no aparelho');
  assert.deepEqual(errors, []);
  await context.close();
  // o banco recusa (horário já passou): fecha a pergunta, explica e confere a situação de novo
  const past = await newPage(browser, { cancel: () => 'past' });
  await past.page.goto(`${BASE}conta.html`);
  await past.page.waitForSelector(`[data-cancel="${ID.d2}"]`);
  await past.page.click(`[data-cancel="${ID.d2}"]`);
  await past.page.click(`[data-cancel-yes="${ID.d2}"]`);
  await past.page.waitForFunction(() => /já passou/.test(document.querySelector('#toast').textContent));
  await past.page.waitForFunction(() => !document.querySelector('.ct-ask'));
  await past.page.waitForFunction(() => document.querySelectorAll('.ct-order').length === 4);
  assert.equal(past.log.status.length, 2, 'busca a situação de novo');
  assert.deepEqual(past.errors, []);
  await past.context.close();
  // sem internet: a pergunta continua aberta para tentar de novo
  const off = await newPage(browser, { cancel: () => null });
  await off.page.goto(`${BASE}conta.html`);
  await off.page.waitForSelector(`[data-cancel="${ID.d2}"]`);
  await off.page.click(`[data-cancel="${ID.d2}"]`);
  await off.page.click(`[data-cancel-yes="${ID.d2}"]`);
  await off.page.waitForFunction(() => document.querySelector('#toast').textContent.length > 0);
  await off.page.waitForSelector(`[data-cancel-yes="${ID.d2}"]:not([disabled])`);
  assert.equal(await off.page.evaluate(() => document.activeElement?.dataset.cancelYes), ID.d2);
  assert.equal(await off.page.locator(`#pedido-${ID.d2} .ct-st`).textContent(), 'Aguardando contato');
  await off.context.close();
});

await scenario('com a conta: cancela pedido só da conta (sem código) e "Meus dados" baixa o arquivo sem códigos secretos', async () => {
  const A4 = { id: '88888888-8888-4888-8888-888888888888', created_at: '2026-10-30T10:00:00Z', place_name: 'Laboratório da Conta', place_source: 'cnes', place_ref: 'cnes:3', place_phone: '(11) 3000-2000', clinic_id: null, exam_code: 'lab', preferred_date: '2026-11-10', preferred_period: 'manha', status: 'pending' };
  const { page, log, errors, context } = await newPage(browser, { account: [A4, ...ACCOUNT] });
  await page.goto(login);
  await page.waitForSelector(`#pedido-${A4.id}`);
  assert.deepEqual((await page.$$eval('[data-cancel]', (b) => b.map((x) => x.dataset.cancel))).sort(), [A4.id, ID.d2].sort());
  await page.click(`[data-cancel="${A4.id}"]`);
  // Local que ainda não é parceiro: só a equipe do IMED vê; a pessoa liga para o local se já tinha combinado.
  assert.match(await page.textContent(`#pedido-${A4.id} .ct-ask`), /A equipe do IMED vê o cancelamento\. Se o horário já tinha sido combinado com o local, ligue também para ele\./);
  await page.click(`[data-cancel-yes="${A4.id}"]`);
  await page.waitForFunction((id) => document.querySelector(`#pedido-${id} .ct-st`)?.textContent === 'Cancelado', A4.id);
  assert.deepEqual(log.cancel, [{ p_id: A4.id, p_token: null }], 'pedido da conta: o banco confere o dono pelo login');
  assert.match(await page.textContent('#toast'), /ligue também para ele: \(11\) 3000-2000\./, 'com o telefone do local guardado no pedido');
  assert.equal(await page.getAttribute(`#pedido-${A4.id} .ct-note a`, 'href'), 'tel:+551130002000');
  assert.equal(log.cancelAuth[0], 'Bearer tok-ana');
  // Meus dados: links para corrigir e pedir exclusão
  assert.equal(await page.getAttribute('#fixData', 'href'), 'contato.html?assunto=correcao');
  assert.equal(await page.getAttribute('#delData', 'href'), 'contato.html?assunto=exclusao');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#dlData')]);
  assert.match(download.suggestedFilename(), /^imed-meus-dados-\d{4}-\d{2}-\d{2}\.json$/);
  const raw = await readFile(await download.path(), 'utf8');
  const data = JSON.parse(raw);
  assert.equal(data.servico, 'IMED');
  assert.deepEqual(data.conta, { email: USER.email, id: USER.id });
  assert.deepEqual(data.pedidos_da_conta.map((r) => r.id), [A4.id, ...ACCOUNT.map((r) => r.id)]);
  assert.ok(data.pedidos_da_conta.every((r) => !('review_token_hash' in r)), 'sem o resumo do código');
  assert.deepEqual(data.pedidos_de_cadastro_de_clinica.map((c) => c.claimant_name), ['Ana Souza'], 'só os pedidos de cadastro da própria conta');
  assert.equal(data.pedidos_deste_aparelho.length, 4);
  for (const t of Object.values(TOK)) assert.ok(!raw.includes(t), 'sem o código secreto dos pedidos do aparelho');
  assert.ok(!raw.includes(OTHER_ID) && !raw.includes('Clínica de Terceiro'), 'sem pedido de outra pessoa');
  const sel = new URL(log.select.find((x) => /select=\*/.test(x.url)).url);
  assert.equal(sel.searchParams.get('user_id'), `eq.${USER.id}`);
  assert.equal(sel.searchParams.get('limit'), '500');
  assert.equal(new URL(log.claims[0]).searchParams.get('user_id'), `eq.${USER.id}`);
  assert.match(await page.textContent('#dataMsg'), /Arquivo baixado com os dados da sua conta e deste aparelho/);
  // "Pedir exclusão" abre o Fale com o IMED com o assunto certo, ligado à conta
  await page.click('#delData');
  await page.waitForURL(/contato\.html\?assunto=exclusao$/);
  await page.waitForSelector('#cConta:not([hidden])');
  assert.equal(await page.inputValue('#cAssunto'), 'dados_exclusao');
  assert.equal(await page.inputValue('#cContato'), USER.email);
  assert.match(await page.textContent('#cConta'), /ana@exemplo\.com/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('"Meus dados" sem conta e com a conta fora do ar: baixa o que tem e explica', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector('.ct-order');
  const n = log.select.length;
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#dlData')]);
  const data = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(data.conta, null);
  assert.deepEqual(data.pedidos_da_conta, []);
  assert.deepEqual(data.pedidos_deste_aparelho.map((a) => a.code), ['IMED-11111111', 'IMED-22222222', 'IMED-44444444', 'IMED-OLD12345']);
  assert.ok(data.pedidos_deste_aparelho.every((a) => !('token' in a)));
  assert.equal(log.select.length, n, 'sem conta, não consulta o banco');
  assert.match(await page.textContent('#dataMsg'), /Entre na conta para incluir também os pedidos dela/);
  assert.deepEqual(errors, []);
  await context.close();
  const bad = await newPage(browser, { claims: (route) => json(route, { message: 'erro' }, 500) });
  await bad.page.goto(login);
  await bad.page.waitForSelector('#signedIn:not([hidden])');
  await bad.page.waitForSelector('.ct-order');
  const [d2] = await Promise.all([bad.page.waitForEvent('download'), bad.page.click('#dlData')]);
  const data2 = JSON.parse(await readFile(await d2.path(), 'utf8'));
  assert.deepEqual(data2.pedidos_da_conta, []);
  assert.equal(data2.pedidos_deste_aparelho.length, 4);
  assert.match(await bad.page.textContent('#dataMsg'), /Os dados da conta não carregaram agora/);
  assert.deepEqual(bad.errors, []);
  await bad.context.close();
});

await scenario('celular (390 px): cancelar e "Meus dados" sem rolagem lateral', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector(`[data-cancel="${ID.d2}"]`);
  await page.click(`[data-cancel="${ID.d2}"]`);
  await noOverflow(page);
  await page.locator('#dados').scrollIntoViewIfNeeded();
  await noOverflow(page);
  await shot(page, 'conta-09-celular-meus-dados');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('situações da agenda nova (4.2): textos, avisos, sem "Adicionar à agenda"; cancelar só em "Remarcação solicitada" e o prazo da clínica', async () => {
  // Pedidos deste aparelho com horário marcado; a situação ao vivo vem da agenda nova.
  const mk = (n, status) => {
    const id = `${n}${n}${n}${n}${n}${n}${n}${n}-aaaa-4aaa-8aaa-aaaaaaaaaaa${n}`;
    return { id, token: n.repeat(64), status, seed: { type: 'pedido', code: `IMED-${n.repeat(8)}`, id, token: n.repeat(64), place_key: 'imed:x', name: 'Clínica Agenda Teste', phone: '(11) 3141-1000', exam: 'usg', items: ['Ultrassom'], date: '2026-11-20', period: 'manha', slot: '2026-11-20T13:00:00.000Z', status: 'confirmado', created: '2026-11-01T10:00:00Z' } };
  };
  const P = { rr: mk('1', 'reschedule_requested'), ns: mk('2', 'no_show'), ci: mk('3', 'checked_in'), is: mk('4', 'in_service'), ex: mk('5', 'expired'), ok: mk('6', 'confirmed') };
  const live = Object.fromEntries(Object.values(P).map((x) => [x.id, { status: x.status, token: x.token }]));
  let tooLate = true;
  const { page, log, errors, context } = await newPage(browser, { seed: Object.values(P).map((x) => x.seed), live, now: '2026-11-04T15:00:00Z', cancel: () => (tooLate ? 'too_late' : 'ok') });
  await page.goto(`${BASE}conta.html`);
  await page.waitForFunction(() => document.querySelectorAll('.ct-order .ct-st').length === 6 && /Remarcação/.test(document.body.textContent));
  const card = (x) => page.locator(`#pedido-${x.id}`);
  const st = async (x) => (await card(x).locator('.ct-st').textContent()).trim();
  assert.equal(await st(P.rr), 'Remarcação solicitada');
  assert.equal(await st(P.ns), 'Não compareceu');
  assert.equal(await st(P.ci), 'Chegada registrada');
  assert.equal(await st(P.is), 'Em atendimento');
  assert.equal(await st(P.ex), 'Reserva expirada');
  assert.equal(await st(P.ok), 'Confirmado');
  // avisos simples só onde o paciente precisa saber de algo
  assert.match(await card(P.rr).locator('.ct-st-note').textContent(), /Este horário precisa mudar\. Fale com a clínica/);
  assert.equal(await card(P.rr).locator('.ct-st-note a[href="tel:+551131411000"]').count(), 1, 'ligar para a clínica');
  assert.match(await card(P.ns).locator('.ct-st-note').textContent(), /não compareceu\. Se não foi isso, fale com a clínica/);
  assert.match(await card(P.ex).locator('.ct-st-note').textContent(), /horário foi liberado/);
  for (const x of [P.ci, P.is, P.ok]) assert.equal(await card(x).locator('.ct-st-note').count(), 0, x.status);
  // "Adicionar à agenda" só para o confirmado (ativo e no futuro)
  for (const x of [P.rr, P.ns, P.ci, P.is, P.ex]) assert.equal(await card(x).locator('[data-ics]').count(), 0, `${x.status}: sem lembrete`);
  assert.equal(await card(P.ok).locator('[data-ics]').count(), 1);
  // "Cancelar pedido": confirmado e remarcação solicitada; nas outras, não
  assert.deepEqual((await page.$$eval('[data-cancel]', (b) => b.map((x) => x.dataset.cancel))).sort(), [P.rr.id, P.ok.id].sort());
  // o prazo da clínica para cancelar pelo site já passou: o banco responde too_late e a página explica
  await page.click(`[data-cancel="${P.rr.id}"]`);
  // a remarcação nasce do bloqueio da clínica: o horário já foi solto e o período está bloqueado — nada de "livre"
  const pergunta = await card(P.rr).locator('.ct-ask p').textContent();
  assert.equal(pergunta, 'Cancelar este pedido? Cancelar pelo IMED é grátis. A clínica vê o cancelamento no painel dela.');
  await page.click(`[data-cancel-yes="${P.rr.id}"]`);
  await page.waitForFunction(() => /O prazo para cancelar pelo site já passou\. Fale com a clínica\./.test(document.querySelector('#toast').textContent));
  assert.deepEqual(log.cancel[0], { p_id: P.rr.id, p_token: P.rr.token });
  await page.waitForFunction(() => !document.querySelector('.ct-ask'));
  await page.waitForFunction(() => document.querySelectorAll('.ct-order .ct-st').length === 6);
  assert.equal(log.status.length, 2, 'resposta definitiva: confere a situação de novo');
  assert.equal(await st(P.rr), 'Remarcação solicitada', 'continua como estava');
  // dentro do prazo, cancela
  tooLate = false;
  live[P.rr.id].status = 'cancelled';
  await page.waitForSelector(`[data-cancel="${P.rr.id}"]`);
  await page.click(`[data-cancel="${P.rr.id}"]`);
  await page.click(`[data-cancel-yes="${P.rr.id}"]`);
  await page.waitForFunction((id) => /Cancelado/.test(document.querySelector(`#pedido-${id} .ct-st`)?.textContent || ''), P.rr.id);
  await page.waitForFunction(() => /Pedido cancelado\./.test(document.querySelector('#toast').textContent));
  assert.equal((await page.textContent('#toast')).trim(), 'Pedido cancelado. A clínica vê o cancelamento no painel dela.', 'sem "o horário voltou a ficar livre"');
  assert.equal(await card(P.rr).locator('.ct-st-note').count(), 0, 'cancelado: o aviso de remarcação sai');
  await shot(page, 'conta-situacoes-novas');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedido que não está no aparelho: aviso para entrar na conta', async () => {
  const { page, errors, context } = await newPage(browser, { seed: [] });
  await page.goto(`${BASE}conta.html#pedido-${ID.a2}`);
  await page.waitForSelector('#flash:not([hidden])');
  assert.match(await page.textContent('#flash'), /entre com seu e-mail/);
  assert.equal(await page.locator('.ct-empty').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
