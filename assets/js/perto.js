// Página "Clínicas perto de você".
// Fluxo: a pessoa permite a localização (ou digita CEP, cidade ou endereço) → o site busca no banco do
// IMED, já ordenados por distância, as clínicas parceiras e os estabelecimentos reais do cadastro oficial
// (CNES) → lista e mapa com filtros → detalhes → pedido de agendamento gravado no banco.
// A busca vale para a área inteira do raio escolhido (5 km por padrão, até 50 km): o mapa abre mostrando
// o círculo todo, com um ponto para cada estabelecimento do cadastro oficial (establishment_points), e a
// lista mostra os parceiros e os estabelecimentos por distância, em páginas de 50 ("Ver mais"). Os filtros
// de tipo, exame e SUS são aplicados pelo banco na área inteira; os outros, no navegador. Parceiros e
// locais do mapa público têm sempre pino; os do cadastro oficial ganham pino quando o mapa está perto.
// Se a cidade ainda não está no banco, o servidor começa a importá-la do CNES e, enquanto isso, a página
// completa a lista com o mapa público (OpenStreetMap) e busca de novo em alguns segundos.
// Privacidade: as coordenadas são arredondadas (~110 m) assim que chegam, ficam só na memória
// desta página e nunca são gravadas no aparelho nem no banco.
import * as G from './geo-core.js';
import { fundoDoMapa } from './mapa-fundo.js';

const CFG = window.IMED_CONFIG;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const params = new URLSearchParams(location.search);
// Rolagem suave só para quem não pediu "reduzir movimento" no aparelho.
const SMOOTH = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

const desktop = matchMedia('(min-width: 900px)');
const kmLabel = (m) => `${m / 1000} km`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const S = {
  phase: 'intro', // intro | locating | geo-error | loading | results
  geoError: null,
  origin: null, // { lat, lng } arredondado
  originLabel: '',
  originKind: null, // gps | busca | mapa
  precision: null,
  fetchedRadius: 0,
  provider: null, // google | osm (informado pelo servidor)
  imed: [],
  // Estabelecimentos reais do cadastro oficial (CNES) que vieram com a busca: os mais próximos, sem filtro.
  base: [],
  baseServed: 0, // quantos o servidor mandou (sem contar o local aberto por ?local=)
  baseRadius: 0, // raio que essas linhas cobrem (a função do servidor busca no máximo 20 km)
  baseTotal: null, // total da área sem filtro, quando veio junto
  places: [], // estabelecimentos do mapa (Google Places ou OpenStreetMap)
  imedState: 'idle', // idle | loading | ok | error
  cnesState: 'idle',
  placesState: 'idle',
  coverage: null, // { status: done | loading | unavailable, city, uf }
  retries: 0,
  retryTimer: 0,
  fnDown: false,
  truncated: false, // o mapa público (OpenStreetMap) devolveu o máximo de locais
  // Área inteira: lista do cadastro oficial em páginas, por chave de consulta (raio, tipo, exame, SUS).
  lists: new Map(),
  totals: new Map(), // chave → total real da área, contado pelo banco
  pts: { key: '', rows: [], total: null, kinds: [], state: 'idle' }, // pontos do mapa da chave atual
  ptsCache: new Map(),
  areaAsked: '', // última chave cuja lista e pontos foram pedidos ao banco
  extra: new Map(), // locais abertos pelo ponto do mapa ou por ?local=, com a distância calculada
  areaTimer: 0,
  areaCtrl: null,
  moreCtrl: null,
  pointCtrl: null,
  f: { ...G.DEFAULT_FILTERS, exam: Object.hasOwn(G.EXAMS, params.get('exame') ?? '') ? params.get('exame') : '' },
  exameNome: '', // exame de laboratório escrito na busca ("Hemograma"), para o aviso da lista
  ratings: new Map(), // id do local → { rating, reviews }, só o que veio do banco
  ratingsAsked: new Set(),
  equip: new Map(), // CNES → aparelhos em uso informados ao cadastro oficial ({ exams, sus, competencia })
  equipAsked: new Set(),
  near: { key: '', rows: [], state: 'idle' }, // centros de imagem perto, quando nenhum local tem o exame
  scheduled: new Set(), // parceiros com agenda online (horários livres para escolher)
  scheduleAsked: new Set(),
  pendingOpen: null, // local pedido em ?local=, aberto quando a busca em volta dele termina
  selected: null,
  demo: params.get('demo') === '1',
  seq: 0,
  ctrl: null,
};
const osmCache = new Map();

/* ======================= serviços ======================= */
function linkedSignal(parent, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Tempo esgotado', 'TimeoutError')), ms);
  const stop = () => ctrl.abort(parent.reason);
  if (parent) {
    if (parent.aborted) stop();
    else parent.addEventListener('abort', stop, { once: true });
  }
  return { signal: ctrl.signal, done() { clearTimeout(timer); parent?.removeEventListener('abort', stop); } };
}

// Busca e leitura como visitante: só a chave publishable (o pedido com conta vai pelo auth.js, com o token da pessoa).
const authHeaders = () => CFG.supabaseHeaders(null, { 'Content-Type': 'application/json' });

async function callFn(body, parent, ms = 20000) {
  const t = linkedSignal(parent, ms);
  try {
    const res = await fetch(`${CFG.functionsUrl}/clinicas-proximas`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal: t.signal });
    let data = null;
    try { data = await res.json(); } catch { /* resposta sem JSON */ }
    if (!res.ok || !data?.ok) throw Object.assign(new Error(data?.error || `http ${res.status}`), { status: res.status, code: data?.error });
    return data;
  } finally {
    t.done();
  }
}

// Funções do banco (PostgREST). Também são o plano B quando a função do servidor não responde.
// fn pode trazer "?select=…" para pedir só algumas colunas.
async function rpc(fn, args, parent) {
  const t = linkedSignal(parent, 12000);
  try {
    const res = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers: authHeaders(), signal: t.signal, body: JSON.stringify(args) });
    if (!res.ok) throw new Error(`banco ${res.status}`);
    return await res.json();
  } finally {
    t.done();
  }
}
const rpcNearby = (origin, radius, parent) =>
  rpc('nearby_clinics', { p_lat: origin.lat, p_lng: origin.lng, p_radius_m: radius, p_include_demo: S.demo, p_limit: 100 }, parent);
const rpcEstablishments = (origin, radius, parent) =>
  rpc('nearby_establishments', { p_lat: origin.lat, p_lng: origin.lng, p_radius_m: radius, p_limit: CNES_LIMIT }, parent);
const CNES_LIMIT = 250; // estabelecimentos que vêm com a busca (os mais próximos)
const PAGE = 50; // estabelecimentos do cadastro oficial por página da lista
const POINTS_LIMIT = 3000; // pontos da área no mapa (os mais próximos)
const PIN_LIMIT = 100; // pinos do cadastro oficial (os primeiros da lista); o resto da área aparece como ponto
const FAR_ZOOM = 15; // abaixo deste zoom o mapa está afastado (a área inteira): o cadastro oficial fica só como ponto
const FN_MAX_RADIUS = 20000; // a função do servidor busca até 20 km; acima disso, os parceiros vêm direto do banco
const OSM_MAX_RADIUS = 20000; // o mapa público (Overpass, gratuito) é consultado no máximo em 20 km
const AREA_DELAY = 250; // espera depois de mexer nos filtros, antes de buscar de novo
const RETRY_MS = 9000;

async function fetchOverpass(origin, radius, parent) {
  const key = `${origin.lat},${origin.lng},${radius}`;
  if (osmCache.has(key)) return osmCache.get(key);
  const body = 'data=' + encodeURIComponent(G.overpassQuery(origin, radius));
  let last = new Error('overpass indisponível');
  for (const url of CFG.overpass) {
    const t = linkedSignal(parent, 25000);
    try {
      const res = await fetch(url, { method: 'POST', body, signal: t.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) throw new Error(`overpass ${res.status}`);
      const json = await res.json();
      osmCache.set(key, json);
      return json;
    } catch (err) {
      if (parent?.aborted) throw err;
      last = err;
    } finally {
      t.done();
    }
  }
  throw last;
}

/* ======================= busca ======================= */
// refresh = nova busca automática no mesmo ponto, enquanto a cidade é importada do CNES:
// mantém o que já está na tela e não move o mapa.
async function runSearch(origin, label, kind, precision = null, refresh = false) {
  S.ctrl?.abort();
  clearTimeout(S.retryTimer);
  resetArea();
  const ctrl = (S.ctrl = new AbortController());
  const seq = ++S.seq;
  const radius = S.f.radius;
  if (!refresh) {
    Object.assign(S, {
      phase: 'loading', origin, originLabel: label, originKind: kind, precision, fetchedRadius: radius,
      imed: [], base: [], baseServed: 0, baseRadius: 0, baseTotal: null, places: [],
      imedState: 'loading', cnesState: 'loading', placesState: 'idle', coverage: null,
      retries: 0, fnDown: false, truncated: false, selected: null,
    });
    S.extra.clear();
    userMoved = false;
    hideAreaBtn();
    drawOrigin();
    fitMap();
    render();
  }

  // Acima de 20 km a função do servidor não chega: os parceiros da área inteira vêm direto do banco.
  const wide = radius > FN_MAX_RADIUS;
  const [fnRes, wideRes] = await Promise.allSettled([
    callFn({ action: 'search', lat: origin.lat, lng: origin.lng, radius_m: radius, include_demo: S.demo }, ctrl.signal),
    wide ? rpcNearby(origin, radius, ctrl.signal) : Promise.resolve(null),
  ]);
  if (ctrl.signal.aborted || seq !== S.seq) return;
  const r = fnRes.status === 'fulfilled' ? fnRes.value : null;
  const widePartners = wide && wideRes.status === 'fulfilled' && Array.isArray(wideRes.value) ? wideRes.value : null;
  let rawRows = []; // linhas do cadastro oficial como vieram (com cidade e UF), para o contador de visitas
  if (r) {
    S.fnDown = false;
    S.provider = r.provider;
    S.imed = (widePartners ?? r.imed ?? []).map((row) => G.normalizeImedRow(row, origin));
    S.imedState = r.warnings?.includes('imed_unavailable') && !widePartners ? 'error' : 'ok';
    // Acima de 20 km sem a resposta do banco: ficam só os parceiros de até 20 km, e a pessoa é avisada.
    if (wide && !widePartners) S.imedState = 'error';
    const rows = Array.isArray(r.cnes) ? r.cnes : [];
    rawRows = rows;
    S.base = rows.map((row) => G.normalizeCnes(row, origin));
    S.baseServed = rows.length;
    S.baseRadius = Number(r.radius_m) > 0 ? Number(r.radius_m) : Math.min(radius, FN_MAX_RADIUS);
    S.baseTotal = G.rowsTotal(rows);
    S.cnesState = r.warnings?.includes('cnes_unavailable') ? 'error' : 'ok';
    S.coverage = r.coverage ?? null;
    if (r.provider === 'google') {
      S.places = (r.places ?? []).map((p) => G.normalizeGoogle(p, origin)).filter(Boolean);
      S.placesState = r.warnings?.includes('places_unavailable') ? 'error' : 'ok';
    }
  } else {
    // A função do servidor não respondeu: o banco é consultado direto.
    S.fnDown = true;
    const [imedRes, cnesRes] = await Promise.allSettled([
      widePartners ? Promise.resolve(widePartners) : rpcNearby(origin, radius, ctrl.signal),
      rpcEstablishments(origin, radius, ctrl.signal),
    ]);
    if (ctrl.signal.aborted || seq !== S.seq) return;
    S.imed = imedRes.status === 'fulfilled' ? imedRes.value.map((row) => G.normalizeImedRow(row, origin)) : [];
    S.imedState = imedRes.status === 'fulfilled' ? 'ok' : 'error';
    const rows = cnesRes.status === 'fulfilled' && Array.isArray(cnesRes.value) ? cnesRes.value : [];
    rawRows = rows;
    S.base = rows.map((row) => G.normalizeCnes(row, origin));
    S.baseServed = rows.length;
    S.baseRadius = radius;
    S.baseTotal = G.rowsTotal(rows);
    S.cnesState = cnesRes.status === 'fulfilled' ? 'ok' : 'error';
    S.coverage = { status: S.base.length ? 'done' : 'unavailable', city: null, uf: null };
  }
  // Com a cidade no banco, o cadastro oficial basta; sem ela, o mapa público completa a lista.
  const google = S.provider === 'google' && !S.fnDown;
  const needOsm = !google && S.coverage?.status !== 'done';
  if (!google && !needOsm) { S.places = []; S.placesState = 'idle'; S.truncated = false; }
  resetArea(); // a lista e os pontos da área recomeçam com o que acabou de chegar
  S.phase = 'results';
  if (S.pendingOpen) includePending(origin);
  render(!refresh || !userMoved);
  syncArea(); // pontos da área inteira no mapa e, com filtro de tipo, exame ou SUS, a lista vinda do banco
  trackSearch(rawRows);
  loadRatings(seq);
  loadSchedules(seq);
  if (S.pendingOpen && !refresh) openPending();
  if (S.coverage?.status === 'loading' && S.retries < 4) {
    S.retryTimer = setTimeout(() => {
      if (seq !== S.seq) return;
      S.retries += 1;
      runSearch(origin, label, kind, precision, true);
    }, RETRY_MS);
  }
  if (needOsm) await loadOsm(origin, radius, ctrl.signal, seq);
}

async function loadOsm(origin, radius, signal, seq) {
  S.placesState = 'loading';
  if (S.phase === 'results') render();
  // O Overpass é um serviço gratuito e mantido por voluntários: a consulta vai até 20 km.
  const r = Math.min(radius, OSM_MAX_RADIUS);
  try {
    const json = await fetchOverpass(origin, r, signal);
    if (seq !== S.seq) return;
    S.places = G.parseOverpass(json, origin, r);
    S.truncated = (json.elements?.length ?? 0) >= 1000;
    S.placesState = 'ok';
  } catch {
    if (signal.aborted || seq !== S.seq) return;
    S.placesState = 'error';
  }
  if (S.phase === 'results') { render(true); loadRatings(seq); }
}

// Notas dos locais na tela (até 300), quando existem avaliações publicadas. Falha não atrapalha a busca.
// ids: locais específicos (por exemplo, o ponto do mapa que acabou de ser aberto).
async function loadRatings(seq, ids = null) {
  loadEquip(seq);
  const keys = (ids ?? allPlaces().map((p) => p.id)).filter((id) => !S.ratingsAsked.has(id)).slice(0, 300);
  if (!keys.length) return;
  keys.forEach((k) => S.ratingsAsked.add(k));
  try {
    const rows = await rpc('place_ratings', { p_keys: keys });
    let got = 0;
    for (const r of Array.isArray(rows) ? rows : []) {
      const rating = Number(r.rating), reviews = Number(r.reviews);
      if (!r.place_key || !Number.isFinite(rating) || !(reviews > 0)) continue;
      S.ratings.set(r.place_key, { rating, reviews });
      got += 1;
    }
    if (got && seq === S.seq && S.phase === 'results') render();
  } catch {
    keys.forEach((k) => S.ratingsAsked.delete(k));
  }
}

// Aparelhos em uso (cadastro oficial) dos locais na tela, para o aviso "Tem aparelho de ... em uso". Falha não
// atrapalha: o local continua na lista (o banco já filtrou pelo exame).
async function loadEquip(seq) {
  if (!G.EQUIP_EXAMS.includes(S.f.exam)) return; // só com exame escolhido (é quando o aviso aparece)
  const keys = allPlaces().filter((p) => p.source === 'cnes' && !p.equip && p.services.includes(S.f.exam)).map((p) => p.id.slice(5))
    .filter((c) => !S.equipAsked.has(c)).slice(0, 150);
  const path = G.equipPath(keys);
  if (!path) return;
  keys.forEach((k) => S.equipAsked.add(k));
  try {
    const rows = await restGet(path);
    let got = 0;
    for (const r of Array.isArray(rows) ? rows : []) {
      const e = G.normalizeEquip(r);
      if (!e?.exams.length) continue;
      S.equip.set(String(r.cnes), e);
      got += 1;
    }
    if (got && seq === S.seq && S.phase === 'results') render();
  } catch {
    keys.forEach((k) => S.equipAsked.delete(k));
  }
}
const withEquip = (p) => (p.source === 'cnes' && !p.equip && S.equip.has(p.id.slice(5)) ? { ...p, equip: S.equip.get(p.id.slice(5)) } : p);
function equipLineHTML(p) {
  const t = G.equipNote(withEquip(p), S.f.exam);
  return t ? `<p class="pc-equip"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>${esc(t)}</span></p>` : '';
}

// Nenhum local com o exame de imagem: os centros de diagnóstico por imagem mais perto (sem o exame), para ligar e
// confirmar. Nunca diz que fazem o exame.
async function loadNear(seq) {
  const key = `${areaKey()}|near`;
  if (S.near.key === key) return;
  S.near = { key, rows: [], state: 'loading' };
  try {
    const rows = await rpc('nearby_establishments', { ...G.areaArgs(S.origin, { ...S.f, exam: '', kind: 'imagem' }), p_limit: 5, p_offset: 0 });
    if (seq !== S.seq || S.near.key !== key) return;
    S.near = { key, rows: (Array.isArray(rows) ? rows : []).map((r) => G.normalizeCnes(r, S.origin)), state: 'ok' };
  } catch {
    if (S.near.key === key) S.near = { key, rows: [], state: 'error' };
  }
  if (S.phase === 'results') render();
}
function nearHTML() {
  if (S.near.key !== `${areaKey()}|near` || !S.near.rows.length) return '';
  const items = S.near.rows.map((p) => {
    const url = G.localUrl(p);
    const tel = p.phone && G.telHref(p.phone);
    return `<li><b>${url ? `<a class="link" href="${esc(url)}">${esc(p.name)}</a>` : esc(p.name)}</b><span>${distanceText(p)}${p.address ? ` · ${esc(p.address)}` : ''}</span>${tel ? `<a href="${esc(tel)}"><i class="fa-solid fa-phone" aria-hidden="true"></i>${esc(p.phone)}</a>` : ''}</li>`;
  }).join('');
  return `<div class="eq-nearbox" data-near><h3>Centros de diagnóstico por imagem perto</h3>
    <p>Ligue e confirme se fazem o exame: o cadastro oficial não diz isso.</p><ul class="eq-near">${items}</ul></div>`;
}

// Parceiros na tela que têm agenda online. Falha não atrapalha: o botão continua sendo o pedido.
async function loadSchedules(seq) {
  const ids = S.imed.map((p) => p.clinic_id).filter((id) => id && !S.scheduleAsked.has(id)).slice(0, 300);
  if (!ids.length) return;
  ids.forEach((id) => S.scheduleAsked.add(id));
  try {
    const rows = await rpc('clinics_with_schedule', { p_ids: ids });
    let got = 0;
    for (const r of Array.isArray(rows) ? rows : []) if (r.clinic_id && !S.scheduled.has(r.clinic_id)) { S.scheduled.add(r.clinic_id); got += 1; }
    if (got && seq === S.seq && S.phase === 'results') {
      render();
      const open = S.selected && $('#ov').classList.contains('open') && $('#sheet [data-book]');
      if (open && hasSchedule(placeById(S.selected))) openDetails(S.selected);
    }
  } catch {
    ids.forEach((id) => S.scheduleAsked.delete(id));
  }
}
const hasSchedule = (p) => !!p && p.source === 'imed' && p.accepts_online_booking && S.scheduled.has(p.clinic_id);

/* ======================= área inteira: pontos no mapa e lista em páginas ======================= */
// Cada combinação de raio, tipo, exame e SUS é uma consulta ao banco (chave). O total vem contado pelo
// banco; nada é estimado. Sem filtro de tipo, exame ou SUS, as primeiras páginas da lista são os
// estabelecimentos que já vieram com a busca.
const areaKey = () => G.areaKey(S.f);

function resetArea() {
  clearTimeout(S.areaTimer);
  S.areaCtrl?.abort();
  S.moreCtrl?.abort();
  S.lists.clear();
  S.totals.clear();
  S.ptsCache.clear();
  S.pts = { key: '', rows: [], total: null, kinds: [], state: 'idle' };
  S.areaAsked = '';
}

// Lista do cadastro oficial da consulta atual. state: loading (primeira página a caminho) | ok | error.
function listFor() {
  const key = areaKey();
  let l = S.lists.get(key);
  if (l) return l;
  const radius = G.areaFilters(S.f).radius;
  const filtered = G.hasAreaFilter(S.f);
  l = { key, radius, filtered, rows: [], ids: new Set(), served: 0, view: PAGE, exhausted: false, state: 'loading', more: 'idle' };
  if (!filtered && S.cnesState === 'ok') {
    // Os estabelecimentos da busca são os mais próximos, na mesma ordem do banco: servem de primeiras páginas.
    for (const p of S.base) {
      if (p.distance_m > radius || l.ids.has(p.id)) continue;
      l.ids.add(p.id);
      l.rows.push(p);
      if (!p.injected) l.served += 1;
    }
    // A busca trouxe menos que o máximo e cobre este raio: não há outros no banco.
    l.exhausted = S.baseRadius >= radius && S.baseServed < CNES_LIMIT;
    l.state = 'ok';
    if (S.baseTotal != null && S.baseRadius === radius) S.totals.set(key, S.baseTotal);
    else if (l.exhausted && !S.totals.has(key)) S.totals.set(key, l.served);
  }
  S.lists.set(key, l);
  return l;
}

// Linhas do cadastro oficial que entram na lista agora. Enquanto a primeira página com filtros não chega
// (ou se ela falhou), a lista usa o que já tem: os estabelecimentos da busca, filtrados no navegador.
function cnesRows() {
  if (S.phase !== 'results') return [];
  const l = listFor();
  return l.state === 'ok' ? l.rows.slice(0, l.view) : S.base;
}

const pagerOf = (l) => G.pagerState({ view: l.view, loaded: l.rows.length, served: l.served, exhausted: l.exhausted }, S.totals.get(l.key) ?? null, PAGE);

// Junta uma página do banco à lista, sem repetir o mesmo estabelecimento.
function addRows(l, rows, limit) {
  const list = Array.isArray(rows) ? rows : [];
  let added = 0;
  for (const row of list) {
    const p = G.normalizeCnes(row, S.origin);
    if (l.ids.has(p.id)) continue;
    l.ids.add(p.id);
    l.rows.push(p);
    added += 1;
  }
  l.served += list.length;
  if (list.length < limit) l.exhausted = true;
  const total = G.rowsTotal(list);
  if (total != null) S.totals.set(l.key, total);
  else if (l.exhausted) S.totals.set(l.key, l.served);
  return added;
}

// Depois de mexer em raio, tipo, exame ou SUS: espera um instante (a pessoa pode mexer de novo) e busca.
function scheduleArea() {
  clearTimeout(S.areaTimer);
  S.moreCtrl?.abort();
  S.areaTimer = setTimeout(syncArea, AREA_DELAY);
}

// Busca o que falta para a consulta atual: os pontos do mapa e, se preciso, a primeira página da lista.
// A requisição anterior é cancelada. Com um filtro que só os parceiros atendem (preço, convênio,
// "Parceiros verificados"), o cadastro oficial não aparece: nada é buscado até o filtro sair (changeFilters).
function syncArea() {
  clearTimeout(S.areaTimer);
  if (S.phase !== 'results' || !S.origin || G.onlyPartnerFilter(S.f)) return;
  S.areaCtrl?.abort();
  const ctrl = (S.areaCtrl = new AbortController());
  const seq = S.seq;
  const key = areaKey();
  S.areaAsked = key;
  const l = listFor();
  if (l.state !== 'ok') loadFirstPage(l, ctrl.signal, seq);
  if (S.pts.key !== key || S.pts.state !== 'ok') loadPoints(key, ctrl.signal, seq);
}

async function loadFirstPage(l, signal, seq) {
  l.state = 'loading';
  if (l.key === areaKey()) render();
  try {
    const rows = await rpc('nearby_establishments', { ...G.areaArgs(S.origin, S.f), p_limit: PAGE, p_offset: 0 }, signal);
    if (signal.aborted || seq !== S.seq) return;
    l.rows = [];
    l.ids.clear();
    l.served = 0;
    addRows(l, rows, PAGE);
    l.state = 'ok';
    if (!l.filtered) S.cnesState = 'ok';
  } catch {
    if (signal.aborted || seq !== S.seq) return;
    l.state = 'error';
  }
  if (l.key === areaKey()) {
    render();
    loadRatings(seq);
  }
}

async function loadPoints(key, signal, seq) {
  const hit = S.ptsCache.get(key);
  if (hit) {
    S.pts = { key, ...hit, state: 'ok' };
    render();
    return;
  }
  S.pts = { key, rows: [], total: null, kinds: [], state: 'loading' };
  render();
  try {
    const rows = await rpc(`establishment_points?select=${G.POINT_FIELDS}`, { ...G.areaArgs(S.origin, S.f), p_limit: POINTS_LIMIT }, signal);
    if (signal.aborted || seq !== S.seq || S.pts.key !== key) return;
    const { points, total } = G.normalizePoints(rows);
    const t = total ?? (points.length < POINTS_LIMIT ? points.length : null);
    const kinds = Object.keys(G.KINDS).filter((k) => points.some((p) => p.kind === k));
    S.pts = { key, rows: points, total: t, kinds, state: 'ok' };
    if (t != null) S.totals.set(key, t);
    S.ptsCache.set(key, { rows: points, total: t, kinds });
    if (S.ptsCache.size > 6) S.ptsCache.delete(S.ptsCache.keys().next().value);
  } catch {
    if (signal.aborted || seq !== S.seq || S.pts.key !== key) return;
    S.pts = { key, rows: [], total: null, kinds: [], state: 'error' };
  }
  render();
}

// "Ver mais": mostra a próxima página da lista, buscando no banco quando as já baixadas acabam.
// A lista não é refeita: entram só os cartões novos (com centenas de cartões, refazer tudo travava o
// celular). Enquanto carrega ou se falhar, o botão é o mesmo, então o foco de quem usa teclado fica nele.
async function showMore() {
  if (S.phase !== 'results') return;
  const l = listFor();
  // A primeira página com filtros falhou: o botão tenta de novo.
  if (l.state === 'error') { syncArea(); return; }
  if (l.state !== 'ok' || l.more === 'loading') return;
  const st = pagerOf(l);
  if (!st.more) return;
  const seq = S.seq;
  if (st.fetch) {
    l.more = 'loading';
    patchPager();
    announce('Carregando mais locais…');
    S.moreCtrl?.abort();
    const ctrl = (S.moreCtrl = new AbortController());
    try {
      const rows = await rpc('nearby_establishments', { ...G.areaArgs(S.origin, S.f), p_limit: PAGE, p_offset: l.served }, ctrl.signal);
      if (seq !== S.seq) return;
      addRows(l, rows, PAGE);
      l.more = 'idle';
    } catch {
      if (seq !== S.seq) return;
      l.more = ctrl.signal.aborted ? 'idle' : 'error';
      if (l.key === areaKey()) {
        patchPager();
        if (l.more === 'error') announce('Não foi possível carregar mais agora. Verifique sua internet e toque em "Tentar de novo".');
      }
      return;
    }
    if (l.key !== areaKey()) return; // os filtros mudaram enquanto carregava
  }
  l.view += PAGE;
  const fresh = renderMore();
  // Quem usa teclado ou leitor de tela continua do primeiro local novo (ou no botão, se nenhum novo
  // passou nos filtros do navegador, como especialidade).
  const first = fresh[0] ? $(`#list .pc[data-id="${CSS.escape(fresh[0])}"] .pc-open`) : null;
  const more = $('#list .pt-pager [data-act="more"]');
  if (first) {
    first.focus({ preventScroll: true });
    first.scrollIntoView({ block: 'nearest' });
    announce(`${plural(fresh.length, 'local a mais', 'locais a mais')} na lista.`);
  } else {
    (more ?? $('#list')).focus({ preventScroll: true });
    announce(more ? 'Nenhum local novo com esses filtros nesta parte da lista. Toque em "Ver mais" para continuar procurando.' : 'Não há outros locais com esses filtros.');
  }
  loadRatings(seq);
}

const announce = (text) => { $('#srMsg').textContent = text; };

// Troca o "Ver mais" pelo estado atual (carregando, erro, próxima página) sem recriar o botão: o foco
// de quem usa teclado ou leitor de tela não se perde.
function patchPager() {
  const old = $('#list > .pt-pager');
  if (!old) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = pagerHTML(listView.shown.length, listView.total).trim();
  const next = tpl.content.firstElementChild;
  const btn = $(':scope > [data-act="more"]', old);
  const nbtn = next && $(':scope > [data-act="more"]', next);
  if (!btn || !nbtn) {
    const focused = old.contains(document.activeElement);
    if (next) old.replaceWith(next); else old.remove();
    if (focused) ($('#list .pt-pager [data-act="more"]') ?? $('#list')).focus({ preventScroll: true });
    return;
  }
  for (const { name } of [...btn.attributes]) if (!nbtn.hasAttribute(name)) btn.removeAttribute(name);
  for (const { name, value } of [...nbtn.attributes]) btn.setAttribute(name, value);
  btn.innerHTML = nbtn.innerHTML;
  const kids = [...next.childNodes];
  const at = kids.indexOf(nbtn);
  for (const n of [...old.childNodes]) if (n !== btn) n.remove();
  btn.before(...kids.slice(0, at));
  btn.after(...kids.slice(at + 1));
  old.className = next.className;
}

// Depois do "Ver mais": põe na lista só os cartões novos, cada um no seu lugar (mesma ordem de render()),
// e atualiza contagem, botão e mapa. Se a lista na tela não bater com a nova, refaz tudo.
// Devolve os ids dos locais novos, na ordem da lista.
function renderMore() {
  const list = $('#list');
  const pager = $(':scope > .pt-pager', list);
  const now = $$(':scope > .pc[data-id]', list);
  const at = new Map(now.map((c, i) => [c.dataset.id, i]));
  const all = allPlaces();
  const shown = G.sortPlaces(G.filterPlaces(all, S.f), S.f.sort, S.f.exam, S.ratings);
  const fresh = shown.filter((p) => !at.has(p.id)).map((p) => p.id);
  const kept = shown.filter((p) => at.has(p.id));
  if (!pager || !now.length || kept.length !== now.length || kept.some((p, i) => at.get(p.id) !== i)) {
    render();
    return fresh;
  }
  let html = '';
  let k = 0;
  for (const p of shown) {
    if (!at.has(p.id)) { html += cardHTML(p); continue; }
    if (html) { now[k].insertAdjacentHTML('beforebegin', html); html = ''; }
    k += 1;
  }
  if (html) pager.insertAdjacentHTML('beforebegin', html);
  listView = { shown, total: areaTotal(shown) };
  renderFilters(all);
  setHTML($('#count'), countHTML(shown, listView.total));
  patchPager();
  drawMap(shown);
  return fresh;
}

/* ======================= detalhe de um ponto do mapa ======================= */
// O ponto traz só código, tipo e posição; o detalhe vem do cadastro (tabela establishments) ao tocar.
async function openPoint(pt) {
  const id = `cnes:${pt.cnes}`;
  if (placeById(id)) return openDetails(id);
  const path = G.pointDetailPath(pt.cnes);
  if (!path || !S.origin) return;
  S.pointCtrl?.abort();
  const ctrl = (S.pointCtrl = new AbortController());
  const origin = S.origin;
  S.lastPoint = pt;
  openSheet(head('Carregando…') + `<div class="sh-body" aria-busy="true">${SKELETON.repeat(2)}</div>`);
  let row = null;
  try {
    const rows = await restGet(path, ctrl.signal);
    row = Array.isArray(rows) ? rows[0] : null;
  } catch {
    row = undefined;
  }
  // Quem fechou a janela enquanto carregava não vê o detalhe abrir sozinho.
  if (ctrl.signal.aborted || !$('#ov').classList.contains('open')) return;
  if (!row) {
    const retry = row === undefined ? `<button class="btn btn-primary" type="button" data-point="${esc(pt.cnes)}"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo</button>` : '';
    openSheet(head('Não foi possível abrir') + `<div class="sh-body">${stateHTML('fa-plug-circle-xmark',
      row === undefined ? 'Não foi possível abrir este local agora' : 'Não encontramos este local',
      row === undefined ? 'Verifique sua internet e tente de novo.' : 'Ele pode ter mudado ou deixado de funcionar no cadastro oficial.', retry, true)}</div>`);
    return;
  }
  S.extra.set(id, G.pointToPlace(row, pt, origin));
  loadRatings(S.seq, [id]);
  openDetails(id);
}

/* ======================= abrir um local direto (?local=cnes:… ou imed:…) ======================= */
async function restGet(path, parent = null) {
  const t = linkedSignal(parent, 15000);
  try {
    const res = await fetch(`${CFG.supabaseUrl}/rest/v1/${path}`, { headers: authHeaders(), signal: t.signal });
    if (!res.ok) throw new Error(`banco ${res.status}`);
    return await res.json();
  } finally {
    t.done();
  }
}

async function fetchLocal(ref) {
  const paths = G.localPaths(ref);
  const [rows, partner] = await Promise.all([restGet(paths.main), paths.partner ? restGet(paths.partner).catch(() => []) : null]);
  const pid = Array.isArray(partner) ? partner[0]?.id : null;
  // Estabelecimento do CNES que virou parceiro: abre o parceiro.
  if (pid && G.isUuid(pid)) return fetchLocal({ source: 'imed', key: pid.toLowerCase() });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  return ref.source === 'cnes' ? G.establishmentToPlace(row) : G.clinicToPlace(row);
}

async function openLocal(ref) {
  S.phase = 'loading';
  render();
  let p = null;
  try { p = await fetchLocal(ref); } catch { p = undefined; }
  if (!p || !Number.isFinite(p.lat)) {
    S.phase = 'intro';
    render();
    setQMsg(p === undefined ? 'Não foi possível abrir este local agora. Verifique sua internet e tente de novo.'
      : p === null ? 'Não encontramos este local. Ele pode ter mudado ou deixado de funcionar. Digite um CEP, cidade ou endereço para buscar por perto.'
      : 'Não encontramos a localização deste local. Digite um CEP, cidade ou endereço para buscar por perto.', true);
    return;
  }
  // A busca começa no próprio local (arredondado, como qualquer busca) e o detalhe dele abre em seguida.
  S.pendingOpen = p;
  runSearch({ lat: G.roundCoord(p.lat), lng: G.roundCoord(p.lng) }, p.name, 'busca', 'endereco');
}

// Garante que o local pedido está na lista, mesmo que a busca em volta não o traga.
function includePending(origin) {
  const p = S.pendingOpen;
  const item = { ...p, distance_m: Math.round(G.haversine(origin, p)) };
  S.extra.set(p.id, item); // o detalhe abre mesmo que um filtro o tire da lista
  if (S.imed.some((x) => x.id === p.id) || S.base.some((x) => x.id === p.id)) return;
  if (p.source === 'imed') S.imed = [item, ...S.imed];
  else S.base = [{ ...item, injected: true }, ...S.base];
}

function openPending() {
  const p = S.pendingOpen;
  S.pendingOpen = null;
  if (!placeById(p.id)) return;
  moveMap(() => map.setView([p.lat, p.lng], 16));
  userMoved = true;
  openDetails(p.id);
}

function retryPlaces() {
  if (!S.origin) return;
  if (S.provider === 'google' && !S.fnDown) return runSearch(S.origin, S.originLabel, S.originKind, S.precision);
  const ctrl = S.ctrl ?? new AbortController();
  loadOsm(S.origin, S.fetchedRadius, ctrl.signal, S.seq);
}

const retrySearch = () => S.origin && runSearch(S.origin, S.originLabel, S.originKind, S.precision);

/* ======================= localização ======================= */
async function permissionState() {
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    return 'unknown';
  }
}

function locate() {
  if (!('geolocation' in navigator) || !window.isSecureContext) return geoFail('unsupported');
  const keep = S.phase === 'results';
  if (!keep) { S.phase = 'locating'; render(); }
  setQMsg('');
  $('#locBtn').setAttribute('aria-busy', 'true');
  navigator.geolocation.getCurrentPosition((pos) => {
    $('#locBtn').removeAttribute('aria-busy');
    // Só a posição arredondada segue adiante; a precisa não é guardada em lugar nenhum.
    const o = { lat: G.roundCoord(pos.coords.latitude), lng: G.roundCoord(pos.coords.longitude) };
    $('#q').value = '';
    runSearch(o, 'sua localização', 'gps');
  }, (err) => {
    $('#locBtn').removeAttribute('aria-busy');
    geoFail(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable');
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
}

const GEO_MSG = {
  denied: ['Você não liberou a localização', 'Tudo bem. Digite seu CEP, cidade ou endereço acima para ver o que tem por perto. Se quiser liberar depois, toque no cadeado ao lado do endereço do site e permita a localização.'],
  unavailable: ['Não conseguimos descobrir onde você está', 'Verifique se a localização do aparelho está ligada ou digite seu CEP, cidade ou endereço acima.'],
  timeout: ['A localização demorou para responder', 'Tente de novo em um lugar com sinal melhor ou digite seu CEP, cidade ou endereço acima.'],
  unsupported: ['Seu navegador não oferece localização', 'Digite seu CEP, cidade ou endereço acima para ver as clínicas por perto.'],
};

function geoFail(code) {
  if (S.phase === 'results') {
    setQMsg(`${GEO_MSG[code][0]}. ${GEO_MSG[code][1]}`);
    return;
  }
  S.phase = 'geo-error';
  S.geoError = code;
  render();
}

/* ======================= exame escrito na busca ======================= */
// Nomes de exames do dia a dia (exames-nomes.js): "ressonância em Campinas" liga o filtro do exame e procura só
// "Campinas"; "hemograma" sozinho liga o filtro e usa a área que já está na tela (ou a localização). Nome que serve
// para mais de um exame ("eco": ecocardiograma ou ultrassom) e doença sozinha ("dengue": exame ou atendimento) mostram
// as opções: o site não escolhe sozinho. Baixado quando a pessoa toca na caixa de busca.
let N = null, nomesP = null;
const loadNomes = () => (nomesP ||= import('./exames-nomes.js').then((m) => (N = m), () => { nomesP = null; return null; }));
// O nome como a pessoa escreveu (com uma letra errada, o nome certo).
const nomeEscrito = (a) => (a.erro ? a.nome : a.digitado);
// Exame de laboratório com nome ("hemograma", "HIV"), para o aviso da lista; grupo ("exame de sangue") não conta.
const nomeLab = (a) => (a.codigos[0] === 'lab' && a.tipo === 'e' ? nomeEscrito(a) : '');
const DICA_EM = (a) => `Para buscar em outra cidade, escreva “em” antes do nome dela, por exemplo “${a.digitado} em Campinas”.`;

// O que o texto ligou, para a pessoa conferir. O IMED não sabe quais exames cada local faz: exame de laboratório ou
// exame específico ("Doppler", "Angiotomografia") vem com "confirme se o local faz este exame". Doença ou substância
// ("hepatite", "colesterol") não é chamada de exame: a frase diz só o que foi buscado.
function exameMsg(a) {
  const k = a.codigos[0];
  if (k === 'lab') {
    return nomeLab(a) ? `Você buscou “${nomeLab(a)}”: a lista mostra os laboratórios. Confirme se o local faz este exame.`
      : `${a.tipo === 'n' ? 'Exames de laboratório' : a.nome}: a lista mostra os laboratórios. Confirme se o local faz o exame que você precisa.`;
  }
  const nota = a.erro ? ` (você escreveu “${a.digitado}”)` : a.tipo === 'a' ? ` (também chamado de ${N.minusculo(a.nome)})` : a.tipo === 'e' ? ` (${a.nome})` : '';
  return `Filtro de exame: ${G.EXAMS[k].n}${nota}.${a.tipo === 'e' ? ' Confirme se o local faz este exame.' : ''}`;
}
// Liga o filtro do exame ('' = todos os locais). nome: o exame de laboratório escrito ("hemograma"), para o aviso da lista.
function aplicarExame(codigo, nome = '') {
  S.exameNome = nome;
  if (S.f.exam === codigo) return render();
  if (S.phase === 'results') changeFilters(() => { S.f.exam = codigo; });
  else { S.f.exam = codigo; render(); }
}
// Texto só com o exame: a área que já está na tela ou, sem ela, a localização do aparelho.
function exameAqui(msg) {
  if (!S.origin) locate();
  setQMsg(msg, false, true);
}

// "eco", "dengue" ou mais de um exame escrito: botões com as opções. Com o lugar, a busca do lugar segue sem trocar o
// exame. O foco vai para a pergunta (não para a 1ª opção: dois Enter seguidos escolheriam sozinhos).
function mostrarEscolha(s, semLugar) {
  const box = $('#qEsc');
  const amb = s.achados.find((a) => a.codigos.length > 1);
  const doe = s.achados.find((a) => a.doenca);
  const titulo = doe ? `“${doe.digitado}”: você procura o exame ou atendimento?` : amb ? `“${N.minusculo(amb.nome)}” pode ser:` : 'Você escreveu mais de um exame. Qual buscar?';
  const opcoes = doe ? [['lab', 'Exame (laboratórios)'], ['todos', 'Atendimento (todos os locais)']] : s.exames.map((k) => [k, G.EXAMS[k].n]);
  box.innerHTML = `<p id="qEscT" tabindex="-1">${esc(titulo)}</p>`
    + `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${opcoes.map(([k, n]) => `<button class="pt-loc" style="margin-top:0;min-height:44px" type="button" data-exame="${esc(k)}">${esc(n)}</button>`).join('')}</div>`;
  box.setAttribute('aria-labelledby', 'qEscT');
  box.hidden = false;
  box._lugar = !semLugar;
  box._achado = doe || null;
  $('#qEscT').focus({ preventScroll: true });
  box.scrollIntoView({ block: 'nearest' });
}
function hideEscolha() { const box = $('#qEsc'); box.hidden = true; box.innerHTML = ''; }
// viaTeclado: o foco volta para a caixa de busca; no toque, vai para o aviso (o teclado do celular não reabre).
function escolherExame(k, viaTeclado) {
  const box = $('#qEsc');
  const comLugar = box._lugar, doe = box._achado;
  hideEscolha();
  const todos = k === 'todos';
  aplicarExame(todos ? '' : k, doe && k === 'lab' ? doe.digitado : '');
  const msg = todos ? 'Mostrando todos os locais, sem filtro de exame.'
    : doe && k === 'lab' ? `Você buscou “${doe.digitado}”: a lista mostra os laboratórios. Confirme se o local faz este exame.`
      : `Filtro de exame: ${G.EXAMS[k].n}.`;
  if (comLugar || S.origin) setQMsg(msg, false, true);
  else exameAqui(msg);
  if (viaTeclado) $('#q').focus({ preventScroll: true });
  else $('#qMsg').focus({ preventScroll: true });
}

/* ======================= busca por CEP, cidade ou endereço ======================= */
let geoCtrl = null, buscaSeq = 0;
function onSearchSubmit(e) {
  e.preventDefault();
  buscarTexto($('#q').value);
}
// comDicionario: separa o exame do lugar (a busca digitada); o lugar que veio da página inicial vai direto.
async function buscarTexto(texto, comDicionario = true) {
  const seq = ++buscaSeq;
  const raw = String(texto).replace(/\s+/g, ' ').trim();
  const btn = $('#goBtn');
  hideEscolha();
  // "Buscando…" desde o Enter, também enquanto o dicionário chega (no máximo 1 s; sem ele, o texto vai inteiro).
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  try {
    // O exame escrito junto ("ressonância em Campinas", "hemograma perto de mim"): liga o filtro e procura só o lugar.
    // CEP (só números) não passa pelo dicionário. Sem o dicionário (sem internet), o texto vai inteiro, como antes.
    let q = raw, ex = null, msg = '';
    if (comDicionario && raw.length >= 2 && /\p{L}/u.test(raw)) {
      if (!N) await Promise.race([loadNomes(), new Promise((r) => setTimeout(r, 1000))]);
      if (seq !== buscaSeq) return;
      const s = N?.separar(raw);
      if (s) { q = s.lugar; if (s.exames.length) ex = s; }
    }
    if (ex) {
      const a = ex.achados[0];
      if (ex.exames.length > 1 || a.doenca) mostrarEscolha(ex, !q);
      else {
        // O que ficou de fora sem ser lugar ("ultrassom Braço do Norte" sem o "em"): a área atual, com a dica.
        msg = exameMsg(a) + (!q && ex.sobra ? ` ${DICA_EM(a)}` : '');
        if (!q) { aplicarExame(ex.exames[0], nomeLab(a)); return exameAqui(msg); }
      }
      if (!q) return setQMsg('');
    }
    const digits = q.replace(/\D/g, '');
    const so1 = ex?.exames.length === 1 && !ex.achados[0].doenca;
    if (q.length < 3) { if (so1) aplicarExame(ex.exames[0], nomeLab(ex.achados[0])); return setQMsg('Digite um CEP, uma cidade ou um endereço.', true); }
    if (/^[\d\s.-]+$/.test(q) && digits.length !== 8) { if (so1) aplicarExame(ex.exames[0], nomeLab(ex.achados[0])); return setQMsg('O CEP tem 8 números, por exemplo 01310-100.', true); }
    setQMsg('');
    geoCtrl?.abort();
    geoCtrl = new AbortController();
    try {
      const g = await callFn({ action: 'geocode', q }, geoCtrl.signal, 15000);
      const o = { lat: G.roundCoord(g.lat), lng: G.roundCoord(g.lng) };
      const centro = g.precision === 'cidade' || g.precision === 'estado' ? `Mostrando a partir do centro de ${g.label}. Para resultados mais perto de você, use o CEP ou o endereço.` : '';
      if (msg || centro) setQMsg([msg, centro].filter(Boolean).join(' '), false, true);
      // O filtro do exame entra junto com a busca nova (sem buscar a área antiga de novo).
      if (so1) { S.exameNome = nomeLab(ex.achados[0]); S.f.exam = ex.exames[0]; }
      runSearch(o, g.label, 'busca', g.precision);
      // No celular, a lista sobe para a tela; com as opções de exame abertas ("eco"), elas ficam à vista.
      if (!desktop.matches && $('#qEsc').hidden) $('#count').scrollIntoView({ behavior: SMOOTH, block: 'start' });
    } catch (err) {
      if (err.name === 'AbortError') return;
      // O lugar não deu certo, mas o exame vale: o filtro liga na área que já está na tela.
      if (so1) aplicarExame(ex.exames[0], nomeLab(ex.achados[0]));
      if (err.code === 'not_found') setQMsg('Não encontramos esse endereço. Confira o CEP ou tente com cidade e bairro.', true);
      else if (err.status === 429) setQMsg('Muitas buscas seguidas. Espere um minuto e tente de novo.', true);
      else setQMsg('Não foi possível localizar o endereço agora. Verifique sua internet e tente de novo.', true);
    }
  } finally {
    if (seq === buscaSeq) { btn.disabled = false; btn.textContent = 'Buscar'; }
  }
}

function setQMsg(text, isError = false, info = false) {
  const el = $('#qMsg');
  el.hidden = !text;
  el.textContent = text;
  el.classList.toggle('info', !!info && !isError);
  if (text && isError) $('#q').focus({ preventScroll: true });
}

/* ======================= mapa ======================= */
let map, markersLayer, originLayer, ptsLayer, ptsRenderer, programmatic = false, programmaticTimer = 0, userMoved = false;
const markerById = new Map();
let markersKey = ''; // pinos desenhados agora (busca + ids): o mesmo conjunto não é refeito
let lastShown = []; // locais da lista na tela (para redesenhar o mapa ao aproximar ou afastar)
let listView = { shown: [], total: null }; // o que a lista mostra agora (para o "Ver mais")
let drawnFar = null; // o mapa estava afastado no último desenho?
let hotId = null; // local da lista sob o mouse (o pino ou o ponto dele fica em destaque)
let hotCnes = null;
const PIN = '<svg viewBox="0 0 32 42" aria-hidden="true"><path d="M16 40.5s12.5-13.6 12.5-23.6C28.5 9.6 22.9 4 16 4S3.5 9.6 3.5 16.9c0 10 12.5 23.6 12.5 23.6z"/></svg>';
// Cores dos pontos, as mesmas dos ícones de cada tipo (perto.css, .k-*).
const KIND_COLOR = { imagem: '#0E7C9C', laboratorio: '#6C4BD8', clinica: '#1E9E5A', hospital: '#E8512F' };
const KIND_SHORT = { imagem: 'Imagem', laboratorio: 'Laboratório', clinica: 'Clínica', hospital: 'Hospital' };

function initMap() {
  map = L.map('map', { zoomControl: false, minZoom: 4, maxZoom: CFG.map.maxZoom }).setView([-15.8, -47.9], 4);
  L.control.zoom({ position: 'topright', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  // Fundo: mapa desenhado por padrão (a busca mostra até 50 km) e, com a chave da Esri, a opção "Satélite".
  fundoDoMapa(L, map, { padrao: 'mapa', posicao: 'topright' });
  originLayer = L.layerGroup().addTo(map);
  // "Você está aqui" fica acima dos pinos (que ficam a 600), para não sumir embaixo deles.
  map.createPane('me').style.zIndex = '620';
  // Pontos da área inteira: milhares de círculos desenhados num único canvas (leve até no celular),
  // acima do círculo da busca e abaixo dos pinos da lista.
  map.createPane('pts').style.zIndex = '450';
  ptsRenderer = L.canvas({ pane: 'pts', padding: 0.2, tolerance: L.Browser.mobile ? 8 : 4 });
  ptsLayer = L.featureGroup().addTo(map);
  ptsLayer.on('click', (e) => { if (e.layer?.pt) openPoint(e.layer.pt); });
  markersLayer = L.layerGroup().addTo(map);
  map.on('dragstart', () => { userMoved = true; });
  map.on('zoomstart', () => { if (!programmatic) userMoved = true; });
  map.on('moveend', onMapMove);
  map.on('moveend resize', trackView);
  map.on('zoomend', onZoom);
  onZoom();
}

// Com o mapa afastado (a área inteira), o cadastro oficial fica só como ponto (dezenas de pinos
// empilhados no centro escondiam o "Você está aqui") e os outros pinos ficam menores. Ao aproximar,
// os primeiros da lista voltam a ter pino; os pontos crescem um pouco.
function onZoom() {
  const far = map.getZoom() < FAR_ZOOM;
  const el = $('#map');
  el.classList.toggle('z-far', far);
  el.dataset.zoom = String(map.getZoom());
  resizePoints();
  if (drawnFar !== null && far !== drawnFar) drawMap(lastShown);
}

// Tamanho da área visível no mapa (menor lado, em metros) e zoom. Ficam no contêiner para conferência (testes).
function trackView() {
  const b = map.getBounds();
  const c = map.getCenter();
  const w = map.distance([c.lat, b.getWest()], [c.lat, b.getEast()]);
  const h = map.distance([b.getSouth(), c.lng], [b.getNorth(), c.lng]);
  const el = $('#map');
  el.dataset.viewM = String(Math.round(Math.min(w, h)));
  el.dataset.zoom = String(map.getZoom());
}

function moveMap(fn) {
  programmatic = true;
  clearTimeout(programmaticTimer);
  programmaticTimer = setTimeout(() => { programmatic = false; }, 900);
  fn();
}

function pinIcon(p) {
  const cls = `mk k-${p.kind}${p.source === 'imed' ? ' mk-imed' : ''}${p.id === S.selected ? ' on' : ''}`;
  return L.divIcon({ className: 'mk-wrap', iconSize: [32, 42], iconAnchor: [16, 41], html: `<span class="${cls}">${PIN}<i class="fa-solid ${G.KINDS[p.kind].icon}" aria-hidden="true"></i></span>` });
}

function drawMarkers(list) {
  const key = `${S.seq}|${list.map((p) => p.id).join(',')}`;
  if (key === markersKey) return; // os mesmos pinos: nada a refazer (o selecionado é marcado em setSelected)
  markersKey = key;
  const hot = hotId;
  setHot(null);
  markersLayer.clearLayers();
  markerById.clear();
  for (const p of list) {
    const m = L.marker([p.lat, p.lng], {
      icon: pinIcon(p), title: `${p.name} · ${G.formatDistance(p.distance_m)}`, alt: p.name, keyboard: true,
      riseOnHover: true, zIndexOffset: p.id === S.selected ? 1000 : p.source === 'imed' ? 500 : 0,
    });
    m.on('click', () => openDetails(p.id));
    m.addTo(markersLayer);
    markerById.set(p.id, m);
  }
  $('#map').dataset.pins = String(list.length);
  setHot(hot);
}

function drawOrigin() {
  originLayer.clearLayers();
  if (!S.origin) return;
  const gps = S.originKind === 'gps';
  L.circle([S.origin.lat, S.origin.lng], { radius: S.f.radius, color: '#0E7C9C', weight: 1.5, opacity: 0.5, fillColor: '#2EE6D6', fillOpacity: 0.06, interactive: false }).addTo(originLayer);
  L.marker([S.origin.lat, S.origin.lng], {
    icon: L.divIcon({ className: 'mk-wrap', iconSize: [20, 20], iconAnchor: [10, 10], html: `<span class="me${gps ? '' : ' pin'}"></span>` }),
    keyboard: false, pane: 'me',
  }).bindTooltip(gps ? 'Você está aqui (aproximado)' : 'Ponto da busca', { direction: 'top', className: 'me-tip', offset: [0, -10] }).addTo(originLayer);
}

// Pinos e pontos do mapa para os locais da lista. Parceiros e locais do mapa público (OpenStreetMap,
// Google) têm sempre pino: eles não têm ponto. Do cadastro oficial, com o mapa afastado, quem tem ponto
// fica só como ponto; perto, os 100 primeiros da lista ganham pino. Ninguém da lista some do mapa.
function drawMap(shown) {
  lastShown = shown;
  const far = (drawnFar = map.getZoom() < FAR_ZOOM);
  syncPoints();
  let n = 0;
  const pins = shown.filter((p) => {
    if (p.source !== 'cnes') return true;
    if (far && ptsView.byCnes.has(p.id.slice(5))) return false;
    return n++ < PIN_LIMIT;
  });
  drawMarkers(pins);
  renderMapKey(placePoints(new Set(pins.filter((p) => p.source === 'cnes').map((p) => p.id.slice(5)))));
}

// Pontos de toda a área (cadastro oficial). Quem já tem pino não ganha ponto embaixo. Com filtro que só
// os parceiros atendem (preço, convênio, "Parceiros verificados"), não há pontos: ninguém ali passa no filtro.
const NO_POINTS = [];
const ptsView = { rows: NO_POINTS, byCnes: new Map(), radius: 0, pinned: null, drawn: 0 };
const pointRadius = () => { const z = map.getZoom(); return z >= 16 ? 6 : z >= 14 ? 5 : z >= 12 ? 4 : 3; };
const pointsShown = () => S.phase === 'results' && S.pts.key === areaKey() && !G.onlyPartnerFilter(S.f);
// O total da área só vale com a cidade inteira no banco: enquanto ela é importada, o número ainda cresce.
const totalKnown = () => S.coverage?.status !== 'loading';

// Cria os círculos quando muda o conjunto de pontos (consulta nova, ou o filtro de parceiros ligou/desligou).
function syncPoints() {
  const rows = pointsShown() && S.pts.state === 'ok' ? S.pts.rows : NO_POINTS;
  if (ptsView.rows === rows) return;
  ptsLayer.clearLayers();
  ptsView.byCnes = new Map();
  ptsView.rows = rows;
  ptsView.pinned = null;
  const radius = (ptsView.radius = pointRadius());
  for (const pt of rows) {
    const m = L.circleMarker([pt.lat, pt.lng], {
      renderer: ptsRenderer, radius, color: '#fff', weight: 1, opacity: 0.95,
      fillColor: KIND_COLOR[pt.kind] ?? KIND_COLOR.clinica, fillOpacity: 0.9,
    });
    m.pt = pt;
    ptsView.byCnes.set(pt.cnes, m);
  }
}

// Põe no mapa os pontos de quem não tem pino. O mesmo conjunto de pinos não percorre os pontos de novo.
function placePoints(pinned) {
  const key = [...pinned].sort().join(',');
  if (ptsView.pinned === key) return ptsView.drawn;
  ptsView.pinned = key;
  let drawn = 0;
  for (const [cnes, m] of ptsView.byCnes) {
    const on = ptsLayer.hasLayer(m);
    if (pinned.has(cnes)) { if (on) ptsLayer.removeLayer(m); }
    else { if (!on) ptsLayer.addLayer(m); drawn += 1; }
  }
  ptsView.drawn = drawn;
  if (S.selected?.startsWith('cnes:')) stylePoint(S.selected.slice(5));
  if (hotCnes) stylePoint(hotCnes);
  const el = $('#map');
  el.dataset.points = String(ptsView.rows.length);
  el.dataset.pointsDrawn = String(drawn);
  return drawn;
}

// Ponto em destaque (contorno escuro e maior): o local selecionado ou o cartão sob o mouse.
const pointMarked = (cnes) => cnes === hotCnes || S.selected === `cnes:${cnes}`;
function stylePoint(cnes) {
  const m = ptsView.byCnes.get(cnes);
  if (!m) return;
  const on = pointMarked(cnes);
  m.setStyle(on ? { color: '#05161e', weight: 2.5, radius: ptsView.radius + 3 } : { color: '#fff', weight: 1, radius: ptsView.radius });
  if (on && ptsLayer.hasLayer(m)) m.bringToFront();
}

// Cartão sob o mouse: destaca o pino ou, se ele estiver só como ponto, o ponto.
function setHot(id) {
  if (id === hotId) return;
  $$('.mk.hot').forEach((x) => x.classList.remove('hot', 'on'));
  const prev = hotCnes;
  hotId = id;
  hotCnes = null;
  if (prev) stylePoint(prev);
  if (!id || id === S.selected) return;
  const m = markerById.get(id);
  if (m) m.getElement()?.querySelector('.mk')?.classList.add('hot', 'on');
  else if (id.startsWith('cnes:') && ptsView.byCnes.has(id.slice(5))) { hotCnes = id.slice(5); stylePoint(hotCnes); }
}

// Pontos um pouco maiores quando o mapa está mais perto.
function resizePoints() {
  const r = pointRadius();
  if (r === ptsView.radius) return;
  ptsView.radius = r;
  for (const [cnes, m] of ptsView.byCnes) m.setRadius(pointMarked(cnes) ? r + 3 : r);
}

// Legenda das cores dos pontos (ou o aviso de que não carregaram, com "Tentar de novo").
function renderMapKey(drawn) {
  const el = $('#mapKey');
  const pts = S.pts;
  const mine = pointsShown();
  if (mine && pts.state === 'error') {
    el.hidden = false;
    el.classList.add('err');
    setHTML(el, '<span>Os pontos da área não carregaram.</span><button type="button" data-act="points-retry">Tentar de novo</button>');
    return;
  }
  el.classList.remove('err');
  if (!mine || pts.state !== 'ok' || !drawn) { el.hidden = true; setHTML(el, ''); return; }
  const cap = totalKnown() && pts.total != null && pts.total > pts.rows.length
    ? `<small>${G.formatCount(pts.rows.length)} de ${G.formatCount(pts.total)} no mapa</small>` : '';
  el.hidden = false;
  setHTML(el, `<b>Cadastro oficial</b>${pts.kinds.map((k) => `<span><i class="dot k-${k}" aria-hidden="true"></i>${KIND_SHORT[k]}</span>`).join('')}${cap}`);
}

// Mostra a área inteira da busca (o círculo do raio), a não ser que a pessoa já tenha mexido no mapa.
function fitMap() {
  if (!S.origin || userMoved) return;
  moveMap(() => map.fitBounds(L.latLng(S.origin.lat, S.origin.lng).toBounds(S.f.radius * 2), { padding: [8, 8] }));
}

function setSelected(id) {
  const prev = S.selected;
  S.selected = id;
  for (const pid of [prev, id]) {
    if (!pid) continue;
    const m = markerById.get(pid);
    m?.getElement()?.querySelector('.mk')?.classList.toggle('on', pid === id);
    m?.setZIndexOffset(pid === id ? 1000 : pid.startsWith('imed:') ? 500 : 0);
    if (pid.startsWith('cnes:')) stylePoint(pid.slice(5)); // só como ponto (mapa afastado): o ponto fica em destaque
  }
  $$('.pc.on').forEach((c) => c.classList.remove('on'));
  if (id) $(`.pc[data-id="${CSS.escape(id)}"]`)?.classList.add('on');
}

function onMapMove() {
  if (programmatic) { programmatic = false; return; }
  if (!S.origin || S.phase !== 'results' || !userMoved) return;
  const c = map.getCenter();
  const far = G.haversine(S.origin, { lat: c.lat, lng: c.lng }) > Math.max(400, S.f.radius * 0.3);
  // Com mais estabelecimentos do que pontos no mapa, aproximar bastante também oferece buscar ali.
  const capped = pointsShown() && S.pts.state === 'ok' && S.pts.total != null && S.pts.total > S.pts.rows.length;
  const closer = capped && map.getZoom() >= map.getBoundsZoom(L.latLng(S.origin.lat, S.origin.lng).toBounds(S.f.radius * 2)) + 2;
  $('#areaBtn').classList.toggle('hide', !(far || closer));
}

function hideAreaBtn() { $('#areaBtn').classList.add('hide'); }

// Busca em volta do centro do mapa, com a maior distância que cabe na tela. (O mapa abre mostrando o
// círculo inteiro com folga; escolher a distância seguinte aumentava o raio a cada "Buscar nesta área".)
function searchMapArea() {
  const c = map.getCenter();
  const b = map.getBounds();
  const half = Math.min(map.distance(c, [b.getNorth(), c.lng]), map.distance(c, [c.lat, b.getEast()]));
  S.f.radius = [...G.RADII].reverse().find((r) => r <= half) ?? G.RADII[0];
  $('#q').value = '';
  setQMsg('');
  runSearch({ lat: G.roundCoord(c.lat), lng: G.roundCoord(c.lng) }, 'centro do mapa', 'mapa');
}

function setMapView(on) {
  document.body.classList.toggle('show-map', on);
  const t = $('#viewToggle');
  t.setAttribute('aria-pressed', String(on));
  t.innerHTML = on ? '<i class="fa-solid fa-list" aria-hidden="true"></i><span>Ver lista</span>' : '<i class="fa-solid fa-map" aria-hidden="true"></i><span>Ver mapa</span>';
  if (on) setTimeout(() => map.invalidateSize(), 60);
}

/* ======================= lista ======================= */
// Parceiros IMED primeiro na junção: o mesmo lugar no cadastro oficial ou no mapa não aparece duas vezes.
const allPlaces = () => G.mergePlaces(G.mergePlaces(S.imed, cnesRows()), S.places);
function placeById(id) {
  const rows = S.lists.get(areaKey())?.rows ?? [];
  for (const list of [S.imed, S.base, rows, S.places]) {
    const p = list.find((x) => x.id === id);
    if (p) return p;
  }
  return S.extra.get(id) ?? null;
}
const SOURCE_LABEL = { osm: 'OpenStreetMap', google: 'Google Maps' };
const distanceText = (p) => `${p.approx ? '~' : ''}${G.formatDistance(p.distance_m)}`;
const allFailed = () => S.imedState === 'error' && S.cnesState !== 'ok' && S.placesState === 'error';

function badgesHTML(p) {
  const b = [];
  if (p.source === 'imed') {
    if (p.is_demo) b.push('<span class="bd bd-demo">Demonstração</span>');
    else b.push('<span class="bd bd-imed" title="Preço e agenda confirmados pela clínica"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>Parceiro verificado</span>');
    if (hasSchedule(p)) b.push('<span class="bd bd-agenda"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i>Agenda online</span>');
    else if (p.accepts_online_booking) b.push('<span class="bd bd-ok">Agenda pelo IMED</span>');
  } else if (p.source === 'cnes') {
    b.push('<span class="bd bd-cnes"><i class="fa-solid fa-building-circle-check" aria-hidden="true"></i>Cadastro oficial</span>');
    if (p.hours?.[0] === 'Aberto 24 horas') b.push('<span class="bd bd-ok">24 horas</span>');
    if (p.sus) b.push('<span class="bd bd-sus">Atende SUS</span>');
  } else {
    b.push(`<span class="bd">${SOURCE_LABEL[p.source] ?? 'Mapa'}</span>`);
  }
  return b.join('');
}

// Exame de laboratório escrito na busca ("hemograma"): o preço que a clínica informa é um só para o laboratório, não o
// desse exame. Para não parecer o preço do exame, a lista não o mostra.
const semPrecoLab = () => S.f.exam === 'lab' && !!S.exameNome;
function priceHTML(p) {
  if (p.source !== 'imed') return '';
  if (semPrecoLab()) return '<span class="pc-price muted">Preço do exame sob consulta</span>';
  const v = S.f.exam ? G.priceFor(p, S.f.exam) : G.minPrice(p);
  if (v == null) return '<span class="pc-price muted">Preço sob consulta</span>';
  return `<span class="pc-price">${S.f.exam ? `${esc(G.EXAMS[S.f.exam].n)}: ` : 'a partir de '}${G.formatPrice(v)}</span>`;
}

function ratingHTML(p, cls = 'pc-rate') {
  const r = S.ratings.get(p.id);
  if (!r) return '';
  const label = `Nota ${G.formatRating(r.rating)} de 5, ${plural(r.reviews, 'avaliação', 'avaliações')}`;
  return `<span class="${cls}" role="img" aria-label="${label}"><i class="fa-solid fa-star" aria-hidden="true"></i>${G.formatRating(r.rating)} <small>(${r.reviews})</small></span>`;
}

function contactLinksHTML(p) {
  const out = [];
  const tel = p.phone && G.telHref(p.phone);
  if (tel) out.push(`<a href="${esc(tel)}"><i class="fa-solid fa-phone" aria-hidden="true"></i>${esc(p.phone)}</a>`);
  if (p.whatsapp) out.push(`<a class="wa" href="${esc(G.whatsappHref(p.whatsapp))}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>WhatsApp</a>`);
  if (!tel && p.website) out.push(`<a href="${esc(p.website)}" target="_blank" rel="noopener nofollow"><i class="fa-solid fa-globe" aria-hidden="true"></i>Site</a>`);
  return out.length ? `<div class="pc-contact">${out.join('')}</div>` : '';
}

// Texto que o leitor de tela anuncia no cartão: nome, distância, selos, nota e preço (só o que existe).
function cardLabel(p) {
  const parts = [p.name, distanceText(p)];
  if (p.source === 'imed') {
    parts.push(p.is_demo ? 'Demonstração' : 'Parceiro verificado');
    if (hasSchedule(p)) parts.push('Agenda online');
    else if (p.accepts_online_booking) parts.push('Agenda pelo IMED');
  } else if (p.source === 'cnes') {
    parts.push('Cadastro oficial');
    if (p.hours?.[0] === 'Aberto 24 horas') parts.push('24 horas');
    if (p.sus) parts.push('Atende SUS');
    const eq = G.equipNote(withEquip(p), S.f.exam);
    if (eq) parts.push(eq);
  }
  const r = S.ratings.get(p.id);
  if (r) parts.push(`Nota ${G.formatRating(r.rating)} de 5, ${plural(r.reviews, 'avaliação', 'avaliações')}`);
  if (p.source === 'imed') {
    const v = S.f.exam ? G.priceFor(p, S.f.exam) : G.minPrice(p);
    parts.push(semPrecoLab() ? 'Preço do exame sob consulta' : v == null ? 'Preço sob consulta' : `${S.f.exam ? `${G.EXAMS[S.f.exam].n}: ` : 'a partir de '}${G.formatPrice(v)}`);
  }
  return `${parts.join(', ')}. Ver detalhes`;
}
// Resumo do cartão para o leitor de tela, sem o nome (o nome é o próprio botão): vira a descrição do botão.
const cardSummary = (p) => cardLabel(p).slice(p.name.length + 2);
const cardDomId = (p) => `pcd-${String(p.id).replace(/[^a-z0-9]/gi, '-')}`;

function cardHTML(p) {
  const k = G.KINDS[p.kind];
  const svc = p.services.slice(0, 4).map((c) => `<span class="svc">${esc(G.EXAMS[c]?.n ?? c)}</span>`).join('')
    + (p.services.length > 4 ? `<span class="svc more">+${p.services.length - 4}</span>` : '');
  // O cartão inteiro abre a ficha com o mouse (clique em #list); pelo teclado e leitor de tela, é o botão do
  // título (um botão de verdade, sem links dentro dele). Telefone e WhatsApp continuam links separados.
  const did = cardDomId(p);
  return `<article class="pc${p.source === 'imed' ? ' imed' : ''}${p.id === S.selected ? ' on' : ''}" data-id="${esc(p.id)}">
    <span class="pc-ic k-${p.kind}" aria-hidden="true"><i class="fa-solid ${k.icon}"></i></span>
    <div class="pc-main">
      <div class="pc-badges">${badgesHTML(p)}</div>
      <h3><button class="pc-open" type="button" data-id="${esc(p.id)}" aria-describedby="${did}">${esc(p.name)}</button></h3>
      <span id="${did}" hidden>${esc(cardSummary(p))}</span>
      <p class="pc-addr">${esc(p.address || 'Endereço não informado no mapa')}</p>
      ${svc ? `<div class="pc-svc">${svc}</div>` : ''}
      ${equipLineHTML(p)}
      <div class="pc-meta"><span class="pc-dist"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>${distanceText(p)}</span><span>${k.n}</span>${ratingHTML(p)}${priceHTML(p)}${p.source === 'cnes' && p.hours ? `<span>${esc(p.hours[0])}</span>` : ''}</div>
      ${contactLinksHTML(p)}
    </div>
    <i class="fa-solid fa-chevron-right pc-go" aria-hidden="true"></i>
  </article>`;
}

const SKELETON = '<div class="sk" aria-hidden="true"><i></i><div><b></b><span></span><span></span></div></div>';

function stateHTML(icon, title, text, actions = '', warn = false, extra = '') {
  return `<div class="st"><div class="ic${warn ? ' warn' : ''}"><i class="fa-solid ${icon}" aria-hidden="true"></i></div><h2>${title}</h2><p>${text}</p>${extra}${actions ? `<div class="acts">${actions}</div>` : ''}</div>`;
}

const BTN_LOCATE = '<button class="btn btn-coral" type="button" data-act="locate"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i>Usar minha localização</button>';
const BTN_TYPE = '<button class="btn btn-ghost" type="button" data-act="type">Digitar endereço</button>';

function introHTML() {
  const demo = S.demo ? '<button class="btn btn-ghost" type="button" data-act="demo-sp">Testar na Av. Paulista</button>' : '';
  const max = G.RADII[G.RADII.length - 1];
  return stateHTML('fa-location-crosshairs', 'Veja o que tem perto de você',
    'Para mostrar distâncias reais, o IMED pede permissão para usar a localização do seu aparelho. Se preferir, digite seu CEP, cidade ou endereço.',
    BTN_LOCATE + BTN_TYPE + demo, false,
    `<p class="st-area"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i><span>Mostramos clínicas, laboratórios e hospitais em até ${kmLabel(G.DEFAULT_FILTERS.radius)}; você pode aumentar para até ${kmLabel(max)}.</span></p>
    <ul>
      <li><i class="fa-solid fa-check" aria-hidden="true"></i>Usada só para esta busca, de forma aproximada — nunca guardamos sua posição exata.</li>
      <li><i class="fa-solid fa-check" aria-hidden="true"></i>Não guardamos sua localização no aparelho nem no banco.</li>
      <li><i class="fa-solid fa-check" aria-hidden="true"></i>Você pode revogar a permissão quando quiser no navegador.</li>
    </ul><p class="src"><a class="link" href="privacidade.html">Como tratamos seus dados</a></p>`);
}

const countWord = (n) => `${G.formatCount(n)} ${n === 1 ? 'estabelecimento' : 'estabelecimentos'}`;

// Total real de estabelecimentos na área com os filtros: o cadastro oficial contado pelo banco (já com
// tipo, exame e SUS) mais os parceiros na tela. null: não dá para saber pelo banco (mapa público
// misturado, especialidade, que o banco não filtra, ou cidade ainda sendo importada); undefined: contando.
function areaTotal(shown) {
  if (S.phase !== 'results' || S.places.length || S.placesState === 'loading' || S.f.specialty) return null;
  const others = shown.filter((p) => p.source !== 'cnes').length;
  if (G.onlyPartnerFilter(S.f)) return others;
  if (!totalKnown()) return null;
  const t = S.totals.get(areaKey());
  return t == null ? undefined : t + others;
}

// Quantos há na área sem os filtros (para o aviso "Nada com esses filtros"). Sem o total do banco: null.
function regionTotal() {
  if (S.places.length || !totalKnown()) return null;
  const t = S.totals.get(G.areaKey({ ...S.f, kind: '', exam: '', sus: false }));
  return t == null ? null : t + S.imed.filter((p) => p.distance_m <= S.f.radius).length;
}

const areaBusy = () => S.phase === 'results' && (S.pts.state === 'loading' || listFor().state === 'loading');

function emptyHTML() {
  if (S.placesState === 'loading') return '';
  const next = G.RADII.find((r) => r > S.f.radius);
  if (G.activeFilterCount(S.f)) {
    const priceNote = S.f.price ? '<p class="src">Preços só aparecem para clínicas parceiras que informaram valores ao IMED. Nenhum valor é estimado.</p>' : '';
    const n = regionTotal();
    const text = n ? `Há ${countWord(n)} em até ${kmLabel(S.f.radius)}, mas nenhum combina com os filtros escolhidos.`
      : `Nenhum estabelecimento em até ${kmLabel(S.f.radius)} combina com os filtros escolhidos.`;
    const wider = next && !G.onlyPartnerFilter(S.f) ? `<button class="btn btn-ghost" type="button" data-act="radius" data-radius="${next}">Buscar em até ${kmLabel(next)}</button>` : '';
    if (G.IMAGING_EXAMS.includes(S.f.exam) && !G.onlyPartnerFilter(S.f) && S.origin) {
      loadNear(S.seq);
      const nome = G.APARELHO[S.f.exam];
      return stateHTML('fa-x-ray', 'Nenhum local com esse exame aqui',
        `Nenhum local em até ${kmLabel(S.f.radius)} informou aparelho ${esc(nome)} ao cadastro oficial nem tem o exame no nome.`,
        '<button class="btn btn-primary" type="button" data-act="clear">Limpar filtros</button>' + wider, false, nearHTML());
    }
    return stateHTML('fa-filter', 'Nada com esses filtros', text,
      '<button class="btn btn-primary" type="button" data-act="clear">Limpar filtros</button>' + wider, false, priceNote);
  }
  return stateHTML('fa-map-location-dot', `Nenhum estabelecimento em até ${kmLabel(S.f.radius)}`,
    'Não encontramos clínicas, laboratórios ou centros de diagnóstico mapeados nesta distância.',
    (next ? `<button class="btn btn-primary" type="button" data-act="radius" data-radius="${next}">Buscar em até ${kmLabel(next)}</button>` : '') + BTN_TYPE);
}

// Fim da lista: "Ver mais 50 (de N)", carregando, ou "Tentar de novo" quando a busca no banco falhou.
// É sempre o mesmo botão (data-act="more"); carregando, ele fica aria-disabled em vez de disabled, para o
// foco continuar nele (patchPager só troca o texto e os atributos).
function pagerHTML(shownCount, total) {
  if (S.phase !== 'results' || G.onlyPartnerFilter(S.f)) return '';
  const l = listFor();
  if (l.state === 'loading') {
    return shownCount ? `<div class="pt-pager"><p class="pt-pager-busy" role="status"><span class="spin" aria-hidden="true"></span>Buscando em toda a área de até ${kmLabel(S.f.radius)}…</p></div>` : '';
  }
  const btn = (icon, label, attrs = '') => `<button class="btn btn-ghost" type="button" data-act="more"${attrs}>${icon}${label}</button>`;
  const RETRY = '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>';
  if (l.state === 'error') {
    return `<div class="pt-pager"><p class="pt-pager-msg">Não conseguimos buscar na área inteira agora. A lista mostra só os locais já carregados.</p>${btn(RETRY, 'Tentar de novo')}</div>`;
  }
  if (l.more === 'error') {
    return `<div class="pt-pager"><p class="pt-pager-msg">Não foi possível carregar mais agora. Verifique sua internet.</p>${btn(RETRY, 'Tentar de novo')}</div>`;
  }
  const known = typeof total === 'number';
  const shownText = known ? `<p class="pt-pager-info">Mostrando ${G.formatCount(shownCount)} de ${G.formatCount(total)}</p>` : '';
  if (l.more === 'loading') {
    return `<div class="pt-pager">${shownText}${btn('<span class="spin" aria-hidden="true"></span>', 'Carregando mais…', ' aria-disabled="true" aria-busy="true"')}</div>`;
  }
  const st = pagerOf(l);
  if (!st.more) return ''; // todos já estão na lista
  return `<div class="pt-pager">${shownText}${btn('<i class="fa-solid fa-angles-down" aria-hidden="true"></i>', G.moreLabel(st.next, known ? total : null))}</div>`;
}

function bannersHTML() {
  const b = [];
  if (S.demo) b.push('<div class="bn demo"><i class="fa-solid fa-flask" aria-hidden="true"></i><span>Modo demonstração: inclui as clínicas fictícias do IMED em São Paulo, sem preço e sem horário. <a class="link" href="perto.html">Sair</a></span></div>');
  if (S.phase !== 'results') return b.join('');
  const failed = allFailed();
  if (S.coverage?.status === 'loading') {
    const city = S.coverage.city ? ` de ${esc(S.coverage.city)}` : ' desta cidade';
    b.push(`<div class="bn"><span class="spin" aria-hidden="true"></span><span>Estamos trazendo o cadastro oficial de clínicas${city} (Ministério da Saúde). Enquanto isso, mostramos o mapa público. A lista se completa sozinha em instantes.</span></div>`);
  }
  if (!failed && S.imedState === 'error') b.push('<div class="bn warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>Não conseguimos carregar as clínicas parceiras do IMED agora.<button type="button" data-act="retry">Tentar de novo</button></span></div>');
  if (!failed && S.cnesState === 'error') b.push('<div class="bn warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>O cadastro oficial de clínicas não respondeu agora.<button type="button" data-act="retry">Tentar de novo</button></span></div>');
  if (!failed && S.placesState === 'error') b.push(`<div class="bn warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>Os estabelecimentos do mapa (${S.provider === 'google' && !S.fnDown ? 'Google Maps' : 'OpenStreetMap'}) não carregaram agora.<button type="button" data-act="retry-places">Tentar de novo</button></span></div>`);
  if (S.truncated) b.push('<div class="bn"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>O mapa público tem muitos locais nesta região e mostramos só parte deles. Diminua a distância para ver os mais próximos.</span></div>');
  const p = S.pts;
  if (!failed && pointsShown() && totalKnown() && p.state === 'ok' && p.total != null && p.total > p.rows.length) {
    b.push(`<div class="bn" id="ptsCap"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i><span>O mapa mostra os ${G.formatCount(p.rows.length)} mais próximos. Aproxime o mapa e toque em "Buscar nesta área" para ver outros.</span></div>`);
  }
  return b.join('');
}

function countHTML(shown, total) {
  if (S.phase !== 'results' || allFailed()) return '';
  const nImed = shown.filter((p) => p.source === 'imed' && !p.is_demo).length;
  const nDemo = shown.filter((p) => p.source === 'imed' && p.is_demo).length;
  const where = S.originKind === 'gps' ? 'da sua localização (aproximada)'
    : S.originKind === 'mapa' ? 'do centro do mapa' : `de <b>${esc(S.originLabel)}</b>`;
  const km = kmLabel(S.f.radius);
  let head;
  if (typeof total === 'number') head = `<b>${countWord(total)}</b> em até ${km} ${where}`;
  else if (total === undefined && areaBusy()) head = `Contando os estabelecimentos em até ${km} ${where}…`;
  else head = `<b>${plural(shown.length, 'resultado', 'resultados')}</b>${S.f.specialty ? ' entre os locais já carregados,' : ''} em até ${km} ${where}`;
  return head
    + (nImed ? ` · ${plural(nImed, 'parceiro verificado', 'parceiros verificados')}` : '')
    + (nDemo ? ` · ${nDemo} de demonstração` : '');
}

// Faixa de preço do exame escolhido, só com valores informados pelas clínicas parceiras.
// Usa só raio e exame: filtros como "Atende SUS" tiram os parceiros da lista, mas não apagam os preços da região.
function priceBandHTML(all) {
  if (S.phase !== 'results' || !S.f.exam || !Object.hasOwn(G.EXAMS, S.f.exam) || allFailed()) return '';
  if (semPrecoLab()) return '<p class="pt-band none"><i class="fa-solid fa-tag" aria-hidden="true"></i><span>O preço de cada exame de laboratório não está no IMED: confirme com o laboratório.</span></p>';
  const name = G.EXAMS[S.f.exam].n;
  const r = G.priceRange(G.filterPlaces(all, { ...G.DEFAULT_FILTERS, radius: S.f.radius, exam: S.f.exam }), S.f.exam);
  if (!r) {
    return `<p class="pt-band none"><i class="fa-solid fa-tag" aria-hidden="true"></i><span>Nenhuma clínica informou o preço de ${esc(name)} por aqui ainda. Os valores aparecem quando as clínicas parceiras informam.</span></p>`;
  }
  const range = r.min === r.max ? `${G.formatPrice(r.min)}` : `de ${G.formatPrice(r.min)} a ${G.formatPrice(r.max)}`;
  return `<p class="pt-band"><i class="fa-solid fa-tag" aria-hidden="true"></i><span><b>${esc(name)}</b> perto de você: <b>${range}</b> em ${plural(r.count, 'clínica que informou', 'clínicas que informaram')} o preço.</span></p>`;
}

function renderFilters(all) {
  const ids = { kind: 'fKind', exam: 'fExam', specialty: 'fSpec', radius: 'fDist', price: 'fPrice', sort: 'fSort' };
  const specs = G.specialtyOptions(all);
  if (S.f.specialty && !specs.includes(S.f.specialty)) specs.unshift(S.f.specialty);
  $('#fSpec').innerHTML = '<option value="">Especialidade</option>' + specs.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  for (const [key, id] of Object.entries(ids)) {
    const el = $(`#${id}`);
    el.value = String(S.f[key]);
    el.parentElement.classList.toggle('on', String(S.f[key]) !== String(G.DEFAULT_FILTERS[key]));
  }
  $('#fImed').setAttribute('aria-pressed', String(S.f.onlyImed));
  $('#fSus').setAttribute('aria-pressed', String(S.f.sus));
  // Sem parceiro na área, "Parceiros verificados" sempre daria vazio; sem preço informado por algum parceiro,
  // o filtro de preço e "Menor preço" também. Ficam escondidos (como Convênio e Melhor avaliados), a não ser
  // que estejam em uso: assim dá para desligar.
  const partner = all.some((p) => p.source === 'imed');
  const priced = all.some((p) => p.source === 'imed' && G.minPrice(p) != null);
  $('#fImed').classList.toggle('hide', !partner && !S.f.onlyImed);
  $('#fPriceWrap').classList.toggle('hide', !priced && !S.f.price);
  const byPrice = $('#fSort option[value="price"]');
  byPrice.hidden = byPrice.disabled = !priced && S.f.sort !== 'price';
  // Convênios: só os informados pelos parceiros encontrados.
  const ins = G.insuranceOptions(all);
  if (S.f.insurance && !ins.includes(S.f.insurance)) ins.unshift(S.f.insurance);
  const fIns = $('#fIns');
  fIns.innerHTML = '<option value="">Convênio</option>' + ins.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  fIns.value = S.f.insurance;
  $('#fInsWrap').classList.toggle('hide', !ins.length);
  $('#fInsWrap').classList.toggle('on', !!S.f.insurance);
  const byRating = $('#fSort option[value="rating"]');
  byRating.hidden = byRating.disabled = !S.ratings.size;
  if (!S.ratings.size && S.f.sort === 'rating') { S.f.sort = 'dist'; $('#fSort').value = 'dist'; $('#fSort').parentElement.classList.remove('on'); }
  $('#fClear').hidden = !G.activeFilterCount(S.f);
}

// Escreve o HTML só quando muda (a contagem é aria-live: reescrever igual faria o leitor de tela repetir).
function setHTML(el, html) {
  if (el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}

// Troca o conteúdo da lista sem tirar o lugar de quem usa teclado: o foco volta para o mesmo cartão ou
// botão (ou para a própria lista, se ele não existir mais).
// keepSame: não redesenha se a lista já mostra exatamente isso. A explicação inicial já vem pronta no
// perto.html (aparece na primeira pintura); redesenhar a mesma coisa só atrasaria a medida de velocidade.
const sameHTML = (el, html) => { const t = document.createElement('template'); t.innerHTML = html; return t.innerHTML === el.innerHTML; };
function setListHTML(list, html, keepSame = false) {
  if (keepSame && sameHTML(list, html)) return;
  const a = document.activeElement;
  let sel = null;
  if (a && a !== list && list.contains(a)) {
    const card = a.closest('.pc[data-id]');
    sel = card ? `.pc[data-id="${CSS.escape(card.dataset.id)}"] .pc-open` : a.dataset.act ? `[data-act="${CSS.escape(a.dataset.act)}"]` : '';
  }
  list.innerHTML = html;
  if (sel !== null) ((sel && $(sel, list)) || list).focus({ preventScroll: true });
}

function render(fit = false) {
  const results = S.phase === 'results';
  const all = results ? allPlaces() : [];
  renderFilters(all);
  setHTML($('#banners'), bannersHTML());
  $('#viewToggle').classList.toggle('hide', !S.origin);
  $('#mapLoad').classList.toggle('hide', !(S.phase === 'loading' || S.placesState === 'loading' || (results && S.pts.state === 'loading' && !G.onlyPartnerFilter(S.f))));
  const list = $('#list');
  list.setAttribute('aria-busy', String(S.phase === 'loading' || S.phase === 'locating'));
  let shown = [];
  let total = null;

  if (S.phase === 'intro') setListHTML(list, introHTML(), true);
  else if (S.phase === 'locating') {
    setListHTML(list, stateHTML('fa-location-crosshairs', 'Aguardando sua permissão…',
      'Se o navegador perguntar, toque em <b>Permitir</b>. A localização é usada só para esta busca.',
      '<button class="btn btn-ghost" type="button" data-act="type">Prefiro digitar o endereço</button>').replace('class="ic"', 'class="ic pulse"'));
  } else if (S.phase === 'geo-error') {
    const [t, d] = GEO_MSG[S.geoError] ?? GEO_MSG.unavailable;
    const again = S.geoError === 'unsupported' ? '' : '<button class="btn btn-primary" type="button" data-act="locate">Tentar de novo</button>';
    setListHTML(list, stateHTML('fa-location-pin-lock', t, d, again + '<button class="btn btn-ghost" type="button" data-act="type">Digitar endereço</button>', true));
  } else if (S.phase === 'loading') {
    setListHTML(list, SKELETON.repeat(5));
  } else if (allFailed()) {
    setListHTML(list, stateHTML('fa-plug-circle-xmark', 'Não foi possível buscar agora',
      'Os serviços de busca não responderam. Verifique sua internet e tente de novo em instantes.',
      '<button class="btn btn-primary" type="button" data-act="retry">Tentar de novo</button>', true));
  } else {
    shown = G.sortPlaces(G.filterPlaces(all, S.f), S.f.sort, S.f.exam, S.ratings);
    total = areaTotal(shown);
    // Enquanto o banco busca na área inteira, sem nada para mostrar ainda: esqueleto, não "nada encontrado".
    const waiting = !shown.length && !G.onlyPartnerFilter(S.f) && listFor().state === 'loading';
    let html = shown.length ? shown.map(cardHTML).join('') : waiting ? SKELETON.repeat(3) : emptyHTML();
    html += pagerHTML(shown.length, total);
    if (S.placesState === 'loading') html += '<div class="pt-more" role="status"><span class="spin" aria-hidden="true"></span>Carregando estabelecimentos do mapa…</div>';
    if (S.f.insurance) html += '<p class="pt-note"><i class="fa-solid fa-id-card" aria-hidden="true"></i>Convênios informados pelas clínicas parceiras. Confirme a cobertura com a clínica e com o seu plano.</p>';
    else if (S.f.sus) html += '<p class="pt-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>"Atende SUS" vem do cadastro oficial (CNES). As clínicas parceiras ainda não informam esse dado, por isso ficam de fora deste filtro.</p>';
    const official = S.base.length || cnesRows().length;
    // Exame de laboratório: o IMED não sabe quais exames cada laboratório faz (nem os parceiros informam cada um).
    if (S.f.exam === 'lab') html += `<p class="pt-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>${S.exameNome ? `Você buscou “${esc(S.exameNome)}”: a lista mostra os laboratórios. ` : ''}O IMED não sabe quais exames cada laboratório faz: confirme se o local faz este exame.</p>`;
    else if (S.f.exam && !S.f.onlyImed && (official || S.places.length)) html += '<p class="pt-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>Para quem ainda não é parceiro do IMED, o exame é reconhecido pelo nome do estabelecimento. Confirme com o local.</p>';
    if (!S.demo && S.imedState === 'ok' && !S.imed.length && S.placesState !== 'loading') {
      const fonte = official ? 'do cadastro oficial do Ministério da Saúde (CNES)' : 'de mapas públicos';
      html += `<p class="pt-note"><i class="fa-solid fa-handshake" aria-hidden="true"></i>Ainda não há clínicas parceiras do IMED nesta região. Os resultados vêm ${fonte}. Tem uma clínica? <a class="link" href="parceiros.html">Seja parceira</a>.</p>`;
    }
    setListHTML(list, html);
  }
  listView = { shown, total };
  setHTML($('#count'), countHTML(shown, total));
  $('#legend').hidden = !(results && (all.length || S.pts.rows.length) && !allFailed());
  $('#legDemo').hidden = !S.demo; // "Clínica fictícia" só no modo de teste (?demo=1)
  setHTML($('#priceBand'), priceBandHTML(all));
  drawMap(shown);
  if (fit) fitMap();
}

/* ======================= painel: detalhes ======================= */
let lastFocus = null;
const head = (title) => `<div class="sh-head"><h2 id="shTitle">${title}</h2><button class="x" type="button" data-close aria-label="Fechar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>`;

function openSheet(html) {
  if (!$('#ov').classList.contains('open')) lastFocus = document.activeElement;
  const sh = $('#sheet');
  sh.innerHTML = html;
  sh.scrollTop = 0;
  $('#ov').classList.add('open');
  $('#ov').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  // (Se a pessoa já fechou com Esc nesse meio-tempo, o foco fica onde voltou.)
  setTimeout(() => { if ($('#ov').classList.contains('open')) ($('[data-close]', sh) ?? sh).focus(); }, 40);
}

function closeSheet() {
  S.pointCtrl?.abort();
  if (!$('#ov').classList.contains('open')) return;
  $('#ov').classList.remove('open');
  $('#ov').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = document.body.classList.contains('show-map') ? 'hidden' : '';
  // Se a lista foi refeita enquanto o painel estava aberto, o foco volta para o mesmo cartão.
  const back = lastFocus?.isConnected ? lastFocus
    : lastFocus?.dataset?.id ? $(`#list .pc[data-id="${CSS.escape(lastFocus.dataset.id)}"] .pc-open`) : null;
  back?.focus?.({ preventScroll: true });
}

function servicesHTML(p) {
  if (!p.services.length) {
    const text = p.source === 'imed' ? 'A clínica ainda não informou os exames que faz.'
      : p.source === 'cnes' ? 'O cadastro oficial não lista os exames de cada local. Confirme com o estabelecimento ou peça ao IMED para verificar.'
      : 'O mapa não informa os serviços deste local. Confirme com o estabelecimento ou peça ao IMED para verificar.';
    return `<p>${text}</p>`;
  }
  const items = p.services.map((c) => {
    const ex = G.EXAMS[c];
    const guide = ex?.slug ? `<a href="exames/${ex.slug}.html#preparo" target="_blank" rel="noopener">preparo</a>` : '';
    let right = '';
    if (p.source === 'imed') {
      const v = G.priceFor(p, c);
      right = v != null ? `<span>${G.formatPrice(v)}</span>` : '<span class="muted">Preço sob consulta</span>';
    }
    return `<li><b>${esc(ex?.n ?? c)}${guide}</b>${right}</li>`;
  }).join('');
  const src = p.source === 'imed'
    ? 'Exames e preços informados pela clínica ao IMED. Sem preço informado, o valor é passado pela clínica.'
    : 'Serviços identificados pelo nome do estabelecimento. Confirme com ele.';
  return `<ul class="dt-svc">${items}</ul><p class="src">${src}</p>`;
}

function hoursHTML(p) {
  if (!p.hours) return '<p>Horário não informado. Confirme com o estabelecimento antes de ir.</p>';
  const src = {
    clinica: 'Informado pela clínica.', osm: 'Fonte: OpenStreetMap. Pode estar desatualizado.', google: 'Fonte: Google Maps.',
    cnes: 'Turno informado ao cadastro oficial (CNES), não é o horário exato. Confirme antes de ir.',
  }[p.hours_source] ?? '';
  return `<ul class="dt-hours">${p.hours.map((h) => `<li>${esc(h)}</li>`).join('')}</ul><p class="src">${src}</p>`;
}

function contactHTML(p) {
  const rows = [];
  const tel = p.phone && G.telHref(p.phone);
  if (tel) rows.push(`<li><i class="fa-solid fa-phone" aria-hidden="true"></i><a href="${esc(tel)}">${esc(p.phone)}</a></li>`);
  if (p.whatsapp) rows.push(`<li><i class="fa-brands fa-whatsapp" aria-hidden="true"></i><a href="${esc(G.whatsappHref(p.whatsapp))}" target="_blank" rel="noopener">WhatsApp</a></li>`);
  if (p.email && G.isValidEmail(p.email)) rows.push(`<li><i class="fa-solid fa-envelope" aria-hidden="true"></i><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></li>`);
  if (p.website) rows.push(`<li><i class="fa-solid fa-globe" aria-hidden="true"></i><a href="${esc(p.website)}" target="_blank" rel="noopener nofollow">${esc(new URL(p.website).hostname.replace(/^www\./, ''))}</a></li>`);
  return rows.length ? `<ul class="dt-contact">${rows.join('')}</ul>` : '<p>O estabelecimento não informou telefone nem site. Você pode pedir ao IMED para agendar por você.</p>';
}

// Avaliações publicadas do local (as 5 mais novas). Sem avaliação ou com falha, a seção não aparece.
const STARS = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
async function loadReviews(p) {
  const box = () => $(`#dtReviews[data-id="${CSS.escape(p.id)}"]`);
  let rows = [];
  try { rows = await rpc('place_reviews', { p_key: p.id, p_limit: 5 }); } catch { rows = []; }
  const el = box();
  if (!el) return;
  rows = (Array.isArray(rows) ? rows : []).filter((r) => r.rating >= 1 && r.rating <= 5);
  if (!rows.length) { el.remove(); return; }
  const r = S.ratings.get(p.id);
  el.innerHTML = `<h4><i class="fa-solid fa-star" aria-hidden="true"></i>Avaliações${r ? ` <span class="dt-rate">${G.formatRating(r.rating)} <small>(${plural(r.reviews, 'avaliação', 'avaliações')})</small></span>` : ''}</h4>
    <ul class="dt-reviews">${rows.map((v) => {
      const n = Math.round(Number(v.rating));
      const when = v.created_at ? new Date(v.created_at).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : '';
      const who = String(v.author_name ?? '').trim().split(/\s+/)[0];
      return `<li><div class="rv-top"><span class="rv-stars" role="img" aria-label="Nota ${n} de 5">${STARS(n)}</span><span class="rv-who">${esc(who || 'Paciente')}${when ? ` · ${esc(when)}` : ''}</span></div>${v.comment ? `<p>${esc(v.comment)}</p>` : ''}</li>`;
    }).join('')}</ul>
    <p class="src">Avaliações de pacientes que fizeram o pedido pelo IMED e tiveram o atendimento concluído. <a class="link" href="como-funciona.html#avaliacoes">Como funcionam</a></p>`;
  el.hidden = false;
}

const imedWhatsapp = () => G.onlyDigits(CFG.whatsapp);

function openDetails(id) {
  const p = placeById(id);
  if (!p) return;
  setSelected(id);
  const k = G.KINDS[p.kind];
  const tel = p.phone && G.telHref(p.phone);
  const acts = [`<a href="${esc(G.directionsUrl(p))}" target="_blank" rel="noopener"><i class="fa-solid fa-route" aria-hidden="true"></i>Como chegar</a>`];
  if (tel) acts.push(`<a href="${esc(tel)}"><i class="fa-solid fa-phone" aria-hidden="true"></i>Ligar</a>`);
  if (p.whatsapp) acts.push(`<a class="wa" href="${esc(G.whatsappHref(p.whatsapp, 'Olá! Encontrei vocês pelo IMED e gostaria de agendar um exame.'))}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>WhatsApp</a>`);
  if (p.website) acts.push(`<a href="${esc(p.website)}" target="_blank" rel="noopener nofollow"><i class="fa-solid fa-globe" aria-hidden="true"></i>Site</a>`);
  if (p.maps_url) {
    const where = p.source === 'cnes' ? 'Ver no CNES' : `Ver no ${SOURCE_LABEL[p.source] ?? 'mapa'}`;
    acts.push(`<a href="${esc(p.maps_url)}" target="_blank" rel="noopener"><i class="fa-solid ${p.source === 'cnes' ? 'fa-building-circle-check' : 'fa-map-location-dot'}" aria-hidden="true"></i>${where}</a>`);
  }

  let cta = '';
  // Página completa de quem não é parceiro: leva o exame da busca (o pedido e as perguntas já vêm com ele).
  const full = G.localUrl(p);
  const page = full && p.source !== 'imed' && S.f.exam ? `${full}&exame=${encodeURIComponent(S.f.exam)}` : full;
  if (hasSchedule(p)) {
    cta = `<a class="btn btn-coral" href="${esc(agendaUrl(p))}" data-book-slots><i class="fa-solid fa-calendar-days" aria-hidden="true"></i>Ver horários e agendar</a>`;
  } else if (p.source === 'imed' && p.accepts_online_booking) {
    cta = `<button class="btn btn-coral" type="button" data-book="${esc(p.id)}"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i>Solicitar agendamento</button>`;
  } else if (p.source === 'imed') {
    cta = tel ? `<a class="btn btn-primary" href="${esc(tel)}"><i class="fa-solid fa-phone" aria-hidden="true"></i>Ligar para agendar</a>` : '';
  } else {
    cta = `<button class="btn btn-coral" type="button" data-book="${esc(p.id)}"><i class="fa-solid fa-headset" aria-hidden="true"></i>Pedir ao IMED para agendar</button>`;
  }

  const wa = imedWhatsapp();
  const waBtn = wa ? `<a class="btn btn-ghost wa-imed" href="${esc(G.whatsappHref(wa, `Olá! Encontrei "${p.name}" no IMED e gostaria de ajuda para agendar.`))}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>Falar com o IMED no WhatsApp</a>` : '';
  const claim = p.source === 'cnes'
    ? `<p class="dt-claim"><a class="link" href="reivindicar.html?cnes=${encodeURIComponent(p.id.slice(5))}">É o responsável por este local? Assuma o cadastro</a></p>` : '';
  const ins = p.source === 'imed' && p.insurances?.length
    ? `<div class="dt-sec"><h4><i class="fa-solid fa-id-card" aria-hidden="true"></i>Convênios</h4><div class="dt-chips">${p.insurances.map((s) => `<span class="svc">${esc(s)}</span>`).join('')}</div><p class="src">Convênios informados pela clínica. Confirme a cobertura com ela e com o seu plano.</p></div>` : '';
  const rating = ratingHTML(p, 'dt-rate');

  const note = p.source === 'imed'
    ? (p.is_demo
      ? '<p class="note demo"><i class="fa-solid fa-flask" aria-hidden="true"></i>Clínica de demonstração do IMED: nome e endereço fictícios, sem preço e sem horário. Serve para testar o fluxo de ponta a ponta.</p>'
      : '<p class="note"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>Parceiro verificado do IMED: preços, exames e agenda são informados e confirmados pela própria clínica.</p>')
    : p.source === 'cnes'
      ? `<p class="note"><i class="fa-solid fa-building-circle-check" aria-hidden="true"></i>Dados do Cadastro Nacional de Estabelecimentos de Saúde (CNES), do Ministério da Saúde${p.updated_at ? `, atualizados em ${esc(new Date(`${p.updated_at}T12:00:00`).toLocaleDateString('pt-BR'))}` : ''}.${p.approx ? ' A localização no mapa é aproximada, pelo endereço.' : ''} Este estabelecimento ainda não é parceiro do IMED: confirme horários, exames e valores diretamente com ele. ${G.TRUST.cnes}</p>`
      : `<p class="note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>Dados do ${p.source === 'osm' ? 'OpenStreetMap, mantidos por voluntários' : 'Google Maps'}. Este estabelecimento ainda não é parceiro do IMED: confirme preços e horários diretamente com ele.</p>`;

  openSheet(head(esc(p.name)) + `<div class="sh-body">
    <div class="dt-top"><span class="pc-ic k-${p.kind}" aria-hidden="true"><i class="fa-solid ${k.icon}"></i></span>
      <div style="min-width:0"><div class="pc-badges">${badgesHTML(p)}</div><h3>${esc(p.name)}</h3>
      <p>${esc(k.n)} · <b>${distanceText(p)}</b> ${S.originKind === 'gps' ? 'de você (aproximado)' : 'do ponto da busca'}${rating ? ` · ${rating}` : ''}</p>
      <p>${esc(p.address || 'Endereço não informado no mapa')}${p.cep ? ` · CEP ${esc(p.cep)}` : ''}</p></div></div>
    <div class="dt-acts">${acts.join('')}</div>
    ${page ? `<p class="dt-full"><a class="link" href="${esc(page)}"><i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i>Ver página completa</a></p>` : ''}
    ${p.source === 'imed' ? '' : G.callQuestionsHTML(p, S.f.exam)}
    ${p.description ? `<div class="dt-sec"><h4><i class="fa-solid fa-circle-info" aria-hidden="true"></i>Sobre</h4><p>${esc(p.description)}</p></div>` : ''}
    <div class="dt-sec"><h4><i class="fa-solid fa-notes-medical" aria-hidden="true"></i>Serviços</h4>${servicesHTML(p)}</div>
    ${p.specialties.length ? `<div class="dt-sec"><h4><i class="fa-solid fa-user-doctor" aria-hidden="true"></i>Especialidades</h4><div class="dt-chips">${p.specialties.map((s) => `<span class="svc">${esc(s)}</span>`).join('')}</div></div>` : ''}
    <div class="dt-sec"><h4><i class="fa-regular fa-clock" aria-hidden="true"></i>Horário de funcionamento</h4>${hoursHTML(p)}</div>
    ${ins}
    <div class="dt-sec"><h4><i class="fa-solid fa-address-book" aria-hidden="true"></i>Contato</h4>${contactHTML(p)}</div>
    <div class="dt-sec" id="dtReviews" data-id="${esc(p.id)}" hidden></div>
    ${note}${claim}
    ${G.sosHTML()}
  </div>${cta || waBtn ? `<div class="sh-foot">${cta}${waBtn}</div>` : ''}`);
  loadReviews(p);
}

/* ======================= painel: pedido de agendamento ======================= */
// Horários da página do local, já com o exame que o paciente filtrou na busca (se a clínica faz).
function agendaUrl(p) {
  const exam = S.f.exam && p.services?.includes(S.f.exam) ? `&exame=${encodeURIComponent(S.f.exam)}` : '';
  return `${G.localUrl(p)}${exam}#agendar`;
}

function openBooking(id) {
  const p = placeById(id);
  if (!p) return;
  // Parceiro com agenda: os horários livres ficam na página do local.
  if (hasSchedule(p)) { location.href = agendaUrl(p); return; }
  const imed = p.source === 'imed';
  const codes = imed ? p.services.filter((c) => G.EXAMS[c]) : Object.keys(G.EXAMS);
  const pre = S.f.exam && codes.includes(S.f.exam) ? S.f.exam : '';
  const opt = (v, label) => `<option value="${v}"${v === pre ? ' selected' : ''}>${esc(label)}</option>`;
  const examOpts = codes.map((c) => {
    const v = imed ? G.priceFor(p, c) : null;
    return opt(c, G.EXAMS[c].n + (v != null ? ` · ${G.formatPrice(v)}` : ''));
  }).join('') + opt('consulta', 'Consulta') + opt('outro', 'Outro (descrevo nas observações)');
  const min = G.spDate(0), max = G.spDate(G.BOOKING_DAYS);
  const k = G.KINDS[p.kind];
  const how = imed
    ? 'A clínica recebe seu pedido pelo IMED e confirma o horário com você.'
    : 'Este local ainda não é parceiro do IMED. Nossa equipe fala com ele e confirma o horário com você.';

  openSheet(head(imed ? 'Solicitar agendamento' : 'Pedir ao IMED para agendar') + `<form class="sh-body" id="bookForm" novalidate>
    <div class="bk-place"><span class="pc-ic k-${p.kind}" aria-hidden="true"><i class="fa-solid ${k.icon}"></i></span><div style="min-width:0"><b>${esc(p.name)}</b><small>${esc(p.address || k.n)}</small></div></div>
    <p class="src" style="margin-top:10px">${how}</p>
    ${G.sosHTML(G.TRUST.sosPedido)}
    <div class="fld" data-f="exam"><label for="bkExam">Exame ou atendimento</label>
      <select id="bkExam" name="exame" required><option value="">Escolha</option>${examOpts}</select><span class="err" id="e-exam"></span></div>
    <div class="fld" data-f="date"><label for="bkDate">Data que prefere <small class="h">(até ${G.BOOKING_DAYS} dias)</small></label>
      <input id="bkDate" name="data" type="date" min="${min}" max="${max}" required><span class="err" id="e-date"></span></div>
    <fieldset class="fld" data-f="period"><legend>Período</legend>
      <div class="seg">${Object.entries(G.PERIODS).map(([v, l]) => `<label><input type="radio" name="periodo" value="${v}"${v === 'qualquer' ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <span class="err" id="e-period"></span></fieldset>
    ${G.forWhomHTML()}
    <div class="fld" data-f="name"><label for="bkName">Seu nome completo</label>
      <input id="bkName" name="nome" autocomplete="name" maxlength="120" required><span class="err" id="e-name"></span></div>
    <div class="row2">
      <div class="fld" data-f="phone"><label for="bkPhone">Celular com DDD</label>
        <input id="bkPhone" name="celular" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(11) 98765-4321" maxlength="16" required><span class="err" id="e-phone"></span></div>
      <div class="fld" data-f="email"><label for="bkEmail">E-mail <small class="h">(opcional)</small></label>
        <input id="bkEmail" name="email" type="email" autocomplete="email" maxlength="254"><span class="err" id="e-email"></span></div>
    </div>
    <div class="fld" data-f="notes"><label for="bkNotes">Observações <small class="h">(opcional)</small></label>
      <textarea id="bkNotes" name="obs" maxlength="500" placeholder="Ex.: convênio, melhor horário para ligar. Não precisa enviar resultados de exames."></textarea><span class="err" id="e-notes"></span></div>
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <label class="consent" data-f="consent"><input type="checkbox" name="consent"><span>Autorizo o IMED a usar estes dados, incluindo o exame escolhido, para encaminhar meu pedido ao estabelecimento e entrar em contato comigo sobre este agendamento. <a href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a></span></label>
    <span class="err" id="e-consent" style="display:block;color:var(--coral-d);font-size:13px;font-weight:600;margin-top:6px"></span>
    <p class="bk-err" id="bkErr" role="alert"></p>
    ${p.is_demo ? '<p class="note demo"><i class="fa-solid fa-flask" aria-hidden="true"></i>Clínica de demonstração: o pedido fica registrado só como teste.</p>' : ''}
    ${imed ? '' : G.susHTML()}
    ${G.trustHTML()}
    <div class="sh-foot" style="margin:18px -20px -24px"><button class="btn btn-coral" type="submit" id="bkBtn"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i>Enviar pedido</button>
      <p class="src" style="text-align:center;margin:0">O horário só fica garantido depois da confirmação.</p></div>
  </form>`);

  const form = $('#bookForm');
  const phone = $('#bkPhone');
  phone.addEventListener('input', () => { phone.value = G.maskPhone(phone.value); });
  // Ao corrigir um campo, o aviso de erro dele some.
  const clearError = (e) => {
    const box = e.target.closest('[data-f]');
    if (!box?.classList.contains('bad')) return;
    box.classList.remove('bad');
    const msg = $(`#e-${box.dataset.f}`, form);
    if (msg) msg.textContent = '';
  };
  form.addEventListener('input', clearError);
  form.addEventListener('change', clearError);
  // "O exame é para": campos de outra pessoa e, para menor de 18 anos, a autorização do responsável.
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'para' && e.target.name !== 'menor') return;
    G.forWhomToggle(form);
    if (e.target.name === 'para' && e.target.value === 'outra') $('#bkOtherName', form)?.focus();
  });
  form.addEventListener('submit', (e) => submitBooking(e, p));
}

function showErrors(form, errs) {
  for (const f of ['exam', 'date', 'period', 'otherName', 'relationship', 'guardian', 'otherConsent', 'name', 'phone', 'email', 'notes', 'consent']) {
    const box = $(`[data-f="${f}"]`, form);
    box?.classList.toggle('bad', !!errs[f]);
    const msg = $(`#e-${f}`, form);
    if (msg) msg.textContent = errs[f] ?? '';
    // Leitor de tela: o campo diz que está com erro e lê a mensagem junto (aria-describedby).
    for (const el of box ? box.querySelectorAll('input:not([type=hidden]),select,textarea') : []) {
      if (errs[f]) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      const ids = new Set((el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      if (msg?.id) ids.add(msg.id);
      if (ids.size) el.setAttribute('aria-describedby', [...ids].join(' '));
    }
  }
  const first = Object.keys(errs)[0];
  if (first) {
    const box = $(`[data-f="${first}"]`, form);
    $('input,select,textarea', box)?.focus();
    box?.scrollIntoView({ block: 'center', behavior: SMOOTH });
  }
}

async function submitBooking(e, p) {
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);
  const v = {
    exam: fd.get('exame') || '', date: fd.get('data') || '', period: fd.get('periodo') || '', name: fd.get('nome') || '',
    phone: fd.get('celular') || '', email: fd.get('email') || '', notes: fd.get('obs') || '', consent: fd.get('consent') === 'on',
    ...G.forWhomValues(fd),
  };
  const errs = G.validateBooking(v);
  showErrors(form, errs);
  const errBox = $('#bkErr', form);
  errBox.classList.remove('show');
  if (Object.keys(errs).length) return;
  const id = crypto.randomUUID();
  if (fd.get('website')) return bookingDone(p, v, id, false);
  const btn = $('#bkBtn', form);
  btn.disabled = true;
  btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Enviando…';
  try {
    // Código secreto do pedido: fica só neste aparelho; o banco guarda apenas o resumo (SHA-256).
    // Com ele a pessoa vê a situação do pedido e avalia o atendimento, mesmo sem conta.
    const token = randomHex(32);
    const row = G.bookingRow(p, v, id, { review_token_hash: await sha256Hex(token) });
    // Decide pelo token de verdade (sessão válida ou renovada); sessão vencida conta como sem conta.
    const auth = await loadAuth();
    const logged = !!(await auth?.token?.().catch(() => null));
    if (logged) await auth.insert('appointment_requests', row);
    else await window.imedInsert('appointment_requests', row);
    saveLocal(p, v, id, token);
    bookingDone(p, v, id, logged);
  } catch (err) {
    const tel = p.phone && G.telHref(p.phone);
    errBox.innerHTML = ((err.status >= 400 && err.status < 500) || /http 4\d\d/.test(err.message)
      ? 'O pedido não foi aceito. Confira a data e os dados e tente de novo.'
      : 'Não foi possível enviar agora. Verifique sua internet e tente de novo.')
      + (tel ? ` Se preferir, <a class="link" href="${esc(tel)}">ligue para o estabelecimento</a>.` : '');
    errBox.classList.add('show');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo';
  }
}

const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
let authMod;
const loadAuth = () => (authMod ??= import('./auth.js').catch(() => null));

// Guarda no aparelho o resumo do pedido e o código secreto, para "Meus pedidos" (página inicial e conta).
function saveLocal(p, v, id, token) {
  try {
    let list = JSON.parse(localStorage.getItem('imed_appts') || '[]');
    if (!Array.isArray(list)) list = [];
    list.unshift(G.localAppt(p, v, id, token));
    localStorage.setItem('imed_appts', JSON.stringify(list.slice(0, 30)));
  } catch { /* armazenamento indisponível: o pedido já foi enviado */ }
}

// Lembrete na agenda do celular (.ics), com o preparo do exame e lembrete um dia antes.
function downloadIcs(p, v, id) {
  const ics = G.bookingIcs(p, v, id, CFG.siteUrl || location.origin + '/');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${G.protocolFromId(id).toLowerCase()}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const examLabel = G.examLabel;

function bookingDone(p, v, id, logged) {
  const imed = p.source === 'imed';
  const guide = G.EXAMS[v.exam]?.slug;
  const d = G.onlyDigits(v.phone);
  openSheet(head('Pedido enviado') + `<div class="sh-body ok">
    <div class="ic"><i class="fa-solid fa-check" aria-hidden="true"></i></div>
    <h3>Recebemos seu pedido!</h3>
    <p><b>${esc(p.name)}</b><br>${esc(examLabel(v.exam))} · ${esc(G.formatDateLong(v.date))} · ${esc(G.PERIODS[v.period])}${v.forOther ? `<br>Para ${esc(String(v.otherName).trim().replace(/\s+/g, ' '))} (${esc(v.relationship)})` : ''}</p>
    <span class="code">${G.protocolFromId(id)}</span>
    <ol>
      <li>${imed ? 'A clínica recebe o pedido pelo IMED.' : 'A equipe do IMED fala com o estabelecimento.'}</li>
      <li>Você recebe a confirmação do horário no celular terminado em ${esc(d.slice(-4))}.</li>
      <li>No dia, leve documento com foto e o pedido médico.</li>
    </ol>
    <p class="note" style="text-align:left"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>O horário só fica garantido depois da confirmação.${p.is_demo ? ' Clínica de demonstração: pedido registrado só como teste.' : ''}</p>
    <div class="trust">${G.gratisHTML()}</div>
    <div class="ok-acts">
      <button class="btn btn-primary" type="button" data-ics><i class="fa-solid fa-calendar-plus" aria-hidden="true"></i>Adicionar à agenda</button>
      ${guide ? `<a class="btn btn-ghost" href="exames/${guide}.html#preparo"><i class="fa-solid fa-book-medical" aria-hidden="true"></i>Como se preparar</a>` : ''}
      <a class="btn btn-ghost" href="./#agenda">Ver meus pedidos</a>
      ${logged ? '' : '<a class="btn btn-ghost" href="conta.html"><i class="fa-solid fa-user-plus" aria-hidden="true"></i>Criar conta para acompanhar</a>'}
      <button class="btn btn-ghost" type="button" data-close>Voltar aos resultados</button>
    </div>
  </div>`);
  $('[data-ics]', $('#sheet')).addEventListener('click', () => downloadIcs(p, v, id));
}

/* ======================= eventos ======================= */
function bind() {
  $('#searchForm').addEventListener('submit', onSearchSubmit);
  $('#q').addEventListener('focus', () => { loadNomes(); });
  // e.detail 0: botão acionado pelo teclado (Enter ou espaço), não pelo toque ou clique.
  $('#qEsc').addEventListener('click', (e) => { const b = e.target.closest('[data-exame]'); const k = b?.dataset.exame; if (k && (k === 'todos' || Object.hasOwn(G.EXAMS, k))) escolherExame(k, e.detail === 0); });
  // Exame escolhido na lista de filtros: as opções do "eco" e o nome escrito na busca saem.
  $('#fExam').addEventListener('change', () => { S.exameNome = ''; hideEscolha(); });
  $('#locBtn').addEventListener('click', locate);
  $('#areaBtn').addEventListener('click', searchMapArea);
  $('#viewToggle').addEventListener('click', () => setMapView(!document.body.classList.contains('show-map')));

  const ids = { kind: 'fKind', exam: 'fExam', specialty: 'fSpec', radius: 'fDist', price: 'fPrice', sort: 'fSort' };
  for (const [key, id] of Object.entries(ids)) {
    $(`#${id}`).addEventListener('change', (e) => {
      const value = key === 'radius' ? Number(e.target.value) : e.target.value;
      // Raio maior que o da busca: busca tudo de novo (parceiros e mapa público também mudam).
      if (key === 'radius' && S.origin && value > S.fetchedRadius) { S.f.radius = value; return retrySearch(); }
      changeFilters(() => {
        S.f[key] = value;
        if (key === 'radius') { drawOrigin(); userMoved = false; }
      }, key === 'radius');
    });
  }
  $('#fImed').addEventListener('click', () => changeFilters(() => { S.f.onlyImed = !S.f.onlyImed; }));
  $('#fSus').addEventListener('click', () => changeFilters(() => { S.f.sus = !S.f.sus; }));
  $('#fIns').addEventListener('change', (e) => changeFilters(() => { S.f.insurance = e.target.value; }));
  $('#fClear').addEventListener('click', clearFilters);
  $('#mapKey').addEventListener('click', (e) => { if (e.target.closest('[data-act="points-retry"]')) syncArea(); });

  $('#list').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (act) return onAction(act);
    if (e.target.closest('a')) return;
    const card = e.target.closest('.pc[data-id]');
    if (card) openDetails(card.dataset.id);
  });
  $('#banners').addEventListener('click', (e) => { const act = e.target.closest('[data-act]'); if (act) onAction(act); });
  $('#list').addEventListener('mouseover', (e) => setHot(e.target.closest('.pc[data-id]')?.dataset.id ?? null));
  $('#list').addEventListener('mouseleave', () => setHot(null));

  const ov = $('#ov');
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-act="copy-questions"]')) return G.copyCallQuestions(e.target.closest('.cq'));
    const b = e.target.closest('[data-book]');
    if (b) return openBooking(b.dataset.book);
    const pt = e.target.closest('[data-point]');
    if (pt && S.lastPoint?.cnes === pt.dataset.point) openPoint(S.lastPoint);
  });
  document.addEventListener('keydown', (e) => {
    if (!ov.classList.contains('open')) return;
    if (e.key === 'Escape') return closeSheet();
    if (e.key === 'Tab') {
      // O que recebe o Tab na janela: de um grupo de opções (rádio), só a marcada ou a primeira.
      const all = $$('a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),details>summary:first-of-type,[tabindex]', $('#sheet'))
        .filter((x) => x.tabIndex >= 0 && x.offsetParent !== null);
      const f = all.filter((x) => x.type !== 'radio' || !x.name || x === (all.filter((y) => y.type === 'radio' && y.name === x.name).find((y) => y.checked) ?? all.find((y) => y.type === 'radio' && y.name === x.name)));
      // Foco fora da janela (por exemplo, depois de um clique no fundo): o Tab volta para dentro dela.
      if (!$('#sheet').contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0])?.focus(); return; }
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

// Muda filtros e redesenha na hora. Se mudou raio, tipo, exame ou SUS, a área inteira é buscada de novo
// no banco logo depois (com uma pequena espera, caso a pessoa mexa em mais de um filtro). Ao desligar um
// filtro só de parceiros, o cadastro oficial volta: busca o que ainda não tinha sido buscado.
function changeFilters(fn, fit = false) {
  const before = areaKey();
  const partners = G.onlyPartnerFilter(S.f);
  fn();
  render(fit);
  if (S.phase !== 'results') return;
  if (areaKey() !== before) { scheduleArea(); trackSearch(); }
  else if (partners && !G.onlyPartnerFilter(S.f) && S.areaAsked !== areaKey()) syncArea();
}

// Contador de visitas próprio (assets/js/visitas.js): conta o exame, o tipo de local e a cidade da busca, cada um
// separado e sem nada da pessoa (nem a posição). Cada um conta uma vez por página aberta.
function trackSearch(rows = []) {
  const track = window.IMED_TRACK;
  if (typeof track !== 'function' || S.phase !== 'results') return;
  if (S.f.exam) track('busca_exame', S.f.exam);
  if (S.f.kind) track('busca_tipo', S.f.kind);
  const city = G.searchCity(S.coverage, rows);
  if (city) track('busca_cidade', city);
}
const clearFilters = () => changeFilters(() => { S.f = { ...G.DEFAULT_FILTERS, radius: S.f.radius, sort: S.f.sort }; S.exameNome = ''; });

function onAction(el) {
  const a = el.dataset.act;
  if (a === 'locate') locate();
  else if (a === 'type') { $('#q').focus(); $('#q').scrollIntoView({ behavior: SMOOTH, block: 'center' }); }
  else if (a === 'retry') retrySearch();
  else if (a === 'retry-places') retryPlaces();
  else if (a === 'more') showMore();
  else if (a === 'clear') clearFilters();
  else if (a === 'radius') { S.f.radius = Number(el.dataset.radius); retrySearch(); }
  else if (a === 'demo-sp') runSearch({ lat: -23.565, lng: -46.652 }, 'Av. Paulista, São Paulo - SP', 'busca', 'endereco');
}

/* ======================= início ======================= */
// Lugar vindo da página inicial: ?onde= (cidade ou bairro, sem número) ou, com número (CEP, endereço), guardado só
// na aba (sessionStorage), lido uma vez e apagado. O ?onde= sai do endereço depois de lido (como o ?usar=).
function lerOnde() {
  let onde = (params.get('onde') || '').trim();
  if (onde) {
    params.delete('onde');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  } else {
    try { onde = (sessionStorage.getItem('imed_onde') || '').trim(); sessionStorage.removeItem('imed_onde'); } catch { onde = ''; }
  }
  return onde.slice(0, 140);
}
async function init() {
  initMap();
  bind();
  render();
  const wantsLocation = params.get('usar') === 'localizacao';
  if (wantsLocation) {
    params.delete('usar');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  }
  const localRef = G.parseLocalRef(params.get('local'));
  if (localRef) return openLocal(localRef);
  // Lugar escrito na página inicial junto com o exame ("ressonância em Campinas"): a busca vai direto para lá, sem
  // pedir a localização.
  const onde = lerOnde();
  if (onde) { $('#q').value = onde; buscarTexto(onde, false); return; }
  const state = await permissionState();
  // Só pede a localização quando a pessoa tocou em "Encontrar clínicas perto de mim"
  // ou quando ela já tinha permitido antes; senão, mostra a explicação e espera o toque.
  if (state === 'denied' && wantsLocation) geoFail('denied');
  else if (wantsLocation || state === 'granted') locate();
}

init();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
}
