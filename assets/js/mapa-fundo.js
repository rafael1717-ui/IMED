// Fundo dos mapas do Leaflet: o mapa desenhado (OpenStreetMap) e, quando o site tem a chave da Esri em config.js, a
// foto de satélite (Esri World Imagery) com os botões "Mapa | Satélite". A escolha fica guardada no aparelho
// (localStorage imed_mapa_fundo) e vale para todos os mapas do site. Sem a chave: só o mapa desenhado, sem botões e
// sem nenhum pedido à Esri — o site fica como antes.
// Uso: fundoDoMapa(L, map, { padrao: 'satelite' | 'mapa', posicao: 'topright' })
//   → { atual(), usar(v) }  (atual() devolve 'mapa' ou 'satelite')
const CHAVE = 'imed_mapa_fundo';
const lembrado = () => { try { const v = localStorage.getItem(CHAVE); return v === 'mapa' || v === 'satelite' ? v : ''; } catch { return ''; } };
const lembrar = (v) => { try { localStorage.setItem(CHAVE, v); } catch { /* sem armazenamento */ } };

export function fundoDoMapa(L, map, { padrao = 'satelite', posicao = 'topright' } = {}) {
  const CFG = window.IMED_CONFIG || {};
  const base = CFG.map || {};
  const osm = L.tileLayer(base.tiles, { maxZoom: base.maxZoom, attribution: base.attribution });
  const url = typeof CFG.sateliteUrl === 'function' ? CFG.sateliteUrl() : '';
  if (!url) { osm.addTo(map); return { atual: () => 'mapa', usar() { /* só o mapa desenhado */ } }; }
  // A foto fica numa camada própria (sem o filtro escuro do tema) e pode ir até o nível da Esri.
  if (!map.getPane('satelite')) map.createPane('satelite').style.zIndex = '200';
  const sat = CFG.satelite || {};
  const foto = L.tileLayer(url, { maxZoom: sat.maxZoom || base.maxZoom, attribution: sat.attribution || '', pane: 'satelite', className: 'tl-satelite' });
  let atual = '';
  const botoes = {};
  const Controle = L.Control.extend({
    onAdd() {
      const box = L.DomUtil.create('div', 'mapa-fundo');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Fundo do mapa');
      for (const [v, texto] of [['mapa', 'Mapa'], ['satelite', 'Satélite']]) {
        const b = L.DomUtil.create('button', '', box);
        b.type = 'button';
        b.textContent = texto;
        b.dataset.fundo = v;
        b.setAttribute('aria-pressed', 'false');
        L.DomEvent.on(b, 'click', (e) => { L.DomEvent.stop(e); usar(v, true); });
        botoes[v] = b;
      }
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      return box;
    },
  });
  new Controle({ position: posicao }).addTo(map);
  function usar(v, pessoa = false) {
    v = v === 'satelite' ? 'satelite' : 'mapa';
    if (v === atual) return;
    atual = v;
    if (v === 'satelite') { map.removeLayer(osm); foto.addTo(map); } else { map.removeLayer(foto); osm.addTo(map); }
    for (const [k, b] of Object.entries(botoes)) b.setAttribute('aria-pressed', String(k === v));
    if (pessoa) lembrar(v);
  }
  usar(lembrado() || padrao);
  return { atual: () => atual, usar };
}
