// Conta no IMED (pacientes e clínicas): login por link mágico enviado por e-mail, pelo Supabase Auth, ou com e-mail e
// senha (quem definiu uma senha em definir-senha.html; a equipe do IMED entra assim quando o e-mail não chega).
// Sem biblioteca: fala direto com a API REST do Supabase. A sessão fica no localStorage deste navegador.
// Cabeçalhos pela regra única do site (IMED_CONFIG.supabaseHeaders, em config.js): a chave publishable vai só em
// "apikey"; "Authorization: Bearer" leva só o token da pessoa logada. Sem conta, vai só a chave.
const C = window.IMED_CONFIG;
const KEY = 'imed_session';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = (s) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* sem armazenamento */ } };

async function call(path, { method = 'GET', body, token, headers = {}, timeout = 15000 } = {}) {
  const res = await fetch(C.supabaseUrl + path, {
    method,
    headers: C.supabaseHeaders(token, { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data && (data.msg || data.message || data.error_description || data.error)) || `http ${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

function store(t) {
  const s = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Math.floor(Date.now() / 1000) + Number(t.expires_in || 3600), user: t.user ? { id: t.user.id, email: t.user.email } : null };
  write(s);
  return s;
}

// Sessão atual (ou null). Não confere a validade; use token() antes de chamar o banco.
export const session = () => read();
export const user = () => read()?.user ?? null;

// Manda o link de entrada para o e-mail. Ao clicar, a pessoa volta para `back` (padrão: esta página).
export async function signIn(email, back = location.href.split('#')[0]) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw Object.assign(new Error('E-mail inválido'), { code: 'invalid_email' });
  await call(`/auth/v1/otp?redirect_to=${encodeURIComponent(back)}`, { method: 'POST', body: { email: e, create_user: true } });
}

// Entra com e-mail e senha (quem já definiu uma senha). Erro: .status 400 e .code 'invalid_credentials' quando a
// senha está errada ou a conta não tem senha; 429 quando houve muitas tentativas.
export async function signInWithPassword(email, password) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw Object.assign(new Error('E-mail inválido'), { code: 'invalid_email' });
  if (!password) throw Object.assign(new Error('Senha em branco'), { code: 'empty_password' });
  try {
    const t = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: e, password } });
    return store(t);
  } catch (err) {
    err.code = err.data?.error_code || err.data?.code || err.code;
    throw err;
  }
}

// Endereço da página de definir senha, na mesma pasta do site desta página.
export const passwordPageUrl = () => location.origin + location.pathname.replace(/[^/]*$/, 'definir-senha.html');

// Manda o link de recuperação de senha. Ao clicar, a pessoa volta para `back` já com a sessão aberta e define a senha.
export async function recover(email, back = passwordPageUrl()) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw Object.assign(new Error('E-mail inválido'), { code: 'invalid_email' });
  await call(`/auth/v1/recover?redirect_to=${encodeURIComponent(back)}`, { method: 'POST', body: { email: e } });
}

// Define ou troca a senha da conta que está logada (mínimo de 8 caracteres, conferido aqui e no Supabase).
export async function setPassword(password) {
  const p = String(password || '');
  if (p.length < 8) throw Object.assign(new Error('Senha curta'), { code: 'weak_password' });
  const tok = await token();
  if (!tok) throw Object.assign(new Error('Sem sessão'), { code: 'no_session', status: 401 });
  try {
    const u = await call('/auth/v1/user', { method: 'PUT', body: { password: p }, token: tok });
    const s = read();
    if (s && u?.id) write({ ...s, user: { id: u.id, email: u.email } });
  } catch (err) {
    err.code = err.data?.error_code || err.data?.code || err.code;
    throw err;
  }
}

// Ao voltar do link do e-mail, a sessão vem no endereço (#access_token=...). Guarda e limpa o endereço.
// Devolve 'ok', 'error' (com a mensagem em .message) ou null quando não há nada para tratar.
// Link de recuperação de senha (type=recovery) aberto em qualquer página do site: guarda a sessão e leva para
// definir-senha.html (devolve 'ok' com recovery: true; a página pode ignorar, pois já está saindo).
//
// Link de uso único conferido pelo próprio site (#token_hash=...&type=recovery|magiclink): é o que a equipe do IMED
// gera pela função link-admin quando o e-mail do sistema não chega. O código é trocado pela sessão aqui mesmo
// (POST /auth/v1/verify), sem passar pelo redirecionamento do Supabase Auth; vale 1 hora e 1 uso.
export async function handleRedirect() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has('token_hash')) {
    history.replaceState(history.state, '', location.pathname + location.search);
    const type = h.get('type') === 'magiclink' ? 'magiclink' : 'recovery';
    const recovery = type === 'recovery';
    const th = h.get('token_hash') || '';
    const vencido = 'Este link venceu ou já foi usado. Peça outro à equipe do IMED.';
    if (!/^[A-Za-z0-9_-]{16,200}$/.test(th)) return { status: 'error', recovery, message: vencido };
    try {
      const t = await call('/auth/v1/verify', { method: 'POST', body: { type, token_hash: th } });
      if (!t?.access_token) throw Object.assign(new Error('sem sessão'), { status: 403 });
      store(t);
      if (recovery && !/\/definir-senha\.html$/.test(location.pathname)) location.replace(passwordPageUrl() + '#definir');
      return { status: 'ok', recovery };
    } catch (err) {
      const gasto = [400, 401, 403, 404, 410, 422].includes(err?.status);
      return { status: 'error', recovery, message: gasto ? vencido : err?.status === 429 ? 'Muitas tentativas em pouco tempo. Espere um minuto e abra o link de novo.' : 'Não foi possível conferir o link agora. Confira a internet e abra o link de novo.' };
    }
  }
  if (!h.has('access_token') && !h.has('error') && !h.has('error_description')) return null;
  history.replaceState(history.state, '', location.pathname + location.search);
  const recovery = h.get('type') === 'recovery';
  if (!h.has('access_token')) return { status: 'error', recovery, message: h.get('error_description') || 'O link expirou ou já foi usado. Peça outro.' };
  const t = { access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_in: h.get('expires_in') };
  try {
    const u = await call('/auth/v1/user', { token: t.access_token });
    store({ ...t, user: u });
    if (recovery && !/\/definir-senha\.html$/.test(location.pathname)) location.replace(passwordPageUrl() + '#definir');
    return { status: 'ok', recovery };
  } catch {
    return { status: 'error', recovery, message: recovery ? 'Não foi possível abrir o link de senha. Peça outro.' : 'Não foi possível confirmar a entrada. Peça outro link.' };
  }
}

// Token válido do usuário (renova se estiver para vencer) ou null se não estiver logado.
export async function token() {
  const s = read();
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  try {
    const t = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } });
    return store({ ...t, user: t.user || s.user }).access_token;
  } catch (err) {
    if (err.status === 400 || err.status === 401) write(null);
    return null;
  }
}

export async function signOut() {
  const s = read();
  write(null);
  if (s) await call('/auth/v1/logout', { method: 'POST', token: s.access_token }).catch(() => {});
}

// Chamadas ao banco com a conta (quando logado) ou só com a chave pública (visitante).
export async function rpc(fn, args = {}) {
  return call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args, token: await token() });
}
export async function select(path) {
  return call(`/rest/v1/${path}`, { token: await token() });
}
export async function insert(table, row) {
  return call(`/rest/v1/${table}`, { method: 'POST', body: row, token: await token(), headers: { Prefer: 'return=minimal' } });
}
