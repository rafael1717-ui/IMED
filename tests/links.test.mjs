// Todos os links internos do site levam a um arquivo que existe: href, src e srcset de todas as páginas .html
// (raiz, exames/ e cidades/**), e a âncora (#parte) existe na página de destino.
// No GitHub (CI) e na pasta limpa onde o fio principal testa antes do commit, só existem os arquivos do git:
// lá, este teste falha se uma página publicada apontar para um arquivo que ficou fora do commit (por exemplo,
// uma página de outra frente que ainda não entrou). Na pasta de trabalho, ele também AVISA (sem falhar) quais
// arquivos apontados ainda não estão no git.
// Rodar com: node --test tests/links.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Pastas que não são publicadas como páginas do site (ou não têm páginas).
const FORA = new Set(['node_modules', '.git', '.github', 'supabase', 'tests', 'scripts', 'memory']);
// No GitHub Pages o site é publicado em /<repositório>/ (o caminho do siteUrl): links absolutos começam por aí (a página 404 usa).
const BASE_ABS = (() => {
  const m = readFileSync(join(ROOT, 'assets/js/config.js'), 'utf8').match(/siteUrl\s*:\s*['"]([^'"]+)['"]/);
  return m ? new URL(m[1]).pathname : '/';
})();

function paginas(dir = ROOT, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!FORA.has(e.name)) paginas(join(dir, e.name), out); }
    else if (e.name.endsWith('.html')) out.push(join(dir, e.name));
  }
  return out;
}

// Âncoras que não são um elemento da página, e sim uma tela aberta pelo script dela (a página inicial abre
// "Meus pedidos" com #agenda).
const ROTAS = { 'index.html': new Set(['agenda']) };

const idsCache = new Map();
function ids(file) {
  if (!idsCache.has(file)) {
    const h = readFileSync(file, 'utf8');
    idsCache.set(file, new Set([...h.matchAll(/\s(?:id|name)\s*=\s*"([^"]+)"/g)].map((m) => m[1])));
  }
  return idsCache.get(file);
}

// Arquivos do git (null fora de um repositório git).
function arquivosDoGit() {
  try {
    return new Set(execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean));
  } catch { return null; }
}

test('links internos: todo href/src de todas as páginas leva a um arquivo que existe, e a âncora existe', (t) => {
  const files = paginas();
  assert.ok(files.length > 30, `páginas encontradas: ${files.length}`);
  const quebrados = new Map();
  const ancoras = [];
  const alvos = new Set();
  let total = 0;
  for (const f of files) {
    // O texto dos <script> não conta (lá há modelos com ${...}); só os atributos do HTML.
    const h = readFileSync(f, 'utf8').replace(/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g, '');
    for (const m of h.matchAll(/\s(href|src|srcset|poster)\s*=\s*"([^"]*)"/g)) {
      const [, attr, val] = m;
      const vals = attr === 'srcset' ? val.split(',').map((x) => x.trim().split(/\s+/)[0]) : [val];
      for (const v of vals) {
        if (!v || /^(https?:|mailto:|tel:|data:|javascript:|blob:|sms:|\/\/)/i.test(v) || v.includes('${')) continue;
        const [caminho, ancora] = v.split('#');
        const p = caminho.split('?')[0];
        let alvo;
        if (!p) alvo = f; // só a âncora (#parte), na própria página
        else if (p.startsWith('/')) alvo = join(ROOT, p.startsWith(BASE_ABS) ? p.slice(BASE_ABS.length) : p);
        else alvo = resolve(dirname(f), p);
        if (existsSync(alvo) && statSync(alvo).isDirectory()) alvo = join(alvo, 'index.html');
        total += 1;
        if (!existsSync(alvo)) {
          const k = relative(ROOT, alvo);
          if (!quebrados.has(k)) quebrados.set(k, []);
          quebrados.get(k).push(`${relative(ROOT, f)} [${attr}="${v}"]`);
          continue;
        }
        alvos.add(relative(ROOT, alvo).split(sep).join('/'));
        const rota = ROTAS[relative(ROOT, alvo).split(sep).join('/')];
        if (ancora && alvo.endsWith('.html') && !ids(alvo).has(decodeURIComponent(ancora)) && !rota?.has(ancora)) ancoras.push(`${relative(ROOT, f)} -> ${v}`);
      }
    }
  }
  const msg = [...quebrados].map(([k, v]) => `${k} (${v.length} links, ex.: ${v.slice(0, 3).join(' | ')})`);
  assert.deepEqual(msg, [], 'links para arquivos que não existem');
  // Âncoras das páginas das cidades se repetem: mostra só alguns exemplos.
  assert.deepEqual(ancoras.slice(0, 10), [], `âncoras que não existem (${ancoras.length})`);
  t.diagnostic(`${total} links internos conferidos em ${files.length} páginas`);
  // Aviso (sem falhar): arquivos apontados que ainda não estão no git. No CI eles nem existiriam e o teste acima
  // falharia: publique-os no mesmo commit das páginas que apontam para eles.
  const git = arquivosDoGit();
  if (git && git.size) {
    const fora = [...alvos].filter((a) => !git.has(a)).sort();
    if (fora.length) t.diagnostic(`AVISO: ${fora.length} arquivo(s) apontado(s) pelas páginas ainda fora do git (entram no mesmo commit?): ${fora.slice(0, 15).join(', ')}${fora.length > 15 ? ', …' : ''}`);
  }
});
