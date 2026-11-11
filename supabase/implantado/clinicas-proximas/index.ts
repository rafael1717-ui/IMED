// Edge Function "clinicas-proximas": busca clínicas, laboratórios e centros de diagnóstico
// perto de um ponto e converte CEP, cidade ou endereço em coordenadas.
//
// CÓPIA DO QUE ESTÁ NO AR (supabase/implantado/): versão 8, publicada em 11/11/2026 com verify_jwt=true, igual à
// versão 7 de 31/10 mais as origens do site novo (bloco endereco-do-site). A versão nova, com as chaves novas
// (fase 0.1), está em supabase/functions/clinicas-proximas/ e ainda NÃO foi publicada.
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
//   status   informa qual serviço de mapas está ativo.
//
// Variáveis de ambiente (segredos da função, nunca vão para o navegador):
//   GOOGLE_MAPS_API_KEY  chave do Google Maps Platform (Places API New + Geocoding API). Opcional.
//   ALLOWED_ORIGINS      sites que podem chamar a função, separados por vírgula.
//   NOMINATIM_CONTACT    e-mail de contato enviado aos serviços do OpenStreetMap no User-Agent.
// SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY são preenchidas automaticamente pelo
// Supabase. A chave de serviço só é usada aqui dentro, para chamar o importador.
//
// Privacidade: as coordenadas recebidas são arredondadas (~11 m), usadas só para a
// busca e nunca são gravadas nem enviadas aos logs.

import { clampRadius, geocode, isValidCoord, roundCoord, searchGoogle, type GeoResult, type MapPlace } from './lib.ts';

const GOOGLE_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// >>> endereco-do-site (bloco mantido por scripts/trocar-endereco.mjs; não edite à mão, rode o script)
// SITE_URL: endereço público do site. SITE_ANTERIORES: endereços que o site já teve e que continuam aceitos como
// origem enquanto o site antigo existir (para tirar um: node scripts/trocar-endereco.mjs --esquecer=<endereço>).
const SITE_URL = 'https://rafael1717-ui.github.io/IMED/';
const SITE_ANTERIORES: string[] = ['https://drrafaelpereirabarreto-code.github.io/testedoapp/'];
// <<< endereco-do-site
// Origens aceitas: as do segredo ALLOWED_ORIGINS (sem ele, o computador de quem desenvolve) e SEMPRE as do site
// (SITE_URL e SITE_ANTERIORES), para a troca de endereço não depender de trocar o segredo.
const ALLOWED_ORIGINS = [...new Set([
  ...(Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:8765,http://127.0.0.1:8765').split(','),
  ...[SITE_URL, ...SITE_ANTERIORES].map((u) => new URL(u).origin),
].map((s) => s.trim()).filter(Boolean))];
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

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { n: 1, reset: now + 60_000 });
    return false;
  }
  h.n += 1;
  return h.n > 40;
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

// Funções do banco (PostGIS) chamadas com a chave de quem fez a busca. Devolvem já ordenado por distância.
async function rpcCall(fn: string, auth: string, apikey: string, params: Record<string, unknown>): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey, Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`banco ${res.status}`);
  return await res.json() as unknown[];
}

interface CityStatus { ibge: number; city: string; uf: string; status: string }
interface Coverage { status: 'done' | 'loading' | 'unavailable'; city: string | null; uf: string | null }

// Pergunta ao importador a situação da cidade de cada ponto; ele começa a importação se precisar.
async function askImporter(pontos: { lat: number; lng: number }[], ms: number): Promise<(CityStatus | null)[]> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/importar-clinicas`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'garantir', pontos }),
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`importador ${res.status}`);
  return ((await res.json()) as { cidades?: (CityStatus | null)[] }).cidades ?? [];
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

async function handleSearch(body: Record<string, unknown>, auth: string, apikey: string, h: Record<string, string>) {
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!isValidCoord(lat, lng)) return json({ ok: false, error: 'invalid_coordinates' }, 400, h);
  const radius = clampRadius(body.radius_m);
  const origin = { lat: roundCoord(lat, 4), lng: roundCoord(lng, 4) };
  const includeDemo = body.include_demo === true;
  const noCoverage: Coverage = { status: 'unavailable', city: null, uf: null };

  const [imedRes, cnesRes, placesRes, covRes] = await Promise.allSettled([
    rpcCall('nearby_clinics', auth, apikey, { p_lat: origin.lat, p_lng: origin.lng, p_radius_m: radius, p_include_demo: includeDemo, p_limit: 100 }),
    rpcCall('nearby_establishments', auth, apikey, { p_lat: origin.lat, p_lng: origin.lng, p_radius_m: radius, p_limit: 250 }),
    GOOGLE_KEY
      ? cached(`google:${origin.lat.toFixed(3)}:${origin.lng.toFixed(3)}:${radius}`, 10 * 60_000, () => searchGoogle(fetch, GOOGLE_KEY, origin, radius))
      : Promise.resolve([] as MapPlace[]),
    SERVICE_KEY ? coverage(origin, radius) : Promise.resolve(noCoverage),
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
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: 'origin_not_allowed' }, 403, h);
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, h);

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'desconhecido';
  if (rateLimited(ip)) return json({ ok: false, error: 'rate_limited' }, 429, { ...h, 'Retry-After': '60' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400, h);
  }
  const apikey = req.headers.get('apikey') ?? ANON_KEY;
  const auth = req.headers.get('authorization') ?? `Bearer ${ANON_KEY}`;

  try {
    if (body?.action === 'search') return await handleSearch(body, auth, apikey, h);
    if (body?.action === 'geocode') return await handleGeocode(body, h);
    if (body?.action === 'status') return json({ ok: true, provider: PROVIDER }, 200, h);
    return json({ ok: false, error: 'unknown_action' }, 400, h);
  } catch (err) {
    console.error('erro inesperado:', err instanceof Error ? err.message : 'desconhecido');
    return json({ ok: false, error: 'internal' }, 500, h);
  }
});
