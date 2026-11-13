// "Pagamentos on-line": o que foi pago pelo site, dentro do painel de gestão (iMed Pagamentos, fase P2b; arquitetura
// do pagamento §7.3). Só para a equipe do IMED: o painel só chega aqui depois de o banco confirmar a conta
// (is_imed_admin) e cada função admin_pag_* confere de novo a permissão no servidor (imed.financeiro.ver para ler,
// imed.financeiro.operar para a chave geral). Três coisas:
//   Resumo       a chave geral (ligada ou desligada), os números do período da página e o que precisa de atenção;
//   Cobranças    a lista das cobranças do período (situação, valores, clínica), com filtro por situação;
//   Conciliação  a última conferência com o meio de pagamento e as diferenças (só leitura: fechar uma diferença ainda
//                é pelo banco).
// NENHUM dado de paciente nem de quem pagou passa por aqui: só valores, situações, datas e nomes de clínica. Nenhum
// número nasce aqui (regras em gestao-pag-core.js). Banco ainda sem as funções (migrações do pagamento não aplicadas, a
// produção de hoje): um aviso, e nada quebra. Nada vai para o aparelho.
// A única ação: ligar ou desligar a chave geral (admin_pag_chave_geral), sempre com confirmação e motivo em código.
import { auth, $, $$, esc, note, loading, friendlyError } from './clinica.js';
import * as G from './gestao-core.js';
import * as P from './gestao-pag-core.js';

const novo = () => ({ on: false, gen: 0, hooks: {}, dias: 30, tab: 'cobrancas', seqR: 0, seqT: 0, resumo: null, dados: {}, filtro: '', soAbertas: true, quadro: null, ocupado: false });
let C = novo();
let GEN = 0;

const corpo = () => $('#pgCorpo');
const painel = () => $('#pgPainel');
const noFn = (err) => err?.status === 404 || err?.data?.code === 'PGRST202' || err?.data?.code === '42883';
const proibido = (err) => err?.data?.code === '42501' || err?.status === 403;
const icon = (n) => `<i class="fa-solid ${n}" aria-hidden="true"></i>`;
const selo = (texto, tom) => `<span class="bd${tom ? ` bd-${tom}` : ''}">${esc(texto)}</span>`;
const cel = (rotulo, html, cls = '') => `<td role="cell" data-label="${esc(rotulo)}"${cls ? ` class="${cls}"` : ''}><div>${html}</div></td>`;
const tabela = (id, legenda, head, linhas) => `<div class="gs-tbwrap" tabindex="0" role="region" aria-label="Tabela: ${esc(legenda)}"><table class="gs-tb gs-ct" role="table" id="${id}"><caption class="sr">${esc(legenda)}</caption>
    <thead role="rowgroup"><tr role="row">${head.map(([h, n]) => `<th role="columnheader" scope="col"${n ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody role="rowgroup">${linhas.join('')}</tbody></table></div>`;
const atualizarBtn = (id) => `<button class="btn btn-ghost btn-sm" type="button" data-pg-refresh id="${id}">${icon('fa-rotate-right')} Atualizar</button>`;
const tentar = (id) => `<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" data-pg-retry id="${id}">Tentar de novo</button></div>`;
const kpi = (x) => `<div class="gs-kpi${x.tom ? ` gs-k-${x.tom}` : ''}" data-kpi="${x.id}"><span class="gs-kpi-l">${x.icon ? `<i class="fa-solid ${x.icon} gs-kpi-ic" aria-hidden="true"></i>` : ''}${esc(x.label)}</span><b class="gs-kpi-v">${esc(x.value)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</div>`;
function falar(texto, tom = 'ok') { const el = $('#pgMsg'); if (el) el.innerHTML = texto ? `<p class="cl-note ${tom}">${esc(texto)}</p>` : ''; }

export function pagamentosShellHtml() {
  return `<section class="cl-card gs-sec gs-pg" id="sec-pagamentos" aria-labelledby="sec-pagamentos-h">
      <h2 id="sec-pagamentos-h">${icon('fa-landmark')}Pagamentos on-line</h2>
      <p class="cl-help">O que foi pago pelo site: as cobranças, a divisão entre a clínica e o IMED e a conferência diária com o meio de pagamento. Aqui não aparece dado de paciente nem de quem pagou: só valores, situações e nomes de clínica.</p>
      <div id="pgCorpo">${loading('Carregando os pagamentos on-line…')}</div>
    </section>`;
}

// hooks: { lost(): a entrada venceu?, forbidden(): a conta deixou de ser da equipe, chave(ligada): a chave geral, cada
// vez que o banco informa }. dias: o período da página.
export function startPagamentos(hooks = {}, dias = 30) {
  stopPagamentos();
  C = novo();
  C.on = true;
  C.gen = ++GEN;
  C.hooks = hooks;
  C.dias = dias;
  const box = corpo();
  if (!box) return;
  box.onclick = aoClicar;
  box.onchange = aoMudar;
  box.onkeydown = aoTeclar;
  buscarResumo();
}
export function stopPagamentos() {
  C.on = false;
  GEN += 1;
}
// "Atualizar números" e a troca do período da página: o resumo e a aba à vista são buscados de novo, sem desmontar a
// tela (e sem mexer num quadro de confirmação aberto).
export function refreshPagamentos(dias) {
  if (!C.on || !corpo()) return;
  if (dias) C.dias = dias;
  if (C.quadro || C.ocupado) return;
  if (!painel()) { buscarResumo(); return; }
  buscarResumo({ quieto: true });
  buscarTab(C.tab, { quieto: true });
}

/* ======================= resumo ======================= */
async function buscarResumo({ quieto = false } = {}) {
  const gen = C.gen;
  const seq = ++C.seqR;
  const velho = () => gen !== C.gen || !corpo()?.isConnected;
  const primeira = !painel();
  const per = P.periodoDias(C.dias);
  let raw;
  try {
    raw = await auth.rpc('admin_pag_resumo', { p_de: per.de, p_ate: per.ate });
  } catch (err) {
    if (velho()) return false;
    if (C.hooks.lost?.()) return false;
    if (proibido(err)) { C.hooks.forbidden?.(); return false; }
    if (noFn(err)) { corpo().innerHTML = note(esc(P.AVISO_SEM_BANCO), 'warn'); return false; }
    if (seq !== C.seqR) return false;
    if (quieto && C.resumo) return false;   // fica o que estava; quem pediu avisa
    if (primeira) corpo().innerHTML = `${note(esc(friendlyError(err, 'Não foi possível carregar os pagamentos on-line agora. Tente de novo em instantes.')), 'err')}${tentar('pgRetry')}`;
    return false;
  }
  if (velho() || seq !== C.seqR) return false;
  if (C.hooks.lost?.()) return false;
  const d = P.normalizeResumo(raw);
  if (d?.tipo === 'forbidden') { corpo().innerHTML = note('Esta conta não tem permissão para ver os pagamentos on-line.', 'warn'); return false; }
  if (!d) {
    if (quieto && C.resumo) return false;
    if (primeira) corpo().innerHTML = `${note('O banco respondeu de um jeito que esta tela não entende. Tente de novo em instantes.', 'err')}${tentar('pgRetry')}`;
    return false;
  }
  C.resumo = d;
  C.hooks.chave?.(d.ligada);
  if (primeira) { montar(); buscarTab(C.tab); } else pintaTopo();
  return true;
}

function montar() {
  corpo().innerHTML = `<div id="pgMsg" class="gs-ce-msg" aria-live="polite"></div>
    <div id="pgTopo"></div>
    <div class="cl-tabs gs-ce-tabs" role="tablist" aria-label="Partes dos pagamentos on-line">
      ${P.PG_TABS.map(([id, nome]) => `<button class="cl-tab" role="tab" type="button" id="pgTab-${id}" aria-controls="pgPainel" aria-selected="${id === C.tab}" tabindex="${id === C.tab ? 0 : -1}" data-pg-tab="${id}">${esc(nome)}${id === 'conciliacao' ? '<span class="n" id="pgCritN" hidden></span>' : ''}</button>`).join('')}
    </div>
    <div class="gs-ce-painel" role="tabpanel" id="pgPainel" aria-labelledby="pgTab-${C.tab}" tabindex="0">${loading('Carregando…')}</div>`;
  pintaTopo();
}

// A chave geral, os números do período e o que precisa de atenção. Com o quadro de confirmação aberto, ele fica.
function pintaTopo(foco = null) {
  const box = $('#pgTopo');
  const d = C.resumo;
  if (!box || !d) return;
  // o que a pessoa já escolheu no quadro e o foco do teclado ficam onde estavam (o resumo chega de novo sozinho)
  if ($('#pgQuadro')) lerQuadro();
  const ativo = document.activeElement;
  const volta = foco || (ativo && box.contains(ativo) && ativo.id ? ativo.id : null);
  const q = C.quadro;
  const at = P.atencaoItens(d);
  const grave = at.some((x) => x.tom === 'err');
  const per = d.de && d.ate ? `Números de ${G.fullDay(d.de)} a ${G.fullDay(d.ate)}, no horário de São Paulo, só do que foi cobrado pelo site (as cobranças registradas à mão estão em “Faturamento e cobrança”).` : '';
  box.innerHTML = `<div class="gs-pg-chave${d.ligada ? ' on' : ''}" id="pgChave" data-ligada="${d.ligada}">
      <span class="gs-pg-chave-ic" aria-hidden="true">${icon(d.ligada ? 'fa-circle-check' : 'fa-lock')}</span>
      <div class="gs-pg-chave-x"><p class="gs-pg-k">Chave geral do pagamento pelo site</p>
        <p class="gs-pg-v" id="pgChaveEstado">${d.ligada ? 'Ligada' : 'Desligada'}</p>
        <p class="gs-pg-t">${esc(P.chaveTexto(d.ligada))}</p></div>
      ${q ? '' : `<button class="btn btn-ghost btn-sm" type="button" id="pgChaveBtn" data-pg-chave="${d.ligada ? 'desligar' : 'ligar'}">${icon(d.ligada ? 'fa-pause' : 'fa-play')} ${d.ligada ? 'Desligar' : 'Ligar'}…<span class="sr"> o pagamento pelo site (pede confirmação)</span></button>`}
    </div>
    ${q ? quadroHtml(q, d) : ''}
    ${per ? `<p class="cl-help gs-pg-per" id="pgPeriodo">${esc(per)}</p>` : ''}
    <div class="gs-kpis" id="pgKpis">${P.resumoKpis(d).map(kpi).join('')}</div>
    <div class="cl-note ${at.length ? (grave ? 'err' : 'warn') : 'ok'} gs-pg-at" id="pgAtencao">${at.length
    ? `<b>${icon('fa-triangle-exclamation')} Precisa de atenção</b><ul>${at.map((x) => `<li data-at="${x.id}">${esc(x.texto)}</li>`).join('')}</ul>`
    : `${icon('fa-circle-check')} Nada pendente agora: nenhuma diferença aberta, devolução parada, aviso por aplicar nem contestação.`}</div>
    <p class="cl-help gs-pg-contas" id="pgContas">${esc(P.contasTexto(d))}${d.atencao.ultima_conciliacao ? ` Última conferência concluída com o meio de pagamento: o dia ${esc(G.fullDay(d.atencao.ultima_conciliacao))}.` : ''}</p>`;
  marcaCriticas(d.atencao.diferencas_criticas);
  if (volta) document.getElementById(volta)?.focus({ preventScroll: !foco });
}
function marcaCriticas(n) {
  const el = $('#pgCritN');
  if (!el) return;
  const tem = G.isNum(n) && n > 0;
  const texto = tem ? `${G.fmtInt(n)}<span class="sr"> ${n === 1 ? 'diferença crítica aberta' : 'diferenças críticas abertas'}</span>` : '';
  if (el.innerHTML !== texto) el.innerHTML = texto;
  if (el.hidden === tem) el.hidden = !tem;
}

function quadroHtml(q, d) {
  const ligar = q.ligar;
  const ativas = d.contas.ativa;
  return `<div class="gs-pay gs-pg-quadro" id="pgQuadro" role="group" aria-labelledby="pgQuadroT">
      <p id="pgQuadroT"><b>${ligar ? 'Ligar o pagamento pelo site?' : 'Desligar o pagamento pelo site?'}</b> ${ligar
    ? `Na hora, toda clínica com a conta conferida e a unidade no modo on-line passa a cobrar o paciente pelo site.${G.isNum(ativas) ? ` Hoje ${ativas === 1 ? 'há 1 clínica' : `há ${esc(G.fmtInt(ativas))} clínicas`} com a conta ativa.` : ''} Dá para desligar de novo a qualquer momento.`
    : 'Na hora, nenhuma cobrança nova nasce, em nenhuma clínica: os pacientes voltam a pagar direto no local. O que já foi pago continua sendo processado e devolvido normalmente.'}</p>
      <div class="cl-field"><label class="cl-lbl" for="pgMotivo">Motivo <small>(fica registrado)</small></label>
        <select id="pgMotivo" aria-required="true" aria-describedby="pgMotivoErr"><option value="">Escolha</option>${P.motivosDe(ligar).map(([k, n]) => `<option value="${k}"${k === q.motivo ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <span class="cl-err" id="pgMotivoErr"></span></div>
      ${ligar ? `<div class="cl-field"><label class="cl-check" for="pgCiente"><input type="checkbox" id="pgCiente" aria-describedby="pgCienteErr"${q.ciente ? ' checked' : ''}><span>Entendi: a partir de agora as clínicas prontas cobram pelo site.</span></label><span class="cl-err" id="pgCienteErr"></span></div>` : ''}
      <div class="cl-row"><button class="btn ${ligar ? 'btn-coral' : 'btn-danger'} btn-sm" type="button" id="pgChaveOk" aria-describedby="pgQuadroT">Confirmar: ${ligar ? 'ligar' : 'desligar'}</button><button class="btn btn-ghost btn-sm" type="button" id="pgChaveVoltar" data-pg-voltar>Voltar</button></div>
      <div class="gs-acterr" id="pgQuadroErr"></div>
    </div>`;
}

/* ======================= abas ======================= */
const BUSCAS = {
  cobrancas: () => { const per = P.periodoDias(C.dias); return auth.rpc('admin_pag_lista', { p_de: per.de, p_ate: per.ate, p_clinic: null, p_situacao: C.filtro || null, p_limit: P.PG_LIMITE }); },
  conciliacao: () => auth.rpc('admin_pag_conciliacao', { p_so_abertas: C.soAbertas }),
};
const ARRUMA = { cobrancas: P.normalizeLista, conciliacao: P.normalizeConciliacao };

// Devolve true (chegou), false (não chegou) ou null (a resposta ficou velha).
async function buscarTab(tab, { quieto = false, foco = null } = {}) {
  const gen = C.gen;
  const seq = ++C.seqT;
  const velho = () => gen !== C.gen || !painel()?.isConnected;
  if (!quieto || !C.dados[tab]) pinta(loading('Carregando…'));
  let raw;
  try {
    raw = await BUSCAS[tab]();
  } catch (err) {
    if (velho()) return null;
    if (C.hooks.lost?.()) return false;
    if (proibido(err)) { C.hooks.forbidden?.(); return false; }
    if (seq !== C.seqT || tab !== C.tab) return null;
    if (quieto && C.dados[tab]) return false;
    pinta(`${note(esc(noFn(err) ? P.AVISO_SEM_BANCO : friendlyError(err, 'Não foi possível carregar agora. Tente de novo em instantes.')), noFn(err) ? 'warn' : 'err')}${noFn(err) ? '' : tentar('pgTabRetry')}`);
    return false;
  }
  if (velho() || seq !== C.seqT || tab !== C.tab) return null;
  if (C.hooks.lost?.()) return false;
  const d = ARRUMA[tab](raw);
  if (!d || d.tipo !== 'ok') {
    if (quieto && C.dados[tab]) return false;
    C.dados[tab] = null;
    pinta(d?.tipo === 'forbidden' ? note('Esta conta não tem permissão para ver esta parte.', 'warn')
      : `${note(esc(d?.tipo === 'invalid' ? 'O banco não aceitou o período. Escolha outro período no alto da página.' : 'O banco respondeu de um jeito que esta tela não entende. Tente de novo em instantes.'), 'err')}${tentar('pgTabRetry')}`);
    return false;
  }
  C.dados[tab] = d;
  if (tab === 'conciliacao') marcaCriticas(d.criticas);
  pinta({ cobrancas: telaCobrancas, conciliacao: telaConciliacao }[tab](d), foco);
  return true;
}

// Troca o conteúdo da aba e devolve o foco do teclado ao mesmo controle (pelo id), se ele ainda existir.
function pinta(html, foco = null) {
  const p = painel();
  if (!p) return;
  const ativo = document.activeElement;
  const dentro = ativo && (ativo === p || p.contains(ativo));
  const id = foco || (dentro && ativo.id ? ativo.id : null);
  p.innerHTML = html;
  const el = id ? document.getElementById(id) : null;
  if (el && p.contains(el)) el.focus({ preventScroll: !foco });
  else if (dentro && document.activeElement !== p) p.focus({ preventScroll: true });
}

function selecionar(tab, focar) {
  if (!P.PG_TABS.some(([id]) => id === tab)) return;
  C.tab = tab;
  for (const b of $$('[data-pg-tab]', corpo())) {
    const on = b.dataset.pgTab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focar) b.focus();
  }
  painel().setAttribute('aria-labelledby', `pgTab-${tab}`);
  buscarTab(tab);
}

/* ---------- cobranças ---------- */
function telaCobrancas(d) {
  const linhas = d.linhas.map((c) => `<tr role="row" data-cobranca="${esc(c.codigo)}">
      <th role="rowheader" scope="row" data-label="Clínica"><div><b>${esc(c.clinica || G.DASH)}</b><small>${esc([P.finalidadeTexto(c.finalidade), P.meioTexto(c.meio)].join(' · '))} · <code>${esc(c.codigo)}</code></small></div></th>
      ${cel('Criada em', `${esc(G.fmtDateTime(c.criado_em))}${c.paga_em ? `<small>paga em ${esc(G.fmtDateTime(c.paga_em))}</small>` : ''}${G.isNum(c.tentativa) && c.tentativa > 1 ? `<small>${esc(G.fmtInt(c.tentativa))}ª tentativa</small>` : ''}`)}
      ${cel('Situação', selo(P.situacaoTexto(c.situacao), P.situacaoTom(c.situacao)))}
      ${cel('Valor', `<b>${esc(G.fmtBRL(c.valor_cents))}</b>`, 'n')}
      ${cel('Taxa do IMED', esc(G.fmtBRL(c.taxa_cents)), 'n')}
      ${cel('Parte da clínica', esc(G.fmtBRL(c.clinica_cents)), 'n')}
      ${cel('Tarifa do meio', c.tarifa_meio_cents === null ? '<span class="gs-ce-vazio">ainda não informada</span>' : esc(G.fmtBRL(c.tarifa_meio_cents)), 'n')}
      ${cel('Devolvido', G.isNum(c.devolvido_cents) && c.devolvido_cents > 0 ? esc(G.fmtBRL(c.devolvido_cents)) : '<span class="gs-ce-vazio">—</span>', 'n')}
    </tr>`);
  const cheia = d.linhas.length >= P.PG_LIMITE;
  const per = C.resumo?.de && C.resumo?.ate ? ` de ${G.fullDay(C.resumo.de)} a ${G.fullDay(C.resumo.ate)}` : ' no período';
  return `<div class="cl-filter gs-ce-bar">
      <label class="cl-lbl gs-pg-lbl" for="pgFiltro">Mostrar</label>
      <select id="pgFiltro">${P.PG_FILTRO.map(([v, n]) => `<option value="${v}"${v === C.filtro ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      ${atualizarBtn('pgCobAtualizar')}
    </div>
    <p class="cl-help" id="pgCobConta">${cheia ? `As ${esc(G.fmtInt(P.PG_LIMITE))} cobranças mais novas` : esc(G.plural(d.linhas.length, 'cobrança criada', 'cobranças criadas'))}${esc(per)}${C.filtro ? ` (só: ${esc(P.situacaoTexto(C.filtro).toLowerCase())})` : ''}. O período é o do alto da página.${cheia ? ' Para ver as outras, escolha um período menor ou uma situação.' : ''}</p>
    ${linhas.length ? tabela('pgCobTb', 'Cobranças pelo site', [['Clínica'], ['Criada em'], ['Situação'], ['Valor', 1], ['Taxa do IMED', 1], ['Parte da clínica', 1], ['Tarifa do meio', 1], ['Devolvido', 1]], linhas)
    : `<p class="gs-empty" id="pgCobVazia">${C.filtro ? 'Nenhuma cobrança com essa situação no período.' : 'Nenhuma cobrança pelo site no período.'}</p>`}`;
}

/* ---------- conciliação ---------- */
function telaConciliacao(d) {
  const abertas = d.diferencas.filter((x) => !x.resolvida_em).length;
  const difs = d.diferencas.map((x) => `<tr role="row" data-dif="${esc(String(x.id ?? ''))}"${x.resolvida_em ? ' class="gs-ce-passado"' : ''}>
      <th role="rowheader" scope="row" data-label="O que houve"><div><b>${esc(P.diffTexto(x.tipo))}</b><small>${selo(P.gravidadeTexto(x.gravidade), P.gravidadeTom(x.gravidade))}</small></div></th>
      ${cel('Dia conferido', esc(x.dia ? G.fullDay(x.dia) : G.DASH))}
      ${cel('No IMED', esc(P.ladoTexto(x.nosso)))}
      ${cel('No meio de pagamento', esc(P.ladoTexto(x.deles, true)))}
      ${cel('Cobrança', x.cobranca ? `<code>${esc(x.cobranca)}</code>` : '<span class="gs-ce-vazio">sem cobrança no IMED</span>')}
      ${cel('Situação', x.resolvida_em ? `${selo('Fechada', '')}<small>${esc(G.fmtDateTime(x.resolvida_em))}${x.resolucao ? ` · ${esc(x.resolucao)}` : ''}</small>` : `${selo('Aberta', x.critica ? 'err' : 'warn')}${x.criado_em ? `<small>desde ${esc(G.fmtDateTime(x.criado_em))}</small>` : ''}`)}
    </tr>`);
  const rodadas = d.rodadas.map((r) => `<tr role="row">
      ${cel('Dia conferido', `<b>${esc(r.dia ? G.fullDay(r.dia) : G.DASH)}</b><small>${esc(P.janelaTexto(r.janela))}</small>`)}
      ${cel('Quando rodou', esc(r.comecou ? G.fmtDateTime(r.comecou) : G.DASH))}
      ${cel('Situação', selo(P.rodadaTexto(r.situacao), P.rodadaTom(r.situacao)))}
      ${cel('Cobranças comparadas', esc(G.fmtInt(r.linhas)), 'n')}
      ${cel('Diferenças achadas', `${esc(G.fmtInt(r.achadas))}${G.isNum(r.criticas) && r.criticas > 0 ? `<small>${esc(G.plural(r.criticas, 'crítica', 'críticas'))}</small>` : ''}`, 'n')}
    </tr>`);
  const op = (v, n) => `<label><input type="radio" name="pgDif" id="pgDif-${v}" value="${v}"${(v === 'abertas') === C.soAbertas ? ' checked' : ''}><span>${n}</span></label>`;
  const crit = G.isNum(d.criticas) && d.criticas > 0;
  return `<p class="cl-help">Toda madrugada o IMED pede ao meio de pagamento as cobranças do dia anterior e compara com o que está registrado aqui, uma por uma. A conferência não corrige nada sozinha: diferença crítica quer dizer dinheiro sem agendamento, ou agendamento sem dinheiro, e alguém precisa olhar.</p>
    <p class="cl-note ${crit ? 'err' : 'info'} gs-ce-nota" id="pgConcResumo">${crit ? `${icon('fa-triangle-exclamation')} <b>${esc(G.plural(d.criticas, 'diferença crítica aberta', 'diferenças críticas abertas'))}.</b> ` : ''}${esc(P.ultimaRodadaTexto(d))}</p>
    <div class="gs-ce-bar">
      <fieldset class="gs-period"><legend>Mostrar</legend><div class="gs-seg">${op('abertas', 'Diferenças abertas')}${op('todas', 'Todas')}</div></fieldset>
      ${atualizarBtn('pgConcAtualizar')}
    </div>
    <h3 id="pgDifT">${C.soAbertas ? 'Diferenças abertas' : 'Diferenças'} (${esc(G.fmtInt(C.soAbertas ? abertas : d.diferencas.length))})</h3>
    ${difs.length ? tabela('pgDifTb', C.soAbertas ? 'Diferenças abertas da conciliação' : 'Diferenças da conciliação', [['O que houve'], ['Dia conferido'], ['No IMED'], ['No meio de pagamento'], ['Cobrança'], ['Situação']], difs)
    : `<p class="gs-empty" id="pgDifVazia">${C.soAbertas ? 'Nenhuma diferença aberta.' : 'Nenhuma diferença registrada.'}</p>`}
    ${difs.length ? '<p class="cl-help gs-pg-fechar">Fechar uma diferença, com o motivo, ainda é feito pelo banco (só o administrador do IMED); a tela para isso chega numa próxima etapa.</p>' : ''}
    <h3 id="pgRodT">Últimas conferências</h3>
    ${rodadas.length ? tabela('pgRodTb', 'Últimas conferências com o meio de pagamento', [['Dia conferido'], ['Quando rodou'], ['Situação'], ['Cobranças comparadas', 1], ['Diferenças achadas', 1]], rodadas)
    : '<p class="gs-empty" id="pgRodVazia">Nenhuma conferência feita ainda.</p>'}`;
}

/* ======================= ações ======================= */
function lerQuadro() {
  const q = C.quadro;
  if (!q) return;
  q.motivo = $('#pgMotivo')?.value || '';
  q.ciente = !!$('#pgCiente')?.checked;
}
function mostraErros(errors) {
  let primeiro = null;
  for (const [k, id] of [['motivo', 'pgMotivo'], ['ciente', 'pgCiente']]) {
    const el = document.getElementById(id);
    const er = document.getElementById(`${id}Err`);
    if (er) er.textContent = errors[k] || '';
    if (!el) continue;
    if (errors[k]) { el.setAttribute('aria-invalid', 'true'); primeiro ||= el; } else el.removeAttribute('aria-invalid');
  }
  primeiro?.focus();
  return !primeiro;
}

async function confirmarChave() {
  const q = C.quadro;
  if (!q || C.ocupado) return;
  lerQuadro();
  const v = P.validarChave(q);
  $('#pgQuadroErr').innerHTML = '';
  if (!mostraErros(v.errors)) return;
  const gen = C.gen;
  C.ocupado = true;
  const botoes = $$('button', corpo()).filter((b) => !b.disabled);
  botoes.forEach((b) => { b.disabled = true; });
  const erro = (t) => { const el = $('#pgQuadroErr'); if (el) el.innerHTML = note(esc(t), 'err'); };
  let r = null;
  try {
    r = await auth.rpc('admin_pag_chave_geral', v.payload);
  } catch (err) {
    if (gen !== C.gen) return;
    if (C.hooks.lost?.()) return;
    if (proibido(err)) { C.hooks.forbidden?.(); return; }
    erro(noFn(err) ? P.AVISO_SEM_BANCO : friendlyError(err, 'Não foi possível gravar agora. Tente de novo em instantes.'));
    return;
  } finally {
    C.ocupado = false;
    botoes.forEach((b) => { if (b.isConnected) b.disabled = false; });
  }
  if (gen !== C.gen) return;
  if (r?.status !== 'ok' || typeof r.vendas_online_ligadas !== 'boolean') { erro(P.pgStatus(r?.status)); $('#pgChaveOk')?.focus(); return; }
  C.quadro = null;
  // o estado novo já na tela (o que o banco respondeu); o resumo completo vem em seguida
  if (C.resumo) C.resumo.ligada = r.vendas_online_ligadas;
  C.hooks.chave?.(r.vendas_online_ligadas);
  pintaTopo('pgChaveBtn');
  falar(r.vendas_online_ligadas ? 'Pagamento pelo site ligado. O motivo ficou registrado.' : 'Pagamento pelo site desligado: nenhuma cobrança nova nasce. O motivo ficou registrado.');
  buscarResumo({ quieto: true });
}

async function aoClicar(e) {
  const t = e.target.closest('button');
  if (!t || !corpo()?.contains(t)) return;
  if (t.hasAttribute('data-pg-retry')) {
    if (t.id === 'pgRetry') { corpo().innerHTML = loading('Carregando os pagamentos on-line…'); buscarResumo(); } else buscarTab(C.tab);
    return;
  }
  if (t.dataset.pgTab) { selecionar(t.dataset.pgTab, false); return; }
  if (C.ocupado) return;
  if (t.hasAttribute('data-pg-refresh')) {
    falar('');
    const [, ok] = await Promise.all([buscarResumo({ quieto: true }), buscarTab(C.tab, { quieto: true, foco: t.id })]);
    if (ok === false) falar('Não foi possível atualizar agora. Os dados abaixo ainda são os de antes.', 'err');
    return;
  }
  if (t.dataset.pgChave) { C.quadro = { ligar: t.dataset.pgChave === 'ligar', motivo: '', ciente: false }; falar(''); pintaTopo('pgMotivo'); return; }
  if (t.hasAttribute('data-pg-voltar')) { C.quadro = null; pintaTopo('pgChaveBtn'); return; }
  if (t.id === 'pgChaveOk') confirmarChave();
}

function aoMudar(e) {
  const t = e.target;
  // Filtro novo: a lista de antes sai da tela até a nova chegar (nunca a lista de um filtro com o nome de outro).
  if (t.id === 'pgFiltro') { C.filtro = t.value; C.dados.cobrancas = null; buscarTab('cobrancas', { foco: 'pgFiltro' }); return; }
  if (t.name === 'pgDif') { C.soAbertas = t.value !== 'todas'; C.dados.conciliacao = null; buscarTab('conciliacao', { foco: t.id }); return; }
  if (t.id === 'pgMotivo' || t.id === 'pgCiente') lerQuadro();
}

// Abas: setas, Home e End (como nas outras partes do painel).
function aoTeclar(e) {
  const b = e.target.closest?.('[data-pg-tab]');
  if (!b) return;
  const todas = $$('[data-pg-tab]', corpo());
  const i = todas.indexOf(b);
  const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: todas.length - 1 }[e.key];
  if (j === undefined) return;
  e.preventDefault();
  selecionar(todas[(j + todas.length) % todas.length].dataset.pgTab, true);
}
