// Página inicial do IMED. Só mostra o que vem do banco (Supabase) ou do cadastro oficial (CNES):
// nada de preço, nota, horário ou número inventado. Sem dado, a página mostra um texto neutro.
// Carregado depois de config.js, db.js e data.js (EXAMS e PLACES.paulista, o exemplo da Av. Paulista).
// A tela "Clínicas perto de você" (#reais), com o pedido de localização ao abrir e o seletor de cidade, fica em
// inicio-perto.js; as regras e os textos dela, em inicio-core.js. Daqui ela recebe as chamadas ao banco, a janela
// (#ov/#sheet), o Leaflet e as cidades; e avisa quando a origem muda (o 3D, a lista leve e a fonte acompanham).
import { iniciarPerto } from './inicio-perto.js';
import { deCidade, textoLeve, textoDistancia, ehAproximado, TIPOS } from './inicio-core.js';

const C = window.IMED_CONFIG || {};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// iPhone e iPad (todos os navegadores do iOS usam o motor do Safari, o WebKit).
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ico = (k) => `assets/img/ico-${k}.webp`;
// Ícone na medida: o navegador escolhe a versão de 96 px ou a de 300 px pelo tamanho na tela.
const icoSet = (k, px) => `src="${ico(k)}" srcset="assets/img/ico-${k}-96.webp 96w, ${ico(k)} 300w" sizes="${px}px" width="${px}" height="${px}"`;
const fmtInt = (n) => Number(n).toLocaleString('pt-BR');
// Distância de um local, igual à da lista da tela "Clínicas perto de você" (e da busca completa): "420 m", "1,2 km",
// "12 km", com "~" quando a posição veio do endereço (não do cadastro).
const distRow = (r) => textoDistancia(r.distance_m, ehAproximado(r));
const round3 = (v) => Math.round(v * 1000) / 1000;

const store = {
  get(k, d) { try { const v = localStorage.getItem('imed_' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('imed_' + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};

// Favoritos de clínicas fictícias da versão antiga: ninguém mais lê essa chave.
try { localStorage.removeItem('imed_fav'); } catch { /* sem armazenamento */ }

const S = { view: 'inicio', hl: null };
// Ponto de partida do topo (3D, lista leve e fonte), o mesmo da tela "Clínicas perto de você":
// a localização do aparelho (só nesta visita, arredondada), a cidade escolhida ou, sem nenhuma das duas, o exemplo
// da Av. Paulista, marcado como exemplo. Enquanto o pedido de localização espera resposta (até 8 s), o 3D mostra só
// a cidade, sem rótulos, e a lista leve mostra linhas de espera.
let PERTO = null;
function topo() {
  const t = PERTO ? PERTO.topo() : { modo: null };
  return t.modo === 'exemplo' ? { ...t, lat: PLACES.paulista.lat, lng: PLACES.paulista.lng } : t;
}
const origin = () => { const t = topo(); return t.modo ? t : PLACES.paulista; };
// de: com a preposição ("da Av. Paulista"); me: rótulo do ponto no mapa 3D.
function where() {
  const t = topo();
  if (t.modo === 'perto') return { de: 'da sua localização', me: 'Você está aqui' };
  if (t.modo === 'cidade') return { de: `do centro ${deCidade(t.cidade.name)}`, me: `Centro ${deCidade(t.cidade.name)}` };
  return { de: PLACES.paulista.de, me: 'Exemplo: Av. Paulista' };
}

// Cores iguais às das abas e da lista (inicio-core.TIPOS): escuras o bastante para as letras brancas dos rótulos
// e dos pinos do mapa 3D (contraste de pelo menos 4,5:1).
const KINDS = {
  imagem: { n: 'Diagnóstico por imagem', plural: 'Imagem', color: TIPOS.imagem.cor },
  laboratorio: { n: 'Laboratório', plural: 'Laboratórios', color: TIPOS.laboratorio.cor },
  clinica: { n: 'Clínica', plural: 'Clínicas', color: TIPOS.clinica.cor },
  hospital: { n: 'Hospital', plural: 'Hospitais', color: TIPOS.hospital.cor },
};
const kindOf = (k) => KINDS[k] || KINDS.clinica;
// Página de cada local: parceiro pelo id, estabelecimento do CNES pelo código de 7 dígitos.
function localUrl(r, hash = '') {
  if (r.partner && r.id) return `local.html?id=${encodeURIComponent(r.id)}${hash}`;
  if (/^\d{7}$/.test(String(r.cnes || ''))) return `local.html?cnes=${r.cnes}${hash}`;
  return '';
}

// Aviso curto no alto da tela. falar: false deixa o aviso só na tela (o leitor de tela já ouve a mesma coisa por
// outro lugar, como o resumo da lista).
function toast(m, { falar = true } = {}) {
  const t = $('#toast');
  if (falar) { t.removeAttribute('aria-hidden'); t.setAttribute('aria-live', 'polite'); } else { t.setAttribute('aria-hidden', 'true'); t.setAttribute('aria-live', 'off'); }
  t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800);
}

// Chamada a uma função do banco como visitante (só a chave publishable). signal: cancela a chamada (a origem mudou);
// o limite de 15 s continua.
async function rpc(fn, args = {}, { signal } = {}) {
  if (!C.supabaseUrl || !C.supabaseKey || typeof C.supabaseHeaders !== 'function') throw new Error('config ausente');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const parar = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', parar, { once: true }); }
  try {
    const res = await fetch(`${C.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST', signal: ctrl.signal,
      headers: C.supabaseHeaders(null, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', parar); }
}

/* ======================= NAVEGAÇÃO ======================= */
function setHash(h) { try { history.replaceState(history.state, '', location.pathname + location.search + (h || '')); } catch { /* ignora */ } }
function go(v) {
  S.view = v;
  document.querySelectorAll('[data-view]').forEach((s) => { const off = s.dataset.view !== v; s.classList.toggle('hide', off); s.hidden = off; });
  // "Pular para o conteúdo" leva ao <main> da visão aberta.
  const skip = $('.skip'); if (skip) skip.setAttribute('href', v === 'agenda' ? '#agendaMain' : '#conteudo');
  document.querySelectorAll('.tab[data-go], .bnav [data-go]').forEach((t) => {
    const on = t.dataset.go === v;
    t.classList.toggle('on', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  if (v === 'agenda') { renderAppts(); setHash('#agenda'); } else if (location.hash === '#agenda') setHash('');
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  headerState();
}
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (!g || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault(); closeSheet(); go(g.dataset.go);
  // Quem usa teclado ou leitor de tela vai direto para o conteúdo novo (Meus pedidos).
  if (g.dataset.go === 'agenda') $('#agendaMain')?.focus({ preventScroll: true });
});
function headerState() {
  const h = $('#hero');
  const at = S.view === 'inicio' && h && window.scrollY < h.offsetHeight - 90;
  document.body.classList.toggle('at-hero', !!at);
  document.body.classList.toggle('rolou', window.scrollY > 8);
}
addEventListener('scroll', headerState, { passive: true });

/* ======================= TOPO ======================= */
const examUrl = (k) => `perto.html?exame=${encodeURIComponent(k)}`;

// Endereço da busca: o exame (k; '' = todos os locais) e o lugar escrito junto ("ressonância em Campinas" →
// &onde=Campinas; sem lugar, a busca usa a localização). Só a cidade vai no endereço da página; bairro, rua e CEP
// ficam só nesta aba até a busca abrir (sessionStorage), longe do histórico. O contador de visitas não lê o endereço.
const ONDE_KEY = 'imed_onde';
const ondeNaUrl = (onde) => !!onde && !!nomes?.ehCidade(onde);
function buscaUrl(k, onde = '') {
  const p = new URLSearchParams();
  if (k) p.set('exame', k);
  if (ondeNaUrl(onde)) p.set('onde', onde);
  else if (!k && !onde) p.set('usar', 'localizacao');
  const q = p.toString();
  return q ? `perto.html?${q}` : 'perto.html';
}
function guardarOnde(onde) {
  if (!onde || ondeNaUrl(onde)) return;
  try { sessionStorage.setItem(ONDE_KEY, onde); } catch { /* sem armazenamento: a busca usa a localização */ }
}
function ir(k, onde = '') { guardarOnde(onde); location.href = buscaUrl(k, onde); }

// Nomes de exames do dia a dia ("hemograma", "USG", "tomo", "ressonancia" sem acento, uma letra errada):
// exames-nomes.js, baixado só quando a pessoa toca na caixa (a página inicial abre sem ele).
// nomesErro: não chegou (sem internet); a próxima letra digitada tenta de novo.
let nomes = null, nomesP = null, nomesErro = false;
const loadNomes = () => (nomesP ||= import('./exames-nomes.js').then((m) => (nomes = m), () => { nomesP = null; nomesErro = true; return null; }));
const SUG_VER = 'Ver lugares perto de você';
// O IMED não sabe quais exames cada local faz: com exame de laboratório ou um exame específico ("Doppler"), a lista
// avisa uma vez só, embaixo das opções (e o leitor de tela ouve junto com o número de opções).
const CONFIRME = 'Confirme se o local faz este exame.';
const DICA_EM = 'Para buscar em outra cidade, escreva “em” antes do nome dela, por exemplo “ultrassom em Campinas”.';
// Doença ou condição ("HIV", "Hepatite B"): a opção mostra "Exame de HIV".
const exameDe = (nome) => (/^(exame|teste)/i.test(nome) ? nome : `Exame de ${nomes.minusculo(nome)}`);
// Uma opção da lista para o que o dicionário achou: o exame com "também chamado de" (apelido) ou o nome digitado
// ligado ao exame ("Hemograma · Laboratórios perto de você").
function sugItem(h, onde, doenca) {
  const e = EXAMS[h.codigo];
  const ver = onde ? `Ver lugares em ${onde}` : SUG_VER;
  if (h.codigo === 'lab' && h.tipo !== 'n') return { k: 'lab', b: doenca ? exameDe(h.nome) : h.nome, s: onde ? `Laboratórios em ${onde}` : 'Laboratórios perto de você', item: true, confirme: true };
  if (h.tipo === 'a') return { k: h.codigo, b: e.full, s: `Também chamado de ${nomes.minusculo(h.nome)}` };
  if (h.tipo === 'e') return { k: h.codigo, b: h.nome, s: `${e.n}: ${ver.charAt(0).toLowerCase()}${ver.slice(1)}`, item: true, confirme: true };
  return { k: h.codigo, b: e.full, s: ver };
}
// Opções para o texto: primeiro o que o dicionário achou; depois, os exames do site com o texto no nome (como era
// antes, e o que fica se o dicionário não chegar). Caixa vazia: os 9 exames (o laboratório é o 9º).
function sugestoes(raw) {
  const q = norm(raw.trim());
  const r = q && nomes ? nomes.sugerir(raw) : null;
  const onde = r?.exato ? r.lugar : '';
  const out = [];
  const poe = (o) => { if (o.item || !out.some((x) => x.k === o.k && !x.item)) out.push({ ...o, onde }); };
  for (const h of r?.itens || []) if (EXAMS[h.codigo]) poe(sugItem(h, onde, !!r.doenca));
  // "dengue", "HIV": o exame ou atendimento (todos os locais, sem filtro de exame).
  if (r?.doenca) poe({ k: '', b: 'Atendimento', s: onde ? `Todos os locais em ${onde}` : 'Todos os locais perto de você', item: true });
  else for (const k of Object.keys(EXAMS)) if (!q || norm(EXAMS[k].n + ' ' + EXAMS[k].full).includes(q)) poe({ k, b: EXAMS[k].full, s: SUG_VER });
  const itens = out.slice(0, q ? 8 : 9);
  return {
    itens, ambiguo: r?.ambiguo || null, doenca: r?.doenca || null, codigos: r?.exames || [],
    // escolha: o nome serve para mais de um exame ("eco"), é doença ("dengue") ou há mais de um exame escrito.
    escolha: !!r && (r.exames.length > 1 || !!r.doenca),
    sobra: r?.exato ? r.sobra : '', confirme: itens.some((o) => o.confirme),
    // Sem exame, mas o texto é um lugar conhecido ("Campinas", CEP): o Buscar leva para lá.
    lugar: r && !r.exato ? nomes.lugarConhecido(raw) : '',
  };
}
// Anúncio para o leitor de tela (quantas opções; e, com "eco", que é preciso escolher). Espera a pessoa parar de
// digitar, para não falar a cada letra.
let sugMsgT = 0;
function sugStatus(texto, agora = false) {
  const el = $('#heroSugMsg'); if (!el) return;
  clearTimeout(sugMsgT);
  const put = () => { if (el.textContent !== texto) el.textContent = texto; };
  if (agora) put(); else sugMsgT = setTimeout(put, 700);
}
const pergunta = (r) => (r.doenca ? `“${r.doenca}”: você procura o exame ou atendimento?`
  : r.ambiguo ? `“${nomes.minusculo(r.ambiguo)}” pode ser:` : 'Você escreveu mais de um exame. Escolha um:');
const qualOpcao = (r) => (r.doenca ? `“${r.doenca}”: você procura o exame ou atendimento? Escolha uma das opções.`
  : r.ambiguo ? `“${nomes.minusculo(r.ambiguo)}” pode ser ${r.codigos.map((k) => EXAMS[k].n.toLowerCase()).join(' ou ')}. Escolha uma das opções.`
    : 'Você escreveu mais de um exame. Escolha um para buscar.');
// Setas só fazem sentido com teclado (no celular, com TalkBack ou VoiceOver, a pessoa desliza pelas opções).
const setas = () => (matchMedia('(pointer: fine)').matches ? ' Use as setas para escolher.' : '');
// O dicionário não chegou a tempo do Buscar (sem internet?): o exame não se perde calado.
const avisoDe = (r) => (r.itens.length ? 'Os nomes dos exames não carregaram. Escolha um exame da lista ou toque em Buscar de novo.'
  : 'Os nomes dos exames não carregaram. Toque em Buscar de novo para ver todos os lugares perto de você.');
const notaDe = (r) => (sugAviso ? avisoDe(r) : r.sobra ? DICA_EM : r.confirme ? CONFIRME : '');
function statusDe(r, esperando = false) {
  const n = r.itens.length, q = $('#heroQ').value.trim();
  if (!q || esperando) return '';
  if (!n) return sugAviso ? avisoDe(r) : 'Nenhum exame com esse nome.';
  const nota = notaDe(r);
  return `${r.escolha ? qualOpcao(r) : `${n} ${n === 1 ? 'sugestão' : 'sugestões'} abaixo.`}${setas()}${nota ? ` ${nota}` : ''}`;
}

// sugAviso: o dicionário não chegou a tempo do Buscar (a lista fica aberta com o aviso; o 2º Buscar segue sem ele).
let sugIdx = -1, sugItems = [], sugHideT = 0, sugAviso = false;
const opcaoAtiva = (i) => document.querySelectorAll('#heroSug .sug').forEach((b, n) => { b.classList.toggle('act', n === i); b.setAttribute('aria-selected', String(n === i)); });
function showSug() {
  const box = $('#heroSug'), raw = $('#heroQ').value, q = raw.trim();
  // O dicionário chega depois do primeiro toque: a lista é refeita quando ele chega, ou quando ele falha (se a pessoa
  // não estiver escolhendo com as setas).
  if (!nomes && !nomesErro) loadNomes().then(() => { if ($('#heroQ').value.trim() && sugIdx < 0 && !box.hidden) showSug(); });
  const r = sugestoes(raw);
  // Enquanto o dicionário chega, "Procurando…" (e não "Nenhum exame", que ainda não dá para saber).
  const esperando = !!q && !nomes && !nomesErro && !sugAviso;
  sugItems = r.itens;
  sugIdx = -1;
  const titulo = r.escolha ? pergunta(r) : '';
  const nota = notaDe(r);
  const icone = (k) => (k === 'lab' ? '<span class="lg" style="background:#6C4BD8" aria-hidden="true"><i class="fa-solid fa-flask"></i></span>'
    : !k ? '<span class="lg" style="background:#0B7290" aria-hidden="true"><i class="fa-solid fa-hospital"></i></span>' : `<img ${icoSet(k, 38)} alt="">`);
  // Padrão de caixa de sugestões (combobox): as opções ficam fora do Tab e são escolhidas com as setas.
  box.innerHTML = sugItems.length
    ? `<h6${titulo ? ' class="pergunta"' : ''} aria-hidden="true">${esc(titulo || 'Exames')}</h6>`
      + sugItems.map((o, i) => `<a class="sug" role="option" id="sug-${i}" href="${buscaUrl(o.k, o.onde)}"${o.onde ? ` data-onde="${esc(o.onde)}"` : ''} tabindex="-1" aria-selected="false">${icone(o.k)}<span><b>${esc(o.b)}</b><small>${esc(o.s)}</small></span></a>`).join('')
      + (nota ? `<p class="hs-nota" aria-hidden="true">${esc(nota)}</p>` : '')
    : `<p class="hs-vazio">${sugAviso ? esc(avisoDe(r)) : esperando ? 'Procurando…' : `Nenhum exame com esse nome. Toque em Buscar para ver ${r.lugar ? `os lugares em ${esc(r.lugar)}` : 'todos os lugares perto de você'}.`}</p>`;
  if (sugItems.length) { box.setAttribute('role', 'listbox'); box.setAttribute('aria-label', titulo || 'Exames'); } else { box.removeAttribute('role'); box.removeAttribute('aria-label'); }
  box.hidden = false;
  document.body.classList.add('sug-aberta');
  $('#heroQ').setAttribute('aria-expanded', String(!!sugItems.length));
  $('#heroQ').removeAttribute('aria-activedescendant');
  sugStatus(statusDe(r, esperando && !sugItems.length));
  return r;
}
function hideSug() {
  $('#heroSug').hidden = true;
  sugIdx = -1;
  opcaoAtiva(-1);
  document.body.classList.remove('sug-aberta');
  $('#heroQ').setAttribute('aria-expanded', 'false');
  $('#heroQ').removeAttribute('aria-activedescendant');
  sugStatus('', true);
}
// Celular e tablet: ao tocar na caixa, o formulário sobe para o alto da tela, para as sugestões caberem acima do
// teclado (o topo fixo fica de fora: scroll-padding-top).
const ATE_979 = matchMedia('(max-width: 979px)');
$('#heroQ').addEventListener('focus', () => {
  clearTimeout(sugHideT);
  showSug();
  const f = $('#heroForm');
  if (ATE_979.matches && f.getBoundingClientRect().top > 110) f.scrollIntoView({ block: 'start', behavior: 'auto' });
});
$('#heroQ').addEventListener('input', () => { sugAviso = false; nomesErro = false; showSug(); });
$('#heroQ').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    // Lista fechada (Esc): abre de novo antes de andar, para a opção escolhida estar à vista.
    if ($('#heroSug').hidden) showSug();
    const opts = [...document.querySelectorAll('#heroSug .sug')];
    if (!opts.length) return;
    const desce = e.key === 'ArrowDown';
    sugIdx = sugIdx < 0 ? (desce ? 0 : opts.length - 1) : (sugIdx + (desce ? 1 : -1) + opts.length) % opts.length;
    opcaoAtiva(sugIdx);
    $('#heroQ').setAttribute('aria-activedescendant', opts[sugIdx].id);
    opts[sugIdx].scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Escape') hideSug();
});
$('#heroSug').addEventListener('mousedown', (e) => e.preventDefault());
// Lugar com número: guardado nesta aba antes de abrir a busca (o link não o leva no endereço).
$('#heroSug').addEventListener('click', (e) => { const a = e.target.closest('.sug'); if (a?.dataset.onde) guardarOnde(a.dataset.onde); });
$('#heroQ').addEventListener('blur', () => { clearTimeout(sugHideT); sugHideT = setTimeout(hideSug, 150); });
// Lista aberta sem o foco na caixa (celular, depois do Buscar): fecha ao tocar fora do formulário.
document.addEventListener('pointerdown', (e) => { if (!$('#heroSug').hidden && !e.target.closest('#heroForm')) hideSug(); });
// Mostra as opções de novo depois do Buscar. Com o mouse ou o teclado, o foco volta para a caixa; no celular, não
// (o teclado abriria por cima das opções): a lista só rola para a vista.
function mostrarOpcoes() {
  const toque = matchMedia('(pointer: coarse)').matches;
  if (!toque) $('#heroQ').focus();
  const r = showSug();
  if (toque) $('#heroSug').scrollIntoView({ block: 'nearest' });
  // Falado de novo mesmo se o aviso já estava lá (o leitor de tela só fala o que muda).
  sugStatus('', true);
  setTimeout(() => sugStatus(statusDe(r), true), 60);
}
let enviando = false;
$('#heroForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (enviando) return;
  if (sugIdx >= 0 && sugItems[sugIdx]) { const o = sugItems[sugIdx]; ir(o.k, o.onde); return; }
  const raw = $('#heroQ').value.trim();
  if (!raw) { ir(''); return; }
  if (!nomes && !sugAviso) {
    // Buscar logo depois de digitar: o dicionário pode ainda estar chegando. O botão mostra a espera (até 2 s).
    const btn = $('.hs-go');
    enviando = true; btn.disabled = true; btn.textContent = 'Buscando…';
    await Promise.race([loadNomes(), new Promise((r) => setTimeout(r, 2000))]);
    enviando = false; btn.disabled = false; btn.textContent = 'Buscar';
    if (!nomes) {
      // Não chegou: o exame não se perde calado. A lista fica aberta com o aviso; o próximo Buscar segue sem ele.
      sugAviso = true;
      mostrarOpcoes();
      return;
    }
  }
  const r = sugestoes(raw);
  // "eco" (ecocardiograma ou ultrassom), "dengue" (exame ou atendimento) ou mais de um exame: a pessoa escolhe.
  if (r.escolha) { mostrarOpcoes(); return; }
  if (r.itens.length) { ir(r.itens[0].k, r.itens[0].onde); return; }
  ir('', r.lugar);
});
// O lugar do topo (#heroLoc) e o do cabeçalho (#addrBtn) mostram a origem e abrem o seletor de cidade.
$('#heroLoc').onclick = () => PERTO?.abrirSeletor();
$('#addrBtn').onclick = () => PERTO?.abrirSeletor();

// Cidades com o cadastro oficial (imported_cities): uma chamada por página, só na memória (não vai para o aparelho).
// Atende a pílula, o seletor de cidade e os atalhos. deNovo: zera a promessa ("Tentar de novo" do seletor).
let citiesP = null, pillDone = false;
function loadCities(deNovo = false) {
  if (deNovo) citiesP = null;
  if (!citiesP) {
    citiesP = rpc('imported_cities').then((rows) => (Array.isArray(rows) ? rows : []));
    citiesP.then((rows) => { if (!pillDone) { pillDone = true; renderPill(rows); } }, () => {});
  }
  return citiesP;
}
const freeSrc = () => $('#heroSrc')?.classList.remove('wait');
// Pílula do topo com números reais das cidades importadas do CNES.
function renderPill(rows) {
  const valid = rows.filter((r) => Number(r.total) > 0);
  if (!valid.length) return freeSrc();
  const total = valid.reduce((s, r) => s + Number(r.total), 0);
  const onde = valid.length === 1 ? `em ${valid[0].name}` : `em ${fmtInt(valid.length)} cidades`;
  $('#livePill').textContent = `${fmtInt(total)} estabelecimentos oficiais ${onde}`;
  srcStarted = true;
  loadSourceDate();
}
// "Fonte: CNES/Ministério da Saúde, dados de <cidade> atualizados em <data>": data real dos dados da cidade em uso
// (cnes_last_update com o código IBGE). Na localização do aparelho, a cidade da região (quando ela é afirmada);
// sem ela, a data da cidade atualizada há mais tempo, que vale para todas. Sem a data, fica só a fonte. Nunca uma
// data mais nova que os dados.
const MONTH_LONG = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
// Data curta (30/10/2026): para a linha caber no espaço guardado quando o nome da cidade é comprido.
const DATE_SHORT = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
const SAO_PAULO = { ibge: 3550308, name: 'São Paulo' };
const ibgeOk = (v) => Number.isInteger(Number(v)) && Number(v) > 999999;
// Cidade dos locais mostrados: a escolhida, a região da pessoa, São Paulo (exemplo) ou nenhuma (localização sem
// região afirmada). undefined: ainda não se sabe (esperando o pedido ou a 1ª lista).
function shownCity() {
  const t = topo();
  if (t.modo === 'cidade') return ibgeOk(t.cidade.ibge) ? { ibge: Number(t.cidade.ibge), name: t.cidade.name } : null;
  if (t.modo === 'perto') {
    if (!t.regiaoFeita) return undefined;
    return t.regiao && ibgeOk(t.regiao.ibge) ? { ibge: Number(t.regiao.ibge), name: t.regiao.name } : null;
  }
  if (t.modo === 'exemplo') return SAO_PAULO;
  return undefined;
}
let srcSeq = 0, srcStarted = false, srcKey = null;
async function loadSourceDate() {
  const el = $('#heroSrc'); if (!el || !srcStarted) return;
  const city = shownCity();
  if (city === undefined) return; // a origem ainda não chegou
  const key = city ? String(city.ibge) : 'todas';
  if (key === srcKey) return;
  srcKey = key;
  const seq = ++srcSeq;
  let when = '', whenShort = '';
  try {
    const d = await rpc('cnes_last_update', city ? { p_city: city.ibge } : {});
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const at = new Date(`${d}T12:00:00Z`);
      when = MONTH_LONG.format(at); whenShort = DATE_SHORT.format(at);
    }
  } catch { /* sem data: só a fonte */ }
  if (seq !== srcSeq) return; // a origem mudou enquanto buscava
  const text = (w) => `Fonte: CNES/Ministério da Saúde${w ? (city ? `, dados ${deCidade(city.name)} atualizados em ${w}` : `, atualizado em ${w}`) : ''}`;
  // O espaço da linha já está guardado (1 linha no computador, 2 no celular): com um nome comprido (Nossa Senhora
  // do Socorro, por exemplo), a data curta faz a linha caber nele, sem empurrar o resto do topo.
  const room = el.getBoundingClientRect().height;
  el.textContent = text(when);
  el.hidden = false;
  if (when && room > 0 && el.getBoundingClientRect().height > room + 1) el.textContent = text(whenShort);
  freeSrc();
}

/* ======================= O QUE VOCÊ PRECISA ======================= */
function renderCats() {
  $('#cats').innerHTML = Object.entries(EXAMS).map(([k, e]) => `<a class="cat" href="${examUrl(k)}">${k === 'lab' ? '<span class="ic-lab" aria-hidden="true"><i class="fa-solid fa-flask"></i></span>' : `<img ${icoSet(k, 96)} alt="" loading="lazy">`}<b>${esc(e.n)}</b><small>Ver perto de você<i class="fa-solid fa-arrow-right" aria-hidden="true"></i></small></a>`).join('');
}

/* ======================= JANELAS (sheets) ======================= */
// O que recebe o Tab dentro de uma caixa, na ordem: de um grupo de opções (rádio), só a marcada ou a primeira.
function tabbables(root) {
  const all = [...root.querySelectorAll('a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]')]
    .filter((x) => x.tabIndex >= 0 && x.offsetParent !== null);
  return all.filter((x) => {
    if (x.type !== 'radio' || !x.name) return true;
    const group = all.filter((y) => y.type === 'radio' && y.name === x.name);
    return x === (group.find((y) => y.checked) ?? group[0]);
  });
}
const ov = $('#ov'), sheet = $('#sheet');
let lastFocus = null, lastInScreen = false, onClose = null;
// Foco à vista (WCAG 2.4.11): sem rolar quando o elemento já aparece inteiro entre o cabeçalho e o menu de baixo;
// senão, rola só o necessário (o scroll-padding da página deixa o espaço do cabeçalho e dos avisos fixos).
function onScreen(e) {
  if (!e || !e.getClientRects().length) return false;
  if (e.closest('.top')) return true; // no cabeçalho fixo: sempre à vista
  const r = e.getBoundingClientRect(), top = $('.top')?.getBoundingClientRect().bottom || 0;
  const nav = $('.bnav'), bottom = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : innerHeight;
  return r.top >= top && r.bottom <= bottom;
}
function focusVisible(e) {
  if (!e) return;
  e.focus({ preventScroll: true });
  if (!onScreen(e)) e.scrollIntoView({ block: 'nearest' });
}
// foco: onde pôr o foco ao abrir (o seletor de cidade põe no campo da cidade); sem ele, no X. aoFechar: chamado
// uma vez quando a janela fecha (por qualquer caminho: X, Esc, toque fora, escolha ou o "voltar" do celular).
function openSheet(html, cls = '', label = 'Detalhes', { foco = null, aoFechar = null } = {}) {
  if (ov.classList.contains('open') && onClose) { const f = onClose; onClose = null; f(); }
  else if (!ov.classList.contains('open')) { lastFocus = document.activeElement; lastInScreen = !!lastFocus?.closest?.('#reais'); }
  onClose = aoFechar;
  sheet.className = 'sheet ' + cls; sheet.innerHTML = html; sheet.setAttribute('aria-label', label);
  ov.classList.add('open'); ov.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; sheet.scrollTop = 0;
  const f = (foco && sheet.querySelector(foco)) || sheet.querySelector('[data-close]'); if (f) f.focus();
}
function closeSheet() {
  if (!ov.classList.contains('open')) return;
  ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; S.hl = null;
  // O foco volta para quem abriu. Se ele sumiu (um botão do cartão da tela "Clínicas perto de você" some quando a
  // lista chega), vai para o botão da cidade da mesma tela, rolando só o necessário para ele ficar à vista. Se quem
  // abriu não era da tela (o "Prefiro escolher a cidade" do aviso) ou nunca teve o foco (no iPhone, tocar num botão
  // não dá foco a ele: fica o <body>), vai para o botão da cidade se ele estiver na tela, ou para o do cabeçalho,
  // sempre à vista (sem a página pular). Nunca fica dentro da janela fechada (o teclado do iPhone ficaria aberto,
  // digitando num campo invisível).
  const valid = (e) => !!e && e !== document.body && document.contains(e) && !sheet.contains(e) && e.getClientRects().length > 0;
  const back = valid(lastFocus) ? lastFocus
    : lastInScreen && valid($('#cityBtn')) ? $('#cityBtn')
      : [$('#cityBtn'), $('#addrBtn')].find((e) => valid(e) && onScreen(e)) || [$('#addrBtn'), $('#cityBtn')].find(valid) || null;
  if (back) focusVisible(back);
  if (sheet.contains(document.activeElement)) document.activeElement.blur();
  lastFocus = null; lastInScreen = false;
  const f = onClose; onClose = null;
  if (f) f();
}
ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', (e) => {
  if (!ov.classList.contains('open')) return;
  if (e.key === 'Escape') { closeSheet(); return; }
  if (e.key !== 'Tab') return;
  // Foco preso na janela enquanto ela está aberta: Tab e Shift+Tab dão a volta dentro dela.
  const f = tabbables(sheet);
  if (!f.length) { e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1];
  if (!sheet.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
const head = (t) => `<div class="sh-head"><h3>${t}</h3><button class="x" type="button" data-close aria-label="Fechar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>`;

// Centro da cidade pela mesma geocodificação da busca (Edge Function clinicas-proximas, action geocode).
async function geocode(q) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${C.functionsUrl}/clinicas-proximas`, {
      method: 'POST', signal: ctrl.signal,
      headers: C.supabaseHeaders(null, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'geocode', q }),
    });
    const g = await res.json().catch(() => null);
    if (!res.ok || !g?.ok || !Number.isFinite(g.lat) || !Number.isFinite(g.lng)) throw new Error('geocode');
    return g;
  } finally { clearTimeout(timer); }
}

// Leaflet (o mapa da tela "Clínicas perto de você"): só quando o mapa vai aparecer.
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (loadLeaflet.p) return loadLeaflet.p;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'assets/vendor/leaflet/leaflet.css'; document.head.appendChild(css);
  loadLeaflet.p = new Promise((ok, fail) => { const sc = document.createElement('script'); sc.src = 'assets/vendor/leaflet/leaflet.js'; sc.onload = ok; sc.onerror = fail; document.head.appendChild(sc); });
  loadLeaflet.p.catch(() => { loadLeaflet.p = null; css.remove(); }); // "Tentar de novo" baixa outra vez
  return loadLeaflet.p;
}
// Locais perto da origem para o 3D e a lista leve: estabelecimentos do CNES + parceiros publicados do IMED.
// nearby_establishments deixa de fora quem já virou parceiro, por isso as duas chamadas.
// Se a dos parceiros falhar, mostra só o CNES; se a do CNES falhar, é erro.
async function nearbyAll(o, radius, limit) {
  const at = { p_lat: round3(o.lat), p_lng: round3(o.lng), p_radius_m: radius };
  const [est, par] = await Promise.all([
    rpc('nearby_establishments', { ...at, p_limit: limit }),
    rpc('nearby_clinics', { ...at, p_include_demo: false, p_limit: Math.min(limit, 100) }).catch(() => []),
  ]);
  const ok = (r) => r && r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng);
  const partners = (Array.isArray(par) ? par : []).filter(ok).map((r) => ({ ...r, uf: r.uf || r.state, key: 'imed:' + r.id, partner: true }));
  const cnes = (Array.isArray(est) ? est : []).filter(ok).map((r) => ({ ...r, key: 'cnes:' + r.cnes, partner: false }));
  return { rows: [...partners, ...cnes].sort((a, b) => a.distance_m - b.distance_m), full: cnes.length >= limit };
}

/* ======================= MAPA DO TOPO (FOTO DE SATÉLITE OU 3D) ======================= */
// Com a chave da Esri em config.js: a foto de satélite real da região, parada e vista de cima. Sem a chave: o mapa 3D
// com os prédios de verdade (MapLibre + ladrilhos do OpenFreeMap). Os dois em assets/js/hero3d.js, com os
// estabelecimentos reais do CNES perto da origem. Enquanto os locais carregam (ou se falharem), o mapa fica sem pinos.
let heroList = [], heroSeq = 0, heroWanted = false, heroLite = false, heroLoaded = false;
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'para', '-', '&']);
function initials(name) {
  const w = String(name).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((x) => x && !STOP.has(x.toLowerCase()));
  if (!w.length) return '+';
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
}
// Prefere variedade: alterna entre os tipos, do mais perto para o mais longe.
function pickVaried(rows, max = 14) {
  const byKind = {};
  [...rows].sort((a, b) => a.distance_m - b.distance_m).forEach((r) => { (byKind[r.kind] ||= []).push(r); });
  const order = ['imagem', 'laboratorio', 'hospital', 'clinica', ...Object.keys(byKind).filter((k) => !KINDS[k])];
  const out = [];
  while (out.length < max && order.some((k) => byKind[k]?.length)) {
    for (const k of order) { if (out.length >= max) break; const r = byKind[k]?.shift(); if (r) out.push(r); }
  }
  return out.sort((a, b) => a.distance_m - b.distance_m);
}
async function loadHeroPlaces() {
  heroWanted = true;
  if (!topo().modo) return; // esperando a resposta do pedido de localização: o 3D mostra só a cidade
  const seq = ++heroSeq, o = origin();
  try {
    const { rows } = await nearbyAll(o, 3000, 80);
    if (seq !== heroSeq) return;
    heroLoaded = true;
    // Parceiros primeiro (têm exames informados); o resto com variedade de tipos.
    const partners = rows.filter((r) => r.partner).slice(0, 6);
    heroList = [...partners, ...pickVaried(rows.filter((r) => !r.partner), 14 - partners.length)].sort((a, b) => a.distance_m - b.distance_m).map((r) => {
      const k = kindOf(r.kind);
      return { id: r.key, n: r.name, ini: initials(r.name), c: k.color, lat: r.lat, lng: r.lng, open: true, kind: r.kind, row: r };
    });
    if (window.HERO) window.HERO.setOrigin();
    if (heroLite) renderHeroLite();
  } catch {
    // Sem dados: o 3D continua só com a cidade; no modo leve, um texto neutro com link para a busca.
    // Marca como carregado mesmo fora do modo leve: se o 3D falhar depois, a lista não fica em "Carregando…".
    if (seq === heroSeq) { heroLoaded = true; if (heroLite) renderHeroLite(); }
  }
}
// Resumo escondido da lista leve (lido junto com ela). Não é um status falado: o leitor de tela já ouve o resumo da
// lista da tela "Clínicas perto de você" (#pvSum), sem repetir a mesma frase.
function liteStatus(text) { const s = $('#heroLiteStatus'); if (s && s.textContent !== text) s.textContent = text; }
// Modo leve (aparelho simples, economia de dados ou "reduzir movimento"): sem 3D, só a ilustração
// de fundo e a lista dos mesmos locais reais perto do ponto escolhido. Título em 1 linha (inicio-core.textoLeve):
// "Perto de você" (esperando a resposta do pedido), "Perto da sua localização", "Perto do centro de Campinas" ou
// "Exemplo: perto da Av. Paulista".
function renderHeroLite() {
  const box = $('#heroLite'); if (!box) return;
  const t = topo();
  const list = t.modo ? heroList.slice(0, innerWidth < 700 ? 4 : 5) : [];
  const leve = textoLeve({ modo: t.modo, cidade: t.cidade, n: list.length });
  const title = `<h2><i class="fa-solid fa-location-dot" aria-hidden="true"></i>${esc(leve.titulo)}</h2>`;
  // Só redesenha quando muda (um link focado na lista não perde o foco a cada aviso da tela de baixo).
  const put = (html) => { if (box._html !== html) { box.innerHTML = html; box._html = html; } };
  if (!list.length) {
    // Esperando a origem ou carregando: linhas de espera do mesmo tamanho das linhas de verdade, para a caixa não
    // pular quando os locais chegarem. O leitor de tela ouve só o resumo (liteStatus).
    const failed = !!t.modo && heroLoaded;
    const wait = `<ol aria-hidden="true">${'<li class="ph"><span><span class="dot"></span><span style="min-width:0;flex:1"><b>&nbsp;</b><small>&nbsp;</small></span></span></li>'.repeat(innerWidth < 700 ? 4 : 5)}</ol>`;
    put(title + (failed ? '<p>Veja clínicas, laboratórios e hospitais perto de você na busca.</p>' : wait)
      + '<a class="more" href="perto.html?usar=localizacao">Buscar perto de mim <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>');
    liteStatus(failed ? 'A lista de locais não está disponível agora. Use a busca perto de você.' : (leve.status || 'Carregando os locais…'));
    return;
  }
  liteStatus(leve.status);
  put(title + '<ol>' + list.map((c) => {
    const r = c.row, k = kindOf(r.kind), url = localUrl(r) || 'perto.html';
    return `<li><a href="${esc(url)}"><span class="dot" style="background:${k.color}"></span><span style="min-width:0"><b>${esc(r.name)}</b><small>${r.partner ? 'Parceiro do IMED · ' : ''}${esc(k.n)} · ${esc(distRow(r))}</small></span></a></li>`;
  }).join('') + '</ol><a class="more" href="perto.html?usar=localizacao">Ver todos perto de mim <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>');
}
// A origem da tela "Clínicas perto de você" mudou (ou a espera do pedido acabou): o 3D, a lista leve e a fonte
// acompanham. Só busca os locais do 3D de novo quando o ponto muda de verdade.
let heroKey = '';
function origemMudou() {
  const t = topo();
  document.body.dataset.origem = t.modo || 'espera';
  const key = t.modo ? `${t.modo}|${t.lat}|${t.lng}` : 'espera';
  if (key !== heroKey) {
    heroKey = key;
    heroList = []; heroLoaded = false; heroSeq += 1;
    if (window.HERO) window.HERO.setOrigin();
    if (heroWanted) loadHeroPlaces();
  }
  if (heroLite) renderHeroLite();
  loadSourceDate();
}
function openPlaceDetail(id) {
  const c = heroList.find((x) => x.id === id); if (!c) return;
  const r = c.row, k = kindOf(r.kind);
  S.hl = id;
  const addr = [r.address_line, r.neighborhood, [r.city, r.uf].filter(Boolean).join(' - ')].filter(Boolean).join(' · ');
  const tel = String(r.phone || '').replace(/\D/g, '');
  const extra = [r.open_24h ? 'Aberto 24 horas' : r.shift, r.sus ? 'Atende pelo SUS' : ''].filter(Boolean).join(' · ');
  const exams = r.partner && Array.isArray(r.exams) ? [...new Set(r.exams.map((e) => e && EXAMS[e.code]?.n).filter(Boolean))] : [];
  const page = localUrl(r);
  openSheet(head(esc(r.name)) + `<div class="sh-body">
    <span class="place-kind"><span style="background:${k.color}"></span>${r.partner ? 'Parceiro do IMED · ' : ''}${esc(k.n)} · ${esc(distRow(r))} ${esc(where().de)}</span>
    <div class="place-info">
      ${addr ? `<div><i class="fa-solid fa-location-dot" aria-hidden="true"></i>${esc(addr)}</div>` : ''}
      ${tel.length >= 10 ? `<div><i class="fa-solid fa-phone" aria-hidden="true"></i><a href="tel:+55${tel}">${esc(r.phone)}</a></div>` : ''}
      ${extra ? `<div><i class="fa-regular fa-clock" aria-hidden="true"></i>${esc(extra)}</div>` : ''}
      ${exams.length ? `<div><i class="fa-solid fa-notes-medical" aria-hidden="true"></i>Exames informados pela clínica: ${esc(exams.join(', '))}</div>` : ''}
    </div>
    <p class="note">${r.partner ? 'Dados informados pela clínica parceira' : 'Fonte: CNES/DataSUS'}${r.cnes ? ` (CNES ${esc(r.cnes)})` : ''}. Confirme horários e valores com o local.</p>
    <div class="place-act">
      ${page ? `<a class="btn btn-coral" href="${esc(localUrl(r, '#agendar'))}"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i>Pedir agendamento</a>
      <a class="btn btn-ghost" href="${esc(page)}"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>Ver página do local</a>` : '<a class="btn btn-coral" href="perto.html"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i>Abrir a busca</a>'}
      ${!r.partner && r.cnes ? `<a class="btn btn-ghost" href="reivindicar.html?cnes=${encodeURIComponent(r.cnes)}"><i class="fa-solid fa-hospital-user" aria-hidden="true"></i>É sua clínica? Assuma o cadastro</a>` : ''}
    </div>
  </div>`, 'sm', r.name);
}
window.HERO = null;
// Tema que vale agora (tema.js marca o <html> antes da primeira pintura).
const temaAtual = () => (document.documentElement.dataset.theme === 'dark' ? 'escuro' : 'claro');
const API = {
  clinics: () => heroList,
  // Ponto de partida arredondado (~110 m), o mesmo da busca dos locais: é dele que o mapa 3D parte.
  origin: () => { const o = origin(); return { ...o, lat: round3(o.lat), lng: round3(o.lng) }; },
  // O mapa só abre quando a origem é conhecida (não baixa ladrilhos de um lugar enquanto espera a localização).
  pronto: () => !!topo().modo,
  modo: () => topo().modo,
  highlighted: () => S.hl,
  meLabel: () => where().me,
  onPick: (id) => openPlaceDetail(id),
  meta: (c) => `${c.row.partner ? 'Parceiro · ' : ''}${kindOf(c.kind).n} · ${distRow(c.row)}`,
  tema: temaAtual,
  // Foto de satélite: só com a chave em config.js (sem ela, nada é pedido à Esri e o topo fica com o 3D).
  satelite: () => { const url = C.sateliteUrl?.(); return url ? { url, attribution: C.satelite?.attribution || '', maxZoom: C.satelite?.maxZoom } : null; },
  aoFicarPronto: (modo) => {
    const sat = modo === 'satelite';
    document.body.dataset.hero = sat ? 'satelite' : '3d';
    $('#hero3d')?.setAttribute('aria-label', sat
      ? 'Foto de satélite da região (Esri), vista de cima, com estabelecimentos de saúde reais perto do ponto escolhido'
      : 'Mapa 3D da região, com os prédios do OpenStreetMap e estabelecimentos de saúde reais perto do ponto escolhido');
    const hint = $('.hero-hint span');
    if (hint) hint.textContent = sat ? 'Arraste para mover · clique num local' : 'Arraste para girar · clique num local';
    if (!sat) pauseButton();
  },
  // Sem ladrilhos do mapa (sem internet, serviço fora do ar) ou sem WebGL 2: a versão leve, com a mesma lista real.
  falhou: (motivo) => { window.HERO = null; goLite(motivo === 'webgl' ? 'webgl' : 'mapa'); },
};
document.addEventListener('imed:tema', (e) => { window.HERO?.setTema?.(e.detail?.tema === 'escuro' ? 'escuro' : 'claro'); });
// Aparelho simples, economia de dados ou "reduzir movimento": não baixa o 3D (a biblioteca do mapa tem ~1,6 MB).
function liteReason() {
  if (reduceMotion) return 'movimento';
  const n = navigator, con = n.connection || {};
  if (con.saveData) return 'economia';
  if (/(^|-)2g$/.test(con.effectiveType || '')) return 'rede';
  if (typeof n.deviceMemory === 'number' && n.deviceMemory <= 2) return 'memoria';
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 700;
  // No iPhone o número de núcleos não serve: o Safari (WebKit) informa 4 em qualquer aparelho com menos
  // de 8 núcleos, então todo iPhone pareceria fraco. Lá a regra dos núcleos não vale.
  if (phone && !isIOS && n.hardwareConcurrency && n.hardwareConcurrency <= 4) return 'processador';
  return '';
}
const LITE = liteReason();
// Economia de dados ligada ou internet 2G: a pessoa quer gastar pouca internet (sem o service worker e sem o mapa
// sozinho). Lido direto da conexão: com "reduzir movimento" também ligado, o modo leve vem do movimento e o
// LITE não diz 'economia'.
const SAVE_DATA = (() => { const con = navigator.connection || {}; return !!con.saveData || /(^|-)2g$/.test(con.effectiveType || ''); })();
function goLite(why) {
  if (window.HERO) { try { window.HERO.destroy(); } catch { /* ignora */ } window.HERO = null; }
  heroLite = true;
  document.body.classList.add('lite');
  document.body.dataset.hero = 'leve';
  if (why === 'webgl') document.body.classList.add('no-webgl');
  $('#hero3d')?.setAttribute('aria-label', 'Estabelecimentos de saúde reais perto do ponto escolhido');
  renderHeroLite();
  if (!heroWanted) loadHeroPlaces();
}
// Espera o navegador ficar livre (depois de mostrar o topo) e o topo estar na tela.
const whenIdle = (fn) => { if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 3000 }); else setTimeout(fn, 1200); };
function whenVisible(el, fn) {
  if (!('IntersectionObserver' in window)) return fn();
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } });
  io.observe(el);
}
// "Pausar animação": o mapa 3D gira sozinho; quem quiser para o movimento (fica guardado neste aparelho).
function pauseButton() {
  const b = $('#heroPause');
  if (!b || !window.HERO?.setPaused) return;
  let paused = false;
  try { paused = localStorage.getItem('imed_3d_pausado') === '1'; } catch { /* sem armazenamento */ }
  const show = () => {
    window.HERO.setPaused(paused);
    b.querySelector('i').className = `fa-solid ${paused ? 'fa-play' : 'fa-pause'}`;
    b.querySelector('span').textContent = paused ? 'Continuar animação' : 'Pausar animação';
  };
  b.onclick = () => {
    paused = !paused;
    try { if (paused) localStorage.setItem('imed_3d_pausado', '1'); else localStorage.removeItem('imed_3d_pausado'); } catch { /* ignora */ }
    show();
  };
  show();
  b.hidden = false;
}
function startHero() {
  const el = $('#hero3d');
  if (LITE) { goLite(LITE); return; }
  document.body.dataset.hero = 'espera';
  // Primeiro o conteúdo aparece (dois quadros); depois, com o navegador livre e o topo na tela, baixa o 3D.
  requestAnimationFrame(() => requestAnimationFrame(() => whenIdle(() => whenVisible(el, load3D))));
  function load3D() {
    // O mapa 3D (MapLibre) precisa de WebGL 2; sem ele, a versão leve.
    let ok = false;
    try { const c = document.createElement('canvas'); ok = !!(window.WebGL2RenderingContext && c.getContext('webgl2')); } catch { ok = false; }
    if (!ok) { goLite('webgl'); return; }
    document.body.dataset.hero = 'carregando';
    loadHeroPlaces();
    // "3d" ou "satelite" só quando o mapa aparece (aoFicarPronto); se falhar antes, a versão leve.
    import('./hero3d.js').then((m) => { if (!heroLite) window.HERO = m.initHero3D(el, API); })
      .catch((err) => { console.warn('Mapa do topo indisponível', err); goLite('webgl'); });
  }
}

/* ======================= MEUS PEDIDOS ======================= */
// Contrato: localStorage 'imed_appts' (mais novo primeiro, até 30). Só pedidos reais (type 'pedido').
const PERIOD = { manha: 'manhã', tarde: 'tarde', noite: 'noite', qualquer: 'qualquer horário' };
const STATUS_FALLBACK = { pending: 'Aguardando contato', pendente: 'Aguardando contato', contacted: 'Em contato', confirmed: 'Confirmado', cancelled: 'Cancelado', completed: 'Concluído',
  hold: 'Reserva temporária', awaiting_payment: 'Aguardando pagamento', checked_in: 'Chegada registrada', in_service: 'Em atendimento', no_show: 'Não compareceu', reschedule_requested: 'Remarcação solicitada', expired: 'Reserva expirada' };
let geoCore = null, geoCoreSync = null, trust = null, trustSync = null;
const loadGeoCore = () => (geoCore ||= import('./geo-core.js').catch(() => ({})));
// Regras de cancelamento (confianca.js): baixado junto com Meus pedidos.
const loadTrust = () => (trust ||= import('./confianca.js').catch(() => ({})));
let cancelAsk = '', cancelBusy = ''; // pedido com a pergunta "Cancelar?" aberta / sendo cancelado (apptKey)
function readAppts() {
  let list;
  try { list = JSON.parse(localStorage.getItem('imed_appts') || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  const real = list.filter((a) => a && a.type === 'pedido' && a.name);
  // Descarta os agendamentos fictícios da versão antiga (type 'exame' ou 'tele').
  if (real.length !== list.length) { try { localStorage.setItem('imed_appts', JSON.stringify(real.slice(0, 30))); } catch { /* ignora */ } }
  return real.slice(0, 30);
}
// Identifica um pedido sem depender da posição na lista.
const apptKey = (a) => String(a.id || a.code || a.created || [a.name, a.date, a.period].join('|'));
const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const isoDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
function fmtDate(d) {
  if (!isoDate(d)) return d ? String(d) : '';
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}
// Horário marcado (slot, ISO) no fuso de São Paulo, qualquer que seja o fuso do aparelho:
// { date: 'AAAA-MM-DD', time: 'HH:MM' }; inválido → null. Mesma regra de geo-core.js (spDateTime),
// repetida aqui para não baixar o geo-core.js só para desenhar o cartão.
const SP_PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function slotAt(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(SP_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
let liveStatus = {}, statusState = 'idle';
async function fetchStatus(list) {
  const withTok = list.filter((a) => a.id && a.token);
  if (!withTok.length) return;
  statusState = 'loading';
  try {
    const rows = await rpc('request_status', { p_ids: withTok.map((a) => a.id), p_tokens: withTok.map((a) => a.token) });
    liveStatus = {};
    (Array.isArray(rows) ? rows : []).forEach((r) => { liveStatus[r.id] = r; });
    statusState = 'ok';
  } catch { statusState = 'fail'; }
  if (S.view === 'agenda') drawAppts(readAppts());
}
function renderAppts() {
  // geo-core.js e confianca.js só são baixados quando a pessoa abre Meus pedidos.
  if (!geoCoreSync) loadGeoCore().then((m) => { geoCoreSync = m; if (S.view === 'agenda') drawAppts(readAppts()); });
  if (!trustSync) loadTrust().then((m) => { trustSync = m; if (S.view === 'agenda') drawAppts(readAppts()); });
  const list = readAppts();
  statusState = 'loading';
  drawAppts(list);
  fetchStatus(list);
}
function drawAppts(list) {
  const box = $('#appts');
  if (!list.length) {
    box.innerHTML = '<div class="empty"><i class="fa-regular fa-calendar" aria-hidden="true"></i>Você ainda não fez nenhum pedido de agendamento neste aparelho.<br><a class="btn btn-primary" style="margin-top:14px" href="perto.html?usar=localizacao">Encontrar um lugar perto de mim</a></div>';
    return;
  }
  const label = (s) => (geoCoreSync?.statusLabel?.(s)) || STATUS_FALLBACK[s] || '';
  box.innerHTML = list.map((a) => {
    const key = apptKey(a);
    const live = a.id && liveStatus[a.id];
    // Com horário marcado (agenda da clínica parceira), o pedido já nasce confirmado no banco.
    const at = a.slot ? slotAt(a.slot) : null;
    let st, cls;
    if (live) { st = label(live.status); cls = { confirmed: 'ok', completed: 'ok', cancelled: 'no' }[live.status] || ''; }
    else if (a.id && a.token && statusState === 'loading') { st = 'Consultando…'; cls = 'muted'; }
    // Sem resposta do banco: vale o que o aparelho guardou (horário marcado ou pedido cancelado aqui).
    else if (a.status === 'cancelado') { st = 'Cancelado'; cls = 'no'; }
    else if (a.status === 'confirmado') { st = 'Confirmado'; cls = 'ok'; }
    else if (a.id && a.token && statusState === 'fail') { st = 'Situação indisponível agora'; cls = 'muted'; }
    else { st = 'Pedido enviado'; cls = 'muted'; }
    const when = at
      ? `Horário marcado: ${esc(fmtDate(at.date))} às ${esc(at.time)}`
      : [fmtDate(a.date) ? `Preferência: ${esc(fmtDate(a.date))}` : '', PERIOD[a.period] ? esc(PERIOD[a.period]) : (a.time ? esc(a.time) : '')].filter(Boolean).join(' · ');
    const items = Array.isArray(a.items) ? a.items : [];
    const review = live && live.status === 'completed' && !live.reviewed ? `<a class="btn btn-coral" href="conta.html#pedido-${encodeURIComponent(a.id)}"><i class="fa-solid fa-star-half-stroke" aria-hidden="true"></i>Avaliar</a>` : '';
    // Lembrete só para o que ainda vai acontecer: horário marcado no futuro ou dia de hoje em diante.
    const ahead = at ? Date.parse(a.slot) > Date.now() : isoDate(a.date) && a.date >= todayIso();
    // Lembrete só com a situação ainda de pé (confianca.canRemind: nada para remarcação, falta, cancelado…).
    const gone = (live && !trustSync?.canRemind?.(live.status)) || (!live && a.status === 'cancelado');
    const cal = ahead && !gone ? `<button class="btn btn-ghost" type="button" data-ics="${esc(key)}"><i class="fa-regular fa-calendar-plus" aria-hidden="true"></i>Adicionar à agenda</button>` : '';
    // Cancelar pelo site: com o código do pedido e a situação do banco ainda ativa (confianca.canCancel).
    const can = !!(a.id && a.token && live && trustSync?.canCancel?.(live.status, a.slot || null));
    const cancel = can && cancelAsk !== key ? `<button class="btn btn-ghost appt-cancel" type="button" data-cancel="${esc(key)}"><i class="fa-solid fa-ban" aria-hidden="true"></i>Cancelar pedido</button>` : '';
    // Para quem vai o cancelamento (clínica parceira ou local que ainda não é parceiro): o texto só promete o que acontece.
    const ptype = trustSync?.placeType?.(a) ?? '';
    const ask = can && cancelAsk === key ? `<div class="appt-ask" role="group" aria-label="Confirmar o cancelamento">
        <p>${esc(trustSync.cancelConfirmText?.(ptype, a.slot || null, live.status) || trustSync.CANCEL_CONFIRM)}</p>
        <div class="appt-act"><button class="btn btn-coral" type="button" data-cancel-yes="${esc(key)}"${cancelBusy === key ? ' disabled' : ''}>${cancelBusy === key ? '<span class="spin" aria-hidden="true"></span>Cancelando…' : 'Sim, cancelar'}</button><button class="btn btn-ghost" type="button" data-cancel-no="${esc(key)}">Não</button></div>
      </div>` : '';
    return `<article class="appt" data-key="${esc(key)}" ${a.id ? `id="pedido-${esc(a.id)}"` : ''}>
      <span class="lg" aria-hidden="true"><i class="fa-solid fa-calendar-check"></i></span>
      <div style="flex:1;min-width:0">
        <b>${esc(a.name)}</b>
        ${items.length ? `<p>${items.map(esc).join(' + ')}</p>` : ''}
        ${when ? `<p><i class="fa-regular fa-calendar" aria-hidden="true"></i> ${when}</p>` : ''}
        ${a.code ? `<p style="font-size:12px">Protocolo ${esc(a.code)}</p>` : ''}
        ${review || cal || cancel ? `<div class="appt-act">${review}${cal}${cancel}</div>` : ''}
        ${ask}
        ${a.status === 'cancelado' && trustSync?.cancelNoteHTML ? `<p class="appt-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Cancelado por você. ${trustSync.cancelNoteHTML(ptype, a.phone || '', geoCoreSync?.telHref)}</p>` : ''}
      </div>
      <div class="side"><span class="status ${cls}">${esc(st)}</span><button class="rmv" type="button" data-rm="${esc(key)}">Remover da lista</button></div>
    </article>`;
  }).join('');
  box.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => {
    if (!confirm('Remover este pedido da lista deste aparelho? Isso não cancela o pedido: para cancelar, use o botão Cancelar pedido ou escreva pelo Fale com o IMED.')) return;
    // Pelo pedido mostrado, não pela posição: a lista pode ter mudado em outra aba.
    const all = readAppts().filter((x) => apptKey(x) !== b.dataset.rm);
    try { localStorage.setItem('imed_appts', JSON.stringify(all)); } catch { /* ignora */ }
    drawAppts(all); toast('Pedido removido da lista');
  }; });
  box.querySelectorAll('[data-ics]').forEach((b) => { b.onclick = () => { const a = readAppts().find((x) => apptKey(x) === b.dataset.ics); if (a) downloadIcs(a); else drawAppts(readAppts()); }; });
  box.querySelectorAll('[data-cancel]').forEach((b) => { b.onclick = () => { cancelAsk = b.dataset.cancel; drawAppts(readAppts()); box.querySelector('[data-cancel-yes]')?.focus(); }; });
  box.querySelectorAll('[data-cancel-no]').forEach((b) => { b.onclick = () => { const k = cancelAsk; cancelAsk = ''; drawAppts(readAppts()); focusCard(k, '[data-cancel]'); }; });
  box.querySelectorAll('[data-cancel-yes]').forEach((b) => { b.onclick = () => cancelAppt(b.dataset.cancelYes); });
}
// Foco de volta no cartão do pedido: no botão pedido (sel) ou, sem ele, no próprio cartão.
function focusCard(key, sel = '') {
  const card = [...document.querySelectorAll('#appts .appt')].find((el) => el.dataset.key === key);
  if (!card) return;
  const target = (sel && card.querySelector(sel)) || card;
  if (target === card) card.tabIndex = -1;
  target.focus();
}
// Cancela no banco (cancel_request, com o código do pedido) e guarda "cancelado" no aparelho.
async function cancelAppt(key) {
  const a = readAppts().find((x) => apptKey(x) === key);
  if (!a || !a.id || !a.token || cancelBusy) return;
  const T = await loadTrust();
  const antes = liveStatus[a.id]?.status;   // a situação antes de cancelar decide se o horário volta a ficar livre
  cancelBusy = key; drawAppts(readAppts());
  let res;
  try { res = await rpc('cancel_request', { p_id: a.id, p_token: a.token }); } catch { res = 'error'; }
  cancelBusy = '';
  if (res === 'ok' || res === 'already_cancelled') {
    cancelAsk = '';
    liveStatus[a.id] = { ...(liveStatus[a.id] || {}), id: a.id, status: 'cancelled' };
    try {
      const all = readAppts().map((x) => (apptKey(x) === key ? { ...x, status: 'cancelado' } : x));
      localStorage.setItem('imed_appts', JSON.stringify(all));
    } catch { /* sem armazenamento: a situação vem do banco */ }
    drawAppts(readAppts());
    toast(res === 'ok' ? (T.cancelDoneText?.(a.slot, T.placeType?.(a) ?? '', a.phone || '', antes) || 'Pedido cancelado.') : (T.CANCEL_MSG?.already_cancelled || 'Este pedido já estava cancelado.'));
    focusCard(key);
    return;
  }
  // Não deu. Falha de internet: a pergunta continua aberta para tentar de novo. Recusa do banco (já concluído,
  // horário passado...): fecha a pergunta e busca a situação de novo.
  const final = (T.CANCEL_FINAL || []).includes(res);
  if (final) cancelAsk = '';
  drawAppts(readAppts());
  toast(T.CANCEL_MSG?.[res] || T.CANCEL_MSG?.error || 'Não foi possível cancelar agora.');
  if (final) fetchStatus(readAppts());
  focusCard(key, final ? '' : '[data-cancel-yes]');
}
async function downloadIcs(a) {
  const m = await loadGeoCore();
  if (!m.icsFile) { toast('Não foi possível criar o lembrete agora.'); return; }
  const items = Array.isArray(a.items) && a.items.length ? a.items.join(', ') : 'Atendimento';
  const prep = (m.PREP && (m.PREP[a.exam] || m.PREP.outro)) || '';
  const site = C.siteUrl || location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  // Horário marcado: evento na hora exata e já confirmado (STATUS:CONFIRMED); sem horário, a faixa do período.
  // Enquanto o local não confirma, o título do lembrete leva "(a confirmar)" (geo-core.icsFile).
  const slot = a.slot && slotAt(a.slot) ? a.slot : null;
  const confirmed = !!slot || ['confirmed', 'completed'].includes(a.id && liveStatus[a.id]?.status);
  const head = slot
    ? [`Agendamento ${a.code || ''}`.trim(), 'no IMED. Horário confirmado. Chegue com 15 minutos de antecedência.'].join(' ')
    : [`Pedido de agendamento ${a.code || ''}`.trim(), confirmed ? 'no IMED. Confirmado pelo local: confira o horário combinado.' : 'no IMED. O horário é confirmado pela clínica.'].join(' ');
  const desc = [head, prep ? `Preparo: ${prep}` : ''].filter(Boolean).join('\n');
  let txt;
  try { txt = m.icsFile({ id: a.id || a.code, title: `${items} · ${a.name}`, date: a.date, period: a.period, slot, confirmed, description: desc, url: a.id ? `${site}conta.html#pedido-${a.id}` : site }); }
  catch { toast('Não foi possível criar o lembrete agora.'); return; }
  const url = URL.createObjectURL(new Blob([txt], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `imed-${(a.code || 'pedido').toLowerCase()}.ics`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Lembrete baixado. Abra o arquivo para pôr na agenda.');
}

/* ======================= TELECONSULTA ======================= */
// "Médicos atendendo agora": número real da função tele_doctors_online (médicos aprovados com a página aberta).
// Sem resposta ou sem médico: "Nenhum médico atendendo agora" e a lista de espera aparece.
let teleStarted = false;
async function loadTele() {
  const box = $('#teleNow'); if (!box) return;
  let n = 0;
  try {
    // Hoje a função devolve uma linha por médico; um número (ou { count }) também é aceito.
    const rows = await rpc('tele_doctors_online');
    const v = Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object').length : Number(rows?.count ?? rows);
    n = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  } catch { n = 0; }
  box.classList.toggle('on', n > 0);
  // A função devolve até 50 médicos: com 50, pode haver mais.
  box.querySelector('span').textContent = n > 0 ? `Médicos atendendo agora: ${n >= 50 ? '50 ou mais' : n}` : 'Nenhum médico atendendo agora';
  const wait = $('#teleWait'), showed = wait.hidden && n === 0;
  // A lista de espera aparece acima do que tem o foco (o "É médico?", por exemplo): o foco continua no mesmo lugar
  // da tela (WCAG 2.4.11), sem a página pular. Só quando o foco estava na tela: se a pessoa rolou para longe dele,
  // nada muda.
  const a = document.activeElement;
  const below = showed && a && a !== document.body && (wait.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
  const before = below ? a.getBoundingClientRect() : null;
  const seen = !!before && before.bottom > 0 && before.top < innerHeight;
  wait.hidden = n > 0;
  if (seen) {
    const moved = a.getBoundingClientRect().top - before.top;
    if (Math.abs(moved) > 1) window.scrollBy(0, moved);
  }
}
(function () {
  const sec = $('#lista'); if (!sec) return;
  const start = () => { if (teleStarted) return; teleStarted = true; loadTele(); };
  if (!('IntersectionObserver' in window)) return start();
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '400px' });
  io.observe(sec);
})();
function goTele() {
  if (S.view !== 'inicio') go('inicio');
  const f = $('#wlForm'); if (f) f.interest.value = 'teleconsulta';
  setTimeout(() => { $('#lista').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); }, 60);
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-tele]')) { e.preventDefault(); goTele(); } });
(function () {
  const f = $('#wlForm'); if (!f) return;
  const msg = $('#wlMsg'), btn = $('#wlBtn');
  const say = (t, cls) => { msg.textContent = t; msg.className = 'wl-msg show ' + cls; };
  if (store.get('wl', false)) say('Você já está na lista. Os avisos vão para o seu e-mail.', 'ok');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = f.email.value.trim().toLowerCase(), city = f.city.value.trim();
    const bad = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    f.email.classList.toggle('bad', bad);
    f.email.setAttribute('aria-invalid', String(bad));
    if (bad) { say('Digite um e-mail válido.', 'err'); f.email.focus(); return; }
    const ok = () => { store.set('wl', true); f.reset(); say('Pronto! Você está na lista e vai receber os avisos da teleconsulta no seu e-mail.', 'ok'); btn.disabled = false; btn.innerHTML = 'Quero receber avisos <i class="fa-solid fa-bell" aria-hidden="true"></i>'; };
    if (f.website.value) { ok(); return; }
    btn.disabled = true; btn.textContent = 'Enviando…';
    window.imedInsert('app_waitlist', { email, city: city || null, interest: f.interest.value }).then(ok).catch(() => {
      say('Não foi possível enviar agora. Verifique sua internet e tente de novo.', 'err');
      btn.disabled = false; btn.innerHTML = 'Tentar de novo <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>';
    });
  });
})();

/* ======================= PERGUNTAS: VER TODAS ======================= */
(function () {
  const b = $('#faqAll'), more = $('#faqMore'); if (!b || !more) return;
  b.onclick = () => {
    more.hidden = false; b.remove();
    const first = more.querySelector('summary'); if (first) first.focus();
  };
})();

/* ======================= WHATSAPP ======================= */
(function () {
  const digits = String(C.whatsapp || '').replace(/\D/g, '');
  const a = $('#waFab');
  if (!a || digits.length < 10) { if (a) a.remove(); return; }
  a.href = `https://wa.me/${digits}?text=${encodeURIComponent('Olá! Vim pelo site do IMED e quero ajuda para marcar um exame.')}`;
  a.setAttribute('aria-label', 'Falar com o IMED pelo WhatsApp (abre em outra aba)');
  a.classList.remove('hide');
})();

/* ======================= LINKS DIRETOS ======================= */
function route() {
  const h = decodeURIComponent(location.hash || '');
  let m;
  if (h === '#agenda') { go('agenda'); return; }
  if (h === '#tele' || h === '#lista') { goTele(); return; }
  if (h === '#perto') { location.replace('perto.html?usar=localizacao'); return; }
  if (h === '#perfil') { location.replace('conta.html'); return; }
  if ((m = h.match(/^#exame-(\w+)$/)) && EXAMS[m[1]]) { location.replace(examUrl(m[1])); return; }
  // #cidade e #cidades abrem o seletor de cidade (sem pedido automático de localização).
  if (h === '#cidade' || h === '#cidades') { setHash(''); PERTO?.abrirSeletor(); return; }
  if (h === '#lojas' || h === '#pedido' || /^#clinica-/.test(h)) { setHash(''); setTimeout(() => $('#reais').scrollIntoView(), 60); }
}
addEventListener('hashchange', route);

/* ======================= APP INSTALÁVEL ======================= */
let installEvt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const showInstall = (on) => document.querySelectorAll('.install-auto').forEach((b) => b.classList.toggle('hide', !on));
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (!isStandalone()) showInstall(true); });
addEventListener('appinstalled', () => { installEvt = null; showInstall(false); toast('App IMED instalado!'); });
if (isIOS && !isStandalone()) showInstall(true);
if (isStandalone()) document.querySelectorAll('[data-install]').forEach((b) => b.classList.add('hide'));
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-install]')) return;
  if (installEvt) { installEvt.prompt(); installEvt.userChoice.finally(() => { installEvt = null; showInstall(false); }); return; }
  openSheet(head('Instalar o app IMED') + `<div class="sh-body inst">
    <div class="inst-app"><img src="assets/icons/icon-192.png" alt=""><div><b>IMED</b><small>Clínicas e exames perto de você</small></div></div>
    <h4><i class="fa-brands fa-apple" aria-hidden="true"></i> iPhone (Safari)</h4>
    <ol><li>Toque em <b>Compartilhar</b> na barra do Safari.</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li><li>Toque em <b>Adicionar</b>.</li></ol>
    <h4><i class="fa-brands fa-android" aria-hidden="true"></i> Android (Chrome)</h4>
    <ol><li>Toque no menu <b>⋮</b> do Chrome.</li><li>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li></ol>
    <p class="note">O app abre em tela cheia e as telas que você já visitou abrem mais rápido.</p>
  </div>`, 'sm', 'Instalar o app IMED');
});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // Quando sai uma versão nova do site, recarrega uma vez sozinho para mostrá-la.
  const hadSW = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadSW && !reloaded) { reloaded = true; location.reload(); } });
  // Com economia de dados ou internet 2G, não instala o service worker: ao instalar (e a cada versão nova),
  // ele baixa de uma vez os arquivos de todas as páginas, inclusive o 3D que o modo leve não usa.
  if (!SAVE_DATA) addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {}));
}

/* ======================= APARECER AO ROLAR ======================= */
const rvIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); rvIO.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.rv').forEach((el) => rvIO.observe(el));

/* ======================= INÍCIO ======================= */
// A tela "Clínicas perto de você": lê a cidade guardada e a permissão, decide se pede a localização ao abrir e
// avisa quando a origem muda (origemMudou).
PERTO = iniciarPerto({
  rpc, geocode, toast, openSheet, closeSheet, head, loadLeaflet, loadCities, focar: focusVisible,
  mapa: C.map || {}, economia: SAVE_DATA, reduzir: reduceMotion,
  aoMudarOrigem: origemMudou,
});
document.body.dataset.origem = 'espera';
renderCats(); headerState();
loadCities().catch(() => { freeSrc(); /* sem número: texto neutro */ });
startHero();
route();
