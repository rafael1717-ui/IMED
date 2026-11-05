// Chaves do Supabase (fase 0.1 do iMed Agenda): as chaves antigas "anon" e "service_role" (tokens JWT) param de
// funcionar no fim de 2026. As novas são a publishable (sb_publishable_..., pública, no site) e a secreta
// (sb_secret_..., só no servidor), e as duas vão SÓ no cabeçalho "apikey": não são tokens, e a documentação do
// Supabase manda nunca pô-las em "Authorization: Bearer" (onde ele espera um token, recusa: "Invalid JWT").
// Este teste confere, sem internet:
// - o site usa só a chave publishable, em assets/js/config.js (supabaseKey), e nenhum módulo lê supabaseAnonKey;
// - nenhum arquivo do site (páginas, guias, cidades), das Edge Functions, dos scripts ou do GitHub tem chave JWT do
//   Supabase ou chave secreta, e a chave publishable de verdade mora num lugar só (config.js), para trocar com uma
//   edição; no repositório INTEIRO (memória, migrações, testes...), nenhuma chave secreta nem token service_role;
// - a chave pública nunca vai em "Bearer": só a regra dos cabeçalhos (IMED_CONFIG.supabaseHeaders, em config.js)
//   escreve "Authorization", e só com o token de quem entrou na conta; nenhum outro módulo monta "apikey" à mão
//   (nem os testes do banco de verdade, tests/banco, que usam a mesma regra);
// - as Edge Functions leem SUPABASE_PUBLISHABLE_KEYS e SUPABASE_SECRET_KEYS com volta para as antigas, a
//   clinicas-proximas não depende do token de quem chama e todas ficam com verify_jwt = false (supabase/config.toml).
// O comportamento das funções (JSON, ausente, antiga) está em supabase/functions/*/lib.test.ts; a conferência na
// produção, em scripts/verificar-chaves.mjs (GitHub Actions → "Chaves do Supabase").
// Rodar com: node --test tests/chaves.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const CONFIG = read('assets/js/config.js');

// Arquivos de texto de uma pasta, recursivo (caminhos relativos à raiz do repositório).
const TEXTO = new Set(['.js', '.mjs', '.ts', '.html', '.css', '.json', '.txt', '.md', '.yml', '.yaml', '.webmanifest', '.example', '.toml', '.sql', '.xml']);
function arquivos(pasta, { fora = [] } = {}) {
  const out = [];
  const anda = (dir) => {
    for (const nome of readdirSync(join(ROOT, dir))) {
      const rel = dir ? `${dir}/${nome}` : nome;
      if (fora.some((f) => rel === f || rel.startsWith(`${f}/`))) continue;
      const st = statSync(join(ROOT, rel));
      if (st.isDirectory()) anda(rel);
      else if (TEXTO.has(extname(nome)) || nome.startsWith('.env')) out.push(rel);
    }
  };
  anda(pasta);
  return out;
}
const PAGINAS = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const SITE_JS = readdirSync(join(ROOT, 'assets/js')).filter((f) => f.endsWith('.js')).map((f) => `assets/js/${f}`);
// Tudo o que vai para o navegador ou para o servidor, mais os scripts e o GitHub. (A memória do projeto e os testes
// ficam de fora: os testes usam chaves de mentira.)
const VARRIDOS = [
  ...arquivos('assets'), ...arquivos('supabase/functions'), ...arquivos('scripts'), ...arquivos('.github'),
  ...arquivos('exames'), ...arquivos('cidades'), ...PAGINAS, 'README.md', 'llms.txt', 'sw.js', 'manifest.webmanifest',
];
// O repositório inteiro (é público): para as chaves que dão acesso total ao banco.
const TUDO = arquivos('', { fora: ['.git', 'node_modules', 'tests/banco/node_modules'] });

// Configuração de verdade num navegador de mentira (node:vm).
function config() {
  const g = {};
  g.window = g;
  vm.createContext(g);
  vm.runInContext(CONFIG, g);
  return g.IMED_CONFIG;
}

test('config.js: a chave do site é a publishable (supabaseKey), sem a anon antiga', () => {
  const m = CONFIG.match(/supabaseKey:\s*'([^']+)'/);
  assert.ok(m, 'supabaseKey em assets/js/config.js');
  assert.match(m[1], /^sb_publishable_[A-Za-z0-9_-]{20,}$/, 'chave publishable (sb_publishable_...)');
  assert.doesNotMatch(CONFIG, /supabaseAnonKey/, 'a propriedade antiga saiu');
  const cfg = config();
  assert.equal(cfg.supabaseKey, m[1]);
  assert.equal(cfg.supabaseUrl, 'https://pyoqiecupxhdzigjudyd.supabase.co');
  assert.equal(cfg.functionsUrl, `${cfg.supabaseUrl}/functions/v1`);
});

test('regra dos cabeçalhos: visitante só com apikey; logado com apikey e o token da pessoa em Bearer', () => {
  const cfg = config();
  const KEY = cfg.supabaseKey;
  const h = (...a) => ({ ...cfg.supabaseHeaders(...a) });
  // Visitante: só a chave publishable, sem Authorization.
  assert.deepEqual(h(), { apikey: KEY });
  assert.deepEqual(h(null), { apikey: KEY });
  assert.deepEqual(h(''), { apikey: KEY });
  assert.deepEqual(h(undefined, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }), { 'Content-Type': 'application/json', Prefer: 'return=minimal', apikey: KEY });
  // Logado: o token de acesso da pessoa (um JWT do Supabase Auth) em Bearer, e a chave no apikey.
  const TOKEN = 'cabecalho.conteudo.assinatura';
  assert.deepEqual(h(TOKEN, { 'Content-Type': 'application/json' }), { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${TOKEN}` });
  assert.deepEqual(h('tok-paciente'), { apikey: KEY, Authorization: 'Bearer tok-paciente' });
  // Uma chave (a publishable ou qualquer "sb_") nunca vai em Bearer, nem passada como token.
  assert.deepEqual(h(KEY), { apikey: KEY });
  assert.deepEqual(h('sb_secret_falsa'), { apikey: KEY });
  // apikey e Authorization só esta função decide: os de "extra" são ignorados.
  assert.deepEqual(h(null, { Authorization: `Bearer ${KEY}`, apikey: 'outra', authorization: 'Bearer x', APIKEY: 'y' }), { apikey: KEY });
  assert.deepEqual(h(TOKEN, { Authorization: 'Bearer outro' }), { apikey: KEY, Authorization: `Bearer ${TOKEN}` });
});

test('nenhuma chave JWT do Supabase (anon/service_role) nem chave secreta no site, nas funções, nos scripts e no GitHub', () => {
  const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
  const SECRETA = /sb_secret_[A-Za-z0-9_-]{20,}/;
  const PUBLICA = /sb_publishable_[A-Za-z0-9_-]{20,}/;
  const ruins = [];
  for (const f of VARRIDOS) {
    const t = read(f);
    if (JWT.test(t)) ruins.push(`${f}: token JWT (chave antiga anon/service_role?)`);
    if (SECRETA.test(t)) ruins.push(`${f}: chave secreta (sb_secret_...)`);
    if (f !== 'assets/js/config.js' && PUBLICA.test(t)) ruins.push(`${f}: chave publishable fora do config.js (leia de lá)`);
    if (/Bearer\s+sb_/.test(t)) ruins.push(`${f}: chave nova em "Bearer"`);
    // A conferência na produção lê o config.js PUBLICADO, que pode ainda ser o antigo (supabaseAnonKey), para provar
    // que o site antigo continua funcionando com as funções novas: só ali, e só para ler.
    const leituraDoPublicado = f === 'scripts/verificar-chaves.mjs' && t.match(/supabaseAnonKey/g)?.length === 1 && /pega\(t, 'supabaseAnonKey'\)/.test(t);
    if (/supabaseAnonKey/.test(t) && !leituraDoPublicado) ruins.push(`${f}: supabaseAnonKey (a propriedade agora é supabaseKey)`);
  }
  assert.deepEqual(ruins, []);
  assert.ok(VARRIDOS.length > 100, `varreu ${VARRIDOS.length} arquivos`);
  assert.ok(VARRIDOS.includes('assets/js/config.js') && VARRIDOS.includes('supabase/functions/clinicas-proximas/index.ts'));
  assert.ok(VARRIDOS.includes('cidades/sp/sao-paulo/index.html'), 'as páginas das cidades também');
});

// Papel de um token JWT (o campo "role" do meio), ou null se não for um JWT legível.
function papel(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))?.role ?? null; } catch { return null; }
}

test('repositório inteiro (é público): nenhuma chave secreta (sb_secret_...) nem token service_role', () => {
  const SECRETA = /sb_secret_[A-Za-z0-9_-]{20,}/;
  const JWTS = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
  const ruins = [];
  for (const f of TUDO) {
    const t = read(f);
    if (SECRETA.test(t)) ruins.push(`${f}: chave secreta (sb_secret_...)`);
    for (const [jwt] of t.matchAll(JWTS)) {
      const r = papel(jwt);
      if (r === 'service_role' || r === 'supabase_admin') ruins.push(`${f}: token JWT com papel ${r}`);
    }
  }
  assert.deepEqual(ruins, []);
  for (const f of ['memory/projects/imed-agenda-arquitetura.md', 'CLAUDE.md', 'supabase/config.toml', 'tests/banco/lib.mjs']) {
    assert.ok(TUDO.includes(f), `varreu ${f}`);
  }
  assert.ok(TUDO.some((f) => f.startsWith('supabase/migrations/') && f.endsWith('.sql')), 'varreu as migrações');
  // O detector reconhece um token service_role (montado aqui, nunca escrito em arquivo).
  const falso = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase' })).toString('base64url'), 'assinatura-falsa'].join('.');
  assert.equal(papel(falso), 'service_role');
});

test('supabase/config.toml: toda Edge Function com verify_jwt = false (a função confere quem chama)', () => {
  const toml = read('supabase/config.toml');
  const secoes = [...toml.matchAll(/^\[functions\.([a-z0-9-]+)\][^\n]*\n((?:(?!\[)[^\n]*\n?)*)/gm)].map((m) => ({ nome: m[1], corpo: m[2] }));
  const nomes = secoes.map((x) => x.nome);
  for (const f of ['clinicas-proximas', 'importar-clinicas']) assert.ok(nomes.includes(f), `[functions.${f}] no config.toml`);
  for (const { nome, corpo } of secoes) {
    assert.match(corpo, /^verify_jwt = false\s*$/m, `[functions.${nome}]: verify_jwt = false`);
    assert.doesNotMatch(corpo, /^verify_jwt = true/m, `[functions.${nome}]: nada de verify_jwt = true`);
  }
  assert.doesNotMatch(toml, /^\s*verify_jwt\s*=\s*true/m);
});

test('tests/banco (banco de verdade no GitHub): pedidos com a regra dos cabeçalhos do site', () => {
  const lib = read('tests/banco/lib.mjs');
  assert.match(lib, /PUBLISHABLE_KEY/, 'usa a chave publishable do Supabase local');
  assert.match(lib, /regraDoSite\.supabaseHeaders\(token \?\? null, extra\)/, 'cabecalhosDoSite chama a regra do config.js');
  assert.match(lib, /headers: cabecalhosDoSite\(cfg, token, /, 'postgrest() manda os cabeçalhos do site');
  const ruins = [];
  for (const f of arquivos('tests/banco', { fora: ['tests/banco/node_modules'] }).filter((x) => /\.m?js$/.test(x))) {
    const t = read(f);
    if (/[{,]\s*['"]?apikey['"]?\s*:/i.test(t)) ruins.push(`${f}: monta "apikey" (use cabecalhosDoSite)`);
    if (/[{,]\s*['"]?Authorization['"]?\s*:/i.test(t)) ruins.push(`${f}: monta "Authorization" (use cabecalhosDoSite)`);
    if (/tokenAnon\(cfg\)/.test(t)) ruins.push(`${f}: token de visitante (o site não manda mais: visitante vai sem token)`);
  }
  assert.deepEqual(ruins, []);
});

test('"Authorization" e "apikey" só na regra dos cabeçalhos (config.js): nenhum módulo monta à mão', () => {
  // Chave de objeto ({ apikey: ... } / { Authorization: ... }) e montagem de "Bearer " + algo.
  const CHAVE_APIKEY = /[{,]\s*['"]?apikey['"]?\s*:/i;
  const CHAVE_AUTH = /[{,]\s*['"]?Authorization['"]?\s*:/i;
  const MONTA_BEARER = /['"`]Bearer\s*['"`]?\s*(\+|\$\{)|`Bearer \$\{/;
  const ruins = [];
  for (const f of [...SITE_JS, ...PAGINAS, ...arquivos('exames')]) {
    if (f === 'assets/js/config.js') continue;
    const t = read(f);
    if (CHAVE_APIKEY.test(t)) ruins.push(`${f}: monta "apikey" (use IMED_CONFIG.supabaseHeaders)`);
    if (CHAVE_AUTH.test(t)) ruins.push(`${f}: monta "Authorization" (use IMED_CONFIG.supabaseHeaders)`);
    if (MONTA_BEARER.test(t)) ruins.push(`${f}: monta "Bearer ..." (use IMED_CONFIG.supabaseHeaders)`);
  }
  assert.deepEqual(ruins, []);
  // A própria regra: um "Authorization" só, com o token (nunca a chave).
  assert.equal(CONFIG.match(/h\.Authorization\s*=/g)?.length, 1);
  assert.match(CONFIG, /h\.Authorization = 'Bearer ' \+ token;/);
  assert.match(CONFIG, /token !== cfg\.supabaseKey && token\.indexOf\('sb_'\) !== 0/);
});

test('todo módulo que fala com o Supabase usa a regra dos cabeçalhos', () => {
  const falam = SITE_JS.filter((f) => f !== 'assets/js/config.js' && /\b(supabaseUrl|functionsUrl)\b/.test(read(f)));
  // Os que falam direto (fetch); os outros (conta, clínica, gestão, médico, teleconsulta, contato) passam pelo
  // auth.js. O painel só passa o endereço e a chave para o canal de avisos (tempo-real.js, fase 4.3), que fala por
  // WebSocket (sem cabeçalhos: a chave vai em ?apikey=, como a documentação do Realtime pede).
  const WS_SO = ['assets/js/painel.js', 'assets/js/tempo-real.js'];
  assert.deepEqual(falam.sort(), [
    'assets/js/auth.js', 'assets/js/cidade.js', 'assets/js/db.js', 'assets/js/documento.js', 'assets/js/inicio.js',
    'assets/js/local.js', 'assets/js/medico.js', 'assets/js/painel.js', 'assets/js/parceiros.js', 'assets/js/perto.js',
    'assets/js/tempo-real.js', 'assets/js/visitas.js',
  ]);
  for (const f of falam) if (!WS_SO.includes(f)) assert.match(read(f), /supabaseHeaders\(/, `${f} usa IMED_CONFIG.supabaseHeaders`);
  const tr = read('assets/js/tempo-real.js');
  assert.match(tr, /\/realtime\/v1\/websocket\?apikey=\$\{encodeURIComponent\(chave\)\}&vsn=1\.0\.0/, 'tempo-real.js: a chave publishable em ?apikey= (o WebSocket não leva cabeçalhos)');
  assert.doesNotMatch(tr, /fetch\s*\(/, 'tempo-real.js não chama a API por conta própria (a versão vem pelo rpc do auth.js)');
  assert.doesNotMatch(tr, /access_token=|token=\$\{/, 'o token da pessoa nunca vai no endereço do WebSocket');
  assert.match(read('assets/js/painel.js'), /chave: window\.IMED_CONFIG\?\.supabaseKey/, 'painel.js passa a chave do config.js');
  // Nenhum outro jeito de falar com o Supabase escondido: endereço do banco escrito à mão, sendBeacon (que não leva
  // cabeçalhos) ou WebSocket fora do canal de avisos.
  for (const f of SITE_JS) {
    const t = read(f);
    if (f !== 'assets/js/config.js') assert.doesNotMatch(t, /pyoqiecupxhdzigjudyd\.supabase\.co/, `${f}: endereço do banco vem do config.js`);
    assert.doesNotMatch(t, /sendBeacon\s*\(/, `${f}: sendBeacon não leva o cabeçalho apikey`);
    if (f !== 'assets/js/tempo-real.js') assert.doesNotMatch(t, /new\s+WS\s*\(|new\s+WebSocket\s*\(/, `${f}: o Realtime (WebSocket) só em tempo-real.js`);
  }
  // Pedido com conta: o token da pessoa (sessão) vai pela regra; o contador e as páginas públicas, nunca.
  assert.match(read('assets/js/auth.js'), /C\.supabaseHeaders\(token,/);
  assert.match(read('assets/js/medico.js'), /C\.supabaseHeaders\(s\.access_token,/);
  for (const f of ['assets/js/visitas.js', 'assets/js/db.js', 'assets/js/parceiros.js', 'assets/js/cidade.js', 'assets/js/documento.js', 'assets/js/inicio.js', 'assets/js/perto.js', 'assets/js/local.js']) {
    assert.doesNotMatch(read(f), /supabaseHeaders\((?!null\b)[^)]/, `${f}: só como visitante (supabaseHeaders(null, ...))`);
  }
});

// Bloco das chaves dentro do lib.ts de cada função (igual nas duas).
const LIBS = ['supabase/functions/clinicas-proximas/lib.ts', 'supabase/functions/importar-clinicas/lib.ts'];
const bloco = (f) => {
  const t = read(f);
  const i = t.indexOf('/* ===== Chaves do Supabase: início');
  const j = t.indexOf('/* ===== Chaves do Supabase: fim ===== */');
  assert.ok(i >= 0 && j > i, `${f}: bloco das chaves`);
  return t.slice(i, j);
};

test('Edge Functions: leem as chaves novas (JSON por nome) com volta para as antigas, no mesmo bloco nas duas', () => {
  const [a, b] = LIBS.map(bloco);
  assert.equal(a, b, 'o bloco das chaves é igual em clinicas-proximas/lib.ts e importar-clinicas/lib.ts');
  for (const v of ['SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_SECRET_KEYS', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    assert.match(a, new RegExp(`'${v}'`), `lê ${v}`);
  }
  assert.match(a, /JSON\.parse\(raw\)/, 'as novas são JSON por nome');
  assert.match(a, /list\[name\] \?\? Object\.values\(list\)\[0\]/, '"default" primeiro');
  assert.match(a, /k\.legacy && !k\.key\.startsWith\('sb_'\) \? \{ apikey: k\.key, Authorization: `Bearer \$\{k\.key\}` \} : \{ apikey: k\.key \}/,
    'só a antiga (JWT) vai em Bearer');
  for (const f of ['supabase/functions/clinicas-proximas/index.ts', 'supabase/functions/importar-clinicas/index.ts']) {
    const t = read(f);
    // As variáveis das chaves só são lidas pelo bloco (nada de Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') solto).
    assert.doesNotMatch(t, /['"]SUPABASE_(ANON_KEY|SERVICE_ROLE_KEY|PUBLISHABLE_KEYS?|SECRET_KEYS?)['"]/, `${f}: lê as chaves pelo lib.ts`);
    assert.doesNotMatch(t, /Bearer \$\{|['"]Bearer ['"]\s*\+/, `${f}: Bearer só pelo keyHeaders (chave antiga)`);
    assert.match(t, /keyHeaders\((PUBLIC_KEY|SECRET_KEY)\)/, `${f}: chama o Supabase com keyHeaders`);
    assert.match(t, /--no-verify-jwt --project-ref pyoqiecupxhdzigjudyd/, `${f}: o comando de publicação está no topo`);
  }
});

test('clinicas-proximas: não depende do token de quem chama e confere a chave no código (verify_jwt=false)', () => {
  const t = read('supabase/functions/clinicas-proximas/index.ts');
  const topo = t.split('\n').slice(0, 20).join('\n');
  assert.match(topo, /PUBLICAR SEMPRE COM verify_jwt=false/);
  assert.doesNotMatch(t, /headers\.get\(['"]authorization['"]\)/i, 'não lê o Authorization de quem chama');
  assert.doesNotMatch(t, /headers\.get\(['"]apikey['"]\)/i, 'não repassa a chave de quem chama ao banco');
  assert.match(t, /if \(!callerAllowed\(req\.headers, CALLER_KEYS\)\) return json\(\{ ok: false, error: 'unauthorized' \}, 401, h\);/);
  // As travas são as de lib.ts (com testes em lib.test.ts): origem no navegador e limite por IP.
  assert.match(t, /if \(!originAllowed\(origin, ALLOWED_ORIGINS\)\) return json\(\{ ok: false, error: 'origin_not_allowed' \}, 403, h\);/);
  assert.match(t, /if \(rateLimited\(hits, clientIp\(req\.headers\), Date\.now\(\)\)\) return json\(\{ ok: false, error: 'rate_limited' \}, 429/);
  // Ordem das travas: origem, método, limite por IP, chave e só então o corpo da busca.
  const pos = ['origin_not_allowed', 'method_not_allowed', 'rate_limited', 'unauthorized', 'invalid_json'].map((s) => t.indexOf(`'${s}'`));
  assert.ok(pos.every((p, i) => p > 0 && (i === 0 || p > pos[i - 1])), `travas na ordem: ${pos.join(', ')}`);
  assert.match(t, /const CALLER_KEYS = callerKeys\(env\);/, 'aceita só as publishable (e a anon antiga)');
  assert.match(read('supabase/functions/clinicas-proximas/lib.ts'), /return acceptedKeys\(env, PUBLISHABLE_VARS\);/);
  const imp = read('supabase/functions/importar-clinicas/index.ts');
  assert.match(imp, /if \(hasKey\(req\.headers, SERVER_KEYS\)\) return true;/, 'importador: chave secreta (ou a service_role antiga)');
  assert.match(imp, /const SERVER_KEYS = acceptedKeys\(env, SECRET_VARS\);/);
  assert.match(imp, /x-imed-token/, 'e o token interno da fila (pg_cron)');
  // O "ping" (a busca prova que a chave secreta dela é aceita) só responde depois da conferência de quem chama.
  const auth = imp.indexOf("if (!await authorized(req)) return json({ ok: false, error: 'forbidden' }, 403);");
  const ping = imp.indexOf("if (body.action === 'ping') return json({ ok: true });");
  assert.ok(auth > 0 && ping > auth, 'ping depois da conferência');
});
