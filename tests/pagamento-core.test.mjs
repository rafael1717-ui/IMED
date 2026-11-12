// Regras da tela do pagamento pelo site (assets/js/pagamento-core.js; iMed Pagamentos, fase P2a), sem navegador.
// Rodar com: node --test tests/pagamento-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import * as C from '../assets/js/pagamento-core.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const VETORES = JSON.parse(read('tests/pagamento-vetores.json'));
const NOW = Date.parse('2026-11-16T12:00:00Z');   // segunda-feira, 09:00 em São Paulo
const min = (n) => new Date(NOW + n * 60000).toISOString();
// pag_my_payment como o banco devolve (supabase/migrations/..._pagamentos_base_parte_4.sql)
const res = (request_status, payment, extra = {}) => ({ status: 'ok', payment_mode: 'online', request_status, total_cents: 45000, hold_expires_at: min(10), payment, ...extra });
const pay = (situacao, extra = {}) => ({ situacao, valor_cents: 45000, meio: 'pix', tentativa: 1, expira_em: null, pix_copia_cola: null, paga_em: null, devolvido_cents: 0, devolucoes: [], ...extra });
const esperando = () => res('awaiting_payment', pay('aguardando', { expira_em: min(8), pix_copia_cola: '00020126-copia-e-cola' }));

test('CPF: os mesmos casos do servidor (tests/pagamento-vetores.json); máscara', () => {
  for (const c of VETORES.cpf_validos) assert.equal(C.cpfValido(c), true, c);
  for (const c of VETORES.cpf_invalidos) assert.equal(C.cpfValido(c), false, c);
  assert.equal(C.cpfValido(null), false);
  assert.equal(C.maskCpf('52998224725'), '529.982.247-25');
  assert.equal(C.maskCpf('5299'), '529.9');
  assert.equal(C.maskCpf('529982247259999'), '529.982.247-25', 'corta em 11 dígitos');
  assert.equal(C.maskCpf('abc'), '');
  assert.equal(C.onlyDigits('529.982.247-25'), '52998224725');
});

test('dinheiro: só centavos inteiros viram texto; sem valor, sem frase', () => {
  assert.equal(C.formatMoney(13323), 'R$ 133,23');
  assert.equal(C.formatMoney(45000), 'R$ 450,00');
  assert.equal(C.formatMoney(0), 'R$ 0,00');
  for (const ruim of [null, undefined, '45000', 450.5, -1, NaN]) assert.equal(C.formatMoney(ruim), '', String(ruim));
  assert.equal(C.dateTime('2026-11-16T12:03:00Z', 'America/Sao_Paulo'), '16/11/2026 às 09:03');
  assert.equal(C.dateTime('2026-11-16T12:03:00Z', 'America/Manaus'), '16/11/2026 às 08:03', 'no fuso da unidade');
  assert.equal(C.dateTime('2026-11-16T12:03:00Z', 'Fuso/Invalido'), '16/11/2026 às 09:03', 'fuso estranho: São Paulo');
  assert.equal(C.dayMonth('2026-11-17T01:00:00Z', 'America/Sao_Paulo'), '16/11');
  assert.equal(C.dateTime(null), '');
  assert.equal(C.dateTime('ontem'), '');
});

test('paga pelo site? só com a resposta do banco dizendo que sim, Pix aceito e preço a partir do mínimo informado', () => {
  const info = { status: 'ok', payment: 'online', payment_methods: ['pix'], payment_min_cents: 2000, payment_hold_min: 10 };
  assert.equal(C.payable(info, { price_cents: 45000 }), true);
  assert.equal(C.payable(info, { price_cents: 2000 }), true);
  assert.equal(C.payable(info, { price_cents: 1999 }), false, 'abaixo do mínimo: pagamento no local');
  assert.equal(C.payable(info, { price_cents: null }), false, 'sob consulta: pagamento no local');
  assert.equal(C.payable({ ...info, payment: 'no_local' }, { price_cents: 45000 }), false, 'TUDO DESLIGADO: nada muda');
  assert.equal(C.payable({ ...info, payment_methods: ['cartao'] }, { price_cents: 45000 }), false);
  assert.equal(C.payable({ ...info, payment_methods: undefined }, { price_cents: 45000 }), false);
  assert.equal(C.payable({ ...info, payment_min_cents: undefined }, { price_cents: 45000 }), false, 'sem o mínimo do banco, o site não decide sozinho');
  assert.equal(C.payable({ ...info, status: 'not_found' }, { price_cents: 45000 }), false);
  assert.equal(C.payable(null, { price_cents: 45000 }), false);
  assert.equal(C.payable(info, null), false);
  assert.match(C.holdText(info), /guardado por 10 minutos/);
  assert.match(C.holdText({ payment_hold_min: 1 }), /por 1 minuto /);
  for (const sem of [{}, { payment_hold_min: 0 }, { payment_hold_min: '10' }, null]) assert.equal(C.holdText(sem), '', 'sem o prazo do banco, a frase não aparece');
});

test('o que vai para o servidor: a escolha e os dados; NENHUM valor; CPF só em números', () => {
  const args = { p_clinic: 'c', p_items: [{ procedure_id: 'p', starts_at: '2026-11-17T12:00:00.000Z' }], p_patient: { name: 'Maria Teste', phone: '11987654321', consent: true }, p_id: 'i', p_token: 't' };
  const b = C.criarBody(args, { id: 'i', token: 't', key: 'k' }, { cpf: '529.982.247-25', captcha: 'x' });
  assert.deepEqual(b, { action: 'criar', clinic: 'c', items: args.p_items, patient: args.p_patient, id: 'i', token: 't', key: 'k', payer: { name: 'Maria Teste', cpf: '52998224725' }, captcha: 'x' });
  assert.ok(!/cents|price|valor|amount/i.test(JSON.stringify(b)), 'nenhum valor sai do navegador');
  assert.equal(C.criarBody(args, { id: 'i', token: 't', key: 'k' }).captcha, '', 'sem desafio: vai vazio (o servidor recusa)');
  assert.deepEqual(C.conferirBody('i', 't'), { action: 'conferir', id: 'i', token: 't' });
  assert.equal(C.FUNCAO, 'pagamento-criar');
});

test('resposta da função do servidor → o que a página faz', () => {
  const ok = { ok: true, status: 'ok', slot_start: '2026-11-17T12:00:00+00:00', slot_end: '2026-11-17T12:30:00+00:00', agora: '2026-11-16T12:00:00.000Z', payment: { situacao: 'aguardando', pix_copia_cola: '0002', expira_em: min(8), valor_cents: 45000 } };
  assert.deepEqual(C.outcome(ok), { kind: 'ok', slot: ok.slot_start, end: ok.slot_end, agora: ok.agora });
  assert.deepEqual(C.outcome({ ok: true, status: 'ok', retomar: true }), { kind: 'retomar' });
  assert.deepEqual(C.outcome({ ok: true, status: 'ok', payment: { pix_copia_cola: '' } }), { kind: 'retomar' }, 'sem o código na resposta: lê a situação no banco');
  assert.deepEqual(C.outcome({ ok: false, status: 'slot_taken', alternatives: ['2026-11-17T12:30:00+00:00', 'lixo'] }), { kind: 'taken', alternatives: ['2026-11-17T12:30:00+00:00'] });
  const casos = {
    payment_pending: 'pending', too_many_expired: 'wait', provider_unavailable: 'provider', hold_expired: 'expired', captcha_failed: 'captcha',
    rate_limited: 'limit', too_many_attempts: 'limit', too_many_bookings: 'bookings', payments_off: 'off', payment_not_available: 'off',
    captcha_not_configured: 'off', payments_not_configured: 'off', fee_not_configured: 'off', below_minimum: 'off', unauthorized: 'off',
    not_online: 'closed', not_found: 'closed', invalid: 'invalid', consent_required: 'invalid', idempotency_conflict: 'retry',
  };
  for (const [st, kind] of Object.entries(casos)) assert.equal(C.outcome({ ok: false, status: st }).kind, kind, st);
  for (const estranho of [null, undefined, 'texto', {}, { status: 'erro' }, { status: 'ok' }, { ok: true }, { status: 'constructor' }, { status: 'coisa_nova' }]) {
    assert.equal(C.outcome(estranho).kind, 'error', JSON.stringify(estranho));
  }
  for (const k of ['pending', 'wait', 'provider', 'expired', 'captcha', 'limit', 'off', 'retry', 'error']) assert.ok(C.MSG[k]?.length > 20, `texto de ${k}`);
  assert.match(C.MSG.provider, /nada foi cobrado/);
  assert.match(C.MSG.error, /sem reservar duas vezes/);
});

test('a tela a partir de pag_my_payment: aguardando, conferindo, pago, vencido, cancelado, devolução, devolvido', () => {
  const v = C.viewOf(esperando(), NOW);
  assert.deepEqual([v.view, v.cents, v.code, v.expira], ['aguardando', 45000, '00020126-copia-e-cola', NOW + 8 * 60000]);
  // o QR venceu (o banco para de mandar o código, ou o relógio passou) e a reserva ainda vale
  assert.equal(C.viewOf(esperando(), NOW + 8 * 60000).view, 'conferindo');
  assert.equal(C.viewOf(res('awaiting_payment', pay('aguardando', { expira_em: min(-1) })), NOW).view, 'conferindo');
  assert.equal(C.viewOf(res('awaiting_payment', pay('processando')), NOW).view, 'conferindo');
  assert.equal(C.viewOf(res('hold', null), NOW).view, 'criando', 'reserva feita, cobrança ainda não');
  assert.equal(C.viewOf(res('hold', pay('criada')), NOW).view, 'criando');
  const pago = C.viewOf(res('confirmed', pay('aprovada', { paga_em: min(3) })), NOW);
  assert.deepEqual([pago.view, pago.cents, pago.paidAt], ['pago', 45000, min(3)]);
  for (const st of ['checked_in', 'in_service', 'completed', 'no_show', 'reschedule_requested']) assert.equal(C.viewOf(res(st, pay('aprovada', { paga_em: min(3) })), NOW).view, 'pago', st);
  assert.equal(C.viewOf(res('expired', pay('expirada')), NOW).view, 'vencido');
  assert.equal(C.viewOf(res('expired', null), NOW).view, 'vencido');
  assert.equal(C.viewOf(res('cancelled', pay('cancelada')), NOW).view, 'cancelado');
  assert.equal(C.viewOf(res('cancelled', null), NOW).view, 'cancelado', 'o meio de pagamento falhou e a reserva foi solta');
  // pagamento que chegou atrasado: aprovado, reserva expirada, devolução pedida (o dinheiro volta inteiro)
  const atrasado = C.viewOf(res('expired', pay('aprovada', { paga_em: min(12), devolucoes: [{ valor_cents: 45000, situacao: 'pedida', pedida_em: min(12), devolvida_em: null }] })), NOW);
  assert.deepEqual([atrasado.view, atrasado.motivo, atrasado.refunds], ['devolucao', 'atrasado', [{ cents: 45000, done: false, at: min(12) }]]);
  // dinheiro em cobrança já encerrada (QR apagado e mesmo assim pago)
  assert.deepEqual([C.viewOf(res('expired', pay('expirada', { paga_em: min(20) })), NOW)].map((x) => [x.view, x.motivo]), [['devolucao', 'atrasado']]);
  // o paciente cancelou o que pagou
  const cancelou = C.viewOf(res('cancelled', pay('aprovada', { paga_em: min(3), devolucoes: [{ valor_cents: 45000, situacao: 'pedida', pedida_em: min(30) }] })), NOW);
  assert.deepEqual([cancelou.view, cancelou.motivo], ['devolucao', 'cancelado']);
  const devolvido = C.viewOf(res('cancelled', pay('devolvida', { paga_em: min(3), devolvido_cents: 45000, devolucoes: [{ valor_cents: 45000, situacao: 'devolvida', pedida_em: min(30), devolvida_em: min(31) }] })), NOW);
  assert.deepEqual([devolvido.view, devolvido.refunds], ['devolvido', [{ cents: 45000, done: true, at: min(31) }]]);
  // o que não é pagamento pelo site, ou não deu para ler
  assert.equal(C.viewOf({ status: 'ok', payment_mode: 'no_local', request_status: 'confirmed' }, NOW).view, 'sem_pagamento');
  assert.equal(C.viewOf({ status: 'not_found' }, NOW).view, 'nao_encontrado');
  for (const ruim of [null, undefined, 'x', {}, { status: 'erro' }, res('awaiting_payment', null), res('estado_novo', pay('aguardando'))]) assert.equal(C.viewOf(ruim, NOW).view, 'indisponivel');
  // a tela NUNCA mostra "pago" sem o banco dizer que o agendamento está de pé com a cobrança aprovada
  for (const st of ['hold', 'awaiting_payment', 'expired', 'cancelled']) assert.notEqual(C.viewOf(res(st, pay('aprovada', { paga_em: min(1) })), NOW).view, 'pago', st);
  for (const sit of ['aguardando', 'criada', 'processando', 'expirada', 'cancelada', 'recusada', 'devolvida']) assert.notEqual(C.viewOf(res('confirmed', pay(sit)), NOW).view, 'pago', sit);
});

test('relógio do QR e avisos falados (sem ler a cada segundo)', () => {
  assert.deepEqual(C.countdown(NOW + 462000, NOW), { ms: 462000, ended: false, text: '7:42', sr: 'Faltam 7 minutos e 42 segundos para pagar.' });
  assert.equal(C.countdown(NOW + 60000, NOW).sr, 'Faltam 1 minuto para pagar.');
  assert.equal(C.countdown(NOW + 1000, NOW).sr, 'Faltam 1 segundo para pagar.');
  assert.equal(C.countdown(NOW + 59001, NOW).text, '1:00', 'arredonda para cima: nunca mostra 0:00 com tempo sobrando');
  assert.deepEqual([C.countdown(NOW, NOW).text, C.countdown(NOW, NOW).ended, C.countdown(NOW - 5000, NOW).ms], ['0:00', true, 0]);
  assert.equal(C.countdown(undefined, NOW).ended, true);
  assert.equal(C.announceAt(301000, 300000), 'Faltam 5 minutos para pagar.');
  assert.equal(C.announceAt(121000, 120000), 'Faltam 2 minutos para pagar.');
  assert.equal(C.announceAt(61000, 60000), 'Faltam 1 minuto para pagar.');
  assert.equal(C.announceAt(31000, 30000), 'Faltam 30 segundos para pagar.');
  assert.equal(C.announceAt(250000, 249000), '', 'entre os marcos: silêncio');
  assert.equal(C.announceAt(Infinity, 480000), '', 'ao abrir: silêncio');
  assert.equal(C.announceAt(1000, 0), '');
});

test('de quanto em quanto tempo a tela consulta; telas finais param', () => {
  assert.equal(C.pollDelay('aguardando', 0), 3000);
  assert.equal(C.pollDelay('aguardando', 4 * 60000), 5000);
  assert.equal(C.pollDelay('criando', 0), 2000);
  assert.equal(C.pollDelay('criando', 3 * 60000), null);
  assert.equal(C.pollDelay('conferindo', 0), 4000);
  assert.equal(C.pollDelay('devolucao', 0), 20000);
  assert.equal(C.pollDelay('indisponivel', 0), 8000);
  for (const v of C.FINAL) assert.equal(C.pollDelay(v, 0), null, v);
  assert.deepEqual(C.FINAL.sort(), ['cancelado', 'devolvido', 'nao_encontrado', 'pago', 'sem_pagamento', 'vencido']);
});

test('comprovante: só o que existe; devoluções com o dia e o valor', () => {
  const v = C.viewOf(res('confirmed', pay('aprovada', { paga_em: '2026-11-16T12:03:00Z' })), NOW);
  const ctx = { tz: 'America/Sao_Paulo', code: 'IMED-ABCDEF12', place: 'Clínica de Teste', exam: 'Ressonância', when: 'ter., 17/11 às 09:00' };
  assert.deepEqual(C.receiptRows(v, ctx), [
    ['Valor pago', 'R$ 450,00'], ['Pago em', '16/11/2026 às 09:03'], ['Forma de pagamento', 'Pix'], ['Código do agendamento', 'IMED-ABCDEF12'],
    ['Local', 'Clínica de Teste'], ['Exame', 'Ressonância'], ['Horário', 'ter., 17/11 às 09:00'],
  ]);
  assert.deepEqual(C.receiptRows(v, {}), [['Valor pago', 'R$ 450,00'], ['Pago em', '16/11/2026 às 09:03'], ['Forma de pagamento', 'Pix']]);
  assert.deepEqual(C.receiptRows(null, {}), []);
  assert.ok(!JSON.stringify(C.receiptRows(v, ctx)).match(/taxa|tarifa|repasse/i), 'o comprovante não fala de taxa (decisão 6)');
  const d = C.viewOf(res('cancelled', pay('devolvida_parcial', { paga_em: min(3), devolucoes: [
    { valor_cents: 10000, situacao: 'devolvida', pedida_em: '2026-11-16T15:00:00Z', devolvida_em: '2026-11-17T15:00:00Z' },
    { valor_cents: 35000, situacao: 'pedida', pedida_em: '2026-11-18T15:00:00Z' }, { valor_cents: 0, situacao: 'pedida' }, null] })), NOW);
  assert.deepEqual(C.refundLines(d, 'America/Sao_Paulo'), ['Devolvido em 17/11: R$ 100,00', 'Devolução pedida em 18/11: R$ 350,00']);
  assert.deepEqual(C.refundLines({ refunds: [{ cents: 500, done: false, at: null }] }), ['Devolução pedida: R$ 5,00'], 'sem data, sem "em"');
  assert.deepEqual(C.refundLines(null), []);
});

test('cartão do pedido na conta: resumo de cada situação; sem pagamento pelo site, nada', () => {
  const r = (x) => C.contaResumo(x, { now: NOW, tz: 'America/Sao_Paulo' });
  assert.deepEqual(r(esperando()), { view: 'aguardando', text: 'Aguardando o pagamento por Pix (R$ 450,00).', cls: 'wait', canContinue: true, hasReceipt: false, lines: [] });
  const pago = r(res('confirmed', pay('aprovada', { paga_em: '2026-11-16T12:03:00Z' })));
  assert.deepEqual([pago.text, pago.cls, pago.canContinue, pago.hasReceipt], ['Pago pelo site: R$ 450,00 em 16/11 · Pix', 'ok', false, true]);
  assert.equal(r(res('expired', pay('expirada'))).text, 'Não foi pago no prazo. Nada foi cobrado.');
  assert.equal(r(res('cancelled', pay('cancelada'))).text, 'Cancelado antes do pagamento. Nada foi cobrado.');
  const atrasado = r(res('expired', pay('aprovada', { paga_em: min(12), devolucoes: [{ valor_cents: 45000, situacao: 'pedida', pedida_em: '2026-11-16T12:12:00Z' }] })));
  assert.deepEqual([atrasado.cls, atrasado.lines], ['back', ['Devolução pedida em 16/11: R$ 450,00']]);
  assert.match(atrasado.text, /volta inteiro/);
  assert.equal(r(res('cancelled', pay('devolvida', { paga_em: min(3) }))).text, 'Pagamento devolvido.');
  assert.equal(r({ status: 'ok', payment_mode: 'no_local', request_status: 'confirmed' }), null, 'pagamento no local: o cartão fica como sempre foi');
  assert.equal(r(null), null);
  assert.equal(r({ status: 'not_found' }), null);
  // "nada foi cobrado" só aparece quando o banco não registrou pagamento nenhum
  for (const x of [res('expired', pay('expirada', { paga_em: min(20) })), res('cancelled', pay('aprovada', { paga_em: min(3) }))]) assert.doesNotMatch(r(x).text, /Nada foi cobrado/);
  assert.equal(C.LOCAL_STATUS, 'aguardando_pagamento');
});

test('QR Code: fundo branco e margem de 4 módulos sempre; desenha o "copia e cola" com a biblioteca do site', async () => {
  const svg = C.qrSvg([[true, false], [false, true]]);
  assert.match(svg, /^<svg [^>]*viewBox="0 0 10 10"[^>]*role="img" aria-label="QR Code do Pix"/);
  assert.match(svg, /<rect width="10" height="10" fill="#fff"\/><path d="M4 4h1v1h-1zM5 5h1v1h-1z" fill="#000"\/>/);
  assert.equal(C.qrSvg([]), '');
  assert.equal(C.qrSvg(null), '');
  assert.match(C.qrSvg([[true, true, true]].concat([[false, false, false], [false, false, false]])), /M4 4h3v1h-3z/, 'módulos vizinhos viram um traço só');
  assert.match(C.qrSvg([[true]], { title: '<b>"x"</b>' }), /aria-label="&lt;b&gt;&quot;x&quot;&lt;\/b&gt;"/);
  const qrcode = (await import('../assets/vendor/qrcode-generator/qrcode.js')).default;
  // um "copia e cola" de mentira com o tamanho de um de verdade (uns 200 caracteres)
  const codigo = `00020126580014br.gov.bcb.pix0136${'0'.repeat(36)}5204000053039865406133.235802BR5913IMED TESTE6009SAO PAULO62290525${'A'.repeat(25)}6304ABCD`;
  const rows = C.qrRows(codigo, qrcode);
  assert.ok(rows.length >= 33 && rows.every((r) => r.length === rows.length), `matriz quadrada (${rows.length})`);
  assert.deepEqual(rows[0].slice(0, 7), Array(7).fill(true), 'canto de localização do QR');
  assert.ok(C.qrSvg(rows).length < 30000);
});

test('textos: o aviso novo contra golpe e a nota fiscal; nada de promessa que o banco não deu', () => {
  assert.match(C.TXT.golpe, /só recebe pagamento dentro do site, na tela do seu agendamento/);
  assert.match(C.TXT.golpe, /Nunca por telefone, WhatsApp, e-mail ou link/);
  assert.match(C.TXT.nota, /nota fiscal do exame é emitida pela clínica/);
  assert.match(C.TXT.cpf, /O IMED não guarda o CPF/);
  const fonte = read('assets/js/pagamento-core.js') + read('assets/js/pagamento.js');
  // prazo de devolução, tarifa, taxa e percentual não aparecem para o paciente (não há dado do banco para isso)
  assert.doesNotMatch(fonte.replace(/\/\/[^\n]*/g, ''), /dias úteis|em até \d+|\d+ ?%|R\$ ?\d/, 'nenhum prazo, percentual ou valor fixo escrito no código da tela');
  for (const [, [t, p]] of Object.entries(C.VIEW_TXT)) assert.ok(t.length > 5 && p.length > 20);
  assert.match(C.VIEW_TXT.vencido[1], /nada foi cobrado/);
  assert.match(C.VIEW_TXT.atrasado[1], /volta inteiro para a conta que pagou/);
});

test('DESLIGADO: nenhuma página carrega o pagamento de início; local.js e conta.js só o baixam quando o banco manda', () => {
  for (const f of ['local.html', 'conta.html', 'index.html', 'perto.html']) {
    const h = read(f);
    assert.doesNotMatch(h, /pagamento(-core)?\.js|pagamento\.css/, `${f}: nada do pagamento no HTML`);
  }
  const local = read('assets/js/local.js');
  assert.doesNotMatch(local, /^import .*pagamento/m, 'local.js não importa o pagamento de início');
  assert.match(local, /if \(info\.payment === 'online'\) \{ S\.pag = await loadPay\(\);/, 'só com payment "online" na resposta do banco');
  assert.match(local, /const payNow = \(\) => !!\(S\.pag && S\.pag\.core\.payable\(S\.info, currentProc\(\)\)\);/);
  const conta = read('assets/js/conta.js');
  assert.doesNotMatch(conta, /^import .*pagamento/m, 'conta.js não importa o pagamento de início');
  assert.match(conta, /if \(!paid\.length\) return;\n\s*try \{ PAG \?\?= await import\('\.\/pagamento\.js'\)/, 'só com pedido pago pelo site na lista');
  // o CPF nunca vai para o rascunho nem para o aparelho
  assert.match(local, /const DRAFT_FIELDS = \['nome', 'celular', 'email', 'obs', 'outro_nome', 'parentesco'\];/);
  assert.doesNotMatch(local + conta + read('assets/js/pagamento.js'), /localStorage\.setItem\([^)]*cpf/i);
  // o service worker: os arquivos do pagamento ficam fora do CORE (só baixam quando a tela existe) e a versão não mudou
  const sw = read('sw.js');
  assert.doesNotMatch(sw.slice(sw.indexOf('const CORE'), sw.indexOf('];', sw.indexOf('const CORE'))), /pagamento/);
  // a tela usa só ícones do recorte do site (sem baixar a fonte completa)
  const icones = read('assets/vendor/fa/css/icones.min.css');
  const usados = new Set([...(read('assets/js/pagamento.js') + read('assets/js/pagamento-core.js')).matchAll(/\bfa-(?!solid\b|regular\b|brands\b)[a-z0-9-]+/g)].map((m) => m[0]));
  for (const i of usados) assert.ok(icones.includes(`.${i}:before`), `ícone ${i} no recorte`);
  void createRequire;
});
