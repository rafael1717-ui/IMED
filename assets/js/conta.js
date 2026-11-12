// "Minha conta": pedidos de agendamento (deste aparelho e da conta), situação ao vivo, lembrete na agenda
// (.ics) e avaliação do atendimento. Login por link no e-mail (assets/js/auth.js).
// Contrato do aparelho: localStorage 'imed_appts' (mais novo primeiro), gravado pela busca (perto.js).
// Pagamento pelo site (iMed Pagamentos P2a, DESLIGADO: nenhuma clínica tem o recebimento ligado): o pedido pago pelo
// site (marca "pay" no aparelho, ou pedido da conta esperando o pagamento) mostra a situação do pagamento, "Continuar o
// pagamento" e o comprovante, pela tela de pagamento.js, baixada só nesse caso.
import * as A from './auth.js';
import * as T from './confianca.js';
import { montarSenha } from './entrada-senha.js';

const CFG = window.IMED_CONFIG || {};
const SITE = CFG.siteUrl || new URL('./', location.href).href;
const BACK_KEY = 'imed_conta_voltar';

// Funções da busca (geo-core.js). Se alguma não existir (versão antiga), usa a versão mínima daqui.
let G = {};
try { G = await import('./geo-core.js'); } catch { G = {}; }
const STATUS_PT = { pending: 'Aguardando contato', pendente: 'Aguardando contato', contacted: 'Em contato', confirmed: 'Confirmado', confirmado: 'Confirmado', cancelled: 'Cancelado', completed: 'Concluído',
  hold: 'Reserva temporária', awaiting_payment: 'Aguardando pagamento', checked_in: 'Chegada registrada', in_service: 'Em atendimento', no_show: 'Não compareceu',
  reschedule_requested: 'Remarcação solicitada', expired: 'Reserva expirada' };
const F = {
  EXAMS: { rx: { n: 'Raio-X' }, usg: { n: 'Ultrassom' }, tc: { n: 'Tomografia' }, rm: { n: 'Ressonância' }, mamo: { n: 'Mamografia' }, dens: { n: 'Densitometria' }, ecg: { n: 'Eletrocardiograma' }, eco: { n: 'Ecocardiograma' }, lab: { n: 'Exames de laboratório' } },
  PERIODS: { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite', qualquer: 'Qualquer horário' },
  PREP: {},
  statusLabel: (s) => STATUS_PT[s] ?? '',
  protocolFromId: (id) => `IMED-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
  icsFile({ id, title, date, period, confirmed = false, description = '', url = '' }) {
    const e = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    if (!confirmed) title = `${title} (a confirmar)`;
    const day = date.replace(/-/g, '');
    const [y, m, d] = date.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replace(/-/g, '');
    const h = { manha: ['08', '12'], tarde: ['13', '18'], noite: ['18', '21'] }[period];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IMED//Pedidos//PT-BR', 'BEGIN:VEVENT', `UID:${e(id)}@imed`, `DTSTAMP:${stamp}`,
      ...(h ? [`DTSTART;TZID=America/Sao_Paulo:${day}T${h[0]}0000`, `DTEND;TZID=America/Sao_Paulo:${day}T${h[1]}0000`] : [`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next}`]),
      `SUMMARY:${e(title)}`, ...(description ? [`DESCRIPTION:${e(description)}`] : []), ...(url ? [`URL:${url}`] : []),
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(title)}`, 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
  },
};
const g = (name) => G[name] ?? F[name];
const usingFallback = ['icsFile', 'PREP', 'statusLabel'].filter((n) => !G[n]);
if (usingFallback.length) console.warn('conta.js: usando versão local de', usingFallback.join(', '));

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
const examName = (code) => g('EXAMS')[code]?.n ?? (code === 'consulta' ? 'Consulta' : code === 'outro' ? 'Outro atendimento' : null);
const periodName = (p) => g('PERIODS')[p] ?? null;
// Horário marcado (reserva com agenda), sempre no fuso da UNIDADE (o.tz, gravado na marcação; pedido antigo ou da
// conta sem o fuso: São Paulo), com "(horário de Manaus)" quando o aparelho mostraria outra hora.
const SLOT_FMT = new Map();
function slotLong(iso, tz = 'America/Sao_Paulo') {
  const d = new Date(iso ?? '');
  if (!iso || Number.isNaN(d.getTime())) return null;
  let f = SLOT_FMT.get(tz);
  if (!f) {
    try { f = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return tz === 'America/Sao_Paulo' ? null : slotLong(iso); }
    SLOT_FMT.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const note = G.tzDiffers?.(iso, tz) && G.tzLabel ? ` (${G.tzLabel(tz)})` : '';
  return `${p.weekday}, ${p.day} de ${p.month} de ${p.year} às ${p.hour === '24' ? '00' : p.hour}:${p.minute}${note}`;
}
// Fuso da clínica de um pedido que veio só da conta (o horário aparece no da unidade, como na marcação).
const accountTz = (r) => (typeof r?.clinics?.timezone === 'string' ? r.clinics.timezone : '');
const orderTz = (o) => (typeof o.tz === 'string' && o.tz ? o.tz : 'America/Sao_Paulo');
const slotFuture = (iso) => { const t = new Date(iso ?? '').getTime(); return Number.isFinite(t) && t > Date.now(); };
function dateLong(iso) {
  if (!isDate(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}
function flash(msg, kind = 'ok') {
  const f = $('flash');
  f.textContent = msg;
  f.className = `ct-flash ${kind}`;
  f.hidden = !msg;
}

// ---------- pedidos ----------
function readDevice() {
  try {
    const list = JSON.parse(localStorage.getItem('imed_appts') || '[]');
    return Array.isArray(list) ? list.filter((a) => a && typeof a === 'object' && (a.type === 'pedido' || a.id) && a.name) : [];
  } catch { return []; }
}

const state = { orders: [], logged: false, liveError: false, accountError: false, opened: null, cancelAsk: '', cancelBusy: '', payOpen: '', payCtl: null };
// Módulo do pagamento pelo site: só é baixado se algum pedido da lista foi pago (ou está para ser pago) pelo site.
let PAG = null;
// Pedido que veio só da conta (feito em outro aparelho): a consulta da conta continua a mesma de sempre (sem o modo de
// pagamento), então só dá para saber que é pago pelo site enquanto ele espera o pagamento. O comprovante desse pedido
// fica no aparelho em que foi feito (anotado em "P2a: como ficou": a consulta da conta ganha o modo de pagamento na P2b).
const PAY_WAITING = ['hold', 'awaiting_payment'];

async function loadOrders() {
  const device = readDevice();
  const withToken = device.filter((a) => isUuid(a.id) && typeof a.token === 'string' && a.token);
  const live = new Map();
  state.liveError = false;
  state.accountError = false;
  const jobs = [];
  if (withToken.length) {
    const sl = withToken.slice(0, 30);
    jobs.push(A.rpc('request_status', { p_ids: sl.map((a) => a.id), p_tokens: sl.map((a) => a.token) })
      .then((rows) => { for (const r of rows || []) live.set(r.id, r); })
      .catch(() => { state.liveError = true; }));
  }
  let account = [];
  // Só os pedidos da própria conta: o RLS também libera pedidos de clínicas das quais a pessoa
  // é membro (e todos, para admin), que não podem aparecer aqui como se fossem dela.
  const uid = A.user()?.id;
  if (state.logged && uid) {
    jobs.push(A.select(`appointment_requests?select=id,user_id,created_at,place_name,place_source,place_ref,place_phone,clinic_id,exam_code,preferred_date,preferred_period,slot_start,slot_end,status,clinics(timezone)&user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=50`)
      .then((rows) => { account = Array.isArray(rows) ? rows.filter((r) => r.user_id === uid) : []; })
      .catch((err) => { state.accountError = true; if (err.status === 401) state.expired = true; }));
  }
  await Promise.all(jobs);

  const byId = new Map();
  const out = [];
  for (const a of device) {
    const l = isUuid(a.id) ? live.get(a.id) : null;
    const o = {
      id: isUuid(a.id) ? a.id : null, token: a.token || '', code: a.code || (isUuid(a.id) ? g('protocolFromId')(a.id) : null),
      place: a.name, exam: a.exam || null, items: Array.isArray(a.items) ? a.items : [], date: a.date, period: a.period,
      slot: a.slot || null, slotEnd: a.slot_end || null, tz: typeof a.tz === 'string' ? a.tz : '', deviceStatus: a.status || null,
      created: a.created || null, status: l ? l.status : null, reviewed: l ? !!l.reviewed : null,
      fromDevice: true, hasToken: !!(isUuid(a.id) && a.token), fromAccount: false,
      place_key: typeof a.place_key === 'string' ? a.place_key : '', phone: typeof a.phone === 'string' ? a.phone : '',
      prep: typeof a.prep === 'string' ? a.prep : '', pay: a.pay === 1,
    };
    out.push(o);
    if (o.id) byId.set(o.id, o);
  }
  for (const r of account) {
    const o = byId.get(r.id);
    if (o) {
      o.fromAccount = true;
      o.status = r.status || o.status;
      o.exam = o.exam || r.exam_code;
      o.slot = o.slot || r.slot_start || null;
      o.slotEnd = o.slotEnd || r.slot_end || null;
      o.tz = o.tz || accountTz(r);
      o.place_source = r.place_source || ''; o.clinic_id = r.clinic_id || null; o.phone = o.phone || r.place_phone || '';
      o.pay = o.pay || PAY_WAITING.includes(r.status);
      continue;
    }
    const n = {
      id: r.id, token: '', code: g('protocolFromId')(r.id), place: r.place_name, exam: r.exam_code, items: [],
      date: r.preferred_date, period: r.preferred_period, slot: r.slot_start || null, slotEnd: r.slot_end || null, tz: accountTz(r), created: r.created_at, status: r.status, reviewed: null,
      fromDevice: false, hasToken: false, fromAccount: true,
      place_source: r.place_source || '', clinic_id: r.clinic_id || null, phone: r.place_phone || '', pay: PAY_WAITING.includes(r.status),
    };
    out.push(n);
    byId.set(n.id, n);
  }
  out.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  await loadPayments(out);
  state.orders = out;
}

// Pedidos pagos pelo site: a situação do pagamento vem do banco (pag_my_payment, com o código do aparelho ou a conta).
async function loadPayments(orders) {
  const paid = orders.filter((o) => o.pay && o.id && (o.hasToken || o.fromAccount)).slice(0, 10);
  if (!paid.length) return;
  try { PAG ??= await import('./pagamento.js'); } catch { PAG = null; }
  if (!PAG) return;
  PAG.ensureCss();
  await Promise.all(paid.map(async (o) => {
    o.payment = await PAG.status(A.rpc, o.id, o.token);
    // a situação do pedido que veio com o pagamento vale quando a consulta ao vivo falhou
    if (!o.status && typeof o.payment?.request_status === 'string') o.status = o.payment.request_status;
  }));
}

function statusHtml(o) {
  if (o.status) return `<span class="ct-st st-${esc(o.status)}">${esc(g('statusLabel')(o.status) || o.status)}</span>`;
  // Reserva com horário: o banco já gravou como confirmada. Sem a situação ao vivo, mostra o que o aparelho guardou.
  if (o.slot && o.deviceStatus === 'confirmado') return '<span class="ct-st st-confirmed">Confirmado</span>';
  if (o.hasToken && state.liveError) return '<span class="ct-st st-unknown">Situação indisponível agora</span>';
  if (!o.id || !o.hasToken) return '<span class="ct-st st-unknown">Situação: confirme com o local</span>';
  return '<span class="ct-st st-unknown">Situação indisponível</span>';
}

const canReview = (o) => o.id && o.status === 'completed' && o.reviewed !== true;
// "Adicionar à agenda": só para o que ainda vai acontecer e está ativo (aguardando contato, em contato, confirmado ou
// situação que o aparelho ainda não sabe). Nada para reserva, chegada, atendimento, falta, remarcação, cancelado,
// concluído ou expirado (fase 4.2), nem para data ou horário que já passou.
const todaySP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
// (pago pelo site e ainda sem a situação do banco: nada de lembrete "confirmado" por conta do aparelho)
const canIcs = (o) => T.canRemind(o.status) && o.deviceStatus !== 'cancelado' && (!!o.status || o.deviceStatus !== 'aguardando_pagamento')
  && (o.slot ? slotFuture(o.slot) : isDate(o.date) && o.date >= todaySP());
// Aviso no cartão para as situações que a agenda nova cria (fase 4.2). Texto simples; sem dado do paciente.
const STATUS_NOTE = {
  hold: 'Seu horário fica reservado por alguns minutos.',
  awaiting_payment: 'O horário só fica confirmado depois do pagamento.',
  no_show: 'A clínica registrou que você não compareceu. Se não foi isso, fale com a clínica.',
  reschedule_requested: 'Este horário precisa mudar. Fale com a clínica para combinar um novo horário.',
  expired: 'A reserva não foi concluída a tempo e o horário foi liberado.',
};
function statusNote(o) {
  const t = STATUS_NOTE[o.status];
  if (!t) return '';
  const tel = o.status === 'reschedule_requested' && o.phone && G.telHref ? G.telHref(o.phone) : '';
  return `<p class="ct-note ct-st-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ${esc(t)}${tel ? ` <a href="${esc(tel)}">Ligar para ${esc(o.phone)}</a>` : ''}</p>`;
}
// Pagamento pelo site no cartão do pedido: a situação (o que o banco disse), "Continuar o pagamento" enquanto houver
// prazo, e o comprovante depois de pago. Sem pagamento pelo site, nada aparece.
function payHtml(o) {
  const r = PAG && o.payment ? PAG.core.contaResumo(o.payment, { tz: orderTz(o) }) : null;
  if (!r) return '';
  o.payView = r.view;
  const rid = esc(o.id);
  const icon = { ok: 'fa-circle-check', wait: 'fa-clock', back: 'fa-rotate', off: 'fa-circle-info' }[r.cls];
  const open = state.payOpen === o.id;
  const btn = r.canContinue ? 'Continuar o pagamento' : r.hasReceipt ? 'Ver comprovante' : r.view === 'devolucao' || r.view === 'devolvido' ? 'Ver a devolução' : '';
  return `<div class="ct-pg ${r.cls}"><i class="fa-solid ${icon}" aria-hidden="true"></i><div><span>${esc(r.text)}</span>${r.lines.length ? `<ul>${r.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</div></div>
    ${btn ? `<div class="ct-actions"><button type="button" class="btn ${r.canContinue ? 'btn-coral' : 'btn-ghost'} btn-sm" data-pay="${rid}" aria-expanded="${open}" aria-controls="pg-${rid}"><i class="fa-solid ${r.canContinue ? 'fa-lock' : 'fa-file-medical'}" aria-hidden="true"></i>${btn}</button></div>
    <div class="ct-pg-box" id="pg-${rid}"${open ? '' : ' hidden'}></div>` : ''}`;
}

// Abre (ou fecha) a tela do pagamento dentro do cartão do pedido.
function openPay(id, { focus = true } = {}) {
  const o = state.orders.find((x) => x.id === id);
  const box = document.getElementById(`pg-${id}`);
  state.payCtl?.stop();
  state.payCtl = null;
  if (!o || !box || !PAG) { state.payOpen = ''; return; }
  state.payOpen = id;
  box.hidden = false;
  document.querySelector(`[data-pay="${CSS.escape(id)}"]`)?.setAttribute('aria-expanded', 'true');
  const exam = (o.slot && o.items.filter(Boolean).join(', ')) || examName(o.exam) || '';
  state.payCtl = PAG.mount(box, {
    id, token: o.token, rpc: A.rpc, h: 'h4', hid: `pgt-${id}`, focusFirst: focus,
    ctx: { place: o.place, code: o.code, exam, when: slotLong(o.slot, orderTz(o)) || '', tz: orderTz(o), telHref: (o.phone && G.telHref?.(o.phone)) || '' },
    restartHref: G.isUuid?.(o.clinic_id) ? `local.html?id=${encodeURIComponent(o.clinic_id)}#agendar` : (typeof o.place_key === 'string' && o.place_key.startsWith('imed:') ? `local.html?id=${encodeURIComponent(o.place_key.slice(5))}#agendar` : ''),
    // a situação mudou com a tela aberta (pagou, venceu, cancelou): o cartão acompanha
    onView: async (view) => {
      if (view === o.payView || !view) return;
      o.payView = view;
      o.payment = await PAG.status(A.rpc, o.id, o.token) || o.payment;
      if (typeof o.payment?.request_status === 'string') o.status = o.payment.request_status;
      renderOrders();
    },
  });
}

// Cancelar pelo site: pedido deste aparelho (com o código) ou da conta, ainda ativo (confianca.canCancel).
const canCancelOrder = (o) => !!(o.id && (o.hasToken || o.fromAccount) && T.canCancel(o.status, o.slot));

function orderHtml(o, i) {
  // Com horário marcado (agenda nova), o nome do procedimento da clínica ("Ressonância do joelho"); senão, o do exame.
  const exam = (o.slot && o.items.filter(Boolean).join(', ')) || examName(o.exam) || o.items.filter(Boolean).join(', ') || null;
  const slot = slotLong(o.slot, orderTz(o));
  const when = slot ? null : dateLong(o.date);
  const per = slot ? null : periodName(o.period);
  const rows = [
    exam ? `<div><dt>Exame</dt><dd>${esc(exam)}</dd></div>` : '',
    slot ? `<div><dt>Horário marcado</dt><dd>${esc(slot)}</dd></div>` : '',
    when ? `<div><dt>Data preferida</dt><dd>${esc(when)}</dd></div>` : '',
    per ? `<div><dt>Período</dt><dd>${esc(per)}</dd></div>` : '',
    o.code ? `<div><dt>Protocolo</dt><dd class="ct-code">${esc(o.code)}</dd></div>` : '',
  ].join('');
  const where = o.fromAccount && o.fromDevice ? 'Na conta e neste aparelho' : o.fromAccount ? 'Na sua conta' : 'Neste aparelho';
  const rid = o.id ? esc(o.id) : '';
  return `<article class="ct-order" ${o.id ? `id="pedido-${rid}"` : ''} tabindex="-1" aria-labelledby="ot-${i}">
    <div class="ct-order-h">
      <h3 id="ot-${i}">${esc(o.place)}</h3>
      ${statusHtml(o)}
    </div>
    <dl class="ct-dl">${rows}</dl>
    <p class="ct-where">${where}</p>
    <div class="ct-actions">
      ${canIcs(o) ? `<button type="button" class="btn btn-ghost btn-sm" data-ics="${i}"><i class="fa-solid fa-calendar-plus" aria-hidden="true"></i>Adicionar à agenda</button>` : ''}
      ${canReview(o) ? `<button type="button" class="btn btn-coral btn-sm" data-review="${rid}" aria-expanded="false" aria-controls="rv-${rid}"><i class="fa-solid fa-star" aria-hidden="true"></i>Avaliar</button>` : ''}
      ${o.id && o.reviewed === true ? '<span class="ct-done"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>Você já avaliou</span>' : ''}
      ${canCancelOrder(o) && state.cancelAsk !== o.id ? `<button type="button" class="btn btn-ghost btn-sm ct-cancel" data-cancel="${rid}"><i class="fa-solid fa-ban" aria-hidden="true"></i>Cancelar pedido</button>` : ''}
    </div>
    ${canCancelOrder(o) && state.cancelAsk === o.id ? `<div class="ct-confirm ct-ask" role="group" aria-label="Confirmar o cancelamento">
        <p>${esc(T.cancelConfirmText(T.placeType(o), o.slot, o.status))}</p>
        <div class="ct-row"><button class="btn btn-coral btn-sm" type="button" data-cancel-yes="${rid}"${state.cancelBusy === o.id ? ' disabled' : ''}>${state.cancelBusy === o.id ? 'Cancelando…' : 'Sim, cancelar'}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-cancel-no="${rid}">Não</button></div>
      </div>` : ''}
    ${statusNote(o)}
    ${payHtml(o)}
    ${o.status === 'cancelled' && (o.cancelledHere || o.deviceStatus === 'cancelado') ? `<p class="ct-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Cancelado por você. ${T.cancelNoteHTML(T.placeType(o), o.phone, G.telHref)}</p>` : ''}
    ${canReview(o) ? reviewForm(o) : ''}
  </article>`;
}

function reviewForm(o) {
  const id = esc(o.id);
  const stars = [1, 2, 3, 4, 5].map((n) => `<input class="sr" type="radio" name="rating-${id}" id="r-${id}-${n}" value="${n}"><label for="r-${id}-${n}"><i class="fa-solid fa-star" aria-hidden="true"></i><span class="sr">${n} ${n === 1 ? 'estrela' : 'estrelas'}</span></label>`).join('');
  return `<form class="ct-rev" id="rv-${id}" data-id="${id}" novalidate hidden>
    <fieldset>
      <legend>Que nota você dá para o atendimento?</legend>
      <div class="ct-stars" data-v="0">${stars}</div>
      <p class="ct-stars-txt" aria-hidden="true"></p>
    </fieldset>
    <label class="ct-fld" for="c-${id}"><span>Comentário (opcional)</span>
      <textarea id="c-${id}" name="comment" maxlength="500" rows="3" placeholder="Como foi o atendimento? Evite colocar dados pessoais." aria-describedby="cc-${id}"></textarea>
      <small class="ct-muted" id="cc-${id}">0 de 500 caracteres</small>
    </label>
    <p class="ct-muted ct-small">Sua avaliação aparece no site com seu primeiro nome.</p>
    <button class="btn btn-coral" type="submit">Enviar avaliação</button>
    <p class="ct-msg" role="alert" hidden></p>
  </form>`;
}

function renderOrders() {
  $('ordersTitle').textContent = state.logged ? 'Meus pedidos' : 'Pedidos deste aparelho';
  const box = $('orders');
  const hint = [];
  if (state.logged) hint.push('Pedidos da sua conta e deste aparelho.');
  if (state.accountError) hint.push(state.expired ? 'Sua entrada venceu: entre de novo para ver os pedidos da conta.' : 'Não foi possível carregar os pedidos da conta agora.');
  if (state.liveError) hint.push('Não foi possível ver a situação dos pedidos agora. Tente de novo em instantes.');
  $('ordersHint').textContent = hint.join(' ');
  $('ordersHint').hidden = !hint.length;
  if (!state.orders.length) {
    box.innerHTML = `<div class="ct-empty"><i class="fa-regular fa-calendar" aria-hidden="true"></i><p>${state.logged ? 'Você ainda não tem pedidos.' : 'Nenhum pedido feito neste aparelho.'}</p><a class="btn btn-primary btn-sm" href="perto.html">Buscar clínicas perto de mim</a></div>`;
  } else {
    // a tela do pagamento aberta num cartão é desligada antes de redesenhar e religada depois, no mesmo pedido
    state.payCtl?.stop();
    state.payCtl = null;
    box.innerHTML = state.orders.map(orderHtml).join('');
    if (state.payOpen) openPay(state.payOpen, { focus: false });
  }
  $('clearBtn').disabled = !readDevice().length;
}

function downloadIcs(o) {
  const exam = examName(o.exam) || o.items.filter(Boolean).join(', ') || 'Atendimento';
  const guide = G.EXAMS?.[o.exam]?.slug;
  // o preparo informado pela clínica (guardado na marcação) vem antes do texto geral do exame
  const prep = o.prep || g('PREP')[o.exam];
  const title = o.exam === 'consulta' || o.exam === 'outro' || !G.EXAMS?.[o.exam] ? `${exam} — ${o.place}` : `Exame: ${exam} — ${o.place}`;
  const description = [
    `Pedido ${o.code || ''} · ${o.place}`,
    o.slot && G.formatSlot && G.tzLabel ? `Horário: ${G.formatSlot(o.slot, orderTz(o))} (${G.tzLabel(orderTz(o))}).` : '',
    prep ? `Preparo: ${prep}` : '',
    o.slot ? 'Horário confirmado. Chegue com 15 minutos de antecedência.' : 'O horário só fica garantido depois da confirmação do local.',
    guide ? `Guia do exame: ${SITE}exames/${guide}.html#preparo` : '',
    o.id ? `Acompanhe: ${SITE}conta.html#pedido-${o.id}` : `IMED: ${SITE}`,
  ].filter(Boolean).join('\n');
  let ics;
  // Sem horário marcado e sem confirmação do local, o título do lembrete leva "(a confirmar)".
  const confirmed = !!o.slot || o.status === 'confirmed' || o.status === 'completed';
  try { ics = g('icsFile')({ id: o.id || o.code, title, date: o.date, period: o.period, slot: o.slot || null, slotEnd: o.slot ? o.slotEnd || null : null, confirmed, description, url: o.id ? `${SITE}conta.html#pedido-${o.id}` : SITE }); }
  catch { toast('Não foi possível criar o lembrete deste pedido.'); return; }
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `imed-${String(o.code || 'pedido').toLowerCase()}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Lembrete baixado. Abra o arquivo para pôr na agenda.');
}

function openReview(id, focus = true) {
  const form = document.getElementById(`rv-${id}`);
  const btn = document.querySelector(`[data-review="${CSS.escape(id)}"]`);
  if (!form) return false;
  form.hidden = false;
  btn?.setAttribute('aria-expanded', 'true');
  if (focus) form.querySelector('input[type=radio]')?.focus();
  return true;
}

const REVIEW_MSG = {
  invalid_rating: 'Escolha uma nota de 1 a 5 estrelas.',
  comment_too_long: 'O comentário pode ter até 500 caracteres.',
  not_found: 'Não encontramos este pedido. Ele pode ter sido apagado.',
  forbidden: 'Não conseguimos confirmar que este pedido é seu. Entre com a conta usada no pedido ou use o aparelho em que ele foi feito.',
  not_completed: 'Só dá para avaliar depois que o local marcar o atendimento como concluído.',
  already_reviewed: 'Este pedido já foi avaliado. Obrigado!',
};

async function submitReview(form) {
  const id = form.dataset.id;
  const o = state.orders.find((x) => x.id === id);
  const msg = form.querySelector('.ct-msg');
  const btn = form.querySelector('button[type=submit]');
  const rating = Number(form.querySelector('input[type=radio]:checked')?.value || 0);
  const comment = form.querySelector('textarea').value.trim();
  const show = (text, ok = false) => { msg.textContent = text; msg.hidden = !text; msg.classList.toggle('ok', ok); };
  if (rating < 1 || rating > 5) { show(REVIEW_MSG.invalid_rating); form.querySelector('input[type=radio]').focus(); return; }
  if (comment.length > 500) { show(REVIEW_MSG.comment_too_long); return; }
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  show('');
  let res;
  try {
    res = await A.rpc('submit_review', { p_request: id, p_token: o?.token || '', p_rating: rating, p_comment: comment || null });
  } catch {
    btn.disabled = false;
    btn.textContent = 'Enviar avaliação';
    show('Não foi possível enviar agora. Confira a internet e tente de novo.');
    return;
  }
  btn.disabled = false;
  btn.textContent = 'Enviar avaliação';
  if (res === 'ok' || res === 'already_reviewed') {
    if (o) o.reviewed = true;
    const art = form.closest('.ct-order');
    art.querySelector('[data-review]')?.remove();
    const thanks = document.createElement('p');
    thanks.className = 'ct-thanks';
    thanks.setAttribute('role', 'status');
    thanks.tabIndex = -1;
    thanks.innerHTML = res === 'ok'
      ? '<i class="fa-solid fa-heart" aria-hidden="true"></i>Obrigado pela avaliação! Ela ajuda outras pessoas a escolher onde fazer seus exames.'
      : `<i class="fa-solid fa-circle-check" aria-hidden="true"></i>${REVIEW_MSG.already_reviewed}`;
    form.replaceWith(thanks);
    thanks.focus();
    return;
  }
  show(REVIEW_MSG[res] || 'Não foi possível enviar a avaliação. Tente de novo mais tarde.');
}

// Cancela no banco (cancel_request): com o código do aparelho ou pela conta (o banco confere quem é o dono).
async function cancelOrder(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o || state.cancelBusy) return;
  const antes = o.status;   // a situação antes de cancelar decide se o horário volta a ficar livre
  state.cancelBusy = id;
  renderOrders();
  let res;
  try { res = await A.rpc('cancel_request', { p_id: id, p_token: o.token || null }); } catch { res = 'error'; }
  state.cancelBusy = '';
  const card = () => document.getElementById(`pedido-${id}`);
  if (res === 'ok' || res === 'already_cancelled') {
    state.cancelAsk = '';
    o.status = 'cancelled';
    o.cancelledHere = true;
    try {
      const list = JSON.parse(localStorage.getItem('imed_appts') || '[]');
      if (Array.isArray(list)) localStorage.setItem('imed_appts', JSON.stringify(list.map((a) => (a && a.id === id ? { ...a, status: 'cancelado' } : a))));
    } catch { /* sem armazenamento: a situação vem do banco */ }
    renderOrders();
    toast(res === 'ok' ? T.cancelDoneText(o.slot, T.placeType(o), o.phone, antes) : T.CANCEL_MSG.already_cancelled);
    card()?.focus();
    return;
  }
  // Respostas definitivas (inclusive o prazo da clínica, too_late — fase 4.2): fecha a pergunta e confere a situação.
  const final = T.CANCEL_FINAL.includes(res);
  if (final) state.cancelAsk = '';
  renderOrders();
  toast(T.CANCEL_MSG[res] || T.CANCEL_MSG.error);
  (final ? card() : card()?.querySelector('[data-cancel-yes]'))?.focus();
  if (final) refresh();
}

function bindOrders() {
  const box = $('orders');
  box.addEventListener('click', (e) => {
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) { state.cancelAsk = cancel.dataset.cancel; renderOrders(); box.querySelector('[data-cancel-yes]')?.focus(); return; }
    const no = e.target.closest('[data-cancel-no]');
    if (no) { const id = state.cancelAsk; state.cancelAsk = ''; renderOrders(); document.querySelector(`[data-cancel="${CSS.escape(id)}"]`)?.focus(); return; }
    const yes = e.target.closest('[data-cancel-yes]');
    if (yes) { cancelOrder(yes.dataset.cancelYes); return; }
    const pay = e.target.closest('[data-pay]');
    if (pay) {
      const id = pay.dataset.pay;
      if (state.payOpen === id) {
        state.payCtl?.stop(); state.payCtl = null; state.payOpen = '';
        const pbox = document.getElementById(`pg-${id}`);
        if (pbox) { pbox.hidden = true; pbox.innerHTML = ''; }
        pay.setAttribute('aria-expanded', 'false');
      } else {
        const antes = state.payOpen;
        if (antes) { const b = document.getElementById(`pg-${antes}`); if (b) { b.hidden = true; b.innerHTML = ''; } document.querySelector(`[data-pay="${CSS.escape(antes)}"]`)?.setAttribute('aria-expanded', 'false'); }
        openPay(id);
      }
      return;
    }
    const ics = e.target.closest('[data-ics]');
    if (ics) {
      const o = state.orders[Number(ics.dataset.ics)];
      if (o) downloadIcs(o);
      return;
    }
    const rv = e.target.closest('[data-review]');
    if (rv) {
      const form = document.getElementById(`rv-${rv.dataset.review}`);
      if (form && !form.hidden) { form.hidden = true; rv.setAttribute('aria-expanded', 'false'); rv.focus(); } else openReview(rv.dataset.review);
    }
  });
  box.addEventListener('change', (e) => {
    if (e.target.matches('.ct-stars input')) {
      const wrap = e.target.closest('.ct-stars');
      const v = Number(e.target.value);
      wrap.dataset.v = String(v);
      const txt = wrap.parentElement.querySelector('.ct-stars-txt');
      txt.textContent = ['', 'Ruim', 'Regular', 'Bom', 'Muito bom', 'Excelente'][v];
    }
  });
  box.addEventListener('input', (e) => {
    if (e.target.matches('.ct-rev textarea')) {
      const n = e.target.value.length;
      e.target.parentElement.querySelector('small').textContent = `${n} de 500 caracteres`;
    }
  });
  box.addEventListener('submit', (e) => {
    if (e.target.matches('.ct-rev')) { e.preventDefault(); submitReview(e.target); }
  });
}

// Abre o pedido do endereço (#pedido-<id>) e o formulário de avaliação, se der para avaliar.
function openFromHash() {
  const m = location.hash.match(/^#pedido-([0-9a-f-]{36})$/i);
  if (!m) return;
  const id = m[1].toLowerCase();
  const el = document.getElementById(`pedido-${id}`);
  if (!el) {
    flash(state.logged
      ? 'Não encontramos este pedido na sua conta nem neste aparelho. Ele pode ter sido feito em outro aparelho sem entrar na conta.'
      : 'Não encontramos este pedido neste aparelho. Se você fez o pedido com a conta, entre com seu e-mail abaixo.', 'warn');
    return;
  }
  el.classList.add('ct-target');
  el.scrollIntoView({ block: 'start' });
  if (!openReview(id)) el.focus();
  const o = state.orders.find((x) => x.id === id);
  // Pagamento pelo site esperando ("Continuar o pagamento" de Meus pedidos): abre a tela do Pix deste pedido.
  if (o && ['aguardando', 'conferindo', 'criando'].includes(o.payView)) { if (state.payOpen !== id) openPay(id); return; }
  if (o && o.id && o.status && o.status !== 'completed') flash('Você poderá avaliar este pedido quando o atendimento for concluído.', 'info');
}

// ---------- conta ----------
function renderAccount() {
  const u = A.user();
  state.logged = !!u;
  $('signedOut').hidden = state.logged;
  $('signedIn').hidden = !state.logged;
  if (u) $('meEmail').textContent = u.email || 'sua conta';
  // o título muda junto com a conta (antes só mudava depois de reler os pedidos: ao sair, "Meus pedidos" ficava na
  // tela por um instante com a conta já fechada)
  $('ordersTitle').textContent = state.logged ? 'Meus pedidos' : 'Pedidos deste aparelho';
}

function bindAccount() {
  montarSenha({ form: $('loginForm'), email: () => $('email').value, msg: $('loginMsg'), depois: async () => { renderAccount(); flash('Pronto, você entrou. Seus pedidos aparecem abaixo.', 'ok'); await refresh(); } });
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('email').value.trim();
    const msg = $('loginMsg');
    const btn = $('loginBtn');
    const show = (t, ok = false) => { msg.textContent = t; msg.hidden = !t; msg.classList.toggle('ok', ok); };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { show('Digite um e-mail válido, por exemplo voce@exemplo.com.'); $('email').focus(); return; }
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      if (/^#pedido-/.test(location.hash)) { try { localStorage.setItem(BACK_KEY, location.hash); } catch { /* ignora */ } }
      await A.signIn(email, location.href.split('#')[0]);
      show(`Enviamos um link para ${email}. Abra o e-mail e toque no link para entrar. Pode levar alguns minutos; confira também a caixa de spam.`, true);
    } catch (err) {
      show(err.code === 'invalid_email' ? 'Digite um e-mail válido.'
        : err.status === 429 ? 'Muitas tentativas seguidas. Espere um minuto e tente de novo.'
          : 'Não foi possível enviar o link agora. Confira a internet e tente de novo.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Receber link de entrada';
    }
  });
  $('logoutBtn').addEventListener('click', async () => {
    await A.signOut();
    renderAccount();
    flash('Você saiu da conta. Os pedidos deste aparelho continuam aqui.', 'info');
    await refresh();
  });
  $('dlData').addEventListener('click', downloadData);
  $('clearBtn').addEventListener('click', () => { $('clearConfirm').hidden = false; $('clearYes').focus(); });
  $('clearNo').addEventListener('click', () => { $('clearConfirm').hidden = true; $('clearBtn').focus(); });
  $('clearYes').addEventListener('click', async () => {
    try { localStorage.removeItem('imed_appts'); } catch { /* ignora */ }
    $('clearConfirm').hidden = true;
    toast('Pedidos deste aparelho apagados.');
    await refresh();
    $('ordersTitle').setAttribute('tabindex', '-1');
    $('ordersTitle').focus();
  });
}

// "Baixar meus dados" (LGPD, acesso): um arquivo JSON com o que a conta e este aparelho já mostram.
async function downloadData() {
  const btn = $('dlData');
  const msg = $('dataMsg');
  btn.disabled = true;
  msg.hidden = true;
  const u = state.logged ? A.user() : null;
  let requests = [], claims = [], failed = false;
  if (u?.id) {
    try {
      const uid = encodeURIComponent(u.id);
      const [r, c] = await Promise.all([
        A.select(`appointment_requests?select=*&user_id=eq.${uid}&order=created_at.desc&limit=500`),
        A.select(`establishment_claims?select=*&user_id=eq.${uid}&order=created_at.desc&limit=100`),
      ]);
      // Só o que é da própria conta; o resumo do código do pedido (review_token_hash) não interessa a ninguém.
      requests = (Array.isArray(r) ? r : []).filter((x) => x.user_id === u.id).map(({ review_token_hash, ...x }) => x);
      claims = (Array.isArray(c) ? c : []).filter((x) => x.user_id === u.id);
    } catch { failed = true; }
  }
  const data = T.dataExport({ email: u?.email ?? null, userId: u?.id ?? null, requests, claims, device: readDevice() });
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = T.dataExportName();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  msg.textContent = failed ? 'Baixamos os pedidos deste aparelho. Os dados da conta não carregaram agora: tente de novo em instantes.'
    : u ? 'Arquivo baixado com os dados da sua conta e deste aparelho.'
      : 'Arquivo baixado com os pedidos deste aparelho. Entre na conta para incluir também os pedidos dela.';
  msg.classList.toggle('ok', !failed);
  msg.hidden = false;
  btn.disabled = false;
}

async function refresh() {
  $('orders').innerHTML = '<div class="ct-skel" aria-hidden="true"></div>';
  $('orders').setAttribute('aria-busy', 'true');
  await loadOrders();
  $('orders').removeAttribute('aria-busy');
  if (state.expired) { state.expired = false; await A.signOut(); renderAccount(); }
  renderOrders();
}

async function init() {
  bindAccount();
  bindOrders();
  const r = await A.handleRedirect();
  if (r?.status === 'ok') {
    flash('Pronto, você entrou. Seus pedidos aparecem abaixo.', 'ok');
    let back = null;
    try { back = localStorage.getItem(BACK_KEY); localStorage.removeItem(BACK_KEY); } catch { /* ignora */ }
    if (back && /^#pedido-[0-9a-f-]{36}$/i.test(back)) history.replaceState(history.state, '', location.pathname + location.search + back);
  } else if (r?.status === 'error') {
    flash(r.message, 'warn');
  }
  renderAccount();
  // Confere se a sessão ainda vale (renova se preciso).
  if (state.logged && !(await A.token())) { renderAccount(); flash('Sua entrada venceu. Entre de novo com seu e-mail.', 'warn'); }
  await refresh();
  openFromHash();
  addEventListener('hashchange', openFromHash);
}

init();
