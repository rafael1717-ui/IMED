// Página de cada local (local.html): ficha completa de um estabelecimento do cadastro oficial (?cnes=)
// ou de uma clínica parceira (?id=), só com dados reais. "Horário direto" (iMed Agenda 5.1): parceiro com a venda
// online ligada mostra os horários livres do motor da agenda (agenda_public_info + agenda_slots, no fuso da unidade) e
// o paciente marca sozinho (agenda_book: confere, reserva e confirma de uma vez); os demais recebem pedido de
// agendamento (a clínica ou o IMED liga), como antes.
// Nada é inventado: sem preço, nota ou horário informado, a informação não aparece. Para quem não é parceiro, a
// caixa "Antes de ir: o que perguntar ao ligar" ensina as perguntas (o exame vem de ?exame=, quando há).
import * as G from './geo-core.js';
import * as T from './confianca.js';

const CFG = window.IMED_CONFIG;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const params = new URLSearchParams(location.search);
const SITE = CFG.siteUrl || new URL('./', location.href).href;
const DAYS = 14;
// Rolagem suave só para quem não pediu "reduzir movimento" no aparelho.
const SMOOTH = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';


const S = {
  ref: null,
  place: null,
  rating: null, // { rating, reviews } só quando há avaliações publicadas
  scheduled: null, // null = verificando; true/false (venda online ligada, com horário direto)
  info: null, // agenda_public_info da clínica (modalidade, fuso, procedimentos, pagamento, prazos)
  tz: G.SP_TZ, // fuso da unidade: todos os horários da agenda aparecem nele
  procs: [], // procedimentos que dá para marcar pelo site
  procId: '', // procedimento escolhido
  intent: null, // intenção de marcar (id e código gravados antes do envio)
  exam: '',
  slots: null, // Map dia → [{ iso, time, end }]
  slotsState: 'idle', // idle | loading | ok | error
  day: '',
  chosen: '', // horário escolhido (ISO)
  mode: '', // '' | 'slot' | 'pedido'
  notice: '', // aviso na área de agendamento (ex.: horário ocupado)
  done: null,
  seq: 0,
  report: null, // aviso "Algo errado aqui?": null | 'sending' | 'sent'
};

/* ======================= banco ======================= */
// Como visitante: só a chave publishable (pedido com conta vai pelo auth.js, com o token da pessoa).
const anonHeaders = (extra) => CFG.supabaseHeaders(null, extra);

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${CFG.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: anonHeaders({ ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error(`http ${res.status}`), { status: res.status, data });
  return data;
}
const rest = (path) => request(path);
const rpc = (fn, args) => request(`rpc/${fn}`, { method: 'POST', body: args });

let authMod;
const loadAuth = () => (authMod ??= import('./auth.js').catch(() => null));

/* ======================= carregamento ======================= */
function refFromUrl() {
  const cnes = params.get('cnes');
  const id = params.get('id');
  if (G.isCnesCode(cnes)) return { source: 'cnes', key: cnes };
  if (G.isUuid(id)) return { source: 'imed', key: id.toLowerCase() };
  return null;
}

async function load() {
  const app = $('#app');
  app.setAttribute('aria-busy', 'true');
  app.innerHTML = '<div class="lc-load" role="status"><span class="spin" aria-hidden="true"></span>Carregando informações do local…</div>';
  const paths = G.localPaths(S.ref);
  let row;
  try {
    const [rows, partner] = await Promise.all([
      rest(paths.main),
      paths.partner ? rest(paths.partner).catch(() => []) : null,
    ]);
    // Estabelecimento do CNES que virou parceiro: a página certa é a do parceiro.
    const pid = Array.isArray(partner) ? partner[0]?.id : null;
    if (pid && G.isUuid(pid)) {
      const q = new URLSearchParams({ id: pid });
      if (params.get('exame')) q.set('exame', params.get('exame'));
      location.replace(`local.html?${q}${location.hash}`);
      return;
    }
    row = Array.isArray(rows) ? rows[0] : null;
  } catch {
    return renderError();
  }
  if (!row) return renderNotFound();
  S.place = S.ref.source === 'cnes' ? G.establishmentToPlace(row) : G.clinicToPlace(row);
  const wanted = params.get('exame');
  S.exam = S.place.source === 'imed' && S.place.services.includes(wanted) ? wanted : (S.place.source === 'imed' ? S.place.services[0] ?? '' : '');
  setSeo();
  render();
  loadRating();
  loadReviews();
  checkSchedule();
}

function renderError() {
  const app = $('#app');
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<div class="st lc-st"><div class="ic warn"><i class="fa-solid fa-plug-circle-xmark" aria-hidden="true"></i></div>
    <h1>Não foi possível carregar este local</h1><p>Verifique sua internet e tente de novo em instantes.</p>
    <div class="acts"><button class="btn btn-primary" type="button" data-act="reload"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo</button>
    <a class="btn btn-ghost" href="perto.html">Buscar clínicas</a></div></div>`;
}

function renderNotFound() {
  const app = $('#app');
  app.setAttribute('aria-busy', 'false');
  document.title = 'Local não encontrado · IMED';
  setMeta('robots', 'noindex');
  app.innerHTML = `<div class="st lc-st"><div class="ic"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i></div>
    <h1>Local não encontrado</h1><p>Este endereço não corresponde a nenhum local publicado no IMED. Ele pode ter mudado ou deixado de funcionar.</p>
    <div class="acts"><a class="btn btn-primary" href="perto.html"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>Buscar clínicas perto de você</a></div></div>`;
}

/* ======================= SEO ======================= */
function setMeta(name, content, attr = 'name') {
  let el = $(`meta[${attr}="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, name); document.head.append(el); }
  el.setAttribute('content', content);
}

const canonicalUrl = (p) => SITE + G.localUrl(p);

function setSeo() {
  const p = S.place;
  const title = G.localTitle(p);
  const desc = G.localDescription(p);
  document.title = title;
  setMeta('description', desc);
  setMeta('og:title', title, 'property');
  setMeta('og:description', desc, 'property');
  setMeta('og:url', canonicalUrl(p), 'property');
  $('#canonical').href = canonicalUrl(p);
  writeJsonLd();
}

function writeJsonLd() {
  let el = $('#ld');
  if (!el) { el = document.createElement('script'); el.type = 'application/ld+json'; el.id = 'ld'; document.head.append(el); }
  el.textContent = JSON.stringify(G.localJsonLd(S.place, canonicalUrl(S.place), S.rating)).replace(/</g, '\\u003c');
}

/* ======================= ficha ======================= */
const perto = (p) => `perto.html?local=${encodeURIComponent(p.id)}`;
const fullAddress = (p) => [p.address, p.cep ? `CEP ${p.cep}` : ''].filter(Boolean).join(' · ');
const directions = (p) => {
  const q = [p.address?.replace(/ · /g, ', '), p.cep].filter(Boolean).join(', ');
  if (q) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
  return Number.isFinite(p.lat) ? G.directionsUrl(p) : null;
};

function badgesHTML(p) {
  const b = [];
  if (p.source === 'imed') {
    if (p.is_demo) b.push('<span class="bd bd-demo">Demonstração</span>');
    else b.push('<span class="bd bd-imed"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>Parceiro verificado</span>');
    const seal = S.scheduled ? G.modeSeal(S.info?.mode) : null;
    if (seal) b.push(`<span class="bd bd-agenda" title="${esc(seal.text)}"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i>${esc(seal.label)}</span>`);
  } else {
    b.push('<span class="bd bd-cnes"><i class="fa-solid fa-building-circle-check" aria-hidden="true"></i>Cadastro oficial</span>');
    if (p.hours?.[0] === 'Aberto 24 horas') b.push('<span class="bd bd-ok">24 horas</span>');
    if (p.sus) b.push('<span class="bd bd-sus"><i class="fa-solid fa-hand-holding-medical" aria-hidden="true"></i>Atende SUS</span>');
  }
  return b.join('');
}

function ratingHTML() {
  const r = S.rating;
  if (!r) return '';
  return `<a class="lc-rate" href="#avaliacoes" aria-label="Nota ${G.formatRating(r.rating)} de 5, ${plural(r.reviews, 'avaliação', 'avaliações')}"><i class="fa-solid fa-star" aria-hidden="true"></i>${G.formatRating(r.rating)} <small>(${plural(r.reviews, 'avaliação', 'avaliações')})</small></a>`;
}

function actionsHTML(p) {
  const acts = [];
  const dir = directions(p);
  if (dir) acts.push(`<a href="${esc(dir)}" target="_blank" rel="noopener"><i class="fa-solid fa-route" aria-hidden="true"></i>Como chegar</a>`);
  const tel = p.phone && G.telHref(p.phone);
  if (tel) acts.push(`<a href="${esc(tel)}"><i class="fa-solid fa-phone" aria-hidden="true"></i>Ligar</a>`);
  if (p.whatsapp) acts.push(`<a class="wa" href="${esc(G.whatsappHref(p.whatsapp, 'Olá! Encontrei vocês pelo IMED e gostaria de agendar.'))}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>WhatsApp</a>`);
  if (p.website) acts.push(`<a href="${esc(p.website)}" target="_blank" rel="noopener nofollow"><i class="fa-solid fa-globe" aria-hidden="true"></i>Site</a>`);
  acts.push('<button type="button" data-act="share"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i>Compartilhar</button>');
  if (Number.isFinite(p.lat)) acts.push(`<a href="${esc(perto(p))}"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i>Ver no mapa</a>`);
  return `<div class="dt-acts lc-acts">${acts.join('')}</div>`;
}

function examsHTML(p) {
  if (!p.services.length) {
    const text = p.source === 'imed' ? 'A clínica ainda não informou os exames que faz. Confirme com ela.'
      : 'O cadastro oficial não lista os exames de cada local. Confirme com o estabelecimento ou peça ao IMED para verificar.';
    return `<p>${text}</p>`;
  }
  const items = p.services.map((c) => {
    const ex = G.EXAMS[c];
    const guide = ex?.slug ? ` <a href="exames/${ex.slug}.html#preparo">preparo</a>` : '';
    let right = '';
    if (p.source === 'imed') {
      const v = G.priceFor(p, c);
      const day = v != null ? G.spDateTime(p.priceDates?.[c])?.date : null;
      const when = day ? `<small>informado em ${esc(new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR'))}</small>` : '';
      right = v != null ? `<span>${G.formatPrice(v)}${when}</span>` : '<span class="muted">Preço sob consulta</span>';
    }
    return `<li><b>${esc(ex?.n ?? c)}${guide}</b>${right}</li>`;
  }).join('');
  const src = p.source === 'imed'
    ? 'Exames e preços informados pela clínica ao IMED. Sem preço informado, o valor é passado pela clínica.'
    : p.equip?.exams?.length ? 'Serviços identificados pelo nome do estabelecimento ou pelos aparelhos informados ao cadastro oficial. Confirme com ele.'
      : 'Serviços identificados pelo nome do estabelecimento no cadastro oficial. Confirme com ele.';
  return `<ul class="dt-svc">${items}</ul><p class="src">${src}</p>${equipHTML(p)}`;
}

// Aparelhos em uso informados ao CNES (DATASUS). Nunca diz que o local faz o exame.
function equipHTML(p) {
  const ex = p.source === 'cnes' ? p.equip?.exams ?? [] : [];
  if (!ex.length) return '';
  const comp = G.formatComp(p.equip.competencia);
  const items = ex.map((c) => `<li><b>Aparelho ${esc(G.APARELHO[c])}</b><span>${p.equip.sus.includes(c)
    ? 'O local informou que este aparelho atende pelo SUS' : 'O local informou que este aparelho não atende pelo SUS'}</span></li>`).join('');
  return `<div class="dt-equip" data-equip>
      <h3>Aparelhos informados ao CNES</h3>
      <ul class="dt-svc">${items}</ul>
      <p>${ex.length === 1 ? esc(G.equipNote(p, ex[0])) : `Tem aparelhos em uso (cadastro oficial): ${esc(ex.map((c) => G.EXAMS[c].n.toLowerCase()).join(', '))}. Confirme com o local.`}</p>
      <p class="src">Isso não garante que ele faça o exame para o público: o aparelho pode ser só para internados ou emergência. Fonte: CNES/DATASUS – Ministério da Saúde${comp ? `, competência ${comp}` : ''}. A ligação aparelho → exame é do IMED.</p>
    </div>`;
}

function hoursHTML(p) {
  if (!p.hours) return '<p>Horário não informado. Confirme com o estabelecimento antes de ir.</p>';
  const src = p.hours_source === 'clinica' ? 'Informado pela clínica.'
    : 'Turno informado ao cadastro oficial (CNES), não é o horário exato. Confirme antes de ir.';
  return `<ul class="dt-hours">${p.hours.map((h) => `<li>${esc(h)}</li>`).join('')}</ul><p class="src">${src}</p>`;
}

function careHTML(p) {
  const parts = [];
  if (p.source === 'cnes' && p.susKnown) {
    parts.push(p.sus
      ? '<p class="lc-sus yes"><i class="fa-solid fa-hand-holding-medical" aria-hidden="true"></i><span><b>Atende SUS</b>, segundo o cadastro oficial (CNES).</span></p>'
      : '<p class="lc-sus"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>Segundo o cadastro oficial (CNES), não atende pelo SUS.</span></p>');
  }
  if (p.source === 'imed' && p.insurances?.length) {
    parts.push(`<h3 class="lc-sub">Convênios</h3><div class="dt-chips">${p.insurances.map((s) => `<span class="svc">${esc(s)}</span>`).join('')}</div>
      <p class="src">Convênios informados pela clínica. Confirme a cobertura com ela e com o seu plano.</p>`);
  }
  return parts.length ? section('atendimento', 'fa-id-card', 'Atendimento', parts.join('')) : '';
}

function contactHTML(p) {
  const rows = [];
  const tel = p.phone && G.telHref(p.phone);
  if (tel) rows.push(`<li><i class="fa-solid fa-phone" aria-hidden="true"></i><a href="${esc(tel)}">${esc(p.phone)}</a></li>`);
  if (p.whatsapp) rows.push(`<li><i class="fa-brands fa-whatsapp" aria-hidden="true"></i><a href="${esc(G.whatsappHref(p.whatsapp))}" target="_blank" rel="noopener">WhatsApp da clínica</a></li>`);
  if (p.email && G.isValidEmail(p.email)) rows.push(`<li><i class="fa-solid fa-envelope" aria-hidden="true"></i><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></li>`);
  if (p.website) rows.push(`<li><i class="fa-solid fa-globe" aria-hidden="true"></i><a href="${esc(p.website)}" target="_blank" rel="noopener nofollow">${esc(new URL(p.website).hostname.replace(/^www\./, ''))}</a></li>`);
  const wa = G.onlyDigits(CFG.whatsapp);
  if (wa) rows.push(`<li><i class="fa-brands fa-whatsapp" aria-hidden="true"></i><a class="wa-imed" href="${esc(G.whatsappHref(wa, `Olá! Encontrei "${p.name}" no IMED e gostaria de ajuda para agendar.`))}" target="_blank" rel="noopener">Falar com o IMED no WhatsApp</a></li>`);
  return rows.length ? `<ul class="dt-contact">${rows.join('')}</ul>` : '<p>O estabelecimento não informou telefone nem site. Você pode pedir ao IMED para agendar por você.</p>';
}

function mapHTML(p) {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
    return `<p>${esc(fullAddress(p) || 'Endereço não informado.')}</p><p class="src">O mapa não aparece porque o cadastro não tem a localização exata.</p>`;
  }
  return `<div class="lc-map" id="lcMap" role="region" aria-label="Mapa com a localização de ${esc(p.name)}"></div>
    <p class="lc-addr">${esc(fullAddress(p))}</p>
    ${p.approx ? '<p class="src">Localização aproximada, encontrada pelo endereço.</p>' : ''}`;
}

const section = (id, icon, title, body, extra = '') => `<section class="lc-card dt-sec" id="${id}" aria-labelledby="h-${id}"${extra}>
  <h2 id="h-${id}"><i class="fa-solid ${icon}" aria-hidden="true"></i>${title}</h2>${body}</section>`;

// Exame escolhido na busca (?exame=), para as perguntas "Antes de ir: o que perguntar ao ligar".
const askExam = () => (Object.hasOwn(G.EXAMS, params.get('exame') ?? '') ? params.get('exame') : '');

// Código CNES (7 dígitos) do local: o do cadastro oficial ou o do parceiro que assumiu o cadastro.
const cnesCode = (p) => (p.source === 'cnes' ? p.id.slice(5) : p.cnes);

function noteHTML(p) {
  if (p.source === 'imed') {
    if (p.is_demo) return '<p class="note demo"><i class="fa-solid fa-flask" aria-hidden="true"></i>Clínica de demonstração do IMED: nome e endereço fictícios. Serve para testar o site.</p>';
    const code = G.isCnesCode(cnesCode(p)) ? ` <span class="lc-code">Código CNES ${esc(cnesCode(p))}</span>` : '';
    return `<p class="note"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>Parceiro verificado do IMED: preços, exames e agenda são informados pela própria clínica, que responde por eles. <a class="link" href="como-funciona.html#selo">O que o IMED confere</a>${code}</p>`;
  }
  const when = p.updated_at ? `, atualizados em ${esc(new Date(`${p.updated_at}T12:00:00`).toLocaleDateString('pt-BR'))}` : '';
  const code = G.isCnesCode(cnesCode(p)) ? ` <span class="lc-code">Código CNES ${esc(cnesCode(p))}</span>` : '';
  const cnesLink = p.maps_url ? ` <a class="link" href="${esc(p.maps_url)}" target="_blank" rel="noopener">Ver no CNES</a>` : '';
  return `<p class="note"><i class="fa-solid fa-building-circle-check" aria-hidden="true"></i>Dados do Cadastro Nacional de Estabelecimentos de Saúde (CNES), do Ministério da Saúde${when}. Este estabelecimento ainda não é parceiro do IMED: confirme horários, exames e valores diretamente com ele. ${G.TRUST.cnes} A correção do cadastro oficial é feita pelo próprio estabelecimento, no CNES.${code}${cnesLink}</p>
    <p class="dt-claim"><a class="link" href="reivindicar.html?cnes=${encodeURIComponent(p.id.slice(5))}">É o responsável? Assuma o cadastro</a></p>`;
}

// "Verificado pelo IMED em dd/mm/aaaa": data real da conferência da equipe (clinics.verified_at). Sem data, nada.
function verifiedHTML(p) {
  if (p.source !== 'imed' || p.is_demo) return '';
  const d = T.dateBR(p.verified_at);
  if (!d) return '';
  return `<p class="lc-verified"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i><span>Verificado pelo IMED em ${esc(d)} · <a class="link" href="como-funciona.html#selo">o que conferimos</a></span></p>`;
}

/* ======================= "Algo errado aqui? Avise o IMED" ======================= */
function reportHTML(p) {
  const who = p.source === 'imed'
    ? 'Os dados desta página são informados pela própria clínica. A equipe do IMED confere o seu aviso com ela.'
    : 'A equipe do IMED confere o seu aviso. A correção oficial do cadastro (CNES) é feita pelo próprio estabelecimento, com a secretaria de saúde.';
  const kinds = T.REPORT_KINDS.map(([v, l]) => `<label class="rp-k"><input type="radio" name="tipo" value="${v}"><span>${esc(l)}</span></label>`).join('');
  return section('avisar', 'fa-flag', 'Algo errado aqui? Avise o IMED', `<p>Telefone errado, local fechado, endereço novo ou exame que não é feito? ${who}</p>
    <button class="btn btn-ghost btn-sm lc-rp-open" type="button" data-act="report" aria-expanded="false" aria-controls="rpForm"><i class="fa-solid fa-flag" aria-hidden="true"></i>Avisar o IMED</button>
    <form id="rpForm" class="lc-rp" novalidate hidden>
      <fieldset class="fld" data-f="kind"><legend>O que está errado?</legend><div class="rp-kinds">${kinds}</div><span class="err" id="e-kind"></span></fieldset>
      <div class="fld" data-f="note"><label for="rpNote">Quer explicar? <small class="h">(opcional, até ${T.REPORT_NOTE_MAX} caracteres)</small></label>
        <textarea id="rpNote" name="nota" maxlength="${T.REPORT_NOTE_MAX}" placeholder="Ex.: o número certo é (11) 3333-4444. Não escreva dados de saúde."></textarea><span class="err" id="e-note"></span></div>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="bk-err" id="rpErr" role="alert"></p>
      <div class="lc-book-acts"><button class="btn btn-primary" type="submit" id="rpBtn"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i>Enviar aviso</button></div>
    </form>
    <p class="rp-ok" id="rpOk" role="status" tabindex="-1" hidden></p>`);
}

async function sendReport(form) {
  const fd = new FormData(form);
  const v = { kind: String(fd.get('tipo') ?? ''), note: String(fd.get('nota') ?? '') };
  const errs = T.validateReport(v);
  for (const f of ['kind', 'note']) {
    $(`[data-f="${f}"]`, form)?.classList.toggle('bad', !!errs[f]);
    $(`#e-${f}`, form).textContent = errs[f] ?? '';
  }
  const err = $('#rpErr', form);
  err.classList.remove('show');
  if (Object.keys(errs).length) { $(errs.kind ? 'input[name="tipo"]' : '#rpNote', form)?.focus(); return; }
  const finish = (text) => {
    S.report = 'sent';
    form.hidden = true;
    $('[data-act="report"]')?.remove();
    const ok = $('#rpOk');
    ok.innerHTML = `<i class="fa-solid fa-circle-check" aria-hidden="true"></i>${esc(text)}`;
    ok.hidden = false;
    ok.focus();
  };
  if (fd.get('website')) return finish(T.REPORT_MSG.ok);
  const btn = $('#rpBtn', form);
  btn.disabled = true;
  btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Enviando…';
  S.report = 'sending';
  let res;
  try { res = await rpc('report_place_issue', T.reportArgs(S.place, v)); } catch { res = 'error'; }
  // 'limite' (muitos avisos novos de todo mundo ao mesmo tempo): o aviso NÃO foi gravado, então não agradece como se
  // tivesse sido; mostra o motivo e deixa tentar de novo.
  if (res === 'ok') return finish(T.REPORT_MSG.ok);
  S.report = null;
  err.textContent = T.REPORT_MSG[res] ?? T.REPORT_MSG.error;
  err.classList.add('show');
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo';
}

function render() {
  const p = S.place;
  const k = G.KINDS[p.kind];
  const where = [p.city && p.uf ? `${p.city} - ${p.uf}` : p.city].filter(Boolean).join('');
  const app = $('#app');
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `
  <nav class="lc-crumbs" aria-label="Você está em"><a href="./">Início</a><i class="fa-solid fa-chevron-right" aria-hidden="true"></i><a href="${esc(Number.isFinite(p.lat) ? perto(p) : 'perto.html')}">Perto de mim</a><i class="fa-solid fa-chevron-right" aria-hidden="true"></i><span aria-current="page">${esc(p.name)}</span></nav>
  <div class="lc-grid">
    <section class="lc-card lc-head" aria-labelledby="lcName">
      <div class="dt-top"><span class="pc-ic k-${p.kind}" aria-hidden="true"><i class="fa-solid ${k.icon}"></i></span>
        <div style="min-width:0"><div class="pc-badges" id="lcBadges">${badgesHTML(p)}</div>
          <h1 id="lcName">${esc(p.name)}</h1>
          <p>${esc(k.n)}${where ? ` · ${esc(where)}` : ''}<span id="lcRate">${S.rating ? ` · ${ratingHTML()}` : ''}</span></p>
          <p>${esc(fullAddress(p) || 'Endereço não informado')}</p>
          ${p.legal_name && p.legal_name !== p.name ? `<p class="src">Razão social: ${esc(p.legal_name)}</p>` : ''}
          ${verifiedHTML(p)}
        </div></div>
      ${actionsHTML(p)}
      ${p.source === 'imed' ? '' : G.callQuestionsHTML(p, askExam())}
      ${G.sosHTML()}
    </section>
    <aside class="lc-card lc-book" id="agendar" aria-labelledby="h-agendar" tabindex="-1"></aside>
    <div class="lc-rest">
      ${p.description ? section('sobre', 'fa-circle-info', 'Sobre', `<p>${esc(p.description)}</p>`) : ''}
      ${section('exames', 'fa-notes-medical', p.source === 'imed' ? 'Exames e preços' : 'Serviços', examsHTML(p))}
      ${p.specialties.length ? section('especialidades', 'fa-user-doctor', 'Especialidades', `<div class="dt-chips">${p.specialties.map((s) => `<span class="svc">${esc(s)}</span>`).join('')}</div>`) : ''}
      ${section('horario', 'fa-clock', 'Horário de funcionamento', hoursHTML(p))}
      ${careHTML(p)}
      ${section('localizacao', 'fa-location-dot', 'Localização', mapHTML(p))}
      ${section('contato', 'fa-address-book', 'Contato', contactHTML(p))}
      ${section('avaliacoes', 'fa-star', 'Avaliações', '', ' hidden')}
      ${noteHTML(p)}
      ${p.is_demo ? '' : reportHTML(p)}
    </div>
  </div>`;
  renderBooking();
  drawMap();
}

// O mapa fica no fim do cartão: o Leaflet (com o CSS dele) e as imagens do mapa só são baixados quando ele
// chega perto da tela. Assim o nome e os dados do local aparecem antes, sem esperar ~45 KB de mapa.
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  leafletP ??= Promise.all([['link', 'assets/vendor/leaflet/leaflet.css'], ['script', 'assets/vendor/leaflet/leaflet.js']].map(([tag, url]) => new Promise((ok, fail) => {
    const el = document.createElement(tag);
    if (tag === 'link') { el.rel = 'stylesheet'; el.href = url; } else el.src = url;
    el.onload = ok; el.onerror = fail;
    document.head.append(el);
  }))).catch((e) => { leafletP = null; throw e; });
  return leafletP;
}

function drawMap() {
  const el = $('#lcMap');
  if (!el) return;
  const start = () => loadLeaflet().then(() => paintMap(el)).catch(() => { /* sem mapa: o endereço continua no cartão */ });
  if (!('IntersectionObserver' in window)) return start();
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '200px 0px' });
  io.observe(el);
}

function paintMap(el) {
  const p = S.place;
  if (!el.isConnected || el._leaflet_id || !window.L) return;
  const mobile = matchMedia('(max-width: 899px)').matches;
  const map = L.map(el, { scrollWheelZoom: false, dragging: !mobile, tap: false, zoomControl: true, attributionControl: true }).setView([p.lat, p.lng], 16);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.tileLayer(CFG.map.tiles, { maxZoom: CFG.map.maxZoom, attribution: CFG.map.attribution }).addTo(map);
  const pin = '<svg viewBox="0 0 32 42" aria-hidden="true"><path d="M16 40.5s12.5-13.6 12.5-23.6C28.5 9.6 22.9 4 16 4S3.5 9.6 3.5 16.9c0 10 12.5 23.6 12.5 23.6z"/></svg>';
  L.marker([p.lat, p.lng], {
    icon: L.divIcon({ className: 'mk-wrap', iconSize: [32, 42], iconAnchor: [16, 41], html: `<span class="mk on k-${p.kind}${p.source === 'imed' ? ' mk-imed' : ''}">${pin}<i class="fa-solid ${G.KINDS[p.kind].icon}" aria-hidden="true"></i></span>` }),
    title: p.name, alt: p.name, keyboard: false,
  }).addTo(map);
}

/* ======================= avaliações ======================= */
async function loadRating() {
  try {
    const rows = await rpc('place_ratings', { p_keys: [S.place.id] });
    const r = (Array.isArray(rows) ? rows : []).find((x) => x.place_key === S.place.id);
    const rating = Number(r?.rating), reviews = Number(r?.reviews);
    if (!r || !Number.isFinite(rating) || !(reviews > 0)) return;
    S.rating = { rating, reviews };
    $('#lcRate').innerHTML = ` · ${ratingHTML()}`;
    const h = $('#h-avaliacoes');
    if (h) h.innerHTML = `<i class="fa-solid fa-star" aria-hidden="true"></i>Avaliações <span class="dt-rate">${G.formatRating(rating)} <small>(${plural(reviews, 'avaliação', 'avaliações')})</small></span>`;
    writeJsonLd();
  } catch { /* sem nota: nada aparece */ }
}

const STARS = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
async function loadReviews() {
  let rows = [];
  try { rows = await rpc('place_reviews', { p_key: S.place.id, p_limit: 10 }); } catch { rows = []; }
  rows = (Array.isArray(rows) ? rows : []).filter((r) => r.rating >= 1 && r.rating <= 5);
  const el = $('#avaliacoes');
  if (!el || !rows.length) return;
  el.insertAdjacentHTML('beforeend', `<ul class="dt-reviews">${rows.map((v) => {
    const n = Math.round(Number(v.rating));
    const when = v.created_at ? new Date(v.created_at).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' }) : '';
    const who = String(v.author_name ?? '').trim().split(/\s+/)[0];
    return `<li><div class="rv-top"><span class="rv-stars" role="img" aria-label="Nota ${n} de 5">${STARS(n)}</span><span class="rv-who">${esc(who || 'Paciente')}${when ? ` · ${esc(when)}` : ''}</span></div>${v.comment ? `<p>${esc(v.comment)}</p>` : ''}</li>`;
  }).join('')}</ul><p class="src">Avaliações de pacientes que fizeram o pedido pelo IMED e tiveram o atendimento concluído. <a class="link" href="como-funciona.html#avaliacoes">Como funcionam</a></p>`);
  el.hidden = false;
}

/* ======================= agenda ======================= */
const canBookOnline = (p) => p.source === 'imed' && p.accepts_online_booking;
const currentProc = () => S.procs.find((x) => x.id === S.procId) ?? null;

// Anúncio para o leitor de tela (região viva do local.html), sem mexer no foco.
function announce(text) {
  const el = $('#lcLive');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 60);
}

// Horário direto só para clínica com a venda online ligada numa modalidade que confirma na hora (geo-core
// bookableProcedures); qualquer outra resposta (ou falha) deixa a página no pedido, como antes.
async function checkSchedule() {
  const p = S.place;
  if (!canBookOnline(p)) { S.scheduled = false; renderBooking(); return afterBookingReady(); }
  let info = null;
  try { info = await rpc('agenda_public_info', { p_clinic: p.clinic_id }); } catch { info = null; }
  const procs = G.bookableProcedures(info);
  S.scheduled = procs.length > 0;
  if (S.scheduled) {
    S.info = info;
    S.tz = G.validTz(info.timezone);
    S.procs = procs;
    S.procId = G.pickProcedure(procs, params.get('exame') || S.exam)?.id ?? '';
    S.mode = 'slot';
    $('#lcBadges').innerHTML = badgesHTML(p);
    loadSlots();
  }
  renderBooking();
  afterBookingReady();
}

function afterBookingReady() {
  if (location.hash === '#agendar') $('#agendar')?.scrollIntoView({ block: 'start' });
}

async function loadSlots() {
  const seq = ++S.seq;
  S.slotsState = 'loading';
  S.chosen = '';
  renderBooking();
  const now = Date.now();
  try {
    const rows = await rpc('agenda_slots', { p_clinic: S.place.clinic_id, p_procedure: S.procId, p_from: G.zonedDate(0, now, S.tz), p_to: G.zonedDate(DAYS - 1, now, S.tz) });
    if (seq !== S.seq) return;
    S.slots = G.groupSlots(rows, S.tz);
    S.slotsState = 'ok';
    if (!S.slots.has(S.day)) S.day = [...S.slots.keys()][0] ?? '';
  } catch {
    if (seq !== S.seq) return;
    S.slotsState = 'error';
  }
  renderBooking();
  const n = S.slotsState === 'ok' ? [...S.slots.values()].reduce((a, l) => a + l.length, 0) : 0;
  if (S.slotsState === 'ok') announce(n ? `${plural(n, 'horário livre', 'horários livres')} nos próximos ${DAYS} dias. Próximo: ${firstFreeText()}.` : `Sem horários livres nos próximos ${DAYS} dias.`);
}

// Primeiro horário livre do que foi carregado (é o "próximo horário livre" de verdade: vem do motor da agenda).
function firstFreeText() {
  const first = [...(S.slots?.values() ?? [])][0]?.[0];
  return first ? G.nextFreeText(first.iso, S.tz) : '';
}
// "(horário de Manaus)" quando o aparelho mostraria outra hora para este instante.
const tzNote = (iso) => (G.tzDiffers(iso, S.tz) ? ` (${G.tzLabel(S.tz)})` : '');

function examOptions(codes, selected, withPrice) {
  return codes.map((c) => {
    const v = withPrice ? G.priceFor(S.place, c) : null;
    return `<option value="${esc(c)}"${c === selected ? ' selected' : ''}>${esc(G.examLabel(c) + (v != null ? ` · ${G.formatPrice(v)}` : ''))}</option>`;
  }).join('');
}

// Preparo e jejum informados pela clínica para o procedimento (sem nada informado, nada aparece).
function prepHTML(proc) {
  if (!proc || (!proc.prep && !proc.fasting)) return '';
  const parts = [proc.fasting ? `Jejum de ${plural(proc.fasting, 'hora', 'horas')}.` : '', proc.prep].filter(Boolean).join(' ');
  return `<p class="sl-prep"><i class="fa-solid fa-book-medical" aria-hidden="true"></i><span><b>Preparo informado pela clínica:</b> ${esc(parts)}</span></p>`;
}

function slotsHTML() {
  const proc = currentProc();
  const opts = S.procs.map((x) => `<option value="${esc(x.id)}"${x.id === S.procId ? ' selected' : ''}>${esc(G.procedureLabel(x))}</option>`).join('');
  const procSel = `<div class="fld"><label for="slProc">Exame</label><select id="slProc">${opts}</select></div>${prepHTML(proc)}`;
  let body = '';
  if (S.slotsState === 'loading' || S.slotsState === 'idle') {
    body = '<div class="lc-load sm" role="status"><span class="spin" aria-hidden="true"></span>Buscando horários livres…</div>';
  } else if (S.slotsState === 'error') {
    body = `<p class="bk-err show" role="alert">Não foi possível carregar os horários agora.</p>
      <button class="btn btn-ghost btn-sm" type="button" data-act="reload-slots"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo</button>`;
  } else if (!S.slots.size) {
    body = `<p class="lc-empty">Sem horários livres para ${esc(proc?.name ?? 'este exame')} nos próximos ${DAYS} dias.</p>
      <button class="btn btn-primary" type="button" data-act="pedido"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i>Pedir agendamento</button>
      <p class="src">A clínica recebe o pedido e liga para combinar o horário.</p>`;
  } else {
    const days = G.nextDays(DAYS, Date.now(), S.tz);
    const tabs = days.map((d) => {
      const t = G.dayTab(d);
      const n = S.slots.get(d)?.length ?? 0;
      const on = d === S.day;
      // O nome lido pelo leitor de tela começa pelo texto visível ("sex 30/10"), como pede a WCAG (rótulo no nome).
      return `<button class="sl-day${on ? ' on' : ''}" type="button" role="tab" id="tab-${d}" aria-selected="${on}" aria-controls="slTimes" data-day="${d}"${n ? '' : ' disabled'} tabindex="${on ? 0 : -1}"><span>${esc(t.wd)}</span><b>${t.day}</b><span class="sr">, ${n ? plural(n, 'horário livre', 'horários livres') : 'sem horário livre'}</span></button>`;
    }).join('');
    const times = (S.slots.get(S.day) ?? []).map((x) => `<button class="sl-t${x.iso === S.chosen ? ' on' : ''}" type="button" data-slot="${esc(x.iso)}" aria-pressed="${x.iso === S.chosen}">${x.time}</button>`).join('');
    body = `<p class="sl-next"><i class="fa-regular fa-clock" aria-hidden="true"></i><span>Próximo horário livre: <b>${esc(firstFreeText())}</b></span></p>
      <div class="sl-days" role="tablist" aria-label="Dias">${tabs}</div>
      <div class="sl-times" id="slTimes" role="tabpanel" aria-labelledby="tab-${S.day}"><p class="sl-when">${esc(G.formatDateLong(S.day))}</p><div class="sl-grid">${times}</div></div>
      <p class="src">Os horários estão no ${esc(G.tzLabel(S.tz))}, o da clínica. Ao confirmar, o horário fica reservado para você na hora.</p>`;
  }
  const how = S.info?.mode_text ? `<p class="src sl-how">${esc(S.info.mode_text)}</p>` : '';
  return procSel + body + how;
}

function renderBooking() {
  const box = $('#agendar');
  if (!box || !S.place) return;
  const p = S.place;
  if (S.done) return;
  const notice = S.notice ? `<p class="bk-err show" role="alert" id="slNotice" tabindex="-1">${esc(S.notice)}</p>` : '';
  const tel = p.phone && G.telHref(p.phone);
  const wa = G.onlyDigits(CFG.whatsapp);
  const waBtn = wa ? `<a class="btn btn-ghost wa-imed" href="${esc(G.whatsappHref(wa, `Olá! Encontrei "${p.name}" no IMED e gostaria de ajuda para agendar.`))}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>Falar com o IMED no WhatsApp</a>` : '';
  let html;
  if (S.mode === 'slot' && S.chosen) {
    html = `<h2 id="h-agendar"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i>Confirme seu horário</h2>${notice}${formHTML('slot')}`;
  } else if (S.mode === 'slot') {
    html = `<h2 id="h-agendar"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i>Escolha o horário</h2>${notice}${slotsHTML()}`;
  } else if (S.mode === 'pedido') {
    html = `<h2 id="h-agendar"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i>${p.source === 'imed' ? 'Pedir agendamento' : 'Pedir ao IMED para agendar'}</h2>${notice}${formHTML('pedido')}`;
  } else if (canBookOnline(p) && S.scheduled === null) {
    html = '<h2 id="h-agendar"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i>Agendar</h2><div class="lc-load sm" role="status"><span class="spin" aria-hidden="true"></span>Verificando a agenda…</div>';
  } else if (canBookOnline(p) || p.source === 'cnes') {
    const how = p.source === 'imed'
      ? 'A clínica recebe seu pedido pelo IMED e liga para combinar o horário.'
      : 'Este local ainda não é parceiro do IMED. Nossa equipe fala com ele e confirma o horário com você.';
    html = `<h2 id="h-agendar"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i>Agendar</h2><p>${how}</p>${p.source === 'imed' ? '' : G.susHTML()}
      <div class="lc-book-acts"><button class="btn btn-coral" type="button" data-act="pedido"><i class="fa-solid ${p.source === 'imed' ? 'fa-calendar-check' : 'fa-headset'}" aria-hidden="true"></i>Pedir agendamento</button>${waBtn}</div>`;
  } else {
    html = `<h2 id="h-agendar"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i>Agendar</h2><p>Esta clínica ainda não recebe pedidos pelo site.</p>
      <div class="lc-book-acts">${tel ? `<a class="btn btn-primary" href="${esc(tel)}"><i class="fa-solid fa-phone" aria-hidden="true"></i>Ligar para agendar</a>` : ''}${waBtn}</div>`;
  }
  box.innerHTML = html;
  if (S.mode && $('#bookForm', box)) bindForm();
}

// Até quando dá para cancelar pelo site, com o prazo que a clínica informou (sem prazo informado, nada).
function cancelRuleText() {
  const m = S.info?.cancel_until_min;
  if (!Number.isInteger(m) || m < 0) return '';
  return m === 0 ? 'Dá para cancelar pelo site, em Meus pedidos, até o horário marcado.'
    : `Dá para cancelar pelo site, em Meus pedidos, até ${G.durationText(m)} antes do horário.`;
}

function formHTML(mode) {
  const p = S.place;
  const slot = mode === 'slot';
  const imed = p.source === 'imed';
  let top;
  if (slot) {
    const proc = currentProc();
    const price = proc?.price_cents != null ? G.formatPrice(proc.price_cents) : 'Preço sob consulta';
    top = `<div class="sl-chosen"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i><div><b>${esc(proc?.name ?? '')}</b><span>${esc(G.formatSlot(S.chosen, S.tz) + tzNote(S.chosen))}</span>
      <span>${esc([G.durationText(proc?.minutes), price].filter(Boolean).join(' · '))}</span></div>
      <button class="link" type="button" data-act="change-slot">Trocar</button></div>${prepHTML(proc)}`;
  } else {
    const codes = imed ? p.services.filter((c) => G.EXAMS[c]) : Object.keys(G.EXAMS);
    const pre = codes.includes(params.get('exame')) ? params.get('exame') : (imed && codes.includes(S.exam) ? S.exam : '');
    const extra = `<option value="consulta"${pre === 'consulta' ? ' selected' : ''}>Consulta</option><option value="outro">Outro (descrevo nas observações)</option>`;
    top = `<div class="fld" data-f="exam"><label for="bkExam">Exame ou atendimento</label>
        <select id="bkExam" name="exame" required><option value="">Escolha</option>${examOptions(codes, pre, imed)}${extra}</select><span class="err" id="e-exam"></span></div>
      <div class="fld" data-f="date"><label for="bkDate">Data que prefere <small class="h">(até ${G.BOOKING_DAYS} dias)</small></label>
        <input id="bkDate" name="data" type="date" min="${G.spDate(0)}" max="${G.spDate(G.BOOKING_DAYS)}" required><span class="err" id="e-date"></span></div>
      <fieldset class="fld" data-f="period"><legend>Período</legend>
        <div class="seg">${Object.entries(G.PERIODS).map(([v, l]) => `<label><input type="radio" name="periodo" value="${v}"${v === 'qualquer' ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
        <span class="err" id="e-period"></span></fieldset>`;
  }
  // Na marcação direta não há "Observações": o agendamento leva só campos fechados (decisão 22) e nada de dado de saúde.
  const notes = slot ? '' : `<div class="fld" data-f="notes"><label for="bkNotes">Observações <small class="h">(opcional)</small></label>
      <textarea id="bkNotes" name="obs" maxlength="500" placeholder="Ex.: convênio, se precisa de acessibilidade. Não precisa enviar resultados de exames."></textarea><span class="err" id="e-notes"></span></div>`;
  const rules = slot ? [S.info?.payment_text, cancelRuleText()].filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join('') : '';
  return `<form id="bookForm" novalidate data-mode="${mode}">
    ${G.sosHTML(G.TRUST.sosPedido)}
    ${top}
    ${G.forWhomHTML()}
    <div class="fld" data-f="name"><label for="bkName">Seu nome completo</label>
      <input id="bkName" name="nome" autocomplete="name" maxlength="120" required><span class="err" id="e-name"></span></div>
    <div class="fld" data-f="phone"><label for="bkPhone">Celular com DDD</label>
      <input id="bkPhone" name="celular" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(11) 98765-4321" maxlength="16" required><span class="err" id="e-phone"></span></div>
    <div class="fld" data-f="email"><label for="bkEmail">E-mail <small class="h">(opcional)</small></label>
      <input id="bkEmail" name="email" type="email" autocomplete="email" maxlength="254"><span class="err" id="e-email"></span></div>
    ${notes}
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <label class="consent" data-f="consent"><input type="checkbox" name="consent"><span>Autorizo o IMED a usar estes dados, incluindo o exame escolhido, para ${slot ? 'reservar meu horário no estabelecimento' : 'encaminhar meu pedido ao estabelecimento'} e entrar em contato comigo sobre este agendamento. <a href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a></span></label>
    <span class="err lc-cerr" id="e-consent"></span>
    <p class="bk-err" id="bkErr" role="alert"></p>
    ${p.is_demo ? '<p class="note demo"><i class="fa-solid fa-flask" aria-hidden="true"></i>Clínica de demonstração: fica registrado só como teste.</p>' : ''}
    ${imed ? '' : G.susHTML()}
    ${rules ? `<ul class="sl-rules">${rules}</ul>` : ''}
    ${G.trustHTML()}
    <div class="lc-book-acts">
      <button class="btn btn-coral" type="submit" id="bkBtn"><i class="fa-solid ${slot ? 'fa-check' : 'fa-paper-plane'}" aria-hidden="true"></i>${slot ? 'Confirmar agendamento' : 'Enviar pedido'}</button>
      ${slot ? '' : `<button class="btn btn-ghost" type="button" data-act="cancel-pedido">Voltar</button>`}
    </div>
    <p class="src">${slot ? 'Ao tocar em Confirmar, o horário fica reservado e confirmado na agenda da clínica.' : 'O horário só fica garantido depois da confirmação.'}</p>
  </form>`;
}

// Dados já digitados pelo paciente: guardados ao trocar de horário para não precisar digitar de novo.
const DRAFT_FIELDS = ['nome', 'celular', 'email', 'obs', 'outro_nome', 'parentesco'];
const DRAFT_CHECKS = ['consent', 'menor', 'responsavel'];
function draftOf(form) {
  const fd = new FormData(form);
  const d = Object.fromEntries(DRAFT_FIELDS.map((k) => [k, String(fd.get(k) ?? '')]));
  for (const k of DRAFT_CHECKS) d[k] = fd.get(k) === 'on';
  d.para = String(fd.get('para') ?? 'mim');
  return d;
}
function fillDraft(form) {
  const d = S.draft;
  if (!d) return;
  for (const k of DRAFT_FIELDS) if (d[k] && form.elements[k]) form.elements[k].value = d[k];
  for (const k of DRAFT_CHECKS) if (form.elements[k]) form.elements[k].checked = !!d[k];
  const radio = form.querySelector(`input[name="para"][value="${d.para === 'outra' ? 'outra' : 'mim'}"]`);
  if (radio) radio.checked = true;
  G.forWhomToggle(form);
}

function bindForm() {
  const form = $('#bookForm');
  fillDraft(form);
  const phone = $('#bkPhone', form);
  phone.addEventListener('input', () => { phone.value = G.maskPhone(phone.value); });
  const clearError = (e) => {
    const box = e.target.closest('[data-f]');
    if (!box?.classList.contains('bad')) return;
    box.classList.remove('bad');
    const msg = $(`#e-${box.dataset.f}`, form);
    if (msg) msg.textContent = '';
  };
  form.addEventListener('input', clearError);
  form.addEventListener('change', clearError);
  // "O exame é para": mostra os campos de outra pessoa e, para menor de 18 anos, a autorização do responsável.
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'para' && e.target.name !== 'menor') return;
    G.forWhomToggle(form);
    if (e.target.name === 'para' && e.target.value === 'outra') $('#bkOtherName', form)?.focus();
  });
  form.addEventListener('submit', submit);
}

function showErrors(form, errs) {
  for (const f of ['exam', 'date', 'period', 'otherName', 'relationship', 'guardian', 'otherConsent', 'name', 'phone', 'email', 'notes', 'consent']) {
    const box = $(`[data-f="${f}"]`, form);
    box?.classList.toggle('bad', !!errs[f]);
    const msg = $(`#e-${f}`, form);
    if (msg) msg.textContent = errs[f] ?? '';
    // Leitor de tela: o campo diz que está com erro e lê a mensagem junto (aria-describedby).
    for (const el of box ? box.querySelectorAll('input:not([type=hidden]),select,textarea') : []) {
      if (errs[f]) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      const ids = new Set((el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      if (msg?.id) ids.add(msg.id);
      if (ids.size) el.setAttribute('aria-describedby', [...ids].join(' '));
    }
  }
  const first = Object.keys(errs).find((f) => $(`[data-f="${f}"]`, form));
  if (first) {
    const box = $(`[data-f="${first}"]`, form);
    $('input,select,textarea', box)?.focus();
    box?.scrollIntoView({ block: 'center', behavior: SMOOTH });
  }
}

const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Intenção de marcar guardada no aparelho (geo-core INTENT_KEY): sobrevive a recarregar a página no meio do envio.
function readIntent() {
  try { return JSON.parse(localStorage.getItem(G.INTENT_KEY) || 'null'); } catch { return null; }
}
function saveIntent(it) {
  S.intent = it;
  try { localStorage.setItem(G.INTENT_KEY, JSON.stringify(it)); } catch { /* sem armazenamento: fica só na memória */ }
}
function clearIntent() {
  S.intent = null;
  try { localStorage.removeItem(G.INTENT_KEY); } catch { /* ignora */ }
}

async function submit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const slot = form.dataset.mode === 'slot';
  const fd = new FormData(form);
  const proc = slot ? currentProc() : null;
  const v = {
    exam: slot ? proc?.exam || S.exam : fd.get('exame') || '',
    ...(slot ? { slot: S.chosen } : { date: fd.get('data') || '', period: fd.get('periodo') || '' }),
    name: fd.get('nome') || '', phone: fd.get('celular') || '', email: fd.get('email') || '', notes: fd.get('obs') || '', consent: fd.get('consent') === 'on',
    ...G.forWhomValues(fd),
  };
  const errs = G.validateBooking(v);
  if (errs.slot) { S.notice = 'Este horário não está mais disponível. Escolha outro.'; S.draft = draftOf(form); S.chosen = ''; renderBooking(); return; }
  showErrors(form, errs);
  const errBox = $('#bkErr', form);
  errBox.classList.remove('show');
  if (Object.keys(errs).length) return;
  if (fd.get('website')) return done(v, crypto.randomUUID(), false);
  const btn = $('#bkBtn', form);
  btn.disabled = true;
  btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${slot ? 'Confirmando…' : 'Enviando…'}`;
  if (slot) return submitSlot(form, { ...v, procedureId: proc.id, procName: proc.name, prep: [proc.fasting ? `Jejum de ${plural(proc.fasting, 'hora', 'horas')}.` : '', proc.prep].filter(Boolean).join(' '), tz: S.tz });
  const id = crypto.randomUUID();
  try {
    // Código secreto do pedido: fica só neste aparelho; o banco guarda apenas o resumo (SHA-256).
    const token = randomHex(32);
    const row = G.bookingRow(S.place, v, id, { review_token_hash: await sha256Hex(token) });
    const auth = await loadAuth();
    const logged = !!(await auth?.token?.().catch(() => null));
    if (logged) await auth.insert('appointment_requests', row);
    else await request('appointment_requests', { method: 'POST', body: row, headers: { Prefer: 'return=minimal' } });
    saveLocal(G.localAppt(S.place, v, id, token));
    done(v, id, logged);
  } catch (err) {
    const tel = S.place.phone && G.telHref(S.place.phone);
    errBox.innerHTML = (err.status >= 400 && err.status < 500
      ? 'O pedido não foi aceito. Confira a data e os dados e tente de novo.'
      : 'Não foi possível enviar agora. Verifique sua internet e tente de novo.')
      + (tel ? ` Se preferir, <a class="link" href="${esc(tel)}">ligue para o estabelecimento</a>.` : '');
    errBox.classList.add('show');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo';
  }
}

// Marcação direta (agenda_book): a intenção (id e código) é gravada ANTES do envio e reaproveitada no "Tentar de novo"
// do mesmo horário — o banco devolve o mesmo agendamento, sem marcar duas vezes. Horário pego por outra pessoa: id novo
// e os horários de novo.
async function submitSlot(form, v) {
  const p = S.place;
  const errBox = $('#bkErr', form);
  const btn = $('#bkBtn', form);
  const key = G.intentKey({ clinic: p.clinic_id, procedure: v.procedureId, slot: v.slot });
  const intent = G.intentFor(S.intent, key) ?? G.intentFor(readIntent(), key) ?? G.newIntent(key);
  saveIntent(intent);
  const args = G.agendaBookArgs(p, v, intent);
  let res;
  let logged = false;
  try {
    const auth = await loadAuth();
    logged = !!(await auth?.token?.().catch(() => null));
    res = logged ? await auth.rpc('agenda_book', args) : await rpc('agenda_book', args);
  } catch (err) {
    res = G.isSlotTaken(err) ? { status: 'slot_taken' } : null;
  }
  const out = G.bookOutcome(res);
  if (out.kind === 'ok') {
    clearIntent();
    const booked = { ...v, slot: out.slot ? new Date(out.slot).toISOString() : v.slot, slotEnd: out.end || null };
    saveLocal(G.localAppt(p, booked, intent.id, intent.token));
    return done(booked, intent.id, logged);
  }
  if (out.kind === 'taken') {
    clearIntent();
    S.notice = G.BOOK_MSG.taken;
    S.draft = draftOf(form);
    await loadSlots();
    $('#slNotice')?.focus?.();
    $('#agendar')?.scrollIntoView({ block: 'start', behavior: SMOOTH });
    return;
  }
  if (out.kind === 'closed') {
    clearIntent();
    S.draft = draftOf(form);
    S.scheduled = false;
    S.mode = 'pedido';
    S.notice = G.BOOK_MSG.closed;
    $('#lcBadges').innerHTML = badgesHTML(p);
    renderBooking();
    $('#slNotice')?.focus?.();
    return;
  }
  // limite, dados recusados, id já usado para outro horário: id novo na próxima tentativa. Falha de rede ou resposta
  // estranha: a MESMA intenção (o reenvio é seguro).
  if (out.kind !== 'error') clearIntent();
  const tel = p.phone && G.telHref(p.phone);
  errBox.innerHTML = esc(G.BOOK_MSG[out.kind] ?? G.BOOK_MSG.error) + (tel ? ` Se preferir, <a class="link" href="${esc(tel)}">ligue para a clínica</a>.` : '');
  errBox.classList.add('show');
  btn.disabled = false;
  btn.innerHTML = out.kind === 'error' ? '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo' : '<i class="fa-solid fa-check" aria-hidden="true"></i>Confirmar agendamento';
}

function saveLocal(entry) {
  try {
    let list = JSON.parse(localStorage.getItem('imed_appts') || '[]');
    if (!Array.isArray(list)) list = [];
    list = list.filter((x) => !(x && x.id && x.id === entry.id));
    list.unshift(entry);
    localStorage.setItem('imed_appts', JSON.stringify(list.slice(0, 30)));
  } catch { /* armazenamento indisponível: o pedido já foi enviado */ }
}

function downloadIcs(v, id) {
  const ics = G.bookingIcs(S.place, v, id, SITE);
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${G.protocolFromId(id).toLowerCase()}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function done(v, id, logged) {
  const p = S.place;
  S.done = { v, id };
  const guide = G.EXAMS[v.exam]?.slug;
  const d = G.onlyDigits(v.phone);
  const slot = !!v.slot;
  const tz = v.tz || S.tz;
  const when = slot ? G.formatSlot(v.slot, tz) + (G.tzDiffers(v.slot, tz) ? ` (${G.tzLabel(tz)})` : '') : '';
  const box = $('#agendar');
  box.innerHTML = `<div class="ok lc-ok">
    <div class="ic"><i class="fa-solid fa-check" aria-hidden="true"></i></div>
    <h2 id="h-agendar" tabindex="-1">${slot ? `Agendamento confirmado para ${esc(when)}` : 'Recebemos seu pedido!'}</h2>
    <p><b>${esc(p.name)}</b><br>${esc(v.procName || G.examLabel(v.exam))}${slot ? '' : ` · ${esc(G.formatDateLong(v.date))} · ${esc(G.PERIODS[v.period])}`}${v.forOther ? `<br>Para ${esc(String(v.otherName).trim().replace(/\s+/g, ' '))} (${esc(v.relationship)})` : ''}</p>
    <span class="code">${G.protocolFromId(id)}</span>
    <ol>${slot
      ? `<li>Seu horário está reservado e confirmado na agenda da clínica.</li>${v.prep ? `<li>Preparo informado pela clínica: ${esc(v.prep)}</li>` : ''}<li>Chegue com 15 minutos de antecedência, com documento com foto e o pedido médico.</li><li>Se não puder ir, cancele em Meus pedidos${p.phone ? ` ou avise a clínica pelo telefone ${esc(p.phone)}` : ''}.</li>`
      : `<li>${p.source === 'imed' ? 'A clínica recebe o pedido pelo IMED.' : 'A equipe do IMED fala com o estabelecimento.'}</li><li>Você recebe a confirmação do horário no celular terminado em ${esc(d.slice(-4))}.</li><li>No dia, leve documento com foto e o pedido médico.</li>`}</ol>
    ${slot ? '' : '<p class="note" style="text-align:left"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>O horário só fica garantido depois da confirmação.</p>'}
    <div class="trust">${G.gratisHTML()}</div>
    <div class="ok-acts">
      <button class="btn btn-primary" type="button" data-act="ics"><i class="fa-solid fa-calendar-plus" aria-hidden="true"></i>Adicionar à agenda</button>
      ${guide ? `<a class="btn btn-ghost" href="exames/${guide}.html#preparo"><i class="fa-solid fa-book-medical" aria-hidden="true"></i>Como se preparar</a>` : ''}
      <a class="btn btn-ghost" href="./#agenda">Ver meus pedidos</a>
      ${logged ? '' : '<a class="btn btn-ghost" href="conta.html"><i class="fa-solid fa-user-plus" aria-hidden="true"></i>Criar conta para acompanhar</a>'}
    </div>
  </div>`;
  box.scrollIntoView({ block: 'start', behavior: SMOOTH });
  $('#h-agendar', box).focus({ preventScroll: true });
}

/* ======================= compartilhar ======================= */
let toastTimer = 0;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function share() {
  const p = S.place;
  const url = canonicalUrl(p);
  const data = { title: G.localTitle(p), text: `${p.name}${p.address ? ` · ${p.address}` : ''}`, url };
  if (navigator.share) {
    try { await navigator.share(data); return; } catch (err) { if (err?.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copiado. É só colar onde quiser.');
  } catch {
    toast(url);
  }
}

/* ======================= eventos ======================= */
document.addEventListener('click', (e) => {
  const day = e.target.closest('[data-day]');
  if (day && !day.disabled) { S.day = day.dataset.day; S.chosen = ''; renderBooking(); $(`#tab-${S.day}`)?.focus(); return; }
  const s = e.target.closest('[data-slot]');
  if (s) {
    S.chosen = s.dataset.slot;
    S.notice = '';
    renderBooking();
    $('#bkName')?.focus();
    announce(`Horário escolhido: ${G.formatSlot(S.chosen, S.tz)}. Preencha seus dados e confirme.`);
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'reload') load();
  else if (act === 'share') share();
  else if (act === 'copy-questions') G.copyCallQuestions(e.target.closest('.cq'));
  else if (act === 'reload-slots') loadSlots();
  else if (act === 'change-slot') { const f = $('#bookForm'); if (f) S.draft = draftOf(f); S.chosen = ''; renderBooking(); $('.sl-t, .sl-day.on')?.focus(); }
  else if (act === 'pedido') { S.mode = 'pedido'; S.notice = ''; renderBooking(); $('#bkExam')?.focus(); }
  else if (act === 'cancel-pedido') { S.mode = S.scheduled ? 'slot' : ''; renderBooking(); $('#agendar [data-act="pedido"], .sl-t, .sl-day.on')?.focus(); }
  else if (act === 'ics' && S.done) downloadIcs(S.done.v, S.done.id);
  else if (act === 'report') {
    const form = $('#rpForm');
    const btn = e.target.closest('[data-act="report"]');
    if (!form || !btn) return;
    form.hidden = !form.hidden;
    btn.setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) $('input[name="tipo"]', form)?.focus();
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'rpForm') return;
  e.preventDefault();
  if (S.report !== 'sending') sendReport(e.target);
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'slProc') { S.procId = e.target.value; S.exam = currentProc()?.exam || S.exam; S.notice = ''; loadSlots(); }
});

// Setas do teclado entre os dias (padrão de abas).
document.addEventListener('keydown', (e) => {
  const tab = e.target.closest?.('.sl-day');
  if (!tab || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
  const tabs = $$('.sl-day:not([disabled])');
  const i = tabs.indexOf(tab);
  const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1) : tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
  if (!next) return;
  e.preventDefault();
  S.day = next.dataset.day;
  S.chosen = '';
  renderBooking();
  $(`#tab-${S.day}`)?.focus();
});

/* ======================= início ======================= */
S.ref = refFromUrl();
if (S.ref) load();
else renderNotFound();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
}
