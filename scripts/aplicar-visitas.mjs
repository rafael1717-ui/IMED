#!/usr/bin/env node
// Põe o contador de visitas próprio (assets/js/visitas.js) em todas as páginas do site: as fixas (raiz e exames/)
// e as das cidades já geradas (cidades/**; o gerador scripts/gerar-cidades.mjs já põe nas que ele cria).
// Rode depois de criar uma página:   node scripts/aplicar-visitas.mjs
// E para o banco aceitar a página nova:   node scripts/aplicar-visitas.mjs --sql   (mostra o private.visit_path com a
// lista fechada de páginas, para aplicar numa migração nova; tests/visitas.test.mjs avisa quando falta).
// Em cada página, logo depois do <script> do config.js (o contador lê o endereço do banco de lá), entra:
//   <script src="<caminho até a raiz>assets/js/visitas.js" defer></script>
// Página sem config.js: os dois entram antes de </body>, com defer (o config primeiro).
// A página 404 abre em qualquer endereço: usa o caminho absoluto do site e conta sempre como "/404".
// tests/visitas.test.mjs confere que nenhuma página ficou sem o contador.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { paginas, relDe } from './aplicar-rodape.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Páginas que ficam sem o contador (hoje nenhuma; a teleconsulta e os documentos também contam visitas).
// Para tirar uma página: ponha o nome aqui e rode o comando de novo.
export const OUTRAS_FRENTES = [];

// Páginas só da equipe, sem o contador de visitas (as visitas da equipe não entram nos números do site).
// A lista do banco (paginasFixas) continua com elas: o banco aceita a página, mas ela nunca manda visita.
export const SEM_CONTADOR = ['gestao.html', 'minha-saude.html'];   // gestão: só a equipe; Minha Saúde: página de saúde do paciente, sem contador
// Páginas que nem o banco aceita contar (ficam fora da lista fechada de private.visit_path): a página de saúde do
// paciente nunca manda visita, e o banco recusaria se alguém mandasse.
export const NUNCA_CONTA = ['minha-saude.html'];

const VISITAS_RE = /\n?<script src="[^"]*assets\/js\/visitas\.js"[^>]*><\/script>/g;
const CONFIG_RE = /<script src="[^"]*assets\/js\/config\.js"[^>]*><\/script>/;

export const tagVisitas = (rel, file = '') =>
  `<script src="${rel}assets/js/visitas.js"${file === '404.html' ? ' data-pagina="/404"' : ''} defer></script>`;

// Devolve o HTML com o contador (uma vez só, logo depois do config.js). Já certo: devolve igual.
export function comVisitas(html, rel, file = '') {
  const tag = tagVisitas(rel, file);
  let out = html.replace(VISITAS_RE, '');
  const c = out.match(CONFIG_RE);
  if (!c) return out.replace('</body>', `<script src="${rel}assets/js/config.js" defer></script>\n${tag}\n</body>`);
  let cfg = c[0];
  // config.js que este script pôs (com defer) noutro caminho, como na página 404 depois de trocar o domínio: corrige.
  if (/\sdefer><\/script>$/.test(cfg) && !cfg.startsWith(`<script src="${rel}assets/js/config.js"`)) {
    const certo = `<script src="${rel}assets/js/config.js" defer></script>`;
    out = out.replace(cfg, certo);
    cfg = certo;
  }
  return out.replace(cfg, `${cfg}\n${tag}`);
}

// Páginas das cidades já geradas (cidades/**/*.html).
export function paginasCidades(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    const abs = join(root, dir);
    if (!existsSync(abs)) return;
    for (const f of readdirSync(abs).sort()) {
      const rel = `${dir}/${f}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (f.endsWith('.html')) out.push(rel);
    }
  };
  walk('cidades');
  return out;
}

// Todas as páginas que devem contar visitas (sem as de outras frentes).
export function paginasComContador(root = ROOT) {
  return [...paginas(root), ...paginasCidades(root)].filter((f) => !OUTRAS_FRENTES.includes(f) && !SEM_CONTADOR.includes(f));
}

/* ---------- lista fechada de páginas do banco (private.visit_path) ---------- */
// Caminho que o contador manda para uma página fixa: "/", "/perto.html", "/exames/", "/exames/raio-x.html", "/404".
export const caminhoDe = (file) => (file === '404.html' ? '/404' : `/${file.replace(/(^|\/)index\.html$/, '$1')}`);

// Páginas fixas que o banco aceita: todas as da raiz e de exames/ (de todas as frentes, para a página que ganhar
// o contador já contar), a 404 e o índice das cidades. As páginas de cada cidade o banco confere pelo município.
export function paginasFixas(root = ROOT) {
  return [...new Set([...paginas(root).filter((f) => !NUNCA_CONTA.includes(f)).map(caminhoDe), '/cidades/'])].sort();
}

// A função do banco com a lista fechada, pronta para uma migração nova (node scripts/aplicar-visitas.mjs --sql).
// Uma cidade só conta se o município existir (o endereço da página tem o nome sem acento: private.visit_slug).
export function sqlVisitPath(lista = paginasFixas()) {
  const linhas = [];
  let linha = '';
  for (const p of lista.map((x) => `'${x.replace(/'/g, "''")}'`)) {
    if (linha && (linha + p).length > 100) { linhas.push(linha); linha = ''; }
    linha += (linha ? ', ' : '') + p;
  }
  if (linha) linhas.push(linha);
  return `create or replace function private.visit_path(p_path text)
returns text
language sql
stable
set search_path = ''
as $$
  with c as (select regexp_replace(btrim(left(coalesce(p_path, ''), 200)), '/index\\.html$', '/') as p)
  select case
    when char_length(p) not between 1 and 120 or p ~ '[0-9]{5}' then null
    -- Páginas fixas do site (lista fechada, gerada por scripts/aplicar-visitas.mjs --sql).
    when p = any (array[
      ${linhas.join(',\n      ')}]) then p
    -- Página de cidade: só de um município que existe (mesmo nome sem acento do gerador das cidades).
    when p ~ '^/cidades/[a-z]{2}/[a-z0-9]+(-[a-z0-9]+)*/((diagnostico-por-imagem|laboratorios|clinicas|hospitais)\\.html)?$'
         and exists (select 1 from public.municipalities m
                     where m.uf = upper(split_part(p, '/', 3)) and private.visit_slug(m.name) = split_part(p, '/', 4)) then p
    else null
  end
  from c;
$$;`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--sql')) {
  // Página nova no site: aplique isto numa migração nova, para o banco contar as visitas dela.
  console.log(`-- Lista de páginas do contador de visitas (${paginasFixas().length} páginas fixas), gerada por scripts/aplicar-visitas.mjs --sql\n${sqlVisitPath()}`);
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let mudou = 0;
  const lista = [];
  for (const file of paginasComContador()) {
    const path = join(ROOT, file);
    const html = readFileSync(path, 'utf8');
    const novo = comVisitas(html, relDe(file), file);
    if (novo !== html) { writeFileSync(path, novo); mudou += 1; if (lista.length < 30) lista.push(file); }
  }
  console.log(mudou ? `Contador de visitas posto em ${mudou} página(s): ${lista.join(', ')}${mudou > lista.length ? ', …' : ''}` : 'Todas as páginas já tinham o contador de visitas.');
}
