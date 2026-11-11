// Painel da clínica, iMed Agenda fase 4.2 ("Agenda visual e recepção"): a aba Agenda de verdade — Hoje (recepção),
// Dia (uma coluna por aparelho, sala ou profissional), Semana, Mês e Bloqueios —, o balcão (novo agendamento e "só
// ocupar"), chegada/atendimento/concluído/falta, cancelar e remarcar, bloqueios com a lista de afetados ("bloquear
// mesmo assim"), "Para remarcar", busca rápida e o detalhe com o histórico.
// Só fala com o banco pelas funções da agenda (3.3, 3.4 e 4.2): agenda_catalog, agenda_view, agenda_free, agenda_month,
// agenda_version, agenda_conflicts, agenda_conflict_resolve, agenda_search, agenda_request_detail, agenda_history,
// agenda_attend, agenda_set_status, agenda_cancel, agenda_reschedule, agenda_desk_slots, agenda_desk_book,
// agenda_desk_busy, agenda_desk_busy_remove, agenda_blocks, agenda_block_add, agenda_block_force, agenda_block_remove
// e set_request_status (pedido sem horário). Tudo no FUSO DA CLÍNICA. Dado de paciente fica só na memória da página;
// o banco registra cada leitura (agenda.access_log). Regras puras em agenda-core.js; o banco confere tudo de novo.
// Fase 4.3: atualização automática (o vigia de tempo-real.js, ligado pelo painel.js, avisa "imed:agenda-mudou" quando a
// versão da agenda muda e a tela relê sem perder o que a pessoa está digitando), o bloco "Precisa de atenção" (só com
// o que as funções já devolvem) e a visão "Resumo" (agenda_dashboard; o financeiro só para quem tem financeiro.ver).
import { auth, $, $$, esc, loading, note, toast, friendlyError, telHref, fmtPhone, onlyDigits, examName } from './clinica.js';
import * as A from './agenda-core.js';
import { vigiaDe, POLL_ALONE_MS } from './tempo-real.js';

const rpc = (fn, args) => auth.rpc(fn, args);
const isMissingFn = (err) => err?.status === 404 || err?.data?.code === 'PGRST202' || err?.data?.code === '42883';
const isNetwork = (err) => !err?.status && !err?.data;
const VIEWS = [['hoje', 'Hoje'], ['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['resumo', 'Resumo'], ['bloqueios', 'Bloqueios']];
const LS_VIEW = 'imed_agenda_visao';
const wide = () => window.matchMedia('(min-width: 1000px)').matches;
const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
const icon = (cls) => (cls ? `<i class="fa-solid ${cls}" aria-hidden="true"></i>` : '');
// Botões com texto à vista não levam aria-label (o nome falado tem de conter o que está escrito, WCAG 2.5.3): o que
// falta para quem ouve (fim do horário, situação completa, aparelho) vai em texto escondido (.sr), na ordem da tela.
const sr = (t) => (t ? `<span class="sr">${t}</span>` : '');
const SEP = sr(', ');
// "09:00–09:30" na tela; "09:00 às 09:30" para quem ouve.
const faixa = (a, b) => `${esc(a)}${sr(' às ')}<span aria-hidden="true">–</span>${esc(b)}`;
const waHref = (phone) => { const d = onlyDigits(phone); return /^[1-9]{2}9\d{8}$/.test(d) ? `https://wa.me/55${d}` : ''; };

// ---------- redesenho sem perder o foco ----------
// A barra de cima é desenhada de novo a cada carga. patch() troca só o que mudou: o nó que continua no mesmo lugar
// (mesma tag, id, classe e ação) fica — com o foco, com o que está sendo digitado em "Ir para a data" e com o
// aberto/fechado que a pessoa escolheu nos <details>.
const PATCH_KEYS = ['id', 'class', 'type', 'name', 'data-act', 'data-view'];
const sameNode = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && PATCH_KEYS.every((k) => a.getAttribute(k) === b.getAttribute(k))));
function patch(box, html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  patchKids(box, t.content);
}
function patchKids(el, src) {
  const olds = [...el.childNodes];
  const news = [...src.childNodes];
  news.forEach((n, i) => {
    const o = olds[i];
    if (!o) el.append(n);
    else if (sameNode(o, n)) patchNode(o, n);
    else o.replaceWith(n);
  });
  for (const o of olds.slice(news.length)) o.remove();
}
function patchNode(o, n) {
  if (o.nodeType !== 1) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
  const ativo = o === document.activeElement;
  const keep = (name) => name === 'open' && o.tagName === 'DETAILS';
  for (const { name } of [...o.attributes]) if (!n.hasAttribute(name) && !keep(name)) o.removeAttribute(name);
  for (const { name, value } of [...n.attributes]) if (!keep(name) && o.getAttribute(name) !== value) o.setAttribute(name, value);
  if (o.tagName === 'INPUT') {
    // campo em uso: o valor é o que a pessoa está digitando
    if (!ativo) { if (o.type === 'checkbox' || o.type === 'radio') o.checked = n.hasAttribute('checked'); else o.value = n.getAttribute('value') ?? ''; }
    return;
  }
  const quer = o.tagName === 'SELECT' ? (n.querySelector('option[selected]')?.value ?? null) : null;
  patchKids(o, n);
  if (o.tagName === 'SELECT' && !ativo) o.value = quer ?? o.options[0]?.value ?? '';
}

// As outras áreas (lista, grade, "Para remarcar", detalhe) são desenhadas de novo por inteiro. keepFocus() guarda qual
// botão ou campo tinha o foco e, depois de desenhar, põe o foco no equivalente novo (o mesmo item, a mesma ação). Se ele
// não existe mais, o foco vai para o título da área (nunca fica perdido no começo da página).
const FOCUS_ATTRS = ['data-view', 'data-act', 'data-item', 'data-k', 'data-w', 'data-dia', 'data-busy', 'data-req', 'data-id', 'data-st', 'data-t', 'data-f', 'name'];
function focusKey(el) {
  if (!el || el === document.body || !S?.box.contains(el)) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const sel = FOCUS_ATTRS.filter((a) => el.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(el.getAttribute(a))}"]`).join('')
    + (el.type === 'radio' ? `[value="${CSS.escape(el.value)}"]` : '');
  return sel ? `${el.tagName.toLowerCase()}${sel}` : null;
}
function keepFocus(draw) {
  const el = document.activeElement;
  const key = focusKey(el);
  const area = el?.closest?.('#agDet') ? '#agDetT' : '#agTitulo';
  draw();
  if (!key || (el.isConnected && document.activeElement === el)) return;
  const agora = document.activeElement;
  if (agora && agora !== document.body && agora !== el) return;   // quem desenhou já pôs o foco em outro lugar
  // sem rolar a página: o equivalente está no mesmo lugar; o título é só a reserva (quem chamou pode pôr o foco
  // em outro botão logo depois, e a página não pode pular para o alto e voltar)
  $(key)?.focus({ preventScroll: true });
  if (document.activeElement === document.body || !document.activeElement) $(area)?.focus({ preventScroll: true });
}

// O que o leitor de tela fala (#agFala: região viva escondida que está sempre na página, então é anunciada de verdade).
let falaTimer = null;
function falar(text) {
  const f = $('#agFala');
  if (!f) return;
  clearTimeout(falaTimer);
  f.textContent = '';
  // esvazia e escreve um instante depois: a mesma frase duas vezes seguidas também é dita
  if (text) falaTimer = setTimeout(() => { if (f.isConnected) f.textContent = text; }, 150);
}

// ctx: { clinic, perms, admin, lost(), goTab(id), focus: { requestId, day } | null }
let S = null;
let watching = false;
let atencaoTimer = null;
const naTela = () => !!(S?.box.isConnected && $('#agRoot', S.box));
// Balcão: chave de reenvio de cada par (clínica, exame, horário) que ficou sem resposta (erro de rede). Fica fora de S
// para valer também depois de trocar de aba e voltar (a agenda é desenhada de novo).
const deskKeys = new Map();
let viradaTimer = null;

export async function renderAgenda(box, ctx) {
  const cid = ctx.clinic.id;
  let view = 'hoje';
  try { const v = localStorage.getItem(LS_VIEW); if (VIEWS.some(([k]) => k === v)) view = v; } catch { /* sem armazenamento */ }
  S = {
    clinicId: cid, ctx, box, view, cat: null, missing: {}, tz: ctx.clinic.timezone || 'America/Sao_Paulo', scope: null,
    day: null, data: null, free: null, month: null, blocks: null, conflicts: [], version: null, updatedAt: null,
    f: { proc: '', res: '', canal: '', cancel: false }, listMode: false, det: null, ask: null, form: null,
    bk: null, oc: null, bl: null, remOpen: false, busca: null, monthAll: false, seq: 0,
    busy: new Set(),   // itens com chamada de atendimento (ou "voltar ao horário") em andamento
    rs: { period: 'semana', from: '', to: '' }, dash: null, fin: null, dashPer: null,   // visão Resumo (4.3)
    pend: null,        // pedidos sem resposta (só para quem vê os pedidos): { n, at }
    adiado: false,     // a tela mudou durante a digitação: desenha quando a pessoa sair do campo
  };
  const me = S;
  box.innerHTML = loading('Carregando a agenda…');
  try {
    const cat = await rpc('agenda_catalog', { p_clinic: cid });
    if (S !== me || !box.isConnected) return;
    if (cat?.status === 'forbidden') { box.innerHTML = note('Sua conta não pode ver a agenda desta clínica.', 'info'); return; }
    if (cat?.status !== 'ok') throw Object.assign(new Error(cat?.status), { result: cat?.status });
    S.cat = cat;
    S.tz = cat.timezone || S.tz;
    S.scope = cat.scope;
  } catch (err) {
    if (S !== me) return;
    if (!isMissingFn(err)) {
      if (ctx.lost() || !box.isConnected) return;
      box.innerHTML = `${note(esc(friendlyError(err, 'Não foi possível carregar a agenda agora.')), 'err')}
        <div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="agRetry">Tentar de novo</button></div>`;
      $('#agRetry', box).onclick = () => renderAgenda(box, ctx);
      return;
    }
    S.missing.catalog = true;
  }
  if (!S.scope) S.scope = ctx.perms?.['agenda.ver'] === 'propria' ? 'propria' : A.can(ctx.perms, 'agenda.ver') ? 'clinica' : ctx.admin ? 'central' : 'clinica';
  if (S.scope === 'propria' && (S.view === 'bloqueios' || S.view === 'resumo')) S.view = 'hoje';
  S.day = A.dayIn(S.tz, Date.now());
  if (ctx.focus?.day && /^\d{4}-\d{2}-\d{2}$/.test(ctx.focus.day)) { S.day = ctx.focus.day; S.view = 'dia'; }
  shell();
  agendarVirada();
  if (!watching) {
    watching = true;
    document.addEventListener('visibilitychange', onVisible);
    window.matchMedia('(min-width: 1000px)').addEventListener?.('change', () => { if (S?.box.isConnected && $('#agRoot', S.box)) keepFocus(() => { drawTop(); drawMain(); drawDetail(); }); });
    // o vigia (tempo-real.js, ligado pelo painel): a versão da agenda mudou → relê; o estado dele → "Atualizado às"
    window.addEventListener('imed:agenda-mudou', (e) => { if (naTela() && e.detail?.clinicId === S.clinicId) recarregarPorAviso(e.detail.reason); });
    window.addEventListener('imed:agenda-estado', (e) => { if (naTela() && e.detail?.clinicId === S.clinicId) keepFocus(() => { drawEstado(); drawAtencao(); }); });
    atencaoTimer = setInterval(() => { if (naTela()) keepFocus(drawAtencao); }, 60000);
  }
  await loadView();
  if (ctx.focus?.requestId && S === me) {
    const it = (S.data?.items || []).find((x) => x.request_id === ctx.focus.requestId);
    openDetail(ctx.focus.requestId, { itemId: it?.id, origin: it ? `[data-act="abrir"][data-item="${it.id}"]` : '#agTitulo' });
  }
}

// ---------- o que a pessoa pode ----------
const canDo = (k) => {
  if (S.cat?.can) return !!S.cat.can[k];
  const p = S.ctx.perms || {};
  const map = { marcar: 'agenda.marcar', remarcar: 'agenda.remarcar', cancelar: 'agenda.cancelar', bloquear: 'agenda.bloquear', atender: 'agenda.atender', pacientes: 'agenda.pacientes', conflitos: 'conflitos.resolver' };
  if (S.ctx.admin && !A.can(p, 'agenda.ver')) return false;
  return k === 'atender' || k === 'pacientes' ? A.can(p, map[k]) : p[map[k]] === 'clinica';
};
const canConfig = () => S.ctx.admin || A.can(S.ctx.perms, 'agenda.configurar');
const isCentral = () => S.scope === 'central';
const isProf = () => S.scope === 'propria';
const showRemarcar = () => !isProf() && !S.missing.conflicts;
const unit = () => S.cat?.unit || {};
const procName = (id) => S.cat?.procedures?.find((p) => p.id === id)?.name || '';
const resources = () => S.cat?.resources || S.data?.resources || [];
const resName = (id) => resources().find((r) => r.id === id)?.name || '';
const today = () => A.dayIn(S.tz, Date.now());
const podeMarcar = () => canDo('marcar') && !S.missing.catalog && !S.missing.desk && S.cat?.active !== false;

// ---------- carga ----------
function rangeOf() {
  if (S.view === 'semana') return { from: A.mondayOf(S.day), days: 7 };
  if (S.view === 'hoje') return { from: today(), days: 1 };
  return { from: S.day, days: 1 };
}

// Quantos pedidos esperam resposta: a contagem do banco (agenda_requests_pending_count: só o número, sem dado de
// paciente e sem registro de leitura). Banco sem ela (antes da migração da 4.3): a lista de pedidos, que traz no máximo
// os 100 mais novos; com 100 linhas, o bloco avisa que pode haver mais (mais: true) em vez de um número exato.
async function contarPendentes(cid) {
  if (!S.missing.pendCount) {
    try {
      const r = await rpc('agenda_requests_pending_count', { p_clinic: cid });
      return r?.status === 'ok' && Number.isFinite(Number(r.pending)) ? { n: Number(r.pending), at: Date.now() } : null;
    } catch (err) {
      if (!isMissingFn(err)) return null;
      S.missing.pendCount = true;
    }
  }
  if (S.missing.requests) return null;
  try {
    const r = await rpc('agenda_requests', { p_clinic: cid, p_when: null, p_justification: null });
    if (r?.status !== 'ok') return null;
    const rows = r.requests || [];
    return { n: rows.filter((x) => x.status === 'pending').length, mais: rows.length >= 100, at: Date.now() };
  } catch (err) {
    if (isMissingFn(err)) S.missing.requests = true;
    return null;
  }
}

async function loadView({ quiet = false } = {}) {
  const me = S;
  const seq = ++S.seq;
  const cid = S.clinicId;
  const same = () => S === me && S.seq === seq && S.box.isConnected && !!$('#agRoot', S.box);
  if (!quiet) { const m = $('#agMain'); if (m) { m.setAttribute('aria-busy', 'true'); m.classList.add('ag-busy'); } }
  const jobs = [];
  let carregado = null;
  const comDados = ['hoje', 'dia', 'semana'].includes(S.view);
  const conflicts = showRemarcar() && comDados
    ? rpc('agenda_conflicts', { p_clinic: cid }).catch((err) => { if (isMissingFn(err)) S.missing.conflicts = true; return null; }) : null;
  // pedidos sem resposta (bloco "Precisa de atenção"): só quem vê os pedidos da clínica
  const pend = comDados && podePedidos() && !(S.missing.pendCount && S.missing.requests) ? contarPendentes(cid) : null;
  let per = null;
  try {
    if (S.view === 'mes') {
      jobs.push(rpc('agenda_month', { p_clinic: cid, p_month: A.monthStart(S.day) }));
    } else if (S.view === 'resumo') {
      // "Esta semana" e "Este mês" são sempre os de hoje (não o dia aberto antes em outra visão)
      per = A.periodRange(S.rs.period, today(), today(), S.rs);
      if (!per.error) {
        const filtros = {};
        if (S.f.proc) filtros.procedure_id = S.f.proc;
        if (S.f.res) filtros.resource_id = S.f.res;
        if (S.f.canal) filtros.channel = S.f.canal;
        jobs.push(S.missing.dash ? null : rpc('agenda_dashboard', { p_clinic: cid, p_from: per.from, p_to: per.to, p_filters: filtros })
          .catch((err) => { if (isMissingFn(err)) { S.missing.dash = true; return null; } throw err; }));
        jobs.push(podeFinanceiro() && !S.missing.fin ? rpc('agenda_dashboard_financeiro', { p_clinic: cid, p_from: per.from, p_to: per.to })
          .catch((err) => { if (isMissingFn(err)) S.missing.fin = true; return null; }) : null);
      }
    } else if (S.view === 'bloqueios') {
      jobs.push(S.missing.blocks ? null : rpc('agenda_blocks', { p_clinic: cid }).catch((err) => { if (isMissingFn(err)) { S.missing.blocks = true; return null; } throw err; }));
    } else {
      const { from, days } = rangeOf();
      carregado = { from, view: S.view };
      jobs.push(rpc('agenda_view', { p_clinic: cid, p_from: from, p_days: days }));
      jobs.push(S.missing.free || S.missing.catalog ? null : rpc('agenda_free', { p_clinic: cid, p_from: from, p_days: days })
        .catch((err) => { if (isMissingFn(err)) { S.missing.free = true; return null; } return null; }));
    }
    const [a, b] = await Promise.all(jobs);
    const k = await conflicts;
    const pn = await pend;
    if (!same()) return;
    if (pn) S.pend = pn;
    if (S.view === 'mes') {
      if (a?.status !== 'ok') throw Object.assign(new Error(a?.status), { result: a?.status });
      S.month = a;
    } else if (S.view === 'resumo') {
      if (a && a.status !== 'ok' && a.status !== 'invalid' && a.status !== 'forbidden') throw Object.assign(new Error(a.status), { result: a.status });
      S.dash = a; S.fin = b; S.dashPer = per;
    } else if (S.view === 'bloqueios') {
      S.blocks = a?.status === 'ok' ? a : null;
      if (a && a.status !== 'ok') throw Object.assign(new Error(a.status), { result: a.status });
    } else {
      if (a?.status !== 'ok') throw Object.assign(new Error(a?.status), { result: a?.status });
      S.data = a;
      S.tz = a.timezone || S.tz;
      S.version = a.version;
      S.free = b?.status === 'ok' ? b : null;
      S.loaded = carregado;   // o dia (e a visão) dos dados na memória: "Hoje" relê quando vira o dia
    }
    if (k?.status === 'ok') S.conflicts = (k.conflicts || []).filter((c) => A.REMARCAR_KINDS.includes(c.kind) && ['aberto', 'em_andamento'].includes(c.status));
    S.updatedAt = Date.now();
    S.loadError = null;
    if (S.version != null) vigiaDe(S.clinicId)?.seen(S.version);   // o vigia não recarrega por um aviso desta versão
  } catch (err) {
    if (!same()) return;
    if (S.ctx.lost()) return;
    S.loadError = err?.result ? A.actionText(err.result) : friendlyError(err, 'Não foi possível carregar a agenda agora.');
  }
  // a resposta chega com o foco em algum botão da agenda (Próximo, um item, o detalhe): ele continua lá.
  // Recarga automática (quiet) com a pessoa digitando num campo da área principal (bloqueio, período do resumo) ou
  // no meio de cancelar/remarcar no detalhe: essa parte espera ela sair do campo (adiado) ou terminar.
  const ativo = document.activeElement;
  const digitando = (sel) => quiet && !!ativo && ['INPUT', 'SELECT', 'TEXTAREA'].includes(ativo.tagName) && !!ativo.closest?.(sel);
  const mainEspera = digitando('#agMain');
  const detEspera = quiet && S.det && (S.det.sub || digitando('#agDet'));
  if (mainEspera && S.bl && $('#blForm')) readBlock();   // o que já foi digitado no bloqueio fica
  keepFocus(() => {
    drawTop();
    drawAtencao();
    drawRemarcar();
    if (mainEspera) S.adiado = true; else { S.adiado = false; drawMain(); }
    if (S.det && !detEspera) drawDetail();
  });
  const m = $('#agMain');
  if (m) { m.removeAttribute('aria-busy'); m.classList.remove('ag-busy'); }
  return !S.loadError;   // false: a área principal mostra o erro (quem chamou não diz "atualizada")
}

// A versão da agenda mudou (aviso do vigia): relê a visão aberta sem mexer no que a pessoa faz. Quem ouve a página
// só é avisado quando algo na tela mudou de verdade.
const assinatura = () => JSON.stringify([
  (S.data?.items || []).map((i) => [i.id, i.status, i.starts_at]), (S.data?.busy || []).map((b) => b.id), (S.data?.blocks || []).map((b) => b.id),
  (S.conflicts || []).map((k) => k.id), S.month?.days?.map((d) => [d.day, d.ativos, d.concluidos, d.faltas, d.cancelados, d.bloqueios]) || null,
  (S.blocks?.blocks || []).map((b) => b.id), S.dash?.total ?? null, S.pend?.n ?? null]);
async function recarregarPorAviso(reason = 'aviso') {
  if (S.recarregando) { S.recarregarDeNovo = reason; return; }
  S.recarregando = true;
  try {
    const antes = assinatura();
    const ok = await loadView({ quiet: true });
    if (!ok || !naTela()) return;
    if (reason === 'visible') msg('A agenda mudou enquanto esta página estava fechada: já está atualizada.', 'info');
    else if (assinatura() !== antes) falar('A agenda foi atualizada.');
  } finally { S.recarregando = false; }
  if (S.recarregarDeNovo) { const r = S.recarregarDeNovo; S.recarregarDeNovo = null; recarregarPorAviso(r); }
}

// "Hoje" mostra o dia de HOJE no fuso da clínica: a página aberta de um dia para o outro relê sozinha.
const virouODia = () => S.view === 'hoje' && S.loaded?.view === 'hoje' && S.loaded.from !== today();
async function lerHojeDeNovo() {
  if (S.virando) return;
  S.virando = true;
  try {
    const ok = await loadView({ quiet: true });
    if (ok) msg(`Virou o dia: a agenda de hoje (${A.fmtDayLong(today())}) foi carregada.`, 'info');
  } finally { S.virando = false; }
}
// Na meia-noite do fuso da clínica (e de novo a cada dia): "Hoje" relê; nas outras visões, o título ("Hoje, …") muda.
function agendarVirada() {
  clearTimeout(viradaTimer);
  const me = S;
  if (!me) return;
  const prox = Date.parse(A.localToUtc(A.addDaysTo(today(), 1), '00:00', S.tz));
  viradaTimer = setTimeout(() => {
    if (S !== me || !S.box.isConnected || !$('#agRoot', S.box)) return;
    if (virouODia()) lerHojeDeNovo(); else keepFocus(() => { drawTop(); drawMain(); });
    agendarVirada();
  }, Math.min(Math.max(prox - Date.now() + 2000, 1000), 2 ** 31 - 1));
}

async function onVisible() {
  if (document.visibilityState !== 'visible' || !S?.box.isConnected || !$('#agRoot', S.box) || S.version == null) return;
  if (virouODia()) { await lerHojeDeNovo(); agendarVirada(); return; }   // virou o dia com a página fechada
  if (vigiaDe(S.clinicId)?.active) return;   // o vigia confere a versão ao voltar (tempo-real.js)
  try {
    const v = await rpc('agenda_version', { p_clinic: S.clinicId });
    if (v?.status === 'ok' && Number(v.version) !== Number(S.version) && S?.box.isConnected && $('#agRoot', S.box)) {
      const ok = await loadView({ quiet: true });
      if (ok) msg('A agenda mudou enquanto esta página estava fechada: já está atualizada.', 'info');
    }
  } catch { /* sem internet agora: a próxima ação relê */ }
}

// ---------- casca ----------
function shell() {
  // #agMsg: o aviso à vista. #agFala: o que o leitor de tela fala (escondida, mas sempre na página: uma região viva que
  // só aparece junto com o texto não costuma ser anunciada). Erro vai como alerta dentro do #agMsg.
  S.box.innerHTML = `<div class="ag" id="agRoot">
      <div id="agTop"></div>
      <div id="agMsg" class="ag-msg"></div>
      <div id="agFala" class="sr" role="status" aria-live="polite" aria-atomic="true"></div>
      <div id="agForms"></div>
      <div id="agAtencao"></div>
      <div id="agRem"></div>
      <div id="agBuscaBox"></div>
      <div class="ag-corpo" id="agCorpo"><div id="agMain" class="ag-main"></div><aside id="agDet" class="ag-det" aria-labelledby="agDetT" hidden></aside></div>
    </div>`;
  S.box.onclick = onClick;
  S.box.onchange = onChange;
  S.box.oninput = onInput;
  S.box.onsubmit = onSubmit;
  S.box.onkeydown = onKey;
  // sair do campo "Ir para a data" vale a data digitada (focusout sobe até a caixa; um ouvinte só por caixa)
  if (!S.box.dataset.agFocusout) {
    S.box.dataset.agFocusout = '1';
    S.box.addEventListener('focusout', (e) => {
      if (!S) return;
      if (e.target.id === 'agData') irParaData(true);
      // uma recarga automática esperou a pessoa terminar de digitar: desenha agora (sem o campo em uso)
      if (S.adiado && e.target.closest?.('#agMain') && !(e.relatedTarget && e.relatedTarget.closest?.('#agMain') && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.relatedTarget.tagName))) {
        S.adiado = false;
        if (S.bl && $('#blForm')) readBlock();
        setTimeout(() => { if (S && !S.adiado && naTela()) keepFocus(drawMain); }, 0);
      }
    });
  }
  drawTop();
  drawSearch();
}

// botao: { act, label } — um atalho logo abaixo do aviso (ex.: "Novo agendamento"), pelo mesmo data-act da tela.
// Cada resultado é dito UMA vez: o erro pelo alerta (role="alert") do próprio aviso; o resto pela #agFala. flutuante:
// o mesmo texto também no aviso do alto da tela (para quem rolou a página), só para os olhos.
function msg(text, kind = 'ok', botao = null, { flutuante = false } = {}) {
  const m = $('#agMsg');
  if (!m) { if (text) toast(text); return; }   // a agenda saiu da tela: o aviso do alto fala
  m.innerHTML = text ? `${kind === 'err' ? note(esc(text), 'err') : `<p class="cl-note ${kind}">${esc(text)}</p>`}${botao ? `<div class="cl-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="${esc(botao.act)}" id="agMsgBtn">${esc(botao.label)}</button></div>` : ''}` : '';
  if (kind !== 'err') falar(text);
  if (flutuante && text) toast(text, { falar: false });
}

// Depois de trocar de visão ou de dia, o foco fica no botão usado (Próximo, Dia…): o novo período é dito em voz.
function periodoFalado() {
  if (S.view === 'hoje') return `Mostrando hoje, ${A.fmtDayLong(today())}.`;
  if (S.view === 'dia') return `Mostrando ${S.day === today() ? 'hoje, ' : ''}${A.fmtDayLong(S.day)}.`;
  if (S.view === 'semana') { const seg = A.mondayOf(S.day); return `Mostrando a semana de ${A.fmtDayLong(seg)} a ${A.fmtDayLong(A.addDaysTo(seg, 6))}.`; }
  if (S.view === 'mes') return `Mostrando ${A.fmtMonth(S.day)}.`;
  if (S.view === 'resumo') return 'Mostrando o resumo da agenda.';
  return 'Mostrando os bloqueios.';
}
const anunciarPeriodo = () => falar(periodoFalado());

// "Ir para a data": o Chrome avisa (change) a cada parte digitada (dia, mês, ano), já com uma data inteira. A data só vale
// quando a pessoa termina: Enter, sair do campo ou 0,8 s sem mexer (escolher no calendário vale na hora). O campo nunca é
// desenhado de novo enquanto está em uso (patch na barra de cima).
let dataTimer = null;
// No meio da digitação do ano o campo já tem datas "inteiras" como 0002-11-20 ou 0202-11-20: só vale ano de 2000 a 2099.
const dataBoa = (v) => /^20\d{2}-\d{2}-\d{2}$/.test(v || '');
function irParaData(now = false) {
  clearTimeout(dataTimer);
  const t = $('#agData');
  if (!S || !t) return;
  const v = t.value;
  if (!dataBoa(v)) { if (now && t !== document.activeElement) t.value = S.day; return; }   // saiu com a data pela metade
  if (v === S.day) return;
  if (!now) { dataTimer = setTimeout(() => irParaData(true), 800); return; }
  S.day = v; S.det = null;
  keepFocus(() => { drawTop(); drawDetail(); drawMain(); });
  anunciarPeriodo();
  loadView();
}

// ---------- barra de cima ----------
function navLabel(dir) {
  if (S.view === 'semana') {
    const seg = A.addDaysTo(A.mondayOf(S.day), dir * 7);
    return `${dir < 0 ? 'Semana anterior' : 'Próxima semana'}: de ${A.fmtDayLong(seg)} a ${A.fmtDayLong(A.addDaysTo(seg, 6))}`;
  }
  if (S.view === 'mes') {
    const d = new Date(`${A.monthStart(S.day)}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + dir);
    return `${dir < 0 ? 'Mês anterior' : 'Próximo mês'}: ${A.fmtMonth(d.toISOString().slice(0, 10))}`;
  }
  return `${dir < 0 ? 'Dia anterior' : 'Próximo dia'}: ${A.fmtDayLong(A.addDaysTo(S.day, dir))}`;
}

function titleText() {
  if (S.view === 'hoje') return `Hoje, ${A.fmtDayLong(today())}`;
  if (S.view === 'dia') return `${S.day === today() ? 'Hoje, ' : ''}${A.fmtDayLong(S.day)}`;
  if (S.view === 'semana') { const seg = A.mondayOf(S.day); return `Semana de ${A.fmtDayLong(seg)} a ${A.fmtDayLong(A.addDaysTo(seg, 6))}`; }
  if (S.view === 'mes') { const t = A.fmtMonth(S.day); return t.charAt(0).toUpperCase() + t.slice(1); }
  if (S.view === 'resumo') return 'Resumo da agenda';
  return 'Bloqueios';
}

// "Atualizado às 10:02 · atualização automática ligada" (o vigia de tempo-real.js). Sem promessa de "tempo real":
// o aviso é um acelerador; a conferência periódica é a garantia (arquitetura §7).
function quandoText() {
  if (!S.updatedAt) return '';
  const v = vigiaDe(S.clinicId)?.state;
  const modo = v?.mode === 'ao_vivo' ? 'atualização automática ligada' : v?.mode === 'consultando' ? `confere a cada ${Math.round(POLL_ALONE_MS / 1000)} s` : '';
  return `Atualizado às ${A.timeIn(S.tz, new Date(S.updatedAt).toISOString())}${modo ? ` · ${modo}` : ''}`;
}

// As notas do alto (avisos da agenda e a faixa "sem conexão" do vigia).
function notesHtml() {
  const notes = [];
  if (S.missing.catalog) notes.push(note('Esta parte da agenda ainda não está disponível. Por enquanto aparece só a grade dos agendamentos.', 'warn'));
  if (S.cat && !S.cat.active) notes.push(note(`A agenda desta clínica ainda não foi ativada.${canConfig() ? ' Ative em <button class="link" type="button" data-act="config">Configurar agenda</button>.' : ' Peça ao dono ou gestor da clínica para ativar.'}`, 'warn'));
  if (isProf() && S.cat && !S.cat.resources.length) notes.push(note('Nenhum aparelho, sala ou profissional está ligado à sua conta nesta clínica. Peça a quem configura a agenda para ligar você ao seu cadastro de profissional.', 'warn'));
  if (isCentral()) notes.push(note('Você vê a agenda desta clínica como equipe do IMED: a grade aparece sem nomes; para abrir os dados de um paciente, escolha o motivo (fica registrado).', 'info'));
  if (S.missing.desk && canDo('marcar')) notes.push(note('Horários livres indisponíveis no momento: o novo agendamento pelo balcão volta quando o banco for atualizado.', 'warn'));
  if (vigiaDe(S.clinicId)?.state.offline) notes.push(`<p class="cl-note warn ag-semrede" role="status">${icon('fa-wifi')}Sem conexão com o IMED agora. A agenda pode estar desatualizada; a página tenta de novo sozinha.</p>`);
  return notes.join('');
}
// O estado do vigia mudou: só o "Atualizado às …" e as notas (o título e os botões ficam como estão).
function drawEstado() {
  const q = $('#agQuando');
  if (q) q.textContent = quandoText();
  const n = $('#agTop .ag-notas');
  if (n) patch(n, notesHtml());
}

function drawTop() {
  const top = $('#agTop');
  if (!top) return;
  const views = VIEWS.filter(([k]) => !((k === 'bloqueios' || k === 'resumo') && isProf()));
  const nav = ['dia', 'semana', 'mes'].includes(S.view);
  const tzn = A.tzNote(S.tz, Intl.DateTimeFormat().resolvedOptions().timeZone, Date.now());
  const deskOk = podeMarcar();
  const grade = ['dia', 'semana'].includes(S.view) && wide();
  // patch (não innerHTML): o botão com o foco e o campo de data em uso continuam os mesmos depois de cada carga
  patch(top, `<div class="ag-notas">${notesHtml()}</div>
    <div class="ag-bar">
      <div class="ag-views" role="group" aria-label="Visão da agenda">
        ${views.map(([k, n]) => `<button type="button" class="ag-vbtn" data-view="${k}" aria-pressed="${S.view === k}">${esc(n)}</button>`).join('')}
      </div>
      <div class="ag-acts">
        ${deskOk ? `<button type="button" class="btn btn-primary btn-sm" id="agNovo" data-act="novo">${icon('fa-calendar-plus')}Novo agendamento</button>` : ''}
        ${canDo('marcar') && !S.missing.catalog && S.cat?.active !== false ? `<button type="button" class="btn btn-ghost btn-sm" id="agOcupar" data-act="ocupar">${icon('fa-hand')}Só ocupar horário</button>` : ''}
        ${canDo('bloquear') && !isProf() && S.cat?.active !== false ? `<button type="button" class="btn btn-ghost btn-sm" id="agBloquear" data-act="bloquear">${icon('fa-lock')}Bloquear horário</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" id="agAtualizar" data-act="atualizar">${icon('fa-rotate-right')}Atualizar</button>
        <span class="ag-quando" id="agQuando">${esc(quandoText())}</span>
      </div>
    </div>
    <div class="ag-head">
      <h3 class="ac-h ag-titulo" id="agTitulo" tabindex="-1">${esc(titleText())}</h3>
      ${tzn ? `<p class="ag-tz">${icon('fa-circle-info')}${esc(tzn)}</p>` : ''}
    </div>
    ${nav ? `<div class="ag-nav">
        <button type="button" class="btn btn-ghost btn-sm" data-act="ant">${icon('fa-chevron-left')}Anterior${sr(` (${esc(navLabel(-1))})`)}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="hojebtn">Ir para hoje</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="prox">Próximo${sr(` (${esc(navLabel(1))})`)}${icon('fa-chevron-right')}</button>
        <label class="ag-ir"><span>Ir para a data</span><input type="date" id="agData" value="${esc(S.day)}"></label>
        ${grade ? `<button type="button" class="btn btn-ghost btn-sm ag-modo" id="agModo" data-act="modo">${icon(S.listMode ? 'fa-calendar-days' : 'fa-list')}${S.listMode ? 'Ver em grade' : 'Ver em lista'}</button>` : ''}
      </div>` : ''}
    ${['dia', 'semana', 'hoje', 'resumo'].includes(S.view) ? filtersHtml() : ''}
    ${['dia', 'semana', 'hoje'].includes(S.view) ? legendHtml() : ''}`);
}

function filtersHtml() {
  const procs = S.cat?.procedures || [];
  const res = resources();
  const byKind = A.KINDS.concat('chegadas').map((k) => [k, res.filter((r) => r.kind === k)]).filter(([, l]) => l.length);
  const canais = Object.entries(A.CHANNEL_LABEL);
  const on = S.f.proc || S.f.res || S.f.canal || S.f.cancel;
  return `<details class="ag-filtros" id="agFiltros"${wide() || on ? ' open' : ''}>
      <summary>${icon('fa-filter')}Filtros${on ? ' (ligados)' : ''}</summary>
      <div class="ag-fgrid">
        ${procs.length ? `<div class="cl-field"><label class="cl-lbl" for="agFExame">Exame</label>
          <select id="agFExame" data-f="proc"><option value="">Todos os exames</option>${opts(procs.map((p) => [p.id, p.name]), S.f.proc)}</select></div>` : ''}
        ${res.length ? `<div class="cl-field"><label class="cl-lbl" for="agFRec">Aparelho, sala ou profissional</label>
          <select id="agFRec" data-f="res"><option value="">Todos</option>${byKind.map(([k, l]) => `<optgroup label="${esc(A.KIND_LABEL[k] || k)}">${opts(l.map((r) => [r.id, r.name]), S.f.res)}</optgroup>`).join('')}</select></div>` : ''}
        <div class="cl-field"><label class="cl-lbl" for="agFCanal">Origem</label>
          <select id="agFCanal" data-f="canal"><option value="">Todas</option>${opts(canais, S.f.canal)}</select></div>
        ${S.view === 'resumo' ? '' : `<label class="cl-check ag-fcheck"><input type="checkbox" id="agFCancel" data-f="cancel"${S.f.cancel ? ' checked' : ''}><span>Mostrar cancelados</span></label>`}
      </div>
    </details>`;
}

function legendHtml() {
  return `<details class="ag-legenda" id="agLegenda"${wide() ? ' open' : ''}>
      <summary>Legenda das cores</summary>
      <ul class="ag-leg">${A.LEGENDA.map((g) => g.items.map(([ic, t]) => `<li class="ag-tom-${g.tone}${ic ? '' : ' ag-leg-fechado'}">${icon(ic)}<span>${esc(t)}</span></li>`).join('')).join('')}</ul>
    </details>`;
}

// ---------- busca ----------
function drawSearch() {
  const box = $('#agBuscaBox');
  if (!box) return;
  if (isCentral() || !canDo('pacientes') || S.missing.catalog) { box.innerHTML = ''; return; }
  const b = S.busca;
  box.innerHTML = `<form class="ag-busca" id="agBusca" role="search" novalidate>
      <label class="cl-lbl" for="agBuscaQ">Buscar paciente <small>(${isProf() ? 'pelo nome, nos seus agendamentos' : 'pelo nome ou pelo telefone'})</small></label>
      <div class="cl-row"><input type="search" id="agBuscaQ" maxlength="80" autocomplete="off" value="${esc(b?.q || '')}" aria-describedby="agBuscaErr">
        <button class="btn btn-ghost btn-sm" type="submit" id="agBuscaOk">${icon('fa-magnifying-glass')}Buscar</button></div>
      <span class="cl-err" id="agBuscaErr">${esc(b?.err || '')}</span>
      ${b?.results ? `<div id="agBuscaRes" class="ag-res">${b.results.length ? `<p class="cl-help">${b.results.length === 1 ? '1 resultado' : `${b.results.length} resultados`}:</p>
        <ul class="ag-lista">${b.results.map((r) => {
          const quando = r.slot_start ? A.fmtWhen(S.tz, r.slot_start) : `pedido sem horário${r.preferred_date ? `, data preferida ${A.fmtDDMM(r.preferred_date)}` : ''}`;
          const tag = A.statusTag(r.status, null, S.tz);
          return `<li class="ag-li ag-tom-${tag.tone}"><button type="button" class="ag-ev" data-act="abrir" data-req="${esc(r.id)}">
            <span class="ag-nome">${esc(r.name)}</span>${SEP}<span class="ag-exame">${esc(quando)} · ${esc(examName(r.exam_code))}${r.phone_end ? ` · final do telefone ${esc(r.phone_end)}` : ''}</span>${SEP}
            <span class="ag-st">${icon(tag.icon)}${esc(tag.text)}</span></button></li>`;
        }).join('')}</ul>` : '<p class="cl-help">Nenhum paciente encontrado com essa busca.</p>'}</div>` : ''}
    </form>`;
}

async function doSearch() {
  const q = $('#agBuscaQ').value.trim().replace(/\s+/g, ' ');
  S.busca = { q };
  if (q.length < 3) { S.busca.err = A.ACTION_TEXT.too_short; drawSearch(); $('#agBuscaQ').setAttribute('aria-invalid', 'true'); $('#agBuscaQ').focus(); return; }
  const btn = $('#agBuscaOk'); btn.disabled = true;
  try {
    const r = await rpc('agenda_search', { p_clinic: S.clinicId, p_q: q });
    if (r?.status !== 'ok') { S.busca.err = A.actionText(r?.status); drawSearch(); $('#agBuscaQ').focus(); return; }
    S.busca.results = r.results || [];
    drawSearch();
    ($('#agBuscaRes [data-act="abrir"]') || $('#agBuscaQ')).focus();
  } catch (err) {
    if (S.ctx.lost()) return;
    S.busca.err = isNetwork(err) ? A.ACTION_TEXT.network : friendlyError(err, 'Não foi possível buscar agora.');
    drawSearch();
    $('#agBuscaQ').focus();
  }
}

// ---------- Para remarcar ----------
function drawRemarcar() {
  const box = $('#agRem');
  if (!box) return;
  const list = S.conflicts || [];
  if (!showRemarcar() || !['hoje', 'dia'].includes(S.view) || !list.length) { box.innerHTML = ''; return; }
  const podeResolver = canDo('conflitos');
  box.innerHTML = `<section class="ag-rem" aria-labelledby="agRemT">
      <h3 class="ac-h" id="agRemT" tabindex="-1">${icon('fa-triangle-exclamation')}Para remarcar (${list.length})</h3>
      <p class="cl-help">Ligue para o paciente, combine um novo horário e remarque aqui.</p>
      <ul class="ag-remlista">${list.map((k) => {
        const quando = k.details?.starts_at || k.starts_at;
        const proc = procName(k.procedure_id || k.details?.procedure_id) || 'Exame';
        return `<li class="ag-tom-amarelo" id="agk-${esc(k.id)}"><span><b>${esc(quando ? A.fmtWhen(S.tz, quando) : 'Sem horário')}</b> · ${esc(proc)}<small>${icon('fa-rotate')}${esc(A.CONFLICT_KIND[k.kind] || k.kind)}</small></span>
          <span class="ag-remacts">
            <button type="button" class="btn btn-ghost btn-sm" data-act="conf-ver" data-k="${esc(k.id)}">Ver paciente<span class="sr"> do exame de ${esc(quando ? A.fmtWhen(S.tz, quando) : '')}</span></button>
            ${podeResolver && canDo('remarcar') ? `<button type="button" class="btn btn-primary btn-sm" data-act="conf-remarcar" data-k="${esc(k.id)}">Remarcar<span class="sr"> o exame de ${esc(quando ? A.fmtWhen(S.tz, quando) : '')}</span></button>` : ''}
            ${podeResolver && canDo('cancelar') ? `<button type="button" class="btn btn-ghost btn-sm" data-act="conf-cancelar" data-k="${esc(k.id)}">Cancelar<span class="sr"> o exame de ${esc(quando ? A.fmtWhen(S.tz, quando) : '')}</span></button>` : ''}
            ${podeResolver && k.kind === 'grade_mudou' ? `<button type="button" class="btn btn-ghost btn-sm" data-act="conf-manter" data-k="${esc(k.id)}">Manter este horário</button>` : ''}
            ${podeResolver && k.kind !== 'grade_mudou' ? (S.remAsk === k.id
              ? `<span class="ag-ask" role="group" aria-labelledby="agkT-${esc(k.id)}"><span id="agkT-${esc(k.id)}">Tirar da lista sem remarcar por aqui? Use quando o paciente já foi remarcado ou avisado por outro caminho.</span>
                <button type="button" class="btn btn-primary btn-sm" data-act="conf-tirar-sim" data-k="${esc(k.id)}" id="agkSim">Sim, tirar da lista</button><button type="button" class="btn btn-ghost btn-sm" data-act="conf-tirar-nao" data-k="${esc(k.id)}">Voltar</button></span>`
              : `<button type="button" class="btn btn-ghost btn-sm" data-act="conf-tirar" data-k="${esc(k.id)}">Tirar da lista<span class="sr"> o exame de ${esc(quando ? A.fmtWhen(S.tz, quando) : '')}</span></button>`) : ''}
          </span></li>`;
      }).join('')}</ul>
    </section>`;
}

// ---------- área principal ----------
function filtered(items) {
  return (items || []).filter((it) => (S.f.cancel || it.status !== 'cancelled')
    && (!S.f.proc || it.procedure_id === S.f.proc)
    && (!S.f.res || (it.resources || []).includes(S.f.res))
    && (!S.f.canal || it.channel === S.f.canal));
}
const visibleResources = () => {
  let list = resources().filter((r) => r.active !== false || (S.data?.items || []).some((i) => (i.resources || []).includes(r.id)));
  if (S.f.res) list = list.filter((r) => r.id === S.f.res);
  else if (S.f.proc) {
    const p = S.cat?.procedures?.find((x) => x.id === S.f.proc);
    const ids = new Set((p?.groups || []).flatMap((g) => g.resource_ids || []));
    if (ids.size) list = list.filter((r) => ids.has(r.id));
  }
  return list;
};

// O detalhe fica ao lado da grade só quando a grade inteira cabe ao lado dele (senão, os dias ou as colunas da direita
// sumiriam atrás de uma rolagem): na Semana, e no Dia com muitos aparelhos, ele vai para baixo da grade.
const COLMIN = { dia: 128, semana: 118 };   // a largura mínima da coluna (--colmin do clinica.css)
function detalheAoLado() {
  if (!S.det || !wide()) return false;
  if (S.listMode || !['dia', 'semana'].includes(S.view)) return true;
  const cols = S.view === 'semana' ? 7 : Math.max(visibleResources().length, 1);
  return 58 + cols * COLMIN[S.view] + 2 <= ($('#agCorpo')?.clientWidth || 0) - 374;
}

function drawMain() {
  const m = $('#agMain');
  if (!m) return;
  $('#agCorpo')?.classList.toggle('ag-com-det', detalheAoLado());
  if (S.det && !wide()) { m.hidden = true; return; }
  m.hidden = false;
  if (S.loadError) {
    m.innerHTML = `${note(esc(S.loadError), 'err')}<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" data-act="atualizar">Tentar de novo</button></div>`;
    return;
  }
  if (S.view === 'mes') { m.innerHTML = S.month ? monthHtml() : loading('Carregando o mês…'); return; }
  if (S.view === 'resumo') { m.innerHTML = resumoHtml(); return; }
  if (S.view === 'bloqueios') { m.innerHTML = blocksViewHtml(); return; }
  if (!S.data) { m.innerHTML = loading('Carregando a agenda…'); return; }
  const free = S.missing.free && !S.missing.catalog ? note('Horários livres indisponíveis no momento.', 'warn') : '';
  const fer = holidayNotes();
  const lim = limitNote();
  if (S.view === 'hoje') {
    if (virouODia()) { m.innerHTML = loading('Virou o dia: carregando a agenda de hoje…'); lerHojeDeNovo(); return; }
    m.innerHTML = `${free}${fer}${lim}${listHtml(today(), { attend: true })}`;
    return;
  }
  if (S.view === 'dia') { m.innerHTML = `${free}${fer}${lim}${wide() && !S.listMode ? dayGridHtml() : listHtml(S.day, { attend: true })}`; return; }
  m.innerHTML = `${free}${fer}${lim}${wide() && !S.listMode ? weekGridHtml() : weekListHtml()}`;
}

function holidayNotes() {
  const h = S.free?.holidays || [];
  if (!h.length) return '';
  const fecha = S.free.closes_on_holidays !== false;
  return h.map((x) => note(`${icon('fa-flag')} Feriado em ${esc(A.fmtDayShort(x.day))}: ${esc(x.name)}. ${x.open || !fecha ? 'A clínica atende neste dia.' : 'A clínica não atende neste dia.'}`, 'warn')).join('');
}
// Depois de até quando os feriados foram conferidos, o balcão não marca (a grade mostra os livres, mas avisa).
function limitNote() {
  if (!S.free || S.missing.catalog) return '';
  const lim = [S.free.holidays_checked_until, S.free.national_holidays_until];
  const { from, days } = rangeOf();
  const ultimo = A.addDaysTo(from, days - 1);
  if (!lim[1]) return note('Nenhum horário pode ser marcado ainda: o IMED ainda não lançou os feriados nacionais.', 'warn');
  if (!lim[0]) return note('Nenhum horário pode ser marcado ainda: falta informar até quando a clínica conferiu os feriados da cidade e do estado.', 'warn');
  const limite = lim.filter(Boolean).sort()[0];
  return ultimo > limite ? note(`Depois de ${esc(A.fmtDDMMYYYY(limite))} nenhum horário pode ser marcado: os feriados só foram conferidos até essa data.`, 'warn') : '';
}

// Itens, "ocupados" e bloqueios de um dia, em ordem do tempo (para a lista).
function dayEntries(day) {
  const ini = Date.parse(A.localToUtc(day, '00:00', S.tz));
  const fim = Date.parse(A.localToUtc(A.addDaysTo(day, 1), '00:00', S.tz));
  const inDay = (x) => Date.parse(x.starts_at) < fim && Date.parse(x.ends_at) > ini;
  const items = filtered(S.data?.items).filter(inDay).map((it) => ({ type: 'item', t: Date.parse(it.starts_at), it }));
  const busy = (S.data?.busy || []).filter(inDay).filter((b) => !S.f.res || (b.resources || []).includes(S.f.res)).map((b) => ({ type: 'busy', t: Date.parse(b.starts_at), b }));
  const blocks = (S.data?.blocks || []).filter(inDay).filter((b) => !S.f.res || !b.resource_id || b.resource_id === S.f.res).map((b) => ({ type: 'block', t: Math.max(Date.parse(b.starts_at), ini), b }));
  return [...blocks, ...busy, ...items].sort((a, b) => a.t - b.t);
}

function itemResNames(it) { return (it.resources || []).map(resName).filter(Boolean); }

// dia: na grade da Semana, o dia por extenso no começo do nome falado (lá o dia só aparece pela coluna).
function itemButton(it, { compact = false, extra = '', dia = null } = {}) {
  const tag = A.statusTag(it.status, it.hold_expires_at, S.tz);
  const nomes = itemResNames(it);
  const nome = it.patient || (S.data?.patients === false || isCentral() ? 'Paciente' : '');
  const ini = A.timeIn(S.tz, it.starts_at);
  const fim = A.timeIn(S.tz, it.ends_at);
  if (compact) {
    // Na grade cabe pouco: a situação curta à vista e a completa (com o fim e os aparelhos) para quem ouve. A palavra
    // à vista está sempre no nome falado ("Faltou (Não compareceu)"): quem usa comando de voz diz o que vê.
    const st = tag.short === tag.text ? `<span class="ag-st-t">${esc(tag.text)}</span>`
      : tag.text.toLowerCase().includes(tag.short.toLowerCase()) ? `<span class="ag-st-t" aria-hidden="true">${esc(tag.short)}</span>${sr(esc(tag.text))}`
        : `<span class="ag-st-t">${esc(tag.short)}</span>${sr(` (${esc(tag.text)})`)}`;
    return `<button type="button" class="ag-ev ag-ev-grade ag-tom-${tag.tone}" data-act="abrir" data-item="${esc(it.id)}"${extra}>
      ${dia ? sr(`${esc(A.fmtDayLong(dia))}, `) : ''}<span class="ag-hora">${esc(ini)}</span>${sr(` às ${esc(fim)}`)}${SEP}<span class="ag-st">${icon(tag.icon)}${st}</span>${SEP}
      <span class="ag-nome">${esc(nome)}</span>${SEP}<span class="ag-exame">${esc(it.procedure || '')}</span>${nomes.length ? sr(`, ${esc(nomes.join(' e '))}`) : ''}</button>`;
  }
  return `<button type="button" class="ag-ev ag-tom-${tag.tone}" data-act="abrir" data-item="${esc(it.id)}"${extra}>
      <span class="ag-hora">${faixa(ini, fim)}</span>${SEP}
      <span class="ag-nome">${esc(nome)}</span>${nome ? SEP : ''}
      <span class="ag-exame">${esc(it.procedure || '')}${nomes.length ? ` · ${esc(nomes.join(', '))}` : ''}${it.channel ? ` · ${esc(A.CHANNEL_LABEL[it.channel] || '')}` : ''}</span>${SEP}
      <span class="ag-st">${icon(tag.icon)}${esc(tag.text)}</span>
    </button>`;
}

// As ações de atendimento do item AGORA, com a permissão de verdade (a mesma regra dos botões).
const attendActs = (it) => A.attendActions(it, unit(), Date.now(), S.tz, { scope: S.scope, can: { atender: canDo('atender') && !(isProf() && S.missing.attend) } });
const attendActionFor = (it, key) => attendActs(it).find((a) => a.key === key) || null;

function attendButtons(it, where) {
  const acts = attendActs(it);
  if (!acts.length) return '';
  const ocupado = S.busy.has(it.id);
  return `<div class="ag-acoes" role="group" aria-label="Atendimento: ${esc(it.patient || 'paciente')}, ${esc(A.timeIn(S.tz, it.starts_at))}"${ocupado ? ' aria-busy="true"' : ''}>
    ${acts.map((a) => `<span class="ag-acao"><button type="button" class="btn ${a.key === 'faltou' || a.key === 'desfazer' || (a.key === 'concluido' && it.status === 'confirmed') ? 'btn-ghost' : 'btn-primary'} btn-sm" data-act="atender" data-item="${esc(it.id)}" data-k="${a.key}" data-w="${where}"${a.enabled ? (ocupado ? ' aria-disabled="true"' : '') : ` disabled aria-describedby="agh-${where}-${esc(it.id)}-${a.key}"`}>${esc(a.label)}</button>${a.hint ? `<small class="ag-hint" id="agh-${where}-${esc(it.id)}-${a.key}">${esc(a.hint)}</small>` : ''}</span>`).join('')}
  </div>`;
}

// Enquanto a chamada de um item está em andamento, os botões dele (e o "Sim" da pergunta) ficam desligados SEM sair
// da tela (aria-disabled: o foco fica onde está; o clique é ignorado). O desenho seguinte já vem sem a marca.
function markBusy(itemId) {
  for (const b of $$(`[data-act="atender"][data-item="${CSS.escape(itemId)}"]:not([disabled])`)) b.setAttribute('aria-disabled', 'true');
  if (S.ask?.itemId === itemId) $('#agAskSim')?.setAttribute('aria-disabled', 'true');
}

function askHtml(it, where) {
  const a = S.ask;
  if (!a || a.itemId !== it.id || a.where !== where) return '';
  if (!attendActionFor(it, a.key)) { S.ask = null; return ''; }   // a situação mudou: a pergunta velha sai
  const nome = it.patient || 'o paciente';
  const quando = `${A.fmtDDMM(A.dayIn(S.tz, Date.parse(it.starts_at)))}, ${A.timeIn(S.tz, it.starts_at)}`;
  if (a.key === 'concluido') {
    return `<div class="ag-ask" role="group" aria-labelledby="agAskT"><p id="agAskT">Marcar o exame de ${esc(nome)} como concluído? Depois disso, só o IMED corrige.</p>
      <div class="cl-actions"><button type="button" class="btn btn-primary btn-sm" data-act="sim" id="agAskSim">Sim, concluído</button><button type="button" class="btn btn-ghost btn-sm" data-act="voltar-ask">Voltar</button></div></div>`;
  }
  if (a.key === 'faltou') {
    return `<div class="ag-ask" role="group" aria-labelledby="agAskT"><p id="agAskT">Marcar que ${esc(nome)} não compareceu (${esc(quando)})?</p>
      <div class="cl-actions"><button type="button" class="btn btn-primary btn-sm" data-act="sim" id="agAskSim">Sim, não compareceu</button><button type="button" class="btn btn-ghost btn-sm" data-act="voltar-ask">Voltar</button></div></div>`;
  }
  if (a.key === 'desfazer') {
    return `<div class="ag-ask" role="group" aria-labelledby="agAskT"><p id="agAskT">Desfazer a falta de ${esc(nome)} (${esc(quando)})? O paciente volta a ficar presente.</p>
      <div class="cl-field"><label class="cl-lbl" for="agAskMotivo">Motivo</label>
        <select id="agAskMotivo" aria-describedby="agAskMotivoErr"><option value="">Escolha o motivo</option>${opts(A.UNDO_NO_SHOW_REASONS, a.reason)}</select>
        <span class="cl-err" id="agAskMotivoErr">${esc(a.err || '')}</span></div>
      <div class="cl-actions"><button type="button" class="btn btn-primary btn-sm" data-act="sim" id="agAskSim">Sim, desfazer a falta</button><button type="button" class="btn btn-ghost btn-sm" data-act="voltar-ask">Voltar</button></div></div>`;
  }
  return '';
}

function listHtml(day, { attend = false } = {}) {
  const entries = dayEntries(day);
  if (!entries.length) {
    return `<p class="cl-help ag-vazio">${day === today() ? 'Nenhum agendamento hoje.' : `Nenhum agendamento em ${esc(A.fmtDayLong(day))}.`}${S.f.proc || S.f.res || S.f.canal ? ' (Com os filtros ligados.)' : ''}</p>`;
  }
  const groups = new Map();
  for (const e of entries) {
    const h = `${A.timeIn(S.tz, new Date(e.t).toISOString()).slice(0, 2)}:00`;
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(e);
  }
  // cada hora é um título (h4), não uma região: até 12 marcos por dia só atrapalhariam quem navega por marcos
  return `<div class="ag-listas">${[...groups].map(([h, list]) => `<div class="ag-hgrupo"><h4 class="ag-hh">${esc(h)}</h4>
      <ul class="ag-lista">${list.map((e) => entryLi(e, attend)).join('')}</ul></div>`).join('')}</div>`;
}

function entryLi(e, attend) {
  if (e.type === 'item') {
    const it = e.it;
    const tone = A.statusTag(it.status, it.hold_expires_at, S.tz).tone;
    return `<li class="ag-li ag-tom-${tone}" id="agi-${esc(it.id)}">${itemButton(it)}${attend ? attendButtons(it, 'l') : ''}${askHtml(it, 'l')}</li>`;
  }
  if (e.type === 'busy') {
    const b = e.b; const look = A.busyLook(b.reason_code);
    const nomes = (b.resources || []).map(resName).filter(Boolean);
    return `<li class="ag-li ag-tom-vermelho"><button type="button" class="ag-ev" data-act="ocupado" data-busy="${esc(b.id)}">
      <span class="ag-hora">${faixa(A.timeIn(S.tz, b.starts_at), A.timeIn(S.tz, b.ends_at))}</span>${SEP}<span class="ag-nome">${esc(look.text)}</span>
      ${nomes.length ? `${SEP}<span class="ag-exame">${esc(nomes.join(', '))}</span>` : ''}<span class="ag-st" aria-hidden="true">${icon(look.icon)}${esc(look.text)}</span></button></li>`;
  }
  const b = e.b; const look = A.blockLook(b.kind);
  const alvo = b.resource_id ? resName(b.resource_id) || 'Recurso' : 'Clínica inteira';
  return `<li class="ag-li ag-tom-vermelho"><div class="ag-ev ag-ev-fixo" role="group" aria-label="${esc(`${A.blockWhenTz(b, S.tz)}, ${look.text}, ${alvo}`)}">
      <span class="ag-hora">${esc(A.blockWhenTz(b, S.tz))}</span><span class="ag-nome">${esc(look.text)}</span>
      <span class="ag-exame">${esc(alvo)}${b.reason ? ` · ${esc(b.reason)}` : ''}</span><span class="ag-st">${icon(look.icon)}${esc(look.text)}</span></div></li>`;
}

// ---------- grade do dia (computador) ----------
function minutesOfDay(day, iso, clampStart, clampEnd) {
  const base = Date.parse(A.localToUtc(day, '00:00', S.tz));
  const v = (Date.parse(iso) - base) / 60000;
  return Math.max(clampStart, Math.min(clampEnd, v));
}
function rangeMinutes(day, entries) {
  let ini = Infinity; let fim = -Infinity;
  const base = Date.parse(A.localToUtc(day, '00:00', S.tz));
  const span = (a, b) => { const x = (Date.parse(a) - base) / 60000; const y = (Date.parse(b) - base) / 60000; ini = Math.min(ini, x); fim = Math.max(fim, y); };
  for (const [a, b] of S.free?.unit_open || []) if (Date.parse(a) < base + 1440 * 60000 && Date.parse(b) > base) span(a, b);
  for (const it of entries) span(it.starts_at, it.ends_at);
  if (!Number.isFinite(ini)) return [420, 1140];
  ini = Math.max(0, Math.floor(ini / 60) * 60);
  fim = Math.min(1440, Math.ceil(fim / 60) * 60);
  return fim - ini < 120 ? [Math.max(0, ini - 60), Math.min(1440, fim + 60)] : [ini, fim];
}
// Subtrai intervalos (minutos) de [a, b): devolve os pedaços que sobram.
function minus(a, b, cuts) {
  let parts = [[a, b]];
  for (const [x, y] of cuts) parts = parts.flatMap(([p, q]) => (y <= p || x >= q ? [[p, q]] : [[p, Math.max(p, x)], [Math.min(q, y), q]].filter(([u, v]) => v > u)));
  return parts;
}

function dayGridHtml() {
  const day = S.day;
  const cols = visibleResources();
  const items = filtered(S.data.items);
  const base = Date.parse(A.localToUtc(day, '00:00', S.tz));
  const fimDia = base + 1440 * 60000;
  const inDay = (x) => Date.parse(x.starts_at) < fimDia && Date.parse(x.ends_at) > base;
  const dItems = items.filter(inDay);
  const [g0, g1] = rangeMinutes(day, dItems);
  const rows = (g1 - g0) / 15;
  const agora = (Date.now() - base) / 60000;
  if (!cols.length) return `${note('Nenhum aparelho, sala ou profissional para mostrar com estes filtros.', 'info')}${listHtml(day, { attend: true })}`;
  const colIdx = new Map(cols.map((r, i) => [r.id, i]));
  const mm = (iso) => minutesOfDay(day, iso, g0, g1);
  const naCol = (x, id) => (x.resources || []).includes(id);
  const dBusy = (S.data.busy || []).filter(inDay);
  // altura da linha de 15 min: o item mais curto na tela fica com pelo menos 44 px (hora e situação à vista; alvo bom)
  const { rowh, minSpan } = A.gridScale([...dItems, ...dBusy].filter((x) => cols.some((r) => naCol(x, r.id))).map((x) => mm(x.ends_at) - mm(x.starts_at)));
  // "Livre" e "Fechado" só do agora em diante: o passado fica só com o véu "Já passou" (o texto por baixo dele perderia
  // o contraste) — e horário que já passou não está livre para marcar.
  const corte = Math.max(g0, Math.min(agora, g1));
  const futuro = (list) => list.map(([a, b]) => [Math.max(a, corte), b]).filter(([a, b]) => b > a);
  // fundo de cada coluna: livre (verde) e fechado (hachurado, com a palavra)
  const fundo = cols.map((r, c) => {
    const livres = (S.free?.resources || []).find((x) => x.id === r.id)?.free || [];
    const verdes = livres.map(([a, b]) => [mm(a), mm(b)]).filter(([a, b]) => b > a);
    const ocup = [...dItems.filter((i) => naCol(i, r.id)).map((i) => [mm(i.starts_at), mm(i.ends_at)]),
      ...dBusy.filter((b) => naCol(b, r.id)).map((b) => [mm(b.starts_at), mm(b.ends_at)]),
      ...(S.data.blocks || []).filter(inDay).filter((b) => !b.resource_id || b.resource_id === r.id).map((b) => [mm(b.starts_at), mm(b.ends_at)])];
    const fechado = S.missing.free || !S.free ? [] : minus(g0, g1, [...verdes, ...ocup]);
    return [...futuro(verdes).map(([a, b]) => `<div class="ag-livre" style="--c:${c};--r:${(a - g0) / 15};--s:${(b - a) / 15}" aria-hidden="true"><span>${icon('fa-check')}Livre</span></div>`),
      ...futuro(fechado).filter(([a, b]) => b - a >= 5).map(([a, b]) => `<div class="ag-fechado" style="--c:${c};--r:${(a - g0) / 15};--s:${(b - a) / 15}" aria-hidden="true"><span>Fechado</span></div>`)].join('');
  }).join('');
  // eventos: em ordem do tempo, em todas as colunas que usam. Agendamentos e "só ocupar" entram na mesma conta de raias
  // (com a altura mínima): nenhum cobre o outro na tela.
  const evs = [];
  let linhas = rows;   // a grade cresce para baixo se o último item, com a altura mínima, passar do fim
  const pos = (p, c) => { linhas = Math.max(linhas, p.row + p.span); return `class="ag-pos${p.lanes >= 3 ? ' ag-apertado' : ''}" style="--c:${c};--r:${p.row};--s:${p.span};--l:${p.lane};--n:${p.lanes}"`; };
  for (const r of cols) {
    const c = colIdx.get(r.id);
    const its = dItems.filter((i) => naCol(i, r.id));
    const ocs = dBusy.filter((b) => naCol(b, r.id));
    const outrosDe = (it) => (it.resources || []).filter((x) => x !== r.id).map(resName).filter(Boolean);
    // "também em: Sala 2" ocupa uma linha a mais embaixo do botão: o item precisa de mais altura
    const lay = A.layoutColumn([
      ...its.map((i) => ({ id: `i${i.id}`, start: mm(i.starts_at), end: mm(i.ends_at), minSpan: minSpan + (outrosDe(i).length ? 18 / rowh : 0) })),
      ...ocs.map((b) => ({ id: `b${b.id}`, start: mm(b.starts_at), end: mm(b.ends_at) })),
    ], g0, 15, minSpan);
    for (const it of its) {
      const outros = outrosDe(it);
      evs.push({ t: Date.parse(it.starts_at), c, html: `<div ${pos(lay[`i${it.id}`], c)}>${itemButton(it, { compact: true })}${outros.length ? `<small class="ag-tb">também em: ${esc(outros.join(', '))}</small>` : ''}</div>` });
    }
    for (const b of ocs) {
      const look = A.busyLook(b.reason_code);
      evs.push({ t: Date.parse(b.starts_at), c, html: `<div ${pos(lay[`b${b.id}`], c)}><button type="button" class="ag-ev ag-tom-vermelho" data-act="ocupado" data-busy="${esc(b.id)}"><span class="ag-hora">${esc(A.timeIn(S.tz, b.starts_at))}</span>${sr(` às ${esc(A.timeIn(S.tz, b.ends_at))}`)}${SEP}<span class="ag-st">${icon(look.icon)}<span class="ag-st-t">${esc(look.text)}</span></span>${sr(`, ${esc(r.name)}`)}</button></div>` });
    }
    for (const b of (S.data.blocks || []).filter(inDay).filter((x) => !x.resource_id || x.resource_id === r.id)) {
      const look = A.blockLook(b.kind);
      const a = mm(b.starts_at); const z = mm(b.ends_at);
      evs.push({ t: Date.parse(b.starts_at), c, html: `<div class="ag-pos ag-bloco" style="--c:${c};--r:${(a - g0) / 15};--s:${(z - a) / 15};--l:0;--n:1"><div class="ag-ev ag-ev-fixo ag-tom-vermelho" role="group" aria-label="${esc(`${A.blockWhenTz(b, S.tz)}, ${look.text}, ${b.resource_id ? r.name : 'Clínica inteira'}`)}"><span class="ag-st">${icon(look.icon)}${esc(look.text)}</span>${b.reason ? `<small>${esc(b.reason)}</small>` : ''}</div></div>` });
    }
  }
  evs.sort((a, b) => a.t - b.t || a.c - b.c);
  const fora = items.filter(inDay).filter((i) => !(i.resources || []).length);
  const horas = [];
  for (let m = g0; m < g1; m += 60) horas.push(`<span style="--r:${(m - g0) / 15}">${A.fromMin(m)}</span>`);
  const passou = agora > g0 ? Math.min(agora, g1) : null;
  return `<div class="ag-grade" style="--cols:${cols.length};--rows:${Math.ceil(linhas)};--rowh:${rowh}px">
      <div class="ag-grade-in">
        <div class="ag-cab"><span class="ag-cab-eixo" aria-hidden="true"></span>${cols.map((r) => `<span class="ag-cab-col">${icon(r.kind === 'profissional' ? 'fa-user-doctor' : r.kind === 'sala' ? 'fa-house-medical' : 'fa-stethoscope')}<b>${esc(r.name)}</b><small>${esc(A.KIND_LABEL[r.kind] || '')}</small></span>`).join('')}</div>
        <div class="ag-grade-corpo">
          <div class="ag-eixo" aria-hidden="true">${horas.join('')}</div>
          <div class="ag-cols">
            ${cols.map((r, c) => `<div class="ag-col" style="--c:${c}" aria-hidden="true"></div>`).join('')}
            ${fundo}
            ${passou != null ? `<div class="ag-passou" style="--s:${(passou - g0) / 15}" aria-hidden="true"><span>Já passou</span></div>` : ''}
            ${evs.map((e) => e.html).join('')}
          </div>
        </div>
      </div>
    </div>
    ${fora.length ? `<section class="ag-fora" aria-labelledby="agForaT"><h4 id="agForaT">Fora da grade</h4><p class="cl-help">Cancelados e remarcações sem horário reservado.</p>
      <ul class="ag-lista">${fora.map((it) => `<li class="ag-li ag-tom-${A.statusTag(it.status).tone}">${itemButton(it)}</li>`).join('')}</ul></section>` : ''}`;
}

// ---------- semana ----------
function weekDays() { const seg = A.mondayOf(S.day); return Array.from({ length: 7 }, (_, i) => A.addDaysTo(seg, i)); }

function weekGridHtml() {
  const dias = weekDays();
  const items = filtered(S.data.items);
  let g0 = 1440; let g1 = 0;
  for (const d of dias) {
    const base = Date.parse(A.localToUtc(d, '00:00', S.tz));
    const di = items.filter((i) => Date.parse(i.starts_at) < base + 86400000 && Date.parse(i.ends_at) > base);
    const [a, b] = rangeMinutes(d, di);
    g0 = Math.min(g0, a); g1 = Math.max(g1, b);
  }
  const rows = (g1 - g0) / 15;
  const blocoVisto = (x) => !S.f.res || !x.resource_id || x.resource_id === S.f.res;
  const ocupVisto = (x) => !S.f.res || (x.resources || []).includes(S.f.res);
  const porDia = dias.map((d) => {
    const base = Date.parse(A.localToUtc(d, '00:00', S.tz));
    const inDay = (x) => Date.parse(x.starts_at) < base + 86400000 && Date.parse(x.ends_at) > base;
    return { d, base, inDay, mm: (iso) => minutesOfDay(d, iso, g0, g1), di: items.filter(inDay), ob: (S.data.busy || []).filter(inDay).filter(ocupVisto) };
  });
  // a mesma altura de linha nos 7 dias, pelo item mais curto da semana (44 px no mínimo para cada item)
  const { rowh, minSpan } = A.gridScale(porDia.flatMap(({ mm, di, ob }) => [...di, ...ob].map((x) => mm(x.ends_at) - mm(x.starts_at))));
  const evs = []; let fundo = '';
  let linhas = rows;
  const pos = (p, c) => { linhas = Math.max(linhas, p.row + p.span); return `class="ag-pos${p.lanes >= 3 ? ' ag-apertado' : ''}" style="--c:${c};--r:${p.row};--s:${p.span};--l:${p.lane};--n:${p.lanes}"`; };
  porDia.forEach(({ d, base, inDay, mm, di, ob }, c) => {
    // "Livre" e "Fechado" (com a palavra, como no Dia) só do agora em diante
    const corte = Math.max(g0, Math.min((Date.now() - base) / 60000, g1));
    const futuro = (list) => list.map(([a, b]) => [Math.max(a, corte), b]).filter(([a, b]) => b > a);
    const livres = [];
    for (const r of S.free?.resources || []) if (!S.f.res || r.id === S.f.res) for (const [a, b] of r.free) if (Date.parse(a) < base + 86400000 && Date.parse(b) > base) livres.push([mm(a), mm(b)]);
    livres.sort((x, y) => x[0] - y[0]);
    const uniao = [];
    for (const [a, b] of livres) { const u = uniao.at(-1); if (u && a <= u[1]) u[1] = Math.max(u[1], b); else uniao.push([a, b]); }
    const blocos = (S.data.blocks || []).filter(inDay).filter(blocoVisto);
    const ocup = [...di, ...ob, ...blocos].map((x) => [mm(x.starts_at), mm(x.ends_at)]);
    // fechado: nenhum aparelho, sala ou profissional livre e nada marcado (almoço, domingo, fora do horário)
    const fechado = S.missing.free || !S.free ? [] : minus(g0, g1, [...uniao, ...ocup]);
    fundo += [...futuro(uniao.filter(([a, b]) => b > a)).map(([a, b]) => `<div class="ag-livre" style="--c:${c};--r:${(a - g0) / 15};--s:${(b - a) / 15}" aria-hidden="true"><span>${icon('fa-check')}Livre</span></div>`),
      ...futuro(fechado).filter(([a, b]) => b - a >= 5).map(([a, b]) => `<div class="ag-fechado" style="--c:${c};--r:${(a - g0) / 15};--s:${(b - a) / 15}" aria-hidden="true"><span>Fechado</span></div>`)].join('');
    // agendamentos e "só ocupar" do dia na mesma conta de raias, com a altura mínima: nenhum cobre o outro
    const lay = A.layoutColumn([...di.map((i) => ({ id: `i${i.id}`, start: mm(i.starts_at), end: mm(i.ends_at) })), ...ob.map((b) => ({ id: `b${b.id}`, start: mm(b.starts_at), end: mm(b.ends_at) }))], g0, 15, minSpan);
    for (const it of di) {
      evs.push({ t: Date.parse(it.starts_at), html: `<div ${pos(lay[`i${it.id}`], c)}>${itemButton(it, { compact: true, dia: d })}</div>` });
    }
    for (const b of blocos) {
      const look = A.blockLook(b.kind); const a = mm(b.starts_at); const z = mm(b.ends_at);
      evs.push({ t: Date.parse(b.starts_at), html: `<div class="ag-pos ag-bloco" style="--c:${c};--r:${(a - g0) / 15};--s:${(z - a) / 15};--l:0;--n:1"><div class="ag-ev ag-ev-fixo ag-tom-vermelho" role="group" aria-label="${esc(`${A.blockWhenTz(b, S.tz)}, ${look.text}, ${b.resource_id ? resName(b.resource_id) : 'Clínica inteira'}`)}"><span class="ag-st">${icon(look.icon)}${esc(look.text)}</span></div></div>` });
    }
    for (const b of ob) {
      const look = A.busyLook(b.reason_code);
      evs.push({ t: Date.parse(b.starts_at), html: `<div ${pos(lay[`b${b.id}`], c)}><button type="button" class="ag-ev ag-tom-vermelho" data-act="ocupado" data-busy="${esc(b.id)}">${sr(`${esc(A.fmtDayLong(d))}, ${esc(A.timeIn(S.tz, b.starts_at))} às ${esc(A.timeIn(S.tz, b.ends_at))}, `)}<span class="ag-st">${icon(look.icon)}<span class="ag-st-t">${esc(look.text)}</span></span></button></div>` });
    }
  });
  evs.sort((a, b) => a.t - b.t);
  const horas = [];
  for (let m = g0; m < g1; m += 60) horas.push(`<span style="--r:${(m - g0) / 15}">${A.fromMin(m)}</span>`);
  // o dia de hoje: a palavra "hoje" à vista e no nome falado (não só a cor)
  const cab = (d) => `<button type="button" class="ag-cab-col ag-cab-dia${d === today() ? ' ag-hoje' : ''}" data-act="abrir-dia" data-dia="${d}"><b>${esc(A.fmtDayShort(d))}</b>${hojeTag(d)}${sr(`: abrir o dia ${esc(A.fmtDayLong(d))}`)}</button>`;
  return `<div class="ag-grade ag-semana" style="--cols:7;--rows:${Math.ceil(linhas)};--rowh:${rowh}px">
      <div class="ag-grade-in">
        <div class="ag-cab"><span class="ag-cab-eixo" aria-hidden="true"></span>${dias.map(cab).join('')}</div>
        <div class="ag-grade-corpo">
          <div class="ag-eixo" aria-hidden="true">${horas.join('')}</div>
          <div class="ag-cols">${dias.map((d, c) => `<div class="ag-col" style="--c:${c}" aria-hidden="true"></div>`).join('')}${fundo}${evs.map((e) => e.html).join('')}</div>
        </div>
      </div>
    </div>`;
}

function weekListHtml() {
  // cada dia é um título (h4), não uma região (7 marcos por semana só atrapalhariam quem navega por marcos)
  return weekDays().map((d) => {
    const n = dayEntries(d).length;
    return `<div class="ag-wdia"><h4 class="ag-wtit">${esc(A.fmtDayLong(d))}${d === today() ? ' (hoje)' : ''}</h4>
      ${n ? `<ul class="ag-lista">${dayEntries(d).map((e) => entryLi(e, false)).join('')}</ul>` : '<p class="cl-help">Nenhum agendamento.</p>'}</div>`;
  }).join('');
}

// ---------- mês ----------
// O dia de hoje: a palavra "hoje" à vista e no nome falado (não só a cor ou o contorno).
const hojeTag = (day) => (day === today() ? `${SEP}<span class="ag-hoje-tag">hoje</span>` : '');

function monthHtml() {
  const days = S.month.days || [];
  const ini = A.monthStart(S.day);
  if (!wide()) {
    const com = days.filter((d) => A.monthSummary(d));
    const lista = S.monthAll ? days : com;
    return `${lista.length ? `<ul class="ag-mlista">${lista.map((d) => `<li><button type="button" class="ag-mdia" data-act="abrir-dia" data-dia="${esc(d.day)}"><b>${esc(A.fmtDayLong(d.day))}${hojeTag(d.day)}</b>${SEP}<span>${esc(A.monthSummary(d) || 'Nada marcado')}</span></button></li>`).join('')}</ul>`
      : '<p class="cl-help">Nenhum agendamento ou bloqueio neste mês.</p>'}
      <div class="cl-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="mes-todos">${S.monthAll ? 'Mostrar só os dias com movimento' : 'Mostrar todos os dias'}</button></div>`;
  }
  const vazio = (A.weekdayOf(ini) + 6) % 7;
  const cab = ['seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.', 'dom.'];
  return `<div class="ag-mes" role="group" aria-label="${esc(titleText())}">
      ${cab.map((c) => `<span class="ag-mcab" aria-hidden="true">${c}</span>`).join('')}
      ${Array.from({ length: vazio }, () => '<span class="ag-mvazio" aria-hidden="true"></span>').join('')}
      ${days.map((d) => { const r = A.monthSummary(d); return `<button type="button" class="ag-mcel${d.day === today() ? ' ag-hoje' : ''}${r ? ' ag-mov' : ''}" data-act="abrir-dia" data-dia="${esc(d.day)}"><b><span aria-hidden="true">${Number(d.day.slice(8, 10))}</span>${sr(esc(A.fmtDayLong(d.day)))}</b>${hojeTag(d.day)}${SEP}${r ? `<small>${esc(r)}</small>` : sr('nada marcado')}</button>`; }).join('')}
    </div>`;
}

// ---------- bloqueios ----------
function blocksViewHtml() {
  if (S.missing.blocks) return `${note('A lista de bloqueios ainda não está disponível. Para bloquear, use o formulário abaixo.', 'warn')}${blockFormHtml()}`;
  if (!S.blocks) return loading('Carregando os bloqueios…');
  const list = S.blocks.blocks || [];
  const pode = S.blocks.can_edit;
  return `<section class="ac-sec ag-blsec" aria-labelledby="agBlT">
      <h3 class="ac-h" id="agBlT" tabindex="-1">Bloqueios marcados</h3>
      <p class="cl-help">Feriados da cidade, folgas, reformas e manutenção: nesses períodos nenhum horário é oferecido. Se houver paciente marcado, a tela mostra quem seria atingido antes de bloquear.</p>
      ${list.length ? `<ul class="cl-list ag-blocks">${list.map((b) => {
        const quando = A.blockWhenTz(b, S.tz);
        return `<li id="agb-${esc(b.id)}"><span><b>${esc(quando)}</b><small>${esc(b.resource_id ? b.resource_name || 'Recurso' : 'Clínica inteira')} · ${esc(A.BLOCK_KIND_LABEL[b.kind] || b.kind)}${b.reason ? ` · ${esc(b.reason)}` : ''}</small></span>
          ${pode ? (S.blRm === b.id ? `<span class="ag-ask" role="group" aria-labelledby="agBlRmT"><span id="agBlRmT">Remover o bloqueio de ${esc(quando)}? Os horários voltam a ficar livres.</span>
            <button class="btn btn-primary btn-sm" type="button" data-act="bl-rm-sim" data-id="${esc(b.id)}" id="agBlRmSim">Sim, remover</button><button class="btn btn-ghost btn-sm" type="button" data-act="bl-rm-nao" data-id="${esc(b.id)}">Voltar</button></span>`
            : `<button class="btn btn-ghost btn-sm" type="button" data-act="bl-rm" data-id="${esc(b.id)}">${icon('fa-trash-can')}Remover<span class="sr"> o bloqueio de ${esc(quando)}</span></button>`) : ''}</li>`;
      }).join('')}</ul>` : '<p class="cl-help">Nenhum bloqueio marcado.</p>'}
    </section>
    ${pode || (!S.blocks && canDo('bloquear')) ? blockFormHtml() : ''}`;
}

// "Hoje, dia inteiro" começa agora (agenda-core, blockRangeTz): a tela diz isso ao lado do dia.
function blHojeTexto() {
  const b = S.bl;
  if (!b || b.modo !== 'day' || !/^\d{4}-\d{2}-\d{2}$/.test(b.from || '') || b.from > today()) return '';
  const r = A.blockRangeTz({ kind: 'day', from: b.from, to: b.to }, S.tz);
  return r.fromNow ? `Hoje o bloqueio começa agora (${A.timeIn(S.tz, r.starts)}): o que já começou não é atingido.` : '';
}
function drawBlHoje() {
  const p = $('#blHoje');
  if (!p) return;
  const t = blHojeTexto();
  p.textContent = t;
  p.hidden = !t;
}

function blockFormHtml() {
  if (!S.bl) S.bl = { alvo: '', tipo: 'bloqueio', modo: 'day', from: '', to: '', start: '', end: '', motivo: '' };
  const b = S.bl;
  const res = resources().filter((r) => r.active !== false);
  const dia = today();
  const hoje = blHojeTexto();
  const f = (id, label, type, value, extra = '') => `<div class="cl-field" id="${id}Box"><label class="cl-lbl" for="${id}">${label}</label>
      <input id="${id}" type="${type}" value="${esc(value)}" aria-describedby="${id}Err${id === 'blFrom' ? ' blHoje' : ''}" ${extra}><span class="cl-err" id="${id}Err"></span></div>`;
  return `<form id="blForm" class="ac-form ag-form" novalidate aria-labelledby="blFormT">
      <h4 id="blFormT" tabindex="-1">${icon('fa-lock')}Bloquear horário</h4>
      <div class="cl-grid">
        <div class="cl-field"><label class="cl-lbl" for="blAlvo">O que bloquear</label>
          <select id="blAlvo" aria-describedby="blAlvoErr">${b.alvo && !res.some((r) => r.id === b.alvo)
            // o item escolhido foi desativado: fica marcado "escolha de novo" (nunca vira "A clínica inteira" sozinho)
            ? `<option value="${esc(b.alvo)}" selected disabled>Escolha de novo</option>` : ''}<option value="">A clínica inteira</option>${opts(res.map((r) => [r.id, r.name]), b.alvo)}</select>
          <span class="cl-err" id="blAlvoErr"></span></div>
        <div class="cl-field"><label class="cl-lbl" for="blTipo">Tipo</label><select id="blTipo">${opts(A.BLOCK_KINDS, b.tipo)}</select></div>
      </div>
      <fieldset class="cl-fs ag-mt"><legend class="sr">Período</legend>
        <div class="ag-mode">
          <label class="cl-check"><input type="radio" name="blModo" value="day"${b.modo === 'day' ? ' checked' : ''}><span>Dia inteiro (um ou mais dias)</span></label>
          <label class="cl-check"><input type="radio" name="blModo" value="part"${b.modo === 'part' ? ' checked' : ''}><span>Só algumas horas de um dia</span></label>
        </div>
      </fieldset>
      <div class="cl-grid">
        ${f('blFrom', b.modo === 'part' ? 'Dia' : 'Primeiro dia', 'date', b.from, `min="${dia}"`)}
        ${b.modo === 'part' ? `${f('blStart', 'Das', 'time', b.start, 'step="300"')}${f('blEnd', 'Às', 'time', b.end, 'step="300"')}` : f('blTo', 'Último dia <small>(em branco: só o primeiro)</small>', 'date', b.to, `min="${dia}"`)}
        <div class="cl-field full"><label class="cl-lbl" for="blMotivo">Motivo <small>(opcional; só a clínica vê; não escreva dados de pacientes)</small></label>
          <input id="blMotivo" type="text" maxlength="120" autocomplete="off" value="${esc(b.motivo)}"></div>
      </div>
      <p class="cl-help" id="blHoje"${hoje ? '' : ' hidden'}>${esc(hoje)}</p>
      <div class="cl-actions"><button class="btn btn-primary" type="submit" id="blOk">Bloquear</button>
        ${S.view !== 'bloqueios' ? '<button class="btn btn-ghost" type="button" data-act="fechar-form">Fechar</button>' : ''}</div>
      <div id="blAfet">${affectedHtml()}</div>
    </form>`;
}

const BL_MUDOU = '<p class="cl-note warn" role="status" id="blMudou">Você mudou o bloqueio depois de ver quem seria atingido. Clique em “Bloquear” para conferir de novo.</p>';

function affectedHtml() {
  const a = S.bl?.afet;
  if (!a) return S.bl?.mudou ? BL_MUDOU : '';
  const presos = a.items.some((x) => !x.can_move);
  const linha = (x) => `<li class="ag-tom-${x.kind === 'ocupado' ? 'vermelho' : A.statusTag(x.status).tone}"><b>${esc(A.fmtWhen(S.tz, x.starts_at))}</b> · ${esc(x.kind === 'ocupado' ? 'Só ocupar' : x.procedure || 'Exame')}${x.patient ? ` · ${esc(x.patient)}` : ''}${x.channel ? ` · ${esc(A.CHANNEL_LABEL[x.channel] || '')}` : ''} · ${icon(x.kind === 'ocupado' ? 'fa-hand' : A.statusTag(x.status).icon)}${esc(x.kind === 'ocupado' ? 'Ocupado' : A.clinicStatusLabel(x.status))}</li>`;
  // O título diz QUAL bloqueio (período e alvo) a lista confere: o "mesmo assim" grava exatamente este.
  const g = a.args || {};
  const qual = g.p_starts ? `Bloqueio de ${A.blockWhenTz({ starts_at: g.p_starts, ends_at: g.p_ends }, S.tz)} ${g.p_resource ? `em ${resName(g.p_resource) || 'um recurso'}` : 'na clínica inteira'}: ` : '';
  const quanto = A.actionText('confirm_required', { items: a.items });
  return `<section class="ag-afet" aria-labelledby="blAfetT">
      <h4 id="blAfetT" tabindex="-1">${icon('fa-triangle-exclamation')}${esc(qual ? `${qual}${quanto.replace(/^Este bloqueio /, '')}` : quanto)}</h4>
      ${a.aviso ? `<p class="cl-note warn">${esc(a.aviso)}</p>` : ''}
      <ul class="ag-afetlista">${a.items.map(linha).join('')}</ul>
      ${presos ? `<p class="cl-note err" role="alert">${esc(A.ACTION_TEXT.cannot_move)}</p>`
        : `<p class="cl-help">${esc(A.blockForceHelp(a.items)).replace('lista Para remarcar', 'lista <b>Para remarcar</b>')}</p>`}
      <div class="cl-actions">
        ${presos || !a.confirm ? '' : '<button class="btn btn-coral" type="button" id="blForcar" data-act="bl-forcar">Bloquear mesmo assim</button>'}
        <button class="btn btn-ghost" type="button" id="blNao" data-act="bl-nao">Não bloquear</button>
      </div>
    </section>`;
}

// ---------- formulários do balcão ----------
function drawForms() {
  const box = $('#agForms');
  if (!box) return;
  if (S.form === 'novo') box.innerHTML = deskFormHtml();
  else if (S.form === 'ocupar') box.innerHTML = busyFormHtml();
  else if (S.form === 'bloquear' && S.view !== 'bloqueios') box.innerHTML = blockFormHtml();
  else box.innerHTML = '';
}

function deskFormHtml() {
  const b = S.bk;
  if (b.done) {
    return `<section class="ac-form ag-form ag-feito" aria-labelledby="bkFeito"><p id="bkFeito" class="cl-note ok" tabindex="-1">${esc(b.done)}</p>
      <div class="cl-actions">${b.doneId ? `<button type="button" class="btn btn-ghost btn-sm" data-act="abrir" data-req="${esc(b.doneId)}" id="bkVerAg">Ver o agendamento</button>` : ''}
        <button type="button" class="btn btn-primary btn-sm" data-act="novo">${icon('fa-calendar-plus')}Novo agendamento</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="fechar-form">Fechar</button></div></section>`;
  }
  const procs = S.cat?.procedures || [];
  const p = procs.find((x) => x.id === b.proc);
  const e = b.errs || {};
  const err = (id) => `<span class="cl-err" id="${id}Err">${esc(e[id] || '')}</span>`;
  const inv = (id) => (e[id] ? ' aria-invalid="true"' : '');
  const grupos = b.res?.slots ? A.slotGroups(b.res.slots, S.tz) : [];
  return `<form id="bkForm" class="ac-form ag-form" novalidate aria-labelledby="bkT">
      <h4 id="bkT" tabindex="-1">${icon('fa-calendar-plus')}Novo agendamento (telefone ou balcão)</h4>
      <fieldset class="ac-fs"><legend>1. Exame e dia</legend>
        <div class="cl-grid">
          <div class="cl-field"><label class="cl-lbl" for="bkProc">Exame</label>
            <select id="bkProc" aria-describedby="bkProcErr bkProcInfo"${inv('bkProc')}><option value="">Escolha o exame</option>${opts(procs.map((x) => [x.id, `${x.name} (${A.fmtMinutes(x.duration_min)}, ${A.centsText(x.price_cents)})`]), b.proc)}</select>
            ${err('bkProc')}<span class="cl-hint" id="bkProcInfo">${esc(procInfo(p))}</span></div>
          <div class="cl-field"><label class="cl-lbl" for="bkDia">Dia</label>
            <input type="date" id="bkDia" min="${today()}" value="${esc(b.day)}"></div>
        </div>
        <div class="cl-actions"><button type="button" class="btn btn-ghost btn-sm" id="bkVer" data-act="bk-ver">Ver horários</button></div>
        <div id="bkSlots">${b.loading ? loading('Procurando horários livres…') : b.res ? (grupos.length ? `<div role="radiogroup" aria-labelledby="bkSlotsT" aria-describedby="bkSlotErr" class="ag-slots-r">
            <p id="bkSlotsT" class="cl-lbl">Horários livres em ${esc(A.fmtDayLong(b.res.from || b.day))}</p>
            ${grupos.map((g) => `<div class="ag-sgrupo"><span class="ag-sg">${esc(g.label)}</span><div class="ag-sbts">${g.slots.map((s) => `<label class="ag-slot"><input type="radio" name="bkSlot" value="${esc(s.start)}"${b.slot === s.start ? ' checked' : ''}><span>${esc(s.label)}</span></label>`).join('')}</div></div>`).join('')}
            ${err('bkSlot')}</div>` : `<p class="cl-note warn" id="bkSemHorario">${esc(A.noSlotsText(b.res, { canConfig: canConfig(), day: b.day }))}</p>${err('bkSlot')}`) : err('bkSlot')}</div>
        ${b.alts?.length ? `<div class="ag-alts" id="bkAlts" role="group" aria-labelledby="bkAltT"><p id="bkAltT">${esc(A.ACTION_TEXT.slot_taken)}</p>
          <div class="ag-sbts">${b.alts.map((t) => `<button type="button" class="btn btn-ghost btn-sm" data-act="bk-alt" data-t="${esc(t)}">Marcar às ${esc(A.timeIn(S.tz, t))}</button>`).join('')}</div></div>` : ''}
      </fieldset>
      <fieldset class="ac-fs"><legend>2. Paciente</legend>
        <div class="cl-grid">
          <div class="cl-field"><label class="cl-lbl" for="bkNome">Nome</label><input type="text" id="bkNome" maxlength="120" autocomplete="off" value="${esc(b.name)}" aria-describedby="bkNomeErr"${inv('bkNome')}>${err('bkNome')}</div>
          <div class="cl-field"><label class="cl-lbl" for="bkFone">Celular com DDD</label><input type="tel" id="bkFone" maxlength="20" inputmode="tel" autocomplete="off" value="${esc(b.phone)}" aria-describedby="bkFoneErr"${inv('bkFone')}>${err('bkFone')}</div>
          <div class="cl-field full"><label class="cl-lbl" for="bkEmail">E-mail <small>(opcional)</small></label><input type="email" id="bkEmail" maxlength="254" inputmode="email" autocomplete="off" value="${esc(b.email)}" aria-describedby="bkEmailErr"${inv('bkEmail')}>${err('bkEmail')}</div>
        </div>
        <label class="cl-check ag-mt"><input type="checkbox" id="bkOutra"${b.forOther ? ' checked' : ''}><span>O exame é para outra pessoa</span></label>
        ${b.forOther ? `<div class="cl-grid ag-mt">
          <div class="cl-field"><label class="cl-lbl" for="bkOutroNome">Nome de quem faz o exame</label><input type="text" id="bkOutroNome" maxlength="120" autocomplete="off" value="${esc(b.otherName)}" aria-describedby="bkOutroNomeErr"${inv('bkOutroNome')}>${err('bkOutroNome')}</div>
          <div class="cl-field"><label class="cl-lbl" for="bkParentesco">Parentesco</label><input type="text" id="bkParentesco" maxlength="60" autocomplete="off" value="${esc(b.relationship)}" aria-describedby="bkParentescoErr"${inv('bkParentesco')}>${err('bkParentesco')}</div>
          <label class="cl-check full"><input type="checkbox" id="bkMenor"${b.otherMinor ? ' checked' : ''}><span>Tem menos de 18 anos</span></label>
          <label class="cl-check full"><input type="checkbox" id="bkAutoriza"${b.authorize ? ' checked' : ''} aria-describedby="bkAutorizaErr"${inv('bkAutoriza')}><span>${b.otherMinor ? 'Sou o responsável legal ou tenho a autorização dele' : 'A pessoa sabe e concordou'}</span></label>${err('bkAutoriza')}
        </div>` : ''}
      </fieldset>
      <fieldset class="ac-fs"><legend>3. Como a pessoa pediu</legend>
        <div class="ag-mode">${A.DESK_CHANNELS.map(([k, n]) => `<label class="cl-check"><input type="radio" name="bkCanal" value="${k}"${b.channel === k ? ' checked' : ''} aria-describedby="bkCanalErr"${inv('bkCanal')}><span>${esc(n)}</span></label>`).join('')}</div>${err('bkCanal')}
      </fieldset>
      <label class="cl-check ag-mt ag-aviso"><input type="checkbox" id="bkConsent"${b.consent ? ' checked' : ''} aria-describedby="bkConsentErr"${inv('bkConsent')}><span>Avisei a pessoa de que o agendamento fica registrado no sistema do IMED, com nome e telefone, para a clínica atender.</span></label>${err('bkConsent')}
      <div class="cl-actions"><button class="btn btn-coral" type="submit" id="bkOk"${b.sending ? ' disabled' : ''}>${b.sending ? 'Agendando…' : 'Confirmar agendamento'}</button>
        <button class="btn btn-ghost" type="button" data-act="fechar-form">Fechar</button></div>
      <div id="bkMsg" aria-live="polite">${b.msg ? note(esc(b.msg[0]), b.msg[1]) : ''}</div>
    </form>`;
}

function busyFormHtml() {
  const o = S.oc;
  const e = o.errs || {};
  const err = (id) => `<span class="cl-err" id="${id}Err">${esc(e[id] || '')}</span>`;
  const inv = (id) => (e[id] ? ' aria-invalid="true"' : '');
  const res = resources().filter((r) => r.active !== false);
  return `<form id="ocForm" class="ac-form ag-form" novalidate aria-labelledby="ocT">
      <h4 id="ocT" tabindex="-1">${icon('fa-hand')}Só ocupar horário</h4>
      <p class="cl-help">Use quando o horário foi ocupado por alguém que não passou pelo IMED ou por uso interno. Nenhum dado de paciente é guardado.</p>
      <div class="cl-grid">
        <div class="cl-field"><label class="cl-lbl" for="ocRec">Aparelho, sala ou profissional</label>
          <select id="ocRec" aria-describedby="ocRecErr"${inv('ocRec')}><option value="">Escolha</option>${opts(res.map((r) => [r.id, r.name]), o.res)}</select>${err('ocRec')}</div>
        <div class="cl-field"><label class="cl-lbl" for="ocMotivo">Motivo</label><select id="ocMotivo">${opts(A.BUSY_REASONS, o.reason)}</select></div>
        <div class="cl-field"><label class="cl-lbl" for="ocDia">Dia</label><input type="date" id="ocDia" min="${today()}" value="${esc(o.day)}" aria-describedby="ocDiaErr"${inv('ocDia')}>${err('ocDia')}</div>
        <div class="cl-field"><div class="ag-par">
          <div><label class="cl-lbl" for="ocIni">Das</label><input type="time" id="ocIni" step="300" value="${esc(o.start)}" aria-describedby="ocIniErr"${inv('ocIni')}>${err('ocIni')}</div>
          <div><label class="cl-lbl" for="ocFim">Às</label><input type="time" id="ocFim" step="300" value="${esc(o.end)}" aria-describedby="ocFimErr"${inv('ocFim')}>${err('ocFim')}</div></div></div>
      </div>
      <div class="cl-actions"><button class="btn btn-primary" type="submit" id="ocOk"${o.sending ? ' disabled' : ''}>${o.sending ? 'Salvando…' : 'Ocupar o horário'}</button>
        <button class="btn btn-ghost" type="button" data-act="fechar-form">Fechar</button></div>
      <div id="ocMsg" aria-live="polite">${o.msg ? note(esc(o.msg[0]), o.msg[1]) : ''}</div>
    </form>`;
}

function openForm(kind) {
  S.det = null; S.ask = null;
  if (kind === 'novo') {
    const proc = S.f.proc || (S.cat?.procedures?.length === 1 ? S.cat.procedures[0].id : '');
    S.bk = { proc, day: S.view === 'dia' && S.day >= today() ? S.day : today(), res: null, slot: '', name: '', phone: '', email: '', forOther: false, otherName: '', relationship: '', otherMinor: false, authorize: false, channel: 'clinica_telefone', consent: false, errs: {} };
  } else if (kind === 'ocupar') {
    S.oc = { res: S.f.res || '', day: S.view === 'dia' && S.day >= today() ? S.day : today(), start: '', end: '', reason: 'agenda_propria', errs: {} };
  } else if (kind === 'bloquear') {
    S.bl = null;
    if (S.view !== 'bloqueios') { S.form = 'bloquear'; drawForms(); drawDetail(); drawMain(); $('#blFormT')?.focus(); return; }
  }
  S.form = kind;
  drawForms();
  drawDetail();
  drawMain();
  ($('#bkT') || $('#ocT'))?.focus();
}

// ---------- detalhe ----------
function findItem(id) { return (S.data?.items || []).find((x) => x.id === id) || null; }

async function openDetail(requestId, { itemId = null, origin = null, conflict = null, sub = null, busy = null } = {}) {
  S.ask = null;
  if (busy) { S.det = { busy, origin }; drawDetail(); drawMain(); $('#agDetT')?.focus(); return; }
  S.det = { id: requestId, itemId, origin, conflict, sub, loading: true };
  if (isCentral() && !S.det.just) { S.det.loading = false; S.det.needJust = true; drawDetail(); drawMain(); $('#agDetT')?.focus(); return; }
  drawDetail(); drawMain();
  $('#agDetT')?.focus();
  await loadDetail();
  $('#agDetT')?.focus();
}

async function loadDetail() {
  const d = S.det;
  if (!d) return;
  try {
    const r = await rpc('agenda_request_detail', { p_id: d.id, p_justification: d.just || null });
    if (S.det !== d) return;
    if (r?.status === 'justification_required') { d.needJust = true; d.loading = false; drawDetail(); return; }
    if (r?.status !== 'ok') { d.error = A.actionText(r?.status); d.loading = false; drawDetail(); if (r?.status === 'not_found') loadView({ quiet: true }); return; }
    d.data = r; d.loading = false; d.needJust = false;
    if (d.sub === 'remarcar' && !d.rm) startReschedule(d.itemId || r.items.find((i) => ['confirmed', 'reschedule_requested'].includes(i.status))?.id);
  } catch (err) {
    if (S.det !== d || S.ctx.lost()) return;
    d.error = isNetwork(err) ? A.ACTION_TEXT.network : friendlyError(err, 'Não foi possível abrir o agendamento agora.');
    d.loading = false;
  }
  drawDetail();
}

function closeDetail() {
  const origin = S.det?.origin;
  S.det = null; S.ask = null;
  drawDetail(); drawMain();
  const el = origin ? $(origin) : null;
  (el || $('#agTitulo'))?.focus();
}

function drawDetail() {
  const aside = $('#agDet');
  if (!aside) return;
  $('#agCorpo')?.classList.toggle('ag-com-det', detalheAoLado());
  if (!S.det) { aside.hidden = true; aside.innerHTML = ''; const m = $('#agMain'); if (m) m.hidden = false; return; }
  aside.hidden = false;
  const d = S.det;
  const fechar = `<button type="button" class="btn btn-ghost btn-sm" id="agDetFechar" data-act="fechar-det">${wide() ? `${icon('fa-xmark')}Fechar` : `${icon('fa-chevron-left')}Voltar à agenda`}</button>`;
  if (d.busy) {
    const b = d.busy; const look = A.busyLook(b.reason_code);
    const nomes = (b.resources || []).map(resName).filter(Boolean);
    aside.innerHTML = `<div class="ag-det-in">
      <div class="ag-det-cab"><h3 class="ac-h" id="agDetT" tabindex="-1">${icon(look.icon)}${esc(look.text)}</h3>${fechar}</div>
      <dl class="ag-dl"><dt>Quando</dt><dd>${esc(A.fmtWhen(S.tz, b.starts_at))} às ${esc(A.timeIn(S.tz, b.ends_at))}</dd>
        ${nomes.length ? `<dt>Onde</dt><dd>${esc(nomes.join(', '))}</dd>` : ''}</dl>
      ${canDo('marcar') ? (d.askFree ? `<div class="ag-ask" role="group" aria-labelledby="agFreeT"><p id="agFreeT">Liberar este horário? Ele volta a ficar livre para marcar.</p>
          <div class="cl-actions"><button type="button" class="btn btn-primary btn-sm" id="agLiberarSim" data-act="liberar-sim">Sim, liberar</button><button type="button" class="btn btn-ghost btn-sm" data-act="liberar-nao">Voltar</button></div></div>`
        : `<div class="cl-actions"><button type="button" class="btn btn-ghost btn-sm" id="agLiberar" data-act="liberar">${icon('fa-trash-can')}Liberar este horário</button></div>`) : ''}
      <div id="agDetMsg" aria-live="polite">${d.msg ? note(esc(d.msg[0]), d.msg[1]) : ''}</div></div>`;
    return;
  }
  if (d.needJust) {
    aside.innerHTML = `<div class="ag-det-in"><div class="ag-det-cab"><h3 class="ac-h" id="agDetT" tabindex="-1">Dados do paciente</h3>${fechar}</div>
      <p class="cl-help">Para ver os dados deste paciente, escolha o motivo (fica registrado):</p>
      <div class="cl-field"><label class="cl-lbl" for="agJust">Motivo</label><select id="agJust" aria-describedby="agJustErr"><option value="">Escolha o motivo</option>${opts(A.JUSTIFICATIONS, '')}</select><span class="cl-err" id="agJustErr">${esc(d.justErr || '')}</span></div>
      <div class="cl-actions"><button type="button" class="btn btn-primary btn-sm" id="agJustOk" data-act="just-ok">Ver os dados</button></div></div>`;
    return;
  }
  if (d.loading) { aside.innerHTML = `<div class="ag-det-in"><div class="ag-det-cab"><h3 class="ac-h" id="agDetT" tabindex="-1">Agendamento</h3>${fechar}</div>${loading('Abrindo o agendamento…')}</div>`; return; }
  if (d.error && !d.data) { aside.innerHTML = `<div class="ag-det-in"><div class="ag-det-cab"><h3 class="ac-h" id="agDetT" tabindex="-1">Agendamento</h3>${fechar}</div>${note(esc(d.error), 'err')}</div>`; return; }
  const r = d.data;
  const p = r.patient || {};
  const quem = p.for_other && p.other_name ? p.other_name : p.name;
  const tel = telHref(p.phone); const wa = waHref(p.phone);
  const full = r.scope === 'clinica' || r.scope === 'central';
  const linhas = [
    ['Paciente', `${esc(p.name || '')}`],
    p.for_other ? ['O exame é para', `<b>${esc(p.other_name || '')}</b>${p.relationship ? ` (${esc(p.relationship)})` : ''}${p.other_minor ? '<br><small>Menor de 18 anos · autorização do responsável legal registrada</small>' : ''}`] : null,
    full && p.phone ? ['Telefone', `<span class="rq-contact">${tel ? `<a href="${tel}">${icon('fa-phone')}${esc(fmtPhone(p.phone))}</a>` : esc(p.phone)}${wa ? ` <a href="${wa}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>WhatsApp<span class="sr"> (abre em nova aba)</span></a>` : ''}</span>`] : null,
    full && p.email ? ['E-mail', `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`] : null,
    full && p.notes ? ['Observação do paciente', esc(p.notes)] : null,
    r.channel ? ['Marcado por', esc(A.CHANNEL_LABEL[r.channel] || r.channel)] : null,
    !r.agenda ? ['Data preferida', esc([A.fmtDayLong(r.preferred_date), r.preferred_period].filter(Boolean).join(' · '))] : null,
    r.request_status === 'cancelled' && r.cancel_reason ? ['Motivo do cancelamento', esc(Object.fromEntries(A.CANCEL_REASONS)[r.cancel_reason] || r.cancel_reason)] : null,
  ].filter(Boolean);
  aside.innerHTML = `<div class="ag-det-in">
    <div class="ag-det-cab"><h3 class="ac-h" id="agDetT" tabindex="-1">${esc(quem || 'Paciente')}</h3>${fechar}</div>
    ${!full ? '<p class="cl-help">Você vê só o nome: telefone e e-mail ficam com a recepção.</p>' : ''}
    <dl class="ag-dl">${linhas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
    ${r.agenda ? `<h4 class="ag-sub">${r.items.length > 1 ? 'Exames' : 'Exame'}</h4><ul class="ag-itens">${r.items.map((it) => detailItemHtml(it, r)).join('')}</ul>`
      : requestStatusHtml(r)}
    <div id="agDetMsg" aria-live="polite">${d.msg ? note(esc(d.msg[0]), d.msg[1]) : ''}</div>
    ${d.sub === 'remarcar' && d.rm ? rescheduleHtml() : ''}
    ${d.sub === 'cancelar' ? cancelHtml() : ''}
    <div class="cl-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="historico" aria-expanded="${!!d.hist}">${d.hist ? 'Esconder o histórico' : 'Ver histórico'}</button></div>
    ${d.hist ? `<section aria-labelledby="agHistT"><h4 class="ag-sub" id="agHistT">Histórico</h4>${d.hist.length ? `<ol class="ag-hist">${d.hist.map((h) => `<li>${esc(A.historyLine(h, S.tz))}</li>`).join('')}</ol>` : '<p class="cl-help">Nada registrado ainda.</p>'}</section>` : ''}
  </div>`;
}

function detailItemHtml(it, r) {
  const tag = A.statusTag(it.status, r.hold_expires_at, S.tz);
  const nomes = (it.resources || []).map((x) => x.name).filter(Boolean);
  const unplaced = !(it.resources || []).length;
  const view = { id: it.id, request_id: r.id, status: it.status, starts_at: it.starts_at, ends_at: it.ends_at, patient: A.shortName(r.patient?.for_other ? r.patient?.other_name : r.patient?.name), procedure: it.procedure };
  const manage = A.manageActions(it, { scope: S.scope, can: { remarcar: canDo('remarcar'), cancelar: canDo('cancelar') }, unplaced });
  const pacote = (r.items || []).length > 1;   // pacote: o botão de cada exame cancela SÓ aquele exame
  return `<li class="ag-li ag-tom-${tag.tone}" id="agd-${esc(it.id)}">
      <div class="ag-ev ag-ev-fixo"><span class="ag-hora">${esc(A.fmtWhen(S.tz, it.starts_at))}–${esc(A.timeIn(S.tz, it.ends_at))}</span>
        <span class="ag-nome">${esc(it.procedure || examName(it.exam_code))}</span>
        <span class="ag-exame">${esc(nomes.join(', ') || (unplaced ? 'Sem horário reservado no momento' : ''))} · ${esc(A.centsText(it.price_cents))}</span>
        <span class="ag-st">${icon(tag.icon)}${esc(tag.text)}</span></div>
      ${attendButtons(view, 'd')}${askHtml(view, 'd')}
      ${manage.length ? `<div class="ag-acoes" role="group" aria-label="Agendamento de ${esc(it.procedure || '')}">
        ${manage.includes('remarcar') ? `<button type="button" class="btn btn-ghost btn-sm" data-act="remarcar" data-item="${esc(it.id)}">${icon('fa-calendar-days')}Remarcar</button>` : ''}
        ${manage.includes('voltar') ? `<button type="button" class="btn btn-ghost btn-sm" data-act="voltar-horario" data-item="${esc(it.id)}">${icon('fa-rotate')}Voltar ao horário de antes</button>` : ''}
        ${manage.includes('cancelar') ? `<button type="button" class="btn btn-danger btn-sm" data-act="cancelar" data-item="${esc(it.id)}">${icon('fa-ban')}${pacote ? 'Cancelar este exame' : 'Cancelar agendamento'}</button>` : ''}
      </div>` : ''}
    </li>`;
}

// Pedido sem horário (achado na busca): os botões de situação de hoje (set_request_status).
function requestStatusHtml(r) {
  const tag = A.statusTag(r.request_status);
  const acts = [['contacted', 'Em contato'], ['confirmed', 'Confirmado'], ['completed', 'Concluído'], ['cancelled', 'Cancelado']];
  const travado = r.request_status === 'cancelled' && r.cancelled_by === 'patient';
  return `<p class="ag-st-linha ag-tom-${tag.tone}">${icon(tag.icon)}${esc(tag.text)} · pedido sem horário: combine com o paciente e atualize a situação.</p>
    ${travado || isProf() ? '' : `<div class="ag-acoes" role="group" aria-label="Mudar a situação do pedido">${acts.map(([s, n]) => `<button type="button" class="btn btn-ghost btn-sm" data-act="pedido-st" data-st="${s}" aria-pressed="${r.request_status === s}"${r.request_status === s ? ' disabled' : ''}>${esc(n)}</button>`).join('')}</div>`}`;
}

function cancelHtml() {
  const c = S.det.cn || {};
  const titulo = cancelaExame() ? `Cancelar o exame ${itemFromDetail(c.itemId)?.procedure || ''}`.trim() : 'Cancelar agendamento';
  return `<section class="ag-sub-sec" aria-labelledby="cnT"><h4 class="ag-sub" id="cnT" tabindex="-1">${esc(titulo)}</h4>
    <div class="cl-field"><label class="cl-lbl" for="cnMotivo">Motivo</label><select id="cnMotivo" aria-describedby="cnMotivoErr"${c.err ? ' aria-invalid="true"' : ''}><option value="">Escolha o motivo</option>${opts(A.CANCEL_REASONS, c.reason)}</select><span class="cl-err" id="cnMotivoErr">${esc(c.err || '')}</span></div>
    ${c.ask ? `<div class="ag-ask" role="group" aria-labelledby="cnAskT"><p id="cnAskT">${esc(c.ask)}</p>
      <div class="cl-actions"><button type="button" class="btn btn-danger btn-sm" id="cnSim" data-act="cn-sim"${c.sending ? ' disabled' : ''}>Sim, cancelar</button><button type="button" class="btn btn-ghost btn-sm" data-act="cn-voltar">Voltar</button></div></div>`
      : `<div class="cl-actions"><button type="button" class="btn btn-danger btn-sm" id="cnOk" data-act="cn-ok">${cancelaExame() ? 'Cancelar este exame' : 'Cancelar agendamento'}</button><button type="button" class="btn btn-ghost btn-sm" data-act="cn-fechar">Não cancelar</button></div>`}
  </section>`;
}

function rescheduleHtml() {
  const m = S.det.rm;
  const grupos = m.res?.slots ? A.slotGroups(m.res.slots, S.tz) : [];
  const it = S.det.data.items.find((x) => x.id === m.itemId);
  return `<section class="ag-sub-sec" aria-labelledby="rmT"><h4 class="ag-sub" id="rmT" tabindex="-1">Remarcar ${esc(it?.procedure || '')}</h4>
    <div class="cl-field"><label class="cl-lbl" for="rmDia">Novo dia</label><input type="date" id="rmDia" min="${today()}" value="${esc(m.day)}"></div>
    <div class="cl-actions"><button type="button" class="btn btn-ghost btn-sm" id="rmVer" data-act="rm-ver">Ver horários</button></div>
    <div id="rmSlots">${m.loading ? loading('Procurando horários livres…') : m.res ? (grupos.length ? `<div role="radiogroup" aria-labelledby="rmSlotsT" class="ag-slots-r"><p id="rmSlotsT" class="cl-lbl">Horários livres</p>
      ${grupos.map((g) => `<div class="ag-sgrupo"><span class="ag-sg">${esc(g.label)}</span><div class="ag-sbts">${g.slots.map((s) => `<label class="ag-slot"><input type="radio" name="rmSlot" value="${esc(s.start)}"${m.slot === s.start ? ' checked' : ''}><span>${esc(s.label)}</span></label>`).join('')}</div></div>`).join('')}</div>`
      : `<p class="cl-note warn">${esc(A.noSlotsText(m.res, { canConfig: canConfig(), day: m.day }))}</p>`) : ''}</div>
    ${m.alts?.length ? `<div class="ag-alts" role="group" aria-labelledby="rmAltT"><p id="rmAltT">${esc(A.ACTION_TEXT.slot_taken)}</p><div class="ag-sbts">${m.alts.map((t) => `<button type="button" class="btn btn-ghost btn-sm" data-act="rm-alt" data-t="${esc(t)}">${esc(A.timeIn(S.tz, t))}</button>`).join('')}</div></div>` : ''}
    ${m.slot && it ? `<div class="ag-ask" role="group" aria-labelledby="rmAskT"><p id="rmAskT">Mudar de ${esc(A.fmtWhen(S.tz, it.starts_at))} para ${esc(A.fmtWhen(S.tz, m.slot))}?</p>
      <div class="cl-actions"><button type="button" class="btn btn-primary btn-sm" id="rmOk" data-act="rm-ok"${m.sending ? ' disabled' : ''}>${m.sending ? 'Remarcando…' : 'Sim, remarcar'}</button><button type="button" class="btn btn-ghost btn-sm" data-act="rm-fechar">Voltar</button></div></div>`
      : '<div class="cl-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="rm-fechar">Não remarcar</button></div>'}
  </section>`;
}

// Só remarca o que ainda pode ser remarcado (confirmado ou remarcação solicitada): um exame cancelado, concluído ou
// com falta não abre o formulário (o banco recusaria com transition_not_allowed). Devolve se abriu.
function startReschedule(itemId) {
  const it = S.det?.data?.items.find((x) => x.id === itemId);
  if (!it) return false;
  if (!['confirmed', 'reschedule_requested'].includes(it.status)) {
    S.det.sub = null; S.det.rm = null;
    S.det.msg = [`Este exame não pode ser remarcado: a situação dele é “${A.clinicStatusLabel(it.status) || it.status}”.`, 'err'];
    return false;
  }
  const d = A.dayIn(S.tz, Date.parse(it.starts_at));
  S.det.sub = 'remarcar';
  S.det.rm = { itemId, day: d >= today() ? d : today(), res: null, slot: '', key: null };
  return true;
}

// Pacote (mais de um exame no agendamento): "Cancelar" cancela SÓ o exame escolhido (agenda_set_status com o item);
// agendamento de um exame: o agendamento inteiro (agenda_cancel), como antes.
const cancelaExame = () => (S.det?.data?.items || []).length > 1;

// ---------- ações ----------
// O catálogo (exames, aparelhos, salas, profissionais) de novo: depois de um not_found de exame ou recurso que outra
// pessoa desativou, para os seletores da tela não oferecerem o que não existe mais.
async function reloadCatalog() {
  const r = await call('agenda_catalog', { p_clinic: S.clinicId });
  if (r.status !== 'ok') return false;
  S.cat = r; S.tz = r.timezone || S.tz;
  if (r.scope) S.scope = r.scope;
  return true;
}

// not_found no bloqueio = o aparelho, a sala ou o profissional foi desativado ou arquivado.
async function blockGone() {
  await reloadCatalog();
  if (S.ctx.lost() || !S.bl) return;
  await loadView({ quiet: true });
  redrawBlockForm();
  const er = $('#blAlvoErr');
  if (er) { er.textContent = A.ACTION_TEXT.not_found_resource; $('#blAlvo')?.setAttribute('aria-invalid', 'true'); }
  msg(A.ACTION_TEXT.not_found_resource, 'err');
  $('#blAlvo')?.focus();
}

async function call(fn, args) {
  try { return await rpc(fn, args); } catch (err) {
    if (isMissingFn(err)) return { status: 'missing_fn' };
    if (isNetwork(err)) return { status: 'network' };
    if (S.ctx.lost()) return { status: 'lost' };
    return { status: 'error', message: friendlyError(err, 'Não foi possível concluir agora. Tente de novo em instantes.') };
  }
}
const statusMsg = (r, ctx = {}) => (r.status === 'error' ? r.message : A.actionText(r.status, { ...ctx, ...r }));

// act: a ação conferida AGORA (attendActionFor). Uma chamada por item até a resposta: o segundo clique do clique duplo
// (ou o "Sim" repetido) é ignorado, em vez de mandar a mesma versão de novo e voltar version_conflict.
async function doAttend(item, act, where, reason = null) {
  if (!act || S.busy.has(item.id)) return;
  S.busy.add(item.id);
  markBusy(item.id);
  const args = { p_id: item.request_id, p_status: act.status, p_version: item.request_version ?? null, p_item: item.id };
  if (reason) args.p_reason = reason;
  let r;
  try {
    r = await call(S.missing.attend ? 'agenda_set_status' : 'agenda_attend', args);
    if (r.status === 'missing_fn' && !S.missing.attend) { S.missing.attend = true; r = await call('agenda_set_status', args); }
  } finally { S.busy.delete(item.id); }
  if (r.status === 'lost') return;
  S.ask = null;
  if (r.status === 'ok') {
    S.ultimoOk = { itemId: item.id, at: Date.now() };
    const nome = item.patient || 'Paciente';
    const texto = `${nome}: ${A.clinicStatusLabel(r.request_status === 'confirmed' ? 'confirmed' : act.status)}.`;
    if (S.det?.data) await loadDetail();
    await loadView({ quiet: true });
    msg(texto, 'ok', null, { flutuante: true });
    const prox = $(`[data-act="atender"][data-item="${CSS.escape(item.id)}"][data-w="${where}"]:not([disabled])`) || $(`[data-act="abrir"][data-item="${CSS.escape(item.id)}"]`) || $('#agDetT') || $('#agTitulo');
    prox?.focus();
    return;
  }
  // "Desfazer falta" sem o horário livre: um item com falta não se remarca; o atalho é um novo agendamento
  const naoVolta = r.status === 'slot_taken' && act.key === 'desfazer';
  // version_conflict logo depois de um ok DESTA aba no mesmo item: não foi "outra pessoa"
  const daqui = r.status === 'version_conflict' && S.ultimoOk?.itemId === item.id && Date.now() - S.ultimoOk.at < 15000;
  const texto = naoVolta ? A.ACTION_TEXT.slot_taken_no_show : r.status === 'slot_taken' ? A.ACTION_TEXT.slot_taken_back
    : daqui ? 'Este agendamento acabou de ser atualizado por esta tela. A agenda foi relida: confira a situação antes de continuar.'
      : statusMsg(r, { hint: act.hint });
  if (['version_conflict', 'not_found', 'transition_not_allowed', 'slot_taken'].includes(r.status)) { if (S.det?.data) await loadDetail(); await loadView({ quiet: true }); }
  else drawMain();
  if (S.det) drawDetail();
  msg(texto, 'err', naoVolta && podeMarcar() ? { act: 'novo', label: 'Novo agendamento' } : null);
  ((naoVolta && $('#agMsgBtn')) || $(`[data-act="abrir"][data-item="${CSS.escape(item.id)}"]`) || $('#agDetT') || $('#agTitulo'))?.focus();
}

function itemFromDetail(itemId) {
  const r = S.det?.data;
  const it = r?.items.find((x) => x.id === itemId);
  if (!it) return null;
  return { id: it.id, request_id: r.id, status: it.status, starts_at: it.starts_at, ends_at: it.ends_at, request_version: r.version, seq: it.seq, procedure_id: it.procedure_id,
    procedure: it.procedure, patient: A.shortName(r.patient?.for_other ? r.patient?.other_name : r.patient?.name), resources: it.resources || [] };
}

// Depois de remarcar, cancelar ou voltar ao horário de antes — pela lista "Para remarcar", pela grade, pela lista do
// dia, pela busca ou por "Ver na agenda" —, o item sai da lista "Para remarcar". O banco já fecha sozinho (gatilho da
// 4.2); isto cobre o banco antigo: com a agenda já relida, fecha o que AINDA estiver aberto para os itens.
// "mantido" (voltar ao horário de antes) fecha só o conflito do bloqueio: o de grade que mudou continua valendo.
async function resolveConflicts(itemIds, code) {
  const abertos = (S.conflicts || []).filter((k) => itemIds.includes(k.item_id) && (code !== 'mantido' || k.kind === 'bloqueio_sobre_agendamento'));
  const fechados = [];
  for (const k of abertos) {
    const r = await call('agenda_conflict_resolve', { p_id: k.id, p_status: 'resolvido', p_code: code });
    if (['ok', 'already_closed', 'not_found'].includes(r.status)) fechados.push(k.id);
  }
  if (fechados.length) { S.conflicts = S.conflicts.filter((k) => !fechados.includes(k.id)); drawRemarcar(); }
  return fechados.length === abertos.length;
}

async function doCancel() {
  const d = S.det; const c = d.cn;
  c.sending = true; drawDetail();
  const item = itemFromDetail(c.itemId);
  const exame = cancelaExame();
  const itens = exame ? [c.itemId] : d.data.items.map((x) => x.id);
  const r = exame
    ? await call('agenda_set_status', { p_id: d.id, p_status: 'cancelled', p_reason: c.reason, p_version: d.data.version, p_item: c.itemId })
    : await call('agenda_cancel', { p_id: d.id, p_reason: c.reason, p_version: d.data.version });
  if (r.status === 'lost') return;
  if (r.status === 'ok') {
    await loadView({ quiet: true });
    const resolvido = await resolveConflicts(itens, 'cancelado');
    const fim = resolvido ? '' : ' Não foi possível tirar da lista Para remarcar agora; tente de novo.';
    if (exame) {
      // pacote: os outros exames continuam; o detalhe fica aberto, com a situação nova
      const texto = `Exame ${item?.procedure ? `${item.procedure} ` : ''}de ${item?.patient || 'paciente'} cancelado. Os outros exames continuam marcados.${fim}`;
      d.sub = null; d.cn = null;
      await loadDetail();
      if (S.det === d) d.msg = [texto, resolvido ? 'ok' : 'warn'];
      drawDetail();
      msg(texto, resolvido ? 'ok' : 'warn', null, { flutuante: true });
      $('#agDetT')?.focus();
      return;
    }
    const texto = `Agendamento de ${item?.patient || 'paciente'} cancelado.${fim}`;
    S.det = null;
    drawDetail(); drawMain();
    msg(texto, resolvido ? 'ok' : 'warn', null, { flutuante: true });
    $('#agTitulo')?.focus();
    return;
  }
  c.sending = false; c.ask = null;
  d.msg = [statusMsg(r), 'err'];
  if (['version_conflict', 'not_found', 'already_cancelled', 'not_cancellable', 'transition_not_allowed'].includes(r.status)) { await loadDetail(); await loadView({ quiet: true }); }
  drawDetail();
  $('#cnMotivo')?.focus();
}

async function loadSlots(state, args) {
  state.loading = true; state.res = null; state.alts = null;
  return call('agenda_desk_slots', args);
}

async function doReschedule() {
  const d = S.det; const m = d.rm;
  const it = d.data.items.find((x) => x.id === m.itemId);
  if (!m.key) m.key = uuid();
  m.sending = true; drawDetail();
  const r = await call('agenda_reschedule', { p_id: d.id, p_items: [{ seq: it.seq, starts_at: m.slot }], p_key: m.key, p_version: d.data.version });
  if (r.status === 'lost') return;
  m.sending = false;
  if (r.status === 'ok') {
    d.sub = null; d.rm = null;
    await loadDetail();
    await loadView({ quiet: true });
    const resolvido = await resolveConflicts([m.itemId], 'remarcado');
    const feito = `${it.procedure || 'exame'} para ${A.fmtWhen(S.tz, m.slot)}.`;
    const texto = `${r.replay ? `Esta remarcação já tinha sido registrada: ${feito}` : `Remarcado: ${feito}`}${resolvido ? '' : ' Não foi possível tirar da lista Para remarcar agora; tente de novo.'}`;
    d.msg = [texto, resolvido ? 'ok' : 'warn'];
    drawDetail();
    msg(texto, resolvido ? 'ok' : 'warn', null, { flutuante: true });
    $('#agDetT')?.focus();
    return;
  }
  if (A.needsNewKey(r.status)) m.key = null;
  if (r.status === 'slot_taken') { m.alts = (r.alternatives || []).slice(0, 5); m.slot = ''; d.msg = [A.ACTION_TEXT.slot_taken, 'err']; drawDetail(); ($('[data-act="rm-alt"]') || $('#rmDia'))?.focus(); return; }
  d.msg = [statusMsg(r), 'err'];
  if (['version_conflict', 'not_found', 'transition_not_allowed'].includes(r.status)) { d.sub = null; d.rm = null; await loadDetail(); await loadView({ quiet: true }); }
  drawDetail();
  ($('#rmOk') || $('#agDetT'))?.focus();
}

async function doDeskBook() {
  const b = S.bk;
  readDesk();
  b.errs = A.deskErrors({ ...b, procedure: b.proc, slot: b.slot, guardianConsent: b.authorize, otherConsent: b.authorize });
  b.msg = null;
  if (Object.keys(b.errs).length) {
    drawForms();
    const first = ['bkProc', 'bkSlot', 'bkNome', 'bkFone', 'bkEmail', 'bkOutroNome', 'bkParentesco', 'bkAutoriza', 'bkCanal', 'bkConsent'].find((k) => b.errs[k]);
    const el = first === 'bkSlot' ? ($('input[name="bkSlot"]') || $('#bkVer')) : first === 'bkCanal' ? $('input[name="bkCanal"]') : $(`#${first}`);
    el?.focus();
    return;
  }
  // Chave de reenvio por par (exame, horário): a MESMA enquanto a tentativa com esse par ficou sem resposta (erro de
  // rede), inclusive depois de "Ver horários" ou de fechar e abrir o formulário; nova depois de qualquer resposta.
  const par = `${S.clinicId}|${b.proc}|${b.slot}`;
  const key = deskKeys.get(par) || uuid();
  b.sending = true; drawForms();
  const payload = A.deskPayload({ ...b, guardianConsent: b.authorize, otherConsent: b.authorize });
  const r = await call('agenda_desk_book', { p_clinic: S.clinicId, p_items: [{ procedure_id: b.proc, starts_at: b.slot }], p_patient: payload, p_channel: b.channel, p_key: key });
  if (r.status === 'lost') return;
  b.sending = false;
  if (r.status === 'network') {
    // pode ter gravado: relê a agenda ANTES de deixar marcar outro horário (o reenvio no mesmo horário não duplica)
    deskKeys.set(par, key);
    await loadView({ quiet: true });
    if (S.ctx.lost()) return;
    b.msg = [A.ACTION_TEXT.network_desk, 'err'];
    drawForms();
    $('#bkOk')?.focus();
    return;
  }
  deskKeys.delete(par);
  if (r.status === 'ok') {
    // o que o BANCO gravou (no reenvio, o nome digitado agora pode não ser o gravado: a chave não inclui o paciente)
    const it0 = r.items?.[0] || {};
    const proc = S.cat?.procedures?.find((x) => x.id === (it0.procedure_id || b.proc))?.name || 'exame';
    const quando = A.fmtWhen(S.tz, r.slot_start || it0.starts_at || b.slot);
    if (r.replay) b.done = `Este agendamento já tinha sido registrado: ${proc}, ${quando}. Abra o agendamento para conferir o paciente.`;
    else {
      const curto = (b.forOther ? b.otherName : b.name).trim().split(/\s+/);
      const nome = curto.length > 1 ? `${curto[0]} ${curto.at(-1).charAt(0)}.` : curto[0];
      b.done = `Agendado: ${nome}, ${proc}, ${quando}.`;
    }
    b.doneId = r.id || null;
    drawForms();
    await loadView({ quiet: true });
    // o foco vai para a frase "Agendado: …" (o leitor de tela a lê ao chegar nela); o aviso do alto é só para os olhos
    const feito = $('#bkFeito');
    toast(b.done, { falar: !feito });
    feito?.focus();
    return;
  }
  if (r.status === 'not_found') return deskGone();
  if (r.status === 'slot_taken') {
    b.alts = (r.alternatives || []).slice(0, 5);
    b.slot = '';
    b.msg = [A.ACTION_TEXT.slot_taken, 'err'];
    drawForms();
    ($('[data-act="bk-alt"]') || $('#bkVer'))?.focus();
    return;
  }
  if (r.status === 'consent_required') { b.errs = { bkConsent: A.ACTION_TEXT.consent_required }; drawForms(); $('#bkConsent')?.focus(); return; }
  b.msg = [statusMsg(r, { message: r.message }), 'err'];
  drawForms();
  $('#bkOk')?.focus();
}

function readDesk() {
  const b = S.bk;
  if (!$('#bkForm')) return;
  b.proc = $('#bkProc').value; b.day = $('#bkDia').value;
  b.name = $('#bkNome').value; b.phone = $('#bkFone').value; b.email = $('#bkEmail').value;
  b.forOther = $('#bkOutra').checked;
  if (b.forOther && $('#bkOutroNome')) { b.otherName = $('#bkOutroNome').value; b.relationship = $('#bkParentesco').value; b.otherMinor = $('#bkMenor').checked; b.authorize = $('#bkAutoriza').checked; }
  b.channel = $('input[name="bkCanal"]:checked')?.value || '';
  b.consent = $('#bkConsent').checked;
}

const procInfo = (p) => (p ? [p.prep_text ? `Preparo: ${p.prep_text}` : '', p.fasting_hours ? `Jejum de ${p.fasting_hours} h.` : ''].filter(Boolean).join(' ') || 'Sem preparo informado.' : '');

// Exame ou dia do novo agendamento mudou: os horários mostrados (e as alternativas) saem e o texto do preparo muda — no
// lugar, sem desenhar o formulário de novo (o campo de data em uso não pode ser recriado no meio da digitação).
function deskChanged(id) {
  const b = S.bk;
  if (!b || !$('#bkForm')) return;
  readDesk();
  b.res = null; b.slot = ''; b.alts = null; b.loading = false;
  if (b.errs) { delete b.errs.bkSlot; if (id === 'bkProc') delete b.errs.bkProc; }
  const slots = $('#bkSlots');
  if (slots) slots.innerHTML = '<span class="cl-err" id="bkSlotErr"></span>';
  $('#bkAlts')?.remove();
  if (id === 'bkProc') {
    const info = $('#bkProcInfo');
    if (info) info.textContent = procInfo((S.cat?.procedures || []).find((x) => x.id === b.proc));
    const er = $('#bkProcErr');
    if (er) er.textContent = '';
    $('#bkProc')?.removeAttribute('aria-invalid');
  }
}

async function deskSlots() {
  const b = S.bk;
  readDesk();
  b.errs = {};
  if (!b.proc) { b.errs.bkProc = 'Escolha o exame.'; drawForms(); $('#bkProc').focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.day || '')) b.day = today();
  b.slot = '';
  b.loading = true; b.res = null; b.alts = null; drawForms();
  const r = await call('agenda_desk_slots', { p_clinic: S.clinicId, p_procedure: b.proc, p_from: b.day });
  if (r.status === 'lost') return;
  b.loading = false;
  if (r.status === 'missing_fn') { S.missing.desk = true; S.form = null; drawForms(); drawTop(); msg('Horários livres indisponíveis no momento.', 'warn'); return; }
  if (r.status === 'not_found') return deskGone();
  if (r.status === 'ok') b.res = r; else b.msg = [statusMsg(r), 'err'];
  drawForms();
  ($('input[name="bkSlot"]') || $('#bkSemHorario') || $('#bkVer'))?.focus();
}

// not_found no balcão = o exame foi desativado por outra pessoa: relê o catálogo e pede para escolher de novo.
async function deskGone() {
  const b = S.bk;
  await reloadCatalog();
  if (S.ctx.lost() || S.bk !== b) return;
  if (!(S.cat?.procedures || []).some((x) => x.id === b.proc)) b.proc = '';
  b.slot = ''; b.res = null; b.alts = null; b.loading = false; b.sending = false; b.msg = null;
  b.errs = { bkProc: A.ACTION_TEXT.not_found_exam };
  drawForms();
  $('#bkProc')?.focus();
}

async function doBusy() {
  const o = S.oc;
  o.res = $('#ocRec').value; o.reason = $('#ocMotivo').value; o.day = $('#ocDia').value; o.start = $('#ocIni').value; o.end = $('#ocFim').value;
  o.errs = {}; o.msg = null;
  if (!o.res) o.errs.ocRec = 'Escolha o aparelho, a sala ou o profissional.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.day || '')) o.errs.ocDia = 'Escolha o dia.';
  if (Number.isNaN(A.toMin(o.start))) o.errs.ocIni = 'Escolha o horário de início.';
  if (Number.isNaN(A.toMin(o.end))) o.errs.ocFim = 'Escolha o horário de fim.';
  else if (!o.errs.ocIni && A.toMin(o.end) <= A.toMin(o.start)) o.errs.ocFim = 'O fim precisa ser depois do início.';
  if (Object.keys(o.errs).length) { drawForms(); $(`#${['ocRec', 'ocDia', 'ocIni', 'ocFim'].find((k) => o.errs[k])}`)?.focus(); return; }
  const ini = A.localToUtc(o.day, o.start, S.tz); const fim = A.localToUtc(o.day, o.end, S.tz);
  if (Date.parse(fim) <= Date.now()) { o.errs.ocFim = 'Esse horário já passou.'; drawForms(); $('#ocFim').focus(); return; }
  o.sending = true; drawForms();
  const r = await call('agenda_desk_busy', { p_clinic: S.clinicId, p_starts: ini, p_ends: fim, p_resource: o.res, p_procedure: null, p_reason: o.reason });
  if (r.status === 'lost') return;
  if (r.status === 'network') {
    // sem chave de reenvio: relê a agenda ANTES de deixar tentar de novo (pode ter gravado)
    await loadView({ quiet: true });
    o.sending = false;
    o.msg = [`${A.ACTION_TEXT.network} Confira na agenda se o horário já aparece ocupado antes de tentar de novo.`, 'err'];
    drawForms(); $('#ocOk')?.focus();
    return;
  }
  o.sending = false;
  if (r.status === 'ok') {
    const texto = `Horário ocupado: ${resName(o.res)}, ${A.fmtDayShort(o.day)} das ${o.start} às ${o.end}.`;
    S.form = null; S.oc = null;
    drawForms();
    if (S.view === 'dia' || S.view === 'hoje') S.day = o.day;
    await loadView({ quiet: true });
    msg(texto, 'ok', null, { flutuante: true });
    $('#agTitulo')?.focus();
    return;
  }
  if (r.status === 'not_found') {
    // o aparelho, a sala ou o profissional foi desativado: relê o catálogo e a agenda e pede para escolher de novo
    await reloadCatalog();
    await loadView({ quiet: true });
    if (S.ctx.lost() || S.oc !== o) return;
    if (!resources().some((x) => x.id === o.res && x.active !== false)) o.res = '';
    o.errs = { ocRec: A.ACTION_TEXT.not_found_resource };
    drawForms(); $('#ocRec')?.focus();
    return;
  }
  o.msg = [r.status === 'slot_taken' ? 'Esse horário já está ocupado ou bloqueado. Escolha outro.' : statusMsg(r), 'err'];
  drawForms(); $('#ocOk')?.focus();
}

function readBlock() {
  const b = S.bl;
  if (!$('#blForm')) return;
  b.alvo = $('#blAlvo').value; b.tipo = $('#blTipo').value; b.modo = $('input[name="blModo"]:checked')?.value || 'day';
  b.from = $('#blFrom').value; b.to = $('#blTo')?.value ?? b.to; b.start = $('#blStart')?.value ?? b.start; b.end = $('#blEnd')?.value ?? b.end;
  b.motivo = $('#blMotivo').value.trim().replace(/\s+/g, ' ').slice(0, 120);
}

function redrawBlockForm(focusSel) {
  if (S.view === 'bloqueios') drawMain(); else drawForms();
  if (focusSel) $(focusSel)?.focus();
}

// Os argumentos do bloqueio a partir do formulário: o MESMO cálculo na prévia e no "mesmo assim".
function blockArgs() {
  const b = S.bl;
  const r = A.blockRangeTz({ kind: b.modo, from: b.from, to: b.modo === 'part' ? '' : b.to, start: b.start, end: b.end }, S.tz);
  return { ...r, args: r.starts ? { p_clinic: S.clinicId, p_resource: b.alvo || null, p_starts: r.starts, p_ends: r.ends, p_kind: b.tipo, p_reason: b.motivo || null } : null };
}

// Mudou o formulário depois da prévia: a lista de afetados (e o "mesmo assim") sai; é preciso conferir de novo.
function blockFormChanged() {
  const b = S.bl;
  if (!b?.afet) return;
  b.afet = null; b.mudou = true;
  const box = $('#blAfet');
  if (box) box.innerHTML = affectedHtml();
}

// Depois de um erro de rede o bloqueio PODE ter sido gravado (bloqueio não tem chave de reenvio e o banco aceita
// bloqueio sobre bloqueio). Procura um igual: mesmo alvo, início, fim e tipo. null = não deu para conferir.
async function blockSaved(args) {
  if (S.missing.blocks) return null;
  const r = await call('agenda_blocks', { p_clinic: S.clinicId, p_from: A.dayIn(S.tz, Date.parse(args.p_starts)), p_to: A.dayIn(S.tz, Date.parse(args.p_ends) - 60000) });
  if (r.status === 'missing_fn') { S.missing.blocks = true; return null; }
  if (r.status !== 'ok') return null;
  return (r.blocks || []).find((x) => A.sameBlock({ p_resource: x.resource_id, p_kind: x.kind, p_starts: x.starts_at, p_ends: x.ends_at }, args)) || false;
}

async function blockNetwork(args, forced) {
  const b = S.bl;
  b.netPending = args;
  const ja = await blockSaved(args);
  if (S.ctx.lost()) return;
  if (ja) return blockDone(forced ? null : 0, 0, true);
  await loadView({ quiet: true });
  redrawBlockForm();
  msg(A.ACTION_TEXT.network_block, 'err');
  ($('#blForcar') || $('#blOk'))?.focus();
}

// A tentativa anterior com estes dados ficou sem resposta: antes de mandar de novo, confere se já está gravado.
async function blockPending(args) {
  const b = S.bl;
  if (!b.netPending || !A.sameBlock(b.netPending, args)) return 'enviar';
  const ja = await blockSaved(args);
  if (ja === null) return 'sem_rede';
  b.netPending = null;
  return ja ? 'ja_salvo' : 'enviar';
}

async function doBlock() {
  const b = S.bl;
  readBlock();
  b.afet = null; b.mudou = false;
  const { errs, args } = blockArgs();
  if (b.alvo && !resources().some((r) => r.id === b.alvo && r.active !== false)) errs.blAlvo = A.ACTION_TEXT.not_found_resource;
  redrawBlockForm();
  let first = null;
  for (const id of ['blAlvo', 'blFrom', 'blTo', 'blStart', 'blEnd']) {
    const el = $(`#${id}`); const er = $(`#${id}Err`);
    if (er) er.textContent = errs[id] || '';
    if (el) { if (errs[id]) { el.setAttribute('aria-invalid', 'true'); first ||= el; } else el.removeAttribute('aria-invalid'); }
  }
  if (first) { first.focus(); return; }
  b.args = args;
  const btn = $('#blOk'); if (btn) { btn.disabled = true; btn.textContent = 'Bloqueando…'; }
  const antes = await blockPending(b.args);
  if (S.ctx.lost()) return;
  if (antes === 'ja_salvo') return blockDone(0, 0, true);
  if (antes === 'sem_rede') { redrawBlockForm('#blOk'); msg(A.ACTION_TEXT.network_block, 'err'); return; }
  const r = await call('agenda_block_add', b.args);
  if (r.status === 'lost') return;
  if (r.status === 'ok') return blockDone(0);
  if (r.status === 'network') return blockNetwork(b.args, false);
  if (r.status === 'not_found') return blockGone();
  if (r.status === 'has_appointments') {
    if (!(canDo('remarcar') || isCentral()) || S.missing.force) {
      redrawBlockForm('#blOk');
      msg(A.blockRefusedText(r), 'err');
      return;
    }
    const p = await call('agenda_block_force', { ...b.args, p_confirm: null });
    if (p.status === 'lost') return;
    if (p.status === 'missing_fn') { S.missing.force = true; redrawBlockForm('#blOk'); msg(A.blockRefusedText(r), 'err'); return; }
    if (p.status === 'confirm_required' || p.status === 'affected_changed') {
      // Só o que já começou estava no período (o banco não mexe nele): ninguém a avisar, bloqueia direto.
      if (!(p.items || []).length && p.confirm) return doForce(p.confirm);
      b.afet = { items: p.items || [], confirm: p.confirm, args: b.args };
      redrawBlockForm('#blAfetT');
      return;
    }
    if (p.status === 'not_found') return blockGone();
    redrawBlockForm('#blOk');
    msg(statusMsg(p), 'err');
    return;
  }
  redrawBlockForm('#blOk');
  msg(statusMsg(r, { canConfig: canConfig() }), 'err');
}

// code: o código da prévia. Sem código = o botão "Bloquear mesmo assim": vale só se o formulário ainda é o da prévia
// (senão, a prévia é refeita com o que está na tela, em vez de gravar o período, o alvo ou o tipo antigos).
async function doForce(code = null) {
  const b = S.bl;
  if (!code) {
    readBlock();
    const cur = blockArgs();
    if (!cur.args || !A.sameBlock(cur.args, b.afet?.args)) { b.afet = null; return doBlock(); }
    b.args = { ...b.afet.args, p_reason: cur.args.p_reason };
    code = b.afet.confirm;
  }
  const btn = $('#blForcar'); if (btn) { btn.disabled = true; btn.textContent = 'Bloqueando…'; }
  // a prévia confirmada (o código só vale para ela): dela sai quantos PACIENTES são — o banco conta por exame
  const previa = A.blockAffected(b.afet?.items);
  const antes = await blockPending(b.args);
  if (S.ctx.lost()) return;
  if (antes === 'ja_salvo') return blockDone(null, 0, true);
  if (antes === 'sem_rede') { redrawBlockForm('#blForcar'); msg(A.ACTION_TEXT.network_block, 'err'); return; }
  const r = await call('agenda_block_force', { ...b.args, p_confirm: code });
  if (r.status === 'lost') return;
  if (r.status === 'ok') return blockDone(r.moved || 0, r.busy_removed || 0, !!r.replay, r.moved && previa.exames === r.moved ? previa.pedidos : null);
  if (r.status === 'network') return blockNetwork(b.args, true);
  if (r.status === 'affected_changed') {
    b.afet = { items: r.items || [], confirm: r.confirm, aviso: A.ACTION_TEXT.affected_changed, args: b.args };
    if (!r.confirm) {
      const p = await call('agenda_block_force', { ...b.args, p_confirm: null });
      if (p.status === 'lost') return;
      b.afet = { items: p.items || [], confirm: p.confirm, aviso: A.ACTION_TEXT.affected_changed, args: b.args };
    }
    redrawBlockForm('#blAfetT');
    return;
  }
  if (r.status === 'cannot_move') { b.afet = { items: r.items || b.afet?.items || [], confirm: null, args: b.args }; redrawBlockForm('#blAfetT'); return; }
  if (r.status === 'not_found') return blockGone();
  redrawBlockForm();
  msg(statusMsg(r), 'err');
  ($('#blNao') || $('#blOk'))?.focus();
}

// moved: quantos exames foram para "Para remarcar" (null = não se sabe: o bloqueio foi achado já gravado depois de um
// erro de rede no "mesmo assim"); busy: "só ocupar" retirados; replay: o bloqueio já estava salvo (nada novo foi
// gravado agora); pedidos: quantos pacientes (da prévia confirmada).
async function blockDone(moved, busy = 0, replay = false, pedidos = null) {
  const remarcar = moved == null || moved > 0;
  const texto = A.blockDoneText({ moved, busy, replay, pedidos });
  S.bl = null;
  if (S.form === 'bloquear') S.form = null;
  if (remarcar) { S.view = S.view === 'bloqueios' || S.view === 'mes' || S.view === 'semana' ? 'hoje' : S.view; S.remOpen = true; }
  drawForms();
  drawTop();
  await loadView({ quiet: true });
  msg(texto, 'ok', null, { flutuante: true });
  ((remarcar && $('#agRemT')) || $('#agBlT') || $('#agTitulo'))?.focus();
}

// ---------- "Precisa de atenção" (4.3) ----------
// Só com o que já está na memória: os itens do período na tela, os conflitos abertos e os pedidos sem resposta.
// Desenhado com patch (o botão com o foco continua) a cada carga, a cada minuto e a cada estado do vigia.
function drawAtencao() {
  const box = $('#agAtencao');
  if (!box) return;
  if (!['hoje', 'dia', 'semana'].includes(S.view) || !S.data) { box.innerHTML = ''; return; }
  const list = A.attentionItems({ items: S.data.items || [], conflicts: showRemarcar() ? S.conflicts : [], pendentes: podePedidos() ? S.pend?.n ?? null : null, pendentesMais: !!S.pend?.mais, now: Date.now(), unit: unit() });
  if (!list.length) { box.innerHTML = ''; return; }
  const btn = (it) => {
    if (it.key === 'pedidos') return `<button type="button" class="btn btn-ghost btn-sm" data-act="at-pedidos">Ver pedidos</button>`;
    if (it.key === 'remarcar' && showRemarcar() && S.conflicts.length) return `<button type="button" class="btn btn-ghost btn-sm" data-act="at-rem">Ver a lista${sr(' Para remarcar')}</button>`;
    const id = it.ids.find((x) => findItem(x)) || it.ids[0];
    return id ? `<button type="button" class="btn btn-ghost btn-sm" data-act="at-item" data-item="${esc(id)}" data-k="${esc(it.key)}">Ver${sr(` ${it.key === 'chegadas' ? 'o agendamento sem registro' : it.key === 'reservas' ? 'a reserva' : 'o agendamento para remarcar'}`)}</button>` : '';
  };
  patch(box, `<section class="ag-atencao" aria-labelledby="agAtT">
      <h3 class="ac-h" id="agAtT" tabindex="-1">${icon('fa-bell')}Precisa de atenção</h3>
      <ul class="ag-atlista">${list.map((it) => `<li data-k="${esc(it.key)}"><span>${esc(it.text)}</span>${btn(it)}</li>`).join('')}</ul>
    </section>`);
}

// "Ver": o botão do agendamento na tela (lista ou grade); se ele está em outro dia ou escondido pelo filtro, abre o dia
// dele (sem filtros) e põe o foco nele.
async function irParaItem(id) {
  const sel = `[data-act="abrir"][data-item="${CSS.escape(id)}"]`;
  let el = $(sel, S.box);
  if (!el) {
    const it = findItem(id);
    if (!it) return;
    const dia = A.dayIn(S.tz, Date.parse(it.starts_at));
    S.f = { proc: '', res: '', canal: '', cancel: false };
    S.day = dia; S.view = dia === today() ? 'hoje' : 'dia'; S.det = null;
    drawTop(); drawDetail(); drawMain();
    await loadView();
    el = $(sel, S.box);
  }
  if (!el) { $('#agTitulo')?.focus(); return; }
  el.scrollIntoView?.({ block: 'center' });
  el.focus();
}

// ---------- visão Resumo (painel gerencial, 4.3) ----------
// Só números das funções agenda_dashboard e agenda_dashboard_financeiro (sem dado de paciente); nada inventado.
const podeFinanceiro = () => S.ctx.admin || A.can(S.ctx.perms, 'financeiro.ver');
const podePedidos = () => !isCentral() && !isProf() && S.ctx.perms?.['pedidos.ver'] === 'clinica';
const n0 = (v) => Math.round(Number(v) || 0).toLocaleString('pt-BR');
function tabela(caption, head, rows, { empty = 'Nada neste período.', id = '' } = {}) {
  return `<section class="ag-rsbox"${id ? ` id="${id}"` : ''} aria-label="${esc(caption)}"><h4 class="ag-sub">${esc(caption)}</h4>
    ${rows.length ? `<table class="ag-rstb${head.length > 2 ? ' ag-rstb-larga' : ''}"><thead><tr>${head.map((h, i) => `<th scope="col"${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td class="n" data-h="${esc(head[i])}">${c}</td>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</tbody></table>` : `<p class="cl-help">${esc(empty)}</p>`}
  </section>`;
}
// Barra com o número sempre escrito (a cor nunca sozinha).
const barra = (v, max, texto) => `<span class="ag-rsbar"><i style="width:${max ? Math.max(2, Math.round((Number(v) / max) * 100)) : 0}%" aria-hidden="true"></i><b>${esc(texto)}</b></span>`;
function resumoHtml() {
  const rs = S.rs;
  const per = A.periodRange(rs.period, today(), today(), rs);
  const filtros = !!(S.f.proc || S.f.res || S.f.canal);
  const controls = `<div class="ag-rsctl">
      <div class="cl-field"><label class="cl-lbl" for="rsPeriodo">Período</label><select id="rsPeriodo" data-rs="period">${opts(A.PERIODS, rs.period)}</select></div>
      ${rs.period === 'custom' ? `<div class="cl-field"><label class="cl-lbl" for="rsDe">Do dia</label><input type="date" id="rsDe" data-rs="from" value="${esc(rs.from)}"></div>
        <div class="cl-field"><label class="cl-lbl" for="rsAte">Até o dia</label><input type="date" id="rsAte" data-rs="to" value="${esc(rs.to)}"></div>
        <div class="cl-field ag-rsgo"><button type="button" class="btn btn-ghost btn-sm" data-act="rs-ver">Ver período</button></div>` : ''}
    </div>`;
  if (per.error) return `${controls}${note(esc(per.error), 'warn')}`;
  const d = S.dash;
  if (S.missing.dash) return `${controls}${note('O resumo da agenda ainda não está disponível neste banco.', 'warn')}`;
  if (!d) return `${controls}${loading('Calculando o resumo…')}`;
  if (d.status === 'forbidden') return `${controls}${note('Sua conta não pode ver o resumo desta clínica.', 'info')}`;
  if (d.status !== 'ok') return `${controls}${note('Não foi possível calcular o resumo para esse período. Confira as datas.', 'warn')}`;
  const ps = d.por_situacao || {};
  const periodo = `${A.fmtDDMMYYYY(d.from)} a ${A.fmtDDMMYYYY(d.to)}`;
  const kpi = (label, value, extra = '') => `<div class="vs-kpi ag-kpi"><span>${esc(label)}</span><b>${value}</b>${extra ? `<small>${esc(extra)}</small>` : ''}</div>`;
  const dias = d.por_dia || [];
  const maxDia = dias.reduce((m, x) => Math.max(m, Number(x.total) || 0), 0);
  const rec = d.recursos || [];
  const canc = Object.entries(d.cancelamentos_por_motivo || {}).sort((a, b) => b[1] - a[1]);
  const orig = d.origem || {};
  const totalOrig = A.DASH_ORIGIN.reduce((s, [k]) => s + (Number(orig[k]) || 0), 0);
  let fin = '';
  if (podeFinanceiro() && !S.missing.fin) {
    const f = S.fin;
    if (f?.status === 'ok') {
      const ex = Object.entries(f.por_exame || {}).sort((a, b) => b[1].estimada_cents - a[1].estimada_cents);
      fin = `<section class="ag-rssec" aria-labelledby="agFinT"><h3 class="ac-h" id="agFinT" tabindex="-1">${icon('fa-tags')}Financeiro</h3>
        ${filtros ? note('O financeiro não usa os filtros: são todos os exames, recursos e origens do período.', 'info') : ''}
        <p class="cl-help">${esc(f.nota || '')}</p>
        <div class="vs-kpis ag-kpis ag-kpis-din">
          ${kpi('Receita estimada', esc(A.centsText(f.receita_estimada_cents)), 'agendamentos marcados e concluídos')}
          ${kpi('Receita dos concluídos', esc(A.centsText(f.receita_concluida_cents)))}
          ${kpi('Agendamentos contados', n0(f.agendamentos))}
          ${kpi('Sob consulta (sem preço)', n0(f.sob_consulta))}
        </div>
        ${tabela('Por exame', ['Exame', 'Agendamentos', 'Estimada', 'Concluída'], ex.map(([code, x]) => [esc(examName(code) || code), n0(x.agendamentos), esc(A.centsText(x.estimada_cents)), esc(A.centsText(x.concluida_cents))]), { empty: 'Nenhum agendamento com exame neste período.' })}
      </section>`;
    } else if (f && f.status !== 'forbidden') {
      fin = `<section class="ag-rssec" aria-labelledby="agFinT"><h3 class="ac-h" id="agFinT" tabindex="-1">${icon('fa-tags')}Financeiro</h3>${note('Não foi possível calcular o financeiro para esse período.', 'warn')}</section>`;
    }
  }
  return `${controls}
    <p class="cl-help ag-rsper">Período: <b>${esc(periodo)}</b>. Números no fuso da clínica.</p>
    <section class="ag-rssec" aria-labelledby="agOpT"><h3 class="ac-h" id="agOpT" tabindex="-1">${icon('fa-list-check')}Operacional${filtros ? ' <small class="ag-rsfil">(com os filtros ligados)</small>' : ''}</h3>
      <div class="vs-kpis ag-kpis">
        ${kpi('Agendamentos no período', n0(d.total))}
        ${A.DASH_STATUS.map(([k, l]) => kpi(l, n0(ps[k]))).join('')}
        ${kpi('Faltas', esc(A.pctText(d.faltas_pct)), 'entre concluídos e faltas')}
      </div>
      ${tabela('Por dia', ['Dia', 'Agendamentos'], dias.map((x) => [esc(A.fmtDayShort(x.day)), barra(x.total, maxDia, n0(x.total))]), { empty: 'Nenhum agendamento neste período.' })}
      ${tabela('Ocupação por aparelho, sala ou profissional', ['Recurso', 'Ocupação', 'Ocupado', 'Aberto', 'Bloqueado'], rec.map((r) => [`${esc(r.name)}<small>${esc(A.KIND_LABEL[r.kind] || r.kind)}${Number(r.capacity) > 1 ? ` · ${esc(String(r.capacity))} vagas` : ''}</small>`, barra(r.ocupacao_pct, 100, A.pctText(r.ocupacao_pct)), esc(A.minutesText(r.minutos_ocupados)), esc(A.minutesText(r.minutos_abertos)), esc(A.minutesText(r.minutos_bloqueados))]), { empty: 'Nenhum aparelho, sala ou profissional cadastrado.' })}
      ${d.formula ? `<p class="cl-help ag-rsform">${icon('fa-circle-info')}${esc(d.formula)}</p>` : ''}
      ${tabela('Origem dos agendamentos', ['Origem', 'Agendamentos'], A.DASH_ORIGIN.map(([k, l]) => [esc(l), barra(orig[k], totalOrig, n0(orig[k]))]), { empty: 'Nenhum agendamento neste período.' })}
      ${tabela('Cancelamentos por motivo', ['Motivo', 'Cancelamentos'], canc.map(([code, n]) => [esc(A.cancelReasonText(code)), n0(n)]), { empty: 'Nenhum cancelamento neste período.' })}
    </section>
    ${fin}`;
}
function onResumoChange(t) {
  if (t.dataset.rs === 'period') {
    S.rs.period = t.value;
    S.dash = null; S.fin = null;
    keepFocus(drawMain);
    if (S.rs.period !== 'custom' || (S.rs.from && S.rs.to)) loadView();
    else ($('#rsDe') || $('#rsPeriodo'))?.focus();
    return;
  }
  S.rs[t.dataset.rs] = t.value;   // datas: valem no "Ver período" (não desenha no meio da digitação)
}

// ---------- eventos ----------
function onClick(e) {
  const t = e.target.closest('button,[data-act]');
  if (!t || !S.box.contains(t)) return;
  const act = t.dataset.act;
  if (t.dataset.view) {
    S.view = t.dataset.view;
    try { localStorage.setItem(LS_VIEW, S.view); } catch { /* sem armazenamento */ }
    if (S.view === 'hoje') S.day = today();
    S.det = null; S.ask = null;
    if (S.form === 'bloquear' && S.view === 'bloqueios') S.form = null;
    drawTop(); drawForms(); drawRemarcar(); drawDetail(); drawMain(); drawSearch();
    $(`[data-view="${S.view}"]`)?.focus();
    anunciarPeriodo();
    loadView();
    return;
  }
  if (!act) return;
  const id = t.dataset.item;
  const handlers = {
    config: () => S.ctx.goTab('config'),
    'at-pedidos': () => S.ctx.goTab('pedidos'),
    'at-rem': () => { if ($('#agRemT')) { $('#agRemT').focus(); return; } S.view = 'hoje'; S.day = today(); S.det = null; drawTop(); drawDetail(); drawMain(); loadView().then(() => ($('#agRemT') || $('#agTitulo'))?.focus()); },
    'at-item': () => irParaItem(t.dataset.item),
    'rs-ver': () => { S.rs.from = $('#rsDe')?.value || ''; S.rs.to = $('#rsAte')?.value || ''; S.dash = null; S.fin = null; drawMain(); $('[data-act="rs-ver"]')?.focus(); loadView(); },
    atualizar: async () => {
      const ok = await loadView();
      if (ok) msg('Agenda atualizada.', 'ok');
      else if (ok === false) msg(S.loadError || 'Não foi possível atualizar a agenda agora.', 'err');
      ($('#agAtualizar') || $('#agTitulo'))?.focus();
    },
    ant: () => nav(-1), prox: () => nav(1),
    hojebtn: () => { S.day = today(); S.det = null; drawTop(); drawDetail(); drawMain(); $('[data-act="hojebtn"]')?.focus(); anunciarPeriodo(); loadView(); },
    modo: () => { S.listMode = !S.listMode; drawTop(); drawMain(); $('#agModo')?.focus(); falar(S.listMode ? 'Mostrando em lista.' : 'Mostrando em grade.'); },
    novo: () => openForm('novo'), ocupar: () => openForm('ocupar'), bloquear: () => openForm('bloquear'),
    'fechar-form': () => { const k = S.form; S.form = null; drawForms(); ($(k === 'novo' ? '#agNovo' : k === 'ocupar' ? '#agOcupar' : '#agBloquear') || $('#agTitulo'))?.focus(); },
    abrir: () => {
      if (t.dataset.req) { openDetail(t.dataset.req, { origin: t.id ? `#${t.id}` : `#agBuscaRes [data-req="${t.dataset.req}"]` }); return; }
      const it = findItem(id);
      if (!it) return;
      openDetail(it.request_id, { itemId: it.id, origin: `[data-act="abrir"][data-item="${it.id}"]` });
    },
    ocupado: () => { const b = (S.data?.busy || []).find((x) => x.id === t.dataset.busy); if (b) openDetail(null, { busy: b, origin: `[data-act="ocupado"][data-busy="${b.id}"]` }); },
    'fechar-det': () => closeDetail(),
    'abrir-dia': () => { S.day = t.dataset.dia; S.view = 'dia'; drawTop(); drawRemarcar(); drawMain(); loadView(); $('#agTitulo')?.focus(); },
    'mes-todos': () => { S.monthAll = !S.monthAll; drawMain(); $('[data-act="mes-todos"]')?.focus(); falar(S.monthAll ? 'Mostrando todos os dias do mês.' : 'Mostrando só os dias com movimento.'); },
    atender: () => {
      if (S.busy.has(id) || t.getAttribute('aria-disabled') === 'true') return;   // chamada do item em andamento: ignora
      const where = t.dataset.w;
      const item = where === 'd' ? itemFromDetail(id) : findItem(id);
      if (!item) return;
      const a = attendActionFor(item, t.dataset.k);
      if (!a || !a.enabled) return;
      if (a.confirm) { S.ask = { itemId: id, key: a.key, where, origin: t }; if (where === 'd') drawDetail(); else drawMain(); ($('#agAskMotivo') || $('#agAskSim'))?.focus(); return; }
      doAttend(item, a, where);
    },
    sim: () => {
      const a = S.ask; if (!a || S.busy.has(a.itemId) || t.getAttribute('aria-disabled') === 'true') return;
      const item = a.where === 'd' ? itemFromDetail(a.itemId) : findItem(a.itemId);
      // a ação de AGORA (a agenda pode ter sido relida com a pergunta na tela): se não existe mais, nada é enviado
      const act = item && attendActionFor(item, a.key);
      if (!act || !act.enabled) {
        S.ask = null;
        if (a.where === 'd') drawDetail(); else drawMain();
        msg(act?.hint ? A.actionText('too_early', { hint: act.hint }) : A.ACTION_TEXT.status_changed, 'err');
        ($(`[data-act="abrir"][data-item="${CSS.escape(a.itemId)}"]`) || $('#agDetT') || $('#agTitulo'))?.focus();
        return;
      }
      if (a.key === 'desfazer') {
        a.reason = $('#agAskMotivo').value;
        if (!a.reason) { a.err = A.ACTION_TEXT.reason_required; if (a.where === 'd') drawDetail(); else drawMain(); $('#agAskMotivo').setAttribute('aria-invalid', 'true'); $('#agAskMotivo').focus(); return; }
      }
      doAttend(item, act, a.where, a.key === 'desfazer' ? a.reason : null);
    },
    'voltar-ask': () => { const a = S.ask; S.ask = null; if (a?.where === 'd') drawDetail(); else drawMain(); $(`[data-act="atender"][data-item="${CSS.escape(a.itemId)}"][data-k="${a.key}"]`)?.focus(); },
    'just-ok': () => {
      const v = $('#agJust').value;
      if (!v) { S.det.justErr = 'Escolha o motivo.'; drawDetail(); $('#agJust').focus(); return; }
      S.det.just = v; S.det.needJust = false; S.det.loading = true; S.det.justErr = '';
      drawDetail(); loadDetail().then(() => $('#agDetT')?.focus());
    },
    historico: async () => {
      if (S.det.hist) { S.det.hist = null; drawDetail(); $('[data-act="historico"]')?.focus(); return; }
      const r = await call('agenda_history', { p_id: S.det.id });
      if (r.status === 'ok') S.det.hist = r.history || []; else S.det.msg = [statusMsg(r), 'err'];
      drawDetail(); ($('#agHistT') || $('[data-act="historico"]'))?.focus();
    },
    remarcar: () => {
      S.det.msg = null;
      const ok = startReschedule(id);
      drawDetail();
      (ok ? $('#rmT') : $('#agDetT'))?.focus();
    },
    'rm-ver': async () => {
      const m = S.det.rm; m.day = $('#rmDia').value || today(); m.slot = ''; m.key = null;
      const it = S.det.data.items.find((x) => x.id === m.itemId);
      drawDetail();
      const r = await loadSlots(m, { p_clinic: S.clinicId, p_procedure: it.procedure_id, p_from: m.day, p_to: null, p_request: S.det.id, p_item: m.itemId });
      m.loading = false;
      if (r.status === 'lost') return;
      if (r.status === 'not_found') {
        // o agendamento sumiu (loadDetail mostra isso) ou o exame dele foi desativado (não há horário por aqui)
        await reloadCatalog();
        await loadDetail();
        if (S.det?.data) { S.det.sub = null; S.det.rm = null; S.det.msg = [A.ACTION_TEXT.not_found_resched, 'err']; }
        drawDetail(); $('#agDetT')?.focus();
        return;
      }
      if (r.status === 'ok') m.res = r; else S.det.msg = [statusMsg(r), 'err'];
      drawDetail(); ($('input[name="rmSlot"]') || $('#rmVer'))?.focus();
    },
    'rm-alt': () => { const m = S.det.rm; m.slot = t.dataset.t; m.key = uuid(); m.alts = null; drawDetail(); $('#rmOk')?.focus(); },
    'rm-ok': () => doReschedule(),
    'rm-fechar': () => { const it = S.det.rm?.itemId; S.det.sub = null; S.det.rm = null; drawDetail(); $(`[data-act="remarcar"][data-item="${CSS.escape(it || '')}"]`)?.focus(); },
    'voltar-horario': async () => {
      const item = itemFromDetail(id);
      if (!item || S.busy.has(item.id)) return;   // clique duplo: uma chamada só
      S.busy.add(item.id);
      try {
        const r = await call('agenda_set_status', { p_id: item.request_id, p_status: 'confirmed', p_version: item.request_version, p_item: item.id });
        if (r.status === 'lost') return;
        if (r.status === 'ok') {
          await loadDetail(); await loadView({ quiet: true });
          const resolvido = await resolveConflicts([item.id], 'mantido');
          if (S.det) S.det.msg = [`Voltou ao horário de antes: ${A.fmtWhen(S.tz, item.starts_at)}.${resolvido ? '' : ' Não foi possível tirar da lista Para remarcar agora; tente de novo.'}`, resolvido ? 'ok' : 'warn'];
        } else {
          if (S.det) S.det.msg = [r.status === 'slot_taken' ? A.ACTION_TEXT.slot_taken_back : statusMsg(r), 'err'];
          if (['version_conflict', 'not_found', 'transition_not_allowed'].includes(r.status)) { await loadDetail(); await loadView({ quiet: true }); }
        }
      } finally { S.busy.delete(item.id); }
      drawDetail(); $('#agDetT')?.focus();
    },
    cancelar: () => { S.det.sub = 'cancelar'; S.det.cn = { itemId: id, reason: '' }; S.det.msg = null; drawDetail(); $('#cnMotivo')?.focus(); },
    'cn-ok': () => {
      const c = S.det.cn; c.reason = $('#cnMotivo').value;
      if (!c.reason) { c.err = A.ACTION_TEXT.reason_required; drawDetail(); $('#cnMotivo').focus(); return; }
      const item = itemFromDetail(c.itemId);
      c.err = '';
      c.ask = A.cancelItemAsk(item, { pacote: cancelaExame(), tz: S.tz });
      drawDetail(); $('#cnSim')?.focus();
    },
    'cn-sim': () => doCancel(),
    'cn-voltar': () => { S.det.cn.ask = null; drawDetail(); $('#cnOk')?.focus(); },
    'cn-fechar': () => { const it = S.det.cn?.itemId; S.det.sub = null; S.det.cn = null; drawDetail(); $(`[data-act="cancelar"][data-item="${CSS.escape(it || '')}"]`)?.focus(); },
    'pedido-st': async () => {
      const st = t.dataset.st;
      try {
        const res = await rpc('set_request_status', { p_id: S.det.id, p_status: st });
        if (res !== 'ok') throw Object.assign(new Error(res), { result: res });
        await loadDetail();
        S.det.msg = [`Situação mudada para “${A.clinicStatusLabel(st)}”.`, 'ok'];
      } catch (err) {
        if (S.ctx.lost()) return;
        S.det.msg = [err.result ? A.actionText(err.result) : friendlyError(err, 'Não foi possível mudar a situação agora.'), 'err'];
      }
      drawDetail(); $('#agDetT')?.focus();
    },
    liberar: () => { S.det.askFree = true; drawDetail(); $('#agLiberarSim')?.focus(); },
    'liberar-nao': () => { S.det.askFree = false; drawDetail(); $('#agLiberar')?.focus(); },
    'liberar-sim': async () => {
      const b = S.det.busy;
      const r = await call('agenda_desk_busy_remove', { p_id: b.id });
      if (r.status === 'ok' || r.status === 'not_found') {
        S.det = null; await loadView({ quiet: true }); drawDetail(); drawMain();
        msg('Horário liberado.', 'ok', null, { flutuante: true }); $('#agTitulo')?.focus();
        return;
      }
      S.det.askFree = false; S.det.msg = [statusMsg(r), 'err']; drawDetail(); $('#agLiberar')?.focus();
    },
    'bk-ver': () => deskSlots(),
    'bk-alt': () => { S.bk.slot = t.dataset.t; S.bk.alts = null; doDeskBook(); },
    'bl-rm': () => { S.blRm = t.dataset.id; drawMain(); $('#agBlRmSim')?.focus(); },
    'bl-rm-nao': () => { S.blRm = null; drawMain(); $(`[data-act="bl-rm"][data-id="${CSS.escape(t.dataset.id)}"]`)?.focus(); },
    'bl-rm-sim': async () => {
      const ids = (S.blocks?.blocks || []).map((x) => x.id);
      const i = ids.indexOf(t.dataset.id);
      const prox = ids[i + 1] || ids[i - 1];
      const blk = S.blocks.blocks[i];
      const r = await call('agenda_block_remove', { p_block: t.dataset.id });
      S.blRm = null;
      if (r.status === 'ok' || r.status === 'not_found') {
        await loadView({ quiet: true });
        const texto = `Bloqueio de ${A.blockWhenTz(blk, S.tz)} removido.`;
        msg(texto, 'ok', null, { flutuante: true });
        ($(`[data-act="bl-rm"][data-id="${CSS.escape(prox || '')}"]`) || $('#blFrom') || $('#agBlT'))?.focus();
        return;
      }
      drawMain(); msg(statusMsg(r), 'err');
    },
    'bl-forcar': () => doForce(),
    'bl-nao': () => { S.bl.afet = null; S.bl.mudou = false; redrawBlockForm('#blFrom'); },
    'conf-ver': () => confAct(t.dataset.k, null),
    'conf-remarcar': () => confAct(t.dataset.k, 'remarcar'),
    'conf-cancelar': () => confAct(t.dataset.k, 'cancelar'),
    'conf-manter': async () => {
      const r = await call('agenda_conflict_resolve', { p_id: t.dataset.k, p_status: 'descartado', p_code: 'mantido' });
      await loadView({ quiet: true });
      msg(r.status === 'ok' ? 'Horário mantido: saiu da lista Para remarcar.' : statusMsg(r), r.status === 'ok' ? 'ok' : 'err');
      ($('#agRemT') || $('#agTitulo'))?.focus();
    },
    // "Tirar da lista" (o do bloqueio e os outros; o de grade que mudou sai por "Manter este horário"), com confirmação
    'conf-tirar': () => { S.remAsk = t.dataset.k; drawRemarcar(); $('#agkSim')?.focus(); },
    'conf-tirar-nao': () => { const k = S.remAsk; S.remAsk = null; drawRemarcar(); $(`[data-act="conf-tirar"][data-k="${CSS.escape(k || '')}"]`)?.focus(); },
    'conf-tirar-sim': async () => {
      const k = t.dataset.k;
      const r = await call('agenda_conflict_resolve', { p_id: k, p_status: 'descartado', p_code: 'tirado_da_lista' });
      if (r.status === 'lost') return;
      S.remAsk = null;
      const ok = ['ok', 'already_closed', 'not_found'].includes(r.status);
      await loadView({ quiet: true });
      msg(ok ? 'Saiu da lista Para remarcar.' : statusMsg(r), ok ? 'ok' : 'err');
      ($('#agRemT') || $('#agTitulo'))?.focus();
    },
  };
  handlers[act]?.();
}

// O que ficou na lista "Para remarcar" mas já foi resolvido por outro caminho (banco antigo, sem o gatilho da 4.2):
// o código com que sai da lista, ou null se ainda precisa de remarcação.
function conflictDone(k, it) {
  const st = it?.status;
  if (!it || st === 'cancelled') return 'cancelado';
  if (st === 'completed') return 'concluido';
  if (st === 'no_show') return 'faltou';
  if (st === 'expired') return 'expirado';
  if (k.kind === 'bloqueio_sobre_agendamento' && st !== 'reschedule_requested') {
    return Date.parse(it.starts_at) === Date.parse(k.details?.starts_at) ? 'mantido' : 'remarcado';
  }
  return null;
}

async function confAct(kid, sub) {
  const k = (S.conflicts || []).find((x) => x.id === kid);
  if (!k) return;
  await openDetail(k.request_id, { itemId: k.item_id, origin: `[data-act="conf-ver"][data-k="${kid}"]`, conflict: kid, sub: sub === 'remarcar' ? 'remarcar' : null });
  const d = S.det;
  if (!d?.data) return;
  const it = d.data.items.find((x) => x.id === k.item_id);
  const feito = conflictDone(k, it);
  if (feito) {
    // já remarcado, cancelado ou atendido: nada de Remarcar nem Cancelar por aqui; sai da lista
    d.sub = null; d.rm = null; d.cn = null;
    const r = canDo('conflitos') ? await call('agenda_conflict_resolve', { p_id: kid, p_status: 'resolvido', p_code: feito }) : { status: 'forbidden' };
    const saiu = ['ok', 'already_closed', 'not_found'].includes(r.status);
    if (saiu) { S.conflicts = (S.conflicts || []).filter((x) => x.id !== kid); drawRemarcar(); }
    if (S.det !== d) return;
    d.msg = [`Este exame não está mais para remarcar${it ? ` (situação: ${A.clinicStatusLabel(it.status)})` : ''}.${saiu ? ' Saiu da lista Para remarcar.' : ''}`, 'info'];
    drawDetail(); $('#agDetT')?.focus();
    return;
  }
  if (sub === 'remarcar') { const ok = d.rm ? true : startReschedule(k.item_id); drawDetail(); (ok ? $('#rmT') : $('#agDetT'))?.focus(); }
  if (sub === 'cancelar') {
    const pode = A.manageActions(it, { scope: S.scope, can: { remarcar: canDo('remarcar'), cancelar: canDo('cancelar') } }).includes('cancelar');
    if (!pode) { d.msg = [`Este exame não pode ser cancelado: a situação dele é “${A.clinicStatusLabel(it.status)}”.`, 'err']; drawDetail(); $('#agDetT')?.focus(); return; }
    d.sub = 'cancelar'; d.cn = { itemId: k.item_id, reason: '' }; drawDetail(); $('#cnMotivo')?.focus();
  }
}

function nav(dir) {
  if (S.view === 'semana') S.day = A.addDaysTo(S.day, dir * 7);
  else if (S.view === 'mes') { const d = new Date(`${A.monthStart(S.day)}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + dir); S.day = d.toISOString().slice(0, 10); }
  else S.day = A.addDaysTo(S.day, dir);
  S.det = null;
  drawTop(); drawDetail(); drawMain();
  $(`[data-act="${dir < 0 ? 'ant' : 'prox'}"]`)?.focus();
  anunciarPeriodo();
  loadView();
}

function onChange(e) {
  const t = e.target;
  if (t.dataset.f) {
    S.f[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
    if (S.view === 'resumo') { S.dash = null; S.fin = null; drawMain(); loadView(); return; }
    drawMain();
    const sum = $('#agFiltros summary');
    if (sum) sum.lastChild.textContent = S.f.proc || S.f.res || S.f.canal || S.f.cancel ? 'Filtros (ligados)' : 'Filtros';
    return;
  }
  // digitando a data, cada parte (dia, mês, ano) dispara "change": espera a pessoa terminar (Enter, sair, 0,8 s)
  if (t.id === 'agData') { irParaData(Date.now() - (S.dataTecla || 0) > 1500); return; }
  if (t.dataset.rs) { onResumoChange(t); return; }
  if (t.name === 'bkSlot') { S.bk.slot = t.value; S.bk.alts = null; if (S.bk.errs) delete S.bk.errs.bkSlot; return; }
  if (t.id === 'bkOutra' || t.id === 'bkMenor') { readDesk(); drawForms(); $(`#${t.id}`)?.focus(); return; }
  // exame ou dia mudou: os horários mostrados não valem mais. O formulário NÃO é desenhado de novo (o campo de data
  // seria recriado no meio da digitação): só a lista de horários sai e o texto do preparo muda, no lugar.
  if (t.id === 'bkProc' || t.id === 'bkDia') { deskChanged(t.id); return; }
  if (t.name === 'rmSlot') { S.det.rm.slot = t.value; S.det.rm.key = uuid(); S.det.rm.alts = null; drawDetail(); $(`input[name="rmSlot"][value="${CSS.escape(t.value)}"]`)?.focus(); return; }
  if (t.name === 'blModo') {
    readBlock(); S.bl.modo = t.value;
    if (S.bl.afet) { S.bl.afet = null; S.bl.mudou = true; }
    redrawBlockForm(`input[name="blModo"][value="${t.value}"]`);
    return;
  }
  if (S.bl && t.closest?.('#blForm')) blockInput(t);
}

// Formulário de bloqueio: mudar o alvo, o tipo ou o período depois da prévia tira a lista de afetados e o
// "Bloquear mesmo assim" (o motivo não muda quem é atingido); o dia escolhido atualiza o aviso de "hoje".
function blockInput(t) {
  if (t.id !== 'blMotivo') blockFormChanged();
  if (t.id === 'blFrom' || t.id === 'blTo') { readBlock(); drawBlHoje(); }
  if (t.id === 'blAlvo' && t.getAttribute('aria-invalid')) { t.removeAttribute('aria-invalid'); const er = $('#blAlvoErr'); if (er) er.textContent = ''; }
}

function onInput(e) {
  const t = e.target;
  if (t.id === 'agBuscaQ' && t.getAttribute('aria-invalid')) { t.removeAttribute('aria-invalid'); $('#agBuscaErr').textContent = ''; }
  if (S.bl && t.name !== 'blModo' && t.closest?.('#blForm')) blockInput(t);
}

function onSubmit(e) {
  e.preventDefault();
  const id = e.target.id;
  if (id === 'agBusca') doSearch();
  else if (id === 'bkForm') doDeskBook();
  else if (id === 'ocForm') doBusy();
  else if (id === 'blForm') doBlock();
}

function onKey(e) {
  if (e.target.id === 'agData') {
    S.dataTecla = Date.now();
    if (e.key === 'Enter') { e.preventDefault(); irParaData(true); return; }
  }
  if (e.key === 'Escape' && S.det) {
    if (S.ask) { const a = S.ask; S.ask = null; if (a.where === 'd') drawDetail(); else drawMain(); $(`[data-act="atender"][data-item="${CSS.escape(a.itemId)}"][data-k="${a.key}"]`)?.focus(); return; }
    e.preventDefault();
    closeDetail();
  }
}
