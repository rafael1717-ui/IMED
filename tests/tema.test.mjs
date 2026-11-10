// Testes do tema claro/escuro (assets/js/tema.js, assets/css/tema.css, scripts/aplicar-tema.mjs e o rodapé).
// - regras puras do tema.js (no Node ele devolve só elas);
// - o tema.js num navegador de mentira (vm): escolha guardada, aparelho, sem armazenamento, troca, outra aba,
//   barra do navegador (theme-color) e botões;
// - tema.css: os dois blocos escuros iguais e só na tela, todo token escuro com valor claro de reserva igual ao da
//   página inicial, e contraste AA nos dois temas;
// - todas as páginas (raiz, exames/, cidades/ e 404) com o tema.js síncrono e o tema.css no <head>, no lugar certo.
// O comportamento num navegador de verdade (sem piscar, impressão clara, teclado) fica em tests/e2e-tema.mjs.
// Rodar com: node --test tests/tema.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { comTema, tagsTema, paginasComTema } from '../scripts/aplicar-tema.mjs';
import { relDe } from '../scripts/aplicar-rodape.mjs';
import { rodapeHtml, temaHtml, TEMAS } from '../scripts/rodape.mjs';
import { generate, cityDir, typePath, TYPES } from '../scripts/gerar-cidades.mjs';
import { CAMINHO } from './endereco.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const T = createRequire(import.meta.url)('../assets/js/tema.js');
const TEMA_JS = read('assets/js/tema.js');
const CSS = read('assets/css/tema.css');

/* ============================== regras puras ============================== */
test('regras: escolha válida, tema que vale, ordem do botão, rótulos e cor da barra', () => {
  assert.equal(T.CHAVE, 'imed_tema');
  assert.deepEqual(T.ESCOLHAS, ['auto', 'claro', 'escuro']);
  for (const [v, e] of [['claro', 'claro'], ['escuro', 'escuro'], ['auto', 'auto'], [null, 'auto'], [undefined, 'auto'], ['dark', 'auto'], ['ESCURO', 'auto'], ['', 'auto']]) {
    assert.equal(T.normalizar(v), e, String(v));
  }
  assert.equal(T.efetivo('auto', false), 'claro');
  assert.equal(T.efetivo('auto', true), 'escuro');
  assert.equal(T.efetivo('claro', true), 'claro', 'Claro escolhido vale mesmo com o aparelho escuro');
  assert.equal(T.efetivo('escuro', false), 'escuro');
  assert.equal(T.efetivo('lixo', true), 'escuro', 'escolha estranha = automático');
  // Automático → Claro → Escuro → Automático
  assert.deepEqual([T.proxima('auto'), T.proxima('claro'), T.proxima('escuro'), T.proxima('lixo')], ['claro', 'escuro', 'auto', 'claro']);
  assert.deepEqual(T.ESCOLHAS.map(T.rotulo), ['Tema: automático', 'Tema: claro', 'Tema: escuro']);
  assert.equal(T.aviso('escuro', 'escuro'), 'Tema escuro');
  assert.equal(T.aviso('claro', 'claro'), 'Tema claro');
  assert.equal(T.aviso('auto', 'escuro'), 'Tema automático, igual ao do aparelho (agora escuro)');
  assert.equal(T.atributo('escuro'), 'dark');
  assert.equal(T.atributo('claro'), 'light');
  assert.equal(T.corDaBarra('claro', '#05161e'), '#05161e', 'no claro, a cor que a página já tinha');
  assert.equal(T.corDaBarra('escuro', '#05161e'), T.COR_ESCURA);
  assert.equal(T.corDaBarra('escuro', '#05161e', '#000000'), '#000000', 'data-escuro do meta manda');
  assert.equal(T.COR_ESCURA, tokens(blocoEscuro(0))['--bg'], 'a barra do navegador no escuro é o fundo escuro');
});

/* ============================== navegador de mentira ============================== */
// Só o que o tema.js usa: atributos, metas, botões, eventos, localStorage e matchMedia.
function navegador({ guardado, semArmazenamento = false, escuro = false, metas = [{ name: 'theme-color', content: '#05161e' }], botoes = [] } = {}) {
  const ouvintes = { doc: {}, win: {} };
  const ouvir = (m) => (tipo, fn) => { (m[tipo] ||= []).push(fn); };
  const disparar = (m, tipo, ev) => (m[tipo] || []).forEach((fn) => fn(ev));
  let raizEl;
  class El {
    constructor(tag, attrs = {}) {
      this.tagName = tag.toUpperCase();
      this.attrs = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
      this.parentNode = null;
      this.children = [];
      this.style = {};
      const cls = new Set();
      this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) };
      this.offsetHeight = 0;
      this.textContent = '';
    }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    removeAttribute(k) { this.attrs.delete(k); }
    hasAttribute(k) { return this.attrs.has(k); }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === raizEl; }
    querySelectorAll(sel) { return todos(this).filter((el) => casa(el, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    closest(sel) { for (let n = this; n; n = n.parentNode) if (casa(n, sel)) return n; return null; }
  }
  const todos = (n) => n.children.flatMap((c) => [c, ...todos(c)]);
  // Seletores simples: tag[attr], tag[attr="v"], :not([attr]), separados por vírgula.
  const casa = (el, sel) => sel.split(',').some((s) => {
    const m = s.trim().match(/^([a-z]+)((?:\[[^\]]+\])*)((?::not\(\[[^\]]+\]\))*)$/);
    if (!m || el.tagName !== m[1].toUpperCase()) return false;
    for (const [, k, v] of m[2].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) if (!el.hasAttribute(k) || (v !== undefined && el.getAttribute(k) !== v)) return false;
    for (const [, k] of m[3].matchAll(/\[([\w-]+)\]/g)) if (el.hasAttribute(k)) return false;
    return true;
  });
  raizEl = new El('html');
  const head = raizEl.appendChild(new El('head'));
  for (const a of metas) head.appendChild(new El('meta', a));
  const loja = new Map(guardado === undefined ? [] : [['imed_tema', guardado]]);
  const localStorage = { getItem: (k) => (loja.has(k) ? loja.get(k) : null), setItem: (k, v) => loja.set(k, String(v)), removeItem: (k) => loja.delete(k) };
  const mq = { matches: escuro, fn: null, addEventListener(t, fn) { this.fn = fn; } };
  const eventos = [];
  const document = {
    documentElement: raizEl, head, body: null,
    querySelector: (s) => raizEl.querySelector(s), querySelectorAll: (s) => raizEl.querySelectorAll(s),
    createElement: (t) => new El(t),
    addEventListener: ouvir(ouvintes.doc),
    dispatchEvent: (ev) => { eventos.push(ev); return true; },
  };
  const window = {
    get localStorage() { if (semArmazenamento) throw new Error('SecurityError: armazenamento bloqueado'); return localStorage; },
    matchMedia: () => mq,
    addEventListener: ouvir(ouvintes.win),
    requestAnimationFrame: (fn) => fn(),
  };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail; this.bubbles = init.bubbles; } }
  const timers = [];
  vm.runInNewContext(TEMA_JS, { window, document, CustomEvent, setTimeout: (fn) => timers.push(fn), console });
  const nav = {
    window, document, loja, mq, eventos, El,
    tema: window.IMED_TEMA,
    attr: (k) => raizEl.getAttribute(k),
    meta: () => raizEl.querySelectorAll('meta[name="theme-color"]').map((m) => m.getAttribute('content')),
    // O resto da página chega: <body> com os botões e o DOMContentLoaded.
    carregar() {
      document.body = raizEl.appendChild(new El('body'));
      for (const b of botoes) document.body.appendChild(new El('button', b));
      disparar(ouvintes.doc, 'DOMContentLoaded', {});
    },
    clicar(el) { disparar(ouvintes.doc, 'click', { target: el }); timers.splice(0).forEach((f) => f()); },
    focar(el) { disparar(ouvintes.doc, 'focusin', { target: el }); },
    aparelho(escuroAgora) { mq.matches = escuroAgora; mq.fn(); },
    outraAba(valor) { if (valor === null) loja.delete('imed_tema'); else loja.set('imed_tema', valor); disparar(ouvintes.win, 'storage', { key: 'imed_tema' }); },
  };
  return nav;
}

test('tema.js ao abrir: escolha guardada × aparelho, já no <html> (antes da primeira pintura)', () => {
  const casos = [
    [undefined, false, 'auto', 'light'], [undefined, true, 'auto', 'dark'],
    ['claro', true, 'claro', 'light'], ['escuro', false, 'escuro', 'dark'],
    ['auto', true, 'auto', 'dark'], ['lixo', false, 'auto', 'light'],
  ];
  for (const [guardado, escuro, escolha, theme] of casos) {
    const n = navegador({ guardado, escuro });
    assert.equal(n.attr('data-theme'), theme, `${guardado} + aparelho ${escuro ? 'escuro' : 'claro'}`);
    assert.equal(n.attr('data-tema-escolha'), escolha);
    assert.deepEqual(n.meta(), [theme === 'dark' ? T.COR_ESCURA : '#05161e'], 'barra do navegador acompanha');
    assert.deepEqual({ ...n.tema.atual() }, { escolha, tema: theme === 'dark' ? 'escuro' : 'claro' }); // objeto de outro contexto (vm)
    assert.equal(n.eventos.length, 0, 'abrir a página não dispara evento');
  }
});

test('tema.js: escolher guarda no aparelho, troca o tema, avisa (evento) e alternar segue a ordem', () => {
  const n = navegador({ escuro: false });
  n.carregar();
  n.tema.escolher('escuro');
  assert.equal(n.loja.get('imed_tema'), 'escuro');
  assert.equal(n.attr('data-theme'), 'dark');
  assert.deepEqual(n.meta(), [T.COR_ESCURA]);
  assert.equal(n.eventos.at(-1).type, 'imed:tema');
  assert.deepEqual({ ...n.eventos.at(-1).detail }, { escolha: 'escuro', tema: 'escuro' });
  assert.equal(n.eventos.at(-1).bubbles, true, 'chega também no window');
  assert.ok(!n.document.documentElement.classList.contains('tema-trocando'), 'transições voltam depois da troca');
  n.tema.escolher('auto');
  assert.equal(n.loja.has('imed_tema'), false, 'Automático = sem chave no aparelho');
  assert.equal(n.attr('data-theme'), 'light');
  assert.deepEqual(n.meta(), ['#05161e'], 'volta a cor da página');
  const seq = [n.tema.alternar(), n.tema.alternar(), n.tema.alternar()].map((a) => a.escolha);
  assert.deepEqual(seq, ['claro', 'escuro', 'auto']);
  // Mesma escolha de novo: nada muda, nenhum evento.
  const antes = n.eventos.length;
  n.tema.escolher('auto');
  assert.equal(n.eventos.length, antes);
});

test('tema.js: Automático acompanha o aparelho na hora; Claro/Escuro escolhidos não', () => {
  const n = navegador({ escuro: false });
  n.aparelho(true);
  assert.equal(n.attr('data-theme'), 'dark');
  assert.deepEqual({ ...n.eventos.at(-1).detail }, { escolha: 'auto', tema: 'escuro' });
  n.tema.escolher('claro');
  const antes = n.eventos.length;
  n.aparelho(false);
  n.aparelho(true);
  assert.equal(n.attr('data-theme'), 'light', 'Claro escolhido fica claro');
  assert.equal(n.eventos.length, antes);
});

test('tema.js: outra aba mudou a escolha → esta página acompanha', () => {
  const n = navegador();
  n.outraAba('escuro');
  assert.equal(n.attr('data-theme'), 'dark');
  assert.equal(n.attr('data-tema-escolha'), 'escuro');
  n.outraAba(null);
  assert.equal(n.attr('data-tema-escolha'), 'auto');
  assert.equal(n.attr('data-theme'), 'light');
});

test('tema.js sem armazenamento (bloqueado): segue o aparelho e a escolha vale nesta página, sem erro', () => {
  const n = navegador({ semArmazenamento: true, escuro: true });
  assert.equal(n.attr('data-theme'), 'dark');
  assert.equal(n.attr('data-tema-escolha'), 'auto');
  n.carregar();
  assert.doesNotThrow(() => n.tema.escolher('claro'));
  assert.equal(n.attr('data-theme'), 'light');
  n.outraAba('escuro'); // sem armazenamento não há o que ler: fica como está
  assert.equal(n.attr('data-theme'), 'light');
});

test('tema.js: barra do navegador sem meta na página (cria no escuro, tira no claro) e data-escuro', () => {
  const n = navegador({ metas: [], escuro: true });
  assert.deepEqual(n.meta(), [T.COR_ESCURA], 'cria o meta no escuro');
  n.tema.escolher('claro');
  assert.deepEqual(n.meta(), [], 'no claro, a página fica como era (sem meta)');
  const p = navegador({ metas: [{ name: 'theme-color', content: '#05161e', 'data-escuro': '#123456' }], guardado: 'escuro' });
  assert.deepEqual(p.meta(), ['#123456']);
  // Meta com media (claro/escuro do próprio navegador) não é mexido.
  const q = navegador({ metas: [{ name: 'theme-color', content: '#ffffff', media: '(prefers-color-scheme: light)' }], guardado: 'escuro' });
  assert.deepEqual(q.meta(), ['#ffffff', T.COR_ESCURA]);
});

test('tema.js: botões do rodapé e do cabeçalho (rótulo, aria-pressed, clique, região para o leitor de tela)', () => {
  const botoes = [{ type: 'button', class: 'tema-btn', 'data-tema': '' }, ...TEMAS.map(([v]) => ({ type: 'button', 'data-tema-opcao': v, 'aria-pressed': String(v === 'auto') }))];
  const n = navegador({ guardado: 'escuro', botoes });
  n.carregar();
  const [cab, ...ops] = n.document.body.children;
  assert.equal(cab.getAttribute('aria-label'), 'Tema: escuro');
  assert.equal(cab.getAttribute('title'), 'Tema: escuro');
  assert.deepEqual(ops.map((b) => b.getAttribute('aria-pressed')), ['false', 'false', 'true']);
  n.focar(ops[1]);
  const fala = n.document.body.children.find((c) => c.getAttribute('role') === 'status');
  assert.ok(fala, 'região "ao vivo" criada quando a pessoa chega num botão de tema');
  n.clicar(ops[1]);
  assert.equal(n.attr('data-theme'), 'light');
  assert.deepEqual(ops.map((b) => b.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  assert.equal(cab.getAttribute('aria-label'), 'Tema: claro');
  assert.equal(fala.textContent, 'Tema claro');
  n.clicar(cab); // claro → escuro
  assert.equal(n.attr('data-tema-escolha'), 'escuro');
  assert.equal(fala.textContent, 'Tema escuro');
  n.clicar(cab); // escuro → automático (aparelho claro)
  assert.equal(fala.textContent, 'Tema automático, igual ao do aparelho (agora claro)');
  assert.equal(n.loja.has('imed_tema'), false);
  // Botão desabilitado e clique fora de um botão de tema: nada muda.
  cab.setAttribute('disabled', '');
  cab.disabled = true;
  n.clicar(cab);
  n.clicar(n.document.body);
  assert.equal(n.attr('data-tema-escolha'), 'auto');
  // Botão criado depois pela página: ligar() acerta o rótulo.
  const novo = n.document.body.appendChild(new n.El('button', { type: 'button', 'data-tema': '' }));
  n.tema.ligar();
  assert.equal(novo.getAttribute('aria-label'), 'Tema: automático');
});

test('tema.js no Node: só as regras puras, sem tocar em window/document', () => {
  assert.equal(typeof T.efetivo, 'function');
  assert.equal(T.atual, undefined);
  assert.match(TEMA_JS, /^\/\*[\s\S]*?\*\/\n\(function \(\) \{\n  'use strict';/, 'script clássico (sem import/export), tudo dentro de uma função');
  assert.ok(!/\bimport\b|\bexport\b/.test(TEMA_JS.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'nada de módulo: roda síncrono no <head>');
});

/* ============================== tema.css ============================== */
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
function blocoEscuro(i) {
  const css = semComentarios(CSS);
  const sel = [
    /@media screen and \(prefers-color-scheme:dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{([^}]*)\}\s*\}/,
    /@media screen\{\s*:root\[data-theme="dark"\]\{([^}]*)\}\s*\}/,
  ][i];
  const m = css.match(sel);
  assert.ok(m, `bloco escuro ${i + 1} no formato combinado`);
  return m[1];
}
function tokens(corpo) {
  const out = {};
  for (const d of corpo.split(';')) {
    const m = d.trim().match(/^(--[\w-]+|color-scheme)\s*:\s*([\s\S]+)$/);
    if (m) out[m[1]] = m[2].trim().replace(/\s+/g, ' ');
  }
  return out;
}
const claros = () => tokens(semComentarios(CSS).match(/:where\(:root\)\{([^}]*)\}/)[1]);
const escuros = () => tokens(blocoEscuro(0));

test('tema.css: os dois blocos escuros são iguais, só na tela e com color-scheme: dark', () => {
  const a = tokens(blocoEscuro(0)), b = tokens(blocoEscuro(1));
  assert.deepEqual(a, b, 'Automático (aparelho escuro) e Escuro escolhido com os mesmos valores');
  assert.equal(a['color-scheme'], 'dark');
  // Nenhuma regra escura fora do @media screen (a impressão e os PDFs saem claros).
  const css = semComentarios(CSS);
  assert.equal((css.match(/data-theme="dark"/g) || []).length, 1);
  assert.equal((css.match(/data-theme="light"/g) || []).length, 1);
  assert.ok(!/@media print/.test(css));
  assert.ok(!/prefers-color-scheme:dark\)\{(?![\s\S]*@media screen)/.test(css.replace(/@media screen and \(prefers-color-scheme:dark\)/, '')), 'prefers-color-scheme só com screen');
});

test('tema.css: tokens comuns, cada token escuro com valor claro de reserva igual ao das páginas', () => {
  const c = claros(), e = escuros();
  for (const t of ['--bg', '--bg2', '--card', '--elev', '--field', '--line', '--line2', '--ink', '--text', '--muted', '--primary', '--primary-d', '--primary-s',
    '--primary-bg', '--coral-d', '--coral-s', '--gold-d', '--gold-s', '--green', '--green-s', '--purple', '--purple-s', '--sh1', '--sh2', '--sh3',
    '--focus', '--focus-halo', '--scrim', '--mapa-filtro']) {
    assert.ok(e[t], `${t} no escuro`);
    assert.ok(c[t], `${t} com valor claro de reserva`);
  }
  for (const t of Object.keys(e)) if (t !== 'color-scheme') assert.ok(c[t], `${t}: escuro sem valor claro`);
  // A reserva clara é a mesma cor de hoje (o :root da página inicial), então nada muda no modo claro.
  const idx = tokens(read('index.html').match(/<style>\s*:root\{([^}]*)\}/)[1]);
  for (const [t, v] of Object.entries(idx)) if (c[t]) assert.equal(c[t], v, `${t}: reserva clara igual à da página inicial`);
  // Iguais nos dois temas (já são escuros ou são ícones com contraste nos dois): não aparecem no bloco escuro.
  for (const t of ['--navy', '--navy2', '--navy3', '--aqua', '--aqua2', '--coral', '--gold']) assert.equal(e[t], undefined, t);
  assert.ok(/^none$/.test(c['--mapa-filtro']) && /invert\(1\)/.test(e['--mapa-filtro']));
  assert.match(semComentarios(CSS), /\.leaflet-tile-pane\{filter:var\(--mapa-filtro,none\)\}/, 'filtro só no painel dos ladrilhos (marcadores ficam como estão)');
  assert.ok(!/leaflet-marker/.test(semComentarios(CSS)));
});

// Contraste da WCAG entre duas cores #rrggbb.
const lum = (h) => { const c = h.replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3'); return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); };
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('contraste AA nos dois temas: textos 4,5:1 sobre todos os fundos, ícones e bordas de campo 3:1', () => {
  for (const [nome, v] of [['claro', claros()], ['escuro', { ...claros(), ...escuros() }]]) {
    const fundos = ['--bg', '--bg2', '--card', '--elev', '--field'];
    for (const tx of ['--ink', '--text', '--muted', '--primary', '--primary-d', '--coral-d', '--green', '--purple']) {
      for (const f of fundos) assert.ok(contraste(v[tx], v[f]) >= 4.5, `${nome}: ${tx} ${v[tx]} sobre ${f} ${v[f]} = ${contraste(v[tx], v[f]).toFixed(2)}`);
    }
    // Selos: texto da cor sobre o fundo suave da mesma cor.
    for (const [tx, f] of [['--primary-d', '--primary-s'], ['--primary', '--primary-s'], ['--coral-d', '--coral-s'], ['--gold-d', '--gold-s'], ['--green', '--green-s'], ['--purple', '--purple-s'], ['--muted', '--primary-s']]) {
      assert.ok(contraste(v[tx], v[f]) >= 4.5, `${nome}: ${tx} sobre ${f} = ${contraste(v[tx], v[f]).toFixed(2)}`);
    }
    assert.ok(contraste('#ffffff', v['--primary-bg']) >= 4.5, `${nome}: texto branco sobre --primary-bg`);
    for (const f of fundos) assert.ok(contraste(v['--focus'], v[f]) >= 3, `${nome}: foco sobre ${f}`);
  }
  const e = { ...claros(), ...escuros() };
  for (const f of ['--bg', '--bg2', '--card', '--elev']) {
    for (const ic of ['--coral', '--gold', '--primary']) assert.ok(contraste(e[ic], e[f]) >= 3, `escuro: ícone ${ic} sobre ${f}`);
    assert.ok(contraste(e['--line2'], e[f]) >= 3, `escuro: borda de campo sobre ${f} = ${contraste(e['--line2'], e[f]).toFixed(2)}`);
  }
  // Fundo escuro azul-petróleo, não preto puro; e mais claro que o azul-marinho do topo e do rodapé.
  assert.notEqual(e['--bg'].toLowerCase(), '#000000');
  assert.ok(lum(e['--bg']) > lum(e['--navy']) && lum(e['--bg']) < 0.02);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(e['--bg'].slice(i, i + 2), 16));
  assert.ok(b > g && g > r, 'tom azul-petróleo (azul > verde > vermelho)');
});

test('tema.css: botão do cabeçalho (44 px, herda a cor, ícone pela escolha, some sem o tema.js)', () => {
  const css = semComentarios(CSS);
  assert.match(css, /\.tema-btn\{[^}]*width:44px;height:44px/);
  assert.match(css, /\.tema-btn\{[^}]*color:inherit/);
  assert.match(css, /:root\[data-tema-escolha="claro"\] \.tema-btn\{--tema-ic:url\("data:image\/svg\+xml,/);
  assert.match(css, /:root\[data-tema-escolha="escuro"\] \.tema-btn\{--tema-ic:url\("data:image\/svg\+xml,/);
  assert.match(css, /:root:not\(\[data-tema-escolha\]\) \.tema-btn\{display:none\}/);
  assert.match(css, /\.tema-trocando \*[^{]*\{transition:none!important\}/);
  const rd = semComentarios(read('assets/css/rodape.css'));
  assert.match(rd, /\.rd-tema\{display:none;/);
  assert.match(rd, /:root\[data-tema-escolha\] \.rd-tema\{display:block\}/);
  assert.match(rd, /\.rd-tema-op button\{[^}]*min-height:44px/);
  assert.match(rd, /\.rd-tema-op button:focus-visible\{outline:3px solid #7FF0E4/);
  for (const [v] of TEMAS) assert.match(rd, new RegExp(`:root\\[data-tema-escolha="${v}"\\] \\.rd-tema \\[data-tema-opcao="${v}"\\]`), `opção ${v} marcada pelo CSS`);
});

/* ============================== rodapé ============================== */
test('rodapé: grupo "Tema" com Automático, Claro e Escuro (botões de alternância), em todas as páginas', () => {
  assert.deepEqual(TEMAS.map(([v]) => v), T.ESCOLHAS, 'as mesmas escolhas do tema.js');
  const h = temaHtml();
  assert.match(h, /^<div class="rd-tema" role="group" aria-labelledby="rd-tema-h">/);
  assert.match(h, /<p class="rd-h" id="rd-tema-h">Tema<\/p>/);
  assert.deepEqual([...h.matchAll(/<button type="button" data-tema-opcao="(\w+)" aria-pressed="(true|false)">([^<]+)<\/button>/g)].map((m) => [m[1], m[2], m[3]]),
    [['auto', 'true', 'Automático'], ['claro', 'false', 'Claro'], ['escuro', 'false', 'Escuro']]);
  assert.ok(rodapeHtml('').includes(h) && rodapeHtml('../../../').includes(h));
  assert.ok(rodapeHtml('').indexOf(h) < rodapeHtml('').indexOf('<nav class="rd-nav"'), 'fora da navegação do rodapé');
});

/* ============================== páginas ============================== */
test('todas as páginas: tema.js síncrono logo depois do theme-color, antes de qualquer CSS, e o tema.css (uma vez)', () => {
  const lista = paginasComTema();
  assert.ok(lista.length > 1500, `páginas: ${lista.length} (com as cidades)`);
  for (const f of lista) {
    const html = read(f);
    const rel = relDe(f);
    const headHtml = html.slice(0, html.indexOf('</head>'));
    assert.equal((html.match(/assets\/js\/tema\.js/g) || []).length, 1, `${f}: um tema.js`);
    assert.equal((html.match(/assets\/css\/tema\.css/g) || []).length, 1, `${f}: um tema.css`);
    const tags = tagsTema(rel);
    assert.ok(headHtml.includes(`<meta name="theme-color" content="#05161e">\n${tags}\n`), `${f}: tema logo depois do theme-color (rode node scripts/aplicar-tema.mjs)`);
    const js = headHtml.indexOf(tags);
    const css1 = headHtml.search(/<link rel="stylesheet"(?! href="[^"]*assets\/css\/tema\.css")|<style\b/);
    assert.ok(css1 === -1 || js < css1, `${f}: tema.js antes de todo CSS (não espera CSS para rodar)`);
    assert.equal(comTema(html, rel), html, `${f}: aplicar de novo não muda nada`);
  }
  assert.ok(read('404.html').includes(`<script src="${CAMINHO}assets/js/tema.js"></script>\n<link rel="stylesheet" href="${CAMINHO}assets/css/tema.css">`), '404 com o caminho absoluto');
  assert.ok(read('exames/raio-x.html').includes(tagsTema('../')));
  assert.ok(read('index.html').includes(tagsTema('')));
});

test('aplicar-tema: põe no lugar certo, conserta caminho velho e página sem theme-color', () => {
  const pag = '<!doctype html>\n<html>\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width">\n<meta name="theme-color" content="#05161e">\n<link rel="stylesheet" href="a.css">\n</head>\n<body></body>\n</html>';
  const com = comTema(pag, '../');
  assert.equal(com, pag.replace('#05161e">\n', `#05161e">\n${tagsTema('../')}\n`));
  assert.equal(comTema(com, '../'), com);
  const velho = com.replace(tagsTema('../'), '<link rel="stylesheet" href="x/assets/css/tema.css">\n<script src="x/assets/js/tema.js" defer></script>');
  assert.equal(comTema(velho, '../'), com, 'caminho errado e defer: troca pelo certo');
  const semMeta = pag.replace('<meta name="theme-color" content="#05161e">\n', '');
  assert.ok(comTema(semMeta, '').includes(`<meta name="viewport" content="width=device-width">\n${tagsTema('')}\n`), 'sem theme-color: depois do viewport');
  assert.equal(comTema('<p>sem head</p>', ''), '<p>sem head</p>');
});

test('gerador das cidades: páginas novas já saem com o tema (igual ao aplicar-tema) e o rodapé com o grupo Tema', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'imed-tema-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const cities = [{ ibge: 3550308, name: 'São Paulo', uf: 'SP', total: 10, imagem: 2, laboratorio: 2, clinica: 4, hospital: 2 }];
  generate({ cities, base: 'https://exemplo.com.br/', date: '2026-10-30', out, examPages: [] });
  const files = [['cidades/index.html', '../'], [`${cityDir(cities[0])}index.html`, '../../../'], ...TYPES.map((tp) => [typePath(cities[0], tp), '../../../'])];
  for (const [f, rel] of files) {
    const h = readFileSync(join(out, f), 'utf8');
    assert.ok(h.includes(`<meta name="theme-color" content="#05161e">\n${tagsTema(rel)}\n`), f);
    assert.equal(comTema(h, rel), h, `${f}: igual ao que o aplicar-tema faria`);
    assert.ok(h.includes(temaHtml()), `${f}: grupo Tema no rodapé`);
  }
});
