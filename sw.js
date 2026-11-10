// Service worker do IMED: deixa o site abrir rápido e funcionar sem internet.
// Ao mudar arquivos do site, aumente a versão para os celulares baixarem a nova.
// O mapa 3D do topo (hero3d.js e a biblioteca MapLibre, assets/vendor/maplibre, ~1,6 MB) fica fora do CORE: aparelhos
// fracos, com economia de dados ou "reduzir movimento" não o baixam; nos demais ele entra no cache no primeiro uso.
// O mesmo vale para o pdf-lib e o gerador de QR (só o médico usa) e para o Font Awesome completo (só baixa se faltar
// algum ícone no recorte icones.min.css). Os ladrilhos do mapa (OpenFreeMap) são de outro site: vão sempre pela
// internet (o navegador guarda no cache dele).
const VERSION = 'imed-v32';
const CORE = [
  './', './index.html', './perto.html', './parceiros.html', './privacidade.html', './exames/',
  './conta.html', './reivindicar.html', './painel.html', './cidades/', './local.html', './sobre.html',
  './termos.html', './como-funciona.html', './acessibilidade.html', './contato.html', './para-medicos.html', './teleconsulta.html', './medico.html',
  './termo-teleconsulta.html', './documento.html', './definir-senha.html', './manifest.webmanifest', './assets/js/config.js', './assets/js/tema.js', './assets/css/tema.css', './assets/js/aviso.js', './assets/js/data.js',
  './assets/js/db.js', './assets/js/visitas.js', './assets/js/inicio.js', './assets/js/inicio-core.js', './assets/js/inicio-perto.js', './assets/js/exames-nomes.js', './assets/js/auth.js', './assets/js/entrada-senha.js', './assets/js/definir-senha.js', './assets/js/conta.js', './assets/js/clinica.js',
  './assets/js/painel.js', './assets/js/agenda-core.js', './assets/js/agenda-config.js', './assets/js/estatisticas.js', './assets/js/reivindicar.js', './assets/js/cidade.js', './assets/js/local.js', './assets/js/geo-core.js',
  './assets/js/perto.js', './assets/js/parceiros.js', './assets/js/confianca.js', './assets/js/contato.js', './assets/js/teleconsulta.js', './assets/js/medico.js',
  './assets/js/tele-core.js', './assets/js/tele-docs.js', './assets/js/ws-core.js', './assets/js/ws-layout.js', './assets/js/ws-prontuario.js', './assets/css/ws.css', './assets/js/documento.js', './assets/css/conta.css', './assets/css/clinica.css', './assets/css/cidade.css',
  './assets/css/local.css', './assets/css/perto.css', './assets/css/rodape.css', './assets/css/texto.css', './assets/css/guia.css', './assets/css/tele.css', './assets/css/para-medicos.css',
  './assets/fonts/inter-latin.woff2', './assets/fonts/inter-latin-ext.woff2', './assets/fonts/sora-latin.woff2', './assets/fonts/sora-latin-ext.woff2', './assets/vendor/fa/css/icones.min.css', './assets/vendor/fa/webfonts/icones-solid-900.woff2',
  './assets/vendor/fa/webfonts/icones-regular-400.woff2', './assets/vendor/fa/webfonts/icones-brands-400.woff2', './assets/vendor/leaflet/leaflet.js', './assets/vendor/leaflet/leaflet.css', './assets/icons/icon-192.png', './assets/img/ico-rx.webp',
  './assets/img/ico-usg.webp', './assets/img/ico-tc.webp', './assets/img/ico-rm.webp', './assets/img/ico-mamo.webp', './assets/img/ico-dens.webp', './assets/img/ico-ecg.webp',
  './assets/img/ico-eco.webp', './assets/img/ico-rx-96.webp', './assets/img/ico-usg-96.webp', './assets/img/ico-tc-96.webp', './assets/img/ico-rm-96.webp', './assets/img/ico-mamo-96.webp',
  './assets/img/ico-dens-96.webp', './assets/img/ico-ecg-96.webp', './assets/img/ico-eco-96.webp'
];

self.addEventListener('install', e => {
  // cache: 'reload' ignora o cache do navegador, para não guardar uma cópia antiga.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Outros sites (banco de dados, mapas): sempre pela internet.
  if (url.origin !== self.location.origin) return;

  // Páginas: tenta a internet primeiro para mostrar a versão mais nova.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
    return;
  }
  // Scripts, estilos e dados: internet primeiro, para nunca rodar código antigo; sem internet, o cache.
  if (/\.(js|css|json|webmanifest)$/.test(url.pathname)) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req)));
    return;
  }
  // Imagens e fontes: responde do cache e atualiza em segundo plano.
  e.respondWith(caches.open(VERSION).then(c => c.match(req).then(hit => {
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })));
});
