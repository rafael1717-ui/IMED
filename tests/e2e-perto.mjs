// Teste de ponta a ponta da página "Clínicas perto de você" num navegador de verdade (Playwright),
// com localização simulada e respostas simuladas do servidor, do banco e do OpenStreetMap.
// Rodar com: node tests/e2e-perto.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta node tests/e2e-perto.mjs  salva capturas de tela nessa pasta.
//           ONLY="texto" node tests/e2e-perto.mjs  roda só os cenários com esse texto no nome.
//           E2E_PORT=8790 node tests/e2e-perto.mjs  usa outra porta (padrão 8765), para rodar em paralelo.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, PUBLISHABLE, vigiarChaves } from './regra-chaves.mjs';
import { createHash } from 'node:crypto';
import * as G from '../assets/js/geo-core.js';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null; // ex.: ONLY="área inteira" roda só esses cenários
const FN = 'https://pyoqiecupxhdzigjudyd.supabase.co/functions/v1/clinicas-proximas';
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
const PORT = Number(process.env.E2E_PORT) || 8765; // E2E_PORT: outra porta para rodar em paralelo
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;

// Três clínicas IMED de demonstração (sem preço e sem horário) e estabelecimentos do OpenStreetMap.
const IMED_ROWS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'DiagnoCenter Paulista', kind: 'imagem', description: null, address_line: 'Endereço de demonstração · Bela Vista', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: null, lat: -23.5614, lng: -46.6559, distance_m: 563, phone: null, whatsapp: null, email: null, website: null, specialties: ['Radiologia'], opening_hours: null, accepts_online_booking: true, is_demo: true, exams: [{ code: 'rm', price_cents: null }, { code: 'rx', price_cents: null }, { code: 'tc', price_cents: null }], insurances: [], cnes: null },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Ecocor Cardiologia', kind: 'clinica', description: null, address_line: 'Endereço de demonstração · Jardins', neighborhood: 'Jardins', city: 'São Paulo', state: 'SP', cep: null, lat: -23.57, lng: -46.662, distance_m: 1161, phone: null, whatsapp: null, email: null, website: null, specialties: ['Cardiologia'], opening_hours: null, accepts_online_booking: true, is_demo: true, exams: [{ code: 'ecg', price_cents: null }, { code: 'eco', price_cents: null }], insurances: [], cnes: null },
];
const OSM = { elements: [
  { type: 'node', id: 101, lat: -23.5617, lon: -46.6561, tags: { name: 'DiagnoCenter Paulista', healthcare: 'radiology' } },
  { type: 'node', id: 102, lat: -23.5590, lon: -46.6600, tags: { name: 'Laboratório Vida', healthcare: 'laboratory', phone: '+55 11 3333-4444', opening_hours: 'Mo-Fr 06:00-18:00', 'addr:street': 'Rua Augusta', 'addr:housenumber': '900' } },
  { type: 'way', id: 103, center: { lat: -23.5700, lon: -46.6450 }, tags: { name: 'Hospital Central', amenity: 'hospital', website: 'hospitalcentral.com.br' } },
  { type: 'node', id: 104, lat: -23.5620, lon: -46.6530, tags: { name: 'Clínica Odontológica Sorriso', amenity: 'clinic' } },
  { type: 'node', id: 105, lat: -23.5660, lon: -46.6580, tags: { name: 'Centro de Ressonância e Tomografia Paulista', healthcare: 'clinic', 'contact:whatsapp': '(11) 98888-7777' } },
] };

// Parceiros verificados (não são demonstração), com preços e convênios informados pela clínica.
const PARTNER_ROWS = [
  { id: 'bbbbbbbb-0000-4000-8000-000000000011', name: 'Imagem Paulista Verificada', kind: 'imagem', description: 'Centro de imagem.', address_line: 'Av. Paulista, 1500', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: '01310-200', lat: -23.5625, lng: -46.6565, distance_m: 300, phone: '(11) 3222-1000', whatsapp: null, email: null, website: null, specialties: ['Radiologia'], opening_hours: { seg: '07:00–19:00' }, accepts_online_booking: true, is_demo: false, exams: [{ code: 'rm', price_cents: 45000 }, { code: 'tc', price_cents: 30000 }, { code: 'rx', price_cents: null }], insurances: ['Bradesco Saúde', 'SulAmérica'], cnes: '7654321' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000012', name: 'Clínica Jardins Verificada', kind: 'clinica', description: null, address_line: 'Rua Oscar Freire, 100', neighborhood: 'Jardins', city: 'São Paulo', state: 'SP', cep: null, lat: -23.5672, lng: -46.6650, distance_m: 1100, phone: null, whatsapp: null, email: null, website: null, specialties: ['Cardiologia'], opening_hours: null, accepts_online_booking: true, is_demo: false, exams: [{ code: 'rm', price_cents: 89990 }, { code: 'ecg', price_cents: null }], insurances: ['Amil'], cnes: null },
];
const RATINGS = { 'cnes:2077485': { rating: 4.6, reviews: 12 }, 'imed:bbbbbbbb-0000-4000-8000-000000000011': { rating: 4, reviews: 3 } };
const REVIEWS = { 'cnes:2077485': [
  { rating: 5, comment: '<b>Ótimo</b> atendimento, rápido.', author_name: 'Maria', created_at: '2026-10-20T13:00:00Z' },
  { rating: 4, comment: null, author_name: 'João', created_at: '2026-10-02T13:00:00Z' },
] };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } });
const PREFLIGHT = { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } };

// Distância em metros (igual à do site), para o banco simulado ordenar e filtrar pela área.
const hav = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// Banco simulado: estabelecimentos da área com os filtros de nearby_establishments / establishment_points,
// em ordem de distância (desempate pelo código), com o total da área em cada linha.
function areaRows(rows, b) {
  const o = { lat: b.p_lat, lng: b.p_lng };
  return rows.map((x) => ({ x, d: hav(o, x) }))
    .filter(({ x, d }) => d <= (b.p_radius_m ?? 5000) && (!b.p_kind || x.kind === b.p_kind)
      && (!b.p_exam || (x.services ?? []).includes(b.p_exam)) && (b.p_sus == null || x.sus === b.p_sus))
    .sort((a, c) => a.d - c.d || a.x.cnes.localeCompare(c.x.cnes));
}
const pageOf = (list, from, n) => list.slice(from, from + n).map(({ x, d }) => ({ ...x, distance_m: Math.round(d), total: list.length }));
const pointsOf = (list, n) => list.slice(0, n).map(({ x }) => ({ cnes: x.cnes, kind: x.kind, lat: x.lat, lng: x.lng, total: list.length }));

// Estabelecimentos reais do CNES, como vêm da função nearby_establishments.
const CNES_ROWS = [
  { cnes: '2077485', name: 'Hospital Santa Exemplo', kind: 'hospital', cnes_type: 5, address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', cep: '01409001', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5598, lng: -46.6602, distance_m: 420, location_source: 'cnes', phone: '(11) 3141-1000', shift: null, open_24h: true, sus: false, services: ['rm', 'tc', 'rx'], specialties: ['Cardiologia'], cnes_updated_at: '2026-09-15' },
  { cnes: '6543210', name: 'Laboratório Análise Paulista', kind: 'laboratorio', cnes_type: 39, address_line: 'Alameda Santos, 200', neighborhood: 'Bela Vista', cep: '01418000', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5655, lng: -46.6520, distance_m: 640, location_source: 'endereco', phone: '(11) 3000-2000', shift: 'Manhã e tarde', open_24h: false, sus: true, services: ['lab'], specialties: [], cnes_updated_at: '2026-08-02' },
];

// data: estabelecimentos do banco simulado. Sem data, o banco tem os mesmos que a última busca devolveu.
// viewport: outro tamanho de tela (o celular é 390×844).
async function newPage(browser, { geo = true, mobile = false, viewport, fn, rpc, overpass, insert, cnesRpc, points, ratings, reviews, scheduled = [], rest, data } = {}) {
  const context = await browser.newContext({
    viewport: viewport ?? (mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 }),
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block',
    ...(geo ? { geolocation: { latitude: -23.561234, longitude: -46.656789, accuracy: 30 }, permissions: ['geolocation'] } : {}),
  });
  const log = { fn: [], overpass: [], rpc: [], insert: [], cnes: [], points: [], ratings: [], reviews: [], schedule: [], nextFree: [], rest: [], track: [] };
  let lastSearch = null;
  const dataset = () => data ?? (Array.isArray(lastSearch?.cnes) ? lastSearch.cnes : []);
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await context.route(FN, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const body = JSON.parse(route.request().postData() || '{}');
    log.fn.push(body);
    // Guarda a resposta da busca: o banco simulado passa a ter os mesmos estabelecimentos.
    const spy = {
      request: () => route.request(),
      abort: (...a) => route.abort(...a),
      fulfill: (o) => { if (body.action === 'search') { try { lastSearch = JSON.parse(o.body); } catch { lastSearch = null; } } return route.fulfill(o); },
    };
    return (fn ?? defaultFn)(spy, body);
  });
  await context.route('https://overpass-api.de/**', async (route) => { log.overpass.push(route.request().postData()); return (overpass ?? ((r) => json(r, OSM)))(route); });
  await context.route('https://overpass.kumi.systems/**', async (route) => { log.overpass.push(route.request().postData()); return (overpass ?? ((r) => json(r, OSM)))(route); });
  await context.route(`${REST}rpc/nearby_clinics`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    log.rpc.push(JSON.parse(route.request().postData() || '{}'));
    return (rpc ?? ((r) => json(r, IMED_ROWS)))(route);
  });
  await context.route(`${REST}rpc/nearby_establishments`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill(PREFLIGHT);
    const body = JSON.parse(route.request().postData() || '{}');
    log.cnes.push(body);
    if (cnesRpc) return cnesRpc(route, body, dataset());
    return json(route, pageOf(areaRows(dataset(), body), body.p_offset ?? 0, body.p_limit ?? 150));
  });
  await context.route((u) => u.href.startsWith(`${REST}rpc/establishment_points`), async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill(PREFLIGHT);
    const body = JSON.parse(route.request().postData() || '{}');
    log.points.push({ body, search: new URL(route.request().url()).search });
    if (points) return points(route, body, dataset());
    return json(route, pointsOf(areaRows(dataset(), body), body.p_limit ?? 3000));
  });
  await context.route(`${REST}rpc/place_ratings`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const body = JSON.parse(route.request().postData() || '{}');
    log.ratings.push(body);
    if (ratings) return ratings(route, body);
    return json(route, body.p_keys.filter((k) => RATINGS[k]).map((k) => ({ place_key: k, ...RATINGS[k] })));
  });
  await context.route(`${REST}rpc/place_reviews`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const body = JSON.parse(route.request().postData() || '{}');
    log.reviews.push(body);
    if (reviews) return reviews(route, body);
    return json(route, (REVIEWS[body.p_key] ?? []).slice(0, body.p_limit));
  });
  await context.route(`${REST}rpc/clinics_with_schedule`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const body = JSON.parse(route.request().postData() || '{}');
    log.schedule.push(body);
    return json(route, body.p_ids.filter((id) => scheduled.includes(id)).map((id) => ({ clinic_id: id })));
  });
  // "Próximo horário livre" (iMed Agenda 5.1): só os parceiros com agenda online têm; amanhã às 09:00 em São Paulo.
  await context.route(`${REST}rpc/agenda_next_free`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const body = JSON.parse(route.request().postData() || '{}');
    log.nextFree.push(body);
    const ini = new Date(`${G.spDate(1)}T09:00:00-03:00`);
    // a clínica faz raio-x, mas não vende raio-x com horário pelo site: nada para esse exame
    if (body.p_exam === 'rx') return json(route, []);
    return json(route, body.p_clinics.filter((id) => scheduled.includes(id)).map((id) => ({ clinic_id: id, procedure_id: 'dddddddd-0000-4000-8000-0000000000a1',
      exam_code: body.p_exam ?? 'rm', slot_start: ini.toISOString(), slot_end: new Date(ini.getTime() + 1800000).toISOString(), timezone: 'America/Sao_Paulo', agenda_mode: 'nativa' })));
  });
  await context.route((u) => u.href.startsWith(`${REST}establishments`) || u.href.startsWith(`${REST}clinics`), async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const u = new URL(route.request().url());
    log.rest.push(u.pathname.split('/').pop() + u.search);
    return rest ? rest(route, u) : json(route, []);
  });
  // Contador de visitas próprio (assets/js/visitas.js): só manda com ?visitas=teste neste computador de testes.
  await context.route(`${REST}rpc/track`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill(PREFLIGHT);
    log.track.push({ body: JSON.parse(route.request().postData() || '{}'), headers: route.request().headers() });
    return json(route, true);
  });
  await context.route(`${REST}appointment_requests`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    log.insert.push({ body: JSON.parse(route.request().postData()), headers: route.request().headers() });
    return (insert ?? ((r) => r.fulfill({ status: 201, body: '', headers: { 'Access-Control-Allow-Origin': '*' } })))(route);
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, log, errors };
}

function defaultFn(route, body) {
  if (body.action === 'search') return json(route, { ok: true, provider: 'osm', radius_m: body.radius_m, warnings: [], imed: body.include_demo ? IMED_ROWS : [], places: [] });
  if (body.action === 'geocode') {
    if (/99999/.test(body.q)) return json(route, { ok: false, error: 'not_found' }, 404);
    return json(route, { ok: true, lat: -23.5617698, lng: -46.6553299, label: 'Avenida Paulista, Bela Vista, São Paulo - SP', precision: 'cep', provider: 'osm' });
  }
  return json(route, { ok: true, provider: 'osm' });
}

// Busca com parceiros verificados e estabelecimentos do CNES (cidade já no banco).
const fullFn = (r, b) => (b.action === 'search'
  ? json(r, { ok: true, provider: 'osm', radius_m: b.radius_m, warnings: [], imed: PARTNER_ROWS, cnes: CNES_ROWS, places: [], coverage: { status: 'done', city: 'São Paulo', uf: 'SP' } })
  : defaultFn(r, b));
const names = (page) => page.$$eval('.pc h3', (els) => els.map((e) => e.textContent));
// O que o leitor de tela ouve no cartão: o nome (botão do título, que abre a ficha) e a descrição dele
// (aria-describedby: distância, selos, nota, preço e "Ver detalhes").
const cardSpeech = (page, sel) => page.$eval(`${sel} .pc-open`, (b) => `${b.textContent}, ${document.getElementById(b.getAttribute('aria-describedby'))?.textContent ?? ''}`);
const ready = async (page) => { await page.waitForSelector('.pc'); await page.waitForFunction(() => !document.querySelector('.pt-more')); };
// Pinos no mapa (sem contar o "Você está aqui"). sel: '.mk-imed' só parceiros, '.mk:not(.mk-imed)' os outros.
const pins = (page, sel = '.mk') => page.locator(`.leaflet-marker-icon ${sel}`).count();
const zoomOf = async (page) => Number(await page.getAttribute('#map', 'data-zoom'));
// Aproxima o mapa pelo botão "+" até o zoom pedido (a partir de 15 o mapa está "perto").
async function zoomIn(page, target) {
  for (let z = await zoomOf(page); z < target; z += 1) {
    await page.click('.leaflet-control-zoom-in');
    await page.waitForSelector(`#map[data-zoom="${z + 1}"]`, { state: 'attached' });
  }
  await page.waitForTimeout(350); // fim da animação
}
// O que aparece no centro do ponto "Você está aqui" é o próprio ponto (nenhum pino por cima)?
const meOnTop = (page) => page.evaluate(() => {
  const me = document.querySelector('.leaflet-marker-icon .me');
  const r = me.getBoundingClientRect();
  return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.me') === me;
});
const focusIsMore = (page) => page.evaluate(() => !!document.activeElement?.matches('#list .pt-pager [data-act="more"]'));
const fillBooking = async (page, exam = 'rm') => {
  await page.selectOption('#bkExam', exam);
  await page.fill('#bkDate', await page.$eval('#bkDate', (el) => el.min));
  await page.check('input[name="periodo"][value="manha"]', { force: true });
  await page.fill('#bkName', 'Ana Teste');
  await page.fill('#bkPhone', '11987654321');
  await page.check('input[name="consent"]');
};
const WA_CONFIG = () => {
  let cfg;
  Object.defineProperty(window, 'IMED_CONFIG', { configurable: true, get: () => cfg, set: (v) => { cfg = { ...v, whatsapp: '+55 (11) 99999-8888' }; } });
};

const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(450); await page.screenshot({ path: join(SHOTS, `${name}.png`) }); } };
const results = [];
// Tempo máximo de cada cenário (E2E_CENARIO_S segundos, padrão 150): um cenário travado falha com o nome dele,
// em vez de segurar o arquivo inteiro até o limite do CI.
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try { await Promise.race([comChaves(fn), limite(name)]); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 4).join('\n  ')}`); }
}

const browser = vigiarChaves(await chromium.launch());

await scenario('localização permitida: parceiros IMED do banco + mapa, sem guardar coordenadas', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.waitForSelector('.pc');
  await page.waitForFunction(() => !document.querySelector('.pt-more'));
  assert.equal(new URL(page.url()).search, '?demo=1', 'o parâmetro usar=localizacao sai da URL');
  const search = log.fn.find((b) => b.action === 'search');
  assert.deepEqual([search.lat, search.lng], [-23.561, -46.657], 'manda só coordenadas arredondadas (~110 m)');
  assert.equal(search.include_demo, true);
  assert.equal(log.overpass.length, 1);
  assert.ok(!log.overpass[0].includes('-23.561234'), 'o OpenStreetMap não recebe a posição precisa');
  const names = await page.$$eval('.pc h3', (els) => els.map((e) => e.textContent));
  assert.ok(names.includes('DiagnoCenter Paulista') && names.includes('Laboratório Vida') && names.includes('Hospital Central'));
  assert.equal(names.filter((n) => n === 'DiagnoCenter Paulista').length, 1, 'não repete parceiro que também está no mapa');
  assert.ok(!names.some((n) => /Odonto/.test(n)), 'dentistas ficam de fora');
  const dists = await page.$$eval('.pc .pc-dist', (els) => els.map((e) => e.textContent));
  assert.match(dists[0], /m$/);
  assert.match(await page.textContent('#count'), /resultados em até 5 km da sua localização/);
  assert.equal(await page.locator('.leaflet-marker-icon .mk').count(), names.length, 'um marcador por resultado');
  assert.match(await page.locator('.pc.imed').first().textContent(), /Preço sob consulta/, 'sem preço inventado');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  assert.ok(!/-23\.56|-46\.65/.test(stored), 'nenhuma coordenada guardada no aparelho');
  await shot(page, '01-resultados-desktop');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('confiança: emergência no topo, "Meus pedidos" no menu, legenda dos selos e rodapé na coluna da lista', async () => {
  for (const mobile of [false, true]) {
    const { page, errors, context } = await newPage(browser, { mobile });
    await page.goto(`${BASE}perto.html`);
    assert.match(await page.textContent('.pt-hero .pt-sos'), /Emergência\? Ligue 192 \(SAMU\)/);
    assert.equal(await page.getAttribute('.pt-hero .pt-sos a', 'href'), 'tel:192');
    assert.equal(await page.locator('.pt-nav a[href="./#agenda"]').textContent(), 'Meus pedidos');
    assert.ok(!/Agendados/.test(await page.evaluate(() => document.body.innerText)));
    const legend = await page.evaluate(() => document.querySelector('#legend').textContent);
    assert.match(legend, /sem vínculo com o governo ou o SUS/);
    assert.match(legend, /ninguém paga para aparecer primeiro/);
    assert.match(legend, /O selo não avalia a qualidade do atendimento/);
    assert.equal(await page.locator('#legend a[href="como-funciona.html"]').count(), 1);
    assert.equal(await page.locator('.pt-side > footer.rodape').count(), 1, 'rodapé no fim da coluna da lista');
    assert.match(await page.textContent('footer.rodape'), /Médico responsável: Dr\. Rafael Pereira Barreto Silva — CRM-SP 266930/);
    await page.locator('footer.rodape').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('footer.rodape .rd-base').isVisible());
    if (mobile) {
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(o <= 0, `sem rolagem lateral (${o}px)`);
      // O botão "Ver mapa" (fixo embaixo) não cobre o fim do rodapé.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const [base, toggle] = await Promise.all([page.locator('.rd-base p').last().boundingBox(), page.locator('#viewToggle').boundingBox()]);
      assert.ok(!toggle || base.y + base.height <= toggle.y, '"© 2026 IMED" acima do botão "Ver mapa"');
    }
    await shot(page, `00-confianca-${mobile ? 'celular' : 'desktop'}`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('filtros de exame, tipo, especialidade, distância e preço', async () => {
  const { page, log, context } = await newPage(browser);
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.waitForSelector('.pc');
  await page.waitForFunction(() => !document.querySelector('.pt-more'));
  const names = () => page.$$eval('.pc h3', (els) => els.map((e) => e.textContent));
  await page.selectOption('#fExam', 'rm');
  assert.deepEqual((await names()).sort(), ['Centro de Ressonância e Tomografia Paulista', 'DiagnoCenter Paulista']);
  await page.selectOption('#fExam', '');
  await page.selectOption('#fKind', 'laboratorio');
  assert.deepEqual(await names(), ['Laboratório Vida']);
  await page.selectOption('#fKind', '');
  await page.selectOption('#fSpec', 'Cardiologia');
  assert.deepEqual(await names(), ['Ecocor Cardiologia']);
  await page.click('#fClear');
  await page.click('#fImed');
  assert.deepEqual((await names()).sort(), ['DiagnoCenter Paulista', 'Ecocor Cardiologia']);
  await page.click('#fImed');
  // Nenhuma clínica de demonstração informa preço: sem filtro de preço e sem "Menor preço" (sempre dariam vazio).
  assert.ok(await page.locator('#fPriceWrap').isHidden(), 'sem preço informado, o filtro de preço não aparece');
  assert.equal(await page.$eval('#fSort option[value="price"]', (o) => o.hidden && o.disabled), true, 'nem a ordem "Menor preço"');
  await page.selectOption('#fDist', '1000');
  assert.ok((await names()).length < 5, 'raio menor filtra sem nova busca');
  const before = log.fn.length;
  await page.selectOption('#fDist', '10000');
  await page.waitForFunction((n) => document.querySelectorAll('.pc').length > 0 && !document.querySelector('.pt-more'), before);
  assert.equal(log.fn.length, before + 1, 'raio maior busca de novo');
  assert.equal(log.fn.at(-1).radius_m, 10000);
  await context.close();
});

await scenario('detalhes e pedido de agendamento gravado no banco', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.click('.pc.imed >> nth=0');
  await page.waitForSelector('.sh-ov.open');
  const sheet = await page.textContent('#sheet');
  assert.match(sheet, /Preço sob consulta/);
  assert.match(sheet, /Horário não informado/);
  assert.match(sheet, /Clínica de demonstração/);
  assert.equal(await page.getAttribute('#sheet .sos a', 'href'), 'tel:192', 'ficha com o aviso de emergência');
  await shot(page, '02-detalhes');
  await page.click('[data-book]');
  await page.waitForSelector('#bookForm');
  // Formulário: emergência no começo; gratuito (contra golpes) e privacidade perto de "Enviar pedido".
  assert.match(await page.textContent('#bookForm .sos'), /O pedido não é para emergência\. Emergência\? Ligue 192 \(SAMU\)/);
  assert.match(await page.textContent('#bookForm .trust .free'), /O IMED é gratuito para você\. Se houver cobrança pelo exame, o pagamento é feito direto no local\. O IMED nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp\./);
  assert.match(await page.textContent('#bookForm .trust .priv'), /Seus dados vão só para o IMED e para o local escolhido · ficam em servidor no Brasil · sem anúncios e sem rastreadores de anúncio · sua localização é aproximada e não é gravada\./);
  assert.ok(await page.evaluate(() => document.querySelector('#bookForm .trust').nextElementSibling.contains(document.querySelector('#bkBtn'))), 'faixa logo antes do botão de enviar');
  await page.click('#bkBtn');
  assert.ok(await page.locator('[data-f="exam"].bad').count(), 'exige o exame');
  assert.ok(await page.locator('[data-f="consent"].bad').count(), 'exige o consentimento');
  assert.equal(log.insert.length, 0);
  await page.selectOption('#bkExam', 'rm');
  const date = await page.$eval('#bkDate', (el) => el.min);
  await page.fill('#bkDate', date);
  await page.check('input[name="periodo"][value="manha"]', { force: true });
  await page.fill('#bkName', 'Ana Teste');
  await page.type('#bkPhone', '11987654321');
  assert.equal(await page.inputValue('#bkPhone'), '(11) 98765-4321');
  await page.check('input[name="consent"]');
  await shot(page, '03-formulario');
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  assert.match(await page.textContent('.ok .trust .free'), /O IMED é gratuito para você.*nunca pede Pix/s, 'pedido enviado: aviso contra o golpe do falso agendamento');
  assert.equal(log.insert.length, 1);
  const row = log.insert[0].body;
  assert.equal(row.clinic_id, IMED_ROWS[0].id);
  assert.equal(row.place_source, 'imed');
  assert.equal(row.exam_code, 'rm');
  assert.equal(row.preferred_period, 'manha');
  assert.equal(row.patient_phone, '11987654321');
  assert.equal(row.consent, true);
  assert.ok(!('status' in row) && !('lat' in row) && !('lng' in row), 'sem status e sem localização do paciente');
  assert.ok(!('for_other' in row) && !('other_name' in row) && !('guardian_consent' in row) && !('other_consent' in row), 'exame para a própria pessoa: sem os campos de outra pessoa');
  assert.match(log.insert[0].headers.prefer, /return=minimal/);
  assert.match(await page.textContent('.ok .code'), /^IMED-[0-9A-F]{8}$/);
  assert.match(row.review_token_hash, /^[0-9a-f]{64}$/, 'manda só o resumo (SHA-256) do código do pedido');
  assert.equal(log.insert[0].headers.apikey, PUBLISHABLE, 'sem conta, usa a chave publishable');
  assert.equal(log.insert[0].headers.authorization, undefined, 'sem conta, sem Authorization (a chave não vai em Bearer)');
  assert.equal(await page.evaluate(() => window.IMED_CONFIG.supabaseKey), PUBLISHABLE);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(saved[0].type, 'pedido');
  assert.equal(saved[0].status, 'pendente');
  assert.equal(saved[0].id, row.id);
  assert.match(saved[0].token, /^[0-9a-f]{64}$/);
  assert.equal(createHash('sha256').update(saved[0].token).digest('hex'), row.review_token_hash, 'o código guardado bate com o resumo enviado');
  assert.equal(saved[0].code, await page.textContent('.ok .code'));
  assert.equal(saved[0].place_key, `imed:${IMED_ROWS[0].id}`);
  assert.equal(saved[0].name, 'DiagnoCenter Paulista');
  assert.equal(saved[0].exam, 'rm');
  assert.deepEqual(saved[0].items, ['Ressonância']);
  assert.equal(saved[0].date, date);
  assert.equal(saved[0].period, 'manha');
  assert.ok(!Number.isNaN(Date.parse(saved[0].created)));
  assert.ok(!JSON.stringify(saved).includes(row.review_token_hash), 'o resumo não precisa ficar no aparelho');
  assert.ok(await page.isVisible('.ok a[href="conta.html"]'), 'oferece criar conta para acompanhar');
  assert.ok(await page.isVisible('.ok a[href="./#agenda"]'));
  await shot(page, '04-pedido-enviado');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-ics]')]);
  assert.match(download.suggestedFilename(), /^imed-[0-9a-f]{8}\.ics$/);
  const ics = (await readFile(await download.path(), 'utf8'));
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.trimEnd().endsWith('END:VCALENDAR'));
  assert.match(unfolded, new RegExp(`DTSTART;TZID=America/Sao_Paulo:${date.replace(/-/g, '')}T080000`));
  assert.match(unfolded, /SUMMARY:Exame: Ressonância — DiagnoCenter Paulista \(a confirmar\)\r\n/, 'pedido sem confirmação: "(a confirmar)" no lembrete');
  assert.match(unfolded, /STATUS:TENTATIVE/);
  assert.match(unfolded, /DESCRIPTION:.*Retire objetos de metal.*Confirme o horário com o IMED.*exames\/ressonancia-magnetica\.html#preparo/);
  assert.match(unfolded, /BEGIN:VALARM\r\n.*TRIGGER:-P1D/s);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedido para outra pessoa pela busca: nome, parentesco e a autorização (do responsável, se menor; da própria pessoa, se adulta)', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.click('.pc.imed >> nth=0');
  await page.waitForSelector('.sh-ov.open');
  await page.click('[data-book]');
  await page.waitForSelector('#bookForm');
  assert.equal(await page.isChecked('input[name="para"][value="mim"]'), true, 'começa em "Mim"');
  assert.ok(await page.locator('#bkOtherName').isHidden());
  await fillBooking(page);
  await page.click('label:has(> input[name="para"][value="outra"])');
  assert.ok(await page.locator('#bkOtherName').isVisible());
  assert.ok(await page.locator('[data-guardian]').isHidden(), 'autorização só para menor');
  await page.click('#bkBtn');
  assert.ok(await page.locator('[data-f="otherName"].bad').count(), 'exige o nome de quem faz o exame');
  assert.ok(await page.locator('[data-f="relationship"].bad').count(), 'exige o parentesco');
  assert.equal(log.insert.length, 0);
  await page.fill('#bkOtherName', '  Pedro   Teste ');
  await page.selectOption('#bkRel', 'Filho ou filha');
  // Maior de idade (padrão): só vai com a confirmação de que a pessoa sabe do pedido e concordou.
  assert.ok(await page.locator('[data-adult]').isVisible());
  await page.click('#bkBtn');
  assert.match(await page.textContent('#e-otherConsent'), /Confirme que essa pessoa sabe do pedido/);
  assert.equal(log.insert.length, 0, 'adulto sem a confirmação não envia');
  await page.click('label:has(> input[name="menor"])');
  assert.ok(await page.locator('[data-adult]').isHidden());
  assert.ok(await page.locator('[data-guardian]').isVisible());
  await page.click('#bkBtn');
  assert.match(await page.textContent('#e-guardian'), /responsável/);
  assert.equal(log.insert.length, 0, 'menor sem autorização do responsável não envia');
  await page.click('label:has(> input[name="responsavel"])');
  await shot(page, '41-pedido-outra-pessoa');
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  const row = log.insert[0].body;
  assert.equal(row.patient_name, 'Ana Teste', 'quem pede continua sendo o contato');
  assert.equal(row.for_other, true);
  assert.equal(row.other_name, 'Pedro Teste');
  assert.equal(row.relationship, 'Filho ou filha');
  assert.equal(row.other_minor, true);
  assert.equal(row.guardian_consent, true);
  assert.equal(row.other_consent, false);
  assert.match(await page.textContent('.ok'), /Para Pedro Teste \(Filho ou filha\)/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedido com conta: grava pelo login e não oferece criar conta', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await context.addInitScript(() => localStorage.setItem('imed_session', JSON.stringify({ access_token: 'tok-paciente', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'ana@exemplo.com' } })));
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.click('.pc.imed >> nth=0');
  await page.click('[data-book]');
  await fillBooking(page);
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  assert.equal(log.insert.length, 1);
  assert.equal(log.insert[0].headers.authorization, 'Bearer tok-paciente', 'com conta: o token da pessoa em Bearer');
  assert.equal(log.insert[0].headers.apikey, PUBLISHABLE, 'e a chave publishable no apikey');
  assert.match(log.insert[0].body.review_token_hash, /^[0-9a-f]{64}$/);
  assert.equal(await page.locator('.ok a[href="conta.html"]').count(), 0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(saved[0].id, log.insert[0].body.id);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('sessão vencida que não renova: pedido vai sem conta e oferece criar conta', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await context.addInitScript(() => localStorage.setItem('imed_session', JSON.stringify({ access_token: 'tok-velho', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) - 3600, user: { id: 'u1', email: 'ana@exemplo.com' } })));
  await context.route('**/auth/v1/token**', (r) => (r.request().method() === 'OPTIONS'
    ? r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
    : r.fulfill({ status: 400, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"invalid_grant"}' })));
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.click('.pc.imed >> nth=0');
  await page.click('[data-book]');
  await fillBooking(page, 'consulta');
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  assert.equal(log.insert.length, 1);
  assert.notEqual(log.insert[0].headers.authorization, 'Bearer tok-velho', 'não usa o token vencido');
  assert.equal(log.insert[0].headers.authorization, undefined, 'vai como visitante: sem Authorization');
  assert.equal(log.insert[0].headers.apikey, PUBLISHABLE);
  assert.equal(await page.locator('.ok a[href="conta.html"]').count(), 1, 'oferece criar conta');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(saved[0].exam, 'consulta', 'guarda o código da consulta para o preparo nas outras páginas');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('estabelecimento do mapa: pedido ao IMED (concierge) com contato do local', async () => {
  const { page, log, context } = await newPage(browser);
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.click('.pc:has-text("Laboratório Vida")');
  const sheet = await page.textContent('#sheet');
  assert.match(sheet, /seg–sex 06:00–18:00/);
  assert.match(sheet, /Fonte: OpenStreetMap/);
  assert.equal(await page.getAttribute('.dt-acts a[href^="tel:"]', 'href'), 'tel:+551133334444');
  await page.click('[data-book]');
  await page.selectOption('#bkExam', 'lab');
  await page.fill('#bkDate', await page.$eval('#bkDate', (el) => el.min));
  await page.fill('#bkName', 'Carlos Teste');
  await page.fill('#bkPhone', '1133334444');
  await page.check('input[name="consent"]');
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  const row = log.insert[0].body;
  assert.equal(row.clinic_id, null);
  assert.equal(row.place_source, 'osm');
  assert.equal(row.place_ref, 'osm:n102');
  assert.equal(row.place_phone, '+55 11 3333-4444');
  await context.close();
});

await scenario('falha ao enviar o pedido mostra erro e permite tentar de novo', async () => {
  const { page, context } = await newPage(browser, { insert: (r) => r.fulfill({ status: 503, body: '', headers: { 'Access-Control-Allow-Origin': '*' } }) });
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.click('.pc.imed >> nth=0');
  await page.click('[data-book]');
  await page.selectOption('#bkExam', 'rx');
  await page.fill('#bkDate', await page.$eval('#bkDate', (el) => el.min));
  await page.fill('#bkName', 'Ana Teste');
  await page.fill('#bkPhone', '11987654321');
  await page.check('input[name="consent"]');
  await page.click('#bkBtn');
  await page.waitForSelector('.bk-err.show');
  assert.match(await page.textContent('.bk-err'), /Não foi possível enviar agora/);
  assert.match(await page.textContent('#bkBtn'), /Tentar de novo/);
  await context.close();
});

await scenario('localização negada: explica e permite buscar por CEP', async () => {
  const { page, log, context } = await newPage(browser, { geo: false });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('.st h2:has-text("não liberou")');
  await shot(page, '05-localizacao-negada');
  await page.fill('#q', '01310-100');
  await page.press('#q', 'Enter');
  await page.waitForSelector('.pc');
  assert.equal(log.fn[0].action, 'geocode');
  assert.equal(log.fn[0].q, '01310-100');
  assert.deepEqual([log.fn[1].lat, log.fn[1].lng], [-23.562, -46.655], 'endereço também é arredondado');
  assert.match(await page.textContent('#count'), /Avenida Paulista, Bela Vista/);
  await page.fill('#q', '99999-999');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#qMsg:not([hidden])');
  assert.match(await page.textContent('#qMsg'), /Não encontramos esse endereço/);
  await page.fill('#q', '0131');
  await page.press('#q', 'Enter');
  assert.match(await page.textContent('#qMsg'), /O CEP tem 8 números/);
  await context.close();
});

await scenario('sem pedir permissão ao abrir a página direto', async () => {
  const { page, context } = await newPage(browser, { geo: false });
  await page.goto(`${BASE}perto.html`);
  await page.waitForSelector('.st h2:has-text("Veja o que tem perto de você")');
  const intro = await page.textContent('.st');
  assert.doesNotMatch(intro, /100 metros|100 m\b/, 'sem dar a impressão de que a busca é de 100 metros');
  assert.match(intro, /Usada só para esta busca, de forma aproximada — nunca guardamos sua posição exata\./);
  assert.match(intro, /Mostramos clínicas, laboratórios e hospitais em até 5 km; você pode aumentar para até 50 km\./);
  assert.doesNotMatch(await page.textContent('body'), /100 metros/);
  await shot(page, '06-inicio');
  await context.close();
});

await scenario('servidor fora do ar: usa o banco direto e o mapa continua', async () => {
  const { page, log, context } = await newPage(browser, { fn: (r) => json(r, { ok: false, error: 'internal' }, 500) });
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.waitForSelector('.pc.imed');
  await page.waitForFunction(() => !document.querySelector('.pt-more'));
  assert.equal(log.rpc.length, 1);
  assert.equal(log.rpc[0].p_include_demo, true);
  assert.equal(log.rpc[0].p_lat, -23.561);
  assert.ok(await page.locator('.pc:not(.imed)').count() > 0, 'estabelecimentos do mapa também aparecem');
  await context.close();
});

await scenario('mapa fora do ar: aviso e só parceiros IMED', async () => {
  const { page, context } = await newPage(browser, { overpass: (r) => r.fulfill({ status: 504, body: 'erro' }) });
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.waitForSelector('.bn.warn');
  assert.match(await page.textContent('#banners'), /não carregaram agora/);
  assert.equal(await page.locator('.pc').count(), 2);
  await context.close();
});

await scenario('tudo fora do ar: estado de erro com "Tentar de novo"', async () => {
  let fail = true;
  const { page, context } = await newPage(browser, {
    fn: (r, b) => (fail ? json(r, { ok: false, error: 'unavailable' }, 502) : defaultFn(r, b)),
    rpc: (r) => (fail ? r.fulfill({ status: 503, body: '' }) : json(r, IMED_ROWS)),
    overpass: (r) => (fail ? r.fulfill({ status: 504, body: '' }) : json(r, OSM)),
    cnesRpc: (r) => (fail ? r.fulfill({ status: 503, body: '' }) : json(r, [])),
  });
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.waitForSelector('.st h2:has-text("Não foi possível buscar agora")');
  await shot(page, '07-erro');
  fail = false;
  await page.click('[data-act="retry"]');
  await page.waitForSelector('.pc');
  await context.close();
});

await scenario('com Google Places no servidor, o site não chama o OpenStreetMap', async () => {
  const google = [{ id: 'google:abc', source: 'google', name: 'Lumen Diagnóstico por Imagem', types: ['doctor'], hint: 'imagem', address: 'Rua X, 10 - São Paulo', lat: -23.562, lng: -46.657, distance_m: 100, phone: '(11) 2222-3333', website: 'https://lumen.example', maps_url: 'https://maps.google.com/?cid=1', hours: ['segunda-feira: 07:00–19:00'] }];
  const { page, log, context } = await newPage(browser, { fn: (r, b) => (b.action === 'search' ? json(r, { ok: true, provider: 'google', radius_m: 5000, warnings: [], imed: [], places: google }) : defaultFn(r, b)) });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('.pc');
  assert.equal(log.overpass.length, 0);
  assert.match(await page.textContent('.pc'), /Google Maps/);
  await page.click('.pc');
  assert.match(await page.textContent('#sheet'), /Fonte: Google Maps/);
  await context.close();
});

await scenario('celular: lista, mapa em tela cheia e detalhes pelo marcador', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await page.waitForSelector('.pc');
  await page.waitForFunction(() => !document.querySelector('.pt-more'));
  await shot(page, '08-celular-lista');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `sem rolagem lateral (${overflow}px)`);
  await page.click('#viewToggle');
  await page.waitForTimeout(400);
  assert.ok(await page.isVisible('#map'));
  await shot(page, '09-celular-mapa');
  await page.click('.leaflet-marker-icon .mk-imed >> nth=0', { force: true });
  await page.waitForSelector('.sh-ov.open');
  await shot(page, '10-celular-detalhes');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('clínicas reais do CNES: sem OpenStreetMap, selo oficial, ficha e pedido', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: (r, b) => (b.action === 'search'
    ? json(r, { ok: true, provider: 'osm', radius_m: 5000, warnings: [], imed: [], cnes: CNES_ROWS, places: [], coverage: { status: 'done', city: 'São Paulo', uf: 'SP' } })
    : defaultFn(r, b)) });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('.pc');
  await page.waitForFunction(() => !document.querySelector('.pt-more'));
  assert.equal(log.overpass.length, 0, 'com a cidade coberta pelo CNES, não precisa do OpenStreetMap');
  const names = await page.$$eval('.pc h3', (els) => els.map((e) => e.textContent));
  assert.deepEqual(names, ['Hospital Santa Exemplo', 'Laboratório Análise Paulista']);
  assert.match(await page.textContent('.pc >> nth=0'), /Cadastro oficial/);
  assert.match(await page.textContent('.pc >> nth=0'), /24 horas/);
  assert.match(await page.textContent('.pc >> nth=1'), /Atende SUS/);
  assert.match(await page.textContent('.pc >> nth=1 >> .pc-dist'), /^~/, 'distância aproximada quando o local veio do endereço');
  // Cada resultado aparece no mapa: afastado (área inteira) como ponto; perto, como pino.
  await page.waitForSelector('#map[data-points="2"]');
  assert.ok(await zoomOf(page) < 15);
  assert.equal(await pins(page), 0);
  assert.equal(await page.getAttribute('#map', 'data-points-drawn'), '2');
  await zoomIn(page, 15);
  assert.equal(await pins(page), 2);
  assert.equal(await page.getAttribute('#map', 'data-points-drawn'), '0', 'sem ponto embaixo do pino');
  await shot(page, '14-cnes-resultados');
  await page.click('.pc >> nth=0');
  await page.waitForSelector('.sh-ov.open');
  const sheet = await page.textContent('#sheet');
  assert.match(sheet, /Aberto 24 horas/);
  assert.match(sheet, /CNES/);
  assert.equal(await page.getAttribute('#sheet a[href*="cnes.datasus.gov.br"]', 'href'), 'https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/3550302077485');
  assert.ok(!/R\$/.test(sheet), 'sem preço inventado');
  assert.match(sheet, /O IMED é um serviço privado, sem vínculo com o governo ou o SUS/, 'fonte oficial sem parecer coisa do governo');
  await shot(page, '15-cnes-detalhes');
  await page.click('[data-book]');
  await page.selectOption('#bkExam', 'rm');
  await page.fill('#bkDate', await page.$eval('#bkDate', (el) => el.min));
  await page.fill('#bkName', 'Bia Teste');
  await page.fill('#bkPhone', '11987654321');
  await page.check('input[name="consent"]');
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  const row = log.insert[0].body;
  assert.equal(row.clinic_id, null);
  assert.equal(row.place_source, 'cnes');
  assert.equal(row.place_ref, 'cnes:2077485');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('cidade ainda sendo importada: aviso, mapa provisório e atualização sozinha', async () => {
  let calls = 0;
  const { page, log, context } = await newPage(browser, { fn: (r, b) => {
    if (b.action !== 'search') return defaultFn(r, b);
    calls += 1;
    return calls === 1
      ? json(r, { ok: true, provider: 'osm', radius_m: 5000, warnings: [], imed: [], cnes: [], places: [], coverage: { status: 'loading', city: 'Campinas', uf: 'SP' } })
      : json(r, { ok: true, provider: 'osm', radius_m: 5000, warnings: [], imed: [], cnes: CNES_ROWS, places: [], coverage: { status: 'done', city: 'Campinas', uf: 'SP' } });
  } });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('.bn .spin');
  assert.match(await page.textContent('#banners'), /Campinas/);
  assert.equal(log.overpass.length, 1, 'enquanto importa, mostra o OpenStreetMap');
  await page.waitForSelector('.pc:has-text("Hospital Santa Exemplo")', { timeout: 15000 });
  assert.equal(calls, 2);
  assert.equal(await page.locator('.bn .spin').count(), 0);
  await context.close();
});


await scenario('selos: parceiro verificado, cadastro oficial, demonstração e legenda', async () => {
  const { page, errors, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  assert.deepEqual(await names(page), ['Imagem Paulista Verificada', 'Hospital Santa Exemplo', 'Laboratório Análise Paulista', 'Clínica Jardins Verificada']);
  const card = (n) => page.textContent(`.pc:has-text("${n}")`);
  assert.match(await card('Imagem Paulista Verificada'), /Parceiro verificado/);
  assert.match(await card('Hospital Santa Exemplo'), /Cadastro oficial/);
  assert.doesNotMatch(await card('Hospital Santa Exemplo'), /verificado/);
  assert.match(await page.textContent('#count'), /2 parceiros verificados/);
  assert.match(await page.textContent('#fImed'), /Parceiros verificados/);
  assert.ok(await page.isVisible('#legend summary'));
  assert.ok(!(await page.isVisible('#legend ul')), 'legenda fechada por padrão');
  await page.click('#legend summary');
  const legend = await page.textContent('#legend');
  assert.match(legend, /Parceiro verificado.*conferiu que quem cuida da página responde pelo local.*informados pela própria clínica.*não avalia a qualidade do atendimento/s);
  assert.match(legend, /Cadastro oficial.*Ministério da Saúde.*sem vínculo com o governo ou o SUS/s);
  await shot(page, '16-selos-legenda');
  await page.click('#fImed');
  assert.deepEqual((await names(page)).sort(), ['Clínica Jardins Verificada', 'Imagem Paulista Verificada']);
  assert.deepEqual(errors, []);
  await context.close();
  // Demonstração continua com o próprio selo, sem "verificado".
  const demo = await newPage(browser);
  await demo.page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await ready(demo.page);
  const t = await demo.page.textContent('.pc.imed >> nth=0');
  assert.match(t, /Demonstração/);
  assert.doesNotMatch(t, /verificado/);
  assert.match(await demo.page.textContent('#count'), /2 de demonstração/);
  await demo.context.close();
});

await scenario('filtro "Atende SUS" usa o dado do CNES', async () => {
  const { page, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  await page.click('#fSus');
  assert.equal(await page.getAttribute('#fSus', 'aria-pressed'), 'true');
  assert.deepEqual(await names(page), ['Laboratório Análise Paulista']);
  assert.match(await page.textContent('#list'), /vem do cadastro oficial \(CNES\)/);
  assert.ok(await page.isVisible('#fClear'));
  await page.selectOption('#fExam', 'rm');
  const band = (await page.textContent('#priceBand')).replace(/\s+/g, ' ');
  assert.match(band, /Ressonância perto de você: de R\$ 450 a R\$ 899,90 em 2 clínicas/, 'com SUS ligado, a faixa ainda mostra os preços dos parceiros da região');
  assert.doesNotMatch(band, /Nenhuma clínica informou/);
  await page.selectOption('#fExam', '');
  await page.click('#fSus');
  assert.equal((await names(page)).length, 4);
  await context.close();
});

await scenario('filtro de convênio com as opções dos parceiros encontrados', async () => {
  const { page, errors, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  assert.ok(await page.isVisible('#fIns'));
  assert.deepEqual(await page.$$eval('#fIns option', (o) => o.map((x) => x.value)), ['', 'Amil', 'Bradesco Saúde', 'SulAmérica']);
  await page.selectOption('#fIns', 'Amil');
  assert.deepEqual(await names(page), ['Clínica Jardins Verificada']);
  assert.match(await page.textContent('#list'), /Convênios informados pelas clínicas parceiras/);
  await page.selectOption('#fIns', 'Bradesco Saúde');
  assert.deepEqual(await names(page), ['Imagem Paulista Verificada']);
  await page.click('.pc:has-text("Imagem Paulista Verificada")');
  const sheet = await page.textContent('#sheet');
  assert.match(sheet, /Convênios.*Bradesco Saúde.*SulAmérica.*Convênios informados pela clínica/s);
  await page.keyboard.press('Escape');
  await page.click('#fClear');
  assert.equal(await page.inputValue('#fIns'), '');
  assert.equal((await names(page)).length, 4);
  assert.deepEqual(errors, []);
  await context.close();
  // Sem parceiros com convênio, o filtro não aparece.
  const other = await newPage(browser, { fn: (r, b) => (b.action === 'search' ? json(r, { ok: true, provider: 'osm', radius_m: 5000, warnings: [], imed: [], cnes: CNES_ROWS, places: [], coverage: { status: 'done' } }) : defaultFn(r, b)) });
  await other.page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(other.page);
  assert.ok(!(await other.page.isVisible('#fIns')));
  await other.context.close();
});

await scenario('faixa de preço do exame só com preços informados', async () => {
  const { page, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  assert.equal(await page.textContent('#priceBand'), '', 'sem exame escolhido, sem faixa');
  await page.selectOption('#fExam', 'rm');
  const band = (await page.textContent('#priceBand')).replace(/\s+/g, ' ');
  assert.match(band, /Ressonância perto de você: de R\$ 450 a R\$ 899,90 em 2 clínicas que informaram o preço/);
  await shot(page, '17-faixa-de-preco');
  await page.selectOption('#fExam', 'tc');
  assert.match((await page.textContent('#priceBand')).replace(/\s+/g, ' '), /Tomografia perto de você: R\$ 300 em 1 clínica que informou o preço/);
  await page.selectOption('#fExam', 'ecg');
  assert.match(await page.textContent('#priceBand'), /Nenhuma clínica informou o preço de Eletrocardiograma por aqui ainda\. Os valores aparecem quando as clínicas parceiras informam\./);
  // Faixa de preço sem ninguém: explica que nenhum valor é estimado.
  await page.selectOption('#fExam', '');
  assert.ok(await page.locator('#fPriceWrap').isVisible(), 'com parceiro que informou preço, o filtro aparece');
  await page.selectOption('#fPrice', 'ate100');
  await page.waitForSelector('.st h2');
  assert.match(await page.textContent('.st'), /Nada com esses filtros.*Nenhum valor é estimado/s);
  await page.click('[data-act="clear"]');
  await ready(page);
  await context.close();
});

await scenario('sem parceiro na área: sem "Parceiros verificados", filtro de preço e "Menor preço"; "Clínica fictícia" só no modo de teste', async () => {
  const cnesOnly = (r, b) => (b.action === 'search'
    ? json(r, { ok: true, provider: 'osm', radius_m: b.radius_m, warnings: [], imed: [], cnes: CNES_ROWS, places: [], coverage: { status: 'done', city: 'São Paulo', uf: 'SP' } })
    : defaultFn(r, b));
  const { page, errors, context } = await newPage(browser, { fn: cnesOnly, rpc: (r) => json(r, []) });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  assert.deepEqual(await names(page), ['Hospital Santa Exemplo', 'Laboratório Análise Paulista']);
  assert.ok(await page.locator('#fImed').isHidden(), 'sem parceiro, "Parceiros verificados" sempre daria vazio');
  assert.ok(await page.locator('#fPriceWrap').isHidden(), 'sem parceiro, sem filtro de preço');
  assert.equal(await page.$eval('#fSort option[value="price"]', (o) => o.hidden && o.disabled), true, 'sem "Menor preço"');
  assert.match(await page.textContent('#list'), /Ainda não há clínicas parceiras do IMED nesta região/);
  await page.click('#legend summary');
  assert.ok(await page.locator('#legend ul').isVisible());
  assert.ok(await page.locator('#legDemo').isHidden(), '"Clínica fictícia" fora do modo de teste não aparece');
  assert.doesNotMatch(await page.locator('#legend').innerText(), /fictícia/);
  await shot(page, '40-sem-parceiro');
  assert.deepEqual(errors, []);
  await context.close();
  // Com parceiros que informaram preço: tudo aparece; legenda sem a clínica fictícia.
  const full = await newPage(browser, { fn: fullFn });
  await full.page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(full.page);
  assert.ok(await full.page.locator('#fImed').isVisible());
  assert.ok(await full.page.locator('#fPriceWrap').isVisible());
  assert.equal(await full.page.$eval('#fSort option[value="price"]', (o) => o.hidden || o.disabled), false);
  await full.page.click('#legend summary');
  assert.ok(await full.page.locator('#legDemo').isHidden());
  assert.deepEqual(full.errors, []);
  await full.context.close();
  // Modo de teste (?demo=1): a legenda explica a clínica fictícia; demonstração não tem preço.
  const demo = await newPage(browser);
  await demo.page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await ready(demo.page);
  await demo.page.click('#legend summary');
  assert.ok(await demo.page.locator('#legDemo').isVisible());
  assert.match(await demo.page.textContent('#legDemo'), /Clínica fictícia do modo de teste/);
  assert.ok(await demo.page.locator('#fImed').isVisible());
  assert.ok(await demo.page.locator('#fPriceWrap').isHidden());
  assert.deepEqual(demo.errors, []);
  await demo.context.close();
});

await scenario('notas e avaliações vindas do banco, sem quebrar a busca quando falham', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  await page.waitForSelector('.pc-rate');
  assert.equal(log.ratings.length, 1);
  assert.deepEqual(log.ratings[0].p_keys.sort(), ['cnes:2077485', 'cnes:6543210', `imed:${PARTNER_ROWS[0].id}`, `imed:${PARTNER_ROWS[1].id}`].sort());
  assert.match(await page.textContent('.pc:has-text("Hospital Santa Exemplo") .pc-rate'), /4,6\s*\(12\)/);
  assert.equal(await page.getAttribute('.pc:has-text("Hospital Santa Exemplo") .pc-rate', 'aria-label'), 'Nota 4,6 de 5, 12 avaliações');
  const cardLabel = await cardSpeech(page, '.pc:has-text("Hospital Santa Exemplo")');
  assert.match(cardLabel, /^Hospital Santa Exemplo, .+Cadastro oficial.+Nota 4,6 de 5, 12 avaliações\. Ver detalhes$/, 'leitor de tela ouve selo e nota');
  assert.match(await cardSpeech(page, '.pc:has-text("Imagem Paulista Verificada")'), /Parceiro verificado.*(a partir de R\$|Preço sob consulta)/);
  assert.equal(await page.locator('.pc:has-text("Laboratório Análise Paulista") .pc-rate').count(), 0, 'sem avaliação, sem nota');
  assert.equal(await page.locator('#fSort option[value="rating"]:not([disabled])').count(), 1);
  await page.selectOption('#fSort', 'rating');
  assert.deepEqual((await names(page)).slice(0, 2), ['Hospital Santa Exemplo', 'Imagem Paulista Verificada']);
  await page.click('.pc:has-text("Hospital Santa Exemplo")');
  await page.waitForSelector('#dtReviews:not([hidden]) li');
  assert.equal(log.reviews[0].p_key, 'cnes:2077485');
  assert.equal(log.reviews[0].p_limit, 5);
  const rv = await page.textContent('#dtReviews');
  assert.match(rv, /<b>Ótimo<\/b> atendimento/, 'comentário aparece como texto (HTML escapado)');
  assert.equal(await page.locator('#dtReviews b:has-text("Ótimo")').count(), 0);
  assert.match(rv, /Maria/);
  assert.match(rv, /João/);
  assert.match(await page.textContent('.dt-top'), /4,6/);
  await page.locator('#dtReviews').scrollIntoViewIfNeeded();
  await shot(page, '18-avaliacoes');
  await page.keyboard.press('Escape');
  await page.click('.pc:has-text("Laboratório Análise Paulista")');
  await page.waitForFunction(() => !document.querySelector('#dtReviews'));
  assert.deepEqual(errors, []);
  await context.close();

  const bad = await newPage(browser, { fn: fullFn, ratings: (r) => r.fulfill({ status: 500, body: '' }), reviews: (r) => r.fulfill({ status: 500, body: '' }) });
  await bad.page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(bad.page);
  await bad.page.waitForTimeout(300);
  assert.equal((await names(bad.page)).length, 4);
  assert.equal(await bad.page.locator('.pc-rate').count(), 0);
  assert.equal(await bad.page.locator('#fSort option[value="rating"]:not([disabled])').count(), 0);
  await bad.page.click('.pc >> nth=1');
  await bad.page.waitForFunction(() => !document.querySelector('#dtReviews'));
  assert.ok(await bad.page.isVisible('#sheet h3'));
  assert.deepEqual(bad.errors, []);
  await bad.context.close();
});

await scenario('?exame=rm na URL já escolhe o exame', async () => {
  const { page, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao&exame=rm`);
  await ready(page);
  assert.equal(await page.inputValue('#fExam'), 'rm');
  assert.equal(new URL(page.url()).search, '?exame=rm', 'tira usar=localizacao e mantém o exame');
  assert.deepEqual(await names(page), ['Imagem Paulista Verificada', 'Hospital Santa Exemplo', 'Clínica Jardins Verificada']);
  assert.match(await page.textContent('#priceBand'), /Ressonância perto de você/);
  await context.close();
  const bad = await newPage(browser, { fn: fullFn });
  await bad.page.goto(`${BASE}perto.html?usar=localizacao&exame=xyz`);
  await ready(bad.page);
  assert.equal(await bad.page.inputValue('#fExam'), '', 'código desconhecido é ignorado');
  await bad.context.close();
  for (const key of ['toString', '__proto__', 'constructor']) {
    const proto = await newPage(browser, { fn: fullFn });
    await proto.page.goto(`${BASE}perto.html?usar=localizacao&exame=${key}`);
    await ready(proto.page);
    assert.equal(await proto.page.inputValue('#fExam'), '', `${key} é ignorado`);
    assert.equal((await proto.page.textContent('#priceBand')).trim(), '', 'sem faixa de preço');
    assert.ok((await names(proto.page)).length > 0, 'lista não fica vazia');
    assert.deepEqual(proto.errors, []);
    await proto.context.close();
  }
});

await scenario('contador de visitas (?visitas=teste): a busca conta exame, tipo e cidade (uma vez cada) e o pedido só o exame', async () => {
  const fnSp = (r, b) => (b.action === 'search'
    ? json(r, { ok: true, provider: 'osm', radius_m: 5000, warnings: [], imed: [], cnes: CNES_ROWS, places: [], coverage: { status: 'done', city: 'São Paulo', uf: 'SP' } })
    : defaultFn(r, b));
  // Sem o parâmetro, neste computador de testes nada é contado.
  const off = await newPage(browser, { fn: fnSp });
  await off.page.goto(`${BASE}perto.html?usar=localizacao&exame=rm`);
  await ready(off.page);
  await off.page.waitForTimeout(2500);
  assert.equal(off.log.track.length, 0, 'localhost sem ?visitas=teste: nenhum envio');
  await off.context.close();

  const { page, log, errors, context } = await newPage(browser, { fn: fnSp });
  const wait = async (n) => { for (let i = 0; i < 160 && log.track.length < n; i += 1) await page.waitForTimeout(50); assert.ok(log.track.length >= n, `esperava ${n} envios, chegaram ${log.track.length}`); };
  const events = () => log.track.map((t) => t.body).filter((b) => b.p_event).map((b) => `${b.p_event}:${b.p_detail ?? ''}`);
  await page.goto(`${BASE}perto.html?usar=localizacao&exame=rm&visitas=teste`);
  await ready(page);
  await wait(3);
  assert.deepEqual(log.track.filter((t) => !t.body.p_event).map((t) => t.body), [{ p_path: '/perto.html' }], 'a visita: só o caminho');
  assert.deepEqual(events().sort(), ['busca_cidade:SP/São Paulo', 'busca_exame:rm']);
  // Filtro de tipo: conta o tipo; exame e cidade já contados não contam de novo.
  await page.selectOption('#fKind', 'hospital');
  await wait(4);
  await page.selectOption('#fExam', 'tc');
  await wait(5);
  await page.selectOption('#fExam', 'rm');
  await page.waitForTimeout(600);
  assert.deepEqual(events().sort(), ['busca_cidade:SP/São Paulo', 'busca_exame:rm', 'busca_exame:tc', 'busca_tipo:hospital']);
  assert.equal(log.track.length, 5, 'voltar para um exame já buscado não conta de novo');
  // Pedido: não vai para o contador (a equipe vê o número real, das tabelas do banco).
  await page.click('.pc >> nth=0');
  await page.waitForSelector('.sh-ov.open');
  await page.click('[data-book]');
  await fillBooking(page, 'rm');
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  await page.waitForTimeout(600);
  assert.equal(log.track.length, 5, 'o pedido não soma nada no contador');
  const all = JSON.stringify(log.track.map((t) => t.body));
  assert.ok(!/Ana Teste|98765|2077485|Hospital|-23\.|-46\./.test(all), 'nenhum dado da pessoa, do local ou da posição');
  for (const t of log.track) {
    assert.deepEqual(Object.keys(t.body).filter((k) => !['p_path', 'p_event', 'p_detail'].includes(k)), []);
    assert.equal(t.headers.apikey, PUBLISHABLE, 'contador: só a chave publishable');
    assert.equal(t.headers.authorization, undefined, 'contador: sem Authorization');
    assert.equal(t.headers.referer, undefined);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('WhatsApp do IMED: escondido sem número, visível quando configurado', async () => {
  const { page, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  await page.click('.pc:has-text("Hospital Santa Exemplo")');
  await page.waitForSelector('.sh-ov.open');
  assert.equal(await page.locator('.wa-imed').count(), 0);
  assert.equal(await page.locator('#sheet a[href*="wa.me"]').count(), 0);
  await context.close();

  const on = await newPage(browser, { fn: fullFn });
  await on.context.addInitScript(WA_CONFIG);
  await on.page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(on.page);
  await on.page.click('.pc:has-text("Hospital Santa Exemplo")');
  await on.page.waitForSelector('.sh-ov.open');
  const a = on.page.locator('.wa-imed');
  assert.match(await a.textContent(), /Falar com o IMED no WhatsApp/);
  const href = await a.getAttribute('href');
  assert.ok(href.startsWith('https://wa.me/5511999998888?text='), href);
  assert.match(decodeURIComponent(href.split('text=')[1]), /Hospital Santa Exemplo/);
  await shot(on.page, '19-whatsapp-imed');
  assert.deepEqual(on.errors, []);
  await on.context.close();
});

await scenario('local do CNES: link "Assuma o cadastro" para o responsável', async () => {
  const { page, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  await page.click('.pc:has-text("Hospital Santa Exemplo")');
  const link = page.locator('#sheet a:has-text("Assuma o cadastro")');
  assert.match(await link.textContent(), /É o responsável por este local\? Assuma o cadastro/);
  assert.equal(await link.getAttribute('href'), 'reivindicar.html?cnes=2077485');
  await page.keyboard.press('Escape');
  await page.click('.pc:has-text("Imagem Paulista Verificada")');
  assert.equal(await page.locator('#sheet a:has-text("Assuma o cadastro")').count(), 0, 'parceiro já tem cadastro');
  await context.close();
});

await scenario('celular (390px): selos, filtros, faixa de preço e detalhes sem rolagem lateral', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, fn: fullFn });
  await context.addInitScript(WA_CONFIG);
  await page.goto(`${BASE}perto.html?usar=localizacao&exame=rm`);
  await ready(page);
  await page.waitForSelector('.pc-rate');
  await page.click('#legend summary');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `sem rolagem lateral (${overflow}px)`);
  await shot(page, '20-celular-faixa-selos');
  await page.click('.pc:has-text("Hospital Santa Exemplo")');
  await page.waitForSelector('#dtReviews:not([hidden]) li');
  await page.locator('.dt-claim').scrollIntoViewIfNeeded();
  await shot(page, '21-celular-detalhes-avaliacoes');
  await page.keyboard.press('Escape');
  await page.click('.pc:has-text("Imagem Paulista Verificada")');
  await page.click('[data-book]');
  await fillBooking(page);
  await page.click('#bkBtn');
  await page.waitForSelector('.ok h3');
  await shot(page, '22-celular-pedido-enviado');
  const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(ov2 <= 0, `sem rolagem lateral (${ov2}px)`);
  assert.deepEqual(errors, []);
  await context.close();
});

const PARTNER_ID = PARTNER_ROWS[0].id;
await scenario('parceiro com agenda online: selo honesto, "próximo horário livre" no cartão e botão "Ver horários e agendar"', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: fullFn, scheduled: [PARTNER_ID] });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  await page.waitForSelector('.pc.imed .bd-agenda');
  assert.deepEqual(log.schedule[0].p_ids.sort(), PARTNER_ROWS.map((r) => r.id).sort(), 'pergunta só pelos parceiros exibidos');
  const card = page.locator(`.pc[data-id="imed:${PARTNER_ID}"]`);
  await card.locator('.pc-next').waitFor();
  assert.deepEqual(log.nextFree[0], { p_clinics: [PARTNER_ID], p_exam: null, p_days: 14 }, 'próximo horário só dos parceiros com agenda online');
  assert.match(await card.textContent(), /Horário confirmado na hora/, 'selo da modalidade (agenda do IMED)');
  assert.match(await card.textContent(), /Próximo horário livre \(Ressonância\): amanhã às 09:00/, 'sem exame no filtro: de qual exame é o horário');
  assert.ok(!/Agenda online/.test(await card.textContent()), 'sem o selo antigo');
  assert.equal(await card.locator('.bd-imed').getAttribute('title'), 'Preços e exames informados pela própria clínica');
  const speech = await cardSpeech(page, `.pc[data-id="imed:${PARTNER_ID}"]`);
  assert.match(speech, /Horário confirmado na hora/);
  assert.match(speech, /Próximo horário livre \(Ressonância\): amanhã às 09:00/);
  const other = page.locator('.pc:has-text("Clínica Jardins Verificada")');
  assert.equal(await other.locator('.bd-agenda').count(), 0, 'sem agenda, sem selo');
  assert.match(await other.textContent(), /Agenda pelo IMED/);
  assert.equal(await page.locator('.pc:has-text("Hospital Santa Exemplo") .bd-agenda').count(), 0);
  await card.click();
  await page.waitForSelector('.sh-ov.open');
  const btn = page.locator('#sheet [data-book-slots]');
  assert.match(await btn.textContent(), /Ver horários e agendar/);
  assert.match(await page.textContent('#sheet .dt-next'), /Próximo horário livre \(Ressonância\): amanhã às 09:00/);
  const nota = await page.textContent('#sheet .note');
  assert.match(nota, /preços e exames são informados pela própria clínica/);
  assert.ok(!/confirmad[ao]s? pela própria clínica/.test(nota), 'sem prometer agenda confirmada pela clínica');
  assert.equal(await btn.getAttribute('href'), `local.html?id=${PARTNER_ID}&proc=dddddddd-0000-4000-8000-0000000000a1#agendar`, 'leva o procedimento do próximo horário');
  assert.equal(await page.locator('#sheet [data-book]').count(), 0, 'não abre o pedido sem horário');
  assert.equal(await page.getAttribute('#sheet .dt-full a', 'href'), `local.html?id=${PARTNER_ID}`);
  await shot(page, '23-agenda-online');
  await page.keyboard.press('Escape');
  await page.click('.pc:has-text("Hospital Santa Exemplo")');
  assert.equal(await page.getAttribute('#sheet .dt-full a', 'href'), 'local.html?cnes=2077485', 'CNES também tem página completa');
  assert.match(await page.textContent('#sheet [data-book]'), /Pedir ao IMED para agendar/);
  await page.keyboard.press('Escape');
  await page.click('.pc:has-text("Clínica Jardins Verificada")');
  assert.match(await page.textContent('#sheet [data-book]'), /Solicitar agendamento/, 'parceiro sem agenda segue com o pedido');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('revisão 5.1: exame filtrado que o parceiro não vende com horário (raio-x): sem "Marca horário pelo site", com o pedido', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: fullFn, scheduled: [PARTNER_ID] });
  await page.goto(`${BASE}perto.html?usar=localizacao&exame=rx`);
  await ready(page);
  const card = page.locator(`.pc[data-id="imed:${PARTNER_ID}"]`);
  await card.waitFor();
  await page.waitForFunction(() => document.querySelector('.pc .bd-ok') !== null);
  await page.waitForFunction(() => !document.querySelector('.pc .bd-agenda'));
  assert.ok(log.nextFree.some((b) => b.p_exam === 'rx'), 'perguntou pelo raio-x');
  const txt = await card.textContent();
  assert.ok(!/Marca horário pelo site|Horário confirmado na hora/.test(txt), `sem prometer horário pelo site: ${txt}`);
  assert.match(txt, /Agenda pelo IMED/);
  assert.equal(await card.locator('.pc-next').count(), 0);
  await card.click();
  await page.waitForSelector('.sh-ov.open');
  const btn = page.locator('#sheet [data-book-slots]');
  assert.match(await btn.textContent(), /Solicitar agendamento/);
  assert.equal(await btn.getAttribute('href'), `local.html?id=${PARTNER_ID}&exame=rx#agendar`, 'a página do local oferece o pedido do raio-x');
  assert.equal(await page.locator('#sheet .dt-next').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

// PostgREST devolve geography como EWKB em hexadecimal (o caso real em produção).
const ewkb = (lng, lat) => {
  const b = Buffer.alloc(25);
  b.writeUInt8(1, 0); b.writeUInt32LE(0x20000001, 1); b.writeUInt32LE(4326, 5);
  b.writeDoubleLE(lng, 9); b.writeDoubleLE(lat, 17);
  return b.toString('hex').toUpperCase();
};
const EST_ROW = { cnes: '2077485', name: 'Hospital Santa Exemplo', legal_name: null, kind: 'hospital', address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', cep: '01409001', phone: '(11) 3141-1000', shift: null, open_24h: true, sus: false, services: ['rm', 'tc', 'rx'], specialties: ['Cardiologia'], cnes_updated_at: '2026-09-15', location_source: 'cnes', location: ewkb(-46.6602, -23.5598), city_ibge: 3550308, municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 } };
const restLocal = (route, u) => {
  if (u.pathname.endsWith('/establishments')) return json(route, u.searchParams.get('cnes') === 'eq.2077485' ? [EST_ROW] : []);
  return json(route, []);
};

await scenario('?local=cnes:… abre o local direto: busca em volta dele e mostra o detalhe', async () => {
  const { page, log, errors, context } = await newPage(browser, { geo: false, fn: fullFn, rest: restLocal });
  await page.goto(`${BASE}perto.html?local=cnes:2077485`);
  await page.waitForSelector('.sh-ov.open');
  assert.match(await page.textContent('#shTitle'), /Hospital Santa Exemplo/);
  assert.ok(log.rest.some((r) => r.startsWith('establishments?select=') && r.includes('cnes=eq.2077485')));
  assert.ok(log.rest.some((r) => r.startsWith('clinics?select=id&cnes=eq.2077485')), 'confere se virou parceiro');
  const search = log.fn.find((b) => b.action === 'search');
  assert.deepEqual([search.lat, search.lng], [-23.56, -46.66], 'origem é o local, arredondada');
  assert.match(await page.textContent('#count'), /Hospital Santa Exemplo/);
  const c = await page.evaluate(() => { const m = document.querySelector('#map'); return m && m.getBoundingClientRect().width; });
  assert.ok(c > 0);
  await page.keyboard.press('Escape');
  assert.ok((await names(page)).includes('Hospital Santa Exemplo'));
  await shot(page, '24-local-direto');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('?local= de parceiro (imed:…) e de local inexistente', async () => {
  const clinic = { ...PARTNER_ROWS[0], location: { type: 'Point', coordinates: [PARTNER_ROWS[0].lng, PARTNER_ROWS[0].lat] }, status: 'published', clinic_exams: [{ exam_code: 'rm', price_cents: 45000 }] };
  const rest = (route, u) => (u.pathname.endsWith('/clinics') && u.searchParams.get('id') === `eq.${PARTNER_ID}` ? json(route, [clinic]) : json(route, []));
  const a = await newPage(browser, { geo: false, fn: fullFn, rest, scheduled: [PARTNER_ID] });
  await a.page.goto(`${BASE}perto.html?local=imed:${PARTNER_ID}`);
  await a.page.waitForSelector('.sh-ov.open');
  assert.match(await a.page.textContent('#shTitle'), /Imagem Paulista Verificada/);
  await a.page.waitForSelector('#sheet [data-book-slots]');
  assert.deepEqual(a.errors, []);
  await a.context.close();

  const b = await newPage(browser, { geo: false, fn: fullFn });
  await b.page.goto(`${BASE}perto.html?local=cnes:0000000`);
  await b.page.waitForSelector('#qMsg:not([hidden])');
  assert.match(await b.page.textContent('#qMsg'), /Não encontramos este local\. Ele pode ter mudado/, 'local inexistente não é "sem localização"');
  assert.doesNotMatch(await b.page.textContent('#qMsg'), /localização/);
  assert.equal(b.log.fn.filter((x) => x.action === 'search').length, 0);
  await b.page.goto(`${BASE}perto.html?local=cnes:abc`);
  await b.page.waitForSelector('.st h2');
  assert.match(await b.page.textContent('.st h2'), /Veja o que tem perto de você/, 'referência inválida: página normal');
  await b.context.close();
});

/* ======================= área inteira da busca (milhares de estabelecimentos) ======================= */
const ORIGIN = { lat: -23.561, lng: -46.657 }; // posição simulada, já arredondada pelo site
const COS = Math.cos((ORIGIN.lat * Math.PI) / 180);
const KIND_NAME = { imagem: 'Centro de Imagem', laboratorio: 'Laboratório', clinica: 'Clínica', hospital: 'Hospital' };
const estRow = (i, dx, dy, kind, sus, name) => ({
  cnes: String(3000000 + i), name: name ?? `${KIND_NAME[kind]} Teste ${i + 1}`, kind, cnes_type: 1,
  address_line: `Rua Teste, ${i + 1}`, neighborhood: 'Bela Vista', cep: '01310100', city: 'São Paulo', uf: 'SP', city_code: '355030',
  lat: ORIGIN.lat + dy / 111320, lng: ORIGIN.lng + dx / (111320 * COS), location_source: 'cnes', phone: null,
  shift: 'Manhã e tarde', open_24h: false, sus, services: kind === 'imagem' ? ['rx', 'usg'] : kind === 'laboratorio' ? ['lab'] : [],
  specialties: [], cnes_updated_at: '2026-09-01',
});
// 3.158 estabelecimentos em espiral até ~4,7 km (como em volta da Av. Paulista) e um único hospital, 3,8 km
// a leste, sozinho num raio de 500 m (para o teste tocar nele sem pegar um vizinho).
const BIG = (() => {
  const kinds = ['clinica', 'laboratorio', 'imagem'];
  const rows = [];
  for (let i = 0, k = 0; k < 3157; i++) {
    const d = 40 + i * 1.45, a = i * 2.399963;
    const dx = d * Math.cos(a), dy = d * Math.sin(a);
    if (Math.hypot(dx - 3800, dy) < 500) continue;
    rows.push(estRow(k, dx, dy, kinds[k % 3], k % 4 === 0));
    if (k === 3 || k === 7) rows.at(-1).specialties = ['Cardiologia']; // só dois, entre os 50 mais próximos
    k += 1;
  }
  rows.push(estRow(3157, 3800, 0, 'hospital', true, 'Hospital Leste do Teste'));
  return rows;
})();
const HOSPITAL = BIG.at(-1);
const fmtN = (n) => new Intl.NumberFormat('pt-BR').format(n);
const nOf = (kind, sus) => BIG.filter((x) => (!kind || x.kind === kind) && (!sus || x.sus)).length;
// Função do servidor com a área grande: os 250 mais próximos, com o total da área em cada linha (como o
// banco manda). O raio da função vai no máximo a 20 km, como no servidor de verdade. imed: parceiros.
const mkBigFn = ({ imed = [] } = {}) => (r, b) => {
  if (b.action !== 'search') return defaultFn(r, b);
  const radius = Math.min(b.radius_m, 20000);
  const list = areaRows(BIG, { p_lat: b.lat, p_lng: b.lng, p_radius_m: radius });
  return json(r, { ok: true, provider: 'osm', radius_m: radius, warnings: [], imed, cnes: pageOf(list, 0, 250), places: [], coverage: { status: 'done', city: 'São Paulo', uf: 'SP' } });
};
const bigFn = mkBigFn();
// Detalhe de um estabelecimento (tabela establishments com municipalities), como o PostgREST devolve.
const restBig = (route, u) => {
  if (!u.pathname.endsWith('/establishments')) return json(route, []);
  const row = BIG.find((x) => `eq.${x.cnes}` === u.searchParams.get('cnes'));
  if (!row) return json(route, []);
  const { city, uf, city_code: code, lat, lng, ...rest } = row;
  return json(route, [{ ...rest, municipalities: { name: city, uf, cnes_code: Number(code) } }]);
};
const fail503 = (route) => route.fulfill({ status: 503, body: '', headers: { 'Access-Control-Allow-Origin': '*' } });
const cards = (page) => page.$$eval('#list .pc[data-id]', (els) => els.map((e) => e.dataset.id));
const viewM = (page) => page.$eval('#map', (el) => Number(el.dataset.viewM));
const countHas = (page, text) => page.waitForFunction((t) => document.querySelector('#count').textContent.includes(t), text);
// Procura no canvas dos pontos o único hospital (cor #E8512F, a única avermelhada; misturada um pouco
// com algum ponto embaixo) e devolve o centro dele na tela.
async function findHospitalDot(page) {
  for (let i = 0; i < 30; i++) {
    const dot = await page.evaluate(() => {
      const cv = document.querySelector('.leaflet-pts-pane canvas');
      if (!cv || !cv.width) return null;
      const { data } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
      let sx = 0, sy = 0, n = 0;
      for (let k = 0; k < data.length; k += 4) {
        if (data[k + 3] > 150 && data[k] - data[k + 1] > 100 && data[k] - data[k + 2] > 100) {
          const p = k / 4; sx += p % cv.width; sy += Math.floor(p / cv.width); n += 1;
        }
      }
      if (!n) return null;
      const rect = cv.getBoundingClientRect();
      return { x: rect.left + (sx / n) * (rect.width / cv.width), y: rect.top + (sy / n) * (rect.height / cv.height), n };
    });
    if (dot) return dot;
    await page.waitForTimeout(100);
  }
  return null;
}

await scenario('área inteira: o mapa abre mostrando o raio todo, com os pontos e a contagem real', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: bigFn, data: BIG, rest: restBig });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('#map[data-points="3000"]');
  await countHas(page, '3.158 estabelecimentos em até 5 km');
  assert.match(await page.textContent('#count'), /^3\.158 estabelecimentos em até 5 km da sua localização \(aproximada\)$/);
  const span = await viewM(page);
  assert.ok(span >= 5000 * 1.6, `o mapa mostra o círculo de 5 km inteiro (${span} m)`);
  assert.ok(span <= 5000 * 4, `sem afastar demais (${span} m)`);
  assert.equal((await cards(page)).length, 50, 'lista em páginas de 50');
  assert.equal(await pins(page), 0, 'afastado, os da lista também aparecem como ponto (sem pilha de pinos)');
  assert.equal(await page.getAttribute('#map', 'data-points-drawn'), '3000');
  assert.match(await page.textContent('#legend'), /Parceiros e locais do mapa público aparecem sempre como pino; ao aproximar o mapa, os primeiros da lista também\./);
  assert.equal(log.points.length, 1);
  assert.equal(log.points[0].search, '?select=cnes,kind,lat,lng,total', 'pede só as colunas necessárias');
  assert.deepEqual(log.points[0].body, { p_lat: -23.561, p_lng: -46.657, p_radius_m: 5000, p_limit: 3000 });
  assert.equal(log.cnes.length, 0, 'as primeiras páginas já vieram com a busca');
  assert.match(await page.textContent('#ptsCap'), /O mapa mostra os 3\.000 mais próximos\. Aproxime o mapa e toque em "Buscar nesta área" para ver outros\./);
  assert.doesNotMatch(await page.textContent('#banners'), /Região com muitos estabelecimentos/);
  assert.match(await page.textContent('#mapKey'), /Cadastro oficial.*Imagem.*Laboratório.*Clínica.*Hospital.*3\.000 de 3\.158 no mapa/s);
  assert.match(await page.textContent('.pt-pager'), /Mostrando 50 de 3\.158/);
  assert.match(await page.textContent('[data-act="more"]'), /Ver mais 50 \(de 3\.158\)/);
  await shot(page, '25-area-inteira-desktop');
  // Tocar num ponto abre o detalhe daquele local, buscado na tabela do cadastro oficial.
  const dot = await findHospitalDot(page);
  assert.ok(dot, 'o hospital aparece no mapa como ponto');
  await page.mouse.click(dot.x, dot.y);
  await page.waitForSelector('.sh-ov.open .dt-top');
  assert.match(await page.textContent('#shTitle'), /Hospital Leste do Teste/);
  const req = log.rest.find((r) => r.startsWith('establishments?'));
  assert.ok(req.endsWith(`&cnes=eq.${HOSPITAL.cnes}`), req);
  assert.ok(!new URLSearchParams(req.split('?')[1]).get('select').split(',').includes('location'), 'sem pedir a localização (já veio no ponto)');
  const sheet = await page.textContent('#sheet');
  assert.match(sheet, /Cadastro oficial/);
  assert.match(sheet, /Atende SUS/);
  assert.match(sheet, /3,8 km/, 'distância a partir do ponto da busca');
  assert.ok(!/R\$/.test(sheet), 'sem preço inventado');
  await shot(page, '26-ponto-detalhe');
  await page.keyboard.press('Escape');
  await page.mouse.click(dot.x, dot.y);
  await page.waitForSelector('.sh-ov.open .dt-top');
  assert.equal(log.rest.filter((r) => r.startsWith('establishments?')).length, 1, 'o detalhe fica guardado: não busca de novo');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('"Ver mais": páginas de 50 e, depois dos 250, o banco com p_offset, sem repetir', async () => {
  let failOnce = false;
  const { page, log, errors, context } = await newPage(browser, { fn: bigFn, data: BIG, cnesRpc: (route, b, rows) => {
    if (failOnce && b.p_offset === 300) { failOnce = false; return fail503(route); }
    // Cada página começa com o último da anterior (o banco mudou entre uma e outra): não pode aparecer duas vezes.
    return json(route, pageOf(areaRows(rows, b), Math.max(0, b.p_offset - 1), b.p_limit));
  } });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('[data-act="more"]');
  for (const n of [100, 150, 200, 250]) {
    await page.click('[data-act="more"]');
    await page.waitForFunction((k) => document.querySelectorAll('#list .pc').length === k, n);
  }
  assert.equal(log.cnes.length, 0, 'até 250, sem ir ao banco');
  await page.click('[data-act="more"]');
  await page.waitForFunction(() => document.querySelectorAll('#list .pc').length > 250 && document.querySelector('[data-act="more"]'));
  assert.deepEqual(log.cnes.map((b) => [b.p_offset, b.p_limit, b.p_radius_m]), [[250, 50, 5000]]);
  assert.ok(!('p_kind' in log.cnes[0]) && !('p_exam' in log.cnes[0]) && !('p_sus' in log.cnes[0]), 'sem filtro, sem parâmetros de filtro');
  let ids = await cards(page);
  assert.equal(ids.length, 299, 'o repetido não entra');
  assert.equal(new Set(ids).size, ids.length, 'nenhum local duas vezes');
  assert.ok(await page.evaluate(() => document.activeElement?.matches('.pc[data-id] .pc-open')), 'o foco vai para o primeiro local novo');
  assert.match(await page.textContent('#srMsg'), /49 locais a mais na lista/);
  assert.match(await page.textContent('[data-act="more"]'), /Ver mais 50 \(de 3\.158\)/);
  assert.match(await page.textContent('.pt-pager'), /Mostrando 299 de 3\.158/);
  // A página seguinte falha: a lista continua e o botão vira "Tentar de novo".
  failOnce = true;
  await page.click('[data-act="more"]');
  await page.waitForSelector('.pt-pager-msg');
  assert.match(await page.textContent('.pt-pager'), /Não foi possível carregar mais agora.*Tentar de novo/s);
  assert.equal((await cards(page)).length, 299);
  await shot(page, '27-ver-mais-erro');
  await page.click('[data-act="more"]');
  await page.waitForFunction(() => document.querySelectorAll('#list .pc').length > 299);
  assert.deepEqual(log.cnes.slice(1).map((b) => b.p_offset), [300, 300], 'tenta de novo a mesma página');
  ids = await cards(page);
  assert.equal(ids.length, 349);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('filtros de tipo e SUS valem para a área inteira (banco), com espera e cancelamento', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: bigFn, data: BIG, rpc: (r) => json(r, []), cnesRpc: async (route, b, rows) => {
    if (b.p_kind === 'laboratorio') await new Promise((ok) => setTimeout(ok, 900)); // resposta atrasada
    try { await json(route, pageOf(areaRows(rows, b), b.p_offset ?? 0, b.p_limit)); } catch { /* pedido cancelado pelo site */ }
  } });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('#map[data-points="3000"]');
  const n0 = log.cnes.length;
  // Duas escolhas seguidas: o site espera a pessoa terminar e busca só a última.
  await page.selectOption('#fKind', 'clinica');
  await page.selectOption('#fKind', 'imagem');
  await countHas(page, `${fmtN(nOf('imagem'))} estabelecimentos em até 5 km`);
  assert.deepEqual(log.cnes.slice(n0).map((b) => [b.p_kind, b.p_offset, b.p_limit]), [['imagem', 0, 50]]);
  assert.equal(log.points.at(-1).body.p_kind, 'imagem');
  await page.waitForSelector(`#map[data-points="${nOf('imagem')}"]`);
  let meta = await page.$$eval('#list .pc .pc-meta', (els) => els.map((e) => e.textContent));
  assert.equal(meta.length, 50);
  assert.ok(meta.every((t) => /Diagnóstico por imagem/.test(t)), 'só centros de imagem, os 50 mais próximos da área');
  assert.equal(await page.locator('#ptsCap').count(), 0, 'sem aviso: todos os pontos cabem no mapa');
  assert.match(await page.textContent('[data-act="more"]'), new RegExp(`Ver mais 50 \\(de ${fmtN(nOf('imagem')).replace('.', '\\.')}\\)`));
  // "Atende SUS" também vai para o banco (p_sus=true), junto com o tipo.
  await page.click('#fSus');
  await countHas(page, `${fmtN(nOf('imagem', true))} estabelecimentos`);
  assert.deepEqual([log.cnes.at(-1).p_kind, log.cnes.at(-1).p_sus], ['imagem', true]);
  assert.deepEqual([log.points.at(-1).body.p_kind, log.points.at(-1).body.p_sus], ['imagem', true]);
  await shot(page, '28-filtro-area-inteira');
  // Volta sem SUS: a consulta já feita é reaproveitada, sem ir ao banco de novo.
  const n1 = log.cnes.length, p1 = log.points.length;
  await page.click('#fSus');
  await countHas(page, `${fmtN(nOf('imagem'))} estabelecimentos`);
  await page.waitForTimeout(400);
  assert.equal(log.cnes.length, n1);
  assert.equal(log.points.length, p1);
  // A resposta atrasada de "laboratório" não pode passar por cima da escolha seguinte.
  await page.selectOption('#fKind', 'laboratorio');
  for (let i = 0; i < 40 && !log.cnes.some((b) => b.p_kind === 'laboratorio'); i++) await page.waitForTimeout(50);
  assert.ok(log.cnes.some((b) => b.p_kind === 'laboratorio'));
  await page.selectOption('#fKind', 'clinica');
  await countHas(page, `${fmtN(nOf('clinica'))} estabelecimentos`);
  await page.waitForTimeout(1100);
  meta = await page.$$eval('#list .pc .pc-meta', (els) => els.map((e) => e.textContent));
  assert.ok(meta.length === 50 && meta.every((t) => /Clínica/.test(t)), 'fica a lista do último filtro');
  assert.match(await page.textContent('#count'), new RegExp(`${fmtN(nOf('clinica')).replace('.', '\\.')} estabelecimentos`));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('busca com filtro fora do ar: usa o que já tem e o botão vira "Tentar de novo"', async () => {
  let down = true;
  const { page, log, errors, context } = await newPage(browser, { fn: bigFn, data: BIG,
    cnesRpc: (route, b, rows) => (down ? fail503(route) : json(route, pageOf(areaRows(rows, b), b.p_offset ?? 0, b.p_limit))) });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('[data-act="more"]');
  await page.selectOption('#fKind', 'imagem');
  await page.waitForSelector('.pt-pager-msg');
  assert.match(await page.textContent('.pt-pager'), /Não conseguimos buscar na área inteira agora.*Tentar de novo/s);
  const local = BIG.slice(0, 250).filter((x) => x.kind === 'imagem').length;
  assert.equal((await cards(page)).length, local, 'mostra os centros de imagem que já tinham vindo com a busca');
  assert.equal(log.cnes.at(-1).p_kind, 'imagem');
  down = false;
  await page.click('[data-act="more"]');
  await countHas(page, `${fmtN(nOf('imagem'))} estabelecimentos`);
  await page.waitForFunction(() => document.querySelectorAll('#list .pc').length === 50);
  assert.equal(await page.locator('.pt-pager-msg').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pontos do mapa fora do ar: a busca continua e dá para tentar de novo', async () => {
  let down = true;
  const { page, errors, context } = await newPage(browser, { fn: bigFn, data: BIG,
    points: (route, b, rows) => (down ? fail503(route) : json(route, pointsOf(areaRows(rows, b), b.p_limit))) });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('#mapKey.err');
  assert.equal((await cards(page)).length, 50, 'a lista continua');
  assert.match(await page.textContent('#count'), /3\.158 estabelecimentos em até 5 km/, 'o total veio junto com a busca');
  assert.equal(await page.getAttribute('#map', 'data-points'), '0');
  assert.match(await page.textContent('#mapKey'), /Os pontos da área não carregaram\.\s*Tentar de novo/);
  assert.match(await page.textContent('[data-act="more"]'), /Ver mais 50 \(de 3\.158\)/);
  assert.equal(await page.locator('#ptsCap').count(), 0);
  down = false;
  await page.click('#mapKey [data-act="points-retry"]');
  await page.waitForSelector('#map[data-points="3000"]');
  assert.equal(await page.locator('#mapKey.err').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('distância de até 50 km: busca, parceiros e pontos na área toda', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: bigFn, data: BIG, rpc: (r) => json(r, []) });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('#map[data-points="3000"]');
  assert.deepEqual(await page.$$eval('#fDist option', (o) => o.map((x) => x.value)), ['1000', '2000', '5000', '10000', '20000', '50000']);
  assert.equal(await page.inputValue('#fDist'), '5000', '5 km continua sendo o padrão');
  await page.selectOption('#fDist', '50000');
  await countHas(page, '3.158 estabelecimentos em até 50 km');
  assert.equal(log.fn.filter((b) => b.action === 'search').at(-1).radius_m, 50000);
  assert.equal(log.rpc.at(-1).p_radius_m, 50000, 'parceiros acima de 20 km vêm direto do banco');
  assert.equal(log.points.at(-1).body.p_radius_m, 50000);
  await page.waitForFunction(() => Number(document.querySelector('#map').dataset.viewM) >= 80000);
  assert.equal(log.overpass.length, 0);
  await shot(page, '29-50km');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (390px): área inteira no mapa, "Ver mais" e toque no ponto', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, fn: bigFn, data: BIG, rest: restBig });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('#map[data-points="3000"]', { state: 'attached' }); // no celular o mapa fica atrás da lista
  await countHas(page, '3.158 estabelecimentos');
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `sem rolagem lateral (${overflow}px)`);
  await shot(page, '30-celular-contagem');
  await page.locator('.pt-pager').scrollIntoViewIfNeeded();
  await shot(page, '31-celular-ver-mais');
  await page.click('#viewToggle');
  await page.waitForTimeout(500);
  assert.ok(await viewM(page) >= 8000, 'no celular o mapa também mostra o raio todo');
  await shot(page, '32-celular-area-inteira');
  const dot = await findHospitalDot(page);
  assert.ok(dot, 'o hospital aparece no mapa');
  await page.touchscreen.tap(dot.x, dot.y);
  await page.waitForSelector('.sh-ov.open .dt-top');
  assert.match(await page.textContent('#shTitle'), /Hospital Leste do Teste/);
  await shot(page, '33-celular-ponto-detalhe');
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `sem rolagem lateral (${overflow}px)`);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pinos: parceiros e locais do mapa público nunca somem do mapa (o limite vale só para o cadastro oficial)', async () => {
  // a) Parceiros além da posição 100 da lista, depois de um "Ver mais".
  const a = await newPage(browser, { fn: mkBigFn({ imed: PARTNER_ROWS }), data: BIG });
  await a.page.goto(`${BASE}perto.html?usar=localizacao`);
  await a.page.waitForSelector('#map[data-points="3000"]');
  assert.equal(await pins(a.page, '.mk-imed'), 2);
  await a.page.click('[data-act="more"]');
  await a.page.waitForFunction(() => document.querySelectorAll('#list .pc').length === 102);
  const ids = await cards(a.page);
  assert.equal(ids.indexOf(`imed:${PARTNER_ROWS[1].id}`), 101, 'o parceiro a 1,1 km fica depois dos 100 do cadastro oficial');
  assert.equal(await pins(a.page, '.mk-imed'), 2, 'os dois parceiros continuam com pino');
  await zoomIn(a.page, 15);
  assert.equal(await pins(a.page, '.mk-imed'), 2, 'perto também');
  assert.equal(await pins(a.page, '.mk:not(.mk-imed)'), 100, 'do cadastro oficial, só os 100 primeiros da lista ganham pino');
  assert.equal(await a.page.getAttribute('#map', 'data-points-drawn'), '2900', 'o resto como ponto');
  assert.deepEqual(a.errors, []);
  await a.context.close();
  // b) Cidade ainda fora do banco com 150 locais do mapa público (sem ponto): todos com pino.
  const osm = { elements: Array.from({ length: 150 }, (_, i) => ({
    type: 'node', id: 9000 + i, lat: ORIGIN.lat + (Math.sin(i) * (100 + i * 12)) / 111320, lon: ORIGIN.lng + (Math.cos(i) * (100 + i * 12)) / (111320 * COS),
    tags: { name: `Clínica Popular ${i + 1}`, amenity: 'clinic' },
  })) };
  const b = await newPage(browser, { overpass: (r) => json(r, osm) });
  await b.page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(b.page);
  assert.equal((await cards(b.page)).length, 150);
  assert.equal(await pins(b.page), 150, 'um pino para cada local do mapa público');
  assert.equal(await b.page.getAttribute('#map', 'data-points-drawn'), '0');
  assert.deepEqual(b.errors, []);
  await b.context.close();
});

await scenario('mapa afastado: "Você está aqui" fica por cima e a lista vira ponto; perto, a lista volta a ter pino', async () => {
  for (const mobile of [false, true]) {
    const { page, errors, context } = await newPage(browser, { mobile, fn: bigFn, data: BIG });
    await page.goto(`${BASE}perto.html?usar=localizacao`);
    await page.waitForSelector('#map[data-points="3000"]', { state: 'attached' });
    if (mobile) { await page.click('#viewToggle'); await page.waitForTimeout(500); }
    assert.ok(await zoomOf(page) < 15, 'abre afastado (área inteira)');
    assert.equal(await pins(page), 0, 'sem pilha de pinos em volta da origem');
    assert.equal(await page.getAttribute('#map', 'data-points-drawn'), '3000', 'os da lista aparecem como ponto');
    assert.ok(await meOnTop(page), '"Você está aqui" aparece por cima');
    await shot(page, mobile ? '35-celular-origem-afastado' : '34-origem-afastado');
    await zoomIn(page, 16);
    assert.equal(await pins(page), 50, 'perto, os 50 da lista ganham pino');
    assert.equal(await page.getAttribute('#map', 'data-points-drawn'), '2950');
    assert.ok(await meOnTop(page), 'a origem continua por cima dos pinos');
    await shot(page, mobile ? '37-celular-origem-perto' : '36-origem-perto');
    if (mobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `sem rolagem lateral (${overflow}px)`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('filtros só de parceiros (verificados, preço, convênio) tiram do mapa os pontos de quem não é parceiro', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: mkBigFn({ imed: PARTNER_ROWS }), data: BIG });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('#map[data-points="3000"]');
  await page.waitForSelector('#ptsCap');
  const p0 = log.points.length;
  await page.click('#fImed');
  await countHas(page, '2 estabelecimentos em até 5 km');
  assert.equal(await page.getAttribute('#map', 'data-points-drawn'), '0', 'sem pontos do cadastro oficial');
  assert.equal(await page.locator('#ptsCap').count(), 0, 'sem o aviso dos 3.000 pontos');
  assert.ok(await page.locator('#mapKey').isHidden(), 'sem a legenda do cadastro oficial');
  assert.equal(await pins(page, '.mk-imed'), 2, 'os parceiros continuam no mapa');
  await shot(page, '38-so-parceiros');
  await page.click('#fImed');
  await page.waitForSelector('#map[data-points-drawn="3000"]');
  assert.equal(await page.locator('#ptsCap').count(), 1, 'o aviso volta');
  assert.ok(await page.locator('#mapKey').isVisible());
  assert.equal(log.points.length, p0, 'os pontos voltam do que já tinha sido baixado');
  await page.selectOption('#fPrice', 'ate100');
  await countHas(page, '0 estabelecimentos');
  assert.equal(await page.getAttribute('#map', 'data-points-drawn'), '0');
  assert.equal(await page.locator('#ptsCap').count(), 0);
  await page.selectOption('#fPrice', '');
  await page.waitForSelector('#map[data-points-drawn="3000"]');
  // Nova busca com o filtro de parceiros ligado: não baixa os pontos de quem não aparece.
  await page.click('#fImed');
  await page.selectOption('#fDist', '10000');
  await page.waitForFunction(() => document.querySelector('#count').textContent.includes('em até 10 km'));
  await page.waitForTimeout(400);
  assert.equal(log.points.length, p0, 'sem pedir os pontos com "Parceiros verificados" ligado');
  assert.equal(await page.getAttribute('#map', 'data-points-drawn'), '0');
  await page.click('#fImed');
  await page.waitForSelector('#map[data-points="3000"][data-points-drawn="3000"]');
  assert.equal(log.points.at(-1).body.p_radius_m, 10000, 'desligando, busca os pontos da área nova');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('"Buscar nesta área" depois de arrastar o mapa mantém a distância escolhida', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: bigFn, data: BIG });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('#map[data-points="3000"]');
  const searches = () => log.fn.filter((b) => b.action === 'search');
  for (const dx of [-240, 240]) { // arrasta para um lado e depois volta
    await page.waitForTimeout(1000); // o enquadramento automático terminou
    const n = searches().length;
    const box = await page.locator('#map').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 - 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForSelector('#areaBtn:not(.hide)');
    await page.click('#areaBtn');
    for (let t = 0; t < 40 && searches().length === n; t++) await page.waitForTimeout(50);
    assert.equal(searches().length, n + 1);
    assert.equal(searches().at(-1).radius_m, 5000, `arrastando ${dx} px: continua em 5 km`);
    assert.equal(await page.inputValue('#fDist'), '5000');
    await countHas(page, 'estabelecimentos em até 5 km do centro do mapa');
  }
  await page.waitForSelector('#list .pc');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('"Ver mais" pelo teclado: o foco fica no botão enquanto carrega e quando falha; sem refazer a lista', async () => {
  let release = null, fail = true;
  const { page, log, errors, context } = await newPage(browser, { fn: bigFn, data: BIG, cnesRpc: async (route, b, rows) => {
    await new Promise((ok) => { release = ok; }); // a resposta espera o teste liberar
    if (fail) { fail = false; return fail503(route); }
    return json(route, pageOf(areaRows(rows, b), b.p_offset ?? 0, b.p_limit));
  } });
  const answer = async () => {
    for (let t = 0; t < 60 && !release; t++) await page.waitForTimeout(50);
    const r = release; release = null; r();
  };
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('[data-act="more"]');
  // Marca um cartão e o pino da origem: se a lista ou o mapa forem refeitos, a marca some.
  await page.$eval('#list .pc[data-id]', (el) => { el.dataset.keep = '1'; });
  for (const n of [100, 150, 200, 250]) {
    await page.focus('[data-act="more"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction((k) => document.querySelectorAll('#list .pc').length === k, n);
  }
  assert.equal(await page.locator('#list .pc[data-keep="1"]').count(), 1, 'os cartões que já estavam não são refeitos');
  assert.ok(await page.evaluate(() => document.activeElement?.matches('.pc[data-id] .pc-open')), 'o foco vai para o primeiro local novo');
  // Agora a próxima página vem do banco (demora): o foco fica no mesmo botão.
  await page.focus('[data-act="more"]');
  const btn = await page.$('[data-act="more"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-act="more"][aria-busy="true"]');
  assert.ok(await focusIsMore(page), 'carregando: o foco continua no botão');
  assert.equal(await page.getAttribute('[data-act="more"]', 'aria-disabled'), 'true');
  assert.match(await page.textContent('[data-act="more"]'), /Carregando mais/);
  await answer(); // falha
  await page.waitForSelector('.pt-pager-msg');
  assert.ok(await focusIsMore(page), 'depois da falha o foco fica no "Tentar de novo"');
  assert.ok(await btn.evaluate((el) => el.isConnected && el === document.activeElement), 'é o mesmo botão');
  assert.match(await page.textContent('[data-act="more"]'), /Tentar de novo/);
  assert.match(await page.textContent('#srMsg'), /Não foi possível carregar mais/);
  await page.keyboard.press('Enter');
  await answer(); // agora responde
  await page.waitForFunction(() => document.querySelectorAll('#list .pc').length === 300);
  assert.deepEqual(log.cnes.map((b) => b.p_offset), [250, 250]);
  assert.ok(await page.evaluate(() => document.activeElement?.matches('.pc[data-id] .pc-open')), 'o foco vai para o primeiro local novo');
  assert.equal(await page.locator('#list .pc[data-keep="1"]').count(), 1);
  assert.match(await page.textContent('#srMsg'), /50 locais a mais na lista/);
  assert.equal(await page.locator('#list .pt-pager-msg').count(), 0);
  // Filtro do navegador (especialidade) sem nenhum novo na próxima página: não diz que acabou.
  await page.selectOption('#fSpec', 'Cardiologia');
  await page.waitForFunction(() => document.querySelectorAll('#list .pc').length === 2);
  await page.focus('[data-act="more"]');
  await page.keyboard.press('Enter');
  await answer();
  await page.waitForFunction(() => /Nenhum local novo/.test(document.querySelector('#srMsg').textContent));
  assert.doesNotMatch(await page.textContent('#srMsg'), /Não há outros locais/);
  assert.ok(await focusIsMore(page), 'o foco fica no "Ver mais" para continuar');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('distância do banco: quem está na borda do raio entra na lista (sem recalcular na esfera)', async () => {
  // ~4.997 m ao norte pelo banco (elipsoide); a conta na esfera daria ~5.017 m.
  const edge = { ...CNES_ROWS[1], cnes: '7000001', name: 'Laboratório da Borda', lat: ORIGIN.lat + 0.04512, lng: ORIGIN.lng, distance_m: 4997, location_source: 'cnes' };
  const fn = (r, b) => (b.action === 'search'
    ? json(r, { ok: true, provider: 'osm', radius_m: 5000, warnings: [], imed: [], cnes: [{ ...edge, total: 1 }], places: [], coverage: { status: 'done', city: 'São Paulo', uf: 'SP' } })
    : defaultFn(r, b));
  const { page, errors, context } = await newPage(browser, { fn, points: (route) => json(route, [{ cnes: edge.cnes, kind: edge.kind, lat: edge.lat, lng: edge.lng, total: 1 }]) });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await countHas(page, '1 estabelecimento em até 5 km');
  await page.waitForSelector('.pc:has-text("Laboratório da Borda")');
  assert.match(await page.textContent('.pc .pc-dist'), /5,0 km/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('acima de 20 km: se os parceiros da área toda não carregarem, aparece o aviso', async () => {
  const { page, errors, context } = await newPage(browser, { fn: mkBigFn({ imed: PARTNER_ROWS }), data: BIG, rpc: fail503 });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('#map[data-points="3000"]');
  assert.equal(await page.locator('.bn.warn').count(), 0);
  await page.selectOption('#fDist', '50000');
  await countHas(page, 'em até 50 km');
  await page.waitForSelector('.bn.warn');
  assert.match(await page.textContent('#banners'), /Não conseguimos carregar as clínicas parceiras do IMED agora\.\s*Tentar de novo/);
  assert.ok((await names(page)).includes('Imagem Paulista Verificada'), 'os parceiros de até 20 km continuam');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('cidade sendo importada: a contagem parcial não aparece como total da área', async () => {
  const rows = BIG.slice(0, 12);
  const fn = (r, b) => (b.action === 'search'
    ? json(r, { ok: true, provider: 'osm', radius_m: 5000, warnings: [], imed: [], cnes: pageOf(areaRows(rows, { p_lat: b.lat, p_lng: b.lng }), 0, 250), places: [], coverage: { status: 'loading', city: 'São Paulo', uf: 'SP' } })
    : defaultFn(r, b));
  const { page, errors, context } = await newPage(browser, { fn, data: rows, overpass: fail503,
    points: (route, b) => json(route, pointsOf(areaRows(rows, b), 5)) }); // só 5 dos 12 no mapa
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await page.waitForSelector('.bn .spin');
  await page.waitForSelector('#map[data-points="5"]');
  await page.waitForSelector('.bn.warn');
  const count = await page.textContent('#count');
  assert.match(count, /^12 resultados em até 5 km/);
  assert.doesNotMatch(count, /estabelecimentos/, 'sem "12 estabelecimentos", que seria só o que já chegou');
  assert.equal(await page.locator('#ptsCap').count(), 0);
  assert.doesNotMatch(await page.textContent('#mapKey'), /no mapa/);
  assert.doesNotMatch(await page.textContent('#list'), /Mostrando \d+ de/);
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
const sheetQuestions = (page) => page.$$eval('#sheet .cq-list li', (els) => els.map((e) => e.textContent));
const FOOT = 'Só perguntas: as respostas vêm do próprio local. Sobre o preparo, siga também a orientação do seu médico.';

await scenario('antes de ir: o que perguntar ao ligar na ficha do cadastro oficial, com o exame da busca, e nada no parceiro', async () => {
  const { page, errors, context } = await newPage(browser, { fn: fullFn });
  await context.addInitScript(COPY_OK);
  await page.goto(`${BASE}perto.html?usar=localizacao&exame=rm`);
  await ready(page);
  await page.click('.pc:has-text("Hospital Santa Exemplo")');
  await page.waitForSelector('.sh-ov.open');
  const box = page.locator('#sheet details.cq');
  assert.equal(await box.count(), 1);
  assert.equal(await box.getAttribute('open'), null, 'fechada até o toque');
  assert.equal(await page.locator('#sheet .cq-list').isVisible(), false);
  assert.equal(await page.locator('#sheet .dt-acts a:has-text("Ligar")').count(), 1, 'Ligar só nas ações da ficha');
  assert.equal(await page.locator('#sheet .cq a[href^="tel:"]').count(), 0);
  assert.equal(await page.getAttribute('#sheet .dt-full a', 'href'), 'local.html?cnes=2077485&exame=rm', 'a página completa abre com o exame da busca');
  await page.click('#sheet .cq summary');
  assert.equal(await box.getAttribute('open'), '');
  const qs = await sheetQuestions(page);
  assert.equal(qs[0], 'Vocês fazem ressonância magnética?', 'sempre primeiro: o serviço do cadastro oficial vem do nome do local');
  assert.ok(qs.includes('Precisa agendar ou é por ordem de chegada?'));
  assert.ok(qs.includes('Precisa de jejum ou de outro preparo para a ressonância magnética?'));
  assert.ok(qs.includes('Quanto custa a ressonância magnética no particular?'));
  assert.ok(qs.includes('Que documentos preciso levar? Precisa do pedido médico?'));
  assert.ok(!qs.some((q) => /SUS/.test(q)), 'o cadastro oficial diz que não atende SUS: sem a pergunta');
  assert.ok(!/R\$/.test(await page.textContent('#sheet .cq')), 'só perguntas, sem preço');
  assert.equal(await page.textContent('#sheet .cq .src'), `${FOOT} Se preferir, peça ao IMED para agendar por você.`, 'sem o SUS, o pedido ao IMED como sempre');
  await page.click('#sheet [data-act="copy-questions"]');
  await page.waitForFunction(() => document.querySelector('#sheet .cq-msg')?.textContent);
  assert.equal(await page.textContent('#sheet .cq-msg'), 'Perguntas copiadas. É só colar onde quiser.');
  assert.match(await page.evaluate(() => window.__copied), /^Hospital Santa Exemplo · \(11\) 3141-1000\nO que perguntar ao ligar:\n1\. Vocês fazem ressonância magnética\?\n2\. /);
  assert.ok(await page.isVisible('.sh-ov.open'), 'copiar não fecha a ficha');
  await shot(page, '34-perguntas-ao-ligar');
  // Teclado: Enter no título fecha a caixa, e o Tab continua dentro da ficha.
  await page.focus('#sheet .cq summary');
  await page.keyboard.press('Enter');
  assert.equal(await box.getAttribute('open'), null);
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => !!document.activeElement?.closest('#sheet')), 'o foco fica na ficha');
  }
  await page.keyboard.press('Escape');
  // Parceiro: preço e agenda vêm da clínica; sem roteiro, e a página completa continua igual.
  await page.click('.pc:has-text("Imagem Paulista Verificada")');
  await page.waitForSelector('.sh-ov.open');
  assert.equal(await page.locator('#sheet .cq').count(), 0);
  assert.equal(await page.getAttribute('#sheet .dt-full a', 'href'), `local.html?id=${PARTNER_ID}`);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('antes de ir: laboratório que atende SUS pergunta o SUS, o jejum e o prazo; o local do mapa público também tem o roteiro', async () => {
  const { page, errors, context } = await newPage(browser, { fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  await page.click('.pc:has-text("Laboratório Análise Paulista")');
  await page.waitForSelector('.sh-ov.open');
  await page.click('#sheet .cq summary');
  const qs = await sheetQuestions(page);
  assert.equal(qs[0], 'Vocês fazem todos os exames do meu pedido médico?', 'sem exame na busca: vale o tipo do local');
  assert.ok(qs.includes('Atendem pelo SUS? Precisa de encaminhamento do posto de saúde?'), 'o cadastro oficial diz que atende SUS');
  assert.ok(qs.includes('Precisa de jejum? De quantas horas?'));
  assert.ok(qs.includes('Em quantos dias sai o resultado?'));
  assert.ok(qs.includes('Fazem coleta em casa?'));
  // Na ficha, o aviso do SUS do pedido só aparece no formulário: a própria caixa avisa que o IMED não marca pelo SUS.
  assert.equal(await page.textContent('#sheet .cq .src'),
    `${FOOT} Se preferir, peça ao IMED para agendar por você (particular ou convênio). Pelo SUS, o agendamento começa no posto de saúde (UBS).`);
  assert.equal(await page.getAttribute('#sheet .dt-full a', 'href'), 'local.html?cnes=6543210', 'sem exame na busca, o endereço de sempre');
  assert.deepEqual(errors, []);
  await context.close();

  // Local do mapa público (OpenStreetMap): também não é parceiro. Clínica do IMED (demonstração): sem roteiro.
  const osm = await newPage(browser);
  await osm.page.goto(`${BASE}perto.html?usar=localizacao&demo=1`);
  await osm.page.click('.pc:has-text("Laboratório Vida")');
  await osm.page.waitForSelector('.sh-ov.open');
  assert.equal(await osm.page.locator('#sheet .cq').count(), 1);
  await osm.page.click('#sheet .cq summary');
  const oq = await sheetQuestions(osm.page);
  assert.ok(oq.includes('Fazem coleta em casa?'));
  assert.ok(!oq.some((q) => /SUS/.test(q)), 'sem o dado do SUS, sem a pergunta');
  await osm.page.keyboard.press('Escape');
  await osm.page.click('.pc.imed >> nth=0');
  await osm.page.waitForSelector('.sh-ov.open');
  assert.equal(await osm.page.locator('#sheet .cq').count(), 0);
  assert.deepEqual(osm.errors, []);
  await osm.context.close();
});

await scenario('celular (390px): perguntas ao ligar abertas na ficha, sem rolagem lateral e com alvos de toque grandes', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, fn: fullFn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  await page.click('.pc:has-text("Hospital Santa Exemplo")');
  await page.waitForSelector('.sh-ov.open');
  const h = await page.$eval('#sheet .cq summary', (el) => el.getBoundingClientRect().height);
  assert.ok(h >= 44, `título da caixa com ${h}px de altura`);
  await page.click('#sheet .cq summary');
  await page.locator('#sheet [data-act="copy-questions"]').scrollIntoViewIfNeeded();
  const b = await page.$eval('#sheet [data-act="copy-questions"]', (el) => el.getBoundingClientRect().height);
  assert.ok(b >= 44, `"Copiar as perguntas" com ${b}px de altura`);
  const ov = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, document.querySelector('#sheet').scrollWidth - document.querySelector('#sheet').clientWidth));
  assert.ok(ov <= 0, `sem rolagem lateral (${ov}px)`);
  await shot(page, '35-celular-perguntas');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (360 e 390px): sem copiar sozinho, o aviso e o texto selecionado ficam na tela da ficha, acima do botão fixo', async () => {
  for (const viewport of [{ width: 360, height: 740 }, { width: 390, height: 844 }]) {
    const w = viewport.width;
    const { page, errors, context } = await newPage(browser, { mobile: true, viewport, fn: fullFn });
    await context.addInitScript(COPY_DENY);
    await page.goto(`${BASE}perto.html?usar=localizacao&exame=rm`);
    await ready(page);
    await page.click('.pc:has-text("Hospital Santa Exemplo")');
    await page.waitForSelector('.sh-ov.open');
    await page.click('#sheet .cq summary');
    await page.click('#sheet [data-act="copy-questions"]');
    await page.waitForSelector('#sheet .cq-txt:not([hidden])');
    const m = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const t = document.querySelector('#sheet .cq-txt');
      return { head: r('#sheet .sh-head').bottom, foot: r('#sheet .sh-foot').top, msg: r('#sheet .cq-msg'), txt: r('#sheet .cq-txt'), focused: document.activeElement === t, sel: [t.selectionStart, t.selectionEnd, t.value.length] };
    });
    assert.ok(m.msg.top >= m.head && m.msg.bottom <= m.foot,
      `${w}px: o aviso aparece inteiro entre o título e o botão fixo (${Math.round(m.msg.top)} a ${Math.round(m.msg.bottom)} px; título até ${Math.round(m.head)} px, botão a partir de ${Math.round(m.foot)} px)`);
    assert.ok(m.txt.top > m.msg.bottom && m.txt.top <= m.foot - 60, `${w}px: o quadro começa logo abaixo do aviso, na tela (${Math.round(m.txt.top)} px)`);
    assert.ok(m.focused && m.sel[0] === 0 && m.sel[1] === m.sel[2], `${w}px: o texto todo fica selecionado`);
    assert.match(await page.textContent('#sheet .cq-msg'), /^Não foi possível copiar sozinho\. As perguntas estão selecionadas no quadro abaixo/);
    const ov = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, document.querySelector('#sheet').scrollWidth - document.querySelector('#sheet').clientWidth));
    assert.ok(ov <= 0, `${w}px: sem rolagem lateral (${ov}px)`);
    await shot(page, `36-celular-${w}-sem-copiar`);
    // O Tab continua dentro da ficha com o quadro à mostra.
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest('#sheet')), `${w}px: o foco fica na ficha`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

/* ======================= L2: nome do exame escrito na busca ======================= */
// Centro de Campinas, Recife e Belo Horizonte (a geocodificação devolve a cidade); o resto é a busca de sempre (fullFn).
const CIDADE_FN = (r, b) => {
  if (b.action === 'geocode' && /Campinas/.test(b.q)) return json(r, { ok: true, lat: -22.90556, lng: -47.06083, label: 'Campinas - SP', precision: 'cidade', provider: 'osm' });
  if (b.action === 'geocode' && /Recife/.test(b.q)) return json(r, { ok: true, lat: -8.05389, lng: -34.88111, label: 'Recife - PE', precision: 'cidade', provider: 'osm' });
  if (b.action === 'geocode' && /Belo Horizonte/.test(b.q)) return json(r, { ok: true, lat: -19.91668, lng: -43.93449, label: 'Belo Horizonte - MG', precision: 'cidade', provider: 'osm' });
  return fullFn(r, b);
};
const geocodes = (log) => log.fn.filter((b) => b.action === 'geocode').map((b) => b.q);
// Espera uma condição do lado do Node (uma chamada ao servidor simulado), até 5 segundos.
async function until(cond, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
}
// Celular sem rolagem lateral: a largura da janela continua a da tela (com isMobile, o que transborda aumentaria o
// innerWidth) e nada passa dela.
const semRolagemLateral = (page, largura) => page.evaluate((w) => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth, ok: innerWidth === w && document.documentElement.scrollWidth <= w }), largura);

await scenario('exame na busca: "ultrassom em Campinas" liga o filtro e procura só "Campinas"; o dicionário só vem no toque', async () => {
  const { page, log, errors, context } = await newPage(browser, { geo: false, fn: CIDADE_FN });
  const pedidos = [];
  page.on('request', (r) => pedidos.push(r.url()));
  await page.goto(`${BASE}perto.html`);
  await page.waitForSelector('.st h2:has-text("Veja o que tem perto de você")');
  await page.waitForTimeout(300);
  assert.ok(!pedidos.some((u) => /exames-nomes\.js/.test(u)), 'a página abre sem o dicionário');
  assert.match(await page.textContent('.pt-hero > p'), /Dá para escrever o exame junto: “ultrassom em Campinas”\./);
  await page.fill('#q', 'ultrassom em Campinas');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => document.querySelector('#fExam').value === 'usg' && document.querySelector('#count').textContent.includes('Campinas'));
  assert.ok(pedidos.some((u) => /exames-nomes\.js/.test(u)), 'o dicionário vem quando a pessoa usa a caixa');
  assert.deepEqual(geocodes(log), ['Campinas'], 'o mapa procura só o lugar');
  const busca = log.fn.find((b) => b.action === 'search');
  assert.deepEqual([busca.lat, busca.lng], [-22.906, -47.061], 'em volta do centro de Campinas, arredondado');
  assert.match(await page.textContent('#qMsg'), /^Filtro de exame: Ultrassom\. Mostrando a partir do centro de Campinas - SP\./);
  assert.ok(await page.$eval('#qMsg', (e) => e.classList.contains('info')), 'aviso, não erro');
  assert.ok(await page.$eval('#fExam', (e) => e.parentElement.classList.contains('on')), 'o filtro aparece ligado');
  await page.waitForFunction(() => !document.querySelector('.pt-pager-busy'));
  assert.ok(log.cnes.some((b) => b.p_exam === 'usg') || log.points.some((p) => p.body.p_exam === 'usg'), 'a área inteira é buscada com o exame');
  await shot(page, '42-exame-na-busca');
  // Texto com erro de digitação e o lugar antes do exame.
  await page.fill('#q', 'Campinas resonancia');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => document.querySelector('#fExam').value === 'rm');
  assert.deepEqual(geocodes(log), ['Campinas', 'Campinas']);
  assert.match(await page.textContent('#qMsg'), /^Filtro de exame: Ressonância \(você escreveu “resonancia”\)\./);
  // Só o lugar: o filtro escolhido continua, e o texto vai inteiro para o mapa (como antes).
  await page.fill('#q', 'Rua Augusta, 900');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => document.querySelector('#qMsg').hidden || /Não encontramos/.test(document.querySelector('#qMsg').textContent));
  await until(() => geocodes(log).length === 3);
  assert.equal(geocodes(log)[2], 'Rua Augusta, 900');
  assert.equal(await page.inputValue('#fExam'), 'rm');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('exame na busca: só o exame ("hemograma") liga o filtro na área da tela, com o aviso do laboratório e sem o preço geral', async () => {
  // Um laboratório parceiro que informou um preço geral de laboratório (não o do hemograma).
  const LAB = { ...PARTNER_ROWS[1], id: 'bbbbbbbb-0000-4000-8000-000000000013', name: 'Laboratório Parceiro Verificado', kind: 'laboratorio', distance_m: 500, exams: [{ code: 'lab', price_cents: 2500 }], insurances: [] };
  const fn = (r, b) => (b.action === 'search' ? json(r, { ok: true, provider: 'osm', radius_m: b.radius_m, warnings: [], imed: [...PARTNER_ROWS, LAB], cnes: CNES_ROWS, places: [], coverage: { status: 'done', city: 'São Paulo', uf: 'SP' } }) : CIDADE_FN(r, b));
  const { page, log, errors, context } = await newPage(browser, { fn });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  const antes = log.fn.length;
  await page.fill('#q', 'hemograma');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => document.querySelector('#fExam').value === 'lab');
  assert.equal(log.fn.length, antes, 'nada de geocodificação: a área continua a da localização');
  assert.equal(await page.textContent('#qMsg'), 'Você buscou “hemograma”: a lista mostra os laboratórios. Confirme se o local faz este exame.');
  await page.waitForFunction(() => /Laboratório Análise Paulista/.test(document.querySelector('#list').textContent));
  assert.deepEqual(await names(page), ['Laboratório Parceiro Verificado', 'Laboratório Análise Paulista']);
  const nota = await page.textContent('#list .pt-note:has-text("laboratório")');
  assert.match(nota, /Você buscou “hemograma”: a lista mostra os laboratórios\. O IMED não sabe quais exames cada laboratório faz: confirme se o local faz este exame\./);
  // O preço que o parceiro informou é o geral do laboratório: não aparece ao lado do hemograma.
  assert.ok(!/R\$/.test(await page.textContent('#list')), 'sem o preço geral do laboratório na lista');
  assert.match(await page.textContent('.pc:has-text("Laboratório Parceiro Verificado") .pc-price'), /^Preço do exame sob consulta$/);
  assert.match(await page.textContent('#priceBand'), /O preço de cada exame de laboratório não está no IMED: confirme com o laboratório\./);
  assert.match(await page.textContent('#count'), /da sua localização/);
  await shot(page, '43-exame-so-laboratorio');
  // Exame trocado na lista de filtros: o nome escrito sai do aviso, e o preço geral do laboratório volta.
  await page.selectOption('#fExam', '');
  await page.selectOption('#fExam', 'lab');
  assert.match(await page.textContent('#list .pt-note:has-text("laboratório")'), /^O IMED não sabe quais exames cada laboratório faz: confirme se o local faz este exame\.$/);
  await page.waitForFunction(() => /^Exames de laboratório: R\$\s?25$/.test(document.querySelector('.pc-price')?.textContent || ''));
  // Doença ou substância não é chamada de exame: a frase diz só o que foi buscado.
  for (const q of ['T3', 'colesterol', 'insulina']) {
    await page.fill('#q', q);
    await page.press('#q', 'Enter');
    await page.waitForFunction((x) => document.querySelector('#qMsg').textContent.startsWith(`Você buscou “${x}”`), q);
    assert.ok(!/é exame de laboratório/.test(await page.textContent('#qMsg')), q);
  }
  // Apelido: "USG" é o ultrassom.
  await page.fill('#q', 'USG');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => document.querySelector('#fExam').value === 'usg');
  assert.equal(await page.textContent('#qMsg'), 'Filtro de exame: Ultrassom (também chamado de USG).');
  // Exame específico de imagem: o IMED também não sabe quais locais fazem.
  await page.fill('#q', 'doppler');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => /Doppler/.test(document.querySelector('#qMsg').textContent));
  assert.equal(await page.textContent('#qMsg'), 'Filtro de exame: Ultrassom (Doppler). Confirme se o local faz este exame.');
  assert.equal(log.fn.filter((b) => b.action === 'geocode').length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('exame na busca: "eco" mostra as duas opções (ecocardiograma ou ultrassom) e não escolhe sozinho, nem com dois Enter', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: CIDADE_FN });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  await page.fill('#q', 'eco');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#qEsc:not([hidden]) button');
  assert.equal(await page.textContent('#qEscT'), '“eco” pode ser:');
  assert.deepEqual(await page.$$eval('#qEsc button', (els) => els.map((e) => e.textContent)), ['Ecocardiograma', 'Ultrassom']);
  assert.equal(await page.getAttribute('#qEsc', 'role'), 'group');
  assert.equal(await page.getAttribute('#qEsc', 'aria-labelledby'), 'qEscT');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'qEscT', 'o foco vai para a pergunta, não para uma opção');
  // Dois Enter seguidos (toque duplo, tremor): o segundo não escolhe.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.equal(await page.inputValue('#fExam'), '', 'nenhum exame escolhido sozinho');
  assert.ok(await page.isVisible('#qEsc button'));
  assert.equal(log.fn.filter((b) => b.action === 'geocode').length, 0);
  const alvos = await page.$$eval('#qEsc button', (els) => els.map((e) => e.getBoundingClientRect().height));
  assert.ok(alvos.every((h) => h >= 44), `alvos de toque de 44 px (${alvos.join(', ')})`);
  await shot(page, '44-eco-duas-opcoes');
  // Teclado: Tab para a primeira opção, Tab para a segunda e Enter.
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Ecocardiograma');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#fExam').value === 'usg');
  assert.ok(await page.isHidden('#qEsc'));
  assert.equal(await page.textContent('#qMsg'), 'Filtro de exame: Ultrassom.');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'q', 'pelo teclado, o foco volta para a caixa de busca');
  // Com o lugar: procura o lugar e deixa as duas opções à mostra.
  await page.fill('#q', 'eco em Recife');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#qEsc:not([hidden]) button');
  await until(() => log.fn.some((b) => b.action === 'geocode'));
  assert.deepEqual(log.fn.filter((b) => b.action === 'geocode').map((b) => b.q), ['Recife']);
  await page.waitForFunction(() => /Recife/.test(document.querySelector('#count').textContent));
  assert.equal(await page.inputValue('#fExam'), 'usg', 'o filtro de antes continua até a pessoa escolher');
  await page.click('#qEsc button:has-text("Ecocardiograma")');
  await page.waitForFunction(() => document.querySelector('#fExam').value === 'eco');
  assert.ok(await page.isHidden('#qEsc'));
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'qMsg', 'pelo clique, o foco vai para o aviso');
  // "ecocardiograma com doppler" é um exame só: nada de perguntar.
  await page.fill('#q', 'ecocardiograma com doppler');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => /Ecocardiograma/.test(document.querySelector('#qMsg').textContent));
  assert.ok(await page.isHidden('#qEsc'));
  assert.equal(await page.inputValue('#fExam'), 'eco');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('exame na busca: o que sobra do nome do exame nunca vai para o mapa; sigla de cidade e endereço de Goiânia', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: CIDADE_FN });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  // Detalhes do exame: filtro ligado, a área da localização e nenhuma geocodificação.
  for (const [q, k] of [['glicemia em jejum', 'lab'], ['raio x panorâmico', 'rx'], ['Doppler venoso de membros inferiores', 'usg'], ['Raio-X de tórax (PA e perfil)', 'rx'], ['ultrassom 3D', 'usg'], ['teste rápido de HIV', 'lab']]) {
    await page.fill('#q', q);
    await page.press('#q', 'Enter');
    await page.waitForFunction((x) => document.querySelector('#fExam').value === x && !document.querySelector('#qMsg').hidden, k);
    assert.ok(await page.$eval('#qMsg', (e) => e.classList.contains('info')), `${q}: aviso, não erro`);
    assert.equal(log.fn.filter((b) => b.action === 'geocode').length, 0, `${q}: nada vai para o mapa`);
    await page.selectOption('#fExam', '');
  }
  // Sem o "em", um lugar que não é cidade do IMED fica de fora, com a dica.
  await page.fill('#q', 'ultrassom Braço do Norte');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => document.querySelector('#fExam').value === 'usg');
  assert.equal(await page.textContent('#qMsg'), 'Filtro de exame: Ultrassom. Para buscar em outra cidade, escreva “em” antes do nome dela, por exemplo “ultrassom em Campinas”.');
  assert.equal(log.fn.filter((b) => b.action === 'geocode').length, 0);
  // O lugar é só o que vem depois do "em"; sigla de cidade vira o nome (o servidor só procura com 3 letras ou mais).
  await page.fill('#q', 'ressonância pelo SUS em Campinas');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => document.querySelector('#fExam').value === 'rm' && /Campinas/.test(document.querySelector('#count').textContent));
  await page.fill('#q', 'ressonância em BH');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => /Belo Horizonte/.test(document.querySelector('#count').textContent));
  assert.ok(!/Digite um CEP/.test(await page.textContent('#qMsg')));
  assert.deepEqual(geocodes(log), ['Campinas', 'Belo Horizonte, MG']);
  // Avenida de Goiânia: endereço, não exame (T-4 não é o exame T4).
  await page.selectOption('#fExam', '');
  await page.fill('#q', 'Goiânia, Av. T-4');
  await page.press('#q', 'Enter');
  await until(() => geocodes(log).length === 3);
  assert.equal(geocodes(log)[2], 'Goiânia, Av. T-4');
  assert.equal(await page.inputValue('#fExam'), '', 'nenhum filtro de exame');
  await shot(page, '47-exame-sobra-fora');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('exame na busca: doença sozinha ("dengue") pergunta se é o exame ou atendimento', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: CIDADE_FN });
  await page.goto(`${BASE}perto.html?usar=localizacao`);
  await ready(page);
  await page.fill('#q', 'dengue');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#qEsc:not([hidden]) button');
  assert.equal(await page.textContent('#qEscT'), '“dengue”: você procura o exame ou atendimento?');
  assert.deepEqual(await page.$$eval('#qEsc button', (els) => els.map((e) => e.textContent)), ['Exame (laboratórios)', 'Atendimento (todos os locais)']);
  assert.equal(await page.inputValue('#fExam'), '', 'nada escolhido sozinho: hospitais e UPAs continuam na lista');
  await shot(page, '48-dengue-exame-ou-atendimento');
  await page.click('#qEsc button:has-text("Atendimento")');
  await page.waitForFunction(() => /todos os locais/.test(document.querySelector('#qMsg').textContent));
  assert.equal(await page.inputValue('#fExam'), '');
  await page.fill('#q', 'HIV');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#qEsc:not([hidden]) button');
  await page.click('#qEsc button:has-text("Exame")');
  await page.waitForFunction(() => document.querySelector('#fExam').value === 'lab');
  assert.equal(await page.textContent('#qMsg'), 'Você buscou “HIV”: a lista mostra os laboratórios. Confirme se o local faz este exame.');
  // Com "exame de", não pergunta.
  await page.selectOption('#fExam', '');
  await page.fill('#q', 'exame de dengue');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => document.querySelector('#fExam').value === 'lab');
  assert.ok(await page.isHidden('#qEsc'));
  assert.equal(log.fn.filter((b) => b.action === 'geocode').length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('exame na busca: "Buscando…" desde o Enter, mesmo com o dicionário demorando (e sem ele, o texto vai inteiro)', async () => {
  const { page, log, errors, context } = await newPage(browser, { geo: false, fn: CIDADE_FN });
  // Dicionário lento (2 s): o endereço não espera mais que 1 s.
  await context.route(`${BASE}assets/js/exames-nomes.js`, async (route) => { await new Promise((r) => setTimeout(r, 2000)); return route.continue(); });
  await page.goto(`${BASE}perto.html`);
  await page.waitForSelector('.st h2:has-text("Veja o que tem perto de você")');
  await page.fill('#q', 'Rua Augusta, 900');
  const t0 = Date.now();
  await page.press('#q', 'Enter');
  assert.equal(await page.textContent('#goBtn'), 'Buscando…', 'o botão mostra a espera desde o Enter');
  assert.ok(await page.$eval('#goBtn', (b) => b.disabled));
  await until(() => geocodes(log).length === 1, 4000);
  const ms = Date.now() - t0;
  assert.ok(ms < 1800, `a busca sai em até ~1 s (${ms} ms)`);
  assert.deepEqual(geocodes(log), ['Rua Augusta, 900']);
  await page.waitForFunction(() => document.querySelector('#goBtn').textContent === 'Buscar');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('exame na busca: o lugar escrito na página inicial chega pelo ?onde= (cidade) ou guardado na aba (com número)', async () => {
  const { page, log, errors, context } = await newPage(browser, { fn: CIDADE_FN });
  // A localização está liberada, mas a pessoa escreveu Campinas: a busca vai para Campinas, não para a localização.
  await page.goto(`${BASE}perto.html?exame=rm&onde=Campinas`);
  await page.waitForFunction(() => /Campinas/.test(document.querySelector('#count').textContent));
  assert.deepEqual(geocodes(log), ['Campinas']);
  assert.equal(await page.inputValue('#fExam'), 'rm');
  assert.equal(await page.inputValue('#q'), 'Campinas');
  assert.equal(new URL(page.url()).search, '?exame=rm', 'o ?onde= sai do endereço depois de lido');
  assert.ok(!log.fn.some((b) => b.action === 'search' && Math.abs(b.lat + 23.56) < 0.01), 'a localização do aparelho não foi usada');
  // Endereço com número: guardado só na aba pela página inicial, lido uma vez e apagado.
  await page.evaluate(() => sessionStorage.setItem('imed_onde', '01310-100'));
  await page.goto(`${BASE}perto.html?exame=lab`);
  await until(() => geocodes(log).length === 2);
  assert.equal(geocodes(log)[1], '01310-100');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('imed_onde')), null);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('exame na busca no celular (360 px): as opções do "eco" e os avisos cabem, sem rolagem lateral', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, viewport: { width: 360, height: 780 }, geo: false, fn: CIDADE_FN });
  await page.goto(`${BASE}perto.html`);
  await page.fill('#q', 'eco');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#qEsc:not([hidden]) button');
  const m1 = await semRolagemLateral(page, 360);
  assert.ok(m1.ok, `sem rolagem lateral (${JSON.stringify(m1)})`);
  const caixas = await page.$$eval('#qEsc button', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.right, r.height]; }));
  assert.ok(caixas.every(([l, r, h]) => l >= 0 && r <= 360 && h >= 44), JSON.stringify(caixas));
  await shot(page, '45-eco-celular-360');
  // Toque na opção: o filtro liga e o foco vai para o aviso (o teclado do celular não reabre por cima da lista).
  await page.tap('#qEsc button:has-text("Ultrassom")');
  await page.waitForFunction(() => document.querySelector('#fExam').value === 'usg');
  assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'q', 'o toque não leva o foco de volta para a caixa');
  // Só o exame, sem localização liberada: o filtro liga e o site pede a localização (sem ela, explica e espera o CEP).
  await page.waitForSelector('.st h2:has-text("não liberou")');
  assert.equal(await page.textContent('#qMsg'), 'Filtro de exame: Ultrassom.');
  await page.fill('#q', 'hemograma em Campinas');
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => document.querySelector('#fExam').value === 'lab' && /Campinas/.test(document.querySelector('#count').textContent));
  const m2 = await semRolagemLateral(page, 360);
  assert.ok(m2.ok, `sem rolagem lateral com o aviso (${JSON.stringify(m2)})`);
  await page.fill('#q', 'dengue');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#qEsc:not([hidden]) button');
  const m3 = await semRolagemLateral(page, 360);
  assert.ok(m3.ok, `sem rolagem lateral com a pergunta da doença (${JSON.stringify(m3)})`);
  const caixas2 = await page.$$eval('#qEsc button', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.right, r.height]; }));
  assert.ok(caixas2.every(([l, r, h]) => l >= 0 && r <= 360 && h >= 44), JSON.stringify(caixas2));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '46-hemograma-celular-360');
  assert.deepEqual(errors, []);
  await context.close();
});

// Aparelhos do CNES: o banco já devolve services com o exame do aparelho em uso (nome OU aparelho) e o site busca
// as colunas equip_* para o aviso. Nunca promete que o local faz o exame.
const EQ_ROWS = [
  { ...estRow(9001, 300, 0, 'clinica', true, 'Clínica Aparelho Teste'), services: ['rm'] },
  { ...estRow(9002, -400, 100, 'imagem', false, 'Imagem Sem Ressonância Teste'), services: ['rx', 'usg'], phone: '(11) 3000-1111' },
];
const EQ_EQUIP = { [EQ_ROWS[0].cnes]: { equip_exams: ['rm'], equip_exams_sus: ['rm'], equip_competencia: '2026-09-01' } };
const eqFn = (r, b) => (b.action !== 'search' ? defaultFn(r, b) : json(r, { ok: true, provider: 'osm', radius_m: b.radius_m, warnings: [], imed: [],
  cnes: pageOf(areaRows(EQ_ROWS, { p_lat: b.lat, p_lng: b.lng, p_radius_m: b.radius_m }), 0, 250), places: [], coverage: { status: 'done', city: 'São Paulo', uf: 'SP' } }));
const eqRest = (route, u) => {
  if (!u.pathname.endsWith('/establishments')) return json(route, []);
  const ids = (u.searchParams.get('cnes') ?? '').replace(/^in\.\(|\)$/g, '').replace(/^eq\./, '').split(',');
  return json(route, ids.filter((c) => EQ_EQUIP[c]).map((c) => ({ cnes: c, ...EQ_EQUIP[c] })));
};

await scenario('aparelhos do CNES: ressonância pelo aparelho em uso, com o aviso para confirmar', async () => {
  const { page, context, log, errors } = await newPage(browser, { fn: eqFn, data: EQ_ROWS, rest: eqRest, rpc: (r) => json(r, []) });
  await page.goto(`${BASE}perto.html?usar=localizacao&exame=rm`);
  await page.waitForSelector('.pc-equip');
  assert.deepEqual(await names(page), ['Clínica Aparelho Teste']);
  assert.equal((await page.textContent('.pc-equip')).trim(), 'Tem aparelho de ressonância em uso (cadastro oficial). Confirme com o local.');
  assert.match(await cardSpeech(page, '.pc'), /Confirme com o local/);
  assert.ok(log.rest.some((r) => r.startsWith('establishments?select=cnes,equip_exams')), 'busca os aparelhos dos locais na tela');
  assert.ok(!/faz (o|a) (exame|ressonância)/i.test(await page.textContent('#list')), 'não promete o exame');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('aparelhos do CNES: nenhum local com o exame mostra os centros de imagem perto para ligar e confirmar', async () => {
  const { page, context, errors } = await newPage(browser, { fn: eqFn, data: EQ_ROWS, rest: eqRest, rpc: (r) => json(r, []) });
  await page.goto(`${BASE}perto.html?usar=localizacao&exame=mamo`);
  await page.waitForSelector('[data-near] .eq-near li');
  const st = await page.textContent('.st');
  assert.match(st, /Nenhum local com esse exame aqui/);
  assert.match(st, /Ligue e confirme se fazem o exame/);
  assert.match(st, /Imagem Sem Ressonância Teste/);
  assert.ok(!/Clínica Aparelho Teste/.test(st), 'só centros de diagnóstico por imagem');
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
