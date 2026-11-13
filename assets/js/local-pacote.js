// Vários exames no mesmo dia (iMed Agenda 5.2), na página do local (local.html). Só é baixado quando a pessoa toca em
// "Marcar mais de um exame no mesmo dia" (clínica com a venda online ligada e 2 ou mais exames à venda): o fluxo de um
// exame só (5.1, local.js) não muda.
//   1. a pessoa marca de 2 a 4 exames; o site pergunta ao banco em que dias TODOS têm horário (agenda_days de cada um);
//   2. no dia escolhido, o banco devolve as combinações com a menor espera (agenda_package_options): a ordem, o horário
//      de cada exame e a espera entre eles são os do banco, no fuso da unidade; preço e preparo, só os que a clínica
//      informou (nada de soma: o total em dinheiro não é mostrado);
//   3. "Confirmar" manda os exames numa chamada só (agenda_book): ou todos ficam confirmados, ou nenhum. O id e o
//      código são gravados no aparelho ANTES do envio (como na 5.1): "Tentar de novo" reenvia os mesmos e não marca
//      duas vezes; horário pego no meio (slot_taken) → id novo e as opções de novo.
// As regras sem tela ficam em geo-core.js (packageDays, packageOptions, packageIntentKey, bookedPackage...).
import * as G from './geo-core.js';

export function createPackage(ctx) {
  const { S, $, $$, esc, plural, rpc, loadAuth, announce, renderBooking, readIntent, saveIntent, clearIntent, reconcileIntent,
    saveLocal, done, draftOf, closedToPedido, loadSlots, DAYS } = ctx;
  const MIN = G.PACKAGE_MIN, MAX = G.PACKAGE_MAX;
  // sel: exames escolhidos; days: dias em que todos têm horário; empty: dias já conferidos sem combinação;
  // opts: opções do dia; chosen: a opção escolhida (passo "Confirme seus exames").
  const P = { sel: [], days: [], daysState: 'idle', day: '', empty: new Set(), opts: [], optState: 'idle', blocked: false, chosen: null, seq: 0, at: 0, today: '' };
  S.pkg = P;

  const selProcs = () => S.procs.filter((x) => P.sel.includes(x.id));
  const priceText = (x) => (x.price_cents != null ? G.formatPrice(x.price_cents) : 'preço sob consulta');
  const tzNote = (iso) => (G.tzDiffers(iso, S.tz) ? ` (${G.tzLabel(S.tz)})` : '');
  const nExames = (n) => `${n} exames`;

  /* ---------- desenho ---------- */
  // Redesenha a área e devolve o foco para onde estava (o exame marcado, o dia, o botão).
  function render(focus) {
    const act = document.activeElement;
    const keep = focus ?? (act?.name === 'pkProc' || act?.dataset?.pkday ? `#${act.id}` : '');
    renderBooking();
    if (keep) { const el = $(keep); if (el && !el.disabled) el.focus({ preventScroll: true }); }
  }

  // Mostra o começo do cartão com o foco em `el`. No computador o cartão rola por dentro; no celular, a página. Se o
  // começo do cartão e o foco não cabem juntos na tela, fica à vista o foco (ele nunca fica escondido).
  function topAndFocus(el) {
    const box = $('#agendar');
    if (!box) return;
    box.scrollTop = 0;
    el?.focus?.({ preventScroll: true });
    box.scrollIntoView({ block: 'start' });
    const r = el?.getBoundingClientRect?.();
    const b = box.getBoundingClientRect();
    if (r && (r.bottom > Math.min(innerHeight, b.bottom) || r.top < Math.max(0, b.top))) el.scrollIntoView({ block: 'nearest' });
  }

  function examsHTML() {
    const full = P.sel.length >= MAX;
    const rows = S.procs.map((x) => {
      const on = P.sel.includes(x.id);
      return `<label class="pk-ex"><input type="checkbox" name="pkProc" id="pk-${esc(x.id)}" value="${esc(x.id)}"${on ? ' checked' : ''}${!on && full ? ' disabled' : ''}><span><b>${esc(x.name)}</b><small>${esc([priceText(x), G.durationText(x.minutes)].filter(Boolean).join(' · '))}</small></span></label>`;
    }).join('');
    const hint = full ? `${nExames(MAX)} escolhidos: é o máximo de uma vez.`
      : P.sel.length >= MIN ? `${nExames(P.sel.length)} escolhidos.`
        : P.sel.length === 1 ? 'Escolha mais um exame, pelo menos.' : 'Escolha pelo menos 2 exames.';
    return `<fieldset class="fld pk-exams" aria-describedby="pkCount"><legend>Quais exames? <small class="h">(de ${MIN} a ${MAX})</small></legend><div class="pk-list">${rows}</div><p class="src pk-count" id="pkCount">${hint}</p></fieldset>`;
  }

  // Preparo e jejum informados pela clínica para os exames escolhidos (sem nada informado, nada aparece).
  function prepsHTML(list) {
    const rows = list.filter((x) => x.prep).map((x) => `<li><b>${esc(x.name)}:</b> ${esc(x.prep)}</li>`).join('');
    return rows ? `<div class="sl-prep pk-prep"><i class="fa-solid fa-book-medical" aria-hidden="true"></i><div><b>Preparo informado pela clínica</b><ul>${rows}</ul></div></div>` : '';
  }
  const selPreps = () => prepsHTML(selProcs().map((x) => ({ name: x.name, prep: G.prepText(x.fasting, x.prep) })));

  // Os exames de uma opção, em ordem: a espera antes (quando há), o horário e o nome (com o preço, na conferência).
  function stepsHTML(items, withPrice = false) {
    return `<ol class="pk-steps">${items.map((it) => `<li>${it.gapMin > 0 ? `<small class="pk-gap">espera de ${esc(G.durationText(it.gapMin))}</small>` : ''}<b>${it.time} às ${it.endTime}</b><span>${esc(it.name)}${withPrice ? `<small>${esc([priceText(it), G.durationText(it.minutes)].filter(Boolean).join(' · '))}</small>` : ''}</span></li>`).join('')}</ol>`;
  }
  const totHTML = (o) => { const s = G.packageSummary(o); return `<p class="pk-tot"><i class="fa-regular fa-clock" aria-hidden="true"></i><span>${esc(s.wait)} · ${esc(s.total)}</span></p>`; };

  const separateBtn = '<button class="btn btn-ghost btn-sm" type="button" data-act="pk-close"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i>Marcar os exames separados</button>';
  const nextDay = () => P.days.find((d) => d > P.day && !P.empty.has(d)) ?? '';

  function optionsHTML() {
    if (P.optState === 'loading' || P.optState === 'idle') return '<div class="lc-load sm" role="status"><span class="spin" aria-hidden="true"></span>Montando as combinações de horário…</div>';
    if (P.optState === 'error') {
      return `<p class="bk-err show" role="alert">Não foi possível montar as combinações agora.</p>
        <button class="btn btn-ghost btn-sm" type="button" data-act="pk-reload"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo</button>`;
    }
    if (!P.opts.length) {
      const next = nextDay();
      const t = next ? G.dayTab(next) : null;
      return `<div class="lc-empty pk-none"><p><b>Neste dia não dá para fazer os ${nExames(P.sel.length)} juntos.</b> Cada um tem horário livre, mas eles não se encaixam um depois do outro.</p>
        <div class="pk-none-acts">${next ? `<button class="btn btn-primary btn-sm" type="button" data-act="pk-next"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i>Ver o próximo dia (${esc(t.wd)} ${t.day})</button>` : ''}${separateBtn}</div></div>`;
    }
    const cards = P.opts.map((o, i) => {
      const s = G.packageSummary(o);
      return `<li class="pk-opt"><h3 id="pko-${i}">Opção ${i + 1}<span>${esc(s.range)}</span></h3>${stepsHTML(o.items)}${totHTML(o)}
        <button class="btn btn-primary btn-sm" type="button" data-act="pk-pick" data-i="${i}" aria-describedby="pko-${i}">Escolher a opção ${i + 1}</button></li>`;
    }).join('');
    return `<ol class="pk-opts" aria-label="Combinações de horário, da menor espera para a maior">${cards}</ol>
      <p class="src">Os horários estão no ${esc(G.tzLabel(S.tz))}, o da clínica. Ao confirmar, os ${P.sel.length} horários ficam reservados juntos: ou todos ficam confirmados, ou nenhum.</p>`;
  }

  function daysHTML() {
    if (P.sel.length < MIN) return '';
    if (P.daysState === 'loading' || P.daysState === 'idle') return '<div class="lc-load sm" role="status"><span class="spin" aria-hidden="true"></span>Buscando os dias com horário para todos os exames…</div>';
    if (P.daysState === 'error') {
      return `<p class="bk-err show" role="alert">Não foi possível carregar os dias agora.</p>
        <button class="btn btn-ghost btn-sm" type="button" data-act="pk-reload"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo</button>`;
    }
    if (P.blocked) {
      return `<div class="lc-empty pk-none"><p><b>A clínica não faz estes exames no mesmo dia.</b> É uma regra dela. Marque cada exame em um dia, ou troque os exames escolhidos.</p>
        <div class="pk-none-acts">${separateBtn}</div></div>`;
    }
    if (!P.days.length) {
      return `<div class="lc-empty pk-none"><p><b>Nenhum dia tem horário livre para todos estes exames nos próximos ${DAYS} dias.</b> Você pode marcar cada exame em um dia ou pedir que a clínica combine os horários com você.</p>
        <div class="pk-none-acts">${separateBtn}<button class="btn btn-ghost btn-sm" type="button" data-act="pedido" data-exam=""><i class="fa-solid fa-paper-plane" aria-hidden="true"></i>Pedir agendamento</button></div></div>`;
    }
    const tabs = G.nextDays(DAYS, Date.now(), S.tz).map((d) => {
      const t = G.dayTab(d);
      const can = P.days.includes(d);
      const on = d === P.day;
      const note = !can ? 'sem horário para todos os exames' : P.empty.has(d) ? 'sem combinação neste dia' : 'com horário para todos os exames';
      return `<button class="sl-day pk-day${on ? ' on' : ''}${P.empty.has(d) ? ' none' : ''}" type="button" role="tab" id="pktab-${d}" aria-selected="${on}" aria-controls="pkOpts" data-pkday="${d}"${can ? '' : ' disabled'} tabindex="${on ? 0 : -1}"><span>${esc(t.wd)}</span><b>${t.day}</b><span class="sr">, ${note}</span></button>`;
    }).join('');
    return `<div class="fld pk-days"><span class="l" id="pkDaysL">Qual dia?</span>
      <div class="sl-days" role="tablist" aria-labelledby="pkDaysL">${tabs}</div></div>
      <div class="sl-times" id="pkOpts" role="tabpanel" aria-labelledby="pktab-${P.day}"><p class="sl-when">${esc(G.formatDateLong(P.day))}</p>${optionsHTML()}</div>`;
  }

  // Passo 1 e 2: exames, dia e combinações.
  function html(notice = '') {
    const how = S.info?.mode_text ? `<p class="src sl-how">${esc(S.info.mode_text)}</p>` : '';
    return `<h2 id="h-agendar"><i class="fa-solid fa-list-check" aria-hidden="true"></i>Vários exames no mesmo dia</h2>${notice}
      <p class="pk-lead">Escolha os exames e o dia. O IMED mostra as combinações de horário com a menor espera entre um exame e outro.</p>
      ${examsHTML()}${selPreps()}${daysHTML()}
      <p class="src sl-other"><button class="link" type="button" data-act="pk-close">Marcar um exame só</button></p>${how}`;
  }

  // Passo 3 (no alto do formulário de dados): o que vai ser confirmado.
  function chosenHTML() {
    const o = P.chosen;
    const s = G.packageSummary(o);
    return `<div class="pk-chosen"><div class="pk-chosen-h"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i><b>${nExames(o.items.length)} no mesmo dia</b>
        <button class="link" type="button" data-act="pk-change">Trocar</button></div>
      <p class="pk-chosen-d">${esc(`${G.formatDateLong(o.date)}, ${s.range}${tzNote(o.start)}`)}</p>${stepsHTML(o.items, true)}${totHTML(o)}</div>${prepsHTML(o.items)}`;
  }

  /* ---------- dados ---------- */
  function resetDays() {
    P.seq++;
    P.days = []; P.daysState = 'idle'; P.opts = []; P.optState = 'idle'; P.blocked = false; P.empty = new Set(); P.chosen = null;
  }

  async function fetchOptions(day) {
    try {
      return G.packageOptions(await rpc('agenda_package_options', { p_clinic: S.place.clinic_id, p_procedures: selProcs().map((x) => x.id), p_day: day, p_limit: G.PACKAGE_OPTIONS }), selProcs(), S.tz, Date.now());
    } catch { return { state: 'error', options: [], blocked: false }; }
  }

  function applyOptions(out) {
    P.optState = out.state === 'ok' ? 'ok' : 'error';
    P.opts = out.options;
    P.blocked = out.blocked;
    if (P.optState === 'ok' && !P.opts.length && !P.blocked) P.empty.add(P.day);
    P.at = Date.now();
  }
  function announceOptions() {
    if (P.blocked) announce('A clínica não faz estes exames no mesmo dia.');
    else if (P.optState === 'ok') announce(P.opts.length ? `${plural(P.opts.length, 'combinação', 'combinações')} de horário em ${G.formatDateLong(P.day)}. A primeira: ${G.packageSummary(P.opts[0]).range}.` : `Em ${G.formatDateLong(P.day)} não dá para fazer estes exames juntos.`);
  }

  // Dias em que todos os exames têm horário e, em seguida, as combinações do primeiro dia que tiver alguma (procura
  // em até 7 dias; os que não têm ficam marcados). keepDay: fica no dia em que a pessoa estava, se ele ainda serve.
  async function loadDays(focus, keepDay = false) {
    const seq = ++P.seq;
    P.days = []; P.daysState = 'loading'; P.opts = []; P.optState = 'idle'; P.blocked = false; P.empty = new Set(); P.chosen = null;
    render(focus);
    const now = Date.now();
    const from = G.zonedDate(0, now, S.tz);
    try {
      const lists = await Promise.all(selProcs().map((x) => rpc('agenda_days', { p_clinic: S.place.clinic_id, p_procedure: x.id, p_from: from, p_to: G.zonedDate(DAYS - 1, now, S.tz) })));
      if (seq !== P.seq) return;
      P.days = G.packageDays(lists, from);
      P.daysState = 'ok';
      P.today = from;
    } catch {
      if (seq !== P.seq) return;
      P.daysState = 'error';
      render(focus);
      return;
    }
    if (!P.days.length) { P.day = ''; render(focus); announce(`Nenhum dia tem horário livre para todos estes exames nos próximos ${DAYS} dias.`); return; }
    const start = keepDay && P.days.includes(P.day) ? P.day : P.days[0];
    const queue = keepDay && P.days.includes(P.day) ? [start] : P.days.slice(0, 7);
    P.day = start;
    P.optState = 'loading';
    render(focus);
    for (const d of queue) {
      const out = await fetchOptions(d);
      if (seq !== P.seq) return;
      if (out.state === 'closed') return closedToPedido(null);
      P.day = d;
      applyOptions(out);
      if (out.state !== 'ok' || out.options.length || out.blocked) break;
    }
    // nenhum dos conferidos tem combinação: a tela fica no primeiro, com o aviso e o "próximo dia"
    if (P.optState === 'ok' && !P.opts.length && !P.blocked) P.day = start;
    render(focus);
    announceOptions();
  }

  async function loadOptions(focus) {
    const seq = ++P.seq;
    P.opts = []; P.optState = 'loading'; P.chosen = null;
    render(focus);
    const out = await fetchOptions(P.day);
    if (seq !== P.seq) return;
    if (out.state === 'closed') return closedToPedido(null);
    applyOptions(out);
    render(focus);
    announceOptions();
  }

  /* ---------- passos ---------- */
  function open() {
    S.mode = 'pkg';
    S.notice = '';
    S.chosen = '';
    resetDays();
    P.sel = S.procs.some((x) => x.id === S.procId) ? [S.procId] : [];
    P.day = '';
    renderBooking();
    $('input[name="pkProc"]')?.focus();
    announce(`Vários exames no mesmo dia. Escolha de ${MIN} a ${MAX} exames.`);
  }

  // Volta para o fluxo de um exame só (5.1), com os horários de novo.
  function close() {
    resetDays();
    S.mode = 'slot';
    S.notice = '';
    loadSlots().then(() => $('#slProc')?.focus());
  }

  function toggle(input) {
    const id = input.value;
    if (!S.procs.some((x) => x.id === id)) return;
    if (input.checked && !P.sel.includes(id) && P.sel.length < MAX) P.sel.push(id);
    else if (!input.checked) P.sel = P.sel.filter((x) => x !== id);
    S.notice = '';
    if (P.sel.length >= MIN) loadDays(`#${input.id}`, true);
    else { resetDays(); render(`#${input.id}`); }
  }

  function pick(i) {
    const o = P.opts[i];
    if (!o) return;
    if (!(Date.parse(o.start) > Date.now())) { backToOptions(null, G.PKG_MSG.past); return; }
    P.chosen = o;
    S.notice = '';
    renderBooking();
    topAndFocus($('#bkName'));
    announce(`Opção escolhida: ${nExames(o.items.length)}, ${G.packageSummary(o).range}. Preencha seus dados e confirme.`);
  }

  // A combinação não vale mais (horário pego, regra mudou, já passou): nada foi marcado; aviso, dados mantidos e as
  // opções de novo, no mesmo dia.
  async function backToOptions(form, text) {
    S.notice = text;
    if (form) S.draft = draftOf(form);
    // o cartão não encolhe enquanto as combinações voltam (a página não pula nem puxa o mapa lá de baixo)
    const box = $('#agendar');
    if (box) box.style.minHeight = `${box.offsetHeight}px`;
    await loadDays(undefined, true);
    if (box) box.style.minHeight = '';
    topAndFocus($('#slNotice'));
  }

  // O horário da opção escolhida já passou (a página ficou aberta): chamado pelo local.js antes de enviar.
  const stale = (form) => backToOptions(form, G.PKG_MSG.past);

  // Confirmar o pacote: a intenção (id e código) é gravada ANTES do envio e reaproveitada no "Tentar de novo" da mesma
  // combinação — o banco devolve o mesmo agendamento, sem marcar duas vezes.
  async function submit(form, v) {
    const p = S.place;
    const opt = P.chosen;
    const errBox = $('#bkErr', form);
    const btn = $('#bkBtn', form);
    const label = `<i class="fa-solid fa-check" aria-hidden="true"></i>Confirmar os ${nExames(opt.items.length)}`;
    if (!(Date.parse(opt.start) > Date.now())) return stale(form);
    const key = G.packageIntentKey({ clinic: p.clinic_id, items: opt.items });
    // Outro agendamento desta clínica começado antes (resposta perdida, "Trocar"): confere antes de marcar este.
    const stored = S.intent ?? readIntent();
    if (G.intentOfClinic(stored, p.clinic_id) && !G.intentFor(stored, key)) {
      const c = await reconcileIntent();
      if (c === 'booked') return;
      if (c === 'unknown') {
        errBox.innerHTML = esc(G.PKG_MSG.check);
        errBox.classList.add('show');
        btn.disabled = false;
        btn.innerHTML = label;
        btn.focus();
        return;
      }
    }
    const intent = { ...(G.intentFor(S.intent, key) ?? G.intentFor(readIntent(), key) ?? G.newIntent(key)), place: { id: p.id, name: p.name, ...(p.phone ? { phone: p.phone } : {}) } };
    saveIntent(intent);
    const args = G.agendaBookArgs(p, { ...v, items: opt.items }, intent);
    let res;
    let logged = false;
    try {
      const auth = await loadAuth();
      logged = !!(await auth?.token?.().catch(() => null));
      res = logged ? await auth.rpc('agenda_book', args) : await rpc('agenda_book', args);
    } catch (err) {
      res = G.isSlotTaken(err) ? { status: 'slot_taken' } : null;
    }
    const out = G.packageOutcome(res);
    if (out.kind === 'ok') {
      clearIntent();
      const booked = { ...v, ...G.bookedPackage(opt, res, S.tz) };
      saveLocal(G.localAppt(p, booked, intent.id, intent.token));
      return done(booked, intent.id, logged);
    }
    if (out.kind === 'taken' || out.kind === 'changed') {
      clearIntent();
      return backToOptions(form, G.PKG_MSG[out.kind]);
    }
    if (out.kind === 'closed') {
      clearIntent();
      return closedToPedido(form);
    }
    // limite, dados recusados, id já usado para outra combinação: id novo na próxima tentativa. Falha de rede ou
    // resposta estranha: a MESMA intenção (o reenvio é seguro).
    if (out.kind !== 'error') clearIntent();
    const tel = p.phone && G.telHref(p.phone);
    errBox.innerHTML = esc(G.PKG_MSG[out.kind] ?? G.PKG_MSG.error) + (tel && out.kind !== 'limit' ? ` Se preferir, <a class="link" href="${esc(tel)}">ligue para a clínica</a>.` : '');
    errBox.classList.add('show');
    btn.disabled = false;
    btn.innerHTML = out.kind === 'error' ? '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo' : label;
    btn.focus();
  }

  /* ---------- eventos ---------- */
  const active = () => S.mode === 'pkg' && !S.done;
  document.addEventListener('change', (e) => {
    if (active() && e.target.name === 'pkProc') toggle(e.target);
  });
  document.addEventListener('click', (e) => {
    if (!active()) return;
    const day = e.target.closest('[data-pkday]');
    if (day && !day.disabled) { P.day = day.dataset.pkday; S.notice = ''; loadOptions(`#pktab-${P.day}`); return; }
    const el = e.target.closest('[data-act]');
    const act = el?.dataset.act;
    if (act === 'pk-pick') pick(Number(el.dataset.i));
    else if (act === 'pk-close') close();
    else if (act === 'pk-reload') (P.daysState === 'error' ? loadDays('[data-act="pk-reload"]', true) : loadOptions('[data-act="pk-reload"]'));
    else if (act === 'pk-next') { const d = nextDay(); if (d) { P.day = d; loadOptions(`#pktab-${d}`); } }
    else if (act === 'pk-change') { const f = $('#bookForm'); if (f) S.draft = draftOf(f); P.chosen = null; S.notice = ''; renderBooking(); topAndFocus($('[data-act="pk-pick"]')); }
  });
  // Setas do teclado entre os dias (padrão de abas).
  document.addEventListener('keydown', (e) => {
    const tab = e.target.closest?.('.pk-day');
    if (!tab || !active() || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const tabs = $$('.pk-day:not([disabled])');
    const i = tabs.indexOf(tab);
    const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1) : tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    if (!next || next === tab) return;
    e.preventDefault();
    P.day = next.dataset.pkday;
    loadOptions(`#pktab-${P.day}`);
  });
  // Volta para a aba depois de um tempo (ou de virar o dia): dias e combinações de novo, se a pessoa ainda escolhe.
  function refreshIfStale() {
    if (document.visibilityState !== 'visible' || !active() || P.chosen || P.daysState !== 'ok' || P.sel.length < MIN) return;
    if (Date.now() - P.at > 5 * 60000 || G.zonedDate(0, Date.now(), S.tz) !== P.today) loadDays(undefined, true);
  }
  document.addEventListener('visibilitychange', refreshIfStale);
  addEventListener('pageshow', refreshIfStale);

  return { open, close, html, chosenHTML, submit, stale };
}
