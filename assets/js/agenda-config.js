// Painel da clínica, iMed Agenda fase 4.1: configuração da agenda (configuração rápida, unidade e fuso, modalidade e
// compromisso, horários de funcionamento, aparelhos/salas/profissionais, exames e conferência de horários livres) e a
// equipe (convites e papéis). Desde a 4.2 a configuração fica na aba "Configurar agenda" (a aba "Agenda" é a agenda da
// recepção, em agenda.js). Só fala com o banco pelas funções da agenda (3.2, 3.4 e 4.1): agenda_config,
// agenda_unit_save, agenda_mode_set, agenda_rules_set, agenda_resource_save, agenda_procedure_save, agenda_slots,
// agenda_team, agenda_invite, agenda_invite_cancel, agenda_member_role, agenda_member_remove, agenda_my_invites e
// agenda_invite_accept. Nenhum dado de paciente aparece aqui. Regras puras em agenda-core.js.
//
// MFA (decisão 17 do dono, pendente): a verificação em duas etapas fica desligada nesta fase. Quando o dono decidir,
// entra no auth.js e as funções de equipe e integração passam a exigir aal2 (arquitetura §12).
import { auth, $, $$, esc, loading, note, toast, friendlyError, fmtDate, fmtDateTime } from './clinica.js';
import * as A from './agenda-core.js';

const rpc = (fn, args) => auth.rpc(fn, args);
const isMissingFn = (err) => err?.status === 404 || err?.data?.code === 'PGRST202' || err?.data?.code === '42883';
const errText = (err, fb) => (isMissingFn(err) ? 'Esta parte da agenda ainda não está disponível. Tente de novo mais tarde.' : friendlyError(err, fb));
const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
const fieldErr = (id, text) => { const el = $(`#${id}`); const er = $(`#${id}Err`); if (er) er.textContent = text || ''; if (el) { if (text) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); } };
const busy = (btn, on, label) => { if (!btn) return; btn.disabled = on; if (label) btn.textContent = label; };
const dayIn = (tz, ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const timeIn = (tz, iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/* =====================================================================================================================
   AGENDA: configuração
   ===================================================================================================================== */
// ctx: { clinic, perms, admin, lost(), goTab(id) }
let S = null;

export async function renderConfig(box, ctx) {
  const cid = ctx.clinic.id;
  const same = () => S?.clinicId === cid && box.isConnected;
  box.innerHTML = loading('Carregando a configuração da agenda…');
  S = { clinicId: cid, ctx, box, cfg: null, team: null, notify: null, exams: [], edit: { res: null, proc: null }, week: null, keep: [], qc: null, priceOk: false };
  try {
    const [cfg, exams, team, notify] = await Promise.all([
      rpc('agenda_config', { p_clinic: cid }),
      auth.select(`clinic_exams?select=exam_code&clinic_id=eq.${cid}`).catch(() => []),
      (A.can(ctx.perms, 'equipe.gerenciar') || ctx.admin) ? rpc('agenda_team', { p_clinic: cid }).catch(() => null) : null,
      // avisos (5.3): banco sem a função, ou conta sem permissão = a parte "Avisos" não aparece
      rpc('agenda_notify_config', { p_clinic: cid }).catch(() => null),
    ]);
    if (!same()) return;
    if (cfg?.status !== 'ok') {
      box.innerHTML = cfg?.status === 'forbidden' ? '' : note(esc(A.statusText(cfg?.status, 'Não foi possível carregar a configuração da agenda.')), 'err');
      return;
    }
    S.cfg = cfg;
    S.exams = (exams || []).map((x) => x.exam_code).filter((c) => A.EXAM_CODES.includes(c));
    S.team = team?.status === 'ok' ? team : null;
    S.notify = A.normalizeNotifyConfig(notify);
    const w = A.weekFromRules(cfg.rules);
    S.week = w.week; S.keep = w.keep;
  } catch (err) {
    if (ctx.lost() || !same()) return;
    box.innerHTML = `${note(esc(errText(err, 'Não foi possível carregar a configuração da agenda agora.')), 'err')}
      <div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="acRetry">Tentar de novo</button></div>`;
    $('#acRetry', box).onclick = () => renderConfig(box, ctx);
    return;
  }
  draw();
}

async function reload(focusSel, msg) {
  const { box, ctx } = S;
  const cid = S.clinicId;
  try {
    const cfg = await rpc('agenda_config', { p_clinic: cid });
    if (S?.clinicId !== cid || cfg?.status !== 'ok') return;
    S.cfg = cfg;
    const w = A.weekFromRules(cfg.rules);
    S.week = w.week; S.keep = w.keep;
    draw();
    if (msg) { const m = $(msg[0]); if (m) m.innerHTML = note(esc(msg[1]), msg[2] || 'ok'); }
    if (focusSel) $(focusSel)?.focus();
  } catch (err) {
    if (!ctx.lost()) toast(errText(err, 'Não foi possível atualizar a tela.'));
    if (box.isConnected) draw();
  }
}

function draw() {
  const { box, cfg } = S;
  box.innerHTML = cfg.active ? activeHtml() : quickHtml();
  box.onclick = onClick;
  box.onchange = onChange;
  box.oninput = onInput;
  box.onsubmit = onSubmit;
}

/* ---------- configuração rápida (agenda ainda não ativa) ---------- */
function quickHtml() {
  const { cfg } = S;
  const u = cfg.unit;
  if (!S.qc) {
    const codes = S.exams.length ? S.exams : [''];
    S.qc = { timezone: u.timezone, confirmTz: false, days: [], open: '', close: '', pauseFrom: '', pauseTo: '', exams: codes.map((c) => ({ exam_code: c, name: c ? A.examLabel(c) : '', kind: 'equipamento', count: '', duration: '' })) };
  }
  const q = S.qc;
  const tzHint = u.timezone_suggested && u.timezone_suggested !== q.timezone ? ` Pelo estado da clínica, o sugerido é: ${A.tzLabel(u.timezone_suggested)}.` : '';
  return `<section class="ac-sec" aria-labelledby="qcTitle">
    <h3 class="ac-h" id="qcTitle">Ativar a agenda da clínica</h3>
    ${cfg.old_schedule_exists ? note(esc(A.STATUS_TEXT.old_schedule_exists), 'warn') : ''}
    <p class="cl-help">A agenda ainda não está ativa. Enquanto isso, nada muda para os pacientes: eles enviam o pedido e a clínica liga para combinar.
      Preencha abaixo para criar a agenda de verdade (dá para mudar tudo depois). Ativar a agenda <b>não</b> libera a marcação de horário pelo site.</p>
    <form id="qcForm" novalidate aria-labelledby="qcTitle">
      <fieldset class="ac-fs"><legend>1. Fuso da clínica</legend>
        <div class="cl-field"><label class="cl-lbl" for="qcTz">Fuso</label>
          <select id="qcTz" aria-describedby="qcTzHint qcTzErr">${opts(A.TIMEZONES, q.timezone)}</select>
          <span class="cl-hint" id="qcTzHint">Os horários dos pacientes seguem este fuso.${esc(tzHint)}</span><span class="cl-err" id="qcTzErr"></span></div>
        <label class="cl-check ac-mt"><input type="checkbox" id="qcConfirmTz"${q.confirmTz ? ' checked' : ''} aria-describedby="qcConfirmTzErr"><span>Confirmo que este é o fuso da clínica</span></label>
        <span class="cl-err" id="qcConfirmTzErr"></span>
      </fieldset>
      <fieldset class="ac-fs"><legend>2. Dias e horário de atendimento</legend>
        <div class="ac-days" role="group" aria-labelledby="qcDaysLbl" aria-describedby="qcDaysErr"><span class="cl-lbl" id="qcDaysLbl">Dias</span>
          ${A.WEEK_ORDER.map((d) => `<label class="cl-check"><input type="checkbox" name="qcDay" value="${d}"${q.days.includes(d) ? ' checked' : ''}><span>${A.WEEKDAYS[d]}</span></label>`).join('')}</div>
        <span class="cl-err" id="qcDaysErr"></span>
        <div class="ac-g4">
          ${timeField('qcOpen', 'Abre às', q.open)}${timeField('qcClose', 'Fecha às', q.close)}
          ${timeField('qcPauseFrom', 'Pausa das <small>(opcional)</small>', q.pauseFrom, 'qcPauseErr')}${timeField('qcPauseTo', 'Pausa até <small>(opcional)</small>', q.pauseTo, 'qcPauseErr')}
        </div>
        <span class="cl-err" id="qcPauseErr"></span>
      </fieldset>
      <fieldset class="ac-fs"><legend>3. Exames: o que cada um usa e quanto dura</legend>
        <p class="cl-hint">Para cada exame: quantos aparelhos (ou salas, ou profissionais) fazem este exame ao mesmo tempo e quanto tempo ele leva.</p>
        <ul class="ac-qx" id="qcExams">${q.exams.map(qcExamHtml).join('')}</ul>
        <span class="cl-err" id="qcExamsErr"></span>
        <div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="qcAdd"><i class="fa-solid fa-plus" aria-hidden="true"></i> Adicionar outro exame</button></div>
      </fieldset>
      <div class="cl-actions"><button class="btn btn-coral" type="submit" id="qcSave">Ativar a agenda</button></div>
      <div id="qcMsg" aria-live="polite"></div>
    </form>
  </section>`;
}

function timeField(id, label, value, errId) {
  return `<div class="cl-field"><label class="cl-lbl" for="${id}">${label}</label>
    <input type="time" id="${id}" step="300" value="${esc(value || '')}" aria-describedby="${errId || `${id}Err`}">${errId ? '' : `<span class="cl-err" id="${id}Err"></span>`}</div>`;
}

function qcExamHtml(x, i) {
  const k = `qx${i}`;
  return `<li class="ac-qrow" data-i="${i}">
    <div class="ac-g5">
      <div class="cl-field"><label class="cl-lbl" for="${k}code">Tipo de exame</label>
        <select id="${k}code" data-q="exam_code" aria-describedby="${k}codeErr"><option value="">Escolha</option>${opts(A.EXAM_CODES.map((c) => [c, A.examLabel(c)]), x.exam_code)}</select><span class="cl-err" id="${k}codeErr"></span></div>
      <div class="cl-field"><label class="cl-lbl" for="${k}name">Nome do exame</label>
        <input type="text" id="${k}name" data-q="name" maxlength="120" value="${esc(x.name)}" aria-describedby="${k}nameErr" autocomplete="off"><span class="cl-err" id="${k}nameErr"></span></div>
      <div class="cl-field"><label class="cl-lbl" for="${k}kind">Usa</label>
        <select id="${k}kind" data-q="kind" aria-describedby="${k}kindErr">${opts(A.KINDS.map((c) => [c, A.KIND_LABEL[c]]), x.kind)}</select><span class="cl-err" id="${k}kindErr"></span></div>
      <div class="cl-field"><label class="cl-lbl" for="${k}count">Quantos</label>
        <input type="number" inputmode="numeric" min="1" max="20" id="${k}count" data-q="count" value="${esc(x.count)}" aria-describedby="${k}countErr"><span class="cl-err" id="${k}countErr"></span></div>
      <div class="cl-field"><label class="cl-lbl" for="${k}dur">Duração (min)</label>
        <input type="number" inputmode="numeric" min="5" max="480" step="5" id="${k}dur" data-q="duration" value="${esc(x.duration)}" aria-describedby="${k}durErr"><span class="cl-err" id="${k}durErr"></span></div>
    </div>
    ${S.qc.exams.length > 1 ? `<button class="btn btn-ghost btn-sm" type="button" data-qrm="${i}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i> Remover<span class="sr"> o exame ${i + 1}${x.name ? `, ${esc(x.name)}` : ''}</span></button>` : ''}
  </li>`;
}

function readQuick() {
  const q = S.qc;
  q.timezone = $('#qcTz').value;
  q.confirmTz = $('#qcConfirmTz').checked;
  q.days = $$('input[name="qcDay"]:checked').map((x) => Number(x.value));
  q.open = $('#qcOpen').value; q.close = $('#qcClose').value;
  q.pauseFrom = $('#qcPauseFrom').value; q.pauseTo = $('#qcPauseTo').value;
  $$('.ac-qrow').forEach((li) => {
    const x = q.exams[Number(li.dataset.i)];
    $$('[data-q]', li).forEach((el) => { x[el.dataset.q] = el.value; });
  });
  return q;
}

async function saveQuick() {
  const q = readQuick();
  const e = A.quickErrors(q);
  const ids = [['qcTz', e.timezone], ['qcConfirmTz', e.confirmTz], ['qcOpen', e.open], ['qcClose', e.close]];
  ids.forEach(([id, t]) => fieldErr(id, t));
  $('#qcDaysErr').textContent = e.days || '';
  $('#qcPauseErr').textContent = e.pause || '';
  ['qcPauseFrom', 'qcPauseTo'].forEach((id) => { if (e.pause) $(`#${id}`).setAttribute('aria-invalid', 'true'); else $(`#${id}`).removeAttribute('aria-invalid'); });
  $('#qcExamsErr').textContent = e.exams || '';
  q.exams.forEach((_, i) => {
    fieldErr(`qx${i}code`, e[`ex${i}code`]); fieldErr(`qx${i}name`, e[`ex${i}name`]); fieldErr(`qx${i}kind`, e[`ex${i}kind`]);
    fieldErr(`qx${i}count`, e[`ex${i}count`]); fieldErr(`qx${i}dur`, e[`ex${i}dur`]);
  });
  const msg = $('#qcMsg');
  msg.innerHTML = '';
  const first = $('#qcForm [aria-invalid="true"]') || (e.days ? $('input[name="qcDay"]') : null);
  if (Object.keys(e).length) {
    msg.innerHTML = note('Confira os campos marcados.', 'err');
    (first || $('#qcTz')).focus();
    return;
  }
  const plan = A.quickPlan(q);
  const cid = S.clinicId;
  const btn = $('#qcSave');
  busy(btn, true, 'Ativando…');
  const step = (t) => { if (msg.isConnected) msg.innerHTML = loading(t); };
  try {
    step('Ativando a agenda e confirmando o fuso…');
    let r = await rpc('agenda_unit_save', { p_clinic: cid, p_settings: plan.unit, p_confirm: false });
    if (r?.status !== 'ok') throw Object.assign(new Error(r?.status), { result: r?.status });
    step('Cadastrando aparelhos, salas e profissionais…');
    const idOf = {};
    for (const x of plan.resources) {
      r = await rpc('agenda_resource_save', { p_clinic: cid, p_resource: { kind: x.kind, name: x.name }, p_confirm: false });
      if (r?.status !== 'ok') throw Object.assign(new Error(r?.status), { result: r?.status, partial: true });
      idOf[x.key] = r.id;
    }
    step('Cadastrando os exames…');
    for (const p of plan.procedures) {
      r = await rpc('agenda_procedure_save', { p_clinic: cid, p_confirm: false, p_proc: {
        exam_code: p.exam_code, name: p.name, duration_min: p.duration_min, requirements: A.requirementFor(p.kind, p.resourceKeys.map((k) => idOf[k])) } });
      if (r?.status !== 'ok') throw Object.assign(new Error(r?.status), { result: r?.status, partial: true });
    }
    step('Gravando o horário de atendimento…');
    r = await rpc('agenda_rules_set', { p_clinic: cid, p_resource: null, p_rules: plan.rules, p_confirm: false });
    if (r?.status !== 'ok') throw Object.assign(new Error(r?.status), { result: r?.status, partial: true });
    S.qc = null;
    toast('Agenda ativada.');
    await reload('#acTitle', ['#acTopMsg', 'Agenda ativada. A marcação pelo site continua desligada: os pacientes seguem enviando pedidos. Confira abaixo e escolha a modalidade quando quiser.']);
  } catch (err) {
    if (S.ctx.lost()) return;
    const t = err.result ? A.statusText(err.result) : errText(err, 'Não foi possível ativar a agenda agora. Tente de novo.');
    if (err.partial) {
      // parte já foi gravada: mostra o que existe e o erro
      await reload(null, ['#acTopMsg', `A agenda foi ativada, mas uma parte não foi salva: ${t} Confira e complete abaixo.`, 'warn']);
      return;
    }
    if (msg.isConnected) msg.innerHTML = note(esc(t), 'err');
    busy(btn, false, 'Ativar a agenda');
    btn.focus();
  }
}

/* ---------- agenda ativa ---------- */
function activeHtml() {
  const { cfg } = S;
  const u = cfg.unit;
  return `<section class="ac-sec" aria-labelledby="acTitle">
      <h3 class="ac-h" id="acTitle" tabindex="-1">Configuração da agenda</h3>
      <div id="acTopMsg" aria-live="polite"></div>
      <dl class="ac-sum">
        <div><dt>Modalidade</dt><dd>${esc(A.MODE_LABEL[u.agenda_mode] || u.agenda_mode)}</dd></div>
        <div><dt>Fuso</dt><dd>${esc(A.tzLabel(u.timezone))}${u.timezone_confirmed_at ? ' <span class="bd bd-ok">confirmado</span>' : ' <span class="bd bd-warn">não confirmado</span>'}</dd></div>
        <div><dt>Marcação pelo site</dt><dd>${u.agenda_online_since ? 'Ligada' : 'Desligada (os pacientes enviam pedido)'}</dd></div>
        <div><dt>Atendimento</dt><dd>${esc(A.weekSummary(S.week))}</dd></div>
      </dl>
      <nav class="ac-toc" aria-label="Partes da configuração"><a href="#acUnitT">Unidade e fuso</a><a href="#acModeT">Modalidade</a><a href="#acHoursT">Horários</a><a href="#acResT">Aparelhos e salas</a><a href="#acProcT">Exames</a><a href="#acPvT">Conferir horários</a>${S.notify ? '<a href="#acNtT">Avisos e lembretes</a>' : ''}</nav>
    </section>
    ${unitHtml()}${modeHtml()}${hoursHtml()}${resourcesHtml()}${proceduresHtml()}${previewHtml()}${notifyHtml()}`;
}

function unitHtml() {
  const u = S.cfg.unit;
  const tzBlock = u.timezone_confirmed_at
    ? `<p class="cl-help">Fuso: <b>${esc(A.tzLabel(u.timezone))}</b> (confirmado). Para trocar, fale com o IMED: muda o horário de todos os agendamentos.</p>`
    : `<div class="cl-field"><label class="cl-lbl" for="uTz">Fuso</label><select id="uTz">${opts(A.TIMEZONES, u.timezone)}</select></div>
       <label class="cl-check ac-mt"><input type="checkbox" id="uTzOk"><span>Confirmo que este é o fuso da clínica</span></label>`;
  return `<section class="ac-sec" aria-labelledby="acUnitT"><h3 class="ac-h" id="acUnitT">Unidade e fuso</h3>
    <form id="unitForm" novalidate aria-labelledby="acUnitT">
      ${tzBlock}
      <div class="cl-grid ac-mt">
        <div class="cl-field"><label class="cl-lbl" for="uStep">Os horários começam a cada</label>
          <select id="uStep" aria-describedby="uStepErr">${opts(A.STEP_OPTIONS.map((m) => [m, `${m} minutos`]), u.step_min)}</select><span class="cl-err" id="uStepErr"></span></div>
        <div class="cl-field"><label class="cl-lbl" for="uNotice">Antecedência mínima (horas)</label>
          <input type="number" inputmode="numeric" min="0" max="168" id="uNotice" value="${esc(Math.round((u.min_notice_min ?? 0) / 60))}" aria-describedby="uNoticeHint uNoticeErr">
          <span class="cl-hint" id="uNoticeHint">Horários mais próximos que isso não são oferecidos.</span><span class="cl-err" id="uNoticeErr"></span></div>
        <div class="cl-field"><label class="cl-lbl" for="uAdvance">Agenda aberta para os próximos (dias)</label>
          <input type="number" inputmode="numeric" min="1" max="365" id="uAdvance" value="${esc(u.max_advance_days ?? '')}" aria-describedby="uAdvanceErr"><span class="cl-err" id="uAdvanceErr"></span></div>
        <div class="cl-field"><label class="cl-lbl" for="uHol">Feriados da cidade e do estado conferidos até</label>
          <input type="date" id="uHol" value="${esc(u.holidays_checked_until || '')}" aria-describedby="uHolHint uHolErr">
          <span class="cl-hint" id="uHolHint">Os feriados nacionais são lançados pelo IMED. Os da cidade e do estado, a clínica confere e bloqueia.</span><span class="cl-err" id="uHolErr"></span></div>
      </div>
      <label class="cl-check ac-mt"><input type="checkbox" id="uClosesHol"${u.closes_on_holidays !== false ? ' checked' : ''}><span>A clínica fecha nos feriados</span></label>
      <div class="cl-actions"><button class="btn btn-primary" type="submit" id="uSave">Salvar unidade</button></div>
      <div id="uMsg" aria-live="polite"></div>
    </form></section>`;
}

function modeHtml() {
  const u = S.cfg.unit;
  const can = ['pedido', 'nativa', 'manual'];
  return `<section class="ac-sec" aria-labelledby="acModeT"><h3 class="ac-h" id="acModeT">Modalidade</h3>
    <p class="cl-help">Como a clínica usa a agenda. Seja qual for a escolha, a marcação de horário pelo site só começa quando o IMED liberar; até lá os pacientes enviam pedido.</p>
    <form id="modeForm" novalidate aria-labelledby="acModeT">
      <fieldset class="ac-fs ac-modes"><legend class="sr">Modalidade da agenda</legend>
        ${can.map((m) => `<label class="ac-mode"><input type="radio" name="acMode" value="${m}"${u.agenda_mode === m ? ' checked' : ''}><span><b>${esc(A.MODE_LABEL[m])}</b><small>${esc(A.MODE_HELP[m])}</small></span></label>`).join('')}
        <p class="ac-mode ac-off"><span><b>${esc(A.MODE_LABEL.externa)}</b><small>${esc(A.MODE_HELP.externa)}</small></span></p>
      </fieldset>
      <div id="acCommitBox"${u.agenda_mode === 'manual' ? '' : ' hidden'}>
        <label class="cl-check ac-mt"><input type="checkbox" id="acCommit"${u.manual_commitment_at ? ' checked' : ''} aria-describedby="acCommitErr"><span>${esc(A.COMMITMENT_TEXT)}</span></label>
        <span class="cl-err" id="acCommitErr"></span>
      </div>
      <div class="cl-actions"><button class="btn btn-primary" type="submit" id="modeSave">Salvar modalidade</button></div>
      <div id="modeMsg" aria-live="polite"></div>
    </form></section>`;
}

/* ---------- horários de funcionamento ---------- */
function hoursHtml() {
  return `<section class="ac-sec" aria-labelledby="acHoursT"><h3 class="ac-h" id="acHoursT">Horários de atendimento</h3>
    <p class="cl-help">Quando a clínica atende, em cada dia da semana, e as pausas (como o almoço). Dias sem horário ficam fechados.</p>
    ${S.keep.length ? note('Há horários especiais (com data de validade ou só para alguns exames) feitos pelo IMED. Eles continuam valendo e não aparecem aqui.', 'info') : ''}
    <form id="hrForm" novalidate aria-labelledby="acHoursT">
      <div class="cl-actions ac-tools"><button class="btn btn-ghost btn-sm" type="button" id="hrCopy"><i class="fa-regular fa-copy" aria-hidden="true"></i> Copiar segunda para terça a sexta</button></div>
      <div id="hrCopyMsg" class="cl-msg" aria-live="polite"></div>
      <div class="ac-week" id="hrWeek">${A.WEEK_ORDER.map(dayHtml).join('')}</div>
      <div class="cl-actions"><button class="btn btn-primary" type="submit" id="hrSave">Salvar horários</button><span class="ac-dirty" id="hrDirty" aria-live="polite">${S.weekDirty ? 'Há mudanças ainda não salvas.' : ''}</span></div>
      <div id="hrMsg" aria-live="polite"></div>
    </form></section>`;
}

function dayHtml(d) {
  const day = S.week[d];
  const row = (k, x, i) => {
    const id = `hr-${d}-${k}-${i}`;
    const what = k === 'open' ? 'Atende' : 'Pausa';
    return `<li class="ac-hrow" data-d="${d}" data-k="${k}" data-i="${i}">
      <span class="ac-tag ${k === 'open' ? 'ac-tag-open' : 'ac-tag-pause'}">${what}</span>
      <div class="cl-field"><label class="cl-lbl" for="${id}s">Das</label><input type="time" step="300" id="${id}s" data-h="start" value="${esc(x.start)}" aria-describedby="${id}e"></div>
      <div class="cl-field"><label class="cl-lbl" for="${id}f">Às</label><input type="time" step="300" id="${id}f" data-h="end" value="${esc(x.end)}" aria-describedby="${id}e"></div>
      <button class="btn btn-ghost btn-sm" type="button" data-hrm="${d}-${k}-${i}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i> Remover<span class="sr"> ${what.toLowerCase()} de ${A.WEEKDAYS[d].toLowerCase()}${x.start ? `, ${esc(x.start)} às ${esc(x.end)}` : ''}</span></button>
      <p class="cl-err ac-full" id="${id}e"></p>
    </li>`;
  };
  const n = day.open.length;
  return `<section class="ac-day${n ? '' : ' closed'}" id="hrday-${d}" aria-labelledby="hrd-${d}">
    <div class="ac-dh"><h4 id="hrd-${d}">${A.WEEKDAYS[d]}</h4><span class="ac-sub">${n ? day.open.map((x) => `${esc(x.start)}–${esc(x.end)}`).join(', ') : 'Fechado'}</span>
      <span class="ac-dbtn"><button class="btn btn-ghost btn-sm" type="button" data-hadd="${d}-open"><i class="fa-solid fa-plus" aria-hidden="true"></i> Horário<span class="sr"> de atendimento na ${A.WEEKDAYS[d].toLowerCase()}</span></button>
      ${n ? `<button class="btn btn-ghost btn-sm" type="button" data-hadd="${d}-pause"><i class="fa-solid fa-mug-hot" aria-hidden="true"></i> Pausa<span class="sr"> na ${A.WEEKDAYS[d].toLowerCase()}</span></button>` : ''}</span></div>
    ${day.open.length || day.pause.length ? `<ul class="ac-hrows">${day.open.map((x, i) => row('open', x, i)).join('')}${day.pause.map((x, i) => row('pause', x, i)).join('')}</ul>` : ''}
  </section>`;
}

function readWeekField(el) {
  const li = el.closest('.ac-hrow');
  if (!li) return;
  const x = S.week[li.dataset.d][li.dataset.k][Number(li.dataset.i)];
  x[el.dataset.h] = el.value;
  S.weekDirty = true;
  const d = $('#hrDirty'); if (d) d.textContent = 'Há mudanças ainda não salvas.';
}

function showWeekErrors(e) {
  $$('.ac-hrow').forEach((li) => {
    const key = `${li.dataset.d}-${li.dataset.k}-${li.dataset.i}`;
    const t = e[key] || '';
    $(`#hr-${key}e`).textContent = t;
    $$('input', li).forEach((x) => (t ? x.setAttribute('aria-invalid', 'true') : x.removeAttribute('aria-invalid')));
  });
}

async function saveHours(force = false) {
  const e = A.weekErrors(S.week);
  showWeekErrors(e);
  const msg = $('#hrMsg');
  msg.innerHTML = '';
  if (Object.keys(e).length) {
    msg.innerHTML = note(esc(e._all || 'Confira os horários marcados.'), 'err');
    $('#hrForm [aria-invalid="true"]')?.focus();
    return;
  }
  const btn = $('#hrSave');
  busy(btn, true, 'Salvando…');
  try {
    const r = await rpc('agenda_rules_set', { p_clinic: S.clinicId, p_resource: null, p_rules: A.rulesFromWeek(S.week, S.keep), p_confirm: force });
    if (r?.status === 'affects_appointments') { askForce(msg, r.items, 'hr'); return; }
    if (r?.status !== 'ok') throw Object.assign(new Error(r?.status), { result: r?.status });
    S.weekDirty = false;
    toast('Horários salvos.');
    await reload('#hrSave', ['#hrMsg', r.conflicts ? `Horários salvos. ${r.conflicts} agendamento(s) foram para a lista de conflitos, para remarcar.` : 'Horários salvos.']);
  } catch (err) {
    if (S.ctx.lost()) return;
    msg.innerHTML = note(esc(err.result ? A.statusText(err.result) : errText(err, 'Não foi possível salvar os horários.')), 'err');
  } finally { busy(btn, false, 'Salvar horários'); }
}

// Mudança que tira agendamentos do lugar: mostra quantos e pede a confirmação.
function askForce(msg, items, kind) {
  msg.innerHTML = `${note(`${esc(A.affectsText(items))} Se salvar mesmo assim, esses pacientes vão para a lista de conflitos, para a clínica remarcar.`, 'warn')}
    <div class="cl-actions"><button class="btn btn-danger btn-sm" type="button" data-force="${kind}">Salvar mesmo assim</button><button class="btn btn-ghost btn-sm" type="button" data-unforce="${kind}">Não salvar</button></div>`;
  $(`[data-force="${kind}"]`, msg)?.focus();
}

/* ---------- aparelhos, salas e profissionais ---------- */
function resourcesHtml() {
  const list = S.cfg.resources;
  const ed = S.edit.res;
  const memberName = (id) => S.team?.members?.find((m) => m.user_id === id)?.email || '';
  return `<section class="ac-sec" aria-labelledby="acResT"><h3 class="ac-h" id="acResT">Aparelhos, salas e profissionais</h3>
    <p class="cl-help">Tudo o que um exame precisa para acontecer. Um aparelho só atende um paciente por vez, a não ser que você diga outro número.</p>
    ${list.length ? `<ul class="ac-list" id="resList">${list.map((r) => `<li id="res-${esc(r.id)}">
        <span><b>${esc(r.name)}</b> <span class="bd">${esc(A.KIND_LABEL[r.kind] || r.kind)}</span>${r.active ? '' : ' <span class="bd bd-warn">desativado</span>'}
        <small>${esc([r.capacity > 1 ? `${r.capacity} pacientes ao mesmo tempo` : '1 paciente por vez', r.setup_min ? `preparo ${A.fmtMinutes(r.setup_min)}` : '', r.cleanup_min ? `limpeza ${A.fmtMinutes(r.cleanup_min)}` : '', r.member_user_id && memberName(r.member_user_id) ? `ligado a ${memberName(r.member_user_id)}` : ''].filter(Boolean).join(' · '))}</small></span>
        <button class="btn btn-ghost btn-sm" type="button" data-redit="${esc(r.id)}">Editar<span class="sr"> ${esc(r.name)}</span></button></li>`).join('')}</ul>`
    : '<p class="cl-help">Nenhum cadastrado ainda.</p>'}
    ${ed ? resFormHtml(ed === 'new' ? null : list.find((r) => r.id === ed)) : '<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="resNew"><i class="fa-solid fa-plus" aria-hidden="true"></i> Cadastrar aparelho, sala ou profissional</button></div>'}
    <div id="resMsg" aria-live="polite"></div></section>`;
}

function resFormHtml(r) {
  const isNew = !r;
  const v = r || { kind: 'equipamento', name: '', capacity: 1, setup_min: 0, cleanup_min: 0, active: true };
  const members = S.team?.members || [];
  return `<form id="resForm" class="ac-form" novalidate aria-labelledby="resFormT">
    <h4 id="resFormT">${isNew ? 'Novo cadastro' : `Editar: ${esc(r.name)}`}</h4>
    <div class="cl-grid">
      ${isNew ? `<div class="cl-field"><label class="cl-lbl" for="rKind">Tipo</label><select id="rKind" aria-describedby="rKindErr">${opts(A.KINDS.map((k) => [k, A.KIND_LABEL[k]]), v.kind)}</select><span class="cl-err" id="rKindErr"></span></div>` : ''}
      <div class="cl-field"><label class="cl-lbl" for="rName">Nome</label><input type="text" id="rName" maxlength="80" value="${esc(v.name)}" autocomplete="off" aria-describedby="rNameErr"><span class="cl-err" id="rNameErr"></span></div>
      <div class="cl-field"><label class="cl-lbl" for="rCap">Pacientes ao mesmo tempo</label><input type="number" inputmode="numeric" min="1" max="50" id="rCap" value="${esc(v.capacity)}" aria-describedby="rCapErr"><span class="cl-err" id="rCapErr"></span></div>
      <div class="cl-field"><label class="cl-lbl" for="rSetup">Preparo antes (min)</label><input type="number" inputmode="numeric" min="0" max="240" step="5" id="rSetup" value="${esc(v.setup_min)}" aria-describedby="rSetupErr"><span class="cl-err" id="rSetupErr"></span></div>
      <div class="cl-field"><label class="cl-lbl" for="rClean">Limpeza depois (min)</label><input type="number" inputmode="numeric" min="0" max="240" step="5" id="rClean" value="${esc(v.cleanup_min)}" aria-describedby="rCleanErr"><span class="cl-err" id="rCleanErr"></span></div>
      <div class="ac-prof full"${v.kind === 'profissional' ? '' : ' hidden'} id="rProfBox">
        <div class="cl-grid">
          ${members.length ? `<div class="cl-field"><label class="cl-lbl" for="rMember">Pessoa da equipe <small>(opcional)</small></label><select id="rMember" aria-describedby="rMemberHint"><option value="">Ninguém</option>${opts(members.map((m) => [m.user_id, `${m.email} (${A.ROLE_LABEL[m.role] || m.role})`]), v.member_user_id)}</select><span class="cl-hint" id="rMemberHint">Quem tiver o papel Profissional vê a própria agenda.</span></div>` : ''}
          <div class="cl-field"><label class="cl-lbl" for="rCouncil">Conselho <small>(opcional)</small></label><select id="rCouncil"><option value="">Não informar</option>${opts(A.COUNCILS.map((c) => [c, c === 'outro' ? 'Outro' : c]), v.council)}</select></div>
          <div class="cl-field"><label class="cl-lbl" for="rCouncilN">Número no conselho <small>(opcional)</small></label><input type="text" id="rCouncilN" maxlength="20" value="${esc(v.council_number || '')}" autocomplete="off" aria-describedby="rCouncilNErr"><span class="cl-err" id="rCouncilNErr"></span></div>
        </div>
      </div>
    </div>
    ${isNew ? '' : `<label class="cl-check ac-mt"><input type="checkbox" id="rActive"${v.active ? ' checked' : ''}><span>Ativo (desmarque para tirar da agenda por enquanto)</span></label>`}
    <div class="cl-actions"><button class="btn btn-primary" type="submit" id="rSave">Salvar</button><button class="btn btn-ghost" type="button" id="rCancel">Cancelar</button>
      ${isNew ? '' : '<button class="btn btn-danger btn-sm ac-right" type="button" id="rArchive">Excluir da agenda</button>'}</div>
    <div id="rArchiveBox"></div>
  </form>`;
}

async function saveResource(archive = false) {
  const id = S.edit.res;
  const isNew = id === 'new';
  const cur = isNew ? null : S.cfg.resources.find((r) => r.id === id);
  const v = {
    id, kind: isNew ? $('#rKind').value : cur.kind, name: $('#rName').value, capacity: $('#rCap').value, setup_min: $('#rSetup').value, cleanup_min: $('#rClean').value,
    member_user_id: $('#rMember')?.value || null, council: $('#rCouncil')?.value || null, council_number: $('#rCouncilN')?.value || '',
    active: isNew ? true : $('#rActive').checked,
  };
  const msg = $('#resMsg');
  msg.innerHTML = '';
  let payload;
  if (archive) payload = { id, archived: true };
  else {
    const e = A.resourceErrors(v, { isNew });
    [['rKind', e.kind], ['rName', e.name], ['rCap', e.capacity], ['rSetup', e.setup_min], ['rClean', e.cleanup_min], ['rCouncilN', e.council_number]].forEach(([f, t]) => fieldErr(f, t));
    if (Object.keys(e).length) { $('#resForm [aria-invalid="true"]')?.focus(); return; }
    payload = A.resourcePayload(v, { isNew });
  }
  const btn = archive ? $('#rArchiveYes') : $('#rSave');
  busy(btn, true);
  try {
    const r = await rpc('agenda_resource_save', { p_clinic: S.clinicId, p_resource: payload, p_confirm: false });
    if (r?.status !== 'ok') throw Object.assign(new Error(r?.status), { result: r?.status });
    S.edit.res = null;
    const name = archive ? cur.name : payload.name;
    toast(archive ? 'Excluído da agenda.' : 'Salvo.');
    await reload(archive ? '#resNew' : `[data-redit="${CSS.escape(r.id || id)}"]`, ['#resMsg', archive ? `${name} saiu da agenda.` : `${name} salvo.`]);
  } catch (err) {
    if (S.ctx.lost()) return;
    busy(btn, false);
    if (msg.isConnected) msg.innerHTML = note(esc(err.result ? A.statusText(err.result) : errText(err, 'Não foi possível salvar agora.')), 'err');
  }
}

/* ---------- exames (procedimentos) ---------- */
function proceduresHtml() {
  const list = S.cfg.procedures;
  const ed = S.edit.proc;
  const resName = (id) => S.cfg.resources.find((r) => r.id === id)?.name || '';
  return `<section class="ac-sec" aria-labelledby="acProcT"><h3 class="ac-h" id="acProcT">Exames</h3>
    <p class="cl-help">Cada exame que a clínica marca, com a duração e o que ele usa. O preço aparece para o paciente; em branco, fica “sob consulta”.</p>
    ${list.length ? `<ul class="ac-list" id="procList">${list.map((p) => `<li id="proc-${esc(p.id)}">
        <span><b>${esc(p.name)}</b> <span class="bd">${esc(A.examLabel(p.exam_code))}</span>${p.active ? '' : ' <span class="bd bd-warn">desativado</span>'}
        <small>${esc([A.fmtMinutes(p.duration_min), A.centsText(p.price_cents), (p.requirements || []).map((g) => g.options.map((o) => resName(o.resource_id)).filter(Boolean).join(' ou ')).filter(Boolean).join(' + ') || 'sem aparelho, sala ou profissional: não gera horário'].join(' · '))}</small></span>
        <button class="btn btn-ghost btn-sm" type="button" data-pedit="${esc(p.id)}">Editar<span class="sr"> ${esc(p.name)}</span></button></li>`).join('')}</ul>`
    : '<p class="cl-help">Nenhum exame cadastrado ainda.</p>'}
    ${ed ? procFormHtml(ed === 'new' ? null : list.find((p) => p.id === ed)) : `<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="procNew"${S.cfg.resources.length ? '' : ' disabled aria-describedby="procNewHint"'}><i class="fa-solid fa-plus" aria-hidden="true"></i> Cadastrar exame</button>${S.cfg.resources.length ? '' : '<span class="cl-hint" id="procNewHint">Cadastre antes um aparelho, sala ou profissional.</span>'}</div>`}
    <div id="procMsg" aria-live="polite"></div></section>`;
}

function procGroupsFrom(p) {
  if (p?.requirements?.length) return p.requirements.map((g) => ({ resource_kind: g.resource_kind, options: g.options.map((o) => o.resource_id) }));
  const k = S.cfg.resources.find((r) => r.active)?.kind || 'equipamento';
  return [{ resource_kind: k, options: [] }];
}

function groupHtml(g, i) {
  const res = S.cfg.resources.filter((r) => r.kind === g.resource_kind);
  const kinds = A.KINDS.filter((k) => S.cfg.resources.some((r) => r.kind === k));
  if (!kinds.includes(g.resource_kind)) kinds.push(g.resource_kind);
  return `<fieldset class="ac-grp" data-g="${i}" aria-describedby="pg${i}Err"><legend>${i === 0 ? 'Usa' : 'E também usa'}</legend>
    <div class="cl-field"><label class="cl-lbl" for="pg${i}kind">Tipo</label><select id="pg${i}kind" data-gk="${i}">${opts(kinds.map((k) => [k, A.KIND_LABEL[k]]), g.resource_kind)}</select></div>
    <p class="cl-hint">Marque um ou mais: o exame usa qualquer um dos marcados que estiver livre.</p>
    <div class="ac-opts">${res.length ? res.map((r) => `<label class="cl-check"><input type="checkbox" data-go="${i}" value="${esc(r.id)}"${g.options.includes(r.id) ? ' checked' : ''}><span>${esc(r.name)}${r.active ? '' : ' (desativado)'}</span></label>`).join('') : '<span class="cl-hint">Nenhum cadastrado deste tipo.</span>'}</div>
    ${i > 0 ? `<button class="btn btn-ghost btn-sm" type="button" data-grm="${i}">Tirar este grupo</button>` : ''}
    <span class="cl-err" id="pg${i}Err"></span>
  </fieldset>`;
}

function procFormHtml(p) {
  const isNew = !p;
  const v = p || { exam_code: S.exams[0] || '', name: '', duration_min: '', price_cents: null, patient_prep_text: '', fasting_hours: null, online_booking: true, active: true };
  S.procGroups ||= procGroupsFrom(p);
  S.priceOk = false;
  return `<form id="procForm" class="ac-form" novalidate aria-labelledby="procFormT">
    <h4 id="procFormT">${isNew ? 'Novo exame' : `Editar: ${esc(p.name)}`}</h4>
    <div class="cl-grid">
      <div class="cl-field"><label class="cl-lbl" for="pCode">Tipo de exame</label><select id="pCode" aria-describedby="pCodeErr"><option value="">Escolha</option>${opts(A.EXAM_CODES.map((c) => [c, A.examLabel(c)]), v.exam_code)}</select><span class="cl-err" id="pCodeErr"></span></div>
      <div class="cl-field"><label class="cl-lbl" for="pName">Nome do exame</label><input type="text" id="pName" maxlength="120" value="${esc(v.name)}" autocomplete="off" aria-describedby="pNameHint pNameErr"><span class="cl-hint" id="pNameHint">Como o paciente vai ver, por exemplo o nome que a clínica já usa.</span><span class="cl-err" id="pNameErr"></span></div>
      <div class="cl-field"><label class="cl-lbl" for="pDur">Duração (minutos)</label><input type="number" inputmode="numeric" min="5" max="480" step="5" id="pDur" value="${esc(v.duration_min ?? '')}" aria-describedby="pDurErr"><span class="cl-err" id="pDurErr"></span></div>
      <div class="cl-field"><label class="cl-lbl" for="pPrice">Preço (R$) <small>(em branco: sob consulta)</small></label><input type="text" inputmode="decimal" id="pPrice" maxlength="14" value="${esc(v.price_cents == null ? '' : (v.price_cents / 100).toFixed(2).replace('.', ','))}" autocomplete="off" aria-describedby="pPriceErr"><span class="cl-err" id="pPriceErr"></span></div>
      <div class="cl-field"><label class="cl-lbl" for="pFast">Jejum (horas) <small>(opcional)</small></label><input type="number" inputmode="numeric" min="0" max="24" id="pFast" value="${esc(v.fasting_hours ?? '')}" aria-describedby="pFastErr"><span class="cl-err" id="pFastErr"></span></div>
      <div class="cl-field full"><label class="cl-lbl" for="pPrep">Preparo para o paciente <small>(opcional)</small></label><textarea id="pPrep" maxlength="600" aria-describedby="pPrepErr">${esc(v.patient_prep_text || '')}</textarea><span class="cl-err" id="pPrepErr"></span></div>
    </div>
    <div id="pGroups">${S.procGroups.map(groupHtml).join('')}</div>
    <span class="cl-err" id="pGroupsErr"></span>
    ${S.procGroups.length < 5 ? '<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="pgAdd"><i class="fa-solid fa-plus" aria-hidden="true"></i> O exame também usa outra coisa</button></div>' : ''}
    <label class="cl-check ac-mt"><input type="checkbox" id="pOnline"${v.online_booking !== false ? ' checked' : ''}><span>Pode ser marcado pelo site quando a marcação online for liberada</span></label>
    ${isNew ? '' : `<label class="cl-check ac-mt"><input type="checkbox" id="pActive"${v.active ? ' checked' : ''}><span>Ativo</span></label>`}
    <div id="pPriceCheck"></div>
    <div class="cl-actions"><button class="btn btn-primary" type="submit" id="pSave">Salvar exame</button><button class="btn btn-ghost" type="button" id="pCancel">Cancelar</button>
      ${isNew ? '' : '<button class="btn btn-danger btn-sm ac-right" type="button" id="pArchive">Excluir exame</button>'}</div>
    <div id="pArchiveBox"></div>
  </form>`;
}

function readGroups() {
  S.procGroups = $$('.ac-grp').map((fs) => {
    const i = fs.dataset.g;
    return { resource_kind: $(`[data-gk="${i}"]`, fs).value, options: $$(`input[data-go="${i}"]:checked`, fs).map((x) => x.value) };
  });
}

async function saveProcedure(archive = false) {
  const id = S.edit.proc;
  const isNew = id === 'new';
  const cur = isNew ? null : S.cfg.procedures.find((p) => p.id === id);
  const msg = $('#procMsg');
  msg.innerHTML = '';
  let payload;
  if (archive) payload = { id, archived: true };
  else {
    readGroups();
    const v = {
      id, exam_code: $('#pCode').value, name: $('#pName').value, duration_min: $('#pDur').value, price: $('#pPrice').value,
      fasting_hours: $('#pFast').value, patient_prep_text: $('#pPrep').value, online_booking: $('#pOnline').checked,
      active: isNew ? true : $('#pActive').checked, groups: S.procGroups,
    };
    const e = A.procedureErrors(v, S.cfg.resources);
    [['pCode', e.exam_code], ['pName', e.name], ['pDur', e.duration_min], ['pPrice', e.price], ['pFast', e.fasting_hours], ['pPrep', e.patient_prep_text]].forEach(([f, t]) => fieldErr(f, t));
    $('#pGroupsErr').textContent = e.groups || '';
    S.procGroups.forEach((_, i) => { $(`#pg${i}Err`).textContent = e[`g${i}`] || ''; });
    if (Object.keys(e).length) { ($('#procForm [aria-invalid="true"]') || $('.ac-grp input, .ac-grp select'))?.focus(); return; }
    const cents = A.priceCents(v.price);
    // L11: preço acima do normal precisa ser conferido antes de ir para o paciente.
    if (A.priceNeedsCheck(v.exam_code, cents) && !S.priceOk && cents !== cur?.price_cents) {
      $('#pPriceCheck').innerHTML = `${note(`Confira o valor: <b>${esc(A.centsText(cents))}</b> para ${esc(A.examLabel(v.exam_code))} está certo?`, 'warn')}
        <div class="cl-actions"><button class="btn btn-primary btn-sm" type="button" id="pPriceYes">Sim, está certo</button><button class="btn btn-ghost btn-sm" type="button" id="pPriceNo">Corrigir</button></div>`;
      $('#pPriceYes').focus();
      return;
    }
    payload = A.procedurePayload(v, { isNew, priceConfirmed: S.priceOk });
  }
  const btn = archive ? $('#pArchiveYes') : $('#pSave');
  busy(btn, true);
  try {
    const r = await rpc('agenda_procedure_save', { p_clinic: S.clinicId, p_proc: payload, p_confirm: false });
    if (r?.status !== 'ok') throw Object.assign(new Error(r?.status), { result: r?.status });
    S.edit.proc = null; S.procGroups = null;
    const name = archive ? cur.name : payload.name;
    toast(archive ? 'Exame excluído.' : 'Exame salvo.');
    await reload(archive ? '#procNew' : `[data-pedit="${CSS.escape(r.id || id)}"]`, ['#procMsg', archive ? `${name} saiu da agenda.` : `${name} salvo.`]);
  } catch (err) {
    if (S.ctx.lost()) return;
    busy(btn, false);
    if (msg.isConnected) msg.innerHTML = note(esc(err.result ? A.statusText(err.result) : errText(err, 'Não foi possível salvar o exame agora.')), 'err');
  }
}

/* ---------- conferir horários livres ---------- */
function previewHtml() {
  const list = S.cfg.procedures.filter((p) => p.active);
  return `<section class="ac-sec" aria-labelledby="acPvT"><h3 class="ac-h" id="acPvT">Conferir horários livres</h3>
    <p class="cl-help">Os horários livres dos próximos 7 dias, calculados com tudo o que está salvo (horários, pausas, feriados, bloqueios e agendamentos). Só a clínica vê esta conferência.</p>
    ${list.length ? `<div class="cl-filter"><label class="cl-lbl" for="pvProc" style="margin:0">Exame</label><select id="pvProc">${opts(list.map((p) => [p.id, p.name]), S.pvProc || list[0].id)}</select>
      <button class="btn btn-ghost btn-sm" type="button" id="pvGo"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Ver horários</button></div>
      <div id="pvBox" aria-live="polite"></div>` : '<p class="cl-help">Cadastre um exame para conferir.</p>'}</section>`;
}

async function loadPreview() {
  const box = $('#pvBox');
  const proc = $('#pvProc')?.value;
  if (!box || !proc) return;
  S.pvProc = proc;
  const tz = S.cfg.unit.timezone;
  const from = dayIn(tz);
  box.innerHTML = loading('Buscando horários livres…');
  try {
    const rows = (await rpc('agenda_slots', { p_clinic: S.clinicId, p_procedure: proc, p_from: from, p_to: addDays(from, 6) })) || [];
    if (!box.isConnected) return;
    const list = (Array.isArray(rows) ? rows : []).map((r) => r?.slot_start).filter((x) => x && !Number.isNaN(Date.parse(x)));
    if (!list.length) { box.innerHTML = '<p class="cl-help">Nenhum horário livre nos próximos 7 dias. Confira os horários de atendimento, o que o exame usa e os bloqueios.</p>'; return; }
    const groups = [];
    for (const t of list.slice(0, 60)) {
      const d = dayIn(tz, Date.parse(t));
      if (groups.at(-1)?.[0] !== d) groups.push([d, []]);
      groups.at(-1)[1].push(t);
    }
    box.innerHTML = `<p class="cl-help">${list.length > 60 ? `Mostrando os 60 primeiros de ${list.length} horários livres.` : `${list.length} ${list.length === 1 ? 'horário livre' : 'horários livres'}.`}</p>
      <div class="ag-pv">${groups.map(([d, ts]) => `<div class="ag-pv-day"><h4>${esc(fmtDate(d))}</h4><ul class="ag-slots">${ts.map((t) => `<li>${esc(timeIn(tz, t))}</li>`).join('')}</ul></div>`).join('')}</div>`;
  } catch (err) {
    if (S.ctx.lost() || !box.isConnected) return;
    box.innerHTML = note(esc(errText(err, 'Não foi possível buscar os horários livres agora.')), 'err');
  }
}

/* ---------- unidade e modalidade ---------- */
async function saveUnit(force = false) {
  const u = S.cfg.unit;
  const v = { step_min: $('#uStep').value, min_notice_h: $('#uNotice').value, max_advance_days: $('#uAdvance').value, holidays_checked_until: $('#uHol').value, closes_on_holidays: $('#uClosesHol').checked };
  const e = A.unitErrors(v);
  [['uStep', e.step_min], ['uNotice', e.min_notice_h], ['uAdvance', e.max_advance_days], ['uHol', e.holidays_checked_until]].forEach(([f, t]) => fieldErr(f, t));
  const msg = $('#uMsg');
  msg.innerHTML = '';
  if (Object.keys(e).length) { $('#unitForm [aria-invalid="true"]')?.focus(); return; }
  const payload = A.unitPayload(v);
  if (!u.timezone_confirmed_at && $('#uTzOk')?.checked) { payload.timezone = $('#uTz').value; payload.confirm_timezone = true; }
  else if (!u.timezone_confirmed_at && $('#uTz') && $('#uTz').value !== u.timezone) payload.timezone = $('#uTz').value;
  const btn = $('#uSave');
  busy(btn, true, 'Salvando…');
  try {
    const r = await rpc('agenda_unit_save', { p_clinic: S.clinicId, p_settings: payload, p_confirm: force });
    if (r?.status === 'affects_appointments') { askForce(msg, r.items, 'unit'); return; }
    if (r?.status !== 'ok') throw Object.assign(new Error(r?.status), { result: r?.status });
    toast('Unidade salva.');
    await reload('#uSave', ['#uMsg', 'Unidade salva.']);
  } catch (err) {
    if (S.ctx.lost()) return;
    msg.innerHTML = note(esc(err.result ? A.statusText(err.result) : errText(err, 'Não foi possível salvar agora.')), 'err');
  } finally { busy(btn, false, 'Salvar unidade'); }
}

async function saveMode() {
  const mode = $('input[name="acMode"]:checked')?.value;
  const commit = $('#acCommit').checked;
  const msg = $('#modeMsg');
  msg.innerHTML = '';
  $('#acCommitErr').textContent = '';
  if (!mode) return;
  if (mode === 'manual' && !commit) { fieldErr('acCommit', A.STATUS_TEXT.commitment_required); $('#acCommit').focus(); return; }
  fieldErr('acCommit', '');
  const btn = $('#modeSave');
  busy(btn, true, 'Salvando…');
  try {
    const r = await rpc('agenda_mode_set', { p_clinic: S.clinicId, p_mode: mode, p_commitment: mode === 'manual' && commit });
    if (r?.status !== 'ok') throw Object.assign(new Error(r?.status), { result: r?.status });
    toast('Modalidade salva.');
    await reload('#modeSave', ['#modeMsg', `Modalidade salva: ${A.MODE_LABEL[mode]}.`]);
  } catch (err) {
    if (S.ctx.lost()) return;
    msg.innerHTML = note(esc(err.result ? A.statusText(err.result) : errText(err, 'Não foi possível salvar a modalidade agora.')), 'err');
    busy(btn, false, 'Salvar modalidade');
  }
}

/* ---------- avisos e lembretes (5.3) ---------- */
// As escolhas da clínica. Nada aqui promete envio: enquanto o IMED não liga o envio, a tela diz que nada é enviado.
function notifyHtml() {
  const n = S.notify;
  if (!n || !n.rules.length) return '';
  const grupo = (kind, titulo) => {
    const itens = n.rules.filter((r) => r.recipient_kind === kind);
    if (!itens.length) return '';
    return `<fieldset class="ac-fs ac-nt-g"><legend>${esc(titulo)}</legend>
      ${itens.map((r) => { const id = `nt-${r.event_type}-${r.recipient_kind}`; return `<label class="cl-check ac-nt"><input type="checkbox" id="${id}" data-nt="${esc(r.event_type)}|${esc(r.recipient_kind)}"${r.enabled ? ' checked' : ''} aria-describedby="${id}h"><span>${esc(r.label)}<small id="${id}h">${esc(r.help)}</small></span></label>`; }).join('')}
    </fieldset>`;
  };
  return `<section class="ac-sec" aria-labelledby="acNtT"><h3 class="ac-h" id="acNtT">Avisos e lembretes</h3>
    ${n.sending ? '<p class="cl-help">O envio por e-mail está ligado. Escolha abaixo o que a clínica quer.</p>'
    : note('O envio de avisos ainda não está ligado pelo IMED: hoje nenhum aviso é enviado. Você já pode deixar as escolhas prontas; elas passam a valer quando o envio for ligado.', 'info')}
    <form id="ntForm" novalidate aria-labelledby="acNtT">
      ${grupo('paciente', 'Para o paciente (por e-mail)')}
      ${grupo('clinica', 'Para a clínica (por e-mail)')}
      ${n.clinicEmail ? '' : note('A clínica não tem e-mail no cadastro. Sem ele, os avisos para a clínica não têm para onde ir: informe o e-mail em “Dados da clínica”.', 'warn')}
      <p class="cl-help">Com o envio ligado, o paciente que informou e-mail sempre recebe: ${esc(A.NOTIFY_ALWAYS)}. Esses não se desligam. O aviso não leva o nome do exame nem o preparo.</p>
      <div class="cl-actions"><button class="btn btn-primary" type="submit" id="ntSave">Salvar avisos</button></div>
      <div id="ntMsg" aria-live="polite"></div>
    </form></section>`;
}

async function saveNotify() {
  const cid = S.clinicId;
  const msg = $('#ntMsg');
  msg.innerHTML = '';
  const rules = A.notifyRulesPayload($$('[data-nt]', S.box).map((el) => { const [event_type, recipient_kind] = el.dataset.nt.split('|'); return { event_type, recipient_kind, enabled: el.checked }; }));
  if (!rules.length) return;
  const btn = $('#ntSave');
  busy(btn, true, 'Salvando…');
  try {
    const r = await rpc('agenda_notify_config_set', { p_clinic: cid, p_rules: rules });
    if (r?.status !== 'ok') throw Object.assign(new Error(r?.status), { result: r?.status });
    const novo = A.normalizeNotifyConfig(await rpc('agenda_notify_config', { p_clinic: cid }).catch(() => null));
    if (S?.clinicId !== cid) return;
    if (novo) S.notify = novo; else S.notify.rules = S.notify.rules.map((x) => ({ ...x, enabled: rules.find((y) => y.event_type === x.event_type && y.recipient_kind === x.recipient_kind)?.enabled ?? x.enabled }));
    const sec = $('#acNtT')?.closest('.ac-sec');
    if (sec) sec.outerHTML = notifyHtml();
    toast('Avisos salvos.');
    const m = $('#ntMsg'); if (m) m.innerHTML = note(r.changed ? 'Avisos salvos.' : 'Nada mudou: as escolhas já estavam assim.', 'ok');
    $('#ntSave')?.focus();
  } catch (err) {
    if (S.ctx.lost()) return;
    msg.innerHTML = note(esc(err.result ? A.statusText(err.result) : errText(err, 'Não foi possível salvar os avisos agora.')), 'err');
    busy(btn, false, 'Salvar avisos');
  }
}

/* ---------- eventos ---------- */
function onSubmit(e) {
  e.preventDefault();
  const id = e.target.id;
  if (id === 'qcForm') saveQuick();
  else if (id === 'unitForm') saveUnit();
  else if (id === 'modeForm') saveMode();
  else if (id === 'ntForm') saveNotify();
  else if (id === 'hrForm') saveHours();
  else if (id === 'resForm') saveResource();
  else if (id === 'procForm') saveProcedure();
}

function onInput(e) {
  const t = e.target;
  if (t.dataset?.h) readWeekField(t);
}

function onChange(e) {
  const t = e.target;
  if (t.name === 'acMode') { $('#acCommitBox').hidden = t.value !== 'manual'; return; }
  if (t.id === 'rKind') { $('#rProfBox').hidden = t.value !== 'profissional'; return; }
  if (t.dataset?.gk !== undefined) { readGroups(); S.procGroups[Number(t.dataset.gk)].options = []; redrawGroups(`#pg${t.dataset.gk}kind`); return; }
  if (t.dataset?.h) readWeekField(t);
  if (t.id === 'pPrice') S.priceOk = false;
  if (t.dataset?.q === 'exam_code') {
    // nome sugerido = o nome do tipo, só se o campo estiver vazio
    const name = $(`#qx${t.closest('.ac-qrow').dataset.i}name`);
    if (name && !name.value.trim() && t.value) name.value = A.examLabel(t.value);
  }
}

function redrawGroups(focusSel) {
  $('#pGroups').innerHTML = S.procGroups.map(groupHtml).join('');
  const add = $('#pgAdd');
  if (add) add.closest('.cl-actions').hidden = S.procGroups.length >= 5;
  if (focusSel) $(focusSel)?.focus();
}

function onClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  // configuração rápida
  if (b.id === 'qcAdd') { readQuick(); S.qc.exams.push({ exam_code: '', name: '', kind: 'equipamento', count: '', duration: '' }); $('#qcExams').innerHTML = S.qc.exams.map(qcExamHtml).join(''); $(`#qx${S.qc.exams.length - 1}code`).focus(); return; }
  if (d.qrm !== undefined) { readQuick(); S.qc.exams.splice(Number(d.qrm), 1); $('#qcExams').innerHTML = S.qc.exams.map(qcExamHtml).join(''); $('#qcAdd').focus(); return; }
  // horários
  if (d.hadd) {
    const [day, k] = d.hadd.split('-');
    const list = S.week[day][k];
    list.push(k === 'open' ? { start: '', end: '' } : { start: '', end: '', label: '' });
    S.weekDirty = true;
    $(`#hrday-${day}`).outerHTML = dayHtml(Number(day));
    $('#hrDirty').textContent = 'Há mudanças ainda não salvas.';
    $(`#hr-${day}-${k}-${list.length - 1}s`)?.focus();
    return;
  }
  if (d.hrm) {
    const [day, k, i] = d.hrm.split('-');
    S.week[day][k].splice(Number(i), 1);
    if (!S.week[day].open.length) S.week[day].pause = [];
    S.weekDirty = true;
    $(`#hrday-${day}`).outerHTML = dayHtml(Number(day));
    $('#hrDirty').textContent = 'Há mudanças ainda não salvas.';
    $(`#hrday-${day} [data-hadd]`)?.focus();
    return;
  }
  if (b.id === 'hrCopy') {
    const m = $('#hrCopyMsg');
    m.className = 'cl-msg';
    if (!S.week[1].open.length) { m.textContent = 'Segunda ainda não tem horário. Coloque o horário da segunda primeiro.'; m.classList.add('err'); return; }
    S.week = A.copyMonday(S.week);
    S.weekDirty = true;
    $('#hrWeek').innerHTML = A.WEEK_ORDER.map(dayHtml).join('');
    $('#hrDirty').textContent = 'Há mudanças ainda não salvas.';
    m.textContent = 'Pronto: terça a sexta agora têm o mesmo horário de segunda. Falta salvar.';
    m.classList.add('ok');
    return;
  }
  if (d.force) { ({ hr: () => saveHours(true), unit: () => saveUnit(true) })[d.force]?.(); return; }
  if (d.unforce) { const m = b.closest('[aria-live]'); if (m) m.innerHTML = note('Nada foi salvo.', 'info'); return; }
  // recursos
  if (b.id === 'resNew' || d.redit) { S.edit.res = b.id === 'resNew' ? 'new' : d.redit; redrawSection('res'); ($('#rKind') || $('#rName')).focus(); return; }
  if (b.id === 'rCancel') { const id = S.edit.res; S.edit.res = null; redrawSection('res'); ($(`[data-redit="${CSS.escape(id)}"]`) || $('#resNew'))?.focus(); return; }
  if (b.id === 'rArchive') {
    $('#rArchiveBox').innerHTML = `${note('Excluir tira da agenda para sempre (os agendamentos que já passaram ficam no histórico). Para parar só por um tempo, desmarque “Ativo”.', 'warn')}
      <div class="cl-actions"><button class="btn btn-danger btn-sm" type="button" id="rArchiveYes">Sim, excluir</button><button class="btn btn-ghost btn-sm" type="button" id="rArchiveNo">Não excluir</button></div>`;
    $('#rArchiveYes').focus();
    return;
  }
  if (b.id === 'rArchiveYes') { saveResource(true); return; }
  if (b.id === 'rArchiveNo') { $('#rArchiveBox').innerHTML = ''; $('#rArchive').focus(); return; }
  // exames
  if (b.id === 'procNew' || d.pedit) { S.edit.proc = b.id === 'procNew' ? 'new' : d.pedit; S.procGroups = null; redrawSection('proc'); $('#pCode').focus(); return; }
  if (b.id === 'pCancel') { const id = S.edit.proc; S.edit.proc = null; S.procGroups = null; redrawSection('proc'); ($(`[data-pedit="${CSS.escape(id)}"]`) || $('#procNew'))?.focus(); return; }
  if (b.id === 'pgAdd') { readGroups(); const k = A.KINDS.find((x) => x !== S.procGroups[0]?.resource_kind && S.cfg.resources.some((r) => r.kind === x)) || 'sala'; S.procGroups.push({ resource_kind: k, options: [] }); redrawGroups(`#pg${S.procGroups.length - 1}kind`); return; }
  if (d.grm) { readGroups(); S.procGroups.splice(Number(d.grm), 1); redrawGroups('#pgAdd'); return; }
  if (b.id === 'pPriceYes') { S.priceOk = true; $('#pPriceCheck').innerHTML = ''; saveProcedure(); return; }
  if (b.id === 'pPriceNo') { $('#pPriceCheck').innerHTML = ''; $('#pPrice').focus(); return; }
  if (b.id === 'pArchive') {
    $('#pArchiveBox').innerHTML = `${note('Excluir tira o exame da agenda para sempre. Para parar só por um tempo, desmarque “Ativo”.', 'warn')}
      <div class="cl-actions"><button class="btn btn-danger btn-sm" type="button" id="pArchiveYes">Sim, excluir</button><button class="btn btn-ghost btn-sm" type="button" id="pArchiveNo">Não excluir</button></div>`;
    $('#pArchiveYes').focus();
    return;
  }
  if (b.id === 'pArchiveYes') { saveProcedure(true); return; }
  if (b.id === 'pArchiveNo') { $('#pArchiveBox').innerHTML = ''; $('#pArchive').focus(); return; }
  if (b.id === 'pvGo') loadPreview();
}

function redrawSection(which) {
  const sel = which === 'res' ? '#acResT' : '#acProcT';
  const sec = $(sel)?.closest('.ac-sec');
  if (!sec) return;
  sec.outerHTML = which === 'res' ? resourcesHtml() : proceduresHtml();
}

/* =====================================================================================================================
   EQUIPE: membros, papéis e convites
   ===================================================================================================================== */
let T = null;

export async function renderTeam(p, ctx) {
  const cid = ctx.clinic.id;
  T = { clinicId: cid, ctx, p, data: null, confirm: null };
  p.innerHTML = loading('Carregando a equipe…');
  try {
    const r = await rpc('agenda_team', { p_clinic: cid });
    if (T?.clinicId !== cid || !p.isConnected) return;
    if (r?.status !== 'ok') { p.innerHTML = note(esc(A.statusText(r?.status, 'Não foi possível carregar a equipe.')), 'err'); return; }
    T.data = r;
  } catch (err) {
    if (ctx.lost() || !p.isConnected) return;
    p.innerHTML = `${note(esc(errText(err, 'Não foi possível carregar a equipe agora.')), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="tmRetry">Tentar de novo</button></div>`;
    $('#tmRetry').onclick = () => renderTeam(p, ctx);
    return;
  }
  drawTeam();
}

function drawTeam(focusSel, msg) {
  const { p, data, ctx } = T;
  const give = A.rolesICanGive(ctx.perms, ctx.admin);
  const roleOpts = (sel) => opts(give.map((r) => [r, A.ROLE_LABEL[r]]), sel);
  const owners = data.members.filter((m) => m.role === 'owner').length;
  p.innerHTML = `<h3 class="ac-h" id="tmTitle">Equipe da clínica</h3>
    <p class="cl-help">Quem pode entrar nesta área e o que cada pessoa pode fazer.</p>
    <div id="tmMsg" aria-live="polite"></div>
    <ul class="ac-list" id="tmMembers">${data.members.map((m) => {
      const mine = A.canManageMember(ctx.perms, ctx.admin, m.role);
      const lastOwner = m.role === 'owner' && owners <= 1;
      const key = esc(m.user_id);
      return `<li id="tm-${key}"><span><b>${esc(m.email)}</b>${m.me ? ' <span class="bd bd-info">você</span>' : ''} <span class="bd">${esc(A.ROLE_LABEL[m.role] || m.role)}</span>
          <small>${esc(A.ROLE_HELP[m.role === 'staff' ? 'reception' : m.role] || '')}</small></span>
        ${mine ? `<span class="ac-mrow"><label class="sr" for="tmRole-${key}">Papel de ${esc(m.email)}</label><select id="tmRole-${key}" data-role-of="${key}"${lastOwner ? ' disabled aria-describedby="tmLast"' : ''}>${roleOpts(m.role === 'staff' ? 'reception' : m.role)}</select>
          <button class="btn btn-ghost btn-sm" type="button" data-role-save="${key}"${lastOwner ? ' disabled' : ''}>Mudar papel<span class="sr"> de ${esc(m.email)}</span></button>
          <button class="btn btn-danger btn-sm" type="button" data-mrm="${key}"${lastOwner ? ' disabled' : ''}>${m.me ? 'Sair da equipe' : `Tirar da equipe<span class="sr"> ${esc(m.email)}</span>`}</button></span>` : ''}
        ${T.confirm === m.user_id ? `<div class="ac-full" id="tmConfirm">${note(`${m.me ? 'Você vai perder o acesso a esta clínica.' : `${esc(m.email)} vai perder o acesso a esta clínica na próxima ação.`} Confirma?`, 'warn')}
          <div class="cl-actions"><button class="btn btn-danger btn-sm" type="button" data-mrm-yes="${key}">Sim, tirar</button><button class="btn btn-ghost btn-sm" type="button" data-mrm-no="${key}">Não</button></div></div>` : ''}
      </li>`;
    }).join('')}</ul>
    ${owners <= 1 ? '<p class="cl-hint" id="tmLast">A clínica precisa de pelo menos um(a) dono(a): para mudar o único dono, faça antes outra pessoa dona.</p>' : ''}

    <h3 class="ac-h" id="invTitle">Convites abertos</h3>
    ${data.invites.length ? `<ul class="ac-list" id="tmInvites">${data.invites.map((i) => `<li id="inv-${esc(i.id)}"><span><b>${esc(i.email)}</b> <span class="bd">${esc(A.ROLE_LABEL[i.role] || i.role)}</span><small>Vale até ${esc(fmtDateTime(i.expires_at))}</small></span>
        ${give.includes(i.role) ? `<button class="btn btn-ghost btn-sm" type="button" data-inv-cancel="${esc(i.id)}">Cancelar convite<span class="sr"> de ${esc(i.email)}</span></button>` : ''}</li>`).join('')}</ul>` : '<p class="cl-help">Nenhum convite aberto.</p>'}

    ${give.length ? `<form id="invForm" class="ac-form" novalidate aria-labelledby="invNewT"><h4 id="invNewT">Convidar alguém</h4>
      <div class="cl-grid">
        <div class="cl-field"><label class="cl-lbl" for="invEmail">E-mail da pessoa</label><input type="email" id="invEmail" maxlength="254" autocomplete="off" inputmode="email" aria-describedby="invEmailErr"><span class="cl-err" id="invEmailErr"></span></div>
        <div class="cl-field"><label class="cl-lbl" for="invRole">Papel</label><select id="invRole" aria-describedby="invRoleHint invRoleErr"><option value="">Escolha</option>${roleOpts('')}</select>
          <span class="cl-hint" id="invRoleHint">O que cada papel pode fazer está na lista abaixo.</span><span class="cl-err" id="invRoleErr"></span></div>
      </div>
      <div class="cl-actions"><button class="btn btn-coral" type="submit" id="invSave">Criar convite</button></div>
      <div id="invMsg" aria-live="polite"></div>
    </form>` : ''}
    <h3 class="ac-h" id="rolesTitle">O que cada papel pode fazer</h3>
    <dl class="ac-roles">${A.ROLES.map((r) => `<div><dt>${esc(A.ROLE_LABEL[r])}</dt><dd>${esc(A.ROLE_HELP[r])}</dd></div>`).join('')}</dl>`;
  p.onclick = onTeamClick;
  p.onsubmit = onTeamSubmit;
  p.onchange = null; p.oninput = null;
  if (msg) $('#tmMsg').innerHTML = note(esc(msg[0]), msg[1] || 'ok');
  if (focusSel) $(focusSel)?.focus();
}

async function reloadTeam(focusSel, msg) {
  try {
    const r = await rpc('agenda_team', { p_clinic: T.clinicId });
    if (r?.status === 'ok') T.data = r;
  } catch { /* fica a lista de antes */ }
  if (T.p.isConnected) drawTeam(focusSel, msg);
}

async function onTeamSubmit(e) {
  e.preventDefault();
  if (e.target.id !== 'invForm') return;
  const email = $('#invEmail').value.trim().toLowerCase();
  const role = $('#invRole').value;
  const er = A.inviteErrors(email, role, A.rolesICanGive(T.ctx.perms, T.ctx.admin));
  fieldErr('invEmail', er.email); fieldErr('invRole', er.role);
  if (er.email || er.role) { $('#invForm [aria-invalid="true"]').focus(); return; }
  const btn = $('#invSave');
  busy(btn, true, 'Criando…');
  try {
    const r = await rpc('agenda_invite', { p_clinic: T.clinicId, p_email: email, p_role: role });
    if (r?.status !== 'ok') throw Object.assign(new Error(r?.status), { result: r?.status });
    toast('Convite criado.');
    await reloadTeam('#invEmail', [`Convite criado para ${email} (${A.ROLE_LABEL[role]}), vale por 7 dias. Avise a pessoa: ela entra nesta Área da clínica com este e-mail, pelo link que chega no e-mail, e aceita o convite. O IMED ainda não manda o convite por e-mail.`]);
  } catch (err) {
    if (T.ctx.lost()) return;
    const m = $('#invMsg');
    if (m) m.innerHTML = note(esc(err.result ? A.statusText(err.result) : errText(err, 'Não foi possível criar o convite agora.')), 'err');
    busy(btn, false, 'Criar convite');
  }
}

async function onTeamClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  const member = (id) => T.data.members.find((m) => m.user_id === id);
  const fail = (err) => {
    if (T.ctx.lost()) return;
    const m = $('#tmMsg');
    if (m) m.innerHTML = note(esc(err.result ? A.statusText(err.result) : errText(err, 'Não foi possível concluir agora.')), 'err');
  };
  if (d.roleSave) {
    const m = member(d.roleSave);
    const role = $(`[data-role-of="${CSS.escape(d.roleSave)}"]`).value;
    busy(b, true);
    try {
      const r = await rpc('agenda_member_role', { p_clinic: T.clinicId, p_user: m.user_id, p_role: role });
      if (r?.status !== 'ok') throw Object.assign(new Error(r?.status), { result: r?.status });
      toast('Papel mudado.');
      if (m.me) { T.ctx.reloadAll?.(); return; }
      await reloadTeam(`[data-role-save="${CSS.escape(m.user_id)}"]`, [r.unchanged ? `${m.email} já era ${A.ROLE_LABEL[role]}.` : `${m.email} agora é ${A.ROLE_LABEL[role]}.`]);
    } catch (err) { busy(b, false); fail(err); }
    return;
  }
  if (d.mrm) { T.confirm = d.mrm; drawTeam(`[data-mrm-yes="${CSS.escape(d.mrm)}"]`); return; }
  if (d.mrmNo) { T.confirm = null; drawTeam(`[data-mrm="${CSS.escape(d.mrmNo)}"]`); return; }
  if (d.mrmYes) {
    const m = member(d.mrmYes);
    busy(b, true);
    try {
      const r = await rpc('agenda_member_remove', { p_clinic: T.clinicId, p_user: m.user_id });
      if (r?.status !== 'ok') throw Object.assign(new Error(r?.status), { result: r?.status });
      T.confirm = null;
      toast(m.me ? 'Você saiu da equipe.' : 'Pessoa tirada da equipe.');
      if (m.me) { T.ctx.reloadAll?.(); return; }
      await reloadTeam('#tmTitle', [`${m.email} não faz mais parte da equipe.`]);
    } catch (err) { busy(b, false); fail(err); }
    return;
  }
  if (d.invCancel) {
    const inv = T.data.invites.find((i) => i.id === d.invCancel);
    busy(b, true);
    try {
      const r = await rpc('agenda_invite_cancel', { p_id: d.invCancel });
      if (r?.status !== 'ok' && r?.status !== 'not_open') throw Object.assign(new Error(r?.status), { result: r?.status });
      toast('Convite cancelado.');
      await reloadTeam('#invTitle', [`Convite de ${inv?.email || ''} cancelado.`]);
    } catch (err) { busy(b, false); fail(err); }
  }
}

/* =====================================================================================================================
   MEUS CONVITES (quem foi convidado aceita aqui)
   ===================================================================================================================== */
export async function loadMyInvites() {
  try {
    const r = await rpc('agenda_my_invites', {});
    return r?.status === 'ok' && Array.isArray(r.invites) ? r.invites : [];
  } catch { return []; }
}

export function myInvitesHtml(list) {
  if (!list.length) return '';
  return `<section class="cl-card" aria-labelledby="myInvT" id="myInvites"><h2 id="myInvT">Convites para você</h2>
    <ul class="ac-list">${list.map((i) => `<li id="myinv-${esc(i.id)}"><span><b>${esc(i.clinic_name)}</b> convidou você como <b>${esc(A.ROLE_LABEL[i.role] || i.role)}</b>
      <small>${esc(A.ROLE_HELP[i.role] || '')} Vale até ${esc(fmtDateTime(i.expires_at))}.</small></span>
      <button class="btn btn-coral btn-sm" type="button" data-accept="${esc(i.id)}">Aceitar<span class="sr"> o convite de ${esc(i.clinic_name)}</span></button></li>`).join('')}</ul>
    <div id="myInvMsg" aria-live="polite"></div></section>`;
}

export async function acceptInvite(btn) {
  busy(btn, true);
  const box = $('#myInvMsg');
  try {
    const r = await rpc('agenda_invite_accept', { p_id: btn.dataset.accept });
    if (r?.status !== 'ok' && r?.status !== 'already_member') throw Object.assign(new Error(r?.status), { result: r?.status });
    toast('Convite aceito.');
    return true;
  } catch (err) {
    busy(btn, false);
    if (box) box.innerHTML = note(esc(err.result ? A.statusText(err.result) : errText(err, 'Não foi possível aceitar agora.')), 'err');
    return false;
  }
}
