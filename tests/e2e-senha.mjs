// Teste de ponta a ponta da ENTRADA COM SENHA (definir-senha.html e o bloco "Entrar com senha" dos quadros de entrada)
// num navegador de verdade (Playwright), com o Supabase Auth simulado EM MEMÓRIA.
// Cenários: sem sessão (quadro de pedir o link de recuperação; e-mail inválido; envio com redirect_to para esta página;
// erro do servidor de e-mail com mensagem honesta); link de recuperação (#access_token&type=recovery) aberto na própria
// página e numa página qualquer do site (gestao.html leva para definir-senha.html); senhas diferentes, curta, fraca
// (422) e salva (PUT /auth/v1/user com a senha, sem gravar a senha em lugar nenhum); link vencido; link de uso único
// conferido pelo próprio site (#token_hash, POST /auth/v1/verify, sem redirecionamento do Supabase); entrada com senha
// na conta (conta.html): senha errada (400), muitas tentativas (429), senha certa (sessão guardada, sem recarregar) e
// "Esqueci a senha"; o painel da clínica (painel.html) e a área do médico (medico.html) também têm o bloco; celular
// 390 px sem rolagem lateral; nenhum erro no console; chaves do Supabase só nos cabeçalhos certos (regra-chaves).
// Rodar com: node tests/e2e-senha.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta salva capturas; E2E_PORT muda a porta (padrão 4769); ONLY="trecho" roda só os cenários com esse texto.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, vigiarChaves } from './regra-chaves.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const PORT = Number(process.env.E2E_PORT) || 4769;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('não encontrado');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const USER_ID = 'uuuuuuuu-0000-4000-8000-0000000000a1';
const EMAIL = 'dono@imed.com.br';
const SENHA_CERTA = 'Senha-forte-123';
const HASH_BOM = '0123456789abcdef0123456789abcdef0123456789abcdef01234567';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });

// Supabase Auth simulado: otp, recover, token (senha e renovação), user (GET e PUT), logout; e um banco mínimo
// (tudo vazio) para as páginas que carregam dados depois de entrar.
async function newPage(browser, { mobile = false, logged = false, db: dbOpts = {} } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block',
  });
  const db = { recoverStatus: 200, recoverBody: {}, passwordStatus: null, putStatus: 200, putBody: null, tries: 0, ...dbOpts };
  const log = [];
  await context.addInitScript(([s]) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (s && !sessionStorage.getItem('__seeded')) { localStorage.setItem('imed_session', JSON.stringify(s)); sessionStorage.setItem('__seeded', '1'); }
    } catch { /* sem armazenamento */ }
  }, [logged ? { access_token: 'tok-init', refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: USER_ID, email: EMAIL } } : null]);
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const path = url.pathname;
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = req.postData(); }
    const entry = { method: req.method(), path, q: url.searchParams, body, auth: req.headers().authorization };
    log.push(entry);
    const logged = /^Bearer tok-/.test(entry.auth || '');
    if (path === '/auth/v1/verify' && req.method() === 'POST') {
      if (db.verifyStatus) return json(route, { code: db.verifyStatus, msg: 'erro' }, db.verifyStatus);
      if (body?.token_hash !== HASH_BOM || !['recovery', 'magiclink'].includes(body?.type)) return json(route, { code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' }, 403);
      return json(route, { access_token: 'tok-hash', refresh_token: 'ref-hash', expires_in: 3600, token_type: 'bearer', user: { id: USER_ID, email: EMAIL } });
    }
    if (path === '/auth/v1/otp') return json(route, {});
    if (path === '/auth/v1/recover') return json(route, db.recoverBody, db.recoverStatus);
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      db.tries += 1;
      if (db.passwordStatus === 429) return json(route, { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' }, 429);
      if (body?.email !== EMAIL || body?.password !== SENHA_CERTA) return json(route, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      return json(route, { access_token: 'tok-senha', refresh_token: 'ref-senha', expires_in: 3600, token_type: 'bearer', user: { id: USER_ID, email: EMAIL } });
    }
    if (path === '/auth/v1/token') return json(route, { access_token: 'tok-novo', refresh_token: 'ref2', expires_in: 3600, user: { id: USER_ID, email: EMAIL } });
    if (path === '/auth/v1/user' && req.method() === 'PUT') {
      if (!logged) return json(route, { msg: 'invalid' }, 401);
      if (db.putStatus !== 200) return json(route, db.putBody || { code: 422, error_code: 'weak_password', msg: 'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, 0123456789.' }, db.putStatus);
      return json(route, { id: USER_ID, email: EMAIL });
    }
    if (path === '/auth/v1/user') return logged ? json(route, { id: USER_ID, email: EMAIL }) : json(route, { msg: 'invalid' }, 401);
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
    const rest = path.replace('/rest/v1/', '');
    if (rest === 'rpc/is_imed_admin') return json(route, false);
    if (rest === 'rpc/agenda_me') return json(route, { clinics: [], invites: [] });
    if (rest === 'rpc/agenda_my_invites') return json(route, { invites: [] });
    if (rest === 'rpc/tele_doctor_me') return json(route, logged ? [{ id: null, full_name: null, status: null, is_admin: false }] : []);
    if (rest === 'rpc/request_status' || rest === 'rpc/track') return json(route, rest === 'rpc/track' ? true : []);
    if (req.method() === 'GET' && rest.startsWith('rpc/')) return json(route, []);
    return json(route, [], 200);
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return { page, context, log, errors, db };
}

const calls = (log, path, method) => log.filter((e) => e.path.endsWith(path) && (!method || e.method === method));
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
const noOverflow = async (page) => {
  const [w, sw] = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
  const vw = page.viewportSize().width;
  assert.ok(w <= vw && sw <= vw, `sem rolagem lateral (janela ${w}px, conteúdo ${sw}px, aparelho ${vw}px)`);
};
const session = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('imed_session') || 'null'));

const results = [];
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try { await Promise.race([comChaves(fn), limite(name)]); results.push(['ok', name]); console.log(`ok  ${name}`); } catch (e) { results.push(['FALHOU', name]); console.log(`FALHOU  ${name}\n   ${e.stack}`); }
}

const browser = vigiarChaves(await chromium.launch());

await scenario('definir-senha sem sessão: pede o link de recuperação, valida o e-mail e explica quando o e-mail falha', async () => {
  const { page, log, errors, context, db } = await newPage(browser);
  await page.goto(`${BASE}definir-senha.html`);
  await page.waitForSelector('#semSessao:not([hidden])');
  assert.ok(await page.isHidden('#comSessao'));
  assert.match(await page.textContent('#semSessao'), /vale 1 hora e só uma vez/);
  await page.fill('#recEmail', 'errado@');
  await page.click('#recBtn');
  assert.match(await page.textContent('#recMsg'), /e-mail válido/);
  assert.equal(calls(log, '/auth/v1/recover').length, 0);
  await page.fill('#recEmail', 'Dono@IMED.com.br');
  await page.click('#recBtn');
  await page.waitForSelector('#recMsg.ok');
  assert.match(await page.textContent('#recMsg'), /Enviamos um link para dono@imed\.com\.br/);
  const rec = calls(log, '/auth/v1/recover')[0];
  assert.deepEqual(rec.body, { email: 'dono@imed.com.br' });
  assert.equal(rec.q.get('redirect_to'), `${BASE}definir-senha.html`);
  assert.equal(rec.auth, undefined, 'visitante: sem Authorization');
  await shot(page, 'senha-01-sem-sessao');
  // O servidor de e-mail falhou (como na produção sem SMTP): aviso honesto, com o caminho do "Fale com o IMED".
  db.recoverStatus = 500; db.recoverBody = { code: 500, error_code: 'unexpected_failure', msg: 'Error sending recovery email' };
  await page.click('#recBtn');
  // "Enviando…" aparece antes da resposta: espera a mensagem final (no CI a resposta simulada demora mais).
  await page.waitForFunction(() => /Não foi possível/.test(document.querySelector('#recMsg').textContent));
  assert.match(await page.textContent('#recMsg'), /Não foi possível enviar o e-mail agora.*Fale com o IMED/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('link de recuperação: salva a senha (PUT /auth/v1/user), confere as duas senhas e o tamanho; fraca (422) avisa', async () => {
  const { page, log, errors, context, db } = await newPage(browser);
  await page.goto(`${BASE}definir-senha.html#access_token=tok-rec&refresh_token=ref-rec&expires_in=3600&token_type=bearer&type=recovery`);
  await page.waitForSelector('#comSessao:not([hidden])');
  assert.equal(new URL(page.url()).hash, '', 'endereço limpo (o token não fica no histórico)');
  assert.match(await page.textContent('#flash'), /Link confirmado. Agora escolha a sua senha/);
  assert.equal(await page.textContent('#meEmail'), EMAIL);
  assert.equal(calls(log, '/auth/v1/user', 'GET')[0].auth, 'Bearer tok-rec');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'senha1', 'foco no campo da senha');
  await page.fill('#senha1', 'curta');
  await page.fill('#senha2', 'curta');
  await page.click('#senhaBtn');
  assert.match(await page.textContent('#senhaMsg'), /pelo menos 8 caracteres/);
  await page.fill('#senha1', SENHA_CERTA);
  await page.fill('#senha2', 'Senha-forte-124');
  await page.click('#senhaBtn');
  assert.match(await page.textContent('#senhaMsg'), /não são iguais/);
  assert.equal(calls(log, '/auth/v1/user', 'PUT').length, 0, 'nada vai ao servidor antes de conferir');
  // Senha fraca para a regra do Supabase (422)
  db.putStatus = 422;
  await page.fill('#senha2', SENHA_CERTA);
  await page.click('#senhaBtn');
  await page.waitForFunction(() => /fraca demais/.test(document.querySelector('#senhaMsg').textContent));
  assert.match(await page.textContent('#senhaMsg'), /fraca demais/);
  db.putStatus = 200;
  await page.click('#senhaBtn');
  await page.waitForSelector('#pronto:not([hidden])');
  const put = calls(log, '/auth/v1/user', 'PUT')[1];
  assert.deepEqual(put.body, { password: SENHA_CERTA });
  assert.equal(put.auth, 'Bearer tok-rec');
  assert.ok(await page.isHidden('#senhaForm'));
  assert.match(await page.textContent('#pronto'), /Senha salva/);
  assert.equal(await page.$$eval('#pronto a', (a) => a.map((x) => x.getAttribute('href')).join('|')), 'conta.html|painel.html|medico.html');
  assert.equal(await page.evaluate(() => document.getElementById('senha1').value + document.getElementById('senha2').value), '', 'campos limpos');
  assert.ok(!JSON.stringify(await session(page)).includes(SENHA_CERTA), 'a senha nunca fica no aparelho');
  await shot(page, 'senha-02-salva');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('link de recuperação aberto noutra página do site leva para definir-senha.html; link vencido avisa', async () => {
  let { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}gestao.html#access_token=tok-rec&refresh_token=ref-rec&expires_in=3600&token_type=bearer&type=recovery`);
  await page.waitForURL(/definir-senha\.html$/);
  await page.waitForSelector('#comSessao:not([hidden])');
  assert.match(await page.textContent('#flash'), /Link confirmado/);
  assert.equal(await page.textContent('#meEmail'), EMAIL);
  assert.deepEqual(errors, []);
  await context.close();
  ({ page, errors, context } = await newPage(browser));
  await page.goto(`${BASE}definir-senha.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
  await page.waitForSelector('#semSessao:not([hidden])');
  assert.match(await page.textContent('#flash'), /Email link is invalid or has expired/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('link de uso único conferido pelo site (#token_hash): entra sem redirecionamento, limpa o endereço e salva a senha; vencido, malformado e servidor fora avisam', async () => {
  // 1. recovery na própria página: troca o código pela sessão (POST /auth/v1/verify) e deixa escolher a senha
  let { page, log, errors, context, db } = await newPage(browser);
  await page.goto(`${BASE}definir-senha.html#token_hash=${HASH_BOM}&type=recovery`);
  await page.waitForSelector('#comSessao:not([hidden])');
  assert.match(await page.textContent('#flash'), /Link confirmado/);
  assert.equal(await page.textContent('#meEmail'), EMAIL);
  assert.equal(new URL(page.url()).hash, '', 'o código sai do endereço');
  const v = calls(log, '/auth/v1/verify', 'POST');
  assert.equal(v.length, 1, 'uma conferência só');
  assert.deepEqual(v[0].body, { type: 'recovery', token_hash: HASH_BOM });
  assert.ok(!/^Bearer tok-/.test(v[0].auth || ''), 'a conferência vai sem sessão');
  assert.equal(calls(log, '/auth/v1/recover').length, 0, 'não pede e-mail nenhum');
  assert.equal((await session(page)).access_token, 'tok-hash');
  await page.fill('#senha1', SENHA_CERTA);
  await page.fill('#senha2', SENHA_CERTA);
  await page.click('#senhaBtn');
  await page.waitForSelector('#pronto:not([hidden])');
  const put = calls(log, '/auth/v1/user', 'PUT');
  assert.equal(put.length, 1);
  assert.equal(put[0].auth, 'Bearer tok-hash');
  assert.ok(!JSON.stringify(await page.evaluate(() => ({ ...localStorage }))).includes(SENHA_CERTA), 'a senha não fica guardada');
  await shot(page, 'senha-link-do-site');
  assert.deepEqual(errors, []);
  await context.close();

  // 2. recovery aberto noutra página do site: confere lá e leva para definir-senha.html
  ({ page, log, errors, context } = await newPage(browser));
  await page.goto(`${BASE}painel.html#token_hash=${HASH_BOM}&type=recovery`);
  await page.waitForURL(/definir-senha\.html$/);
  await page.waitForSelector('#comSessao:not([hidden])');
  assert.match(await page.textContent('#flash'), /Link confirmado/);
  assert.equal(calls(log, '/auth/v1/verify', 'POST').length, 1);
  assert.deepEqual(errors, []);
  await context.close();

  // 3. magiclink: entra e fica na página (sem ir para a senha)
  ({ page, log, errors, context } = await newPage(browser));
  await page.goto(`${BASE}painel.html#token_hash=${HASH_BOM}&type=magiclink`);
  await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('imed_session') || 'null')?.access_token === 'tok-hash'; } catch { return false; } });
  assert.match(page.url(), /painel\.html$/);
  assert.deepEqual(calls(log, '/auth/v1/verify', 'POST')[0].body, { type: 'magiclink', token_hash: HASH_BOM });
  assert.deepEqual(errors, []);
  await context.close();

  // 4. vencido ou já usado: aviso claro e o quadro de pedir outro, sem sessão
  ({ page, errors, context } = await newPage(browser));
  await page.goto(`${BASE}definir-senha.html#token_hash=${'f'.repeat(56)}&type=recovery`);
  await page.waitForSelector('#semSessao:not([hidden])');
  assert.match(await page.textContent('#flash'), /venceu ou já foi usado/);
  assert.equal(await session(page), null);
  assert.deepEqual(errors, []);
  await context.close();

  // 5. código malformado: nem chama o servidor
  ({ page, log, errors, context } = await newPage(browser));
  await page.goto(`${BASE}definir-senha.html#token_hash=%3Cscript%3E&type=recovery`);
  await page.waitForSelector('#semSessao:not([hidden])');
  assert.match(await page.textContent('#flash'), /venceu ou já foi usado/);
  assert.equal(calls(log, '/auth/v1/verify').length, 0);
  assert.deepEqual(errors, []);
  await context.close();

  // 6. servidor fora do ar: não diz que o link venceu
  ({ page, errors, context, db } = await newPage(browser, { db: { verifyStatus: 500 } }));
  await page.goto(`${BASE}definir-senha.html#token_hash=${HASH_BOM}&type=recovery`);
  await page.waitForSelector('#semSessao:not([hidden])');
  assert.match(await page.textContent('#flash'), /Não foi possível conferir o link agora/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('conta.html: "Entrar com senha" abre o campo; senha errada, muitas tentativas e senha certa (sem recarregar); "Esqueci a senha"', async () => {
  const { page, log, errors, context, db } = await newPage(browser);
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector('#signedOut:not([hidden])');
  assert.ok(await page.isHidden('#senhaCampos'), 'campo da senha fechado até pedir');
  assert.equal(await page.getAttribute('.es-abrir', 'aria-expanded'), 'false');
  await page.click('.es-abrir');
  await page.waitForSelector('#senhaCampos:not([hidden])');
  assert.equal(await page.getAttribute('.es-abrir', 'aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'loginSenha');
  // sem e-mail
  await page.fill('#loginSenha', 'x');
  await page.click('#loginSenhaBtn');
  assert.match(await page.textContent('#loginMsg'), /e-mail válido antes da senha/);
  assert.equal(calls(log, '/auth/v1/token').length, 0);
  // senha errada
  await page.fill('#email', 'Dono@IMED.com.br');
  await page.fill('#loginSenha', 'errada');
  await page.press('#loginSenha', 'Enter');
  await page.waitForFunction(() => /senha errados/.test(document.querySelector('#loginMsg').textContent));
  assert.match(await page.textContent('#loginMsg'), /E-mail ou senha errados.*Esqueci a senha/);
  const t1 = calls(log, '/auth/v1/token')[0];
  assert.equal(t1.q.get('grant_type'), 'password');
  assert.deepEqual(t1.body, { email: 'dono@imed.com.br', password: 'errada' });
  assert.equal(t1.auth, undefined, 'entrar: sem Authorization (só a chave publishable)');
  assert.equal(await session(page), null, 'sem sessão');
  // muitas tentativas
  db.passwordStatus = 429;
  await page.click('#loginSenhaBtn');
  await page.waitForFunction(() => /Muitas tentativas/.test(document.querySelector('#loginMsg').textContent));
  db.passwordStatus = null;
  await shot(page, 'senha-03-conta-errada');
  // senha certa: entra sem recarregar
  await page.fill('#loginSenha', SENHA_CERTA);
  await page.click('#loginSenhaBtn');
  await page.waitForSelector('#signedIn:not([hidden])');
  assert.equal(await page.textContent('#meEmail'), EMAIL);
  assert.match(await page.textContent('#flash'), /Pronto, você entrou/);
  const s = await session(page);
  assert.equal(s.access_token, 'tok-senha');
  assert.equal(s.user.email, EMAIL);
  assert.ok(!JSON.stringify(s).includes(SENHA_CERTA));
  await shot(page, 'senha-04-conta-entrou');
  // sair e "Esqueci a senha"
  await page.click('#logoutBtn');
  await page.waitForSelector('#signedOut:not([hidden])');
  // O quadro de entrada da conta fica na página (não é redesenhado): o campo da senha continua aberto.
  if (await page.isHidden('#senhaCampos')) await page.click('.es-abrir');
  await page.fill('#email', '');
  await page.click('#loginEsqueci');
  assert.match(await page.textContent('#loginMsg'), /Digite o seu e-mail/);
  await page.fill('#email', EMAIL);
  await page.click('#loginEsqueci');
  await page.waitForSelector('#loginMsg.ok');
  assert.match(await page.textContent('#loginMsg'), /Enviamos um link para dono@imed\.com\.br.*vale 1 hora/);
  const rec = calls(log, '/auth/v1/recover')[0];
  assert.equal(rec.q.get('redirect_to'), `${BASE}definir-senha.html`);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('painel.html e medico.html: o bloco "Entrar com senha" entra com a senha e carrega a área', async () => {
  let { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#loginEmail');
  await page.click('.es-abrir');
  await page.fill('#loginEmail', EMAIL);
  await page.fill('#loginSenha', SENHA_CERTA);
  await page.click('#loginSenhaBtn');
  await page.waitForSelector('#goClaim');
  assert.match(await page.textContent('#authBox'), /Você entrou como dono@imed\.com\.br/);
  assert.equal(calls(log, '/rpc/agenda_me')[0].auth, 'Bearer tok-senha');
  await shot(page, 'senha-05-painel');
  assert.deepEqual(errors, []);
  await context.close();
  ({ page, log, errors, context } = await newPage(browser));
  await page.goto(`${BASE}medico.html`);
  await page.waitForSelector('#loginEmail');
  await page.click('.es-abrir');
  await page.fill('#loginEmail', EMAIL);
  await page.fill('#loginSenha', SENHA_CERTA);
  await page.press('#loginSenha', 'Enter');
  await page.waitForSelector('#outBtn');
  await page.waitForSelector('#regCard:not([hidden])');
  assert.equal(calls(log, '/rpc/tele_doctor_me')[0].auth, 'Bearer tok-senha');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (390 px): definir senha e o bloco de senha da conta sem rolagem lateral', async () => {
  let { page, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(`${BASE}definir-senha.html`);
  await page.waitForSelector('#semSessao:not([hidden])');
  await noOverflow(page);
  await context.close();
  ({ page, errors, context } = await newPage(browser, { mobile: true, logged: true }));
  await page.goto(`${BASE}definir-senha.html`);
  await page.waitForSelector('#comSessao:not([hidden])');
  await noOverflow(page);
  await shot(page, 'senha-06-celular');
  await context.close();
  ({ page, errors, context } = await newPage(browser, { mobile: true }));
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector('#signedOut:not([hidden])');
  await page.click('.es-abrir');
  await page.waitForSelector('#senhaCampos:not([hidden])');
  await noOverflow(page);
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
