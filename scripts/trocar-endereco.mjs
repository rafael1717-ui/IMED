#!/usr/bin/env node
// Troca o endereço público do site no repositório inteiro, num comando só. Exemplos:
//   node scripts/trocar-endereco.mjs https://imed.com.br/          (domínio próprio)
//   node scripts/trocar-endereco.mjs https://conta.github.io/REPO/  (outro GitHub Pages; respeite as maiúsculas)
//   node scripts/trocar-endereco.mjs                               (sem endereço: repete o atual e conserta o que ficou para trás)
//   node scripts/trocar-endereco.mjs --check                       (só confere; não grava nada e sai com erro se algo está fora)
// Pode rodar quantas vezes quiser: com o mesmo endereço, a segunda vez não muda nada.
//
// De onde vem o endereço: scripts/endereco.json guarda o endereço "atual" e os "anteriores" (os que o site já teve).
// O site lê de assets/js/config.js (IMED_CONFIG.siteUrl); os scripts, os testes e os geradores leem do config.js.
// Este script mantém os dois iguais e troca o que não tem como ler de lá:
//   1. assets/js/config.js (siteUrl) e scripts/endereco.json;
//   2. todo arquivo de texto do site, da documentação e dos testes que cite o endereço atual ou um dos anteriores
//      (canônico, og:url, og:image e JSON-LD das páginas fixas; README, CLAUDE.md e memory/context; ...);
//      de um GitHub Pages para outro, troca também o nome do servidor sozinho (conta.github.io);
//   3. a página 404.html, que usa o caminho absoluto do site ("/REPO/..." no GitHub Pages; "/" no domínio próprio);
//   4. o bloco "endereco-do-site" das Edge Functions (supabase/functions/*/index.ts): SITE_URL = endereço atual e
//      SITE_ANTERIORES = os anteriores, que continuam aceitos (origens da busca e retorno do link de entrada)
//      enquanto o site antigo ainda existir; e a linha ALLOWED_ORIGINS de supabase/functions/.env.example;
//   5. roda os geradores: gerar-cidades (cidades/**, sitemap.xml, robots.txt e llms.txt), aplicar-rodape,
//      aplicar-tema, aplicar-visitas e fontes (--sem-geradores pula este passo);
//   6. no fim, procura no repositório inteiro o que ainda cita um endereço anterior e mostra. Só pode sobrar o que é
//      de propósito (PERMITIDOS, abaixo): este arquivo de endereços, o bloco das Edge Functions, o histórico em
//      memory/projects e as migrações já aplicadas no banco (nunca são reescritas). Sobrou outra coisa: sai com erro.
// Opções: --esquecer=<endereço anterior>  tira um endereço da lista dos anteriores (as funções deixam de aceitá-lo)
//         --sem-geradores                 não roda os geradores (passo 5)
//         --check                         só confere (passos 1 a 4 e 6), sem gravar
//
// O QUE ESTE SCRIPT NÃO FAZ (é na produção, com autorização do dono; veja o README, "Trocar o endereço do site"):
//   - Supabase → Authentication → URL Configuration: Site URL e Redirect URLs com o endereço novo;
//   - publicar as Edge Functions (ou trocar o segredo ALLOWED_ORIGINS) para aceitarem a origem nova;
//   - GitHub → Settings → Pages (ligar o Pages ou o domínio próprio);
//   - subir o VERSION do sw.js, rodar os testes, commit e push.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ARQ_ENDERECO = 'scripts/endereco.json';
const ARQ_CONFIG = 'assets/js/config.js';
const ARQ_ENV = 'supabase/functions/.env.example';
const ESTE = 'scripts/trocar-endereco.mjs';

// Pastas que a troca não lê: bibliotecas de terceiros, dados, imagens e o que nunca é reescrito (histórico e
// migrações já aplicadas: o arquivo tem de continuar igual ao que está gravado no banco).
const PASTAS_FORA = ['.git', 'node_modules', 'assets/vendor', 'assets/fonts', 'assets/img', 'assets/icons',
  'memory/projects', 'supabase/migrations', 'supabase/volta', 'supabase/.temp', 'scripts/cid10', 'scripts/cnes-equip'];
const TEXTO = /\.(html|js|mjs|ts|json|xml|txt|md|yml|yaml|webmanifest|toml|css|sql)$/;
// Onde um endereço anterior pode continuar escrito (passo 6), com o motivo.
export const PERMITIDOS = [
  [/^scripts\/endereco\.json$/, 'lista dos endereços anteriores'],
  [/^supabase\/functions\/[^/]+\/index\.ts$/, 'bloco endereco-do-site: endereços anteriores ainda aceitos'],
  [/^supabase\/functions\/\.env\.example$/, 'ALLOWED_ORIGINS com as origens anteriores ainda aceitas'],
  [/^memory\/projects\//, 'histórico do projeto (não se reescreve)'],
  [/^supabase\/(migrations|volta)\//, 'migração já aplicada: não se reescreve (anote para a etapa de produção)'],
];

export const BLOCO_INI = '// >>> endereco-do-site';
export const BLOCO_FIM = '// <<< endereco-do-site';
const RE_BLOCO = /(\/\/ >>> endereco-do-site[^\n]*\n)([\s\S]*?)(\/\/ <<< endereco-do-site)/;

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unicos = (l) => [...new Set(l)];

// Endereço do site: http(s), sem ?consulta e sem #, sempre com a barra no fim.
export function normalizar(endereco) {
  let u;
  try { u = new URL(String(endereco).trim()); } catch { throw new Error(`Endereço inválido: ${endereco}`); }
  if (!/^https?:$/.test(u.protocol) || u.search || u.hash || u.username || u.password) throw new Error(`Endereço inválido: ${endereco} (use https://dominio/ ou https://conta.github.io/REPO/)`);
  // new URL deixa o servidor em minúsculas e mantém as maiúsculas do caminho (no GitHub Pages elas contam).
  return u.href.endsWith('/') ? u.href : `${u.href}/`;
}
export const partes = (url) => { const u = new URL(url); return { url, origem: u.origin, host: u.host, caminho: u.pathname }; };
const ehGithubPages = (host) => /\.github\.io$/.test(host);

// Troca, num texto, cada endereço de `de` (lista) por `para`. Devolve o texto novo.
// - o endereço inteiro, com ou sem a barra do fim;
// - de um GitHub Pages para outro (mudou a conta): também o servidor sozinho (https://conta.github.io e conta.github.io).
//   Para um domínio próprio o servidor do GitHub fica como está: ele continua sendo o endereço técnico por trás do domínio.
export function trocarTexto(texto, de, para) {
  const novo = partes(para);
  let out = texto;
  for (const velhoUrl of de) {
    if (velhoUrl === para) continue;
    const velho = partes(velhoUrl);
    out = out.split(velho.url).join(novo.url);
    out = out.replace(new RegExp(`${escRe(velho.url.slice(0, -1))}(?![\\w/.-])`, 'g'), novo.url.slice(0, -1));
    if (velho.host !== novo.host && ehGithubPages(velho.host) && ehGithubPages(novo.host)) {
      out = out.replace(new RegExp(`(?<![\\w.-])${escRe(velho.host)}(?![\\w-])`, 'g'), novo.host);
    }
  }
  return out;
}

// Página 404: caminhos absolutos (href="/REPO/...", src="/REPO/...", url(/REPO/...)) do caminho antigo para o novo.
export function trocarCaminho404(html, de, para) {
  const novo = partes(para).caminho;
  let out = html;
  for (const velhoUrl of de) {
    const velho = partes(velhoUrl).caminho;
    if (velho === novo) continue;
    out = velho === '/'
      ? out.replace(/((?:href|src)="|url\()\/(?!\/)/g, `$1${novo}`)
      : out.replace(new RegExp(`(["'(=])${escRe(velho)}`, 'g'), `$1${novo}`);
  }
  return out;
}

// Bloco das Edge Functions: acerta SITE_URL e SITE_ANTERIORES (só as linhas que o bloco tiver).
export function trocarBloco(fonte, atual, anteriores) {
  return fonte.replace(RE_BLOCO, (_, ini, meio, fim) => ini
    + meio.replace(/^(const SITE_URL = )'[^']*';/m, `$1'${atual}';`)
      .replace(/^(const SITE_ANTERIORES: string\[\] = )\[[^\]]*\];/m, `$1[${anteriores.map((a) => `'${a}'`).join(', ')}];`)
    + fim);
}
// Fora do bloco, a função é um arquivo de texto como os outros.
export function trocarFuncao(fonte, de, atual, anteriores) {
  const m = fonte.match(RE_BLOCO);
  if (!m) return trocarTexto(fonte, de, atual);
  const antes = fonte.slice(0, m.index), depois = fonte.slice(m.index + m[0].length);
  return trocarTexto(antes, de, atual) + trocarBloco(m[0], atual, anteriores) + trocarTexto(depois, de, atual);
}
export const origens = (atual, anteriores) => unicos([atual, ...anteriores].map((u) => new URL(u).origin));
export const trocarEnv = (texto, atual, anteriores) => texto.replace(/^ALLOWED_ORIGINS=.*$/m, `ALLOWED_ORIGINS=${origens(atual, anteriores).join(',')}`);
export const trocarConfig = (texto, atual) => texto.replace(/(siteUrl\s*:\s*)(['"])[^'"]*\2/, `$1'${atual}'`);
export function siteUrlDoConfig(root = ROOT) {
  const m = readFileSync(join(root, ARQ_CONFIG), 'utf8').match(/siteUrl\s*:\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error(`siteUrl não encontrado em ${ARQ_CONFIG}`);
  return m[1];
}
export function lerEndereco(root = ROOT) {
  const p = join(root, ARQ_ENDERECO);
  const j = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { atual: siteUrlDoConfig(root), anteriores: [] };
  return { atual: normalizar(j.atual), anteriores: (j.anteriores || []).map(normalizar) };
}
// Estado novo: o endereço que sai vai para a frente dos anteriores; o que entra (ou o esquecido) sai de lá.
export function proximoEndereco({ atual, anteriores }, novo, esquecer = []) {
  const fora = new Set([novo, ...esquecer]);
  return { atual: novo, anteriores: unicos([...(atual === novo ? [] : [atual]), ...anteriores]).filter((a) => !fora.has(a)) };
}

function arquivos(root, dir = root, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const rel = relative(root, p).split(sep).join('/');
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (!PASTAS_FORA.includes(rel)) arquivos(root, p, out); continue; }
    if (TEXTO.test(e.name) || rel === ARQ_ENV) out.push(rel);
  }
  return out;
}
// Todos os arquivos de texto do repositório (para a conferência do fim), inclusive as pastas que a troca não lê.
function todos(root, dir = root, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const rel = relative(root, p).split(sep).join('/');
    if (e.isSymbolicLink() || rel === '.git' || rel === 'node_modules') continue;
    if (e.isDirectory()) todos(root, p, out);
    else if (TEXTO.test(e.name) || rel === ARQ_ENV) out.push(rel);
  }
  return out;
}

// Passos 1 a 4. Devolve { estado, mudados: [arquivos] }. gravar=false: só diz o que mudaria.
export function trocar({ root = ROOT, novo, esquecer = [], gravar = true } = {}) {
  const antes = lerEndereco(root);
  const config = normalizar(siteUrlDoConfig(root));
  const alvo = normalizar(novo ?? antes.atual);
  const estado = proximoEndereco(antes, alvo, esquecer.map(normalizar));
  // Tudo o que o site já foi e não é mais (o config.js entra para o caso de ter sido trocado à mão).
  const de = unicos([antes.atual, config, ...antes.anteriores, ...estado.anteriores]).filter((u) => u !== alvo);
  const mudados = [];
  const grava = (rel, texto, novoTexto) => { if (novoTexto !== texto) { mudados.push(rel); if (gravar) writeFileSync(join(root, rel), novoTexto); } };

  const jsonNovo = `${JSON.stringify(estado, null, 2)}\n`;
  const jp = join(root, ARQ_ENDERECO);
  grava(ARQ_ENDERECO, existsSync(jp) ? readFileSync(jp, 'utf8') : '', jsonNovo);

  for (const rel of arquivos(root)) {
    if (rel === ARQ_ENDERECO || rel === ESTE) continue;
    const texto = readFileSync(join(root, rel), 'utf8');
    let out;
    if (rel === ARQ_CONFIG) out = trocarTexto(trocarConfig(texto, alvo), de, alvo);
    else if (rel === ARQ_ENV) out = trocarEnv(texto, alvo, estado.anteriores);
    else if (/^supabase\/functions\/[^/]+\/index\.ts$/.test(rel)) out = trocarFuncao(texto, de, alvo, estado.anteriores);
    else out = trocarTexto(texto, de, alvo);
    if (rel === '404.html') out = trocarCaminho404(out, de, alvo);
    grava(rel, texto, out);
  }
  return { estado, de, mudados };
}

// Passo 6: onde um endereço anterior (inteiro ou só o servidor, quando o servidor mudou) ainda aparece.
export function sobras({ root = ROOT, estado } = {}) {
  const novo = partes(estado.atual);
  const agulhas = unicos(estado.anteriores.flatMap((a) => { const p = partes(a); return p.host === novo.host ? [p.url] : [p.url, p.host]; }));
  const achados = [];
  if (!agulhas.length) return achados;
  for (const rel of todos(root)) {
    if (rel === ESTE) continue;
    const linhas = readFileSync(join(root, rel), 'utf8').split('\n');
    const n = linhas.filter((l) => agulhas.some((a) => l.includes(a))).length;
    if (!n) continue;
    const permitido = PERMITIDOS.find(([re]) => re.test(rel));
    achados.push({ arquivo: rel, linhas: n, motivo: permitido ? permitido[1] : null });
  }
  return achados;
}

const GERADORES = ['gerar-cidades.mjs', 'aplicar-rodape.mjs', 'aplicar-tema.mjs', 'aplicar-visitas.mjs', 'fontes.mjs'];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const semGeradores = args.includes('--sem-geradores');
  const esquecer = args.filter((a) => a.startsWith('--esquecer=')).map((a) => a.slice('--esquecer='.length));
  const livres = args.filter((a) => !a.startsWith('--'));
  const desconhecidas = args.filter((a) => a.startsWith('--') && !['--check', '--sem-geradores'].includes(a) && !a.startsWith('--esquecer='));
  if (livres.length > 1 || desconhecidas.length) {
    console.error(`Uso: node ${ESTE} [https://endereco-novo/] [--check] [--sem-geradores] [--esquecer=<endereço anterior>]`);
    process.exit(2);
  }
  let r;
  try { r = trocar({ novo: livres[0], esquecer, gravar: !check }); } catch (e) { console.error(e.message); process.exit(2); }
  const { estado, mudados } = r;
  console.log(`Endereço do site: ${estado.atual}`);
  console.log(`Anteriores ainda aceitos pelas Edge Functions: ${estado.anteriores.join(', ') || 'nenhum'}`);
  console.log(mudados.length
    ? `${check ? 'Fora do endereço atual' : 'Trocado em'} ${mudados.length} arquivo(s): ${mudados.slice(0, 40).join(', ')}${mudados.length > 40 ? ', …' : ''}`
    : 'Nenhum arquivo precisou mudar.');

  if (!check && !semGeradores) {
    for (const g of GERADORES) {
      const res = spawnSync(process.execPath, [join(ROOT, 'scripts', g)], { cwd: ROOT, encoding: 'utf8' });
      const saida = `${res.stdout || ''}${res.stderr || ''}`.trim().split('\n').slice(-2).join(' | ');
      console.log(`· ${g}: ${saida}`);
      if (res.status !== 0) { console.error(`O gerador ${g} falhou.`); process.exitCode = 1; }
    }
  }

  const achados = sobras({ estado });
  const ruins = achados.filter((a) => !a.motivo);
  if (achados.length) {
    console.log('Ainda citam um endereço anterior:');
    for (const a of achados) console.log(`  ${a.motivo ? 'ok  ' : 'ERRO'} ${a.arquivo} (${a.linhas} linha(s))${a.motivo ? ` — ${a.motivo}` : ' — não devia: troque à mão ou acrescente em PERMITIDOS com o motivo'}`);
  }
  if (ruins.length || (check && mudados.length)) process.exitCode = 1;
  if (!check) {
    console.log('Falta, fora deste script: subir o VERSION do sw.js, rodar os testes, commit e push; e, na produção (com o dono):'
      + ' Supabase → Authentication → URL Configuration (Site URL e Redirect URLs), publicar as Edge Functions (origens) e GitHub → Settings → Pages.');
  }
}
