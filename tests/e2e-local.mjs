// Teste de ponta a ponta da página de cada local (local.html) num navegador de verdade (Playwright),
// com respostas simuladas do banco (Supabase). Rodar com: node tests/e2e-local.mjs
// Opcional: SHOTS=pasta node tests/e2e-local.mjs  salva capturas de tela nessa pasta.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as G from '../assets/js/geo-core.js';

import { comChaves, vigiarChaves } from './regra-chaves.mjs';
import { SITE } from './endereco.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const REST = 'https://pyoqiecupxhdzigjudyd.supabase.co/rest/v1/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+F9PQAJYwN6V0E0WwAAAABJRU5ErkJggg==', 'base64');

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
const PORT = Number(process.env.E2E_PORT) || 8771; // E2E_PORT: outra porta para rodar em paralelo
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;

/* ======================= dados simulados ======================= */
// PostgREST devolve geography como EWKB em hexadecimal (o caso real em produção, sem Accept: application/geo+json).
const ewkb = (lng, lat) => {
  const b = Buffer.alloc(25);
  b.writeUInt8(1, 0); b.writeUInt32LE(0x20000001, 1); b.writeUInt32LE(4326, 5);
  b.writeDoubleLE(lng, 9); b.writeDoubleLE(lat, 17);
  return b.toString('hex').toUpperCase();
};
const EST = {
  '2077485': {
    cnes: '2077485', name: 'Hospital Santa Exemplo', legal_name: 'Associação Santa Exemplo', kind: 'hospital', address_line: 'Rua Peixoto Gomide, 625',
    neighborhood: 'Cerqueira César', cep: '01409001', phone: '(11) 3141-1000', shift: 'Manhã, tarde e noite', open_24h: false, sus: true,
    services: ['rm', 'tc'], specialties: ['Cardiologia', 'Ortopedia'], cnes_updated_at: '2026-09-15', location_source: 'cnes',
    location: ewkb(-46.6602, -23.5598), city_ibge: 3550308, municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 },
  },
  '6543210': {
    cnes: '6543210', name: 'Laboratório Sem Mapa', legal_name: null, kind: 'laboratorio', address_line: 'Alameda Santos, 200',
    neighborhood: 'Bela Vista', cep: null, phone: null, shift: null, open_24h: false, sus: null,
    services: ['lab'], specialties: [], cnes_updated_at: null, location_source: null, location: null, city_ibge: 3550308,
    municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 },
  },
  '7654321': {
    cnes: '7654321', name: 'Imagem Paulista (CNES)', legal_name: null, kind: 'imagem', address_line: 'Av. Paulista, 1500', neighborhood: 'Bela Vista',
    cep: '01310200', phone: null, shift: null, open_24h: false, sus: false, services: [], specialties: [], cnes_updated_at: null,
    location_source: 'cnes', location: { type: 'Point', coordinates: [-46.6565, -23.5625] }, city_ibge: 3550308, municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 },
  },
};
const PARTNER_ID = 'bbbbbbbb-0000-4000-8000-000000000011';
const NOSCHED_ID = 'bbbbbbbb-0000-4000-8000-000000000012';
const CLINICS = {
  [PARTNER_ID]: {
    id: PARTNER_ID, name: 'Imagem Paulista Verificada', kind: 'imagem', description: 'Centro de diagnóstico por imagem <b>na Paulista</b>.', address_line: 'Av. Paulista, 1500',
    neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: '01310-200', location: { type: 'Point', coordinates: [-46.6565, -23.5625] },
    phone: '(11) 3222-1000', whatsapp: '5511988887777', email: 'contato@imagempaulista.com.br', website: 'https://imagempaulista.com.br',
    specialties: ['Radiologia'], opening_hours: { seg: '07:00–19:00', sab: '08:00–12:00' }, accepts_online_booking: true, status: 'published', is_demo: false,
    insurances: ['Bradesco Saúde', 'SulAmérica'], cnes: '7654321', verified_at: '2026-10-01T02:30:00+00:00',
    clinic_exams: [{ exam_code: 'tc', price_cents: 30000, price_updated_at: '2026-10-01T10:00:00Z' }, { exam_code: 'rm', price_cents: 45000, price_updated_at: '2026-10-01T01:30:00+00:00' }, { exam_code: 'rx', price_cents: null, price_updated_at: null }],
  },
  [NOSCHED_ID]: {
    id: NOSCHED_ID, name: 'Clínica Jardins Verificada', kind: 'clinica', description: null, address_line: 'Rua Oscar Freire, 100', neighborhood: 'Jardins', city: 'São Paulo', state: 'SP', cep: null,
    location: { type: 'Point', coordinates: [-46.665, -23.5672] }, phone: null, whatsapp: null, email: null, website: null, specialties: ['Cardiologia'], opening_hours: null,
    accepts_online_booking: true, status: 'published', is_demo: false, insurances: ['Amil'], cnes: null, clinic_exams: [{ exam_code: 'ecg', price_cents: null, price_updated_at: null }],
  },
};
const PARTNER_BY_CNES = { '7654321': PARTNER_ID };
const RATINGS = { 'cnes:2077485': { rating: 4.6, reviews: 12 } };
const REVIEWS = { 'cnes:2077485': [
  { rating: 5, comment: '<b>Ótimo</b> atendimento, rápido.', author_name: 'Maria Silva', created_at: '2026-10-20T13:00:00Z' },
  { rating: 4, comment: null, author_name: 'João', created_at: '2026-10-01T02:00:00+00:00' },
] };

// Relógio fixo (iMed Agenda 5.1): segunda-feira, 16/11/2026, 09:00 em São Paulo. Todas as páginas abrem com ele.
const NOW = '2026-11-16T12:00:00Z';
const NOW_MS = Date.parse(NOW);
const D1 = G.zonedDate(1, NOW_MS), D3 = G.zonedDate(3, NOW_MS);
const pg = (iso) => new Date(iso).toISOString().replace('.000Z', '+00:00');
const at = (day, hhmm, offset = '-03:00') => new Date(`${day}T${hhmm}:00${offset}`).toISOString();

// Agenda simulada da clínica parceira (motor novo): agenda_public_info, agenda_slots e agenda_book. Horários livres
// (no fuso da unidade): ressonância amanhã 09:00, 09:30 e 14:00 e daqui a 3 dias 08:00 (30 min); tomografia amanhã
// 16:00 (20 min). agenda_book segue o banco: confirma na hora, o mesmo id e código devolvem o mesmo resultado
// (replay), outro horário com o mesmo id = idempotency_conflict, horário já pego = slot_taken com outros horários.
// Dois aparelhos podem dividir a mesma agenda (dois pacientes no mesmo horário).
const PROC_RM = 'dddddddd-0000-4000-8000-0000000000a1';
const PROC_TC = 'dddddddd-0000-4000-8000-0000000000a2';
function agendaFake({ tz = 'America/Sao_Paulo', offset = '-03:00', mode = 'nativa', online = true } = {}) {
  const base = {
    [PROC_RM]: { min: 30, list: [[D1, '09:00'], [D1, '09:30'], [D1, '14:00'], [D3, '08:00']] },
    [PROC_TC]: { min: 20, list: [[D1, '16:00']] },
  };
  const st = { taken: new Map(), byId: new Map(), calls: [] };
  st.info = () => ({
    status: 'ok', clinic_id: PARTNER_ID, timezone: tz, mode, online,
    mode_text: 'A clínica usa a agenda do IMED: os horários mostrados são os livres na agenda dela agora.',
    online_text: online ? 'Escolha um horário livre e confirme.' : 'Esta clínica ainda não marca horário pelo site.',
    payment: 'no_local', payment_text: 'Pagamento no local, direto com a clínica.', cancel_until_min: online ? 0 : null, reschedule_until_min: online ? 120 : null,
    procedures: online ? [
      { id: PROC_RM, exam_code: 'rm', name: 'Ressonância', duration_min: 30, price_cents: 45000, price_text: null, prep_text: 'Retire objetos de metal.', fasting_hours: null },
      { id: PROC_TC, exam_code: 'tc', name: 'Tomografia', duration_min: 20, price_cents: null, price_text: 'sob consulta', prep_text: null, fasting_hours: 4 },
    ] : [],
  });
  st.free = (pid) => (base[pid]?.list ?? []).map(([d, h]) => at(d, h, offset)).filter((iso) => !st.taken.has(iso));
  st.rows = (pid) => st.free(pid).map((iso) => ({ slot_start: pg(iso), slot_end: pg(new Date(Date.parse(iso) + base[pid].min * 60000).toISOString()) }));
  st.book = (b) => {
    st.calls.push(b);
    const item = b.p_items?.[0] ?? {};
    const iso = new Date(item.starts_at).toISOString();
    const fp = `${item.procedure_id}|${iso}`;
    const prev = st.byId.get(b.p_id);
    if (prev) return prev.fp === fp && prev.token === b.p_token ? { ...prev.result, replay: true, request_status: 'confirmed' } : { status: 'idempotency_conflict' };
    let result;
    if (!base[item.procedure_id] || !(base[item.procedure_id].list.some(([d, h]) => at(d, h, offset) === iso))) result = { status: 'slot_taken', seq: 1, alternatives: st.free(item.procedure_id).map(pg).slice(0, 5) };
    else if (st.taken.has(iso)) result = { status: 'slot_taken', seq: 1, alternatives: st.free(item.procedure_id).filter((x) => x.slice(0, 10) === iso.slice(0, 10)).map(pg).slice(0, 5) };
    else {
      st.taken.set(iso, b.p_id);
      const end = new Date(Date.parse(iso) + base[item.procedure_id].min * 60000).toISOString();
      result = { status: 'ok', id: b.p_id, request_status: 'confirmed', slot_start: pg(iso), slot_end: pg(end), hold_expires_at: null,
        items: [{ seq: 1, procedure_id: item.procedure_id, starts_at: pg(iso), ends_at: pg(end) }] };
    }
    st.byId.set(b.p_id, { fp, token: b.p_token, result });
    return result;
  };
  return st;
}
// Clínica parceira sem a venda online ligada (só pedido).
const SEM_VENDA = { status: 'ok', clinic_id: NOSCHED_ID, timezone: 'America/Sao_Paulo', mode: 'pedido', online: false, procedures: [],
  mode_text: 'Você envia um pedido e a clínica ou a equipe do IMED entra em contato para combinar o horário.' };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
const preflight = (route) => route.request().method() === 'OPTIONS' && (route.fulfill({ status: 204, headers: CORS }), true);

// report: resposta de report_place_issue (padrão 'ok'). viewport: outro tamanho de tela (o celular é 390×844).
// agenda: agenda simulada (agendaFake; padrão: uma nova por página); book: troca a resposta de agenda_book (route, body, agenda);
// now: relógio fixo (padrão: NOW).
async function newPage(browser, { mobile = false, viewport, tz = 'America/Sao_Paulo', est, clinics, insert, initScript, report, agenda, book, now = NOW, colorScheme } = {}) {
  const context = await browser.newContext({
    viewport: viewport ?? (mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }),
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: tz, serviceWorkers: 'block', acceptDownloads: true,
    ...(colorScheme ? { colorScheme } : {}),
  });
  if (now) await context.clock.setFixedTime(new Date(now));
  const ag = agenda ?? agendaFake();
  if (initScript) await context.addInitScript(initScript);
  const log = { est: [], clinics: [], rpc: [], insert: [] };
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await context.route((u) => u.href.startsWith(`${REST}establishments`), async (route) => {
    if (preflight(route)) return;
    const u = new URL(route.request().url());
    log.est.push(u.search);
    if (est) return est(route, u);
    const cnes = u.searchParams.get('cnes')?.replace('eq.', '');
    return json(route, EST[cnes] ? [EST[cnes]] : []);
  });
  await context.route((u) => u.href.startsWith(`${REST}clinics`), async (route) => {
    if (preflight(route)) return;
    const u = new URL(route.request().url());
    log.clinics.push(u.search);
    if (clinics) return clinics(route, u);
    const id = u.searchParams.get('id')?.replace('eq.', '');
    const cnes = u.searchParams.get('cnes')?.replace('eq.', '');
    if (cnes) return json(route, PARTNER_BY_CNES[cnes] ? [{ id: PARTNER_BY_CNES[cnes] }] : []);
    return json(route, CLINICS[id] ? [CLINICS[id]] : []);
  });
  await context.route((u) => u.href.startsWith(`${REST}rpc/`), async (route) => {
    if (preflight(route)) return;
    const fn = new URL(route.request().url()).pathname.split('/').pop();
    const body = JSON.parse(route.request().postData() || '{}');
    log.rpc.push({ fn, body });
    if (fn === 'place_ratings') return json(route, body.p_keys.filter((k) => RATINGS[k]).map((k) => ({ place_key: k, ...RATINGS[k] })));
    if (fn === 'place_reviews') return json(route, (REVIEWS[body.p_key] ?? []).slice(0, body.p_limit));
    if (fn === 'agenda_public_info') return json(route, body.p_clinic === PARTNER_ID ? ag.info() : body.p_clinic === NOSCHED_ID ? SEM_VENDA : { status: 'not_found' });
    if (fn === 'agenda_slots') return json(route, body.p_clinic === PARTNER_ID ? ag.rows(body.p_procedure) : []);
    if (fn === 'agenda_book') return book ? book(route, body, ag) : json(route, ag.book(body));
    if (fn === 'report_place_issue') return report ? report(route, body) : json(route, 'ok');
    return json(route, []);
  });
  await context.route(`${REST}appointment_requests`, async (route) => {
    if (preflight(route)) return;
    log.insert.push({ body: JSON.parse(route.request().postData()), headers: route.request().headers() });
    return (insert ?? ((r) => r.fulfill({ status: 201, body: '', headers: CORS })))(route, log);
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, log, errors, agenda: ag };
}

const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(450); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); } };
const results = [];
// Tempo máximo de cada cenário (E2E_CENARIO_S segundos, padrão 150): um cenário travado falha com o nome dele,
// em vez de segurar o arquivo inteiro até o limite do CI.
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  try { await Promise.race([comChaves(fn), limite(name)]); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 4).join('\n  ')}`); }
}
const ld = (page) => page.$eval('script[type="application/ld+json"]', (s) => JSON.parse(s.textContent));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const fillPerson = async (page) => {
  await page.fill('#bkName', 'Ana Teste');
  await page.fill('#bkPhone', '11987654321');
  await page.check('input[name="consent"]');
};

const browser = vigiarChaves(await chromium.launch());

await scenario('ficha do CNES: dados reais, SUS, turno com ressalva, mapa, avaliações e SEO', async () => {
  // Navegador em outro fuso: datas continuam as de São Paulo. Localização vem como EWKB (texto hexadecimal).
  const { page, errors, context } = await newPage(browser, { tz: 'Asia/Tokyo' });
  await page.goto(`${BASE}local.html?cnes=2077485`);
  await page.waitForSelector('#lcName');
  await page.waitForSelector('#avaliacoes:not([hidden]) li');
  assert.equal(await page.textContent('h1'), 'Hospital Santa Exemplo');
  const head = await page.textContent('.lc-head');
  assert.match(head, /Cadastro oficial/);
  assert.match(head, /Atende SUS/);
  assert.match(head, /Hospital · São Paulo - SP/);
  assert.match(head, /Rua Peixoto Gomide, 625 · Cerqueira César · São Paulo - SP · CEP 01409-001/);
  assert.match(head, /Razão social: Associação Santa Exemplo/);
  assert.match(head, /4,6 \(12 avaliações\)/);
  assert.equal(await page.locator('.lc-head a:has-text("Parceiro verificado")').count(), 0);
  assert.match(await page.textContent('#horario'), /Manhã, tarde e noite.*não é o horário exato/s, 'turno com a ressalva');
  assert.match(await page.textContent('#atendimento'), /Atende SUS, segundo o cadastro oficial/);
  assert.match(await page.textContent('#exames'), /Ressonância.*Tomografia/s);
  assert.ok(!/R\$/.test(await page.textContent('#exames')), 'sem preço para quem não é parceiro');
  assert.match(await page.textContent('#especialidades'), /Cardiologia.*Ortopedia/s);
  // mapa com o ponto: o Leaflet só é baixado quando o mapa chega perto da tela (rola até ele)
  await page.locator('#lcMap').scrollIntoViewIfNeeded();
  await page.waitForSelector('#lcMap .leaflet-marker-icon');
  assert.equal(await page.locator('#lcMap .leaflet-marker-icon').count(), 1);
  // avaliações: HTML escapado
  const rv = await page.textContent('#avaliacoes');
  assert.match(rv, /<b>Ótimo<\/b> atendimento/, 'comentário aparece como texto');
  assert.equal(await page.locator('#avaliacoes b:has-text("Ótimo")').count(), 0);
  assert.match(rv, /Maria/);
  assert.match(rv, /João · set\.? de 2026/, 'mês da avaliação no fuso de São Paulo (30/09 às 23h)');
  assert.ok(!/Silva/.test(rv), 'só o primeiro nome');
  // ações
  const tel = await page.getAttribute('.lc-acts a:has-text("Ligar")', 'href');
  assert.equal(tel, 'tel:+551131411000');
  const dir = await page.getAttribute('.lc-acts a:has-text("Como chegar")', 'href');
  assert.ok(dir.startsWith('https://www.google.com/maps/dir/?api=1&destination='), dir);
  assert.match(decodeURIComponent(dir), /Rua Peixoto Gomide, 625, Cerqueira César, São Paulo - SP, 01409-001/);
  assert.equal(await page.getAttribute('.lc-acts a:has-text("Ver no mapa")', 'href'), 'perto.html?local=cnes%3A2077485');
  assert.equal(await page.getAttribute('a:has-text("Assuma o cadastro")', 'href'), 'reivindicar.html?cnes=2077485');
  assert.match(await page.textContent('a:has-text("Assuma o cadastro")'), /É o responsável\? Assuma o cadastro/);
  assert.match(await page.textContent('.lc-rest .note'), /CNES.*atualizados em 15\/09\/2026/s);
  // Confiança: emergência na ficha; fonte oficial sem parecer coisa do governo; quem corrige o cadastro oficial.
  assert.match(await page.textContent('.lc-head .sos'), /Emergência\? Ligue 192 \(SAMU\)/);
  assert.equal(await page.getAttribute('.lc-head .sos a', 'href'), 'tel:192');
  assert.match(await page.textContent('.lc-rest .note'), /O IMED é um serviço privado, sem vínculo com o governo ou o SUS\. A correção do cadastro oficial é feita pelo próprio estabelecimento, no CNES\./);
  assert.equal(await page.locator('#avaliacoes a[href="como-funciona.html#avaliacoes"]').count(), 1, 'regras das avaliações');
  assert.equal(await page.locator('footer.rodape').count(), 1, 'rodapé do IMED');
  assert.match(await page.textContent('footer.rodape'), /Médico responsável: Dr\. Rafael Pereira Barreto Silva — CRM-SP 266930/);
  assert.equal(await page.locator('.pt-nav a[href="./#agenda"]').textContent(), 'Meus pedidos');
  // SEO
  assert.equal(await page.title(), 'Hospital Santa Exemplo em São Paulo - SP | IMED');
  assert.match(await page.getAttribute('meta[name="description"]', 'content'), /^Hospital em São Paulo - SP\..*Atende SUS\.$/);
  assert.equal(await page.getAttribute('link[rel="canonical"]', 'href'), `${SITE}local.html?cnes=2077485`);
  const data = await ld(page);
  assert.equal(data['@type'], 'Hospital');
  assert.equal(data.name, 'Hospital Santa Exemplo');
  assert.equal(data.telephone, '(11) 3141-1000');
  assert.equal(data.address.postalCode, '01409-001');
  assert.deepEqual(data.geo, { '@type': 'GeoCoordinates', latitude: -23.5598, longitude: -46.6602 });
  assert.deepEqual(data.aggregateRating, { '@type': 'AggregateRating', ratingValue: 4.6, reviewCount: 12, bestRating: 5, worstRating: 1 }, 'nota real, com os números do banco');
  await shot(page, 'l01-ficha-cnes');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('ficha do CNES sem avaliações e sem localização: sem nota, sem mapa', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}local.html?cnes=6543210`);
  await page.waitForSelector('#lcName');
  await page.waitForFunction(() => document.querySelector('script[type="application/ld+json"]'));
  await page.waitForTimeout(300);
  const data = await ld(page);
  assert.equal(data['@type'], 'DiagnosticLab');
  assert.ok(!('aggregateRating' in data), 'sem avaliações, sem AggregateRating');
  assert.ok(!('geo' in data));
  assert.equal(await page.locator('#lcMap').count(), 0, 'sem coordenadas, sem mapa');
  assert.match(await page.textContent('#localizacao'), /não tem a localização exata/);
  assert.equal(await page.locator('#avaliacoes').isHidden(), true);
  assert.equal(await page.locator('.lc-rate').count(), 0);
  assert.equal(await page.locator('.lc-acts a:has-text("Ver no mapa")').count(), 0);
  assert.equal(await page.locator('#atendimento').count(), 0, 'SUS sem informação não aparece');
  assert.match(await page.textContent('#horario'), /Horário não informado/);
  assert.match(await page.textContent('#contato'), /não informou telefone/);
  await context.close();
  assert.deepEqual(errors, []);
});

await scenario('ficha do CNES: aparelhos informados ao CNES, com SUS, fonte e competência, sem prometer o exame', async () => {
  const row = { ...EST['2077485'], services: [], equip_exams: ['rm', 'tc'], equip_exams_sus: ['tc'], equip_competencia: '2026-09-01' };
  const est = (route, u) => json(route, u.searchParams.get('cnes') === 'eq.2077485' ? [row] : []);
  const { page, errors, context } = await newPage(browser, { est });
  await page.goto(`${BASE}local.html?cnes=2077485`);
  await page.waitForSelector('[data-equip]');
  const t = await page.textContent('[data-equip]');
  assert.match(t, /Aparelhos informados ao CNES/);
  assert.match(t, /Aparelho de ressonância\s*O local informou que este aparelho não atende pelo SUS/);
  assert.match(t, /Aparelho de tomografia\s*O local informou que este aparelho atende pelo SUS/);
  assert.match(t, /Confirme com o local/);
  assert.match(t, /Isso não garante que ele faça o exame para o público/);
  assert.match(t, /Fonte: CNES\/DATASUS – Ministério da Saúde, competência 09\/2026/);
  assert.ok(!/particular/i.test(t));
  assert.match(await page.textContent('#exames'), /Ressonância/);
  await context.close();
  assert.deepEqual(errors, []);
});

await scenario('compartilhar: usa o compartilhamento do celular ou copia o link', async () => {
  const shared = await newPage(browser, { initScript: () => { navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }; } });
  await shared.page.goto(`${BASE}local.html?cnes=2077485`);
  await shared.page.click('[data-act="share"]');
  const d = await shared.page.evaluate(() => window.__shared);
  assert.equal(d.url, `${SITE}local.html?cnes=2077485`);
  assert.equal(d.title, 'Hospital Santa Exemplo em São Paulo - SP | IMED');
  await shared.context.close();
  const copy = await newPage(browser, { initScript: () => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true });
  } });
  await copy.page.goto(`${BASE}local.html?cnes=2077485`);
  await copy.page.click('[data-act="share"]');
  await copy.page.waitForSelector('.toast.show');
  assert.match(await copy.page.textContent('#toast'), /Link copiado/);
  assert.equal(await copy.page.evaluate(() => window.__copied), `${SITE}local.html?cnes=2077485`);
  assert.deepEqual(copy.errors, []);
  await copy.context.close();
});

await scenario('CNES: pedido ao IMED (concierge) sem horário marcado', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}local.html?cnes=2077485`);
  await page.waitForSelector('#agendar [data-act="pedido"]');
  assert.match(await page.textContent('#agendar'), /ainda não é parceiro do IMED/);
  await page.click('#agendar [data-act="pedido"]');
  // Formulário: emergência no começo; gratuito (contra golpes) e privacidade perto de "Enviar pedido".
  assert.match(await page.textContent('#bookForm .sos'), /O pedido não é para emergência/);
  assert.match(await page.textContent('#bookForm .trust .free'), /O IMED é gratuito para você\..*o pagamento é feito direto no local\. O IMED nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp\./s);
  assert.match(await page.textContent('#bookForm .trust .priv'), /só para o IMED e para o local escolhido · ficam em servidor no Brasil · sem anúncios e sem rastreadores de anúncio · sua localização é aproximada e não é gravada/);
  assert.ok(await page.evaluate(() => document.querySelector('#bookForm .trust').nextElementSibling.contains(document.querySelector('#bkBtn'))), 'faixa logo antes do botão');
  await page.click('#bkBtn');
  assert.ok(await page.locator('[data-f="exam"].bad').count(), 'exige o exame');
  assert.ok(await page.locator('[data-f="consent"].bad').count(), 'exige o consentimento');
  assert.equal(log.insert.length, 0);
  await page.selectOption('#bkExam', 'rm');
  await page.fill('#bkDate', await page.$eval('#bkDate', (el) => el.min));
  await page.check('input[name="periodo"][value="tarde"]', { force: true });
  await fillPerson(page);
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  assert.match(await page.textContent('.lc-ok'), /Recebemos seu pedido!.*IMED-/s);
  assert.match(await page.textContent('.lc-ok .trust .free'), /O IMED é gratuito para você.*nunca pede Pix/s, 'pedido enviado: aviso contra o golpe do falso agendamento');
  const row = log.insert[0].body;
  assert.equal(row.clinic_id, null);
  assert.equal(row.place_source, 'cnes');
  assert.equal(row.place_ref, 'cnes:2077485');
  assert.equal(row.preferred_period, 'tarde');
  assert.equal(row.consent, true);
  assert.ok(!('slot_start' in row));
  assert.match(row.review_token_hash, /^[0-9a-f]{64}$/);
  assert.equal(log.insert[0].headers.prefer, 'return=minimal');
  const appts = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(appts[0].status, 'pendente');
  assert.ok(!('slot' in appts[0]));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('contador de visitas (?visitas=teste): conta só a visita; o pedido não vai para o contador (o número real vem do banco)', async () => {
  let fail = true;
  const insert = (r) => (fail ? r.fulfill({ status: 500, body: '{}', headers: CORS }) : r.fulfill({ status: 201, body: '', headers: CORS }));
  const { page, log, errors, context } = await newPage(browser, { insert });
  const tracks = () => log.rpc.filter((x) => x.fn === 'track').map((x) => x.body);
  const wait = async (n) => { for (let i = 0; i < 160 && tracks().length < n; i += 1) await page.waitForTimeout(50); assert.ok(tracks().length >= n, `esperava ${n} envios, chegaram ${tracks().length}`); };
  await page.goto(`${BASE}local.html?cnes=2077485&visitas=teste`);
  await wait(1);
  assert.deepEqual(tracks(), [{ p_path: '/local.html' }], 'a visita: só o caminho, sem o código do local');
  await page.click('#agendar [data-act="pedido"]');
  await page.selectOption('#bkExam', 'rm');
  await page.fill('#bkDate', await page.$eval('#bkDate', (el) => el.min));
  await page.check('input[name="periodo"][value="tarde"]', { force: true });
  await fillPerson(page);
  await page.click('#bkBtn');
  await page.waitForSelector('#bkErr.show');
  await page.waitForTimeout(300);
  assert.equal(tracks().length, 1, 'pedido que não foi gravado não conta');
  fail = false;
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  await page.waitForTimeout(600);
  assert.deepEqual(tracks(), [{ p_path: '/local.html' }], 'o pedido não vai para o contador: a equipe vê o número real, das tabelas do banco');
  assert.ok(!/Ana|98765|2077485/.test(JSON.stringify(tracks())), 'nada da pessoa nem do local');
  assert.deepEqual(errors, []);
  await context.close();
  // Robô que preenche o campo escondido: a página finge que enviou, mas nada é gravado nem contado.
  const bot = await newPage(browser);
  await bot.page.goto(`${BASE}local.html?cnes=2077485&visitas=teste`);
  await bot.page.click('#agendar [data-act="pedido"]');
  await bot.page.selectOption('#bkExam', 'rm');
  await bot.page.fill('#bkDate', await bot.page.$eval('#bkDate', (el) => el.min));
  await bot.page.check('input[name="periodo"][value="tarde"]', { force: true });
  await fillPerson(bot.page);
  await bot.page.$eval('#bookForm input[name="website"]', (el) => { el.value = 'http://spam.example'; });
  await bot.page.click('#bkBtn');
  await bot.page.waitForSelector('.lc-ok');
  await bot.page.waitForTimeout(800);
  assert.equal(bot.log.insert.length, 0);
  assert.deepEqual(bot.log.rpc.filter((x) => x.fn === 'track').map((x) => x.body.p_event ?? 'visita'), ['visita']);
  await bot.context.close();
});

const book = (log) => log.rpc.filter((c) => c.fn === 'agenda_book');
const times = (page) => page.$$eval('.sl-t', (els) => els.map((e) => e.textContent));

await scenario('horário direto: o paciente escolhe o horário e sai confirmado (relógio fixo; aparelho em Tóquio, horários de Brasília)', async () => {
  const { page, log, errors, context } = await newPage(browser, { tz: 'Asia/Tokyo' });
  await page.goto(`${BASE}local.html?id=${PARTNER_ID}`);
  await page.waitForSelector('.sl-t');
  const head = await page.textContent('.lc-head');
  assert.match(head, /Parceiro verificado/);
  assert.match(head, /Horário confirmado na hora/, 'selo honesto da modalidade (agenda do IMED)');
  assert.ok(!/Agenda online|confirmad[ao] pela clínica/.test(head), 'sem o selo antigo');
  assert.match(await page.getAttribute('.bd-agenda', 'title'), /agenda do IMED/);
  const exams = await page.textContent('#exames');
  assert.match(exams, /Ressonância preparo\s*R\$\s*450/);
  assert.match(exams, /Ressonância preparo\s*R\$\s*450\s*informado em 30\/09\/2026/, 'data do preço no fuso de São Paulo (01:30 UTC = 30/09 22:30)');
  assert.match(await page.textContent('#atendimento'), /Bradesco Saúde.*SulAmérica/s);
  assert.match(await page.textContent('#sobre'), /<b>na Paulista<\/b>/, 'descrição escapada');
  assert.equal((await ld(page))['@type'], 'DiagnosticLab');
  // o motor: a clínica, o procedimento e os 14 dias no fuso da unidade
  assert.deepEqual(log.rpc.find((c) => c.fn === 'agenda_public_info').body, { p_clinic: PARTNER_ID });
  assert.deepEqual(log.rpc.find((c) => c.fn === 'agenda_slots').body, { p_clinic: PARTNER_ID, p_procedure: PROC_RM, p_from: '2026-11-16', p_to: '2026-11-29' });
  assert.equal(log.rpc.filter((c) => c.fn === 'clinics_with_schedule' || c.fn === 'available_slots').length, 0, 'a grade antiga não é mais usada');
  assert.equal(await page.locator('.sl-day').count(), 14, 'próximos 14 dias');
  assert.equal(await page.locator('.sl-day:not([disabled])').count(), 2, 'só dias com horário livre');
  assert.equal(await page.getAttribute('.sl-day.on', 'data-day'), D1);
  assert.deepEqual(await times(page), ['09:00', '09:30', '14:00'], 'horário de Brasília, mesmo com o aparelho em Tóquio');
  assert.match(await page.textContent('.sl-next'), /Próximo horário livre: amanhã às 09:00/);
  const box = await page.textContent('#agendar');
  assert.match(box, /Horários no horário de Brasília, o da clínica/);
  assert.match(box, /A clínica usa a agenda do IMED/);
  assert.match(box, /Retire objetos de metal\./, 'preparo informado pela clínica');
  assert.match(await page.$eval('#slProc', (el) => [...el.options].map((o) => o.textContent).join(' | ')), /Ressonância · R\$\s*450 · 30 min \| Tomografia · preço sob consulta · 20 min/);
  await shot(page, 'l02-parceiro-horarios');
  await page.click(`.sl-day[data-day="${D3}"]`);
  assert.deepEqual(await times(page), ['08:00']);
  // outro exame busca de novo (o procedimento da clínica)
  await page.selectOption('#slProc', PROC_TC);
  await page.waitForFunction(() => document.querySelectorAll('.sl-t').length === 1 && document.querySelector('.sl-t').textContent === '16:00');
  assert.equal(log.rpc.filter((c) => c.fn === 'agenda_slots').at(-1).body.p_procedure, PROC_TC);
  assert.match(await page.textContent('#agendar'), /Jejum de 4 horas\./);
  await page.selectOption('#slProc', PROC_RM);
  await page.waitForFunction(() => document.querySelectorAll('.sl-t').length === 3);
  await page.click('.sl-t:has-text("09:30")');
  await page.waitForSelector('#bookForm[data-mode="slot"]');
  const chosen = await page.textContent('.sl-chosen');
  assert.match(chosen, new RegExp(`Ressonância.*${G.formatDateLong(D1)} às 09:30 \\(horário de Brasília\\).*30 min · R\\$\\s*450`, 's'), 'o aparelho está em outro fuso: a hora diz de onde é');
  assert.equal(await page.locator('#bkNotes').count(), 0, 'sem observações livres na marcação direta');
  assert.match(await page.textContent('.sl-rules'), /Pagamento no local, direto com a clínica\..*até o horário marcado/s);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'bkName', 'foco no primeiro campo');
  await page.click('#bkBtn');
  assert.ok(await page.locator('[data-f="consent"].bad').count(), 'exige o consentimento');
  assert.equal(book(log).length, 0);
  await fillPerson(page);
  await page.fill('#bkEmail', 'Ana@Exemplo.com');
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  const [call] = book(log);
  const expected = new Date(`${D1}T09:30:00-03:00`).toISOString();
  assert.equal(call.body.p_clinic, PARTNER_ID);
  assert.deepEqual(call.body.p_items, [{ procedure_id: PROC_RM, starts_at: expected }]);
  assert.deepEqual(call.body.p_patient, { name: 'Ana Teste', phone: '11987654321', email: 'ana@exemplo.com', consent: true });
  assert.ok(G.isUuid(call.body.p_id));
  assert.match(call.body.p_token, /^[0-9a-f]{64}$/);
  assert.equal(log.insert.length, 0, 'nada de INSERT direto com horário');
  const ok = await page.textContent('.lc-ok');
  assert.match(ok, new RegExp(`Agendamento confirmado para ${G.formatDateLong(D1)} às 09:30 \\(horário de Brasília\\)`));
  assert.match(ok, new RegExp(G.protocolFromId(call.body.p_id)));
  assert.match(ok, /reservado e confirmado na agenda da clínica/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'h-agendar', 'foco no título da confirmação');
  await shot(page, 'l03-agendamento-confirmado');
  // .ics em UTC, com a duração real (fim que o banco devolveu)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="ics"]')]);
  const ics = await readFile(await dl.path(), 'utf8');
  assert.match(ics, /DTSTART:20261117T123000Z\r\nDTEND:20261117T130000Z/);
  assert.match(ics, /STATUS:CONFIRMED/);
  // resumo no aparelho, com o mesmo id e código enviados; a intenção é apagada depois de confirmar
  const appts = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(appts[0].id, call.body.p_id);
  assert.equal(appts[0].token, call.body.p_token);
  assert.equal(appts[0].status, 'confirmado');
  assert.equal(appts[0].slot, expected);
  assert.equal(appts[0].slot_end, new Date(`${D1}T10:00:00-03:00`).toISOString());
  assert.equal(appts[0].tz, 'America/Sao_Paulo');
  assert.deepEqual(appts[0].items, ['Ressonância']);
  assert.equal(appts[0].place_key, `imed:${PARTNER_ID}`);
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_intencao')), null);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('dois pacientes no mesmo horário: só 1 confirma; o outro vê outros horários e marca com id novo', async () => {
  const agenda = agendaFake();
  const a = await newPage(browser, { agenda });
  const b = await newPage(browser, { agenda });
  for (const x of [a, b]) {
    await x.page.goto(`${BASE}local.html?id=${PARTNER_ID}#agendar`);
    await x.page.click('.sl-t:has-text("09:00")');
    await fillPerson(x.page);
  }
  await b.page.fill('#bkName', 'Bruno Teste');
  await b.page.fill('#bkPhone', '11912345678');
  await a.page.click('#bkBtn');
  await a.page.waitForSelector('.lc-ok');
  // B tocou em Confirmar no mesmo horário, um instante depois
  await b.page.click('#bkBtn');
  await b.page.waitForSelector('#slNotice');
  assert.match(await b.page.textContent('#slNotice'), /acabou de ser ocupado por outra pessoa/);
  await b.page.waitForSelector('.sl-t');
  assert.deepEqual(await times(b.page), ['09:30', '14:00'], 'o horário pego some; os outros continuam');
  assert.equal(await b.page.evaluate(() => document.activeElement?.id), 'slNotice', 'foco vai para o aviso');
  assert.equal(await b.page.evaluate(() => localStorage.getItem('imed_appts')), null, 'nada guardado como agendado');
  assert.equal(await b.page.evaluate(() => localStorage.getItem('imed_intencao')), null, 'a intenção do horário perdido é descartada');
  await shot(b.page, 'l04-horario-ocupado');
  await b.page.click('.sl-t:has-text("09:30")');
  await b.page.waitForSelector('#bookForm[data-mode="slot"]');
  assert.equal(await b.page.inputValue('#bkName'), 'Bruno Teste', 'o que já foi digitado continua');
  assert.ok(await b.page.isChecked('input[name="consent"]'), 'consentimento mantido');
  await b.page.click('#bkBtn');
  await b.page.waitForSelector('.lc-ok');
  assert.match(await b.page.textContent('.lc-ok'), /às 09:30/);
  const [a1] = book(a.log);
  const [b1, b2] = book(b.log);
  assert.equal(agenda.calls.length, 3);
  assert.equal(new Date(b1.body.p_items[0].starts_at).toISOString(), new Date(a1.body.p_items[0].starts_at).toISOString(), 'os dois tentaram o mesmo horário');
  assert.notEqual(b2.body.p_id, b1.body.p_id, 'depois de slot_taken, id novo');
  assert.notEqual(b2.body.p_token, b1.body.p_token);
  assert.deepEqual([...agenda.taken.values()], [a1.body.p_id, b2.body.p_id], 'só um agendamento por horário');
  assert.deepEqual(a.errors, []);
  assert.deepEqual(b.errors, []);
  await a.context.close();
  await b.context.close();
});

await scenario('resposta perdida: "Tentar de novo" reenvia o mesmo id e código (gravados antes do envio) e não marca duas vezes', async () => {
  let n = 0;
  let saved = null;
  const { page, log, errors, context, agenda } = await newPage(browser, {
    book: async (route, body, ag) => {
      n += 1;
      if (n === 1) {
        ag.book(body); // o banco gravou...
        saved = await pageRef.evaluate(() => JSON.parse(localStorage.getItem('imed_intencao')));
        return route.abort('connectionreset'); // ...mas a resposta não chegou
      }
      return json(route, ag.book(body));
    },
  });
  const pageRef = page;
  await page.goto(`${BASE}local.html?id=${PARTNER_ID}#agendar`);
  await page.click('.sl-t:has-text("14:00")');
  await fillPerson(page);
  await page.click('#bkBtn');
  await page.waitForSelector('#bkErr.show');
  assert.match(await page.textContent('#bkErr'), /Tentar de novo: o mesmo pedido é reenviado, sem marcar duas vezes/);
  assert.match(await page.textContent('#bkBtn'), /Tentar de novo/);
  const [first] = book(log);
  assert.equal(saved?.id, first.body.p_id, 'id gravado no aparelho ANTES do envio');
  assert.equal(saved?.token, first.body.p_token, 'código também');
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  const [, second] = book(log);
  assert.equal(second.body.p_id, first.body.p_id, 'o reenvio usa o mesmo id');
  assert.equal(second.body.p_token, first.body.p_token);
  assert.equal(agenda.taken.size, 1, 'um agendamento só');
  const appts = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(appts.length, 1);
  assert.equal(appts[0].id, first.body.p_id);
  assert.deepEqual(errors.filter((e) => !/ERR_CONNECTION_RESET|Failed to fetch/.test(e)), []);
  await context.close();
});

await scenario('horário pego pela API (409 / 23P01), limite do celular e venda desligada no meio: mensagens claras', async () => {
  let resp = 'taken409';
  const { page, log, errors, context } = await newPage(browser, {
    book: (route, body, ag) => {
      if (resp === 'taken409') { ag.taken.set(new Date(body.p_items[0].starts_at).toISOString(), 'outro'); return json(route, { code: '23P01', message: 'conflicting key value violates exclusion constraint', details: null, hint: null }, 409); }
      if (resp === 'limite') return json(route, { status: 'too_many_bookings' });
      return json(route, { status: 'not_online' });
    },
  });
  await page.goto(`${BASE}local.html?id=${PARTNER_ID}#agendar`);
  await page.click('.sl-t:has-text("09:00")');
  await fillPerson(page);
  await page.click('#bkBtn');
  await page.waitForSelector('#slNotice');
  assert.match(await page.textContent('#slNotice'), /acabou de ser ocupado/);
  assert.deepEqual(await times(page), ['09:30', '14:00']);
  resp = 'limite';
  await page.click('.sl-t:has-text("09:30")');
  await page.click('#bkBtn');
  await page.waitForSelector('#bkErr.show');
  assert.match(await page.textContent('#bkErr'), /máximo de agendamentos por vir nesta clínica/);
  assert.match(await page.textContent('#bkErr'), /ligue para a clínica/);
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_intencao')), null, 'limite: a próxima tentativa usa id novo');
  resp = 'fechou';
  await page.click('#bkBtn');
  await page.waitForSelector('#bookForm[data-mode="pedido"]');
  assert.match(await page.textContent('#slNotice'), /não está marcando horário pelo site agora/);
  assert.equal(await page.locator('.bd-agenda').count(), 0, 'sem venda, sem selo de agenda');
  assert.equal(await page.inputValue('#bkName'), 'Ana Teste', 'os dados digitados seguem para o pedido');
  assert.equal(book(log).length, 3);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('clínica em Manaus: horários no fuso da unidade, escrito quando o aparelho está em outro', async () => {
  const agenda = agendaFake({ tz: 'America/Manaus', offset: '-04:00' });
  const { page, log, errors, context } = await newPage(browser, { agenda });
  await page.goto(`${BASE}local.html?id=${PARTNER_ID}#agendar`);
  await page.waitForSelector('.sl-t');
  assert.deepEqual(await times(page), ['09:00', '09:30', '14:00'], 'a hora de Manaus, não a de São Paulo');
  assert.match(await page.textContent('#agendar'), /Horários no horário de Manaus, o da clínica/);
  assert.equal(log.rpc.find((c) => c.fn === 'agenda_slots').body.p_from, '2026-11-16', 'hoje em Manaus');
  await page.click('.sl-t:has-text("09:00")');
  assert.match(await page.textContent('.sl-chosen'), /às 09:00 \(horário de Manaus\)/);
  await fillPerson(page);
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  assert.equal(book(log)[0].body.p_items[0].starts_at, new Date(`${D1}T09:00:00-04:00`).toISOString(), 'o instante certo (13:00 UTC)');
  const appts = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(appts[0].tz, 'America/Manaus');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('parceiro sem venda online: pedido de agendamento, sem horários e sem selo de agenda', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}local.html?id=${NOSCHED_ID}`);
  await page.waitForSelector('#agendar [data-act="pedido"]');
  assert.equal(log.rpc.filter((c) => c.fn === 'agenda_slots').length, 0);
  assert.equal(await page.locator('.bd-agenda').count(), 0);
  assert.match(await page.textContent('#exames'), /Eletrocardiograma preparo\s*Preço sob consulta/);
  await page.click('#agendar [data-act="pedido"]');
  assert.deepEqual(await page.$$eval('#bkExam option', (els) => els.map((e) => e.value)), ['', 'ecg', 'consulta', 'outro'], 'só os exames da clínica');
  await context.close();
  assert.deepEqual(errors, []);
  // A clínica parceira com agenda, mas a venda desligada (online false) ou agenda externa (sem integração): pedido.
  for (const opts of [{ online: false }, { mode: 'externa' }]) {
    const x = await newPage(browser, { agenda: agendaFake(opts) });
    await x.page.goto(`${BASE}local.html?id=${PARTNER_ID}`);
    await x.page.waitForSelector('#agendar [data-act="pedido"]');
    assert.equal(x.log.rpc.filter((c) => c.fn === 'agenda_slots').length, 0, JSON.stringify(opts));
    assert.equal(await x.page.locator('.bd-agenda').count(), 0);
    assert.deepEqual(x.errors, []);
    await x.context.close();
  }
});

await scenario('CNES que virou parceiro abre a página do parceiro', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}local.html?cnes=7654321`);
  await page.waitForURL(`**/local.html?id=${PARTNER_ID}`);
  await page.waitForSelector('#lcName');
  assert.equal(await page.textContent('h1'), 'Imagem Paulista Verificada');
  // O exame escolhido na busca segue junto no redirecionamento.
  await page.goto(`${BASE}local.html?cnes=7654321&exame=tc#agendar`);
  await page.waitForURL(`**/local.html?id=${PARTNER_ID}&exame=tc#agendar`);
  await page.waitForSelector('.sl-t');
  assert.equal(await page.inputValue('#slProc'), PROC_TC, 'o procedimento do exame da busca');
  assert.deepEqual(await page.$$eval('.sl-t', (els) => els.map((e) => e.textContent)), ['16:00']);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('não encontrado e erro com "Tentar de novo"', async () => {
  const nf = await newPage(browser);
  await nf.page.goto(`${BASE}local.html?cnes=0000000`);
  await nf.page.waitForSelector('.lc-st h1');
  assert.equal(await nf.page.textContent('.lc-st h1'), 'Local não encontrado');
  assert.equal(await nf.page.getAttribute('.lc-st a', 'href'), 'perto.html');
  assert.equal(await nf.page.getAttribute('meta[name="robots"]', 'content'), 'noindex');
  const asked = nf.log.clinics.length + nf.log.est.length;
  await nf.page.goto(`${BASE}local.html?id=nao-e-um-id`);
  await nf.page.waitForSelector('.lc-st h1');
  assert.equal(await nf.page.textContent('.lc-st h1'), 'Local não encontrado');
  assert.equal(nf.log.clinics.length + nf.log.est.length, asked, 'referência inválida nem chega ao banco');
  await nf.context.close();

  let fail = true;
  const er = await newPage(browser, { est: (r, u) => (fail ? json(r, { message: 'erro' }, 500) : json(r, [EST[u.searchParams.get('cnes').slice(3)]])) });
  await er.page.goto(`${BASE}local.html?cnes=2077485`);
  await er.page.waitForSelector('[data-act="reload"]');
  assert.match(await er.page.textContent('.lc-st'), /Não foi possível carregar/);
  fail = false;
  await er.page.click('[data-act="reload"]');
  await er.page.waitForSelector('#lcName');
  assert.equal(await er.page.textContent('h1'), 'Hospital Santa Exemplo');
  await er.context.close();
});

await scenario('confiança: código CNES ao lado de "Ver no CNES" e "Algo errado aqui?" gravado no banco', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}local.html?cnes=2077485`);
  await page.waitForSelector('#lcName');
  const note = await page.textContent('.lc-rest .note');
  assert.match(note, /Código CNES 2077485\s*Ver no CNES/, 'código de 7 dígitos ao lado do link');
  assert.equal(await page.getAttribute('.lc-rest .note a:has-text("Ver no CNES")', 'href'), 'https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/3550302077485');
  // "Algo errado aqui?": explica quem corrige o cadastro oficial e não pede nome nem contato.
  const card = page.locator('#avisar');
  assert.match(await card.textContent(), /Algo errado aqui\? Avise o IMED/);
  assert.match(await card.textContent(), /correção oficial do cadastro \(CNES\) é feita pelo próprio estabelecimento/);
  assert.ok(await page.locator('#rpForm').isHidden(), 'formulário fechado até tocar no botão');
  assert.ok(await page.locator('#rpOk').isHidden(), 'sem a caixa verde vazia do agradecimento antes de enviar');
  await page.click('[data-act="report"]');
  assert.equal(await page.getAttribute('[data-act="report"]', 'aria-expanded'), 'true');
  assert.deepEqual(await page.$$eval('#rpForm input[name="tipo"]', (els) => els.map((e) => e.value)), ['telefone', 'fechado', 'endereco', 'exame', 'outro']);
  assert.equal(await page.locator('#rpForm input[type="email"], #rpForm input[type="tel"], #rpForm input[autocomplete="name"]').count(), 0, 'sem dados pessoais');
  await page.click('#rpBtn');
  assert.match(await page.textContent('#e-kind'), /Escolha o que está errado/);
  assert.equal(log.rpc.filter((c) => c.fn === 'report_place_issue').length, 0);
  await page.check('#rpForm input[value="telefone"]');
  await page.fill('#rpNote', '  O número   não atende <b>nunca</b> ');
  await page.click('#rpBtn');
  await page.waitForSelector('#rpOk:not([hidden])');
  assert.match(await page.textContent('#rpOk'), /Obrigado! A equipe do IMED vai conferir\./);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'rpOk', 'foco no agradecimento');
  assert.ok(await page.locator('#rpForm').isHidden());
  assert.equal(await page.locator('[data-act="report"]').count(), 0);
  const calls = log.rpc.filter((c) => c.fn === 'report_place_issue');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { p_cnes: '2077485', p_clinic: null, p_kind: 'telefone', p_note: 'O número não atende <b>nunca</b>' });
  assert.deepEqual(errors, []);
  await context.close();
  // Falha de rede e limite do banco (muitos avisos novos de todo mundo): o aviso NÃO foi gravado, então mostra o
  // motivo e deixa tentar de novo, sem agradecer como se tivesse chegado.
  let reply = 'error';
  const b = await newPage(browser, { report: (r) => (reply === 'error' ? r.abort() : json(r, reply)) });
  await b.page.goto(`${BASE}local.html?id=${PARTNER_ID}`);
  await b.page.waitForSelector('#lcName');
  assert.match(await b.page.textContent('#avisar'), /informados pela própria clínica/);
  await b.page.click('[data-act="report"]');
  await b.page.check('#rpForm input[value="exame"]');
  await b.page.click('#rpBtn');
  await b.page.waitForSelector('#rpErr.show');
  assert.match(await b.page.textContent('#rpErr'), /Não foi possível enviar agora/);
  assert.match(await b.page.textContent('#rpBtn'), /Tentar de novo/);
  reply = 'limite';
  await b.page.click('#rpBtn');
  await b.page.waitForFunction(() => /Chegaram muitos avisos ao mesmo tempo/.test(document.querySelector('#rpErr')?.textContent || ''));
  assert.ok(await b.page.locator('#rpOk').isHidden(), 'não agradece: o aviso não foi gravado');
  assert.match(await b.page.textContent('#rpBtn'), /Tentar de novo/);
  reply = 'ok';
  await b.page.click('#rpBtn');
  await b.page.waitForSelector('#rpOk:not([hidden])');
  assert.match(await b.page.textContent('#rpOk'), /Obrigado! A equipe do IMED vai conferir\./);
  assert.deepEqual(b.log.rpc.filter((c) => c.fn === 'report_place_issue').at(-1).body, { p_cnes: null, p_clinic: PARTNER_ID, p_kind: 'exame', p_note: null });
  assert.deepEqual(b.errors, []);
  await b.context.close();
});

await scenario('parceiro: "Verificado pelo IMED em dd/mm/aaaa" (data real da conferência) e link para o que conferimos', async () => {
  const { page, errors, context } = await newPage(browser, { tz: 'Asia/Tokyo' });
  await page.goto(`${BASE}local.html?id=${PARTNER_ID}`);
  await page.waitForSelector('#lcName');
  assert.match(await page.textContent('.lc-head .lc-verified'), /Verificado pelo IMED em 30\/09\/2026 · o que conferimos/);
  assert.equal(await page.getAttribute('.lc-head .lc-verified a', 'href'), 'como-funciona.html#selo');
  assert.match(await page.textContent('.lc-rest .note'), /Parceiro verificado do IMED.*Código CNES 7654321/s);
  assert.equal(await page.getAttribute('.lc-rest .note a', 'href'), 'como-funciona.html#selo');
  // Parceiro sem data de conferência: nenhuma data aparece (nada inventado).
  await page.goto(`${BASE}local.html?id=${NOSCHED_ID}`);
  await page.waitForSelector('#lcName');
  assert.equal(await page.locator('.lc-verified').count(), 0);
  assert.ok(!/Código CNES/.test(await page.textContent('.lc-rest .note')), 'sem CNES, sem código');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedido para outra pessoa: nome, parentesco e a autorização (do responsável, se menor; da própria pessoa, se adulta)', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}local.html?cnes=2077485`);
  await page.waitForSelector('#agendar [data-act="pedido"]');
  await page.click('#agendar [data-act="pedido"]');
  assert.ok(await page.isChecked('input[name="para"][value="mim"]'), '"Mim" vem marcado');
  assert.ok(await page.locator('[data-other]').isHidden(), 'campos de outra pessoa escondidos');
  assert.equal(await page.textContent('label[for="bkName"]'), 'Seu nome completo');
  await page.selectOption('#bkExam', 'rx');
  await page.fill('#bkDate', await page.$eval('#bkDate', (el) => el.min));
  await fillPerson(page);
  await page.click('label:has(> input[name="para"][value="outra"])');
  assert.ok(await page.locator('[data-other]').isVisible());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'bkOtherName', 'foco no nome de quem vai fazer o exame');
  assert.ok(await page.locator('[data-guardian]').isHidden(), 'autorização só para menor');
  await page.click('#bkBtn');
  assert.match(await page.textContent('#e-otherName'), /nome de quem vai fazer o exame/);
  assert.match(await page.textContent('#e-relationship'), /parentesco/);
  assert.equal(log.insert.length, 0);
  await page.fill('#bkOtherName', '  Pedro   Teste ');
  await page.selectOption('#bkRel', 'Filho ou filha');
  // Maior de idade (padrão): o exame é dado de saúde DELA; quem pede confirma que ela sabe e concordou.
  assert.ok(await page.locator('[data-adult]').isVisible(), 'adulto: aparece a confirmação de que a pessoa concordou');
  assert.match(await page.textContent('[data-adult]'), /Essa pessoa sabe deste pedido e concordou.*representante legal dela/s);
  await page.click('#bkBtn');
  assert.match(await page.textContent('#e-otherConsent'), /Confirme que essa pessoa sabe do pedido e concordou/);
  assert.equal(log.insert.length, 0, 'sem a confirmação, nada é enviado');
  await page.check('input[name="menor"]');
  assert.ok(await page.locator('[data-adult]').isHidden(), 'menor: a confirmação do adulto some');
  assert.ok(await page.locator('[data-guardian]').isVisible(), 'menor de 18: aparece a autorização do responsável');
  assert.match(await page.textContent('[data-guardian]'), /Sou o pai, a mãe ou o responsável legal.*LGPD, art\. 14/s);
  await page.click('#bkBtn');
  assert.match(await page.textContent('#e-guardian'), /Para menor de 18 anos, marque a autorização/);
  assert.ok(await page.locator('[data-f="guardian"].bad').count(), 'caixa marcada em vermelho');
  assert.equal(log.insert.length, 0, 'sem a autorização, nada é enviado');
  await page.check('input[name="responsavel"]');
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  assert.match(await page.textContent('.lc-ok'), /Para Pedro Teste \(Filho ou filha\)/);
  const row = log.insert[0].body;
  assert.equal(row.patient_name, 'Ana Teste', 'quem pede continua sendo o contato');
  assert.equal(row.for_other, true);
  assert.equal(row.other_name, 'Pedro Teste');
  assert.equal(row.relationship, 'Filho ou filha');
  assert.equal(row.other_minor, true);
  assert.equal(row.guardian_consent, true);
  assert.equal(row.other_consent, false);
  assert.deepEqual(errors, []);
  await context.close();
  // Adulto (pai idoso): só vai com a confirmação de que ele sabe do pedido e concordou.
  const ad = await newPage(browser);
  await ad.page.goto(`${BASE}local.html?cnes=2077485`);
  await ad.page.click('#agendar [data-act="pedido"]');
  await ad.page.selectOption('#bkExam', 'rx');
  await ad.page.fill('#bkDate', await ad.page.$eval('#bkDate', (el) => el.min));
  await fillPerson(ad.page);
  await ad.page.click('label:has(> input[name="para"][value="outra"])');
  await ad.page.fill('#bkOtherName', 'José Teste');
  await ad.page.selectOption('#bkRel', 'Pai ou mãe');
  await ad.page.check('input[name="concorda"]');
  await ad.page.click('#bkBtn');
  await ad.page.waitForSelector('.lc-ok');
  const ra = ad.log.insert[0].body;
  assert.deepEqual([ra.for_other, ra.other_minor, ra.other_consent, ra.guardian_consent], [true, false, true, false]);
  assert.deepEqual(ad.errors, []);
  await ad.context.close();
  // Pedido para si: nenhuma coluna nova vai para o banco (funciona mesmo antes da migração).
  const me = await newPage(browser);
  await me.page.goto(`${BASE}local.html?cnes=2077485`);
  await me.page.click('#agendar [data-act="pedido"]');
  await me.page.selectOption('#bkExam', 'rx');
  await me.page.fill('#bkDate', await me.page.$eval('#bkDate', (el) => el.min));
  await fillPerson(me.page);
  await me.page.click('label:has(> input[name="para"][value="outra"])');
  await me.page.fill('#bkOtherName', 'Alguém');
  await me.page.click('label:has(> input[name="para"][value="mim"])');
  assert.ok(await me.page.locator('[data-other]').isHidden());
  await me.page.click('#bkBtn');
  await me.page.waitForSelector('.lc-ok');
  const r2 = me.log.insert[0].body;
  for (const k of ['for_other', 'other_name', 'relationship', 'other_minor', 'guardian_consent', 'other_consent']) assert.ok(!(k in r2), `sem ${k}`);
  assert.deepEqual(me.errors, []);
  await me.context.close();
});

await scenario('celular (390px): ficha e agenda sem rolagem lateral', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(`${BASE}local.html?cnes=2077485`);
  await page.waitForSelector('#avaliacoes:not([hidden]) li');
  assert.ok(await overflow(page) <= 0, `sem rolagem lateral (${await overflow(page)}px)`);
  await page.click('[data-act="report"]');
  assert.ok(await overflow(page) <= 0, `"Algo errado aqui?" aberto sem rolagem lateral (${await overflow(page)}px)`);
  await page.click('#agendar [data-act="pedido"]');
  await page.click('label:has(> input[name="para"][value="outra"])');
  await page.check('input[name="menor"]');
  assert.ok(await overflow(page) <= 0, `pedido para outra pessoa sem rolagem lateral (${await overflow(page)}px)`);
  await shot(page, 'l05-celular-cnes');
  await page.goto(`${BASE}local.html?id=${PARTNER_ID}`);
  await page.waitForSelector('.sl-t');
  assert.ok(await overflow(page) <= 0, `sem rolagem lateral (${await overflow(page)}px)`);
  const book = await page.$eval('#agendar', (el) => el.getBoundingClientRect().top);
  const exams = await page.$eval('#exames', (el) => el.getBoundingClientRect().top);
  assert.ok(book < exams, 'no celular, a agenda vem logo depois do topo');
  await shot(page, 'l06-celular-horarios');
  await page.click('.sl-t >> nth=0');
  await fillPerson(page);
  assert.ok(await overflow(page) <= 0);
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  assert.ok(await overflow(page) <= 0);
  await shot(page, 'l07-celular-confirmado');
  assert.deepEqual(errors, []);
  await context.close();
});

/* ======================= "Antes de ir: o que perguntar ao ligar" (quem não é parceiro) ======================= */
const COPY_OK = () => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } } });
// Nenhuma forma de copiar funciona: a área de transferência nega e o jeito antigo (execCommand) também falha.
const COPY_DENY = () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new DOMException('negado', 'NotAllowedError')) } });
  document.execCommand = () => false;
};
// Navegador sem a área de transferência (antigo ou de dentro de aplicativo): só o jeito antigo funciona. Guarda o
// comando e o texto que estava selecionado na hora.
const COPY_OLD = () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  document.execCommand = (cmd) => {
    const t = document.activeElement;
    window.__exec = { cmd, text: t?.value?.slice(t.selectionStart, t.selectionEnd) ?? '' };
    return cmd === 'copy';
  };
};
const questions = (page) => page.$$eval('.cq-list li', (els) => els.map((e) => e.textContent));
const SUS_IMED = /Se preferir, peça ao IMED para agendar por você \(particular ou convênio\)\. Pelo SUS, o agendamento começa no posto de saúde \(UBS\)\./;

await scenario('antes de ir: perguntas ao ligar no cadastro oficial (fechada até o toque, exame da busca, Copiar) e nada no parceiro', async () => {
  const { page, errors, context } = await newPage(browser, { initScript: COPY_OK });
  await page.goto(`${BASE}local.html?cnes=2077485&exame=rm`);
  await page.waitForSelector('#lcName');
  const box = page.locator('.lc-head details.cq');
  assert.equal(await box.count(), 1, 'uma caixa, no topo da ficha');
  assert.equal(await box.getAttribute('open'), null, 'fechada até o toque');
  assert.equal(await page.locator('.cq-list').isVisible(), false);
  assert.equal((await page.textContent('.cq summary')).trim(), 'Antes de ir: o que perguntar ao ligar');
  // Ligar e Compartilhar continuam só nas ações do local (sem repetir dentro da caixa).
  assert.equal(await page.locator('.lc-head a:has-text("Ligar")').count(), 1);
  assert.equal(await page.locator('[data-act="share"]').count(), 1);
  assert.equal(await page.locator('.cq a[href^="tel:"], .cq [data-act="share"]').count(), 0);
  await page.click('.cq summary');
  assert.equal(await box.getAttribute('open'), '');
  const qs = await questions(page);
  assert.equal(qs[0], 'Vocês fazem ressonância magnética?', 'exame da busca (?exame=rm), sempre a primeira pergunta');
  assert.ok(qs.includes('Precisa agendar ou é por ordem de chegada?'));
  assert.ok(qs.includes('Precisa de jejum ou de outro preparo para a ressonância magnética?'));
  assert.ok(qs.includes('Atendem pelo SUS? Precisa de encaminhamento do posto de saúde?'), 'o cadastro oficial diz que atende SUS');
  assert.ok(qs.includes('Quanto custa a ressonância magnética no particular?'));
  assert.ok(qs.includes('Que documentos preciso levar? Precisa do pedido médico?'));
  const text = await page.textContent('.cq');
  assert.ok(!/R\$|\d{1,2}:\d{2}/.test(text), 'só perguntas: sem preço nem horário');
  assert.match(text, /não sabemos o preparo que ele pede, o prazo do resultado nem o preço\. Ligue antes de ir, com o pedido médico em mãos, e pergunte:/);
  // Atende SUS: o pedido pelo IMED é particular ou convênio, e o SUS começa no posto de saúde.
  assert.match(text, /siga também a orientação do seu médico\. Se preferir, peça ao IMED para agendar por você \(particular ou convênio\)\./);
  assert.match(text, SUS_IMED);
  await page.click('[data-act="copy-questions"]');
  await page.waitForFunction(() => document.querySelector('.cq-msg').textContent);
  assert.equal(await page.textContent('.cq-msg'), 'Perguntas copiadas. É só colar onde quiser.');
  const copied = (await page.evaluate(() => window.__copied)).split('\n');
  assert.deepEqual(copied.slice(0, 3), ['Hospital Santa Exemplo · (11) 3141-1000', 'O que perguntar ao ligar:', '1. Vocês fazem ressonância magnética?']);
  assert.equal(copied.length, 2 + qs.length, 'todas as perguntas, numeradas');
  assert.equal(await page.locator('.cq-txt').isVisible(), false, 'copiou: o quadro de seleção não aparece');
  await shot(page, 'l08-perguntas-ao-ligar');
  // Teclado: Enter no título fecha e abre a caixa.
  await page.focus('.cq summary');
  await page.keyboard.press('Enter');
  assert.equal(await box.getAttribute('open'), null);
  await page.keyboard.press('Enter');
  assert.equal(await box.getAttribute('open'), '');
  // O pedido ao IMED já vem com o exame da busca.
  await page.click('#agendar [data-act="pedido"]');
  assert.equal(await page.inputValue('#bkExam'), 'rm');
  // Parceiro: preço, exames e agenda vêm da própria clínica; sem roteiro de perguntas.
  await page.goto(`${BASE}local.html?id=${PARTNER_ID}&exame=rm`);
  await page.waitForSelector('.sl-t');
  assert.equal(await page.locator('.cq').count(), 0, 'parceiro com agenda');
  await page.goto(`${BASE}local.html?id=${NOSCHED_ID}`);
  await page.waitForSelector('#agendar [data-act="pedido"]');
  assert.equal(await page.locator('.cq').count(), 0, 'parceiro sem agenda');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('antes de ir: laboratório sem telefone (o que perguntar na recepção) e sem dado do SUS; sem copiar sozinho, o aviso vem antes do texto selecionado', async () => {
  const { page, errors, context } = await newPage(browser, { initScript: COPY_DENY });
  await page.goto(`${BASE}local.html?cnes=6543210&exame=xyz`);
  await page.waitForSelector('#lcName');
  assert.equal(await page.locator('.lc-acts a:has-text("Ligar")').count(), 0, 'sem telefone, sem Ligar');
  assert.equal((await page.textContent('.cq summary')).trim(), 'O que perguntar na recepção', 'sem telefone, o título não fala em ligar');
  await page.click('.cq summary');
  const qs = await questions(page);
  assert.equal(qs[0], 'Vocês fazem todos os exames do meu pedido médico?', 'exame desconhecido na URL: vale o tipo do local');
  assert.ok(qs.includes('Precisa de jejum? De quantas horas?'), 'laboratório: jejum');
  assert.ok(qs.includes('Em quantos dias sai o resultado?'), 'laboratório: prazo');
  assert.ok(qs.includes('Fazem coleta em casa?'));
  assert.ok(!qs.some((q) => /SUS/.test(q)), 'sem o dado do SUS, sem a pergunta');
  const text = await page.textContent('.cq');
  assert.match(text, /O telefone deste local não foi informado\. Se for até lá, leve o pedido médico e pergunte na recepção:/);
  assert.ok(!/ao ligar|Ligue/.test(text), 'nada de ligar');
  assert.equal((await page.textContent('.cq-imed')).trim(), 'Se preferir, peça ao IMED para agendar por você.', 'o pedido ao IMED em destaque');
  assert.ok(await page.isVisible('.cq-imed'));
  await page.click('[data-act="copy-questions"]');
  await page.waitForSelector('.cq-txt:not([hidden])');
  assert.match(await page.textContent('.cq-msg'), /^Não foi possível copiar sozinho\. As perguntas estão selecionadas no quadro abaixo/);
  const sel = await page.evaluate(() => {
    const t = document.querySelector('.cq-txt'), m = document.querySelector('.cq-msg');
    return {
      focused: document.activeElement === t, start: t.selectionStart, end: t.selectionEnd, len: t.value.length, lines: t.value.split('\n'),
      warn: m.classList.contains('warn'), msgFirst: !!(m.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING), describedBy: t.getAttribute('aria-describedby') === m.id && !!m.id,
    };
  });
  assert.ok(sel.focused, 'o foco vai para o texto');
  assert.deepEqual([sel.start, sel.end], [0, sel.len], 'o texto todo fica selecionado');
  assert.ok(sel.warn && sel.msgFirst, 'o aviso vem antes do quadro');
  assert.ok(sel.describedBy, 'o quadro aponta para o aviso (leitor de tela)');
  assert.deepEqual(sel.lines.slice(0, 3), ['Laboratório Sem Mapa', 'O que perguntar na recepção:', '1. Vocês fazem todos os exames do meu pedido médico?']);
  assert.equal(sel.lines.length, 2 + qs.length);
  await shot(page, 'l09-perguntas-selecionar');
  // Navegador sem a área de transferência (antigo ou de dentro de aplicativo): copia pelo jeito antigo, sem o quadro.
  await context.addInitScript(COPY_OLD);
  await page.goto(`${BASE}local.html?cnes=2077485`);
  await page.click('.cq summary');
  await page.click('[data-act="copy-questions"]');
  await page.waitForFunction(() => document.querySelector('.cq-msg').textContent);
  assert.equal(await page.textContent('.cq-msg'), 'Perguntas copiadas. É só colar onde quiser.');
  const old = await page.evaluate(() => ({ exec: window.__exec, hidden: document.querySelector('.cq-txt').hidden, value: document.querySelector('.cq-txt').value, act: document.activeElement?.dataset?.act, warn: document.querySelector('.cq-msg').classList.contains('warn') }));
  assert.equal(old.exec?.cmd, 'copy');
  assert.equal(old.exec.text, old.value, 'copiou o texto todo');
  assert.match(old.exec.text, /^Hospital Santa Exemplo · \(11\) 3141-1000\nO que perguntar ao ligar:\n1\. Vocês fazem o exame ou a consulta de que eu preciso\?/);
  assert.ok(old.hidden && !old.warn, 'copiou: o quadro não aparece');
  assert.equal(old.act, 'copy-questions', 'o foco volta para o botão');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (360px): sem copiar sozinho, o aviso e o texto selecionado aparecem na tela, sem rolagem lateral', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, viewport: { width: 360, height: 780 }, initScript: COPY_DENY });
  await page.goto(`${BASE}local.html?cnes=2077485&exame=rm`);
  await page.waitForSelector('#avaliacoes:not([hidden]) li');
  await page.click('.cq summary');
  assert.match(await page.textContent('.cq'), SUS_IMED, 'atende SUS: o pedido pelo IMED é particular ou convênio');
  await page.click('[data-act="copy-questions"]');
  await page.waitForSelector('.cq-txt:not([hidden])');
  const m = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const t = document.querySelector('.cq-txt');
    // Fim do que dá para ver: a tela ou, no primeiro acesso, o aviso de privacidade fixo embaixo.
    const end = Math.min(innerHeight, document.querySelector('.lgpd')?.getBoundingClientRect().top ?? innerHeight);
    return { top: r('.pt-top').bottom, end, msg: r('.cq-msg'), txt: r('.cq-txt'), focused: document.activeElement === t, sel: [t.selectionStart, t.selectionEnd, t.value.length] };
  });
  assert.ok(m.msg.top >= m.top && m.msg.bottom <= m.end, `o aviso aparece inteiro (${Math.round(m.msg.top)} a ${Math.round(m.msg.bottom)} px; dá para ver de ${Math.round(m.top)} a ${Math.round(m.end)} px)`);
  assert.ok(m.txt.top > m.msg.bottom && m.txt.top <= m.end - 60, `o quadro começa logo abaixo, na tela (${Math.round(m.txt.top)} px)`);
  assert.ok(m.focused && m.sel[0] === 0 && m.sel[1] === m.sel[2], 'o texto continua todo selecionado');
  assert.ok(await overflow(page) <= 0, `sem rolagem lateral (${await overflow(page)}px)`);
  await shot(page, 'l11-celular-360-sem-copiar');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (390px): caixa de perguntas aberta sem rolagem lateral e com alvos de toque grandes', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(`${BASE}local.html?cnes=2077485&exame=usg`);
  await page.waitForSelector('#avaliacoes:not([hidden]) li');
  const summary = await page.$eval('.cq summary', (el) => el.getBoundingClientRect().height);
  assert.ok(summary >= 44, `título da caixa com ${summary}px de altura`);
  await page.click('.cq summary');
  assert.equal((await questions(page))[0], 'Vocês fazem ultrassom?');
  const btn = await page.$eval('[data-act="copy-questions"]', (el) => el.getBoundingClientRect().height);
  assert.ok(btn >= 44, `"Copiar as perguntas" com ${btn}px de altura`);
  assert.ok(await overflow(page) <= 0, `sem rolagem lateral (${await overflow(page)}px)`);
  // A caixa fica logo abaixo das ações do local, antes do aviso de emergência.
  assert.ok(await page.evaluate(() => {
    const acts = document.querySelector('.lc-head .lc-acts'), cq = document.querySelector('.lc-head .cq'), sos = document.querySelector('.lc-head .sos');
    return acts.nextElementSibling === cq && cq.nextElementSibling === sos;
  }), 'ordem: ações, perguntas, emergência');
  await shot(page, 'l10-celular-perguntas');
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
