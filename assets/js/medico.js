// Área do médico (Plataforma de atendimento do IMED): topo com menu (Painel, Fila, Consultas, Documentos, Meu
// cadastro e "Site do IMED"), painel "Agora na plataforma" (contagens do banco, sem dado de paciente, para o médico
// aprovado), entrar pelo link do e-mail, cadastro (identidade e CRM conferidos pela equipe do
// IMED), aviso regulatório, "Disponível para atender" (renovado a cada minuto), fila, vídeo (o médico faz a oferta),
// plano B (telefone e mensagens), pedido de exames, orientações, prontuário, histórico e, para a equipe do IMED,
// a conferência e a aprovação dos médicos. Documentos (receita simples, atestado, pedido de exames e outros): o IMED
// monta, o médico gera o PDF, assina fora com o certificado ICP-Brasil e envia o PDF assinado (regras em tele-docs.js).
// Dados de pacientes ficam só na memória da página (nada vai para o localStorage).
import * as A from './auth.js';
import { montarSenha } from './entrada-senha.js';
import * as T from './tele-core.js';
import * as D from './tele-docs.js';

T.ensureCompat();
const C = window.IMED_CONFIG || {};
const TELE = C.tele || {};
const ICE = T.iceServersFrom(C);
const PLAN_B_MS = Number(TELE.planBMs) > 0 ? Number(TELE.planBMs) : 25000;
const GATHER_MS = Number(TELE.gatherMs) > 0 ? Number(TELE.gatherMs) : 4000;
const HEARTBEAT_MS = 60000; // tele_set_available vale 90 s
const PANEL_MS = Number(TELE.painelMs) > 0 ? Number(TELE.painelMs) : 20000; // painel "Agora na plataforma"
const SITE = C.siteUrl || new URL('./', location.href).href; // endereço do QR dos documentos
const NOTICE_KEY = 'imed_medico_aviso';
const PAGE_TITLE = document.title; // a fila põe "(N) " na frente quando há paciente esperando
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = T.esc;
const within24 = (t) => !!t && Date.now() - new Date(t).getTime() < 24 * 3600e3;

const S = {
  // meErr: a última leitura do cadastro (tele_doctor_me) falhou; as etapas ficam escondidas até ler de novo.
  me: null, meErr: false, admin: false, duty: false, available: false, hb: 0,
  queue: [], queueSig: '', seenIds: null, c: null, mode: 'live',
  peer: null, local: null, mediaTried: false, version: 0, applied: null, connected: false, offering: false, flow: null,
  planBTimer: 0, dropTimer: 0, flipping: false,
  msgs: [], lastMsg: 0, shownMsg: 0, sending: false,
  exams: [], sent: '[]', sentInd: '', otherN: 0,
  hist: [],
  // documentos: perfil profissional, dados do paciente (do banco: CPF, "não possui CPF", endereço e conferência de
  // identidade), aba atual, itens da receita, listas por consulta e a consulta de cada lista (para o PDF), lista "Falta
  // assinar", envio de PDF em andamento e o arquivo esperando confirmação (aviso de assinatura sem ICP-Brasil).
  d: { profile: null, patient: null, patAt: 0, kind: 'exames', rx: [{}], lists: {}, ctx: {}, upFor: null, prevTimer: 0, unsigned: null, uploading: null, confirm: null },
  // painel "Agora na plataforma": últimos números do banco; missing = o banco ainda não tem a função (ou não deixa o
  // médico usar): o painel some sem erro até recarregar a página; blocked = o banco disse "não aprovado" (espera o
  // cadastro mudar, sem pedir de novo em seguida); err = a última atualização falhou (mostra os números de antes);
  // avail = a disponibilidade da última vez (mudou: pede os números de novo); gen = conta as mudanças de
  // disponibilidade (números pedidos antes de uma mudança não dizem "Contando você.").
  panel: { data: null, missing: false, blocked: false, err: false, avail: false, gen: 0 },
};

/* ======================= avisos ======================= */
let flashTimer = 0;
function flash(text, kind = 'info') {
  const f = $('#flash');
  f.textContent = text;
  f.className = `tl-flash ${kind}`;
  f.hidden = !text;
  clearTimeout(flashTimer);
  if (text) flashTimer = setTimeout(() => { f.hidden = true; }, 15000);
}
let toastTimer = 0;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}
// Bipe curto (a página já teve toque do médico: o navegador deixa tocar) e, se ele permitiu, uma notificação sem
// dados do paciente (a tela do computador ou do celular pode estar à vista de outras pessoas).
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    ctx.resume?.().catch(() => {});
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 660; g.gain.value = 0.07;
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.25);
    o.onended = () => ctx.close().catch(() => {});
  } catch { /* sem som */ }
}
function notify(text) {
  if (!document.hidden) return;
  beep();
  try { if (window.Notification?.permission === 'granted') new Notification('IMED · Teleconsulta', { body: text, tag: 'imed-tele', renotify: true }); } catch { /* sem notificação */ }
}
// A entrada expirou (auth.js apagou a sessão): volta para o quadro de entrada.
function lostSession(err) {
  const { code } = T.errorInfo(err);
  if ((code === 'sem_permissao' || code === 'sem_login') && !A.user()) {
    resetAll();
    renderAuth();
    flash('Sua entrada expirou. Entre de novo abaixo (link por e-mail ou senha).', 'warn');
    return true;
  }
  return false;
}

/* ======================= entrada ======================= */
function renderAuth() {
  const box = $('#authBox');
  const u = A.user();
  if (u) {
    box.innerHTML = `<div class="md-who"><span><i class="fa-solid fa-circle-user" aria-hidden="true"></i>Você entrou como <b>${esc(u.email)}</b></span>
      <button class="btn btn-ghost btn-sm" type="button" id="outBtn">Sair</button></div>`;
    $('#outBtn').addEventListener('click', signOut);
    return;
  }
  box.innerHTML = `<form class="md-login" id="loginForm" novalidate>
      <p>Entre com o seu e-mail e a sua senha; sem senha, peça o link de entrada por e-mail, logo abaixo. Use sempre o mesmo e-mail.</p>
      <div class="fld"><label for="loginEmail">Seu e-mail</label>
        <div class="md-loginrow"><input id="loginEmail" type="email" autocomplete="email" inputmode="email" maxlength="254" required aria-describedby="loginMsg" placeholder="voce@exemplo.com">
        <button class="btn btn-coral" type="submit" id="loginBtn">Receber link</button></div></div>
      <p class="tl-msg" id="loginMsg" aria-live="polite"></p>
    </form>`;
  montarSenha({ form: $('#loginForm'), email: () => $('#loginEmail').value, msg: $('#loginMsg'), depois: () => { renderAuth(); flash('Pronto, você entrou.', 'ok'); loadMe(); } });
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    const msg = $('#loginMsg');
    msg.className = 'tl-msg';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Digite um e-mail válido, como voce@exemplo.com.'; msg.classList.add('err'); $('#loginEmail').focus(); return; }
    const btn = $('#loginBtn');
    btn.disabled = true;
    msg.textContent = 'Enviando…';
    try {
      await A.signIn(email, `${location.origin}${location.pathname}`);
      msg.innerHTML = `Enviamos um link para <b>${esc(email.toLowerCase())}</b>. Abra no mesmo aparelho e navegador para continuar.`;
      msg.classList.add('ok');
    } catch (err) {
      msg.textContent = err?.status === 429 ? 'Muitos pedidos de link em pouco tempo. Espere um minuto e tente de novo.' : 'Não foi possível enviar o link agora. Confira o e-mail e tente de novo.';
      msg.classList.add('err');
    } finally {
      btn.disabled = false;
    }
  });
}
async function signOut() {
  if (S.c && S.mode === 'live' && ['accepted', 'in_call'].includes(S.c.status)) { toast('Encerre a consulta antes de sair.'); return; }
  await setAvailable(false);
  await A.signOut();
  resetAll();
  renderAuth();
  flash('Você saiu da sua conta.', 'ok');
}
function resetAll() {
  stopDuty();
  closeConsult(true);
  S.me = null; S.meErr = false; S.admin = false; S.hist = []; S.queueSig = ''; S.seenIds = null;
  S.d.profile = null; S.d.lists = {}; S.d.ctx = {}; S.d.unsigned = null;
  for (const id of ['#meCard', '#regCard', '#noticeCard', '#dutyCard', '#signCard', '#consult', '#histCard', '#adminCard']) $(id).hidden = true;
  $('#admin').innerHTML = ''; $('#hist').innerHTML = ''; $('#queue').innerHTML = '';
  clearSteps($('#meSteps')); clearSteps($('#regSteps'));
  // Painel: some e esquece os números (outra conta pode entrar nesta página); "missing" fica (o banco é o mesmo).
  Object.assign(S.panel, { data: null, blocked: false, err: false });
  $('#nowLive').textContent = '';
  syncPanel();
}

/* ======================= cadastro ======================= */
async function loadMe() {
  let rows;
  try { rows = await A.rpc('tele_doctor_me'); } catch (err) {
    if (lostSession(err)) return;
    // Sem a situação do cadastro, as etapas somem e não voltam com a situação antiga (renderSteps confere S.meErr).
    S.meErr = true;
    clearSteps($('#meSteps')); clearSteps($('#regSteps'));
    $('#meCard').hidden = false;
    $('#meBox').innerHTML = `<p class="bk-err show">${esc(T.errorText(T.errorInfo(err).code))}</p><button class="btn btn-ghost btn-sm" type="button" id="meRetry">Tentar de novo</button>`;
    $('#meRetry').addEventListener('click', loadMe);
    return;
  }
  const me = Array.isArray(rows) ? rows[0] : rows;
  S.meErr = false;
  S.admin = !!me?.is_admin;
  S.me = me && me.id ? me : null;
  // O banco recusou o painel ("não aprovado"), e o cadastro mudou mesmo: o painel volta quando for aprovado de novo.
  if (S.me?.status !== 'approved') S.panel.blocked = false;
  renderMe();
  if (S.admin) loadAdmin();
  else $('#adminCard').hidden = true;
  if (S.me) { loadHistory(); loadProfile(); loadUnsigned(); }
  if (S.me?.status === 'approved') {
    if (noticeAccepted()) startDuty(); else showNotice();
  } else {
    stopDuty();
    $('#noticeCard').hidden = true;
  }
  syncPanel();
}
const STATUS_TEXT = {
  pending: ['tl-chip warn', 'Em análise', 'A equipe do IMED vai conferir o seu CRM no CFM e a sua identidade: por chamada de vídeo (documento com foto e carteira do CRM) ou por um documento assinado com o seu certificado ICP-Brasil. A fila de pacientes aparece aqui quando o cadastro for aprovado.'],
  approved: ['tl-chip ok', 'Aprovado', 'Você pode atender. Mudar nome, CRM, UF, RQE ou especialidade manda o cadastro de novo para análise.'],
  rejected: ['tl-chip err', 'Recusado', 'Confira os dados e envie de novo, se for o caso.'],
  suspended: ['tl-chip err', 'Suspenso', 'Você não pode atender agora. Fale com o IMED. Enquanto isso, abaixo aparecem só as consultas das últimas 24 horas (para terminar o registro), sem o celular dos pacientes.'],
};
function renderMe() {
  const me = S.me;
  if (!me) {
    $('#meCard').hidden = true;
    fillReg(null);
    $('#regCard').hidden = false;
    $('#regCancel').hidden = true;
    $('#regBtn').textContent = 'Enviar para análise';
    renderSteps();
    return;
  }
  $('#regCard').hidden = true;
  $('#meCard').hidden = false;
  const [cls, label, help] = STATUS_TEXT[me.status] || ['tl-chip', me.status, ''];
  const spec = T.doctorSpecialty(me);
  const due = me.status === 'approved' ? T.recheckDue(me.checked_at) : null;
  $('#meBox').innerHTML = `<div class="md-me"><div><b>${esc(me.full_name)}</b><span>${esc(T.doctorCrm(me))}${spec ? ` · ${esc(spec)}` : ''}</span>
      ${me.phone ? `<small>Celular: ${esc(T.fmtPhone(me.phone))}</small>` : ''}</div><span class="${cls}">${esc(label)}</span></div>
    <p class="tl-muted">${esc(help)}</p>
    ${due ? `<p class="tl-small">Identidade e CRM conferidos pela equipe do IMED em ${esc(T.fmtDateTime(me.checked_at))}. Nova conferência até ${esc(T.fmtDate(due.slice(0, 10)))} (sem ela, o cadastro é suspenso).</p>` : ''}
    ${me.review_note ? `<p class="md-note"><b>Observação da equipe do IMED:</b> ${esc(me.review_note)}</p>` : ''}
    <div class="tl-row"><button class="btn btn-ghost btn-sm" type="button" id="editBtn"><i class="fa-solid fa-pen" aria-hidden="true"></i>${me.status === 'rejected' ? 'Corrigir e enviar de novo' : 'Editar cadastro'}</button></div>
    <section class="md-dbox md-meprof" aria-labelledby="meProfT"><h3 id="meProfT">Endereço e contato profissionais</h3>
      <p class="tl-small">Vão impressos nos documentos (Res. CFM 2.381/2024). Mudar estes dados não manda o cadastro para análise.</p>
      <div id="meProf"></div></section>`;
  renderProfile();
  renderSteps();
  $('#editBtn').addEventListener('click', () => {
    fillReg(me);
    $('#regCard').hidden = false;
    $('#regCancel').hidden = false;
    // Recusado (e em análise) vai para a análise; aprovado e suspenso só salvam (suspenso continua suspenso).
    $('#regBtn').textContent = ['approved', 'suspended'].includes(me.status) ? 'Salvar' : 'Enviar para análise';
    $('#regTitle').focus();
  });
}

/* ======================= etapas do cadastro ======================= */
// Indicador no topo do cadastro: Conta criada → Envio do cadastro → Conferência do CRM → Aprovado → Disponível.
// A etapa atual vem da situação de tele_doctor_me e, a última, do botão "Disponível para atender" desta página.
// Recusado e suspenso aparecem como etapa com problema, com o que fazer. Quem ainda não tem cadastro vê as etapas no
// quadro do formulário (#regSteps); quem já tem, no quadro "Seu cadastro de médico" (#meSteps).
const STEPS = ['Conta criada', 'Envio do cadastro', 'Conferência do CRM', 'Aprovado', 'Disponível'];
// Link "Fale com o IMED" (HTML fixo, sem dado de ninguém): o texto muda só a maiúscula, conforme o lugar na frase.
const contactLink = (text) => `<a class="link" href="contato.html">${text}</a>`;
// at: índice da etapa atual; bad: situação com problema; on: disponível agora; msg: o que fazer (texto);
// after: complemento com link (HTML fixo, sem dado de ninguém).
function stepNow() {
  const me = S.me;
  if (!me) return { at: 1, msg: 'Agora: preencha o cadastro abaixo e toque em “Enviar para análise”.' };
  switch (me.status) {
    case 'pending': return { at: 2, msg: 'Agora: a equipe do IMED confere o seu CRM no portal do CFM e combina com você a prova de identidade.' };
    case 'rejected': return { at: 2, bad: 'Recusado', msg: 'O cadastro foi recusado. Leia a observação da equipe, se houver, toque em “Corrigir e enviar de novo” e envie: o cadastro volta para a conferência.', after: ` Dúvidas? ${contactLink('Fale com o IMED')}.` };
    case 'suspended': return { at: 3, bad: 'Suspenso', msg: 'Você não pode atender agora. Veja a observação da equipe, se houver, e', after: ` ${contactLink('fale com o IMED')} para saber o que fazer.` };
    case 'approved':
      if (S.available) return { at: 4, on: true, msg: 'Você está disponível: os pacientes veem o seu nome e CRM. Atenda pelo quadro “Fila de pacientes”.' };
      return { at: 3, msg: S.duty ? 'Agora: ligue “Disponível para atender”, no quadro “Fila de pacientes”, quando quiser atender.' : 'Agora: leia o aviso “Antes de ficar disponível” e marque que entendeu. Depois, ligue “Disponível para atender”.' };
    default: return { at: 2, msg: '' };
  }
}
function clearSteps(box) { box.hidden = true; box.innerHTML = ''; delete box.dataset.sig; }
function renderSteps() {
  // Sem entrada ou sem a situação do cadastro (a última leitura falhou): nenhuma das duas listas de etapas.
  if (!A.user() || S.meErr) { clearSteps($('#meSteps')); clearSteps($('#regSteps')); return; }
  const box = $(S.me ? '#meSteps' : '#regSteps');
  clearSteps($(S.me ? '#regSteps' : '#meSteps'));
  const st = stepNow();
  // Só refaz quando algo mudou (o foco de quem usa teclado não se perde no link de ajuda).
  const sig = JSON.stringify(st);
  if (box.dataset.sig === sig && !box.hidden) return;
  box.dataset.sig = sig;
  const items = STEPS.map((name, i) => {
    const now = i === st.at;
    const done = i < st.at;
    const cls = now ? (st.bad ? 'bad' : st.on ? 'now on' : 'now') : done ? 'done' : '';
    const mark = now && st.bad ? '<i class="fa-solid fa-triangle-exclamation"></i>' : done ? '<i class="fa-solid fa-check"></i>' : String(i + 1);
    const note = now ? (st.bad ? `<small>Situação: ${esc(st.bad)}</small>` : '<small aria-hidden="true">Etapa atual</small>') : done ? '<span class="sr"> (concluída)</span>' : '';
    return `<li${cls ? ` class="${cls}"` : ''}${now ? ' aria-current="step"' : ''}><span class="md-sn" aria-hidden="true">${mark}</span><span class="md-sl">${esc(name)}${note}</span></li>`;
  }).join('');
  // role="list": sem marcador (list-style:none), o VoiceOver do Safari deixaria de anunciar a lista.
  box.innerHTML = `<ol class="md-stepper" role="list" aria-label="Etapas do seu cadastro de médico">${items}</ol>
    ${st.msg ? `<p class="md-stepmsg${st.bad ? ' bad' : st.on ? ' on' : ''}">${esc(st.msg)}${st.after || ''}</p>` : ''}
    <p class="md-stephelp"><a class="link" href="para-medicos.html#fluxo"><i class="fa-solid fa-circle-question" aria-hidden="true"></i>Como funciona para o médico</a></p>`;
  box.hidden = false;
}
const REG = { full_name: ['#rName', '#erName'], crm: ['#rCrm', '#erCrm'], crm_uf: ['#rUf', '#erUf'], rqe: ['#rRqe', '#erRqe'], specialty: ['#rSpec', '#erSpec'], phone: ['#rPhone', '#erPhone'] };
function fillReg(me) {
  $('#rName').value = me?.full_name || '';
  $('#rCrm').value = me?.crm || '';
  $('#rUf').value = me?.crm_uf || '';
  $('#rRqe').value = me?.rqe || '';
  $('#rSpec').value = me?.specialty || '';
  $('#rPhone').value = me?.phone ? T.fmtPhone(me.phone) : '';
  showRegErrors({});
}
function showRegErrors(errors) {
  for (const [k, [inp, out]] of Object.entries(REG)) {
    const msg = errors[k] || '';
    $(out).textContent = msg;
    $(inp).setAttribute('aria-invalid', msg ? 'true' : 'false');
    $(inp).closest('.fld').classList.toggle('bad', !!msg);
  }
}
function setupReg() {
  $('#rUf').insertAdjacentHTML('beforeend', T.UFS.map((u) => `<option>${u}</option>`).join(''));
  $('#rPhone').addEventListener('input', (e) => { const d = T.onlyDigits(e.target.value); if (d.length <= 11 && !e.target.value.trim().startsWith('+')) e.target.value = T.maskPhone(d); });
  $('#regCancel').addEventListener('click', () => { $('#regCard').hidden = true; $('#editBtn')?.focus(); });
  $('#regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#regErr');
    err.classList.remove('show');
    const r = T.validateDoctor({ full_name: $('#rName').value, crm: $('#rCrm').value, crm_uf: $('#rUf').value, rqe: $('#rRqe').value, specialty: $('#rSpec').value, phone: $('#rPhone').value });
    showRegErrors(r.errors);
    if (!r.ok) { const k = Object.keys(REG).find((x) => r.errors[x]); $(REG[k][0]).focus(); return; }
    const btn = $('#regBtn');
    btn.disabled = true;
    try {
      const status = await A.rpc('tele_doctor_register', r.args);
      flash(status === 'approved' ? 'Cadastro salvo.' : status === 'suspended' ? 'Dados salvos. O cadastro continua suspenso.' : 'Cadastro enviado. A equipe do IMED vai conferir o seu CRM no CFM e a sua identidade, e combinar com você como.', 'ok');
      await loadMe();
      $('#meTitle').focus();
    } catch (ex) {
      if (lostSession(ex)) return;
      const { code, details } = T.errorInfo(ex);
      if (code === 'dados_invalidos' && T.DOCTOR_FIELD[details]) { showRegErrors({ [T.DOCTOR_FIELD[details]]: T.errorText(code, details) }); $(REG[T.DOCTOR_FIELD[details]][0]).focus(); }
      else { err.textContent = T.errorText(code, details); err.classList.add('show'); }
    } finally {
      btn.disabled = false;
    }
  });
}

/* ======================= aviso regulatório ======================= */
const noticeStoreKey = () => `${NOTICE_KEY}:${A.user()?.id || ''}`;
function noticeAccepted() { try { return localStorage.getItem(noticeStoreKey()) === T.NOTICE_VERSION; } catch { return false; } }
function showNotice() {
  $('#noticeCard').hidden = false;
  $('#dutyCard').hidden = true;
}
function setupNotice() {
  $('#noticeBtn').addEventListener('click', () => {
    if (!$('#noticeOk').checked) { $('#noticeErr').textContent = 'Para atender, marque que leu e entendeu o aviso.'; $('#noticeErr').classList.add('show'); $('#noticeOk').focus(); return; }
    $('#noticeErr').classList.remove('show');
    try { localStorage.setItem(noticeStoreKey(), T.NOTICE_VERSION); } catch { /* fica só nesta visita */ }
    $('#noticeCard').hidden = true;
    startDuty();
    $('#dutyTitle').focus();
  });
}

/* ======================= ir para uma parte da página ======================= */
// Menu do topo e botões do painel: rola até a parte e põe o foco no título dela (quem usa teclado ou leitor de tela
// continua dali). Parte escondida (não está na tela agora): não faz nada e devolve false.
function goTo(sel) {
  const box = $(sel);
  if (!box || box.closest('[hidden]')) return false;
  const h = box.querySelector('h2, h3');
  box.scrollIntoView({ block: 'start' });
  if (h) {
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }
  return true;
}

/* ======================= menu do topo (Plataforma de atendimento) ======================= */
// Painel, Fila, Consultas, Documentos e Meu cadastro: âncoras para as partes desta página. Cada item aparece só quando
// a parte dele está na tela, para nenhum levar a lugar nenhum: a fila e o painel só para o médico aprovado (fora da
// consulta, ele vê os cinco; "Painel" quando os números chegaram do banco); na consulta, "Consultas" leva à consulta
// aberta e "Documentos" aos documentos dela; "Fila" leva ao aviso enquanto ele não foi lido; fora da consulta,
// "Documentos" leva a "Falta assinar" e, sem nada para assinar, às consultas anteriores (cada uma tem o bloco
// "Documentos"). Abaixo de 1040 px o menu abre pelo botão "Menu" (caixa embaixo do topo); sem nenhum item (antes de
// entrar), o topo mostra só "Site do IMED".
const MENU = {
  painel: ['#painel'],
  fila: ['#dutyCard', '#noticeCard'],
  consultas: ['#consult', '#histCard'],
  documentos: ['#signCard', '#cDocs', '#histCard'],
  cadastro: ['#meCard', '#regCard'],
};
const onScreen = (el) => !!el && !el.closest('[hidden]');
function syncMenu() {
  let any = false;
  for (const a of $$('#mdMenu [data-go]')) {
    const to = MENU[a.dataset.go].find((s) => onScreen($(s)));
    if (a.parentElement.hidden !== !to) a.parentElement.hidden = !to;
    if (to) { any = true; if (a.getAttribute('href') !== to) a.setAttribute('href', to); }
  }
  $('#mdMenu .md-navlist').hidden = !any;
  $('#mdTop').classList.toggle('solo', !any);
  if (!any && menuOpen()) setMenu(false);
}
const menuOpen = () => $('#menuBtn').getAttribute('aria-expanded') === 'true';
function setMenu(open) {
  $('#mdTop').classList.toggle('open', open);
  $('#menuBtn').setAttribute('aria-expanded', String(open));
}
function setupMenu() {
  $('#menuBtn').addEventListener('click', () => setMenu(!menuOpen()));
  $('#mdMenu').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-go]');
    if (!a) return;
    e.preventDefault();
    setMenu(false);
    goTo(a.getAttribute('href'));
  });
  // Fecha com Esc (o foco volta ao botão), com um toque fora do topo e quando o foco sai do topo (a caixa aberta não
  // cobre o que recebeu o foco). Passou para a tela larga (menu na linha do topo): fecha também.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen()) { setMenu(false); $('#menuBtn').focus(); } });
  document.addEventListener('click', (e) => { if (menuOpen() && !e.target.closest('#mdTop')) setMenu(false); });
  // Fecha quando o foco sai do menu e do botão do menu (ex.: Tab de "Site do IMED" para o botão de tema).
  $('#mdTop').addEventListener('focusout', (e) => { const t = e.relatedTarget; if (menuOpen() && t && !$('#mdMenu').contains(t) && t !== $('#menuBtn')) setMenu(false); });
  window.matchMedia?.('(min-width: 1040px)').addEventListener?.('change', () => setMenu(false));
  // Os quadros aparecem e somem (atributo hidden) por todo o código: o menu acompanha sozinho.
  new MutationObserver(syncMenu).observe($('#main'), { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  syncMenu();
}

/* ======================= painel "Agora na plataforma" ======================= */
// Números de agora, direto do banco (tele_painel_medico): só contagens, nenhum dado de paciente (nem nome, nem idade,
// nem motivo). Só para o médico aprovado e fora da consulta; o médico em análise, recusado ou suspenso continua vendo
// só as etapas do cadastro (o banco também recusa). Atualiza a cada 20 s com a aba à vista; com a aba escondida (até
// aberta em segundo plano) não pede nada e volta na hora quando a aba aparece. Banco ainda sem a função
// (404/PGRST202) ou sem permissão para o médico (403): o painel some, sem erro. Falha passageira (rede, servidor,
// entrada vencida com 401): mostra os números de antes, com a hora deles, e tenta de novo. Número que não veio do
// banco aparece como "—" (nunca um número inventado). No celular, com o médico disponível, o painel fica resumido
// (só quem espera e "Ver a fila"), para a fila ficar mais perto do topo.
const panelPoll = T.createPoller({ run: loadPanel, interval: PANEL_MS, hiddenInterval: null });
const NUM_KEYS = ['aguardando', 'em_atendimento', 'atendidos_hoje', 'documentos_para_assinar', 'medicos_disponiveis'];
const NUM_LABEL = {
  aguardando: ['paciente aguardando atendimento', 'pacientes aguardando atendimento'],
  em_atendimento: ['paciente em atendimento com você', 'pacientes em atendimento com você'],
  // conta consultas (o mesmo paciente atendido duas vezes conta 2): "atendimentos", não "pacientes"
  atendidos_hoje: ['atendimento hoje com você', 'atendimentos hoje com você'],
  documentos_para_assinar: ['documento para assinar', 'documentos para assinar'],
  medicos_disponiveis: ['médico disponível agora', 'médicos disponíveis agora'],
};
// Contagem como o banco mandou: inteiro de 0 para cima (número ou texto só com dígitos); o resto vira null.
function countOf(v) {
  if (typeof v === 'string' && /^\d{1,9}$/.test(v.trim())) return Number(v);
  return Number.isSafeInteger(v) && v >= 0 ? v : null;
}
function normPanel(raw) {
  const r = Array.isArray(raw) ? raw[0] : raw;
  if (!r || typeof r !== 'object') return null;
  const out = Object.fromEntries(NUM_KEYS.map((k) => [k, countOf(r[k])]));
  out.espera = out.aguardando > 0 ? countOf(r.espera_mais_longa_min) : null;
  // Hora dos números: a do banco; se não vier, a hora em que a resposta chegou.
  const at = new Date(r.atualizado_em ?? '');
  out.at = Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString();
  return out;
}
// "12 min", "1 h 5 min"; menos de um minuto: "menos de 1 min".
function minutesText(m) {
  if (m < 1) return 'menos de 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} h${r ? ` ${r} min` : ''}`;
}
const panelWanted = () => !!A.user() && S.me?.status === 'approved' && !S.c && !S.panel.missing && !S.panel.blocked;
// Liga ou desliga o painel conforme a situação (chamado quando o cadastro, a consulta, a entrada ou a aba mudam).
function syncPanel() {
  if (!panelWanted()) {
    panelPoll.stop();
    $('#painel').hidden = true;
    return;
  }
  // Voltando da consulta: os números de antes aparecem na hora e os de agora chegam em seguida (start pede já).
  $('#painel').hidden = !S.panel.data;
  // Aba escondida (por exemplo, aberta em segundo plano a partir de para-medicos.html): não pede nada agora. Quando a
  // aba aparece, o ouvinte de visibilitychange (setupPanel) chama syncPanel de novo e os números vêm na hora.
  if (document.hidden) { panelPoll.stop(); return; }
  if (!panelPoll.active) panelPoll.start();
}
// Pede os números de novo agora (depois de ficar disponível, tirar da fila, enviar ou cancelar documento).
function panelSoon() { if (panelWanted() && panelPoll.active) panelPoll.now(); }
// Banco sem a função (404/PGRST202) ou sem permissão para o médico logado (403 com 42501): não muda até publicar de
// novo, então o painel some. O 401 não entra aqui: é a entrada vencida ou uma chamada que saiu sem ela (a renovação
// falhou por rede ou por excesso de pedidos), e passa sozinho.
const panelMissing = (err) => err?.status === 404 || err?.data?.code === 'PGRST202' || (err?.status === 403 && err?.data?.code === '42501');
async function loadPanel() {
  if (!panelWanted()) return;
  // Disponibilidade na hora do pedido: só números pedidos com o médico já disponível (e sem mudar até a resposta)
  // contam ele entre os médicos disponíveis ("Contando você.").
  const gen = S.panel.gen;
  const on = S.available;
  let raw;
  try { raw = await A.rpc('tele_painel_medico'); } catch (err) {
    // Saiu da conta, abriu uma consulta ou mudou de cadastro enquanto esperava: nada a fazer.
    if (S.me?.status !== 'approved' || S.c) return;
    if (lostSession(err)) return;
    if (panelMissing(err)) { S.panel.missing = true; syncPanel(); return; }
    const { code } = T.errorInfo(err);
    if (code === 'nao_aprovado' || code === 'sem_cadastro') { S.panel.blocked = true; syncPanel(); loadMe(); return; }
    // Rede, servidor ou 401 passageiro: os números de antes ficam, com a hora deles, e a próxima atualização tenta de
    // novo (como a fila).
    S.panel.err = true;
    renderPanelAt();
    return;
  }
  if (!panelWanted()) return;
  const d = normPanel(raw);
  if (!d) { S.panel.err = true; renderPanelAt(); return; }
  d.comVoce = on && S.available && gen === S.panel.gen;
  S.panel.err = false;
  renderPanel(d);
}
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
function renderPanel(d) {
  const prev = S.panel.data;
  S.panel.data = d;
  for (const k of NUM_KEYS) {
    const li = $(`[data-num="${k}"]`);
    const n = d[k];
    const v = li.querySelector('.md-nv');
    // Sem número do banco: um traço na tela e "sem dado" para o leitor de tela.
    const html = n == null ? '<span aria-hidden="true">—</span><span class="sr">sem dado:</span>' : esc(n.toLocaleString('pt-BR'));
    if (v.innerHTML !== html) v.innerHTML = html;
    setText(li.querySelector('.md-nl'), NUM_LABEL[k][n === 1 ? 0 : 1]);
  }
  setText($('#nowWait'), d.aguardando > 0 && d.espera != null ? `O primeiro da fila espera há ${minutesText(d.espera)}.` : '');
  const signBox = $('#nowSign').parentElement;
  if (signBox.hidden !== !(d.documentos_para_assinar > 0)) signBox.hidden = !(d.documentos_para_assinar > 0);
  renderNowMe();
  renderPanelAt();
  renderNowBtn();
  $('#painel').hidden = !panelWanted();
  // Leitor de tela (educado): avisa só quando muda o número de pacientes esperando; nada a cada atualização. Com a
  // fila na tela, quem avisa é ela (#queueLive: "Novo paciente na fila"); o painel fica quieto para não avisar duas
  // vezes a mesma chegada.
  if (prev && d.aguardando != null && prev.aguardando !== d.aguardando && $('#dutyCard').hidden) {
    $('#nowLive').textContent = d.aguardando === 0 ? 'Agora ninguém está aguardando atendimento.'
      : `Agora ${d.aguardando === 1 ? 'há 1 paciente aguardando' : `há ${d.aguardando.toLocaleString('pt-BR')} pacientes aguardando`} atendimento.`;
  }
}
// Hora dos números (a do banco), na mesma linha pequena de "Só números…".
function renderPanelAt() {
  const at = S.panel.data ? T.fmtTime(S.panel.data.at) : '';
  const el = $('#nowAt');
  setText(el, S.panel.err
    ? (at ? `Atualizado às ${at}. Sem resposta do servidor agora: tentando de novo…` : 'Sem resposta do servidor. Tentando de novo…')
    : (at ? `Atualizado às ${at}.` : ''));
  el.classList.toggle('warn', S.panel.err);
}
// "Contando você.": só ao lado de números pedidos com o médico já disponível (o banco conta quem está disponível na
// hora do pedido) e enquanto ele continua disponível. Logo depois de ligar, o número de antes (sem ele) fica sem a
// frase até os números de agora chegarem.
function renderNowMe() {
  const d = S.panel.data;
  setText($('#nowMe'), S.available && d?.comVoce && d.medicos_disponiveis > 0 ? 'Contando você.' : '');
}
// Um botão só (o foco não se perde quando muda): "Ficar disponível" leva ao aviso (se ainda não foi lido) ou liga o
// "Disponível para atender"; disponível, vira "Ver a fila". A classe "on" deixa o painel resumido no celular (CSS).
function renderNowBtn() {
  const b = $('#nowBtn');
  const act = S.available ? 'fila' : 'on';
  $('#painel').classList.toggle('on', S.available);
  if (b.dataset.act === act) return;
  b.dataset.act = act;
  b.textContent = S.available ? 'Ver a fila' : 'Ficar disponível';
  b.className = `btn ${S.available ? 'btn-primary' : 'btn-coral'}`;
}
function setupPanel() {
  $('#nowBtn').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (b.dataset.act === 'fila') { goTo('#dutyCard'); return; }
    if (!S.duty) { showNotice(); goTo('#noticeCard'); return; }
    b.disabled = true;
    try { await setAvailable(true, true); } finally { b.disabled = false; }
    if (S.available) toast('Pronto: você está disponível. Os pacientes veem o seu nome e CRM.');
  });
  // "Ver e assinar": leva ao quadro "Falta assinar" (lê a lista de novo se ele ainda não está na tela). "Nenhum
  // documento" só quando a lista voltou vazia de verdade; se ela não veio (rede, servidor), diz isso.
  $('#nowSign').addEventListener('click', async (e) => {
    e.preventDefault();
    if ($('#signCard').hidden) await loadUnsigned();
    if (!A.user() || goTo('#signCard')) return;
    if (S.d.unsigned === null) { toast('Não foi possível abrir a lista “Falta assinar” agora. Tente de novo.'); return; }
    toast('Nenhum documento esperando a sua assinatura agora.');
    panelSoon();
  });
  // Aba escondida (outra aba à frente, tela apagada): o painel para de vez, sem nem a atualização já marcada; quando a
  // aba aparece, pede os números na hora. (O ouvinte do próprio poller, registrado antes, não faz nada com ele parado.)
  document.addEventListener('visibilitychange', () => { if (document.hidden) panelPoll.stop(); else syncPanel(); });
}

/* ======================= disponível + fila ======================= */
const queuePoll = T.createPoller({ run: loadQueue, interval: 5000, hiddenInterval: 30000 });
const AVAIL_KEY = 'imed_medico_disponivel';
const rememberAvail = (on) => { try { if (on) sessionStorage.setItem(AVAIL_KEY, '1'); else sessionStorage.removeItem(AVAIL_KEY); } catch { /* sem armazenamento */ } };
const wasAvail = () => { try { return sessionStorage.getItem(AVAIL_KEY) === '1'; } catch { return false; } };
function startDuty() {
  S.duty = true;
  $('#dutyCard').hidden = !!S.c;
  queuePoll.start();
  renderSteps();
  // Recarregou a página com "Disponível" ligado (nesta aba): liga de novo.
  if (wasAvail() && !S.available) setAvailable(true);
}
function stopDuty() {
  S.duty = false;
  queuePoll.stop();
  if (S.available) setAvailable(false);
  $('#dutyCard').hidden = true;
  if (A.user()) renderSteps();
}
async function setAvailable(on, fromClick = false) {
  clearInterval(S.hb);
  S.hb = 0;
  const btn = $('#availBtn');
  if (!on) {
    const was = S.available;
    S.available = false;
    rememberAvail(false);
    renderAvail();
    if (was) {
      try { await A.rpc('tele_set_available', { p_on: false }); } catch { /* vence sozinho em 90 s */ }
      panelSoon(); // painel: os "médicos disponíveis" de agora, já sem este médico
    }
    return;
  }
  // Pedido de notificação junto do toque em "Disponível" (o navegador só pergunta depois de um toque).
  if (fromClick) { try { if (window.Notification?.permission === 'default') Notification.requestPermission().catch(() => {}); } catch { /* sem notificação */ } }
  btn.disabled = true;
  try {
    await A.rpc('tele_set_available', { p_on: true });
    S.available = true;
    rememberAvail(true);
    S.hb = setInterval(heartbeat, HEARTBEAT_MS);
  } catch (err) {
    S.available = false;
    rememberAvail(false);
    if (!lostSession(err)) {
      const { code } = T.errorInfo(err);
      toast(T.errorText(code));
      if (code === 'nao_aprovado' || code === 'sem_cadastro') loadMe();
    }
  } finally {
    btn.disabled = false;
    renderAvail();
  }
}
async function heartbeat() {
  if (!S.available) return;
  try { await A.rpc('tele_set_available', { p_on: true }); } catch (err) {
    if (lostSession(err)) return;
    const { code } = T.errorInfo(err);
    if (code === 'nao_aprovado' || code === 'sem_cadastro') { S.available = false; clearInterval(S.hb); renderAvail(); toast(T.errorText(code)); loadMe(); }
  }
}
function renderAvail() {
  const b = $('#availBtn');
  b.setAttribute('aria-checked', String(S.available));
  b.classList.toggle('on', S.available);
  $('#availNote').textContent = S.available
    ? 'Ligado: os pacientes veem que há médico atendendo, com o seu nome e CRM. Ao sair desta página, você deixa de aparecer.'
    : 'Desligado: os pacientes veem “Nenhum médico atendendo agora”. Ao sair desta página, você deixa de aparecer.';
  S.queueSig = '';
  renderQueue();
  renderSteps();
  // Painel: se a disponibilidade mudou, os números de antes não servem para "Contando você." (a frase some até os de
  // agora chegarem). Ligou: o banco já conta o médico (renderAvail vem depois de tele_set_available), então pede já.
  // Desligou: setAvailable pede depois que o banco tirar o médico. O botão muda ("Ficar disponível" ou "Ver a fila").
  if (S.panel.avail !== S.available) {
    S.panel.avail = S.available;
    S.panel.gen += 1;
    if (S.panel.data) S.panel.data.comVoce = false;
    if (S.available) panelSoon();
  }
  renderNowBtn();
  renderNowMe();
}
// Ao fechar a página: desliga o "disponível" (se não der, vence sozinho em 90 s).
function offOnLeave() {
  if (!S.available) return;
  const s = A.session();
  if (!s?.access_token) return;
  try {
    fetch(`${C.supabaseUrl}/rest/v1/rpc/tele_set_available`, {
      method: 'POST', keepalive: true,
      headers: C.supabaseHeaders(s.access_token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_on: false }),
    }).catch(() => {});
  } catch { /* ignora */ }
}
async function loadQueue() {
  if (!S.duty) return;
  let rows;
  try { rows = await A.rpc('tele_queue'); } catch (err) {
    if (lostSession(err)) return;
    const { code } = T.errorInfo(err);
    if (code === 'nao_aprovado' || code === 'sem_cadastro') { stopDuty(); loadMe(); return; }
    $('#queueAt').textContent = 'Sem resposta do servidor. Tentando de novo…';
    return;
  }
  S.queue = Array.isArray(rows) ? rows : [];
  queuePoll.setInterval(S.c ? 15000 : 5000);
  announceQueue();
  renderQueue();
  $('#queueAt').textContent = `Atualizada às ${T.fmtTime(new Date().toISOString())}.`;
  const waiting = S.queue.filter((q) => q.status === 'waiting').length;
  document.title = `${waiting ? `(${waiting}) ` : ''}${PAGE_TITLE}`;
  // Consulta própria em andamento (por exemplo, depois de recarregar a página): volta para ela.
  const mine = S.queue.find((q) => q.status === 'accepted' || q.status === 'in_call');
  if (mine && !S.c) resumeConsult(mine.id);
}
// Paciente novo na fila: aviso curto para o leitor de tela (a lista em si não é "ao vivo") e, com a aba escondida,
// bipe e notificação (sem o nome do paciente).
function announceQueue() {
  const waiting = S.queue.filter((q) => q.status === 'waiting');
  const first = S.seenIds == null;
  const fresh = first ? [] : waiting.filter((q) => !S.seenIds.has(q.id));
  S.seenIds = new Set(waiting.map((q) => q.id));
  if (!fresh.length) return;
  const q = fresh[0];
  const age = T.ageLabel(q.age_years);
  $('#queueLive').textContent = fresh.length === 1
    ? `Novo paciente na fila: ${q.patient_name}${age ? `, ${age}` : ''}.`
    : `${fresh.length} novos pacientes na fila.`;
  if (S.available && !S.c) notify(fresh.length === 1 ? 'Novo paciente na fila da teleconsulta.' : `${fresh.length} novos pacientes na fila da teleconsulta.`);
}
function queueItem(q) {
  const own = q.status !== 'waiting';
  const who = q.for_other ? `<span class="md-qtag">Pedido por responsável${q.relationship ? ` (${esc(q.relationship)})` : ''}</span>` : '';
  const seen = own ? null : T.seenText(q.seen_seconds);
  return `<li class="md-q${own ? ' own' : ''}" data-q="${esc(q.id)}">
    <div class="md-qmain"><b>${esc(q.patient_name)}</b><span>${esc(T.ageLabel(q.age_years))}${q.age_years != null && q.age_years < 18 ? ' · menor de idade' : ''}</span>${who}
      <p class="md-qreason">${esc(q.reason)}</p>
      <small>${own ? esc(T.STATUS_DOCTOR[q.status] || '') : `Esperando há ${esc(String(Math.max(0, Number(q.wait_minutes) || 0)))} min`}</small>
      ${seen ? `<small class="md-seen${seen.ok ? ' ok' : ''}">${esc(seen.ok ? 'Página aberta no aparelho do paciente.' : seen.text)}</small>` : ''}</div>
    <div class="md-qacts">${own
      ? `<button class="btn btn-primary btn-sm" type="button" data-resume="${esc(q.id)}">Voltar para a consulta</button>`
      : `<button class="btn btn-coral btn-sm" type="button" data-accept="${esc(q.id)}"${S.c ? ' disabled' : ''}>Atender<span class="sr"> ${esc(q.patient_name)}</span></button>
         <button class="btn btn-ghost btn-sm" type="button" data-dismiss="${esc(q.id)}">Tirar da fila<span class="sr"> ${esc(q.patient_name)}</span></button>`}</div>
    ${own ? '' : `<div class="tl-confirm" data-dismissbox="${esc(q.id)}" role="group" aria-label="Tirar ${esc(q.patient_name)} da fila" hidden>
      <p>Tirar este pedido da fila? Use só para pedido falso ou repetido: o paciente vê que um médico retirou o pedido.</p>
      <div class="tl-row"><button class="btn btn-coral btn-sm" type="button" data-dismissyes="${esc(q.id)}">Sim, tirar da fila</button><button class="btn btn-ghost btn-sm" type="button" data-dismissno="${esc(q.id)}">Voltar</button></div></div>`}
  </li>`;
}
// Só refaz a lista quando algo mudou (e devolve o foco ao mesmo botão), para não atrapalhar quem usa teclado ou
// leitor de tela.
function renderQueue() {
  const list = $('#queue');
  const sig = JSON.stringify([!!S.c, S.available, S.queue.map((q) => [q.id, q.status, q.patient_name, q.age_years, q.reason, q.for_other, q.relationship, q.wait_minutes, q.status === 'waiting' ? T.seenText(q.seen_seconds).text : ''])]);
  if (sig === S.queueSig) return;
  S.queueSig = sig;
  const a = document.activeElement;
  const keep = a && list.contains(a) ? ['data-accept', 'data-resume', 'data-dismiss', 'data-dismissyes', 'data-dismissno'].find((k) => a.hasAttribute(k)) : null;
  const keepVal = keep ? a.getAttribute(keep) : null;
  const open = $$('[data-dismissbox]:not([hidden])', list).map((b) => b.dataset.dismissbox);
  list.innerHTML = S.queue.length
    ? S.queue.map(queueItem).join('')
    : `<li class="md-qempty"><i class="fa-solid fa-mug-hot" aria-hidden="true"></i>Ninguém na fila agora.${S.available ? '' : ' Ligue “Disponível para atender” para os pacientes saberem que há médico atendendo.'}</li>`;
  for (const id of open) { const b = list.querySelector(`[data-dismissbox="${CSS.escape(id)}"]`); if (b) b.hidden = false; }
  if (keep) list.querySelector(`[${keep}="${CSS.escape(keepVal)}"]`)?.focus();
}
async function accept(id, btn) {
  if (S.c) return;
  if (btn) btn.disabled = true;
  try {
    const rows = await A.rpc('tele_accept', { p_id: id });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error('vazio');
    await openConsult(row, 'live');
  } catch (err) {
    if (lostSession(err)) return;
    const { code } = T.errorInfo(err);
    toast(T.errorText(code));
    if (code === 'consulta_ativa') queuePoll.now();
    else loadQueue();
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function dismiss(id, btn) {
  btn.disabled = true;
  try {
    await A.rpc('tele_dismiss', { p_id: id });
    toast('Pedido retirado da fila.');
    $('#queueLive').textContent = 'Pedido retirado da fila.';
    panelSoon();
  } catch (err) {
    if (lostSession(err)) return;
    const { code } = T.errorInfo(err);
    toast(code === 'estado_invalido' ? 'Este pedido não está mais esperando.' : T.errorText(code));
  } finally {
    btn.disabled = false;
    await loadQueue();
    $('#dutyTitle').focus();
  }
}
async function resumeConsult(id) {
  if (S.c) return;
  let rows;
  try { rows = await A.rpc('tele_doctor_status', { p_id: id }); } catch (err) { lostSession(err); return; }
  const st = Array.isArray(rows) ? rows[0] : null;
  if (!st || S.c) return;
  await openConsult(st, ['accepted', 'in_call'].includes(st.status) ? 'live' : 'ended');
  toast('Você voltou para a consulta em andamento.');
}

/* ======================= consulta ======================= */
// Com a aba escondida (por exemplo, emitindo o pedido assinado em outra aba), a consulta continua sendo
// acompanhada: resposta do paciente, reconexão e mensagens não esperam o médico voltar.
const consultPoll = T.createPoller({ run: pollConsult, interval: 3000, hiddenInterval: 4000 });
async function openConsult(row, mode) {
  S.c = { id: row.id, status: row.status || 'accepted', data: row };
  S.mode = mode;
  S.msgs = []; S.lastMsg = 0; S.shownMsg = 0; S.version = 0; S.applied = null; S.connected = false; S.flow = null;
  S.exams = []; S.sent = '[]'; S.sentInd = '';
  $('#dutyCard').hidden = true; $('#histCard').hidden = true; $('#adminCard').hidden = true; $('#signCard').hidden = true;
  $('#meCard').hidden = true; $('#regCard').hidden = true;
  syncPanel(); // na consulta, o painel some e para de atualizar (o vídeo fica no alto)
  $('#cRecord').hidden = false; $('#cExams').hidden = false;
  $('#consult').hidden = false;
  document.body.dataset.view = 'consult';
  $('#cTitle').textContent = mode === 'live' ? `Consulta com ${row.patient_name}` : `Complementar a consulta de ${row.patient_name}`;
  renderPatient(row);
  $('#exSearch').value = ''; filterCatalog('');
  $('#exInd').value = ''; $('#cGuide').value = ''; $('#cNotes').value = '';
  $('#exMsg').textContent = ''; $('#cEndErr').classList.remove('show'); $('#cEndConfirm').hidden = true;
  $('#cExNote').hidden = true; $('#cSeen').textContent = '';
  renderChosen(); renderMsgs(true);
  setLive(mode === 'live');
  docsOpen(row);
  wsAbrir(row);
  $('#cTitle').focus();
  // Dados atuais (exames, orientações, situação).
  try {
    const rows = await A.rpc('tele_doctor_status', { p_id: row.id });
    const st = Array.isArray(rows) ? rows[0] : null;
    if (st && S.c?.id === row.id) {
      S.c.data = { ...row, ...st };
      S.c.status = st.status;
      renderPatient(S.c.data);
      loadExams(st.exams, st.indication);
      $('#cGuide').value = st.guidance || '';
      if (mode === 'ended') showOldNotes(st.notes);
      if (mode === 'ended' && (st.status === 'expired' || st.status === 'cancelled')) {
        // Aceita e depois expirou ou cancelou: o registro é o primeiro (não um adendo); os exames vão junto.
        S.mode = 'closed';
        $('#cNotesLbl').textContent = 'Registro da consulta (prontuário)';
        $('#cEnd span').textContent = 'Registrar e encerrar';
        $('#cOldNotes').hidden = true;
        $('#cExNote').hidden = false;
        $('#cTitle').textContent = `Registrar a consulta de ${st.patient_name}`;
        setState(st.status === 'expired'
          ? 'A consulta expirou sem vídeo. Registre o atendimento (por telefone ou mensagem) até 24 horas depois do aceite.'
          : 'O paciente desistiu da consulta. Se vocês chegaram a conversar, registre o atendimento até 24 horas depois do aceite.');
      } else if (mode === 'ended' && !st.notes) {
        $('#cNotesLbl').textContent = 'Registro da consulta (prontuário)';
      }
      docsSync();
    }
  } catch (err) { if (lostSession(err)) return; }
  consultPoll.stop();
  if (mode === 'live') { consultPoll.start(); startVideo(); } else pollMessages();
}
function setLive(live) {
  $('#cVideoCard').hidden = !live;
  $('#cChatForm').hidden = !live;
  $('#cPlanB').hidden = true;
  $('#cBack').hidden = live;
  $('#cNotesLbl').textContent = live ? 'Registro da consulta (prontuário)' : 'Adendo ao registro (entra no fim, com data e hora)';
  $('#cEnd span').textContent = live ? 'Encerrar consulta' : 'Salvar complemento';
  $('#cOldNotes').hidden = live;
  $('#cPhoneNote').hidden = !live;
  setState(live ? 'Preparando o vídeo…' : 'Consulta encerrada. Você pode complementar até 24 horas depois do encerramento.');
}
function showOldNotes(notes) {
  const box = $('#cOldNotes');
  box.hidden = false;
  box.innerHTML = `<h4>Registro já salvo</h4>${notes ? `<p class="tl-pre">${esc(notes)}</p>` : '<p class="tl-muted">Sem registro.</p>'}`;
}
function renderPatient(r) {
  const limited = r.access === 'limited';
  const tel = limited ? null : T.telHref(r.patient_phone);
  const phone = T.fmtPhone(r.patient_phone);
  const age = r.age_years ?? T.ageOn(r.patient_birthdate, T.todaySP());
  const rows = [
    ['Nome', esc(r.patient_name)],
    ['Nascimento', `${esc(T.fmtDate(r.patient_birthdate))}${age != null ? ` (${esc(T.ageLabel(age))})` : ''}`],
    ['Celular', limited ? 'Oculto: o seu cadastro não está aprovado agora' : tel ? `<a class="link" href="${esc(tel)}" data-call>${esc(phone)}</a>` : esc(phone || 'Não informado')],
    ['Motivo', `<span class="tl-pre">${esc(r.reason)}</span>`],
  ];
  if (r.for_other) {
    rows.push(['Pedido por', `${esc(r.requester_name || '')}${r.relationship ? ` (${esc(r.relationship)})` : ''}`]);
    if (age != null && age < 18) rows.push(['Responsável', r.guardian_consent ? 'Declarou ser o responsável legal e estar presente' : 'Sem declaração do responsável']);
    else if (r.patient_agrees != null) rows.push(['Concordância', r.patient_agrees ? 'Quem pediu declarou que o paciente está presente e concorda (ou que é o representante legal). Confirme com o paciente.' : 'Sem declaração de quem pediu: confirme com o paciente se ele concorda.']);
  }
  if (r.consent_version) rows.push(['Termo (TCLE)', `Versão ${esc(r.consent_version)}${r.consent_at ? `, aceito em ${esc(T.fmtDateTime(r.consent_at))}` : ''}`]);
  if (r.created_at) rows.push(['Pedido', esc(T.fmtDateTime(r.created_at))]);
  $('#cPatBox').innerHTML = `<dl class="md-dl">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${tel ? `<a class="btn btn-ghost btn-sm" href="${esc(tel)}" data-call><i class="fa-solid fa-phone" aria-hidden="true"></i>Ligar para ${esc(phone)}</a>` : ''}
    <p class="tl-small">Confirme o nome e a data de nascimento no início da chamada e, se possível, peça um documento com foto na câmera (sem gravar).</p>`;
  const call = $('#cCallBtn');
  if (tel) { call.href = tel; call.querySelector('span').textContent = `Ligar para ${phone}`; call.hidden = false; } else call.hidden = true;
}
function setState(t) { const el = $('#cState'); if (el.textContent !== t) el.textContent = t; }
// A página do paciente está aberta? Ajuda a decidir entre esperar o vídeo e ligar.
function renderSeen(st) {
  const el = $('#cSeen');
  const live = S.mode === 'live' && ['accepted', 'in_call'].includes(st.status);
  const t = live && !S.connected ? T.seenText(st.patient_seen_seconds).text : '';
  if (el.textContent !== t) el.textContent = t;
}
async function pollConsult() {
  if (!S.c) { consultPoll.stop(); return; }
  const id = S.c.id;
  let rows;
  try { rows = await A.rpc('tele_doctor_status', { p_id: id }); } catch (err) { lostSession(err); return; }
  if (!S.c || S.c.id !== id) return;
  const st = Array.isArray(rows) ? rows[0] : null;
  if (!st) { closeConsult(); toast('A consulta não está mais disponível.'); backToQueue(); return; }
  const prev = S.c.status;
  const prevStarted = S.c.data?.started_at || null;
  S.c.status = st.status;
  S.c.data = { ...S.c.data, ...st };
  if (prev !== st.status || prevStarted !== (st.started_at || null)) docsSync();
  refreshPatientSoon();
  if (S.mode === 'live') {
    renderSeen(st);
    if (st.status === 'accepted' || st.status === 'in_call') {
      // Outra aba deste aparelho estava com o vídeo e foi fechada: esta assume sozinha.
      if (S.lockId !== S.c.id && !S.offering) {
        const ok = await claimConsult(S.c.id);
        if (ok && S.c?.id === id && S.mode === 'live') startVideo();
      } else if (!S.offering && S.peer && S.version && Number(st.answer_version) === S.version && st.answer_sdp) {
        // Enquanto prepara uma oferta nova (S.offering), nenhuma resposta é aplicada: ela seria da oferta antiga.
        if (!S.applied) await applyAnswer(st.answer_sdp);
        else if (st.answer_sdp !== S.applied && !S.loopBlocked) {
          // O paciente recarregou a página ou voltou ao vídeo: respondeu de novo à mesma oferta. Nova conexão,
          // no máximo 3 vezes por minuto (depois, só pelo botão "Tentar o vídeo de novo").
          reconnect('O paciente voltou. Reconectando o vídeo…');
        }
      }
    } else if (prev !== st.status) {
      onClosedRemotely(st);
    }
  }
  await pollMessages();
}
function onClosedRemotely(st) {
  stopVideo();
  consultPoll.stop();
  $('#cVideoCard').hidden = true;
  $('#cChatForm').hidden = true;
  $('#cPhoneNote').hidden = true;
  $('#cBack').hidden = false;
  if (st.status === 'cancelled') {
    S.mode = 'closed';
    $('#cEnd span').textContent = 'Registrar e encerrar';
    $('#cExNote').hidden = false;
    setState('O paciente desistiu da consulta antes de começar. Se vocês chegaram a conversar, registre o atendimento (até 24 horas); se não, volte para a fila.');
    flash('O paciente desistiu da consulta antes de começar.', 'warn');
  } else if (st.status === 'expired') {
    // Expirou (o atendimento não começou em 30 min): o registro e os exames escolhidos ainda vão (até 24 h).
    S.mode = 'closed';
    $('#cEnd span').textContent = 'Registrar e encerrar';
    $('#cExNote').hidden = false;
    setState('A consulta expirou porque o atendimento não começou em 30 minutos. Registre o que houve e encerre: os exames escolhidos vão junto.');
  } else if (st.status === 'ended') {
    S.mode = 'ended';
    setLive(false);
    showOldNotes(st.notes);
    if (!st.notes) $('#cNotesLbl').textContent = 'Registro da consulta (prontuário)';
    if (st.closed_by === 'patient') {
      setState('O paciente encerrou a consulta. Registre o atendimento e, se precisar, mande orientações e exames (até 24 horas).');
      flash('O paciente encerrou a consulta.', 'warn');
      notify('O paciente encerrou a consulta.');
    } else {
      setState('A consulta foi encerrada automaticamente (mais de 3 horas). Você pode complementar até 24 horas.');
    }
  }
}
function backToQueue() {
  $('#consult').hidden = true;
  $('#cRecord').hidden = false; $('#cExams').hidden = false;
  syncPanel(); // o painel volta com os números de antes e pede os de agora na hora
  $('#meCard').hidden = !S.me;
  if (S.me?.status === 'approved' && S.duty) { $('#dutyCard').hidden = false; S.queueSig = ''; loadQueue(); }
  if (S.me) { $('#histCard').hidden = false; loadHistory(); loadUnsigned(); }
  if (S.admin) { $('#adminCard').hidden = false; loadAdmin(); }
  $(S.duty ? '#dutyTitle' : '#meTitle')?.focus();
}
function closeConsult(silent = false) {
  consultPoll.stop();
  stopVideo();
  S.c = null;
  delete document.body.dataset.view;
  S.msgs = []; S.lastMsg = 0; S.shownMsg = 0; S.exams = [];
  $('#cPatBox').innerHTML = ''; $('#cMsgs').innerHTML = ''; $('#cNotes').value = ''; $('#cGuide').value = ''; $('#exInd').value = '';
  $('#cOldNotes').innerHTML = '';
  docsClose();
  wsFechar();
  removeEventListener('beforeunload', warnUnsaved);
  if (!silent) { S.queueSig = ''; renderQueue(); }
}
function warnUnsaved(e) { e.preventDefault(); e.returnValue = ''; }
// Plano B: ligar ou continuar por mensagem conta como início do atendimento (a consulta não expira em 30 min e o
// paciente vê que o médico está ligando).
async function markStarted(phone) {
  if (!S.c || S.mode !== 'live' || !['accepted', 'in_call'].includes(S.c.status)) return;
  try {
    const at = await A.rpc('tele_mark_started', { p_id: S.c.id, p_phone: !!phone });
    if (S.c?.data && at && !S.c.data.started_at) { S.c.data.started_at = at; docsSync(); }
  } catch (err) { lostSession(err); }
}

/* ======================= vídeo ======================= */
function mediaHelp(e) {
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return 'O navegador bloqueou a câmera e o microfone. Libere no cadeado ao lado do endereço do site e toque em “Tentar o vídeo de novo”. Enquanto isso, ligue para o paciente.';
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'Não encontramos câmera nem microfone neste aparelho. Ligue para o paciente.';
  if (e?.name === 'NotReadableError') return 'A câmera ou o microfone estão em uso por outro programa (Zoom, Teams, WhatsApp). Feche-o e toque em “Tentar o vídeo de novo”.';
  return 'Não foi possível ligar a câmera e o microfone. Toque em “Tentar o vídeo de novo” ou ligue para o paciente.';
}
let mediaPromise = null;
function ensureMedia() {
  if (S.mediaTried) return mediaPromise || Promise.resolve(S.local);
  S.mediaTried = true;
  mediaPromise = (async () => {
    const md = navigator.mediaDevices;
    let note = '';
    if (!md?.getUserMedia) note = 'Este navegador não libera câmera e microfone.';
    else {
      try { S.local = await md.getUserMedia({ audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 } } }); } catch (e1) {
        try { S.local = await md.getUserMedia({ audio: true }); note = 'Sem câmera: o paciente vai ouvir você, mas não vai ver.'; } catch { S.local = null; note = mediaHelp(e1); }
      }
    }
    // A consulta acabou enquanto o navegador pedia a câmera: desliga na hora.
    if (!S.c || S.mode !== 'live') { const st = S.local; S.local = null; S.mediaTried = false; st?.getTracks().forEach((t) => t.stop()); return null; }
    renderMedia(note);
    return S.local;
  })();
  return mediaPromise;
}
function forgetMedia() {
  S.local?.getTracks().forEach((t) => t.stop());
  S.local = null; S.mediaTried = false; mediaPromise = null;
  $('#cLocal').srcObject = null;
}
async function renderMedia(note) {
  const lv = $('#cLocal');
  lv.srcObject = S.local;
  lv.hidden = !S.local?.getVideoTracks().length;
  if (S.local) lv.play?.().catch(() => {});
  $('#cMedia').textContent = note || '';
  $('#cMedia').hidden = !note;
  $('#cMic').disabled = !S.local?.getAudioTracks().length;
  $('#cCam').disabled = !S.local?.getVideoTracks().length;
  setToggle('#cMic', true, 'Desligar microfone', 'Ligar microfone', 'fa-microphone', 'fa-microphone-slash');
  setToggle('#cCam', true, 'Desligar câmera', 'Ligar câmera', 'fa-video', 'fa-video-slash');
  let cams = 0;
  try { cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length; } catch { cams = 0; }
  $('#cFlip').hidden = !(S.local?.getVideoTracks().length && cams > 1);
}
// Só uma aba (ou janela) deste aparelho cuida do vídeo da consulta (Web Locks; sem suporte, segue normalmente).
let lockRelease = null;
let lockPending = null;
function claimConsult(id) {
  if (S.lockId === id) return Promise.resolve(true);
  if (lockPending) return lockPending;
  if (!navigator.locks?.request) { S.lockId = id; return Promise.resolve(true); }
  lockPending = new Promise((resolve) => {
    navigator.locks.request(`imed_medico_${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return undefined; }
      resolve(true);
      return new Promise((r) => { lockRelease = r; });
    }).catch(() => resolve(true));
  }).then((ok) => {
    lockPending = null;
    if (S.c?.id !== id) { if (ok) { lockRelease?.(); lockRelease = null; } return false; }
    if (ok) S.lockId = id;
    return ok;
  });
  return lockPending;
}
function releaseConsult() { lockRelease?.(); lockRelease = null; S.lockId = null; }
function setRetryBusy(busy) { for (const b of [$('#cRetry'), $('#cRetry2')]) b.disabled = busy; }
async function startVideo({ manual = false } = {}) {
  if (!S.c || S.mode !== 'live' || S.offering) return;
  if (manual) {
    S.reoffers = []; S.loopBlocked = false;
    // Liberou a câmera no cadeado ou fechou o programa que a usava: pede de novo o que falta.
    if (!S.local?.getAudioTracks().length || !S.local?.getVideoTracks().length) forgetMedia();
  }
  S.offering = true;
  setRetryBusy(true);
  const id = S.c.id;
  try {
    if (!(await claimConsult(id))) {
      $('#cStage').hidden = true; $('#cCtrls').hidden = true;
      setState('Esta consulta está aberta em outra aba ou janela deste aparelho. Continue por lá. Se você fechou a outra aba, esta assume sozinha em alguns segundos.');
      return;
    }
    $('#cStage').hidden = false; $('#cCtrls').hidden = false;
    $('#cPlanB').hidden = true;
    stageMsg('Aguardando o paciente entrar no vídeo…');
    setState('Preparando o vídeo…');
    // Esquece a oferta antiga ANTES de trocar a conexão: uma resposta atrasada a ela não pode cair na nova.
    S.version = 0; S.applied = null; S.connected = false; S.flow = null;
    await ensureMedia();
    closePeer();
    let peer;
    let sdp;
    try {
      peer = T.createPeer({ iceServers: ICE, gatherMs: GATHER_MS, onTrack: onRemote, onState: (s) => onPeer(peer, s) });
      S.peer = peer;
      sdp = await peer.offer(S.local);
    } catch {
      closePeer();
      showPlanB('Este navegador não conseguiu preparar o vídeo.');
      return;
    }
    if (S.peer !== peer || !S.c || S.c.id !== id) return;
    const v = await A.rpc('tele_offer', { p_id: id, p_sdp: sdp });
    if (S.peer !== peer) return;
    S.version = Number(v) || 0;
    S.applied = null;
    S.connected = false;
    setState('Chamando o paciente para o vídeo…');
    armPlanB();
    consultPoll.setInterval(1500);
    consultPoll.now();
  } catch (err) {
    if (lostSession(err)) return;
    const { code } = T.errorInfo(err);
    closePeer();
    if (code === 'estado_invalido' || code === 'nao_encontrado') consultPoll.now();
    else showPlanB(T.errorText(code));
  } finally {
    S.offering = false;
    setRetryBusy(false);
  }
}
// Nova oferta sem o médico precisar tocar em nada (o paciente voltou, ou a conexão caiu), no máximo 3 por minuto.
function reconnect(text) {
  if (!S.c || S.mode !== 'live' || S.offering || S.loopBlocked) return;
  const now = Date.now();
  S.reoffers = (S.reoffers || []).filter((t) => now - t < 60000);
  if (S.reoffers.length >= 3) {
    S.loopBlocked = true;
    showPlanB('O vídeo recomeçou várias vezes. Ligue para o paciente ou toque em “Tentar o vídeo de novo”.');
    return;
  }
  S.reoffers.push(now);
  setState(text);
  startVideo();
}
async function applyAnswer(sdp) {
  const peer = S.peer;
  // Só aplica numa conexão que está esperando resposta (uma resposta de outra oferta derrubaria a conexão nova).
  if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
  try {
    await peer.applyAnswer(sdp);
    if (S.peer !== peer) return;
    S.applied = sdp;
    S.flow = peer.flow();
    setState('Conectando ao paciente…');
  } catch {
    if (S.peer !== peer) return;
    S.applied = sdp;
    showPlanB('Não foi possível conectar o vídeo.');
  }
}
function armPlanB() {
  clearTimeout(S.planBTimer);
  S.planBTimer = setTimeout(() => { if (!S.connected && S.c && S.mode === 'live') showPlanB(); }, PLAN_B_MS);
}
const PLANB_LEAD = '<b>O vídeo não conectou.</b> Ligue para o paciente ou continue pelas mensagens. O paciente foi avisado de que você pode ligar.';
function showPlanB(reason, lead = PLANB_LEAD) {
  $('#cPlanBLead').innerHTML = lead;
  $('#cPlanB').hidden = false;
  setState(reason || 'O vídeo não conectou. Ligue para o paciente ou use as mensagens.');
  consultPoll.setInterval(3000);
}
function stageMsg(t) { $('#cStageText').textContent = t; $('#cStageMsg').hidden = !t; }
// Conectou: confere o que o paciente manda de fato. Sem microfone (bloqueado no aparelho dele), a conexão "sobe",
// mas o médico não ouve nada: abre o plano B.
function onConnected() {
  const f = S.flow;
  if (f?.known && !f.recvAudio) {
    const lead = f.recvVideo
      ? '<b>O paciente está sem microfone.</b> Você vê, mas não ouve: o microfone está bloqueado ou desligado no aparelho dele. Ligue para ele ou escreva nas mensagens.'
      : '<b>O paciente está sem microfone e câmera</b> (bloqueados no aparelho dele). Ligue para ele ou escreva nas mensagens.';
    showPlanB(f.recvVideo ? 'O paciente está sem microfone: ligue para ele.' : 'O paciente está sem microfone e câmera: ligue para ele.', lead);
    return;
  }
  $('#cPlanB').hidden = true;
  if (f?.known && !f.sendAudio) setState('Conectado, mas o paciente não ouve você: o seu microfone está bloqueado ou desligado. Libere no cadeado e toque em “Tentar o vídeo de novo”.');
  else if (f?.known && !f.recvVideo) setState('Conectado só com áudio: o paciente está sem câmera.');
  else setState('Vídeo conectado.');
}
function onPeer(peer, s) {
  if (!peer || peer !== S.peer) return;
  if (s === 'connected') {
    S.connected = true;
    clearTimeout(S.planBTimer); clearTimeout(S.dropTimer);
    stageMsg('');
    $('#cSeen').textContent = '';
    onConnected();
    consultPoll.setInterval(4000);
  } else if (s === 'connecting') {
    setState('Conectando ao paciente…');
  } else if (s === 'disconnected') {
    S.connected = false;
    setState('A conexão do vídeo caiu. Tentando reconectar…');
    clearTimeout(S.dropTimer);
    S.dropTimer = setTimeout(() => { if (!S.connected && S.peer === peer) { stageMsg('O vídeo caiu.'); reconnect('O vídeo caiu. Reconectando…'); } }, 8000);
    consultPoll.setInterval(1500);
  } else if (s === 'failed') {
    S.connected = false;
    stageMsg('O vídeo caiu.');
    reconnect('O vídeo caiu. Reconectando…');
  }
}
function onRemote(stream) {
  const v = $('#cRemote');
  if (!stream) return;
  if (v.srcObject !== stream) v.srcObject = stream;
  if (v.paused) v.play().catch((e) => { if (e?.name === 'NotAllowedError') $('#cUnmute').hidden = false; });
}
function closePeer() {
  if (S.peer) { S.peer.close(); S.peer = null; }
  const v = $('#cRemote');
  if (v.srcObject) v.srcObject = null;
}
function stopVideo() {
  clearTimeout(S.planBTimer); clearTimeout(S.dropTimer);
  releaseConsult();
  S.reoffers = []; S.loopBlocked = false;
  closePeer();
  forgetMedia();
  S.connected = false; S.version = 0; S.applied = null; S.flow = null;
}
function setToggle(sel, on, onText, offText, onIcon, offIcon) {
  const b = $(sel);
  b.classList.toggle('off', !on);
  b.querySelector('span').textContent = on ? onText : offText;
  b.querySelector('i').className = `fa-solid ${on ? onIcon : offIcon}`;
}
function toggleTrack(kind) {
  const tracks = S.local?.getTracks().filter((t) => t.kind === kind) || [];
  if (!tracks.length) return;
  const on = !tracks[0].enabled;
  tracks.forEach((t) => { t.enabled = on; });
  if (kind === 'audio') setToggle('#cMic', on, 'Desligar microfone', 'Ligar microfone', 'fa-microphone', 'fa-microphone-slash');
  else setToggle('#cCam', on, 'Desligar câmera', 'Ligar câmera', 'fa-video', 'fa-video-slash');
}
async function flipCamera() {
  const md = navigator.mediaDevices;
  if (!S.local || !md || S.flipping) return;
  S.flipping = true;
  $('#cFlip').disabled = true;
  try {
    const cams = (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (cams.length < 2) return;
    const cur = S.local.getVideoTracks()[0];
    const curId = cur?.getSettings?.().deviceId;
    const next = cams[(cams.findIndex((d) => d.deviceId === curId) + 1) % cams.length];
    cur?.stop();
    let track = null;
    try { track = (await md.getUserMedia({ video: { deviceId: { exact: next.deviceId } } })).getVideoTracks()[0]; } catch {
      try { track = (await md.getUserMedia({ video: true })).getVideoTracks()[0]; } catch { track = null; }
    }
    if (!S.local) { track?.stop(); return; }
    if (cur) S.local.removeTrack(cur);
    if (!track) { toast('Não foi possível trocar a câmera.'); return; }
    S.local.addTrack(track);
    try { await S.peer?.replaceVideo(track); } catch { /* a próxima conexão usa a câmera nova */ }
    $('#cLocal').srcObject = S.local;
  } finally {
    S.flipping = false;
    $('#cFlip').disabled = false;
  }
}

/* ======================= mensagens ======================= */
async function pollMessages() {
  if (!S.c) return;
  const id = S.c.id;
  try {
    const rows = await A.rpc('tele_doctor_messages', { p_id: id, p_after: S.lastMsg });
    if (!S.c || S.c.id !== id) return;
    if (Array.isArray(rows) && rows.length) {
      const before = S.msgs.length;
      S.msgs = T.mergeMessages(S.msgs, rows);
      S.lastMsg = T.lastId(S.msgs);
      renderMsgs();
      if (before > 0 && S.msgs.slice(before).some((m) => m.sender === 'patient')) { toast('Nova mensagem do paciente.'); notify('Nova mensagem do paciente na teleconsulta.'); }
    }
  } catch { /* próxima consulta */ }
}
function msgHtml(m) {
  const mine = m.sender === 'doctor';
  return `<li class="tl-bub ${mine ? 'me' : 'doc'}"><span class="tl-bub-who">${mine ? 'Você' : 'Paciente'} · ${esc(T.fmtTime(m.created_at))}</span><p>${esc(m.body)}</p></li>`;
}
// A lista (role=log) recebe só as mensagens novas: o leitor de tela lê cada uma uma vez.
function renderMsgs(reset = false) {
  const list = $('#cMsgs');
  if (reset || !S.shownMsg || !S.msgs.length) {
    list.innerHTML = S.msgs.length ? S.msgs.map(msgHtml).join('') : '<li class="tl-bub-empty">Nenhuma mensagem ainda.</li>';
    S.shownMsg = T.lastId(S.msgs);
    list.scrollTop = list.scrollHeight;
    return;
  }
  const fresh = S.msgs.filter((m) => Number(m.id) > S.shownMsg);
  if (!fresh.length) return;
  const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.insertAdjacentHTML('beforeend', fresh.map(msgHtml).join(''));
  S.shownMsg = T.lastId(S.msgs);
  if (atEnd || fresh[fresh.length - 1].sender === 'doctor') list.scrollTop = list.scrollHeight;
}
function setupChat() {
  const form = $('#cChatForm');
  const text = $('#cChatText');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = text.value.trim();
    $('#cChatErr').textContent = '';
    if (!body || S.sending || !S.c) return;
    if (body.length > 1000) { $('#cChatErr').textContent = 'A mensagem pode ter até 1.000 caracteres.'; return; }
    S.sending = true;
    $('#cChatBtn').disabled = true;
    try {
      await A.rpc('tele_doctor_send', { p_id: S.c.id, p_body: body });
      text.value = '';
      await pollMessages();
    } catch (err) {
      if (lostSession(err)) return;
      const { code, details } = T.errorInfo(err);
      $('#cChatErr').textContent = code === 'estado_invalido' ? 'A consulta não está mais em andamento.' : T.errorText(code, details);
    } finally {
      S.sending = false;
      $('#cChatBtn').disabled = false;
    }
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); T.submitForm(form, $('#cChatBtn')); }
  });
}

/* ======================= exames ======================= */
function renderCatalog() {
  $('#exCatalog').innerHTML = T.CATALOG.map((g) => `<details class="md-group" data-group="${esc(g.id)}">
      <summary>${esc(g.label)} <span class="md-gcount">(${g.items.length})</span></summary>
      <ul>${g.items.map((it) => `<li data-item="${esc(it.id)}"><label class="tl-check"><input type="checkbox" data-ex="${esc(it.id)}"><span>${esc(it.name)}</span></label></li>`).join('')}</ul>
    </details>`).join('') + '<p class="tl-muted md-nohit" id="exNone" hidden>Nenhum exame encontrado. Use “Outro exame”, logo abaixo.</p>';
  $('#exOtherType').insertAdjacentHTML('beforeend', Object.entries(T.SEARCH).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join(''));
}
// Nomes do dia a dia e uma letra errada na busca de exames ("USG", "tomo", "hemogrma"): o dicionário da busca do site
// (exames-nomes.js), baixado só quando o médico usa a busca. Sem ele (ainda chegando ou sem internet), a busca de sempre.
let nomes = null, nomesP = null;
const loadNomes = () => (nomesP ||= import('./exames-nomes.js').then((m) => (nomes = m), () => { nomesP = null; return null; }));
function filterCatalog(q) {
  const query = T.fold(q);
  if (query && !nomes) loadNomes().then((m) => { if (m && T.fold($('#exSearch').value) === query) filterCatalog(q); });
  const hits = new Set(query ? T.searchCatalog(q, nomes).map((it) => it.id) : []);
  let n = 0;
  for (const g of $$('#exCatalog .md-group')) {
    let any = false;
    for (const li of $$('li[data-item]', g)) {
      const show = !query || hits.has(li.dataset.item);
      li.hidden = !show;
      if (show) any = true;
    }
    g.hidden = !any;
    if (query) g.open = any;
    if (any && query) n += $$('li[data-item]:not([hidden])', g).length;
  }
  $('#exNone').hidden = !query || n > 0;
  $('#exHits').textContent = query ? (n ? `${n} ${n === 1 ? 'exame encontrado' : 'exames encontrados'}` : 'Nenhum exame encontrado') : '';
}
function loadExams(list, indication) {
  S.exams = (Array.isArray(list) ? list : []).map((e) => ({ ...e, key: e.code && e.code !== T.OTHER_EXAM.id ? e.code : `outro:${++S.otherN}` }));
  S.sent = JSON.stringify(T.examsPayload(S.exams));
  $('#exInd').value = indication || '';
  S.sentInd = (indication || '').trim();
  syncChecks();
  renderChosen();
}
const examsDirty = () => JSON.stringify(T.examsPayload(S.exams)) !== S.sent || $('#exInd').value.trim() !== S.sentInd;
function syncChecks() {
  const keys = new Set(S.exams.map((e) => e.key));
  $$('#exCatalog input[data-ex]').forEach((i) => { i.checked = keys.has(i.dataset.ex); });
}
function renderChosen() {
  $('#exCount').textContent = String(S.exams.length);
  $('#exChosen').innerHTML = S.exams.length
    ? S.exams.map((e, i) => {
      const obs = T.catalogItem(e.code)?.obs;
      return `<li data-key="${esc(e.key)}"><div class="md-chosen-h"><b>${esc(e.name)}</b><small>${esc(e.group || '')}${e.search ? ` · busca: ${esc(T.SEARCH[e.search] || e.search)}` : ''}</small>
        <button class="md-x" type="button" data-remove="${esc(e.key)}" aria-label="Tirar ${esc(e.name)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
        <label class="sr" for="exNote${i}">Observação para ${esc(e.name)}</label>
        <input id="exNote${i}" class="md-exnote" data-note="${esc(e.key)}" maxlength="200" value="${esc(e.note || '')}" placeholder="${esc(obs ? `${obs} (opcional)` : 'Observação (opcional)')}"></li>`;
    }).join('')
    : '<li class="md-chosen-empty">Nenhum exame escolhido. Marque no catálogo acima ou escreva em “Outro exame”.</li>';
  updateExMsg();
  docsExamsChanged();
}
function updateExMsg() {
  const m = $('#exMsg');
  if (!S.c) return;
  if (examsDirty()) { m.textContent = S.sent === '[]' && !S.sentInd ? 'Ainda não enviado ao paciente.' : 'Há mudanças ainda não enviadas ao paciente.'; m.className = 'tl-msg warn'; }
}
function toggleExam(id, on) {
  if (on) {
    if (S.exams.some((e) => e.key === id)) return;
    if (S.exams.length >= 60) { toast('O pedido pode ter até 60 exames.'); syncChecks(); return; }
    const e = T.examFromCatalog(id);
    if (e) S.exams.push({ ...e, key: id });
  } else {
    S.exams = S.exams.filter((e) => e.key !== id);
  }
  renderChosen();
}
async function sendExams({ quiet = false } = {}) {
  if (!S.c) return false;
  const payload = T.examsPayload(S.exams);
  const ind = $('#exInd').value.trim();
  const btn = $('#exSend');
  btn.disabled = true;
  try {
    const n = await A.rpc('tele_set_exams', { p_id: S.c.id, p_exams: payload, p_indication: ind || null });
    S.sent = JSON.stringify(payload);
    S.sentInd = ind;
    const m = $('#exMsg');
    m.className = 'tl-msg ok';
    m.textContent = `${Number(n) === 1 ? '1 exame enviado' : `${Number(n) || 0} exames enviados`} ao paciente às ${T.fmtTime(new Date().toISOString())}.`;
    if (!quiet) toast('Pedido de exames enviado ao paciente.');
    return true;
  } catch (err) {
    if (lostSession(err)) return false;
    const { code, details } = T.errorInfo(err);
    $('#exMsg').className = 'tl-msg err';
    $('#exMsg').textContent = code === 'estado_invalido' && S.mode === 'closed'
      ? 'Os exames vão junto quando você registrar a consulta (botão “Registrar e encerrar”).'
      : T.errorText(code, details);
    return false;
  } finally {
    btn.disabled = false;
  }
}
function setupExams() {
  renderCatalog();
  $('#exSearch').addEventListener('input', (e) => filterCatalog(e.target.value));
  $('#exSearch').addEventListener('focus', loadNomes);
  $('#exCatalog').addEventListener('change', (e) => { const i = e.target.closest('input[data-ex]'); if (i) toggleExam(i.dataset.ex, i.checked); });
  $('#exChosen').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    S.exams = S.exams.filter((x) => x.key !== b.dataset.remove);
    syncChecks();
    renderChosen();
    $('#exSearch').focus();
  });
  $('#exChosen').addEventListener('input', (e) => {
    const i = e.target.closest('[data-note]');
    if (!i) return;
    const ex = S.exams.find((x) => x.key === i.dataset.note);
    if (ex) ex.note = i.value;
    updateExMsg();
    docsExamsChanged();
  });
  $('#exInd').addEventListener('input', () => { updateExMsg(); docsExamsChanged(); });
  $('#exOtherAdd').addEventListener('click', () => {
    const name = $('#exOther').value;
    const e = T.freeExam(name, '', $('#exOtherType').value || null);
    $('#exOtherErr').textContent = '';
    if (!e) { $('#exOtherErr').textContent = 'Escreva o nome do exame.'; $('#exOther').focus(); return; }
    if (S.exams.length >= 60) { $('#exOtherErr').textContent = 'O pedido pode ter até 60 exames.'; return; }
    S.exams.push({ ...e, key: `outro:${++S.otherN}` });
    $('#exOther').value = ''; $('#exOtherType').value = '';
    renderChosen();
    toast(`${e.name}: adicionado.`);
  });
  $('#exOther').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#exOtherAdd').click(); } });
  $('#exSend').addEventListener('click', () => {
    if (!S.exams.length && S.sent === '[]') { $('#exMsg').className = 'tl-msg err'; $('#exMsg').textContent = 'Escolha pelo menos um exame.'; return; }
    sendExams();
  });
}

/* ======================= orientações, registro e encerramento ======================= */
const TEMPLATE = 'Motivo:\nHistória:\nAntecedentes e remédios em uso:\nO que foi possível observar por vídeo:\nHipóteses:\nConduta e orientações:\nExames pedidos:\nEncaminhamento (presencial, especialista ou emergência):\nModalidade: vídeo / telefone / mensagens\n';
function setupRecord() {
  $('#cTpl').addEventListener('click', () => {
    const t = $('#cNotes');
    t.value = t.value.trim() ? `${t.value.replace(/\s+$/, '')}\n\n${TEMPLATE}` : TEMPLATE;
    t.focus();
    watchUnsaved();
  });
  $('#cPhoneNote').addEventListener('click', () => {
    const t = $('#cNotes');
    const line = `A consulta continuou por telefone ou mensagem (vídeo sem conexão) às ${T.fmtTime(new Date().toISOString())}.`;
    t.value = t.value.trim() ? `${t.value.replace(/\s+$/, '')}\n${line}` : line;
    toast('Anotado no registro.');
    watchUnsaved();
    markStarted(false);
  });
  $('#cCallBtn').addEventListener('click', () => markStarted(true));
  $('#cPatBox').addEventListener('click', (e) => { if (e.target.closest('[data-call]')) markStarted(true); });
  $('#cRetry').addEventListener('click', () => startVideo({ manual: true }));
  $('#cRetry2').addEventListener('click', () => startVideo({ manual: true }));
  $('#cMic').addEventListener('click', () => toggleTrack('audio'));
  $('#cCam').addEventListener('click', () => toggleTrack('video'));
  $('#cFlip').addEventListener('click', flipCamera);
  $('#cUnmute').addEventListener('click', () => { $('#cRemote').play().catch(() => {}); });
  $('#cRemote').addEventListener('playing', () => { $('#cUnmute').hidden = true; });
  // Voltar para a fila com rascunho de documento não emitido: pergunta antes (o rascunho seria descartado).
  $('#cBack').addEventListener('click', () => {
    const drafts = docsDrafts();
    if (!drafts.length) { closeConsult(); backToQueue(); return; }
    draftWarn('#cBackDocs', drafts);
    $('#cBackConfirm').hidden = false;
    $('#cBackYes').focus();
  });
  $('#cBackNo').addEventListener('click', () => { $('#cBackConfirm').hidden = true; $('#cBack').focus(); });
  $('#cBackYes').addEventListener('click', () => { $('#cBackConfirm').hidden = true; closeConsult(); backToQueue(); });
  $('#cNotes').addEventListener('input', watchUnsaved);
  $('#cGuide').addEventListener('input', watchUnsaved);
  $('#cEnd').addEventListener('click', () => {
    $('#cEndErr').classList.remove('show');
    const drafts = docsDrafts();
    draftWarn('#cEndDocs', drafts);
    if (S.mode !== 'live' && !drafts.length) { finish(); return; }
    $('#cEndQ').textContent = S.mode === 'live' ? END_Q : 'Salvar e fechar esta consulta?';
    $('#cEndYes').textContent = S.mode === 'live' ? 'Sim, encerrar' : 'Salvar e fechar';
    $('#cEndConfirm').hidden = false;
    $('#cEndYes').focus();
  });
  $('#cEndNo').addEventListener('click', () => { $('#cEndConfirm').hidden = true; $('#cEnd').focus(); });
  $('#cEndYes').addEventListener('click', finish);
}
const END_Q = 'Encerrar a consulta? O vídeo é desligado e o paciente vê as orientações e os exames enviados. Você pode complementar em até 24 horas.';
// Abas com rascunho de documento ainda não emitido (algum campo escrito).
function docsDrafts() {
  if (!S.c || $('#dPanels').hidden) return [];
  const filled = (k) => $$(`#dP-${k} textarea, #dP-${k} input:not([type="checkbox"]):not([type="radio"]):not([type="date"])`).some((el) => el.value.trim());
  return D.KINDS.filter((k) => k.id !== 'exames' && filled(k.id));
}
function draftWarn(sel, drafts) {
  const box = $(sel);
  box.hidden = !drafts.length;
  box.innerHTML = drafts.length ? `<p><b>Há rascunho de documento ainda não emitido:</b> ${drafts.map((k) => esc(k.title)).join(', ')}. Emita antes de sair; se não, ele será descartado.</p>
    <div class="tl-row">${drafts.map((k) => `<button class="btn btn-ghost btn-sm" type="button" data-gotab="${esc(k.id)}">Ir para: ${esc(k.tab)}</button>`).join('')}</div>` : '';
}
function watchUnsaved() {
  if (S.c) { removeEventListener('beforeunload', warnUnsaved); addEventListener('beforeunload', warnUnsaved); }
}
// Encerrar (ou registrar) nunca fica preso pelos exames: com a consulta em andamento, os exames vão antes (o
// paciente vê tudo junto); se a consulta já saiu do ar (expirou, o paciente desistiu ou encerrou), o registro vai
// primeiro e os exames depois (o banco aceita até 24 h depois de encerrar).
async function finish() {
  if (!S.c) return;
  const err = $('#cEndErr');
  const notes = $('#cNotes').value;
  const guide = $('#cGuide').value;
  if (notes.length > 20000) { err.textContent = 'O registro pode ter até 20.000 caracteres.'; err.classList.add('show'); return; }
  const btns = [$('#cEndYes'), $('#cEnd')];
  btns.forEach((b) => { b.disabled = true; });
  try {
    const needExams = examsDirty() && (S.exams.length || S.sent !== '[]');
    let examsOk = !needExams;
    if (needExams && ['accepted', 'in_call'].includes(S.c.status)) examsOk = await sendExams({ quiet: true });
    await A.rpc('tele_end', { p_id: S.c.id, p_notes: notes.trim() || null, p_guidance: guide.trim() || null });
    if (!examsOk) { S.c.status = 'ended'; examsOk = await sendExams({ quiet: true }); }
    const wasLive = S.mode === 'live';
    const name = S.c.data?.patient_name || '';
    closeConsult();
    backToQueue();
    if (!examsOk) flash('O registro foi salvo, mas os exames não foram enviados. Abra a consulta em “Suas consultas anteriores” e envie de novo (até 24 horas).', 'warn');
    else flash(wasLive ? `Consulta com ${name} encerrada. O paciente já vê as orientações e os exames.` : 'Registro salvo. O paciente vê as orientações e os exames.', 'ok');
  } catch (ex) {
    if (lostSession(ex)) return;
    const { code, details } = T.errorInfo(ex);
    err.textContent = T.errorText(code, details);
    err.classList.add('show');
  } finally {
    btns.forEach((b) => { b.disabled = false; });
    $('#cEndConfirm').hidden = true;
  }
}

/* ======================= prontuário (Workspace, fase 2) ======================= */
// Módulo à parte (assets/js/ws-prontuario.js), baixado na primeira consulta aberta. Sem ele (ou sem as funções no
// banco), a consulta segue igual: o registro continua no campo "Registro da consulta".
let wsP = null;
const ws = () => (wsP ||= import('./ws-prontuario.js').catch(() => { wsP = null; return null; }));
function wsAbrir(row) {
  ws().then((m) => {
    if (m && S.c?.id === row.id) m.abrir({ id: row.id, patient: row });
    else if (!m && S.c?.id === row.id) $('#wsRegBox').innerHTML = '<p class="tl-msg warn">Não foi possível abrir o prontuário agora. O registro da consulta continua no campo “Registro da consulta”.</p>';
  });
}
function wsFechar() { if (wsP) wsP.then((m) => m?.fechar()); }

/* ======================= histórico ======================= */
async function loadHistory() {
  let rows;
  try { rows = await A.rpc('tele_history'); } catch (err) { if (lostSession(err)) return; rows = null; }
  $('#histNote').hidden = !S.me || S.me.status === 'approved';
  if (!Array.isArray(rows)) { $('#hist').innerHTML = '<li class="tl-muted">Não foi possível carregar as consultas anteriores.</li>'; $('#histCard').hidden = !!S.c; return; }
  S.hist = rows;
  for (const h of rows) S.d.ctx[h.id] = h;
  $('#histCard').hidden = !!S.c;
  $('#hist').innerHTML = rows.length ? rows.map((h) => {
    const canEdit = h.status === 'ended' && within24(h.ended_at);
    // Aceita e depois expirada ou cancelada (por exemplo, atendida só por telefone): ainda dá para registrar em 24 h.
    const canRegister = (h.status === 'expired' || h.status === 'cancelled') && within24(h.accepted_at);
    const ex = Array.isArray(h.exams) ? h.exams : [];
    const label = `${T.STATUS_DOCTOR[h.status] || h.status}${h.status === 'ended' && h.closed_by === 'patient' ? ' pelo paciente' : ''}`;
    return `<li class="md-h"><details><summary><span><b>${esc(h.patient_name)}</b> · ${esc(T.fmtDateTime(h.accepted_at || h.created_at))}</span><span class="md-hchips"><span class="tl-chip warn" data-hbadge="${esc(h.id)}" hidden></span><span class="tl-chip ${h.status === 'ended' ? 'ok' : 'err'}">${esc(label)}</span></span></summary>
      <dl class="md-dl">
        <div><dt>Nascimento</dt><dd>${esc(T.fmtDate(h.patient_birthdate))}</dd></div>
        <div><dt>Celular</dt><dd>${h.patient_phone ? esc(T.fmtPhone(h.patient_phone)) : 'Oculto'}</dd></div>
        <div><dt>Motivo</dt><dd class="tl-pre">${esc(h.reason)}</dd></div>
        ${h.for_other ? `<div><dt>Pedido por</dt><dd>${esc(h.requester_name || '')}${h.relationship ? ` (${esc(h.relationship)})` : ''}</dd></div>` : ''}
        ${h.ended_at ? `<div><dt>Encerrada</dt><dd>${esc(T.fmtDateTime(h.ended_at))}</dd></div>` : ''}
        <div><dt>Exames</dt><dd>${ex.length ? esc(ex.map((e) => e.name + (e.note ? ` (${e.note})` : '')).join('; ')) : 'Nenhum'}${Number(h.exams_version) > 1 ? ` <small>(versão ${esc(String(h.exams_version))}; as anteriores ficam guardadas)</small>` : ''}</dd></div>
        ${h.indication ? `<div><dt>Indicação</dt><dd class="tl-pre">${esc(h.indication)}</dd></div>` : ''}
        <div><dt>Orientações</dt><dd class="tl-pre">${h.guidance ? esc(h.guidance) : 'Nenhuma'}</dd></div>
        <div><dt>Registro</dt><dd class="tl-pre">${h.notes ? esc(h.notes) : 'Sem registro'}</dd></div>
      </dl>
      <div class="md-hdocs" data-hdocs="${esc(h.id)}"><h4>Documentos</h4><ol class="md-dlist" data-doclist="${esc(h.id)}" data-dkey="h"><li class="tl-small">Carregando…</li></ol></div>
      ${canEdit ? `<button class="btn btn-ghost btn-sm" type="button" data-amend="${esc(h.id)}"><i class="fa-solid fa-pen" aria-hidden="true"></i>Complementar (até 24 h)</button>` : ''}
      ${canRegister ? `<button class="btn btn-ghost btn-sm" type="button" data-amend="${esc(h.id)}"><i class="fa-solid fa-file-medical" aria-hidden="true"></i>Registrar o atendimento (até 24 h)</button>` : ''}
      </details></li>`;
  }).join('') : '<li class="tl-muted">Nenhuma consulta ainda.</li>';
  renderUnsigned();
}
function amend(id) {
  const h = S.hist.find((x) => x.id === id);
  if (!h || S.c) return;
  openConsult(h, 'ended');
}

/* ======================= equipe do IMED ======================= */
async function loadAdmin() {
  $('#adminCard').hidden = !!S.c;
  let rows;
  try { rows = await A.rpc('tele_admin_doctors'); } catch (err) {
    if (lostSession(err)) return;
    const { code } = T.errorInfo(err);
    if (code === 'so_admin') { S.admin = false; $('#adminCard').hidden = true; return; }
    $('#admin').innerHTML = `<p class="bk-err show">${esc(T.errorText(code))}</p>`;
    return;
  }
  const list = Array.isArray(rows) ? rows : [];
  const pend = list.filter((d) => d.status === 'pending').length;
  $('#admin').innerHTML = list.length
    ? `<p class="tl-small">${pend ? `${pend} ${pend === 1 ? 'cadastro esperando' : 'cadastros esperando'} análise.` : 'Nenhum cadastro esperando análise.'}</p>
      <ul class="md-admin">${list.map(adminItem).join('')}</ul>`
    : '<p class="tl-muted">Nenhum médico cadastrado ainda.</p>';
  // Vindo do painel de gestão ("Abrir na área do médico" → medico.html#adminCard): leva direto à lista, uma vez só.
  if (location.hash === '#adminCard' && !S.adminJumped && !$('#adminCard').hidden) {
    S.adminJumped = true;
    $('#adminCard').scrollIntoView({ block: 'start' });
    const t = $('#adminTitle');
    if (t) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); }
  }
}
// Última conferência ainda serve para marcar a lista? Só se os dados do médico não mudaram e ela tem até 30 dias.
const checkReusable = (lc) => !!lc && lc.missing !== 'dados' && Date.now() - new Date(lc.checked_at).getTime() < T.CHECK_VALID_DAYS * 86400e3;
function lastCheckText(lc) {
  if (!lc) return 'Ainda sem conferência.';
  const when = `Última conferência: ${T.fmtDateTime(lc.checked_at)}${lc.checked_by ? ` por ${lc.checked_by}` : ''}`;
  if (lc.missing) return `${when}. Incompleta: ${T.errorText('conferencia_incompleta', lc.missing)}`;
  return checkReusable(lc) ? `${when}. Completa.` : `${when}. Completa, mas com mais de ${T.CHECK_VALID_DAYS} dias: para aprovar, confira de novo.`;
}
function adminItem(d) {
  const [cls, label] = STATUS_TEXT[d.status] || ['tl-chip', d.status];
  const spec = T.doctorSpecialty(d);
  const acts = {
    pending: [['approved', 'Aprovar', 'btn-coral'], ['rejected', 'Recusar', 'btn-ghost']],
    approved: [['suspended', 'Suspender', 'btn-ghost'], ['rejected', 'Recusar (solta o CRM)', 'btn-ghost']],
    suspended: [['approved', 'Reativar', 'btn-coral'], ['rejected', 'Recusar (solta o CRM)', 'btn-ghost']],
    rejected: [['approved', 'Aprovar', 'btn-ghost']],
  }[d.status] || [];
  const online = d.available_until && new Date(d.available_until).getTime() > Date.now();
  const lc = d.last_check || null;
  const reuse = checkReusable(lc);
  const due = d.status === 'approved' ? T.recheckDue(d.checked_at) : null;
  const items = T.CHECK_ITEMS.filter((it) => it.group !== 'rqe' || d.rqe);
  const id = esc(d.id);
  return `<li class="md-adm" data-doc="${id}">
    <div class="md-adm-h"><div><b>${esc(d.full_name)}</b><span>${esc(T.doctorCrm(d))}${spec ? ` · ${esc(spec)}` : ''}</span></div><span class="${cls}">${esc(label)}</span></div>
    ${Number(d.crm_duplicates) > 0 ? `<p class="md-dup"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>Há ${Number(d.crm_duplicates) === 1 ? 'outro cadastro' : `${Number(d.crm_duplicates)} outros cadastros`} com o mesmo CRM/UF. Só um pode ser o médico verdadeiro: confira a identidade e recuse o outro.</p>` : ''}
    <dl class="md-dl">
      <div><dt>E-mail</dt><dd>${esc(d.email || '')}</dd></div>
      ${d.phone ? `<div><dt>Celular</dt><dd>${esc(T.fmtPhone(d.phone))} <small>(informado no cadastro)</small></dd></div>` : ''}
      <div><dt>Cadastro</dt><dd>${esc(T.fmtDateTime(d.created_at))}</dd></div>
      <div><dt>Consultas</dt><dd>${esc(String(Number(d.consultations) || 0))}${online ? ' · atendendo agora' : ''}</dd></div>
      ${d.reviewed_at ? `<div><dt>Última análise</dt><dd>${esc(T.fmtDateTime(d.reviewed_at))}${d.reviewed_by ? ` por ${esc(d.reviewed_by)}` : ''}</dd></div>` : ''}
      ${due ? `<div><dt>Conferência</dt><dd>${esc(T.fmtDateTime(d.checked_at))}; vale até ${esc(T.fmtDate(due.slice(0, 10)))}</dd></div>` : ''}
      ${d.review_note ? `<div><dt>Observação</dt><dd>${esc(d.review_note)}</dd></div>` : ''}
    </dl>
    <fieldset class="md-checks"><legend>Conferência antes de aprovar</legend>
      <p class="tl-small">1) Na <a class="link" href="${T.CFM_URL}" target="_blank" rel="noopener">busca de médicos do CFM<span class="sr"> (abre em outra aba)</span></a>, busque <b>CRM ${esc(d.crm)}/${esc(d.crm_uf)}</b>${d.rqe ? ` e confira o <b>RQE ${esc(d.rqe)}</b>` : ''}. 2) Prove a identidade: chamada de vídeo com documento oficial com foto e carteira do CRM (compare o rosto), ou documento assinado com o certificado ICP-Brasil do médico, validado em validar.iti.gov.br. Combine o contato por um canal que não veio deste cadastro (por exemplo, o telefone do consultório ou do hospital onde o médico atende). Não grave a chamada nem guarde cópia dos documentos.</p>
      ${items.map((it) => `<label class="tl-check"><input type="checkbox" data-check="${esc(it.id)}" data-for="${id}"${reuse && lc[it.id] ? ' checked' : ''}><span>${esc(it.label)}</span></label>`).join('')}
      <div class="fld"><label for="cknote-${id}">Observação interna da conferência <small class="h">(opcional, até 300 caracteres; o médico não vê)</small></label><input id="cknote-${id}" maxlength="300" data-checknote="${id}" value="${esc(reuse ? lc.note || '' : '')}"></div>
      <p class="tl-small" data-checkstatus="${id}" role="status">${esc(lastCheckText(lc))}</p>
      <div class="tl-row"><button class="btn btn-ghost btn-sm" type="button" data-savecheck="${id}">Salvar conferência<span class="sr"> de ${esc(d.full_name)}</span></button></div>
    </fieldset>
    ${acts.length ? `<div class="fld"><label for="note-${id}">Observação para o médico <small class="h">(opcional, até 300 caracteres)</small></label><input id="note-${id}" maxlength="300" data-note-for="${id}"></div>
    <div class="tl-row">${acts.map(([st, txt, c]) => `<button class="btn ${c} btn-sm" type="button" data-set="${st}" data-id="${id}">${txt}<span class="sr"> ${esc(d.full_name)}</span></button>`).join('')}</div>` : ''}
  </li>`;
}
async function saveChecks(id) {
  const box = $(`[data-doc="${CSS.escape(id)}"]`);
  if (!box) return null;
  const checks = Object.fromEntries($$('[data-check]', box).map((i) => [i.dataset.check, i.checked]));
  checks.note = $(`[data-checknote="${CSS.escape(id)}"]`, box)?.value.trim() || '';
  try {
    const r = await A.rpc('tele_admin_save_checks', { p_doctor: id, p_checks: checks });
    const st = $(`[data-checkstatus="${CSS.escape(id)}"]`, box);
    if (st) st.textContent = r === 'completa' ? `Conferência salva às ${T.fmtTime(new Date().toISOString())}: completa.` : `Conferência salva às ${T.fmtTime(new Date().toISOString())}: ainda incompleta.`;
    return r;
  } catch (err) {
    if (lostSession(err)) return null;
    const { code, details } = T.errorInfo(err);
    toast(T.errorText(code, details));
    return null;
  }
}
async function setDoctor(id, status, btn) {
  const note = $(`[data-note-for="${CSS.escape(id)}"]`)?.value || '';
  btn.disabled = true;
  try {
    // Aprovar (ou reativar) grava antes a conferência marcada na tela; o banco recusa se estiver incompleta.
    if (status === 'approved' && !(await saveChecks(id))) { btn.disabled = false; return; }
    const st = await A.rpc('tele_admin_set_doctor', { p_doctor: id, p_status: status, p_note: note.trim() || null });
    toast(`Situação do médico: ${T.DOCTOR_REVIEW[st] || st}.`);
    await loadAdmin();
    if (S.me?.id === id) loadMe();
  } catch (err) {
    if (lostSession(err)) return;
    const { code, details } = T.errorInfo(err);
    const box = $(`[data-checkstatus="${CSS.escape(id)}"]`);
    if (code === 'conferencia_incompleta' && box) box.textContent = T.errorText(code, details);
    toast(T.errorText(code, details));
    btn.disabled = false;
  }
}

/* ======================= documentos ======================= */
// Quadro "Documentos" da consulta: endereço e contato profissionais, dados do paciente (CPF ou "não possui", endereço
// e conferência de identidade, gravados no banco), uma aba por tipo (formulário + pré-visualização igual ao PDF) e a
// lista dos emitidos (gerar PDF para assinar, enviar o PDF assinado, cancelar, emitir de novo). A mesma lista aparece em
// cada consulta do histórico e, para o que falta assinar, no quadro "Falta assinar".
const DOC_EMIT = {
  exames: 'Emitir pedido de exames', receita: 'Emitir receita', atestado: 'Emitir atestado', comparecimento: 'Emitir declaração',
  encaminhamento: 'Emitir encaminhamento', relatorio: 'Emitir relatório', orientacoes: 'Emitir orientações',
};
const ownAccess = () => (S.c?.data?.access ? S.c.data.access === 'own' : S.me?.status === 'approved');
const consultNow = () => (S.c ? { ...S.c.data, status: S.c.status } : null);
function setErr(input, out, msg) {
  if (out) out.textContent = msg || '';
  if (input) { input.setAttribute('aria-invalid', msg ? 'true' : 'false'); input.closest('.fld, .consent')?.classList.toggle('bad', !!msg); }
}
function saveFile(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ---------- endereço e contato profissionais ---------- */
async function loadProfile() {
  try {
    const rows = await A.rpc('tele_doctor_profile', {});
    const row = Array.isArray(rows) ? rows[0] : rows;
    S.d.profile = { prof_address: row?.prof_address || null, prof_contact: row?.prof_contact || null };
  } catch (err) { if (lostSession(err)) return; }
  renderProfile();
}
function profFormHtml(px) {
  const p = S.d.profile || {};
  return `<div class="fld"><label for="${px}Addr">Endereço profissional <small class="h">(consultório ou residencial, com cidade/UF)</small></label><input id="${px}Addr" maxlength="200" autocomplete="street-address" value="${esc(p.prof_address || '')}" aria-describedby="${px}AddrErr"><span class="err" id="${px}AddrErr"></span></div>
    <div class="fld"><label for="${px}Contact">Telefone ou e-mail profissional</label><input id="${px}Contact" maxlength="120" value="${esc(p.prof_contact ? D.fmtContact(p.prof_contact) : '')}" aria-describedby="${px}ContactErr"><span class="err" id="${px}ContactErr"></span></div>
    <div class="tl-row"><button class="btn btn-ghost btn-sm" type="button" data-profsave="${px}">Salvar endereço e contato</button></div>
    <p class="tl-msg" id="${px}Msg" role="status"></p>`;
}
function renderProfile() {
  const p = S.d.profile;
  const done = D.profileComplete(p);
  const sum = done ? `Endereço: ${p.prof_address} · Contato: ${D.fmtContact(p.prof_contact)}` : '';
  const me = $('#meProf');
  if (me) {
    me.innerHTML = done
      ? `<p class="md-profsum">${esc(sum)}</p><button class="btn btn-ghost btn-sm" type="button" data-profedit="mp">Editar endereço e contato</button>`
      : `<p class="md-note">Falta preencher. Sem eles, não dá para emitir documentos.</p>${profFormHtml('mp')}`;
  }
  $('#dProfSum').textContent = done ? sum : 'Falta preencher. Sem eles, não dá para emitir documentos.';
  $('#dProfForm').innerHTML = done ? '<button class="btn btn-ghost btn-sm" type="button" data-profedit="dp">Editar</button>' : profFormHtml('dp');
  // "md-done" (e não "ok": perto.css tem .ok para outra tela, que centralizaria o quadro).
  $('#dProf').classList.toggle('md-done', done);
  docsPreviewSoon();
}
function editProfile(px) {
  const box = px === 'mp' ? $('#meProf') : $('#dProfForm');
  if (!box) return;
  box.innerHTML = profFormHtml(px);
  $(`#${px}Addr`).focus();
}
async function saveProfile(px, { quiet = false } = {}) {
  const addr = $(`#${px}Addr`);
  const contact = $(`#${px}Contact`);
  if (!addr || !contact) return D.profileComplete(S.d.profile);
  const r = D.checkProfile({ address: addr.value, contact: contact.value });
  setErr(addr, $(`#${px}AddrErr`), r.errors.address);
  setErr(contact, $(`#${px}ContactErr`), r.errors.contact);
  if (!r.ok) { if (!quiet) (r.errors.address ? addr : contact).focus(); return false; }
  const btn = $(`[data-profsave="${px}"]`);
  if (btn) btn.disabled = true;
  try {
    const rows = await A.rpc('tele_doctor_profile', r.args);
    const row = Array.isArray(rows) ? rows[0] : rows;
    S.d.profile = { prof_address: row?.prof_address ?? r.args.p_prof_address, prof_contact: row?.prof_contact ?? r.args.p_prof_contact };
    renderProfile();
    if (!quiet) toast('Endereço e contato profissionais salvos. Eles vão impressos nos documentos.');
    return true;
  } catch (err) {
    if (lostSession(err)) return false;
    const e = D.docError(err);
    const t = D.docErrorText(e, 'perfil');
    if (e.code === 'dados_invalidos' && e.details === 'contato') setErr(contact, $(`#${px}ContactErr`), t);
    else if (e.code === 'dados_invalidos' && e.details === 'endereco') setErr(addr, $(`#${px}AddrErr`), t);
    else { const m = $(`#${px}Msg`); if (m) { m.textContent = t; m.className = 'tl-msg err'; } }
    return false;
  } finally {
    if (btn?.isConnected) btn.disabled = false;
  }
}

/* ---------- dados do paciente ---------- */
// O banco guarda CPF, "não possui CPF", endereço/local e a hora da conferência de identidade. O paciente também pode
// mudar CPF e endereço na página dele: a tela relê a cada ~10 s (sem atrapalhar quem está digitando) e antes de emitir.
const patMsg = (text, cls = '') => { const m = $('#dPatMsg'); m.textContent = text; m.className = `tl-msg${cls ? ` ${cls}` : ''}`; };
async function loadPatientData(id, { force = false, quiet = false } = {}) {
  if (!ownAccess()) return null;
  try {
    const rows = await A.rpc('tele_doc_patient_data', { p_id: id });
    if (S.c?.id !== id) return null;
    const p = D.patientFromRow(Array.isArray(rows) ? rows[0] : rows);
    S.d.patAt = Date.now();
    applyPatient(p, { force, quiet });
    return p;
  } catch (err) { lostSession(err); return null; }
}
function refreshPatientSoon() {
  if (!S.c || $('#dPre').hidden || Date.now() - S.d.patAt < 10000) return;
  S.d.patAt = Date.now();
  loadPatientData(S.c.id);
}
// Dados do banco chegaram. O médico editando o quadro não perde o que digitou: só é avisado.
function applyPatient(p, { force = false, quiet = false } = {}) {
  const old = S.d.patient;
  const changed = !!old && !D.samePatient(old, p);
  const identityLost = !!old?.identityAt && !p.identityAt;
  const editing = !!old && (patientDirty() || $('#dPat').contains(document.activeElement));
  if (!old || force || !editing) {
    S.d.patient = p;
    fillPatient();
    if (changed && !quiet) patMsg(`O paciente atualizou os dados na página dele (${T.fmtTime(new Date().toISOString())}). Confira antes de emitir.`, 'warn');
    if (changed || identityLost) docsPreviewSoon();
  } else if (changed) {
    patMsg('O paciente também mudou o CPF ou o endereço na página dele. Confira antes de salvar.', 'warn');
  }
  if (identityLost) {
    S.d.patient = { ...S.d.patient, identityAt: null };
    $('#dIdOk').checked = false;
    if (!quiet) patMsg('O CPF mudou: confira de novo o documento com foto e o CPF e marque a conferência.', 'warn');
  }
  return changed;
}
function fillPatient() {
  const p = S.d.patient || {};
  const no = !p.cpf && !!p.noCpf;
  $('#dCpf').value = p.cpf ? D.maskCpf(p.cpf) : '';
  $('#dNoCpf').checked = no;
  $('#dCpf').disabled = no;
  $('#dAddr').value = p.address || '';
  $('#dIdOk').checked = !!p.identityAt;
  showPatErr({});
  renderPatState();
}
const readPatient = () => ({ cpf: $('#dCpf').value, noCpf: $('#dNoCpf').checked, address: $('#dAddr').value });
function patientDirty() {
  const p = S.d.patient || {};
  const v = readPatient();
  const cpf = v.noCpf ? null : (D.cpfDigits(v.cpf) || null);
  return cpf !== (p.cpf || null) || !!v.noCpf !== (!p.cpf && !!p.noCpf) || D.fixUf(v.address) !== (p.address || '');
}
function showPatErr(errors) {
  setErr($('#dCpf'), $('#dCpfErr'), errors.cpf);
  setErr($('#dAddr'), $('#dAddrErr'), errors.address);
}
function renderPatState() {
  const miss = D.patientMissing(S.d.patient);
  $('#dPat').classList.toggle('md-done', !!S.d.patient && !miss.length && !patientDirty());
}
// Salva o que está no quadro (se mudou) e, com identity, a conferência de identidade (true ou false), numa chamada só.
async function savePatient({ quiet = false, identity = null } = {}) {
  if (!S.c) return false;
  const dirty = patientDirty() || !S.d.patient;
  if (!dirty && identity === null) { renderPatState(); return true; }
  const args = { p_id: S.c.id };
  if (dirty) {
    const r = D.checkPatient(readPatient());
    showPatErr(r.errors);
    if (!r.ok) { if (!quiet) (r.errors.cpf ? $('#dCpf') : $('#dAddr')).focus(); return false; }
    Object.assign(args, r.args);
  }
  if (identity !== null) args.p_identity = identity;
  const btn = $('#dPatSave');
  btn.disabled = true;
  try {
    const rows = await A.rpc('tele_doc_patient_data', args);
    S.d.patient = D.patientFromRow(Array.isArray(rows) ? rows[0] : rows);
    S.d.patAt = Date.now();
    fillPatient();
    if (dirty) patMsg(identity ? 'Dados do paciente e conferência de identidade salvos.' : 'Dados do paciente salvos.', 'ok');
    else if (identity !== null) patMsg(identity ? 'Conferência de identidade registrada.' : 'Conferência de identidade desmarcada.', 'ok');
    docsPreviewSoon();
    return true;
  } catch (err) {
    if (lostSession(err)) return false;
    const e = D.docError(err);
    if (e.code === 'dados_invalidos' && e.details === 'cpf') showPatErr({ cpf: D.docErrorText(e, 'paciente') });
    else if (e.code === 'dados_invalidos' && e.details === 'endereco') showPatErr({ address: D.docErrorText(e, 'paciente') });
    else patMsg(D.docErrorText(e, 'emitir'), 'err');
    if (['atendimento_nao_iniciado', 'estado_invalido', 'prazo_encerrado'].includes(e.code)) consultPoll.now();
    return false;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- abas e formulários ---------- */
function fld(kind, key, id, label, input, hint = '') {
  return `<div class="fld"><label for="${id}">${label}</label>${input}${hint}<span class="err" id="${id}Err" data-ferr="${kind}:${key}"></span></div>`;
}
const ta = (kind, key, id, max, rows, extra = '') => `<textarea id="${id}" rows="${rows}" maxlength="${max}" data-fkey="${kind}:${key}" aria-describedby="${extra ? `${id}H ` : ''}${id}Err"></textarea>`;
const inp = (kind, key, id, max, attrs = '') => `<input id="${id}" maxlength="${max}" data-fkey="${kind}:${key}" aria-describedby="${id}Err" ${attrs}>`;
const consent = (kind, key, id, text) => `<label class="consent"><input type="checkbox" id="${id}" data-fkey="${kind}:${key}" aria-describedby="${id}Err"><span>${text}</span></label><span class="err tl-err-c" id="${id}Err" data-ferr="${kind}:${key}"></span>`;
const OPT = ' <small class="h">(opcional)</small>';
// CID do atestado e do relatório: só a pedido e com a autorização expressa do paciente (Res. CFM 2.381/2024).
const cidBlock = (k, px, what) => `<label class="tl-check"><input type="checkbox" id="${px}CidOn"><span>Incluir o CID (só a pedido do paciente)</span></label>
      <div class="md-cid" id="${px}CidBox" hidden>
        <p class="tl-small">Res. CFM 2.381/2024: o CID só entra por dever legal, por justa causa ou a pedido do paciente. Aqui, só a pedido e com a autorização expressa do paciente (ou do responsável legal), que fica escrita no ${what}.</p>
        ${fld(k, 'cid', `${px}Cid`, 'CID-10', inp(k, 'cid', `${px}Cid`, 8, `autocomplete="off" placeholder="Ex.: ${k === 'relatorio' ? 'F41.1' : 'J11'}"`))}
        ${consent(k, 'cidAutorizado', `${px}CidOk`, 'O(a) paciente (ou o responsável legal) pediu e autorizou expressamente incluir o CID.')}
      </div>`;
function panelHtml(k) {
  let body = '';
  if (k === 'exames') {
    body = `<p class="tl-small">Usa a lista e a indicação clínica do quadro “Pedido de exames” (acima). Se a lista mudou e ainda não foi enviada, ela vai ao paciente junto.</p>
      <div class="md-dexsum" id="dExSum"></div><span class="err" data-ferr="exames:itens"></span><span class="err" data-ferr="exames:indicacao"></span>`;
  } else if (k === 'receita') {
    body = `<fieldset class="fld md-rxtipo" aria-describedby="dRxTipoErr"><legend>Tipo de receita</legend>
        ${D.RECEITA_TIPOS.map((t, i) => `<label class="tl-check"><input type="radio" name="dRxTipo" value="${esc(t.id)}"${i === 0 ? ' checked' : ''}${i === 0 ? ` data-fkey="receita:tipo"` : ''}><span>${esc(t.label)}</span></label>`).join('')}
        <span class="err" id="dRxTipoErr" data-ferr="receita:tipo"></span></fieldset>
      <div class="md-block" id="dRxBlock" role="alert" hidden><p id="dRxBlockText"></p>
        <a class="btn btn-primary btn-sm" href="${esc(D.CFM_PRESCRICAO_URL)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>Abrir a Plataforma de Prescrição Eletrônica do CFM<span class="sr"> (abre em outra aba)</span></a>
        <p class="tl-small">Depois, registre no prontuário o que foi prescrito e combine com o paciente como ele vai receber a receita.</p></div>
      <div id="dRxBody">
        <div id="dRxItems"></div><span class="err" data-ferr="receita:itens"></span>
        <div class="tl-row"><button class="btn btn-ghost btn-sm" type="button" id="dRxAdd"><i class="fa-solid fa-plus" aria-hidden="true"></i>Adicionar medicamento</button></div>
        ${fld(k, 'observacao', 'dRxObs', `Observações gerais${OPT}`, ta(k, 'observacao', 'dRxObs', 500, 2))}
        <div class="md-block md-rxalert" id="dRxAlert" hidden><p>${esc(D.BLOCK_TEXT.sncr)}</p>
          <a class="btn btn-primary btn-sm" href="${esc(D.CFM_PRESCRICAO_URL)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>Abrir a Plataforma de Prescrição Eletrônica do CFM<span class="sr"> (abre em outra aba)</span></a>
          ${consent(k, 'confirmaAlerta', 'dRxAlertOk', 'Conferi os itens com aviso: não são antibiótico, caneta GLP-1 nem remédio controlado que fique retido na farmácia (por exemplo, uso tópico).')}</div>
        ${consent(k, 'confirmaSimples', 'dRxSimples', 'Confirmo que nenhum item é antibiótico, caneta GLP-1, remédio controlado (Portaria 344) ou de notificação.')}
        ${consent(k, 'confirmaEndereco', 'dRxEnd', 'O endereço do paciente (acima) é o residencial completo, com rua e número, como a lei exige na receita.')}
        <p class="tl-small">Escreva o modo de usar por extenso, sem abreviações (Lei 5.991/1973, art. 35).</p>
      </div>`;
  } else if (k === 'atestado') {
    body = `<div class="row2">
        ${fld(k, 'dias', 'dAtDias', 'Dias de afastamento', inp(k, 'dias', 'dAtDias', 3, 'type="number" inputmode="numeric" min="1" max="90" step="1"'))}
        ${fld(k, 'inicio', 'dAtIni', 'A partir de', inp(k, 'inicio', 'dAtIni', 10, 'type="date"'))}</div>
      ${cidBlock(k, 'dAt', 'atestado')}
      ${fld(k, 'observacao', 'dAtObs', `Observações${OPT}`, ta(k, 'observacao', 'dAtObs', 500, 2))}
      <p class="tl-small">Só emita com base no que avaliou. O afastamento não pode começar antes da consulta. Atestado de aptidão (ocupacional, ASO) não pode ser feito por teleconsulta.</p>`;
  } else if (k === 'comparecimento') {
    body = `<p class="md-dwhen" id="dCoWhen"></p><span class="err" data-ferr="comparecimento:horario"></span>
      ${fld(k, 'observacao', 'dCoObs', `Observação${OPT}`, ta(k, 'observacao', 'dCoObs', 300, 2))}
      <p class="tl-small">A declaração sai depois de encerrar a consulta: o dia e os horários vêm do registro (início do atendimento e encerramento) e não são digitados. Ela não recomenda afastamento: para afastar, use o atestado.</p>`;
  } else if (k === 'encaminhamento') {
    body = `${fld(k, 'especialidade', 'dEnEsp', 'Especialidade ou serviço', inp(k, 'especialidade', 'dEnEsp', 80, 'placeholder="Ex.: Cardiologia"'))}
      <fieldset class="fld"><legend>Prioridade</legend><div class="seg">
        <label><input type="radio" name="dEnPrio" value="eletiva" checked><span>Eletiva</span></label>
        <label><input type="radio" name="dEnPrio" value="prioritaria"><span>Prioritária</span></label>
        <label><input type="radio" name="dEnPrio" value="urgente"><span>Urgente</span></label></div></fieldset>
      <div id="dEnUrgBox" hidden>${consent(k, 'orientouUrgencia', 'dEnUrg', 'Orientei o paciente a procurar o pronto-socorro ou ligar 192 (SAMU) se piorar.')}</div>
      ${fld(k, 'motivo', 'dEnMot', 'Motivo e resumo do caso', ta(k, 'motivo', 'dEnMot', 2000, 4))}
      ${fld(k, 'observacao', 'dEnObs', `Observações${OPT}`, ta(k, 'observacao', 'dEnObs', 500, 2))}`;
  } else if (k === 'relatorio') {
    body = `${fld(k, 'texto', 'dReTexto', 'Relatório médico', ta(k, 'texto', 'dReTexto', 4000, 8, 'h'),
      '<small class="h" id="dReTextoH">Motivo do atendimento, o que foi relatado e observado, exames, hipótese e conduta. Diagnóstico só a pedido e com autorização do paciente: para o CID, use o campo abaixo.</small>')}
      ${cidBlock(k, 'dRe', 'relatório')}`;
  } else {
    body = `${fld(k, 'texto', 'dOrTexto', 'Orientações ao paciente', ta(k, 'texto', 'dOrTexto', 4000, 6, 'h'),
      '<small class="h" id="dOrTextoH">O documento já traz o aviso de ligar 192 ou procurar o pronto-socorro se piorar.</small>')}
      <div class="tl-row"><button class="btn btn-ghost btn-sm" type="button" id="dOrCopy">Copiar das “Orientações ao paciente” do registro</button></div>`;
  }
  return `${body}<div class="md-dfoot" data-dfoot="${k}">
      <ul class="md-dwarn" data-dwarn="${k}" hidden></ul>
      <p class="bk-err" data-derr="${k}" role="alert"></p>
      <div class="tl-row"><button class="btn btn-coral" type="button" data-demit="${k}"><i class="fa-solid fa-file-signature" aria-hidden="true"></i><span>${esc(DOC_EMIT[k])}</span></button></div>
      <details class="md-dprevbox" open><summary>Pré-visualização (igual ao PDF)</summary><div class="md-dprev" data-dprev="${k}"></div></details>
    </div>`;
}
function rxItemHtml(it, i) {
  const n = i + 1;
  const f = (key, label, { area = false, max = 60, ph = '' } = {}) => {
    const id = `dRx${n}-${key}`;
    const v = esc(it[key] || '');
    const field = area
      ? `<textarea id="${id}" rows="2" maxlength="${max}" data-rxi="${i}" data-rxf="${key}" data-fkey="receita:itens.${n}.${key}" aria-describedby="${id}Err" placeholder="${esc(ph)}">${v}</textarea>`
      : `<input id="${id}" maxlength="${max}" data-rxi="${i}" data-rxf="${key}" data-fkey="receita:itens.${n}.${key}" aria-describedby="${id}Err" value="${v}" placeholder="${esc(ph)}">`;
    return `<div class="fld"><label for="${id}">${label}</label>${field}<span class="err" id="${id}Err" data-ferr="receita:itens.${n}.${key}"></span></div>`;
  };
  return `<fieldset class="md-rxitem"><legend>Medicamento ${n}</legend>
    ${f('medicamento', 'Medicamento <small class="h">(nome genérico, de preferência)</small>', { max: 200 })}
    <div class="row2">${f('concentracao', 'Concentração', { ph: 'Ex.: 500 mg' })}${f('forma', `Forma${OPT}`, { ph: 'Ex.: comprimido' })}</div>
    <div class="row2">${f('via', 'Via', { max: 40, ph: 'Ex.: oral' })}${f('quantidade', 'Quantidade', { max: 100, ph: 'Ex.: 1 caixa com 20 comprimidos' })}</div>
    ${f('posologia', 'Modo de usar, por extenso', { area: true, max: 500, ph: 'Ex.: tomar 1 comprimido a cada 8 horas' })}
    <div class="row2">${f('duracao', 'Duração', { ph: 'Ex.: 5 dias ou uso contínuo' })}${f('observacao', `Observação${OPT}`, { max: 300 })}</div>
    ${S.d.rx.length > 1 ? `<button class="btn btn-ghost btn-sm" type="button" data-rxdel="${i}">Tirar o medicamento ${n}</button>` : ''}
  </fieldset>`;
}
function renderRx() { $('#dRxItems').innerHTML = S.d.rx.map(rxItemHtml).join(''); }
function updateRxBlock() {
  const tipo = $('input[name="dRxTipo"]:checked')?.value || 'simples';
  const block = D.receitaBlock(tipo);
  $('#dRxBlock').hidden = !block;
  $('#dRxBlockText').textContent = block ? D.BLOCK_TEXT[block] : '';
  $('#dRxBody').hidden = !!block;
  $('[data-dfoot="receita"]').hidden = !!block;
}
function selectTab(kind, focus = false) {
  if (!D.KIND[kind]) return;
  S.d.kind = kind;
  for (const b of $$('#dTabs [data-dtab]')) {
    const on = b.dataset.dtab === kind;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  for (const k of D.KINDS) $(`#dP-${k.id}`).hidden = k.id !== kind;
  if (focus) $(`#dTab-${kind}`).focus();
  renderDraft(kind);
}
function tabKeys(e) {
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  const ids = D.KINDS.map((k) => k.id);
  const i = ids.indexOf(S.d.kind);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
  selectTab(ids[next], true);
}
function readForm(kind) {
  const v = (sel) => $(sel)?.value ?? '';
  const c = (sel) => !!$(sel)?.checked;
  if (kind === 'exames') return { indicacao: v('#exInd') };
  if (kind === 'receita') return { tipo: $('input[name="dRxTipo"]:checked')?.value || 'simples', itens: S.d.rx, observacao: v('#dRxObs'), confirmaSimples: c('#dRxSimples'), confirmaEndereco: c('#dRxEnd'), confirmaAlerta: c('#dRxAlertOk') };
  if (kind === 'atestado') return { dias: v('#dAtDias'), inicio: v('#dAtIni'), cid: c('#dAtCidOn') ? v('#dAtCid') : '', cidAutorizado: c('#dAtCidOk'), observacao: v('#dAtObs') };
  if (kind === 'comparecimento') return { observacao: v('#dCoObs') };
  if (kind === 'encaminhamento') return { especialidade: v('#dEnEsp'), motivo: v('#dEnMot'), prioridade: $('input[name="dEnPrio"]:checked')?.value || 'eletiva', observacao: v('#dEnObs'), orientouUrgencia: c('#dEnUrg') };
  if (kind === 'relatorio') return { texto: v('#dReTexto'), cid: c('#dReCidOn') ? v('#dReCid') : '', cidAutorizado: c('#dReCidOk') };
  return { texto: v('#dOrTexto') };
}
const docCtx = () => ({ consult: consultNow(), exams: S.exams, indication: $('#exInd').value, address: D.fixUf($('#dAddr').value) });
// Rascunho para a pré-visualização: o que o médico está vendo no quadro (perfil, dados do paciente e formulário).
function draftDoc(kind, payload) {
  const me = S.me || {};
  const pr = S.d.profile || {};
  const c = S.c?.data || {};
  const pv = readPatient();
  const cpf = !pv.noCpf && D.isCpf(D.cpfDigits(pv.cpf)) ? D.cpfDigits(pv.cpf) : null;
  return {
    kind, payload, code: null, status: 'emitido', created_at: new Date().toISOString(), signed: false,
    doctor_snapshot: { full_name: me.full_name, crm: me.crm, crm_uf: me.crm_uf, rqe: me.rqe, specialty: me.rqe ? me.specialty : null, prof_address: pr.prof_address || '', prof_contact: pr.prof_contact || '' },
    patient_snapshot: { name: c.patient_name, birthdate: c.patient_birthdate, age: c.age_years ?? T.ageOn(c.patient_birthdate, T.todaySP()), cpf, sem_cpf: !!pv.noCpf, address: D.fixUf(pv.address),
      for_other: !!c.for_other, requester_name: c.requester_name, relationship: c.relationship, inicio_atendimento: c.started_at || null },
  };
}
function renderDraft(kind = S.d.kind) {
  if (!S.c) return;
  const box = $(`[data-dprev="${kind}"]`);
  if (!box) return;
  const ctx = docCtx();
  const f = readForm(kind);
  const v = D.validateDoc(kind, f, ctx);
  let payload = v.payload;
  if (kind === 'comparecimento') {
    const pv = ctx.preview || {};
    payload = { ...pv, observacao: v.payload?.observacao || null };
    const when = !pv.hora_inicio ? 'O atendimento ainda não começou: sem atendimento, não há declaração.'
      : !pv.hora_fim ? `Atendimento iniciado em ${T.fmtDate(pv.data)}, às ${pv.hora_inicio}. A declaração sai depois de encerrar a consulta (o fim vem do registro).`
        : pv.data_fim && pv.data_fim !== pv.data ? `Atendimento de ${T.fmtDate(pv.data)}, às ${pv.hora_inicio}, a ${T.fmtDate(pv.data_fim)}, às ${pv.hora_fim} (horário de Brasília).`
          : `Atendimento em ${T.fmtDate(pv.data)}, das ${pv.hora_inicio} às ${pv.hora_fim} (horário de Brasília).`;
    if ($('#dCoWhen').textContent !== when) $('#dCoWhen').textContent = when;
  }
  if (kind === 'exames') renderExamsSummary();
  if (kind === 'receita') {
    const alert = D.receitaBlock(f.tipo) ? false : D.rxAlerts(S.d.rx).length > 0;
    $('#dRxAlert').hidden = !alert;
  }
  const html = D.docHtml(D.docModel(draftDoc(kind, payload), { site: SITE, consult: S.c.data }));
  if (S.d.prev?.[kind] !== html) { S.d.prev = { ...(S.d.prev || {}), [kind]: html }; box.innerHTML = html; }
  const w = $(`[data-dwarn="${kind}"]`);
  const wh = v.warnings.map((t) => `<li>${esc(t)}</li>`).join('');
  if (w.innerHTML !== wh) w.innerHTML = wh;
  w.hidden = !v.warnings.length;
}
function docsPreviewSoon() {
  clearTimeout(S.d.prevTimer);
  S.d.prevTimer = setTimeout(() => { if (S.c && !$('#dPanels').hidden) renderDraft(); }, 200);
}
function renderExamsSummary() {
  const list = T.examsPayload(S.exams);
  const box = $('#dExSum');
  const ind = $('#exInd').value.trim();
  const html = list.length
    ? `<p><b>${list.length === 1 ? '1 exame' : `${list.length} exames`}:</b> ${esc(list.map((e) => e.name + (e.note ? ` (${e.note})` : '')).join('; '))}</p>${ind ? `<p><b>Indicação clínica:</b> ${esc(ind)}</p>` : ''}`
    : '<p class="tl-muted">Nenhum exame escolhido ainda.</p>';
  if (box.innerHTML !== html) box.innerHTML = html;
}
function docsExamsChanged() { if (S.c && S.d.kind === 'exames') docsPreviewSoon(); }
function showDocErrors(kind, errors) {
  for (const out of $$(`[data-ferr^="${kind}:"]`)) {
    const key = out.dataset.ferr.slice(kind.length + 1);
    const msg = errors[key] || '';
    out.textContent = msg;
    const el = $(`[data-fkey="${kind}:${key}"]`);
    if (el) setErr(el, null, msg);
  }
}
function focusFirstError(kind) {
  const out = $$(`[data-ferr^="${kind}:"]`).find((o) => o.textContent);
  if (!out) return;
  const el = $(`[data-fkey="${out.dataset.ferr}"]`);
  (el && !el.disabled && el.offsetParent !== null ? el : out).focus?.();
  if (!el) out.scrollIntoView({ block: 'center' });
}
function setAtDates() {
  const day = D.consultDay(S.c?.data) || T.todaySP();
  const ini = $('#dAtIni');
  ini.min = day;
  ini.max = D.addDays(day, 7);
  if (!ini.value || ini.value < ini.min || ini.value > ini.max) ini.value = day;
}
function resetForms(kind = null) {
  const scope = kind ? `#dP-${kind}` : '#dPanels';
  for (const el of $$(`${scope} input, ${scope} textarea`)) {
    if (el.type === 'checkbox') el.checked = false;
    else if (el.type === 'radio') el.checked = el.defaultChecked;
    else el.value = '';
  }
  if (!kind || kind === 'receita') { S.d.rx = [{}]; renderRx(); updateRxBlock(); $('#dRxAlert').hidden = true; }
  if (!kind || kind === 'atestado') { $('#dAtCidBox').hidden = true; setAtDates(); }
  if (!kind || kind === 'relatorio') $('#dReCidBox').hidden = true;
  if (!kind || kind === 'encaminhamento') $('#dEnUrgBox').hidden = true;
  for (const k of kind ? [kind] : D.KINDS.map((x) => x.id)) {
    showDocErrors(k, {});
    const e = $(`[data-derr="${k}"]`);
    e.textContent = ''; e.classList.remove('show');
  }
  S.d.prev = {};
}
function fillForm(kind, p) {
  resetForms(kind);
  if (!p) return;
  const cid = (px) => { if (p.cid) { $(`#${px}CidOn`).checked = true; $(`#${px}CidBox`).hidden = false; $(`#${px}Cid`).value = p.cid; } };
  if (kind === 'receita') {
    S.d.rx = (Array.isArray(p.itens) && p.itens.length ? p.itens : [{}]).map((it) => ({ ...it }));
    renderRx();
    $('#dRxObs').value = p.observacao || '';
  } else if (kind === 'atestado') {
    $('#dAtDias').value = p.dias ?? '';
    const ini = $('#dAtIni');
    if (p.inicio && p.inicio >= ini.min && p.inicio <= ini.max) ini.value = p.inicio;
    cid('dAt');
    $('#dAtObs').value = p.observacao || '';
  } else if (kind === 'comparecimento') {
    $('#dCoObs').value = p.observacao || '';
  } else if (kind === 'encaminhamento') {
    $('#dEnEsp').value = p.especialidade || '';
    $('#dEnMot').value = p.motivo || '';
    $('#dEnObs').value = p.observacao || '';
    const r = $(`input[name="dEnPrio"][value="${['eletiva', 'prioritaria', 'urgente'].includes(p.prioridade) ? p.prioridade : 'eletiva'}"]`);
    if (r) r.checked = true;
    $('#dEnUrgBox').hidden = p.prioridade !== 'urgente';
  } else if (kind === 'relatorio') {
    $('#dReTexto').value = p.texto || '';
    cid('dRe');
  } else if (kind === 'orientacoes') {
    $('#dOrTexto').value = p.texto || '';
  }
}
function onPanelInput(e) {
  const t = e.target;
  if (t.dataset.rxf) { const it = S.d.rx[Number(t.dataset.rxi)]; if (it) it[t.dataset.rxf] = t.value; }
  if (t.dataset.fkey && t.getAttribute('aria-invalid') === 'true') {
    const [kind, key] = [t.dataset.fkey.split(':')[0], t.dataset.fkey.slice(t.dataset.fkey.indexOf(':') + 1)];
    const out = $(`[data-ferr="${kind}:${key}"]`);
    setErr(t, out, '');
  }
  // Rascunho de documento conta como mudança não salva (aviso do navegador ao sair).
  if (t.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="date"])') && t.value.trim()) watchUnsaved();
  docsPreviewSoon();
}
function onPanelChange(e) {
  const t = e.target;
  if (t.name === 'dRxTipo') { updateRxBlock(); if (!$('#dRxBlock').hidden) $('#dRxBlock').scrollIntoView({ block: 'nearest' }); }
  for (const px of ['dAt', 'dRe']) if (t.id === `${px}CidOn`) { $(`#${px}CidBox`).hidden = !t.checked; if (t.checked) $(`#${px}Cid`).focus(); }
  if (t.name === 'dEnPrio') $('#dEnUrgBox').hidden = t.value !== 'urgente';
  onPanelInput(e);
}
function onPanelClick(e) {
  if (e.target.closest('#dRxAdd')) {
    if (S.d.rx.length >= 20) { toast('A receita pode ter até 20 medicamentos.'); return; }
    S.d.rx.push({});
    renderRx();
    $(`#dRx${S.d.rx.length}-medicamento`)?.focus();
    docsPreviewSoon();
    return;
  }
  const del = e.target.closest('[data-rxdel]');
  if (del) {
    S.d.rx.splice(Number(del.dataset.rxdel), 1);
    if (!S.d.rx.length) S.d.rx = [{}];
    renderRx();
    $('#dRxAdd').focus();
    docsPreviewSoon();
    return;
  }
  if (e.target.closest('#dOrCopy')) {
    const g = $('#cGuide').value.trim();
    if (!g) { toast('As orientações do registro estão vazias.'); return; }
    $('#dOrTexto').value = g;
    docsPreviewSoon();
    return;
  }
  const em = e.target.closest('[data-demit]');
  if (em) emitDoc(em.dataset.demit, em);
}

/* ---------- emitir ---------- */
// Antes de emitir: perfil profissional e dados do paciente salvos, a versão mais nova do banco (o paciente pode ter
// mudado CPF ou endereço na página dele) e a conferência de identidade registrada.
async function ensurePrereqs() {
  const errs = [];
  if (!D.profileComplete(S.d.profile)) {
    if (!$('#dpAddr')) editProfile('dp');
    if (!(await saveProfile('dp', { quiet: true }))) errs.push(['#dpAddr', 'complete o seu endereço e contato profissionais']);
  }
  const PAT = 'complete os dados do paciente (CPF ou “não possui CPF” e endereço com cidade/UF)';
  let patOk = true;
  if (!S.d.patient || patientDirty()) {
    patOk = await savePatient({ quiet: true });
    if (!patOk) errs.push([$('#dCpfErr').textContent ? '#dCpf' : '#dAddr', PAT]);
  } else {
    const before = S.d.patient;
    const fresh = await loadPatientData(S.c.id, { force: true });
    if (fresh && !D.samePatient(before, fresh)) {
      renderDraft();
      return [['#dCpf', 'o paciente atualizou o CPF ou o endereço na página dele: confira os dados e a pré-visualização e toque em emitir de novo']];
    }
  }
  // Salvo, mas incompleto (ex.: o banco tem só o endereço): também falta.
  const missing = patOk ? D.patientMissing(S.d.patient) : [];
  if (missing.length) { patOk = false; errs.push([missing[0] === 'cpf' ? '#dCpf' : '#dAddr', PAT]); }
  // Conferência de identidade: marcada só fica gravada com os dados do paciente completos (o quadro desmarca se não der).
  if (!S.d.patient?.identityAt) {
    if (!$('#dIdOk').checked) errs.push(['#dIdOk', 'marque que conferiu o documento com foto e o CPF do paciente']);
    else if (patOk && !(await savePatient({ quiet: true, identity: true }))) errs.push(['#dIdOk', 'registre que conferiu o documento com foto e o CPF do paciente']);
  }
  return errs;
}
async function emitDoc(kind, btn) {
  if (!S.c || btn.disabled) return;
  const box = $(`[data-derr="${kind}"]`);
  const say = (t) => { box.textContent = t; box.classList.toggle('show', !!t); };
  say('');
  if (!ownAccess() || !D.canEmit(consultNow())) { docsSync(); say($('#dState').textContent || 'Não dá para emitir documentos nesta consulta agora.'); return; }
  const v = D.validateDoc(kind, readForm(kind), docCtx());
  showDocErrors(kind, v.errors);
  if (!v.ok) {
    const general = v.errors.documento || (kind === 'exames' && v.errors.itens) || (kind === 'comparecimento' && v.errors.horario) || '';
    say(general || 'Confira os campos marcados.');
    focusFirstError(kind);
    return;
  }
  const label = btn.querySelector('span');
  btn.disabled = true;
  label.textContent = 'Conferindo…';
  try {
    const pre = await ensurePrereqs();
    if (pre.length) {
      say(`Antes de emitir: ${pre.map((x) => x[1]).join('; ')}.`);
      $(pre[0][0])?.focus();
      return;
    }
    let payload = v.payload;
    if (kind === 'exames' && examsDirty()) {
      if (!(await sendExams({ quiet: true }))) { say('A lista de exames não foi enviada ao paciente. Confira o quadro “Pedido de exames” e tente de novo.'); return; }
      payload = { ...payload, itens: T.examsPayload(S.exams) };
    }
    label.textContent = 'Emitindo…';
    const id = S.c.id;
    // p_expect: os dados do paciente que o médico revisou; se o paciente mudou nesse meio-tempo, o banco recusa.
    const rows = await A.rpc('tele_doc_create', { p_id: id, p_kind: kind, p_payload: payload, p_expect: D.patientExpect(S.d.patient) });
    const row = Array.isArray(rows) ? rows[0] : rows;
    const title = D.KIND[kind].title;
    resetForms(kind);
    await loadDocs(id);
    renderDraft(kind);
    loadUnsigned();
    $('#dMsg').className = 'tl-msg ok';
    $('#dMsg').textContent = `Documento emitido: ${title}, código ${D.fmtCode(row?.code)}. Agora gere o PDF, assine com o seu certificado ICP-Brasil e envie o PDF assinado.`;
    toast(`Documento emitido: ${title}. O paciente já vê o rascunho.`);
    $(`#dList [data-docid="${CSS.escape(String(row?.id || ''))}"] [data-dpdf]`)?.focus();
  } catch (err) {
    if (lostSession(err)) return;
    const e = D.docError(err);
    const key = e.code === 'cid_sem_autorizacao' ? 'cidAutorizado' : e.code === 'receita_bloqueada' ? 'tipo' : e.code === 'consulta_nao_encerrada' ? 'horario'
      : e.code === 'dados_invalidos' && e.details === 'endereco_residencial' ? 'confirmaEndereco'
        : e.code === 'dados_invalidos' && e.details ? (kind === 'receita' && /^item\s+\d+$/.test(String(e.hint || '')) ? `itens.${String(e.hint).replace(/\D/g, '')}.${e.details}` : e.details) : null;
    const text = D.docErrorText(e, 'emitir');
    if (key && $(`[data-ferr="${kind}:${key}"]`)) { showDocErrors(kind, { [key]: text }); focusFirstError(kind); }
    if (e.code === 'perfil_incompleto') { editProfile('dp'); }
    if (e.code === 'paciente_incompleto') { showPatErr(e.details === 'cpf' ? { cpf: text } : { address: text }); $(e.details === 'cpf' ? '#dCpf' : '#dAddr').focus(); }
    if (e.code === 'dados_paciente_mudaram' || e.code === 'sem_conferencia_identidade') {
      await loadPatientData(S.c?.id, { force: true });
      renderDraft(kind);
      $(e.code === 'sem_conferencia_identidade' ? '#dIdOk' : '#dCpf')?.focus();
    }
    if (['estado_invalido', 'prazo_encerrado', 'nao_aprovado', 'atendimento_nao_iniciado'].includes(e.code)) consultPoll.now();
    say(text);
  } finally {
    btn.disabled = false;
    label.textContent = DOC_EMIT[kind];
  }
}

/* ---------- lista dos emitidos ---------- */
async function loadDocs(cid) {
  try {
    const rows = await A.rpc('tele_doc_list', { p_id: cid });
    S.d.lists[cid] = Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (lostSession(err)) return;
    if (!S.d.lists[cid]) S.d.lists[cid] = null;
  }
  renderDocs(cid);
}
// Documento de uma lista: da consulta (S.d.lists) ou do quadro "Falta assinar" (S.d.unsigned).
const findDoc = (cid, id) => S.d.lists[cid]?.find((x) => x.id === id) || S.d.unsigned?.find((x) => x.id === id) || null;
function fmtSize(n) { const v = Number(n) || 0; return v >= 1048576 ? `${(v / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(v / 1024))} KB`; }
function docItemHtml(d, cid, key) {
  const st = D.docStatus(d);
  const k = D.KIND[d.kind] || { title: d.kind };
  const id = esc(d.id);
  const code = D.fmtCode(d.code);
  const approved = S.me?.status === 'approved';
  const here = key === 'c' && S.c?.id === cid;
  const busy = S.d.uploading === d.id;
  const dis = busy ? ' disabled' : '';
  // Para leitor de tela: de qual documento é cada botão.
  const sr = `<span class="sr">: ${esc(k.title)}${code ? `, código ${esc(code)}` : ''}</span>`;
  const acts = [`<button class="btn btn-ghost btn-sm" type="button" data-dview="${id}" aria-expanded="false"><span data-lbl>Ver documento</span>${sr}</button>`];
  if (d.status === 'emitido') acts.push(`<button class="btn btn-primary btn-sm" type="button" data-dpdf="${id}"><i class="fa-solid fa-file-pdf" aria-hidden="true"></i>Gerar PDF para assinar${sr}</button>`);
  if (approved && D.canUpload(d)) acts.push(`<button class="btn btn-coral btn-sm" type="button" data-dup="${id}"${dis}><i class="fa-solid fa-upload" aria-hidden="true"></i>Enviar PDF assinado${sr}</button>`);
  if (d.signed) acts.push(`<button class="btn btn-ghost btn-sm" type="button" data-dget="${id}">Baixar o PDF enviado${sr}</button>`);
  if (d.status === 'emitido') acts.push(`<button class="btn btn-ghost btn-sm" type="button" data-dcancel="${id}"${dis}>Cancelar documento${sr}</button>`);
  if (d.status === 'cancelado' && here && ownAccess() && D.canEmit(consultNow())) acts.push(`<button class="btn btn-ghost btn-sm" type="button" data-dredo="${id}">Corrigir e emitir de novo${sr}</button>`);
  const until = D.signDeadline(d);
  const info = [`Emitido em ${T.fmtDateTime(d.created_at)}`];
  if (code) info.push(`código <b>${esc(code)}</b>`);
  if (d.signed) info.push(`PDF assinado enviado em ${esc(T.fmtDateTime(d.signed_at))}${d.file_size ? ` (${esc(fmtSize(d.file_size))})` : ''}`);
  const who = key === 'p' && d.patient_name ? `<p class="tl-small md-dwho">Paciente: <b>${esc(d.patient_name)}</b>${d.patient_snapshot?.inicio_atendimento ? ` · consulta de ${esc(T.fmtDateTime(d.patient_snapshot.inicio_atendimento))}` : ''}</p>` : '';
  const cancel = d.status === 'cancelado'
    ? `<p class="tl-small md-dcancel">Cancelado em ${esc(T.fmtDateTime(d.cancelled_at))}${d.cancelled_by === 'imed' ? ' pela equipe do IMED' : ''}. Motivo: ${esc(d.cancel_reason || '')}</p>` : '';
  const wait = d.status === 'emitido' && !d.signed
    ? `<p class="tl-small md-dwait">${D.canUpload(d)
      ? `Falta assinar: o paciente vê “Rascunho sem assinatura”. Envie o PDF assinado até ${esc(T.fmtDateTime(until))}.`
      : 'O prazo para enviar o PDF assinado (7 dias) terminou: o paciente vê “Não assinado”. Cancele este rascunho, com o motivo (o paciente vê).'}</p>` : '';
  return `<li class="md-doc" data-docid="${id}" data-cid="${esc(cid)}">
    <div class="md-doc-h"><b data-dtitle tabindex="-1">${esc(k.title)}</b><span class="tl-chip ${st.cls}">${esc(st.label)}</span></div>
    ${who}<p class="tl-small">${info.map((x, i) => (i ? x : esc(x))).join(' · ')}</p>${cancel}${wait}
    <div class="tl-row">${acts.join('')}</div>
    <div class="md-dview" data-dviewbox="${id}" hidden></div>
    <div class="tl-confirm" data-dcancelbox="${id}" role="group" aria-label="Cancelar ${esc(k.title)}" hidden>
      <div class="fld"><label for="dcr-${key}-${id}">Motivo do cancelamento <small class="h">(o paciente vê)</small></label><textarea id="dcr-${key}-${id}" rows="2" maxlength="300" data-dcr></textarea></div>
      <p class="bk-err" data-dcancelerr role="alert"></p>
      <div class="tl-row"><button class="btn btn-coral btn-sm" type="button" data-dcancelyes="${id}"${dis}>Cancelar o documento</button><button class="btn btn-ghost btn-sm" type="button" data-dcancelno="${id}">Voltar</button></div>
    </div>
    <div class="tl-confirm" data-dupbox="${id}" role="group" aria-label="Conferir a assinatura do arquivo" hidden>
      <p>${esc(D.ICP_WARN)}</p>
      <div class="tl-row"><button class="btn btn-coral btn-sm" type="button" data-dupyes="${id}"${dis}>Enviar mesmo assim</button><button class="btn btn-ghost btn-sm" type="button" data-dupno="${id}">Escolher outro arquivo</button></div>
    </div>
    <p class="tl-msg" data-ditemmsg="${id}" role="status"></p>
  </li>`;
}
// Redesenha uma lista só se algo mudou, sem perder o foco do teclado, as caixas abertas e as mensagens de cada item.
const ACT_KEYS = ['data-dview', 'data-dpdf', 'data-dup', 'data-dget', 'data-dcancel', 'data-dredo', 'data-dcancelyes', 'data-dcancelno', 'data-dupyes', 'data-dupno', 'data-dcr'];
function paintList(ol, html, cid) {
  if (ol.dataset.html === html && ol.firstElementChild) return;
  const a = document.activeElement;
  const li = a && ol.contains(a) ? a.closest('[data-docid]') : null;
  const keep = li ? ACT_KEYS.find((k) => a.hasAttribute(k)) || 'data-dtitle' : null;
  const views = $$('[data-dviewbox]:not([hidden])', ol).map((b) => b.dataset.dviewbox);
  const cancels = $$('[data-dcancelbox]:not([hidden])', ol).map((b) => [b.dataset.dcancelbox, b.querySelector('[data-dcr]').value]);
  const ups = $$('[data-dupbox]:not([hidden])', ol).map((b) => b.dataset.dupbox);
  const msgs = $$('[data-ditemmsg]', ol).filter((m) => m.textContent).map((m) => [m.dataset.ditemmsg, m.textContent, m.className]);
  ol.dataset.html = html;
  ol.innerHTML = html;
  const item = (id) => ol.querySelector(`[data-docid="${CSS.escape(id)}"]`);
  for (const [id, text, cls] of msgs) { const m = item(id)?.querySelector('[data-ditemmsg]'); if (m) { m.textContent = text; m.className = cls; } }
  for (const [id, val] of cancels) { const b = item(id)?.querySelector('[data-dcancelbox]'); if (b) { b.hidden = false; b.querySelector('[data-dcr]').value = val; } }
  for (const id of ups) { const b = item(id)?.querySelector('[data-dupbox]'); if (b) b.hidden = false; }
  for (const id of views) { const it = item(id); const d = findDoc(it?.dataset.cid || cid, id); const btn = it?.querySelector('[data-dview]'); if (it && d && btn) viewDoc(it, d, it.dataset.cid || cid, btn); }
  // O foco volta ao mesmo botão; se ele sumiu ou está escondido (ex.: depois de enviar o PDF), vai para o título do item.
  if (li) { const it = item(li.dataset.docid); const t = it?.querySelector(`[${keep}]`); (t && t.offsetParent !== null ? t : it?.querySelector('[data-dtitle]'))?.focus(); }
}
function renderDocs(cid) {
  const list = S.d.lists[cid];
  for (const ol of $$(`[data-doclist="${CSS.escape(cid)}"]`)) {
    const key = ol.dataset.dkey || 'c';
    const html = list === undefined ? '<li class="tl-small">Carregando…</li>'
      : list === null ? '<li class="tl-small">Não foi possível carregar os documentos. Tente de novo em instantes.</li>'
        : list.length ? list.slice().reverse().map((d) => docItemHtml(d, cid, key)).join('')
          : '<li class="tl-small md-dempty">Nenhum documento emitido nesta consulta.</li>';
    paintList(ol, html, cid);
  }
  if (S.c?.id === cid) $('#dCount').textContent = String(list?.length || 0);
}
/* ---------- quadro "Falta assinar" ---------- */
// Documentos sem PDF assinado (até 30 dias): o médico assina no fim do dia sem abrir consulta por consulta.
async function loadUnsigned() {
  if (S.me?.status !== 'approved') { S.d.unsigned = null; renderUnsigned(); return; }
  try {
    const rows = await A.rpc('tele_doc_pending');
    S.d.unsigned = Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (lostSession(err)) return;
    S.d.unsigned = null;
  }
  renderUnsigned();
}
function renderUnsigned() {
  const list = S.d.unsigned || [];
  $('#signCard').hidden = !!S.c || !list.length;
  $('#signCount').textContent = String(list.length);
  const late = list.filter((d) => !D.canUpload(d)).length;
  $('#signNote').textContent = late ? `${late === 1 ? '1 documento passou' : `${late} documentos passaram`} do prazo de 7 dias: cancele, com o motivo.` : '';
  paintList($('#signList'), list.map((d) => docItemHtml(d, d.consultation_id, 'p')).join(''), null);
  const by = {};
  for (const d of list) if (D.canUpload(d)) by[d.consultation_id] = (by[d.consultation_id] || 0) + 1;
  for (const b of $$('[data-hbadge]')) { const n = by[b.dataset.hbadge] || 0; b.textContent = n ? `${n} sem assinatura` : ''; b.hidden = !n; }
}
function itemMsg(docId, text, cls = '') {
  for (const m of $$(`[data-ditemmsg="${CSS.escape(docId)}"]`)) { m.textContent = text; m.className = `tl-msg${cls ? ` ${cls}` : ''}`; }
}
async function viewDoc(li, d, cid, btn) {
  const box = li.querySelector('[data-dviewbox]');
  const open = box.hidden;
  box.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  btn.querySelector('[data-lbl]').textContent = open ? 'Fechar documento' : 'Ver documento';
  if (!open) return;
  const m = D.docModel(d, { site: SITE, consult: S.d.ctx[cid] });
  const mark = d.status === 'cancelado' ? 'cancel' : null;
  box.innerHTML = D.docHtml(m, { mark });
  try {
    const qr = await D.loadQrLib();
    if (m.url && !box.hidden) box.innerHTML = D.docHtml(m, { mark, qr: D.qrSvg(D.qrMatrix(m.url, qr)) });
  } catch { /* sem o QR na tela: o PDF continua com ele */ }
}
async function genPdf(d, cid, btn) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Gerando o PDF…';
  try {
    const [lib, qrcode] = await Promise.all([D.loadPdfLib(), D.loadQrLib()]);
    const m = D.docModel(d, { site: SITE, consult: S.d.ctx[cid] });
    const bytes = await D.buildPdf(m, { lib, qrcode });
    saveFile(bytes, D.pdfFileName(m));
    itemMsg(d.id, `PDF gerado (${D.pdfFileName(m)}). Assine com o seu certificado ICP-Brasil, sem mudar o arquivo, e toque em “Enviar PDF assinado”.`, 'ok');
  } catch {
    itemMsg(d.id, 'Não foi possível gerar o PDF neste navegador. Atualize a página e tente de novo.', 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = html;
  }
}
// from: em qual lista o médico tocou (c = consulta aberta, h = histórico, p = "Falta assinar"), para o foco voltar lá.
function startUpload(d, cid, from = 'c') {
  S.d.upFor = { id: d.id, cid, from };
  const f = $('#dFile');
  f.value = '';
  f.click();
}
async function onFile() {
  const up = S.d.upFor;
  const file = $('#dFile').files?.[0];
  if (!up || !file) return;
  const d = findDoc(up.cid, up.id);
  if (!d) return;
  const bad = (t) => { itemMsg(d.id, t, 'err'); focusItem(d.id, up.cid, up.from, ['[data-dup]']); };
  if (file.size > D.MAX_PDF_BYTES) { bad(D.UPLOAD_TEXT.grande); return; }
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { bad('Não foi possível ler o arquivo. Tente de novo.'); return; }
  // PDF de outro documento é recusado aqui e no banco (nada de "enviar mesmo assim").
  const chk = D.checkSignedPdf(bytes, d.code);
  if (!chk.ok) { bad(D.UPLOAD_TEXT[chk.error]); return; }
  if (!chk.icp) {
    // Assinatura sem "ICP-Brasil" (provável gov.br): avisa antes, porque depois o PDF não pode ser trocado.
    S.d.confirm = { id: d.id, cid: up.cid, bytes, from: up.from };
    for (const box of $$(`[data-docid="${CSS.escape(d.id)}"] [data-dupbox]`)) box.hidden = false;
    itemIn(d.id, up.cid, up.from)?.querySelector('[data-dupno]')?.focus();
    return;
  }
  await sendPdf(d, up.cid, bytes, up.from);
}
// O item do documento na lista em que o médico tocou (o mesmo documento pode estar em duas listas).
function itemIn(docId, cid, from) {
  const sel = `[data-docid="${CSS.escape(docId)}"]`;
  const ol = from === 'p' ? $('#signList') : $(`ol[data-dkey="${from}"][data-doclist="${CSS.escape(cid)}"]`);
  return ol?.querySelector(sel) || $(`#dList ${sel}`) || $(`#signList ${sel}`);
}
// O foco volta ao item quando o navegador o tirou (botão escondido, ou parado durante o envio). Se a pessoa já foi
// para outro lugar da página, o foco fica onde ela está.
function focusItem(docId, cid, from, sels) {
  const a = document.activeElement;
  if (a && a !== document.body && a.closest('[data-docid]')?.dataset.docid !== docId) return;
  const it = itemIn(docId, cid, from);
  if (!it) { if (from === 'p') ($('#signList [data-dtitle]') || (!$('#signCard').hidden && $('#signTitle')))?.focus(); return; }
  for (const s of [...sels, '[data-dtitle]']) {
    const t = it.querySelector(s);
    if (t && !t.disabled && t.offsetParent !== null) { t.focus(); return; }
  }
}
async function sendPdf(d, cid, bytes, from = 'c') {
  if (S.d.uploading) return;
  S.d.uploading = d.id;
  for (const b of $$(`[data-docid="${CSS.escape(d.id)}"] :is([data-dup], [data-dcancel], [data-dcancelyes], [data-dupyes])`)) b.disabled = true;
  itemMsg(d.id, 'Enviando o PDF assinado… não feche a página.');
  try {
    await A.rpc('tele_doc_upload', { p_doc: d.id, p_pdf_base64: D.toBase64(bytes) });
    S.d.uploading = null;
    await refreshAfter(cid);
    itemMsg(d.id, 'PDF assinado enviado: o paciente já pode baixar. O IMED não confere a validade da assinatura; confira o arquivo em validar.iti.gov.br.', 'ok');
    toast('PDF assinado enviado.');
    focusItem(d.id, cid, from, ['[data-dget]']);
  } catch (err) {
    S.d.uploading = null;
    if (lostSession(err)) return;
    itemMsg(d.id, D.docErrorText(D.docError(err), 'enviar'), 'err');
    await refreshAfter(cid);
    for (const b of $$(`[data-docid="${CSS.escape(d.id)}"] :is([data-dup], [data-dcancel], [data-dcancelyes], [data-dupyes])`)) b.disabled = false;
    focusItem(d.id, cid, from, ['[data-dup]', '[data-dget]']);
  } finally {
    S.d.uploading = null;
    for (const b of $$(`[data-docid="${CSS.escape(d.id)}"] :is([data-dup], [data-dcancel], [data-dcancelyes], [data-dupyes])`)) b.disabled = false;
  }
}
// Depois de enviar ou cancelar: a lista da consulta (se está na tela) e o quadro "Falta assinar".
async function refreshAfter(cid) {
  const jobs = [loadUnsigned()];
  if (S.d.lists[cid] !== undefined || S.c?.id === cid) jobs.push(loadDocs(cid));
  panelSoon(); // "documentos para assinar" no painel
  await Promise.all(jobs);
}
async function getSigned(d, btn) {
  btn.disabled = true;
  try {
    const b64 = await A.rpc('tele_doc_pdf', { p_doc: d.id });
    if (!b64) { itemMsg(d.id, 'Ainda não há PDF assinado deste documento.', 'err'); return; }
    saveFile(D.fromBase64(b64), D.pdfFileName({ kind: d.kind, codeText: D.fmtCode(d.code) }, true));
  } catch (err) {
    if (lostSession(err)) return;
    itemMsg(d.id, D.docErrorText(D.docError(err), 'baixar'), 'err');
  } finally {
    btn.disabled = false;
  }
}
async function cancelDoc(d, cid, li, btn) {
  const area = li.querySelector('[data-dcr]');
  const err = li.querySelector('[data-dcancelerr]');
  const reason = D.oneLine(area.value);
  const say = (t) => { err.textContent = t; err.classList.toggle('show', !!t); };
  if (reason.length < 3 || reason.length > 300) { say('Escreva o motivo do cancelamento (de 3 a 300 caracteres). O paciente vê o motivo.'); area.focus(); return; }
  if (S.d.uploading === d.id) return;
  btn.disabled = true;
  try {
    await A.rpc('tele_doc_cancel', { p_doc: d.id, p_reason: reason });
    li.querySelector('[data-dcancelbox]').hidden = true;
    await refreshAfter(cid);
    toast('Documento cancelado. O paciente vê “Cancelado”.');
    const next = $(`[data-doclist="${CSS.escape(cid)}"] [data-docid="${CSS.escape(d.id)}"]`);
    (next?.querySelector('[data-dredo]') || next?.querySelector('[data-dview]') || $('#signTitle'))?.focus();
  } catch (e) {
    if (lostSession(e)) return;
    say(D.docErrorText(D.docError(e), 'cancelar'));
    btn.disabled = false;
  }
}
function redoDoc(d) {
  selectTab(d.kind);
  fillForm(d.kind, d.payload);
  renderDraft(d.kind);
  $('#dMsg').className = 'tl-msg';
  $('#dMsg').textContent = d.kind === 'exames'
    ? 'Ajuste a lista no quadro “Pedido de exames” e toque em “Emitir pedido de exames”.'
    : 'O formulário foi preenchido com o documento cancelado. Corrija e emita de novo (as confirmações precisam ser marcadas outra vez).';
  $(`#dTab-${d.kind}`).focus();
}
function onDocsClick(e) {
  const ps = e.target.closest('[data-profsave]');
  if (ps) { saveProfile(ps.dataset.profsave); return; }
  const pe = e.target.closest('[data-profedit]');
  if (pe) { editProfile(pe.dataset.profedit); return; }
  const gt = e.target.closest('[data-gotab]');
  if (gt) { $('#cEndConfirm').hidden = true; $('#cBackConfirm').hidden = true; selectTab(gt.dataset.gotab, true); $('#cDocs').scrollIntoView({ block: 'start' }); return; }
  const li = e.target.closest('[data-docid]');
  if (!li) return;
  const cid = li.dataset.cid;
  const d = findDoc(cid, li.dataset.docid);
  if (!d) return;
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.hasAttribute('data-dview')) viewDoc(li, d, cid, b);
  else if (b.hasAttribute('data-dpdf')) genPdf(d, cid, b);
  else if (b.hasAttribute('data-dup')) startUpload(d, cid, li.closest('ol')?.dataset.dkey);
  else if (b.hasAttribute('data-dget')) getSigned(d, b);
  else if (b.hasAttribute('data-dcancel')) { const box = li.querySelector('[data-dcancelbox]'); box.hidden = false; box.querySelector('[data-dcr]').focus(); }
  else if (b.hasAttribute('data-dcancelno')) { li.querySelector('[data-dcancelbox]').hidden = true; li.querySelector('[data-dcancel]')?.focus(); }
  else if (b.hasAttribute('data-dcancelyes')) cancelDoc(d, cid, li, b);
  else if (b.hasAttribute('data-dredo')) redoDoc(d);
  else if (b.hasAttribute('data-dupno') || b.hasAttribute('data-dupyes')) {
    // O mesmo documento pode estar em duas listas (consulta e "Falta assinar"): fecha a pergunta nas duas. O foco vai
    // antes para o "Enviar PDF assinado" do item (o botão tocado some junto com a pergunta).
    const from = li.closest('ol')?.dataset.dkey;
    li.querySelector('[data-dup]')?.focus();
    for (const box of $$(`[data-docid="${CSS.escape(d.id)}"] [data-dupbox]`)) box.hidden = true;
    const p = S.d.confirm;
    S.d.confirm = null;
    if (b.hasAttribute('data-dupno')) startUpload(d, cid, from);
    else if (p && p.id === d.id) sendPdf(d, cid, p.bytes, from);
  }
}
function onHistToggle(e) {
  const det = e.target;
  if (!(det instanceof HTMLDetailsElement) || !det.open) return;
  const box = det.querySelector('[data-hdocs]');
  if (box) loadDocs(box.dataset.hdocs);
}

/* ---------- consulta aberta ---------- */
function docsOpen(row) {
  S.d.ctx[row.id] = S.c.data;
  S.d.patient = null;
  S.d.patAt = 0;
  S.d.confirm = null;
  const list = $('#dList');
  list.dataset.doclist = row.id;
  list.dataset.dkey = 'c';
  delete list.dataset.html;
  list.innerHTML = '<li class="tl-small">Carregando…</li>';
  $('#dCount').textContent = '0';
  $('#dMsg').textContent = '';
  patMsg('');
  $('#dIdOk').checked = false;
  $('#dCpf').value = ''; $('#dAddr').value = ''; $('#dCpf').disabled = false; $('#dNoCpf').checked = false;
  showPatErr({});
  resetForms();
  renderProfile();
  selectTab(S.d.kind);
  docsSync();
  loadDocs(row.id);
  loadPatientData(row.id);
}
// O que dá para fazer agora (cadastro aprovado, atendimento começado, consulta aberta para documentos, prazo).
function docsSync() {
  if (!S.c) return;
  S.d.ctx[S.c.id] = S.c.data;
  const c = consultNow();
  const own = ownAccess();
  const open = D.canEmit(c);
  let note = '';
  if (!own) note = 'O seu cadastro não está aprovado agora: você vê e pode cancelar os documentos desta consulta, mas não pode emitir nem enviar PDF.';
  else if (!c.started_at && (S.mode === 'closed' || ['expired', 'cancelled', 'ended'].includes(c.status))) note = 'O atendimento desta consulta não começou pelo IMED (sem vídeo, sem ligação pelo botão “Ligar” e sem mensagem). Sem atendimento, não há documento (Código de Ética Médica, art. 80). Registre no prontuário o que houve.';
  else if (!c.started_at) note = 'Os documentos ficam disponíveis quando o atendimento começar: quando o vídeo conectar, você tocar em “Ligar para o paciente” ou mandar uma mensagem. Se atender por telefone de outro jeito, toque em “Registrar: continuou por telefone ou mensagem”.';
  else if (!open) note = 'O prazo para emitir documentos (24 horas depois de encerrar a consulta) terminou. Ainda dá para enviar o PDF assinado dos documentos já emitidos (até 7 dias depois de emitir).';
  if ($('#dState').textContent !== note) $('#dState').textContent = note;
  $('#dState').hidden = !note;
  const can = !note;
  $('#dPre').hidden = !can;
  $('#dTabs').hidden = !can;
  $('#dPanels').hidden = !can;
  if (can) { setAtDates(); renderDraft(); }
  renderDocs(S.c.id);
}
function docsClose() {
  const list = $('#dList');
  delete list.dataset.doclist;
  delete list.dataset.html;
  list.innerHTML = '';
  S.d.patient = null;
  S.d.confirm = null;
  clearTimeout(S.d.prevTimer);
  resetForms();
  for (const b of $$('[data-dprev]')) b.innerHTML = '';
  $('#dCpf').value = ''; $('#dAddr').value = ''; $('#dNoCpf').checked = false; $('#dIdOk').checked = false;
  $('#dMsg').textContent = '';
  patMsg('');
}
function setupDocs() {
  $('#dTabs').innerHTML = D.KINDS.map((k, i) => `<button type="button" role="tab" class="md-dtab" id="dTab-${k.id}" aria-controls="dP-${k.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-dtab="${k.id}">${esc(k.tab)}</button>`).join('');
  $('#dPanels').innerHTML = D.KINDS.map((k, i) => `<div class="md-dpanel" role="tabpanel" id="dP-${k.id}" aria-labelledby="dTab-${k.id}"${i ? ' hidden' : ''}>${panelHtml(k.id)}</div>`).join('');
  renderRx();
  updateRxBlock();
  $('#dTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-dtab]'); if (b) selectTab(b.dataset.dtab, true); });
  $('#dTabs').addEventListener('keydown', tabKeys);
  $('#dPanels').addEventListener('input', onPanelInput);
  $('#dPanels').addEventListener('change', onPanelChange);
  $('#dPanels').addEventListener('click', onPanelClick);
  $('#dCpf').addEventListener('input', (e) => { const el = e.target; el.value = D.maskCpf(el.value); setErr(el, $('#dCpfErr'), ''); renderPatState(); docsPreviewSoon(); });
  $('#dNoCpf').addEventListener('change', (e) => {
    const no = e.target.checked;
    $('#dCpf').disabled = no;
    if (no) { $('#dCpf').value = ''; setErr($('#dCpf'), $('#dCpfErr'), ''); }
    renderPatState();
    docsPreviewSoon();
  });
  $('#dAddr').addEventListener('input', (e) => { setErr(e.target, $('#dAddrErr'), ''); renderPatState(); docsPreviewSoon(); });
  $('#dPatSave').addEventListener('click', () => savePatient());
  // A conferência de identidade fica registrada no banco (com o que está no quadro, na mesma chamada).
  $('#dIdOk').addEventListener('change', async (e) => {
    if (!S.c) return;
    const want = e.target.checked;
    const ok = await savePatient({ identity: want });
    if (!ok) e.target.checked = !!S.d.patient?.identityAt;
  });
  $('#dFile').addEventListener('change', onFile);
  document.addEventListener('click', onDocsClick);
  $('#hist').addEventListener('toggle', onHistToggle, true);
}

/* ======================= início ======================= */
function setup() {
  setupMenu();
  setupPanel();
  setupReg();
  setupNotice();
  setupExams();
  setupRecord();
  setupChat();
  setupDocs();
  $('#availBtn').addEventListener('click', () => setAvailable(!S.available, true));
  // offOnLeave desliga no servidor; a lembrança da aba (sessionStorage) fica para religar ao recarregar.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-accept]');
    if (a) { accept(a.dataset.accept, a); return; }
    const r = e.target.closest('[data-resume]');
    if (r) { resumeConsult(r.dataset.resume); return; }
    const dm = e.target.closest('[data-dismiss]');
    if (dm) { const b = $(`[data-dismissbox="${CSS.escape(dm.dataset.dismiss)}"]`); if (b) { b.hidden = false; b.querySelector('[data-dismissyes]')?.focus(); } return; }
    const dn = e.target.closest('[data-dismissno]');
    if (dn) { const b = $(`[data-dismissbox="${CSS.escape(dn.dataset.dismissno)}"]`); if (b) b.hidden = true; $(`[data-dismiss="${CSS.escape(dn.dataset.dismissno)}"]`)?.focus(); return; }
    const dy = e.target.closest('[data-dismissyes]');
    if (dy) { dismiss(dy.dataset.dismissyes, dy); return; }
    const m = e.target.closest('[data-amend]');
    if (m) { amend(m.dataset.amend); return; }
    const sc = e.target.closest('[data-savecheck]');
    if (sc) { sc.disabled = true; saveChecks(sc.dataset.savecheck).finally(() => { sc.disabled = false; }); return; }
    const s = e.target.closest('[data-set]');
    if (s) setDoctor(s.dataset.id, s.dataset.set, s);
  });
  addEventListener('pagehide', () => { offOnLeave(); S.local?.getTracks().forEach((t) => t.stop()); S.peer?.close(); });
}

setup();
const back = await A.handleRedirect();
if (back?.status === 'ok') flash('Pronto, você entrou.', 'ok');
else if (back?.status === 'error') flash(back.message, 'warn');
renderAuth();
if (A.user()) {
  if (await A.token()) loadMe();
  else { renderAuth(); flash('Sua entrada expirou. Entre de novo abaixo (link por e-mail ou senha).', 'warn'); }
}
