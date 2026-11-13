// Teste de ponta a ponta de "Vários exames no mesmo dia" (iMed Agenda 5.2) na página do local (local.html), num
// navegador de verdade (Playwright), com a agenda SIMULADA de tests/pacote-simulado.mjs (clínica, exames, preços e
// horários inventados para o teste). Rodar com: node tests/e2e-pacote.mjs
// Opcional: SHOTS=pasta node tests/e2e-pacote.mjs  salva capturas de tela nessa pasta.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as G from '../assets/js/geo-core.js';
import * as T from '../assets/js/confianca.js';
import { comChaves, vigiarChaves } from './regra-chaves.mjs';
import { CLINICA, SEM_VENDA, PROC, NOW, NOW_MS, D1, D2, D3, agendaPacote, ligar, json, servidor } from './pacote-simulado.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const SHOTS = process.env.SHOTS || '';
const PORT = Number(process.env.E2E_PORT) || 8779; // E2E_PORT: outra porta para rodar em paralelo
const server = await servidor(PORT);
const BASE = `http://127.0.0.1:${PORT}/`;
const LOCAL = `${BASE}local.html?id=${CLINICA}&exame=rm`;
const D0 = G.zonedDate(0, NOW_MS);
const hora = (iso, tz = 'America/Sao_Paulo') => G.zonedDateTime(iso, tz).time;
const isoDe = (day, hhmm) => new Date(`${day}T${hhmm}:00-03:00`).toISOString();

// celular: 360×740 (o mais estreito que o site atende). trocar: respostas trocadas de funções do banco.
async function abrir(browser, { mobile = false, tz = 'America/Sao_Paulo', agenda, trocar, colorScheme, now = NOW, guardado } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 360, height: 740 } : { width: 1366, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: tz, serviceWorkers: 'block', acceptDownloads: true,
    ...(colorScheme ? { colorScheme } : {}),
  });
  await context.clock.setFixedTime(new Date(now));
  // o aviso de privacidade já visto (ele cobre o fim da tela); e, se pedido, o que o aparelho já guardava
  await context.addInitScript((g) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (g && !sessionStorage.getItem('semeado')) { for (const [k, v] of Object.entries(g)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('semeado', '1'); }
    } catch { /* sem armazenamento */ }
  }, guardado ?? null);
  const ag = agenda ?? agendaPacote();
  const log = await ligar(context, ag, trocar);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, log, errors, ag };
}

const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(450); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); } };
const results = [];
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  try { await Promise.race([comChaves(fn), limite(name)]); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 5).join('\n  ')}`); }
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const rpcs = (log, fn) => log.rpc.filter((r) => r.fn === fn).map((r) => r.body);
const texto = (page, sel) => page.locator(sel).evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const guardados = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('imed_appts') || '[]'));
const intencao = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('imed_intencao') || 'null'));
// O anúncio para o leitor de tela (região viva): espera o texto que casa com `re` e devolve.
const viva = async (page, re) => { await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#lcLive')?.textContent ?? ''), re.source); return page.textContent('#lcLive'); };
const fillPerson = async (page, nome = 'Ana Teste', cel = '11987654321') => {
  await page.fill('#bkName', nome);
  await page.fill('#bkPhone', cel);
  await page.check('input[name="consent"]');
};
// Abre "vários exames" e marca os exames pedidos (a ressonância já vem marcada: é o exame da página).
async function escolher(page, ...ids) {
  await page.waitForSelector('.sl-day');
  await page.click('[data-act="pacote"]');
  await page.waitForSelector('input[name="pkProc"]');
  for (const id of ids) await page.check(`#pk-${id}`);
  await page.waitForSelector('#pkOpts .pk-opt, #pkOpts .pk-none, .pk-none');
}
// Os cartões das opções como texto: ["08:00 às 08:30 Ressonância do joelho", ...] por opção.
const cartoes = (page) => page.locator('.pk-opt').evaluateAll((els) => els.map((el) => [...el.querySelectorAll('.pk-steps li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim())));
// O que a agenda simulada devolve, no formato dos cartões.
const esperado = (ag, ids, day, nomes) => ag.options({ p_procedures: ids, p_day: day, p_limit: 5 }).options.map((o) => o.items.map((i, n) => {
  const gap = n ? Math.round((Date.parse(i.starts_at) - Date.parse(o.items[n - 1].ends_at)) / 60000) : 0;
  return `${gap ? `espera de ${G.durationText(gap)} ` : ''}${hora(i.starts_at)} às ${hora(i.ends_at)} ${nomes[i.procedure_id]}`;
}));
const NOMES = { [PROC.rm]: 'Ressonância do joelho', [PROC.tc]: 'Tomografia do tórax', [PROC.usg]: 'Ultrassom do abdome', [PROC.ecg]: 'Eletrocardiograma', [PROC.dens]: 'Densitometria óssea' };

const browser = vigiarChaves(await chromium.launch());

await scenario('2 exames: escolhe os exames e o dia, vê as combinações do banco e confirma os dois de uma vez (aparelho em Tóquio, horários de Brasília)', async () => {
  let antes = null;
  const { context, page, log, errors, ag } = await abrir(browser, {
    tz: 'Asia/Tokyo',
    trocar: { agenda_book: async (route, body, a) => { antes = await intencao(page); return json(route, a.book(body)); } },
  });
  await page.goto(LOCAL);
  await page.waitForSelector('.sl-day');
  // a entrada fica logo abaixo do exame; o módulo dos vários exames só é baixado no toque
  assert.equal((await page.textContent('[data-act="pacote"]')).trim(), 'Marcar mais de um exame no mesmo dia');
  assert.ok(!log.arquivos.includes('local-pacote.js'), 'local-pacote.js não é baixado antes do toque');
  assert.deepEqual(rpcs(log, 'agenda_days'), []);
  await page.click('[data-act="pacote"]');
  await page.waitForSelector('input[name="pkProc"]');
  assert.ok(log.arquivos.includes('local-pacote.js'));
  assert.equal((await page.textContent('#h-agendar')).trim(), 'Vários exames no mesmo dia');
  assert.equal(await page.evaluate(() => document.activeElement?.name), 'pkProc', 'o foco vai para o primeiro exame');
  assert.deepEqual(await page.locator('input[name="pkProc"]:checked').evaluateAll((els) => els.map((e) => e.value)), [PROC.rm], 'o exame da página já vem marcado');
  assert.equal(await page.textContent('#pkCount'), 'Escolha mais um exame, pelo menos.');
  assert.equal(await page.locator('.pk-day, .pk-opt').count(), 0, 'com 1 exame, nada de dias nem combinações');
  // preço e duração de cada exame: só o que a clínica informou
  assert.deepEqual(await texto(page, '.pk-ex'), ['Ressonância do joelho R$ 450 · 30 min', 'Tomografia do tórax preço sob consulta · 20 min', 'Ultrassom do abdome R$ 180 · 30 min',
    'Eletrocardiograma R$ 90 · 15 min', 'Densitometria óssea preço sob consulta · 20 min']);

  await page.check(`#pk-${PROC.tc}`);
  await page.waitForSelector('.pk-opt');
  assert.equal(await page.evaluate(() => document.activeElement?.id), `pk-${PROC.tc}`, 'o foco continua no exame que a pessoa marcou');
  assert.equal(await page.textContent('#pkCount'), '2 exames escolhidos.');
  // perguntas ao banco: os dias de cada exame (14 dias no fuso da unidade) e as combinações do primeiro dia comum
  assert.deepEqual(rpcs(log, 'agenda_days'), [PROC.rm, PROC.tc].map((p) => ({ p_clinic: CLINICA, p_procedure: p, p_from: D0, p_to: G.zonedDate(13, NOW_MS) })));
  assert.deepEqual(rpcs(log, 'agenda_package_options'), [{ p_clinic: CLINICA, p_procedures: [PROC.rm, PROC.tc], p_day: D1, p_limit: 5 }]);
  // dias: hoje não tem horário; amanhã, depois e o 3º dia têm para os dois
  const tabs = await page.locator('.pk-day').evaluateAll((els) => els.map((e) => [e.dataset.pkday, e.disabled, e.getAttribute('aria-selected')]));
  assert.equal(tabs.length, 14);
  assert.deepEqual(tabs.filter((t) => !t[1]).map((t) => t[0]), [D1, D2, D3]);
  assert.deepEqual(tabs.find((t) => t[2] === 'true')?.[0], D1);
  assert.equal(await page.getAttribute('.sl-days', 'role'), 'tablist');
  assert.equal(await page.getAttribute(`#pktab-${D1}`, 'aria-controls'), 'pkOpts');
  assert.equal(await page.getAttribute('#pkOpts', 'role'), 'tabpanel');
  assert.equal(await page.getAttribute('#pkOpts', 'aria-labelledby'), `pktab-${D1}`);
  assert.match(await page.textContent(`#pktab-${D0}`), /sem horário para todos os exames/);
  // combinações: as do banco, na ordem do banco, no fuso da unidade
  assert.equal((await page.textContent('#pkOpts .sl-when')).trim(), 'terça-feira, 17 de novembro');
  const cards = await cartoes(page);
  assert.equal(cards.length, 5);
  assert.deepEqual(cards, esperado(ag, [PROC.rm, PROC.tc], D1, NOMES));
  assert.deepEqual(cards[0], ['08:00 às 08:30 Ressonância do joelho', '08:30 às 08:50 Tomografia do tórax']);
  assert.deepEqual(await texto(page, '.pk-opt h3'), ['Opção 1 das 08:00 às 08:50', 'Opção 2 das 08:30 às 09:20', 'Opção 3 das 09:00 às 09:50', 'Opção 4 das 10:00 às 10:50', 'Opção 5 das 08:30 às 09:30']);
  assert.deepEqual((await texto(page, '.pk-tot')).slice(0, 1), ['Sem espera entre os exames · 50 min do começo ao fim']);
  assert.equal((await texto(page, '.pk-tot'))[4], 'Espera entre os exames: 10 min · 1 h do começo ao fim');
  assert.deepEqual(cards[4], ['08:30 às 08:50 Tomografia do tórax', 'espera de 10 min 09:00 às 09:30 Ressonância do joelho']);
  assert.ok(!/R\$/.test((await texto(page, '.pk-opts')).join(' ')), 'nenhum total em dinheiro nas combinações');
  assert.equal(await page.getAttribute('[data-act="pk-pick"] >> nth=0', 'aria-describedby'), 'pko-0');
  assert.deepEqual(await texto(page, '.pk-prep li'), ['Ressonância do joelho: Retire objetos de metal.', 'Tomografia do tórax: Jejum de 4 horas.']);
  assert.match((await texto(page, '#pkOpts .src'))[0], /^Os horários estão no horário de Brasília, o da clínica\. Ao confirmar, os 2 horários ficam reservados juntos: ou todos ficam confirmados, ou nenhum\.$/);
  assert.match(await viva(page, /^5 combinações de horário em terça-feira, 17 de novembro\. A primeira: das 08:00 às 08:50\.$/), /^5 combinações de horário em terça-feira, 17 de novembro\. A primeira: das 08:00 às 08:50\.$/);
  await shot(page, 'p01-opcoes');

  // escolhe a opção 1: a conferência antes de confirmar
  await page.click('[data-act="pk-pick"] >> nth=0');
  await page.waitForSelector('#bookForm');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'bkName');
  assert.equal((await page.textContent('#h-agendar')).trim(), 'Confirme seus exames');
  assert.equal(await page.getAttribute('#bookForm', 'data-mode'), 'pkg');
  assert.deepEqual(await texto(page, '.pk-chosen-h b, .pk-chosen-d'), ['2 exames no mesmo dia', 'Terça-feira, 17 de novembro, das 08:00 às 08:50 (horário de Brasília)']);
  assert.deepEqual(await texto(page, '.pk-chosen .pk-steps li'), ['08:00 às 08:30 Ressonância do joelho R$ 450 · 30 min', '08:30 às 08:50 Tomografia do tórax preço sob consulta · 20 min']);
  assert.ok(!/R\$ ?(45[1-9]|4[6-9]\d|[5-9]\d\d)/.test(await page.innerText('#agendar')), 'os preços não são somados');
  assert.equal(await page.locator('#bkNotes').count(), 0, 'sem observações livres na marcação direta');
  assert.deepEqual(await texto(page, '.sl-rules li'), ['Pagamento no local, direto com a clínica.', 'Dá para cancelar pelo site, em Meus pedidos, até 2 h antes do horário.']);
  assert.equal((await page.textContent('#bkBtn')).trim(), 'Confirmar os 2 exames');
  assert.match(await page.innerText('#bookForm'), /Ao tocar em Confirmar, os 2 horários ficam reservados e confirmados juntos na agenda da clínica: ou todos, ou nenhum\./);
  assert.match(await page.innerText('label[data-f="consent"]'), /incluindo os exames escolhidos, para reservar meus horários no estabelecimento/);
  await shot(page, 'p02-confirmar');
  await fillPerson(page);
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  // UMA chamada, com os dois exames; id e código gravados no aparelho antes do envio
  const books = rpcs(log, 'agenda_book');
  assert.equal(books.length, 1);
  assert.deepEqual(books[0].p_items, [{ procedure_id: PROC.rm, starts_at: isoDe(D1, '08:00') }, { procedure_id: PROC.tc, starts_at: isoDe(D1, '08:30') }]);
  assert.deepEqual(books[0].p_patient, { name: 'Ana Teste', phone: '11987654321', consent: true });
  assert.deepEqual(Object.keys(books[0]).sort(), ['p_clinic', 'p_id', 'p_items', 'p_patient', 'p_token']);
  assert.ok(G.isUuid(books[0].p_id) && /^[0-9a-f]{64}$/.test(books[0].p_token));
  assert.deepEqual([antes?.id, antes?.token], [books[0].p_id, books[0].p_token], 'a intenção foi gravada antes do envio');
  assert.match(antes.key, new RegExp(`^${CLINICA}\\|pacote\\|`));
  assert.equal(await intencao(page), null, 'confirmado: a intenção é esquecida');
  // confirmado: cada exame com o horário e o preparo dele
  assert.equal((await page.textContent('.lc-ok h2')).trim(), '2 exames confirmados para terça-feira, 17 de novembro');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'h-agendar');
  assert.deepEqual(await texto(page, '.pk-done li'), ['08:00 às 08:30 Ressonância do joelho Preparo informado pela clínica: Retire objetos de metal.',
    '08:30 às 08:50 Tomografia do tórax Preparo informado pela clínica: Jejum de 4 horas.']);
  const ok = await page.innerText('.lc-ok');
  assert.match(ok, /Clínica Simulada dos Exames\s+Das 08:00 às 08:50 \(horário de Brasília\)/);
  assert.match(ok, new RegExp(G.protocolFromId(books[0].p_id)));
  assert.match(ok, /Seus 2 horários estão reservados e confirmados na agenda da clínica\./);
  assert.match(ok, /cancele em Meus pedidos \(os 2 exames são cancelados juntos\) ou avise a clínica pelo telefone \(11\) 3000-0000/);
  assert.equal([...ag.taken.values()].filter((v) => v === books[0].p_id).length, 2, 'os dois horários ficaram com este agendamento');
  // Meus pedidos (aparelho): o pacote inteiro
  const [g] = await guardados(page);
  assert.deepEqual([g.id, g.token, g.status, g.slot, g.slot_end, g.tz, g.items.join(' + ')],
    [books[0].p_id, books[0].p_token, 'confirmado', isoDe(D1, '08:00'), isoDe(D1, '08:50'), 'America/Sao_Paulo', 'Ressonância do joelho + Tomografia do tórax']);
  assert.deepEqual(g.parts.map((x) => [x.name, x.slot, x.slot_end, x.prep]), [['Ressonância do joelho', isoDe(D1, '08:00'), isoDe(D1, '08:30'), 'Retire objetos de metal.'],
    ['Tomografia do tórax', isoDe(D1, '08:30'), isoDe(D1, '08:50'), 'Jejum de 4 horas.']]);
  // "Adicionar à agenda": um evento por exame, em UTC, com a duração real
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="ics"]')]);
  const ics = await readFile(await dl.path(), 'utf8');
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2);
  assert.match(ics, /DTSTART:20261117T110000Z\r\nDTEND:20261117T113000Z\r\n/);
  assert.match(ics, /DTSTART:20261117T113000Z\r\nDTEND:20261117T115000Z\r\n/);
  assert.ok(!/TZID/.test(ics));
  assert.match(ics.replace(/\r\n /g, ''), /SUMMARY:Exame 2 de 2: Tomografia do tórax — Clínica Simulada dos Exames/);
  await shot(page, 'p03-confirmado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('4 exames (o máximo): o 5º fica travado; confirma os 4 juntos', async () => {
  const { context, page, log, errors, ag } = await abrir(browser);
  await page.goto(LOCAL);
  await escolher(page, PROC.tc, PROC.usg, PROC.ecg);
  await page.waitForFunction(() => document.querySelectorAll('.pk-opt .pk-steps').length && [...document.querySelectorAll('.pk-opt .pk-steps')].every((s) => s.children.length === 4));
  assert.equal(await page.textContent('#pkCount'), '4 exames escolhidos: é o máximo de uma vez.');
  assert.equal(await page.isDisabled(`#pk-${PROC.dens}`), true, 'o 5º exame não pode ser marcado');
  assert.deepEqual(rpcs(log, 'agenda_package_options').at(-1), { p_clinic: CLINICA, p_procedures: [PROC.rm, PROC.tc, PROC.usg, PROC.ecg], p_day: D1, p_limit: 5 });
  const cards = await cartoes(page);
  assert.deepEqual(cards, esperado(ag, [PROC.rm, PROC.tc, PROC.usg, PROC.ecg], D1, NOMES));
  assert.ok(cards.length >= 1 && cards.every((c) => c.length === 4), 'cada combinação tem os 4 exames');
  // desmarcar um solta o 5º
  await page.uncheck(`#pk-${PROC.ecg}`);
  await page.waitForFunction(() => document.querySelector('#pkCount')?.textContent === '3 exames escolhidos.');
  assert.equal(await page.isDisabled(`#pk-${PROC.dens}`), false);
  await page.check(`#pk-${PROC.ecg}`);
  await page.waitForFunction(() => [...document.querySelectorAll('.pk-opt .pk-steps')].length && [...document.querySelectorAll('.pk-opt .pk-steps')].every((s) => s.children.length === 4));
  const primeira = (await cartoes(page))[0];
  await page.click('[data-act="pk-pick"] >> nth=0');
  await page.waitForSelector('#bookForm');
  assert.deepEqual(await texto(page, '.pk-chosen-h b'), ['4 exames no mesmo dia']);
  assert.equal((await page.textContent('#bkBtn')).trim(), 'Confirmar os 4 exames');
  assert.deepEqual(await texto(page, '.pk-prep li'), ['Ultrassom do abdome: Jejum de 6 horas. Beba 4 copos de água 1 hora antes.', 'Ressonância do joelho: Retire objetos de metal.', 'Tomografia do tórax: Jejum de 4 horas.']
    .filter((t) => primeira.some((l) => l.includes(t.split(':')[0]))).sort((a, b) => primeira.findIndex((l) => l.includes(a.split(':')[0])) - primeira.findIndex((l) => l.includes(b.split(':')[0]))));
  await fillPerson(page);
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  const books = rpcs(log, 'agenda_book');
  assert.equal(books.length, 1);
  assert.equal(books[0].p_items.length, 4);
  assert.deepEqual(books[0].p_items.map((i) => i.procedure_id).sort(), [PROC.rm, PROC.tc, PROC.usg, PROC.ecg].sort());
  assert.equal((await page.textContent('.lc-ok h2')).trim(), '4 exames confirmados para terça-feira, 17 de novembro');
  assert.equal(await page.locator('.pk-done li').count(), 4);
  assert.equal(ag.taken.size, 4);
  assert.equal((await guardados(page))[0].parts.length, 4);
  await shot(page, 'p04-quatro');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('horário pego no meio: nada é marcado, aviso claro, novas combinações e id novo; os dados digitados ficam', async () => {
  const { context, page, log, errors, ag } = await abrir(browser);
  await page.goto(LOCAL);
  await escolher(page, PROC.tc);
  await page.click('[data-act="pk-pick"] >> nth=0');   // ressonância 08:00 + tomografia 08:30
  await page.waitForSelector('#bookForm');
  await fillPerson(page);
  ag.ocupar(PROC.tc, D1, '08:30');                     // outra pessoa pega a tomografia das 08:30
  await page.click('#bkBtn');
  await page.waitForSelector('#slNotice');
  await page.waitForSelector('.pk-opt');
  assert.equal(await page.textContent('#slNotice'), G.PKG_MSG.taken);
  assert.match(G.PKG_MSG.taken, /Nenhum exame foi marcado/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'slNotice', 'o aviso recebe o foco');
  assert.equal((await page.textContent('#h-agendar')).trim(), 'Vários exames no mesmo dia');
  // tudo ou nada: a ressonância das 08:00 NÃO ficou marcada
  assert.deepEqual([...ag.taken.values()], ['outra-pessoa']);
  assert.deepEqual(await guardados(page), []);
  assert.equal(await intencao(page), null, 'a intenção recusada é esquecida');
  // as combinações de novo, sem o horário pego, no mesmo dia
  const cards = await cartoes(page);
  assert.deepEqual(cards, esperado(ag, [PROC.rm, PROC.tc], D1, NOMES));
  assert.ok(!cards.flat().some((l) => l.startsWith('08:30 às 08:50 Tomografia')), 'a tomografia das 08:30 saiu');
  assert.deepEqual(await page.locator('input[name="pkProc"]:checked').evaluateAll((els) => els.map((e) => e.value)), [PROC.rm, PROC.tc], 'os exames continuam marcados');
  await shot(page, 'p05-horario-pego');
  // escolhe outra combinação: os dados digitados continuam; id e código novos
  await page.click('[data-act="pk-pick"] >> nth=0');
  await page.waitForSelector('#bookForm');
  assert.equal(await page.locator('#slNotice').count(), 0, 'o aviso some ao escolher outra combinação');
  assert.equal(await page.inputValue('#bkName'), 'Ana Teste');
  assert.equal(await page.inputValue('#bkPhone'), '(11) 98765-4321');
  assert.equal(await page.isChecked('input[name="consent"]'), true);
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  const [a, b] = rpcs(log, 'agenda_book');
  assert.notEqual(a.p_id, b.p_id, 'depois de slot_taken, id novo');
  assert.notEqual(a.p_token, b.p_token);
  assert.equal([...ag.taken.values()].filter((v) => v === b.p_id).length, 2);
  assert.equal((await guardados(page)).length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('queda de rede no envio: "Tentar de novo" reenvia o mesmo id e código e não marca duas vezes', async () => {
  let n = 0;
  const { context, page, log, errors, ag } = await abrir(browser, {
    // a 1ª resposta se perde DEPOIS de o banco gravar
    trocar: { agenda_book: (route, body, a) => { n += 1; if (n === 1) { a.book(body); return route.abort('connectionreset'); } return json(route, a.book(body)); } },
  });
  await page.goto(LOCAL);
  await escolher(page, PROC.usg);
  await page.click('[data-act="pk-pick"] >> nth=0');
  await page.waitForSelector('#bookForm');
  await fillPerson(page);
  await page.click('#bkBtn');
  await page.waitForSelector('#bkErr.show');
  assert.match(await page.textContent('#bkErr'), /Não foi possível confirmar agora\. Verifique sua internet e toque em Tentar de novo: o mesmo pedido é reenviado, sem marcar duas vezes\./);
  assert.equal((await page.textContent('#bkBtn')).trim(), 'Tentar de novo');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'bkBtn');
  const it = await intencao(page);
  assert.ok(it?.id, 'a intenção continua guardada');
  assert.deepEqual(await guardados(page), [], 'sem a resposta, o site ainda não diz que marcou');
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  const [a, b] = rpcs(log, 'agenda_book');
  assert.deepEqual([b.p_id, b.p_token, b.p_items], [a.p_id, a.p_token, a.p_items], 'o mesmo pedido, com o mesmo id e código');
  assert.deepEqual([a.p_id, a.p_token], [it.id, it.token]);
  assert.equal(ag.taken.size, 2, 'um agendamento só (2 exames), sem duplicar');
  assert.equal(new Set(ag.taken.values()).size, 1);
  assert.equal((await page.textContent('.lc-ok h2')).trim(), '2 exames confirmados para terça-feira, 17 de novembro');
  assert.equal((await guardados(page)).length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('resposta perdida e página recarregada: os exames já confirmados aparecem inteiros e vão para Meus pedidos (sem marcar outro)', async () => {
  const { context, page, log, errors, ag } = await abrir(browser, {
    trocar: { agenda_book: (route, body, a) => { a.book(body); return route.abort('connectionreset'); } },
  });
  await page.goto(LOCAL);
  await escolher(page, PROC.tc, PROC.ecg);
  await page.waitForFunction(() => [...document.querySelectorAll('.pk-opt .pk-steps')].length && [...document.querySelectorAll('.pk-opt .pk-steps')].every((s) => s.children.length === 3));
  const primeira = (await cartoes(page))[0];
  await page.click('[data-act="pk-pick"] >> nth=0');
  await page.waitForSelector('#bookForm');
  await fillPerson(page);
  await page.click('#bkBtn');
  await page.waitForSelector('#bkErr.show');
  await page.reload();
  await page.waitForSelector('.lc-ok');
  assert.equal((await page.textContent('.lc-ok h2')).trim(), 'Você já tem 3 exames confirmados para terça-feira, 17 de novembro');
  assert.deepEqual((await texto(page, '.pk-done li')).map((l) => l.replace(/ Preparo informado.*$/, '')), primeira);
  assert.equal(rpcs(log, 'agenda_book').length, 1, 'não marcou de novo');
  assert.equal(rpcs(log, 'agenda_my_booking').length, 1, 'conferiu pelo id e código guardados');
  const [g] = await guardados(page);
  assert.equal(g.parts.length, 3);
  assert.ok(g.token && g.id, 'com o código para cancelar');
  assert.equal(await intencao(page), null);
  assert.equal(ag.taken.size, 3);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('sem combinação no dia: aviso honesto, "Ver o próximo dia" e "Marcar os exames separados"', async () => {
  const { context, page, log, errors } = await abrir(browser);
  await page.goto(LOCAL);
  await page.waitForSelector('.sl-day');
  await page.click('[data-act="pacote"]');
  await page.waitForSelector('input[name="pkProc"]');
  await page.uncheck(`#pk-${PROC.rm}`);
  await page.check(`#pk-${PROC.tc}`);
  await page.check(`#pk-${PROC.dens}`);
  await page.waitForSelector('.pk-opt');
  // os dois têm horário no dia 2 e no dia 3; no dia 2 eles se cruzam: o site procura sozinho o primeiro dia com combinação
  assert.deepEqual(rpcs(log, 'agenda_package_options').map((b) => b.p_day), [D2, D3]);
  assert.equal(await page.getAttribute(`#pktab-${D3}`, 'aria-selected'), 'true');
  assert.match(await page.getAttribute(`#pktab-${D2}`, 'class'), /\bnone\b/);
  assert.match(await page.textContent(`#pktab-${D2}`), /sem combinação neste dia/);
  assert.equal(await page.isDisabled(`#pktab-${D1}`), true, 'dia em que um dos exames não tem horário');
  assert.deepEqual(await cartoes(page), [['09:30 às 09:50 Tomografia do tórax', 'espera de 1 h 10 min 11:00 às 11:20 Densitometria óssea']]);
  assert.deepEqual(await texto(page, '.pk-tot'), ['Espera entre os exames: 1 h 10 min · 1 h 50 min do começo ao fim'], 'a espera longa aparece como é');
  // o dia sem combinação diz isso com todas as letras
  await page.click(`#pktab-${D2}`);
  await page.waitForSelector('#pkOpts .pk-none');
  assert.equal(await page.evaluate(() => document.activeElement?.id), `pktab-${D2}`);
  assert.match(await page.innerText('#pkOpts .pk-none'), /Neste dia não dá para fazer os 2 exames juntos\. Cada um tem horário livre, mas eles não se encaixam um depois do outro\./);
  assert.match(await viva(page, /Em quarta-feira, 18 de novembro não dá para fazer estes exames juntos\./), /Em quarta-feira, 18 de novembro não dá para fazer estes exames juntos\./);
  assert.equal(await page.locator('.pk-opt').count(), 0);
  assert.equal((await page.textContent('[data-act="pk-next"]')).trim(), 'Ver o próximo dia (qui 19/11)');
  await shot(page, 'p06-sem-opcao');
  await page.click('[data-act="pk-next"]');
  await page.waitForSelector('.pk-opt');
  assert.equal(await page.getAttribute(`#pktab-${D3}`, 'aria-selected'), 'true');
  // marcar separado: volta para o fluxo de um exame só
  await page.click(`#pktab-${D2}`);
  await page.waitForSelector('#pkOpts .pk-none');
  await page.click('.pk-none [data-act="pk-close"]');
  await page.waitForSelector('#slProc');
  await page.waitForSelector('.sl-t');
  assert.equal((await page.textContent('#h-agendar')).trim(), 'Escolha o horário');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'slProc');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('nenhum dia para todos os exames e a regra "não no mesmo dia": o site diz o motivo e oferece marcar separado ou pedir', async () => {
  // a densitometria só tem horário no dia 2; o ultrassom, nos dias 1 e 3
  const semDia = await abrir(browser, { agenda: agendaPacote({ livres: { [PROC.dens]: [[D2, '15:10']] } }) });
  await semDia.page.goto(`${BASE}local.html?id=${CLINICA}&exame=usg`);
  await semDia.page.waitForSelector('.sl-day');
  await semDia.page.click('[data-act="pacote"]');
  await semDia.page.check(`#pk-${PROC.dens}`);
  await semDia.page.waitForSelector('.pk-none');
  assert.match(await semDia.page.innerText('.pk-none'), /Nenhum dia tem horário livre para todos estes exames nos próximos 14 dias\. Você pode marcar cada exame em um dia ou pedir que a clínica combine os horários com você\./);
  assert.equal(await semDia.page.locator('.pk-day, .pk-opt').count(), 0);
  assert.deepEqual(rpcs(semDia.log, 'agenda_package_options'), [], 'sem dia comum, nem pergunta as combinações');
  await shot(semDia.page, 'p07-nenhum-dia');
  await semDia.page.click('.pk-none [data-act="pedido"]');
  await semDia.page.waitForSelector('#bkExam');
  assert.match(await semDia.page.textContent('#h-agendar'), /Pedir agendamento/);
  assert.deepEqual(semDia.errors, []);
  await semDia.context.close();

  const regra = await abrir(browser, { agenda: agendaPacote({ naoMesmoDia: [[PROC.rm, PROC.tc]] }) });
  await regra.page.goto(LOCAL);
  await escolher(regra.page, PROC.tc);
  assert.match(await regra.page.innerText('.pk-none'), /A clínica não faz estes exames no mesmo dia\. É uma regra dela\. Marque cada exame em um dia, ou troque os exames escolhidos\./);
  assert.equal(await regra.page.locator('.pk-day, .pk-opt, [data-act="pk-next"]').count(), 0, 'não adianta procurar outro dia');
  assert.equal(rpcs(regra.log, 'agenda_package_options').length, 1, 'uma pergunta só: a regra vale para todos os dias');
  // trocar os exames resolve
  await regra.page.uncheck(`#pk-${PROC.tc}`);
  await regra.page.check(`#pk-${PROC.usg}`);
  await regra.page.waitForSelector('.pk-opt');
  assert.deepEqual(regra.errors, []);
  await regra.context.close();
});

await scenario('1 exame continua igual à 5.1: escolhe o horário e confirma, sem baixar nada dos vários exames', async () => {
  const { context, page, log, errors, ag } = await abrir(browser);
  await page.goto(LOCAL);
  await page.waitForSelector('.sl-t');
  assert.equal((await page.textContent('#h-agendar')).trim(), 'Escolha o horário');
  assert.equal(await page.inputValue('#slProc'), PROC.rm);
  assert.match(await page.textContent('.sl-next'), /Próximo horário livre: amanhã às 08:00/);
  await page.click('.sl-t >> nth=0');
  await page.waitForSelector('#bookForm');
  assert.equal(await page.getAttribute('#bookForm', 'data-mode'), 'slot');
  assert.equal((await page.textContent('#bkBtn')).trim(), 'Confirmar agendamento');
  assert.match(await page.innerText('label[data-f="consent"]'), /incluindo o exame escolhido, para reservar meu horário no estabelecimento/);
  await fillPerson(page);
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  assert.equal((await page.textContent('.lc-ok h2')).trim(), 'Agendamento confirmado para terça-feira, 17 de novembro às 08:00');
  const [b] = rpcs(log, 'agenda_book');
  assert.deepEqual(b.p_items, [{ procedure_id: PROC.rm, starts_at: isoDe(D1, '08:00') }]);
  const [g] = await guardados(page);
  assert.ok(!('parts' in g), 'um exame só: o resumo guardado é o da 5.1');
  assert.deepEqual([g.items, g.slot, g.slot_end, g.prep], [['Ressonância do joelho'], isoDe(D1, '08:00'), isoDe(D1, '08:30'), 'Retire objetos de metal.']);
  assert.equal(ag.taken.size, 1);
  assert.ok(!log.arquivos.includes('local-pacote.js'), 'o módulo dos vários exames não foi baixado');
  assert.deepEqual([...rpcs(log, 'agenda_days'), ...rpcs(log, 'agenda_package_options')], []);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="ics"]')]);
  assert.equal((await readFile(await dl.path(), 'utf8')).match(/BEGIN:VEVENT/g).length, 1);
  assert.deepEqual(errors, []);
  await context.close();

  // abrir os vários exames e desistir: "Marcar um exame só" devolve o fluxo de sempre
  const volta = await abrir(browser);
  await volta.page.goto(LOCAL);
  await escolher(volta.page, PROC.tc);
  await volta.page.click('.sl-other [data-act="pk-close"]');
  await volta.page.waitForSelector('.sl-t');
  assert.equal(await volta.page.evaluate(() => document.activeElement?.id), 'slProc');
  await volta.page.click('.sl-t >> nth=1');
  await volta.page.waitForSelector('#bookForm[data-mode="slot"]');
  await fillPerson(volta.page);
  await volta.page.click('#bkBtn');
  await volta.page.waitForSelector('.lc-ok');
  assert.equal(rpcs(volta.log, 'agenda_book')[0].p_items.length, 1);
  assert.deepEqual(volta.errors, []);
  await volta.context.close();
});

await scenario('clínica sem a venda online, ou com 1 exame só à venda: nada disto aparece', async () => {
  const sem = await abrir(browser);
  await sem.page.goto(`${BASE}local.html?id=${SEM_VENDA}`);
  await sem.page.waitForSelector('#agendar [data-act="pedido"]');
  assert.equal(await sem.page.locator('[data-act="pacote"], .pk-entry, .sl-day').count(), 0);
  assert.match(await sem.page.innerText('#agendar'), /A clínica recebe seu pedido pelo IMED e liga para combinar o horário\./);
  assert.ok(!sem.log.arquivos.includes('local-pacote.js'));
  assert.deepEqual([...rpcs(sem.log, 'agenda_days'), ...rpcs(sem.log, 'agenda_package_options'), ...rpcs(sem.log, 'agenda_slots')], []);
  assert.deepEqual(sem.errors, []);
  await sem.context.close();

  const um = await abrir(browser, { agenda: agendaPacote({ procs: [PROC.rm] }) });
  await um.page.goto(LOCAL);
  await um.page.waitForSelector('.sl-t');
  assert.equal(await um.page.locator('[data-act="pacote"], .pk-entry').count(), 0, 'com 1 exame à venda não há o que juntar');
  assert.deepEqual(um.errors, []);
  await um.context.close();

  // venda desligada (agenda_public_info.online false) na clínica que tinha: volta a ser pedido, sem a entrada
  const off = await abrir(browser, { agenda: agendaPacote({ online: false }) });
  await off.page.goto(LOCAL);
  await off.page.waitForSelector('#agendar [data-act="pedido"]');
  assert.equal(await off.page.locator('[data-act="pacote"], .sl-day').count(), 0);
  assert.deepEqual(off.errors, []);
  await off.context.close();
});

await scenario('vários exames para outra pessoa (menor de 18 anos): os mesmos campos e a autorização do responsável vão na marcação', async () => {
  const { context, page, log, errors } = await abrir(browser);
  await page.goto(LOCAL);
  await escolher(page, PROC.ecg);
  await page.click('[data-act="pk-pick"] >> nth=0');
  await page.waitForSelector('#bookForm');
  assert.equal((await page.textContent('[data-f="forwho"] legend')).trim(), 'Os exames são para');
  await fillPerson(page);
  await page.click('label:has(> input[name="para"][value="outra"])');
  assert.equal((await page.textContent('label[for="bkOtherName"]')).trim(), 'Nome de quem vai fazer os exames');
  await page.click('#bkBtn');
  assert.match(await page.textContent('#e-otherName'), /nome de quem vai fazer o exame/);
  assert.deepEqual(rpcs(log, 'agenda_book'), [], 'com campo faltando, nada é enviado');
  await page.fill('#bkOtherName', '  Pedro   Teste ');
  await page.selectOption('#bkRel', 'Filho ou filha');
  await page.check('input[name="menor"]');
  await page.click('#bkBtn');
  assert.match(await page.textContent('#e-guardian'), /autorização do pai, da mãe ou do responsável legal/);
  assert.deepEqual(rpcs(log, 'agenda_book'), []);
  await page.check('input[name="responsavel"]');
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  const [b] = rpcs(log, 'agenda_book');
  assert.deepEqual(b.p_patient, { name: 'Ana Teste', phone: '11987654321', consent: true, for_other: true, other_name: 'Pedro Teste', relationship: 'Filho ou filha', other_minor: true, guardian_consent: true, other_consent: false });
  assert.equal(b.p_items.length, 2);
  assert.match(await page.innerText('.lc-ok'), /Para Pedro Teste \(Filho ou filha\)/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('computador com tela baixa (1366×768): o cartão rola por dentro e cada passo começa à vista (aviso, conferência e confirmação)', async () => {
  // o título do passo tem de estar dentro da parte visível do cartão (que rola por dentro) e da tela
  const aVista = (page, sel) => page.evaluate((s) => {
    const box = document.querySelector('#agendar').getBoundingClientRect();
    const r = document.querySelector(s).getBoundingClientRect();
    return r.top >= Math.max(0, box.top) - 1 && r.bottom <= Math.min(innerHeight, box.bottom) + 1;
  }, sel);
  for (const varios of [true, false]) {
    const { context, page, errors, ag } = await abrir(browser);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(LOCAL);
    if (varios) {
      await escolher(page, PROC.tc, PROC.usg);
      await page.waitForFunction(() => [...document.querySelectorAll('.pk-opt .pk-steps')].length && [...document.querySelectorAll('.pk-opt .pk-steps')].every((s) => s.children.length === 3));
      await page.click('[data-act="pk-pick"] >> nth=4');   // a última opção, lá embaixo no cartão
      await page.waitForSelector('#bookForm');
      assert.ok(await aVista(page, '#bkName'), 'conferência: o campo com o foco está à vista');
      await fillPerson(page);
      ag.ocupar(PROC.usg, D1, '09:00');
      ag.ocupar(PROC.usg, D1, '09:40');
      await page.click('#bkBtn');
      await page.waitForSelector('#slNotice');
      await page.waitForSelector('.pk-opt, .pk-none');
      assert.ok(await aVista(page, '#slNotice'), 'horário pego: o aviso está à vista');
      await page.click('[data-act="pk-pick"] >> nth=0');
      await page.waitForSelector('#bookForm');
    } else {
      await page.waitForSelector('.sl-t');
      await page.click('.sl-t >> nth=0');
      await page.waitForSelector('#bookForm');
      await fillPerson(page);
    }
    await page.click('#bkBtn');
    await page.waitForSelector('.lc-ok');
    await page.waitForTimeout(600); // a rolagem suave termina
    assert.equal(await page.evaluate(() => document.querySelector('#agendar').scrollTop), 0, `${varios ? 'vários exames' : '1 exame'}: a confirmação começa do alto do cartão`);
    assert.ok(await aVista(page, '.lc-ok h2'), `${varios ? 'vários exames' : '1 exame'}: o título da confirmação está à vista`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('celular de 360 px: cada passo sem rolagem lateral e com alvos de toque de 44 px', async () => {
  const { context, page, errors } = await abrir(browser, { mobile: true });
  const alto = (sel) => page.locator(sel).evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().height)));
  await page.goto(LOCAL);
  await page.waitForSelector('.sl-day');
  assert.ok(await alto('[data-act="pacote"]') >= 44, 'a entrada tem 44 px');
  assert.ok(await overflow(page) <= 0, `1 exame: sem rolagem lateral (${await overflow(page)} px)`);
  await page.click('[data-act="pacote"]');
  await page.waitForSelector('input[name="pkProc"]');
  await page.check(`#pk-${PROC.tc}`);
  await page.check(`#pk-${PROC.usg}`);
  await page.check(`#pk-${PROC.ecg}`);
  await page.waitForFunction(() => [...document.querySelectorAll('.pk-opt .pk-steps')].length && [...document.querySelectorAll('.pk-opt .pk-steps')].every((s) => s.children.length === 4));
  assert.ok(await overflow(page) <= 0, `combinações: sem rolagem lateral (${await overflow(page)} px)`);
  for (const sel of ['.pk-ex', '.pk-day', '[data-act="pk-pick"]', '.sl-other [data-act="pk-close"]']) assert.ok(await alto(sel) >= 44, `${sel} com ${await alto(sel)} px`);
  // nada escapa do cartão
  assert.ok(await page.evaluate(() => { const box = document.querySelector('#agendar').getBoundingClientRect(); return [...document.querySelectorAll('#agendar .pk-opt, #agendar .pk-ex, #agendar .pk-steps li')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1; }); }), 'os cartões cabem na tela');
  await shot(page, 'p08-celular-opcoes');
  await page.click('[data-act="pk-pick"] >> nth=0');
  await page.waitForSelector('#bookForm');
  assert.ok(await overflow(page) <= 0, `conferência: sem rolagem lateral (${await overflow(page)} px)`);
  assert.ok(await alto('[data-act="pk-change"]') >= 44);
  await fillPerson(page);
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  assert.ok(await overflow(page) <= 0, `confirmado: sem rolagem lateral (${await overflow(page)} px)`);
  await shot(page, 'p09-celular-confirmado');
  // o mapa do local (baixado só perto da tela): os botões de zoom também têm 44 px no celular
  await page.locator('#lcMap').scrollIntoViewIfNeeded();
  await page.waitForSelector('#lcMap .leaflet-control-zoom-in');
  assert.ok(await alto('#lcMap .leaflet-bar a') >= 44, `botões de zoom do mapa com ${await alto('#lcMap .leaflet-bar a')} px`);
  assert.ok(await page.locator('#lcMap .leaflet-bar a').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().width >= 44)));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('tema escuro: os cartões usam as cores do tema (nada branco) e o texto continua legível', async () => {
  const { context, page, errors } = await abrir(browser, { mobile: true, colorScheme: 'dark' });
  await page.goto(LOCAL);
  await escolher(page, PROC.tc);
  const lum = (sel, prop) => page.locator(sel).first().evaluate((el, p) => { const m = getComputedStyle(el)[p].match(/\d+(\.\d+)?/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; }, prop);
  for (const sel of ['.pk-opt', '.pk-ex', '.pk-ex:has(input:checked)', '.pk-prep']) assert.ok(await lum(sel, 'backgroundColor') < 0.3, `${sel}: fundo escuro`);
  for (const sel of ['.pk-opt h3', '.pk-steps li b', '.pk-ex b', '.pk-tot']) assert.ok(await lum(sel, 'color') > 0.6, `${sel}: texto claro`);
  await shot(page, 'p10-escuro-opcoes');
  await page.click('[data-act="pk-pick"] >> nth=0');
  await page.waitForSelector('#bookForm');
  assert.ok(await lum('.pk-chosen', 'backgroundColor') < 0.3);
  assert.ok(await lum('.pk-chosen .pk-steps li b', 'color') > 0.6);
  await fillPerson(page);
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  assert.ok(await lum('.pk-done', 'backgroundColor') < 0.3);
  await shot(page, 'p11-escuro-confirmado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('só com o teclado: marcar os exames, trocar de dia com as setas, escolher, trocar e confirmar', async () => {
  const { context, page, log, errors } = await abrir(browser);
  await page.goto(LOCAL);
  await page.waitForSelector('.sl-day');
  await page.focus('[data-act="pacote"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('input[name="pkProc"]');
  assert.equal(await page.evaluate(() => document.activeElement?.id), `pk-${PROC.rm}`);
  assert.match(await viva(page, /Vários exames no mesmo dia\. Escolha de 2 a 4 exames\./), /Vários exames no mesmo dia\. Escolha de 2 a 4 exames\./);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.id), `pk-${PROC.tc}`);
  await page.keyboard.press('Space');
  await page.waitForSelector('.pk-opt');
  assert.equal(await page.evaluate(() => document.activeElement?.id), `pk-${PROC.tc}`, 'o foco não se perde quando a tela redesenha');
  // só o dia escolhido entra na ordem do Tab; as setas trocam de dia (e buscam as combinações)
  assert.deepEqual(await page.locator('.pk-day').evaluateAll((els) => els.filter((e) => e.tabIndex === 0).map((e) => e.dataset.pkday)), [D1]);
  await page.focus(`#pktab-${D1}`);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((d) => document.querySelector(`#pktab-${d}`)?.getAttribute('aria-selected') === 'true' && document.querySelector('.pk-opt'), D2);
  assert.equal(await page.evaluate(() => document.activeElement?.id), `pktab-${D2}`);
  assert.deepEqual(await cartoes(page), [['08:00 às 08:30 Ressonância do joelho', 'espera de 6 h 30 min 15:00 às 15:20 Tomografia do tórax']]);
  await page.keyboard.press('End');
  await page.waitForFunction((d) => document.querySelector(`#pktab-${d}`)?.getAttribute('aria-selected') === 'true' && document.querySelector('.pk-opt'), D3);
  await page.keyboard.press('Home');
  await page.waitForFunction((d) => document.querySelector(`#pktab-${d}`)?.getAttribute('aria-selected') === 'true' && document.querySelectorAll('.pk-opt').length === 5, D1);
  assert.deepEqual(rpcs(log, 'agenda_package_options').map((b) => b.p_day), [D1, D2, D3, D1]);
  await page.focus('[data-act="pk-pick"] >> nth=1');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#bookForm');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'bkName');
  assert.match(await viva(page, /Opção escolhida: 2 exames, das 08:30 às 09:20\. Preencha seus dados e confirme\./), /Opção escolhida: 2 exames, das 08:30 às 09:20\. Preencha seus dados e confirme\./);
  // "Trocar" devolve às combinações, com o foco na primeira
  await page.keyboard.type('Ana Teste');
  await page.focus('[data-act="pk-change"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.pk-opt');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.act + document.activeElement?.dataset.i), 'pk-pick0');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#bookForm');
  assert.equal(await page.inputValue('#bkName'), 'Ana Teste', 'o que foi digitado continua');
  await page.focus('#bkPhone');
  await page.keyboard.type('11987654321');
  await page.focus('input[name="consent"]');
  await page.keyboard.press('Space');
  await page.focus('#bkBtn');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.lc-ok');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'h-agendar', 'o foco vai para o título da confirmação');
  assert.deepEqual(rpcs(log, 'agenda_book')[0].p_items.map((i) => i.starts_at), [isoDe(D1, '08:00'), isoDe(D1, '08:30')]);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('falhas e recusas: dias e combinações com "Tentar de novo"; limite, venda desligada e regra que mudou com mensagens claras', async () => {
  // 1) os dias não carregam (a 1ª vez)
  let dias = 0;
  const a = await abrir(browser, { trocar: { agenda_days: (route, body, ag) => { dias += 1; return dias <= 2 ? json(route, { code: '57014', message: 'canceling statement due to statement timeout' }, 500) : json(route, ag.days(body)); } } });
  await a.page.goto(LOCAL);
  await a.page.waitForSelector('.sl-day');
  await a.page.click('[data-act="pacote"]');
  await a.page.check(`#pk-${PROC.tc}`);
  await a.page.waitForSelector('[data-act="pk-reload"]');
  assert.match(await a.page.innerText('#agendar'), /Não foi possível carregar os dias agora\./);
  await a.page.click('[data-act="pk-reload"]');
  await a.page.waitForSelector('.pk-opt');
  assert.deepEqual(a.errors, []);
  await a.context.close();

  // 2) as combinações não carregam (a 1ª vez); depois, cada recusa da marcação
  let op = 0;
  let resposta = { status: 'too_many_bookings' };
  const b = await abrir(browser, { trocar: {
    agenda_package_options: (route, body, ag) => { op += 1; return op === 1 ? json(route, { code: '57014', message: 'canceling statement due to statement timeout' }, 500) : json(route, ag.options(body)); },
    agenda_book: (route, body, ag) => json(route, resposta ?? ag.book(body)),
  } });
  await b.page.goto(LOCAL);
  await b.page.waitForSelector('.sl-day');
  await b.page.click('[data-act="pacote"]');
  await b.page.check(`#pk-${PROC.tc}`);
  await b.page.waitForSelector('#pkOpts [data-act="pk-reload"]');
  assert.match(await b.page.innerText('#pkOpts'), /Não foi possível montar as combinações agora\./);
  assert.equal(await b.page.locator('.pk-day').count(), 14, 'os dias continuam na tela');
  await b.page.click('[data-act="pk-reload"]');
  await b.page.waitForSelector('.pk-opt');
  await b.page.click('[data-act="pk-pick"] >> nth=0');
  await b.page.waitForSelector('#bookForm');
  await fillPerson(b.page);
  // limite de agendamentos por vir deste celular
  await b.page.click('#bkBtn');
  await b.page.waitForSelector('#bkErr.show');
  assert.equal(await b.page.textContent('#bkErr'), G.PKG_MSG.limit);
  assert.equal((await b.page.textContent('#bkBtn')).trim(), 'Confirmar os 2 exames');
  // a clínica mudou uma regra entre os exames (invalid_package): nada marcado, combinações de novo
  resposta = { status: 'invalid_package' };
  await b.page.click('#bkBtn');
  await b.page.waitForSelector('#slNotice');
  await b.page.waitForSelector('.pk-opt');
  assert.equal(await b.page.textContent('#slNotice'), G.PKG_MSG.changed);
  // a página ficou aberta e a combinação já passou: aviso e as combinações de novo (o relógio anda para o dia seguinte)
  await b.page.click('[data-act="pk-pick"] >> nth=0');
  await b.page.waitForSelector('#bookForm');
  await b.context.clock.setFixedTime(new Date(isoDe(D1, '08:05')));
  resposta = null;
  await b.page.click('#bkBtn');
  await b.page.waitForSelector('#slNotice');
  assert.equal(await b.page.textContent('#slNotice'), G.PKG_MSG.past);
  await b.page.waitForSelector('.pk-opt');
  assert.ok(!(await cartoes(b.page)).flat().some((l) => l.startsWith('08:00 ')), 'o que já começou não é oferecido');
  assert.equal(rpcs(b.log, 'agenda_book').length, 2, 'a combinação que já passou nem foi enviada');
  // a clínica desligou a venda no meio: vira o pedido de antes, com o aviso e os dados
  resposta = { status: 'not_online' };
  await b.page.click('[data-act="pk-pick"] >> nth=0');
  await b.page.waitForSelector('#bookForm');
  await b.page.click('#bkBtn');
  await b.page.waitForSelector('#bkExam');
  assert.equal(await b.page.textContent('#slNotice'), G.BOOK_MSG.closed);
  assert.equal(await b.page.inputValue('#bkName'), 'Ana Teste');
  assert.deepEqual(await guardados(b.page), []);
  assert.deepEqual(b.errors, []);
  await b.context.close();
});

await scenario('Meus pedidos e Minha conta mostram o pacote inteiro; o lembrete tem um evento por exame; cancelar cancela todos', async () => {
  const { context, page, log, errors, ag } = await abrir(browser);
  await page.goto(LOCAL);
  await escolher(page, PROC.usg);
  await page.click('[data-act="pk-pick"] >> nth=0');   // ultrassom 08:00 + ressonância 08:30
  await page.waitForSelector('#bookForm');
  await fillPerson(page);
  await page.click('#bkBtn');
  await page.waitForSelector('.lc-ok');
  const id = rpcs(log, 'agenda_book')[0].p_id;
  // Minha conta (sem entrar): pedidos deste aparelho
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector('.ct-order');
  const card = await page.innerText('.ct-order');
  assert.match(card, /Clínica Simulada dos Exames/);
  assert.match(card, /Confirmado/);
  assert.deepEqual(await texto(page, '.ct-parts dt'), ['2 exames marcados juntos']);
  assert.deepEqual(await texto(page, '.ct-parts li'), ['08:00 às 08:30 Ultrassom do abdome', '08:30 às 09:00 Ressonância do joelho']);
  assert.match(card, /Dia\s+Terça-feira, 17 de novembro de 2026/);
  assert.match(card, new RegExp(G.protocolFromId(id)));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-ics]')]);
  const ics = await readFile(await dl.path(), 'utf8');
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2, 'um evento por exame');
  assert.match(ics, /DTSTART:20261117T110000Z\r\nDTEND:20261117T113000Z\r\n/);
  assert.match(ics, /DTSTART:20261117T113000Z\r\nDTEND:20261117T120000Z\r\n/);
  assert.match(ics.replace(/\r\n /g, ''), /Preparo: Jejum de 6 horas\. Beba 4 copos de água 1 hora antes\./);
  await page.click('[data-cancel]');
  assert.equal(await page.textContent('.ct-ask p'), T.cancelConfirmText('parceiro', isoDe(D1, '08:00'), 'confirmed', 2));
  assert.match(await page.textContent('.ct-ask p'), /^Cancelar os 2 exames deste agendamento\? Eles foram marcados juntos e são cancelados juntos\./);
  await shot(page, 'p12-conta');
  await page.click('[data-cancel-no]');
  // Meus pedidos (página inicial)
  await page.goto(`${BASE}#agenda`);
  await page.waitForSelector('#appts .appt-parts');
  assert.deepEqual(await texto(page, '#appts .appt-parts li'), ['08:00 às 08:30 Ultrassom do abdome', '08:30 às 09:00 Ressonância do joelho']);
  assert.match(await page.innerText('#appts .appt'), /2 exames marcados: terça-feira, 17 de novembro/);
  await page.waitForSelector('#appts [data-cancel]');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#appts [data-ics]')]);
  assert.equal((await readFile(await dl2.path(), 'utf8')).match(/BEGIN:VEVENT/g).length, 2);
  await shot(page, 'p13-meus-pedidos');
  await page.click('#appts [data-cancel]');
  assert.match(await page.textContent('#appts .appt-ask p'), /^Cancelar os 2 exames deste agendamento\?/);
  await page.click('#appts [data-cancel-yes]');
  await page.waitForFunction(() => /Cancelado/.test(document.querySelector('#appts .appt .status')?.textContent ?? ''));
  assert.deepEqual(rpcs(log, 'cancel_request').map((b) => b.p_id), [id], 'um cancelamento só, do agendamento inteiro');
  assert.equal(ag.taken.size, 0, 'os dois horários voltaram a ficar livres');
  assert.match(await page.textContent('#toast'), /Os 2 exames foram cancelados\. Os horários voltaram a ficar livres\./);
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
