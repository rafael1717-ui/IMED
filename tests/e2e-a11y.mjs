// Acessibilidade das páginas principais num navegador de verdade (Playwright), com o banco simulado.
// Pensado para idosos e para quem usa leitor de tela ou só o teclado:
//  - axe-core (regras WCAG 2.0, 2.1 e 2.2, níveis A e AA, e boas práticas) no computador e no celular (390 px);
//    falha com violação "serious" ou "critical";
//  - checagens próprias: idioma pt-BR; contraste do texto sobre degradê (botões, que o axe não mede); no celular,
//    alvos de toque com pelo menos 44 px, campos com letra de 16 px ou mais (o iPhone não dá zoom) e nada de
//    rolar para o lado; em cada parada do Tab, foco visível (3:1 contra o fundo) e não escondido atrás do topo,
//    do menu de baixo ou do aviso de privacidade;
//  - "reduzir movimento": nenhuma animação sem fim, rolagem sem efeito e o botão "Pausar animação" do 3D;
//  - fluxos só com o teclado: buscar, abrir um local, pedir agendamento e Meus pedidos; as janelas (diálogos)
//    prendem o foco, fecham com Esc e devolvem o foco para onde estava.
// O axe-core não faz parte do site. O teste procura em AXE_PATH (o arquivo axe.js/axe.min.js, a pasta do pacote
// ou uma pasta com node_modules/axe-core) e no node_modules; sem ele, avisa e pula só o cenário do axe (as
// checagens próprias e os fluxos de teclado rodam do mesmo jeito). No CI (variável CI ou GITHUB_ACTIONS), sem o
// axe o teste FALHA: lá a auditoria é obrigatória.
// Rodar: AXE_PATH=/caminho/node_modules/axe-core node tests/e2e-a11y.mjs
// Opcional: E2E_PORT=8788 (outra porta), ONLY="texto" (só as páginas/cenários com esse texto),
//           A11Y_JSON=arquivo.json (salva tudo o que o axe achou, também "moderate" e "minor").
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, vigiarChaves } from './regra-chaves.mjs';
import { simularGeo } from './geo-simulado.mjs';
import { simularMapa } from './mapa-simulado.mjs';
import { ROLE_PERMS } from '../assets/js/agenda-core.js';
import { PASTA, semCaminho } from './endereco.mjs';

const OWNER_PERMS = ROLE_PERMS.owner;

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
const PORT = Number(process.env.E2E_PORT) || 8788; // E2E_PORT: outra porta para rodar em paralelo
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+F9PQAJYwN6V0E0WwAAAABJRU5ErkJggg==', 'base64');

/* ======================= axe-core (fora do site) ======================= */
function findAxe() {
  const tries = [];
  if (process.env.AXE_PATH) {
    const p = resolve(process.env.AXE_PATH);
    tries.push(() => require.resolve(p)); // arquivo axe.js / axe.min.js ou a pasta do pacote
    tries.push(() => createRequire(join(p, 'noop.js')).resolve('axe-core')); // pasta com node_modules/axe-core
  }
  tries.push(() => require.resolve('axe-core')); // node_modules do projeto (ou NODE_PATH)
  for (const t of tries) {
    try {
      const f = t();
      if (f && existsSync(f)) {
        const min = join(dirname(f), 'axe.min.js');
        return existsSync(min) ? min : f;
      }
    } catch { /* tenta o próximo */ }
  }
  return null;
}
const AXE = findAxe();
// No GitHub (CI), o axe é obrigatório: sem ele, o centro deste teste (a auditoria) seria pulado sem ninguém ver e
// qualquer violação grave nova passaria. O workflow precisa instalar o axe-core (versão fixa) junto do Playwright.
const NO_CI = !process.env.CI && !process.env.GITHUB_ACTIONS;
if (!AXE && !NO_CI) {
  console.log('FALHOU - axe-core não encontrado no CI: instale o axe-core (ex.: npm install --no-save "axe-core@4.14.0", junto do Playwright no .github/workflows/testes.yml) ou passe AXE_PATH.');
  process.exit(1);
}
if (!AXE) console.log('aviso - axe-core não encontrado: os cenários do axe foram pulados (só fora do CI). Instale fora do site (npm i axe-core@4) e rode com AXE_PATH=<pasta>/node_modules/axe-core.');
// Regras: WCAG 2.0/2.1/2.2 A e AA e as boas práticas do axe.
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const GRAVE = new Set(['serious', 'critical']);

/* ======================= servidor (como o GitHub Pages) ======================= */
// O site mora no caminho do siteUrl (tests/endereco.mjs; a página 404 usa esse caminho) e o que não existe recebe o 404.html.
const server = http.createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  path = semCaminho(path);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (path.endsWith('/')) file = join(file, 'index.html');
  let body;
  try { body = await readFile(file); } catch { body = null; }
  if (body) res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  else res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(await readFile(join(ROOT, '404.html')));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;

/* ======================= dados simulados ======================= */
const USER_ID = 'uuuuuuuu-0000-4000-8000-0000000000a1';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const PARTNER_ID = 'bbbbbbbb-0000-4000-8000-000000000011';
const CITIES = [
  { ibge: 3550308, name: 'São Paulo', uf: 'SP', total: 6548, imagem: 574, laboratorio: 524, clinica: 5161, hospital: 289 },
  { ibge: 3106200, name: 'Belo Horizonte', uf: 'MG', total: 2284, imagem: 191, laboratorio: 206, clinica: 1794, hospital: 93 },
  { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', total: 3000, imagem: 300, laboratorio: 200, clinica: 2300, hospital: 200 },
];
const MUNICIPALITIES = [{ ibge: 3550308, name: 'São Paulo', uf: 'SP', cnes_code: 355030 }, { ibge: 3304557, name: 'Rio de Janeiro', uf: 'RJ', cnes_code: 330455 }];
// Parceiros (nearby_clinics / busca): um verificado com preços e convênios.
const PARTNER_ROWS = [
  { id: PARTNER_ID, name: 'Imagem Paulista Verificada', kind: 'imagem', description: 'Centro de imagem.', address_line: 'Av. Paulista, 1500', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: '01310-200', lat: -23.5625, lng: -46.6565, distance_m: 300, phone: '(11) 3222-1000', whatsapp: null, email: null, website: null, specialties: ['Radiologia'], opening_hours: { seg: '07:00–19:00' }, accepts_online_booking: true, is_demo: false, exams: [{ code: 'rm', price_cents: 45000 }, { code: 'tc', price_cents: 30000 }, { code: 'rx', price_cents: null }], insurances: ['Bradesco Saúde', 'SulAmérica'], cnes: '7654321' },
];
// Estabelecimentos do cadastro oficial (nearby_establishments).
const CNES_ROWS = [
  { cnes: '2077485', name: 'Hospital Santa Exemplo', kind: 'hospital', cnes_type: 5, address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', cep: '01409001', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5598, lng: -46.6602, distance_m: 420, location_source: 'cnes', phone: '(11) 3141-1000', shift: null, open_24h: true, sus: false, services: ['rm', 'tc', 'rx'], specialties: ['Cardiologia'], cnes_updated_at: '2026-09-15' },
  { cnes: '6543210', name: 'Laboratório Análise Paulista', kind: 'laboratorio', cnes_type: 39, address_line: 'Alameda Santos, 200', neighborhood: 'Bela Vista', cep: '01418000', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5655, lng: -46.6520, distance_m: 640, location_source: 'endereco', phone: '(11) 3000-2000', shift: 'Manhã e tarde', open_24h: false, sus: true, services: ['lab'], specialties: [], cnes_updated_at: '2026-08-02' },
  { cnes: '7000001', name: 'Centro de Imagem Augusta', kind: 'imagem', cnes_type: 39, address_line: 'Rua Augusta, 1000', neighborhood: 'Consolação', cep: '01304001', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.556, lng: -46.657, distance_m: 900, location_source: 'cnes', phone: null, shift: null, open_24h: false, sus: false, services: ['rx'], specialties: [], cnes_updated_at: '2026-09-01' },
  { cnes: '7000002', name: 'Clínica Bela Vista', kind: 'clinica', cnes_type: 36, address_line: 'Rua Treze de Maio, 50', neighborhood: 'Bela Vista', cep: '01327000', city: 'São Paulo', uf: 'SP', city_code: '355030', lat: -23.5635, lng: -46.6450, distance_m: 1200, location_source: 'cnes', phone: '(11) 3100-0000', shift: 'Manhã', open_24h: false, sus: true, services: [], specialties: ['Clínica geral'], cnes_updated_at: '2026-09-01' },
];
const POINTS = CNES_ROWS.map(({ cnes, name, kind, lat, lng, distance_m }) => ({ cnes, name, kind, lat, lng, distance_m, total: CNES_ROWS.length }));
// Linhas das tabelas (REST): estabelecimentos (ficha do local, reivindicar, painel) e clínicas (ficha do parceiro, painel).
const ESTABLISHMENTS = [
  { cnes: '2077485', name: 'Hospital Santa Exemplo', legal_name: 'Associação Santa Exemplo', kind: 'hospital', address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', cep: '01409001', phone: '(11) 3141-1000', shift: 'Manhã, tarde e noite', open_24h: false, sus: true, services: ['rm', 'tc'], specialties: ['Cardiologia', 'Ortopedia'], cnes_updated_at: '2026-09-15', location_source: 'cnes', location: { type: 'Point', coordinates: [-46.6602, -23.5598] }, city_ibge: 3550308, municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 } },
  { cnes: '6543210', name: 'Laboratório Análise Paulista', legal_name: null, kind: 'laboratorio', address_line: 'Alameda Santos, 200', neighborhood: 'Bela Vista', cep: '01418000', phone: null, shift: null, open_24h: false, sus: null, services: ['lab'], specialties: [], cnes_updated_at: null, location_source: null, location: null, city_ibge: 3550308, municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 } },
];
const CLINIC = {
  id: C1, name: 'Imagem Paulista', kind: 'imagem', description: null, address_line: 'Av. Paulista, 1500', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: '01310-200',
  location: { type: 'Point', coordinates: [-46.6565, -23.5625] }, phone: '(11) 3222-1000', whatsapp: null, email: null, website: null, specialties: ['Radiologia'], opening_hours: null,
  accepts_online_booking: true, status: 'published', is_demo: false, insurances: ['Amil'], cnes: '7654321', verified_at: '2026-10-01T02:30:00+00:00',
  clinic_exams: [{ exam_code: 'rm', price_cents: 45000, price_updated_at: '2026-10-01T10:00:00Z' }, { exam_code: 'tc', price_cents: null, price_updated_at: null }],
};
const PARTNER_CLINIC = {
  ...CLINIC, id: PARTNER_ID, name: 'Imagem Paulista Verificada', description: 'Centro de diagnóstico por imagem na Paulista.', whatsapp: '5511988887777', website: 'https://imagempaulista.com.br',
  opening_hours: { seg: '07:00–19:00', sab: '08:00–12:00' }, insurances: ['Bradesco Saúde', 'SulAmérica'], cnes: null,
  clinic_exams: [{ exam_code: 'tc', price_cents: 30000, price_updated_at: '2026-10-01T10:00:00Z' }, { exam_code: 'rm', price_cents: 45000, price_updated_at: '2026-10-01T01:30:00+00:00' }, { exam_code: 'rx', price_cents: null, price_updated_at: null }],
};
const CLINIC_EXAMS = [{ clinic_id: C1, exam_code: 'rm', price_cents: 45000 }, { clinic_id: C1, exam_code: 'tc', price_cents: null }];
const RATINGS = { 'cnes:2077485': { rating: 4.6, reviews: 12 } };
const REVIEWS = { 'cnes:2077485': [
  { rating: 5, comment: 'Atendimento rápido.', author_name: 'Maria Silva', created_at: '2026-10-20T13:00:00Z' },
  { rating: 4, comment: null, author_name: 'João', created_at: '2026-10-01T12:00:00Z' },
] };
// Horários livres do parceiro com agenda (amanhã e depois de amanhã, em São Paulo).
// T0: o "agora" da execução inteira. As datas do banco simulado saem dele, e o relógio do navegador da área da clínica
// fica parado nele (painel.html): uma execução que cruza a meia-noite de São Paulo não muda o "hoje" no meio.
const T0 = Date.now();
const spDay = (n) => new Date(T0 + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const SLOTS = [`${spDay(1)}T09:00:00-03:00`, `${spDay(1)}T09:30:00-03:00`, `${spDay(1)}T14:00:00-03:00`, `${spDay(2)}T08:00:00-03:00`].map((s) => new Date(s).toISOString());
const AGENDA_INFO = {
  status: 'ok', clinic_id: PARTNER_ID, timezone: 'America/Sao_Paulo', mode: 'nativa', online: true,
  mode_text: 'A clínica usa a agenda do IMED: os horários mostrados são os livres na agenda dela agora.',
  payment_text: 'Pagamento no local, direto com a clínica.', cancel_until_min: 0, reschedule_until_min: 120,
  procedures: [
    { id: 'dddddddd-0000-4000-8000-0000000000a1', exam_code: 'rm', name: 'Ressonância', duration_min: 30, price_cents: 45000, prep_text: 'Retire objetos de metal.', fasting_hours: null },
    { id: 'dddddddd-0000-4000-8000-0000000000a2', exam_code: 'tc', name: 'Tomografia', duration_min: 20, price_cents: null, prep_text: null, fasting_hours: 4 },
  ],
};
// Pedidos guardados neste aparelho (Meus pedidos e Minha conta).
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const APPTS = [
  { type: 'pedido', code: 'IMED-11111111', id: ID1, token: 'a'.repeat(64), place_key: 'cnes:2077485', name: 'Hospital Santa Exemplo', exam: 'rm', items: ['Ressonância'], date: spDay(6), period: 'manha', status: 'pendente', created: '2026-10-29T12:00:00.000Z' },
  { type: 'pedido', code: 'IMED-22222222', id: ID2, token: 'b'.repeat(64), place_key: 'cnes:6543210', name: 'Laboratório Análise Paulista', exam: 'lab', items: ['Exames de laboratório'], date: spDay(-3), period: 'qualquer', status: 'pendente', created: '2026-10-15T12:00:00.000Z' },
];
const LIVE = { [ID1]: { status: 'confirmed', reviewed: false }, [ID2]: { status: 'completed', reviewed: false } };
// Pedidos no banco: da conta (Minha conta), da clínica e ao IMED (painel).
const REQUESTS = [
  { id: '55555555-5555-4555-8555-555555555555', user_id: USER_ID, clinic_id: null, created_at: '2026-10-29T15:00:00Z', place_name: 'Centro de Imagem Conta', place_source: 'cnes', place_ref: 'cnes:7000001', exam_code: 'usg', preferred_date: spDay(4), preferred_period: 'manha', slot_start: null, status: 'pending', patient_name: 'Ana Prado', patient_phone: '21998887777', patient_email: null, notes: null, place_address: 'Rua Augusta, 1000', place_phone: null, for_other: false },
  { id: 'rrrrrrrr-0000-4000-8000-000000000001', user_id: 'user-maria', clinic_id: C1, created_at: '2026-10-29T13:05:00Z', place_name: 'Imagem Paulista', place_source: 'imed', place_ref: null, exam_code: 'rm', preferred_date: spDay(5), preferred_period: 'manha', slot_start: null, status: 'pending', patient_name: 'Maria Souza', patient_phone: '11987654321', patient_email: 'maria@exemplo.com', notes: 'Tenho claustrofobia', for_other: false },
  { id: 'rrrrrrrr-0000-4000-8000-000000000002', user_id: null, clinic_id: C1, created_at: '2026-10-28T18:00:00Z', place_name: 'Imagem Paulista', place_source: 'imed', place_ref: null, exam_code: 'tc', preferred_date: spDay(3), preferred_period: 'qualquer', slot_start: `${spDay(3)}T12:00:00.000Z`, status: 'confirmed', patient_name: 'João Lima', patient_phone: '1133334444', patient_email: null, notes: null, for_other: true, other_name: 'Pedro Lima', relationship: 'filho', other_minor: true, guardian_consent: true },
];
const CLAIMS = [
  { id: 'kkkkkkkk-0000-4000-8000-000000000001', created_at: '2026-10-29T10:00:00Z', cnes: '2077485', user_id: 'x', email: 'dono@hospital.com.br', claimant_name: 'Carlos Dono', role: 'proprietario', document: '52998224725', crm: '123456-SP', phone: '11987650000', message: 'Sou o dono do hospital.', status: 'pending', decided_at: null, decision_note: null, clinic_id: null },
  { id: 'kkkkkkkk-0000-4000-8000-000000000002', created_at: '2026-10-20T11:00:00Z', cnes: '6543210', user_id: USER_ID, email: 'equipe@imed.com.br', claimant_name: 'Velho Pedido', role: 'gestor', document: '11222333000181', crm: null, phone: '1130002000', message: null, status: 'rejected', decided_at: '2026-10-21T11:00:00Z', decision_note: 'Sem vínculo', clinic_id: null },
];
const MESSAGES = [
  { id: 'mmmmmmmm-0000-4000-8000-000000000001', protocol: 'IMED-20261030-AB2C', created_at: '2026-10-30T13:00:00Z', subject: 'dados_exclusao', name: 'Maria Souza', reply_email: 'maria@exemplo.com', reply_phone: null, message: 'Quero apagar meus dados.', request_code: null, user_id: null, account_email: null, status: 'open', answered_at: null },
  { id: 'mmmmmmmm-0000-4000-8000-000000000002', protocol: 'IMED-20261029-ZZ34', created_at: '2026-10-29T18:00:00Z', subject: 'cancelamento', name: 'João Lima', reply_email: null, reply_phone: '11987654321', message: 'Quero cancelar o exame de amanhã.', request_code: 'IMED-ABC123', user_id: null, account_email: null, status: 'open', answered_at: null },
];
const REPORTS = [
  { id: 'pppppppp-0000-4000-8000-000000000001', created_at: '2026-10-30T12:00:00Z', cnes: '2077485', clinic_id: null, kind: 'telefone', note: 'Ninguém atende.', user_id: null, status: 'open', resolved_at: null,
    establishments: { name: 'Hospital Santa Exemplo', address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César', phone: '(11) 3141-1000', municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 } }, clinics: null },
];
const STATS = {
  dias: 7, de: '2026-10-24', ate: '2026-10-30', visitas: 1260,
  por_dia: [
    { dia: '2026-10-24', visitas: 0 }, { dia: '2026-10-25', visitas: 200 }, { dia: '2026-10-26', visitas: 0 }, { dia: '2026-10-27', visitas: 1000 },
    { dia: '2026-10-28', visitas: 0 }, { dia: '2026-10-29', visitas: 0 }, { dia: '2026-10-30', visitas: 60 },
  ],
  paginas: [{ pagina: '/perto.html', visitas: 700 }, { pagina: '/', visitas: 400 }],
  exames: [{ exame: 'rm', total: 12 }], tipos: [{ tipo: 'imagem', total: 4 }], cidades: [{ cidade: 'SP/São Paulo', total: 9 }], pedidos: [{ exame: 'rm', total: 2 }],
  pedidos_total: 3, teleconsultas: 0, eventos: { busca_exame: 15, busca_tipo: 4, busca_cidade: 10 },
};
const SCHEDULES = [
  { id: 's1', clinic_id: C1, weekday: 1, start_time: '08:00:00', end_time: '12:00:00', slot_minutes: 30, exam_codes: [] },
  { id: 's2', clinic_id: C1, weekday: 3, start_time: '13:00:00', end_time: '17:00:00', slot_minutes: 20, exam_codes: ['rm'] },
];
// Configuração da agenda (iMed Agenda 4.1): ativa (unidade, horários, cadastros) e ainda não ativa (configuração rápida).
const AG_R1 = 'rsrcrsrc-0000-4000-8000-0000000000a1';
const AG_UNIT = { timezone: 'America/Sao_Paulo', timezone_suggested: 'America/Sao_Paulo', timezone_confirmed_at: '2026-11-01T12:00:00Z', agenda_mode: 'manual', agenda_online_since: null,
  manual_commitment_at: '2026-11-01T12:00:00Z', step_min: 10, min_notice_min: 120, max_advance_days: 60, holidays_checked_until: null, closes_on_holidays: true };
const AG_CFG = { status: 'ok', active: true, old_schedule_exists: false, unit: AG_UNIT,
  resources: [{ id: AG_R1, kind: 'equipamento', name: 'Aparelho de teste 1', capacity: 1, setup_min: 0, cleanup_min: 5, member_user_id: null, council: null, council_number: null, active: true }],
  procedures: [{ id: 'procproc-0000-4000-8000-0000000000b1', exam_code: 'usg', name: 'Ultrassom de teste', duration_min: 20, price_cents: null, online_booking: true, active: true,
    requirements: [{ group_no: 1, resource_kind: 'equipamento', options: [{ resource_id: AG_R1, priority: 1 }] }] }],
  rules: [{ resource_id: null, weekday: 1, start: '08:00', end: '12:00', kind: 'abre', valid_from: null, valid_to: null, label: null, procedure_ids: [] },
    { resource_id: null, weekday: 1, start: '10:00', end: '10:15', kind: 'pausa', valid_from: null, valid_to: null, label: null, procedure_ids: [] }],
  pair_rules: [], holiday_openings: [] };
const AG_RAPIDA = { ...AG_CFG, active: false, unit: { ...AG_UNIT, timezone_confirmed_at: null, agenda_mode: 'pedido', manual_commitment_at: null }, resources: [], procedures: [], rules: [] };
const BLOCKS = [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', clinic_id: C1, starts_at: `${spDay(10)}T03:00:00+00:00`, ends_at: `${spDay(11)}T03:00:00+00:00`, reason: 'Feriado' }];
// Agenda da recepção (iMed Agenda 4.2): hoje com cada situação, um "só ocupar", um bloqueio de sala e um "Para
// remarcar". Nomes de teste; o <b> prova que o texto do banco é escapado.
const AG_TODAY = spDay(0);
const agAt = (hhmm, day = AG_TODAY) => new Date(`${day}T${hhmm}:00-03:00`).toISOString();
const AG_SALA = 'rsrcrsrc-0000-4000-8000-0000000000a2';
const AG_RES = [{ id: AG_R1, kind: 'equipamento', name: 'Aparelho de Ultrassom <b>1</b>', capacity: 1, active: true }, { id: AG_SALA, kind: 'sala', name: 'Sala 2', capacity: 1, active: true }];
const AG_PROC = { id: 'procproc-0000-4000-8000-0000000000a1', exam_code: 'usg', name: 'Ultrassom de abdome', duration_min: 30, price_cents: 18000, online_booking: true, prep_text: 'Jejum de 8 horas.', fasting_hours: 8,
  min_notice_min: 120, groups: [{ group_no: 1, resource_kind: 'equipamento', resource_ids: [AG_R1] }] };
const agItem = (n, hhmm, status, patient, channel = 'clinica_telefone') => ({ id: `itemitem-0000-4000-8000-0000000000${n}`, request_id: `reqreqre-0000-4000-8000-0000000000${n}`, request_version: 1, seq: 1,
  procedure_id: AG_PROC.id, procedure: AG_PROC.name, exam_code: 'usg', starts_at: agAt(hhmm), ends_at: new Date(Date.parse(agAt(hhmm)) + 30 * 60000).toISOString(), status, version: 1, price_cents: 18000,
  resources: ['cancelled', 'reschedule_requested'].includes(status) ? [] : [AG_R1], channel, hold_expires_at: status === 'hold' ? new Date(T0 + 10 * 60000).toISOString() : null, patient });
const AG_ITEMS = [agItem('01', '08:00', 'completed', 'Carla T.'), agItem('02', '08:30', 'no_show', 'Bruno T.'), agItem('03', '09:00', 'confirmed', 'Maria <b>S.</b>', 'imed_app'),
  agItem('04', '09:30', 'checked_in', 'João T.'), agItem('05', '10:00', 'in_service', 'Ana R.', 'clinica_balcao'), agItem('06', '11:00', 'cancelled', 'Pedro S.'),
  agItem('07', '11:30', 'reschedule_requested', 'Lia T.'), agItem('08', '12:00', 'hold', 'Rui T.', 'imed_app')];
const AG_BUSY = [{ id: 'busybusy-0000-4000-8000-0000000000a1', starts_at: agAt('15:00'), ends_at: agAt('16:00'), reason_code: 'agenda_propria', resources: [AG_R1] }];
const AG_BLOCKS = [{ id: 'blkblkbl-0000-4000-8000-0000000000a1', resource_id: AG_SALA, resource_name: 'Sala 2', resource_kind: 'sala', kind: 'manutencao', starts_at: agAt('13:00'), ends_at: agAt('14:00'), reason: 'Troca do ar-condicionado', created_at: '2026-11-01T12:00:00Z' },
  { id: 'blkblkbl-0000-4000-8000-0000000000a2', resource_id: null, resource_name: null, resource_kind: null, kind: 'feriado', starts_at: `${spDay(10)}T03:00:00.000Z`, ends_at: `${spDay(11)}T03:00:00.000Z`, reason: 'Feriado municipal', created_at: '2026-11-01T12:00:00Z' }];
const AG_UNIT42 = { step_min: 15, min_notice_min: 120, max_advance_days: 90, checkin_before_min: 120, no_show_after_min: 15, patient_cancel_until_min: 0, patient_reschedule_until_min: 120, holidays_checked_until: '2027-12-31', closes_on_holidays: true };
const agDayStart = (day) => Date.parse(`${day}T00:00:00-03:00`);
const agDays = (from, n) => Array.from({ length: n }, (_, i) => new Date(agDayStart(from) + i * 86400000 + 12 * 3600000).toISOString().slice(0, 10));
// Respostas das funções da agenda (as mesmas formas do banco; e2e-agenda testa o comportamento).
function agendaRpc(fn, body) {
  const inRange = (x, from, days) => { const a = agDayStart(from); return Date.parse(x.starts_at) < a + days * 86400000 && Date.parse(x.ends_at) > a; };
  switch (fn) {
    case 'agenda_catalog': return { status: 'ok', scope: 'clinica', clinic_id: C1, timezone: 'America/Sao_Paulo', agenda_mode: 'nativa', active: true, online: false,
      can: { marcar: true, remarcar: true, cancelar: true, bloquear: true, atender: true, pacientes: true, conflitos: true }, unit: AG_UNIT42, national_holidays_until: '2027-12-31',
      resources: AG_RES.map((r) => ({ ...r, mine: false })), procedures: [AG_PROC] };
    case 'agenda_view': return { status: 'ok', version: 7, timezone: 'America/Sao_Paulo', scope: 'clinica', patients: true, resources: AG_RES,
      items: AG_ITEMS.filter((x) => inRange(x, body.p_from, body.p_days)), busy: AG_BUSY.filter((x) => inRange(x, body.p_from, body.p_days)),
      blocks: AG_BLOCKS.filter((x) => inRange(x, body.p_from, body.p_days)) };
    case 'agenda_free': return { status: 'ok', scope: 'clinica', timezone: 'America/Sao_Paulo', holidays_checked_until: '2027-12-31', national_holidays_until: '2027-12-31', closes_on_holidays: true,
      unit_open: agDays(body.p_from, body.p_days).map((d) => [agAt('07:00', d), agAt('19:00', d)]), holidays: [],
      resources: [{ id: AG_R1, free: agDays(body.p_from, body.p_days).map((d) => [agAt('16:00', d), agAt('19:00', d)]) }, { id: AG_SALA, free: agDays(body.p_from, body.p_days).map((d) => [agAt('14:00', d), agAt('19:00', d)]) }] };
    case 'agenda_month': {
      const ini = `${body.p_month.slice(0, 7)}-01`;
      const days = [];
      for (let d = new Date(`${ini}T12:00:00Z`); d.toISOString().slice(0, 7) === ini.slice(0, 7); d.setUTCDate(d.getUTCDate() + 1)) {
        const day = d.toISOString().slice(0, 10);
        days.push(day === AG_TODAY ? { day, ativos: 4, concluidos: 1, faltas: 1, cancelados: 1, bloqueios: 1 } : { day, ativos: 0, concluidos: 0, faltas: 0, cancelados: 0, bloqueios: 0 });
      }
      return { status: 'ok', timezone: 'America/Sao_Paulo', month: ini, days };
    }
    case 'agenda_version': return { status: 'ok', version: 7 };
    case 'agenda_conflicts': return { status: 'ok', conflicts: [{ id: 'confconf-0000-4000-8000-0000000000a1', kind: 'bloqueio_sobre_agendamento', request_id: AG_ITEMS[6].request_id, item_id: AG_ITEMS[6].id,
      starts_at: AG_ITEMS[6].starts_at, procedure_id: AG_PROC.id, details: { starts_at: AG_ITEMS[6].starts_at, procedure_id: AG_PROC.id }, status: 'aberto', created_at: '2026-11-01T12:00:00Z' }] };
    case 'agenda_blocks': return { status: 'ok', scope: 'clinica', timezone: 'America/Sao_Paulo', from: AG_TODAY, to: spDay(400), can_edit: true, blocks: AG_BLOCKS };
    case 'agenda_request_detail': {
      const it = AG_ITEMS.find((x) => x.request_id === body.p_id) || AG_ITEMS[2];
      return { status: 'ok', scope: 'clinica', id: it.request_id, clinic_id: C1, request_status: it.status, version: 1, agenda: true, channel: it.channel, created_at: '2026-11-01T12:00:00Z',
        exam_code: 'usg', preferred_date: AG_TODAY, preferred_period: 'manha', slot_start: it.starts_at, slot_end: it.ends_at, hold_expires_at: it.hold_expires_at, cancel_reason: null, cancelled_by: null, cancelled_at: null, anonymized: false,
        patient: { name: 'Maria <b>Souza</b> Teste', phone: '11988887777', email: 'maria@exemplo.test', for_other: false, other_name: null, relationship: null, other_minor: false, notes: 'Primeira vez <i>aqui</i>' },
        items: [{ ...it, resources: it.resources.map((id) => ({ id, name: AG_RES.find((r) => r.id === id).name, kind: AG_RES.find((r) => r.id === id).kind })) }], notes: [] };
    }
    case 'agenda_history': return { status: 'ok', history: [{ at: '2026-11-01T12:00:00Z', item_seq: 1, from: null, to: 'confirmed', actor_kind: 'clinica', actor_role: 'reception', origin: 'painel', reason_code: null, request_version: 1 }] };
    case 'agenda_desk_slots': return { status: 'ok', timezone: 'America/Sao_Paulo', from: body.p_from, to: body.p_to || body.p_from, holidays_checked_until: '2027-12-31', national_holidays_until: '2027-12-31',
      slots: ['16:00', '16:30', '17:00'].map((h) => ({ start: agAt(h, body.p_from), end: new Date(Date.parse(agAt(h, body.p_from)) + 30 * 60000).toISOString() })) };
    case 'agenda_block_add': return { status: 'has_appointments', items: [{ item_id: AG_ITEMS[2].id, request_id: AG_ITEMS[2].request_id, starts_at: AG_ITEMS[2].starts_at }], busy: 1 };
    case 'agenda_block_force': return { status: 'confirm_required', confirm: 'c'.repeat(64), items: [
      { kind: 'agendamento', item_id: AG_ITEMS[2].id, request_id: AG_ITEMS[2].request_id, busy_id: null, seq: 1, status: 'confirmed', request_version: 1, starts_at: AG_ITEMS[2].starts_at, ends_at: AG_ITEMS[2].ends_at,
        procedure_id: AG_PROC.id, procedure: AG_PROC.name, channel: 'imed_app', patient: 'Maria <b>S.</b>', can_move: true },
      { kind: 'ocupado', item_id: null, request_id: null, busy_id: AG_BUSY[0].id, seq: null, status: null, request_version: null, starts_at: AG_BUSY[0].starts_at, ends_at: AG_BUSY[0].ends_at, procedure_id: null, procedure: null, channel: null, patient: null, can_move: true }] };
    // Painel gerencial (4.3): números com a forma do banco; nomes com <b> provam o escape.
    case 'agenda_dashboard': return { status: 'ok', from: body.p_from, to: body.p_to, timezone: 'America/Sao_Paulo', total: 7,
      por_situacao: { reservado: 1, confirmado: 3, presente: 1, concluido: 1, faltou: 1, remarcacao: 0, cancelado: 0 }, faltas_pct: 50,
      cancelamentos_por_motivo: { paciente_desistiu: 1, sem_motivo: 1 }, origem: { imed: 4, clinica: 3, externo: 0 },
      por_dia: [{ day: AG_TODAY, total: 4 }, { day: spDay(1), total: 3 }],
      recursos: [{ resource_id: AG_R1, name: 'Aparelho <b>1</b>', kind: 'equipamento', capacity: 1, minutos_ocupados: 180, minutos_livres: 420, minutos_abertos: 600, minutos_bloqueados: 60, ocupacao_pct: 30 }],
      formula: 'ocupação = minutos ocupados (agendamentos e "ocupado", inclusive concluídos e faltas) ÷ minutos abertos (horário de funcionamento menos pausas, feriados e bloqueios)' };
    case 'agenda_dashboard_financeiro': return { status: 'ok', from: body.p_from, to: body.p_to, timezone: 'America/Sao_Paulo', receita_estimada_cents: 54000, receita_concluida_cents: 18000,
      agendamentos: 3, sob_consulta: 1, pagamento_online: false, por_exame: { usg: { estimada_cents: 54000, concluida_cents: 18000, agendamentos: 3 } },
      nota: 'Valores pelo preço informado pela clínica na hora da marcação. O pagamento é feito no local; o IMED não confirma pagamentos.' };
    case 'agenda_requests': return { status: 'ok', scope: 'clinica', timezone: 'America/Sao_Paulo', today: AG_TODAY,
      requests: [...REQUESTS.filter((r) => r.clinic_id === C1), { ...REQUESTS[1], id: AG_ITEMS[2].request_id, patient_name: 'Maria <b>Souza</b> Teste', exam_code: 'usg', preferred_date: AG_TODAY, slot_start: AG_ITEMS[2].starts_at, status: 'confirmed', uses_resources: true, channel: 'imed_app', notes: null }] };
    default: return undefined;
  }
}
// Minha conta com as situações novas da agenda (4.2): remarcação, falta, chegada, atendimento e reserva expirada.
const NOVAS = ['reschedule_requested', 'no_show', 'checked_in', 'in_service', 'expired'].map((status, i) => ({ status, id: `${i + 3}${i + 3}${i + 3}${i + 3}${i + 3}${i + 3}${i + 3}${i + 3}-3333-4333-8333-33333333333${i}` }));
const APPTS_NOVAS = NOVAS.map(({ id }, i) => ({ type: 'pedido', code: `IMED-${id.slice(0, 8)}`, id, token: String(i + 3).repeat(64), place_key: 'imed:x', name: 'Clínica Agenda Teste', phone: '(11) 3141-1000', exam: 'usg', items: ['Ultrassom'],
  date: spDay(6), period: 'manha', slot: agAt('09:00', spDay(6)), status: 'confirmado', created: '2026-11-01T10:00:00.000Z' }));
for (const { id, status } of NOVAS) LIVE[id] = { status, reviewed: false };
// 130 estabelecimentos de São Paulo para as páginas da cidade.
const KINDS = ['clinica', 'laboratorio', 'imagem', 'hospital'];
const CITY_ROWS = Array.from({ length: 130 }, (_, i) => ({
  cnes: String(2000000 + i), name: `Estabelecimento ${String(i + 1).padStart(3, '0')}`, kind: KINDS[i % 4], address_line: `Rua Exemplo, ${i + 10}`, neighborhood: 'Bela Vista', cep: '01310100',
  phone: i % 3 === 0 ? '(11) 3141-1000' : null, shift: i % 5 === 0 ? 'Manhã e tarde' : null, open_24h: i % 4 === 3, sus: i % 2 === 0, services: [], lat: -23.56 + i / 10000, lng: -46.65,
}));

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
// Filtros do PostgREST usados pelas páginas: eq, neq, in, is.null, gte, lte, ilike.
function applyFilters(rows, q) {
  let out = rows;
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset'].includes(k) || k.includes('.')) continue;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
    else if (op === 'neq') out = out.filter((r) => String(r[k]) !== val);
    else if (op === 'is' && val === 'null') out = out.filter((r) => r[k] == null);
    else if (op === 'gte') out = out.filter((r) => r[k] == null || String(r[k]) >= val);
    else if (op === 'lte') out = out.filter((r) => r[k] == null || String(r[k]) <= val);
    else if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(','); out = out.filter((r) => set.includes(String(r[k]))); }
    else if (op === 'ilike') { const t = val.replace(/^\*|\*$/g, '').toLowerCase(); out = out.filter((r) => String(r[k]).toLowerCase().includes(t)); }
  }
  const lim = Number(q.get('limit') || 0);
  return lim ? out.slice(0, lim) : out;
}

// Banco, login e funções simulados (tudo o que as páginas pedem ao Supabase).
async function mockSupabase(context, { admin = false, member = false, rapida = false } = {}) {
  const log = [];
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const path = url.pathname;
    const q = url.searchParams;
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
    log.push({ method: req.method(), path, q: url.search, body });
    const logged = /^Bearer tok-/.test(req.headers().authorization || '');
    if (path === '/auth/v1/otp') return json(route, {});
    if (path === '/auth/v1/user') return logged ? json(route, { id: USER_ID, email: 'equipe@imed.com.br' }) : json(route, { msg: 'invalid' }, 401);
    if (path === '/auth/v1/token') return json(route, { access_token: 'tok-novo', refresh_token: 'ref2', expires_in: 3600, user: { id: USER_ID, email: 'equipe@imed.com.br' } });
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
    if (path === '/functions/v1/clinicas-proximas') {
      if (body?.action === 'search') return json(route, { ok: true, provider: 'osm', radius_m: body.radius_m, warnings: [], imed: PARTNER_ROWS, cnes: CNES_ROWS, places: [], coverage: { status: 'done', city: 'São Paulo', uf: 'SP' } });
      if (body?.action === 'geocode') return json(route, { ok: true, lat: -23.5617698, lng: -46.6553299, label: 'Avenida Paulista, Bela Vista, São Paulo - SP', precision: 'cep', provider: 'osm' });
      return json(route, { ok: true, provider: 'osm' });
    }
    const rest = path.replace('/rest/v1/', '');
    if (req.method() === 'POST' && !rest.startsWith('rpc/')) return route.fulfill({ status: 201, body: '', headers: CORS });
    switch (rest) {
      case 'rpc/imported_cities': return json(route, CITIES);
      case 'rpc/nearby_establishments': return json(route, (body?.p_offset ? [] : CNES_ROWS).map((r) => ({ ...r, total: CNES_ROWS.length })));
      case 'rpc/establishment_points': return json(route, POINTS);
      case 'rpc/nearby_clinics': return json(route, PARTNER_ROWS);
      case 'rpc/request_status': return json(route, (body?.p_ids ?? []).filter((id) => LIVE[id]).map((id) => ({ id, ...LIVE[id] })));
      case 'rpc/tele_doctors_online': return json(route, []);
      case 'rpc/cnes_last_update': return json(route, '2026-10-30');
      case 'rpc/track': return json(route, true);
      case 'rpc/place_ratings': return json(route, (body?.p_keys ?? []).filter((k) => RATINGS[k]).map((k) => ({ place_key: k, ...RATINGS[k] })));
      case 'rpc/place_reviews': return json(route, (REVIEWS[body?.p_key] ?? []).slice(0, body?.p_limit ?? 10));
      case 'rpc/clinics_with_schedule': return json(route, (body?.p_ids ?? []).filter((id) => id === PARTNER_ID).map((id) => ({ clinic_id: id })));
      case 'rpc/available_slots': return json(route, SLOTS.map((s) => ({ slot_start: s })));
      // Horário direto (iMed Agenda 5.1): a agenda nova do parceiro (venda online ligada, modalidade nativa).
      case 'rpc/agenda_public_info': return json(route, body?.p_clinic === PARTNER_ID ? AGENDA_INFO : { status: 'not_found' });
      case 'rpc/agenda_slots': return json(route, body?.p_clinic === PARTNER_ID ? SLOTS.map((s) => ({ slot_start: s, slot_end: new Date(Date.parse(s) + 1800000).toISOString() })) : []);
      case 'rpc/agenda_next_free': return json(route, (body?.p_clinics ?? []).filter((id) => id === PARTNER_ID).map((id) => ({ clinic_id: id, procedure_id: AGENDA_INFO.procedures[0].id, exam_code: 'rm', slot_start: SLOTS[0], slot_end: new Date(Date.parse(SLOTS[0]) + 1800000).toISOString(), timezone: 'America/Sao_Paulo', agenda_mode: 'nativa' })));
      // celular terminado em 0000: o horário acabou de ser pego (slot_taken); os outros confirmam
      case 'rpc/agenda_book': return json(route, String(body?.p_patient?.phone ?? '').endsWith('0000')
        ? { status: 'slot_taken', seq: 1, alternatives: SLOTS.slice(1, 3) }
        : { status: 'ok', id: body?.p_id, request_status: 'confirmed', slot_start: body?.p_items?.[0]?.starts_at, slot_end: new Date(Date.parse(body?.p_items?.[0]?.starts_at) + 1800000).toISOString() });
      case 'rpc/city_establishments': {
        const all = CITY_ROWS.filter((e) => !body?.p_kind || e.kind === body.p_kind);
        return json(route, all.slice(body?.p_offset ?? 0, (body?.p_offset ?? 0) + (body?.p_limit ?? 50)).map((e) => ({ ...e, total: all.length })));
      }
      case 'rpc/is_imed_admin': return json(route, admin);
      case 'rpc/admin_stats': return admin ? json(route, STATS) : json(route, { code: '42501', message: 'forbidden' }, 403);
      case 'rpc/send_contact': return json(route, 'IMED-20261030-AB2C');
      case 'clinic_members': return json(route, member && logged ? [{ clinic_id: C1, role: 'owner' }] : []);
      case 'rpc/agenda_me': return json(route, { status: 'ok', clinics: member && logged ? [{ clinic_id: C1, role: 'owner', permissions: OWNER_PERMS }] : [] });
      case 'rpc/agenda_my_invites': return json(route, { status: 'ok', invites: [] });
      case 'rpc/agenda_config': return json(route, rapida ? AG_RAPIDA : AG_CFG);
      case 'rpc/agenda_team': return json(route, { status: 'ok', members: [{ user_id: USER_ID, email: 'equipe@imed.com.br', role: 'owner', created_at: '2026-11-01T12:00:00Z', me: true },
        { user_id: 'uuuuuuuu-0000-4000-8000-0000000000a2', email: 'recepcao@exemplo.test', role: 'reception', created_at: '2026-11-01T12:00:00Z', me: false }],
        invites: [{ id: 'invinvin-0000-4000-8000-000000000001', email: 'convite@exemplo.test', role: 'professional', created_at: '2026-11-01T12:00:00Z', expires_at: '2026-11-08T12:00:00Z' }] });
      case 'clinics': return json(route, applyFilters([CLINIC, PARTNER_CLINIC], q));
      case 'clinic_exams': return json(route, applyFilters(CLINIC_EXAMS, q));
      case 'establishments': return json(route, applyFilters(ESTABLISHMENTS, q));
      case 'municipalities': return json(route, applyFilters(MUNICIPALITIES, q));
      case 'appointment_requests': return json(route, logged ? applyFilters(REQUESTS, q) : []);
      case 'establishment_claims': return json(route, logged ? applyFilters(CLAIMS, q) : []);
      case 'claim_checks': return json(route, []);
      case 'contact_messages': return json(route, admin ? applyFilters(MESSAGES, q) : []);
      case 'place_reports': return json(route, admin ? applyFilters(REPORTS, q) : []);
      case 'clinic_schedules': return json(route, applyFilters(SCHEDULES, q));
      case 'clinic_blocks': return json(route, applyFilters(BLOCKS, q));
      default: {
        const ag = rest.startsWith('rpc/agenda_') ? agendaRpc(rest.slice(4), body || {}) : undefined;
        if (ag !== undefined) return json(route, ag);
        if (rest.startsWith('rpc/')) return json(route, 'ok');
        return json(route, []);
      }
    }
  });
  return log;
}

// mobile: celular de 390 px com toque. motion: 'reduce' liga o "reduzir movimento" do aparelho.
// session: entra na conta (equipe do IMED); admin/member: o que essa conta é no banco. appts: pedidos do aparelho.
// geo: localização permitida pelo Playwright (false: o Chromium recusa sem perguntar). geoSim: no lugar dela, a
// permissão e a localização simuladas (tests/geo-simulado.mjs), para a página inicial perguntar ({estado:'prompt'}),
// ficar bloqueada ({estado:'denied'}) ou já ter a permissão ({estado:'granted'}), sempre no mesmo ponto.
// relogio: o relógio do navegador parado em T0 (o "hoje" do banco simulado da agenda).
async function newPage(browser, { mobile = false, motion = 'no-preference', session = false, admin = false, member = false, rapida = false, appts = APPTS, geo = true, geoSim = null, lgpd = false, escuro = false, relogio = false } = {}) {
  const context = await browser.newContext({
    ...(escuro ? { colorScheme: 'dark' } : {}), // escuro: aparelho no tema escuro (o Automático do site segue)
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block', reducedMotion: motion, bypassCSP: true, acceptDownloads: true,
    ...(geo && !geoSim ? { geolocation: { latitude: -23.561234, longitude: -46.656789, accuracy: 30 }, permissions: ['geolocation'] } : {}),
  });
  if (geoSim) await simularGeo(context, { pos: { lat: -23.561234, lng: -46.656789 }, ...geoSim });
  if (relogio) await context.clock.setFixedTime(new Date(T0));
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await simularMapa(context); // ladrilhos do mapa 3D do topo (OpenFreeMap), simulados
  await context.route(/overpass/, (r) => json(r, { elements: [] }));
  await context.addInitScript(([s, list, aviso]) => {
    try {
      if (!aviso) localStorage.setItem('imed_lgpd', '1');
      if (sessionStorage.getItem('__a11y')) return;
      sessionStorage.setItem('__a11y', '1');
      if (s) localStorage.setItem('imed_session', JSON.stringify(s));
      if (list) localStorage.setItem('imed_appts', JSON.stringify(list));
    } catch { /* sem armazenamento */ }
  }, [session ? { access_token: 'tok-a11y', refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: USER_ID, email: 'equipe@imed.com.br' } } : null, appts, lgpd]);
  const log = await mockSupabase(context, { admin, member, rapida });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, log, errors };
}

/* ======================= páginas ======================= */
// open: o que fazer depois de abrir (esperar os dados, abrir a ficha, trocar de aba...).
const waitIdle = (page) => page.waitForLoadState('networkidle').catch(() => {});
// Página inicial: o mapa de clínicas reais só carrega quando chega perto da tela (rola pelo próprio navegador:
// com o 3D girando, o Playwright esperaria a página "parar" para rolar).
async function openHome(page) {
  await page.evaluate(() => document.querySelector('#reais').scrollIntoView());
  await page.waitForSelector('#realList li b');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
}
const PAINEL_TABS = ['pedidos', 'agenda', 'config', 'equipe', 'dados', 'exames', 'cadastros', 'concierge', 'mensagens', 'avisos', 'visitas'];
// Agenda (4.2 e 4.3): abre a aba e espera a visão; view: Hoje, Dia, Semana, Mês, Resumo ou Bloqueios.
const AG_MAIN = '#agMain .ag-lista, #agMain .ag-grade, #agMain .ag-vazio, #agMain .ag-mes, #agMain .ag-mlista, #agMain .ag-blsec, #agMain .ag-rssec, #agMain .ag-rsctl + .cl-note';
async function openAgenda(p, view = 'hoje') {
  await p.waitForSelector('#tab-agenda');
  await p.click('#tab-agenda');
  await p.waitForSelector(AG_MAIN);
  if (view !== 'hoje') {
    await p.click(`[data-view="${view}"]`);
    await p.waitForFunction((v) => document.querySelector(`[data-view="${v}"]`)?.getAttribute('aria-pressed') === 'true', view);
  }
  await p.waitForFunction(() => !document.querySelector('#agMain[aria-busy="true"]'));
  await p.waitForSelector(AG_MAIN);
}
const PAGES = [
  { name: 'Início', url: 'index.html', open: openHome },
  { name: 'Início (modo leve)', url: 'index.html', motion: 'reduce', open: async (p) => { await p.waitForSelector('#heroLite li a'); await openHome(p); } },
  { name: 'Início · Meus pedidos', url: 'index.html#agenda', open: async (p) => { await p.waitForSelector('.appt'); } },
  { name: 'Início · aviso de privacidade', url: 'index.html', lgpd: true, motion: 'reduce', open: async (p) => { await p.waitForSelector('.lgpd button'); } },
  { name: 'Início · janela da cidade', url: 'index.html', motion: 'reduce', open: async (p) => { await p.evaluate(() => document.querySelector('#reais').scrollIntoView()); await p.waitForSelector('#realList li b'); await p.click('#cityBtn'); await p.waitForSelector('.ov.open #cityQ'); await p.waitForSelector('#cityIdle .cid-op'); await waitIdle(p); } },
  // Pedido de localização aberto e sem resposta: o aviso fixo no alto (já com o "Não apareceu a pergunta?", aos 8 s)
  // e o cartão "Aguardando sua permissão…". O foco pelo Tab não pode ficar atrás do aviso (scroll-padding-top).
  { name: 'Início · aguardando a permissão', url: 'index.html', motion: 'reduce', geoSim: { estado: 'prompt', resposta: 'nunca' }, open: async (p) => { await p.waitForSelector('#reais[data-estado="aguardando"]'); await p.waitForSelector('#geoAviso:not([hidden])'); await p.waitForSelector('#geoAvisoMais:not([hidden])', { timeout: 30000 }); await p.waitForSelector('#heroLite li a'); await waitIdle(p); } },
  { name: 'Início · localização bloqueada', url: 'index.html', motion: 'reduce', geoSim: { estado: 'denied' }, open: async (p) => { await p.waitForSelector('#reais[data-estado="negada"]'); await p.waitForSelector('#pvEstado .pv-at'); await p.click('#pvEstado [data-bt="ajuda"]'); await p.waitForSelector('#pvEAjuda:not([hidden])'); await waitIdle(p); } },
  // Navegador sem localização: o cartão é uma frase só (sem título) e os atalhos vêm com h3 (sem pular do h2 para o h4).
  { name: 'Início · sem suporte', url: 'index.html', motion: 'reduce', geoSim: { suporte: false }, open: async (p) => { await p.waitForSelector('#reais[data-estado="sem-suporte"]'); await p.waitForSelector('#pvEstado .pv-at'); await waitIdle(p); } },
  // Mapa da tela: no computador, ao lado da lista; no celular, em tela cheia (janela aberta pelo "Ver no mapa").
  { name: 'Início · mapa', url: 'index.html', motion: 'reduce', geoSim: { estado: 'granted' }, open: async (p) => { await p.evaluate(() => document.querySelector('#reais').scrollIntoView()); await p.waitForSelector('#realList li b'); if (await p.isVisible('#mapOpen')) { await p.click('#mapOpen'); await p.waitForSelector('#pvMapa.cheio'); } await p.waitForSelector('#realMap .leaflet-marker-icon'); await waitIdle(p); } },
  { name: 'Perto de mim', url: 'perto.html?usar=localizacao', open: async (p) => { await p.waitForSelector('.pc'); await p.waitForFunction(() => !document.querySelector('.pt-more')); } },
  { name: 'Perto · ficha', url: 'perto.html?usar=localizacao', open: async (p) => { await p.waitForSelector('.pc'); await p.click('.pc[data-id] >> nth=0'); await p.waitForSelector('.sh-ov.open'); await p.waitForTimeout(300); } },
  { name: 'Perto · pedido', url: 'perto.html?usar=localizacao', open: async (p) => { await p.waitForSelector('.pc:not(.imed)'); await p.click('.pc:not(.imed) >> nth=0'); await p.waitForSelector('.sh-ov.open [data-book]'); await p.click('.sh-ov.open [data-book]'); await p.waitForSelector('#bookForm'); await p.waitForTimeout(300); } },
  { name: 'Local (cadastro oficial)', url: 'local.html?cnes=2077485', open: async (p) => { await p.waitForSelector('#app[aria-busy="false"] h1'); await waitIdle(p); } },
  { name: 'Local (parceiro com agenda)', url: `local.html?id=${PARTNER_ID}`, open: async (p) => { await p.waitForSelector('.sl-day'); await waitIdle(p); } },
  { name: 'Local · pedido', url: 'local.html?cnes=2077485', open: async (p) => { await p.click('#agendar [data-act="pedido"]'); await p.waitForSelector('#bookForm'); await p.click('#bkBtn'); await p.waitForSelector('[data-f="exam"].bad'); } },
  { name: 'Local · horário escolhido', url: `local.html?id=${PARTNER_ID}`, open: async (p) => { await p.click('.sl-t >> nth=0'); await p.waitForSelector('#bookForm'); await waitIdle(p); } },
  { name: 'Local · horário confirmado', url: `local.html?id=${PARTNER_ID}`, open: async (p) => { await p.click('.sl-t >> nth=0'); await p.fill('#bkName', 'Ana Teste'); await p.fill('#bkPhone', '11987654321'); await p.check('input[name="consent"]'); await p.click('#bkBtn'); await p.waitForSelector('.lc-ok'); await waitIdle(p); } },
  { name: 'Local · horário ocupado', url: `local.html?id=${PARTNER_ID}`, open: async (p) => { await p.click('.sl-t >> nth=0'); await p.fill('#bkName', 'Ana Teste'); await p.fill('#bkPhone', '11987650000'); await p.check('input[name="consent"]'); await p.click('#bkBtn'); await p.waitForSelector('#slNotice'); await p.waitForSelector('.sl-t'); await waitIdle(p); } },
  { name: 'Local · avisar erro', url: 'local.html?cnes=2077485', open: async (p) => { await p.click('[data-act="report"]'); await p.waitForSelector('#rpForm:not([hidden])'); } },
  { name: 'Minha conta', url: 'conta.html', open: async (p) => { await p.waitForSelector('.ct-order'); await waitIdle(p); } },
  { name: 'Minha conta (com login)', url: 'conta.html', session: true, open: async (p) => { await p.waitForSelector('#signedIn:not([hidden])'); await p.waitForSelector('.ct-order'); await waitIdle(p); } },
  { name: 'Minha conta · avaliar', url: `conta.html#pedido-${ID2}`, open: async (p) => { await p.waitForSelector(`#rv-${ID2}:not([hidden])`); await waitIdle(p); } },
  { name: 'Minha conta · entrar com senha', url: 'conta.html', open: async (p) => { await p.waitForSelector('.ct-order'); await p.click('.es-abrir'); await p.waitForSelector('#senhaCampos:not([hidden])'); await waitIdle(p); } },
  { name: 'Definir senha', url: 'definir-senha.html', open: async (p) => { await p.waitForSelector('#semSessao:not([hidden])'); } },
  { name: 'Definir senha (com login)', url: 'definir-senha.html', session: true, open: async (p) => { await p.waitForSelector('#comSessao:not([hidden])'); } },
  { name: 'Minha conta (situações novas)', url: 'conta.html', appts: APPTS_NOVAS, open: async (p) => { await p.waitForFunction(() => /Remarcação solicitada/.test(document.body.textContent)); await waitIdle(p); } },
  { name: 'Área da clínica', url: 'painel.html', open: async (p) => { await p.waitForSelector('#authBox input'); } },
  ...PAINEL_TABS.map((tab) => ({
    name: `Área da clínica · ${tab}`, url: 'painel.html', session: true, admin: true, member: true,
    open: async (p) => { await p.waitForSelector(`#tab-${tab}`); await p.click(`#tab-${tab}`); await waitIdle(p); await p.waitForTimeout(250); },
  })),
  {
    name: 'Área da clínica · agenda (configuração rápida)', url: 'painel.html', session: true, admin: true, member: true, rapida: true,
    open: async (p) => { await p.waitForSelector('#tab-config'); await p.click('#tab-config'); await p.waitForSelector('#qcForm'); await p.click('#qcSave'); await p.waitForSelector('#qcMsg .cl-note'); await waitIdle(p); },
  },
  {
    name: 'Área da clínica · agenda (formulários abertos)', url: 'painel.html', session: true, admin: true, member: true,
    open: async (p) => { await p.waitForSelector('#tab-config'); await p.click('#tab-config'); await p.waitForSelector('#resNew'); await p.click('#resNew'); await p.click('#procNew'); await p.click('[data-hadd="2-open"]'); await waitIdle(p); },
  },
  // Agenda da recepção (4.2): cada visão, o detalhe, o novo agendamento com erros e o bloqueio com afetados.
  ...[['dia', 'dia'], ['semana', 'semana'], ['mês', 'mes'], ['bloqueios', 'bloqueios']].map(([n, v]) => ({
    name: `Área da clínica · agenda (${n})`, url: 'painel.html', session: true, admin: true, member: true,
    open: async (p) => { await openAgenda(p, v); await waitIdle(p); },
  })),
  // Fase 4.3: o resumo gerencial (operacional e financeiro) e o período escolhido à mão; "Precisa de atenção" já aparece
  // nas visões acima (há um conflito aberto e pedidos sem resposta nos dados).
  {
    name: 'Área da clínica · agenda (resumo)', url: 'painel.html', session: true, admin: true, member: true,
    open: async (p) => { await openAgenda(p, 'resumo'); await p.waitForSelector('#agMain .ag-rssec'); await p.waitForSelector('#agFinT'); await waitIdle(p); },
  },
  {
    name: 'Área da clínica · agenda (resumo, outro período)', url: 'painel.html', session: true, admin: true, member: true,
    open: async (p) => { await openAgenda(p, 'resumo'); await p.waitForSelector('#agMain .ag-rssec'); await p.selectOption('#rsPeriodo', 'custom'); await p.waitForSelector('#rsDe'); await p.fill('#rsDe', spDay(3)); await p.fill('#rsAte', spDay(1)); await p.click('[data-act="rs-ver"]'); await p.waitForFunction(() => /não pode vir antes/.test(document.querySelector('#agMain').textContent)); await waitIdle(p); },
  },
  {
    name: 'Área da clínica · agenda (detalhe)', url: 'painel.html', session: true, admin: true, member: true,
    open: async (p) => { await openAgenda(p); await p.click(`[data-act="abrir"][data-item="${AG_ITEMS[2].id}"]`); await p.waitForSelector('#agDet:not([hidden]) #agDetT'); await p.waitForFunction(() => /Souza/.test(document.querySelector('#agDet').textContent)); await waitIdle(p); },
  },
  {
    name: 'Área da clínica · agenda (novo agendamento com erros)', url: 'painel.html', session: true, admin: true, member: true,
    open: async (p) => { await openAgenda(p); await p.click('#agNovo'); await p.waitForSelector('#bkForm'); await p.click('#bkOk'); await p.waitForSelector('#bkForm [aria-invalid="true"]'); await waitIdle(p); },
  },
  {
    name: 'Área da clínica · agenda (bloquear com afetados)', url: 'painel.html', session: true, admin: true, member: true,
    open: async (p) => {
      await openAgenda(p); await p.click('#agBloquear'); await p.waitForSelector('#blForm');
      await p.selectOption('#blAlvo', AG_R1); await p.check('input[name="blModo"][value="part"]'); await p.fill('#blFrom', spDay(1)); await p.fill('#blStart', '08:00'); await p.fill('#blEnd', '12:00');
      await p.click('#blOk'); await p.waitForSelector('#blAfet .ag-afet'); await waitIdle(p);
    },
  },
  { name: 'Reivindicar', url: 'reivindicar.html?cnes=2077485', open: async (p) => { await p.waitForSelector('.cl-place h3'); } },
  { name: 'Reivindicar (com login)', url: 'reivindicar.html?cnes=2077485', session: true, open: async (p) => { await p.waitForSelector('#s3:not([hidden])'); await waitIdle(p); } },
  { name: 'Quem somos', url: 'sobre.html' },
  { name: 'Termos', url: 'termos.html' },
  { name: 'Privacidade', url: 'privacidade.html' },
  { name: 'Para clínicas', url: 'parceiros.html', open: async (p) => { await p.waitForSelector('#numeros:not([hidden])'); } },
  { name: 'Como funciona', url: 'como-funciona.html' },
  { name: 'Acessibilidade', url: 'acessibilidade.html' },
  { name: 'Fale com o IMED', url: 'contato.html' },
  { name: 'Para médicos', url: 'para-medicos.html' },
  { name: 'Teleconsulta', url: 'teleconsulta.html', open: async (p) => { await p.waitForSelector('#tlTitle'); await p.waitForFunction(() => !document.querySelector('.tl-load:not([hidden])')); await waitIdle(p); } },
  { name: 'Termo da teleconsulta', url: 'termo-teleconsulta.html' },
  { name: 'Área do médico', url: 'medico.html', open: async (p) => { await p.waitForFunction(() => !document.querySelector('#authBox .tl-load')); await waitIdle(p); } },
  { name: 'Conferir documento', url: 'documento.html', open: async (p) => { await p.waitForSelector('#dcForm'); await waitIdle(p); } },
  { name: 'Página 404', url: `${PASTA}nao-existe` },
  { name: 'Guias de exames', url: 'exames/' },
  { name: 'Guia: Raio-X', url: 'exames/raio-x.html' },
  { name: 'Cidades', url: 'cidades/' },
  { name: 'Cidade: São Paulo', url: 'cidades/sp/sao-paulo/', open: async (p) => { await waitIdle(p); } },
  { name: 'Tipo: Clínicas em São Paulo', url: 'cidades/sp/sao-paulo/clinicas.html', open: async (p) => { await waitIdle(p); } },
];
// Tema escuro (grupo "conta"): as mesmas páginas com o aparelho no escuro (Automático do site segue o aparelho).
for (const n of ['Minha conta (com login)', 'Minha conta · avaliar', 'Minha conta (situações novas)', 'Área da clínica', 'Área da clínica · pedidos', 'Área da clínica · agenda', 'Área da clínica · config', 'Área da clínica · agenda (configuração rápida)',
  'Área da clínica · agenda (dia)', 'Área da clínica · agenda (semana)', 'Área da clínica · agenda (mês)', 'Área da clínica · agenda (bloqueios)', 'Área da clínica · agenda (detalhe)', 'Área da clínica · agenda (novo agendamento com erros)',
  'Área da clínica · agenda (bloquear com afetados)', 'Área da clínica · equipe', 'Área da clínica · visitas', 'Reivindicar', 'Quem somos', 'Termos', 'Privacidade', 'Para clínicas', 'Como funciona', 'Acessibilidade', 'Fale com o IMED', 'Para médicos']) {
  PAGES.push({ ...PAGES.find((d) => d.name === n), name: `${n} (escuro)`, escuro: true });
}

// Tema escuro (grupo "tele"): teleconsulta, termo, área do médico e conferir documento, com o aparelho no escuro.
for (const n of ['Teleconsulta', 'Termo da teleconsulta', 'Área do médico', 'Conferir documento']) {
  PAGES.push({ ...PAGES.find((d) => d.name === n), name: `${n} (escuro)`, escuro: true });
}

// Tema escuro (grupo "busca"): início, perto, local, guias, cidades e 404, com o aparelho no escuro.
for (const n of ['Início', 'Início · janela da cidade', 'Início · localização bloqueada', 'Início · mapa', 'Perto de mim', 'Perto · ficha', 'Perto · pedido', 'Local (cadastro oficial)', 'Local (parceiro com agenda)', 'Local · pedido', 'Local · avisar erro', 'Página 404', 'Guias de exames', 'Guia: Raio-X', 'Cidades', 'Cidade: São Paulo']) {
  PAGES.push({ ...PAGES.find((d) => d.name === n), name: `${n} (escuro)`, escuro: true });
}

/* ======================= checagens ======================= */
async function runAxe(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (tags) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] });
    const pick = (list) => list.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 220), why: (n.failureSummary || n.any?.[0]?.message || '').replace(/\s+/g, ' ').trim().slice(0, 300) })) }));
    return { violations: pick(r.violations), incomplete: pick(r.incomplete) };
  }, AXE_TAGS);
}

// Funções de cor que rodam dentro da página (window.__a11y): contraste da WCAG e a cor do fundo atrás de um
// elemento, somando cor de fundo, degradês (linear: todas as cores, o pior caso; brilho radial: a cor que ele
// tem em cima do elemento) e o que está embaixo (os pais). bgAt devolve só os extremos (o mais claro e o mais
// escuro) ou null quando há foto de fundo (não dá para medir).
const COLOR_HELPERS = String.raw`(() => {
  if (window.__a11y) return;
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [r, g, b, a]; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const mix = (top, under) => top.slice(0, 3).map((c, i) => c * (top[3] ?? 1) + under[i] * (1 - (top[3] ?? 1)));
  const layersOf = (img) => {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of img) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out.reverse();
  };
  const stopsOf = (layer) => {
    const list = [...layer.matchAll(/(rgba?\([^)]+\))\s*(-?[\d.]+%)?/g)].map((m) => ({ c: parse(m[1]), p: m[2] ? parseFloat(m[2]) / 100 : null }));
    if (list.length) { if (list[0].p == null) list[0].p = 0; if (list.at(-1).p == null) list.at(-1).p = 1; }
    for (let i = 1; i < list.length - 1; i += 1) if (list[i].p == null) list[i].p = (list[i - 1].p + list[i + 1].p) / 2;
    return list;
  };
  const radialAt = (layer, box, rect) => {
    const m = layer.match(/^radial-gradient\(\s*([\d.]+)px\s+([\d.]+)px\s+at\s+(-?[\d.]+)%\s+(-?[\d.]+)%/);
    if (!m) return null;
    const [rx, ry, px, py] = m.slice(1).map(Number);
    const cx = box.left + (box.width * px) / 100, cy = box.top + (box.height * py) / 100;
    const x = Math.min(Math.max(cx, rect.left), rect.right), y = Math.min(Math.max(cy, rect.top), rect.bottom);
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
    const st = stopsOf(layer);
    if (!st.length) return null;
    if (d <= st[0].p) return st[0].c;
    for (let i = 1; i < st.length; i += 1) {
      if (d <= st[i].p) {
        const t = (d - st[i - 1].p) / ((st[i].p - st[i - 1].p) || 1);
        const a = st[i - 1].c, b = st[i].c;
        const base = (a[3] ?? 1) >= (b[3] ?? 1) ? a : b; // "transparent" do CSS é preto transparente: não escurece
        return [...base.slice(0, 3), (a[3] ?? 1) + ((b[3] ?? 1) - (a[3] ?? 1)) * t];
      }
    }
    return [0, 0, 0, 0];
  };
  const bgAt = (node, rect) => {
    if (!node || node === document.documentElement) return [[255, 255, 255]];
    const cs = getComputedStyle(node);
    if (/url\(/.test(cs.backgroundImage)) return null;
    const own = parse(cs.backgroundColor);
    let colors;
    if (own && own[3] > 0.95) colors = [own.slice(0, 3)];
    else {
      colors = bgAt(node.parentElement, rect);
      if (!colors) return null;
      if (own && own[3] > 0) colors = colors.map((b) => mix(own, b));
    }
    if (/gradient/.test(cs.backgroundImage)) {
      const box = node.getBoundingClientRect();
      for (const layer of layersOf(cs.backgroundImage)) {
        if (/^radial-gradient/.test(layer)) {
          const c = radialAt(layer, box, rect);
          if (c) { colors = colors.map((b) => mix(c, b)); continue; }
        }
        const stops = stopsOf(layer).map((x) => x.c);
        if (!stops.length) continue;
        colors = colors.flatMap((b) => stops.map((st) => mix(st, b)));
      }
    }
    colors.sort((a, b) => lum(a) - lum(b));
    return [colors[0], colors[colors.length - 1]];
  };
  // Pior contraste de uma cor (com transparência) sobre as cores possíveis do fundo.
  const worst = (fg, bgs) => Math.min(...bgs.map((bg) => ratio((fg[3] ?? 1) < 1 ? mix(fg, bg) : fg, bg)));
  const label = (el) => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' "' + (el.getAttribute('aria-label') || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 40) + '"');
  window.__a11y = { parse, lum, ratio, mix, bgAt, worst, label };
})()`;

// Texto sobre fundo em degradê (o axe não consegue medir e deixa "para revisar"): o contraste do texto com
// o fundo precisa ser de 4,5:1 (3:1 para letra grande).
async function gradientContrast(page) {
  await page.evaluate(COLOR_HELPERS);
  return page.evaluate(() => {
    const A = window.__a11y;
    const out = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim()) continue;
      const el = t.parentElement;
      if (!el || seen.has(el) || el.closest('[aria-hidden="true"], .sr, .rd-sr, .skip')) continue;
      seen.add(el);
      if (!(el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? true)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      // Só quando há degradê no caminho até o primeiro fundo sólido (o resto o axe já mede).
      let grad = false;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (/gradient/.test(cs.backgroundImage)) { grad = true; break; }
        const bg = A.parse(cs.backgroundColor);
        if (bg && bg[3] > 0.95) break;
      }
      if (!grad) continue;
      const colors = A.bgAt(el, rect);
      if (!colors) continue;
      const cs = getComputedStyle(el);
      const fg = A.parse(cs.color);
      if (!fg || fg[3] < 0.1) continue; // texto transparente (letra com degradê): fora desta conta
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (Number(cs.fontWeight) >= 700 && size >= 18.66);
      const min = A.worst(fg, colors);
      if (min < (large ? 3 : 4.5) - 0.01) out.push(`${A.label(el)} ${min.toFixed(2)}:1`);
    }
    return out;
  });
}

// Alvos de toque (celular): pelo menos 44 x 44 px. Não vale para link no meio de uma frase (exceção da WCAG),
// para os pontos do mapa (a lista ao lado faz o mesmo) e para o que está escondido.
// Caixas de marcar e opções contam junto com o texto (o rótulo também recebe o toque); um botão com ::after
// esticado sobre o cartão conta com o tamanho do cartão.
async function smallTargets(page) {
  return page.evaluate(() => {
    const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=checkbox], [role=radio], [role=switch], [tabindex]:not([tabindex="-1"])';
    const out = [];
    const seen = new Set();
    const vis = (el) => el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? true;
    const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.name || el.id || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    // Link ou botão no meio de uma frase (texto dos dois lados no mesmo bloco): a altura é a da linha.
    const isInline = (el) => {
      if (!['A', 'BUTTON'].includes(el.tagName) || !['inline', 'inline-block'].includes(getComputedStyle(el).display)) return false;
      let b = el.parentElement;
      while (b && getComputedStyle(b).display === 'inline') b = b.parentElement;
      if (!b) return false;
      const own = (el.textContent || '').trim().length;
      return (b.textContent || '').replace(/\s+/g, ' ').trim().length > own + 3;
    };
    for (const el of document.querySelectorAll(SEL)) {
      if (seen.has(el) || el.closest('[aria-hidden="true"], [inert], .leaflet-marker-pane, .leaflet-control-attribution, .skip')) continue;
      seen.add(el);
      if (el.tabIndex < 0 && !el.matches('a[href], button, input, select, textarea, summary')) continue;
      if (!vis(el)) continue;
      let r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right < 0 || r.bottom < -5000) continue;
      if (isInline(el)) continue;
      const af = getComputedStyle(el, '::after');
      if (af.content !== 'none' && af.position === 'absolute' && el.offsetParent) r = el.offsetParent.getBoundingClientRect();
      if (el.matches('input[type=checkbox], input[type=radio]')) {
        const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
        if (lab) { const l = lab.getBoundingClientRect(); r = { width: Math.max(r.width, l.width), height: Math.max(r.height, l.height) }; }
      }
      if (r.width < 43.5 || r.height < 43.5) {
        const cls = (el.className && typeof el.className === 'string') ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
        out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls} "${name(el)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  });
}

// Campos com letra menor que 16 px (o iPhone dá zoom ao tocar).
async function smallInputs(page) {
  return page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
    .filter((el) => !/^(checkbox|radio|hidden|range|button|submit|reset|image|file|color)$/.test(el.type))
    .filter((el) => (el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? true) && el.getBoundingClientRect().width > 0 && !el.closest('[aria-hidden="true"]'))
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
    .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.name ? `[name=${el.name}]` : ''} ${getComputedStyle(el).fontSize}`));
}

// Percorre a página com Tab e confere cada parada: o foco precisa mudar algo visível (contorno, borda, sombra,
// fundo ou sublinhado) com contraste de 3:1 contra o fundo, e não pode ficar atrás do topo/menu fixo nem fora da tela.
// Começa do começo da página (um ponto fixo no início do <body>), e não de onde o foco estava; numa janela aberta
// (ficha, pedido), começa dentro dela. O mesmo campo várias vezes seguidas (as partes de um campo de data: dia, mês,
// ano e o botão do calendário) conta uma parada só, e o percurso só para ao voltar a uma parada anterior ou ao sair da
// página. grade: quantas paradas foram em itens da grade da agenda (o teste exige que o percurso chegue lá).
async function focusWalk(page, max = 250) {
  await page.evaluate(COLOR_HELPERS);
  // Sem transições: a cor do foco é medida logo depois do Tab, no estado final (e não no meio da animação).
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}' });
  await page.evaluate(() => {
    const janela = document.activeElement?.closest?.('[role="dialog"], [aria-modal="true"]');
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
    if (janela) return;
    const ini = document.createElement('div');
    ini.tabIndex = -1; ini.id = 'a11yInicio';
    document.body.prepend(ini);
    ini.focus({ preventScroll: true });
  });
  const snap = String.raw`(el) => {
    const pick = (c) => ({ os: c.outlineStyle, ow: parseFloat(c.outlineWidth) || 0, oc: c.outlineColor, bs: c.boxShadow, bc: c.borderTopColor, bw: parseFloat(c.borderTopWidth) || 0, bg: c.backgroundColor, deco: c.textDecorationLine });
    const p1 = el.parentElement, p2 = p1?.parentElement, sib = el.nextElementSibling;
    const r = el.getBoundingClientRect();
    // Campo escondido de propósito (opção desenhada pelo rótulo ao lado): o contorno dele não aparece.
    const hidden = Number(getComputedStyle(el).opacity) < 0.05 || r.width * r.height <= 4;
    return { hidden, self: pick(getComputedStyle(el)), after: pick(getComputedStyle(el, '::after')), before: pick(getComputedStyle(el, '::before')),
      p1: p1 ? pick(getComputedStyle(p1)) : null, p2: p2 ? pick(getComputedStyle(p2)) : null, sib: sib ? pick(getComputedStyle(sib)) : null };
  }`;
  const stops = [];
  for (let i = 0, voltas = 0; i < max && voltas < max * 3; voltas += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(([i, snapSrc]) => {
      const A = window.__a11y;
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { end: true };
      if (el.dataset.a11yStop) return el.dataset.a11yStop === String(i - 1) ? { same: true } : { again: true };
      el.dataset.a11yStop = String(i);
      const r = el.getBoundingClientRect();
      // eslint-disable-next-line no-eval
      const focused = (0, eval)(snapSrc)(el);
      const bg = A.bgAt(el.parentElement, r);
      // Escondido atrás de algo fixo (topo, menu de baixo, aviso)? Elemento pequeno: nenhuma parte coberta.
      // Elemento grande (um painel inteiro, mais alto que meia tela): pelo menos uma parte à vista.
      let covered = null;
      if (r.width > 0 && r.height > 0) {
        const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
        const ys = [r.top + Math.min(r.height / 2, 10), r.top + r.height / 2, r.bottom - Math.min(r.height / 2, 10)].map((y) => Math.min(Math.max(y, 1), innerHeight - 1));
        const hits = [];
        for (const y of ys) {
          const top = document.elementFromPoint(x, y);
          let fixed = null;
          if (top && !el.contains(top) && !top.contains(el) && !(top.closest('label') && top.closest('label').contains(el)) && !(el.id && top.closest(`label[for="${CSS.escape(el.id)}"]`))) {
            for (let n = top; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') { fixed = n; break; } }
          }
          hits.push(fixed ? `${fixed.tagName.toLowerCase()}${fixed.className && typeof fixed.className === 'string' ? `.${fixed.className.trim().split(/\s+/)[0]}` : ''}` : null);
        }
        const big = r.height > innerHeight / 2;
        if (big ? hits.every(Boolean) : hits.some(Boolean)) covered = hits.find(Boolean);
      }
      const off = r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth;
      return { label: A.label(el), focused, bg, covered, off, w: r.width, h: r.height, grade: !!el.closest('.ag-grade') };
    }, [i, snap]);
    if (info.same) continue;   // outra parte do mesmo campo
    if (info.end || info.again) break;
    stops.push(info);
    i += 1;
  }
  // O mesmo elemento sem foco.
  const plain = await page.evaluate((snapSrc) => {
    document.activeElement?.blur?.();
    // eslint-disable-next-line no-eval
    const f = (0, eval)(snapSrc);
    return Object.fromEntries([...document.querySelectorAll('[data-a11y-stop]')].map((el) => [el.dataset.a11yStop, f(el)]));
  }, snap);
  await page.evaluate(() => { document.querySelectorAll('[data-a11y-stop]').forEach((el) => el.removeAttribute('data-a11y-stop')); document.getElementById('a11yInicio')?.remove(); });
  const problems = [];
  stops.forEach((s, i) => {
    if (s.covered) problems.push(`foco escondido atrás de ${s.covered}: ${s.label}`);
    if (s.off && s.w > 0) problems.push(`foco fora da tela: ${s.label}`);
    if (!(s.w > 0)) return;
    const p = plain[String(i)];
    const res = judgeFocus(s.focused, p, s.bg);
    if (res) problems.push(`${res}: ${s.label}`);
  });
  return { count: stops.length, problems, grade: stops.filter((x) => x.grade).length };
}

// O indicador de foco: contorno (do elemento, do ::after/::before ou da caixa em volta, com :focus-within),
// borda que muda, sombra que muda, fundo que muda ou sublinhado. Basta um deles com contraste de 3:1 contra o
// fundo (WCAG 1.4.11).
function judgeFocus(f, p, bg) {
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [r, g, b, a]; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const mix = (top, under) => top.slice(0, 3).map((c, i) => c * (top[3] ?? 1) + under[i] * (1 - (top[3] ?? 1)));
  const worst = (c) => (bg ? Math.min(...bg.map((b) => ratio((c[3] ?? 1) < 1 ? mix(c, b) : c, b))) : 99);
  const found = [];
  for (const part of ['self', 'after', 'before', 'p1', 'p2', 'sib']) {
    const a = f[part], b = p?.[part] ?? {};
    if (!a) continue;
    if (f.hidden && (part === 'self' || part === 'after' || part === 'before')) continue;
    const box = part === 'p1' || part === 'p2' || part === 'sib'; // a caixa em volta (ou o rótulo ao lado) só conta se mudar com o foco
    if (a.os === 'auto' && a.ow > 0 && (!box || b.os !== 'auto')) found.push(99); // anel padrão do navegador (duas cores)
    else if (a.os !== 'none' && a.ow >= 1 && (!box || a.os !== b.os || a.oc !== b.oc)) { const c = parse(a.oc); if (c && c[3] > 0) found.push(worst(c)); }
    if (a.bs !== 'none' && a.bs !== b.bs) { for (const m of String(a.bs).matchAll(/rgba?\([^)]+\)/g)) { const c = parse(m[0]); if (c && c[3] > 0) found.push(worst(c)); } }
    if (box && a.bw >= 1 && a.bc !== b.bc) { const c = parse(a.bc); if (c && c[3] > 0) found.push(worst(c)); }
  }
  const a = f.self, b = p?.self ?? {};
  if (!f.hidden) {
    if (a.bw >= 1 && a.bc !== b.bc) { const c = parse(a.bc); if (c && c[3] > 0) found.push(worst(c)); }
    if (a.bg !== b.bg) { const c = parse(a.bg), o = parse(b.bg); if (c && o && bg) found.push(ratio(mix(c, bg[0]), mix(o, bg[0]))); }
    if (a.deco !== b.deco && /underline/.test(a.deco)) found.push(99);
  }
  if (!found.length) return 'sem foco visível';
  const best = Math.max(...found);
  return best >= 2.99 ? null : `foco pouco visível (${best.toFixed(2)}:1)`;
}

/* ======================= execução ======================= */
const results = [];
// Tempo máximo de cada cenário (E2E_CENARIO_S segundos, padrão 150): um cenário travado falha com o nome dele,
// em vez de segurar o arquivo inteiro até o limite do CI.
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try { await Promise.race([comChaves(fn), limite(name)]); results.push(['ok', name]); console.log(`ok - ${name}`); }
  catch (err) { results.push(['FALHOU', name]); console.log(`FALHOU - ${name}\n  ${err.stack?.split('\n').slice(0, 6).join('\n  ')}`); }
}

const browser = vigiarChaves(await chromium.launch());
const audit = []; // { page, device, axe: [...], targets: [...], inputs: [...], focus: {...}, lang }

async function auditPage(def, mobile) {
  const { context, page, errors } = await newPage(browser, { mobile, motion: def.motion, session: def.session, admin: def.admin, member: def.member, rapida: def.rapida, lgpd: def.lgpd, geoSim: def.geoSim, escuro: def.escuro, relogio: /^painel\.html/.test(def.url), ...(def.appts ? { appts: def.appts } : {}) });
  try {
    await page.goto(BASE + def.url);
    if (def.open) await def.open(page); else await waitIdle(page);
    // Fim das transições (o topo muda de cor ao rolar, por exemplo): mede o estado final, como a pessoa vê.
    await page.waitForTimeout(300);
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming?.().iterations === Infinity), null, { timeout: 4000 }).catch(() => {});
    const row = { page: def.name, device: mobile ? 'celular' : 'computador', errors };
    row.lang = await page.evaluate(() => document.documentElement.lang);
    const ax = AXE ? await runAxe(page) : null;
    row.axe = ax?.violations ?? null;
    row.incomplete = ax?.incomplete ?? null;
    row.gradient = await gradientContrast(page);
    row.targets = mobile ? await smallTargets(page) : [];
    // Celular: nada de rolar para o lado (a página inteira cabe nos 390 px).
    row.overflow = mobile ? await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) : 0;
    row.inputs = mobile ? await smallInputs(page) : [];
    // A ficha e o pedido são janelas: o foco fica preso nelas, então o percurso com Tab é o de dentro da janela.
    row.focus = await focusWalk(page);
    audit.push(row);
  } catch (err) {
    if (process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, `erro-${def.name.replace(/\W+/g, '-')}-${mobile ? 'celular' : 'pc'}.png`), fullPage: true }).catch(() => {});
    throw err;
  } finally {
    await context.close();
  }
}

// Duas páginas por vez (A11Y_PAR muda isso); a ordem do relatório segue a lista.
const jobs = PAGES.filter((def) => !ONLY || ONLY.test(def.name) || ONLY.test('auditoria')).flatMap((def) => [[def, false], [def, true]]);
const PAR = Math.max(1, Number(process.env.A11Y_PAR) || 2);
let next = 0;
await Promise.all(Array.from({ length: PAR }, async () => {
  while (next < jobs.length) {
    const [def, mobile] = jobs[next++];
    try { await auditPage(def, mobile); }
    catch (err) { audit.push({ page: def.name, device: mobile ? 'celular' : 'computador', fail: err.message.split('\n')[0] }); }
  }
}));
const order = (r) => PAGES.findIndex((d) => d.name === r.page) * 2 + (r.device === 'celular' ? 1 : 0);
audit.sort((a, b) => order(a) - order(b));

// Resumo por página (para o relatório): violações do axe por gravidade e problemas das checagens próprias.
const count = (row, impacts) => (row.axe ?? []).filter((v) => impacts.includes(v.impact)).reduce((s, v) => s + v.nodes.length, 0);
console.log('\npágina | aparelho | axe graves | axe outros | degradê | alvos <44 | campos <16 | rolagem lateral | foco');
for (const r of audit) {
  if (r.fail) { console.log(`${r.page} | ${r.device} | ERRO: ${r.fail}`); continue; }
  console.log(`${r.page} | ${r.device} | ${AXE ? count(r, ['serious', 'critical']) : '-'} | ${AXE ? count(r, ['moderate', 'minor']) : '-'} | ${r.gradient.length} | ${r.targets.length} | ${r.inputs.length} | ${Math.max(0, r.overflow)} | ${r.focus.problems.length} (${r.focus.count} paradas)`);
}
if (process.env.A11Y_JSON) await writeFile(process.env.A11Y_JSON, JSON.stringify(audit, null, 1));

await scenario('auditoria: todas as páginas abriram sem erro', async () => {
  const bad = audit.filter((r) => r.fail || r.errors?.length).map((r) => `${r.page} (${r.device}): ${r.fail || r.errors.join(' | ')}`);
  assert.deepEqual(bad, []);
});

await scenario('auditoria: idioma pt-BR em todas as páginas', async () => {
  const bad = audit.filter((r) => !r.fail && r.lang !== 'pt-BR').map((r) => `${r.page}: lang="${r.lang}"`);
  assert.deepEqual(bad, []);
});

if (AXE) {
  await scenario('auditoria: axe sem violação grave ou crítica (computador e celular)', async () => {
    const bad = [];
    for (const r of audit.filter((x) => !x.fail)) {
      for (const v of r.axe.filter((x) => GRAVE.has(x.impact))) bad.push(`${r.page} (${r.device}) ${v.impact} ${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target).join(', ')}`);
    }
    assert.deepEqual(bad, []);
  });
} else {
  console.log('pulado - auditoria: axe sem violação grave ou crítica (axe-core não encontrado)');
}

await scenario('auditoria: texto sobre degradê (botões) com contraste de 4,5:1', async () => {
  const bad = audit.filter((r) => !r.fail && r.gradient.length).map((r) => `${r.page} (${r.device}): ${r.gradient.join('; ')}`);
  assert.deepEqual(bad, []);
});

await scenario('auditoria: celular com alvos de toque de 44 px, campos com letra de 16 px e sem rolagem lateral', async () => {
  const bad = audit.filter((r) => !r.fail && (r.targets.length || r.inputs.length || r.overflow > 0))
    .map((r) => `${r.page}: ${[...r.targets, ...r.inputs, ...(r.overflow > 0 ? [`rolagem lateral de ${r.overflow}px`] : [])].join('; ')}`);
  assert.deepEqual(bad, []);
});

// O percurso do Tab tem de chegar aos itens da grade da agenda (antes ele parava no campo de data, no meio da barra).
await scenario('auditoria: o Tab percorre a agenda inteira até os itens da grade (Dia e Semana no computador)', async () => {
  const rows = audit.filter((r) => !r.fail && r.device === 'computador' && /^Área da clínica · agenda \((dia|semana)\)/.test(r.page));
  if (ONLY && !rows.length) return;
  assert.ok(rows.length >= 2, 'as páginas da grade foram auditadas');
  const bad = rows.filter((r) => !(r.focus.grade > 0) || r.focus.count < 30).map((r) => `${r.page}: ${r.focus.count} paradas, ${r.focus.grade} na grade`);
  assert.deepEqual(bad, []);
});

await scenario('auditoria: foco visível e não escondido em todas as paradas do Tab', async () => {
  const bad = audit.filter((r) => !r.fail && r.focus.problems.length).map((r) => `${r.page} (${r.device}): ${r.focus.problems.join('; ')}`);
  assert.deepEqual(bad, []);
});

/* ======================= só com o teclado ======================= */
// Aperta Tab (ou Shift+Tab) até o foco chegar no que casa com o seletor.
async function tabTo(page, sel, { max = 90, back = false } = {}) {
  for (let i = 0; i <= max; i += 1) {
    if (await page.evaluate((x) => !!document.activeElement?.matches(x), sel)) return i;
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`o Tab não chegou em ${sel}`);
}
const focusIn = (page, sel) => page.evaluate((x) => !!document.activeElement?.closest(x), sel);
const focused = (page) => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''} ${(a.textContent || a.value || '').trim().slice(0, 40)}` : ''; });
// Dentro da janela, Tab e Shift+Tab dão a volta sem sair dela.
async function trapped(page, box, n = 18) {
  for (let i = 0; i < n; i += 1) {
    await page.keyboard.press('Tab');
    assert.ok(await focusIn(page, box), `Tab ${i + 1} saiu da janela (foco em ${await focused(page)})`);
  }
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Shift+Tab');
    assert.ok(await focusIn(page, box), `Shift+Tab ${i + 1} saiu da janela (foco em ${await focused(page)})`);
  }
}

await scenario('teclado: buscar um exame na página inicial, ver os resultados e abrir a ficha e a página do local', async () => {
  const { page, errors, context } = await newPage(browser, { motion: 'reduce' });
  await page.goto(`${BASE}index.html`);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip', 'o primeiro Tab mostra "Pular para o conteúdo"');
  assert.ok(await page.evaluate(() => document.activeElement.getBoundingClientRect().top >= 0), 'o atalho aparece na tela');
  await tabTo(page, '#heroQ');
  await page.keyboard.type('resson');
  await page.keyboard.press('ArrowDown');
  const act = await page.getAttribute('#heroQ', 'aria-activedescendant');
  assert.ok(act, 'a seta escolhe uma sugestão (aria-activedescendant)');
  assert.equal(await page.getAttribute(`#${act}`, 'aria-selected'), 'true');
  assert.match(await page.textContent(`#${act}`), /Ressonância/);
  assert.equal(await page.getAttribute(`#${act}`, 'tabindex'), '-1', 'as sugestões ficam fora do Tab');
  await Promise.all([page.waitForURL(/perto\.html\?exame=rm/), page.keyboard.press('Enter')]);
  // Busca: sem pedir a localização sozinha; "Usar minha localização" pelo teclado.
  await tabTo(page, '#locBtn');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.pc .pc-open');
  await page.waitForFunction(() => !document.querySelector('.pt-more'));
  const btn = await tabTo(page, '.pc-open');
  assert.ok(btn < 60, `o primeiro local chega pelo Tab (${btn} toques)`);
  const id = await page.evaluate(() => document.activeElement.dataset.id);
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BUTTON', 'o cartão abre por um botão de verdade');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.sh-ov.open');
  await page.waitForFunction(() => document.activeElement?.closest('#sheet'));
  assert.equal(await page.getAttribute('#sheet', 'role'), 'dialog');
  assert.equal(await page.getAttribute('#sheet', 'aria-modal'), 'true');
  await trapped(page, '#sheet');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sh-ov:not(.open)', { state: 'attached' });
  assert.ok(await page.evaluate((i) => document.activeElement?.matches(`.pc-open[data-id="${CSS.escape(i)}"]`), id), 'Esc fecha e o foco volta para o mesmo local');
  // Abre de novo e vai para a página completa do local (link dentro da janela).
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.closest('#sheet'));
  await tabTo(page, '#sheet a[href^="local.html"]');
  await Promise.all([page.waitForURL(/local\.html\?/), page.keyboard.press('Enter')]);
  await page.waitForSelector('#app[aria-busy="false"] h1');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('teclado: pedir agendamento na página do local só com o teclado (celular, 390 px)', async () => {
  const { page, log, errors, context } = await newPage(browser, { mobile: true, motion: 'reduce' });
  await page.goto(`${BASE}local.html?cnes=2077485`);
  await page.waitForSelector('#agendar [data-act="pedido"]');
  await tabTo(page, '#agendar [data-act="pedido"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#bookForm');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'bkExam', 'o foco vai para o primeiro campo');
  // "Voltar" devolve o foco para o botão que abriu o formulário.
  await tabTo(page, '#bookForm [data-act="cancel-pedido"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('#agendar [data-act="pedido"]'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'bkExam');
  // Enviar vazio: o erro aparece junto do campo, que recebe o foco.
  await tabTo(page, '#bkBtn');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-f="exam"].bad');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'bkExam', 'foco no primeiro campo com erro');
  assert.match(await page.textContent('#e-exam'), /\S/, 'mensagem de erro do exame');
  await page.keyboard.press('ArrowDown');
  assert.notEqual(await page.inputValue('#bkExam'), '', 'seta escolhe o exame');
  await tabTo(page, '#bkDate');
  // A ordem dos campos da data segue o idioma do navegador (dia/mês ou mês/dia): tenta as duas.
  // Depois de digitar, o foco fica no último campo (ano): Shift+Tab duas vezes volta para o primeiro.
  const [y, m, d] = spDay(3).split('-');
  await page.keyboard.type(`${d}${m}${y}`);
  if (await page.inputValue('#bkDate') !== spDay(3)) {
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.type(`${m}${d}${y}`);
  }
  assert.equal(await page.inputValue('#bkDate'), spDay(3), 'data digitada no teclado');
  await tabTo(page, 'input[name="periodo"]');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => document.querySelector('input[name="periodo"]:checked').value), 'noite', 'setas trocam o período');
  await tabTo(page, '#bkName');
  await page.keyboard.type('Ana Teste');
  await tabTo(page, '#bkPhone');
  await page.keyboard.type('11987654321');
  await tabTo(page, 'input[name="consent"]');
  await page.keyboard.press('Space');
  assert.equal(await page.isChecked('input[name="consent"]'), true, 'Espaço marca a autorização');
  await tabTo(page, '#bkBtn');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.lc-ok');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'h-agendar', 'o foco vai para o "Recebemos seu pedido!"');
  assert.equal(log.filter((e) => e.method === 'POST' && e.path.endsWith('/appointment_requests')).length, 1, 'pedido gravado');
  const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(o <= 0, `sem rolagem lateral (${o}px)`);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('teclado e leitor de tela: escolher o horário e confirmar na página do local (horário direto, celular 390 px)', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, motion: 'reduce' });
  await page.goto(`${BASE}local.html?id=${PARTNER_ID}`);
  await page.waitForSelector('.sl-day');
  await page.waitForFunction(() => /horários livres nos próximos 14 dias/.test(document.querySelector('#lcLive')?.textContent ?? ''));
  assert.match(await page.textContent('#lcLive'), /Próximo: amanhã às 09:00/, 'o leitor de tela ouve quantos horários há e o próximo');
  assert.equal(await page.getAttribute('#lcLive', 'aria-live'), 'polite');
  // Tab chega no dia escolhido (aba), as setas trocam de dia, Tab chega nos horários
  await tabTo(page, '.sl-day.on');
  const dia1 = await page.evaluate(() => document.activeElement.dataset.day);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((d) => document.activeElement?.matches('.sl-day.on') && document.activeElement.dataset.day !== d, dia1);
  assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-selected')), /true/);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction((d) => document.activeElement?.dataset.day === d, dia1);
  await tabTo(page, '.sl-t');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#bookForm[data-mode="slot"]');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'bkName', 'o foco vai para o nome');
  await page.waitForFunction(() => /Horário escolhido:/.test(document.querySelector('#lcLive')?.textContent ?? ''));
  await page.keyboard.type('Ana Teste');
  await tabTo(page, '#bkPhone');
  await page.keyboard.type('11987654321');
  await tabTo(page, 'input[name="consent"]');
  await page.keyboard.press('Space');
  await tabTo(page, '#bkBtn');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.lc-ok');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'h-agendar', 'o foco vai para o título "Agendamento confirmado"');
  assert.match(await page.textContent('#h-agendar'), /Agendamento confirmado para .* às 09:00/);
  // "Trocar" volta para os horários sem perder o que foi digitado (outra página)
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('teclado: Meus pedidos pelo menu do topo, cancelar com confirmação e avaliar na conta', async () => {
  const { page, errors, context } = await newPage(browser, { motion: 'reduce' });
  await page.goto(`${BASE}index.html`);
  await tabTo(page, '.tab[data-go="agenda"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.appt');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'agendaMain', 'o foco vai para Meus pedidos');
  assert.equal(await page.textContent('h1#agTitle'), 'Meus pedidos');
  await tabTo(page, '.appt [data-cancel]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('[data-cancel-yes]'));
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.activeElement?.matches('[data-cancel-no]')), 'Tab vai para o "Não"');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('[data-cancel]'));
  // Minha conta: "Avaliar" o pedido concluído abre as estrelas, escolhidas com as setas.
  await page.goto(`${BASE}conta.html`);
  await page.waitForSelector('[data-review]');
  await tabTo(page, '[data-review]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('.ct-rev input[type=radio]'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.querySelector('.ct-rev input[type=radio]:checked')?.value), '3', 'setas escolhem as estrelas');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('janelas: na página inicial, o seletor de cidade prende o foco, Esc fecha e o foco volta', async () => {
  for (const mobile of [false, true]) {
    const { page, errors, context } = await newPage(browser, { mobile, motion: 'reduce' });
    await page.goto(`${BASE}index.html`);
    await page.evaluate(() => document.querySelector('#reais').scrollIntoView());
    await page.waitForSelector('#realList li b');
    await page.focus('#cityBtn');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.ov.open');
    await page.waitForFunction(() => document.activeElement?.id === 'cityQ');
    assert.equal(await page.getAttribute('#sheet', 'role'), 'dialog');
    await page.waitForSelector('#cityIdle .cid-op');
    await trapped(page, '#sheet', 12);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cityBtn', 'o foco volta para o botão da cidade');
    // Fechada, a janela sai do Tab e do leitor de tela: do último link do rodapé, o Tab não entra no seletor invisível.
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#ov')).visibility === 'hidden');
    await page.locator('footer a').last().focus();
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      assert.ok(!(await page.evaluate(() => !!document.activeElement?.closest('#ov'))), `Tab ${i + 1} depois do rodapé não entra na janela fechada`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('janelas: escolher a cidade por um botão que some (cartão sem localização) deixa o foco num botão visível', async () => {
  for (const mobile of [false, true]) {
    // Sem a permissão do Playwright: o Chromium recusa sem perguntar e a tela mostra o cartão com "Escolher minha cidade".
    const { page, errors, context } = await newPage(browser, { mobile, motion: 'reduce', geo: false });
    await page.goto(`${BASE}index.html`);
    await page.waitForFunction(() => document.querySelector('#reais').dataset.estado === 'naoapareceu');
    await page.focus('#pvEstado [data-bt="escolher"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'cityQ');
    await page.keyboard.type('rio');
    await page.waitForSelector('#cityList [role=option]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
    await page.waitForFunction(() => document.querySelector('#reais').dataset.estado !== 'naoapareceu');
    const f = await page.evaluate(() => {
      const a = document.activeElement, r = a?.getBoundingClientRect(), topo = document.querySelector('.top').getBoundingClientRect().bottom;
      const nav = document.querySelector('.bnav'), fim = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : innerHeight;
      return { id: a?.id || '', tag: a?.tagName, visible: !!a?.getClientRects().length, aVista: !!r && r.top >= topo - 1 && r.bottom <= fim + 1 };
    });
    assert.notEqual(f.tag, 'BODY', 'o foco não cai no <body>');
    assert.ok(f.visible, `o foco fica num elemento visível (${f.id || f.tag})`);
    assert.equal(f.id, 'cityBtn', 'o foco vai para o botão da cidade da mesma tela');
    // WCAG 2.4.11: o botão com o foco aparece entre o cabeçalho e o menu de baixo (a página rola só o necessário).
    assert.ok(f.aVista, `o botão da cidade com o foco está à vista (${mobile ? 'celular' : 'computador'})`);
    // Pelo botão da cidade: o foco volta para ele.
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cityIdle .cid-op');
    await page.click('#cityIdle .cid-op >> nth=0');
    await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cityBtn');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('teclado: abas com Tab, Enter e Espaço, "Mostrar mais 4" e a busca da cidade (setas, Enter e Esc) na tela "Clínicas perto de você" (celular)', async () => {
  const { page, errors, context } = await newPage(browser, { mobile: true, motion: 'reduce', geoSim: { estado: 'granted' } });
  // 10 locais do CNES + o parceiro: a lista mostra 6 no celular e o "Mostrar mais 4". O banco simulado respeita a aba.
  const MAIS = [...CNES_ROWS, ...Array.from({ length: 6 }, (_, i) => ({ ...CNES_ROWS[i % 4], cnes: String(7100001 + i), name: `Local Perto ${i + 1}`, distance_m: 1300 + i * 100, lat: -23.5635 + i / 1000, lng: -46.65 - i / 1000 }))];
  await context.route(`${SUPA}/rest/v1/rpc/nearby_establishments`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const b = JSON.parse(route.request().postData() || '{}');
    return json(route, MAIS.filter((r) => !b.p_kind || r.kind === b.p_kind).map((r) => ({ ...r, total: MAIS.length })));
  });
  await page.goto(`${BASE}index.html`);
  await page.waitForSelector('#reais[data-estado="lista"]');
  await page.waitForFunction(() => document.querySelectorAll('#realList li b').length === 10);
  // Do botão da cidade, o Tab chega às abas; Enter escolhe e o foco fica na aba.
  await page.focus('#cityBtn');
  const passos = await tabTo(page, '#pvTabs button[data-tipo="laboratorio"]');
  assert.ok(passos <= 4, `as abas vêm logo depois do botão da cidade (${passos} Tabs)`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#pvTabs button[data-tipo="laboratorio"]').getAttribute('aria-pressed') === 'true');
  await page.waitForFunction(() => { const s = [...document.querySelectorAll('#realList .pv-txt small')]; return s.length > 0 && s.every((x) => /Laboratório/.test(x.textContent)); });
  assert.ok(await page.evaluate(() => document.activeElement?.matches('#pvTabs button[data-tipo="laboratorio"]')), 'o foco fica na aba');
  assert.equal(await page.getAttribute('#pvTabs button[data-tipo=""]', 'aria-pressed'), 'false');
  // Espaço também escolhe: de volta a Todos.
  await tabTo(page, '#pvTabs button[data-tipo=""]', { back: true });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelectorAll('#realList li').length === 10);
  assert.equal(await page.getAttribute('#pvTabs button[data-tipo=""]', 'aria-pressed'), 'true');
  assert.ok(await page.evaluate(() => document.activeElement?.matches('#pvTabs button[data-tipo=""]')));
  // "Mostrar mais 4": Enter mostra o resto e leva o foco ao 7º local.
  await tabTo(page, '#pvMore');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement === document.querySelector('#realList li:nth-child(7) a'));
  assert.ok(await page.locator('#pvMore').isHidden());
  // Busca da cidade: ↓ escolhe, Esc com texto limpa (a janela fica), Enter confirma e Esc com o campo vazio fecha.
  await tabTo(page, '#cityBtn', { back: true });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'cityQ');
  await page.keyboard.type('rio');
  await page.waitForSelector('#cityList [role=option]');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.getAttribute('#cityQ', 'aria-activedescendant'), 'cityOpt-3304557');
  assert.equal(await page.getAttribute('#cityOpt-3304557', 'aria-selected'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.inputValue('#cityQ'), '', 'Esc com texto limpa o campo');
  assert.equal(await page.getAttribute('#cityQ', 'aria-expanded'), 'false');
  assert.equal(await page.locator('#ov.open').count(), 1, 'e a janela continua aberta');
  await page.keyboard.type('rio');
  await page.waitForSelector('#cityList [role=option]');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
  await page.waitForFunction(() => document.querySelector('#cityName').textContent === 'Rio de Janeiro - RJ');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cityBtn', 'o foco volta para o botão da cidade');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'cityQ');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.ov:not(.open)', { state: 'attached' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cityBtn');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('reduzir movimento: nada se mexe sozinho, a rolagem não desliza e o 3D não carrega', async () => {
  const pages = [
    ['index.html', (p) => p.waitForSelector('#heroLite li a')],
    ['perto.html?usar=localizacao', (p) => p.waitForSelector('.pc')],
    ['local.html?cnes=2077485', (p) => p.waitForSelector('#app[aria-busy="false"] h1')],
    ['conta.html', (p) => p.waitForSelector('.ct-order')],
    ['exames/raio-x.html', null], ['cidades/sp/sao-paulo/', null], ['parceiros.html', null], [`${PASTA}nao-existe`, null],
  ];
  for (const [url, ready] of pages) {
    const { page, errors, context } = await newPage(browser, { motion: 'reduce', lgpd: true });
    await page.goto(BASE + url);
    if (ready) await ready(page); else await waitIdle(page);
    await page.waitForTimeout(300);
    const moving = await page.evaluate(() => document.getAnimations()
      .filter((a) => a.playState === 'running' && a.effect?.getComputedTiming?.().iterations === Infinity)
      .map((a) => `${a.animationName || a.transitionProperty || 'animação'} em ${a.effect?.target?.className || a.effect?.target?.tagName}`));
    assert.deepEqual(moving, [], `${url}: animações sem fim com "reduzir movimento"`);
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'smooth', `${url}: rolagem sem efeito`);
    if (url === 'index.html') {
      assert.ok(await page.evaluate(() => document.body.classList.contains('lite') && !document.querySelector('.h3d-canvas')), 'sem 3D');
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await scenario('mapa 3D: o botão "Pausar animação" para o giro e a escolha fica guardada no aparelho', async () => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(`${BASE}index.html`);
  await page.waitForSelector('#heroPause:not([hidden]), body[data-hero="leve"]', { timeout: 45000 });
  if (await page.evaluate(() => document.body.dataset.hero === 'leve')) {
    console.log('  (navegador sem WebGL: a página abriu no modo leve, sem 3D e sem o botão; nada a pausar)');
    assert.equal(await page.isHidden('#heroPause'), true);
    await context.close();
    return;
  }
  // Para onde a câmera do mapa aponta (graus): muda enquanto o mapa gira.
  const pos = () => page.evaluate(() => window.HERO?.info?.().rumo ?? null);
  await page.waitForTimeout(3200); // a entrada da cena termina
  const a = await pos();
  await page.waitForTimeout(1200);
  assert.notEqual(await pos(), a, 'antes de pausar, o mapa gira');
  // Com o foco do teclado num rótulo do mapa, o giro espera: girando, o rótulo podia sumir debaixo do foco (era o que
  // derrubava, de vez em quando, a auditoria do foco na página inicial). Saiu o foco, o mapa volta a girar.
  await page.waitForSelector('.h3d-label.on');
  await page.keyboard.press('Shift'); // a última ação foi do teclado: o foco posto a seguir conta como foco do teclado
  await page.focus('.h3d-label.on');
  assert.ok(await page.evaluate(() => document.activeElement.matches('.h3d-label:focus-visible')), 'foco do teclado num rótulo do mapa');
  await page.waitForTimeout(300);
  const f = await pos();
  await page.waitForTimeout(1200);
  assert.equal(await pos(), f, 'com o foco do teclado num rótulo, o mapa espera');
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains('on')), 'e o rótulo com o foco continua à vista');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(1200);
  assert.notEqual(await pos(), f, 'saiu o foco, o mapa volta a girar');
  await page.focus('#heroPause');
  await page.keyboard.press('Enter');
  assert.equal((await page.textContent('#heroPause')).trim(), 'Continuar animação');
  await page.waitForTimeout(300);
  const b = await pos();
  await page.waitForTimeout(1200);
  assert.equal(await pos(), b, 'pausado, o mapa fica parado');
  await page.reload();
  await page.waitForSelector('#heroPause:not([hidden])', { timeout: 45000 });
  assert.equal((await page.textContent('#heroPause')).trim(), 'Continuar animação', 'lembra da escolha');
  await page.click('#heroPause');
  assert.equal((await page.textContent('#heroPause')).trim(), 'Pausar animação');
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
