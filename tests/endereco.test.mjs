// O endereço público do site mora num lugar só (assets/js/config.js + scripts/endereco.json) e um comando troca o
// repositório inteiro: scripts/trocar-endereco.mjs. Este teste confere as regras da troca e que o repositório está em
// dia: nada fora do endereço atual, e um endereço anterior só onde é de propósito (Edge Functions, histórico).
// Rodar com: node --test tests/endereco.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  normalizar, partes, trocarTexto, trocarCaminho404, trocarBloco, trocarFuncao, trocarEnv, trocarConfig, origens,
  proximoEndereco, lerEndereco, siteUrlDoConfig, trocar, sobras, PERMITIDOS, BLOCO_INI, BLOCO_FIM,
} from '../scripts/trocar-endereco.mjs';
import { SITE, ORIGEM, CAMINHO, PASTA, semCaminho } from './endereco.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const A = 'https://conta-a.github.io/site-a/';
const B = 'https://conta-b.github.io/SITE-B/';
const DOM = 'https://imed.exemplo.br/';

test('normalizar: https, barra no fim, maiúsculas do caminho mantidas, sem consulta nem âncora', () => {
  assert.equal(normalizar('https://Conta-B.github.io/SITE-B'), B, 'servidor em minúsculas, caminho como veio, barra no fim');
  assert.equal(normalizar(' https://imed.exemplo.br '), DOM);
  for (const ruim of ['imed.exemplo.br', 'ftp://x/', 'https://x/?a=1', 'https://x/#a', 'https://u:s@x/', '']) assert.throws(() => normalizar(ruim), /inválido/, ruim);
  assert.deepEqual(partes(B), { url: B, origem: 'https://conta-b.github.io', host: 'conta-b.github.io', caminho: '/SITE-B/' });
});

test('trocarTexto: endereço inteiro (com e sem a barra) e, entre dois GitHub Pages, o servidor sozinho', () => {
  const t = `<link rel="canonical" href="${A}perto.html"> "${A}" (${A.slice(0, -1)}) CNAME conta-a.github.io ref https://conta-a.github.io/* outra-conta-a.github.io ${A.slice(0, -1)}-b/`;
  assert.equal(trocarTexto(t, [A], B),
    `<link rel="canonical" href="${B}perto.html"> "${B}" (${B.slice(0, -1)}) CNAME conta-b.github.io ref https://conta-b.github.io/* outra-conta-a.github.io https://conta-b.github.io/site-a-b/`);
  // Para um domínio próprio, o servidor do GitHub continua sendo o endereço técnico por trás (CNAME): não muda.
  assert.equal(trocarTexto(`${A}x.html CNAME conta-a.github.io`, [A], DOM), `${DOM}x.html CNAME conta-a.github.io`);
  // Vários anteriores de uma vez, e de novo não muda nada.
  const dois = trocarTexto(`${A}a ${B}b`, [A, B], DOM);
  assert.equal(dois, `${DOM}a ${DOM}b`);
  assert.equal(trocarTexto(dois, [A, B], DOM), dois);
  assert.equal(trocarTexto(`${A}a`, [A], A), `${A}a`, 'mesmo endereço: igual');
});

test('página 404: o caminho absoluto acompanha o endereço (repositório → outro repositório → domínio → repositório)', () => {
  const p = '<script src="/site-a/assets/js/tema.js"></script><a href="/site-a/">Início</a><style>@font-face{src:url(/site-a/assets/fonts/x.woff2)}</style><a href="https://cfm.org.br/">CFM</a><p>veja /site-a/ no texto</p>';
  const b = trocarCaminho404(p, [A], B);
  assert.equal(b, '<script src="/SITE-B/assets/js/tema.js"></script><a href="/SITE-B/">Início</a><style>@font-face{src:url(/SITE-B/assets/fonts/x.woff2)}</style><a href="https://cfm.org.br/">CFM</a><p>veja /site-a/ no texto</p>');
  const d = trocarCaminho404(b, [B], DOM);
  assert.equal(d, '<script src="/assets/js/tema.js"></script><a href="/">Início</a><style>@font-face{src:url(/assets/fonts/x.woff2)}</style><a href="https://cfm.org.br/">CFM</a><p>veja /site-a/ no texto</p>');
  assert.equal(trocarCaminho404(d, [DOM], B), b, 'do domínio de volta para um repositório (endereços de fora não mudam)');
  assert.equal(trocarCaminho404(b, [A], B), b, 'de novo: igual');
});

test('Edge Functions: o bloco endereco-do-site recebe o atual e os anteriores; fora do bloco é texto comum', () => {
  const fonte = `// usa ${A}\n${BLOCO_INI} (mantido pelo script)\nconst SITE_URL = '${A}';\nconst SITE_ANTERIORES: string[] = [];\n${BLOCO_FIM}\nconst UA = \`(+\${SITE_URL})\`; // ${A}\n`;
  const nova = trocarFuncao(fonte, [A], B, [A]);
  assert.equal(nova, `// usa ${B}\n${BLOCO_INI} (mantido pelo script)\nconst SITE_URL = '${B}';\nconst SITE_ANTERIORES: string[] = ['${A}'];\n${BLOCO_FIM}\nconst UA = \`(+\${SITE_URL})\`; // ${B}\n`);
  assert.equal(trocarFuncao(nova, [A], B, [A]), nova, 'de novo: igual (o anterior fica no bloco)');
  assert.equal(trocarBloco(nova, DOM, [B, A]).match(/SITE_ANTERIORES: string\[\] = (.*);/)[1], `['${B}', '${A}']`);
  // Bloco só com SITE_URL (importar-clinicas) e arquivo sem bloco.
  const so = `${BLOCO_INI}\nconst SITE_URL = '${A}';\n${BLOCO_FIM}\n`;
  assert.equal(trocarFuncao(so, [A], B, [A]), `${BLOCO_INI}\nconst SITE_URL = '${B}';\n${BLOCO_FIM}\n`);
  assert.equal(trocarFuncao(`const x = '${A}';`, [A], B, [A]), `const x = '${B}';`);
  assert.deepEqual(origens(B, [A, 'https://conta-b.github.io/outro/']), ['https://conta-b.github.io', 'https://conta-a.github.io']);
  assert.equal(trocarEnv('X=1\nALLOWED_ORIGINS=https://velho\nY=2\n', B, [A]), 'X=1\nALLOWED_ORIGINS=https://conta-b.github.io,https://conta-a.github.io\nY=2\n');
  assert.equal(trocarConfig(`  siteUrl: '${A}',\n  whatsapp: '',`, B), `  siteUrl: '${B}',\n  whatsapp: '',`);
});

test('lista dos endereços: o que sai vira anterior; repetir não muda; --esquecer tira', () => {
  const s1 = proximoEndereco({ atual: A, anteriores: [] }, B);
  assert.deepEqual(s1, { atual: B, anteriores: [A] });
  assert.deepEqual(proximoEndereco(s1, B), s1, 'repetir: igual');
  const s2 = proximoEndereco(s1, DOM);
  assert.deepEqual(s2, { atual: DOM, anteriores: [B, A] });
  assert.deepEqual(proximoEndereco(s2, DOM, [A]), { atual: DOM, anteriores: [B] }, 'esquecer um anterior');
  assert.deepEqual(proximoEndereco(s2, A), { atual: A, anteriores: [DOM, B] }, 'voltar para um anterior: ele sai da lista');
});

test('troca de ponta a ponta numa cópia pequena do site: troca tudo, guarda o anterior e é idempotente', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'imed-endereco-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const poe = (rel, texto) => { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), texto); };
  for (const f of ['assets/js/config.js', '404.html', 'sobre.html', 'supabase/functions/.env.example',
    'supabase/functions/clinicas-proximas/index.ts', 'supabase/functions/importar-clinicas/index.ts', 'supabase/functions/link-admin/index.ts']) {
    mkdirSync(dirname(join(tmp, f)), { recursive: true });
    cpSync(join(ROOT, f), join(tmp, f));
  }
  cpSync(join(ROOT, 'scripts/endereco.json'), (mkdirSync(join(tmp, 'scripts'), { recursive: true }), join(tmp, 'scripts/endereco.json')));
  // O que não pode ser reescrito: histórico e migração já aplicada.
  poe('memory/projects/antigo.md', `no ar em ${SITE}\n`);
  poe('supabase/migrations/20000101000000_x.sql', `-- ${SITE}\n`);
  poe('pagina-nova.html', `<link rel="canonical" href="${SITE}pagina-nova.html">`);

  const antes = lerEndereco(tmp);
  const seco = trocar({ root: tmp, novo: DOM, gravar: false });
  assert.ok(seco.mudados.includes('assets/js/config.js') && seco.mudados.includes('404.html'));
  assert.equal(siteUrlDoConfig(tmp), SITE, '--check não grava');

  const r = trocar({ root: tmp, novo: DOM });
  assert.deepEqual(r.estado, { atual: DOM, anteriores: [antes.atual, ...antes.anteriores] });
  assert.equal(siteUrlDoConfig(tmp), DOM);
  const le = (f) => readFileSync(join(tmp, f), 'utf8');
  assert.match(le('sobre.html'), new RegExp(`<link rel="canonical" href="${DOM}sobre\\.html">`));
  assert.equal(le('pagina-nova.html'), `<link rel="canonical" href="${DOM}pagina-nova.html">`);
  assert.ok(le('404.html').includes('<script src="/assets/js/tema.js"></script>') && (CAMINHO === '/' || !le('404.html').includes(`"${CAMINHO}`)), '404 com o caminho novo');
  const busca = le('supabase/functions/clinicas-proximas/index.ts');
  assert.ok(busca.includes(`const SITE_URL = '${DOM}';`) && busca.includes(`const SITE_ANTERIORES: string[] = ['${SITE}'`), 'a busca aceita o novo e o anterior');
  assert.ok(le('supabase/functions/link-admin/index.ts').includes(`const SITE_ANTERIORES: string[] = ['${SITE}'`));
  assert.ok(le('supabase/functions/importar-clinicas/index.ts').includes(`const SITE_URL = '${DOM}';`));
  assert.match(le('supabase/functions/.env.example'), new RegExp(`^ALLOWED_ORIGINS=https://imed\\.exemplo\\.br,${ORIGEM.replace(/[.]/g, '\\.')}`, 'm'));
  assert.equal(le('memory/projects/antigo.md'), `no ar em ${SITE}\n`, 'histórico não muda');
  assert.equal(le('supabase/migrations/20000101000000_x.sql'), `-- ${SITE}\n`, 'migração aplicada não muda');
  // De novo: nada muda. E o que sobrou do endereço anterior é só o que é de propósito.
  assert.deepEqual(trocar({ root: tmp, novo: DOM }).mudados, []);
  assert.deepEqual(trocar({ root: tmp }).mudados, [], 'sem endereço: repete o atual');
  const s = sobras({ root: tmp, estado: r.estado });
  assert.ok(s.length >= 4 && s.every((a) => a.motivo), JSON.stringify(s.filter((a) => !a.motivo)));
  // Um arquivo que voltou com o endereço anterior (por exemplo, numa junção de ramos) é consertado ao rodar de novo.
  poe('pagina-nova.html', `<a href="${SITE}x.html">`);
  assert.equal(sobras({ root: tmp, estado: r.estado }).filter((a) => !a.motivo).length, 1);
  assert.deepEqual(trocar({ root: tmp }).mudados, ['pagina-nova.html']);
  // Esquecer o anterior: as funções deixam de aceitá-lo.
  const e = trocar({ root: tmp, esquecer: [SITE] });
  assert.ok(!e.estado.anteriores.includes(SITE));
  assert.ok(!le('supabase/functions/link-admin/index.ts').includes(SITE) && !le('supabase/functions/.env.example').includes(ORIGEM));
});

test('o repositório está em dia: config.js = endereco.json, nada para trocar, e endereço anterior só onde é de propósito', () => {
  const estado = lerEndereco(ROOT);
  assert.equal(estado.atual, SITE, 'scripts/endereco.json e assets/js/config.js com o mesmo endereço (rode node scripts/trocar-endereco.mjs)');
  assert.equal(normalizar(SITE), SITE, 'siteUrl normalizado, com a barra no fim');
  assert.ok(SITE.startsWith('https://'), 'site só por https');
  assert.ok(!estado.anteriores.includes(SITE));
  assert.deepEqual(trocar({ root: ROOT, gravar: false }).mudados, [], 'arquivos fora do endereço atual: rode node scripts/trocar-endereco.mjs');
  const ruins = sobras({ root: ROOT, estado }).filter((a) => !a.motivo);
  assert.deepEqual(ruins, [], 'endereço anterior fora dos lugares permitidos');
  assert.ok(PERMITIDOS.every(([re, motivo]) => re instanceof RegExp && motivo.length > 10));
  // Ajudante dos testes.
  assert.equal(ORIGEM + CAMINHO, SITE);
  assert.equal(`/${PASTA}`, CAMINHO);
  assert.equal(semCaminho(`${CAMINHO}perto.html`), '/perto.html');
  assert.equal(semCaminho('/assets/x.js'), '/assets/x.js');
});

test('Edge Functions do repositório: aceitam o endereço atual e os anteriores; nada de endereço escrito fora do bloco', () => {
  const { atual, anteriores } = lerEndereco(ROOT);
  const lista = `[${anteriores.map((a) => `'${a}'`).join(', ')}]`;
  const busca = read('supabase/functions/clinicas-proximas/index.ts');
  assert.ok(busca.includes(`const SITE_URL = '${atual}';\nconst SITE_ANTERIORES: string[] = ${lista};\n${BLOCO_FIM}`));
  assert.match(busca, /const ALLOWED_ORIGINS = \(Deno\.env\.get\('ALLOWED_ORIGINS'\) \?\? defaultOrigins\(SITE_URL, SITE_ANTERIORES\)\.join\(','\)\)/);
  assert.match(busca, /const USER_AGENT = `IMED\/1\.0 \(\+\$\{SITE_URL\}; \$\{CONTACT\}\)`;/);
  const imp = read('supabase/functions/importar-clinicas/index.ts');
  assert.ok(imp.includes(`${BLOCO_INI}`) && imp.includes(`const SITE_URL = '${atual}';\n${BLOCO_FIM}`));
  assert.match(imp, /const UA = `IMED\/1\.0 \(\+\$\{SITE_URL\}; \$\{CONTACT\}\)`;/);
  const saida = read('supabase/functions/agenda-saida/index.ts');
  assert.ok(saida.includes(`${BLOCO_INI}`) && saida.includes(`const SITE_URL = '${atual}';\n${BLOCO_FIM}`), 'agenda-saida (5.3): o endereço dos links dos avisos vem do bloco');
  const link = read('supabase/functions/link-admin/index.ts');
  assert.ok(link.includes(`const SITE_URL = '${atual}';\nconst SITE_ANTERIORES: string[] = ${lista};\n${BLOCO_FIM}`));
  assert.match(link, /const SITES = \[SITE_URL, \.\.\.SITE_ANTERIORES\];/);
  assert.match(link, /const redirect_to = SITES\.some\(\(s\) => wanted\.startsWith\(s\)\) && !\/\[\\s#\]\/\.test\(wanted\) \? wanted : DEFAULT_REDIRECT\[type\];/);
  assert.match(link, /magiclink: `\$\{SITE_URL\}gestao\.html`, recovery: `\$\{SITE_URL\}definir-senha\.html`/, 'o padrão é sempre o endereço atual');
  // Fora do bloco, nenhum endereço de site escrito à mão (github.io ou o domínio).
  for (const f of ['clinicas-proximas', 'importar-clinicas', 'link-admin']) {
    const t = read(`supabase/functions/${f}/index.ts`);
    const fora = t.slice(0, t.indexOf(BLOCO_INI)) + t.slice(t.indexOf(BLOCO_FIM));
    assert.ok(!/github\.io/.test(fora) && !fora.includes(new URL(atual).host), `${f}: endereço do site só no bloco`);
  }
  assert.equal(read('supabase/functions/.env.example').match(/^ALLOWED_ORIGINS=(.*)$/m)[1], origens(atual, anteriores).join(','));
});

test('cópia do que está no ar (supabase/implantado): a busca aceita sempre as origens do site, com ou sem o segredo', () => {
  const { atual, anteriores } = lerEndereco(ROOT);
  const lista = `[${anteriores.map((a) => `'${a}'`).join(', ')}]`;
  const t = read('supabase/implantado/clinicas-proximas/index.ts');
  assert.ok(t.includes(`const SITE_URL = '${atual}';\nconst SITE_ANTERIORES: string[] = ${lista};\n${BLOCO_FIM}`));
  assert.match(t, /\.\.\.\[SITE_URL, \.\.\.SITE_ANTERIORES\]\.map\(\(u\) => new URL\(u\)\.origin\)/, 'origens do site somadas às do segredo');
  const fora = t.slice(0, t.indexOf(BLOCO_INI)) + t.slice(t.indexOf(BLOCO_FIM));
  assert.ok(!/github\.io/.test(fora) && !fora.includes(new URL(atual).host), 'endereço do site só no bloco');
});

test('scripts e workflows não têm o endereço escrito: leem do config.js', () => {
  const host = new URL(SITE).host;
  for (const f of ['scripts/capturas.mjs', 'scripts/gravar-video.mjs', 'scripts/verificar-chaves.mjs', 'scripts/gerar-cidades.mjs',
    'scripts/aplicar-rodape.mjs', 'scripts/rodape.mjs', 'scripts/fontes.mjs', '.github/workflows/capturas.yml', '.github/workflows/video.yml',
    '.github/workflows/testes.yml', '.github/workflows/banco.yml', '.github/workflows/chaves.yml', '.github/workflows/cid10.yml', '.github/workflows/equipamentos.yml']) {
    const t = read(f);
    assert.ok(!t.includes(host) && !/https:\/\/[\w-]+\.github\.io\/[\w-]/.test(t), `${f}: sem endereço do site escrito`);
  }
  for (const f of ['scripts/capturas.mjs', 'scripts/gravar-video.mjs']) assert.match(read(f), /arg\('url', ''\) \|\| SITE_CONFIG/, `${f}: sem --url vale o config.js`);
  for (const f of ['.github/workflows/capturas.yml', '.github/workflows/video.yml']) {
    assert.match(read(f), /url:\n\s+description: [^\n]*config\.js[^\n]*\n\s+default: ''\n/, `${f}: endereço vazio = o do config.js`);
    // Os ramos de resultado são gravados no repositório onde o workflow roda, com a permissão de escrita declarada.
    assert.match(read(f), /permissions:\n {2}contents: write/);
    assert.ok(read(f).includes('github.com/${GITHUB_REPOSITORY}.git'));
  }
});
