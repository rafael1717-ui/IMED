// Teste de ponta a ponta das páginas da clínica (reivindicar.html e painel.html) num navegador de
// verdade (Playwright), com o Supabase (login, banco e funções) simulado.
// Rodar com: node tests/e2e-clinica.mjs   (precisa do pacote "playwright" instalado)
// Opcional: SHOTS=pasta node tests/e2e-clinica.mjs  salva capturas de tela nessa pasta.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, vigiarChaves } from './regra-chaves.mjs';
import { ROLE_PERMS } from '../assets/js/agenda-core.js';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const PORT = Number(process.env.E2E_PORT) || 8768; // E2E_PORT: outra porta para rodar em paralelo
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('não encontrado');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

// ---------- dados simulados ----------
const USER_ID = 'uuuuuuuu-0000-4000-8000-000000000001';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const SP = 3550308;
const ESTABLISHMENTS = [
  { cnes: '2077485', name: 'Hospital Santa Exemplo', kind: 'hospital', address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', cep: '01409001', city_ibge: SP, phone: '(11) 3141-1000' },
  { cnes: '6543210', name: 'Laboratório Análise Paulista', kind: 'laboratorio', address_line: 'Alameda Santos, 200', neighborhood: 'Bela Vista', cep: '01418000', city_ibge: SP },
  { cnes: '1112223', name: 'Clínica Santa <b>Luz</b>', kind: 'clinica', address_line: 'Rua Augusta, 10', neighborhood: 'Consolação', cep: null, city_ibge: SP },
];
const MUNICIPALITIES = [{ ibge: SP, name: 'São Paulo', uf: 'SP', cnes_code: 355030 }, { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', cnes_code: 330455 }];
const CITIES = [
  { ibge: SP, name: 'São Paulo', uf: 'SP', total: 3, imagem: 0, laboratorio: 1, clinica: 1, hospital: 1 },
  { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', total: 0, imagem: 0, laboratorio: 0, clinica: 0, hospital: 0 },
];
const CLINIC = {
  id: C1, name: 'Imagem Paulista', kind: 'imagem', description: null, address_line: 'Av. Paulista, 1500', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: '01310-200',
  phone: null, whatsapp: null, email: null, website: null, specialties: ['Radiologia'], opening_hours: null, accepts_online_booking: true, status: 'published', is_demo: false, insurances: ['Amil', 'Plano Antigo'], cnes: '7654321',
};
const REQUESTS = [
  { id: 'rrrrrrrr-0000-4000-8000-000000000001', clinic_id: C1, created_at: '2026-10-29T13:05:00Z', exam_code: 'rm', preferred_date: '2026-11-05', preferred_period: 'manha', patient_name: 'Maria Souza', patient_phone: '11987654321', patient_email: 'maria@exemplo.com', notes: 'Tenho claustrofobia <img src=x onerror="window.__xss=1">', status: 'pending' },
  { id: 'rrrrrrrr-0000-4000-8000-000000000002', clinic_id: C1, created_at: '2026-10-28T18:00:00Z', exam_code: 'tc', preferred_date: '2026-11-03', preferred_period: 'qualquer', patient_name: 'João Lima', patient_phone: '1133334444', patient_email: null, notes: null, status: 'confirmed' },
];
const IMED_REQUESTS = [
  { id: 'rrrrrrrr-0000-4000-8000-000000000010', clinic_id: null, created_at: '2026-10-29T15:00:00Z', exam_code: 'usg', preferred_date: '2026-11-06', preferred_period: 'tarde', patient_name: 'Ana Prado', patient_phone: '21998887777', patient_email: null, notes: null, status: 'pending', place_source: 'cnes', place_ref: 'cnes:2077485', place_name: 'Hospital Santa Exemplo', place_address: 'Rua Peixoto Gomide, 625', place_phone: '(11) 3141-1000' },
];
const CLAIMS = [
  { id: 'kkkkkkkk-0000-4000-8000-000000000001', created_at: '2026-10-29T10:00:00Z', cnes: '2077485', user_id: 'x', email: 'dono@hospital.com.br', claimant_name: 'Carlos Dono', role: 'proprietario', document: '52998224725', crm: '123456-SP', phone: '11987650000', message: 'Sou o dono <script>alert(1)</script>', status: 'pending', decided_at: null, decision_note: null, clinic_id: null },
  { id: 'kkkkkkkk-0000-4000-8000-000000000002', created_at: '2026-10-29T11:00:00Z', cnes: '6543210', user_id: 'y', email: 'ger@lab.com.br', claimant_name: 'Paula Gerente', role: 'gestor', document: '11222333000181', crm: null, phone: '1130002000', message: null, status: 'pending', decided_at: null, decision_note: null, clinic_id: null },
  { id: 'kkkkkkkk-0000-4000-8000-000000000003', created_at: '2026-10-20T11:00:00Z', cnes: '1112223', user_id: 'z', email: 'a@b.com', claimant_name: 'Velho Pedido', role: 'outro', document: '52998224725', crm: null, phone: '1130002000', message: null, status: 'rejected', decided_at: '2026-10-21T11:00:00Z', decision_note: 'Sem vínculo', clinic_id: null },
];

const clone = (x) => JSON.parse(JSON.stringify(x));
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });

// Filtros do PostgREST usados pelas páginas: eq, neq, in, is.null, ilike.
function applyFilters(rows, q) {
  let out = rows;
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
    else if (op === 'neq') out = out.filter((r) => String(r[k]) !== val);
    else if (op === 'is' && val === 'null') out = out.filter((r) => r[k] == null);
    else if (op === 'gte') out = out.filter((r) => { const a = Date.parse(r[k]); const b = Date.parse(val); return Number.isNaN(a) || Number.isNaN(b) ? String(r[k]) >= val : a >= b; });
    else if (op === 'lte') out = out.filter((r) => { const a = Date.parse(r[k]); const b = Date.parse(val); return Number.isNaN(a) || Number.isNaN(b) ? String(r[k]) <= val : a <= b; });
    else if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(','); out = out.filter((r) => set.includes(String(r[k]))); }
    else if (op === 'ilike') { const t = val.replace(/^\*|\*$/g, '').toLowerCase(); out = out.filter((r) => String(r[k]).toLowerCase().includes(t)); }
  }
  const lim = Number(q.get('limit') || 0);
  return lim ? out.slice(0, lim) : out;
}

// now: data e hora fixas no navegador (para "hoje", "próximos 7 dias" e bloqueios).
// tz: fuso do aparelho (a página tem de mostrar e montar tudo no horário de São Paulo mesmo assim).
async function newPage(browser, { mobile = false, logged = false, email = 'dono@clinica.com.br', db: dbOpts = {}, now = null, tz = 'America/Sao_Paulo' } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: tz, serviceWorkers: 'block',
  });
  if (now) await context.clock.setFixedTime(new Date(now));
  const nowMs = now ? Date.parse(now) : Date.now();
  const db = {
    admin: false, members: [], clinics: [], exams: [], requests: [], claims: [], claimInsert: null, failUpdate: false,
    schedules: [], blocks: [], slots: [], scheduleResult: 'ok', blockResult: 'ok', removeResult: null,
    claimChecks: [], checksResult: null, approveError: null, messages: [], msgResult: null, reports: [], repResult: null, failTrustCols: false,
    stats: null, statsError: null, statsDelay: 0,
    ...clone({ ...dbOpts, claimInsert: undefined }), claimInsert: dbOpts.claimInsert ?? null,
  };
  const log = [];
  await context.addInitScript(([s]) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (s && !sessionStorage.getItem('__seeded')) { localStorage.setItem('imed_session', JSON.stringify(s)); sessionStorage.setItem('__seeded', '1'); }
    } catch { /* */ }
  }, [logged ? { access_token: 'tok-init', refresh_token: 'ref', expires_at: Math.floor(nowMs / 1000) + 3600, user: { id: USER_ID, email } } : null]);
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const path = url.pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const entry = { method: req.method(), path, q: url.search, query: url.searchParams, body, auth: req.headers().authorization };
    log.push(entry);
    const q = url.searchParams;
    if (path === '/auth/v1/otp') return json(route, {});
    if (path === '/auth/v1/user') return json(route, { id: USER_ID, email });
    if (path === '/auth/v1/token' && db.failRefresh) return json(route, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }, 400);
    if (path === '/auth/v1/token') return json(route, { access_token: 'tok-new', refresh_token: 'ref2', expires_in: 3600, user: { id: USER_ID, email } });
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
    const rest = path.replace('/rest/v1/', '');
    const anon = !/^Bearer tok-/.test(entry.auth || '');
    // Sem a conta (chave pública), o banco recusa o que exige login.
    if (anon && (['clinic_members', 'rpc/set_request_status', 'rpc/update_my_clinic', 'rpc/agenda_me'].includes(rest) || (rest === 'establishment_claims' && req.method() === 'POST'))) {
      return json(route, { code: '42501', message: `permission denied for ${rest}` }, 401);
    }
    const delay = (db.delays || []).find((d) => rest === d.path && (url.search.includes(d.match) || JSON.stringify(body || {}).includes(d.match)));
    if (delay) await new Promise((r) => setTimeout(r, delay.ms));
    switch (rest) {
      case 'establishments': return json(route, applyFilters(ESTABLISHMENTS, q));
      case 'municipalities': return json(route, applyFilters(MUNICIPALITIES, q));
      case 'rpc/imported_cities': return json(route, CITIES);
      case 'rpc/is_imed_admin': return json(route, db.admin);
      case 'clinic_members': return json(route, db.members);
      // iMed Agenda (3.4 e 4.1): quem sou (só os MEUS vínculos, com as permissões do papel), convites e configuração.
      case 'rpc/agenda_me': return json(route, { status: 'ok', user_id: USER_ID, clinics: db.members.map((m) => ({ clinic_id: m.clinic_id, role: m.role, permissions: ROLE_PERMS[m.role] || {} })), imed: { admin: db.admin, permissions: [] } });
      case 'rpc/agenda_my_invites': return json(route, { status: 'ok', invites: [] });
      case 'rpc/agenda_config': return json(route, db.agendaCfg || { status: 'ok', clinic_id: body.p_clinic, active: false, old_schedule_exists: false,
        unit: { timezone: 'America/Sao_Paulo', timezone_suggested: 'America/Sao_Paulo', timezone_confirmed_at: null, agenda_mode: 'pedido', agenda_online_since: null, manual_commitment_at: null },
        resources: [], procedures: [], rules: [], pair_rules: [], holiday_openings: [] });
      case 'rpc/agenda_team': return json(route, { status: 'ok', members: [{ user_id: USER_ID, email, role: 'owner', created_at: '2026-10-01T12:00:00Z', me: true }], invites: [] });
      case 'clinics': return json(route, applyFilters(db.clinics, q));
      case 'clinic_exams': return json(route, applyFilters(db.exams, q));
      // Fase 4.2: a clínica lê os pedidos pela função agenda_requests, como o banco: sem reserva temporária nem
      // expirada; "hoje" e "semana" pelo dia da clínica (no fuso dela: São Paulo, se o cadastro não disser outro); 100
      // sem filtro e 200 com; ordem do banco (data preferida na semana, horário, mais novo primeiro). noRequestsFn:
      // banco sem a função (404).
      case 'rpc/agenda_requests': {
        if (db.noRequestsFn) return json(route, { code: 'PGRST202', message: 'Could not find the function public.agenda_requests(p_clinic, p_justification, p_when) in the schema cache' }, 404);
        const member = db.members.some((m) => m.clinic_id === body.p_clinic);
        if (!member && !db.admin) return json(route, { status: 'forbidden' });
        if (!member && !body.p_justification) return json(route, { status: 'justification_required' });
        const tzc = db.clinics.find((c) => c.id === body.p_clinic)?.timezone || 'America/Sao_Paulo';
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: tzc }).format(new Date(nowMs));
        const ate = new Date(Date.parse(`${today}T12:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
        const w = body.p_when;
        const cmp = (a, b) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0);
        const k1 = (r) => (w === 'semana' ? r.preferred_date : null);
        const k2 = (r) => (w && r.slot_start ? Date.parse(r.slot_start) : null);
        const rows = db.requests.filter((r) => r.clinic_id === body.p_clinic && !['hold', 'expired'].includes(r.status)
          && (!w || (w === 'hoje' ? r.preferred_date === today : r.preferred_date >= today && r.preferred_date <= ate)))
          .sort((a, b) => cmp(k1(a), k1(b)) || cmp(k2(a), k2(b)) || Date.parse(b.created_at) - Date.parse(a.created_at))
          .slice(0, w ? 200 : 100);
        return json(route, { status: 'ok', scope: member ? 'clinica' : 'central', timezone: tzc, today, requests: rows });
      }
      // Agenda (3.4, já na produção): grade vazia. As funções da 4.2 ficam de fora: a aba mostra que ainda não estão
      // disponíveis (a agenda inteira é testada no e2e-agenda).
      case 'rpc/agenda_view': return json(route, { status: 'ok', version: 1, timezone: 'America/Sao_Paulo', scope: 'clinica', patients: true, resources: [], items: [], busy: [], blocks: [] });
      case 'rpc/agenda_conflicts': return json(route, { status: 'ok', conflicts: [] });
      case 'appointment_requests':
        // Banco sem a migração de confiança: a coluna nova não existe (42703).
        if (db.failTrustCols && /for_other/.test(q.get('select') || '')) return json(route, { code: '42703', message: 'column appointment_requests.for_other does not exist' }, 400);
        return json(route, applyFilters(db.requests, q));
      case 'claim_checks': return json(route, applyFilters(db.claimChecks, q));
      case 'rpc/save_claim_checks': {
        if (db.checksResult) return json(route, db.checksResult);
        db.claimChecks = db.claimChecks.filter((x) => x.claim_id !== body.p_claim);
        db.claimChecks.push({ claim_id: body.p_claim, cnes_active: false, cnpj_active: false, phone_confirmed: false, council_active: false, council: null, council_number: null, note: null, ...body.p_checks, checked_at: new Date().toISOString(), checked_by: USER_ID });
        return json(route, 'ok');
      }
      case 'contact_messages': return json(route, applyFilters(db.messages, q));
      case 'rpc/set_contact_status': {
        if (db.msgResult) return json(route, db.msgResult);
        const m = db.messages.find((x) => x.id === body.p_id);
        if (!m) return json(route, 'not_found');
        m.status = body.p_status; m.answered_at = body.p_status === 'answered' ? new Date().toISOString() : null;
        return json(route, 'ok');
      }
      case 'place_reports': return json(route, applyFilters(db.reports, q));
      case 'rpc/admin_stats': {
        // Números do contador de visitas próprio (só admin). statsDelay: demora para responder.
        if (db.statsDelay) await new Promise((r) => setTimeout(r, db.statsDelay));
        if (db.statsError) return json(route, db.statsError.body, db.statsError.status);
        if (!db.admin) return json(route, { code: '42501', message: 'forbidden' }, 403);
        return json(route, db.stats?.[body.p_days] ?? null);
      }
      case 'rpc/set_place_report_status': {
        if (db.repResult) return json(route, db.repResult);
        const r = db.reports.find((x) => x.id === body.p_id);
        if (!r) return json(route, 'not_found');
        r.status = body.p_status; r.resolved_at = body.p_status === 'resolved' ? new Date().toISOString() : null;
        return json(route, 'ok');
      }
      case 'establishment_claims':
        if (req.method() === 'POST') {
          if (db.claimInsert) return json(route, db.claimInsert.body, db.claimInsert.status);
          db.claims.unshift({ id: 'kkkkkkkk-0000-4000-8000-0000000000aa', created_at: new Date().toISOString(), status: 'pending', decision_note: null, ...body });
          return route.fulfill({ status: 201, body: '', headers: CORS });
        }
        return json(route, applyFilters(db.claims, q));
      case 'rpc/set_request_status': {
        const r = db.requests.find((x) => x.id === body.p_id);
        if (db.statusResult) return db.statusResult.status ? json(route, db.statusResult.body, db.statusResult.status) : json(route, db.statusResult);
        // Como o banco: o cancelamento feito pelo próprio paciente não se desfaz pelo painel da clínica.
        if (r && r.status === 'cancelled' && r.cancelled_by === 'patient' && !db.admin) return json(route, 'cancelled_by_patient');
        if (r) r.status = body.p_status;
        return json(route, r ? 'ok' : 'not_found');
      }
      case 'rpc/update_my_clinic':
        if (db.failUpdate) return json(route, { code: '23514', message: 'new row for relation "clinics" violates check constraint "clinics_website_check"' }, 400);
        return json(route, 'ok');
      case 'rpc/set_my_clinic_exams': return json(route, 'ok');
      case 'clinic_schedules': return json(route, applyFilters(db.schedules, q));
      case 'clinic_blocks': return json(route, applyFilters(db.blocks, q).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)));
      case 'rpc/available_slots': return json(route, db.slots.filter((x) => !x.exam || x.exam === body.p_exam).map((x) => ({ slot_start: x.slot_start })));
      case 'rpc/set_my_schedule': return json(route, db.scheduleResult);
      case 'rpc/add_my_block':
        if (db.blockResult !== 'ok') return json(route, db.blockResult);
        db.blocks.push({ id: `bbbbbbbb-0000-4000-8000-${String(100 + db.blocks.length).padStart(12, '0')}`, clinic_id: body.p_clinic, starts_at: body.p_starts, ends_at: body.p_ends, reason: body.p_reason, created_at: new Date().toISOString() });
        return json(route, 'ok');
      case 'rpc/remove_my_block': {
        if (db.removeResult) return json(route, db.removeResult);
        const i = db.blocks.findIndex((x) => x.id === body.p_block);
        if (i < 0) return json(route, 'not_found');
        db.blocks.splice(i, 1);
        return json(route, 'ok');
      }
      case 'rpc/approve_claim': {
        if (db.approveError) return json(route, db.approveError.body, db.approveError.status);
        const ck = db.claimChecks.find((x) => x.claim_id === body.p_claim);
        if (!ck || !ck.cnes_active || !ck.cnpj_active || !ck.phone_confirmed || !ck.council_active || !ck.council || !ck.council_number) {
          return json(route, { code: '22023', message: 'Antes de aprovar, faça a conferência: CNES ativo, CNPJ ativo, ligação para o telefone oficial do CNES e registro ativo do profissional responsável pelo local no conselho da profissão (com o conselho e o número).' }, 400);
        }
        const c = db.claims.find((x) => x.id === body.p_claim);
        c.status = 'approved'; c.decided_at = new Date().toISOString();
        return json(route, C1);
      }
      case 'rpc/reject_claim': {
        const c = db.claims.find((x) => x.id === body.p_claim);
        c.status = 'rejected'; c.decided_at = new Date().toISOString(); c.decision_note = body.p_note;
        return route.fulfill({ status: 204, headers: CORS });
      }
      default:
        return json(route, { message: `não simulado: ${rest}` }, 404);
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push(`diálogo inesperado: ${d.message()}`); d.dismiss(); });
  return { context, page, log, db, errors };
}

const calls = (log, path, method) => log.filter((e) => e.path.endsWith(path) && (!method || e.method === method));
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
const noOverflow = async (page) => {
  // No celular a janela visual pode crescer junto com o conteúdo: compara com a largura do aparelho.
  const [w, sw] = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
  const vw = page.viewportSize().width;
  assert.ok(w <= vw && sw <= vw, `sem rolagem lateral (janela ${w}px, conteúdo ${sw}px, aparelho ${vw}px)`);
};

const results = [];
// Tempo máximo de cada cenário (E2E_CENARIO_S segundos, padrão 150): um cenário travado falha com o nome dele,
// em vez de segurar o arquivo inteiro até o limite do CI.
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  try { await Promise.race([comChaves(fn), limite(name)]); results.push(['ok', name]); console.log(`ok  ${name}`); } catch (e) { results.push(['FALHOU', name]); console.log(`FALHOU  ${name}\n   ${e.stack}`); }
}

const browser = vigiarChaves(await chromium.launch());

await scenario('reivindicar com ?cnes=: mostra o local, pede login, valida CPF/CNPJ e envia só dígitos', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}reivindicar.html?cnes=2077485`);
  await page.waitForSelector('.cl-place h3');
  assert.equal(await page.textContent('.cl-place h3'), 'Hospital Santa Exemplo');
  assert.match(await page.textContent('.cl-place'), /Hospital · CNES 2077485/);
  assert.match(await page.textContent('.cl-place'), /São Paulo - SP · 01409-001/);
  assert.ok(calls(log, '/establishments')[0].q.includes('cnes=eq.2077485'));
  assert.ok(await page.isVisible('#s2'));
  assert.ok(await page.isHidden('#s3'), 'formulário só depois de entrar');
  assert.ok(await page.isHidden('#findForm'));
  // login
  await page.fill('#loginEmail', 'errado@');
  await page.click('#authBox button[type=submit]');
  assert.match(await page.textContent('#loginMsg'), /e-mail válido/);
  assert.equal(calls(log, '/auth/v1/otp').length, 0);
  await page.fill('#loginEmail', 'Dono@Clinica.com.br');
  await page.click('#authBox button[type=submit]');
  await page.waitForSelector('#loginMsg.ok');
  assert.match(await page.textContent('#loginMsg'), /Enviamos um link para dono@clinica\.com\.br\. Abra no mesmo aparelho/);
  const otp = calls(log, '/auth/v1/otp')[0];
  assert.deepEqual(otp.body, { email: 'dono@clinica.com.br', create_user: true });
  assert.equal(otp.query.get('redirect_to'), `${BASE}reivindicar.html?cnes=2077485`);
  await shot(page, '01-reivindicar-login');
  // volta do link (vindo de fora, como pelo e-mail)
  await page.goto('about:blank');
  await page.goto(`${BASE}reivindicar.html?cnes=2077485#access_token=tok-link&refresh_token=ref-link&expires_in=3600&token_type=bearer`);
  await page.waitForSelector('#s3:not([hidden])');
  assert.match(await page.textContent('#flash'), /Pronto, você entrou/);
  assert.equal(new URL(page.url()).hash, '', 'endereço limpo');
  assert.match(await page.textContent('#authBox'), /Você entrou como dono@clinica\.com\.br/);
  assert.equal(calls(log, '/auth/v1/user')[0].auth, 'Bearer tok-link');
  await page.waitForSelector('#mineBox .cl-help');
  assert.match(await page.textContent('#mineBox'), /ainda não fez nenhum pedido/);
  // validações
  await page.click('#claimBtn');
  assert.match(await page.textContent('#cNameErr'), /nome completo/);
  assert.match(await page.textContent('#cRoleErr'), /cargo/);
  assert.match(await page.textContent('#cDocErr'), /inválido/);
  assert.match(await page.textContent('#cPhoneErr'), /Celular inválido/);
  assert.match(await page.textContent('#cAgreeErr'), /Marque/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cName');
  await page.fill('#cName', 'Carlos  da Silva');
  await page.selectOption('#cRole', 'responsavel_tecnico');
  await page.type('#cDoc', '11111111111');
  assert.equal(await page.inputValue('#cDoc'), '111.111.111-11');
  await page.type('#cPhone', '11987654321');
  assert.equal(await page.inputValue('#cPhone'), '(11) 98765-4321');
  await page.check('#cAgree');
  await page.click('#claimBtn');
  assert.match(await page.textContent('#cDocErr'), /CPF ou CNPJ inválido/);
  await page.fill('#cDoc', '');
  await page.type('#cDoc', '11222333000180');
  assert.equal(await page.inputValue('#cDoc'), '11.222.333/0001-80');
  await page.click('#claimBtn');
  assert.match(await page.textContent('#cDocErr'), /CPF ou CNPJ inválido/, 'CNPJ com dígito errado');
  assert.equal(calls(log, '/establishment_claims', 'POST').length, 0);
  await page.fill('#cDoc', '');
  await page.type('#cDoc', '529.982.247-25');
  await page.fill('#cCrm', ' 123456-SP ');
  await page.fill('#cMsg', 'Sou o responsável técnico.');
  assert.equal(await page.textContent('#cMsgCount'), '26 de 500 caracteres');
  await shot(page, '02-reivindicar-formulario');
  await page.click('#claimBtn');
  await page.waitForSelector('#claimDone .cl-note.ok');
  const ins = calls(log, '/establishment_claims', 'POST');
  assert.equal(ins.length, 1);
  assert.deepEqual(ins[0].body, { cnes: '2077485', claimant_name: 'Carlos da Silva', role: 'responsavel_tecnico', document: '52998224725', crm: '123456-SP', phone: '11987654321', message: 'Sou o responsável técnico.' });
  assert.equal(ins[0].auth, 'Bearer tok-link');
  assert.match(await page.textContent('#claimDone'), /Pedido enviado\. A equipe do IMED confere os dados e responde pelo contato informado\./);
  assert.ok(!/dias úteis|por e-mail/.test(await page.textContent('#claimDone')), 'sem prazo prometido (nada avisa a equipe sozinho ainda)');
  assert.equal(await page.getAttribute('#claimDone a.btn', 'href'), 'painel.html');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'claimDone');
  assert.ok(await page.isHidden('#s3'));
  await page.waitForSelector('#mineBox .cl-list li');
  assert.match(await page.textContent('#mineBox'), /Hospital Santa Exemplo/);
  assert.match(await page.textContent('#mineBox'), /Em análise/);
  const mine = calls(log, '/establishment_claims', 'GET').at(-1);
  assert.equal(mine.query.get('select'), 'id,cnes,status,created_at,decision_note');
  assert.equal(mine.query.get('order'), 'created_at.desc');
  await shot(page, '03-reivindicar-enviado');
  // segundo pedido (ex.: a mesma pessoa cuida de um laboratório) sem recarregar a página
  assert.equal(await page.textContent('#changePlace'), 'Pedir outro estabelecimento');
  await page.click('#changePlace');
  await page.waitForSelector('#city option[value="3550308"]', { state: 'attached' });
  await page.fill('#cityFilter', 'paulo');
  await page.fill('#term', 'análise');
  await page.click('#findBtn');
  await page.click('#results button:has-text("Laboratório Análise Paulista")');
  await page.waitForSelector('#s3:not([hidden])');
  assert.ok(await page.isHidden('#claimDone'));
  assert.equal(await page.inputValue('#cName'), '', 'formulário limpo para o novo local');
  assert.equal(await page.inputValue('#cDoc'), '');
  assert.equal(await page.isChecked('#cAgree'), false);
  assert.equal(await page.textContent('#cMsgCount'), '0 de 500 caracteres');
  await page.fill('#cName', 'Carlos da Silva');
  await page.selectOption('#cRole', 'gestor');
  await page.type('#cDoc', '11222333000181');
  await page.type('#cPhone', '11987654321');
  await page.check('#cAgree');
  await page.click('#claimBtn');
  await page.waitForSelector('#claimDone:not([hidden]) .cl-note.ok');
  const ins2 = calls(log, '/establishment_claims', 'POST');
  assert.equal(ins2.length, 2);
  assert.deepEqual(ins2[1].body, { cnes: '6543210', claimant_name: 'Carlos da Silva', role: 'gestor', document: '11222333000181', crm: null, phone: '11987654321', message: null });
  await page.waitForFunction(() => document.querySelectorAll('#mineBox .cl-list li').length === 2);
  // CNPJ válido também passa na validação
  const okCnpj = await page.evaluate(async () => (await import('./assets/js/clinica.js')).isValidCnpj('11.222.333/0001-81'));
  assert.equal(okCnpj, true);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('reivindicar sem ?cnes=: busca por cidade e nome, escolhe e segue', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true });
  await page.goto(`${BASE}reivindicar.html`);
  await page.waitForSelector('#city option[value="3550308"]', { state: 'attached' });
  assert.ok(await page.isHidden('#s3'));
  assert.ok(await page.isVisible('#mine'), 'logado vê os próprios pedidos');
  await page.fill('#term', 'santa');
  await page.click('#findBtn');
  assert.match(await page.textContent('#findMsg'), /Escolha a cidade/);
  await page.fill('#cityFilter', 'sao');
  assert.equal(await page.inputValue('#city'), String(SP), 'filtro sem acento acha São Paulo');
  assert.equal(await page.$$eval('#city option', (o) => o.length), 2);
  await page.fill('#term', 'sa');
  await page.click('#findBtn');
  assert.match(await page.textContent('#findMsg'), /3 letras/);
  await page.fill('#term', 'Sa*nta,()');
  await page.click('#findBtn');
  await page.waitForFunction(() => /Nada encontrado/.test(document.querySelector('#findMsg').textContent));
  const q = calls(log, '/establishments').at(-1);
  assert.equal(q.query.get('city_ibge'), `eq.${SP}`);
  assert.equal(q.query.get('name'), 'ilike.*Sa nta*');
  // busca de novo com o termo limpo
  await page.fill('#term', 'santa');
  await page.click('#findBtn');
  await page.waitForFunction(() => document.querySelectorAll('#results li').length === 2);
  const q2 = calls(log, '/establishments').at(-1);
  assert.equal(q2.query.get('name'), 'ilike.*santa*');
  assert.equal(q2.query.get('order'), 'name');
  assert.equal(q2.query.get('limit'), '20');
  assert.equal(await page.locator('#results b', { hasText: 'Clínica Santa <b>Luz</b>' }).count(), 1, 'nome escapado');
  await shot(page, '04-reivindicar-busca');
  await page.click('#results button:has-text("Hospital Santa Exemplo")');
  await page.waitForSelector('#s3:not([hidden])');
  assert.equal(new URL(page.url()).search, '?cnes=2077485');
  assert.equal(await page.textContent('.cl-place h3'), 'Hospital Santa Exemplo');
  assert.ok(await page.isHidden('#findForm'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cName');
  await page.click('#changePlace');
  assert.ok(await page.isVisible('#findForm'));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedido duplicado (409/23505) e local já parceiro mostram mensagens claras', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, db: { claimInsert: { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "establishment_claims_pending_uq"' } } } });
  await page.goto(`${BASE}reivindicar.html?cnes=6543210`);
  await page.waitForSelector('#s3:not([hidden])');
  await page.fill('#cName', 'Paula Gerente');
  await page.selectOption('#cRole', 'gestor');
  await page.type('#cDoc', '11222333000181');
  await page.type('#cPhone', '1130002000');
  await page.check('#cAgree');
  await page.click('#claimBtn');
  await page.waitForSelector('#claimMsg .cl-note.err');
  assert.match(await page.textContent('#claimMsg'), /já tem um pedido em análise para este estabelecimento/);
  assert.equal(calls(log, '/establishment_claims', 'POST')[0].body.document, '11222333000181');
  assert.equal(calls(log, '/establishment_claims', 'POST')[0].body.crm, null);
  assert.equal(calls(log, '/establishment_claims', 'POST')[0].body.message, null);
  db.claimInsert = { status: 400, body: { code: '22023', message: 'Este estabelecimento já é parceiro do IMED' } };
  await page.click('#claimBtn');
  await page.waitForFunction(() => /já é parceiro/.test(document.querySelector('#claimMsg').textContent));
  db.claimInsert = { status: 500, body: { message: 'erro' } };
  await page.click('#claimBtn');
  await page.waitForFunction(() => /tente de novo/.test(document.querySelector('#claimMsg').textContent));
  assert.ok(await page.isEnabled('#claimBtn'));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('reivindicar com CNES inexistente mostra aviso e a busca', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}reivindicar.html?cnes=9999999`);
  await page.waitForSelector('#placeBox .cl-note.warn');
  assert.match(await page.textContent('#placeBox'), /Não encontramos o código CNES 9999999/);
  assert.ok(await page.isVisible('#findForm'));
  assert.ok(await page.isHidden('#s2'));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('painel: sem login pede o mesmo e-mail; sem clínicas leva a reivindicar', async () => {
  let { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#loginEmail');
  assert.match(await page.textContent('#authBox'), /mesmo e-mail usado no pedido de cadastro/);
  assert.equal(await page.textContent('#app'), '');
  assert.deepEqual(errors, []);
  await context.close();
  ({ page, errors, context } = await newPage(browser, { logged: true }));
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#goClaim');
  assert.match(await page.textContent('#app'), /Nenhuma clínica nesta conta/);
  await shot(page, '05-painel-sem-clinica');
  await page.click('#goClaim');
  await page.waitForURL(/reivindicar\.html$/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('painel com clínica: pedidos, situação, dados e exames com preços', async () => {
  // relógio fixo (30/10): a ordem pela data do exame só vale com as duas datas ainda no futuro
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, now: '2026-10-30T15:00:00Z', db: {
    members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], requests: [...REQUESTS, ...IMED_REQUESTS],
    exams: [{ clinic_id: C1, exam_code: 'rm', price_cents: 45000 }, { clinic_id: C1, exam_code: 'rx', price_cents: null }],
  } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  assert.equal(await page.textContent('#clinicTitle'), 'Imagem Paulista');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Pedidos|Agenda|Configurar agenda|Dados da clínica|Exames e preços|Financeiro|Equipe');
  const cl = calls(log, '/clinics')[0];
  assert.equal(cl.query.get('id'), `in.(${C1})`);
  // fase 4.1: os vínculos vêm de agenda_me (só os da própria conta), nunca de clinic_members sem filtro
  assert.equal(calls(log, '/rpc/agenda_me').length, 1);
  assert.equal(calls(log, '/clinic_members').length, 0);
  // fase 4.2: os pedidos vêm da função agenda_requests (o banco registra quem leu); nada de leitura direta da tabela
  assert.deepEqual(calls(log, '/rpc/agenda_requests')[0].body, { p_clinic: C1, p_when: null, p_justification: null });
  assert.equal(calls(log, '/appointment_requests', 'GET').length, 0);
  // o filtro da clínica tem também as situações da agenda (4.2), com os rótulos da clínica
  assert.deepEqual(await page.$$eval('#flt-pedidos option', (o) => o.map((x) => x.value)), ['', 'pending', 'contacted', 'confirmed', 'checked_in', 'in_service', 'completed', 'no_show', 'reschedule_requested', 'cancelled']);
  assert.match(await page.textContent('#flt-pedidos'), /Paciente presente \(0\)/);
  assert.equal(await page.locator('.rq').count(), 2);
  // pela data do exame: João (03/11) antes de Maria (05/11)
  assert.deepEqual(await page.$$eval('.rq h3', (h) => h.map((x) => x.textContent)), ['Tomografia · João Lima', 'Ressonância · Maria Souza']);
  const first = page.locator(`#rq-${REQUESTS[0].id}`);
  assert.match(await first.textContent(), /Ressonância · Maria Souza/);
  assert.match(await first.textContent(), /Manhã/);
  assert.match(await first.textContent(), /Aguardando contato/);
  assert.equal(await first.locator('a[href^="tel:"]').getAttribute('href'), 'tel:+5511987654321');
  assert.equal(await first.locator('a[href^="https://wa.me"]').getAttribute('href'), 'https://wa.me/5511987654321');
  assert.match(await first.textContent(), /Tenho claustrofobia <img src=x/);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'HTML escapado');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => /Maria|claustro/.test(localStorage.getItem(k))).length), 0, 'nada do paciente no localStorage');
  await shot(page, '06-painel-pedidos');
  await first.locator('button[data-st="contacted"]').click();
  await page.waitForFunction((id) => /Em contato/.test(document.querySelector(`#rq-${id} .rq-st`).textContent), REQUESTS[0].id);
  assert.deepEqual(calls(log, '/rpc/set_request_status')[0].body, { p_id: REQUESTS[0].id, p_status: 'contacted' });
  assert.equal(await page.locator(`#rq-${REQUESTS[0].id} button[data-st="contacted"]`).getAttribute('aria-pressed'), 'true');
  await page.selectOption('#flt-pedidos', 'confirmed');
  assert.equal(await page.locator('.rq').count(), 1);
  assert.match(await page.textContent('.rq'), /João Lima/);
  assert.equal(await page.locator('.rq a[href^="https://wa.me"]').count(), 0, 'telefone fixo não tem WhatsApp');
  await page.locator('.rq button[data-st="completed"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.rq').length === 0);
  assert.deepEqual(calls(log, '/rpc/set_request_status')[1].body, { p_id: REQUESTS[1].id, p_status: 'completed' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'flt-pedidos', 'foco vai para o filtro quando o cartão sai da lista');
  assert.match(await page.textContent('#rqMsg'), /João Lima mudada para “Concluído”\. Ele saiu desta lista/);
  // filtro "Aguardando contato" com dois pedidos: o foco vai para o próximo cartão
  db.requests.push({ ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000003', patient_name: 'Bia Nova', status: 'pending', created_at: '2026-10-29T12:00:00Z' },
    { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000004', patient_name: 'Caio Novo', status: 'pending', created_at: '2026-10-29T11:00:00Z' });
  await page.selectOption('#flt-pedidos', 'pending');
  assert.equal(await page.locator('.rq').count(), 0, 'lista ainda é a guardada');
  await page.click('#rf-pedidos');
  await page.waitForFunction(() => document.querySelectorAll('.rq').length === 2);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'rf-pedidos', 'foco volta para “Atualizar lista”');
  assert.equal(calls(log, '/rpc/agenda_requests').length, 2);
  await page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000003 button[data-st="contacted"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.rq').length === 1);
  assert.equal(await page.evaluate(() => document.activeElement.closest('.rq')?.id), 'rq-rrrrrrrr-0000-4000-8000-000000000004');
  await page.selectOption('#flt-pedidos', '');
  assert.equal(await page.locator('#clinicNotes .cl-note').count(), 0);
  // abas pelo teclado
  // (passar pela Agenda enquanto ela ainda baixa não deixa a Agenda desenhar por cima da aba seguinte)
  await page.focus('#tab-pedidos');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getAttribute('#tab-agenda', 'aria-selected'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getAttribute('#tab-config', 'aria-selected'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getAttribute('#tab-dados', 'aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-dados');
  assert.equal(await page.getAttribute('#panel', 'aria-labelledby'), 'tab-dados');
  await page.waitForSelector('#dataForm');
  // dados da clínica
  assert.equal(await page.isChecked('#dOnline'), true);
  // honesto: ninguém escolhe horário pelo site antes da 5.1; a configuração fica em "Configurar agenda"
  const online = await page.textContent('label:has(#dOnline)');
  assert.match(online, /Por enquanto, a clínica entra em contato com o paciente para combinar o horário\./);
  assert.match(online, /“Configurar agenda”/);
  assert.doesNotMatch(online, /Com a aba “Agenda” montada/);
  assert.equal(await page.inputValue('#dSpec'), 'Radiologia');
  assert.equal(await page.isChecked('input[name=ins][value="Amil"]'), true);
  assert.equal(await page.inputValue('#dInsOther'), 'Plano Antigo');
  await page.fill('#dWa', '11 98765');
  await page.click('#dSave');
  assert.match(await page.textContent('#dWaErr'), /55 \+ DDD/);
  assert.equal(calls(log, '/rpc/update_my_clinic').length, 0);
  await page.fill('#dPhone', '(11) 3222-1000');
  await page.fill('#dWa', '+55 (11) 98765-4321');
  await page.fill('#dEmail', 'Contato@ImagemPaulista.com.br');
  await page.fill('#dSite', 'www.imagempaulista.com.br');
  await page.fill('#dDesc', 'Centro de diagnóstico por imagem.');
  await page.fill('#h-seg', '07:00–19:00');
  await page.fill('#h-sab', ' 08:00–12:00 ');
  await page.fill('#dSpec', 'Radiologia, Cardiologia, , radiologia');
  await page.check('input[name=ins][value="Unimed"]');
  await page.fill('#dInsOther', 'Plano Local; Outro Plano');
  await shot(page, '07-painel-dados');
  await page.click('#dSave');
  await page.waitForSelector('#dMsg .cl-note.ok');
  const up = calls(log, '/rpc/update_my_clinic')[0].body;
  assert.deepEqual(up, { p_clinic: C1, p: {
    phone: '(11) 3222-1000', whatsapp: '5511987654321', email: 'contato@imagempaulista.com.br', website: 'https://www.imagempaulista.com.br',
    description: 'Centro de diagnóstico por imagem.', opening_hours: { seg: '07:00–19:00', sab: '08:00–12:00' }, accepts_online_booking: true,
    specialties: ['Radiologia', 'Cardiologia', 'radiologia'], insurances: ['Amil', 'Unimed', 'Plano Local', 'Outro Plano'],
  } });
  // sem horários e sem pedidos online
  await page.fill('#h-seg', '');
  await page.fill('#h-sab', '');
  await page.uncheck('#dOnline');
  await page.uncheck('input[name=ins][value="Amil"]');
  await page.uncheck('input[name=ins][value="Unimed"]');
  await page.fill('#dInsOther', '');
  db.failUpdate = true;
  await page.click('#dSave');
  await page.waitForSelector('#dMsg .cl-note.err');
  assert.match(await page.textContent('#dMsg'), /Algum dado não está no formato aceito/);
  const up2 = calls(log, '/rpc/update_my_clinic')[1].body.p;
  assert.equal(up2.opening_hours, null);
  assert.equal(up2.accepts_online_booking, false);
  assert.deepEqual(up2.insurances, []);
  // salvo de novo, o aviso do topo acompanha "Aceito pedidos pelo site"
  db.failUpdate = false;
  await page.click('#dSave');
  await page.waitForSelector('#dMsg .cl-note.ok');
  assert.match(await page.textContent('#dMsg'), /Já aparecem para os pacientes na busca/);
  assert.match(await page.textContent('#clinicNotes'), /Pedidos pelo site estão desligados/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dSave', 'foco fica no formulário');
  await page.check('#dOnline');
  await page.click('#dSave');
  await page.waitForFunction(() => !document.querySelector('#clinicNotes .cl-note'));
  // ao voltar para a aba Pedidos, a lista é buscada de novo
  assert.equal(await page.locator('#agRoot').count(), 0, 'a agenda baixada depois não aparece na aba Dados');
  const before = calls(log, '/rpc/agenda_requests').length;
  await page.click('#tab-pedidos');
  await page.waitForSelector('.rq');
  assert.equal(calls(log, '/rpc/agenda_requests').length, before + 1);
  assert.equal(calls(log, '/appointment_requests', 'GET').length, 0);
  // exames e preços
  await page.click('#tab-exames');
  await page.waitForSelector('#examForm');
  assert.equal(await page.inputValue('#pr-rm'), '450,00');
  assert.equal(await page.isChecked('#ex-rx'), true);
  assert.equal(await page.inputValue('#pr-rx'), '');
  assert.equal(await page.isDisabled('#pr-tc'), true);
  await page.check('#ex-tc');
  await page.fill('#pr-tc', '0,50');
  await page.click('#exSave');
  assert.match(await page.textContent('#pr-tcErr'), /Preço inválido/);
  assert.equal(calls(log, '/rpc/set_my_clinic_exams').length, 0);
  await page.fill('#pr-tc', '1.234,56');
  await page.uncheck('#ex-rx');
  await page.check('#ex-usg');
  await page.check('#ex-lab');
  await page.fill('#pr-lab', '35');
  await shot(page, '08-painel-exames');
  await page.click('#exSave');
  await page.waitForSelector('#exMsg .cl-note.ok');
  assert.deepEqual(calls(log, '/rpc/set_my_clinic_exams')[0].body, { p_clinic: C1, p_exams: [
    { code: 'usg', price_cents: null }, { code: 'tc', price_cents: 123456 }, { code: 'rm', price_cents: 45000 }, { code: 'lab', price_cents: 3500 },
  ] });
  assert.equal(await page.inputValue('#pr-lab'), '35,00');
  assert.deepEqual(errors, []);
  await context.close();
});

// Trava contra preço absurdo (L11): acima de um limite largo por exame, o painel pergunta na própria página antes de
// salvar. O limite nunca aparece (não é preço de referência) e a janela do navegador (window.confirm) não é usada:
// qualquer diálogo entra em "errors" (newPage).
const examesDb = (exams) => ({ members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], exams });
const linhas = (page, sel) => page.$$eval(sel, (els) => els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()));
const abrirExames = async (page) => {
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-exames');
  await page.click('#tab-exames');
  await page.waitForSelector('#examForm');
};

await scenario('exames e preços: valor muito acima do comum pede "Confira o valor" na página; sem confirmar, não salva', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true, db: examesDb([{ clinic_id: C1, exam_code: 'rm', price_cents: 45000 }, { clinic_id: C1, exam_code: 'rx', price_cents: null }]) });
  const salvos = () => calls(log, '/rpc/set_my_clinic_exams');
  await abrirExames(page);
  assert.ok(await page.isHidden('#exCheck'), 'sem pergunta ao abrir');
  // 30000 sem vírgula vira R$ 30.000,00 (quem queria R$ 300,00 esqueceu a vírgula)
  await page.fill('#pr-rx', '30000');
  await page.click('#exSave');
  await page.waitForSelector('#exCheck:not([hidden]) [role="group"]');
  assert.deepEqual(await linhas(page, '#exCheckQ p'), ['Confira o valor: R$ 30.000,00 para Raio-X está certo?']);
  assert.equal(await page.textContent('#exCheckQ b'), 'R$\u00a030.000,00', 'o valor em destaque, com o R$ junto do número');
  assert.equal(salvos().length, 0, 'sem confirmar, nada vai para o banco');
  assert.ok(await page.evaluate(() => document.activeElement.getAttribute('role') === 'group' && !!document.activeElement.closest('#exCheck')), 'o foco vai para a pergunta');
  assert.equal(await page.getAttribute('#exCheck [role="group"]', 'aria-labelledby'), 'exCheckQ');
  assert.equal(await page.textContent('#pr-rxErr'), 'Confira se este valor está certo.', 'o campo também avisa (aria-describedby)');
  assert.equal(await page.getAttribute('#pr-rx', 'aria-invalid'), null, 'não é erro: só pede para conferir');
  assert.equal(await page.$eval('#pr-rxErr', (el) => getComputedStyle(el).color), 'rgb(122, 74, 0)', 'o aviso do campo em âmbar, como a caixa (o vermelho é só para erro)');
  assert.equal(await page.textContent('#exCheckOk'), 'Sim, salvar este valor');
  const box = await page.textContent('#exCheck');
  assert.doesNotMatch(box, /5\.000|20\.000|limite|refer[eê]ncia|m[eé]dia|normal|acima de/i, 'o limite nunca aparece (não vira preço de referência)');
  await shot(page, '20-painel-exames-conferir-valor');
  // Enter no campo (envia o formulário de novo): pergunta outra vez, sem salvar. A caixa já estava aberta: o que
  // mostra que o Enter perguntou de novo é o foco, que sai do campo e volta para a pergunta.
  await page.focus('#pr-rx');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('#exCheck:not([hidden]) [role="group"]'));
  assert.equal(salvos().length, 0);
  // "Não, corrigir": volta para o campo com o valor selecionado; mudar o valor tira a pergunta
  await page.click('#exCheckFix');
  assert.deepEqual(await page.evaluate(() => { const a = document.activeElement; return [a.id, a.selectionStart, a.selectionEnd]; }), ['pr-rx', 0, 5]);
  await page.keyboard.type('300');
  assert.ok(await page.isHidden('#exCheck'), 'mudou o valor: a pergunta sai');
  assert.equal(await page.textContent('#pr-rxErr'), '');
  await page.click('#exSave');
  await page.waitForSelector('#exMsg .cl-note.ok');
  assert.ok(await page.isHidden('#exCheck'), 'valor comum: salva direto');
  assert.deepEqual(salvos()[0].body, { p_clinic: C1, p_exams: [{ code: 'rx', price_cents: 30000 }, { code: 'rm', price_cents: 45000 }] });
  // Exame caro de verdade: confirmado, é salvo (nunca recusado)
  await page.fill('#pr-rx', '30.000,00');
  await page.click('#exSave');
  await page.waitForSelector('#exCheck:not([hidden]) [role="group"]');
  assert.equal(salvos().length, 1);
  assert.equal(await page.textContent('#exMsg'), '', 'a mensagem de salvo anterior sai');
  await page.click('#exCheckOk');
  await page.waitForFunction(() => document.querySelector('#exMsg .cl-note.ok'));
  assert.equal(salvos().length, 2);
  assert.deepEqual(salvos()[1].body.p_exams, [{ code: 'rx', price_cents: 3000000 }, { code: 'rm', price_cents: 45000 }]);
  assert.ok(await page.isHidden('#exCheck'));
  assert.equal(await page.inputValue('#pr-rx'), '30000,00');
  assert.equal(await page.textContent('#pr-rxErr'), '');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'exSave', 'o foco volta para o botão de salvar');
  // O "Sim" vale para aquele valor nesta página: salvar de novo não pergunta outra vez...
  await page.click('#exSave');
  await page.waitForSelector('#exMsg .cl-note.ok');
  assert.equal(salvos().length, 3);
  assert.ok(await page.isHidden('#exCheck'));
  // ...mas outro valor alto pergunta de novo
  await page.fill('#pr-rx', '40000');
  await page.click('#exSave');
  await page.waitForSelector('#exCheck:not([hidden]) [role="group"]');
  assert.deepEqual(await linhas(page, '#exCheckQ p'), ['Confira o valor: R$ 40.000,00 para Raio-X está certo?']);
  assert.equal(salvos().length, 3);
  assert.deepEqual(errors, [], 'nenhuma janela do navegador (window.confirm) nem erro');
  await context.close();
});

await scenario('exames e preços: dois valores para conferir, valor no limite não pergunta, desmarcar tira a pergunta; celular sem rolagem lateral', async () => {
  const { page, log, errors, context } = await newPage(browser, { mobile: true, logged: true, db: examesDb([{ clinic_id: C1, exam_code: 'rm', price_cents: 45000 }]) });
  const salvos = () => calls(log, '/rpc/set_my_clinic_exams');
  await abrirExames(page);
  // Os limites: largos, um para cada exame (Raio-X R$ 5.000, ressonância R$ 20.000); só passar deles pergunta.
  const lim = await page.evaluate(async () => {
    const m = await import('./assets/js/painel.js');
    return { L: m.PRICE_CHECK_CENTS, t: [['rx', 500000], ['rx', 500001], ['rm', 2000000], ['rm', 2000001], ['lab', null], ['tc', 1000000], ['tc', 1000001]].map(([c, v]) => m.priceNeedsCheck(c, v)) };
  });
  assert.deepEqual(Object.keys(lim.L).sort(), ['dens', 'ecg', 'eco', 'lab', 'mamo', 'rm', 'rx', 'tc', 'usg'], 'um limite para cada exame do painel');
  assert.equal(lim.L.rx, 500000);
  assert.equal(lim.L.rm, 2000000);
  for (const [k, v] of Object.entries(lim.L)) assert.ok(v >= 500000 && v < 10000000, `${k}: limite largo (de R$ 5.000 a menos de R$ 100.000)`);
  assert.deepEqual(lim.t, [false, true, false, true, false, false, true]);
  // Exatamente no limite: salva direto
  await page.check('#ex-rx');
  await page.fill('#pr-rx', '5.000');
  await page.fill('#pr-rm', '20000');
  await page.click('#exSave');
  await page.waitForSelector('#exMsg .cl-note.ok');
  assert.ok(await page.isHidden('#exCheck'));
  assert.deepEqual(salvos()[0].body.p_exams, [{ code: 'rx', price_cents: 500000 }, { code: 'rm', price_cents: 2000000 }]);
  // Dois valores acima: uma pergunta para cada, na ordem da lista, e um "Sim" para os dois
  await page.fill('#pr-rx', '5000,01');
  await page.fill('#pr-rm', '25000');
  await page.click('#exSave');
  await page.waitForSelector('#exCheck:not([hidden]) [role="group"]');
  assert.deepEqual(await linhas(page, '#exCheckQ p'), ['Confira o valor: R$ 5.000,01 para Raio-X está certo?', 'Confira o valor: R$ 25.000,00 para Ressonância está certo?']);
  assert.equal(await page.textContent('#exCheckOk'), 'Sim, salvar estes valores');
  assert.match(await page.textContent('#exCheckWhy'), /Se os valores estiverem certos, confirme para salvar\./);
  assert.equal(await page.textContent('#pr-rmErr'), 'Confira se este valor está certo.');
  assert.equal(salvos().length, 1);
  await noOverflow(page);
  await shot(page, '21-celular-exames-conferir-dois-valores');
  // Celular estreito (360px): a pergunta e os dois botões cabem na tela, sem rolagem lateral
  await page.setViewportSize({ width: 360, height: 780 });
  await noOverflow(page);
  for (const b of ['#exCheckOk', '#exCheckFix']) {
    const r = await page.locator(b).boundingBox();
    assert.ok(r && r.x >= 0 && r.x + r.width <= 360, `${b} inteiro na tela de 360px (${r && `${r.x}…${r.x + r.width}`})`);
  }
  await shot(page, '22-celular-360-exames-conferir');
  // "Não, corrigir" leva ao primeiro valor da lista
  await page.click('#exCheckFix');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pr-rx');
  // Desmarcar o exame também tira a pergunta; ao salvar, só a ressonância é perguntada
  await page.uncheck('#ex-rx');
  assert.ok(await page.isHidden('#exCheck'));
  assert.equal(await page.textContent('#pr-rmErr'), '', 'o aviso do campo sai junto');
  await page.click('#exSave');
  await page.waitForSelector('#exCheck:not([hidden]) [role="group"]');
  assert.deepEqual(await linhas(page, '#exCheckQ p'), ['Confira o valor: R$ 25.000,00 para Ressonância está certo?']);
  assert.equal(salvos().length, 1);
  await page.click('#exCheckOk');
  await page.waitForFunction(() => document.querySelector('#exMsg .cl-note.ok') && !document.querySelector('#exSave').disabled);
  assert.equal(salvos().length, 2);
  assert.deepEqual(salvos()[1].body.p_exams, [{ code: 'rm', price_cents: 2500000 }]);
  // Preço inválido num exame e valor alto no outro: o erro vem antes, em vermelho, e a pergunta não aparece
  await page.check('#ex-rx');
  await page.fill('#pr-rx', '0,50');
  await page.fill('#pr-rm', '30000');
  await page.click('#exSave');
  await page.waitForFunction(() => document.activeElement?.id === 'pr-rx');
  assert.match(await page.textContent('#pr-rxErr'), /^Preço inválido/);
  assert.equal(await page.getAttribute('#pr-rx', 'aria-invalid'), 'true');
  assert.equal(await page.$eval('#pr-rxErr', (el) => getComputedStyle(el).color), 'rgb(178, 54, 26)', 'o erro continua em vermelho');
  assert.ok(await page.isHidden('#exCheck'), 'com erro, a pergunta não aparece');
  assert.equal(await page.textContent('#pr-rmErr'), '');
  assert.equal(salvos().length, 2);
  await noOverflow(page);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('equipe do IMED: aprova e recusa pedidos de cadastro e cuida dos pedidos ao IMED', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, email: 'equipe@imed.com.br', db: { admin: true, claims: CLAIMS, requests: [...REQUESTS, ...IMED_REQUESTS] } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#cl-kkkkkkkk-0000-4000-8000-000000000001');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Pedidos de cadastro|Pedidos ao IMED|Mensagens|Avisos de erro|Visitas');
  assert.equal(await page.textContent('#clinicTitle'), 'Equipe do IMED');
  const pend = calls(log, '/establishment_claims').find((e) => e.query.get('status') === 'eq.pending');
  assert.equal(pend.query.get('select'), '*');
  assert.equal(pend.query.get('order'), 'created_at');
  const c1 = page.locator('#cl-kkkkkkkk-0000-4000-8000-000000000001');
  assert.match(await c1.textContent(), /Hospital Santa Exemplo/);
  assert.match(await c1.textContent(), /Carlos Dono/);
  assert.match(await c1.textContent(), /Proprietário\(a\)/);
  assert.match(await c1.textContent(), /529\.•••\.•••-25/);
  assert.doesNotMatch(await c1.textContent(), /52998224725|529\.982\.247-25/);
  assert.match(await c1.textContent(), /123456-SP/);
  assert.match(await c1.textContent(), /dono@hospital\.com\.br/);
  assert.match(await c1.textContent(), /Sou o dono <script>alert\(1\)<\/script>/);
  assert.equal(await c1.locator('a:has-text("Ficha no CNES")').getAttribute('href'), 'https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/3550302077485');
  const c2 = page.locator('#cl-kkkkkkkk-0000-4000-8000-000000000002');
  assert.match(await c2.textContent(), /CNPJ/);
  assert.match(await c2.textContent(), /11\.•••\.•••\/0001-81/);
  await c1.locator('[data-show]').click();
  assert.match(await c1.textContent(), /529\.982\.247-25/);
  assert.match(await page.textContent('#panel'), /Velho Pedido/);
  assert.match(await page.textContent('#panel'), /Motivo: Sem vínculo/);
  // conferência obrigatória antes de aprovar: CNES, CNPJ, ligação para o telefone do CNES e o registro do profissional
  // responsável no conselho da profissão dele (CRM, CRF, CRBM...), com o conselho e o número
  const ck = calls(log, '/claim_checks')[0];
  assert.equal(ck.query.get('claim_id'), `in.(${CLAIMS[0].id},${CLAIMS[1].id})`, 'busca a conferência só dos pedidos em análise');
  const ap1 = c1.locator('[data-approve]');
  assert.equal(await ap1.isDisabled(), true, 'sem conferência, "Aprovar" fica travado');
  assert.match(await page.textContent('#cka-kkkkkkkk-0000-4000-8000-000000000001'), /marque as quatro conferências e informe o conselho e o número do registro/);
  assert.equal(await page.getAttribute('#cl-kkkkkkkk-0000-4000-8000-000000000001 [data-approve]', 'aria-describedby'), 'cka-kkkkkkkk-0000-4000-8000-000000000001');
  assert.match(await c1.locator('fieldset.ck').textContent(), /Conferência ainda não salva/);
  assert.equal(await c1.locator('fieldset.ck a[href="tel:+551131411000"]').textContent(), '(11) 3141-1000', 'telefone oficial do CNES para ligar');
  assert.equal(await c1.locator('fieldset.ck a[href^="https://portal.cfm.org.br"]').count(), 0, 'sem conselho escolhido, ainda sem o link do CFM');
  assert.match(await c1.locator('fieldset.ck').textContent(), /registro ativo no conselho da profissão dele \(CRM, CRF, CRBM, CRO…\)/);
  assert.ok(!/CRM ativo do médico/.test(await page.textContent('#panel')), 'não exige CRM de quem não é médico');
  assert.equal(await c1.locator('fieldset.ck a[href*="receita.fazenda.gov.br"]').count(), 1, 'link para conferir o CNPJ');
  assert.match(await c2.locator('fieldset.ck').textContent(), /não informado no CNES/, 'sem telefone no CNES, avisa');
  for (const k of ['cnes_active', 'cnpj_active', 'phone_confirmed']) await c1.locator(`[data-ck="${k}"]`).check();
  assert.equal(await ap1.isDisabled(), true, 'três de quatro: ainda travado');
  await c1.locator('[data-ck="council_active"]').check();
  assert.equal(await ap1.isDisabled(), true, 'quatro marcadas, mas sem o conselho e o número: ainda travado');
  await c1.locator('[data-ck="council"]').selectOption('CRM');
  assert.equal(await c1.locator('fieldset.ck a[href^="https://portal.cfm.org.br"]').count(), 1, 'CRM: link para conferir no CFM');
  await c1.locator('[data-ck="council"]').selectOption('CRBM');
  assert.equal(await c1.locator('fieldset.ck a[href^="https://portal.cfm.org.br"]').count(), 0, 'outro conselho: sem o link do CFM');
  assert.match(await c1.locator('[data-ck-link]').textContent(), /site do conselho regional da profissão/);
  assert.equal(await ap1.isDisabled(), true, 'sem o número: ainda travado');
  await c1.locator('[data-ck="council_number"]').fill('12345-SP');
  assert.equal(await ap1.isDisabled(), false);
  assert.match(await page.textContent('#cka-kkkkkkkk-0000-4000-8000-000000000001'), /Conferência completa/);
  await page.fill('#ckn-kkkkkkkk-0000-4000-8000-000000000001', 'Biomédico responsável conferido no CRBM; Carlos atendeu no telefone do CNES');
  await shot(page, '09-painel-admin-cadastros');
  await ap1.click();
  await page.waitForFunction(() => !document.querySelector('#panel .cl-state') && !document.querySelector('#cl-kkkkkkkk-0000-4000-8000-000000000001'));
  assert.deepEqual(calls(log, '/rpc/approve_claim')[0].body, { p_claim: CLAIMS[0].id });
  const sv = calls(log, '/rpc/save_claim_checks');
  assert.deepEqual(sv[0].body, { p_claim: CLAIMS[0].id, p_checks: { cnes_active: true, cnpj_active: true, phone_confirmed: true, council_active: true, council: 'CRBM', council_number: '12345-SP', note: 'Biomédico responsável conferido no CRBM; Carlos atendeu no telefone do CNES' } });
  assert.ok(log.indexOf(sv[0]) < log.indexOf(calls(log, '/rpc/approve_claim')[0]), 'grava a conferência (com a data) antes de aprovar');
  await c2.locator('[data-reject]').click();
  assert.equal(await c2.locator('[data-reject]').getAttribute('aria-expanded'), 'true');
  await page.fill('#note-kkkkkkkk-0000-4000-8000-000000000002', 'Documento não confere com o CNES');
  await c2.locator('[data-confirm-reject]').click();
  await page.waitForFunction(() => !document.querySelector('#panel .cl-state') && !document.querySelector('#cl-kkkkkkkk-0000-4000-8000-000000000002'));
  assert.deepEqual(calls(log, '/rpc/reject_claim')[0].body, { p_claim: CLAIMS[1].id, p_note: 'Documento não confere com o CNES' });
  assert.match(await page.textContent('#panel'), /Nenhum pedido aguardando/);
  assert.match(await page.textContent('#panel'), /Aprovado/);
  assert.match(await page.textContent('#panel'), /Motivo: Documento não confere com o CNES/);
  // pedidos ao IMED
  await page.click('#tab-concierge');
  await page.waitForSelector('.rq');
  assert.deepEqual(await page.$$eval('#flt-concierge option', (o) => o.map((x) => x.value)), ['', 'pending', 'contacted', 'confirmed', 'completed', 'cancelled'], 'pedidos ao IMED: só as 5 situações de sempre');
  const cq = calls(log, '/appointment_requests').at(-1);
  assert.equal(cq.query.get('clinic_id'), 'is.null');
  assert.match(cq.query.get('select'), /place_name/);
  assert.equal(await page.locator('.rq').count(), 1);
  assert.match(await page.textContent('.rq'), /Hospital Santa Exemplo/);
  assert.match(await page.textContent('.rq'), /Ana Prado/);
  assert.equal(await page.locator('.rq a[href="tel:+551131411000"]').count(), 1);
  await page.click('.rq button[data-st="confirmed"]');
  await page.waitForFunction(() => /Confirmado/.test(document.querySelector('.rq .rq-st').textContent));
  assert.deepEqual(calls(log, '/rpc/set_request_status')[0].body, { p_id: IMED_REQUESTS[0].id, p_status: 'confirmed' });
  await shot(page, '10-painel-admin-concierge');
  // Reabrir um pedido cujo horário outra pessoa já pegou (o banco responde slot_taken): mensagem clara.
  db.statusResult = 'slot_taken';
  await page.click('.rq button[data-st="contacted"]');
  await page.waitForFunction(() => /Este horário já foi reservado por outro paciente/.test(document.querySelector('#rqMsg')?.textContent || ''));
  // E se vier o erro do índice único (23505) direto: a mesma mensagem, não um erro genérico.
  db.statusResult = { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "appointment_requests_slot_uq"' } };
  await page.click('.rq button[data-st="contacted"]');
  await page.waitForFunction(() => /Este horário já foi reservado por outro paciente/.test(document.querySelector('#rqMsg')?.textContent || '') && !document.querySelector('.rq button[data-st="contacted"]').disabled);
  db.statusResult = null;
  // telefones de locais do OSM (já com +55) e 0800; lista atualizada pelo botão
  db.requests.push({ ...IMED_REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000011', place_name: 'Local OSM', place_phone: '+55 11 3141-1000', created_at: '2026-10-29T16:00:00Z' },
    { ...IMED_REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000012', place_name: 'Central 0800', place_phone: '0800 123 4567', created_at: '2026-10-29T17:00:00Z' });
  await page.click('#rf-concierge');
  await page.waitForFunction(() => document.querySelectorAll('.rq').length === 3);
  assert.equal(await page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000011 a[href^="tel:"]').first().getAttribute('href'), 'tel:+551131411000');
  assert.equal(await page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000012 a[href^="tel:"]').first().getAttribute('href'), 'tel:08001234567');
  assert.equal(await page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000011 a[href^="tel:"]').nth(1).getAttribute('href'), 'tel:+5521998887777', 'telefone do paciente');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('equipe do IMED: conferência salva antes, banco recusa sem conferência e pedido já decidido', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, email: 'equipe@imed.com.br', db: {
    admin: true, claims: CLAIMS,
    // o pedido da Paula já tem a conferência completa salva (29/10 às 11:30 em São Paulo)
    claimChecks: [{ claim_id: CLAIMS[1].id, cnes_active: true, cnpj_active: true, phone_confirmed: true, council_active: true, council: 'CRM', council_number: '654321-SP', note: 'Gestora <b>confirmada</b>', checked_at: '2026-10-29T14:30:00Z', checked_by: USER_ID }],
  } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#cl-kkkkkkkk-0000-4000-8000-000000000002 fieldset.ck');
  const c1 = page.locator('#cl-kkkkkkkk-0000-4000-8000-000000000001');
  const c2 = page.locator('#cl-kkkkkkkk-0000-4000-8000-000000000002');
  // conferência já salva: caixas marcadas, data e "Aprovar" liberado
  assert.equal(await c2.locator('[data-approve]').isDisabled(), false);
  assert.match(await c2.locator('fieldset.ck').textContent(), /Conferência salva em 29\/10\/2026.*11:30/);
  assert.equal(await page.inputValue('#ckn-kkkkkkkk-0000-4000-8000-000000000002'), 'Gestora <b>confirmada</b>', 'observação escapada');
  for (const k of ['cnes_active', 'cnpj_active', 'phone_confirmed', 'council_active']) assert.equal(await c2.locator(`[data-ck="${k}"]`).isChecked(), true, k);
  assert.equal(await c2.locator('[data-ck="council"]').inputValue(), 'CRM', 'conselho salvo');
  assert.equal(await c2.locator('[data-ck="council_number"]').inputValue(), '654321-SP', 'número salvo');
  // desmarcar uma (ou apagar o número) trava o "Aprovar" de novo
  await c2.locator('[data-ck="council_active"]').uncheck();
  assert.equal(await c2.locator('[data-approve]').isDisabled(), true);
  await c2.locator('[data-ck="council_active"]').check();
  await c2.locator('[data-ck="council_number"]').fill('');
  assert.equal(await c2.locator('[data-approve]').isDisabled(), true, 'sem o número do registro');
  await c2.locator('[data-ck="council_number"]').fill('654321-SP');
  assert.equal(await c2.locator('[data-approve]').isDisabled(), false);
  // salvar só a conferência (sem aprovar)
  await c1.locator('[data-ck="cnes_active"]').check();
  await c1.locator('[data-save-checks]').click();
  await page.waitForFunction(() => /Conferência salva\./.test(document.querySelector('[data-msg="kkkkkkkk-0000-4000-8000-000000000001"]')?.textContent));
  assert.deepEqual(calls(log, '/rpc/save_claim_checks')[0].body, { p_claim: CLAIMS[0].id, p_checks: { cnes_active: true, cnpj_active: false, phone_confirmed: false, council_active: false } });
  assert.match(await c1.locator('fieldset.ck').textContent(), /Conferência salva em \d{2}\/\d{2}\/\d{4}/);
  assert.equal(calls(log, '/rpc/approve_claim').length, 0, 'salvar a conferência não aprova');
  assert.equal(await c1.locator('[data-approve]').isDisabled(), true);
  // o banco recusa a aprovação (ex.: conferência apagada em outra aba): mostra o motivo e libera os botões
  db.approveError = { status: 400, body: { code: '22023', message: 'Antes de aprovar, faça a conferência: CNES ativo, CNPJ ativo, ligação para o telefone oficial do CNES e registro ativo do profissional responsável pelo local no conselho da profissão (com o conselho e o número).' } };
  await c2.locator('[data-approve]').click();
  await page.waitForFunction(() => /Antes de aprovar, faça a conferência/.test(document.querySelector('[data-msg="kkkkkkkk-0000-4000-8000-000000000002"]')?.textContent));
  assert.equal(await c2.locator('[data-approve]').isDisabled(), false, 'conferência completa na tela: pode tentar de novo');
  assert.equal(await c2.locator('[data-reject]').isDisabled(), false);
  // pedido decidido por outra pessoa enquanto a página estava aberta
  db.approveError = null;
  db.checksResult = 'already_decided';
  await c2.locator('[data-approve]').click();
  await page.waitForFunction(() => /já foi decidido/.test(document.querySelector('[data-msg="kkkkkkkk-0000-4000-8000-000000000002"]')?.textContent));
  assert.equal(calls(log, '/rpc/approve_claim').length, 1, 'sem conferência gravada, não chama a aprovação');
  // aprovação certa
  db.checksResult = null;
  await c2.locator('[data-approve]').click();
  await page.waitForFunction(() => !document.querySelector('#cl-kkkkkkkk-0000-4000-8000-000000000002'));
  assert.deepEqual(calls(log, '/rpc/approve_claim').at(-1).body, { p_claim: CLAIMS[1].id });
  assert.deepEqual(errors, []);
  await context.close();
});

const MESSAGES = [
  { id: 'mmmmmmmm-0000-4000-8000-000000000001', protocol: 'IMED-20261030-AB2C', created_at: '2026-10-30T13:00:00Z', subject: 'dados_exclusao', name: 'Maria <b>Souza</b>', reply_email: 'maria@exemplo.com', reply_phone: null, message: 'Quero apagar meus dados <img src=x onerror="window.__xss=1">', request_code: null, user_id: USER_ID, account_email: 'maria@exemplo.com', status: 'open', answered_at: null },
  { id: 'mmmmmmmm-0000-4000-8000-000000000002', protocol: 'IMED-20261029-ZZ34', created_at: '2026-10-29T18:00:00Z', subject: 'cancelamento', name: 'João Lima', reply_email: null, reply_phone: '11987654321', message: 'Quero cancelar o exame de amanhã.', request_code: 'IMED-ABC123', user_id: null, account_email: null, status: 'open', answered_at: null, flagged: true },
  { id: 'mmmmmmmm-0000-4000-8000-000000000003', protocol: 'IMED-20261028-QQ77', created_at: '2026-10-28T15:00:00Z', subject: 'duvida', name: 'Ana Prado', reply_email: 'ana@exemplo.com', reply_phone: null, message: 'Como funciona o selo?', request_code: null, user_id: null, account_email: null, status: 'answered', answered_at: '2026-10-28T19:00:00Z' },
];

await scenario('equipe do IMED: Mensagens do Fale com o IMED (LGPD em destaque, responder e marcar como respondida)', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, email: 'equipe@imed.com.br', db: { admin: true, claims: [], messages: MESSAGES } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-mensagens');
  await page.click('#tab-mensagens');
  await page.waitForSelector('#msg-mmmmmmmm-0000-4000-8000-000000000001');
  const q1 = calls(log, '/contact_messages')[0];
  assert.equal(q1.query.get('select'), '*');
  assert.equal(q1.query.get('status'), 'eq.open', 'começa pelas em aberto');
  assert.equal(q1.query.get('order'), 'created_at.desc');
  assert.equal(q1.query.get('limit'), '200');
  assert.equal(await page.locator('#panel .rq').count(), 2);
  const m1 = page.locator('#msg-mmmmmmmm-0000-4000-8000-000000000001');
  assert.equal(await m1.locator('h3').textContent(), 'Quero apagar meus dados', 'assunto do pedido de exclusão');
  assert.match(await m1.textContent(), /Protocolo IMED-20261030-AB2C/);
  assert.match(await m1.textContent(), /Pedido sobre dados pessoais \(LGPD\)/);
  assert.match(await m1.textContent(), /Maria <b>Souza<\/b>/);
  assert.match(await m1.textContent(), /Quero apagar meus dados <img src=x/);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'HTML escapado');
  assert.match(await m1.textContent(), /estava logado ao enviar/);
  assert.equal(await m1.locator('a[href^="mailto:"]').getAttribute('href'), `mailto:maria@exemplo.com?subject=${encodeURIComponent('IMED · protocolo IMED-20261030-AB2C')}`);
  const m2 = page.locator('#msg-mmmmmmmm-0000-4000-8000-000000000002');
  assert.equal(await m2.locator('a[href^="tel:"]').getAttribute('href'), 'tel:+5511987654321');
  assert.equal(await m2.locator('a[href^="https://wa.me"]').getAttribute('href'), 'https://wa.me/5511987654321');
  assert.match(await m2.textContent(), /Protocolo do pedido\s*IMED-ABC123/);
  assert.doesNotMatch(await m2.textContent(), /LGPD/);
  // Chegou numa hora com muitas mensagens de todo mundo: gravada do mesmo jeito, marcada para a equipe conferir.
  assert.match(await m2.locator('h3').textContent(), /Pode ser robô/);
  assert.match(await m2.textContent(), /muitas mensagens de todo mundo \(100 ou mais\): pode ser robô/);
  assert.doesNotMatch(await m1.textContent(), /Pode ser robô/);
  await shot(page, '15-painel-admin-mensagens');
  // marcar como respondida: sai da lista "Em aberto"
  await m1.locator('[data-msg-status="answered"]').click();
  await page.waitForFunction(() => !document.querySelector('#msg-mmmmmmmm-0000-4000-8000-000000000001') && document.querySelector('#msg-mmmmmmmm-0000-4000-8000-000000000002'));
  assert.deepEqual(calls(log, '/rpc/set_contact_status')[0].body, { p_id: MESSAGES[0].id, p_status: 'answered' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'flt-msg', 'foco no filtro depois de atualizar a lista');
  // todas: a respondida aparece com a data e pode voltar para em aberto
  await page.selectOption('#flt-msg', '');
  await page.waitForFunction(() => document.querySelectorAll('#panel .rq').length === 3);
  assert.equal(calls(log, '/contact_messages').at(-1).query.get('status'), null, '"Todas" não filtra a situação');
  const m3 = page.locator('#msg-mmmmmmmm-0000-4000-8000-000000000003');
  assert.match(await m3.textContent(), /Respondida/);
  assert.match(await m3.textContent(), /Respondida em\s*28\/10\/2026/);
  await m3.locator('[data-msg-status="open"]').click();
  await page.waitForFunction(() => /Em aberto/.test(document.querySelector('#msg-mmmmmmmm-0000-4000-8000-000000000003 .rq-st')?.textContent));
  assert.deepEqual(calls(log, '/rpc/set_contact_status')[1].body, { p_id: MESSAGES[2].id, p_status: 'open' });
  // recusa do banco: mensagem clara e botão de novo disponível
  db.msgResult = 'forbidden';
  await page.locator('#msg-mmmmmmmm-0000-4000-8000-000000000002 [data-msg-status]').click();
  await page.waitForFunction(() => /Só a equipe do IMED cuida das mensagens/.test(document.querySelector('#msgMsg')?.textContent));
  assert.equal(await page.locator('#msg-mmmmmmmm-0000-4000-8000-000000000002 [data-msg-status]').isDisabled(), false);
  // vazia
  db.messages = [];
  await page.selectOption('#flt-msg', 'open');
  await page.waitForFunction(() => /Nenhuma mensagem em aberto/.test(document.querySelector('#panel').textContent));
  assert.deepEqual(errors, []);
  await context.close();
});

const REPORTS = [
  { id: 'pppppppp-0000-4000-8000-000000000001', created_at: '2026-10-30T12:00:00Z', cnes: '2077485', clinic_id: null, kind: 'telefone', note: 'Ninguém atende <b>nunca</b>', user_id: null, status: 'open', resolved_at: null,
    repeats: 3, last_at: '2026-10-30T14:00:00Z', more_notes: ['O número mudou'],
    establishments: { name: 'Hospital Santa Exemplo', address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', phone: '(11) 3141-1000', municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 } }, clinics: null },
  { id: 'pppppppp-0000-4000-8000-000000000002', created_at: '2026-10-30T11:00:00Z', cnes: null, clinic_id: C1, kind: 'exame', note: null, user_id: null, status: 'open', resolved_at: null,
    establishments: null, clinics: { name: 'Imagem Paulista', city: 'São Paulo', state: 'SP', cnes: '7654321' } },
  { id: 'pppppppp-0000-4000-8000-000000000003', created_at: '2026-10-20T11:00:00Z', cnes: '6543210', clinic_id: null, kind: 'fechado', note: null, user_id: null, status: 'resolved', resolved_at: '2026-10-21T13:00:00Z',
    establishments: { name: 'Laboratório Análise Paulista', address_line: 'Alameda Santos, 200', neighborhood: 'Bela Vista', phone: null, municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 } }, clinics: null },
];

await scenario('equipe do IMED: Avisos de erro dos locais (cadastro oficial e parceiro), resolver e reabrir', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, email: 'equipe@imed.com.br', db: { admin: true, claims: [], reports: REPORTS } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-avisos');
  await page.focus('#tab-mensagens');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getAttribute('#tab-avisos', 'aria-selected'), 'true', 'abas pelo teclado');
  await page.waitForSelector('#rep-pppppppp-0000-4000-8000-000000000001');
  const q1 = calls(log, '/place_reports')[0];
  assert.match(q1.query.get('select'), /^\*,establishments\(name,address_line,neighborhood,phone,municipalities\(name,uf,cnes_code\)\),clinics\(name,city,state,cnes\)$/);
  assert.equal(q1.query.get('status'), 'eq.open');
  assert.equal(await page.locator('#panel .rq').count(), 2);
  const r1 = page.locator('#rep-pppppppp-0000-4000-8000-000000000001');
  // O mesmo problema avisado 3 vezes vira um aviso só, com a contagem, o último aviso e os textos diferentes.
  assert.equal(await r1.locator('h3').textContent(), 'O telefone está errado ou não atendeAvisado 3 vezes');
  assert.match(await r1.locator('.rq-hd small').textContent(), /último aviso em 30\/10\/2026/);
  assert.match(await r1.textContent(), /O que escreveram\s*Ninguém atende <b>nunca<\/b>\s*—\s*O número mudou/);
  assert.match(await r1.textContent(), /Hospital Santa Exemplo/);
  assert.match(await r1.textContent(), /Cadastro oficial \(CNES 2077485\)/);
  assert.match(await r1.textContent(), /Telefone no CNES\s*\(11\) 3141-1000/);
  assert.match(await r1.textContent(), /Ninguém atende <b>nunca<\/b>/);
  assert.equal(await r1.locator('a[href="local.html?cnes=2077485"]').count(), 1);
  assert.equal(await r1.locator('a:has-text("Ficha no CNES")').getAttribute('href'), 'https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/3550302077485');
  const r2 = page.locator('#rep-pppppppp-0000-4000-8000-000000000002');
  assert.equal(await r2.locator('h3').textContent(), 'Não faz o exame indicado', 'aviso de uma vez só: sem a contagem');
  assert.match(await r2.textContent(), /Parceiro do IMED \(a clínica corrige pela área dela\)/);
  assert.equal(await r2.locator(`a[href="local.html?id=${C1}"]`).count(), 1);
  assert.match(await page.textContent('#panel'), /a correção é feita pelo próprio estabelecimento no CNES/);
  await shot(page, '16-painel-admin-avisos');
  await r1.locator('[data-rep-status="resolved"]').click();
  await page.waitForFunction(() => !document.querySelector('#rep-pppppppp-0000-4000-8000-000000000001'));
  assert.deepEqual(calls(log, '/rpc/set_place_report_status')[0].body, { p_id: REPORTS[0].id, p_status: 'resolved' });
  await page.selectOption('#flt-rep', 'resolved');
  await page.waitForFunction(() => document.querySelectorAll('#panel .rq').length === 2);
  assert.equal(calls(log, '/place_reports').at(-1).query.get('status'), 'eq.resolved');
  const r3 = page.locator('#rep-pppppppp-0000-4000-8000-000000000003');
  assert.match(await r3.textContent(), /Resolvido em\s*21\/10\/2026/);
  assert.doesNotMatch(await r3.textContent(), /Telefone no CNES/, 'sem telefone no CNES, não mostra a linha');
  await r3.locator('[data-rep-status="open"]').click();
  await page.waitForFunction(() => !document.querySelector('#rep-pppppppp-0000-4000-8000-000000000003'));
  assert.deepEqual(calls(log, '/rpc/set_place_report_status')[1].body, { p_id: REPORTS[2].id, p_status: 'open' });
  db.repResult = 'not_found';
  await page.locator('#rep-pppppppp-0000-4000-8000-000000000001 [data-rep-status]').click();
  await page.waitForFunction(() => /Este aviso não existe mais/.test(document.querySelector('#repMsg')?.textContent));
  assert.deepEqual(errors, []);
  await context.close();
});

// Respostas simuladas do admin_stats (contador de visitas próprio), como a função do banco devolve.
const STATS7 = {
  dias: 7, de: '2026-10-24', ate: '2026-10-30', visitas: 1260,
  por_dia: [
    { dia: '2026-10-24', visitas: 0 }, { dia: '2026-10-25', visitas: 200 }, { dia: '2026-10-26', visitas: 0 }, { dia: '2026-10-27', visitas: 1000 },
    { dia: '2026-10-28', visitas: 0 }, { dia: '2026-10-29', visitas: 0 }, { dia: '2026-10-30', visitas: 60 },
  ],
  paginas: [{ pagina: '/perto.html', visitas: 700 }, { pagina: '/', visitas: 400 }, { pagina: '/cidades/sp/sao-paulo/clinicas.html', visitas: 100 }, { pagina: '/exames/raio-x.html', visitas: 60 }],
  exames: [{ exame: 'rm', total: 12 }, { exame: 'lab', total: 3 }],
  tipos: [{ tipo: 'imagem', total: 4 }],
  cidades: [{ cidade: 'SP/São Paulo', total: 9 }, { cidade: 'RJ/<img src=x onerror="window.__xss=1">', total: 1 }],
  pedidos: [{ exame: 'rm', total: 2 }, { exame: '', total: 1 }], pedidos_total: 3, teleconsultas: 0,
  eventos: { busca_exame: 15, busca_tipo: 4, busca_cidade: 10 },
};
const STATS30 = {
  dias: 30, de: '2026-10-01', ate: '2026-10-30', visitas: 4650,
  por_dia: Array.from({ length: 30 }, (_, i) => ({ dia: `2026-10-${String(i + 1).padStart(2, '0')}`, visitas: 100 + i * 3 })),
  paginas: [{ pagina: '/', visitas: 2000 }], exames: [], tipos: [], cidades: [], pedidos: [], pedidos_total: 9, teleconsultas: 2,
  eventos: {},
};

await scenario('equipe do IMED: aba Visitas com o contador próprio (7 e 30 dias), banco sem a função e erro', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, email: 'equipe@imed.com.br', db: { admin: true, claims: [], stats: { 7: STATS7, 30: STATS30 } } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-visitas');
  await page.click('#tab-visitas');
  await page.waitForSelector('#panel .vs-kpis');
  const q = calls(log, '/rpc/admin_stats');
  assert.deepEqual(q[0].body, { p_days: 7 }, 'começa pelos últimos 7 dias');
  assert.equal(q[0].auth, 'Bearer tok-init', 'com a sessão da equipe');
  const panel = page.locator('#panel');
  const txt = (await panel.innerText()).replace(/\s+/g, ' ');
  assert.match(txt, /Contagem própria do IMED, sem cookies e sem dados pessoais/);
  assert.match(txt, /O banco não guarda IP, aparelho nem quem visitou/);
  assert.equal(await panel.locator('a[href="privacidade.html#cookies"]').count(), 1);
  assert.deepEqual(await page.$$eval('.vs-kpi', (k) => k.map((x) => x.innerText.replace(/\s+/g, ' ').trim())),
    ['Visitas 1.260 de 24/10 a 30/10', 'Média por dia 180', 'Pedidos de agendamento 3', 'Teleconsultas pedidas 0']);
  assert.match(txt, /Os pedidos de agendamento e as teleconsultas não vêm do contador: são o número real/);
  // Gráfico: uma coluna por dia com visita, o maior dia com o número, "hoje" no fim; resumo para leitor de tela.
  assert.match(await page.getAttribute('.vs-chart', 'aria-label'), /^Visitas por dia, de 24\/10 a 30\/10: 1\.260 visitas no total; o dia com mais foi 27\/10, com 1\.000\.$/);
  assert.equal(await page.locator('.vs-cols li').count(), 7);
  assert.equal(await page.locator('.vs-bar').count(), 3);
  assert.equal(await page.textContent('.vs-peak'), '1.000');
  assert.equal(await page.getAttribute('.vs-cols li:nth-child(4)', 'title'), 'ter, 27/10: 1.000 visitas');
  assert.equal(await page.textContent('.vs-x li:last-child'), 'hoje');
  const h = await page.$$eval('.vs-bar', (b) => b.map((x) => Math.round(x.getBoundingClientRect().height)));
  assert.ok(h[1] > h[0] * 4 && h[1] > h[2] * 10, `alturas proporcionais (${h})`);
  // Números de cada dia (tabela), páginas, exames, cidades e pedidos.
  await page.click('.vs-days summary');
  assert.equal(await page.locator('.vs-days tbody tr').count(), 7);
  assert.match(await page.textContent('.vs-days tbody tr:first-child'), /sex, 30\/10 \(hoje, até agora\)\s*60/);
  const rows = (title) => page.$$eval(`.vs-box[aria-label="${title}"] tbody tr`, (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  assert.deepEqual(await rows('Páginas mais vistas'), ['Perto de mim (busca) /perto.html 700', 'Página inicial / 400', 'Clínicas em Sao Paulo - SP /cidades/sp/sao-paulo/clinicas.html 100', 'Guia: Raio-X /exames/raio-x.html 60']);
  assert.deepEqual(await rows('Exames mais buscados'), ['Ressonância 12', 'Exames de laboratório 3']);
  assert.deepEqual(await rows('Cidades mais buscadas'), ['São Paulo - SP 9', '<img src=x onerror="window.__xss=1"> - RJ 1']);
  assert.deepEqual(await rows('Tipos de local buscados'), ['Diagnóstico por imagem 4']);
  assert.deepEqual(await rows('Pedidos de agendamento por exame'), ['Ressonância 2', 'Não informado 1']);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'HTML escapado');
  await shot(page, '17-painel-admin-visitas');
  // 30 dias: os números de antes ficam (mais claros) até os novos chegarem.
  db.statsDelay = 600;
  await page.focus('#flt-vis');
  await page.selectOption('#flt-vis', '30');
  await page.waitForSelector('#vsBody.vs-busy[aria-busy="true"]');
  assert.match(await page.textContent('.vs-kpi b'), /1\.260/, 'segura os números de antes');
  await page.waitForFunction(() => !document.querySelector('#vsBody.vs-busy') && /4\.650/.test(document.querySelector('.vs-kpi b')?.textContent));
  assert.deepEqual(calls(log, '/rpc/admin_stats').at(-1).body, { p_days: 30 });
  assert.equal(await page.locator('.vs-cols li').count(), 30);
  assert.equal(await page.locator('.vs-x li span').count(), 5, 'um rótulo de dia por semana');
  assert.match(await page.textContent('.vs-kpis'), /Teleconsultas pedidas\s*2/);
  assert.match(await page.textContent('.vs-kpis'), /Pedidos de agendamento\s*9/);
  assert.match(await panel.innerText(), /Nenhuma busca por exame ainda\./);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'flt-vis', 'foco continua no filtro');
  await shot(page, '18-painel-admin-visitas-30-dias');
  // Banco ainda sem a função (migração não aplicada): aviso claro, sem erro na página.
  db.statsDelay = 0;
  db.statsError = { status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.admin_stats(p_days) in the schema cache' } };
  await page.click('#rf-vis');
  await page.waitForFunction(() => /ainda não está ligado no banco/.test(document.querySelector('#vsBody')?.textContent));
  // Outro erro: mensagem e "Tentar de novo".
  db.statsError = { status: 500, body: { message: 'erro' } };
  await page.click('#rf-vis');
  await page.waitForSelector('#retryVis');
  assert.match(await page.textContent('#vsBody'), /Não foi possível carregar os números agora/);
  db.statsError = null;
  await page.click('#retryVis');
  await page.waitForFunction(() => /4\.650/.test(document.querySelector('.vs-kpi b')?.textContent || ''));
  // Saiu da aba no meio da busca: a resposta atrasada não aparece em outra aba.
  db.statsDelay = 500;
  await page.click('#rf-vis');
  await page.click('#tab-mensagens');
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#panel .vs-kpis').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedidos: exame para outra pessoa (menor, com autorização) e cancelado pelo paciente; banco ainda sem as colunas novas', async () => {
  const reqs = [
    { ...REQUESTS[0], for_other: true, other_name: 'Pedro <i>Souza</i>', relationship: 'Filho ou filha', other_minor: true, guardian_consent: true, cancelled_at: null, cancelled_by: null },
    { ...REQUESTS[1], status: 'cancelled', for_other: false, other_name: null, relationship: null, other_minor: false, guardian_consent: false, cancelled_at: '2026-10-29T20:15:00Z', cancelled_by: 'patient' },
  ];
  let { page, log, errors, context, db } = await newPage(browser, { logged: true, db: { members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], requests: reqs } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  const a = page.locator(`#rq-${REQUESTS[0].id}`);
  assert.equal(await a.locator('h3').textContent(), 'Ressonância · Pedro <i>Souza</i>', 'o cartão leva o nome de quem vai fazer o exame');
  const dl = await a.locator('dl').evaluate((d) => Object.fromEntries([...d.querySelectorAll('dt')].map((t) => [t.textContent, t.nextElementSibling.textContent])));
  assert.match(dl['O exame é para'], /^Pedro <i>Souza<\/i> \(Filho ou filha\)/);
  assert.match(dl['O exame é para'], /Menor de 18 anos · autorização do responsável legal registrada no pedido/);
  assert.equal(dl['Quem pediu'], 'Maria Souza');
  assert.equal(dl.Paciente, undefined);
  const b = page.locator(`#rq-${REQUESTS[1].id}`);
  const dl2 = await b.locator('dl').evaluate((d) => Object.fromEntries([...d.querySelectorAll('dt')].map((t) => [t.textContent, t.nextElementSibling.textContent])));
  assert.equal(dl2.Paciente, 'João Lima');
  assert.match(dl2.Cancelado, /^pelo paciente, no site em 29\/10\/2026.*17:15/);
  assert.equal(await b.locator('.rq-st').textContent(), 'Cancelado');
  // Cancelado pelo próprio paciente: a clínica não reabre (o paciente veria "Confirmado" de novo). Sem botões.
  assert.equal(await b.locator('[data-st]').count(), 0, 'sem os botões de mudar a situação');
  assert.match(await b.locator('.rq-locked').textContent(), /Cancelado pelo paciente: para remarcar, é preciso um novo pedido\./);
  assert.equal(await a.locator('[data-st]').count(), 4, 'os outros pedidos continuam com os botões');
  await shot(page, '17-painel-pedido-outra-pessoa');
  // A lista estava velha: o paciente cancelou enquanto a página estava aberta. O banco recusa e o cartão trava.
  const c = page.locator(`#rq-${REQUESTS[0].id}`);
  Object.assign(db.requests.find((x) => x.id === REQUESTS[0].id), { status: 'cancelled', cancelled_by: 'patient', cancelled_at: '2026-10-30T10:00:00Z' });
  await c.locator('[data-st="confirmed"]').click();
  await page.waitForFunction(() => /O próprio paciente cancelou este pedido\. Para remarcar, é preciso um novo pedido\./.test(document.querySelector('#rqMsg')?.textContent || ''));
  assert.equal(await page.locator(`#rq-${REQUESTS[0].id} [data-st]`).count(), 0, 'o cartão trava depois da recusa do banco');
  assert.deepEqual(errors, []);
  await context.close();
  // banco sem a migração de confiança (42703), que também não tem a agenda_requests (4.2): busca de novo sem as
  // colunas novas e a lista aparece
  ({ page, log, errors, context } = await newPage(browser, { logged: true, db: { members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], requests: [...REQUESTS], failTrustCols: true, noRequestsFn: true } }));
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  const rq = calls(log, '/appointment_requests');
  assert.equal(rq.length, 2);
  assert.match(rq[0].query.get('select'), /for_other/);
  assert.equal(rq[1].query.get('select'), 'id,created_at,exam_code,preferred_date,preferred_period,patient_name,patient_phone,patient_email,notes,status,slot_start');
  assert.equal(await page.locator('.rq').count(), 2);
  assert.doesNotMatch(await page.textContent('#panel'), /O exame é para|Quem pediu/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('painel com duas clínicas: resposta atrasada da primeira não aparece na segunda; rascunho', async () => {
  const C2 = 'cccccccc-0000-4000-8000-000000000002';
  const { page, log, errors, context } = await newPage(browser, { logged: true, db: {
    members: [{ clinic_id: C1, role: 'owner' }, { clinic_id: C2, role: 'owner' }],
    clinics: [CLINIC, { ...CLINIC, id: C2, name: 'Rascunho Clínica', status: 'draft' }],
    requests: [...REQUESTS, { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000020', clinic_id: C2, patient_name: 'Paciente da Segunda' }],
    delays: [{ path: 'rpc/agenda_requests', match: C1, ms: 900 }],
  } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#clinicPick');
  assert.equal(await page.textContent('#clinicTitle'), 'Imagem Paulista');
  await page.selectOption('#clinicPick', C2);
  await page.waitForSelector('.rq');
  await page.waitForTimeout(1200);
  assert.equal(calls(log, '/rpc/agenda_requests').length, 2);
  assert.equal(await page.textContent('#clinicTitle'), 'Rascunho Clínica');
  assert.equal(await page.locator('.rq').count(), 1);
  assert.match(await page.textContent('.rq'), /Paciente da Segunda/);
  await page.selectOption('#flt-pedidos', 'pending');
  assert.equal(await page.locator('.rq').count(), 1, 'cache por clínica');
  assert.match(await page.textContent('.rq'), /Paciente da Segunda/);
  // rascunho: mensagem de salvo não promete aparecer na busca
  await page.click('#tab-dados');
  await page.waitForSelector('#dataForm');
  await page.click('#dSave');
  await page.waitForSelector('#dMsg .cl-note.ok');
  assert.match(await page.textContent('#dMsg'), /Vão aparecer na busca quando o cadastro for publicado/);
  assert.match(await page.textContent('#clinicNotes'), /rascunho/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('entrada vencida sem renovação: mostra de novo o pedido de link', async () => {
  // reivindicar
  let { page, errors, context, db } = await newPage(browser, { logged: true });
  await page.goto(`${BASE}reivindicar.html?cnes=6543210`);
  await page.waitForSelector('#s3:not([hidden])');
  await page.fill('#cName', 'Paula Gerente');
  await page.selectOption('#cRole', 'gestor');
  await page.type('#cDoc', '11222333000181');
  await page.type('#cPhone', '1130002000');
  await page.check('#cAgree');
  db.failRefresh = true;
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('imed_session')); s.expires_at = 1; localStorage.setItem('imed_session', JSON.stringify(s)); });
  await page.click('#claimBtn');
  await page.waitForSelector('#loginEmail');
  assert.match(await page.textContent('#flash'), /Sua entrada expirou\. Entre de novo abaixo \(link por e-mail ou senha\)\./);
  assert.doesNotMatch(await page.textContent('#authBox'), /Você entrou como/);
  assert.ok(await page.isHidden('#s3'));
  assert.ok(await page.isVisible('#s2'));
  assert.deepEqual(errors, []);
  await context.close();
  // painel
  ({ page, errors, context, db } = await newPage(browser, { logged: true, db: { members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], requests: [...REQUESTS] } }));
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  db.failRefresh = true;
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('imed_session')); s.expires_at = 1; localStorage.setItem('imed_session', JSON.stringify(s)); });
  await page.locator('.rq').first().locator('button[data-st="contacted"]').click();
  await page.waitForSelector('#loginEmail');
  assert.match(await page.textContent('#flash'), /Sua entrada expirou\. Entre de novo abaixo \(link por e-mail ou senha\)\./);
  assert.equal(await page.textContent('#app'), '');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'loginEmail');
  assert.deepEqual(errors, []);
  await context.close();
});

// ---------- agenda com horário ----------
const NOW = '2026-10-30T12:00:00-03:00'; // sexta-feira, meio-dia em São Paulo
const AG_EXAMS = [{ clinic_id: C1, exam_code: 'rm', price_cents: 45000 }, { clinic_id: C1, exam_code: 'tc', price_cents: null }, { clinic_id: C1, exam_code: 'usg', price_cents: 18000 }];
const AG_SCHEDULES = [
  { id: 's1', clinic_id: C1, weekday: 1, start_time: '08:00:00', end_time: '12:00:00', slot_minutes: 30, exam_codes: [] },
  { id: 's2', clinic_id: C1, weekday: 1, start_time: '13:00:00', end_time: '17:00:00', slot_minutes: 20, exam_codes: ['rm', 'mamo'] },
  { id: 's3', clinic_id: C1, weekday: 6, start_time: '08:00:00', end_time: '12:00:00', slot_minutes: 15, exam_codes: ['tc'] },
  { id: 's4', clinic_id: 'cccccccc-0000-4000-8000-000000000009', weekday: 3, start_time: '08:00:00', end_time: '09:00:00', slot_minutes: 30, exam_codes: [] },
];
const B1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const B2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const AG_BLOCKS = [
  { id: B1, clinic_id: C1, starts_at: '2026-11-02T03:00:00+00:00', ends_at: '2026-11-03T03:00:00+00:00', reason: 'Finados <b>feriado</b>' },
  { id: B2, clinic_id: C1, starts_at: '2026-11-10T11:00:00+00:00', ends_at: '2026-11-10T15:00:00+00:00', reason: null },
  { id: 'bbbbbbbb-0000-4000-8000-000000000003', clinic_id: C1, starts_at: '2026-10-01T03:00:00+00:00', ends_at: '2026-10-02T03:00:00+00:00', reason: 'Antigo' },
];
// 20 horários na terça 03/11 (08:00 em diante, de 20 em 20 min) e 15 na quarta 04/11, para ultrassom.
const AG_SLOTS = [
  ...Array.from({ length: 20 }, (_, i) => ({ exam: 'usg', slot_start: new Date(Date.parse('2026-11-03T11:00:00Z') + i * 20 * 60000).toISOString() })),
  ...Array.from({ length: 15 }, (_, i) => ({ exam: 'usg', slot_start: new Date(Date.parse('2026-11-04T11:00:00Z') + i * 20 * 60000).toISOString() })),
];
const agendaDb = (extra = {}) => ({ members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], exams: AG_EXAMS, schedules: AG_SCHEDULES, blocks: AG_BLOCKS, slots: AG_SLOTS, requests: REQUESTS, ...extra });
// Troca o filtro "Quando" e espera a lista nova chegar do banco.
async function pickWhen(page, v) {
  await page.selectOption('#flt-when', v);
  await page.waitForFunction(() => !document.querySelector('#panel .cl-state') && document.querySelector('#flt-when'));
}

await scenario('configurar agenda: editor antigo de faixas saiu (4.1); aviso com pedidos online desligados e atalho para Dados da clínica', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true, now: NOW, db: agendaDb({ clinics: [{ ...CLINIC, accepts_online_booking: false }], exams: [], blocks: [], slots: [] }) });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  await page.click('#tab-config');
  await page.waitForSelector('#qcForm');
  assert.match(await page.textContent('#agNote'), /Os pedidos pelo site estão desligados\. Ligue “Aceito pedidos de agendamento pelo site”/);
  // fase 4.2: os bloqueios saíram daqui (visão "Bloqueios" da aba Agenda, pelas funções novas; e2e-agenda)
  assert.equal(await page.locator('#agWeek, #agSave, #pvExam, #blkForm, #agBlocks').count(), 0, 'sem o editor antigo e sem os bloqueios antigos');
  assert.equal(calls(log, '/clinic_schedules').length, 0);
  assert.equal(calls(log, '/clinic_blocks').length, 0);
  assert.equal(calls(log, '/rpc/set_my_schedule').length, 0);
  assert.equal(calls(log, '/rpc/available_slots').length, 0);
  assert.deepEqual(calls(log, '/rpc/agenda_config')[0].body, { p_clinic: C1 });
  await page.click('#agNote [data-go="dados"]');
  await page.waitForSelector('#dataForm');
  assert.equal(await page.getAttribute('#tab-dados', 'aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-dados');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('aba Agenda (banco só com a 3.4): abre no dia da clínica, avisa o que falta e não lê tabelas', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true, now: NOW, db: agendaDb() });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  await page.click('#tab-agenda');
  await page.waitForSelector('#agRoot #agMain');
  await page.waitForFunction(() => !document.querySelector('#agMain[aria-busy="true"]'));
  assert.match(await page.textContent('#agTop'), /Esta parte da agenda ainda não está disponível/);
  assert.equal(await page.locator('#agNovo').count(), 0, 'sem a 4.2, sem "Novo agendamento"');
  assert.deepEqual(calls(log, '/rpc/agenda_view')[0].body, { p_clinic: C1, p_from: '2026-10-30', p_days: 1 });
  assert.equal(calls(log, '/clinic_blocks').length + calls(log, '/clinic_schedules').length + calls(log, '/appointment_requests', 'GET').length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedidos com horário marcado: destaque, ordem pela data e filtros Hoje e Próximos 7 dias', async () => {
  const mk = (n, o) => ({ ...REQUESTS[0], id: `rrrrrrrr-0000-4000-8000-0000000003${n}`, notes: null, patient_email: null, ...o });
  const rows = [
    mk('01', { patient_name: 'Paciente Longe', preferred_date: '2026-11-20', preferred_period: 'tarde', status: 'pending', created_at: '2026-10-29T10:00:00Z' }),
    mk('02', { patient_name: 'Paciente Passado', preferred_date: '2026-10-20', status: 'completed', created_at: '2026-10-10T10:00:00Z' }),
    mk('03', { patient_name: 'Paciente Semana', exam_code: 'usg', slot_start: '2026-11-04T12:00:00+00:00', preferred_date: '2026-11-04', preferred_period: 'manha', status: 'confirmed', created_at: '2026-10-29T09:00:00Z' }),
    mk('04', { patient_name: 'Paciente Hoje', slot_start: '2026-10-30T17:30:00+00:00', preferred_date: '2026-10-30', preferred_period: 'tarde', status: 'confirmed', created_at: '2026-10-28T09:00:00Z' }),
    mk('05', { patient_name: 'Paciente Cancelou', slot_start: '2026-11-01T13:00:00+00:00', preferred_date: '2026-11-01', preferred_period: 'manha', status: 'cancelled', created_at: '2026-10-27T09:00:00Z' }),
  ];
  const { page, log, errors, context } = await newPage(browser, { logged: true, now: NOW, db: { members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], requests: rows } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  assert.deepEqual(calls(log, '/rpc/agenda_requests')[0].body, { p_clinic: C1, p_when: null, p_justification: null });
  const names = () => page.$$eval('.rq h3', (h) => h.map((x) => x.textContent.split(' · ')[1]));
  assert.deepEqual(await names(), ['Paciente Hoje', 'Paciente Cancelou', 'Paciente Semana', 'Paciente Longe', 'Paciente Passado']);
  const hoje = page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000304');
  assert.match(await hoje.locator('.rq-slot').textContent(), /Agendado pelo site \(confirmado\)/);
  assert.match(await hoje.textContent(), /Horário marcado.*30\/10\/2026 às 14:30/);
  assert.equal(await page.locator('#rqTz').count(), 0, 'clínica e aparelho no mesmo fuso: sem aviso');
  assert.doesNotMatch(await hoje.textContent(), /Data preferida|Período/);
  assert.match(await hoje.locator('.rq-act .lbl').textContent(), /“Cancelado” libera o horário para outro paciente/);
  assert.match(await page.textContent('#rq-rrrrrrrr-0000-4000-8000-000000000303'), /04\/11\/2026 às 09:00/);
  assert.match(await page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000305 .rq-slot').textContent(), /Horário escolhido pelo paciente no site/);
  const longe = page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000301');
  assert.equal(await longe.locator('.rq-slot').count(), 0);
  assert.match(await longe.textContent(), /Data preferida.*20\/11\/2026/);
  await shot(page, '19-painel-pedidos-horario');
  // filtros: "Hoje" e "Próximos 7 dias" buscam no banco pela data do exame
  assert.deepEqual(await page.$$eval('#flt-when option', (o) => o.map((x) => x.textContent)), ['Qualquer data', 'Hoje', 'Próximos 7 dias']);
  await pickWhen(page, 'hoje');
  assert.deepEqual(calls(log, '/rpc/agenda_requests').at(-1).body, { p_clinic: C1, p_when: 'hoje', p_justification: null });
  assert.deepEqual(await names(), ['Paciente Hoje']);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'flt-when');
  await pickWhen(page, 'semana');
  assert.deepEqual(calls(log, '/rpc/agenda_requests').at(-1).body, { p_clinic: C1, p_when: 'semana', p_justification: null });
  assert.deepEqual(await names(), ['Paciente Hoje', 'Paciente Cancelou', 'Paciente Semana']);
  await page.selectOption('#flt-pedidos', 'confirmed');
  assert.deepEqual(await names(), ['Paciente Hoje', 'Paciente Semana']);
  await page.selectOption('#flt-pedidos', 'pending');
  assert.match(await page.textContent('#panel'), /Nenhum pedido para esse período com esse filtro/);
  // situação muda e a lista continua na ordem certa
  await page.selectOption('#flt-pedidos', '');
  await page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000303 button[data-st="completed"]').click();
  await page.waitForFunction(() => /Concluído/.test(document.querySelector('#rq-rrrrrrrr-0000-4000-8000-000000000303 .rq-st').textContent));
  assert.deepEqual(await names(), ['Paciente Hoje', 'Paciente Cancelou', 'Paciente Semana']);
  await pickWhen(page, '');
  assert.equal(await page.locator('.rq').count(), 5);
  assert.equal(calls(log, '/rpc/agenda_requests').at(-1).body.p_when, null);
  assert.equal(calls(log, '/appointment_requests', 'GET').length, 0, 'nenhuma leitura direta');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('pedidos: "Hoje" acha o paciente de hoje mesmo com mais de 100 pedidos mais novos', async () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ ...REQUESTS[0], id: `rrrrrrrr-0000-4000-8000-0000000005${String(i).padStart(2, '0')}`, notes: null, patient_name: `Paciente ${i}`, preferred_date: '2026-11-25', created_at: '2026-10-29T20:00:00Z' }));
  const old = { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000499', notes: null, patient_name: 'Paciente Antiga de Hoje', slot_start: '2026-10-30T19:00:00+00:00', preferred_date: '2026-10-30', preferred_period: 'tarde', status: 'confirmed', created_at: '2026-10-01T09:00:00Z' };
  const { page, log, errors, context } = await newPage(browser, { logged: true, now: NOW, db: { members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], requests: [...many, old] } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  assert.equal(await page.locator('.rq').count(), 100);
  assert.equal(await page.locator(`#rq-${old.id}`).count(), 0, 'fica de fora dos 100 mais novos');
  await pickWhen(page, 'hoje');
  assert.equal(await page.locator('.rq').count(), 1);
  assert.match(await page.textContent(`#rq-${old.id}`), /Paciente Antiga de Hoje.*Horário marcado.*30\/10\/2026 às 16:00/s);
  assert.match(await page.textContent('#flt-pedidos option'), /Todos \(1\)/);
  // dia sem pedidos
  await pickWhen(page, '');
  await page.waitForSelector('.rq');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('fuso: aparelho em Tóquio às 23:30 de São Paulo (já 31/10 em UTC) usa o dia de São Paulo', async () => {
  const LATE = '2026-10-30T23:30:00-03:00';
  const reqs = [
    { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000601', notes: null, patient_name: 'Paciente Noite', exam_code: 'usg', slot_start: '2026-10-31T02:00:00+00:00', preferred_date: '2026-10-30', preferred_period: 'noite', status: 'confirmed', created_at: '2026-10-29T10:00:00Z' },
    { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000602', notes: null, patient_name: 'Paciente Amanhã', exam_code: 'usg', slot_start: '2026-10-31T13:00:00+00:00', preferred_date: '2026-10-31', preferred_period: 'manha', status: 'confirmed', created_at: '2026-10-29T11:00:00Z' },
  ];
  const { page, log, errors, context } = await newPage(browser, { logged: true, now: LATE, tz: 'Asia/Tokyo', db: agendaDb({ requests: reqs }) });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  assert.equal(await page.evaluate(() => new Date().getDate()), 31, 'no aparelho já é dia 31');
  assert.match(await page.textContent('#rq-rrrrrrrr-0000-4000-8000-000000000601'), /Horário marcado.*30\/10\/2026 às 23:00/s);
  // "Hoje" e "Próximos 7 dias": quem decide o dia é o banco (fuso da clínica), não o aparelho
  await pickWhen(page, 'hoje');
  assert.deepEqual(calls(log, '/rpc/agenda_requests').at(-1).body, { p_clinic: C1, p_when: 'hoje', p_justification: null });
  assert.deepEqual(await page.$$eval('.rq h3', (h) => h.map((x) => x.textContent.split(' · ')[1])), ['Paciente Noite']);
  await pickWhen(page, 'semana');
  assert.deepEqual(calls(log, '/rpc/agenda_requests').at(-1).body, { p_clinic: C1, p_when: 'semana', p_justification: null });
  assert.deepEqual(await page.$$eval('.rq h3', (h) => h.map((x) => x.textContent.split(' · ')[1])), ['Paciente Noite', 'Paciente Amanhã']);
  assert.equal(calls(log, '/appointment_requests', 'GET').length, 0);
  // a agenda abre no dia 30 (São Paulo), não no 31 do aparelho
  await page.click('#tab-agenda');
  await page.waitForSelector('#agRoot #agMain');
  await page.waitForFunction(() => !document.querySelector('#agMain[aria-busy="true"]'));
  assert.equal(calls(log, '/rpc/agenda_view').at(-1).body.p_from, '2026-10-30');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('fuso: clínica em Manaus vista de São Paulo: o cartão da aba Pedidos mostra a hora de lá (como a aba Agenda), com o aviso', async () => {
  const MAN = { ...CLINIC, timezone: 'America/Manaus' };
  const reqs = [
    { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000611', notes: null, patient_name: 'Paciente Manhã Manaus', exam_code: 'usg', slot_start: '2026-11-05T13:00:00+00:00', slot_end: '2026-11-05T13:30:00+00:00', preferred_date: '2026-11-05', preferred_period: 'manha', status: 'confirmed', created_at: '2026-11-04T14:00:00Z' },
    { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000612', notes: null, patient_name: 'Paciente Noite Manaus', exam_code: 'usg', slot_start: '2026-11-06T03:30:00+00:00', slot_end: '2026-11-06T04:00:00+00:00', preferred_date: '2026-11-05', preferred_period: 'noite', status: 'cancelled', cancelled_by: 'clinic', cancelled_at: '2026-11-05T15:10:00Z', created_at: '2026-11-04T13:00:00Z' },
  ];
  // meio-dia em Manaus (13:00 em São Paulo), aparelho em São Paulo
  const { page, log, errors, context } = await newPage(browser, { logged: true, now: '2026-11-05T12:00:00-04:00', db: { members: [{ clinic_id: C1, role: 'owner' }], clinics: [MAN], requests: reqs } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  assert.match(await page.textContent('#rqTz'), /Horários no fuso da clínica \(uma hora a menos que Brasília\)\./);
  const manha = await page.textContent('#rq-rrrrrrrr-0000-4000-8000-000000000611');
  assert.match(manha, /Horário marcado.*05\/11\/2026 às 09:00/s, '09:00 de Manaus, como na aba Agenda');
  assert.doesNotMatch(manha, /às 10:00/, 'nunca a hora de São Paulo');
  assert.match(manha, /Pedido em 04\/11\/2026,? 10:00/, 'pedido feito às 10:00 de Manaus');
  // 23:30 de Manaus no dia 05 (00:30 do dia 06 em São Paulo): o cartão diz o dia e a hora de lá, como o "Hoje"
  const noite = await page.textContent('#rq-rrrrrrrr-0000-4000-8000-000000000612');
  assert.match(noite, /Horário marcado.*05\/11\/2026 às 23:30/s);
  assert.match(noite, /Cancelado.*pela clínica em 05\/11\/2026,? 11:10/s);
  await pickWhen(page, 'hoje');
  assert.deepEqual(calls(log, '/rpc/agenda_requests').at(-1).body, { p_clinic: C1, p_when: 'hoje', p_justification: null });
  assert.deepEqual(await page.$$eval('.rq h3', (h) => h.map((x) => x.textContent.split(' · ')[1])), ['Paciente Manhã Manaus', 'Paciente Noite Manaus']);
  assert.match(await page.textContent('#rq-rrrrrrrr-0000-4000-8000-000000000612'), /05\/11\/2026 às 23:30/);
  assert.equal(calls(log, '/appointment_requests', 'GET').length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('banco sem agenda_requests (404): a lista volta para a leitura direta de hoje, com as mesmas colunas', async () => {
  const rows = [
    { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000701', notes: null, patient_name: 'Paciente Hoje', slot_start: '2026-10-30T17:30:00+00:00', preferred_date: '2026-10-30', preferred_period: 'tarde', status: 'confirmed', created_at: '2026-10-28T09:00:00Z' },
    { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000702', notes: null, patient_name: 'Paciente Depois', preferred_date: '2026-11-20', status: 'pending', created_at: '2026-10-29T09:00:00Z' },
  ];
  const { page, log, errors, context } = await newPage(browser, { logged: true, now: NOW, db: { members: [{ clinic_id: C1, role: 'owner' }], clinics: [CLINIC], requests: rows, noRequestsFn: true } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  assert.equal(calls(log, '/rpc/agenda_requests').length, 1, 'tentou a função primeiro');
  const rq = calls(log, '/appointment_requests', 'GET')[0];
  assert.equal(rq.query.get('clinic_id'), `eq.${C1}`);
  assert.equal(rq.query.get('select'), 'id,created_at,exam_code,preferred_date,preferred_period,patient_name,patient_phone,patient_email,notes,status,slot_start,for_other,other_name,relationship,other_minor,guardian_consent,other_consent,cancelled_at,cancelled_by');
  assert.equal(rq.query.get('order'), 'created_at.desc');
  assert.equal(rq.query.get('limit'), '100');
  assert.equal(await page.locator('.rq').count(), 2);
  await pickWhen(page, 'hoje');
  const qh = calls(log, '/appointment_requests', 'GET').at(-1).query;
  assert.deepEqual(qh.getAll('preferred_date'), ['eq.2026-10-30']);
  assert.equal(qh.get('limit'), '200');
  assert.deepEqual(await page.$$eval('.rq h3', (h) => h.map((x) => x.textContent.split(' · ')[1])), ['Paciente Hoje']);
  await pickWhen(page, 'semana');
  const qs = calls(log, '/appointment_requests', 'GET').at(-1).query;
  assert.deepEqual(qs.getAll('preferred_date'), ['gte.2026-10-30', 'lte.2026-11-05']);
  assert.equal(qs.get('order'), 'preferred_date,slot_start,created_at.desc');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agendamento da agenda nova na lista de pedidos: "Ver na agenda" e sem botões de situação', async () => {
  const rows = [
    { ...REQUESTS[0], id: 'rrrrrrrr-0000-4000-8000-000000000801', notes: null, patient_name: 'Paciente <b>Agenda</b> Teste', exam_code: 'usg', slot_start: '2026-11-04T12:00:00+00:00', preferred_date: '2026-11-04', preferred_period: 'manha', status: 'confirmed', uses_resources: true, channel: 'clinica_telefone', version: 3, created_at: '2026-10-29T09:00:00Z' },
    { ...REQUESTS[1], notes: null },
  ];
  const { page, log, errors, context } = await newPage(browser, { logged: true, now: NOW, db: agendaDb({ requests: rows }) });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  const card = page.locator('#rq-rrrrrrrr-0000-4000-8000-000000000801');
  assert.match(await card.locator('h3').textContent(), /Paciente <b>Agenda<\/b> Teste/, 'nome escapado');
  assert.match(await card.locator('.rq-slot').textContent(), /Na agenda · marcado por: Telefone/);
  assert.equal(await card.locator('[data-st]').count(), 0, 'a situação muda na aba Agenda');
  assert.match(await card.textContent(), /Chegada, atendimento, remarcação e cancelamento ficam na aba Agenda/);
  assert.equal(await page.locator(`#rq-${REQUESTS[1].id} [data-st]`).count(), 4, 'pedido sem horário continua com os botões');
  await card.locator('[data-veragenda]').click();
  await page.waitForSelector('#agRoot #agMain');
  assert.equal(await page.getAttribute('#tab-agenda', 'aria-selected'), 'true');
  await page.waitForFunction(() => document.querySelector('[data-view="dia"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(calls(log, '/rpc/agenda_view').at(-1).body.p_from, '2026-11-04', 'abre o dia do agendamento');
  await page.waitForFunction(() => !!document.querySelector('#agDet:not([hidden])'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'agDetT', 'foco no detalhe');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('equipe do IMED sem vínculo abre a agenda de qualquer clínica', async () => {
  const C2 = 'cccccccc-0000-4000-8000-000000000002';
  const { page, log, errors, context } = await newPage(browser, { logged: true, email: 'equipe@imed.com.br', now: NOW, db: agendaDb({
    admin: true, members: [], clinics: [CLINIC, { ...CLINIC, id: C2, name: 'Outra <i>Clínica</i>', status: 'draft' }], claims: CLAIMS,
  }) });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#cl-kkkkkkkk-0000-4000-8000-000000000001');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Pedidos de cadastro|Pedidos ao IMED|Mensagens|Avisos de erro|Visitas');
  assert.equal(await page.textContent('#clinicTitle'), 'Equipe do IMED');
  const all = calls(log, '/clinics').find((e) => !e.query.get('id'));
  assert.equal(all.query.get('limit'), '500');
  assert.equal(all.query.get('order'), 'name');
  assert.equal(await page.inputValue('#clinicPick'), '');
  assert.deepEqual(await page.$$eval('#clinicPick option', (o) => o.map((x) => x.textContent)), ['Equipe do IMED (sem clínica)', 'Imagem Paulista', 'Outra <i>Clínica</i> (rascunho)']);
  await page.selectOption('#clinicPick', C1);
  // pedidos de uma clínica sem vínculo: o motivo antes da lista (fica registrado; decisão 4.2-f)
  await page.waitForSelector('#rqJust');
  assert.equal(await page.textContent('#clinicTitle'), 'Imagem Paulista');
  assert.match(await page.textContent('#app'), /Você está vendo esta clínica como equipe do IMED/);
  assert.equal(await page.locator('.rq').count(), 0, 'nenhum pedido antes do motivo');
  assert.deepEqual(calls(log, '/rpc/agenda_requests').at(-1).body, { p_clinic: C1, p_when: null, p_justification: null });
  await page.click('#rqJustOk');
  assert.match(await page.textContent('#rqJustErr'), /motivo/i);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'rqJust');
  await page.selectOption('#rqJust', 'suporte_clinica');
  await page.click('#rqJustOk');
  await page.waitForSelector('.rq');
  assert.deepEqual(calls(log, '/rpc/agenda_requests').at(-1).body, { p_clinic: C1, p_when: null, p_justification: 'suporte_clinica' });
  assert.equal(calls(log, '/appointment_requests', 'GET').length, 0);
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Pedidos|Agenda|Configurar agenda|Dados da clínica|Exames e preços|Financeiro|Equipe|Pedidos de cadastro|Pedidos ao IMED|Mensagens|Avisos de erro|Visitas');
  await page.click('#tab-config');
  await page.waitForSelector('#qcForm');
  assert.deepEqual(calls(log, '/rpc/agenda_config')[0].body, { p_clinic: C1 });
  assert.equal(await page.locator('#blkForm').count(), 0);
  // de volta às abas da equipe
  await page.selectOption('#clinicPick', '');
  await page.waitForSelector('#cl-kkkkkkkk-0000-4000-8000-000000000001');
  assert.equal(await page.textContent('#clinicTitle'), 'Equipe do IMED');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (390px): reivindicar e painel sem rolagem lateral', async () => {
  let { page, errors, context } = await newPage(browser, { mobile: true, logged: true });
  await page.goto(`${BASE}reivindicar.html?cnes=2077485`);
  await page.waitForSelector('#s3:not([hidden])');
  await noOverflow(page);
  await shot(page, '11-celular-reivindicar');
  await page.goto(`${BASE}reivindicar.html`);
  await page.waitForSelector('#city option[value="3550308"]', { state: 'attached' });
  await page.fill('#cityFilter', 'paulo');
  await page.fill('#term', 'santa');
  await page.click('#findBtn');
  await page.waitForSelector('#results li');
  await noOverflow(page);
  await shot(page, '12-celular-busca');
  assert.deepEqual(errors, []);
  await context.close();
  ({ page, errors, context } = await newPage(browser, { mobile: true, logged: true, db: {
    admin: true, members: [{ clinic_id: C1, role: 'owner' }, { clinic_id: 'cccccccc-0000-4000-8000-000000000002', role: 'staff' }], clinics: [CLINIC, { ...CLINIC, id: 'cccccccc-0000-4000-8000-000000000002', name: 'Segunda Clínica com Nome Bem Comprido Para Testar', status: 'draft' }],
    requests: [...REQUESTS, ...IMED_REQUESTS], claims: CLAIMS,
    exams: [{ clinic_id: C1, exam_code: 'rm', price_cents: 45000 }], stats: { 30: STATS30, 7: STATS7 },
  } }));
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('.rq');
  assert.equal(await page.locator('[role=tab]').count(), 12);   // com a aba Financeiro (iMed Pagamentos, P2b)
  await noOverflow(page);
  await shot(page, '13-celular-painel-pedidos');
  // financeiro: neste banco de mentira as funções do pagamento não existem (como na produção de hoje): "ainda não disponível"
  for (const t of ['agenda', 'config', 'equipe', 'dados', 'exames', 'financeiro', 'cadastros', 'concierge', 'mensagens', 'avisos', 'visitas']) {
    await page.click(`#tab-${t}`);
    await page.waitForFunction(() => !document.querySelector('#panel .cl-state'));
    await noOverflow(page);
    await shot(page, `14-celular-painel-${t}`);
  }
  await page.selectOption('#clinicPick', 'cccccccc-0000-4000-8000-000000000002');
  await page.waitForSelector('.cl-note.warn');
  assert.match(await page.textContent('#app'), /rascunho/);
  await noOverflow(page);
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
