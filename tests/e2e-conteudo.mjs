// Teste de ponta a ponta das páginas de conteúdo e de confiança (Playwright), com o banco simulado:
// "Para clínicas" (parceiros.html) sem nada inventado, Como funciona, Acessibilidade, Privacidade,
// Quem somos, Termos, a página 404 e o rodapé igual em todas as páginas (celular e computador).
// Rodar com: node tests/e2e-conteudo.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta node tests/e2e-conteudo.mjs  salva capturas de tela nessa pasta.
//           E2E_PORT=8790 node tests/e2e-conteudo.mjs  usa outra porta (padrão 8777), para rodar em paralelo.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, vigiarChaves } from './regra-chaves.mjs';
import { CAMINHO, PASTA, semCaminho } from './endereco.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const PORT = Number(process.env.E2E_PORT) || 8777; // E2E_PORT: outra porta para rodar em paralelo
const REST = 'https://pyoqiecupxhdzigjudyd.supabase.co/rest/v1/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

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

const CITIES = [
  { ibge: 3550308, name: 'São Paulo', uf: 'SP', total: 6548, imagem: 574, laboratorio: 524, clinica: 5161, hospital: 289 },
  { ibge: 3106200, name: 'Belo Horizonte', uf: 'MG', total: 2284, imagem: 191, laboratorio: 206, clinica: 1794, hospital: 93 },
  { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', total: 3000, imagem: 300, laboratorio: 200, clinica: 2300, hospital: 200 },
  { ibge: 2611606, name: 'Recife', uf: 'PE', total: 150, imagem: 10, laboratorio: 20, clinica: 110, hospital: 10 },
];
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, PATCH, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: cors });

// cities: resposta de imported_cities; leads: resposta do envio de partner_leads.
async function newPage(browser, { mobile = false, viewport = null, cities, leads } = {}) {
  const context = await browser.newContext({
    viewport: viewport || (mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 }),
    isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', reducedMotion: 'reduce',
  });
  // contactReply: resposta do send_contact ({ status, body }); sem ela, devolve um protocolo.
  const log = { cities: 0, leads: [], contact: [], contactAuth: [], contactReply: null };
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  // Banco: tudo responde vazio, menos o que o cenário pede.
  await context.route(`${REST}**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = req.url();
    if (url.includes('rpc/imported_cities')) { log.cities += 1; return (cities ?? ((r) => json(r, CITIES)))(route); }
    if (url.includes('rpc/send_contact')) {
      log.contact.push(JSON.parse(req.postData() || '{}'));
      log.contactAuth.push(req.headers().authorization || '');
      return log.contactReply ? json(route, log.contactReply.body, log.contactReply.status) : json(route, 'IMED-20261030-AB2C');
    }
    if (url.includes('/partner_leads')) {
      log.leads.push(JSON.parse(req.postData() || '{}'));
      return (leads ?? ((r) => r.fulfill({ status: 201, body: '', headers: cors })))(route);
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
const text = (page) => page.evaluate(() => document.body.innerText);
const noOverflow = async (page, name) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(o <= 0, `${name}: sem rolagem lateral (${o}px)`);
};
// O rodapé de todas as páginas: médico responsável, CFM, emergência, fonte e links.
async function checkFooter(page, name) {
  const foot = page.locator('footer.rodape');
  assert.equal(await foot.count(), 1, `${name}: um rodapé`);
  const t = (await foot.textContent()).replace(/\s+/g, ' ');
  assert.match(t, /Médico responsável: Dr\. Rafael Pereira Barreto Silva — CRM-SP 266930/, name);
  assert.match(t, /conferir no CFM/, name);
  assert.match(t, /Emergência\? Ligue 192 \(SAMU\)/, name);
  assert.match(t, /Dados de endereço: CNES\/Ministério da Saúde\. O IMED é um serviço privado, sem vínculo com o governo ou o SUS\./, name);
  for (const label of ['Quem somos', 'Como funciona', 'Termos de uso', 'Privacidade', 'Acessibilidade', 'Fale com o IMED', 'Teleconsulta']) {
    assert.ok(await foot.getByRole('link', { name: label, exact: true }).count() === 1, `${name}: link ${label}`);
  }
  // O CSS do rodapé carregou (fundo escuro), mesmo nas páginas com outro estilo.
  assert.equal(await foot.evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(5, 22, 30)', `${name}: estilo do rodapé`);
  assert.ok(!/Criado por|contato@imed/.test(await text(page)), `${name}: sem "Criado por" nem e-mail que não é do IMED`);
}

const browser = vigiarChaves(await chromium.launch());

await scenario('Para clínicas: números reais do banco, passo a passo verdadeiro e nada inventado', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}parceiros.html`);
  await page.waitForSelector('#numeros:not([hidden])');
  assert.equal(log.cities, 1);
  assert.match(await page.textContent('#numeros'), /Hoje o IMED mostra 11\.982 estabelecimentos do cadastro oficial em 4 cidades/);
  const t = await text(page);
  assert.match(t, /Seja um dos primeiros parceiros do IMED/);
  assert.match(t, /Cadastro sem custo/);
  assert.ok(!/R\$|★|\d ?%|\+500|50 mil|Super Clínica|Mais escolhido|depoimento|Pix e cartão|repasse|por agendamento|ilustrativ/i.test(t), 'sem preço, nota, comissão, selo, plano, depoimento ou pagamento pelo app');
  const steps = await page.$$eval('.pc-steps li b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(steps, ['Ache o seu estabelecimento e peça o cadastro', 'A equipe do IMED confere', 'Sua página no ar como “Parceiro verificado”']);
  for (const href of ['reivindicar.html', 'painel.html', 'como-funciona.html', 'medico.html']) {
    assert.ok(await page.locator(`main a[href="${href}"], .cl-hero a[href="${href}"]`).count() >= 1, `link para ${href}`);
  }
  assert.equal(await page.locator('img').count(), 0, 'sem fotos nem retratos');
  await checkFooter(page, 'parceiros');
  await shot(page, 'parceiros-desktop');
  assert.deepEqual(errors, [], 'sem erro (nem de Content-Security-Policy)');
  await context.close();
});

await scenario('Para clínicas: contato de clínica gravado no banco (partner_leads), com validação', async () => {
  const { page, log, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(`${BASE}parceiros.html#contato`);
  await page.click('#pSend');
  assert.equal(log.leads.length, 0, 'não envia com campos vazios');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pNome', 'o foco vai para o primeiro campo com erro');
  assert.match(await page.textContent('#pNomeErr'), /nome do estabelecimento/);
  assert.match(await page.textContent('#pLgpdErr'), /aceite/);
  await page.fill('#pNome', 'Laboratório <b>Vida</b>');
  await page.selectOption('#pTipo', 'Laboratório');
  await page.fill('#pDoc', '12345678000195');
  assert.equal(await page.inputValue('#pDoc'), '12.345.678/0001-95', 'máscara do CNPJ');
  await page.fill('#pTel', '11987654321');
  assert.equal(await page.inputValue('#pTel'), '(11) 98765-4321');
  await page.fill('#pEmail', 'Contato@Vida.com.br');
  await page.fill('#pCidade', 'Recife');
  await page.check('#pLgpd');
  await page.click('#pSend');
  await page.waitForSelector('#contato .pc-ok');
  assert.deepEqual(log.leads[0], { partner_type: 'clinica', name: 'Laboratório <b>Vida</b>', cnpj: '12.345.678/0001-95', phone: '(11) 98765-4321', email: 'contato@vida.com.br', address: 'Recife', services: 'Tipo: Laboratório · Pela página Para clínicas', online_only: false });
  const ok = await page.textContent('#contato');
  assert.match(ok, /Recebemos o seu contato/);
  assert.ok(ok.includes('Laboratório <b>Vida</b>'), 'nome escapado (sem HTML)');
  assert.ok(!/dia útil|horas/.test(ok), 'sem prometer prazo');
  await noOverflow(page, 'parceiros no celular');
  await shot(page, 'parceiros-celular');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Para clínicas: banco fora do ar — sem número e o formulário mostra o erro', async () => {
  const fail = (r) => json(r, { message: 'erro' }, 500);
  const { page, log, errors, context } = await newPage(browser, { cities: fail, leads: fail });
  await page.goto(`${BASE}parceiros.html`);
  await page.waitForTimeout(500);
  assert.equal(await page.isVisible('#numeros'), false, 'sem número, a frase não aparece');
  await page.fill('#pNome', 'Clínica Teste');
  await page.selectOption('#pTipo', 'Clínica');
  await page.fill('#pDoc', '12345678000195');
  await page.fill('#pTel', '11987654321');
  await page.fill('#pEmail', 'a@b.com');
  await page.fill('#pCidade', 'Recife');
  await page.check('#pLgpd');
  await page.click('#pSend');
  await page.waitForSelector('#pMsg .cl-note.err');
  assert.equal(log.leads.length, 1);
  assert.match(await page.textContent('#pMsg'), /Não foi possível enviar agora/);
  assert.equal(await page.getAttribute('#pMsg a', 'href'), 'contato.html');
  assert.match(await page.textContent('#pSend'), /Tentar de novo/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Como funciona: ordem dos resultados, selo, avaliações, dados e custo', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}como-funciona.html`);
  for (const id of ['ordem', 'selos', 'avaliacoes', 'dados', 'pedido', 'custo']) assert.equal(await page.locator(`h2#${id}`).count(), 1, id);
  const t = await text(page);
  assert.match(t, /do mais perto para o mais longe/);
  assert.match(t, /Ninguém paga para aparecer primeiro/);
  assert.ok(!/Patrocinado/.test(t), 'compromisso sobre destaque pago futuro: só com a confirmação do Dr. Rafael');
  assert.match(t, /Selo não se vende/);
  // Unidade pública do SUS não agenda pelo IMED (a oferta não promete o que não dá para cumprir).
  assert.match(t, /unidades públicas do SUS não agendam pelo IMED/);
  assert.match(t, /procure a sua Unidade Básica de Saúde \(UBS\)/);
  // Cancelar: só promete o que acontece (a equipe do IMED vê; ligar para o local se já combinou).
  assert.match(t, /se o horário já tinha sido combinado com o local, ligue também para ele/);
  assert.match(t, /o mês e o ano/, 'a avaliação mostra o mês e o ano (como na página do local)');
  assert.match(t, /não avalia a qualidade do atendimento médico/);
  assert.match(t, /Só avalia quem fez um pedido pelo IMED e teve o atendimento marcado como concluído/);
  assert.match(t, /Nota ruim não é retirada só porque a clínica não gostou/);
  assert.match(t, /CNES/);
  assert.match(t, /é um serviço privado, sem vínculo com o governo ou o SUS/);
  assert.match(t, /correção do cadastro oficial é feita pelo próprio estabelecimento/);
  assert.match(t, /Para você, o IMED é gratuito/);
  assert.match(t, /nunca pede Pix, depósito, senha ou código/);
  assert.equal(await page.locator('main a[href="tel:192"]').count(), 1, 'emergência: 192');
  assert.equal(await page.locator('main a[href="contato.html"]').count() >= 1, true, 'como pedir correção');
  await checkFooter(page, 'como-funciona');
  await shot(page, 'como-funciona-desktop');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Acessibilidade: o que o site faz, limites e canal para relatar barreira, com o símbolo', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(`${BASE}acessibilidade.html`);
  assert.equal(await page.getAttribute('.a11y-top .sym', 'aria-label'), 'Símbolo de acessibilidade');
  assert.equal(await page.locator('.a11y-top .fa-universal-access').count(), 1);
  const t = await text(page);
  assert.match(t, /Pular para o conteúdo/);
  assert.match(t, /leitor de tela/);
  assert.match(t, /Encontrou uma barreira\?/);
  // O que foi feito (e é conferido pelo tests/e2e-a11y.mjs): contraste, teclado, janelas, celular e movimento.
  assert.match(t, /contraste de pelo menos 4,5 para 1/);
  assert.match(t, /só com o teclado/);
  assert.match(t, /a tecla Esc fecha e o foco volta para onde estava/);
  assert.match(t, /pelo menos 44 pixels/);
  assert.match(t, /letra de 16 pixels/);
  assert.match(t, /Pausar animação/);
  assert.match(t, /WCAG 2\.2, nível AA/);
  // O axe só é citado como ferramenta das revisões (no CI ele só roda quando o workflow instala o axe-core).
  assert.ok(!/testes automáticos que conferem[^.]*axe/.test(t), 'não diz que o axe faz parte dos testes automáticos');
  assert.match(t, /Nas revisões, também passamos as páginas na ferramenta de verificação axe/);
  assert.equal(await page.locator('main a[href="contato.html"]').count(), 1, 'canal: Fale com o IMED');
  // O atalho "Pular para o conteúdo" funciona pelo teclado.
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  await checkFooter(page, 'acessibilidade');
  await noOverflow(page, 'acessibilidade no celular');
  await shot(page, 'acessibilidade-celular');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Privacidade: responsável, base legal, serviços fora do Brasil, prazos, incidente e teleconsulta', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}privacidade.html`);
  const t = await text(page);
  assert.ok(!/protótipo|clínicas de imagem e teleconsulta|lista de espera do app/i.test(t), 'sem texto antigo');
  assert.match(t, /responsável pelos seus dados \(o “controlador”, na LGPD\) é o Dr\. Rafael Pereira Barreto Silva/);
  assert.ok(!/CNPJ:? ?\d/.test(t), 'sem CNPJ inventado');
  assert.match(t, /Base legal/i);
  assert.match(t, /art\. 11, I/);
  assert.match(t, /Lista de espera da teleconsulta/);
  assert.match(t, /Serviços fora do Brasil/);
  for (const s of ['OpenStreetMap', 'OpenFreeMap', 'Photon', 'Overpass', 'FOSSGIS', 'STUN', 'Cloudflare']) assert.ok(t.includes(s), s);
  // Igual ao código: as letras são do próprio site em todas as páginas; o aviso de erro não liga à conta;
  // o contador conta páginas abertas, não pessoas; a cidade escolhida também fica no aparelho.
  assert.ok(!/Google Fonts/.test(t), 'nenhuma página usa mais as letras do Google');
  assert.match(t, /não ligamos o aviso à sua conta/);
  assert.match(t, /conta páginas abertas, não pessoas/);
  assert.ok(!/quantas pessoas usam o site/.test(t));
  // O que fica no aparelho: a cidade escolhida, as recentes, as recusas do pedido de localização (também os pedidos
  // que ficaram sem resposta) e o aviso da aba.
  assert.match(t, /a cidade escolhida e as 3 últimas cidades escolhidas \(nome, estado e o centro da cidade\), quantas vezes o pedido de localização não foi aceito ou ficou sem resposta \(até 2, para não perguntar sem parar\) e, até fechar a aba, um aviso de que a localização já foi pedida \(sem a posição\)/);
  // Localização (o aviso da página inicial leva a esta linha): o pedido ao abrir, uma vez por aba, nunca depois de 2
  // recusas ou pedidos sem resposta.
  assert.match(await page.textContent('tr#localizacao'), /Na página inicial, o pedido aparece assim que você abre o site, no máximo uma vez por aba, e não aparece mais sozinho depois de duas recusas ou pedidos sem resposta\. Se você não permitir, escolha a cidade\./);
  assert.match(t, /a equipe médica do IMED, e cada acesso da equipe do IMED fica anotado/);
  assert.match(t, /o mês e o ano da avaliação/);
  // Pedido para outra pessoa maior de idade: o consentimento é dela, por meio de quem pede.
  assert.match(t, /Se ela é maior de idade, quem pede confirma que ela sabe do pedido e concordou/);
  assert.match(t, /Os dados dos pedidos e das teleconsultas não passam pelo contador: ele só soma a visita à página/);
  assert.match(t, /servidores no Brasil \(região de São Paulo\)/);
  assert.match(t, /Por quanto tempo guardamos/);
  assert.match(t, /pelo menos 20 anos a partir do último registro/);
  assert.match(t, /Lei nº 13\.787\/2018/);
  assert.match(t, /Nunca vendemos seus dados|nunca é vendido/);
  assert.match(t, /avisamos você e a Autoridade Nacional de Proteção de Dados/);
  assert.match(t, /sem cookies e sem identificar ninguém/);
  // Contador de visitas próprio: o que conta, o que não guarda e quem não é contado.
  assert.match(t, /Cada página aberta soma 1 no total daquela página no dia, guardada sem o resto do endereço/);
  assert.match(t, /O contador não guarda o endereço de internet \(IP\), o aparelho, o navegador, a conta nem nenhum código que identifique você/);
  assert.match(t, /“Não rastrear” \(Do Not Track\) ou com o Controle Global de Privacidade \(GPC\) ligado, a sua visita não é contada/);
  assert.match(t, /Contador de visitas \(do próprio IMED\)/, 'linha na tabela de dados');
  assert.match(t, /Contador de visitas: só números somados por dia, sem dado pessoal/, 'prazo de guarda');
  assert.match(t, /A consulta não é gravada/);
  assert.equal(await page.locator('main a[href="termo-teleconsulta.html"]').count(), 1, 'teleconsulta aponta para o termo');
  assert.ok(await page.locator('main a[href="contato.html"]').count() >= 2, 'direitos pelo Fale com o IMED');
  assert.ok(!/em até \d+ (dias|horas)/.test(t), 'sem prometer prazo que ninguém cumpre');
  await checkFooter(page, 'privacidade');
  await shot(page, 'privacidade-desktop');
  assert.deepEqual(errors, []);
  await context.close();
  const m = await newPage(browser, { mobile: true });
  await m.page.goto(`${BASE}privacidade.html`);
  await noOverflow(m.page, 'privacidade no celular (tabela)');
  await shot(m.page, 'privacidade-celular');
  await m.context.close();
});

await scenario('Quem somos e Termos: "Médico responsável" com CRM e contato pelo Fale com o IMED', async () => {
  const { page, errors, context } = await newPage(browser);
  for (const f of ['sobre.html', 'termos.html']) {
    await page.goto(`${BASE}${f}`);
    const t = await text(page);
    assert.ok(!/responsável técnico|diretor técnico/i.test(t), `${f}: título ainda não confirmado com o CREMESP`);
    assert.match(t, /Médico responsável|médico responsável/, f);
    assert.match(t, /CRM-SP 266930/, f);
    assert.ok(await page.locator('main a[href="contato.html"]').count() >= 1, `${f}: Fale com o IMED`);
    assert.match(t, /sem vínculo com o governo ou o SUS/, f);
    await checkFooter(page, f);
  }
  await page.goto(`${BASE}sobre.html`);
  await shot(page, 'sobre-desktop');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Fale com o IMED: assunto pelo endereço (LGPD), validação, protocolo na hora, limite e campo-isca', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}contato.html?assunto=exclusao`);
  assert.equal(await page.inputValue('#cAssunto'), 'dados_exclusao', 'o link "Pedir exclusão" já escolhe o assunto');
  assert.ok(await page.isVisible('#cTipLgpd'));
  assert.ok(await page.isHidden('#cCodeBox'));
  assert.ok(await page.isHidden('#cConta'), 'sem conta, sem o aviso da conta');
  const t = await text(page);
  assert.match(t, /Emergência\? Ligue 192 \(SAMU\)/);
  assert.match(t, /nunca pede Pix, depósito, senha ou código/);
  assert.match(t, /Cancelar pelo IMED é grátis/);
  assert.ok(!/em até \d+ (dias|horas)|dia útil/.test(t), 'sem prometer prazo');
  assert.equal(await page.locator('main a[href="conta.html#dados"]').count(), 1, 'baixar os dados pela conta');
  assert.equal(await page.locator('main a[href="./#agenda"]').count() >= 1, true, 'cancelar em Meus pedidos');
  await checkFooter(page, 'contato');
  // nada sai com campos vazios; o foco vai para o primeiro erro
  await page.selectOption('#cAssunto', '');
  await page.click('#cSend');
  assert.equal(log.contact.length, 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cAssunto');
  assert.match(await page.textContent('#cAssuntoErr'), /Escolha o assunto/);
  assert.match(await page.textContent('#cNomeErr'), /Digite seu nome/);
  assert.match(await page.textContent('#cContatoErr'), /e-mail.*celular com DDD/);
  assert.match(await page.textContent('#cMensagemErr'), /Escreva a sua mensagem/);
  assert.equal(await page.getAttribute('#cNome', 'aria-invalid'), 'true');
  // cancelamento: dica, protocolo do pedido e celular como contato
  await page.selectOption('#cAssunto', 'cancelamento');
  assert.ok(await page.isVisible('#cCodeBox'));
  assert.ok(await page.isVisible('#cTipCancel'));
  assert.ok(await page.isHidden('#cTipLgpd'));
  await page.fill('#cNome', '  Maria   <b>Souza</b> ');
  assert.equal(await page.getAttribute('#cNome', 'aria-invalid'), null, 'o aviso some ao corrigir');
  await page.fill('#cContato', '+55 (11) 98765-4321');
  await page.fill('#cProtocolo', 'IMED-1A2B3C4D');
  await page.fill('#cMensagem', 'Quero cancelar o exame de amanhã, por favor.');
  assert.equal(await page.textContent('#cCount'), '44 de 2000 caracteres');
  await page.click('#cSend');
  await page.waitForSelector('#cDone');
  assert.deepEqual(log.contact[0], { p_subject: 'cancelamento', p_name: 'Maria <b>Souza</b>', p_contact: '11987654321', p_message: 'Quero cancelar o exame de amanhã, por favor.', p_request_code: 'IMED-1A2B3C4D' });
  assert.equal(await page.textContent('#cProto'), 'IMED-20261030-AB2C');
  assert.match(await page.textContent('#cDone'), /responde pelo celular \(11\) 98765-4321/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cDone', 'o foco vai para a confirmação');
  await shot(page, 'contato-protocolo');
  // enviar outra: o banco recusa por excesso de mensagens
  await page.click('#cAgain');
  await page.waitForSelector('#cform');
  log.contactReply = { status: 400, body: { code: 'P0001', message: 'limite_contato', details: null, hint: null } };
  await page.selectOption('#cAssunto', 'duvida');
  await page.fill('#cNome', 'Ana');
  await page.fill('#cContato', 'Ana@Exemplo.com');
  await page.fill('#cMensagem', 'Como funciona o selo?');
  await page.click('#cSend');
  await page.waitForSelector('#cMsg .cl-note.err');
  assert.match(await page.textContent('#cMsg'), /várias mensagens com este e-mail ou celular em pouco tempo.*entre na sua conta/);
  assert.match(await page.textContent('#cSend'), /Tentar de novo/);
  assert.equal(log.contact[1].p_contact, 'ana@exemplo.com');
  assert.equal(log.contact[1].p_request_code, null, 'protocolo do pedido só no cancelamento');
  // o banco recusa o contato: marca o campo
  log.contactReply = { status: 400, body: { code: 'P0001', message: 'dados_invalidos', details: 'contato', hint: null } };
  await page.click('#cSend');
  await page.waitForFunction(() => document.querySelector('#cContato').getAttribute('aria-invalid') === 'true');
  assert.match(await page.textContent('#cMsg'), /Confira os campos marcados/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cContato');
  // resposta sem protocolo válido: não mostra protocolo inventado
  log.contactReply = { status: 200, body: 'qualquer coisa' };
  await page.fill('#cContato', 'ana@exemplo.com');
  await page.click('#cSend');
  await page.waitForFunction(() => /Não foi possível enviar agora/.test(document.querySelector('#cMsg').textContent));
  assert.equal(await page.locator('#cDone').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
  // campo-isca preenchido (robô): não grava nada
  const bot = await newPage(browser, { mobile: true });
  await bot.page.goto(`${BASE}contato.html`);
  await bot.page.selectOption('#cAssunto', 'outro');
  await bot.page.fill('#cNome', 'Robô');
  await bot.page.fill('#cContato', 'robo@exemplo.com');
  await bot.page.fill('#cMensagem', 'Mensagem automática');
  await bot.page.evaluate(() => { document.querySelector('input[name="website"]').value = 'http://spam'; });
  await bot.page.click('#cSend');
  await bot.page.waitForSelector('#cDone');
  assert.equal(bot.log.contact.length, 0, 'robô não grava');
  assert.equal(await bot.page.locator('#cProto').count(), 0, 'sem protocolo');
  await noOverflow(bot.page, 'contato no celular');
  assert.deepEqual(bot.errors, []);
  await bot.context.close();
  // assunto desconhecido no endereço: começa sem assunto
  const odd = await newPage(browser);
  await odd.page.goto(`${BASE}contato.html?assunto=<b>x</b>&pedido=IMED-ABC12345`);
  assert.equal(await odd.page.inputValue('#cAssunto'), '');
  assert.equal(await odd.page.inputValue('#cProtocolo'), 'IMED-ABC12345', 'protocolo do pedido vindo do endereço');
  await odd.context.close();
});

await scenario('Termos e Como funciona: cancelar pelo IMED é grátis e o que o IMED confere antes do selo', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}termos.html`);
  assert.equal(await page.locator('h2#cancelamento').count(), 1);
  const t = await text(page);
  assert.match(t, /Cancelar pelo IMED é grátis/);
  assert.match(t, /cobrança por falta, quando houver, segue as regras de cada clínica/);
  assert.match(t, /o IMED ainda não avisa o local automaticamente: se o horário já tinha sido combinado com o local, ligue também para ele/);
  assert.match(t, /Um pedido cancelado por você não volta a valer/);
  assert.match(t, /Unidades públicas do SUS não agendam pelo IMED/);
  // O papel do IMED, sem contradição com a teleconsulta: na busca não atende; na teleconsulta atendem médicos.
  assert.match(t, /Na busca e no pedido de agendamento, o IMED não presta atendimento de saúde/);
  assert.match(t, /Na teleconsulta, quem atende são médicos com cadastro aprovado pela equipe do IMED/);
  assert.ok(!/O IMED não presta serviços médicos/.test(t));
  assert.match(t, /registro ativo no conselho da profissão dele/);
  assert.ok(await page.locator('main a[href="contato.html?assunto=cancelamento"]').count() >= 1, 'quem não consegue cancelar escreve pelo Fale com o IMED');
  await page.goto(`${BASE}como-funciona.html#selo`);
  assert.equal(await page.locator('h3#selo').count(), 1);
  const c = await text(page);
  for (const s of [/CNES ativo/, /CNPJ ativo/, /telefone oficial do CNES/, /registro ativo/, /conselho da profissão/, /Verificado pelo IMED em/]) assert.match(c, s);
  assert.ok(!/CRM ativo/.test(c), 'não promete CRM de médico em laboratório ou clínica não médica');
  assert.match(c, /Algo errado aqui\? Avise o IMED/);
  assert.equal(await page.locator('main a[href="termos.html#cancelamento"]').count() >= 1, true);
  assert.deepEqual(errors, []);
  await context.close();
});

const PAGES = [
  ['index.html', ''], ['perto.html', 'perto.html'], ['conta.html', 'conta.html'], ['painel.html', 'painel.html'],
  ['reivindicar.html', 'reivindicar.html'], ['parceiros.html', 'parceiros.html'], ['sobre.html', 'sobre.html'],
  ['como-funciona.html', 'como-funciona.html'], ['termos.html', 'termos.html'], ['privacidade.html', 'privacidade.html'],
  ['acessibilidade.html', 'acessibilidade.html'], ['exames/', 'exames/'], ['exames/raio-x.html', 'exames/raio-x.html'],
  ['cidades/', 'cidades/'], ['cidades/sp/sao-paulo/hospitais.html', 'cidades/sp/sao-paulo/hospitais.html'],
  ['contato.html', 'contato.html'],
];

await scenario('rodapé igual em todas as páginas: celular (390 px) sem rolagem lateral e computador em colunas', async () => {
  for (const mobile of [true, false]) {
    const { page, errors, context } = await newPage(browser, { mobile });
    for (const [name, path] of PAGES) {
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState('load');
      await checkFooter(page, `${name} (${mobile ? 'celular' : 'computador'})`);
      if (mobile) await noOverflow(page, name);
      const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.rd-nav')).gridTemplateColumns.split(' ').length);
      // Na busca (perto.html), no computador, o rodapé fica na coluna da lista, que é estreita.
      const want = mobile ? 2 : (name === 'perto.html' ? 2 : 3);
      assert.equal(cols, want, `${name}: ${want} colunas de links no ${mobile ? 'celular' : 'computador'}`);
      await page.locator('footer.rodape').scrollIntoViewIfNeeded();
      if (SHOTS && ['index.html', 'perto.html', 'exames/raio-x.html', 'cidades/sp/sao-paulo/hospitais.html'].includes(name)) {
        await page.locator('footer.rodape').screenshot({ path: join(SHOTS, `rodape-${name.replace(/[/.]/g, '-')}-${mobile ? 'celular' : 'desktop'}.png`) });
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('páginas de hospitais das cidades e guias: aviso de emergência e foto com "Imagem ilustrativa"', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(`${BASE}cidades/sp/sao-paulo/hospitais.html`);
  assert.match(await page.textContent('.cd-hero .cd-sos'), /Emergência\? Ligue 192 \(SAMU\)/);
  await page.goto(`${BASE}cidades/sp/sao-paulo/laboratorios.html`);
  assert.equal(await page.locator('.cd-sos').count(), 0, 'só nas páginas de hospitais');
  await page.goto(`${BASE}exames/raio-x.html`);
  assert.equal(await page.textContent('.g-hero .g-ill'), 'Imagem ilustrativa');
  assert.ok(await page.isVisible('.g-hero .g-ill'));
  const t = await text(page);
  assert.ok(!/clínicas que fazem/i.test(t), 'guia não promete que todo lugar faz o exame');
  assert.match(t, /Ver lugares perto de você/);
  await shot(page, 'guia-raio-x-celular');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('página 404 com o rodapé (caminho absoluto do site)', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true });
  const res = await page.goto(`${BASE}${PASTA}pagina-que-nao-existe`);
  assert.equal(res.status(), 404);
  assert.match(await page.textContent('h1'), /Não achamos esta página/);
  await checkFooter(page, '404');
  assert.equal(await page.getAttribute('footer.rodape a.rd-logo', 'href'), CAMINHO);
  await noOverflow(page, '404');
  await shot(page, '404-celular');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('app instalado e imagem de compartilhamento', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}`);
  const m = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  assert.ok(!/nota|preço|horário/i.test(m.description), m.description);
  assert.deepEqual(m.shortcuts.map((s) => s.url), ['./perto.html?usar=localizacao', './teleconsulta.html', './#agenda', './cidades/']);
  assert.deepEqual(m.shortcuts.map((s) => s.name), ['Perto de mim', 'Teleconsulta', 'Meus pedidos', 'Clínicas por cidade']);
  const og = await page.getAttribute('meta[property="og:image"]', 'content');
  assert.match(og, /\/assets\/img\/og\.jpg\?v=\d+$/);
  const size = await page.evaluate(async () => { const i = new Image(); i.src = 'assets/img/og.jpg'; await i.decode(); return [i.naturalWidth, i.naturalHeight]; });
  assert.deepEqual(size, [1200, 630]);
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
