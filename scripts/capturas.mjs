// Capturas de tela do site no ar, com dados reais, para mostrar ao dono como está ficando (Actions → "Capturas do
// site"). Roda no GitHub porque o banco e o mapa abrem de lá. Só navega e digita: não envia pedido nem conta visita
// (o contador e qualquer escrita no banco são barrados aqui). Uso:
//   node scripts/capturas.mjs [--url=https://...] --saida=/pasta [--telas=todas|mapa3d]
// Sem --url (ou com ele vazio), vale o endereço do site em assets/js/config.js (IMED_CONFIG.siteUrl).
// --telas=mapa3d: só o mapa do topo (a foto de satélite da Esri, com a chave em config.js; sem ela, o 3D com os prédios
// do OpenStreetMap), no celular e no computador, claro e escuro, com o movimento ligado e um aparelho capaz (sem isso
// a página abre a versão leve).
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
// Endereço do site: o de assets/js/config.js, a fonte única (para trocá-lo: node scripts/trocar-endereco.mjs).
const SITE_CONFIG = readFileSync(fileURLToPath(new URL('../assets/js/config.js', import.meta.url)), 'utf8').match(/siteUrl\s*:\s*['"]([^'"]+)['"]/)[1];
const URL_SITE = (arg('url', '') || SITE_CONFIG).replace(/\/?$/, '/');
const SAIDA = arg('saida', 'capturas');
const QUAIS = arg('telas', 'todas');
mkdirSync(SAIDA, { recursive: true });

const PAULISTA = { latitude: -23.5650, longitude: -46.6520 };
const TELAS = {
  celular: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  computador: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1.5 },
};
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const feitos = [];

// Sem o aviso de privacidade por cima (a pessoa já teria respondido) e sem rede de escrita.
async function contexto(browser, tela) {
  const ctx = await browser.newContext({
    ...TELAS[tela], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', geolocation: PAULISTA, permissions: ['geolocation'],
    serviceWorkers: 'block', reducedMotion: 'reduce',
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('imed_lgpd', '1'); } catch (e) { /* sem armazenamento */ } });
  await ctx.route('**/rest/v1/**', (r) => {
    const req = r.request();
    const leitura = req.method() === 'GET' || req.method() === 'HEAD' || (req.method() === 'POST' && /\/rest\/v1\/rpc\//.test(req.url()));
    if (/\/rpc\/track\b/.test(req.url()) || !leitura) return r.fulfill({ status: 204, body: '' });
    return r.continue();
  });
  return ctx;
}

async function foto(page, nome, desc) {
  const arquivo = path.join(SAIDA, `${nome}.png`);
  await page.screenshot({ path: arquivo });
  feitos.push({ nome, desc, arquivo: path.basename(arquivo) });
  console.log(`ok  ${nome}: ${desc}`);
}

async function passo(nome, fn) {
  try { await fn(); } catch (e) { console.log(`ERRO ${nome}: ${String(e.message || e).split('\n')[0]}`); feitos.push({ nome, erro: String(e.message || e).split('\n')[0] }); }
}

// Digita sem esperar a página "parar" (a cidade 3D anima o tempo todo).
async function digitar(page, sel, texto) {
  await page.evaluate((s) => { const el = document.querySelector(s); el.scrollIntoView({ block: 'center' }); el.focus(); el.value = ''; }, sel);
  await page.keyboard.type(texto, { delay: 60 });
}

// Mapa 3D do topo: espera os prédios aparecerem e a câmera terminar a entrada; anota os ladrilhos baixados.
async function mapa3d(browser) {
  for (const tela of Object.keys(TELAS)) for (const tema of ['claro', 'escuro']) {
    await passo(`mapa3d-${tela}-${tema}`, async () => {
      const ctx = await browser.newContext({
        ...TELAS[tela], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', geolocation: PAULISTA, permissions: ['geolocation'],
        serviceWorkers: 'block', reducedMotion: 'no-preference', colorScheme: tema === 'escuro' ? 'dark' : 'light',
      });
      await ctx.addInitScript(() => {
        try { localStorage.setItem('imed_lgpd', '1'); } catch (e) { /* sem armazenamento */ }
        // Aparelho capaz (a máquina do GitHub tem 4 núcleos: no celular, a página abriria a versão leve).
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
      });
      await ctx.route('**/rest/v1/**', (r) => {
        const req = r.request();
        const leitura = req.method() === 'GET' || req.method() === 'HEAD' || (req.method() === 'POST' && /\/rest\/v1\/rpc\//.test(req.url()));
        if (/\/rpc\/track\b/.test(req.url()) || !leitura) return r.fulfill({ status: 204, body: '' });
        return r.continue();
      });
      const page = await ctx.newPage();
      const ladrilhos = [];
      page.on('requestfinished', async (req) => { if (/tiles\.openfreemap\.org|arcgis\.com/.test(req.url())) { const t = await req.sizes().catch(() => null); ladrilhos.push({ url: req.url().replace(/token=[^&]*/, 'token=…'), bytes: t ? t.responseBodySize : 0 }); } });
      await page.goto(URL_SITE, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => ['3d', 'satelite', 'leve'].includes(document.body.dataset.hero), null, { timeout: 90000 });
      const modo = await page.evaluate(() => document.body.dataset.hero);
      if (modo === 'leve') throw new Error('a página abriu a versão leve (sem o mapa do topo)');
      if (modo === 'satelite') {
        // Foto parada: espera os pedaços, os rótulos e os contornos (quando houver) chegarem.
        await page.waitForFunction(() => (window.HERO?.info?.().ladrilhos || 0) > 0 && document.querySelectorAll('.h3d-label.on').length >= 1, null, { timeout: 60000 });
        await pausa(4000);
      } else {
        await page.waitForFunction(() => (window.HERO?.info?.().predios || 0) > 0, null, { timeout: 60000 });
        await pausa(6000); // a câmera termina a entrada
        // As sombras longas são calculadas aos pedaços entre um quadro e outro: sem placa de vídeo (aqui no GitHub) os
        // quadros demoram e elas chegam depois.
        await page.waitForFunction(() => (window.HERO?.info?.().sombras || 0) > 0, null, { timeout: 40000 }).catch(() => {});
        await pausa(1500);
      }
      if (tela === 'celular') { await page.evaluate(() => { const h = document.querySelector('#hero3d'); window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 260); }); await pausa(1500); }
      const info = await page.evaluate(() => window.HERO.info());
      const pbf = ladrilhos.filter((l) => /\.pbf$/.test(l.url)), fotos = ladrilhos.filter((l) => /arcgis/.test(l.url));
      const kb = (ls) => Math.round(ls.reduce((t, l) => t + (l.bytes || 0), 0) / 1024);
      const desc = modo === 'satelite'
        ? `Foto de satélite do topo (${tela}, tema ${tema}): ${fotos.length} pedaços da foto (${kb(fotos)} KB pela rede), ${pbf.length} ladrilho(s) dos contornos (${kb(pbf)} KB), ${(info.contornos || []).length} contorno(s) de prédio`
        : `Mapa 3D do topo (${tela}, tema ${tema}): ${info.predios} prédios na tela, ${pbf.length} ladrilhos (${kb(pbf)} KB pela rede), ${info.sombras} sombras`;
      await foto(page, `mapa3d-${tela}-${tema}`, desc);
      writeFileSync(path.join(SAIDA, `mapa3d-${tela}-${tema}.json`), JSON.stringify({ modo, info, ladrilhos }, null, 1));
      await ctx.close();
    });
  }
}

const browser = await chromium.launch();
if (QUAIS === 'mapa3d') await mapa3d(browser);
for (const tela of QUAIS === 'mapa3d' ? [] : Object.keys(TELAS)) {
  const ctx = await contexto(browser, tela);
  const page = await ctx.newPage();

  await passo(`${tela}-inicio`, async () => {
    await page.goto(URL_SITE, { waitUntil: 'domcontentloaded' });
    await page.locator('#realList li').first().waitFor({ timeout: 25000 });
    await pausa(1500);
    await foto(page, `${tela}-01-inicio`, 'Página inicial: topo');
  });

  await passo(`${tela}-perto`, async () => {
    await page.evaluate(() => document.querySelector('#reais')?.scrollIntoView({ block: 'start' }));
    await pausa(1500);
    await foto(page, `${tela}-02-perto-de-voce`, 'Clínicas perto de você (localização na Av. Paulista)');
  });

  await passo(`${tela}-seletor`, async () => {
    await page.evaluate(() => document.querySelector('#addrBtn')?.click());
    await pausa(1500);
    await foto(page, `${tela}-03-escolher-cidade`, 'Escolher a cidade (seletor)');
    await page.keyboard.press('Escape');
    await pausa(600);
  });

  await passo(`${tela}-hemograma`, async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await pausa(500);
    await digitar(page, '#heroQ', 'hemograma');
    await page.locator('#heroSug .sug').first().waitFor({ timeout: 10000 });
    await pausa(900);
    await foto(page, `${tela}-04-busca-hemograma`, 'Busca pelo nome popular: "hemograma" leva aos laboratórios');
  });

  await passo(`${tela}-eco`, async () => {
    await digitar(page, '#heroQ', 'eco');
    await pausa(700);
    await page.keyboard.press('Enter');
    await pausa(1200);
    await foto(page, `${tela}-05-busca-eco`, '"eco" pode ser ecocardiograma ou ultrassom: o site pergunta');
  });

  await passo(`${tela}-campinas`, async () => {
    await page.goto(`${URL_SITE}perto.html`, { waitUntil: 'domcontentloaded' });
    await digitar(page, '#q', 'ressonância em Campinas');
    await page.keyboard.press('Enter');
    await page.locator('#list .pc').first().waitFor({ timeout: 30000 });
    await pausa(2500);
    await foto(page, `${tela}-06-ressonancia-em-campinas`, 'Busca "ressonância em Campinas": filtro do exame e o mapa em Campinas');
  });

  await ctx.close();
}
if (QUAIS === 'todas') await mapa3d(browser);
await browser.close();

writeFileSync(path.join(SAIDA, 'resumo.json'), JSON.stringify({ url: URL_SITE, feitos }, null, 2));
const erros = feitos.filter((f) => f.erro);
console.log(`${feitos.length - erros.length} capturas, ${erros.length} erros`);
