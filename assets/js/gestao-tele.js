// Painel de gestão: "Teleconsulta: valores e repasse" (decisão do dono em 16/11/2026: consulta R$ 70,00, repasse de
// R$ 35,00 ao médico por teleconsulta atendida). Só a equipe do IMED: os dados vêm de admin_tele_repasses e a mudança
// de admin_tele_valores_definir (migração tele_valores), que conferem a equipe no banco. Nenhum dado de paciente.
// O site ainda não cobra do paciente nem paga o médico: aqui ficam os valores e a conta do repasse, para pagar por fora.
import * as A from './auth.js';
import * as G from './gestao-core.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const semFuncao = (e) => e?.status === 404 || e?.data?.code === 'PGRST202';
const DIA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
const mesDeHoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
let ctx = null;
let mes = '';
let seq = 0;

export function teleShellHtml() {
  return `<section class="cl-card gs-sec gs-tv" id="sec-tele" aria-labelledby="sec-tele-h">
      <h2 id="sec-tele-h"><i class="fa-solid fa-video" aria-hidden="true"></i>Teleconsulta: valores e repasse</h2>
      <p class="cl-note warn gs-honest">O site ainda não cobra a teleconsulta do paciente nem paga o médico. Aqui ficam os valores definidos pelo IMED e a conta do repasse, para a equipe pagar por fora.</p>
      <div id="tvCorpo"><p class="gs-load" role="status">Carregando os valores da teleconsulta…</p></div>
    </section>`;
}
export function startTele(c) { ctx = c; mes = ''; carregar(); }
export function refreshTele() { if (ctx) carregar(); }
export function stopTele() { ctx = null; seq += 1; }

async function carregar({ foco = '' } = {}) {
  const box = $('#tvCorpo');
  if (!box || !ctx) return;
  const n = ++seq;
  let raw;
  try { raw = await A.rpc('admin_tele_repasses', { p_mes: mes || null }); } catch (err) {
    if (n !== seq || ctx.lost(err)) return;
    box.innerHTML = semFuncao(err)
      ? '<p class="cl-note">Esta parte ainda não está ligada no banco. Os valores e o repasse aparecem aqui depois que a atualização do banco for aplicada.</p>'
      : '<p class="cl-note warn" role="alert">Não foi possível carregar os valores agora. Toque em “Atualizar números” para tentar de novo.</p>';
    return;
  }
  if (n !== seq) return;
  if (raw?.erro === 'forbidden') { ctx.forbidden(); return; }
  const d = G.normalizeTeleRepasses(raw);
  if (!d) { box.innerHTML = '<p class="cl-note warn" role="alert">Não foi possível ler os valores agora. Toque em “Atualizar números” para tentar de novo.</p>'; return; }
  mes = d.mes;
  box.innerHTML = corpoHtml(d);
  ligar(d);
  if (foco) $(foco)?.focus();
}

function corpoHtml(d) {
  const v = d.valores;
  const kpi = (rotulo, valor, sub) => `<div class="gs-kpi gs-k-din"><span class="gs-kpi-l">${esc(rotulo)}</span><b class="gs-kpi-v">${esc(valor)}</b><span class="gs-kpi-s">${esc(sub)}</span></div>`;
  const valores = v
    ? `<div class="gs-kpis gs-lista" id="tvValores">${kpi('Valor da consulta', G.fmtBRL(v.preco), 'o paciente ainda não vê nem paga pelo site')}${kpi('Repasse ao médico', G.fmtBRL(v.repasse), 'por teleconsulta atendida')}${kpi('Fica com o IMED', G.fmtBRL(v.imed), 'valor da consulta menos o repasse')}</div>
       ${v.desde ? `<p class="cl-help">Valores em vigor desde ${esc(DIA.format(new Date(v.desde)))}. Cada teleconsulta usa o repasse que valia no dia em que terminou.</p>` : ''}`
    : '<p class="cl-note warn">Ainda não há valor definido para a teleconsulta. Defina abaixo.</p>';
  const linhas = d.medicos.map((m) => `<tr><td data-l="Médico">${esc(m.nome)}</td><td data-l="CRM">${esc(m.crm)}</td><td data-l="Atendidas">${esc(G.fmtInt(m.atendidas))}</td><td data-l="Repasse">${esc(G.fmtBRL(m.repasse))}</td></tr>`).join('');
  const tabela = d.medicos.length
    ? `<div class="gs-tbwrap" tabindex="0" role="region" aria-labelledby="tvMesT"><table class="gs-tb" id="tvTabela">
        <thead><tr><th scope="col">Médico</th><th scope="col">CRM</th><th scope="col">Atendidas</th><th scope="col">Repasse</th></tr></thead>
        <tbody>${linhas}</tbody>
        <tfoot><tr><th scope="row" colspan="2">Total do mês</th><td>${esc(G.fmtInt(d.total.atendidas))}</td><td><b>${esc(G.fmtBRL(d.total.repasse))}</b></td></tr></tfoot></table></div>`
    : '<p class="gs-empty" id="tvVazio">Nenhuma teleconsulta atendida com repasse neste mês.</p>';
  return `${valores}
    <div class="gs-cobh"><h3 id="tvMesT">Repasse de ${esc(G.monthLong(d.mes))}</h3>
      <div class="fld gs-tv-mes"><label for="tvMes">Mês</label><input type="month" id="tvMes" value="${esc(d.mes)}" max="${esc(mesDeHoje())}" min="2026-01"></div></div>
    ${tabela}
    ${d.semValor ? `<p class="cl-note" id="tvSemValor">${esc(G.plural(d.semValor, 'teleconsulta atendida', 'teleconsultas atendidas'))} neste mês antes de haver valor definido: sem repasse calculado.</p>` : ''}
    <p class="cl-help">Atendida = o atendimento começou e a consulta foi encerrada. Conta no mês em que terminou (horário de Brasília). Consulta que o paciente pediu e ninguém atendeu não entra.</p>
    <form id="tvForm" class="gs-new" novalidate aria-labelledby="tvFormT">
      <h3 id="tvFormT">Mudar os valores</h3>
      <div class="row2">
        <div class="fld"><label for="tvPreco">Valor da consulta (R$)</label><input id="tvPreco" inputmode="decimal" maxlength="12" autocomplete="off" aria-describedby="tvPrecoErr" value="${v ? esc(G.centsPlanilha(v.preco)) : ''}"><span class="err" id="tvPrecoErr"></span></div>
        <div class="fld"><label for="tvRepasse">Repasse ao médico por atendida (R$)</label><input id="tvRepasse" inputmode="decimal" maxlength="12" autocomplete="off" aria-describedby="tvRepasseErr" value="${v ? esc(G.centsPlanilha(v.repasse)) : ''}"><span class="err" id="tvRepasseErr"></span></div>
      </div>
      <p class="cl-help">Vale para as teleconsultas atendidas a partir de agora. O que já foi atendido continua com o valor de antes.</p>
      <p class="cl-note" id="tvConfirma" role="status" hidden></p>
      <div class="tl-row"><button class="btn btn-primary" type="submit" id="tvSalvar">Salvar valores</button><button class="btn btn-ghost" type="button" id="tvCancelar" hidden>Cancelar</button></div>
      <p class="cl-note warn" id="tvErro" role="alert" hidden></p>
    </form>`;
}

function ligar() {
  const form = $('#tvForm');
  const erro = (id, t) => { const el = $(`#${id}`); const out = $(`#${id}Err`); out.textContent = t || ''; if (t) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); };
  const desarmar = () => { form.dataset.certeza = ''; $('#tvConfirma').hidden = true; $('#tvCancelar').hidden = true; $('#tvSalvar').textContent = 'Salvar valores'; };
  $('#tvMes').onchange = (e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { mes = e.target.value; carregar({ foco: '#tvMes' }); } };
  for (const id of ['tvPreco', 'tvRepasse']) $(`#${id}`).oninput = () => { erro(id, ''); desarmar(); };
  $('#tvCancelar').onclick = () => { desarmar(); $('#tvPreco').focus(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    $('#tvErro').hidden = true;
    const r = G.valoresTele($('#tvPreco').value, $('#tvRepasse').value);
    erro('tvPreco', r.erros.preco);
    erro('tvRepasse', r.erros.repasse);
    if (!r.ok) { $(r.erros.preco ? '#tvPreco' : '#tvRepasse').focus(); return; }
    // Dois toques: o primeiro mostra por extenso o que vai valer; o segundo grava.
    if (form.dataset.certeza !== '1') {
      form.dataset.certeza = '1';
      $('#tvConfirma').textContent = `Confira: ${r.frase} Toque em “Confirmar” para valer a partir de agora.`;
      $('#tvConfirma').hidden = false;
      $('#tvCancelar').hidden = false;
      $('#tvSalvar').textContent = 'Confirmar';
      return;
    }
    const btn = $('#tvSalvar');
    btn.disabled = true;
    try {
      const res = await A.rpc('admin_tele_valores_definir', { p_preco_centavos: r.preco, p_repasse_centavos: r.repasse });
      if (res?.erro === 'forbidden') { ctx?.forbidden(); return; }
      if (!res?.ok) {
        if (res?.campo === 'preco' || res?.campo === 'repasse') erro(res.campo === 'preco' ? 'tvPreco' : 'tvRepasse', 'O banco não aceitou este valor. Confira.');
        $('#tvErro').textContent = 'Os valores não foram salvos. Confira os campos e tente de novo.';
        $('#tvErro').hidden = false;
        return;
      }
      ctx?.toast?.(res.igual ? 'Os valores já eram esses: nada mudou.' : 'Valores da teleconsulta salvos.');
      await carregar({ foco: '#sec-tele-h' });
    } catch (err) {
      if (ctx?.lost(err)) return;
      $('#tvErro').textContent = 'Não foi possível salvar agora. Confira a internet e tente de novo.';
      $('#tvErro').hidden = false;
    } finally { btn.disabled = false; }
  };
}
