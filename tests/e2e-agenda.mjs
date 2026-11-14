// Teste de ponta a ponta da agenda da recepção (iMed Agenda, fase 4.2), num navegador de verdade (Playwright), com o
// Supabase simulado: um banco de mentira, em memória, que responde às funções da agenda como o banco de verdade (a
// mesma forma de resposta e os mesmos códigos). Relógio fixo (quarta-feira, 04/11/2026, 10:00 em São Paulo), 1024 e
// 390 px, teclado, confirmações na própria tela (diálogo do navegador reprova), cores sempre com texto, tema escuro.
// Nomes com <b>…</b> provam que todo texto do banco é escapado. Nenhuma leitura direta de appointment_requests,
// clinic_blocks ou clinic_schedules pode acontecer (a 4.2 fecha essa leitura).
// Rodar: node tests/e2e-agenda.mjs   (SHOTS=pasta salva capturas; E2E_PORT muda a porta)
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, vigiarChaves, PUBLISHABLE, REALTIME_WS } from './regra-chaves.mjs';
import { ROLE_PERMS } from '../assets/js/agenda-core.js';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const PORT = Number(process.env.E2E_PORT) || 8782;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try { res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); } catch { res.writeHead(404).end('não encontrado'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

// ---------- dados simulados (nomes e e-mails de teste; nenhum dado real) ----------
const NOW = '2026-11-04T13:00:00Z'; // quarta-feira, 10:00 em São Paulo
const USER = 'uuuuuuuu-0000-4000-8000-000000000001';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const USG = 'rrrrrrrr-0000-4000-8000-000000000001';
const SALA = 'rrrrrrrr-0000-4000-8000-000000000002';
const DRA = 'rrrrrrrr-0000-4000-8000-000000000003';
const P_USG = 'pppppppp-0000-4000-8000-000000000001';
const P_ECO = 'pppppppp-0000-4000-8000-000000000002';
const CLINIC = { id: C1, name: 'Clínica Teste da Agenda', kind: 'imagem', address_line: 'Rua de Teste, 1', city: 'São Paulo', state: 'SP', cnes: '7654321',
  phone: null, whatsapp: null, email: null, website: null, specialties: [], opening_hours: null, accepts_online_booking: true, status: 'published', is_demo: false,
  insurances: [], timezone: 'America/Sao_Paulo', agenda_mode: 'nativa' };
const UNIT = { step_min: 15, min_notice_min: 120, max_advance_days: 90, checkin_before_min: 120, no_show_after_min: 15, patient_cancel_until_min: 0,
  patient_reschedule_until_min: 120, holidays_checked_until: '2026-12-31', closes_on_holidays: true };
const RESOURCES = () => [
  { id: USG, kind: 'equipamento', name: 'Aparelho de Ultrassom <b>1</b>', capacity: 1, active: true, member: null },
  { id: SALA, kind: 'sala', name: 'Sala 2', capacity: 1, active: true, member: null },
  { id: DRA, kind: 'profissional', name: 'Dra. Teste', capacity: 1, active: true, member: USER },
];
const PROCEDURES = () => [
  { id: P_USG, exam_code: 'usg', name: 'Ultrassom de abdome <b>total</b>', duration_min: 30, price_cents: 18000, online_booking: true, prep_text: 'Jejum de 8 horas.', fasting_hours: 8,
    min_notice_min: 120, groups: [{ group_no: 1, resource_kind: 'equipamento', resource_ids: [USG] }] },
  { id: P_ECO, exam_code: 'eco', name: 'Ecocardiograma', duration_min: 20, price_cents: null, online_booking: true, prep_text: null, fasting_hours: null,
    min_notice_min: 120, groups: [{ group_no: 1, resource_kind: 'profissional', resource_ids: [DRA] }] },
];
const sp = (day, hhmm) => new Date(`${day}T${hhmm}:00-03:00`).toISOString();
const HOJE = '2026-11-04';
const AMANHA = '2026-11-05';
let seq = 0;
const nid = (p) => `${p}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const clone = (x) => JSON.parse(JSON.stringify(x));
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
const jsonOut = json;
const short = (n) => { const w = String(n || '').trim().split(/\s+/); return w.length > 1 ? `${w[0]} ${w.at(-1)[0]}.` : w[0]; };

// Um agendamento (cabeçalho + itens) como o banco guarda.
function booking({ name = 'Maria Souza Lima', phone = '11988887777', proc = P_USG, start, status = 'confirmed', channel = 'imed_app', res = [USG], forOther = false, otherName = null, notes = null }) {
  const p = PROCEDURES().find((x) => x.id === proc);
  const id = nid('aaaaaaaa');
  const ends = new Date(Date.parse(start) + p.duration_min * 60000).toISOString();
  return {
    id, clinic_id: C1, status, version: 1, channel, patient_name: name, patient_phone: phone, patient_email: null, notes, for_other: forOther, other_name: otherName,
    relationship: forOther ? 'Filha' : null, other_minor: false, uses_resources: true, created_at: '2026-11-01T12:00:00Z', slot_start: start, slot_end: ends,
    preferred_date: start.slice(0, 10), preferred_period: 'manha', hold_expires_at: null, cancel_reason: null, cancelled_by: null, cancelled_at: null,
    items: [{ id: nid('iiiiiiii'), seq: 1, procedure_id: proc, procedure: p.name, exam_code: p.exam_code, starts_at: start, ends_at: ends, status, version: 1, price_cents: p.price_cents, resources: [...res] }],
  };
}

// role: papel da pessoa na clínica (null = sem vínculo); admin: equipe do IMED.
async function newPage(browser, { mobile = false, width = 1024, role = 'reception', admin = false, now = NOW, theme = null, tz = 'America/Sao_Paulo', missing = [], db: o = {} } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: mobile === true ? 390 : mobile, height: 844 } : { width, height: 900 }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', colorScheme: theme === 'dark' ? 'dark' : 'light' });
  await context.clock.setFixedTime(new Date(now));
  const db = {
    role, admin, now: Date.parse(now), tz, version: 7, unit: { ...UNIT }, resources: RESOURCES(), procedures: PROCEDURES(), requests: [], busy: [], blocks: [], conflicts: [],
    history: {}, keys: {}, accessLog: 0, deskSlots: null, desk: null, failNet: {}, once: {}, missing: new Set(missing), directReads: [], ...o,
  };
  const log = [];
  await context.addInitScript(([s, t]) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (t) localStorage.setItem('imed_tema', t);
      if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('imed_session', JSON.stringify(s)); sessionStorage.setItem('__seeded', '1'); }
    } catch { /* */ }
  }, [{ access_token: 'tok-init', refresh_token: 'ref', expires_at: Math.floor(Date.parse(now) / 1000) + 3600, user: { id: USER, email: 'recepcao@exemplo.test' } }, theme === 'dark' ? 'escuro' : null]);
  const perms = () => (db.role ? ROLE_PERMS[db.role] : {});
  const scope = () => (db.role && perms()['agenda.ver'] ? perms()['agenda.ver'] : db.admin ? 'central' : null);
  const own = () => db.resources.filter((r) => r.member === USER).map((r) => r.id);
  const visibleItem = (it) => scope() !== 'propria' || it.resources.some((r) => own().includes(r));
  const hist = (req, from, to, reason = null) => { (db.history[req.id] ||= []).push({ at: new Date(db.now).toISOString(), item_seq: 1, from, to, actor_kind: 'clinica', actor_role: db.role || 'imed_admin', origin: db.admin && !db.role ? 'central' : 'painel', reason_code: reason, request_version: req.version }); };
  const touch = () => { db.version += 1; };
  const reqOf = (id) => db.requests.find((r) => r.id === id);
  const inRange = (x, ini, fim) => Date.parse(x.starts_at ?? x.slot_start) < fim && Date.parse(x.ends_at ?? x.slot_end) > ini;
  const dayStart = (day) => Date.parse(new Date(`${day}T00:00:00-03:00`).toISOString());
  const occupied = (resId, ini, fim, ignore = null) => db.requests.some((r) => r.items.some((it) => it.id !== ignore && ['confirmed', 'checked_in', 'in_service', 'hold', 'reschedule_requested'].includes(it.status) && it.resources.includes(resId) && Date.parse(it.starts_at) < fim && Date.parse(it.ends_at) > ini))
    || db.busy.some((b) => b.resources.includes(resId) && Date.parse(b.starts_at) < fim && Date.parse(b.ends_at) > ini)
    || db.blocks.some((b) => (!b.resource_id || b.resource_id === resId) && Date.parse(b.starts_at) < fim && Date.parse(b.ends_at) > ini);
  const freeSlots = (proc, day, ignore = null) => {
    if (db.deskSlots) return db.deskSlots;
    const p = db.procedures.find((x) => x.id === proc);
    const res = p.groups[0].resource_ids[0];
    const out = [];
    for (let m = 7 * 60; m + p.duration_min <= 19 * 60; m += 30) {
      const ini = dayStart(day) + m * 60000; const fim = ini + p.duration_min * 60000;
      if (ini < db.now) continue;
      if (!occupied(res, ini, fim, ignore)) out.push({ start: new Date(ini).toISOString(), end: new Date(fim).toISOString() });
    }
    return out;
  };
  // o gatilho da 4.2: o item que sai da remarcação (por qualquer caminho) fecha os conflitos dele; semGatilho = banco antigo
  const fecharConflitos = (itemId, code) => {
    if (db.semGatilho) return;
    for (const k of db.conflicts) {
      if (k.item_id === itemId && ['aberto', 'em_andamento'].includes(k.status) && (code !== 'mantido' || k.kind === 'bloqueio_sobre_agendamento')) { k.status = 'resolvido'; k.resolution_code = code; }
    }
  };
  const soma = (req) => { const vivos = req.items.filter((i) => i.status !== 'cancelled'); return vivos.length ? vivos[0].status : 'cancelled'; };
  const transition = (req, item, to, reason) => {
    const ini = Date.parse(item.starts_at);
    const u = db.unit;
    const from = item.status;
    const ok = { 'confirmed>checked_in': () => db.now >= ini - u.checkin_before_min * 60000 || 'too_early', 'checked_in>in_service': () => true, 'in_service>completed': () => true,
      'confirmed>completed': () => db.now >= ini || 'too_early', 'confirmed>no_show': () => db.now >= ini + u.no_show_after_min * 60000 || 'too_early',
      'no_show>checked_in': () => (scope() === 'propria' ? 'transition_not_allowed' : !reason ? 'reason_required' : true),
      'reschedule_requested>confirmed': () => (occupied(item.resources[0] || USG, ini, Date.parse(item.ends_at), item.id) ? 'slot_taken' : true),
      'confirmed>cancelled': () => (!reason ? 'reason_required' : true), 'reschedule_requested>cancelled': () => (!reason ? 'reason_required' : true),
      'checked_in>cancelled': () => (!reason ? 'reason_required' : true) };
    const f = ok[`${from}>${to}`];
    if (!f) return { status: 'transition_not_allowed', from };
    const v = f();
    if (v !== true) return { status: v, ...(v === 'transition_not_allowed' ? { from } : {}) };
    item.status = to; item.version += 1;
    if (to === 'confirmed' && !item.resources.length) item.resources = [USG];
    if (to === 'cancelled') item.resources = [];
    req.status = soma(req); req.version += 1;
    const code = { cancelled: 'cancelado', completed: 'concluido', no_show: 'faltou' }[to] || (from === 'reschedule_requested' && to === 'confirmed' ? 'mantido' : null);
    if (code) fecharConflitos(item.id, code);
    hist(req, from, to, reason);
    touch();
    return { status: 'ok', request_status: to, version: req.version };
  };
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const rest = url.pathname.replace('/rest/v1/', '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    log.push({ path: rest, method: req.method(), body, q: url.searchParams });
    const fn = rest.replace('rpc/', '');
    // resposta perdida: o banco grava, mas a resposta não chega (erro de rede depois de gravar)
    const perdida = db.lostReply?.[fn] > 0;
    if (perdida) db.lostReply[fn] -= 1;
    const json = (r, b, s = 200) => (perdida ? r.abort('failed') : jsonOut(r, b, s));
    if (['appointment_requests', 'clinic_blocks', 'clinic_schedules'].includes(rest)) db.directReads.push(rest);
    if (db.failNet[fn] > 0) { db.failNet[fn] -= 1; return route.abort('failed'); }
    if (db.missing.has(fn)) return json(route, { code: 'PGRST202', message: `Could not find the function public.${fn}` }, 404);
    if (db.once[fn]) { const r = db.once[fn]; delete db.once[fn]; return json(route, r); }
    if (db.delay?.[fn]) await new Promise((r) => setTimeout(r, db.delay[fn])); // resposta lenta (sair da aba antes dela)
    const pr = perms();
    switch (rest) {
      case 'rpc/is_imed_admin': return json(route, db.admin);
      case 'rpc/agenda_me': return json(route, { status: 'ok', user_id: USER, clinics: db.role ? [{ clinic_id: C1, name: CLINIC.name, role: db.role, timezone: db.tz, agenda_mode: 'nativa', agenda_active: true, online: false, permissions: pr }] : [], imed: { admin: db.admin, permissions: [] } });
      case 'rpc/agenda_my_invites': return json(route, { status: 'ok', invites: [] });
      case 'clinics': return json(route, db.role || db.admin ? [{ ...CLINIC, timezone: db.tz }] : []);
      case 'clinic_exams': return json(route, []);
      case 'appointment_requests': case 'clinic_blocks': case 'clinic_schedules': return json(route, { code: '42501', message: 'permission denied' }, 403);
      case 'rpc/agenda_catalog': {
        const s = scope();
        if (!s) return json(route, { status: 'forbidden' });
        const res = s === 'propria' ? db.resources.filter((r) => own().includes(r.id)) : db.resources;
        const procs = s === 'propria' ? db.procedures.filter((p) => p.groups.some((g) => g.resource_ids.some((x) => own().includes(x)))) : db.procedures;
        const c = (perm) => (s === 'central' ? true : pr[perm] === 'clinica');
        return json(route, { status: 'ok', scope: s, clinic_id: C1, timezone: db.tz, agenda_mode: 'nativa', active: true, online: false,
          can: { marcar: c('agenda.marcar'), remarcar: c('agenda.remarcar'), cancelar: c('agenda.cancelar'), bloquear: c('agenda.bloquear'), atender: s === 'central' ? db.imedOperar !== false : !!pr['agenda.atender'], pacientes: s !== 'central' && !!pr['agenda.pacientes'], conflitos: c('conflitos.resolver') },
          unit: db.unit, national_holidays_until: db.national ?? '2027-12-31',
          resources: res.map(({ member, ...r }) => ({ ...r, mine: member === USER })), procedures: procs });
      }
      case 'rpc/agenda_view': {
        const s = scope();
        if (!s) return json(route, { status: 'forbidden' });
        const ini = dayStart(body.p_from); const fim = ini + body.p_days * 86400000;
        const items = db.requests.flatMap((r) => r.items.map((it) => ({ ...it, request_id: r.id, request_version: r.version, channel: r.channel, hold_expires_at: r.hold_expires_at,
          patient: s === 'central' ? null : short(r.for_other ? r.other_name : r.patient_name) })))
          .filter((it) => inRange(it, ini, fim) && it.status !== 'expired' && visibleItem(it))
          .map((it) => ({ ...it, resources: ['cancelled'].includes(it.status) ? [] : it.resources }));
        if (s !== 'central' && items.length) db.accessLog += 1;
        return json(route, { status: 'ok', version: db.version, timezone: db.tz, from: new Date(ini).toISOString(), to: new Date(fim).toISOString(), scope: s, patients: s !== 'central',
          resources: (s === 'propria' ? db.resources.filter((r) => own().includes(r.id)) : db.resources).map(({ member, ...r }) => r),
          items, busy: s === 'propria' ? [] : db.busy.filter((b) => inRange(b, ini, fim)), blocks: db.blocks.filter((b) => inRange(b, ini, fim)).map((b) => ({ ...b, reason: s === 'clinica' ? b.reason : null })) });
      }
      case 'rpc/agenda_free': {
        const ini = dayStart(body.p_from); const fim = ini + body.p_days * 86400000;
        // db.fechado: [['12:00', '13:00']] fecha todo dia nesse horário; db.fechadoDias: [0] fecha o domingo inteiro
        const hm = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
        const fechadoEm = (d, m) => (db.fechadoDias || []).includes(new Date(ini + d * 86400000 + 12 * 3600000).getUTCDay())
          || (db.fechado || []).some(([a, b]) => m >= hm(a) && m < hm(b));
        const res = (scope() === 'propria' ? db.resources.filter((r) => own().includes(r.id)) : db.resources).map((r) => {
          const free = [];
          for (let d = 0; d < body.p_days; d++) {
            let a = null;
            for (let m = 7 * 60; m <= 19 * 60; m += 5) {
              const t = ini + d * 86400000 + m * 60000;
              const livre = m < 19 * 60 && !occupied(r.id, t, t + 5 * 60000) && !fechadoEm(d, m);
              if (livre && a == null) a = t;
              if (!livre && a != null) { free.push([new Date(a).toISOString(), new Date(t).toISOString()]); a = null; }
            }
          }
          return { id: r.id, free };
        }).filter((r) => r.free.length);
        const unitOpen = Array.from({ length: body.p_days }, (_, d) => [new Date(ini + d * 86400000 + 7 * 3600000).toISOString(), new Date(ini + d * 86400000 + 19 * 3600000).toISOString()]);
        return json(route, { status: 'ok', scope: scope(), timezone: db.tz, from: new Date(ini).toISOString(), to: new Date(fim).toISOString(), holidays_checked_until: db.unit.holidays_checked_until,
          national_holidays_until: db.national ?? '2027-12-31', closes_on_holidays: true, unit_open: unitOpen, resources: res, holidays: [] });
      }
      case 'rpc/agenda_month': {
        const ini = `${body.p_month.slice(0, 7)}-01`;
        const days = [];
        for (let d = new Date(`${ini}T12:00:00Z`); d.toISOString().slice(0, 7) === ini.slice(0, 7); d.setUTCDate(d.getUTCDate() + 1)) {
          const day = d.toISOString().slice(0, 10); const a = dayStart(day); const z = a + 86400000;
          const its = db.requests.flatMap((r) => r.items).filter((it) => inRange(it, a, z));
          days.push({ day, ativos: its.filter((i) => ['confirmed', 'checked_in', 'in_service', 'reschedule_requested'].includes(i.status)).length, concluidos: its.filter((i) => i.status === 'completed').length,
            faltas: its.filter((i) => i.status === 'no_show').length, cancelados: its.filter((i) => i.status === 'cancelled').length, bloqueios: db.blocks.filter((b) => inRange(b, a, z)).length });
        }
        return json(route, { status: 'ok', timezone: db.tz, month: ini, days });
      }
      case 'rpc/agenda_version': return json(route, { status: 'ok', version: db.version, changed_at: NOW });
      case 'rpc/agenda_conflicts': return json(route, scope() === 'propria' ? { status: 'forbidden' } : { status: 'ok', conflicts: db.conflicts.filter((k) => ['aberto', 'em_andamento'].includes(k.status)) });
      case 'rpc/agenda_conflict_resolve': {
        const k = db.conflicts.find((x) => x.id === body.p_id);
        if (!k) return json(route, { status: 'not_found' });
        if (!['aberto', 'em_andamento'].includes(k.status)) return json(route, { status: 'already_closed' });
        k.status = body.p_status; k.resolution_code = body.p_code; touch();
        return json(route, { status: 'ok' });
      }
      case 'rpc/agenda_search': {
        if (scope() === 'central') return json(route, { status: 'forbidden' });
        const q = String(body.p_q || '').trim();
        if (q.length < 3) return json(route, { status: 'too_short' });
        db.accessLog += 1;
        const results = db.requests.filter((r) => `${r.patient_name} ${r.other_name || ''}`.toLowerCase().includes(q.toLowerCase()) && r.items.some(visibleItem))
          .map((r) => ({ id: r.id, status: r.status, slot_start: r.slot_start, agenda: r.uses_resources, preferred_date: r.preferred_date, exam_code: r.items[0]?.exam_code || 'usg', version: r.version,
            name: r.for_other ? r.other_name : r.patient_name, phone_end: scope() === 'clinica' ? r.patient_phone.slice(-4) : null }));
        return json(route, { status: 'ok', results });
      }
      case 'rpc/agenda_request_detail': {
        const r = reqOf(body.p_id);
        if (!r) return json(route, { status: 'not_found' });
        let s = scope();
        if (s === 'central' && !body.p_justification) return json(route, { status: 'justification_required' });
        db.accessLog += 1; db.lastJust = body.p_justification;
        const full = s === 'clinica' || s === 'central';
        return json(route, { status: 'ok', scope: s, id: r.id, clinic_id: C1, request_status: r.status, version: r.version, agenda: r.uses_resources, channel: r.channel, created_at: r.created_at,
          exam_code: r.items[0]?.exam_code || r.exam_code, preferred_date: r.preferred_date, preferred_period: r.preferred_period, slot_start: r.slot_start, slot_end: r.slot_end,
          hold_expires_at: r.hold_expires_at, cancel_reason: r.cancel_reason, cancelled_by: r.cancelled_by, cancelled_at: r.cancelled_at, anonymized: false,
          patient: { name: r.patient_name, phone: full ? r.patient_phone : null, email: full ? r.patient_email : null, for_other: r.for_other, other_name: r.other_name, relationship: r.relationship, other_minor: r.other_minor, notes: full ? r.notes : null },
          items: r.items.map((it) => ({ ...it, resources: it.resources.map((id) => { const x = db.resources.find((y) => y.id === id); return { id, name: x.name, kind: x.kind }; }) })), notes: [] });
      }
      case 'rpc/agenda_history': return json(route, { status: 'ok', history: db.history[body.p_id] || [] });
      // avisos e lembretes do agendamento (5.3): só o evento, o canal, para quem, quando e a situação
      case 'rpc/agenda_notify_list': return json(route, pr['agenda.ver'] || scope() === 'central' ? { status: 'ok', sending: !!db.sending, items: db.notifications?.[body.p_request] || [] } : { status: 'forbidden' });
      case 'rpc/agenda_desk_slots': {
        if (!(pr['agenda.marcar'] === 'clinica' || scope() === 'central')) return json(route, { status: 'forbidden' });
        db.lastSlots = body;
        if (db.desk) return json(route, db.desk);
        return json(route, { status: 'ok', timezone: db.tz, from: body.p_from, to: body.p_to || body.p_from, slots: freeSlots(body.p_procedure, body.p_from, body.p_item), holidays_checked_until: db.unit.holidays_checked_until, national_holidays_until: db.national ?? '2027-12-31' });
      }
      case 'rpc/agenda_desk_book': {
        if (db.keys[body.p_key]) return json(route, { ...db.keys[body.p_key], replay: true });
        const it = body.p_items[0];
        if (!freeSlots(it.procedure_id, it.starts_at.slice(0, 10)).some((s) => s.start === it.starts_at) && !db.deskSlots) return json(route, { status: 'slot_taken', seq: 1, alternatives: [] });
        const p = body.p_patient;
        const b = booking({ name: p.name, phone: p.phone, proc: it.procedure_id, start: it.starts_at, channel: body.p_channel, res: db.procedures.find((x) => x.id === it.procedure_id).groups[0].resource_ids });
        db.requests.push(b); touch();
        const r = { status: 'ok', id: b.id, request_status: 'confirmed', slot_start: b.slot_start, slot_end: b.slot_end, hold_expires_at: null, items: [{ seq: 1, procedure_id: it.procedure_id, starts_at: b.slot_start, ends_at: b.slot_end }] };
        db.keys[body.p_key] = r;
        return json(route, r);
      }
      case 'rpc/agenda_desk_busy': {
        const id = nid('bbbbbbbb');
        db.busy.push({ id, starts_at: body.p_starts, ends_at: body.p_ends, reason_code: body.p_reason, resources: [body.p_resource] }); touch();
        return json(route, { status: 'ok', id });
      }
      case 'rpc/agenda_desk_busy_remove': db.busy = db.busy.filter((b) => b.id !== body.p_id); touch(); return json(route, { status: 'ok' });
      case 'rpc/agenda_attend': case 'rpc/agenda_set_status': {
        const r = reqOf(body.p_id);
        if (!r) return json(route, { status: 'not_found' });
        if (fn === 'agenda_set_status' && scope() === 'propria') return json(route, { status: 'forbidden' });
        if (body.p_version != null && body.p_version !== r.version) return json(route, { status: 'version_conflict', version: r.version });
        const item = r.items.find((x) => x.id === body.p_item) || r.items[0];
        if (scope() === 'propria' && !item.resources.some((x) => own().includes(x))) return json(route, { status: 'forbidden' });
        return json(route, transition(r, item, body.p_status, body.p_reason));
      }
      case 'rpc/agenda_cancel': {
        const r = reqOf(body.p_id);
        if (!r) return json(route, { status: 'not_found' });
        if (!body.p_reason) return json(route, { status: 'reason_required' });
        if (body.p_version != null && body.p_version !== r.version) return json(route, { status: 'version_conflict', version: r.version });
        r.status = 'cancelled'; r.cancel_reason = body.p_reason; r.version += 1; r.items.forEach((i) => { i.status = 'cancelled'; i.resources = []; fecharConflitos(i.id, 'cancelado'); }); touch();
        return json(route, { status: 'ok' });
      }
      case 'rpc/agenda_reschedule': {
        const r = reqOf(body.p_id);
        if (db.keys[body.p_key]) return json(route, { ...db.keys[body.p_key], replay: true });
        if (body.p_version != null && body.p_version !== r.version) return json(route, { status: 'version_conflict', version: r.version });
        const it = r.items.find((x) => x.seq === body.p_items[0].seq);
        const dur = Date.parse(it.ends_at) - Date.parse(it.starts_at);
        it.starts_at = body.p_items[0].starts_at; it.ends_at = new Date(Date.parse(it.starts_at) + dur).toISOString(); it.status = 'confirmed';
        it.resources = it.resources.length ? it.resources : db.procedures.find((p) => p.id === it.procedure_id).groups[0].resource_ids;
        r.status = 'confirmed'; r.slot_start = it.starts_at; r.version += 1; fecharConflitos(it.id, 'remarcado'); touch();
        const out = { status: 'ok', id: r.id, request_status: 'confirmed', items: [{ seq: it.seq, starts_at: it.starts_at, ends_at: it.ends_at }] };
        db.keys[body.p_key] = out;
        return json(route, out);
      }
      case 'rpc/agenda_blocks': return json(route, { status: 'ok', scope: scope(), timezone: db.tz, from: HOJE, to: '2027-12-09', can_edit: pr['agenda.bloquear'] === 'clinica' || scope() === 'central',
        blocks: db.blocks.map((b) => ({ ...b, resource_name: b.resource_id ? db.resources.find((r) => r.id === b.resource_id).name : null, resource_kind: null, reason: scope() === 'clinica' ? b.reason : null, created_at: NOW })) });
      case 'rpc/agenda_block_add': case 'rpc/agenda_block_force': {
        db.lastBlock = body;
        const ini = Date.parse(body.p_starts); const fim = Date.parse(body.p_ends);
        const hitRes = (resIds) => (body.p_resource ? resIds.includes(body.p_resource) : true);
        // agenda_block_force (4.2): o período conta a partir de agora e o que JÁ COMEÇOU não é atingido (nem impede);
        // agenda_block_add (3.2) olha o período inteiro, como o banco de verdade.
        const forcar = fn === 'agenda_block_force';
        const desde = forcar ? Math.max(ini, db.now) : ini;
        const futuro = (x) => !forcar || Date.parse(x.starts_at) > db.now;
        const ativo = (it) => ['hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service', 'reschedule_requested'].includes(it.status) && it.resources.length;
        const hits = [
          ...db.requests.flatMap((r) => r.items.filter((it) => ativo(it) && hitRes(it.resources) && Date.parse(it.starts_at) < fim && Date.parse(it.ends_at) > desde && futuro(it))
            .map((it) => ({ kind: 'agendamento', item_id: it.id, request_id: r.id, busy_id: null, seq: it.seq, status: it.status, request_version: r.version, starts_at: it.starts_at, ends_at: it.ends_at,
              procedure_id: it.procedure_id, procedure: it.procedure, channel: r.channel, patient: scope() === 'clinica' ? short(r.patient_name) : null, can_move: ['confirmed', 'reschedule_requested'].includes(it.status) }))),
          ...db.busy.filter((b) => hitRes(b.resources) && Date.parse(b.starts_at) < fim && Date.parse(b.ends_at) > desde && futuro(b))
            .map((b) => ({ kind: 'ocupado', item_id: null, request_id: null, busy_id: b.id, seq: null, status: null, request_version: null, starts_at: b.starts_at, ends_at: b.ends_at, procedure_id: null, procedure: null, channel: null, patient: null, can_move: true })),
        ];
        const code = `c${hits.map((h) => `${h.item_id || h.busy_id}:${h.status}:${h.request_version}`).join('|').length}${hits.length}`.padEnd(64, '0');
        if (fn === 'agenda_block_add') {
          if (hits.length) return json(route, { status: 'has_appointments', items: hits.filter((h) => h.kind === 'agendamento').map((h) => ({ item_id: h.item_id, request_id: h.request_id, starts_at: h.starts_at })), busy: hits.filter((h) => h.kind === 'ocupado').length });
          const id = nid('kkkkkkkk');
          db.blocks.push({ id, resource_id: body.p_resource, kind: body.p_kind, starts_at: body.p_starts, ends_at: body.p_ends, reason: body.p_reason }); touch();
          return json(route, { status: 'ok', id });
        }
        if (!body.p_confirm) return json(route, { status: 'confirm_required', items: hits, confirm: code });
        // o mesmo bloqueio (alvo, início, fim e tipo) já gravado: não grava outro (reenvio depois de erro de rede)
        const igual = db.blocks.find((b) => (b.resource_id || null) === (body.p_resource || null) && b.kind === body.p_kind && Date.parse(b.starts_at) === ini && Date.parse(b.ends_at) === fim);
        if (igual) return json(route, { status: 'ok', id: igual.id, moved: 0, busy_removed: 0, replay: true });
        if (body.p_confirm !== code) return json(route, { status: 'affected_changed', items: hits, confirm: code });
        if (hits.some((h) => !h.can_move)) return json(route, { status: 'cannot_move', items: hits });
        const id = nid('kkkkkkkk');
        let moved = 0; let removed = 0;
        for (const h of hits) {
          if (h.kind === 'ocupado') { db.busy = db.busy.filter((b) => b.id !== h.busy_id); removed++; continue; }
          const r = reqOf(h.request_id); const it = r.items.find((x) => x.id === h.item_id);
          it.status = 'reschedule_requested'; it.resources = []; r.status = 'reschedule_requested'; r.version += 1; moved++;
          db.conflicts.push({ id: nid('ffffffff'), kind: 'bloqueio_sobre_agendamento', request_id: r.id, item_id: it.id, starts_at: it.starts_at, procedure_id: it.procedure_id, details: { starts_at: it.starts_at, procedure_id: it.procedure_id, block_id: id }, status: 'aberto', created_at: NOW });
        }
        db.blocks.push({ id, resource_id: body.p_resource, kind: body.p_kind, starts_at: body.p_starts, ends_at: body.p_ends, reason: body.p_reason }); touch();
        return json(route, { status: 'ok', id, moved, busy_removed: removed });
      }
      case 'rpc/agenda_block_remove': db.blocks = db.blocks.filter((b) => b.id !== body.p_block); touch(); return json(route, { status: 'ok' });
      // Painel gerencial (3.4): os números calculados do banco de mentira, com a mesma forma do banco de verdade.
      case 'rpc/agenda_dashboard': {
        const s = scope();
        if (!s || s === 'propria') return json(route, { status: 'forbidden' });
        db.dashCalls = (db.dashCalls || 0) + 1;
        const ini = dayStart(body.p_from); const fim = dayStart(body.p_to) + 86400000;
        if (!(fim > ini) || (fim - ini) / 86400000 > 92) return json(route, { status: 'invalid' });
        const f = body.p_filters || {};
        const its = db.requests.flatMap((r) => r.items.map((it) => ({ ...it, channel: r.channel, cancel_reason: r.cancel_reason })))
          .filter((it) => inRange(it, ini, fim) && it.status !== 'expired' && (!f.procedure_id || it.procedure_id === f.procedure_id) && (!f.resource_id || it.resources.includes(f.resource_id)) && (!f.channel || it.channel === f.channel));
        const n = (fn) => its.filter(fn).length;
        const porDia = {};
        for (const it of its) if (it.status !== 'cancelled') { const d = new Date(Date.parse(it.starts_at) - 3 * 3600000).toISOString().slice(0, 10); porDia[d] = (porDia[d] || 0) + 1; }
        const conc = n((i) => i.status === 'completed'); const falt = n((i) => i.status === 'no_show');
        const motivos = {};
        for (const it of its) if (it.status === 'cancelled') motivos[it.cancel_reason || 'sem_motivo'] = (motivos[it.cancel_reason || 'sem_motivo'] || 0) + 1;
        const recursos = db.resources.filter((r) => !f.resource_id || r.id === f.resource_id).map((r) => {
          const oc = its.filter((i) => i.resources.includes(r.id) && !['cancelled', 'hold', 'awaiting_payment'].includes(i.status)).reduce((t, i) => t + (Date.parse(i.ends_at) - Date.parse(i.starts_at)) / 60000, 0);
          return { resource_id: r.id, name: r.name, kind: r.kind, capacity: r.capacity, minutos_ocupados: oc, minutos_livres: 600, minutos_abertos: 600 + oc, minutos_bloqueados: 0, ocupacao_pct: Math.round((1000 * oc) / (600 + oc)) / 10 };
        });
        return json(route, { status: 'ok', from: body.p_from, to: body.p_to, timezone: db.tz, total: its.length,
          por_situacao: { reservado: n((i) => ['hold', 'awaiting_payment'].includes(i.status)), confirmado: n((i) => i.status === 'confirmed'), presente: n((i) => ['checked_in', 'in_service'].includes(i.status)), concluido: conc, faltou: falt, remarcacao: n((i) => i.status === 'reschedule_requested'), cancelado: n((i) => i.status === 'cancelled') },
          faltas_pct: conc + falt ? Math.round((1000 * falt) / (conc + falt)) / 10 : null, cancelamentos_por_motivo: motivos,
          origem: { imed: n((i) => ['imed_app', 'imed_equipe'].includes(i.channel)), clinica: n((i) => ['clinica_telefone', 'clinica_balcao', 'clinica_outro'].includes(i.channel)), externo: n((i) => i.channel === 'externo') },
          por_dia: Object.entries(porDia).sort().map(([day, total]) => ({ day, total })), recursos,
          formula: 'ocupação = minutos ocupados (agendamentos e "ocupado", inclusive concluídos e faltas) ÷ minutos abertos (horário de funcionamento menos pausas, feriados e bloqueios)' });
      }
      case 'rpc/agenda_dashboard_financeiro': {
        if (!(db.role && pr['financeiro.ver'] === 'clinica') && !db.admin) return json(route, { status: 'forbidden' });
        db.finCalls = (db.finCalls || 0) + 1;
        const ini = dayStart(body.p_from); const fim = dayStart(body.p_to) + 86400000;
        const its = db.requests.flatMap((r) => r.items).filter((it) => inRange(it, ini, fim) && ['confirmed', 'checked_in', 'in_service', 'hold', 'awaiting_payment', 'reschedule_requested', 'completed'].includes(it.status));
        const soma = (l) => l.reduce((t, i) => t + (i.price_cents || 0), 0);
        const porExame = {};
        for (const it of its) { const e = (porExame[it.exam_code] ||= { estimada_cents: 0, concluida_cents: 0, agendamentos: 0 }); e.estimada_cents += it.price_cents || 0; e.agendamentos += 1; if (it.status === 'completed') e.concluida_cents += it.price_cents || 0; }
        return json(route, { status: 'ok', from: body.p_from, to: body.p_to, timezone: db.tz, receita_estimada_cents: soma(its), receita_concluida_cents: soma(its.filter((i) => i.status === 'completed')),
          agendamentos: its.length, sob_consulta: its.filter((i) => i.price_cents == null).length, pagamento_online: false, por_exame: porExame,
          nota: 'Valores pelo preço informado pela clínica na hora da marcação. O pagamento é feito no local; o IMED não confirma pagamentos.' });
      }
      case 'rpc/agenda_requests': {
        const s = pr['pedidos.ver'] === 'clinica' ? 'clinica' : db.admin ? 'central' : null;
        if (!s) return json(route, { status: 'forbidden' });
        if (s === 'central' && !body.p_justification) return json(route, { status: 'justification_required' });
        // como o banco: sem p_when, no máximo os 100 mais novos
        const lista = db.requests.map((r) => ({ ...r, items: undefined }));
        return json(route, { status: 'ok', scope: s, timezone: db.tz, today: HOJE, requests: body.p_when ? lista : lista.slice(0, 100) });
      }
      // só o número de pedidos sem resposta (revisão da 4.3), sem dado de paciente e sem registro de leitura
      case 'rpc/agenda_requests_pending_count': {
        if (!(pr['pedidos.ver'] === 'clinica' || db.admin)) return json(route, { status: 'forbidden' });
        return json(route, { status: 'ok', pending: db.requests.filter((r) => r.status === 'pending').length });
      }
      case 'rpc/set_request_status': return json(route, 'ok');
      case 'rpc/agenda_config': return json(route, { status: 'forbidden' });
      default: return json(route, { message: `não simulado: ${rest}` }, 404);
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push(`diálogo inesperado: ${d.message()}`); d.dismiss(); });
  return { context, page, log, db, errors };
}

const calls = (log, fn) => log.filter((e) => e.path === `rpc/${fn}`);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
const noOverflow = async (page) => {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const vw = page.viewportSize().width;
  assert.ok(sw <= vw, `sem rolagem lateral (conteúdo ${sw}px, aparelho ${vw}px)`);
};
const focusId = (page) => page.evaluate(() => document.activeElement?.id || '');
// Nome falado de cada botão: o texto dele sem o que é só para os olhos (aria-hidden), como o leitor de tela lê.
// Botão com texto à vista não pode ter aria-label (o nome falado tem de conter o que está escrito; o axe confere).
const nomesFalados = (page, sel) => page.$$eval(sel, (els) => els.map((el) => {
  const c = el.cloneNode(true);
  c.querySelectorAll('[aria-hidden="true"]').forEach((x) => x.remove());
  return `${el.getAttribute('aria-label') ?? ''}|${c.textContent.replace(/\s+/g, ' ').trim()}`;
}));
const focusText = (page) => page.evaluate(() => (document.activeElement?.textContent || '').trim());
const abrirAgenda = async (page) => {
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-agenda');
  if (await page.getAttribute('#tab-agenda', 'aria-selected') !== 'true') await page.click('#tab-agenda');
  await page.waitForSelector('#agMain .ag-lista, #agMain .ag-grade, #agMain .ag-vazio, #agMain .ag-mes, #agMain .ag-mlista');
};
// Toda marca colorida da agenda tem o texto da situação (no próprio texto ou no aria-label).
async function coresComTexto(page) {
  const sem = await page.$$eval('.ag-ev', (els) => els.filter((e) => {
    const t = `${e.textContent || ''} ${e.getAttribute('aria-label') || ''}`;
    return !/(Confirmado|Paciente presente|Presente|Em atendimento|Concluído|Não compareceu|Faltou|Cancelado|Remarcação|Remarcar|Reserva|Pagamento|Bloqueado|Manutenção|Folga|Feriado|Ocupado|Aguardando|Em contato)/.test(t);
  }).map((e) => e.outerHTML.slice(0, 120)));
  assert.deepEqual(sem, [], 'toda marca colorida tem o texto da situação');
}
const semLeituraDireta = (db) => assert.deepEqual(db.directReads, [], 'nenhuma leitura direta de pedidos, bloqueios ou horários');

const results = [];
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
// E2E_SO=<trecho ou expressão regular> roda só os cenários com esse nome (para apurar um cenário na máquina).
const SO = process.env.E2E_SO ? new RegExp(process.env.E2E_SO, 'i') : null;
async function scenario(name, fn) {
  if (SO && !SO.test(name)) return;
  const t = new Promise((_, f) => { const x = setTimeout(() => f(new Error(`passou de ${LIMITE_MS / 1000} s: ${name}`)), LIMITE_MS); x.unref?.(); });
  try { await Promise.race([comChaves(fn), t]); results.push(['ok', name]); console.log(`ok  ${name}`); } catch (e) { results.push(['FALHOU', name]); console.log(`FALHOU  ${name}\n   ${e.stack}`); }
}
const browser = vigiarChaves(await chromium.launch());

// Agendamentos de hoje e amanhã usados em vários cenários.
const dia1 = () => [
  booking({ name: 'Maria <b>Souza</b> Lima', start: sp(HOJE, '09:00'), channel: 'imed_app' }),
  booking({ name: 'João Pedro Teste', phone: '11977776666', start: sp(HOJE, '10:00'), status: 'checked_in', channel: 'clinica_telefone' }),
  booking({ name: 'Ana Clara Rocha', phone: '1133334444', start: sp(HOJE, '11:00'), status: 'confirmed', channel: 'clinica_balcao', proc: P_ECO, res: [DRA] }),
  booking({ name: 'Pedro Cancelado Silva', start: sp(HOJE, '14:00'), status: 'cancelled', channel: 'clinica_outro' }),
];

await scenario('recepção, 1024 px: abas, Hoje com cada item, cores com texto, legenda e nenhuma leitura direta', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: dia1(), busy: [{ id: 'bbbbbbbb-0000-4000-8000-000000000901', starts_at: sp(HOJE, '15:00'), ends_at: sp(HOJE, '16:00'), reason_code: 'agenda_propria', resources: [USG] }] } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-agenda');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Pedidos|Agenda');
  assert.equal(await page.getAttribute('#tab-agenda', 'aria-selected'), 'true', 'a agenda ativa abre na aba Agenda');
  await page.waitForSelector('#agMain .ag-lista');
  assert.match(await page.textContent('#agTitulo'), /Hoje, quarta-feira, 4 de novembro/);
  assert.equal(await page.getAttribute('[data-view="hoje"]', 'aria-pressed'), 'true');
  const itens = await nomesFalados(page, '#agMain [data-act="abrir"]');
  assert.equal(itens.length, 3, 'cancelado só com "Mostrar cancelados"');
  assert.equal(itens[0], '|09:00 às 09:30, Maria L., Ultrassom de abdome <b>total</b> · Aparelho de Ultrassom <b>1</b> · Site do IMED, Confirmado', 'sem aria-label; o texto à vista e o escondido, na ordem');
  assert.equal(await page.$$eval('#agMain b', (b) => b.filter((x) => /total|Souza|^1$/.test(x.textContent)).length), 0, 'nomes vindos do banco são escapados (sem <b> de verdade)');
  assert.match(await page.textContent('#agMain'), /Paciente presente/);
  assert.match(await page.textContent('#agMain'), /Ocupado \(agenda própria\)/);
  await coresComTexto(page);
  // legenda: 6 tons, todos com texto; "Fechado" com a mesma hachura da grade (antes era um selo cinza liso)
  const leg = await page.$$eval('#agLegenda li', (l) => l.map((x) => [x.className, x.textContent.trim(), getComputedStyle(x).backgroundImage, getComputedStyle(x).borderTopStyle]));
  assert.equal(new Set(leg.map(([c]) => /ag-tom-(\w+)/.exec(c)[1])).size, 6);
  assert.ok(leg.every(([, t]) => t.length > 2));
  const fechadoLeg = leg.find(([, t]) => t === 'Fechado');
  assert.match(fechadoLeg[0], /ag-leg-fechado/);
  assert.match(fechadoLeg[2], /repeating-linear-gradient/, 'a legenda "Fechado" tem a hachura');
  assert.equal(fechadoLeg[3], 'dashed');
  // mostrar cancelados
  await page.check('#agFCancel');
  assert.equal(await page.locator('#agMain [data-act="abrir"]').count(), 4);
  assert.match(await page.textContent('#agMain'), /Cancelado/);
  assert.equal(calls(log, 'agenda_catalog').length, 1);
  semLeituraDireta(db);
  await shot(page, 'ag-01-hoje');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('teclado: troca de visão com aria-pressed, abre o detalhe (foco no título) e Esc devolve o foco ao item', async () => {
  const { page, db, errors, context } = await newPage(browser, { db: { requests: dia1() } });
  await abrirAgenda(page);
  await page.focus('[data-view="hoje"]');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.view), 'dia');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#agMain .ag-grade');
  assert.equal(await page.getAttribute('[data-view="dia"]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('[data-view="hoje"]', 'aria-pressed'), 'false');
  // item da grade: Enter abre o detalhe
  const sel = `#agMain [data-act="abrir"][data-item="${db.requests[0].items[0].id}"]`;
  await page.focus(sel);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#agDet:not([hidden]) .ag-dl');
  assert.equal(await focusId(page), 'agDetT');
  assert.match(await page.textContent('#agDetT'), /Maria <b>Souza<\/b> Lima/);
  assert.match(await page.textContent('#agDet'), /\(11\) 98888-7777/);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#agDet[hidden]', { state: 'attached' });
  assert.equal(await page.evaluate((s) => document.activeElement === document.querySelector(s), sel), true, 'o foco volta ao item');
  // Espaço também abre
  await page.keyboard.press(' ');
  await page.waitForSelector('#agDet:not([hidden]) .ag-dl');
  await page.click('#agDetFechar');
  assert.ok(db.accessLog >= 2, 'cada abertura do detalhe é uma leitura registrada');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('avisos e lembretes do agendamento (5.3): a lista com a situação por extenso, envio desligado dito na tela, nenhum destino; banco de antes', async () => {
  const reqs = dia1();
  const id = reqs[0].id;
  const notifications = { [id]: [
    { event_type: 'confirmado', channel: 'email', recipient_kind: 'paciente', send_after: '2026-11-03T15:00:00Z', notification_status: 'sem_canal', sent_at: null },
    { event_type: 'confirmado', channel: 'email', recipient_kind: 'clinica', send_after: '2026-11-03T15:00:00Z', notification_status: 'enviada', sent_at: '2026-11-03T15:00:20Z' },
    { event_type: 'lembrete_24h', channel: 'email', recipient_kind: 'paciente', send_after: '2026-11-03T16:00:00Z', notification_status: 'cancelada', sent_at: null },
    { event_type: 'lembrete_2h', channel: 'email', recipient_kind: 'paciente', send_after: '2026-11-04T18:00:00Z', notification_status: 'agendada', sent_at: null },
    { event_type: 'evento_que_a_tela_nao_conhece', channel: 'email', recipient_kind: 'paciente', send_after: '2026-11-04T18:00:00Z', notification_status: 'agendada', sent_at: null },
  ] };
  let { page, log, errors, context } = await newPage(browser, { db: { requests: reqs, notifications } });
  await abrirAgenda(page);
  await page.click(`#agMain [data-act="abrir"][data-item="${reqs[0].items[0].id}"]`);
  await page.waitForSelector('#agDet:not([hidden]) .ag-dl');
  const botao = '#agDet [data-act="avisos"]';
  assert.equal(await page.getAttribute(botao, 'aria-expanded'), 'false');
  assert.equal((await page.textContent(botao)).trim(), 'Ver avisos e lembretes');
  await page.focus(botao);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#agDet .ag-avisos');
  assert.equal(await focusId(page), 'agAvT', 'o foco vai para o título da lista');
  assert.deepEqual(log.filter((e) => e.path === 'rpc/agenda_notify_list').map((e) => e.body), [{ p_request: id }]);
  assert.match(await page.textContent('#agDet section[aria-labelledby="agAvT"]'), /O envio de avisos ainda não está ligado pelo IMED: nada é enviado por enquanto\./);
  assert.deepEqual(await page.locator('#agDet .ag-av').evaluateAll((els) => els.map((e) => [...e.children].map((c) => c.textContent))), [
    ['Confirmação do agendamento', 'Paciente · E-mail', 'Não enviado: o envio de avisos ainda não está ligado'],
    ['Confirmação do agendamento', 'Clínica · E-mail', 'Enviado em ter., 03/11 às 12:00'],
    ['Lembrete de 24 horas antes', 'Paciente · E-mail', 'Cancelado (deixou de ser necessário)'],
    ['Lembrete de 2 horas antes', 'Paciente · E-mail', 'Preparado para qua., 04/11 às 15:00'],
  ], 'cada aviso com a situação por extenso; o evento desconhecido não aparece');
  assert.doesNotMatch(await page.textContent('#agDet .ag-avisos'), /@|\(11\)/, 'a lista não mostra e-mail nem telefone');
  await shot(page, 'ag-53-avisos-do-agendamento');
  assert.equal(await page.getAttribute(botao, 'aria-expanded'), 'true');
  assert.equal((await page.textContent(botao)).trim(), 'Esconder os avisos');
  await page.click(botao);
  assert.equal(await page.locator('#agDet .ag-avisos').count(), 0);
  assert.equal(await focusId(page) === '' ? await page.evaluate(() => document.activeElement?.dataset.act) : 'avisos', 'avisos', 'o foco fica no botão');
  assert.deepEqual(errors, []);
  await context.close();

  // agendamento sem nenhum aviso preparado e com o envio ligado
  const reqs2 = dia1();
  ({ page, errors, context } = await newPage(browser, { db: { requests: reqs2, notifications: {}, sending: true } }));
  await abrirAgenda(page);
  await page.click(`#agMain [data-act="abrir"][data-item="${reqs2[0].items[0].id}"]`);
  await page.waitForSelector('#agDet:not([hidden]) .ag-dl');
  await page.click(botao);
  await page.waitForSelector('#agAvT');
  const vazio = await page.textContent('#agDet section[aria-labelledby="agAvT"]');
  assert.match(vazio, /Nenhum aviso preparado para este agendamento\./);
  assert.doesNotMatch(vazio, /ainda não está ligado/);
  assert.deepEqual(errors, []);
  await context.close();

  // banco de antes (sem a função): a tela diz que ainda não há avisos, sem erro e sem lista
  const reqs3 = dia1();
  ({ page, errors, context } = await newPage(browser, { db: { requests: reqs3 }, missing: ['agenda_notify_list'] }));
  await abrirAgenda(page);
  await page.click(`#agMain [data-act="abrir"][data-item="${reqs3[0].items[0].id}"]`);
  await page.waitForSelector('#agDet:not([hidden]) .ag-dl');
  await page.click(botao);
  await page.waitForFunction(() => /ainda não estão disponíveis/.test(document.querySelector('#agDetMsg')?.textContent || ''));
  assert.equal(await page.locator('#agDet .ag-avisos').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

// Espera a agenda terminar de carregar (a grade, a lista ou o mês já desenhados com os dados novos).
const carregada = (page) => page.waitForFunction(() => !document.querySelector('#agMain[aria-busy="true"]'));
const focoEm = (page, sel) => page.evaluate((s) => document.activeElement === document.querySelector(s), sel);

await scenario('teclado: o foco fica no botão usado depois de carregar (visão, Próximo duas vezes, Ir para hoje, voltar à aba) e o novo período é dito', async () => {
  const { page, db, errors, context } = await newPage(browser, { db: { requests: dia1() } });
  await abrirAgenda(page);
  await page.focus('[data-view="dia"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#agMain .ag-grade');
  await carregada(page);
  assert.ok(await focoEm(page, '[data-view="dia"]'), 'depois de carregar a visão Dia, o foco continua em "Dia"');
  await page.waitForFunction(() => /Mostrando hoje, quarta-feira, 4 de novembro/.test(document.querySelector('#agFala').textContent));
  await page.keyboard.press('Tab');
  assert.ok(await focoEm(page, '[data-view="semana"]'), 'o Tab seguinte vai para "Semana" (e não volta ao começo da página)');
  await page.focus('[data-act="prox"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /quinta-feira, 5 de novembro/.test(document.querySelector('#agTitulo').textContent));
  await carregada(page);
  assert.ok(await focoEm(page, '[data-act="prox"]'), 'depois de carregar o dia seguinte, o foco continua em "Próximo"');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /sexta-feira, 6 de novembro/.test(document.querySelector('#agTitulo').textContent));
  await carregada(page);
  assert.ok(await focoEm(page, '[data-act="prox"]'), 'o 2º Enter também avança e o foco continua no botão');
  await page.waitForFunction(() => /Mostrando sexta-feira, 6 de novembro/.test(document.querySelector('#agFala').textContent));
  assert.equal(await page.$$eval('#agTop button', (b) => b.filter((x) => x.textContent.trim() === 'Hoje').length), 1, 'só um botão "Hoje" na barra (o da visão)');
  assert.equal((await page.textContent('[data-act="hojebtn"]')).trim(), 'Ir para hoje', 'o da navegação diz "Ir para hoje"');
  await page.focus('[data-act="hojebtn"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Hoje, quarta-feira, 4 de novembro/.test(document.querySelector('#agTitulo').textContent));
  await carregada(page);
  assert.ok(await focoEm(page, '[data-act="hojebtn"]'));
  // a agenda mudou com a aba fechada: ao voltar, a releitura não tira o foco do item
  const item = `#agMain [data-act="abrir"][data-item="${db.requests[0].items[0].id}"]`;
  await page.focus(item);
  db.version += 1;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => /mudou enquanto/.test(document.querySelector('#agMsg')?.textContent || ''));
  assert.ok(await focoEm(page, item), 'o foco continua no mesmo item depois de reler');
  await page.waitForFunction(() => /mudou enquanto esta página estava fechada/.test(document.querySelector('#agFala').textContent), null, { timeout: 2000 });
  // mês: Enter numa célula abre o dia e o foco fica no título
  await page.click('[data-view="mes"]');
  await page.waitForSelector('#agMain .ag-mes');
  await carregada(page);
  await page.focus(`[data-act="abrir-dia"][data-dia="${AMANHA}"]`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /quinta-feira, 5 de novembro/.test(document.querySelector('#agTitulo').textContent));
  await carregada(page);
  assert.equal(await focusId(page), 'agTitulo');
  assert.deepEqual(errors, []);
  await context.close();
});

// O Chrome sem tela mostra o campo de data como mm/dd/aaaa mesmo em pt-BR: descobre a ordem num campo de teste.
async function ordemDaData(page) {
  await page.evaluate(() => { const i = document.createElement('input'); i.type = 'date'; i.id = 'ordemTeste'; document.body.append(i); });
  await page.focus('#ordemTeste');
  await page.keyboard.type('12112026');
  const v = await page.inputValue('#ordemTeste');
  await page.evaluate(() => document.getElementById('ordemTeste').remove());
  assert.ok(['2026-12-11', '2026-11-12'].includes(v), `ordem do campo de data desconhecida (${v})`);
  return v === '2026-12-11' ? 'mda' : 'dma';
}
const teclasDaData = (ordem, iso) => { const [a, m, d] = iso.split('-'); return ordem === 'mda' ? `${m}${d}${a}` : `${d}${m}${a}`; };
// Entra de novo no campo pela 1ª parte (o Chrome lembra a última parte usada: depois de digitar o ano, o cursor fica nele).
const entrarNoCampo = (page, sel) => page.click(sel, { position: { x: 18, y: 14 } });

await scenario('data digitada: "Ir para a data" só vale no fim (Enter, sair do campo ou pausa), sem pular nem perder o foco; o dia do novo agendamento não é refeito a cada tecla', async () => {
  const { page, log, errors, context } = await newPage(browser, { db: { requests: dia1() } });
  await abrirAgenda(page);
  const ordem = await ordemDaData(page);
  await page.click('[data-view="dia"]');
  await page.waitForSelector('#agMain .ag-grade');
  await carregada(page);
  const antes = calls(log, 'agenda_view').length;
  await page.focus('#agData');
  await page.keyboard.type(teclasDaData(ordem, '2026-11-20'), { delay: 150 });
  assert.match(await page.textContent('#agTitulo'), /Hoje, quarta-feira, 4 de novembro/, 'enquanto digita, a agenda não pula para outra data');
  assert.equal(calls(log, 'agenda_view').length, antes, 'nenhuma leitura no meio da digitação');
  assert.equal(await page.inputValue('#agData'), '2026-11-20', 'o campo não é refeito no meio da digitação');
  assert.equal(await focusId(page), 'agData');
  // pausa: vale a data digitada, com o foco no campo
  await page.waitForFunction(() => /sexta-feira, 20 de novembro/.test(document.querySelector('#agTitulo').textContent));
  await carregada(page);
  assert.equal(await focusId(page), 'agData');
  assert.equal(calls(log, 'agenda_view').at(-1).body.p_from, '2026-11-20');
  assert.deepEqual(calls(log, 'agenda_view').slice(antes).map((c) => c.body.p_from), ['2026-11-20'], 'uma leitura só, da data inteira');
  await page.waitForFunction(() => /Mostrando sexta-feira, 20 de novembro/.test(document.querySelector('#agFala').textContent));
  // Enter vale na hora (só o dia e o mês: o ano continua 2026)
  await entrarNoCampo(page, '#agData');
  await page.keyboard.type(teclasDaData(ordem, '2026-11-25').slice(0, 4), { delay: 50 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /quarta-feira, 25 de novembro/.test(document.querySelector('#agTitulo').textContent), null, { timeout: 600 });
  await carregada(page);
  assert.equal(await focusId(page), 'agData');
  // sair do campo (Tab) também vale
  await entrarNoCampo(page, '#agData');
  await page.keyboard.type(teclasDaData(ordem, '2026-11-27').slice(0, 4), { delay: 50 });
  // o Chrome tem paradas de Tab dentro do campo (as partes e o botão do calendário): Tab até sair dele
  for (let i = 0; i < 5 && await focusId(page) === 'agData'; i += 1) await page.keyboard.press('Tab');
  await page.waitForFunction(() => /sexta-feira, 27 de novembro/.test(document.querySelector('#agTitulo').textContent), null, { timeout: 600 });
  assert.notEqual(await focusId(page), 'agData');
  // novo agendamento: digitar o dia não refaz o formulário; os horários de antes saem
  await page.click('#agNovo');
  await page.waitForSelector('#bkForm');
  await page.selectOption('#bkProc', P_USG);
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  await page.focus('#bkDia');
  await page.keyboard.type(teclasDaData(ordem, '2026-11-20'), { delay: 150 });
  assert.equal(await page.inputValue('#bkDia'), '2026-11-20', 'o dia digitado fica como foi digitado');
  assert.equal(await focusId(page), 'bkDia');
  assert.equal(await page.locator('input[name="bkSlot"]').count(), 0, 'os horários do outro dia saem');
  assert.match(await page.textContent('#bkProcInfo'), /Jejum de 8 horas/, 'o resto do formulário continua igual');
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  assert.equal(calls(log, 'agenda_desk_slots').at(-1).body.p_from, '2026-11-20');
  assert.deepEqual(errors, []);
  await context.close();
});

// Mede cada botão da grade: tamanho, a hora e a situação dentro dele, e se algum cobre outro.
const medirGrade = (page, sel) => page.$$eval(sel, (els) => {
  const rs = els.map((b) => b.getBoundingClientRect());
  return els.map((b, i) => {
    const r = rs[i];
    const dentro = (x) => !x || (x.top >= r.top - 0.5 && x.bottom <= r.bottom + 0.5 && x.left >= r.left - 0.5 && x.right <= r.right + 0.5);
    const cobre = rs.some((o, j) => j !== i && Math.min(r.right, o.right) - Math.max(r.left, o.left) > 1 && Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) > 1);
    return { w: r.width, h: r.height, st: dentro(b.querySelector('.ag-st')?.getBoundingClientRect()), hora: dentro(b.querySelector('.ag-hora')?.getBoundingClientRect()), cobre, txt: b.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) };
  });
});
const gradeBoa = (lista, onde) => {
  assert.ok(lista.length > 0, `${onde}: há botões na grade`);
  for (const x of lista) {
    assert.ok(x.h >= 40 && x.w >= 24, `${onde}: alvo de pelo menos 24 px (e 40 de altura): ${x.txt} ${Math.round(x.w)}x${Math.round(x.h)}`);
    assert.ok(x.st && x.hora, `${onde}: a hora e a situação à vista dentro do botão: ${x.txt}`);
    assert.ok(!x.cobre, `${onde}: nenhum item cobre outro: ${x.txt}`);
  }
};

await scenario('grade (computador): exames de 15 e 10 min e "só ocupar" de 5 min com a hora e a situação à vista, alvos grandes e ninguém por cima de ninguém; a Semana cabe em 1024 px, com o dia no nome falado, "Fechado" escrito e "hoje" escrito', async () => {
  const extra = [4, 5, 6].map((i) => ({ id: `rrrrrrrr-0000-4000-8000-00000000001${i}`, kind: 'sala', name: `Sala ${i}`, capacity: 1, active: true, member: null }));
  const reqs = [];
  const add = (start, min, name, status = 'confirmed', res = [USG]) => { const b = booking({ name, start, status, res }); const fim = new Date(Date.parse(start) + min * 60000).toISOString(); b.items[0].ends_at = fim; b.slot_end = fim; reqs.push(b); };
  add(sp(HOJE, '11:00'), 15, 'Rita Curta Teste');
  add(sp(HOJE, '11:15'), 15, 'Ana Curta Teste', 'checked_in');
  add(sp(HOJE, '11:30'), 15, 'Gil Curto Teste', 'hold');
  add(sp(HOJE, '13:00'), 30, 'Lia Meia Hora Teste');
  add(sp(HOJE, '14:00'), 10, 'Duda Dez Teste', 'confirmed', [SALA]);
  add(sp(HOJE, '14:10'), 10, 'Edu Dez Teste', 'no_show', [SALA]);
  add(sp(HOJE, '14:20'), 10, 'Fabi Dez Teste', 'reschedule_requested', [SALA]);
  const busy = [0, 5, 10].map((m, i) => ({ id: `bbbbbbbb-0000-4000-8000-00000000090${i}`, starts_at: sp(HOJE, `17:${String(m).padStart(2, '0')}`), ends_at: sp(HOJE, `17:${String(m + 5).padStart(2, '0')}`), reason_code: 'uso_interno', resources: [DRA] }));
  const { page, errors, context } = await newPage(browser, { db: { requests: reqs, busy, resources: [...RESOURCES(), ...extra], fechado: [['12:00', '13:00']], fechadoDias: [0] } });
  await abrirAgenda(page);
  await page.click('[data-view="dia"]');
  await page.waitForSelector('#agMain .ag-grade');
  await carregada(page);
  const semRolagem = () => page.evaluate(() => { const g = document.querySelector('#agMain .ag-grade'); return g.scrollWidth <= g.clientWidth; });
  assert.ok(await semRolagem(), 'Dia com 6 aparelhos e salas: sem rolagem para o lado em 1024 px');
  gradeBoa(await medirGrade(page, '#agMain .ag-grade button.ag-ev'), 'Dia');
  // o véu "Já passou" (até as 10:00) não fica por cima de "Livre" nem de "Fechado": essas faixas começam no agora
  assert.equal(await page.evaluate(() => { const v = document.querySelector('.ag-passou').getBoundingClientRect(); return [...document.querySelectorAll('.ag-livre, .ag-fechado')].filter((b) => b.getBoundingClientRect().top < v.bottom - 1).length; }), 0);
  assert.ok(await page.locator('#agMain .ag-fechado').count() > 0, 'o almoço aparece como "Fechado"');
  // a palavra curta à vista também está no nome falado (comando de voz: "clicar Faltou")
  const nomes = await nomesFalados(page, '#agMain .ag-grade [data-act="abrir"]');
  assert.ok(nomes.some((n) => /^\|14:10 às 14:20, Faltou \(Não compareceu\), /.test(n)), nomes.join('\n'));
  assert.ok(nomes.some((n) => /^\|14:20 às 14:30, Remarcar \(Remarcação solicitada\), /.test(n)));
  assert.ok(nomes.some((n) => /^\|11:15 às 11:30, Paciente presente, /.test(n)), 'quando a palavra curta já está no texto inteiro, só o inteiro');
  await page.click('[data-view="semana"]');
  await page.waitForSelector('#agMain .ag-semana');
  await carregada(page);
  assert.ok(await semRolagem(), 'a Semana cabe inteira em 1024 px');
  assert.ok(await page.evaluate(() => { const g = document.querySelector('#agMain .ag-grade').getBoundingClientRect(); return [...document.querySelectorAll('.ag-cab-dia')].every((c) => c.getBoundingClientRect().right <= g.right + 0.5); }), 'o domingo aparece');
  gradeBoa(await medirGrade(page, '#agMain .ag-semana button.ag-ev'), 'Semana');
  const nomesS = await nomesFalados(page, '#agMain .ag-semana button.ag-ev');
  assert.match(nomesS[0], /^\|quarta-feira, 4 de novembro, 11:00 às 11:15, Confirmado, Rita T\., /, 'na Semana o nome falado diz o dia');
  assert.ok(nomesS.some((n) => /^\|quarta-feira, 4 de novembro, 17:00 às 17:05, Ocupado \(uso interno\)/.test(n)));
  assert.ok(await page.locator('#agMain .ag-semana .ag-fechado').count() >= 5, 'almoço e domingo com a palavra "Fechado" na Semana');
  assert.match(await page.textContent('#agMain .ag-semana .ag-fechado'), /Fechado/);
  assert.match((await nomesFalados(page, '.ag-cab-dia.ag-hoje'))[0], /^\|qua\., 04\/11, hoje: abrir o dia quarta-feira, 4 de novembro$/);
  assert.equal(await page.locator('.ag-cab-dia .ag-hoje-tag').count(), 1);
  // detalhe aberto na Semana: vai para baixo da grade, que continua com os 7 dias
  await page.click('#agMain .ag-semana [data-act="abrir"] >> nth=0');
  await page.waitForSelector('#agDet:not([hidden]) .ag-dl');
  assert.equal(await page.evaluate(() => document.querySelector('#agCorpo').classList.contains('ag-com-det')), false);
  assert.ok(await semRolagem(), 'com o detalhe aberto, a Semana continua inteira');
  // lista do dia: horas são títulos, não regiões (marcos)
  await page.click('#agDetFechar');
  await page.click('#agModo');
  await page.waitForSelector('#agMain .ag-wdia');
  assert.equal(await page.locator('#agMain section, #agMain [role="region"]').count(), 0, 'sem uma região por dia');
  await page.click('[data-view="hoje"]');
  await page.waitForSelector('#agMain .ag-lista');
  assert.equal(await page.locator('#agMain section, #agMain [role="region"]').count(), 0, 'sem uma região por hora');
  assert.ok(await page.locator('#agMain h4.ag-hh').count() >= 3);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Chegou: desligado antes da janela (06:59), às 10:00 marca, vira "Paciente presente" e o foco vai para "Em atendimento"', async () => {
  {
    const { page, errors, context } = await newPage(browser, { now: '2026-11-04T09:59:00Z', db: { requests: [booking({ start: sp(HOJE, '09:00') })] } });
    await abrirAgenda(page);
    const b = page.locator('#agMain [data-act="atender"][data-k="chegou"]');
    assert.equal(await b.isDisabled(), true);
    assert.match(await page.textContent('#agMain .ag-acoes'), /Chegada a partir das 07:00/);
    assert.deepEqual(errors, []);
    await context.close();
  }
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [booking({ start: sp(HOJE, '10:30') })] } });
  await abrirAgenda(page);
  const r = db.requests[0];
  await page.click('#agMain [data-act="atender"][data-k="chegou"]');
  await page.waitForFunction(() => /Paciente presente/.test(document.querySelector('#agMain').textContent));
  const c = calls(log, 'agenda_attend').at(-1).body;
  assert.deepEqual(c, { p_id: r.id, p_status: 'checked_in', p_version: 1, p_item: r.items[0].id });
  assert.equal(await focusText(page), 'Em atendimento');
  assert.match(await page.textContent('#agMsg'), /Paciente presente/);
  // dito UMA vez: pela região viva que está sempre na página; o aviso à vista e o do alto não falam de novo
  await page.waitForFunction(() => /Maria L\.: Paciente presente/.test(document.querySelector('#agFala').textContent));
  assert.equal(await page.locator('#agMsg [role], #agMsg[aria-live]').count(), 0, 'o aviso à vista não é outra região viva');
  assert.match(await page.textContent('#toast'), /Paciente presente/);
  assert.equal(await page.getAttribute('#toast', 'aria-hidden'), 'true', 'o aviso do alto é só para os olhos');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#agFala')).display), 'block', 'a região viva está na página antes de receber o texto');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Não compareceu: antes da tolerância desligado; depois, confirmação na tela; "Desfazer falta" pede o motivo', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { now: '2026-11-04T12:14:00Z', db: { requests: [booking({ start: sp(HOJE, '09:00') })] } });
  await abrirAgenda(page);
  assert.equal(await page.locator('[data-act="atender"][data-k="faltou"]').isDisabled(), true);
  assert.match(await page.textContent('#agMain'), /Disponível a partir das 09:15/);
  await context.clock.setFixedTime(new Date('2026-11-04T12:16:00Z'));
  db.now = Date.parse('2026-11-04T12:16:00Z');
  await page.click('[data-act="atualizar"]');
  await page.waitForFunction(() => !document.querySelector('[data-act="atender"][data-k="faltou"]')?.disabled);
  await page.click('[data-act="atender"][data-k="faltou"]');
  assert.equal(await focusId(page), 'agAskSim');
  assert.match(await page.textContent('#agAskT'), /Marcar que Maria L\. não compareceu \(04\/11, 09:00\)\?/);
  assert.equal(calls(log, 'agenda_attend').length, 0, 'nada antes de confirmar');
  await page.click('[data-act="voltar-ask"]');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.k), 'faltou', 'Voltar devolve o foco');
  await page.click('[data-act="atender"][data-k="faltou"]');
  await page.click('#agAskSim');
  await page.waitForFunction(() => /Não compareceu/.test(document.querySelector('#agMain .ag-st')?.textContent || ''));
  assert.match(await page.getAttribute('#agMain .ag-li', 'class'), /ag-tom-cinza/);
  // desfazer falta: sem motivo, erro e foco no campo
  await page.click('[data-act="atender"][data-k="desfazer"]');
  assert.equal(await focusId(page), 'agAskMotivo');
  await page.click('#agAskSim');
  assert.match(await page.textContent('#agAskMotivoErr'), /Escolha o motivo/);
  assert.equal(await focusId(page), 'agAskMotivo');
  await page.selectOption('#agAskMotivo', 'chegou_atrasado');
  await page.click('#agAskSim');
  await page.waitForFunction(() => /Paciente presente/.test(document.querySelector('#agMain').textContent));
  assert.equal(calls(log, 'agenda_attend').at(-1).body.p_reason, 'chegou_atrasado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('version_conflict: mensagem clara e a agenda é lida de novo', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [booking({ start: sp(HOJE, '10:30') })] } });
  await abrirAgenda(page);
  const antes = calls(log, 'agenda_view').length;
  db.once.agenda_attend = { status: 'version_conflict', version: 7 };
  await page.click('[data-act="atender"][data-k="chegou"]');
  await page.waitForFunction(() => /Outra pessoa mudou este agendamento/.test(document.querySelector('#agMsg').textContent));
  assert.ok(calls(log, 'agenda_view').length > antes, 'leu a agenda de novo');
  assert.equal(await page.getAttribute('#agMsg [role=alert]', 'role'), 'alert');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('novo agendamento pelo telefone: exame, dia, horário, paciente, aviso; erros com foco; o item aparece', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: dia1() } });
  await abrirAgenda(page);
  await page.click('#agNovo');
  assert.equal(await focusId(page), 'bkT');
  await page.selectOption('#bkProc', P_USG);
  assert.match(await page.textContent('#bkProcInfo'), /Jejum de 8 horas/);
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  assert.deepEqual(calls(log, 'agenda_desk_slots').at(-1).body, { p_clinic: C1, p_procedure: P_USG, p_from: HOJE });
  assert.match(await page.textContent('#bkSlots'), /Manhã/);
  await page.check(`input[name="bkSlot"][value="${sp(HOJE, '10:30')}"]`);
  await page.fill('#bkNome', 'Beatriz <b>Nova</b> Teste');
  await page.fill('#bkFone', '(11) 96666-5555');
  // sem o aviso: erro no campo e foco nele
  await page.click('#bkOk');
  assert.match(await page.textContent('#bkConsentErr'), /foi avisada/);
  assert.equal(await focusId(page), 'bkConsent');
  assert.equal(calls(log, 'agenda_desk_book').length, 0);
  // todo grupo de opções tem nome: "Como a pessoa pediu" é o fieldset com legenda (sem radiogroup sem nome dentro)
  assert.equal(await page.locator('#bkForm [role="radiogroup"]:not([aria-label]):not([aria-labelledby])').count(), 0);
  assert.equal(await page.getAttribute('input[name="bkCanal"] >> nth=0', 'aria-describedby'), 'bkCanalErr');
  await page.check('#bkConsent');
  await page.click('#bkOk');
  await page.waitForSelector('#bkFeito');
  const c = calls(log, 'agenda_desk_book').at(-1).body;
  assert.equal(c.p_clinic, C1);
  assert.deepEqual(c.p_items, [{ procedure_id: P_USG, starts_at: '2026-11-04T13:30:00.000Z' }]);
  assert.equal(c.p_channel, 'clinica_telefone');
  assert.match(c.p_key, /^[0-9a-f-]{36}$/);
  assert.deepEqual(c.p_patient, { name: 'Beatriz <b>Nova</b> Teste', phone: '11966665555', consent: true, for_other: false });
  assert.match(await page.textContent('#bkFeito'), /Agendado: Beatriz T\., Ultrassom de abdome <b>total<\/b>, qua\., 04\/11 às 10:30\./);
  assert.equal(await focusId(page), 'bkFeito');
  await page.waitForFunction(() => /Beatriz T\./.test(document.querySelector('#agMain').textContent));
  assert.equal(db.requests.length, 5);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('reenvio: a 1ª chamada falha na rede e a 2ª passa com a MESMA chave; um agendamento só', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { failNet: { agenda_desk_book: 1 } } });
  await abrirAgenda(page);
  await page.click('#agNovo');
  await page.selectOption('#bkProc', P_USG);
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  await page.check(`input[name="bkSlot"][value="${sp(HOJE, '11:00')}"]`);
  await page.fill('#bkNome', 'Paciente Teste Um');
  await page.fill('#bkFone', '11955554444');
  await page.check('#bkConsent');
  await page.click('#bkOk');
  await page.waitForFunction(() => /Não foi possível falar com o servidor/.test(document.querySelector('#bkMsg')?.textContent || ''));
  await page.click('#bkOk');
  await page.waitForSelector('#bkFeito');
  const k = log.filter((e) => e.path === 'rpc/agenda_desk_book').map((e) => e.body.p_key);
  assert.equal(k.length, 2);
  assert.equal(k[0], k[1], 'a mesma chave nas duas tentativas');
  assert.equal(db.requests.length, 1, 'um agendamento só');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('slot_taken: até 5 horários como botões; escolher manda de novo com OUTRA chave', async () => {
  const { page, db, log, errors, context } = await newPage(browser);
  await abrirAgenda(page);
  await page.click('#agNovo');
  await page.selectOption('#bkProc', P_USG);
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  await page.check(`input[name="bkSlot"][value="${sp(HOJE, '11:00')}"]`);
  await page.fill('#bkNome', 'Paciente Teste Dois');
  await page.fill('#bkFone', '11955553333');
  await page.check('#bkConsent');
  db.once.agenda_desk_book = { status: 'slot_taken', seq: 1, alternatives: [sp(HOJE, '11:30'), sp(HOJE, '12:00'), sp(HOJE, '12:30'), sp(HOJE, '13:00'), sp(HOJE, '13:30'), sp(HOJE, '14:00')] };
  await page.click('#bkOk');
  await page.waitForSelector('[data-act="bk-alt"]');
  assert.equal(await page.locator('[data-act="bk-alt"]').count(), 5);
  assert.match(await page.textContent('#bkAltT'), /acabou de ser ocupado/);
  assert.equal(await focusText(page), 'Marcar às 11:30');
  await page.click('[data-act="bk-alt"] >> nth=1');
  await page.waitForSelector('#bkFeito');
  const k = log.filter((e) => e.path === 'rpc/agenda_desk_book');
  assert.notEqual(k[0].body.p_key, k[1].body.p_key, 'outra chave');
  assert.equal(k[1].body.p_items[0].starts_at, '2026-11-04T15:00:00.000Z');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('sem horário por feriados: o texto explica (feriados nacionais e os da cidade)', async () => {
  const { page, db, errors, context } = await newPage(browser, { db: { desk: { status: 'ok', timezone: 'America/Sao_Paulo', from: HOJE, to: HOJE, slots: [], holidays_checked_until: '2026-12-31', national_holidays_until: null } } });
  await abrirAgenda(page);
  await page.click('#agNovo');
  await page.selectOption('#bkProc', P_USG);
  await page.click('#bkVer');
  await page.waitForSelector('#bkSemHorario');
  assert.match(await page.textContent('#bkSemHorario'), /o IMED ainda não lançou os feriados nacionais/);
  db.desk = { ...db.desk, holidays_checked_until: null, national_holidays_until: '2026-12-31' };
  await page.click('#bkVer');
  await page.waitForFunction(() => /falta informar até quando a clínica conferiu os feriados/.test(document.querySelector('#bkSemHorario')?.textContent || ''));
  assert.match(await page.textContent('#bkSemHorario'), /Peça ao dono ou gestor/);
  db.desk = { ...db.desk, holidays_checked_until: '2026-11-03', national_holidays_until: '2026-12-31' };
  await page.click('#bkVer');
  await page.waitForFunction(() => /só foram conferidos até 03\/11\/2026/.test(document.querySelector('#bkSemHorario')?.textContent || ''));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('só ocupar: 14:00–15:00 vai com o fuso certo, aparece em vermelho com texto; liberar com confirmação', async () => {
  const { page, db, log, errors, context } = await newPage(browser);
  await abrirAgenda(page);
  await page.click('#agOcupar');
  assert.equal(await focusId(page), 'ocT');
  await page.selectOption('#ocRec', USG);
  await page.fill('#ocIni', '14:00');
  await page.fill('#ocFim', '15:00');
  await page.selectOption('#ocMotivo', 'agenda_propria');
  await page.click('#ocOk');
  await page.waitForFunction(() => /Ocupado \(agenda própria\)/.test(document.querySelector('#agMain').textContent));
  const c = calls(log, 'agenda_desk_busy').at(-1).body;
  assert.deepEqual(c, { p_clinic: C1, p_starts: '2026-11-04T17:00:00.000Z', p_ends: '2026-11-04T18:00:00.000Z', p_resource: USG, p_procedure: null, p_reason: 'agenda_propria' });
  assert.match(await page.getAttribute('#agMain [data-act="ocupado"]', 'class') + await page.evaluate(() => document.querySelector('#agMain [data-act="ocupado"]').closest('li').className), /ag-tom-vermelho/);
  await page.click('#agMain [data-act="ocupado"]');
  await page.click('#agLiberar');
  assert.equal(await focusId(page), 'agLiberarSim');
  await page.click('#agLiberarSim');
  await page.waitForFunction(() => !/Ocupado \(agenda própria\)/.test(document.querySelector('#agMain').textContent));
  assert.equal(calls(log, 'agenda_desk_busy_remove').length, 1);
  assert.equal(db.busy.length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('cancelar: sem motivo dá erro; com motivo, confirmação e o item some', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [booking({ name: 'Carla Dias Teste', start: sp(HOJE, '16:00') })] } });
  await abrirAgenda(page);
  const r = db.requests[0];
  await page.click('#agMain [data-act="abrir"]');
  await page.waitForSelector('[data-act="cancelar"]');
  await page.click('[data-act="cancelar"]');
  assert.equal(await focusId(page), 'cnMotivo');
  await page.click('#cnOk');
  assert.match(await page.textContent('#cnMotivoErr'), /Escolha o motivo/);
  assert.equal(await focusId(page), 'cnMotivo');
  await page.selectOption('#cnMotivo', 'paciente_desistiu');
  await page.click('#cnOk');
  assert.equal(await focusId(page), 'cnSim');
  assert.match(await page.textContent('#cnAskT'), /Cancelar o agendamento de Carla T\. \(qua\., 04\/11 às 16:00\)\? O horário fica livre para outro paciente\.$/);
  await page.click('#cnSim');
  await page.waitForFunction(() => /cancelado/.test(document.querySelector('#agMsg').textContent));
  assert.deepEqual(calls(log, 'agenda_cancel').at(-1).body, { p_id: r.id, p_reason: 'paciente_desistiu', p_version: 1 });
  assert.match(await page.textContent('#agMain'), /Nenhum agendamento hoje/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('remarcar: dia, horários com p_request e p_item, confirmação "Mudar de … para …?" e agenda_reschedule', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [booking({ name: 'Rui Mota Teste', start: sp(HOJE, '16:00') })] } });
  await abrirAgenda(page);
  const r = db.requests[0];
  await page.click('#agMain [data-act="abrir"]');
  await page.click('[data-act="remarcar"]');
  assert.equal(await focusId(page), 'rmT');
  await page.fill('#rmDia', AMANHA);
  await page.click('#rmVer');
  await page.waitForSelector('input[name="rmSlot"]');
  assert.deepEqual(calls(log, 'agenda_desk_slots').at(-1).body, { p_clinic: C1, p_procedure: P_USG, p_from: AMANHA, p_to: null, p_request: r.id, p_item: r.items[0].id });
  await page.check(`input[name="rmSlot"][value="${sp(AMANHA, '10:00')}"]`);
  assert.match(await page.textContent('#rmAskT'), /Mudar de qua\., 04\/11 às 16:00 para qui\., 05\/11 às 10:00\?/);
  // a resposta se perde na rede: a tela guarda a chave e o "Sim, remarcar" de novo recebe replay
  db.lostReply = { agenda_reschedule: 1 };
  await page.click('#rmOk');
  await page.waitForFunction(() => /servidor/.test(document.querySelector('#agDet').textContent));
  await page.click('#rmOk');
  await page.waitForFunction(() => /remarcação já tinha sido registrada/.test(document.querySelector('#agMsg').textContent));
  assert.match(await page.textContent('#agMsg'), /^Esta remarcação já tinha sido registrada: Ultrassom .* para qui\., 05\/11 às 10:00\.$/);
  assert.equal(calls(log, 'agenda_reschedule').length, 2);
  assert.equal(calls(log, 'agenda_reschedule')[0].body.p_key, calls(log, 'agenda_reschedule')[1].body.p_key, 'a mesma chave');
  const c = calls(log, 'agenda_reschedule').at(-1).body;
  assert.deepEqual({ ...c, p_key: 'x' }, { p_id: r.id, p_items: [{ seq: 1, starts_at: '2026-11-05T13:00:00.000Z' }], p_key: 'x', p_version: 1 });
  assert.match(c.p_key, /^[0-9a-f-]{36}$/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('bloquear com afetados: lista com nomes curtos, "Bloquear mesmo assim", Para remarcar e remarcar tira da lista', async () => {
  const reqs = [booking({ name: 'Maria Souza Lima', start: sp(AMANHA, '09:00') }), booking({ name: 'Otávio Reis Teste', phone: '11944443333', start: sp(AMANHA, '10:00'), channel: 'clinica_telefone' })];
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: reqs, busy: [{ id: 'bbbbbbbb-0000-4000-8000-000000000902', starts_at: sp(AMANHA, '11:00'), ends_at: sp(AMANHA, '11:30'), reason_code: 'agenda_propria', resources: [USG] }] } });
  await abrirAgenda(page);
  await page.click('#agBloquear');
  assert.equal(await focusId(page), 'blFormT');
  await page.selectOption('#blAlvo', USG);
  await page.selectOption('#blTipo', 'manutencao');
  await page.check('input[name="blModo"][value="part"]');
  await page.fill('#blFrom', AMANHA);
  await page.fill('#blStart', '08:00');
  await page.fill('#blEnd', '12:00');
  await page.fill('#blMotivo', 'Troca da sonda');
  await page.click('#blOk');
  await page.waitForSelector('#blAfet .ag-afet');
  assert.equal(await focusId(page), 'blAfetT');
  assert.match(await page.textContent('#blAfetT'), /atinge 2 agendamentos e 1 horário “só ocupar”/);
  assert.match(await page.textContent('#blAfet'), /Maria L\./);
  assert.match(await page.textContent('#blAfet'), /Para remarcar/);
  const prev = calls(log, 'agenda_block_force').at(-1).body;
  assert.equal(prev.p_confirm, null);
  assert.equal(prev.p_starts, '2026-11-05T11:00:00.000Z');
  await page.click('#blForcar');
  await page.waitForSelector('#agRemT');
  assert.match(await page.textContent('#agMsg'), /Bloqueio salvo\. 2 pacientes foram para a lista Para remarcar/);
  assert.equal(await focusId(page), 'agRemT');
  assert.match(await page.textContent('#agRemT'), /Para remarcar \(2\)/);
  assert.match(await page.textContent('#agRem'), /Horário bloqueado pela clínica/);
  // remarcar o primeiro → resolve o conflito
  await page.click('[data-act="conf-remarcar"] >> nth=0');
  await page.waitForSelector('#rmT');
  await page.fill('#rmDia', AMANHA);
  db.deskSlots = [{ start: sp(AMANHA, '15:00'), end: sp(AMANHA, '15:30') }];
  await page.click('#rmVer');
  await page.check('input[name="rmSlot"]');
  await page.click('#rmOk');
  await page.waitForFunction(() => /Remarcado/.test(document.querySelector('#agMsg').textContent));
  // o banco fecha o conflito na remarcação (gatilho da 4.2): sai da lista sem a tela chamar agenda_conflict_resolve
  assert.equal(calls(log, 'agenda_conflict_resolve').length, 0);
  assert.equal(db.conflicts.filter((x) => x.status === 'resolvido' && x.resolution_code === 'remarcado').length, 1);
  assert.match(await page.textContent('#agRemT'), /Para remarcar \(1\)/);
  // cancelar o que ficou: o horário já foi solto e o período está bloqueado — nada de "fica livre"
  await page.click('[data-act="conf-cancelar"] >> nth=0');
  await page.waitForSelector('#cnMotivo');
  await page.selectOption('#cnMotivo', 'equipamento_manutencao');
  await page.click('#cnOk');
  const pergunta = await page.textContent('#cnAskT');
  assert.match(pergunta, /^Cancelar o agendamento de Otávio T\. \(qui\., 05\/11 às 10:00\)\? O paciente sai da lista Para remarcar\.$/);
  assert.doesNotMatch(pergunta, /livre/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('bloquear um período só com "só ocupar": sem falar de pacientes, e a mensagem diz que o "só ocupar" saiu', async () => {
  const ocup = () => [{ id: 'bbbbbbbb-0000-4000-8000-000000000903', starts_at: sp(AMANHA, '09:00'), ends_at: sp(AMANHA, '10:00'), reason_code: 'uso_interno', resources: [USG] }];
  const preencher = async (page) => {
    await page.click('#agBloquear');
    await page.selectOption('#blAlvo', USG);
    await page.selectOption('#blTipo', 'manutencao');
    await page.fill('#blFrom', AMANHA);
    await page.click('#blOk');
  };
  {
    const { page, db, errors, context } = await newPage(browser, { db: { busy: ocup() } });
    await abrirAgenda(page);
    await preencher(page);
    await page.waitForSelector('#blForcar');
    assert.equal(await focusId(page), 'blAfetT');
    const titulo = await page.textContent('#blAfetT');
    assert.match(titulo, /: atinge 1 horário “só ocupar”\.$/);
    assert.doesNotMatch(titulo, /agendamento/, 'nada de "0 agendamentos"');
    const ajuda = await page.textContent('#blAfet .cl-help');
    assert.match(ajuda, /Se bloquear mesmo assim, o horário “só ocupar” do período será retirado\. Nenhum paciente é atingido\./);
    assert.doesNotMatch(ajuda, /pacientes vão|avisá/);
    await page.click('#blForcar');
    await page.waitForFunction(() => /Bloqueio salvo/.test(document.querySelector('#agMsg').textContent));
    assert.match(await page.textContent('#agMsg'), /Bloqueio salvo\. 1 horário “só ocupar” foi retirado\. Nesse período nenhum horário é oferecido\./);
    assert.equal(db.busy.length, 0);
    assert.equal(db.blocks.length, 1);
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // sem a função nova (banco antigo): o motivo é o "só ocupar", não "pacientes marcados"
    const { page, db, errors, context } = await newPage(browser, { missing: ['agenda_block_force'], db: { busy: ocup() } });
    await abrirAgenda(page);
    await preencher(page);
    await page.waitForFunction(() => /só ocupar/.test(document.querySelector('#agMsg').textContent));
    const m = await page.textContent('#agMsg');
    assert.match(m, /Há um horário “só ocupar” nesse período\. Retire esse horário na agenda antes de bloquear\./);
    assert.doesNotMatch(m, /pacientes/);
    assert.equal(db.blocks.length, 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('bloquear um paciente com 2 exames no período: 1 agendamento (2 exames) e "1 paciente foi"', async () => {
  const pac = booking({ name: 'Rita Teles Teste', start: sp(AMANHA, '09:00') });
  pac.items.push({ ...pac.items[0], id: nid('iiiiiiii'), seq: 2, starts_at: sp(AMANHA, '09:30'), ends_at: sp(AMANHA, '10:00') });
  const { page, errors, context } = await newPage(browser, { db: { requests: [pac] } });
  await abrirAgenda(page);
  await page.click('#agBloquear');
  await page.selectOption('#blAlvo', USG);
  await page.fill('#blFrom', AMANHA);
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  assert.match(await page.textContent('#blAfetT'), /: atinge 1 agendamento \(2 exames\)\.$/);
  assert.match(await page.textContent('#blAfet .cl-help'), /esse paciente vai para a lista Para remarcar e a clínica precisa avisá-lo\./);
  await page.click('#blForcar');
  await page.waitForSelector('#agRemT');
  assert.match(await page.textContent('#agMsg'), /Bloqueio salvo\. 1 paciente foi para a lista Para remarcar\./);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('affected_changed troca a lista (foco no título) e cannot_move não oferece "mesmo assim"', async () => {
  const reqs = [booking({ start: sp(AMANHA, '09:00') })];
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: reqs } });
  await abrirAgenda(page);
  await page.click('[data-view="bloqueios"]');
  await page.waitForSelector('#blForm');
  await page.fill('#blFrom', AMANHA);
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  db.requests.push(booking({ name: 'Nova Pessoa Teste', start: sp(AMANHA, '13:00') }));
  await page.click('#blForcar');
  await page.waitForFunction(() => /A agenda mudou enquanto você conferia/.test(document.querySelector('#blAfet').textContent));
  assert.equal(await focusId(page), 'blAfetT');
  assert.match(await page.textContent('#blAfetT'), /atinge 2 agendamentos/);
  db.requests[0].items[0].status = 'checked_in';
  await page.click('#blForcar');
  await page.waitForFunction(() => /já presente, em atendimento/.test(document.querySelector('#blAfet').textContent));
  assert.equal(await page.locator('#blForcar').count(), 0, 'sem botão de forçar');
  await page.click('#blNao');
  assert.equal(await focusId(page), 'blFrom');
  assert.equal(calls(log, 'agenda_block_force').filter((c) => c.body.p_confirm).length, 2);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('bloqueio: mudar o período, o alvo ou o modo depois da prévia tira a lista e o "mesmo assim"; grava o que está na tela', async () => {
  const reqs = [booking({ name: 'Maria Souza Lima', start: sp(AMANHA, '09:00') }), booking({ name: 'Otávio Reis Teste', phone: '11944443333', start: sp(AMANHA, '10:00') })];
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: reqs } });
  await abrirAgenda(page);
  await page.click('#agBloquear');
  await page.selectOption('#blAlvo', USG);
  await page.check('input[name="blModo"][value="part"]');
  await page.fill('#blFrom', AMANHA);
  await page.fill('#blStart', '08:00');
  await page.fill('#blEnd', '12:00');
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  assert.match(await page.textContent('#blAfetT'), /Bloqueio de qui\., 05\/11, das 08:00 às 12:00 em Aparelho de Ultrassom <b>1<\/b>: atinge 2 agendamentos\./, 'o título diz o período e o alvo');
  // muda o fim para poupar o das 10:00: a lista e o botão somem, com o aviso
  await page.fill('#blEnd', '09:30');
  assert.equal(await page.locator('#blForcar').count(), 0, 'sem "mesmo assim" depois de mudar');
  assert.match(await page.textContent('#blAfet'), /Você mudou o bloqueio/);
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  assert.match(await page.textContent('#blAfetT'), /das 08:00 às 09:30 em .*: atinge 1 agendamento\./);
  // o motivo não muda quem é atingido: a lista fica
  await page.fill('#blMotivo', 'Troca da sonda');
  assert.equal(await page.locator('#blForcar').count(), 1, 'o motivo não tira a lista');
  // valor trocado sem evento (preenchimento automático): o "mesmo assim" confere o formulário e refaz a prévia
  const gravados = () => calls(log, 'agenda_block_force').filter((c) => c.body.p_confirm).length;
  await page.evaluate(() => { document.querySelector('#blEnd').value = '11:00'; });
  await page.click('#blForcar');
  await page.waitForFunction(() => /das 08:00 às 11:00/.test(document.querySelector('#blAfetT')?.textContent || ''));
  assert.equal(gravados(), 0, 'nada gravado com o período da prévia velha');
  assert.equal(await focusId(page), 'blAfetT');
  // trocar o alvo e trocar o modo também tiram a lista
  await page.selectOption('#blAlvo', '');
  assert.equal(await page.locator('#blForcar').count(), 0, 'trocar o alvo tira a lista');
  await page.selectOption('#blAlvo', USG);
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  await page.check('input[name="blModo"][value="day"]');
  assert.equal(await page.locator('#blForcar').count(), 0, 'trocar o modo tira a lista');
  await page.check('input[name="blModo"][value="part"]');
  await page.fill('#blEnd', '09:30');
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  await page.click('#blForcar');
  await page.waitForSelector('#agRemT');
  const f = calls(log, 'agenda_block_force').filter((c) => c.body.p_confirm).at(-1).body;
  assert.deepEqual([f.p_resource, f.p_starts, f.p_ends, f.p_kind, f.p_reason], [USG, '2026-11-05T11:00:00.000Z', '2026-11-05T12:30:00.000Z', 'bloqueio', 'Troca da sonda'], 'grava o que está na tela');
  assert.equal(gravados(), 1);
  assert.deepEqual(db.requests.map((r) => r.items[0].status), ['reschedule_requested', 'confirmed'], 'o das 10:00 não foi atingido');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('bloqueio de hoje, dia inteiro: começa agora; quem já começou não é atingido nem impede; só ele no período → bloqueia direto', async () => {
  // quarta, 10:00: Maria às 09:00 (ninguém marcou "Concluído"), João 09:45–10:15 em atendimento, Rui às 11:00
  const dia = () => [booking({ name: 'Maria Souza Lima', start: sp(HOJE, '09:00') }), booking({ name: 'João Pedro Teste', start: sp(HOJE, '09:45'), status: 'in_service' })];
  {
    const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [...dia(), booking({ name: 'Rui Mota Teste', start: sp(HOJE, '11:00') })] } });
    await abrirAgenda(page);
    await page.click('#agBloquear');
    await page.selectOption('#blAlvo', USG);
    await page.fill('#blFrom', HOJE);
    assert.match(await page.textContent('#blHoje'), /Hoje o bloqueio começa agora \(10:00\): o que já começou não é atingido/);
    await page.click('#blOk');
    await page.waitForSelector('#blForcar');
    assert.equal(calls(log, 'agenda_block_add').at(-1).body.p_starts, '2026-11-04T13:00:00.000Z', 'começa agora (10:00), não às 00:00');
    assert.match(await page.textContent('#blAfetT'), /Bloqueio de qua\., 04\/11, das 10:00 até o fim do dia em .*: atinge 1 agendamento\./);
    assert.match(await page.textContent('#blAfet'), /Rui T\./);
    assert.doesNotMatch(await page.textContent('#blAfet'), /Maria|João/, 'quem já começou não aparece');
    await page.click('#blForcar');
    await page.waitForSelector('#agRemT');
    assert.deepEqual(db.requests.map((r) => r.items[0].status), ['confirmed', 'in_service', 'reschedule_requested']);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // só quem já começou está no período: não há quem avisar, bloqueia sem perguntar
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: dia() } });
  await abrirAgenda(page);
  await page.click('#agBloquear');
  await page.selectOption('#blAlvo', USG);
  await page.fill('#blFrom', HOJE);
  await page.click('#blOk');
  await page.waitForFunction(() => /Bloqueio salvo/.test(document.querySelector('#agMsg').textContent));
  assert.equal(calls(log, 'agenda_block_add').at(-1).body.p_starts, '2026-11-04T13:00:00.000Z');
  assert.equal(calls(log, 'agenda_block_force').filter((c) => c.body.p_confirm).length, 1, 'gravou com o código da prévia vazia');
  assert.equal(db.blocks.length, 1);
  assert.deepEqual(db.requests.map((r) => r.items[0].status), ['confirmed', 'in_service'], 'ninguém foi para remarcar');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('bloqueio sem resposta do servidor: confere se já foi salvo e não grava outro (Bloquear e "mesmo assim")', async () => {
  {
    // "Bloquear": grava, a resposta se perde e a conferência também falha; ao tentar de novo, acha o bloqueio
    const { page, db, log, errors, context } = await newPage(browser, { db: { lostReply: { agenda_block_add: 1 } } });
    await abrirAgenda(page);
    await page.click('[data-view="bloqueios"]');
    await page.waitForSelector('#blForm');
    await page.fill('#blFrom', AMANHA);
    db.failNet.agenda_blocks = 1;
    await page.click('#blOk');
    await page.waitForFunction(() => /O bloqueio pode já ter sido salvo/.test(document.querySelector('#agMsg').textContent));
    assert.equal(db.blocks.length, 1, 'gravou (só a resposta se perdeu)');
    await page.click('#blOk');
    await page.waitForFunction(() => /Este bloqueio já tinha sido salvo/.test(document.querySelector('#agMsg').textContent));
    assert.equal(db.blocks.length, 1, 'não gravou outro');
    assert.equal(calls(log, 'agenda_block_add').length, 1, 'nem chamou de novo');
    assert.deepEqual(errors, []);
    await context.close();
  }
  // "mesmo assim": grava (o paciente vai para remarcar), a resposta se perde; a tela acha o bloqueio e mostra a lista
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [booking({ start: sp(AMANHA, '09:00') })] } });
  await abrirAgenda(page);
  await page.click('#agBloquear');
  await page.fill('#blFrom', AMANHA);
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  db.lostReply = { agenda_block_force: 1 };
  await page.click('#blForcar');
  await page.waitForFunction(() => /Este bloqueio já tinha sido salvo\. Se havia pacientes no período, eles estão na lista Para remarcar/.test(document.querySelector('#agMsg').textContent));
  assert.equal(db.blocks.length, 1);
  assert.equal(calls(log, 'agenda_block_force').filter((c) => c.body.p_confirm).length, 1);
  assert.match(await page.textContent('#agRemT'), /Para remarcar \(1\)/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('balcão sem resposta do servidor: aviso e agenda relida; a mesma chave no mesmo horário depois de "Ver horários"; o reenvio mostra o que o banco gravou', async () => {
  const slots = [{ start: sp(HOJE, '11:00'), end: sp(HOJE, '11:30') }, { start: sp(HOJE, '11:30'), end: sp(HOJE, '12:00') }]; // aparelho com 2 vagas
  const { page, db, log, errors, context } = await newPage(browser, { db: { lostReply: { agenda_desk_book: 1 }, deskSlots: slots } });
  await abrirAgenda(page);
  await page.click('#agNovo');
  await page.selectOption('#bkProc', P_USG);
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  await page.check(`input[name="bkSlot"][value="${sp(HOJE, '11:00')}"]`);
  await page.fill('#bkNome', 'Paciente Teste Um');
  await page.fill('#bkFone', '11955554444');
  await page.check('#bkConsent');
  const vistas = calls(log, 'agenda_view').length;
  await page.click('#bkOk');
  await page.waitForFunction(() => /O agendamento pode já ter sido gravado/.test(document.querySelector('#bkMsg')?.textContent || ''));
  assert.ok(calls(log, 'agenda_view').length > vistas, 'relê a agenda');
  assert.equal(db.requests.length, 1, 'gravou (só a resposta se perdeu)');
  await page.waitForFunction(() => /Paciente U\./.test(document.querySelector('#agMain').textContent));
  // "Ver horários" de novo e o MESMO horário, com outro nome digitado: a mesma chave, nada duplicado
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  await page.check(`input[name="bkSlot"][value="${sp(HOJE, '11:00')}"]`);
  await page.fill('#bkNome', 'Outro Nome Digitado');
  await page.click('#bkOk');
  await page.waitForSelector('#bkFeito');
  const k = calls(log, 'agenda_desk_book').map((c) => c.body.p_key);
  assert.equal(k.length, 2);
  assert.equal(k[0], k[1], 'a mesma chave para o mesmo exame e horário');
  assert.equal(db.requests.length, 1, 'um agendamento só');
  assert.match(await page.textContent('#bkFeito'), /já tinha sido registrado: Ultrassom de abdome <b>total<\/b>, qua\., 04\/11 às 11:00\. Abra o agendamento para conferir o paciente\./);
  assert.doesNotMatch(await page.textContent('#bkFeito'), /Outro/, 'não mostra o nome digitado agora');
  await page.click('#bkVerAg');
  await page.waitForSelector('#agDet .ag-dl');
  assert.match(await page.textContent('#agDetT'), /Paciente Teste Um/, 'o gravado');
  await page.click('#agDetFechar');
  assert.equal(await focusId(page), 'bkVerAg', 'o foco volta ao botão');
  // depois de uma resposta, outro horário vai com outra chave
  await page.click('#agForms [data-act="novo"]');
  await page.selectOption('#bkProc', P_USG);
  await page.click('#bkVer');
  await page.waitForSelector('input[name="bkSlot"]');
  await page.check(`input[name="bkSlot"][value="${sp(HOJE, '11:30')}"]`);
  await page.fill('#bkNome', 'Paciente Teste Dois');
  await page.fill('#bkFone', '11955553333');
  await page.check('#bkConsent');
  await page.click('#bkOk');
  await page.waitForSelector('#bkFeito');
  assert.notEqual(calls(log, 'agenda_desk_book').at(-1).body.p_key, k[0]);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('exame, aparelho ou sala desativado por outra pessoa: o texto certo, o catálogo relido e o seletor sem ele', async () => {
  const { page, db, log, errors, context } = await newPage(browser);
  await abrirAgenda(page);
  // "só ocupar" no aparelho que acabou de ser desativado
  await page.click('#agOcupar');
  await page.selectOption('#ocRec', USG);
  await page.fill('#ocIni', '14:00');
  await page.fill('#ocFim', '15:00');
  db.resources = db.resources.filter((r) => r.id !== USG);
  db.once.agenda_desk_busy = { status: 'not_found' };
  const cats = calls(log, 'agenda_catalog').length;
  await page.click('#ocOk');
  await page.waitForFunction(() => /não está mais ativo/.test(document.querySelector('#ocRecErr')?.textContent || ''));
  assert.ok(calls(log, 'agenda_catalog').length > cats, 'relê o catálogo');
  assert.equal(await page.locator(`#ocRec option[value="${USG}"]`).count(), 0, 'o aparelho saiu do seletor');
  assert.equal(await focusId(page), 'ocRec');
  assert.doesNotMatch(await page.textContent('#agRoot'), /agendamento não existe mais/);
  // balcão com o exame desativado
  await page.click('#agForms [data-act="fechar-form"]');
  await page.click('#agNovo');
  await page.selectOption('#bkProc', P_ECO);
  db.procedures = db.procedures.filter((x) => x.id !== P_ECO);
  db.once.agenda_desk_slots = { status: 'not_found' };
  await page.click('#bkVer');
  await page.waitForFunction(() => /O exame escolhido não está mais ativo/.test(document.querySelector('#bkProcErr')?.textContent || ''));
  assert.equal(await page.locator(`#bkProc option[value="${P_ECO}"]`).count(), 0, 'o exame saiu do seletor');
  assert.equal(await focusId(page), 'bkProc');
  // bloqueio de uma sala que foi desativada: "Escolha de novo" (nunca vira "A clínica inteira" sozinho)
  await page.click('#agForms [data-act="fechar-form"]');
  await page.click('#agBloquear');
  await page.selectOption('#blAlvo', SALA);
  await page.fill('#blFrom', AMANHA);
  db.resources = db.resources.filter((r) => r.id !== SALA);
  db.once.agenda_block_add = { status: 'not_found' };
  await page.click('#blOk');
  await page.waitForFunction(() => /não está mais ativo/.test(document.querySelector('#blAlvoErr')?.textContent || ''));
  assert.equal(await page.$eval('#blAlvo', (s) => s.selectedOptions[0].textContent), 'Escolha de novo');
  assert.equal(await focusId(page), 'blAlvo');
  const n = calls(log, 'agenda_block_add').length;
  await page.click('#blOk');
  assert.equal(calls(log, 'agenda_block_add').length, n, 'sem escolher de novo, não manda nada');
  assert.equal(db.blocks.length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Para remarcar: remarcar por outro caminho (a busca) tira o item da lista sem a tela chamar nada; "Tirar da lista" com confirmação', async () => {
  const reqs = [booking({ name: 'Maria Souza Lima', start: sp(AMANHA, '09:00') }), booking({ name: 'Otávio Reis Teste', phone: '11944443333', start: sp(AMANHA, '10:00') })];
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: reqs } });
  await abrirAgenda(page);
  await page.click('#agBloquear');
  await page.selectOption('#blAlvo', USG);
  await page.fill('#blFrom', AMANHA);
  await page.click('#blOk');
  await page.waitForSelector('#blForcar');
  await page.click('#blForcar');
  await page.waitForSelector('#agRemT');
  assert.match(await page.textContent('#agRemT'), /Para remarcar \(2\)/);
  // a recepção acha a Maria pela busca (não pela lista "Para remarcar") e remarca
  await page.fill('#agBuscaQ', 'Maria');
  await page.click('#agBuscaOk');
  await page.waitForSelector('#agBuscaRes [data-act="abrir"]');
  await page.click('#agBuscaRes [data-act="abrir"]');
  await page.waitForSelector('#agDet [data-act="remarcar"]');
  await page.click('#agDet [data-act="remarcar"]');
  await page.fill('#rmDia', AMANHA);
  db.deskSlots = [{ start: sp(AMANHA, '15:00'), end: sp(AMANHA, '15:30') }];
  await page.click('#rmVer');
  await page.check('input[name="rmSlot"]');
  await page.click('#rmOk');
  await page.waitForFunction(() => /Remarcado/.test(document.querySelector('#agMsg').textContent));
  await page.waitForFunction(() => /Para remarcar \(1\)/.test(document.querySelector('#agRemT')?.textContent || ''));
  assert.equal(calls(log, 'agenda_conflict_resolve').length, 0, 'o banco fecha sozinho: a tela não precisa chamar');
  // "Tirar da lista" o Otávio (bloqueio): pergunta na própria linha
  const kOtavio = db.conflicts.find((k) => k.request_id === reqs[1].id).id;
  await page.click('#agDetFechar');
  await page.click(`[data-act="conf-tirar"][data-k="${kOtavio}"]`);
  assert.equal(await focusId(page), 'agkSim');
  assert.match(await page.textContent('#agRem'), /Tirar da lista sem remarcar por aqui\?/);
  await page.click(`[data-act="conf-tirar-nao"]`);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.act), 'conf-tirar', 'Voltar devolve o foco');
  await page.click(`[data-act="conf-tirar"][data-k="${kOtavio}"]`);
  await page.click('#agkSim');
  await page.waitForFunction(() => /Saiu da lista Para remarcar/.test(document.querySelector('#agMsg').textContent));
  assert.deepEqual(calls(log, 'agenda_conflict_resolve').at(-1).body, { p_id: kOtavio, p_status: 'descartado', p_code: 'tirado_da_lista' });
  assert.equal(await page.locator('#agRemT').count(), 0, 'a lista some');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('banco sem o gatilho: o que o paciente já cancelou sai da lista sem "Cancelar" de novo; remarcar pela busca fecha o conflito do item', async () => {
  const reqs = [booking({ name: 'Maria Souza Lima', start: sp(AMANHA, '09:00'), status: 'reschedule_requested', res: [] }),
    booking({ name: 'Otávio Reis Teste', phone: '11944443333', start: sp(AMANHA, '10:00'), status: 'cancelled', res: [] })];
  const conflicts = reqs.map((r) => ({ id: nid('ffffffff'), kind: 'bloqueio_sobre_agendamento', request_id: r.id, item_id: r.items[0].id, starts_at: r.items[0].starts_at, procedure_id: P_USG,
    details: { starts_at: r.items[0].starts_at, procedure_id: P_USG }, status: 'aberto', created_at: NOW }));
  const { page, log, errors, context } = await newPage(browser, { db: { requests: reqs, conflicts, semGatilho: true } });
  await abrirAgenda(page);
  await page.waitForSelector('#agRemT');
  assert.match(await page.textContent('#agRemT'), /Para remarcar \(2\)/);
  // Otávio: "Cancelar" na lista, mas o paciente já tinha cancelado pela conta
  await page.click(`[data-act="conf-cancelar"][data-k="${conflicts[1].id}"]`);
  await page.waitForFunction(() => /não está mais para remarcar \(situação: Cancelado\)\. Saiu da lista Para remarcar/.test(document.querySelector('#agDetMsg')?.textContent || ''));
  assert.equal(calls(log, 'agenda_cancel').length + calls(log, 'agenda_set_status').length, 0, 'nada é cancelado de novo');
  assert.equal(await page.locator('#cnMotivo').count(), 0, 'sem o formulário de cancelar');
  assert.deepEqual(calls(log, 'agenda_conflict_resolve').at(-1).body, { p_id: conflicts[1].id, p_status: 'resolvido', p_code: 'cancelado' });
  assert.match(await page.textContent('#agRemT'), /Para remarcar \(1\)/);
  // Maria: remarcada pelo detalhe aberto da busca → a tela fecha o conflito dela pelo item
  await page.click('#agDetFechar');
  await page.fill('#agBuscaQ', 'Maria');
  await page.click('#agBuscaOk');
  await page.waitForSelector('#agBuscaRes [data-act="abrir"]');
  await page.click('#agBuscaRes [data-act="abrir"]');
  await page.waitForSelector('#agDet [data-act="remarcar"]');
  await page.click('#agDet [data-act="remarcar"]');
  await page.fill('#rmDia', AMANHA);
  await page.click('#rmVer');
  await page.check(`input[name="rmSlot"][value="${sp(AMANHA, '15:00')}"]`);
  await page.click('#rmOk');
  await page.waitForFunction(() => /Remarcado/.test(document.querySelector('#agMsg').textContent));
  assert.deepEqual(calls(log, 'agenda_conflict_resolve').at(-1).body, { p_id: conflicts[0].id, p_status: 'resolvido', p_code: 'remarcado' });
  await page.waitForFunction(() => !document.querySelector('#agRemT'));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('banco sem o gatilho: remarcar e cancelar pela linha do dia (não pela lista "Para remarcar") também fecham o conflito do item', async () => {
  const reqs = [booking({ name: 'Maria Souza Lima', start: sp(HOJE, '11:00'), status: 'reschedule_requested', res: [] }),
    booking({ name: 'Otávio Reis Teste', phone: '11944443333', start: sp(HOJE, '12:00'), status: 'reschedule_requested', res: [] })];
  const conflicts = reqs.map((r) => ({ id: nid('ffffffff'), kind: 'bloqueio_sobre_agendamento', request_id: r.id, item_id: r.items[0].id, starts_at: r.items[0].starts_at, procedure_id: P_USG,
    details: { starts_at: r.items[0].starts_at, procedure_id: P_USG }, status: 'aberto', created_at: NOW }));
  const { page, log, errors, context } = await newPage(browser, { db: { requests: reqs, conflicts, semGatilho: true } });
  await abrirAgenda(page);
  await page.waitForSelector('#agRemT');
  assert.match(await page.textContent('#agRemT'), /Para remarcar \(2\)/);
  // Maria: aberta pela linha dela na lista de hoje e remarcada para amanhã
  await page.click(`#agMain [data-act="abrir"][data-item="${reqs[0].items[0].id}"]`);
  await page.waitForSelector('#agDet [data-act="remarcar"]');
  await page.click('#agDet [data-act="remarcar"]');
  await page.fill('#rmDia', AMANHA);
  await page.click('#rmVer');
  await page.check(`input[name="rmSlot"][value="${sp(AMANHA, '15:00')}"]`);
  await page.click('#rmOk');
  await page.waitForFunction(() => /Remarcado/.test(document.querySelector('#agMsg').textContent));
  assert.equal(calls(log, 'agenda_reschedule').length, 1);
  assert.deepEqual(calls(log, 'agenda_conflict_resolve').at(-1).body, { p_id: conflicts[0].id, p_status: 'resolvido', p_code: 'remarcado' });
  await page.waitForFunction(() => /Para remarcar \(1\)/.test(document.querySelector('#agRemT')?.textContent || ''));
  // Otávio: aberto pela linha dele e cancelado
  await page.click('#agDetFechar');
  await page.click(`#agMain [data-act="abrir"][data-item="${reqs[1].items[0].id}"]`);
  await page.waitForSelector('#agDet [data-act="cancelar"]');
  await page.click('#agDet [data-act="cancelar"]');
  await page.selectOption('#cnMotivo', 'paciente_desistiu');
  await page.click('#cnOk');
  await page.click('#cnSim');
  await page.waitForFunction(() => /cancelado/.test(document.querySelector('#agMsg').textContent));
  assert.equal(calls(log, 'agenda_cancel').length, 1);
  assert.deepEqual(calls(log, 'agenda_conflict_resolve').at(-1).body, { p_id: conflicts[1].id, p_status: 'resolvido', p_code: 'cancelado' });
  await page.waitForFunction(() => !document.querySelector('#agRemT'));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pacote com dois exames: "Cancelar este exame" cancela só aquele (agenda_set_status com o item); a pergunta diz isso', async () => {
  const pac = booking({ name: 'Rita Teles Teste', start: sp(AMANHA, '09:00') });
  pac.items.push({ id: nid('iiiiiiii'), seq: 2, procedure_id: P_ECO, procedure: 'Ecocardiograma', exam_code: 'eco', starts_at: sp(AMANHA, '10:00'), ends_at: sp(AMANHA, '10:20'),
    status: 'confirmed', version: 1, price_cents: null, resources: [DRA] });
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [pac] } });
  await abrirAgenda(page);
  await page.fill('#agBuscaQ', 'Rita');
  await page.click('#agBuscaOk');
  await page.waitForSelector('#agBuscaRes [data-act="abrir"]');
  await page.click('#agBuscaRes [data-act="abrir"]');
  await page.waitForSelector('#agDet .ag-itens');
  assert.deepEqual(await page.$$eval('#agDet [data-act="cancelar"]', (b) => b.map((x) => x.textContent.trim())), ['Cancelar este exame', 'Cancelar este exame']);
  await page.click(`#agDet [data-act="cancelar"][data-item="${pac.items[1].id}"]`);
  assert.match(await page.textContent('#cnT'), /Cancelar o exame Ecocardiograma/);
  await page.selectOption('#cnMotivo', 'paciente_desistiu');
  await page.click('#cnOk');
  assert.match(await page.textContent('#cnAskT'), /Cancelar o exame Ecocardiograma de Rita T\. \(qui\., 05\/11 às 10:00\)\? Só este exame: os outros do agendamento continuam marcados/);
  await page.click('#cnSim');
  await page.waitForFunction(() => /Os outros exames continuam marcados/.test(document.querySelector('#agMsg').textContent));
  assert.deepEqual(calls(log, 'agenda_set_status').at(-1).body, { p_id: pac.id, p_status: 'cancelled', p_reason: 'paciente_desistiu', p_version: 1, p_item: pac.items[1].id });
  assert.equal(calls(log, 'agenda_cancel').length, 0, 'não cancela o agendamento inteiro');
  assert.deepEqual(db.requests[0].items.map((i) => i.status), ['confirmed', 'cancelled']);
  assert.equal(await focusId(page), 'agDetT', 'o detalhe continua aberto');
  assert.equal(await page.locator(`#agDet [data-act="cancelar"][data-item="${pac.items[0].id}"]`).count(), 1, 'o ultrassom ainda pode ser cancelado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('clique duplo em "Chegou": uma chamada só, botões desligados enquanto espera, sem aviso de "outra pessoa"', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [booking({ start: sp(HOJE, '10:30') })], delay: { agenda_attend: 700 } } });
  await abrirAgenda(page);
  const b = page.locator('#agMain [data-act="atender"][data-k="chegou"]');
  await b.dblclick();
  assert.equal(await b.getAttribute('aria-disabled'), 'true', 'desligado enquanto a resposta não chega');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.k), 'chegou', 'o foco fica no botão');
  await page.waitForFunction(() => /Paciente presente/.test(document.querySelector('#agMain').textContent));
  assert.equal(calls(log, 'agenda_attend').length, 1, 'uma chamada só');
  assert.doesNotMatch(await page.textContent('#agMsg'), /Outra pessoa/);
  assert.equal(db.requests[0].items[0].status, 'checked_in', 'não passou para "Em atendimento" sem querer');
  assert.equal(await page.locator('#agMain [data-act="atender"][aria-disabled="true"]').count(), 0, 'depois da resposta, os botões voltam');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pergunta "Sim, …" com a situação mudada por outra pessoa: some ao reler e não manda situação inválida', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { now: '2026-11-04T12:16:00Z', db: { requests: [booking({ name: 'Maria Lopes Teste', start: sp(HOJE, '09:00') })] } });
  await abrirAgenda(page);
  await page.click('[data-act="atender"][data-k="faltou"]');
  assert.equal(await focusId(page), 'agAskSim');
  // outra recepção registra a chegada; esta aba relê
  const r = db.requests[0]; r.items[0].status = 'checked_in'; r.status = 'checked_in'; r.version += 1; db.version += 1;
  await page.click('[data-act="atualizar"]');
  await page.waitForFunction(() => /Paciente presente/.test(document.querySelector('#agMain').textContent));
  assert.equal(await page.locator('#agAskSim').count(), 0, 'a pergunta velha sai da tela');
  assert.equal(calls(log, 'agenda_attend').length, 0, 'nada enviado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('"Desfazer falta" sem o horário livre: texto próprio (falta não se remarca) e atalho para "Novo agendamento"', async () => {
  const { page, db, errors, context } = await newPage(browser, { db: { requests: [booking({ start: sp(HOJE, '09:00'), status: 'no_show' })] } });
  await abrirAgenda(page);
  await page.click('[data-act="atender"][data-k="desfazer"]');
  await page.selectOption('#agAskMotivo', 'chegou_atrasado');
  db.once.agenda_attend = { status: 'slot_taken' };
  await page.click('#agAskSim');
  await page.waitForFunction(() => /a falta não pode ser desfeita/.test(document.querySelector('#agMsg').textContent));
  assert.doesNotMatch(await page.textContent('#agMsg'), /Remarque/, 'não manda remarcar o que não se remarca');
  assert.equal(await focusId(page), 'agMsgBtn');
  assert.equal((await page.textContent('#agMsgBtn')).trim(), 'Novo agendamento');
  await page.click('#agMsgBtn');
  assert.equal(await focusId(page), 'bkT', 'abre o novo agendamento');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('"Atualizar" sem internet não diz "Agenda atualizada"; com internet, diz', async () => {
  const { page, db, errors, context } = await newPage(browser, { db: { requests: dia1() } });
  await abrirAgenda(page);
  db.failNet.agenda_view = 1;
  await page.click('#agAtualizar');
  await page.waitForFunction(() => /Não foi possível carregar a agenda agora/.test(document.querySelector('#agMain').textContent));
  assert.doesNotMatch(await page.textContent('#agMsg'), /Agenda atualizada/);
  assert.match(await page.textContent('#agMsg'), /Não foi possível/);
  await page.click('#agMain [data-act="atualizar"]');
  await page.waitForFunction(() => /Agenda atualizada/.test(document.querySelector('#agMsg').textContent));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('virou o dia com a página aberta: "Hoje" relê o dia novo ao voltar à aba e ao redesenhar (filtro), sem mostrar a lista de ontem', async () => {
  const dois = () => [booking({ name: 'Maria Souza Lima', start: sp(HOJE, '22:00') }), booking({ name: 'Rui Mota Teste', start: sp(AMANHA, '08:30') })];
  const QUARTA_2350 = '2026-11-05T02:50:00Z'; const QUINTA_0745 = '2026-11-05T10:45:00Z';
  {
    const { page, db, log, errors, context } = await newPage(browser, { now: QUARTA_2350, db: { requests: dois() } });
    await abrirAgenda(page);
    assert.match(await page.textContent('#agTitulo'), /Hoje, quarta-feira, 4 de novembro/);
    // quinta, 07:45: a aba volta a ficar visível, sem mudança de versão
    await context.clock.setFixedTime(new Date(QUINTA_0745));
    db.now = Date.parse(QUINTA_0745);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(() => /Hoje, quinta-feira, 5 de novembro/.test(document.querySelector('#agTitulo').textContent));
    assert.equal(calls(log, 'agenda_view').at(-1).body.p_from, AMANHA);
    assert.match(await page.textContent('#agMain'), /Rui T\./);
    assert.doesNotMatch(await page.textContent('#agMain'), /Maria/, 'nada de ontem');
    assert.match(await page.textContent('#agMsg'), /Virou o dia/);
    assert.deepEqual(errors, []);
    await context.close();
  }
  const { page, db, log, errors, context } = await newPage(browser, { now: QUARTA_2350, db: { requests: dois() } });
  await abrirAgenda(page);
  await context.clock.setFixedTime(new Date(QUINTA_0745));
  db.now = Date.parse(QUINTA_0745);
  await page.check('#agFCancel');   // redesenha a lista: relê em vez de filtrar a de ontem pela data nova
  await page.waitForFunction(() => /Rui T\./.test(document.querySelector('#agMain').textContent));
  assert.equal(calls(log, 'agenda_view').at(-1).body.p_from, AMANHA);
  assert.doesNotMatch(await page.textContent('#agMain'), /Nenhum agendamento hoje/);
  assert.match(await page.textContent('#agTitulo'), /Hoje, quinta-feira, 5 de novembro/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('equipe do IMED sem operar a agenda (suporte, auditoria): sem "Concluído"; com operar, aparece', async () => {
  for (const [operar, n] of [[false, 0], [true, 1]]) {
    const { page, errors, context } = await newPage(browser, { role: null, admin: true, db: { requests: [booking({ start: sp(HOJE, '09:00') })], imedOperar: operar } });
    await page.goto(`${BASE}painel.html`);
    await page.waitForSelector('#clinicPick');
    await page.selectOption('#clinicPick', C1);
    await page.waitForSelector('#tab-agenda');
    await page.click('#tab-agenda');
    await page.waitForSelector('#agMain .ag-lista');
    assert.equal(await page.locator('#agMain [data-act="atender"][data-k="concluido"]').count(), n, `operar=${operar}`);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('profissional: só a aba Agenda, só a coluna dele, sem marcar/bloquear/cancelar; detalhe sem telefone; Chegou chama agenda_attend', async () => {
  const reqs = [booking({ name: 'Ana Clara Rocha', start: sp(HOJE, '10:30'), proc: P_ECO, res: [DRA] }), booking({ start: sp(HOJE, '11:00') })];
  const { page, log, errors, context } = await newPage(browser, { role: 'professional', db: { requests: reqs } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-agenda');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Agenda');
  await page.waitForSelector('#agMain .ag-lista');
  assert.equal(await page.locator('#agMain [data-act="abrir"]').count(), 1, 'só o exame dele');
  for (const s of ['#agNovo', '#agOcupar', '#agBloquear', '[data-view="bloqueios"]']) assert.equal(await page.locator(s).count(), 0, s);
  await page.click('[data-view="dia"]');
  await page.waitForSelector('#agMain .ag-grade');
  assert.equal(await page.locator('.ag-cab-col').count(), 1, 'uma coluna: a dele');
  await page.click('[data-view="hoje"]');
  await page.waitForSelector('#agMain [data-act="atender"]');
  await page.click('#agMain [data-act="atender"][data-k="chegou"]');
  await page.waitForFunction(() => /Paciente presente/.test(document.querySelector('#agMain').textContent));
  assert.equal(calls(log, 'agenda_attend').length, 1);
  assert.equal(calls(log, 'agenda_set_status').length, 0);
  await page.click('#agMain [data-act="abrir"]');
  await page.waitForSelector('#agDet .ag-dl');
  assert.doesNotMatch(await page.textContent('#agDet'), /3333-4444|Telefone/);
  assert.equal(await page.locator('#agDet [data-act="cancelar"], #agDet [data-act="remarcar"]').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
  // sem recurso ligado
  const s2 = await newPage(browser, { role: 'professional', db: { resources: RESOURCES().map((r) => ({ ...r, member: null })) } });
  await s2.page.goto(`${BASE}painel.html`);
  await s2.page.waitForSelector('#agTop .cl-note');
  assert.match(await s2.page.textContent('#agTop'), /Nenhum aparelho, sala ou profissional está ligado à sua conta/);
  assert.deepEqual(s2.errors, []);
  await s2.context.close();
});

await scenario('equipe do IMED: grade sem nomes; detalhe e pedidos pedem o motivo (fica registrado)', async () => {
  const { page, log, errors, context } = await newPage(browser, { role: null, admin: true, db: { requests: dia1() } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#clinicPick');
  await page.selectOption('#clinicPick', C1);
  await page.waitForSelector('#tab-agenda');
  await page.click('#tab-agenda');
  await page.waitForSelector('#agMain .ag-lista');
  assert.doesNotMatch(await page.textContent('#agMain'), /Maria|João/);
  assert.match(await page.textContent('#agMain'), /Paciente/);
  assert.equal(await page.locator('#agBusca').count(), 0, 'a equipe do IMED não busca paciente');
  await page.click('#agMain [data-act="abrir"] >> nth=0');
  await page.waitForSelector('#agJust');
  await page.click('#agJustOk');
  assert.match(await page.textContent('#agJustErr'), /Escolha o motivo/);
  await page.selectOption('#agJust', 'suporte_clinica');
  await page.click('#agJustOk');
  await page.waitForSelector('#agDet .ag-dl');
  assert.equal(calls(log, 'agenda_request_detail').at(-1).body.p_justification, 'suporte_clinica');
  await page.click('#tab-pedidos');
  await page.waitForSelector('#rqJust');
  assert.deepEqual(calls(log, 'agenda_requests').at(-1).body, { p_clinic: C1, p_when: null, p_justification: null });
  await page.selectOption('#rqJust', 'auditoria');
  await page.click('#rqJustOk');
  await page.waitForSelector('.rq-list');
  assert.deepEqual(calls(log, 'agenda_requests').at(-1).body, { p_clinic: C1, p_when: null, p_justification: 'auditoria' });
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (390 px): Hoje, Dia e Semana em lista; botões de 44 px; sem rolagem lateral; detalhe com "Voltar à agenda"', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, db: { requests: dia1() } });
  await abrirAgenda(page);
  for (const v of ['hoje', 'dia', 'semana', 'mes', 'bloqueios']) {
    await page.click(`[data-view="${v}"]`);
    await page.waitForSelector(v === 'mes' ? '#agMain .ag-mlista, #agMain .cl-help' : v === 'bloqueios' ? '#blForm' : '#agMain .ag-lista, #agMain .ag-wdia');
    assert.equal(await page.locator('#agMain .ag-grade').count(), 0, `${v}: sem grade no celular`);
    await noOverflow(page);
    if (v === 'mes') {
      // botão de ação (o texto diz o que ele faz), sem aria-pressed: "pressionado" + "Mostrar só…" confundiria quem ouve
      const todos = page.locator('[data-act="mes-todos"]');
      assert.equal(await todos.getAttribute('aria-pressed'), null);
      assert.equal((await todos.textContent()).trim(), 'Mostrar todos os dias');
      await todos.click();
      assert.equal((await todos.textContent()).trim(), 'Mostrar só os dias com movimento');
      assert.equal(await todos.getAttribute('aria-pressed'), null);
    }
  }
  await page.click('[data-view="hoje"]');
  await page.waitForSelector('#agMain .ag-lista');
  const pequenos = await page.$$eval('.ag button, .ag .btn, .ag select, .ag input[type=date], .ag input[type=text], .ag summary', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.outerHTML.slice(0, 80)));
  assert.deepEqual(pequenos, [], 'alvos de toque com pelo menos 44 px');
  const letra = await page.$$eval('.ag input:not([type=checkbox]):not([type=radio]), .ag select', (els) => els.filter((e) => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.outerHTML.slice(0, 80)));
  assert.deepEqual(letra, [], 'letra de 16 px nos campos');
  await page.click('#agMain [data-act="abrir"] >> nth=0');
  await page.waitForSelector('#agDet .ag-dl');
  assert.match(await page.textContent('#agDetFechar'), /Voltar à agenda/);
  assert.equal(await page.isVisible('#agMain'), false, 'o detalhe ocupa a área da lista');
  await noOverflow(page);
  await shot(page, 'ag-17-celular-detalhe');
  await page.click('#agDetFechar');
  await page.waitForSelector('#agMain .ag-lista');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('fuso: clínica em Manaus vista de São Paulo: horários 1 h antes, aviso e bloqueio de dia inteiro com o fuso da clínica', async () => {
  const reqs = [booking({ start: sp(HOJE, '10:30') })];
  const { page, log, errors, context } = await newPage(browser, { tz: 'America/Manaus', db: { requests: reqs } });
  await abrirAgenda(page);
  assert.match(await page.textContent('#agTop .ag-tz'), /Horários no fuso da clínica \(uma hora a menos que Brasília\)/);
  assert.match((await nomesFalados(page, '#agMain [data-act="abrir"]'))[0], /^\|09:30 às 10:00, /);
  await page.click('[data-view="bloqueios"]');
  await page.waitForSelector('#blForm');
  await page.fill('#blFrom', AMANHA);
  await page.click('#blOk');
  await page.waitForFunction(() => /Bloqueio salvo/.test(document.querySelector('#agMsg').textContent));
  const c = calls(log, 'agenda_block_add').at(-1).body;
  assert.equal(c.p_starts, '2026-11-05T04:00:00.000Z');
  assert.equal(c.p_ends, '2026-11-06T04:00:00.000Z');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('banco sem as funções novas: a grade aparece sem "Livre", com a nota; sem "Novo agendamento"; nenhum erro', async () => {
  const { page, errors, context } = await newPage(browser, { missing: ['agenda_catalog', 'agenda_free', 'agenda_desk_slots', 'agenda_blocks', 'agenda_block_force', 'agenda_attend'], db: { requests: dia1() } });
  await abrirAgenda(page);
  assert.match(await page.textContent('#agTop'), /Esta parte da agenda ainda não está disponível/);
  assert.equal(await page.locator('#agNovo').count(), 0);
  await page.click('[data-view="dia"]');
  await page.waitForSelector('#agMain .ag-grade');
  assert.equal(await page.locator('.ag-livre').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('tema escuro: a mesma tela, legenda legível e cores pelos tokens', async () => {
  const { page, errors, context } = await newPage(browser, { theme: 'dark', db: { requests: dia1() } });
  await abrirAgenda(page);
  const cores = await page.$$eval('#agLegenda li', (l) => l.map((x) => [getComputedStyle(x).backgroundColor, getComputedStyle(x).color]));
  assert.ok(cores.every(([bg, fg]) => bg !== fg));
  const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.notEqual(fundo, 'rgb(244, 248, 250)', 'fundo escuro');
  await page.click('[data-view="dia"]');
  await page.waitForSelector('#agMain .ag-grade');
  await shot(page, 'ag-20-escuro');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('mês e semana (computador): números do banco, clicar abre o dia; busca rápida com mínimo de 3 letras', async () => {
  const { page, log, errors, context } = await newPage(browser, { db: { requests: dia1() } });
  await abrirAgenda(page);
  await page.click('[data-view="mes"]');
  await page.waitForSelector('#agMain .ag-mes');
  // hoje: a palavra "hoje" à vista e no nome falado (antes era só um contorno fino)
  assert.match((await nomesFalados(page, `[data-act="abrir-dia"][data-dia="${HOJE}"]`))[0], /^\|quarta-feira, 4 de novembro, hoje, (3 marcados · 1 concluído|3 marcados)/);
  assert.equal((await page.textContent(`[data-act="abrir-dia"][data-dia="${HOJE}"] .ag-hoje-tag`)).trim(), 'hoje');
  assert.equal(await page.locator('#agMain .ag-hoje-tag').count(), 1, 'só o dia de hoje');
  await page.click(`[data-act="abrir-dia"][data-dia="${HOJE}"]`);
  await page.waitForSelector('#agMain .ag-grade');
  assert.equal(await page.getAttribute('[data-view="dia"]', 'aria-pressed'), 'true');
  await page.click('[data-view="semana"]');
  await page.waitForSelector('#agMain .ag-semana');
  assert.equal(calls(log, 'agenda_view').at(-1).body.p_from, '2026-11-02', 'a semana começa na segunda');
  await coresComTexto(page);
  // "Ver em lista" / "Ver em grade": o texto diz o que o botão faz, sem aria-pressed (não "Ver em grade, pressionado")
  assert.equal(await page.getAttribute('#agModo', 'aria-pressed'), null);
  assert.equal((await page.textContent('#agModo')).trim(), 'Ver em lista');
  await page.click('#agModo');
  await page.waitForSelector('#agMain .ag-wdia');
  assert.equal((await page.textContent('#agModo')).trim(), 'Ver em grade');
  assert.equal(await focusId(page), 'agModo');
  await page.click('#agModo');
  await page.waitForSelector('#agMain .ag-semana');
  await page.fill('#agBuscaQ', 'Ma');
  await page.click('#agBuscaOk');
  assert.match(await page.textContent('#agBuscaErr'), /pelo menos 3 letras/);
  assert.equal(calls(log, 'agenda_search').length, 0);
  await page.fill('#agBuscaQ', 'souza');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#agBuscaRes [data-act="abrir"]');
  assert.match(await page.textContent('#agBuscaRes'), /final do telefone 7777/);
  await page.click('#agBuscaRes [data-act="abrir"]');
  await page.waitForSelector('#agDet .ag-dl');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('sair da aba Agenda antes da resposta (bloqueio e chegada) não dá erro; ao voltar, a agenda já mostra o que mudou', async () => {
  const { page, db, errors, context } = await newPage(browser, { db: { requests: dia1(), delay: { agenda_block_add: 700, agenda_attend: 700 } } });
  await abrirAgenda(page);
  // bloqueio salvo e troca de aba antes da resposta
  await page.click('[data-view="bloqueios"]');
  await page.waitForSelector('#blForm');
  await page.fill('#blFrom', AMANHA);
  await page.click('#blOk');
  await page.click('#tab-pedidos');
  await page.waitForFunction(() => /Bloqueio salvo/.test(document.querySelector('#toast')?.textContent || ''));
  assert.equal(db.blocks.length, 1);
  assert.equal(await page.getAttribute('#tab-pedidos', 'aria-selected'), 'true', 'continua na aba escolhida');
  assert.equal(await page.locator('#agRoot').count(), 0, 'a agenda não desenha por cima da outra aba');
  await page.click('#tab-agenda');
  await page.waitForSelector('#agMain .ag-blsec');
  assert.match(await page.textContent('#agMain .ag-blsec'), /05\/11/);
  // chegada marcada e troca de aba antes da resposta
  await page.click('[data-view="hoje"]');
  await page.waitForSelector('#agMain .ag-lista');
  const ana = db.requests.find((r) => r.patient_name === 'Ana Clara Rocha');
  await page.click(`[data-act="atender"][data-k="chegou"][data-item="${ana.items[0].id}"][data-w="l"]`);
  await page.click('#tab-pedidos');
  await page.waitForFunction(() => /Paciente presente/.test(document.querySelector('#toast')?.textContent || ''));
  await page.click('#tab-agenda');
  await page.waitForSelector('#agMain .ag-lista');
  assert.match(await page.textContent(`#agi-${ana.items[0].id}`), /Paciente presente/);
  assert.deepEqual(errors, []);
  await context.close();
});

// ---------- fase 4.3: atualização automática, "Precisa de atenção" e Resumo ----------
// Pedido do site sem horário (o fluxo antigo: fica "Aguardando contato" até a clínica ligar).
const pendente = (name) => ({ id: nid('aaaaaaaa'), clinic_id: C1, status: 'pending', version: 1, channel: 'imed_app', patient_name: name, patient_phone: '11955554444', patient_email: null, notes: null,
  for_other: false, other_name: null, relationship: null, other_minor: false, uses_resources: false, created_at: '2026-11-03T12:00:00Z', slot_start: null, slot_end: null, preferred_date: AMANHA, preferred_period: 'tarde',
  hold_expires_at: null, cancel_reason: null, cancelled_by: null, cancelled_at: null, items: [] });
// Um Realtime de mentira na própria página (tem precedência sobre o do contexto, que fecha o canal): aceita a entrada
// no canal, responde ao batimento e deixa o teste mandar avisos {v} como o banco manda depois do COMMIT.
async function realtimeFalso(page) {
  const st = { joins: [], msgs: [], ws: null, url: '', closed: 0 };
  await page.routeWebSocket(REALTIME_WS, (ws) => {
    st.ws = ws; st.url = ws.url();
    ws.onMessage((raw) => {
      const m = JSON.parse(raw);
      st.msgs.push(m);
      if (m.event === 'phx_join') { st.joins.push(m); ws.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', ref: m.ref, payload: { status: 'ok', response: {} } })); }
      if (m.event === 'heartbeat') ws.send(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', ref: m.ref, payload: { status: 'ok', response: {} } }));
    });
    ws.onClose(() => { st.closed += 1; });
  });
  st.aviso = (v) => st.ws.send(JSON.stringify({ topic: `realtime:agenda:clinica:${C1}`, event: 'broadcast', payload: { event: 'agenda', payload: { v }, type: 'broadcast' } }));
  return st;
}
const visibilidade = (page, hidden) => page.evaluate((h) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

await scenario('teste 7, com o aviso: outra pessoa marca → a tela e a aba Pedidos atualizam sozinhas; rajada = 1 leitura; aviso velho não relê; o que está sendo digitado fica; token novo vai ao canal', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: dia1() } });
  const rt = await realtimeFalso(page);
  await abrirAgenda(page);
  await page.waitForFunction(() => /Atualizado às \d\d:\d\d · atualização automática ligada/.test(document.querySelector('#agQuando')?.textContent || ''));
  assert.equal(rt.joins.length, 1, 'entra no canal uma vez');
  const j = rt.joins[0];
  assert.equal(j.topic, `realtime:agenda:clinica:${C1}`, 'o canal privado da clínica');
  assert.equal(j.join_ref, j.ref);
  assert.deepEqual(j.payload, { config: { broadcast: { self: false, ack: false }, presence: { enabled: false }, private: true }, access_token: 'tok-init' });
  assert.equal(new URL(rt.url).searchParams.get('apikey'), PUBLISHABLE, 'a chave publishable em ?apikey=');
  assert.equal(new URL(rt.url).searchParams.get('vsn'), '1.0.0');
  assert.ok(!rt.url.includes('tok-'), 'o token da pessoa não vai no endereço');
  assert.ok(!/tempo real/i.test(await page.textContent('#agRoot')), 'a tela não promete "tempo real"');
  // outra pessoa (o telefone da recepção) marca às 16:00: o banco sobe a versão e avisa; a tela relê sozinha
  const antes = calls(log, 'agenda_view').length;
  db.requests.push(booking({ name: 'Nova Pessoa Teste', start: sp(HOJE, '16:00'), channel: 'clinica_telefone' })); db.version += 1;
  rt.aviso(db.version);
  await page.waitForFunction(() => /Nova T\./.test(document.querySelector('#agMain').textContent));
  assert.equal(calls(log, 'agenda_view').length, antes + 1);
  await page.waitForFunction(() => /A agenda foi atualizada/.test(document.querySelector('#agFala').textContent));
  assert.equal(await page.locator('#agMsg').textContent(), '', 'sem aviso à vista a cada mudança (só o leitor de tela sabe)');
  // rajada de 3 avisos: uma leitura só; aviso mais velho que a versão lida: nenhuma
  const a2 = calls(log, 'agenda_view').length;
  db.version += 1; rt.aviso(db.version); db.version += 1; rt.aviso(db.version); rt.aviso(db.version);
  await page.waitForTimeout(1500);
  assert.equal(calls(log, 'agenda_view').length, a2 + 1, 'a rajada vira uma leitura');
  rt.aviso(db.version - 1);
  await page.waitForTimeout(800);
  assert.equal(calls(log, 'agenda_view').length, a2 + 1, 'aviso velho não relê');
  // digitando o motivo de um bloqueio quando chega um aviso: o campo e o foco ficam; ao sair do campo, a lista nova aparece
  await page.click('[data-view="bloqueios"]');
  await page.waitForSelector('#blForm');
  await page.fill('#blMotivo', 'Reforma da sala');
  db.blocks.push({ id: 'bbbbbbbb-0000-4000-8000-000000000777', resource_id: null, kind: 'manutencao', starts_at: sp(AMANHA, '08:00'), ends_at: sp(AMANHA, '12:00'), reason: 'Chegou de fora' }); db.version += 1;
  rt.aviso(db.version);
  await page.waitForTimeout(1200);
  assert.equal(await page.inputValue('#blMotivo'), 'Reforma da sala', 'o que estava sendo digitado não some');
  assert.ok(await focoEm(page, '#blMotivo'), 'o foco continua no campo');
  assert.doesNotMatch(await page.textContent('#agMain'), /Chegou de fora/, 'a lista nova espera a pessoa sair do campo');
  await page.focus('#agTitulo');
  await page.waitForFunction(() => /Chegou de fora/.test(document.querySelector('#agMain').textContent));
  assert.equal(await page.inputValue('#blMotivo'), 'Reforma da sala', 'desenhada de novo, com o que foi digitado');
  // aba Pedidos: um pedido novo pelo site (sem horário) chega com o aviso; a lista é buscada de novo sozinha
  await page.click('#tab-pedidos');
  await page.waitForSelector('#flt-pedidos');
  // o foco num botão sem id ("Ver na agenda" de um cartão): a releitura não tira a lista da tela nem o foco do botão
  const alvo = await page.$eval('#panel [data-veragenda]', (x) => x.dataset.veragenda);
  await page.focus(`#panel [data-veragenda="${alvo}"]`);
  await page.evaluate(() => {
    window.__viuCarregando = false;
    new MutationObserver(() => { if (/Carregando pedidos/.test(document.querySelector('#panel')?.textContent || '')) window.__viuCarregando = true; })
      .observe(document.querySelector('#panel'), { childList: true, subtree: true, characterData: true });
  });
  const r0 = calls(log, 'agenda_requests').length;
  db.requests.push(pendente('Pedro Pendente Teste')); db.version += 1;
  rt.aviso(db.version);
  await page.waitForFunction(() => /Pedro Pendente Teste/.test(document.querySelector('#panel').textContent));
  assert.equal(calls(log, 'agenda_requests').length, r0 + 1);
  assert.equal(await page.evaluate(() => window.__viuCarregando), false, 'sem "Carregando pedidos…" no lugar da lista');
  assert.ok(await focoEm(page, `#panel [data-veragenda="${alvo}"]`), 'o foco continua no mesmo botão');
  assert.equal(await page.getAttribute('#tab-pedidos', 'aria-selected'), 'true');
  // o auth.js renovou o token: o canal recebe o novo sem reconectar
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('imed:token', { detail: { access_token: 'tok-renovado' } })));
  await page.waitForTimeout(300);
  const at = rt.msgs.find((m) => m.event === 'access_token');
  assert.deepEqual(at && { topic: at.topic, payload: at.payload }, { topic: `realtime:agenda:clinica:${C1}`, payload: { access_token: 'tok-renovado' } });
  assert.equal(rt.joins.length, 1, 'sem reconectar');
  semLeituraDireta(db);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('teste 7, sem Realtime (canal fechado): a consulta de 5 s atualiza a tela; a aba escondida pausa e ao voltar confere na hora; sem internet, a faixa "Sem conexão"', async () => {
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: dia1() } });
  await abrirAgenda(page);
  await page.waitForFunction(() => /Atualizado às \d\d:\d\d · confere a cada 5 s/.test(document.querySelector('#agQuando')?.textContent || ''));
  const v0 = calls(log, 'agenda_version').length;
  await page.waitForTimeout(5600);
  assert.ok(calls(log, 'agenda_version').length >= v0 + 1, 'consulta a versão a cada 5 s');
  const antes = calls(log, 'agenda_view').length;
  db.requests.push(booking({ name: 'Chegou Depois Teste', start: sp(HOJE, '17:00') })); db.version += 1;
  await page.waitForFunction(() => /Chegou T\./.test(document.querySelector('#agMain').textContent), null, { timeout: 9000 });
  assert.equal(calls(log, 'agenda_view').length, antes + 1, 'uma leitura');
  assert.deepEqual(calls(log, 'agenda_version').at(-1).body, { p_clinic: C1 });
  // aba escondida: nada de consulta; ao voltar, confere na hora e avisa que mudou enquanto estava fechada
  await visibilidade(page, true);
  await page.waitForTimeout(600);
  const h0 = calls(log, 'agenda_version').length;
  await page.waitForTimeout(6500);
  assert.equal(calls(log, 'agenda_version').length, h0, 'escondida: nenhuma consulta');
  db.requests.push(booking({ name: 'Outra Pessoa Teste', start: sp(HOJE, '18:00') })); db.version += 1;
  await visibilidade(page, false);
  await page.waitForFunction(() => /Outra T\./.test(document.querySelector('#agMain').textContent), null, { timeout: 3000 });
  assert.match(await page.textContent('#agMsg'), /A agenda mudou enquanto esta página estava fechada/);
  // sem internet: a faixa aparece e some quando a consulta volta a responder
  db.failNet.agenda_version = 2;
  await page.waitForFunction(() => /Sem conexão com o IMED agora/.test(document.querySelector('#agTop').textContent), null, { timeout: 9000 });
  assert.equal(await page.getAttribute('#agTop .ag-semrede', 'role'), 'status');
  await page.waitForFunction(() => !/Sem conexão com o IMED agora/.test(document.querySelector('#agTop').textContent), null, { timeout: 12000 });
  assert.match(await page.textContent('#agTitulo'), /Hoje, quarta-feira, 4 de novembro/, 'a tela continua a mesma');
  semLeituraDireta(db);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('"Precisa de atenção": chegada sem registro, reserva vencendo, para remarcar e pedidos sem resposta, só com o que as funções devolvem; "Ver" leva ao item; o profissional vê só o dele', async () => {
  const atrasado = booking({ name: 'Atrasado Sem Registro', start: sp(HOJE, '08:00') });
  const reserva = booking({ name: 'Reserva Vencendo Teste', start: sp(HOJE, '11:00'), status: 'hold' });
  reserva.hold_expires_at = new Date(Date.parse(NOW) + 5 * 60000).toISOString();
  const remarcar = booking({ name: 'Para Remarcar Teste', start: sp(HOJE, '13:00'), status: 'reschedule_requested', res: [] });
  const conflito = { id: 'kkkkkkkk-0000-4000-8000-000000000001', kind: 'bloqueio_sobre_agendamento', request_id: remarcar.id, item_id: remarcar.items[0].id, starts_at: remarcar.items[0].starts_at, procedure_id: P_USG, details: {}, status: 'aberto', resolution_code: null, created_at: '2026-11-03T12:00:00Z', resolved_at: null };
  const { page, db, log, errors, context } = await newPage(browser, { db: { requests: [atrasado, reserva, remarcar, booking({ name: 'Tudo Certo Teste', start: sp(HOJE, '15:00') }), pendente('Pedido Sem Resposta')], conflicts: [conflito] } });
  await abrirAgenda(page);
  await page.waitForSelector('#agAtencao .ag-atencao');
  assert.equal((await page.textContent('#agAtT')).trim(), 'Precisa de atenção');
  const linhas = await page.$$eval('#agAtencao li', (l) => l.map((x) => [x.dataset.k, x.querySelector('span').textContent, x.querySelector('button')?.textContent.replace(/\s+/g, ' ').trim()]));
  assert.deepEqual(linhas, [
    ['chegadas', '1 agendamento já passou da hora sem registro de chegada ou falta.', 'Ver o agendamento sem registro'],
    ['reservas', '1 reserva temporária vence nos próximos 15 min.', 'Ver a reserva'],
    ['remarcar', '1 agendamento para remarcar.', 'Ver a lista Para remarcar'],
    ['pedidos', '1 pedido de agendamento sem resposta.', 'Ver pedidos'],
  ]);
  assert.equal(calls(log, 'agenda_requests_pending_count').length, 1, 'os pedidos sem resposta vêm da contagem (uma vez por carga)');
  assert.equal(calls(log, 'agenda_requests').length, 0, 'sem baixar a lista de pedidos (nome e telefone) só para contar');
  await shot(page, 'agenda43-atencao-1024-claro');
  await page.click('#agAtencao li[data-k="chegadas"] button');
  assert.ok(await focoEm(page, `[data-act="abrir"][data-item="${atrasado.items[0].id}"]`), '"Ver" põe o foco no agendamento');
  await page.click('#agAtencao li[data-k="reservas"] button');
  assert.ok(await focoEm(page, `[data-act="abrir"][data-item="${reserva.items[0].id}"]`));
  await page.click('#agAtencao li[data-k="remarcar"] button');
  assert.equal(await focusId(page), 'agRemT', '"Ver a lista" vai para Para remarcar');
  // marcou a chegada: a linha some sozinha
  await page.click(`[data-act="atender"][data-k="chegou"][data-item="${atrasado.items[0].id}"][data-w="l"]`);
  await page.waitForFunction(() => !document.querySelector('#agAtencao li[data-k="chegadas"]'));
  assert.equal(await page.locator('#agAtencao li').count(), 3);
  await page.click('#agAtencao li[data-k="pedidos"] button');
  await page.waitForSelector('#flt-pedidos');
  assert.equal(await page.getAttribute('#tab-pedidos', 'aria-selected'), 'true', '"Ver pedidos" abre a aba Pedidos');
  assert.deepEqual(errors, []);
  await context.close();
  // sem nada pendente, o bloco não aparece; o profissional vê só o que é dele e nunca os pedidos
  const { page: p2, log: l2, errors: e2, context: c2 } = await newPage(browser, { role: 'professional', db: { requests: [booking({ name: 'Da Dra Atrasado', start: sp(HOJE, '08:30'), proc: P_ECO, res: [DRA] }), booking({ name: 'Do Aparelho Atrasado', start: sp(HOJE, '08:00') }), pendente('Pedido Sem Resposta')] } });
  await abrirAgenda(p2);
  await p2.waitForSelector('#agAtencao .ag-atencao');
  assert.deepEqual(await p2.$$eval('#agAtencao li', (l) => l.map((x) => x.dataset.k)), ['chegadas']);
  assert.match(await p2.textContent('#agAtencao'), /1 agendamento já passou/);
  assert.equal(calls(l2, 'agenda_requests').length + calls(l2, 'agenda_requests_pending_count').length, 0, 'o profissional não lê os pedidos');
  assert.deepEqual(e2, []);
  await c2.close();
  const { page: p3, errors: e3, context: c3 } = await newPage(browser, { mobile: true, theme: 'dark', db: { requests: [booking({ name: 'Atrasado Sem Registro', start: sp(HOJE, '08:00') }), pendente('Pedido Sem Resposta')] } });
  await abrirAgenda(p3);
  await p3.waitForSelector('#agAtencao .ag-atencao');
  assert.ok((await p3.$$eval('#agAtencao button', (b) => b.map((x) => x.getBoundingClientRect().height))).every((h) => h >= 44), 'botões de 44 px no celular');
  await noOverflow(p3);
  await shot(p3, 'agenda43-atencao-390-escuro');
  assert.deepEqual(e3, []);
  await c3.close();
  const { page: p4, errors: e4, context: c4 } = await newPage(browser, { db: { requests: [booking({ name: 'Tudo Certo Teste', start: sp(HOJE, '15:00') })] } });
  await abrirAgenda(p4);
  await carregada(p4);
  assert.equal(await p4.locator('#agAtencao .ag-atencao').count(), 0, 'nada pendente: sem o bloco');
  assert.deepEqual(e4, []);
  await c4.close();
});

await scenario('revisão 4.3: "Precisa de atenção" com o banco sem a contagem: a lista traz só os 100 mais novos e o bloco diz que pode haver mais; "Esta semana" do Resumo é a de hoje', async () => {
  const muitos = Array.from({ length: 101 }, (_, i) => pendente(`Pedido Antigo ${String(i).padStart(3, '0')} Teste`));
  const { page, log, errors, context } = await newPage(browser, { role: 'owner', missing: ['agenda_requests_pending_count'], db: { requests: muitos } });
  await abrirAgenda(page);
  await page.waitForSelector('#agAtencao li[data-k="pedidos"]');
  assert.match(await page.textContent('#agAtencao li[data-k="pedidos"]'), /100 pedidos de agendamento sem resposta entre os 100 mais recentes \(pode haver mais na aba Pedidos\)\./);
  assert.equal(calls(log, 'agenda_requests_pending_count').length, 1);
  assert.equal(calls(log, 'agenda_requests').length, 1, 'cai na lista de pedidos');
  // semana aberta duas para a frente e depois Resumo: "Esta semana" continua a de hoje
  await page.click('[data-view="semana"]');
  await carregada(page);
  await page.click('[data-act="prox"]');
  await carregada(page);
  await page.click('[data-act="prox"]');
  await carregada(page);
  await page.click('[data-view="resumo"]');
  await page.waitForSelector('#agMain .ag-rssec');
  assert.deepEqual(calls(log, 'agenda_dashboard').at(-1).body, { p_clinic: C1, p_from: '2026-11-02', p_to: '2026-11-08', p_filters: {} }, 'a semana de hoje (04/11), não a de 16/11');
  await page.selectOption('#rsPeriodo', 'mes');
  await page.waitForFunction(() => /01\/11\/2026 a 30\/11\/2026/.test(document.querySelector('#agMain').textContent));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Resumo (painel gerencial, dono): números das funções, período e filtros; financeiro só com financeiro.ver; recepção sem financeiro; profissional sem a visão; 390 px e tema escuro', async () => {
  const semana = () => {
    const cancelado = booking({ name: 'Desistiu Teste', start: sp(HOJE, '14:00'), status: 'cancelled' });
    cancelado.cancel_reason = 'paciente_desistiu';
    return [...dia1().slice(0, 3), cancelado,
      booking({ name: 'Concluído Teste', start: sp('2026-11-03', '09:00'), status: 'completed' }),
      booking({ name: 'Faltou Teste', start: sp('2026-11-03', '10:00'), status: 'no_show', channel: 'externo' })];
  };
  const { page, db, log, errors, context } = await newPage(browser, { role: 'owner', db: { requests: semana() } });
  await abrirAgenda(page);
  await page.click('[data-view="resumo"]');
  await page.waitForSelector('#agMain .ag-rssec');
  await carregada(page);
  assert.ok(await focoEm(page, '[data-view="resumo"]'));
  assert.match(await page.textContent('#agTitulo'), /Resumo da agenda/);
  assert.equal(await page.locator('.ag-nav').count(), 0, 'sem Anterior/Próximo no resumo (o período é o seletor)');
  assert.deepEqual(calls(log, 'agenda_dashboard').at(-1).body, { p_clinic: C1, p_from: '2026-11-02', p_to: '2026-11-08', p_filters: {} }, 'esta semana, sem filtros');
  assert.deepEqual(calls(log, 'agenda_dashboard_financeiro').at(-1).body, { p_clinic: C1, p_from: '2026-11-02', p_to: '2026-11-08' });
  assert.match(await page.textContent('.ag-rsper'), /02\/11\/2026 a 08\/11\/2026/);
  const kpi = async (label) => page.$$eval('.ag-kpi', (els, l) => els.find((e) => e.querySelector('span').textContent === l)?.querySelector('b').textContent, label);
  assert.equal(await kpi('Agendamentos no período'), '6');
  assert.equal(await kpi('Confirmados'), '2');
  assert.equal(await kpi('Presentes ou em atendimento'), '1');
  assert.equal(await kpi('Concluídos'), '1');
  assert.equal(await kpi('Não compareceram'), '1');
  assert.equal(await kpi('Cancelados'), '1');
  assert.equal(await kpi('Faltas'), '50%');
  const main = await page.textContent('#agMain');
  assert.match(main, /O paciente desistiu/, 'motivo de cancelamento em palavras');
  assert.match(main, /Sistema da clínica/, 'origem externa');
  assert.match(main, /Aparelho de Ultrassom <b>1<\/b>/, 'nome do recurso escapado');
  assert.match(main, /ocupação = minutos ocupados/, 'a fórmula do banco na tela');
  assert.match(main, /ter\., 03\/11/, 'por dia');
  // financeiro: o dono tem financeiro.ver
  assert.match(await page.textContent('#agFinT'), /Financeiro/);
  assert.equal(await kpi('Receita estimada'), 'R$\u00a0540,00', '3 ultrassons de R$ 180 (marcados, presente e concluído); cancelado e falta ficam fora; eco sem preço não soma');
  assert.equal(await kpi('Receita dos concluídos'), 'R$\u00a0180,00');
  assert.equal(await kpi('Sob consulta (sem preço)'), '1');
  assert.match(main, /não confirma pagamentos/);
  assert.ok(!/R\$\s?0,00 pago|pago/i.test(main.replace(/pagamento/gi, '')), 'nada aparece como "pago" (sem pagamento online)');
  await shot(page, 'agenda43-resumo-1024-claro');
  // filtro de exame: p_filters; período Hoje; período inválido não chama
  const d1 = calls(log, 'agenda_dashboard').length;
  await page.selectOption('#agFExame', P_ECO);
  await carregada(page);
  await page.waitForFunction(() => /Agendamentos no período/.test(document.querySelector('#agMain').textContent));
  assert.deepEqual(calls(log, 'agenda_dashboard').at(-1).body.p_filters, { procedure_id: P_ECO });
  assert.equal(await kpi('Agendamentos no período'), '1');
  assert.match(await page.textContent('#agOpT'), /com os filtros ligados/, 'o operacional diz que usa os filtros');
  assert.doesNotMatch(await page.textContent('.ag-rsper'), /filtros/, 'a linha do período não diz isso por todos');
  assert.match(await page.textContent('#agMain'), /O financeiro não usa os filtros: são todos os exames, recursos e origens do período\./);
  await page.selectOption('#agFExame', '');
  await carregada(page);
  await page.focus('#rsPeriodo');
  await page.selectOption('#rsPeriodo', 'hoje');
  await page.waitForFunction(() => /04\/11\/2026 a 04\/11\/2026/.test(document.querySelector('#agMain').textContent));
  assert.deepEqual(calls(log, 'agenda_dashboard').at(-1).body, { p_clinic: C1, p_from: HOJE, p_to: HOJE, p_filters: {} });
  assert.ok(await focoEm(page, '#rsPeriodo'), 'o foco fica no seletor');
  const d2 = calls(log, 'agenda_dashboard').length;
  await page.selectOption('#rsPeriodo', 'custom');
  await page.waitForSelector('#rsDe');
  await page.fill('#rsDe', '2026-11-10');
  await page.fill('#rsAte', '2026-11-01');
  await page.click('[data-act="rs-ver"]');
  await page.waitForFunction(() => /O último dia não pode vir antes do primeiro/.test(document.querySelector('#agMain').textContent));
  assert.equal(calls(log, 'agenda_dashboard').length, d2, 'período inválido: não chama o banco');
  await page.fill('#rsAte', '2026-11-30');
  await page.click('[data-act="rs-ver"]');
  await page.waitForFunction(() => /10\/11\/2026 a 30\/11\/2026/.test(document.querySelector('#agMain').textContent));
  assert.deepEqual(calls(log, 'agenda_dashboard').at(-1).body, { p_clinic: C1, p_from: '2026-11-10', p_to: '2026-11-30', p_filters: {} });
  assert.equal(await kpi('Agendamentos no período'), '0');
  semLeituraDireta(db);
  assert.deepEqual(errors, []);
  await context.close();
  // recepção: o resumo sem o financeiro (e sem chamar a função); profissional: sem a visão
  const { page: p2, db: db2, log: l2, errors: e2, context: c2 } = await newPage(browser, { role: 'reception', db: { requests: semana() } });
  await abrirAgenda(p2);
  await p2.click('[data-view="resumo"]');
  await p2.waitForSelector('#agMain .ag-rssec');
  await carregada(p2);
  assert.equal(await p2.locator('#agFinT').count(), 0, 'a recepção não vê o financeiro');
  assert.equal(calls(l2, 'agenda_dashboard_financeiro').length, 0, 'e a função nem é chamada');
  assert.equal(db2.finCalls, undefined);
  assert.deepEqual(e2, []);
  await c2.close();
  const { page: p3, errors: e3, context: c3 } = await newPage(browser, { role: 'professional', db: { requests: semana() } });
  await abrirAgenda(p3);
  assert.equal(await p3.locator('[data-view="resumo"]').count(), 0, 'o profissional não tem a visão Resumo');
  assert.deepEqual(e3, []);
  await c3.close();
  // celular e tema escuro: sem rolagem lateral, alvos de 44 px
  for (const theme of [null, 'dark']) {
    const { page: p4, errors: e4, context: c4 } = await newPage(browser, { role: 'owner', mobile: true, theme, db: { requests: semana() } });
    await abrirAgenda(p4);
    await p4.click('[data-view="resumo"]');
    await p4.waitForSelector('#agMain .ag-rssec');
    await carregada(p4);
    await noOverflow(p4);
    assert.ok((await p4.$$eval('#agMain button, #agMain select, #agMain input', (b) => b.map((x) => x.getBoundingClientRect().height))).every((h) => h >= 44), 'alvos de 44 px');
    await shot(p4, `agenda43-resumo-390-${theme === 'dark' ? 'escuro' : 'claro'}`);
    assert.deepEqual(e4, []);
    await c4.close();
  }
  // 360 px: valor em reais numa linha só (sem quebrar no meio do número) e as tabelas dentro do cartão
  {
    const { page: p6, errors: e6, context: c6 } = await newPage(browser, { role: 'owner', mobile: 360, db: { requests: semana() } });
    await abrirAgenda(p6);
    await p6.click('[data-view="resumo"]');
    await p6.waitForSelector('#agFinT');
    await carregada(p6);
    await noOverflow(p6);
    const kpis = await p6.$$eval('.ag-kpi b', (els) => els.map((b) => { const r = b.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(b).lineHeight); return { t: b.textContent, linhas: Math.round(r.height / lh), dentro: r.right <= b.parentElement.getBoundingClientRect().right + 0.5 }; }));
    for (const k of kpis) { assert.equal(k.linhas, 1, `"${k.t}" numa linha só`); assert.ok(k.dentro, `"${k.t}" dentro do cartão`); }
    const tabs = await p6.$$eval('.ag-rsbox', (els) => els.filter((e) => e.querySelector('table')).map((e) => ({ t: e.getAttribute('aria-label'), sobra: e.querySelector('table').getBoundingClientRect().right - e.getBoundingClientRect().right })));
    for (const t of tabs) assert.ok(t.sobra <= 0.5, `tabela "${t.t}" dentro do cartão (passa ${t.sobra}px)`);
    await shot(p6, 'agenda43-resumo-360-claro');
    assert.deepEqual(e6, []);
    await c6.close();
  }
  const { page: p5, errors: e5, context: c5 } = await newPage(browser, { role: 'owner', theme: 'dark', db: { requests: semana() } });
  await abrirAgenda(p5);
  await p5.click('[data-view="resumo"]');
  await p5.waitForSelector('#agMain .ag-rssec');
  await carregada(p5);
  const cores = await p5.$eval('.ag-rsbox', (e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e.querySelector('td')).color]);
  assert.notEqual(cores[0], 'rgb(255, 255, 255)', 'tema escuro pelos tokens');
  await shot(p5, 'agenda43-resumo-1024-escuro');
  assert.deepEqual(e5, []);
  await c5.close();
});

await browser.close();
server.close();
const falhas = results.filter(([r]) => r !== 'ok');
console.log(`\n${results.length - falhas.length}/${results.length} cenários ok`);
if (falhas.length) process.exit(1);
