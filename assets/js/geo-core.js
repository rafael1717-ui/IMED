// Regras da busca de clínicas do IMED que rodam no navegador: classificação dos estabelecimentos,
// distância, junção das fontes, filtros, ordenação e validação do pedido de agendamento.
// Não mexe na página, então também é testado no Node (tests/geo-core.test.mjs).

export const EXAMS = {
  rx: { n: 'Raio-X', slug: 'raio-x' },
  usg: { n: 'Ultrassom', slug: 'ultrassom' },
  tc: { n: 'Tomografia', slug: 'tomografia' },
  rm: { n: 'Ressonância', slug: 'ressonancia-magnetica' },
  mamo: { n: 'Mamografia', slug: 'mamografia' },
  dens: { n: 'Densitometria', slug: 'densitometria-ossea' },
  ecg: { n: 'Eletrocardiograma', slug: 'eletrocardiograma' },
  eco: { n: 'Ecocardiograma', slug: 'ecocardiograma' },
  lab: { n: 'Exames de laboratório', slug: null },
};

export const KINDS = {
  imagem: { n: 'Diagnóstico por imagem', icon: 'fa-x-ray' },
  laboratorio: { n: 'Laboratório', icon: 'fa-flask' },
  clinica: { n: 'Clínica', icon: 'fa-stethoscope' },
  hospital: { n: 'Hospital', icon: 'fa-hospital' },
};

// Distâncias da busca (metros). O banco aceita até 50 km; o padrão é 5 km (DEFAULT_FILTERS).
export const RADII = [1000, 2000, 5000, 10000, 20000, 50000];

// Faixas de preço em centavos: [mínimo, máximo]. Só valem para preços informados pelas clínicas.
export const PRICE_RANGES = {
  ate100: [null, 10000],
  '100a300': [10000, 30000],
  '300a600': [30000, 60000],
  acima600: [60000, null],
};

const EXAM_PATTERNS = [
  ['rm', /resson[aâ]ncia|\brmn?\b|magn[eé]tica/i],
  ['tc', /tomogra|\btc\b/i],
  ['usg', /ultra-?s(?:som|onografia)|ultrass|ecografia|\busg\b|doppler/i],
  ['mamo', /mamogra/i],
  ['dens', /densitometr/i],
  ['rx', /raio[\s-]?x|radiograf|\brx\b/i],
  ['eco', /ecocardio/i],
  ['ecg', /eletrocardio|\becg\b/i],
  ['lab', /laborat|an[aá]lises cl[ií]nicas|exames laboratoriais/i],
];
const IMAGING_RE = /imagem|radiolog|diagn[oó]stic|tomogra|resson|ultrass|ultra-s|mamogra|raio[\s-]?x|radiograf|densitom|medicina nuclear|pet[\s-]?ct/i;
const LAB_RE = /laborat|an[aá]lises cl[ií]nicas|patologia cl[ií]nica|\blab\b/i;
const EXCLUDE_RE = /odonto|dent[aá]ri|dentista|veterin|est[eé]tica|farm[aá]cia|drogaria/i;
const GOOGLE_EXCLUDE = ['dentist', 'dental_clinic', 'veterinary_care', 'pharmacy', 'drugstore', 'beauty_salon', 'spa'];

const SPECIALTY_PT = {
  general: 'Clínico geral', family_medicine: 'Medicina de família', internal: 'Clínica médica',
  cardiology: 'Cardiologia', radiology: 'Radiologia', diagnostic_radiology: 'Radiologia', nuclear: 'Medicina nuclear',
  orthopaedics: 'Ortopedia', gynaecology: 'Ginecologia', obstetrics: 'Obstetrícia', paediatrics: 'Pediatria',
  dermatology: 'Dermatologia', ophthalmology: 'Oftalmologia', otolaryngology: 'Otorrinolaringologia',
  urology: 'Urologia', neurology: 'Neurologia', psychiatry: 'Psiquiatria', endocrinology: 'Endocrinologia',
  gastroenterology: 'Gastroenterologia', oncology: 'Oncologia', pulmonology: 'Pneumologia', nephrology: 'Nefrologia',
  rheumatology: 'Reumatologia', angiology: 'Angiologia', vascular_surgery: 'Cirurgia vascular', surgery: 'Cirurgia',
  emergency: 'Pronto atendimento', mastology: 'Mastologia', physiotherapy: 'Fisioterapia', psychology: 'Psicologia',
};
const SPECIALTY_BY_NAME = [
  ['Cardiologia', /cardio/i], ['Ortopedia', /ortoped|\bortop/i], ['Ginecologia', /gineco|sa[uú]de da mulher/i],
  ['Pediatria', /pediatr|infantil/i], ['Dermatologia', /dermat/i], ['Oftalmologia', /oftalm|\bolhos\b/i],
  ['Otorrinolaringologia', /otorrino/i], ['Urologia', /urolog/i], ['Neurologia', /neuro/i], ['Oncologia', /oncolog/i],
  ['Radiologia', /radiolog|diagn[oó]stico por imagem/i], ['Mastologia', /mastolog/i],
];
const DAY_PT = { Mo: 'seg', Tu: 'ter', We: 'qua', Th: 'qui', Fr: 'sex', Sa: 'sáb', Su: 'dom', PH: 'feriados' };
const DAY_LABEL = { seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado', dom: 'Domingo', feriados: 'Feriados' };

export function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Três casas decimais: cerca de 110 m. É a precisão usada para buscar, sem guardar onde a pessoa está.
export const roundCoord = (v, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

export function normName(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(clinica|centro|de|da|do|das|dos|e|ltda|me|eireli|s\/?a|unidade)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function examsFromText(text, kind) {
  const out = EXAM_PATTERNS.filter(([, re]) => re.test(text)).map(([code]) => code);
  if (kind === 'laboratorio' && !out.includes('lab')) out.push('lab');
  return out;
}

const specialtiesFromName = (name) => SPECIALTY_BY_NAME.filter(([, re]) => re.test(name)).map(([label]) => label);

export function classifyOsm(tags) {
  const name = tags.name ?? '';
  const spec = (tags['healthcare:speciality'] ?? '').toLowerCase();
  if (EXCLUDE_RE.test(name) || /dentist|orthodontics|veterinary/.test(spec) || tags.healthcare === 'dentist') return null;
  let kind;
  if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') kind = 'hospital';
  else if (['laboratory', 'sample_collection'].includes(tags.healthcare) || LAB_RE.test(name) || /biology|blood_check|clinical_pathology/.test(spec)) kind = 'laboratorio';
  else if (tags.healthcare === 'radiology' || /radiology|nuclear/.test(spec) || IMAGING_RE.test(name)) kind = 'imagem';
  else kind = 'clinica';
  const services = examsFromText(`${name} ${tags.description ?? ''} ${spec.replace(/_/g, ' ')}`, kind);
  const fromTags = spec.split(/[;,]/).map((s) => SPECIALTY_PT[s.trim()]).filter(Boolean);
  const specialties = [...new Set([...fromTags, ...specialtiesFromName(name)])];
  return { kind, services, specialties };
}

export function formatOsmHours(raw) {
  if (raw.trim() === '24/7') return 'Aberto 24 horas';
  return raw
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => DAY_PT[d] ?? d)
    .replace(/\boff\b/g, 'fechado')
    .replace(/(\d{2}:\d{2})-(\d{2}:\d{2})/g, '$1–$2')
    .replace(/([a-zá]{3})-([a-zá]{3})/g, '$1–$2')
    .replace(/;\s*/g, ' · ');
}

export function formatClinicHours(h) {
  if (!h) return null;
  if (Array.isArray(h)) return h.map(String).filter(Boolean);
  if (typeof h === 'object') {
    const lines = Object.entries(h).map(([d, v]) => `${DAY_LABEL[d] ?? d}: ${String(v)}`);
    return lines.length ? lines : null;
  }
  return null;
}

export function safeUrl(v) {
  if (!v) return null;
  const s = String(v).split(';')[0].trim();
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

const firstOf = (v) => (v ? String(v).split(';')[0].trim() || null : null);

function whatsappDigits(v) {
  const d = (firstOf(v) ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

function osmAddress(t) {
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ');
  const parts = [street, t['addr:suburb'] ?? t['addr:neighbourhood'], t['addr:city']].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// Retângulo que contém o círculo de busca. Consultas por retângulo são bem mais leves no Overpass.
export function bboxAround(o, radius) {
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.cos((o.lat * Math.PI) / 180));
  return [o.lat - dLat, o.lng - dLng, o.lat + dLat, o.lng + dLng].map((v) => v.toFixed(5));
}

// ".{1,2}" no lugar da letra acentuada funciona tanto em servidores que comparam por caractere quanto por byte.
const NAME_HINT = '["name"~"cl.{1,2}nica|diagn.{1,2}st|imagem|laborat|radiolog|tomogra|resson|ultrass|centro m.{1,2}dico|policl.{1,2}nica|cardio",i]';

export function overpassQuery(o, radius) {
  const [s, w, n, e] = bboxAround(o, radius);
  return `[out:json][timeout:25][bbox:${s},${w},${n},${e}];(`
    + 'nwr["amenity"~"^(clinic|hospital)$"];'
    + 'nwr["healthcare"~"^(laboratory|sample_collection|radiology|clinic|centre|hospital)$"];'
    + `nwr["amenity"="doctors"]${NAME_HINT};`
    + `nwr["healthcare"="doctor"]${NAME_HINT};`
    + ');out center tags 1000;';
}

export function parseOverpass(json, origin, radius = Infinity) {
  const seen = new Set();
  const out = [];
  for (const e of json?.elements ?? []) {
    const t = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    if (!t.name || typeof lat !== 'number' || typeof lng !== 'number') continue;
    const cls = classifyOsm(t);
    if (!cls) continue;
    const distance = Math.round(haversine(origin, { lat, lng }));
    if (distance > radius) continue;
    const key = `${normName(t.name)}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `osm:${e.type[0]}${e.id}`, clinic_id: null, source: 'osm', name: t.name.trim(), kind: cls.kind,
      address: osmAddress(t), cep: t['addr:postcode'] ?? null, lat, lng, distance_m: distance,
      phone: firstOf(t.phone ?? t['contact:phone']), whatsapp: whatsappDigits(t['contact:whatsapp']),
      email: firstOf(t.email ?? t['contact:email']), website: safeUrl(t.website ?? t['contact:website']),
      maps_url: `https://www.openstreetmap.org/${e.type}/${e.id}`, description: null,
      services: cls.services, services_source: cls.services.length ? 'mapa' : null, specialties: cls.specialties,
      hours: t.opening_hours ? [formatOsmHours(t.opening_hours)] : null, hours_source: t.opening_hours ? 'osm' : null,
      prices: null, accepts_online_booking: false, is_demo: false,
    });
  }
  return out.sort((a, b) => a.distance_m - b.distance_m).slice(0, 200);
}

// Estabelecimento do Google Places vindo do servidor (a chave nunca chega ao navegador).
export function normalizeGoogle(raw, origin) {
  const types = raw.types ?? [];
  if (types.some((t) => GOOGLE_EXCLUDE.includes(t)) || EXCLUDE_RE.test(raw.name)) return null;
  let kind;
  if (types.includes('hospital')) kind = 'hospital';
  else if (types.includes('medical_lab') || LAB_RE.test(raw.name)) kind = 'laboratorio';
  else if (raw.hint === 'imagem' || IMAGING_RE.test(raw.name)) kind = 'imagem';
  else kind = 'clinica';
  const services = examsFromText(raw.name, kind);
  const hours = raw.hours?.length ? raw.hours : null;
  return {
    id: raw.id, clinic_id: null, source: 'google', name: raw.name, kind, address: raw.address ?? null, cep: null,
    lat: raw.lat, lng: raw.lng, distance_m: Math.round(haversine(origin, raw)),
    phone: raw.phone ?? null, whatsapp: null, email: null, website: safeUrl(raw.website), maps_url: safeUrl(raw.maps_url),
    description: null, services, services_source: services.length ? 'mapa' : null, specialties: specialtiesFromName(raw.name),
    hours, hours_source: hours ? 'google' : null, prices: null, accepts_online_booking: false, is_demo: false,
  };
}

const formatCep = (cep) => (/^\d{8}$/.test(cep ?? '') ? `${cep.slice(0, 5)}-${cep.slice(5)}` : null);

// Distância que veio do banco (PostGIS, no elipsoide: a mesma conta que decide quem entra no raio, no total
// e nas páginas). Sem ela, a conta na esfera. Recalcular sempre na esfera dava até ~0,4% a mais (5.000 m
// viravam ~5.020 m) e tirava da lista quem estava na borda do raio, embora o banco o contasse.
export function rowDistance(r, origin) {
  const d = r?.distance_m;
  const n = typeof d === 'number' || (typeof d === 'string' && d.trim() !== '') ? Number(d) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : Math.round(haversine(origin, r));
}

// Estabelecimento real do CNES (cadastro oficial do Ministério da Saúde), como vem da função
// nearby_establishments do banco. O turno vem do CNES; não há horário exato nem preço.
// A distância é a do banco (a partir da mesma origem da busca), quando vem.
export function normalizeCnes(r, origin) {
  const hours = r.open_24h ? ['Aberto 24 horas'] : r.shift ? [r.shift] : null;
  const equip = normalizeEquip(r);
  const services = [...new Set([...(r.services ?? []), ...(equip?.exams ?? [])])];
  return {
    id: `cnes:${r.cnes}`, clinic_id: null, source: 'cnes', name: r.name, kind: KINDS[r.kind] ? r.kind : 'clinica',
    address: [r.address_line, r.neighborhood, r.city && r.uf ? `${r.city} - ${r.uf}` : r.city].filter(Boolean).join(' · ') || null,
    cep: formatCep(r.cep), lat: r.lat, lng: r.lng, distance_m: rowDistance(r, origin),
    phone: r.phone ?? null, whatsapp: null, email: null, website: null,
    maps_url: r.city_code ? `https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/${r.city_code}${r.cnes}` : null,
    description: null, services, services_source: services.length ? 'mapa' : null, specialties: r.specialties ?? [],
    hours, hours_source: hours ? 'cnes' : null, prices: null, accepts_online_booking: false, is_demo: false,
    approx: r.location_source === 'endereco', sus: r.sus === true, updated_at: r.cnes_updated_at ?? null,
    equip,
  };
}

// Aparelhos em uso informados ao CNES (colunas equip_* de establishments). Sem as colunas na linha: null.
export const EQUIP_FIELDS = 'equip_exams,equip_exams_sus,equip_competencia';
export const EQUIP_EXAMS = ['rm', 'tc', 'mamo', 'rx', 'dens', 'usg', 'ecg'];
export function normalizeEquip(r) {
  if (!r || !Array.isArray(r.equip_exams)) return null;
  const ok = (a) => (Array.isArray(a) ? a.filter((c) => EQUIP_EXAMS.includes(c)) : []);
  const comp = typeof r.equip_competencia === 'string' && /^\d{4}-\d{2}/.test(r.equip_competencia) ? r.equip_competencia.slice(0, 7) : null;
  return { exams: ok(r.equip_exams), sus: ok(r.equip_exams_sus), competencia: comp };
}
export const equipPath = (cnesList) => {
  const ok = [...new Set(cnesList)].filter(isCnesCode).slice(0, 150);
  return ok.length ? `establishments?select=cnes,${EQUIP_FIELDS}&cnes=in.(${ok.join(',')})` : null;
};
// "de ressonância": o aparelho do exame, para o aviso.
export const APARELHO = {
  rm: 'de ressonância', tc: 'de tomografia', mamo: 'de mamografia', rx: 'de raio-X', dens: 'de densitometria',
  usg: 'de ultrassom', ecg: 'de eletrocardiograma',
};
export const hasEquip = (p, exam) => !!(exam && p?.equip?.exams?.includes(exam));
// Aviso do cartão e da ficha. Nunca diz que o local faz o exame.
export function equipNote(p, exam) {
  if (!hasEquip(p, exam)) return '';
  return `Tem aparelho ${APARELHO[exam]} em uso (cadastro oficial). Confirme com o local.`;
}
// Competência AAAA-MM -> mm/aaaa.
export const formatComp = (c) => (c && /^\d{4}-\d{2}$/.test(c) ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : null);
// Exames de imagem: quando nenhum local tem o exame, mostramos os centros de diagnóstico por imagem perto.
export const IMAGING_EXAMS = ['rm', 'tc', 'mamo', 'rx', 'dens', 'usg'];

// Clínica cadastrada no IMED, como vem da função nearby_clinics do banco.
// Preço e horário só aparecem quando a clínica informou; nada é estimado. Distância: a do banco, quando vem.
export function normalizeImedRow(r, origin) {
  const prices = {};
  for (const e of r.exams ?? []) prices[e.code] = e.price_cents ?? null;
  const street = r.neighborhood && r.address_line.includes(r.neighborhood)
    ? r.address_line : [r.address_line, r.neighborhood].filter(Boolean).join(' · ');
  const hours = formatClinicHours(r.opening_hours);
  return {
    id: `imed:${r.id}`, clinic_id: r.id, source: 'imed', name: r.name, kind: KINDS[r.kind] ? r.kind : 'clinica',
    address: `${street} · ${r.city} - ${r.state}`, cep: r.cep ?? null, lat: r.lat, lng: r.lng,
    distance_m: rowDistance(r, origin),
    phone: r.phone ?? null, whatsapp: r.whatsapp ?? null, email: r.email ?? null, website: safeUrl(r.website),
    maps_url: null, description: r.description ?? null,
    services: Object.keys(prices), services_source: 'clinica', specialties: r.specialties ?? [],
    hours, hours_source: hours ? 'clinica' : null, prices,
    accepts_online_booking: !!r.accepts_online_booking, is_demo: !!r.is_demo,
    insurances: cleanList(r.insurances), cnes: r.cnes ?? null,
  };
}

// Lista de textos sem vazios nem repetidos (ignorando maiúsculas e acentos), na ordem em que veio.
function cleanList(v) {
  const seen = new Set();
  const out = [];
  for (const x of Array.isArray(v) ? v : []) {
    const s = String(x ?? '').replace(/\s+/g, ' ').trim();
    const k = foldText(s);
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}
const foldText = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Junta parceiros IMED e estabelecimentos do mapa, tirando do mapa quem já é parceiro.
export function mergePlaces(imed, others) {
  const kept = others.filter((p) => !imed.some((c) => {
    if (haversine(c, p) > 200) return false;
    const a = normName(c.name), b = normName(p.name);
    return a === b || (a.length > 3 && b.includes(a)) || (b.length > 3 && a.includes(b));
  }));
  return [...imed, ...kept];
}

export const priceFor = (p, exam) => p.prices?.[exam] ?? null;

export function minPrice(p) {
  const vals = Object.values(p.prices ?? {}).filter((v) => v != null);
  return vals.length ? Math.min(...vals) : null;
}

export const DEFAULT_FILTERS = { kind: '', exam: '', specialty: '', radius: 5000, price: '', sort: 'dist', onlyImed: false, sus: false, insurance: '' };

export function activeFilterCount(f) {
  return ['kind', 'exam', 'specialty', 'price', 'insurance'].filter((k) => f[k]).length + (f.onlyImed ? 1 : 0) + (f.sus ? 1 : 0);
}

// O convênio só vale para parceiros: quem informa os convênios aceitos é a própria clínica.
export const acceptsInsurance = (p, name) => p.source === 'imed' && (p.insurances ?? []).some((x) => foldText(x) === foldText(name));

// Convênios informados pelos parceiros encontrados, sem repetir, em ordem alfabética.
export function insuranceOptions(list) {
  const byKey = new Map();
  for (const p of list) if (p.source === 'imed') for (const x of p.insurances ?? []) if (!byKey.has(foldText(x))) byKey.set(foldText(x), x);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function filterPlaces(list, f) {
  const range = f.price ? PRICE_RANGES[f.price] : null;
  return list.filter((p) => {
    if (p.distance_m > f.radius) return false;
    if (f.onlyImed && p.source !== 'imed') return false;
    if (f.kind && p.kind !== f.kind) return false;
    if (f.exam && !p.services.includes(f.exam)) return false;
    if (f.specialty && !p.specialties.includes(f.specialty)) return false;
    // "Atende SUS" vem do cadastro oficial (CNES); quem não tem esse dado fica de fora.
    if (f.sus && p.sus !== true) return false;
    if (f.insurance && !acceptsInsurance(p, f.insurance)) return false;
    if (range) {
      const vals = f.exam ? [priceFor(p, f.exam)] : Object.values(p.prices ?? {});
      const ok = vals.some((v) => v != null && (range[0] == null || v >= range[0]) && (range[1] == null || v <= range[1]));
      if (!ok) return false;
    }
    return true;
  });
}

// ratings: Map de id do local → { rating, reviews } (só o que veio do banco).
export function sortPlaces(list, sort, exam, ratings = null) {
  const arr = [...list];
  const byDist = (a, b) => a.distance_m - b.distance_m;
  if (sort === 'rating') {
    const r = (p) => ratings?.get(p.id)?.rating ?? null;
    arr.sort((a, b) => {
      const ra = r(a), rb = r(b);
      if (ra == null && rb == null) return byDist(a, b);
      if (ra == null) return 1;
      if (rb == null) return -1;
      return rb - ra || (ratings.get(b.id).reviews - ratings.get(a.id).reviews) || byDist(a, b);
    });
  } else if (sort === 'name') {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || byDist(a, b));
  } else if (sort === 'price') {
    const pr = (p) => (exam ? priceFor(p, exam) : minPrice(p));
    arr.sort((a, b) => {
      const pa = pr(a), pb = pr(b);
      if (pa == null && pb == null) return byDist(a, b);
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa - pb || byDist(a, b);
    });
  } else {
    arr.sort(byDist);
  }
  return arr;
}

// Faixa de preço de um exame entre os parceiros que informaram o valor. Sem preço informado: null.
// Clínicas de demonstração não entram (os dados delas são fictícios).
export function priceRange(list, exam) {
  const vals = list.filter((p) => p.source === 'imed' && !p.is_demo).map((p) => priceFor(p, exam)).filter((v) => typeof v === 'number');
  return vals.length ? { min: Math.min(...vals), max: Math.max(...vals), count: vals.length } : null;
}

// Nota média com vírgula e uma casa (4.6 → "4,6").
export const formatRating = (v) => Number(v).toFixed(1).replace('.', ',');

export function specialtyOptions(list) {
  return [...new Set(list.flatMap((p) => p.specialties))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function formatDistance(m) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

export function formatPrice(cents) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2,
  }).format(cents / 100);
}

/* ======================= área inteira da busca (mapa com pontos e lista em páginas) ======================= */
// Número inteiro no formato do Brasil: 3158 → "3.158".
const COUNT_FMT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
export const formatCount = (n) => COUNT_FMT.format(n);

// Filtros que o banco aplica na área inteira (raio, tipo, exame e SUS). Os outros (preço, convênio,
// especialidade, "Parceiros verificados") valem só no navegador.
export function areaFilters(f) {
  return {
    radius: Number(f?.radius) > 0 ? Math.round(Number(f.radius)) : DEFAULT_FILTERS.radius,
    kind: Object.hasOwn(KINDS, f?.kind ?? '') ? f.kind : '',
    exam: Object.hasOwn(EXAMS, f?.exam ?? '') ? f.exam : '',
    sus: f?.sus === true,
  };
}
export function hasAreaFilter(f) {
  const a = areaFilters(f);
  return !!(a.kind || a.exam || a.sus);
}
// Chave da consulta da área: muda quando raio, tipo, exame ou SUS mudam.
export function areaKey(f) {
  const a = areaFilters(f);
  return `${a.radius}|${a.kind}|${a.exam}|${a.sus ? 1 : 0}`;
}

// Filtros que tiram do resultado todo o cadastro oficial: preço e convênio só existem para parceiros.
export const onlyPartnerFilter = (f) => !!(f?.onlyImed || f?.price || f?.insurance);

// Parâmetros das funções nearby_establishments e establishment_points: origem, raio e, quando escolhidos,
// tipo, exame e SUS. "Atende SUS" desligado não manda nada (p_sus=false traria só quem NÃO atende).
export function areaArgs(origin, f) {
  const a = areaFilters(f);
  return {
    p_lat: origin.lat, p_lng: origin.lng, p_radius_m: a.radius,
    ...(a.kind ? { p_kind: a.kind } : {}),
    ...(a.exam ? { p_exam: a.exam } : {}),
    ...(a.sus ? { p_sus: true } : {}),
  };
}

// Total da área (com os filtros) que o banco repete em cada linha, na coluna "total". Sem ele: null.
export function rowsTotal(rows) {
  const v = Array.isArray(rows) ? rows[0]?.total : null;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

// Pontos da área para o mapa (establishment_points). Pedimos só as colunas necessárias, para gastar
// pouco do plano de dados do celular; o detalhe vem ao tocar no ponto.
export const POINT_FIELDS = 'cnes,kind,lat,lng,total';
export function normalizePoints(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  const points = [];
  for (const r of list) {
    const cnes = String(r?.cnes ?? '');
    const lat = Number(r?.lat), lng = Number(r?.lng);
    if (!isCnesCode(cnes) || seen.has(cnes)) continue;
    if (r?.lat == null || r?.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    seen.add(cnes);
    points.push({ cnes, kind: Object.hasOwn(KINDS, r.kind ?? '') ? r.kind : 'clinica', lat, lng });
  }
  return { points, total: rowsTotal(list) };
}

// Detalhe de um ponto do mapa: a linha da tabela establishments, sem a coluna de localização
// (a posição já veio com o ponto).
export const POINT_DETAIL_SELECT = 'cnes,name,kind,cnes_type,address_line,neighborhood,cep,phone,shift,open_24h,sus,services,specialties,cnes_updated_at,location_source,equip_exams,equip_exams_sus,equip_competencia,municipalities(name,uf,cnes_code)';
export const pointDetailPath = (cnes) => (isCnesCode(cnes) ? `establishments?select=${POINT_DETAIL_SELECT}&cnes=eq.${cnes}` : null);

// Linha do detalhe + ponto do mapa → local no mesmo formato da lista, com a distância a partir da origem.
export function pointToPlace(row, pt, origin) {
  const m = row?.municipalities ?? {};
  return normalizeCnes({
    ...row, cnes: row?.cnes ?? pt.cnes, city: m.name ?? null, uf: m.uf ?? null, city_code: m.cnes_code ?? null, lat: pt.lat, lng: pt.lng,
  }, origin);
}

// Paginação da lista do cadastro oficial. view: quantas linhas aparecem; loaded: linhas já baixadas (sem
// repetir); served: linhas que o banco já mandou (a próxima página começa aí); exhausted: o banco não tem
// mais; total: total da área (null se ainda não se sabe). Devolve quantas aparecem e quantas vêm no
// próximo "Ver mais" (0 = não há mais).
export function pagerState({ view, loaded, served, exhausted }, total = null, page = 50) {
  const visible = Math.min(view, loaded);
  const ready = Math.max(0, loaded - visible);
  const remote = exhausted ? 0 : total != null ? Math.max(0, total - served) : page;
  const next = Math.min(page, ready + remote);
  return { visible, next, more: next > 0, fetch: ready < next };
}

// Texto do botão: "Ver mais 50 (de 3.158)". Sem o total conhecido, só "Ver mais 50".
export const moreLabel = (next, total = null) => `Ver mais ${next}${total != null ? ` (de ${formatCount(total)})` : ''}`;

export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');
export const isValidPhone = (digits) => /^[1-9]{2}(9\d{8}|[2-8]\d{7})$/.test(digits);
export const isValidEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v).trim()) && String(v).trim().length <= 254;
export const isCep = (v) => /^\s*\d{5}-?\d{3}\s*$/.test(v);

export function maskPhone(v) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function telHref(phone) {
  const raw = String(phone ?? '').trim();
  let d = raw.replace(/[^\d+]/g, '');
  if (!d.replace('+', '')) return null;
  if (!d.startsWith('+') && /^0(300|500|800|900)/.test(d)) return `tel:${d}`;
  if (!d.startsWith('+')) d = d.replace(/^0/, '');
  if (!d.startsWith('+') && (d.length === 10 || d.length === 11)) d = `+55${d}`;
  return `tel:${d}`;
}

export const whatsappHref = (digits, text) => `https://wa.me/${onlyDigits(digits)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const directionsUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;

// Datas no fuso de São Paulo, o mesmo que o banco usa para validar o pedido.
export function spDate(offsetDays = 0, now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now + offsetDays * 86400000));
}

export function formatDateLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

export const protocolFromId = (id) => `IMED-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export const PERIODS = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite', qualquer: 'Qualquer horário' };
export const BOOKING_DAYS = 90;

/* ======================= avisos de confiança do pedido (busca e página do local) ======================= */
// Só fatos verdadeiros. Se algum deixar de valer (ex.: o IMED passar a cobrar ou a usar anúncios), mude aqui
// e na política de privacidade (privacidade.html).
export const TRUST = {
  sos: 'Emergência? Ligue <a href="tel:192">192 (SAMU)</a> ou vá ao pronto-socorro mais próximo.',
  sosPedido: 'O pedido não é para emergência. Emergência? Ligue <a href="tel:192">192 (SAMU)</a> ou vá ao pronto-socorro.',
  gratis: '<b>O IMED é gratuito para você.</b> Se houver cobrança pelo exame, o pagamento é feito direto no local. O IMED nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp.',
  privacidade: 'Seus dados vão só para o IMED e para o local escolhido · ficam em servidor no Brasil · sem anúncios e sem rastreadores de anúncio · sua localização é aproximada e não é gravada.',
  cnes: 'O IMED é um serviço privado, sem vínculo com o governo ou o SUS.',
  // Unidade pública do SUS só marca pela regulação do SUS: o IMED não consegue confirmar esse pedido.
  sus: 'O pedido é para atendimento particular ou por convênio. Unidades públicas do SUS não agendam pelo IMED: para ser atendido pelo SUS, procure a sua Unidade Básica de Saúde (UBS).',
};
export const susHTML = () => `<p class="sus"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>${TRUST.sus}</span></p>`;
export const sosHTML = (text = TRUST.sos) => `<p class="sos"><i class="fa-solid fa-truck-medical" aria-hidden="true"></i><span>${text}</span></p>`;
export const gratisHTML = () => `<p class="free"><i class="fa-solid fa-shield-heart" aria-hidden="true"></i><span>${TRUST.gratis}</span></p>`;
export const privacidadeHTML = () => `<p class="priv"><i class="fa-solid fa-lock" aria-hidden="true"></i><span>${TRUST.privacidade}</span></p>`;
// Bloco perto do botão de enviar: gratuito (contra golpes) e privacidade.
export const trustHTML = () => `<div class="trust">${gratisHTML()}${privacidadeHTML()}</div>`;

// v.slot (horário exato, ISO) troca a data e o período: vale para clínica parceira com agenda.
export function validateBooking(v, today = spDate(0), maxDate = spDate(BOOKING_DAYS)) {
  const err = {};
  if (!v.exam) err.exam = 'Escolha o exame ou o tipo de atendimento.';
  if (v.slot) {
    const t = spDateTime(v.slot);
    if (!t || t.date < today || t.date > maxDate) err.slot = 'Escolha um dos horários livres.';
  } else {
    if (!v.date) err.date = 'Escolha a data que prefere.';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || v.date < today || v.date > maxDate) err.date = `Escolha uma data entre hoje e os próximos ${BOOKING_DAYS} dias.`;
    if (!PERIODS[v.period]) err.period = 'Escolha um período.';
  }
  // Exame para outra pessoa: nome dela e parentesco; menor de 18 anos só com a autorização do responsável legal.
  if (v.forOther) {
    const other = String(v.otherName ?? '').trim().replace(/\s+/g, ' ');
    if (other.length < 2) err.otherName = 'Digite o nome de quem vai fazer o exame.';
    else if (other.length > 120) err.otherName = 'Use até 120 caracteres.';
    if (!RELATIONSHIPS.includes(v.relationship)) err.relationship = 'Escolha o parentesco.';
    if (v.otherMinor && !v.guardianConsent) err.guardian = 'Para menor de 18 anos, marque a autorização do pai, da mãe ou do responsável legal.';
    // Maior de idade: o exame é dado de saúde DELA. Quem pede confirma que ela sabe e concordou (LGPD, art. 11).
    if (!v.otherMinor && !v.otherConsent) err.otherConsent = 'Confirme que essa pessoa sabe do pedido e concordou (ou que você é o representante legal dela).';
  }
  if (String(v.name ?? '').trim().length < 2) err.name = 'Digite seu nome.';
  if (!isValidPhone(onlyDigits(v.phone))) err.phone = 'Digite um celular com DDD, por exemplo (11) 98765-4321.';
  if (v.email && !isValidEmail(v.email)) err.email = 'Confira o e-mail ou deixe em branco.';
  if (String(v.notes ?? '').length > 500) err.notes = 'Use até 500 caracteres.';
  if (!v.consent) err.consent = 'Para enviar, autorize o uso dos dados para o agendamento.';
  return err;
}

/* ======================= pedido para outra pessoa (filho, pai idoso...) ======================= */
// Parentesco de quem vai fazer o exame com quem faz o pedido.
export const RELATIONSHIPS = ['Filho ou filha', 'Pai ou mãe', 'Cônjuge ou companheiro(a)', 'Irmão ou irmã', 'Avô ou avó', 'Neto ou neta', 'Outro parente', 'Pessoa de quem cuido', 'Outra relação'];

// Pergunta "O exame é para: mim / outra pessoa" do formulário de pedido (página do local e busca).
// Os campos de outra pessoa ficam escondidos até a pessoa escolher "Outra pessoa" (forWhomToggle).
export function forWhomHTML() {
  const rel = RELATIONSHIPS.map((r) => `<option value="${r}">${r}</option>`).join('');
  return `<fieldset class="fld" data-f="forwho"><legend>O exame é para</legend>
      <div class="seg"><label><input type="radio" name="para" value="mim" checked><span>Mim</span></label><label><input type="radio" name="para" value="outra"><span>Outra pessoa</span></label></div></fieldset>
    <div class="bk-other" data-other hidden>
      <div class="fld" data-f="otherName"><label for="bkOtherName">Nome de quem vai fazer o exame</label>
        <input id="bkOtherName" name="outro_nome" autocomplete="off" maxlength="120"><span class="err" id="e-otherName"></span></div>
      <div class="fld" data-f="relationship"><label for="bkRel">Essa pessoa é seu (sua)</label>
        <select id="bkRel" name="parentesco"><option value="">Escolha o parentesco</option>${rel}</select><span class="err" id="e-relationship"></span></div>
      <label class="consent minor" data-f="otherMinor"><input type="checkbox" name="menor"><span>Tem menos de 18 anos</span></label>
      <label class="consent" data-f="guardian" data-guardian hidden><input type="checkbox" name="responsavel"><span>Sou o pai, a mãe ou o responsável legal e autorizo o IMED a usar os dados dele(a), incluindo o exame, só para este agendamento (LGPD, art. 14).</span></label>
      <span class="err bk-gerr" id="e-guardian"></span>
      <label class="consent" data-f="otherConsent" data-adult><input type="checkbox" name="concorda"><span>Essa pessoa sabe deste pedido e concordou que eu passe o nome dela e o exame ao IMED, só para este agendamento (ou sou o representante legal dela).</span></label>
      <span class="err bk-gerr" id="e-otherConsent"></span>
    </div>`;
}
// Mostra ou esconde os campos de outra pessoa e a autorização do responsável (chamar no "change" do formulário).
export function forWhomToggle(form) {
  const other = form.querySelector('input[name="para"]:checked')?.value === 'outra';
  const box = form.querySelector('[data-other]');
  if (box) box.hidden = !other;
  const minor = !!form.elements.menor?.checked;
  const g = form.querySelector('[data-guardian]');
  if (g) g.hidden = !(other && minor);
  // Maior de idade: a confirmação de que a pessoa sabe e concordou; menor: a autorização do responsável (acima).
  const adult = form.querySelector('[data-adult]');
  if (adult) adult.hidden = !(other && !minor);
}
// Valores do formulário para validateBooking/bookingRow.
export function forWhomValues(fd) {
  const forOther = fd.get('para') === 'outra';
  return forOther
    ? { forOther, otherName: String(fd.get('outro_nome') ?? ''), relationship: String(fd.get('parentesco') ?? ''), otherMinor: fd.get('menor') === 'on', guardianConsent: fd.get('responsavel') === 'on', otherConsent: fd.get('concorda') === 'on' }
    : { forOther: false };
}

// extra: campos a mais do pedido (por exemplo, review_token_hash).
export function bookingRow(place, v, id, extra = {}) {
  const imed = place.source === 'imed';
  const notes = String(v.notes ?? '').trim();
  const email = String(v.email ?? '').trim().toLowerCase();
  // Com horário: o banco confere se está livre e já grava o pedido como confirmado.
  const slot = v.slot ? spDateTime(v.slot) : null;
  return {
    id,
    clinic_id: imed ? place.clinic_id : null,
    place_source: place.source,
    place_ref: imed ? null : place.id.slice(0, 200),
    place_name: place.name.slice(0, 200),
    place_address: place.address ? place.address.slice(0, 300) : null,
    place_phone: place.phone ? place.phone.slice(0, 30) : null,
    exam_code: v.exam,
    preferred_date: slot ? slot.date : v.date,
    preferred_period: slot ? periodOfTime(slot.time) : v.period,
    patient_name: String(v.name).trim().replace(/\s+/g, ' ').slice(0, 120),
    patient_phone: onlyDigits(v.phone),
    patient_email: email || null,
    notes: notes ? notes.slice(0, 500) : null,
    consent: true,
    ...(slot ? { slot_start: new Date(v.slot).toISOString() } : {}),
    // Só vai quando o exame é para outra pessoa: pedidos comuns ficam iguais aos de antes.
    ...(v.forOther ? {
      for_other: true,
      other_name: String(v.otherName ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
      relationship: String(v.relationship ?? '').slice(0, 60),
      other_minor: !!v.otherMinor,
      guardian_consent: !!(v.otherMinor && v.guardianConsent),
      other_consent: !!(!v.otherMinor && v.otherConsent),
    } : {}),
    ...extra,
  };
}

// Preparo resumido por exame, para o lembrete da agenda. O guia do exame e o local têm a orientação completa.
export const PREP = {
  rx: 'Use roupa confortável, sem peças de metal. Avise se houver chance de gravidez.',
  usg: 'O preparo muda conforme a parte do corpo (por exemplo, jejum para abdome ou bexiga cheia para pelve). Confirme com o local.',
  tc: 'Se o exame usar contraste, pode ser preciso ficar algumas horas em jejum. Avise sobre alergias, problemas nos rins ou gravidez.',
  rm: 'Retire objetos de metal. Avise se tiver marca-passo, implantes de metal, medo de lugar fechado ou chance de gravidez.',
  mamo: 'No dia, não passe desodorante, talco ou creme nas mamas e axilas. Leve as mamografias anteriores.',
  dens: 'Evite suplemento de cálcio nas 24 horas antes e roupas com metal. Avise se fez exame com contraste há pouco tempo.',
  ecg: 'Não precisa de jejum. Evite passar creme no peito no dia do exame.',
  eco: 'Em geral não precisa de jejum nem de preparo especial. Confirme com o local.',
  lab: 'Alguns exames pedem jejum (em geral de 8 a 12 horas). Confirme no pedido médico ou com o laboratório.',
  consulta: 'Leve documento com foto, a carteirinha do convênio (se tiver) e exames anteriores.',
  outro: 'Confirme com o local se há algum preparo.',
};

// Situação do pedido para o paciente. As 7 da agenda nova (fase 4.2, R2-16) sobem antes de o painel criar essas
// situações: reserva, pagamento, chegada, atendimento, falta, remarcação e reserva expirada.
const STATUS_PT = {
  pending: 'Aguardando contato', pendente: 'Aguardando contato', contacted: 'Em contato', confirmed: 'Confirmado', confirmado: 'Confirmado',
  cancelled: 'Cancelado', completed: 'Concluído',
  hold: 'Reserva temporária', awaiting_payment: 'Aguardando pagamento', checked_in: 'Chegada registrada', in_service: 'Em atendimento',
  no_show: 'Não compareceu', reschedule_requested: 'Remarcação solicitada', expired: 'Reserva expirada',
};
export const statusLabel = (status) => STATUS_PT[status] ?? '';

// Faixas de horário do pedido na agenda (fuso de São Paulo). "qualquer" vira evento de dia inteiro.
const ICS_HOURS = { manha: ['08', '12'], tarde: ['13', '18'], noite: ['18', '21'] };
const icsEscape = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

// Quebra linhas com mais de 75 bytes, como pede o formato iCalendar (RFC 5545).
function icsFold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '', size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const nextDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

// Arquivo .ics com o pedido (dia inteiro ou faixa do período) e lembrete um dia antes.
// Com slot (horário exato, ISO): evento na hora marcada, em UTC (o calendário do celular mostra na hora certa em
// qualquer fuso), do início ao fim real (slotEnd, ISO; sem ele, `minutes` minutos), já confirmado.
// confirmed: o local já confirmou (padrão: só quando há horário marcado). Sem confirmação, o título leva
// " (a confirmar)", para a pessoa não ir achando que já está marcado.
export const A_CONFIRMAR = ' (a confirmar)';
export function icsTitle(title, confirmed) {
  const t = String(title ?? '');
  return confirmed || t.endsWith(A_CONFIRMAR) ? t : t + A_CONFIRMAR;
}
const icsUtc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function icsFile({ id, title, date, period, slot = null, slotEnd = null, confirmed = null, minutes = 30, description = '', url = '' }, now = Date.now()) {
  const start = slot ? Date.parse(slot) : NaN;
  if (slot && !Number.isFinite(start)) throw new Error('horário inválido');
  const at = slot ? spDateTime(slot) : null;
  if (at) date = at.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('data inválida');
  const day = date.replace(/-/g, '');
  const stamp = icsUtc(now);
  const endMs = at ? (Date.parse(slotEnd ?? '') > start ? Date.parse(slotEnd) : start + minutes * 60000) : null;
  const h = at ? null : ICS_HOURS[period];
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IMED//Pedidos de agendamento//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  ];
  if (h) {
    lines.push('BEGIN:VTIMEZONE', 'TZID:America/Sao_Paulo', 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
      'TZOFFSETFROM:-0300', 'TZOFFSETTO:-0300', 'TZNAME:-03', 'END:STANDARD', 'END:VTIMEZONE');
  }
  lines.push('BEGIN:VEVENT', `UID:${icsEscape(id || stamp)}@imed`, `DTSTAMP:${stamp}`);
  if (at) lines.push(`DTSTART:${icsUtc(start)}`, `DTEND:${icsUtc(endMs)}`);
  else if (h) lines.push(`DTSTART;TZID=America/Sao_Paulo:${day}T${h[0]}0000`, `DTEND;TZID=America/Sao_Paulo:${day}T${h[1]}0000`);
  else lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${nextDay(date).replace(/-/g, '')}`);
  const sure = confirmed ?? !!at;
  const summary = icsTitle(title, sure);
  lines.push(`SUMMARY:${icsEscape(summary)}`);
  if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
  if (url) lines.push(`URL:${String(url).replace(/[\r\n]/g, '')}`);
  lines.push(sure ? 'STATUS:CONFIRMED' : 'STATUS:TENTATIVE', 'TRANSP:OPAQUE',
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(`Amanhã: ${summary}`)}`, 'TRIGGER:-P1D', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/* ======================= horários com hora marcada (agenda das clínicas parceiras) ======================= */
// Fuso padrão (o da maioria das clínicas e o do banco para pedidos sem horário). A agenda nova (fase 5.1) mostra
// sempre o horário no fuso da UNIDADE (clinics.timezone, vindo de agenda_public_info), qualquer que seja o do aparelho.
export const SP_TZ = 'America/Sao_Paulo';
const TZ_FMT = new Map();
function tzFormat(tz) {
  let f = TZ_FMT.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    TZ_FMT.set(tz, f);
  }
  return f;
}
// Fuso válido (nome IANA que o navegador conhece); outro valor vira o de São Paulo.
export function validTz(tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(tz)) return SP_TZ;
  try { tzFormat(tz); return tz; } catch { return SP_TZ; }
}

// Dia e hora de um instante num fuso: { date: 'AAAA-MM-DD', time: 'HH:MM' }. Inválido: null.
export function zonedDateTime(iso, tz = SP_TZ) {
  const d = new Date(iso);
  if (iso == null || iso === '' || Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(tzFormat(validTz(tz)).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
// Dia e hora de um instante no fuso de São Paulo.
export const spDateTime = (iso) => zonedDateTime(iso, SP_TZ);

export const periodOfTime = (hhmm) => (hhmm < '12:00' ? 'manha' : hhmm < '18:00' ? 'tarde' : 'noite');

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
// Data de hoje + offsetDays num fuso, como 'AAAA-MM-DD'.
export const zonedDate = (offsetDays = 0, now = Date.now(), tz = SP_TZ) => addDays(zonedDateTime(now, tz).date, offsetDays);

// Próximos n dias (a partir de hoje, no fuso; padrão: São Paulo), como 'AAAA-MM-DD'.
export const nextDays = (n, now = Date.now(), tz = SP_TZ) => Array.from({ length: n }, (_, i) => zonedDate(i, now, tz));

// Horários livres (linhas de agenda_slots ou available_slots) agrupados por dia no fuso da unidade, em ordem.
// Cada horário: { iso, time, end } (end: fim real do exame, ISO, quando o banco manda).
export function groupSlots(rows, tz = SP_TZ) {
  const byDay = new Map();
  const seen = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const iso = r?.slot_start;
    const t = zonedDateTime(iso, tz);
    if (!t) continue;
    const key = new Date(iso).toISOString();
    if (seen.has(key)) continue;
    seen.add(key);
    const endMs = Date.parse(r?.slot_end ?? '');
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push({ iso: key, time: t.time, end: endMs > Date.parse(key) ? new Date(endMs).toISOString() : null });
  }
  for (const list of byDay.values()) list.sort((a, b) => a.iso.localeCompare(b.iso));
  return byDay;
}

// Aba do dia: { wd: 'qui', day: '05/11' }.
export function dayTab(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
  return { wd, day: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}` };
}

// "quinta-feira, 05 de novembro às 09:30" (no fuso da unidade; padrão: São Paulo).
export function formatSlot(iso, tz = SP_TZ) {
  const t = zonedDateTime(iso, tz);
  return t ? `${formatDateLong(t.date)} às ${t.time}` : '';
}

// Nome do fuso para o paciente: "horário de Brasília", "horário de Manaus"...
const TZ_CITY = {
  'America/Sao_Paulo': 'Brasília', 'America/Bahia': 'Brasília', 'America/Fortaleza': 'Brasília', 'America/Recife': 'Brasília',
  'America/Maceio': 'Brasília', 'America/Belem': 'Brasília', 'America/Araguaina': 'Brasília', 'America/Santarem': 'Brasília',
  'America/Manaus': 'Manaus', 'America/Cuiaba': 'Cuiabá', 'America/Campo_Grande': 'Campo Grande', 'America/Porto_Velho': 'Porto Velho',
  'America/Boa_Vista': 'Boa Vista', 'America/Rio_Branco': 'Rio Branco', 'America/Eirunepe': 'Eirunepé', 'America/Noronha': 'Fernando de Noronha',
};
export const tzLabel = (tz) => `horário de ${TZ_CITY[validTz(tz)] ?? validTz(tz).split('/').pop().replace(/_/g, ' ')}`;
// O fuso do aparelho mostra outra hora para este instante? (então a tela escreve de qual horário se trata)
export function tzDiffers(iso, tz, deviceTz) {
  let dev = deviceTz;
  try { dev ??= Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { dev = SP_TZ; }
  const a = zonedDateTime(iso, tz);
  const b = zonedDateTime(iso, dev || SP_TZ);
  return !!a && !!b && (a.date !== b.date || a.time !== b.time);
}

// "Próximo horário livre": "hoje às 14:30", "amanhã às 08:00" ou "qui 05/11 às 09:30" (no fuso da unidade).
export function nextFreeText(iso, tz = SP_TZ, now = Date.now()) {
  const t = zonedDateTime(iso, tz);
  if (!t) return '';
  const today = zonedDate(0, now, tz);
  if (t.date === today) return `hoje às ${t.time}`;
  if (t.date === addDays(today, 1)) return `amanhã às ${t.time}`;
  const d = dayTab(t.date);
  return `${d.wd} ${d.day} às ${t.time}`;
}

// Duração do exame em minutos ("30 min", "1 h 15 min").
export function durationText(min) {
  const n = Math.round(Number(min));
  if (!Number.isFinite(n) || n <= 0) return '';
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/* ======================= Horário direto (iMed Agenda 5.1): marcar no motor novo ======================= */
// Modalidades em que o paciente marca sozinho e sai confirmado na hora (arquitetura §8): a agenda do IMED (nativa) e
// a assistida com o compromisso da clínica (manual). A externa depende da integração (fase 6): por enquanto, pedido.
export const DIRECT_MODES = ['nativa', 'manual'];
// Procedimentos que dá para marcar pelo site, a partir de agenda_public_info. Venda desligada (online false),
// modalidade sem horário direto ou resposta estranha: lista vazia (a página fica no pedido, como antes).
export function bookableProcedures(info) {
  if (!info || info.status !== 'ok' || info.online !== true || !DIRECT_MODES.includes(info.mode)) return [];
  return (Array.isArray(info.procedures) ? info.procedures : [])
    .filter((p) => p && isUuid(p.id) && typeof p.name === 'string' && p.name.trim() && Number(p.duration_min) > 0)
    .map((p) => ({
      id: p.id.toLowerCase(), exam: typeof p.exam_code === 'string' ? p.exam_code : '', name: p.name.trim().slice(0, 120),
      minutes: Math.round(Number(p.duration_min)),
      price_cents: Number.isInteger(p.price_cents) && p.price_cents >= 0 ? p.price_cents : null,
      prep: typeof p.prep_text === 'string' && p.prep_text.trim() ? p.prep_text.trim().slice(0, 500) : '',
      fasting: Number.isInteger(p.fasting_hours) && p.fasting_hours > 0 ? p.fasting_hours : null,
    }));
}
// Procedimento inicial: o do exame pedido (?exame=), senão o primeiro.
export function pickProcedure(procs, exam = '') {
  return procs.find((p) => exam && p.exam === exam) ?? procs[0] ?? null;
}
// Rótulo do procedimento na lista: "Ressonância · R$ 450,00 · 30 min" (sem preço: "preço sob consulta").
export const procedureLabel = (p) => [p.name, p.price_cents != null ? formatPrice(p.price_cents) : 'preço sob consulta', durationText(p.minutes)].filter(Boolean).join(' · ');

// Intenção de marcar (§3.2, item 7): o id e o código do agendamento são gerados UMA vez por intenção (clínica,
// procedimento e horário) e gravados no aparelho ANTES do envio. Se a resposta se perde (internet caiu) e a pessoa
// toca em "Tentar de novo", vão os mesmos: o banco devolve o mesmo agendamento, sem marcar duas vezes. Depois de
// slot_taken, ou ao trocar de horário ou de exame, a intenção é outra: id novo.
export const INTENT_KEY = 'imed_intencao';
export const intentKey = ({ clinic, procedure, slot }) => [clinic, procedure, new Date(slot).toISOString()].join('|');
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export function newIntent(key, now = Date.now(), rnd = globalThis.crypto) {
  return { key, id: rnd.randomUUID(), token: hex(rnd.getRandomValues(new Uint8Array(32))), created: new Date(now).toISOString() };
}
// A intenção guardada só vale para o mesmo horário, com id e código bem formados e de no máximo 1 dia.
export function intentFor(stored, key, now = Date.now()) {
  if (!stored || typeof stored !== 'object' || stored.key !== key || !isUuid(stored.id) || !/^[0-9a-f]{64}$/.test(stored.token ?? '')) return null;
  const age = now - Date.parse(stored.created ?? '');
  return age >= 0 && age < 86400000 ? stored : null;
}

// Argumentos de agenda_book (o paciente marca: confere, reserva e confirma de uma vez). Só os campos que o banco aceita.
export function agendaBookArgs(place, v, intent) {
  const email = String(v.email ?? '').trim().toLowerCase();
  return {
    p_clinic: place.clinic_id,
    p_items: [{ procedure_id: v.procedureId, starts_at: new Date(v.slot).toISOString() }],
    p_patient: {
      name: String(v.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
      phone: onlyDigits(v.phone),
      ...(email ? { email } : {}),
      consent: true,
      ...(v.forOther ? {
        for_other: true,
        other_name: String(v.otherName ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
        relationship: String(v.relationship ?? '').slice(0, 60),
        other_minor: !!v.otherMinor,
        guardian_consent: !!(v.otherMinor && v.guardianConsent),
        other_consent: !!(!v.otherMinor && v.otherConsent),
      } : {}),
    },
    p_id: intent.id,
    p_token: intent.token,
  };
}

// O que fazer com a resposta de agenda_book:
//   ok      confirmado (slot e end: o horário gravado);   taken   o horário acabou de ser pego (id novo, outros horários);
//   limit   limite de agendamentos por vir deste celular;   closed  a clínica parou de vender online (vira pedido);
//   invalid dados recusados;   retry   o id já foi usado para outro horário (id novo e tentar de novo);
//   error   resposta estranha (mantém a intenção: o reenvio é seguro).
export function bookOutcome(res) {
  const st = res && typeof res === 'object' ? res.status : null;
  if (st === 'ok') return { kind: 'ok', slot: res.slot_start ?? null, end: res.slot_end ?? null, replay: res.replay === true };
  if (st === 'slot_taken') return { kind: 'taken', alternatives: Array.isArray(res.alternatives) ? res.alternatives.filter((x) => Number.isFinite(Date.parse(x))) : [] };
  if (st === 'too_many_bookings') return { kind: 'limit' };
  if (['not_online', 'agenda_not_started', 'not_found'].includes(st)) return { kind: 'closed' };
  if (['invalid_patient', 'consent_required', 'invalid', 'invalid_package'].includes(st)) return { kind: 'invalid' };
  if (st === 'idempotency_conflict') return { kind: 'retry' };
  return { kind: 'error' };
}
export const BOOK_MSG = {
  taken: 'Este horário acabou de ser ocupado por outra pessoa. Escolha outro horário abaixo.',
  limit: 'Este celular já tem o máximo de agendamentos por vir nesta clínica. Para marcar outro, cancele um em Meus pedidos ou ligue para a clínica.',
  closed: 'A clínica não está marcando horário pelo site agora. Envie um pedido: a clínica ou o IMED liga para combinar o horário.',
  invalid: 'O agendamento não foi aceito. Confira os dados e tente de novo.',
  retry: 'Não deu para confirmar este horário. Toque em Confirmar de novo.',
  error: 'Não foi possível confirmar agora. Verifique sua internet e toque em Tentar de novo: o mesmo pedido é reenviado, sem marcar duas vezes.',
};

// A gravação recusou porque o MESMO id já foi gravado (reenvio de um pedido que já tinha chegado): não é horário
// ocupado. O PostgREST manda o nome da chave na mensagem.
export function isDuplicateId(err) {
  const d = err?.data && typeof err.data === 'object' ? err.data : err;
  return (d?.code ?? err?.code) === '23505' && /appointment_requests_pkey/.test(`${d?.message ?? ''} ${d?.details ?? ''}`);
}
// O banco recusa o horário que acabou de ser ocupado (23P01) ou que outra pessoa pegou ao mesmo tempo (23505 de outra
// chave; 409 do PostgREST); a resposta slot_taken de agenda_book também conta. Id repetido (chave primária) não conta.
export function isSlotTaken(err) {
  if (err?.status === 'slot_taken') return true;
  if (isDuplicateId(err)) return false;
  const code = err?.data?.code ?? err?.code;
  return err?.status === 409 || code === '23P01' || code === '23505';
}

export const examLabel = (c) => EXAMS[c]?.n ?? (c === 'consulta' ? 'Consulta' : 'Outro atendimento');

// Resumo do pedido guardado no aparelho (imed_appts), lido pela página inicial e pela conta. phone: telefone do
// local (o mesmo que vai no pedido), para lembrar a pessoa de avisar o local se cancelar um horário já combinado.
// Com horário (agenda nova): o fim real (slot_end), o fuso da unidade (tz) e o nome do procedimento (v.procName).
export function localAppt(p, v, id, token, now = Date.now()) {
  const tz = validTz(v.tz);
  const at = v.slot ? zonedDateTime(v.slot, tz) : null;
  const end = at && Date.parse(v.slotEnd ?? '') > Date.parse(v.slot) ? new Date(v.slotEnd).toISOString() : null;
  return {
    type: 'pedido', code: protocolFromId(id), id, token, place_key: p.id, name: p.name,
    ...(p.phone ? { phone: String(p.phone).slice(0, 30) } : {}),
    exam: Object.hasOwn(PREP, v.exam ?? '') ? v.exam : null, items: [v.procName ? String(v.procName).slice(0, 120) : examLabel(v.exam)],
    date: at ? at.date : v.date, period: at ? periodOfTime(at.time) : v.period,
    ...(at ? { slot: new Date(v.slot).toISOString(), ...(end ? { slot_end: end } : {}), tz } : {}),
    status: at ? 'confirmado' : 'pendente', created: new Date(now).toISOString(),
  };
}

// Lembrete .ics do pedido (ou do horário confirmado), com o preparo do exame (o da clínica, quando ela informou).
export function bookingIcs(p, v, id, site, now = Date.now()) {
  const guide = EXAMS[v.exam]?.slug;
  const name = v.procName || examLabel(v.exam);
  const title = v.exam === 'consulta' || v.exam === 'outro' ? `${name} — ${p.name}` : `Exame: ${name} — ${p.name}`;
  const tz = validTz(v.tz);
  const prep = v.prep || PREP[v.exam];
  const description = [
    `${v.slot ? 'Agendamento' : 'Pedido'} ${protocolFromId(id)} · ${p.name}${p.address ? ` · ${p.address}` : ''}`,
    v.slot ? `Horário: ${formatSlot(v.slot, tz)} (${tzLabel(tz)}).` : '',
    prep ? `Preparo: ${prep}` : '',
    v.slot ? 'Horário confirmado na agenda da clínica. Chegue com 15 minutos de antecedência.' : 'Confirme o horário com o IMED. O horário só fica garantido depois da confirmação.',
    guide ? `Guia do exame: ${site}exames/${guide}.html#preparo` : '',
    `IMED: ${site}`,
  ].filter(Boolean).join('\n');
  return icsFile({ id, title, date: v.date, period: v.period, slot: v.slot || null, slotEnd: v.slotEnd || null, description, url: site }, now);
}

/* ======================= página de cada local (local.html) ======================= */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isCnesCode = (v) => /^\d{7}$/.test(String(v ?? ''));
export const isUuid = (v) => UUID_RE.test(String(v ?? ''));

// "cnes:1234567" ou "imed:<uuid>" → { source, key }; outra coisa → null.
export function parseLocalRef(v) {
  const m = /^(cnes|imed):(.+)$/.exec(String(v ?? '').trim());
  if (!m) return null;
  if (m[1] === 'cnes' && isCnesCode(m[2])) return { source: 'cnes', key: m[2] };
  if (m[1] === 'imed' && isUuid(m[2])) return { source: 'imed', key: m[2].toLowerCase() };
  return null;
}

// Endereço da página completa de um local (só cadastro oficial e parceiros têm página).
export function localUrl(p) {
  if (p?.source === 'cnes' && isCnesCode(p.id.slice(5))) return `local.html?cnes=${p.id.slice(5)}`;
  if (p?.source === 'imed' && isUuid(p.clinic_id)) return `local.html?id=${p.clinic_id}`;
  return null;
}

export const ESTABLISHMENT_SELECT = 'cnes,name,legal_name,kind,address_line,neighborhood,cep,phone,shift,open_24h,sus,services,specialties,cnes_updated_at,location_source,location,city_ibge,equip_exams,equip_exams_sus,equip_competencia,municipalities(name,uf,cnes_code)';
export const CLINIC_SELECT = '*,clinic_exams(exam_code,price_cents,price_updated_at)';

// Consultas REST (PostgREST) para abrir um local pela referência.
export function localPaths(ref) {
  if (ref?.source === 'cnes') {
    return {
      main: `establishments?select=${ESTABLISHMENT_SELECT}&cnes=eq.${ref.key}`,
      partner: `clinics?select=id&cnes=eq.${ref.key}&status=eq.published`,
    };
  }
  if (ref?.source === 'imed') return { main: `clinics?select=${CLINIC_SELECT}&id=eq.${ref.key}&status=eq.published` };
  return null;
}

// Ponto vindo do banco: GeoJSON (objeto ou texto) ou EWKB em hexadecimal. Sem coordenadas válidas: null.
export function pointFromGeo(g) {
  let lng, lat;
  if (typeof g === 'string' && /^\s*\{/.test(g)) { try { g = JSON.parse(g); } catch { return null; } }
  if (g && typeof g === 'object' && g.type === 'Point' && Array.isArray(g.coordinates)) [lng, lat] = g.coordinates.map(Number);
  else if (typeof g === 'string' && /^[0-9a-f]+$/i.test(g) && g.length >= 42) {
    const bytes = new Uint8Array(g.match(/../g).map((h) => parseInt(h, 16)));
    const dv = new DataView(bytes.buffer);
    const le = bytes[0] === 1;
    const type = dv.getUint32(1, le);
    if ((type & 0xff) !== 1) return null;
    const off = type & 0x20000000 ? 9 : 5;
    if (bytes.length < off + 16) return null;
    lng = dv.getFloat64(off, le); lat = dv.getFloat64(off + 8, le);
  } else return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

// Linha da tabela establishments (com municipalities) no mesmo formato da busca. Sem distância.
export function establishmentToPlace(r) {
  const pt = pointFromGeo(r.location);
  const m = r.municipalities ?? {};
  const p = normalizeCnes({ ...r, city: m.name ?? null, uf: m.uf ?? null, city_code: m.cnes_code ?? null, lat: pt?.lat ?? null, lng: pt?.lng ?? null }, pt ?? { lat: 0, lng: 0 });
  return { ...p, distance_m: null, city: m.name ?? null, uf: m.uf ?? null, legal_name: r.legal_name ?? null, sus: r.sus === true, susKnown: typeof r.sus === 'boolean' };
}

// Linha da tabela clinics (com clinic_exams) no mesmo formato da busca. Sem distância.
export function clinicToPlace(r) {
  const pt = pointFromGeo(r.location);
  const exams = (r.clinic_exams ?? []).filter((e) => EXAMS[e.exam_code]).sort((a, b) => a.exam_code.localeCompare(b.exam_code))
    .map((e) => ({ code: e.exam_code, price_cents: e.price_cents ?? null, price_updated_at: e.price_updated_at ?? null }));
  const p = normalizeImedRow({ ...r, exams, lat: pt?.lat ?? null, lng: pt?.lng ?? null }, pt ?? { lat: 0, lng: 0 });
  const priceDates = Object.fromEntries(exams.filter((e) => e.price_updated_at).map((e) => [e.code, e.price_updated_at]));
  return { ...p, distance_m: null, city: r.city ?? null, uf: r.state ?? null, priceDates, verified_at: r.verified_at ?? null };
}

// Título e descrição da página de um local, só com o que o cadastro tem.
export function localTitle(p) {
  return p.city && p.uf ? `${p.name} em ${p.city} - ${p.uf} | IMED` : `${p.name} | IMED`;
}
export function localDescription(p) {
  const where = [p.city && p.uf ? `${p.city} - ${p.uf}` : p.city].filter(Boolean).join('');
  const exams = p.services.filter((c) => EXAMS[c]).slice(0, 4).map((c) => EXAMS[c].n);
  const parts = [`${KINDS[p.kind]?.n ?? 'Estabelecimento de saúde'}${where ? ` em ${where}` : ''}.`];
  parts.push(`Endereço${p.phone ? ', telefone' : ''}${exams.length ? `, exames (${exams.join(', ')})` : ''} e como agendar pelo IMED.`);
  if (p.source === 'cnes' && p.sus) parts.push('Atende SUS.');
  return parts.join(' ').slice(0, 300);
}

const SCHEMA_TYPE = { hospital: 'Hospital', laboratorio: 'DiagnosticLab', imagem: 'DiagnosticLab', clinica: 'MedicalClinic' };
const dropEmpty = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));

// Dados estruturados (schema.org) do local. Nota só quando há avaliações reais publicadas.
export function localJsonLd(p, url, rating = null) {
  const street = p.source === 'cnes' ? p.address?.split(' · ')[0] : p.address?.split(' · ').slice(0, -1).join(', ');
  const ld = dropEmpty({
    '@context': 'https://schema.org',
    '@type': SCHEMA_TYPE[p.kind] ?? 'MedicalClinic',
    name: p.name,
    url,
    telephone: p.phone || null,
    sameAs: p.website || null,
    address: dropEmpty({
      '@type': 'PostalAddress', streetAddress: street || null, addressLocality: p.city || null, addressRegion: p.uf || null,
      postalCode: p.cep || null, addressCountry: 'BR',
    }),
    geo: Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng } : null,
    medicalSpecialty: p.specialties?.length ? p.specialties : null,
    isAcceptingNewPatients: p.source === 'imed' && p.accepts_online_booking ? true : null,
  });
  if (rating && Number(rating.reviews) > 0 && Number.isFinite(Number(rating.rating))) {
    ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: Number(rating.rating), reviewCount: Number(rating.reviews), bestRating: 5, worstRating: 1 };
  }
  return ld;
}

/* ======================= "Antes de ir: o que perguntar ao ligar" (locais que não são parceiros) ======================= */
// Para quem não é parceiro, o IMED não sabe o preparo, o prazo nem o preço: em vez de inventar a resposta, ensina a
// pergunta. Só perguntas, nunca respostas (nada de preço, nota, horário ou orientação de saúde). Os serviços do
// cadastro oficial são deduzidos pelo nome do local, por isso a primeira pergunta é sempre se ele faz o exame.

// Nome do exame na pergunta e o artigo dele ("Quanto custa a tomografia...").
const CALL_EXAM = {
  rx: ['raio-X', 'o'], usg: ['ultrassom', 'o'], tc: ['tomografia', 'a'], rm: ['ressonância magnética', 'a'],
  mamo: ['mamografia', 'a'], dens: ['densitometria óssea', 'a'], ecg: ['eletrocardiograma', 'o'], eco: ['ecocardiograma', 'o'],
};
export const CALL_TITLE = 'Antes de ir: o que perguntar ao ligar';
// Sem telefone informado não dá para ligar: a caixa ensina o que perguntar na recepção, se a pessoa for até lá.
export const CALL_TITLE_RECEPCAO = 'O que perguntar na recepção';
export const CALL_MSG = {
  ok: 'Perguntas copiadas. É só colar onde quiser.',
  // O aviso fica logo acima do quadro com o texto (no celular, um aviso embaixo do quadro ficava fora da tela).
  manual: 'Não foi possível copiar sozinho. As perguntas estão selecionadas no quadro abaixo: toque e segure o texto e escolha Copiar (no computador, Ctrl+C ou Cmd+C).',
};
// O pedido pelo IMED é só para atendimento particular ou por convênio (TRUST.sus). Onde a pergunta do SUS aparece
// (o cadastro oficial diz que o local atende pelo SUS), a caixa avisa, para ninguém achar que o IMED marca pelo SUS.
export const CALL_IMED = 'Se preferir, peça ao IMED para agendar por você.';
export const CALL_IMED_SUS = 'Se preferir, peça ao IMED para agendar por você (particular ou convênio). Pelo SUS, o agendamento começa no posto de saúde (UBS).';
const escHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// Que roteiro usar: exame de laboratório, outro exame (imagem, coração) ou consulta/exame sem tipo definido.
// O exame escolhido manda; sem ele, vale o tipo do local.
function callKind(p, exam) {
  if (exam === 'lab') return 'lab';
  if (exam) return 'exame';
  if (p.kind === 'laboratorio') return 'lab';
  return p.kind === 'imagem' ? 'exame' : 'geral';
}

// Perguntas para o local p (cadastro oficial ou mapa público), conforme o tipo dele e o exame escolhido (código de
// EXAMS; outro valor conta como nenhum). Parceiro (source 'imed'): nenhuma, porque ele mesmo informa preço e agenda.
// "Atendem pelo SUS?" só quando o cadastro oficial diz que o local atende pelo SUS (p.sus === true).
export function callQuestions(p, exam = '') {
  if (!p || p.source === 'imed') return [];
  const ex = Object.hasOwn(EXAMS, exam ?? '') ? exam : '';
  const kind = callKind(p, ex);
  const [name, art] = CALL_EXAM[ex] ?? [];
  const exams = kind !== 'geral';
  const q = [];
  const add = (id, text) => q.push({ id, text });
  if (kind === 'lab') add('faz', 'Vocês fazem todos os exames do meu pedido médico?');
  else if (name) add('faz', `Vocês fazem ${name}?`);
  else add('faz', exams ? 'Vocês fazem o exame do meu pedido médico?' : 'Vocês fazem o exame ou a consulta de que eu preciso?');
  if (hasEquip(p, ex)) add('aparelho', 'O aparelho atende pacientes de fora (não internados)?');
  add('agenda', 'Precisa agendar ou é por ordem de chegada?');
  if (kind === 'lab') add('preparo', 'Precisa de jejum? De quantas horas?');
  else add('preparo', name ? `Precisa de jejum ou de outro preparo para ${art} ${name}?` : 'Precisa de jejum ou de outro preparo?');
  add('convenio', exams ? 'Aceitam o meu convênio? Precisa pedir autorização ao plano antes?' : 'Aceitam o meu convênio?');
  if (p.sus === true) add('sus', 'Atendem pelo SUS? Precisa de encaminhamento do posto de saúde?');
  if (kind === 'lab') add('preco', 'Quanto custam os exames no particular?');
  else add('preco', name ? `Quanto custa ${art} ${name} no particular?` : 'Quanto custa no particular?');
  add('documentos', exams ? 'Que documentos preciso levar? Precisa do pedido médico?' : 'Que documentos preciso levar?');
  if (exams) add('resultado', 'Em quantos dias sai o resultado?');
  if (kind === 'lab' && p.kind === 'laboratorio') add('coleta', 'Fazem coleta em casa?');
  add('acesso', 'Tem acesso para cadeira de rodas?');
  return q;
}

// Texto do botão "Copiar as perguntas": o local (nome e telefone, se houver) e as perguntas numeradas.
export function callQuestionsText(p, exam = '') {
  const list = callQuestions(p, exam);
  if (!list.length) return '';
  const who = [p.name, p.phone].map((v) => String(v ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ');
  const how = telHref(p.phone) ? 'O que perguntar ao ligar:' : 'O que perguntar na recepção:';
  return [who, how, ...list.map((x, i) => `${i + 1}. ${x.text}`)].filter(Boolean).join('\n');
}

// Caixa fechada até o toque (<details>), na página do local e na ficha da busca. O botão "Copiar as perguntas"
// (data-act="copy-questions") chama copyCallQuestions. Ligar e Compartilhar já ficam nas ações do local.
// Sem telefone informado: o que perguntar na recepção, com o pedido ao IMED em destaque.
export function callQuestionsHTML(p, exam = '') {
  const list = callQuestions(p, exam);
  if (!list.length) return '';
  const ex = Object.hasOwn(EXAMS, exam ?? '') ? exam : '';
  const exams = callKind(p, ex) !== 'geral';
  const phone = !!telHref(p.phone);
  const text = callQuestionsText(p, ex);
  const imed = p.sus === true ? CALL_IMED_SUS : CALL_IMED;
  // id do aviso, para o quadro de texto apontar para ele (aria-describedby): só letras, números, "-" e "_".
  const msgId = `cq-msg-${String(p.id ?? '').replace(/[^\w-]/g, '-')}`;
  // "Não sabemos": o IMED tem guias de preparo em geral, mas não sabe o que ESTE local pede.
  const unknown = exams ? 'o preparo que ele pede, o prazo do resultado nem o preço' : 'como ele agenda, o preparo que pede nem o preço';
  const ask = phone
    ? `Ligue antes de ir${exams ? ', com o pedido médico em mãos,' : ''} e pergunte:`
    : `O telefone deste local não foi informado. Se for até lá, ${exams ? 'leve o pedido médico e ' : ''}pergunte na recepção:`;
  const foot = 'Só perguntas: as respostas vêm do próprio local. Sobre o preparo, siga também a orientação do seu médico.';
  return `<details class="cq">
      <summary><i class="fa-solid fa-list-check" aria-hidden="true"></i><span>${phone ? CALL_TITLE : CALL_TITLE_RECEPCAO}</span><i class="fa-solid fa-chevron-down cq-chev" aria-hidden="true"></i></summary>
      <div class="cq-body">
        <p>Este local ainda não é parceiro do IMED: não sabemos ${unknown}. ${ask}</p>
        <ol class="cq-list">${list.map((x) => `<li data-q="${x.id}">${escHTML(x.text)}</li>`).join('')}</ol>
        <p class="src">${foot}${phone ? ` ${imed}` : ''}</p>
        ${phone ? '' : `<p class="cq-imed"><i class="fa-solid fa-headset" aria-hidden="true"></i><span>${imed}</span></p>`}
        <div class="cq-acts"><button class="btn btn-ghost btn-sm" type="button" data-act="copy-questions"><i class="fa-solid fa-copy" aria-hidden="true"></i>Copiar as perguntas</button></div>
        <p class="cq-msg" id="${msgId}" role="status"></p>
        <textarea class="cq-txt" readonly hidden rows="${text.split('\n').length}" aria-label="Perguntas para copiar" aria-describedby="${msgId}">${escHTML(text)}</textarea>
      </div>
    </details>`;
}

// "Copiar as perguntas" (box: a caixa de callQuestionsHTML), em 3 tentativas:
// 1) a área de transferência do navegador;
// 2) sem ela (navegador antigo, navegador de dentro de aplicativo, permissão negada), o jeito antigo: seleciona o
//    texto e copia;
// 3) se nada der, o texto fica à mostra e selecionado, e o aviso logo acima dele diz como copiar. Os dois são
//    trazidos para a tela (no celular, o quadro aberto passava do fim da tela e escondia o aviso).
export async function copyCallQuestions(box) {
  const txt = box?.querySelector('.cq-txt');
  const msg = box?.querySelector('.cq-msg');
  if (!txt || !msg) return false;
  const say = (text, warn = false) => { msg.classList.toggle('warn', warn); msg.textContent = text; };
  say('');
  try {
    await navigator.clipboard.writeText(txt.value);
    txt.hidden = true;
    say(CALL_MSG.ok);
    return true;
  } catch { /* segue para o jeito antigo */ }
  txt.hidden = false;
  txt.focus({ preventScroll: true });
  txt.select();
  txt.setSelectionRange?.(0, txt.value.length);
  let copied = false;
  try { copied = document.execCommand('copy') === true; } catch { copied = false; }
  if (copied) {
    txt.hidden = true;
    box.querySelector('[data-act="copy-questions"]')?.focus({ preventScroll: true });
    say(CALL_MSG.ok);
    return true;
  }
  say(CALL_MSG.manual, true);
  txt.scrollIntoView?.({ block: 'nearest' });
  msg.scrollIntoView?.({ block: 'nearest' });
  return false;
}

/* ======================= contador de visitas próprio (assets/js/visitas.js) ======================= */
// Cidade da busca para o contador, como no cadastro do IBGE: "UF/Cidade" (ex.: "SP/São Paulo"). Vem da situação
// da cidade que o servidor devolve (coverage) ou, sem ela, do estabelecimento mais próximo da lista.
// Nada da posição da pessoa. Sem cidade conhecida: ''.
export function searchCity(coverage, rows = []) {
  const fmt = (city, uf) => {
    const c = String(city ?? '').trim().replace(/\s+/g, ' ');
    const u = String(uf ?? '').trim().toUpperCase();
    return c.length >= 2 && c.length <= 60 && !c.includes('/') && /^[A-Z]{2}$/.test(u) ? `${u}/${c}` : '';
  };
  const fromCoverage = fmt(coverage?.city, coverage?.uf);
  if (fromCoverage) return fromCoverage;
  const near = (Array.isArray(rows) ? rows : []).find((r) => fmt(r?.city, r?.uf));
  return near ? fmt(near.city, near.uf) : '';
}
