// "Remédios que travam a receita": a lista de controle na mão da equipe do IMED (área do médico, só para admin).
// A receita do IMED não emite item cujo nome tenha uma destas palavras; aqui a equipe vê a lista, lança um nome
// (sempre com a fonte) e retira um nome (sempre com o motivo). Nada é apagado: o retirado fica no histórico.
// Só chama cat_regra_listar, cat_regra_lancar e cat_regra_retirar; o banco confere de novo quem é a pessoa.
// Banco de antes (sem as funções) ou conta que não é da equipe: o quadro não aparece.
import * as R from './receita-core.js';

const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');

// ctx: { rpc, card, box, esc, lost(err) → true se a entrada caiu }
export function montarRegras(ctx) {
  const { rpc, card, box, esc } = ctx;
  const S = { dados: null, falta: false, pedindo: false, retirando: null, aviso: '' };
  const $ = (sel) => box.querySelector(sel);
  const semFuncao = (err) => err?.status === 404 || err?.data?.code === 'PGRST202' || (err?.status === 403 && err?.data?.code === '42501');

  function linha(r) {
    const abrindo = S.retirando === r.id;
    return `<li class="rxr-item" data-id="${esc(r.id)}">
      <div class="rxr-l"><b class="rxr-nome">${esc(r.nome)}</b> <span class="rxr-lista">${esc(R.LISTA_ROTULO[r.lista])}</span>
        <span class="rxr-fonte">Fonte: ${esc(r.fonte || 'não informada')}${r.desde ? ` · desde ${esc(dataBR(r.desde))}` : ''}</span></div>
      ${abrindo ? `<form class="rxr-ret" data-ret novalidate>
          <div class="fld"><label for="rxrMotivo">Por que retirar “${esc(r.nome)}”?</label><input id="rxrMotivo" maxlength="300" autocomplete="off" aria-describedby="rxrMotivoErr"><span class="err" id="rxrMotivoErr"></span></div>
          <div class="tl-row"><button class="btn btn-coral btn-sm" type="submit">Confirmar a retirada</button><button class="btn btn-ghost btn-sm" type="button" data-cancela>Cancelar</button></div>
        </form>`
    : `<button class="btn btn-ghost btn-sm" type="button" data-retirar aria-label="Retirar ${esc(r.nome)} da lista">Retirar</button>`}
    </li>`;
  }
  function render() {
    const d = S.dados;
    if (!d) { box.innerHTML = '<p class="tl-load"><span class="spin" aria-hidden="true"></span>Carregando a lista…</p>'; return; }
    const grupos = R.LISTAS.map((l) => [l, d.ativas.filter((r) => r.lista === l)]).filter(([, rs]) => rs.length);
    box.innerHTML = `
      <p class="tl-small" id="rxrConta">${d.ativas.length === 1 ? '1 nome trava a receita hoje.' : `${d.ativas.length} nomes travam a receita hoje.`}</p>
      ${grupos.map(([l, rs]) => `<h3 class="rxr-g">${esc(R.LISTA_ROTULO[l][0].toUpperCase() + R.LISTA_ROTULO[l].slice(1))} (${rs.length})</h3><ul class="rxr-lst" role="list">${rs.map(linha).join('')}</ul>`).join('')}
      ${d.retiradas.length ? `<details class="rxr-old"><summary>Retirados (${d.retiradas.length})</summary><ul class="rxr-lst" role="list">${d.retiradas.map((r) => `<li class="rxr-item"><div class="rxr-l"><b class="rxr-nome">${esc(r.nome)}</b> <span class="rxr-lista">${esc(R.LISTA_ROTULO[r.lista])}</span><span class="rxr-fonte">Retirado em ${esc(dataBR(r.retiradaEm))}${r.motivo ? `: ${esc(r.motivo)}` : ''}</span></div></li>`).join('')}</ul></details>` : ''}
      <form class="rxr-novo" id="rxrNovo" novalidate>
        <h3 class="rxr-g">Lançar um nome</h3>
        <div class="fld"><label for="rxrNome">Nome (princípio ativo ou marca)</label><input id="rxrNome" maxlength="60" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="rxrNomeErr"><span class="err" id="rxrNomeErr"></span></div>
        <div class="fld"><label for="rxrLista">Lista</label><select id="rxrLista" aria-describedby="rxrListaErr"><option value="">Escolha</option>${R.LISTAS.map((l) => `<option value="${l}">${esc(R.LISTA_ROTULO[l])}</option>`).join('')}</select><span class="err" id="rxrListaErr"></span></div>
        <div class="fld"><label for="rxrFonte">Fonte (norma, bula ou lista oficial)</label><input id="rxrFonte" maxlength="300" autocomplete="off" aria-describedby="rxrFonteErr"><span class="err" id="rxrFonteErr"></span></div>
        <div class="tl-row"><button class="btn btn-primary" type="submit">Lançar na lista</button></div>
      </form>
      <p class="tl-small rxr-msg" id="rxrMsg" role="status">${esc(S.aviso)}</p>`;
  }
  const erroEm = (id, texto) => { const e = $(`#${id}Err`); if (e) e.textContent = texto || ''; const i = $(`#${id}`); if (i) { if (texto) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid'); } };
  const avisar = (t) => { S.aviso = t; const m = $('#rxrMsg'); if (m) m.textContent = t; };

  async function carregar() {
    if (S.falta || S.pedindo) return;
    S.pedindo = true;
    let raw;
    try { raw = await rpc('cat_regra_listar'); } catch (err) {
      S.pedindo = false;
      if (ctx.lost?.(err)) return;
      if (semFuncao(err)) { S.falta = true; card.hidden = true; return; }
      if (!S.dados) { card.hidden = false; box.innerHTML = '<p class="bk-err show">Não foi possível carregar a lista agora. <button class="btn btn-ghost btn-sm" type="button" data-de-novo>Tentar de novo</button></p>'; }
      return;
    }
    S.pedindo = false;
    if (raw?.erro === 'forbidden') { S.falta = true; card.hidden = true; return; }
    const d = R.normalizeRegrasAdmin(raw);
    if (!d) { if (!S.dados) card.hidden = true; return; }
    S.dados = d;
    card.hidden = false;
    render();
  }
  async function chamar(fn, args, campoPadrao) {
    let raw;
    try { raw = await rpc(fn, args); } catch (err) {
      if (ctx.lost?.(err)) return null;
      avisar(R.erroTexto(null));
      return null;
    }
    if (raw?.ok === true) return raw;
    if (raw?.erro === 'dados_invalidos') erroEm({ nome: 'rxrNome', lista: 'rxrLista', fonte: 'rxrFonte', motivo: 'rxrMotivo' }[raw.campo] || campoPadrao, 'O banco não aceitou este campo. Confira e tente de novo.');
    else avisar(R.erroTexto(raw?.erro === 'forbidden' ? 'forbidden_admin' : raw?.erro));
    return null;
  }

  box.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || !box.contains(b)) return;
    if (b.hasAttribute('data-de-novo')) { carregar(); return; }
    const id = b.closest('.rxr-item')?.dataset.id;
    if (b.hasAttribute('data-retirar') && id) { S.retirando = id; S.aviso = ''; render(); $('#rxrMotivo')?.focus(); }
    else if (b.hasAttribute('data-cancela')) { const era = S.retirando; S.retirando = null; render(); box.querySelector(`.rxr-item[data-id="${CSS.escape(era)}"] [data-retirar]`)?.focus(); }
  });
  box.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const bt = f.querySelector('button[type="submit"]');
    if (bt.disabled) return;
    if (f.hasAttribute('data-ret')) {
      const v = R.validarMotivo($('#rxrMotivo').value);
      erroEm('rxrMotivo', v.ok ? '' : v.texto);
      if (!v.ok) { $('#rxrMotivo').focus(); return; }
      const r = S.dados.ativas.find((x) => x.id === S.retirando);
      bt.disabled = true;
      const ok = await chamar('cat_regra_retirar', { p_id: S.retirando, p_motivo: v.motivo }, 'rxrMotivo');
      bt.disabled = false;
      if (!ok) return;
      S.retirando = null;
      S.aviso = `“${r?.nome ?? 'O nome'}” saiu da lista: a receita deixa de travar por ele.`;
      await carregar();
      $('#rxrNome')?.focus();
      return;
    }
    const v = R.validarRegra($('#rxrNome').value, $('#rxrLista').value, $('#rxrFonte').value);
    for (const [campo, id] of [['nome', 'rxrNome'], ['lista', 'rxrLista'], ['fonte', 'rxrFonte']]) erroEm(id, !v.ok && v.campo === campo ? v.texto : '');
    if (!v.ok) { $({ nome: '#rxrNome', lista: '#rxrLista', fonte: '#rxrFonte' }[v.campo]).focus(); return; }
    if (S.dados.ativas.some((r) => r.nome === v.nome)) { erroEm('rxrNome', R.erroTexto('ja_existe')); $('#rxrNome').focus(); return; }
    bt.disabled = true;
    const ok = await chamar('cat_regra_lancar', { p_nome: v.nome, p_lista: v.lista, p_fonte: v.fonte }, 'rxrNome');
    bt.disabled = false;
    if (!ok) { if (!$('#rxrNomeErr').textContent && S.aviso === R.erroTexto('ja_existe')) { erroEm('rxrNome', S.aviso); avisar(''); } return; }
    S.aviso = `“${v.nome}” entrou na lista (${R.LISTA_ROTULO[v.lista]}): a receita passa a travar por ele.`;
    await carregar();
    $('#rxrNome')?.focus();
  });

  return {
    carregar,
    // saiu da conta ou deixou de ser da equipe
    limpar() { S.dados = null; S.falta = false; S.retirando = null; S.aviso = ''; card.hidden = true; box.innerHTML = ''; },
  };
}
