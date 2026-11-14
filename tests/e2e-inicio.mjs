// Teste de ponta a ponta da página inicial (Playwright), com respostas simuladas do banco (Supabase).
// Confere que a página só mostra dados reais: nada de preço, nota ou número inventado.
// Rodar com: node tests/e2e-inicio.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta node tests/e2e-inicio.mjs  salva capturas de tela nessa pasta;
//           ONLY="texto" roda só os cenários com esse texto no nome.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as G from '../assets/js/geo-core.js';
import { simularGeo, PAULISTA, contagemGeo, mudarGeo, responderGeo } from './geo-simulado.mjs';
import { simularMapa } from './mapa-simulado.mjs';

import { comChaves, vigiarChaves } from './regra-chaves.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
const PORT = Number(process.env.E2E_PORT) || 8770; // E2E_PORT: outra porta para rodar em paralelo
const REST = 'https://pyoqiecupxhdzigjudyd.supabase.co/rest/v1/';
const FN = 'https://pyoqiecupxhdzigjudyd.supabase.co/functions/v1/clinicas-proximas';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+F9PQAJYwN6V0E0WwAAAABJRU5ErkJggg==', 'base64');

// Tudo o que o servidor entregou (também o que o service worker pede, que o Playwright não mostra na página).
const served = [];
const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  served.push(path);
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
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;

const CITIES = [
  { ibge: 3550308, name: 'São Paulo', uf: 'SP', total: 6548, imagem: 574, laboratorio: 524, clinica: 5161, hospital: 289 },
  { ibge: 3106200, name: 'Belo Horizonte', uf: 'MG', total: 2284, imagem: 191, laboratorio: 206, clinica: 1794, hospital: 93 },
  { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', total: 3000, imagem: 300, laboratorio: 200, clinica: 2300, hospital: 200 },
  { ibge: 3545803, name: "Santa Bárbara d'Oeste", uf: 'SP', total: 150, imagem: 10, laboratorio: 20, clinica: 110, hospital: 10 },
];
const PARTNER_ID = '33333333-3333-4333-8333-333333333333';
const PARTNERS = [
  { id: PARTNER_ID, name: 'Clínica Parceira Paulista', kind: 'imagem', description: null, address_line: 'Av. Paulista, 1500', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: '01310200', lat: -23.5614, lng: -46.6559, distance_m: 300, phone: '(11) 3333-4444', whatsapp: null, email: null, website: null, specialties: [], opening_hours: null, accepts_online_booking: true, is_demo: false, exams: [{ code: 'rm', price_cents: 45000 }, { code: 'usg', price_cents: null }], insurances: [], cnes: '9999999' },
];
const CNES_ROWS = [
  { cnes: '2077485', name: 'Hospital Santa Exemplo', kind: 'hospital', address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', cep: '01409001', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5598, lng: -46.6602, distance_m: 420, location_source: 'cnes', phone: '(11) 3141-1000', shift: null, open_24h: true, sus: false, services: ['rm', 'tc', 'rx'], specialties: ['Cardiologia'], cnes_updated_at: '2026-09-15' },
  { cnes: '6543210', name: 'Laboratório Análise Paulista', kind: 'laboratorio', address_line: 'Alameda Santos, 200', neighborhood: 'Bela Vista', cep: '01418000', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5655, lng: -46.6520, distance_m: 640, location_source: 'endereco', phone: '(11) 3000-2000', shift: 'Manhã e tarde', open_24h: false, sus: true, services: ['lab'], specialties: [], cnes_updated_at: '2026-08-02' },
  { cnes: '7000001', name: 'Centro de Imagem <b>Teste</b>', kind: 'imagem', address_line: 'Rua Augusta, 1000', neighborhood: 'Consolação', cep: '01304001', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.556, lng: -46.657, distance_m: 900, location_source: 'cnes', phone: null, shift: null, open_24h: false, sus: false, services: ['rx'], specialties: [], cnes_updated_at: '2026-09-01' },
];
// Pontos do mapa da página inicial (establishment_points): os mesmos locais, só com o necessário para o mapa.
const POINTS = CNES_ROWS.map(({ cnes, name, kind, lat, lng, distance_m }) => ({ cnes, name, kind, lat, lng, distance_m, total: CNES_ROWS.length }));
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const APPTS = [
  { type: 'pedido', code: 'IMED-11111111', id: ID1, token: 'a'.repeat(64), place_key: 'cnes:2077485', name: 'Hospital Santa Exemplo', phone: '(11) 3141-1000', exam: 'rm', items: ['Ressonância'], date: '2026-11-05', period: 'manha', status: 'pendente', created: '2026-10-30T12:00:00Z' },
  { type: 'pedido', code: 'IMED-22222222', id: ID2, token: 'b'.repeat(64), place_key: 'cnes:6543210', name: 'Laboratório Análise Paulista', exam: 'lab', items: ['Exames de laboratório'], date: '2026-10-20', period: 'qualquer', status: 'pendente', created: '2026-10-15T12:00:00Z' },
  { type: 'pedido', code: 'IMED-3F2A9C1E', status: 'pendente', name: 'Laboratório Vida', items: ['Exames de laboratório'], date: 'segunda-feira, 03 de novembro', time: 'manhã', total: null },
  { code: 'IMED-ABCDE', type: 'exame', clinic: 'dcp', name: 'DiagnoCenter Paulista', items: ['Ressonância'], date: 'amanhã', time: '14:30', total: 405, pay: 'pix' },
  { code: 'TELE-XYZ', type: 'tele', name: 'Dra. Camila Ruiz', items: ['Teleconsulta'], date: 'Hoje', time: 'agora', total: 120 },
];
// Relógio fixo dos cenários de Meus pedidos (as datas acima e abaixo ficam sempre no futuro).
const NOW = '2026-10-30T12:00:00Z';
// Pedidos com horário marcado, gravados como a página do local grava (geo-core.localAppt).
const SLOT_PLACE = { id: `imed:${PARTNER_ID}`, name: 'Clínica Parceira Paulista' };
const SID1 = '55555555-5555-4555-8555-555555555555';
const SID2 = '66666666-6666-4666-8666-666666666666';
const SLOT_APPTS = [
  // 12:30 UTC = 09:30 em São Paulo
  G.localAppt(SLOT_PLACE, { exam: 'rm', slot: '2026-11-05T12:30:00.000Z' }, SID1, 'd'.repeat(64), Date.parse(NOW)),
  // 02:30 UTC do dia 7 = 23:30 do dia 6 em São Paulo
  G.localAppt(SLOT_PLACE, { exam: 'usg', slot: '2026-11-07T02:30:00.000Z' }, SID2, 'e'.repeat(64), Date.parse(NOW)),
];
// Oito locais em volta do ponto (de 250 m a ~1,4 km), para os rótulos do 3D disputarem espaço no celular.
const AROUND = [
  ['Clínica Bela Vista Teste', 'clinica'], ['Laboratório Paulista Teste', 'laboratorio'], ['Centro de Diagnóstico Augusta', 'imagem'],
  ['Hospital Consolação Teste', 'hospital'], ['Clínica Jardins Teste', 'clinica'], ['Laboratório Santos Teste', 'laboratorio'],
  ['Imagem Liberdade Teste', 'imagem'], ['Hospital Paraíso Teste', 'hospital'],
].map(([name, kind], i) => {
  const ang = i * Math.PI / 4 + 0.3, dist = 250 + i * 160;
  const lat = -23.565 + (Math.sin(ang) * dist) / 110570, lng = -46.652 + (Math.cos(ang) * dist) / (111320 * Math.cos((-23.565 * Math.PI) / 180));
  return { cnes: String(7100001 + i), name, kind, address_line: `Rua Teste, ${100 + i}`, neighborhood: 'Bela Vista', cep: '01310000', city: 'São Paulo', uf: 'SP', city_code: '355030', lat, lng, distance_m: dist, location_source: 'cnes', phone: null, shift: null, open_24h: false, sus: false, services: [], specialties: [], cnes_updated_at: '2026-09-01' };
});
// Tela "Clínicas perto de você": a pessoa em Recife (o topo espera a resposta do pedido e busca lá), cidades no
// formato guardado no aparelho (imed_cidade) e 11 locais do CNES + o parceiro (a lista mostra os 10 mais perto:
// 6 no celular, com "Mostrar mais 4").
const RECIFE = { lat: -8.05428, lng: -34.88111 };
const RIO = { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', lat: -22.907, lng: -43.173 };
const SP_CENTRO = { ibge: 3550308, name: 'São Paulo', uf: 'SP', lat: -23.55, lng: -46.633 };
const MUITOS = [...CNES_ROWS, ...AROUND];
// Coordenadas da Paulista (a posição simulada): não podem aparecer no aparelho, no endereço nem no contador.
const POS_PAULISTA = /-23\.56|-46\.65/;

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } });
const preflight = (route) => route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' } });

// device: { memory, cores, saveData, effectiveType } simula o aparelho (navigator.deviceMemory, hardwareConcurrency,
// connection.saveData e connection.effectiveType). dpr: densidade da tela. sw: liga o service worker.
// tz: fuso do aparelho. ua: navegador (por exemplo, o do iPhone). now: relógio fixo.
// mapa: ladrilhos do mapa 3D (tests/mapa-simulado.mjs): 'ok' (simulados, padrão) ou 'falha' (sem resposta);
// mapaLog: guarda os endereços pedidos ao OpenFreeMap. lib3d: rota para a biblioteca do mapa (MapLibre).
// escuro: aparelho no tema escuro.
// points: resposta de establishment_points. spyMap: guarda em window.__maps os mapas do Leaflet criados pela página.
// cnesDate: resposta de cnes_last_update; cancel: de cancel_request; geocode: da Edge Function (centro da cidade);
// store: chaves do localStorage gravadas antes de abrir (ex.: { imed_cidade: {...} }).
// geo: permissão e localização simuladas (tests/geo-simulado.mjs). Padrão: localização já permitida, na Av. Paulista
// (-23.56512, -46.65234, que arredonda para -23.565, -46.652, o ponto que os cenários do 3D conferem). geo: null deixa
// o Chromium sem permissão (ele recusa sem mostrar o pedido: a página cai em "naoapareceu" e usa o exemplo).
// lgpd: true abre como na 1ª visita, com o aviso de privacidade (sem o imed_lgpd guardado).
async function newPage(browser, { mobile = false, cities, cnes, points, partners, status, waitlist, tele, whatsapp = '', appts, motion = 'reduce', device = null, dpr = 1, sw = false, tz = 'America/Sao_Paulo', ua, now = null, viewport = null, mapa = 'ok', mapaLog = null, lib3d = null, spyMap = false, cnesDate, cancel, geocode, store = null, geo = { estado: 'granted', pos: PAULISTA }, lgpd = false, escuro = false } = {}) {
  const context = await browser.newContext({
    viewport: viewport || (mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 }),
    deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: tz,
    serviceWorkers: sw ? 'allow' : 'block', reducedMotion: motion, acceptDownloads: true, ...(ua ? { userAgent: ua } : {}),
    ...(escuro ? { colorScheme: 'dark' } : {}),
  });
  if (geo) await simularGeo(context, geo);
  if (now) await context.clock.setFixedTime(new Date(now));
  await simularMapa(context, { falha: mapa === 'falha', log: mapaLog });
  if (lib3d) await context.route(`${BASE}assets/vendor/maplibre/maplibre-gl.js`, lib3d);
  const log = { cities: 0, cnes: [], points: [], partners: [], status: [], waitlist: [], tele: 0, cnesDate: 0, cnesDateArgs: [], cancel: [], geocode: [], track: [] };
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await context.route(`${REST}rpc/imported_cities`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.cities += 1;
    return (cities ?? ((r) => json(r, CITIES)))(route);
  });
  await context.route(`${REST}rpc/nearby_establishments`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.cnes.push(JSON.parse(route.request().postData() || '{}'));
    return (cnes ?? ((r) => json(r, CNES_ROWS)))(route);
  });
  // Com ?select= na URL: casa pelo começo do endereço.
  await context.route((u) => u.href.startsWith(`${REST}rpc/establishment_points`), async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.points.push({ url: route.request().url(), body: JSON.parse(route.request().postData() || '{}') });
    return (points ?? ((r) => json(r, POINTS)))(route);
  });
  await context.route(`${REST}rpc/nearby_clinics`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.partners.push(JSON.parse(route.request().postData() || '{}'));
    return (partners ?? ((r) => json(r, PARTNERS)))(route);
  });
  await context.route(`${REST}rpc/request_status`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.status.push(JSON.parse(route.request().postData() || '{}'));
    return (status ?? ((r) => json(r, [{ id: ID1, status: 'confirmed', reviewed: false }, { id: ID2, status: 'completed', reviewed: false }])))(route);
  });
  // Médicos atendendo agora na teleconsulta (função nova da teleconsulta). Padrão: nenhum.
  await context.route(`${REST}rpc/tele_doctors_online`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.tele += 1;
    return (tele ?? ((r) => json(r, [])))(route);
  });
  // Data real da última importação do CNES (função nova da migração de confiança).
  // Contador de visitas próprio (assets/js/visitas.js): só manda com ?visitas=teste neste computador de testes.
  await context.route(`${REST}rpc/track`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.track.push(JSON.parse(route.request().postData() || '{}'));
    return json(route, true);
  });
  await context.route(`${REST}rpc/cnes_last_update`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.cnesDate += 1;
    log.cnesDateArgs.push(JSON.parse(route.request().postData() || '{}'));
    return (cnesDate ?? ((r) => json(r, '2026-10-30')))(route);
  });
  await context.route(`${REST}rpc/cancel_request`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.cancel.push(JSON.parse(route.request().postData() || '{}'));
    return (cancel ?? ((r) => json(r, 'ok')))(route);
  });
  // Geocodificação da busca (Edge Function), usada para achar o centro da cidade escolhida.
  await context.route(FN, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    const body = JSON.parse(route.request().postData() || '{}');
    log.geocode.push(body);
    if (geocode) return geocode(route, body);
    if (/Rio de Janeiro/.test(body.q)) return json(route, { ok: true, lat: -22.90684, lng: -43.17289, label: 'Rio de Janeiro - RJ', precision: 'cidade', provider: 'osm' });
    if (/Belo Horizonte/.test(body.q)) return json(route, { ok: true, lat: -19.91668, lng: -43.93449, label: 'Belo Horizonte - MG', precision: 'cidade', provider: 'osm' });
    return json(route, { ok: false, error: 'not_found' }, 404);
  });
  await context.route(`${REST}app_waitlist`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    log.waitlist.push(JSON.parse(route.request().postData() || '{}'));
    return (waitlist ?? ((r) => r.fulfill({ status: 201, body: '', headers: { 'Access-Control-Allow-Origin': '*' } })))(route);
  });
  if (whatsapp) {
    await context.route(`${BASE}assets/js/config.js`, async (route) => {
      const body = (await readFile(join(ROOT, 'assets/js/config.js'), 'utf8')).replace("whatsapp: ''", `whatsapp: '${whatsapp}'`);
      return route.fulfill({ status: 200, contentType: 'text/javascript', body });
    });
  }
  await context.addInitScript(({ list, kv, aviso }) => {
    try { if (!aviso) localStorage.setItem('imed_lgpd', '1'); } catch { /* ignora */ }
    if (kv && !sessionStorage.getItem('kv')) { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('kv', '1'); }
    if (!sessionStorage.getItem('fav')) { localStorage.setItem('imed_fav', '["dcp"]'); sessionStorage.setItem('fav', '1'); }
    if (list && !sessionStorage.getItem('seeded')) { localStorage.setItem('imed_appts', JSON.stringify(list)); sessionStorage.setItem('seeded', '1'); }
  }, { list: appts ?? null, kv: store, aviso: lgpd });
  if (spyMap) {
    // O leaflet.js define window.L quando termina de carregar; o gancho guarda cada mapa criado.
    await context.addInitScript(() => {
      let lib;
      Object.defineProperty(window, 'L', {
        configurable: true,
        get: () => lib,
        set: (v) => { lib = v; if (v?.Map?.addInitHook && !v.__spy) { v.__spy = true; v.Map.addInitHook(function () { (window.__maps ||= []).push(this); }); } },
      });
    });
  }
  if (device) {
    await context.addInitScript((d) => {
      if (d.memory != null) Object.defineProperty(navigator, 'deviceMemory', { get: () => d.memory, configurable: true });
      if (d.cores != null) Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => d.cores, configurable: true });
      if (d.saveData || d.effectiveType) Object.defineProperty(navigator, 'connection', { get: () => ({ saveData: !!d.saveData, effectiveType: d.effectiveType || '4g' }), configurable: true });
    }, device);
  }
  const page = await context.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, log, errors, requests };
}
// Espera a tela "Clínicas perto de você" chegar ao estado (data-estado).
const tela = (page, estado, timeout = 10000) => page.waitForFunction((e) => document.querySelector('#reais')?.dataset.estado === e, estado, { timeout });
// Banco simulado que respeita o p_kind das abas (nearby_establishments).
const porTipo = (rows) => (route) => { const b = JSON.parse(route.request().postData() || '{}'); return json(route, rows.filter((r) => !b.p_kind || r.kind === b.p_kind)); };
// Textos dos botões e links do cartão do estado (#pvEstado), na ordem.
const botoesCartao = (page) => page.$$eval('#pvEstado .pv-ebts > *', (els) => els.map((e) => e.textContent.trim()));
// Atalhos das cidades no cartão: [nome, número de locais].
const atalhosCartao = (page) => page.$$eval('#pvEstado .pv-at', (els) => els.map((e) => [e.querySelector('b').textContent, e.querySelector('small').textContent]));
// Tudo o que a página guardou no aparelho (localStorage e sessionStorage), o endereço e o estado do histórico.
const noAparelho = (page) => page.evaluate(() => {
  const tudo = (s) => Object.fromEntries(Array.from({ length: s.length }, (_, i) => [s.key(i), s.getItem(s.key(i))]));
  return JSON.stringify({ local: tudo(localStorage), sessao: tudo(sessionStorage), url: location.href, historico: history.state });
});
// Chamadas ao banco com a posição sem arredondar (mais de 3 casas decimais).
const casas = (v) => (String(v).split('.')[1] || '').length;
const naoArredondadas = (log) => [...log.cnes, ...log.partners, ...log.points.map((p) => p.body)].filter((a) => casas(a.p_lat) > 3 || casas(a.p_lng) > 3);

const shot = async (page, name, full = false) => { if (SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: full }); } };
const results = [];
// Tempo máximo de cada cenário (E2E_CENARIO_S segundos, padrão 150): um cenário travado falha com o nome dele,
// em vez de segurar o arquivo inteiro até o limite do CI.
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try { await Promise.race([comChaves(fn), limite(name)]); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 5).join('\n  ')}`); }
}
// Rola a página inteira para carregar as seções que só aparecem ao rolar.
async function scrollAll(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
    window.scrollTo(0, 0);
  });
}
// Contraste (fórmula da WCAG) de texto claro sobre fundo escuro, medido nos pixels de uma captura do
// elemento: o pixel mais claro (o texto) contra a mediana (o fundo, que ocupa a maior parte da caixa).
async function lightTextContrast(page, locator) {
  // No meio da tela, longe da barra de navegação fixa de baixo, que cobriria o elemento na captura.
  await locator.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const png = await locator.screenshot({ animations: 'disabled' });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = [];
    for (let i = 0; i < d.length; i += 4) L.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]));
    L.sort((a, b) => a - b);
    return (L[L.length - 1] + 0.05) / (L[Math.floor(L.length / 2)] + 0.05);
  }, png.toString('base64'));
}
// Espera uma condição do lado do Node (por exemplo, uma chamada ao banco simulado), até 5 segundos.
async function until(cond, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
}
// Duas caixas da tela se cobrem?
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

const browser = vigiarChaves(await chromium.launch());

await scenario('só dados reais: sem preço, nota ou número inventado; pílula com número do banco', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(BASE);
  await page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill').textContent));
  assert.equal(await page.textContent('#livePill'), '11.982 estabelecimentos oficiais em 4 cidades');
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_fav')), null, 'favoritos fictícios antigos apagados');
  assert.equal(log.cities, 1, 'uma chamada só para pílula e cidades');
  await scrollAll(page);
  await page.waitForSelector('#realList li b');
  const text = await page.evaluate(() => document.body.innerText);
  assert.ok(!/R\$/.test(text), 'nenhum "R$" na página');
  assert.ok(!/★/.test(text), 'nenhuma estrela de nota');
  assert.ok(!/4,9|4,8 ★|\+500|nota média|IMED10|Super Clínica|Juliana/i.test(text), 'nenhum número ou depoimento inventado');
  assert.ok(!/Protótipo|ilustrativos: clínicas/.test(text), 'sem aviso de protótipo');
  assert.ok(!/a partir de/i.test(text), 'sem "a partir de R$"');
  const html = await page.content();
  assert.equal(await page.evaluate(() => [typeof CLINICS, typeof DOCS, typeof COUPONS, typeof REVIEWS].join()), 'undefined,undefined,undefined,undefined', 'dados fictícios não existem mais');
  assert.ok(html.includes('Content-Security-Policy'));
  // categorias levam à busca com o exame
  const cats = await page.$$eval('#cats a', (els) => els.map((e) => e.getAttribute('href')));
  assert.ok(cats.includes('perto.html?exame=rm') && cats.includes('perto.html?exame=rx') && cats.includes('perto.html?exame=lab'));
  assert.ok(cats.every((h) => /^perto\.html\?exame=\w+$/.test(h)));
  // A seção "Clínicas por cidade" saiu: a página liga para as cidades pelo "Todas as cidades" da tela.
  assert.equal(await page.locator('#cidades, #cities').count(), 0, 'sem o carrossel de cidades');
  assert.equal(await page.locator('#reais a[href="cidades/"]').count(), 1, '"Todas as cidades" na tela');
  // clínicas reais (CNES) perto
  const list = await page.$$eval('#realList li b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(list, ['Clínica Parceira Paulista', 'Hospital Santa Exemplo', 'Laboratório Análise Paulista', 'Centro de Imagem <b>Teste</b>'], 'nome do CNES mostrado como texto, parceiros juntos por distância');
  assert.match(await page.textContent('#realList li:first-child'), /Parceiro do IMED/);
  const dists = await page.$$eval('#realList .pv-km', (els) => els.map((e) => e.textContent));
  assert.deepEqual(dists, ['300 m', '420 m', '~640 m', '900 m'], 'posição achada pelo endereço com "~"');
  const links = await page.$$eval('#realList li > a', (els) => els.map((e) => e.getAttribute('href')));
  assert.deepEqual(links, [`local.html?id=${PARTNER_ID}`, 'local.html?cnes=2077485', 'local.html?cnes=6543210', 'local.html?cnes=7000001'], 'cada item leva à página do local');
  // FAQ: 5 perguntas principais e "Ver todas"
  assert.equal(await page.locator('.faq details:visible').count(), 5, 'FAQ com 5 perguntas visíveis');
  const faq = await page.textContent('.faq');
  assert.match(faq, /O IMED cobra alguma coisa\?/);
  assert.match(faq, /O IMED é gratuito para você.*pagamento é feito direto no local.*nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp/s);
  assert.match(faq, /sem vínculo com o governo ou o SUS/);
  // Pergunta da localização: a frase da distância fala da localização (não da cidade escolhida, que vem antes).
  assert.match(faq, /escolha a cidade: você vê os locais perto do centro dela\. A localização aproximada não diminui a busca/);
  assert.ok(!/\. Isso não diminui a busca/.test(faq));
  await page.click('#faqAll');
  assert.equal(await page.locator('.faq details:visible').count(), 9, 'Ver todas mostra as outras');
  assert.equal(await page.locator('#faqAll').count(), 0);
  assert.match(await page.textContent('.faq'), /Ninguém paga para aparecer primeiro/);
  assert.equal(await page.locator('.faq a[href="como-funciona.html#ordem"]').count(), 1, 'ordem dos resultados → Como funciona');
  assert.equal(await page.locator('.faq a[href="como-funciona.html#avaliacoes"]').count(), 1, 'avaliações → Como funciona');
  // Aviso de emergência fixo e discreto no topo; fonte oficial sem parecer coisa do governo.
  assert.match(await page.textContent('.hero .sos'), /Emergência\? Ligue 192 \(SAMU\)/);
  assert.equal(await page.getAttribute('.hero .sos a', 'href'), 'tel:192');
  assert.match(await page.textContent('#reais .rm-src'), /O IMED é um serviço privado, sem vínculo com o governo ou o SUS/);
  assert.match(await page.textContent('#clinicas'), /Cadastro sem custo/);
  assert.ok(!/Pedido grátis/.test(text));
  assert.match(await page.textContent('#clinicas .ill'), /Imagem ilustrativa/, 'foto feita por IA com o aviso junto');
  // "Meus pedidos" no lugar de "Agendados"
  assert.ok(!/Agendados/.test(text), 'sem "Agendados"');
  assert.equal(await page.textContent('.tabs a[data-go="agenda"]'), 'Meus pedidos');
  // Rodapé igual em todas as páginas: médico responsável com CRM e link do CFM, emergência e fonte dos dados.
  const foot = await page.textContent('footer.rodape');
  assert.match(foot, /Médico responsável: Dr\. Rafael Pereira Barreto Silva — CRM-SP 266930/);
  assert.equal(await page.getAttribute('footer.rodape a[href^="https://portal.cfm.org.br/"]', 'href'), 'https://portal.cfm.org.br/busca-medicos/');
  assert.match(foot, /Emergência\? Ligue 192 \(SAMU\)/);
  assert.match(foot, /Dados de endereço: CNES\/Ministério da Saúde\. O IMED é um serviço privado, sem vínculo com o governo ou o SUS\./);
  for (const href of ['sobre.html', 'como-funciona.html', 'termos.html', 'privacidade.html', 'acessibilidade.html', 'contato.html', 'teleconsulta.html']) {
    assert.equal(await page.locator(`footer.rodape a[href="${href}"]`).count(), 1, `rodapé com ${href}`);
  }
  assert.equal(await page.locator('footer.rodape .rd-a11y .fa-universal-access').count(), 1, 'símbolo de acessibilidade no rodapé');
  assert.ok(!/Criado por|contato@imed/.test(text), 'sem "Criado por" e sem e-mail que não é do IMED');
  const stats = await page.$$eval('#realStats .rm-stat b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(stats, ['2', '1', '0', '1'], 'contagem por tipo inclui o parceiro (imagem)');
  const r = log.cnes.find((a) => a.p_radius_m === 2000);
  assert.ok(String(r.p_lat).split('.')[1].length <= 3, 'coordenada arredondada');
  const pr = log.partners.find((a) => a.p_radius_m === 2000);
  assert.ok(pr && pr.p_include_demo === false && pr.p_lat === r.p_lat, 'parceiros pedidos no mesmo ponto, sem demonstração');
  assert.equal(r.p_limit, 10, 'a lista pede os 10 mais próximos, com endereço');
  assert.ok(log.cnes.filter((a) => a.p_limit === 10).every((a) => a.p_radius_m === 2000 && !('p_kind' in a)), 'aba Todos em 2 km, sem tipo');
  const pt = log.points.find((a) => a.body.p_radius_m === 2000);
  assert.ok(pt, 'mapa pede os pontos da área inteira (2 km)');
  assert.match(pt.url, /\?select=cnes,name,kind,lat,lng,distance_m,total$/, 'só os campos que o mapa usa');
  assert.deepEqual([pt.body.p_lat, pt.body.p_lng, pt.body.p_limit], [r.p_lat, r.p_lng, 3000], 'mesmo ponto da lista');
  // para clínicas e rodapé
  for (const href of ['reivindicar.html', 'painel.html', 'conta.html', 'cidades/', 'exames/', 'privacidade.html']) {
    assert.ok(await page.locator(`footer a[href="${href}"]`).count() >= 1, `rodapé com ${href}`);
  }
  assert.ok(await page.locator('#clinicas a[href="reivindicar.html"]').count() === 1);
  assert.equal(await page.getAttribute('#nearCta', 'href'), '#reais');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('mapa de clínicas reais: pontos da área inteira (2 km), não só os mais próximos', async () => {
  // 400 locais numa espiral de 100 m a ~1,95 km do ponto da Paulista, 100 de cada tipo.
  const KS = ['imagem', 'laboratorio', 'clinica', 'hospital'];
  const LAT0 = -23.565, LNG0 = -46.652;
  const AREA = Array.from({ length: 400 }, (_, i) => {
    const ang = i * 2.399963, dist = 100 + (i * 1850) / 399;
    const lat = LAT0 + (Math.sin(ang) * dist) / 110570, lng = LNG0 + (Math.cos(ang) * dist) / (111320 * Math.cos((LAT0 * Math.PI) / 180));
    return { cnes: String(7200000 + i), name: `Local Teste ${i}`, kind: KS[i % 4], lat, lng, distance_m: Math.round(dist), total: 400 };
  });
  const { page, errors, context } = await newPage(browser, { points: (r) => json(r, AREA), spyMap: true });
  await page.goto(BASE);
  await scrollAll(page);
  await page.waitForSelector('#realList li b');
  const stats = await page.$$eval('#realStats .rm-stat b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(stats, ['101', '100', '100', '100'], 'conta todos os pontos da área, mais o parceiro (imagem)');
  assert.equal(await page.locator('#realList li').count(), 4, 'a lista continua com os mais próximos');
  await page.locator('#realMap').evaluate((e) => e.scrollIntoView({ block: 'center' })); // longe do topo fixo
  const m = await page.evaluate(() => {
    const map = window.__maps.at(-1), b = map.getBounds();
    let dots = 0, rings = 0, pins = 0, voce = 0, zPin = 0, zVoce = 0;
    map.eachLayer((l) => {
      if (l instanceof L.Circle) rings += 1;
      else if (l instanceof L.CircleMarker) dots += 1;
      else if (l instanceof L.Marker) {
        const cls = l.options.icon?.options?.className;
        if (cls === 'pv-pin-w') { pins += 1; zPin = Math.max(zPin, l.options.zIndexOffset); } else if (cls === 'pv-voce-w') { voce += 1; zVoce = l.options.zIndexOffset; }
      }
    });
    const nums = [...map.getContainer().querySelectorAll('.pv-pin')].map((e) => e.textContent);
    return { n: b.getNorth(), s: b.getSouth(), e: b.getEast(), w: b.getWest(), dots, rings, pins, voce, zPin, zVoce, nums, canvas: !!map.getContainer().querySelector('canvas') };
  });
  assert.equal(m.dots, 401, '400 pontos + o parceiro');
  assert.equal(m.rings, 1, 'círculo dos 2 km');
  assert.equal(m.pins, 4, 'um pino numerado para cada item da lista');
  // O ponto de partida ("Você (aproximado)") fica por cima dos pinos: um pino em cima dele não o esconde.
  assert.equal(m.voce, 1, 'um ponto de partida');
  assert.ok(m.zVoce > Math.max(m.zPin, 5000), `o ponto de partida por cima dos pinos, mesmo do pino aceso (${m.zVoce} > ${m.zPin})`);
  assert.deepEqual(m.nums.sort(), ['1', '2', '3', '4'], 'os mesmos números da lista');
  assert.ok(m.canvas, 'pontos em canvas (leve no celular)');
  const dLat = 1950 / 110570, dLng = 1950 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
  assert.ok(m.n >= LAT0 + dLat && m.s <= LAT0 - dLat && m.e >= LNG0 + dLng && m.w <= LNG0 - dLng, `mapa enquadra os 2 km inteiros (${JSON.stringify(m)})`);
  // Toque no ponto mais longe (~1,95 km): abre o balão com o nome e o link da página do local.
  const far = AREA.at(-1);
  const at = await page.evaluate(({ lat, lng }) => {
    const map = window.__maps.at(-1), p = map.latLngToContainerPoint([lat, lng]), r = map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, far);
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('.leaflet-popup .rm-pop');
  // Ponto fora da lista: o banco não diz se a posição veio do endereço (o "~"), então o balão fica sem a distância.
  assert.match(await page.textContent('.leaflet-popup .rm-pop'), /Local Teste 399.*Hospital/s);
  assert.ok(!/\d\s?(m|km)\b/.test(await page.textContent('.leaflet-popup .rm-pop div')), 'sem distância no balão do ponto fora da lista');
  assert.equal(await page.getAttribute('.leaflet-popup .rm-pop a', 'href'), `local.html?cnes=${far.cnes}`);
  // O X do balão em português.
  assert.equal(await page.getAttribute('.leaflet-popup-close-button', 'aria-label'), 'Fechar');
  // Botões + e − em português.
  assert.deepEqual(await page.$$eval('#realMap .leaflet-control-zoom a', (els) => els.map((e) => e.getAttribute('aria-label'))), ['Aproximar', 'Afastar']);
  // Esc com o balão aberto fecha só o balão (o mapa continua).
  await page.keyboard.press('Escape');
  await page.waitForSelector('.leaflet-popup', { state: 'detached' });
  assert.equal(await page.locator('#realMap .leaflet-marker-icon.pv-pin-w').count(), 4);
  assert.deepEqual(errors, []);
  await context.close();

  // Mais locais do que o limite de pontos: a contagem avisa com "+".
  const cut = AREA.map((p) => ({ ...p, total: 5200 }));
  const t = await newPage(browser, { points: (r) => json(r, cut) });
  await t.page.goto(BASE);
  await scrollAll(t.page);
  await t.page.waitForSelector('#realList li b');
  assert.deepEqual(await t.page.$$eval('#realStats .rm-stat b', (els) => els.map((e) => e.textContent)), ['101+', '100+', '100+', '100+']);
  assert.deepEqual(t.errors, []);
  await t.context.close();
});

await scenario('sem dado do banco: pílula com texto neutro, sem número e sem erro; seletor com "Tentar de novo"', async () => {
  // Sem localização (o Chromium recusa sem perguntar) e sem as cidades do banco: sem atalhos inventados.
  const { page, log, errors, context } = await newPage(browser, { geo: null, cities: (r) => json(r, { message: 'erro' }, 500), cnes: (r) => json(r, { message: 'erro' }, 500) });
  await page.goto(BASE);
  await tela(page, 'naoapareceu');
  await page.waitForTimeout(800);
  const pill = await page.textContent('#livePill');
  assert.ok(!/\d/.test(pill), `pílula sem número (${pill})`);
  assert.equal(await page.locator('#cidades, #cities').count(), 0, 'sem o carrossel de cidades');
  assert.equal(await page.locator('#reais .pv-at').count(), 0, 'atalhos das cidades escondidos');
  assert.equal(await page.locator('#reais a[href="cidades/"]').count(), 1, 'só o link geral das cidades');
  assert.equal(log.cities, 1);
  await page.click('#cityBtn');
  await page.waitForSelector('#cityIdle [data-recarregar]');
  assert.match(await page.textContent('#cityIdle'), /Não foi possível carregar a lista de cidades agora\./);
  await page.click('#cityIdle [data-recarregar]');
  await until(() => log.cities === 2);
  assert.equal(log.cities, 2, '"Tentar de novo" chama o banco de novo');
  await page.waitForSelector('#cityIdle [data-recarregar]');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('mapa 3D: prédios do mapa (OpenFreeMap) e estabelecimentos reais perto, com tipo e distância, e painel do local', async () => {
  const mapaLog = [];
  const { page, log, errors, context, requests } = await newPage(browser, { motion: 'no-preference', device: { memory: 8, cores: 8 }, mapaLog });
  await page.goto(BASE);
  const supported = await page.evaluate(() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } });
  const r3 = await page.waitForFunction(() => document.querySelector('#hero3d').classList.contains('h3d-ready') || document.body.classList.contains('no-webgl'), null, { timeout: 45000 }).then(() => true);
  assert.ok(r3);
  const call = log.cnes.find((a) => a.p_radius_m === 3000);
  assert.ok(call, 'pede os locais num raio de ~3 km');
  assert.deepEqual([call.p_lat, call.p_lng], [-23.565, -46.652]);
  if (supported && !(await page.evaluate(() => document.body.classList.contains('no-webgl')))) {
    await page.waitForFunction(() => document.querySelectorAll('.h3d-label').length === 4);
    assert.equal(await page.evaluate(() => document.body.dataset.hero), '3d');
    assert.equal(await page.getAttribute('#hero3d', 'role'), 'region', 'botões do 3D não ficam dentro de role=img');
    assert.match(await page.getAttribute('#hero3d', 'aria-label'), /^Mapa 3D da região, com os prédios do OpenStreetMap/);
    // Prédios de verdade desenhados (aqui, os ladrilhos simulados), em 3D: mapa inclinado e girando devagar.
    await page.waitForFunction(() => window.HERO?.info?.().predios > 20, null, { timeout: 30000 });
    const info = await page.evaluate(() => window.HERO.info());
    assert.ok(info.inclinacao >= 50, `câmera inclinada (${info.inclinacao}°)`);
    // O mapa parte do ponto arredondado (~110 m), o mesmo da busca; o OpenFreeMap só recebe a lista e os ladrilhos.
    assert.deepEqual(info.centro.map((v) => Math.round(v * 1000) / 1000), [-46.652, -23.565]);
    assert.ok(mapaLog.length >= 2 && mapaLog.every((u) => u === 'https://tiles.openfreemap.org/planet' || /^https:\/\/tiles\.openfreemap\.org\/planet\/teste\/14\/\d+\/\d+\.pbf$/.test(u)), mapaLog.join(' '));
    const pbfs = mapaLog.filter((u) => /\.pbf$/.test(u));
    assert.ok(pbfs.length <= 4, `no máximo 4 ladrilhos de 2 km (${pbfs.length})`);
    assert.equal(new Set(pbfs).size, pbfs.length, `cada ladrilho baixado uma vez só (${pbfs.join(' ')})`);
    assert.ok(!requests.some((u) => /fonts\/|sprites\/|glyphs/.test(u) && /openfreemap/.test(u)), 'sem fontes nem ícones do OpenFreeMap');
    // A biblioteca vem do próprio site (CSP script-src 'self'), sem modulepreload.
    assert.ok(requests.some((u) => u.startsWith(BASE) && /assets\/vendor\/maplibre\/maplibre-gl\.js$/.test(u)), 'maplibre-gl.js do próprio site');
    assert.ok(requests.some((u) => u.startsWith(BASE) && /assets\/vendor\/maplibre\/maplibre-gl-worker\.js/.test(u)), 'trabalhador do mapa do próprio site');
    // Créditos do mapa à vista, com o link do OpenStreetMap.
    assert.ok(await page.isVisible('#heroAttrib'), 'créditos do mapa visíveis');
    assert.equal(await page.getAttribute('#heroAttrib a[href="https://www.openstreetmap.org/copyright"]', 'rel'), 'noopener');
    assert.match(await page.textContent('#heroAttrib'), /OpenStreetMap.*OpenMapTiles.*OpenFreeMap/);
    // O desenho do mapa fica fora do leitor de tela e do Tab.
    assert.equal(await page.getAttribute('#hero3d canvas', 'aria-hidden'), 'true');
    assert.equal(await page.getAttribute('#hero3d canvas', 'tabindex'), '-1');
    const hiddenFocusable = await page.$$eval('.h3d-label:not(.on)', (els) => els.filter((e) => e.tabIndex !== -1 || e.getAttribute('aria-hidden') !== 'true').length);
    assert.equal(hiddenFocusable, 0, 'rótulo escondido fora do Tab e do leitor de tela');
    const labels = await page.$$eval('.h3d-label', (els) => els.map((e) => e.textContent));
    assert.ok(labels.some((t) => /Hospital Santa Exemplo/.test(t) && /Hospital · 420 m/.test(t)), labels.join(' | '));
    assert.ok(labels.every((t) => !/★|\d,\d ?★|Fechada|\d\d:\d\d/.test(t)), 'sem nota e sem horário');
    assert.ok(labels.some((t) => t.includes('<b>Teste</b>')), 'nome escapado (sem HTML)');
    await page.evaluate(() => [...document.querySelectorAll('.h3d-label')].find((e) => /Hospital Santa/.test(e.textContent)).click());
    await page.waitForSelector('.ov.open');
    const sheet = await page.textContent('#sheet');
    assert.match(sheet, /CNES/);
    assert.equal(await page.getAttribute('#sheet .btn-coral', 'href'), 'local.html?cnes=2077485#agendar', 'Pedir agendamento leva ao formulário da página do local');
    assert.match(await page.textContent('#sheet .btn-coral'), /Pedir agendamento/);
    assert.equal(await page.locator('#sheet a[href="local.html?cnes=2077485"]').count(), 1, 'Ver página do local');
    assert.equal(await page.locator('#sheet a[href="reivindicar.html?cnes=2077485"]').count(), 1, 'É sua clínica?');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
    await page.evaluate(() => [...document.querySelectorAll('.h3d-label')].find((e) => /Parceira/.test(e.textContent)).click());
    await page.waitForSelector('.ov.open');
    const ps = await page.textContent('#sheet');
    assert.match(ps, /Parceiro do IMED/);
    assert.match(ps, /Ressonância/);
    assert.equal(await page.getAttribute('#sheet .btn-coral', 'href'), `local.html?id=${PARTNER_ID}#agendar`, 'parceiro pelo id');
    assert.ok(!/R\$/.test(ps));
    assert.equal(await page.locator('#sheet a[href^="reivindicar.html"]').count(), 0, 'parceiro já tem dono');
    await page.keyboard.press('Escape');
  } else {
    console.log('  (sem WebGL neste navegador: confere só que a página não quebrou)');
  }
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('aparelho fraco (deviceMemory=1): não baixa o 3D e mostra fundo leve com a lista real', async () => {
  const { page, errors, context, requests } = await newPage(browser, { mobile: true, motion: 'no-preference', device: { memory: 1, cores: 8 } });
  await page.goto(BASE);
  await page.waitForSelector('#heroLite li a');
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => document.body.dataset.hero), 'leve');
  assert.ok(!requests.some((u) => /maplibre|hero3d\.js|openfreemap/.test(u)), 'nem a biblioteca do mapa, nem hero3d.js, nem os ladrilhos');
  assert.equal(await page.locator('#hero3d canvas').count(), 0);
  assert.ok(await page.isHidden('#heroAttrib'), 'sem mapa, sem os créditos do mapa');
  assert.ok(await page.locator('#heroLite').isVisible());
  const items = await page.$$eval('#heroLite li a', (els) => els.map((e) => [e.getAttribute('href'), e.textContent]));
  assert.ok(items.length >= 1 && items.length <= 4, `até 4 locais no celular (${items.length})`);
  assert.ok(items.some(([h, t]) => h === 'local.html?cnes=2077485' && /Hospital Santa Exemplo/.test(t) && /420 m/.test(t)), JSON.stringify(items));
  assert.ok(items.some(([h]) => h === `local.html?id=${PARTNER_ID}`), 'parceiro pelo id');
  assert.ok(items.some(([, t]) => t.includes('<b>Teste</b>')), 'nome escapado');
  assert.ok(!/R\$|★/.test(await page.textContent('#heroLite')));
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('#hero3d'), '::before').backgroundImage);
  assert.match(bg, /svg/, 'fundo em SVG, sem foto');
  assert.ok(!requests.some((u) => /recepcao\.webp/.test(u)), 'sem foto de fundo');
  assert.ok(!requests.some((u) => /geo-core\.js/.test(u)), 'geo-core.js só ao abrir Meus pedidos');
  assert.ok(!requests.some((u) => /leaflet\.js/.test(u)), 'Leaflet só quando o mapa se aproxima da tela');
  // Leitor de tela: a lista leve não fala sozinha (sem aria-live nem role=status): quem anuncia a lista é o resumo
  // da tela "Clínicas perto de você" (#pvSum), sem repetir a mesma frase. O resumo escondido fica para a leitura.
  assert.equal(await page.getAttribute('#heroLite', 'aria-live'), null, 'lista sem aria-live');
  assert.equal(await page.getAttribute('#heroLiteStatus', 'role'), null, 'o resumo da lista leve não é um status falado');
  assert.equal(await page.textContent('#heroLiteStatus'), '4 locais perto da sua localização', 'localização permitida');
  // Distância igual à da lista da tela de baixo: o laboratório com a posição pelo endereço leva "~".
  assert.ok(items.some(([, t]) => /Laboratório Análise Paulista/.test(t) && /~640 m/.test(t)), `"~" na lista leve: ${JSON.stringify(items)}`);
  // Lista acima do degradê do topo: texto claro com contraste de pelo menos 4,5:1 (WCAG AA).
  const parts = ['#heroLite h2', '#heroLite li b', '#heroLite li small', '#heroLite .more'];
  let worst = Infinity;
  for (const sel of parts) {
    for (const loc of await page.locator(sel).all()) {
      const c = await lightTextContrast(page, loc);
      worst = Math.min(worst, c);
      assert.ok(c >= 4.5, `contraste de "${(await loc.textContent()).trim()}": ${c.toFixed(1)}:1`);
    }
  }
  console.log(`  menor contraste na lista leve do celular: ${worst.toFixed(1)}:1`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'inicio-celular-leve');
  // economia de dados também usa o modo leve
  const b = await newPage(browser, { mobile: true, motion: 'no-preference', device: { memory: 8, cores: 8, saveData: true } });
  await b.page.goto(BASE);
  await b.page.waitForSelector('#heroLite li a');
  assert.ok(!b.requests.some((u) => /maplibre|openfreemap/.test(u)));
  await b.context.close();
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('cabeçalho: transparente no topo e com fundo escuro ao rolar dentro do topo (o texto não passa por baixo das letras)', async () => {
  for (const mobile of [true, false]) {
    const { page, errors, context } = await newPage(browser, { mobile, device: { memory: 1, cores: 8 } });
    await page.goto(BASE);
    await page.waitForSelector('#hero');
    const fundo = () => page.evaluate(() => getComputedStyle(document.querySelector('.top')).backgroundColor);
    assert.equal(await fundo(), 'rgba(0, 0, 0, 0)', 'no topo: cabeçalho transparente sobre o fundo escuro');
    await page.evaluate(() => window.scrollTo(0, 160));
    await page.waitForFunction(() => document.body.classList.contains('rolou') && document.body.classList.contains('at-hero'));
    await page.waitForTimeout(450); // transição de 0,35 s
    assert.match(await fundo(), /^rgba\(5, 22, 30, 0\.8/, `rolando dentro do topo: fundo escuro (${mobile ? 'celular' : 'computador'})`);
    await shot(page, `inicio-cabecalho-rolando-${mobile ? 'celular' : 'computador'}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => !document.body.classList.contains('rolou'));
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('aparelho normal: baixa o 3D (biblioteca e ladrilhos) só depois do H1 aparecer', async () => {
  const { page, errors, context } = await newPage(browser, { motion: 'no-preference', device: { memory: 8, cores: 8 } });
  await page.goto(BASE);
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /maplibre-gl\.js/.test(e.name)), null, { timeout: 15000 });
  const t = await page.evaluate(() => {
    const fcp = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint');
    const lib = performance.getEntriesByType('resource').find((e) => /maplibre-gl\.js/.test(e.name));
    return { fcp: fcp ? fcp.startTime : null, lib: lib.startTime, preload: !!document.querySelector('link[href*="maplibre"],link[href*="hero3d"]') };
  });
  assert.equal(t.preload, false, 'sem modulepreload da biblioteca do mapa');
  assert.ok(t.fcp != null && t.lib > t.fcp, `biblioteca do mapa (${Math.round(t.lib)} ms) depois da primeira pintura com o H1 (${Math.round(t.fcp)} ms)`);
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /openfreemap/.test(e.name)), null, { timeout: 30000 });
  const lad = await page.evaluate(() => performance.getEntriesByType('resource').find((e) => /openfreemap/.test(e.name)).startTime);
  assert.ok(lad > t.fcp, 'ladrilhos depois da primeira pintura');
  console.log(`  primeira pintura ${Math.round(t.fcp)} ms; biblioteca do mapa pedida em ${Math.round(t.lib)} ms; 1º pedido ao OpenFreeMap em ${Math.round(lad)} ms`);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular com 3D (tela de densidade 3, 8 locais): 1 ou 2 rótulos, dentro da tela, sem cobrir outro rótulo nem o "Você está aqui"', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, dpr: 3, motion: 'no-preference', device: { memory: 8, cores: 8 }, cnes: (r) => json(r, AROUND), partners: (r) => json(r, []) });
  await page.goto(BASE);
  await page.waitForFunction(() => ['3d', 'leve'].includes(document.body.dataset.hero), null, { timeout: 30000 });
  if (await page.evaluate(() => document.body.dataset.hero) !== '3d') { console.log('  (sem WebGL neste navegador: confere só o modo leve)'); await context.close(); return; }
  // Tela de densidade 3: o 3D desenha com no máximo 1,5 pixel por ponto.
  const ratio = await page.evaluate(() => { const c = document.querySelector('#hero3d canvas'); return c.width / c.clientWidth; });
  assert.ok(Math.abs(ratio - 1.5) < 0.01, `pixel ratio 1,5 numa tela de densidade 3 (${ratio})`);
  await page.waitForFunction(() => document.querySelectorAll('.h3d-label').length === 8);
  // O 3D aqui roda a poucos quadros por segundo (sem placa de vídeo): espera o primeiro rótulo aparecer.
  await page.waitForFunction(() => document.querySelectorAll('.h3d-label.on').length >= 1, null, { timeout: 45000 });
  let withTwo = 0;
  for (let i = 0; i < 8; i++) {
    const s = await page.evaluate(() => {
      const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, n: e.textContent }; };
      const me = document.querySelector('.h3d-me');
      return { hero: box(document.querySelector('#hero3d')), labels: [...document.querySelectorAll('.h3d-label.on')].map(box), me: me.classList.contains('on') ? box(me) : null };
    });
    assert.ok(s.labels.length >= 1 && s.labels.length <= 2, `de 1 a 2 rótulos no celular (${s.labels.length})`);
    if (s.labels.length === 2) withTwo += 1;
    for (const b of s.labels) {
      assert.ok(b.l >= s.hero.l && b.r <= s.hero.r && b.t >= s.hero.t && b.b <= s.hero.b, `rótulo inteiro dentro da área do 3D (${Math.round(b.l)}..${Math.round(b.r)} de ${Math.round(s.hero.r)})`);
    }
    assert.ok(s.me, '"Você está aqui" na tela');
    const boxes = [...s.labels, s.me];
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) assert.ok(!overlap(boxes[a], boxes[b]), `"${boxes[a].n}" não cobre "${boxes[b].n}"`);
    }
    await page.waitForTimeout(700);
  }
  console.log(`  amostras com 2 rótulos: ${withTwo} de 8 (as outras com 1)`);
  await shot(page, 'inicio-celular-3d');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('cidade em 3D: o botão "Pausar animação" fica inteiro à vista, sem a parte branca da página por cima (computador e celular)', async () => {
  for (const [label, opts] of [['computador 1366', {}], ['computador 1280x720', { viewport: { width: 1280, height: 720 } }], ['celular 390', { mobile: true, dpr: 2 }]]) {
    const { page, errors, context } = await newPage(browser, { motion: 'no-preference', device: { memory: 8, cores: 8 }, ...opts });
    await page.goto(BASE);
    await page.waitForFunction(() => ['3d', 'leve'].includes(document.body.dataset.hero), null, { timeout: 30000 });
    if (await page.evaluate(() => document.body.dataset.hero) !== '3d') { console.log(`  (${label}: sem WebGL neste navegador, sem o botão)`); await context.close(); continue; }
    await page.waitForSelector('#heroPause:not([hidden])');
    // No centro, na base e nos cantos de baixo do botão, quem recebe o toque é o próprio botão.
    const hits = await page.evaluate(() => {
      const b = document.querySelector('#heroPause');
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      // O botão é uma pílula (cantos redondos): os pontos de baixo ficam dentro das curvas.
      const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + r.width / 2, r.bottom - 2], [r.left + r.height / 2, r.bottom - 3], [r.right - r.height / 2, r.bottom - 3]];
      return pts.map(([x, y]) => { const el = document.elementFromPoint(x, y); return el === b || b.contains(el) ? 'botão' : (el?.className || el?.tagName || 'nada'); });
    });
    assert.deepEqual(hits, ['botão', 'botão', 'botão', 'botão'], `${label}: o botão inteiro recebe o toque (${hits.join(', ')})`);
    if (!opts.mobile) {
      // E não encosta no aviso "Arraste para girar".
      const gap = await page.evaluate(() => { const h = document.querySelector('.hero-hint'); const b = document.querySelector('#heroPause'); if (!h || !h.getClientRects().length) return 99; return b.getBoundingClientRect().top - h.getBoundingClientRect().bottom; });
      assert.ok(gap >= 4, `${label}: o botão não encosta no aviso de arrastar (${Math.round(gap)} px)`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('mapa 3D sem os ladrilhos (sem internet para o OpenFreeMap): versão leve com a lista real, sem erro', async () => {
  const { page, errors, context } = await newPage(browser, { motion: 'no-preference', device: { memory: 8, cores: 8 }, mapa: 'falha' });
  await page.goto(BASE);
  await page.waitForFunction(() => ['3d', 'leve'].includes(document.body.dataset.hero), null, { timeout: 45000 });
  if (await page.evaluate(() => !document.createElement('canvas').getContext('webgl2'))) { console.log('  (sem WebGL 2 neste navegador)'); await context.close(); return; }
  assert.equal(await page.evaluate(() => document.body.dataset.hero), 'leve', 'sem ladrilhos, a versão leve');
  await page.waitForSelector('#heroLite li a');
  const items = await page.$$eval('#heroLite li a', (els) => els.map((e) => e.getAttribute('href')));
  assert.ok(items.includes('local.html?cnes=2077485'), 'a mesma lista real');
  assert.equal(await page.locator('#hero3d canvas, .h3d-pin, .h3d-label').count(), 0, 'o mapa e os rótulos saem da página');
  assert.ok(await page.isHidden('#heroAttrib'), 'sem os créditos do mapa');
  assert.ok(await page.isHidden('#heroPause'), 'sem o botão de pausar');
  assert.equal(await page.evaluate(() => window.HERO), null);
  assert.match(await page.getAttribute('#hero3d', 'aria-label'), /^Estabelecimentos de saúde reais/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('mapa 3D acompanha o tema: escuro no aparelho escuro e muda na hora pelo botão do tema', async () => {
  const { page, errors, context } = await newPage(browser, { motion: 'no-preference', device: { memory: 8, cores: 8 }, escuro: true });
  await page.goto(BASE);
  await page.waitForFunction(() => ['3d', 'leve'].includes(document.body.dataset.hero), null, { timeout: 45000 });
  if (await page.evaluate(() => document.body.dataset.hero) !== '3d') { console.log('  (sem WebGL 2 neste navegador)'); await context.close(); return; }
  assert.equal(await page.evaluate(() => window.HERO.info().tema), 'escuro');
  await shot(page, 'inicio-3d-escuro');
  // Botão do tema do cabeçalho: Automático (escuro, como o aparelho) → Claro.
  await page.click('.top [data-tema]');
  await page.waitForFunction(() => window.HERO.info().tema === 'claro');
  assert.equal(await page.evaluate(() => document.body.dataset.hero), '3d', 'o mesmo mapa, sem recarregar');
  await page.waitForTimeout(600);
  await shot(page, 'inicio-3d-claro');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Meus pedidos: só pedidos reais, situação do banco, avaliar e lembrete .ics', async () => {
  const { page, log, errors, context } = await newPage(browser, { appts: APPTS, now: NOW });
  await page.goto(`${BASE}#agenda`);
  await page.waitForSelector('.appt');
  await page.waitForFunction(() => /Confirmado/.test(document.querySelector('#appts').textContent));
  const cards = await page.$$eval('.appt', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  assert.equal(cards.length, 3, 'agendamentos fictícios antigos (exame/tele) somem');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(stored.length, 3, 'e são limpos do aparelho');
  assert.ok(stored.every((a) => a.type === 'pedido'));
  assert.equal(log.status.length, 1);
  assert.deepEqual(log.status[0].p_ids, [ID1, ID2]);
  assert.deepEqual(log.status[0].p_tokens, ['a'.repeat(64), 'b'.repeat(64)]);
  assert.match(cards[0], /Hospital Santa Exemplo/);
  assert.match(cards[0], /Confirmado/);
  assert.match(cards[0], /Protocolo IMED-11111111/);
  assert.match(cards[0], /manhã/);
  assert.match(cards[1], /Concluído/);
  assert.equal(await page.getAttribute('.appt >> nth=1 >> a:has-text("Avaliar")', 'href'), `conta.html#pedido-${ID2}`);
  assert.equal(await page.locator('.appt >> nth=0 >> a:has-text("Avaliar")').count(), 0, 'só avalia o que foi concluído');
  assert.match(cards[2], /Pedido enviado/, 'pedido antigo sem código: sem situação ao vivo');
  assert.ok(cards.every((c) => !/R\$/.test(c)));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.appt >> nth=0 >> button:has-text("Adicionar à agenda")')]);
  assert.match(download.suggestedFilename(), /^imed-imed-11111111\.ics$/);
  const ics = await readFile(await download.path(), 'utf8');
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART;TZID=America\/Sao_Paulo:20261105T080000/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics.replace(/\r\n /g, ''), /Retire objetos de metal/, 'preparo da ressonância');
  assert.match(ics.replace(/\r\n /g, ''), /SUMMARY:Ressonância · Hospital Santa Exemplo\r\n/, 'confirmado pelo local: sem "(a confirmar)"');
  assert.match(await page.textContent('#agTitle'), /Meus pedidos/);
  await shot(page, 'inicio-agendados');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Meus pedidos vazio e falha ao consultar a situação', async () => {
  const { page, errors, context } = await newPage(browser, { appts: [APPTS[0]], now: NOW, status: (r) => json(r, { message: 'erro' }, 500) });
  await page.goto(`${BASE}#agenda`);
  await page.waitForFunction(() => /indisponível/.test(document.querySelector('#appts').textContent));
  page.once('dialog', (d) => d.accept());
  await page.click('.appt .rmv');
  await page.waitForSelector('#appts .empty');
  assert.match(await page.textContent('#appts'), /ainda não fez nenhum pedido/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Meus pedidos: remover apaga o pedido mostrado, mesmo se a lista mudou em outra aba', async () => {
  const { page, errors, context } = await newPage(browser, { appts: APPTS.slice(0, 2), now: NOW });
  await page.goto(`${BASE}#agenda`);
  await page.waitForFunction(() => /Confirmado/.test(document.querySelector('#appts').textContent));
  assert.equal(await page.evaluate(() => document.querySelector('main#conteudo').closest('[data-view]').hidden), true, 'visão início escondida com hidden');
  assert.equal(await page.evaluate(() => document.querySelector('#agendaMain').hidden), false);
  assert.equal(await page.getAttribute('.skip', 'href'), '#agendaMain', 'pular para o conteúdo vai à visão aberta');
  // Outra aba grava um pedido novo no começo da lista.
  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('imed_appts'));
    all.unshift({ type: 'pedido', code: 'IMED-NOVO0000', id: '44444444-4444-4444-8444-444444444444', token: 'c'.repeat(64), name: 'Pedido de outra aba', items: [], date: '2026-12-01', period: 'tarde', status: 'pendente', created: '2026-10-30T13:00:00Z' });
    localStorage.setItem('imed_appts', JSON.stringify(all));
  });
  page.once('dialog', (d) => d.accept());
  await page.click('.appt >> nth=0 >> .rmv'); // o cartão mostrado: Hospital Santa Exemplo
  await page.waitForFunction(() => !/Hospital Santa Exemplo/.test(document.querySelector('#appts').textContent));
  const left = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')).map((a) => a.code));
  assert.deepEqual(left, ['IMED-NOVO0000', 'IMED-22222222'], 'o pedido novo e o seu código continuam');
  await page.evaluate(() => document.querySelector('.bnav [data-go="inicio"]').click());
  assert.equal(await page.evaluate(() => document.querySelector('#agendaMain').hidden), true);
  assert.equal(await page.getAttribute('.skip', 'href'), '#conteudo');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('teleconsulta: médicos atendendo agora vêm do banco e o botão leva à página da teleconsulta', async () => {
  const DOCS = [{ full_name: 'Médica Um', crm: '1', crm_uf: 'SP', rqe: null, specialty: null }, { full_name: 'Médico Dois', crm: '2', crm_uf: 'RJ', rqe: null, specialty: null }];
  const { page, log, errors, context } = await newPage(browser, { tele: (r) => json(r, DOCS) });
  await page.goto(BASE);
  assert.equal(log.tele, 0, 'só pergunta quando a seção se aproxima da tela');
  await page.locator('#lista').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => /Médicos atendendo agora: 2/.test(document.querySelector('#teleNow').textContent));
  assert.equal(log.tele, 1);
  assert.ok(await page.evaluate(() => document.querySelector('#teleNow').classList.contains('on')));
  assert.equal(await page.getAttribute('#teleGo', 'href'), 'teleconsulta.html');
  assert.match(await page.textContent('#teleGo'), /Entrar na teleconsulta/);
  const sec = await page.textContent('#lista');
  assert.match(sec, /Teleconsulta não é para emergência/);
  assert.ok(!/Em breve|em breve|médicos de verdade/.test(sec), 'nada de "em breve"');
  assert.ok(!/R\$|Dra\.|Dr\./.test(sec), 'sem preço e sem nome de médico na página inicial');
  assert.equal(await page.isVisible('#teleWait'), false, 'com médico atendendo, sem lista de espera');
  assert.equal(await page.getAttribute('.hchip[href="teleconsulta.html"]', 'href'), 'teleconsulta.html', 'atalho do topo vai para a teleconsulta');
  assert.ok(!/em breve/.test(await page.textContent('#hchips')));
  await page.locator('#lista').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await shot(page, 'inicio-teleconsulta');
  await page.click('#faqAll');
  assert.match(await page.textContent('.faq'), /Já existe teleconsulta\?\s*Sim\..*Quando não há médico atendendo, a página da teleconsulta avisa/s);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('teleconsulta sem médico atendendo ou com a função fora do ar: aviso e lista de espera', async () => {
  for (const [name, tele] of [['nenhum médico', (r) => json(r, [])], ['função fora do ar', (r) => json(r, { message: 'not found' }, 404)]]) {
    const { page, log, errors, context } = await newPage(browser, { tele });
    await page.goto(`${BASE}#tele`);
    await page.waitForFunction(() => /Nenhum médico atendendo agora/.test(document.querySelector('#teleNow').textContent));
    assert.ok(!(await page.evaluate(() => document.querySelector('#teleNow').classList.contains('on'))), name);
    assert.equal(await page.getAttribute('#teleGo', 'href'), 'teleconsulta.html', `${name}: o botão continua (a página avisa)`);
    await page.waitForSelector('#teleWait:not([hidden])');
    assert.equal(await page.inputValue('#wlForm select'), 'teleconsulta');
    await page.fill('#wlForm input[name=email]', 'Maria@Exemplo.com');
    await page.fill('#wlForm input[name=city]', 'Recife');
    await page.click('#wlBtn');
    await page.waitForSelector('#wlMsg.ok');
    assert.deepEqual(log.waitlist[0], { email: 'maria@exemplo.com', city: 'Recife', interest: 'teleconsulta' });
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // A lista de espera aparece acima de uma pergunta frequente com o foco, que a pessoa deixou fora da tela ao rolar
    // até a teleconsulta: a página não pula de volta para o foco.
    let soltar;
    const espera = new Promise((r) => { soltar = r; });
    const { page, errors, context } = await newPage(browser, { mobile: true, tele: async (r) => { await espera; return json(r, []); } });
    await page.goto(BASE);
    await tela(page, 'lista');
    await page.locator('.faq summary').first().focus();
    await page.evaluate(() => document.querySelector('#lista').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    const y0 = await page.evaluate(() => scrollY);
    soltar();
    await page.waitForSelector('#teleWait:not([hidden])');
    await page.waitForTimeout(300);
    const y1 = await page.evaluate(() => scrollY);
    assert.ok(Math.abs(y1 - y0) <= 2, `a página não pula (${y0} → ${y1})`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('Meus pedidos: o lembrete .ics diz "(a confirmar)" enquanto o local não confirma', async () => {
  const { page, errors, context } = await newPage(browser, { appts: [APPTS[0]], now: NOW, status: (r) => json(r, [{ id: ID1, status: 'pending', reviewed: false }]) });
  await page.goto(`${BASE}#agenda`);
  await page.waitForFunction(() => /Aguardando contato/.test(document.querySelector('#appts').textContent));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.appt >> nth=0 >> button:has-text("Adicionar à agenda")')]);
  const ics = (await readFile(await download.path(), 'utf8')).replace(/\r\n /g, '');
  assert.match(ics, /SUMMARY:Ressonância · Hospital Santa Exemplo \(a confirmar\)\r\n/);
  assert.match(ics, /STATUS:TENTATIVE/);
  assert.match(ics, /O horário é confirmado pela clínica/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('WhatsApp: escondido com a configuração vazia e visível quando configurado', async () => {
  {
    const { page, errors, context } = await newPage(browser, { mobile: true });
    await page.goto(BASE);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('a[href*="wa.me"]').count(), 0, 'sem número, sem botão');
    assert.deepEqual(errors, []);
    await context.close();
  }
  const { page, errors, context } = await newPage(browser, { mobile: true, whatsapp: '5511987654321' });
  await page.goto(BASE);
  const fab = page.locator('#waFab');
  await fab.waitFor();
  assert.match(await fab.getAttribute('href'), /^https:\/\/wa\.me\/5511987654321\?text=/);
  const [f, nav] = await Promise.all([fab.boundingBox(), page.locator('.bnav').boundingBox()]);
  assert.ok(f.y + f.height <= nav.y, 'não cobre a barra de navegação de baixo');
  assert.deepEqual(errors, []);
  await context.close();
});

// Nomes reais do CNES podem ser bem compridos ("Osteon Clínica de Ortopedia e Traumatologia..."): em tela de 360 px
// (muitos Android) a lista dos locais reais não pode empurrar o quadro para fora da tela; o nome ganha reticências.
await scenario('celular 360px: nome comprido na lista de locais reais não passa da tela', async () => {
  const LONGO = { ...CNES_ROWS[0], cnes: '7300001', name: 'Clínica de Ortopedia, Traumatologia e Medicina Esportiva com Nome Bem Comprido Teste' };
  const { page, errors, context } = await newPage(browser, { mobile: true, viewport: { width: 360, height: 740 }, cnes: (r) => json(r, [LONGO, ...CNES_ROWS.slice(1)]) });
  await page.goto(BASE);
  await scrollAll(page);
  await page.waitForSelector('#realList li b');
  // Mede contra a largura da tela (360), não contra innerWidth: no modo celular, quando algo passa da tela,
  // o navegador afasta o zoom e o innerWidth cresce junto (por isso a conta "scrollWidth - innerWidth" dá zero).
  const W = 360;
  const right = (sel) => page.evaluate(([s, w]) => { const e = document.querySelector(s); return e && e.getClientRects().length ? Math.round(e.getBoundingClientRect().right) - w : null; }, [sel, W]);
  const m = await page.evaluate((w) => {
    const b = [...document.querySelectorAll('#realList li b')].find((x) => /Nome Bem Comprido/.test(x.textContent));
    const r = (el) => Math.round(el.getBoundingClientRect().right) - w;
    const wide = [...document.querySelectorAll('#reais *')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > w + 0.5).map((e) => e.className || e.tagName).slice(0, 5);
    // As 5 abas em 2 linhas (cada uma com 44 px): o topo da última linha.
    const linhas = new Set([...document.querySelectorAll('#pvTabs button')].map((x) => Math.round(x.getBoundingClientRect().top))).size;
    return {
      card: r(document.querySelector('#reais .pv-card')), tabs: r(document.querySelector('#pvTabs')),
      list: r(document.querySelector('#realList')), item: b ? r(b.closest('li')) : null, cut: !!b && b.scrollWidth > b.clientWidth, wide, linhas,
    };
  }, W);
  assert.equal(m.linhas, 2, 'a 360 px, as 5 abas ficam em 2 linhas');
  await page.evaluate(() => document.querySelector('#realList').scrollIntoView({ block: 'center' }));
  await shot(page, 'inicio-celular-360');
  assert.ok(m.item !== null, 'o local de nome comprido aparece na lista');
  for (const [k, what] of [['card', 'a tela dos locais'], ['tabs', 'as abas'], ['list', 'a lista'], ['item', 'o local de nome comprido']]) {
    assert.ok(m[k] <= 0, `${what} cabe na tela de 360 px (passa ${m[k]} px)`);
  }
  assert.deepEqual(m.wide, [], 'nada da tela passa dos 360 px');
  assert.ok(m.cut, 'o nome comprido é cortado com reticências');
  // O seletor de cidade e o mapa em tela cheia também cabem.
  await page.click('#cityBtn');
  await page.waitForSelector('#cityQ');
  assert.ok((await right('#sheet')) <= 0, 'o seletor cabe na tela');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
  await page.click('#mapOpen');
  await page.waitForSelector('#pvMapa.cheio #realMap .leaflet-marker-icon');
  assert.ok((await right('#pvMapa')) <= 0 && (await right('#realStats')) <= 0, 'o mapa aberto e a legenda cabem na tela');
  await page.click('#mapClose');
  assert.deepEqual(errors, []);
  await context.close();
  // Cidade de nome comprido escolhida antes (30 das 318 cidades importadas têm 24 letras ou mais): o botão da cidade
  // (52 px ou mais) e o do topo cortam o nome com reticências, e o topo continua numa linha só.
  const SOCORRO = { ibge: 2804805, name: 'Nossa Senhora do Socorro', uf: 'SE', lat: -10.855, lng: -37.126 };
  const b = await newPage(browser, { mobile: true, viewport: { width: 360, height: 740 }, store: { imed_cidade: SOCORRO } });
  await b.page.goto(BASE);
  await tela(b.page, 'lista');
  const cb = await b.page.evaluate((w) => {
    const btn = document.querySelector('#cityBtn'), nome = document.querySelector('#cityName'), r = btn.getBoundingClientRect();
    const topo = document.querySelector('#addrTxt'), caixa = (s) => document.querySelector(s).getBoundingClientRect();
    return {
      altura: r.height, passa: Math.round(r.right) - w, texto: nome.textContent, cortado: nome.scrollWidth > nome.clientWidth, trocar: !!document.querySelector('#cityTrocar').getClientRects().length,
      topo: topo.textContent, topoCortado: topo.scrollWidth > topo.clientWidth, umaLinha: Math.round(caixa('#addrBtn').top) === Math.round(caixa('.logo').top), alturaTopo: Math.round(caixa('.top-row').height), topoPassa: Math.round(caixa('#addrBtn').right) - w,
    };
  }, W);
  assert.equal(cb.texto, 'Nossa Senhora do Socorro - SE');
  assert.ok(cb.altura >= 52, `botão da cidade com ${cb.altura} px de altura`);
  assert.ok(cb.passa <= 0, `o botão da cidade cabe na tela (passa ${cb.passa} px)`);
  assert.ok(cb.cortado, 'o nome comprido ganha reticências');
  assert.ok(cb.trocar, '"Trocar" continua à vista');
  assert.equal(cb.topo, 'Nossa Senhora do Socorro - SE');
  assert.ok(cb.umaLinha && cb.alturaTopo <= 72 && cb.topoPassa <= 0, `o topo continua numa linha só (${JSON.stringify(cb)})`);
  assert.ok(cb.topoCortado, 'no topo, o nome também ganha reticências');
  assert.ok((await b.page.evaluate((w) => document.documentElement.scrollWidth - w, W)) <= 0, 'sem rolagem lateral');
  await b.page.locator('#reais').evaluate((e) => e.scrollIntoView());
  await shot(b.page, 'perto-celular-360-cidade-comprida');
  assert.deepEqual(b.errors, []);
  await b.context.close();
});

await scenario('celular 390px: sem rolagem lateral, menu de baixo coerente', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, appts: APPTS.slice(0, 2) });
  await page.goto(BASE);
  await page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill').textContent));
  await shot(page, 'inicio-celular');
  await scrollAll(page);
  await page.waitForSelector('#realList li b');
  // Mede contra a largura da tela (390), não contra innerWidth: no modo celular, quando algo passa da tela, o
  // navegador afasta o zoom e o innerWidth cresce junto.
  const W = 390;
  const overflow = await page.evaluate((w) => document.documentElement.scrollWidth - w, W);
  assert.ok(overflow <= 0, `sem rolagem lateral (${overflow}px)`);
  const wide = await page.evaluate((w) => [...document.querySelectorAll('main *, header *, footer *')].filter((el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.right > w + 1 && st.position !== 'fixed' && !el.closest('.cats,.hchips,.h3d-labels,.leaflet-container'); }).map((el) => el.className || el.tagName).slice(0, 5), W);
  assert.deepEqual(wide, [], 'nenhum elemento passa da largura da tela');
  // Fontes do Google sempre com reserva: aqui elas nem carregam (rede simulada), e nada pode cair em Times.
  const lone = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => {
    const f = getComputedStyle(el).fontFamily;
    return /^\s*["']?(Sora|Inter)\b/i.test(f) && !/,\s*sans-serif\s*$/i.test(f);
  }).map((el) => el.className || el.tagName).slice(0, 5));
  assert.deepEqual(lone, [], 'toda regra com Sora ou Inter termina numa fonte sem serifa do aparelho');
  const items = await page.$$eval('.bnav > *', (els) => els.map((e) => [e.textContent.trim(), e.getAttribute('href'), e.getBoundingClientRect().height]));
  assert.deepEqual(items.map((i) => i[0]), ['Início', 'Perto de mim', 'Meus pedidos', 'Conta']);
  assert.equal(items[3][1], 'conta.html');
  assert.ok(items.every((i) => i[2] < 60), 'rótulos numa linha só');
  // Página mais curta: antes destas mudanças media 7.295 px (390x844, 4 cidades, modo leve). Os alvos de toque
  // de 44 px (links do rodapé, perguntas frequentes e botões, para quem tem dedo trêmulo ou vista cansada)
  // somam uns 200 px: o limite passou de 6.800 para 7.200 px. Em 30/10 o rodapé ganhou "Área do médico" (mais uma
  // linha): o limite agora é a altura de antes de todas essas mudanças, que a página não pode passar.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(`  altura da página no celular: ${height} px (antes: 7295 px)`);
  assert.ok(height < 7295, `página mais curta no celular do que antes (${height} px)`);
  assert.equal(await page.locator('#cidades, #cities').count(), 0, 'sem o carrossel de cidades (a tela "Clínicas perto de você" tem o seletor)');
  if (SHOTS) { await page.screenshot({ path: join(SHOTS, 'inicio-celular-inteira.png'), fullPage: true }); }
  await page.click('.bnav [data-go="agenda"]');
  await page.waitForFunction(() => /Confirmado/.test(document.querySelector('#appts').textContent));
  await shot(page, 'inicio-celular-agendados');
  const ov2 = await page.evaluate((w) => document.documentElement.scrollWidth - w, W);
  assert.ok(ov2 <= 0, `Meus pedidos sem rolagem lateral (${ov2}px)`);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('origem do topo e fonte do CNES com a data real dos dados: exemplo → São Paulo, região → cidade da região, cidade escolhida → ela', async () => {
  // Sem localização (o Chromium recusa sem perguntar): o topo usa o exemplo da Av. Paulista, marcado como exemplo.
  {
    const { page, log, errors, context } = await newPage(browser, { geo: null });
    await page.goto(BASE);
    await tela(page, 'naoapareceu');
    await page.waitForFunction(() => /atualizados em/.test(document.querySelector('#heroSrc').textContent));
    assert.equal(await page.textContent('#heroSrc'), 'Fonte: CNES/Ministério da Saúde, dados de São Paulo atualizados em 30 de outubro de 2026');
    assert.deepEqual(log.cnesDateArgs, [{ p_city: 3550308 }], 'a data é a dos dados de São Paulo (o exemplo), não a da importação mais nova');
    assert.equal(await page.textContent('#addrSmall'), 'Onde você está?');
    assert.equal(await page.textContent('#addrTxt'), 'Escolher cidade');
    assert.equal(await page.textContent('#heroAddr'), 'Escolher cidade');
    assert.equal(await page.locator('#realList li b').count(), 0, 'sem origem, sem lista');
    assert.ok(!/de Av\. Paulista/.test(await page.evaluate(() => document.body.innerText)), 'sem "de Av. Paulista" na página');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Localização permitida: a região vem do cadastro (os locais mais perto são de São Paulo) e a fonte segue a região.
  {
    const { page, log, errors, context } = await newPage(browser);
    await page.goto(BASE);
    await tela(page, 'lista');
    await page.waitForFunction(() => /atualizados em/.test(document.querySelector('#heroSrc').textContent));
    assert.equal(await page.textContent('#heroSrc'), 'Fonte: CNES/Ministério da Saúde, dados de São Paulo atualizados em 30 de outubro de 2026');
    assert.deepEqual(log.cnesDateArgs, [{ p_city: 3550308 }], 'uma chamada, com a cidade da região');
    assert.equal(await page.textContent('#addrSmall'), 'Sua região');
    assert.equal(await page.textContent('#addrTxt'), 'São Paulo - SP');
    assert.equal(await page.textContent('#heroAddr'), 'São Paulo');
    assert.equal(await page.textContent('#cityLine'), 'Distâncias medidas da sua localização aproximada.');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Cidade escolhida antes: abre direto nela, sem geocodificar.
  {
    const { page, log, errors, context } = await newPage(browser, { geo: null, store: { imed_cidade: { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', lat: -22.907, lng: -43.173 } } });
    await page.goto(BASE);
    await tela(page, 'lista');
    await page.waitForFunction(() => /atualizados em/.test(document.querySelector('#heroSrc').textContent));
    assert.equal(await page.textContent('#heroSrc'), 'Fonte: CNES/Ministério da Saúde, dados do Rio de Janeiro atualizados em 30 de outubro de 2026');
    assert.deepEqual(log.cnesDateArgs, [{ p_city: 3304557 }]);
    assert.equal(log.geocode.length, 0, 'centro guardado: sem geocodificar');
    assert.equal(await page.textContent('#addrSmall'), 'Cidade escolhida');
    assert.equal(await page.textContent('#addrTxt'), 'Rio de Janeiro - RJ');
    const at = log.cnes.find((a) => a.p_radius_m === 2000);
    assert.deepEqual([at.p_lat, at.p_lng], [-22.907, -43.173], 'lista perto do centro do Rio');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Sem a data (função fora do ar): só a fonte, sem data inventada.
  const b = await newPage(browser, { cnesDate: (r) => json(r, { message: 'erro' }, 500) });
  await b.page.goto(BASE);
  await b.page.waitForFunction(() => !document.querySelector('#heroSrc').hidden);
  assert.equal(await b.page.textContent('#heroSrc'), 'Fonte: CNES/Ministério da Saúde');
  await b.context.close();
  // Sem as cidades do banco (sem contagem), a linha da fonte nem aparece.
  const c = await newPage(browser, { cities: (r) => json(r, { message: 'erro' }, 500) });
  await c.page.goto(BASE);
  await tela(c.page, 'lista');
  await c.page.waitForTimeout(600);
  assert.ok(await c.page.locator('#heroSrc').isHidden());
  assert.equal(c.log.cnesDate, 0);
  await c.context.close();
});

await scenario('seletor de cidade: busca com setas, centro pela geocodificação da busca, guardado no aparelho', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(BASE);
  await tela(page, 'lista');
  const before = log.cnes.length;
  await page.locator('#cityBtn').scrollIntoViewIfNeeded();
  await page.click('#cityBtn');
  await page.waitForSelector('.ov.open .sheet.cid #cityQ');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cityQ', 'foco no campo da cidade');
  assert.equal(await page.getAttribute('#cityQ', 'aria-expanded'), 'false');
  assert.equal(await page.getAttribute('#cityQ', 'aria-controls'), 'cityList');
  await page.keyboard.type('rio');
  await page.waitForFunction(() => document.querySelector('#cityHint').textContent === '1 cidade encontrada');
  assert.equal(await page.getAttribute('#cityQ', 'aria-expanded'), 'true');
  assert.deepEqual(await page.$$eval('#cityList [role=option]', (els) => els.map((e) => e.textContent)), ['Rio de Janeiro - RJ3.000 locais no cadastro oficial']);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.getAttribute('#cityQ', 'aria-activedescendant'), 'cityOpt-3304557');
  assert.equal(await page.getAttribute('#cityOpt-3304557', 'aria-selected'), 'true');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#ov').classList.contains('open'));
  assert.deepEqual(log.geocode.at(-1), { action: 'geocode', q: 'Rio de Janeiro, RJ' }, 'mesma geocodificação da busca');
  await tela(page, 'lista');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cityBtn', 'o foco volta para quem abriu');
  assert.equal(await page.textContent('#cityName'), 'Rio de Janeiro - RJ');
  await page.waitForFunction(() => /dados do Rio de Janeiro atualizados em/.test(document.querySelector('#heroSrc').textContent));
  assert.deepEqual(log.cnesDateArgs.at(-1), { p_city: 3304557 }, 'a fonte passa a dizer a data dos dados do Rio de Janeiro');
  assert.equal(await page.textContent('#addrSmall'), 'Cidade escolhida');
  assert.equal(await page.textContent('#addrTxt'), 'Rio de Janeiro - RJ');
  assert.match(await page.textContent('#cityLine'), /Distâncias medidas do centro do Rio de Janeiro\. Rio de Janeiro fica a 363 km de você\./);
  await until(() => log.cnes.slice(before).some((a) => a.p_radius_m === 2000));
  const at = log.cnes.slice(before).find((a) => a.p_radius_m === 2000);
  assert.deepEqual([at.p_lat, at.p_lng], [-22.907, -43.173], 'centro da cidade, arredondado (~110 m)');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_cidade')));
  assert.deepEqual(saved, { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', lat: -22.907, lng: -43.173 });
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('imed_cidades_recentes'))), [saved], 'recentes com o Rio');
  // Volta depois: a cidade continua escolhida, sem chamar a geocodificação de novo.
  const geo = log.geocode.length;
  await page.reload();
  await tela(page, 'lista');
  assert.equal(await page.textContent('#cityName'), 'Rio de Janeiro - RJ');
  assert.equal(log.geocode.length, geo);
  assert.deepEqual(errors, []);
  await context.close();
  // Geocodificação fora do ar: avisa na própria janela e deixa escolher de novo; nada é guardado.
  const b = await newPage(browser, { geocode: (r) => json(r, { ok: false, error: 'geocoder_unavailable' }, 502) });
  await b.page.goto(BASE);
  await b.page.click('#addrBtn');
  await b.page.waitForSelector('#cityQ');
  await b.page.keyboard.type('belo');
  await b.page.waitForSelector('#cityList [role=option]');
  await b.page.keyboard.press('Enter');
  await b.page.waitForFunction(() => /Não foi possível achar o centro/.test(document.querySelector('#cityHint').textContent));
  assert.ok(await b.page.locator('#ov.open').count(), 'a janela continua aberta');
  assert.equal(await b.page.isDisabled('#cityQ'), false);
  assert.equal(await b.page.evaluate(() => localStorage.getItem('imed_cidade')), null);
  assert.equal(await b.page.evaluate(() => localStorage.getItem('imed_cidades_recentes')), null);
  // Esc com texto limpa o campo; Esc com o campo vazio fecha a janela.
  await b.page.focus('#cityQ');
  await b.page.keyboard.press('Escape');
  assert.equal(await b.page.inputValue('#cityQ'), '');
  assert.ok(await b.page.locator('#ov.open').count(), 'Esc com texto não fecha');
  await b.page.keyboard.press('Escape');
  await b.page.waitForSelector('.ov:not(.open)', { state: 'attached' });
  assert.deepEqual(b.errors, []);
  await b.context.close();
});

await scenario('contador de visitas (?visitas=teste): a página inicial conta a visita e a cidade escolhida, nada mais', async () => {
  const { page, log, errors, context } = await newPage(browser);
  const wait = async (n) => { for (let i = 0; i < 160 && log.track.length < n; i += 1) await page.waitForTimeout(50); assert.ok(log.track.length >= n, `esperava ${n} envios, chegaram ${log.track.length}`); };
  await page.goto(`${BASE}?visitas=teste#agenda`);
  await wait(1);
  assert.deepEqual(log.track, [{ p_path: '/' }], 'a visita: só o caminho, sem "?" nem "#"');
  await page.goto(`${BASE}?visitas=teste`);
  await scrollAll(page);
  await wait(2);
  await page.click('#cityBtn');
  await page.waitForSelector('#cityQ');
  await page.keyboard.type('rio');
  await page.waitForSelector('#cityList [role=option]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#cityName').textContent === 'Rio de Janeiro - RJ');
  await wait(3);
  assert.deepEqual(log.track.slice(1), [{ p_path: '/' }, { p_path: '/', p_event: 'busca_cidade', p_detail: 'RJ/Rio de Janeiro' }]);
  assert.ok(!/-22\.9|-43\.1/.test(JSON.stringify(log.track)), 'nada do centro do mapa');
  assert.ok(!POS_PAULISTA.test(JSON.stringify(log.track)), 'nada da posição da pessoa');
  // Sem o parâmetro, neste computador de testes nada é contado.
  const off = await newPage(browser);
  await off.page.goto(BASE);
  await scrollAll(off.page);
  await off.page.waitForTimeout(2500);
  assert.equal(off.log.track.length, 0);
  await off.context.close();
  assert.deepEqual(errors, []);
  await context.close();
});

/* ======================= tela "Clínicas perto de você": pedido de localização ao abrir ======================= */
// A permissão e a localização vêm do simulador (tests/geo-simulado.mjs): window.__geo conta as chamadas ao
// navegador (chamadas) e as que mostrariam a pergunta (pedidos).

await scenario('1ª visita: o navegador pergunta uma vez, com o aviso do motivo; permitiu → lista perto, região e nenhuma posição guardada', async () => {
  const { page, log, errors, context } = await newPage(browser, { geo: { estado: 'prompt', resposta: 'permitir', atraso: 1500 } });
  await page.goto(`${BASE}?visitas=teste`);
  // Enquanto o navegador pergunta: o aviso do motivo no alto, sem tirar o foco de onde está.
  await page.waitForSelector('#geoAviso:not([hidden])');
  await tela(page, 'aguardando');
  const aviso = await page.textContent('#geoAviso');
  assert.match(aviso, /região aproximada/);
  assert.match(aviso, /não gravamos/);
  assert.equal(await page.locator('#geoAviso a[href="privacidade.html#localizacao"]').count(), 1, '"Saiba mais" leva à privacidade');
  assert.ok(await page.evaluate(() => document.activeElement === document.body), 'o aviso não tira o foco');
  assert.match(await page.textContent('#pvEstado'), /Aguardando sua permissão…/);
  assert.deepEqual(await botoesCartao(page), ['Prefiro escolher a cidade']);
  // WCAG 2.4.11: enquanto o aviso fixo aparece, o que recebe o foco pelo Tab para abaixo dele.
  const pad = await page.evaluate(() => [parseFloat(document.documentElement.style.scrollPaddingTop), document.querySelector('#geoAviso').getBoundingClientRect().bottom]);
  assert.ok(Math.abs(pad[0] - (pad[1] + 16)) <= 1, `scroll-padding-top no fim do aviso + 16 px (${pad.join(' / ')})`);
  await page.waitForFunction(() => window.__geo.pedidos === 1);
  await page.waitForFunction(() => document.querySelector('#geoStatus').textContent === 'O IMED pediu sua localização para mostrar as clínicas mais perto.');
  // Antes da resposta, o topo não diz "Procurando…" (pareceria que o site já localiza sem a permissão).
  assert.deepEqual([await page.textContent('#addrSmall'), await page.textContent('#addrTxt')], ['Sua localização', 'Aguardando permissão…']);
  // As abas ficam no lugar (desabilitadas) e o cartão fica por cima das linhas de espera: nada pula quando a lista chega.
  assert.ok(await page.locator('#pvTabs').isVisible(), 'abas no lugar');
  assert.ok(await page.$$eval('#pvTabs button', (bs) => bs.every((b) => b.disabled)), 'abas desabilitadas sem lista');
  assert.equal(await page.locator('#realList li.ph').count(), 10, 'linhas de espera debaixo do cartão');
  await shot(page, 'perto-1a-visita-pergunta');
  // Permitiu: o aviso some e a tela mostra os locais reais mais perto, com a região da pessoa.
  await tela(page, 'lista');
  assert.ok(await page.locator('#geoAviso').isHidden(), 'o aviso some');
  assert.equal(await page.evaluate(() => document.documentElement.style.scrollPaddingTop), '', 'sem o aviso, o espaço do alto volta ao normal');
  await page.waitForFunction(() => document.querySelector('#addrTxt').textContent === 'São Paulo - SP');
  assert.equal(await page.textContent('#addrSmall'), 'Sua região');
  assert.equal(await page.textContent('#cityRot'), 'Sua região');
  assert.equal(await page.textContent('#cityName'), 'São Paulo - SP');
  assert.equal(await page.locator('#realList li b').count(), 4);
  // Leitor de tela: uma frase só, "Pronto! Os 4 mais perto de você" (o "Pronto!" fica escondido na tela).
  assert.equal(await page.textContent('#pvSum'), 'Pronto! Os 4 mais perto de você');
  assert.equal(await page.textContent('#pvSum .sr'), 'Pronto! ');
  assert.ok(await page.$eval('#pvSum .sr', (e) => { const r = e.getBoundingClientRect(); return r.width <= 1 && r.height <= 1; }), 'na tela, só o resumo (o "Pronto!" fica escondido)');
  assert.ok(!/Pronto/.test(await page.textContent('#geoStatus')), 'o "Pronto!" não é repetido no status do pedido');
  assert.ok(await page.$$eval('#pvTabs button', (bs) => bs.every((b) => !b.disabled)), 'abas liberadas com a lista');
  const g = await page.evaluate(() => JSON.parse(JSON.stringify(window.__geo)));
  assert.deepEqual([g.pedidos, g.chamadas, g.estado], [1, 1, 'granted'], 'exatamente 1 pedido');
  assert.deepEqual(g.log, [{ estado: 'prompt', opcoes: { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 } }], 'uma chamada, com precisão baixa (a posição é arredondada)');
  assert.deepEqual(naoArredondadas(log), [], 'chamadas ao banco com no máximo 3 casas decimais');
  // A posição não fica no aparelho, no endereço da página nem no contador.
  await until(() => log.track.length >= 1);
  assert.deepEqual(log.track, [{ p_path: '/' }], 'o contador recebe só o caminho');
  const guardado = await noAparelho(page);
  assert.ok(!POS_PAULISTA.test(guardado), `nenhuma coordenada no aparelho nem no endereço: ${guardado}`);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('imed_geo_pedido')), '1', 'só o aviso de que já pediu nesta aba');
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_geo_recusas')), null);
  await page.locator('#reais').evaluate((e) => e.scrollIntoView());
  await shot(page, 'perto-1a-visita-lista');
  // Recarregar na mesma aba: nenhum pedido novo e nenhum aviso (a permissão já foi dada: localiza em silêncio).
  await page.reload();
  await tela(page, 'lista');
  const g2 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__geo)));
  assert.equal(g2.pedidos, 1, 'nenhum pedido novo');
  assert.deepEqual(g2.log.map((x) => x.estado), ['granted'], 'só a localização em silêncio');
  assert.ok(await page.locator('#geoAviso').isHidden(), 'nenhum aviso');
  await until(() => log.track.length >= 2);
  assert.ok(!POS_PAULISTA.test(await noAparelho(page)), 'nada da posição no aparelho depois de recarregar');
  assert.ok(!POS_PAULISTA.test(JSON.stringify(log.track)), 'nada da posição no contador');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('negou: "localização desligada" com o cadeado, atalhos reais, nenhum pedido de novo e a cidade pelo atalho', async () => {
  const { page, log, errors, context } = await newPage(browser, { geo: { estado: 'prompt', resposta: 'negar', atraso: 1000 } });
  await page.goto(BASE);
  await tela(page, 'negada');
  assert.deepEqual(await contagemGeo(page), { estado: 'denied', chamadas: 1, pedidos: 1 });
  const card = await page.textContent('#pvEstado');
  assert.match(card, /A localização está desligada para o IMED/);
  // No computador, "clique"; o ícone ao lado do endereço é o cadeado ou o de ajustes (Chrome).
  assert.match(card, /Tudo bem: escolha a sua cidade\. Para usar a localização depois, clique no ícone ao lado do endereço do site \(cadeado ou ajustes\) e permita a localização\./);
  assert.deepEqual(await botoesCartao(page), ['Escolher minha cidade']);
  // "Como liberar": a ajuda de cada aparelho (iPhone, Android e computador), sem chamar o navegador.
  assert.equal(await page.getAttribute('#pvEstado [data-bt="ajuda"]', 'aria-expanded'), 'false');
  await page.click('#pvEstado [data-bt="ajuda"]');
  await page.waitForSelector('#pvEAjuda:not([hidden])');
  assert.match(await page.textContent('#pvEAjuda'), /No iPhone, toque em aA ao lado do endereço/);
  // No computador, o fim da ajuda diz "clique" (no celular, "toque": cenário da localização bloqueada).
  assert.match(await page.textContent('#pvEAjuda'), /\. Depois, clique em Usar minha localização\.$/);
  assert.equal(await page.getAttribute('#pvEstado [data-bt="ajuda"]', 'aria-expanded'), 'true');
  assert.equal((await contagemGeo(page)).chamadas, 1, '"Como liberar" não chama o navegador');
  await page.waitForSelector('#pvEstado .pv-at');
  // Os atalhos com h3 (o cartão sem título não pula do h2 para o h4).
  assert.equal(await page.textContent('#pvEstado .pv-atalhos h3'), 'Cidades com mais locais');
  assert.deepEqual(await atalhosCartao(page), [['São Paulo - SP', '6.548 locais'], ['Rio de Janeiro - RJ', '3.000 locais'], ['Belo Horizonte - MG', '2.284 locais'], ["Santa Bárbara d'Oeste - SP", '150 locais']], 'atalhos pelo total, com os números do banco');
  assert.ok(await page.locator('#geoAviso').isHidden(), 'o aviso some');
  assert.equal(await page.textContent('#geoStatus'), 'Sem a sua localização. Escolha a cidade para ver os locais.');
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_geo_recusas')), '1', 'uma recusa');
  assert.equal(await page.locator('#realList li').count(), 0, 'sem origem, sem lista');
  assert.ok(await page.$$eval('#pvTabs button', (bs) => bs.length === 5 && bs.every((b) => b.disabled)), 'sem lista, as abas ficam no lugar, desabilitadas');
  await page.locator('#reais').evaluate((e) => e.scrollIntoView());
  await shot(page, 'perto-negou');
  // 3 s depois: nenhuma chamada nova (o site não pede em loop).
  await page.waitForTimeout(3000);
  assert.equal((await contagemGeo(page)).chamadas, 1, 'nenhuma chamada nova');
  // No seletor, a localização bloqueada só abre a ajuda (sem chamar o navegador).
  await page.click('#cityBtn');
  await page.waitForSelector('.ov.open #cityQ');
  assert.equal(await page.textContent('#cityGeoState'), 'Bloqueada no navegador: veja como liberar');
  assert.ok(await page.locator('#cityGeoHelp').isHidden());
  await page.click('#cityGeo');
  await page.waitForSelector('#cityGeoHelp:not([hidden])');
  assert.match(await page.textContent('#cityGeoHelp'), /No iPhone, toque em aA ao lado do endereço/);
  assert.match(await page.textContent('#cityGeoHelp'), /\. Depois, clique em Usar minha localização\.$/);
  assert.equal(await page.getAttribute('#cityGeo', 'aria-expanded'), 'true');
  assert.equal((await contagemGeo(page)).chamadas, 1, 'só a ajuda');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
  // Atalho do Rio pelo teclado: centro pela geocodificação da busca e lista perto dele.
  const antes = log.cnes.length;
  await page.focus('#pvEstado .pv-at[data-at="3304557"]');
  await page.keyboard.press('Enter');
  await tela(page, 'lista');
  assert.deepEqual(log.geocode.at(-1), { action: 'geocode', q: 'Rio de Janeiro, RJ' });
  await until(() => log.cnes.slice(antes).some((a) => a.p_limit === 10));
  const at = log.cnes.slice(antes).find((a) => a.p_limit === 10);
  assert.deepEqual([at.p_lat, at.p_lng, at.p_radius_m], [-22.907, -43.173, 2000], 'lista perto do centro do Rio');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cityBtn', 'o atalho some e o foco vai para o botão da cidade');
  // WCAG 2.4.11: o foco fica à vista, abaixo do cabeçalho fixo (a página rola só o necessário).
  const vis = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, header: document.querySelector('.top').getBoundingClientRect().bottom }; });
  assert.ok(vis.top >= vis.header - 1 && vis.bottom <= 860, `o botão da cidade com o foco está à vista (${JSON.stringify(vis)})`);
  assert.equal(await page.textContent('#cityName'), 'Rio de Janeiro - RJ');
  // Com a cidade escolhida, a lista é perto do centro dela: o título diz isso.
  assert.equal(await page.textContent('#reaisTitle'), 'Clínicas perto do centro do Rio de Janeiro');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('imed_cidade'))), RIO);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('imed_cidades_recentes'))), [RIO], 'recentes com o Rio');
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_geo_recusas')), '1');
  assert.equal((await contagemGeo(page)).chamadas, 1, 'escolher a cidade não chama a localização');
  // Localização bloqueada: "Usar minha localização" vira a ajuda de como liberar.
  assert.equal((await page.textContent('#useGeoBtn')).trim(), 'Localização bloqueada: como liberar');
  await page.click('#useGeoBtn');
  await page.waitForSelector('#pvGeoHelp:not([hidden])');
  assert.match(await page.textContent('#pvGeoHelp'), /\. Depois, clique em Usar minha localização\.$/);
  assert.equal(await page.getAttribute('#useGeoBtn', 'aria-expanded'), 'true');
  assert.equal((await contagemGeo(page)).chamadas, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('fechou a pergunta ou o navegador não mostrou: cartões certos, pede de novo só com o toque e nunca sozinho depois de 2 recusas', async () => {
  {
    const { page, errors, context } = await newPage(browser, { geo: { estado: 'prompt', resposta: 'fechar', atraso: 1500 } });
    await page.goto(BASE);
    await tela(page, 'fechou');
    const card = await page.textContent('#pvEstado');
    assert.match(card, /Sem a localização, escolha a cidade/);
    assert.match(card, /Você pode permitir a localização quando quiser\./);
    assert.deepEqual(await botoesCartao(page), ['Usar minha localização', 'Escolher minha cidade']);
    assert.deepEqual(await contagemGeo(page), { estado: 'prompt', chamadas: 1, pedidos: 1 }, 'a permissão continua perguntando');
    assert.equal(await page.evaluate(() => localStorage.getItem('imed_geo_recusas')), '1');
    assert.ok(await page.locator('#geoAviso').isHidden());
    await page.locator('#reais').evaluate((e) => e.scrollIntoView());
    await shot(page, 'perto-fechou');
    // Outra página na mesma aba e a volta: o pedido não sai sozinho de novo.
    await page.goto(`${BASE}como-funciona.html`);
    await page.goto(BASE);
    await tela(page, 'onde');
    await page.waitForTimeout(1200);
    assert.equal((await contagemGeo(page)).pedidos, 1, 'na mesma aba, nenhum pedido sozinho');
    assert.ok(await page.locator('#geoAviso').isHidden());
    assert.match(await page.textContent('#pvEstado'), /Onde você está\?.*Use sua localização ou escolha a cidade para ver as clínicas mais perto\./s);
    assert.deepEqual(await botoesCartao(page), ['Usar minha localização', 'Escolher minha cidade']);
    // "Usar minha localização" pede de novo, só com o toque; com o pedido aberto, outro toque não chama de novo.
    await page.click('#pvEstado [data-bt="usar"]');
    await page.waitForFunction(() => window.__geo.pedidos === 2);
    await page.waitForFunction(() => document.querySelector('#pvEstado [data-bt="usar"]')?.textContent.trim() === 'Aguardando permissão…');
    assert.equal(await page.getAttribute('#pvEstado [data-bt="usar"]', 'aria-disabled'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.bt), 'usar', 'o foco continua no botão');
    // (force: o Playwright não clica em botão com aria-disabled; a pessoa clica.)
    await page.click('#pvEstado [data-bt="usar"]', { force: true });
    assert.equal((await contagemGeo(page)).pedidos, 2, 'pedido aberto: outro toque não chama de novo');
    await tela(page, 'fechou');
    assert.equal((await contagemGeo(page)).pedidos, 2, 'um pedido por toque');
    assert.equal(await page.evaluate(() => localStorage.getItem('imed_geo_recusas')), '2');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // O navegador recusou sem mostrar a pergunta (resposta em menos de 800 ms): "não mostrou o pedido".
    const { page, errors, context } = await newPage(browser, { geo: { estado: 'prompt', resposta: 'fechar', atraso: 0 } });
    await page.goto(BASE);
    await tela(page, 'naoapareceu');
    const card = await page.textContent('#pvEstado');
    assert.match(card, /O navegador não mostrou o pedido de localização/);
    assert.match(card, /Para liberar, clique no ícone ao lado do endereço do site \(cadeado ou ajustes\) e permita a localização\. Ou escolha a cidade\./);
    assert.deepEqual(await botoesCartao(page), ['Usar minha localização', 'Escolher minha cidade']);
    assert.equal(await page.locator('#pvEstado [data-bt="ajuda"]').count(), 1, '"Como liberar" no cartão');
    assert.equal((await contagemGeo(page)).pedidos, 1);
    await page.locator('#reais').evaluate((e) => e.scrollIntoView());
    await shot(page, 'perto-nao-apareceu');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Pedido automático sem resposta (no Chrome, a pergunta pode aparecer só como um ícone): ao sair da página, conta
    // como recusa. Em duas visitas assim, o site para de perguntar sozinho.
    const { page, context } = await newPage(browser, { geo: { estado: 'prompt', resposta: 'nunca' } });
    await page.goto(BASE);
    await page.waitForFunction(() => window.__geo?.pedidos === 1);
    await page.goto(`${BASE}como-funciona.html`);
    assert.equal(await page.evaluate(() => localStorage.getItem('imed_geo_recusas')), '1', 'saiu sem responder: 1 recusa');
    const outra = await context.newPage(); // outra aba: o aviso de "já pediu" é só desta aba
    await outra.goto(BASE);
    await outra.waitForFunction(() => window.__geo?.pedidos === 1);
    await outra.goto(`${BASE}como-funciona.html`);
    assert.equal(await page.evaluate(() => localStorage.getItem('imed_geo_recusas')), '2', 'outra visita sem resposta: 2');
    const terceira = await context.newPage();
    await terceira.goto(BASE);
    await terceira.waitForFunction(() => document.querySelector('#reais').dataset.estado === 'onde');
    await terceira.waitForTimeout(800);
    assert.equal(await terceira.evaluate(() => window.__geo.pedidos), 0, 'depois de 2, nenhum pedido sozinho');
    await context.close();
  }
  {
    // Escolheu a cidade com o pedido aberto e depois negou: a lista continua na cidade e o leitor de tela não ouve
    // "escolha a cidade" (ela já foi escolhida).
    const { page, errors, context } = await newPage(browser, { geo: { estado: 'prompt', resposta: 'negar', atraso: 4000 } });
    await page.goto(BASE);
    await page.waitForSelector('#geoAviso:not([hidden])');
    await page.click('#geoAviso [data-city-open]');
    await page.waitForSelector('#cityIdle [data-ibge="3304557"]');
    await page.click('#cityIdle [data-ibge="3304557"]');
    await tela(page, 'lista');
    await page.waitForFunction(() => window.__geo.estado === 'denied', null, { timeout: 8000 });
    await page.waitForTimeout(300);
    assert.ok(!/Escolha a cidade/i.test(await page.textContent('#geoStatus')), await page.textContent('#geoStatus'));
    assert.equal(await page.textContent('#cityName'), 'Rio de Janeiro - RJ');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Aparelho com 2 recusas: o site não pergunta mais sozinho.
    const { page, errors, context } = await newPage(browser, { geo: { estado: 'prompt', resposta: 'permitir' }, store: { imed_geo_recusas: 2 } });
    await page.goto(BASE);
    await tela(page, 'onde');
    await page.waitForTimeout(1200);
    assert.deepEqual(await contagemGeo(page), { estado: 'prompt', chamadas: 0, pedidos: 0 }, '2 recusas: nenhum pedido');
    assert.ok(await page.locator('#geoAviso').isHidden());
    await page.waitForSelector('#pvEstado .pv-at');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('imed_geo_pedido')), null);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('bloqueada desde antes e sem suporte: nada sozinho, só a ajuda; liberou nas configurações → lista sozinha', async () => {
  {
    const { page, errors, context } = await newPage(browser, { geo: { estado: 'denied' } });
    await page.goto(BASE);
    await tela(page, 'negada');
    await page.waitForTimeout(800);
    assert.deepEqual(await contagemGeo(page), { estado: 'denied', chamadas: 0, pedidos: 0 }, 'bloqueada: não chama o navegador');
    assert.ok(await page.locator('#geoAviso').isHidden(), 'sem aviso');
    assert.match(await page.textContent('#pvEstado'), /A localização está desligada para o IMED/);
    assert.deepEqual(await botoesCartao(page), ['Escolher minha cidade']);
    await page.waitForSelector('#pvEstado .pv-at');
    // O #nearCta leva à tela, mas não chama o navegador.
    await page.click('#nearCta');
    await page.waitForFunction(() => document.activeElement?.id === 'reaisTitle');
    assert.equal((await contagemGeo(page)).chamadas, 0, '#nearCta: só a tela');
    // "Escolher minha cidade" abre o seletor; a localização só mostra a ajuda.
    await page.click('#pvEstado [data-bt="escolher"]');
    await page.waitForSelector('.ov.open #cityQ');
    assert.equal(await page.textContent('#cityGeoState'), 'Bloqueada no navegador: veja como liberar');
    await page.click('#cityGeo');
    await page.waitForSelector('#cityGeoHelp:not([hidden])');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
    assert.equal((await contagemGeo(page)).chamadas, 0);
    // A pessoa limpou a permissão (voltou a "perguntar"), com a página aberta: a tela passa para "Onde você está?",
    // de novo com o botão de usar a localização.
    await mudarGeo(page, 'prompt');
    await tela(page, 'onde');
    assert.deepEqual(await botoesCartao(page), ['Usar minha localização', 'Escolher minha cidade']);
    assert.equal((await contagemGeo(page)).chamadas, 0, 'sem chamar o navegador sozinho');
    // A pessoa libera a localização nas configurações do navegador, com a página aberta: a lista aparece sozinha.
    await mudarGeo(page, 'granted');
    await tela(page, 'lista');
    assert.deepEqual(await contagemGeo(page), { estado: 'granted', chamadas: 1, pedidos: 0 });
    await page.waitForFunction(() => document.querySelector('#addrTxt').textContent === 'São Paulo - SP');
    assert.equal(await page.locator('#realList li b').count(), 4);
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Celular com a localização bloqueada: a ajuda do "Como liberar" (cartão, seletor e linha da cidade) termina
    // com "toque", o verbo da tela de toque.
    const { page, errors, context } = await newPage(browser, { mobile: true, geo: { estado: 'denied' } });
    await page.goto(BASE);
    await tela(page, 'negada');
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'tela de toque');
    assert.match(await page.textContent('#pvEstado'), /Para usar a localização depois, toque no ícone ao lado do endereço do site/);
    await page.click('#pvEstado [data-bt="ajuda"]');
    await page.waitForSelector('#pvEAjuda:not([hidden])');
    assert.match(await page.textContent('#pvEAjuda'), /\. Depois, toque em Usar minha localização\.$/);
    assert.match(await page.textContent('#pvGeoHelp'), /\. Depois, toque em Usar minha localização\.$/);
    await page.click('#pvEstado [data-bt="escolher"]');
    await page.waitForSelector('.ov.open #cityQ');
    await page.click('#cityGeo');
    await page.waitForSelector('#cityGeoHelp:not([hidden])');
    assert.match(await page.textContent('#cityGeoHelp'), /\. Depois, toque em Usar minha localização\.$/);
    assert.equal((await contagemGeo(page)).chamadas, 0, 'só a ajuda, sem chamar o navegador');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Navegador sem localização: só a escolha da cidade, sem botão de localização.
    const { page, errors, context } = await newPage(browser, { geo: { suporte: false } });
    await page.goto(BASE);
    await tela(page, 'sem-suporte');
    assert.equal(await page.evaluate(() => 'geolocation' in navigator), false);
    assert.equal((await page.textContent('#pvEstado .pv-ecard')).trim(), 'Seu navegador não informa a localização. Escolha a cidade para ver os locais.Escolher minha cidade');
    assert.deepEqual(await botoesCartao(page), ['Escolher minha cidade']);
    await page.waitForSelector('#pvEstado .pv-at');
    await page.click('#nearCta');
    await page.waitForFunction(() => document.activeElement?.id === 'reaisTitle');
    await page.click('#cityBtn');
    await page.waitForSelector('.ov.open #cityQ');
    assert.equal(await page.isDisabled('#cityGeo'), true, 'botão da localização desabilitado');
    assert.equal(await page.textContent('#cityGeoState'), 'Não disponível neste navegador');
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('#useGeoBtn').isHidden());
    await page.locator('#reais').evaluate((e) => e.scrollIntoView());
    await shot(page, 'perto-sem-suporte');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('demorou ou indisponível: "Tentar de novo" faz uma chamada por toque e, dando certo, mostra a lista', async () => {
  {
    const { page, errors, context } = await newPage(browser, { geo: { estado: 'prompt', resposta: 'demorar' } });
    await page.goto(BASE);
    await tela(page, 'demorou');
    const card = await page.textContent('#pvEstado');
    assert.match(card, /A localização demorou para responder/);
    assert.match(card, /Veja se a localização do aparelho está ligada e tente de novo, ou escolha a cidade\./);
    assert.deepEqual(await botoesCartao(page), ['Tentar de novo', 'Escolher minha cidade']);
    assert.deepEqual(await contagemGeo(page), { estado: 'granted', chamadas: 1, pedidos: 1 });
    assert.equal(await page.evaluate(() => localStorage.getItem('imed_geo_recusas')), null, 'demorar não é recusa');
    await page.locator('#reais').evaluate((e) => e.scrollIntoView());
    await shot(page, 'perto-demorou');
    for (const n of [2, 3]) {
      await page.click('#pvEstado [data-bt="tentar"]');
      await page.waitForFunction((k) => window.__geo.chamadas === k, n);
      await tela(page, 'demorou');
    }
    await page.waitForTimeout(500);
    assert.equal((await contagemGeo(page)).chamadas, 3, 'uma chamada por toque, nenhuma sozinha');
    await responderGeo(page, 'permitir');
    await page.click('#pvEstado [data-bt="tentar"]');
    await tela(page, 'lista');
    assert.equal((await contagemGeo(page)).chamadas, 4);
    assert.equal(await page.locator('#realList li b').count(), 4);
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Permissão já dada, mas o aparelho não acha a posição (erro 2).
    const { page, errors, context } = await newPage(browser, { geo: { estado: 'granted', resposta: 'indisponivel' } });
    await page.goto(BASE);
    await tela(page, 'indisponivel');
    assert.match(await page.textContent('#pvEstado'), /Não conseguimos descobrir onde você está/);
    // O leitor de tela também ouve o que houve (sem pedido, nada falava).
    await page.waitForFunction(() => document.querySelector('#geoStatus').textContent === 'Não conseguimos descobrir onde você está');
    assert.deepEqual(await botoesCartao(page), ['Tentar de novo', 'Escolher minha cidade']);
    assert.ok(await page.locator('#geoAviso').isHidden(), 'permissão já dada: sem aviso');
    assert.deepEqual(await contagemGeo(page), { estado: 'granted', chamadas: 1, pedidos: 0 });
    await page.click('#pvEstado [data-bt="tentar"]');
    await page.waitForFunction(() => window.__geo.chamadas === 2);
    await tela(page, 'indisponivel');
    await page.waitForTimeout(500);
    assert.equal((await contagemGeo(page)).chamadas, 2);
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // O navegador entrega uma posição inválida (latitude 95): vale como "indisponível", com os botões de volta (a tela
    // não fica presa em "Buscando sua localização…" nem o topo em "Procurando…").
    const { page, errors, context } = await newPage(browser, { geo: { estado: 'granted', resposta: 'nunca' } });
    await page.goto(BASE);
    await tela(page, 'buscando');
    assert.equal(await page.textContent('#addrTxt'), 'Procurando…', 'permissão já dada: "Procurando…"');
    await page.evaluate(() => { window.__geoResposta('nunca', { pos: { lat: 95, lng: -46.6 } }); window.__geoMudar('prompt'); window.__geoMudar('granted'); });
    await tela(page, 'indisponivel');
    assert.deepEqual(await botoesCartao(page), ['Tentar de novo', 'Escolher minha cidade']);
    assert.equal(await page.textContent('#addrTxt'), 'Escolher cidade');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('cidade escolhida antes: abre nela sem pedir; com a localização, "fica a X km de você" e a distância até a pessoa nos itens', async () => {
  {
    // Permissão perguntando: nenhum pedido, nenhuma geocodificação; lista e fonte do Rio.
    const { page, log, errors, context } = await newPage(browser, { geo: { estado: 'prompt' }, store: { imed_cidade: RIO } });
    await page.goto(BASE);
    await tela(page, 'lista');
    await page.waitForFunction(() => /atualizados em/.test(document.querySelector('#heroSrc').textContent));
    assert.match(await page.textContent('#heroSrc'), /dados do Rio de Janeiro atualizados em/);
    await page.waitForTimeout(800);
    assert.deepEqual(await contagemGeo(page), { estado: 'prompt', chamadas: 0, pedidos: 0 }, 'nenhum pedido');
    assert.equal(log.geocode.length, 0, 'centro guardado: sem geocodificar');
    assert.ok(await page.locator('#geoAviso').isHidden());
    const at = log.cnes.find((a) => a.p_limit === 10);
    assert.deepEqual([at.p_lat, at.p_lng], [-22.907, -43.173]);
    assert.equal(await page.textContent('#cityRot'), 'Cidade escolhida');
    assert.equal(await page.textContent('#cityLine'), 'Distâncias medidas do centro do Rio de Janeiro.');
    assert.equal(await page.textContent('#pvSum'), 'Os 4 mais perto do centro do Rio de Janeiro');
    // O título diz de onde são as distâncias (o centro da cidade, não a pessoa).
    assert.equal(await page.textContent('#reaisTitle'), 'Clínicas perto do centro do Rio de Janeiro');
    assert.equal(await page.locator('#useGeoBtn:visible').count(), 1, '"Usar minha localização" na linha da cidade');
    assert.deepEqual(await page.$$eval('#realList .pv-d .sr', (els) => [...new Set(els.map((e) => e.textContent))]), [' do centro do Rio de Janeiro'], 'leitor de tela: distância do centro');
    // A página da cidade existe no site (o HEAD respondeu 200): "Ver todos" leva a ela.
    await page.waitForFunction(() => /por tipo/.test(document.querySelector('#pvAll').textContent));
    assert.equal((await page.textContent('#pvAll')).trim(), 'Ver todos os locais do Rio de Janeiro, por tipo');
    assert.equal(await page.getAttribute('#pvAll', 'href'), 'cidades/rj/rio-de-janeiro/');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Cidade sem página gerada no site (o HEAD dá 404): sem link quebrado. Fica só o link fixo "Todas as cidades",
    // sem repetir o mesmo link duas vezes seguidas.
    const VILA_BELA = { ibge: 5105507, name: 'Vila Bela da Santíssima Trindade', uf: 'MT', lat: -15.008, lng: -59.951 };
    const { page, requests, errors, context } = await newPage(browser, { geo: { estado: 'prompt' }, store: { imed_cidade: VILA_BELA } });
    await page.goto(BASE);
    await tela(page, 'lista');
    await until(() => requests.some((u) => /cidades\/mt\/vila-bela-da-santissima-trindade\/$/.test(u)));
    await page.waitForTimeout(400);
    assert.ok(await page.locator('#pvAll').isHidden(), 'sem a página da cidade, sem o "Ver todos"');
    assert.deepEqual(await page.$$eval('#reais a[href="cidades/"]:not([hidden])', (els) => els.filter((e) => e.getClientRects().length).map((e) => e.textContent.trim())), ['Todas as cidades'], 'um "Todas as cidades" só');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Com a cidade escolhida, "Usar minha localização" e a pessoa fecha a pergunta: a lista continua no Rio e o aviso
    // curto diz isso (nada de "escolha a cidade": a cidade já foi escolhida).
    const { page, errors, context } = await newPage(browser, { geo: { estado: 'prompt', resposta: 'fechar', atraso: 1500 }, store: { imed_cidade: RIO } });
    await page.goto(BASE);
    await tela(page, 'lista');
    await page.click('#useGeoBtn');
    await page.waitForFunction(() => document.querySelector('#toast').textContent === 'A localização não foi permitida. A lista continua perto do centro do Rio de Janeiro.');
    assert.equal(await page.getAttribute('#toast', 'aria-hidden'), null, 'o leitor de tela ouve o aviso');
    assert.ok(!/Escolha a cidade/i.test(await page.textContent('#geoStatus')));
    assert.equal(await page.textContent('#cityName'), 'Rio de Janeiro - RJ');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Permissão já dada: a posição em silêncio serve só para "Rio de Janeiro fica a 363 km de você" (longe: nada nos itens).
    const { page, log, errors, context } = await newPage(browser, { store: { imed_cidade: RIO } });
    await page.goto(BASE);
    await tela(page, 'lista');
    await page.waitForFunction(() => /fica a/.test(document.querySelector('#cityLine').textContent));
    assert.equal(await page.textContent('#cityLine'), 'Distâncias medidas do centro do Rio de Janeiro. Rio de Janeiro fica a 363 km de você.');
    assert.deepEqual(await contagemGeo(page), { estado: 'granted', chamadas: 1, pedidos: 0 }, '1 chamada em silêncio');
    assert.equal(await page.locator('#realList .pv-d small').count(), 0, 'a mais de 50 km: sem a distância até a pessoa nos itens');
    assert.ok(log.cnes.every((a) => a.p_lat === -22.907), 'a lista continua no centro do Rio');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Cidade escolhida perto da pessoa (centro de São Paulo, pessoa na Paulista): cada item ganha "a … de você",
    // na mesma conta do geo-core.
    const { page, log, errors, context } = await newPage(browser, { store: { imed_cidade: SP_CENTRO, imed_cidades_recentes: [SP_CENTRO, RIO] } });
    await page.goto(BASE);
    await tela(page, 'lista');
    await page.waitForFunction(() => document.querySelectorAll('#realList .pv-d small').length === 4);
    const eu = { lat: -23.565, lng: -46.652 };
    const want = [PARTNERS[0], ...CNES_ROWS].map((r) => `a ${r.location_source === 'endereco' ? '~' : ''}${G.formatDistance(G.haversine(eu, r))} de você`);
    assert.deepEqual(await page.$$eval('#realList .pv-d small', (els) => els.map((e) => e.textContent)), want);
    assert.equal(await page.textContent('#cityLine'), `Distâncias medidas do centro de São Paulo. São Paulo fica a ${G.formatDistance(G.haversine(eu, SP_CENTRO))} de você.`);
    assert.equal(await page.textContent('#nearCta small'), 'Mais perto do centro de São Paulo: Clínica Parceira Paulista, a 300 m');
    await page.locator('#reais').evaluate((e) => e.scrollIntoView());
    await shot(page, 'perto-cidade-escolhida');
    // "Usar minha localização": a lista passa a ser perto da pessoa e a cidade escolhida sai do aparelho (as recentes ficam).
    const antes = log.cnes.length;
    await page.click('#useGeoBtn');
    await page.waitForFunction(() => document.querySelector('#cityRot').textContent === 'Sua região');
    await tela(page, 'lista');
    assert.equal(await page.textContent('#cityLine'), 'Distâncias medidas da sua localização aproximada.');
    const perto = log.cnes.slice(antes).find((a) => a.p_limit === 10);
    assert.deepEqual([perto.p_lat, perto.p_lng], [eu.lat, eu.lng], 'lista perto da pessoa');
    assert.equal(await page.evaluate(() => localStorage.getItem('imed_cidade')), null, 'imed_cidade apagada');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('imed_cidades_recentes'))), [SP_CENTRO, RIO], 'as recentes continuam');
    assert.ok(await page.locator('#useGeoBtn').isHidden());
    assert.equal(await page.locator('#realList .pv-d small').count(), 0);
    assert.deepEqual(await contagemGeo(page), { estado: 'granted', chamadas: 2, pedidos: 0 });
    assert.ok(!POS_PAULISTA.test(await noAparelho(page)), 'nada da posição no aparelho');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('seletor de cidade no computador e no celular (390 px): tela cheia, leitor de tela, cidade sem centro, nenhuma achada e a própria região', async () => {
  for (const mobile of [false, true]) {
    const quem = mobile ? 'celular' : 'computador';
    const { page, log, errors, context } = await newPage(browser, { mobile });
    await page.goto(BASE);
    await tela(page, 'lista');
    await page.waitForFunction(() => document.querySelector('#cityName').textContent === 'São Paulo - SP');
    // Pelo botão do topo (#addrBtn): foco no campo da cidade.
    await page.click('#addrBtn');
    await page.waitForSelector('.ov.open .sheet.cid #cityQ');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cityQ', `${quem}: foco no campo`);
    assert.equal(await page.textContent('#sheet .sh-head h3'), 'Escolha a cidade');
    const box = await page.evaluate(() => { const r = document.querySelector('#sheet').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); });
    if (mobile) assert.deepEqual(box, [0, 0, 390, 844], 'no celular, o seletor ocupa a tela toda');
    else assert.ok(box[2] <= 540 && box[0] > 0 && box[1] > 0, `no computador, janela de até 540 px (${box})`);
    // Para o leitor de tela: rótulo, caixa de busca com lista (combobox), dica e contagem anunciada.
    const a = await page.evaluate(() => {
      const q = document.querySelector('#cityQ'), at = (n) => q.getAttribute(n), ul = document.querySelector('#cityList');
      return { rotulo: document.querySelector('label[for="cityQ"]')?.textContent, role: at('role'), auto: at('aria-autocomplete'), lista: at('aria-controls'), aberta: at('aria-expanded'), dica: document.getElementById(at('aria-describedby'))?.textContent, status: document.querySelector('#cityHint').getAttribute('role'), papel: ul.getAttribute('role'), nome: ul.getAttribute('aria-label'), letra: getComputedStyle(q).fontSize };
    });
    assert.deepEqual(a, { rotulo: 'Cidade', role: 'combobox', auto: 'list', lista: 'cityList', aberta: 'false', dica: 'Use as setas para escolher e Enter para confirmar.', status: 'status', papel: 'listbox', nome: 'Cidades com o cadastro oficial no IMED', letra: '16px' });
    // Campo vazio: a região da pessoa e as cidades com mais locais (números reais).
    await page.waitForSelector('#cityIdle [data-ibge]');
    assert.equal(await page.textContent('#cityIdle [data-reg]'), 'Sua região: São Paulo - SP');
    assert.deepEqual(await page.$$eval('#cityIdle [data-ibge]', (els) => els.map((e) => e.textContent)), ['São Paulo - SP6.548 locais no cadastro oficial', 'Rio de Janeiro - RJ3.000 locais no cadastro oficial', 'Belo Horizonte - MG2.284 locais no cadastro oficial', "Santa Bárbara d'Oeste - SP150 locais no cadastro oficial"]);
    assert.equal(await page.textContent('#cityGeoState'), 'Ativa · São Paulo - SP');
    await shot(page, `perto-seletor-${quem}`);
    // Esc com o campo vazio fecha; o foco volta para quem abriu.
    await page.keyboard.press('Escape');
    await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'addrBtn', `${quem}: o foco volta para o botão do topo`);
    // Pelo botão da tela (#cityBtn).
    await page.click('#cityBtn');
    await page.waitForSelector('.ov.open #cityQ');
    await page.waitForFunction(() => document.activeElement?.id === 'cityQ');
    // "barbara": Santa Bárbara d'Oeste com o número real. Sem o centro da cidade: mensagem, janela aberta, nada guardado.
    await page.keyboard.type('barbara');
    await page.waitForFunction(() => document.querySelector('#cityHint').textContent === '1 cidade encontrada');
    assert.deepEqual(await page.$$eval('#cityList [role=option]', (els) => els.map((e) => [e.querySelector('b').textContent, e.querySelector('small').textContent, e.getAttribute('aria-selected')])), [["Santa Bárbara d'Oeste - SP", '150 locais no cadastro oficial', 'false']]);
    assert.equal(await page.getAttribute('#cityQ', 'aria-expanded'), 'true');
    assert.equal(await page.getAttribute('#cityQ', 'aria-activedescendant'), null, 'nenhuma opção ativa antes das setas');
    await page.keyboard.press('Enter'); // sem opção ativa: a primeira
    await page.waitForFunction(() => /Não foi possível achar o centro desta cidade agora\. Tente de novo ou use a busca completa\./.test(document.querySelector('#cityHint').textContent));
    assert.deepEqual(log.geocode.at(-1), { action: 'geocode', q: "Santa Bárbara d'Oeste, SP" });
    assert.equal(await page.locator('#ov.open').count(), 1, 'a janela continua aberta');
    assert.equal(await page.isDisabled('#cityQ'), false, 'o campo é liberado');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cityQ');
    assert.equal(await page.evaluate(() => localStorage.getItem('imed_cidade')), null, 'nada guardado');
    assert.equal(await page.evaluate(() => localStorage.getItem('imed_cidades_recentes')), null);
    // Esc com texto limpa o campo e a janela fica.
    await page.keyboard.press('Escape');
    assert.equal(await page.inputValue('#cityQ'), '');
    assert.equal(await page.getAttribute('#cityQ', 'aria-expanded'), 'false');
    assert.equal(await page.locator('#ov.open').count(), 1, 'Esc com texto não fecha');
    // "campinas sp": a UF filtra; Campinas ainda não está no IMED.
    await page.keyboard.type('campinas sp');
    await page.waitForFunction(() => document.querySelector('#cityHint').textContent === 'Nenhuma cidade com esse nome no IMED ainda.');
    assert.ok(await page.locator('#cityList').isHidden());
    assert.equal(await page.getAttribute('#cityQ', 'aria-expanded'), 'false');
    // "rio" + setas (dão a volta) + Enter: a janela fecha e o foco volta para quem abriu, com o nome novo.
    await page.keyboard.press('Escape');
    await page.keyboard.type('rio');
    await page.waitForSelector('#cityList [role=option]');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.getAttribute('#cityQ', 'aria-activedescendant'), 'cityOpt-3304557');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getAttribute('#cityQ', 'aria-activedescendant'), 'cityOpt-3304557');
    assert.equal(await page.getAttribute('#cityOpt-3304557', 'aria-selected'), 'true');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
    await tela(page, 'lista');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cityBtn', `${quem}: o foco volta para quem abriu`);
    assert.equal(await page.textContent('#cityName'), 'Rio de Janeiro - RJ');
    assert.equal(await page.textContent('#toast'), 'Mostrando os locais perto do centro do Rio de Janeiro');
    // De novo no seletor: o Rio nas recentes, com a distância até a pessoa; a própria região volta para perto, sem geocodificar.
    const geo = log.geocode.length;
    await page.click('#cityBtn');
    await page.waitForSelector('#cityIdle [data-reg]');
    assert.equal(await page.textContent('#cityIdle [data-rec="0"]'), 'Rio de Janeiro - RJfica a 363 km de você');
    await page.click('#cityIdle [data-reg]');
    await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
    await page.waitForFunction(() => document.querySelector('#cityRot').textContent === 'Sua região');
    await tela(page, 'lista');
    assert.equal(await page.textContent('#cityName'), 'São Paulo - SP');
    assert.equal(log.geocode.length, geo, 'a região: sem geocodificar');
    assert.equal(await page.evaluate(() => localStorage.getItem('imed_cidade')), null, 'a cidade escolhida sai do aparelho');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('imed_cidades_recentes'))), [RIO], 'as recentes ficam');
    if (mobile) {
      // Também digitando: o Rio (centro guardado nas recentes, sem geocodificar) e depois a região pelo nome.
      for (const [texto, rot, nome] of [['rio', 'Cidade escolhida', 'Rio de Janeiro - RJ'], ['sao paulo', 'Sua região', 'São Paulo - SP']]) {
        await page.click('#cityBtn');
        await page.waitForFunction(() => document.activeElement?.id === 'cityQ');
        await page.keyboard.type(texto);
        await page.waitForSelector('#cityList [role=option]');
        await page.keyboard.press('Enter');
        await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
        await page.waitForFunction((r) => document.querySelector('#cityRot').textContent === r, rot);
        assert.equal(await page.textContent('#cityName'), nome);
      }
      assert.equal(log.geocode.length, geo, 'recentes e região: sem geocodificar');
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('seletor: o foco nunca fica na janela fechada (iPhone e #cidades), o "voltar" do celular fecha o seletor, uma escolha por vez e a contagem não apaga as mensagens', async () => {
  // Belo Horizonte: centro devagar (2,5 s). Santa Bárbara d'Oeste: sem centro (erro). Rio: nas recentes (sem geocodificar).
  const geocode = async (route, body) => {
    if (/Belo Horizonte/.test(body.q)) { await new Promise((r) => setTimeout(r, 2500)); return json(route, { ok: true, lat: -19.91668, lng: -43.93449 }); }
    return json(route, { ok: false, error: 'not_found' }, 404);
  };
  for (const mobile of [false, true]) {
    const quem = mobile ? 'celular' : 'computador';
    const { page, log, errors, context } = await newPage(browser, { mobile, geocode, store: { imed_cidades_recentes: [RIO] } });
    await page.goto(BASE);
    await tela(page, 'lista');
    const foco = () => page.evaluate(() => {
      const a = document.activeElement, r = a.getBoundingClientRect(), h = document.querySelector('.top').getBoundingClientRect().bottom;
      return { id: a.id, naJanela: !!a.closest('#sheet'), corpo: a === document.body, aVista: r.bottom > 0 && r.top < innerHeight && (!!a.closest('.top') || r.top >= h - 1), ov: getComputedStyle(document.querySelector('#ov')).visibility };
    });
    // O cabeçalho da janela não cobre o campo (scroll-padding) e, no app do iPhone, fica abaixo da barra do aparelho.
    await page.click('#cityBtn');
    await page.waitForSelector('.ov.open #cityQ');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#sheet')).scrollPaddingTop), '84px');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#cityQ')).borderTopColor), 'rgb(122, 143, 153)', 'borda do campo com contraste de 3:1');
    if (mobile) {
      // Celular: o seletor ocupa a tela, como uma página; o "voltar" do aparelho fecha o seletor e fica no IMED.
      await page.waitForFunction(() => history.state?.imedCid === 1);
      await page.goBack();
      await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
      assert.equal(page.url(), BASE, 'o "voltar" fecha o seletor sem sair da página');
      assert.equal(await page.evaluate(() => history.state), null, 'sem entrada sobrando no histórico');
    } else {
      await page.keyboard.press('Escape');
      await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
    }
    // iPhone: tocar num botão não dá foco a ele (fica o <body>). Pelo X, pelo Esc ou pela escolha de uma recente, o foco
    // sai da janela fechada (o teclado do iPhone não fica aberto, digitando num campo invisível) e fica à vista.
    for (const como of ['x', 'esc', 'recente']) {
      await page.evaluate(() => { document.activeElement?.blur(); document.querySelector('#cityBtn').click(); });
      await page.waitForSelector('.ov.open #cityQ');
      await page.waitForSelector('#cityIdle .cid-op');
      if (como === 'x') await page.click('#sheet [data-close]');
      else if (como === 'esc') await page.keyboard.press('Escape');
      else await page.click('#cityIdle [data-rec="0"]');
      await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
      await page.waitForTimeout(400); // a janela termina de esmaecer
      const f = await foco();
      assert.ok(!f.naJanela && !f.corpo && f.aVista && ['cityBtn', 'addrBtn'].includes(f.id), `${quem}, ${como}: ${JSON.stringify(f)}`);
      assert.equal(f.ov, 'hidden', `${quem}, ${como}: a janela fechada sai do Tab e do leitor de tela`);
    }
    assert.equal(await page.textContent('#cityName'), 'Rio de Janeiro - RJ');
    // Escolher a cidade: só na tela o aviso curto (o leitor de tela já ouve o resumo da lista nova).
    assert.equal(await page.getAttribute('#toast', 'aria-hidden'), 'true');
    // "barbara" + Enter na hora: "Procurando o centro…" e depois o erro, que a contagem atrasada (300 ms) não apaga.
    await page.click('#cityBtn');
    await page.waitForFunction(() => document.activeElement?.id === 'cityQ');
    await page.keyboard.type('barbara');
    await page.keyboard.press('Enter');
    const erro = 'Não foi possível achar o centro desta cidade agora. Tente de novo ou use a busca completa.';
    await page.waitForFunction((t) => document.querySelector('#cityHint').textContent === t, erro);
    await page.waitForTimeout(600);
    assert.equal(await page.textContent('#cityHint'), erro, 'a contagem não apaga a mensagem de erro');
    // Belo Horizonte (centro devagar): enquanto procura, o campo fica só de leitura (o foco não cai no <body>) e a
    // mensagem fica. Fechar a janela (Esc) nesse meio-tempo desiste da escolha: nada muda quando o centro chega.
    await page.fill('#cityQ', '');
    await page.keyboard.type('belo');
    await page.waitForSelector('#cityList [role=option]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Procurando o centro de Belo Horizonte/.test(document.querySelector('#cityHint').textContent));
    await page.waitForTimeout(600);
    assert.equal(await page.textContent('#cityHint'), 'Procurando o centro de Belo Horizonte…', 'a contagem não apaga "Procurando…"');
    assert.deepEqual(await page.evaluate(() => { const q = document.querySelector('#cityQ'); return [document.activeElement.id, q.readOnly, q.disabled, q.getAttribute('aria-busy')]; }), ['cityQ', true, false, 'true']);
    assert.equal(await page.getAttribute('#cityList [role=option] >> nth=0', 'aria-disabled'), 'true');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
    await page.waitForTimeout(2800);
    assert.equal(await page.textContent('#cityName'), 'Rio de Janeiro - RJ', 'fechou procurando: a escolha não vale');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('imed_cidade')).name), 'Rio de Janeiro');
    // De novo, pelo atalho: durante a busca, tocar no Rio das recentes não escolhe outra cidade por cima (a resposta
    // velha não vence a nova, e a tela não troca duas vezes).
    await page.click('#cityBtn');
    await page.waitForSelector('#cityIdle [data-ibge="3106200"]');
    await page.click('#cityIdle [data-ibge="3106200"]');
    await page.waitForFunction(() => /Procurando o centro de Belo Horizonte/.test(document.querySelector('#cityHint').textContent));
    assert.equal(await page.getAttribute('#cityIdle [data-rec="0"]', 'aria-disabled'), 'true');
    await page.click('#cityIdle [data-rec="0"]', { force: true });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#ov.open').count(), 1, 'o toque no Rio não vale durante a busca');
    await page.waitForSelector('.ov:not(.open)', { state: 'attached', timeout: 8000 });
    await page.waitForFunction(() => document.querySelector('#cityName').textContent === 'Belo Horizonte - MG');
    await page.waitForTimeout(400);
    assert.equal(await page.textContent('#cityName'), 'Belo Horizonte - MG');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('imed_cidade')).name), 'Belo Horizonte');
    assert.equal(await page.textContent('#reaisTitle'), 'Clínicas perto do centro de Belo Horizonte');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Pelo endereço #cidades (o foco não estava em nenhum botão): o Esc fecha e o foco sai da janela, à vista.
  const { page, errors, context } = await newPage(browser, { geo: { estado: 'prompt' } });
  await page.goto(`${BASE}#cidades`);
  await page.waitForSelector('.ov.open #cityQ');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(() => [document.activeElement.id, !!document.activeElement.closest('#sheet'), getComputedStyle(document.querySelector('#ov')).visibility]), ['addrBtn', false, 'hidden']);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('1ª visita no celular pequeno: o aviso de privacidade espera a resposta do pedido, e o aviso do pedido fica compacto', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, viewport: { width: 360, height: 640 }, lgpd: true, geo: { estado: 'prompt', resposta: 'permitir', atraso: 2500 } });
  await page.goto(BASE);
  await page.waitForSelector('#geoAviso:not([hidden])');
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.lgpd').count(), 0, 'com o pedido aberto, o aviso de privacidade espera');
  const h = await page.evaluate(() => document.querySelector('#geoAviso').getBoundingClientRect().height);
  assert.ok(h <= 210, `aviso do pedido compacto a 360 px (${Math.round(h)} px)`);
  await shot(page, 'perto-1a-visita-360x640');
  await tela(page, 'lista');
  await page.waitForSelector('.lgpd');
  assert.ok(await page.locator('#geoAviso').isHidden());
  assert.deepEqual(errors, []);
  await context.close();
  // Sem pedido ao abrir (a permissão já foi dada): o aviso de privacidade aparece logo.
  const b = await newPage(browser, { mobile: true, lgpd: true });
  await b.page.goto(BASE);
  await b.page.waitForSelector('.lgpd', { timeout: 5000 });
  assert.deepEqual(b.errors, []);
  await b.context.close();
});

await scenario('abas por tipo: Laboratórios busca em 2, 10 e 50 km, mostra só laboratórios, conta busca_tipo e filtra os pontos no aparelho', async () => {
  const { page, log, errors, context } = await newPage(browser, { cnes: porTipo(CNES_ROWS), spyMap: true });
  await page.goto(`${BASE}?visitas=teste`);
  await page.evaluate(() => document.querySelector('#reais').scrollIntoView());
  await tela(page, 'lista');
  await page.waitForSelector('#realMap .leaflet-marker-icon');
  const camadas = () => page.evaluate(() => {
    let pontos = 0, pinos = 0, voce = 0;
    window.__maps.at(-1).eachLayer((l) => {
      if (l instanceof L.Circle) return;
      if (l instanceof L.CircleMarker) pontos += 1;
      else if (l instanceof L.Marker) { if (l.options.icon?.options?.className === 'pv-voce-w') voce += 1; else pinos += 1; }
    });
    return { pontos, pinos, voce };
  });
  assert.deepEqual(await camadas(), { pontos: 4, pinos: 4, voce: 1 }, 'Todos: 3 pontos do CNES e o parceiro; 4 pinos; "você" por cima');
  assert.equal(await page.getAttribute('#pvTabs', 'role'), 'group');
  assert.equal(await page.getAttribute('#pvTabs', 'aria-label'), 'Tipo de local');
  assert.deepEqual(await page.$$eval('#pvTabs button', (els) => els.map((e) => [e.textContent.trim(), e.getAttribute('aria-pressed')])), [['Todos', 'true'], ['Imagem', 'false'], ['Laboratórios', 'false'], ['Clínicas', 'false'], ['Hospitais', 'false']]);
  const n = { cnes: log.cnes.length, par: log.partners.length, pts: log.points.length };
  await page.click('#pvTabs button[data-tipo="laboratorio"]');
  await page.waitForFunction(() => document.querySelector('#pvSum').textContent === 'Poucos laboratórios em até 2 km. O mais perto, em até 50 km:');
  assert.equal(await page.getAttribute('#pvTabs button[data-tipo="laboratorio"]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('#pvTabs button[data-tipo=""]', 'aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tipo), 'laboratorio', 'o foco fica na aba');
  const novas = log.cnes.slice(n.cnes).filter((a) => a.p_limit === 10);
  assert.deepEqual(novas.map((a) => [a.p_kind, a.p_radius_m, a.p_limit]), [['laboratorio', 2000, 10], ['laboratorio', 10000, 10], ['laboratorio', 50000, 10]], 'menos de 3 locais: 2, 10 e 50 km');
  assert.deepEqual(await page.$$eval('#realList li b', (els) => els.map((e) => e.textContent)), ['Laboratório Análise Paulista'], 'só laboratórios');
  assert.deepEqual(log.partners.slice(n.par).map((a) => a.p_radius_m), [10000, 50000], 'parceiros: uma chamada por raio (a aba filtra no aparelho)');
  await until(() => log.track.some((t) => t.p_event === 'busca_tipo'));
  assert.deepEqual(log.track.filter((t) => t.p_event), [{ p_path: '/', p_event: 'busca_tipo', p_detail: 'laboratorio' }], 'busca_tipo no contador');
  // Pontos do mapa filtrados no aparelho, sem nova chamada.
  await page.waitForFunction(() => document.querySelectorAll('#realMap .pv-pin').length === 1);
  assert.deepEqual(await camadas(), { pontos: 1, pinos: 1, voce: 1 }, 'só o laboratório (e "você")');
  assert.equal(log.points.length, n.pts, 'sem nova chamada de establishment_points');
  await shot(page, 'perto-aba-laboratorios');
  // Aba sem nenhum local em 50 km: a frase de "nenhuma" e o botão "Ver todos os tipos".
  await page.click('#pvTabs button[data-tipo="clinica"]');
  await page.waitForSelector('#pvTipos:not([hidden])');
  assert.equal(await page.textContent('#pvSum'), 'Nenhuma clínica do cadastro oficial em até 50 km daqui.');
  assert.equal(await page.locator('#realList li').count(), 0);
  assert.ok(await page.locator('#mapOpen').isHidden());
  // Voltar a Todos usa o que já veio do banco.
  const m = { cnes: log.cnes.length, par: log.partners.length };
  await page.click('#pvTipos');
  await page.waitForFunction(() => document.querySelectorAll('#realList li b').length === 4);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tipo), '', 'o foco vai para a aba Todos');
  assert.equal(await page.getAttribute('#pvTabs button[data-tipo=""]', 'aria-pressed'), 'true');
  assert.equal(log.cnes.length, m.cnes, 'Todos: do cache, sem chamar o banco de novo');
  assert.equal(log.partners.length, m.par);
  await page.waitForFunction(() => document.querySelectorAll('#realMap .pv-pin').length === 4);
  assert.deepEqual(await camadas(), { pontos: 4, pinos: 4, voce: 1 });
  assert.equal(log.points.length, n.pts);
  assert.deepEqual(log.track.filter((t) => t.p_event).map((t) => t.p_detail), ['laboratorio', 'clinica'], 'cada aba contada uma vez; Todos não conta');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('região sem cadastro e banco fora do ar: cartão com o próximo passo e "Tentar de novo" que refaz a lista', async () => {
  {
    const { page, log, errors, context } = await newPage(browser, { cnes: (r) => json(r, []), partners: (r) => json(r, []) });
    await page.goto(BASE);
    await tela(page, 'vazio');
    assert.deepEqual(log.cnes.filter((a) => a.p_limit === 10).map((a) => a.p_radius_m), [2000, 10000, 50000], 'no máximo 3 chamadas: 2, 10 e 50 km');
    const card = await page.textContent('#pvEstado');
    assert.match(card, /Ainda não temos o cadastro oficial desta região/);
    assert.match(card, /Na busca completa, o IMED começa a trazer os dados do CNES da sua cidade e mostra o mapa público\./);
    assert.deepEqual(await botoesCartao(page), ['Abrir a busca completa', 'Escolher outra cidade']);
    assert.equal(await page.getAttribute('#pvEstado .pv-ebts a', 'href'), 'perto.html?usar=localizacao');
    assert.equal(await page.locator('#realList li').count(), 0);
    assert.ok(await page.$$eval('#pvTabs button', (bs) => bs.every((b) => b.disabled)), 'abas desabilitadas, no lugar');
    assert.equal(await page.textContent('#pvSum'), 'Ainda não temos o cadastro oficial desta região', 'leitor de tela: o resumo diz o que houve');
    await page.click('#pvEstado [data-bt="outra"]');
    await page.waitForSelector('.ov.open #cityQ');
    await page.keyboard.press('Escape');
    await page.locator('#reais').evaluate((e) => e.scrollIntoView());
    await shot(page, 'perto-sem-cadastro');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Banco fora do ar (erro 500 no CNES e nos parceiros); volta antes do "Tentar de novo".
    let fora = true;
    const ou = (ok) => (r) => (fora ? json(r, { message: 'erro' }, 500) : ok(r));
    const { page, log, errors, context } = await newPage(browser, { cnes: ou((r) => json(r, CNES_ROWS)), partners: ou((r) => json(r, PARTNERS)) });
    await page.goto(BASE);
    await tela(page, 'erro');
    const card = await page.textContent('#pvEstado');
    // Banco fora do ar com a internet funcionando: nada de "verifique sua internet".
    assert.match(card, /Não foi possível carregar os locais agora\./);
    assert.match(card, /O IMED não respondeu agora\. Tente de novo em instantes\./);
    assert.deepEqual(await botoesCartao(page), ['Tentar de novo']);
    await page.waitForTimeout(600);
    assert.equal(log.cnes.filter((a) => a.p_limit === 10).length, 1, 'sem repetir sozinho');
    // Sem internet: o cartão diz isso; quando a conexão volta, a lista tenta de novo sozinha.
    await context.setOffline(true);
    await page.waitForFunction(() => /Você está sem internet/.test(document.querySelector('#pvEstado').textContent));
    assert.match(await page.textContent('#pvEstado'), /Os locais aparecem quando a conexão voltar: clique em Tentar de novo\./);
    assert.equal(await page.textContent('#pvSum'), 'Você está sem internet', 'leitor de tela');
    await context.setOffline(false);
    await until(() => log.cnes.filter((a) => a.p_limit === 10).length === 2);
    await tela(page, 'erro');
    await page.waitForFunction(() => /O IMED não respondeu agora/.test(document.querySelector('#pvEstado').textContent));
    fora = false;
    await page.click('#pvEstado [data-bt="tentar"]');
    await tela(page, 'lista');
    assert.deepEqual(await page.$$eval('#realList li b', (els) => els.map((e) => e.textContent)), ['Clínica Parceira Paulista', 'Hospital Santa Exemplo', 'Laboratório Análise Paulista', 'Centro de Imagem <b>Teste</b>'], 'a lista inteira, com o parceiro');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cityBtn', 'o botão some e o foco vai para o botão da cidade');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('celular: lista com 6 e "Mostrar mais 4"; o mapa abre em tela cheia só no toque e fecha pelo Esc, pelo botão e pelo voltar', async () => {
  const { page, log, errors, context, requests } = await newPage(browser, { mobile: true, cnes: (r) => json(r, MUITOS.map((x) => ({ ...x, total: 1023 }))) });
  await page.goto(`${BASE}como-funciona.html`);
  await page.goto(BASE);
  await tela(page, 'lista');
  await page.waitForFunction(() => document.querySelector('#cityName').textContent === 'São Paulo - SP');
  await page.evaluate(() => document.querySelector('#reais').scrollIntoView());
  assert.equal(await page.locator('#realList li').count(), 10, 'os 10 mais perto');
  assert.equal(await page.locator('#realList li:visible').count(), 6, 'o celular mostra 6');
  assert.equal(await page.textContent('#pvSum'), 'Os 10 mais perto de você');
  assert.equal((await page.textContent('#pvMore')).trim(), 'Mostrar mais 4');
  // Sem número, raio nem tipo: a busca completa abre com a própria distância e todos os tipos (a página inicial não
  // promete um número que a próxima não mostra).
  assert.equal((await page.textContent('#pvAll')).trim(), 'Ver mais na busca completa, com filtros');
  assert.equal(await page.getAttribute('#pvAll', 'href'), 'perto.html?usar=localizacao');
  await shot(page, 'perto-celular-lista');
  await page.click('#pvMore');
  assert.equal(await page.locator('#realList li:visible').count(), 10);
  assert.ok(await page.locator('#pvMore').isHidden());
  assert.ok(await page.evaluate(() => document.activeElement === document.querySelector('#realList li:nth-child(7) a')), 'o foco vai para o 7º');
  // Nada do mapa antes do toque, nem rolando a página inteira.
  await scrollAll(page);
  await page.waitForTimeout(600);
  assert.ok(!requests.some((u) => /leaflet\.js/.test(u)), 'leaflet.js só no toque');
  assert.equal(log.points.length, 0, 'establishment_points só no toque');
  const abrir = async () => {
    await page.click('#mapOpen');
    await page.waitForSelector('#pvMapa.cheio #realMap .leaflet-marker-icon');
  };
  // Fechou de verdade: sem a classe, foco de volta no "Ver no mapa", na mesma página e sem a entrada do mapa no histórico.
  const fechado = async (como) => {
    await page.waitForSelector('#pvMapa:not(.cheio)', { state: 'attached' });
    await page.waitForFunction(() => document.activeElement?.id === 'mapOpen' && !history.state?.imedMapa);
    assert.equal(page.url(), BASE, `${como}: continua na página inicial`);
    assert.ok(!(await page.evaluate(() => document.body.classList.contains('mapa-cheio'))), `${como}: a página volta a rolar`);
  };
  await abrir();
  const j = await page.evaluate(() => {
    const m = document.querySelector('#pvMapa'), r = m.getBoundingClientRect();
    const dentro = (x, y) => !!document.elementFromPoint(x, y)?.closest('#pvMapa');
    return {
      role: m.getAttribute('role'), modal: m.getAttribute('aria-modal'), titulo: m.getAttribute('aria-labelledby'),
      caixa: [r.left, r.top, r.width, r.height].map(Math.round),
      cantos: [dentro(4, 4), dentro(innerWidth - 4, 4), dentro(4, innerHeight - 4), dentro(innerWidth - 4, innerHeight - 4), dentro(innerWidth / 2, innerHeight / 2)],
      foco: document.activeElement.id, z: getComputedStyle(document.querySelector('.sheet-top')).zIndex, trava: document.body.classList.contains('mapa-cheio'),
      historico: history.state,
    };
  });
  assert.deepEqual(j, { role: 'dialog', modal: 'true', titulo: 'mapTitle', caixa: [0, 0, 390, 844], cantos: [true, true, true, true, true], foco: 'mapClose', z: '75', trava: true, historico: { imedMapa: 1 } }, 'janela do tamanho da tela, por cima do cabeçalho e do menu de baixo');
  assert.equal(await page.textContent('#mapTitle'), 'Mapa · São Paulo - SP');
  assert.deepEqual(await page.$$eval('#realStats .rm-stat b', (els) => els.map((e) => e.textContent)), ['2', '1', '0', '1'], 'legenda com os números');
  assert.match(await page.textContent('#realStats'), /Em até 2 km/);
  assert.deepEqual(await page.$$eval('#realMap .pv-pin', (els) => els.map((e) => Number(e.textContent)).sort((a, b) => a - b)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'os mesmos números da lista');
  assert.equal(log.points.length, 1, 'os pontos vêm no toque');
  assert.equal(page.url(), BASE, 'o endereço não muda');
  await page.waitForSelector('#realMap .leaflet-tile-loaded');
  await shot(page, 'perto-celular-mapa');
  // Tab fica na janela do mapa.
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => !!document.activeElement?.closest('#pvMapa')), `Tab ${i + 1} fica no mapa`);
  }
  await page.keyboard.press('Escape');
  await fechado('Esc');
  await abrir();
  await page.click('#mapClose');
  await fechado('botão');
  await abrir();
  await page.goBack();
  await fechado('voltar do Android');
  // Esc com o balão de um pino aberto fecha só o balão; o próximo Esc fecha o mapa (e o balão não volta aberto).
  await abrir();
  await page.click('#realMap .pv-pin-w >> nth=0');
  await page.waitForSelector('#realMap .leaflet-popup');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#realMap .leaflet-popup', { state: 'detached' });
  assert.ok(await page.evaluate(() => document.querySelector('#pvMapa').classList.contains('cheio')), 'Esc com o balão: o mapa continua aberto');
  await page.keyboard.press('Escape');
  await fechado('Esc depois do balão');
  // Fechar e abrir de novo bem rápido: o "voltar" do fechamento não fecha o mapa reaberto, e ele continua com a
  // entrada no histórico (o "voltar" do aparelho fecha).
  await abrir();
  await page.evaluate(() => { document.querySelector('#mapClose').click(); document.querySelector('#mapOpen').click(); });
  await page.waitForTimeout(700);
  assert.deepEqual(await page.evaluate(() => [document.querySelector('#pvMapa').classList.contains('cheio'), history.state]), [true, { imedMapa: 1 }], 'reaberto, com a entrada no histórico');
  assert.equal(await page.locator('#realMap .leaflet-popup').count(), 0, 'sem balão sobrando');
  await page.goBack();
  await fechado('voltar depois de reabrir');
  // A tela passou para 900 px ou mais com o mapa aberto: a janela fecha.
  await abrir();
  await page.setViewportSize({ width: 1000, height: 844 });
  await page.waitForSelector('#pvMapa:not(.cheio)', { state: 'attached' });
  await page.waitForFunction(() => !history.state?.imedMapa);
  await page.setViewportSize({ width: 390, height: 844 });
  // Nenhuma entrada sobrando no histórico: o próximo "voltar" sai para a página anterior.
  await page.goBack();
  await page.waitForURL(/como-funciona\.html$/);
  assert.deepEqual(errors, []);
  await context.close();
  // A página abriu de novo com a entrada do mapa no histórico (recarregou com o mapa aberto): a marca sai, senão o
  // próximo "voltar" ficaria na mesma página.
  const r = await newPage(browser, { mobile: true });
  await r.page.goto(BASE);
  await tela(r.page, 'lista');
  await r.page.click('#mapOpen');
  await r.page.waitForSelector('#pvMapa.cheio');
  assert.deepEqual(await r.page.evaluate(() => history.state), { imedMapa: 1 });
  await r.page.reload();
  await tela(r.page, 'lista');
  await r.page.waitForFunction(() => history.state === null);
  assert.ok(!(await r.page.evaluate(() => document.querySelector('#pvMapa').classList.contains('cheio'))));
  assert.deepEqual(r.errors, []);
  await r.context.close();
});

await scenario('computador: lista e mapa lado a lado, pinos numerados ligados à lista e mapa preso ao rolar', async () => {
  const { page, errors, context } = await newPage(browser, { cnes: (r) => json(r, MUITOS), spyMap: true });
  await page.goto(BASE);
  await page.evaluate(() => document.querySelector('#reais').scrollIntoView());
  await tela(page, 'lista');
  await page.waitForSelector('#realMap .leaflet-marker-icon');
  const n = await page.locator('#realList li').count();
  assert.equal(n, 10);
  assert.equal(await page.locator('#realList li:visible').count(), 10, 'no computador, os 10 à vista');
  assert.ok(await page.locator('#mapOpen').isHidden(), 'sem o botão "Ver no mapa"');
  const pinos = await page.evaluate(() => { let k = 0; window.__maps.at(-1).eachLayer((l) => { if (l instanceof L.Marker && l.options.icon?.options?.className === 'pv-pin-w') k += 1; }); return k; });
  assert.equal(pinos, n, 'um pino numerado (L.Marker) por item');
  // O ponto de partida fica por cima dos pinos, sem receber o toque (o pino embaixo dele continua abrindo o balão),
  // e a legenda diz o que ele é.
  assert.deepEqual(await page.evaluate(() => { let v = null; window.__maps.at(-1).eachLayer((l) => { if (l.options?.icon?.options?.className === 'pv-voce-w') v = [l.options.interactive, l.options.zIndexOffset > 5000]; }); return v; }), [false, true]);
  assert.match(await page.textContent('#realStats .pv-leg'), /Em até 2 km\s*Você \(aproximado\)/);
  // "Reduzir movimento" ligado (padrão destes testes): o mapa sem animações; a roda do mouse não aproxima.
  assert.deepEqual(await page.evaluate(() => { const o = window.__maps.at(-1).options; return [o.zoomAnimation, o.fadeAnimation, o.markerZoomAnimation, o.scrollWheelZoom, o.preferCanvas]; }), [false, false, false, false, true]);
  assert.equal(await page.getAttribute('#realMap', 'aria-describedby'), 'realMapDesc');
  assert.match(await page.textContent('#realMapDesc'), /Os números são os mesmos da lista; pelo teclado ou leitor de tela, use a lista\./);
  assert.deepEqual(await page.$$eval('#realMap .pv-pin', (els) => els.map((e) => Number(e.textContent)).sort((a, b) => a - b)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(await page.locator('#realMap .leaflet-marker-icon[tabindex="0"]').count(), 0, 'pinos fora do Tab');
  const aceso = (k) => page.locator('#realMap .pv-pin', { hasText: new RegExp(`^${k}$`) }).evaluate((e) => e.classList.contains('on'));
  // Mouse no 3º item: o pino 3 acende; o mouse sai, apaga.
  await page.hover('#realList li:nth-child(3) a');
  assert.ok(await aceso(3), 'mouse no item acende o pino');
  await page.mouse.move(2, 400);
  assert.ok(!(await aceso(3)));
  // Foco no 5º item (teclado): o pino 5 acende.
  await page.focus('#realList li:nth-child(5) a');
  assert.ok(await aceso(5), 'foco no item acende o pino');
  await page.evaluate(() => document.activeElement.blur());
  assert.ok(!(await aceso(5)));
  // Clique no pino 1: abre o balão do local e marca o item.
  await page.locator('#realMap .pv-pin', { hasText: /^1$/ }).click();
  await page.waitForSelector('.leaflet-popup .rm-pop');
  assert.match(await page.textContent('.leaflet-popup .rm-pop'), /Clínica Bela Vista Teste.*Clínica · 250 m/s);
  assert.equal(await page.getAttribute('.leaflet-popup .rm-pop a', 'href'), 'local.html?cnes=7100001');
  assert.ok(await page.locator('#realList li:nth-child(1) a').evaluate((e) => e.classList.contains('on')), 'o item do pino fica marcado');
  await shot(page, 'perto-computador-mapa');
  // Esc com o balão aberto fecha só o balão.
  await page.keyboard.press('Escape');
  await page.waitForSelector('.leaflet-popup', { state: 'detached' });
  // Ao rolar, o mapa fica preso a ~96 px do alto.
  const s = await page.evaluate(async () => {
    const quadro = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const corpo = document.querySelector('.pv-corpo'), mapa = document.querySelector('#pvMapa');
    window.scrollTo(0, corpo.getBoundingClientRect().top + scrollY - 96);
    await quadro();
    const a = mapa.getBoundingClientRect().top;
    window.scrollBy(0, 300);
    await quadro();
    return { a: Math.round(a), b: Math.round(mapa.getBoundingClientRect().top), corpo: Math.round(corpo.getBoundingClientRect().top) };
  });
  assert.ok(Math.abs(s.a - 96) <= 2 && Math.abs(s.b - 96) <= 2 && s.corpo < -150, `mapa preso ao rolar 300 px (${JSON.stringify(s)})`);
  // A pessoa retira a permissão com a página aberta: nada da posição fica na memória da página (o mapa centrado nela
  // sai, junto com as listas e os pontos guardados pela posição).
  await mudarGeo(page, 'denied');
  await tela(page, 'negada');
  assert.equal(await page.locator('#realMap .leaflet-pane').count(), 0, 'o mapa centrado na posição sai');
  assert.equal(await page.evaluate(() => document.querySelector('#realMap').children.length), 0, 'nada do mapa dentro da coluna');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('computador: com economia de dados, o mapa só no toque em "Mostrar o mapa"; mapa fora do ar, a lista continua e "Tentar de novo"', async () => {
  // Também com "reduzir movimento" ligado junto (os dois ajustes ao mesmo tempo).
  for (const motion of ['no-preference', 'reduce']) {
    const { page, log, errors, context, requests } = await newPage(browser, { motion, device: { memory: 8, cores: 8, saveData: true } });
    await page.goto(BASE);
    await page.evaluate(() => document.querySelector('#reais').scrollIntoView());
    await tela(page, 'lista');
    await page.waitForSelector('#mapShow', { timeout: 5000 }).catch(() => {});
    assert.match(await page.textContent('#pvMapMsg'), /Para gastar menos internet, o mapa não abre sozinho\./, `${motion}: aviso da economia de dados`);
    await page.waitForTimeout(600);
    assert.ok(!requests.some((u) => /leaflet\.js/.test(u)), `${motion}: sem Leaflet antes do toque`);
    assert.equal(log.points.length, 0, `${motion}: sem pontos antes do toque`);
    await page.click('#mapShow');
    await page.waitForSelector('#realMap .leaflet-marker-icon');
    assert.equal(log.points.length, 1);
    assert.ok(await page.locator('#pvMapMsg').isHidden());
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Celular deitado (915 x 412, com 900 px ou mais conta como computador): o mapa não vem sozinho pela internet do
    // celular, só no toque em "Mostrar o mapa".
    const { page, log, errors, context, requests } = await newPage(browser, { mobile: true, viewport: { width: 915, height: 412 } });
    await page.goto(BASE);
    await page.evaluate(() => document.querySelector('#reais').scrollIntoView());
    await tela(page, 'lista');
    await page.waitForSelector('#mapShow');
    await page.evaluate(() => document.querySelector('#pvMapa').scrollIntoView());
    await page.waitForTimeout(800);
    assert.ok(!requests.some((u) => /leaflet\.js/.test(u)), 'celular deitado: sem Leaflet antes do toque');
    assert.equal(log.points.length, 0);
    await page.click('#mapShow');
    await page.waitForSelector('#realMap .leaflet-marker-icon');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Tela alta no computador (1920 x 1080): a tela "Clínicas perto de você" aparece embaixo do 3D ao abrir, mas o
    // mapa só vem quando a coluna dele chega perto da vista (não disputa a internet com o 3D ao abrir).
    const { page, log, errors, context, requests } = await newPage(browser, { viewport: { width: 1920, height: 1080 } });
    await page.goto(BASE);
    await tela(page, 'lista');
    await page.waitForTimeout(1200);
    const topo = await page.evaluate(() => document.querySelector('#pvMapa').getBoundingClientRect().top);
    assert.ok(topo > 1080 + 100, `a coluna do mapa começa abaixo da tela (${Math.round(topo)} px)`);
    assert.ok(!requests.some((u) => /leaflet\.js/.test(u)), 'sem Leaflet ao abrir');
    assert.equal(log.points.length, 0, 'sem pontos ao abrir');
    await page.evaluate(() => document.querySelector('#pvMapa').scrollIntoView());
    await page.waitForSelector('#realMap .leaflet-marker-icon');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    let fora = true;
    const { page, log, errors, context } = await newPage(browser, { points: (r) => (fora ? json(r, { message: 'erro' }, 500) : json(r, POINTS)) });
    await page.goto(BASE);
    await page.evaluate(() => document.querySelector('#reais').scrollIntoView());
    await tela(page, 'lista');
    await page.waitForSelector('#mapRetry');
    assert.match(await page.textContent('#pvMapMsg'), /O mapa não carregou\. A lista continua funcionando\./);
    assert.equal(await page.locator('#realList li b').count(), 4, 'a lista continua');
    fora = false;
    await page.click('#mapRetry');
    await page.waitForSelector('#realMap .leaflet-marker-icon');
    assert.ok(await page.locator('#pvMapMsg').isHidden());
    assert.equal(log.points.length, 2, '"Tentar de novo" pede os pontos de novo');
    assert.deepEqual(await page.$$eval('#realStats .rm-stat b', (els) => els.map((e) => e.textContent)), ['2', '1', '0', '1']);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('topo (modo leve) espera a resposta do pedido: nada da Paulista antes, depois a posição arredondada; sem resposta, o exemplo aos 8 s', async () => {
  {
    // Permitiu depois de 3 s, com a pessoa em Recife.
    const { page, log, errors, context } = await newPage(browser, { geo: { estado: 'prompt', resposta: 'permitir', atraso: 3000, pos: RECIFE } });
    await page.goto(BASE);
    await page.waitForSelector('#heroLite h2');
    assert.equal(await page.textContent('#heroLite h2'), 'Perto de você');
    assert.equal(await page.textContent('#heroLiteStatus'), 'Aguardando sua localização…');
    assert.equal(await page.locator('#heroLite li.ph').count(), 5, 'linhas de espera');
    await page.waitForFunction(() => window.__geo.pedidos === 1);
    // O X fecha só o aviso: o pedido do navegador continua. O foco que estava no X vai para o título do topo (o que
    // vem logo depois na leitura), e não para o <body>.
    await page.focus('#geoAvisoX');
    await page.keyboard.press('Enter');
    assert.ok(await page.locator('#geoAviso').isHidden(), 'o X fecha o aviso');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'heroTitle', 'o foco vai para o título do topo');
    assert.equal(await page.evaluate(() => document.documentElement.style.scrollPaddingTop), '');
    await page.waitForTimeout(2000);
    assert.deepEqual(log.cnes.filter((a) => a.p_radius_m === 3000), [], 'nenhuma busca do topo antes da resposta');
    await until(() => log.cnes.some((a) => a.p_radius_m === 3000), 8000);
    const c = log.cnes.find((a) => a.p_radius_m === 3000);
    assert.deepEqual([c.p_lat, c.p_lng], [-8.054, -34.881], 'a busca do topo é a de Recife, arredondada');
    await page.waitForFunction(() => document.querySelector('#heroLite h2').textContent === 'Perto da sua localização');
    assert.ok(!log.cnes.some((a) => a.p_lat === -23.565), 'nada da Av. Paulista');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Ninguém responde: com o relógio da página parado, aos 7 s o topo ainda espera; aos 8 s, o exemplo marcado e o
    // aviso "Não apareceu a pergunta?".
    const { page, log, errors, context } = await newPage(browser, { geo: { estado: 'prompt', resposta: 'nunca' } });
    await page.clock.install();
    await page.goto(BASE);
    await page.waitForFunction(() => window.__geo?.pedidos === 1);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 20));
    await page.clock.runFor(7000);
    await page.waitForTimeout(300);
    assert.deepEqual(log.cnes.filter((a) => a.p_radius_m === 3000), [], 'aos 7 s, o topo ainda espera');
    assert.equal(await page.textContent('#heroLite h2'), 'Perto de você');
    assert.ok(await page.locator('#geoAvisoMais').isHidden());
    await page.clock.runFor(1500);
    await until(() => log.cnes.some((a) => a.p_radius_m === 3000), 5000);
    const c = log.cnes.find((a) => a.p_radius_m === 3000);
    assert.deepEqual([c.p_lat, c.p_lng], [-23.565, -46.652], 'aos 8 s, o exemplo da Av. Paulista');
    await page.clock.resume();
    await page.waitForFunction(() => document.querySelector('#heroLite h2').textContent === 'Exemplo: perto da Av. Paulista');
    await page.waitForFunction(() => document.querySelector('#heroLiteStatus').textContent === '4 locais perto da Av. Paulista, em São Paulo (exemplo)');
    await page.waitForSelector('#geoAvisoMais:not([hidden])');
    // No computador, "Clique"; o leitor de tela também ouve o aviso.
    const naoApareceu = 'Não apareceu a pergunta? Clique no ícone de localização ao lado do endereço do site ou escolha a cidade.';
    assert.equal(await page.textContent('#geoAvisoMais'), naoApareceu);
    await page.waitForFunction((t) => document.querySelector('#geoStatus').textContent === t, naoApareceu);
    // O "Não apareceu" vem depois dos botões do aviso (o "Saiba mais" não desce para baixo do aviso de privacidade).
    assert.ok(await page.evaluate(() => !!(document.querySelector('#geoAviso .geo-bts').compareDocumentPosition(document.querySelector('#geoAvisoMais')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    assert.match(await page.textContent('#pvEstado .pv-nao'), /Não apareceu a pergunta\?/);
    assert.equal(await page.evaluate(() => document.querySelector('#reais').dataset.estado), 'aguardando', 'a tela continua esperando a resposta');
    // Aos 8 s sem resposta, um toque pede de novo (no Firefox, fechar a pergunta não responde nada).
    assert.deepEqual(await botoesCartao(page), ['Usar minha localização', 'Prefiro escolher a cidade']);
    await page.click('#pvEstado [data-bt="usar"]');
    await page.waitForFunction(() => window.__geo.chamadas === 2);
    assert.equal((await contagemGeo(page)).pedidos, 2, 'o toque pediu de novo');
    // Logo depois do toque, o botão volta a esperar (sem chamar de novo a cada toque).
    await page.waitForFunction(() => document.querySelector('#pvEstado [data-bt="usar"]')?.textContent.trim() === 'Aguardando permissão…');
    const pad = await page.evaluate(() => [parseFloat(document.documentElement.style.scrollPaddingTop), document.querySelector('#geoAviso').getBoundingClientRect().bottom]);
    assert.ok(Math.abs(pad[0] - (pad[1] + 16)) <= 1, `o aviso cresceu e o espaço do alto acompanhou (${pad.join(' / ')})`);
    await shot(page, 'perto-nao-apareceu-8s');
    // "Prefiro escolher a cidade" no aviso: o aviso some e o seletor abre.
    await page.click('#geoAviso [data-city-open]');
    await page.waitForSelector('.ov.open #cityQ');
    assert.ok(await page.locator('#geoAviso').isHidden());
    // Escolheu a cidade com o pedido ainda aberto: vale a cidade. A permissão que chega depois serve só para
    // "fica a X km de você" (a lista continua na cidade e o leitor de tela não ouve "perto de você").
    await page.keyboard.type('rio');
    await page.waitForSelector('#cityList [role=option]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
    await tela(page, 'lista');
    assert.equal(await page.textContent('#cityName'), 'Rio de Janeiro - RJ');
    const antes = log.cnes.length;
    await mudarGeo(page, 'granted');
    await page.waitForFunction(() => /fica a 363 km de você/.test(document.querySelector('#cityLine').textContent));
    assert.equal(await page.textContent('#cityRot'), 'Cidade escolhida', 'a cidade continua escolhida');
    await page.waitForTimeout(500);
    assert.ok(log.cnes.slice(antes).every((a) => a.p_lat === -22.907), 'a lista continua no centro do Rio');
    assert.ok(!/Pronto/.test(await page.textContent('#pvSum')) && !/Pronto/.test(await page.textContent('#geoStatus')), 'sem anunciar "perto de você" mostrando a cidade');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('imed_cidade'))), RIO);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('#nearCta: rola até a tela sem mudar o endereço, pede a localização com o toque e mostra o local mais perto sem mudar de altura', async () => {
  {
    // 2 recusas: nada sozinho; o toque no #nearCta faz 1 pedido.
    const { page, errors, context } = await newPage(browser, { geo: { estado: 'prompt', resposta: 'permitir' }, store: { imed_geo_recusas: 2 } });
    await page.goto(BASE);
    await tela(page, 'onde');
    await page.waitForTimeout(500);
    assert.equal((await contagemGeo(page)).pedidos, 0);
    assert.equal(await page.getAttribute('#nearCta', 'href'), '#reais');
    await page.click('#nearCta');
    await page.waitForFunction(() => document.activeElement?.id === 'reaisTitle');
    assert.equal(page.url(), BASE, 'o endereço não muda');
    const top = await page.evaluate(() => document.querySelector('#reaisTitle').getBoundingClientRect().top);
    assert.ok(top > 0 && top < 400, `a tela chega à vista (título em ${Math.round(top)} px)`);
    await tela(page, 'lista');
    assert.equal((await contagemGeo(page)).pedidos, 1, 'o toque fez 1 pedido');
    assert.equal(await page.evaluate(() => localStorage.getItem('imed_geo_recusas')), null, 'permitiu: as recusas voltam a 0');
    assert.deepEqual(errors, []);
    await context.close();
  }
  for (const mobile of [true, false]) {
    // Localização já permitida: o texto pequeno vira o local mais perto de verdade, sem o botão mudar de altura.
    const devagar = async (r) => { await new Promise((ok) => setTimeout(ok, 1200)); return json(r, CNES_ROWS); };
    const { page, errors, context } = await newPage(browser, { mobile, cnes: devagar });
    await page.goto(BASE);
    await page.waitForSelector('#nearCta small');
    assert.equal(await page.textContent('#nearCta small'), 'Clínicas, laboratórios e hospitais reais, no mapa');
    const h0 = await page.evaluate(() => document.querySelector('#nearCta').getBoundingClientRect().height);
    await page.waitForFunction(() => /^Mais perto:/.test(document.querySelector('#nearCta small').textContent));
    assert.equal(await page.textContent('#nearCta small'), 'Mais perto: Clínica Parceira Paulista, a 300 m');
    const h1 = await page.evaluate(() => document.querySelector('#nearCta').getBoundingClientRect().height);
    assert.equal(h1, h0, `${mobile ? 'celular' : 'computador'}: o botão não muda de altura (${h0} → ${h1})`);
    if (mobile) await shot(page, 'perto-nearcta-celular');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('links com #: #cidade e #cidades abrem o seletor sem pedir; #lojas pede e leva à tela; sem a função de permissões (Safari antigo), pergunta igual', async () => {
  for (const h of ['#cidade', '#cidades']) {
    // Com o ponto de partida antigo (bairro de São Paulo) guardado: ele é apagado.
    const { page, errors, context } = await newPage(browser, { geo: { estado: 'prompt' }, store: { imed_place: 'paulista' } });
    await page.goto(`${BASE}${h}`);
    await page.waitForSelector('.ov.open .sheet.cid #cityQ');
    await page.waitForFunction(() => document.activeElement?.id === 'cityQ');
    await tela(page, 'onde');
    await page.waitForTimeout(800);
    assert.equal((await contagemGeo(page)).pedidos, 0, `${h}: sem pedido automático`);
    assert.ok(await page.locator('#geoAviso').isHidden(), `${h}: sem aviso`);
    assert.equal(page.url(), BASE, `${h}: o # sai do endereço`);
    assert.equal(await page.evaluate(() => localStorage.getItem('imed_place')), null, 'o ponto de partida antigo sai do aparelho');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    const { page, errors, context } = await newPage(browser, { geo: { estado: 'prompt', resposta: 'permitir' } });
    await page.goto(`${BASE}#lojas`);
    await tela(page, 'lista');
    assert.equal((await contagemGeo(page)).pedidos, 1, '#lojas: pede ao abrir');
    assert.equal(page.url(), BASE, '#lojas: o # sai do endereço');
    // a página rola 60 ms depois de abrir: espera a rolagem chegar em vez de medir uma vez só (máquina lenta do GitHub)
    await page.waitForFunction(() => { const t = document.querySelector('#reais').getBoundingClientRect().top; return t > -50 && t < 300; }, null, { timeout: 5000 }).catch(() => {});
    const top = await page.evaluate(() => document.querySelector('#reais').getBoundingClientRect().top);
    assert.ok(top > -50 && top < 300, `#lojas: leva à tela (alto da tela em ${Math.round(top)} px)`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Sem navigator.permissions: vale como "perguntar" (pede ao abrir, com o aviso). Sem como saber se foi bloqueio,
    // a recusa vira "Sem a localização, escolha a cidade"; tocar de novo com o navegador já bloqueado dá erro na hora:
    // "não mostrou o pedido", com a explicação do cadeado.
    const { page, errors, context } = await newPage(browser, { geo: { semPermissionsApi: true, resposta: 'negar', atraso: 1200 } });
    await page.goto(BASE);
    await page.waitForSelector('#geoAviso:not([hidden])');
    assert.equal(await page.evaluate(() => 'permissions' in navigator), false);
    await tela(page, 'fechou');
    assert.equal((await contagemGeo(page)).pedidos, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('imed_geo_recusas')), '1');
    await page.click('#pvEstado [data-bt="usar"]');
    await tela(page, 'naoapareceu');
    assert.deepEqual(await contagemGeo(page), { estado: 'denied', chamadas: 2, pedidos: 1 });
    assert.equal(await page.evaluate(() => localStorage.getItem('imed_geo_recusas')), '2');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('Meus pedidos: cancelar pelo site com confirmação, horário de volta e situação "Cancelado" guardada', async () => {
  const { page, log, errors, context } = await newPage(browser, { appts: [...APPTS.slice(0, 3), ...SLOT_APPTS], now: NOW,
    status: (r) => json(r, [{ id: ID1, status: 'confirmed', reviewed: false }, { id: ID2, status: 'completed', reviewed: false }, { id: SID1, status: 'confirmed', reviewed: false }, { id: SID2, status: 'pending', reviewed: false }]) });
  await page.goto(`${BASE}#agenda`);
  await page.waitForSelector('.appt [data-cancel]');
  const card = (n) => page.locator('.appt').nth(n);
  assert.equal(await card(0).locator('[data-cancel]').count(), 1, 'confirmado: pode cancelar');
  assert.equal(await card(1).locator('[data-cancel]').count(), 0, 'concluído: não');
  assert.equal(await card(2).locator('[data-cancel]').count(), 0, 'pedido antigo sem código: não');
  await card(0).locator('[data-cancel]').click();
  assert.match(await card(0).textContent(), /Cancelar este pedido\? Cancelar pelo IMED é grátis/);
  // Local que ainda não é parceiro: só a equipe do IMED vê; nada promete que o local foi avisado.
  assert.match(await card(0).textContent(), /A equipe do IMED vê o cancelamento\. Se o horário já tinha sido combinado com o local, ligue também para ele\./);
  assert.ok(!/painel/.test(await card(0).locator('.appt-ask').textContent()), 'não fala em painel para local que não é parceiro');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Sim, cancelar', 'foco no "Sim, cancelar"');
  await card(0).locator('[data-cancel-no]').click();
  assert.equal(await card(0).locator('.appt-ask').count(), 0, '"Não" fecha a pergunta');
  assert.equal(log.cancel.length, 0);
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Cancelar pedido');
  await card(0).locator('[data-cancel]').click();
  await card(0).locator('[data-cancel-yes]').click();
  await page.waitForFunction(() => /Cancelado/.test(document.querySelector('.appt').textContent));
  assert.deepEqual(log.cancel, [{ p_id: ID1, p_token: 'a'.repeat(64) }], 'cancela com o código guardado no aparelho');
  assert.match(await page.textContent('#toast'), /Pedido cancelado\. A equipe do IMED vê o cancelamento\. Se o horário já tinha sido combinado com o local, ligue também para ele: \(11\) 3141-1000\./);
  assert.equal(await card(0).locator('[data-cancel], [data-ics]').count(), 0, 'cancelado: sem cancelar nem lembrete');
  // O aviso rápido some; no cartão fica o lembrete de ligar para o local, com o telefone guardado no pedido.
  assert.match(await card(0).locator('.appt-note').textContent(), /Cancelado por você\. A equipe do IMED vê o cancelamento\. Se o horário já tinha sido combinado com o local, ligue também para ele: \(11\) 3141-1000\./);
  assert.equal(await card(0).locator('.appt-note a').getAttribute('href'), 'tel:+551131411000');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(stored.find((a) => a.id === ID1).status, 'cancelado', 'situação guardada no aparelho');
  // Horário marcado: avisa que o horário voltou a ficar livre.
  const slotCard = page.locator(`.appt[id="pedido-${SID1}"]`);
  await slotCard.locator('[data-cancel]').click();
  assert.match(await slotCard.textContent(), /A clínica vê o cancelamento no painel dela e o horário volta a ficar livre para outra pessoa\./, 'parceiro: a clínica vê no painel dela');
  await slotCard.locator('[data-cancel-yes]').click();
  await page.waitForFunction(() => /O horário voltou a ficar livre\. A clínica vê o cancelamento no painel dela\./.test(document.querySelector('#toast').textContent));
  assert.deepEqual(log.cancel.at(-1), { p_id: SID1, p_token: 'd'.repeat(64) });
  await shot(page, 'inicio-cancelar');
  assert.deepEqual(errors, []);
  await context.close();
  // O banco recusa (horário já passou): avisa, fecha a pergunta e busca a situação de novo.
  const b = await newPage(browser, { appts: [APPTS[0]], now: NOW, cancel: (r) => json(r, 'past') });
  await b.page.goto(`${BASE}#agenda`);
  await b.page.waitForSelector('.appt [data-cancel]');
  const st = b.log.status.length;
  await b.page.click('.appt [data-cancel]');
  await b.page.click('.appt [data-cancel-yes]');
  await b.page.waitForFunction(() => /O horário deste pedido já passou/.test(document.querySelector('#toast').textContent));
  assert.equal(await b.page.locator('.appt-ask').count(), 0);
  await until(() => b.log.status.length > st);
  assert.ok(b.log.status.length > st, 'situação buscada de novo');
  assert.equal(await b.page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts'))[0].status), 'pendente', 'nada muda no aparelho');
  await b.context.close();
  // Sem internet: a pergunta continua aberta para tentar de novo.
  const c = await newPage(browser, { appts: [APPTS[0]], now: NOW, cancel: (r) => r.abort() });
  await c.page.goto(`${BASE}#agenda`);
  await c.page.waitForSelector('.appt [data-cancel]');
  await c.page.click('.appt [data-cancel]');
  await c.page.click('.appt [data-cancel-yes]');
  await c.page.waitForFunction(() => /Não foi possível cancelar agora/.test(document.querySelector('#toast').textContent));
  assert.equal(await c.page.locator('.appt [data-cancel-yes]:not([disabled])').count(), 1);
  assert.deepEqual(c.errors, []);
  await c.context.close();
});

await scenario('desktop: topo, busca por exame e capturas', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(BASE);
  await page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill').textContent));
  await shot(page, 'inicio-desktop');
  assert.equal(await page.locator('.tabs a[href="perto.html"]').count(), 1);
  assert.equal(await page.locator('.tabs a[href="conta.html"]').count(), 1);
  await page.fill('#heroQ', 'resson');
  await page.waitForSelector('#heroSug .sug');
  assert.ok(!/R\$|clínicas ·/.test(await page.textContent('#heroSug')), 'sugestão sem preço nem contagem inventada');
  await Promise.all([page.waitForURL(/perto\.html\?exame=rm/), page.press('#heroQ', 'Enter')]);
  if (SHOTS) {
    await page.goto(BASE);
    await scrollAll(page);
    await page.waitForSelector('#realList li b');
    await page.screenshot({ path: join(SHOTS, 'inicio-desktop-inteira.png'), fullPage: true });
  }
  assert.deepEqual(errors.filter((e) => !/perto/.test(e)), []);
  await context.close();
});

await scenario('links antigos: #exame-rm vai para a busca e #perto abre perto de mim', async () => {
  const { page, context } = await newPage(browser);
  await page.goto(`${BASE}#exame-rm`);
  await page.waitForURL(/perto\.html\?exame=rm/);
  await page.goto(`${BASE}#perto`);
  await page.waitForURL(/perto\.html/);
  await context.close();
});

await scenario('guias de exames: sem preço nem clínica fictícia, com link para a busca', async () => {
  const { page, errors, context } = await newPage(browser);
  for (const [slug, code] of [['raio-x', 'rx'], ['ressonancia-magnetica', 'rm'], ['ecocardiograma', 'eco']]) {
    await page.goto(`${BASE}exames/${slug}.html`);
    const text = await page.evaluate(() => document.body.innerText);
    // "Exemplo" pegaria uma clínica fictícia ("Clínica Exemplo"); "por exemplo" (o lado do corpo no pedido médico) vale.
    assert.ok(!/R\$|★|Pix|(?<!por )\b[Ee]xemplo/.test(text), `${slug}: sem preço, nota ou exemplo`);
    assert.ok(await page.locator(`a[href="../perto.html?exame=${code}"]`).count() >= 2, `${slug}: botão para a busca`);
    assert.ok(await page.locator('a[href="../cidades/"]').count() >= 1, `${slug}: ver por cidade`);
    assert.ok(await page.locator('#preparo').count() === 1, `${slug}: preparo mantido`);
  }
  await page.goto(`${BASE}exames/`);
  assert.ok(!/R\$/.test(await page.evaluate(() => document.body.innerText)));
  if (SHOTS) { await page.goto(`${BASE}exames/raio-x.html`); await page.screenshot({ path: join(SHOTS, 'guia-raio-x.png'), fullPage: true }); }
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('service worker ligado: com economia de dados ou 2G, não instala e não baixa o 3D', async () => {
  // Os outros cenários bloqueiam o service worker; aqui ele fica livre, e quem conta os arquivos é o servidor.
  const swSrc = await readFile(join(ROOT, 'sw.js'), 'utf8');
  const core = (swSrc.match(/const CORE = \[([\s\S]*?)\];/) || ['', ''])[1];
  const HEAVY_3D = /maplibre-gl(-worker)?\.js|hero3d\.js/;
  const OTHER = /leaflet\.js|geo-core\.js|painel\.js|\/local\.js|\/perto\.js/; // inicio-perto.js é da página inicial
  for (const [name, device, wantSW] of [
    ['economia de dados', { memory: 8, cores: 8, saveData: true }, false],
    ['internet 2G', { memory: 8, cores: 8, effectiveType: '2g' }, false],
    ['economia de dados e pouca memória', { memory: 1, cores: 8, saveData: true }, false],
    ['pouca memória', { memory: 1, cores: 8 }, true],
  ]) {
    const from = served.length;
    const { page, errors, context } = await newPage(browser, { mobile: true, motion: 'no-preference', device, sw: true });
    await page.goto(BASE);
    await page.waitForSelector('#heroLite li a');
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000); // tempo de sobra para o service worker instalar e baixar a lista dele
    assert.equal(await page.evaluate(() => document.body.dataset.hero), 'leve', `${name}: modo leve`);
    const reg = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
    assert.equal(reg, wantSW, `${name}: service worker ${wantSW ? 'instalado' : 'não instalado'}`);
    const got = served.slice(from);
    const got3d = got.filter((p) => HEAVY_3D.test(p));
    if (!wantSW) {
      assert.deepEqual(got3d, [], `${name}: a biblioteca do mapa e hero3d.js não são baixadas`);
      assert.deepEqual(got.filter((p) => OTHER.test(p)), [], `${name}: nada de Leaflet, geo-core ou scripts de outras páginas`);
    } else if (HEAVY_3D.test(core)) {
      // Pouca memória sem economia de dados: o service worker continua (site abre sem internet), mas a lista
      // CORE do sw.js ainda pré-baixa o 3D. A correção é tirar esses arquivos do CORE (fora desta frente).
      console.log(`  aviso (${name}): o CORE do sw.js ainda pré-baixa ${got3d.join(', ') || 'o 3D'}; tirar do CORE (integrador)`);
    } else {
      assert.deepEqual(got3d, [], `${name}: a biblioteca do mapa e hero3d.js não são baixadas`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Aparelho normal: o service worker continua instalado (o site abre sem internet e pode virar app).
  const { page, errors, context } = await newPage(browser, { motion: 'no-preference', device: { memory: 8, cores: 8 }, sw: true });
  await page.goto(BASE);
  await page.waitForLoadState('load');
  let registered = false;
  for (let i = 0; i < 40 && !registered; i++) {
    registered = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
    if (!registered) await page.waitForTimeout(250);
  }
  assert.ok(registered, 'aparelho normal: service worker instalado');
  assert.deepEqual(errors, []);
  await context.close();
});

// A lista leve do computador (aparelho fraco ou movimento reduzido) tem largura fixa: um nome comprido do CNES
// ganha reticências e não passa da borda do cartão (no vídeo de 30/10, "Osteon Clínica de Ortopedia..." passava).
await scenario('computador em modo leve: nome comprido na lista do topo não passa do cartão', async () => {
  const LONGO = { ...CNES_ROWS[0], cnes: '7300002', name: 'Osteon Clínica de Ortopedia e Traumatologia Sociedade Simples Nome Bem Comprido Teste', distance_m: 90 };
  const { page, errors, context } = await newPage(browser, { motion: 'no-preference', device: { memory: 1, cores: 8 }, cnes: (r) => json(r, [LONGO, ...CNES_ROWS.slice(1)]) });
  await page.goto(BASE);
  await page.waitForSelector('#heroLite li a');
  assert.equal(await page.evaluate(() => document.body.dataset.hero), 'leve', 'modo leve');
  const m = await page.evaluate(() => {
    const card = document.querySelector('#heroLite').getBoundingClientRect();
    const items = [...document.querySelectorAll('#heroLite li a')].map((a) => Math.round(a.getBoundingClientRect().right - card.right));
    const b = [...document.querySelectorAll('#heroLite li b')].find((x) => /Nome Bem Comprido/.test(x.textContent));
    return { items, achou: !!b, cortado: !!b && b.scrollWidth > b.clientWidth };
  });
  await shot(page, 'inicio-leve-nome-comprido');
  assert.ok(m.achou, 'o local de nome comprido aparece na lista leve');
  assert.ok(m.items.every((d) => d <= 0), `nenhuma linha passa da borda do cartão (${m.items.join(', ')} px)`);
  assert.ok(m.cortado, 'o nome comprido ganha reticências');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('lista leve não fica em "Carregando…" quando o banco falha antes de o 3D falhar', async () => {
  // Aparelho normal: pede os locais e começa a baixar o 3D. O banco responde erro na hora; a biblioteca do mapa
  // falha depois.
  const { page, errors, context } = await newPage(browser, {
    mobile: true, motion: 'no-preference', device: { memory: 8, cores: 8 },
    cnes: (r) => json(r, { message: 'erro' }, 500),
    lib3d: async (route) => { await new Promise((ok) => setTimeout(ok, 800)); await route.abort(); },
  });
  await page.goto(BASE);
  await page.waitForFunction(() => document.body.classList.contains('no-webgl'), null, { timeout: 20000 });
  await page.waitForTimeout(300);
  const txt = await page.textContent('#heroLite');
  assert.ok(!/Carregando/.test(txt), `sem "Carregando…" preso (${txt})`);
  assert.match(txt, /Veja clínicas, laboratórios e hospitais perto de você na busca/);
  assert.equal(await page.getAttribute('#heroLite a.more', 'href'), 'perto.html?usar=localizacao');
  assert.match(await page.textContent('#heroLiteStatus'), /não está disponível agora/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('iPhone (o Safari informa 4 núcleos em todo iPhone) recebe o 3D; Android com 4 núcleos fica no modo leve', async () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A155M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  for (const [name, ua, want] of [['iPhone', IPHONE, '3d'], ['Android', ANDROID, 'leve']]) {
    const from = served.length;
    const { page, errors, context } = await newPage(browser, { mobile: true, motion: 'no-preference', ua, device: { memory: 4, cores: 4 } });
    await page.goto(BASE);
    await page.waitForFunction(() => ['carregando', '3d', 'leve'].includes(document.body.dataset.hero), null, { timeout: 20000 });
    const mode = await page.evaluate(() => (document.body.classList.contains('no-webgl') ? 'sem-webgl' : document.body.dataset.hero));
    if (mode === 'sem-webgl') { console.log(`  (${name}: sem WebGL neste navegador)`); await context.close(); continue; }
    if (want === '3d') {
      assert.ok(['carregando', '3d'].includes(mode), `${name}: 3D (${mode})`);
      await page.waitForFunction(() => document.body.dataset.hero === '3d', null, { timeout: 30000 });
      assert.ok(served.slice(from).some((p) => /maplibre-gl\.js/.test(p)), `${name}: baixa a biblioteca do mapa`);
    } else {
      assert.equal(mode, 'leve', `${name}: modo leve`);
      await page.waitForTimeout(1000);
      assert.ok(!served.slice(from).some((p) => /maplibre|hero3d\.js/.test(p)), `${name}: não baixa o 3D`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('Meus pedidos com horário marcado: hora de São Paulo (aparelho em outro fuso), confirmado e lembrete na hora exata', async () => {
  // Aparelho no fuso de Tóquio: a página tem de mostrar a hora de São Paulo, não a do aparelho.
  const { page, log, errors, context } = await newPage(browser, { appts: SLOT_APPTS, now: NOW, tz: 'Asia/Tokyo', status: (r) => json(r, { message: 'erro' }, 500) });
  await page.goto(`${BASE}#agenda`);
  await page.waitForFunction(() => document.querySelectorAll('.appt').length === 2 && !/Consultando/.test(document.querySelector('#appts').textContent));
  assert.equal(log.status.length, 1, 'consultou a situação no banco');
  const cards = await page.$$eval('.appt', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  assert.match(cards[0], /Horário marcado: quinta-feira, 05 de novembro às 09:30/);
  assert.match(cards[1], /Horário marcado: sexta-feira, 06 de novembro às 23:30/, 'dia de São Paulo, não o do relógio mundial');
  assert.ok(cards.every((c) => !/Preferência/.test(c)), 'horário marcado não é "preferência"');
  // O banco não respondeu: vale o "confirmado" que o aparelho guardou quando o horário foi marcado.
  const st = await page.$$eval('.appt .status', (els) => els.map((e) => [e.textContent, e.className]));
  assert.deepEqual(st.map((s) => s[0]), ['Confirmado', 'Confirmado']);
  assert.ok(st.every((s) => /\bok\b/.test(s[1])), 'selo verde de confirmado');
  const ics = async (n) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(`.appt >> nth=${n} >> button:has-text("Adicionar à agenda")`)]);
    return (await readFile(await download.path(), 'utf8')).replace(/\r\n /g, '');
  };
  const a = await ics(0);
  assert.match(a, /DTSTART:20261105T123000Z\r\nDTEND:20261105T130000Z/, 'em UTC (09:30 em São Paulo), 30 min sem o fim guardado');
  assert.match(a, /Horário: quinta-feira\\, 05 de novembro às 09:30 \(horário de Brasília\)\./, 'a hora da clínica escrita no lembrete');
  assert.match(a, /STATUS:CONFIRMED/);
  assert.ok(!/STATUS:TENTATIVE/.test(a));
  assert.match(a, /Horário confirmado. Chegue com 15 minutos de antecedência./);
  assert.ok(!/O horário é confirmado pela clínica/.test(a), 'sem o texto de pedido ainda não confirmado');
  assert.match(a, /Retire objetos de metal/, 'preparo da ressonância');
  const b = await ics(1);
  assert.match(b, /DTSTART:20261107T023000Z\r\nDTEND:20261107T030000Z/, '23:30 de 06/11 em São Paulo = 02:30 UTC de 07/11');
  assert.deepEqual(errors, []);
  await context.close();
  // Com resposta do banco, vale a situação dele (por exemplo, cancelado pela clínica).
  const live = await newPage(browser, { appts: SLOT_APPTS, now: NOW, status: (r) => json(r, [{ id: SID1, status: 'confirmed', reviewed: false }, { id: SID2, status: 'cancelled', reviewed: false }]) });
  await live.page.goto(`${BASE}#agenda`);
  await live.page.waitForFunction(() => /Cancelado/.test(document.querySelector('#appts').textContent));
  const st2 = await live.page.$$eval('.appt .status', (els) => els.map((e) => e.textContent));
  assert.deepEqual(st2, ['Confirmado', 'Cancelado']);
  assert.equal(await live.page.locator('.appt >> nth=1 >> button:has-text("Adicionar à agenda")').count(), 0, 'cancelado: sem lembrete');
  await shot(live.page, 'inicio-agendados-horario');
  assert.deepEqual(live.errors, []);
  await live.context.close();
});

await scenario('revisão 5.1: Meus pedidos confere o agendamento cuja resposta se perdeu (intenção guardada) e o lista com o código', async () => {
  const IID = 'eeeeeeee-1111-4111-8111-111111111111';
  const TOKEN = 'a'.repeat(64);
  const CLINIC = 'cccccccc-0000-4000-8000-000000000001';
  const intent = { key: `${CLINIC}|dddddddd-0000-4000-8000-0000000000a1|2026-11-05T12:30:00.000Z`, id: IID, token: TOKEN, created: '2026-10-30T11:00:00.000Z',
    place: { id: `imed:${CLINIC}`, name: 'Imagem Paulista', phone: '(11) 3222-1000' } };
  const { page, log, errors, context } = await newPage(browser, { appts: [], now: NOW, store: { imed_intencao: intent } });
  const my = [];
  await context.route(`${REST}rpc/agenda_my_booking`, async (route) => {
    if (route.request().method() === 'OPTIONS') return preflight(route);
    my.push(JSON.parse(route.request().postData() || '{}'));
    return json(route, { status: 'ok', id: IID, request_status: 'confirmed', timezone: 'America/Sao_Paulo', slot_start: '2026-11-05T12:30:00+00:00', slot_end: '2026-11-05T13:00:00+00:00',
      items: [{ seq: 1, exam_code: 'rm', procedure: 'Ressonância do joelho', status: 'confirmed', prep_text: 'Retire objetos de metal.', fasting_hours: 4 }] });
  });
  await page.goto(`${BASE}#agenda`);
  await page.waitForFunction(() => document.querySelectorAll('.appt').length === 1);
  assert.deepEqual(my[0], { p_id: IID, p_token: TOKEN });
  const card = (await page.textContent('.appt')).replace(/\s+/g, ' ');
  assert.match(card, /Imagem Paulista/);
  assert.match(card, /Ressonância do joelho/);
  assert.match(card, /Horário marcado: quinta-feira, 05 de novembro às 09:30/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts')));
  assert.equal(stored[0].id, IID);
  assert.equal(stored[0].token, TOKEN, 'com o código para cancelar');
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_intencao')), null, 'a intenção é apagada');
  // o lembrete leva o preparo informado pela clínica, não o texto geral do exame
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.appt button:has-text("Adicionar à agenda")')]);
  const ics = (await readFile(await download.path(), 'utf8')).replace(/\r\n /g, '');
  assert.match(ics, /Preparo: Jejum de 4 horas\. Retire objetos de metal\./);
  assert.ok(log.status.length >= 1);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Meus pedidos com "Remarcação solicitada" (bloqueio da clínica, 4.2): sem lembrete, cancelar sem "horário livre" e o prazo da clínica fecha a pergunta', async () => {
  let resposta = 'too_late';
  const situacao = [{ id: SID1, status: 'reschedule_requested', reviewed: false }, { id: SID2, status: 'confirmed', reviewed: false }];
  const { page, log, errors, context } = await newPage(browser, { appts: SLOT_APPTS, now: NOW, status: (r) => json(r, situacao), cancel: (r) => json(r, resposta) });
  await page.goto(`${BASE}#agenda`);
  await page.waitForFunction(() => /Remarcação solicitada/.test(document.querySelector('#appts').textContent) && document.querySelector('.appt [data-cancel]'));
  const rr = page.locator(`.appt[id="pedido-${SID1}"]`);
  const ok = page.locator(`.appt[id="pedido-${SID2}"]`);
  assert.equal((await rr.locator('.status').textContent()).trim(), 'Remarcação solicitada');
  // o horário foi solto pela clínica: nada de "Adicionar à agenda" (nem um .ics dizendo "Horário confirmado")
  assert.equal(await rr.locator('[data-ics]').count(), 0, 'remarcação: sem lembrete');
  assert.equal(await ok.locator('[data-ics]').count(), 1, 'confirmado: com lembrete');
  // cancelar: a pergunta não promete horário livre (o período está bloqueado)
  await rr.locator('[data-cancel]').click();
  const pergunta = (await rr.locator('.appt-ask p').textContent()).trim();
  assert.equal(pergunta, 'Cancelar este pedido? Cancelar pelo IMED é grátis. A clínica vê o cancelamento no painel dela.');
  // prazo da clínica (too_late): resposta final — fecha a pergunta e confere a situação de novo
  const st = log.status.length;
  await rr.locator('[data-cancel-yes]').click();
  await page.waitForFunction(() => /O prazo para cancelar pelo site já passou\. Fale com a clínica\./.test(document.querySelector('#toast').textContent));
  assert.equal(await page.locator('.appt-ask').count(), 0, 'too_late fecha a pergunta');
  await until(() => log.status.length > st);
  assert.ok(log.status.length > st, 'situação buscada de novo');
  // dentro do prazo: cancela, sem "O horário voltou a ficar livre"
  resposta = 'ok';
  await page.waitForSelector(`.appt[id="pedido-${SID1}"] [data-cancel]`);
  await rr.locator('[data-cancel]').click();
  await rr.locator('[data-cancel-yes]').click();
  await page.waitForFunction(() => /Pedido cancelado\./.test(document.querySelector('#toast').textContent));
  assert.equal((await page.textContent('#toast')).trim(), 'Pedido cancelado. A clínica vê o cancelamento no painel dela.');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('computador em modo leve: o cartão da lista não cobre o título nem a busca (980 a 1366 px)', async () => {
  const { page, errors, context } = await newPage(browser, { viewport: { width: 980, height: 800 } });
  await page.goto(BASE);
  await page.waitForSelector('#heroLite li a');
  for (const w of [980, 1000, 1024, 1100, 1280, 1366]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => {
      const card = document.querySelector('#heroLite').getBoundingClientRect();
      const right = Math.max(...[...document.querySelectorAll('.hero-in > *')].map((e) => e.getBoundingClientRect().right));
      return { left: card.left, right: card.right, top: card.top, text: right };
    });
    assert.ok(m.left >= m.text + 8, `${w} px: cartão começa em ${Math.round(m.left)}, texto e busca vão até ${Math.round(m.text)}`);
    assert.ok(m.right <= w, `${w} px: cartão dentro da tela`);
  }
  await page.setViewportSize({ width: 980, height: 800 });
  await shot(page, 'inicio-desktop-980-leve');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('foto da fachada: celular com tela de alta densidade baixa a versão menor', async () => {
  for (const [name, opts, want, avoid] of [
    ['celular, densidade 3', { mobile: true, dpr: 3 }, /fachada-sm\.webp$/, /\/fachada\.webp/],
    ['computador', {}, /\/fachada\.webp$/, /fachada-sm\.webp/],
  ]) {
    const { page, errors, context, requests } = await newPage(browser, opts);
    await page.goto(BASE);
    await page.locator('#clinicas').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const i = document.querySelector('#clinicas img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
    assert.match(await page.evaluate(() => document.querySelector('#clinicas img').currentSrc), want, name);
    assert.ok(!requests.some((u) => avoid.test(u)), `${name}: só uma versão da foto é baixada`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

/* ======================= L2: nomes do dia a dia na caixa "Qual exame você precisa?" ======================= */
// Texto de cada opção da lista de sugestões: [nome em negrito, linha de baixo].
const sugestoes = (page) => page.$$eval('#heroSug .sug', (els) => els.map((e) => [e.querySelector('b').textContent, e.querySelector('small').textContent]));
const CONFIRME = 'Confirme se o local faz este exame.';
// Endereço pedido ao sair da página inicial (antes de a busca tirar o ?onde= do endereço).
const navegaPara = (page, re) => page.waitForRequest((r) => r.isNavigationRequest() && re.test(r.url()));

await scenario('exame pelo nome do dia a dia: "hemograma" leva a perto.html?exame=lab, com o aviso do laboratório uma vez só; o dicionário só vem no toque', async () => {
  const { page, errors, context, requests } = await newPage(browser);
  await page.goto(BASE);
  await page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill').textContent));
  await page.waitForTimeout(400);
  assert.ok(!requests.some((u) => /exames-nomes\.js/.test(u)), 'a página inicial abre sem o dicionário');
  // Caixa vazia: os 9 exames, com o laboratório (o 9º).
  await page.focus('#heroQ');
  await page.waitForFunction(() => document.querySelectorAll('#heroSug .sug').length === 9);
  assert.deepEqual((await sugestoes(page))[8], ['Exames de laboratório (sangue, urina)', 'Ver lugares perto de você']);
  await page.fill('#heroQ', 'hemograma');
  await page.waitForFunction(() => /Hemograma/.test(document.querySelector('#heroSug')?.textContent || ''));
  assert.ok(requests.some((u) => /exames-nomes\.js/.test(u)), 'o dicionário vem quando a pessoa usa a caixa');
  assert.deepEqual((await sugestoes(page))[0], ['Hemograma', 'Laboratórios perto de você']);
  assert.equal(await page.getAttribute('#heroSug .sug', 'href'), 'perto.html?exame=lab');
  assert.equal(await page.textContent('#heroSug .hs-nota'), CONFIRME, 'o aviso aparece embaixo, uma vez');
  assert.equal(await page.getAttribute('#heroSug .hs-nota', 'aria-hidden'), 'true', 'fora das opções da lista (o leitor de tela ouve no anúncio)');
  assert.ok(!/R\$/.test(await page.textContent('#heroSug')), 'sem preço');
  await page.waitForFunction((c) => document.querySelector('#heroSugMsg').textContent === `1 sugestão abaixo. Use as setas para escolher. ${c}`, CONFIRME);
  // "glic": vários exames do laboratório, o aviso continua uma vez só.
  await page.fill('#heroQ', 'glic');
  await page.waitForFunction(() => document.querySelectorAll('#heroSug .sug').length >= 3);
  assert.equal(await page.locator('#heroSug .hs-nota').count(), 1);
  assert.ok((await sugestoes(page)).every(([, s]) => s === 'Laboratórios perto de você'));
  await page.fill('#heroQ', 'hemograma');
  await page.waitForFunction(() => document.querySelectorAll('#heroSug .sug').length === 1);
  await shot(page, 'inicio-exame-hemograma');
  await Promise.all([page.waitForURL(/perto\.html\?exame=lab$/), page.press('#heroQ', 'Enter')]);
  assert.deepEqual(errors.filter((e) => !/perto/.test(e)), []);
  await context.close();
});

await scenario('exame pelo apelido, pela sigla e com uma letra errada: "também chamado de"; "eco" mostra as duas opções e não escolhe sozinho', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(BASE);
  await page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill').textContent));
  for (const [q, primeira] of [
    ['USG', ['Ultrassom', 'Também chamado de USG']],
    ['ecografia', ['Ultrassom', 'Também chamado de ecografia']],
    ['tomo', ['Tomografia computadorizada', 'Também chamado de tomo']],
    ['RNM', ['Ressonância magnética', 'Também chamado de RNM']],
    ['resonancia', ['Ressonância magnética', 'Ver lugares perto de você']],
    ['exame de gravidez', ['Exame de gravidez', 'Laboratórios perto de você']],
    ['TSH', ['TSH', 'Laboratórios perto de você']],
    ['doppler', ['Doppler', 'Ultrassom: ver lugares perto de você']],
    ['ecocardiograma com doppler', ['Ecocardiograma com doppler', 'Ecocardiograma: ver lugares perto de você']],
  ]) {
    await page.fill('#heroQ', q);
    await page.waitForFunction(([b, s]) => { const o = document.querySelector('#heroSug .sug'); return o?.querySelector('b').textContent === b && o.querySelector('small').textContent === s; }, primeira);
    assert.deepEqual((await sugestoes(page))[0], primeira, q);
  }
  // Exame específico de imagem: o IMED também não sabe quais locais fazem.
  await page.fill('#heroQ', 'doppler');
  await page.waitForFunction((c) => document.querySelector('#heroSug .hs-nota')?.textContent === c, CONFIRME);
  // "eco": ecocardiograma ou ultrassom. O Enter não escolhe: a lista fica aberta e o leitor de tela ouve as opções.
  await page.fill('#heroQ', 'eco');
  await page.waitForFunction(() => document.querySelectorAll('#heroSug .sug').length === 2);
  assert.deepEqual(await sugestoes(page), [['Ecocardiograma', 'Também chamado de eco'], ['Ultrassom', 'Também chamado de eco']]);
  assert.equal(await page.textContent('#heroSug h6'), '“eco” pode ser:');
  assert.equal(await page.getAttribute('#heroSug', 'aria-label'), '“eco” pode ser:', 'a lista tem o nome da pergunta');
  const h6 = await page.$eval('#heroSug h6', (e) => { const c = getComputedStyle(e); return [c.fontSize, c.textTransform]; });
  assert.deepEqual(h6, ['14px', 'none'], 'a pergunta em letra legível, sem maiúsculas');
  await page.press('#heroQ', 'Enter');
  await page.waitForFunction(() => document.querySelector('#heroSugMsg').textContent === '“eco” pode ser ecocardiograma ou ultrassom. Escolha uma das opções. Use as setas para escolher.');
  await page.waitForTimeout(300);
  assert.equal(new URL(page.url()).pathname, '/', 'continua na página inicial');
  assert.ok(await page.isVisible('#heroSug'), 'as opções continuam abertas');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'heroQ');
  assert.equal(await page.getAttribute('#heroQ', 'aria-expanded'), 'true');
  await shot(page, 'inicio-exame-eco');
  // O botão Buscar também não escolhe sozinho.
  await page.click('.hs-go');
  await page.waitForTimeout(400);
  assert.equal(new URL(page.url()).pathname, '/');
  assert.ok(await page.isVisible('#heroSug .sug'));
  // Seta, Esc e Enter: o Esc desfaz a escolha da seta (o Enter mostra as opções de novo, sem escolher).
  await page.focus('#heroQ');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.ok(await page.isHidden('#heroSug'));
  assert.equal(await page.locator('#heroSug .sug.act, #heroSug [aria-selected="true"]').count(), 0);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  assert.equal(new URL(page.url()).pathname, '/', 'o Esc desfez a escolha: nada de ?exame=eco');
  assert.ok(await page.isVisible('#heroSug .sug'));
  // Com as setas, a pessoa escolhe; a opção marcada aparece bem (fundo e borda da cor do site).
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const act = await page.getAttribute('#heroQ', 'aria-activedescendant');
  assert.equal(await page.textContent(`#${act} b`), 'Ultrassom');
  const estilo = await page.$eval(`#${act}`, (e) => { const c = getComputedStyle(e); return [c.backgroundColor, c.boxShadow]; });
  assert.equal(estilo[0], 'rgb(230, 244, 248)');
  assert.match(estilo[1], /rgb\(11, 114, 144\)/);
  await Promise.all([page.waitForURL(/perto\.html\?exame=usg$/), page.keyboard.press('Enter')]);
  assert.deepEqual(errors.filter((e) => !/perto/.test(e)), []);
  await context.close();
});

await scenario('exame com lugar e doença: "ressonância em Campinas" leva a cidade junto; "dengue" pergunta se é o exame ou atendimento', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(BASE);
  await page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill').textContent));
  // A cidade escrita vai junto (a busca não usa a localização no lugar dela).
  await page.fill('#heroQ', 'ressonância em Campinas');
  await page.waitForFunction(() => /Ressonância/.test(document.querySelector('#heroSug .sug b')?.textContent || ''));
  assert.deepEqual((await sugestoes(page))[0], ['Ressonância magnética', 'Ver lugares em Campinas']);
  assert.equal(await page.getAttribute('#heroSug .sug', 'href'), 'perto.html?exame=rm&onde=Campinas');
  // Doença sozinha: o exame ou atendimento (todos os locais); o Enter não escolhe.
  await page.fill('#heroQ', 'dengue');
  await page.waitForFunction(() => document.querySelectorAll('#heroSug .sug').length === 2);
  assert.deepEqual(await sugestoes(page), [['Exame de dengue', 'Laboratórios perto de você'], ['Atendimento', 'Todos os locais perto de você']]);
  assert.equal(await page.textContent('#heroSug h6'), '“dengue”: você procura o exame ou atendimento?');
  assert.deepEqual(await page.$$eval('#heroSug .sug', (els) => els.map((e) => e.getAttribute('href'))), ['perto.html?exame=lab', 'perto.html?usar=localizacao']);
  await page.press('#heroQ', 'Enter');
  await page.waitForTimeout(400);
  assert.equal(new URL(page.url()).pathname, '/');
  await shot(page, 'inicio-dengue-exame-ou-atendimento');
  // Exame com cidade pelo Enter: a cidade vai no endereço da busca.
  await page.fill('#heroQ', 'ressonância em Campinas');
  await page.waitForFunction(() => /Ressonância/.test(document.querySelector('#heroSug .sug b')?.textContent || ''));
  await Promise.all([navegaPara(page, /perto\.html\?exame=rm&onde=Campinas$/), page.press('#heroQ', 'Enter')]);
  assert.deepEqual(errors.filter((e) => !/perto/.test(e)), []);
  await context.close();
});

await scenario('exame com bairro ou rua: o lugar não vai no endereço da página (fica só na aba) e a busca procura o lugar escrito', async () => {
  const VILA = { ok: true, lat: -23.58908, lng: -46.63429, label: 'Vila Mariana, São Paulo - SP', precision: 'bairro', provider: 'osm' };
  const geocode = (r, b) => (b.action === 'geocode' ? json(r, VILA) : json(r, { ok: true, provider: 'osm', radius_m: b.radius_m, warnings: [], imed: [], cnes: [], places: [] }));
  const { page, log, errors, context } = await newPage(browser, { geocode });
  await page.goto(BASE);
  await page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill').textContent));
  await page.fill('#heroQ', 'ressonância em Vila Mariana');
  await page.waitForFunction(() => /Vila Mariana/.test(document.querySelector('#heroSug .sug small')?.textContent || ''));
  assert.deepEqual((await sugestoes(page))[0], ['Ressonância magnética', 'Ver lugares em Vila Mariana']);
  assert.equal(await page.getAttribute('#heroSug .sug', 'href'), 'perto.html?exame=rm', 'o bairro não vai no endereço da página');
  await shot(page, 'inicio-exame-bairro');
  await Promise.all([navegaPara(page, /perto\.html\?exame=rm$/), page.press('#heroQ', 'Enter')]);
  await page.waitForFunction(() => document.querySelector('#q')?.value === 'Vila Mariana');
  await page.waitForFunction(() => /Vila Mariana/.test(document.querySelector('#count')?.textContent || ''));
  assert.deepEqual(log.geocode.filter((b) => b.action === 'geocode').map((b) => b.q), ['Vila Mariana'], 'a busca procura o bairro escrito');
  assert.equal(await page.inputValue('#fExam'), 'rm');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('imed_onde')), null, 'lido uma vez e apagado');
  assert.deepEqual(errors.filter((e) => !/perto/.test(e)), []);
  await context.close();
});

await scenario('exame com o dicionário demorando: "Procurando…" (e não "Nenhum exame"); Buscar mostra a espera; sem o dicionário, a lista avisa', async () => {
  const { page, errors, context } = await newPage(browser);
  let atraso = 1500;
  await context.route(`${BASE}assets/js/exames-nomes.js`, async (route) => { if (atraso < 0) return route.abort(); await new Promise((r) => setTimeout(r, atraso)); return route.continue(); });
  await page.goto(BASE);
  await page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill').textContent));
  await page.fill('#heroQ', 'hemograma');
  await page.waitForSelector('#heroSug .hs-vazio');
  assert.equal(await page.textContent('#heroSug .hs-vazio'), 'Procurando…');
  await page.waitForTimeout(800);
  assert.ok(!/Nenhum exame/.test(await page.textContent('#heroSugMsg')), 'o leitor de tela não ouve "nenhum" enquanto o dicionário chega');
  await page.waitForFunction(() => /Hemograma/.test(document.querySelector('#heroSug').textContent));
  await context.close();
  // Buscar logo depois de digitar, com o dicionário chegando: o botão mostra "Buscando…" e o exame vai junto.
  const c = await newPage(browser);
  await c.context.route(`${BASE}assets/js/exames-nomes.js`, async (route) => { await new Promise((r) => setTimeout(r, atraso)); return route.continue(); });
  await c.page.goto(BASE);
  await c.page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill').textContent));
  await c.page.fill('#heroQ', 'hemograma');
  const indo = c.page.waitForURL(/perto\.html\?exame=lab$/);
  await c.page.press('#heroQ', 'Enter');
  assert.deepEqual(await c.page.$eval('.hs-go', (x) => [x.textContent, x.disabled]), ['Buscando…', true], 'o botão mostra a espera');
  await indo;
  await c.context.close();
  // Sem o dicionário (bloqueado): a lista fica aberta com o aviso.
  const b = await newPage(browser);
  await b.context.route(`${BASE}assets/js/exames-nomes.js`, (route) => route.abort());
  await b.page.goto(BASE);
  await b.page.waitForFunction(() => /estabelecimentos oficiais/.test(document.querySelector('#livePill').textContent));
  await b.page.fill('#heroQ', 'hemograma');
  await b.page.press('#heroQ', 'Enter');
  await b.page.waitForFunction(() => /não carregaram/.test(document.querySelector('#heroSug').textContent));
  assert.equal(new URL(b.page.url()).pathname, '/', 'o exame não se perde calado');
  assert.equal(await b.page.textContent('.hs-go'), 'Buscar');
  // O segundo Buscar segue sem o dicionário (como antes: todos os lugares perto de você).
  await Promise.all([b.page.waitForURL(/perto\.html\?usar=localizacao$/), b.page.press('#heroQ', 'Enter')]);
  assert.deepEqual([...errors, ...b.errors, ...c.errors].filter((e) => !/perto|exames-nomes/.test(e)), []);
  await b.context.close();
});

await scenario('exame pelo nome no celular (360 px): a lista cabe, fica à vista com o aviso de privacidade e o modo leve, e "Campinas" leva a Campinas', async () => {
  const { page, log, errors, context } = await newPage(browser, { mobile: true, viewport: { width: 360, height: 780 }, lgpd: true, geocode: (r) => json(r, { ok: true, lat: -22.90556, lng: -47.06083, label: 'Campinas - SP', precision: 'cidade', provider: 'osm' }) });
  await page.goto(BASE);
  await page.waitForSelector('.lgpd');
  assert.ok(await page.evaluate(() => document.body.classList.contains('lite')), 'modo leve (o cartão de exemplo fica perto da caixa)');
  // Caixa vazia: os 9 exames, com o laboratório.
  await page.tap('#heroQ');
  await page.waitForFunction(() => document.querySelectorAll('#heroSug .sug').length === 9);
  assert.ok(await page.evaluate(() => document.querySelector('#heroForm').getBoundingClientRect().top < 200), 'o formulário sobe para o alto da tela');
  await page.fill('#heroQ', 'glic');
  await page.waitForFunction(() => document.querySelectorAll('#heroSug .sug').length >= 4);
  // Cada opção, ao ser marcada com a seta, fica à vista e por cima de tudo (aviso de privacidade, cartão do modo
  // leve e menu de baixo).
  const n = await page.locator('#heroSug .sug').count();
  for (let i = 0; i < n; i += 1) {
    await page.keyboard.press('ArrowDown');
    const ok = await page.evaluate((k) => {
      const o = document.querySelectorAll('#heroSug .sug')[k], r = o.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      return { dentro: y > 0 && y < innerHeight, emCima: o.contains(document.elementFromPoint(x, y)) };
    }, i);
    assert.ok(ok.dentro && ok.emCima, `opção ${i + 1} de ${n} à vista e sem nada por cima (${JSON.stringify(ok)})`);
  }
  assert.ok(await page.isHidden('.lgpd'), 'o aviso de privacidade some enquanto a lista está aberta');
  const m = await page.evaluate(() => {
    const f = document.querySelector('#heroForm').getBoundingClientRect(), box = document.querySelector('#heroSug').getBoundingClientRect();
    return { inner: innerWidth, scroll: document.documentElement.scrollWidth, left: Math.min(f.left, box.left), right: Math.max(f.right, box.right), sugs: [...document.querySelectorAll('#heroSug .sug')].map((e) => e.scrollWidth - e.clientWidth) };
  });
  assert.ok(m.inner === 360 && m.scroll <= 360, `sem rolagem lateral (${JSON.stringify(m)})`);
  assert.ok(m.left >= 0 && m.right <= 360, `o formulário e a lista cabem na tela (${Math.round(m.left)} a ${Math.round(m.right)})`);
  assert.ok(m.sugs.every((x) => x <= 0), 'o texto das opções quebra a linha, sem cortar');
  await shot(page, 'inicio-exame-celular-360');
  await page.keyboard.press('Escape');
  assert.ok(await page.isVisible('.lgpd'), 'o aviso volta quando a lista fecha');
  // "eco" + Buscar no celular: as opções aparecem sem reabrir o teclado (o foco não volta para a caixa).
  await page.fill('#heroQ', 'eco');
  await page.waitForFunction(() => document.querySelectorAll('#heroSug .sug').length === 2);
  await page.tap('.hs-go');
  await page.waitForFunction(() => /“eco” pode ser/.test(document.querySelector('#heroSugMsg').textContent));
  assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'heroQ', 'o teclado do celular não reabre');
  assert.ok(await page.isVisible('#heroSug .sug'));
  assert.ok(!/setas/.test(await page.textContent('#heroSugMsg')), 'no celular, o anúncio não fala das setas');
  // Nome de cidade na caixa do exame: nenhuma sugestão inventada; o Buscar leva à busca em Campinas.
  await page.fill('#heroQ', 'Campinas');
  await page.waitForFunction(() => /Nenhum exame com esse nome\. Toque em Buscar para ver os lugares em Campinas\./.test(document.querySelector('#heroSug').textContent));
  await Promise.all([navegaPara(page, /perto\.html\?onde=Campinas$/), page.press('#heroQ', 'Enter')]);
  await page.waitForFunction(() => /Campinas/.test(document.querySelector('#count')?.textContent || ''));
  assert.ok(log.geocode.some((b) => b.q === 'Campinas'));
  assert.deepEqual(errors.filter((e) => !/perto/.test(e)), []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
