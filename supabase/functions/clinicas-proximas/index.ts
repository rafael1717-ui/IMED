// Edge Function "clinicas-proximas": busca clínicas, laboratórios e centros de diagnóstico
// perto de um ponto e converte CEP, cidade ou endereço em coordenadas.
//
// PUBLICAR SEMPRE COM verify_jwt=false (a conferência automática de token do Supabase desligada):
//   supabase functions deploy clinicas-proximas --no-verify-jwt --project-ref pyoqiecupxhdzigjudyd
// O site chama esta função só com a chave publishable no cabeçalho "apikey" (sem "Authorization"). A chave nova não
// é um token (JWT), e a conferência automática do Supabase (verify_jwt) só entende tokens: a documentação manda
// desligá-la e conferir no código. A função não depende do token de quem chama para nada; quem pode chamar é
// conferido aqui (travas em lib.ts, com testes):
//   - origem (originAllowed): no navegador, só os sites de ALLOWED_ORIGINS (outro site recebe 403). Fora do
//     navegador (sem cabeçalho Origin: curl, servidor) a origem não é conferida: entra quem tiver a chave pública;
//   - chave (callerAllowed): o "apikey" precisa ser uma chave publishable do projeto (ou a anon antiga, do site
//     antigo ainda em cache), senão 401 (só quando o ambiente tem a chave publishable nova, como deve ser);
//   - limite (rateLimited): 40 chamadas por minuto por IP em cada instância; e os dados da busca são validados
//     (coordenadas, raio, texto).
// O banco é consultado com a chave publishable da PRÓPRIA função (como visitante, sujeito às regras do banco),
// e o importador com a chave secreta (SUPABASE_SECRET_KEYS), que nunca sai do servidor.
//
// Ações (POST, JSON):
//   search   { lat, lng, radius_m, include_demo }  ordenados por distância:
//            - clínicas parceiras do IMED (banco);
//            - estabelecimentos reais do CNES já importados para o banco (cadastro oficial do
//              Ministério da Saúde), com a situação da cidade em "coverage". Se a cidade ainda não
//              foi importada, a função importar-clinicas começa a importação em segundo plano;
//            - com a chave do Google, os estabelecimentos do Google Places.
//            Enquanto a cidade não está no banco, o site completa a lista com o OpenStreetMap.
//   geocode  { q }  CEP (ViaCEP/BrasilAPI), cidade ou endereço (Google Geocoding ou Photon) para coordenadas.
//   status   informa qual serviço de mapas está ativo e se as chaves do Supabase em uso são as novas
//            (chaves: { publishable, secreta } = "nova" | "antiga" | "ausente"; nunca a chave em si).
//            Com { importador: true }, pergunta também ao importador se ele aceita a chave secreta desta função
//            (ação "ping", sem trabalho nenhum; resposta guardada por 30 s): importador: { http, resposta }.
//
// Variáveis de ambiente (segredos da função, nunca vão para o navegador):
//   GOOGLE_MAPS_API_KEY  chave do Google Maps Platform (Places API New + Geocoding API). Opcional.
//   ALLOWED_ORIGINS      sites que podem chamar a função, separados por vírgula. Opcional: sem ele, valem o endereço
//                        do site (SITE_URL), os anteriores (SITE_ANTERIORES) e o computador de quem desenvolve.
//   NOMINATIM_CONTACT    e-mail de contato enviado aos serviços do OpenStreetMap no User-Agent.
// SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS e SUPABASE_SECRET_KEYS (e as antigas SUPABASE_ANON_KEY e
// SUPABASE_SERVICE_ROLE_KEY, usadas só se as novas faltarem) são preenchidas automaticamente pelo Supabase
// (leitura em lib.ts: publishableKey, secretKey). A chave secreta só é usada aqui dentro, para chamar o importador.
//
// Privacidade: as coordenadas recebidas são arredondadas (~11 m), usadas só para a
// busca e nunca são gravadas nem enviadas aos logs.

import {
  callerAllowed, callerKeys, clampRadius, clientIp, defaultOrigins, geocode, importerAnswer, isValidCoord, keyHeaders, keyKind, originAllowed,
  publishableKey, rateLimited, roundCoord, searchGoogle, secretKey, type GeoResult, type ImporterAnswer, type MapPlace,
} from './lib.ts';

const env = (name: string) => Deno.env.get(name);
const GOOGLE_KEY = env('GOOGLE_MAPS_API_KEY') ?? '';
const SUPABASE_URL = env('SUPABASE_URL') ?? '';
// Chave publishable da função (nova; sem ela, a anon antiga): consulta o banco como visitante.
const PUBLIC_KEY = publishableKey(env);
// Chave secreta (nova; sem ela, a service_role antiga): só para chamar o importador.
const SECRET_KEY = secretKey(env);
// Chaves aceitas de quem chama a busca: as publishable do projeto e a anon antiga, enquanto existir (null: o ambiente
// não tem a chave publishable nova, SUPABASE_PUBLISHABLE_KEYS, e a chave de quem chama não é conferida).
const CALLER_KEYS = callerKeys(env);
if (!CALLER_KEYS) console.error('sem a chave publishable nova no ambiente: a chave de quem chama não está sendo conferida');
// >>> endereco-do-site (bloco mantido por scripts/trocar-endereco.mjs; não edite à mão, rode o script)
// SITE_URL: endereço público do site. SITE_ANTERIORES: endereços que o site já teve e que continuam aceitos como
// origem enquanto o site antigo existir (para tirar um: node scripts/trocar-endereco.mjs --esquecer=<endereço>).
const SITE_URL = 'https://rafael1717-ui.github.io/IMED/';
const SITE_ANTERIORES: string[] = ['https://drrafaelpereirabarreto-code.github.io/testedoapp/'];
// <<< endereco-do-site
// Sem o segredo ALLOWED_ORIGINS, valem o site atual, os anteriores e o computador de quem desenvolve (defaultOrigins).
// Com o segredo, vale só o que estiver nele: ao trocar o endereço do site, troque o segredo também (ou apague-o).
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? defaultOrigins(SITE_URL, SITE_ANTERIORES).join(','))
  .split(',').map((s) => s.trim()).filter(Boolean);
const CONTACT = Deno.env.get('NOMINATIM_CONTACT') ?? 'contato@imed.com.br';
const USER_AGENT = `IMED/1.0 (+${SITE_URL}; ${CONTACT})`;
const PROVIDER = GOOGLE_KEY ? 'google' : 'osm';

const cache = new Map<string, { exp: number; value: unknown }>();
const hits = new Map<string, { n: number; reset: number }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.value as T;
  const value = await load();
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  cache.set(key, { exp: now + ttlMs, value });
  return value;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

// Funções do banco (PostGIS) chamadas com a chave publishable da função, como visitante (nunca com o que veio de
// quem chamou). Devolvem já ordenado por distância.
async function rpcCall(fn: string, params: Record<string, unknown>): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...keyHeaders(PUBLIC_KEY), 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`banco ${res.status}`);
  return await res.json() as unknown[];
}

interface CityStatus { ibge: number; city: string; uf: string; status: string }
interface Coverage { status: 'done' | 'loading' | 'unavailable'; city: string | null; uf: string | null }

// Pergunta ao importador a situação da cidade de cada ponto; ele começa a importação se precisar.
// Chave secreta só no "apikey" (a service_role antiga, se for ela, vai também em Bearer, como antes).
async function askImporter(pontos: { lat: number; lng: number }[], ms: number): Promise<(CityStatus | null)[]> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/importar-clinicas`, {
    method: 'POST',
    headers: { ...keyHeaders(SECRET_KEY), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'garantir', pontos }),
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`importador ${res.status}`);
  return ((await res.json()) as { cidades?: (CityStatus | null)[] }).cidades ?? [];
}

// O importador aceita a chave secreta desta função? (status com "importador": true; ação "ping", sem trabalho.)
// Guarda a resposta por 30 s nesta instância, para o "status" não virar uma chamada extra a cada pedido.
interface ImporterCheck { http: number | null; resposta: ImporterAnswer | 'sem_resposta' | 'sem_chave' }
let importerCheck: { exp: number; value: ImporterCheck } | null = null;
async function checkImporter(): Promise<ImporterCheck> {
  if (importerCheck && importerCheck.exp > Date.now()) return importerCheck.value;
  let value: ImporterCheck = { http: null, resposta: 'sem_chave' };
  if (SECRET_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/importar-clinicas`, {
        method: 'POST',
        headers: { ...keyHeaders(SECRET_KEY), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ping' }),
        signal: AbortSignal.timeout(10000),
      });
      value = { http: res.status, resposta: importerAnswer(res.status, await res.json().catch(() => null)) };
    } catch {
      value = { http: null, resposta: 'sem_resposta' };
    }
  }
  importerCheck = { exp: Date.now() + 30_000, value };
  return value;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('tempo esgotado')), ms))]);

// Situação da cidade da busca no cadastro de estabelecimentos reais (CNES). A busca espera no
// máximo 3,5 s pela resposta; se o importador demorar, ele termina o trabalho em segundo plano.
// As cidades vizinhas dentro do raio só começam a ser importadas, sem a busca esperar por elas.
const coverageCache = new Map<string, { exp: number; value: Coverage }>();
async function coverage(origin: { lat: number; lng: number }, radius: number): Promise<Coverage> {
  const key = `${origin.lat.toFixed(2)},${origin.lng.toFixed(2)}`;
  const hit = coverageCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  let value: Coverage = { status: 'unavailable', city: null, uf: null };
  const ask = askImporter([origin], 25000);
  ask.catch(() => {});
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(ask.catch(() => {}));
  try {
    const [c] = await withTimeout(ask, 3500);
    if (c) value = { status: c.status === 'done' ? 'done' : c.status === 'error' ? 'unavailable' : 'loading', city: c.city, uf: c.uf };
  } catch (err) {
    console.error('importador não respondeu a tempo:', String(err));
  }
  if (radius >= 3000 && typeof EdgeRuntime !== 'undefined') {
    const d = Math.min(radius * 0.7, 15000) / 111320;
    const dLng = d / Math.cos((origin.lat * Math.PI) / 180);
    const vizinhos = [
      { lat: origin.lat + d, lng: origin.lng }, { lat: origin.lat - d, lng: origin.lng },
      { lat: origin.lat, lng: origin.lng + dLng }, { lat: origin.lat, lng: origin.lng - dLng },
    ].map((p) => ({ lat: roundCoord(p.lat, 3), lng: roundCoord(p.lng, 3) }));
    EdgeRuntime.waitUntil(askImporter(vizinhos, 25000).catch(() => {}));
  }
  if (coverageCache.size > 500) coverageCache.clear();
  coverageCache.set(key, { exp: Date.now() + (value.status === 'done' ? 10 * 60_000 : value.status === 'loading' ? 30_000 : 15_000), value });
  return value;
}

async function handleSearch(body: Record<string, unknown>, h: Record<string, string>) {
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!isValidCoord(lat, lng)) return json({ ok: false, error: 'invalid_coordinates' }, 400, h);
  const radius = clampRadius(body.radius_m);
  const origin = { lat: roundCoord(lat, 4), lng: roundCoord(lng, 4) };
  const includeDemo = body.include_demo === true;
  const noCoverage: Coverage = { status: 'unavailable', city: null, uf: null };

  const [imedRes, cnesRes, placesRes, covRes] = await Promise.allSettled([
    rpcCall('nearby_clinics', { p_lat: origin.lat, p_lng: origin.lng, p_radius_m: radius, p_include_demo: includeDemo, p_limit: 100 }),
    rpcCall('nearby_establishments', { p_lat: origin.lat, p_lng: origin.lng, p_radius_m: radius, p_limit: 250 }),
    GOOGLE_KEY
      ? cached(`google:${origin.lat.toFixed(3)}:${origin.lng.toFixed(3)}:${radius}`, 10 * 60_000, () => searchGoogle(fetch, GOOGLE_KEY, origin, radius))
      : Promise.resolve([] as MapPlace[]),
    SECRET_KEY ? coverage(origin, radius) : Promise.resolve(noCoverage),
  ]);

  const warnings: string[] = [];
  if (imedRes.status === 'rejected') { warnings.push('imed_unavailable'); console.error('busca IMED falhou:', String(imedRes.reason)); }
  if (cnesRes.status === 'rejected') { warnings.push('cnes_unavailable'); console.error('busca CNES falhou:', String(cnesRes.reason)); }
  if (placesRes.status === 'rejected') { warnings.push('places_unavailable'); console.error('busca no Google falhou:', String(placesRes.reason)); }
  if (imedRes.status === 'rejected' && cnesRes.status === 'rejected' && (placesRes.status === 'rejected' || !GOOGLE_KEY)) {
    return json({ ok: false, error: 'unavailable', warnings }, 502, h);
  }
  const cnes = cnesRes.status === 'fulfilled' ? cnesRes.value : [];
  let cov = covRes.status === 'fulfilled' ? covRes.value : noCoverage;
  // Sem resposta do importador, mas o banco já tem estabelecimentos aqui: a cidade já foi importada.
  if (cov.status === 'unavailable' && cnes.length) cov = { ...cov, status: 'done' };
  return json({
    ok: true, provider: PROVIDER, radius_m: radius, warnings,
    imed: imedRes.status === 'fulfilled' ? imedRes.value : [],
    cnes,
    places: placesRes.status === 'fulfilled' ? placesRes.value.slice(0, 120) : [],
    coverage: cov,
  }, 200, h);
}

async function handleGeocode(body: Record<string, unknown>, h: Record<string, string>) {
  const q = String(body.q ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (q.length < 3) return json({ ok: false, error: 'query_too_short' }, 400, h);
  let result: GeoResult | null;
  try {
    result = await cached(`geo:${PROVIDER}:${q.toLowerCase()}`, 60 * 60_000, () => geocode(fetch, q, GOOGLE_KEY, USER_AGENT));
  } catch (err) {
    console.error('geocodificação falhou:', String(err));
    return json({ ok: false, error: 'geocoder_unavailable' }, 502, h);
  }
  if (!result) return json({ ok: false, error: 'not_found' }, 404, h);
  return json({ ok: true, ...result }, 200, h);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const h = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (!originAllowed(origin, ALLOWED_ORIGINS)) return json({ ok: false, error: 'origin_not_allowed' }, 403, h);
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, h);

  if (rateLimited(hits, clientIp(req.headers), Date.now())) return json({ ok: false, error: 'rate_limited' }, 429, { ...h, 'Retry-After': '60' });
  // Publicada com verify_jwt=false: a chave de quem chama é conferida aqui (veja o começo do arquivo).
  if (!callerAllowed(req.headers, CALLER_KEYS)) return json({ ok: false, error: 'unauthorized' }, 401, h);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400, h);
  }

  try {
    if (body?.action === 'search') return await handleSearch(body, h);
    if (body?.action === 'geocode') return await handleGeocode(body, h);
    if (body?.action === 'status') {
      return json({
        ok: true, provider: PROVIDER, chaves: { publishable: keyKind(PUBLIC_KEY), secreta: keyKind(SECRET_KEY) },
        ...(body.importador === true ? { importador: await checkImporter() } : {}),
      }, 200, h);
    }
    return json({ ok: false, error: 'unknown_action' }, 400, h);
  } catch (err) {
    console.error('erro inesperado:', err instanceof Error ? err.message : 'desconhecido');
    return json({ ok: false, error: 'internal' }, 500, h);
  }
});
