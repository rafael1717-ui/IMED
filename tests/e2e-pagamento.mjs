// Teste de ponta a ponta do PAGAMENTO PELO SITE (iMed Pagamentos, fase P2a) num navegador de verdade (Playwright), com
// o banco e a função do servidor simulados (tests/pagamento-simulado.mjs). Nada sai desta máquina.
// Rodar com: node tests/e2e-pagamento.mjs      (E2E_PORT muda a porta; SHOTS=pasta salva capturas)
//
// O que confere: com TUDO DESLIGADO (como hoje) nada muda e nada do pagamento é baixado; com a clínica recebendo pelo
// site, "Ir para o pagamento" → QR, copia e cola e relógio → pago (comprovante), vencido, cancelado, página fechada e
// reaberta, pagamento atrasado (devolvido inteiro), meio de pagamento fora do ar (reserva solta), horário pego, "já
// paguei", a conta e "Meus pedidos", o celular de 360 px e o tema escuro. Relógio fixo: 16/11/2026, 09:00 em São Paulo.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { comChaves, PUBLISHABLE, vigiarChaves } from './regra-chaves.mjs';
import { bancoDoPagamento, CLINICA, CLINICA_ID, COPIA_E_COLA, CPF, NOW_MS, PROC_RM, rotasDoPagamento, servirSite } from './pagamento-simulado.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const SHOTS = process.env.SHOTS || '';
const { base: BASE, fechar } = await servirSite(Number(process.env.E2E_PORT) || 8794);
const LOCAL = `${BASE}local.html?id=${CLINICA_ID}`;
const PAG = /\/assets\/(js\/pagamento(-core)?\.js|css\/pagamento\.css|vendor\/qrcode-generator\/)/;

// Uma página com o relógio do teste (rel.t, em ms): andar o relógio = mudar rel.t e chamar avancar().
async function abrir(browser, { online = true, mobile = false, largura, escuro = false, init, banco, book, contaRows, guardado } = {}) {
  const rel = banco?.rel ?? { t: NOW_MS };
  const st = banco ?? bancoDoPagamento({ agora: () => rel.t, online });
  st.rel = rel;
  const context = await browser.newContext({
    viewport: mobile ? { width: largura ?? 390, height: 800 } : { width: 1366, height: 900 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', acceptDownloads: true, colorScheme: escuro ? 'dark' : 'light',
    permissions: ['clipboard-read', 'clipboard-write'], ...(guardado ? { storageState: guardado } : {}),
  });
  await context.clock.setFixedTime(new Date(rel.t));
  if (init) await context.addInitScript(init);
  const log = await rotasDoPagamento(context, st, { book, contaRows });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  const avancar = async (min) => { rel.t += min * 60000; await context.clock.setFixedTime(new Date(rel.t)); };
  return { context, page, st, log, errors, avancar };
}
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); } };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const guardados = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts') || '[]'));
const tudoNoAparelho = (page) => page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));

// Escolhe o primeiro horário da ressonância e preenche o formulário (sem enviar).
async function escolher(page, { cpf = CPF } = {}) {
  await page.goto(LOCAL);
  await page.waitForSelector('.sl-t');
  await page.click('.sl-t >> nth=0');
  await page.waitForSelector('#bookForm');
  await page.fill('#bkName', 'Ana Teste');
  await page.fill('#bkPhone', '11987654321');
  await page.check('input[name="consent"]');
  if (cpf !== null && await page.locator('#bkCpf').count()) await page.fill('#bkCpf', cpf);
}
async function irParaOPagamento(page, o) {
  await escolher(page, o);
  await page.click('#bkBtn');
}
const idDe = (log) => log.funcao.find((x) => x.body.action === 'criar')?.body.id;

const results = [];
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 120) * 1000;
async function scenario(name, fn) {
  let relogio;
  const limite = new Promise((_, fail) => { relogio = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); });
  try { await Promise.race([comChaves(fn), limite]); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 6).join('\n  ')}`); }
  finally { clearTimeout(relogio); }
}

const browser = vigiarChaves(await chromium.launch());

await scenario('COM TUDO DESLIGADO NADA MUDA: clínica sem recebimento pelo site marca como antes e nada do pagamento é baixado', async () => {
  const marcados = [];
  const book = (b) => { marcados.push(b); return { status: 'ok', id: b.p_id, request_status: 'confirmed', slot_start: b.p_items[0].starts_at, slot_end: b.p_items[0].starts_at, hold_expires_at: null, items: [] }; };
  const { page, log, errors, context } = await abrir(browser, { online: false, book });
  await escolher(page);
  assert.equal(await page.locator('#bkCpf').count(), 0, 'sem campo de CPF');
  assert.equal(await page.locator('.pg-pre').count(), 0, 'sem resumo de pagamento');
  assert.equal((await page.textContent('#bkBtn')).trim(), 'Confirmar agendamento');
  const form = await page.textContent('#bookForm');
  assert.match(form, /Pagamento no local, direto com a clínica\./, 'o texto do banco de sempre');
  assert.match(form, /O IMED é gratuito para você\./, 'o aviso de sempre');
  assert.match(form, /Ao tocar em Confirmar, o horário fica reservado e confirmado na agenda da clínica\./);
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  assert.match(await page.textContent('#agendar h2'), /^Agendamento confirmado para /);
  assert.equal(marcados.length, 1, 'marcou por agenda_book, como antes');
  assert.equal((await guardados(page))[0].status, 'confirmado');
  assert.equal((await guardados(page))[0].pay, undefined);
  // a conta e "Meus pedidos" com esse pedido: nada do pagamento
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector('.ct-order');
  assert.equal(await page.locator('.ct-pg, [data-pay]').count(), 0);
  await page.goto(`${BASE}index.html#agenda`);
  await page.waitForSelector('#appts .appt');
  assert.equal(await page.locator('#appts a:has-text("Continuar o pagamento")').count(), 0);
  assert.deepEqual(log.arquivos.filter((a) => PAG.test(a)), [], 'nenhum arquivo do pagamento baixado');
  assert.deepEqual(log.funcao, [], 'a função do pagamento não é chamada');
  assert.deepEqual(log.rpc.filter((x) => x.fn === 'pag_my_payment'), [], 'nenhuma consulta de pagamento');
  assert.deepEqual(log.outros, []);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('vários exames (5.2) e pagamento: a entrada "Marcar mais de um exame" só aparece na clínica que NÃO recebe pelo site', async () => {
  // O pagamento do pacote ainda não existe (fica para a P3) e o banco recusa confirmar sem pagar (payment_required).
  for (const [online, esperado] of [[false, 1], [true, 0]]) {
    const { page, errors, context } = await abrir(browser, { online });
    await page.goto(LOCAL);
    await page.waitForSelector('.sl-t');
    assert.equal(await page.locator('[data-act="pacote"]').count(), esperado, online ? 'recebe pelo site: sem a entrada' : 'não recebe pelo site: com a entrada');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('"Ir para o pagamento": resumo com o preço e as regras DO BANCO, CPF conferido, e nenhum valor sai do navegador', async () => {
  const { page, log, errors, context } = await abrir(browser);
  await escolher(page, { cpf: null });
  assert.ok(log.arquivos.some((a) => a.endsWith('/assets/js/pagamento.js')), 'a tela do pagamento é baixada quando o banco diz payment "online"');
  assert.equal((await page.textContent('#bkBtn')).trim(), 'Ir para o pagamento');
  const pre = await page.textContent('.pg-pre');
  assert.match(pre, /Pagamento por Pix, aqui no site/);
  assert.match(pre, /Valor do exame\s*R\$ 450,00/);
  assert.match(pre, /Pagamento aqui no site, na tela do seu agendamento\. O horário só fica confirmado depois do pagamento\./, 'payment_text do banco');
  assert.match(pre, /O horário fica guardado por 10 minutos enquanto você paga\./, 'o prazo que o banco informou');
  assert.match(pre, /O IMED não guarda o CPF\./);
  const form = await page.textContent('#bookForm');
  assert.match(form, /O IMED só recebe pagamento dentro do site, na tela do seu agendamento\. Nunca por telefone, WhatsApp, e-mail ou link/, 'o aviso novo contra golpe');
  assert.doesNotMatch(form, /O IMED é gratuito para você|nunca pede Pix|vão só para o IMED e para o local/, 'os avisos antigos não aparecem ao lado do pagamento');
  assert.doesNotMatch(form, /15 ?%|taxa|tarifa/i, 'a taxa não aparece para o paciente');
  // CPF em branco e CPF errado: erro no campo, lido pelo leitor de tela, e nada é enviado
  await page.click('#bkBtn');
  assert.equal(await page.textContent('#e-cpf'), 'Digite o CPF de quem vai pagar, com os 11 números.');
  assert.equal(await page.getAttribute('#bkCpf', 'aria-invalid'), 'true');
  assert.match(await page.getAttribute('#bkCpf', 'aria-describedby'), /e-cpf/);
  await page.fill('#bkCpf', '52998224724');
  assert.equal(await page.inputValue('#bkCpf'), '529.982.247-24', 'máscara');
  await page.click('#bkBtn');
  assert.equal(await page.textContent('#e-cpf'), 'Digite o CPF de quem vai pagar, com os 11 números.');
  assert.deepEqual(log.funcao, [], 'CPF errado: nada enviado');
  // certo: o que vai para a função do servidor
  await page.fill('#bkCpf', CPF);
  await page.click('#bkBtn');
  await page.waitForSelector('.pg-qr svg');
  assert.equal(log.funcao.length, 1);
  const { body, headers } = log.funcao[0];
  assert.deepEqual(Object.keys(body).sort(), ['action', 'captcha', 'clinic', 'id', 'items', 'key', 'patient', 'payer', 'token']);
  assert.equal(body.action, 'criar');
  assert.equal(body.clinic, CLINICA_ID);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].procedure_id, PROC_RM);
  assert.deepEqual(body.payer, { name: 'Ana Teste', cpf: '52998224725' });
  assert.deepEqual(body.patient, { name: 'Ana Teste', phone: '11987654321', consent: true });
  assert.match(body.id, /^[0-9a-f-]{36}$/);
  assert.match(body.token, /^[0-9a-f]{64}$/);
  assert.match(body.key, /^[0-9a-f-]{36}$/);
  assert.notEqual(body.key, body.id);
  assert.equal(body.captcha, '', 'sem a chave do Turnstile no site, o desafio vai vazio (o servidor de verdade recusa: fechado por padrão)');
  assert.ok(!/cents|price|valor|450/i.test(JSON.stringify(body)), 'nenhum valor sai do navegador');
  assert.equal(headers.apikey, PUBLISHABLE);
  assert.equal(headers.authorization, undefined, 'visitante: sem Authorization');
  assert.deepEqual(log.rpc.filter((x) => x.fn === 'agenda_book'), [], 'não tenta confirmar sem pagar');
  assert.deepEqual(log.outros, [], 'sem a chave do Turnstile, o site não chama o Cloudflare');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Pix: QR, copia e cola e relógio; o pagamento chega → confirmado com comprovante; nunca "confirmado" antes', async () => {
  const { page, log, st, errors, context } = await abrir(browser);
  await irParaOPagamento(page);
  await page.waitForSelector('.pg-qr svg');
  const tela = await page.textContent('#agendar');
  assert.match(await page.textContent('#h-agendar'), /Pague com Pix para confirmar o horário/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'h-agendar', 'o foco vai para o título da tela nova');
  assert.match(tela, /Ressonância · terça-feira, 17 de novembro às 09:00/);
  assert.match(tela, /Clínica Exemplo de Imagem/);
  assert.match(tela, /Valor\s*R\$ 450,00/);
  assert.equal(await page.textContent('.pg-tempo'), '8:00', 'o prazo do QR é o que o servidor devolveu');
  assert.equal(await page.getAttribute('.pg-tempo', 'role'), 'timer');
  assert.equal(await page.inputValue('.pg-code'), COPIA_E_COLA);
  assert.equal(await page.getAttribute('.pg-code', 'readonly'), '');
  assert.equal(await page.getAttribute('.pg-qr svg', 'role'), 'img');
  assert.match(await page.getAttribute('.pg-qr svg', 'aria-label'), /QR Code do Pix/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pg-qr')).backgroundColor), 'rgb(255, 255, 255)');
  assert.match(tela, /Pode fechar esta página: o pagamento não se perde\./);
  assert.match(tela, /O IMED só recebe pagamento dentro do site/);
  assert.doesNotMatch(tela, /confirmado para|Comprovante/i, 'nada de "confirmado" antes do pagamento');
  // no aparelho: aguardando pagamento, nunca confirmado; e o CPF não fica guardado em lugar nenhum
  const id = idDe(log);
  const [g] = await guardados(page);
  assert.deepEqual([g.id, g.status, g.pay, g.items[0]], [id, 'aguardando_pagamento', 1, 'Ressonância']);
  const aparelho = await tudoNoAparelho(page);
  assert.ok(!aparelho.includes('52998224725') && !aparelho.includes('529.982.247-25'), 'o CPF não fica no aparelho');
  // copiar o código
  await page.click('[data-pg="copy"]');
  await page.waitForFunction(() => /Código copiado\. Cole no aplicativo do seu banco/.test(document.querySelector('.pg-msg')?.textContent ?? ''));
  assert.equal(await page.getAttribute('.pg-msg', 'role'), 'status');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), COPIA_E_COLA);
  await shot(page, 'pagamento-1-qr');
  // o relógio anda
  await page.context().clock.setFixedTime(new Date(st.rel.t + 18000));
  await page.waitForFunction(() => document.querySelector('.pg-tempo')?.textContent === '7:42');
  // o pagamento chega (o aviso é do servidor; a página só consulta)
  st.pagar(id);
  await page.waitForSelector('.pg-recibo', { timeout: 15000 });
  assert.match(await page.textContent('#h-agendar'), /Pagamento aprovado\. Agendamento confirmado para terça-feira, 17 de novembro às 09:00/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'h-agendar', 'o foco vai para a confirmação');
  const recibo = await page.textContent('.pg-recibo');
  assert.match(recibo, /Comprovante de pagamento/);
  assert.equal(await page.evaluate(() => document.querySelector('.pg-rh').tagName), 'H3', 'subtítulo um nível abaixo do título (h2)');
  assert.match(recibo, /Valor pago\s*R\$ 450,00/);
  assert.match(recibo, /Pago em\s*16\/11\/2026 às 09:00/);
  assert.match(recibo, /Forma de pagamento\s*Pix/);
  assert.match(recibo, new RegExp(`Código do agendamento\\s*IMED-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`));
  assert.match(recibo, /Local\s*Clínica Exemplo de Imagem/);
  assert.match(recibo, /Exame\s*Ressonância/);
  assert.match(recibo, /Horário\s*terça-feira, 17 de novembro às 09:00/);
  assert.match(recibo, /A nota fiscal do exame é emitida pela clínica\./);
  assert.doesNotMatch(await page.textContent('#agendar'), /taxa|tarifa|15 ?%|gratuito/i);
  assert.equal(await page.locator('.pg-qr, .pg-code').count(), 0, 'o QR some depois de pago');
  assert.equal((await guardados(page))[0].status, 'confirmado', 'agora sim, confirmado no aparelho');
  assert.match(await page.textContent('#lcLive'), /Pagamento aprovado\. Agendamento confirmado\./, 'aviso para o leitor de tela');
  // lembrete na agenda: só depois de pago
  const [down] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="ics"]')]);
  assert.match(down.suggestedFilename(), /^imed-[0-9a-f]{8}\.ics$/);
  assert.equal(await page.getAttribute('.ok-acts a:has-text("Como se preparar")', 'href'), 'exames/ressonancia-magnetica.html#preparo');
  assert.deepEqual(log.rpc.filter((x) => x.fn === 'agenda_book'), []);
  assert.equal(await overflow(page), 0);
  await shot(page, 'pagamento-2-pago');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('vencido: o relógio zera, a tela esconde o QR e confere; a reserva expira → "o tempo acabou" e dá para escolher de novo', async () => {
  const { page, log, st, errors, context, avancar } = await abrir(browser);
  await irParaOPagamento(page);
  await page.waitForSelector('.pg-qr svg');
  const id = idDe(log);
  await avancar(8);
  await page.waitForSelector('[data-view="conferindo"]');
  assert.match(await page.textContent('#h-agendar'), /O tempo do QR Code acabou/);
  assert.equal(await page.locator('.pg-qr, .pg-code, [data-pg="copy"]').count(), 0, 'sem QR e sem código depois do prazo');
  assert.match(await page.textContent('#agendar'), /Se você já pagou, espere um instante: estamos conferindo/);
  st.vencer(id);
  await page.waitForSelector('[data-view="vencido"]', { timeout: 15000 });
  assert.match(await page.textContent('#h-agendar'), /O tempo para pagar acabou/);
  assert.match(await page.textContent('#agendar'), /O horário voltou para a agenda e nada foi cobrado\. Se você pagou depois do prazo, o valor volta inteiro para a conta que pagou\./);
  await shot(page, 'pagamento-3-vencido');
  const pedidos = log.rpc.filter((x) => x.fn === 'pag_my_payment').length;
  await page.waitForTimeout(4500);
  assert.equal(log.rpc.filter((x) => x.fn === 'pag_my_payment').length, pedidos, 'tela final: para de consultar');
  // escolher de novo: os horários voltam (o mesmo horário está livre de novo)
  await page.click('[data-pg="restart"]');
  await page.waitForSelector('.sl-t');
  assert.match(await page.textContent('#h-agendar'), /Escolha o horário/);
  assert.equal(await page.locator('.sl-t').count(), 3);
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_intencao')), null, 'a intenção antiga foi esquecida');
  await page.click('.sl-t >> nth=0');
  assert.equal(await page.inputValue('#bkName'), 'Ana Teste', 'o nome já digitado volta');
  assert.equal(await page.isChecked('input[name="consent"]'), true);
  assert.equal(await page.inputValue('#bkCpf'), '', 'o CPF nunca é guardado: digita de novo');
  await page.fill('#bkCpf', CPF);
  await page.click('#bkBtn');
  await page.waitForSelector('.pg-qr svg');
  const criar = log.funcao.filter((x) => x.body.action === 'criar');
  assert.equal(criar.length, 2);
  assert.notEqual(criar[1].body.id, criar[0].body.id, 'tentativa nova = agendamento novo');
  assert.notEqual(criar[1].body.key, criar[0].body.key);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('página fechada e reaberta: retoma o pagamento pela reserva gravada, sem criar outra; depois de pago, mostra o comprovante', async () => {
  const a = await abrir(browser);
  await irParaOPagamento(a.page);
  await a.page.waitForSelector('.pg-qr svg');
  const id = idDe(a.log);
  const guardado = await a.context.storageState();
  await a.context.close();
  // reabre com a internet ruim (a tela do pagamento não baixa): a reserva que ESPERA o pagamento nunca aparece como confirmada
  const ruim = await abrir(browser, { banco: a.st, guardado });
  await ruim.context.route('**/assets/js/pagamento.js', (r) => r.abort());
  await ruim.page.goto(LOCAL);
  await ruim.page.waitForSelector('.sl-t');
  assert.equal(await ruim.page.locator('.lc-ok').count(), 0);
  assert.doesNotMatch(await ruim.page.textContent('#agendar'), /confirmado/i);
  assert.ok(await ruim.page.evaluate(() => !!localStorage.getItem('imed_intencao')), 'a intenção continua guardada para a próxima vez');
  await ruim.context.close();
  // reabre 3 minutos depois (o aparelho guardou o id e o código do agendamento)
  a.st.rel.t += 3 * 60000;
  const b = await abrir(browser, { banco: a.st, guardado });
  await b.page.goto(LOCAL);
  await b.page.waitForSelector('.pg-qr svg');
  assert.match(await b.page.textContent('#h-agendar'), /Pague com Pix para confirmar o horário/);
  assert.equal(await b.page.textContent('.pg-tempo'), '5:00', 'o relógio continua de onde estava');
  assert.equal(await b.page.inputValue('.pg-code'), COPIA_E_COLA);
  assert.deepEqual(b.log.funcao, [], 'nenhuma reserva nem cobrança nova');
  assert.equal(b.log.rpc.find((x) => x.fn === 'agenda_my_booking').body.p_id, id);
  assert.equal(await b.page.locator('.sl-t').count(), 0, 'os horários não aparecem por cima do pagamento em andamento');
  const guardado2 = await b.context.storageState();
  await b.context.close();
  // pagou com a página fechada; ao reabrir, o comprovante
  a.st.pagar(id);
  const c = await abrir(browser, { banco: a.st, guardado: guardado2 });
  await c.page.goto(LOCAL);
  await c.page.waitForSelector('.pg-recibo');
  assert.match(await c.page.textContent('#h-agendar'), /Pagamento aprovado\. Agendamento confirmado/);
  assert.equal((await guardados(c.page))[0].status, 'confirmado');
  assert.deepEqual(c.log.funcao, []);
  assert.deepEqual([...a.errors, ...b.errors, ...c.errors], []);
  await c.context.close();
});

await scenario('pagamento atrasado: a reserva tinha expirado; o agendamento não é confirmado e o valor volta inteiro (devolução à vista)', async () => {
  const a = await abrir(browser);
  await irParaOPagamento(a.page);
  await a.page.waitForSelector('.pg-qr svg');
  const id = idDe(a.log);
  // com a tela aberta: o pagamento chega depois de a reserva expirar
  await a.avancar(16);
  a.st.atrasar(id);
  await a.page.waitForSelector('[data-view="devolucao"]', { timeout: 15000 });
  assert.match(await a.page.textContent('#h-agendar'), /O pagamento chegou depois do prazo/);
  const tela = await a.page.textContent('#agendar');
  assert.match(tela, /O horário já não estava mais guardado, por isso o agendamento não foi confirmado\. O valor volta inteiro para a conta que pagou\./);
  assert.match(tela, /Devolução pedida em 16\/11: R\$ 450,00/);
  assert.doesNotMatch(tela, /Agendamento confirmado|Comprovante/);
  assert.notEqual((await guardados(a.page))[0].status, 'confirmado');
  await shot(a.page, 'pagamento-4-atrasado');
  const guardado = await a.context.storageState();
  await a.context.close();
  // reabrindo a página depois: a devolução concluída aparece
  a.st.rel.t += 60 * 60000;
  a.st.devolver(id);
  const b = await abrir(browser, { banco: a.st, guardado });
  await b.page.goto(LOCAL);
  await b.page.waitForSelector('[data-view="devolvido"]');
  assert.match(await b.page.textContent('#h-agendar'), /Valor devolvido/);
  assert.match(await b.page.textContent('#agendar'), /Devolvido em 16\/11: R\$ 450,00/);
  await b.page.click('[data-pg="restart"]');
  await b.page.waitForSelector('.sl-t');
  assert.deepEqual([...a.errors, ...b.errors], []);
  await b.context.close();
});

await scenario('meio de pagamento fora do ar: "pagamento indisponível", a reserva foi solta, nada fica guardado e dá para tentar de novo', async () => {
  const { page, log, st, errors, context } = await abrir(browser);
  st.falha = 'provider_unavailable';
  await irParaOPagamento(page);
  await page.waitForSelector('[data-view="erro"]');
  assert.match(await page.textContent('#h-agendar'), /Pagamento indisponível agora/);
  assert.match(await page.textContent('#agendar'), /O pagamento está indisponível agora\. O horário foi liberado e nada foi cobrado\. Tente de novo em alguns minutos\./);
  assert.equal(await page.getAttribute('#agendar .pg-txt a', 'href'), 'tel:+551130000000', 'telefone da clínica como alternativa');
  assert.deepEqual(await guardados(page), [], 'nada em Meus pedidos');
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_intencao')), null);
  assert.deepEqual(log.rpc.filter((x) => x.fn === 'pag_my_payment'), [], 'não fica consultando um pagamento que não existe');
  await shot(page, 'pagamento-5-indisponivel');
  // o meio de pagamento voltou: escolher de novo funciona, com os dados já digitados (menos o CPF, que nunca é guardado)
  st.falha = '';
  await page.click('[data-pg="restart"]');
  await page.waitForSelector('.sl-t');
  await page.click('.sl-t >> nth=0');
  assert.equal(await page.inputValue('#bkName'), 'Ana Teste');
  assert.equal(await page.inputValue('#bkCpf'), '', 'o CPF não é guardado nem no rascunho');
  await page.fill('#bkCpf', CPF);
  await page.click('#bkBtn');
  await page.waitForSelector('.pg-qr svg');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('respostas do servidor: horário pego, pagamento desligado, sem resposta (reenvia o MESMO pedido), limite e desafio', async () => {
  const { page, log, st, errors, context } = await abrir(browser);
  // horário pego por outra pessoa no meio do caminho
  await escolher(page);
  st.ocupados.add(new Date(st.rows(PROC_RM)[0].slot_start).toISOString());
  await page.click('#bkBtn');
  await page.waitForSelector('#slNotice');
  assert.equal(await page.textContent('#slNotice'), 'Este horário acabou de ser ocupado por outra pessoa. Escolha outro horário abaixo.');
  assert.equal(await page.locator('.sl-t').count(), 2, 'os outros horários');
  assert.deepEqual(await guardados(page), []);
  // pagamento desligado no servidor (chave geral, Turnstile não configurado...): mensagem clara, nada reservado
  for (const falha of ['payments_off', 'captcha_not_configured', 'payment_not_available']) {
    st.falha = falha;
    await page.click('.sl-t >> nth=0');
    await page.fill('#bkCpf', CPF);
    await page.click('#bkBtn');
    await page.waitForSelector('#bkErr.show');
    assert.match(await page.textContent('#bkErr'), /O pagamento pelo site não está disponível nesta clínica agora\. Ligue para a clínica para agendar\. Se preferir, ligue para a clínica\./, falha);
    assert.equal((await page.textContent('#bkBtn')).trim(), 'Ir para o pagamento');
    await page.click('[data-act="change-slot"]');
  }
  for (const [falha, texto] of [['captcha_failed', /Não foi possível confirmar que o pedido veio de uma pessoa/], ['rate_limited', /Foram muitas tentativas seguidas/],
    ['payment_pending', /Este celular já tem um pagamento em andamento/], ['too_many_expired', /venceram sem pagamento/], ['hold_expired', /O tempo da reserva acabou antes/]]) {
    st.falha = falha;
    await page.click('.sl-t >> nth=0');
    await page.fill('#bkCpf', CPF);
    await page.click('#bkBtn');
    await page.waitForSelector('#bkErr.show');
    assert.match(await page.textContent('#bkErr'), texto, falha);
    await page.click('[data-act="change-slot"]');
  }
  assert.deepEqual(await guardados(page), [], 'nenhuma dessas respostas grava pedido no aparelho');
  // sem resposta (a internet caiu): "Tentar de novo" manda o MESMO id, código e chave
  st.falha = 'rede';
  await page.click('.sl-t >> nth=0');
  await page.fill('#bkCpf', CPF);
  const antes = log.funcao.length;
  await page.click('#bkBtn');
  await page.waitForSelector('#bkErr.show');
  assert.match(await page.textContent('#bkErr'), /Não foi possível abrir o pagamento agora\. Verifique sua internet e toque em Tentar de novo: o mesmo pedido é reenviado, sem reservar duas vezes\./);
  assert.equal((await page.textContent('#bkBtn')).trim(), 'Tentar de novo');
  st.falha = '';
  await page.click('#bkBtn');
  await page.waitForSelector('.pg-qr svg');
  const [t1, t2] = log.funcao.slice(antes).map((x) => x.body);
  assert.deepEqual([t2.id, t2.token, t2.key], [t1.id, t1.token, t1.key], 'o reenvio é o mesmo pedido');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('"Já paguei" só confere (não confirma nada); "Cancelar" pede confirmação, libera o horário e nada é cobrado', async () => {
  const { page, log, st, errors, context } = await abrir(browser);
  await irParaOPagamento(page);
  await page.waitForSelector('.pg-qr svg');
  const id = idDe(log);
  await page.click('[data-pg="check"]');
  await page.waitForFunction(() => /Ainda não recebemos o pagamento/.test(document.querySelector('.pg-msg')?.textContent ?? ''));
  const conf = log.funcao.find((x) => x.body.action === 'conferir');
  assert.deepEqual(Object.keys(conf.body).sort(), ['action', 'id', 'token']);
  assert.equal(conf.body.id, id);
  assert.match(await page.textContent('#h-agendar'), /Pague com Pix/, 'continua aguardando: "já paguei" não confirma nada');
  // cancelar: pergunta antes
  await page.click('[data-pg="cancel"]');
  assert.match(await page.textContent('.pg-ask'), /Cancelar o pagamento e liberar o horário\?/);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.pg), 'cancel-yes');
  await page.click('[data-pg="cancel-no"]');
  assert.equal(await page.locator('.pg-ask').count(), 0);
  assert.deepEqual(log.rpc.filter((x) => x.fn === 'cancel_request'), []);
  await page.click('[data-pg="cancel"]');
  await page.click('[data-pg="cancel-yes"]');
  await page.waitForSelector('[data-view="cancelado"]');
  assert.match(await page.textContent('#h-agendar'), /Pagamento cancelado/);
  assert.match(await page.textContent('#agendar'), /O horário foi liberado e nada foi cobrado\./);
  const cancel = log.rpc.find((x) => x.fn === 'cancel_request');
  assert.deepEqual(Object.keys(cancel.body).sort(), ['p_id', 'p_token']);
  assert.equal(cancel.body.p_id, id);
  assert.equal(st.pedidos.get(id).status, 'cancelled');
  assert.equal((await guardados(page))[0].status, 'cancelado');
  // "já paguei" depois de pagar de verdade: aí sim aparece pago (quem disse foi o banco)
  await page.click('[data-pg="restart"]');
  await page.waitForSelector('.sl-t');
  await page.click('.sl-t >> nth=0');
  await page.fill('#bkCpf', CPF);
  await page.click('#bkBtn');
  await page.waitForSelector('.pg-qr svg');
  st.pagar(log.funcao.filter((x) => x.body.action === 'criar').at(-1).body.id);
  await page.click('[data-pg="check"]');
  await page.waitForSelector('.pg-recibo');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('exame "sob consulta" na clínica que recebe pelo site: continua confirmando sem pagar (pagamento no local)', async () => {
  const marcados = [];
  const book = (b) => { marcados.push(b); return { status: 'ok', id: b.p_id, request_status: 'confirmed', slot_start: b.p_items[0].starts_at, slot_end: b.p_items[0].starts_at, hold_expires_at: null, items: [] }; };
  const { page, log, errors, context } = await abrir(browser, { book });
  await page.goto(`${LOCAL}&exame=tc`);
  await page.waitForSelector('.sl-t');
  await page.click('.sl-t >> nth=0');
  assert.equal(await page.locator('#bkCpf').count(), 0, 'sem preço, não há pagamento pelo site');
  assert.equal((await page.textContent('#bkBtn')).trim(), 'Confirmar agendamento');
  await page.fill('#bkName', 'Ana Teste'); await page.fill('#bkPhone', '11987654321'); await page.check('input[name="consent"]');
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  assert.equal(marcados.length, 1);
  assert.deepEqual(log.funcao, []);
  // trocar para o exame com preço: aí o pagamento aparece
  await page.goto(LOCAL);
  await page.waitForSelector('.sl-t');
  await page.click('.sl-t >> nth=0');
  assert.equal(await page.locator('#bkCpf').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('desafio contra robôs (Turnstile): com a chave do site configurada, o código do desafio vai para o servidor', async () => {
  const init = () => {
    // a chave do site entra depois de o config.js rodar; o "Turnstile" é um boneco que resolve o desafio na hora
    Object.defineProperty(window, 'IMED_CONFIG', { configurable: true, set(v) { Object.defineProperty(window, 'IMED_CONFIG', { value: v, writable: true, configurable: true }); v.turnstileSiteKey = 'chave-do-site-de-teste'; } });
    window.turnstile = { render(host, o) { window.__ts = { host: host.id, sitekey: o.sitekey }; setTimeout(() => o.callback('codigo-do-desafio'), 20); return 'w1'; } };
  };
  const { page, log, errors, context } = await abrir(browser, { init });
  await irParaOPagamento(page);
  await page.waitForSelector('.pg-qr svg');
  assert.equal(log.funcao[0].body.captcha, 'codigo-do-desafio');
  assert.deepEqual(await page.evaluate(() => window.__ts), { host: 'pgCaptcha', sitekey: 'chave-do-site-de-teste' });
  assert.deepEqual(log.outros, [], 'com o Turnstile já na página, nada mais é baixado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('conta: o pedido pago pelo site mostra a situação, "Continuar o pagamento" abre o QR ali mesmo e, pago, vira comprovante', async () => {
  const rel = { t: NOW_MS };
  const st = bancoDoPagamento({ agora: () => rel.t });
  st.rel = rel;
  const ID = '77777777-7777-4777-8777-777777777771';
  const linha = st.semear({ id: ID });
  const init = `localStorage.setItem('imed_appts', ${JSON.stringify(JSON.stringify([linha]))});`;
  const { page, log, errors, context } = await abrir(browser, { banco: st, init });
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector('.ct-pg');
  assert.ok(log.arquivos.some((a) => a.endsWith('/assets/js/pagamento.js')), 'baixado porque há pedido pago pelo site');
  const card = page.locator(`#pedido-${ID}`);
  assert.match(await card.locator('.ct-st').textContent(), /Aguardando pagamento/);
  assert.match(await card.locator('.ct-pg').textContent(), /Aguardando o pagamento por Pix \(R\$ 450,00\)\./);
  assert.equal(await card.locator('[data-ics]').count(), 0, 'sem "Adicionar à agenda" antes de pagar');
  assert.equal(await card.locator('[data-cancel]').count(), 0);
  const btn = card.locator('[data-pay]');
  assert.equal((await btn.textContent()).trim(), 'Continuar o pagamento');
  assert.equal(await btn.getAttribute('aria-expanded'), 'false');
  await btn.click();
  await page.waitForSelector(`#pg-${ID} .pg-qr svg`);
  assert.equal(await card.locator('[data-pay]').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.inputValue(`#pg-${ID} .pg-code`), COPIA_E_COLA);
  assert.equal(await page.textContent(`#pg-${ID} .pg-tempo`), '8:00');
  assert.equal(await page.evaluate((id) => document.querySelector(`#pg-${id} .pg-h`).tagName, ID), 'H4', 'título dentro do cartão (h3)');
  await shot(page, 'pagamento-6-conta-qr');
  // paga com a tela aberta: o cartão acompanha
  st.pagar(ID);
  await page.waitForFunction((id) => /Pago pelo site: R\$ 450,00 em 16\/11 · Pix/.test(document.querySelector(`#pedido-${id} .ct-pg`)?.textContent ?? ''), ID, { timeout: 20000 });
  assert.match(await page.locator(`#pedido-${ID} .ct-st`).textContent(), /Confirmado/);
  await page.waitForSelector(`#pg-${ID} .pg-recibo`);
  assert.match(await page.textContent(`#pg-${ID} .pg-recibo`), /Valor pago\s*R\$ 450,00.*Forma de pagamento\s*Pix.*A nota fiscal do exame é emitida pela clínica\./s);
  assert.equal((await page.locator(`#pedido-${ID} [data-pay]`).textContent()).trim(), 'Ver comprovante');
  assert.equal(await page.locator(`#pedido-${ID} [data-ics]`).count(), 1, 'pago: agora dá para pôr na agenda');
  assert.equal((await guardados(page))[0].status, 'confirmado');
  // fechar e abrir o comprovante
  await page.locator(`#pedido-${ID} [data-pay]`).click();
  assert.equal(await page.locator(`#pg-${ID}`).isHidden(), true);
  await page.locator(`#pedido-${ID} [data-pay]`).click();
  await page.waitForSelector(`#pg-${ID} .pg-recibo`);
  await shot(page, 'pagamento-7-conta-pago');
  assert.equal(await overflow(page), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('conta e "Meus pedidos": link direto para continuar; vencido, atrasado e devolvido aparecem como o banco diz', async () => {
  const rel = { t: NOW_MS };
  const st = bancoDoPagamento({ agora: () => rel.t });
  st.rel = rel;
  const ids = ['1', '2', '3', '4'].map((n) => `7777777${n}-7777-4777-8777-77777777777${n}`);
  const linhas = [st.semear({ id: ids[0], hhmm: '09:00' }), st.semear({ id: ids[1], hhmm: '09:30', situacao: 'vencido' }), st.semear({ id: ids[2], hhmm: '14:00', situacao: 'atrasado' }),
    st.semear({ id: ids[3], hhmm: '16:00', situacao: 'devolvido' })];
  const init = `localStorage.setItem('imed_appts', ${JSON.stringify(JSON.stringify(linhas))});`;
  const { page, errors, context } = await abrir(browser, { banco: st, init, mobile: true });
  // página inicial: "Aguardando pagamento" e o link para continuar; nada de "Confirmado" nem de lembrete
  await page.goto(`${BASE}index.html#agenda`);
  await page.waitForSelector(`#pedido-${ids[0]} .status`);
  await page.waitForFunction((id) => /Aguardando pagamento/.test(document.querySelector(`#pedido-${id} .status`)?.textContent ?? ''), ids[0]);
  const a0 = page.locator(`#pedido-${ids[0]}`);
  assert.equal(await a0.locator('a:has-text("Continuar o pagamento")').getAttribute('href'), `conta.html#pedido-${ids[0]}`);
  assert.equal(await a0.locator('[data-ics]').count(), 0);
  assert.match(await page.locator(`#pedido-${ids[1]} .status`).textContent(), /Reserva expirada/);
  assert.equal(await page.locator(`#pedido-${ids[1]} a:has-text("Continuar o pagamento")`).count(), 0);
  assert.doesNotMatch(await page.textContent('#appts'), /Confirmado/);
  // pelo link: a conta abre com o QR deste pedido
  await a0.locator('a:has-text("Continuar o pagamento")').click();
  await page.waitForSelector(`#pg-${ids[0]} .pg-qr svg`);
  assert.equal(await page.locator('#flash:not([hidden])').count(), 0, 'sem o aviso de avaliação');
  assert.match(await page.locator(`#pedido-${ids[1]} .ct-pg`).textContent(), /Não foi pago no prazo\. Nada foi cobrado\./);
  const atrasado = await page.locator(`#pedido-${ids[2]} .ct-pg`).textContent();
  assert.match(atrasado, /O pagamento chegou depois do prazo\. O valor volta inteiro para a conta que pagou\..*Devolução pedida em 16\/11: R\$ 450,00/s);
  assert.match(await page.locator(`#pedido-${ids[3]} .ct-pg`).textContent(), /Pagamento devolvido\..*Devolvido em 16\/11: R\$ 450,00/s);
  assert.equal(await page.locator(`#pedido-${ids[1]} [data-pay]`).count(), 0, 'vencido: nada para continuar');
  await page.locator(`#pedido-${ids[2]} [data-pay]`).click();
  await page.waitForSelector(`#pg-${ids[2]} [data-view="devolucao"]`);
  assert.equal(await page.locator(`#pg-${ids[0]}`).isHidden(), true, 'uma tela de pagamento aberta por vez');
  assert.equal(await page.getAttribute(`#pg-${ids[2]} a:has-text("Escolher o horário de novo")`, 'href'), `local.html?id=${CLINICA_ID}#agendar`);
  assert.equal(await overflow(page), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular de 360 px e tema escuro: sem rolagem lateral, botões grandes, QR preto no branco', async () => {
  for (const escuro of [false, true]) {
    const { page, log, st, errors, context } = await abrir(browser, { mobile: true, largura: 360, escuro });
    await escolher(page);
    assert.equal(await overflow(page), 0, 'formulário com o resumo do pagamento');
    await shot(page, `pagamento-360-${escuro ? 'escuro' : 'claro'}-0-resumo`);
    await page.click('#bkBtn');
    await page.waitForSelector('.pg-qr svg');
    assert.equal(await overflow(page), 0, 'tela do QR');
    const medidas = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      return { qr: r('.pg-qr').width, code: r('.pg-code').width, tela: window.innerWidth,
        botoes: [...document.querySelectorAll('.pg-acts .btn')].map((b) => Math.round(b.getBoundingClientRect().height)),
        fundoQr: getComputedStyle(document.querySelector('.pg-qr')).backgroundColor, fonteCodigo: parseFloat(getComputedStyle(document.querySelector('.pg-code')).fontSize) };
    });
    assert.ok(medidas.qr >= 200 && medidas.qr <= 240, `QR com ${medidas.qr}px`);
    assert.ok(medidas.code <= medidas.tela, 'o código cabe na tela');
    assert.ok(medidas.botoes.length === 3 && medidas.botoes.every((h) => h >= 44), `botões com ${medidas.botoes} px`);
    assert.equal(medidas.fundoQr, 'rgb(255, 255, 255)', 'QR sempre no branco, também no tema escuro');
    await shot(page, `pagamento-360-${escuro ? 'escuro' : 'claro'}-1-qr`);
    st.pagar(idDe(log));
    await page.waitForSelector('.pg-recibo', { timeout: 15000 });
    assert.equal(await overflow(page), 0, 'comprovante');
    await shot(page, `pagamento-360-${escuro ? 'escuro' : 'claro'}-2-pago`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await browser.close();
await fechar();
const falhas = results.filter(([r]) => r !== 'ok');
console.log(`\n${results.length - falhas.length}/${results.length} cenários passaram`);
process.exit(falhas.length ? 1 : 0);
