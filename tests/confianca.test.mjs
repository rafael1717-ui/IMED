// Testes das regras dos recursos de confiança (assets/js/confianca.js) e do pedido para outra pessoa
// (assets/js/geo-core.js). Rodar com: node --test tests/confianca.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as T from '../assets/js/confianca.js';
import * as G from '../assets/js/geo-core.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NOW = Date.parse('2026-10-30T12:00:00Z');

test('cancelar: só pedido ativo e com horário ainda no futuro (ou sem horário)', () => {
  for (const st of ['pending', 'contacted', 'confirmed', 'reschedule_requested']) assert.equal(T.canCancel(st, null, NOW), true, st);
  // Situações da agenda nova em que o paciente não cancela pelo site (fase 4.2).
  for (const st of ['hold', 'awaiting_payment', 'checked_in', 'in_service', 'no_show', 'expired']) assert.equal(T.canCancel(st, null, NOW), false, st);
  assert.equal(T.canCancel('reschedule_requested', '2026-10-31T12:30:00.000Z', NOW), true, 'remarcação solicitada com horário amanhã');
  assert.equal(T.canCancel('reschedule_requested', '2026-10-30T11:59:00.000Z', NOW), false, 'remarcação solicitada com horário que já passou');
  for (const st of ['cancelled', 'completed', '', null, undefined, 'pendente', 'confirmado']) assert.equal(T.canCancel(st, null, NOW), false, String(st));
  assert.equal(T.canCancel('confirmed', '2026-10-31T12:30:00.000Z', NOW), true, 'horário amanhã');
  assert.equal(T.canCancel('confirmed', '2026-10-30T11:59:00.000Z', NOW), false, 'horário que já passou');
  assert.equal(T.canCancel('confirmed', 'nada', NOW), false, 'horário inválido');
  assert.match(T.cancelDoneText('2026-10-31T12:30:00.000Z', 'parceiro'), /Pedido cancelado\. O horário voltou a ficar livre\. A clínica vê o cancelamento no painel dela\./);
  assert.ok(!/livre/.test(T.cancelDoneText(null, 'parceiro')), 'sem horário, não fala de horário livre');
  assert.match(T.CANCEL_CONFIRM, /Cancelar pelo IMED é grátis/);
  for (const k of ['already_cancelled', 'not_cancellable', 'past', 'too_late', 'forbidden', 'not_found', 'error']) assert.ok(T.CANCEL_MSG[k], k);
  assert.match(T.CANCEL_MSG.too_late, /prazo/);
});

test('remarcação solicitada (bloqueio da clínica, fase 4.2): cancelar não promete horário livre; lembrete e respostas finais', () => {
  const slot = '2026-10-31T12:30:00.000Z';
  // o horário já foi solto e o período está bloqueado
  const ask = T.cancelConfirmText('parceiro', slot, 'reschedule_requested');
  assert.equal(ask, 'Cancelar este pedido? Cancelar pelo IMED é grátis. A clínica vê o cancelamento no painel dela.');
  assert.equal(T.cancelDoneText(slot, 'parceiro', '', 'reschedule_requested'), 'Pedido cancelado. A clínica vê o cancelamento no painel dela.');
  assert.ok(!/livre/.test(T.cancelDoneText(slot, '', '', 'reschedule_requested')));
  // confirmado com horário: continua livre
  assert.match(T.cancelConfirmText('parceiro', slot, 'confirmed'), /horário volta a ficar livre/);
  assert.match(T.cancelDoneText(slot, 'parceiro', '', 'confirmed'), /O horário voltou a ficar livre\./);
  // "Adicionar à agenda": regra única da página inicial e da conta
  for (const st of ['pending', 'contacted', 'confirmed', '', null, undefined]) assert.equal(T.canRemind(st), true, String(st));
  for (const st of ['hold', 'awaiting_payment', 'checked_in', 'in_service', 'no_show', 'reschedule_requested', 'expired', 'cancelled', 'completed']) assert.equal(T.canRemind(st), false, st);
  // respostas que fecham a pergunta "Sim, cancelar" (o prazo da clínica também)
  assert.deepEqual([...T.CANCEL_FINAL].sort(), ['forbidden', 'not_cancellable', 'not_found', 'past', 'too_late']);
  for (const k of T.CANCEL_FINAL) assert.ok(T.CANCEL_MSG[k], k);
});

test('cancelar: o texto só promete o que acontece (parceiro vê no painel; nos outros locais, só a equipe do IMED)', () => {
  // Para quem vai o cancelamento: pelo pedido do aparelho (place_key) ou pela linha do banco (clinic_id / place_source).
  assert.equal(T.placeType({ place_key: 'imed:bbbbbbbb-0000-4000-8000-000000000011' }), 'parceiro');
  assert.equal(T.placeType({ place_source: 'imed', clinic_id: 'x' }), 'parceiro');
  assert.equal(T.placeType({ clinic_id: 'x' }), 'parceiro');
  assert.equal(T.placeType({ place_key: 'cnes:2077485' }), 'local');
  assert.equal(T.placeType({ place_key: 'osm:n1' }), 'local');
  assert.equal(T.placeType({ place_source: 'cnes', clinic_id: null }), 'local');
  assert.equal(T.placeType({}), '', 'pedido antigo: não dá para saber');
  // Local que não é parceiro: nada de "vê no painel" para quem ia atender; manda ligar para o local, com o telefone.
  const local = T.cancelDoneText(null, 'local', '(11) 3141-1000');
  assert.equal(local, 'Pedido cancelado. A equipe do IMED vê o cancelamento. Se o horário já tinha sido combinado com o local, ligue também para ele: (11) 3141-1000.');
  assert.ok(!/painel|avisa o local|Quem ia atender/.test(local));
  assert.equal(T.cancelDoneText(null, 'local'), 'Pedido cancelado. A equipe do IMED vê o cancelamento. Se o horário já tinha sido combinado com o local, ligue também para ele.');
  assert.match(T.cancelDoneText(null, ''), /ligue também para ele\.$/, 'sem saber o tipo: o mesmo cuidado');
  for (const t of ['parceiro', 'local', '']) assert.ok(!/Quem ia atender vê o cancelamento no painel do IMED/.test(T.cancelDoneText(null, t)), t);
  assert.match(T.cancelConfirmText('parceiro', '2026-10-31T12:30:00.000Z'), /A clínica vê o cancelamento no painel dela e o horário volta a ficar livre/);
  assert.match(T.cancelConfirmText('local'), /A equipe do IMED vê o cancelamento\. Se o horário já tinha sido combinado com o local, ligue também para ele\./);
  // Aviso que fica no cartão: telefone vira link (escapado); sem link, só o número.
  const tel = (p) => `tel:+55${String(p).replace(/\D/g, '')}`;
  assert.equal(T.cancelNoteHTML('local', '(11) 3141-1000', tel), 'A equipe do IMED vê o cancelamento. Se o horário já tinha sido combinado com o local, ligue também para ele: <a class="link" href="tel:+551131411000">(11) 3141-1000</a>.');
  assert.equal(T.cancelNoteHTML('local', '<b>11</b>'), 'A equipe do IMED vê o cancelamento. Se o horário já tinha sido combinado com o local, ligue também para ele: &lt;b&gt;11&lt;/b&gt;.');
  assert.equal(T.cancelNoteHTML('parceiro', '(11) 1'), 'A clínica vê o cancelamento no painel dela.');
});

test('Fale com o IMED: assuntos (com os direitos da LGPD) e assunto pelo endereço', () => {
  const keys = T.CONTACT_SUBJECTS.map(([k]) => k);
  assert.deepEqual(keys, ['duvida', 'cancelamento', 'dados_acesso', 'dados_correcao', 'dados_exclusao', 'clinica', 'outro']);
  // Os mesmos valores aceitos pelo banco (send_contact e o check da tabela contact_messages).
  const sql = readFileSync(`${ROOT}supabase/migrations/20261030143738_confianca.sql`, 'utf8');
  for (const k of keys) assert.ok(sql.includes(`'${k}'`), `banco aceita ${k}`);
  assert.equal(T.subjectFromParam('correcao'), 'dados_correcao');
  assert.equal(T.subjectFromParam('exclusao'), 'dados_exclusao');
  assert.equal(T.subjectFromParam('acesso'), 'dados_acesso');
  assert.equal(T.subjectFromParam('cancelamento'), 'cancelamento');
  assert.equal(T.subjectFromParam('dados_exclusao'), 'dados_exclusao');
  assert.equal(T.subjectFromParam('<script>'), '');
  assert.equal(T.subjectFromParam(null), '');
  assert.equal(T.isLgpdSubject('dados_correcao'), true);
  assert.equal(T.isLgpdSubject('duvida'), false);
  // Os botões de "Meus dados" da conta abrem o assunto certo.
  const conta = readFileSync(`${ROOT}conta.html`, 'utf8');
  assert.match(conta, /href="contato\.html\?assunto=correcao"/);
  assert.match(conta, /href="contato\.html\?assunto=exclusao"/);
  // A página tem as mesmas opções.
  const page = readFileSync(`${ROOT}contato.html`, 'utf8');
  for (const k of keys) assert.ok(page.includes(`<option value="${k}">`), `contato.html: ${k}`);
});

test('Fale com o IMED: e-mail ou celular num campo só, validação e argumentos da função', () => {
  assert.deepEqual(T.parseReplyContact(' Ana@Exemplo.com '), { email: 'ana@exemplo.com' });
  assert.deepEqual(T.parseReplyContact('(11) 98765-4321'), { phone: '11987654321' });
  assert.deepEqual(T.parseReplyContact('+55 11 98765-4321'), { phone: '11987654321' });
  assert.deepEqual(T.parseReplyContact('11 3333-4444'), { phone: '1133334444' });
  for (const bad of ['', 'ana@', '123', '(01) 98765-4321', '1198765432a1'.replace('a', '')]) {
    if (bad === '11987654321') continue;
    assert.equal(T.parseReplyContact(bad), null, bad);
  }
  const ok = { subject: 'duvida', name: ' Ana  Souza ', contact: 'ana@exemplo.com', message: 'Como funciona o pedido?', code: '' };
  assert.deepEqual(T.validateContact(ok), {});
  const bad = T.validateContact({ subject: 'x', name: 'A', contact: 'oi', message: 'oi', code: 'x'.repeat(41) });
  assert.deepEqual(Object.keys(bad).sort(), ['code', 'contact', 'message', 'name', 'subject']);
  assert.ok(T.validateContact({ ...ok, message: 'a'.repeat(2001) }).message, 'até 2000 caracteres');
  assert.deepEqual(T.contactArgs({ ...ok, contact: '(11) 98765-4321', code: ' IMED-1A2B3C4D ' }), {
    p_subject: 'duvida', p_name: 'Ana Souza', p_contact: '11987654321', p_message: 'Como funciona o pedido?', p_request_code: 'IMED-1A2B3C4D',
  });
  assert.equal(T.contactArgs(ok).p_request_code, null);
  // Erros do banco (exceção P0001).
  // Cada limite com um texto verdadeiro: o do contato (sem conta) manda entrar na conta; o teto geral não culpa a pessoa.
  assert.match(T.contactError({ data: { code: 'P0001', message: 'limite_contato' } }).text, /várias mensagens com este e-mail ou celular.*entre na sua conta/);
  assert.match(T.contactError({ data: { code: 'P0001', message: 'limite_conta' } }).text, /Sua conta já mandou várias mensagens/);
  const geral = T.contactError({ data: { code: 'P0001', message: 'limite_geral' } }).text;
  assert.match(geral, /Chegaram muitas mensagens ao mesmo tempo/);
  assert.ok(!/Você mandou/.test(geral), 'o teto geral não diz que foi a pessoa');
  // Os mesmos códigos do banco.
  const sqlLimits = readFileSync(`${ROOT}supabase/migrations/20261030143738_confianca.sql`, 'utf8');
  for (const k of ['limite_contato', 'limite_conta', 'limite_geral']) assert.ok(sqlLimits.includes(`raise exception '${k}'`), `banco: ${k}`);
  assert.deepEqual(T.contactError({ data: { code: 'P0001', message: 'dados_invalidos', details: 'contato' } }).field, 'contact');
  assert.equal(T.contactError(new Error('rede')).field, undefined);
  assert.equal(T.isProtocol('IMED-20261030-AB2C'), true);
  assert.equal(T.isProtocol('IMED-1A2B3C4D'), false);
});

test('"Algo errado aqui?": tipos, validação e argumentos (cadastro oficial ou parceiro)', () => {
  assert.deepEqual(T.REPORT_KINDS.map(([k]) => k), ['telefone', 'fechado', 'endereco', 'exame', 'outro']);
  assert.deepEqual(T.validateReport({ kind: 'telefone', note: '' }), {});
  assert.ok(T.validateReport({ kind: '', note: '' }).kind);
  assert.ok(T.validateReport({ kind: 'outro', note: 'a'.repeat(301) }).note);
  assert.deepEqual(T.reportArgs({ source: 'cnes', id: 'cnes:2077485' }, { kind: 'fechado', note: '  fechou   em   setembro ' }),
    { p_cnes: '2077485', p_clinic: null, p_kind: 'fechado', p_note: 'fechou em setembro' });
  const id = 'bbbbbbbb-0000-4000-8000-000000000011';
  assert.deepEqual(T.reportArgs({ source: 'imed', id: `imed:${id}`, clinic_id: id }, { kind: 'exame', note: '' }),
    { p_cnes: null, p_clinic: id, p_kind: 'exame', p_note: null });
  assert.equal(T.reportKindLabel('endereco'), 'O endereço mudou');
  // 'limite' só para aviso novo com muitos de todo mundo ao mesmo tempo: não agradece como se tivesse gravado.
  assert.match(T.REPORT_MSG.limite, /não deu para gravar o seu agora/);
  assert.ok(!/Obrigado/.test(T.REPORT_MSG.limite));
});

test('Meus dados: arquivo com a conta, os pedidos e o aparelho, sem o código secreto dos pedidos', () => {
  const device = [{ type: 'pedido', id: 'x', token: 'a'.repeat(64), name: 'Hospital', status: 'pendente' }, null, 'lixo'];
  const out = T.dataExport({ email: 'ana@exemplo.com', userId: 'u1', requests: [{ id: 'r1' }], claims: [{ id: 'k1' }], device, now: NOW });
  assert.equal(out.servico, 'IMED');
  assert.equal(out.gerado_em, '2026-10-30T12:00:00.000Z');
  assert.deepEqual(out.conta, { email: 'ana@exemplo.com', id: 'u1' });
  assert.deepEqual(out.pedidos_da_conta, [{ id: 'r1' }]);
  assert.deepEqual(out.pedidos_de_cadastro_de_clinica, [{ id: 'k1' }]);
  assert.deepEqual(out.pedidos_deste_aparelho, [{ type: 'pedido', id: 'x', name: 'Hospital', status: 'pendente' }]);
  assert.ok(!JSON.stringify(out).includes('a'.repeat(64)), 'sem o token');
  assert.equal(T.dataExport({ device: [] }).conta, null);
  assert.equal(T.dataExportName(NOW), 'imed-meus-dados-2026-10-30.json');
});

test('conferência antes de aprovar: as quatro obrigatórias, com o conselho e o número do registro do profissional', () => {
  assert.deepEqual(T.CLAIM_CHECKS.map(([k]) => k), ['cnes_active', 'cnpj_active', 'phone_confirmed', 'council_active']);
  // Não é só médico: num laboratório o responsável pode ser biomédico ou farmacêutico (sem caixa falsa de CRM).
  assert.ok(!/CRM ativo do médico|Médico responsável com CRM/.test(JSON.stringify(T.CLAIM_CHECKS)));
  assert.deepEqual(T.COUNCILS.map(([k]) => k), ['CRM', 'CRF', 'CRBM', 'CRBio', 'CRO', 'COREN', 'CREFITO', 'CRP', 'CRN', 'CRFa', 'outro']);
  const sql = readFileSync(`${ROOT}supabase/migrations/20261030143738_confianca.sql`, 'utf8');
  const sqlCouncils = sql.match(/council in \(([^)]+)\)/)[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
  assert.deepEqual(sqlCouncils, T.COUNCILS.map(([k]) => k), 'a mesma lista de conselhos no banco');
  assert.equal(T.COUNCIL_LINKS.CRM, 'https://portal.cfm.org.br/busca-medicos/');
  const full = { cnes_active: true, cnpj_active: true, phone_confirmed: true, council_active: true, council: 'CRBM', council_number: '12345-SP' };
  assert.equal(T.checksComplete(full), true);
  assert.equal(T.checksComplete({ ...full, council_active: false }), false);
  assert.equal(T.checksComplete({ ...full, council: '' }), false, 'sem o conselho');
  assert.equal(T.checksComplete({ ...full, council: 'XYZ' }), false, 'conselho fora da lista');
  assert.equal(T.checksComplete({ ...full, council_number: ' 1 ' }), false, 'sem o número');
  assert.equal(T.checksComplete(null), false);
  const v = { cnes_active: true, cnpj_active: true, phone_confirmed: false, council_active: true, council: 'CRF', council_number: '  12345   SP ', note: '  conferido no site do CRF  ' };
  assert.deepEqual(T.checksPayload((k) => v[k]), { cnes_active: true, cnpj_active: true, phone_confirmed: false, council_active: true, council: 'CRF', council_number: '12345 SP', note: 'conferido no site do CRF' });
  const none = T.checksPayload((k) => (k === 'note' || k === 'council' || k === 'council_number' ? '' : true));
  assert.ok(!('note' in none) && !('council' in none) && !('council_number' in none));
});

test('datas: "Verificado em dd/mm/aaaa" e "atualizado em 30 de outubro de 2026" no fuso de São Paulo', () => {
  assert.equal(T.dateBR('2026-10-30T02:30:00Z'), '29/10/2026', '23:30 em São Paulo ainda é dia 29');
  assert.equal(T.dateBR('2026-10-30T12:00:00Z'), '30/10/2026');
  assert.equal(T.dateBR(null), '');
  assert.equal(T.dateBR('nada'), '');
  assert.equal(T.dayLong('2026-10-30'), '30 de outubro de 2026');
  assert.equal(T.dayLong('30/10/2026'), '');
  assert.equal(T.deCidade('Rio de Janeiro'), 'do Rio de Janeiro');
  assert.equal(T.deCidade('Belo Horizonte'), 'de Belo Horizonte');
  assert.equal(T.deCidade('Serra'), 'da Serra');
  assert.equal(T.deCidade('Cabo de Santo Agostinho'), 'do Cabo de Santo Agostinho');
});

test('pedido para outra pessoa: validação, menor de 18 anos e colunas novas só quando é para outra pessoa', () => {
  const base = { exam: 'rm', date: '2026-11-03', period: 'manha', name: 'Ana Souza', phone: '(11) 98765-4321', email: '', notes: '', consent: true };
  assert.deepEqual(G.validateBooking({ ...base, forOther: false }, '2026-10-28', '2027-01-26'), {});
  const other = { ...base, forOther: true, otherName: ' João  Souza ', relationship: 'Filho ou filha', otherMinor: false, guardianConsent: false, otherConsent: true };
  assert.deepEqual(G.validateBooking(other, '2026-10-28', '2027-01-26'), {});
  // Adulto: o exame é dado de saúde dele; quem pede confirma que ele sabe e concordou.
  assert.ok(G.validateBooking({ ...other, otherConsent: false }, '2026-10-28', '2027-01-26').otherConsent, 'adulto sem a confirmação');
  assert.deepEqual(Object.keys(G.validateBooking({ ...other, otherName: ' ', relationship: 'Vizinho' }, '2026-10-28', '2027-01-26')).sort(), ['otherName', 'relationship']);
  assert.ok(G.validateBooking({ ...other, otherMinor: true }, '2026-10-28', '2027-01-26').guardian, 'menor sem a autorização do responsável');
  assert.deepEqual(G.validateBooking({ ...other, otherMinor: true, guardianConsent: true, otherConsent: false }, '2026-10-28', '2027-01-26'), {}, 'menor: vale a autorização do responsável');
  // Ordem dos erros igual à do formulário: os de outra pessoa vêm antes do nome de quem pede.
  const order = Object.keys(G.validateBooking({ ...other, name: '', otherName: '' }, '2026-10-28', '2027-01-26'));
  assert.ok(order.indexOf('otherName') < order.indexOf('name'));
  const place = { source: 'cnes', id: 'cnes:2077485', name: 'Hospital', address: null, phone: null, clinic_id: null };
  const mine = G.bookingRow(place, { ...base, forOther: false }, 'id1');
  for (const k of ['for_other', 'other_name', 'relationship', 'other_minor', 'guardian_consent', 'other_consent']) assert.ok(!(k in mine), `pedido comum sem ${k}`);
  const row = G.bookingRow(place, { ...other, otherMinor: true, guardianConsent: true }, 'id2');
  assert.equal(row.other_consent, false, 'menor: vale a autorização do responsável');
  assert.equal(row.for_other, true);
  assert.equal(row.other_name, 'João Souza');
  assert.equal(row.relationship, 'Filho ou filha');
  assert.equal(row.other_minor, true);
  assert.equal(row.guardian_consent, true);
  assert.equal(row.patient_name, 'Ana Souza', 'quem pede continua em patient_name');
  assert.equal(G.bookingRow(place, { ...other, guardianConsent: true }, 'id3').guardian_consent, false, 'adulto: sem autorização de responsável');
  assert.equal(G.bookingRow(place, other, 'id4').other_consent, true, 'adulto: a confirmação de que ele concordou');
  // Mesmas opções de parentesco no formulário; os campos ficam escondidos até escolher "Outra pessoa".
  const html = G.forWhomHTML();
  for (const r of G.RELATIONSHIPS) assert.ok(html.includes(`<option value="${r}">`), r);
  assert.match(html, /name="para" value="mim" checked/);
  assert.match(html, /data-other hidden/);
  assert.match(html, /data-guardian hidden/);
  assert.match(html, /LGPD, art\. 14/);
  assert.match(html, /name="concorda"/);
  assert.match(html, /Essa pessoa sabe deste pedido e concordou/);
});

test('cancelar vários exames marcados juntos (5.2): a pergunta e o aviso dizem que todos são cancelados', () => {
  const slot = '2026-11-17T11:00:00.000Z';
  const ask = T.cancelConfirmText('parceiro', slot, 'confirmed', 3);
  assert.match(ask, /^Cancelar os 3 exames deste agendamento\? Eles foram marcados juntos e são cancelados juntos\. Cancelar pelo IMED é grátis\./);
  assert.match(ask, /os horários voltam a ficar livres para outras pessoas\.$/);
  assert.equal(T.cancelDoneText(slot, 'parceiro', '', 'confirmed', 3), 'Os 3 exames foram cancelados. Os horários voltaram a ficar livres. A clínica vê o cancelamento no painel dela.');
  // um exame só: os textos de sempre
  assert.equal(T.cancelConfirmText('parceiro', slot, 'confirmed', 1), T.cancelConfirmText('parceiro', slot, 'confirmed'));
  assert.equal(T.cancelDoneText(slot, 'parceiro', '', 'confirmed', 1), T.cancelDoneText(slot, 'parceiro', '', 'confirmed'));
  assert.match(T.cancelConfirmText('parceiro', slot, 'confirmed'), /^Cancelar este pedido\?/);
});
