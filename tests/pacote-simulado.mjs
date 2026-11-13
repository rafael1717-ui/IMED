// Agenda SIMULADA de uma clínica parceira para os testes de "Vários exames no mesmo dia" (iMed Agenda 5.2). Não é um
// teste (o nome não começa com "e2e-"): é usada por tests/e2e-pacote.mjs e tests/e2e-a11y.mjs. Tudo aqui é inventado
// para o teste (clínica, exames, preços e horários): nada vem de clínica real.
// Imita o que o banco responde: agenda_public_info, agenda_slots, agenda_days, agenda_package_options (todas as ordens,
// cada exame no primeiro horário livre depois do anterior; menor espera, fim mais cedo, início mais cedo), agenda_book
// (1 a 4 itens, tudo ou nada; o mesmo id e código devolvem o mesmo resultado), agenda_my_booking, request_status e
// cancel_request.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../assets/js/geo-core.js';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const REST = 'https://pyoqiecupxhdzigjudyd.supabase.co/rest/v1/';
// Relógio fixo: segunda-feira, 16/11/2026, 09:00 em São Paulo.
export const NOW = '2026-11-16T12:00:00Z';
export const NOW_MS = Date.parse(NOW);
export const D1 = G.zonedDate(1, NOW_MS), D2 = G.zonedDate(2, NOW_MS), D3 = G.zonedDate(3, NOW_MS);
export const CLINICA = 'bbbbbbbb-0000-4000-8000-000000000021';
export const SEM_VENDA = 'bbbbbbbb-0000-4000-8000-000000000022';
export const PROC = {
  rm: 'dddddddd-0000-4000-8000-0000000000b1', tc: 'dddddddd-0000-4000-8000-0000000000b2', usg: 'dddddddd-0000-4000-8000-0000000000b3',
  ecg: 'dddddddd-0000-4000-8000-0000000000b4', dens: 'dddddddd-0000-4000-8000-0000000000b5',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+F9PQAJYwN6V0E0WwAAAABJRU5ErkJggg==', 'base64');

// Servidor de arquivos do site (a pasta do repositório), numa porta desta máquina.
export async function servidor(port) {
  const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (path.endsWith('/')) file = join(file, 'index.html');
    try {
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
    } catch {
      res.writeHead(404).end('não encontrado');
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return server;
}

const clinica = (id, name) => ({
  id, name, kind: 'imagem', description: null, address_line: 'Rua do Exemplo, 100', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', cep: '01000-000',
  location: { type: 'Point', coordinates: [-46.6565, -23.5625] }, phone: '(11) 3000-0000', whatsapp: null, email: null, website: null, specialties: [],
  opening_hours: { seg: '07:00–19:00' }, accepts_online_booking: true, status: 'published', is_demo: false, insurances: [], cnes: null, verified_at: '2026-10-01T12:00:00+00:00',
  clinic_exams: [{ exam_code: 'rm', price_cents: 45000, price_updated_at: '2026-10-01T10:00:00Z' }, { exam_code: 'tc', price_cents: null, price_updated_at: null },
    { exam_code: 'usg', price_cents: 18000, price_updated_at: '2026-10-01T10:00:00Z' }, { exam_code: 'ecg', price_cents: 9000, price_updated_at: '2026-10-01T10:00:00Z' },
    { exam_code: 'dens', price_cents: null, price_updated_at: null }],
});
export const CLINICAS = {
  [CLINICA]: clinica(CLINICA, 'Clínica Simulada dos Exames'),
  [SEM_VENDA]: clinica(SEM_VENDA, 'Clínica Simulada Sem Horário pelo Site'),
};

// Os 5 exames à venda (nome, duração, preço ou "sob consulta", preparo e jejum como a clínica informaria).
const PROCS = [
  { id: PROC.rm, exam_code: 'rm', name: 'Ressonância do joelho', duration_min: 30, price_cents: 45000, price_text: null, prep_text: 'Retire objetos de metal.', fasting_hours: null },
  { id: PROC.tc, exam_code: 'tc', name: 'Tomografia do tórax', duration_min: 20, price_cents: null, price_text: 'sob consulta', prep_text: null, fasting_hours: 4 },
  { id: PROC.usg, exam_code: 'usg', name: 'Ultrassom do abdome', duration_min: 30, price_cents: 18000, price_text: null, prep_text: 'Beba 4 copos de água 1 hora antes.', fasting_hours: 6 },
  { id: PROC.ecg, exam_code: 'ecg', name: 'Eletrocardiograma', duration_min: 15, price_cents: 9000, price_text: null, prep_text: null, fasting_hours: null },
  { id: PROC.dens, exam_code: 'dens', name: 'Densitometria óssea', duration_min: 20, price_cents: null, price_text: 'sob consulta', prep_text: null, fasting_hours: null },
];
// Horários livres de cada exame (hora local da unidade). No dia 2, a tomografia (15:00–15:20) e a densitometria
// (15:10–15:30) se cruzam: os dois têm horário, mas não dá para fazer um depois do outro.
const LIVRES = {
  [PROC.rm]: [[D1, '08:00'], [D1, '08:30'], [D1, '09:00'], [D1, '10:00'], [D1, '14:00'], [D2, '08:00'], [D3, '09:00']],
  [PROC.tc]: [[D1, '08:30'], [D1, '09:00'], [D1, '09:30'], [D1, '10:30'], [D2, '15:00'], [D3, '09:30']],
  [PROC.usg]: [[D1, '08:00'], [D1, '09:00'], [D1, '09:40'], [D1, '11:00'], [D3, '10:00']],
  [PROC.ecg]: [[D1, '08:30'], [D1, '09:30'], [D1, '10:10'], [D1, '11:30'], [D2, '08:30'], [D3, '08:00']],
  [PROC.dens]: [[D2, '15:10'], [D3, '11:00']],
};
const pg = (iso) => new Date(iso).toISOString().replace('.000Z', '+00:00');
const permutacoes = (l) => (l.length <= 1 ? [l] : l.flatMap((x, i) => permutacoes([...l.slice(0, i), ...l.slice(i + 1)]).map((r) => [x, ...r])));

/**
 * procs: quais exames a clínica vende (padrão: os 5); livres: troca a lista de horários de algum exame
 * ({ [id]: [[dia, 'HH:MM'], ...] }); naoMesmoDia: pares [idA, idB] que a clínica não faz no mesmo dia.
 */
export function agendaPacote({ tz = 'America/Sao_Paulo', offset = '-03:00', mode = 'nativa', online = true, procs = Object.values(PROC), livres = {}, naoMesmoDia = [] } = {}) {
  const lista = { ...LIVRES, ...livres };
  const dur = Object.fromEntries(PROCS.map((p) => [p.id, p.duration_min]));
  const at = (day, hhmm) => new Date(`${day}T${hhmm}:00${offset}`).toISOString();
  const dia = (iso) => G.zonedDateTime(iso, tz).date;
  const fim = (pid, iso) => new Date(Date.parse(iso) + dur[pid] * 60000).toISOString();
  // taken: "procedimento|início" → id do agendamento; byId: id → { fp, token, result, cancelled }
  const st = { taken: new Map(), byId: new Map(), calls: [] };
  st.info = () => ({
    status: 'ok', clinic_id: CLINICA, timezone: tz, mode, online,
    mode_text: 'A clínica usa a agenda do IMED: os horários mostrados são os livres na agenda dela agora.',
    online_text: online ? 'Escolha um horário livre e confirme.' : 'Esta clínica ainda não marca horário pelo site.',
    payment: 'no_local', payment_text: 'Pagamento no local, direto com a clínica.', cancel_until_min: online ? 120 : null, reschedule_until_min: online ? 120 : null,
    procedures: online ? PROCS.filter((p) => procs.includes(p.id)) : [],
  });
  st.free = (pid) => (procs.includes(pid) ? lista[pid] ?? [] : []).map(([d, h]) => at(d, h)).filter((iso) => !st.taken.has(`${pid}|${iso}`)).sort();
  st.slots = (b) => st.free(b.p_procedure).filter((iso) => dia(iso) >= b.p_from && dia(iso) <= b.p_to).map((iso) => ({ slot_start: pg(iso), slot_end: pg(fim(b.p_procedure, iso)) }));
  st.days = (b) => {
    const porDia = new Map();
    for (const iso of st.free(b.p_procedure)) {
      const d = dia(iso);
      if (d < b.p_from || d > b.p_to) continue;
      if (!porDia.has(d)) porDia.set(d, { day: d, livres: 0, primeiro: pg(iso) });
      porDia.get(d).livres += 1;
    }
    return [...porDia.values()];
  };
  st.options = (b) => {
    const ids = b.p_procedures ?? [];
    if (!b.p_day || ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length) return { status: 'invalid' };
    if (!online || ids.some((id) => !procs.includes(id))) return { status: 'not_found' };
    if (naoMesmoDia.some(([a, c]) => ids.includes(a) && ids.includes(c))) return { status: 'ok', options: [], same_day_blocked: true };
    const livresDoDia = Object.fromEntries(ids.map((id) => [id, st.free(id).filter((iso) => dia(iso) === b.p_day)]));
    const todas = [];
    for (const ordem of permutacoes(ids)) {
      for (const t0 of livresDoDia[ordem[0]]) {
        const items = [{ procedure_id: ordem[0], starts_at: t0, ends_at: fim(ordem[0], t0) }];
        for (const id of ordem.slice(1)) {
          const t = livresDoDia[id].find((x) => x >= items.at(-1).ends_at);
          if (!t) break;
          items.push({ procedure_id: id, starts_at: t, ends_at: fim(id, t) });
        }
        if (items.length !== ids.length) continue;
        const total = (Date.parse(items.at(-1).ends_at) - Date.parse(t0)) / 60000;
        todas.push({ items, wait_min: total - ids.reduce((n, id) => n + dur[id], 0), starts_at: t0, ends_at: items.at(-1).ends_at });
      }
    }
    todas.sort((a, c) => a.wait_min - c.wait_min || a.ends_at.localeCompare(c.ends_at) || a.starts_at.localeCompare(c.starts_at));
    return {
      status: 'ok', same_day_blocked: false,
      options: todas.slice(0, Math.min(Math.max(b.p_limit ?? 5, 1), 20)).map((o) => ({
        ...o, starts_at: pg(o.starts_at), ends_at: pg(o.ends_at), items: o.items.map((i) => ({ ...i, starts_at: pg(i.starts_at), ends_at: pg(i.ends_at) })),
      })),
    };
  };
  st.book = (b) => {
    st.calls.push(b);
    const items = (b.p_items ?? []).map((i) => ({ pid: i.procedure_id, iso: new Date(i.starts_at).toISOString() })).sort((a, c) => a.iso.localeCompare(c.iso));
    const fp = items.map((i) => `${i.pid}@${i.iso}`).join(',');
    const prev = st.byId.get(b.p_id);
    if (prev) return prev.fp === fp && prev.token === b.p_token ? { ...prev.result, replay: true, request_status: prev.cancelled ? 'cancelled' : 'confirmed' } : { status: 'idempotency_conflict' };
    let result;
    const falha = items.findIndex((i) => !st.free(i.pid).includes(i.iso));
    if (!online) result = { status: 'not_online' };
    else if (falha >= 0) {
      // tudo ou nada: um horário sem lugar e NADA é gravado (nem os outros exames)
      result = { status: 'slot_taken', seq: falha + 1, alternatives: st.free(items[falha].pid).filter((x) => dia(x) === dia(items[falha].iso)).map(pg).slice(0, 5) };
    } else {
      for (const i of items) st.taken.set(`${i.pid}|${i.iso}`, b.p_id);
      const ends = items.map((i) => fim(i.pid, i.iso));
      result = {
        status: 'ok', id: b.p_id, request_status: 'confirmed', slot_start: pg(items[0].iso), slot_end: pg(ends.sort().at(-1)), hold_expires_at: null,
        items: items.map((i, n) => ({ seq: n + 1, procedure_id: i.pid, starts_at: pg(i.iso), ends_at: pg(fim(i.pid, i.iso)) })),
      };
    }
    st.byId.set(b.p_id, { fp, token: b.p_token, result });
    return result;
  };
  // Outra pessoa pega um horário (entre as opções aparecerem e o paciente confirmar).
  st.ocupar = (pid, day, hhmm) => st.taken.set(`${pid}|${at(day, hhmm)}`, 'outra-pessoa');
  st.my = (b) => {
    const prev = st.byId.get(b.p_id);
    if (!prev || (b.p_token != null && prev.token !== b.p_token) || prev.result.status !== 'ok') return { status: 'not_found' };
    return {
      status: 'ok', id: b.p_id, request_status: prev.cancelled ? 'cancelled' : 'confirmed', agenda: true, clinic_id: CLINICA, timezone: tz,
      slot_start: prev.result.slot_start, slot_end: prev.result.slot_end,
      items: prev.result.items.map((i) => {
        const p = PROCS.find((x) => x.id === i.procedure_id);
        return { seq: i.seq, exam_code: p.exam_code, procedure: p.name, starts_at: i.starts_at, ends_at: i.ends_at, status: prev.cancelled ? 'cancelled' : 'confirmed', prep_text: p.prep_text, fasting_hours: p.fasting_hours };
      }),
    };
  };
  st.status = (b) => (b.p_ids ?? []).map((id, n) => ({ id, prev: st.byId.get(id), token: b.p_tokens?.[n] }))
    .filter((x) => x.prev?.result.status === 'ok' && x.prev.token === x.token).map((x) => ({ id: x.id, status: x.prev.cancelled ? 'cancelled' : 'confirmed', reviewed: false }));
  st.cancel = (b) => {
    const prev = st.byId.get(b.p_id);
    if (!prev || prev.result.status !== 'ok') return 'not_found';
    if (prev.token !== b.p_token) return 'forbidden';
    if (prev.cancelled) return 'already_cancelled';
    prev.cancelled = true;
    for (const [k, v] of st.taken) if (v === b.p_id) st.taken.delete(k);   // o pacote inteiro volta a ficar livre
    return 'ok';
  };
  return st;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
export const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });

/**
 * Liga as respostas simuladas num contexto do Playwright. `trocar`: { [função]: (route, body, ag) => ... } troca a
 * resposta de uma função do banco (agenda_book, agenda_days, agenda_package_options...). Devolve { rpc: [...] } com
 * cada chamada feita, e `arquivos` com os arquivos .js pedidos ao site.
 */
export async function ligar(context, ag, trocar = {}) {
  const log = { rpc: [], arquivos: [] };
  context.on('request', (req) => { const u = req.url(); if (/\/assets\/js\/[^/]+\.js/.test(u)) log.arquivos.push(u.split('/assets/js/')[1].replace(/\?.*$/, '')); });
  // nada sai desta máquina: o que não tem resposta simulada abaixo é cortado (mapas, busca por perto, entrada...)
  await context.route((u) => u.hostname !== '127.0.0.1', (r) => r.abort());
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await context.route((u) => u.href.startsWith(REST), async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const u = new URL(req.url());
    const caminho = u.pathname.split('/rest/v1/')[1];
    if (caminho === 'clinics') {
      const id = u.searchParams.get('id')?.replace('eq.', '');
      return json(route, CLINICAS[id] ? [CLINICAS[id]] : []);
    }
    if (!caminho.startsWith('rpc/')) return json(route, []);
    const fn = caminho.slice(4);
    const body = JSON.parse(req.postData() || '{}');
    log.rpc.push({ fn, body });
    if (trocar[fn]) return trocar[fn](route, body, ag);
    if (fn === 'agenda_public_info') {
      return json(route, body.p_clinic === CLINICA ? ag.info() : body.p_clinic === SEM_VENDA
        ? { status: 'ok', clinic_id: SEM_VENDA, timezone: 'America/Sao_Paulo', mode: 'pedido', online: false, procedures: [], mode_text: 'Você envia um pedido e a clínica ou a equipe do IMED entra em contato para combinar o horário.' }
        : { status: 'not_found' });
    }
    if (fn === 'agenda_slots') return json(route, ag.slots(body));
    if (fn === 'agenda_days') return json(route, ag.days(body));
    if (fn === 'agenda_package_options') return json(route, ag.options(body));
    if (fn === 'agenda_book') return json(route, ag.book(body));
    if (fn === 'agenda_my_booking') return json(route, ag.my(body));
    if (fn === 'request_status') return json(route, ag.status(body));
    if (fn === 'cancel_request') return json(route, ag.cancel(body));
    return json(route, []);
  });
  return log;
}
