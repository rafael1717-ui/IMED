// Mapas do topo (assets/js/hero3d.js) e dos outros mapas nos testes de ponta a ponta, sem internet:
// - a lista de ladrilhos (TileJSON) do OpenFreeMap e ladrilhos vetoriais (MVT) montados aqui, com quarteirões, ruas,
//   uma praça e prédios de alturas variadas (desenho de teste, não são dados do OpenStreetMap);
// - a foto de satélite da Esri: pedaços PNG de 256 px montados aqui (manchas que lembram quadras vistas de cima) e a
//   chave de teste posta no config.js servido à página (como se o dono tivesse colado a chave).
// Uso num teste e2e (não é um teste: o nome não começa com "e2e-"):
//   await simularMapa(context)                       ladrilhos simulados (o mapa 3D abre)
//   await simularMapa(context, { falha: true })      sem resposta do OpenFreeMap (a página cai na versão leve)
//   await simularMapa(context, { log: [] })          guarda cada endereço pedido ao OpenFreeMap
//   await simularSatelite(context)                   chave de teste no config.js + pedaços da foto simulados
//   await simularSatelite(context, { invalida: true }) a Esri recusa a chave (498) em todo pedaço
//   await simularSatelite(context, { log: [] })      guarda cada endereço pedido à Esri
//   predioEm(lat, lng)                               há prédio simulado nesse ponto? (o contorno vai aparecer)
import { deflateSync } from 'node:zlib';
export const OFM = 'https://tiles.openfreemap.org/';
export const ESRI = 'https://ibasemaps-api.arcgis.com/';
export const CHAVE_TESTE = 'chave-de-teste-ESRI';
const CORS = { 'Access-Control-Allow-Origin': '*' };
export const TILEJSON = {
  tilejson: '3.0.0', name: 'OpenFreeMap (simulado nos testes)', minzoom: 0, maxzoom: 14,
  tiles: [`${OFM}planet/teste/{z}/{x}/{y}.pbf`],
  attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
  vector_layers: ['building', 'transportation', 'water', 'park', 'landuse', 'landcover', 'waterway'].map((id) => ({ id, fields: {} })),
};

export async function simularMapa(context, { falha = false, log = null } = {}) {
  await context.route(`${OFM}**`, (route) => {
    const u = route.request().url();
    log?.push(u);
    if (falha) return route.abort('internetdisconnected');
    if (u === `${OFM}planet`) return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(TILEJSON) });
    const m = u.match(/\/planet\/teste\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (m) return route.fulfill({ status: 200, contentType: 'application/x-protobuf', headers: CORS, body: ladrilho(+m[1], +m[2], +m[3]) });
    return route.fulfill({ status: 404, headers: CORS, body: '' });
  });
}

// Foto de satélite simulada: a chave de teste entra no config.js que a página recebe (o arquivo de verdade segue sem
// chave) e cada pedaço pedido à Esri com essa chave volta como PNG; com outra chave (ou invalida: true), 499 + JSON
// de erro, como a Esri responde a uma chave recusada.
export async function simularSatelite(context, { chave = CHAVE_TESTE, invalida = false, log = null } = {}) {
  await context.route(/\/assets\/js\/config\.js(\?.*)?$/, async (route) => {
    const r = await route.fetch();
    const body = (await r.text()) + `\n;window.IMED_CONFIG.satelite.chave = ${JSON.stringify(chave)};\n`;
    return route.fulfill({ response: r, body, headers: { ...r.headers(), 'content-length': String(Buffer.byteLength(body)) } });
  });
  await context.route((u) => u.href.startsWith(ESRI), (route) => {
    const u = route.request().url();
    log?.push(u);
    const m = u.match(/\/World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)\?token=([^&]*)$/);
    if (!m || invalida || decodeURIComponent(m[4]) !== chave) {
      return route.fulfill({ status: 499, contentType: 'application/json', headers: CORS, body: JSON.stringify({ error: { code: 498, message: 'Invalid token.', details: [] } }) });
    }
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' }, body: fotoPng(+m[1], +m[3], +m[2]) });
  });
}

/* ---------- PNG mínimo (foto simulada) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(tipo, dados) {
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const cachePng = new Map();
// 256 × 256: quadras em tons de cinza-esverdeado, separadas por "ruas" mais claras, variando com z/x/y (parece uma
// foto aérea de longe; é só desenho de teste).
export function fotoPng(z, x, y) {
  const chave = `${z}/${x}/${y}`;
  if (cachePng.has(chave)) return cachePng.get(chave);
  const N = 256, raw = Buffer.alloc(N * (1 + N * 3));
  const h = (a, b) => { let v = (z * 374761393 + x * 668265263 + y * 2147483647 + a * 97 + b * 31) | 0; v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
  for (let j = 0; j < N; j++) {
    raw[j * (1 + N * 3)] = 0;
    for (let i = 0; i < N; i++) {
      const bi = Math.floor(i / 64), bj = Math.floor(j / 64), rua = i % 64 < 6 || j % 64 < 6;
      const t = h(bi, bj), g = rua ? 150 : 70 + Math.round(t * 60), v = rua ? 0 : Math.round(h(i >> 3, j >> 3) * 18);
      const o = j * (1 + N * 3) + 1 + i * 3;
      raw[o] = g + v; raw[o + 1] = g + 8 + v; raw[o + 2] = g - 6 + v;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  cachePng.set(chave, png);
  return png;
}

/* ---------- MVT (Mapbox Vector Tile 2.1) mínimo ---------- */
const EXT = 4096;
function varint(out, v) { while (v > 127) { out.push((v & 127) | 128); v = Math.floor(v / 128); } out.push(v); }
const zz = (n) => (n << 1) ^ (n >> 31);
function campo(out, n, tipo) { varint(out, (n << 3) | tipo); }
function bytes(out, n, b) { campo(out, n, 2); varint(out, b.length); for (const x of b) out.push(x); }
function texto(out, n, s) { bytes(out, n, [...Buffer.from(s, 'utf8')]); }
function empacotado(out, n, valores) { const b = []; for (const v of valores) varint(b, v); bytes(out, n, b); }
const cmd = (id, n) => (id & 7) | (n << 3);

// Geometria: anéis (polígono, sentido horário em coordenadas do ladrilho) ou linhas.
function geometria(partes, fechar) {
  const g = []; let cx = 0, cy = 0;
  for (const pts of partes) {
    g.push(cmd(1, 1), zz(pts[0][0] - cx), zz(pts[0][1] - cy)); cx = pts[0][0]; cy = pts[0][1];
    g.push(cmd(2, pts.length - 1));
    for (const [x, y] of pts.slice(1)) { g.push(zz(x - cx), zz(y - cy)); cx = x; cy = y; }
    if (fechar) g.push(cmd(7, 1));
  }
  return g;
}
const ret = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function camada(nome, feicoes) {
  const chaves = [], valores = [], ix = new Map();
  const tag = (k, v) => {
    let ik = chaves.indexOf(k); if (ik < 0) { ik = chaves.length; chaves.push(k); }
    const kv = `${typeof v}:${v}`;
    if (!ix.has(kv)) { ix.set(kv, valores.length); valores.push(v); }
    return [ik, ix.get(kv)];
  };
  const out = [];
  texto(out, 1, nome);
  for (const f of feicoes) {
    const fb = [];
    empacotado(fb, 2, Object.entries(f.props).flatMap(([k, v]) => tag(k, v)));
    campo(fb, 3, 0); varint(fb, f.tipo);
    empacotado(fb, 4, geometria(f.partes, f.tipo === 3));
    bytes(out, 2, fb);
  }
  for (const k of chaves) texto(out, 3, k);
  for (const v of valores) {
    const vb = [];
    if (typeof v === 'string') texto(vb, 1, v); else { campo(vb, 5, 0); varint(vb, v); }
    bytes(out, 4, vb);
  }
  campo(out, 5, 0); varint(out, EXT);
  campo(out, 15, 0); varint(out, 2);
  return out;
}

// Um ladrilho de z14: 12 × 12 quarteirões com ruas, uma praça, um lago e 2 a 4 prédios por quarteirão, de 4 a 120 m
// (alturas que se repetem de forma fixa, para os testes darem sempre o mesmo resultado).
const N = 12, P = EXT / N, R = 22; // R: meia largura da rua
// O quarteirão (i, j) do ladrilho (x, y): { parque } | { agua } | { lotes: [[x0, y0, x1, y1]...], alturas }.
function quarteirao(x, y, i, j) {
  const semente = (k) => { let h = (x * 73856093) ^ (y * 19349663) ^ (i * 83492791) ^ (j * 2654435761) ^ (k * 97); h = Math.imul(h ^ (h >>> 15), 2246822507); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
  const x0 = i * P + R, y0 = j * P + R, x1 = (i + 1) * P - R, y1 = (j + 1) * P - R;
  if ((i + j * 5) % 23 === 7) return { parque: [x0, y0, x1, y1] };
  if (i === 9 && j === 2) return { agua: [x0, y0, x1, y1] };
  const meio = (x0 + x1) / 2, gap = 10;
  const lotes = semente(0) < .5
    ? [[x0, y0, meio - gap, y1], [meio + gap, y0, x1, y1]]
    : [[x0, y0, meio - gap, (y0 + y1) / 2 - gap], [meio + gap, y0, x1, (y0 + y1) / 2 - gap], [x0, (y0 + y1) / 2 + gap, meio - gap, y1], [meio + gap, (y0 + y1) / 2 + gap, x1, y1]];
  const alturas = lotes.map((_, k) => { const s = semente(k + 1); return s > .9 ? 60 + Math.round(s * 60) : s > .6 ? 20 + Math.round(s * 30) : 4 + Math.round(s * 12); });
  return { lotes, alturas };
}
// O ladrilho z14 do ponto ("14/x/y", como nos endereços pedidos ao OpenFreeMap) e a posição dentro dele.
export function ladrilhoDe(lat, lng) {
  const z = 14, n = 2 ** z, rad = (lat * Math.PI) / 180;
  const xt = ((lng + 180) / 360) * n, yt = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const x = Math.floor(xt), y = Math.floor(yt);
  return { chave: `${z}/${x}/${y}`, x, y, px: (xt - x) * EXT, py: (yt - y) * EXT };
}
// Há prédio simulado no ponto? (o quarteirão do ladrilho z14 onde o ponto cai; a borda de 64 unidades que o
// ladrilho vizinho repete não tem prédio). Para os testes saberem onde o contorno do prédio vai aparecer — desde que
// a página tenha baixado esse ladrilho (ladrilhoDe).
export function predioEm(lat, lng) {
  const { x, y, px, py } = ladrilhoDe(lat, lng);
  const i = Math.floor(px / P), j = Math.floor(py / P);
  const q = quarteirao(x, y, i, j);
  if (!q.lotes) return false;
  return q.lotes.some(([x0, y0, x1, y1]) => px >= x0 && px <= x1 && py >= y0 && py <= y1);
}
const cache = new Map();
export function ladrilho(z, x, y) {
  const chave = `${z}/${x}/${y}`;
  if (cache.has(chave)) return cache.get(chave);
  const predios = [], ruas = [], parque = [], agua = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const q = quarteirao(x, y, i, j);
      if (q.parque) { parque.push({ tipo: 3, props: { class: 'park' }, partes: [ret(...q.parque)] }); continue; }
      if (q.agua) { agua.push({ tipo: 3, props: { class: 'lake' }, partes: [ret(...q.agua)] }); continue; }
      q.lotes.forEach((lote, k) => {
        predios.push({ tipo: 3, props: { render_height: q.alturas[k], render_min_height: 0 }, partes: [ret(...lote)] });
      });
    }
  }
  for (let k = 0; k <= N; k++) {
    const c = k * P, classe = k % 4 === 0 ? 'primary' : k % 2 === 0 ? 'secondary' : 'minor';
    ruas.push({ tipo: 2, props: { class: classe }, partes: [[[c, -64], [c, EXT + 64]]] });
    ruas.push({ tipo: 2, props: { class: classe }, partes: [[[-64, c], [EXT + 64, c]]] });
  }
  const uso = [{ tipo: 3, props: { class: 'residential' }, partes: [ret(-64, -64, EXT + 64, EXT + 64)] }];
  const corpo = Buffer.from([
    ...bytesCamada('landuse', uso), ...bytesCamada('park', parque), ...bytesCamada('water', agua),
    ...bytesCamada('transportation', ruas), ...bytesCamada('building', predios),
  ]);
  cache.set(chave, corpo);
  return corpo;
}
function bytesCamada(nome, feicoes) { const out = []; bytes(out, 3, camada(nome, feicoes)); return out; }
