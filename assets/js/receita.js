// Receita completa, etapa 1: a tela da receita montada por campos, dentro da aba Receita do medico.js.
// As regras ficam em receita-core.js; aqui é só tela e rede. O que sai impresso continua no formato da receita simples
// (tele-docs.js): o medico.js recebe a lista "impressa" e usa a mesma conferência e a mesma pré-visualização de sempre.
// Com o banco novo (migração ws_receita): o rascunho é salvo sozinho no servidor (com versão), há modelos do médico e
// a lista de controle trava a emissão. Com o banco de antes: os mesmos campos, sem salvar e sem modelos, e a emissão
// segue pelo caminho antigo.
import * as R from './receita-core.js';
import { CFM_PRESCRICAO_URL } from './tele-docs.js';

export const AVISO_LISTA = R.AVISO_LISTA;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const semFuncao = (e) => e?.status === 404 || e?.data?.code === 'PGRST202';
const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const OPT = ' <small class="h">(opcional)</small>';
const ESPERA_MS = 1200;

// ctx: { raiz: () => elemento do painel da receita, obs: () => textarea das observações gerais, rpc, toast,
//        aoMudar: () => void (a lista impressa mudou), perdeuSessao: (erro) => boolean }
export function montar(ctx) {
  const E = { id: null, seq: 0, itens: [R.itemNovo()], banco: false, podeEditar: false, versao: 0, salvo: '', regras: R.regrasPadrao(),
    modelos: null, emitidas: [], timer: null, fila: Promise.resolve(), estado: '', caixa: '' };
  const q = (sel) => ctx.raiz()?.querySelector(sel) || null;
  const atual = () => R.conteudo(E.itens, ctx.obs()?.value);
  const impresso = () => { const l = R.listaImpressa(E.itens); return l.length ? l : [{}]; };
  const bate = () => (E.banco ? R.conferirLista(R.listaImpressa(E.itens), E.regras) : []);

  /* ---------- desenho ---------- */
  function campo(i, chave, tela, rotulo, { area = false, max = 60, ph = '', tipo = 'text', extra = '' } = {}) {
    const n = i + 1;
    const id = `dRx${n}-${chave}`;
    const v = esc(E.itens[i][chave] ?? '');
    const comum = `id="${id}" data-rxn="${i}" data-rxk="${chave}" data-fkey="receita:itens.${n}.${tela}" aria-describedby="${id}Err" maxlength="${max}" placeholder="${esc(ph)}"`;
    const el = area ? `<textarea ${comum} rows="2">${v}</textarea>` : `<input ${comum} type="${tipo}" value="${v}"${extra}>`;
    return `<div class="fld"><label for="${id}">${rotulo}</label>${el}<span class="err" id="${id}Err" data-ferr="receita:itens.${n}.${tela}"></span></div>`;
  }
  function escolha(i, chave, tela, rotulo, opcoes, vazio) {
    const n = i + 1;
    const id = `dRx${n}-${chave}`;
    const val = E.itens[i][chave] || '';
    return `<div class="fld"><label for="${id}">${rotulo}</label><select id="${id}" data-rxn="${i}" data-rxk="${chave}" data-fkey="receita:itens.${n}.${tela}" aria-describedby="${id}Err">
      <option value="">${esc(vazio)}</option>${opcoes.map(([v, t]) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <span class="err" id="${id}Err" data-ferr="receita:itens.${n}.${tela}"></span></div>`;
  }
  function numero(i, chave, rotulo, max) {
    const n = i + 1;
    const id = `dRx${n}-${chave}`;
    return `<div class="fld rx-num"><label for="${id}">${rotulo}</label><input id="${id}" type="number" inputmode="numeric" min="1" max="${max}" step="1" data-rxn="${i}" data-rxk="${chave}" value="${esc(E.itens[i][chave] ?? '')}"></div>`;
  }
  function itemHtml(it, i) {
    const n = i + 1;
    const manip = R.ehManipulado(it);
    const tipo = `<div class="rx-tipo" role="radiogroup" aria-label="Tipo do medicamento ${n}">
      ${[['industrializado', 'Remédio de farmácia'], ['manipulado', 'Manipulado (fórmula)']].map(([v, t]) => `<label class="tl-check"><input type="radio" name="dRx${n}-tipo" value="${v}" data-rxn="${i}" data-rxk="tipo"${(manip ? 'manipulado' : 'industrializado') === v ? ' checked' : ''}><span>${t}</span></label>`).join('')}</div>`;
    const nome = manip
      ? `${campo(i, 'medicamento', 'nome', `Nome da fórmula${OPT}`, { max: 80, ph: 'Ex.: creme para as mãos' })}
         ${campo(i, 'composicao', 'medicamento', 'Fórmula: componentes e concentrações', { area: true, max: R.LIMITES.composicao, ph: 'Ex.: ureia 10%, creme base qsp 100 g' })}
         ${campo(i, 'forma', 'forma', `Forma${OPT}`, { ph: 'Ex.: creme, cápsula' })}`
      : `${campo(i, 'medicamento', 'medicamento', 'Medicamento <small class="h">(nome genérico, de preferência)</small>', { max: 200 })}
         <div class="row2">${campo(i, 'concentracao', 'concentracao', 'Concentração', { ph: 'Ex.: 500 mg' })}${campo(i, 'forma', 'forma', `Forma${OPT}`, { ph: 'Ex.: comprimido' })}</div>`;
    const fm = it.freq_modo || '';
    const dm = it.dur_modo || '';
    const freqExtra = fm === 'intervalo' ? numero(i, 'freq_n', 'De quantas em quantas horas', 48) : fm === 'vezes' ? numero(i, 'freq_n', 'Quantas vezes ao dia', 48)
      : fm === 'se_precisar' ? campo(i, 'freq_texto', 'freq_texto', 'Quando e até quanto', { max: R.LIMITES.freq_texto, ph: 'Ex.: dor ou febre, no máximo de 6 em 6 horas' })
        : fm === 'outra' ? campo(i, 'freq_texto', 'freq_texto', 'Escreva a frequência', { max: R.LIMITES.freq_texto, ph: 'Ex.: à noite, ao deitar' }) : '';
    const durExtra = dm === 'dias' ? numero(i, 'dur_n', 'Quantos dias', 365) : dm === 'outra' ? campo(i, 'dur_texto', 'dur_texto', 'Escreva a duração', { max: R.LIMITES.dur_texto, ph: 'Ex.: até acabar o frasco' }) : '';
    return `<fieldset class="md-rxitem rx-item" data-rxitem="${i}"><legend>Medicamento ${n}</legend>
      ${tipo}${nome}
      <div class="rx-linha">${campo(i, 'dose', 'dose', `Dose por vez${OPT}`, { max: R.LIMITES.dose, ph: 'Ex.: 1' })}
        ${campo(i, 'unidade', 'unidade', `Unidade${OPT}`, { max: R.LIMITES.unidade, ph: 'Ex.: comprimido', extra: ' list="dRxUnidades"' })}
        ${escolha(i, 'via', 'via', 'Via', R.VIAS, 'Escolha')}</div>
      ${it.via === 'outra' ? campo(i, 'via_outra', 'via_outra', 'Escreva a via', { max: R.LIMITES.via_outra }) : ''}
      <div class="rx-linha">${escolha(i, 'freq_modo', 'frequencia', 'Frequência', R.FREQS, 'Escolha')}${freqExtra}</div>
      <div class="rx-linha">${escolha(i, 'dur_modo', 'duracao', 'Duração', R.DURS, 'Escolha')}${durExtra}</div>
      ${campo(i, 'posologia', 'posologia', 'Modo de usar, por extenso <small class="h">(é o que sai na receita)</small>', { area: true, max: R.LIMITES.posologia, ph: 'O texto aparece aqui quando você preenche a via e a frequência; pode corrigir à mão.' })}
      <p class="tl-small rx-manual" data-rxmanual="${i}"${it.posologia_manual ? '' : ' hidden'}>Texto corrigido à mão: ele não muda mais sozinho quando você mexe nos campos.
        <button class="btn btn-ghost btn-sm" type="button" data-rxauto="${i}"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Voltar ao texto automático</button></p>
      <div class="row2">${campo(i, 'quantidade', 'quantidade', 'Quantidade', { max: R.LIMITES.quantidade, ph: 'Ex.: 1 caixa com 20 comprimidos' })}${campo(i, 'orientacoes', 'observacao', `Observação${OPT}`, { max: R.LIMITES.orientacoes })}</div>
      <p class="rx-trava" data-rxtrava="${i}" role="alert" hidden></p>
      <div class="tl-row rx-acoes">
        <button class="btn btn-ghost btn-sm" type="button" data-rxmover="${i}" data-passo="-1"${i === 0 ? ' disabled' : ''}>Subir<span class="sr"> o medicamento ${n}</span></button>
        <button class="btn btn-ghost btn-sm" type="button" data-rxmover="${i}" data-passo="1"${i === E.itens.length - 1 ? ' disabled' : ''}>Descer<span class="sr"> o medicamento ${n}</span></button>
        <button class="btn btn-ghost btn-sm" type="button" data-rxdup="${i}"><i class="fa-solid fa-copy" aria-hidden="true"></i>Duplicar<span class="sr"> o medicamento ${n}</span></button>
        ${E.itens.length > 1 ? `<button class="btn btn-ghost btn-sm" type="button" data-rxtirar="${i}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i>Tirar<span class="sr"> o medicamento ${n}</span></button>` : ''}
      </div></fieldset>`;
  }
  function desenharItens() {
    const box = q('#dRxItems');
    if (!box) return;
    box.innerHTML = `<datalist id="dRxUnidades">${R.UNIDADES.map(([u]) => `<option value="${esc(u)}"></option>`).join('')}</datalist>${E.itens.map(itemHtml).join('')}`;
    marcar();
  }
  function desenharItem(i, foco) {
    const velho = q(`[data-rxitem="${i}"]`);
    if (!velho) return desenharItens();
    velho.outerHTML = itemHtml(E.itens[i], i);
    marcar();
    if (foco) q(`#${CSS.escape(foco)}`)?.focus();
  }
  // A barra de cima (salvo, modelos) e a caixa de modelos / receitas emitidas.
  function desenharBarra() {
    const barra = q('#dRxBar');
    if (!barra) return;
    barra.hidden = !E.banco;
    if (!E.banco) { barra.innerHTML = ''; return; }
    const emit = E.emitidas.length;
    barra.innerHTML = `<p class="rx-salvo" id="dRxSalvo" role="status">${esc(E.estado)}</p>
      <div class="tl-row">
        <button class="btn btn-ghost btn-sm" type="button" data-rxcaixa="usar" aria-expanded="${E.caixa === 'usar'}"><i class="fa-solid fa-list" aria-hidden="true"></i>Usar um modelo${emit ? ' ou repetir' : ''}</button>
        <button class="btn btn-ghost btn-sm" type="button" data-rxcaixa="salvar" aria-expanded="${E.caixa === 'salvar'}"${E.podeEditar ? '' : ' disabled'}><i class="fa-solid fa-plus" aria-hidden="true"></i>Salvar como modelo</button>
      </div>
      <div class="rx-caixa" id="dRxCaixa"${E.caixa ? '' : ' hidden'}>${caixaHtml()}</div>`;
  }
  function caixaHtml() {
    if (E.caixa === 'salvar') {
      return `<div class="fld"><label for="dRxModeloNome">Nome do modelo</label><input id="dRxModeloNome" maxlength="80" placeholder="Ex.: dor de garganta" aria-describedby="dRxModeloErr">
          <span class="err" id="dRxModeloErr" role="alert"></span></div>
        <p class="tl-small">O modelo guarda só os medicamentos desta tela, sem nada do paciente.</p>
        <div class="tl-row"><button class="btn btn-primary btn-sm" type="button" data-rxmodelo="gravar">Salvar modelo</button><button class="btn btn-ghost btn-sm" type="button" data-rxcaixa="">Cancelar</button></div>`;
    }
    if (E.caixa !== 'usar') return '';
    const modelos = E.modelos === null ? '<p class="tl-muted">Carregando seus modelos…</p>'
      : !E.modelos.length ? '<p class="tl-muted">Você ainda não tem modelos. Monte uma receita e toque em “Salvar como modelo”.</p>'
        : `<ul class="rx-lista">${E.modelos.map((m) => `<li><span><b>${esc(m.nome)}</b> <small class="h">${m.conteudo.itens.length === 1 ? '1 medicamento' : `${m.conteudo.itens.length} medicamentos`}</small></span>
            <span class="tl-row"><button class="btn btn-ghost btn-sm" type="button" data-rxusar="${esc(m.id)}">Usar<span class="sr"> o modelo ${esc(m.nome)}</span></button>
            <button class="btn btn-ghost btn-sm" type="button" data-rxapagar="${esc(m.id)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i>Apagar<span class="sr"> o modelo ${esc(m.nome)}</span></button></span></li>`).join('')}</ul>`;
    const emitidas = E.emitidas.length ? `<h4>Receitas já emitidas nesta consulta</h4><ul class="rx-lista">${E.emitidas.map((e, i) => `<li><span>${e.emitidaEm ? `Emitida às ${esc(HORA.format(new Date(e.emitidaEm)))}` : 'Emitida'}${e.cancelada ? ' (cancelada)' : ''}
        <small class="h">${e.conteudo.itens.length === 1 ? '1 medicamento' : `${e.conteudo.itens.length} medicamentos`}</small></span>
        <button class="btn btn-ghost btn-sm" type="button" data-rxrepetir="${i}">Repetir<span class="sr"> esta receita</span></button></li>`).join('')}</ul>` : '';
    return `<h4>Seus modelos</h4>${modelos}${emitidas}<p class="tl-small">Os medicamentos entram depois dos que já estão na tela. Confira tudo antes de emitir.</p>
      <div class="tl-row"><button class="btn btn-ghost btn-sm" type="button" data-rxcaixa="">Fechar</button></div>`;
  }
  // Itens com nome da lista de controle: marca o cartão e mostra o aviso geral.
  function marcar() {
    const lista = bate();
    for (const p of ctx.raiz()?.querySelectorAll('[data-rxtrava]') || []) {
      const b = lista.find((x) => x.n === Number(p.dataset.rxtrava) + 1);
      const t = b ? `“${b.termo}” está na lista de controle (${R.LISTA_ROTULO[b.lista]}): este item não sai pelo IMED.` : '';
      if (p.textContent !== t) p.textContent = t;
      p.hidden = !b;
    }
    const box = q('#dRxLista');
    if (box) {
      const t = R.textoBloqueio(lista);
      const alvo = box.querySelector('[data-rxlistatexto]');
      if (alvo && alvo.textContent !== t) alvo.textContent = t;
      box.hidden = !lista.length;
    }
    const aviso = q('#dRxAvisoLista');
    if (aviso) aviso.hidden = !E.banco;
  }
  function dizer(t) {
    E.estado = t;
    const el = q('#dRxSalvo');
    if (el && el.textContent !== t) el.textContent = t;
  }

  /* ---------- salvar sozinho ---------- */
  function mudou({ salvar = true } = {}) {
    marcar();
    ctx.aoMudar();
    if (!salvar || !E.banco || !E.podeEditar || !E.id) return;
    clearTimeout(E.timer);
    E.timer = setTimeout(() => { E.timer = null; salvarAgora(); }, ESPERA_MS);
  }
  // Uma gravação por vez, na ordem. Devolve true se o que está na tela ficou salvo (ou não havia o que salvar).
  function salvarAgora() {
    clearTimeout(E.timer);
    E.timer = null;
    const id = E.id;
    const seq = E.seq;
    E.fila = E.fila.then(async () => {
      if (!E.banco || !E.podeEditar || !id || seq !== E.seq) return true;
      const c = atual();
      const txt = JSON.stringify(c);
      if (txt === E.salvo || (E.versao === 0 && R.conteudoVazio(c))) return true;
      dizer('Salvando…');
      try {
        const r = await ctx.rpc('ws_receita_salvar', { p_consulta: id, p_conteudo: c, p_versao: E.versao });
        if (seq !== E.seq) return true;
        if (r?.ok) { E.versao = r.versao; E.salvo = txt; dizer(`Rascunho salvo às ${HORA.format(new Date())}`); return true; }
        if (r?.erro === 'versao_conflito') {
          // Outra aba salvou (ou emitiu) antes: a tela passa a mostrar o que está no servidor.
          E.versao = Number.isInteger(r.versao) ? r.versao : 0;
          if (r.conteudo) { const s = R.conteudo(r.conteudo.itens, r.conteudo.observacao); usar(s.itens, s.observacao, { salvar: false }); E.salvo = JSON.stringify(atual()); }
          else { E.salvo = ''; recarregar(); }
          dizer(R.erroTexto('versao_conflito'));
          ctx.toast(R.erroTexto('versao_conflito'));
          return false;
        }
        if (r?.erro === 'prazo_encerrado' || r?.erro === 'forbidden') { E.podeEditar = false; desenharBarra(); }
        dizer(`Não salvou: ${R.erroTexto(r?.erro)}`);
        return false;
      } catch (err) {
        if (ctx.perdeuSessao(err)) return false;
        dizer('Não salvou (sem conexão?). Tentaremos de novo quando você mexer na receita.');
        return false;
      }
    });
    return E.fila;
  }
  function usar(itens, observacao, { salvar = true } = {}) {
    E.itens = (Array.isArray(itens) && itens.length ? itens : [R.itemNovo()]).map((it) => ({ ...it }));
    const o = ctx.obs();
    if (o && observacao !== undefined) o.value = observacao || '';
    desenharItens();
    mudou({ salvar });
  }

  /* ---------- abrir a consulta ---------- */
  async function carregar(id, seq) {
    try {
      const d = R.normalizeAbrir(await ctx.rpc('ws_receita_abrir', { p_consulta: id }));
      if (seq !== E.seq) return;
      if (!d) { E.banco = false; desenharBarra(); marcar(); return; }
      E.banco = true;
      E.podeEditar = d.podeEditar;
      E.versao = d.versao;
      E.emitidas = d.emitidas;
      // O que o médico já digitou enquanto carregava ganha do rascunho salvo (e será salvo por cima, com a versão certa).
      if (d.conteudo && R.conteudoVazio(atual())) { usar(d.conteudo.itens, d.conteudo.observacao, { salvar: false }); E.salvo = JSON.stringify(atual()); }
      dizer(d.conteudo ? 'Rascunho recuperado: confira antes de emitir.' : '');
      desenharBarra();
      marcar();
      ctx.aoMudar();
      const regras = R.normalizeRegras(await ctx.rpc('cat_regras_receita', {}).catch(() => null));
      if (seq !== E.seq) return;
      if (regras) { E.regras = regras; marcar(); }
    } catch (err) {
      if (seq !== E.seq || ctx.perdeuSessao(err)) return;
      // Banco de antes (sem as funções) ou sem rede: a aba funciona como sempre, sem salvar.
      E.banco = false;
      if (!semFuncao(err)) dizer('');
      desenharBarra();
      marcar();
    }
  }
  function recarregar() { if (E.id) carregar(E.id, E.seq); }
  async function carregarModelos() {
    const seq = E.seq;
    try {
      const m = R.normalizeModelos(await ctx.rpc('ws_receita_modelos', {}));
      if (seq !== E.seq) return;
      E.modelos = m || [];
    } catch (err) {
      if (ctx.perdeuSessao(err)) return;
      E.modelos = [];
    }
    desenharBarra();
  }

  /* ---------- eventos ---------- */
  function aoDigitar(e) {
    const t = e.target;
    if (t === ctx.obs()) { mudou(); return; }
    if (!t.dataset?.rxk) return;
    const i = Number(t.dataset.rxn);
    const k = t.dataset.rxk;
    if (!E.itens[i]) return;
    if (k === 'posologia') {
      E.itens[i] = R.comPosologiaDigitada(E.itens[i], t.value);
      const m = q(`[data-rxmanual="${i}"]`);
      if (m) m.hidden = !E.itens[i].posologia_manual;
    } else {
      E.itens[i] = R.comPosologia({ ...E.itens[i], [k]: t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value });
      const p = q(`#dRx${i + 1}-posologia`);
      if (p && !E.itens[i].posologia_manual && p.value !== E.itens[i].posologia) p.value = E.itens[i].posologia;
    }
    mudou();
  }
  function aoTrocar(e) {
    const t = e.target;
    if (!t.dataset?.rxk || (t.tagName !== 'SELECT' && t.type !== 'radio')) return;
    const i = Number(t.dataset.rxn);
    if (!E.itens[i]) return;
    E.itens[i] = R.comPosologia({ ...E.itens[i], [t.dataset.rxk]: t.value });
    desenharItem(i, t.type === 'radio' ? null : t.id);
    if (t.type === 'radio') q(`input[name="${CSS.escape(t.name)}"]:checked`)?.focus();
    mudou();
  }
  function aoClicar(e) {
    const b = e.target.closest('button');
    if (!b || !ctx.raiz()?.contains(b)) return false;
    const d = b.dataset;
    if (b.id === 'dRxAdd') {
      if (E.itens.length >= R.MAX_ITENS) { ctx.toast(`A receita pode ter até ${R.MAX_ITENS} medicamentos.`); return true; }
      E.itens.push(R.itemNovo());
      desenharItens();
      q(`#dRx${E.itens.length}-medicamento`)?.focus();
      mudou();
      return true;
    }
    if (d.rxtirar !== undefined) {
      E.itens.splice(Number(d.rxtirar), 1);
      if (!E.itens.length) E.itens = [R.itemNovo()];
      desenharItens();
      q('#dRxAdd')?.focus();
      mudou();
      return true;
    }
    if (d.rxmover !== undefined) {
      const i = Number(d.rxmover);
      const passo = Number(d.passo);
      E.itens = R.mover(E.itens, i, passo);
      desenharItens();
      const alvo = q(`[data-rxmover="${i + passo}"][data-passo="${passo}"]`);
      (alvo && !alvo.disabled ? alvo : q(`[data-rxmover="${i + passo}"][data-passo="${-passo}"]`))?.focus();
      mudou();
      return true;
    }
    if (d.rxdup !== undefined) {
      if (E.itens.length >= R.MAX_ITENS) { ctx.toast(`A receita pode ter até ${R.MAX_ITENS} medicamentos.`); return true; }
      E.itens = R.duplicar(E.itens, Number(d.rxdup));
      desenharItens();
      q(`#dRx${Number(d.rxdup) + 2}-medicamento`)?.focus();
      mudou();
      return true;
    }
    if (d.rxauto !== undefined) {
      const i = Number(d.rxauto);
      E.itens[i] = R.comPosologia({ ...E.itens[i], posologia_manual: false });
      desenharItem(i, `dRx${i + 1}-posologia`);
      mudou();
      return true;
    }
    if (d.rxcaixa !== undefined) {
      E.caixa = E.caixa === d.rxcaixa ? '' : d.rxcaixa;
      if (E.caixa === 'salvar' && !R.conteudo(E.itens, '').itens.length) { E.caixa = ''; ctx.toast('Preencha pelo menos um medicamento antes de salvar o modelo.'); }
      desenharBarra();
      if (E.caixa === 'usar') { if (E.modelos === null) carregarModelos(); q('#dRxCaixa button')?.focus(); }
      else if (E.caixa === 'salvar') q('#dRxModeloNome')?.focus();
      else q('[data-rxcaixa="usar"]')?.focus();
      return true;
    }
    if (d.rxmodelo === 'gravar') { gravarModelo(b); return true; }
    if (d.rxusar !== undefined || d.rxrepetir !== undefined) {
      const fonte = d.rxusar !== undefined ? E.modelos?.find((m) => m.id === d.rxusar)?.conteudo : E.emitidas[Number(d.rxrepetir)]?.conteudo;
      if (!fonte) return true;
      const antes = R.conteudo(E.itens, '').itens.length;
      E.itens = R.acrescentar(E.itens, fonte.itens);
      if (!E.itens.length) E.itens = [R.itemNovo()];
      E.caixa = '';
      desenharBarra();
      desenharItens();
      q(`#dRx${Math.min(antes + 1, E.itens.length)}-medicamento`)?.focus();
      ctx.toast('Medicamentos incluídos. Confira tudo antes de emitir.');
      mudou();
      return true;
    }
    if (d.rxapagar !== undefined) { apagarModelo(d.rxapagar, b); return true; }
    return false;
  }
  async function gravarModelo(btn) {
    const nome = q('#dRxModeloNome');
    const erro = q('#dRxModeloErr');
    const c = R.conteudo(E.itens, '');
    btn.disabled = true;
    try {
      const r = await ctx.rpc('ws_receita_modelo_salvar', { p_id: null, p_nome: nome.value, p_conteudo: { itens: c.itens, observacao: null } });
      if (!r?.ok) {
        erro.textContent = r?.erro === 'dados_invalidos' && r.campo === 'nome' ? 'Escreva um nome de 2 a 80 letras.' : R.erroTexto(r?.erro);
        nome.setAttribute('aria-invalid', 'true');
        nome.focus();
        return;
      }
      E.caixa = '';
      E.modelos = null;
      desenharBarra();
      ctx.toast('Modelo salvo.');
      q('[data-rxcaixa="usar"]')?.focus();
    } catch (err) {
      if (!ctx.perdeuSessao(err)) erro.textContent = R.erroTexto();
    } finally { btn.disabled = false; }
  }
  async function apagarModelo(id, btn) {
    if (btn.dataset.certeza !== '1') { btn.dataset.certeza = '1'; btn.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i>Apagar mesmo?'; return; }
    btn.disabled = true;
    try {
      const r = await ctx.rpc('ws_receita_modelo_apagar', { p_id: id });
      if (!r?.ok && r?.erro !== 'nao_encontrado') { ctx.toast(R.erroTexto(r?.erro)); btn.disabled = false; return; }
      E.modelos = (E.modelos || []).filter((m) => m.id !== id);
      desenharBarra();
      ctx.toast('Modelo apagado.');
      q('#dRxCaixa button')?.focus();
    } catch (err) {
      if (!ctx.perdeuSessao(err)) ctx.toast(R.erroTexto());
      btn.disabled = false;
    }
  }

  /* ---------- o que o medico.js usa ---------- */
  return {
    aoDigitar, aoTrocar, aoClicar, impresso,
    temBanco: () => E.banco,
    temRascunho: () => !R.conteudoVazio(atual()),
    // Abre a receita da consulta (lê o rascunho salvo). Sem id: só limpa.
    abrir(id) {
      clearTimeout(E.timer);
      Object.assign(E, { id: id || null, seq: E.seq + 1, itens: [R.itemNovo()], banco: false, podeEditar: false, versao: 0, salvo: '', regras: R.regrasPadrao(),
        modelos: null, emitidas: [], timer: null, estado: '', caixa: '' });
      desenharItens();
      desenharBarra();
      if (id) carregar(id, E.seq);
    },
    // Sai da consulta: grava o que estiver esperando e esquece.
    fechar() {
      if (E.timer) salvarAgora();
      E.id = null;
      E.seq += 1;
    },
    // Limpa a tela (depois de emitir, ou "limpar formulário"). Não apaga nada no servidor.
    limpar() {
      E.itens = [R.itemNovo()];
      E.caixa = '';
      desenharItens();
      desenharBarra();
    },
    // Copiar de um documento já emitido (formato impresso).
    deImpresso(payload) {
      usar((Array.isArray(payload?.itens) ? payload.itens : []).map(R.deImpresso), payload?.observacao || '');
    },
    // O que falta ou trava, por campo da tela (as chaves de showDocErrors): passa por cima das frases da receita simples.
    erros() {
      const out = {};
      E.itens.forEach((it, i) => {
        const n = i + 1;
        const o = R.arrumarItem(it);
        if (R.ehManipulado(o) && !o.composicao) out[`itens.${n}.medicamento`] = 'Escreva a fórmula: os componentes e as concentrações.';
        if (!o.via) out[`itens.${n}.via`] = 'Escolha a via.';
        else if (o.via === 'outra' && !o.via_outra) out[`itens.${n}.via`] = 'Escreva a via.';
        if (!o.posologia) out[`itens.${n}.posologia`] = 'Escolha a frequência (o texto se escreve sozinho) ou escreva o modo de usar por extenso.';
        if (!o.dur_modo) out[`itens.${n}.duracao`] = 'Escolha a duração.';
        else if (o.dur_modo === 'dias' && !o.dur_n) out[`itens.${n}.duracao`] = 'Informe por quantos dias (de 1 a 365).';
        else if (o.dur_modo === 'outra' && !o.dur_texto) out[`itens.${n}.duracao`] = 'Escreva a duração.';
      });
      for (const b of bate()) out[`itens.${b.n}.medicamento`] = `“${b.termo}” está na lista de controle (${R.LISTA_ROTULO[b.lista]}): este item não sai pelo IMED. Tire o item ou use a plataforma do CFM.`;
      return out;
    },
    // Emite pelo banco novo. Devolve {ok, id, code} | {erro, texto, campo?}; recusas da receita simples (dados do
    // paciente, endereço...) saem como exceção no formato que o medico.js já trata.
    async emitir({ expect, endereco }) {
      const id = E.id;
      if (!(await salvarAgora())) return { erro: 'nao_salvou', texto: E.estado || R.erroTexto() };
      const r = await ctx.rpc('ws_receita_emitir', { p_consulta: id, p_versao: E.versao, p_expect: expect, p_endereco_residencial: !!endereco });
      if (r?.ok) {
        Object.assign(E, { versao: 0, salvo: '', estado: '' });
        return { ok: true, id: r.id, code: r.code };
      }
      if (r?.erro === 'receita_bloqueada' && r.motivo === 'lista') {
        const regras = R.normalizeRegras(await ctx.rpc('cat_regras_receita', {}).catch(() => null));
        if (regras) { E.regras = regras; marcar(); }
        return { erro: r.erro, texto: R.textoBloqueio(r.itens) || R.erroTexto() };
      }
      if (r?.erro === 'versao_conflito') { recarregar(); return { erro: r.erro, texto: R.erroTexto(r.erro) }; }
      if (r?.erro === 'dados_invalidos' && r.campo) return { erro: r.erro, texto: R.erroTexto(r.erro), campo: R.campoDaTela(r.campo) };
      if (['forbidden', 'sem_rascunho'].includes(r?.erro)) return { erro: r.erro, texto: R.erroTexto(r.erro) };
      throw Object.assign(new Error(r?.erro || 'erro'), { status: 400, data: { message: r?.erro || 'erro', details: r?.detalhe ?? null, hint: r?.dica ?? null } });
    },
    // Depois de emitir: relê as emitidas (para "repetir").
    recarregar,
    cfm: CFM_PRESCRICAO_URL,
  };
}
