// Teste de ponta a ponta dos DOCUMENTOS da teleconsulta (medico.html, teleconsulta.html e documento.html) num
// navegador de verdade (Playwright), com o Supabase simulado EM MEMÓRIA: as funções de
// supabase/migrations/*_tele_documentos.sql (com as mesmas regras) e o mínimo da teleconsulta.
// O médico emite cada tipo (só com o atendimento começado; a declaração depois de encerrar), gera o PDF (conferido aqui
// com a pdf-lib do repositório: textos, código e metadados), envia o PDF "assinado" (só o deste documento, um só),
// cancela e emite de novo; o paciente vê, completa CPF e endereço (o médico vê na hora e é avisado se mudar) e baixa o
// PDF assinado; documento.html mostra só o mínimo. Também: "Falta assinar", rascunho não emitido ao sair, bloqueios e
// alerta da receita, foco do teclado, XSS, celular 390 px e nenhum erro no console.
// Rodar com: node tests/e2e-tele-docs.mjs   (precisa do pacote "playwright" instalado)
// Opcional: TEMA=escuro (aparelho no escuro). SHOTS=pasta salva capturas; E2E_PORT muda a porta; ONLY="trecho" roda só alguns cenários.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID, randomInt } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, PUBLISHABLE, vigiarChaves } from './regra-chaves.mjs';
import { SITE } from './endereco.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const lib = await import(new URL('../assets/vendor/pdf-lib/pdf-lib.esm.min.js', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
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
const PORT = Number(process.env.E2E_PORT) || 8775;
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;

/* ======================= banco simulado ======================= */
const USERS = { 'tok-doc': { id: 'u-doc', email: 'carla@exemplo.com' }, 'tok-doc2': { id: 'u-doc2', email: 'davi@exemplo.com' } };
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
class PgErr extends Error { constructor(message, details = null, hint = null) { super(message); this.details = details; this.hint = hint; } }
const DAY = 86400e3;
const iso = (t = Date.now()) => new Date(t).toISOString();
const daySP = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const timeSP = (t) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const ageOf = (birth) => { const [by, bm, bd] = birth.split('-').map(Number); const [ty, tm, td] = daySP(Date.now()).split('-').map(Number); return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0); };
const DOCTOR_FNS = new Set(['tele_doctor_me', 'tele_set_available', 'tele_queue', 'tele_doctor_status', 'tele_offer', 'tele_mark_started', 'tele_doctor_messages', 'tele_doctor_send',
  'tele_set_exams', 'tele_end', 'tele_history', 'tele_admin_doctors', 'tele_doctor_profile', 'tele_doc_patient_data', 'tele_doc_create', 'tele_doc_cancel', 'tele_doc_list',
  'tele_doc_pending', 'tele_doc_upload', 'tele_doc_pdf', 'tele_painel_medico']);
const KINDS = ['exames', 'receita', 'atestado', 'comparecimento', 'encaminhamento', 'relatorio', 'orientacoes'];
const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function makeDb() {
  // painel: o banco já tem tele_painel_medico (senão, 404 como o PostgREST, e a área do médico segue sem o painel).
  const db = { doctors: new Map(), consults: new Map(), docs: new Map(), files: new Map(), messages: [], calls: [], accessLog: [], t: 0, delay: {}, before: {}, painel: false };
  db.addDoctor = (d) => { const row = { id: randomUUID(), rqe: null, specialty: null, phone: null, status: 'approved', checked_at: iso(Date.now() - DAY), available_until: null, prof_address: null, prof_contact: null, created_at: iso(Date.now() - DAY), ...d }; db.doctors.set(row.id, row); return row; };
  db.addConsult = (c) => {
    const row = { id: randomUUID(), token: sha(randomUUID()), status: 'in_call', patient_name: 'Ana Maria da Silva', patient_birthdate: '1980-05-17', patient_phone: '11987654321', for_other: false,
      requester_name: null, relationship: null, guardian_consent: false, patient_agrees: false, reason: 'Tosse há 5 dias', consent_version: '2026-10-30.2', consent_at: iso(), doctor_id: null, doctor_info: null,
      created_at: iso(Date.now() - 20 * 60e3), accepted_at: iso(Date.now() - 15 * 60e3), started_at: iso(Date.now() - 10 * 60e3), ended_at: null, closed_by: null, phone_call_at: null, patient_seen_at: null,
      offer_sdp: null, offer_version: 0, answer_sdp: null, answer_version: 0, exams: [], indication: null, exams_version: 0, exams_at: null, guidance: null, guidance_at: null, notes: null,
      patient_cpf: null, patient_address: null, patient_no_cpf: false, identity_checked_at: null, ...c };
    row.token_hash = sha(row.token);
    if (row.doctor_id && !row.doctor_info) { const d = db.doctors.get(row.doctor_id); row.doctor_info = { full_name: d.full_name, crm: d.crm, crm_uf: d.crm_uf, rqe: d.rqe, specialty: d.rqe ? d.specialty : null }; }
    db.consults.set(row.id, row);
    return row;
  };
  db.called = (fn) => db.calls.filter((c) => c.fn === fn);
  return db;
}
const docOf = (db, uid) => [...db.doctors.values()].find((d) => d.user_id === uid) || null;
function me(db, uid, needApproved) {
  if (!uid) throw new PgErr('sem_login');
  const d = docOf(db, uid);
  if (!d) throw new PgErr('sem_cadastro');
  if (needApproved && d.status !== 'approved') throw new PgErr('nao_aprovado');
  return d;
}
const byToken = (db, id, token) => { const c = db.consults.get(id); return c && c.token_hash === sha(token ?? '') ? c : null; };
const inWindow = (c) => ['accepted', 'in_call'].includes(c.status) || (c.status === 'ended' && Date.now() - Date.parse(c.ended_at) < DAY);
const bad = (detail, hint = null) => { throw new PgErr('dados_invalidos', detail, hint); };
const one = (v) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s || null; };
function jtext(p, key, hint = null) {
  const v = p?.[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' && typeof v !== 'number') bad(key, hint);
  return String(v).trim() || null;
}
const cpfOk = (d) => {
  if (!/^[0-9]{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i += 1) s += Number(d[i]) * (n + 1 - i); return ((s * 10) % 11) % 10; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
};
// private.tele_set_patient_details: CPF, endereço, "não possui CPF" e a conferência de identidade (desfeita se o CPF mudar).
function setPatient(c, pCpf, pAddr, pNo = null, pIdent = null) {
  let cpf = c.patient_cpf;
  let addr = c.patient_address;
  if (pCpf != null) {
    const t = String(pCpf).trim();
    if (!t) cpf = null;
    else if (!/^[0-9.\-\s]+$/.test(t) || !cpfOk(t.replace(/\D/g, ''))) bad('cpf');
    else cpf = t.replace(/\D/g, '');
  }
  if (pAddr != null) {
    addr = one(pAddr);
    if (addr && (addr.length < 3 || addr.length > 200)) bad('endereco');
  }
  const no = pNo != null ? !!pNo : cpf ? false : c.patient_no_cpf;
  if (no && cpf) bad('cpf');
  const changed = cpf !== c.patient_cpf || no !== c.patient_no_cpf;
  const ident = pIdent === false ? null : pIdent === true ? (changed ? iso() : c.identity_checked_at || iso()) : changed ? null : c.identity_checked_at;
  Object.assign(c, { patient_cpf: cpf, patient_address: addr, patient_no_cpf: no, identity_checked_at: ident });
}
const patientRow = (c) => ({ patient_cpf: c.patient_cpf, patient_address: c.patient_address, patient_no_cpf: c.patient_no_cpf, identity_checked_at: c.identity_checked_at });
function docCheckOpen(c) {
  if (c.status === 'ended') { if (Date.now() - Date.parse(c.ended_at) > DAY) throw new PgErr('prazo_encerrado'); return; }
  if (!['accepted', 'in_call'].includes(c.status)) throw new PgErr('estado_invalido');
}
// private.tele_doc_cid
function cidOf(p) {
  let cid = String(jtext(p, 'cid') ?? '').replace(/ /g, '').toUpperCase() || null;
  if (!cid) return null;
  if (p.cid_autorizado !== true) throw new PgErr('cid_sem_autorizacao');
  if (/^[A-Z][0-9]{3}$/.test(cid)) cid = `${cid.slice(0, 3)}.${cid.slice(3)}`;
  if (!/^[A-Z][0-9]{2}(\.[0-9])?$/.test(cid)) bad('cid');
  return cid;
}
// private.tele_doc_payload (mesmas regras)
function docPayload(kind, payload, c) {
  const p = payload ?? {};
  if (typeof p !== 'object' || Array.isArray(p)) bad('payload');
  const day = daySP(c.started_at || c.accepted_at || c.created_at);
  if (kind === 'exames') {
    const items = p.itens == null ? c.exams : p.itens;
    if (!Array.isArray(items) || items.length < 1 || items.length > 60) bad('itens');
    for (const e of items) {
      const ok = e && typeof e === 'object' && typeof e.name === 'string' && e.name.trim().length >= 1 && e.name.trim().length <= 120 && String(e.note ?? '').length <= 200
        && String(e.code ?? '').length <= 60 && String(e.group ?? '').length <= 60 && String(e.search ?? '').length <= 20;
      if (!ok) bad('itens');
    }
    const ind = 'indicacao' in p ? jtext(p, 'indicacao') : (String(c.indication ?? '').trim() || null);
    if (ind && ind.length > 1000) bad('indicacao');
    const nz = (v) => String(v ?? '').trim() || null;
    return { itens: items.map((e) => ({ code: nz(e.code), name: e.name.trim(), group: nz(e.group), search: ['rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab'].includes(e.search) ? e.search : null, note: nz(e.note) })), indicacao: ind };
  }
  if (kind === 'receita') {
    let tipo = String(jtext(p, 'tipo') ?? '').toLowerCase().replace(/[\s-]+/g, '_').normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (['antibiotico', 'receita_antimicrobiano', 'receita_de_antimicrobiano'].includes(tipo)) tipo = 'antimicrobiano';
    if (['c1', 'especial', 'receita_especial', 'controle_especial', 'receita_controle_especial', 'receita_de_controle_especial'].includes(tipo)) tipo = 'controle_especial_c1';
    if (!tipo) bad('tipo');
    if (/^(receita_|notificacao_|notificacao_de_receita_|lista_)?(a|a1|a2|a3|b|b1|b2|amarela|azul|retinoide|retinoides|talidomida|c2|c3)$/.test(tipo) || ['notificacao_especial', 'notificacao_de_receita_especial'].includes(tipo)) throw new PgErr('receita_bloqueada', 'notificacao');
    if (['antimicrobiano', 'controle_especial_c1', 'controle_especial_c5', 'c5', 'retencao'].includes(tipo)) throw new PgErr('receita_bloqueada', 'sncr');
    if (tipo !== 'simples') bad('tipo');
    if (!Array.isArray(p.itens) || p.itens.length < 1 || p.itens.length > 20) bad('itens');
    const itens = p.itens.map((e, i) => {
      const h = `item ${i + 1}`;
      if (!e || typeof e !== 'object' || Array.isArray(e)) bad('itens', h);
      const o = { medicamento: one(jtext(e, 'medicamento', h)), concentracao: one(jtext(e, 'concentracao', h)), forma: one(jtext(e, 'forma', h)), via: one(jtext(e, 'via', h)),
        posologia: jtext(e, 'posologia', h), quantidade: one(jtext(e, 'quantidade', h)), duracao: one(jtext(e, 'duracao', h)), observacao: jtext(e, 'observacao', h) };
      if (!o.medicamento || o.medicamento.length < 2 || o.medicamento.length > 200) bad('medicamento', h);
      if (!o.concentracao || o.concentracao.length > 60) bad('concentracao', h);
      if (o.forma && o.forma.length > 60) bad('forma', h);
      if (!o.via || o.via.length > 40) bad('via', h);
      if (!o.posologia || o.posologia.length < 3 || o.posologia.length > 500) bad('posologia', h);
      if (!o.quantidade || o.quantidade.length > 100) bad('quantidade', h);
      if (!o.duracao || o.duracao.length > 60) bad('duracao', h);
      if (o.observacao && o.observacao.length > 300) bad('observacao', h);
      return o;
    });
    const obs = jtext(p, 'observacao');
    if (obs && obs.length > 500) bad('observacao');
    if (p.endereco_residencial !== true) bad('endereco_residencial');
    return { tipo: 'simples', vias: 1, itens, observacao: obs, endereco_residencial: true };
  }
  if (kind === 'atestado') {
    const dias = jtext(p, 'dias');
    if (!/^[0-9]{1,3}$/.test(dias ?? '') || Number(dias) < 1 || Number(dias) > 90) bad('dias');
    const txt = jtext(p, 'inicio');
    const ini = txt ?? day;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || ini < day || ini > addDays(day, 7)) bad('inicio');
    const cid = cidOf(p);
    const obs = jtext(p, 'observacao');
    if (obs && obs.length > 500) bad('observacao');
    return { dias: Number(dias), inicio: ini, fim: addDays(ini, Number(dias) - 1), cid, cid_autorizado: !!cid, observacao: obs };
  }
  if (kind === 'comparecimento') {
    for (const k of ['data', 'hora_inicio', 'data_fim', 'hora_fim']) if (k in p) bad(k);
    if (c.status !== 'ended' || !c.ended_at || !c.started_at) throw new PgErr('consulta_nao_encerrada');
    const obs = jtext(p, 'observacao');
    if (obs && obs.length > 300) bad('observacao');
    return { data: daySP(c.started_at), hora_inicio: timeSP(c.started_at), data_fim: daySP(c.ended_at), hora_fim: timeSP(c.ended_at), observacao: obs };
  }
  if (kind === 'encaminhamento') {
    const esp = one(jtext(p, 'especialidade'));
    if (!esp || esp.length < 2 || esp.length > 80) bad('especialidade');
    const motivo = jtext(p, 'motivo');
    if (!motivo || motivo.length < 3 || motivo.length > 2000) bad('motivo');
    const prio = (one(jtext(p, 'prioridade')) || 'eletiva').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!['eletiva', 'prioritaria', 'urgente'].includes(prio)) bad('prioridade');
    const obs = jtext(p, 'observacao');
    if (obs && obs.length > 500) bad('observacao');
    return { especialidade: esp, motivo, prioridade: prio, observacao: obs };
  }
  const texto = jtext(p, 'texto');
  if (!texto || texto.length < 3 || texto.length > 4000) bad('texto');
  if (kind === 'orientacoes') return { texto };
  const cid = cidOf(p);
  return { texto, cid, cid_autorizado: !!cid };
}
function docAccess(db, c, uid) {
  if (!uid || !c) return null;
  const d = docOf(db, uid);
  if (d && c.doctor_id === d.id) { if (d.status === 'approved') return 'own'; if (inWindow(c)) return 'limited'; }
  return null;
}
const initials = (n) => String(n ?? '').trim().split(/\s+/).filter((w) => w && !['da', 'das', 'de', 'des', 'di', 'do', 'dos', 'du', 'e', 'y', 'del', 'della', 'der', 'van', 'von'].includes(w.toLowerCase())).map((w) => `${w[0].toUpperCase()}.`).join('');
const docRow = (db, d) => { const f = db.files.get(d.id); return { ...d, signed: !!d.signed_at, file_size: f?.size ?? null, file_sha256: f?.sha256 ?? null }; };

const RPC = {
  /* ---- teleconsulta (o mínimo) ---- */
  tele_doctors_online: () => [],
  tele_doctor_me(db, a, uid) {
    const d = docOf(db, uid);
    const f = ['id', 'full_name', 'crm', 'crm_uf', 'rqe', 'specialty', 'phone', 'status', 'review_note', 'reviewed_at', 'available_until', 'created_at', 'updated_at', 'checked_at'];
    return [{ ...Object.fromEntries(f.map((k) => [k, d ? d[k] ?? null : null])), is_admin: false }];
  },
  tele_set_available(db, a, uid) { const d = me(db, uid, !!a.p_on); d.available_until = a.p_on ? iso(Date.now() + 90e3) : null; return d.available_until; },
  tele_queue(db, a, uid) {
    const d = me(db, uid, true);
    return [...db.consults.values()].filter((c) => c.doctor_id === d.id && ['accepted', 'in_call'].includes(c.status)).map((c) => ({ id: c.id, status: c.status, patient_name: c.patient_name,
      age_years: ageOf(c.patient_birthdate), reason: c.reason, for_other: c.for_other, relationship: c.relationship, wait_minutes: 1, created_at: c.created_at, accepted_at: c.accepted_at, seen_seconds: 5 }));
  },
  tele_doctor_status(db, a, uid) {
    const c = db.consults.get(a.p_id);
    const access = docAccess(db, c, uid);
    if (!access) return [];
    return [{ id: c.id, status: c.status, offer_version: c.offer_version, answer_version: c.answer_version, answer_sdp: null, created_at: c.created_at, accepted_at: c.accepted_at,
      started_at: c.started_at, ended_at: c.ended_at, patient_name: c.patient_name, patient_birthdate: c.patient_birthdate, age_years: ageOf(c.patient_birthdate),
      patient_phone: access === 'limited' ? null : c.patient_phone, reason: c.reason, for_other: c.for_other, requester_name: c.requester_name, relationship: c.relationship,
      guardian_consent: c.guardian_consent, patient_agrees: c.patient_agrees, consent_version: c.consent_version, consent_at: c.consent_at, exams: c.exams, indication: c.indication,
      guidance: c.guidance, notes: c.notes, doctor: c.doctor_info, closed_by: c.closed_by, phone_call_at: c.phone_call_at, patient_seen_seconds: 5, exams_version: c.exams_version, exams_at: c.exams_at, access }];
  },
  tele_offer(db, a, uid) { me(db, uid, true); const c = db.consults.get(a.p_id); c.offer_version += 1; return c.offer_version; },
  tele_mark_started(db, a) { const c = db.consults.get(a.p_id); c.started_at = c.started_at || iso(); if (a.p_phone) c.phone_call_at = iso(); return c.started_at; },
  tele_doctor_messages: () => [],
  tele_set_exams(db, a, uid) {
    const d = me(db, uid, true);
    const c = db.consults.get(a.p_id);
    if (!c || c.doctor_id !== d.id) throw new PgErr('nao_encontrado');
    docCheckOpen(c);
    const nz = (v) => String(v ?? '').trim() || null;
    c.exams = a.p_exams.map((e) => ({ code: nz(e.code), name: e.name.trim(), group: nz(e.group), search: e.search || null, note: nz(e.note) }));
    c.indication = nz(a.p_indication);
    c.exams_version += 1;
    c.exams_at = iso();
    return c.exams.length;
  },
  tele_end(db, a, uid) {
    const d = me(db, uid, false);
    const c = db.consults.get(a.p_id);
    if (!c || c.doctor_id !== d.id) throw new PgErr('nao_encontrado');
    if (c.status !== 'ended') Object.assign(c, { status: 'ended', ended_at: iso(), closed_by: 'doctor' });
    c.notes = a.p_notes || c.notes; c.guidance = a.p_guidance || c.guidance;
    return null;
  },
  tele_history(db, a, uid) {
    const d = docOf(db, uid);
    if (!d) return [];
    return [...db.consults.values()].filter((c) => c.doctor_id === d.id && ['ended', 'cancelled', 'expired'].includes(c.status) && (d.status === 'approved' || inWindow(c)))
      .map((c) => ({ id: c.id, status: c.status, patient_name: c.patient_name, patient_birthdate: c.patient_birthdate, patient_phone: d.status === 'approved' ? c.patient_phone : null,
        reason: c.reason, for_other: c.for_other, requester_name: c.requester_name, relationship: c.relationship, created_at: c.created_at, accepted_at: c.accepted_at, started_at: c.started_at,
        ended_at: c.ended_at, exams: c.exams, indication: c.indication, guidance: c.guidance, notes: c.notes, closed_by: c.closed_by, exams_version: c.exams_version }));
  },
  tele_status(db, a) {
    const c = byToken(db, a.p_id, a.p_token);
    if (!c) return [];
    return [{ status: c.status, position: null, doctors_online: 1, doctor: c.doctor_info, offer_sdp: null, offer_version: c.offer_version, answer_version: c.answer_version, exams: c.exams,
      indication: c.indication, guidance: c.guidance, created_at: c.created_at, accepted_at: c.accepted_at, started_at: c.started_at, ended_at: c.ended_at, patient_name: c.patient_name,
      patient_birthdate: c.patient_birthdate, closed_by: c.closed_by, phone_call_at: c.phone_call_at, exams_version: c.exams_version, exams_at: c.exams_at, guidance_at: c.guidance_at }];
  },
  tele_patient_messages: () => [],

  /* ---- documentos (supabase/migrations/*_tele_documentos.sql) ---- */
  tele_doctor_profile(db, a, uid) {
    const d = me(db, uid, false);
    let addr = d.prof_address;
    let contact = d.prof_contact;
    if (a.p_prof_address != null) { addr = one(a.p_prof_address); if (addr && (addr.length < 5 || addr.length > 200)) bad('endereco'); }
    if (a.p_prof_contact != null) {
      contact = one(a.p_prof_contact);
      if (contact && contact.includes('@')) { contact = contact.toLowerCase(); if (contact.length < 6 || contact.length > 120 || !/^[^@\s]+@[^@\s]+\.[^@\s.]+$/.test(contact)) bad('contato'); }
      else if (contact) {
        if (!/^[0-9()+.\- ]+$/.test(contact)) bad('contato');
        let dg = contact.replace(/\D/g, '');
        if ((dg.length === 12 || dg.length === 13) && dg.startsWith('55')) dg = dg.slice(2);
        if (!/^[1-9][1-9][0-9]{8,9}$/.test(dg)) bad('contato');
        contact = dg;
      }
    }
    Object.assign(d, { prof_address: addr, prof_contact: contact });
    return [{ prof_address: addr, prof_contact: contact }];
  },
  tele_doc_patient_data(db, a, uid) {
    const d = me(db, uid, true);
    const c = db.consults.get(a.p_id);
    if (!c || c.doctor_id !== d.id) throw new PgErr('nao_encontrado');
    if (a.p_cpf != null || a.p_address != null || a.p_no_cpf != null || a.p_identity != null) {
      docCheckOpen(c);
      if (a.p_identity === true && !c.started_at) throw new PgErr('atendimento_nao_iniciado');
      setPatient(c, a.p_cpf, a.p_address, a.p_no_cpf ?? null, a.p_identity ?? null);
    }
    return [patientRow(c)];
  },
  tele_patient_details(db, a) {
    const c = byToken(db, a.p_id, a.p_token);
    if (!c) throw new PgErr('nao_encontrado');
    if (a.p_cpf != null || a.p_address != null) {
      if (c.status === 'ended') { if (Date.now() - Date.parse(c.ended_at) > DAY) throw new PgErr('prazo_encerrado'); }
      else if (!['waiting', 'accepted', 'in_call'].includes(c.status)) throw new PgErr('estado_invalido');
      setPatient(c, a.p_cpf, a.p_address);
    }
    return [{ patient_cpf: c.patient_cpf, patient_address: c.patient_address }];
  },
  tele_doc_create(db, a, uid) {
    const d = me(db, uid, true);
    const kind = String(a.p_kind ?? '').trim().toLowerCase();
    if (!KINDS.includes(kind)) bad('documento');
    const c = db.consults.get(a.p_id);
    if (!c || c.doctor_id !== d.id) throw new PgErr('nao_encontrado');
    docCheckOpen(c);
    if (!c.started_at) throw new PgErr('atendimento_nao_iniciado');
    if (!d.prof_address) throw new PgErr('perfil_incompleto', 'endereco');
    if (!d.prof_contact) throw new PgErr('perfil_incompleto', 'contato');
    const e = a.p_expect;
    if (!e || typeof e !== 'object' || Array.isArray(e)) bad('conferencia');
    if (JSON.stringify([e.cpf || null, e.sem_cpf === true, e.endereco || null]) !== JSON.stringify([c.patient_cpf, c.patient_no_cpf, c.patient_address])) throw new PgErr('dados_paciente_mudaram');
    if (!c.patient_name) throw new PgErr('paciente_incompleto', 'nome');
    if (!c.patient_address) throw new PgErr('paciente_incompleto', 'endereco');
    if (!c.patient_cpf && !c.patient_no_cpf) throw new PgErr('paciente_incompleto', 'cpf');
    if (!c.identity_checked_at) throw new PgErr('sem_conferencia_identidade');
    const payload = docPayload(kind, a.p_payload, c);
    const dsnap = { full_name: d.full_name, crm: d.crm, crm_uf: d.crm_uf, rqe: d.rqe, specialty: d.rqe ? d.specialty : null, prof_address: d.prof_address, prof_contact: d.prof_contact };
    const psnap = { name: c.patient_name, birthdate: c.patient_birthdate, age: ageOf(c.patient_birthdate), cpf: c.patient_cpf, sem_cpf: c.patient_no_cpf, address: c.patient_address, for_other: c.for_other,
      requester_name: c.requester_name, relationship: c.relationship, identidade_conferida_em: c.identity_checked_at, inicio_atendimento: c.started_at };
    const same = [...db.docs.values()].reverse().find((x) => x.consultation_id === c.id && x.kind === kind && x.status === 'emitido' && JSON.stringify(x.payload) === JSON.stringify(payload)
      && JSON.stringify(x.doctor_snapshot) === JSON.stringify(dsnap) && JSON.stringify(x.patient_snapshot) === JSON.stringify(psnap) && Date.now() - Date.parse(x.created_at) < 120e3);
    if (same) return [{ id: same.id, code: same.code }];
    if ([...db.docs.values()].filter((x) => x.consultation_id === c.id).length >= 30) throw new PgErr('limite_documentos');
    const code = Array.from({ length: 10 }, () => ALPHA[randomInt(32)]).join('');
    const row = { id: randomUUID(), consultation_id: c.id, doctor_id: d.id, kind, payload, code, status: 'emitido', cancel_reason: null, cancelled_by: null, created_at: iso(Date.now() + (db.t++)),
      cancelled_at: null, signed_at: null, doctor_snapshot: dsnap, patient_snapshot: psnap };
    db.docs.set(row.id, row);
    return [{ id: row.id, code }];
  },
  tele_doc_cancel(db, a, uid) {
    if (!uid) throw new PgErr('sem_login');
    const d = db.docs.get(a.p_doc);
    if (!d) throw new PgErr('nao_encontrado');
    const access = docAccess(db, db.consults.get(d.consultation_id), uid);
    if (!access) throw new PgErr('nao_encontrado');
    if (d.status === 'cancelado') return 'cancelado';
    const reason = one(a.p_reason);
    if (!reason || reason.length < 3 || reason.length > 300) bad('motivo');
    Object.assign(d, { status: 'cancelado', cancel_reason: reason, cancelled_at: iso(), cancelled_by: 'medico' });
    return 'cancelado';
  },
  tele_doc_list(db, a, uid) {
    const c = db.consults.get(a.p_id);
    if (!docAccess(db, c, uid)) return [];
    return [...db.docs.values()].filter((x) => x.consultation_id === c.id).sort((x, y) => x.created_at.localeCompare(y.created_at)).map((x) => {
      const r = docRow(db, x);
      return { id: r.id, kind: r.kind, payload: r.payload, code: r.code, status: r.status, cancel_reason: r.cancel_reason, cancelled_by: r.cancelled_by, created_at: r.created_at, cancelled_at: r.cancelled_at,
        signed: r.signed, signed_at: r.signed_at, file_size: r.file_size, file_sha256: r.file_sha256, doctor_snapshot: r.doctor_snapshot, patient_snapshot: r.patient_snapshot };
    });
  },
  // Painel "Agora na plataforma" (supabase/migrations/20261030191354_painel_medico.sql): documentos para assinar = os
  // de "Falta assinar" ainda no prazo de 7 dias (o vencido só pode ser cancelado). Só contagens.
  tele_painel_medico(db, a, uid) {
    const d = me(db, uid, true);
    const now = Date.now();
    const all = [...db.consults.values()];
    const waiting = all.filter((c) => c.status === 'waiting' && Date.parse(c.created_at) >= now - 2 * 3600e3);
    const ini = Date.parse(`${daySP(now)}T00:00:00-03:00`);
    return {
      aguardando: waiting.length,
      espera_mais_longa_min: waiting.length ? Math.max(0, Math.floor((now - Math.min(...waiting.map((c) => Date.parse(c.created_at)))) / 60000)) : null,
      em_atendimento: all.filter((c) => c.doctor_id === d.id && ['accepted', 'in_call'].includes(c.status)).length,
      atendidos_hoje: all.filter((c) => c.doctor_id === d.id && c.status === 'ended' && c.started_at && Date.parse(c.ended_at) >= ini && Date.parse(c.ended_at) < ini + DAY).length,
      documentos_para_assinar: [...db.docs.values()].filter((x) => x.doctor_id === d.id && x.status === 'emitido' && !x.signed_at && Date.parse(x.created_at) >= now - 7 * DAY).length,
      medicos_disponiveis: [...db.doctors.values()].filter((o) => o.status === 'approved' && o.available_until && Date.parse(o.available_until) > now).length,
      atualizado_em: iso(now),
    };
  },
  tele_doc_pending(db, a, uid) {
    const d = me(db, uid, true);
    return [...db.docs.values()].filter((x) => x.doctor_id === d.id && x.status === 'emitido' && !x.signed_at && Date.now() - Date.parse(x.created_at) < 30 * DAY)
      .sort((x, y) => x.created_at.localeCompare(y.created_at))
      .map((x) => ({ id: x.id, consultation_id: x.consultation_id, patient_name: x.patient_snapshot.name, kind: x.kind, payload: x.payload, code: x.code, status: x.status, created_at: x.created_at,
        signed: false, doctor_snapshot: x.doctor_snapshot, patient_snapshot: x.patient_snapshot, expired: Date.now() - Date.parse(x.created_at) > 7 * DAY }));
  },
  tele_doc_upload(db, a, uid) {
    const me2 = me(db, uid, true);
    const d = db.docs.get(a.p_doc);
    if (!d || d.doctor_id !== me2.id) throw new PgErr('nao_encontrado');
    if (d.status === 'cancelado') throw new PgErr('documento_cancelado');
    if (Date.now() - Date.parse(d.created_at) > 7 * DAY) throw new PgErr('prazo_encerrado');
    let t = String(a.p_pdf_base64 ?? '');
    if (t.length > 4500000) bad('pdf_tamanho');
    if (t.startsWith('data:')) t = t.slice(t.indexOf(',') + 1);
    t = t.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
    if (!t || !/^[A-Za-z0-9+/]*={0,2}$/.test(t)) bad('pdf');
    const pdf = Buffer.from(t, 'base64');
    if (pdf.length > 3145728) bad('pdf_tamanho');
    const h = createHash('sha256').update(pdf).digest('hex');
    const old = db.files.get(d.id);
    if (old) { if (old.sha256 === h) return [{ signed_at: d.signed_at, file_size: pdf.length, file_sha256: h }]; throw new PgErr('ja_assinado'); }
    if (pdf.length < 16 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-' || !pdf.subarray(Math.max(0, pdf.length - 1024)).toString('latin1').includes('%%EOF')) bad('pdf');
    if (!pdf.includes(Buffer.from('/ByteRange'))) throw new PgErr('pdf_sem_assinatura');
    if (!['/ETSI.CAdES.detached', '/adbe.pkcs7.detached', '/adbe.pkcs7.sha1'].some((s) => pdf.includes(Buffer.from(s)))) throw new PgErr('pdf_sem_assinatura', 'subfilter');
    if (!pdf.includes(Buffer.from(d.code))) throw new PgErr('pdf_outro_documento', 'codigo');
    db.files.set(d.id, { pdf, size: pdf.length, sha256: h });
    d.signed_at = iso();
    return [{ signed_at: d.signed_at, file_size: pdf.length, file_sha256: h }];
  },
  tele_doc_pdf(db, a, uid) {
    if (!uid) throw new PgErr('sem_login');
    const d = db.docs.get(a.p_doc);
    if (!d || !docAccess(db, db.consults.get(d.consultation_id), uid)) throw new PgErr('nao_encontrado');
    return db.files.get(d.id)?.pdf.toString('base64') ?? null;
  },
  tele_patient_documents(db, a) {
    const c = byToken(db, a.p_id, a.p_token);
    if (!c) return [];
    return [...db.docs.values()].filter((x) => x.consultation_id === c.id).sort((x, y) => x.created_at.localeCompare(y.created_at)).slice(0, 100)
      .map((x) => ({ id: x.id, kind: x.kind, payload: x.status === 'emitido' ? x.payload : null, code: x.code, status: x.status, cancel_reason: x.cancel_reason, created_at: x.created_at,
        cancelled_at: x.cancelled_at, signed: !!x.signed_at, signed_at: x.signed_at, doctor_snapshot: x.doctor_snapshot, patient_snapshot: x.patient_snapshot }));
  },
  tele_patient_document_pdf(db, a) {
    const c = byToken(db, a.p_id, a.p_token);
    const d = db.docs.get(a.p_doc);
    if (!c || !d || d.consultation_id !== c.id) throw new PgErr('nao_encontrado');
    if (d.status === 'cancelado') throw new PgErr('documento_cancelado');
    return db.files.get(d.id)?.pdf.toString('base64') ?? null;
  },
  tele_doc_verify(db, a) {
    if (a.p_code == null || String(a.p_code).length > 40) bad('codigo');
    const code = String(a.p_code).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (!/^[2-9A-HJ-NP-Z]{10}$/.test(code)) bad('codigo');
    return [...db.docs.values()].filter((x) => x.code === code).map((x) => ({ kind: x.kind, created_at: x.created_at, status: x.status, cancelled_at: x.cancelled_at, signed: !!x.signed_at,
      doctor_name: x.doctor_snapshot.full_name, doctor_crm: x.doctor_snapshot.crm, doctor_crm_uf: x.doctor_snapshot.crm_uf, patient_initials: initials(x.patient_snapshot.name) }));
  },
};
// Emissão direta (preparação dos cenários): completa o que o banco exige antes, como a tela faria.
function emit(db, c, kind, payload, uid = 'u-doc') {
  if (!c.patient_address) c.patient_address = 'Rua A, 10, Recife/PE';
  if (!c.patient_cpf && !c.patient_no_cpf) c.patient_no_cpf = true;
  if (!c.identity_checked_at) c.identity_checked_at = iso();
  const [row] = RPC.tele_doc_create(db, { p_id: c.id, p_kind: kind, p_payload: payload, p_expect: { cpf: c.patient_cpf, sem_cpf: c.patient_no_cpf, endereco: c.patient_address } }, uid);
  return db.docs.get(row.id);
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body), headers: cors });

/* ======================= páginas ======================= */
async function newPage(browser, db, { mobile = false, store = null } = {}) {
  const context = await browser.newContext({
    ...(process.env.TEMA === 'escuro' ? { colorScheme: 'dark' } : {}), // TEMA=escuro: aparelho no escuro (o Automático do site segue), para as capturas
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', permissions: ['camera', 'microphone'], acceptDownloads: true,
  });
  await context.addInitScript((s) => {
    try { localStorage.setItem('imed_lgpd', '1'); if (s) localStorage.setItem('imed_tele', JSON.stringify(s)); } catch { /* ignora */ }
    // O aviso do médico já foi aceito neste aparelho.
    try { for (const u of ['u-doc', 'u-doc2']) localStorage.setItem(`imed_medico_aviso:${u}`, '2026-10-30'); } catch { /* ignora */ }
  }, store);
  await context.route(`${BASE}assets/js/config.js`, async (route) => {
    const src = await readFile(join(ROOT, 'assets/js/config.js'), 'utf8');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: `${src}\nwindow.IMED_CONFIG.tele = ${JSON.stringify({ iceServers: [], planBMs: 600000, gatherMs: 800, slowMs: 1500, docsMs: 800 })};\n` });
  });
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const auth = (req.headers().authorization || '').replace(/^Bearer /, '');
    if (u.pathname === '/auth/v1/user') return USERS[auth] ? json(route, USERS[auth]) : json(route, { msg: 'invalid' }, 401);
    if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    const m = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (!m || !RPC[m[1]]) return json(route, { message: 'não simulado' }, 404);
    const fn = m[1];
    const args = JSON.parse(req.postData() || '{}');
    const uid = USERS[auth]?.id || null;
    db.calls.push({ fn, args, uid, auth, apikey: req.headers().apikey, at: Date.now() });
    if (fn === 'tele_painel_medico' && !db.painel) return json(route, { code: 'PGRST202', details: null, hint: null, message: 'Could not find the function public.tele_painel_medico without parameters in the schema cache' }, 404);
    if (DOCTOR_FNS.has(fn) && !uid) return json(route, { code: '42501', message: `permission denied for function ${fn}` }, 401);
    if (db.delay[fn]) await new Promise((r) => { setTimeout(r, db.delay[fn]); });
    try {
      db.before[fn]?.(args);
      const out = RPC[fn](db, args, uid);
      return out === null || out === undefined ? route.fulfill({ status: 204, body: '', headers: cors }) : json(route, out);
    } catch (e) {
      if (e instanceof PgErr) return json(route, { code: 'P0001', message: e.message, details: e.details, hint: e.hint }, 400);
      return json(route, { message: String(e) }, 500);
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  return { context, page, errors };
}
const loginUrl = (tok) => `${BASE}medico.html#access_token=${tok}&refresh_token=r-${tok}&expires_in=3600&token_type=bearer&type=magiclink`;
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); } };
const overflow = (page) => page.evaluate(() => {
  const cw = document.documentElement.clientWidth;
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (/(hidden|auto|scroll|clip)/.test(getComputedStyle(p).overflowX)) return true; } return false; };
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || cs.position === 'fixed' || cs.display === 'none' || el.classList.contains('sr') || el.classList.contains('hp') || clipped(el)) continue;
    if (r.right > cw + 1) bad.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`);
  }
  return { px: document.documentElement.scrollWidth - cw, body: document.body.scrollWidth - cw, bad: bad.slice(0, 5) };
});
// Sem rolagem lateral: nem caixas para fora da tela, nem texto que vaza (scrollWidth da página maior que a tela).
const noOverflow = async (page, where) => { const o = await overflow(page); assert.ok(o.px <= 0 && o.body <= 0 && !o.bad.length, `${where}: sem rolagem lateral (${o.px}px; ${o.bad.join(', ')})`); };
const visible = (page, sel, timeout = 15000) => page.waitForSelector(sel, { state: 'visible', timeout });
const text = (page, sel) => page.locator(sel).innerText();
// Nome do botão como o leitor de tela lê (texto visível + o trecho escondido .sr).
const label = (loc) => loc.evaluate((el) => el.textContent.replace(/\s+/g, ' ').trim());
const results = [];
async function scenario(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const t0 = Date.now();
  try { await comChaves(fn); results.push(['ok', name]); console.log(`ok - ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 8).join('\n  ')}`); }
}
const waitFor = async (fn, ms = 15000, what = 'condição') => {
  const t0 = Date.now();
  while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error(`tempo esgotado esperando: ${what}`); await new Promise((r) => setTimeout(r, 100)); }
};
// Baixa um arquivo clicando no botão; devolve os bytes e o nome sugerido.
async function download(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click(selector)]);
  const chunks = [];
  for await (const ch of await dl.createReadStream()) chunks.push(ch);
  return { bytes: Buffer.concat(chunks), name: dl.suggestedFilename() };
}
// Texto das páginas do PDF (strings hexadecimais Windows-1252 dos comandos Tj).
const CP1252 = { 0x80: '€', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—' };
async function pdfText(bytes) {
  const pdf = await lib.PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const c = page.node.Contents();
    const streams = c instanceof lib.PDFArray ? c.asArray().map((r) => pdf.context.lookup(r)) : [c];
    const ops = streams.map((st) => Buffer.from(lib.decodePDFRawStream(st).decode()).toString('latin1')).join('\n');
    return [...ops.matchAll(/<([0-9A-Fa-f]*)> Tj/g)].map((m) => [...Buffer.from(m[1], 'hex')].map((x) => CP1252[x] || String.fromCharCode(x)).join('')).join('\n');
  }).join('\n');
}
// PDF "assinado" para o teste: o PDF gerado + uma atualização com o campo de assinatura PAdES. icp = certificado da
// cadeia ICP-Brasil dentro da assinatura (/Contents em hexadecimal); sem ele, parece assinatura do gov.br.
const ICP_HEX = Buffer.from('O=ICP-Brasil').toString('hex');
const fakeSign = (bytes, { pad = 0, icp = true, sub = '/ETSI.CAdES.detached' } = {}) => Buffer.concat([Buffer.from(bytes),
  Buffer.from(`\n%${'x'.repeat(pad)}\n99 0 obj << /Type /Sig /Filter /Adobe.PPKLite /SubFilter ${sub} /ByteRange [0 10 20 30] /Contents <3082${icp ? ICP_HEX : '00'}> >> endobj\n%%EOF\n`)]);
// PDF mínimo "assinado" com o código (envio direto pelo banco simulado).
const tinySigned = (code) => Buffer.from(`%PDF-1.7\n% teste ${code}\n<< /SubFilter /ETSI.CAdES.detached /ByteRange [0 1 2 3] /Contents <${ICP_HEX}> >>\n%%EOF\n`);
async function chooseFile(page, button, file) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click(button)]);
  await fc.setFiles(file);
}

// Médico aprovado entra; a consulta dele em andamento abre sozinha (veio da fila).
async function doctorIn(page) {
  await page.goto(loginUrl('tok-doc'));
  await visible(page, '#consult', 20000);
  await visible(page, '#cDocs');
}
const docsOf = (db, c) => [...db.docs.values()].filter((d) => d.consultation_id === c.id);
const lastDoc = (db) => [...db.docs.values()].at(-1);
const PROFILE = { prof_address: 'Rua das Flores, 100, São Paulo/SP', prof_contact: '1134567890' };

const browser = vigiarChaves(await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }));

/* ======================= cenários ======================= */
await scenario('médico: perfil, dados do paciente e identidade antes de emitir; bloqueios e alerta da receita; emite os 7 tipos (declaração depois de encerrar)', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', rqe: '7788', specialty: 'Clínica médica' });
  const c = db.addConsult({ doctor_id: carla.id, guidance: 'Beber bastante água.\nRepouso.' });
  const { page, errors, context } = await newPage(browser, db);
  await doctorIn(page);
  assert.match(await text(page, '#dProfSum'), /Falta preencher/);
  assert.equal(await page.isVisible('#dpAddr'), true, 'formulário do perfil aberto quando falta');
  assert.equal(await page.getAttribute('#dTab-exames', 'aria-selected'), 'true');
  assert.equal(await page.locator('#dTabs [role="tab"]').count(), 7);
  // Abas pelo teclado (setas, Home e End) e só um painel visível.
  await page.focus('#dTab-exames');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dTab-receita');
  assert.equal(await page.getAttribute('#dTab-receita', 'aria-selected'), 'true');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dTab-orientacoes');
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dTab-exames');
  assert.equal(await page.locator('#dPanels [role="tabpanel"]:not([hidden])').count(), 1);
  // Ajuda: como assinar (ICP-Brasil, gov.br não serve para atestado, conferir no ITI, um PDF por documento).
  await page.click('#cDocs .md-help > summary');
  assert.equal(await page.getAttribute('#cDocs .md-help', 'open'), '', 'a ajuda abre ao tocar');
  const help = await page.locator('#cDocs .md-help').innerText();
  assert.match(help, /gov\.br é “avançada”/);
  assert.match(help, /certificado ICP-Brasil em nuvem gratuito/);
  assert.match(help, /não pode ser trocado/);
  assert.equal(await page.locator('#cDocs .md-help a[href="https://validar.iti.gov.br/"]').count(), 1);
  // Quadros sem a classe genérica "ok" (perto.css centralizaria tudo).
  assert.equal(await page.locator('#dProf.ok, #dPat.ok').count(), 0);

  // Receita: antibiótico, controlado e notificação ficam bloqueados, com o link da plataforma do CFM.
  await page.click('#dTab-receita');
  for (const [tipo, re] of [['antimicrobiano', /SNCR/], ['controle_especial_c1', /lista C1/], ['notificacao', /azul ou amarela/]]) {
    await page.check(`input[name="dRxTipo"][value="${tipo}"]`);
    await visible(page, '#dRxBlock');
    assert.match(await text(page, '#dRxBlock'), re);
    assert.equal(await page.getAttribute('#dRxBlock a', 'href'), 'https://prescricaoeletronica.cfm.org.br/');
    assert.equal(await page.isVisible('[data-demit="receita"]'), false, `${tipo}: sem botão de emitir`);
  }
  await shot(page, 'docs-01-receita-bloqueada');
  await page.check('input[name="dRxTipo"][value="simples"]');
  assert.equal(await page.isVisible('#dRxBlock'), false);
  // Emitir sem preencher: erros nos campos e nada vai ao banco.
  await page.click('[data-demit="receita"]');
  await page.waitForSelector('[data-ferr="receita:itens.1.medicamento"]:not(:empty)');
  assert.match(await text(page, '[data-ferr="receita:confirmaSimples"]'), /antibiótico/);
  assert.equal(db.called('tele_doc_create').length, 0);
  // Lista de alerta: "Amoxicilina" na receita simples mostra o aviso do SNCR e pede confirmação (não libera nada).
  await page.fill('#dRx1-medicamento', 'Amoxicilina');
  await visible(page, '#dRxAlert');
  assert.match(await text(page, '#dRxAlert'), /SNCR/);
  assert.equal(await page.getAttribute('#dRxAlert a', 'href'), 'https://prescricaoeletronica.cfm.org.br/');
  await page.waitForFunction(() => /“Amoxicilina” parece ser antibiótico/.test(document.querySelector('[data-dwarn="receita"]').textContent));
  await page.click('[data-demit="receita"]');
  await page.waitForFunction(() => /Confira o item 1/.test(document.querySelector('[data-ferr="receita:confirmaAlerta"]').textContent));
  await page.fill('#dRx1-medicamento', 'Dipirona <img src=x onerror="window.__xss=1">');
  await page.waitForFunction(() => document.querySelector('#dRxAlert').hidden);
  await page.fill('#dRx1-concentracao', '500 mg');
  await page.fill('#dRx1-forma', 'comprimido');
  await page.fill('#dRx1-via', 'oral');
  await page.fill('#dRx1-quantidade', '1 caixa com 20 comprimidos');
  await page.fill('#dRx1-posologia', 'Tomar 1 cp VO de 6/6h se tiver dor ≥ 7');
  await page.fill('#dRx1-duracao', '5 dias');
  await page.click('#dRxAdd');
  await page.fill('#dRx2-medicamento', 'Soro fisiológico');
  await page.fill('#dRx2-concentracao', '0,9%');
  await page.fill('#dRx2-via', 'nasal');
  await page.fill('#dRx2-quantidade', '1 frasco de 100 mL');
  await page.fill('#dRx2-posologia', 'Aplicar 3 gotas em cada narina 4 vezes ao dia');
  await page.fill('#dRx2-duracao', '7 dias');
  await page.check('#dRxSimples');
  await page.check('#dRxEnd');
  await page.waitForFunction(() => /evite abreviações/.test(document.querySelector('[data-dwarn="receita"]').textContent));
  await page.waitForFunction(() => /Soro fisiológico 0,9%/.test(document.querySelector('[data-dprev="receita"]').textContent));
  assert.match(await text(page, '[data-dprev="receita"]'), /Documento emitido em modalidade de telemedicina/);
  assert.match(await text(page, '[data-dprev="receita"]'), /Carla Mendes — CRM 123456\/SP — RQE 7788 \(Clínica médica\)/);
  assert.equal(await page.locator('[data-dprev="receita"] img').count(), 0, 'nome com HTML não vira imagem');
  // Faltam perfil, dados do paciente e a conferência de identidade.
  await page.click('[data-demit="receita"]');
  await page.waitForFunction(() => /Antes de emitir/.test(document.querySelector('[data-derr="receita"]').textContent));
  const pre = await text(page, '[data-derr="receita"]');
  assert.match(pre, /endereço e contato profissionais/);
  assert.match(pre, /dados do paciente/);
  assert.match(pre, /documento com foto/);
  assert.equal(db.called('tele_doc_create').length, 0, 'não emite sem o que falta');
  // Perfil profissional.
  await page.fill('#dpAddr', 'Rua das Flores, 100, sala 2, São Paulo/SP');
  await page.fill('#dpContact', 'abc');
  await page.click('[data-profsave="dp"]');
  assert.match(await text(page, '#dpContactErr'), /telefone com DDD/);
  await page.fill('#dpContact', '+55 (11) 3456-7890');
  await page.click('[data-profsave="dp"]');
  await page.waitForFunction(() => /Contato: \(11\) 3456-7890/.test(document.querySelector('#dProfSum').textContent));
  assert.deepEqual([carla.prof_address, carla.prof_contact], ['Rua das Flores, 100, sala 2, São Paulo/SP', '1134567890']);
  assert.equal(await page.locator('#dProf.md-done').count(), 1);
  // Dados do paciente: CPF errado, sem UF, depois certos.
  await page.fill('#dCpf', '52998224724');
  await page.fill('#dAddr', 'Rua A, 10, Centro, Recife');
  await page.click('#dPatSave');
  assert.match(await text(page, '#dCpfErr'), /CPF inválido/);
  await page.fill('#dCpf', '52998224725');
  await page.click('#dPatSave');
  assert.match(await text(page, '#dAddrErr'), /sigla do estado/);
  await page.fill('#dAddr', 'Rua A, 10, Centro, Recife/pe');
  await page.click('#dPatSave');
  await page.waitForSelector('#dPatMsg.ok');
  assert.deepEqual([c.patient_cpf, c.patient_address], ['52998224725', 'Rua A, 10, Centro, Recife/PE']);
  assert.equal(await page.inputValue('#dCpf'), '529.982.247-25');
  // Conferência de identidade: fica registrada no banco (Res. CFM 2.381/2024, art. 3º).
  await page.check('#dIdOk');
  await waitFor(() => !!c.identity_checked_at, 10000, 'conferência registrada');
  assert.equal(db.called('tele_doc_patient_data').at(-1).args.p_identity, true);
  await page.click('[data-demit="receita"]');
  await page.waitForSelector('#dList [data-docid]');
  const rx = db.called('tele_doc_create').at(-1).args;
  assert.equal(rx.p_kind, 'receita');
  assert.equal(rx.p_payload.tipo, 'simples');
  assert.equal(rx.p_payload.endereco_residencial, true);
  assert.equal(rx.p_payload.itens.length, 2);
  assert.equal(rx.p_payload.itens[0].posologia, 'Tomar 1 cp VO de 6/6h se tiver dor >= 7', 'símbolo trocado por um que sai no PDF');
  assert.deepEqual(rx.p_expect, { cpf: '52998224725', sem_cpf: false, endereco: 'Rua A, 10, Centro, Recife/PE' }, 'o banco recebe o que o médico revisou');
  assert.equal(lastDoc(db).patient_snapshot.identidade_conferida_em, c.identity_checked_at);
  assert.match(await text(page, '#dList'), /Receita/);
  assert.match(await text(page, '#dList'), /Rascunho sem assinatura/);
  assert.match(await text(page, '#dMsg'), /código [2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}/);
  assert.equal(await page.inputValue('#dRx1-medicamento'), '', 'formulário limpo depois de emitir');
  // Botões da lista dizem de qual documento são (leitor de tela).
  assert.match(await label(page.locator('#dList [data-dview]').first()), /Ver documento: Receita, código [2-9A-HJ-NP-Z]{5}-/);

  // Atestado: CID só com a autorização expressa.
  await page.click('#dTab-atestado');
  await page.fill('#dAtDias', '3');
  await page.check('#dAtCidOn');
  await page.fill('#dAtCid', 'j 111');
  await page.click('[data-demit="atestado"]');
  assert.match(await text(page, '[data-ferr="atestado:cidAutorizado"]'), /autorização expressa/);
  await page.check('#dAtCidOk');
  await page.waitForFunction(() => /CID: J11\.1 — incluído por solicitação e autorização expressa/.test(document.querySelector('[data-dprev="atestado"]').textContent));
  await page.click('[data-demit="atestado"]');
  await waitFor(() => docsOf(db, c).length === 2, 10000, 'atestado emitido');
  assert.deepEqual(lastDoc(db).payload, { dias: 3, inicio: daySP(c.started_at), fim: addDays(daySP(c.started_at), 2), cid: 'J11.1', cid_autorizado: true, observacao: null });
  // Declaração de comparecimento: com a consulta em andamento, só depois de encerrar (horários do registro).
  await page.click('#dTab-comparecimento');
  assert.match(await text(page, '#dCoWhen'), /sai depois de encerrar a consulta/);
  const n0 = db.called('tele_doc_create').length;
  await page.click('[data-demit="comparecimento"]');
  await page.waitForFunction(() => /depois de encerrar/.test(document.querySelector('[data-derr="comparecimento"]').textContent));
  assert.equal(db.called('tele_doc_create').length, n0, 'nada vai ao banco');
  // Encaminhamento urgente pede a confirmação da orientação.
  await page.click('#dTab-encaminhamento');
  await page.fill('#dEnEsp', 'Cardiologia');
  await page.check('input[name="dEnPrio"][value="urgente"]');
  await page.fill('#dEnMot', 'Dor no peito aos esforços há 1 semana.');
  await page.click('[data-demit="encaminhamento"]');
  assert.match(await text(page, '[data-ferr="encaminhamento:orientouUrgencia"]'), /atendimento imediato/);
  await page.check('#dEnUrg');
  await page.click('[data-demit="encaminhamento"]');
  await waitFor(() => docsOf(db, c).length === 3, 10000, 'encaminhamento emitido');
  assert.equal(lastDoc(db).payload.prioridade, 'urgente');
  // Relatório com CID: só com a autorização expressa do paciente (como no atestado).
  await page.click('#dTab-relatorio');
  await page.fill('#dReTexto', 'Paciente com tosse há 5 dias, sem febre.\nConduta: hidratação e retorno se piorar.');
  await page.check('#dReCidOn');
  await page.fill('#dReCid', 'J11');
  await page.click('[data-demit="relatorio"]');
  assert.match(await text(page, '[data-ferr="relatorio:cidAutorizado"]'), /autorização expressa/);
  await page.check('#dReCidOk');
  await page.waitForFunction(() => /CID: J11 — incluído por solicitação e autorização expressa/.test(document.querySelector('[data-dprev="relatorio"]').textContent));
  await page.click('[data-demit="relatorio"]');
  await waitFor(() => docsOf(db, c).length === 4, 10000, 'relatório emitido');
  assert.deepEqual([lastDoc(db).payload.cid, lastDoc(db).payload.cid_autorizado], ['J11', true]);
  // Orientações (copiadas do registro).
  await page.click('#dTab-orientacoes');
  await page.click('#dOrCopy');
  assert.equal(await page.inputValue('#dOrTexto'), 'Beber bastante água.\nRepouso.');
  await page.click('[data-demit="orientacoes"]');
  await waitFor(() => docsOf(db, c).length === 5, 10000, 'orientações emitidas');
  // Pedido de exames: usa a lista do quadro "Pedido de exames"; a lista não enviada vai antes ao paciente.
  await page.click('#dTab-exames');
  await page.click('[data-demit="exames"]');
  await page.waitForFunction(() => /Escolha os exames/.test(document.querySelector('[data-derr="exames"]').textContent));
  await page.fill('#exSearch', 'hemograma');
  await page.check('#exCatalog input[data-ex="hemograma"]');
  await page.fill('#exSearch', 'torax');
  await page.check('#exCatalog input[data-ex="rx_torax"]');
  await page.fill('#exInd', 'Tosse persistente');
  await page.waitForFunction(() => /2 exames/.test(document.querySelector('#dExSum').textContent));
  await page.click('[data-demit="exames"]');
  await waitFor(() => docsOf(db, c).length === 6, 10000, 'pedido de exames emitido');
  assert.ok(db.called('tele_set_exams').length >= 1, 'a lista foi enviada ao paciente antes');
  assert.deepEqual(lastDoc(db).payload.itens.map((e) => e.code), ['hemograma', 'rx_torax']);
  assert.equal(lastDoc(db).payload.indicacao, 'Tosse persistente');
  await page.waitForFunction(() => document.querySelectorAll('#dList [data-docid]').length === 6);
  // A receita emitida, vista na lista: texto escapado.
  await page.click(`#dList [data-docid="${docsOf(db, c)[0].id}"] [data-dview]`);
  await page.waitForSelector(`#dList [data-docid="${docsOf(db, c)[0].id}"] .td-sheet`);
  assert.equal(await page.locator('#dList img').count(), 0);
  await page.waitForSelector(`#dList [data-docid="${docsOf(db, c)[0].id}"] svg.td-qr`);
  await shot(page, 'docs-02-medico-lista');

  // Encerra a consulta e complementa: a declaração sai com o dia e os horários do registro.
  await page.click('#cEnd');
  await visible(page, '#cEndConfirm');
  assert.equal(await page.isVisible('#cEndDocs'), false, 'sem rascunho pendente');
  await page.click('#cEndYes');
  await visible(page, '#hist .md-h');
  assert.equal(c.status, 'ended');
  await page.click('#hist summary');
  await page.click('#hist [data-amend]');
  await visible(page, '#cDocs');
  await page.waitForFunction(() => document.querySelector('#dIdOk').checked, null, { timeout: 10000 });
  await page.click('#dTab-comparecimento');
  // Perto da meia-noite de Brasília a consulta (começou 10 min antes) atravessa o dia e a frase muda de forma.
  await page.waitForFunction(() => /^Atendimento (em .*, das \d{2}:\d{2} às \d{2}:\d{2}|de .*, às \d{2}:\d{2}, a .*, às \d{2}:\d{2})/.test(document.querySelector('#dCoWhen').textContent));
  await page.click('[data-demit="comparecimento"]');
  await waitFor(() => docsOf(db, c).length === 7, 10000, 'declaração emitida');
  assert.deepEqual(db.called('tele_doc_create').at(-1).args.p_payload, { observacao: null }, 'nenhum horário digitado vai ao banco');
  assert.deepEqual(lastDoc(db).payload, { data: daySP(c.started_at), hora_inicio: timeSP(c.started_at), data_fim: daySP(c.ended_at), hora_fim: timeSP(c.ended_at), observacao: null });
  assert.deepEqual(docsOf(db, c).map((d) => d.kind).sort(), ['atestado', 'comparecimento', 'encaminhamento', 'exames', 'orientacoes', 'receita', 'relatorio']);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'nenhum HTML de quem digita rodou');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('gerar PDF para assinar, enviar o PDF assinado (só o deste documento, um só), cancelar e emitir de novo', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', rqe: '7788', specialty: 'Clínica médica', prof_address: 'Rua das Flores, 100, São Paulo/SP', prof_contact: 'consultorio@exemplo.com' });
  const c = db.addConsult({ doctor_id: carla.id, status: 'ended', accepted_at: iso(Date.now() - 3.2 * 3600e3), started_at: iso(Date.now() - 3 * 3600e3), ended_at: iso(Date.now() - 2 * 3600e3), patient_cpf: '52998224725', patient_address: 'Rua A, 10, Recife/PE' });
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(loginUrl('tok-doc'));
  await visible(page, '#hist .md-h');
  await page.waitForFunction(() => /consultorio@exemplo\.com/.test(document.querySelector('#meProf')?.textContent || ''));
  assert.match(await text(page, '#meProf'), /Rua das Flores, 100, São Paulo\/SP/);
  await page.click('#hist summary');
  await page.waitForFunction(() => /Nenhum documento emitido/.test(document.querySelector('#hist [data-doclist]').textContent));
  await page.click('#hist [data-amend]');
  await visible(page, '#cDocs');
  assert.match(await text(page, '#dProfSum'), /consultorio@exemplo\.com/);
  await page.waitForFunction(() => document.querySelector('#dCpf').value === '529.982.247-25');
  assert.equal(await page.isChecked('#dIdOk'), false, 'a conferência vem do banco (ainda não feita)');
  await page.check('#dIdOk');
  await waitFor(() => !!c.identity_checked_at, 10000, 'conferência registrada');
  await page.click('#dTab-atestado');
  await page.fill('#dAtDias', '2');
  await page.click('[data-demit="atestado"]');
  await page.waitForSelector('#dList [data-dpdf]');
  const atestado = lastDoc(db);
  // Gerar o PDF: A4, textos obrigatórios, código e metadados de documento de saúde.
  const { bytes, name } = await download(page, `#dList [data-docid="${atestado.id}"] [data-dpdf]`);
  if (SHOTS) await writeFile(join(SHOTS, 'docs-atestado.pdf'), bytes);
  assert.equal(name, `IMED-atestado-${atestado.code.slice(0, 5)}-${atestado.code.slice(5)}.pdf`);
  const pdf = await lib.PDFDocument.load(bytes);
  assert.ok(Math.abs(pdf.getPage(0).getWidth() - 595.28) < 0.5 && Math.abs(pdf.getPage(0).getHeight() - 841.89) < 0.5, 'A4');
  const t = await pdfText(bytes);
  const code = `${atestado.code.slice(0, 5)}-${atestado.code.slice(5)}`;
  for (const s of ['Atestado médico', 'Documento emitido em modalidade de telemedicina', 'Carla Mendes — CRM 123456/SP — RQE 7788 (Clínica médica)', 'Rua das Flores, 100, São Paulo/SP',
    'consultorio@exemplo.com', 'Ana Maria da Silva', '529.982.247-25', 'Rua A, 10, Recife/PE', `Código do documento: ${code}`, 'Assinatura digital do(a) médico(a) (ICP-Brasil)', 'por 2 (dois) dias',
    `iniciada às ${timeSP(c.started_at)}`]) {
    assert.ok(t.includes(s), `PDF: ${s}`);
  }
  assert.ok(t.replace(/\n/g, ' ').includes('Este documento só vale com a assinatura digital ICP-Brasil do(a) médico(a) no arquivo PDF.'));
  assert.ok(t.replace(/\n/g, ' ').includes(`${SITE}documento.html`), 'endereço de conferência a partir de IMED_CONFIG.siteUrl');
  const info = pdf.getInfoDict();
  const get = (k) => info.get(lib.PDFName.of(k))?.decodeText();
  assert.equal(get('2.16.76.1.12.1.2'), '', 'tipo: atestado médico');
  assert.equal(get('2.16.76.1.4.2.2.1'), '123456');
  assert.equal(get('2.16.76.1.4.2.2.2'), 'SP');
  assert.equal(get('2.16.76.1.4.2.2.3'), 'Clínica médica');
  assert.equal(get('IMEDCodigo'), atestado.code);
  assert.equal(pdf.getTitle(), `Atestado médico ${code}`);
  assert.match(await text(page, `#dList [data-docid="${atestado.id}"] [data-ditemmsg]`), /Assine com o seu certificado ICP-Brasil/);
  // Envios errados: não é PDF, sem assinatura, maior que 3 MB, de outro documento, assinatura que não é PAdES.
  const up = `#dList [data-docid="${atestado.id}"] [data-dup]`;
  const msg = `#dList [data-docid="${atestado.id}"] [data-ditemmsg]`;
  await chooseFile(page, up, { name: 'foto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('isto não é um PDF') });
  await page.waitForFunction((s) => /não é um PDF/.test(document.querySelector(s).textContent), msg);
  await chooseFile(page, up, { name: 'sem.pdf', mimeType: 'application/pdf', buffer: bytes });
  await page.waitForFunction((s) => /ainda não tem assinatura digital/.test(document.querySelector(s).textContent), msg);
  await chooseFile(page, up, { name: 'grande.pdf', mimeType: 'application/pdf', buffer: fakeSign(bytes, { pad: 3 * 1024 * 1024 }) });
  await page.waitForFunction((s) => /até 3 MB/.test(document.querySelector(s).textContent), msg);
  const other = Buffer.from(fakeSign(bytes).toString('latin1').replaceAll(atestado.code, 'ZZZZZ2345K'), 'latin1');
  await chooseFile(page, up, { name: 'outro.pdf', mimeType: 'application/pdf', buffer: other });
  await page.waitForFunction((s) => /não é deste documento/.test(document.querySelector(s).textContent), msg);
  assert.equal(await page.locator(`#dList [data-docid="${atestado.id}"] [data-dupyes]:visible`).count(), 0, 'PDF de outro documento: nada de "enviar mesmo assim"');
  await chooseFile(page, up, { name: 'estranho.pdf', mimeType: 'application/pdf', buffer: fakeSign(bytes, { sub: '/x.desconhecido' }) });
  await page.waitForFunction((s) => /PAdES/.test(document.querySelector(s).textContent), msg);
  assert.equal(db.called('tele_doc_upload').length, 0, 'nenhum envio errado chegou ao banco');
  // Assinatura sem "ICP-Brasil" (parece gov.br): avisa antes de enviar, porque o PDF não pode ser trocado depois.
  await chooseFile(page, up, { name: 'govbr.pdf', mimeType: 'application/pdf', buffer: fakeSign(bytes, { icp: false }) });
  await visible(page, `#dList [data-docid="${atestado.id}"] [data-dupbox]`);
  assert.match(await text(page, `#dList [data-docid="${atestado.id}"] [data-dupbox]`), /gov\.br/);
  assert.equal(db.called('tele_doc_upload').length, 0);
  // O certo, com quase 3 MB (cerca de 4 MB em base64 na chamada). Enquanto envia, os botões do item ficam parados.
  const signed = fakeSign(bytes, { pad: 3 * 1024 * 1024 - bytes.length - 300 });
  assert.ok(signed.length > 3.1e6 && signed.length <= 3145728, `tamanho ${signed.length}`);
  db.delay.tele_doc_upload = 1500;
  await chooseFile(page, `#dList [data-docid="${atestado.id}"] [data-dupno]`, { name: 'assinado.pdf', mimeType: 'application/pdf', buffer: signed });
  await page.waitForFunction((s) => /Enviando o PDF assinado… não feche a página/.test(document.querySelector(s).textContent), msg);
  assert.equal(await page.isDisabled(`#dList [data-docid="${atestado.id}"] [data-dcancel]`), true, 'cancelar parado durante o envio');
  assert.equal(await page.isDisabled(up), true, 'enviar parado durante o envio');
  await page.waitForFunction((id) => /PDF assinado enviado/.test(document.querySelector(`#dList [data-docid="${id}"] .tl-chip`)?.textContent || ''), atestado.id, { timeout: 20000 });
  db.delay.tele_doc_upload = 0;
  assert.equal(db.called('tele_doc_upload').length, 1);
  const call = db.called('tele_doc_upload').at(-1).args;
  assert.equal(call.p_doc, atestado.id);
  assert.ok(Buffer.from(call.p_pdf_base64, 'base64').equals(signed), 'o banco recebe o arquivo inteiro em base64');
  assert.ok(db.files.get(atestado.id).size === signed.length);
  assert.match(await text(page, `#dList [data-docid="${atestado.id}"]`), /PDF assinado enviado em/);
  assert.match(await text(page, msg), /validar\.iti\.gov\.br/);
  assert.ok(!/Assinado pelo médico/.test(await text(page, '#dList')), 'o IMED não diz que a assinatura vale');
  assert.equal(await page.locator(`#dList [data-docid="${atestado.id}"] [data-dup]`).count(), 0, 'um PDF por documento: sem trocar');
  // O foco do teclado não se perde quando a lista é refeita.
  assert.equal(await page.evaluate((id) => document.activeElement?.closest('[data-docid]')?.dataset.docid, atestado.id), atestado.id);
  // Baixar o PDF enviado (o mesmo arquivo).
  const back = await download(page, `#dList [data-docid="${atestado.id}"] [data-dget]`);
  assert.ok(back.bytes.equals(signed));
  assert.match(back.name, /-assinado\.pdf$/);
  // Cancelar (motivo curto é recusado) e emitir de novo com o formulário preenchido.
  await page.click(`#dList [data-docid="${atestado.id}"] [data-dcancel]`);
  await page.fill(`#dList [data-docid="${atestado.id}"] [data-dcr]`, 'x');
  await page.click(`#dList [data-docid="${atestado.id}"] [data-dcancelyes]`);
  assert.match(await text(page, `#dList [data-docid="${atestado.id}"] [data-dcancelerr]`), /3 a 300/);
  await page.fill(`#dList [data-docid="${atestado.id}"] [data-dcr]`, 'Dias errados: eram 3.');
  await page.click(`#dList [data-docid="${atestado.id}"] [data-dcancelyes]`);
  await page.waitForFunction((id) => /Cancelado/.test(document.querySelector(`#dList [data-docid="${id}"] .tl-chip`)?.textContent || ''), atestado.id);
  assert.equal(atestado.status, 'cancelado');
  assert.match(await text(page, `#dList [data-docid="${atestado.id}"]`), /Motivo: Dias errados: eram 3\./);
  assert.equal(await page.locator(`#dList [data-docid="${atestado.id}"] [data-dpdf]`).count(), 0, 'cancelado não gera PDF');
  await page.click(`#dList [data-docid="${atestado.id}"] [data-dredo]`);
  assert.equal(await page.inputValue('#dAtDias'), '2');
  assert.equal(await page.getAttribute('#dTab-atestado', 'aria-selected'), 'true');
  await page.fill('#dAtDias', '3');
  await page.click('[data-demit="atestado"]');
  await waitFor(() => docsOf(db, c).length === 2, 10000, 'novo atestado');
  assert.notEqual(lastDoc(db).code, atestado.code, 'código novo');
  assert.equal(lastDoc(db).payload.dias, 3);
  await shot(page, 'docs-03-medico-assinado-cancelado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('paciente: documentos durante a consulta, CPF e endereço, rascunho e visualização com marca, PDF assinado para baixar e foco do teclado', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', ...PROFILE });
  const c = db.addConsult({ doctor_id: carla.id, patient_name: 'Ana <b>Negrito</b> Silva' });
  const pat = await newPage(browser, db, { store: { id: c.id, token: c.token, at: iso() } });
  await pat.page.goto(`${BASE}teleconsulta.html`);
  await visible(pat.page, '#vCall');
  await visible(pat.page, '#callDocs');
  await pat.page.waitForFunction(() => /Quando o médico emitir/.test(document.querySelector('#callDocs').textContent));
  assert.match(await text(pat.page, '#callDocs'), /antibiótico, de remédio controlado e as receitas azul e amarela não saem pelo IMED/);
  // O médico pede CPF e endereço: o paciente completa.
  await visible(pat.page, '#callDocs details.tl-mydata');
  assert.equal(await pat.page.getAttribute('#callDocs details.tl-mydata', 'open'), '', 'aberto quando falta');
  await pat.page.fill('#cMyCpf', '111.111.111-11');
  await pat.page.click('#callDocs [data-mydata] button[type="submit"]');
  assert.match(await text(pat.page, '#cMyCpfErr'), /CPF inválido/);
  await pat.page.fill('#cMyCpf', '52998224725');
  assert.equal(await pat.page.inputValue('#cMyCpf'), '529.982.247-25', 'máscara');
  await pat.page.fill('#cMyAddr', 'Rua A,  10,\nCentro, Recife/pe');
  await pat.page.click('#callDocs [data-mydata] button[type="submit"]');
  await pat.page.waitForSelector('#cMyMsg.tl-msg.ok');
  assert.deepEqual([c.patient_cpf, c.patient_address], ['52998224725', 'Rua A, 10, Centro, Recife/PE']);
  assert.equal(await pat.page.inputValue('#cMyAddr'), 'Rua A, 10, Centro, Recife/PE', 'o formulário mostra o que ficou guardado');
  assert.equal(await pat.page.inputValue('#cMyCpf'), '529.982.247-25');
  // Chega um documento durante a consulta (o médico emitiu).
  const exames = emit(db, c, 'exames', { itens: [{ code: 'hemograma', name: 'Hemograma completo', group: 'Sangue', search: 'lab' }, { code: 'ecg', name: 'Eletrocardiograma (ECG)', group: 'Coração', search: 'ecg' }], indicacao: 'Rotina' });
  await pat.page.waitForFunction(() => /Solicitação de exames/.test(document.querySelector('#callDocs').textContent), null, { timeout: 15000 });
  await pat.page.waitForFunction(() => /O médico emitiu: Solicitação de exames/.test(document.querySelector('#toast').textContent));
  const item = `#callDocs [data-pdoc="${exames.id}"]`;
  assert.match(await text(pat.page, item), /Rascunho sem assinatura/);
  assert.match(await text(pat.page, item), /não vale como documento oficial/);
  assert.match(await text(pat.page, item), /Aguardando a assinatura do médico \(até \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}\)/);
  assert.equal(await pat.page.locator(`${item} [data-pdl]`).count(), 0, 'sem PDF assinado: nada para baixar');
  const hrefs = await pat.page.locator(`${item} a`).evaluateAll((as) => as.map((a) => [a.getAttribute('href'), a.getAttribute('target')]));
  assert.ok(hrefs.some(([h, tg]) => h === 'perto.html?exame=lab' && tg === '_blank'), 'onde fazer o exame de laboratório (outra aba durante a chamada)');
  assert.ok(hrefs.some(([h]) => h === 'perto.html?exame=ecg'));
  assert.ok(hrefs.some(([h]) => h === `documento.html?c=${exames.code}`), 'link de conferência');
  await pat.page.click(`${item} [data-pview]`);
  await pat.page.waitForSelector(`${item} .td-sheet.td-mark-draft`);
  assert.match(await text(pat.page, `${item} .td-sheet`), /RASCUNHO SEM ASSINATURA — NÃO VALE COMO DOCUMENTO OFICIAL/);
  assert.match(await text(pat.page, `${item} .td-sheet`), /Ana <b>Negrito<\/b> Silva/);
  assert.equal(await pat.page.locator(`${item} .td-sheet b`).evaluateAll((bs) => bs.some((b) => b.textContent === 'Negrito')), false, 'nome escapado');
  await shot(pat.page, 'docs-04-paciente-chamada');
  // Foco no "Fechar documento" do pedido de exames; chega outro documento: o foco continua no mesmo botão.
  await pat.page.focus(`${item} [data-pview]`);
  const orient = emit(db, c, 'orientacoes', { texto: 'Beber água.' });
  await pat.page.waitForFunction((id) => !!document.querySelector(`#callDocs [data-pdoc="${id}"]`), orient.id, { timeout: 15000 });
  assert.equal(await pat.page.evaluate(() => document.activeElement?.dataset.pview || document.activeElement?.tagName), exames.id, 'foco não cai no <body>');
  assert.match(await label(pat.page.locator(`${item} [data-pview]`)), /Fechar documento: Solicitação de exames, código/);
  // O médico envia o PDF assinado: o paciente baixa o mesmo arquivo e vê uma visualização com marca.
  const signed = tinySigned(exames.code);
  RPC.tele_doc_upload(db, { p_doc: exames.id, p_pdf_base64: signed.toString('base64') }, 'u-doc');
  await pat.page.waitForSelector(`${item} [data-pdl]`, { timeout: 15000 });
  assert.match(await text(pat.page, item), /PDF assinado enviado/);
  assert.match(await text(pat.page, item), /confira a assinatura em validar\.iti\.gov\.br/);
  assert.ok(!/Assinado pelo médico|É ele que vale/.test(await text(pat.page, item)));
  await pat.page.waitForSelector(`${item} .td-sheet.td-mark-view`);
  assert.match(await text(pat.page, `${item} .td-sheet`), /VISUALIZAÇÃO — O DOCUMENTO QUE VALE É O PDF ASSINADO/);
  const dl = await download(pat.page, `${item} [data-pdl]`);
  assert.ok(dl.bytes.equals(signed), 'o mesmo PDF assinado');
  assert.equal(dl.name, `IMED-exames-${exames.code.slice(0, 5)}-${exames.code.slice(5)}-assinado.pdf`);
  // Cancelado: o paciente vê o motivo e não baixa mais.
  RPC.tele_doc_cancel(db, { p_doc: exames.id, p_reason: 'Exame errado' }, 'u-doc');
  await pat.page.waitForFunction((s) => /Cancelado/.test(document.querySelector(s)?.textContent || ''), item, { timeout: 15000 });
  assert.match(await text(pat.page, item), /Motivo do cancelamento: Exame errado/);
  assert.equal(await pat.page.locator(`${item} [data-pdl]`).count(), 0);
  // Encerrada: o resumo também mostra os documentos; a lista de exames para imprimir não se passa pelo pedido.
  RPC.tele_end(db, { p_id: c.id, p_notes: 'ok' }, 'u-doc');
  await visible(pat.page, '#vEnd', 15000);
  await pat.page.waitForFunction(() => /Solicitação de exames/.test(document.querySelector('#endDocs').textContent), null, { timeout: 15000 });
  assert.match(await text(pat.page, '#endDocs'), /Cancelado/);
  assert.equal(await pat.page.inputValue('#eMyCpf'), '529.982.247-25', 'dados já salvos aparecem no resumo');
  assert.equal(await pat.page.evaluate(() => window.__xss), undefined);
  assert.deepEqual(pat.errors, []);
  await pat.context.close();
});

await scenario('paciente: sem o banco de documentos, o quadro diz que não carregou (sem ficar "Carregando…") e não mostra o formulário', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', ...PROFILE });
  const c = db.addConsult({ doctor_id: carla.id });
  db.before.tele_patient_documents = () => { throw new Error('sem a função'); };
  const pat = await newPage(browser, db, { store: { id: c.id, token: c.token, at: iso() } });
  await pat.page.goto(`${BASE}teleconsulta.html`);
  await visible(pat.page, '#callDocs');
  await pat.page.waitForFunction(() => /Não foi possível carregar os documentos agora/.test(document.querySelector('#callDocs').textContent));
  assert.equal(await pat.page.locator('#callDocs [data-mydata]').count(), 0, 'sem o formulário de CPF e endereço');
  delete db.before.tele_patient_documents;
  await pat.page.waitForFunction(() => /Quando o médico emitir/.test(document.querySelector('#callDocs').textContent), null, { timeout: 15000 });
  await visible(pat.page, '#callDocs [data-mydata]');
  assert.deepEqual(pat.errors, []);
  await pat.context.close();
});

await scenario('documento.html: mostra só o mínimo, cancelado, prazo de 7 dias encerrado, não encontrado e código inválido', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla <i>Mendes</i>', crm: '123456', crm_uf: 'SP', ...PROFILE });
  const c = db.addConsult({ doctor_id: carla.id, patient_name: 'Ana Maria da Silva', patient_cpf: '52998224725', patient_address: 'Rua A, 10, Recife/PE' });
  const d = emit(db, c, 'atestado', { dias: 3, cid: 'J11', cid_autorizado: true, observacao: 'Repouso absoluto' });
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(`${BASE}documento.html?c=${d.code.toLowerCase().slice(0, 5)}-${d.code.toLowerCase().slice(5)}`);
  await page.waitForSelector('#dcRes .dc-head');
  const res = await text(page, '#dcRes');
  for (const s of ['Documento encontrado, ainda sem assinatura', 'Atestado médico', 'Carla <i>Mendes</i>', 'CRM-SP 123456', 'A.M.S.', 'Não cancelado', 'Não: ainda sem assinatura']) assert.ok(res.includes(s), s);
  assert.match(res, /prazo: até \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/);
  for (const s of ['Ana Maria', '529.982.247', 'J11', 'Repouso', 'Recife', 'Rua']) assert.ok(!res.includes(s), `não mostra: ${s}`);
  assert.equal(await page.locator('#dcRes i').evaluateAll((is) => is.filter((i) => i.textContent === 'Mendes').length), 0, 'nome do médico escapado');
  assert.equal(await page.inputValue('#dcCode'), `${d.code.slice(0, 5)}-${d.code.slice(5)}`);
  const conferencia = db.called('tele_doc_verify').at(-1);
  assert.equal(conferencia.auth, '', 'só com a chave pública: como visitante, sem Authorization');
  assert.equal(conferencia.apikey, PUBLISHABLE, 'a chave publishable no apikey');
  assert.equal(await page.locator('meta[http-equiv="Content-Security-Policy"]').count(), 1);
  assert.equal(await page.locator('h1').count(), 1);
  await shot(page, 'docs-05-conferencia');
  // Assinado e cancelado.
  RPC.tele_doc_upload(db, { p_doc: d.id, p_pdf_base64: tinySigned(d.code).toString('base64') }, 'u-doc');
  await page.click('#dcBtn');
  await page.waitForFunction(() => /Sim: o médico enviou o PDF assinado/.test(document.querySelector('#dcRes').textContent));
  assert.match(await text(page, '#dcRes'), /validar\.iti\.gov\.br/);
  RPC.tele_doc_cancel(db, { p_doc: d.id, p_reason: 'Motivo sigiloso do médico' }, 'u-doc');
  await page.click('#dcBtn');
  await page.waitForFunction(() => /Documento cancelado/.test(document.querySelector('#dcRes').textContent));
  assert.ok(!(await text(page, '#dcRes')).includes('Motivo sigiloso'), 'não mostra o motivo do cancelamento');
  // Rascunho que passou dos 7 dias sem o PDF assinado: não vale (e não promete mais "quando o médico enviar").
  const old = emit(db, c, 'relatorio', { texto: 'Relatório antigo.' });
  old.created_at = iso(Date.now() - 8 * DAY);
  await page.fill('#dcCode', old.code);
  await page.click('#dcBtn');
  await page.waitForFunction(() => /prazo encerrado/.test(document.querySelector('#dcRes').textContent));
  const late = await text(page, '#dcRes');
  assert.match(late, /não aceite/);
  assert.ok(!/Quando o médico enviar/.test(late));
  // Não encontrado e código inválido (sem chamar o banco).
  await page.fill('#dcCode', 'abcde-2345k');
  await page.click('#dcBtn');
  await page.waitForFunction(() => /Documento não encontrado/.test(document.querySelector('#dcRes').textContent));
  assert.match(await text(page, '#dcRes'), /ABCDE-2345K/);
  const n = db.called('tele_doc_verify').length;
  await page.fill('#dcCode', 'OOOOO-11111');
  await page.click('#dcBtn');
  assert.match(await text(page, '#dcErr'), /sem 0, 1, I e O/);
  assert.equal(db.called('tele_doc_verify').length, n, 'código inválido não vai ao banco');
  assert.equal(await page.getAttribute('#dcCode', 'aria-invalid'), 'true');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('médico com cadastro suspenso e consulta no prazo: vê e cancela, não emite nem envia PDF', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', status: 'approved', ...PROFILE });
  const c = db.addConsult({ doctor_id: carla.id, status: 'ended', started_at: iso(Date.now() - 2 * 3600e3), ended_at: iso(Date.now() - 3600e3), patient_cpf: '52998224725', patient_address: 'Recife/PE' });
  emit(db, c, 'relatorio', { texto: 'Relatório de teste.' });
  carla.status = 'suspended';
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(loginUrl('tok-doc'));
  await visible(page, '#hist .md-h');
  await page.click('#hist summary');
  await page.waitForSelector('#hist [data-docid]');
  assert.equal(await page.locator('#hist [data-dup]').count(), 0, 'sem enviar PDF');
  assert.equal(await page.locator('#hist [data-dpdf]').count(), 1, 'ainda gera o PDF do que emitiu');
  assert.equal(await page.locator('#hist [data-dcancel]').count(), 1, 'pode cancelar');
  assert.equal(await page.isVisible('#signCard'), false, 'sem o quadro "Falta assinar" (não pode enviar)');
  await page.click('#hist [data-amend]');
  await visible(page, '#cDocs');
  await page.waitForFunction(() => !document.querySelector('#dState').hidden);
  assert.match(await text(page, '#dState'), /não está aprovado/);
  assert.equal(await page.isVisible('#dTabs'), false, 'sem abas para emitir');
  assert.equal(await page.isVisible('#dPre'), false);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('sem atendimento, sem documento: consulta só aceita libera ao começar; desistência registrada nunca libera', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', ...PROFILE });
  // O paciente desistiu antes de começar (aceita, sem vídeo, ligação ou mensagem).
  const gone = db.addConsult({ doctor_id: carla.id, status: 'cancelled', patient_name: 'Bruno Desistente', patient_phone: '11911112222', started_at: null, accepted_at: iso(Date.now() - 3600e3), closed_by: 'patient' });
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(loginUrl('tok-doc'));
  await visible(page, '#hist .md-h');
  await page.click('#hist summary');
  await page.click('#hist [data-amend]');
  await visible(page, '#cDocs');
  await page.waitForFunction(() => !document.querySelector('#dState').hidden);
  assert.match(await text(page, '#dState'), /não começou pelo IMED/);
  assert.equal(await page.isVisible('#dTabs'), false);
  // Registra a desistência: continua sem documento (nada de "das 05:38 às 07:38").
  await page.click('#cEnd');
  await visible(page, '#hist .md-h');
  assert.deepEqual([gone.status, gone.started_at], ['ended', null]);
  await page.click('#hist summary');
  await page.click('#hist [data-amend]');
  await visible(page, '#cDocs');
  await page.waitForFunction(() => /não começou pelo IMED/.test(document.querySelector('#dState').textContent));
  assert.equal(await page.isVisible('#dTabs'), false);
  assert.throws(() => emit(db, gone, 'comparecimento', {}), /atendimento_nao_iniciado/, 'o banco também recusa');
  await page.click('#cBack');
  // Consulta aceita e ainda sem atendimento: os documentos esperam o início (aqui, "continuou por telefone").
  const c = db.addConsult({ doctor_id: carla.id, status: 'accepted', started_at: null, accepted_at: iso(Date.now() - 2 * 60e3) });
  await visible(page, '#consult', 20000);
  await page.waitForFunction(() => /quando o atendimento começar/.test(document.querySelector('#dState').textContent), null, { timeout: 15000 });
  assert.equal(await page.isVisible('#dTabs'), false, 'sem abas antes do atendimento');
  assert.equal(await page.isVisible('#dIdOk'), false, 'sem conferência de identidade antes do atendimento');
  await page.click('#cPhoneNote');
  await waitFor(() => !!c.started_at, 10000, 'início registrado');
  await visible(page, '#dTabs');
  assert.equal(await page.isVisible('#dState'), false);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('dados do paciente: o que ele salva aparece para o médico sem redigitar; mudança depois da revisão para a emissão e desfaz a conferência', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', ...PROFILE });
  const c = db.addConsult({ doctor_id: carla.id, patient_name: 'Joana Lima' });
  const doc = await newPage(browser, db);
  await doctorIn(doc.page);
  const pat = await newPage(browser, db, { store: { id: c.id, token: c.token, at: iso() } });
  await pat.page.goto(`${BASE}teleconsulta.html`);
  await visible(pat.page, '#callDocs [data-mydata]');
  await pat.page.fill('#cMyCpf', '529.982.247-25');
  await pat.page.fill('#cMyAddr', 'Rua A, 10, Centro, Recife/PE');
  await pat.page.click('#callDocs [data-mydata] button[type="submit"]');
  await pat.page.waitForSelector('#cMyMsg.tl-msg.ok');
  // O médico vê sem perguntar de novo (a tela relê a cada ~10 s) e é avisado.
  await doc.page.waitForFunction(() => document.querySelector('#dCpf').value === '529.982.247-25' && document.querySelector('#dAddr').value === 'Rua A, 10, Centro, Recife/PE', null, { timeout: 25000 });
  assert.match(await text(doc.page, '#dPatMsg'), /atualizou os dados na página dele/);
  await doc.page.check('#dIdOk');
  await waitFor(() => !!c.identity_checked_at, 10000, 'conferência');
  await doc.page.click('#dTab-orientacoes');
  await doc.page.fill('#dOrTexto', 'Repouso e hidratação.');
  await doc.page.waitForFunction(() => /529\.982\.247-25/.test(document.querySelector('[data-dprev="orientacoes"]').textContent));
  // O paciente muda CPF e endereço depois que o médico revisou: a emissão para, a tela mostra os novos e a conferência cai.
  await pat.page.fill('#cMyCpf', '111.444.777-35');
  await pat.page.fill('#cMyAddr', 'Hotel Beira Mar, quarto 12, Recife/PE');
  await pat.page.click('#callDocs [data-mydata] button[type="submit"]');
  await waitFor(() => c.patient_cpf === '11144477735', 10000, 'paciente salvou');
  assert.equal(c.identity_checked_at, null, 'trocar o CPF desfaz a conferência de identidade');
  const n0 = db.called('tele_doc_create').length;
  await doc.page.click('[data-demit="orientacoes"]');
  await doc.page.waitForFunction(() => /o paciente atualizou o CPF ou o endereço/.test(document.querySelector('[data-derr="orientacoes"]').textContent));
  assert.equal(db.called('tele_doc_create').length, n0, 'nada foi emitido com os dados antigos');
  assert.equal(await doc.page.inputValue('#dCpf'), '111.444.777-35');
  assert.equal(await doc.page.inputValue('#dAddr'), 'Hotel Beira Mar, quarto 12, Recife/PE');
  assert.equal(await doc.page.isChecked('#dIdOk'), false);
  await doc.page.waitForFunction(() => /111\.444\.777-35/.test(document.querySelector('[data-dprev="orientacoes"]').textContent));
  // Confere de novo e emite: o documento sai com o que o médico revisou.
  await doc.page.check('#dIdOk');
  await waitFor(() => !!c.identity_checked_at, 10000, 'conferência de novo');
  await doc.page.click('[data-demit="orientacoes"]');
  await waitFor(() => docsOf(db, c).length === 1, 10000, 'orientações emitidas');
  assert.deepEqual([lastDoc(db).patient_snapshot.cpf, lastDoc(db).patient_snapshot.address], ['11144477735', 'Hotel Beira Mar, quarto 12, Recife/PE']);
  // Mudança no exato momento da emissão (depois da releitura): o banco recusa e a tela mostra o que mudou.
  db.before.tele_doc_create = () => { c.patient_address = 'Rua Nova, 99, Olinda/PE'; delete db.before.tele_doc_create; };
  await doc.page.fill('#dOrTexto', 'Voltar se tiver febre.');
  await doc.page.click('[data-demit="orientacoes"]');
  await doc.page.waitForFunction(() => /atualizou o CPF ou o endereço/.test(document.querySelector('[data-derr="orientacoes"]').textContent));
  await doc.page.waitForFunction(() => document.querySelector('#dAddr').value === 'Rua Nova, 99, Olinda/PE');
  assert.equal(docsOf(db, c).length, 1, 'nenhum documento com o endereço que o médico não viu');
  // "Não possui CPF": fica gravado e sai como "(não possui CPF)".
  await doc.page.check('#dNoCpf');
  await doc.page.click('#dPatSave');
  await waitFor(() => c.patient_no_cpf === true && c.patient_cpf === null, 10000, 'não possui CPF gravado');
  // Espera a tela receber a resposta: o CPF mudou, a conferência anterior cai e a caixa desmarca. Sem isto, numa
  // máquina mais lenta (o GitHub) a caixa ainda está marcada da conferência anterior, o "check" não faz nada
  // e a conferência nova nunca é registrada.
  await doc.page.waitForFunction(() => !document.querySelector('#dPatSave').disabled && !document.querySelector('#dIdOk').checked, null, { timeout: 10000 });
  await doc.page.check('#dIdOk');
  await waitFor(() => !!c.identity_checked_at, 10000, 'conferência');
  await doc.page.click('#dTab-atestado');
  await doc.page.fill('#dAtDias', '1');
  await doc.page.waitForFunction(() => /que Joana Lima \(não possui CPF\) foi atendido\(a\)/.test(document.querySelector('[data-dprev="atestado"]').textContent));
  assert.ok(!/CPF não possui CPF/.test(await text(doc.page, '[data-dprev="atestado"]')));
  await doc.page.click('[data-demit="atestado"]');
  await waitFor(() => docsOf(db, c).length === 2, 10000, 'atestado emitido');
  assert.deepEqual([lastDoc(db).patient_snapshot.cpf, lastDoc(db).patient_snapshot.sem_cpf], [null, true]);
  assert.deepEqual(doc.errors, []);
  assert.deepEqual(pat.errors, []);
  await doc.context.close();
  await pat.context.close();
});

await scenario('"Falta assinar": lista do médico, selo no histórico, prazo de 7 dias, enviar e cancelar dali', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', ...PROFILE });
  const c1 = db.addConsult({ doctor_id: carla.id, status: 'ended', patient_name: 'Paula Rocha', started_at: iso(Date.now() - 27 * 3600e3), ended_at: iso(Date.now() - 26 * 3600e3), patient_cpf: '52998224725', patient_address: 'Rua A, 10, Recife/PE' });
  const c0 = db.addConsult({ doctor_id: carla.id, status: 'ended', patient_name: 'Rui Antigo', patient_phone: '11922223333', started_at: iso(Date.now() - 9 * DAY), ended_at: iso(Date.now() - 9 * DAY + 3600e3), patient_address: 'Olinda/PE' });
  c1.status = 'in_call'; c1.ended_at = null; c0.status = 'in_call'; c0.ended_at = null;
  const d1 = emit(db, c1, 'atestado', { dias: 2 });
  const d3 = emit(db, c1, 'orientacoes', { texto: 'Repouso.' });
  const d2 = emit(db, c0, 'relatorio', { texto: 'Relatório antigo.' });
  Object.assign(c1, { status: 'ended', ended_at: iso(Date.now() - 26 * 3600e3) });
  Object.assign(c0, { status: 'ended', ended_at: iso(Date.now() - 9 * DAY + 3600e3) });
  d1.created_at = iso(Date.now() - 26 * 3600e3);
  d2.created_at = iso(Date.now() - 8 * DAY);
  RPC.tele_doc_upload(db, { p_doc: d3.id, p_pdf_base64: tinySigned(d3.code).toString('base64') }, 'u-doc');
  db.painel = true; // com o painel "Agora na plataforma"
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(loginUrl('tok-doc'));
  await visible(page, '#signCard');
  assert.equal(await text(page, '#signCount'), '2');
  // Painel: conta só o que ainda dá para assinar (o vencido fica na lista, para cancelar); "Ver e assinar" leva à lista.
  const signNum = () => page.$eval('[data-num="documentos_para_assinar"]', (li) => `${li.querySelector('.md-nv').textContent.trim()} ${li.querySelector('.md-nl').textContent.trim()}`);
  await page.waitForFunction(() => !document.querySelector('#painel').hidden);
  assert.equal(await signNum(), '1 documento para assinar');
  await page.click('#nowSign');
  await page.waitForFunction(() => document.activeElement?.id === 'signTitle');
  assert.match(await text(page, `#signList [data-docid="${d1.id}"]`), /Paciente: Paula Rocha/);
  assert.match(await text(page, `#signList [data-docid="${d1.id}"]`), /Envie o PDF assinado até/);
  assert.match(await text(page, `#signList [data-docid="${d2.id}"]`), /prazo para enviar o PDF assinado \(7 dias\) terminou/);
  assert.match(await text(page, `#signList [data-docid="${d2.id}"] .tl-chip`), /Não assinado \(prazo encerrado\)/);
  assert.equal(await page.locator(`#signList [data-docid="${d2.id}"] [data-dup]`).count(), 0, 'depois de 7 dias não envia mais');
  assert.match(await text(page, '#signNote'), /1 documento passou do prazo de 7 dias/);
  assert.equal(await page.locator(`#signList [data-docid="${d3.id}"]`).count(), 0, 'o assinado não aparece');
  // Selo no histórico.
  await visible(page, `#hist [data-hbadge="${c1.id}"]`);
  assert.equal(await text(page, `#hist [data-hbadge="${c1.id}"]`), '1 sem assinatura');
  // Gera o PDF e envia dali, sem abrir a consulta.
  const { bytes } = await download(page, `#signList [data-docid="${d1.id}"] [data-dpdf]`);
  assert.ok((await pdfText(bytes)).includes('Paula Rocha'));
  await chooseFile(page, `#signList [data-docid="${d1.id}"] [data-dup]`, { name: 'assinado.pdf', mimeType: 'application/pdf', buffer: fakeSign(bytes) });
  await waitFor(() => !!d1.signed_at, 15000, 'PDF enviado');
  await page.waitForFunction(() => document.querySelector('#signCount').textContent === '1');
  // Enviado: o painel pede os números na hora (sem esperar os 20 s) e o "Ver e assinar" some.
  await page.waitForFunction(() => document.querySelector('[data-num="documentos_para_assinar"] .md-nv').textContent.trim() === '0');
  assert.equal(await signNum(), '0 documentos para assinar');
  assert.equal(await page.isVisible('#nowSign'), false);
  await page.waitForFunction((id) => document.querySelector(`#hist [data-hbadge="${id}"]`).hidden, c1.id);
  // Cancela o vencido, com motivo: a lista fica vazia e o quadro some.
  await page.click(`#signList [data-docid="${d2.id}"] [data-dcancel]`);
  await page.fill(`#signList [data-docid="${d2.id}"] [data-dcr]`, 'Não foi assinado no prazo.');
  await page.click(`#signList [data-docid="${d2.id}"] [data-dcancelyes]`);
  await waitFor(() => d2.status === 'cancelado', 10000, 'cancelado');
  await page.waitForFunction(() => document.querySelector('#signCard').hidden);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('rascunho de documento não emitido: aviso ao encerrar e ao voltar para a fila', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', ...PROFILE });
  const c = db.addConsult({ doctor_id: carla.id, patient_cpf: '52998224725', patient_address: 'Rua A, 10, Recife/PE', identity_checked_at: iso() });
  const { page, errors, context } = await newPage(browser, db);
  await doctorIn(page);
  await page.click('#dTab-relatorio');
  await page.fill('#dReTexto', 'Relatório ainda não emitido.');
  await page.click('#cEnd');
  await visible(page, '#cEndConfirm');
  await visible(page, '#cEndDocs');
  assert.match(await text(page, '#cEndDocs'), /rascunho de documento ainda não emitido: Relatório médico/);
  await page.click('#cEndDocs [data-gotab="relatorio"]');
  assert.equal(await page.isVisible('#cEndConfirm'), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dTab-relatorio');
  await page.click('[data-demit="relatorio"]');
  await waitFor(() => docsOf(db, c).length === 1, 10000, 'relatório emitido');
  await page.click('#cEnd');
  await visible(page, '#cEndConfirm');
  assert.equal(await page.isVisible('#cEndDocs'), false, 'nada pendente depois de emitir');
  await page.click('#cEndYes');
  await visible(page, '#hist .md-h');
  // Complemento (até 24 h): rascunho e "Voltar para a fila".
  await page.click('#hist summary');
  await page.click('#hist [data-amend]');
  await visible(page, '#cDocs');
  await page.click('#dTab-orientacoes');
  await page.fill('#dOrTexto', 'Rascunho de orientações.');
  await page.click('#cBack');
  await visible(page, '#cBackConfirm');
  assert.match(await text(page, '#cBackDocs'), /Orientações ao paciente/);
  await page.click('#cBackNo');
  assert.equal(await page.isVisible('#consult'), true, 'continua na consulta');
  assert.equal(await page.inputValue('#dOrTexto'), 'Rascunho de orientações.', 'o rascunho continua');
  await page.click('#cBack');
  await page.click('#cBackYes');
  await visible(page, '#hist .md-h');
  assert.equal(await page.isVisible('#consult'), false);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (390 px): documentos do médico e do paciente e a conferência sem rolagem lateral, mesmo com textos longos sem espaço', async () => {
  const db = makeDb();
  const carla = db.addDoctor({ user_id: 'u-doc', full_name: 'Carla Mendes de Albuquerque Figueiredo', crm: '123456', crm_uf: 'SP', rqe: '7788', specialty: 'Medicina de família e comunidade',
    prof_address: 'AvenidaDoutorEnéasCarvalhodeAguiar,255,sala1234,CerqueiraCésar,SãoPaulo/SP', prof_contact: 'consultorio.da.doutora.carla.mendes.albuquerque.figueiredo@clinica-exemplo.com.br' });
  const c = db.addConsult({ doctor_id: carla.id, patient_name: 'Ana Maria Aparecida dos Santos Figueiredo Albuquerque', patient_cpf: '52998224725', patient_address: 'RuaProfessorDoutorFulanodeTalSobrenomeComprido,1234,apartamento56,BoaViagem,Recife/PE' });
  emit(db, c, 'receita', { tipo: 'simples', endereco_residencial: true, itens: [{ medicamento: 'Paracetamolsupercalifragilisticoexpialidocioso', concentracao: '750 mg', via: 'oral', posologia: 'Tomar 1 comprimido a cada 8 horas se tiver dor ou febre', quantidade: '1 caixa com 20 comprimidos', duracao: '3 dias' }] });
  const doc = await newPage(browser, db, { mobile: true });
  await doctorIn(doc.page);
  await doc.page.waitForFunction(() => document.querySelector('#dIdOk').checked);
  await doc.page.click('#dTab-receita');
  await doc.page.fill('#dRx1-medicamento', 'Dipirona');
  await doc.page.waitForSelector('#dList [data-dview]');
  await doc.page.click('#dList [data-dview]');
  await doc.page.waitForSelector('#dList .td-sheet');
  await noOverflow(doc.page, 'médico (documentos)');
  // Resumos que abrem e fecham: área de toque de pelo menos 44 px.
  for (const sel of ['#cDocs .md-help > summary', '[data-dprev="receita"]']) {
    const h = await doc.page.evaluate((s) => (document.querySelector(s).closest('details') || document.querySelector(s)).querySelector('summary').getBoundingClientRect().height, sel);
    assert.ok(h >= 44, `${sel}: ${h}px`);
  }
  await shot(doc.page, 'docs-06-medico-celular');
  const pat = await newPage(browser, db, { mobile: true, store: { id: c.id, token: c.token, at: iso() } });
  await pat.page.goto(`${BASE}teleconsulta.html`);
  await visible(pat.page, '#callDocs');
  await pat.page.waitForSelector('#callDocs [data-pview]');
  await pat.page.click('#callDocs [data-pview]');
  await pat.page.waitForSelector('#callDocs .td-sheet');
  await noOverflow(pat.page, 'paciente (documentos)');
  const hs = await pat.page.evaluate(() => document.querySelector('#callDocs details.tl-mydata > summary').getBoundingClientRect().height);
  assert.ok(hs >= 44, `resumo "Seus dados": ${hs}px`);
  await shot(pat.page, 'docs-07-paciente-celular');
  await pat.page.goto(`${BASE}documento.html?c=${lastDoc(db).code}`);
  await pat.page.waitForSelector('#dcRes .dc-head');
  await noOverflow(pat.page, 'conferência');
  assert.deepEqual(doc.errors, []);
  assert.deepEqual(pat.errors, []);
  await doc.context.close();
  await pat.context.close();
});

await browser.close();
server.close();
const failed = results.filter((r) => r[0] !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
if (failed.length) process.exitCode = 1;
