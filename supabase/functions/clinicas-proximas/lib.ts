// Lógica da função "clinicas-proximas". Não usa APIs do Deno, então também roda
// (e é testada) no Node. A função recebe o fetch por parâmetro.
//
// O servidor faz só o que precisa de chave ou de rede confiável: busca no Google Places,
// converte CEP, cidade ou endereço em coordenadas e consulta as clínicas do IMED no banco.
// A classificação dos estabelecimentos (tipo, exames, especialidades) é feita no site,
// do mesmo jeito para todas as fontes (assets/js/geo-core.js).

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export interface LatLng { lat: number; lng: number }

// Estabelecimento do Google Places no formato que o site entende.
export interface MapPlace {
  id: string;
  source: 'google';
  name: string;
  types: string[];
  hint: 'imagem' | null;
  address: string | null;
  lat: number;
  lng: number;
  distance_m: number;
  phone: string | null;
  website: string | null;
  maps_url: string | null;
  hours: string[] | null;
}

export interface GeoResult {
  lat: number;
  lng: number;
  label: string;
  precision: 'cep' | 'endereco' | 'bairro' | 'cidade' | 'estado';
  provider: 'google' | 'osm' | 'brasilapi';
}

export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const roundCoord = (v: number, digits = 4): number => Math.round(v * 10 ** digits) / 10 ** digits;
export const isValidCoord = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
export function clampRadius(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 5000;
  return Math.round(Math.min(20000, Math.max(500, n)));
}

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  businessStatus?: string;
}

const GOOGLE_FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.types',
  'places.nationalPhoneNumber', 'places.websiteUri', 'places.googleMapsUri',
  'places.regularOpeningHours.weekdayDescriptions', 'places.businessStatus',
].join(',');

export function parseGoogle(places: GooglePlace[], origin: LatLng, hint: MapPlace['hint']): MapPlace[] {
  const out: MapPlace[] = [];
  for (const p of places ?? []) {
    const name = p.displayName?.text?.trim() ?? '';
    const lat = p.location?.latitude, lng = p.location?.longitude;
    if (!name || typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
    const hours = p.regularOpeningHours?.weekdayDescriptions ?? [];
    out.push({
      id: `google:${p.id}`, source: 'google', name, types: p.types ?? [], hint,
      address: p.formattedAddress ?? null, lat, lng, distance_m: Math.round(haversine(origin, { lat, lng })),
      phone: p.nationalPhoneNumber ?? null, website: p.websiteUri ?? null, maps_url: p.googleMapsUri ?? null,
      hours: hours.length ? hours : null,
    });
  }
  return out;
}

// Duas consultas: estabelecimentos de saúde mais próximos e centros de diagnóstico por imagem.
// A chave vai só no cabeçalho, nunca na URL.
export async function searchGoogle(fetchFn: Fetch, apiKey: string, o: LatLng, radius: number): Promise<MapPlace[]> {
  const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': GOOGLE_FIELDS };
  const circle = { center: { latitude: o.lat, longitude: o.lng }, radius: Math.min(radius, 50000) };
  const call = async (url: string, body: unknown) => {
    const res = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`google places ${res.status}`);
    return ((await res.json()) as { places?: GooglePlace[] }).places ?? [];
  };
  const [nearby, imaging] = await Promise.all([
    call('https://places.googleapis.com/v1/places:searchNearby', {
      includedTypes: ['medical_lab', 'hospital', 'doctor'], maxResultCount: 20, rankPreference: 'DISTANCE',
      locationRestriction: { circle }, languageCode: 'pt-BR', regionCode: 'BR',
    }),
    call('https://places.googleapis.com/v1/places:searchText', {
      textQuery: 'clínica de diagnóstico por imagem', pageSize: 20,
      locationBias: { circle }, languageCode: 'pt-BR', regionCode: 'BR',
    }),
  ]);
  const byId = new Map<string, MapPlace>();
  for (const p of [...parseGoogle(imaging, o, 'imagem'), ...parseGoogle(nearby, o, null)]) {
    if (!byId.has(p.id) && p.distance_m <= radius * 1.05) byId.set(p.id, p);
  }
  return [...byId.values()].sort((a, b) => a.distance_m - b.distance_m);
}

const UF: Record<string, string> = {
  'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM', 'Bahia': 'BA', 'Ceará': 'CE', 'Distrito Federal': 'DF',
  'Espírito Santo': 'ES', 'Goiás': 'GO', 'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS',
  'Minas Gerais': 'MG', 'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR', 'Pernambuco': 'PE', 'Piauí': 'PI',
  'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', 'Roraima': 'RR',
  'Santa Catarina': 'SC', 'São Paulo': 'SP', 'Sergipe': 'SE', 'Tocantins': 'TO',
};

interface PhotonProps {
  name?: string; street?: string; housenumber?: string; district?: string; locality?: string;
  city?: string; county?: string; state?: string; countrycode?: string; type?: string; osm_value?: string;
}

function photonPrecision(p: PhotonProps): GeoResult['precision'] {
  if (p.osm_value === 'postcode') return 'cep';
  switch (p.type) {
    case 'district': case 'locality': return 'bairro';
    case 'city': case 'county': return 'cidade';
    case 'state': case 'country': return 'estado';
    default: return 'endereco';
  }
}

function photonLabel(p: PhotonProps): string {
  if (p.type === 'state') return p.name ?? p.state ?? '';
  const city = p.city ?? (p.type === 'city' || p.type === 'county' ? p.name : undefined);
  const street = [p.street, p.housenumber].filter(Boolean).join(', ');
  const parts = [p.name !== p.street && p.name !== city ? p.name : null, street || null, p.district ?? p.locality, city]
    .filter((s, i, all): s is string => !!s && all.indexOf(s) === i);
  const uf = p.state ? UF[p.state] ?? p.state : '';
  const label = parts.slice(0, 3).join(', ') || p.name || '';
  return uf && uf !== label ? `${label} - ${uf}` : label;
}

function precisionFromGoogle(types: string[] = []): GeoResult['precision'] {
  if (types.includes('postal_code')) return 'cep';
  if (types.some((t) => ['street_address', 'premise', 'route', 'subpremise', 'establishment'].includes(t))) return 'endereco';
  if (types.some((t) => t.startsWith('sublocality') || t === 'neighborhood')) return 'bairro';
  if (types.some((t) => ['locality', 'administrative_area_level_2'].includes(t))) return 'cidade';
  if (types.includes('administrative_area_level_1')) return 'estado';
  return 'endereco';
}

// Texto livre (cidade, bairro ou endereço) para coordenadas: Google Geocoding quando há chave,
// senão Photon, geocodificador público baseado no OpenStreetMap, restrito ao Brasil.
async function geocodeText(fetchFn: Fetch, q: string, googleKey: string, userAgent: string): Promise<GeoResult | null> {
  if (googleKey) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&components=country:BR&language=pt-BR&region=br&key=${encodeURIComponent(googleKey)}`;
    const res = await fetchFn(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`google geocode ${res.status}`);
    const j = await res.json() as { status: string; results?: { formatted_address: string; types: string[]; geometry: { location: { lat: number; lng: number } } }[] };
    if (j.status === 'ZERO_RESULTS' || (j.status === 'OK' && !j.results?.length)) return null;
    if (j.status !== 'OK' || !j.results) throw new Error(`google geocode ${j.status}`);
    const r = j.results[0];
    return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, label: r.formatted_address.replace(/, (Brasil|Brazil)$/, ''), precision: precisionFromGoogle(r.types), provider: 'google' };
  }
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&bbox=-74.1,-33.9,-34.7,5.4`;
  const res = await fetchFn(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const j = await res.json() as { features?: { geometry?: { coordinates?: [number, number] }; properties?: PhotonProps }[] };
  const f = (j.features ?? []).find((x) => x.properties?.countrycode === 'BR' && Array.isArray(x.geometry?.coordinates));
  if (!f?.properties || !f.geometry?.coordinates) return null;
  const [lng, lat] = f.geometry.coordinates;
  if (!isValidCoord(lat, lng)) return null;
  return { lat, lng, label: photonLabel(f.properties), precision: photonPrecision(f.properties), provider: 'osm' };
}

export const isCep = (q: string): boolean => /^\s*\d{5}-?\d{3}\s*$/.test(q);

interface CepInfo { street: string | null; district: string | null; city: string; uf: string; lat: number | null; lng: number | null }

// Endereço de um CEP pelo ViaCEP (base dos Correios). A BrasilAPI só entra se o ViaCEP
// estiver fora do ar: para CEPs inexistentes ela às vezes devolve endereços de outro lugar.
async function lookupCep(fetchFn: Fetch, cep: string): Promise<CepInfo | null> {
  try {
    const res = await fetchFn(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(6000) });
    if (res.status === 400) return null;
    if (res.ok) {
      const v = await res.json() as { erro?: unknown; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (v.erro) return null;
      if (v.localidade && v.uf) {
        return { street: v.logradouro || null, district: v.bairro || null, city: v.localidade, uf: v.uf, lat: null, lng: null };
      }
    }
  } catch {
    // ViaCEP fora do ar: segue para a BrasilAPI.
  }
  const res = await fetchFn(`https://brasilapi.com.br/api/cep/v2/${cep}`, { signal: AbortSignal.timeout(6000) });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`cep ${res.status}`);
  const b = await res.json() as { street?: string; neighborhood?: string; city?: string; state?: string; location?: { coordinates?: { latitude?: string; longitude?: string } } };
  if (!b.city || !b.state) return null;
  const lat = Number(b.location?.coordinates?.latitude), lng = Number(b.location?.coordinates?.longitude);
  const hasCoords = isValidCoord(lat, lng) && lat !== 0 && lng !== 0;
  return { street: b.street || null, district: b.neighborhood || null, city: b.city, uf: b.state, lat: hasCoords ? lat : null, lng: hasCoords ? lng : null };
}

export async function geocode(fetchFn: Fetch, q: string, googleKey: string, userAgent: string): Promise<GeoResult | null> {
  if (!isCep(q)) return geocodeText(fetchFn, q, googleKey, userAgent);
  const info = await lookupCep(fetchFn, q.replace(/\D/g, ''));
  if (!info) return null;
  const city = `${info.city} - ${info.uf}`;
  const streetLabel = [info.street, info.district, city].filter(Boolean).join(', ');
  if (info.lat !== null && info.lng !== null) {
    return { lat: info.lat, lng: info.lng, label: streetLabel, precision: 'cep', provider: 'brasilapi' };
  }
  // Da rua para a cidade. Cada tentativa só vale se o resultado for tão preciso quanto ela,
  // para não mostrar o centro da cidade com o nome da rua.
  const attempts: { q: string; label: string; precision: GeoResult['precision']; accept: GeoResult['precision'][] }[] = [];
  if (info.street) {
    attempts.push({ q: `${info.street}, ${info.district ? info.district + ', ' : ''}${info.city}, ${info.uf}`, label: streetLabel, precision: 'cep', accept: ['cep', 'endereco'] });
  }
  if (info.district) {
    attempts.push({ q: `${info.district}, ${info.city}, ${info.uf}`, label: `${info.district}, ${city}`, precision: 'bairro', accept: ['cep', 'endereco', 'bairro'] });
  }
  attempts.push({ q: `${info.city}, ${info.uf}`, label: city, precision: 'cidade', accept: ['cep', 'endereco', 'bairro', 'cidade'] });
  for (const a of attempts) {
    const g = await geocodeText(fetchFn, a.q, googleKey, userAgent);
    if (g && a.accept.includes(g.precision)) return { ...g, label: a.label, precision: a.precision };
  }
  return null;
}

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

// Quem pode chamar a busca (a função é publicada com verify_jwt=false e confere no código): quem traz no "apikey" uma
// chave publishable do projeto, ou a anon antiga (site antigo ainda guardado no aparelho).
// callerKeys devolve as chaves aceitas, ou null quando o ambiente não tem nenhuma chave publishable nova
// (SUPABASE_PUBLISHABLE_KEYS ou SUPABASE_PUBLISHABLE_KEY): sem ela não dá para reconhecer a chave do site, e a função
// não barra ninguém (a chave é pública de qualquer jeito; a origem permitida no navegador, o limite por IP e a
// validação dos dados continuam valendo).
export function callerKeys(env: EnvGet): string[] | null {
  if (!Object.keys(newKeys(env, PUBLISHABLE_VARS)).length) return null;
  return acceptedKeys(env, PUBLISHABLE_VARS);
}
export function callerAllowed(headers: { get(name: string): string | null }, keys: string[] | null): boolean {
  return !keys || !keys.length || hasKey(headers, keys);
}

/* ---------------- travas de quem chama (origem e limite por IP) ---------------- */
// Origem: no navegador (cabeçalho Origin) só os sites de ALLOWED_ORIGINS; outro site recebe 403. Sem Origin (curl,
// servidor, aplicativo) a origem não é conferida: passa quem tiver a chave publishable (pública), com o limite por IP.
export const originAllowed = (origin: string | null, allowed: string[]): boolean => !origin || allowed.includes(origin);
// Origens aceitas quando o segredo ALLOWED_ORIGINS não existe: o site atual, os endereços anteriores dele (durante a
// troca de endereço, o site antigo continua funcionando) e o computador de quem desenvolve. Endereço → origem
// (https://conta.github.io/REPO/ → https://conta.github.io), sem repetir.
export const LOCAL_ORIGINS = ['http://localhost:8765', 'http://127.0.0.1:8765'];
export function defaultOrigins(site: string, previous: string[] = []): string[] {
  const out: string[] = [];
  for (const u of [site, ...previous]) {
    try { const o = new URL(u).origin; if (!out.includes(o)) out.push(o); } catch { /* endereço inválido: fica de fora */ }
  }
  return [...out, ...LOCAL_ORIGINS];
}

// IP de quem chama, para o limite: o primeiro item de X-Forwarded-For (quem chama pode mandar esse cabeçalho; se o
// gateway do Supabase só acrescentar o IP de verdade no fim, o primeiro item pode ser forjado: pendência medida à
// parte, porque a contagem é por instância).
export const clientIp = (headers: { get(name: string): string | null }): string =>
  (headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'desconhecido';

// Limite por IP: até `max` chamadas por janela de `windowMs` em cada instância da função (a contagem fica na memória
// da instância: outra instância conta do zero). true = passou do limite (a função responde 429).
export function rateLimited(hits: Map<string, { n: number; reset: number }>, ip: string, now: number, max = 40, windowMs = 60_000): boolean {
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { n: 1, reset: now + windowMs });
    return false;
  }
  h.n += 1;
  return h.n > max;
}

// Resposta do importador ao "ping" (status com "importador": true), sem nenhuma chave: "ok" (aceitou a chave secreta
// da busca), "antigo" (aceitou, mas é a versão sem "ping"), "recusou" (401/403: não aceitou a chave), "erro".
export type ImporterAnswer = 'ok' | 'antigo' | 'recusou' | 'erro';
export function importerAnswer(status: number, body: unknown): ImporterAnswer {
  const b = (body && typeof body === 'object' ? body : {}) as { ok?: unknown; error?: unknown };
  if (status === 200 && b.ok === true) return 'ok';
  if (status === 400 && b.error === 'unknown_action') return 'antigo';
  if (status === 401 || status === 403) return 'recusou';
  return 'erro';
}
