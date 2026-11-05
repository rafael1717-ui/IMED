// Regras puras do painel da agenda da clínica (iMed Agenda, fase 4.1: equipe e cadastros). Sem tela e sem rede:
// testadas em tests/agenda-core.test.mjs. A tela fica em agenda-config.js; o banco confere tudo de novo (estas regras
// só evitam ida e volta e explicam o erro em linguagem simples).
import { EXAMS } from './geo-core.js';

export const EXAM_CODES = ['rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab'];
export const examLabel = (code) => EXAMS[code]?.n || code || '';

// ---------- papéis e permissões ----------
export const ROLES = ['owner', 'manager', 'reception', 'professional', 'finance'];
export const ROLE_LABEL = {
  owner: 'Dono(a)', manager: 'Gestor(a)', reception: 'Recepção', professional: 'Profissional', finance: 'Financeiro', staff: 'Recepção',
};
export const ROLE_HELP = {
  owner: 'Faz tudo, inclusive mudar a equipe inteira e a integração com outro sistema.',
  manager: 'Faz tudo na clínica, menos mexer em quem é dono(a) e na integração.',
  reception: 'Vê os pedidos e cuida dos agendamentos e bloqueios. Não muda preços nem a configuração.',
  professional: 'Vê só a própria agenda, sem o telefone dos pacientes.',
  finance: 'Vê só os números do financeiro, sem o nome dos pacientes.',
};
// Espelho de agenda.role_permissions (migração da fundação, parte 5). Só serve quando o banco ainda não responde
// agenda_me (troca de versão): o que vale é sempre a lista que o banco devolve.
const ALL = ['pedidos.ver', 'agenda.ver', 'agenda.pacientes', 'agenda.marcar', 'agenda.cancelar', 'agenda.remarcar', 'agenda.atender',
  'agenda.bloquear', 'agenda.configurar', 'precos.editar', 'clinica.editar', 'financeiro.ver', 'auditoria.ver', 'conflitos.resolver'];
const RECEPCAO = ['pedidos.ver', 'agenda.ver', 'agenda.pacientes', 'agenda.marcar', 'agenda.cancelar', 'agenda.remarcar', 'agenda.atender',
  'agenda.bloquear', 'conflitos.resolver'];
const scope = (list, s = 'clinica') => Object.fromEntries(list.map((p) => [p, s]));
export const ROLE_PERMS = {
  owner: { ...scope(ALL), 'equipe.gerenciar': 'clinica', 'integracao.gerenciar': 'clinica' },
  manager: { ...scope(ALL), 'equipe.gerenciar': 'sem_donos' },
  reception: scope(RECEPCAO),
  staff: scope(RECEPCAO),
  professional: scope(['agenda.ver', 'agenda.pacientes', 'agenda.atender'], 'propria'),
  finance: scope(['financeiro.ver']),
};
export const permsOf = (role) => ({ ...(ROLE_PERMS[role] || {}) });
export const can = (perms, p) => !!perms && Object.prototype.hasOwnProperty.call(perms, p);

// Abas da clínica pelo que a pessoa pode fazer, em ordem fixa (fase 4.2: "Agenda" é a agenda de verdade, para quem vê
// a agenda, inclusive o profissional; a configuração da 4.1 fica em "Configurar agenda"). A equipe do IMED vê todas.
export const TAB_LABEL = { pedidos: 'Pedidos', agenda: 'Agenda', config: 'Configurar agenda', dados: 'Dados da clínica', exames: 'Exames e preços', equipe: 'Equipe' };
export function clinicTabs(perms, admin = false) {
  const p = admin ? { ...ROLE_PERMS.owner } : perms || {};
  const t = [];
  if (can(p, 'pedidos.ver')) t.push('pedidos');
  if (can(p, 'agenda.ver')) t.push('agenda');
  if (can(p, 'agenda.configurar')) t.push('config');
  if (can(p, 'clinica.editar')) t.push('dados');
  if (can(p, 'precos.editar')) t.push('exames');
  if (can(p, 'equipe.gerenciar')) t.push('equipe');
  return t;
}
// Aba aberta ao entrar: a Agenda, se a clínica está com a agenda nova ativa e a pessoa tem a aba; senão, a primeira.
export const defaultTab = (tabs, agendaActive = false) => (agendaActive && tabs.includes('agenda') ? 'agenda' : tabs[0] ?? null);

// Quem pode convidar ou mudar para este papel: o dono, todos; o gestor, todos menos dono (o banco confere de novo).
export const rolesICanGive = (perms, admin = false) => {
  if (admin) return [...ROLES];
  const s = perms?.['equipe.gerenciar'];
  return s === 'clinica' ? [...ROLES] : s === 'sem_donos' ? ROLES.filter((r) => r !== 'owner') : [];
};
export const canManageMember = (perms, admin, memberRole) => rolesICanGive(perms, admin).includes(memberRole === 'staff' ? 'reception' : memberRole);

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function inviteErrors(email, role, allowed = ROLES) {
  const e = {};
  const v = String(email || '').trim().toLowerCase();
  if (v.length < 6 || v.length > 254 || !EMAIL_RE.test(v)) e.email = 'Digite um e-mail válido, como nome@clinica.com.br.';
  if (!ROLES.includes(role)) e.role = 'Escolha o papel da pessoa.';
  else if (!allowed.includes(role)) e.role = 'Sua conta não pode dar este papel.';
  return e;
}

// ---------- modalidade ----------
export const MODES = ['pedido', 'nativa', 'manual', 'externa'];
export const MODE_LABEL = {
  pedido: 'Pedido (a clínica liga para combinar)',
  nativa: 'Agenda no IMED',
  manual: 'Agenda no IMED, com registro manual',
  externa: 'Sistema da própria clínica',
};
export const MODE_HELP = {
  pedido: 'O paciente envia um pedido e a clínica (ou o IMED) liga para combinar o horário. É o jeito de hoje.',
  nativa: 'A agenda da clínica fica no IMED: tudo o que for marcado, por telefone, balcão ou site, entra aqui.',
  manual: 'A clínica usa outro caderno ou sistema, mas registra cada agendamento no IMED antes de confirmar ao paciente.',
  externa: 'Ligação com o sistema de agenda da clínica. Ainda não disponível: depende de cada sistema.',
};
export const COMMITMENT_TEXT = 'Nós nos comprometemos a registrar no painel do IMED todo agendamento feito por telefone, balcão ou outro sistema, antes de confirmar ao paciente.';

// ---------- fuso ----------
export const TIMEZONES = [
  ['America/Sao_Paulo', 'Horário de Brasília (SP, RJ, MG, ES, PR, SC, RS, GO, DF)'],
  ['America/Bahia', 'Horário de Brasília (Bahia)'],
  ['America/Fortaleza', 'Horário de Brasília (CE, RN, PB, PI, MA)'],
  ['America/Recife', 'Horário de Brasília (Pernambuco)'],
  ['America/Maceio', 'Horário de Brasília (Alagoas e Sergipe)'],
  ['America/Belem', 'Horário de Brasília (Pará leste e Amapá)'],
  ['America/Araguaina', 'Horário de Brasília (Tocantins)'],
  ['America/Santarem', 'Horário de Brasília (Pará oeste)'],
  ['America/Cuiaba', 'Uma hora a menos que Brasília (Mato Grosso)'],
  ['America/Campo_Grande', 'Uma hora a menos que Brasília (Mato Grosso do Sul)'],
  ['America/Manaus', 'Uma hora a menos que Brasília (Amazonas)'],
  ['America/Porto_Velho', 'Uma hora a menos que Brasília (Rondônia)'],
  ['America/Boa_Vista', 'Uma hora a menos que Brasília (Roraima)'],
  ['America/Rio_Branco', 'Duas horas a menos que Brasília (Acre)'],
  ['America/Eirunepe', 'Duas horas a menos que Brasília (oeste do Amazonas)'],
  ['America/Noronha', 'Uma hora a mais que Brasília (Fernando de Noronha)'],
];
export const tzLabel = (tz) => TIMEZONES.find(([k]) => k === tz)?.[1] || tz || '';

// ---------- números e textos ----------
export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const toMin = (t) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(t || ''));
  if (!m) return NaN;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return NaN;
  return h * 60 + mi;
};
export const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export function fmtMinutes(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  if (v < 60) return `${v} min`;
  const h = Math.floor(v / 60); const m = v % 60;
  if (v % 1440 === 0) return `${v / 1440} ${v === 1440 ? 'dia' : 'dias'}`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
export const KIND_LABEL = { equipamento: 'Aparelho', sala: 'Sala', profissional: 'Profissional', chegadas: 'Vagas por horário' };
export const KIND_PLURAL = { equipamento: 'aparelhos', sala: 'salas', profissional: 'profissionais', chegadas: 'vagas por horário' };
export const KINDS = ['equipamento', 'sala', 'profissional'];
export const COUNCILS = ['CRM', 'CRBM', 'CRF', 'CRBio', 'CRO', 'COREN', 'CRTR', 'outro'];

// Inteiro dentro dos limites (ou null quando vazio e opcional).
export function intIn(v, min, max, { mult = 1, optional = false } = {}) {
  const s = String(v ?? '').trim();
  if (!s) return optional ? { ok: true, value: null } : { ok: false };
  if (!/^\d+$/.test(s)) return { ok: false };
  const n = Number(s);
  return n >= min && n <= max && n % mult === 0 ? { ok: true, value: n } : { ok: false };
}

// ---------- configuração rápida ----------
// input: { timezone, confirmTz, days: [0..6], open, close, pauseFrom, pauseTo, exams: [{ exam_code, name, duration, count, kind }] }
// Cada exame: "quantos aparelhos (ou salas) e quanto dura". Cria recursos e procedimentos de verdade.
export function quickErrors(input) {
  const e = {};
  if (!TIMEZONES.some(([k]) => k === input.timezone)) e.timezone = 'Escolha o fuso da clínica.';
  if (!input.confirmTz) e.confirmTz = 'Confirme o fuso: os horários dos pacientes dependem dele.';
  if (!Array.isArray(input.days) || !input.days.length) e.days = 'Marque pelo menos um dia de atendimento.';
  const o = toMin(input.open); const c = toMin(input.close);
  if (Number.isNaN(o)) e.open = 'Escolha a hora em que a clínica abre.';
  else if (o % 5) e.open = 'Use horários de 5 em 5 minutos.';
  if (Number.isNaN(c)) e.close = 'Escolha a hora em que a clínica fecha.';
  else if (c % 5) e.close = 'Use horários de 5 em 5 minutos.';
  else if (!e.open && c <= o) e.close = 'A hora de fechar precisa ser depois da hora de abrir.';
  const pf = String(input.pauseFrom || ''); const pt = String(input.pauseTo || '');
  if (pf || pt) {
    const a = toMin(pf); const b = toMin(pt);
    if (Number.isNaN(a) || Number.isNaN(b)) e.pause = 'Preencha o começo e o fim da pausa, ou deixe os dois em branco.';
    else if (a % 5 || b % 5) e.pause = 'Use horários de 5 em 5 minutos.';
    else if (b <= a) e.pause = 'O fim da pausa precisa ser depois do começo.';
    else if (!e.open && !e.close && (a <= o || b >= c)) e.pause = 'A pausa precisa ficar dentro do horário de atendimento.';
  }
  const ex = Array.isArray(input.exams) ? input.exams : [];
  if (!ex.length) e.exams = 'Inclua pelo menos um exame.';
  const names = new Set();
  ex.forEach((x, i) => {
    const k = `ex${i}`;
    const name = String(x.name || '').trim();
    if (!EXAM_CODES.includes(x.exam_code)) e[`${k}code`] = 'Escolha o tipo de exame.';
    if (name.length < 2 || name.length > 120) e[`${k}name`] = 'Dê um nome ao exame (de 2 a 120 letras).';
    else if (names.has(name.toLowerCase())) e[`${k}name`] = 'Já existe um exame com este nome. Use nomes diferentes.';
    names.add(name.toLowerCase());
    if (!intIn(x.duration, 5, 480, { mult: 5 }).ok) e[`${k}dur`] = 'Informe quanto dura o exame, de 5 a 480 minutos, de 5 em 5.';
    if (!intIn(x.count, 1, 20).ok) e[`${k}count`] = 'Informe quantos (de 1 a 20).';
    if (!['equipamento', 'sala', 'profissional'].includes(x.kind)) e[`${k}kind`] = 'Escolha se o exame usa aparelho, sala ou profissional.';
  });
  return e;
}

// O plano que a tela manda ao banco, na ordem: unidade, recursos, procedimentos (com os recursos criados) e regras.
export function quickPlan(input) {
  const resources = [];
  const procedures = [];
  input.exams.forEach((x, i) => {
    const n = Number(x.count);
    const base = String(x.name).trim();
    const keys = [];
    for (let j = 1; j <= n; j++) {
      const key = `e${i}r${j}`;
      const label = `${KIND_LABEL[x.kind]} de ${base}`.slice(0, 76);
      resources.push({ key, kind: x.kind, name: n > 1 ? `${label} ${j}` : label });
      keys.push(key);
    }
    procedures.push({ exam_code: x.exam_code, name: base, duration_min: Number(x.duration), kind: x.kind, resourceKeys: keys });
  });
  const days = [...new Set(input.days.map(Number))].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const rules = days.map((weekday) => ({ weekday, start: input.open, end: input.close, kind: 'abre' }));
  if (input.pauseFrom && input.pauseTo) days.forEach((weekday) => rules.push({ weekday, start: input.pauseFrom, end: input.pauseTo, kind: 'pausa', label: 'Pausa' }));
  return { unit: { timezone: input.timezone, confirm_timezone: true }, resources, procedures, rules };
}

// Requisito do procedimento com os ids dos recursos criados.
export const requirementFor = (kind, ids) => [{ resource_kind: kind, options: ids.map((resource_id) => ({ resource_id })) }];

// ---------- horários de funcionamento (regras da unidade) ----------
// Semana na tela: { [weekday]: { open: [{start,end}], pause: [{start,end,label}] } }. Regras com validade ou só para
// alguns exames (feitas por outro caminho) ficam guardadas em "keep" e voltam iguais ao salvar.
export function weekFromRules(rules) {
  const week = Object.fromEntries(WEEK_ORDER.map((d) => [d, { open: [], pause: [] }]));
  const keep = [];
  for (const r of rules || []) {
    if (r.resource_id) continue;
    const special = r.valid_from || r.valid_to || (Array.isArray(r.procedure_ids) && r.procedure_ids.length);
    if (special || !week[r.weekday]) { keep.push(r); continue; }
    week[r.weekday][r.kind === 'pausa' ? 'pause' : 'open'].push({ start: r.start, end: r.end, ...(r.kind === 'pausa' ? { label: r.label || '' } : {}) });
  }
  for (const d of WEEK_ORDER) for (const k of ['open', 'pause']) week[d][k].sort((a, b) => toMin(a.start) - toMin(b.start));
  return { week, keep };
}

export function weekErrors(week) {
  const e = {};
  let total = 0;
  for (const d of WEEK_ORDER) {
    for (const k of ['open', 'pause']) {
      const list = week[d]?.[k] || [];
      total += list.length;
      list.forEach((x, i) => {
        const s = toMin(x.start); const f = toMin(x.end);
        const key = `${d}-${k}-${i}`;
        if (Number.isNaN(s) || Number.isNaN(f)) e[key] = 'Preencha o começo e o fim.';
        else if (s % 5 || f % 5) e[key] = 'Use horários de 5 em 5 minutos.';
        else if (f <= s) e[key] = 'O fim precisa ser depois do começo.';
        else {
          const j = list.findIndex((y, n) => n < i && toMin(y.start) < f && s < toMin(y.end));
          if (j >= 0) e[key] = `Cruza com ${list[j].start} às ${list[j].end}. Junte os dois ou mude o horário.`;
        }
      });
    }
    if ((week[d]?.pause || []).length && !(week[d]?.open || []).length) e[`${d}-pause-0`] ||= 'Pausa num dia sem horário de atendimento.';
  }
  if (total > 200) e._all = 'Use até 200 linhas de horário.';
  return e;
}

export function rulesFromWeek(week, keep = []) {
  const out = [];
  for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    for (const x of week[d]?.open || []) out.push({ weekday: d, start: x.start, end: x.end, kind: 'abre' });
    for (const x of week[d]?.pause || []) out.push({ weekday: d, start: x.start, end: x.end, kind: 'pausa', ...(String(x.label || '').trim() ? { label: String(x.label).trim().slice(0, 60) } : {}) });
  }
  for (const r of keep) {
    const o = { weekday: r.weekday, start: r.start, end: r.end, kind: r.kind };
    if (r.valid_from) o.valid_from = r.valid_from;
    if (r.valid_to) o.valid_to = r.valid_to;
    if (r.label) o.label = r.label;
    if (r.procedure_ids?.length) o.procedure_ids = r.procedure_ids;
    out.push(o);
  }
  return out;
}

export const copyMonday = (week) => {
  const w = structuredClone(week);
  for (const d of [2, 3, 4, 5]) w[d] = structuredClone(week[1]);
  return w;
};

export function weekSummary(week) {
  const parts = [];
  for (const d of WEEK_ORDER) {
    const o = week[d]?.open || [];
    if (!o.length) continue;
    parts.push(`${WEEKDAYS[d]}: ${o.map((x) => `${x.start} às ${x.end}`).join(' e ')}`);
  }
  return parts.length ? parts.join('; ') : 'Nenhum horário de atendimento';
}

// ---------- recursos e procedimentos ----------
export function resourceErrors(r, { isNew = true } = {}) {
  const e = {};
  const name = String(r.name || '').trim();
  if (isNew && !KINDS.includes(r.kind)) e.kind = 'Escolha o tipo.';
  if (name.length < 2 || name.length > 80) e.name = 'Dê um nome (de 2 a 80 letras), como “Ultrassom da sala 2”.';
  if (!intIn(r.capacity, 1, 50).ok) e.capacity = 'De 1 a 50 pacientes ao mesmo tempo.';
  if (!intIn(r.setup_min, 0, 240, { mult: 5 }).ok) e.setup_min = 'De 0 a 240 minutos, de 5 em 5.';
  if (!intIn(r.cleanup_min, 0, 240, { mult: 5 }).ok) e.cleanup_min = 'De 0 a 240 minutos, de 5 em 5.';
  if (r.council_number && String(r.council_number).trim().length > 20) e.council_number = 'Até 20 caracteres.';
  return e;
}
export function resourcePayload(r, { isNew = true } = {}) {
  const o = {
    name: String(r.name).trim(), capacity: Number(r.capacity), setup_min: Number(r.setup_min || 0), cleanup_min: Number(r.cleanup_min || 0),
    active: r.active !== false,
  };
  if (isNew) o.kind = r.kind; else o.id = r.id;
  if (r.kind === 'profissional' || r.member_user_id || r.council) {
    o.member_user_id = r.member_user_id || null;
    o.council = r.council || null;
    o.council_number = String(r.council_number || '').trim() || null;
  }
  return o;
}

// Preço digitado ("350,00", "R$ 1.200") → centavos (null = sob consulta; NaN = inválido).
export function priceCents(v) {
  const s = String(v ?? '').replace(/R\$|\s/g, '');
  if (!s) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return NaN;
  const n = Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100);
  return n >= 100 && n <= 10000000 ? n : NaN;
}
export const centsText = (c) => (c == null ? 'sob consulta' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100));

// groups: [{ resource_kind, options: [resource_id] }]
export function procedureErrors(p, resources = []) {
  const e = {};
  const name = String(p.name || '').trim();
  if (!EXAM_CODES.includes(p.exam_code)) e.exam_code = 'Escolha o tipo de exame.';
  if (name.length < 2 || name.length > 120) e.name = 'Dê um nome ao exame (de 2 a 120 letras).';
  if (!intIn(p.duration_min, 5, 480, { mult: 5 }).ok) e.duration_min = 'Informe quanto dura, de 5 a 480 minutos, de 5 em 5.';
  const price = priceCents(p.price);
  if (Number.isNaN(price)) e.price = 'Preço inválido. Use só números, como 180,00, ou deixe em branco para “sob consulta”.';
  if (!intIn(p.fasting_hours, 0, 24, { optional: true }).ok) e.fasting_hours = 'De 0 a 24 horas, ou em branco.';
  if (String(p.patient_prep_text || '').length > 600) e.patient_prep_text = 'Use até 600 letras.';
  const groups = Array.isArray(p.groups) ? p.groups : [];
  if (!groups.length) e.groups = 'Escolha o que o exame usa (aparelho, sala ou profissional).';
  if (groups.length > 5) e.groups = 'Use até 5 grupos.';
  const used = new Set();
  groups.forEach((g, i) => {
    const ok = (g.options || []).filter((id) => resources.some((r) => r.id === id && r.kind === g.resource_kind));
    if (!ok.length) e[`g${i}`] = `Marque pelo menos um ${KIND_LABEL[g.resource_kind]?.toLowerCase() || 'item'} deste grupo.`;
    for (const id of g.options || []) { if (used.has(id)) e[`g${i}`] = 'O mesmo item não pode estar em dois grupos.'; used.add(id); }
  });
  return e;
}
export function procedurePayload(p, { isNew = true, priceConfirmed = false } = {}) {
  const o = {
    exam_code: p.exam_code, name: String(p.name).trim(), duration_min: Number(p.duration_min), price_cents: priceCents(p.price),
    patient_prep_text: String(p.patient_prep_text || '').trim() || null,
    fasting_hours: String(p.fasting_hours ?? '').trim() === '' ? null : Number(p.fasting_hours),
    online_booking: p.online_booking !== false, active: p.active !== false,
    requirements: (p.groups || []).map((g) => ({ resource_kind: g.resource_kind, options: g.options.map((resource_id) => ({ resource_id })) })),
  };
  if (!isNew) o.id = p.id;
  if (priceConfirmed && o.price_cents != null) o.price_confirmed = true;
  return o;
}
// Preço acima do limite largo do exame (o mesmo do painel antigo, L11): pede confirmação antes de salvar.
export const PRICE_CHECK_CENTS = { rx: 500000, usg: 500000, tc: 1000000, rm: 2000000, mamo: 500000, dens: 500000, ecg: 500000, eco: 500000, lab: 500000 };
export const priceNeedsCheck = (code, cents) => Number.isFinite(cents) && cents > (PRICE_CHECK_CENTS[code] ?? Infinity);

// ---------- unidade ----------
export const STEP_OPTIONS = [5, 10, 15, 20, 30, 60];
export function unitErrors(u) {
  const e = {};
  if (!STEP_OPTIONS.includes(Number(u.step_min))) e.step_min = 'Escolha de quanto em quanto tempo os horários começam.';
  if (!intIn(u.min_notice_h, 0, 168).ok) e.min_notice_h = 'De 0 a 168 horas.';
  if (!intIn(u.max_advance_days, 1, 365).ok) e.max_advance_days = 'De 1 a 365 dias.';
  if (u.holidays_checked_until && !/^\d{4}-\d{2}-\d{2}$/.test(u.holidays_checked_until)) e.holidays_checked_until = 'Data inválida.';
  return e;
}
export const unitPayload = (u) => ({
  step_min: Number(u.step_min), min_notice_min: Number(u.min_notice_h) * 60, max_advance_days: Number(u.max_advance_days),
  holidays_checked_until: u.holidays_checked_until || null, closes_on_holidays: !!u.closes_on_holidays,
});

// ---------- respostas do banco em linguagem simples ----------
export const STATUS_TEXT = {
  forbidden: 'Sua conta não pode fazer isto nesta clínica.',
  not_found: 'Não encontramos este item. Atualize a página.',
  invalid: 'Algum dado não está no formato aceito. Confira os campos.',
  agenda_not_started: 'A agenda desta clínica ainda não foi ativada. Use a configuração rápida primeiro.',
  old_schedule_exists: 'Esta clínica ainda tem horários do editor antigo. Fale com o IMED para apagá-los antes de ativar a agenda nova.',
  online_active: 'Com a marcação pelo site ligada, isto não pode mudar. Fale com o IMED.',
  has_appointments: 'Há pacientes marcados que dependem disto. Remarque ou cancele esses agendamentos antes.',
  duplicate_name: 'Já existe um item com este nome. Use outro nome.',
  default_exists: 'Já existe um exame padrão deste tipo.',
  resource_in_two_groups: 'O mesmo item não pode estar em dois grupos do exame.',
  invalid_option: 'Algum item escolhido não serve para este grupo. Confira o tipo.',
  invalid_period: 'O período não é válido: confira o começo e o fim.',
  overlapping_rules: 'Dois horários do mesmo dia se cruzam. Junte os dois ou mude o horário.',
  invalid_reference: 'Algum item escolhido não existe mais. Atualize a página.',
  timezone_not_confirmed: 'Confirme o fuso da clínica antes de mudar a modalidade.',
  commitment_required: 'Para a modalidade com registro manual, marque o compromisso.',
  invalid_role: 'Escolha um papel válido.',
  invalid_email: 'Digite um e-mail válido.',
  already_member: 'Esta pessoa já faz parte da equipe.',
  last_owner: 'A clínica precisa ter pelo menos um(a) dono(a). Faça outra pessoa dona antes.',
  not_open: 'Este convite não está mais aberto.',
  expired: 'Este convite venceu. Peça um novo para a clínica.',
};
export const statusText = (s, fallback = 'Não foi possível salvar agora. Tente de novo em instantes.') => STATUS_TEXT[s] || fallback;
export const affectsText = (items) => {
  const n = Array.isArray(items) ? items.length : 0;
  return n === 1 ? '1 agendamento futuro deixaria de caber nesta mudança.' : `${n} agendamentos futuros deixariam de caber nesta mudança.`;
};

/* =====================================================================================================================
   FASE 4.2: agenda visual e recepção (a tela fica em agenda.js). Tudo no FUSO DA CLÍNICA, nunca o do aparelho.
   ===================================================================================================================== */

// ---------- fuso ----------
const fmtCache = new Map();
const fmt = (key, tz, opts) => {
  const k = `${key}|${tz}`;
  if (!fmtCache.has(k)) fmtCache.set(k, new Intl.DateTimeFormat(key.startsWith('pt') ? 'pt-BR' : 'en-CA', { timeZone: tz, ...opts }));
  return fmtCache.get(k);
};
// Minutos de diferença do fuso para UTC num instante (São Paulo hoje: -180).
export function tzOffsetMin(tz, ms = Date.now()) {
  const p = Object.fromEntries(fmt('en-off', tz, { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}
// Dia (AAAA-MM-DD) e hora (HH:MM) de um instante no fuso da clínica.
export const dayIn = (tz, ms = Date.now()) => fmt('en-day', tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
export function timeIn(tz, iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return fmt('pt-time', tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}
export const minutesIn = (tz, iso) => { const t = timeIn(tz, iso); return t ? toMin(t) : NaN; };
// Dia + hora local da clínica → instante (ISO), com a MESMA escolha do Postgres ((data + hora) at time zone fuso):
// hora que não existe (começo do horário de verão) usa o fuso de antes da troca (vira o próximo instante que existe);
// hora repetida (fim do horário de verão) usa o de depois (a segunda vez). Conferido com supabase/tests/205_fuso.sql.
export function localToUtc(day, hhmm, tz) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  const m = toMin(hhmm);
  if (!d || Number.isNaN(m)) return null;
  const local = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), 0, m);
  const antes = tzOffsetMin(tz, local - 86400000);
  const depois = tzOffsetMin(tz, local + 86400000);
  const c1 = local - antes * 60000;
  const c2 = local - depois * 60000;
  const v1 = tzOffsetMin(tz, c1) === antes;
  const v2 = tzOffsetMin(tz, c2) === depois;
  const t = antes === depois ? c1 : v1 && v2 ? c2 : v2 && !v1 ? c2 : c1;
  return new Date(t).toISOString();
}
export const addDaysTo = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const weekdayOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();
export const mondayOf = (day) => addDaysTo(day, -((weekdayOf(day) + 6) % 7));
export const monthStart = (day) => `${String(day).slice(0, 7)}-01`;
const HORAS_TXT = (h) => (h === 1 ? 'uma hora' : h === 2 ? 'duas horas' : `${h} horas`);
// "Horários no fuso da clínica (uma hora a menos que Brasília)": só quando o fuso da clínica, naquele instante, tem
// diferença para UTC diferente da do aparelho de quem lê.
export function tzNote(tz, deviceTz, ms = Date.now()) {
  if (!tz || !deviceTz) return '';
  const a = tzOffsetMin(tz, ms); const b = tzOffsetMin(deviceTz, ms);
  if (a === b) return '';
  const h = Math.abs(a - b) / 60;
  const qto = Number.isInteger(h) ? HORAS_TXT(h) : `${String(h).replace('.', ',')} horas`;
  const ref = b === -180 ? 'Brasília' : 'o horário deste aparelho';
  return `Horários no fuso da clínica (${qto} a ${a < b ? 'menos' : 'mais'} que ${ref}).`;
}

// ---------- datas por extenso (dia local, sem fuso) ----------
const DIA_LONGO = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const DIA_CURTO = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' });
const MES_LONGO = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const asDate = (day) => new Date(`${day}T12:00:00Z`);
export const fmtDayLong = (day) => (/^\d{4}-\d{2}-\d{2}$/.test(day || '') ? DIA_LONGO.format(asDate(day)) : '');
export const fmtDayShort = (day) => (/^\d{4}-\d{2}-\d{2}$/.test(day || '') ? DIA_CURTO.format(asDate(day)) : '');
export const fmtMonth = (day) => (/^\d{4}-\d{2}/.test(day || '') ? MES_LONGO.format(asDate(monthStart(day))) : '');
export const fmtDDMM = (day) => (/^\d{4}-\d{2}-\d{2}$/.test(day || '') ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : '');
export const fmtDDMMYYYY = (day) => (/^\d{4}-\d{2}-\d{2}$/.test(day || '') ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '');
// "qua., 05/11 às 09:30" no fuso da clínica
export const fmtWhen = (tz, iso) => (iso ? `${fmtDayShort(dayIn(tz, Date.parse(iso)))} às ${timeIn(tz, iso)}` : '');

// ---------- situações, cores e legenda ----------
export const CLINIC_STATUS = {
  pending: 'Aguardando contato', contacted: 'Em contato', hold: 'Reserva temporária', awaiting_payment: 'Aguardando pagamento',
  confirmed: 'Confirmado', checked_in: 'Paciente presente', in_service: 'Em atendimento', completed: 'Concluído',
  no_show: 'Não compareceu', reschedule_requested: 'Remarcação solicitada', cancelled: 'Cancelado', expired: 'Reserva expirada',
};
// Situação para a clínica; a reserva mostra até quando ("Reserva temporária até 10:42", no fuso da clínica).
export function clinicStatusLabel(status, holdExpiresAt = null, tz = 'America/Sao_Paulo') {
  const base = CLINIC_STATUS[status] || '';
  if ((status === 'hold' || status === 'awaiting_payment') && holdExpiresAt) {
    const t = timeIn(tz, holdExpiresAt);
    if (t) return `${base} até ${t}`;
  }
  return base;
}
// Tom (cor), ícone e texto curto de cada situação. Cor nunca sozinha: sempre com o texto e o ícone.
export const STATUS_LOOK = {
  confirmed: ['azul', 'fa-calendar-check', 'Confirmado'], checked_in: ['azul', 'fa-user-check', 'Presente'],
  in_service: ['azul', 'fa-stethoscope', 'Em atendimento'], hold: ['amarelo', 'fa-clock', 'Reserva'],
  awaiting_payment: ['amarelo', 'fa-clock', 'Pagamento'], reschedule_requested: ['amarelo', 'fa-rotate', 'Remarcar'],
  pending: ['amarelo', 'fa-clock', 'Aguardando'], contacted: ['azul', 'fa-phone', 'Em contato'],
  cancelled: ['cinza', 'fa-ban', 'Cancelado'], no_show: ['cinza', 'fa-user-xmark', 'Faltou'], expired: ['cinza', 'fa-ban', 'Expirada'],
  completed: ['roxo', 'fa-circle-check', 'Concluído'],
};
export function statusTag(status, holdExpiresAt = null, tz = 'America/Sao_Paulo') {
  const [tone, icon, short] = STATUS_LOOK[status] || ['cinza', 'fa-circle-info', status || ''];
  return { tone, icon, short, text: clinicStatusLabel(status, holdExpiresAt, tz) || status || '' };
}
export const BUSY_TEXT = { agenda_propria: 'Ocupado (agenda própria)', uso_interno: 'Ocupado (uso interno)', outro: 'Ocupado (outro motivo)' };
export const BUSY_REASONS = [['agenda_propria', 'Agenda própria da clínica'], ['uso_interno', 'Uso interno'], ['outro', 'Outro']];
export const BLOCK_KINDS = [['bloqueio', 'Bloqueio'], ['manutencao', 'Manutenção'], ['feriado', 'Feriado'], ['folga', 'Folga']];
export const BLOCK_KIND_LABEL = { bloqueio: 'Bloqueado', manutencao: 'Manutenção', feriado: 'Feriado', folga: 'Folga' };
// Texto e ícone de um bloqueio na grade ("Bloqueado: Manutenção"; feriado com a bandeira).
export const blockLook = (kind) => (kind === 'feriado' ? { tone: 'vermelho', icon: 'fa-flag', text: 'Feriado' }
  : { tone: 'vermelho', icon: 'fa-lock', text: kind && kind !== 'bloqueio' ? `Bloqueado: ${BLOCK_KIND_LABEL[kind] || kind}` : 'Bloqueado' });
export const busyLook = (reason) => ({ tone: 'vermelho', icon: 'fa-hand', text: BUSY_TEXT[reason] || BUSY_TEXT.outro });
export const LEGENDA = [
  { tone: 'verde', items: [['fa-check', 'Livre']] },
  { tone: 'azul', items: [['fa-calendar-check', 'Confirmado'], ['fa-user-check', 'Paciente presente'], ['fa-stethoscope', 'Em atendimento']] },
  { tone: 'amarelo', items: [['fa-clock', 'Reserva temporária'], ['fa-clock', 'Aguardando pagamento'], ['fa-rotate', 'Remarcação solicitada']] },
  { tone: 'vermelho', items: [['fa-lock', 'Bloqueado (manutenção, folga)'], ['fa-flag', 'Feriado'], ['fa-hand', 'Ocupado (agenda própria)']] },
  { tone: 'cinza', items: [['fa-ban', 'Cancelado'], ['fa-user-xmark', 'Não compareceu'], ['', 'Fechado']] },
  { tone: 'roxo', items: [['fa-circle-check', 'Concluído']] },
];
export const CHANNEL_LABEL = {
  imed_app: 'Site do IMED', imed_equipe: 'Equipe do IMED', clinica_telefone: 'Telefone', clinica_balcao: 'Balcão',
  clinica_outro: 'Outro', externo: 'Sistema da clínica',
};
export const DESK_CHANNELS = [['clinica_telefone', 'Telefone'], ['clinica_balcao', 'Balcão'], ['clinica_outro', 'Outro']];
export const CONFLICT_KIND = {
  bloqueio_sobre_agendamento: 'Horário bloqueado pela clínica', grade_mudou: 'O horário não cabe mais na configuração',
  capacidade: 'Capacidade reduzida',
};
export const REMARCAR_KINDS = Object.keys(CONFLICT_KIND);
// Motivos de cancelamento na tela ("não pago" fica fora: sem pagamento online, decisão 4.2-e; reserva_expirada e
// remarcado são do sistema).
export const CANCEL_REASONS = [
  ['paciente_desistiu', 'O paciente desistiu'], ['paciente_nao_pode', 'O paciente não pode no horário'],
  ['clinica_indisponivel', 'A clínica não pode atender'], ['equipamento_manutencao', 'Aparelho em manutenção'],
  ['profissional_ausente', 'Profissional ausente'], ['duplicado', 'Agendamento repetido'], ['outro', 'Outro motivo'],
];
export const UNDO_NO_SHOW_REASONS = [['chegou_atrasado', 'O paciente chegou atrasado'], ['registro_errado', 'A falta foi marcada por engano']];
// Motivos da equipe do IMED para ver dados de paciente ("quebra de vidro", decisão 4.2-f; fica registrado).
export const JUSTIFICATIONS = [
  ['suporte_clinica', 'Suporte pedido pela clínica'], ['pedido_do_paciente', 'Pedido do próprio paciente'],
  ['auditoria', 'Conferência ou auditoria'], ['conflito_agenda', 'Resolver um problema da agenda'],
];

// ---------- histórico ----------
const QUEM = { paciente: 'Paciente', clinica: 'Clínica', imed: 'Equipe do IMED', sistema: 'Automático', integracao: 'Sistema da clínica', gateway: 'Pagamento', sql: 'Correção feita pela equipe técnica do IMED' };
const PAPEL = { owner: 'Dono(a)', manager: 'Gestor(a)', reception: 'Recepção', staff: 'Recepção', professional: 'Profissional', finance: 'Financeiro', imed_admin: 'Administração do IMED' };
const ORIGEM = { app: 'pelo site', painel: 'pelo painel', central: 'pela central do IMED', api: 'pela integração', cron: 'automático', sql: 'correção manual' };
const MOTIVO = {
  ...Object.fromEntries(CANCEL_REASONS), ...Object.fromEntries(UNDO_NO_SHOW_REASONS), nao_pago: 'Não pago',
  remarcado: 'Remarcado', reserva_expirada: 'A reserva venceu', bloqueio_forcado: 'Horário bloqueado pela clínica',
};
const HORA_HIST = (tz, iso) => `${fmtDayShort(dayIn(tz, Date.parse(iso)))} ${timeIn(tz, iso)}`;
// "qua., 04/11 10:02 · Confirmado → Paciente presente · Recepção, pelo painel · Motivo: …" (só códigos vêm do banco)
export function historyLine(h, tz = 'America/Sao_Paulo') {
  const quem = h.actor_role ? (PAPEL[h.actor_role] || (String(h.actor_role).startsWith('imed_') ? 'Equipe do IMED' : QUEM[h.actor_kind] || ''))
    : QUEM[h.actor_kind] || '';
  const origem = ORIGEM[h.origin] || '';
  const de = h.from ? `${CLINIC_STATUS[h.from] || h.from} → ` : 'Criado: ';
  const motivo = h.reason_code ? (MOTIVO[h.reason_code] ? `Motivo: ${MOTIVO[h.reason_code]}` : `Motivo registrado: ${h.reason_code}`) : '';
  const item = h.item_seq ? `exame ${h.item_seq}: ` : '';
  return [h.at ? HORA_HIST(tz, h.at) : '', `${item}${de}${CLINIC_STATUS[h.to] || h.to || ''}`, [quem, origem].filter(Boolean).join(', '), motivo]
    .filter(Boolean).join(' · ');
}

// ---------- botões de atendimento (o banco decide de novo: too_early, too_late) ----------
// item: { status, starts_at }; unit: { checkin_before_min, no_show_after_min }; scope: 'clinica' | 'propria' | 'central';
// can: { atender, remarcar, cancelar }. Devolve [{ key, status, label, enabled, hint, confirm, reason }].
export function attendActions(item, unit, now, tz, { scope = 'clinica', can: c = {} } = {}) {
  const out = [];
  const ini = Date.parse(item?.starts_at);
  if (!Number.isFinite(ini)) return out;
  const before = Number(unit?.checkin_before_min ?? 120);
  const tol = Number(unit?.no_show_after_min ?? 15);
  const hora = (ms) => timeIn(tz, new Date(ms).toISOString());
  const atende = scope !== 'central' && c.atender !== false;
  const st = item.status;
  const push = (o) => out.push({ enabled: true, hint: '', confirm: false, reason: false, ...o });
  if (st === 'confirmed' && atende) {
    const ok = now >= ini - before * 60000;
    push({ key: 'chegou', status: 'checked_in', label: 'Chegou', enabled: ok, hint: ok ? '' : `Chegada a partir das ${hora(ini - before * 60000)}` });
  }
  if (st === 'checked_in' && atende) push({ key: 'atendimento', status: 'in_service', label: 'Em atendimento' });
  if (st === 'in_service' && atende) push({ key: 'concluido', status: 'completed', label: 'Concluído', confirm: true });
  if (st === 'confirmed' && c.atender !== false && (atende || scope === 'central')) {
    const ok = now >= ini;
    push({ key: 'concluido', status: 'completed', label: 'Concluído', confirm: true, enabled: ok, hint: ok ? '' : `Concluído a partir das ${hora(ini)}` });
  }
  if (st === 'confirmed' && atende) {
    const ok = now >= ini + tol * 60000;
    push({ key: 'faltou', status: 'no_show', label: 'Não compareceu', confirm: true, enabled: ok, hint: ok ? '' : `Disponível a partir das ${hora(ini + tol * 60000)}` });
  }
  if (st === 'no_show' && atende && scope === 'clinica') {
    const ok = dayIn(tz, now) === dayIn(tz, ini);
    push({ key: 'desfazer', status: 'checked_in', label: 'Desfazer falta', confirm: true, reason: true, enabled: ok, hint: ok ? '' : 'Só no dia do exame' });
  }
  return out;
}
// "Remarcar", "Voltar ao horário de antes" e "Cancelar agendamento": quem pode e em que situação.
export function manageActions(item, { scope = 'clinica', can: c = {}, unplaced = false } = {}) {
  const st = item?.status;
  const out = [];
  if (scope === 'propria') return out;
  if (c.remarcar && (st === 'confirmed' || st === 'reschedule_requested')) out.push('remarcar');
  if (c.remarcar && st === 'reschedule_requested' && unplaced) out.push('voltar');
  if (c.cancelar && ['confirmed', 'reschedule_requested', 'checked_in', 'hold', 'awaiting_payment'].includes(st)) out.push('cancelar');
  return out;
}

// ---------- grade do dia: raias e posição ----------
// items: [{ id, start, end }] em minutos do dia; dayStart: minuto do começo da grade; step: minutos por linha;
// minSpan: altura mínima de cada item na tela, em linhas (o exame curto fica mais alto que a duração, para caberem a
// hora e a situação e para ser um alvo bom de clicar); um item pode trazer a própria (item.minSpan). As raias contam com
// essa altura: itens que se cruzariam NA TELA ficam lado a lado, nunca um por cima do outro; encostados, não.
// Devolve { id: { row, span, lane, lanes } }.
export function layoutColumn(items, dayStart = 0, step = 15, minSpan = 0.5) {
  const list = [...items].filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end)).sort((a, b) => a.start - b.start || a.end - b.end);
  const out = {};
  let grupo = []; let fimGrupo = -Infinity; let raias = [];
  const fecha = () => { const n = raias.length; for (const g of grupo) out[g.id].lanes = n; grupo = []; raias = []; };
  for (const it of list) {
    const span = Math.max((it.end - it.start) / step, it.minSpan ?? minSpan);
    const fim = it.start + span * step;   // onde o item termina na tela
    if (it.start >= fimGrupo) fecha();
    let lane = raias.findIndex((f) => f <= it.start);
    if (lane < 0) { lane = raias.length; raias.push(fim); } else raias[lane] = fim;
    out[it.id] = { row: (it.start - dayStart) / step, span, lane, lanes: 1 };
    grupo.push(it);
    fimGrupo = Math.max(fimGrupo, fim);
  }
  fecha();
  return out;
}
// Altura da linha de 15 min (px) e altura mínima de cada item (em linhas) para a grade: o item mais curto mostrado
// precisa de pelo menos 44 px (a hora e a situação à vista; alvo grande para o mouse e o dedo). Sem item curto, a linha
// fica com 24 px; com exame de 15 min, 44 px; mais curto que isso, a linha para em 44 px e o item ganha altura mínima.
export const GRADE = { linhaMin: 24, linhaMax: 44, itemMin: 44 };
export function gridScale(durations) {
  const curtos = (durations || []).filter((d) => Number.isFinite(d) && d > 0);
  const menor = curtos.length ? Math.min(...curtos) : 30;
  const rowh = Math.min(GRADE.linhaMax, Math.max(GRADE.linhaMin, Math.ceil((GRADE.itemMin * 15) / menor)));
  return { rowh, minSpan: GRADE.itemMin / rowh };
}

// ---------- novo agendamento (balcão ou telefone) ----------
// As mesmas regras de private.agenda_validate_patient e de agenda_desk_book.
export function deskErrors(v) {
  const e = {};
  if (!v.procedure) e.bkProc = 'Escolha o exame.';
  if (!v.slot) e.bkSlot = 'Escolha um horário livre.';
  const nome = String(v.name || '').trim().replace(/\s+/g, ' ');
  if (nome.length < 2 || nome.length > 120) e.bkNome = 'Informe o nome (de 2 a 120 letras).';
  const tel = String(v.phone || '').replace(/\D/g, '');
  if (!/^\d{10,11}$/.test(tel)) e.bkFone = 'Informe o celular com DDD (10 ou 11 números).';
  const mail = String(v.email || '').trim();
  if (mail && (mail.length > 254 || !EMAIL_RE.test(mail))) e.bkEmail = 'E-mail inválido. Deixe em branco se a pessoa não tiver.';
  if (v.forOther) {
    const outro = String(v.otherName || '').trim().replace(/\s+/g, ' ');
    if (outro.length < 2 || outro.length > 120) e.bkOutroNome = 'Informe o nome de quem vai fazer o exame.';
    const par = String(v.relationship || '').trim();
    if (par.length < 2 || par.length > 60) e.bkParentesco = 'Informe o parentesco de quem vai fazer o exame.';
    if (v.otherMinor && !v.guardianConsent) e.bkAutoriza = 'Para menor de 18 anos, confirme que é o responsável legal ou tem a autorização dele.';
    if (!v.otherMinor && !v.otherConsent) e.bkAutoriza = 'Confirme que a pessoa sabe e concordou.';
  }
  if (!DESK_CHANNELS.some(([k]) => k === v.channel)) e.bkCanal = 'Escolha como a pessoa pediu.';
  if (!v.consent) e.bkConsent = 'Marque que a pessoa foi avisada de que o agendamento fica registrado.';
  return e;
}
export function deskPayload(v) {
  const p = {
    name: String(v.name).trim().replace(/\s+/g, ' '), phone: String(v.phone).replace(/\D/g, ''), consent: true,
    for_other: !!v.forOther,
  };
  const mail = String(v.email || '').trim().toLowerCase();
  if (mail) p.email = mail;
  if (v.forOther) {
    p.other_name = String(v.otherName).trim().replace(/\s+/g, ' ');
    p.relationship = String(v.relationship).trim();
    p.other_minor = !!v.otherMinor;
    p.guardian_consent = !!v.otherMinor;
    p.other_consent = !v.otherMinor;
  }
  return p;
}
// Horários livres em grupos (manhã, tarde, noite) na hora local da clínica.
export function slotGroups(slots, tz) {
  const g = { manha: [], tarde: [], noite: [] };
  for (const s of slots || []) {
    const m = minutesIn(tz, s.start);
    if (Number.isNaN(m)) continue;
    g[m < 720 ? 'manha' : m < 1080 ? 'tarde' : 'noite'].push({ ...s, label: timeIn(tz, s.start) });
  }
  return [['manha', 'Manhã'], ['tarde', 'Tarde'], ['noite', 'Noite']].map(([k, n]) => ({ key: k, label: n, slots: g[k] })).filter((x) => x.slots.length);
}
// Por que não há horário livre (o diagnóstico que agenda_desk_slots devolve).
export function noSlotsText(r, { canConfig = false, day = '' } = {}) {
  if (!r) return 'Nenhum horário livre neste dia. Tente outro dia.';
  if (!r.national_holidays_until) return 'Nenhum horário livre: o IMED ainda não lançou os feriados nacionais. Avise o IMED pelo Fale com o IMED.';
  if (!r.holidays_checked_until) {
    return canConfig ? 'Nenhum horário livre: falta informar até quando a clínica conferiu os feriados da cidade e do estado (Configurar agenda › Unidade).'
      : 'Nenhum horário livre: falta informar até quando a clínica conferiu os feriados da cidade e do estado. Peça ao dono ou gestor da clínica para informar em Configurar agenda.';
  }
  const limite = [r.holidays_checked_until, r.national_holidays_until].filter(Boolean).sort()[0];
  if (day && limite && day > limite) return `Os feriados só foram conferidos até ${fmtDDMMYYYY(limite)}. Escolha um dia até essa data.`;
  return 'Nenhum horário livre neste dia. Tente outro dia.';
}

// ---------- bloqueios ----------
// Bloqueio digitado (dias inteiros ou algumas horas de um dia) → início e fim no FUSO DA CLÍNICA.
// Dia inteiro que começa hoje (ou antes): começa AGORA, arredondado para baixo de 5 em 5 minutos (fromNow), e não às
// 00:00 — os exames da manhã já aconteceram. O que já começou não é atingido (o banco confere de novo).
export function blockRangeTz({ kind, from, to, start, end }, tz, now = Date.now()) {
  const errs = {};
  const D = /^\d{4}-\d{2}-\d{2}$/;
  let starts = null; let ends = null; let fromNow = false;
  if (!D.test(from || '')) errs.blFrom = 'Escolha o dia.';
  if (kind === 'part') {
    if (Number.isNaN(toMin(start))) errs.blStart = 'Escolha o horário de início.';
    if (Number.isNaN(toMin(end))) errs.blEnd = 'Escolha o horário de fim.';
    else if (!errs.blStart && toMin(end) <= toMin(start)) errs.blEnd = 'O fim precisa ser depois do início.';
    if (!Object.keys(errs).length) { starts = localToUtc(from, start, tz); ends = localToUtc(from, end, tz); }
  } else if (!errs.blFrom) {
    const last = to || from;
    if (!D.test(last)) errs.blTo = 'Escolha o último dia.';
    else if (last < from) errs.blTo = 'O último dia precisa ser igual ou depois do primeiro.';
    else if (last > addDaysTo(from, 364)) errs.blTo = 'Use até 365 dias em cada bloqueio.';
    else {
      starts = localToUtc(from, '00:00', tz); ends = localToUtc(addDaysTo(last, 1), '00:00', tz);
      const agora = Math.floor(now / 300000) * 300000;
      if (Date.parse(starts) < agora) { starts = new Date(agora).toISOString(); fromNow = true; }
    }
  }
  if (ends && Date.parse(ends) <= now) { errs[kind === 'part' ? 'blEnd' : to ? 'blTo' : 'blFrom'] = 'Esse período já passou.'; starts = ends = null; fromNow = false; }
  return { errs, starts, ends, fromNow };
}
// Os dados de dois bloqueios são os mesmos (alvo, início, fim e tipo)? O motivo não conta: não muda quem é atingido.
export const sameBlock = (a, b) => !!a && !!b && (a.p_resource || null) === (b.p_resource || null) && a.p_kind === b.p_kind
  && Date.parse(a.p_starts) === Date.parse(b.p_starts) && Date.parse(a.p_ends) === Date.parse(b.p_ends);
// Período de um bloqueio por extenso, no fuso da clínica.
export function blockWhenTz(b, tz) {
  const d1 = dayIn(tz, Date.parse(b.starts_at)); const t1 = timeIn(tz, b.starts_at);
  const d2 = dayIn(tz, Date.parse(b.ends_at)); const t2 = timeIn(tz, b.ends_at);
  if (t2 === '00:00' && d2 > d1) {
    const last = addDaysTo(d2, -1);
    if (t1 === '00:00') return last <= d1 ? `${fmtDayShort(d1)} (dia inteiro)` : `${fmtDayShort(d1)} até ${fmtDayShort(last)} (dias inteiros)`;
    return last <= d1 ? `${fmtDayShort(d1)}, das ${t1} até o fim do dia` : `${fmtDayShort(d1)} às ${t1} até ${fmtDayShort(last)} (fim do dia)`;
  }
  if (d1 === d2) return `${fmtDayShort(d1)}, das ${t1} às ${t2}`;
  return `${fmtDayShort(d1)} ${t1} até ${fmtDayShort(d2)} ${t2}`;
}

// ---------- mês ----------
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
export function monthSummary(d) {
  return [
    d.ativos ? plural(d.ativos, 'marcado', 'marcados') : '', d.concluidos ? plural(d.concluidos, 'concluído', 'concluídos') : '',
    d.faltas ? plural(d.faltas, 'falta', 'faltas') : '', d.bloqueios ? plural(d.bloqueios, 'bloqueio', 'bloqueios') : '',
  ].filter(Boolean).join(' · ');
}

// ---------- respostas do banco → mensagem (todo status das funções da agenda tem texto) ----------
export const ACTION_TEXT = {
  forbidden: 'Sua conta não pode fazer isto nesta clínica.',
  not_found: 'Este agendamento não existe mais. A agenda foi atualizada.',
  not_agenda: 'Este é um pedido sem horário: cuide dele na aba Pedidos.',
  version_conflict: 'Outra pessoa mudou este agendamento agora há pouco. A agenda foi atualizada: confira e tente de novo.',
  transition_not_allowed: 'Não dá para fazer isso com o agendamento nesta situação. A agenda foi atualizada.',
  too_early: 'Ainda não dá para fazer isso: espere o horário indicado no botão.',
  too_late: 'Isso só pode ser feito no dia do exame.',
  reason_required: 'Escolha o motivo.',
  invalid_reason: 'Escolha um motivo da lista.',
  invalid_status: 'Situação inválida. Atualize a agenda e tente de novo.',
  slot_taken: 'Esse horário acabou de ser ocupado. Escolha outro.',
  slot_taken_back: 'O horário não está mais livre. Remarque para outro horário.',
  // "Desfazer falta" (não compareceu → presente) quando o horário já foi usado: um item com falta não se remarca.
  slot_taken_no_show: 'O horário já foi usado por outro paciente, então a falta não pode ser desfeita. Para atender esta pessoa hoje, faça um novo agendamento.',
  // A situação mudou enquanto a pergunta "Sim, …" estava na tela (outra pessoa, outra aba): nada foi enviado.
  status_changed: 'A situação deste agendamento mudou. A agenda foi atualizada: confira e tente de novo.',
  already_cancelled: 'Este agendamento já estava cancelado.',
  not_cancellable: 'Este agendamento não pode mais ser cancelado.',
  idempotency_conflict: 'Este envio já foi usado para outro horário. Escolha o horário de novo e confirme.',
  replay: 'Este agendamento já tinha sido registrado. Confira abaixo.',
  consent_required: 'Marque que a pessoa foi avisada de que o agendamento fica registrado.',
  invalid_patient: 'Confira o nome (2 a 120 letras) e o celular com DDD.',
  invalid_package: 'Os exames escolhidos não cabem juntos nesses horários.',
  agenda_not_started: 'A agenda desta clínica ainda não foi ativada.',
  invalid_period: 'O período não é válido: confira o começo e o fim (e se já não passou).',
  invalid: 'Algum dado não está no formato aceito. Confira os campos.',
  has_appointments: 'Há pacientes marcados nesse período.',
  confirm_required: 'Este bloqueio atinge agendamentos.',
  affected_changed: 'A agenda mudou enquanto você conferia. Veja a lista atualizada e confirme de novo.',
  cannot_move: 'Há paciente já presente, em atendimento ou com reserva em andamento nesse período. Termine ou cancele esses atendimentos antes de bloquear.',
  too_many: 'Este bloqueio atinge mais de 200 agendamentos. Bloqueie um período menor.',
  justification_required: 'Escolha o motivo para ver os dados (fica registrado).',
  too_short: 'Digite pelo menos 3 letras.',
  already_closed: 'Este item já tinha sido resolvido.',
  past: 'O horário deste agendamento já passou.',
  not_online: 'Esta clínica ainda não marca horário pelo site.',
  expired: 'A reserva venceu.',
  network: 'Não foi possível falar com o servidor. Confira a internet e tente de novo.',
  // Sem resposta do servidor numa gravação: pode ter gravado. A tela relê antes de deixar tentar de novo.
  network_block: 'Não foi possível falar com o servidor. O bloqueio pode já ter sido salvo: confira na lista se ele já aparece antes de tentar de novo.',
  network_desk: 'Não foi possível falar com o servidor. O agendamento pode já ter sido gravado: a agenda foi atualizada, confira antes de marcar outro horário. Para tentar de novo no mesmo horário, clique em “Confirmar agendamento” (não grava duas vezes).',
  block_replay: 'Este bloqueio já tinha sido salvo.',
  // not_found que NÃO é de agendamento: exame, aparelho, sala ou profissional desativado por outra pessoa.
  not_found_exam: 'O exame escolhido não está mais ativo (a configuração da agenda mudou). A lista de exames foi atualizada: escolha de novo.',
  not_found_resource: 'O aparelho, a sala ou o profissional escolhido não está mais ativo (a configuração da agenda mudou). A lista foi atualizada: escolha de novo.',
  not_found_resched: 'O exame deste agendamento não está mais ativo na configuração da agenda, então não há horários para remarcar por aqui. Cancele ou peça a quem configura a agenda para reativar o exame.',
};
export function actionText(status, ctx = {}) {
  if (status === 'transition_not_allowed' && ctx.from) {
    return `Não dá para fazer isso com o agendamento na situação “${CLINIC_STATUS[ctx.from] || ctx.from}”. A agenda foi atualizada.`;
  }
  if (status === 'too_early' && ctx.hint) return `Ainda não dá: ${ctx.hint.charAt(0).toLowerCase()}${ctx.hint.slice(1)}.`;
  if (status === 'not_cancellable' && ctx.request_status) return `Este agendamento não pode mais ser cancelado (situação: ${CLINIC_STATUS[ctx.request_status] || ctx.request_status}).`;
  if (status === 'invalid_patient' && ctx.message) return String(ctx.message);
  if (status === 'agenda_not_started' && ctx.canConfig) return `${ACTION_TEXT.agenda_not_started} Ative em Configurar agenda.`;
  if (status === 'confirm_required' && ctx.items) {
    // O banco conta por exame; "agendamento" é o pedido (um paciente pode ter até 4 exames no mesmo agendamento).
    const { pedidos, exames, ocupados } = blockAffected(ctx.items);
    const partes = [
      pedidos ? `${plural(pedidos, 'agendamento', 'agendamentos')}${exames > pedidos ? ` (${plural(exames, 'exame', 'exames')})` : ''}` : '',
      ocupados ? plural(ocupados, 'horário “só ocupar”', 'horários “só ocupar”') : '',
    ].filter(Boolean);
    return partes.length ? `Este bloqueio atinge ${partes.join(' e ')}.` : 'Este bloqueio não atinge nenhum agendamento.';
  }
  return ACTION_TEXT[status] || ACTION_TEXT.invalid;
}

// Pergunta antes de cancelar um exame (pacote) ou o agendamento no painel. "O horário fica livre" só quando o item
// ainda segura um aparelho/sala/profissional e ainda não começou: o que veio do "Bloquear mesmo assim" (Para remarcar)
// já soltou o horário, e o período está bloqueado.
export function cancelItemAsk(item, { pacote = false, tz = 'America/Sao_Paulo', now = Date.now() } = {}) {
  const quem = item?.patient || 'paciente';
  const quando = fmtWhen(tz, item?.starts_at);
  const pergunta = pacote
    ? `Cancelar o exame ${item?.procedure || ''} de ${quem} (${quando})? Só este exame: os outros do agendamento continuam marcados.`
    : `Cancelar o agendamento de ${quem} (${quando})?`;
  if (item?.status === 'reschedule_requested') return `${pergunta} O paciente sai da lista Para remarcar.`;
  const segura = (item?.resources || []).length > 0 && Date.parse(item?.starts_at) > now;
  return segura ? `${pergunta} O horário fica livre para outro paciente.` : pergunta;
}

// ---------- bloqueio com gente no período: textos que contam pacientes, não exames ----------
// items: a lista da prévia (agenda_block_force) ou do has_appointments (agenda_block_add). Pacientes = agendamentos
// (request_id) distintos; "só ocupar" não é paciente.
export function blockAffected(items = []) {
  const ag = (items || []).filter((x) => (x.kind || 'agendamento') === 'agendamento');
  return {
    pedidos: new Set(ag.map((x, i) => x.request_id || x.item_id || `#${i}`)).size,   // sem id: conta cada um
    exames: ag.length,
    ocupados: (items || []).filter((x) => x.kind === 'ocupado').length,
  };
}
// Sem "Bloquear mesmo assim" (sem a função nova ou sem permissão de remarcar): o que impede o bloqueio.
// r: a resposta has_appointments do agenda_block_add ({ items: só agendamentos, busy: quantos "só ocupar" }).
export function blockRefusedText(r = {}) {
  const { pedidos } = blockAffected(r.items);
  const busy = Number(r.busy) || 0;
  if (pedidos && busy) return 'Há pacientes marcados e horários “só ocupar” nesse período. Remarque ou cancele esses agendamentos e retire os horários “só ocupar” antes de bloquear.';
  if (pedidos) return 'Há pacientes marcados nesse período. Remarque ou cancele esses agendamentos antes de bloquear.';
  if (busy) return `Há ${busy === 1 ? 'um horário “só ocupar”' : 'horários “só ocupar”'} nesse período. Retire ${busy === 1 ? 'esse horário' : 'esses horários'} na agenda antes de bloquear.`;
  return 'Há agendamentos ou horários ocupados nesse período. Confira a agenda antes de bloquear.';
}
// O que acontece se bloquear mesmo assim (abaixo da lista da prévia). Texto puro; a tela põe "Para remarcar" em negrito.
export function blockForceHelp(items = []) {
  const { pedidos, ocupados } = blockAffected(items);
  const oc = ocupados === 1 ? 'o horário “só ocupar” do período será retirado' : 'os horários “só ocupar” do período serão retirados';
  if (pedidos) {
    return `Se bloquear mesmo assim, ${pedidos === 1 ? 'esse paciente vai' : 'esses pacientes vão'} para a lista Para remarcar e a clínica precisa avisá-${pedidos === 1 ? 'lo' : 'los'}.${ocupados ? ` ${oc.charAt(0).toUpperCase()}${oc.slice(1)}.` : ''}`;
  }
  return ocupados ? `Se bloquear mesmo assim, ${oc}. Nenhum paciente é atingido.` : '';
}
// Depois de gravar. moved: exames que foram para "Para remarcar" (null = não se sabe: achado já gravado depois de
// erro de rede); pedidos: quantos pacientes são (da prévia confirmada; sem ela, conta pelos exames); busy: "só ocupar"
// retirados; replay: o bloqueio já estava salvo.
export function blockDoneText({ moved = 0, pedidos = null, busy = 0, replay = false } = {}) {
  if (replay) return `${ACTION_TEXT.block_replay}${moved == null ? ' Se havia pacientes no período, eles estão na lista Para remarcar.' : ''}`;
  const p = moved ? (pedidos || moved) : 0;
  const oc = busy ? (busy === 1 ? '1 horário “só ocupar” foi retirado.' : `${busy} horários “só ocupar” foram retirados.`) : '';
  if (p) return `Bloqueio salvo. ${p === 1 ? '1 paciente foi' : `${p} pacientes foram`} para a lista Para remarcar.${oc ? ` ${oc}` : ''}`;
  return `Bloqueio salvo.${oc ? ` ${oc}` : ''} Nesse período nenhum horário é oferecido.`;
}
// Chave de reenvio (p_key): a mesma só quando a resposta não chegou (erro de rede); qualquer resposta do banco que não
// seja ok pede uma chave nova na próxima tentativa.
export const needsNewKey = (status) => status !== undefined && status !== null && status !== 'network';

// Nome curto ("Maria S."): o primeiro nome e a inicial do último (o mesmo de private.agenda_short_name).
export function shortName(nome) {
  const w = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
  return w.length > 1 ? `${w[0]} ${w.at(-1).charAt(0)}.` : w[0] || '';
}

// ---------- "Precisa de atenção" (fase 4.3) ----------
// Só com o que as funções já devolvem: os itens de agenda_view do período na tela, os conflitos abertos de
// agenda_conflicts e, para quem vê os pedidos, quantos pedidos estão sem resposta (agenda_requests). Nada é inventado.
// items: { id, request_id, status, starts_at, hold_expires_at }; unit: { no_show_after_min }; pendentes: número ou
// null (não lido); now em ms. Devolve [{ key, n, text, ids }], na ordem de urgência.
export function attentionItems({ items = [], conflicts = [], pendentes = null, now = Date.now(), unit = {}, soonMin = 15 } = {}) {
  const tol = Number(unit?.no_show_after_min ?? 15);
  const lista = Array.isArray(items) ? items : [];
  const passou = (it) => { const ini = Date.parse(it.starts_at); return Number.isFinite(ini) && now >= ini + tol * 60000; };
  const vence = (it) => { const t = Date.parse(it.hold_expires_at); return Number.isFinite(t) && t > now && t <= now + soonMin * 60000; };
  const chegadas = lista.filter((it) => it.status === 'confirmed' && passou(it));
  const vencendo = lista.filter((it) => (it.status === 'hold' || it.status === 'awaiting_payment') && vence(it));
  const remIds = new Set((Array.isArray(conflicts) ? conflicts : []).map((k) => k.item_id).filter(Boolean));
  for (const it of lista) if (it.status === 'reschedule_requested') remIds.add(it.id);
  const out = [];
  const um = (n, a, b) => (n === 1 ? a : b.replace('{n}', String(n)));
  if (chegadas.length) out.push({ key: 'chegadas', n: chegadas.length, ids: chegadas.map((i) => i.id), text: um(chegadas.length, '1 agendamento já passou da hora sem registro de chegada ou falta.', '{n} agendamentos já passaram da hora sem registro de chegada ou falta.') });
  if (vencendo.length) out.push({ key: 'reservas', n: vencendo.length, ids: vencendo.map((i) => i.id), text: um(vencendo.length, `1 reserva temporária vence nos próximos ${soonMin} min.`, `{n} reservas temporárias vencem nos próximos ${soonMin} min.`) });
  if (remIds.size) out.push({ key: 'remarcar', n: remIds.size, ids: [...remIds], text: um(remIds.size, '1 agendamento para remarcar.', '{n} agendamentos para remarcar.') });
  if (Number.isFinite(Number(pendentes)) && pendentes > 0) out.push({ key: 'pedidos', n: Number(pendentes), ids: [], text: um(Number(pendentes), '1 pedido de agendamento sem resposta.', '{n} pedidos de agendamento sem resposta.') });
  return out;
}

// ---------- painel gerencial (fase 4.3) ----------
export const PERIODS = [['hoje', 'Hoje'], ['semana', 'Esta semana'], ['mes', 'Este mês'], ['30d', 'Últimos 30 dias'], ['custom', 'Outro período']];
export const PERIOD_MAX_DAYS = 92;   // agenda_dashboard aceita até 92 dias (p_to - p_from ≤ 91)
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000) + 1;
// O período do painel: { from, to } (dias AAAA-MM-DD) ou { error } quando o período escolhido não serve.
export function periodRange(kind, day, today, custom = {}) {
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  if (kind === 'hoje') return { from: today, to: today };
  if (kind === 'semana') { const seg = mondayOf(day); return { from: seg, to: addDaysTo(seg, 6) }; }
  if (kind === 'mes') {
    const ini = monthStart(day);
    const d = new Date(`${ini}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1);
    return { from: ini, to: addDaysTo(d.toISOString().slice(0, 10), -1) };
  }
  if (kind === '30d') return { from: addDaysTo(today, -29), to: today };
  if (!ok(custom.from) || !ok(custom.to)) return { error: 'Escolha o primeiro e o último dia do período.' };
  if (custom.to < custom.from) return { error: 'O último dia não pode vir antes do primeiro.' };
  if (diasEntre(custom.from, custom.to) > PERIOD_MAX_DAYS) return { error: `O período pode ter no máximo ${PERIOD_MAX_DAYS} dias (cerca de 3 meses).` };
  return { from: custom.from, to: custom.to };
}
export const pctText = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
export const minutesText = (m) => { const n = Math.round(Number(m) || 0); return n >= 120 ? `${Math.floor(n / 60)} h ${String(n % 60).padStart(2, '0')} min` : `${n} min`; };
// Motivo de cancelamento em palavras (os códigos vêm do banco; o desconhecido aparece como está).
export const cancelReasonText = (code) => (code === 'sem_motivo' ? 'Sem motivo registrado' : MOTIVO[code] || code || '');
// Situações do painel, na ordem da tela, com texto.
export const DASH_STATUS = [['confirmado', 'Confirmados'], ['presente', 'Presentes ou em atendimento'], ['concluido', 'Concluídos'], ['faltou', 'Não compareceram'], ['remarcacao', 'Para remarcar'], ['reservado', 'Reservas temporárias'], ['cancelado', 'Cancelados']];
export const DASH_ORIGIN = [['imed', 'Pelo IMED (site e equipe)'], ['clinica', 'Pela clínica (telefone, balcão, outro)'], ['externo', 'Sistema da clínica']];
