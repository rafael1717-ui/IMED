// Área da clínica: pedidos dos pacientes, a agenda (agenda.js, fase 4.2), a configuração da agenda (agenda-config.js,
// 4.1), dados, convênios, exames e preços. Para a equipe do IMED (is_imed_admin): pedidos de cadastro e pedidos feitos
// ao IMED. Dados de pacientes ficam só na memória da página (nada vai para o localStorage).
// Desde a 4.2 a clínica lê os pedidos só pela função agenda_requests (registra quem leu); a leitura direta da tabela
// fica só como reserva para o banco que ainda não tem a função (troca de versão) e para "Pedidos ao IMED".
import {
  auth, $, $$, esc, EXAMS, PERIODS, examName, kindName, ROLES, CLAIM_STATUS, statusLabel, onlyDigits, maskPhone,
  isValidEmail, hideDoc, maskDoc, fmtPhone, fmtDate, fmtDateTime, parsePrice, centsToInput, friendlyError, loading,
  note, finishLogin, renderAuth, toast, telHref, EXPIRED,
} from './clinica.js';
import * as T from './confianca.js';
import * as V from './estatisticas.js';
import * as A from './agenda-core.js';
import { renderConfig, renderTeam, loadMyInvites, myInvitesHtml, acceptInvite } from './agenda-config.js';
import { startClinicWatcher } from './tempo-real.js';

// Situações no filtro "Mostrar": a clínica vê também as da agenda (4.2); os pedidos ao IMED só têm as 5 de sempre.
const STATUSES = ['pending', 'contacted', 'confirmed', 'checked_in', 'in_service', 'completed', 'no_show', 'reschedule_requested', 'cancelled'];
const IMED_STATUSES = ['pending', 'contacted', 'confirmed', 'completed', 'cancelled'];
const ACTIONS = ['contacted', 'confirmed', 'completed', 'cancelled'];
const DAYS = [['seg', 'Segunda'], ['ter', 'Terça'], ['qua', 'Quarta'], ['qui', 'Quinta'], ['sex', 'Sexta'], ['sab', 'Sábado'], ['dom', 'Domingo']];
export const COMMON_INSURANCES = ['Amil', 'Bradesco Saúde', 'SulAmérica', 'Unimed', 'Hapvida', 'NotreDame Intermédica', 'Porto Seguro', 'Prevent Senior', 'Cassi', 'Golden Cross'];
const EXAM_CODES = ['rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab'];
const BASE_COLS = 'id,created_at,exam_code,preferred_date,preferred_period,patient_name,patient_phone,patient_email,notes,status';
// Colunas da migração de confiança (pedido para outra pessoa e quem cancelou). Se o banco ainda não as tiver,
// a lista é buscada de novo sem elas (loadList).
export const TRUST_COLS = ',for_other,other_name,relationship,other_minor,guardian_consent,other_consent,cancelled_at,cancelled_by';
const REQ_COLS = `${BASE_COLS},slot_start${TRUST_COLS}`;
const IMED_COLS = `${BASE_COLS},place_source,place_ref,place_name,place_address,place_phone${TRUST_COLS}`;
const CANCELLED_BY = { patient: 'pelo paciente, no site', clinic: 'pela clínica', imed: 'pela equipe do IMED' };
// Respostas de set_request_status que não são "ok", em linguagem simples.
const STATUS_ERR = {
  forbidden: 'Sua conta não pode mudar este pedido.',
  not_found: 'Este pedido não existe mais.',
  invalid_status: 'Situação inválida. Atualize a lista e tente de novo.',
  cancelled_by_patient: 'O próprio paciente cancelou este pedido. Para remarcar, é preciso um novo pedido.',
  slot_taken: 'Este horário já foi reservado por outro paciente depois do cancelamento. Combine outro horário com a pessoa, num novo pedido.',
};

// priceOk: valores acima do limite largo do exame que a pessoa já conferiu nesta página ("clínica:exame" → centavos).
// agendaActive: clínica com a agenda nova ativa (agenda_me); just: motivo escolhido pela equipe do IMED para ver os
// pedidos de uma clínica (fica registrado no banco); agendaFocus: "Ver na agenda" a partir de um pedido.
const state = { admin: false, clinics: [], memberIds: [], perms: {}, invites: [], clinicId: null, tab: null, lists: {}, filter: { pedidos: '', concierge: '', when: '' }, priceOk: {}, agendaActive: {}, just: {}, agendaFocus: null };
const app = () => $('#app');
const clinic = () => state.clinics.find((c) => c.id === state.clinicId) || null;
// Fuso da clínica aberta (o da lista de pedidos, que o banco devolve; senão o do cadastro).
const clinicTz = () => state.reqTz?.[state.clinicId] || clinic()?.timezone || 'America/Sao_Paulo';
const uuidOk = (v) => /^[0-9a-f-]{36}$/i.test(String(v));

// ---------- datas no fuso de São Paulo ----------
// Tudo o que é dia e hora aparece e é montado no horário de São Paulo (o Brasil não tem horário de verão desde 2019).
const TZ = 'America/Sao_Paulo';
const SP_OFFSET = '-03:00';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const spDay = (d) => dayFmt.format(new Date(d));
export const spTime = (d) => timeFmt.format(new Date(d));
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const spIso = (day, time = '00:00') => `${day}T${time}:00${SP_OFFSET}`;
// "qui., 05/11/2026 às 09:00" e "05/11/2026, 09:00" num fuso: o da clínica nos pedidos dela (como a aba Agenda; fase
// 4.2), o de São Paulo nos pedidos ao IMED.
const fmtSlot = (iso, tz = TZ) => `${fmtDate(A.dayIn(tz, Date.parse(iso)))} às ${A.timeIn(tz, iso)}`;
const dateTimeFmts = new Map();
function fmtDateTimeIn(iso, tz = TZ) {
  if (tz === TZ) return fmtDateTime(iso);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (!dateTimeFmts.has(tz)) dateTimeFmts.set(tz, new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz }));
  return dateTimeFmts.get(tz).format(d);
}
const slotOf = (r) => (r.slot_start && !Number.isNaN(Date.parse(r.slot_start)) ? r.slot_start : null);

// Dia do exame: o horário marcado pela agenda (no fuso da clínica) ou a data preferida do pedido.
const PERIOD_TIME = { manha: '08:00', tarde: '13:00', noite: '18:00' };
export const apptDay = (r, tz = TZ) => (slotOf(r) ? A.dayIn(tz, Date.parse(r.slot_start)) : /^\d{4}-\d{2}-\d{2}$/.test(r.preferred_date || '') ? r.preferred_date : '');
const apptTime = (r, tz = TZ) => (slotOf(r) ? Date.parse(r.slot_start) : apptDay(r, tz) ? Date.parse(A.localToUtc(r.preferred_date, PERIOD_TIME[r.preferred_period] || '12:00', tz)) : NaN);
// Próximos primeiro (do mais perto ao mais longe); depois os de dias que já passaram (do mais recente ao mais antigo).
export function sortByAppointment(rows, today, tz = TZ) {
  const up = (r) => { const d = apptDay(r, tz); return !!d && d >= today; };
  return [...rows].sort((a, b) => {
    const ua = up(a); const ub = up(b);
    if (ua !== ub) return ua ? -1 : 1;
    const ta = apptTime(a, tz); const tb = apptTime(b, tz);
    const na = Number.isNaN(ta); const nb = Number.isNaN(tb);
    if (na !== nb) return na ? 1 : -1;
    if (!na && ta !== tb) return ua ? ta - tb : tb - ta;
    return String(b.created_at).localeCompare(String(a.created_at));
  });
}
const WHEN = { '': 'Qualquer data', hoje: 'Hoje', semana: 'Próximos 7 dias' };
export const inWhen = (r, when, today, tz = TZ) => {
  if (!when) return true;
  const d = apptDay(r, tz);
  if (!d) return false;
  return when === 'hoje' ? d === today : d >= today && d <= addDays(today, 6);
};

// ---------- entrada ----------
function renderAccount() {
  renderAuth($('#authBox'), {
    back: () => `${location.origin}${location.pathname}`,
    intro: 'Entre com o <b>mesmo e-mail usado no pedido de cadastro</b> da clínica. Enviamos um link de entrada; se você já definiu uma senha, pode entrar com ela.',
    onSignOut: () => { vigia?.stop(); vigia = null; state.clinics = []; state.lists = {}; state.priceOk = {}; state.just = {}; state.agendaFocus = null; app().innerHTML = ''; renderAccount(); toast('Você saiu da sua conta.'); },
    onSignIn: () => { $('#flash').innerHTML = note('Pronto, você entrou.', 'ok'); renderAccount(); loadAll(); },
  });
}

// ---------- atualização automática (tempo-real.js, fase 4.3) ----------
// Um vigia por clínica aberta: o canal de avisos do Supabase (só a versão da agenda) mais a consulta periódica de
// agenda_version. Quando a versão muda, ele avisa pela janela ("imed:agenda-mudou"): a aba Agenda relê (agenda.js) e a
// lista de pedidos desta clínica é buscada de novo, sem mexer no que a pessoa está fazendo em outra aba.
let vigia = null;
function ligarVigia(c) {
  const p = c ? permsOf(c) : {};
  const quer = c && (state.admin || A.can(p, 'agenda.ver') || A.can(p, 'pedidos.ver'));
  if (!quer) { vigia?.stop(); vigia = null; return; }
  if (vigia?.active && vigia.clinicId === c.id) return;
  vigia?.stop();
  vigia = startClinicWatcher({ clinicId: c.id, rpc: (fn, args) => auth.rpc(fn, args), token: () => auth.token(),
    supabaseUrl: window.IMED_CONFIG?.supabaseUrl, chave: window.IMED_CONFIG?.supabaseKey });
}
window.addEventListener('imed:agenda-mudou', (e) => {
  const cid = e.detail?.clinicId;
  if (!cid || cid !== state.clinicId) return;
  const chaves = Object.keys(state.lists).filter((k) => k.startsWith(`pedidos:${cid}:`));
  if (!chaves.length) return;   // nada carregado desta clínica: a próxima abertura da aba já busca de novo
  for (const k of chaves) delete state.lists[k];
  if (state.tab !== 'pedidos' || !$('#panel')?.isConnected) return;
  // a lista aberta: busca de novo mantendo o foco onde está (os filtros são lidos do estado, não da tela)
  const foco = document.activeElement;
  if (foco && foco !== document.body && $('#panel').contains(foco) && foco.id) state.refocus = `#${CSS.escape(foco.id)}`;
  renderTab();
});

// A renovação da entrada falhou e auth.js apagou a sessão: volta para o quadro de entrada.
function lost() {
  if (auth.user()) return false;
  vigia?.stop(); vigia = null;
  state.clinics = []; state.lists = {}; state.admin = false; state.priceOk = {}; state.just = {}; state.agendaFocus = null;
  app().innerHTML = '';
  $('#flash').innerHTML = note(esc(EXPIRED), 'warn');
  renderAccount();
  $('#loginEmail')?.focus();
  return true;
}

// Quem sou e o que posso em cada clínica: agenda_me (3.4), só com os MEUS vínculos. Antes, a lista vinha de
// clinic_members sem filtro, e a conta da equipe do IMED (que lê todos os vínculos) via as clínicas dos outros como
// "minhas". Banco sem agenda_me (troca de versão): os meus vínculos pelo user_id, com as permissões do papel.
const noFn = (err) => err?.status === 404 || err?.data?.code === 'PGRST202' || err?.data?.code === '42883';
async function myClinics() {
  try {
    const me = await auth.rpc('agenda_me');
    if (me?.status === 'ok' && Array.isArray(me.clinics)) return me.clinics.map((c) => ({ clinic_id: c.clinic_id, role: c.role, permissions: c.permissions || {}, agenda_active: c.agenda_active === true }));
    if (me?.status === 'forbidden') return [];
  } catch (err) {
    if (!noFn(err)) throw err;
  }
  const uid = String(auth.user()?.id || '');
  if (!/^[\w-]{1,64}$/.test(uid)) return [];
  const rows = await auth.select(`clinic_members?select=clinic_id,role&user_id=eq.${encodeURIComponent(uid)}`);
  return (rows || []).map((m) => ({ clinic_id: m.clinic_id, role: m.role, permissions: A.permsOf(m.role) }));
}

async function loadAll() {
  app().innerHTML = `<section class="cl-card">${loading('Carregando sua área…')}</section>`;
  try {
    const [admin, members, invites] = await Promise.all([
      auth.rpc('is_imed_admin').then((v) => v === true).catch(() => false),
      myClinics(),
      loadMyInvites(),
    ]);
    state.admin = admin;
    state.invites = invites;
    const ids = [...new Set(members.map((m) => m.clinic_id).filter(uuidOk))];
    state.perms = Object.fromEntries(members.filter((m) => uuidOk(m.clinic_id)).map((m) => [m.clinic_id, m.permissions]));
    state.myRoles = Object.fromEntries(members.filter((m) => uuidOk(m.clinic_id)).map((m) => [m.clinic_id, m.role]));
    state.agendaActive = Object.fromEntries(members.filter((m) => uuidOk(m.clinic_id)).map((m) => [m.clinic_id, !!m.agenda_active]));
    // A equipe do IMED também abre qualquer clínica (agenda, pedidos, dados): o banco libera para is_imed_admin.
    const [mine, all] = await Promise.all([
      ids.length ? auth.select(`clinics?select=*&id=in.(${ids.join(',')})&order=name`) : [],
      admin ? auth.select('clinics?select=*&order=name&limit=500') : [],
    ]);
    const seen = new Set();
    state.memberIds = ids;
    state.clinics = [...(mine || []), ...(all || [])].filter((c) => c && uuidOk(c.id) && !seen.has(c.id) && seen.add(c.id));
  } catch (err) {
    if (lost()) return;
    app().innerHTML = `<section class="cl-card">${note(esc(friendlyError(err, 'Não foi possível carregar sua área agora. Tente de novo em instantes.')), 'err')}
      <div class="cl-actions"><button class="btn btn-ghost" type="button" id="retry">Tentar de novo</button></div></section>`;
    $('#retry').onclick = loadAll;
    return;
  }
  const inv = myInvitesHtml(state.invites);
  if (!state.clinics.length && !state.admin) {
    app().innerHTML = `${inv}${inv ? '' : `<section class="cl-card" aria-labelledby="noneTitle"><h2 id="noneTitle">Nenhuma clínica nesta conta</h2>
      <p class="cl-help">Esta conta ainda não cuida de nenhuma clínica no IMED. Se você é responsável por uma clínica, laboratório ou hospital, peça para assumir o cadastro: a equipe do IMED confere os dados e responde pelo contato informado.</p>
      <p class="cl-help">Já fez o pedido? Confira se entrou com o mesmo e-mail usado nele. Foi convidado por uma clínica? Entre com o e-mail do convite.</p>
      <div class="cl-actions"><a class="btn btn-coral" href="reivindicar.html" id="goClaim">Assumir o cadastro da minha clínica</a></div></section>`}`;
    bindInvites();
    return;
  }
  // Começa pela primeira clínica da própria conta; a equipe do IMED sem clínica começa nas abas da equipe.
  const own = state.clinics.filter((c) => state.memberIds.includes(c.id));
  state.clinicId = state.clinics.some((c) => c.id === state.clinicId) ? state.clinicId : own[0]?.id ?? null;
  renderShell();
}

// Convites para a pessoa logada (agenda_my_invites): aceitar recarrega a área com a clínica nova.
function bindInvites() {
  const box = $('#myInvites');
  if (!box) return;
  box.onclick = async (e) => {
    const b = e.target.closest('button[data-accept]');
    if (b && await acceptInvite(b)) loadAll();
  };
}

// ---------- abas ----------
function tabs() {
  const t = [];
  const c = clinic();
  if (c) t.push(...A.clinicTabs(state.perms[c.id], state.admin).map((id) => [id, A.TAB_LABEL[id]]));
  if (state.admin) t.push(['cadastros', 'Pedidos de cadastro'], ['concierge', 'Pedidos ao IMED'], ['mensagens', 'Mensagens'], ['avisos', 'Avisos de erro'], ['visitas', 'Visitas']);
  return t;
}

function clinicNotes(c) {
  if (!c) return '';
  return `${c.status !== 'published' ? note('Este cadastro ainda é um rascunho e não aparece na busca. A equipe do IMED publica depois de conferir.', 'warn') : ''}
      ${c.status === 'published' && !c.accepts_online_booking ? note('Pedidos pelo site estão desligados. Ligue em “Dados da clínica” para receber pedidos.', 'warn') : ''}`;
}

// Só a equipe do IMED vê o atalho para o painel de gestão (gestao.html). A página de gestão confere de novo e os
// números só saem das funções do banco que exigem a conta da equipe.
const GESTAO_LINK = '<div class="cl-actions"><a class="btn btn-ghost btn-sm" href="gestao.html" id="goGestao"><i class="fa-solid fa-list-check" aria-hidden="true"></i> Painel de gestão</a></div>';

function renderShell() {
  const c = clinic();
  const list = tabs();
  if (!list.some(([id]) => id === state.tab)) state.tab = A.defaultTab(list.map(([id]) => id), !!(c && state.agendaActive[c.id]));
  const opt = (x) => `<option value="${esc(x.id)}"${x.id === state.clinicId ? ' selected' : ''}>${esc(x.name)}${x.status !== 'published' ? ' (rascunho)' : ''}</option>`;
  const own = state.clinics.filter((x) => state.memberIds.includes(x.id));
  const others = state.clinics.filter((x) => !state.memberIds.includes(x.id));
  let picker = '';
  if (state.admin && others.length) {
    picker = `<label class="cl-lbl sr" for="clinicPick">Clínica</label><select id="clinicPick" class="cl-pick">
      <option value=""${state.clinicId ? '' : ' selected'}>Equipe do IMED (sem clínica)</option>
      ${own.length ? `<optgroup label="Minhas clínicas">${own.map(opt).join('')}</optgroup>` : ''}
      <optgroup label="Todas as clínicas (equipe do IMED)">${others.map(opt).join('')}</optgroup></select>`;
  } else if (state.clinics.length > 1) {
    picker = `<label class="cl-lbl sr" for="clinicPick">Clínica</label><select id="clinicPick" class="cl-pick">${state.clinics.map(opt).join('')}</select>`;
  }
  const asAdmin = c && state.admin && !state.memberIds.includes(c.id);
  const role = c && state.memberIds.includes(c.id) ? A.ROLE_LABEL[state.myRoles?.[c.id]] : '';
  app().innerHTML = `${myInvitesHtml(state.invites)}<section class="cl-card" aria-labelledby="clinicTitle">
      <div class="cl-bar">
        <div><h2 id="clinicTitle">${c ? esc(c.name) : 'Equipe do IMED'}</h2>
          ${c ? `<p class="cl-help" style="margin:4px 0 0">${esc([kindName(c.kind), c.city && `${c.city} - ${c.state}`, c.cnes && `CNES ${c.cnes}`, role && `Seu papel: ${role}`].filter(Boolean).join(' · '))}</p>` : '<p class="cl-help" style="margin:4px 0 0">Você entrou como equipe do IMED.</p>'}
        </div>
        ${picker}
      </div>
      ${asAdmin ? note('Você está vendo esta clínica como equipe do IMED. As mudanças valem para a clínica.', 'info') : ''}
      <div id="clinicNotes">${clinicNotes(c)}</div>
      ${state.admin ? GESTAO_LINK : ''}
    </section>
    ${list.length ? `<div class="cl-tabs" role="tablist" aria-label="Seções da área da clínica">
      ${list.map(([id, label]) => `<button class="cl-tab" role="tab" type="button" id="tab-${id}" aria-controls="panel" aria-selected="${id === state.tab}" tabindex="${id === state.tab ? 0 : -1}" data-tab="${id}">${esc(label)}</button>`).join('')}
    </div>
    <section class="cl-card cl-panel" role="tabpanel" id="panel" aria-labelledby="tab-${state.tab}" tabindex="0"></section>`
    : `<section class="cl-card" id="noTabs">${note('Por enquanto não há nada para o seu papel nesta área. Os números do financeiro chegam na próxima etapa.', 'info')}</section>`}`;
  bindInvites();
  ligarVigia(c);
  const pick = $('#clinicPick');
  if (pick) pick.onchange = () => { state.clinicId = pick.value || null; state.lists = {}; state.agendaFocus = null; state.tab = null; renderShell(); $('#clinicPick')?.focus(); };
  if (!list.length) return;
  const tl = $('[role="tablist"]');
  tl.addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) selectTab(b.dataset.tab, true); });
  tl.addEventListener('keydown', (e) => {
    const all = $$('[role="tab"]', tl);
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    const k = (j + all.length) % all.length;
    selectTab(all[k].dataset.tab, true);
  });
  renderTab();
}

const REQUEST_TABS = ['pedidos', 'concierge'];
// Pedidos da clínica: uma lista guardada por clínica e por filtro “Quando” (hoje e 7 dias vêm do banco pela data do exame).
const listKey = (tab) => (tab === 'pedidos' ? `pedidos:${state.clinicId}:${state.filter.when || 'todas'}` : tab);

function selectTab(id, focus) {
  // Ao voltar para uma lista de pedidos, busca de novo para mostrar os pedidos novos.
  if (id !== state.tab && REQUEST_TABS.includes(id)) delete state.lists[listKey(id)];
  state.tab = id;
  $$('[role="tab"]').forEach((b) => {
    const on = b.dataset.tab === id;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  $('#panel').setAttribute('aria-labelledby', `tab-${id}`);
  renderTab();
}

function renderTab() {
  const p = $('#panel');
  p.onclick = null; p.oninput = null; p.onchange = null; p.onsubmit = null; p.onkeydown = null;
  ({ pedidos: tabRequests, agenda: tabAgenda, config: tabConfig, equipe: (x) => renderTeam(x, ctxOf(clinic())), dados: tabData, exames: tabExams, cadastros: tabClaims, concierge: tabConcierge, mensagens: tabMessages, avisos: tabReports, visitas: tabVisits })[state.tab](p);
}

// ---------- pedidos (clínica e IMED) ----------
// WhatsApp só para celular (11 dígitos, com 9 depois do DDD).
const waHref = (phone) => { const d = onlyDigits(phone); return /^[1-9]{2}9\d{8}$/.test(d) ? `https://wa.me/55${d}` : ''; };

// Situação para a clínica (fase 4.2: as situações da agenda, como "Paciente presente") ou a de hoje (pedidos ao IMED).
const stLabel = (s) => A.clinicStatusLabel(s) || statusLabel(s) || s;

function requestCard(r, withPlace) {
  const tel = telHref(r.patient_phone);
  const wa = waHref(r.patient_phone);
  const placeTel = telHref(r.place_phone);
  const slot = slotOf(r);
  const other = r.for_other === true;
  // horários no fuso da clínica (a recepção de Manaus passa ao paciente a hora de lá); pedidos ao IMED, São Paulo
  const tz = withPlace ? TZ : clinicTz();
  const rows = [
    withPlace ? ['Local', `${esc(r.place_name)}${r.place_address ? `<br><small>${esc(r.place_address)}</small>` : ''}`] : null,
    withPlace ? ['Telefone do local', r.place_phone ? (placeTel ? `<a href="${placeTel}">${esc(r.place_phone)}</a>` : esc(r.place_phone)) : 'Não informado'] : null,
    ['Exame', esc(examName(r.exam_code))],
    slot ? ['Horário marcado', `<b>${esc(fmtSlot(slot, tz))}</b>`] : null,
    slot ? null : ['Data preferida', esc(fmtDate(r.preferred_date) || r.preferred_date)],
    slot ? null : ['Período', esc(PERIODS[r.preferred_period] || r.preferred_period || '')],
    other ? ['O exame é para', `<b>${esc(r.other_name)}</b> (${esc(r.relationship)})${r.other_minor ? '<br><small class="rq-minor"><i class="fa-solid fa-child" aria-hidden="true"></i>Menor de 18 anos · autorização do responsável legal registrada no pedido</small>' : r.other_consent ? '<br><small>Quem pediu confirmou que a pessoa sabe do pedido e concordou (ou que é o representante legal dela)</small>' : ''}`] : null,
    [other ? 'Quem pediu' : 'Paciente', esc(r.patient_name)],
    r.status === 'cancelled' && CANCELLED_BY[r.cancelled_by] ? ['Cancelado', `${esc(CANCELLED_BY[r.cancelled_by])}${r.cancelled_at ? ` em ${esc(fmtDateTimeIn(r.cancelled_at, tz))}` : ''}`] : null,
    ['Telefone', `<span class="rq-contact">${tel ? `<a href="${tel}">${esc(fmtPhone(r.patient_phone))}</a>` : esc(r.patient_phone)}${wa ? ` <a href="${wa}" target="_blank" rel="noopener">WhatsApp<span class="sr"> de ${esc(r.patient_name)} (abre em nova aba)</span></a>` : ''}</span>`],
    r.patient_email ? ['E-mail', `<a href="mailto:${esc(r.patient_email)}">${esc(r.patient_email)}</a>`] : null,
    r.notes ? ['Observações', esc(r.notes)] : null,
  ].filter(Boolean);
  const hints = [r.status === 'completed' ? '' : '“Concluído” libera a avaliação do paciente', slot && r.status !== 'cancelled' ? '“Cancelado” libera o horário para outro paciente' : ''].filter(Boolean);
  // Cancelado pelo próprio paciente: ninguém reabre pelo painel (o paciente veria "Confirmado" de novo depois de
  // cancelar). Para remarcar, é preciso um novo pedido. O banco também recusa (cancelled_by_patient).
  const byPatient = r.status === 'cancelled' && r.cancelled_by === 'patient';
  // Agendamento da agenda nova (usa aparelho, sala ou profissional): a situação muda na aba Agenda (chegada, falta,
  // remarcar, cancelar com motivo), não pelos botões do pedido.
  const naAgenda = r.uses_resources === true && !withPlace;
  const acoes = naAgenda
    ? `<div class="rq-act"><span class="lbl">Chegada, atendimento, remarcação e cancelamento ficam na aba Agenda.</span>
        <button class="btn btn-ghost btn-sm" type="button" data-veragenda="${esc(r.id)}"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i>Ver na agenda<span class="sr"> o agendamento de ${esc(r.patient_name)}</span></button></div>`
    : byPatient ? `<p class="cl-note rq-locked"><i class="fa-solid fa-lock" aria-hidden="true"></i> Cancelado pelo paciente: para remarcar, é preciso um novo pedido.</p>` : `<div class="rq-act" role="group" aria-label="Mudar a situação do pedido de ${esc(r.patient_name)}">
        <span class="lbl">Mudar situação${hints.length ? ` · ${hints.join(' · ')}` : ''}:</span>
        ${ACTIONS.map((s) => `<button class="btn btn-ghost btn-sm" type="button" data-id="${esc(r.id)}" data-st="${s}" aria-pressed="${r.status === s}"${r.status === s ? ' disabled' : ''}>${esc(statusLabel(s))}</button>`).join('')}
      </div>`;
  return `<li class="rq${slot ? ' rq-has-slot' : ''}" id="rq-${esc(r.id)}">
      <div class="rq-hd"><div><h3>${esc(examName(r.exam_code))} · ${esc(other ? r.other_name : r.patient_name)}</h3><small>Pedido em ${esc(fmtDateTimeIn(r.created_at, tz))}</small>
        ${slot ? `<p class="rq-slot"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i>${naAgenda ? `Na agenda${r.channel && A.CHANNEL_LABEL[r.channel] ? ` · marcado por: ${esc(A.CHANNEL_LABEL[r.channel])}` : ''}` : r.status === 'confirmed' ? 'Agendado pelo site (confirmado)' : 'Horário escolhido pelo paciente no site'}</p>` : ''}</div>
        <span class="rq-st st-${esc(r.status)}">${esc(withPlace ? statusLabel(r.status) || r.status : stLabel(r.status))}</span></div>
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      ${acoes}
    </li>`;
}

// key: 'pedidos' ou 'concierge' (filtro e ids); cache: chave em state.lists (por clínica nos pedidos).
// Na clínica, a lista vem pela data do exame (horário marcado ou data preferida) e tem o filtro “Quando”.
function renderRequestList(p, key, intro, withPlace, cache) {
  const rows = state.lists[cache] || [];
  const again = () => renderRequestList(p, key, intro, withPlace, cache);
  const f = state.filter[key];
  const byDate = key === 'pedidos';
  const when = byDate ? state.filter.when : '';
  const tz = byDate ? clinicTz() : TZ;
  const today = A.dayIn(tz, Date.now());
  const view = () => {
    const base = byDate ? sortByAppointment(rows, today, tz) : rows;
    return base.filter((r) => (!f || r.status === f) && inWhen(r, when, today, tz));
  };
  const shown = view();
  const counts = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  // Sem contagem nas opções: só a lista aberta tem o número certo (o “Todos (n)” ao lado).
  const whenSel = byDate ? `<label class="cl-lbl" for="flt-when" style="margin:0">Quando</label>
      <select id="flt-when">${Object.entries(WHEN).map(([v, n]) => `<option value="${v}"${when === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>` : '';
  // como na aba Agenda: o aviso só quando o fuso da clínica tem hora diferente da deste aparelho
  const tzn = byDate ? A.tzNote(tz, Intl.DateTimeFormat().resolvedOptions().timeZone, Date.now()) : '';
  p.innerHTML = `<p class="cl-help">${intro}</p>
    ${tzn ? `<p class="ag-tz" id="rqTz"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>${esc(tzn)}</p>` : ''}
    <div class="cl-filter"><label class="cl-lbl" for="flt-${key}" style="margin:0">Mostrar</label>
      <select id="flt-${key}"><option value="">Todos (${rows.length})</option>${(byDate ? STATUSES : IMED_STATUSES).map((s) => `<option value="${s}"${f === s ? ' selected' : ''}>${esc(byDate ? stLabel(s) : statusLabel(s))} (${counts[s]})</option>`).join('')}</select>
      ${whenSel}
      <button class="btn btn-ghost btn-sm" type="button" id="rf-${key}"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Atualizar lista</button></div>
    ${!rows.length ? `<p class="cl-help">${when ? `Nenhum pedido para ${when === 'hoje' ? 'hoje' : 'os próximos 7 dias'}.` : 'Nenhum pedido ainda. Quando um paciente pedir agendamento, ele aparece aqui.'}</p>`
      : !shown.length ? `<p class="cl-help">${when ? 'Nenhum pedido para esse período com esse filtro.' : 'Nenhum pedido com essa situação.'}</p>`
        : `<ul class="rq-list">${shown.map((r) => requestCard(r, withPlace)).join('')}</ul>`}
    <div id="rqMsg" aria-live="polite"></div>`;
  $(`#flt-${key}`).onchange = (e) => { state.filter[key] = e.target.value; again(); $(`#flt-${key}`).focus(); };
  // Trocar o “Quando” busca de novo no banco (a lista guardada pode ter ficado velha).
  if (byDate) $('#flt-when').onchange = (e) => { state.filter.when = e.target.value; delete state.lists[listKey('pedidos')]; state.refocus = '#flt-when'; renderTab(); };
  $(`#rf-${key}`).onclick = () => { delete state.lists[cache]; state.refocus = `#rf-${key}`; renderTab(); };
  p.onclick = async (e) => {
    const va = e.target.closest('[data-veragenda]');
    if (va) {
      const r = rows.find((x) => x.id === va.dataset.veragenda);
      if (r) { state.agendaFocus = { requestId: r.id, day: apptDay(r, clinicTz()) }; selectTab('agenda', true); }
      return;
    }
    const b = e.target.closest('[data-st]');
    if (!b) return;
    const r = rows.find((x) => x.id === b.dataset.id);
    if (!r) return;
    $$('[data-st]', b.parentElement).forEach((x) => { x.disabled = true; });
    try {
      const res = await auth.rpc('set_request_status', { p_id: r.id, p_status: b.dataset.st });
      if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
      // Próximo pedido visível, para o foco não se perder se este sair do filtro.
      const visible = view().map((x) => x.id);
      const after = visible.slice(visible.indexOf(r.id) + 1).concat(visible.slice(0, visible.indexOf(r.id)).reverse());
      r.status = b.dataset.st;
      const text = `Situação do pedido de ${r.patient_name || 'paciente'} mudada para “${byDate ? stLabel(r.status) : statusLabel(r.status)}”.`;
      toast(text);
      again();
      const msgBox = $('#rqMsg', p);
      msgBox.innerHTML = `<p class="cl-note ok">${esc(text)}${f && f !== r.status ? ' Ele saiu desta lista por causa do filtro.' : ''}</p>`;
      const target = $(`#rq-${CSS.escape(r.id)} [data-st]:not([disabled])`, p)
        || after.map((id) => $(`#rq-${CSS.escape(id)} [data-st]:not([disabled])`, p)).find(Boolean)
        || $(`#flt-${key}`, p);
      target.focus();
    } catch (err) {
      if (lost()) return;
      const m = STATUS_ERR[err.result] || (err?.data?.code === '23505' ? STATUS_ERR.slot_taken : friendlyError(err, 'Não foi possível mudar a situação agora. Tente de novo.'));
      if (err.result === 'cancelled_by_patient') { r.status = 'cancelled'; r.cancelled_by = 'patient'; }
      again();
      $('#rqMsg', p).innerHTML = note(esc(m), 'err');
    }
  };
}

async function loadList(p, tab, path, render) {
  const key = listKey(tab);
  const done = () => {
    render();
    if (state.refocus) { $(state.refocus, p)?.focus(); state.refocus = null; }
  };
  if (state.lists[key]) { done(); return; }
  p.innerHTML = loading('Carregando pedidos…');
  // A resposta só vale se a pessoa ainda estiver na mesma aba e na mesma clínica (e no mesmo painel).
  const same = () => state.tab === tab && listKey(tab) === key && p.isConnected;
  try {
    let rows;
    try { rows = (await auth.select(path)) || []; } catch (err) {
      // Banco ainda sem as colunas novas (migração de confiança não aplicada): busca sem elas.
      if (err?.data?.code !== '42703' || !path.includes(TRUST_COLS)) throw err;
      rows = (await auth.select(path.replace(TRUST_COLS, ''))) || [];
    }
    if (!same()) return;
    state.lists[key] = rows;
    done();
  } catch (err) {
    if (lost()) return;
    if (!same()) return;
    state.refocus = null;
    p.innerHTML = `${note(esc(friendlyError(err, 'Não foi possível carregar os pedidos agora.')), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="retryTab">Tentar de novo</button></div>`;
    $('#retryTab').onclick = () => renderTab();
  }
}

// Consulta dos pedidos da clínica. “Hoje” e “Próximos 7 dias” filtram no banco pela data do exame:
// o gatilho preenche preferred_date a partir do horário marcado, então vale para os dois tipos de pedido.
export function requestsPath(clinicId, when, today) {
  const base = `appointment_requests?select=${REQ_COLS}&clinic_id=eq.${clinicId}`;
  if (when === 'hoje') return `${base}&preferred_date=eq.${today}&order=slot_start,created_at.desc&limit=200`;
  if (when === 'semana') return `${base}&preferred_date=gte.${today}&preferred_date=lte.${addDays(today, 6)}&order=preferred_date,slot_start,created_at.desc&limit=200`;
  return `${base}&order=created_at.desc&limit=100`;
}

function tabRequests(p) {
  const intro = 'Pedidos de agendamento feitos pelos pacientes no IMED. Os marcados num horário da sua agenda já chegam confirmados (cuide deles na aba Agenda). Nos outros, ligue ou chame no WhatsApp para combinar o horário. Atualize a situação: o paciente acompanha pela conta dele.';
  loadClinicRequests(p, intro);
}

// Pedidos da clínica pela função agenda_requests (fase 4.2: fica registrado quem leu; "hoje" e "semana" pelo dia do
// exame no fuso da clínica, calculado no banco). A equipe do IMED escolhe antes o motivo (fica registrado). Banco sem a
// função (troca de versão): a leitura direta de hoje, sem mudar mais nada.
async function loadClinicRequests(p, intro) {
  const c = clinic();
  const key = listKey('pedidos');
  const render = () => renderRequestList(p, 'pedidos', intro, false, key);
  if (state.lists[key]) { render(); if (state.refocus) { $(state.refocus, p)?.focus(); state.refocus = null; } return; }
  p.innerHTML = loading('Carregando pedidos…');
  const same = () => state.tab === 'pedidos' && listKey('pedidos') === key && p.isConnected;
  try {
    const res = await auth.rpc('agenda_requests', { p_clinic: c.id, p_when: state.filter.when || null, p_justification: state.just[c.id] || null });
    if (!same()) return;
    if (res?.status === 'justification_required') { renderJustification(p, intro); return; }
    if (res?.status !== 'ok') throw Object.assign(new Error(res?.status), { result: res?.status });
    state.reqTz = { ...(state.reqTz || {}), [c.id]: res.timezone || c.timezone || TZ };
    state.lists[key] = res.requests || [];
    render();
    if (state.refocus) { $(state.refocus, p)?.focus(); state.refocus = null; }
  } catch (err) {
    if (noFn(err)) { loadList(p, 'pedidos', requestsPath(c.id, state.filter.when, spDay(Date.now())), render); return; }
    if (lost() || !same()) return;
    state.refocus = null;
    const m = err.result === 'forbidden' ? 'Sua conta não pode ver os pedidos desta clínica.' : friendlyError(err, 'Não foi possível carregar os pedidos agora.');
    p.innerHTML = `${note(esc(m), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="retryTab">Tentar de novo</button></div>`;
    $('#retryTab').onclick = () => renderTab();
  }
}

// Equipe do IMED vendo uma clínica que não é dela: o motivo antes da lista ("quebra de vidro"; decisão 4.2-f).
function renderJustification(p, intro) {
  const c = clinic();
  p.innerHTML = `<p class="cl-help">${intro}</p>
    <section class="ac-form" aria-labelledby="rqJustT"><h3 class="ac-h" id="rqJustT" tabindex="-1">Para ver os pedidos desta clínica, escolha o motivo (fica registrado):</h3>
      <div class="cl-field"><label class="cl-lbl" for="rqJust">Motivo</label>
        <select id="rqJust" aria-describedby="rqJustErr"><option value="">Escolha o motivo</option>${A.JUSTIFICATIONS.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('')}</select>
        <span class="cl-err" id="rqJustErr"></span></div>
      <div class="cl-actions"><button class="btn btn-primary btn-sm" type="button" id="rqJustOk">Ver os pedidos</button></div></section>`;
  $('#rqJustOk', p).onclick = () => {
    const v = $('#rqJust', p).value;
    if (!v) { $('#rqJustErr', p).textContent = A.ACTION_TEXT.justification_required; $('#rqJust', p).setAttribute('aria-invalid', 'true'); $('#rqJust', p).focus(); return; }
    state.just[c.id] = v;
    delete state.lists[listKey('pedidos')];
    state.refocus = '#flt-pedidos';
    renderTab();
  };
}

function tabConcierge(p) {
  const intro = 'Pedidos feitos ao IMED para locais que ainda não são parceiros. A equipe liga para o local, combina com o paciente e atualiza a situação.';
  loadList(p, 'concierge', `appointment_requests?select=${IMED_COLS}&clinic_id=is.null&order=created_at.desc&limit=100`, () => renderRequestList(p, 'concierge', intro, true, 'concierge'));
}

// ---------- agenda (agenda.js, fase 4.2) e configuração (agenda-config.js, fase 4.1) ----------
// A aba Agenda é a agenda de verdade (Hoje, Dia, Semana, Mês e Bloqueios, com a recepção); a configuração da agenda
// nova (unidade, modalidade, horários, aparelhos, salas, profissionais e exames) fica em "Configurar agenda", só para
// quem tem agenda.configurar. Os bloqueios saíram daqui: estão na visão "Bloqueios" da aba Agenda, pelas funções.
const permsOf = (c) => (c ? state.perms[c.id] || {} : {});
const ctxOf = (c) => ({ clinic: c, perms: permsOf(c), admin: state.admin, lost, reloadAll: loadAll });

// agenda.js é grande e só serve a quem abre a aba Agenda: baixa na primeira vez (fora do CORE do sw.js até a
// publicação; ver §1.4 da especificação 4.2). Sem internet, a aba explica em vez de ficar em branco.
let agendaMod = null, agendaP = null, agendaTok = 0;
const loadAgenda = () => (agendaP ||= import('./agenda.js').then((m) => (agendaMod = m), () => { agendaP = null; return null; }));

async function tabAgenda(p) {
  const tok = ++agendaTok;
  const c = clinic();
  if (!agendaMod) p.innerHTML = '<p class="muted" role="status">Abrindo a agenda…</p>';
  const m = agendaMod || (await loadAgenda());
  // Trocou de aba ou de clínica (ou abriu a aba de novo) enquanto baixava: quem desenha é a chamada mais nova.
  if (tok !== agendaTok || state.tab !== 'agenda' || clinic()?.id !== c?.id) return;
  if (!m) {
    p.innerHTML = '<p class="muted" role="alert">Não foi possível abrir a agenda agora. Confira a internet e toque na aba de novo.</p>';
    return;
  }
  const focus = state.agendaFocus; // "Ver na agenda" (aba Pedidos) abre o dia e o detalhe do pedido
  state.agendaFocus = null;
  m.renderAgenda(p, { ...ctxOf(c), goTab: (id) => selectTab(id, true), focus });
}

function tabConfig(p) {
  const c = clinic();
  p.innerHTML = `<div id="agNote">${agendaNote(c)}</div><div id="acBox"></div>`;
  p.onclick = (e) => { const b = e.target.closest('button[data-go]'); if (b) selectTab(b.dataset.go, true); };
  renderConfig($('#acBox'), ctxOf(c));
}

function agendaNote(c) {
  if (c.status !== 'published' || !c.accepts_online_booking) {
    return note(`Os pedidos pelo site estão desligados. Ligue <b>“Aceito pedidos de agendamento pelo site”</b> em <button class="link" type="button" data-go="dados">Dados da clínica</button>${c.status !== 'published' ? ' (o cadastro também precisa ser publicado pela equipe do IMED)' : ''}.`, 'warn');
  }
  return '';
}

// ---------- dados da clínica ----------
function field(id, label, value, { type = 'text', hint = '', max = 200, extra = '', full = false } = {}) {
  return `<div class="cl-field${full ? ' full' : ''}"><label class="cl-lbl" for="${id}">${label}</label>
    <input id="${id}" type="${type}" maxlength="${max}" value="${esc(value ?? '')}" aria-describedby="${id}Err${hint ? ` ${id}Hint` : ''}" ${extra}>
    ${hint ? `<span class="cl-hint" id="${id}Hint">${hint}</span>` : ''}<span class="cl-err" id="${id}Err"></span></div>`;
}

function tabData(p) {
  const c = clinic();
  const hours = c.opening_hours && typeof c.opening_hours === 'object' ? c.opening_hours : {};
  const ins = c.insurances || [];
  const others = ins.filter((x) => !COMMON_INSURANCES.includes(x));
  p.innerHTML = `<form id="dataForm" novalidate>
    <p class="cl-help">Estes dados aparecem para os pacientes na busca do IMED. Deixe em branco o que não quiser mostrar.</p>
    <div class="cl-grid">
      ${field('dPhone', 'Telefone', c.phone, { type: 'tel', max: 25, hint: 'Como os pacientes devem ligar. Ex.: (11) 3222-1000', extra: 'inputmode="tel" autocomplete="off"' })}
      ${field('dWa', 'WhatsApp', c.whatsapp, { type: 'tel', max: 20, hint: 'Com 55 e DDD, só números. Ex.: 5511987654321', extra: 'inputmode="numeric" autocomplete="off"' })}
      ${field('dEmail', 'E-mail', c.email, { type: 'email', max: 254, extra: 'inputmode="email" autocomplete="off"' })}
      ${field('dSite', 'Site', c.website, { type: 'url', max: 300, hint: 'Começa com https://', extra: 'inputmode="url" autocomplete="off" placeholder="https://"' })}
      <div class="cl-field full"><label class="cl-lbl" for="dDesc">Descrição</label>
        <textarea id="dDesc" maxlength="1000" aria-describedby="dDescCount dDescErr">${esc(c.description || '')}</textarea>
        <span class="cl-hint" id="dDescCount">${(c.description || '').length} de 1000 caracteres</span><span class="cl-err" id="dDescErr"></span></div>
      <fieldset class="cl-fs full"><legend>Horário de atendimento</legend>
        <p class="cl-help">Escreva como quiser, por exemplo 07:00–19:00. Deixe em branco os dias fechados ou sem horário definido.</p>
        <div class="hours">${DAYS.map(([k, n]) => `<label>${n}<input id="h-${k}" type="text" maxlength="40" value="${esc(hours[k] ?? '')}" autocomplete="off"></label>`).join('')}</div>
      </fieldset>
      <div class="cl-field full"><label class="cl-check"><input id="dOnline" type="checkbox"${c.accepts_online_booking ? ' checked' : ''}><span><b>Aceito pedidos de agendamento pelo site.</b> Os pedidos aparecem na aba “Pedidos”. Por enquanto, a clínica entra em contato com o paciente para combinar o horário. Quando o IMED liberar a marcação pelo site, o paciente vai poder escolher um horário livre da agenda (montada em “Configurar agenda”).</span></label></div>
      <div class="cl-field full"><label class="cl-lbl" for="dSpec">Especialidades</label>
        <input id="dSpec" type="text" maxlength="1500" value="${esc((c.specialties || []).join(', '))}" aria-describedby="dSpecHint dSpecErr" autocomplete="off">
        <span class="cl-hint" id="dSpecHint">Separe por vírgula. Até 30. Ex.: Cardiologia, Radiologia</span><span class="cl-err" id="dSpecErr"></span></div>
      <fieldset class="cl-fs full"><legend>Convênios aceitos</legend>
        <p class="cl-help">Marque só os convênios que a clínica aceita de fato.</p>
        <div class="ins">${COMMON_INSURANCES.map((n, i) => `<label class="cl-check"><input type="checkbox" name="ins" id="ins-${i}" value="${esc(n)}"${ins.includes(n) ? ' checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div>
        <label class="cl-lbl" for="dInsOther" style="margin-top:12px">Outros convênios <small>(separe por vírgula)</small></label>
        <input id="dInsOther" type="text" maxlength="1500" value="${esc(others.join(', '))}" autocomplete="off">
      </fieldset>
    </div>
    <div class="cl-actions"><button class="btn btn-coral" type="submit" id="dSave">Salvar dados</button></div>
    <div id="dMsg" aria-live="polite"></div>
  </form>`;
  $('#dDesc').oninput = (e) => { $('#dDescCount').textContent = `${e.target.value.length} de 1000 caracteres`; };
  $('#dataForm').onsubmit = saveData;
}

const splitList = (v) => [...new Set(String(v || '').split(/[,;\n]/).map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean))];

export function collectClinicData(get) {
  const errs = {};
  const phone = get('dPhone').trim();
  if (phone && (phone.length < 8 || phone.length > 25 || onlyDigits(phone).length < 8)) errs.dPhone = 'Telefone inválido. Ex.: (11) 3222-1000';
  const wa = onlyDigits(get('dWa'));
  if (wa && !/^55\d{10,11}$/.test(wa)) errs.dWa = 'Use 55 + DDD + número, só dígitos (12 ou 13 números).';
  const email = get('dEmail').trim().toLowerCase();
  if (email && !isValidEmail(email)) errs.dEmail = 'E-mail inválido.';
  let site = get('dSite').trim();
  if (site && !/^https?:\/\//i.test(site)) site = `https://${site}`;
  if (site && !/^https?:\/\/[^\s/.]+\.[^\s]+$/i.test(site)) errs.dSite = 'Endereço inválido. Ex.: https://www.suaclinica.com.br';
  const description = get('dDesc').trim();
  if (description.length > 1000) errs.dDesc = 'Use até 1000 caracteres.';
  const opening = {};
  for (const [k] of DAYS) { const v = get(`h-${k}`).trim().slice(0, 40); if (v) opening[k] = v; }
  const specialties = splitList(get('dSpec')).map((x) => x.slice(0, 60));
  if (specialties.length > 30) errs.dSpec = 'Informe até 30 especialidades.';
  const insurances = [...new Set([...get('ins'), ...splitList(get('dInsOther')).map((x) => x.slice(0, 60))])];
  const p = {
    phone: phone || null,
    whatsapp: wa || null,
    email: email || null,
    website: site || null,
    description: description || null,
    opening_hours: Object.keys(opening).length ? opening : null,
    accepts_online_booking: !!get('dOnline'),
    specialties,
    insurances,
  };
  return { p, errs };
}

async function saveData(e) {
  e.preventDefault();
  const c = clinic();
  const get = (id) => {
    if (id === 'ins') return $$('input[name="ins"]:checked').map((x) => x.value);
    const el = $(`#${id}`);
    return el.type === 'checkbox' ? el.checked : el.value;
  };
  const { p, errs } = collectClinicData(get);
  let first = null;
  for (const id of ['dPhone', 'dWa', 'dEmail', 'dSite', 'dDesc', 'dSpec']) {
    const el = $(`#${id}`);
    $(`#${id}Err`).textContent = errs[id] || '';
    if (errs[id]) { el.setAttribute('aria-invalid', 'true'); first ||= el; } else el.removeAttribute('aria-invalid');
  }
  $('#dMsg').innerHTML = '';
  if (first) { first.focus(); return; }
  const btn = $('#dSave');
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  try {
    const res = await auth.rpc('update_my_clinic', { p_clinic: c.id, p });
    if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
    Object.assign(c, p);
    $('#clinicNotes').innerHTML = clinicNotes(c);
    $('#dMsg').innerHTML = note(c.status === 'published' ? 'Dados salvos. Já aparecem para os pacientes na busca.' : 'Dados salvos. Vão aparecer na busca quando o cadastro for publicado.', 'ok');
    toast('Dados salvos.');
  } catch (err) {
    if (lost()) return;
    const m = err.result === 'forbidden' ? 'Sua conta não pode mudar os dados desta clínica.' : friendlyError(err, 'Não foi possível salvar agora. Tente de novo em instantes.');
    $('#dMsg').innerHTML = note(esc(m), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar dados';
    // O botão desligado perde o foco: devolve para quem usa teclado.
    if (btn.isConnected && (!document.activeElement || document.activeElement === document.body)) btn.focus();
  }
}

// ---------- exames e preços ----------
async function tabExams(p) {
  const c = clinic();
  const key = `exames:${c.id}`;
  if (!state.lists[key]) {
    p.innerHTML = loading('Carregando exames…');
    try {
      const rows = (await auth.select(`clinic_exams?select=exam_code,price_cents&clinic_id=eq.${c.id}`)) || [];
      if (state.clinicId !== c.id || !p.isConnected) return;
      state.lists[key] = rows;
    } catch (err) {
      if (lost() || state.clinicId !== c.id || !p.isConnected) return;
      p.innerHTML = `${note(esc(friendlyError(err, 'Não foi possível carregar os exames agora.')), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="retryTab">Tentar de novo</button></div>`;
      $('#retryTab').onclick = () => renderTab();
      return;
    }
    if (state.tab !== 'exames') return;
  }
  const have = Object.fromEntries(state.lists[key].map((x) => [x.exam_code, x.price_cents]));
  p.innerHTML = `<form id="examForm" novalidate>
    <p class="cl-help">Marque os exames que a clínica faz. O preço é opcional: em branco, aparece “sob consulta”. Use o preço particular, à vista.</p>
    <ul class="ex-list">${EXAM_CODES.map((code) => {
      const on = code in have;
      return `<li class="ex${on ? ' on' : ''}" data-code="${code}">
        <label class="cl-check"><input type="checkbox" id="ex-${code}"${on ? ' checked' : ''}><span><b>${esc(EXAMS[code].n)}</b></span></label>
        <div><label class="sr" for="pr-${code}">Preço de ${esc(EXAMS[code].n)} em reais</label>
          <div class="ex-price"><span aria-hidden="true">R$</span><input id="pr-${code}" type="text" inputmode="decimal" maxlength="12" placeholder="sob consulta" value="${on ? esc(centsToInput(have[code])) : ''}"${on ? '' : ' disabled'} aria-describedby="pr-${code}Err"></div>
          <span class="cl-err" id="pr-${code}Err"></span></div>
      </li>`;
    }).join('')}</ul>
    <div class="cl-actions"><button class="btn btn-coral" type="submit" id="exSave">Salvar exames e preços</button></div>
    <div id="exCheck" hidden style="margin-top:12px"></div>
    <div id="exMsg" aria-live="polite"></div>
  </form>`;
  EXAM_CODES.forEach((code) => {
    $(`#ex-${code}`).onchange = (e) => {
      const inp = $(`#pr-${code}`);
      inp.disabled = !e.target.checked;
      e.target.closest('.ex').classList.toggle('on', e.target.checked);
      if (e.target.checked) inp.focus();
    };
  });
  // Mudou um preço ou um exame depois do "Confira o valor": a pergunta sai e o próximo "Salvar" confere de novo.
  $('#examForm').addEventListener('input', hidePriceCheck);
  $('#examForm').onsubmit = (e) => saveExams(e, key);
}

// Limite largo de cada exame, em centavos, só para pegar erro de digitação (um zero a mais ou a vírgula esquecida:
// 45000 no lugar de 450,00). Nunca aparece para o paciente nem na pergunta e não é preço de referência: acima dele,
// o painel só pede para conferir o valor na própria página antes de salvar. Um exame caro e verdadeiro é salvo
// depois da confirmação, nunca recusado (a recusa continua só fora de R$ 1 a R$ 100.000).
export const PRICE_CHECK_CENTS = { rx: 500000, usg: 500000, tc: 1000000, rm: 2000000, mamo: 500000, dens: 500000, ecg: 500000, eco: 500000, lab: 500000 };
export const priceNeedsCheck = (code, cents) => Number.isFinite(cents) && cents > (PRICE_CHECK_CENTS[code] ?? Infinity);
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtBRL = (cents) => BRL.format(cents / 100);
const priceCheckHtml = (x) => `Confira o valor: <b>${esc(fmtBRL(x.price_cents))}</b> para ${esc(EXAMS[x.code]?.n || x.code)} está certo?`;

// check: os exames marcados com preço acima do limite largo (pedem confirmação antes de salvar).
export function collectExams(get) {
  const list = [];
  const errs = {};
  for (const code of EXAM_CODES) {
    const { on, price } = get(code);
    if (!on) continue;
    const cents = parsePrice(price);
    if (cents !== null && (Number.isNaN(cents) || cents < 100 || cents > 10000000)) { errs[code] = 'Preço inválido. Use um valor entre R$ 1 e R$ 100.000, como 250 ou 250,00.'; continue; }
    list.push({ code, price_cents: cents });
  }
  return { list, errs, check: list.filter((x) => priceNeedsCheck(x.code, x.price_cents)) };
}

// Pergunta na própria página (sem janela do navegador): "Confira o valor: R$ 30.000,00 para Raio-X está certo?".
// Sem o "Sim", nada é salvo. O "Sim" vale só para aquele valor, nesta página aberta.
function showPriceCheck(items, key) {
  const box = $('#exCheck');
  const many = items.length > 1;
  box.innerHTML = `<div class="cl-note warn" role="group" aria-labelledby="exCheckQ" aria-describedby="exCheckWhy" tabindex="-1">
      <div id="exCheckQ" style="display:grid;gap:6px">${items.map((x) => `<p><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${priceCheckHtml(x)}</p>`).join('')}</div>
      <p id="exCheckWhy" style="margin-top:6px">Um zero a mais ou a vírgula esquecida mudam muito o preço que o paciente vê. ${many ? 'Se os valores estiverem certos, confirme para salvar.' : 'Se o valor estiver certo, confirme para salvar.'}</p>
      <div class="cl-actions" style="margin-top:12px">
        <button class="btn btn-coral btn-sm" type="button" id="exCheckOk">${many ? 'Sim, salvar estes valores' : 'Sim, salvar este valor'}</button>
        <button class="btn btn-ghost btn-sm" type="button" id="exCheckFix">Não, corrigir</button>
      </div>
    </div>`;
  box.hidden = false;
  // data-check: é aviso para conferir, não erro (em âmbar, como a caixa: estilo no painel.html); hidePriceCheck tira.
  items.forEach((x) => { const s = $(`#pr-${x.code}Err`); s.textContent = 'Confira se este valor está certo.'; s.dataset.check = ''; });
  $('#exCheckOk').onclick = () => {
    const c = clinic();
    items.forEach((x) => { state.priceOk[`${c.id}:${x.code}`] = x.price_cents; });
    saveExams(null, key);
  };
  $('#exCheckFix').onclick = () => { const inp = $(`#pr-${items[0].code}`); inp.focus(); inp.select(); };
  $('[role="group"]', box).focus();
}

function hidePriceCheck() {
  const box = $('#exCheck');
  if (box && !box.hidden) { box.hidden = true; box.innerHTML = ''; }
  $$('#examForm [data-check]').forEach((s) => { s.textContent = ''; s.removeAttribute('data-check'); });
}

async function saveExams(e, key) {
  e?.preventDefault();
  const c = clinic();
  hidePriceCheck();
  const { list, errs, check } = collectExams((code) => ({ on: $(`#ex-${code}`).checked, price: $(`#pr-${code}`).value }));
  let first = null;
  for (const code of EXAM_CODES) {
    const inp = $(`#pr-${code}`);
    $(`#pr-${code}Err`).textContent = errs[code] || '';
    if (errs[code]) { inp.setAttribute('aria-invalid', 'true'); first ||= inp; } else inp.removeAttribute('aria-invalid');
  }
  $('#exMsg').innerHTML = '';
  if (first) { first.focus(); return; }
  // Valor acima do limite largo do exame e ainda não conferido: pergunta antes; sem confirmar, não salva.
  const pending = check.filter((x) => state.priceOk[`${c.id}:${x.code}`] !== x.price_cents);
  if (pending.length) { showPriceCheck(pending, key); return; }
  const btn = $('#exSave');
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  try {
    const res = await auth.rpc('set_my_clinic_exams', { p_clinic: c.id, p_exams: list });
    if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
    state.lists[key] = list.map((x) => ({ exam_code: x.code, price_cents: x.price_cents }));
    list.forEach((x) => { $(`#pr-${x.code}`).value = centsToInput(x.price_cents); });
    $('#exMsg').innerHTML = note(list.length ? 'Exames e preços salvos.' : 'Salvo. Nenhum exame marcado.', 'ok');
    toast('Exames e preços salvos.');
  } catch (err) {
    if (lost()) return;
    const m = err.result === 'forbidden' ? 'Sua conta não pode mudar os exames desta clínica.' : friendlyError(err, 'Não foi possível salvar agora. Tente de novo em instantes.');
    $('#exMsg').innerHTML = note(esc(m), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar exames e preços';
    // O botão desligado perde o foco: devolve para quem usa teclado.
    if (btn.isConnected && (!document.activeElement || document.activeElement === document.body)) btn.focus();
  }
}

// ---------- equipe do IMED: pedidos de cadastro ----------
const cnesFicha = (cityCode, cnes) => (cityCode && /^\d{7}$/.test(cnes) ? `https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/${String(cityCode).padStart(6, '0')}${cnes}` : '');
const CK_NEED = 'Para aprovar, marque as quatro conferências e informe o conselho e o número do registro.';
const CK_READY = 'Conferência completa: pode aprovar.';
// Onde conferir o registro: o CFM tem a busca de médicos; os outros conselhos, no site do conselho regional.
function councilLink(council) {
  const url = T.COUNCIL_LINKS?.[council];
  if (url) return `<a href="${esc(url)}" target="_blank" rel="noopener">Busca de médicos do CFM<span class="sr"> (abre em nova aba)</span></a>`;
  return council ? 'Confira o registro no site do conselho regional da profissão, com o nome e o número.' : 'Escolha o conselho para ver onde conferir.';
}

async function tabClaims(p) {
  p.innerHTML = loading('Carregando pedidos de cadastro…');
  let pending; let decided; let est = {}; let mun = {};
  try {
    [pending, decided] = await Promise.all([
      auth.select('establishment_claims?select=*&status=eq.pending&order=created_at'),
      auth.select('establishment_claims?select=*&status=neq.pending&order=decided_at.desc.nullslast&limit=20'),
    ]);
    const codes = [...new Set([...pending, ...decided].map((r) => r.cnes).filter((c) => /^\d{7}$/.test(c)))];
    if (codes.length) {
      const rows = (await auth.select(`establishments?select=cnes,name,kind,address_line,neighborhood,cep,phone,city_ibge&cnes=in.(${codes.join(',')})`)) || [];
      est = Object.fromEntries(rows.map((r) => [r.cnes, r]));
      const ibges = [...new Set(rows.map((r) => Number(r.city_ibge)).filter(Boolean))];
      if (ibges.length) {
        const ms = (await auth.select(`municipalities?select=ibge,name,uf,cnes_code&ibge=in.(${ibges.join(',')})`)) || [];
        mun = Object.fromEntries(ms.map((m) => [m.ibge, m]));
      }
    }
  } catch (err) {
    if (lost()) return;
    p.innerHTML = `${note(esc(friendlyError(err, 'Não foi possível carregar os pedidos de cadastro agora.')), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="retryTab">Tentar de novo</button></div>`;
    $('#retryTab').onclick = () => renderTab();
    return;
  }
  // Conferência já salva de cada pedido em análise (claim_checks). Sem resposta: começa em branco.
  let checks = {};
  if (pending.length) {
    try {
      const ids = pending.map((r) => String(r.id)).filter((v) => /^[\w-]{1,64}$/.test(v));
      const rows = ids.length ? (await auth.select(`claim_checks?select=*&claim_id=in.(${ids.join(',')})`)) || [] : [];
      checks = Object.fromEntries(rows.map((c) => [c.claim_id, c]));
    } catch { checks = {}; }
  }
  if (state.tab !== 'cadastros' || !p.isConnected) return;
  const placeOf = (r) => {
    const e = est[r.cnes];
    const m = e ? mun[e.city_ibge] : null;
    return { e, m, link: cnesFicha(m?.cnes_code, r.cnes) };
  };
  const checkHtml = (r, e, link) => {
    const ck = checks[r.id] || null;
    const id = esc(r.id);
    const cnesTel = e?.phone ? (telHref(e.phone) ? `<a href="${telHref(e.phone)}">${esc(e.phone)}</a>` : esc(e.phone)) : 'não informado no CNES';
    const extra = {
      cnes_active: link ? '' : ' Sem link do CNES: confira pelo código no site do CNES.',
      cnpj_active: ' <a href="https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp" target="_blank" rel="noopener">Consulta de CNPJ da Receita<span class="sr"> (abre em nova aba)</span></a>',
      phone_confirmed: ` Telefone do CNES: ${cnesTel}.`,
      council_active: '',
    };
    const council = ck?.council && T.isCouncil(ck.council) ? ck.council : '';
    const councilBox = `<div class="ck-council">
        <div><label class="cl-lbl" for="ckc-${id}">Conselho do profissional responsável</label>
          <select id="ckc-${id}" data-ck="council"><option value="">Escolha o conselho</option>${T.COUNCILS.map(([v, n]) => `<option value="${v}"${council === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div><label class="cl-lbl" for="ckr-${id}">Número do registro, com a UF</label>
          <input id="ckr-${id}" type="text" data-ck="council_number" maxlength="30" autocomplete="off" placeholder="Ex.: 123456-SP" value="${esc(ck?.council_number || '')}"></div>
        <p class="cl-hint" data-ck-link>${councilLink(council)}</p>
      </div>`;
    return `<fieldset class="ck" data-claim="${id}"><legend>Conferência antes de aprovar <small>(obrigatória, fica gravada com a data)</small></legend>
        ${T.CLAIM_CHECKS.map(([k, title, help]) => `<label class="cl-check ck-item"><input type="checkbox" data-ck="${k}"${ck?.[k] ? ' checked' : ''}><span><b>${esc(title)}</b><small>${esc(help)}${extra[k]}</small></span></label>`).join('')}
        ${councilBox}
        <label class="cl-lbl" for="ckn-${id}" style="margin-top:10px">Observação da conferência <small>(opcional, só a equipe vê; ex.: registro conferido no site do conselho em 30/10)</small></label>
        <input id="ckn-${id}" type="text" data-ck="note" maxlength="300" autocomplete="off" value="${esc(ck?.note || '')}">
        <p class="cl-hint" data-ck-saved>${ck ? `Conferência salva em ${esc(fmtDateTime(ck.checked_at))}.` : 'Conferência ainda não salva.'}</p>
        <div class="cl-row"><button class="btn btn-ghost btn-sm" type="button" data-save-checks="${id}">Salvar conferência</button></div>
      </fieldset>`;
  };
  const card = (r) => {
    const { e, m, link } = placeOf(r);
    const tel = telHref(r.phone);
    const complete = T.checksComplete(checks[r.id]);
    return `<li class="rq" id="cl-${esc(r.id)}">
      <div class="rq-hd"><div><h3>${esc(e?.name || 'Estabelecimento não encontrado no mapa')}</h3>
        <small>CNES ${esc(r.cnes)}${e ? ` · ${esc(kindName(e.kind))}` : ''} · pedido em ${esc(fmtDateTime(r.created_at))}</small></div>
        <span class="rq-st st-pending">${esc(CLAIM_STATUS[r.status])}</span></div>
      <dl>
        ${e ? `<dt>Endereço</dt><dd>${esc([e.address_line, e.neighborhood, m && `${m.name} - ${m.uf}`].filter(Boolean).join(' · '))}</dd>` : ''}
        <dt>Conferir</dt><dd>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">Ficha no CNES<span class="sr"> (abre em nova aba)</span></a>` : 'Sem link do CNES'}</dd>
        <dt>Solicitante</dt><dd>${esc(r.claimant_name)}</dd>
        <dt>Cargo</dt><dd>${esc(ROLES[r.role] || r.role)}</dd>
        <dt>${onlyDigits(r.document).length === 14 ? 'CNPJ' : 'CPF'}</dt><dd><span data-doc="${esc(r.id)}">${esc(hideDoc(r.document))}</span> <button class="link" type="button" data-show="${esc(r.id)}" aria-expanded="false">Mostrar</button></dd>
        <dt>Registro informado</dt><dd>${r.crm ? esc(r.crm) : 'Não informado'}</dd>
        <dt>Celular</dt><dd>${tel ? `<a href="${tel}">${esc(fmtPhone(r.phone))}</a>` : esc(r.phone)}</dd>
        <dt>E-mail</dt><dd>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : 'Não informado'}</dd>
        ${r.message ? `<dt>Mensagem</dt><dd>${esc(r.message)}</dd>` : ''}
      </dl>
      ${checkHtml(r, e, link)}
      <div class="rq-act" role="group" aria-label="Decidir o pedido de ${esc(r.claimant_name)}">
        <button class="btn btn-primary btn-sm" type="button" data-approve="${esc(r.id)}"${complete ? '' : ' disabled'} aria-describedby="cka-${esc(r.id)}">Aprovar</button>
        <span class="cl-hint ck-need" id="cka-${esc(r.id)}">${complete ? CK_READY : CK_NEED}</span>
        <button class="btn btn-danger btn-sm" type="button" data-reject="${esc(r.id)}" aria-expanded="false" aria-controls="rj-${esc(r.id)}">Recusar</button>
        <div class="rq-more" id="rj-${esc(r.id)}" hidden style="width:100%">
          <label class="cl-lbl" for="note-${esc(r.id)}">Motivo da recusa <small>(a pessoa vê este texto)</small></label>
          <textarea id="note-${esc(r.id)}" maxlength="300"></textarea>
          <div class="cl-row"><button class="btn btn-danger btn-sm" type="button" data-confirm-reject="${esc(r.id)}">Confirmar recusa</button></div>
        </div>
        <div class="cl-msg" data-msg="${esc(r.id)}" aria-live="polite" style="width:100%"></div>
      </div>
    </li>`;
  };
  const cls = { approved: 'bd-ok', rejected: 'bd-err' };
  p.innerHTML = `<p class="cl-help">Antes de aprovar, faça a conferência de cada pedido: CNES ativo, CNPJ ativo, ligação para o telefone oficial do CNES confirmando quem pediu e registro ativo do profissional responsável pelo local no conselho da profissão dele (CRM, CRF, CRBM, CRO…). Ela fica gravada com a data, que aparece na página do parceiro como “Verificado pelo IMED em”. Ao aprovar, o estabelecimento vira clínica parceira e a pessoa passa a cuidar do cadastro.</p>
    <h3 style="font-size:16px;margin:4px 0 10px">Aguardando decisão (${pending.length})</h3>
    ${pending.length ? `<ul class="rq-list">${pending.map(card).join('')}</ul>` : '<p class="cl-help">Nenhum pedido aguardando.</p>'}
    <h3 style="font-size:16px;margin:22px 0 10px">Decididos recentemente</h3>
    ${decided.length ? `<ul class="cl-list">${decided.map((r) => `<li><span><b>${esc(est[r.cnes]?.name || `CNES ${r.cnes}`)}</b>
        <small>${esc(r.claimant_name)}${r.decided_at ? ` · ${esc(fmtDateTime(r.decided_at))}` : ''}</small>${r.decision_note ? `<small>Motivo: ${esc(r.decision_note)}</small>` : ''}</span>
        <span class="bd ${cls[r.status] || ''}">${esc(CLAIM_STATUS[r.status] || r.status)}</span></li>`).join('')}</ul>` : '<p class="cl-help">Nenhum ainda.</p>'}`;
  // Marcar ou desmarcar uma conferência (ou trocar o conselho e o número) libera ou trava o "Aprovar".
  const refreshApprove = (box) => {
    const id = box.dataset.claim;
    const ok = T.checksComplete(payloadOf(id));
    $(`#cl-${CSS.escape(id)} [data-approve]`, p).disabled = !ok;
    $(`#cka-${CSS.escape(id)}`, p).textContent = ok ? CK_READY : CK_NEED;
  };
  p.onchange = (ev) => {
    const box = ev.target.closest('fieldset.ck');
    if (!box) return;
    if (ev.target.dataset.ck === 'council') $('[data-ck-link]', box).innerHTML = councilLink(ev.target.value);
    refreshApprove(box);
  };
  p.oninput = (ev) => {
    const box = ev.target.closest('fieldset.ck');
    if (box && ev.target.dataset.ck === 'council_number') refreshApprove(box);
  };
  const payloadOf = (id) => {
    const box = $(`fieldset.ck[data-claim="${CSS.escape(id)}"]`, p);
    return T.checksPayload((k) => {
      const el = $(`[data-ck="${k}"]`, box);
      return el?.type === 'checkbox' ? el.checked : el?.value ?? '';
    });
  };
  const saveChecks = async (id) => {
    const res = await auth.rpc('save_claim_checks', { p_claim: id, p_checks: payloadOf(id) });
    if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
  };
  p.onclick = async (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    const msg = (id) => $(`[data-msg="${CSS.escape(id)}"]`, p);
    if (t.dataset.saveChecks) {
      const id = t.dataset.saveChecks;
      t.disabled = true;
      msg(id).className = 'cl-msg';
      msg(id).textContent = 'Salvando a conferência…';
      try {
        await saveChecks(id);
        msg(id).textContent = 'Conferência salva.';
        msg(id).classList.add('ok');
        const saved = $(`fieldset.ck[data-claim="${CSS.escape(id)}"] [data-ck-saved]`, p);
        if (saved) saved.textContent = `Conferência salva em ${fmtDateTime(new Date().toISOString())}.`;
        toast('Conferência salva.');
      } catch (err) {
        if (lost()) return;
        msg(id).textContent = err.result === 'already_decided' ? 'Este pedido já foi decidido.' : err.result === 'forbidden' ? 'Só a equipe do IMED faz a conferência.' : friendlyError(err, 'Não foi possível salvar a conferência agora. Tente de novo.');
        msg(id).classList.add('err');
      } finally { t.disabled = false; }
      return;
    }
    if (t.dataset.show) {
      const r = pending.find((x) => x.id === t.dataset.show);
      const span = $(`[data-doc="${CSS.escape(r.id)}"]`, p);
      const open = t.getAttribute('aria-expanded') === 'true';
      span.textContent = open ? hideDoc(r.document) : maskDoc(r.document);
      t.setAttribute('aria-expanded', String(!open));
      t.textContent = open ? 'Mostrar' : 'Esconder';
    } else if (t.dataset.reject) {
      const box = $(`#rj-${CSS.escape(t.dataset.reject)}`, p);
      box.hidden = !box.hidden;
      t.setAttribute('aria-expanded', String(!box.hidden));
      if (!box.hidden) $('textarea', box).focus();
    } else if (t.dataset.approve || t.dataset.confirmReject) {
      const id = t.dataset.approve || t.dataset.confirmReject;
      const btns = $$(`#cl-${CSS.escape(id)} button`, p);
      btns.forEach((b) => { b.disabled = true; });
      msg(id).className = 'cl-msg';
      msg(id).textContent = 'Salvando…';
      try {
        if (t.dataset.approve) {
          // Primeiro grava a conferência (com a data); o banco só aprova com as quatro marcadas.
          await saveChecks(id);
          await auth.rpc('approve_claim', { p_claim: id });
          toast('Pedido aprovado. A clínica já aparece como parceira, com a data da conferência.');
        } else {
          const noteText = $(`#note-${CSS.escape(id)}`, p).value.trim().slice(0, 300);
          await auth.rpc('reject_claim', { p_claim: id, p_note: noteText || null });
          toast('Pedido recusado.');
        }
        tabClaims(p);
      } catch (err) {
        if (lost()) return;
        btns.forEach((b) => { b.disabled = false; });
        const ok = T.checksComplete(payloadOf(id));
        const ap = $(`#cl-${CSS.escape(id)} [data-approve]`, p);
        if (ap) ap.disabled = !ok;
        if (err.result === 'already_decided') { msg(id).textContent = 'Este pedido já foi decidido.'; msg(id).classList.add('err'); return; }
        const dbMsg = err?.data?.code === '22023' ? err.data.message : '';
        msg(id).textContent = dbMsg || friendlyError(err, 'Não foi possível salvar a decisão agora. Tente de novo.');
        msg(id).classList.add('err');
      }
    }
  };
}

// ---------- equipe do IMED: mensagens do Fale com o IMED ----------
const SUBJECT = Object.fromEntries(T.CONTACT_SUBJECTS.map(([k, l]) => [k, l]));
const MSG_FILTER = { open: 'Em aberto', answered: 'Respondidas', '': 'Todas' };
// WhatsApp só para celular (11 dígitos, com 9 depois do DDD).
const waPhone = (d) => (/^[1-9]{2}9\d{8}$/.test(d || '') ? `https://wa.me/55${d}` : '');

async function adminList(p, tab, path, render) {
  p.innerHTML = loading('Carregando…');
  const same = () => state.tab === tab && p.isConnected;
  try {
    const rows = (await auth.select(path)) || [];
    if (!same()) return;
    render(rows);
    if (state.refocus) { $(state.refocus, p)?.focus(); state.refocus = null; }
  } catch (err) {
    if (lost() || !same()) return;
    state.refocus = null;
    p.innerHTML = `${note(esc(friendlyError(err, 'Não foi possível carregar agora. Tente de novo em instantes.')), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="retryTab">Tentar de novo</button></div>`;
    $('#retryTab').onclick = () => renderTab();
  }
}

function tabMessages(p) {
  const f = state.filter.msg ?? 'open';
  const path = `contact_messages?select=*&order=created_at.desc&limit=200${f ? `&status=eq.${f}` : ''}`;
  adminList(p, 'mensagens', path, (rows) => {
    const item = (r) => {
      const tel = r.reply_phone ? telHref(r.reply_phone) : '';
      const wa = waPhone(r.reply_phone);
      const reply = r.reply_email ? `<a href="mailto:${esc(r.reply_email)}?subject=${encodeURIComponent(`IMED · protocolo ${r.protocol}`)}">${esc(r.reply_email)}</a>`
        : `${tel ? `<a href="${tel}">${esc(fmtPhone(r.reply_phone))}</a>` : esc(r.reply_phone)}${wa ? ` <a href="${wa}" target="_blank" rel="noopener">WhatsApp<span class="sr"> (abre em nova aba)</span></a>` : ''}`;
      const answered = r.status === 'answered';
      return `<li class="rq" id="msg-${esc(r.id)}">
        <div class="rq-hd"><div><h3>${esc(SUBJECT[r.subject] || r.subject)}${r.flagged ? '<span class="bd-warn">Pode ser robô</span>' : ''}</h3><small>Protocolo ${esc(r.protocol)} · ${esc(fmtDateTime(r.created_at))}</small></div>
          <span class="rq-st ${answered ? 'st-completed' : 'st-pending'}">${answered ? 'Respondida' : 'Em aberto'}</span></div>
        ${r.flagged ? note('Chegou numa hora com muitas mensagens de todo mundo (100 ou mais): pode ser robô. Confira antes de responder.', 'warn') : ''}
        ${T.isLgpdSubject(r.subject) ? note('Pedido sobre dados pessoais (LGPD): confirme que quem pede é o dono dos dados antes de mostrar, corrigir ou apagar qualquer coisa.', 'warn') : ''}
        <dl>
          <dt>Nome</dt><dd>${esc(r.name)}</dd>
          <dt>Responder por</dt><dd><span class="rq-contact">${reply}</span></dd>
          ${r.account_email ? `<dt>Conta no IMED</dt><dd>${esc(r.account_email)} <small>(estava logado ao enviar)</small></dd>` : ''}
          ${r.request_code ? `<dt>Protocolo do pedido</dt><dd>${esc(r.request_code)}</dd>` : ''}
          <dt>Mensagem</dt><dd class="msg-body">${esc(r.message)}</dd>
          ${answered && r.answered_at ? `<dt>Respondida em</dt><dd>${esc(fmtDateTime(r.answered_at))}</dd>` : ''}
        </dl>
        <div class="rq-act"><button class="btn btn-ghost btn-sm" type="button" data-msg-status="${answered ? 'open' : 'answered'}" data-id="${esc(r.id)}">${answered ? 'Voltar para em aberto' : 'Marcar como respondida'}<span class="sr"> a mensagem ${esc(r.protocol)}</span></button></div>
      </li>`;
    };
    p.innerHTML = `<p class="cl-help">Mensagens do <a class="link" href="contato.html">Fale com o IMED</a>. Responda pelo contato que a pessoa deixou, citando o protocolo, e marque como respondida.</p>
      <div class="cl-filter"><label class="cl-lbl" for="flt-msg" style="margin:0">Mostrar</label>
        <select id="flt-msg">${Object.entries(MSG_FILTER).map(([v, n]) => `<option value="${v}"${f === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" type="button" id="rf-msg"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Atualizar lista</button></div>
      ${rows.length ? `<ul class="rq-list">${rows.map(item).join('')}</ul>` : `<p class="cl-help">${f === 'open' ? 'Nenhuma mensagem em aberto.' : 'Nenhuma mensagem.'}</p>`}
      <div id="msgMsg" aria-live="polite"></div>`;
    $('#flt-msg').onchange = (e) => { state.filter.msg = e.target.value; state.refocus = '#flt-msg'; renderTab(); };
    $('#rf-msg').onclick = () => { state.refocus = '#rf-msg'; renderTab(); };
    p.onclick = async (e) => {
      const b = e.target.closest('[data-msg-status]');
      if (!b) return;
      b.disabled = true;
      try {
        const res = await auth.rpc('set_contact_status', { p_id: b.dataset.id, p_status: b.dataset.msgStatus });
        if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
        const r = rows.find((x) => x.id === b.dataset.id);
        toast(b.dataset.msgStatus === 'answered' ? `Mensagem ${r?.protocol || ''} marcada como respondida.` : 'Mensagem de volta para em aberto.');
        state.refocus = '#flt-msg';
        renderTab();
      } catch (err) {
        if (lost()) return;
        b.disabled = false;
        $('#msgMsg', p).innerHTML = note(esc(err.result === 'forbidden' ? 'Só a equipe do IMED cuida das mensagens.' : err.result === 'not_found' ? 'Esta mensagem não existe mais.' : friendlyError(err, 'Não foi possível salvar agora. Tente de novo.')), 'err');
      }
    };
  });
}

// ---------- equipe do IMED: avisos "Algo errado aqui?" ----------
const REPORT_FILTER = { open: 'Em aberto', resolved: 'Resolvidos', '': 'Todos' };
function tabReports(p) {
  const f = state.filter.rep ?? 'open';
  const path = `place_reports?select=*,establishments(name,address_line,neighborhood,phone,municipalities(name,uf,cnes_code)),clinics(name,city,state,cnes)&order=created_at.desc&limit=200${f ? `&status=eq.${f}` : ''}`;
  adminList(p, 'avisos', path, (rows) => {
    const item = (r) => {
      const est = r.establishments || null;
      const cli = r.clinics || null;
      const m = est?.municipalities || null;
      const name = cli?.name || est?.name || (r.cnes ? `CNES ${r.cnes}` : 'Local');
      const where = cli ? [cli.city, cli.state].filter(Boolean).join(' - ') : [est?.address_line, est?.neighborhood, m && `${m.name} - ${m.uf}`].filter(Boolean).join(' · ');
      const page = r.clinic_id ? `local.html?id=${encodeURIComponent(r.clinic_id)}` : `local.html?cnes=${encodeURIComponent(r.cnes)}`;
      const ficha = r.cnes ? cnesFicha(m?.cnes_code, r.cnes) : '';
      const done = r.status === 'resolved';
      // O mesmo problema do mesmo local vira um aviso só, com o número de vezes e até 5 textos diferentes a mais.
      const times = Number.isInteger(r.repeats) && r.repeats > 0 ? r.repeats : 1;
      const notes = [r.note, ...(Array.isArray(r.more_notes) ? r.more_notes : [])].filter((x) => typeof x === 'string' && x.trim());
      return `<li class="rq" id="rep-${esc(r.id)}">
        <div class="rq-hd"><div><h3>${esc(T.reportKindLabel(r.kind))}${times > 1 ? `<span class="bd-warn">Avisado ${times} vezes</span>` : ''}</h3><small>${esc(name)} · ${esc(fmtDateTime(r.created_at))}${times > 1 && r.last_at ? ` · último aviso em ${esc(fmtDateTime(r.last_at))}` : ''}</small></div>
          <span class="rq-st ${done ? 'st-completed' : 'st-pending'}">${done ? 'Resolvido' : 'Em aberto'}</span></div>
        <dl>
          <dt>Local</dt><dd><a href="${esc(page)}" target="_blank" rel="noopener">${esc(name)}<span class="sr"> (abre em nova aba)</span></a>${where ? `<br><small>${esc(where)}</small>` : ''}</dd>
          <dt>Origem</dt><dd>${r.clinic_id ? 'Parceiro do IMED (a clínica corrige pela área dela)' : `Cadastro oficial (CNES ${esc(r.cnes)})${ficha ? ` · <a href="${esc(ficha)}" target="_blank" rel="noopener">Ficha no CNES<span class="sr"> (abre em nova aba)</span></a>` : ''}`}</dd>
          ${est?.phone && !r.clinic_id ? `<dt>Telefone no CNES</dt><dd>${esc(est.phone)}</dd>` : ''}
          ${notes.length ? `<dt>${notes.length > 1 ? 'O que escreveram' : 'O que a pessoa escreveu'}</dt><dd class="msg-body">${notes.map(esc).join('\n—\n')}</dd>` : ''}
          ${done && r.resolved_at ? `<dt>Resolvido em</dt><dd>${esc(fmtDateTime(r.resolved_at))}</dd>` : ''}
        </dl>
        <div class="rq-act"><button class="btn btn-ghost btn-sm" type="button" data-rep-status="${done ? 'open' : 'resolved'}" data-id="${esc(r.id)}">${done ? 'Reabrir' : 'Marcar como resolvido'}<span class="sr"> o aviso sobre ${esc(name)}</span></button></div>
      </li>`;
    };
    p.innerHTML = `<p class="cl-help">Avisos de dados errados enviados pelos visitantes na página de cada local. Confira com o local. No cadastro oficial, a correção é feita pelo próprio estabelecimento no CNES; nos parceiros, pela clínica na área dela.</p>
      <div class="cl-filter"><label class="cl-lbl" for="flt-rep" style="margin:0">Mostrar</label>
        <select id="flt-rep">${Object.entries(REPORT_FILTER).map(([v, n]) => `<option value="${v}"${f === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" type="button" id="rf-rep"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Atualizar lista</button></div>
      ${rows.length ? `<ul class="rq-list">${rows.map(item).join('')}</ul>` : `<p class="cl-help">${f === 'open' ? 'Nenhum aviso em aberto.' : 'Nenhum aviso.'}</p>`}
      <div id="repMsg" aria-live="polite"></div>`;
    $('#flt-rep').onchange = (e) => { state.filter.rep = e.target.value; state.refocus = '#flt-rep'; renderTab(); };
    $('#rf-rep').onclick = () => { state.refocus = '#rf-rep'; renderTab(); };
    p.onclick = async (e) => {
      const b = e.target.closest('[data-rep-status]');
      if (!b) return;
      b.disabled = true;
      try {
        const res = await auth.rpc('set_place_report_status', { p_id: b.dataset.id, p_status: b.dataset.repStatus });
        if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
        toast(b.dataset.repStatus === 'resolved' ? 'Aviso marcado como resolvido.' : 'Aviso reaberto.');
        state.refocus = '#flt-rep';
        renderTab();
      } catch (err) {
        if (lost()) return;
        b.disabled = false;
        $('#repMsg', p).innerHTML = note(esc(err.result === 'forbidden' ? 'Só a equipe do IMED cuida dos avisos.' : err.result === 'not_found' ? 'Este aviso não existe mais.' : friendlyError(err, 'Não foi possível salvar agora. Tente de novo.')), 'err');
      }
    };
  });
}

// ---------- equipe do IMED: contador de visitas próprio (sem cookies e sem dados pessoais) ----------
// Banco ainda sem a função admin_stats (migração 20261030143839_visitas): o PostgREST responde 404 (PGRST202).
const noStatsFn = (err) => err?.status === 404 || err?.data?.code === 'PGRST202' || err?.data?.code === '42883';

async function tabVisits(p) {
  const days = state.filter.vis ?? 7;
  const same = () => state.tab === 'visitas' && p.isConnected && (state.filter.vis ?? 7) === days;
  let body = $('#vsBody', p);
  if (body) {
    // Trocou o período ou atualizou: os números de antes ficam (mais claros) até os novos chegarem.
    body.classList.add('vs-busy');
    body.setAttribute('aria-busy', 'true');
  } else {
    p.innerHTML = `<p class="cl-help">Contagem própria do IMED, <b>sem cookies e sem dados pessoais</b>: cada página aberta soma 1 no dia, e as buscas somam o exame, o tipo de local e a cidade, cada um separado. O banco não guarda IP, aparelho nem quem visitou. Não entram robôs, testes e quem liga “Não rastrear” ou o Controle Global de Privacidade no navegador. Os pedidos de agendamento e as teleconsultas não vêm do contador: são o número real, das próprias tabelas do IMED. <a class="link" href="privacidade.html#cookies">Veja na política de privacidade</a>.</p>
      <div class="cl-filter"><label class="cl-lbl" for="flt-vis" style="margin:0">Período</label>
        <select id="flt-vis">${V.PERIODS.map(([v, n]) => `<option value="${v}"${days === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" type="button" id="rf-vis"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Atualizar</button></div>
      <div id="vsBody" class="vs-root" aria-busy="true">${loading('Carregando os números…')}</div>`;
    body = $('#vsBody', p);
    $('#flt-vis', p).onchange = (e) => { state.filter.vis = Number(e.target.value) === 30 ? 30 : 7; renderTab(); };
    $('#rf-vis', p).onclick = () => renderTab();
  }
  const done = () => { body.classList.remove('vs-busy'); body.removeAttribute('aria-busy'); };
  try {
    const raw = await auth.rpc('admin_stats', { p_days: days });
    if (!same()) return;
    body.innerHTML = V.statsHtml(V.normalizeStats(raw, days));
    done();
  } catch (err) {
    if (lost() || !same()) return;
    body.innerHTML = noStatsFn(err)
      ? note('O contador de visitas ainda não está ligado no banco. Os números aparecem aqui depois que a atualização do banco for aplicada.', 'warn')
      : `${note(esc(friendlyError(err, 'Não foi possível carregar os números agora. Tente de novo em instantes.')), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="retryVis">Tentar de novo</button></div>`;
    done();
    const retry = $('#retryVis', p);
    if (retry) retry.onclick = () => renderTab();
  }
}

// ---------- início ----------
async function init() {
  const flash = await finishLogin();
  if (flash) $('#flash').innerHTML = note(esc(flash.text), flash.kind);
  renderAccount();
  if (auth.user()) loadAll();
}
init();
