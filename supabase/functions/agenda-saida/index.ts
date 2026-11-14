// Edge Function "agenda-saida": envia os avisos e os lembretes da agenda (iMed Agenda, fase 5.3).
//
// NÃO ESTÁ PUBLICADA (13/11/2026): só a fonte, testada. O banco prepara os avisos (migração agenda_avisos) e o envio
// fica desligado pelo parâmetro avisos.envio_ligado (0). Para ligar um dia, nesta ordem e com a aprovação do dono:
//   1. publicar esta função;
//   2. gravar os segredos RESEND_API_KEY e AVISOS_EMAIL_FROM (remetente de um domínio verificado no provedor);
//   3. criar o token interno no banco: insert into private.app_tokens (name) values ('agenda_saida');
//   4. pôr o parâmetro avisos.envio_ligado em 1 (painel de gestão, Agenda das clínicas, Parâmetros).
// Sem o passo 2, a função roda e fecha cada aviso como "sem_canal" (nunca "enviada").
//
// Quem chama: o cron do banco (private.agenda_notify_tick, a cada minuto, só quando há aviso vencido), com o token
// interno no cabeçalho x-imed-token; ou o próprio servidor, com a chave secreta do projeto no "apikey".
// Ação (POST, JSON): { action: "enviar" } → pega até 3 lotes de 20 avisos (agenda_notify_claim), envia e responde ao
// banco um por um (agenda_notify_done). A resposta desta função traz só contagens: nenhum destino, nenhum dado de
// paciente, nenhum id de pedido.
//
// PUBLICAR COM verify_jwt=false (quem chama é conferido aqui no código):
//   supabase functions deploy agenda-saida --no-verify-jwt --project-ref pyoqiecupxhdzigjudyd

import { acceptedKeys, canaisDoAmbiente, hasKey, keyHeaders, processar, SECRET_VARS, secretKey, type Contagem, type Resultado } from './lib.ts';

const env = (name: string) => Deno.env.get(name);
const SUPABASE_URL = env('SUPABASE_URL') ?? '';
const SECRET_KEY = secretKey(env);
const SERVER_KEYS = acceptedKeys(env, SECRET_VARS);
// >>> endereco-do-site (bloco mantido por scripts/trocar-endereco.mjs; não edite à mão, rode o script)
const SITE_URL = 'https://rafael1717-ui.github.io/IMED/';
// <<< endereco-do-site
const LOTE = 20;
const LOTES = 3;
const PRAZO_MS = 20000;   // o cron espera 25 s pela resposta

async function rpc(fn: string, args: unknown): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...keyHeaders(SECRET_KEY), 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15000),
  });
  // o corpo do erro não vai para o log: pode trazer o que foi enviado
  if (!res.ok) throw new Error(`banco ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

let tokenOk = '';
async function authorized(req: Request): Promise<boolean> {
  if (hasKey(req.headers, SERVER_KEYS)) return true;
  const tok = req.headers.get('x-imed-token') ?? '';
  if (!/^[0-9a-f]{64}$/.test(tok)) return false;
  if (tok === tokenOk) return true;
  const ok = await rpc('check_internal_token', { p_name: 'agenda_saida', p_token: tok }).catch(() => false);
  if (ok === true) tokenOk = tok;
  return ok === true;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const done = (id: string, result: Resultado, providerId: string | null, error: string | null) =>
  rpc('agenda_notify_done', { p_id: id, p_result: result, p_provider_id: providerId, p_error: error });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  if (!await authorized(req)) return json({ ok: false, error: 'forbidden' }, 403);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  if (body?.action !== 'enviar') return json({ ok: false, error: 'invalid_action' }, 400);
  const inicio = Date.now();
  const canais = canaisDoAmbiente(env, fetch);
  const total: Contagem = { enviada: 0, falhou: 0, sem_canal: 0, sem_contato: 0, erro: 0 };
  let status = 'ok';
  try {
    for (let i = 0; i < LOTES && Date.now() - inicio < PRAZO_MS; i++) {
      const r = await rpc('agenda_notify_claim', { p_limit: LOTE }) as { status?: string; items?: unknown[] } | null;
      status = typeof r?.status === 'string' ? r.status : 'erro';
      const itens = status === 'ok' && Array.isArray(r?.items) ? r.items : [];
      if (!itens.length) break;
      const n = await processar(itens, canais, done, SITE_URL);
      for (const k of Object.keys(total) as (keyof Contagem)[]) total[k] += n[k];
      if (itens.length < LOTE) break;
    }
  } catch (err) {
    console.error('agenda-saida:', err instanceof Error ? err.message : 'erro');
    return json({ ok: false, error: 'falha', ...total }, 500);
  }
  return json({ ok: true, status, canais: Object.keys(canais), ...total });
});
