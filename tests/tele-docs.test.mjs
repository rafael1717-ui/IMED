// Testes dos documentos da teleconsulta (assets/js/tele-docs.js): tipos e códigos do ITI, CPF, código de conferência,
// validações iguais às do banco (receita só simples, atestado, CID, comparecimento, encaminhamento...), texto que cabe no
// PDF, modelo do documento, pré-visualização escapada e o PDF de verdade montado com a pdf-lib do repositório
// (assets/vendor): textos obrigatórios, código, QR e metadados de documento de saúde.
// Rodar com: node --test tests/tele-docs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as D from '../assets/js/tele-docs.js';
import * as T from '../assets/js/tele-core.js';
import { SITE } from './endereco.mjs';

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url);
const DOCS_SQL = readFileSync(new URL(readdirSync(MIG_DIR).find((f) => f.endsWith('_tele_documentos.sql')), MIG_DIR), 'utf8');
const TELE_SQL = readFileSync(new URL(readdirSync(MIG_DIR).find((f) => f.endsWith('_teleconsulta.sql')), MIG_DIR), 'utf8');
const CONSULT = { status: 'ended', created_at: '2026-10-30T16:50:00Z', accepted_at: '2026-10-30T17:00:00Z', started_at: '2026-10-30T17:05:00Z', ended_at: '2026-10-30T17:30:00Z' };
const DOCTOR = { full_name: 'Carla Mendes', crm: '123456', crm_uf: 'SP', rqe: '7788', specialty: 'Clínica médica', prof_address: 'Rua das Flores, 100, sala 2, São Paulo/SP', prof_contact: '1134567890' };
const PATIENT = { name: 'Ana Maria da Silva', birthdate: '1980-05-17', age: 46, cpf: '52998224725', sem_cpf: false, address: 'Rua A, 10, Centro, Recife/PE', for_other: false, requester_name: null, relationship: null,
  identidade_conferida_em: '2026-10-30T17:06:00Z', inicio_atendimento: '2026-10-30T17:05:00Z' };
const doc = (kind, payload, extra = {}) => ({ id: 'd1', kind, payload, code: 'ABCDE2345K', status: 'emitido', created_at: '2026-10-30T17:31:00Z', signed: false, doctor_snapshot: DOCTOR, patient_snapshot: PATIENT, ...extra });
const modelText = (m) => [m.title, m.mode, ...m.doctor.flat(), ...m.patient.flat(), m.when, ...m.body.flatMap((b) => [b.t === 'li' ? `${b.n} ${b.text}` : b.text, b.k, ...(b.lines || []), ...(b.sub || [])]), m.codeText, m.verifyAt, m.validity, m.sign].filter(Boolean).join('\n');

/* ======================= tipos ======================= */
test('tipos: os 7 do banco, na ordem das abas, e os códigos do ITI só nos tipos confirmados', () => {
  const kinds = /kind in \(([^)]*)\)/.exec(DOCS_SQL)[1].match(/'([a-z]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(D.KINDS.map((k) => k.id), kinds);
  assert.deepEqual(D.KINDS.map((k) => k.title), ['Solicitação de exames', 'Receita', 'Atestado médico', 'Declaração de comparecimento', 'Encaminhamento', 'Relatório médico', 'Orientações ao paciente']);
  // Guia do Desenvolvedor do Validar (ITI): 2.16.76.1.12.1.1 prescrição, .2 atestado, .3 solicitação de exame, .11 relatório.
  assert.deepEqual(Object.fromEntries(D.KINDS.map((k) => [k.id, k.oid])), {
    exames: '2.16.76.1.12.1.3', receita: '2.16.76.1.12.1.1', atestado: '2.16.76.1.12.1.2', comparecimento: null,
    encaminhamento: null, relatorio: '2.16.76.1.12.1.11', orientacoes: null,
  });
  assert.deepEqual(D.ITI_OID, { crm: '2.16.76.1.4.2.2.1', uf: '2.16.76.1.4.2.2.2', especialidade: '2.16.76.1.4.2.2.3' });
  assert.equal(D.TELEMED, 'Documento emitido em modalidade de telemedicina');
  assert.equal(D.CFM_PRESCRICAO_URL, 'https://prescricaoeletronica.cfm.org.br/');
});

test('banco e tela com os mesmos limites: 3 MB, 7 dias, um PDF por documento, 30 documentos, código e receita só simples', () => {
  assert.equal(D.MAX_PDF_BYTES, 3145728);
  assert.ok(DOCS_SQL.includes('v_len > 3145728'));
  assert.ok(DOCS_SQL.includes("interval '7 days'") && D.UPLOAD_DAYS === 7);
  assert.ok(DOCS_SQL.includes("raise exception 'ja_assinado'") && !DOCS_SQL.includes('limite_envios') && D.MAX_UPLOADS === undefined, 'um PDF por documento, sem troca');
  for (const s of D.SUBFILTERS) assert.ok(DOCS_SQL.includes(`convert_to('${s}', 'UTF8')`), `SubFilter ${s} igual ao banco`);
  assert.ok(DOCS_SQL.includes("raise exception 'pdf_outro_documento'"), 'o banco confere o código no PDF');
  assert.ok(DOCS_SQL.includes("if v_ini not between v_day and v_day + 7 then"), 'atestado: do dia da consulta a 7 dias depois (igual à tela)');
  assert.ok(DOCS_SQL.includes('>= 30 then') && D.MAX_DOCS === 30);
  assert.ok(DOCS_SQL.includes("'^[2-9A-HJ-NP-Z]{10}$'"));
  assert.ok(DOCS_SQL.includes("v_alpha constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'") && D.CODE_ALPHABET === '23456789ABCDEFGHJKLMNPQRSTUVWXYZ');
  assert.match(DOCS_SQL, /tele_receita_liberada\(p_tipo text\)[\s\S]*?select p_tipo = 'simples';/);
});

/* ======================= CPF e código ======================= */
test('CPF: dígitos verificadores iguais aos do banco, máscara e formato', () => {
  for (const ok of ['52998224725', '11144477735']) assert.equal(D.isCpf(ok), true, ok);
  for (const bad of ['52998224724', '11111111111', '123', '', null, '529.982.247-25']) assert.equal(D.isCpf(bad), false, String(bad));
  assert.equal(D.fmtCpf('52998224725'), '529.982.247-25');
  assert.equal(D.maskCpf('5299822'), '529.982.2');
  assert.equal(D.maskCpf('529982247259999'), '529.982.247-25');
  assert.equal(D.cpfDigits('529.982.247-25'), '52998224725');
});

test('código: 10 caracteres sem 0, O, 1 e I; aceita minúsculas, traços e espaços; endereço do QR', () => {
  assert.equal(D.normCode('abcde-2345k'), 'ABCDE2345K');
  assert.equal(D.normCode(' ABCDE 2345K '), 'ABCDE2345K');
  for (const bad of ['ABCDE2345', 'ABCDE2345KX', 'ABCDO2345K', 'ABCD02345K', 'ABCD12345K', 'ABCDI2345K', `${'A'.repeat(41)}`, null]) assert.equal(D.normCode(bad), null, String(bad));
  assert.equal(D.fmtCode('abcde2345k'), 'ABCDE-2345K');
  assert.equal(D.fmtCode('x'), '');
  assert.equal(D.verifyUrl(SITE, 'abcde-2345k'), `${SITE}documento.html?c=ABCDE2345K`);
  assert.equal(D.verifyUrl('https://imed.com.br', 'ABCDE2345K'), 'https://imed.com.br/documento.html?c=ABCDE2345K');
  assert.equal(D.verifyPath('ABCDE2345K'), 'documento.html?c=ABCDE2345K');
  assert.equal(D.verifyPath('<script>'), 'documento.html');
  for (const ch of D.CODE_ALPHABET) assert.equal(D.normCode(ch.repeat(10)), ch.repeat(10));
});

/* ======================= perfil e paciente ======================= */
test('contato e endereço profissionais: mesmas regras de tele_doctor_profile', () => {
  assert.deepEqual(D.checkContact('+55 (11) 3456-7890'), { ok: true, value: '1134567890' });
  assert.deepEqual(D.checkContact('(81) 99999-8888'), { ok: true, value: '81999998888' });
  assert.deepEqual(D.checkContact('Consultorio@Exemplo.COM'), { ok: true, value: 'consultorio@exemplo.com' });
  for (const bad of ['', '1234', 'abc', '(01) 3456-7890', 'a@b', 'x@y.c.']) assert.equal(D.checkContact(bad).ok, false, bad);
  const r = D.checkProfile({ address: '  Rua   das Flores, 100 - São Paulo/SP ', contact: '11 3456-7890' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, { p_prof_address: 'Rua das Flores, 100 - São Paulo/SP', p_prof_contact: '1134567890' });
  const bad = D.checkProfile({ address: 'Rua', contact: 'x' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['address', 'contact']);
  assert.equal(D.profileComplete({ prof_address: 'Rua das Flores, 100', prof_contact: '1134567890' }), true);
  assert.equal(D.profileComplete({ prof_address: 'Rua das Flores, 100', prof_contact: null }), false);
});

test('dados do paciente: CPF ou "não possui CPF" e endereço com cidade/UF', () => {
  const ok = D.checkPatient({ cpf: '529.982.247-25', noCpf: false, address: 'Rua A, 10, Recife/pe' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.args, { p_cpf: '52998224725', p_address: 'Rua A, 10, Recife/PE', p_no_cpf: false });
  const none = D.checkPatient({ cpf: '', noCpf: true, address: 'Recife - PE' });
  assert.equal(none.ok, true);
  assert.equal(none.args.p_cpf, '', 'sem CPF: apaga o que houver');
  assert.equal(none.args.p_no_cpf, true, 'o banco guarda a declaração "não possui CPF"');
  assert.match(D.checkPatient({ cpf: '', noCpf: false, address: 'Recife/PE' }).errors.cpf, /não possui CPF/);
  assert.match(D.checkPatient({ cpf: '529.982.247-24', address: 'Recife/PE' }).errors.cpf, /inválido/);
  assert.match(D.checkPatient({ cpf: '52998224725', address: 'Recife' }).errors.address, /sigla do estado/);
  assert.match(D.checkPatient({ cpf: '52998224725', address: 'ab' }).errors.address, /cidade/);
  assert.equal(D.fixUf('Natal / rn'), 'Natal / RN');
  assert.equal(D.fixUf('Rua do Sol, 10'), 'Rua do Sol, 10');
  assert.equal(D.hasUf('Salvador/BA'), true);
  assert.equal(D.hasUf('Pará de Minas'), false);
  assert.deepEqual(D.patientMissing({ cpf: null, address: 'Recife/PE' }, false), ['cpf']);
  assert.deepEqual(D.patientMissing({ cpf: null, address: 'Recife/PE' }, true), []);
  assert.deepEqual(D.patientMissing({ cpf: null, noCpf: true, address: 'Recife/PE' }), [], 'declaração gravada no banco');
  assert.deepEqual(D.patientMissing(null, false), ['cpf', 'address']);
  // Linha do banco -> tela, e o que vai em p_expect (o que o médico está vendo).
  const row = { patient_cpf: null, patient_address: 'Recife/PE', patient_no_cpf: true, identity_checked_at: '2026-10-30T17:06:00Z' };
  assert.deepEqual(D.patientFromRow(row), { cpf: null, address: 'Recife/PE', noCpf: true, identityAt: '2026-10-30T17:06:00Z' });
  assert.deepEqual(D.patientExpect(D.patientFromRow(row)), { cpf: null, sem_cpf: true, endereco: 'Recife/PE' });
  assert.equal(D.samePatient(D.patientFromRow(row), { ...D.patientFromRow(row), identityAt: null }), true, 'a identidade não entra na comparação');
  assert.equal(D.samePatient(D.patientFromRow(row), { ...D.patientFromRow(row), address: 'Olinda/PE' }), false);
});

/* ======================= validações por tipo ======================= */
const RX = { medicamento: 'Dipirona', concentracao: '500 mg', forma: 'comprimido', via: 'oral', posologia: 'Tomar 1 comprimido a cada 6 horas se tiver dor', quantidade: '1 caixa com 20 comprimidos', duracao: '5 dias' };
const ADDR = { address: 'Rua A, 10, Centro, Recife/PE' };
test('receita: só a simples; antibiótico, controlado e notificação bloqueados com o texto do SNCR', () => {
  for (const tipo of ['antimicrobiano', 'controle_especial_c1']) {
    const v = D.validateDoc('receita', { tipo, itens: [RX], confirmaSimples: true, confirmaEndereco: true }, ADDR);
    assert.equal(v.ok, false);
    assert.match(v.errors.tipo, /SNCR/);
    assert.match(v.errors.tipo, /Plataforma de Prescrição Eletrônica do CFM/);
    assert.ok(!/Desde 30\/09\/2026[^.]*só vale/.test(v.errors.tipo), 'não afirma regra que a Anvisa ainda está pondo em vigor (transição prorrogada)');
    assert.equal(D.receitaBlock(tipo), 'sncr');
  }
  const n = D.validateDoc('receita', { tipo: 'notificacao', itens: [RX] }, {});
  assert.match(n.errors.tipo, /azul ou amarela/);
  assert.equal(D.receitaBlock('notificacao'), 'notificacao');
  const v = D.validateDoc('receita', { tipo: 'simples', itens: [{ ...RX, medicamento: '  Dipirona   sódica ' }], observacao: ' Tomar com água ', confirmaSimples: true, confirmaEndereco: true }, ADDR);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.payload, { tipo: 'simples', itens: [{ ...RX, medicamento: 'Dipirona sódica', observacao: null }], observacao: 'Tomar com água', endereco_residencial: true });
  const miss = D.validateDoc('receita', { tipo: 'simples', itens: [{ medicamento: 'D' }] }, ADDR);
  for (const k of ['itens.1.medicamento', 'itens.1.concentracao', 'itens.1.via', 'itens.1.posologia', 'itens.1.quantidade', 'itens.1.duracao', 'confirmaSimples', 'confirmaEndereco']) assert.ok(miss.errors[k], k);
  assert.match(D.validateDoc('receita', { tipo: 'simples', itens: [] }, ADDR).errors.itens, /pelo menos um/);
  assert.match(D.validateDoc('receita', { tipo: 'simples', itens: Array(21).fill(RX), confirmaSimples: true, confirmaEndereco: true }, ADDR).errors.itens, /20/);
  const ab = D.validateDoc('receita', { tipo: 'simples', itens: [{ ...RX, posologia: '1 cp VO 8/8h' }], confirmaSimples: true, confirmaEndereco: true }, ADDR);
  assert.equal(ab.ok, true, 'abreviação só avisa');
  assert.match(ab.warnings[0], /Item 1: evite abreviações/);
  assert.deepEqual(D.abbrevWarnings('Tomar 1 comprimido a cada 8 horas'), []);
});

test('receita: endereço residencial com número (Lei 5.991/1973) e lista de alerta de antibiótico, GLP-1 e controlado', () => {
  const base = { tipo: 'simples', itens: [RX], confirmaSimples: true, confirmaEndereco: true };
  // Só a cidade/UF não basta para a receita; número ou "s/n" sim.
  assert.match(D.validateDoc('receita', base, { address: 'Recife/PE' }).errors.confirmaEndereco, /rua e número/);
  assert.equal(D.validateDoc('receita', base, { address: '  ' }).errors.confirmaEndereco, undefined, 'em branco: o aviso é o de completar os dados do paciente');
  assert.equal(D.validateDoc('receita', base, { address: 'Sítio Boa Vista, s/n, zona rural, Caruaru/PE' }).ok, true);
  for (const a of ['Rua A, 10, Recife/PE', 'Estrada velha S / N - Caruaru/PE', 'Rua sem número, Centro, Olinda/PE']) assert.equal(D.residentialLike(a), true, a);
  for (const a of ['Recife/PE', 'Natal - RN', '', null]) assert.equal(D.residentialLike(a), false, String(a));
  // Antibiótico, caneta GLP-1 e controlado comuns: aviso do SNCR e confirmação própria (a lista nunca libera nada).
  const amox = D.validateDoc('receita', { ...base, itens: [{ ...RX, medicamento: 'Amoxicilina + clavulanato de potássio' }, RX, { ...RX, medicamento: 'OZEMPIC' }] }, ADDR);
  assert.equal(amox.ok, false);
  assert.match(amox.errors.confirmaAlerta, /itens 1, 3/);
  assert.equal(amox.warnings.filter((w) => /SNCR/.test(w)).length, 2);
  assert.match(amox.warnings.join('\n'), /Item 1: “Amoxicilina \+ clavulanato de potássio” parece ser antibiótico/);
  assert.match(amox.warnings.join('\n'), /Item 3: “OZEMPIC” parece ser caneta GLP-1/);
  assert.equal(D.validateDoc('receita', { ...base, confirmaAlerta: true, itens: [{ ...RX, medicamento: 'Sertralina' }] }, ADDR).ok, true, 'o médico confirma');
  assert.deepEqual(D.rxAlerts([{ medicamento: 'Fluoxetina' }, { medicamento: 'Dipirona' }, { medicamento: 'Nitrofurantoína' }]).map((a) => [a.n, a.cat]),
    [[1, 'remédio controlado (Portaria 344)'], [3, 'antibiótico']]);
  assert.deepEqual(D.rxAlerts([{ medicamento: 'Ciprofibrato' }, { medicamento: 'Cefalexinas' }]), [], 'só a palavra inteira');
});

test('atestado: 1 a 90 dias, começa no dia da consulta (nunca antes) e CID só com autorização expressa', () => {
  const ctx = { consult: CONSULT };
  const v = D.validateDoc('atestado', { dias: '3', cid: 'j 111', cidAutorizado: true }, ctx);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.payload, { dias: 3, inicio: '2026-10-30', cid: 'J11.1', cid_autorizado: true, observacao: null, fim: '2026-11-01' });
  assert.match(D.validateDoc('atestado', { dias: '2', cid: 'J11' }, ctx).errors.cidAutorizado, /autorização expressa/);
  assert.match(D.validateDoc('atestado', { dias: '2', cid: 'XX', cidAutorizado: true }, ctx).errors.cid, /CID-10/);
  for (const d of ['0', '91', '2.5', '', 'abc']) assert.ok(D.validateDoc('atestado', { dias: d }, ctx).errors.dias, d);
  assert.match(D.validateDoc('atestado', { dias: '1', inicio: '2026-10-29' }, ctx).errors.inicio, /antes da consulta/);
  assert.match(D.validateDoc('atestado', { dias: '1', inicio: '2026-11-07' }, ctx).errors.inicio, /06\/11\/2026/);
  assert.equal(D.validateDoc('atestado', { dias: '1', inicio: '2026-11-06' }, ctx).ok, true);
  assert.match(D.validateDoc('atestado', { dias: '20' }, ctx).warnings[0], /perícia do INSS/);
  assert.equal(D.validateDoc('atestado', { dias: '1', cid: '' }, ctx).payload.cid_autorizado, false);
});

test('declaração de comparecimento: só com a consulta encerrada, com dia e horários do registro (nunca digitados)', () => {
  const ctx = { consult: CONSULT };
  const v = D.validateDoc('comparecimento', { observacao: '  ', data: '2026-10-01', hora_inicio: '00:05' }, ctx);
  assert.equal(v.ok, true);
  assert.deepEqual(v.payload, { observacao: null }, 'nada digitado vai ao banco');
  assert.deepEqual(ctx.preview, { data: '2026-10-30', hora_inicio: '14:05', data_fim: '2026-10-30', hora_fim: '14:30' });
  // Aceita e sem atendimento (só accepted_at): nada de declaração com a hora do aceite.
  assert.match(D.validateDoc('comparecimento', {}, { consult: { status: 'accepted', accepted_at: CONSULT.accepted_at, started_at: null } }).errors.horario, /não começou/);
  // Em andamento: espera encerrar (o fim é o do registro, não a hora da emissão).
  assert.match(D.validateDoc('comparecimento', {}, { consult: { ...CONSULT, status: 'in_call', ended_at: null } }).errors.horario, /depois de encerrar/);
  // Encerrada automaticamente (mais de 3 horas): aviso, porque o fim não é o real.
  assert.match(D.validateDoc('comparecimento', {}, { consult: { ...CONSULT, closed_by: 'system' } }).warnings[0], /encerramento automático/);
  // Passou da meia-noite: o dia do fim aparece na prévia.
  const night = { consult: { ...CONSULT, started_at: '2026-10-31T02:50:00Z', ended_at: '2026-10-31T03:20:00Z' } };
  assert.equal(D.validateDoc('comparecimento', {}, night).ok, true);
  assert.deepEqual(night.preview, { data: '2026-10-30', hora_inicio: '23:50', data_fim: '2026-10-31', hora_fim: '00:20' });
});

test('encaminhamento, relatório e orientações: limites do banco e confirmação no urgente', () => {
  const e = D.validateDoc('encaminhamento', { especialidade: 'Cardiologia', motivo: 'Dor no peito aos esforços.', prioridade: 'urgente' }, {});
  assert.match(e.errors.orientouUrgencia, /atendimento imediato/);
  const ok = D.validateDoc('encaminhamento', { especialidade: ' Cardiologia ', motivo: 'Dor no peito.', prioridade: 'urgente', orientouUrgencia: true }, {});
  assert.deepEqual(ok.payload, { especialidade: 'Cardiologia', motivo: 'Dor no peito.', prioridade: 'urgente', observacao: null });
  assert.equal(D.validateDoc('encaminhamento', { especialidade: 'C', motivo: 'ab' }, {}).ok, false);
  assert.equal(D.validateDoc('encaminhamento', { especialidade: 'Ortopedia', motivo: 'Dor no joelho', prioridade: 'x' }, {}).payload.prioridade, 'eletiva');
  assert.match(D.validateDoc('relatorio', { texto: 'ab' }, {}).errors.texto, /relatório/);
  assert.equal(D.validateDoc('relatorio', { texto: 'x'.repeat(4001) }, {}).ok, false);
  assert.deepEqual(D.validateDoc('orientacoes', { texto: '  Beber água.\r\nRepouso.  ', cid: 'F41' }, {}).payload, { texto: 'Beber água.\nRepouso.' });
  // Relatório: CID só a pedido e com a autorização expressa do paciente (como no atestado).
  assert.deepEqual(D.validateDoc('relatorio', { texto: 'Ansiedade.' }, {}).payload, { texto: 'Ansiedade.', cid: null, cid_autorizado: false });
  assert.match(D.validateDoc('relatorio', { texto: 'Ansiedade.', cid: 'F41.1' }, {}).errors.cidAutorizado, /autorização expressa/);
  assert.match(D.validateDoc('relatorio', { texto: 'Ansiedade.', cid: 'F4', cidAutorizado: true }, {}).errors.cid, /CID-10/);
  assert.deepEqual(D.validateDoc('relatorio', { texto: 'Ansiedade.', cid: 'f 411', cidAutorizado: true }, {}).payload, { texto: 'Ansiedade.', cid: 'F41.1', cid_autorizado: true });
});

test('pedido de exames: usa a lista e a indicação da consulta', () => {
  const exams = [T.examFromCatalog('hemograma'), T.examFromCatalog('rx_torax', 'PA e perfil')];
  const v = D.validateDoc('exames', { indicacao: ' Tosse ' }, { exams });
  assert.deepEqual(v.payload, { itens: T.examsPayload(exams), indicacao: 'Tosse' });
  assert.match(D.validateDoc('exames', {}, { exams: [] }).errors.itens, /Escolha os exames/);
  assert.equal(D.validateDoc('nao-existe', {}, {}).ok, false);
});

/* ======================= texto que cabe no PDF ======================= */
test('texto do PDF: símbolos trocados, caracteres que não saem avisados e nomes com a letra mais parecida', async () => {
  assert.equal(D.cleanText('febre ≥ 38 °C\r\n→ ok fim​'), 'febre >= 38 °C\n-> ok fim');
  assert.deepEqual(D.pdfUnsupported('ação ção “aspas” — € ✓'), []);
  assert.deepEqual(D.pdfUnsupported('dor 😀 e ∞'), ['😀', '∞']);
  assert.match(D.validateDoc('relatorio', { texto: 'Paciente 😀 bem' }, {}).errors.texto, /😀/);
  assert.equal(D.pdfSafe('Nguyễn Ōsaka 😀'), 'Nguyên Osaka ?');
  // A lista de caracteres da tela é a mesma que a fonte do PDF consegue escrever (pdf-lib, Helvetica).
  const lib = await D.loadPdfLib();
  const pdf = await lib.PDFDocument.create();
  const font = await pdf.embedFont(lib.StandardFonts.Helvetica);
  for (let c = 0x20; c <= 0x2122; c += 1) {
    if (c === 0xa0 || c === 0xad) continue; // trocados por espaço / apagados antes
    const ch = String.fromCodePoint(c);
    let ok = true;
    try { font.encodeText(ch); } catch { ok = false; }
    assert.equal(D.winAnsiOk(ch), ok, `U+${c.toString(16)}`);
  }
});

test('quebra de linhas do PDF e número por extenso', () => {
  const m = (s) => s.length;
  assert.deepEqual(D.wrapText('um dois tres quatro', 9, m), ['um dois', 'tres', 'quatro']);
  assert.deepEqual(D.wrapText('linha1\n\nlinha2', 20, m), ['linha1', '', 'linha2']);
  assert.deepEqual(D.wrapText('abcdefghijkl', 5, m), ['abcde', 'fghij', 'kl']);
  assert.deepEqual([1, 2, 10, 15, 16, 21, 30, 45, 90, 100, 101, 999].map(D.extenso),
    ['um', 'dois', 'dez', 'quinze', 'dezesseis', 'vinte e um', 'trinta', 'quarenta e cinco', 'noventa', 'cem', 'cento e um', 'novecentos e noventa e nove']);
});

/* ======================= modelo do documento ======================= */
const PAYLOADS = {
  exames: { itens: [T.examFromCatalog('hemograma'), T.examFromCatalog('rx_torax', 'PA e perfil')], indicacao: 'Tosse persistente' },
  receita: { tipo: 'simples', vias: 1, itens: [{ ...RX, observacao: 'Se precisar' }], observacao: 'Voltar se piorar' },
  atestado: { dias: 3, inicio: '2026-10-30', fim: '2026-11-01', cid: 'J11.1', cid_autorizado: true, observacao: null },
  comparecimento: { data: '2026-10-30', hora_inicio: '14:05', data_fim: '2026-10-30', hora_fim: '14:30', observacao: null },
  encaminhamento: { especialidade: 'Cardiologia', motivo: 'Dor no peito aos esforços.', prioridade: 'urgente', observacao: null },
  relatorio: { texto: 'Tosse há 5 dias.\nSem febre.', cid: 'J11.1', cid_autorizado: true },
  orientacoes: { texto: 'Beber água.' },
};
const COMMON = ['Documento emitido em modalidade de telemedicina', 'Carla Mendes — CRM 123456/SP — RQE 7788 (Clínica médica)', 'Rua das Flores, 100, sala 2, São Paulo/SP',
  '(11) 3456-7890', 'Ana Maria da Silva', '529.982.247-25', '17/05/1980 (46 anos)', 'Rua A, 10, Centro, Recife/PE',
  'Teleconsulta de 30/10/2026, iniciada às 14:05. Emitido em 30/10/2026 às 14:31 (horário de Brasília).', 'ABCDE-2345K',
  `${SITE}documento.html`, 'Este documento só vale com a assinatura digital ICP-Brasil do(a) médico(a) no arquivo PDF. Confira a assinatura enviando o arquivo em validar.iti.gov.br.'];
const SPECIFIC = {
  exames: ['Solicito os exames abaixo:', 'Sangue', '1. Hemograma completo', '2. Raio-X de tórax (PA e perfil) — PA e perfil', 'Indicação clínica', 'Tosse persistente'],
  receita: ['Endereço residencial', 'Dipirona 500 mg, comprimido', 'Quantidade: 1 caixa com 20 comprimidos', 'Via oral. Modo de usar: Tomar 1 comprimido a cada 6 horas se tiver dor', 'Duração: 5 dias', 'Observação: Se precisar', 'Voltar se piorar'],
  atestado: ['Atesto, para os devidos fins, que Ana Maria da Silva, CPF 529.982.247-25, foi atendido(a) por mim em teleconsulta em 30/10/2026, às 14:05, e necessita afastar-se de suas atividades por 3 (três) dias, de 30/10/2026 a 01/11/2026, inclusive.', 'CID: J11.1 — incluído por solicitação e autorização expressa do(a) paciente.'],
  comparecimento: ['esteve em atendimento médico por teleconsulta no dia 30/10/2026, das 14:05 às 14:30 (horário de Brasília).', 'Esta declaração não recomenda afastamento do trabalho ou de outras atividades.'],
  encaminhamento: ['Encaminho Ana Maria da Silva para avaliação em Cardiologia.', 'Urgente', 'Dor no peito aos esforços.', 'Paciente avaliado(a) por teleconsulta, sem exame físico presencial.', 'Em caso de piora, procure o pronto-socorro mais próximo ou ligue 192 (SAMU).'],
  relatorio: ['Relatório referente à teleconsulta de 30/10/2026.', 'Tosse há 5 dias.', 'Sem febre.', 'CID: J11.1 — incluído por solicitação e autorização expressa do(a) paciente.'],
  orientacoes: ['Beber água.', 'Se piorar ou aparecer sinal de alerta: ligue 192 (SAMU) ou procure o pronto-socorro mais próximo.', 'Estas orientações não substituem receita, atestado ou pedido de exames.'],
};
test('modelo: todo documento tem os dados obrigatórios do médico, do paciente, da teleconsulta e da conferência', () => {
  for (const k of D.KINDS) {
    const m = D.docModel(doc(k.id, PAYLOADS[k.id]), { site: SITE, consult: CONSULT });
    const text = modelText(m);
    for (const s of [...COMMON, ...SPECIFIC[k.id]]) assert.ok(text.includes(s), `${k.id}: ${s}`);
    assert.equal(m.url, `${SITE}documento.html?c=ABCDE2345K`);
    if (k.id !== 'receita') assert.ok(text.includes('Endereço ou local informado'), k.id);
  }
  // Sem CPF (o médico registrou "não possui"), consulta pedida por outra pessoa e menor de idade.
  const m = D.docModel(doc('atestado', PAYLOADS.atestado, { patient_snapshot: { ...PATIENT, cpf: null, sem_cpf: true, age: 9, for_other: true, requester_name: 'Joana Silva', relationship: 'Mãe' } }), { site: SITE, consult: CONSULT });
  const t = modelText(m);
  assert.ok(t.includes('Atesto, para os devidos fins, que Ana Maria da Silva (não possui CPF) foi atendido(a) por mim em teleconsulta em 30/10/2026'), t);
  assert.ok(!t.includes('CPF não possui CPF'), 'sem "CPF não possui CPF"');
  assert.ok(m.patient.some(([a, b]) => a === 'CPF' && b === 'não possui CPF'));
  const dec = modelText(D.docModel(doc('comparecimento', PAYLOADS.comparecimento, { patient_snapshot: { ...PATIENT, cpf: null, sem_cpf: true } }), { site: SITE, consult: CONSULT }));
  assert.ok(dec.includes('que Ana Maria da Silva (não possui CPF) esteve em atendimento médico'), dec);
  // CPF vazio sem a declaração (não deveria sair do banco): não escreve "não possui CPF".
  const blank = modelText(D.docModel(doc('atestado', PAYLOADS.atestado, { patient_snapshot: { ...PATIENT, cpf: null, sem_cpf: false } }), { site: SITE, consult: CONSULT }));
  assert.ok(!blank.includes('não possui CPF') && blank.includes('que Ana Maria da Silva foi atendido(a)'));
  assert.ok(m.patient.some(([a, b]) => a === 'Responsável legal presente' && b === 'Joana Silva (Mãe)'));
  // Consulta que passou da meia-noite, receita sem via e documento sem início de atendimento (nunca "iniciada às" do aceite).
  const night = modelText(D.docModel(doc('comparecimento', { ...PAYLOADS.comparecimento, data: '2026-10-30', hora_inicio: '23:50', data_fim: '2026-10-31', hora_fim: '00:20' }), { site: SITE, consult: CONSULT }));
  assert.ok(night.includes('esteve em atendimento médico por teleconsulta de 30/10/2026, às 23:50, a 31/10/2026, às 00:20 (horário de Brasília).'), night);
  const noVia = modelText(D.docModel(doc('receita', { ...PAYLOADS.receita, itens: [{ ...RX, via: '' }] }), { site: SITE, consult: CONSULT }));
  assert.ok(noVia.includes('Modo de usar: Tomar 1') && !noVia.includes('Via .'));
  const noStart = D.docModel(doc('relatorio', PAYLOADS.relatorio, { patient_snapshot: { ...PATIENT, inicio_atendimento: null } }), { site: SITE, consult: { ...CONSULT, started_at: null } });
  assert.ok(!noStart.when.includes('iniciada às') && !modelText(noStart).includes('Relatório referente'), noStart.when);
  const adult = D.docModel(doc('comparecimento', PAYLOADS.comparecimento, { patient_snapshot: { ...PATIENT, for_other: true, requester_name: 'Pedro Silva', relationship: 'Filho ou filha' } }), { site: SITE, consult: CONSULT });
  assert.ok(adult.patient.some(([a]) => a === 'Consulta pedida por'));
  assert.ok(modelText(adult).includes('Acompanhado(a) por Pedro Silva (Filho ou filha).'));
  // Especialidade só com RQE; 1 dia de atestado; documento cancelado sem conteúdo.
  const noRqe = D.docModel(doc('atestado', { ...PAYLOADS.atestado, dias: 1, fim: '2026-10-30', cid: null }, { doctor_snapshot: { ...DOCTOR, rqe: null, specialty: null } }), { site: SITE, consult: CONSULT });
  assert.ok(modelText(noRqe).includes('Carla Mendes — CRM 123456/SP\n'));
  assert.ok(modelText(noRqe).includes('por 1 (um) dia, em 30/10/2026.'));
  assert.equal(noRqe.specialty, '');
  const canc = D.docModel(doc('receita', null, { status: 'cancelado', cancelled_at: '2026-10-30T18:00:00Z' }), { site: SITE, consult: CONSULT });
  assert.ok(modelText(canc).includes('Documento cancelado: o conteúdo não é mostrado.'));
});

test('metadados do PDF: tipo de documento de saúde e CRM, UF e especialidade do médico (ITI)', () => {
  const info = D.pdfInfo(D.docModel(doc('receita', PAYLOADS.receita), { site: SITE, consult: CONSULT }));
  assert.deepEqual(info.oids, [['2.16.76.1.12.1.1', ''], ['2.16.76.1.4.2.2.1', '123456'], ['2.16.76.1.4.2.2.2', 'SP'], ['2.16.76.1.4.2.2.3', 'Clínica médica']]);
  assert.equal(info.title, 'Receita ABCDE-2345K');
  assert.equal(info.subject, 'Documento "Receita" emitido em teleconsulta (telemedicina) pelo IMED. Código de conferência ABCDE-2345K.');
  assert.equal(info.code, 'ABCDE2345K');
  const enc = D.pdfInfo(D.docModel(doc('encaminhamento', PAYLOADS.encaminhamento, { doctor_snapshot: { ...DOCTOR, rqe: null, specialty: null } }), { site: SITE, consult: CONSULT }));
  assert.deepEqual(enc.oids, [['2.16.76.1.4.2.2.1', '123456'], ['2.16.76.1.4.2.2.2', 'SP']], 'sem código de tipo confirmado e sem especialidade sem RQE');
  assert.equal(D.pdfFileName({ kind: 'atestado', codeText: 'ABCDE-2345K' }, true), 'IMED-atestado-ABCDE-2345K-assinado.pdf');
});

test('pré-visualização: tudo escapado, marca de rascunho e de cancelado', () => {
  const evil = { ...PATIENT, name: '<img src=x onerror=alert(1)> Ana' };
  const m = D.docModel(doc('relatorio', { texto: '<script>alert(1)</script>\nLinha 2' }, { patient_snapshot: evil, doctor_snapshot: { ...DOCTOR, full_name: 'Carla <b>Mendes</b>' } }), { site: SITE, consult: CONSULT });
  const html = D.docHtml(m, { mark: 'draft' });
  assert.ok(!html.includes('<script>') && !html.includes('<img') && !html.includes('<b>Mendes'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('RASCUNHO SEM ASSINATURA — NÃO VALE COMO DOCUMENTO OFICIAL'));
  assert.ok(html.includes('td-mark-draft'));
  assert.ok(html.includes('Código do documento: <b>ABCDE-2345K</b>'));
  const c = D.docHtml(D.docModel(doc('atestado', null, { status: 'cancelado', cancelled_at: '2026-10-30T18:00:00Z' }), { site: SITE, consult: CONSULT }), { mark: 'cancel' });
  assert.ok(c.includes('DOCUMENTO CANCELADO EM 30/10/2026 — NÃO UTILIZAR'));
  const clean = D.docHtml(D.docModel(doc('atestado', PAYLOADS.atestado), { site: SITE, consult: CONSULT }));
  assert.ok(!clean.includes('RASCUNHO') && !clean.includes('td-mark'), 'versão para assinar sem marca');
  const draft = D.docHtml(D.docModel({ ...doc('orientacoes', PAYLOADS.orientacoes), code: null }, { site: SITE, consult: CONSULT }));
  assert.ok(draft.includes('O código de conferência aparece ao emitir.'));
});

test('QR: matriz do qrcode-generator, caminho SVG com as linhas juntas e SVG acessível', async () => {
  const qrcode = await D.loadQrLib();
  const mtx = D.qrMatrix(`${SITE}documento.html?c=ABCDE2345K`, qrcode);
  assert.ok(mtx.n >= 21 && mtx.n % 4 === 1, `tamanho ${mtx.n}`);
  assert.equal(mtx.rows.length, mtx.n);
  assert.equal(mtx.rows[0].slice(0, 7).every(Boolean), true, 'marcador de canto');
  const path = D.qrPath(mtx);
  const dark = mtx.rows.flat().filter(Boolean).length;
  const widths = [...path.matchAll(/h(\d+)v1/g)].reduce((s, x) => s + Number(x[1]), 0);
  assert.equal(widths, dark, 'o caminho cobre exatamente os módulos escuros');
  const svg = D.qrSvg(mtx, 'QR <x>');
  assert.match(svg, /role="img" aria-label="QR &lt;x&gt;"/);
});

/* ======================= PDF de verdade ======================= */
const CP1252 = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };
// Texto de cada página: junta as strings (hexadecimais, Windows-1252) dos comandos Tj.
async function pdfTexts(bytes, lib) {
  const pdf = await lib.PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const c = page.node.Contents();
    const streams = c instanceof lib.PDFArray ? c.asArray().map((r) => pdf.context.lookup(r)) : [c];
    const ops = streams.map((st) => Buffer.from(lib.decodePDFRawStream(st).decode()).toString('latin1')).join('\n');
    return [...ops.matchAll(/<([0-9A-Fa-f]*)> Tj/g)].map((m) => Buffer.from(m[1], 'hex')).map((b) => [...b].map((x) => CP1252[x] || String.fromCharCode(x)).join('')).join('\n');
  });
}
test('PDF: A4 com os textos obrigatórios, o código, o QR e os metadados de documento de saúde do ITI', async () => {
  const lib = await D.loadPdfLib();
  const qrcode = await D.loadQrLib();
  for (const k of D.KINDS) {
    const m = D.docModel(doc(k.id, PAYLOADS[k.id]), { site: SITE, consult: CONSULT });
    const bytes = await D.buildPdf(m, { lib, qrcode, now: new Date('2026-10-30T17:32:00Z') });
    const raw = Buffer.from(bytes).toString('latin1');
    assert.ok(raw.startsWith('%PDF-') && raw.trimEnd().endsWith('%%EOF'), k.id);
    const pdf = await lib.PDFDocument.load(bytes);
    const [w, h] = [pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()];
    assert.ok(Math.abs(w - 595.28) < 0.5 && Math.abs(h - 841.89) < 0.5, `${k.id}: A4 (${w}x${h})`);
    const text = (await pdfTexts(bytes, lib)).join('\n');
    for (const s of ['IMED · TELECONSULTA', m.title, 'Documento emitido em modalidade de telemedicina', 'Carla Mendes — CRM 123456/SP — RQE 7788 (Clínica médica)', '529.982.247-25',
      'Rua das Flores, 100, sala 2, São Paulo/SP', '(11) 3456-7890', 'Código do documento: ABCDE-2345K', 'Assinatura digital do(a) médico(a) (ICP-Brasil)', 'Página 1 de 1']) {
      assert.ok(text.includes(s), `${k.id}: ${s}`);
    }
    assert.ok(text.replace(/\n/g, ' ').includes('Este documento só vale com a assinatura digital ICP-Brasil do(a) médico(a) no arquivo PDF.'), `${k.id}: validade`);
    // Metadados (dicionário Info): título, código em texto simples e os OIDs.
    const info = pdf.getInfoDict();
    const get = (key) => info.get(lib.PDFName.of(key));
    assert.equal(pdf.getTitle(), `${m.title} ABCDE-2345K`);
    assert.equal(get('IMEDCodigo').decodeText(), 'ABCDE2345K');
    assert.ok(raw.includes('ABCDE2345K'), 'código legível no arquivo (para conferir o PDF assinado)');
    assert.equal(get('2.16.76.1.4.2.2.1').decodeText(), '123456');
    assert.equal(get('2.16.76.1.4.2.2.2').decodeText(), 'SP');
    assert.equal(get('2.16.76.1.4.2.2.3').decodeText(), 'Clínica médica');
    if (k.oid) assert.equal(get(k.oid).decodeText(), '', `${k.id}: tipo ${k.oid}`);
    for (const other of D.KINDS.filter((x) => x.oid && x.id !== k.id)) assert.equal(get(other.oid), undefined, `${k.id} sem ${other.oid}`);
    // QR: o caminho do PDF fecha um trecho (h) por sequência de módulos escuros do QR do endereço de conferência.
    const runs = (D.qrPath(D.qrMatrix(m.url, qrcode)).match(/z/g) || []).length;
    const last = pdf.getPages().at(-1).node.Contents();
    const ops = Buffer.from(lib.decodePDFRawStream(last instanceof lib.PDFArray ? pdf.context.lookup(last.get(0)) : last).decode()).toString('latin1');
    assert.equal((ops.match(/^h$/gm) || []).length, runs + 1, `${k.id}: QR desenhado (+1: o retângulo da assinatura)`);
  }
});

test('PDF: texto longo vai para a página 2, com o rodapé e o código em todas', async () => {
  const lib = await D.loadPdfLib();
  const qrcode = await D.loadQrLib();
  const long = Array.from({ length: 70 }, (_, i) => `Linha ${i + 1} do relatório com um texto de exemplo que ocupa boa parte da largura da página.`).join('\n');
  const m = D.docModel(doc('relatorio', { texto: long.slice(0, 4000) }), { site: SITE, consult: CONSULT });
  const pages = await pdfTexts(await D.buildPdf(m, { lib, qrcode }), lib);
  assert.ok(pages.length >= 2, `${pages.length} páginas`);
  pages.forEach((p, i) => {
    assert.ok(p.includes(`Página ${i + 1} de ${pages.length}`));
    assert.ok(p.includes('Código ABCDE-2345K'));
  });
  assert.ok(pages[1].includes('Relatório médico (continuação)'));
  assert.ok(pages.at(-1).includes('Código do documento: ABCDE-2345K'), 'código e QR no fim');
});

/* ======================= PDF enviado pelo médico ======================= */
test('PDF assinado enviado: confere PDF, fim do arquivo, campo de assinatura, tamanho e o código', async () => {
  const lib = await D.loadPdfLib();
  const qrcode = await D.loadQrLib();
  const bytes = await D.buildPdf(D.docModel(doc('atestado', PAYLOADS.atestado), { site: SITE, consult: CONSULT }), { lib, qrcode });
  assert.deepEqual(D.checkSignedPdf(bytes, 'ABCDE2345K'), { ok: false, error: 'sem_assinatura' });
  const sign = (sub = '/ETSI.CAdES.detached', contents = '3082') => new Uint8Array([...bytes, ...Buffer.from(`\n% assinatura /SubFilter ${sub} /ByteRange [0 1 2 3] /Contents <${contents}>\n%%EOF\n`)]);
  const signed = sign();
  assert.deepEqual(D.checkSignedPdf(signed, 'ABCDE2345K'), { ok: true, error: null, icp: false });
  assert.equal(D.checkSignedPdf(sign('/x.desconhecido'), 'ABCDE2345K').error, 'assinatura_desconhecida');
  assert.equal(D.checkSignedPdf(sign('/adbe.pkcs7.detached'), 'ABCDE2345K').ok, true);
  // PDF de outro documento (sem este código): recusado, sem "enviar mesmo assim".
  assert.equal(D.checkSignedPdf(signed, 'ZZZZZ2345K').error, 'outro_documento');
  // "ICP-Brasil" dentro da assinatura (hexadecimal): sem ele, só um aviso (pode ser gov.br).
  assert.equal(D.checkSignedPdf(sign('/ETSI.CAdES.detached', Buffer.from('O=ICP-Brasil').toString('hex')), 'ABCDE2345K').icp, true);
  assert.equal(D.checkSignedPdf(sign('/ETSI.CAdES.detached', Buffer.from('O=ICP-Brasil').toString('hex').toUpperCase()), 'ABCDE2345K').icp, true);
  assert.match(D.ICP_WARN, /gov\.br/);
  assert.equal(D.checkSignedPdf(Buffer.from('não é PDF /ByteRange %%EOF')).error, 'nao_pdf');
  assert.equal(D.checkSignedPdf(Buffer.from('%PDF-1.7 /ByteRange sem fim')).error, 'nao_pdf');
  assert.equal(D.checkSignedPdf(new Uint8Array(D.MAX_PDF_BYTES + 1)).error, 'grande');
  assert.equal(D.checkSignedPdf(new Uint8Array()).error, 'vazio');
  for (const k of ['vazio', 'grande', 'nao_pdf', 'sem_assinatura', 'assinatura_desconhecida', 'outro_documento']) assert.ok(D.UPLOAD_TEXT[k].length > 20, k);
  const back = D.fromBase64(D.toBase64(signed));
  assert.deepEqual([...back], [...signed], 'base64 de ida e volta');
});

/* ======================= situação, prazos e erros ======================= */
test('situação do documento e prazos (emitir até 24 h depois de encerrar; enviar PDF até 7 dias)', () => {
  const now = Date.parse('2026-10-30T18:00:00Z');
  const draft = D.docStatus({ status: 'emitido', signed: false, created_at: '2026-10-30T17:31:00Z' }, now);
  assert.equal(draft.label, 'Rascunho sem assinatura');
  assert.match(draft.long, /não vale como documento oficial/);
  assert.match(draft.long, /Aguardando a assinatura do médico \(até 06\/11\/2026 às 14:31\)/);
  // O IMED não diz que a assinatura vale: "PDF assinado enviado" e manda conferir no ITI.
  const signed = D.docStatus({ status: 'emitido', signed: true, signed_at: '2026-10-30T18:00:00Z' }, now);
  assert.equal(signed.label, 'PDF assinado enviado');
  assert.match(signed.long, /validar\.iti\.gov\.br/);
  assert.ok(!/Assinado pelo médico|É ele que vale/.test(`${signed.label} ${signed.long}`));
  // Passou de 7 dias sem o PDF assinado: o rascunho não vale e o paciente não fica esperando.
  const late = D.docStatus({ status: 'emitido', signed: false, created_at: '2026-10-23T17:59:00Z' }, now);
  assert.deepEqual([late.id, late.label], ['vencido', 'Não assinado (prazo encerrado)']);
  assert.match(late.long, /não vale/);
  assert.equal(D.docStatus({ status: 'cancelado', signed: true }).id, 'cancelado');
  assert.equal(D.signDeadline({ created_at: '2026-10-30T17:31:00Z' }), '2026-11-06T17:31:00.000Z');
  assert.equal(D.canUpload({ status: 'emitido', created_at: '2026-10-24T18:00:01Z' }, now), true);
  assert.equal(D.canUpload({ status: 'emitido', created_at: '2026-10-23T18:00:00Z' }, now), false);
  assert.equal(D.canUpload({ status: 'emitido', created_at: '2026-10-30T17:00:00Z', signed: true }, now), false, 'um PDF por documento');
  assert.equal(D.canUpload({ status: 'cancelado', created_at: '2026-10-30T17:00:00Z' }, now), false);
  // Emitir: só com o atendimento começado (started_at), nunca só com o aceite.
  assert.equal(D.canEmit({ status: 'in_call', started_at: '2026-10-30T17:05:00Z' }, now), true);
  assert.equal(D.canEmit({ status: 'accepted', accepted_at: '2026-10-30T17:55:00Z', started_at: null }, now), false);
  assert.equal(D.canEmit({ status: 'accepted', started_at: '2026-10-30T17:56:00Z' }, now), true, 'aceita e já ligou ou mandou mensagem');
  assert.equal(D.canEmit({ status: 'ended', started_at: '2026-10-29T17:00:00Z', ended_at: '2026-10-29T18:00:01Z' }, now), true);
  assert.equal(D.canEmit({ status: 'ended', started_at: '2026-10-29T17:00:00Z', ended_at: '2026-10-29T17:59:00Z' }, now), false);
  assert.equal(D.canEmit({ status: 'ended', started_at: null, ended_at: '2026-10-30T17:59:00Z' }, now), false, 'desistiu ou expirou antes de começar e foi registrada');
  assert.equal(D.canEmit({ status: 'expired' }, now), false);
});

test('erros do banco viram textos simples (com o campo e o item da receita)', () => {
  const pg = (message, details = null, hint = null) => Object.assign(new Error(message), { status: 400, data: { code: 'P0001', message, details, hint } });
  assert.deepEqual(D.docError(pg('receita_bloqueada', 'sncr')), { code: 'receita_bloqueada', details: 'sncr', hint: null });
  assert.match(D.docErrorText(D.docError(pg('receita_bloqueada', 'sncr'))), /SNCR/);
  assert.match(D.docErrorText(D.docError(pg('receita_bloqueada', 'notificacao'))), /azul ou amarela/);
  assert.match(D.docErrorText(D.docError(pg('perfil_incompleto', 'contato'))), /telefone ou e-mail/);
  assert.match(D.docErrorText(D.docError(pg('perfil_incompleto', 'endereco'))), /endereço profissional/);
  assert.match(D.docErrorText(D.docError(pg('paciente_incompleto', 'endereco'))), /cidade\/UF/);
  assert.match(D.docErrorText(D.docError(pg('cid_sem_autorizacao'))), /autorização expressa/);
  assert.match(D.docErrorText(D.docError(pg('limite_documentos'))), /30/);
  assert.match(D.docErrorText(D.docError(pg('pdf_sem_assinatura'))), /ICP-Brasil/);
  assert.match(D.docErrorText(D.docError(pg('pdf_sem_assinatura', 'subfilter'))), /PAdES/);
  assert.match(D.docErrorText(D.docError(pg('pdf_outro_documento', 'codigo'))), /não é deste documento/);
  assert.match(D.docErrorText(D.docError(pg('ja_assinado'))), /não pode ser trocado/);
  assert.match(D.docErrorText(D.docError(pg('atendimento_nao_iniciado'))), /ainda não começou/);
  assert.match(D.docErrorText(D.docError(pg('consulta_nao_encerrada'))), /depois de encerrar/);
  assert.match(D.docErrorText(D.docError(pg('sem_conferencia_identidade'))), /documento com foto/);
  assert.match(D.docErrorText(D.docError(pg('dados_paciente_mudaram'))), /atualizou o CPF ou o endereço/);
  assert.match(D.docErrorText(D.docError(pg('paciente_incompleto', 'cpf'))), /não possui CPF/);
  assert.match(D.docErrorText(D.docError(pg('dados_invalidos', 'hora_inicio'))), /não podem ser digitados/);
  assert.match(D.docErrorText(D.docError(pg('dados_invalidos', 'endereco_residencial'))), /residencial/);
  for (const c of ['atendimento_nao_iniciado', 'consulta_nao_encerrada', 'sem_conferencia_identidade', 'dados_paciente_mudaram', 'pdf_outro_documento', 'ja_assinado']) {
    assert.equal(T.errorInfo(pg(c)).code, c, `erro conhecido: ${c}`);
    assert.ok(DOCS_SQL.includes(`'${c}'`), `erro do banco: ${c}`);
  }
  assert.match(D.docErrorText(D.docError(pg('documento_cancelado'))), /cancelado/);
  assert.match(D.docErrorText(D.docError(pg('prazo_encerrado')), 'enviar'), /7 dias/);
  assert.ok(!/se ainda der|se a consulta ainda estiver no prazo/.test(D.docErrorText(D.docError(pg('prazo_encerrado')), 'enviar')), 'não promete emitir de novo depois de 7 dias');
  assert.match(D.docErrorText(D.docError(pg('prazo_encerrado')), 'emitir'), /24 horas/);
  assert.match(D.docErrorText(D.docError(pg('dados_invalidos', 'posologia', 'item 2'))), /^Item 2: o modo de usar/);
  assert.match(D.docErrorText(D.docError(pg('dados_invalidos', 'endereco')), 'perfil'), /profissional/);
  assert.match(D.docErrorText(D.docError(pg('dados_invalidos', 'motivo')), 'cancelar'), /cancelamento/);
  assert.match(D.docErrorText(D.docError(pg('dados_invalidos', 'pdf_tamanho')), 'enviar'), /3 MB/);
  assert.equal(T.errorInfo(pg('nao_leitor')).code, 'nao_leitor', 'erro novo conhecido em tele-core');
  assert.match(D.docErrorText({ code: 'rede' }), /internet/);
});

test('PDF: metadados com "(", ")" e "\\" na especialidade continuam válidos (dicionário Info e códigos do ITI)', async () => {
  const lib = await D.loadPdfLib();
  const qrcode = await D.loadQrLib();
  for (const spec of ['Pediatria)', 'Clinica) /Foo (x', 'Barra \\ invertida (e parênteses']) {
    const m = D.docModel(doc('atestado', PAYLOADS.atestado, { doctor_snapshot: { ...DOCTOR, specialty: spec } }), { site: SITE, consult: CONSULT });
    const pdf = await lib.PDFDocument.load(await D.buildPdf(m, { lib, qrcode }));
    const info = pdf.getInfoDict();
    const get = (k) => info.get(lib.PDFName.of(k))?.decodeText();
    assert.equal(get('2.16.76.1.4.2.2.3'), spec, `especialidade: ${spec}`);
    assert.equal(get('2.16.76.1.12.1.2'), '', 'tipo do documento');
    assert.equal(get('IMEDCodigo'), 'ABCDE2345K');
    assert.equal(info.get(lib.PDFName.of('Foo')), undefined, 'nenhuma chave nova entra no dicionário');
    assert.equal(pdf.getTitle(), 'Atestado médico ABCDE-2345K');
  }
});

test('termo (TCLE): a migração de documentos recria tele_request igual à da teleconsulta, só com a versão nova', () => {
  const fn = (sql) => sql.slice(sql.indexOf('create or replace function public.tele_request('), sql.indexOf('end $$;', sql.indexOf('create or replace function public.tele_request(')) + 7);
  const base = fn(TELE_SQL);
  const novo = fn(DOCS_SQL);
  assert.ok(base.length > 3000 && novo.length > 3000);
  assert.equal(novo, base.replace("v_version not in ('2026-10-30')", "v_version not in ('2026-10-30', '2026-10-30.2')"));
  assert.ok(novo.includes(`'${T.TCLE_VERSION}'`), 'a versão do site é aceita');
  assert.match(DOCS_SQL, /grant execute on function public\.tele_request\(text, date, text, text, text\[\], boolean, text, text, boolean, boolean, text, text, boolean\) to anon, authenticated;/);
});
