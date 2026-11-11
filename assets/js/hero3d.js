// Mapa 3D do topo da página inicial: os prédios de verdade em volta do ponto escolhido (contorno e altura do
// OpenStreetMap, nos ladrilhos gratuitos e sem chave do OpenFreeMap), com luz do sol, sombras, versão clara e
// escura, e os estabelecimentos de saúde reais (os mesmos da lista do topo) com pino e rótulo.
// Biblioteca: MapLibre GL JS, servida pelo próprio site (assets/vendor/maplibre; versão e licença no LEIA-ME.md lá).
// Privacidade: o mapa parte do ponto que a página já usa (arredondado, ~110 m) e só pede ao OpenFreeMap os ladrilhos
// da área (cada um cobre ~2 km). Nada é gravado.
// Prédio sem altura no OpenStreetMap fica com a altura padrão da camada (OpenMapTiles), sem fingir precisão. As
// sombras são só desenho (luz de fim de tarde vinda do oeste-sudoeste), calculadas das alturas da própria camada.
//
// Contrato com inicio.js (api): clinics(), origin(), pronto(), modo(), highlighted(), meLabel(), meta(c), onPick(id),
// tema() ('claro' | 'escuro'), aoFicarPronto(), falhou(motivo). Devolve { setPaused, setOrigin, refreshLabels,
// setTema, destroy, info }.
import { Map as MapaGL, setWorkerUrl, addProtocol } from '../vendor/maplibre/maplibre-gl.js';

const MAPLIBRE = '6.16.0';
setWorkerUrl(new URL(`../vendor/maplibre/maplibre-gl-worker.js?v=${MAPLIBRE}`, import.meta.url).href);

export const FONTE = 'https://tiles.openfreemap.org/planet';
// Cada ladrilho é baixado uma vez só por página: o mapa às vezes pede o mesmo ladrilho duas vezes ao mesmo tempo (para
// níveis de detalhe diferentes) e o cache do navegador não junta os dois pedidos. Os ladrilhos passam por "ofm://"
// (transformRequest) e este atalho guarda a resposta; a próxima visita usa o cache do navegador (10 anos).
const LADRILHOS = new Map();
addProtocol('ofm', async ({ url }) => {
  const https = url.replace(/^ofm:/, 'https:');
  let pedido = LADRILHOS.get(https);
  if (!pedido) {
    pedido = fetch(https).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status} ${https}`); return r.arrayBuffer(); });
    LADRILHOS.set(https, pedido);
    if (LADRILHOS.size > 12) LADRILHOS.delete(LADRILHOS.keys().next().value); // guarda só os mais recentes
    pedido.catch(() => LADRILHOS.delete(https)); // falhou: a próxima tentativa pede de novo
  }
  return { data: (await pedido).slice(0) };
});
const pelaPonte = (url, tipo) => (tipo === 'Tile' && url.startsWith('https://tiles.openfreemap.org/') ? { url: `ofm${url.slice(5)}` } : undefined);
const RAD = Math.PI / 180;
const VAZIO = { type: 'FeatureCollection', features: [] };
// Sol de fim de tarde vindo do oeste-sudoeste (ângulos da luz do MapLibre: azimute a partir do norte; polar a partir do
// alto), de lado para a câmera do começo: fachadas iluminadas e sombras à vista. As sombras apontam para o lado
// oposto, com comprimento = altura × tan(polar).
const SOL = { az: 245, polar: 55 };
const ALTURA_SOMBRA = 9;      // m: prédios mais baixos ficam só com a sombra de contato
const MAX_SOMBRAS = 6000;     // contornos com sombra longa, no máximo (os mais perto do ponto)
const ESPERA_MS = 15000;      // sem nenhum ladrilho nesse tempo: volta para a versão leve
const MPP0 = 40075016.686 / 512; // metros por pixel no zoom 0, no equador (ladrilhos de 512 px)

// Cores. claro: dia; escuro: noite (combina com o fundo azul-marinho do topo).
const TEMAS = {
  claro: {
    terra: '#e8e6e1', urbano: '#e3e1db', verde: '#c8dcb8', mata: '#b5cfa2', areia: '#ebe2c9', agua: '#a3c9de', rio: '#94bfd6',
    via: '#ffffff', viaBorda: '#cdc9c0', media: '#fffdf7', mediaBorda: '#c9c1ad', maior: '#fff6df', maiorBorda: '#c7b088',
    caminho: '#d7d3ca', trilho: '#aca69b',
    predio: ['#f4efe6', '#ecebe7', '#d9e2ea'],
    luz: { color: '#fff7ec', intensity: .42 },
    sombra: '#28333a', sombraOp: .2, contato: '#1b2125', contatoOp: .28,
  },
  escuro: {
    terra: '#0d1e27', urbano: '#10232d', verde: '#123029', mata: '#0f2c25', areia: '#1d2a2b', agua: '#0a2c42', rio: '#0d3550',
    via: '#203f4d', viaBorda: '#08161d', media: '#4b4a39', mediaBorda: '#08161d', maior: '#76623a', maiorBorda: '#0a1418',
    caminho: '#18323d', trilho: '#2b4552',
    predio: ['#1e3947', '#25485a', '#326078'],
    luz: { color: '#d8e9ff', intensity: .5 },
    sombra: '#000000', sombraOp: .3, contato: '#000000', contatoOp: .5,
  },
};

const outCubic = (t) => 1 - Math.pow(1 - t, 3);
const mpp = (z, lat) => (MPP0 * Math.cos(lat * RAD)) / Math.pow(2, z);
const linha = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const naoTunel = ['!=', ['coalesce', ['get', 'brunnel'], ''], 'tunnel'];
const classe = (lista) => ['match', ['get', 'class'], lista, true, false];
const largura = (a, b) => ['interpolate', ['exponential', 1.6], ['zoom'], 14, a, 17, b];

// Cor do prédio: pela altura (os mais altos puxam para o vidro).
const corPredio = (P) => ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 0], 0, P.predio[0], 28, P.predio[1], 100, P.predio[2]];

// Área dos ladrilhos baixados: um quadrado de ~raio metros em volta do ponto (cada ladrilho cobre ~2 km; com isso
// vêm de 1 a 4). O resto do quadro é chão liso, que some no alto do topo.
export function area(o, raio) {
  const dLat = raio / 110574, dLng = raio / (111320 * Math.cos(o.lat * RAD));
  return [o.lng - dLng, o.lat - dLat, o.lng + dLng, o.lat + dLat].map((v) => Math.round(v * 1e5) / 1e5);
}

// Estilo do mapa (só camadas sem letras: não baixa fontes nem ícones do OpenFreeMap).
export function estilo(tema, limites) {
  const P = TEMAS[tema] || TEMAS.claro;
  const via = (id, classes, cor, borda, a, b) => [
    { id: `${id}-borda`, type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', linha, naoTunel, classe(classes)],
      layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': borda, 'line-width': largura(a + 1, b + 2.5) } },
    { id, type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', linha, naoTunel, classe(classes)],
      layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': cor, 'line-width': largura(a, b) } },
  ];
  const vias = [
    via('via', ['minor', 'service', 'track', 'raceway', 'busway', 'living_street'], P.via, P.viaBorda, .9, 9),
    via('via-media', ['secondary', 'tertiary'], P.media, P.mediaBorda, 1.6, 14),
    via('via-maior', ['motorway', 'trunk', 'primary'], P.maior, P.maiorBorda, 2.2, 19),
  ];
  return {
    version: 8,
    sources: {
      // minzoom 14: só os ladrilhos completos (onde estão os prédios); o que fica longe demais não é baixado.
      omt: { type: 'vector', url: FONTE, minzoom: 14, maxzoom: 14, ...(limites ? { bounds: limites } : {}) },
      sombras: { type: 'geojson', data: VAZIO, tolerance: .3 },
      eu: { type: 'geojson', data: VAZIO },
      locais: { type: 'geojson', data: VAZIO },
    },
    light: { anchor: 'map', position: [1.15, SOL.az, SOL.polar], color: P.luz.color, intensity: P.luz.intensity },
    layers: [
      { id: 'terra', type: 'background', paint: { 'background-color': P.terra } },
      { id: 'urbano', type: 'fill', source: 'omt', 'source-layer': 'landuse',
        filter: classe(['residential', 'commercial', 'industrial', 'retail', 'railway', 'school', 'university', 'college', 'hospital', 'military', 'garages', 'quarter', 'neighbourhood', 'suburb']),
        paint: { 'fill-color': P.urbano } },
      { id: 'verde', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': P.verde } },
      { id: 'verde-uso', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: classe(['cemetery', 'pitch', 'playground', 'stadium', 'zoo', 'theme_park']), paint: { 'fill-color': P.verde } },
      { id: 'cobertura', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: classe(['grass', 'wood', 'forest', 'farmland', 'sand', 'wetland']),
        paint: { 'fill-color': ['match', ['get', 'class'], ['wood', 'forest'], P.mata, 'sand', P.areia, P.verde] } },
      { id: 'agua', type: 'fill', source: 'omt', 'source-layer': 'water', filter: naoTunel, paint: { 'fill-color': P.agua } },
      { id: 'rio', type: 'line', source: 'omt', 'source-layer': 'waterway', filter: ['all', naoTunel, classe(['river', 'canal', 'stream'])],
        paint: { 'line-color': P.rio, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 17, 5] } },
      { id: 'caminho', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', linha, naoTunel, classe(['path', 'pedestrian'])],
        paint: { 'line-color': P.caminho, 'line-width': largura(.5, 3) } },
      { id: 'trilho', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', linha, naoTunel, classe(['rail', 'transit'])],
        paint: { 'line-color': P.trilho, 'line-width': largura(.8, 3) } },
      ...vias.map((v) => v[0]), ...vias.map((v) => v[1]), // bordas embaixo de todas as vias
      // Sombra longa dos prédios mais altos (polígonos calculados aqui, uma camada só: não escurece duas vezes).
      { id: 'sombras', type: 'fill', source: 'sombras', paint: { 'fill-color': P.sombra, 'fill-antialias': false, 'fill-layer-opacity': P.sombraOp } },
      // Sombra de contato: um contorno borrado em volta da base de cada prédio.
      { id: 'contato', type: 'line', source: 'omt', 'source-layer': 'building', filter: ['!', ['has', 'hide_3d']],
        paint: { 'line-color': P.contato, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 17, 9], 'line-blur': ['interpolate', ['linear'], ['zoom'], 14, 2, 17, 9], 'line-layer-opacity': P.contatoOp } },
      // Região aproximada da pessoa (~110 m, o arredondamento da posição) e o ponto de cada local no chão.
      { id: 'eu-area', type: 'circle', source: 'eu', paint: { 'circle-color': '#ff6b4a', 'circle-opacity': .14, 'circle-stroke-color': '#ff6b4a', 'circle-stroke-opacity': .55, 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'map', 'circle-radius': 0 } },
      { id: 'locais-chao', type: 'circle', source: 'locais', paint: { 'circle-color': ['get', 'cor'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3.5, 17, 7], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2, 'circle-pitch-alignment': 'map' } },
      { id: 'predios', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', filter: ['!', ['has', 'hide_3d']],
        paint: {
          'fill-extrusion-color': corPredio(P),
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': true,
        } },
    ],
  };
}

// Pinta as camadas com as cores do tema (sem recarregar os ladrilhos).
function pintar(map, tema) {
  const novo = estilo(tema);
  for (const camada of novo.layers) {
    for (const [k, v] of Object.entries(camada.paint || {})) {
      if (camada.id === 'eu-area' && k === 'circle-radius') continue;
      map.setPaintProperty(camada.id, k, v);
    }
  }
  map.setLight(novo.light);
}

// Sombra longa de cada prédio alto, no chão: o contorno levado na direção da sombra (o "fim" da sombra) e a faixa que
// liga o prédio a ele, entre os dois pontos do contorno mais afastados para os lados. Exato para contornos convexos
// (a maioria); nos outros, quase. Só desenho, a partir das alturas da camada. Tudo numa camada só, com opacidade da
// camada inteira: onde as sombras se cruzam, não escurece duas vezes.
// Em passos (um por feição): a página calcula aos pedaços, com o navegador livre, sem travar a rolagem.
export function* sombrasEmPassos(features, o, max = MAX_SOMBRAS) {
  const t = Math.tan(SOL.polar * RAD), dir = (SOL.az + 180) * RAD;
  const kx = 111320 * Math.cos(o.lat * RAD), ky = 110574;
  const ux = (Math.sin(dir) * t) / kx; // graus de longitude por metro de altura
  const uy = (Math.cos(dir) * t) / ky; // graus de latitude por metro de altura
  const cand = [];
  for (const f of features) {
    const p = f.properties || {};
    const h = Number(p.render_height) || 0, h0 = Number(p.render_min_height) || 0;
    if (p.hide_3d || h < ALTURA_SOMBRA || h <= h0) continue;
    const g = f.geometry || {};
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const anel = poly && poly[0];
      if (!anel || anel.length < 4) continue;
      const dx = (anel[0][0] - o.lng) * kx, dy = (anel[0][1] - o.lat) * ky;
      cand.push({ anel, h, h0, d: dx * dx + dy * dy });
    }
    yield;
  }
  // Os mais perto do ponto primeiro (se passar do limite, ficam de fora os mais longe, que somem no alto do quadro).
  if (cand.length > max) cand.sort((a, b) => a.d - b.d).length = max;
  const out = cand.map(({ anel, h, h0 }) => {
    const ax = ux * h0, ay = uy * h0, bx = ux * h, by = uy * h;
    let iMin = 0, iMax = 0, pMin = Infinity, pMax = -Infinity;
    const fim = anel.map(([x, y], i) => {
      const q = x * uy - y * ux; // posição de lado, em relação à direção da sombra
      if (q < pMin) { pMin = q; iMin = i; }
      if (q > pMax) { pMax = q; iMax = i; }
      return [x + bx, y + by];
    });
    const [x1, y1] = anel[iMin], [x2, y2] = anel[iMax];
    const faixa = [[x1 + ax, y1 + ay], [x2 + ax, y2 + ay], [x2 + bx, y2 + by], [x1 + bx, y1 + by], [x1 + ax, y1 + ay]];
    const partes = [[fim], [faixa]];
    if (h0 > 0) partes.push([anel.map(([x, y]) => [x + ax, y + ay])]); // parte suspensa: o começo da sombra também
    return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: partes } };
  });
  return { type: 'FeatureCollection', features: out };
}
export function sombras(features, o, max = MAX_SOMBRAS) {
  const passos = sombrasEmPassos(features, o, max);
  let r = passos.next();
  while (!r.done) r = passos.next();
  return r.value;
}

// Círculo de ~110 m (o arredondamento da posição) desenhado no chão, em pixels por zoom.
const raioEu = (lat) => ['interpolate', ['exponential', 2], ['zoom'], 10, 110 / mpp(10, lat), 20, 110 / mpp(20, lat)];

export function initHero3D(el, api) {
  const labelsEl = el.querySelector('.h3d-labels');
  const fino = matchMedia('(pointer: fine)').matches;
  let W = el.clientWidth, H = el.clientHeight;
  const pequeno = () => Math.min(screen.width, screen.height) < 700 || W < 700;
  const largo = () => W >= 980;

  // Peças na tela: o mapa (atrás), o ponto da pessoa, os pinos e os rótulos (em .h3d-labels). Os créditos do mapa
  // (#heroAttrib, no index.html) aparecem junto com ele.
  const mapaEl = document.createElement('div');
  mapaEl.className = 'h3d-map';
  mapaEl.setAttribute('aria-hidden', 'true');
  el.prepend(mapaEl);
  const eu = document.createElement('div'); eu.className = 'h3d-eu'; eu.setAttribute('aria-hidden', 'true');
  const meLabel = document.createElement('div'); meLabel.className = 'h3d-me';
  labelsEl.append(eu, meLabel);
  const creditos = document.getElementById('heroAttrib') || document.createElement('p');

  let map = null, tema = api.tema(), pronto = false, falhou = false, pausado = false, visivel = true, destruido = false;
  let origem = null, rumo = -28, raf = 0, ultimo = 0, quadro = 0, arrasto = null, foiArrasto = false, hoverId = null;
  let locais = [], ladrilhos = 0, sombrasSujas = true, timerEspera = 0, timerSombras = 0, nSombras = 0, msSombras = 0, msSombrasTotal = 0;

  const meText = () => (typeof api.meLabel === 'function' && api.meLabel()) || 'Você está aqui';

  // Enquadramento: no computador o ponto fica à direita do texto do topo; no celular, no meio do quadro do mapa.
  function margens() {
    if (largo()) return { top: Math.round(H * .16), bottom: Math.round(H * .1), left: Math.round(W * .42), right: 32 };
    return { top: Math.round(H * .2), bottom: 64, left: 12, right: 12 };
  }
  // Zoom fixo, perto o bastante para os prédios aparecerem bem (o giro mostra os locais em volta). Fica dentro do
  // mesmo nível inteiro (15): o mapa não precisa ler os mesmos ladrilhos de novo para outro nível de detalhe.
  const zoomIdeal = () => (largo() ? 15.9 : 15.45);
  const inclinacao = () => (largo() ? 60 : 57);
  // Raio (m) da área dos ladrilhos: o que aparece na tela girando em volta do ponto, sem baixar a cidade inteira.
  const raioLadrilhos = () => (largo() ? 1100 : 750);

  function criar() {
    if (map || destruido) return;
    origem = api.origin();
    try {
      map = new MapaGL({
        container: mapaEl, style: estilo(tema, area(origem, raioLadrilhos())), center: [origem.lng, origem.lat], zoom: zoomIdeal(),
        pitch: 36, bearing: rumo - 40, maxPitch: 65,
        // Cada ladrilho z14 inteiro (sem fatiar em pedaços de z15 a z18): um pedido e uma leitura por ladrilho.
        zoomLevelsToOverscale: undefined,
        interactive: false, attributionControl: false, maplibreLogo: false, renderWorldCopies: false,
        pixelRatio: Math.min(devicePixelRatio || 1, pequeno() ? 1.5 : 1.75),
        canvasContextAttributes: { antialias: true, powerPreference: 'high-performance' },
        fadeDuration: 0, refreshExpiredTiles: false, cancelPendingTileRequestsWhileZooming: true,
        transformRequest: pelaPonte,
      });
    } catch (e) {
      falhar('webgl', e);
      return;
    }
    map.setPadding(margens());
    const canvas = map.getCanvas();
    canvas.classList.add('h3d-canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.removeAttribute('role'); canvas.removeAttribute('aria-label');
    canvas.tabIndex = -1;
    // Erro do mapa: sem a lista de ladrilhos (TileJSON), volta para a versão leve na hora; sem nenhum ladrilho até o
    // fim da carga, também. Um ladrilho que falha sozinho não derruba nada.
    map.on('error', (e) => {
      if (!pronto && e?.sourceId === 'omt' && !e.tile) falhar('mapa', e.error);
    });
    map.on('sourcedata', (e) => { if (e.sourceId === 'omt' && e.tile) { ladrilhos += 1; sombrasSujas = true; } });
    map.on('load', () => { if (ladrilhos) ficarPronto(); else if (!falhou) setTimeout(() => (ladrilhos ? ficarPronto() : falhar('mapa')), 600); });
    map.on('render', posicionar);
    map.on('idle', () => { if (pronto && sombrasSujas) agendarSombras(); });
    timerEspera = setTimeout(() => { if (!pronto) (ladrilhos ? ficarPronto() : falhar('mapa')); }, ESPERA_MS);
    atualizarDados();
  }

  function falhar(motivo, erro) {
    if (falhou || destruido) return;
    falhou = true;
    if (erro) console.warn('Mapa 3D indisponível:', motivo, erro?.message || erro);
    destruir();
    api.falhou?.(motivo);
  }

  function ficarPronto() {
    if (pronto || falhou || destruido) return;
    pronto = true;
    clearTimeout(timerEspera);
    el.classList.add('h3d-ready');
    creditos.hidden = false;
    // Entrada: a câmera se inclina e gira até o ângulo final, depois o mapa gira devagar sozinho.
    map.easeTo({ pitch: inclinacao(), bearing: rumo, padding: margens(), duration: 2600, easing: outCubic });
    map.once('moveend', () => { ultimo = performance.now(); girar(); });
    api.aoFicarPronto?.();
    lim = null;
    agendarSombras();
  }

  // Locais e ponto de partida (chamado de novo quando a origem ou a lista mudam).
  function atualizarDados() {
    if (!map) return;
    const o = api.origin();
    const mudou = !origem || Math.abs(o.lat - origem.lat) > 1e-6 || Math.abs(o.lng - origem.lng) > 1e-6;
    origem = o;
    meLabel.textContent = meText();
    meW = 0;
    construirLocais();
    const doLocal = (c) => ({ type: 'Feature', properties: { cor: c.c }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } });
    const pontoEu = { type: 'FeatureCollection', features: api.modo?.() === 'perto' ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [o.lng, o.lat] } }] : [] };
    const aplicar = () => {
      setData('locais', { type: 'FeatureCollection', features: locais.map((x) => doLocal(x.c)) });
      setData('eu', pontoEu);
      try { map.setPaintProperty('eu-area', 'circle-radius', raioEu(o.lat)); } catch { /* estilo carregando */ }
    };
    if (mudou && map.getSource('omt')) {
      // Outra cidade: troca a área dos ladrilhos e pula para lá (sem voar por cima de tudo, o que baixaria ladrilhos
      // à toa); as sombras longas são refeitas com os ladrilhos novos.
      sombrasSujas = true;
      nSombras = 0;
      map.setStyle(estilo(tema, area(o, raioLadrilhos())), { diff: true });
      map.jumpTo({ center: [o.lng, o.lat], zoom: pronto ? zoomIdeal() : map.getZoom(), padding: margens() });
    }
    if (map.getSource('locais')) aplicar(); else map.once('style.load', aplicar);
    posicionar();
  }
  const setData = (id, d) => { try { map?.getSource(id)?.setData(d); } catch { /* estilo ainda carregando */ } };

  // Pinos (desenho) e rótulos (botões): recriados quando a lista muda.
  let meW = 0, meH = 0;
  function construirLocais() {
    locais.forEach((o) => { o.pin.remove(); o.label.remove(); });
    locais = api.clinics().map((c) => {
      const pin = document.createElement('div');
      pin.className = 'h3d-pin';
      pin.setAttribute('aria-hidden', 'true');
      pin.style.setProperty('--c', c.c);
      const cab = document.createElement('i'); const ini = document.createElement('b'); ini.textContent = c.ini;
      pin.append(cab, ini);
      pin.addEventListener('click', () => api.onPick(c.id));
      pin.addEventListener('pointerenter', () => { hoverId = c.id; posicionar(); });
      pin.addEventListener('pointerleave', () => { if (hoverId === c.id) hoverId = null; posicionar(); });
      const label = document.createElement('button');
      label.className = 'h3d-label'; label.type = 'button';
      // escondido até aparecer na tela: fora do Tab e dos leitores de tela
      label.tabIndex = -1; label.setAttribute('aria-hidden', 'true');
      // nomes vêm do cadastro oficial: monta o rótulo com textContent, nunca como HTML
      // As iniciais são só desenho (vêm do CSS, ::before): o nome lido pelo leitor de tela é o do local.
      const lg = document.createElement('span'); lg.className = 'lg'; lg.style.background = c.c; lg.dataset.ini = c.ini; lg.setAttribute('aria-hidden', 'true');
      const tx = document.createElement('span'); tx.className = 'tx';
      const nb = document.createElement('b'); nb.textContent = c.n;
      const sm = document.createElement('small'); sm.textContent = api.meta(c);
      // Espaço entre o nome e o tipo: o texto visível ("Nome Tipo · distância") fica igual ao nome lido pelo leitor
      // de tela (regra label-content-name-mismatch do axe).
      tx.append(nb, ' ', sm); label.append(lg, tx);
      label.setAttribute('aria-label', `${c.n}, ${api.meta(c)}`);
      label.addEventListener('click', () => api.onPick(c.id));
      labelsEl.append(pin, label);
      return { id: c.id, c, pin, label, sx: 0, sy: 0, lw: 0, lh: 0, vis: false };
    });
  }

  // Limites dos pinos e rótulos (relativos ao mapa), medidos de novo quando a tela muda: o fim do texto do topo no
  // computador, o pé do mapa (a parte branca da página sobe por cima) e os botões e créditos sobre o mapa.
  let lim = null;
  function medirLimites() {
    const r = el.getBoundingClientRect();
    const rel = (b) => ({ l: b.left - r.left, r: b.right - r.left, t: b.top - r.top, b: b.bottom - r.top });
    const caixas = ['#heroPause', '#heroAttrib', '.hero-hint'].map((q) => document.querySelector(q))
      .filter((x) => x && !x.hidden && x.getClientRects().length).map((x) => rel(x.getBoundingClientRect()));
    let minX = 40;
    if (largo()) {
      const txt = document.querySelector('.hero-in');
      minX = txt ? Math.max(W * .4, Math.min(W * .6, rel(txt.getBoundingClientRect()).r + 16)) : W * .46;
    }
    lim = { minX, maxY: largo() ? H - 24 : H - 58, caixas };
  }

  // Rótulos: no celular no máximo 2, no computador 4. Os candidatos são os locais mais perto do ponto
  // (a lista vem em ordem de distância); se um cobre outro ou o "Você está aqui", vale o seguinte.
  const maxLabels = () => (W < 700 ? 2 : 4);
  const maxCands = () => (W < 700 ? 5 : 6);
  const GAP = 8, PIN = 44;
  const overlaps = (a, b) => a.l < b.r + GAP && b.l < a.r + GAP && a.t < b.b + GAP && b.t < a.b + GAP;
  const overlaps0 = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  function posicionar() {
    if (!map || !origem) return;
    if (!lim) medirLimites();
    const pe = map.project([origem.lng, origem.lat]);
    // O alto do quadro some no fundo do topo (máscara do .h3d-map): pinos e rótulos só abaixo dessa faixa.
    const topo = H * .2;
    const naFaixa = (p, m = 0) => p.x > m && p.x < W - m && p.y > topo && p.y < lim.maxY;
    const meOn = pronto && naFaixa(pe, 6);
    eu.style.transform = `translate3d(${pe.x.toFixed(1)}px,${pe.y.toFixed(1)}px,0)`;
    eu.classList.toggle('on', meOn);
    // "Você está aqui" embaixo do ponto: o espaço de cima fica para os pinos e rótulos dos locais (os mais perto
    // costumam estar a poucos metros).
    meLabel.style.transform = `translate3d(${pe.x.toFixed(1)}px,${(pe.y + 15).toFixed(1)}px,0) translateX(-50%)`;
    meLabel.classList.toggle('on', meOn);
    if (!meW) { meW = meLabel.offsetWidth || 110; meH = meLabel.offsetHeight || 26; }
    const meBox = meOn ? { l: pe.x - meW / 2, r: pe.x + meW / 2, t: pe.y + 15, b: pe.y + 15 + meH } : null;
    const meDot = meOn ? { l: pe.x - 13, r: pe.x + 13, t: pe.y - 13, b: pe.y + 13 } : null;
    // No computador, o lado esquerdo é do texto do topo: pinos e rótulos só à direita dele.
    const minX = lim.minX;
    const hl = api.highlighted(), cands = maxCands();
    const shown = [];
    locais.forEach((o, i) => {
      const p = map.project([o.c.lng, o.c.lat]);
      o.sx = p.x; o.sy = p.y;
      const naTela = pronto && naFaixa(p, 4) && p.x > minX - 10 && !lim.caixas.some((c) => overlaps0(c, { l: p.x - 15, r: p.x + 15, t: p.y - 36, b: p.y }));
      o.pin.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
      o.pin.classList.toggle('on', naTela);
      o.pin.classList.toggle('hot', hoverId === o.id || hl === o.id);
      o.forced = hoverId === o.id || hl === o.id;
      if (!naTela || (!o.forced && (i >= cands || o.c.open === false))) return;
      if (!(o.sx > minX && o.sx < W - 40)) return;
      if (!o.lw) { o.lw = o.label.offsetWidth || 180; o.lh = o.label.offsetHeight || 48; }
      if (o.sy - PIN - o.lh < 4) return; // o rótulo inteiro precisa caber acima do pino (pode subir na faixa do alto)
      // Rótulo inteiro dentro da tela e fora do texto do topo: empurra para dentro (a seta continua apontando o pino).
      // Lugares possíveis: centrado no pino ou deslocado para um lado (a seta sempre dentro do rótulo); o que já
      // estava em uso vem primeiro (o rótulo não fica pulando enquanto o mapa gira).
      const half = Math.min(o.lw, W - 12) / 2, folga = half - 18;
      const cabe = (cx) => Math.min(Math.max(cx, half + 6, minX + half), W - half - 6);
      const lugares = [0, -(folga - 4), folga - 4].map((d) => cabe(o.sx + d)).filter((cx, k, a) => Math.abs(cx - o.sx) <= folga && a.indexOf(cx) === k);
      if (!lugares.length) return; // a seta sairia do rótulo
      if (o.vis && Number.isFinite(o.dx)) lugares.sort((a, b) => Math.abs(a - o.sx - o.dx) - Math.abs(b - o.sx - o.dx));
      o.lugares = lugares.map((cx) => ({ cx, box: { l: cx - half, r: cx + half, t: o.sy - PIN - o.lh, b: o.sy - PIN + 8 } }));
      // Ordem: o que a pessoa aponta ou abriu, o que já estava na tela (não fica piscando) e o mais perto.
      o.rank = (hoverId === o.id ? 0 : hl === o.id ? 1 : o.vis ? 2 : 3) * 1000 + i;
      shown.push(o);
    });
    shown.sort((a, b) => a.rank - b.rank);
    const kept = [], max = maxLabels();
    const cabeca = (o) => ({ l: o.sx - 15, r: o.sx + 15, t: o.sy - 36, b: o.sy });
    shown.forEach((o) => {
      if (kept.length >= max) return;
      if (!o.forced && meOn && (overlaps0(meBox, cabeca(o)) || overlaps0(meDot, cabeca(o)))) return;
      const livre = o.lugares.find(({ box }) => !kept.some((k) => overlaps(k.box, box) || overlaps0(k.box, cabeca(o)) || overlaps0(box, cabeca(k)))
        && !lim.caixas.some((c) => overlaps(c, box)) && !(meOn && !o.forced && (overlaps(meBox, box) || overlaps0(meDot, box))));
      if (!livre) return;
      o.cx = livre.cx; o.box = livre.box; o.dx = livre.cx - o.sx;
      kept.push(o);
    });
    // Pinos sem bagunça (muitos locais ficam a poucos metros uns dos outros): fica à vista o pino de cada rótulo e,
    // dos outros, o mais perto do ponto; some o pino que cairia em cima de um rótulo, do "Você está aqui" ou de um
    // pino que já ficou (encostar um pouco pode).
    const estreita = (b, m) => ({ l: b.l + m, r: b.r - m, t: b.t + m, b: b.b - m });
    const ocupados = [...kept.map((k) => estreita(cabeca(k), 4))];
    if (meOn) ocupados.push(meBox, meDot);
    locais.forEach((o) => {
      if (kept.includes(o) || !o.pin.classList.contains('on')) { o.pin.classList.remove('sob'); return; }
      const c = estreita(cabeca(o), 4);
      const sob = !o.forced && (kept.some((k) => overlaps0(k.box, cabeca(o))) || ocupados.some((b) => overlaps0(b, c)));
      o.pin.classList.toggle('sob', sob);
      if (!sob) ocupados.push(c);
    });
    locais.forEach((o) => {
      const vis = kept.includes(o);
      const cx = vis ? o.cx : o.sx;
      o.label.style.setProperty('--ax', `${(o.sx - cx).toFixed(1)}px`);
      o.label.style.transform = `translate3d(${cx.toFixed(1)}px,${o.sy.toFixed(1)}px,0) translate(-50%,calc(-100% - ${PIN}px))`;
      o.label.classList.toggle('on', vis);
      o.label.classList.toggle('hot', hoverId === o.id);
      if (o.vis !== vis) {
        o.vis = vis;
        o.label.tabIndex = vis ? 0 : -1;
        if (vis) o.label.removeAttribute('aria-hidden'); else o.label.setAttribute('aria-hidden', 'true');
      }
    });
  }

  // Giro lento (desliga com "Pausar animação" e fora da tela). No celular, 30 quadros por segundo bastam.
  const VEL = 1.6; // graus por segundo
  // Com o foco do teclado num rótulo, o mapa espera: girando, o rótulo podia sumir debaixo do foco (ele some quando o
  // pino sai do quadro ou outro rótulo passa na frente). Volta a girar quando o foco sai dos rótulos.
  const focoNoRotulo = () => { const a = document.activeElement; return !!a && labelsEl.contains(a) && a.matches('.h3d-label:focus-visible'); };
  const rodando = () => !!map && pronto && !pausado && visivel && !document.hidden && !destruido && !focoNoRotulo();
  function girar() {
    if (raf || !rodando()) return;
    raf = requestAnimationFrame(passo);
  }
  // (o foco novo só aparece em document.activeElement depois do "focusout": confere no instante seguinte)
  labelsEl.addEventListener('focusout', () => setTimeout(() => { if (!destruido) { ultimo = performance.now(); girar(); } }, 0));
  function passo(agora) {
    raf = 0;
    if (!rodando()) return;
    const dt = Math.min(.25, Math.max(0, (agora - ultimo) / 1000));
    quadro += 1;
    if (!(pequeno() && quadro % 2) && !arrasto && !map.isMoving()) {
      ultimo = agora;
      rumo = (rumo + VEL * dt) % 360;
      map.setBearing(rumo);
    } else if (arrasto || map.isMoving()) ultimo = agora;
    raf = requestAnimationFrame(passo);
  }

  // Sombras longas: calculadas aos pedaços, com o navegador livre, depois que os ladrilhos chegam.
  const quandoLivre = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300));
  function agendarSombras() {
    if (!map || !pronto || timerSombras) return;
    timerSombras = quandoLivre(() => {
      if (!map || destruido) { timerSombras = 0; return; }
      sombrasSujas = false;
      const t0 = performance.now();
      let passos;
      try {
        const fs = map.querySourceFeatures('omt', { sourceLayer: 'building', filter: ['>=', ['coalesce', ['get', 'render_height'], 0], ALTURA_SOMBRA], validate: false });
        passos = sombrasEmPassos(fs, origem, pequeno() ? 2500 : MAX_SOMBRAS);
      } catch { timerSombras = 0; return; } // sem sombras longas: o mapa segue igual
      // Pedaços de ~8 ms entre um quadro e outro (o giro do mapa continua liso).
      let gasto = 0;
      const pedaco = () => {
        if (!map || destruido) { timerSombras = 0; return; }
        const ini = performance.now(), ate = ini + 8;
        let r = passos.next();
        while (!r.done && performance.now() < ate) r = passos.next();
        gasto += performance.now() - ini;
        if (!r.done) { timerSombras = setTimeout(pedaco, 0); return; }
        timerSombras = 0;
        nSombras = r.value.features.length;
        msSombras = Math.round(gasto);
        msSombrasTotal = Math.round(performance.now() - t0);
        setData('sombras', r.value);
      };
      pedaco();
    });
  }

  // Arrastar com o mouse gira o mapa; clicar perto de um pino abre o local. No toque, a página rola normalmente.
  const pertoDe = (cx, cy, raio) => {
    const r = el.getBoundingClientRect(); const x = cx - r.left, y = cy - r.top;
    let best = null, bd = raio;
    locais.forEach((o) => { if (!o.pin.classList.contains('on')) return; const d = Math.hypot(o.sx - x, o.sy - 20 - y); if (d < bd) { bd = d; best = o; } });
    return best;
  };
  const alvoProprio = (e) => e.target.closest('.h3d-label,.h3d-pin,a,button,input');
  el.addEventListener('pointerdown', (e) => {
    if (!pronto || e.pointerType !== 'mouse' || e.button !== 0 || alvoProprio(e)) return;
    arrasto = { x: e.clientX, moved: 0 };
    try { el.setPointerCapture(e.pointerId); } catch { /* ignora */ }
  });
  el.addEventListener('pointermove', (e) => {
    if (arrasto) {
      const dx = e.clientX - arrasto.x; arrasto.x = e.clientX; arrasto.moved += Math.abs(dx);
      rumo = (rumo - dx * .3) % 360; map.setBearing(rumo);
      return;
    }
    if (!fino || !pronto || alvoProprio(e)) return;
    const o = pertoDe(e.clientX, e.clientY, 26);
    const id = o ? o.id : null;
    if (id !== hoverId) { hoverId = id; posicionar(); }
    el.style.cursor = id ? 'pointer' : 'grab';
  });
  el.addEventListener('pointerleave', () => { if (hoverId) { hoverId = null; posicionar(); } arrasto = null; });
  el.addEventListener('pointerup', (e) => { foiArrasto = !!arrasto && arrasto.moved > 5; arrasto = null; try { el.releasePointerCapture(e.pointerId); } catch { /* ignora */ } });
  el.addEventListener('click', (e) => {
    if (!pronto || alvoProprio(e)) return;
    if (foiArrasto) { foiArrasto = false; return; }
    const o = pertoDe(e.clientX, e.clientY, 30);
    if (o) api.onPick(o.id);
  });

  // Tamanho da tela mudou: enquadra de novo e mede os rótulos outra vez.
  const ro = new ResizeObserver(() => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h || (w === W && h === H)) return;
    W = w; H = h; meW = 0; lim = null; locais.forEach((o) => { o.lw = 0; });
    if (map && pronto) map.jumpTo({ zoom: zoomIdeal(), pitch: inclinacao(), padding: margens() });
    posicionar();
  });
  ro.observe(el);
  // Quando uma fonte termina de carregar, o tamanho dos rótulos muda: mede de novo (evita sobreposição).
  const remedir = () => { meW = 0; lim = null; locais.forEach((o) => { o.lw = 0; }); posicionar(); };
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', remedir);
  const io = new IntersectionObserver(([e]) => { visivel = e.isIntersecting; if (visivel) { ultimo = performance.now(); girar(); } });
  io.observe(el);
  const aoMudarVisibilidade = () => { if (!document.hidden) { ultimo = performance.now(); girar(); } };
  document.addEventListener('visibilitychange', aoMudarVisibilidade);

  function destruir() {
    if (destruido) return;
    destruido = true;
    cancelAnimationFrame(raf); raf = 0;
    clearTimeout(timerEspera);
    ro.disconnect(); io.disconnect();
    document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', remedir);
    try { map?.remove(); } catch { /* ignora */ }
    map = null;
    locais.forEach((o) => { o.pin.remove(); o.label.remove(); });
    locais = [];
    eu.remove(); meLabel.remove(); mapaEl.remove();
    creditos.hidden = true;
    el.classList.remove('h3d-ready', 'h3d-pausado');
  }

  if (api.pronto()) criar();

  return {
    setPaused(v) { pausado = !!v; lim = null; el.classList.toggle('h3d-pausado', pausado); if (!pausado) { ultimo = performance.now(); girar(); } else posicionar(); },
    // A origem ou a lista de locais mudou (a página chama depois de cada mudança).
    setOrigin() { if (destruido) return; if (!map) { if (api.pronto()) criar(); return; } atualizarDados(); },
    refreshLabels() { locais.forEach((o) => { const s = o.label.querySelector('small'); if (s) s.textContent = api.meta(o.c); o.label.setAttribute('aria-label', `${o.c.n}, ${api.meta(o.c)}`); o.lw = 0; }); posicionar(); },
    setTema(t) { tema = t === 'escuro' ? 'escuro' : 'claro'; if (map?.getLayer('predios')) pintar(map, tema); else map?.once('style.load', () => pintar(map, tema)); },
    destroy: destruir,
    // Para os testes: o mapa está pronto, quantos prédios estão desenhados e para onde a câmera aponta.
    info() {
      if (!map) return { pronto: false };
      let predios = 0;
      try { predios = map.queryRenderedFeatures({ layers: ['predios'] }).length; } catch { /* estilo carregando */ }
      return { pronto, predios, ladrilhos, rumo: map.getBearing(), zoom: map.getZoom(), inclinacao: map.getPitch(), centro: map.getCenter().toArray(), tema, sombras: nSombras, msSombras, msSombrasTotal };
    },
  };
}
