// Teste de ponta a ponta (Playwright), com o banco simulado, das perguntas frequentes das páginas de cidade e de
// tipo (scripts/gerar-cidades.mjs), do llms.txt, do sitemap e da caixa "O que levar" dos 8 guias de exames:
// - as perguntas ficam abertas na página, com os números de scripts/cidades.json e a data, e o JSON-LD FAQPage tem
//   o mesmo texto;
// - as respostas batem com as regras publicadas em Como funciona, Quem somos e Termos de uso;
// - "do/no Rio de Janeiro" e "da/na Serra" nas perguntas e no parágrafo do topo;
// - o llms.txt e o sitemap apontam só para páginas que existem, e o sitemap tem todas as páginas fixas;
// - os 8 guias têm "O que levar" (só logística) depois do preparo, com "confirme com o local";
// - no celular, nada passa da tela a 390 px nem a 360 px.
// Rodar com: node tests/e2e-cidades-faq.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta node tests/e2e-cidades-faq.mjs  salva capturas de tela nessa pasta.
//           E2E_PORT=4825 node tests/e2e-cidades-faq.mjs  usa outra porta (padrão 4821), para rodar em paralelo.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { comChaves, vigiarChaves } from './regra-chaves.mjs';
import { semCaminho } from './endereco.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const PORT = Number(process.env.E2E_PORT) || 4821; // E2E_PORT: outra porta para rodar em paralelo
const REST = 'https://pyoqiecupxhdzigjudyd.supabase.co/rest/v1/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };

// Servidor como o GitHub Pages: o site mora no caminho do siteUrl (tests/endereco.mjs; a 404 usa esse caminho) e o que não existe
// recebe o 404.html.
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
const BASE = `http://127.0.0.1:${PORT}/`;

// Endereço publicado do site (assets/js/config.js): o llms.txt e o sitemap usam ele; aqui vira o servidor local.
const SITE = readFileSync(join(ROOT, 'assets/js/config.js'), 'utf8').match(/siteUrl\s*:\s*['"]([^'"]+)['"]/)[1];
const local = (url) => (url.startsWith(SITE) ? BASE + url.slice(SITE.length) : null);
const CIDADES = JSON.parse(readFileSync(join(ROOT, 'scripts/cidades.json'), 'utf8'));
const fmt = (n) => Number(n).toLocaleString('pt-BR');
const SP = CIDADES.find((c) => c.ibge === 3550308);
const RJ = CIDADES.find((c) => c.ibge === 3304557);
const GUIAS = ['densitometria-ossea', 'ecocardiograma', 'eletrocardiograma', 'mamografia', 'raio-x', 'ressonancia-magnetica', 'tomografia', 'ultrassom'];

// Lista da cidade (city_establishments): estabelecimentos de teste, com o total como o banco devolve.
const KINDS = ['clinica', 'imagem', 'laboratorio', 'hospital'];
const ROWS = Array.from({ length: 24 }, (_, i) => ({
  cnes: String(9000001 + i), name: `Estabelecimento de teste ${i + 1}`, kind: KINDS[i % 4], address_line: `Rua de Teste, ${i + 1}`, neighborhood: 'Centro', cep: '01001000',
  phone: null, shift: i % 3 ? null : 'Manhã e tarde', open_24h: false, sus: i % 2 === 0, services: [], lat: -23.55, lng: -46.63,
}));
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, PATCH, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: cors });

async function newPage(browser, { mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 },
    isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', reducedMotion: 'reduce',
  });
  const log = { list: 0 };
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  // Banco: só a lista da cidade responde com linhas; o resto, vazio.
  await context.route(`${REST}**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.url().includes('rpc/city_establishments')) {
      log.list += 1;
      const body = JSON.parse(req.postData() || '{}');
      const all = ROWS.filter((r) => !body.p_kind || r.kind === body.p_kind);
      return json(route, all.slice(body.p_offset ?? 0, (body.p_offset ?? 0) + (body.p_limit ?? 60)).map((r) => ({ ...r, total: all.length })));
    }
    return json(route, []);
  });
  await context.addInitScript(() => { try { localStorage.setItem('imed_lgpd', '1'); } catch { /* ignora */ } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, log, errors };
}

const shot = async (page, name, full = true) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: full }); } };
const results = [];
// Tempo máximo de cada cenário (E2E_CENARIO_S segundos, padrão 150): um cenário travado falha com o nome dele,
// em vez de segurar o arquivo inteiro até o limite do CI.
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  try { await Promise.race([comChaves(fn), limite(name)]); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 5).join('\n  ')}`); }
}
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const noOverflow = async (page, name) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(o <= 0, `${name}: sem rolagem lateral (${o}px)`);
};
// Celular: sem rolagem lateral a 390 px e a 360 px (celular pequeno); no fim, a tela volta ao tamanho de antes.
const noOverflowCelular = async (page, name) => {
  const vp = page.viewportSize();
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: vp.height });
    await noOverflow(page, `${name} (${width} px)`);
  }
  await page.setViewportSize(vp);
};
// Posição de um elemento na tela, para conferir as margens.
const caixa = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right) }; });

// Perguntas e respostas da página (como aparecem na tela) e as do JSON-LD FAQPage.
async function faqDaTela(page) {
  const visiveis = await page.$$eval('.cd-faq-item', (els) => els.map((e) => ({ q: e.querySelector('h3').textContent, a: e.querySelector('p').textContent })));
  const ld = await page.$$eval('script[type="application/ld+json"]', (els) => els.map((e) => JSON.parse(e.textContent)).find((o) => o['@type'] === 'FAQPage'));
  return { visiveis, ld };
}
// A data dos números no topo da página ("Números atualizados em 30 de outubro de 2026.").
const dataDoTopo = async (page) => (await page.textContent('.cd-lead')).match(/Números atualizados em ([^.]+)\./)[1];

const browser = vigiarChaves(await chromium.launch());

await scenario('cidade (computador): perguntas abertas na tela, com os números do cidades.json, a data e o mesmo texto do JSON-LD', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}cidades/sp/sao-paulo/`);
  await page.waitForSelector('#cdList .cd-item');
  assert.equal(log.list, 1);
  const faq = page.locator('section.cd-faq');
  assert.equal(await faq.count(), 1);
  assert.equal(squash(await page.textContent('#faqTitle')), 'Perguntas frequentes');
  assert.equal(await page.getAttribute('section.cd-faq', 'aria-labelledby'), 'faqTitle');
  const { visiveis, ld } = await faqDaTela(page);
  assert.deepEqual(visiveis.map((it) => it.q), [
    'Quantos locais de saúde de São Paulo aparecem no IMED?',
    'O IMED é plano de saúde ou cartão de desconto?',
    'Buscar e pedir agendamento pelo IMED é grátis?',
    'O horário já fica marcado quando faço o pedido?',
    'Os locais de São Paulo atendem pelo SUS?',
  ]);
  // Respostas abertas (sem clicar), uma depois da outra.
  for (const p of await page.locator('.cd-faq-item p').all()) assert.ok(await p.isVisible(), 'resposta visível');
  // Quantos locais por tipo: os números do cidades.json e a mesma data do topo da página.
  const data = await dataDoTopo(page);
  assert.equal(visiveis[0].a, `O IMED mostra ${fmt(SP.total)} estabelecimentos de saúde em São Paulo (SP), do cadastro oficial do Ministério da Saúde (CNES): ${fmt(SP.imagem)} centros de diagnóstico por imagem, ${fmt(SP.laboratorio)} laboratórios, ${fmt(SP.clinica)} clínicas e ${fmt(SP.hospital)} hospitais. Números atualizados em ${data}.`);
  assert.match(data, /^\d{1,2} de [a-zç]+ de \d{4}$/);
  // Não é plano; grátis só buscar, pedir e cancelar; horário só com "Confirmado"; SUS pelo CNES, com "confirme".
  assert.match(visiveis[1].a, /^Não\. /);
  assert.match(visiveis[2].a, /^Para o paciente, sim: buscar, pedir e cancelar o pedido pelo IMED não têm custo\./);
  assert.match(visiveis[3].a, /^Só quando o pedido aparece como Confirmado/);
  assert.match(visiveis[4].a, /cadastro oficial \(CNES\) e pode estar desatualizada: confirme com o local\./);
  const t = squash(await faq.textContent());
  assert.ok(!/sempre|gratuit|R\$|★|garant/i.test(t), 'sem promessa, preço ou nota');
  // O JSON-LD tem o mesmo texto da tela.
  assert.deepEqual(ld.mainEntity.map((q) => ({ q: q.name, a: q.acceptedAnswer.text })), visiveis);
  // Lugar: depois da lista e antes de "Sua clínica está nesta lista?".
  const ordem = await page.evaluate(() => ['#cdList', '.cd-faq', '.cd-claim', '.cd-src'].map((s) => document.querySelector(s).getBoundingClientRect().top + scrollY));
  assert.ok(ordem.every((y, i) => !i || y > ordem[i - 1]), `ordem na tela: ${ordem}`);
  // Estilo do bloco carregou (cartões brancos com borda).
  assert.equal(await page.$eval('.cd-faq-item', (e) => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)');
  assert.equal(await page.$eval('.cd-faq-item h3', (e) => getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '')), 'Sora');
  await faq.scrollIntoViewIfNeeded();
  await shot(page, 'cidade-faq-computador');
  assert.deepEqual(errors, [], 'sem erro (nem de Content-Security-Policy)');
  await context.close();
});

await scenario('tipo no celular (hospitais de São Paulo): número do tipo, emergência no topo e sem rolagem lateral', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(`${BASE}cidades/sp/sao-paulo/hospitais.html`);
  await page.waitForSelector('#cdList .cd-item');
  const { visiveis, ld } = await faqDaTela(page);
  assert.equal(visiveis.length, 5);
  assert.equal(visiveis[0].q, 'Quantos hospitais de São Paulo aparecem no IMED?');
  assert.equal(visiveis[0].a, `O IMED mostra ${fmt(SP.hospital)} hospitais em São Paulo (SP), do cadastro oficial do Ministério da Saúde (CNES). Na cidade toda, são ${fmt(SP.total)} estabelecimentos de saúde no IMED: ${fmt(SP.imagem)} centros de diagnóstico por imagem, ${fmt(SP.laboratorio)} laboratórios, ${fmt(SP.clinica)} clínicas e ${fmt(SP.hospital)} hospitais. Números atualizados em ${await dataDoTopo(page)}.`);
  assert.equal(visiveis[4].q, 'Os hospitais de São Paulo atendem pelo SUS?');
  assert.deepEqual(ld.mainEntity.map((q) => ({ q: q.name, a: q.acceptedAnswer.text })), visiveis);
  // O aviso de emergência continua no topo da página de hospitais.
  assert.match(await page.textContent('.cd-hero .cd-sos'), /Emergência\? Ligue 192 \(SAMU\)/);
  // "Veja também" antes das perguntas; perguntas antes de "Assumir o cadastro".
  const ordem = await page.evaluate(() => ['#cdList', '.cd-also', '.cd-faq', '.cd-claim'].map((s) => document.querySelector(s).getBoundingClientRect().top + scrollY));
  assert.ok(ordem.every((y, i) => !i || y > ordem[i - 1]), `ordem na tela: ${ordem}`);
  // Celular: cartões do tamanho da tela, letra legível e sem rolagem lateral.
  const box = await page.$eval('.cd-faq-item', (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, font: parseFloat(getComputedStyle(e.querySelector('p')).fontSize) }; });
  assert.ok(box.left >= 16 && box.right <= 390 - 16, `margens do cartão: ${JSON.stringify(box)}`);
  assert.ok(box.font >= 15, `letra das respostas: ${box.font}px`);
  await noOverflowCelular(page, 'hospitais de São Paulo');
  await page.locator('.cd-faq').scrollIntoViewIfNeeded();
  await shot(page, 'tipo-faq-celular');
  // Celular pequeno (360 px): os cartões e a fonte das regras continuam dentro da tela, com margem.
  await page.setViewportSize({ width: 360, height: 780 });
  for (const sel of ['.cd-faq-item', '.cd-faq-src', '.cd-also']) {
    const b = await caixa(page, sel);
    assert.ok(b.left >= 16 && b.right <= 360 - 16, `${sel} a 360 px: ${JSON.stringify(b)}`);
  }
  await page.locator('.cd-faq').scrollIntoViewIfNeeded();
  await shot(page, 'tipo-faq-celular-360');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('cidade pequena, Rio de Janeiro e Serra: singular, só os tipos que existem, "do/no Rio de Janeiro" e "da/na Serra"', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true });
  // A cidade com menos locais no cidades.json, e um tipo com 1 local nela.
  const pequena = [...CIDADES].sort((a, b) => a.total - b.total)[0];
  const tipos = [['imagem', 'diagnostico-por-imagem', 'centro de diagnóstico por imagem'], ['laboratorio', 'laboratorios', 'laboratório'], ['clinica', 'clinicas', 'clínica'], ['hospital', 'hospitais', 'hospital']];
  const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const dir = `cidades/${pequena.uf.toLowerCase()}/${slug(pequena.name)}/`;
  await page.goto(BASE + dir);
  await page.waitForSelector('.cd-faq-item');
  const { visiveis } = await faqDaTela(page);
  const existem = tipos.filter(([k]) => pequena[k] > 0);
  const partes = existem.map(([k, , um]) => `${fmt(pequena[k])} ${pequena[k] === 1 ? um : ({ imagem: 'centros de diagnóstico por imagem', laboratorio: 'laboratórios', clinica: 'clínicas', hospital: 'hospitais' })[k]}`);
  assert.ok(visiveis[0].a.includes(`: ${partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)}` : partes[0]}. Números atualizados em`), visiveis[0].a);
  for (const [k] of tipos.filter(([kk]) => !pequena[kk])) assert.ok(!visiveis[0].a.includes(` 0 `), `${k}: tipo sem local não aparece`);
  const [k1, arquivo, um] = existem.find(([k]) => pequena[k] === 1) ?? existem[0];
  await page.goto(`${BASE}${dir}${arquivo}.html`);
  await page.waitForSelector('.cd-faq-item');
  const tipo = (await faqDaTela(page)).visiveis[0];
  if (pequena[k1] === 1) assert.match(tipo.a, new RegExp(`^O IMED mostra 1 ${um} em `), tipo.a);
  assert.match(tipo.a, new RegExp(`Na cidade toda, são ${pequena.total} estabelecimentos de saúde no IMED`));
  // Rio de Janeiro: "do Rio de Janeiro" na pergunta e "no Rio de Janeiro" na resposta e no parágrafo do topo.
  await page.goto(`${BASE}cidades/rj/rio-de-janeiro/`);
  const rio = (await faqDaTela(page)).visiveis;
  assert.equal(rio[0].q, 'Quantos locais de saúde do Rio de Janeiro aparecem no IMED?');
  assert.ok(rio[0].a.startsWith(`O IMED mostra ${fmt(RJ.total)} estabelecimentos de saúde no Rio de Janeiro (RJ),`), rio[0].a);
  assert.equal(rio[4].q, 'Os locais do Rio de Janeiro atendem pelo SUS?');
  assert.ok(squash(await page.textContent('.cd-lead')).startsWith(`O IMED tem ${fmt(RJ.total)} estabelecimentos de saúde no Rio de Janeiro (RJ), do cadastro oficial`));
  await noOverflowCelular(page, 'Rio de Janeiro');
  // Serra (ES): "da Serra" e "na Serra", na página da cidade e na de um tipo (com "Veja também na Serra").
  const SERRA = CIDADES.find((c) => c.name === 'Serra' && c.uf === 'ES');
  await page.goto(`${BASE}cidades/es/serra/`);
  const serra = (await faqDaTela(page)).visiveis;
  assert.equal(serra[0].q, 'Quantos locais de saúde da Serra aparecem no IMED?');
  assert.ok(serra[0].a.startsWith(`O IMED mostra ${fmt(SERRA.total)} estabelecimentos de saúde na Serra (Espírito Santo),`), serra[0].a);
  assert.equal(serra[4].q, 'Os locais da Serra atendem pelo SUS?');
  assert.ok(squash(await page.textContent('.cd-lead')).includes(' na Serra (Espírito Santo), do cadastro oficial'));
  await page.goto(`${BASE}cidades/es/serra/clinicas.html`);
  await page.waitForSelector('.cd-faq-item');
  assert.equal((await faqDaTela(page)).visiveis[0].q, 'Quantas clínicas da Serra aparecem no IMED?');
  assert.equal(squash(await page.textContent('.cd-also h2')), 'Veja também na Serra');
  await noOverflowCelular(page, 'clínicas da Serra');
  await page.locator('.cd-faq').scrollIntoViewIfNeeded();
  await shot(page, 'serra-clinicas-faq-celular');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('as respostas batem com as regras publicadas (Como funciona, Quem somos e Termos), pelos links do bloco', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}cidades/mg/belo-horizonte/clinicas.html`);
  const links = await page.$$eval('.cd-faq-src a', (els) => els.map((a) => [a.textContent, a.getAttribute('href')]));
  assert.deepEqual(links, [['Como funciona', '../../../como-funciona.html'], ['Quem somos', '../../../sobre.html'], ['Termos de uso', '../../../termos.html']]);
  const regras = {};
  for (const [name, href] of links) {
    await page.goto(`${BASE}cidades/mg/belo-horizonte/clinicas.html`);
    await Promise.all([page.waitForURL(`${BASE}${href.replace('../../../', '')}`), page.click(`.cd-faq-src a:text-is("${name}")`)]);
    regras[name] = squash(await page.textContent('main'));
  }
  assert.match(regras['Como funciona'], /Como funciona o IMED/);
  assert.match(regras['Quem somos'], /Quem somos/);
  assert.match(regras['Termos de uso'], /Termos de uso/);
  const todas = Object.values(regras).join(' ');
  // Cada resposta vem de uma regra que está nas páginas (mudou lá, mude scripts/gerar-cidades.mjs e gere de novo).
  for (const [regra, re] of [
    ['não é plano', /não é plano de saúde nem cartão de desconto/i],
    ['plataforma de busca e de pedido', /O IMED é uma plataforma on-line que ajuda pacientes a encontrar clínicas/],
    ['quem atende é o local', /Quem atende é o local escolhido/],
    ['particular ou por convênio', /O pedido é para atendimento particular ou por convênio/],
    ['grátis para o paciente', /Para você, o IMED é gratuito/],
    ['cancelar é grátis', /Cancelar pelo IMED é grátis/],
    ['cobrança por falta', /A cobrança por falta, quando houver, segue as regras de cada clínica/],
    ['pagamento no local', /O pagamento, quando houver, é feito direto no local/],
    ['sem Pix', /nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp/],
    ['só vale com Confirmado', /Um pedido só vale como agendamento quando aparece como Confirmado/],
    ['agenda on-line reserva', /o horário escolhido é reservado e o pedido aparece como Confirmado/],
    ['dia e período', /Nos outros locais, você diz o dia e o período que prefere/],
    ['SUS pelo CNES', /Atende SUS : informação do próprio cadastro oficial \(CNES\)|Atende SUS: informação do próprio cadastro oficial \(CNES\)/],
    ['SUS não agenda pelo IMED', /unidades públicas do SUS não agendam pelo IMED/i],
    ['UBS', /Para ser atendido pelo SUS, procure a sua Unidade Básica de Saúde \(UBS\)/],
  ]) assert.match(todas, re, regra);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('guias de exames (celular): "O que levar" nos 8 guias, depois do preparo, só logística e com "confirme com o local"', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true });
  for (const g of GUIAS) {
    await page.goto(`${BASE}exames/${g}.html`);
    const box = page.locator('#levar');
    assert.equal(await box.count(), 1, g);
    assert.ok(await box.isVisible(), `${g}: caixa visível`);
    assert.equal(squash(await page.textContent('#levar h2')), 'O que levar', g);
    const itens = (await page.$$eval('#levar li', (els) => els.map((e) => e.textContent.trim())));
    assert.equal(itens.length, 5, g);
    assert.equal(itens[0], 'Documento com foto e, se for pelo convênio, a carteirinha.', g);
    assert.match(itens[1], /^Pedido médico/, g);
    assert.match(itens[2], /anteriores/, g);
    assert.equal(itens[3], 'A lista dos remédios que você usa.', g);
    assert.equal(itens[4], 'Chegue com a antecedência que o local pedir.', g);
    const t = squash(await box.textContent());
    assert.match(t, /Cada local tem as suas regras: confirme com o local ao agendar\./, g);
    assert.ok(!/jejum|contraste|grávid|marca-passo|implante|desodorante|R\$/i.test(t), `${g}: só logística`);
    // Na tela: depois do "Como se preparar" e antes das perguntas frequentes; caixa com borda.
    const ordem = await page.evaluate(() => {
      const faq = [...document.querySelectorAll('.g-art h2')].find((h) => /Perguntas frequentes/.test(h.textContent));
      return [document.querySelector('#preparo'), document.querySelector('#levar'), faq].map((e) => e.getBoundingClientRect().top + scrollY);
    });
    assert.ok(ordem[0] < ordem[1] && ordem[1] < ordem[2], `${g}: ordem ${ordem}`);
    assert.equal(await box.evaluate((e) => getComputedStyle(e).borderTopStyle), 'solid', `${g}: caixa com borda`);
    // O aviso do guia continua no preparo.
    assert.equal(await page.locator('#preparo .warn').count(), 1, `${g}: aviso mantido`);
    await noOverflowCelular(page, g);
  }
  await page.goto(`${BASE}exames/ressonancia-magnetica.html`);
  await page.locator('#levar').scrollIntoViewIfNeeded();
  await shot(page, 'guia-ressonancia-o-que-levar-celular', false);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('llms.txt e sitemap: servidos na raiz, links que respondem e todas as páginas fixas no mapa (inclusive para-medicos.html)', async () => {
  const { page, context } = await newPage(browser);
  const res = await page.request.get(`${BASE}llms.txt`);
  assert.equal(res.status(), 200);
  const llms = await res.text();
  assert.ok(llms.startsWith('# IMED\n\n> '), 'título e resumo (formato do llmstxt.org)');
  const total = CIDADES.reduce((s, c) => s + c.total, 0);
  assert.match(llms, new RegExp(`Números atualizados em [^:]+: ${fmt(total).replace('.', '\\.')} estabelecimentos de saúde em ${CIDADES.length} cidades`));
  assert.match(llms, /Não é plano de saúde nem cartão de desconto/);
  const links = [...llms.matchAll(/^- \[[^\]]+\]\(([^)]+)\)/gm)].map((m) => m[1]);
  assert.ok(links.length >= 20, `links: ${links.length}`);
  for (const url of links) {
    assert.ok(local(url), `${url}: no endereço do site`);
    assert.equal((await page.request.get(local(url))).status(), 200, url);
  }
  // Sitemap: todas as páginas fixas, os 8 guias e o índice das cidades; as que não são de cidade respondem.
  const sm = await (await page.request.get(`${BASE}sitemap.xml`)).text();
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const p of ['', 'perto.html', 'parceiros.html', 'reivindicar.html', 'sobre.html', 'como-funciona.html', 'termos.html', 'privacidade.html', 'acessibilidade.html', 'contato.html', 'para-medicos.html', 'exames/', ...GUIAS.map((g) => `exames/${g}.html`), 'cidades/']) {
    assert.ok(locs.includes(SITE + p), `${p || 'início'} no sitemap`);
  }
  for (const url of locs.filter((u) => !u.includes('/cidades/') || u.endsWith('/cidades/'))) assert.equal((await page.request.get(local(url))).status(), 200, url);
  // As páginas de cidade e de tipo: uma amostra responde, e o número bate com o cidades.json.
  const cidades = locs.filter((u) => /\/cidades\/[a-z]{2}\/[^/]+\/(?:[a-z-]+\.html)?$/.test(u));
  const esperado = CIDADES.length + CIDADES.reduce((s, c) => s + ['imagem', 'laboratorio', 'clinica', 'hospital'].filter((k) => c[k] > 0).length, 0);
  assert.equal(cidades.length, esperado);
  for (const url of cidades.filter((_, i) => i % 97 === 0)) assert.equal((await page.request.get(local(url))).status(), 200, url);
  assert.ok(!locs.some((u) => /gestao|painel|conta\.html|medico\.html|documento|llms/.test(u)), 'sem páginas da equipe nem o llms.txt');
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
