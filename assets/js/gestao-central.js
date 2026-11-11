// "Agenda das clínicas": a central do IMED dentro do painel de gestão (iMed Agenda, fase 4.4; arquitetura §11).
// Só para a equipe do IMED: o painel de gestão só chega aqui depois de o banco confirmar a conta (is_imed_admin), e
// cada função agenda_central_* confere de novo a permissão no servidor. Seis partes, em abas:
//   Clínicas    como está a agenda de cada clínica (modalidade, agenda ativa, fuso, feriados conferidos, conflitos,
//               agendamentos por vir, versão e última atividade);
//   Conflitos   os agendamentos que precisam ser remarcados, de todas as clínicas (resolver é na Área da clínica);
//   Auditoria   quem mexeu em quê e quantas vezes dado de paciente foi lido (só contagens e códigos);
//   Feriados    os feriados nacionais: lançar (com a fonte e uma conferência antes) e retirar;
//   Parâmetros  os parâmetros globais que o sistema lê;
//   Equipe      os papéis da equipe do IMED (dar e tirar), só o administrador.
// NENHUM dado de paciente passa por aqui: as funções só mandam números, datas, códigos e nomes de clínica (o e-mail
// da aba Equipe é o da própria equipe do IMED). Regras puras, nomes dos códigos e validação: gestao-core.js.
// Atualização: as abas Clínicas e Conflitos conferem sozinhas a cada 30 s (e na hora, quando o aviso do canal
// "agenda:imed" chega) se algo mudou, pelo vigia de tempo-real.js; as outras têm formulário e só mudam quando a
// pessoa pede. Banco ainda sem as funções (migração não aplicada): um aviso, e nada quebra.
import { auth, $, $$, esc, note, loading, friendlyError } from './clinica.js';
import * as G from './gestao-core.js';
import { startCentralWatcher } from './tempo-real.js';

const novo = () => ({
  on: false, gen: 0, tab: 'clinicas', seq: 0, dados: {}, hooks: {}, vigia: null, estado: null, abertos: null,
  filtroClinicas: null, todos: false, aud: { dias: 30, clinica: '', objeto: '', conta: '' }, quadro: null, ocupado: false,
  rascunhoFer: null, rascunhoEq: null,
});
let C = novo();
let GEN = 0;

const corpo = () => $('#ceCorpo');
const painel = () => $('#cePainel');
const noFn = (err) => err?.status === 404 || err?.data?.code === 'PGRST202' || err?.data?.code === '42883';
const proibido = (err) => err?.data?.code === '42501' || err?.status === 403;
const icon = (n) => `<i class="fa-solid ${n}" aria-hidden="true"></i>`;
const AVISO_SEM_BANCO = 'A central da agenda ainda não está ligada no banco. Ela aparece aqui depois que a atualização do banco desta etapa for aplicada.';

export function centralShellHtml() {
  return `<section class="cl-card gs-sec gs-ce" id="sec-agenda" aria-labelledby="sec-agenda-h">
      <h2 id="sec-agenda-h">${icon('fa-calendar-check')}Agenda das clínicas</h2>
      <p class="cl-help">A central da agenda: como está a agenda de cada clínica, os conflitos abertos, quem mexeu em quê, os feriados nacionais, os parâmetros e os papéis da equipe do IMED. Aqui não aparece dado de paciente: só números, códigos e nomes de clínica.</p>
      <div id="ceCorpo">${loading('Carregando a agenda das clínicas…')}</div>
    </section>`;
}

// hooks: { lost(): a entrada venceu? (a página volta para o quadro de entrar), forbidden(): a conta deixou de ser da equipe }
export function startCentral(hooks = {}) {
  stopCentral();
  C = novo();
  C.on = true;
  C.gen = ++GEN;
  C.hooks = hooks;
  const box = corpo();
  if (!box) return;
  box.onclick = aoClicar;
  box.onsubmit = aoEnviar;
  box.onchange = aoMudar;
  box.onkeydown = aoTeclar;
  carregar('clinicas');
}
export function stopCentral() {
  C.vigia?.stop();
  C.vigia = null;
  C.on = false;
  GEN += 1;
}
// "Atualizar números" do painel: a aba à vista é buscada de novo (sem apagar o que a pessoa está digitando nas outras).
export function refreshCentral() {
  if (C.on && painel() && !C.quadro && !C.ocupado && ['clinicas', 'conflitos'].includes(C.tab)) carregar(C.tab, { quieto: true });
}

/* ======================= buscar ======================= */
const BUSCAS = {
  clinicas: () => auth.rpc('agenda_central_overview'),
  conflitos: () => auth.rpc('agenda_central_conflicts', { p_all: C.todos }),
  auditoria: () => auth.rpc('agenda_central_audit', { p_filters: G.filtrosAuditoria(C.aud).filters }),
  feriados: () => auth.rpc('agenda_central_holidays'),
  parametros: () => auth.rpc('agenda_central_settings'),
  equipe: () => auth.rpc('agenda_central_staff'),
};
const ARRUMA = { clinicas: G.normalizeCentral, conflitos: G.normalizeConflitos, auditoria: G.normalizeAuditoria, feriados: G.normalizeFeriados, parametros: G.normalizeParametros, equipe: G.normalizeEquipe };
const SO_PARA = {
  auditoria: 'A auditoria é só para o administrador e para quem tem o papel de auditoria.',
  equipe: 'Os papéis da equipe são só para o administrador do IMED.',
};

// quieto: sem trocar a tela por "Carregando…" (atualização automática ou depois de gravar); foco: id para onde o
// teclado volta depois de desenhar. Devolve true quando os dados novos chegaram, false quando não chegaram (erro, sem
// permissão, resposta estranha) e null quando a resposta ficou velha (outra busca ou outra tela passou na frente).
async function carregar(tab, { quieto = false, foco = null } = {}) {
  const gen = C.gen;
  const seq = ++C.seq;
  const velho = () => gen !== C.gen || !corpo()?.isConnected;
  const primeira = !painel();
  if (!primeira && !quieto) pinta(loading('Carregando…'));
  let raw;
  try {
    raw = await BUSCAS[tab]();
  } catch (err) {
    if (velho()) return null;
    if (C.hooks.lost?.()) return false;
    if (proibido(err)) { C.hooks.forbidden?.(); return false; }
    if (noFn(err)) { semBanco(); return false; }
    if (seq !== C.seq || tab !== C.tab) return null;
    if (quieto && C.dados[tab]) return false; // a atualização automática falhou: fica o que estava (a faixa diz "sem conexão")
    const html = `${note(esc(friendlyError(err, 'Não foi possível carregar agora. Tente de novo em instantes.')), 'err')}
      <div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" data-ce-retry id="ceRetry">Tentar de novo</button></div>`;
    if (primeira) corpo().innerHTML = html; else pinta(html);
    return false;
  }
  if (velho() || seq !== C.seq) return null;
  if (C.hooks.lost?.()) return false;
  if (raw?.status === 'forbidden') {
    if (primeira) { corpo().innerHTML = note('Esta conta não tem permissão para ver a agenda das clínicas.', 'warn'); return false; }
    if (tab !== C.tab) return false;
    C.dados[tab] = null;
    pinta(note(esc(SO_PARA[tab] || 'Esta conta não tem permissão para ver esta parte.'), 'warn'));
    return false;
  }
  const d = ARRUMA[tab](raw);
  if (!d) {
    if (quieto && C.dados[tab]) return false;
    const html = `${note('O banco respondeu de um jeito que esta tela não entende. Tente de novo em instantes.', 'err')}
      <div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" data-ce-retry id="ceRetry">Tentar de novo</button></div>`;
    if (primeira) corpo().innerHTML = html; else pinta(html);
    return false;
  }
  C.dados[tab] = d;
  if (primeira) montar();
  if (tab === 'conflitos' && !C.todos) marcaConflitos(d.abertos);
  if (tab === 'clinicas') marcaConflitos(d.totais.open_conflicts);
  if (tab !== C.tab) return true;
  desenhar(foco);
  return true;
}

function semBanco() {
  C.vigia?.stop();
  C.vigia = null;
  if (corpo()) corpo().innerHTML = note(AVISO_SEM_BANCO, 'warn');
}

/* ======================= estrutura (abas) ======================= */
function montar() {
  corpo().innerHTML = `<p class="gs-ce-estado" id="ceEstado"></p>
    <div class="cl-tabs gs-ce-tabs" role="tablist" aria-label="Partes da agenda das clínicas">
      ${G.CE_TABS.map(([id, nome]) => `<button class="cl-tab" role="tab" type="button" id="ceTab-${id}" aria-controls="cePainel" aria-selected="${id === C.tab}" tabindex="${id === C.tab ? 0 : -1}" data-ce-tab="${id}">${esc(nome)}${id === 'conflitos' ? '<span class="n" id="ceConfN" hidden></span>' : ''}</button>`).join('')}
    </div>
    <div id="ceMsg" class="gs-ce-msg" aria-live="polite"></div>
    <div class="gs-ce-painel" role="tabpanel" id="cePainel" aria-labelledby="ceTab-${C.tab}" tabindex="0"></div>`;
  C.vigia = startCentralWatcher({
    rpc: (fn, args) => auth.rpc(fn, args), token: () => auth.token(),
    supabaseUrl: window.IMED_CONFIG?.supabaseUrl, chave: window.IMED_CONFIG?.supabaseKey,
    onChange: () => { if (!C.quadro && !C.ocupado && ['clinicas', 'conflitos'].includes(C.tab)) carregar(C.tab, { quieto: true }); },
    onState: (s) => { C.estado = s; mostraEstado(); },
    onInfo: (r) => marcaConflitos(G.num(r?.open_conflicts)),
  });
}
// O número de conflitos abertos no nome da aba (vem da versão da central, sem buscar a lista).
function marcaConflitos(n) {
  C.abertos = n;
  const el = $('#ceConfN');
  if (!el) return;
  const tem = G.isNum(n) && n > 0;
  const texto = tem ? `${G.fmtInt(n)}<span class="sr"> ${n === 1 ? 'aberto' : 'abertos'}</span>` : '';
  if (el.innerHTML !== texto) el.innerHTML = texto;
  if (el.hidden === tem) el.hidden = !tem;
}
function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
// "Atualizado às 12:00" é a hora do banco (a dos dados à vista). Sem a hora do banco, sem hora.
function mostraEstado() {
  const d = C.dados[C.tab];
  const partes = [];
  if (d?.gerado_em) partes.push(`Atualizado às ${G.fmtHora(d.gerado_em)}.`);
  if (C.estado?.offline) partes.push('Sem conexão agora: os números podem estar desatualizados.');
  else if (C.vigia?.active && ['clinicas', 'conflitos'].includes(C.tab)) partes.push('Esta parte confere sozinha, a cada 30 segundos, se algo mudou.');
  setText($('#ceEstado'), partes.join(' '));
}
function selecionar(tab, focar) {
  if (!G.CE_TABS.some(([id]) => id === tab)) return;
  C.tab = tab;
  C.quadro = null;
  falar('');
  for (const b of $$('[data-ce-tab]', corpo())) {
    const on = b.dataset.ceTab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focar) b.focus();
  }
  painel().setAttribute('aria-labelledby', `ceTab-${tab}`);
  // O que já veio aparece na hora; a busca nova chega em seguida (sem piscar).
  if (C.dados[tab]) { desenhar(); carregar(tab, { quieto: true }); } else carregar(tab);
}
// Aviso do resultado de uma ação (região lida pelo leitor de tela, fora do painel: sobrevive ao redesenho).
function falar(texto, tom = 'ok') { const el = $('#ceMsg'); if (el) el.innerHTML = texto ? `<p class="cl-note ${tom}">${esc(texto)}</p>` : ''; }
// O que a pessoa digitou e ainda não enviou (feriado novo, papel novo) volta para o formulário depois de um redesenho.
function guardaRascunhos() {
  if ($('#ceFerDia') && C.quadro?.tipo !== 'ferNovo') { const l = lerFer(); C.rascunhoFer = { day: l.dia, name: l.nome, source: l.fonte }; }
  if ($('#ceEqEmail')) C.rascunhoEq = lerEq();
}
const limpaCampos = (...ids) => { for (const id of ids) { const el = document.getElementById(id); if (el) el.value = ''; } };

// Troca o conteúdo do painel e devolve o foco do teclado para o mesmo controle (pelo id), se ele ainda existir.
// Se a pessoa foi para um controle fora do painel (uma aba, o menu) enquanto o banco respondia, o foco fica onde ela pôs:
// o "foco" pedido (por exemplo, o botão Atualizar) não a puxa de volta.
function pinta(html, foco = null) {
  const p = painel();
  if (!p) return;
  const ativo = document.activeElement;
  const fora = ativo && ativo !== document.body && ativo !== p && !p.contains(ativo);
  const id = fora ? null : foco || (ativo && p.contains(ativo) && ativo.id ? ativo.id : null);
  const digitado = ativo && p.contains(ativo) && 'selectionStart' in ativo ? [ativo.selectionStart, ativo.selectionEnd] : null;
  const estavaNoPainel = ativo === p || (ativo && p.contains(ativo));
  guardaRascunhos();
  p.innerHTML = html;
  const el = id ? document.getElementById(id) : null;
  if (el && p.contains(el)) {
    el.focus({ preventScroll: !foco });
    if (!foco && digitado && 'setSelectionRange' in el) { try { el.setSelectionRange(digitado[0], digitado[1]); } catch { /* campo sem seleção */ } }
  } else if (estavaNoPainel && document.activeElement !== p) p.focus({ preventScroll: true });
  mostraEstado();
}

/* ======================= peças ======================= */
const kpi = (x) => `<div class="gs-kpi${x.warn ? ' gs-warn' : ''}" data-kpi="${x.id}"><span class="gs-kpi-l">${x.warn ? icon('fa-triangle-exclamation') : ''}${esc(x.label)}</span><b class="gs-kpi-v">${esc(x.value)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</div>`;
const cel = (rotulo, html, cls = '') => `<td role="cell" data-label="${esc(rotulo)}"${cls ? ` class="${cls}"` : ''}><div>${html}</div></td>`;
// Tabela que vira cartões no celular (cada célula com o nome da coluna). head: [nome, é número?].
const tabela = (id, legenda, head, linhas) => `<div class="gs-tbwrap" tabindex="0" role="region" aria-label="Tabela: ${esc(legenda)}"><table class="gs-tb gs-ct" role="table" id="${id}"><caption class="sr">${esc(legenda)}</caption>
    <thead role="rowgroup"><tr role="row">${head.map(([h, n]) => `<th role="columnheader" scope="col"${n ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody role="rowgroup">${linhas.join('')}</tbody></table></div>`;
const selo = (texto, tom) => `<span class="bd${tom === 'ok' ? ' bd-ok' : tom === 'warn' ? ' bd-warn' : ''}">${esc(texto)}</span>`;
const atualizarBtn = (id) => `<button class="btn btn-ghost btn-sm" type="button" data-ce-refresh id="${id}">${icon('fa-rotate-right')} Atualizar</button>`;
const campo = (id, rotulo, controle, { dica = '', cheio = false } = {}) => `<div class="cl-field${cheio ? ' full' : ''}"><label class="cl-lbl" for="${id}">${rotulo}</label>${controle}${dica ? `<span class="cl-hint" id="${id}Hint">${dica}</span>` : ''}<span class="cl-err" id="${id}Err"></span></div>`;
const cortada = (total, vistas, oQue, resto = 'as mais novas. Use os filtros para ver as outras.') => (G.isNum(total) && total > vistas ? `<p class="cl-help gs-ce-corte">Aparecem ${esc(G.fmtInt(vistas))} de ${esc(G.fmtInt(total))} ${oQue}: ${resto}</p>` : '');
// Erros de um formulário: texto embaixo de cada campo, campo marcado e o foco no primeiro com erro.
function mostraErros(pares, errors) {
  let primeiro = null;
  for (const [k, id] of pares) {
    const el = document.getElementById(id);
    const er = document.getElementById(`${id}Err`);
    if (er) er.textContent = errors[k] || '';
    if (!el) continue;
    if (errors[k]) { el.setAttribute('aria-invalid', 'true'); primeiro ||= el; } else el.removeAttribute('aria-invalid');
  }
  primeiro?.focus();
  return !primeiro;
}

function desenhar(foco = null) {
  const d = C.dados[C.tab];
  if (!d) return;
  guardaRascunhos(); // antes de montar a tela nova (ela usa o rascunho)
  pinta({ clinicas: telaClinicas, conflitos: telaConflitos, auditoria: telaAuditoria, feriados: telaFeriados, parametros: telaParametros, equipe: telaEquipe }[C.tab](d), foco);
}

/* ---------- 1. clínicas ---------- */
function telaClinicas(d) {
  if (C.filtroClinicas === null) C.filtroClinicas = d.clinicas.some((c) => c.ativa) ? 'ativas' : 'todas';
  const f = C.filtroClinicas;
  const lista = G.filtraClinicas(d.clinicas, f);
  const hoje = G.todaySP();
  const av = G.avisoFeriadoNacional(d.feriados_ate, hoje);
  const linhas = lista.map((c) => {
    const ag = G.agendaClinica(c);
    const fu = G.fusoClinica(c);
    const fe = G.feriadosClinica(c, hoje);
    return `<tr role="row" data-clinica="${esc(c.id)}">
      <th role="rowheader" scope="row" data-label="Clínica"><div><b>${esc(c.nome)}</b><small>${esc([c.cidade, c.uf].filter(Boolean).join(' · '))}${c.demo ? ' · demonstração' : ''}${c.situacao && c.situacao !== 'published' ? ` · ${c.situacao === 'suspended' ? 'suspensa' : 'ainda não publicada'}` : ''}</small></div></th>
      ${cel('Modalidade', `<span title="${esc(G.modoAjuda(c.modo))}">${esc(G.modoTexto(c.modo))}</span>`)}
      ${cel('Agenda', `${selo(ag.texto, ag.tom)}${ag.sub ? `<small>${esc(ag.sub)}</small>` : ''}`)}
      ${cel('Fuso', `${esc(fu.nome)}<small>${fu.tom === 'warn' ? selo(fu.texto, 'warn') : esc(fu.texto)}</small>`)}
      ${cel('Feriados conferidos', fe.tom === 'warn' ? selo(fe.texto, 'warn') : esc(fe.texto))}
      ${cel('Conflitos abertos', G.isNum(c.conflitos) && c.conflitos > 0 ? `<b class="gs-ce-alerta">${icon('fa-triangle-exclamation')} ${esc(G.fmtInt(c.conflitos))}</b>` : esc(G.fmtInt(c.conflitos)), 'n')}
      ${cel('Por vir', esc(G.fmtInt(c.por_vir)), 'n')}
      ${cel('Última atividade', c.atividade ? `${esc(G.fmtDateTime(c.atividade))}<small>versão ${esc(G.fmtInt(c.versao))} · equipe de ${esc(G.fmtInt(c.equipe))}</small>` : `<span class="gs-ce-vazio">Nenhuma ainda</span><small>equipe de ${esc(G.fmtInt(c.equipe))}</small>`)}
    </tr>`;
  });
  return `<div class="gs-kpis" id="ceKpis">${G.centralKpis(d).map(kpi).join('')}</div>
    <p class="cl-note ${av.tom} gs-ce-nota" id="ceFeriadoAviso">${esc(av.texto)}</p>
    <div class="cl-filter gs-ce-bar">
      <label class="cl-lbl" for="ceClinFiltro" style="margin:0">Mostrar</label>
      <select id="ceClinFiltro">${G.CE_FILTRO_CLINICAS.map(([v, n]) => `<option value="${v}"${v === f ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      ${atualizarBtn('ceClinAtualizar')}
    </div>
    <p class="cl-help" id="ceClinConta">${esc(G.plural(lista.length, 'clínica', 'clínicas'))}${f === 'todas' ? '' : ` (${esc(G.labelOf(G.CE_FILTRO_CLINICAS, f).toLowerCase())})`}.${d.cortada ? ` <b>Atenção:</b> a lista traz só as ${esc(G.fmtInt(G.CE_LIMITE_CLINICAS))} primeiras.` : ''} “Por vir” conta os agendamentos da agenda do IMED de agora em diante; “versão” sobe a cada mudança na agenda da clínica.</p>
    ${lista.length ? tabela('ceClinTb', 'Agenda de cada clínica', [['Clínica'], ['Modalidade'], ['Agenda'], ['Fuso'], ['Feriados conferidos'], ['Conflitos abertos', 1], ['Por vir', 1], ['Última atividade']], linhas)
    : `<p class="gs-empty" id="ceClinVazia">${f === 'ativas' ? 'Nenhuma clínica ativou a agenda no IMED ainda.' : f === 'conflitos' ? 'Nenhuma clínica com conflito aberto.' : 'Ainda não há clínicas cadastradas.'}</p>`}`;
}

/* ---------- 2. conflitos ---------- */
function telaConflitos(d) {
  const agora = Date.now();
  const linhas = d.linhas.map((k) => `<tr role="row" data-conflito="${esc(k.id)}">
      <th role="rowheader" scope="row" data-label="Clínica"><div><b>${esc(k.clinica || G.DASH)}</b></div></th>
      ${cel('O que houve', esc(G.conflitoTexto(k.tipo)))}
      ${cel('Horário do agendamento', k.horario ? esc(k.horario) : '<span class="gs-ce-vazio">Sem horário</span>')}
      ${cel('Aberto em', k.criado_em ? `${esc(G.fmtDateTime(k.criado_em))}${k.aberto ? `<small>${esc(G.sinceText(k.criado_em, agora))}</small>` : ''}` : G.DASH)}
      ${cel('Situação', `<span class="rq-st ${k.aberto ? 'st-pending' : 'st-completed'}">${esc(G.CE_CONFLITO_STATUS[k.situacao] || k.situacao)}</span>${k.resolvido_em ? `<small>${esc(G.fmtDateTime(k.resolvido_em))}${k.resolucao ? ` · ${esc(k.resolucao)}` : ''}</small>` : ''}`)}
    </tr>`);
  const op = (v, n) => `<label><input type="radio" name="ceConf" id="ceConf-${v}" value="${v}"${(v === 'todos') === C.todos ? ' checked' : ''}><span>${n}</span></label>`;
  return `<p class="cl-help">Um conflito aparece quando um agendamento deixa de caber na agenda (a clínica bloqueou o horário, mudou a configuração ou um feriado foi lançado). Para resolver, abra a clínica na <a href="painel.html">Área da clínica</a>, aba Agenda, em “Precisa de atenção”: lá dá para remarcar ou cancelar falando com o paciente.</p>
    <div class="gs-ce-bar">
      <fieldset class="gs-period"><legend>Mostrar</legend><div class="gs-seg">${op('abertos', 'Abertos')}${op('todos', 'Todos dos últimos 90 dias')}</div></fieldset>
      ${atualizarBtn('ceConfAtualizar')}
    </div>
    <p class="cl-help" id="ceConfConta">${C.todos ? `${esc(G.plural(d.total ?? d.linhas.length, 'conflito', 'conflitos'))} nos últimos 90 dias, ${esc(G.fmtInt(d.abertos))} em aberto.` : `${esc(G.plural(d.abertos ?? d.linhas.length, 'conflito aberto', 'conflitos abertos'))}, os mais antigos primeiro.`}</p>
    ${cortada(C.todos ? d.total : d.abertos, d.linhas.length, 'conflitos', 'os outros aparecem quando estes forem resolvidos.')}
    ${d.linhas.length ? tabela('ceConfTb', C.todos ? 'Conflitos dos últimos 90 dias' : 'Conflitos abertos', [['Clínica'], ['O que houve'], ['Horário do agendamento'], ['Aberto em'], ['Situação']], linhas)
    : `<p class="gs-empty" id="ceConfVazia">${C.todos ? 'Nenhum conflito nos últimos 90 dias.' : 'Nenhum conflito aberto agora.'}</p>`}`;
}

/* ---------- 3. auditoria ---------- */
function telaAuditoria(d) {
  const a = C.aud;
  const clinicas = C.dados.clinicas?.clinicas || [];
  const t = d.totais;
  const quem = (x) => `${esc(x.quem)}${x.conta ? `<small>conta <code>${esc(x.conta)}</code></small>` : ''}`;
  const mud = d.mudancas.map((m) => `<tr role="row">
      ${cel('Quando', esc(G.fmtDateTime(m.em)))}
      ${cel('Clínica', m.clinica ? esc(m.clinica) : '<span class="gs-ce-vazio">Todas (IMED)</span>')}
      ${cel('Quem', quem(m))}
      ${cel('O que fez', `${esc(m.acao)}<small>${esc(m.objeto)}</small>`)}
      ${cel('Por onde', `${esc(m.origem)}${m.motivo ? `<small>${esc(m.motivo)}</small>` : ''}`)}
    </tr>`);
  const lei = d.leituras.map((l) => `<tr role="row">
      ${cel('Dia', esc(G.fullDay(l.dia)))}
      ${cel('Clínica', esc(l.clinica || G.DASH))}
      ${cel('Quem', quem(l))}
      ${cel('O que abriu', `${esc(l.tela)}${l.motivo ? `<small>Motivo: ${esc(l.motivo)}</small>` : ''}`)}
      ${cel('Leituras', esc(G.fmtInt(l.leituras)), 'n')}
      ${cel('Agendamentos diferentes', l.agendamentos ? esc(G.fmtInt(l.agendamentos)) : G.DASH, 'n')}
    </tr>`);
  return `<p class="cl-help">Quem mudou o quê na agenda e quantas vezes dado de paciente foi aberto. Quem agiu aparece pelo papel e por um código curto da conta (o mesmo código aparece na aba “Equipe do IMED”); nunca aparece qual paciente nem qual agendamento.</p>
    <form id="ceAudForm" class="gs-ce-form" novalidate aria-label="Filtros da auditoria">
      <div class="cl-grid gs-ce-grid4">
        ${campo('ceAudDias', 'Período', `<select id="ceAudDias">${G.CE_DIAS.map(([v, n]) => `<option value="${v}"${v === a.dias ? ' selected' : ''}>Últimos ${esc(n)}</option>`).join('')}</select>`)}
        ${campo('ceAudClinica', 'Clínica', `<select id="ceAudClinica"><option value="">Todas</option>${clinicas.map((c) => `<option value="${esc(c.id)}"${c.id === a.clinica ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>`)}
        ${campo('ceAudObjeto', 'Em quê <small>(só as mudanças)</small>', `<select id="ceAudObjeto"><option value="">Tudo</option>${[...new Set([...d.objetos, a.objeto].filter(Boolean))].map((o) => `<option value="${esc(o)}"${o === a.objeto ? ' selected' : ''}>${esc(G.objetoTexto(o))}</option>`).join('')}</select>`)}
        ${campo('ceAudConta', 'Conta <small>(opcional)</small>', `<input id="ceAudConta" type="text" maxlength="12" autocomplete="off" spellcheck="false" value="${esc(a.conta)}" aria-describedby="ceAudContaHint ceAudContaErr">`, { dica: 'O código de 8 caracteres da coluna “Quem”.' })}
      </div>
      <div class="cl-actions"><button class="btn btn-primary btn-sm" type="submit" id="ceAudAplicar">Aplicar filtros</button></div>
    </form>
    <div class="gs-kpis" id="ceAudKpis">
      ${kpi({ id: 'ce-mudancas', label: 'Mudanças', value: G.fmtInt(t.changes), sub: `desde ${G.fullDay(d.de)}` })}
      ${kpi({ id: 'ce-leituras', label: 'Leituras de dado de paciente', value: G.fmtInt(t.reads), sub: 'grade, busca, detalhe e listas' })}
      ${kpi({ id: 'ce-leitores', label: 'Contas que leram', value: G.fmtInt(t.readers), sub: 'pessoas diferentes' })}
      ${kpi({ id: 'ce-imed', label: 'Leituras pela equipe do IMED', value: G.fmtInt(t.imed_reads), sub: 'sempre com o motivo registrado' })}
    </div>
    <h3 id="ceMudT">Quem mexeu em quê</h3>
    ${cortada(t.changes, d.mudancas.length, 'mudanças')}
    ${mud.length ? tabela('ceMudTb', 'Mudanças na agenda', [['Quando'], ['Clínica'], ['Quem'], ['O que fez'], ['Por onde']], mud) : '<p class="gs-empty" id="ceMudVazia">Nenhuma mudança neste período com estes filtros.</p>'}
    <h3 id="ceLeiT">Leituras de dado de paciente <span class="gs-h3s">somadas por dia, clínica e conta</span></h3>
    ${lei.length ? tabela('ceLeiTb', 'Leituras de dado de paciente, somadas', [['Dia'], ['Clínica'], ['Quem'], ['O que abriu'], ['Leituras', 1], ['Agendamentos diferentes', 1]], lei) : '<p class="gs-empty" id="ceLeiVazia">Nenhuma leitura neste período com estes filtros.</p>'}`;
}

/* ---------- 4. feriados ---------- */
function telaFeriados(d) {
  const av = G.avisoFeriadoNacional(d.nacional_ate, d.hoje);
  const q = C.quadro;
  const linhas = d.nacionais.map((h) => {
    const id = esc(h.id);
    const acao = !d.pode_editar ? '' : q?.tipo === 'ferDel' && q.id === h.id
      ? `<div class="gs-pay" id="ceFerDelBox"><p id="ceFerDelTxt">Retirar “${esc(h.nome)}” de ${esc(G.fullDay(h.dia))}? As clínicas voltam a poder abrir nesse dia, e os agendamentos desse dia que o feriado mandou para “Para remarcar” e voltam a caber na agenda saem de lá sozinhos. Se for o único feriado nacional do último ano lançado, o prazo em que as clínicas oferecem horário recua.</p>
          <div class="cl-row"><button class="btn btn-danger btn-sm" type="button" id="ceFerDelOk" data-ce-fer-del-ok="${id}" aria-describedby="ceFerDelTxt">Confirmar: retirar</button><button class="btn btn-ghost btn-sm" type="button" data-ce-back="ceFerDel-${id}">Voltar</button></div>
          <div class="gs-acterr" id="ceQuadroErr"></div></div>`
      : `<div class="gs-acts"><button class="btn btn-ghost btn-sm" type="button" id="ceFerDel-${id}" data-ce-fer-del="${id}">${icon('fa-trash-can')} Retirar<span class="sr">: ${esc(h.nome)}, ${esc(G.fullDay(h.dia))}</span></button></div>`;
    return `<tr role="row" data-feriado="${id}"${h.dia < d.hoje ? ' class="gs-ce-passado"' : ''}>
      ${cel('Dia', `<b>${esc(G.fullDay(h.dia))}</b><small>${esc(G.diaLongo(h.dia).split(',')[0])}${h.dia < d.hoje ? ' · já passou' : ''}</small>`)}
      ${cel('Feriado', esc(h.nome))}
      ${cel('Fonte', esc(h.fonte))}
      ${d.pode_editar ? cel('Ações', acao) : ''}
    </tr>`;
  });
  const previa = q?.tipo === 'ferNovo' ? `<div class="gs-pay gs-ce-previa" id="ceFerPrevia">
      <p id="ceFerPreviaTxt"><b>Confira antes de lançar.</b> ${esc(q.previa.texto)} O feriado vale para todas as clínicas na hora.</p>
      <div class="cl-row"><button class="btn btn-coral btn-sm" type="button" id="ceFerOk" data-ce-fer-ok aria-describedby="ceFerPreviaTxt">Confirmar: lançar feriado</button><button class="btn btn-ghost btn-sm" type="button" data-ce-back="ceFerLancar">Voltar</button></div>
      <div class="gs-acterr" id="ceQuadroErr"></div></div>` : '';
  const v = q?.tipo === 'ferNovo' ? q.payload : C.rascunhoFer || { day: '', name: '', source: '' };
  const travado = q?.tipo === 'ferNovo' ? ' readonly' : '';
  return `<p class="cl-note ${av.tom} gs-ce-nota" id="ceFerAviso">${esc(av.texto)}</p>
    <p class="cl-help">O IMED só oferece horário até o fim do ano do último feriado nacional lançado. Lance aqui os feriados nacionais de cada ano, sempre com a lei, o decreto ou a portaria que os criou. Os feriados estaduais e municipais são conferidos por cada clínica, na configuração da agenda dela.${d.outros ? ` Há também ${esc(G.plural(d.outros, 'feriado estadual ou municipal lançado', 'feriados estaduais ou municipais lançados'))}.` : ''}</p>
    <div class="gs-cobh"><h3 id="ceFerListaT">Feriados nacionais lançados</h3>${atualizarBtn('ceFerAtualizar')}</div>
    ${linhas.length ? tabela('ceFerTb', 'Feriados nacionais lançados', [['Dia'], ['Feriado'], ['Fonte'], ...(d.pode_editar ? [['Ações']] : [])], linhas) : '<p class="gs-empty" id="ceFerVazia">Nenhum feriado nacional lançado.</p>'}
    ${d.pode_editar ? `<form id="ceFerForm" class="gs-new" novalidate aria-labelledby="ceFerNovoT">
      <h3 id="ceFerNovoT">Lançar feriado nacional</h3>
      <div class="cl-grid">
        ${campo('ceFerDia', 'Dia', `<input id="ceFerDia" type="date" min="${d.hoje}" max="${G.feriadoMax(d.hoje)}" value="${esc(v.day)}" aria-required="true" aria-describedby="ceFerDiaErr"${travado}>`)}
        ${campo('ceFerNome', 'Nome do feriado', `<input id="ceFerNome" type="text" maxlength="120" autocomplete="off" value="${esc(v.name)}" aria-required="true" aria-describedby="ceFerNomeErr"${travado}>`)}
        ${campo('ceFerFonte', 'Fonte oficial', `<input id="ceFerFonte" type="text" maxlength="300" autocomplete="off" value="${esc(v.source)}" aria-required="true" aria-describedby="ceFerFonteHint ceFerFonteErr"${travado}>`, { dica: 'A lei, o decreto ou a portaria que criou o feriado, com número e ano.', cheio: true })}
      </div>
      ${previa || `<div class="cl-actions"><button class="btn btn-coral" type="submit" id="ceFerLancar">Conferir e lançar</button></div>`}
      <div id="ceFerErr"></div>
    </form>` : note('Lançar e retirar feriados é para o administrador e para quem tem o papel de operação.', 'info')}`;
}

/* ---------- 5. parâmetros ---------- */
function telaParametros(d) {
  const itens = d.lista.map((p, i) => {
    const id = `cePar${i}`;
    const estado = p.gravado === null ? `Valor em vigor: <b>${esc(G.fmtInt(p.em_vigor))}</b> (o padrão).` : `Valor em vigor: <b>${esc(G.fmtInt(p.em_vigor))}</b>${p.mudado_em ? `, gravado em ${esc(G.fmtDateTime(p.mudado_em))}` : ''}. O padrão é ${esc(G.fmtInt(p.padrao))}.`;
    return `<form class="gs-fig gs-ce-par" data-ce-par="${esc(p.chave)}" novalidate aria-labelledby="${id}T">
        <h3 id="${id}T" class="gs-fig-h">${esc(p.nome)}</h3>
        ${p.ajuda ? `<p class="cl-help">${esc(p.ajuda)}</p>` : ''}
        <p class="gs-ce-vigor" id="${id}Vigor">${estado}</p>
        ${d.pode_editar ? `<div class="gs-ce-linha">
          <div class="cl-field"><label class="cl-lbl" for="${id}">Novo valor</label><input id="${id}" type="number" inputmode="numeric" min="${p.min ?? ''}" max="${p.max ?? ''}" step="1" value="${p.em_vigor ?? ''}" aria-describedby="${id}Hint ${id}Err"><span class="cl-hint" id="${id}Hint">De ${esc(G.fmtInt(p.min))} a ${esc(G.fmtInt(p.max))}.</span><span class="cl-err" id="${id}Err"></span></div>
          <button class="btn btn-primary btn-sm" type="submit" id="${id}Gravar">Gravar</button>
          ${p.gravado !== null ? `<button class="btn btn-ghost btn-sm" type="button" id="${id}Padrao" data-ce-par-padrao="${esc(p.chave)}">Voltar ao padrão (${esc(G.fmtInt(p.padrao))})</button>` : ''}
        </div>` : ''}
      </form>`;
  });
  return `<p class="cl-help">Valores que valem para todas as clínicas. Só aparecem aqui os parâmetros que o sistema realmente usa hoje. ${d.pode_editar ? 'Mudar vale na hora e fica na auditoria.' : 'Só o administrador do IMED muda estes valores.'}</p>
    ${itens.length ? `<div class="gs-stack">${itens.join('')}</div>` : '<p class="gs-empty">Nenhum parâmetro global em uso.</p>'}`;
}

/* ---------- 6. equipe do IMED ---------- */
function telaEquipe(d) {
  const q = C.quadro;
  const ordem = G.IMED_PAPEIS.map(([k]) => k);
  const papeis = [...d.papeis].sort((a, b) => ordem.indexOf(a.papel) - ordem.indexOf(b.papel));
  const linhas = d.pessoas.map((s) => {
    const chave = `${s.user_id}|${s.papel}`;
    const idBtn = `ceEqDel-${esc(s.conta)}-${esc(s.papel)}`;
    const acao = !s.ativo ? '' : q?.tipo === 'eqDel' && q.chave === chave
      ? `<div class="gs-pay" id="ceEqDelBox"><p id="ceEqDelTxt">Tirar o papel “${esc(G.papelImed(s.papel))}” de ${esc(s.email)}? A pessoa perde essas permissões na hora. O registro fica guardado na auditoria.</p>
          <div class="cl-row"><button class="btn btn-danger btn-sm" type="button" id="ceEqDelOk" data-ce-eq-del-ok="${esc(chave)}" aria-describedby="ceEqDelTxt">Confirmar: tirar papel</button><button class="btn btn-ghost btn-sm" type="button" data-ce-back="${idBtn}">Voltar</button></div>
          <div class="gs-acterr" id="ceQuadroErr"></div></div>`
      : `<div class="gs-acts"><button class="btn btn-ghost btn-sm" type="button" id="${idBtn}" data-ce-eq-del="${esc(chave)}">${icon('fa-user-xmark')} Tirar papel<span class="sr">: ${esc(G.papelImed(s.papel))}, ${esc(s.email)}</span></button></div>`;
    return `<tr role="row"${s.ativo ? '' : ' class="gs-ce-passado"'}>
      <th role="rowheader" scope="row" data-label="Pessoa"><div><b class="gs-ce-email">${esc(s.email || G.DASH)}</b><small>conta <code>${esc(s.conta)}</code></small></div></th>
      ${cel('Papel', esc(G.papelImed(s.papel)))}
      ${cel('Desde', esc(G.fmtDateTime(s.desde)))}
      ${cel('Situação', s.ativo ? selo('Ativo', 'ok') : `${selo('Retirado', '')}${s.retirado_em ? `<small>em ${esc(G.fmtDateTime(s.retirado_em))}</small>` : ''}`)}
      ${cel('Ações', acao || '<span class="gs-ce-vazio">—</span>')}
    </tr>`;
  });
  const r = C.rascunhoEq || { email: '', papel: '' };
  return `<p class="cl-help">O administrador do IMED tem todas as permissões e não precisa de papel. Aqui você dá a outras pessoas da equipe só o que cada uma precisa. A pessoa precisa já ter uma conta no site, com o e-mail confirmado.</p>
    <p class="cl-note warn gs-ce-nota" id="ceEqAviso">Por enquanto este painel e a visão “equipe do IMED” da Área da clínica só abrem para o administrador. O papel dado aqui já fica gravado e vale nas funções do banco; as telas serão abertas para a equipe numa próxima etapa.</p>
    <h3 id="ceEqPapeisT">O que cada papel pode</h3>
    <dl class="gs-ce-papeis">${papeis.map((p) => `<div><dt>${esc(G.papelImed(p.papel))}</dt><dd>${esc(G.IMED_PAPEIS.find(([k]) => k === p.papel)?.[2] || '')}<small>No banco: ${esc(p.pode.join('; '))}.</small></dd></div>`).join('')}</dl>
    <div class="gs-cobh"><h3 id="ceEqListaT">Pessoas com papel</h3>${atualizarBtn('ceEqAtualizar')}</div>
    ${linhas.length ? tabela('ceEqTb', 'Pessoas da equipe do IMED com papel', [['Pessoa'], ['Papel'], ['Desde'], ['Situação'], ['Ações']], linhas) : '<p class="gs-empty" id="ceEqVazia">Ninguém além do administrador tem papel na equipe ainda.</p>'}
    <form id="ceEqForm" class="gs-new" novalidate aria-labelledby="ceEqNovoT">
      <h3 id="ceEqNovoT">Dar um papel</h3>
      <div class="cl-grid">
        ${campo('ceEqEmail', 'E-mail da conta da pessoa', `<input id="ceEqEmail" type="email" maxlength="254" autocomplete="off" spellcheck="false" value="${esc(r.email)}" aria-required="true" aria-describedby="ceEqEmailErr">`)}
        ${campo('ceEqPapel', 'Papel', `<select id="ceEqPapel" aria-required="true" aria-describedby="ceEqPapelErr"><option value="">Escolha</option>${G.IMED_PAPEIS.map(([k, n]) => `<option value="${k}"${k === r.papel ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`)}
      </div>
      <div class="cl-actions"><button class="btn btn-coral" type="submit" id="ceEqDar">${icon('fa-user-plus')} Dar papel</button></div>
      <div id="ceEqErr"></div>
    </form>`;
}

/* ======================= ações ======================= */
// Uma chamada que grava: trava os botões, trata entrada vencida, conta sem permissão e banco sem a função. Devolve a
// resposta do banco (com "status") ou null quando já tratou o erro. errBox: onde o erro aparece.
// falha: o texto quando a chamada não chega ao banco (a prévia do feriado só confere: "conferir", não "gravar").
// O foco volta ao botão que estava com ele (desligado durante a chamada), se ele ainda estiver na tela.
async function gravar(fn, args, errBox, { falha = 'Não foi possível gravar agora. Tente de novo em instantes.' } = {}) {
  if (C.ocupado) return null;
  const gen = C.gen;
  C.ocupado = true;
  const comFoco = document.activeElement;
  const botoes = $$('button', painel()).filter((b) => !b.disabled);
  botoes.forEach((b) => { b.disabled = true; });
  const erro = (texto) => { const el = typeof errBox === 'string' ? document.getElementById(errBox) : errBox; if (el) el.innerHTML = note(esc(texto), 'err'); };
  try {
    const r = await auth.rpc(fn, args);
    if (gen !== C.gen) return null;
    if (r?.status === 'ok') return r;
    erro(G.centralStatus(r?.status));
    return null;
  } catch (err) {
    if (gen !== C.gen) return null;
    if (C.hooks.lost?.()) return null;
    if (proibido(err)) { C.hooks.forbidden?.(); return null; }
    erro(noFn(err) ? AVISO_SEM_BANCO : friendlyError(err, falha));
    return null;
  } finally {
    C.ocupado = false;
    botoes.forEach((b) => { if (b.isConnected) b.disabled = false; });
    if (comFoco?.isConnected && comFoco !== document.body && document.activeElement === document.body) comFoco.focus();
  }
}
// As clínicas (conflitos, feriado nacional até quando) ficam velhas depois de mexer em feriado: busca de novo em silêncio.
function clinicasVelhas() {
  auth.rpc('agenda_central_overview').then((raw) => { const d = G.normalizeCentral(raw); if (d && C.on) { C.dados.clinicas = d; marcaConflitos(d.totais.open_conflicts); } }).catch(() => {});
}
const lerFer = () => ({ dia: $('#ceFerDia')?.value || '', nome: $('#ceFerNome')?.value || '', fonte: $('#ceFerFonte')?.value || '' });
const lerEq = () => ({ email: $('#ceEqEmail')?.value || '', papel: $('#ceEqPapel')?.value || '' });

async function aoEnviar(e) {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  e.preventDefault();
  if (C.ocupado) return;
  if (form.id === 'ceAudForm') {
    const lido = { dias: Number($('#ceAudDias').value), clinica: $('#ceAudClinica').value, objeto: $('#ceAudObjeto').value, conta: $('#ceAudConta').value };
    const v = G.filtrosAuditoria(lido);
    if (!mostraErros([['conta', 'ceAudConta']], v.errors)) return;
    const antes = C.aud;
    C.aud = { ...lido, conta: v.filters.actor || '' };
    const ok = await carregar('auditoria', { quieto: true, foco: 'ceAudAplicar' });
    if (ok === null) return;
    if (ok) { falar('Filtros aplicados.'); return; }
    // não chegou: a tabela é a de antes, então os filtros da tela voltam a ser os dela
    C.aud = antes;
    if (C.dados.auditoria && C.tab === 'auditoria') desenhar('ceAudAplicar');
    falar('Não foi possível aplicar os filtros agora; a tabela abaixo ainda é a de antes.', 'err');
    return;
  }
  if (form.id === 'ceFerForm') {
    if (C.quadro) return;
    const v = G.validarFeriado(lerFer(), C.dados.feriados?.hoje);
    $('#ceFerErr').innerHTML = '';
    if (!mostraErros([['dia', 'ceFerDia'], ['nome', 'ceFerNome'], ['fonte', 'ceFerFonte']], v.errors)) return;
    const r = await gravar('agenda_central_holiday_preview', { p_day: v.payload.day }, 'ceFerErr', { falha: 'Não foi possível conferir agora. Tente de novo em instantes.' });
    if (!r) return;
    const previa = G.previaFeriado(r, v.payload);
    if (!previa || previa.ja_existe) { $('#ceFerErr').innerHTML = note(esc(previa ? G.centralStatus('holiday_exists') : G.centralStatus('')), 'err'); $('#ceFerDia')?.focus(); return; }
    C.quadro = { tipo: 'ferNovo', payload: v.payload, previa };
    desenhar('ceFerOk');
    return;
  }
  if (form.id === 'ceEqForm') {
    const lido = lerEq();
    const v = G.validarPapel(lido);
    $('#ceEqErr').innerHTML = '';
    if (!mostraErros([['email', 'ceEqEmail'], ['papel', 'ceEqPapel']], v.errors)) return;
    const r = await gravar('agenda_central_staff_grant', v.payload, 'ceEqErr');
    if (!r) return;
    limpaCampos('ceEqEmail', 'ceEqPapel');
    await carregar('equipe', { quieto: true, foco: 'ceEqEmail' });
    falar(r.unchanged ? `${v.payload.p_email} já tinha o papel “${G.papelImed(v.payload.p_role)}”: nada mudou.` : `Papel “${G.papelImed(v.payload.p_role)}” dado a ${v.payload.p_email}.`);
    return;
  }
  if (form.dataset.cePar) {
    const p = C.dados.parametros?.lista.find((x) => x.chave === form.dataset.cePar);
    const campoEl = $('input[type="number"]', form);
    if (!p || !campoEl) return;
    const v = G.validarParametro(p, campoEl.value);
    if (!mostraErros([['valor', campoEl.id]], v.ok ? {} : { valor: v.error })) return;
    const r = await gravar('agenda_central_setting_set', { p_key: p.chave, p_value: v.value }, `${campoEl.id}Err`);
    if (!r) return;
    await carregar('parametros', { quieto: true, foco: `${campoEl.id}Gravar` });
    falar(r.unchanged ? `O valor já era ${G.fmtInt(v.value)}: nada mudou.` : `Gravado: ${p.nome} = ${G.fmtInt(v.value)}.`);
  }
}

async function aoClicar(e) {
  const t = e.target.closest('button, a');
  if (!t || !corpo().contains(t)) return;
  if (t.dataset.ceTab) { selecionar(t.dataset.ceTab, false); return; }
  if (t.hasAttribute('data-ce-retry')) { if (painel()) carregar(C.tab); else { corpo().innerHTML = loading('Carregando a agenda das clínicas…'); carregar('clinicas'); } return; }
  if (C.ocupado) return;
  if (t.hasAttribute('data-ce-refresh')) {
    falar('');
    const ok = await carregar(C.tab, { quieto: true, foco: t.id });
    if (ok === false) falar('Não foi possível atualizar agora. Os dados abaixo ainda são os de antes.', 'err');
    return;
  }
  if (t.dataset.ceBack !== undefined) { C.quadro = null; desenhar(t.dataset.ceBack); return; }
  if (t.dataset.ceFerDel) { guardaRascunhos(); C.quadro = { tipo: 'ferDel', id: t.dataset.ceFerDel }; falar(''); desenhar('ceFerDelOk'); return; }
  if (t.dataset.ceFerDelOk) {
    const h = C.dados.feriados?.nacionais.find((x) => x.id === t.dataset.ceFerDelOk);
    const r = await gravar('agenda_holiday_remove', { p_id: t.dataset.ceFerDelOk }, 'ceQuadroErr');
    if (!r) return;
    C.quadro = null;
    const fechados = G.num(r.conflicts_closed);
    await carregar('feriados', { quieto: true, foco: 'ceFerAtualizar' });
    falar(`Feriado retirado${h ? `: ${h.nome}, ${G.fullDay(h.dia)}` : ''}.${fechados ? ` ${G.plural(fechados, 'agendamento voltou a valer e saiu', 'agendamentos voltaram a valer e saíram')} de “Para remarcar” da clínica.` : ''}`);
    clinicasVelhas();
    return;
  }
  if (t.hasAttribute('data-ce-fer-ok')) {
    const q = C.quadro;
    if (q?.tipo !== 'ferNovo') return;
    const r = await gravar('agenda_holiday_save', { p_holiday: q.payload }, 'ceQuadroErr');
    if (!r) return;
    C.quadro = null;
    limpaCampos('ceFerDia', 'ceFerNome', 'ceFerFonte');
    const n = G.num(r.conflicts);
    await carregar('feriados', { quieto: true, foco: 'ceFerDia' });
    falar(`Feriado lançado: ${q.payload.name}, ${G.fullDay(q.payload.day)}.${n ? ` ${G.plural(n, 'agendamento foi', 'agendamentos foram')} para “Precisa de atenção” da clínica, para remarcar.` : ''}`);
    clinicasVelhas();
    return;
  }
  if (t.dataset.ceParPadrao) {
    const p = C.dados.parametros?.lista.find((x) => x.chave === t.dataset.ceParPadrao);
    const campoId = t.id.replace(/Padrao$/, '');
    const r = await gravar('agenda_central_setting_set', { p_key: t.dataset.ceParPadrao, p_value: null }, `${campoId}Err`);
    if (!r) return;
    await carregar('parametros', { quieto: true, foco: `${campoId}Gravar` });
    falar(`${p?.nome || 'Parâmetro'}: voltou ao padrão (${G.fmtInt(p?.padrao)}).`);
    return;
  }
  if (t.dataset.ceEqDel) { C.quadro = { tipo: 'eqDel', chave: t.dataset.ceEqDel }; falar(''); desenhar('ceEqDelOk'); return; }
  if (t.dataset.ceEqDelOk) {
    const [user, papel] = t.dataset.ceEqDelOk.split('|');
    const s = C.dados.equipe?.pessoas.find((x) => x.user_id === user && x.papel === papel);
    const r = await gravar('agenda_central_staff_revoke', { p_user: user, p_role: papel }, 'ceQuadroErr');
    if (!r) return;
    C.quadro = null;
    await carregar('equipe', { quieto: true, foco: 'ceEqAtualizar' });
    falar(`Papel “${G.papelImed(papel)}” retirado${s?.email ? ` de ${s.email}` : ''}.`);
  }
}

function aoMudar(e) {
  const t = e.target;
  if (t.id === 'ceClinFiltro') { C.filtroClinicas = t.value; desenhar('ceClinFiltro'); return; }
  if (t.name === 'ceConf') { C.todos = t.value === 'todos'; carregar('conflitos', { quieto: true }); }
}

// Abas: setas, Home e End (como no painel da clínica).
function aoTeclar(e) {
  const b = e.target.closest?.('[data-ce-tab]');
  if (!b) return;
  const todas = $$('[data-ce-tab]', corpo());
  const i = todas.indexOf(b);
  const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: todas.length - 1 }[e.key];
  if (j === undefined) return;
  e.preventDefault();
  selecionar(todas[(j + todas.length) % todas.length].dataset.ceTab, true);
}
