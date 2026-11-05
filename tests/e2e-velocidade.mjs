// Teste de ponta a ponta da velocidade no celular (Playwright), com respostas simuladas do banco:
// letras e ícones do próprio site, sem "pulos" na tela enquanto os dados chegam (CLS), explicação da busca já no
// HTML, mapa do local só quando chega perto da tela e ícones dos exames na medida certa.
// Rodar com: node tests/e2e-velocidade.mjs     (E2E_PORT=8786 node tests/e2e-velocidade.mjs usa outra porta)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { simularGeo } from './geo-simulado.mjs';
import { simularMapa, simularSatelite } from './mapa-simulado.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
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
const PORT = Number(process.env.E2E_PORT) || 8776; // E2E_PORT: outra porta para rodar em paralelo
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;

/* ======================= dados simulados ======================= */
const CITIES = [
  { ibge: 3550308, name: 'São Paulo', uf: 'SP', total: 6548, imagem: 574, laboratorio: 524, clinica: 5161, hospital: 289 },
  { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', total: 4709, imagem: 441, laboratorio: 369, clinica: 3677, hospital: 222 },
];
const NEAR = ['imagem', 'laboratorio', 'clinica', 'hospital', 'clinica', 'imagem'].map((kind, i) => ({
  cnes: String(9000001 + i), name: `Local Teste ${i + 1}`, kind, cnes_type: 36, address_line: `Av. Paulista, ${1000 + i}`, neighborhood: 'Bela Vista',
  cep: '01310100', city: 'São Paulo', uf: 'SP', city_code: 355030, lat: -23.565 + i * 0.0004, lng: -46.652 + i * 0.0003, distance_m: 60 + i * 80,
  location_source: 'cnes', phone: null, shift: 'Manhã e tarde', open_24h: false, sus: false, services: [], specialties: [], cnes_updated_at: '2026-10-27', total: 6,
}));
const EST = {
  cnes: '2077485', name: 'Hospital Santa Exemplo', legal_name: null, kind: 'hospital', address_line: 'Rua Napoleão de Barros, 715', neighborhood: 'Vila Clementina',
  cep: '04024002', phone: null, shift: 'Aberto 24 horas', open_24h: true, sus: true, services: [], specialties: [], cnes_updated_at: '2025-09-03',
  location_source: 'cnes', location: { type: 'Point', coordinates: [-46.6435, -23.5978] }, city_ibge: 3550308, municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 },
};
const CITY_ROWS = Array.from({ length: 12 }, (_, i) => ({ cnes: String(8000001 + i), name: `Clínica ${i + 1}`, kind: ['clinica', 'imagem', 'laboratorio', 'hospital'][i % 4], address_line: 'Rua Rocha, 343', neighborhood: 'Bela Vista', cep: '01330000', phone: null, shift: 'Manhã e tarde', open_24h: false, sus: i % 3 === 0, services: [], lat: -23.559, lng: -46.649, total: 6548 }));

// Cidade de nome comprido (a linha da fonte do topo fica mais longa): a pessoa em Nossa Senhora do Socorro (SE).
const LONGA = { ibge: 2804805, name: 'Nossa Senhora do Socorro', uf: 'SE', total: 312, imagem: 20, laboratorio: 30, clinica: 250, hospital: 12 };
const NEAR_LONGA = NEAR.map((r) => ({ ...r, city: LONGA.name, uf: LONGA.uf, city_code: 280480 }));
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// slow: atraso das respostas do banco (ms), para ver o que a tela faz enquanto os dados chegam.
// geo: permissão e localização simuladas (tests/geo-simulado.mjs); sem ela, o Chromium recusa sem perguntar e a
// página inicial cai em "naoapareceu" (exemplo da Av. Paulista). longa: a pessoa numa cidade de nome comprido.
// leve: aparelho simples (sem o 3D, que no computador pesa e demora).
// satelite: a chave da Esri simulada e a foto de satélite simulada, num aparelho capaz (8 núcleos, 8 GB) com o
// movimento ligado — o único jeito de a foto aparecer no celular.
async function newPage(browser, { mobile = true, width = 390, height = 844, slow = 0, js = true, date = '2026-10-27', geo = null, longa = false, leve = false, satelite = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width, height } : { width: 1280, height: 800 }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', javaScriptEnabled: js, ...(satelite ? { reducedMotion: 'no-preference' } : {}),
  });
  if (geo) await simularGeo(context, geo);
  if (leve) await context.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { get: () => 1, configurable: true }));
  if (satelite) {
    await context.addInitScript(() => { Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true }); Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true }); });
    await simularSatelite(context);
  }
  const requests = [];
  context.on('request', (r) => requests.push(r.url()));
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.abort());
  await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await simularMapa(context); // ladrilhos do mapa 3D do topo (OpenFreeMap), simulados
  await context.route((u) => u.href.startsWith(REST), async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const u = new URL(req.url());
    const fn = u.pathname.split('/').pop();
    if (slow) await wait(slow);
    let body = [];
    if (fn === 'imported_cities') body = longa ? [...CITIES, LONGA] : CITIES;
    else if (fn === 'nearby_establishments') body = longa ? NEAR_LONGA : NEAR;
    else if (fn === 'cnes_last_update') body = date;
    else if (fn === 'city_establishments') body = CITY_ROWS;
    else if (fn === 'establishments') body = u.searchParams.get('cnes') === 'eq.2077485' ? [EST] : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
  });
  // Deslocamentos de layout (CLS) e quando as letras ficaram prontas.
  await context.addInitScript(() => {
    window.__ls = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls.push({ t: e.startTime, v: e.value, src: e.sources.map((s) => s.node?.id || s.node?.className || s.node?.nodeName || '?') }); }).observe({ type: 'layout-shift', buffered: true });
    document.fonts?.ready.then(() => { window.__fontsAt = performance.now(); });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  return { context, page, requests, errors };
}

const results = [];
// Tempo máximo de cada cenário (E2E_CENARIO_S segundos, padrão 150): um cenário travado falha com o nome dele,
// em vez de segurar o arquivo inteiro até o limite do CI.
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  try { await Promise.race([fn(), limite(name)]); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 4).join('\n  ')}`); }
}
// Soma dos deslocamentos depois que as letras ficaram prontas (o que sobra é culpa da página, não da letra).
const clsAfterFonts = (page) => page.evaluate(() => {
  const after = window.__ls.filter((e) => e.t >= (window.__fontsAt ?? 0));
  return { cls: after.reduce((s, e) => s + e.v, 0), shifts: after.map((e) => `${Math.round(e.t)}ms ${e.v.toFixed(4)} ${e.src.join(',')}`) };
});
const settle = async (page, ms = 900) => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(ms); };
const PAGES = [
  ['index.html', '#heroTitle'],
  ['perto.html', '#list .st'],
  ['local.html?cnes=2077485', '#lcName'],
  ['cidades/sp/sao-paulo/', '#cdList .cd-item'],
  ['exames/raio-x.html', '.g-hero h1'],
  ['como-funciona.html', 'main h1'],
];

const browser = await chromium.launch();

await scenario('letras e ícones do próprio site: sem Google Fonts, sem o Font Awesome completo, ícones desenhados', async () => {
  for (const [url, ready] of PAGES) {
    const { page, requests, errors, context } = await newPage(browser);
    await page.goto(BASE + url);
    await page.waitForSelector(ready);
    if (url.startsWith('local')) { await page.locator('#lcMap').scrollIntoViewIfNeeded(); await page.waitForSelector('#lcMap .leaflet-marker-icon'); }
    await settle(page);
    const got = (re) => requests.filter((u) => re.test(u));
    assert.deepEqual(got(/fonts\.(googleapis|gstatic)\.com/), [], `${url}: nada do Google Fonts`);
    assert.deepEqual(got(/all\.min\.css|fa-(solid-900|regular-400|brands-400)\.woff2/), [], `${url}: nem o all.min.css nem as fontes completas de ícones`);
    assert.equal(got(/assets\/vendor\/fa\/css\/icones\.min\.css$/).length, 1, `${url}: icones.min.css`);
    assert.equal(got(/assets\/fonts\/inter-latin\.woff2$/).length, 1, `${url}: Inter do próprio site`);
    assert.ok(got(/icones-solid-900\.woff2$/).length === 1, `${url}: recorte dos ícones`);
    const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')));
    assert.ok(fonts.includes('Inter') && fonts.includes('Sora'), `${url}: Inter e Sora carregadas (${fonts.join(', ')})`);
    // Todo ícone na tela tem o desenho definido no CSS do recorte.
    const sem = await page.evaluate(() => [...document.querySelectorAll('.fa-solid,.fa-regular,.fa-brands')].filter((el) => el.getClientRects().length)
      .filter((el) => { const c = getComputedStyle(el, '::before').content; return !c || c === 'none' || c === 'normal' || c.length < 3; })
      .map((el) => el.className));
    assert.deepEqual(sem, [], `${url}: ícones sem desenho`);
    assert.deepEqual(errors, [], `${url}: erros no console`);
    await context.close();
  }
});

await scenario('rede de segurança: ícone fora do recorte baixa sozinho a fonte completa', async () => {
  const { page, requests, context } = await newPage(browser);
  await page.goto(BASE + 'como-funciona.html');
  await settle(page, 300);
  assert.ok(!requests.some((u) => /fa-solid-900\.woff2$/.test(u)));
  // U+F188 (inseto) não é usado no site: não está no recorte, então vem da fonte completa (o desenho não some).
  await page.evaluate(() => { const s = document.createElement('span'); s.className = 'fa-solid'; s.id = 'tst'; s.textContent = ''; document.body.append(s); });
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.waitForTimeout(300);
  assert.equal(requests.filter((u) => /fa-solid-900\.woff2$/.test(u)).length, 1, 'fonte completa pedida só agora');
  await context.close();
});

await scenario('sem pulos na tela enquanto os dados chegam (CLS): início, busca, local e cidade no celular', async () => {
  for (const [url, ready, width] of [['index.html', '#heroLite li a', 390], ['index.html', '#heroLite li a', 412], ['perto.html', '#list .st', 390], ['local.html?cnes=2077485', '#lcName', 390], ['cidades/sp/sao-paulo/', '#cdList .cd-item', 390]]) {
    const { page, context } = await newPage(browser, { slow: 500, width });
    await page.goto(BASE + url);
    if (url === 'index.html') {
      // Modo leve (celular simples): enquanto carrega, linhas de espera do tamanho das de verdade e o lugar da fonte guardado.
      await page.waitForSelector('#heroLite li.ph');
      assert.equal(await page.locator('#heroLite li.ph').count(), 4);
      assert.equal(await page.$eval('#heroSrc', (e) => getComputedStyle(e).visibility), 'hidden');
      assert.ok(await page.$eval('#heroSrc', (e) => e.getBoundingClientRect().height) >= 29, 'duas linhas guardadas no celular');
    }
    await page.waitForSelector(ready);
    await settle(page);
    if (url === 'index.html') {
      // Sem localização (o Chromium recusa sem perguntar): "o navegador não mostrou o pedido" e o exemplo da Paulista.
      assert.equal(await page.evaluate(() => document.querySelector('#reais').dataset.estado), 'naoapareceu');
      assert.equal(await page.textContent('#heroLite h2'), 'Exemplo: perto da Av. Paulista');
      assert.equal(await page.textContent('#heroSrc'), 'Fonte: CNES/Ministério da Saúde, dados de São Paulo atualizados em 27 de outubro de 2026');
      assert.equal(await page.locator('#heroLite li.ph').count(), 0);
    }
    const { cls, shifts } = await clsAfterFonts(page);
    assert.ok(cls < 0.005, `${url} (${width}px): CLS ${cls.toFixed(4)} — ${shifts.join(' | ')}`);
    await context.close();
  }
  // Início no computador, com o 3D, e sem a data do banco: a linha da fonte encolhe para uma linha (só aí mexe um pouco).
  const { page, context } = await newPage(browser, { mobile: false, slow: 300, date: null });
  await page.goto(BASE);
  // Com a máquina ocupada (outros testes ao mesmo tempo), o 3D demora: espera até 90 s.
  await page.waitForFunction(() => !document.querySelector('#heroSrc').hidden, null, { timeout: 90000 });
  await settle(page);
  assert.equal(await page.textContent('#heroSrc'), 'Fonte: CNES/Ministério da Saúde');
  const { cls } = await clsAfterFonts(page);
  assert.ok(cls < 0.01, `início no computador: CLS ${cls.toFixed(4)}`);
  await context.close();
});


await scenario('foto de satélite no celular (com a chave): a foto só depois do conteúdo, poucos pedaços, sem fontes de fora', async () => {
  const { page, requests, errors, context } = await newPage(browser, { geo: { estado: 'granted' }, satelite: true });
  await page.goto(BASE + 'index.html');
  await page.waitForFunction(() => ['satelite', 'leve'].includes(document.body.dataset.hero), null, { timeout: 60000 });
  if (await page.evaluate(() => document.body.dataset.hero) !== 'satelite') { console.log('  (sem WebGL 2 neste navegador: a versão leve)'); await context.close(); return; }
  await page.waitForFunction(() => document.querySelectorAll('.h3d-label').length >= 1);
  await page.waitForTimeout(1500);
  const t = await page.evaluate(() => {
    const fcp = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint');
    const rec = performance.getEntriesByType('resource');
    const lib = rec.find((e) => /maplibre-gl\.js/.test(e.name)), foto = rec.filter((e) => /arcgis/.test(e.name));
    return { fcp: fcp ? fcp.startTime : null, lib: lib ? lib.startTime : null, foto1: foto.length ? Math.min(...foto.map((e) => e.startTime)) : null, pedacos: foto.length, pbf: rec.filter((e) => /\.pbf$/.test(e.name)).length };
  });
  assert.ok(t.fcp != null && t.lib > t.fcp && t.foto1 > t.fcp, `conteúdo em ${Math.round(t.fcp)} ms antes da biblioteca (${Math.round(t.lib)} ms) e da foto (${Math.round(t.foto1)} ms)`);
  assert.ok(t.pedacos >= 4 && t.pedacos <= 40, `pedaços da foto no celular: ${t.pedacos} (4 a 40)`);
  assert.ok(t.pbf <= 4, `ladrilhos dos contornos: ${t.pbf} (até 4)`);
  assert.deepEqual(requests.filter((u) => /fonts\.(googleapis|gstatic)|openfreemap.*(fonts|sprites)/.test(u)), [], 'nada de fontes de fora');
  console.log(`  celular com a foto: conteúdo ${Math.round(t.fcp)} ms, biblioteca ${Math.round(t.lib)} ms, 1º pedaço ${Math.round(t.foto1)} ms, ${t.pedacos} pedaços da foto, ${t.pbf} ladrilho(s) dos contornos`);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('início com a localização já permitida (celular, 390 e 412 px): sem pulos enquanto o #nearCta e o #addrBtn mudam de texto e sem Leaflet antes do toque', async () => {
  for (const width of [390, 412]) {
    const { page, requests, errors, context } = await newPage(browser, { slow: 500, width, geo: { estado: 'granted' } });
    await page.goto(BASE + 'index.html');
    // Os textos do topo mudam com a localização: o local mais perto de verdade e a região da pessoa.
    await page.waitForFunction(() => /^Mais perto:/.test(document.querySelector('#nearCta small')?.textContent || ''));
    await page.waitForFunction(() => document.querySelector('#addrTxt').textContent === 'São Paulo - SP');
    await page.waitForSelector('#heroLite li a');
    await settle(page);
    assert.equal(await page.evaluate(() => document.querySelector('#reais').dataset.estado), 'lista');
    assert.equal(await page.textContent('#nearCta small'), 'Mais perto: Local Teste 1, a 60 m');
    assert.equal(await page.textContent('#addrSmall'), 'Sua região');
    assert.equal(await page.textContent('#heroLite h2'), 'Perto da sua localização');
    const { cls, shifts } = await clsAfterFonts(page);
    assert.ok(cls < 0.005, `início com localização (${width}px): CLS ${cls.toFixed(4)} — ${shifts.join(' | ')}`);
    // Celular: o mapa (Leaflet, imagens e pontos) só vem no toque em "Ver no mapa", nem rolando até a tela.
    await page.locator('#reais').scrollIntoViewIfNeeded();
    await page.waitForSelector('#realList li b');
    await page.waitForTimeout(600);
    assert.deepEqual(requests.filter((u) => /leaflet\.(js|css)$|tile\.openstreetmap|establishment_points/.test(u)), [], `${width}px: nada do mapa antes do toque`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('início, 1ª visita: tocar no "Encontrar clínicas perto de mim" (ou rolar até a lista) com o pedido aberto e responder 2,5 s depois não faz a tela pular', async () => {
  // A resposta chega bem depois do toque (fora da janela de 0,5 s em que o navegador desconta o que o toque mexe):
  // a tela "Clínicas perto de você" já tem o lugar das abas, do resumo, da frase das distâncias e das linhas da lista,
  // e o cartão "Aguardando sua permissão…" fica por cima das linhas de espera.
  // toque: o "Encontrar clínicas perto de mim" rola até a tela (o alto dela fica abaixo do aviso fixo do pedido);
  // lista: a pessoa rola até a lista (as linhas de espera no meio da tela).
  for (const [width, como] of [[360, 'toque'], [390, 'toque'], [412, 'toque'], [360, 'lista'], [390, 'lista']]) {
    const { page, errors, context } = await newPage(browser, { slow: 300, width, geo: { estado: 'prompt', resposta: 'permitir', atraso: 2500 } });
    await page.goto(BASE + 'index.html');
    await page.waitForSelector('#reais[data-estado="aguardando"]');
    await page.evaluate(() => document.fonts.ready);
    if (como === 'toque') await page.click('#nearCta');
    else await page.evaluate(() => document.querySelector('#realList').scrollIntoView({ block: 'center' }));
    await page.waitForFunction(() => document.querySelector('#reais').dataset.estado === 'lista', null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('#addrTxt').textContent === 'São Paulo - SP');
    await settle(page);
    // A pessoa vê a tela (ou a lista) enquanto a resposta chega.
    const alvo = como === 'toque' ? '#reais' : '#realList li';
    assert.ok(await page.$eval(alvo, (e) => { const r = e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), `${como} (${width}px): ${alvo} na tela`);
    const { cls, shifts } = await clsAfterFonts(page);
    console.log(`  ${como} (${width} px): CLS ${cls.toFixed(4)}`);
    assert.ok(cls < 0.05, `${como} (${width}px): CLS ${cls.toFixed(4)} — ${shifts.join(' | ')}`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('início numa cidade de nome comprido (Nossa Senhora do Socorro): a linha da fonte cabe no espaço guardado, sem pular', async () => {
  for (const [mobile, width] of [[true, 360], [true, 390], [false, 1280]]) {
    const { page, errors, context } = await newPage(browser, { mobile, width, slow: 500, longa: true, leve: !mobile, geo: { estado: 'granted' } });
    await page.goto(BASE + 'index.html');
    await page.waitForFunction(() => /Nossa Senhora do Socorro/.test(document.querySelector('#heroSrc').textContent), null, { timeout: 20000 });
    await settle(page);
    const linhas = await page.$eval('#heroSrc', (e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).fontSize) / 1.2));
    assert.ok(linhas <= (mobile ? 2 : 1), `${width}px: a linha da fonte ocupa ${linhas} linha(s): ${await page.textContent('#heroSrc')}`);
    assert.match(await page.textContent('#heroSrc'), /^Fonte: CNES\/Ministério da Saúde, dados de Nossa Senhora do Socorro atualizados em (27 de outubro de 2026|27\/10\/2026)$/);
    const { cls, shifts } = await clsAfterFonts(page);
    console.log(`  nome comprido (${width} px): CLS ${cls.toFixed(4)}, ${linhas} linha(s): ${await page.textContent('#heroSrc')}`);
    assert.ok(cls < 0.005, `${width}px: CLS ${cls.toFixed(4)} — ${shifts.join(' | ')}`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('busca: a explicação já vem no HTML, igual à do perto.js, e não é redesenhada', async () => {
  const sem = await newPage(browser, { js: false });
  await sem.page.goto(BASE + 'perto.html');
  const html = await sem.page.$eval('#list', (e) => e.innerHTML);
  await sem.context.close();
  assert.match(html, /Para mostrar distâncias reais/);
  const { page, errors, context } = await newPage(browser);
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      window.__trocas = 0;
      new MutationObserver((m) => { window.__trocas += m.length; }).observe(document.getElementById('list'), { childList: true, subtree: true });
    });
  });
  await page.goto(BASE + 'perto.html');
  await page.waitForFunction(() => document.getElementById('list').hasAttribute('aria-busy'));
  await settle(page, 400);
  assert.equal(await page.$eval('#list', (e) => e.innerHTML), html, 'o perto.js desenha a mesma explicação que está no HTML');
  assert.equal(await page.evaluate(() => window.__trocas), 0, 'a explicação não foi redesenhada');
  // Os botões da explicação funcionam (o perto.js escuta os cliques na lista).
  await page.click('#list [data-act="type"]');
  await page.waitForFunction(() => document.activeElement?.id === 'q');
  // Com ?demo=1 a explicação muda (botão de teste) e aí é redesenhada.
  await page.goto(BASE + 'perto.html?demo=1');
  await page.waitForSelector('#list [data-act="demo-sp"]');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('local: o Leaflet e as imagens do mapa só vêm quando o mapa chega perto da tela', async () => {
  const { page, requests, errors, context } = await newPage(browser);
  await page.goto(BASE + 'local.html?cnes=2077485');
  await page.waitForSelector('#lcName');
  await settle(page, 600);
  assert.ok(!requests.some((u) => /leaflet\.(js|css)$|tile\.openstreetmap/.test(u)), 'nada do mapa antes de rolar');
  assert.ok(await page.$eval('#lcMap', (e) => e.getBoundingClientRect().top > innerHeight + 200), 'mapa longe da primeira tela');
  await page.locator('#lcMap').scrollIntoViewIfNeeded();
  await page.waitForSelector('#lcMap .leaflet-marker-icon');
  assert.equal(requests.filter((u) => /leaflet\.js$/.test(u)).length, 1);
  assert.equal(requests.filter((u) => /leaflet\.css$/.test(u)).length, 1);
  assert.ok(requests.some((u) => /tile\.openstreetmap/.test(u)));
  assert.equal(await page.locator('#lcMap .leaflet-marker-icon').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('início: ícones dos exames na medida (96 px no topo e nas sugestões, 300 px nos cartões grandes da tela 2x)', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(BASE);
  await page.waitForSelector('#hchips .hchip img');
  assert.equal(await page.locator('#hchips .hchip').count(), 6);
  assert.match(await page.$eval('#hchips img', (i) => i.currentSrc), /ico-rm-96\.webp$/);
  await page.focus('#heroQ');
  await page.waitForSelector('#heroSug .sug img');
  await page.waitForFunction(() => document.querySelector('#heroSug .sug img').complete);
  // O navegador escolhe pela medida (e pode reaproveitar a de 300 px se ela já estiver baixada).
  const sug = await page.$eval('#heroSug .sug img', (i) => [i.getAttribute('srcset'), i.getAttribute('sizes'), i.currentSrc, i.width]);
  assert.match(sug[0], /^assets\/img\/ico-[a-z]+-96\.webp 96w, assets\/img\/ico-[a-z]+\.webp 300w$/);
  assert.deepEqual([sug[1], sug[3]], ['38px', 38]);
  assert.match(sug[2], /ico-[a-z]+(-96)?\.webp$/);
  await page.locator('#cats').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => { const i = document.querySelector('#cats .cat img'); return i && i.complete && i.currentSrc; });
  assert.match(await page.$eval('#cats .cat img', (i) => i.currentSrc), /ico-[a-z]+\.webp$/, 'cartão (96 px em tela 2x) usa a de 300 px');
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
