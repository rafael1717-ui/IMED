// Testes da função de busca. Rodar com: node --experimental-strip-types --test supabase/functions/clinicas-proximas/lib.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptedKeys, callerAllowed, callerKeys, clampRadius, clientIp, defaultOrigins, geocode, hasKey, haversine, importerAnswer, isCep, isValidCoord, keyHeaders,
  keyKind, LOCAL_ORIGINS, namedKeys, newKeys, originAllowed, parseGoogle, PUBLISHABLE_VARS, publishableKey, rateLimited, roundCoord, sameKey, searchGoogle,
  SECRET_VARS, secretKey, type Fetch,
} from './lib.ts';

const PAULISTA = { lat: -23.565, lng: -46.652 };
const UA = 'IMED-test';
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const photon = (props: Record<string, string>, lng: number, lat: number) =>
  ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { countrycode: 'BR', ...props }, geometry: { type: 'Point', coordinates: [lng, lat] } }] });

test('busca no Google Places com a chave só no cabeçalho do servidor', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fake: Fetch = async (url, init) => {
    calls.push({ url, init });
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers['X-Goog-Api-Key'], 'CHAVE');
    assert.match(headers['X-Goog-FieldMask'], /places\.nationalPhoneNumber/);
    if (url.endsWith(':searchText')) {
      return reply({ places: [
        { id: 'a', displayName: { text: 'Lumen Diagnóstico' }, location: { latitude: -23.566, longitude: -46.653 }, types: ['doctor'], businessStatus: 'OPERATIONAL', regularOpeningHours: { weekdayDescriptions: ['segunda-feira: 07:00–19:00'] } },
      ] });
    }
    return reply({ places: [
      { id: 'a', displayName: { text: 'Lumen Diagnóstico' }, location: { latitude: -23.566, longitude: -46.653 }, types: ['doctor'] },
      { id: 'c', displayName: { text: 'Laboratório Vida' }, location: { latitude: -23.567, longitude: -46.654 }, types: ['medical_lab'], nationalPhoneNumber: '(11) 3333-4444' },
      { id: 'd', displayName: { text: 'Hospital Fechado' }, location: { latitude: -23.567, longitude: -46.654 }, types: ['hospital'], businessStatus: 'CLOSED_PERMANENTLY' },
      { id: 'e', displayName: { text: 'Clínica Longe Demais' }, location: { latitude: -23.7, longitude: -46.9 }, types: ['doctor'] },
    ] });
  };
  const places = await searchGoogle(fake, 'CHAVE', PAULISTA, 3000);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => !c.url.includes('CHAVE')), 'a chave não pode ir na URL');
  assert.deepEqual(places.map((p) => p.id), ['google:a', 'google:c']);
  assert.equal(places[0].hint, 'imagem', 'veio da busca por diagnóstico por imagem');
  assert.deepEqual(places[0].hours, ['segunda-feira: 07:00–19:00']);
  assert.deepEqual(places[1].types, ['medical_lab']);
  assert.equal(places[1].phone, '(11) 3333-4444');
  assert.equal(places[1].hours, null, 'sem horário informado, não inventa');
});

test('ignora estabelecimentos do Google sem nome ou localização', () => {
  assert.equal(parseGoogle([{ id: 'x', displayName: { text: 'Sem local' } }], PAULISTA, null).length, 0);
  assert.equal(parseGoogle([{ id: 'y', location: { latitude: -23.5, longitude: -46.6 } }], PAULISTA, null).length, 0);
});

test('converte CEP em coordenadas pelo ViaCEP e Photon', async () => {
  const urls: string[] = [];
  const fake: Fetch = async (url) => {
    urls.push(url);
    if (url.includes('viacep')) return reply({ logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' });
    return reply(photon({ name: 'Avenida Paulista', type: 'street', city: 'São Paulo', state: 'São Paulo' }, -46.6559, -23.5614));
  };
  const g = await geocode(fake, '01310-100', '', UA);
  assert.deepEqual(g, { lat: -23.5614, lng: -46.6559, label: 'Avenida Paulista, Bela Vista, São Paulo - SP', precision: 'cep', provider: 'osm' });
  assert.ok(urls[0].includes('viacep.com.br/ws/01310100/json'));
  assert.ok(urls[1].startsWith('https://photon.komoot.io/api/?q=Avenida%20Paulista%2C%20Bela%20Vista%2C%20S%C3%A3o%20Paulo%2C%20SP'));
});

test('não troca a rua pelo centro da cidade: cai para o bairro', async () => {
  let n = 0;
  const fake: Fetch = async (url) => {
    if (url.includes('viacep')) return reply({ logradouro: 'Rua Nova Sem Mapa', bairro: 'Moema', localidade: 'São Paulo', uf: 'SP' });
    n += 1;
    if (n === 1) return reply(photon({ name: 'São Paulo', type: 'city', state: 'São Paulo' }, -46.63, -23.55));
    return reply(photon({ name: 'Moema', type: 'district', city: 'São Paulo', state: 'São Paulo' }, -46.664, -23.601));
  };
  const g = await geocode(fake, '04077000', '', UA);
  assert.equal(g?.precision, 'bairro');
  assert.equal(g?.label, 'Moema, São Paulo - SP');
  assert.equal(g?.lat, -23.601);
});

test('ViaCEP fora do ar: usa a BrasilAPI e as coordenadas dela', async () => {
  const fake: Fetch = async (url) => {
    if (url.includes('viacep')) throw new TypeError('fetch failed');
    assert.ok(url.includes('brasilapi.com.br/api/cep/v2/01310100'));
    return reply({ cep: '01310100', state: 'SP', city: 'São Paulo', neighborhood: 'Bela Vista', street: 'Avenida Paulista', location: { type: 'Point', coordinates: { longitude: '-46.6544', latitude: '-23.5632' } } });
  };
  const g = await geocode(fake, '01310100', '', UA);
  assert.deepEqual(g, { lat: -23.5632, lng: -46.6544, label: 'Avenida Paulista, Bela Vista, São Paulo - SP', precision: 'cep', provider: 'brasilapi' });
});

test('CEP inexistente não vira localização (nem pela BrasilAPI)', async () => {
  const urls: string[] = [];
  const fake: Fetch = async (url) => {
    urls.push(url);
    return url.includes('viacep') ? reply({ erro: 'true' }) : reply({ city: 'Outra cidade', state: 'PR' });
  };
  assert.equal(await geocode(fake, '99999-999', '', UA), null);
  assert.equal(urls.length, 1, 'não consulta a BrasilAPI quando o ViaCEP diz que o CEP não existe');
  const down: Fetch = async (url) => (url.includes('viacep') ? reply({}, 503) : reply({ message: 'CEP não encontrado' }, 404));
  assert.equal(await geocode(down, '99999-999', '', UA), null);
});

test('cidade pelo Photon, só no Brasil', async () => {
  const fake: Fetch = async (url, init) => {
    assert.match(url, /bbox=-74\.1,-33\.9,-34\.7,5\.4/);
    assert.equal((init?.headers as Record<string, string>)['User-Agent'], UA);
    return reply({ features: [
      { properties: { name: 'Campinas', countrycode: 'US', type: 'city' }, geometry: { coordinates: [-80, 30] } },
      { properties: { name: 'Campinas', countrycode: 'BR', type: 'city', state: 'São Paulo' }, geometry: { coordinates: [-47.06, -22.9] } },
    ] });
  };
  assert.deepEqual(await geocode(fake, 'Campinas', '', UA), { lat: -22.9, lng: -47.06, label: 'Campinas - SP', precision: 'cidade', provider: 'osm' });
});

test('endereço com número pelo Photon', async () => {
  const fake: Fetch = async () => reply(photon({ name: 'Rua Augusta', street: 'Rua Augusta', housenumber: '500', type: 'house', district: 'Consolação', city: 'São Paulo', state: 'São Paulo' }, -46.65, -23.55));
  const g = await geocode(fake, 'Rua Augusta 500, São Paulo', '', UA);
  assert.equal(g?.label, 'Rua Augusta, 500, Consolação, São Paulo - SP');
  assert.equal(g?.precision, 'endereco');
});

test('cidade pelo Google Geocoding quando há chave', async () => {
  const fake: Fetch = async (url) => {
    assert.match(url, /maps\.googleapis\.com\/maps\/api\/geocode\/json/);
    assert.match(url, /components=country:BR/);
    return reply({ status: 'OK', results: [{ formatted_address: 'Campinas - SP, Brasil', types: ['locality', 'political'], geometry: { location: { lat: -22.9, lng: -47.06 } } }] });
  };
  assert.deepEqual(await geocode(fake, 'Campinas', 'CHAVE', UA), { lat: -22.9, lng: -47.06, label: 'Campinas - SP', precision: 'cidade', provider: 'google' });
});

test('endereço não encontrado e geocodificador fora do ar', async () => {
  assert.equal(await geocode(async () => reply({ features: [] }), 'Rua que não existe 999999', '', UA), null);
  await assert.rejects(geocode(async () => reply({}, 503), 'Campinas', '', UA), /photon 503/);
  await assert.rejects(geocode(async () => reply({ status: 'REQUEST_DENIED' }), 'Campinas', 'CHAVE', UA), /REQUEST_DENIED/);
});

test('valida e arredonda coordenadas e raio', () => {
  assert.equal(isValidCoord(-23.5, -46.6), true);
  assert.equal(isValidCoord(123, 0), false);
  assert.equal(isValidCoord(Number.NaN, 0), false);
  assert.equal(roundCoord(-23.5650123456), -23.565);
  assert.equal(clampRadius(100), 500);
  assert.equal(clampRadius(999999), 20000);
  assert.equal(clampRadius('abc'), 5000);
  assert.equal(isCep('01310-100'), true);
  assert.equal(isCep('Campinas'), false);
  assert.ok(Math.abs(haversine(PAULISTA, { lat: -23.5614, lng: -46.6559 }) - 563) < 5);
});

/* ---------------- chaves do Supabase (publishable/secret novas, com volta para as antigas) ---------------- */
// Valores de mentira (nenhuma chave de verdade nos testes). As antigas são tokens (JWT) no formato "a.b.c".
const PUB = 'sb_publishable_falsa_1';
const PUB_WEB = 'sb_publishable_falsa_web';
const SEC = 'sb_secret_falsa_1';
const ANTIGA_ANON = 'cabecalho-falso.anon-falso.assinatura-falsa';
const ANTIGA_SERVICO = 'cabecalho-falso.servico-falso.assinatura-falsa';
const envDe = (vars: Record<string, string>) => (name: string): string | undefined => vars[name];
const cabecalhos = (h: Record<string, string>) => new Headers(h);

test('chaves: lê o JSON por nome das variáveis novas (SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS)', () => {
  assert.deepEqual(namedKeys(JSON.stringify({ default: PUB })), { default: PUB });
  assert.deepEqual(namedKeys(JSON.stringify({ default: ` ${PUB} `, web: PUB_WEB })), { default: PUB, web: PUB_WEB }, 'espaços em volta saem');
  assert.deepEqual(namedKeys(JSON.stringify({ default: PUB, vazio: '', numero: 7, nulo: null })), { default: PUB }, 'só textos não vazios');
  // Ausente, vazio, quebrado ou fora do formato: nenhuma chave, sem derrubar a função.
  for (const raw of [undefined, null, '', '   ', '{quebrado', '"sb_publishable_solta"', '[1,2]', 'null', '42']) {
    assert.deepEqual(namedKeys(raw), {}, `entrada: ${String(raw)}`);
  }
});

test('chaves: a nova "default" vem primeiro; sem ela, a primeira da lista; sem lista, a antiga', () => {
  const nova = envDe({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ web: PUB_WEB, default: PUB }), SUPABASE_ANON_KEY: ANTIGA_ANON });
  assert.deepEqual(publishableKey(nova), { key: PUB, legacy: false }, 'nova "default" ganha da antiga');
  assert.deepEqual(publishableKey(nova, 'web'), { key: PUB_WEB, legacy: false }, 'outra chave pelo nome');
  assert.deepEqual(publishableKey(envDe({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ web: PUB_WEB }) })), { key: PUB_WEB, legacy: false }, 'sem "default": a primeira da lista');
  // Antiga: só quando a nova falta (variável ausente, vazia ou quebrada).
  assert.deepEqual(publishableKey(envDe({ SUPABASE_ANON_KEY: ANTIGA_ANON })), { key: ANTIGA_ANON, legacy: true });
  assert.deepEqual(publishableKey(envDe({ SUPABASE_PUBLISHABLE_KEYS: '{}', SUPABASE_ANON_KEY: ANTIGA_ANON })), { key: ANTIGA_ANON, legacy: true });
  assert.deepEqual(publishableKey(envDe({ SUPABASE_PUBLISHABLE_KEYS: 'quebrado', SUPABASE_ANON_KEY: ANTIGA_ANON })), { key: ANTIGA_ANON, legacy: true });
  assert.equal(publishableKey(envDe({})), null, 'nenhuma chave: null (a função segue sem a chave, não quebra)');
  // A secreta funciona igual, com a service_role antiga de volta.
  assert.deepEqual(secretKey(envDe({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SEC }), SUPABASE_SERVICE_ROLE_KEY: ANTIGA_SERVICO })), { key: SEC, legacy: false });
  assert.deepEqual(secretKey(envDe({ SUPABASE_SERVICE_ROLE_KEY: ANTIGA_SERVICO })), { key: ANTIGA_SERVICO, legacy: true });
  assert.equal(secretKey(envDe({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUB }) })), null, 'a publishable nunca vira secreta');
});

test('chaves: o "status" da função diz qual chave está em uso (nova, antiga ou ausente), nunca a chave', () => {
  assert.equal(keyKind(publishableKey(envDe({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUB }), SUPABASE_ANON_KEY: ANTIGA_ANON }))), 'nova');
  assert.equal(keyKind(secretKey(envDe({ SUPABASE_SERVICE_ROLE_KEY: ANTIGA_SERVICO }))), 'antiga');
  assert.equal(keyKind(secretKey(envDe({}))), 'ausente');
});

test('chaves: cabeçalhos do servidor — a nova só em apikey; a antiga (JWT) em apikey e Bearer, como antes', () => {
  assert.deepEqual(keyHeaders({ key: PUB, legacy: false }), { apikey: PUB });
  assert.deepEqual(keyHeaders({ key: SEC, legacy: false }), { apikey: SEC });
  assert.deepEqual(keyHeaders({ key: ANTIGA_ANON, legacy: true }), { apikey: ANTIGA_ANON, Authorization: `Bearer ${ANTIGA_ANON}` });
  assert.deepEqual(keyHeaders({ key: SEC, legacy: true }), { apikey: SEC }, 'chave "sb_" nunca vai em Bearer');
  assert.deepEqual(keyHeaders(null), {});
});

test('chaves: quem pode chamar a busca (verify_jwt=false) — a publishable no apikey ou a anon antiga', () => {
  const env = envDe({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUB, web: PUB_WEB }), SUPABASE_ANON_KEY: ANTIGA_ANON, SUPABASE_SECRET_KEYS: JSON.stringify({ default: SEC }) });
  const keys = callerKeys(env);
  assert.deepEqual(keys, [PUB, PUB_WEB, ANTIGA_ANON], 'todas as publishable e a anon antiga; a secreta não entra');
  assert.deepEqual(acceptedKeys(env, PUBLISHABLE_VARS), keys);
  assert.deepEqual(acceptedKeys(envDe({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ a: PUB, b: PUB }) }), PUBLISHABLE_VARS), [PUB], 'sem repetir');
  assert.deepEqual(acceptedKeys(envDe({}), SECRET_VARS), []);
  // Site novo: só a publishable no apikey, sem Authorization.
  assert.equal(callerAllowed(cabecalhos({ apikey: PUB }), keys), true);
  assert.equal(callerAllowed(cabecalhos({ apikey: PUB_WEB }), keys), true);
  // Site antigo (ainda em cache no aparelho): anon antiga no apikey e no Bearer.
  assert.equal(callerAllowed(cabecalhos({ apikey: ANTIGA_ANON, authorization: `Bearer ${ANTIGA_ANON}` }), keys), true);
  // Sem chave, chave errada ou a chave nova em Bearer (o Supabase recusa esse formato; aqui também não vale).
  assert.equal(callerAllowed(cabecalhos({}), keys), false);
  assert.equal(callerAllowed(cabecalhos({ apikey: 'sb_publishable_outro_projeto' }), keys), false);
  assert.equal(callerAllowed(cabecalhos({ authorization: `Bearer ${PUB}` }), keys), false);
  assert.equal(callerAllowed(cabecalhos({ apikey: SEC }), keys), false, 'a secreta não é chave de visitante');
  // Ambiente sem a lista das publishable novas (só a anon antiga, ou nada): não dá para reconhecer a chave do site, e
  // a função não barra ninguém (origem, limite e validação continuam valendo).
  assert.equal(callerKeys(envDe({ SUPABASE_ANON_KEY: ANTIGA_ANON })), null);
  assert.equal(callerKeys(envDe({ SUPABASE_PUBLISHABLE_KEYS: 'quebrado', SUPABASE_ANON_KEY: ANTIGA_ANON })), null);
  assert.equal(callerKeys(envDe({})), null);
  assert.equal(callerAllowed(cabecalhos({ apikey: PUB }), null), true);
  assert.equal(callerAllowed(cabecalhos({}), null), true);
  assert.equal(callerAllowed(cabecalhos({}), []), true);
});

test('chaves: comparação sem atalho e cabeçalhos de quem chama', () => {
  assert.equal(sameKey(PUB, PUB), true);
  assert.equal(sameKey(PUB, PUB.slice(0, -1)), false, 'tamanho diferente');
  assert.equal(sameKey(PUB, PUB.slice(0, -1) + 'X'), false, 'última letra diferente');
  assert.equal(sameKey('', ''), false, 'vazio nunca vale');
  assert.equal(sameKey(undefined, PUB), false);
  assert.equal(hasKey(cabecalhos({ apikey: PUB }), [PUB]), true);
  assert.equal(hasKey(cabecalhos({ Authorization: `Bearer ${ANTIGA_ANON}` }), [ANTIGA_ANON]), true, 'antiga também em Bearer');
  assert.equal(hasKey(cabecalhos({ Authorization: `Bearer ${PUB}` }), [PUB]), false, 'nova em Bearer não vale');
  assert.equal(hasKey(cabecalhos({ apikey: PUB }), []), false);
});

test('chaves: a chave única sem JSON (SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY) vale como "default" se o JSON faltar', () => {
  const uma = envDe({ SUPABASE_PUBLISHABLE_KEY: ` ${PUB} `, SUPABASE_SECRET_KEY: SEC, SUPABASE_ANON_KEY: ANTIGA_ANON });
  assert.deepEqual(newKeys(uma, PUBLISHABLE_VARS), { default: PUB });
  assert.deepEqual(publishableKey(uma), { key: PUB, legacy: false }, 'a única nova ganha da antiga');
  assert.deepEqual(secretKey(uma), { key: SEC, legacy: false });
  assert.deepEqual(callerKeys(uma), [PUB, ANTIGA_ANON], 'confere a chave de quem chama também com a chave única');
  // O JSON, quando existe, manda (a única fica de lado).
  const ambos = envDe({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUB_WEB }), SUPABASE_PUBLISHABLE_KEY: PUB });
  assert.deepEqual(newKeys(ambos, PUBLISHABLE_VARS), { default: PUB_WEB });
  assert.deepEqual(publishableKey(ambos), { key: PUB_WEB, legacy: false });
  // JSON quebrado ou vazio: a única; sem nenhuma das duas: a antiga.
  assert.deepEqual(publishableKey(envDe({ SUPABASE_PUBLISHABLE_KEYS: 'quebrado', SUPABASE_PUBLISHABLE_KEY: PUB })), { key: PUB, legacy: false });
  assert.deepEqual(newKeys(envDe({ SUPABASE_PUBLISHABLE_KEY: '   ' }), PUBLISHABLE_VARS), {});
  assert.deepEqual(publishableKey(envDe({ SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_ANON_KEY: ANTIGA_ANON })), { key: ANTIGA_ANON, legacy: true });
  // A secreta única nunca vira publishable (e vice-versa).
  assert.equal(publishableKey(envDe({ SUPABASE_SECRET_KEY: SEC })), null);
  assert.equal(secretKey(envDe({ SUPABASE_PUBLISHABLE_KEY: PUB })), null);
});

test('travas: origem só no navegador, IP do primeiro item de X-Forwarded-For e limite de 40 por minuto', () => {
  const SITES = defaultOrigins('https://conta-nova.github.io/SITE/', ['https://conta-antiga.github.io/site-antigo/', 'https://conta-nova.github.io/outro/', 'nada']);
  assert.deepEqual(SITES, ['https://conta-nova.github.io', 'https://conta-antiga.github.io', ...LOCAL_ORIGINS], 'site atual, anteriores (sem repetir) e o computador de quem desenvolve');
  assert.deepEqual(defaultOrigins('https://imed.com.br/'), ['https://imed.com.br', ...LOCAL_ORIGINS]);
  assert.equal(originAllowed('https://conta-nova.github.io', SITES), true);
  assert.equal(originAllowed('https://conta-antiga.github.io', SITES), true, 'o endereço anterior continua aceito na troca');
  assert.equal(originAllowed('https://exemplo.com', SITES), false, 'outro site no navegador: 403');
  assert.equal(originAllowed(null, SITES), true, 'sem Origin (fora do navegador): não confere a origem');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })), '203.0.113.9');
  assert.equal(clientIp(new Headers({})), 'desconhecido');
  const hits = new Map<string, { n: number; reset: number }>();
  const t0 = 1_000_000;
  for (let i = 1; i <= 40; i++) assert.equal(rateLimited(hits, '203.0.113.9', t0 + i), false, `chamada ${i} passa`);
  assert.equal(rateLimited(hits, '203.0.113.9', t0 + 41), true, 'a 41ª no mesmo minuto: 429');
  assert.equal(rateLimited(hits, '198.51.100.7', t0 + 42), false, 'outro IP conta à parte');
  assert.equal(rateLimited(hits, '203.0.113.9', t0 + 60_002), false, 'minuto novo: conta do zero');
});

test('importador: a resposta ao "ping" diz se ele aceita a chave secreta da busca (sem mostrar chave)', () => {
  assert.equal(importerAnswer(200, { ok: true }), 'ok');
  assert.equal(importerAnswer(400, { ok: false, error: 'unknown_action' }), 'antigo', 'versão sem "ping", mas aceitou a chave');
  assert.equal(importerAnswer(403, { ok: false, error: 'forbidden' }), 'recusou');
  assert.equal(importerAnswer(401, null), 'recusou');
  assert.equal(importerAnswer(500, { ok: false, error: 'internal' }), 'erro');
  assert.equal(importerAnswer(200, { ok: false }), 'erro');
  assert.equal(importerAnswer(200, 'texto'), 'erro');
});
