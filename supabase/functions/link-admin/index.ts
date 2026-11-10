// Edge Function "link-admin": gera o link de entrada (magic link) ou de recuperação de senha (recovery) de um
// administrador do IMED SEM enviar e-mail, para quando o envio de e-mail do Supabase Auth não está configurado.
// Só o próprio banco chama (pg_net), com o token interno da fila no cabeçalho x-imed-token (conferido por
// check_internal_token). Só gera link para e-mail que está em public.admin_emails. Publicar com verify_jwt=false.
// Nenhum segredo aqui: a URL e a chave service_role vêm dos segredos da função (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
//
// Corpo (JSON): { "email": "...", "type": "magiclink" | "recovery" (padrão magiclink), "redirect_to": "..." (opcional) }
//   - magiclink: a pessoa entra e cai em redirect_to (padrão: gestao.html).
//   - recovery: a pessoa entra e cai em redirect_to (padrão: definir-senha.html) para definir ou trocar a senha;
//     o link vale 1 h e 1 uso (regras do Supabase Auth). Qualquer página do site que receba um link
//     type=recovery leva para definir-senha.html (assets/js/auth.js, handleRedirect).
//   - redirect_to só dentro do site (SITE_URL ou, durante uma troca de endereço, um dos SITE_ANTERIORES); fora dele,
//     usa o padrão (sempre no endereço atual). O endereço também precisa estar em Authentication → URL Configuration →
//     Redirect URLs do Supabase, senão o Auth manda para o Site URL de lá.
// Como chamar pelo SQL (pg_net), sem e-mail:
//   select net.http_post(url := (select value from private.app_settings where key = 'functions_url') || '/link-admin',
//     headers := jsonb_build_object('Content-Type', 'application/json', 'x-imed-token', (select token from private.app_tokens where name = 'importer')),
//     body := jsonb_build_object('email', '<e-mail do admin>', 'type', 'recovery'));
//   e depois ler o link em net._http_response (apagar a linha depois de usar: o link é segredo).
const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// >>> endereco-do-site (bloco mantido por scripts/trocar-endereco.mjs; não edite à mão, rode o script)
// SITE_URL: endereço público do site. SITE_ANTERIORES: endereços que o site já teve e que continuam aceitos em
// redirect_to enquanto o site antigo existir (para tirar um: node scripts/trocar-endereco.mjs --esquecer=<endereço>).
const SITE_URL = 'https://rafael1717-ui.github.io/IMED/';
const SITE_ANTERIORES: string[] = ['https://drrafaelpereirabarreto-code.github.io/testedoapp/'];
// <<< endereco-do-site
const SITES = [SITE_URL, ...SITE_ANTERIORES];
const DEFAULT_REDIRECT: Record<string, string> = { magiclink: `${SITE_URL}gestao.html`, recovery: `${SITE_URL}definir-senha.html` };
const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
async function rpc(fn: string, args: unknown) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(args) });
  return r.ok ? r.json() : null;
}
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false }, 405);
  const tok = req.headers.get('x-imed-token') ?? '';
  if (!/^[0-9a-f]{64}$/.test(tok) || (await rpc('check_internal_token', { p_name: 'importer', p_token: tok })) !== true) return json({ ok: false, error: 'forbidden' }, 403);
  const body = await req.json().catch(() => ({}));
  const { email } = body ?? {};
  if (typeof email !== 'string') return json({ ok: false, error: 'invalid' }, 400);
  const type = body?.type === 'recovery' ? 'recovery' : 'magiclink';
  const wanted = typeof body?.redirect_to === 'string' ? body.redirect_to : '';
  const redirect_to = SITES.some((s) => wanted.startsWith(s)) && !/[\s#]/.test(wanted) ? wanted : DEFAULT_REDIRECT[type];
  const e = email.trim().toLowerCase();
  const ok = await fetch(`${URL_}/rest/v1/admin_emails?select=email&email=eq.${encodeURIComponent(e)}`, { headers: h }).then((r) => r.json()).catch(() => []);
  if (!Array.isArray(ok) || !ok.length) return json({ ok: false, error: 'not_admin' }, 403);
  const r = await fetch(`${URL_}/auth/v1/admin/generate_link`, { method: 'POST', headers: h, body: JSON.stringify({ type, email: e, redirect_to }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) return json({ ok: false, error: 'auth', status: r.status, msg: b?.msg ?? b?.error_description ?? null }, 502);
  return json({ ok: true, type, link: b.action_link ?? b?.properties?.action_link ?? null });
});
