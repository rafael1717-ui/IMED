#!/usr/bin/env node
// Letras e ícones servidos pelo próprio site: a página abre mais rápido no celular e o endereço de quem
// visita não vai para o Google (antes as letras vinham do Google Fonts).
//
// 1) Letras (Inter e Sora, licença SIL OFL 1.1, em assets/fonts/): os mesmos arquivos do Google Fonts
//    (alfabeto latino), guardados aqui. Cada página declara no <head> só os pesos que já usava
//    (veja headFontes), com font-display: swap, como antes.
// 2) Ícones (Font Awesome Free 6.5.1): assets/vendor/fa/css/icones.min.css traz só os ícones usados nas
//    páginas do IMED, e as fontes de ícones vêm recortadas (assets/vendor/fa/webfonts/icones-*.woff2).
//    Se um ícone não estiver no recorte, o navegador baixa sozinho a fonte completa: o desenho nunca some.
//
// Uso:
//   node scripts/fontes.mjs           atualiza icones.min.css e o <head> das páginas
//   node scripts/fontes.mjs --check   só confere; sai com erro se algo estiver desatualizado
// Ícone novo no site: rode o comando acima. Para recortar de novo as fontes de ícones (fica mais leve),
// instale antes o fontTools: pip install fonttools brotli
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FA = 'assets/vendor/fa';

// Páginas e scripts que ficariam com o Font Awesome completo (hoje nenhum: a teleconsulta também usa o recorte).
export const FORA = /^$/;
const PASTAS_FORA = new Set(['.git', 'node_modules', 'memory', 'tests', 'vendor', 'supabase', '.github']);

/* ============================== letras ============================== */
// Recortes iguais aos do Google Fonts: só se baixa o arquivo que tiver alguma letra da página.
const RECORTES = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF',
};
const FAMILIAS = { Inter: 'inter', Sora: 'sora' };
// Pedidos logo no começo (<link rel="preload">): o texto da primeira tela usa estes arquivos.
export const PRELOAD = ['latin'];

// "Sora:wght@600;700;800&family=Inter:wght@400;500" (o pedaço do endereço do Google) → { Sora: [600,700,800], Inter: [...] }
export function parseSpec(spec) {
  const out = {};
  for (const part of String(spec).replace(/^family=/, '').split(/&family=|\|/)) {
    const m = part.match(/^([A-Za-z+ ]+?)(?::(?:wght@)?([\d;]+))?$/);
    if (!m) throw new Error(`família inválida: ${part}`);
    const nome = m[1].replace(/\+/g, ' ');
    if (!FAMILIAS[nome]) throw new Error(`família sem arquivo em assets/fonts: ${nome}`);
    out[nome] = (m[2] ? m[2].split(';').map(Number) : [400]).sort((a, b) => a - b);
  }
  return out;
}
const specText = (fams) => Object.entries(fams).map(([f, w]) => `${f}:${w.join(';')}`).join('|');

// Pesos seguidos (400, 500, 600...) viram uma faixa só ("400 700"): o arquivo é variável e a escolha
// do peso fica igual à de antes (quando o Google declarava cada peso separado).
function faixas(pesos) {
  const out = [];
  for (const p of pesos) {
    const ult = out.at(-1);
    if (ult && p === ult[1] + 100) ult[1] = p; else out.push([p, p]);
  }
  return out.map(([a, b]) => (a === b ? String(a) : `${a} ${b}`));
}

export function fontFaceCss(prefix, fams) {
  let css = '';
  for (const [fam, pesos] of Object.entries(fams)) {
    for (const faixa of faixas(pesos)) {
      for (const [rec, range] of Object.entries(RECORTES)) {
        css += `@font-face{font-family:'${fam}';font-style:normal;font-weight:${faixa};font-display:swap;src:url(${prefix}assets/fonts/${FAMILIAS[fam]}-${rec}.woff2) format('woff2');unicode-range:${range}}`;
      }
    }
  }
  return css;
}

// O que vai no <head> no lugar do Google Fonts. prefix: caminho até a raiz do site ('', '../', ou o caminho absoluto do site na página 404...).
export function headFontes(prefix, spec) {
  const fams = typeof spec === 'string' ? parseSpec(spec) : spec;
  const pre = Object.keys(fams).flatMap((fam) => PRELOAD.map((rec) => `${FAMILIAS[fam]}-${rec}.woff2`));
  return pre.map((f) => `<link rel="preload" href="${prefix}assets/fonts/${f}" as="font" type="font/woff2" crossorigin>\n`).join('')
    + `<style data-fontes="${specText(fams)}">${fontFaceCss(prefix, fams)}</style>`;
}

const RE_PRECONNECT = /<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"( crossorigin)?>\n?/g;
const RE_GOOGLE = /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=([^"&]+(?:&family=[^"&]+)*)&display=swap" rel="stylesheet">/;
const RE_PRELOAD = /<link rel="preload" href="[^"]*assets\/fonts\/[^"]+" as="font" type="font\/woff2" crossorigin>\n?/g;
const RE_BLOCO = /<style data-fontes="([^"]+)">[^<]*<\/style>/;

// Troca Google Fonts → letras do site, all.min.css → icones.min.css e tira o Google da CSP. Pode rodar de novo.
export function atualizarPagina(html) {
  let out = html;
  const fa = out.match(/href="([^"]*)assets\/vendor\/fa\/css\/(?:all|icones)\.min\.css"/);
  const prefix = fa ? fa[1] : null;
  const g = out.match(RE_GOOGLE);
  if (g && prefix !== null) {
    out = out.replace(RE_PRECONNECT, '').replace(RE_GOOGLE, () => headFontes(prefix, g[1]));
  } else if (prefix !== null && RE_BLOCO.test(out)) {
    const spec = out.match(RE_BLOCO)[1];
    out = out.replace(RE_PRELOAD, '').replace(RE_BLOCO, () => headFontes(prefix, spec));
  }
  if (prefix !== null) out = out.replace(`${prefix}${FA}/css/all.min.css`, `${prefix}${FA}/css/icones.min.css`);
  out = out.replace(/(Content-Security-Policy" content="[^"]*?)style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/, "$1style-src 'self' 'unsafe-inline'")
    .replace(/(Content-Security-Policy" content="[^"]*?)font-src 'self' https:\/\/fonts\.gstatic\.com/, "$1font-src 'self'");
  return out;
}

/* ============================== ícones ============================== */
function arquivosDoSite(dir = ROOT, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!PASTAS_FORA.has(e.name)) arquivosDoSite(p, out); continue; }
    if (!/\.(html|js|mjs)$/.test(e.name)) continue;
    const rel = relative(ROOT, p).split(sep).join('/');
    if (!FORA.test(rel)) out.push(rel);
  }
  return out;
}
export const paginasDoSite = () => arquivosDoSite().filter((f) => f.endsWith('.html'));

// Regras do CSS minificado, no primeiro nível (um @media conta como uma regra com regras dentro).
function regras(css) {
  const out = []; let nivel = 0; let ini = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') nivel++;
    else if (css[i] === '}' && --nivel === 0) { out.push(css.slice(ini, i + 1).trim()); ini = i + 1; }
  }
  return out.filter(Boolean);
}
const classes = (sel) => [...sel.matchAll(/\.(fa[a-z0-9-]*)/g)].map((m) => m[1]);

export function faCompleto() {
  const css = readFileSync(join(ROOT, FA, 'css/all.min.css'), 'utf8');
  const icones = new Map(); // nome → código (ex.: 'fa-x-ray' → 0xf497)
  for (const r of regras(css.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    const m = r.match(/^([^{]+)\{content:"\\([0-9a-f]+)"\}$/);
    if (m) for (const s of m[1].split(',')) { const n = s.match(/^\.(fa-[a-z0-9-]+):before$/); if (n) icones.set(n[1], parseInt(m[2], 16)); }
  }
  return { css, icones };
}

// Classes fa-* usadas nas páginas e scripts do IMED.
export function classesUsadas() {
  const usadas = new Set();
  for (const f of arquivosDoSite()) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    for (const m of s.matchAll(/(?<![\w-])fa-[a-z0-9]+(?:-[a-z0-9]+)*/g)) usadas.add(m[0]);
    if (/class="(?:[^"]*\s)?fa(?:\s[^"]*)?"/.test(s)) usadas.add('fa');
  }
  return usadas;
}

const ESTILOS = {
  solid: { familia: 'Font Awesome 6 Free', peso: 900, completo: 'fa-solid-900.woff2', recorte: 'icones-solid-900.woff2' },
  regular: { familia: 'Font Awesome 6 Free', peso: 400, completo: 'fa-regular-400.woff2', recorte: 'icones-regular-400.woff2' },
  brands: { familia: 'Font Awesome 6 Brands', peso: 400, completo: 'fa-brands-400.woff2', recorte: 'icones-brands-400.woff2' },
};
const MANIFESTO = join(ROOT, FA, 'webfonts/icones.json');
const urange = (cps) => cps.map((c) => `U+${c.toString(16)}`).join(',');

export function cssIcones(usadas, cobertura) {
  const { css, icones } = faCompleto();
  const usadaOuBase = (c) => usadas.has(c) || ['fa', 'fas', 'far', 'fab'].includes(c) && usadas.has({ fas: 'fa-solid', far: 'fa-regular', fab: 'fa-brands' }[c] ?? 'fa');
  const filtra = (r) => {
    if (r.startsWith('@font-face')) return '';
    if (/^@(-webkit-)?keyframes /.test(r)) return usadas.has(r.match(/keyframes (fa-[a-z-]+)/)[1]) ? r : '';
    if (r.startsWith('@media') || r.startsWith('@supports')) {
      const abre = r.indexOf('{');
      const dentro = regras(r.slice(abre + 1, -1)).map(filtra).filter(Boolean).join('');
      return dentro ? `${r.slice(0, abre + 1)}${dentro}}` : '';
    }
    const abre = r.indexOf('{');
    const seletores = r.slice(0, abre).split(',').filter((s) => classes(s).every(usadaOuBase));
    return seletores.length ? `${seletores.join(',')}${r.slice(abre)}` : '';
  };
  const corpo = regras(css.replace(/\/\*[\s\S]*?\*\//g, '')).map(filtra).filter(Boolean).join('');
  let faces = '';
  for (const [estilo, e] of Object.entries(ESTILOS)) {
    if (!usadas.has(`fa-${estilo}`)) continue;
    const cps = cobertura[estilo] ?? [];
    // Primeiro a fonte completa (reserva), depois o recorte: o navegador tenta o recorte antes e só baixa a
    // completa se a página usar um ícone que não está nele.
    faces += `@font-face{font-family:"${e.familia}";font-style:normal;font-weight:${e.peso};font-display:block;src:url(../webfonts/${e.completo}) format("woff2")}`;
    if (cps.length) faces += `@font-face{font-family:"${e.familia}";font-style:normal;font-weight:${e.peso};font-display:block;src:url(../webfonts/${e.recorte}) format("woff2");unicode-range:${urange(cps)}}`;
  }
  const cab = css.match(/^\/\*![\s\S]*?\*\//)[0].replace(' */', ` *\n * Recorte do IMED: só os ícones usados no site. Gerado por scripts/fontes.mjs (não edite à mão).\n */`);
  const usados = [...usadas].filter((n) => icones.has(n)).sort();
  return { css: `${cab}\n${faces}${corpo}\n`, usados, icones };
}

// Recorta as fontes de ícones com o fontTools (Python). Devolve os códigos que ficaram em cada recorte.
function recortarFontes(codigos) {
  const py = `
import json, sys
from fontTools import subset
from fontTools.ttLib import TTFont
pedidos = json.loads(sys.argv[1]); out = {}
for estilo, (completo, recorte) in json.loads(sys.argv[2]).items():
    tem = set(TTFont(completo)['cmap'].getBestCmap().keys())
    cps = sorted(c for c in pedidos if c in tem)
    out[estilo] = cps
    if not cps: continue
    opts = subset.Options(); opts.flavor = 'woff2'; opts.layout_features = []; opts.name_IDs = ['*']; opts.notdef_outline = True
    f = TTFont(completo); s = subset.Subsetter(opts); s.populate(unicodes=cps); s.subset(f); f.flavor = 'woff2'; f.save(recorte)
print(json.dumps(out))`;
  const arqs = Object.fromEntries(Object.entries(ESTILOS).map(([k, e]) => [k, [join(ROOT, FA, 'webfonts', e.completo), join(ROOT, FA, 'webfonts', e.recorte)]]));
  const r = spawnSync(process.env.PYTHON || 'python3', ['-c', py, JSON.stringify(codigos), JSON.stringify(arqs)], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return JSON.parse(r.stdout.trim().split('\n').at(-1));
}

/* ============================== execução ============================== */
function main() {
  const check = process.argv.includes('--check');
  const problemas = [];
  const usadas = classesUsadas();
  const { icones } = faCompleto();
  const codigos = [...usadas].filter((n) => icones.has(n)).map((n) => icones.get(n));
  let cobertura = existsSync(MANIFESTO) ? JSON.parse(readFileSync(MANIFESTO, 'utf8')) : {};
  const faltam = codigos.filter((c) => !Object.values(cobertura).some((l) => l.includes(c)));
  if (faltam.length && !check) {
    const nova = recortarFontes([...new Set(codigos)].sort((a, b) => a - b));
    if (nova) { cobertura = nova; writeFileSync(MANIFESTO, `${JSON.stringify(nova)}\n`); console.log('Fontes de ícones recortadas de novo.'); }
    else console.warn(`Aviso: sem fontTools para recortar as fontes de ícones (pip install fonttools brotli). Ícones fora do recorte: ${faltam.map((c) => c.toString(16)).join(', ')}. Eles aparecem mesmo assim, com a fonte completa.`);
  } else if (faltam.length) problemas.push(`ícones fora do recorte das fontes: ${faltam.map((c) => c.toString(16)).join(', ')} (rode node scripts/fontes.mjs)`);

  const { css, usados } = cssIcones(usadas, cobertura);
  const alvo = join(ROOT, FA, 'css/icones.min.css');
  const atual = existsSync(alvo) ? readFileSync(alvo, 'utf8') : '';
  if (atual !== css) { if (check) problemas.push(`${FA}/css/icones.min.css desatualizado`); else writeFileSync(alvo, css); }

  let mudou = 0;
  for (const f of paginasDoSite()) {
    const p = join(ROOT, f);
    const html = readFileSync(p, 'utf8');
    const novo = atualizarPagina(html);
    if (novo !== html) { mudou++; if (check) problemas.push(`${f}: <head> desatualizado`); else writeFileSync(p, novo); }
  }
  if (check) {
    if (problemas.length) { console.error(problemas.slice(0, 20).join('\n')); process.exit(1); }
    console.log(`Tudo certo: ${usados.length} ícones, letras do próprio site.`);
  } else console.log(`${usados.length} ícones no recorte; ${mudou} página(s) atualizada(s).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
