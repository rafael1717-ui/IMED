// Chaves do Supabase para as funções do pagamento (pagamento-criar, pagamento-webhook e pagamento-rotina): o MESMO bloco
// de clinicas-proximas/lib.ts e importar-clinicas/lib.ts, copiado sem mudar uma letra (tests/chaves.test.mjs confere
// que os três são iguais). Não usa APIs do Deno: roda (e é testado) também no Node.

/* ===== Chaves do Supabase: início (bloco igual em clinicas-proximas/lib.ts e importar-clinicas/lib.ts) ===== */
// O Supabase põe as chaves do projeto nas variáveis de ambiente de toda Edge Function:
// - novas: SUPABASE_PUBLISHABLE_KEYS e SUPABASE_SECRET_KEYS, um JSON com as chaves por nome
//   ({"default":"sb_publishable_..."}). Vão SÓ no cabeçalho "apikey": não são tokens (JWT), e a documentação do
//   Supabase manda nunca pô-las em "Authorization: Bearer" (onde o Supabase espera um token, como nas funções com
//   verify_jwt, ele tenta ler a chave como token e recusa: "Invalid JWT").
// - nova sem JSON: SUPABASE_PUBLISHABLE_KEY e SUPABASE_SECRET_KEY (uma chave só), o formato que a documentação cita
//   para o desenvolvimento local. Vale como a "default" quando o JSON falta.
// - antigas (tokens JWT, que param de funcionar no fim de 2026): SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.
//   Só são usadas se a nova faltar, e vão como sempre foram (apikey e Authorization: Bearer).
// Nada aqui usa APIs do Deno: quem chama passa a leitura do ambiente (env), e os testes rodam no Node.
export type EnvGet = (name: string) => string | undefined;
export interface ProjectKey { key: string; legacy: boolean }
export const PUBLISHABLE_VARS = { novas: 'SUPABASE_PUBLISHABLE_KEYS', uma: 'SUPABASE_PUBLISHABLE_KEY', antiga: 'SUPABASE_ANON_KEY' } as const;
export const SECRET_VARS = { novas: 'SUPABASE_SECRET_KEYS', uma: 'SUPABASE_SECRET_KEY', antiga: 'SUPABASE_SERVICE_ROLE_KEY' } as const;
type KeyVars = typeof PUBLISHABLE_VARS | typeof SECRET_VARS;

// Chaves de um JSON por nome. Faltando, vazio, quebrado ou fora do formato: nenhuma (nunca derruba a função).
export function namedKeys(raw: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== 'string' || !raw.trim()) return out;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return out; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [name, key] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof key === 'string' && key.trim()) out[name] = key.trim();
  }
  return out;
}

// As chaves novas do ambiente, por nome: o JSON ou, sem ele, a chave única (como "default").
export function newKeys(env: EnvGet, vars: KeyVars): Record<string, string> {
  const list = namedKeys(env(vars.novas));
  if (Object.keys(list).length) return list;
  const uma = (env(vars.uma) ?? '').trim();
  return uma ? { default: uma } : {};
}

// A chave nova de nome `name` ("default"; sem ela, a primeira da lista) ou, sem nenhuma nova, a antiga.
function pickKey(env: EnvGet, vars: KeyVars, name: string): ProjectKey | null {
  const list = newKeys(env, vars);
  const nova = list[name] ?? Object.values(list)[0];
  if (nova) return { key: nova, legacy: false };
  const antiga = (env(vars.antiga) ?? '').trim();
  return antiga ? { key: antiga, legacy: true } : null;
}
// Chave publishable: consulta o banco como visitante (o papel "anon"), sujeita às regras (RLS).
export const publishableKey = (env: EnvGet, name = 'default'): ProjectKey | null => pickKey(env, PUBLISHABLE_VARS, name);
// Chave secreta: acesso total ao banco. Só para chamadas do próprio servidor; nunca vai para resposta ou log.
export const secretKey = (env: EnvGet, name = 'default'): ProjectKey | null => pickKey(env, SECRET_VARS, name);

// Qual chave está em uso, sem mostrar a chave: "nova", "antiga" ou "ausente" (para a conferência depois do deploy).
export const keyKind = (k: ProjectKey | null): 'nova' | 'antiga' | 'ausente' => (k ? (k.legacy ? 'antiga' : 'nova') : 'ausente');

// Cabeçalhos para chamar a API do Supabase (banco ou outra função) com uma chave do servidor: a nova só em "apikey";
// a antiga (JWT) em "apikey" e em "Authorization: Bearer", como sempre foi. Uma chave "sb_" nunca vai em Bearer.
export function keyHeaders(k: ProjectKey | null): Record<string, string> {
  if (!k) return {};
  return k.legacy && !k.key.startsWith('sb_') ? { apikey: k.key, Authorization: `Bearer ${k.key}` } : { apikey: k.key };
}

// Todas as chaves aceitas de quem chama (função publicada com verify_jwt=false confere no código): as novas, de
// qualquer nome, e a antiga enquanto existir.
export function acceptedKeys(env: EnvGet, vars: KeyVars): string[] {
  const out = Object.values(newKeys(env, vars));
  const antiga = (env(vars.antiga) ?? '').trim();
  if (antiga) out.push(antiga);
  return [...new Set(out)];
}

// Comparação que leva o mesmo tempo acertando ou errando cada letra (não entrega a chave aos poucos).
export function sameKey(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

// A chamada traz uma destas chaves? No "apikey" vale qualquer uma; em "Authorization: Bearer", só as antigas (JWT),
// como mandam os chamadores antigos.
export function hasKey(headers: { get(name: string): string | null }, keys: string[]): boolean {
  const apikey = headers.get('apikey') ?? '';
  const bearer = (headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return keys.some((k) => sameKey(apikey, k) || (!k.startsWith('sb_') && sameKey(bearer, k)));
}
/* ===== Chaves do Supabase: fim ===== */
