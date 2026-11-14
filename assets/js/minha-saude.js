// "Minha Saúde", etapa 1 (a página do paciente com o que já é dele): os agendamentos deste aparelho, as teleconsultas
// deste aparelho (o código de cada uma fica em localStorage 'imed_tele' e 'imed_tele_hist', gravado pela teleconsulta)
// e as teleconsultas que ele guardou na conta (funções saude_* da migração ws_minha_saude). Regras: minha-saude-core.js.
// O que esta página NÃO faz: histórico entre consultas, anotações do médico, resultados de exames (etapa 2).
// Nada novo fica guardado no aparelho. Banco de antes (sem as funções saude_*): a página mostra só o que é do aparelho.
import * as A from './auth.js';
import * as T from './tele-core.js';
import * as D from './tele-docs.js';
import * as M from './minha-saude-core.js';
import { montarSenha } from './entrada-senha.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const store = (() => { try { return window.localStorage; } catch { return null; } })();
const icon = (n) => `<i class="fa-solid ${n}" aria-hidden="true"></i>`;
const semFuncao = (err) => err?.status === 404 || err?.data?.code === 'PGRST202' || err?.data?.code === '42883';

const S = {
  tab: 'agendamentos', logado: false, carregando: true,
  aparelho: new Map(),      // id → { id, token } das consultas deste aparelho
  conta: null,              // resposta de saude_minhas_consultas, arrumada (null = sem conta ou banco de antes)
  temFuncoes: null,         // o banco tem as funções saude_*? (null = ainda não se sabe)
  consultas: [], erroAparelho: false, erroConta: false,
  abertas: new Set(),       // consultas com os documentos à mostra
  docs: new Map(),          // id → { carregando, itens, via, aviso, erro }
  msg: new Map(),           // id → [texto, tipo]
  ocupado: new Set(), pergunta: '', travada: false,
};

/* ======================= avisos ======================= */
function flash(texto, tipo = 'ok') {
  const el = $('flash');
  el.textContent = texto; el.className = `ct-flash ${tipo}`; el.hidden = !texto;
}
function toast(texto) {
  const el = $('toast');
  el.textContent = texto; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ======================= dados ======================= */
function lerAparelho() {
  const lista = [T.readCurrent(store), ...T.readHistory(store)].filter(Boolean);
  return new Map(lista.map((e) => [e.id, { id: e.id, token: e.token }]));
}
function lerAgendamentos() {
  try { return M.agendamentosDoAparelho(JSON.parse(store?.getItem('imed_appts') || '[]')); } catch { return []; }
}

async function carregar() {
  S.carregando = true; S.erroAparelho = false; S.erroConta = false;
  desenhar();
  S.aparelho = lerAparelho();
  const doAparelho = [];
  const jobs = [...S.aparelho.values()].slice(0, 11).map((e) => A.rpc('tele_status', { p_id: e.id, p_token: e.token })
    .then((rows) => { const c = M.consultaDoAparelho(e, Array.isArray(rows) ? rows[0] : null); if (c) doAparelho.push(c); else S.aparelho.delete(e.id); })
    .catch(() => { S.erroAparelho = true; }));
  S.conta = null;
  if (S.logado) {
    jobs.push(A.rpc('saude_minhas_consultas').then((r) => {
      S.temFuncoes = true;
      S.conta = M.normalizeConta(r);
      if (!S.conta && r?.status !== 'forbidden') S.erroConta = true;
    }).catch((err) => { if (semFuncao(err)) S.temFuncoes = false; else S.erroConta = true; }));
  }
  await Promise.all(jobs);
  S.consultas = M.juntarConsultas(doAparelho, S.conta?.itens);
  for (const id of [...S.abertas]) if (!S.consultas.some((c) => c.id === id)) { S.abertas.delete(id); S.docs.delete(id); }
  S.carregando = false;
  desenhar();
}

// Os documentos de uma consulta: pela conta (se estiver guardada e a entrada for recente) ou pelo código do aparelho.
async function carregarDocs(c) {
  S.docs.set(c.id, { carregando: true });
  desenharConsultas();
  const pelaConta = async () => {
    const r = await A.rpc('saude_documentos', { p_consulta: c.id });
    if (r?.status === 'ok') return { itens: M.normalizeDocumentos(r.items), via: 'conta' };
    return { falha: r?.status || 'erro' };
  };
  const peloAparelho = async () => {
    const e = S.aparelho.get(c.id);
    const rows = await A.rpc('tele_patient_documents', { p_id: e.id, p_token: e.token });
    return { itens: M.normalizeDocumentos(rows), via: 'aparelho' };
  };
  let out;
  try {
    if (c.naConta && S.logado) {
      out = await pelaConta();
      // entrada antiga ou vínculo que sumiu: neste aparelho ainda dá para abrir pelo código dele
      if (out.falha && c.noAparelho) out = await peloAparelho();
    } else out = await peloAparelho();
  } catch { out = { falha: 'erro' }; }
  if (!S.abertas.has(c.id)) return;
  S.docs.set(c.id, out.falha ? { erro: M.respostaTexto(out.falha), reauth: out.falha === 'reauth' } : { itens: out.itens, via: out.via });
  desenharConsultas();
  $(`msDocsT-${c.id}`)?.focus();
}

/* ======================= telas ======================= */
function desenhar() {
  desenharConta();
  desenharAbas();
  desenharAgendamentos();
  desenharConsultas();
  desenharGuardadas();
  $('msLock').hidden = !S.travada;
}

function desenharConta() {
  const u = A.user();
  S.logado = !!u;
  $('signedOut').hidden = S.logado;
  $('signedIn').hidden = !S.logado;
  if (u) $('meEmail').textContent = u.email || 'sua conta';
}

function desenharAbas() {
  for (const [id] of M.TABS) {
    const b = $(`msTab-${id}`); const p = $(`msPanel-${id}`);
    const on = S.tab === id;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    p.hidden = !on;
  }
}

function desenharAgendamentos() {
  const lista = lerAgendamentos();
  $('msAgLista').innerHTML = lista.length
    ? `<ul class="ms-lista">${lista.map((a) => `<li class="ms-card ms-ag">
        <div><h3>${esc(a.local)}</h3>${a.quando ? `<p>${icon('fa-calendar-check')}${esc(a.quando)}</p>` : ''}${a.codigo ? `<p class="ct-muted">Código ${esc(a.codigo)}</p>` : ''}</div>
        <a class="btn btn-ghost btn-sm" href="${esc(a.link)}">Abrir em Minha conta<span class="sr"> o agendamento em ${esc(a.local)}</span></a>
      </li>`).join('')}</ul>`
    : `<p class="ms-vazio">Nenhum agendamento neste aparelho. <a class="link" href="perto.html">Procurar clínicas perto de mim</a></p>`;
}

function docHtml(c, d, via) {
  const ocupado = S.ocupado.has(`pdf-${d.id}`);
  return `<li class="ms-doc${d.cancelado ? ' ms-doc-off' : ''}">
    <div><b>${esc(d.titulo)}</b><span>${esc(M.situacaoDocumento(d))}</span>${d.codigo ? `<span class="ct-muted">Código de conferência: ${esc(d.codigo)}</span>` : ''}</div>
    <div class="ct-row">
      ${d.baixa ? `<button class="btn btn-ghost btn-sm" type="button" data-pdf="${esc(d.id)}" data-c="${esc(c.id)}" data-via="${via}"${ocupado ? ' disabled' : ''}>${icon('fa-download')}${ocupado ? 'Baixando…' : 'Baixar PDF assinado'}<span class="sr">: ${esc(d.titulo)}</span></button>` : ''}
      ${d.conferir && !d.cancelado ? `<a class="btn btn-ghost btn-sm" href="${esc(d.conferir)}">${icon('fa-shield-halved')}Conferir autenticidade<span class="sr">: ${esc(d.titulo)}</span></a>` : ''}
    </div>
  </li>`;
}

function docsHtml(c) {
  const d = S.docs.get(c.id);
  if (!d || d.carregando) return `<p class="ct-muted" role="status">Abrindo os documentos…</p>`;
  const titulo = `<h4 id="msDocsT-${c.id}" tabindex="-1">Documentos</h4>`;
  if (d.erro) {
    return `${titulo}<p class="ms-nota warn">${esc(d.erro)}</p>
      ${d.reauth ? `<div class="ct-row"><button class="btn btn-ghost btn-sm" type="button" data-sair>${icon('fa-right-from-bracket')}Sair para entrar de novo</button></div>` : ''}`;
  }
  if (!d.itens.length) return `${titulo}<p class="ct-muted">O médico não emitiu documentos nesta consulta.</p>`;
  return `${titulo}<ul class="ms-docs">${d.itens.map((x) => docHtml(c, x, d.via)).join('')}</ul>
    <p class="ct-muted ms-fino">O PDF só vale com a assinatura digital do médico. Quem receber o documento pode conferir em “Conferir autenticidade”.</p>`;
}

function consultaHtml(c) {
  const aberta = S.abertas.has(c.id) && !S.travada;
  const ctx = { logado: S.logado, ligado: !!S.conta?.podeGuardar, temFuncoes: S.temFuncoes !== false };
  const m = S.msg.get(c.id);
  const onde = [c.noAparelho ? 'Neste aparelho' : '', c.naConta ? 'Na sua conta' : ''].filter(Boolean);
  const situacao = M.situacaoTexto(c.status);
  const porque = M.porQueNaoGuarda(c, ctx);
  const guardando = S.ocupado.has(`g-${c.id}`);
  return `<li class="ms-card" id="msC-${c.id}">
    <h3>${esc(M.tituloConsulta(c))}</h3>
    ${c.medico ? `<p>${icon('fa-user-doctor')}${esc(c.medico)}</p>` : ''}
    <p class="ms-tags">${situacao ? `<span class="ms-tag">${esc(situacao)}</span>` : ''}${onde.map((o) => `<span class="ms-tag ms-tag-onde">${esc(o)}</span>`).join('')}${Number.isInteger(c.documentos) ? `<span class="ms-tag">${c.documentos === 1 ? '1 documento' : `${c.documentos} documentos`}</span>` : ''}</p>
    <div class="ct-row">
      ${M.emAndamento(c.status) ? `<a class="btn btn-primary btn-sm" href="teleconsulta.html">${icon('fa-video')}Voltar para a consulta</a>`
    : `<button class="btn btn-ghost btn-sm" type="button" data-docs="${esc(c.id)}" aria-expanded="${aberta}" aria-controls="msDocs-${c.id}">${icon(aberta ? 'fa-xmark' : 'fa-file-medical')}${aberta ? 'Esconder os documentos' : 'Ver os documentos'}<span class="sr"> da ${esc(M.tituloConsulta(c))}</span></button>`}
      ${M.podeGuardar(c, ctx) ? `<button class="btn btn-ghost btn-sm" type="button" data-guardar="${esc(c.id)}"${guardando ? ' disabled' : ''}>${icon('fa-user')}${guardando ? 'Guardando…' : 'Guardar na minha conta'}</button>` : ''}
      ${c.noAparelho && !M.emAndamento(c.status) ? `<a class="btn btn-ghost btn-sm" href="teleconsulta.html">${icon('fa-list-check')}Exames e orientações<span class="sr"> desta consulta, na página da teleconsulta</span></a>` : ''}
    </div>
    ${porque ? `<p class="ct-muted ms-fino">${esc(porque)}</p>` : ''}
    <div class="ms-msg" id="msMsg-${c.id}" aria-live="polite">${m ? `<p class="ms-nota ${m[1]}">${esc(m[0])}</p>` : ''}</div>
    <div class="ms-docs-box" id="msDocs-${c.id}"${aberta ? '' : ' hidden'}>${aberta ? docsHtml(c) : ''}</div>
  </li>`;
}

function desenharConsultas() {
  const box = $('msConsultas');
  if (S.carregando) { box.innerHTML = '<div class="ct-skel" aria-hidden="true"></div>'; box.setAttribute('aria-busy', 'true'); return; }
  box.removeAttribute('aria-busy');
  const avisos = [
    S.erroAparelho ? 'Não foi possível conferir agora as consultas deste aparelho. Confira a internet e toque em Atualizar.' : '',
    S.erroConta ? 'Não foi possível ler agora o que está guardado na sua conta. Confira a internet e toque em Atualizar.' : '',
  ].filter(Boolean).map((t) => `<p class="ms-nota warn">${esc(t)}</p>`).join('');
  box.innerHTML = `${avisos}${S.consultas.length ? `<ul class="ms-lista">${S.consultas.map(consultaHtml).join('')}</ul>`
    : `<p class="ms-vazio">${S.logado ? 'Nenhuma teleconsulta neste aparelho nem guardada na sua conta.' : 'Nenhuma teleconsulta neste aparelho.'} <a class="link" href="teleconsulta.html">Conhecer a teleconsulta</a></p>`}`;
}

function desenharGuardadas() {
  const box = $('msGuardadas');
  if (!S.logado) { box.innerHTML = '<p class="ms-vazio">Entre na sua conta, no quadro acima, para ver o que está guardado nela.</p>'; return; }
  if (S.carregando) { box.innerHTML = '<div class="ct-skel" aria-hidden="true"></div>'; return; }
  if (S.temFuncoes === false || (S.conta && !S.conta.podeGuardar && !S.conta.itens.length)) {
    box.innerHTML = '<p class="ms-vazio">Guardar teleconsultas na conta ainda não está disponível. Por enquanto, os documentos de cada consulta aparecem no aparelho em que ela foi feita.</p>';
    return;
  }
  if (!S.conta) { box.innerHTML = '<p class="ms-nota warn">Não foi possível ler agora o que está guardado na sua conta.</p>'; return; }
  const itens = S.conta.itens;
  box.innerHTML = itens.length ? `<ul class="ms-lista">${itens.map((c) => {
    const pergunta = S.pergunta === c.id;
    return `<li class="ms-card" id="msG-${c.id}">
      <h3>${esc(M.tituloConsulta(c))}</h3>
      ${c.medico ? `<p>${icon('fa-user-doctor')}${esc(c.medico)}</p>` : ''}
      ${c.guardadaEm ? `<p class="ct-muted">Guardada na conta em ${esc(M.fmtDiaHora(c.guardadaEm))}</p>` : ''}
      ${pergunta ? `<div class="ct-confirm" role="group" aria-labelledby="msQ-${c.id}">
          <p id="msQ-${c.id}">Tirar esta consulta da sua conta? Os documentos deixam de abrir pela conta. O registro do médico não muda, e no aparelho em que a consulta foi feita eles continuam aparecendo.</p>
          <div class="ct-row"><button class="btn btn-coral btn-sm" type="button" data-tirar-sim="${esc(c.id)}"${S.ocupado.has(`t-${c.id}`) ? ' disabled' : ''}>Sim, tirar</button><button class="btn btn-ghost btn-sm" type="button" data-tirar-nao="${esc(c.id)}">Não tirar</button></div>
        </div>`
    : `<div class="ct-row"><button class="btn btn-ghost btn-sm" type="button" data-tirar="${esc(c.id)}">${icon('fa-user-xmark')}Tirar da minha conta<span class="sr">: ${esc(M.tituloConsulta(c))}</span></button></div>`}
    </li>`;
  }).join('')}</ul>` : '<p class="ms-vazio">Nenhuma teleconsulta guardada na sua conta. Para guardar, abra “Consultas e documentos” no aparelho em que a consulta foi feita.</p>';
}

/* ======================= ações ======================= */
function trocarAba(id, foco = false) {
  if (!M.TABS.some(([t]) => t === id)) return;
  S.tab = id;
  desenharAbas();
  if (foco) $(`msTab-${id}`).focus();
}

async function baixar(btn) {
  const { pdf: id, c: consulta, via } = btn.dataset;
  const d = S.docs.get(consulta)?.itens?.find((x) => x.id === id);
  if (!d || S.ocupado.has(`pdf-${id}`)) return;
  S.ocupado.add(`pdf-${id}`); S.msg.delete(consulta); desenharConsultas();
  let b64 = null; let falha = '';
  try {
    if (via === 'conta') {
      const r = await A.rpc('saude_documento_pdf', { p_doc: id });
      if (r?.status === 'ok') b64 = r.pdf; else falha = M.respostaTexto(r?.status);
    } else {
      const e = S.aparelho.get(consulta);
      b64 = await A.rpc('tele_patient_document_pdf', { p_id: e.id, p_token: e.token, p_doc: id });
      if (!b64) falha = M.respostaTexto('no_pdf');
    }
  } catch { falha = M.respostaTexto('erro'); }
  S.ocupado.delete(`pdf-${id}`);
  if (b64) {
    const url = URL.createObjectURL(new Blob([D.fromBase64(b64)], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = D.pdfFileName({ kind: d.kind, codeText: d.codigo }, true); a.rel = 'noopener'; a.hidden = true;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    S.msg.set(consulta, ['PDF assinado baixado.', 'ok']);
  } else S.msg.set(consulta, [falha, 'warn']);
  desenharConsultas();
  document.querySelector(`[data-pdf="${CSS.escape(id)}"]`)?.focus();
}

async function guardar(id) {
  const e = S.aparelho.get(id);
  if (!e || S.ocupado.has(`g-${id}`)) return;
  S.ocupado.add(`g-${id}`); S.msg.delete(id); desenharConsultas();
  let r;
  try { r = await A.rpc('saude_guardar', { p_consulta: e.id, p_token: e.token }); } catch (err) { r = { status: semFuncao(err) ? 'off' : 'erro' }; }
  S.ocupado.delete(`g-${id}`);
  if (r?.status === 'ok') {
    S.msg.set(id, ['Consulta guardada na sua conta. Agora os documentos abrem em qualquer aparelho em que você entrar.', 'ok']);
    await carregar();
  } else {
    S.msg.set(id, [M.respostaTexto(r?.status), 'warn']);
    desenharConsultas();
  }
  ($(`msC-${id}`)?.querySelector('[data-docs]') || $('msConsultasT'))?.focus();
}

async function tirar(id) {
  if (S.ocupado.has(`t-${id}`)) return;
  S.ocupado.add(`t-${id}`); desenharGuardadas();
  let r;
  try { r = await A.rpc('saude_vinculo_revogar', { p_consulta: id }); } catch { r = { status: 'erro' }; }
  S.ocupado.delete(`t-${id}`); S.pergunta = '';
  if (r?.status === 'ok' || r?.status === 'not_found') {
    S.abertas.delete(id); S.docs.delete(id); S.msg.delete(id);
    toast('Consulta tirada da sua conta.');
    await carregar();
  } else {
    desenharGuardadas();
    flash(M.respostaTexto(r?.status), 'warn');
  }
  $('msGuardadasT').focus();
}

async function sair(motivo = 'Você saiu da conta em todos os aparelhos. O que é deste aparelho continua aqui.') {
  await A.signOutAll();
  S.conta = null; S.temFuncoes = null; S.abertas.clear(); S.docs.clear(); S.msg.clear(); S.pergunta = '';
  flash(motivo, 'info');
  await carregar();
  $('email')?.focus();
}

/* ---------- trava por tempo parado ---------- */
let parado = 0;
function mexeu() {
  clearTimeout(parado);
  if (S.travada) return;
  parado = setTimeout(() => {
    if (!S.abertas.size) return;   // nada sensível na tela
    S.travada = true; S.docs.clear(); S.msg.clear();
    desenhar();
  }, M.IDLE_MS);
}

function ligar() {
  // abas (setas, Home e End, como manda o padrão de abas)
  $('msTabs').addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) trocarAba(b.dataset.tab); });
  $('msTabs').addEventListener('keydown', (e) => {
    const ids = M.TABS.map(([t]) => t); const i = ids.indexOf(S.tab);
    const para = { ArrowRight: ids[(i + 1) % ids.length], ArrowLeft: ids[(i + ids.length - 1) % ids.length], Home: ids[0], End: ids.at(-1) }[e.key];
    if (para) { e.preventDefault(); trocarAba(para, true); }
  });
  $('main').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.docs) {
      const c = S.consultas.find((x) => x.id === d.docs);
      if (!c) return;
      if (S.abertas.has(c.id)) { S.abertas.delete(c.id); S.docs.delete(c.id); desenharConsultas(); document.querySelector(`[data-docs="${CSS.escape(c.id)}"]`)?.focus(); return; }
      S.abertas.add(c.id); mexeu(); carregarDocs(c);
      return;
    }
    if (d.pdf) { baixar(b); return; }
    if (d.guardar) { guardar(d.guardar); return; }
    if (d.tirar) { S.pergunta = d.tirar; desenharGuardadas(); document.querySelector(`[data-tirar-sim="${CSS.escape(d.tirar)}"]`)?.focus(); return; }
    if (d.tirarNao) { S.pergunta = ''; desenharGuardadas(); document.querySelector(`[data-tirar="${CSS.escape(d.tirarNao)}"]`)?.focus(); return; }
    if (d.tirarSim) { tirar(d.tirarSim); return; }
    if (d.sair !== undefined) { sair('Você saiu. Entre de novo para abrir os documentos guardados na conta.'); return; }
    if (b.id === 'msAtualizar') { carregar().then(() => $('msAtualizar').focus()); return; }
    if (b.id === 'msDestravar') { S.travada = false; S.abertas.clear(); desenhar(); mexeu(); $('msConsultasT').focus(); return; }
    if (b.id === 'logoutBtn') { sair(); }
  });
  for (const ev of ['pointerdown', 'keydown', 'scroll']) addEventListener(ev, mexeu, { passive: true });

  // entrada: e-mail e senha (o caminho principal) e, como opção, o link por e-mail
  montarSenha({ form: $('loginForm'), email: () => $('email').value, msg: $('loginMsg'), depois: async () => { flash('Pronto, você entrou.', 'ok'); await carregar(); $('msTab-consultas').focus(); } });
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('email').value.trim();
    const msg = $('loginMsg'); const btn = $('loginBtn');
    const show = (t, ok = false) => { msg.textContent = t; msg.hidden = !t; msg.classList.toggle('ok', ok); };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { show('Digite um e-mail válido, por exemplo voce@exemplo.com.'); $('email').focus(); return; }
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      await A.signIn(email, location.href.split('#')[0]);
      show(`Enviamos um link para ${email}. Abra o e-mail e toque no link para entrar. Pode levar alguns minutos; confira também a caixa de spam.`, true);
    } catch (err) {
      show(err.code === 'invalid_email' ? 'Digite um e-mail válido.' : err.status === 429 ? 'Muitas tentativas seguidas. Espere um minuto e tente de novo.'
        : 'Não foi possível enviar o link agora. Confira a internet e tente de novo.');
    } finally { btn.disabled = false; btn.textContent = 'Receber link de entrada'; }
  });
}

async function init() {
  ligar();
  const r = await A.handleRedirect();
  if (r?.status === 'ok') flash('Pronto, você entrou.', 'ok');
  else if (r?.status === 'error') flash(r.message, 'warn');
  desenharConta();
  if (S.logado && !(await A.token())) { desenharConta(); flash('Sua entrada venceu. Entre de novo com seu e-mail e senha.', 'warn'); }
  // quem chega com consulta neste aparelho e sem agendamento começa pelas consultas
  if (/^#(agendamentos|consultas|conta)$/.test(location.hash)) S.tab = location.hash.slice(1);
  else if (!lerAgendamentos().length && lerAparelho().size) S.tab = 'consultas';
  await carregar();
  mexeu();
}

init();
