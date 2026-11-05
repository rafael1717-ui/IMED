// Testes das partes puras do mapa do topo (assets/js/hero3d.js): estilo 3D (claro e escuro), estilo da foto de
// satélite, contornos dos prédios, área dos ladrilhos e sombras longas; e a regra das páginas (CSP, créditos do mapa,
// biblioteca servida pelo próprio site, chave da Esri fora do repositório, privacidade).
// Rodar com: node --test tests/hero3d.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estilo, estiloSatelite, contornos, area, sombras, FONTE, FOTO_MAXZOOM } from '../assets/js/hero3d.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const PAULISTA = { lat: -23.565, lng: -46.652 };
const m = (o, dLat, dLng) => [o.lng + dLng, o.lat + dLat];

test('estilo: só ladrilhos do OpenFreeMap (sem fontes nem ícones de fora), prédios em 3D com a altura da camada', () => {
  for (const tema of ['claro', 'escuro']) {
    const s = estilo(tema, area(PAULISTA, 1000));
    assert.equal(s.version, 8);
    assert.equal(s.glyphs, undefined, `${tema}: sem fontes (letras) do OpenFreeMap`);
    assert.equal(s.sprite, undefined, `${tema}: sem ícones do OpenFreeMap`);
    assert.equal(s.sources.omt.url, FONTE);
    assert.equal(FONTE, 'https://tiles.openfreemap.org/planet');
    assert.equal(s.sources.omt.minzoom, 14, 'só os ladrilhos completos (z14), onde estão os prédios');
    assert.ok(Array.isArray(s.sources.omt.bounds), 'área limitada em volta do ponto');
    // Nenhum outro endereço de internet no estilo.
    const urls = JSON.stringify(s).match(/https?:\/\/[^"]+/g) || [];
    assert.deepEqual([...new Set(urls)], [FONTE], `${tema}: só o OpenFreeMap`);
    const ids = s.layers.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length, 'ids únicos');
    const predios = s.layers.find((l) => l.id === 'predios');
    assert.equal(predios.type, 'fill-extrusion');
    assert.equal(predios['source-layer'], 'building');
    assert.deepEqual(predios.filter, ['!', ['has', 'hide_3d']], 'partes escondidas do OpenMapTiles ficam de fora');
    assert.deepEqual(predios.paint['fill-extrusion-height'], ['coalesce', ['get', 'render_height'], 0], 'altura da camada (sem altura no OSM: a padrão da camada)');
    assert.deepEqual(predios.paint['fill-extrusion-base'], ['coalesce', ['get', 'render_min_height'], 0]);
    assert.equal(ids[ids.length - 1], 'predios', 'prédios por cima de tudo');
    assert.ok(ids.indexOf('sombras') < ids.indexOf('predios') && ids.indexOf('contato') < ids.indexOf('predios'), 'sombras no chão');
    assert.ok(s.light && s.light.anchor === 'map', 'luz presa ao mapa (o sol não gira com a câmera)');
    // Toda camada de ladrilho usa uma camada que existe no OpenMapTiles.
    const OMT = new Set(['building', 'transportation', 'water', 'waterway', 'park', 'landuse', 'landcover']);
    for (const l of s.layers.filter((x) => x.source === 'omt')) assert.ok(OMT.has(l['source-layer']), `${l.id}: ${l['source-layer']}`);
    // Nenhuma camada de letras (o mapa não baixa fontes).
    assert.ok(!s.layers.some((l) => l.type === 'symbol'));
  }
  assert.notDeepEqual(estilo('claro').layers.find((l) => l.id === 'terra').paint, estilo('escuro').layers.find((l) => l.id === 'terra').paint, 'claro e escuro diferentes');
});

test('área dos ladrilhos: quadrado de ~raio metros em volta do ponto', () => {
  const [w, s, e, n] = area(PAULISTA, 1000);
  assert.ok(Math.abs((n - s) / 2 * 110574 - 1000) < 5, 'altura');
  assert.ok(Math.abs((e - w) / 2 * 111320 * Math.cos(PAULISTA.lat * Math.PI / 180) - 1000) < 5, 'largura');
  assert.ok(w < PAULISTA.lng && e > PAULISTA.lng && s < PAULISTA.lat && n > PAULISTA.lat);
});

test('sombras longas: só prédios altos, do lado oposto ao sol, do tamanho da altura; as mais perto primeiro', () => {
  const lado = 20 / 110574; // ~20 m
  const quadrado = (o) => [[m(o, 0, 0), m(o, 0, lado), m(o, -lado, lado), m(o, -lado, 0), m(o, 0, 0)]];
  const f = (h, h0 = 0, extra = {}) => ({ properties: { render_height: h, render_min_height: h0, ...extra }, geometry: { type: 'Polygon', coordinates: quadrado(PAULISTA) } });
  const fc = sombras([f(40), f(5), f(30, 0, { hide_3d: true }), { properties: { render_height: 50 }, geometry: { type: 'Point', coordinates: [0, 0] } }], PAULISTA);
  assert.equal(fc.features.length, 1, 'baixo, escondido (hide_3d) e ponto ficam de fora');
  const g = fc.features[0].geometry;
  assert.equal(g.type, 'MultiPolygon');
  assert.equal(g.coordinates.length, 2, 'o fim da sombra e a faixa que liga o prédio a ele');
  for (const [anel] of g.coordinates) assert.deepEqual(anel[0], anel[anel.length - 1], 'anel fechado');
  // O ponto mais longe da sombra fica a ~altura × tan(polar) metros do prédio, do lado oposto ao sol (oeste-sudoeste).
  const kx = 111320 * Math.cos(PAULISTA.lat * Math.PI / 180), ky = 110574;
  const pts = g.coordinates.flatMap(([anel]) => anel);
  const dist = Math.max(...pts.map(([x, y]) => Math.hypot((x - PAULISTA.lng) * kx, (y - PAULISTA.lat) * ky)));
  assert.ok(dist > 40 && dist < 120, `comprimento da sombra (${dist.toFixed(0)} m)`);
  const longe = pts.reduce((a, b) => (Math.hypot((b[0] - PAULISTA.lng) * kx, (b[1] - PAULISTA.lat) * ky) > Math.hypot((a[0] - PAULISTA.lng) * kx, (a[1] - PAULISTA.lat) * ky) ? b : a));
  assert.ok(longe[0] > PAULISTA.lng, 'sombra para o leste (sol a oeste)');
  // Parte suspensa (render_min_height): a sombra começa longe do pé.
  const alta = sombras([f(60, 40)], PAULISTA).features[0].geometry.coordinates.flatMap(([anel]) => anel);
  const perto = Math.min(...alta.map(([x, y]) => Math.hypot((x - PAULISTA.lng) * kx, (y - PAULISTA.lat) * ky)));
  assert.ok(perto > 20, `sombra da parte suspensa longe do pé (${perto.toFixed(0)} m)`);
  // Limite: ficam as dos prédios mais perto do ponto.
  const muitos = Array.from({ length: 30 }, (_, i) => ({ properties: { render_height: 20 + i }, geometry: { type: 'Polygon', coordinates: quadrado({ lat: PAULISTA.lat + i * .001, lng: PAULISTA.lng }) } }));
  const poucos = sombras(muitos, PAULISTA, 5).features;
  assert.equal(poucos.length, 5);
  assert.ok(poucos.every((x) => x.geometry.coordinates.flatMap(([a]) => a).every(([, y]) => Math.abs(y - PAULISTA.lat) < .006)), 'os mais perto do ponto');
});

const ESRI = 'https://ibasemaps-api.arcgis.com';
// Lê o config.js como a página (window.IMED_CONFIG), sem mexer no arquivo.
function lerConfig(chave) {
  const w = {}; const fn = new Function('window', 'AbortSignal', 'AbortController', 'DOMException', read('assets/js/config.js'));
  fn(w, undefined, undefined, undefined);
  if (chave != null) w.IMED_CONFIG.satelite.chave = chave;
  return w.IMED_CONFIG;
}

test('estilo da foto de satélite: a foto da Esri embaixo, contornos e pontos em cima, sem extrusão, luz ou letras; só os dois endereços', () => {
  const foto = { url: `${ESRI}/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=abc`, attribution: 'Powered by Esri', maxZoom: 19 };
  const s = estiloSatelite(foto, area(PAULISTA, 400));
  assert.equal(s.version, 8);
  assert.equal(s.glyphs, undefined); assert.equal(s.sprite, undefined); assert.equal(s.light, undefined, 'sem luz (não é 3D)');
  assert.deepEqual(s.sources.foto, { type: 'raster', tiles: [foto.url], tileSize: 256, maxzoom: 19, attribution: 'Powered by Esri' });
  assert.equal(FOTO_MAXZOOM, 19);
  assert.equal(s.sources.omt.url, FONTE); assert.equal(s.sources.omt.minzoom, 14); assert.ok(Array.isArray(s.sources.omt.bounds), 'contornos só numa área pequena');
  const urls = [...new Set(JSON.stringify(s).match(/https?:\/\/[^"?]+/g))].sort();
  assert.deepEqual(urls, [`${ESRI}/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`, FONTE].sort(), 'só a Esri (foto) e o OpenFreeMap (contornos)');
  const ids = s.layers.map((l) => l.id);
  assert.deepEqual(ids, ['terra', 'foto', 'predios-base', 'contorno-sombra', 'contorno', 'eu-area', 'locais-chao']);
  assert.ok(!s.layers.some((l) => l.type === 'fill-extrusion' || l.type === 'symbol'), 'nada em 3D, nenhuma letra');
  assert.equal(s.layers.find((l) => l.id === 'foto').type, 'raster');
  const base = s.layers.find((l) => l.id === 'predios-base');
  assert.equal(base.paint['fill-opacity'], 0, 'a camada que baixa o ladrilho dos contornos é invisível');
  assert.equal(s.layers.find((l) => l.id === 'contorno').source, 'contornos');
  // Sem créditos no estilo quando a página não os passa.
  assert.equal(estiloSatelite({ url: foto.url }).sources.foto.attribution, undefined);
});

test('contornos: o polígono que contém o ponto do local (o maior quando há partes), sem buraco; fora de prédio, nada', () => {
  const q = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const f = (coords, type = 'Polygon') => ({ properties: {}, geometry: { type, coordinates: coords } });
  const parte = f([q(0, 0, 1, 1)]), inteiro = f([q(-1, -1, 2, 2)]);
  const comBuraco = f([q(10, 10, 20, 20), q(14, 14, 16, 16)]);
  const multi = f([[q(30, 30, 31, 31)], [q(40, 40, 41, 41)]], 'MultiPolygon');
  const fc = contornos([parte, inteiro, comBuraco, multi, { geometry: { type: 'Point', coordinates: [0.5, 0.5] } }], [
    { id: 'a', lat: .5, lng: .5, cor: '#111' }, { id: 'b', lat: 15, lng: 15 }, { id: 'c', lat: 12, lng: 12 }, { id: 'd', lat: 40.5, lng: 40.5 }, { id: 'e', lat: 99, lng: 99 },
  ]);
  assert.deepEqual(fc.features.map((x) => [x.properties.id, x.properties.cor]), [['a', '#111'], ['c', '#ffffff'], ['d', '#ffffff']]);
  assert.deepEqual(fc.features[0].geometry, { type: 'Polygon', coordinates: [q(-1, -1, 2, 2)] }, 'o contorno inteiro, não a parte');
  assert.deepEqual(fc.features[2].geometry.coordinates, [q(40, 40, 41, 41)]);
  assert.deepEqual(contornos([], [{ id: 'x', lat: 0, lng: 0 }]).features, []);
});

test('config.js: a chave da Esri NÃO está no repositório; endereço com {z}/{y}/{x} e {chave}; sem chave, nenhum endereço', () => {
  const cfg = lerConfig();
  assert.equal(cfg.satelite.chave, '', 'a chave é colada pelo dono no servidor/site, nunca comitada vazia... ou cheia');
  assert.equal(cfg.sateliteUrl(), '', 'sem chave: nada é pedido à Esri');
  assert.match(cfg.satelite.url, /^https:\/\/ibasemaps-api\.arcgis\.com\/arcgis\/rest\/services\/World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}\?token=\{chave\}$/);
  assert.equal(cfg.satelite.maxZoom, 19);
  assert.match(cfg.satelite.attribution, /Powered by <a href="https:\/\/www\.esri\.com\/" target="_blank" rel="noopener">Esri<\/a>/);
  assert.match(cfg.satelite.attribution, /Esri, Maxar, Earthstar Geographics, and the GIS User Community/);
  const com = lerConfig(' minha chave ');
  assert.equal(com.sateliteUrl(), `${ESRI}/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=minha%20chave`, 'chave no endereço, sem espaços das pontas');
  assert.equal(lerConfig('   ').sateliteUrl(), '', 'só espaços = sem chave');
});

test('páginas: CSP só com o host da Esri (img-src nos três mapas, connect-src no início), privacidade, service worker', () => {
  for (const f of ['index.html', 'local.html', 'perto.html']) {
    const csp = read(f).match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
    assert.match(csp, new RegExp(`img-src 'self' data: (blob: )?https://tile\\.openstreetmap\\.org ${ESRI.replace(/\./g, '\\.')};`), `${f}: img-src`);
    assert.ok(!/arcgis\.com[^;]*arcgis\.com/.test(csp.split('img-src')[1].split(';')[0]), `${f}: um host só`);
    assert.ok(!/arcgisonline|services\.arcgis|basemapstyles/.test(csp), `${f}: nenhum outro endereço da Esri`);
  }
  assert.match(read('index.html').match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1], new RegExp(`connect-src 'self' https://pyoqiecupxhdzigjudyd\\.supabase\\.co https://tiles\\.openfreemap\\.org ${ESRI.replace(/\./g, '\\.')};`), 'o MapLibre busca os pedaços da foto por fetch');
  for (const f of ['local.html', 'perto.html']) assert.ok(!/connect-src[^;]*arcgis/.test(read(f)), `${f}: o Leaflet usa <img>, não precisa de connect-src`);
  // Botões + e − e a dica da foto no início; o texto da dica muda por JS.
  const html = read('index.html');
  assert.match(html, /<div class="h3d-zoom" id="heroZoom" hidden><button type="button" data-zoom="in" aria-label="Aproximar a foto">/);
  assert.match(html, /<button type="button" data-zoom="out" aria-label="Afastar a foto">/);
  assert.match(html, /<div class="hero-hint">.*<span>Arraste para girar · clique num local<\/span><\/div>/);
  // Privacidade: a Esri entra entre os serviços fora do Brasil, só com a chave ligada.
  const priv = read('privacidade.html');
  assert.match(priv, /<li><b>Esri<\/b> \(ArcGIS Location Platform, Estados Unidos\), só quando a foto de satélite está ligada no site/);
  assert.match(priv, /Sem a chave, nada é pedido à Esri\./);
  // O módulo dos botões "Mapa | Satélite" entra no cache do site e não tem endereço próprio (vem tudo do config.js).
  const core = read('sw.js').match(/const CORE = \[([\s\S]*?)\];/)[1];
  assert.ok(core.includes("'./assets/js/mapa-fundo.js'"));
  assert.ok(!/https?:\/\//.test(read('assets/js/mapa-fundo.js')), 'mapa-fundo.js sem endereço de internet');
  for (const f of ['assets/js/inicio-perto.js', 'assets/js/local.js', 'assets/js/perto.js']) assert.match(read(f), /import \{ fundoDoMapa \} from '\.\/mapa-fundo\.js';/, f);
  assert.match(read('assets/css/tema.css'), /\.leaflet-satelite-pane\{filter:none\}/, 'a foto não leva o filtro escuro do tema');
});

test('página: CSP abre só o OpenFreeMap e a Esri no connect-src, biblioteca do próprio site, créditos do mapa', () => {
  const html = read('index.html');
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
  assert.match(csp, /script-src 'self';/, 'scripts só do próprio site');
  assert.ok(!/unsafe-eval/.test(csp), "sem 'unsafe-eval'");
  assert.match(csp, /connect-src 'self' https:\/\/pyoqiecupxhdzigjudyd\.supabase\.co https:\/\/tiles\.openfreemap\.org https:\/\/ibasemaps-api\.arcgis\.com;/);
  assert.ok(!/worker-src/.test(csp), "o trabalhador do mapa é do próprio site: vale o script-src 'self' (sem blob:)");
  // Créditos: OpenStreetMap (link da página de direitos), OpenMapTiles e OpenFreeMap.
  const cred = html.match(/<p class="h3d-attrib" id="heroAttrib" hidden>([\s\S]*?)<\/p>/)[1];
  assert.match(cred, /href="https:\/\/www\.openstreetmap\.org\/copyright"/);
  assert.match(cred, /OpenMapTiles/);
  assert.match(cred, /OpenFreeMap/);
  // A biblioteca está no repositório, na versão registrada, com a licença; o three.js saiu.
  for (const f of ['maplibre-gl.js', 'maplibre-gl-worker.js', 'LICENSE.txt', 'LEIA-ME.md']) assert.ok(existsSync(join(ROOT, 'assets/vendor/maplibre', f)), f);
  assert.match(read('assets/vendor/maplibre/LEIA-ME.md'), /# MapLibre GL JS 6\.16\.0/);
  assert.match(read('assets/vendor/maplibre/maplibre-gl.js').slice(0, 300), /MapLibre GL JS[\s\S]*v6\.16\.0/);
  assert.match(read('assets/js/hero3d.js'), /const MAPLIBRE = '6\.16\.0'/);
  assert.ok(!existsSync(join(ROOT, 'assets/vendor/three.module.min.js')), 'three.js removido');
  assert.ok(statSync(join(ROOT, 'assets/vendor/maplibre/maplibre-gl.js')).size < 1.3e6);
  // Fora do pré-cache do service worker (aparelho fraco não baixa).
  const core = read('sw.js').match(/const CORE = \[([\s\S]*?)\];/)[1];
  assert.ok(!/maplibre|hero3d/.test(core));
});
