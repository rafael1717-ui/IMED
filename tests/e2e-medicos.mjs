// Teste de ponta a ponta da frente MÉDICOS num navegador de verdade (Playwright):
// - para-medicos.html ("Atenda pelo IMED"): abre; logo depois da abertura, o quadro "Situação do IMED hoje"
//   (inscrição no CRM sendo confirmada, razão social e CNPJ em atualização, registro sem a certificação NGS2); o
//   fluxograma é uma lista numerada acessível, com os 7 passos em ordem ("Passo N" no título de cada um), os dois
//   caminhos depois da conferência (Recusado → corrigir e voltar ao passo 3; Aprovado → passo 5), lado a lado na
//   ordem da leitura, e as setas só de desenho; fila por ordem de chegada; endereço e contato profissionais; cita a
//   Res. CFM 2.314/2022 e a LGPD; não promete ganho nem pacientes e não mostra preço; "Fazer minha inscrição" leva a
//   medico.html; rodapé com o médico responsável e "Para médicos"; sem rolagem lateral em 390 px; sem erro no console;
// - medico.html: etapas do cadastro (Conta criada → Envio do cadastro → Conferência do CRM → Aprovado → Disponível)
//   certas para quem ainda não tem cadastro, em análise, aprovado (e disponível), recusado (e reenviado) e suspenso,
//   com o que fazer; etapas escondidas quando a leitura do cadastro falha (sem voltar com a situação antiga); e a
//   INSCRIÇÃO COMPLETA do médico (e-mail, cadastro, conferência e aprovação pela equipe do IMED, aviso e
//   "Disponível para atender"), com capturas de tela de cada passo para mostrar o fluxo;
// - Plataforma de atendimento (medico.html): painel "Agora na plataforma" do médico aprovado com os números do banco
//   (tele_painel_medico, simulado com as regras de supabase/migrations/20261030191354_painel_medico.sql): aguardando
//   (com "o primeiro espera há"), em atendimento, atendimentos hoje, documentos para assinar (leva a "Falta assinar";
//   com a lista fora do ar, diz isso em vez de "nenhum documento") e médicos disponíveis ("Contando você." só ao lado de
//   números que já contam o médico, mesmo com o servidor lento ou fora do ar); sem dado de paciente; "Ficar
//   disponível"/"Ver a fila"; quem não está aprovado não vê números (nem pede); banco sem a função (404/PGRST202) ou
//   sem permissão (403): o painel some sem erro; 401 passageiro (entrada vencida) e servidor fora do ar: os números de
//   antes ficam e o painel volta sozinho; a cada 20 s com a aba à vista (relógio controlado pelo teste), parado com a
//   aba escondida (também aberta já escondida), e o leitor de tela avisado só quando muda quem espera e a fila não
//   está na tela (com a fila, quem avisa é ela); topo com o nome da plataforma, menu sempre com Painel, Fila,
//   Consultas, Documentos e Meu cadastro para o médico aprovado, e "Site do IMED"; celular de 360 px sem rolagem
//   lateral, números dois a dois, painel resumido com o médico disponível (a fila mais perto do topo), menu que abre e
//   fecha, alvos de 44 px;
// - ligações: página inicial ("É médico? Atenda pelo IMED"), rodapé (scripts/rodape.mjs, com "Área do médico" depois
//   de "Para médicos"), sitemap.xml e topo da área do médico;
// - acessibilidade: auditoria do axe-core (WCAG A/AA) na página nova, nas etapas, no topo da plataforma e no painel,
//   quando o axe-core estiver instalado.
// O banco e a entrada pelo link do e-mail são simulados EM MEMÓRIA (context.route), com as mesmas regras de
// supabase/migrations/*_teleconsulta.sql usadas aqui (como em tests/e2e-tele.mjs).
// Rodar: node tests/e2e-medicos.mjs   (precisa do pacote "playwright")
// Opcional: SHOTS=pasta salva as capturas de tela (medicos-01 ... para mostrar o fluxo); E2E_PORT muda a porta
//           (padrão 4771); ONLY="trecho" roda só os cenários com esse trecho no nome; AXE_PATH=<pasta do axe-core>.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, vigiarChaves } from './regra-chaves.mjs';
import { GRUPOS, rodapeHtml } from '../scripts/rodape.mjs';
import { SITE } from './endereco.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

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
const PORT = Number(process.env.E2E_PORT) || 4771; // E2E_PORT: outra porta para rodar em paralelo
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

/* ======================= axe-core (fora do site; opcional) ======================= */
function findAxe() {
  const tries = [];
  if (process.env.AXE_PATH) {
    const p = resolve(process.env.AXE_PATH);
    tries.push(() => require.resolve(p)); // arquivo axe.js / axe.min.js ou a pasta do pacote
    tries.push(() => createRequire(join(p, 'noop.js')).resolve('axe-core')); // pasta com node_modules/axe-core
  }
  tries.push(() => require.resolve('axe-core')); // node_modules do projeto (no GitHub, o workflow instala)
  for (const t of tries) {
    try {
      const f = t();
      if (f && existsSync(f)) { const min = join(dirname(f), 'axe.min.js'); return existsSync(min) ? min : f; }
    } catch { /* tenta o próximo */ }
  }
  return null;
}
const AXE = findAxe();
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/* ======================= banco simulado (cadastro e conferência do médico) ======================= */
const USERS = {
  'tok-new': { id: 'u-new', email: 'bia@exemplo.com' },
  'tok-pend': { id: 'u-pend', email: 'pedro@exemplo.com' },
  'tok-ok': { id: 'u-ok', email: 'carla@exemplo.com' },
  'tok-rej': { id: 'u-rej', email: 'rui@exemplo.com' },
  'tok-sus': { id: 'u-sus', email: 'sara@exemplo.com' },
  'tok-admin': { id: 'u-admin', email: 'equipe@exemplo.com' },
};
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const DOCTOR_FNS = new Set(['tele_doctor_me', 'tele_doctor_register', 'tele_set_available', 'tele_queue', 'tele_history', 'tele_doctor_profile', 'tele_doc_pending',
  'tele_painel_medico', 'tele_admin_doctors', 'tele_admin_save_checks', 'tele_admin_set_doctor']);
const DAY = 86400e3;
const iso = (t = Date.now()) => new Date(t).toISOString();
const digits = (v) => String(v ?? '').replace(/\D/g, '');
class PgErr extends Error { constructor(message, details = null) { super(message); this.details = details; } }
// Dia de hoje em São Paulo (sem horário de verão desde 2019: UTC-3) e o começo dele.
const todaySP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const startOfTodaySP = () => Date.parse(`${todaySP()}T00:00:00-03:00`);
// "HH:MM" no horário de Brasília (como a página mostra "Atualizado às HH:MM").
const hhmmSP = (t) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));

function makeDb() {
  // failMe: tele_doctor_me falha. consults/docs: só o mínimo da fila e dos documentos para os números do painel.
  // painelErr: resposta de erro de tele_painel_medico ({ status, body }, ou função que devolve isso); painelAt: hora fixa
  // dos números (atualizado_em); painelDelay: o painel responde devagar (ms; a conta é feita depois da espera);
  // fail: outras funções com erro simulado ({ nome: { status, body } }).
  const db = { doctors: new Map(), admins: new Set(['u-admin']), checks: [], calls: [], otp: [], failMe: false, consults: [], docs: [], painelErr: null, painelAt: null,
    painelDelay: 0, fail: {} };
  db.addDoctor = (d) => {
    const row = { id: randomUUID(), rqe: null, specialty: null, phone: null, status: 'approved', review_note: null, reviewed_at: null, reviewed_by: null,
      checked_at: iso(Date.now() - DAY), available_until: null, created_at: iso(Date.now() - DAY), updated_at: iso(), ...d };
    db.doctors.set(row.id, row);
    return row;
  };
  db.addConsult = (c) => {
    const row = { id: randomUUID(), status: 'waiting', patient_name: 'Paciente', patient_birthdate: '1980-01-01', reason: 'Teste', for_other: false, relationship: null,
      doctor_id: null, accepted_at: null, started_at: null, ended_at: null, created_at: iso(), ...c };
    db.consults.push(row);
    return row;
  };
  db.addDoc = (d) => {
    const row = { id: randomUUID(), consultation_id: randomUUID(), kind: 'atestado', payload: {}, code: 'ABCD2345', status: 'emitido', signed_at: null, created_at: iso(),
      doctor_snapshot: {}, patient_snapshot: { name: 'Paciente' }, ...d };
    db.docs.push(row);
    return row;
  };
  db.called = (fn) => db.calls.filter((c) => c.fn === fn);
  return db;
}
// Um médico em cada situação (para os cenários das etapas).
function seedDb() {
  const db = makeDb();
  db.addDoctor({ user_id: 'u-pend', full_name: 'Pedro Lima', crm: '55443', crm_uf: 'RJ', status: 'pending', checked_at: null });
  db.addDoctor({ user_id: 'u-ok', full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', rqe: '7788', specialty: 'Clínica médica' });
  db.addDoctor({ user_id: 'u-rej', full_name: 'Rui Prado', crm: '11223', crm_uf: 'MG', status: 'rejected', checked_at: null, review_note: 'O número do CRM não confere com o nome na busca do CFM. Confira e envie de novo.' });
  db.addDoctor({ user_id: 'u-sus', full_name: 'Sara Nunes', crm: '99887', crm_uf: 'BA', status: 'suspended', review_note: 'A conferência anual do cadastro venceu.' });
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
// O que falta na última conferência para aprovar (como private.tele_check_missing).
function checkMissing(c, d) {
  if (!c) return 'conferencia';
  if (['full_name', 'crm', 'crm_uf', 'rqe', 'specialty'].some((k) => (c[k] ?? null) !== (d[k] ?? null))) return 'dados';
  if (!c.cfm_active) return 'cfm';
  if (d.rqe && !c.rqe_checked) return 'rqe';
  if (!((c.id_video && c.crm_card) || c.icp_signature)) return 'identidade';
  return null;
}
const lastCheck = (db, d) => [...db.checks].reverse().find((c) => c.doctor_id === d.id) || null;
const emailOf = (uid) => Object.values(USERS).find((u) => u.id === uid)?.email || null;
// Situação de fato (private.tele_effective_status): esperando há mais de 2 h ou aceita sem começar há mais de 30 min =
// expirada; em andamento há mais de 3 h = encerrada.
function effective(c, now = Date.now()) {
  if (c.status === 'waiting' && Date.parse(c.created_at) < now - 2 * 3600e3) return 'expired';
  if (c.status === 'accepted' && !c.started_at && Date.parse(c.accepted_at) < now - 30 * 60e3) return 'expired';
  if (['accepted', 'in_call'].includes(c.status) && c.started_at && Date.parse(c.started_at) < now - 3 * 3600e3) return 'ended';
  return c.status;
}
// Números do painel do médico com as regras de supabase/migrations/20261030191354_painel_medico.sql (tele_painel_medico):
// só contagens e minutos, nenhum dado de paciente.
function painel(db, d) {
  const now = Date.now();
  const waiting = db.consults.filter((c) => c.status === 'waiting' && Date.parse(c.created_at) >= now - 2 * 3600e3);
  const oldest = waiting.length ? Math.min(...waiting.map((c) => Date.parse(c.created_at))) : null;
  const ini = startOfTodaySP();
  const done = db.consults.filter((c) => {
    if (c.doctor_id !== d.id || !c.started_at || effective(c, now) !== 'ended' || Date.parse(c.created_at) < ini - DAY) return false;
    // O fim é o que vem primeiro: o gravado ou 3 h depois do começo (com 3 h a consulta já conta como encerrada).
    const end = Math.min(c.ended_at ? Date.parse(c.ended_at) : Infinity, Date.parse(c.started_at) + 3 * 3600e3);
    return end >= ini && end < ini + DAY;
  });
  return {
    aguardando: waiting.length,
    espera_mais_longa_min: oldest == null ? null : Math.max(0, Math.floor((now - oldest) / 60000)),
    em_atendimento: db.consults.filter((c) => c.doctor_id === d.id && ['accepted', 'in_call'].includes(c.status) && ['accepted', 'in_call'].includes(effective(c, now))).length,
    atendidos_hoje: done.length,
    documentos_para_assinar: db.docs.filter((x) => x.doctor_id === d.id && x.status === 'emitido' && !x.signed_at && Date.parse(x.created_at) >= now - 7 * DAY).length,
    medicos_disponiveis: [...db.doctors.values()].filter((o) => o.status === 'approved' && o.available_until && Date.parse(o.available_until) > now).length,
    atualizado_em: db.painelAt || iso(now).replace(/\.\d{3}Z$/, 'Z'),
  };
}

const RPC = {
  tele_doctor_me(db, a, uid) {
    const d = docOf(db, uid);
    const f = ['id', 'full_name', 'crm', 'crm_uf', 'rqe', 'specialty', 'phone', 'status', 'review_note', 'reviewed_at', 'available_until', 'created_at', 'updated_at', 'checked_at'];
    return [{ ...Object.fromEntries(f.map((k) => [k, d ? d[k] : null])), is_admin: db.admins.has(uid) }];
  },
  tele_doctor_register(db, a, uid) {
    if (!uid) throw new PgErr('sem_login');
    const name = String(a.p_full_name ?? '').replace(/\s+/g, ' ').trim();
    const crm = digits(a.p_crm).replace(/^0+/, '');
    const uf = String(a.p_crm_uf ?? '').trim().toUpperCase();
    const rqe = digits(a.p_rqe).replace(/^0+/, '') || null;
    const spec = String(a.p_specialty ?? '').replace(/\s+/g, ' ').trim() || null;
    let phone = digits(a.p_phone) || null;
    if (name.length < 5 || name.length > 120 || !/\S \S/.test(name)) throw new PgErr('dados_invalidos', 'nome');
    if (!/^[1-9][0-9]{0,9}$/.test(crm)) throw new PgErr('dados_invalidos', 'crm');
    if (!UFS.includes(uf)) throw new PgErr('dados_invalidos', 'uf');
    if ((spec === null) !== (rqe === null) || (spec && (spec.length < 2 || spec.length > 80))) throw new PgErr('dados_invalidos', 'especialidade');
    if (phone) { if ((phone.length === 12 || phone.length === 13) && phone.startsWith('55')) phone = phone.slice(2); if (!/^[1-9][1-9][0-9]{8,9}$/.test(phone)) throw new PgErr('dados_invalidos', 'telefone'); }
    const mine = docOf(db, uid);
    if (!mine) { db.addDoctor({ user_id: uid, full_name: name, crm, crm_uf: uf, rqe, specialty: spec, phone, status: 'pending', checked_at: null, created_at: iso() }); return 'pending'; }
    const changed = [mine.full_name, mine.crm, mine.crm_uf, mine.rqe, mine.specialty].join('|') !== [name, crm, uf, rqe, spec].join('|');
    const st = mine.status === 'rejected' ? 'pending' : mine.status === 'approved' && changed ? 'pending' : mine.status;
    Object.assign(mine, { full_name: name, crm, crm_uf: uf, rqe, specialty: spec, phone, review_note: st === 'pending' && mine.status !== 'pending' ? null : mine.review_note,
      status: st, available_until: st === 'approved' ? mine.available_until : null, updated_at: iso() });
    return st;
  },
  tele_set_available(db, a, uid) {
    if (a.p_on) { const d = me(db, uid, true); d.available_until = iso(Date.now() + 90e3); return d.available_until; }
    if (!uid) throw new PgErr('sem_login');
    const d = docOf(db, uid); if (d) d.available_until = null;
    return null;
  },
  // Fila (como tele_queue): primeiro as consultas dele em andamento, depois quem espera (há até 2 h), por ordem de chegada.
  tele_queue(db, a, uid) {
    const d = me(db, uid, true);
    const now = Date.now();
    const own = db.consults.filter((c) => c.doctor_id === d.id && ['accepted', 'in_call'].includes(c.status) && ['accepted', 'in_call'].includes(effective(c, now)));
    const wait = db.consults.filter((c) => c.status === 'waiting' && Date.parse(c.created_at) >= now - 2 * 3600e3).sort((x, y) => x.created_at.localeCompare(y.created_at));
    return [...own, ...wait].map((c) => ({ id: c.id, status: c.status, patient_name: c.patient_name, age_years: 46, reason: c.reason, for_other: c.for_other,
      relationship: c.relationship, wait_minutes: Math.floor((now - Date.parse(c.created_at)) / 60000), created_at: c.created_at, accepted_at: c.accepted_at, seen_seconds: 5 }));
  },
  tele_history() { return []; }, // sem consultas anteriores (não é o assunto deste teste)
  tele_doctor_profile(db, a, uid) { me(db, uid, false); return [{ prof_address: null, prof_contact: null }]; },
  // "Falta assinar" (como tele_doc_pending): emitidos sem PDF assinado dos últimos 30 dias; expired = passou dos 7 dias.
  tele_doc_pending(db, a, uid) {
    const d = me(db, uid, true);
    const now = Date.now();
    return db.docs.filter((x) => x.doctor_id === d.id && x.status === 'emitido' && !x.signed_at && Date.parse(x.created_at) > now - 30 * DAY)
      .sort((x, y) => x.created_at.localeCompare(y.created_at))
      .map((x) => ({ id: x.id, consultation_id: x.consultation_id, patient_name: x.patient_snapshot.name, kind: x.kind, payload: x.payload, code: x.code, status: x.status,
        created_at: x.created_at, signed: false, doctor_snapshot: x.doctor_snapshot, patient_snapshot: x.patient_snapshot, expired: Date.parse(x.created_at) < now - 7 * DAY }));
  },
  // Painel "Agora na plataforma" (contrato novo): só para médico aprovado (o mesmo erro da fila), sem dado de paciente.
  tele_painel_medico(db, a, uid) { return painel(db, me(db, uid, true)); },
  tele_admin_doctors(db, a, uid) {
    if (!db.admins.has(uid)) throw new PgErr('so_admin');
    const list = [...db.doctors.values()];
    const pend = list.filter((d) => d.status === 'pending').sort((x, y) => x.created_at.localeCompare(y.created_at));
    const rest = list.filter((d) => d.status !== 'pending').sort((x, y) => y.created_at.localeCompare(x.created_at));
    return [...pend, ...rest].map((d) => {
      const lc = lastCheck(db, d);
      return { ...d, email: emailOf(d.user_id), consultations: 0, last_check: lc ? { ...lc, missing: checkMissing(lc, d) } : null,
        crm_duplicates: list.filter((o) => o !== d && o.crm === d.crm && o.crm_uf === d.crm_uf && o.status !== 'rejected').length };
    });
  },
  tele_admin_save_checks(db, a, uid) {
    if (!db.admins.has(uid)) throw new PgErr('so_admin');
    const d = db.doctors.get(a.p_doctor);
    if (!d) throw new PgErr('nao_encontrado');
    const k = a.p_checks || {};
    const note = String(k.note ?? '').trim() || null;
    if (note && note.length > 300) throw new PgErr('dados_invalidos', 'nota');
    const c = { id: db.checks.length + 1, doctor_id: d.id, full_name: d.full_name, crm: d.crm, crm_uf: d.crm_uf, rqe: d.rqe, specialty: d.specialty,
      cfm_active: k.cfm_active === true, rqe_checked: !!d.rqe && k.rqe_checked === true, id_video: k.id_video === true, crm_card: k.crm_card === true,
      icp_signature: k.icp_signature === true, note, checked_by: emailOf(uid), checked_at: iso() };
    db.checks.push(c);
    return checkMissing(c, d) ? 'incompleta' : 'completa';
  },
  tele_admin_set_doctor(db, a, uid) {
    if (!db.admins.has(uid)) throw new PgErr('so_admin');
    if (!['approved', 'rejected', 'suspended'].includes(a.p_status)) throw new PgErr('dados_invalidos', 'status');
    const d = db.doctors.get(a.p_doctor);
    if (!d) throw new PgErr('nao_encontrado');
    let lc = null;
    if (a.p_status === 'approved') {
      lc = lastCheck(db, d);
      const miss = checkMissing(lc, d) || (Date.now() - Date.parse(lc.checked_at) > 30 * DAY ? 'antiga' : null);
      if (miss) throw new PgErr('conferencia_incompleta', miss);
    }
    Object.assign(d, { status: a.p_status, reviewed_at: iso(), reviewed_by: emailOf(uid), review_note: String(a.p_note ?? '').trim().slice(0, 300) || null,
      available_until: a.p_status === 'approved' ? d.available_until : null, checked_at: lc ? lc.checked_at : d.checked_at, updated_at: iso() });
    return d.status;
  },
};

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body), headers: cors });

/* ======================= páginas ======================= */
// csp: false liga o bypassCSP (só para injetar o axe-core; nos outros cenários a CSP da página vale).
// width: largura do celular (padrão 390); painelMs: intervalo do painel "Agora na plataforma" (padrão do site: 20 s);
// notice: o aviso "Antes de ficar disponível" já lido neste navegador (para quem já atende).
async function newPage(browser, db, { mobile = false, csp = true, width = 390, painelMs = 0, notice = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block', reducedMotion: 'reduce', bypassCSP: !csp,
  });
  // Aviso de privacidade já aceito (não cobre a página nas capturas).
  await context.addInitScript(() => { try { localStorage.setItem('imed_lgpd', '1'); } catch { /* ignora */ } });
  if (notice) {
    const version = read('assets/js/tele-core.js').match(/NOTICE_VERSION = '([^']+)'/)[1];
    await context.addInitScript(([v, ids]) => { try { for (const id of ids) localStorage.setItem(`imed_medico_aviso:${id}`, v); } catch { /* ignora */ } }, [version, Object.values(USERS).map((u) => u.id)]);
  }
  if (painelMs) {
    await context.route(`${BASE}assets/js/config.js`, async (route) => {
      const src = await readFile(join(ROOT, 'assets/js/config.js'), 'utf8');
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: `${src}\nwindow.IMED_CONFIG.tele = { ...(window.IMED_CONFIG.tele || {}), painelMs: ${Number(painelMs)} };\n` });
    });
  }
  await context.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const auth = (req.headers().authorization || '').replace(/^Bearer /, '');
    if (u.pathname === '/auth/v1/user') return USERS[auth] ? json(route, USERS[auth]) : json(route, { msg: 'invalid' }, 401);
    if (u.pathname === '/auth/v1/otp') { db.otp.push({ body: JSON.parse(req.postData() || '{}'), redirect: u.searchParams.get('redirect_to') }); return json(route, {}); }
    if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    const m = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (!m || !RPC[m[1]]) return json(route, { message: 'não simulado' }, 404);
    const fn = m[1];
    const args = JSON.parse(req.postData() || '{}');
    const uid = USERS[auth]?.id || null;
    db.calls.push({ fn, args, uid, at: Date.now() });
    if (fn === 'tele_doctor_me' && db.failMe) return json(route, { message: 'falha simulada' }, 503); // leitura do cadastro falhando
    if (DOCTOR_FNS.has(fn) && !uid) return json(route, { code: '42501', message: `permission denied for function ${fn}` }, 401);
    // Painel com erro simulado (banco sem a função nova, sem permissão, entrada vencida ou fora do ar) ou lento.
    const pe = fn === 'tele_painel_medico' && (typeof db.painelErr === 'function' ? db.painelErr() : db.painelErr);
    if (pe) return json(route, pe.body, pe.status);
    if (fn === 'tele_painel_medico' && db.painelDelay) await new Promise((r) => { setTimeout(r, db.painelDelay); });
    if (db.fail[fn]) return json(route, db.fail[fn].body, db.fail[fn].status);
    try {
      const out = RPC[fn](db, args, uid);
      return out === null ? route.fulfill({ status: 204, body: '', headers: cors }) : json(route, out);
    } catch (e) {
      if (e instanceof PgErr) return json(route, { code: 'P0001', message: e.message, details: e.details, hint: null }, 400);
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
// Capturas de tela (só com SHOTS): a página inteira, ou só um pedaço (com o topo parado, para não cobrir o pedaço).
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); } };
const shotEl = async (page, sel, name) => {
  if (!SHOTS) return;
  await page.addStyleTag({ content: '.g-top,.pt-top{position:static!important}' });
  await page.waitForTimeout(300);
  await page.locator(sel).screenshot({ path: join(SHOTS, `${name}.png`) });
};
// Rolagem lateral de verdade: com isMobile, o Chromium aumenta window.innerWidth até a largura do conteúdo, então a
// conta é com a largura visível do documento (clientWidth). Lista também os elementos que passam da borda.
const overflow = (page) => page.evaluate(() => {
  const cw = document.documentElement.clientWidth;
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (/(hidden|auto|scroll|clip)/.test(getComputedStyle(p).overflowX)) return true; } return false; };
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || cs.position === 'fixed' || cs.display === 'none' || el.classList.contains('sr') || el.classList.contains('rd-sr') || clipped(el)) continue;
    if (r.right > cw + 1) bad.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`);
  }
  return { px: document.documentElement.scrollWidth - cw, bad: bad.slice(0, 5) };
});
const noOverflow = async (page, where) => { const o = await overflow(page); assert.ok(o.px <= 0 && !o.bad.length, `${where}: sem rolagem lateral (${o.px}px; ${o.bad.join(', ')})`); };
const results = [];
async function scenario(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const t0 = Date.now();
  try { await comChaves(fn); results.push(['ok', name]); console.log(`ok - ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 6).join('\n  ')}`); }
}
const visible = (page, sel, timeout = 15000) => page.waitForSelector(sel, { state: 'visible', timeout });
// Espera o elemento parar no lugar (a mesma caixa em duas leituras seguidas, 200 ms entre elas; até ~5 s).
async function settle(loc) {
  let prev = '';
  for (let i = 0; i < 25; i++) {
    const box = JSON.stringify(await loc.boundingBox());
    if (box === prev) return;
    prev = box;
    await loc.page().waitForTimeout(200);
  }
}
const text = async (page, sel) => (await page.locator(sel).innerText()).replace(/\s+/g, ' ').trim();

/* ---------- etapas do cadastro (medico.html) ---------- */
const STEPS = ['Conta criada', 'Envio do cadastro', 'Conferência do CRM', 'Aprovado', 'Disponível'];
// Lê o indicador de etapas: rótulos, etapa atual (aria-current="step"), concluídas, com problema e o que fazer.
const steps = (page, sel) => page.$eval(sel, (box) => {
  const lis = [...box.querySelectorAll('.md-stepper > li')];
  const name = (li) => li.querySelector('.md-sl').firstChild.textContent.trim();
  const list = box.querySelector('.md-stepper');
  return {
    shown: !box.hidden && box.getBoundingClientRect().height > 0,
    tag: list?.tagName, label: list?.getAttribute('aria-label') || '',
    labels: lis.map(name),
    current: lis.filter((li) => li.getAttribute('aria-current') === 'step').map(name),
    done: lis.filter((li) => li.classList.contains('done')).map(name),
    doneSr: lis.filter((li) => li.classList.contains('done')).every((li) => /\(concluída\)/.test(li.textContent)),
    bad: lis.filter((li) => li.classList.contains('bad')).map((li) => `${name(li)}: ${li.querySelector('small')?.textContent.trim()}`),
    on: lis.some((li) => li.classList.contains('on')),
    msg: (box.querySelector('.md-stepmsg')?.textContent || '').replace(/\s+/g, ' ').trim(),
    contact: box.querySelector('.md-stepmsg a')?.getAttribute('href') || null,
    help: box.querySelector('.md-stephelp a')?.getAttribute('href') || null,
    helpText: (box.querySelector('.md-stephelp a')?.textContent || '').trim(),
  };
});
// Espera o quadro `sel` (à vista) mostrar a etapa atual `label` e, quando pedido, também a situação com problema
// (`bad`: texto, ou null = sem problema), o "disponível" (`on`) e a mensagem (`msg`, expressão regular). Só o rótulo
// não basta: no recusado, a etapa atual já é "Conferência do CRM" antes de o reenvio chegar à tela.
const waitStep = (page, sel, label, { bad, on, msg } = {}) => page.waitForFunction(([s, l, checkBad, badText, checkOn, onVal, src, flags]) => {
  const box = document.querySelector(s);
  const li = box && !box.hidden ? box.querySelector('.md-stepper > li[aria-current="step"]') : null;
  if (!li || li.querySelector('.md-sl').firstChild.textContent.trim() !== l) return false;
  if (checkBad && (badText ? li.querySelector('small')?.textContent.trim() !== `Situação: ${badText}` : li.classList.contains('bad'))) return false;
  if (checkOn && li.classList.contains('on') !== onVal) return false;
  return src === null || new RegExp(src, flags).test((box.querySelector('.md-stepmsg')?.textContent || '').replace(/\s+/g, ' ').trim());
}, [sel, label, bad !== undefined, bad || '', on !== undefined, !!on, msg ? msg.source : null, msg ? msg.flags : ''], { timeout: 15000 });
// Confere o indicador inteiro de uma vez (depois de esperar a tela chegar ao estado pedido; se não chegar em 15 s,
// as conferências abaixo mostram o que ficou diferente).
async function expectSteps(page, sel, { current, bad = null, on = false, msg }) {
  await waitStep(page, sel, current, { bad, on, msg }).catch(() => {});
  const s = await steps(page, sel);
  const at = STEPS.indexOf(current);
  assert.ok(s.shown, `${sel}: etapas à vista`);
  assert.equal(s.tag, 'OL', 'lista numerada');
  assert.equal(s.label, 'Etapas do seu cadastro de médico');
  assert.deepEqual(s.labels, STEPS, 'as cinco etapas, em ordem');
  assert.deepEqual(s.current, [current], 'uma etapa atual só (aria-current="step")');
  assert.deepEqual(s.done, STEPS.slice(0, at), 'as anteriores aparecem como concluídas');
  assert.ok(s.doneSr, 'concluídas com "(concluída)" para o leitor de tela');
  assert.deepEqual(s.bad, bad ? [`${current}: Situação: ${bad}`] : [], 'etapa com problema');
  assert.equal(s.on, on, 'disponível agora');
  assert.match(s.msg, msg);
  assert.equal(s.help, 'para-medicos.html#fluxo');
  assert.equal(s.helpText, 'Como funciona para o médico');
  return s;
}

/* ---------- auditoria do axe-core ---------- */
async function runAxe(page, include = null) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async ([tags, inc]) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(inc ? { include: inc } : document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  }, [AXE_TAGS, include]);
}

/* ---------- painel "Agora na plataforma" e topo da plataforma (medico.html) ---------- */
const NUMS = ['aguardando', 'em_atendimento', 'atendidos_hoje', 'documentos_para_assinar', 'medicos_disponiveis'];
// O painel como a pessoa vê: número e rótulo de cada quadro, "o primeiro espera há", a hora, o botão e o aviso ao leitor.
const panelView = (page) => page.evaluate((keys) => {
  const t = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const p = document.querySelector('#painel');
  return {
    shown: !p.closest('[hidden]') && p.getBoundingClientRect().height > 0,
    nums: Object.fromEntries(keys.map((k) => { const li = p.querySelector(`[data-num="${k}"]`); return [k, `${t(li.querySelector('.md-nv'))} ${t(li.querySelector('.md-nl'))}`]; })),
    wait: t(p.querySelector('#nowWait')), at: t(p.querySelector('#nowAt')), btn: t(p.querySelector('#nowBtn')),
    sign: !p.querySelector('#nowSign').closest('[hidden]'), me: t(p.querySelector('#nowMe')), live: t(p.querySelector('#nowLive')),
  };
}, NUMS);
// Espera o painel à vista com o número `n` em `key` (o resto é conferido depois, com a mensagem do que ficou diferente).
const waitNum = (page, key, n, timeout = 15000) => page.waitForFunction(([k, v]) => {
  const p = document.querySelector('#painel');
  return !p.closest('[hidden]') && p.querySelector(`[data-num="${k}"] .md-nv`).textContent.trim() === v;
}, [key, String(n)], { timeout });
// Itens do menu do topo à vista: [texto, destino].
const menuItems = (page) => page.$$eval('#mdMenu [data-go]', (as) => as.filter((a) => !a.closest('[hidden]')).map((a) => [a.textContent.trim(), a.getAttribute('href')]));
const focusedId = (page) => page.evaluate(() => document.activeElement?.id || '');
// Espera uma condição do lado do teste (o banco simulado), no tempo de verdade.
async function until(fn, what, ms = 8000) {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`tempo esgotado esperando: ${what}`); await new Promise((r) => setTimeout(r, 50)); }
}
const painelCalls = (db, uid) => db.called('tele_painel_medico').filter((c) => c.uid === uid).length;
// Esconde ou mostra a aba (tela apagada ou outra aba à frente): a página vê document.hidden.
const setTabHidden = (page, hidden) => page.evaluate((h) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);
// Fila, atendidos e documentos de exemplo para a Carla (u-ok): 3 esperando (o primeiro há 12 min e meio), 4 atendidos
// hoje, 2 documentos no prazo para assinar e mais 1 vencido (fica em "Falta assinar", fora do número), 1 médico atendendo.
function seedPanel(db) {
  const carla = docOf(db, 'u-ok');
  const now = Date.now();
  db.addDoctor({ user_id: 'u-davi', full_name: 'Davi Rocha', crm: '776655', crm_uf: 'MG', available_until: iso(now + 80e3) }); // atendendo agora
  db.addDoctor({ user_id: 'u-old', full_name: 'Teo Antigo', crm: '776600', crm_uf: 'MG', available_until: iso(now - 60e3) }); // saiu: não conta
  for (const [name, reason, min] of [['Maria Souza', 'Tosse e febre há 3 dias', 12.5], ['João Lima', 'Dor de garganta', 6], ['Ana Prado', 'Renovar receita', 1]]) {
    db.addConsult({ patient_name: name, reason, created_at: iso(now - min * 60e3) });
  }
  db.addConsult({ patient_name: 'Pedido Velho', created_at: iso(now - 3 * 3600e3) }); // mais de 2 h: expirado, não conta
  for (let i = 0; i < 4; i++) db.addConsult({ status: 'ended', doctor_id: carla.id, patient_name: `Atendido ${i}`, created_at: iso(now - 50 * 60e3), accepted_at: iso(now - 40 * 60e3), started_at: iso(now - 30 * 60e3), ended_at: iso(now - 1000) });
  db.addConsult({ status: 'ended', doctor_id: carla.id, patient_name: 'Sem atendimento', created_at: iso(now - 50 * 60e3), accepted_at: iso(now - 40 * 60e3), ended_at: iso(now - 1000) }); // não começou
  db.addConsult({ status: 'ended', doctor_id: carla.id, patient_name: 'De ontem', created_at: iso(now - 26 * 3600e3), accepted_at: iso(now - 26 * 3600e3), started_at: iso(now - 26 * 3600e3), ended_at: iso(now - 25 * 3600e3) });
  db.addDoc({ doctor_id: carla.id, kind: 'atestado', code: 'ATST2345', created_at: iso(now - 3600e3), patient_snapshot: { name: 'Atendido 0' } });
  db.addDoc({ doctor_id: carla.id, kind: 'exames', code: 'EXAM2345', created_at: iso(now - 2 * DAY), patient_snapshot: { name: 'Atendido 1' } });
  db.addDoc({ doctor_id: carla.id, kind: 'receita', code: 'RECE2345', created_at: iso(now - 8 * DAY), patient_snapshot: { name: 'Atendido 2' } }); // vencido
  db.addDoc({ doctor_id: carla.id, kind: 'relatorio', code: 'RELA2345', created_at: iso(now - 3600e3), signed_at: iso(now - 600e3), patient_snapshot: { name: 'Atendido 3' } }); // já assinado
  return carla;
}

const browser = vigiarChaves(await chromium.launch());

/* ======================= cenários ======================= */
const FLOW = [
  'Passo 1 Crie sua conta pelo e-mail',
  'Passo 2 Preencha o cadastro',
  'Passo 3 A equipe do IMED confere o CRM no portal do CFM',
  'Passo 4 Resultado da conferência',
  'Passo 5 Leia o aviso e fique disponível quando quiser',
  'Passo 6 Atenda os pacientes da fila',
  'Passo 7 Assine os documentos com ICP-Brasil',
];

await scenario('para-medicos.html: abre, fluxograma acessível com os passos em ordem e o botão leva à inscrição', async () => {
  const db = makeDb();
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(`${BASE}para-medicos.html`);
  assert.match(await page.title(), /^Para médicos: atenda por teleconsulta \| IMED$/);
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await text(page, 'h1'), 'Atenda pelo IMED');
  // Títulos sem pular nível (h1 → h2 → h3).
  const levels = await page.$$eval('main h1, main h2, main h3', (hs) => hs.map((h) => Number(h.tagName[1])));
  levels.forEach((l, i) => { if (i) assert.ok(l <= levels[i - 1] + 1, `título nível ${l} depois de ${levels[i - 1]}`); });

  // Logo depois da abertura (antes do sumário), a situação do IMED hoje, com o mesmo conteúdo do aviso da área do médico.
  const sit = page.getByRole('region', { name: 'Situação do IMED hoje' });
  assert.equal(await sit.count(), 1, 'quadro "Situação do IMED hoje"');
  assert.equal(await page.getByRole('heading', { level: 2, name: 'Situação do IMED hoje', exact: true }).count(), 1);
  assert.ok(await page.$eval('#situacao', (el) => {
    const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return after(document.querySelector('#pmGo'), el) && after(el, document.querySelector('.toc'));
  }), 'depois da abertura e antes do sumário');
  const sitText = await text(page, '#situacao');
  for (const re of [/A inscrição do IMED no CRM como empresa de telemedicina ainda está sendo confirmada/,
    /Antes de atender, confirme com o médico responsável pelo IMED, Dr\. Rafael Pereira Barreto Silva \(CRM-SP 266930\), se a inscrição já foi concluída/,
    /razão social e o CNPJ do IMED estão em atualização/, /NGS2/, /O registro do IMED ainda não tem essa certificação/]) assert.match(sitText, re);
  assert.equal(await sit.locator('a[href="sobre.html"]').count(), 1, 'Quem somos');
  // O mesmo que o aviso da área do médico diz (medico.html), para as duas páginas não se desmentirem.
  const aviso = read('medico.html').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  for (const t of ['A inscrição do IMED no CRM como empresa de telemedicina ainda está sendo confirmada', 'O registro do IMED ainda não tem essa certificação.']) assert.ok(aviso.includes(t), `aviso da área do médico: ${t}`);

  // Fluxograma: lista numerada com nome, 7 passos em ordem, cada um com o título "Passo N ...".
  const flow = page.getByRole('list', { name: 'Fluxograma: da inscrição ao atendimento, em 7 passos' });
  assert.equal(await flow.count(), 1, 'fluxograma é uma lista com nome');
  assert.equal(await flow.evaluate((el) => el.tagName), 'OL', 'lista numerada (a ordem conta)');
  assert.equal(await flow.locator(':scope > li').count(), 7);
  // (texto do título como o leitor de tela lê: o "Passo N" aparece em maiúsculas só pelo CSS)
  const titles = (await flow.getByRole('heading', { level: 3 }).allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
  assert.deepEqual(titles, FLOW, 'os passos, na ordem da inscrição até o atendimento');
  for (const t of FLOW) assert.equal(await page.getByRole('heading', { level: 3, name: t, exact: true }).count(), 1, `título acessível: ${t}`);
  // Na tela, um passo embaixo do outro, na mesma ordem.
  const tops = await flow.locator(':scope > li > .pm-box').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  tops.forEach((t, i) => { if (i) assert.ok(t > tops[i - 1], 'passos em ordem na tela'); });
  // Os dois caminhos depois da conferência (o banco só tem "Recusado", que sempre volta para a conferência ao
  // reenviar): Recusado, com a volta para o passo 3 e o "fale com o IMED"; Aprovado, com a continuação para o passo 5.
  const branches = page.getByRole('list', { name: 'Os dois caminhos depois da conferência' });
  const opts = (await branches.getByRole('listitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  assert.deepEqual(await branches.locator(':scope > li > b').allInnerTexts(), ['Recusado', 'Aprovado']);
  assert.match(opts[0], /observação da equipe.*Corrija e envie de novo\. Volta para a conferência \(passo 3\)\. Se achar que houve engano, fale com o IMED\./);
  assert.equal(await branches.locator('a[href="#passo-3"]').count(), 1, 'link para o passo 3');
  assert.match(opts[1], /Siga para o passo 5/);
  assert.equal(await branches.locator('li.no a[href="contato.html"]').count(), 1, 'recusado: fale com o IMED');
  // Na tela larga, lado a lado e na mesma ordem da leitura (o leitor de tela lê na ordem em que aparecem).
  const bx = await branches.locator(':scope > li').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top }; }));
  assert.ok(bx[0].l < bx[1].l && Math.abs(bx[0].t - bx[1].t) < 1, `Recusado à esquerda e Aprovado à direita (${JSON.stringify(bx)})`);
  // Listas sem marcador com role="list" (o VoiceOver do Safari não as anuncia como lista sem isso).
  assert.deepEqual(await page.$$eval('main ul.pm-cards, #fluxograma, main .pm-branches', (ls) => ls.map((l) => l.getAttribute('role'))), ['list', 'list', 'list', 'list']);
  // Setas e ícones são só desenho: ficam no CSS ou escondidos do leitor de tela.
  assert.equal(await flow.locator('.pm-ic[aria-hidden="true"]').count(), 7);
  assert.equal(await page.getAttribute('.pm-term', 'aria-hidden'), 'true');
  const arrows = await flow.locator(':scope > li').evaluateAll((els) => els.map((e) => [getComputedStyle(e, '::before').content, getComputedStyle(e, '::after').content]));
  assert.ok(arrows.every(([b, a]) => b === '""' && a === '""'), 'setas desenhadas no CSS (sem texto)');
  assert.ok(!/[→↓⟶➜]/.test(await text(page, '#fluxograma')), 'sem setas no texto');
  // Conteúdo pedido e regras citadas, sem promessa nem preço.
  const main = await text(page, 'main');
  for (const re of [/CRM ativo/, /RQE para anunciar especialidade/, /câmera/, /Certificado digital ICP-Brasil/, /Resolução CFM 2\.314\/2022/, /LGPD, Lei 13\.709\/2018/,
    /não promete número de pacientes, ganhos nem resultados/,
    // fila como o paciente lê (teleconsulta.js: "primeiro médico livre, na ordem da fila")
    /vê a fila na área do médico, por ordem de chegada, e atende o próximo da fila/, /Atenda pela ordem de chegada/,
    // sem endereço e contato profissionais, o banco não deixa emitir documento
    /Endereço e contato profissionais Vão impressos nos documentos \(Res\. CFM 2\.381\/2024\): sem eles, não dá para emitir documentos/,
    // o aviso não é só "da primeira vez", e o resumo não quer dizer que o IMED já cumpre tudo
    /O aviso volta quando o texto dele muda e quando você entra por outro aparelho ou navegador/, /não querem dizer que o IMED já cumpre tudo/,
    // privacidade do médico: IP no vídeo direto e número ao ligar do celular
    /o paciente pode ver o endereço de internet \(IP\) da sua conexão/, /Se você ligar do seu celular, o paciente pode ver o seu número/]) assert.match(main, re);
  // (no arquivo, para valer também dentro das perguntas fechadas)
  const old = read('para-medicos.html').match(/escolhe quem atender|primeira fila|pela primeira vez|nem para o paciente nem para o médico|Pedimos correção|três caminhos/g);
  assert.equal(old, null, `sem os textos antigos: ${old}`);
  assert.ok(!/R\$|\d+ ?%|ganhe|garantimos|renda extra|faturamento|\d+ pacientes por/i.test(main), 'sem preço, porcentagem nem promessa de ganho');
  assert.ok(!/[Dd]iretor técnico|[Rr]esponsável técnico médico/.test(main), 'sem título ainda não confirmado');
  assert.ok(await page.locator('main a[href="contato.html"]').count() >= 2, 'condições: Fale com o IMED');
  for (const a of await page.$$eval('.toc a', (as) => as.map((x) => x.getAttribute('href')))) assert.equal(await page.locator(a).count(), 1, `âncora ${a}`);
  // Rodapé padrão: médico responsável e o link novo "Para médicos".
  const foot = await text(page, 'footer.rodape');
  assert.match(foot, /Médico responsável: Dr\. Rafael Pereira Barreto Silva — CRM-SP 266930/);
  assert.match(foot, /Emergência\? Ligue 192 \(SAMU\)/);
  assert.equal(await page.locator('footer.rodape a[href="para-medicos.html"]', { hasText: 'Para médicos' }).count(), 1);
  await shot(page, 'medicos-01-pagina-para-medicos');
  await shotEl(page, '#diagrama', 'medicos-02-fluxograma');
  // "Fazer minha inscrição" leva à área do médico (entrada pelo e-mail).
  const go = page.locator('#pmGo');
  assert.match(await go.innerText(), /Fazer minha inscrição/);
  assert.equal(await go.getAttribute('href'), 'medico.html');
  assert.equal(await page.locator('main a.btn[href="medico.html"]', { hasText: 'Fazer minha inscrição' }).count(), 2, 'no começo e no fim da página');
  await go.click();
  await page.waitForURL(`${BASE}medico.html`);
  await visible(page, '#loginEmail');
  assert.deepEqual(errors, [], 'sem erro no console');
  await context.close();
});

await scenario('para-medicos.html no celular (390 px): sem rolagem lateral, passos um embaixo do outro e alvos de 44 px', async () => {
  const db = makeDb();
  const { page, errors, context } = await newPage(browser, db, { mobile: true });
  await page.goto(`${BASE}para-medicos.html`);
  await visible(page, '#fluxograma');
  await noOverflow(page, 'para-medicos.html no celular');
  const boxes = await page.locator('#fluxograma > li > .pm-box, #fluxograma .pm-branches > li').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top }; }));
  assert.ok(boxes.every((b) => b.l >= 0 && b.r <= 390), 'caixas do fluxograma dentro da tela');
  boxes.forEach((b, i) => { if (i) assert.ok(b.t > boxes[i - 1].t, 'um embaixo do outro'); });
  const small = await page.locator('main a.btn, main summary').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => e.textContent.trim()));
  assert.deepEqual(small, [], 'botões e perguntas com pelo menos 44 px de altura');
  await page.click('summary:has-text("Tem custo")');
  assert.match(await text(page, '.pm-faq details[open]'), /O site não faz cobrança nem recebe pagamento\. Remuneração e outras condições: fale com o IMED\./);
  // O quadro da situação do IMED cabe na tela, logo depois da abertura.
  const sit = await page.locator('#situacao').boundingBox();
  assert.ok(sit && sit.x >= 0 && sit.x + sit.width <= 390, `situação do IMED dentro da tela (${JSON.stringify(sit)})`);
  await shot(page, 'medicos-03-para-medicos-celular');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('inscrição do médico: e-mail, cadastro, conferência e aprovação pela equipe, aviso e "Disponível"', async () => {
  const db = makeDb();
  const doc = await newPage(browser, db);
  const { page } = doc;
  // 1) Conta pelo e-mail: o link de entrada volta para a área do médico.
  await page.goto(`${BASE}medico.html`);
  assert.equal(await page.getAttribute('.md-howto a', 'href'), 'para-medicos.html', 'topo: "Como funciona para o médico"');
  await visible(page, '#loginEmail');
  await page.fill('#loginEmail', 'Bia@Exemplo.com');
  await page.click('#loginBtn');
  await page.waitForSelector('#loginMsg.ok');
  assert.equal(db.otp[0].body.email, 'bia@exemplo.com');
  assert.equal(db.otp[0].redirect, `${BASE}medico.html`);
  await shot(page, 'medicos-04-entrar-com-email');
  await page.goto('about:blank');
  await page.goto(loginUrl('tok-new'));
  // 2) Ainda sem cadastro: as etapas aparecem no formulário, com "Envio do cadastro" como etapa atual.
  await visible(page, '#regCard');
  assert.equal(await page.isVisible('#meCard'), false);
  await expectSteps(page, '#regSteps', { current: 'Envio do cadastro', msg: /preencha o cadastro abaixo e toque em “Enviar para análise”/ });
  assert.equal(await page.getAttribute('#regSteps .md-stepper', 'role'), 'list', 'lista sem marcador com role="list" (VoiceOver do Safari)');
  assert.equal(await page.isHidden('#meSteps'), true);
  await shot(page, 'medicos-05-cadastro-com-as-etapas');
  await page.fill('#rName', 'Beatriz  Souza');
  await page.fill('#rCrm', '0098765');
  await page.selectOption('#rUf', 'PE');
  await page.fill('#rRqe', '4321');
  await page.fill('#rSpec', 'Pediatria');
  await page.fill('#rPhone', '81999998888');
  await shot(page, 'medicos-06-cadastro-preenchido');
  await page.click('#regBtn');
  // 3) Enviado: em análise, com a etapa "Conferência do CRM".
  await visible(page, '#meCard');
  assert.deepEqual(db.called('tele_doctor_register')[0].args, { p_full_name: 'Beatriz Souza', p_crm: '98765', p_crm_uf: 'PE', p_rqe: '4321', p_specialty: 'Pediatria', p_phone: '81999998888' });
  await expectSteps(page, '#meSteps', { current: 'Conferência do CRM', msg: /a equipe do IMED confere o seu CRM no portal do CFM/ });
  assert.equal(await page.isHidden('#regSteps'), true, 'as etapas ficam só no quadro do cadastro');
  assert.match(await text(page, '#meBox'), /Beatriz Souza.*CRM-PE 98765 · Pediatria · RQE 4321.*Em análise/);
  assert.match(await text(page, '#flash'), /Cadastro enviado/);
  assert.equal(await page.isVisible('#dutyCard'), false, 'em análise não vê a fila');
  await shot(page, 'medicos-07-em-analise');
  await shotEl(page, '#meCard', 'medicos-07b-etapas-em-analise');

  // 4) A equipe do IMED confere (CFM, RQE e identidade) e aprova.
  const id = docOf(db, 'u-new').id;
  const adm = await newPage(browser, db);
  await adm.page.goto(loginUrl('tok-admin'));
  await visible(adm.page, '#adminCard');
  const card = adm.page.locator(`[data-doc="${id}"]`);
  await card.waitFor();
  assert.match(await card.innerText(), /Beatriz Souza[\s\S]*Em análise/);
  for (const k of ['cfm_active', 'rqe_checked', 'id_video', 'crm_card']) await card.locator(`[data-check="${k}"]`).check();
  await card.locator(`[data-checknote="${id}"]`).fill('Vídeo com documento e carteira do CRM em 30/10');
  await card.locator(`#note-${id}`).fill('CRM e RQE conferidos no CFM em 30/10.');
  await shot(adm.page, 'medicos-08-equipe-confere');
  await card.locator('[data-set="approved"]').click();
  await adm.page.waitForFunction((d) => /Aprovado/.test(document.querySelector(`[data-doc="${d}"]`)?.innerText || ''), id);
  assert.equal(db.doctors.get(id).status, 'approved');
  assert.deepEqual(adm.errors, []);
  await adm.context.close();

  // 5) Aprovado: lê o aviso e liga "Disponível para atender".
  await page.reload();
  await visible(page, '#noticeCard');
  await expectSteps(page, '#meSteps', { current: 'Aprovado', msg: /leia o aviso “Antes de ficar disponível” e marque que entendeu/ });
  assert.match(await text(page, '#meBox'), /Aprovado.*CRM e RQE conferidos no CFM em 30\/10\./);
  await shot(page, 'medicos-09-aprovado-le-o-aviso');
  await page.check('#noticeOk');
  await page.click('#noticeBtn');
  await visible(page, '#dutyCard');
  await expectSteps(page, '#meSteps', { current: 'Aprovado', msg: /ligue “Disponível para atender”, no quadro “Fila de pacientes”/ });
  await page.click('#availBtn');
  await page.waitForSelector('#availBtn[aria-checked="true"]');
  await expectSteps(page, '#meSteps', { current: 'Disponível', on: true, msg: /Você está disponível: os pacientes veem o seu nome e CRM/ });
  assert.ok(Date.parse(docOf(db, 'u-new').available_until) > Date.now(), 'o banco sabe que está atendendo');
  await shot(page, 'medicos-10-disponivel');
  await shotEl(page, '#meCard', 'medicos-10b-etapas-disponivel');
  // Desligou: volta para "Aprovado".
  await page.click('#availBtn');
  await page.waitForSelector('#availBtn[aria-checked="false"]');
  await expectSteps(page, '#meSteps', { current: 'Aprovado', msg: /ligue “Disponível para atender”/ });
  assert.deepEqual(doc.errors, []);
  await doc.context.close();
});

await scenario('etapas certas para em análise, aprovado, recusado (e corrigido) e suspenso, com o que fazer', async () => {
  const db = seedDb();
  // Em análise.
  let p = await newPage(browser, db);
  await p.page.goto(loginUrl('tok-pend'));
  await visible(p.page, '#meCard');
  await expectSteps(p.page, '#meSteps', { current: 'Conferência do CRM', msg: /confere o seu CRM no portal do CFM/ });
  assert.equal(await p.page.isVisible('#regCard'), false);
  assert.deepEqual(p.errors, []);
  await p.context.close();

  // Aprovado, ainda sem ler o aviso.
  p = await newPage(browser, db);
  await p.page.goto(loginUrl('tok-ok'));
  await visible(p.page, '#noticeCard');
  await expectSteps(p.page, '#meSteps', { current: 'Aprovado', msg: /leia o aviso/ });
  assert.deepEqual(p.errors, []);
  await p.context.close();

  // Recusado: etapa da conferência com problema, observação da equipe e o que fazer; corrigido, volta para a conferência.
  p = await newPage(browser, db);
  await p.page.goto(loginUrl('tok-rej'));
  await visible(p.page, '#meCard');
  const rej = await expectSteps(p.page, '#meSteps', { current: 'Conferência do CRM', bad: 'Recusado', msg: /O cadastro foi recusado\. Leia a observação da equipe, se houver, toque em “Corrigir e enviar de novo”.*Dúvidas\? Fale com o IMED\./ });
  assert.equal(rej.contact, 'contato.html');
  assert.match(await text(p.page, '#meBox'), /Recusado.*O número do CRM não confere com o nome na busca do CFM/);
  assert.equal(await p.page.isVisible('#dutyCard'), false);
  await shot(p.page, 'medicos-11-recusado');
  await p.page.click('#editBtn');
  await visible(p.page, '#regCard');
  assert.equal(await p.page.isHidden('#regSteps'), true, 'editando: as etapas continuam só no quadro do cadastro');
  assert.equal((await p.page.innerText('#regBtn')).trim(), 'Enviar para análise', 'recusado: o reenvio vai para a análise');
  assert.equal(await p.page.inputValue('#rCrm'), '11223');
  await p.page.fill('#rCrm', '11224');
  await p.page.click('#regBtn');
  // (a etapa atual continua "Conferência do CRM": a espera é pela etapa sem problema e pela mensagem nova)
  await expectSteps(p.page, '#meSteps', { current: 'Conferência do CRM', msg: /confere o seu CRM/ });
  assert.equal(docOf(db, 'u-rej').status, 'pending', 'reenviado: volta para a conferência');
  assert.match(await text(p.page, '#meBox'), /Em análise/);
  await shot(p.page, 'medicos-12-corrigido-volta-para-a-conferencia');
  assert.deepEqual(p.errors, []);
  await p.context.close();

  // Suspenso: etapa "Aprovado" com problema; sem fila e sem aviso.
  p = await newPage(browser, db);
  await p.page.goto(loginUrl('tok-sus'));
  await visible(p.page, '#meCard');
  const sus = await expectSteps(p.page, '#meSteps', { current: 'Aprovado', bad: 'Suspenso', msg: /Você não pode atender agora\. Veja a observação da equipe, se houver, e fale com o IMED para saber o que fazer\./ });
  assert.equal(sus.contact, 'contato.html');
  assert.match(await text(p.page, '#meBox'), /Suspenso.*A conferência anual do cadastro venceu/);
  await p.page.waitForTimeout(400);
  assert.equal(await p.page.isVisible('#dutyCard'), false);
  assert.equal(await p.page.isVisible('#noticeCard'), false);
  await shot(p.page, 'medicos-13-suspenso');
  // Editar o cadastro suspenso só salva (o banco mantém "Suspenso"): o botão diz "Salvar", não "Enviar para análise".
  await p.page.click('#editBtn');
  await visible(p.page, '#regCard');
  assert.equal((await p.page.innerText('#regBtn')).trim(), 'Salvar');
  await p.page.click('#regBtn');
  await p.page.waitForFunction(() => /O cadastro continua suspenso/.test(document.querySelector('#flash')?.textContent || ''));
  assert.equal(docOf(db, 'u-sus').status, 'suspended', 'continua suspenso');
  await expectSteps(p.page, '#meSteps', { current: 'Aprovado', bad: 'Suspenso', msg: /Você não pode atender agora/ });
  assert.deepEqual(p.errors, []);
  await p.context.close();
});

await scenario('leitura do cadastro falhou: etapas escondidas, sem voltar com a situação antiga, até ler de novo', async () => {
  const db = seedDb();
  const p = await newPage(browser, db);
  await p.page.goto(loginUrl('tok-ok'));
  await visible(p.page, '#noticeCard');
  await p.page.check('#noticeOk');
  await p.page.click('#noticeBtn');
  await visible(p.page, '#dutyCard');
  await p.page.click('#availBtn');
  await p.page.waitForSelector('#availBtn[aria-checked="true"]');
  await expectSteps(p.page, '#meSteps', { current: 'Disponível', on: true, msg: /Você está disponível/ });
  // A leitura do cadastro passa a falhar (rede ou servidor). O médico salva o cadastro, e a página lê de novo: falha.
  db.failMe = true;
  await p.page.click('#editBtn');
  await visible(p.page, '#regCard');
  await p.page.click('#regBtn');
  await visible(p.page, '#meRetry');
  await p.page.waitForSelector('#meSteps', { state: 'hidden' });
  // Desligar o "Disponível" redesenhava as etapas com a situação guardada de antes do erro: agora continuam escondidas.
  await p.page.click('#availBtn');
  await p.page.waitForSelector('#availBtn[aria-checked="false"]');
  await p.page.waitForTimeout(300);
  assert.equal(await p.page.isHidden('#meSteps'), true, 'sem etapas antigas depois do erro');
  assert.equal(await p.page.isHidden('#regSteps'), true);
  assert.equal(await p.page.locator('.md-stepper').count(), 0, 'nenhuma lista de etapas na página');
  // Leu de novo ("Tentar de novo"): as etapas voltam, com a situação de agora.
  db.failMe = false;
  await p.page.click('#meRetry');
  await expectSteps(p.page, '#meSteps', { current: 'Aprovado', msg: /ligue “Disponível para atender”/ });
  assert.deepEqual(p.errors, []);
  await p.context.close();
});

await scenario('área do médico no celular (390 px): etapas em pé, sem rolagem lateral e link de ajuda com 44 px', async () => {
  const db = seedDb();
  for (const [tok, sel, current] of [['tok-new', '#regSteps', 'Envio do cadastro'], ['tok-pend', '#meSteps', 'Conferência do CRM'], ['tok-rej', '#meSteps', 'Conferência do CRM'], ['tok-sus', '#meSteps', 'Aprovado'], ['tok-ok', '#meSteps', 'Disponível']]) {
    const { page, errors, context } = await newPage(browser, db, { mobile: true });
    await page.goto(loginUrl(tok));
    if (tok === 'tok-ok') {
      await visible(page, '#noticeCard');
      await page.check('#noticeOk');
      await page.click('#noticeBtn');
      await visible(page, '#dutyCard');
      await page.click('#availBtn');
      await page.waitForSelector('#availBtn[aria-checked="true"]');
    }
    await waitStep(page, sel, current);
    await noOverflow(page, `${tok} no celular`);
    const lis = await page.locator(`${sel} .md-stepper > li`).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: r.top, r: r.right }; }));
    assert.equal(lis.length, 5);
    lis.forEach((li, i) => { if (i) { assert.ok(li.t > lis[i - 1].t, `${tok}: etapas uma embaixo da outra`); assert.equal(li.l, lis[0].l); } });
    assert.ok(lis.every((li) => li.r <= 390), `${tok}: etapas dentro da tela`);
    const h = await page.locator(`${sel} .md-stephelp a`).evaluate((a) => a.getBoundingClientRect().height);
    assert.ok(h >= 43.5, `${tok}: link de ajuda com ${h} px`);
    if (tok === 'tok-rej') await shot(page, 'medicos-14-celular-recusado');
    if (tok === 'tok-ok') await shot(page, 'medicos-15-celular-disponivel');
    assert.deepEqual(errors, [], tok);
    await context.close();
  }
});

/* ---------- Plataforma de atendimento: painel "Agora na plataforma" e menu do topo ---------- */
await scenario('painel "Agora na plataforma" (médico aprovado): números do banco, sem dado de paciente, botões e "Falta assinar"', async () => {
  const db = seedDb();
  const carla = seedPanel(db);
  db.painelAt = '2026-10-30T15:00:00Z'; // hora dos números: a do banco (12:00 em Brasília)
  const { page, errors, context } = await newPage(browser, db);
  await page.goto(loginUrl('tok-ok'));
  await visible(page, '#noticeCard');
  await waitNum(page, 'aguardando', 3);
  // No topo da página, antes de "Sua conta", com o título e a hora dos números.
  assert.ok(await page.$eval('#painel', (p) => !!(p.compareDocumentPosition(document.querySelector('#authCard')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'painel antes de "Sua conta"');
  assert.equal(await page.getAttribute('#painel', 'aria-labelledby'), 'nowTitle');
  assert.equal(await text(page, '#nowTitle'), 'Agora na plataforma');
  let v = await panelView(page);
  assert.deepEqual(v.nums, {
    aguardando: '3 pacientes aguardando atendimento',
    em_atendimento: '0 pacientes em atendimento com você',
    atendidos_hoje: '4 atendimentos hoje com você',
    documentos_para_assinar: '2 documentos para assinar',
    medicos_disponiveis: '1 médico disponível agora',
  }, 'os números do banco (singular e plural certos)');
  assert.equal(v.wait, 'O primeiro da fila espera há 12 min.');
  assert.equal(v.at, 'Atualizado às 12:00.', 'hora dos números vinda do banco (horário de Brasília)');
  assert.equal(v.btn, 'Ficar disponível');
  assert.ok(v.sign, 'documentos para assinar: "Ver e assinar"');
  assert.equal(v.live, '', 'nada anunciado ao abrir');
  // A chamada não manda nada (o banco sabe quem é pela sessão) e só o médico aprovado chama.
  assert.deepEqual(db.called('tele_painel_medico').map((c) => [c.uid, c.args]), [['u-ok', {}]]);
  // LGPD: o painel só tem contagens; nome, idade e motivo de quem espera ficam fora.
  const painelText = await text(page, '#painel');
  for (const re of [/Maria|João|Ana Prado|Atendido|Pedido Velho/, /Tosse|garganta|receita/i, /\d+ anos/]) assert.doesNotMatch(painelText, re);
  assert.match(painelText, /Só números: este painel não mostra dados de pacientes\./);
  // A frase fica na linha pequena da hora, junto do título (o painel fica mais baixo no celular).
  assert.equal(await page.$eval('#nowAt', (e) => e.closest('.md-now-h') !== null && e.parentElement.querySelector('.md-now-note') !== null), true);
  // Os números não são "ao vivo" (o leitor de tela não lê o painel a cada 20 s); só #nowLive avisa, educado.
  assert.equal(await page.locator('#painel [aria-live]').count(), 0, 'sem aria-live nos números');
  assert.equal(await page.getAttribute('#nowLive', 'role'), 'status');
  assert.equal(await page.locator('#painel ul.md-nums[role="list"] > li').count(), 5);
  await shot(page, 'medicos-16-painel-aprovado');
  await shotEl(page, '#painel', 'medicos-16b-painel-numeros');

  // Menu do topo: as cinco partes, cada uma levando a um quadro que está na tela (a fila, antes do aviso, leva ao aviso).
  assert.deepEqual(await menuItems(page), [['Painel', '#painel'], ['Fila', '#noticeCard'], ['Consultas', '#histCard'], ['Documentos', '#signCard'], ['Meu cadastro', '#meCard']]);
  assert.equal(await text(page, '.md-brand'), 'Plataforma de atendimento');
  assert.equal(await page.getAttribute('#mdMenu', 'aria-label'), 'Plataforma de atendimento');
  assert.equal(await page.getAttribute('#mdMenu .md-site', 'href'), './', '"Site do IMED" volta para o site');
  assert.equal((await text(page, '#mdMenu .md-site')), 'Site do IMED');
  assert.equal(await page.isVisible('#menuBtn'), false, 'tela larga: o menu fica na linha do topo');
  assert.equal(await text(page, 'h1'), 'Plataforma de atendimento do IMED');
  assert.match(await page.title(), /^Área do médico: plataforma de atendimento \| IMED$/);

  // "Ver e assinar" leva ao quadro "Falta assinar" (com o foco no título dele).
  await page.click('#nowSign');
  await page.waitForFunction(() => document.activeElement?.id === 'signTitle');
  assert.match(await text(page, '#signTitle'), /Falta assinar \(3\)/, 'a lista tem também o vencido (que só dá para cancelar)');
  // Menu: "Meu cadastro" e "Painel" levam ao quadro e põem o foco no título.
  await page.click('#mdMenu [data-go="cadastro"]');
  await page.waitForFunction(() => document.activeElement?.id === 'meTitle');
  await page.click('#mdMenu [data-go="painel"]');
  await page.waitForFunction(() => document.activeElement?.id === 'nowTitle');

  // "Ficar disponível" antes de ler o aviso: leva ao aviso (o médico precisa ler e marcar).
  await page.click('#nowBtn');
  await page.waitForFunction(() => document.activeElement?.id === 'noticeTitle');
  assert.equal(docOf(db, 'u-ok').available_until, null, 'ainda não ficou disponível');
  await page.check('#noticeOk');
  await page.click('#noticeBtn');
  await visible(page, '#dutyCard');
  assert.deepEqual((await menuItems(page)).find(([t]) => t === 'Fila'), ['Fila', '#dutyCard'], 'lido o aviso, "Fila" leva à fila');
  // Agora liga: o banco passa a contar a Carla entre os médicos disponíveis e o botão vira "Ver a fila".
  await page.click('#nowBtn');
  await page.waitForSelector('#availBtn[aria-checked="true"]');
  await waitNum(page, 'medicos_disponiveis', 2);
  await page.waitForFunction(() => document.querySelector('#nowMe').textContent === 'Contando você.');
  v = await panelView(page);
  assert.equal(v.nums.medicos_disponiveis, '2 médicos disponíveis agora');
  assert.equal(v.me, 'Contando você.');
  assert.equal(v.btn, 'Ver a fila');
  assert.ok(Date.parse(carla.available_until) > Date.now(), 'disponível no banco');
  await expectSteps(page, '#meSteps', { current: 'Disponível', on: true, msg: /Você está disponível/ });
  assert.match(await page.textContent('#toast'), /você está disponível/i);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'medicos-17-painel-disponivel');
  await page.click('#nowBtn');
  await page.waitForFunction(() => document.activeElement?.id === 'dutyTitle');
  assert.deepEqual(errors, [], 'sem erro no console');
  await context.close();
});

await scenario('médico em análise, recusado, suspenso ou sem cadastro: sem números (o painel nem é pedido), só as etapas', async () => {
  const db = seedDb();
  seedPanel(db);
  for (const [tok, sel, current, menu] of [
    ['tok-new', '#regSteps', 'Envio do cadastro', [['Meu cadastro', '#regCard']]],
    // "Documentos" leva às consultas anteriores (cada uma tem o bloco "Documentos"): sem "Falta assinar" para quem não
    // está aprovado.
    ['tok-pend', '#meSteps', 'Conferência do CRM', [['Consultas', '#histCard'], ['Documentos', '#histCard'], ['Meu cadastro', '#meCard']]],
    ['tok-rej', '#meSteps', 'Conferência do CRM', [['Consultas', '#histCard'], ['Documentos', '#histCard'], ['Meu cadastro', '#meCard']]],
    ['tok-sus', '#meSteps', 'Aprovado', [['Consultas', '#histCard'], ['Documentos', '#histCard'], ['Meu cadastro', '#meCard']]],
  ]) {
    const { page, errors, context } = await newPage(browser, db);
    await page.goto(loginUrl(tok));
    await waitStep(page, sel, current);
    await page.waitForTimeout(400);
    const uid = USERS[tok].id;
    assert.equal(painelCalls(db, uid), 0, `${tok}: o painel não é pedido ao banco`);
    assert.equal(await page.isHidden('#painel'), true, `${tok}: painel escondido`);
    assert.deepEqual(await menuItems(page), menu, `${tok}: menu só com o que está na tela`);
    assert.equal(await page.isVisible('#menuBtn'), false);
    if (tok === 'tok-pend') await shot(page, 'medicos-18-em-analise-sem-numeros');
    assert.deepEqual(errors, [], tok);
    await context.close();
  }
  // O banco recusa o painel de quem não está aprovado (o mesmo erro da fila).
  assert.throws(() => RPC.tele_painel_medico(db, {}, 'u-pend'), /nao_aprovado/);
  assert.throws(() => RPC.tele_painel_medico(db, {}, 'u-new'), /sem_cadastro/);

  // Aprovado que é suspenso com a página aberta: na próxima atualização o banco recusa, o painel some e as etapas mostram
  // "Suspenso" (sem ficar pedindo o painel de novo).
  const { page, errors, context } = await newPage(browser, db, { painelMs: 500 });
  await page.goto(loginUrl('tok-ok'));
  await waitNum(page, 'aguardando', 3);
  docOf(db, 'u-ok').status = 'suspended';
  await page.waitForSelector('#painel', { state: 'hidden' });
  await expectSteps(page, '#meSteps', { current: 'Aprovado', bad: 'Suspenso', msg: /Você não pode atender agora/ });
  const n = painelCalls(db, 'u-ok');
  await page.waitForTimeout(1500);
  assert.equal(painelCalls(db, 'u-ok'), n, 'parou de pedir o painel');
  assert.ok(!(await menuItems(page)).some(([t]) => t === 'Painel'), 'menu sem "Painel"');
  assert.deepEqual(errors, []);
  docOf(db, 'u-ok').status = 'approved';
  await context.close();
});

await scenario('banco ainda sem a função do painel (404/PGRST202) ou sem permissão (403): o painel some sem erro; 401 passageiro e servidor fora do ar: tenta de novo e volta', async () => {
  const db = seedDb();
  seedPanel(db);
  const missing = { status: 404, body: { code: 'PGRST202', details: 'Searched for the function public.tele_painel_medico without parameters or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.', hint: null, message: 'Could not find the function public.tele_painel_medico without parameters in the schema cache' } };
  const denied = { status: 403, body: { code: '42501', details: null, hint: null, message: 'permission denied for function tele_painel_medico' } };
  for (const [name, err] of [['404/PGRST202', missing], ['sem permissão (42501)', denied]]) {
    db.painelErr = err;
    const before = painelCalls(db, 'u-ok');
    const { page, errors, context } = await newPage(browser, db, { painelMs: 400, notice: true });
    await page.goto(loginUrl('tok-ok'));
    await visible(page, '#dutyCard');
    await page.waitForTimeout(1600);
    assert.equal(painelCalls(db, 'u-ok') - before, 1, `${name}: pediu uma vez só e parou`);
    assert.equal(await page.isHidden('#painel'), true, `${name}: painel escondido`);
    assert.doesNotMatch(await text(page, '#main'), /Sem resposta do servidor|Não foi possível|expirou/, `${name}: nenhuma mensagem de erro`);
    assert.deepEqual((await menuItems(page)).map(([t]) => t), ['Fila', 'Consultas', 'Documentos', 'Meu cadastro'], `${name}: menu sem "Painel"`);
    // O resto da área do médico continua: fica disponível pela fila.
    await page.click('#availBtn');
    await page.waitForSelector('#availBtn[aria-checked="true"]');
    await expectSteps(page, '#meSteps', { current: 'Disponível', on: true, msg: /Você está disponível/ });
    assert.equal(await page.isHidden('#painel'), true);
    if (name === '404/PGRST202') { await page.evaluate(() => window.scrollTo(0, 0)); await shot(page, 'medicos-19-sem-a-funcao-no-banco'); }
    assert.deepEqual(errors, [], `${name}: sem erro no console`);
    await context.close();
  }
  // 401 passageiro, com o médico ainda logado: a entrada venceu (PGRST301) ou a renovação dela falhou por rede ou por
  // excesso de pedidos e a chamada saiu sem ela (42501). Não é "banco sem a função": os números de antes ficam, com a
  // hora deles, e na atualização seguinte o painel volta (antes, um 401 escondia o painel até recarregar a página).
  for (const [name, err] of [
    ['401 sem a entrada (42501)', { status: 401, body: { code: '42501', details: null, hint: null, message: 'permission denied for function tele_painel_medico' } }],
    ['401 entrada vencida (PGRST301)', { status: 401, body: { code: 'PGRST301', details: null, hint: null, message: 'JWT expired' } }],
  ]) {
    db.painelErr = null;
    const { page, errors, context } = await newPage(browser, db, { painelMs: 400, notice: true });
    await page.goto(loginUrl('tok-ok'));
    await waitNum(page, 'aguardando', 3);
    // Guarda cada texto da hora e cada vez que o painel some, para conferir o que apareceu entre uma leitura e outra.
    await page.evaluate(() => {
      window.__at = []; window.__gone = 0;
      new MutationObserver(() => window.__at.push(document.querySelector('#nowAt').textContent)).observe(document.querySelector('#nowAt'), { childList: true, characterData: true, subtree: true });
      new MutationObserver(() => { if (document.querySelector('#painel').hidden) window.__gone += 1; }).observe(document.querySelector('#painel'), { attributes: true, attributeFilter: ['hidden'] });
    });
    const n0 = painelCalls(db, 'u-ok');
    let once = true;
    db.painelErr = () => (once ? (once = false, err) : null); // um 401 só, depois 200
    await until(() => !once && painelCalls(db, 'u-ok') >= n0 + 3, `${name}: o 401 e mais duas atualizações`);
    await page.waitForFunction(() => /^Atualizado às \d\d:\d\d\.$/.test(document.querySelector('#nowAt').textContent));
    const seen = await page.evaluate(() => [window.__at, window.__gone]);
    assert.ok(seen[0].some((t) => /^Atualizado às \d\d:\d\d\. Sem resposta do servidor agora: tentando de novo…$/.test(t)), `${name}: avisou a falha com a hora dos números de antes (${JSON.stringify(seen[0])})`);
    assert.equal(seen[1], 0, `${name}: o painel não sumiu`);
    const v = await panelView(page);
    assert.ok(v.shown, `${name}: o painel voltou`);
    assert.equal(v.nums.aguardando, '3 pacientes aguardando atendimento');
    assert.ok((await menuItems(page)).some(([t]) => t === 'Painel'), `${name}: "Painel" continua no menu`);
    assert.doesNotMatch(await text(page, '#main'), /expirou/, `${name}: o médico continua logado`);
    if (name.startsWith('401 sem')) { await page.evaluate(() => window.scrollTo(0, 0)); await shot(page, 'medicos-19b-401-passageiro-painel-volta'); }
    assert.deepEqual(errors, [], `${name}: sem erro no console`);
    await context.close();
  }
  // Servidor fora do ar: o painel aparece quando volta; se cair de novo, mostra os números de antes, com a hora deles.
  let fails = 2;
  db.painelErr = () => (fails-- > 0 ? { status: 503, body: { message: 'falha simulada' } } : null);
  const b0 = painelCalls(db, 'u-ok');
  const { page, errors, context } = await newPage(browser, db, { painelMs: 400, notice: true });
  await page.goto(loginUrl('tok-ok'));
  await waitNum(page, 'aguardando', 3);
  assert.ok(painelCalls(db, 'u-ok') >= b0 + 3, 'tentou de novo sozinho');
  assert.match((await panelView(page)).at, /^Atualizado às \d\d:\d\d\.$/);
  db.painelErr = { status: 503, body: { message: 'falha simulada' } };
  await page.waitForFunction(() => /Sem resposta do servidor agora: tentando de novo/.test(document.querySelector('#nowAt').textContent));
  const v = await panelView(page);
  assert.ok(v.shown, 'continua à vista');
  assert.match(v.at, /^Atualizado às \d\d:\d\d\. Sem resposta do servidor agora: tentando de novo…$/);
  assert.equal(v.nums.aguardando, '3 pacientes aguardando atendimento', 'os números de antes ficam, com a hora deles');
  db.painelErr = null;
  await page.waitForFunction(() => /^Atualizado às \d\d:\d\d\.$/.test(document.querySelector('#nowAt').textContent));
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('"Contando você." só ao lado de números que já contam o médico (servidor fora do ar ou lento); menu com os cinco itens também sem nada para assinar', async () => {
  const db = seedDb();
  seedPanel(db);
  db.docs = []; // nada para assinar: "Documentos" leva às consultas anteriores (cada uma tem o bloco "Documentos")
  const { page, errors, context } = await newPage(browser, db, { painelMs: 500, notice: true });
  await page.goto(loginUrl('tok-ok'));
  await waitNum(page, 'medicos_disponiveis', 1); // só o Davi
  assert.equal((await panelView(page)).me, '');
  // Menu do médico aprovado: sempre os cinco itens.
  assert.deepEqual(await menuItems(page), [['Painel', '#painel'], ['Fila', '#dutyCard'], ['Consultas', '#histCard'], ['Documentos', '#histCard'], ['Meu cadastro', '#meCard']]);
  await page.click('#mdMenu [data-go="documentos"]');
  await page.waitForFunction(() => document.activeElement?.id === 'histTitle');
  // Guarda cada par (número de médicos, frase) que apareceu na tela, para conferir no fim.
  await page.evaluate(() => {
    window.__pairs = [];
    const snap = () => window.__pairs.push([document.querySelector('[data-num="medicos_disponiveis"] .md-nv').textContent.trim(), document.querySelector('#nowMe').textContent]);
    new MutationObserver(snap).observe(document.querySelector('#painel'), { childList: true, characterData: true, subtree: true });
  });
  // Fica disponível com o painel fora do ar: o número de antes (só o Davi) não ganha "Contando você.".
  db.painelErr = { status: 503, body: { message: 'falha simulada' } };
  const n0 = painelCalls(db, 'u-ok');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#nowBtn');
  await page.waitForSelector('#availBtn[aria-checked="true"]');
  assert.ok(Date.parse(docOf(db, 'u-ok').available_until) > Date.now(), 'disponível no banco (o banco já conta 2)');
  await until(() => painelCalls(db, 'u-ok') >= n0 + 3, 'o painel tentou de novo (e falhou)');
  await page.waitForFunction(() => /Sem resposta do servidor agora/.test(document.querySelector('#nowAt').textContent));
  let v = await panelView(page);
  assert.equal(v.nums.medicos_disponiveis, '1 médico disponível agora', 'o número de antes fica, com a hora dele');
  assert.equal(v.me, '', 'número que não conta o médico: sem "Contando você."');
  assert.equal(v.btn, 'Ver a fila');
  await shot(page, 'medicos-26-contando-voce-so-com-o-numero-novo');
  // O servidor volta: o número já conta o médico, agora com a frase.
  db.painelErr = null;
  await waitNum(page, 'medicos_disponiveis', 2);
  await page.waitForFunction(() => document.querySelector('#nowMe').textContent === 'Contando você.');
  // Servidor lento. Desligou: a frase sai na hora e o número de agora (sem o médico) vem depois que o banco tirou ele.
  db.painelDelay = 900;
  await page.click('#availBtn');
  await page.waitForSelector('#availBtn[aria-checked="false"]');
  assert.equal((await panelView(page)).me, '', 'desligou: sem a frase na hora');
  await waitNum(page, 'medicos_disponiveis', 1);
  // Ligou de novo: até os números novos chegarem, nada de "Contando você."; depois, o número que conta ele, com a frase.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#nowBtn');
  await page.waitForSelector('#availBtn[aria-checked="true"]');
  assert.equal((await panelView(page)).me, '', 'logo depois de ligar: sem a frase');
  await waitNum(page, 'medicos_disponiveis', 2);
  await page.waitForFunction(() => document.querySelector('#nowMe').textContent === 'Contando você.');
  db.painelDelay = 0;
  const pairs = await page.evaluate(() => window.__pairs);
  assert.ok(pairs.some(([n, me]) => n === '2' && me === 'Contando você.'), 'apareceu com o número que conta o médico');
  assert.deepEqual(pairs.filter(([n, me]) => me === 'Contando você.' && n !== '2'), [], '"Contando você." nunca ao lado de um número sem o médico');
  await page.waitForTimeout(1200); // deixa terminar o pedido lento que ainda estiver no caminho
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('"Ver e assinar" com a lista "Falta assinar" fora do ar: avisa que não abriu (não "nenhum documento"); lista vazia de verdade: "nenhum documento" e o número vem de novo do banco', async () => {
  const db = seedDb();
  seedPanel(db);
  db.fail.tele_doc_pending = { status: 503, body: { message: 'falha simulada' } };
  const { page, errors, context } = await newPage(browser, db, { notice: true });
  await page.goto(loginUrl('tok-ok'));
  await waitNum(page, 'documentos_para_assinar', 2);
  await until(() => db.called('tele_doc_pending').length >= 1, 'a lista foi pedida (e falhou)');
  assert.equal(await page.isHidden('#signCard'), true, 'sem a lista, o quadro "Falta assinar" fica escondido');
  // O painel diz 2 documentos; a lista não abre: a mensagem diz isso (antes dizia "Nenhum documento…", o que era falso).
  const toastIs = (re) => page.waitForFunction((src) => document.querySelector('#toast').classList.contains('show') && new RegExp(src).test(document.querySelector('#toast').textContent), re.source);
  const n0 = db.called('tele_doc_pending').length;
  await page.click('#nowSign');
  await toastIs(/^Não foi possível abrir a lista “Falta assinar” agora\. Tente de novo\.$/);
  assert.ok(db.called('tele_doc_pending').length > n0, 'tentou ler a lista de novo');
  assert.doesNotMatch(await page.textContent('#toast'), /Nenhum documento/);
  assert.equal(await page.isHidden('#signCard'), true);
  assert.equal((await panelView(page)).nums.documentos_para_assinar, '2 documentos para assinar', 'o número continua o do banco');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'medicos-27-ver-e-assinar-lista-fora-do-ar');
  // Os documentos foram assinados em outro aparelho e a lista volta vazia: agora sim "Nenhum documento…", e o painel
  // pede o número de novo na hora (0: o "Ver e assinar" some).
  for (const x of db.docs) x.signed_at = iso();
  delete db.fail.tele_doc_pending;
  const p0 = painelCalls(db, 'u-ok');
  await page.click('#nowSign');
  await toastIs(/^Nenhum documento esperando a sua assinatura agora\.$/);
  await waitNum(page, 'documentos_para_assinar', 0);
  assert.ok(painelCalls(db, 'u-ok') > p0, 'o painel pediu o número de novo');
  assert.equal((await panelView(page)).sign, false, 'sem documento: sem "Ver e assinar"');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('atualização: a cada 20 s com a aba à vista, para com a aba escondida e volta na hora; o leitor de tela ouve só a mudança da fila, uma vez (com a fila na tela, quem avisa é ela)', async () => {
  const db = seedDb();
  seedPanel(db);
  // Aviso ainda não lido: a fila não está na tela, então é o painel que avisa a mudança de quem espera (#nowLive).
  const { page, errors, context } = await newPage(browser, db);
  await page.clock.install(); // relógio controlado pelo teste: os 20 s de verdade, sem esperar
  await page.goto(loginUrl('tok-ok'));
  await visible(page, '#noticeCard');
  await waitNum(page, 'aguardando', 3);
  await page.waitForTimeout(300);
  const calls = () => painelCalls(db, 'u-ok');
  const n0 = calls();
  assert.equal(n0, 1, 'uma chamada ao abrir');
  // Live region: conta quantas vezes o texto do aviso muda e se os números foram refeitos sem mudar.
  await page.evaluate(() => {
    window.__live = 0; window.__nums = 0;
    new MutationObserver((ms) => { window.__live += ms.length; }).observe(document.querySelector('#nowLive'), { childList: true, characterData: true, subtree: true });
    new MutationObserver((ms) => { window.__nums += ms.length; }).observe(document.querySelector('#painel .md-nums'), { childList: true, characterData: true, subtree: true, attributes: true });
  });
  // (o relógio da página também anda sozinho, no tempo de verdade: as contas têm folga de alguns segundos)
  await page.clock.runFor(15000);
  await page.waitForTimeout(400);
  assert.equal(calls(), n0, 'aos 15 s, ainda não');
  await page.clock.runFor(6000);
  await until(() => calls() === n0 + 1, 'aos 20 s, de novo');
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => [window.__live, window.__nums]), [0, 0], 'números iguais: nada refeito nem anunciado');
  // Chegou mais um paciente: na próxima atualização o número muda e o leitor de tela ouve uma frase curta, uma vez.
  db.addConsult({ patient_name: 'Rita Nova', reason: 'Alergia', created_at: iso() });
  await page.clock.runFor(21000);
  await waitNum(page, 'aguardando', 4);
  let v = await panelView(page);
  assert.equal(v.live, 'Agora há 4 pacientes aguardando atendimento.');
  assert.doesNotMatch(v.live, /Rita|Alergia/, 'sem nome nem motivo no aviso');
  await page.clock.runFor(21000);
  await until(() => calls() === n0 + 3, 'mais uma atualização');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__live), 1, 'anunciado uma vez só (não a cada atualização)');
  // Aba escondida: para de pedir (nem a atualização que já estava marcada); ao voltar, pede na hora.
  await setTabHidden(page, true);
  const hiddenAt = calls();
  await page.clock.runFor(90000);
  await page.waitForTimeout(400);
  assert.equal(calls(), hiddenAt, 'com a aba escondida, nenhuma chamada');
  db.consults.filter((c) => c.status === 'waiting').forEach((c) => { c.status = 'cancelled'; });
  await setTabHidden(page, false);
  await waitNum(page, 'aguardando', 0);
  assert.equal(calls(), hiddenAt + 1, 'voltou: pediu na hora');
  v = await panelView(page);
  assert.equal(v.wait, '', 'sem "o primeiro espera" quando ninguém espera');
  assert.equal(v.live, 'Agora ninguém está aguardando atendimento.');
  assert.match(v.at, /^Atualizado às \d\d:\d\d\.$/);
  // Lido o aviso, a fila fica na tela e é ela que avisa a chegada ("Novo paciente na fila"); o painel atualiza o
  // número sem avisar de novo (antes, a mesma chegada era anunciada duas vezes).
  await page.check('#noticeOk');
  await page.click('#noticeBtn');
  await visible(page, '#dutyCard');
  await page.waitForFunction(() => /Atualizada às/.test(document.querySelector('#queueAt').textContent));
  const live0 = await page.evaluate(() => window.__live);
  db.addConsult({ patient_name: 'Rui Novo', reason: 'Dor nas costas', created_at: iso() });
  await page.clock.runFor(6000); // a fila: a cada 5 s
  await page.waitForFunction(() => /^Novo paciente na fila: Rui Novo/.test(document.querySelector('#queueLive').textContent));
  await page.clock.runFor(21000); // o painel: a cada 20 s
  await waitNum(page, 'aguardando', 1);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__live), live0, 'com a fila na tela, o painel não avisa de novo');
  assert.equal((await panelView(page)).live, 'Agora ninguém está aguardando atendimento.', 'o aviso do painel não mudou');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'medicos-23-fila-avisa-painel-quieto');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('aberta numa aba escondida (em segundo plano): o painel não pede nada até a aba aparecer', async () => {
  const db = seedDb();
  seedPanel(db);
  const { page, errors, context } = await newPage(browser, db, { painelMs: 400, notice: true });
  // Aba de fundo desde o começo (por exemplo, aberta de para-medicos.html com o botão do meio do mouse).
  await page.addInitScript(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  });
  await page.goto(loginUrl('tok-ok'));
  await page.waitForSelector('#dutyCard', { state: 'visible' });
  await page.waitForTimeout(1600); // 4 vezes o intervalo do painel neste teste
  assert.equal(painelCalls(db, 'u-ok'), 0, 'escondida: o painel não pediu nada');
  assert.equal(await page.isHidden('#painel'), true);
  // A aba aparece: os números vêm na hora, uma vez, e depois a cada intervalo.
  await setTabHidden(page, false);
  await waitNum(page, 'aguardando', 3);
  assert.equal(painelCalls(db, 'u-ok'), 1, 'apareceu: pediu na hora');
  await until(() => painelCalls(db, 'u-ok') >= 3, 'continua atualizando com a aba à vista');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'medicos-24-aba-de-fundo-painel-ao-aparecer');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('Plataforma de atendimento no celular (360 px): topo com menu que abre e fecha, números dois a dois, painel resumido com o médico disponível, sem rolagem lateral e alvos de 44 px', async () => {
  const db = seedDb();
  seedPanel(db);
  // Antes de entrar: o topo mostra o nome da plataforma e "Site do IMED" (sem botão "Menu" vazio).
  let p = await newPage(browser, db, { mobile: true, width: 360 });
  await p.page.goto(`${BASE}medico.html`);
  await visible(p.page, '#loginEmail');
  await noOverflow(p.page, 'medico.html sem entrar (360 px)');
  assert.ok(await p.page.evaluate(() => document.documentElement.scrollWidth) <= 360, 'cabe nos 360 px configurados');
  assert.equal(await p.page.isVisible('#menuBtn'), false);
  assert.equal(await p.page.isVisible('#mdMenu .md-site'), true);
  for (const sel of ['.logo', '#mdMenu .md-site']) {
    const b = await p.page.locator(sel).boundingBox();
    assert.ok(b.height >= 43.5 && b.x >= 0 && b.x + b.width <= 360, `${sel}: 44 px e dentro da tela (${JSON.stringify(b)})`);
  }
  await shot(p.page, 'medicos-20-celular-sem-entrar');
  assert.deepEqual(p.errors, []);
  await p.context.close();

  // Médico aprovado: quem espera na linha inteira e os outros quatro números dois a dois (o painel fica mais baixo e a
  // fila mais perto do topo); menu pelo botão.
  p = await newPage(browser, db, { mobile: true, width: 360, notice: true });
  const { page } = p;
  await page.goto(loginUrl('tok-ok'));
  await waitNum(page, 'aguardando', 3);
  await visible(page, '#dutyCard');
  await noOverflow(page, 'painel no celular (360 px)');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 360, 'cabe nos 360 px configurados');
  const tiles = await page.locator('#painel .md-num').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { k: e.dataset.num, l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), w: Math.round(r.width) }; }));
  assert.equal(tiles.length, 5);
  for (const t of tiles) assert.ok(t.l >= 12 && t.r <= 360 - 12, `quadro dentro da tela (${JSON.stringify(t)})`);
  const [main, t1, t2, t3, t4] = tiles;
  assert.ok(main.k === 'aguardando' && main.w > 2 * t1.w, `quem espera: a linha inteira (${JSON.stringify(tiles)})`);
  assert.ok(t1.t > main.t && t1.t === t2.t && t3.t === t4.t && t3.t > t1.t, `os outros: dois por linha (${JSON.stringify(tiles)})`);
  assert.ok(t1.l === t3.l && t2.l === t4.l && t2.l > t1.r, `em duas colunas (${JSON.stringify(tiles)})`);
  const offH = await page.$eval('#painel', (e) => Math.round(e.getBoundingClientRect().height));
  assert.ok(offH < 560, `painel mais baixo que antes (634 px): ${offH} px`);
  for (const sel of ['#nowBtn', '#nowSign', '#menuBtn']) {
    const b = await page.locator(sel).boundingBox();
    assert.ok(b.height >= 43.5 && b.x >= 0 && b.x + b.width <= 360, `${sel}: 44 px e dentro da tela (${JSON.stringify(b)})`);
  }
  assert.match(await text(page, '#nowWait'), /O primeiro da fila espera há 12 min\./);
  await shot(page, 'medicos-21-celular-painel');
  // Menu fechado: os itens não aparecem nem recebem foco.
  assert.equal(await page.getAttribute('#menuBtn', 'aria-expanded'), 'false');
  assert.equal(await page.getAttribute('#menuBtn', 'aria-controls'), 'mdMenu');
  assert.equal(await page.isVisible('#mdMenu [data-go="painel"]'), false);
  // Abre: cinco itens e "Site do IMED", cada um com 44 px e dentro da tela.
  await page.click('#menuBtn');
  assert.equal(await page.getAttribute('#menuBtn', 'aria-expanded'), 'true');
  await visible(page, '#mdMenu [data-go="painel"]');
  assert.deepEqual((await menuItems(page)).map(([t]) => t), ['Painel', 'Fila', 'Consultas', 'Documentos', 'Meu cadastro']);
  const links = await page.locator('#mdMenu a').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), h: r.height, l: r.left, r: r.right, top: r.top }; }));
  assert.equal(links.length, 6);
  for (const l of links) assert.ok(l.h >= 43.5 && l.l >= 0 && l.r <= 360, `${l.t}: 44 px e dentro da tela (${JSON.stringify(l)})`);
  links.forEach((l, i) => { if (i) assert.ok(l.top > links[i - 1].top, 'um embaixo do outro'); });
  await noOverflow(page, 'menu aberto (360 px)');
  await shot(page, 'medicos-22-celular-menu-aberto');
  // Esc fecha e devolve o foco ao botão.
  await page.locator('#mdMenu [data-go="fila"]').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.getAttribute('#menuBtn', 'aria-expanded'), 'false');
  assert.equal(await focusedId(page), 'menuBtn');
  await page.waitForSelector('#mdMenu [data-go="painel"]', { state: 'hidden' });
  // Abre e escolhe "Fila": o menu fecha e o foco vai para o título da fila, à vista (não fica atrás do topo).
  await page.click('#menuBtn');
  await page.click('#mdMenu [data-go="fila"]');
  await page.waitForFunction(() => document.activeElement?.id === 'dutyTitle');
  assert.equal(await page.getAttribute('#menuBtn', 'aria-expanded'), 'false');
  const topH = await page.locator('#mdTop').evaluate((h) => h.getBoundingClientRect().bottom);
  const tb = await page.locator('#dutyTitle').boundingBox();
  assert.ok(tb.y >= topH - 1 && tb.y < 844, `título da fila à vista, abaixo do topo (${tb.y} >= ${topH})`);
  // Um toque fora do topo também fecha.
  await page.click('#menuBtn');
  await page.locator('#nowTitle').dispatchEvent('click');
  assert.equal(await page.getAttribute('#menuBtn', 'aria-expanded'), 'false');
  // Com o Tab, sair do menu aberto fecha a caixa (ela não cobre o que recebe o foco).
  await page.click('#menuBtn');
  await page.locator('#mdMenu .md-site').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.getAttribute('#menuBtn', 'aria-expanded'), 'false', 'foco saiu do topo: menu fechado');

  // Disponível no celular: o painel fica resumido (quem espera, há quanto tempo espera o primeiro e "Ver a fila") e a
  // fila sobe; a frase "Só números…" continua. Desligou: os outros números voltam.
  const dutyTop = () => page.$eval('#dutyCard', (e) => Math.round(e.getBoundingClientRect().top + window.scrollY));
  const shownNums = () => page.$$eval('#painel .md-num', (els) => els.filter((e) => e.getClientRects().length).map((e) => e.dataset.num));
  const offTop = await dutyTop();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#nowBtn');
  await page.waitForSelector('#availBtn[aria-checked="true"]');
  await page.waitForFunction(() => document.querySelector('#nowBtn').textContent === 'Ver a fila');
  assert.deepEqual(await shownNums(), ['aguardando'], 'resumido: só quem espera');
  const onH = await page.$eval('#painel', (e) => Math.round(e.getBoundingClientRect().height));
  const onTop = await dutyTop();
  assert.ok(onH < 320, `painel resumido: ${onH} px`);
  assert.ok(onTop <= offTop - 200, `a fila subiu (${offTop} -> ${onTop} px)`);
  assert.match(await text(page, '#painel'), /3 pacientes aguardando atendimento O primeiro da fila espera há 12 min\./);
  assert.match(await text(page, '#painel'), /Só números: este painel não mostra dados de pacientes\./);
  const vb = await page.locator('#nowBtn').boundingBox();
  assert.ok(vb.height >= 43.5 && vb.x >= 0 && vb.x + vb.width <= 360, `"Ver a fila": 44 px e dentro da tela (${JSON.stringify(vb)})`);
  await noOverflow(page, 'painel resumido (360 px)');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'medicos-25-celular-disponivel-painel-resumido');
  await page.click('#nowBtn');
  await page.waitForFunction(() => document.activeElement?.id === 'dutyTitle');
  await page.click('#availBtn');
  await page.waitForSelector('#availBtn[aria-checked="false"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#painel .md-num')].every((e) => e.getClientRects().length));
  assert.deepEqual(await shownNums(), NUMS, 'desligou: os cinco números de novo');
  assert.deepEqual(p.errors, []);
  await p.context.close();
});

await scenario('ligações: página inicial, rodapé, sitemap e topo da área do médico levam a para-medicos.html', async () => {
  // Página inicial: link discreto na seção da teleconsulta.
  const idx = read('index.html');
  const sec = idx.slice(idx.indexOf('<section class="sec rv" id="lista"'), idx.indexOf('</section>', idx.indexOf('id="lista"')));
  assert.match(sec, /<p class="tele-doc"><a href="para-medicos\.html"><i class="fa-solid fa-user-doctor" aria-hidden="true"><\/i>É médico\? Atenda pelo IMED<\/a><\/p>/);
  // Rodapé (modelo): "Para médicos" e, logo depois, "Área do médico" (a Plataforma de atendimento) no grupo de clínicas
  // e médicos.
  const grupo = GRUPOS.find(([, links]) => links.some(([, p]) => p === 'para-medicos.html'));
  assert.equal(grupo?.[0], 'Clínicas e médicos');
  const paths = grupo[1].map(([, p]) => p);
  assert.equal(paths.indexOf('medico.html'), paths.indexOf('para-medicos.html') + 1, '"Área do médico" logo depois de "Para médicos"');
  assert.deepEqual(grupo[1].find(([, p]) => p === 'medico.html'), ['Área do médico', 'medico.html']);
  assert.ok(rodapeHtml('').includes('<li><a href="para-medicos.html">Para médicos</a></li>\n          <li><a href="medico.html">Área do médico</a></li>'));
  assert.ok(rodapeHtml('../').includes('<li><a href="../para-medicos.html">Para médicos</a></li>'));
  assert.ok(rodapeHtml('../../../').includes('<li><a href="../../../medico.html">Área do médico</a></li>'));
  // Sitemap e topo da área do médico (agora "Plataforma de atendimento", com "Site do IMED" de volta para o site).
  assert.equal(read('sitemap.xml').split(`<loc>${SITE}para-medicos.html</loc>`).length - 1, 1);
  assert.match(read('medico.html'), /<p class="md-howto"><a href="para-medicos\.html">/);
  assert.match(read('medico.html'), /<span class="md-brand">Plataforma de atendimento<\/span>/);
  assert.match(read('medico.html'), /<a class="md-site" href="\.\/"><i class="fa-solid fa-house" aria-hidden="true"><\/i><span class="md-site-t">Site do IMED<\/span><\/a>/);
  // No celular, o link da página inicial aparece e tem 44 px de altura (fácil de tocar).
  const db = makeDb();
  const { page, context } = await newPage(browser, db, { mobile: true });
  await context.route(`${SUPA}/**`, (route) => json(route, []));
  await page.goto(BASE);
  const link = page.locator('#lista a[href="para-medicos.html"]');
  await link.scrollIntoViewIfNeeded();
  // Depois da rolagem, a página ainda carrega a seção da teleconsulta: sem médico atendendo, a lista de espera aparece
  // em cima do link e o empurra para baixo. Espera essa carga e o link parar no lugar antes de medir e tocar.
  await page.waitForFunction(() => /Nenhum médico atendendo agora/.test(document.querySelector('#teleNow')?.textContent || '') && !document.querySelector('#teleWait')?.hidden);
  await settle(link);
  await link.scrollIntoViewIfNeeded();
  await link.waitFor({ state: 'visible' });
  assert.equal((await link.innerText()).trim(), 'É médico? Atenda pelo IMED');
  const box = await link.boundingBox();
  assert.ok(box.height >= 43.5 && box.x >= 0 && box.x + box.width <= 390, `link com 44 px e dentro da tela (${JSON.stringify(box)})`);
  await link.click();
  await page.waitForURL(`${BASE}para-medicos.html`);
  await context.close();
});

await scenario('acessibilidade (axe-core): página nova, etapas, link de ajuda, topo da plataforma e painel sem problema grave', async () => {
  if (!AXE) { console.log('  aviso - axe-core não encontrado: auditoria pulada (instale o axe-core ou passe AXE_PATH).'); return; }
  const db = seedDb();
  for (const mobile of [false, true]) {
    const { page, context } = await newPage(browser, db, { mobile, csp: false });
    await page.goto(`${BASE}para-medicos.html`);
    await page.click('summary:has-text("O que quer dizer cada situação")');
    assert.deepEqual(await runAxe(page), [], `para-medicos.html (${mobile ? 'celular' : 'computador'})`);
    await context.close();
  }
  for (const [tok, sel] of [['tok-new', '#regSteps'], ['tok-pend', '#meSteps'], ['tok-rej', '#meSteps'], ['tok-sus', '#meSteps']]) {
    const { page, context } = await newPage(browser, db, { csp: false });
    await page.goto(loginUrl(tok));
    await visible(page, `${sel} .md-stepper`);
    assert.deepEqual(await runAxe(page, [[sel], ['.md-howto'], ['#mdTop']]), [], `medico.html ${tok}`);
    await context.close();
  }
  // Médico aprovado: topo com o menu (no celular, aberto) e o painel "Agora na plataforma".
  seedPanel(db);
  for (const mobile of [false, true]) {
    const { page, context } = await newPage(browser, db, { mobile, width: 360, csp: false, notice: true });
    await page.goto(loginUrl('tok-ok'));
    await waitNum(page, 'aguardando', 3);
    if (mobile) { await page.click('#menuBtn'); await visible(page, '#mdMenu [data-go="painel"]'); }
    assert.deepEqual(await runAxe(page, [['#mdTop'], ['#painel']]), [], `medico.html aprovado (${mobile ? 'celular, menu aberto' : 'computador'})`);
    await context.close();
  }
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
