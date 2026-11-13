// Regras puras do painel da agenda (assets/js/agenda-core.js; iMed Agenda, fase 4.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as A from '../assets/js/agenda-core.js';

const ler = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('papéis: permissões espelham agenda.role_permissions da migração', () => {
  const sql = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => /agenda_base_parte_5/.test(f)).map((f) => ler(`supabase/migrations/${f}`)).join('\n');
  const linhas = [...sql.matchAll(/\('(owner|manager|reception|staff|professional|finance)', '([a-z.]+)', '([a-z_]+)'\)/g)];
  assert.ok(linhas.length > 40);
  const doBanco = {};
  for (const [, r, p, s] of linhas) (doBanco[r] ||= {})[p] = s;
  for (const r of Object.keys(doBanco)) assert.deepEqual(A.permsOf(r), doBanco[r], `papel ${r}`);
  assert.deepEqual(A.permsOf('desconhecido'), {});
});

test('abas por permissão (4.2: Agenda para quem vê a agenda; a configuração em "Configurar agenda"; P2b: Financeiro para quem tem financeiro.ver)', () => {
  const todas = ['pedidos', 'agenda', 'config', 'dados', 'exames', 'financeiro', 'equipe'];
  assert.deepEqual(A.clinicTabs(A.permsOf('owner')), todas);
  assert.deepEqual(A.clinicTabs(A.permsOf('manager')), todas);
  assert.deepEqual(A.clinicTabs(A.permsOf('reception')), ['pedidos', 'agenda']);
  assert.deepEqual(A.clinicTabs(A.permsOf('staff')), ['pedidos', 'agenda']);
  assert.deepEqual(A.clinicTabs(A.permsOf('professional')), ['agenda'], 'o profissional vê a própria agenda');
  assert.deepEqual(A.clinicTabs(A.permsOf('finance')), ['financeiro'], 'o papel Financeiro vê só o financeiro (sem pedidos nem agenda: nenhum nome de paciente)');
  for (const papel of ['reception', 'staff', 'professional']) assert.ok(!A.clinicTabs(A.permsOf(papel)).includes('financeiro'), `${papel} não vê o financeiro`);
  assert.equal(A.TAB_LABEL.financeiro, 'Financeiro');
  assert.deepEqual(A.clinicTabs(undefined, true), todas, 'equipe do IMED vê tudo');
  assert.deepEqual(A.clinicTabs(undefined), []);
  assert.equal(A.TAB_LABEL.config, 'Configurar agenda');
  assert.equal(A.defaultTab(todas, true), 'agenda', 'agenda ativa: abre na Agenda');
  assert.equal(A.defaultTab(todas, false), 'pedidos');
  assert.equal(A.defaultTab(['pedidos'], true), 'pedidos');
  assert.equal(A.defaultTab([], true), null);
});

test('quem pode dar cada papel', () => {
  assert.deepEqual(A.rolesICanGive(A.permsOf('owner')), A.ROLES);
  assert.deepEqual(A.rolesICanGive(A.permsOf('manager')), ['manager', 'reception', 'professional', 'finance']);
  assert.deepEqual(A.rolesICanGive(A.permsOf('reception')), []);
  assert.deepEqual(A.rolesICanGive({}, true), A.ROLES);
  assert.equal(A.canManageMember(A.permsOf('manager'), false, 'owner'), false, 'o gestor não mexe em dono');
  assert.equal(A.canManageMember(A.permsOf('manager'), false, 'staff'), true, 'staff antigo = recepção');
});

test('convite: e-mail e papel', () => {
  assert.deepEqual(A.inviteErrors('nome@clinica.test', 'reception'), {});
  assert.match(A.inviteErrors('sem-arroba', 'reception').email, /e-mail válido/);
  assert.match(A.inviteErrors('a@b.c', 'reception').email, /e-mail válido/, 'menos de 6 letras');
  assert.match(A.inviteErrors('nome@clinica.test', '').role, /Escolha/);
  assert.match(A.inviteErrors('nome@clinica.test', 'owner', ['reception']).role, /não pode dar/);
});

test('fusos: os mesmos do CHECK de clinics.timezone', () => {
  const sql = ler(`supabase/migrations/${readdirSync(new URL('../supabase/migrations/', import.meta.url)).find((f) => /agenda_base_parte_1/.test(f))}`);
  const lista = sql.match(/clinics_timezone_ck check \(timezone in \(([\s\S]*?)\)\)/)[1].match(/'[^']+'/g).map((x) => x.slice(1, -1)).sort();
  assert.deepEqual(A.TIMEZONES.map(([k]) => k).sort(), lista);
  assert.match(A.tzLabel('America/Manaus'), /Uma hora a menos/);
  assert.equal(A.tzLabel('Europe/Lisbon'), 'Europe/Lisbon');
});

test('horas e minutos', () => {
  assert.equal(A.toMin('07:30'), 450);
  assert.equal(A.toMin('24:00'), 1440);
  assert.ok(Number.isNaN(A.toMin('24:05')));
  assert.ok(Number.isNaN(A.toMin('7:30')));
  assert.equal(A.fromMin(450), '07:30');
  assert.equal(A.fmtMinutes(20), '20 min');
  assert.equal(A.fmtMinutes(90), '1 h 30 min');
  assert.equal(A.fmtMinutes(120), '2 h');
  assert.equal(A.fmtMinutes(2880), '2 dias');
  assert.deepEqual(A.intIn('15', 5, 480, { mult: 5 }), { ok: true, value: 15 });
  assert.equal(A.intIn('17', 5, 480, { mult: 5 }).ok, false);
  assert.equal(A.intIn('', 0, 24).ok, false);
  assert.deepEqual(A.intIn('', 0, 24, { optional: true }), { ok: true, value: null });
  assert.equal(A.intIn('1.5', 0, 24).ok, false);
});

const QUICK = () => ({ timezone: 'America/Sao_Paulo', confirmTz: true, days: [1, 2, 3, 4, 5], open: '07:00', close: '18:00', pauseFrom: '12:00', pauseTo: '13:00',
  exams: [{ exam_code: 'usg', name: 'Ultrassom', kind: 'equipamento', count: '2', duration: '20' }, { exam_code: 'rx', name: 'Raio-X', kind: 'sala', count: '1', duration: '15' }] });

test('configuração rápida: erros', () => {
  assert.deepEqual(A.quickErrors(QUICK()), {});
  const e = A.quickErrors({ timezone: 'UTC', confirmTz: false, days: [], open: '', close: '', pauseFrom: '12:00', pauseTo: '', exams: [] });
  assert.deepEqual(Object.keys(e).sort(), ['close', 'confirmTz', 'days', 'exams', 'open', 'pause', 'timezone']);
  assert.match(A.quickErrors({ ...QUICK(), close: '06:00' }).close, /depois da hora de abrir/);
  assert.match(A.quickErrors({ ...QUICK(), open: '07:03' }).open, /5 em 5/);
  assert.match(A.quickErrors({ ...QUICK(), pauseFrom: '06:00', pauseTo: '07:30' }).pause, /dentro do horário/);
  assert.match(A.quickErrors({ ...QUICK(), pauseTo: '11:00' }).pause, /depois do começo/);
  const ex = QUICK();
  ex.exams[1] = { exam_code: '', name: 'ultrassom', kind: 'x', count: '0', duration: '7' };
  const e2 = A.quickErrors(ex);
  assert.match(e2.ex1code, /tipo de exame/);
  assert.match(e2.ex1name, /Já existe um exame com este nome/);
  assert.match(e2.ex1kind, /aparelho, sala ou profissional/);
  assert.match(e2.ex1count, /de 1 a 20/);
  assert.match(e2.ex1dur, /de 5 em 5/);
});

test('configuração rápida: plano (recursos, procedimentos e regras)', () => {
  const p = A.quickPlan(QUICK());
  assert.deepEqual(p.unit, { timezone: 'America/Sao_Paulo', confirm_timezone: true });
  assert.deepEqual(p.resources, [
    { key: 'e0r1', kind: 'equipamento', name: 'Aparelho de Ultrassom 1' }, { key: 'e0r2', kind: 'equipamento', name: 'Aparelho de Ultrassom 2' },
    { key: 'e1r1', kind: 'sala', name: 'Sala de Raio-X' }]);
  assert.deepEqual(p.procedures, [{ exam_code: 'usg', name: 'Ultrassom', duration_min: 20, kind: 'equipamento', resourceKeys: ['e0r1', 'e0r2'] },
    { exam_code: 'rx', name: 'Raio-X', duration_min: 15, kind: 'sala', resourceKeys: ['e1r1'] }]);
  assert.equal(p.rules.length, 10);
  assert.deepEqual(p.rules[0], { weekday: 1, start: '07:00', end: '18:00', kind: 'abre' });
  assert.deepEqual(p.rules[9], { weekday: 5, start: '12:00', end: '13:00', kind: 'pausa', label: 'Pausa' });
  assert.equal(A.quickPlan({ ...QUICK(), pauseFrom: '', pauseTo: '' }).rules.length, 5);
  assert.deepEqual(A.requirementFor('sala', ['a', 'b']), [{ resource_kind: 'sala', options: [{ resource_id: 'a' }, { resource_id: 'b' }] }]);
  // nomes dentro do limite do banco (2 a 80)
  const longo = A.quickPlan({ ...QUICK(), exams: [{ exam_code: 'rm', name: 'R'.repeat(120), kind: 'equipamento', count: '12', duration: '30' }] });
  for (const r of longo.resources) assert.ok(r.name.length <= 80, r.name);
});

test('semana: das regras para a tela e de volta, com as especiais guardadas', () => {
  const rules = [
    { resource_id: null, weekday: 1, start: '13:00', end: '18:00', kind: 'abre', valid_from: null, valid_to: null, label: null, procedure_ids: [] },
    { resource_id: null, weekday: 1, start: '08:00', end: '12:00', kind: 'abre', valid_from: null, valid_to: null, label: null, procedure_ids: [] },
    { resource_id: null, weekday: 1, start: '10:00', end: '10:15', kind: 'pausa', valid_from: null, valid_to: null, label: 'Café', procedure_ids: [] },
    { resource_id: null, weekday: 6, start: '08:00', end: '12:00', kind: 'abre', valid_from: '2026-12-01', valid_to: null, label: null, procedure_ids: [] },
    { resource_id: 'r1', weekday: 2, start: '08:00', end: '09:00', kind: 'abre', valid_from: null, valid_to: null, label: null, procedure_ids: [] },
  ];
  const { week, keep } = A.weekFromRules(rules);
  assert.deepEqual(week[1].open, [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }]);
  assert.deepEqual(week[1].pause, [{ start: '10:00', end: '10:15', label: 'Café' }]);
  assert.equal(keep.length, 1, 'a regra com validade fica guardada; a do recurso não é da unidade');
  const back = A.rulesFromWeek(week, keep);
  assert.deepEqual(back, [
    { weekday: 1, start: '08:00', end: '12:00', kind: 'abre' }, { weekday: 1, start: '13:00', end: '18:00', kind: 'abre' },
    { weekday: 1, start: '10:00', end: '10:15', kind: 'pausa', label: 'Café' },
    { weekday: 6, start: '08:00', end: '12:00', kind: 'abre', valid_from: '2026-12-01' }]);
  assert.equal(A.weekSummary(week), 'Segunda: 08:00 às 12:00 e 13:00 às 18:00');
  assert.equal(A.weekSummary(A.weekFromRules([]).week), 'Nenhum horário de atendimento');
  const c = A.copyMonday(week);
  for (const d of [2, 3, 4, 5]) assert.deepEqual(c[d], week[1]);
  assert.deepEqual(c[0], week[0]);
  c[2].open.push({ start: '19:00', end: '20:00' });
  assert.equal(c[3].open.length, 2, 'cópias independentes');
});

test('semana: erros de horário', () => {
  const { week } = A.weekFromRules([]);
  week[1].open = [{ start: '08:00', end: '12:00' }, { start: '11:00', end: '14:00' }, { start: '', end: '' }, { start: '15:00', end: '14:00' }, { start: '16:02', end: '17:00' }];
  week[2].pause = [{ start: '10:00', end: '10:30' }];
  const e = A.weekErrors(week);
  assert.match(e['1-open-1'], /Cruza com 08:00 às 12:00/);
  assert.match(e['1-open-2'], /Preencha/);
  assert.match(e['1-open-3'], /depois do começo/);
  assert.match(e['1-open-4'], /5 em 5/);
  assert.match(e['2-pause-0'], /dia sem horário/);
  assert.equal(e['1-open-0'], undefined);
});

test('recurso: erros e o que vai ao banco', () => {
  assert.deepEqual(A.resourceErrors({ kind: 'sala', name: 'Sala 1', capacity: '1', setup_min: '0', cleanup_min: '10' }), {});
  const e = A.resourceErrors({ kind: 'x', name: 'S', capacity: '0', setup_min: '3', cleanup_min: '300', council_number: '1'.repeat(21) });
  assert.deepEqual(Object.keys(e).sort(), ['capacity', 'cleanup_min', 'council_number', 'kind', 'name', 'setup_min']);
  assert.equal(A.resourceErrors({ name: 'Sala 1', capacity: '1', setup_min: '0', cleanup_min: '0' }, { isNew: false }).kind, undefined);
  assert.deepEqual(A.resourcePayload({ kind: 'sala', name: ' Sala 1 ', capacity: '2', setup_min: '5', cleanup_min: '' }),
    { name: 'Sala 1', capacity: 2, setup_min: 5, cleanup_min: 0, active: true, kind: 'sala' });
  assert.deepEqual(A.resourcePayload({ id: 'r1', kind: 'profissional', name: 'Dra. Teste', capacity: '1', setup_min: '0', cleanup_min: '0', council: 'CRM', council_number: ' 12 ', active: false }, { isNew: false }),
    { name: 'Dra. Teste', capacity: 1, setup_min: 0, cleanup_min: 0, active: false, id: 'r1', member_user_id: null, council: 'CRM', council_number: '12' });
});

test('preço: centavos, sob consulta e conferência L11', () => {
  assert.equal(A.priceCents(''), null);
  assert.equal(A.priceCents('180'), 18000);
  assert.equal(A.priceCents('180,5'), 18050);
  assert.equal(A.priceCents('R$ 1.200,00'), 120000);
  assert.ok(Number.isNaN(A.priceCents('0,50')), 'abaixo de R$ 1');
  assert.ok(Number.isNaN(A.priceCents('abc')));
  assert.ok(Number.isNaN(A.priceCents('1,234')));
  assert.equal(A.centsText(null), 'sob consulta');
  assert.match(A.centsText(18000), /R\$\s?180,00/);
  assert.equal(A.priceNeedsCheck('rx', 900000), true);
  assert.equal(A.priceNeedsCheck('rm', 900000), false);
  assert.equal(A.priceNeedsCheck('rx', null), false);
  // os limites são os mesmos do painel antigo (Exames e preços)
  const painel = ler('assets/js/painel.js');
  const m = painel.match(/export const PRICE_CHECK_CENTS = (\{[^}]+\})/);
  assert.deepEqual(A.PRICE_CHECK_CENTS, Function(`return ${m[1]}`)());
});

test('procedimento: erros e o que vai ao banco', () => {
  const res = [{ id: 'r1', kind: 'equipamento' }, { id: 'r2', kind: 'sala' }];
  const ok = { exam_code: 'usg', name: 'Ultrassom', duration_min: '20', price: '', fasting_hours: '', patient_prep_text: '', groups: [{ resource_kind: 'equipamento', options: ['r1'] }] };
  assert.deepEqual(A.procedureErrors(ok, res), {});
  const e = A.procedureErrors({ exam_code: 'x', name: '', duration_min: '3', price: 'abc', fasting_hours: '30', patient_prep_text: 'a'.repeat(601), groups: [] }, res);
  assert.deepEqual(Object.keys(e).sort(), ['duration_min', 'exam_code', 'fasting_hours', 'groups', 'name', 'patient_prep_text', 'price']);
  assert.match(A.procedureErrors({ ...ok, groups: [{ resource_kind: 'sala', options: ['r1'] }] }, res).g0, /Marque pelo menos um sala/);
  assert.match(A.procedureErrors({ ...ok, groups: [{ resource_kind: 'equipamento', options: ['r1'] }, { resource_kind: 'equipamento', options: ['r1'] }] }, res).g1, /dois grupos/);
  assert.deepEqual(A.procedurePayload({ ...ok, price: '350,00', fasting_hours: '4', patient_prep_text: ' Beber água ' }, { priceConfirmed: true }), {
    exam_code: 'usg', name: 'Ultrassom', duration_min: 20, price_cents: 35000, patient_prep_text: 'Beber água', fasting_hours: 4, online_booking: true, active: true,
    requirements: [{ resource_kind: 'equipamento', options: [{ resource_id: 'r1' }] }], price_confirmed: true });
  const p2 = A.procedurePayload({ ...ok, id: 'p1', online_booking: false }, { isNew: false, priceConfirmed: true });
  assert.equal(p2.id, 'p1');
  assert.equal(p2.price_cents, null);
  assert.equal(p2.price_confirmed, undefined, 'sem preço não confirma nada');
  assert.equal(p2.online_booking, false);
  assert.equal(p2.fasting_hours, null);
});

test('unidade: erros e o que vai ao banco', () => {
  const ok = { step_min: '10', min_notice_h: '2', max_advance_days: '60', holidays_checked_until: '2026-12-31', closes_on_holidays: true };
  assert.deepEqual(A.unitErrors(ok), {});
  assert.deepEqual(Object.keys(A.unitErrors({ step_min: '7', min_notice_h: '200', max_advance_days: '0', holidays_checked_until: '31/12' })).sort(),
    ['holidays_checked_until', 'max_advance_days', 'min_notice_h', 'step_min']);
  assert.deepEqual(A.unitPayload(ok), { step_min: 10, min_notice_min: 120, max_advance_days: 60, holidays_checked_until: '2026-12-31', closes_on_holidays: true });
  assert.equal(A.unitPayload({ ...ok, holidays_checked_until: '' }).holidays_checked_until, null);
});

test('respostas do banco em linguagem simples', () => {
  // toda resposta que as funções da 3.2, 3.4 e 4.1 dão tem texto
  const sql = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => /agenda_(motor|painel|config)/.test(f)).map((f) => ler(`supabase/migrations/${f}`)).join('\n');
  const cods = new Set([...sql.matchAll(/jsonb_build_object\('status', '([a-z_]+)'/g)].map((m) => m[1]));
  for (const c of ['duplicate_name', 'default_exists', 'resource_in_two_groups', 'has_appointments', 'invalid_reference']) cods.add(c); // de private.agenda_err
  for (const c of ['ok', 'affects_appointments']) cods.delete(c);
  const sem = [...cods].filter((c) => !A.STATUS_TEXT[c]);
  // estas não são usadas pelo painel da 4.1 (dia, conflitos, feriados da equipe do IMED)
  const fora = ['invalid_status', 'too_short', 'justification_required', 'reason_required', 'already_closed'];
  assert.deepEqual(sem.filter((c) => !fora.includes(c)), [], `respostas sem texto: ${sem.join(', ')}`);
  assert.equal(A.statusText('nunca_visto', 'padrão'), 'padrão');
  assert.equal(A.affectsText([1]), '1 agendamento futuro deixaria de caber nesta mudança.');
  assert.equal(A.affectsText([1, 2]), '2 agendamentos futuros deixariam de caber nesta mudança.');
});

test('nada inventado: sem horário nem preço de exemplo nos textos da tela', () => {
  for (const f of ['assets/js/agenda.js', 'assets/js/agenda-core.js']) {
    // Comentários explicam formatos aceitos ("R$ 1.200"); o que vale é o texto que vai para a tela.
    const t = ler(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(t, /placeholder=/, `${f}: campos sem exemplo que pareça dado real`);
    assert.doesNotMatch(t, /R\$\s?\d/, `${f}: nenhum preço escrito no código da tela`);
  }
  const js = ler('assets/js/agenda-config.js');
  assert.doesNotMatch(js, /placeholder=/, 'campos sem exemplo que pareça dado real');
  assert.doesNotMatch(js, /R\$\s?\d/, 'nenhum preço escrito no código da tela');
  assert.match(js, /decisão 17/, 'anotação do MFA pendente');
});

/* =====================================================================================================================
   Fase 4.2: agenda visual e recepção
   ===================================================================================================================== */
test('situações da clínica: as 12 com texto, tom e ícone; reserva com a hora no fuso da clínica', () => {
  const doze = ['pending', 'contacted', 'hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service', 'completed', 'no_show', 'reschedule_requested', 'cancelled', 'expired'];
  for (const st of doze) {
    const t = A.statusTag(st);
    assert.ok(A.clinicStatusLabel(st), st);
    assert.ok(['verde', 'azul', 'amarelo', 'vermelho', 'cinza', 'roxo'].includes(t.tone), `${st}: tom`);
    assert.match(t.icon, /^fa-/, `${st}: ícone`);
    assert.ok(t.text && t.short, `${st}: texto`);
  }
  assert.equal(A.clinicStatusLabel('hold', '2026-11-04T13:42:00Z', 'America/Sao_Paulo'), 'Reserva temporária até 10:42');
  assert.equal(A.clinicStatusLabel('awaiting_payment', '2026-11-04T13:42:00Z', 'America/Manaus'), 'Aguardando pagamento até 09:42');
  assert.equal(A.clinicStatusLabel('checked_in'), 'Paciente presente');
  assert.equal(A.clinicStatusLabel('nada'), '');
  assert.equal(A.statusTag('completed').tone, 'roxo');
  assert.equal(A.statusTag('no_show').tone, 'cinza');
  assert.equal(A.statusTag('reschedule_requested').tone, 'amarelo');
  assert.equal(A.CHANNEL_LABEL.clinica_balcao, 'Balcão');
  assert.equal(A.blockLook('manutencao').text, 'Bloqueado: Manutenção');
  assert.equal(A.blockLook('feriado').icon, 'fa-flag');
  assert.equal(A.busyLook('agenda_propria').text, 'Ocupado (agenda própria)');
});

test('legenda: 6 tons, todo item com texto; ícones só do recorte do site (assets/vendor/fa)', () => {
  assert.equal(A.LEGENDA.length, 6);
  assert.deepEqual(A.LEGENDA.map((g) => g.tone), ['verde', 'azul', 'amarelo', 'vermelho', 'cinza', 'roxo']);
  for (const g of A.LEGENDA) for (const [, t] of g.items) assert.ok(t.length > 2);
  const css = ler('assets/vendor/fa/css/icones.min.css');
  const tem = new Set([...css.matchAll(/\.(fa-[a-z0-9-]+):before/g)].map((m) => m[1]));
  const usados = new Set();
  for (const f of ['assets/js/agenda.js', 'assets/js/agenda-core.js']) {
    for (const m of ler(f).matchAll(/\bfa-[a-z0-9-]+/g)) if (!['fa-solid', 'fa-brands', 'fa-regular'].includes(m[0])) usados.add(m[0]);
  }
  assert.ok(usados.size > 15);
  assert.deepEqual([...usados].filter((i) => !tem.has(i)), [], 'ícone fora do recorte (rode scripts/fontes.mjs só se for de propósito)');
});

test('motivos de cancelamento: dentro da regra do banco, sem os do sistema e sem "não pago"', () => {
  const sql = ler(`supabase/migrations/${readdirSync(new URL('../supabase/migrations/', import.meta.url)).find((f) => /agenda_base_parte_1/.test(f))}`);
  const banco = sql.match(/appointment_requests_cancel_reason_ck check \(cancel_reason in \(([\s\S]*?)\)\)/)[1].match(/'[^']+'/g).map((x) => x.slice(1, -1));
  const tela = A.CANCEL_REASONS.map(([k]) => k);
  assert.deepEqual(tela.filter((k) => !banco.includes(k)), []);
  for (const k of ['reserva_expirada', 'remarcado', 'nao_pago']) assert.ok(!tela.includes(k), k);
  assert.ok(A.CANCEL_REASONS.every(([, t]) => t.length > 3));
  assert.deepEqual(A.UNDO_NO_SHOW_REASONS.map(([k]) => k), ['chegou_atrasado', 'registro_errado']);
  assert.deepEqual(A.JUSTIFICATIONS.map(([k]) => k), ['suporte_clinica', 'pedido_do_paciente', 'auditoria', 'conflito_agenda']);
  for (const [k] of [...A.JUSTIFICATIONS, ...A.UNDO_NO_SHOW_REASONS]) assert.match(k, /^[a-z][a-z0-9_]{2,59}$/, 'código aceito pelo banco');
});

test('botões de atendimento: janela de chegada, tolerância, concluído direto e desfazer falta', () => {
  const tz = 'America/Sao_Paulo';
  const unit = { checkin_before_min: 120, no_show_after_min: 15 };
  const it = (status) => ({ status, starts_at: '2026-11-05T12:00:00Z' }); // 09:00 em São Paulo
  const at = (hhmm, day = '2026-11-05') => Date.parse(`${day}T${hhmm}:00-03:00`);
  const acts = (st, hhmm, extra = {}, day) => A.attendActions(it(st), unit, at(hhmm, day), tz, extra);
  const by = (l, k) => l.find((a) => a.key === k);
  let l = acts('confirmed', '06:59');
  assert.equal(by(l, 'chegou').enabled, false);
  assert.equal(by(l, 'chegou').hint, 'Chegada a partir das 07:00');
  assert.equal(by(acts('confirmed', '07:00'), 'chegou').enabled, true);
  assert.equal(by(acts('confirmed', '09:14'), 'faltou').enabled, false);
  assert.equal(by(acts('confirmed', '09:14'), 'faltou').hint, 'Disponível a partir das 09:15');
  assert.equal(by(acts('confirmed', '09:15'), 'faltou').enabled, true);
  assert.equal(by(acts('confirmed', '08:59'), 'concluido').hint, 'Concluído a partir das 09:00');
  assert.equal(by(acts('confirmed', '09:00'), 'concluido').enabled, true);
  assert.equal(by(acts('confirmed', '09:00'), 'concluido').confirm, true);
  assert.deepEqual(acts('checked_in', '09:00').map((a) => a.key), ['atendimento']);
  assert.deepEqual(acts('in_service', '09:10').map((a) => [a.key, a.confirm]), [['concluido', true]]);
  l = acts('no_show', '10:00');
  assert.deepEqual(l.map((a) => [a.key, a.enabled, a.reason]), [['desfazer', true, true]]);
  l = acts('no_show', '10:00', {}, '2026-11-06');
  assert.deepEqual(l.map((a) => [a.key, a.enabled, a.hint]), [['desfazer', false, 'Só no dia do exame']]);
  assert.deepEqual(acts('no_show', '10:00', { scope: 'propria' }), [], 'o profissional não desfaz a falta');
  assert.deepEqual(acts('confirmed', '09:30', { scope: 'propria' }).map((a) => a.key), ['chegou', 'concluido', 'faltou'], 'na própria agenda');
  assert.deepEqual(acts('confirmed', '09:30', { scope: 'central' }).map((a) => a.key), ['concluido'], 'a equipe do IMED: só concluído depois do início');
  assert.deepEqual(acts('confirmed', '09:30', { scope: 'central', can: { atender: false } }), [], 'equipe do IMED sem operar a agenda (suporte, auditoria): nada (operacao-11)');
  assert.deepEqual(acts('confirmed', '09:30', { scope: 'clinica', can: { atender: false } }), [], 'clínica sem atender: nada');
  assert.deepEqual(acts('cancelled', '09:30'), []);
  assert.deepEqual(A.manageActions({ status: 'confirmed' }, { scope: 'clinica', can: { remarcar: true, cancelar: true } }), ['remarcar', 'cancelar']);
  assert.deepEqual(A.manageActions({ status: 'reschedule_requested' }, { scope: 'clinica', can: { remarcar: true, cancelar: true }, unplaced: true }), ['remarcar', 'voltar', 'cancelar']);
  assert.deepEqual(A.manageActions({ status: 'confirmed' }, { scope: 'propria', can: { remarcar: true, cancelar: true } }), []);
  assert.deepEqual(A.manageActions({ status: 'completed' }, { scope: 'clinica', can: { remarcar: true, cancelar: true } }), []);
});

test('fuso: dia e hora da clínica → instante, com a mesma escolha do Postgres (205_fuso.sql)', () => {
  assert.equal(A.localToUtc('2026-11-05', '09:00', 'America/Sao_Paulo'), '2026-11-05T12:00:00.000Z');
  assert.equal(A.localToUtc('2026-11-05', '09:00', 'America/Manaus'), '2026-11-05T13:00:00.000Z');
  assert.equal(A.localToUtc('2026-11-05', '09:00', 'America/Noronha'), '2026-11-05T11:00:00.000Z');
  assert.equal(A.localToUtc('2026-11-05', '24:00', 'America/Sao_Paulo'), '2026-11-06T03:00:00.000Z');
  // começo do horário de verão de 2018: 00:00 não existiu (o Postgres usa o fuso de antes: o próximo instante)
  assert.equal(A.localToUtc('2018-11-04', '00:00', 'America/Sao_Paulo'), '2018-11-04T03:00:00.000Z');
  assert.equal(A.localToUtc('2018-11-04', '00:30', 'America/Sao_Paulo'), '2018-11-04T03:30:00.000Z');
  // fim do horário de verão de 2019: 23:00 aconteceu duas vezes (o Postgres usa o fuso de depois: a segunda vez);
  // valores conferidos num Postgres de verdade ((data + hora) at time zone 'America/Sao_Paulo')
  assert.equal(A.localToUtc('2019-02-16', '23:00', 'America/Sao_Paulo'), '2019-02-17T02:00:00.000Z');
  assert.equal(A.localToUtc('2019-02-16', '23:30', 'America/Sao_Paulo'), '2019-02-17T02:30:00.000Z');
  assert.equal(A.localToUtc('2019-02-16', '22:00', 'America/Sao_Paulo'), '2019-02-17T00:00:00.000Z');
  assert.equal(A.localToUtc('31/12/2026', '09:00', 'America/Sao_Paulo'), null);
  assert.equal(A.localToUtc('2026-11-05', '9h', 'America/Sao_Paulo'), null);
  assert.equal(A.dayIn('America/Manaus', Date.parse('2026-11-05T03:30:00Z')), '2026-11-04');
  assert.equal(A.timeIn('America/Manaus', '2026-11-05T13:00:00Z'), '09:00');
  assert.equal(A.mondayOf('2026-11-04'), '2026-11-02');
  assert.equal(A.mondayOf('2026-11-08'), '2026-11-02');
  assert.equal(A.fmtDayLong('2026-11-03'), 'terça-feira, 3 de novembro');
  assert.equal(A.fmtDayShort('2026-11-05'), 'qui., 05/11');
  assert.equal(A.fmtWhen('America/Sao_Paulo', '2026-11-05T12:30:00Z'), 'qui., 05/11 às 09:30');
});

test('aviso de fuso: só quando a clínica está em outro deslocamento naquele instante', () => {
  const ms = Date.parse('2026-11-04T13:00:00Z');
  assert.equal(A.tzNote('America/Manaus', 'America/Sao_Paulo', ms), 'Horários no fuso da clínica (uma hora a menos que Brasília).');
  assert.equal(A.tzNote('America/Noronha', 'America/Sao_Paulo', ms), 'Horários no fuso da clínica (uma hora a mais que Brasília).');
  assert.equal(A.tzNote('America/Rio_Branco', 'America/Sao_Paulo', ms), 'Horários no fuso da clínica (duas horas a menos que Brasília).');
  assert.equal(A.tzNote('America/Bahia', 'America/Sao_Paulo', ms), '');
  assert.equal(A.tzNote('America/Sao_Paulo', 'Asia/Tokyo', ms), 'Horários no fuso da clínica (12 horas a menos que o horário deste aparelho).');
});

test('grade do dia: raias para quem se cruza; posição em linhas de 15 min', () => {
  const l = A.layoutColumn([{ id: 'a', start: 540, end: 570 }, { id: 'b', start: 555, end: 600 }, { id: 'c', start: 600, end: 630 }], 420, 15);
  assert.deepEqual(l.a, { row: 8, span: 2, lane: 0, lanes: 2 }, '09:00–09:30 com o dia começando às 07:00: linha 8, altura 2');
  assert.equal(l.b.lane, 1);
  assert.equal(l.b.lanes, 2, 'dois que se cruzam: 2 raias');
  assert.deepEqual([l.c.lane, l.c.lanes], [0, 1], 'encostado não cruza: 1 raia');
  assert.deepEqual(A.layoutColumn([]), {});
});

test('grade: exame curto com altura mínima na tela e raias contadas com ela (nenhum item cobre outro)', () => {
  // três de 10 min seguidos, com a altura mínima de 1 linha (15 min): na tela, cada um cobriria o próximo
  const l = A.layoutColumn([{ id: 'a', start: 840, end: 850 }, { id: 'b', start: 850, end: 860 }, { id: 'c', start: 860, end: 870 }], 420, 15, 1);
  assert.deepEqual([l.a.span, l.b.span, l.c.span], [1, 1, 1]);
  assert.deepEqual([l.a.lane, l.b.lane, l.c.lane], [0, 1, 0], 'b fica ao lado de a; c volta para a 1ª raia (a já terminou na tela)');
  assert.ok([l.a, l.b, l.c].every((p) => p.lanes === 2));
  // de 15 min encostados, com altura mínima de 1 linha: uma raia só
  const m = A.layoutColumn([{ id: 'a', start: 660, end: 675 }, { id: 'b', start: 675, end: 690 }], 420, 15, 1);
  assert.deepEqual([m.a.lanes, m.b.lanes], [1, 1]);
  // altura própria do item (o "também em: …" pede mais)
  assert.equal(A.layoutColumn([{ id: 'a', start: 660, end: 675, minSpan: 1.5 }], 420, 15, 1).a.span, 1.5);
  // escala: sem item curto, 24 px por 15 min; exame de 15 min, 44 px; mais curto, para em 44 px e o item tem 1 linha
  assert.deepEqual(A.gridScale([30, 60]), { rowh: 24, minSpan: 44 / 24 });
  assert.deepEqual(A.gridScale([15, 30]), { rowh: 44, minSpan: 1 });
  assert.deepEqual(A.gridScale([5]), { rowh: 44, minSpan: 1 });
  assert.equal(A.gridScale([20]).rowh, 33);
  assert.deepEqual(A.gridScale([]), { rowh: 24, minSpan: 44 / 24 });
});

test('novo agendamento: erros com os textos da tela e o que vai ao banco', () => {
  const ok = { procedure: 'p1', slot: '2026-11-05T13:30:00.000Z', name: '  Maria   Souza ', phone: '(11) 98888-7777', email: '', forOther: false, channel: 'clinica_telefone', consent: true };
  assert.deepEqual(A.deskErrors(ok), {});
  const e = A.deskErrors({ ...ok, procedure: '', slot: '', name: 'M', phone: '119888877', email: 'sem-arroba', channel: 'imed_app', consent: false });
  assert.deepEqual(Object.keys(e).sort(), ['bkCanal', 'bkConsent', 'bkEmail', 'bkFone', 'bkNome', 'bkProc', 'bkSlot']);
  assert.match(e.bkNome, /2 a 120 letras/);
  assert.match(e.bkFone, /celular com DDD/);
  assert.match(e.bkConsent, /foi avisada/);
  const menor = A.deskErrors({ ...ok, forOther: true, otherName: 'Ana', relationship: 'Filha', otherMinor: true, guardianConsent: false });
  assert.match(menor.bkAutoriza, /responsável legal/);
  const adulto = A.deskErrors({ ...ok, forOther: true, otherName: 'Ana', relationship: 'Mãe', otherMinor: false, otherConsent: false });
  assert.match(adulto.bkAutoriza, /sabe e concordou/);
  assert.deepEqual(Object.keys(A.deskErrors({ ...ok, forOther: true, otherName: '', relationship: 'x' })).sort(), ['bkAutoriza', 'bkOutroNome', 'bkParentesco']);
  assert.deepEqual(A.deskPayload(ok), { name: 'Maria Souza', phone: '11988887777', consent: true, for_other: false });
  assert.deepEqual(A.deskPayload({ ...ok, email: ' Maria@Exemplo.test ', forOther: true, otherName: ' Ana  Souza ', relationship: 'Filha', otherMinor: true }),
    { name: 'Maria Souza', phone: '11988887777', consent: true, for_other: true, email: 'maria@exemplo.test', other_name: 'Ana Souza', relationship: 'Filha', other_minor: true, guardian_consent: true, other_consent: false });
  const g = A.slotGroups([{ start: '2026-11-05T10:30:00Z' }, { start: '2026-11-05T16:00:00Z' }, { start: '2026-11-05T22:00:00Z' }], 'America/Sao_Paulo');
  assert.deepEqual(g.map((x) => [x.key, x.slots.map((s) => s.label)]), [['manha', ['07:30']], ['tarde', ['13:00']], ['noite', ['19:00']]]);
});

test('sem horário: o motivo que o banco devolve vira o texto certo', () => {
  assert.match(A.noSlotsText({ national_holidays_until: null, holidays_checked_until: '2026-12-31' }), /o IMED ainda não lançou os feriados nacionais/);
  assert.match(A.noSlotsText({ national_holidays_until: '2027-12-31', holidays_checked_until: null }, { canConfig: true }), /Configurar agenda › Unidade/);
  assert.match(A.noSlotsText({ national_holidays_until: '2027-12-31', holidays_checked_until: null }), /Peça ao dono ou gestor/);
  assert.equal(A.noSlotsText({ national_holidays_until: '2026-12-31', holidays_checked_until: '2027-03-01' }, { day: '2027-01-02' }),
    'Os feriados só foram conferidos até 31/12/2026. Escolha um dia até essa data.');
  assert.equal(A.noSlotsText({ national_holidays_until: '2027-12-31', holidays_checked_until: '2027-03-01' }, { day: '2026-11-05' }), 'Nenhum horário livre neste dia. Tente outro dia.');
});

test('bloqueio no fuso da clínica (dias inteiros ou algumas horas)', () => {
  const now = Date.parse('2026-11-04T13:00:00Z');
  let r = A.blockRangeTz({ kind: 'day', from: '2026-11-05', to: '' }, 'America/Sao_Paulo', now);
  assert.deepEqual([r.starts, r.ends], ['2026-11-05T03:00:00.000Z', '2026-11-06T03:00:00.000Z']);
  r = A.blockRangeTz({ kind: 'day', from: '2026-11-05', to: '' }, 'America/Manaus', now);
  assert.deepEqual([r.starts, r.ends], ['2026-11-05T04:00:00.000Z', '2026-11-06T04:00:00.000Z']);
  r = A.blockRangeTz({ kind: 'day', from: '2026-12-24', to: '2026-12-26' }, 'America/Sao_Paulo', now);
  assert.deepEqual([r.starts, r.ends], ['2026-12-24T03:00:00.000Z', '2026-12-27T03:00:00.000Z']);
  r = A.blockRangeTz({ kind: 'part', from: '2026-11-05', start: '08:00', end: '12:00' }, 'America/Sao_Paulo', now);
  assert.deepEqual([r.starts, r.ends], ['2026-11-05T11:00:00.000Z', '2026-11-05T15:00:00.000Z']);
  assert.match(A.blockRangeTz({ kind: 'part', from: '2026-11-05', start: '12:00', end: '08:00' }, 'America/Sao_Paulo', now).errs.blEnd, /depois do início/);
  assert.match(A.blockRangeTz({ kind: 'day', from: '2026-11-05', to: '2026-11-04' }, 'America/Sao_Paulo', now).errs.blTo, /igual ou depois/);
  assert.match(A.blockRangeTz({ kind: 'day', from: '2026-11-05', to: '2027-11-05' }, 'America/Sao_Paulo', now).errs.blTo, /365 dias/);
  assert.equal(A.blockRangeTz({ kind: 'day', from: '2026-11-05', to: '2027-11-04' }, 'America/Sao_Paulo', now).starts, '2026-11-05T03:00:00.000Z');
  assert.match(A.blockRangeTz({ kind: 'day', from: '2026-11-01', to: '' }, 'America/Sao_Paulo', now).errs.blFrom, /já passou/);
  assert.match(A.blockRangeTz({ kind: 'part', from: '2026-11-04', start: '08:00', end: '09:00' }, 'America/Sao_Paulo', now).errs.blEnd, /já passou/);
  assert.match(A.blockRangeTz({ kind: 'day', from: '' }, 'America/Sao_Paulo', now).errs.blFrom, /Escolha o dia/);
  assert.equal(A.blockWhenTz({ starts_at: '2026-12-24T03:00:00Z', ends_at: '2026-12-27T03:00:00Z' }, 'America/Sao_Paulo'), 'qui., 24/12 até sáb., 26/12 (dias inteiros)');
  assert.equal(A.blockWhenTz({ starts_at: '2026-11-05T11:00:00Z', ends_at: '2026-11-05T15:00:00Z' }, 'America/Sao_Paulo'), 'qui., 05/11, das 08:00 às 12:00');
  // dia inteiro que começa HOJE: começa agora (de 5 em 5 minutos, para baixo), não às 00:00 (operacao-3)
  const t1502 = Date.parse('2026-11-04T18:02:30Z'); // 15:02 em São Paulo
  r = A.blockRangeTz({ kind: 'day', from: '2026-11-04', to: '' }, 'America/Sao_Paulo', t1502);
  assert.deepEqual([r.starts, r.ends, r.fromNow], ['2026-11-04T18:00:00.000Z', '2026-11-05T03:00:00.000Z', true]);
  r = A.blockRangeTz({ kind: 'day', from: '2026-11-04', to: '2026-11-06' }, 'America/Sao_Paulo', t1502);
  assert.deepEqual([r.starts, r.ends, r.fromNow], ['2026-11-04T18:00:00.000Z', '2026-11-07T03:00:00.000Z', true]);
  r = A.blockRangeTz({ kind: 'day', from: '2026-11-03', to: '2026-11-05' }, 'America/Sao_Paulo', t1502);
  assert.equal(r.starts, '2026-11-04T18:00:00.000Z', 'primeiro dia que já passou: também começa agora');
  assert.equal(A.blockRangeTz({ kind: 'day', from: '2026-11-05' }, 'America/Sao_Paulo', t1502).fromNow, false, 'amanhã: dia inteiro de verdade');
  r = A.blockRangeTz({ kind: 'part', from: '2026-11-04', start: '08:00', end: '18:00' }, 'America/Sao_Paulo', t1502);
  assert.deepEqual([r.starts, r.fromNow], ['2026-11-04T11:00:00.000Z', false], 'algumas horas: o que foi digitado (o banco não mexe no que já começou)');
  assert.equal(A.blockWhenTz({ starts_at: '2026-11-04T18:00:00Z', ends_at: '2026-11-05T03:00:00Z' }, 'America/Sao_Paulo'), 'qua., 04/11, das 15:00 até o fim do dia');
  assert.equal(A.blockWhenTz({ starts_at: '2026-11-04T18:00:00Z', ends_at: '2026-11-07T03:00:00Z' }, 'America/Sao_Paulo'), 'qua., 04/11 às 15:00 até sex., 06/11 (fim do dia)');
  assert.equal(A.blockWhenTz({ starts_at: '2026-11-04T18:00:00Z', ends_at: '2026-11-05T13:00:00Z' }, 'America/Sao_Paulo'), 'qua., 04/11 15:00 até qui., 05/11 10:00');
  // o mesmo bloqueio (prévia e "mesmo assim"): alvo, início, fim e tipo; o motivo não conta (operacao-2)
  const g = { p_resource: 'r1', p_kind: 'manutencao', p_starts: '2026-11-05T11:00:00.000Z', p_ends: '2026-11-05T15:00:00.000Z', p_reason: 'a' };
  assert.equal(A.sameBlock(g, { ...g, p_reason: 'b', p_starts: '2026-11-05T11:00:00Z' }), true);
  assert.equal(A.sameBlock(g, { ...g, p_ends: '2026-11-05T12:30:00.000Z' }), false, 'outro fim');
  assert.equal(A.sameBlock(g, { ...g, p_resource: null }), false, 'outro alvo');
  assert.equal(A.sameBlock(g, { ...g, p_kind: 'folga' }), false, 'outro tipo');
  assert.equal(A.sameBlock(g, null), false);
});

test('bloqueio com gente no período: pacientes contados por agendamento, "só ocupar" sem falar de paciente', () => {
  const ag = (req, item) => ({ kind: 'agendamento', request_id: req, item_id: item });
  const oc = { kind: 'ocupado', busy_id: 'b1' };
  // só "só ocupar": nada de "0 agendamentos" nem de pacientes
  assert.equal(A.actionText('confirm_required', { items: [oc] }), 'Este bloqueio atinge 1 horário “só ocupar”.');
  assert.equal(A.blockForceHelp([oc]), 'Se bloquear mesmo assim, o horário “só ocupar” do período será retirado. Nenhum paciente é atingido.');
  assert.equal(A.blockForceHelp([oc, { ...oc, busy_id: 'b2' }]), 'Se bloquear mesmo assim, os horários “só ocupar” do período serão retirados. Nenhum paciente é atingido.');
  // um paciente com 2 exames é 1 agendamento (2 exames), 1 paciente
  assert.equal(A.actionText('confirm_required', { items: [ag('r1', 'i1'), ag('r1', 'i2')] }), 'Este bloqueio atinge 1 agendamento (2 exames).');
  assert.match(A.blockForceHelp([ag('r1', 'i1'), ag('r1', 'i2')]), /^Se bloquear mesmo assim, esse paciente vai para a lista Para remarcar e a clínica precisa avisá-lo\.$/);
  assert.match(A.blockForceHelp([ag('r1', 'i1'), ag('r2', 'i2'), oc]), /esses pacientes vão .* avisá-los\. O horário “só ocupar” do período será retirado\.$/);
  // sem "mesmo assim": o motivo certo
  assert.match(A.blockRefusedText({ items: [], busy: 1 }), /^Há um horário “só ocupar” nesse período\. Retire esse horário na agenda antes de bloquear\.$/);
  assert.doesNotMatch(A.blockRefusedText({ items: [], busy: 2 }), /paciente/);
  assert.match(A.blockRefusedText({ items: [{ item_id: 'i1', request_id: 'r1' }], busy: 0 }), /^Há pacientes marcados nesse período\./);
  assert.match(A.blockRefusedText({ items: [{ item_id: 'i1', request_id: 'r1' }], busy: 1 }), /pacientes marcados e horários “só ocupar”/);
  assert.doesNotMatch(A.blockRefusedText({ items: [], busy: 0 }), /pacientes marcados/);
  // depois de gravar
  assert.equal(A.blockDoneText({ moved: 0, busy: 1 }), 'Bloqueio salvo. 1 horário “só ocupar” foi retirado. Nesse período nenhum horário é oferecido.');
  assert.equal(A.blockDoneText({ moved: 0 }), 'Bloqueio salvo. Nesse período nenhum horário é oferecido.');
  assert.equal(A.blockDoneText({ moved: 2, pedidos: 1 }), 'Bloqueio salvo. 1 paciente foi para a lista Para remarcar.');
  assert.equal(A.blockDoneText({ moved: 2, busy: 2 }), 'Bloqueio salvo. 2 pacientes foram para a lista Para remarcar. 2 horários “só ocupar” foram retirados.');
  assert.match(A.blockDoneText({ moved: null, replay: true }), /já tinha sido salvo\. Se havia pacientes/);
});

test('cancelar no painel: "o horário fica livre" só quando o item ainda segura o horário e não começou', () => {
  const now = Date.parse('2026-11-04T15:00:00Z');
  const base = { patient: 'Maria L.', procedure: 'Ultrassom', starts_at: '2026-11-05T12:00:00.000Z', status: 'confirmed', resources: [{ id: 'u', name: 'USG' }] };
  assert.equal(A.cancelItemAsk(base, { now }), 'Cancelar o agendamento de Maria L. (qui., 05/11 às 09:00)? O horário fica livre para outro paciente.');
  // veio do "Bloquear mesmo assim": o horário já foi solto e o período está bloqueado
  const rem = A.cancelItemAsk({ ...base, status: 'reschedule_requested', resources: [] }, { now });
  assert.equal(rem, 'Cancelar o agendamento de Maria L. (qui., 05/11 às 09:00)? O paciente sai da lista Para remarcar.');
  assert.doesNotMatch(A.cancelItemAsk({ ...base, status: 'reschedule_requested' }, { now }), /livre/);
  assert.doesNotMatch(A.cancelItemAsk({ ...base, resources: [] }, { now }), /livre/, 'sem aparelho/sala reservado');
  assert.doesNotMatch(A.cancelItemAsk(base, { now: Date.parse('2026-11-05T13:00:00Z') }), /livre/, 'já começou');
  assert.match(A.cancelItemAsk(base, { now, pacote: true }), /^Cancelar o exame Ultrassom de Maria L\. .*Só este exame: os outros do agendamento continuam marcados\. O horário fica livre/);
});

test('respostas das funções da agenda: todo status tem texto; chave de reenvio nova só com resposta do banco', () => {
  const fs = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => /agenda_(operacao_parte_2|painel_parte_1|leitura_parte_1|motor_parte_2)/.test(f));
  assert.equal(fs.length, 4);
  const cods = new Set(fs.flatMap((f) => [...ler(`supabase/migrations/${f}`).matchAll(/jsonb_build_object\('status', '([a-z_]+)'/g)].map((m) => m[1])));
  // fora da tela da agenda: a configuração (4.1), a venda do site (5.1) e o "ok"
  for (const c of ['ok', 'affects_appointments', 'old_schedule_exists', 'too_many_bookings']) cods.delete(c);
  assert.deepEqual([...cods].filter((c) => !A.ACTION_TEXT[c]), [], 'status sem texto');
  assert.match(A.actionText('transition_not_allowed', { from: 'no_show' }), /“Não compareceu”/);
  assert.match(A.actionText('too_early', { hint: 'Chegada a partir das 07:00' }), /^Ainda não dá: chegada a partir das 07:00\.$/);
  assert.equal(A.actionText('confirm_required', { items: [{ kind: 'agendamento' }, { kind: 'agendamento' }, { kind: 'ocupado' }] }), 'Este bloqueio atinge 2 agendamentos e 1 horário “só ocupar”.');
  assert.match(A.actionText('invalid_patient', { message: 'Informe o nome de quem vai fazer o exame' }), /Informe o nome de quem vai fazer o exame/);
  assert.match(A.actionText('agenda_not_started', { canConfig: true }), /Ative em Configurar agenda/);
  assert.equal(A.actionText('nunca_visto'), A.ACTION_TEXT.invalid);
  assert.equal(A.needsNewKey(undefined), false, 'sem resposta (rede): a mesma chave');
  assert.equal(A.needsNewKey('network'), false);
  for (const s of ['slot_taken', 'version_conflict', 'idempotency_conflict', 'invalid']) assert.equal(A.needsNewKey(s), true, s);
});

test('histórico em texto simples (só códigos vêm do banco)', () => {
  const h = { at: '2026-11-04T13:02:00Z', item_seq: null, from: 'confirmed', to: 'checked_in', actor_kind: 'clinica', actor_role: 'reception', origin: 'painel', reason_code: null };
  assert.equal(A.historyLine(h, 'America/Sao_Paulo'), 'qua., 04/11 10:02 · Confirmado → Paciente presente · Recepção, pelo painel');
  assert.equal(A.historyLine({ ...h, from: null, to: 'confirmed', actor_kind: 'paciente', actor_role: null, origin: 'app' }, 'America/Sao_Paulo'),
    'qua., 04/11 10:02 · Criado: Confirmado · Paciente, pelo site');
  assert.match(A.historyLine({ ...h, to: 'reschedule_requested', actor_role: 'imed_operacao', origin: 'central', reason_code: 'bloqueio_forcado' }), /Equipe do IMED, pela central do IMED · Motivo: Horário bloqueado pela clínica$/);
  assert.match(A.historyLine({ ...h, reason_code: 'codigo_novo' }), /Motivo registrado: codigo_novo$/);
  assert.match(A.historyLine({ ...h, actor_kind: 'sql', actor_role: null, origin: 'sql' }), /Correção feita pela equipe técnica do IMED, correção manual/);
  assert.equal(A.shortName('Maria Souza Lima'), 'Maria L.');
  assert.equal(A.shortName(' Ana '), 'Ana');
  assert.equal(A.monthSummary({ ativos: 3, concluidos: 1, faltas: 1, cancelados: 2, bloqueios: 1 }), '3 marcados · 1 concluído · 1 falta · 1 bloqueio');
  assert.equal(A.monthSummary({ ativos: 0, concluidos: 0, faltas: 0, cancelados: 0, bloqueios: 0 }), '');
});

test('revisão 4.3: "Precisa de atenção" diz quando o número é só dos 100 pedidos mais novos; período do Resumo', async () => {
  const A = await import('../assets/js/agenda-core.js');
  const so = (o) => A.attentionItems(o).find((x) => x.key === 'pedidos')?.text;
  assert.equal(so({ pendentes: 12 }), '12 pedidos de agendamento sem resposta.');
  assert.equal(so({ pendentes: 1 }), '1 pedido de agendamento sem resposta.');
  assert.equal(so({ pendentes: 100, pendentesMais: true }), '100 pedidos de agendamento sem resposta entre os 100 mais recentes (pode haver mais na aba Pedidos).');
  assert.equal(so({ pendentes: 0, pendentesMais: true }), undefined);
  // "Esta semana" e "Este mês" a partir do dia que a tela passa (o Resumo passa sempre hoje)
  assert.deepEqual(A.periodRange('semana', '2026-11-04', '2026-11-04'), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepEqual(A.periodRange('mes', '2026-11-04', '2026-11-04'), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(A.periodRange('hoje', '2026-11-20', '2026-11-04'), { from: '2026-11-04', to: '2026-11-04' });
  assert.deepEqual(A.periodRange('30d', '2026-11-20', '2026-11-04'), { from: '2026-10-06', to: '2026-11-04' });
  assert.ok(A.periodRange('custom', '', '2026-11-04', { from: '2026-11-10', to: '2026-11-01' }).error);
});
