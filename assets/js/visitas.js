// Contador de visitas próprio do IMED: quantas vezes cada página do site foi aberta, por dia.
// Sem cookies e sem dados pessoais (LGPD): não grava nada no aparelho (nem cookie, nem localStorage) e manda
// ao banco só o caminho da página, sem o que vem depois de "?" ou "#" (ex.: "/perto.html"). A função track do
// banco soma 1 no total do dia; ela não guarda IP, aparelho, navegador, conta nem nenhum identificador.
//
// Não conta:
//   - com "Não rastrear" (Do Not Track) ou "Controle Global de Privacidade" (GPC) ligado no navegador;
//   - no computador de testes (localhost, 127.0.0.1, rede local, arquivo aberto direto) nem em navegador
//     automatizado (robôs de busca e os testes de ponta a ponta), a não ser que o endereço da página tenha
//     ?visitas=teste. Com "Não rastrear"/GPC ligado, nem assim.
//
// window.IMED_TRACK(evento, detalhe) conta uma busca sem dado pessoal (a lista aceita está na função track,
// em supabase/migrations/20261030143839_visitas.sql):
//   busca_exame (código do exame, ex.: "rm"), busca_tipo (tipo de local, ex.: "imagem") e
//   busca_cidade ("UF/Cidade", ex.: "SP/São Paulo"). Cada busca conta uma vez por página aberta.
//   Pedidos e teleconsultas não passam por aqui: a equipe vê o número real, das próprias tabelas do banco.
// Quem chama usa window.IMED_TRACK?.(...): a página continua igual se este arquivo não carregar.
//
// Uso: depois do config.js, com defer, em todas as páginas (node scripts/aplicar-visitas.mjs põe e confere):
//   <script src="assets/js/visitas.js" defer></script>      (na página 404: data-pagina="/404")
// Se algo falhar (sem internet, banco fora do ar), nada acontece: a página nunca quebra por causa disto.
(function () {
  'use strict';
  var w = window;
  if (typeof w.IMED_TRACK === 'function') return; // carregado duas vezes: conta uma vez só
  var d = document;
  var n = w.navigator || {};
  var loc = w.location;
  var me = d.currentScript;
  var src = (me && me.src) || '';
  var fixa = (me && me.getAttribute && me.getAttribute('data-pagina')) || '';
  // Raiz do site: o endereço deste arquivo sem "assets/js/visitas.js" ("/<repositório>/" no GitHub Pages; "/" no domínio próprio).
  var raiz = '/';
  try { raiz = new URL(src.replace(/assets\/js\/visitas\.js(?:[?#].*)?$/, '')).pathname; } catch (e) { /* sem src: raiz "/" */ }

  function liga() {
    try {
      var teste = /[?&]visitas=teste(?:&|$)/.test(String(loc.search));
      var privado = n.globalPrivacyControl === true || n.doNotTrack === '1' || n.doNotTrack === 'yes'
        || w.doNotTrack === '1' || n.msDoNotTrack === '1';
      var host = String(loc.hostname || '').toLowerCase();
      var local = loc.protocol === 'file:' || !host
        || /^(localhost|0\.0\.0\.0|\[::1\]|::1|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/.test(host)
        || /\.(?:local|localhost)$/.test(host);
      // Robôs: o navegador automatizado se anuncia (navigator.webdriver) e os de busca dizem no nome.
      var robo = n.webdriver === true
        || /bot\/|crawler|spider|slurp|headless|lighthouse|pagespeed|\+https?:/i.test(String(n.userAgent || ''));
      return !privado && (teste || (!local && !robo));
    } catch (e) {
      return false;
    }
  }
  var ligado = liga();

  // Caminho da página a partir da raiz do site, sem "?", "#" e sem "index.html": "/", "/perto.html",
  // "/exames/raio-x.html", "/cidades/sp/sao-paulo/". Vazio se a página não é do site.
  function caminho() {
    if (fixa) return fixa;
    var p = String(loc.pathname || '/');
    if (p.indexOf(raiz) !== 0) return '';
    p = '/' + p.slice(raiz.length);
    p = p.replace(/(^|\/)index\.html$/, '$1');
    // O GitHub Pages também abre "/perto" como "perto.html".
    if (!/\/$/.test(p) && !/\.[a-z0-9]+$/i.test(p)) p += '.html';
    return p;
  }

  // Sempre como visitante: só a chave publishable no cabeçalho "apikey" (IMED_CONFIG.supabaseHeaders sem token; nunca
  // a sessão de quem entrou na conta), sem cookie e sem o endereço da página de origem (referrerPolicy).
  // keepalive: o envio termina mesmo se a pessoa sair da página na hora (o fetch com keepalive leva os cabeçalhos;
  // o sendBeacon não levaria).
  function envia(corpo) {
    var c = w.IMED_CONFIG;
    if (!c || !c.supabaseUrl || !c.supabaseKey || typeof c.supabaseHeaders !== 'function' || typeof w.fetch !== 'function') return false;
    try {
      var r = w.fetch(c.supabaseUrl + '/rest/v1/rpc/track', {
        method: 'POST',
        headers: c.supabaseHeaders(null, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(corpo),
        keepalive: true,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer'
      });
      if (r && typeof r.then === 'function') r.then(null, function () { /* sem internet ou banco fora do ar */ });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Uma visita por página aberta, depois que a página terminou de carregar (sem disputar a internet com ela).
  var contada = false;
  function visita() {
    if (contada || !ligado || d.prerendering) return;
    var p = caminho();
    if (!p) return;
    contada = true;
    envia({ p_path: p });
  }
  function quandoLivre(fn) {
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 2000 });
    else setTimeout(fn, 200);
  }
  function agenda() {
    // Página pré-carregada pelo navegador (ainda não vista): só conta quando a pessoa abrir.
    if (d.prerendering) { d.addEventListener('prerenderingchange', agenda, { once: true }); return; }
    if (d.readyState === 'complete') quandoLivre(visita);
    else w.addEventListener('load', function () { quandoLivre(visita); }, { once: true });
  }

  var vistos = {};
  var eventos = 0;
  w.IMED_TRACK = function (evento, detalhe) {
    try {
      if (!ligado || typeof evento !== 'string' || !/^[a-z_]{3,40}$/.test(evento)) return false;
      var det = detalhe == null ? '' : String(detalhe).replace(/\s+/g, ' ').trim();
      // Nada que pareça e-mail, telefone, CPF ou CEP (o banco também recusa).
      if (det.length > 80 || /@|\d{5}/.test(det)) return false;
      var chave = evento + '|' + det;
      if (evento.indexOf('busca') === 0) {
        if (vistos[chave]) return false;
        vistos[chave] = 1;
      }
      if (++eventos > 40) return false;
      var p = caminho();
      if (!p) return false;
      var corpo = { p_path: p, p_event: evento };
      if (det) corpo.p_detail = det;
      return envia(corpo);
    } catch (e) {
      return false;
    }
  };

  if (!ligado) return;
  try {
    agenda();
    // Saiu antes de a página terminar de carregar: conta mesmo assim (o envio usa keepalive).
    w.addEventListener('pagehide', visita);
    // Voltou pela seta "voltar" e o navegador mostrou a página guardada: é uma nova visita.
    w.addEventListener('pageshow', function (e) { if (e && e.persisted) { contada = false; agenda(); } });
  } catch (e) { /* nunca quebra a página */ }
})();
