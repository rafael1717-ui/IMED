// Aba "Financeiro" do painel da clínica (iMed Pagamentos, fase P2b; arquitetura do pagamento §7.2). Baixada só quando
// a pessoa abre a aba (painel.js). Só LÊ: a situação do recebimento on-line (pag_clinic_status) e o extrato dos
// pagamentos pelo site (pag_clinic_statement, que registra a leitura). As duas funções conferem a permissão no banco
// (financeiro.ver; a equipe do IMED, imed.financeiro.ver) e não mandam NENHUM dado de paciente: o papel Financeiro vê
// valores, exames e datas, nunca um nome. Nenhum valor nasce aqui (regras e textos em financeiro-core.js).
// Hoje nenhuma clínica tem o recebimento on-line: a aba mostra "ainda não disponível" e nada mais. Banco ainda sem as
// funções (migração do pagamento não aplicada): a mesma mensagem. Nada vai para o aparelho (nem localStorage).
import { auth, $, esc, note, loading, friendlyError } from './clinica.js';
import * as F from './financeiro-core.js';

// gen muda a cada vez que a aba é aberta: resposta que chega depois (outra aba, outra clínica) é ignorada.
let GEN = 0;
let S = null;
const icon = (n) => `<i class="fa-solid ${n}" aria-hidden="true"></i>`;
const noFn = (err) => err?.status === 404 || err?.data?.code === 'PGRST202' || err?.data?.code === '42883';
const vivo = (s) => s === S && s.gen === GEN && s.p.isConnected && (s.ctx.ativo ? s.ctx.ativo() : true);
const retry = (id, texto = 'Tentar de novo') => `<div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="${id}">${icon('fa-rotate-right')} ${esc(texto)}</button></div>`;
const TOM = { ok: 'bd-ok', aviso: 'bd-warn', erro: 'bd-err', neutro: '' };

// ctx: { clinic, perms, admin, lost(), ativo() } (o mesmo das outras abas; ativo() diz se a aba ainda é esta).
export function renderFinanceiro(p, ctx) {
  S = { gen: ++GEN, p, ctx, st: null, per: 'mes', de: '', ate: '', seq: 0, extrato: null };
  p.innerHTML = `<div class="fi" id="fiRoot">${loading('Abrindo o financeiro…')}</div>`;
  p.onclick = aoClicar;
  p.onchange = aoMudar;
  p.onsubmit = aoEnviar;
  carregar(S);
}

/* ======================= situação do recebimento ======================= */
async function carregar(s) {
  let raw;
  try {
    raw = await auth.rpc('pag_clinic_status', { p_clinic: s.ctx.clinic.id });
  } catch (err) {
    if (!vivo(s)) return;
    if (s.ctx.lost?.()) return;
    // Banco ainda sem o pagamento: para a clínica é o mesmo que "ainda não disponível" (e é verdade).
    if (noFn(err)) { pintaSituacao(s, null); return; }
    $('#fiRoot', s.p).innerHTML = `${note(esc(friendlyError(err, 'Não foi possível abrir o financeiro agora. Tente de novo em instantes.')), 'err')}${retry('fiRetry')}`;
    return;
  }
  if (!vivo(s)) return;
  if (s.ctx.lost?.()) return;
  const st = F.normalizeStatus(raw);
  if (!st) { $('#fiRoot', s.p).innerHTML = `${note(esc(F.AVISOS.estranho), 'err')}${retry('fiRetry')}`; return; }
  if (st.tipo === 'forbidden') { $('#fiRoot', s.p).innerHTML = note(esc(F.AVISOS.forbidden), 'warn'); return; }
  pintaSituacao(s, st);
}

function pintaSituacao(s, st) {
  s.st = st;
  const e = F.estadoRecebimento(st);
  const cond = e.codigo === 'indisponivel' ? [] : F.condicoes(st);
  const lista = e.codigo === 'analise' || e.codigo === 'desligado' ? F.passos(st) : [];
  const falta = F.faltam(lista);
  const box = $('#fiRoot', s.p);
  box.innerHTML = `<section class="fi-st fi-${e.codigo}" id="fiSituacao" data-estado="${e.codigo}" aria-labelledby="fiStT">
      <p class="fi-k">Recebimento on-line</p>
      <h3 class="ac-h fi-st-t" id="fiStT" tabindex="-1"><span class="fi-st-ic" aria-hidden="true">${icon(e.icone)}</span>${esc(e.titulo)}</h3>
      <p class="fi-st-x">${esc(e.texto)}</p>
      ${cond.length ? `<dl class="fi-cond" id="fiCond">${cond.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
    </section>
    ${lista.length ? `<section class="fi-falta" id="fiFalta" aria-labelledby="fiFaltaT">
      <h3 class="ac-h" id="fiFaltaT">O que falta para ligar${falta ? ` <small class="fi-n">(${falta === 1 ? 'falta 1 passo' : `faltam ${falta} passos`})</small>` : ''}</h3>
      <ol class="fi-passos">${lista.map((x) => `<li class="${x.feito ? 'fi-ok' : 'fi-pend'}" data-passo="${x.id}"><span class="fi-passo-ic" aria-hidden="true">${icon(x.feito ? 'fa-check' : 'fa-clock')}</span>
        <div><b>${esc(x.texto)}</b><span class="bd ${x.feito ? 'bd-ok' : 'bd-warn'}">${x.feito ? 'Feito' : 'Falta'}</span>${x.detalhe ? `<small>${esc(x.detalhe)}</small>` : ''}</div></li>`).join('')}</ol>
    </section>` : ''}
    ${e.codigo === 'indisponivel' ? '' : extratoShell(s)}`;
  if (e.codigo !== 'indisponivel') buscarExtrato(s);
}

/* ======================= extrato ======================= */
function extratoShell(s) {
  const datas = s.per === 'datas';
  return `<section class="fi-ex" id="fiExtrato" aria-labelledby="fiExT">
      <h3 class="ac-h" id="fiExT" tabindex="-1">${icon('fa-list')}Extrato dos pagamentos pelo site</h3>
      <p class="cl-help">Cada linha é um exame pago pelo site, pelo dia do pagamento (horário de São Paulo). Aqui não aparece o nome do paciente: para ver quem é, quem tem acesso à agenda abre o agendamento na aba Agenda.</p>
      <form class="fi-ctl" id="fiPerForm" novalidate aria-label="Período do extrato">
        <div class="cl-field"><label class="cl-lbl" for="fiPer">Período</label><select id="fiPer">${F.PERIODOS.map(([v, n]) => `<option value="${v}"${v === s.per ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="cl-field" id="fiDeBox"${datas ? '' : ' hidden'}><label class="cl-lbl" for="fiDe">Do dia</label><input type="date" id="fiDe" value="${esc(s.de)}" aria-describedby="fiDeErr"><span class="cl-err" id="fiDeErr"></span></div>
        <div class="cl-field" id="fiAteBox"${datas ? '' : ' hidden'}><label class="cl-lbl" for="fiAte">Até o dia</label><input type="date" id="fiAte" value="${esc(s.ate)}" aria-describedby="fiAteErr"><span class="cl-err" id="fiAteErr"></span></div>
        <div class="cl-field fi-go"><button class="btn btn-ghost btn-sm" type="submit" id="fiVer">${icon('fa-rotate-right')} <span id="fiVerT">${datas ? 'Ver período' : 'Atualizar'}</span></button></div>
      </form>
      <p class="sr" id="fiFala" aria-live="polite" aria-atomic="true"></p>
      <div id="fiExBox">${loading('Carregando o extrato…')}</div>
    </section>`;
}

// As datas pedidas ao banco: as do período pronto ou as escolhidas (conferidas antes de ir).
function datasDoPeriodo(s) {
  if (s.per !== 'datas') return F.periodo(s.per);
  const v = F.validarPeriodo($('#fiDe', s.p)?.value || '', $('#fiAte', s.p)?.value || '');
  for (const [k, id] of [['de', 'fiDe'], ['ate', 'fiAte']]) {
    const el = $(`#${id}`, s.p);
    const er = $(`#${id}Err`, s.p);
    if (er) er.textContent = v.errors[k] || '';
    if (el) { if (v.errors[k]) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); }
  }
  if (!v.ok) { $(v.errors.de ? '#fiDe' : '#fiAte', s.p)?.focus(); return null; }
  s.de = v.de; s.ate = v.ate;
  return { de: v.de, ate: v.ate };
}

async function buscarExtrato(s, { falar = false } = {}) {
  const box = $('#fiExBox', s.p);
  if (!box) return;
  const per = datasDoPeriodo(s);
  if (!per) return;
  const seq = ++s.seq;
  // Com um extrato na tela, ele fica (mais claro) até o novo chegar: a página não pula.
  if (s.extrato) { box.classList.add('fi-busy'); box.setAttribute('aria-busy', 'true'); } else box.innerHTML = loading('Carregando o extrato…');
  const pronto = () => { box.classList.remove('fi-busy'); box.removeAttribute('aria-busy'); };
  let raw;
  try {
    raw = await auth.rpc('pag_clinic_statement', { p_clinic: s.ctx.clinic.id, p_de: per.de, p_ate: per.ate });
  } catch (err) {
    if (!vivo(s) || seq !== s.seq) return;
    if (s.ctx.lost?.()) return;
    pronto();
    s.extrato = null;
    box.innerHTML = `${note(esc(noFn(err) ? 'O extrato ainda não está disponível neste banco.' : friendlyError(err, 'Não foi possível carregar o extrato agora. Tente de novo em instantes.')), noFn(err) ? 'warn' : 'err')}${noFn(err) ? '' : retry('fiExRetry')}`;
    return;
  }
  if (!vivo(s) || seq !== s.seq) return;
  if (s.ctx.lost?.()) return;
  pronto();
  const d = F.normalizeExtrato(raw);
  if (!d || d.tipo !== 'ok') {
    s.extrato = null;
    const tipo = d?.tipo || 'estranho';
    box.innerHTML = `${note(esc(F.AVISOS[tipo]), tipo === 'estranho' ? 'err' : 'warn')}${tipo === 'estranho' ? retry('fiExRetry') : ''}`;
    return;
  }
  s.extrato = d;
  box.innerHTML = extratoHtml(s, d);
  if (falar) { const el = $('#fiFala', s.p); if (el) el.textContent = F.resumoExtrato(d); }
}

function extratoHtml(s, d) {
  const tz = s.ctx.clinic.timezone || F.TZ_SP;
  const per = d.de && d.ate ? `${F.fmtDia(d.de)} a ${F.fmtDia(d.ate)}` : '';
  const cab = `<p class="cl-help fi-per" id="fiPerTxt">${per ? `Pagamentos de <b>${esc(per)}</b>.` : ''} Os totais são os que o banco somou para o período.</p>`;
  if (!d.linhas.length) return `${cab}<p class="fi-vazio" id="fiVazio">Nenhum pagamento pelo site neste período.</p>`;
  const cel = (rotulo, html, cls = '') => `<td data-label="${esc(rotulo)}"${cls ? ` class="${cls}"` : ''}><div>${html}</div></td>`;
  const linhas = d.linhas.map((l) => {
    const sit = F.situacaoLinha(l);
    const quando = F.fmtQuando(l.starts_at, tz);
    const extra = [l.meio && F.meioTexto(l.meio), l.cobranca && `pagamento ${l.cobranca}`].filter(Boolean).join(' · ');
    const dev = F.isNum(l.devolvido_cents) && l.devolvido_cents > 0 ? `<small>Devolvido: ${esc(F.fmtBRL(l.devolvido_cents))}</small>` : '';
    const prev = l.meio === 'cartao' && l.previsao && sit.codigo === 'pago' ? `<small>Previsto para ${esc(F.fmtDia(l.previsao))}</small>` : '';
    return `<tr data-sit="${sit.codigo}">
      ${cel('Pago em', `<b>${esc(F.fmtDia(l.dia))}</b>${extra ? `<small>${esc(extra)}</small>` : ''}`)}
      ${cel('Exame', `${esc(F.exameTexto(l))}${quando ? `<small>exame em ${esc(quando)}</small>` : ''}`)}
      ${cel('Valor do exame', esc(F.fmtBRL(l.preco_cents)), 'n')}
      ${cel('Taxa do IMED', esc(F.fmtBRL(l.taxa_cents)), 'n')}
      ${cel('Parte da clínica', `<b>${esc(F.fmtBRL(l.clinica_cents))}</b>`, 'n')}
      ${cel('Situação', `<span class="bd ${TOM[sit.tom]}">${esc(sit.texto)}</span>${dev}${prev}`)}
    </tr>`;
  });
  return `${cab}
    <div class="vs-kpis fi-tot" id="fiTotais">${F.totaisItens(d.totais).map((x) => `<div class="vs-kpi ag-kpi" data-total="${x.id}"><span>${esc(x.label)}</span><b>${esc(x.value)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</div>`).join('')}</div>
    <div class="fi-tbwrap" tabindex="0" role="region" aria-label="Tabela: pagamentos pelo site${per ? `, de ${esc(per)}` : ''}">
      <table class="fi-tb" id="fiTabela"><caption class="sr">Pagamentos pelo site${per ? `, de ${esc(per)}` : ''}: um exame por linha</caption>
        <thead><tr><th scope="col">Pago em</th><th scope="col">Exame</th><th scope="col" class="n">Valor do exame</th><th scope="col" class="n">Taxa do IMED</th><th scope="col" class="n">Parte da clínica</th><th scope="col">Situação</th></tr></thead>
        <tbody>${linhas.join('')}</tbody></table>
    </div>
    <p class="cl-help fi-conta" id="fiConta">${d.linhas.length === 1 ? '1 exame pago' : `${d.linhas.length} exames pagos`} pelo site no período.</p>`;
}

/* ======================= ações ======================= */
function aoClicar(e) {
  const s = S;
  const b = e.target.closest('button');
  if (!s || !b || !s.p.contains(b)) return;
  if (b.id === 'fiRetry') { $('#fiRoot', s.p).innerHTML = loading('Abrindo o financeiro…'); carregar(s); return; }
  if (b.id === 'fiExRetry') buscarExtrato(s, { falar: true });
}
function aoMudar(e) {
  const s = S;
  if (!s || e.target.id !== 'fiPer') return;
  s.per = e.target.value;
  const datas = s.per === 'datas';
  for (const id of ['#fiDeBox', '#fiAteBox']) { const el = $(id, s.p); if (el) el.hidden = !datas; }
  const t = $('#fiVerT', s.p);
  if (t) t.textContent = datas ? 'Ver período' : 'Atualizar';
  // Período pronto: busca na hora. "Escolher as datas": espera a pessoa preencher e pedir.
  if (datas) $('#fiDe', s.p)?.focus(); else buscarExtrato(s, { falar: true });
}
function aoEnviar(e) {
  const s = S;
  if (!s || e.target.id !== 'fiPerForm') return;
  e.preventDefault();
  buscarExtrato(s, { falar: true });
}
