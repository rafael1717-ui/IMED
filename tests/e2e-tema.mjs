// Teste de ponta a ponta do tema claro/escuro (assets/js/tema.js e assets/css/tema.css) num Chromium de verdade
// (Playwright), com o banco e a internet desligados. Confere:
//  - Automático segue o aparelho (emulateMedia colorScheme) na hora, com a barra do navegador (theme-color) junto;
//  - a escolha vale para todas as páginas (raiz, exames/, cidades/, 404) e para as outras abas abertas;
//  - sem piscar: o <html> já tem o tema antes do <body> e da primeira pintura (e o fundo já é o certo no 1º quadro);
//  - impressão sempre clara, mesmo com Escuro escolhido ou com o aparelho escuro;
//  - botões de tema pelo teclado e leitor de tela: grupo "Tema" do rodapé e o botão do cabeçalho (rótulo certo,
//    aria-pressed, foco visível, 44 px no celular, aviso falado);
//  - sem armazenamento (bloqueado): segue o aparelho, sem erro;
//  - mapa: no escuro, só o painel dos ladrilhos ganha filtro (marcadores não);
//  - modo claro igual ao de hoje (os tokens de cada página continuam valendo).
// O site roda como no GitHub Pages (no caminho do siteUrl, com a página 404).
// Rodar com: node tests/e2e-tema.mjs   (precisa do pacote "playwright" instalado)
// Opcional: E2E_PORT=4871 node tests/e2e-tema.mjs  usa outra porta (padrão 4870; faixa deste teste: 4870 a 4874).
//           SHOTS=pasta  salva uma captura de tela de cada cenário que falhar.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CAMINHO, semCaminho } from './endereco.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.E2E_PORT) || 4870;
const SHOTS = process.env.SHOTS || '';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+F9PQAJYwN6V0E0WwAAAABJRU5ErkJggg==', 'base64');
const ESCURO_BG = '#0A1C25';
const CLARO_BARRA = '#05161e';

// Servidor como o GitHub Pages: o site mora no caminho do siteUrl (tests/endereco.mjs) e o que não existe recebe o 404.html.
const server = http.createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  path = semCaminho(path);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  let body;
  try { body = await readFile(file); } catch { body = null; }
  if (body) res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  else res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(await readFile(join(ROOT, '404.html')));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${PORT}${CAMINHO}`;

// Contexto do navegador. guardado: escolha já no aparelho ao abrir; semArmazenamento: localStorage bloqueado.
async function abrir(browser, { escuro = false, guardado, semArmazenamento = false, celular = false, largura } = {}) {
  const context = await browser.newContext({
    viewport: celular ? { width: largura || 390, height: 800 } : { width: 1280, height: 860 }, isMobile: celular, hasTouch: celular,
    colorScheme: escuro ? 'dark' : 'light', reducedMotion: 'reduce', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block',
  });
  await context.addInitScript(([o]) => {
    if (o.semArmazenamento) {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('armazenamento bloqueado', 'SecurityError'); } });
    } else {
      try {
        localStorage.setItem('imed_lgpd', '1');
        if (o.guardado !== undefined && !sessionStorage.getItem('__tema')) { localStorage.setItem('imed_tema', o.guardado); sessionStorage.setItem('__tema', '1'); }
      } catch { /* sem armazenamento */ }
    }
    // Quando o tema chegou no <html>, em relação ao <body> e à primeira pintura, e o que o 1º quadro viu.
    const t = { attrAt: null, temaAntesDoBody: null, rafTema: null, rafBg: null };
    window.__tema = t;
    new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === 'attributes' && t.attrAt === null) t.attrAt = performance.now();
        if (r.type === 'childList' && t.temaAntesDoBody === null && [...r.addedNodes].some((n) => n.nodeName === 'BODY')) t.temaAntesDoBody = t.attrAt !== null ? document.documentElement.getAttribute('data-theme') : 'nenhum';
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-theme'] });
    requestAnimationFrame(() => {
      t.rafTema = document.documentElement.getAttribute('data-theme');
      t.rafBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    });
  }, [{ guardado, semArmazenamento }]);
  await context.route('https://pyoqiecupxhdzigjudyd.supabase.co/**', (r) => r.abort('internetdisconnected'));
  await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await context.route(/https:\/\/(fonts\.googleapis|fonts\.gstatic|overpass)/, (r) => r.abort());
  const erros = [];
  context.on('weberror', (e) => erros.push(e.error()));
  const page = await context.newPage();
  return { context, page, erros };
}

// Estado do tema na página.
const estado = (page) => page.evaluate(() => {
  const h = document.documentElement, cs = getComputedStyle(h);
  return {
    theme: h.getAttribute('data-theme'), escolha: h.getAttribute('data-tema-escolha'),
    bg: cs.getPropertyValue('--bg').trim(), ink: cs.getPropertyValue('--ink').trim(), scheme: cs.colorScheme,
    barra: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content),
    guardado: (() => { try { return localStorage.getItem('imed_tema'); } catch { return 'sem armazenamento'; } })(),
    marcado: [...document.querySelectorAll('.rd-tema [aria-pressed="true"]')].map((b) => b.dataset.temaOpcao),
  };
});
const esperarTema = (page, theme) => page.waitForFunction((t) => document.documentElement.getAttribute('data-theme') === t, theme, { timeout: 5000 });
// Erros de script só do tema (os do resto da página sem internet não são deste teste).
const errosDoTema = (erros) => erros.filter((e) => /tema\.js|IMED_TEMA/.test(`${e?.message}\n${e?.stack}`));

const results = [];
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 120) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
let ultima = null; // página aberta no cenário (para a captura de tela quando falha)
async function scenario(name, fn) {
  try { await Promise.race([fn(), limite(name)]); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) {
    results.push(['FALHOU', name]);
    console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 6).join('\n  ')}`);
    if (SHOTS && ultima) await ultima.screenshot({ path: join(SHOTS, `erro-${name.replace(/\W+/g, '-').slice(0, 60)}.png`), fullPage: true }).catch(() => {});
  }
}

const browser = await chromium.launch();

await scenario('Automático segue o aparelho na hora (emulateMedia), com a barra do navegador junto', async () => {
  const { context, page, erros } = await abrir(browser);
  ultima = page;
  await page.goto(`${SITE}sobre.html`);
  let s = await estado(page);
  assert.deepEqual([s.theme, s.escolha, s.bg, s.scheme, s.barra, s.guardado, s.marcado], ['light', 'auto', '#fff', 'normal', [CLARO_BARRA], null, ['auto']]);
  await page.evaluate(() => { window.__ev = []; document.addEventListener('imed:tema', (e) => window.__ev.push(e.detail)); });
  await page.emulateMedia({ colorScheme: 'dark' });
  await esperarTema(page, 'dark');
  s = await estado(page);
  assert.deepEqual([s.escolha, s.bg, s.ink, s.scheme, s.barra, s.guardado], ['auto', ESCURO_BG, '#EAF3F6', 'dark', [ESCURO_BG], null]);
  assert.deepEqual(await page.evaluate(() => window.__ev), [{ escolha: 'auto', tema: 'escuro' }], 'evento imed:tema');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('tema-trocando')), false, 'transições de volta depois da troca');
  await page.emulateMedia({ colorScheme: 'light' });
  await esperarTema(page, 'light');
  s = await estado(page);
  assert.deepEqual([s.bg, s.barra], ['#fff', [CLARO_BARRA]], 'volta a cor de hoje');
  assert.deepEqual(errosDoTema(erros), []);
  await context.close();
});

await scenario('a escolha vale em todas as páginas (raiz, exames, cidades, 404) e nas outras abas', async () => {
  const { context, page, erros } = await abrir(browser);
  ultima = page;
  await page.goto(`${SITE}sobre.html`);
  await page.click('.rd-tema [data-tema-opcao="escuro"]');
  let s = await estado(page);
  assert.deepEqual([s.theme, s.escolha, s.guardado, s.marcado, s.barra], ['dark', 'escuro', 'escuro', ['escuro'], [ESCURO_BG]]);
  // Outra aba já abre escura.
  const aba = await context.newPage();
  ultima = aba;
  for (const url of ['exames/raio-x.html', 'cidades/sp/sao-paulo/', 'cidades/sp/sao-paulo/clinicas.html', 'nao-existe', 'perto.html', '']) {
    await aba.goto(SITE + url);
    s = await estado(aba);
    assert.deepEqual([s.theme, s.escolha, s.bg, s.marcado, s.barra], ['dark', 'escuro', ESCURO_BG, ['escuro'], [ESCURO_BG]], url || 'início');
    assert.equal(await aba.evaluate(() => window.__tema.rafTema), 'dark', `${url}: escuro já no 1º quadro`);
  }
  // Mudou numa aba: a outra acompanha sem recarregar.
  await page.click('.rd-tema [data-tema-opcao="claro"]');
  await esperarTema(aba, 'light');
  s = await estado(aba);
  assert.deepEqual([s.escolha, s.marcado, s.guardado], ['claro', ['claro'], 'claro']);
  await aba.goto(`${SITE}nao-existe`); // página 404 (caminhos absolutos)
  await aba.click('.rd-tema [data-tema-opcao="escuro"]');
  await esperarTema(page, 'dark');
  // Automático: tira a escolha do aparelho e segue o aparelho (claro aqui).
  await page.click('.rd-tema [data-tema-opcao="auto"]');
  await esperarTema(aba, 'light');
  s = await estado(page);
  assert.deepEqual([s.theme, s.escolha, s.guardado], ['light', 'auto', null]);
  assert.deepEqual(errosDoTema(erros), []);
  await context.close();
});

await scenario('sem piscar: o tema chega no <html> antes do <body>, do 1º quadro e da primeira pintura', async () => {
  for (const [escuro, guardado, theme, bg] of [[false, 'escuro', 'dark', ESCURO_BG], [true, 'claro', 'light', '#fff'], [true, undefined, 'dark', ESCURO_BG]]) {
    const { context, page, erros } = await abrir(browser, { escuro, guardado });
    ultima = page;
    for (const url of ['sobre.html', 'exames/raio-x.html', 'cidades/sp/sao-paulo/clinicas.html', 'perto.html', 'nao-existe']) {
      await page.goto(SITE + url);
      await page.waitForLoadState('load');
      // Com a máquina cheia, o 1º quadro pode vir depois do "load": espera ele acontecer (o valor é o que ele viu).
      await page.waitForFunction(() => window.__tema && window.__tema.rafTema !== null, null, { timeout: 15000 });
      const t = await page.evaluate(() => {
        const fp = performance.getEntriesByType('paint').find((e) => e.name === 'first-paint');
        return { ...window.__tema, firstPaint: fp ? fp.startTime : null };
      });
      const caso = `${url} (aparelho ${escuro ? 'escuro' : 'claro'}, escolha ${guardado || 'automático'})`;
      assert.equal(t.temaAntesDoBody, theme, `${caso}: tema no <html> antes do <body>`);
      assert.equal(t.rafTema, theme, `${caso}: tema no 1º quadro`);
      assert.equal(t.rafBg, bg, `${caso}: fundo certo no 1º quadro`);
      if (t.firstPaint !== null) assert.ok(t.attrAt <= t.firstPaint, `${caso}: tema (${t.attrAt.toFixed(1)} ms) antes da 1ª pintura (${t.firstPaint.toFixed(1)} ms)`);
    }
    assert.deepEqual(errosDoTema(erros), []);
    await context.close();
  }
});

await scenario('impressão sempre clara (Escuro escolhido ou aparelho escuro) e a tela volta escura', async () => {
  for (const [escuro, guardado] of [[false, 'escuro'], [true, undefined]]) {
    const { context, page } = await abrir(browser, { escuro, guardado });
    ultima = page;
    await page.goto(`${SITE}sobre.html`);
    assert.equal((await estado(page)).bg, ESCURO_BG);
    await page.emulateMedia({ media: 'print' });
    let s = await estado(page);
    assert.deepEqual([s.theme, s.bg, s.ink, s.scheme], ['dark', '#fff', '#0F1F28', 'normal'], 'na impressão, tokens claros e sem color-scheme escuro');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)');
    const pdf = await page.pdf({ format: 'A4' });
    assert.ok(pdf.length > 1000, 'PDF gerado');
    await page.emulateMedia({ media: 'screen' });
    s = await estado(page);
    assert.equal(s.bg, ESCURO_BG);
    await context.close();
  }
});

await scenario('botões pelo teclado e leitor de tela: grupo "Tema" do rodapé e botão do cabeçalho', async () => {
  const { context, page, erros } = await abrir(browser);
  ultima = page;
  await page.goto(`${SITE}perto.html`);
  const grupo = page.getByRole('group', { name: 'Tema' });
  assert.equal(await grupo.count(), 1);
  assert.deepEqual(await grupo.getByRole('button').allTextContents(), ['Automático', 'Claro', 'Escuro']);
  assert.equal(await grupo.getByRole('button', { name: 'Automático', pressed: true }).count(), 1);
  // Tab a partir do último link antes do grupo (o 192): chega em "Automático", com foco visível.
  await page.focus('.rd-sos a');
  await page.keyboard.press('Tab');
  const foco = () => page.evaluate(() => {
    const el = document.activeElement, cs = getComputedStyle(el);
    return { opcao: el.dataset.temaOpcao ?? null, tema: el.hasAttribute('data-tema'), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` };
  });
  assert.deepEqual(await foco(), { opcao: 'auto', tema: false, outline: 'solid 3px rgb(127, 240, 228)' });
  await page.keyboard.press('Tab');
  assert.equal((await foco()).opcao, 'claro');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space'); // Escuro, pela barra de espaço
  await esperarTema(page, 'dark');
  assert.equal(await grupo.getByRole('button', { name: 'Escuro', pressed: true }).count(), 1);
  await page.waitForFunction(() => document.querySelector('.tema-fala')?.textContent === 'Tema escuro');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter'); // Claro, pelo Enter
  await esperarTema(page, 'light');
  await page.waitForFunction(() => document.querySelector('.tema-fala')?.textContent === 'Tema claro');
  assert.equal(await page.locator('.tema-fala[role="status"]').count(), 1, 'uma região só para o leitor de tela');
  // Botão do cabeçalho de verdade (o do topo da busca).
  assert.equal(await page.locator('.pt-top .tema-btn').count(), 1, 'um botão de tema no topo');
  const cab = page.locator('.pt-top .tema-btn');
  const box = await cab.boundingBox();
  assert.ok(box.width >= 44 && box.height >= 44, `44 px (${box.width}x${box.height})`);
  assert.equal(await page.getByRole('button', { name: 'Tema: claro' }).count(), 1);
  const icone = () => cab.evaluate((b) => getComputedStyle(b, '::before').getPropertyValue('mask-image') || getComputedStyle(b, '::before').getPropertyValue('-webkit-mask-image'));
  const icones = new Set([await icone()]);
  await cab.focus();
  for (const [tecla, escolha, theme] of [['Enter', 'escuro', 'dark'], ['Space', 'auto', 'light'], ['Enter', 'claro', 'light']]) {
    await page.keyboard.press(tecla);
    await page.waitForFunction((e) => document.documentElement.getAttribute('data-tema-escolha') === e, escolha);
    const nome = `Tema: ${{ auto: 'automático', claro: 'claro', escuro: 'escuro' }[escolha]}`;
    assert.equal(await page.getByRole('button', { name: nome }).count(), 1, nome);
    assert.equal(await cab.getAttribute('title'), nome);
    const s = await estado(page);
    assert.deepEqual([s.theme, s.marcado], [theme, [escolha]], `${tecla}: rodapé acompanha`);
    icones.add(await icone());
  }
  assert.equal(icones.size, 3, 'um ícone para cada escolha');
  const f = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return [document.activeElement.className, cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2]; });
  assert.deepEqual(f, ['tema-btn', true], 'foco visível no botão do cabeçalho');
  assert.deepEqual(errosDoTema(erros), []);
  await context.close();
});

await scenario('celular (360 e 390 px): botões do rodapé com 44 px, numa linha e sem rolar para o lado', async () => {
  for (const largura of [360, 390]) {
    const { context, page } = await abrir(browser, { celular: true, largura, escuro: true });
    ultima = page;
    await page.goto(`${SITE}exames/raio-x.html`);
    const b = await page.evaluate(() => [...document.querySelectorAll('.rd-tema-op button')].map((x) => { const r = x.getBoundingClientRect(); return { w: r.width, h: r.height, top: Math.round(r.top) }; }));
    assert.equal(b.length, 3);
    for (const x of b) assert.ok(x.h >= 44 && x.w >= 44, `${largura}px: ${JSON.stringify(x)}`);
    assert.equal(new Set(b.map((x) => x.top)).size, 1, `${largura}px: as três opções na mesma linha`);
    assert.ok(await page.evaluate((l) => document.documentElement.scrollWidth <= l, largura), `${largura}px: sem rolagem para o lado`);
    await context.close();
  }
});

await scenario('sem armazenamento (bloqueado): segue o aparelho, a escolha vale só nesta página, sem erro', async () => {
  const { context, page, erros } = await abrir(browser, { escuro: true, semArmazenamento: true });
  ultima = page;
  await page.goto(`${SITE}sobre.html`);
  let s = await estado(page);
  assert.deepEqual([s.theme, s.escolha, s.guardado], ['dark', 'auto', 'sem armazenamento']);
  await page.click('.rd-tema [data-tema-opcao="claro"]');
  await esperarTema(page, 'light');
  await page.reload();
  s = await estado(page);
  assert.deepEqual([s.theme, s.escolha], ['dark', 'auto'], 'sem guardar: volta a seguir o aparelho');
  assert.deepEqual(errosDoTema(erros), []);
  await context.close();
});

await scenario('mapa: no escuro só o painel dos ladrilhos ganha filtro; marcadores e balões não', async () => {
  const { context, page } = await abrir(browser);
  ultima = page;
  await page.goto(`${SITE}sobre.html`);
  const filtros = () => page.evaluate(() => {
    let m = document.querySelector('.mapa-falso');
    if (!m) {
      m = document.createElement('div');
      m.className = 'mapa-falso leaflet-container';
      m.innerHTML = '<div class="leaflet-pane leaflet-tile-pane"></div><div class="leaflet-pane leaflet-marker-pane"></div><div class="leaflet-pane leaflet-popup-pane"></div>';
      document.body.appendChild(m);
    }
    return [...m.children].map((p) => getComputedStyle(p).filter);
  });
  assert.deepEqual(await filtros(), ['none', 'none', 'none']);
  await page.evaluate(() => window.IMED_TEMA.escolher('escuro'));
  const [ladrilhos, marcadores, baloes] = await filtros();
  assert.match(ladrilhos, /invert\(1\)/);
  assert.deepEqual([marcadores, baloes], ['none', 'none']);
  await context.close();
});

await scenario('modo claro igual ao de hoje: os tokens de cada página continuam valendo', async () => {
  const { context, page } = await abrir(browser);
  ultima = page;
  const casos = [
    ['painel.html', { '--line': '#E1E9EE', '--bg': '#fff', '--primary': '#0B7290' }], // clinica.css tem a borda própria
    ['sobre.html', { '--line': '#E6EDF1', '--ink': '#0F1F28' }],
    ['', { '--bg': '#fff', '--muted': '#566874', '--sh3': '0 40px 100px rgba(5,22,30,.35)' }],
  ];
  for (const [url, esperado] of casos) {
    await page.goto(SITE + url);
    const got = await page.evaluate((ks) => Object.fromEntries(ks.map((k) => [k, getComputedStyle(document.documentElement).getPropertyValue(k).trim()])), Object.keys(esperado));
    assert.deepEqual(got, esperado, url || 'início');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'normal');
    assert.deepEqual((await estado(page)).barra, [CLARO_BARRA]);
  }
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
