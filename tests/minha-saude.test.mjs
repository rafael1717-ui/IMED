// "Minha Saúde", etapa 1: as regras da página (minha-saude-core.js) e o que elas têm de combinar com o banco
// (migração ws_minha_saude) e com o que a página promete. Rodar com: node --test tests/minha-saude.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../assets/js/minha-saude-core.js';
import { KINDS } from '../assets/js/tele-docs.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const MIG = read(`supabase/migrations/${readdirSync(join(ROOT, 'supabase/migrations')).find((f) => f.endsWith('_ws_minha_saude.sql'))}`);
const C1 = 'c1111111-1111-4111-8111-111111111111';
const C2 = 'c2222222-2222-4222-8222-222222222222';
const D1 = 'd1111111-1111-4111-8111-111111111111';

test('consultas: a situação e o médico em palavras; nada inventado quando o banco não manda', () => {
  assert.deepEqual(['waiting', 'accepted', 'in_call', 'ended', 'cancelled', 'expired', 'outra'].map(M.situacaoTexto),
    ['Na fila', 'Médico a caminho', 'Em andamento', 'Encerrada', 'Cancelada', 'Não atendida', '']);
  assert.deepEqual(['waiting', 'accepted', 'in_call', 'ended'].map(M.emAndamento), [true, true, true, false]);
  assert.equal(M.medicoTexto({ name: 'Dra. Ana  Lima', crm: '123456', crm_uf: 'sp' }), 'Dra. Ana Lima · CRM-SP 123456');
  assert.equal(M.medicoTexto({ full_name: 'Dr. Beto', crm: '9' }), 'Dr. Beto · CRM 9', 'a teleconsulta manda full_name');
  assert.equal(M.medicoTexto({ name: 'Dra. Só Nome' }), 'Dra. Só Nome');
  for (const v of [null, {}, { crm: '1' }, { name: '   ' }]) assert.equal(M.medicoTexto(v), '', 'sem nome, nada');
  assert.equal(M.tituloConsulta({ fim: '2026-11-12T14:30:00Z', inicio: '2026-11-12T14:00:00Z' }), 'Teleconsulta de 12/11/2026');
  assert.equal(M.tituloConsulta({ inicio: '2026-11-13T02:30:00Z' }), 'Teleconsulta de 12/11/2026', 'o dia é o de Brasília');
  assert.equal(M.tituloConsulta({}), 'Teleconsulta');
});

test('normalizeConta: só o que identifica a consulta; resposta estranha = nada', () => {
  for (const ruim of [null, 'x', [], { status: 'forbidden' }, { items: [] }]) assert.equal(M.normalizeConta(ruim), null);
  const d = M.normalizeConta({ status: 'ok', can_save: true, recent: 'sim', items: [
    { consultation_id: C1, saved_at: '2026-11-13T18:00:00Z', consultation_status: 'ended', created_at: '2026-11-12T14:00:00Z', ended_at: '2026-11-12T14:30:00Z',
      doctor: { name: 'Dra. Ana', crm: '1', crm_uf: 'SP' }, documents: 2, notes: 'anotação reservada', patient_name: 'Nome' },
    { consultation_id: 'não é id' }, null, { consultation_id: C2, documents: -1 }] });
  assert.equal(d.podeGuardar, true);
  assert.equal(d.recente, false, 'só o verdadeiro de verdade conta como entrada recente');
  assert.deepEqual(d.itens, [
    { id: C1, status: 'ended', inicio: '2026-11-12T14:00:00Z', fim: '2026-11-12T14:30:00Z', guardadaEm: '2026-11-13T18:00:00Z', medico: 'Dra. Ana · CRM-SP 1', documentos: 2 },
    { id: C2, status: '', inicio: null, fim: null, guardadaEm: null, medico: '', documentos: null },
  ], 'campo a mais na resposta (anotação, nome) não passa para a tela');
});

test('juntar: cada consulta uma vez, dizendo onde está; as mais novas primeiro', () => {
  const ap = [M.consultaDoAparelho({ id: C1, token: 'x' }, { status: 'ended', created_at: '2026-11-05T13:00:00Z', ended_at: '2026-11-05T13:20:00Z', doctor: { full_name: 'Dr. Beto', crm: '2', crm_uf: 'RJ' } })];
  const ct = [{ id: C1, status: 'ended', inicio: '2026-11-05T13:00:00Z', fim: '2026-11-05T13:20:00Z', guardadaEm: '2026-11-06T10:00:00Z', medico: '', documentos: 1 },
    { id: C2, status: 'ended', inicio: '2026-11-12T14:00:00Z', fim: '2026-11-12T14:30:00Z', guardadaEm: '2026-11-13T10:00:00Z', medico: 'Dra. Ana', documentos: 0 }];
  const j = M.juntarConsultas(ap, ct);
  assert.deepEqual(j.map((c) => [c.id, c.noAparelho, c.naConta, c.documentos, c.medico]), [[C2, false, true, 0, 'Dra. Ana'], [C1, true, true, 1, 'Dr. Beto · CRM-RJ 2']],
    'o que a conta não sabe (o médico) fica com o que o aparelho sabe; o que só a conta sabe (documentos) entra');
  assert.deepEqual(M.juntarConsultas(ap, null).map((c) => [c.noAparelho, c.naConta]), [[true, false]]);
  assert.deepEqual(M.juntarConsultas(null, undefined), []);
  assert.equal(M.consultaDoAparelho({ id: C1 }, null), null, 'código do aparelho que o banco não reconhece: a consulta não aparece');
  assert.equal(M.consultaDoAparelho({ id: 'x' }, {}), null);
});

test('guardar na conta: só logado, ligado, neste aparelho, ainda não guardada e com a consulta terminada', () => {
  const c = { id: C1, status: 'ended', noAparelho: true, naConta: false };
  assert.equal(M.podeGuardar(c, { logado: true, ligado: true }), true);
  for (const [cc, ctx] of [[c, { logado: false, ligado: true }], [c, { logado: true, ligado: false }], [{ ...c, naConta: true }, { logado: true, ligado: true }],
    [{ ...c, noAparelho: false }, { logado: true, ligado: true }], [{ ...c, status: 'in_call' }, { logado: true, ligado: true }], [null, { logado: true, ligado: true }]]) {
    assert.equal(M.podeGuardar(cc, ctx), false);
  }
  // a explicação: sem entrar a tela não promete nem nega (não dá para saber se está ligado)
  assert.equal(M.porQueNaoGuarda(c, { logado: false, ligado: false, temFuncoes: true }), '');
  assert.match(M.porQueNaoGuarda(c, { logado: true, ligado: false, temFuncoes: true }), /ainda não está disponível/);
  assert.match(M.porQueNaoGuarda(c, { logado: true, ligado: true, temFuncoes: false }), /ainda não está disponível/);
  assert.match(M.porQueNaoGuarda({ ...c, status: 'in_call' }, { logado: true, ligado: true, temFuncoes: true }), /Depois que a consulta terminar/);
  assert.equal(M.porQueNaoGuarda(c, { logado: true, ligado: true, temFuncoes: true }), '');
  assert.equal(M.porQueNaoGuarda({ ...c, naConta: true }, { logado: true, ligado: false, temFuncoes: true }), '');
});

test('documentos: o título de cada tipo, a situação por extenso e nunca "assinado" sem a assinatura', () => {
  const base = { id: D1, kind: 'receita', code: '2222233333', created_at: '2026-11-12T14:20:00Z' };
  const assinado = M.normalizeDocumento({ ...base, document_status: 'emitido', signed: true, signed_at: '2026-11-12T14:40:00Z', has_pdf: true, payload: { x: 'reservado' } });
  assert.deepEqual(assinado, { id: D1, kind: 'receita', titulo: 'Receita', cancelado: false, motivo: '', emitidoEm: '2026-11-12T14:20:00Z', assinadoEm: '2026-11-12T14:40:00Z',
    codigo: '22222-33333', conferir: 'documento.html?c=2222233333', baixa: true }, 'o conteúdo do documento (payload) não entra');
  assert.equal(M.situacaoDocumento(assinado), 'Assinado pelo médico em 12/11/2026 às 11:40');
  const semAss = M.normalizeDocumento({ ...base, status: 'emitido', signed: false });
  assert.equal(semAss.baixa, false);
  assert.match(M.situacaoDocumento(semAss), /^Aguardando a assinatura do médico\. Sem a assinatura, o documento ainda não vale\./);
  // assinado mas o banco diz que ainda não tem o arquivo: não oferece baixar nem diz "assinado"
  const semArquivo = M.normalizeDocumento({ ...base, document_status: 'emitido', signed: true, signed_at: '2026-11-12T14:40:00Z', has_pdf: false });
  assert.equal(semArquivo.baixa, false);
  assert.doesNotMatch(M.situacaoDocumento(semArquivo), /^Assinado/);
  const cancelado = M.normalizeDocumento({ ...base, document_status: 'cancelado', cancel_reason: 'emitido por engano', signed: true, has_pdf: true });
  assert.equal(cancelado.baixa, false, 'cancelado não se baixa');
  assert.equal(M.situacaoDocumento(cancelado), 'Cancelado pelo médico: emitido por engano');
  for (const ruim of [null, {}, { ...base, kind: 'tipo_novo', status: 'emitido' }, { ...base, id: 'x', status: 'emitido' }, { ...base, status: 'rascunho' }]) assert.equal(M.normalizeDocumento(ruim), null);
  assert.deepEqual(M.normalizeDocumentos([base, { ...base, status: 'emitido' }, null]).length, 1);
  // todo tipo de documento que o banco aceita tem título
  const tipos = [...MIG.matchAll(/'id', d\.id, 'kind', d\.kind/g)].length;
  assert.equal(tipos, 1);
  for (const k of KINDS) assert.equal(M.normalizeDocumento({ ...base, kind: k.id, status: 'emitido' }).titulo, k.title);
});

test('respostas do banco: cada recusa tem a sua frase; resposta desconhecida não vira sucesso', () => {
  const doBanco = [...new Set([...MIG.matchAll(/jsonb_build_object\('status', '([a-z_]+)'/g)].map((m) => m[1]))].filter((s) => s !== 'ok').sort();
  assert.deepEqual(doBanco, ['already_linked', 'cancelled', 'forbidden', 'invalid', 'no_pdf', 'not_found', 'off', 'reauth', 'too_many']);
  for (const s of doBanco) assert.notEqual(M.respostaTexto(s), M.respostaTexto('qualquer'), `${s} tem frase própria`);
  assert.match(M.respostaTexto('reauth'), /menos de 12 horas/);
  assert.match(MIG, /private\.saude_entrada_recente\(12\)/, 'as 12 horas da frase são as do banco');
  assert.match(M.respostaTexto('too_many'), /Espere uma hora/);
  assert.match(MIG, /if v_erros >= 10 then/);
  assert.equal(M.respostaTexto(undefined), 'Não foi possível concluir agora. Confira a internet e tente de novo.');
});

test('agendamentos deste aparelho: onde, quando (no fuso da clínica) e o código; a situação fica em Minha conta', () => {
  const lista = M.agendamentosDoAparelho([
    { type: 'pedido', id: C1, code: 'IMED-C1111111', name: ' Clínica  Boa Imagem ', slot: '2026-11-20T13:00:00.000Z', tz: 'America/Sao_Paulo', status: 'confirmado', token: 'segredo' },
    { type: 'pedido', id: C2, name: 'Clínica de Manaus', slot: '2026-11-20T13:00:00.000Z', tz: 'America/Manaus' },
    { type: 'pedido', name: 'Sem id', date: '2026-11-25' }, { type: 'pedido', id: C1 }, null, 'x']);
  assert.deepEqual(lista, [
    { id: C1, local: 'Clínica Boa Imagem', quando: '20/11/2026 às 10:00', codigo: 'IMED-C1111111', link: `conta.html#pedido-${C1}` },
    { id: C2, local: 'Clínica de Manaus', quando: '20/11/2026 às 09:00 (horário da clínica)', codigo: 'IMED-C2222222', link: `conta.html#pedido-${C2}` },
    { id: '', local: 'Sem id', quando: '25/11/2026 (data preferida)', codigo: '', link: 'conta.html' },
  ], 'sem a situação e sem o código secreto do pedido');
  assert.deepEqual(M.agendamentosDoAparelho('x'), []);
});

test('a página: só as funções que precisa, nada novo guardado no aparelho, sem contador de visitas', () => {
  const js = read('assets/js/minha-saude.js').replace(/^\s*\/\/.*$/gm, '');
  const fns = [...new Set([...js.matchAll(/A\.rpc\('([a-z_]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(fns, ['saude_documento_pdf', 'saude_documentos', 'saude_guardar', 'saude_minhas_consultas', 'saude_vinculo_revogar', 'tele_patient_document_pdf', 'tele_patient_documents', 'tele_status']);
  for (const fn of fns.filter((f) => f.startsWith('saude_'))) assert.match(MIG, new RegExp(`create or replace function public\\.${fn}\\(`), `${fn} existe no banco`);
  assert.doesNotMatch(js + read('assets/js/minha-saude-core.js'), /\.setItem\(|sessionStorage|indexedDB|document\.cookie/, 'a página não grava nada no aparelho');
  assert.match(js, /A\.signOutAll\(\)/, 'sair fecha a conta em todos os aparelhos');
  assert.match(read('assets/js/auth.js'), /call\('\/auth\/v1\/logout\?scope=global'/);
  const html = read('minha-saude.html');
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(html, /visitas\.js/);
  assert.match(html, /script-src 'self'/);
  assert.equal(M.IDLE_MS, 30 * 60 * 1000);
  assert.match(html, /fechados depois de 30 minutos sem uso/);
  // o que a página afirma sobre quem vê o quê combina com o banco
  assert.match(html, /só abrem com entrada feita há menos de 12 horas/);
  assert.match(html, /a clínica onde você marca exames não vê suas consultas nem seus documentos/);
  assert.match(read('sw.js'), /'\.\/minha-saude\.html', /);
});

test('o banco: guardar nasce desligado, só o código do aparelho prova, e nada do conteúdo da consulta sai', () => {
  assert.match(MIG, /NOME PROVISÓRIO, AINDA NÃO APLICADA NA PRODUÇÃO/);
  assert.match(MIG, /where s\.key = 'saude_guardar' and s\.value = 'ligado'/);
  assert.doesNotMatch(MIG, /insert into private\.app_settings/, 'a migração não liga o interruptor');
  assert.match(MIG, /x\.token_hash = encode\(extensions\.digest\(p_token, 'sha256'\), 'hex'\) and x\.anonymized_at is null/);
  assert.doesNotMatch(MIG, /patient_phone|patient_cpf|patient_name/, 'nunca pelo celular, pelo CPF ou pelo nome');
  for (const fn of ['saude_guardar(uuid, text)', 'saude_vinculo_revogar(uuid)', 'saude_minhas_consultas()', 'saude_documentos(uuid)', 'saude_documento_pdf(uuid)']) {
    assert.ok(MIG.includes(`revoke all on function public.${fn} from public, anon, authenticated;\ngrant execute on function public.${fn} to authenticated;`), fn);
  }
  // o que as leituras devolvem: nada de anotação, motivo, exames, mensagens, conteúdo do documento ou dados do paciente
  const leituras = MIG.slice(MIG.indexOf('/* ===================== 4. Ler'));
  assert.doesNotMatch(leituras, /\b(notes|reason\b|exams|guidance|indication|payload|patient_snapshot|doctor_snapshot|tele_messages)\b/);
  assert.equal((MIG.match(/private\.ws_trilha\('saude_/g) || []).length, 11, 'toda leitura, recusa e mudança fica na trilha');
  assert.match(MIG, /create unique index if not exists saude_vinculos_consulta_uq on prontuario\.saude_vinculos \(teleconsulta_id\) where revogado_em is null;/);
});
