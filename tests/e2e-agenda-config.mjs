// Teste de ponta a ponta da configuração da agenda e da equipe no painel da clínica (iMed Agenda, fase 4.1), num
// navegador de verdade (Playwright), com o Supabase simulado (um banco de mentira que guarda o que a tela grava, para
// a tela ler de volta como no banco de verdade). Computador (1024 px) e celular (390 px), teclado, relógio fixo.
// Rodar: node tests/e2e-agenda-config.mjs   (SHOTS=pasta salva capturas; E2E_PORT muda a porta)
// CAPTURA_COMPUTADOR / CAPTURA_CELULAR: caminhos de arquivo para as duas capturas principais (opcional).
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
const PORT = Number(process.env.E2E_PORT) || 8781;
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
const CLINIC = { id: C1, name: 'Clínica Teste da Agenda', kind: 'imagem', address_line: 'Rua de Teste, 1', city: 'São Paulo', state: 'SP', cep: null, cnes: '7654321',
  phone: null, whatsapp: null, email: null, website: null, specialties: [], opening_hours: null, accepts_online_booking: true, status: 'published', is_demo: false, insurances: [] };
const unitDefaults = () => ({ timezone: 'America/Sao_Paulo', timezone_suggested: 'America/Sao_Paulo', timezone_confirmed_at: null, agenda_mode: 'pedido', agenda_online_since: null,
  manual_commitment_at: null, step_min: null, min_notice_min: null, max_advance_days: null, holidays_checked_until: null, hold_minutes: null, payment_grace_min: null,
  patient_cancel_until_min: null, patient_reschedule_until_min: null, checkin_before_min: null, no_show_after_min: null, patient_gap_min: null, closes_on_holidays: null,
  payment_mode: null, updated_at: null });
const UNIT_SET = { step_min: 5, min_notice_min: 120, max_advance_days: 90, hold_minutes: 10, payment_grace_min: 5, patient_cancel_until_min: 0, patient_reschedule_until_min: 120,
  checkin_before_min: 120, no_show_after_min: 15, patient_gap_min: 0, closes_on_holidays: true, payment_mode: 'no_local' };

const clone = (x) => JSON.parse(JSON.stringify(x));
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
let seq = 0;
const nid = (p) => `${p}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function filt(rows, q) {
  let out = rows;
  for (const [k, v] of q) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
    else if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(','); out = out.filter((r) => set.includes(String(r[k]))); }
    else if (op === 'gte') out = out.filter((r) => Date.parse(r[k]) >= Date.parse(val));
  }
  return out;
}

// role: papel da pessoa logada na clínica (null = sem vínculo). admin: equipe do IMED.
async function newPage(browser, { mobile = false, width = 1024, role = 'owner', admin = false, email = 'dona@exemplo.test', db: o = {}, theme = null } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width, height: 900 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', colorScheme: theme === 'dark' ? 'dark' : 'light' });
  await context.clock.setFixedTime(new Date(NOW));
  const db = {
    role, admin, invites: [], myInvites: [], exams: [{ clinic_id: C1, exam_code: 'usg' }, { clinic_id: C1, exam_code: 'rx' }], blocks: [], slots: [],
    cfg: { active: false, old_schedule_exists: false, unit: unitDefaults(), resources: [], procedures: [], rules: [], pair_rules: [], holiday_openings: [] },
    members: [{ user_id: USER, email, role: role || 'owner', created_at: '2026-11-01T12:00:00Z', me: true }],
    once: {}, ...clone(o),
  };
  const log = [];
  await context.addInitScript(([s, t]) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (t) localStorage.setItem('imed_tema', t);
      if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('imed_session', JSON.stringify(s)); sessionStorage.setItem('__seeded', '1'); }
    } catch { /* */ }
  }, [{ access_token: 'tok-init', refresh_token: 'ref', expires_at: Math.floor(Date.parse(NOW) / 1000) + 3600, user: { id: USER, email } }, theme === 'dark' ? 'escuro' : null]);
  const perms = () => (db.role ? ROLE_PERMS[db.role] : {});
  const canCfg = () => db.admin || 'agenda.configurar' in perms();
  const canTeam = () => db.admin || 'equipe.gerenciar' in perms();
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const rest = url.pathname.replace('/rest/v1/', '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    log.push({ path: rest, body, q: url.searchParams });
    const fn = rest.replace('rpc/', '');
    if (db.once[fn]) { const r = db.once[fn]; delete db.once[fn]; return json(route, r); }
    const cfg = db.cfg;
    switch (rest) {
      case 'rpc/is_imed_admin': return json(route, db.admin);
      case 'rpc/agenda_me': return json(route, { status: 'ok', user_id: USER, clinics: db.role ? [{ clinic_id: C1, name: CLINIC.name, role: db.role, timezone: cfg.unit.timezone, agenda_mode: cfg.unit.agenda_mode, agenda_active: cfg.active, online: false, permissions: ROLE_PERMS[db.role] }] : [], imed: { admin: db.admin, permissions: [] } });
      case 'rpc/agenda_my_invites': return json(route, { status: 'ok', invites: db.myInvites });
      case 'rpc/agenda_invite_accept': { const i = db.myInvites.find((x) => x.id === body.p_id); if (!i) return json(route, { status: 'not_found' }); db.myInvites = []; db.role = i.role; return json(route, { status: 'ok', clinic_id: C1, role: i.role }); }
      case 'clinics': return json(route, db.role || db.admin ? filt([CLINIC], url.searchParams) : []);
      case 'clinic_exams': return json(route, filt(db.exams, url.searchParams));
      case 'clinic_blocks': return json(route, db.blocks);
      case 'appointment_requests': return json(route, []);
      case 'rpc/agenda_config': return json(route, canCfg() ? { status: 'ok', clinic_id: C1, ...clone(cfg) } : { status: 'forbidden' });
      case 'rpc/agenda_unit_save': {
        if (!canCfg()) return json(route, { status: 'forbidden' });
        const s = body.p_settings;
        if (!cfg.active) { cfg.active = true; Object.assign(cfg.unit, UNIT_SET, { updated_at: NOW }); }
        for (const k of Object.keys(UNIT_SET)) if (k in s) cfg.unit[k] = s[k];
        if ('holidays_checked_until' in s) cfg.unit.holidays_checked_until = s.holidays_checked_until;
        if (s.timezone) cfg.unit.timezone = s.timezone;
        if (s.confirm_timezone) cfg.unit.timezone_confirmed_at = NOW;
        return json(route, { status: 'ok', conflicts: 0 });
      }
      case 'rpc/agenda_resource_save': {
        if (!cfg.active) return json(route, { status: 'agenda_not_started' });
        const r = body.p_resource;
        if (r.id) {
          const cur = cfg.resources.find((x) => x.id === r.id);
          if (!cur) return json(route, { status: 'not_found' });
          if (r.archived) { cfg.resources = cfg.resources.filter((x) => x.id !== r.id); return json(route, { status: 'ok', id: r.id, conflicts: 0 }); }
          Object.assign(cur, r);
          return json(route, { status: 'ok', id: r.id, conflicts: 0 });
        }
        if (cfg.resources.some((x) => x.name.toLowerCase() === r.name.toLowerCase())) return json(route, { status: 'duplicate_name' });
        const n = { id: nid('rsrcrsrc'), capacity: 1, setup_min: 0, cleanup_min: 0, member_user_id: null, council: null, council_number: null, active: true, ...r };
        cfg.resources.push(n);
        return json(route, { status: 'ok', id: n.id, conflicts: 0 });
      }
      case 'rpc/agenda_procedure_save': {
        if (!cfg.active) return json(route, { status: 'agenda_not_started' });
        const p = body.p_proc;
        const reqs = (p.requirements || []).map((g, i) => ({ group_no: i + 1, resource_kind: g.resource_kind, offset_min: 0, duration_min: null, align_min: null, label: null, options: g.options.map((o) => ({ resource_id: o.resource_id, priority: 1 })) }));
        if (p.id) {
          const cur = cfg.procedures.find((x) => x.id === p.id);
          if (p.archived) { cfg.procedures = cfg.procedures.filter((x) => x.id !== p.id); return json(route, { status: 'ok', id: p.id }); }
          Object.assign(cur, p, p.requirements ? { requirements: reqs } : {});
          return json(route, { status: 'ok', id: p.id, conflicts: 0 });
        }
        const n = { id: nid('procproc'), step_min: null, price_cents: null, price_confirmed_at: null, patient_prep_text: null, fasting_hours: null, min_notice_min: null, max_advance_days: null, online_booking: true, default_for_exam: false, active: true, ...p, requirements: reqs };
        delete n.price_confirmed;
        cfg.procedures.push(n);
        return json(route, { status: 'ok', id: n.id, conflicts: 0 });
      }
      case 'rpc/agenda_rules_set': {
        if (!cfg.active) return json(route, { status: 'agenda_not_started' });
        cfg.rules = [...cfg.rules.filter((x) => x.resource_id), ...body.p_rules.map((x) => ({ resource_id: null, valid_from: null, valid_to: null, label: null, procedure_ids: [], ...x }))];
        return json(route, { status: 'ok', rules: body.p_rules.length, conflicts: 0 });
      }
      case 'rpc/agenda_mode_set': {
        if (!canCfg()) return json(route, { status: 'forbidden' });
        const m = body.p_mode;
        if (m !== 'pedido' && !cfg.active) return json(route, { status: 'agenda_not_started' });
        if (m !== 'pedido' && !cfg.unit.timezone_confirmed_at) return json(route, { status: 'timezone_not_confirmed' });
        if (m === 'manual' && !body.p_commitment) return json(route, { status: 'commitment_required' });
        cfg.unit.agenda_mode = m; cfg.unit.manual_commitment_at = m === 'manual' ? NOW : null;
        return json(route, { status: 'ok', mode: m });
      }
      case 'rpc/agenda_slots': return json(route, db.slots);
      case 'rpc/agenda_team': return json(route, canTeam() ? { status: 'ok', members: db.members, invites: db.invites } : { status: 'forbidden' });
      case 'rpc/agenda_invite': {
        if (body.p_role === 'owner' && db.role === 'manager') return json(route, { status: 'forbidden' });
        if (db.members.some((m) => m.email === body.p_email)) return json(route, { status: 'already_member' });
        const id = nid('invinvin');
        db.invites.push({ id, email: body.p_email, role: body.p_role, created_at: NOW, expires_at: '2026-11-11T13:00:00Z' });
        return json(route, { status: 'ok', id });
      }
      case 'rpc/agenda_invite_cancel': db.invites = db.invites.filter((i) => i.id !== body.p_id); return json(route, { status: 'ok' });
      case 'rpc/agenda_member_role': {
        const m = db.members.find((x) => x.user_id === body.p_user);
        if (m.role === 'owner' && db.members.filter((x) => x.role === 'owner').length <= 1 && body.p_role !== 'owner') return json(route, { status: 'last_owner' });
        if (m.role === body.p_role) return json(route, { status: 'ok', unchanged: true });
        m.role = body.p_role; return json(route, { status: 'ok' });
      }
      case 'rpc/agenda_member_remove': db.members = db.members.filter((x) => x.user_id !== body.p_user); return json(route, { status: 'ok' });
      case 'rpc/add_my_block': db.blocks.push({ id: nid('bbbbbbbb'), clinic_id: C1, starts_at: body.p_starts, ends_at: body.p_ends, reason: body.p_reason }); return json(route, 'ok');
      // avisos e lembretes (5.3): só quando o cenário liga (db.notify); sem isso é o banco de antes (404)
      case 'rpc/agenda_notify_config':
        if (!db.notify) return json(route, { message: 'não simulado: banco sem os avisos' }, 404);
        return json(route, canCfg() ? { status: 'ok', sending: db.notify.sending, clinic_email: db.notify.clinic_email, rules: clone(db.notify.rules) } : { status: 'forbidden' });
      case 'rpc/agenda_notify_config_set': {
        if (!db.notify) return json(route, { message: 'não simulado: banco sem os avisos' }, 404);
        if (!canCfg()) return json(route, { status: 'forbidden' });
        let changed = 0;
        for (const x of body.p_rules) { const r = db.notify.rules.find((y) => y.event_type === x.event_type && y.recipient_kind === x.recipient_kind); if (r && r.enabled !== x.enabled) { r.enabled = x.enabled; changed += 1; } }
        return json(route, { status: 'ok', changed });
      }
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
const shot = async (page, name, path = '') => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  if (path) await page.screenshot({ path, fullPage: true });
};
const noOverflow = async (page) => {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const vw = page.viewportSize().width;
  assert.ok(sw <= vw, `sem rolagem lateral (conteúdo ${sw}px, aparelho ${vw}px)`);
};
const focusId = (page) => page.evaluate(() => document.activeElement?.id || '');

// Relógio fixo: a página não pode tropeçar se o dia mudar.
const results = [];
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
async function scenario(name, fn) {
  const t = new Promise((_, f) => { const x = setTimeout(() => f(new Error(`passou de ${LIMITE_MS / 1000} s: ${name}`)), LIMITE_MS); x.unref?.(); });
  try { await Promise.race([comChaves(fn), t]); results.push(['ok', name]); console.log(`ok  ${name}`); } catch (e) { results.push(['FALHOU', name]); console.log(`FALHOU  ${name}\n   ${e.stack}`); }
}
const browser = vigiarChaves(await chromium.launch());

await scenario('computador (1024 px): configuração rápida pelo teclado, com erros, e a agenda ativa', async () => {
  const { page, log, errors, context, db } = await newPage(browser);
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-pedidos');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Pedidos|Agenda|Configurar agenda|Dados da clínica|Exames e preços|Equipe');
  assert.match(await page.textContent('#clinicTitle + p'), /Seu papel: Dono\(a\)/);
  assert.equal(calls(log, 'agenda_me').length, 1, 'quem sou vem de agenda_me');
  assert.equal(log.filter((e) => e.path === 'clinic_members').length, 0, 'sem ler clinic_members de todo mundo');
  // abas pelo teclado
  // (fase 4.2: a configuração saiu da aba Agenda e foi para "Configurar agenda")
  await page.focus('#tab-pedidos');
  await page.keyboard.press('ArrowRight');
  assert.equal(await focusId(page), 'tab-agenda');
  await page.keyboard.press('ArrowRight');
  assert.equal(await focusId(page), 'tab-config');
  await page.waitForSelector('#qcForm');
  assert.equal(await page.isVisible('#agSave'), false, 'o editor antigo de faixas saiu');
  assert.equal(calls(log, 'set_my_schedule').length, 0);
  // exames que a clínica já marca em "Exames e preços" vêm preenchidos (tipo e nome), sem duração nem quantidade inventadas
  assert.equal(await page.inputValue('#qx0code'), 'usg');
  assert.equal(await page.inputValue('#qx0name'), 'Ultrassom');
  assert.equal(await page.inputValue('#qx0dur'), '');
  assert.equal(await page.inputValue('#qx0count'), '');
  assert.equal(await page.inputValue('#qcOpen'), '', 'sem horário de exemplo');
  // enviar vazio: erros e foco no primeiro campo com erro
  await page.click('#qcSave');
  assert.match(await page.textContent('#qcConfirmTzErr'), /Confirme o fuso/);
  assert.match(await page.textContent('#qcDaysErr'), /pelo menos um dia/);
  assert.match(await page.textContent('#qx0durErr'), /quanto dura/);
  assert.equal(await focusId(page), 'qcConfirmTz');
  assert.equal(calls(log, 'agenda_unit_save').length, 0);
  await shot(page, 'ac-01-rapida-erros');
  // pelo teclado: confirma o fuso, marca seg a sex, horário e pausa
  await page.keyboard.press('Space');
  for (const d of [1, 2, 3, 4, 5]) { await page.focus(`input[name=qcDay][value="${d}"]`); await page.keyboard.press('Space'); }
  // (campo de hora: o Chromium sem tela não aceita digitação de hora; o valor vai direto)
  await page.fill('#qcOpen', '07:00'); await page.fill('#qcClose', '18:00');
  await page.fill('#qcPauseFrom', '12:00'); await page.fill('#qcPauseTo', '11:00');
  await page.focus('#qx0count'); await page.keyboard.type('2');
  await page.focus('#qx0dur'); await page.keyboard.type('20');
  await page.selectOption('#qx1kind', 'sala');
  await page.fill('#qx1count', '1'); await page.fill('#qx1dur', '15');
  await page.focus('#qcSave'); await page.keyboard.press('Enter');
  assert.match(await page.textContent('#qcPauseErr'), /fim da pausa precisa ser depois/);
  await page.fill('#qcPauseTo', '13:00');
  // terceiro exame e remover
  await page.click('#qcAdd');
  assert.equal(await focusId(page), 'qx2code');
  await page.click('[data-qrm="2"]');
  assert.equal(await page.locator('.ac-qrow').count(), 2);
  await page.click('#qcSave');
  await page.waitForSelector('#acTitle');
  assert.match(await page.textContent('#acTopMsg'), /Agenda ativada\. A marcação pelo site continua desligada/);
  assert.equal(await focusId(page), 'acTitle');
  // o que foi ao banco, na ordem
  const order = log.filter((e) => /^rpc\/agenda_(unit|resource|procedure|rules)/.test(e.path)).map((e) => e.path.replace('rpc/agenda_', ''));
  assert.deepEqual(order, ['unit_save', 'resource_save', 'resource_save', 'resource_save', 'procedure_save', 'procedure_save', 'rules_set']);
  assert.deepEqual(calls(log, 'agenda_unit_save')[0].body, { p_clinic: C1, p_settings: { timezone: 'America/Sao_Paulo', confirm_timezone: true }, p_confirm: false });
  assert.deepEqual(calls(log, 'agenda_resource_save').map((e) => e.body.p_resource), [
    { kind: 'equipamento', name: 'Aparelho de Ultrassom 1' }, { kind: 'equipamento', name: 'Aparelho de Ultrassom 2' }, { kind: 'sala', name: 'Sala de Raio-X' }]);
  const p0 = calls(log, 'agenda_procedure_save')[0].body.p_proc;
  const usgIds = db.cfg.resources.filter((r) => r.kind === 'equipamento').map((r) => ({ resource_id: r.id }));
  assert.deepEqual(p0, { exam_code: 'usg', name: 'Ultrassom', duration_min: 20, requirements: [{ resource_kind: 'equipamento', options: usgIds }] });
  assert.equal(usgIds.length, 2);
  const rules = calls(log, 'agenda_rules_set')[0].body;
  assert.equal(rules.p_resource, null);
  assert.equal(rules.p_rules.length, 10);
  assert.deepEqual(rules.p_rules[0], { weekday: 1, start: '07:00', end: '18:00', kind: 'abre' });
  assert.deepEqual(rules.p_rules[5], { weekday: 1, start: '12:00', end: '13:00', kind: 'pausa', label: 'Pausa' });
  // a tela ativa mostra o que o banco devolveu
  assert.match(await page.textContent('.ac-sum'), /Pedido \(a clínica liga para combinar\)/);
  assert.match(await page.textContent('.ac-sum'), /Horário de Brasília .* confirmado/);
  assert.match(await page.textContent('.ac-sum'), /Segunda: 07:00 às 18:00/);
  assert.equal(await page.locator('#resList li').count(), 3);
  assert.match(await page.textContent('#procList'), /Ultrassom[\s\S]*20 min · sob consulta · Aparelho de Ultrassom 1 ou Aparelho de Ultrassom 2/);
  await noOverflow(page);
  await shot(page, 'ac-02-ativa', process.env.CAPTURA_COMPUTADOR || '');
  assert.deepEqual(errors, []);
  await context.close();
});

const ACTIVE = () => {
  const r1 = 'rsrcrsrc-0000-4000-8000-0000000000a1';
  const r2 = 'rsrcrsrc-0000-4000-8000-0000000000a2';
  return {
    active: true, old_schedule_exists: false,
    unit: { ...unitDefaults(), ...UNIT_SET, timezone_confirmed_at: '2026-11-03T12:00:00Z', updated_at: '2026-11-03T12:00:00Z' },
    resources: [{ id: r1, kind: 'equipamento', name: 'Aparelho de Ultrassom 1', capacity: 1, setup_min: 0, cleanup_min: 5, member_user_id: null, council: null, council_number: null, active: true },
      { id: r2, kind: 'sala', name: 'Sala de Raio-X', capacity: 1, setup_min: 0, cleanup_min: 0, member_user_id: null, council: null, council_number: null, active: true }],
    procedures: [{ id: 'procproc-0000-4000-8000-0000000000b1', exam_code: 'usg', name: 'Ultrassom', duration_min: 20, step_min: null, price_cents: null, price_confirmed_at: null,
      patient_prep_text: null, fasting_hours: null, min_notice_min: null, max_advance_days: null, online_booking: true, default_for_exam: false, active: true,
      requirements: [{ group_no: 1, resource_kind: 'equipamento', offset_min: 0, duration_min: null, align_min: null, label: null, options: [{ resource_id: r1, priority: 1 }] }] }],
    rules: [{ resource_id: null, weekday: 1, start: '08:00', end: '12:00', kind: 'abre', valid_from: null, valid_to: null, label: null, procedure_ids: [] }],
    pair_rules: [], holiday_openings: [],
  };
};

await scenario('computador: unidade (afeta agendamentos → salvar mesmo assim), modalidade com compromisso, horários, cadastros e conferência', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { db: { cfg: ACTIVE(), slots: [{ slot_start: '2026-11-05T11:00:00Z', slot_end: '2026-11-05T11:20:00Z' }, { slot_start: '2026-11-05T11:20:00Z', slot_end: '2026-11-05T11:40:00Z' }] } });
  await page.goto(`${BASE}painel.html`);
  await page.click('#tab-config');
  await page.waitForSelector('#unitForm');
  // unidade
  assert.equal(await page.inputValue('#uNotice'), '2');
  await page.fill('#uAdvance', '400');
  await page.click('#uSave');
  assert.match(await page.textContent('#uAdvanceErr'), /De 1 a 365 dias/);
  assert.equal(await focusId(page), 'uAdvance');
  await page.fill('#uAdvance', '60');
  await page.selectOption('#uStep', '10');
  db.once.agenda_unit_save = { status: 'affects_appointments', items: [{ item_id: 'x', starts_at: '2026-11-05T11:00:00Z' }] };
  await page.click('#uSave');
  await page.waitForSelector('[data-force="unit"]');
  assert.match(await page.textContent('#uMsg'), /1 agendamento futuro deixaria de caber nesta mudança\. Se salvar mesmo assim, esses pacientes vão para a lista de conflitos/);
  assert.equal(await focusId(page), '', 'foco no botão (sem id)');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.force), 'unit');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Unidade salva/.test(document.querySelector('#uMsg')?.textContent || ''));
  const us = calls(log, 'agenda_unit_save');
  assert.equal(us.length, 2);
  assert.deepEqual(us[1].body, { p_clinic: C1, p_settings: { step_min: 10, min_notice_min: 120, max_advance_days: 60, holidays_checked_until: null, closes_on_holidays: true }, p_confirm: true });
  // modalidade
  await page.check('input[name=acMode][value=manual]');
  assert.equal(await page.isVisible('#acCommit'), true);
  await page.click('#modeSave');
  assert.match(await page.textContent('#acCommitErr'), /marque o compromisso/);
  assert.equal(await focusId(page), 'acCommit');
  await page.keyboard.press('Space');
  await page.click('#modeSave');
  await page.waitForFunction(() => /Modalidade salva: Agenda no IMED, com registro manual/.test(document.querySelector('#modeMsg')?.textContent || ''));
  assert.deepEqual(calls(log, 'agenda_mode_set')[0].body, { p_clinic: C1, p_mode: 'manual', p_commitment: true });
  assert.match(await page.textContent('.ac-sum'), /com registro manual/);
  // horários: pausa na segunda, cruzamento, copiar segunda
  await page.click('[data-hadd="1-pause"]');
  assert.equal(await focusId(page), 'hr-1-pause-0s');
  await page.fill('#hr-1-pause-0s', '10:00'); await page.fill('#hr-1-pause-0f', '10:15');
  await page.click('[data-hadd="1-open"]');
  await page.fill('#hr-1-open-1s', '11:00'); await page.fill('#hr-1-open-1f', '14:00');
  assert.match(await page.textContent('#hrDirty'), /mudanças ainda não salvas/);
  await page.click('#hrSave');
  assert.match(await page.textContent('#hr-1-open-1e'), /Cruza com 08:00 às 12:00/);
  assert.equal(await focusId(page), 'hr-1-open-1s');
  await page.fill('#hr-1-open-1s', '13:00');
  await page.click('#hrCopy');
  assert.match(await page.textContent('#hrCopyMsg'), /terça a sexta agora têm o mesmo horário de segunda/);
  await page.click('#hrSave');
  await page.waitForFunction(() => /Horários salvos/.test(document.querySelector('#hrMsg')?.textContent || ''));
  const rs = calls(log, 'agenda_rules_set')[0].body.p_rules;
  assert.equal(rs.filter((r) => r.kind === 'abre').length, 10);
  assert.deepEqual(rs.find((r) => r.kind === 'pausa' && r.weekday === 3), { weekday: 3, start: '10:00', end: '10:15', kind: 'pausa' });
  assert.match(await page.textContent('#hrday-5'), /08:00–12:00, 13:00–14:00/);
  // aparelho, sala ou profissional novo
  await page.click('#resNew');
  assert.equal(await focusId(page), 'rKind');
  await page.selectOption('#rKind', 'profissional');
  assert.equal(await page.isVisible('#rCouncil'), true);
  await page.fill('#rName', 'X');
  await page.fill('#rClean', '7');
  await page.click('#rSave');
  assert.match(await page.textContent('#rNameErr'), /Dê um nome/);
  assert.match(await page.textContent('#rCleanErr'), /de 5 em 5/);
  await page.fill('#rName', 'Dra. Teste'); await page.fill('#rClean', '10'); await page.selectOption('#rCouncil', 'CRM');
  await page.click('#rSave');
  await page.waitForFunction(() => /Dra\. Teste salvo/.test(document.querySelector('#resMsg')?.textContent || ''));
  const rnew = calls(log, 'agenda_resource_save')[0].body.p_resource;
  assert.deepEqual(rnew, { name: 'Dra. Teste', capacity: 1, setup_min: 0, cleanup_min: 10, active: true, kind: 'profissional', member_user_id: null, council: 'CRM', council_number: null });
  const rid = db.cfg.resources.find((r) => r.name === 'Dra. Teste').id;
  assert.equal(await page.evaluate(() => document.activeElement.dataset.redit), rid, 'foco volta para o Editar do item salvo');
  // excluir com confirmação
  await page.click(`[data-redit="${rid}"]`);
  await page.click('#rArchive');
  assert.equal(await focusId(page), 'rArchiveYes');
  await page.click('#rArchiveNo');
  assert.equal(await focusId(page), 'rArchive');
  await page.click('#rArchive'); await page.click('#rArchiveYes');
  await page.waitForFunction(() => /saiu da agenda/.test(document.querySelector('#resMsg')?.textContent || ''));
  assert.deepEqual(calls(log, 'agenda_resource_save')[1].body.p_resource, { id: rid, archived: true });
  // exame novo com preço fora do normal (L11) e dois grupos
  await page.click('#procNew');
  await page.selectOption('#pCode', 'rx');
  await page.fill('#pName', 'Raio-X de tórax');
  await page.fill('#pDur', '15');
  await page.fill('#pPrice', '9.000,00');
  await page.selectOption('#pg0kind', 'sala');
  await page.click('#pSave');
  assert.match(await page.textContent('#pg0Err'), /Marque pelo menos um/);
  await page.check('input[data-go="0"]');
  await page.click('#pgAdd');
  assert.equal(await focusId(page), 'pg1kind');
  await page.check('input[data-go="1"]');
  await page.click('#pSave');
  await page.waitForSelector('#pPriceYes');
  assert.match(await page.textContent('#pPriceCheck'), /Confira o valor: R\$\s?9\.000,00 para Raio-X está certo\?/);
  assert.equal(await focusId(page), 'pPriceYes');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Raio-X de tórax salvo/.test(document.querySelector('#procMsg')?.textContent || ''));
  const pp = calls(log, 'agenda_procedure_save')[0].body.p_proc;
  assert.equal(pp.price_cents, 900000);
  assert.equal(pp.price_confirmed, true);
  assert.deepEqual(pp.requirements.map((g) => g.resource_kind), ['sala', 'equipamento']);
  // conferir horários livres (no fuso da clínica)
  await page.selectOption('#pvProc', { label: 'Ultrassom' });
  await page.click('#pvGo');
  await page.waitForSelector('.ag-slots li');
  assert.deepEqual(await page.$$eval('.ag-slots li', (l) => l.map((x) => x.textContent)), ['08:00', '08:20']);
  const sl = calls(log, 'agenda_slots')[0].body;
  assert.deepEqual(sl, { p_clinic: C1, p_procedure: 'procproc-0000-4000-8000-0000000000b1', p_from: '2026-11-04', p_to: '2026-11-10' });
  await noOverflow(page);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('equipe: convidar, trocar papel, último dono protegido, tirar com confirmação e cancelar convite', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { db: { members: [
    { user_id: USER, email: 'dona@exemplo.test', role: 'owner', created_at: NOW, me: true },
    { user_id: 'uuuuuuuu-0000-4000-8000-000000000002', email: 'recepcao@exemplo.test', role: 'reception', created_at: NOW, me: false }] } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-equipe');
  await page.focus('#tab-pedidos');
  await page.keyboard.press('End');
  assert.equal(await focusId(page), 'tab-equipe');
  await page.waitForSelector('#tmMembers');
  assert.equal(await page.isDisabled(`#tmRole-${USER}`), true, 'a única dona não muda de papel');
  assert.match(await page.textContent('#tmLast'), /pelo menos um\(a\) dono\(a\)/);
  // convite
  await page.fill('#invEmail', 'errado');
  await page.click('#invSave');
  assert.match(await page.textContent('#invEmailErr'), /e-mail válido/);
  assert.match(await page.textContent('#invRoleErr'), /Escolha o papel/);
  assert.equal(await focusId(page), 'invEmail');
  await page.fill('#invEmail', ' Nova.Pessoa@Exemplo.test ');
  await page.selectOption('#invRole', 'professional');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Convite criado para nova\.pessoa@exemplo\.test \(Profissional\)/.test(document.querySelector('#tmMsg')?.textContent || ''));
  assert.match(await page.textContent('#tmMsg'), /O IMED ainda não manda o convite por e-mail/);
  assert.deepEqual(calls(log, 'agenda_invite')[0].body, { p_clinic: C1, p_email: 'nova.pessoa@exemplo.test', p_role: 'professional' });
  assert.match(await page.textContent('#tmInvites'), /nova\.pessoa@exemplo\.test\s*Profissional/);
  // trocar papel
  await page.selectOption('#tmRole-uuuuuuuu-0000-4000-8000-000000000002', 'manager');
  await page.click('[data-role-save="uuuuuuuu-0000-4000-8000-000000000002"]');
  await page.waitForFunction(() => /recepcao@exemplo\.test agora é Gestor\(a\)/.test(document.querySelector('#tmMsg')?.textContent || ''));
  // tirar da equipe (com confirmação; "Não" volta o foco)
  await page.click('[data-mrm="uuuuuuuu-0000-4000-8000-000000000002"]');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.mrmYes), 'uuuuuuuu-0000-4000-8000-000000000002');
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.mrm), 'uuuuuuuu-0000-4000-8000-000000000002');
  await page.click('[data-mrm="uuuuuuuu-0000-4000-8000-000000000002"]');
  await page.click('[data-mrm-yes="uuuuuuuu-0000-4000-8000-000000000002"]');
  await page.waitForFunction(() => /não faz mais parte da equipe/.test(document.querySelector('#tmMsg')?.textContent || ''));
  assert.equal(await page.locator('#tmMembers > li').count(), 1);
  // cancelar convite
  await page.click('[data-inv-cancel]');
  await page.waitForFunction(() => /cancelado/.test(document.querySelector('#tmMsg')?.textContent || ''));
  assert.equal(db.invites.length, 0);
  assert.match(await page.textContent('#rolesTitle + dl'), /Recepção.*Vê os pedidos/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('gestor não dá papel de dono; recepção sem "Configurar agenda"; profissional só com a Agenda', async () => {
  let { page, log, errors, context } = await newPage(browser, { role: 'manager' });
  await page.goto(`${BASE}painel.html`);
  await page.click('#tab-equipe');
  await page.waitForSelector('#invRole');
  assert.deepEqual(await page.$$eval('#invRole option', (o) => o.map((x) => x.value)), ['', 'manager', 'reception', 'professional', 'finance']);
  assert.deepEqual(errors, []);
  await context.close();
  ({ page, log, errors, context } = await newPage(browser, { role: 'reception' }));
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-pedidos');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Pedidos|Agenda');
  await page.click('#tab-agenda');
  await page.waitForSelector('#agRoot');
  assert.equal(calls(log, 'agenda_config').length, 0, 'a recepção não pede a configuração');
  assert.equal(await page.locator('#acBox, #tab-config').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
  // fase 4.2: o profissional vê só a aba Agenda (a coluna dele; e2e-agenda)
  ({ page, log, errors, context } = await newPage(browser, { role: 'professional' }));
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#tab-agenda');
  assert.equal(await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent).join('|')), 'Agenda');
  assert.equal(await page.locator('#noTabs').count(), 0);
  assert.equal(calls(log, 'agenda_config').length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('convite para quem ainda não é da equipe: aceitar abre a clínica', async () => {
  const { page, log, errors, context } = await newPage(browser, { role: null, email: 'nova@exemplo.test', db: { myInvites: [{ id: 'invinvin-0000-4000-8000-000000000009', clinic_id: C1, clinic_name: 'Clínica Teste da Agenda', role: 'reception', expires_at: '2026-11-10T13:00:00Z' }] } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#myInvites');
  assert.match(await page.textContent('#myInvites'), /Clínica Teste da Agenda convidou você como Recepção/);
  assert.equal(await page.locator('#goClaim').count(), 0);
  await page.focus('[data-accept]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tab-pedidos');
  assert.deepEqual(calls(log, 'agenda_invite_accept')[0].body, { p_id: 'invinvin-0000-4000-8000-000000000009' });
  assert.equal(await page.locator('#myInvites').count(), 0);
  assert.match(await page.textContent('#clinicTitle + p'), /Seu papel: Recepção/);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (390 px): configuração rápida e ativa, equipe, sem rolagem lateral; tema escuro', async () => {
  let { page, errors, context } = await newPage(browser, { mobile: true });
  await page.goto(`${BASE}painel.html`);
  await page.click('#tab-config');
  await page.waitForSelector('#qcForm');
  await noOverflow(page);
  await shot(page, 'ac-10-celular-rapida');
  assert.deepEqual(errors, []);
  await context.close();
  ({ page, errors, context } = await newPage(browser, { mobile: true, db: { cfg: ACTIVE() } }));
  await page.goto(`${BASE}painel.html`);
  await page.click('#tab-config');
  await page.waitForSelector('#hrForm');
  await page.click('[data-hadd="1-pause"]');
  await page.click('#procNew');
  await noOverflow(page);
  await shot(page, 'ac-11-celular-ativa', process.env.CAPTURA_CELULAR || '');
  await page.click('#tab-equipe');
  await page.waitForSelector('#invForm');
  await noOverflow(page);
  assert.deepEqual(errors, []);
  await context.close();
  // tema escuro: cartões e campos com as cores do tema (sem fundo branco)
  ({ page, errors, context } = await newPage(browser, { theme: 'dark', db: { cfg: ACTIVE() } }));
  await page.goto(`${BASE}painel.html`);
  await page.click('#tab-config');
  await page.waitForSelector('#resList');
  await page.click('#resNew');
  const bg = await page.evaluate(() => [getComputedStyle(document.querySelector('.ac-form')).backgroundColor, getComputedStyle(document.querySelector('.ac-sum')).backgroundColor, getComputedStyle(document.querySelector('#rName')).backgroundColor]);
  for (const c of bg) assert.notEqual(c, 'rgb(255, 255, 255)', `fundo escuro (${bg.join(', ')})`);
  await shot(page, 'ac-12-escuro');
  assert.deepEqual(errors, []);
  await context.close();
});

// iMed Agenda 5.3: as escolhas de avisos e lembretes da clínica. A tela nunca diz que algo é enviado com o envio desligado.
const NOTIFY = (o = {}) => ({ sending: false, clinic_email: true, rules: [
  { event_type: 'lembrete_24h', recipient_kind: 'paciente', channel: 'email', enabled: true },
  { event_type: 'lembrete_2h', recipient_kind: 'paciente', channel: 'email', enabled: true },
  { event_type: 'confirmado', recipient_kind: 'clinica', channel: 'email', enabled: true },
  { event_type: 'cancelado', recipient_kind: 'clinica', channel: 'email', enabled: true }], ...o });

await scenario('avisos e lembretes (5.3): escolhas pelo teclado, envio desligado dito com todas as letras, clínica sem e-mail, erro e banco de antes', async () => {
  let { page, log, db, errors, context } = await newPage(browser, { db: { cfg: ACTIVE(), notify: NOTIFY({ clinic_email: false }) } });
  await page.goto(`${BASE}painel.html`);
  await page.click('#tab-config');
  await page.waitForSelector('#ntForm');
  assert.equal(await page.locator('.ac-toc a[href="#acNtT"]').textContent(), 'Avisos e lembretes', 'a parte entra no índice da configuração');
  const sec = page.locator('section[aria-labelledby="acNtT"]');
  assert.match(await sec.textContent(), /O envio de avisos ainda não está ligado pelo IMED: hoje nenhum aviso é enviado\./);
  assert.match(await sec.textContent(), /A clínica não tem e-mail no cadastro\./);
  assert.match(await sec.textContent(), /o paciente que informou e-mail sempre recebe: confirmação, cancelamento, remarcação e o aviso de que a clínica precisou alterar o horário/);
  assert.match(await sec.textContent(), /não leva o nome do exame nem o preparo/);
  assert.deepEqual(await page.locator('#ntForm legend').allTextContents(), ['Para o paciente (por e-mail)', 'Para a clínica (por e-mail)']);
  assert.deepEqual(await page.locator('#ntForm input[type="checkbox"]').evaluateAll((els) => els.map((e) => [e.dataset.nt, e.checked, !!document.getElementById(e.getAttribute('aria-describedby'))?.textContent, e.closest('label').textContent.trim().length > 10])),
    [['lembrete_24h|paciente', true, true, true], ['lembrete_2h|paciente', true, true, true], ['confirmado|clinica', true, true, true], ['cancelado|clinica', true, true, true]]);
  // pelo teclado: desmarca o lembrete de 2 h e salva com Enter no botão
  await page.focus('#nt-lembrete_2h-paciente');
  await page.keyboard.press('Space');
  await page.focus('#ntSave');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Avisos salvos\./.test(document.querySelector('#ntMsg')?.textContent || ''));
  assert.deepEqual(calls(log, 'agenda_notify_config_set').at(-1).body, { p_clinic: C1, p_rules: [
    { event_type: 'lembrete_24h', recipient_kind: 'paciente', enabled: true }, { event_type: 'lembrete_2h', recipient_kind: 'paciente', enabled: false },
    { event_type: 'confirmado', recipient_kind: 'clinica', enabled: true }, { event_type: 'cancelado', recipient_kind: 'clinica', enabled: true }] });
  assert.equal(await focusId(page), 'ntSave', 'o foco volta para o botão');
  assert.equal(await page.isChecked('#nt-lembrete_2h-paciente'), false, 'a tela mostra o que o banco gravou');
  assert.equal(db.notify.rules[1].enabled, false);
  // salvar de novo sem mudar nada: a tela diz que nada mudou
  await page.click('#ntSave');
  await page.waitForFunction(() => /Nada mudou/.test(document.querySelector('#ntMsg')?.textContent || ''));
  // o banco recusa: a mensagem aparece e nada some da tela
  db.once.agenda_notify_config_set = { status: 'forbidden' };
  await page.check('#nt-lembrete_2h-paciente');
  await page.click('#ntSave');
  await page.waitForSelector('#ntMsg .cl-msg.err, #ntMsg [class*="err"]');
  assert.equal(await page.isChecked('#nt-lembrete_2h-paciente'), true, 'a escolha que a pessoa fez continua na tela para tentar de novo');
  assert.equal(await page.isEnabled('#ntSave'), true);
  await shot(page, 'ac-13-avisos');
  assert.deepEqual(errors, []);
  await context.close();

  // envio ligado e clínica com e-mail: sem o aviso de desligado e sem o de e-mail faltando
  ({ page, errors, context } = await newPage(browser, { db: { cfg: ACTIVE(), notify: NOTIFY({ sending: true }) } }));
  await page.goto(`${BASE}painel.html`);
  await page.click('#tab-config');
  await page.waitForSelector('#ntForm');
  const ligado = await page.locator('section[aria-labelledby="acNtT"]').textContent();
  assert.match(ligado, /O envio por e-mail está ligado\./);
  assert.doesNotMatch(ligado, /ainda não está ligado|não tem e-mail no cadastro/);
  assert.deepEqual(errors, []);
  await context.close();

  // banco de antes (sem as funções dos avisos): a configuração abre igual, sem a parte e sem o item do índice
  ({ page, log, errors, context } = await newPage(browser, { db: { cfg: ACTIVE() } }));
  await page.goto(`${BASE}painel.html`);
  await page.click('#tab-config');
  await page.waitForSelector('#hrForm');
  assert.equal(await page.locator('#ntForm, .ac-toc a[href="#acNtT"]').count(), 0);
  assert.equal(calls(log, 'agenda_notify_config').length, 1, 'perguntou uma vez e seguiu sem');
  assert.deepEqual(errors, []);
  await context.close();

  // celular de 360 px e tema escuro: sem rolagem lateral, alvos de toque de 44 px, fundo do tema
  ({ page, errors, context } = await newPage(browser, { mobile: true, theme: 'dark', db: { cfg: ACTIVE(), notify: NOTIFY({ clinic_email: false }) } }));
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`${BASE}painel.html`);
  await page.click('#tab-config');
  await page.waitForSelector('#ntForm');
  await page.locator('#ntForm').scrollIntoViewIfNeeded();
  await noOverflow(page);
  const alvos = await page.locator('#ntForm label.ac-nt, #ntSave').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  assert.ok(alvos.every((h) => h >= 44), `alvos de toque com 44 px ou mais (${alvos})`);
  const fundo = await page.evaluate(() => getComputedStyle(document.querySelector('label.ac-nt')).backgroundColor);
  assert.notEqual(fundo, 'rgb(255, 255, 255)', 'cartão com a cor do tema escuro');
  await shot(page, 'ac-14-avisos-celular-escuro');
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const bad = results.filter(([r]) => r !== 'ok');
console.log(`\n${results.length - bad.length}/${results.length} cenários ok`);
if (bad.length) process.exit(1);
