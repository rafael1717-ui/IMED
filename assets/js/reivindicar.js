// "Sua clínica já está no IMED": o responsável acha o estabelecimento do CNES, entra com o e-mail
// e pede para assumir o cadastro. A equipe do IMED confere e aprova no painel.
import {
  auth, $, esc, KINDS, kindName, ROLES, CLAIM_STATUS, isValidCpf, isValidCnpj, maskDoc, maskPhone, onlyDigits,
  isValidPhone, fmtDateTime, loading, note, finishLogin, renderAuth, toast, sessionLost, EXPIRED,
} from './clinica.js';

const state = { place: null, cities: [], submitted: false };
const paramCnes = new URLSearchParams(location.search).get('cnes');

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtCep = (c) => (/^\d{8}$/.test(c || '') ? `${c.slice(0, 5)}-${c.slice(5)}` : '');
const addressOf = (p) => [p.address_line, p.neighborhood, p.city ? `${p.city}${p.uf ? ` - ${p.uf}` : ''}` : '', fmtCep(p.cep)].filter(Boolean).join(' · ');
// Novo local escolhido: limpa o formulário e o aviso do pedido anterior.
function resetClaim() {
  state.submitted = false;
  $('#claimForm').reset();
  $('#claimMsg').innerHTML = '';
  $('#cMsgCount').textContent = '0 de 500 caracteres';
  ['cName', 'cRole', 'cDoc', 'cPhone', 'cAgree'].forEach((id) => setErr(id, ''));
  $('#claimDone').hidden = true;
  $('#claimDoneBox').innerHTML = '';
}

const backUrl = () => `${location.origin}${location.pathname}${state.place ? `?cnes=${state.place.cnes}` : ''}`;

async function cityOf(ibge) {
  const known = state.cities.find((c) => c.ibge === ibge);
  if (known) return { city: known.name, uf: known.uf };
  try {
    const [m] = await auth.select(`municipalities?select=name,uf&ibge=eq.${Number(ibge)}`);
    return m ? { city: m.name, uf: m.uf } : {};
  } catch { return {}; }
}

async function loadPlace(cnes) {
  $('#placeBox').innerHTML = loading('Buscando o estabelecimento…');
  try {
    const [row] = await auth.select(`establishments?select=cnes,name,kind,address_line,neighborhood,cep,city_ibge&cnes=eq.${cnes}`);
    if (!row) {
      state.place = null;
      $('#placeBox').innerHTML = note(`Não encontramos o código CNES ${esc(cnes)} no IMED. Busque pelo nome e pela cidade.`, 'warn');
      showFind();
      return;
    }
    state.place = { ...row, ...(await cityOf(row.city_ibge)) };
  } catch {
    $('#placeBox').innerHTML = note('Não foi possível buscar o estabelecimento agora. Tente de novo ou busque pelo nome.', 'err');
    showFind();
  }
}

function placeCard(p) {
  const icon = KINDS[p.kind]?.icon || 'fa-house-medical';
  return `<div class="cl-place k-${esc(p.kind)}">
      <span class="cl-ic" aria-hidden="true"><i class="fa-solid ${esc(icon)}"></i></span>
      <div><h3>${esc(p.name)}</h3>
        <p>${esc(kindName(p.kind))}${p.kind ? ' · ' : ''}CNES ${esc(p.cnes)}</p>
        ${addressOf(p) ? `<p>${esc(addressOf(p))}</p>` : ''}
      </div>
    </div>`;
}

function renderPlace() {
  const box = $('#placeBox');
  if (!state.place) return;
  box.innerHTML = `${placeCard(state.place)}
    <div class="cl-actions"><button class="btn btn-ghost btn-sm" type="button" id="changePlace">Não é este? Buscar outro</button></div>`;
  $('#changePlace').onclick = () => { showFind(); $('#cityFilter').focus(); };
  $('#changePlace').textContent = state.submitted ? 'Pedir outro estabelecimento' : 'Não é este? Buscar outro';
}

// ---------- busca por nome e cidade ----------
let citiesLoaded = false;
async function showFind() {
  $('#findForm').hidden = false;
  if (citiesLoaded) return;
  citiesLoaded = true;
  try {
    state.cities = (await auth.rpc('imported_cities')) || [];
    fillCities('');
  } catch {
    $('#city').innerHTML = '<option value="">Não foi possível carregar as cidades</option>';
    citiesLoaded = false;
  }
}
function fillCities(filter) {
  const sel = $('#city');
  const cur = sel.value;
  const f = fold(filter).trim();
  const list = state.cities.filter((c) => !f || fold(`${c.name} ${c.uf}`).includes(f));
  sel.innerHTML = `<option value="">${list.length ? 'Escolha a cidade' : 'Nenhuma cidade com esse nome'}</option>`
    + list.map((c) => `<option value="${Number(c.ibge)}">${esc(c.name)} - ${esc(c.uf)}</option>`).join('');
  if (list.some((c) => String(c.ibge) === cur)) sel.value = cur;
  else if (list.length === 1) sel.value = String(list[0].ibge);
}
// Tira os caracteres que mudam o sentido do filtro do banco.
export const cleanTerm = (t) => String(t ?? '').replace(/[*,()%\\"'.:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

async function find(e) {
  e.preventDefault();
  const msg = $('#findMsg');
  const ibge = $('#city').value;
  const term = cleanTerm($('#term').value);
  msg.className = 'cl-msg';
  $('#results').innerHTML = '';
  if (!ibge) { msg.textContent = 'Escolha a cidade.'; msg.classList.add('err'); $('#city').focus(); return; }
  if (term.length < 3) { msg.textContent = 'Digite pelo menos 3 letras do nome.'; msg.classList.add('err'); $('#term').focus(); return; }
  msg.textContent = 'Buscando…';
  $('#findBtn').disabled = true;
  try {
    const rows = await auth.select(`establishments?select=cnes,name,kind,address_line,neighborhood,cep,city_ibge&city_ibge=eq.${Number(ibge)}&name=ilike.*${encodeURIComponent(term)}*&order=name&limit=20`);
    const city = state.cities.find((c) => String(c.ibge) === ibge) || {};
    if (!rows?.length) {
      msg.innerHTML = 'Nada encontrado com esse nome. Tente uma parte menor do nome, como aparece no cadastro oficial.';
      return;
    }
    msg.textContent = rows.length === 20 ? 'Mostrando os 20 primeiros. Digite mais do nome para afinar.' : `${rows.length} encontrado${rows.length > 1 ? 's' : ''}. Escolha o seu:`;
    $('#results').innerHTML = rows.map((r, i) => `<li><button type="button" data-i="${i}">
        <span><b>${esc(r.name)}</b><span>${esc([kindName(r.kind), r.address_line, r.neighborhood].filter(Boolean).join(' · '))}</span></span>
        <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></li>`).join('');
    $('#results').querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const r = rows[Number(b.dataset.i)];
        if (state.place?.cnes !== r.cnes || state.submitted) resetClaim();
        state.place = { ...r, city: city.name, uf: city.uf };
        history.replaceState(history.state, '', `${location.pathname}?cnes=${r.cnes}`);
        $('#findForm').hidden = true;
        $('#results').innerHTML = '';
        msg.textContent = '';
        render();
        const next = auth.user() ? $('#s3') : $('#s2');
        next.scrollIntoView({ block: 'start' });
        (next.querySelector('input, select') || next).focus({ preventScroll: true });
      };
    });
  } catch {
    msg.textContent = 'Não foi possível buscar agora. Tente de novo em instantes.';
    msg.classList.add('err');
  } finally {
    $('#findBtn').disabled = false;
  }
}

// ---------- formulário ----------
function setErr(id, text) {
  const input = $(`#${id}`);
  $(`#${id}Err`).textContent = text || '';
  if (text) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  return !text;
}
export function validateClaim(v) {
  const e = {};
  if (v.claimant_name.length < 2 || !/\s/.test(v.claimant_name)) e.cName = 'Digite seu nome completo.';
  if (!ROLES[v.role]) e.cRole = 'Escolha o seu cargo.';
  if (v.document.length === 11 ? !isValidCpf(v.document) : v.document.length === 14 ? !isValidCnpj(v.document) : true) e.cDoc = 'CPF ou CNPJ inválido. Confira os números.';
  if (!isValidPhone(v.phone)) e.cPhone = 'Celular inválido. Use DDD e número, como (11) 98765-4321.';
  return e;
}

async function submitClaim(e) {
  e.preventDefault();
  const box = $('#claimMsg');
  box.innerHTML = '';
  const row = {
    cnes: state.place.cnes,
    claimant_name: $('#cName').value.trim().replace(/\s+/g, ' '),
    role: $('#cRole').value,
    document: onlyDigits($('#cDoc').value),
    crm: $('#cCrm').value.trim() || null,
    phone: onlyDigits($('#cPhone').value),
    message: $('#cMsg').value.trim() || null,
  };
  const errs = validateClaim(row);
  if (!$('#cAgree').checked) errs.cAgree = 'Marque a declaração para enviar.';
  let first = null;
  for (const id of ['cName', 'cRole', 'cDoc', 'cPhone', 'cAgree']) {
    if (!setErr(id, errs[id]) && !first) first = id;
  }
  if (first) { $(`#${first}`).focus(); return; }
  const btn = $('#claimBtn');
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  try {
    await auth.insert('establishment_claims', row);
    state.submitted = true;
    $('#claimDoneBox').innerHTML = `${note(`<b>Pedido enviado.</b> A equipe do IMED confere os dados e responde pelo contato informado. Pedido para: ${esc(state.place.name)}. Depois da aprovação, você cuida do cadastro na <a href="painel.html">área da clínica</a>.`, 'ok')}
      <div class="cl-actions"><a class="btn btn-primary" href="painel.html">Ir para a área da clínica</a></div>
      <p class="cl-help">Cuida de outro local, como um laboratório? Use “Pedir outro estabelecimento” no passo 1.</p>`;
    render();
    $('#claimDone').focus();
  } catch (err) {
    const code = err?.data?.code;
    const text = String(err?.data?.message || err?.message || '');
    let m;
    if (sessionLost(err)) {
      // A entrada venceu e não foi renovada: mostra de novo o quadro para pedir outro link.
      render();
      $('#flash').innerHTML = note(esc(EXPIRED), 'warn');
      $('#loginEmail')?.focus();
      return;
    }
    if (code === '23505' || err?.status === 409) m = 'Você já tem um pedido em análise para este estabelecimento. A equipe do IMED confere os dados e responde pelo contato informado.';
    else if (/parceiro/i.test(text)) m = 'Este estabelecimento já é parceiro do IMED. Se você faz parte da equipe, peça acesso a quem cuida do cadastro.';
    else if (err?.status === 401 || code === '42501') m = 'Sua entrada expirou. Saia e entre de novo com o link por e-mail.';
    else m = 'Não foi possível enviar agora. Confira a internet e tente de novo.';
    box.innerHTML = note(esc(m), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar pedido';
  }
}

// ---------- pedidos desta conta ----------
async function loadMine() {
  const box = $('#mineBox');
  box.innerHTML = loading();
  try {
    const rows = (await auth.select('establishment_claims?select=id,cnes,status,created_at,decision_note&order=created_at.desc')) || [];
    if (!rows.length) { box.innerHTML = '<p class="cl-help">Você ainda não fez nenhum pedido de cadastro.</p>'; return; }
    const codes = [...new Set(rows.map((r) => r.cnes).filter((c) => /^\d{7}$/.test(c)))];
    let names = {};
    try {
      const est = codes.length ? await auth.select(`establishments?select=cnes,name&cnes=in.(${codes.join(',')})`) : [];
      names = Object.fromEntries((est || []).map((x) => [x.cnes, x.name]));
    } catch { /* sem nomes, mostra o código */ }
    const cls = { pending: 'bd-warn', approved: 'bd-ok', rejected: 'bd-err' };
    box.innerHTML = `<ul class="cl-list">${rows.map((r) => `<li>
        <span><b>${esc(names[r.cnes] || `CNES ${r.cnes}`)}</b><small>Enviado em ${esc(fmtDateTime(r.created_at))}</small>
        ${r.status === 'rejected' && r.decision_note ? `<small>Motivo: ${esc(r.decision_note)}</small>` : ''}
        ${r.status === 'approved' ? '<small><a class="link" href="painel.html">Abrir a área da clínica</a></small>' : ''}</span>
        <span class="bd ${cls[r.status] || ''}">${esc(CLAIM_STATUS[r.status] || r.status)}</span></li>`).join('')}</ul>`;
  } catch {
    box.innerHTML = note('Não foi possível carregar seus pedidos agora.', 'err');
  }
}

function render() {
  renderPlace();
  const logged = !!auth.user();
  $('#s2').hidden = !(state.place || logged);
  renderAuth($('#authBox'), {
    back: backUrl,
    intro: 'Entre com o seu e-mail e a sua senha (ou peça o link de entrada por e-mail, logo abaixo). Use um e-mail que você acessa no dia a dia: é com ele que você vai entrar na área da clínica.',
    onSignOut: () => { toast('Você saiu da sua conta.'); render(); },
    onSignIn: () => { toast('Pronto, você entrou.'); render(); },
  });
  $('#s3').hidden = !(state.place && logged) || state.submitted;
  $('#claimDone').hidden = !(state.submitted && logged);
  $('#mine').hidden = !logged;
  if (logged) loadMine();
}

function wire() {
  $('#findForm').addEventListener('submit', find);
  $('#cityFilter').addEventListener('input', (e) => fillCities(e.target.value));
  $('#claimForm').addEventListener('submit', submitClaim);
  $('#cDoc').addEventListener('input', (e) => { e.target.value = maskDoc(e.target.value); });
  $('#cPhone').addEventListener('input', (e) => { e.target.value = maskPhone(e.target.value); });
  $('#cMsg').addEventListener('input', (e) => { $('#cMsgCount').textContent = `${e.target.value.length} de 500 caracteres`; });
  ['cName', 'cRole', 'cDoc', 'cPhone', 'cAgree'].forEach((id) => $(`#${id}`).addEventListener('change', () => setErr(id, '')));
}

async function init() {
  wire();
  const flash = await finishLogin();
  if (flash) $('#flash').innerHTML = note(esc(flash.text), flash.kind);
  if (paramCnes && /^\d{7}$/.test(paramCnes)) await loadPlace(paramCnes);
  else showFind();
  render();
}
init();
