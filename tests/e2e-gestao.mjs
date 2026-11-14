// Teste de ponta a ponta do PAINEL DE GESTÃO (gestao.html, só a equipe do IMED) num navegador de verdade
// (Playwright), com o Supabase (login e as funções public.admin_gestao e public.admin_cobranca_*) simulado EM MEMÓRIA,
// com as regras do contrato (só admin; 42501 'forbidden'; dado inválido 22023 com mensagem curta em português).
// Cenários: sem login (quadro de entrar, nada do banco); conta que não é da equipe (aviso e nenhuma busca de dados);
// equipe com dados (números, gráficos com resumo para leitor de tela e tabela, funis, resultados, fluxograma da entrada
// de médicos com os números, médicos aguardando, clínicas, faturamento); bloco "Agora" (a fila da teleconsulta neste
// momento, chave "agora" de admin_gestao: no topo, antes do período; não muda com o período; atualiza junto com a
// página; o leitor de tela só ouve a frase quando os números mudam, numa região fora do bloco que se esvazia depois;
// nenhum dado de paciente; sem médico disponível em destaque; erro do banco esconde o bloco); volta para a aba ou para a
// janela depois de 2 min (busca de novo, foco e rolagem no mesmo lugar; a hora diz há quanto tempo e a data quando já é
// outro dia); banco ainda sem a chave "agora" (o bloco não aparece, nada quebra; aparece quando a migração chega);
// o visual de painel (trilho das partes ou fichas, com a parte atual em destaque; cartões lado a lado no computador e
// no tablet; mini-curva só onde há série por dia; barra do período que gruda sem cobrir o foco nem fazer a página pular;
// esqueleto ao carregar; 360 px com valores em dinheiro inteiros; contraste no claro e no escuro; "reduzir movimento");
// telas médias (o bloco "Agora" com dois por linha até 1080 px, cada valor numa linha só); período 7/30/90/365 (12
// meses: colunas por
// semana, tabelas abertas continuam abertas); banco ainda sem as funções (aviso, sem quebrar); cobrança (criar, prévia
// do valor, erro de validação, erro do banco, marcar como paga hoje e noutro dia, cancelar e voltar para pendente com
// confirmação, Enter de novo não desfaz, filtro, lista cheia e planilha CSV); a conta deixa de ser da equipe com a
// página aberta (42501); banco novo (tudo zero); link "Painel de gestão" no painel.html só para a equipe; entrada
// vencida; celular 390 px sem rolagem lateral (também em 12 meses) e celular 360 px (o bloco "Agora" e a página toda,
// medidos contra a largura configurada); nenhum erro no console.
// Agenda das clínicas (central do IMED, fase 4.4; funções agenda_central_* simuladas com as regras do contrato): as 6
// abas (clínicas, conflitos, auditoria, feriados, parâmetros e equipe) com teclado, filtros, formulários com
// conferência antes de gravar, erros do banco, nenhum dado de paciente, atualização automática (aviso do canal
// "agenda:imed" e volta para a aba), banco ainda sem as funções, celular e acessibilidade. Com o axe-core por perto
// (AXE_PATH ou node_modules), audita a página da equipe no computador e no celular, com as tabelas abertas, o bloco
// "Agora" com o aviso de nenhum médico e os quadros de pagamento e de voltar para pendente (falha com violação grave).
// Rodar com: node tests/e2e-gestao.mjs   (precisa do pacote "playwright" instalado)
// Opcional: LARGURA=1366 (largura da tela do computador nas capturas; padrão 1280). TEMA=escuro (aparelho no escuro). SHOTS=pasta salva capturas de tela (para mostrar o teste); E2E_PORT muda a porta (padrão 4761);
//           ONLY="trecho" roda só os cenários com esse texto no nome; AXE_PATH=<pasta>/node_modules/axe-core.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, vigiarChaves, REALTIME_WS, PUBLISHABLE } from './regra-chaves.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY || '';
const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
const PORT = Number(process.env.E2E_PORT) || 4761; // E2E_PORT: outra porta para rodar em paralelo
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

// axe-core (fora do site): AXE_PATH (arquivo, pasta do pacote ou pasta com node_modules) ou o node_modules do projeto.
function findAxe() {
  const tries = [];
  if (process.env.AXE_PATH) {
    const p = resolve(process.env.AXE_PATH);
    tries.push(() => require.resolve(p));
    tries.push(() => createRequire(join(p, 'noop.js')).resolve('axe-core'));
  }
  tries.push(() => require.resolve('axe-core'));
  for (const t of tries) {
    try { const f = t(); if (f && existsSync(f)) { const min = join(dirname(f), 'axe.min.js'); return existsSync(min) ? min : f; } } catch { /* próximo */ }
  }
  return null;
}
const AXE = findAxe();

/* ======================= dados simulados ======================= */
const NOW = '2026-10-30T15:00:00Z'; // 12:00 em São Paulo
const HOJE = '2026-10-30';
const USER_ID = 'uuuuuuuu-0000-4000-8000-0000000000e1';
const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const daySP = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const sum = (a) => a.reduce((s, x) => s + x, 0);
const clone = (x) => JSON.parse(JSON.stringify(x));

const ID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CHARGES = [
  { id: ID(1), criado_em: '2026-10-29T13:00:00Z', tipo: 'teleconsulta', descricao: 'Teleconsulta de 29/10', pagador_tipo: 'paciente', pagador_nome: 'Ana; "Maria" <b>Silva</b>', valor_cents: 8900, vencimento: '2026-10-29', status: 'pendente', pago_em: null, forma: null, obs: '=HYPERLINK("http://x")', teleconsulta_id: null, clinica_id: null },
  { id: ID(2), criado_em: '2026-10-20T10:00:00Z', tipo: 'mensalidade_clinica', descricao: 'Mensalidade de outubro', pagador_tipo: 'clinica', pagador_nome: 'Imagem Paulista', valor_cents: 49900, vencimento: '2026-10-25', status: 'pago', pago_em: '2026-10-22T15:00:00Z', forma: 'pix', obs: null, teleconsulta_id: null, clinica_id: null },
  // Cancelada depois de paga: o banco guarda a forma (a tela e a planilha só mostram a forma na paga).
  { id: ID(3), criado_em: '2026-09-15T10:00:00Z', tipo: 'outro', descricao: 'Material de divulgação', pagador_tipo: 'outro', pagador_nome: null, valor_cents: 15000, vencimento: '2026-09-20', status: 'cancelado', pago_em: null, forma: 'dinheiro', obs: null, teleconsulta_id: null, clinica_id: null },
  { id: ID(4), criado_em: '2026-10-28T09:00:00Z', tipo: 'comissao_clinica', descricao: 'Comissão de setembro', pagador_tipo: 'clinica', pagador_nome: 'Laboratório Análise', valor_cents: 25050, vencimento: '2026-11-10', status: 'pendente', pago_em: null, forma: null, obs: null, teleconsulta_id: null, clinica_id: null },
  { id: ID(5), criado_em: '2026-08-10T10:00:00Z', tipo: 'mensalidade_clinica', descricao: 'Mensalidade de agosto', pagador_tipo: 'clinica', pagador_nome: 'Imagem Paulista', valor_cents: 49900, vencimento: '2026-08-25', status: 'pago', pago_em: '2026-08-20T13:00:00Z', forma: 'boleto', obs: null, teleconsulta_id: null, clinica_id: null },
];
const AGUARDANDO = [
  { id: 'dddddddd-0000-4000-8000-000000000002', nome: 'Dr. Davi Rocha', crm: '98765', uf: 'RJ', especialidade: null, desde: '2026-10-28T09:30:00Z' },
  { id: 'dddddddd-0000-4000-8000-000000000001', nome: 'Dra. Carla <b>Mendes</b><img src=x onerror="window.__xss=1">', crm: '123456', uf: 'SP', especialidade: 'Cardiologia', desde: '2026-10-29T12:00:00Z' },
];

// Números do período (o resto vem das regras do contrato). A série soma os totais, como no banco.
const PAT = { pedidos: [0, 1, 0, 2, 1, 0, 1], tele_pedidas: [1, 0, 0, 1, 0, 1, 0], tele_encerradas: [1, 0, 0, 0, 0, 1, 0], documentos: [0, 2, 0, 0, 1, 0, 0] };
// A teleconsulta agora (chave "agora" de admin_gestao, migração 20261030191354_painel_medico): igual em qualquer
// período; os médicos disponíveis são o mesmo número de medicos.disponiveis_agora.
const AGORA = { aguardando: 1, espera_mais_longa_min: 7, em_atendimento: 0, medicos_disponiveis: 1 };
const AGORA_IDS = ['agora-aguardando', 'agora-espera', 'agora-atendimento', 'agora-medicos'];
function resumoCobranca(charges, days) {
  const from = addDays(HOJE, 1 - days);
  const pagas = charges.filter((c) => c.status === 'pago' && daySP(c.pago_em) >= from && daySP(c.pago_em) <= HOJE);
  const pend = charges.filter((c) => c.status === 'pendente');
  const meses = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(2026, 9 - 11 + i, 1)); return d.toISOString().slice(0, 7); });
  return {
    faturado_cents: sum(pagas.map((c) => c.valor_cents)), a_receber_cents: sum(pend.map((c) => c.valor_cents)),
    atrasado_cents: sum(pend.filter((c) => c.vencimento < HOJE).map((c) => c.valor_cents)), cancelado_cents: sum(charges.filter((c) => c.status === 'cancelado').map((c) => c.valor_cents)),
    qtd_pagas: pagas.length, qtd_pendentes: pend.length,
    por_mes: meses.map((mes) => ({
      mes,
      faturado_cents: sum(charges.filter((c) => c.status === 'pago' && daySP(c.pago_em).startsWith(mes)).map((c) => c.valor_cents)),
      a_receber_cents: sum(pend.filter((c) => c.vencimento.startsWith(mes)).map((c) => c.valor_cents)),
    })),
  };
}
function gestao(days, charges, agora = AGORA) {
  const de = addDays(HOJE, 1 - days);
  const serie = Array.from({ length: days }, (_, i) => ({
    dia: addDays(de, i), visitas: i === days - 4 ? 1000 : 120 + ((i * 53) % 97),
    pedidos: PAT.pedidos[i % 7], tele_pedidas: PAT.tele_pedidas[i % 7], tele_encerradas: PAT.tele_encerradas[i % 7], documentos: PAT.documentos[i % 7],
  }));
  const tot = (k) => sum(serie.map((x) => x[k]));
  const ped = tot('pedidos');
  const concluido = Math.floor(ped * 0.3); const confirmado = Math.floor(ped * 0.25); const cancelado = Math.floor(ped * 0.1); const contatado = Math.floor(ped * 0.15);
  const tp = tot('tele_pedidas'); const te = tot('tele_encerradas');
  const resto = tp - te - 1;
  const docs = tot('documentos');
  const exames = Math.ceil(docs * 0.45); const receita = Math.floor(docs * 0.25); const atestado = Math.floor(docs * 0.15);
  return {
    dias: days, de, ate: HOJE, gerado_em: NOW, serie,
    pacientes: {
      atendidos: te + concluido,
      pedidos: { total: ped, pendente: ped - concluido - confirmado - cancelado - contatado - 3, contatado, confirmado, cancelado, concluido, presente: 1, faltou: 1, remarcacao: 1, parceiro: Math.ceil(ped * 0.7), concierge: ped - Math.ceil(ped * 0.7) },
      tele: { total: tp, aguardando: 1, aceita: 0, em_atendimento: 0, encerrada: te, cancelada: Math.floor(resto / 2), expirada: resto - Math.floor(resto / 2), espera_media_min: 7.5, duracao_media_min: 18.2 },
      documentos: { total: docs, por_tipo: { exames, receita, atestado, comparecimento: 0, encaminhamento: 0, relatorio: docs - exames - receita - atestado, orientacoes: 0 }, cancelados: 1, pdf_assinado: Math.max(0, docs - 2) },
      avaliacoes: { total: 3, media: 4.7 },
    },
    funil: { visitas: tot('visitas'), abriram_busca: 1200, abriram_local: 480, pedidos: ped, confirmados: confirmado + concluido, concluidos: concluido, abriram_tele: 300, tele_fila: tp, tele_atendidas: te, tele_encerradas: te, tele_com_documento: Math.min(te, 5) },
    medicos: { inscritos_periodo: days >= 30 ? 4 : 1, pendente: 2, aprovado: 5, recusado: 1, suspenso: 0, disponiveis_agora: agora?.medicos_disponiveis ?? 1, aprovacao_media_horas: 30.5, aguardando: AGUARDANDO },
    clinicas: { parceiras: 7, com_agenda: 3, com_preco: 5, interessadas: days >= 30 ? 11 : 2, reivindicacoes: { pendente: 2, aprovado: 7, recusado: 1 } },
    outros: { lista_espera: 40, contatos: 6, avisos_de_erro: 2 },
    cobranca: resumoCobranca(charges, days),
    agora: clone(agora),
  };
}
// Banco novo: tudo zero, médias sem número (null), ninguém aguardando, nenhuma cobrança (12 meses zerados).
function gestaoZero(days) {
  const de = addDays(HOJE, 1 - days);
  const z = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));
  return {
    dias: days, de, ate: HOJE, gerado_em: NOW,
    serie: Array.from({ length: days }, (_, i) => ({ dia: addDays(de, i), visitas: 0, pedidos: 0, tele_pedidas: 0, tele_encerradas: 0, documentos: 0 })),
    pacientes: {
      atendidos: 0,
      pedidos: z(['total', 'pendente', 'contatado', 'confirmado', 'cancelado', 'concluido', 'presente', 'faltou', 'remarcacao', 'parceiro', 'concierge']),
      tele: { ...z(['total', 'aguardando', 'aceita', 'em_atendimento', 'encerrada', 'cancelada', 'expirada']), espera_media_min: null, duracao_media_min: null },
      documentos: { total: 0, por_tipo: z(['exames', 'receita', 'atestado', 'comparecimento', 'encaminhamento', 'relatorio', 'orientacoes']), cancelados: 0, pdf_assinado: 0 },
      avaliacoes: { total: 0, media: null },
    },
    funil: z(['visitas', 'abriram_busca', 'abriram_local', 'pedidos', 'confirmados', 'concluidos', 'abriram_tele', 'tele_fila', 'tele_atendidas', 'tele_encerradas', 'tele_com_documento']),
    medicos: { ...z(['inscritos_periodo', 'pendente', 'aprovado', 'recusado', 'suspenso', 'disponiveis_agora']), aprovacao_media_horas: null, aguardando: [] },
    clinicas: { ...z(['parceiras', 'com_agenda', 'com_preco', 'interessadas']), reivindicacoes: z(['pendente', 'aprovado', 'recusado']) },
    outros: z(['lista_espera', 'contatos', 'avisos_de_erro']),
    cobranca: resumoCobranca([], days),
    agora: { aguardando: 0, espera_mais_longa_min: null, em_atendimento: 0, medicos_disponiveis: 0 },
  };
}

/* ======================= agenda das clínicas (central do IMED, fase 4.4) ======================= */
// Tudo fictício: nomes de clínica inventados para o teste, contas pelo código curto, nenhum paciente.
const K = (n) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CE_CLINICAS = [
  { clinic_id: K(1), name: 'Imagem Paulista', city: 'São Paulo', state: 'SP', status: 'published', demo: false, agenda_mode: 'nativa', agenda_active: true, online_since: null,
    timezone: 'America/Sao_Paulo', timezone_confirmed_at: '2026-10-20T14:00:00Z', holidays_checked_until: '2027-03-31', closes_on_holidays: true, version: 42, changed_at: '2026-10-30T14:40:00Z', open_conflicts: 2, upcoming: 17, members: 4 },
  { clinic_id: K(2), name: 'Laboratório Análise', city: 'Campinas', state: 'SP', status: 'published', demo: false, agenda_mode: 'manual', agenda_active: true, online_since: null,
    timezone: 'America/Sao_Paulo', timezone_confirmed_at: null, holidays_checked_until: '2026-10-15', closes_on_holidays: true, version: 7, changed_at: '2026-10-29T18:00:00Z', open_conflicts: 0, upcoming: 3, members: 2 },
  { clinic_id: K(3), name: 'Clínica Sol <b>Norte</b>', city: 'Manaus', state: 'AM', status: 'published', demo: false, agenda_mode: 'pedido', agenda_active: false, online_since: null,
    timezone: 'America/Manaus', timezone_confirmed_at: null, holidays_checked_until: null, closes_on_holidays: null, version: 0, changed_at: null, open_conflicts: 0, upcoming: 0, members: 1 },
  { clinic_id: K(4), name: 'Hospital Vida', city: 'Recife', state: 'PE', status: 'draft', demo: true, agenda_mode: 'pedido', agenda_active: false, online_since: null,
    timezone: 'America/Recife', timezone_confirmed_at: null, holidays_checked_until: null, closes_on_holidays: null, version: 0, changed_at: null, open_conflicts: 0, upcoming: 0, members: 0 },
];
const CE_CONFLITOS = [
  { id: 'kkkkkkkk-0000-4000-8000-000000000001', clinic_id: K(1), clinic_name: 'Imagem Paulista', timezone: 'America/Sao_Paulo', kind: 'grade_mudou', status: 'em_andamento', resolution_code: null, created_at: '2026-10-28T12:00:00Z', resolved_at: null, starts_at: '2026-11-05T17:30:00Z' },
  { id: 'kkkkkkkk-0000-4000-8000-000000000002', clinic_id: K(1), clinic_name: 'Imagem Paulista', timezone: 'America/Sao_Paulo', kind: 'bloqueio_sobre_agendamento', status: 'aberto', resolution_code: null, created_at: '2026-10-30T13:10:00Z', resolved_at: null, starts_at: '2026-11-03T13:00:00Z' },
  { id: 'kkkkkkkk-0000-4000-8000-000000000003', clinic_id: K(2), clinic_name: 'Laboratório Análise', timezone: 'America/Sao_Paulo', kind: 'capacidade', status: 'resolvido', resolution_code: 'remarcado', created_at: '2026-10-20T12:00:00Z', resolved_at: '2026-10-21T15:00:00Z', starts_at: '2026-10-25T12:00:00Z' },
  { id: 'kkkkkkkk-0000-4000-8000-000000000004', clinic_id: K(2), clinic_name: 'Laboratório Análise', timezone: 'America/Sao_Paulo', kind: 'tipo_novo_do_banco', status: 'descartado', resolution_code: 'tirado_da_lista', created_at: '2026-10-10T12:00:00Z', resolved_at: '2026-10-11T12:00:00Z', starts_at: null },
];
const CE_MUDANCAS = [
  { id: 905, at: '2026-10-30T14:40:00Z', clinic_id: K(1), clinic_name: 'Imagem Paulista', actor_kind: 'clinica', actor_role: 'reception', actor: 'a1b2c3d4', origin: 'painel', action: 'bloqueio.criar_forcado', object_type: 'clinic_block', reason_code: null },
  { id: 904, at: '2026-10-30T13:00:00Z', clinic_id: null, clinic_name: null, actor_kind: 'imed', actor_role: 'imed_admin', actor: 'e1e1e1e1', origin: 'central', action: 'parametro.definir', object_type: 'setting', reason_code: null },
  { id: 903, at: '2026-10-29T18:00:00Z', clinic_id: K(2), clinic_name: 'Laboratório Análise', actor_kind: 'clinica', actor_role: 'owner', actor: 'b2b2b2b2', origin: 'painel', action: 'modalidade.trocar', object_type: 'clinic', reason_code: null },
  { id: 902, at: '2026-10-29T12:00:00Z', clinic_id: K(1), clinic_name: 'Imagem Paulista', actor_kind: 'sql', actor_role: null, actor: null, origin: 'sql', action: 'acao_nova_do_banco', object_type: 'objeto_novo', reason_code: 'teste_agenda' },
];
const CE_LEITURAS = [
  { day: '2026-10-30', clinic_id: K(1), clinic_name: 'Imagem Paulista', actor: 'a1b2c3d4', actor_role: 'reception', fn: 'agenda_view', scope: 'clinica', justification_code: null, reads: 31, requests: 0 },
  { day: '2026-10-30', clinic_id: K(1), clinic_name: 'Imagem Paulista', actor: 'f0f0f0f0', actor_role: 'imed', fn: 'agenda_request_detail', scope: 'central', justification_code: 'suporte_clinica', reads: 2, requests: 1 },
  { day: '2026-10-29', clinic_id: K(2), clinic_name: 'Laboratório Análise', actor: 'b2b2b2b2', actor_role: 'owner', fn: 'agenda_search', scope: 'busca', justification_code: null, reads: 4, requests: 0 },
];
const CE_PAPEIS = [
  { role: 'auditoria', permissions: ['imed.agenda.monitor', 'imed.auditoria.ver'] }, { role: 'financeiro', permissions: ['imed.financeiro.ver'] },
  { role: 'operacao', permissions: ['imed.agenda.monitor', 'imed.agenda.operar', 'imed.clinicas.configurar', 'imed.conflitos.resolver', 'imed.feriados.editar', 'imed.pacientes.ver'] },
  { role: 'suporte', permissions: ['imed.agenda.monitor'] },
];
// Contas que existem no "Auth" simulado (e-mail → id; confirmada ou não).
const CE_CONTAS = { 'ana.equipe@imed.test': ['f0f0f0f0-0000-4000-8000-000000000001', true], 'bia.equipe@imed.test': ['f1f1f1f1-0000-4000-8000-000000000002', true], 'semconfirmar@imed.test': ['f2f2f2f2-0000-4000-8000-000000000003', false] };
const centralDb = () => ({
  missing: false, error: null, failNet: 0, clinics: clone(CE_CLINICAS), conflicts: clone(CE_CONFLITOS), changes: clone(CE_MUDANCAS), reads: clone(CE_LEITURAS),
  holidays: [], staff: [], setting: null, settingAt: null, version: 49, appointmentsOn: { '2026-12-25': 3 }, saveError: null, auditForbidden: false,
});
const ceAbertos = (c) => c.conflicts.filter((k) => ['aberto', 'em_andamento'].includes(k.status)).length;
const ceNacionalAte = (c) => { const d = c.holidays.filter((h) => h.scope === 'nacional').map((h) => h.day).sort().at(-1); return d ? `${d.slice(0, 4)}-12-31` : null; };
// As funções agenda_central_* (e as duas de feriado da 3.2) com as regras do contrato. Devolve a resposta ou undefined
// (não é da central). Quem não é da equipe recebe {status: 'forbidden'}; visitante nem executa (42501).
function centralRpc(fn, body, db, { isAdmin, anon }) {
  const c = db.central;
  const FNS = ['agenda_central_version', 'agenda_central_overview', 'agenda_central_conflicts', 'agenda_central_audit', 'agenda_central_settings', 'agenda_central_setting_set',
    'agenda_central_holidays', 'agenda_central_holiday_preview', 'agenda_central_staff', 'agenda_central_staff_grant', 'agenda_central_staff_revoke', 'agenda_holiday_save', 'agenda_holiday_remove',
    'agenda_central_avisos'];
  if (!FNS.includes(fn)) return undefined;
  // avisos (5.3): banco de antes = sem a função; só existe quando o cenário liga (central.avisos)
  if (c.missing || (fn === 'agenda_central_avisos' && !c.avisos)) return { http: 404, body: NOFN(fn) };
  if (anon) return { http: 401, body: { code: '42501', message: 'permission denied for function', details: null, hint: null } };
  if (c.failNet > 0 && fn === 'agenda_central_version') { c.failNet -= 1; return { abort: true }; }
  if (c.failNetFn?.[fn] > 0) { c.failNetFn[fn] -= 1; return { abort: true }; } // sem internet nesta chamada
  if (c.error && fn !== 'agenda_central_version') return { http: c.error.status, body: c.error.body };
  if (!isAdmin) return { body: { status: 'forbidden' } };
  const ok = (o = {}) => ({ body: { status: 'ok', ...o } });
  switch (fn) {
    case 'agenda_central_version':
      return ok({ version: c.version, changed_at: NOW, clinics: c.clinics.filter((x) => x.agenda_active).length, open_conflicts: ceAbertos(c) });
    case 'agenda_central_overview': {
      const l = c.clinics;
      const n = (f) => l.filter(f).length;
      return ok({ generated_at: NOW, national_holidays_until: ceNacionalAte(c), truncated: false,
        totals: { clinics: l.length, agenda_active: n((x) => x.agenda_active), online: n((x) => x.selling), timezone_pending: n((x) => x.agenda_active && !x.timezone_confirmed_at),
          open_conflicts: sum(l.map((x) => x.open_conflicts)), upcoming: sum(l.map((x) => x.upcoming)),
          by_mode: Object.fromEntries(['pedido', 'nativa', 'manual', 'externa'].map((m) => [m, n((x) => x.agenda_mode === m)])) },
        clinics: [...l].sort((a, b) => Number(b.agenda_active) - Number(a.agenda_active) || b.open_conflicts - a.open_conflicts || a.name.localeCompare(b.name)) });
    }
    case 'agenda_central_conflicts': {
      const aberto = (k) => ['aberto', 'em_andamento'].includes(k.status);
      const q = c.conflicts.filter((k) => (body?.p_all ? true : aberto(k)));
      return ok({ generated_at: NOW, total: q.length, open: q.filter(aberto).length,
        conflicts: [...q].sort((a, b) => Number(aberto(b)) - Number(aberto(a)) || a.created_at.localeCompare(b.created_at)) });
    }
    case 'agenda_central_audit': {
      if (c.auditForbidden) return { body: { status: 'forbidden' } };
      const f = body?.p_filters ?? {};
      if (typeof f !== 'object' || Array.isArray(f) || Object.keys(f).some((k) => !['days', 'clinic', 'object_type', 'actor'].includes(k))) return { body: { status: 'invalid' } };
      if (f.days !== undefined && (!Number.isInteger(f.days) || f.days < 1 || f.days > 365)) return { body: { status: 'invalid' } };
      if (f.actor !== undefined && !/^[0-9a-f]{8}$/.test(f.actor)) return { body: { status: 'invalid' } };
      const days = f.days ?? 30;
      const from = addDays(HOJE, 1 - days);
      const ch = c.changes.filter((x) => daySP(x.at) >= from && (!f.clinic || x.clinic_id === f.clinic) && (!f.object_type || x.object_type === f.object_type) && (!f.actor || x.actor === f.actor));
      const rd = c.reads.filter((x) => x.day >= from && (!f.clinic || x.clinic_id === f.clinic) && (!f.actor || x.actor === f.actor));
      return ok({ generated_at: NOW, days, from,
        totals: { changes: ch.length, reads: sum(rd.map((x) => x.reads)), readers: new Set(rd.map((x) => x.actor)).size, imed_reads: sum(rd.filter((x) => x.justification_code).map((x) => x.reads)) },
        object_types: [...new Set(c.changes.filter((x) => daySP(x.at) >= from).map((x) => x.object_type))], changes: ch, reads: rd });
    }
    case 'agenda_central_avisos': return ok(c.avisos);
    case 'agenda_central_settings':
      return ok({ can_edit: true, params: [{ key: 'agenda.limite_futuros_por_telefone', default: 3, min: 1, max: 20, value: c.setting, effective: c.setting ?? 3, updated_at: c.settingAt },
        ...(c.avisos ? [{ key: 'avisos.envio_ligado', default: 0, min: 0, max: 1, value: null, effective: c.avisos.sending ? 1 : 0, updated_at: null }] : [])] });
    case 'agenda_central_setting_set': {
      if (body?.p_key !== 'agenda.limite_futuros_por_telefone') return { body: { status: 'not_found' } };
      const v = body.p_value;
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > 20)) return { body: { status: 'invalid', min: 1, max: 20 } };
      if (v === c.setting) return ok({ unchanged: true, effective: c.setting ?? 3 });
      c.setting = v; c.settingAt = v === null ? null : NOW;
      c.changes.unshift({ id: 990 + c.changes.length, at: NOW, clinic_id: null, clinic_name: null, actor_kind: 'imed', actor_role: 'imed_admin', actor: USER_ID.slice(0, 8), origin: 'central', action: v === null ? 'parametro.padrao' : 'parametro.definir', object_type: 'setting', reason_code: null });
      return ok({ effective: v ?? 3 });
    }
    case 'agenda_central_holidays':
      return ok({ today: HOJE, can_edit: true, national_until: ceNacionalAte(c), clinics_with_agenda: c.clinics.filter((x) => x.agenda_active).length,
        holidays: [...c.holidays].sort((a, b) => a.day.localeCompare(b.day)) });
    case 'agenda_central_holiday_preview': {
      if (!isDate(body?.p_day)) return { body: { status: 'invalid' } };
      return ok({ day: body.p_day, already: c.holidays.some((h) => h.scope === 'nacional' && h.day === body.p_day), clinics_with_agenda: 2, clinics_closing: 2, appointments: c.appointmentsOn[body.p_day] ?? 0 });
    }
    case 'agenda_holiday_save': {
      const h = body?.p_holiday;
      if (c.saveError) return { body: { status: c.saveError } };
      if (!h || Object.keys(h).some((k) => !['scope', 'uf', 'city_ibge', 'day', 'name', 'source'].includes(k)) || h.scope !== 'nacional' || !isDate(h.day)
        || String(h.name ?? '').length < 2 || String(h.name).length > 120 || String(h.source ?? '').length < 3 || String(h.source).length > 300) return { body: { status: 'invalid' } };
      if (c.holidays.some((x) => x.scope === 'nacional' && x.day === h.day)) return { body: { status: 'duplicate' } };
      const id = randomUUID();
      c.holidays.push({ id, scope: 'nacional', uf: null, city_ibge: null, day: h.day, name: h.name, source: h.source, created_at: NOW });
      const n = c.appointmentsOn[h.day] ?? 0;
      if (n) { c.clinics[0].open_conflicts += n; for (let i = 0; i < n; i += 1) c.conflicts.push({ id: randomUUID(), clinic_id: K(1), clinic_name: 'Imagem Paulista', timezone: 'America/Sao_Paulo', kind: 'grade_mudou', status: 'aberto', resolution_code: null, created_at: NOW, resolved_at: null, starts_at: `${h.day}T1${i}:00:00Z` }); }
      c.version += 1 + n;
      return ok({ id, conflicts: n });
    }
    case 'agenda_holiday_remove': {
      const i = c.holidays.findIndex((x) => x.id === body?.p_id);
      if (i < 0) return { body: { status: 'not_found' } };
      const [h] = c.holidays.splice(i, 1);
      // como o banco (revisão 4.4): fecha os conflitos "grade_mudou" daquele dia (o agendamento voltou a caber)
      let fechados = 0;
      for (const k of c.conflicts) if (k.kind === 'grade_mudou' && k.status === 'aberto' && String(k.starts_at).startsWith(h.day)) { k.status = 'resolvido'; k.resolution_code = 'feriado_retirado'; k.resolved_at = NOW; fechados += 1; }
      c.clinics[0].open_conflicts = Math.max(0, c.clinics[0].open_conflicts - fechados);
      c.version += 1;
      return ok({ conflicts_closed: fechados });
    }
    case 'agenda_central_staff':
      return ok({ roles: CE_PAPEIS, staff: [...c.staff].sort((a, b) => Number(b.active) - Number(a.active) || a.email.localeCompare(b.email)) });
    case 'agenda_central_staff_grant': {
      const e = String(body?.p_email ?? '');
      if (!['operacao', 'suporte', 'financeiro', 'auditoria'].includes(body?.p_role) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e !== e.trim().toLowerCase()) return { body: { status: 'invalid' } };
      if (e === 'equipe@imed.com.br') return { body: { status: 'already_admin' } };
      const conta = CE_CONTAS[e];
      if (!conta || !conta[1]) return { body: { status: 'user_not_found' } };
      const ja = c.staff.find((s) => s.user_id === conta[0] && s.role === body.p_role);
      if (ja?.active) return ok({ code: conta[0].slice(0, 8), unchanged: true });
      if (ja) Object.assign(ja, { active: true, revoked_at: null, granted_at: NOW });
      else c.staff.push({ user_id: conta[0], code: conta[0].slice(0, 8), email: e, role: body.p_role, granted_at: NOW, revoked_at: null, active: true });
      return ok({ code: conta[0].slice(0, 8), unchanged: false });
    }
    case 'agenda_central_staff_revoke': {
      const s = c.staff.find((x) => x.user_id === body?.p_user && x.role === body?.p_role && x.active);
      if (!s) return { body: { status: 'not_found' } };
      Object.assign(s, { active: false, revoked_at: NOW });
      return ok();
    }
    default: return undefined;
  }
}

/* ======================= banco simulado ======================= */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
const bad = (route, message) => json(route, { code: '22023', message, details: null, hint: null }, 400);
const NOFN = (fn) => ({ code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` });
const TIPOS = ['teleconsulta', 'mensalidade_clinica', 'comissao_clinica', 'outro'];
const PAGADORES = ['paciente', 'clinica', 'medico', 'outro'];
const STATUS = ['pendente', 'pago', 'cancelado'];
const FORMAS = ['pix', 'cartao', 'boleto', 'dinheiro', 'transferencia', 'outro'];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

async function newPage(browser, { mobile = false, width = 390, logged = false, email = 'equipe@imed.com.br', expired = false, db: dbOpts = {}, bypassCSP = false } = {}) {
  const context = await browser.newContext({
    ...(process.env.TEMA === 'escuro' ? { colorScheme: 'dark' } : {}), // TEMA=escuro: aparelho no escuro (o Automático do site segue), para as capturas
    viewport: mobile ? { width, height: 844 } : { width: Number(process.env.LARGURA) || 1280, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', acceptDownloads: true, bypassCSP,
  });
  await context.clock.setFixedTime(new Date(NOW));
  const nowS = Math.floor(Date.parse(NOW) / 1000);
  const db = {
    admin: true, charges: clone(CHARGES), gestaoMissing: false, cobMissing: false, gestaoError: null, gestaoDelay: 0, cobError: null, saveError: null,
    failRefresh: false, members: [], clinics: [], calls: [], zero: false, agora: clone(AGORA),
    ...dbOpts,
    central: { ...centralDb(), ...(dbOpts.central || {}) },
  };
  const log = [];
  await context.addInitScript(([s]) => {
    try {
      localStorage.setItem('imed_lgpd', '1');
      if (s && !sessionStorage.getItem('__seeded')) { localStorage.setItem('imed_session', JSON.stringify(s)); sessionStorage.setItem('__seeded', '1'); }
    } catch { /* sem armazenamento */ }
  }, [logged ? { access_token: 'tok-init', refresh_token: 'ref', expires_at: expired ? nowS - 600 : nowS + 3600, user: { id: USER_ID, email } } : null]);
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const path = url.pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const entry = { method: req.method(), path, q: url.search, query: url.searchParams, body, auth: req.headers().authorization };
    log.push(entry);
    if (path === '/auth/v1/otp') return json(route, {});
    if (path === '/auth/v1/user') return json(route, { id: USER_ID, email });
    if (path === '/auth/v1/token' && db.failRefresh) return json(route, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }, 400);
    if (path === '/auth/v1/token') return json(route, { access_token: 'tok-new', refresh_token: 'ref2', expires_in: 3600, user: { id: USER_ID, email } });
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
    const rest = path.replace('/rest/v1/', '');
    const anon = !/^Bearer tok-/.test(entry.auth || '');
    const isAdmin = db.admin && !anon;
    // Funções só para a equipe: o banco confere is_imed_admin() no servidor.
    const onlyAdmin = () => json(route, { code: '42501', message: 'forbidden', details: null, hint: null }, anon ? 401 : 403);
    if (rest.startsWith('rpc/')) {
      // central.delay = { <função>: ms }: o banco demora a responder nessa função (para a pessoa mexer na tela enquanto espera)
      const demora = db.central.delay?.[rest.slice(4)];
      if (demora) await new Promise((r) => setTimeout(r, demora));
      const r = centralRpc(rest.slice(4), body, db, { isAdmin, anon });
      if (r?.abort) return route.abort('internetdisconnected');
      if (r) return json(route, r.body, r.http || 200);
    }
    switch (rest) {
      case 'rpc/is_imed_admin': return json(route, isAdmin);
      case 'rpc/admin_gestao': {
        if (db.gestaoDelay) await new Promise((r) => setTimeout(r, db.gestaoDelay));
        if (db.gestaoMissing) return json(route, NOFN('admin_gestao(p_days)'), 404);
        if (!isAdmin) return onlyAdmin();
        if (db.gestaoError) return json(route, db.gestaoError.body, db.gestaoError.status);
        const days = Math.min(366, Math.max(1, Number(body?.p_days) || 30));
        const g = db.zero ? gestaoZero(days) : gestao(days, db.charges, db.agora);
        return json(route, db.patchGestao ? db.patchGestao(g) : g);
      }
      case 'rpc/admin_cobranca_listar': {
        if (db.cobMissing) return json(route, NOFN('admin_cobranca_listar(p_status, p_limite)'), 404);
        if (!isAdmin) return onlyAdmin();
        if (db.cobError) return json(route, db.cobError.body, db.cobError.status);
        const st = body?.p_status ?? null;
        if (st !== null && !STATUS.includes(st)) return bad(route, 'Situação inválida.');
        const lim = Math.min(1000, Math.max(1, Number(body?.p_limite) || 200));
        return json(route, db.charges.filter((c) => !st || c.status === st).sort((a, b) => b.criado_em.localeCompare(a.criado_em)).slice(0, lim));
      }
      case 'rpc/admin_cobranca_salvar': {
        if (db.cobMissing) return json(route, NOFN('admin_cobranca_salvar(p)'), 404);
        if (!isAdmin) return onlyAdmin();
        if (db.saveError) return json(route, db.saveError, 400);
        const p = body?.p;
        if (!p || typeof p !== 'object') return bad(route, 'Dados da cobrança inválidos.');
        // Com "id": edita só os campos enviados (aqui, situação, forma e data do pagamento, como o painel usa).
        if (p.id != null) {
          const c = db.charges.find((x) => x.id === p.id);
          if (!c) return bad(route, 'Cobrança não encontrada.');
          if (p.status != null) { if (!STATUS.includes(p.status)) return bad(route, 'Situação inválida.'); c.status = p.status; }
          if ('forma' in p) { if (p.forma != null && !FORMAS.includes(p.forma)) return bad(route, 'Forma de pagamento inválida.'); c.forma = p.forma; }
          if (c.status !== 'pago') c.pago_em = null;
          else if (p.pago_em != null) {
            if (!isDate(p.pago_em) || p.pago_em < '2020-01-01') return bad(route, 'Data do pagamento inválida.');
            if (p.pago_em > HOJE) return bad(route, 'A data do pagamento não pode ser no futuro.');
            c.pago_em = `${p.pago_em}T03:00:00Z`; // só o dia: meia-noite de São Paulo
          } else if (!c.pago_em) c.pago_em = NOW;
          return json(route, c);
        }
        if (!TIPOS.includes(p.tipo)) return bad(route, 'Tipo de cobrança inválido.');
        const desc = String(p.descricao ?? '').trim();
        if (desc.length < 3 || desc.length > 200) return bad(route, 'Descrição deve ter de 3 a 200 caracteres.');
        if (!PAGADORES.includes(p.pagador_tipo)) return bad(route, 'Tipo de pagador inválido.');
        if (p.pagador_nome != null && String(p.pagador_nome).length > 120) return bad(route, 'Nome do pagador deve ter até 120 caracteres.');
        if (!Number.isInteger(p.valor_cents) || p.valor_cents < 1 || p.valor_cents > 100000000) return bad(route, 'Valor inválido: informe de R$ 0,01 a R$ 1.000.000,00.');
        const venc = p.vencimento ?? HOJE;
        if (!isDate(venc) || venc < '2020-01-01' || venc > '2099-12-31') return bad(route, 'Vencimento inválido: use uma data de 2020 a 2099 (AAAA-MM-DD).');
        if (p.obs != null && String(p.obs).length > 500) return bad(route, 'Observação deve ter até 500 caracteres.');
        const row = { id: randomUUID(), criado_em: NOW, tipo: p.tipo, descricao: desc, pagador_tipo: p.pagador_tipo, pagador_nome: p.pagador_nome ?? null,
          valor_cents: p.valor_cents, vencimento: venc, status: 'pendente', pago_em: null, forma: null, obs: p.obs ?? null, teleconsulta_id: null, clinica_id: null };
        db.charges.push(row);
        return json(route, row);
      }
      case 'rpc/admin_cobranca_status': {
        if (db.cobMissing) return json(route, NOFN('admin_cobranca_status(p_id, p_status, p_forma)'), 404);
        if (!isAdmin) return onlyAdmin();
        if (!STATUS.includes(body?.p_status)) return bad(route, 'Situação inválida.');
        if (body.p_forma != null && body.p_forma !== '' && !FORMAS.includes(body.p_forma)) return bad(route, 'Forma de pagamento inválida.');
        const c = db.charges.find((x) => x.id === body.p_id);
        if (!c) return bad(route, 'Cobrança não encontrada.');
        if (body.p_status === 'pago') { if (c.status !== 'pago') c.pago_em = db.pagoEmBanco || NOW; } else c.pago_em = null;
        if (body.p_forma) c.forma = body.p_forma;
        c.status = body.p_status;
        return json(route, db.statusSemRetorno ? null : c);
      }
      // painel.html (o link "Painel de gestão")
      case 'clinic_members': return json(route, anon ? [] : db.members);
      case 'clinics': return json(route, db.clinics);
      default:
        if (req.method() === 'GET') return json(route, []);
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

const calls = (log, path) => log.filter((e) => e.path.endsWith(path));
const dataCalls = (log) => log.filter((e) => /\/rpc\/(admin_(gestao|cobranca_)|agenda_)/.test(e.path));
const shot = async (page, name, selector = null) => {
  if (!SHOTS) return;
  // Nas capturas, o topo fixo não cobre o pedaço fotografado (só para as imagens; a página não muda).
  await page.addStyleTag({ content: '.pt-top{position:static!important}' });
  await page.waitForTimeout(250);
  if (selector) await page.locator(selector).first().screenshot({ path: join(SHOTS, `${name}.png`) });
  else { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); }
};
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const kpiV = async (page, id) => norm(await page.textContent(`[data-kpi="${id}"] .gs-kpi-v`));
const noOverflow = async (page) => {
  const [w, sw] = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
  const vw = page.viewportSize().width;
  assert.ok(w <= vw && sw <= vw, `sem rolagem lateral (janela ${w}px, conteúdo ${sw}px, aparelho ${vw}px)`);
};
// "Atualizar números" e espera os números novos chegarem (uma chamada a mais de admin_gestao).
async function atualizar(page, log) {
  const n = calls(log, '/rpc/admin_gestao').length;
  await page.click('#gsRefresh');
  await page.waitForFunction(() => !document.querySelector('#gsData[aria-busy]'));
  assert.equal(calls(log, '/rpc/admin_gestao').length, n + 1, 'buscou os números de novo');
}
const agoraV = (page) => Promise.all(AGORA_IDS.map((id) => kpiV(page, id)));
// Em ordem: quando uma frase é escrita na região do leitor de tela do bloco "Agora" (#gsAgoraFala; esvaziar não conta)
// e quando o bloco aparece ou some.
const vigiaAgora = (page) => page.addInitScript(() => {
  window.__agora = [];
  new MutationObserver((recs) => {
    for (const r of recs) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (r.type === 'attributes') { if (el?.id === 'sec-agora') window.__agora.push(el.hidden ? 'esconde' : 'mostra'); } else if (el?.closest?.('#gsAgoraFala')?.textContent) window.__agora.push('fala');
    }
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
});
// Espera dois quadros da tela (o que a página faz "no próximo quadro" já aconteceu).
const quadros = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
// Esconde ou mostra a aba (outra aba à frente, tela apagada): a página vê document.hidden e o evento visibilitychange.
const setTabHidden = (page, hidden) => page.evaluate((h) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);
const AJUDA_AGORA = 'Números deste momento: não mudam com o período escolhido logo abaixo. Quando você volta para esta aba depois de 2 minutos ou mais, eles são buscados de novo; para ver na hora, use “Atualizar números”.';
const MED_UM = 'aprovado com o “Disponível” ligado (pode estar em consulta)';
const MED_VARIOS = 'aprovados com o “Disponível” ligado (pode incluir quem está em consulta)';
const brl = (c) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100).replace(/\s/g, ' ');
const int = (n) => new Intl.NumberFormat('pt-BR').format(n);
const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

async function runAxe(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] });
    return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  });
}

const results = [];
const LIMITE_MS = (Number(process.env.E2E_CENARIO_S) || 150) * 1000;
const limite = (name) => new Promise((_, fail) => { const t = setTimeout(() => fail(new Error(`passou de ${LIMITE_MS / 1000} s (cenário travado): ${name}`)), LIMITE_MS); t.unref?.(); });
async function scenario(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try { await Promise.race([comChaves(fn), limite(name)]); results.push(['ok', name]); console.log(`ok  ${name}`); } catch (e) { results.push(['FALHOU', name]); console.log(`FALHOU  ${name}\n   ${e.stack}`); }
}

const browser = vigiarChaves(await chromium.launch());
const F30 = gestao(30, CHARGES);
const F7 = gestao(7, CHARGES);

await scenario('sem login: quadro de entrar, nada do banco, página fora do Google e sem o contador de visitas', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#loginEmail');
  assert.equal(await page.title(), 'Painel de gestão · IMED');
  assert.equal(await page.getAttribute('meta[name="robots"]', 'content'), 'noindex, nofollow');
  assert.equal(await page.locator('script[src*="visitas.js"]').count(), 0, 'sem o contador de visitas');
  assert.match(norm(await page.textContent('#authBox')), /Esta página é só para a equipe do IMED/);
  assert.equal(norm(await page.textContent('#app')), '', 'nada da gestão sem login');
  assert.equal(log.filter((e) => e.path.startsWith('/rest/v1/')).length, 0, 'nenhuma chamada ao banco sem login');
  await shot(page, 'gestao-01-sem-login');
  await page.fill('#loginEmail', 'Equipe@IMED.com.br');
  await page.click('#authBox button[type="submit"]');
  await page.waitForSelector('#loginMsg.ok');
  const otp = calls(log, '/auth/v1/otp')[0];
  assert.equal(new URL(otp.path + otp.q, SUPA).searchParams.get('redirect_to'), `${BASE}gestao.html`, 'o link do e-mail volta para gestao.html');
  assert.equal(otp.body.email, 'equipe@imed.com.br');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('conta que não é da equipe: aviso e nenhuma busca de dados; o painel.html não mostra o link', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true, email: 'dono@clinica.com.br', db: { admin: false } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#denyTitle');
  assert.equal(norm(await page.textContent('#denyTitle')), 'Esta página é só para a equipe do IMED');
  assert.equal(calls(log, '/rpc/is_imed_admin').length, 1);
  assert.equal(calls(log, '/rpc/is_imed_admin')[0].auth, 'Bearer tok-init', 'confere com a conta de quem entrou');
  assert.equal(dataCalls(log).length, 0, 'nenhuma chamada de dados');
  assert.equal(await page.locator('.gs-kpi, .gs-fig, #cobForm').count(), 0);
  assert.equal(await page.locator('#app a[href="painel.html"]').count(), 1);
  await shot(page, 'gestao-02-sem-permissao');
  // painel.html: clínica sem ser da equipe, sem o atalho para a gestão.
  const C1 = 'cccccccc-0000-4000-8000-000000000001';
  const { page: p2, errors: e2, context: c2 } = await newPage(browser, { logged: true, email: 'dono@clinica.com.br', db: { admin: false, members: [{ clinic_id: C1, role: 'owner' }], clinics: [{ id: C1, name: 'Imagem Paulista', kind: 'imagem', city: 'São Paulo', state: 'SP', status: 'published', accepts_online_booking: true }] } });
  await p2.goto(`${BASE}painel.html`);
  await p2.waitForSelector('#tab-pedidos');
  await p2.waitForFunction(() => !document.querySelector('#panel .cl-state'));
  assert.equal(await p2.locator('#goGestao, a[href="gestao.html"]').count(), 0, 'clínica não vê o link da gestão');
  assert.deepEqual(e2, []);
  await c2.close();
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('painel.html: o link "Painel de gestão" aparece só para a equipe do IMED', async () => {
  const { page, errors, context } = await newPage(browser, { logged: true, db: { admin: true } });
  await page.goto(`${BASE}painel.html`);
  await page.waitForSelector('#goGestao');
  assert.equal(await page.getAttribute('#goGestao', 'href'), 'gestao.html');
  assert.equal(norm(await page.textContent('#goGestao')), 'Painel de gestão');
  assert.equal(await page.textContent('#clinicTitle'), 'Equipe do IMED');
  await shot(page, 'gestao-03-link-no-painel', '#app > section.cl-card');
  await page.click('#goGestao');
  await page.waitForURL(/gestao\.html$/);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('equipe do IMED: resumo, gráficos com resumo e tabela, funis, resultados, fluxograma dos médicos, clínicas e faturamento', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  await page.waitForSelector('#cobLista table');
  const q = calls(log, '/rpc/admin_gestao');
  assert.deepEqual(q[0].body, { p_days: 30 }, 'começa pelos últimos 30 dias');
  assert.equal(q[0].auth, 'Bearer tok-init');
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_listar')[0].body, { p_status: null, p_limite: 200 });
  assert.equal(await page.isChecked('input[name="gsDias"][value="30"]'), true);
  assert.match(norm(await page.textContent('#gsWhen')), /^Números de 01\/10\/2026 a 30\/10\/2026 \(30 dias\), no horário de São Paulo\. Atualizado às 12:00\.$/);
  // Só o período é lido quando muda (aria-live); a hora da atualização não é anunciada a cada cobrança.
  assert.equal(await page.getAttribute('#gsPeriodo', 'aria-live'), 'polite');
  assert.equal(await page.locator('#gsWhen[aria-live], #gsHora[aria-live]').count(), 0);
  // 1. resumo
  const P = F30.pacientes;
  const C = F30.cobranca;
  assert.equal(await kpiV(page, 'atendidos'), int(P.atendidos));
  assert.equal(await kpiV(page, 'pedidos'), int(P.pedidos.total));
  assert.equal(await kpiV(page, 'tele'), int(P.tele.total));
  assert.equal(await kpiV(page, 'visitas'), int(F30.funil.visitas));
  assert.equal(await kpiV(page, 'faturado'), brl(C.faturado_cents));
  assert.equal(await kpiV(page, 'receber'), brl(C.a_receber_cents));
  assert.equal(C.faturado_cents, 49900);
  assert.equal(C.a_receber_cents, 33950);
  // 0. agora: no topo, com os números deste momento (detalhes no cenário do bloco "Agora")
  assert.deepEqual(await agoraV(page), ['1', '7 min', '0', '1']);
  assert.equal(norm(await page.textContent('#sec-resumo-h')), 'Resumo do período');
  assert.equal(norm(await page.textContent('.gs-toc a[href="#sec-resumo"]')), 'Resumo do período', 'o atalho do topo com o mesmo nome do título');
  // 2. atendimentos por dia: um quadro de colunas por número (sem as visitas), cada um com resumo para leitor de tela,
  // e uma tabela com os mesmos números
  const atend = page.locator('figure[data-fig="atend"]');
  const S = F30.serie;
  const tot = (k) => sum(S.map((x) => x[k]));
  const mini = (k) => atend.locator(`[data-mini="${k}"]`);
  const NOMES = { pedidos: 'Pedidos de agendamento', tele_pedidas: 'Teleconsultas pedidas', tele_encerradas: 'Teleconsultas encerradas', documentos: 'Documentos emitidos' };
  assert.deepEqual(await atend.locator('.gs-mini').evaluateAll((m) => m.map((x) => x.dataset.mini)), Object.keys(NOMES));
  for (const [k, nome] of Object.entries(NOMES)) {
    const v = S.map((x) => x[k]);
    const mx = Math.max(...v);
    const svg = mini(k).locator('svg[role="img"]');
    assert.equal(await svg.getAttribute('aria-label'), `${nome} por dia, de 01/10 a 30/10: ${tot(k)} no total; o dia com mais foi ${dm(S[v.lastIndexOf(mx)].dia)}, com ${mx}.`, k);
    assert.equal(norm(await mini(k).locator('.gs-mini-t').innerText()), `${nome} ${tot(k)} no período`);
    assert.equal(await svg.locator('rect.gs-hit').count(), 30, `${k}: um dia por coluna`);
    assert.equal(await svg.locator('path.gs-bar').count(), v.filter((x) => x > 0).length, `${k}: dia com zero não desenha coluna`);
  }
  const svgA = mini('pedidos').locator('svg');
  assert.equal(Number(await svgA.getAttribute('width')), Math.round(await mini('pedidos').locator('.gs-chart').evaluate((el) => el.clientWidth)), 'desenhado na largura do lugar');
  const top = await atend.locator('.gs-mini').evaluateAll((m) => m.map((x) => Math.round(x.getBoundingClientRect().top)));
  assert.ok(top[0] === top[1] && top[2] === top[3] && top[2] > top[0], 'dois quadros por linha no computador');
  await atend.locator('summary').click();
  const rowsA = atend.locator('tbody tr');
  assert.equal(await rowsA.count(), 30);
  assert.equal(norm(await rowsA.first().innerText()), `sex, 30/10/2026 ${S[29].pedidos} ${S[29].tele_pedidas} ${S[29].tele_encerradas} ${S[29].documentos}`, 'o dia mais novo primeiro');
  // balão ao passar o mouse
  await svgA.locator('rect.gs-hit').nth(27).hover();
  await page.waitForSelector('#gsTip:not([hidden])');
  assert.equal(await page.textContent('#gsTip'), `qua, 28/10/2026\nPedidos de agendamento: ${S[27].pedidos}`);
  await page.mouse.move(5, 5);
  await page.waitForSelector('#gsTip', { state: 'hidden' });
  // visitas em outro gráfico, com o dia de mais visitas escrito
  const vis = page.locator('figure[data-fig="visitas"]');
  assert.equal(await vis.locator('svg[role="img"]').getAttribute('aria-label'), `Visualizações de página por dia, de 01/10 a 30/10: ${int(F30.funil.visitas)} no total; o dia com mais foi 27/10, com 1.000.`);
  assert.equal(await vis.locator('path.gs-area').count(), 1);
  assert.equal(await vis.locator('.gs-peak').textContent(), '1.000');
  // 3. fluxo do paciente: funis com % sobre a etapa anterior
  assert.match(norm(await page.textContent('#sec-fluxo')), /Visualização não é pessoa única/);
  const fa = page.locator('figure[data-fig="funil-agenda"]');
  const PF = F30.funil;
  const pc = (a, b) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: (a / b) * 100 > 0 && (a / b) * 100 < 10 ? 1 : 0 }).format((a / b) * 100)}%`;
  assert.equal(await fa.locator('svg').getAttribute('aria-label'), `Agendamento: da busca ao atendimento: abriram a busca (perto de mim) 1.200, abriram a página de um local 480 (40% da etapa anterior), pediram agendamento ${PF.pedidos} (${pc(PF.pedidos, 480)} da etapa anterior), pedido confirmado ${PF.confirmados} (${pc(PF.confirmados, PF.pedidos)} da etapa anterior) e atendimento concluído ${PF.concluidos} (${pc(PF.concluidos, PF.confirmados)} da etapa anterior).`);
  assert.equal(await fa.locator('path.gs-bar').count(), 5);
  assert.deepEqual(await fa.locator('path.gs-bar').evaluateAll((b) => b.map((x) => x.getAttribute('class'))), ['gs-bar gs-o1', 'gs-bar gs-o2', 'gs-bar gs-o3', 'gs-bar gs-o4', 'gs-bar gs-o5'], 'um tom só, do escuro ao claro');
  await fa.locator('summary').click();
  assert.deepEqual((await fa.locator('tbody tr').allInnerTexts()).map(norm).slice(0, 2), ['Abriram a busca (Perto de mim) 1.200 — 100%', 'Abriram a página de um local 480 40% 40%']);
  const ft = page.locator('figure[data-fig="funil-tele"]');
  assert.match(await ft.locator('svg').getAttribute('aria-label'), new RegExp(`^Teleconsulta: da página ao documento: abriram a teleconsulta 300, entraram na fila ${PF.tele_fila} \\(${pc(PF.tele_fila, 300).replace('.', '\\.')} da etapa anterior\\)`));
  // 4. resultados
  const sp = page.locator('figure[data-fig="st-pedidos"]');
  await sp.locator('summary').click();
  assert.deepEqual((await sp.locator('tbody tr').allInnerTexts()).map(norm), [
    ['Pendente', P.pedidos.pendente], ['Contatado', P.pedidos.contatado], ['Confirmado', P.pedidos.confirmado], ['Paciente presente', P.pedidos.presente], ['Concluído', P.pedidos.concluido], ['Não compareceu', P.pedidos.faltou], ['Remarcação solicitada', P.pedidos.remarcacao], ['Cancelado', P.pedidos.cancelado],
  ].map(([n, v]) => `${n} ${v} ${pc(v, P.pedidos.total)}`));
  assert.equal(await page.locator('figure[data-fig="st-tele"] path.gs-bar').count(), ['aguardando', 'aceita', 'em_atendimento', 'encerrada', 'cancelada', 'expirada'].filter((k) => P.tele[k] > 0).length, 'situação com zero não desenha barra');
  assert.equal(await kpiV(page, 'espera'), '8 min');
  assert.equal(await kpiV(page, 'duracao'), '18 min');
  assert.equal(await kpiV(page, 'parceiro'), int(P.pedidos.parceiro));
  assert.equal(await kpiV(page, 'concierge'), int(P.pedidos.concierge));
  const dc = page.locator('figure[data-fig="docs"]');
  assert.equal(norm(await dc.locator('figcaption span').textContent()), `${P.documentos.total} no total · 1 cancelado · ${P.documentos.pdf_assinado} com o PDF assinado enviado.`);
  await dc.locator('summary').click();
  assert.deepEqual((await dc.locator('tbody th').allTextContents()), ['Pedido de exames', 'Receita', 'Atestado', 'Comparecimento', 'Encaminhamento', 'Relatório', 'Orientações']);
  assert.equal(await kpiV(page, 'aval'), '3');
  assert.equal(await kpiV(page, 'nota'), '4,7 de 5');
  // 5. médicos: fluxograma com os números de agora e a lista dos que aguardam
  const flow = page.locator('ol.gs-flow');
  const n = async (cls) => norm(await flow.locator(`.${cls} .gs-fx-n`).textContent());
  assert.deepEqual([await n('gs-fs1'), await n('gs-fs2'), await n('gs-fb2'), await n('gs-fs3'), await n('gs-fb3'), await n('gs-fs4')], ['4', '2', '1', '5', '0', '1']);
  assert.deepEqual((await flow.locator('.gs-fx-t').allTextContents()), ['Inscrição', 'Conferência do CRM no CFM', 'Recusado', 'Aprovado', 'Suspenso', 'Disponível para atender']);
  assert.match(norm(await flow.locator('.gs-fs3').textContent()), /em média 31 horas até aprovar/);
  assert.match(norm(await flow.locator('.gs-fs4').textContent()), /aprovados com o “Disponível” ligado agora \(pode incluir quem está em consulta\)$/);
  assert.match(norm(await flow.locator('.gs-fb2').textContent()), /^Ramo da conferência:/, 'leitor de tela sabe de onde sai o ramo');
  const boxes = await flow.locator('li').evaluateAll((li) => li.map((x) => { const r = x.getBoundingClientRect(); return [x.className.split(' ')[1], Math.round(r.left), Math.round(r.top)]; }));
  const pos = Object.fromEntries(boxes.map(([c, l, t]) => [c, { l, t }]));
  assert.ok(pos['gs-fs1'].l < pos['gs-fs2'].l && pos['gs-fs2'].l < pos['gs-fs3'].l && pos['gs-fs3'].l < pos['gs-fs4'].l, 'etapas lado a lado, na ordem');
  assert.ok(pos['gs-fb2'].t > pos['gs-fs2'].t && pos['gs-fb2'].l === pos['gs-fs2'].l, 'Recusado embaixo da conferência');
  assert.ok(pos['gs-fb3'].t > pos['gs-fs3'].t && pos['gs-fb3'].l === pos['gs-fs3'].l, 'Suspenso embaixo do aprovado');
  assert.equal(norm(await page.textContent('#gsAgT')), 'Aguardando conferência (2)');
  const waits = page.locator('#gsAguardando li');
  assert.equal(await waits.count(), 2);
  assert.match(norm(await waits.nth(0).innerText()), /^Dr\. Davi Rocha CRM-RJ 98765 Aguardando conferência Inscrição em 28\/10\/2026 às 06:30 \(há 2 dias\)/);
  assert.match(norm(await waits.nth(1).locator('h4').textContent()), /^Dra\. Carla <b>Mendes<\/b><img src=x onerror="window\.__xss=1">$/, 'nome escapado');
  assert.match(norm(await waits.nth(1).locator('small').textContent()), /^CRM-SP 123456 · Cardiologia$/);
  const cfm = waits.nth(1).locator('a', { hasText: 'Conferir no CFM' });
  assert.equal(await cfm.getAttribute('href'), 'https://portal.cfm.org.br/busca-medicos/');
  assert.equal(await cfm.getAttribute('target'), '_blank');
  assert.equal(await cfm.getAttribute('rel'), 'noopener');
  assert.equal(await waits.nth(1).locator('a', { hasText: 'Abrir na área do médico' }).getAttribute('href'), 'medico.html#adminCard');
  // 6. clínicas
  assert.deepEqual([await kpiV(page, 'parceiras'), await kpiV(page, 'agenda'), await kpiV(page, 'preco'), await kpiV(page, 'interessadas')], ['7', '3', '5', '11']);
  assert.deepEqual([await kpiV(page, 'reiv-pendente'), await kpiV(page, 'reiv-aprovado'), await kpiV(page, 'reiv-recusado')], ['2', '7', '1']);
  assert.equal(await page.locator('[data-kpi="reiv-pendente"].gs-warn').count(), 1, 'pedidos em análise em destaque');
  assert.deepEqual([await kpiV(page, 'espera-app'), await kpiV(page, 'contatos'), await kpiV(page, 'avisos')], ['40', '6', '2']);
  // 7. faturamento (o texto só diz o que existe hoje: nada de "as cobranças entram sozinhas")
  assert.match(norm(await page.textContent('#sec-cobranca .gs-honest')), /^O IMED ainda não recebe pagamentos pelo site; aqui a equipe registra as cobranças feitas por fora \(Pix, cartão, boleto\)\.$/);
  assert.deepEqual([await kpiV(page, 'cob-faturado'), await kpiV(page, 'cob-receber'), await kpiV(page, 'cob-atrasado')], [brl(49900), brl(33950), brl(8900)]);
  assert.equal(norm(await page.textContent('#cobResumo .gs-canc')), `Canceladas, de qualquer data: ${brl(15000)} (não entram no faturado nem no a receber).`);
  assert.equal(await page.locator('[data-kpi="cob-atrasado"].gs-warn').count(), 1);
  assert.match(norm(await page.textContent('[data-kpi="cob-faturado"]')), /1 cobrança paga no período/);
  const meses = page.locator('figure[data-fig="meses"]');
  assert.equal(await meses.locator('rect.gs-hit').count(), 12);
  assert.equal(await meses.locator('path.gs-bar').count(), 3, 'faturado em ago e out, a receber em out');
  assert.equal(norm(await meses.locator('svg').getAttribute('aria-label')), `Faturamento por mês, de novembro de 2025 a outubro de 2026: ${brl(99800)} faturado e ${brl(8900)} a receber com vencimento nesses meses; o mês com mais faturamento foi outubro de 2026, com ${brl(49900)}.`);
  // tabela das cobranças: mais nova primeiro, atrasada marcada, nada de HTML de quem digitou
  const trs = page.locator('#cobLista tbody tr');
  assert.deepEqual(await trs.evaluateAll((r) => r.map((x) => x.dataset.id)), [ID(1), ID(4), ID(2), ID(3), ID(5)]);
  assert.match(norm(await trs.nth(0).textContent()), /Ana; "Maria" <b>Silva<\/b>/);
  assert.equal(await trs.nth(0).locator('.bd-err').textContent(), 'Atrasada');
  assert.equal(await page.locator('#cobLista tr.gs-late').count(), 1);
  assert.match(norm(await trs.nth(2).innerText()), /Paga em 22\/10\/2026 às 12:00 · Pix/);
  assert.equal(norm(await page.innerText(`#st-${ID(3)}`)), 'Cancelada', 'forma de pagamento só na paga');
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'HTML escapado');
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = false; });
  await shot(page, 'gestao-04-painel-completo');
  await shot(page, 'gestao-05-fluxo-do-paciente', '#sec-fluxo');
  await shot(page, 'gestao-06-fluxograma-medicos', '#sec-medicos');
  await shot(page, 'gestao-07-faturamento', '#sec-cobranca');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agora na teleconsulta: no topo, antes do período; números deste momento (não mudam com o período), atualizam junto com a página, sem dado de paciente, e o leitor de tela só ouve quando mudam', async () => {
  // O banco manda (por engano) nomes e motivos junto: nada disso pode aparecer (LGPD: só as contagens).
  const comNomes = { ...AGORA, fila: [{ nome: 'Maria Paciente', idade: 47, motivo: 'dor no peito' }], pacientes: ['João Sem Nome'] };
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, db: { agora: comNomes } });
  await vigiaAgora(page);
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-agora:not([hidden]) [data-kpi="agora-aguardando"]');
  await page.waitForSelector('#cobLista table');
  // No topo: depois dos atalhos, antes do período e do resumo do período.
  assert.deepEqual(await page.evaluate(() => [...document.querySelector('#app').children].map((el) => el.id || [...el.classList].at(-1))), ['gs-toc', 'sec-agora', 'gs-ctl', 'gsData', 'sec-cobranca', 'sec-agenda']);
  const topo = (sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().top);
  assert.ok(await topo('#sec-agora') < await topo('.gs-ctl') && await topo('.gs-ctl') < await topo('#sec-resumo'), 'na tela também');
  // Deixa claro que são números de agora (o resto da página é do período).
  assert.equal(norm(await page.textContent('#sec-agora-h')), 'Agora na teleconsulta');
  assert.equal(await page.getAttribute('#sec-agora', 'aria-labelledby'), 'sec-agora-h');
  assert.equal(norm(await page.textContent('#gsAgoraHora')), 'Atualizado às 12:00', 'a hora do banco');
  assert.equal(norm(await page.textContent('#sec-agora .gs-agora-help')), AJUDA_AGORA);
  assert.equal(norm(await page.textContent('#sec-resumo-h')), 'Resumo do período');
  // Os 4 números, com o nome e a explicação (no singular quando o número é 1).
  assert.deepEqual(await page.locator('#gsAgoraKpis .gs-kpi').evaluateAll((k) => k.map((x) => [x.querySelector('.gs-kpi-l').textContent.trim(), x.querySelector('small').textContent.trim()])), [
    ['Aguardando atendimento', 'paciente na fila, esperando um médico aceitar'], ['Espera mais longa', 'do primeiro paciente da fila'],
    ['Em atendimento', 'consultas aceitas por um médico ou em andamento'], ['Médicos disponíveis', MED_UM],
  ]);
  assert.deepEqual(await agoraV(page), ['1', '7 min', '0', '1']);
  assert.equal(await page.locator('#sec-agora .gs-warn, #gsAgoraAlerta .cl-note').count(), 0, 'há médico disponível: sem destaque');
  const kpis = await page.locator('#gsAgoraKpis .gs-kpi').evaluateAll((k) => k.map((x) => Math.round(x.getBoundingClientRect().top)));
  assert.ok(kpis.every((t) => t === kpis[0]), 'os 4 lado a lado no computador');
  // Leitor de tela: os números não ficam "ao vivo"; só uma frase curta é lida sozinha (educada, inteira), numa região
  // fora do bloco (junto do aviso do topo): quem percorre o bloco não ouve os números duas vezes.
  assert.equal(await page.getAttribute('#gsAgoraFala', 'aria-live'), 'polite');
  assert.equal(await page.getAttribute('#gsAgoraFala', 'aria-atomic'), 'true');
  assert.equal(await page.locator('#sec-agora [aria-live], #sec-agora [role="status"], #sec-agora [role="alert"]').count(), 0, 'nada "ao vivo" dentro do bloco');
  assert.equal(await page.evaluate(() => document.querySelector('#gsAgoraFala').previousElementSibling?.id), 'flash');
  assert.equal(await page.evaluate(() => !!document.querySelector('#app #gsAgoraFala, #sec-agora #gsAgoraFala')), false);
  // Ao abrir a página nada é lido (nem escrito): a pessoa lê o bloco ao chegar nele.
  assert.equal(await page.textContent('#gsAgoraFala'), '');
  assert.deepEqual(await page.evaluate(() => window.__agora), ['mostra'], 'ao abrir a página nenhuma frase vai para a região');
  // LGPD: nenhum nome, idade ou motivo de paciente na página.
  const tudo = await page.content();
  for (const s of ['Maria Paciente', 'dor no peito', 'João Sem Nome']) assert.ok(!tudo.includes(s), `${s} não aparece`);
  await shot(page, 'gestao-17-agora', '#sec-agora');
  // Trocar o período não muda os números de agora; atualizar com os mesmos números não lê nada de novo.
  await page.click('.gs-seg label:has-text("7 dias")');
  await page.waitForFunction(() => document.querySelectorAll('[data-mini="pedidos"] rect.gs-hit').length === 7);
  assert.deepEqual(calls(log, '/rpc/admin_gestao').at(-1).body, { p_days: 7 });
  assert.deepEqual(await agoraV(page), ['1', '7 min', '0', '1'], 'os números de agora não dependem do período');
  await atualizar(page, log);
  assert.deepEqual(await page.evaluate(() => window.__agora), ['mostra'], 'mesmos números: nada é anunciado a cada atualização');
  // O banco muda (3 na fila, nenhum médico): "Atualizar números" traz os novos; os de antes ficam (mais claros) até eles chegarem.
  db.agora = { aguardando: 3, espera_mais_longa_min: 12, em_atendimento: 1, medicos_disponiveis: 0 };
  db.gestaoDelay = 600;
  await page.click('#gsRefresh');
  await page.waitForSelector('#sec-agora.gs-busy');
  assert.deepEqual(await agoraV(page), ['1', '7 min', '0', '1'], 'segura os números de antes');
  await page.waitForFunction(() => !document.querySelector('#sec-agora.gs-busy'));
  db.gestaoDelay = 0;
  assert.deepEqual(await agoraV(page), ['3', '12 min', '1', '0']);
  assert.equal(norm(await page.textContent('#gsAgoraFala')), 'Agora: 3 pacientes aguardando atendimento (o primeiro espera há 12 minutos), 1 consulta em atendimento e nenhum médico disponível.');
  assert.deepEqual(await page.evaluate(() => window.__agora), ['mostra', 'fala'], 'os números mudaram: a frase é lida uma vez');
  assert.equal(norm(await page.textContent('[data-kpi="agora-medicos"] small')), MED_VARIOS, 'o número pode incluir médico em consulta');
  // Paciente esperando e nenhum médico disponível: em destaque, com o aviso escrito (sem ser lido sozinho).
  assert.equal(await page.locator('[data-kpi="agora-aguardando"].gs-warn').count(), 1);
  assert.equal(norm(await page.textContent('#gsAgoraAlerta')), 'Há paciente esperando e nenhum médico disponível agora.');
  assert.equal(await page.locator('#gsAgoraAlerta [role], #gsAgoraAlerta [aria-live]').count(), 0);
  assert.equal(norm(await page.textContent('ol.gs-flow .gs-fs4 .gs-fx-n')), '0', 'o fluxograma dos médicos mostra o mesmo número');
  await shot(page, 'gestao-18-agora-sem-medico', '#sec-agora');
  // Mexer numa cobrança busca os números da página de novo: os de agora vêm junto.
  db.agora = { aguardando: 0, espera_mais_longa_min: null, em_atendimento: 1, medicos_disponiveis: 2 };
  await page.click(`#cob-${ID(1)} [data-pay]`);
  await page.selectOption(`#forma-${ID(1)}`, 'pix');
  await page.click(`#cob-${ID(1)} [data-confirm-pay]`);
  await page.waitForFunction(() => document.querySelector('[data-kpi="agora-medicos"] .gs-kpi-v')?.textContent === '2');
  assert.deepEqual(await agoraV(page), ['0', '—', '1', '2']);
  assert.equal(norm(await page.textContent('[data-kpi="agora-espera"] small')), 'ninguém na fila agora');
  assert.equal(await page.locator('#sec-agora .gs-warn, #gsAgoraAlerta .cl-note').count(), 0, 'ninguém esperando: sem destaque');
  assert.equal(norm(await page.textContent('#gsAgoraFala')), 'Agora: nenhum paciente aguardando atendimento, 1 consulta em atendimento e 2 médicos disponíveis.');
  // A frase sai da região depois de uns segundos (quem percorre a página depois não ouve os números de novo).
  await page.waitForFunction(() => document.querySelector('#gsAgoraFala').textContent === '', null, { timeout: 9000 });
  assert.deepEqual(await agoraV(page), ['0', '—', '1', '2'], 'os números continuam no bloco');
  // O banco falha: o bloco some (nada dos números de antes como se fossem de agora); de volta, sem ler a frase de novo.
  db.gestaoError = { status: 500, body: { message: 'erro' } };
  await page.click('#gsRefresh');
  await page.waitForSelector('#retryGestao');
  assert.equal(await page.isHidden('#sec-agora'), true);
  db.gestaoError = null;
  await page.click('#retryGestao');
  await page.waitForSelector('#sec-agora:not([hidden])');
  assert.deepEqual(await agoraV(page), ['0', '—', '1', '2']);
  assert.deepEqual(await page.evaluate(() => window.__agora), ['mostra', 'fala', 'fala', 'esconde', 'mostra'], 'cada mudança lida uma vez; depois do erro, os mesmos números voltam calados');
  assert.equal(await page.textContent('#gsAgoraFala'), '');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('banco ainda sem a chave "agora" (migração nova não aplicada): o bloco não aparece, o resto funciona e o bloco chega com a migração', async () => {
  const semAgora = (g) => { delete g.agora; return g; };
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, db: { patchGestao: semAgora } });
  await vigiaAgora(page);
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  await page.waitForSelector('#cobLista table');
  assert.equal(await page.isHidden('#sec-agora'), true, 'sem a chave: sem o bloco');
  assert.equal(await page.locator('[data-kpi^="agora-"]').count(), 0, 'nenhum número de agora');
  assert.equal(await page.textContent('#gsAgoraFala'), '', 'nada para o leitor de tela');
  // Sem o bloco, voltar para a aba depois de 5 min não busca nada (como antes da migração).
  const n0 = calls(log, '/rpc/admin_gestao').length;
  await setTabHidden(page, true);
  await context.clock.setFixedTime(new Date('2026-10-30T15:05:00Z'));
  await setTabHidden(page, false);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(400);
  assert.equal(calls(log, '/rpc/admin_gestao').length, n0, 'sem o bloco "Agora", nada é buscado sozinho');
  await context.clock.setFixedTime(new Date(NOW));
  // O resto do painel segue igual (o fluxograma dos médicos tem o número dele).
  assert.equal(await kpiV(page, 'pedidos'), int(F30.pacientes.pedidos.total));
  assert.match(norm(await page.textContent('#gsWhen')), /^Números de 01\/10\/2026 a 30\/10\/2026 \(30 dias\), no horário de São Paulo\. Atualizado às 12:00\.$/);
  assert.equal(norm(await page.textContent('ol.gs-flow .gs-fs4 .gs-fx-n')), '1');
  assert.equal(await page.locator('#cobForm:not([hidden])').count(), 1);
  await shot(page, 'gestao-19-sem-a-chave-agora');
  // Chave nula, fora do formato ou sem nenhum número (e com um nome que não deveria vir): também sem o bloco.
  for (const agora of [null, [], 'agora', {}, { aguardando: 'muitos', medicos_disponiveis: -1, fila: [{ nome: 'Maria Paciente' }] }]) {
    db.patchGestao = (g) => ({ ...g, agora });
    await atualizar(page, log);
    assert.equal(await page.isHidden('#sec-agora'), true, JSON.stringify(agora));
    assert.equal(await kpiV(page, 'pedidos'), int(F30.pacientes.pedidos.total));
  }
  assert.ok(!(await page.content()).includes('Maria Paciente'));
  // A migração chega com a página aberta: o bloco aparece na próxima atualização (e some se a chave sumir de novo).
  db.patchGestao = null;
  await atualizar(page, log);
  assert.equal(await page.isHidden('#sec-agora'), false);
  assert.deepEqual(await agoraV(page), ['1', '7 min', '0', '1']);
  db.patchGestao = semAgora;
  await atualizar(page, log);
  assert.equal(await page.isHidden('#sec-agora'), true);
  assert.deepEqual(await page.evaluate(() => window.__agora), ['mostra', 'esconde'], 'aparece sem ser anunciado');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('volta para a aba ou para a janela depois de 2 min ou mais: busca os números de agora de novo (foco e rolagem no mesmo lugar); a hora diz há quanto tempo e, de outro dia, a data', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true });
  // O banco simulado devolve a hora dele (gerado_em) junto com os números; o relógio do navegador anda junto.
  let bancoAgora = NOW;
  db.patchGestao = (g) => ({ ...g, gerado_em: bancoAgora });
  const relogio = async (iso) => { bancoAgora = iso; await context.clock.setFixedTime(new Date(iso)); };
  const gestaoN = () => calls(log, '/rpc/admin_gestao').length;
  await vigiaAgora(page);
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-agora:not([hidden]) .gs-kpi');
  await page.waitForSelector('#cobLista table');
  assert.equal(norm(await page.textContent('#gsAgoraHora')), 'Atualizado às 12:00');
  const n0 = gestaoN();
  // O foco do teclado num "Ver em tabela" no meio da página, com a tabela aberta pelo teclado.
  const sum = page.locator('figure[data-fig="funil-tele"] summary');
  await sum.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.querySelector('figure[data-fig="funil-tele"] details').open), true);
  const y0 = await page.evaluate(() => scrollY);
  assert.ok(y0 > 300, `página rolada até a tabela (${y0} px)`);
  // 1 min fora da aba: nada é buscado (os números ainda são deste momento).
  await setTabHidden(page, true);
  await relogio('2026-10-30T15:01:00Z');
  await setTabHidden(page, false);
  await page.waitForTimeout(400);
  assert.equal(gestaoN(), n0, 'menos de 2 min: não busca');
  assert.equal(norm(await page.textContent('#gsAgoraHora')), 'Atualizado às 12:00');
  // 5 min fora da aba e a fila mudou: ao voltar, a hora diz a idade dos números de antes enquanto os novos chegam.
  await setTabHidden(page, true);
  await relogio('2026-10-30T15:05:00Z');
  db.agora = { aguardando: 2, espera_mais_longa_min: 4, em_atendimento: 1, medicos_disponiveis: 1 };
  db.gestaoDelay = 700;
  await setTabHidden(page, false);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); // a janela volta junto: uma busca só
  assert.equal(norm(await page.textContent('#gsAgoraHora')), 'Atualizado às 12:00 (há 5 min)', 'os números de antes dizem a idade deles');
  await page.waitForSelector('#sec-agora.gs-busy');
  await page.waitForFunction(() => !document.querySelector('#gsData[aria-busy]'));
  db.gestaoDelay = 0;
  assert.equal(gestaoN(), n0 + 1, 'buscou uma vez');
  assert.deepEqual(calls(log, '/rpc/admin_gestao').at(-1).body, { p_days: 30 }, 'o mesmo período');
  assert.deepEqual(await agoraV(page), ['2', '4 min', '1', '1']);
  assert.equal(norm(await page.textContent('#gsAgoraHora')), 'Atualizado às 12:05');
  assert.match(norm(await page.textContent('#gsWhen')), /Atualizado às 12:05\.$/);
  // O foco continua no mesmo "Ver em tabela" (feito de novo e ainda aberto) e a página não pulou.
  assert.equal(await page.evaluate(() => `${document.activeElement?.closest('figure')?.dataset.fig}|${document.activeElement?.tagName}`), 'funil-tele|SUMMARY');
  assert.equal(await page.evaluate(() => document.querySelector('figure[data-fig="funil-tele"] details').open), true);
  await quadros(page);
  const y1 = await page.evaluate(() => scrollY);
  assert.ok(Math.abs(y1 - y0) <= 2, `a página não pulou (${y0} → ${y1} px)`);
  // Leitor de tela: os números mudaram, a frase é lida uma vez.
  assert.equal(norm(await page.textContent('#gsAgoraFala')), 'Agora: 2 pacientes aguardando atendimento (o primeiro espera há 4 minutos), 1 consulta em atendimento e 1 médico disponível.');
  assert.deepEqual(await page.evaluate(() => window.__agora), ['mostra', 'fala']);
  // A janela volta (outro programa estava na frente e a aba continuou à vista) 3 min depois: busca de novo.
  await relogio('2026-10-30T15:08:00Z');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.querySelector('#gsAgoraHora')?.textContent === 'Atualizado às 12:08');
  assert.equal(gestaoN(), n0 + 2);
  assert.deepEqual(await page.evaluate(() => window.__agora), ['mostra', 'fala'], 'mesmos números: nada é lido de novo');
  // De um dia para o outro com a aba escondida (e o banco demorando): a hora traz a data até os números novos chegarem.
  await setTabHidden(page, true);
  await relogio('2026-10-31T11:30:00Z'); // 08:30 de 31/10 em São Paulo
  db.gestaoDelay = 1500;
  await setTabHidden(page, false);
  assert.equal(norm(await page.textContent('#gsAgoraHora')), 'Atualizado em 30/10 às 12:08 (há 20 h)');
  await shot(page, 'gestao-21-agora-de-ontem', '#sec-agora');
  await page.waitForFunction(() => document.querySelector('#gsAgoraHora')?.textContent === 'Atualizado às 08:30', null, { timeout: 8000 });
  db.gestaoDelay = 0;
  assert.equal(gestaoN(), n0 + 3);
  await shot(page, 'gestao-22-agora-atualizado-ao-voltar', '#sec-agora');
  // Lá embaixo, marcar uma cobrança como paga busca os números da página de novo: a lista fica no mesmo lugar da tela.
  await page.locator(`#cob-${ID(1)} [data-pay]`).scrollIntoViewIfNeeded();
  await page.click(`#cob-${ID(1)} [data-pay]`);
  await page.selectOption(`#forma-${ID(1)}`, 'pix');
  const lista0 = await page.locator('#cobLista').evaluate((el) => el.getBoundingClientRect().top);
  const n3 = gestaoN();
  await page.click(`#cob-${ID(1)} [data-confirm-pay]`);
  for (const t0 = Date.now(); gestaoN() === n3;) { assert.ok(Date.now() - t0 < 5000, 'os números da página vêm de novo'); await page.waitForTimeout(50); }
  await page.waitForFunction(() => !document.querySelector('#gsData[aria-busy]'));
  await quadros(page);
  const lista1 = await page.locator('#cobLista').evaluate((el) => el.getBoundingClientRect().top);
  assert.ok(Math.abs(lista1 - lista0) <= 2, `a lista das cobranças não pulou (${lista0} → ${lista1} px)`);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('período: 7 dias, 12 meses e 90 dias; os números de antes ficam (mais claros) até os novos chegarem', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  db.gestaoDelay = 700;
  await page.click('.gs-seg label:has-text("7 dias")');
  await page.waitForSelector('#gsData.gs-busy[aria-busy="true"]');
  assert.equal(await kpiV(page, 'pedidos'), int(F30.pacientes.pedidos.total), 'segura os números de antes');
  await page.waitForFunction(() => !document.querySelector('#gsData.gs-busy'));
  assert.deepEqual(calls(log, '/rpc/admin_gestao').at(-1).body, { p_days: 7 });
  assert.equal(await kpiV(page, 'pedidos'), int(F7.pacientes.pedidos.total));
  assert.equal(await kpiV(page, 'faturado'), brl(0), 'nada pago nos últimos 7 dias');
  assert.equal(await page.locator('[data-mini="pedidos"] rect.gs-hit').count(), 7);
  assert.match(norm(await page.textContent('#gsWhen')), /de 24\/10\/2026 a 30\/10\/2026 \(7 dias\)/);
  assert.equal(await page.evaluate(() => document.activeElement?.value), '7', 'o foco continua no período');
  assert.equal(calls(log, '/rpc/admin_cobranca_listar').length, 1, 'a lista das cobranças não depende do período');
  db.gestaoDelay = 0;
  // "Ver em tabela" aberto continua aberto quando os números chegam de novo.
  await page.locator('figure[data-fig="atend"] summary').click();
  await page.locator('figure[data-fig="meses"] summary').click();
  await page.click('.gs-seg label:has-text("12 meses")');
  // 12 meses: cada coluna soma uma semana (52 colunas; a mais antiga leva o dia que sobra); a tabela segue dia a dia.
  await page.waitForFunction(() => document.querySelectorAll('[data-mini="pedidos"] rect.gs-hit').length === 52);
  assert.deepEqual(calls(log, '/rpc/admin_gestao').at(-1).body, { p_days: 365 });
  assert.equal(await page.locator('figure[data-fig="atend"] details[open]').count(), 1, 'a tabela aberta continua aberta');
  assert.equal(await page.locator('figure[data-fig="meses"] details[open]').count(), 1);
  assert.equal(await page.locator('figure[data-fig="atend"] tbody tr').count(), 365, 'a tabela mostra cada dia');
  assert.equal(norm(await page.textContent('figure[data-fig="atend"] figcaption b')), 'Pedidos, teleconsultas e documentos por semana');
  const S365 = gestao(365, CHARGES).serie;
  assert.match(await page.getAttribute('[data-mini="pedidos"] svg', 'aria-label'), new RegExp(`^Pedidos de agendamento por semana, de 31/10/2025 a 30/10/2026: ${sum(S365.map((x) => x.pedidos))} no total; a semana com mais foi a de \\d\\d/\\d\\d/\\d{4} a \\d\\d/\\d\\d/\\d{4}, com \\d+\\.$`), 'resumo com o ano');
  assert.equal(await page.getAttribute('figure[data-fig="visitas"] svg', 'aria-label'), `Visualizações de página por dia, de 31/10/2025 a 30/10/2026: ${int(sum(S365.map((x) => x.visitas)))} no total; o dia com mais foi 27/10/2026, com 1.000.`);
  // (rola antes: o balão some ao rolar a página)
  const ultima = page.locator('[data-mini="pedidos"] rect.gs-hit').last();
  await ultima.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await ultima.hover();
  await page.waitForSelector('#gsTip:not([hidden])');
  assert.equal(await page.textContent('#gsTip'), `Semana de 24/10/2026 a 30/10/2026\nPedidos de agendamento: ${sum(S365.slice(-7).map((x) => x.pedidos))}`);
  await page.mouse.move(5, 5);
  const xs = await page.locator('[data-mini="pedidos"] svg').evaluate((svg) => { const b = svg.getBoundingClientRect(); return [...svg.querySelectorAll('text.gs-tick')].map((t) => t.getBoundingClientRect()).filter((r) => r.top > b.bottom - 24).map((r) => ({ left: r.left, right: r.right })).sort((a, c) => a.left - c.left); });
  assert.ok(xs.length >= 4, `rótulos das semanas: ${xs.length}`); // no painel, cada quadro tem metade da largura de antes
  for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i].left >= xs[i - 1].right, 'rótulos sem se encostar');
  assert.equal(await page.locator('figure[data-fig="visitas"] circle').count(), 0, 'sem bolinhas em 365 dias');
  const bars = await page.locator('[data-mini="pedidos"] path.gs-bar').evaluateAll((p) => p.map((x) => { const r = x.getBBox(); return { x: r.x, width: r.width }; }).sort((a, b) => a.x - b.x));
  assert.equal(bars.length, 52);
  assert.ok(bars.every((b) => b.width >= 2), 'colunas de verdade (pelo menos 2 px)');
  for (let i = 1; i < bars.length; i += 1) assert.ok(bars[i].x >= bars[i - 1].x + bars[i - 1].width - 0.01, `colunas sem uma encostar na outra: ${JSON.stringify([bars[i - 1], bars[i]])} de ${bars.length}`);
  await page.click('.gs-seg label:has-text("90 dias")');
  await page.waitForFunction(() => document.querySelectorAll('[data-mini="pedidos"] rect.gs-hit').length === 90);
  assert.deepEqual(calls(log, '/rpc/admin_gestao').at(-1).body, { p_days: 90 });
  await page.click('#gsRefresh');
  await page.waitForFunction(() => !document.querySelector('#gsData[aria-busy]') && document.querySelectorAll('[data-mini="pedidos"] rect.gs-hit').length === 90);
  await shot(page, 'gestao-08-periodo-90-dias', '#sec-atend');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('banco ainda sem as funções: aviso claro na gestão e na cobrança, sem quebrar; outro erro com "Tentar de novo"', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, db: { gestaoMissing: true, cobMissing: true } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#gsData .cl-note.warn');
  assert.match(norm(await page.textContent('#gsData')), /O painel de gestão ainda não está ligado no banco\. Os números aparecem aqui depois que a atualização do banco for aplicada\./);
  await page.waitForSelector('#cobLista .cl-note.warn');
  assert.match(norm(await page.textContent('#cobLista')), /A cobrança ainda não está ligada no banco/);
  assert.equal(await page.isHidden('#cobForm'), true, 'sem a função, sem o formulário');
  assert.equal(await page.isHidden('#cobNovaLink'), true, 'nem o atalho para ele');
  assert.equal(await page.locator('.gs-fig').count(), 0);
  assert.equal(await page.isHidden('#sec-agora'), true, 'sem a função, sem o bloco "Agora"');
  assert.match(norm(await page.textContent('#sec-cobranca .gs-honest')), /O IMED ainda não recebe pagamentos pelo site/);
  await shot(page, 'gestao-09-banco-sem-funcoes');
  // Outro erro: mensagem e "Tentar de novo".
  db.gestaoMissing = false;
  db.gestaoError = { status: 500, body: { message: 'erro' } };
  await page.click('#gsRefresh');
  await page.waitForSelector('#retryGestao');
  assert.match(norm(await page.textContent('#gsData')), /Não foi possível carregar os números agora/);
  db.gestaoError = null;
  db.cobMissing = false;
  await page.click('#retryGestao');
  await page.waitForSelector('#sec-resumo .gs-kpi');
  await page.click('#gsRefresh');
  await page.waitForSelector('#cobLista table');
  assert.equal(await page.isHidden('#cobForm'), false, 'com a função, o formulário volta');
  assert.equal(await page.isHidden('#cobNovaLink'), false);
  assert.ok(calls(log, '/rpc/admin_cobranca_listar').length >= 2);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('cobrança: validar, erro do banco, criar, marcar como paga (hoje e outro dia), cancelar, voltar para pendente (com confirmação), filtro e planilha CSV', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#cobLista table');
  await page.waitForSelector('#sec-resumo .gs-kpi');
  assert.equal(await page.inputValue('#cVenc'), HOJE, 'vencimento começa em hoje');
  // Obrigatórios marcados para o leitor de tela; data com os limites do banco; o exemplo do valor fica à vista.
  for (const id of ['cTipo', 'cPag', 'cDesc', 'cValor']) assert.equal(await page.getAttribute(`#${id}`, 'aria-required'), 'true', id);
  for (const id of ['cNome', 'cVenc', 'cObs']) assert.equal(await page.getAttribute(`#${id}`, 'aria-required'), null, id);
  assert.deepEqual([await page.getAttribute('#cVenc', 'min'), await page.getAttribute('#cVenc', 'max')], ['2020-01-01', '2099-12-31']);
  assert.equal(await page.getAttribute('#cValor', 'placeholder'), null, 'o exemplo não fica só dentro do campo');
  assert.equal(await page.getAttribute('#cValor', 'aria-describedby'), 'cValorHint cValorPrevia cValorErr');
  assert.equal(norm(await page.textContent('#cValorHint')), 'Em reais, com vírgula nos centavos. Ex.: 150 ou 1.234,56');
  // Atalho "Nova cobrança" no alto da lista: o foco vai para o formulário (sem passar pelos botões da lista).
  await page.click('#cobNovaLink');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'cobNovaT');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'cTipo', 'o Tab segue para o primeiro campo');
  // formulário vazio: erros nos obrigatórios, nada vai para o banco
  await page.fill('#cVenc', '');
  await page.click('#cSalvar');
  for (const [id, msg] of [['cTipo', 'Escolha o tipo da cobrança.'], ['cPag', 'Escolha quem paga.'], ['cDesc', 'Descreva a cobrança (pelo menos 3 letras).'], ['cValor', 'Informe o valor.']]) {
    assert.equal(await page.textContent(`#${id}Err`), msg, id);
    assert.equal(await page.getAttribute(`#${id}`, 'aria-invalid'), 'true', id);
  }
  assert.equal(await page.textContent('#cVencErr'), '', 'vencimento em branco vale hoje');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cTipo', 'foco no primeiro campo com erro');
  assert.equal(calls(log, '/rpc/admin_cobranca_salvar').length, 0);
  await shot(page, 'gestao-10-cobranca-erros', '#cobForm');
  await page.selectOption('#cTipo', 'comissao_clinica');
  await page.selectOption('#cPag', 'clinica');
  await page.fill('#cDesc', '  Comissão   de outubro ');
  await page.fill('#cNome', 'Clínica Sol');
  // Prévia do valor antes de salvar: "1.500" e "1.50" ficam bem diferentes.
  await page.fill('#cValor', '1.500');
  assert.equal(norm(await page.textContent('#cValorPrevia')), 'Vai registrar R$ 1.500,00.');
  await page.fill('#cValor', '1.50');
  assert.equal(norm(await page.textContent('#cValorPrevia')), 'Vai registrar R$ 1,50.');
  await page.fill('#cValor', 'abc');
  assert.equal(await page.textContent('#cValorPrevia'), '', 'valor inválido: sem prévia');
  await page.click('#cSalvar');
  assert.equal(await page.textContent('#cValorErr'), 'Valor inválido. Use, por exemplo, 150 ou 1.234,56.');
  await page.fill('#cValor', '0,00');
  await page.click('#cSalvar');
  assert.equal(await page.textContent('#cValorErr'), 'O valor precisa ficar entre R$ 0,01 e R$ 1.000.000,00.');
  assert.equal(calls(log, '/rpc/admin_cobranca_salvar').length, 0);
  // erro do banco (22023): a mensagem curta dele aparece
  await page.fill('#cValor', 'R$ 1.234,56');
  assert.equal(norm(await page.textContent('#cValorPrevia')), `Vai registrar ${brl(123456)}.`);
  await page.fill('#cVenc', '2026-11-05');
  await page.fill('#cObs', 'Pix combinado');
  db.saveError = { code: '22023', message: 'Clínica não encontrada.', details: null, hint: null };
  await page.click('#cSalvar');
  await page.waitForSelector('#cMsg .cl-note.err');
  assert.equal(norm(await page.textContent('#cMsg')), 'Clínica não encontrada.');
  // agora salva
  db.saveError = null;
  const before = calls(log, '/rpc/admin_gestao').length;
  await page.click('#cSalvar');
  await page.waitForSelector('#cMsg .cl-note.ok');
  const sv = calls(log, '/rpc/admin_cobranca_salvar');
  assert.deepEqual(sv.at(-1).body, { p: { tipo: 'comissao_clinica', descricao: 'Comissão de outubro', pagador_tipo: 'clinica', pagador_nome: 'Clínica Sol', valor_cents: 123456, vencimento: '2026-11-05', obs: 'Pix combinado' } });
  assert.equal(sv.at(-1).auth, 'Bearer tok-init');
  assert.equal(norm(await page.textContent('#cMsg')), `Cobrança registrada: ${brl(123456)} · Comissão de outubro.`);
  assert.equal(norm(await page.textContent('#toast')), '', 'um aviso só (embaixo do botão), sem repetir no balão');
  assert.equal(await page.inputValue('#cDesc'), '', 'formulário limpo');
  assert.equal(await page.inputValue('#cVenc'), HOJE);
  assert.equal(await page.textContent('#cValorPrevia'), '', 'a prévia some com o formulário limpo');
  const created = db.charges.at(-1);
  assert.equal(await page.locator('#cobLista tbody tr').first().getAttribute('data-id'), created.id, 'a nova aparece no topo');
  await page.waitForFunction((n) => document.querySelector('[data-kpi="cob-receber"] .gs-kpi-v')?.textContent.replace(/\s/g, ' ') === n, brl(33950 + 123456));
  assert.ok(calls(log, '/rpc/admin_gestao').length > before, 'os totais são buscados de novo');

  // Marcar como paga (hoje): pede a forma; "Pago em" começa em hoje e não aceita o futuro.
  const nCob = () => [calls(log, '/rpc/admin_cobranca_status').length, calls(log, '/rpc/admin_cobranca_salvar').length];
  const antes = nCob();
  const r1 = `#cob-${ID(1)}`;
  await page.click(`${r1} [data-pay]`);
  assert.equal(await page.evaluate(() => document.activeElement.id), `forma-${ID(1)}`, 'foco na forma de pagamento');
  assert.equal(await page.inputValue(`#pagoem-${ID(1)}`), HOJE, '"Pago em" começa em hoje');
  assert.deepEqual([await page.getAttribute(`#pagoem-${ID(1)}`, 'min'), await page.getAttribute(`#pagoem-${ID(1)}`, 'max')], ['2020-01-01', HOJE]);
  await page.click(`${r1} [data-confirm-pay]`);
  assert.equal(await page.textContent(`#forma-${ID(1)}-err`), 'Escolha a forma de pagamento.');
  await page.selectOption(`#forma-${ID(1)}`, 'pix');
  await page.fill(`#pagoem-${ID(1)}`, '2026-10-31');
  await page.click(`${r1} [data-confirm-pay]`);
  assert.equal(await page.textContent(`#pagoem-${ID(1)}-err`), 'A data do pagamento não pode ser no futuro.');
  assert.equal(await page.evaluate(() => document.activeElement.id), `pagoem-${ID(1)}`);
  assert.deepEqual(nCob(), antes, 'nada foi para o banco');
  await page.fill(`#pagoem-${ID(1)}`, HOJE);
  await shot(page, 'gestao-11-marcar-como-pago', r1);
  // Pelo teclado: Enter confirma; um segundo Enter não desfaz nada (o foco vai para a situação, não para um botão).
  await page.focus(`${r1} [data-confirm-pay]`);
  await page.keyboard.press('Enter');
  await page.waitForFunction((sel) => /Paga/.test(document.querySelector(sel)?.textContent || ''), r1);
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_status').at(-1).body, { p_id: ID(1), p_status: 'pago', p_forma: 'pix' }, 'hoje: o banco grava a hora de agora');
  assert.equal(await page.evaluate(() => document.activeElement?.id), `st-${ID(1)}`, 'foco na situação da cobrança');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.equal(calls(log, '/rpc/admin_cobranca_status').length, 1, 'Enter de novo não volta para pendente');
  assert.match(norm(await page.innerText(r1)), /Paga em 30\/10\/2026 às 12:00 · Pix/);
  assert.equal(await page.locator(`${r1}.gs-late`).count(), 0, 'paga não fica atrasada');
  assert.equal(norm(await page.textContent('#toast')), 'Cobrança “Teleconsulta de 29/10” marcada como paga (Pix).', 'um aviso só: o balão');
  assert.equal(await page.locator('#cobMsg').count(), 0, 'sem a mesma mensagem repetida embaixo da lista');
  await page.waitForFunction((n) => document.querySelector('[data-kpi="cob-faturado"] .gs-kpi-v')?.textContent.replace(/\s/g, ' ') === n, brl(49900 + 8900));
  assert.equal(await kpiV(page, 'cob-atrasado'), brl(0));

  // Marcar como paga noutro dia: vai a data informada (admin_cobranca_salvar) e ela entra no faturado desse dia.
  const rc = `#cob-${created.id}`;
  await page.click(`${rc} [data-pay]`);
  await page.selectOption(`#forma-${created.id}`, 'transferencia');
  await page.fill(`#pagoem-${created.id}`, '2026-10-25');
  await page.click(`${rc} [data-confirm-pay]`);
  await page.waitForFunction((sel) => /Paga/.test(document.querySelector(sel)?.textContent || ''), rc);
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_salvar').at(-1).body, { p: { id: created.id, status: 'pago', forma: 'transferencia', pago_em: '2026-10-25' } });
  assert.equal(calls(log, '/rpc/admin_cobranca_status').length, 1, 'não chamou a função que grava "agora"');
  assert.match(norm(await page.innerText(rc)), /Paga em 25\/10\/2026 · Transferência/, 'só o dia, sem hora inventada');
  assert.equal(norm(await page.textContent('#toast')), 'Cobrança “Comissão de outubro” marcada como paga em 25/10/2026 (Transferência).');
  await page.waitForFunction((n) => document.querySelector('[data-kpi="cob-faturado"] .gs-kpi-v')?.textContent.replace(/\s/g, ' ') === n, brl(49900 + 8900 + 123456));
  assert.equal(await kpiV(page, 'cob-receber'), brl(25050));

  // Cancelar: confirma antes (o botão de confirmar lê o aviso junto).
  const r4 = `#cob-${ID(4)}`;
  await page.click(`${r4} [data-cancel]`);
  assert.match(norm(await page.textContent(`${r4} .gs-pay`)), /Cancelar a cobrança de R\$ 250,50\? Ela sai do “a receber”\./);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.confirmCancel), ID(4));
  assert.equal(await page.getAttribute(`${r4} [data-confirm-cancel]`, 'aria-describedby'), `cancel-${ID(4)}-txt`);
  await page.click(`${r4} [data-back]`);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.cancel), ID(4), '"Voltar" devolve o foco');
  assert.equal(calls(log, '/rpc/admin_cobranca_status').length, 1);
  await page.click(`${r4} [data-cancel]`);
  await page.click(`${r4} [data-confirm-cancel]`);
  await page.waitForFunction((sel) => /Cancelada/.test(document.querySelector(sel)?.textContent || ''), r4);
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_status').at(-1).body, { p_id: ID(4), p_status: 'cancelado', p_forma: null });
  assert.equal(await page.evaluate(() => document.activeElement?.id), `st-${ID(4)}`);
  await page.waitForFunction((n) => document.querySelector('[data-kpi="cob-receber"] .gs-kpi-v')?.textContent.replace(/\s/g, ' ') === n, brl(0));

  // Voltar para pendente também confirma antes. Paga: avisa que sai do faturado e que a data do pagamento é apagada.
  const r2 = `#cob-${ID(2)}`;
  await page.click(`${r2} [data-reopen]`);
  assert.equal(norm(await page.textContent(`${r2} .gs-pay p`)), `Voltar a cobrança de ${brl(49900)} para pendente? Ela sai do faturado e a data do pagamento (22/10/2026) será apagada.`);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.confirmReopen), ID(2), 'foco no confirmar, que lê o aviso junto');
  assert.equal(await page.getAttribute(`${r2} [data-confirm-reopen]`, 'aria-describedby'), `reopen-${ID(2)}-txt`);
  assert.match(await page.getAttribute(`${r2} [data-confirm-reopen]`, 'class'), /btn-danger/);
  await shot(page, 'gestao-11b-voltar-para-pendente', r2);
  await page.click(`${r2} [data-back]`);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.reopen), ID(2), '"Voltar" devolve o foco');
  assert.equal(calls(log, '/rpc/admin_cobranca_status').length, 2, 'nada mudou sem confirmar');
  // Cancelada → pendente (desfaz um engano): volta para o "a receber".
  const r3 = `#cob-${ID(3)}`;
  await page.click(`${r3} [data-reopen]`);
  assert.equal(norm(await page.textContent(`${r3} .gs-pay p`)), `Voltar a cobrança de ${brl(15000)} para pendente? Ela volta para o “a receber”.`);
  await page.click(`${r3} [data-confirm-reopen]`);
  await page.waitForFunction((sel) => /Pendente/.test(document.querySelector(sel)?.textContent || ''), r3);
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_status').at(-1).body, { p_id: ID(3), p_status: 'pendente', p_forma: null });
  assert.equal(await page.locator(`${r3}.gs-late`).count(), 1, 'vencida em 20/09: atrasada');
  assert.equal(norm(await page.innerText(`#st-${ID(3)}`)), 'Pendente', 'a forma guardada no banco não aparece na pendente');
  assert.equal(norm(await page.textContent('#toast')), 'Cobrança “Material de divulgação” voltou para pendente.');
  // Erro do banco ao mudar a situação: aparece dentro do quadro da cobrança, e o botão volta a funcionar.
  db.charges = db.charges.filter((c) => c.id !== ID(5));
  await page.click(`#cob-${ID(5)} [data-reopen]`);
  assert.match(norm(await page.textContent(`#cob-${ID(5)} .gs-pay p`)), /^Voltar a cobrança de R\$ 499,00 para pendente\? Ela sai do faturado e a data do pagamento \(20\/08\/2026\) será apagada\.$/);
  await page.click(`#cob-${ID(5)} [data-confirm-reopen]`);
  await page.waitForSelector(`#acterr-${ID(5)} .cl-note.err`);
  assert.equal(norm(await page.textContent(`#acterr-${ID(5)}`)), 'Cobrança não encontrada.');
  assert.equal(await page.isDisabled(`#cob-${ID(5)} [data-confirm-reopen]`), false, 'o botão volta a funcionar');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.confirmReopen), ID(5), 'o foco fica no quadro');
  // filtro: pagas (o banco filtra) e atrasadas (pendentes do banco, filtradas aqui pelo vencimento)
  await page.selectOption('#cobFiltro', 'pago');
  await page.waitForFunction(() => !document.querySelector('#cobLista[aria-busy]') && document.querySelectorAll('#cobLista tbody tr').length === 3);
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_listar').at(-1).body, { p_status: 'pago', p_limite: 200 });
  assert.deepEqual(await page.locator('#cobLista tbody tr').evaluateAll((r) => r.map((x) => x.dataset.id)), [created.id, ID(1), ID(2)]);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cobFiltro', 'foco continua no filtro');
  await page.selectOption('#cobFiltro', 'atrasada');
  await page.waitForFunction(() => document.querySelectorAll('#cobLista tbody tr').length === 1 && document.querySelector('#cobLista tbody tr')?.dataset.id.endsWith('3'));
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_listar').at(-1).body, { p_status: 'pendente', p_limite: 1000 }, 'atrasadas: até o máximo do banco');
  assert.match(norm(await page.textContent('#cobConta')), /^1 cobrança \(atrasadas\)\. A lista não depende do período: as mais novas primeiro\.$/);
  await page.selectOption('#cobFiltro', 'cancelado');
  await page.waitForFunction(() => !document.querySelector('#cobLista[aria-busy]') && document.querySelectorAll('#cobLista tbody tr').length === 1 && document.querySelector('#cobLista tbody tr')?.dataset.id.endsWith('4'));
  assert.deepEqual(await page.locator('#cobLista tbody tr').evaluateAll((r) => r.map((x) => x.dataset.id)), [ID(4)]);
  // planilha CSV (todas)
  await page.selectOption('#cobFiltro', '');
  await page.waitForFunction(() => !document.querySelector('#cobLista[aria-busy]') && document.querySelectorAll('#cobLista tbody tr').length === 5);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#cobCsv')]);
  assert.equal(dl.suggestedFilename(), 'imed-cobrancas-2026-10-30.csv');
  const csv = await readFile(await dl.path(), 'utf8');
  assert.ok(csv.startsWith('﻿Criada em;Tipo;Descrição;Quem paga;Nome de quem paga;Valor (R$);Vencimento;Situação;Atrasada;Pago em;Forma de pagamento;Observação;Código\r\n'), 'cabeçalho com BOM e ponto e vírgula');
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 6, 'cabeçalho + 5 cobranças');
  assert.equal(lines[1], `30/10/2026 12:00;Comissão de clínica;Comissão de outubro;Clínica;Clínica Sol;1234,56;05/11/2026;Paga;;25/10/2026;Transferência;Pix combinado;${created.id}`, 'paga noutro dia: só a data');
  assert.equal(lines[2], `29/10/2026 10:00;Teleconsulta;Teleconsulta de 29/10;Paciente;"Ana; ""Maria"" <b>Silva</b>";89,00;29/10/2026;Paga;;30/10/2026 12:00;Pix;"'=HYPERLINK(""http://x"")";${ID(1)}`, 'aspas dobradas, ponto e vírgula entre aspas e fórmula desligada');
  assert.equal(lines[3], `28/10/2026 06:00;Comissão de clínica;Comissão de setembro;Clínica;Laboratório Análise;250,50;10/11/2026;Cancelada;;;;;${ID(4)}`);
  assert.equal(lines[4], `20/10/2026 07:00;Mensalidade de clínica;Mensalidade de outubro;Clínica;Imagem Paulista;499,00;25/10/2026;Paga;;22/10/2026 12:00;Pix;;${ID(2)}`);
  assert.equal(lines[5], `15/09/2026 07:00;Outro;Material de divulgação;Outro;;150,00;20/09/2026;Pendente;sim;;;;${ID(3)}`, 'pendente: sem a forma que o banco guardou');
  assert.equal(norm(await page.textContent('#toast')), 'Planilha com 5 cobranças baixada.');
  await shot(page, 'gestao-12-cobrancas', '#sec-cobranca');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('tudo do IMED: a conta da equipe vê os atalhos de todas as áreas; quem não é da equipe ou saiu não vê', async () => {
  let { page, errors, context } = await newPage(browser, { logged: true });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#gsAreas .gs-area');
  assert.equal(norm(await page.textContent('#gsAreasT')), 'Tudo do IMED');
  const links = await page.$$eval('#gsAreas a.gs-area', (as) => as.map((a) => [a.getAttribute('href'), a.querySelector('b').textContent, a.getAttribute('aria-current')]));
  assert.deepEqual(links, [['gestao.html', 'Painel de gestão', 'page'], ['painel.html', 'Área da clínica', null], ['medico.html', 'Plataforma do médico', null],
    ['conta.html', 'Minha conta', null], ['./', 'Site como o paciente vê', null], ['definir-senha.html', 'Trocar a senha', null]]);
  // Fica entre "Sua conta" e os números, e cada atalho tem área de toque de pelo menos 44 px.
  assert.ok(await page.evaluate(() => { const a = document.querySelector('#gsAreas'), c = document.querySelector('#authCard'), p = document.querySelector('#app');
    return !!(c.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(a.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  assert.ok((await page.$$eval('#gsAreas a.gs-area', (as) => as.map((a) => a.getBoundingClientRect().height))).every((h) => h >= 44));
  // Nenhum número e nenhuma chamada ao banco por causa do bloco: é texto fixo.
  assert.equal(await page.locator('#gsAreas').evaluate((el) => /\d/.test(el.textContent)), false, 'sem número no bloco');
  await shot(page, 'gestao-areas');
  // Saiu da conta: o bloco some junto com os números.
  await page.click('#authBox [data-signout]');
  await page.waitForFunction(() => !document.querySelector('#gsAreas').children.length);
  assert.equal(await page.isVisible('#gsAreas'), false);
  assert.deepEqual(errors, []);
  await context.close();

  ({ page, errors, context } = await newPage(browser, { logged: true, email: 'dono@clinica.com.br', db: { admin: false } }));
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#denyTitle');
  assert.equal(await page.locator('#gsAreas *').count(), 0, 'quem não é da equipe não vê os atalhos');
  assert.deepEqual(errors, []);
  await context.close();

  ({ page, errors, context } = await newPage(browser, { mobile: true, width: 360, logged: true }));
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#gsAreas .gs-area');
  const [w, sw] = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
  assert.ok(sw <= w, `celular de 360 px sem rolagem lateral (${sw} > ${w})`);
  await shot(page, 'gestao-areas-celular');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('lista que vem cheia: avisa que pode haver mais antigas fora da lista e da planilha', async () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ ...CHARGES[0], id: ID(100 + i), descricao: `Pendente ${i}`, criado_em: new Date(Date.parse(NOW) - i * 3600000).toISOString(), vencimento: '2026-10-29' }));
  const { page, log, errors, context } = await newPage(browser, { logged: true, db: { charges: many } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#cobLista table');
  assert.equal(await page.locator('#cobLista tbody tr').count(), 200, 'todas: as 200 mais novas');
  assert.match(norm(await page.textContent('#cobConta')), /Atenção: vieram só as 200 mais novas; pode haver mais antigas fora da lista e da planilha\.$/);
  await page.selectOption('#cobFiltro', 'atrasada');
  await page.waitForFunction(() => document.querySelectorAll('#cobLista tbody tr').length === 1000, null, { timeout: 30000 });
  assert.deepEqual(calls(log, '/rpc/admin_cobranca_listar').at(-1).body, { p_status: 'pendente', p_limite: 1000 });
  assert.match(norm(await page.textContent('#cobConta')), /^1\.000 cobranças \(atrasadas\)\. A lista não depende do período: as mais novas primeiro\. Atenção: vieram só as 1\.000 pendentes mais novas; pode haver atrasadas mais antigas fora da lista e da planilha\.$/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#cobCsv')]);
  assert.equal((await readFile(await dl.path(), 'utf8')).trimEnd().split('\r\n').length, 1001);
  assert.equal(norm(await page.textContent('#toast')), 'Planilha com 1.000 cobranças baixada: só as da lista (pode haver mais antigas).');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('a conta deixa de ser da equipe com a página aberta (42501): some tudo, como ao abrir', async () => {
  // Ao mudar a situação de uma cobrança
  const a = await newPage(browser, { logged: true });
  await a.page.goto(`${BASE}gestao.html`);
  await a.page.waitForSelector('#cobLista table');
  await a.page.waitForSelector('#sec-resumo .gs-kpi');
  a.db.admin = false;
  await a.page.click(`#cob-${ID(1)} [data-pay]`);
  await a.page.selectOption(`#forma-${ID(1)}`, 'pix');
  await a.page.click(`#cob-${ID(1)} [data-confirm-pay]`);
  await a.page.waitForSelector('#denyTitle');
  assert.equal(await a.page.locator('.gs-kpi, .gs-fig, #cobForm, #cobLista').count(), 0, 'nenhum número fica na tela');
  assert.equal(a.db.charges.find((c) => c.id === ID(1)).status, 'pendente');
  assert.deepEqual(a.errors, []);
  await a.context.close();
  // Ao registrar uma cobrança
  const b = await newPage(browser, { logged: true });
  await b.page.goto(`${BASE}gestao.html`);
  await b.page.waitForSelector('#cobLista table');
  await b.page.waitForSelector('#sec-resumo .gs-kpi');
  b.db.admin = false;
  await b.page.selectOption('#cTipo', 'outro');
  await b.page.selectOption('#cPag', 'outro');
  await b.page.fill('#cDesc', 'Teste');
  await b.page.fill('#cValor', '10');
  await b.page.click('#cSalvar');
  await b.page.waitForSelector('#denyTitle');
  assert.equal(await b.page.locator('.gs-kpi, .gs-fig, #cobForm').count(), 0);
  assert.deepEqual(b.errors, []);
  await b.context.close();
  // Ao atualizar os números (o banco recusa com 403/42501)
  const c = await newPage(browser, { logged: true });
  await c.page.goto(`${BASE}gestao.html`);
  await c.page.waitForSelector('#sec-resumo .gs-kpi');
  await c.page.waitForSelector('#cobLista table');
  c.db.gestaoError = { status: 403, body: { code: '42501', message: 'forbidden', details: null, hint: null } };
  await c.page.click('#gsRefresh');
  await c.page.waitForSelector('#denyTitle');
  assert.equal(await c.page.locator('.gs-kpi, .gs-fig').count(), 0);
  assert.deepEqual(c.errors, []);
  await c.context.close();
});

await scenario('banco novo (tudo zero, médias sem número): "—" nas médias, 0 nas contagens e R$ 0,00, nada inventado', async () => {
  const { page, errors, context } = await newPage(browser, { logged: true, db: { zero: true, charges: [] } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  await page.waitForSelector('#cobVazia');
  assert.deepEqual([await kpiV(page, 'atendidos'), await kpiV(page, 'pedidos'), await kpiV(page, 'tele'), await kpiV(page, 'visitas')], ['0', '0', '0', '0']);
  assert.deepEqual([await kpiV(page, 'faturado'), await kpiV(page, 'receber'), await kpiV(page, 'cob-atrasado')], [brl(0), brl(0), brl(0)]);
  assert.deepEqual([await kpiV(page, 'espera'), await kpiV(page, 'duracao')], ['—', '—'], 'média sem número: "—"');
  assert.equal(await page.locator('[data-kpi="cob-atrasado"].gs-warn').count(), 0);
  // Agora: ninguém na fila (sem espera), ninguém em atendimento e nenhum médico; sem paciente, sem o aviso.
  assert.deepEqual(await agoraV(page), ['0', '—', '0', '0']);
  assert.equal(norm(await page.textContent('[data-kpi="agora-espera"] small')), 'ninguém na fila agora');
  assert.equal(await page.locator('#sec-agora .gs-warn, #gsAgoraAlerta .cl-note').count(), 0, 'ninguém esperando: sem o aviso de nenhum médico');
  assert.equal(await page.textContent('#gsAgoraFala'), '', 'ao abrir, nada é lido sozinho');
  assert.equal(norm(await page.textContent('[data-kpi="agora-medicos"] small')), MED_VARIOS);
  assert.equal(await page.locator('#app path.gs-bar').count(), 0, 'nenhuma coluna ou barra com zero');
  assert.match(await page.getAttribute('figure[data-fig="funil-agenda"] svg', 'aria-label'), /^Agendamento: da busca ao atendimento: abriram a busca \(perto de mim\) 0, abriram a página de um local 0 \(— da etapa anterior\)/);
  assert.equal(norm(await page.textContent('#gsAgT')), 'Aguardando conferência (0)');
  assert.equal(norm(await page.textContent('#gsAguardando')), 'Nenhum médico aguardando conferência.');
  assert.equal(norm(await page.textContent('[data-fig="docs"] .gs-empty')), 'Nenhum documento emitido no período.');
  assert.equal(norm(await page.textContent('[data-fig="avaliacoes"] .gs-empty')), 'Nenhuma avaliação no período.');
  assert.deepEqual(await page.locator('ol.gs-flow .gs-fx-n').allTextContents(), ['0', '0', '0', '0', '0', '0']);
  assert.match(norm(await page.textContent('ol.gs-flow .gs-fs3')), /aprovados$/, 'sem a média de aprovação');
  assert.equal(norm(await page.textContent('#cobVazia')), 'Ainda não há cobranças registradas.');
  assert.equal(await page.isDisabled('#cobCsv'), true, 'planilha vazia: botão desligado');
  assert.equal(await page.locator('#cobResumo .gs-canc').count(), 0, 'sem canceladas, sem a linha');
  const txt = await page.evaluate(() => document.querySelector('#app').innerText);
  assert.ok(!/NaN|undefined|null|Infinity/.test(txt), 'nada de NaN, undefined ou null na tela');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('resposta incompleta do banco: nada inventado (sem hora, sem total, cobrança sem retorno busca a lista de novo)', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true, db: {
    patchGestao: (g) => ({ ...g, gerado_em: null, medicos: { ...g.medicos, pendente: null } }), statusSemRetorno: true, pagoEmBanco: '2026-10-30T14:58:00Z',
  } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  await page.waitForSelector('#cobLista table');
  assert.equal(norm(await page.textContent('#gsHora')), '', 'sem a hora do banco, sem hora (nada do relógio do aparelho)');
  assert.equal(await page.isHidden('#gsAgoraHora'), true, 'nem no bloco "Agora"');
  assert.deepEqual(await agoraV(page), ['1', '7 min', '0', '1'], 'os números de agora continuam');
  assert.match(norm(await page.textContent('#gsWhen')), /^Números de 01\/10\/2026 a 30\/10\/2026 \(30 dias\), no horário de São Paulo\.$/);
  assert.equal(norm(await page.textContent('#gsAgT')), 'Aguardando conferência (—)', 'sem o total do banco: "—" (a lista vem cortada em 50)');
  assert.equal(await page.locator('#gsAguardando li').count(), 2);
  // O banco não devolve a cobrança: a lista é buscada de novo e a data do pagamento é a do banco (11:58), não a daqui (12:00).
  const n = calls(log, '/rpc/admin_cobranca_listar').length;
  await page.click(`#cob-${ID(1)} [data-pay]`);
  await page.selectOption(`#forma-${ID(1)}`, 'pix');
  await page.click(`#cob-${ID(1)} [data-confirm-pay]`);
  await page.waitForFunction((sel) => /Paga/.test(document.querySelector(sel)?.textContent || ''), `#cob-${ID(1)}`);
  assert.equal(calls(log, '/rpc/admin_cobranca_listar').length, n + 1, 'buscou a lista de novo');
  assert.match(norm(await page.innerText(`#cob-${ID(1)}`)), /Paga em 30\/10\/2026 às 11:58 · Pix/, 'a data do pagamento é a do banco');
  assert.equal(await page.evaluate(() => document.activeElement?.id), `st-${ID(1)}`, 'foco na situação, depois de buscar a lista');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('entrada vencida: volta para o quadro de entrar sem mostrar nada', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true, expired: true, db: { failRefresh: true } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#flash .cl-note.warn');
  assert.match(norm(await page.textContent('#flash')), /Sua entrada expirou\. Entre de novo abaixo \(link por e-mail ou senha\)\./);
  assert.equal(await page.getAttribute('#flash', 'aria-live'), 'polite', 'o aviso é lido mesmo com o foco indo para o e-mail');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'loginEmail');
  await page.waitForSelector('#loginEmail');
  assert.equal(dataCalls(log).length, 0, 'nenhuma chamada de dados');
  assert.equal(await page.evaluate(() => localStorage.getItem('imed_session')), null);
  assert.equal(norm(await page.textContent('#app')), '');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('volta do link do e-mail: entra, confere a equipe e mostra os números', async () => {
  const { page, log, errors, context } = await newPage(browser);
  await page.goto(`${BASE}gestao.html#access_token=tok-link&refresh_token=r1&expires_in=3600&token_type=bearer`);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  assert.equal(new URL(page.url()).hash, '', 'o endereço fica sem o token');
  assert.match(norm(await page.textContent('#flash')), /Pronto, você entrou\./);
  assert.equal(calls(log, '/rpc/is_imed_admin')[0].auth, 'Bearer tok-link');
  assert.equal(calls(log, '/rpc/admin_gestao')[0].auth, 'Bearer tok-link');
  // sair limpa tudo
  await page.click('[data-signout]');
  await page.waitForSelector('#loginEmail');
  assert.equal(await page.locator('.gs-kpi').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (390 px): sem rolagem lateral, gráficos na largura da tela, fluxograma em pé e cobranças em cartões', async () => {
  const { page, errors, context, db } = await newPage(browser, { mobile: true, logged: true, db: {} });
  db.charges.push({ ...CHARGES[0], id: ID(9), descricao: 'Descrição bem comprida sem espaço: '.concat('x'.repeat(120)), pagador_nome: 'N'.repeat(100), obs: 'o'.repeat(300) });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  await page.waitForSelector('#cobLista table');
  await noOverflow(page);
  for (const id of ['atend', 'visitas', 'funil-agenda', 'funil-tele', 'st-pedidos', 'st-tele', 'docs', 'meses']) {
    const [w, cw] = await page.locator(`figure[data-fig="${id}"]`).evaluate((f) => [Number(f.querySelector('svg').getAttribute('width')), f.querySelector('.gs-chart').clientWidth]);
    assert.equal(w, cw, `${id}: desenhado na largura do celular`);
    assert.ok(w <= 370, `${id}: ${w}px`);
  }
  // textos dos gráficos dentro do desenho
  const out = await page.evaluate(() => [...document.querySelectorAll('.gs-svg')].flatMap((svg) => {
    const b = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('text')].filter((t) => { const r = t.getBoundingClientRect(); return r.left < b.left - 1 || r.right > b.right + 1; }).map((t) => t.textContent);
  }));
  assert.deepEqual(out, [], 'nenhum texto sai do gráfico');
  // fluxograma em pé: etapas uma embaixo da outra, ramos ao lado
  const pos = await page.locator('ol.gs-flow li').evaluateAll((li) => Object.fromEntries(li.map((x) => { const r = x.getBoundingClientRect(); return [x.className.split(' ')[1], [Math.round(r.left), Math.round(r.top)]]; })));
  assert.ok(pos['gs-fs1'][1] < pos['gs-fs2'][1] && pos['gs-fs2'][1] < pos['gs-fs3'][1] && pos['gs-fs3'][1] < pos['gs-fs4'][1], 'etapas descendo');
  assert.ok(pos['gs-fb2'][0] > pos['gs-fs2'][0] && pos['gs-fb2'][1] === pos['gs-fs2'][1], 'Recusado ao lado da conferência');
  // tabelas abertas e a cobrança com o pagamento aberto (forma e "Pago em")
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
  await noOverflow(page);
  await page.click(`#cob-${ID(1)} [data-pay]`);
  await noOverflow(page);
  const card = await page.locator(`#cob-${ID(1)}`).evaluate((tr) => getComputedStyle(tr).display);
  assert.equal(card, 'block', 'cobrança vira cartão');
  const [pw, cw] = await page.locator(`#pagoem-${ID(1)}`).evaluate((el) => [el.getBoundingClientRect().right, el.closest('tr').getBoundingClientRect().right]);
  assert.ok(pw <= cw, '"Pago em" dentro do cartão');
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = false; });
  await shot(page, 'gestao-13-celular');
  await shot(page, 'gestao-14-celular-fluxograma', '#sec-medicos');
  await shot(page, 'gestao-15-celular-cobranca', '#sec-cobranca');
  // 12 meses no celular: as colunas somam semanas (52 colunas que dá para ler, sem uma em cima da outra).
  await page.click('.gs-seg label:has-text("12 meses")');
  await page.waitForFunction(() => document.querySelectorAll('[data-mini="pedidos"] rect.gs-hit').length === 52);
  await noOverflow(page);
  for (const k of ['pedidos', 'tele_pedidas', 'tele_encerradas', 'documentos']) {
    const r = await page.locator(`[data-mini="${k}"] svg`).evaluate((svg) => {
      const w = Number(svg.getAttribute('width'));
      const slot = Number(svg.querySelector('rect.gs-hit').getAttribute('width'));
      const bars = [...svg.querySelectorAll('path.gs-bar')].map((p) => { const b = p.getBBox(); return [b.x, b.x + b.width]; }).sort((a, c) => a[0] - c[0]);
      return { w, cw: svg.parentElement.clientWidth, slot, bars };
    });
    assert.equal(r.w, r.cw, `${k}: desenhado na largura do celular`);
    assert.ok(r.slot >= 4, `${k}: cada semana com ${r.slot} px`);
    assert.ok(r.bars.every(([a, b]) => b - a >= 2 && b - a <= r.slot * 0.8 + 0.11), `${k}: colunas de 2 px até 80% da semana`);
    for (let i = 1; i < r.bars.length; i += 1) assert.ok(r.bars[i][0] >= r.bars[i - 1][1] - 0.01, `${k}: nenhuma coluna em cima da outra`);
  }
  const fora = await page.evaluate(() => [...document.querySelectorAll('.gs-svg')].flatMap((svg) => {
    const b = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('text')].filter((t) => { const r = t.getBoundingClientRect(); return r.left < b.left - 1 || r.right > b.right + 1; }).map((t) => t.textContent);
  }));
  assert.deepEqual(fora, [], 'nenhum texto sai do gráfico em 12 meses');
  await shot(page, 'gestao-16-celular-12-meses', '#sec-atend');
  // alvos de toque de 44 px nos controles da gestão
  const small = await page.evaluate(() => [...document.querySelectorAll('#app button, #app a.btn, #app select, .gs-seg label, .gs-toc a, #app summary')]
    .filter((el) => el.offsetParent).map((el) => [el.textContent.trim().slice(0, 30), Math.round(el.getBoundingClientRect().height)]).filter(([, h]) => h < 43.5));
  assert.deepEqual(small, [], 'alvos de toque com 44 px');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('celular (360 px): bloco "Agora" com os números inteiros, dois por linha, o aviso cabendo e a página toda sem rolagem lateral', async () => {
  // Fila cheia e nenhum médico (o caso de texto mais comprido: "1 h 59 min" e o aviso).
  const { page, errors, context } = await newPage(browser, { mobile: true, width: 360, logged: true, db: { agora: { aguardando: 12, espera_mais_longa_min: 119, em_atendimento: 3, medicos_disponiveis: 0 } } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-agora:not([hidden]) .gs-kpi');
  await page.waitForSelector('#cobLista table');
  assert.equal(page.viewportSize().width, 360);
  await noOverflow(page);
  assert.deepEqual(await agoraV(page), ['12', '1 h 59 min', '3', '0']);
  // Dois números por linha, cada um inteiro dentro do quadro dele e do bloco (nada cortado nem para fora).
  const k = await page.locator('#gsAgoraKpis .gs-kpi').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const v = el.querySelector('.gs-kpi-v');
    return { l: r.left, r: r.right, t: Math.round(r.top), cabe: v.scrollWidth <= v.clientWidth + 1 && el.scrollWidth <= el.clientWidth + 1 };
  }));
  assert.ok(k[0].t === k[1].t && k[2].t === k[3].t && k[2].t > k[0].t, 'dois por linha');
  assert.ok(k.every((x) => x.cabe), 'nenhum número cortado');
  const sec = await page.locator('#sec-agora').evaluate((el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right }; });
  assert.ok(k.every((x) => x.l >= sec.l - 0.5 && x.r <= sec.r + 0.5), 'os números dentro do bloco');
  assert.ok(sec.l >= 0 && sec.r <= 360, `o bloco dentro da tela: ${sec.l}..${sec.r}`);
  const aviso = await page.locator('#gsAgoraAlerta .cl-note').evaluate((el) => { const r = el.getBoundingClientRect(); return [r.left, r.right, el.scrollWidth <= el.clientWidth + 1]; });
  assert.ok(aviso[0] >= sec.l && aviso[1] <= sec.r && aviso[2], 'o aviso de nenhum médico cabe');
  await shot(page, 'gestao-20-celular-360-agora', '#sec-agora');
  // A página toda em 360 px: tabelas abertas, o quadro de pagamento aberto e 12 meses, sem rolagem lateral.
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
  await noOverflow(page);
  await page.click(`#cob-${ID(1)} [data-pay]`);
  await noOverflow(page);
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = false; });
  await page.click('.gs-seg label:has-text("12 meses")');
  await page.waitForFunction(() => document.querySelectorAll('[data-mini="pedidos"] rect.gs-hit').length === 52);
  await noOverflow(page);
  assert.deepEqual(await agoraV(page), ['12', '1 h 59 min', '3', '0'], 'os de agora não mudam com o período');
  const fora = await page.evaluate(() => [...document.querySelectorAll('.gs-svg')].flatMap((svg) => {
    const b = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('text')].filter((t) => { const r = t.getBoundingClientRect(); return r.left < b.left - 1 || r.right > b.right + 1; }).map((t) => t.textContent);
  }));
  assert.deepEqual(fora, [], 'nenhum texto sai do gráfico');
  // Alvos de toque de 44 px.
  const small = await page.evaluate(() => [...document.querySelectorAll('#app button, #app a.btn, #app select, .gs-seg label, .gs-toc a, #app summary')]
    .filter((el) => el.offsetParent).map((el) => [el.textContent.trim().slice(0, 30), Math.round(el.getBoundingClientRect().height)]).filter(([, h]) => h < 43.5));
  assert.deepEqual(small, [], 'alvos de toque com 44 px');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('telas médias (768 a 1080 px): bloco "Agora" com dois por linha e cada valor numa linha só; de 1100 px em diante, os 4 lado a lado', async () => {
  // Os valores mais compridos: "menos de 1 min" e "1 h 59 min" (e 4 algarismos na fila).
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, db: { agora: { aguardando: 1234, espera_mais_longa_min: 0, em_atendimento: 12, medicos_disponiveis: 0 } } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-agora:not([hidden]) .gs-kpi');
  await page.waitForSelector('#cobLista table');
  await page.evaluate(() => document.fonts.ready);
  const medir = () => page.locator('#gsAgoraKpis .gs-kpi').evaluateAll((els) => els.map((el) => {
    const v = el.querySelector('.gs-kpi-v');
    return { top: Math.round(el.getBoundingClientRect().top), linhas: Math.round(v.getBoundingClientRect().height / parseFloat(getComputedStyle(v).lineHeight)), cabe: v.scrollWidth <= v.clientWidth + 1 };
  }));
  const casos = [
    [null, ['1.234', 'menos de 1 min', '12', '0']],
    [{ aguardando: 12, espera_mais_longa_min: 119, em_atendimento: 3, medicos_disponiveis: 0 }, ['12', '1 h 59 min', '3', '0']],
  ];
  for (const [agora, valores] of casos) {
    if (agora) { db.agora = agora; await atualizar(page, log); }
    assert.deepEqual(await agoraV(page), valores);
    for (const width of [768, 800, 900, 1024, 1080, 1100, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const k = await medir();
      assert.equal(new Set(k.map((x) => x.top)).size, width <= 1080 ? 2 : 1, `${width} px: ${width <= 1080 ? 'dois por linha' : 'os 4 lado a lado'}`);
      assert.ok(k.every((x) => x.linhas === 1 && x.cabe), `${width} px: cada valor numa linha só ${JSON.stringify(k)}`);
      await noOverflow(page);
    }
  }
  await page.setViewportSize({ width: 768, height: 900 });
  await shot(page, 'gestao-23-tela-768-agora', '#sec-agora');
  assert.deepEqual(errors, []);
  await context.close();
});

/* ======================= o visual de painel (dashboard) ======================= */
// Lado a lado: os cartões começam na mesma altura da tela e um à direita do outro.
const caixas = (page, sels) => page.evaluate((list) => list.map((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { sel, l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width) }; }), sels);
const ladoALado = async (page, sels, msg) => {
  const c = await caixas(page, sels);
  assert.ok(c.every((x) => Math.abs(x.t - c[0].t) <= 1), `${msg}: na mesma linha ${JSON.stringify(c)}`);
  for (let i = 1; i < c.length; i += 1) assert.ok(c[i].l >= c[i - 1].r, `${msg}: um ao lado do outro ${JSON.stringify(c)}`);
};
const empilhados = async (page, sels, msg) => {
  const c = await caixas(page, sels);
  for (let i = 1; i < c.length; i += 1) assert.ok(c[i].t >= c[i - 1].b, `${msg}: um embaixo do outro ${JSON.stringify(c)}`);
};
const parteAtual = (page) => page.evaluate(() => [...document.querySelectorAll('.gs-toc a[aria-current="true"]')].map((a) => a.getAttribute('href')));
const rolaAte = async (page, sel, folga = 0) => {
  await page.evaluate(([s, f]) => { const pad = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gs-fixo')) || 0; window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - pad + f); }, [sel, folga]);
  await quadros(page);
  await quadros(page);
};
// Contraste (WCAG) entre a cor de cada elemento que combina com o seletor e o fundo opaco mais próximo atrás dele, com
// as cores que o navegador de fato usou (tema claro ou escuro). Devolve o menor (null: nenhum elemento).
// prop: 'color' (texto), 'stroke', 'fill' ou 'backgroundColor'. fundoSel: o fundo é o preenchimento desse elemento do
// gráfico (o trilho das barras) ou, se não for desenho, o fundo dele e dos que estão em volta.
const contraste = (page, sel, prop = 'color', fundoSel = null) => page.evaluate(([s, p, fs]) => {
  const cv = document.createElement('canvas');
  cv.width = 1; cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
  const lum = ([r, g, b]) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fundoDe = (el) => {
    const de = fs ? (el.closest('svg')?.querySelector(fs) || document.querySelector(fs)) : el.parentElement;
    if (de instanceof SVGElement && de.tagName !== 'svg') return rgba(getComputedStyle(de).fill);
    for (let n = p === 'color' && !(el instanceof SVGElement) ? el : de; n; n = n.parentElement) {
      if (n instanceof SVGElement) continue;
      const b = rgba(getComputedStyle(n).backgroundColor);
      if (b[3] >= 250) return b;
    }
    return [255, 255, 255, 255];
  };
  const todos = [...document.querySelectorAll(s)];
  if (!todos.length) return null;
  return Math.min(...todos.map((el) => { const [a, c] = [lum(rgba(getComputedStyle(el)[p])), lum(fundoDe(el))].sort((x, y) => y - x); return Math.round(((a + 0.05) / (c + 0.05)) * 100) / 100; }));
}, [sel, prop, fundoSel]);

await scenario('painel no computador: trilho das partes fixo à esquerda (destaca a parte em que a pessoa está), cartões lado a lado em 1100, 1280, 1440 e 1920 px, tudo à vista e sem rolagem lateral', async () => {
  const { page, errors, context } = await newPage(browser, { logged: true });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  await page.waitForSelector('#cobLista table');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('gs-painel')), true, 'com a conta da equipe, a página vira painel');
  // Trilho lateral (1280 px ou mais): à esquerda dos números, com todas as partes, e continua à vista ao rolar.
  const trilho = async () => (await caixas(page, ['.gs-toc', '#gsData']));
  let [toc, dados] = await trilho();
  assert.ok(toc.r <= dados.l && toc.w >= 180 && toc.w <= 260, `trilho à esquerda dos números ${JSON.stringify([toc, dados])}`);
  assert.equal(await page.locator('.gs-toc a').count(), await page.locator('#app section[id^="sec-"]:not(#sec-agora)').count(), 'uma entrada no trilho para cada parte');
  assert.equal(await page.locator('.gs-toc a i[aria-hidden="true"]').count(), await page.locator('.gs-toc a').count(), 'cada entrada com o seu ícone (enfeite)');
  assert.deepEqual(await parteAtual(page), ['#sec-resumo'], 'no alto da página: a primeira parte em destaque');
  await rolaAte(page, '#sec-fluxo');
  assert.deepEqual(await parteAtual(page), ['#sec-fluxo'], 'rolou: a parte que está no alto da tela fica em destaque (uma só)');
  [toc] = await trilho();
  assert.ok(toc.t >= 0 && toc.t <= 24 && toc.b <= 900, `o trilho continua à vista ao rolar ${JSON.stringify(toc)}`);
  // Clicar numa parte leva até ela, sem ficar debaixo da barra grudada.
  await page.click('.gs-toc a[href="#sec-clinicas"]');
  await quadros(page);
  await quadros(page);
  assert.deepEqual(await parteAtual(page), ['#sec-clinicas']);
  const [cli, barra] = await caixas(page, ['#sec-clinicas', '.gs-ctl']);
  assert.ok(cli.t >= barra.b - 1 && cli.t < 300, `a parte aparece logo abaixo da barra ${JSON.stringify([cli, barra])}`);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await quadros(page);
  await quadros(page);
  assert.deepEqual(await parteAtual(page), [await page.locator('.gs-toc a').last().getAttribute('href')], 'no fim da página: a última parte');
  await page.evaluate(() => window.scrollTo(0, 0));
  await quadros(page);
  // Nada escondido atrás de abas ou de "ver mais": o único abre-e-fecha é o "Ver em tabela" de cada gráfico.
  assert.equal(await page.locator('#gsData [role="tab"], #gsData [role="tabpanel"], #gsData [hidden], #sec-cobranca [role="tab"]').count(), 0);
  assert.deepEqual(await page.locator('#gsData details, #cobResumo details').evaluateAll((d) => [...new Set(d.map((x) => x.className))]), ['gs-tbl']);
  assert.equal(await page.locator('#app figure[data-fig]').count(), await page.locator('#app figure[data-fig] details.gs-tbl table').count(), 'todo gráfico com a sua tabela');
  // Cartões lado a lado. 1280 px: 3 números por linha; atendimentos + visualizações; os 2 funis; 3 gráficos de resultado.
  const grade = async (largura) => {
    await page.setViewportSize({ width: largura, height: 900 });
    await page.waitForFunction(() => [...document.querySelectorAll('#gsData [data-chart]')].every((el) => el.dataset.w === String(Math.round(el.clientWidth) || (el.classList.contains('gs-spark-box') ? 0 : 600))));
    await noOverflow(page);
    await ladoALado(page, ['figure[data-fig="atend"]', 'figure[data-fig="visitas"]'], `${largura}: atendimentos e visualizações`);
    await ladoALado(page, ['figure[data-fig="funil-agenda"]', 'figure[data-fig="funil-tele"]'], `${largura}: os dois funis`);
    await ladoALado(page, ['figure[data-fig="st-pedidos"]', 'figure[data-fig="st-tele"]', '[data-fig="docs"]'], `${largura}: situações e documentos, 3 por linha`);
    await ladoALado(page, ['[data-fig="avaliacoes"]', '[data-kpi="espera"]', '[data-kpi="duracao"]', '[data-kpi="parceiro"]', '[data-kpi="concierge"]'], `${largura}: avaliações e médias`);
    await ladoALado(page, ['#sec-clinicas .gs-pan:nth-child(1)', '#sec-clinicas .gs-pan:nth-child(2)', '#sec-clinicas .gs-pan:nth-child(3)'], `${largura}: os 3 quadros das clínicas`);
    await ladoALado(page, ['#cobKpis', 'figure[data-fig="meses"]'], `${largura}: totais e gráfico do faturamento`);
    // Faturamento e cobrança inteiro, na largura toda dos números, no fim.
    const [cob, gs] = await caixas(page, ['#sec-cobranca', '#gsData']);
    assert.ok(cob.l === gs.l && cob.r === gs.r && cob.t >= gs.b, `${largura}: cobrança em largura cheia, depois dos números`);
    assert.equal(await page.locator('#sec-cobranca #cobLista table').count() + await page.locator('#sec-cobranca #cobForm:not([hidden])').count(), 2, 'com a lista e o formulário');
    // Gráficos na largura do cartão e nenhum texto para fora do desenho.
    const fora = await page.evaluate(() => [...document.querySelectorAll('.gs-svg')].flatMap((svg) => {
      const b = svg.getBoundingClientRect();
      const larg = Number(svg.getAttribute('width')) === svg.parentElement.clientWidth ? [] : [`largura ${svg.closest('[data-chart]')?.dataset.chart}`];
      return [...larg, ...[...svg.querySelectorAll('text')].filter((t) => { const r = t.getBoundingClientRect(); return r.left < b.left - 1 || r.right > b.right + 1; }).map((t) => t.textContent)];
    }));
    assert.deepEqual(fora, [], `${largura}: gráficos na largura do cartão, textos dentro`);
    // Números inteiros numa linha, dentro do cartão.
    const cortados = await page.evaluate(() => [...document.querySelectorAll('#app .gs-kpi')].filter((k) => { const v = k.querySelector('.gs-kpi-v'); const r = v.getBoundingClientRect(); const c = k.getBoundingClientRect(); return v.scrollWidth > v.clientWidth + 1 || r.right > c.right + 0.5 || r.height > parseFloat(getComputedStyle(v).lineHeight) * 1.5; }).map((k) => k.dataset.kpi));
    assert.deepEqual(cortados, [], `${largura}: nenhum número cortado nem quebrado`);
    return page.locator('#gsKpis .gs-kpi').evaluateAll((k) => new Set(k.map((x) => Math.round(x.getBoundingClientRect().top))).size);
  };
  assert.equal(await grade(1280), 2, '1280: os 6 números principais em 2 linhas de 3');
  assert.equal(await grade(1440), 2, '1440: 2 linhas de 3');
  assert.equal(await grade(1920), 1, '1920: os 6 numa linha');
  [toc, dados] = await trilho();
  assert.ok(dados.r - toc.l <= 1560 && toc.r <= dados.l, 'tela muito larga: o painel não passa de 1560 px');
  // 1100 px: ainda cartões lado a lado, mas as partes viram fichas no alto (o trilho só cabe de 1280 px em diante).
  assert.equal(await grade(1100), 2);
  const [fichas, agora] = await caixas(page, ['.gs-toc', '#sec-agora']);
  assert.ok(fichas.b <= agora.t && fichas.w > 900, `1100: fichas no alto, na largura da página ${JSON.stringify(fichas)}`);
  // A página ficou bem mais curta que a coluna única de antes (≈8.100 px no computador).
  await page.setViewportSize({ width: 1280, height: 900 });
  await quadros(page);
  const altura = await page.evaluate(() => document.querySelector('#sec-cobranca').getBoundingClientRect().bottom + scrollY);
  assert.ok(altura < 6300, `página mais curta, do alto ao fim da cobrança: ${Math.round(altura)} px`);
  await shot(page, 'gestao-24-painel-1280');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('mini-curva nos cartões do resumo: só onde há série por dia vinda do banco; sem série, sem curva; tudo zero, uma linha reta; nada para o leitor de tela', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-resumo .gs-kpi svg.gs-spark');
  const curvas = () => page.locator('#gsKpis .gs-kpi').evaluateAll((k) => Object.fromEntries(k.map((x) => [x.dataset.kpi, x.querySelectorAll('svg.gs-spark').length])));
  // Os 6 cartões grandes, cada um com ícone, número e legenda; a curva só nos 3 que têm série por dia.
  assert.deepEqual(await curvas(), { atendidos: 0, pedidos: 1, tele: 1, visitas: 1, faturado: 0, receber: 0 });
  assert.equal(await page.locator('#gsKpis .gs-kpi .gs-kpi-l i.gs-kpi-ic[aria-hidden="true"]').count(), 6, 'ícone em cada cartão (enfeite)');
  assert.equal(await page.locator('#gsKpis .gs-kpi small').count(), 6, 'legenda curta em cada cartão');
  // É a mesma série do gráfico "por dia": um ponto por dia do período, o mais alto no dia de mais movimento.
  const pontos = (id) => page.locator(`[data-kpi="${id}"] path.gs-spark-l`).evaluate((p) => p.getAttribute('d').match(/[ML][\d.]+ [\d.]+/g).map((s) => s.slice(1).split(' ').map(Number)));
  const S = F30.serie;
  for (const [id, k] of [['pedidos', 'pedidos'], ['tele', 'tele_pedidas'], ['visitas', 'visitas']]) {
    const pts = await pontos(id);
    assert.equal(pts.length, 30, `${id}: um ponto por dia`);
    const v = S.map((x) => x[k]);
    const alto = Math.min(...pts.map(([, y]) => y));
    assert.deepEqual(pts.map(([, y], i) => (y === alto ? i : -1)).filter((i) => i >= 0), v.map((x, i) => (x === Math.max(...v) ? i : -1)).filter((i) => i >= 0), `${id}: os picos nos dias de mais movimento`);
    for (let i = 1; i < pts.length; i += 1) assert.ok(Math.sign(pts[i - 1][1] - pts[i][1]) === Math.sign(v[i] - v[i - 1]), `${id}: sobe e desce como a série (dia ${i})`);
  }
  // Enfeite: fora do leitor de tela, sem texto, dentro do cartão.
  assert.equal(await page.locator('#gsKpis svg.gs-spark:not([aria-hidden="true"]), #gsKpis svg.gs-spark text, #gsKpis svg.gs-spark[role]').count(), 0);
  assert.equal(await page.locator('#gsKpis .gs-spark-box:not([aria-hidden="true"])').count(), 0);
  const dentro = await page.locator('#gsKpis svg.gs-spark').evaluateAll((s) => s.every((x) => { const r = x.getBoundingClientRect(); const c = x.closest('.gs-kpi').getBoundingClientRect(); const v = x.closest('.gs-kpi').querySelector('.gs-kpi-v').getBoundingClientRect(); return r.left >= v.right && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom && r.width >= 40; }));
  assert.ok(dentro, 'a curva fica dentro do cartão, ao lado do número, sem encostar nele');
  await shot(page, 'gestao-25-cartoes-do-resumo', '#sec-resumo');
  // 12 meses: um ponto por semana (a mesma soma das colunas do gráfico grande).
  await page.click('.gs-seg label:has-text("12 meses")');
  await page.waitForFunction(() => document.querySelectorAll('[data-mini="pedidos"] rect.gs-hit').length === 52);
  assert.equal((await pontos('pedidos')).length, 52);
  // O banco sem a série por dia (ou com um dia só): os números continuam, sem curva nenhuma.
  for (const serie of [[], [{ dia: HOJE, visitas: 9, pedidos: 2, tele_pedidas: 1, tele_encerradas: 0, documentos: 0 }], null]) {
    db.patchGestao = (g) => ({ ...g, serie });
    await atualizar(page, log);
    assert.deepEqual(await curvas(), { atendidos: 0, pedidos: 0, tele: 0, visitas: 0, faturado: 0, receber: 0 }, `sem série, sem curva: ${JSON.stringify(serie)?.slice(0, 20)}`);
    assert.equal(await page.locator('#gsKpis .gs-spark-box').count(), 0, 'nem o lugar dela');
    assert.equal(await kpiV(page, 'pedidos'), int(gestao(365, CHARGES).pacientes.pedidos.total));
  }
  // Dia sem número no meio da série: a linha é interrompida ali (nada de ligar por cima do buraco).
  db.patchGestao = null;
  await page.click('.gs-seg label:has-text("30 dias")');
  await page.waitForFunction(() => document.querySelectorAll('[data-mini="pedidos"] rect.gs-hit').length === 30);
  db.patchGestao = (g) => ({ ...g, serie: g.serie.map((x, i) => (i === 10 ? { ...x, pedidos: null } : x)) });
  await atualizar(page, log);
  assert.equal((await page.getAttribute('[data-kpi="pedidos"] path.gs-spark-l', 'd')).match(/M/g).length, 2, 'dois trechos');
  assert.equal(await page.locator('[data-kpi="pedidos"] path.gs-spark-a').count(), 0, 'sem preenchimento por cima do buraco');
  assert.deepEqual(errors, []);
  await context.close();
  // Banco novo (tudo zero): uma linha reta na base, sem pico inventado.
  const z = await newPage(browser, { logged: true, db: { zero: true, charges: [] } });
  await z.page.goto(`${BASE}gestao.html`);
  await z.page.waitForSelector('#sec-resumo .gs-kpi svg.gs-spark');
  assert.equal(await z.page.locator('#gsKpis svg.gs-spark.gs-spark-zero').count(), 3);
  assert.equal(await z.page.locator('#gsKpis path.gs-spark-a').count(), 0);
  assert.equal(new Set((await z.page.getAttribute('[data-kpi="visitas"] path.gs-spark-l', 'd')).match(/[ML][\d.]+ ([\d.]+)/g).map((s) => s.split(' ')[1])).size, 1, 'todos os pontos na mesma altura');
  await shot(z.page, 'gestao-26-cartoes-tudo-zero', '#sec-resumo');
  assert.deepEqual(z.errors, []);
  await z.context.close();
});

await scenario('barra do período: gruda no alto ao rolar (computador e celular), continua funcionando grudada, não cobre o foco nem faz a página pular; carregando com esqueleto', async () => {
  const { page, log, errors, context, db } = await newPage(browser, { logged: true, db: { gestaoDelay: 500 } });
  await page.goto(`${BASE}gestao.html`);
  // Enquanto os números não chegam: o aviso de sempre (lido) e o contorno dos cartões (enfeite).
  await page.waitForSelector('#gsData[aria-busy="true"] .gs-skel');
  assert.equal(norm(await page.textContent('#gsData .gs-skel [role="status"]')), 'Carregando os números…');
  assert.equal(await page.getAttribute('#gsData .gs-skel-g', 'aria-hidden'), 'true');
  assert.ok(await page.locator('#gsData .gs-skel-g > span').count() >= 6);
  assert.equal(await page.locator('#gsData .gs-kpi, #gsData .gs-fig').count(), 0, 'nenhum número antes de o banco responder');
  await page.waitForSelector('#sec-resumo .gs-kpi');
  assert.equal(await page.locator('#gsData .gs-skel').count(), 0);
  db.gestaoDelay = 0;
  await page.waitForSelector('#cobLista table');
  // A barra tem o título curto, o período, "Atualizar números" e a hora da atualização junto.
  assert.equal(norm(await page.textContent('.gs-ctl .gs-ctl-t')), 'Painel de gestão');
  assert.equal(await page.locator('.gs-ctl input[name="gsDias"]').count(), 4);
  assert.equal(norm(await page.textContent('.gs-ctl #gsRefresh')), 'Atualizar números');
  assert.match(norm(await page.textContent('.gs-ctl #gsWhen')), /Atualizado às 12:00\.$/);
  assert.equal(await page.locator('.gs-ctl.gs-grudada').count(), 0, 'no alto da página, solta');
  // Rola até o meio: a barra fica no alto, por cima do conteúdo, e o período troca dali mesmo.
  await rolaAte(page, '#sec-result');
  await page.waitForSelector('.gs-ctl.gs-grudada');
  let [barra] = await caixas(page, ['.gs-ctl']);
  assert.ok(barra.t >= 0 && barra.t <= 16 && barra.b <= 90, `grudada no alto ${JSON.stringify(barra)}`);
  assert.equal(await page.evaluate(() => { const b = document.querySelector('.gs-ctl').getBoundingClientRect(); return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('.gs-ctl') !== null; }), true, 'por cima do conteúdo');
  assert.equal(await page.isVisible('#gsWhen'), true, 'no computador a hora continua à vista na barra');
  const noAlto = () => page.locator('#sec-result').evaluate((el) => el.getBoundingClientRect().top);
  const y0 = await noAlto();
  await page.click('.gs-seg label:has-text("7 dias")');
  await page.waitForFunction(() => document.querySelectorAll('[data-mini="pedidos"] rect.gs-hit').length === 7);
  assert.deepEqual(calls(log, '/rpc/admin_gestao').at(-1).body, { p_days: 7 });
  await quadros(page);
  assert.ok(Math.abs(await noAlto() - y0) <= 2, 'trocar o período com a barra grudada: a parte que estava na tela fica no mesmo lugar');
  assert.match(norm(await page.textContent('#gsWhen')), /\(7 dias\)/);
  // Foco pelo teclado: o que recebe o foco aparece abaixo da barra (não fica escondido atrás dela).
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await quadros(page);
  await page.locator('figure[data-fig="funil-agenda"] summary').focus();
  await quadros(page);
  const [foco, b2] = await caixas(page, ['figure[data-fig="funil-agenda"] summary', '.gs-ctl']);
  assert.ok(foco.t >= b2.b, `o foco fica abaixo da barra ${JSON.stringify([foco, b2])}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => !document.querySelector('.gs-ctl.gs-grudada'));
  assert.deepEqual(errors, []);
  await context.close();

  // Celular (390 px): fichas das partes no alto e, logo abaixo, a barra compacta (período e o botão de atualizar).
  const m = await newPage(browser, { mobile: true, logged: true });
  await m.page.goto(`${BASE}gestao.html`);
  await m.page.waitForSelector('#sec-resumo .gs-kpi');
  await m.page.waitForSelector('#cobLista table');
  await m.page.evaluate(() => document.fonts.ready);
  assert.equal(await m.page.isVisible('#gsWhen'), true, 'no alto da página, a linha das datas aparece');
  assert.equal(await m.page.isVisible('.gs-ctl .gs-ctl-t'), false, 'sem o título (não cabe)');
  assert.equal(norm(await m.page.textContent('#gsRefresh')), 'Atualizar números', 'o botão continua com o nome (para o leitor de tela), só o ícone à vista');
  const botao = await m.page.locator('#gsRefresh').evaluate((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  assert.ok(botao[0] >= 44 && botao[0] <= 56 && botao[1] >= 44, `botão de atualizar compacto, com 44 px de toque ${botao}`);
  await empilhados(m.page, ['.gs-toc', '#sec-agora', '.gs-ctl', '#sec-resumo'], 'celular');
  await rolaAte(m.page, '#sec-atend');
  await m.page.waitForSelector('.gs-ctl.gs-grudada');
  const [fichas, bm] = await caixas(m.page, ['.gs-toc', '.gs-ctl']);
  assert.ok(fichas.t === 0 && bm.t >= fichas.b - 1 && bm.t <= fichas.b + 1, `fichas no alto e a barra logo abaixo ${JSON.stringify([fichas, bm])}`);
  assert.ok(bm.b <= 130, `compacta: as duas juntas ocupam ${bm.b} px de 844`);
  assert.equal(await m.page.locator('#gsWhen').evaluate((el) => el.getBoundingClientRect().height <= 1), true, 'grudada, a linha das datas recolhe');
  assert.match(norm(await m.page.textContent('#gsWhen')), /Atualizado às 12:00\.$/, 'e continua para o leitor de tela');
  assert.deepEqual(await parteAtual(m.page), ['#sec-atend']);
  // A ficha da parte atual fica à vista (as fichas rolam de lado; a página, não).
  const ficha = await m.page.evaluate(() => { const n = document.querySelector('.gs-toc'); const a = n.querySelector('[aria-current="true"]').getBoundingClientRect(); return { rola: n.scrollWidth > n.clientWidth, l: a.left, r: a.right, w: innerWidth }; });
  assert.ok(ficha.rola && ficha.l >= 0 && ficha.r <= ficha.w, `ficha da parte atual à vista ${JSON.stringify(ficha)}`);
  await noOverflow(m.page);
  // Recolher a linha das datas não faz a página pular: o que estava na tela fica no mesmo lugar ao grudar e ao soltar.
  const topo = () => m.page.locator('#sec-resumo-h').evaluate((el) => el.getBoundingClientRect().top + scrollY);
  const t1 = await topo();
  await m.page.evaluate(() => window.scrollTo(0, 0));
  await m.page.waitForFunction(() => !document.querySelector('.gs-ctl.gs-grudada'));
  await quadros(m.page);
  assert.ok(Math.abs(await topo() - t1) <= 1, 'o conteúdo abaixo da barra não muda de lugar');
  assert.equal(await m.page.isVisible('#gsWhen'), true);
  // Trocar o período com a barra grudada, no celular.
  await rolaAte(m.page, '#sec-fluxo');
  await m.page.waitForSelector('.gs-ctl.gs-grudada');
  await m.page.tap('.gs-seg label:has-text("90 dias")');
  await m.page.waitForFunction(() => document.querySelectorAll('[data-mini="pedidos"] rect.gs-hit').length === 90);
  assert.deepEqual(calls(m.log, '/rpc/admin_gestao').at(-1).body, { p_days: 90 });
  await shot(m.page, 'gestao-27-celular-barra-grudada');
  assert.deepEqual(m.errors, []);
  await m.context.close();
});

await scenario('painel no celular de 360 px e no tablet: 2 cartões por linha, valores em dinheiro inteiros, sem rolagem lateral, toque de 44 px; "Tudo do IMED" compacto', async () => {
  // Valores compridos de propósito (centenas de milhares de reais).
  const caras = [{ ...CHARGES[1], id: ID(71), valor_cents: 12345678 }, { ...CHARGES[0], id: ID(72), valor_cents: 98765432, vencimento: '2026-10-01' }];
  const { page, errors, context } = await newPage(browser, { mobile: true, width: 360, logged: true, db: { charges: [...clone(CHARGES), ...caras] } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  await page.waitForSelector('#cobLista table');
  await page.evaluate(() => document.fonts.ready);
  await quadros(page);
  await noOverflow(page);
  assert.equal(await kpiV(page, 'faturado'), brl(12345678 + 49900));
  assert.equal(await kpiV(page, 'receber'), brl(98765432 + 33950));
  const linhas = (sel) => page.locator(sel).evaluateAll((k) => k.map((x) => Math.round(x.getBoundingClientRect().top)));
  const t = await linhas('#gsKpis .gs-kpi');
  assert.ok(t[0] === t[1] && t[2] === t[3] && t[4] === t[5] && t[2] > t[0] && t[4] > t[2], `resumo: 2 cartões por linha ${t}`);
  const t4 = await linhas('#sec-result .gs-kpis-4 .gs-kpi');
  assert.ok(t4[0] === t4[1] && t4[2] === t4[3] && t4[2] > t4[0], 'médias: 2 por linha');
  // "R$ 988.993,82" inteiro, numa linha, dentro do cartão (a letra diminui se precisar; nunca corta nem quebra no meio).
  const valores = await page.evaluate(() => [...document.querySelectorAll('#app .gs-kpi')].map((k) => { const v = k.querySelector('.gs-kpi-v'); const r = v.getBoundingClientRect(); const c = k.getBoundingClientRect(); return { id: k.dataset.kpi, txt: v.textContent, px: parseFloat(getComputedStyle(v).fontSize), ok: v.scrollWidth <= v.clientWidth + 1 && r.left >= c.left && r.right <= c.right + 0.5 && r.height <= parseFloat(getComputedStyle(v).lineHeight) * 1.5 }; }));
  assert.deepEqual(valores.filter((v) => !v.ok), [], 'nenhum número cortado nem quebrado');
  assert.ok(valores.every((v) => v.px >= 14), `letra dos números sempre legível (14 px ou mais): ${JSON.stringify(valores.filter((v) => v.px < 14))}`);
  assert.ok(valores.find((v) => v.id === 'receber').px < 20, 'o valor comprido diminuiu a letra para caber');
  // Gráficos um embaixo do outro, na largura da tela.
  await empilhados(page, ['figure[data-fig="atend"]', 'figure[data-fig="visitas"]', 'figure[data-fig="funil-agenda"]', 'figure[data-fig="funil-tele"]', 'figure[data-fig="st-pedidos"]', 'figure[data-fig="st-tele"]', '[data-fig="docs"]'], '360');
  // "Tudo do IMED" compacto: 2 atalhos por linha, com o nome à vista e a frase só para o leitor de tela.
  const areas = await linhas('#gsAreas a.gs-area');
  assert.ok(areas[0] === areas[1] && areas[2] === areas[3] && areas[4] === areas[5], '2 atalhos por linha');
  assert.ok(await page.locator('#gsAreas').evaluate((el) => el.getBoundingClientRect().height) < 300, 'bloco compacto no celular');
  assert.equal(await page.locator('#gsAreas a.gs-area > span > span').evaluateAll((s) => s.every((x) => x.textContent.trim().length > 10 && x.getBoundingClientRect().width <= 1)), true);
  // Alvos de toque: fichas, período, atualizar, "Ver em tabela" e os atalhos.
  const pequenos = await page.evaluate(() => [...document.querySelectorAll('.gs-toc a, .gs-seg label, #gsRefresh, #app summary, #gsAreas a.gs-area, #authCard button')]
    .filter((el) => el.offsetParent).map((el) => [el.textContent.trim().slice(0, 24), Math.round(el.getBoundingClientRect().height)]).filter(([, h]) => h < 43.5));
  assert.deepEqual(pequenos, [], 'alvos de toque com 44 px');
  await shot(page, 'gestao-28-celular-360-painel');
  // Tablet (768 a 1080 px): 3 números por linha, funis lado a lado, sem rolagem lateral.
  for (const width of [768, 820, 1024, 1080]) {
    await page.setViewportSize({ width, height: 1024 });
    await page.waitForFunction(() => [...document.querySelectorAll('#gsData figure [data-chart]')].every((el) => el.dataset.w === String(Math.round(el.clientWidth))));
    await noOverflow(page);
    const k = await linhas('#gsKpis .gs-kpi');
    assert.ok(k[0] === k[2] && k[3] === k[5] && k[3] > k[0], `${width}: 3 números por linha`);
    await ladoALado(page, ['figure[data-fig="funil-agenda"]', 'figure[data-fig="funil-tele"]'], `${width}: funis`);
    await ladoALado(page, ['figure[data-fig="st-pedidos"]', 'figure[data-fig="st-tele"]'], `${width}: situações`);
    const v = await page.evaluate(() => [...document.querySelectorAll('#app .gs-kpi')].filter((kk) => { const x = kk.querySelector('.gs-kpi-v'); return x.scrollWidth > x.clientWidth + 1 || x.getBoundingClientRect().right > kk.getBoundingClientRect().right + 0.5; }).map((kk) => kk.dataset.kpi));
    assert.deepEqual(v, [], `${width}: números inteiros`);
    const fora = await page.evaluate(() => [...document.querySelectorAll('.gs-svg')].flatMap((svg) => { const b = svg.getBoundingClientRect(); return [...svg.querySelectorAll('text')].filter((x) => { const r = x.getBoundingClientRect(); return r.left < b.left - 1 || r.right > b.right + 1; }).map((x) => x.textContent); }));
    assert.deepEqual(fora, [], `${width}: textos dentro dos gráficos`);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('painel no tema claro e no escuro: texto com contraste de 4,5:1 e gráficos com 3:1 (cores de fato usadas na tela); o ponto de "Agora" só pulsa com o movimento ligado', async () => {
  for (const tema of ['light', 'dark']) {
    for (const mobile of [false, true]) {
      const { page, errors, context } = await newPage(browser, { mobile, width: 360, logged: true, bypassCSP: true, db: { agora: { aguardando: 2, espera_mais_longa_min: 15, em_atendimento: 0, medicos_disponiveis: 0 } } });
      await page.emulateMedia({ colorScheme: tema, reducedMotion: 'reduce' }); // sem transição: as cores medidas são as finais
      await page.goto(`${BASE}gestao.html`);
      await page.waitForSelector('#sec-resumo .gs-kpi svg.gs-spark');
      await page.waitForSelector('#cobLista table');
      const onde = `${tema === 'dark' ? 'escuro' : 'claro'}, ${mobile ? 'celular' : 'computador'}`;
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor !== 'rgb(244, 248, 250)'), tema === 'dark', `${onde}: o tema do aparelho vale`);
      await rolaAte(page, '#sec-atend'); // com uma parte em destaque e a barra grudada
      const texto = ['#gsKpis .gs-kpi-v', '#gsKpis .gs-kpi-l', '#gsKpis .gs-kpi small', '.gs-toc a[aria-current="true"]', '.gs-toc a:not([aria-current])', '.gs-seg input:checked + span', '.gs-seg input:not(:checked) + span',
        '#gsRefresh', '#gsAreas .gs-area b', '#gsAreas .gs-areas-hd h2', '#sec-agora-h', '#gsAgoraHora', '#sec-agora .gs-kpi.gs-warn .gs-kpi-l', '#sec-agora .gs-kpi.gs-warn small', '#sec-agora .gs-kpi:not(.gs-warn) small',
        '#sec-atend-h', 'figure[data-fig="atend"] figcaption b', 'figure[data-fig="atend"] figcaption span', '.gs-mini-t small', '.gs-tbl summary', '.gs-one', '#sec-clinicas .gs-pan h3', '#sec-clinicas .gs-lista .gs-kpi-l',
        '#sec-clinicas .gs-lista small', '#sec-clinicas .gs-lista .gs-kpi.gs-warn small', '#cobKpis .gs-kpi-v', '#cobKpis .gs-kpi.gs-warn small', '.gs-svg text.gs-tick', '.gs-svg text.gs-lab', '.gs-svg text.gs-val'];
      // (a conta fica sobre o cabeçalho escuro no computador e num cartão no celular)
      texto.push(...(mobile ? ['#authCard .cl-who b', '#authCard .cl-who'] : ['#gsWhen', '.gs-ctl-t', '.gs-toc-t', '#gsAreas .gs-area > span > span']));
      for (const sel of texto) {
        const c = await contraste(page, sel, sel.includes('.gs-svg') ? 'fill' : 'color');
        assert.ok(c !== null && c >= 4.5, `${onde}: texto ${sel} com ${c}:1`);
      }
      // Gráficos e ícones (3:1): as mini-curvas, as colunas, a linha, as barras sobre o trilho e os ícones dos cartões.
      const grafico = [['#gsKpis [data-kpi="pedidos"] .gs-spark-l', 'stroke'], ['#gsKpis [data-kpi="visitas"] .gs-spark-l', 'stroke'], ['[data-mini="pedidos"] path.gs-bar', 'fill'], ['figure[data-fig="visitas"] path.gs-line', 'stroke'],
        ['figure[data-fig="meses"] path.gs-bar.gs-c1', 'fill'], ['figure[data-fig="meses"] path.gs-bar.gs-c2', 'fill'], ['#gsKpis .gs-k-at .gs-kpi-ic', 'color'], ['#gsKpis .gs-k-fx .gs-kpi-ic', 'color'], ['#gsKpis .gs-k-din .gs-kpi-ic', 'color'],
        ['.gs-toc a i', 'color'], ['.gs-live', 'backgroundColor'], ['#sec-agora .gs-kpi.gs-warn .gs-kpi-ic', 'color']];
      for (const [sel, prop] of grafico) {
        const c = await contraste(page, sel, prop);
        assert.ok(c !== null && c >= 3, `${onde}: gráfico ${sel} com ${c}:1`);
      }
      for (const fig of ['funil-agenda', 'funil-tele', 'st-pedidos', 'st-tele', 'docs']) {
        const c = await contraste(page, `[data-fig="${fig}"] path.gs-bar`, 'fill', 'rect.gs-track');
        assert.ok(c !== null && c >= 3, `${onde}: barras de ${fig} sobre o trilho com ${c}:1`);
      }
      // O preenchimento embaixo da linha das visualizações tem a cor da série (não a do texto).
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('figure[data-fig="visitas"] path.gs-area')).color === getComputedStyle(document.querySelector('figure[data-fig="visitas"] path.gs-line')).color), true, `${onde}: área na cor da série`);
      if (AXE) {
        await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
        assert.deepEqual(await runAxe(page), [], `${onde}: axe`);
      }
      if (!mobile) await shot(page, `gestao-29-painel-${tema === 'dark' ? 'escuro' : 'claro'}`);
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  // "Reduzir movimento": o ponto de "Agora" e o esqueleto ficam parados; com o movimento ligado, o ponto pulsa.
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const { page, context } = await newPage(browser, { logged: true });
    await page.emulateMedia({ reducedMotion });
    await page.goto(`${BASE}gestao.html`);
    await page.waitForSelector('#sec-agora:not([hidden]) .gs-live');
    const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.gs-live'), '::after').animationName);
    assert.equal(anim, reducedMotion === 'reduce' ? 'none' : 'gs-pulso', `movimento ${reducedMotion}`);
    assert.equal(await page.getAttribute('.gs-live', 'aria-hidden'), 'true');
    await context.close();
  }
});

await scenario('acessibilidade (axe): página da equipe no computador e no celular, sem violação grave', async () => {
  if (!AXE) { console.log('   aviso - axe-core não encontrado: auditoria pulada (use AXE_PATH=<pasta>/node_modules/axe-core)'); return; }
  for (const mobile of [false, true]) {
    // Com o bloco "Agora" em destaque (paciente esperando e nenhum médico disponível).
    const { page, errors, context, db } = await newPage(browser, { mobile, width: 360, logged: true, bypassCSP: true, db: { agora: { aguardando: 2, espera_mais_longa_min: 15, em_atendimento: 0, medicos_disponiveis: 0 } } });
    await page.goto(`${BASE}gestao.html`);
    await page.waitForSelector('#sec-resumo .gs-kpi');
    await page.waitForSelector('#cobLista table');
    await page.waitForSelector('#gsAgoraAlerta .cl-note');
    // Com todas as tabelas abertas ("Ver em tabela") e o quadro de pagamento aberto.
    await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
    await page.click(`#cob-${ID(1)} [data-pay]`);
    assert.deepEqual(await runAxe(page), [], mobile ? 'celular' : 'computador');
    // O quadro de "Voltar para pendente" (com o aviso) e um erro do banco dentro dele.
    await page.click(`#cob-${ID(1)} [data-back]`);
    await page.click(`#cob-${ID(2)} [data-reopen]`);
    db.charges = db.charges.filter((c) => c.id !== ID(2));
    await page.click(`#cob-${ID(2)} [data-confirm-reopen]`);
    await page.waitForSelector(`#acterr-${ID(2)} .cl-note.err`);
    assert.deepEqual(await runAxe(page), [], `${mobile ? 'celular' : 'computador'}: voltar para pendente, com erro`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  const { page, context } = await newPage(browser, { logged: true, bypassCSP: true, db: { admin: false } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#denyTitle');
  assert.deepEqual(await runAxe(page), [], 'aviso de sem permissão');
  await context.close();
});

/* ======================= agenda das clínicas (central do IMED, fase 4.4) ======================= */
const ceCalls = (log, fn) => log.filter((e) => e.path.endsWith(`/rpc/${fn}`));
const CE_UNICO = { clinicas: '#ceKpis', conflitos: '#ceConfConta', auditoria: '#ceAudForm', feriados: '#ceFerAviso', parametros: '[data-ce-par]', equipe: '#ceEqForm' };
async function abrirCentral(page, tab = null) {
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#cePainel #ceKpis');
  if (tab) await irPara(page, tab);
}
async function irPara(page, tab) {
  await page.click(`#ceTab-${tab}`);
  await page.waitForSelector(`#cePainel ${CE_UNICO[tab]}`);
  assert.equal(await page.getAttribute('#cePainel', 'aria-labelledby'), `ceTab-${tab}`);
}
// As células de uma linha da tabela, pelo nome da coluna (igual no computador e no celular).
const linha = (page, sel) => page.evaluate((q) => Object.fromEntries([...document.querySelector(q).children].map((c) => [c.dataset.label, c.textContent.replace(/\s+/g, ' ').trim()])), sel);
const focoId = (page) => page.evaluate(() => document.activeElement?.id || '');
const ceMsg = async (page) => norm(await page.textContent('#ceMsg'));
const FUSO_SP = 'Horário de Brasília (SP, RJ, MG, ES, PR, SC, RS, GO, DF)';
// Só as funções da central (e as do resto do painel): nenhuma leitura direta de tabela, nenhuma função de paciente.
const CE_PERMITIDAS = /^\/rest\/v1\/rpc\/(is_imed_admin|admin_gestao|admin_cobranca_listar|agenda_central_[a-z_]+|agenda_holiday_(save|remove))$/;
const soCentral = (log) => assert.deepEqual(log.filter((e) => e.path.startsWith('/rest/v1/') && !CE_PERMITIDAS.test(e.path)).map((e) => e.path), [], 'só as funções da central: nenhuma tabela e nenhuma função com dado de paciente');

await scenario('agenda das clínicas: no fim do painel, em abas (com teclado); clínicas com os números, o aviso de nenhum feriado nacional, filtro e atualizar', async () => {
  const { page, log, db, errors, context } = await newPage(browser, { logged: true });
  await abrirCentral(page);
  assert.equal(norm(await page.textContent('.gs-toc a[href="#sec-agenda"]')), 'Agenda das clínicas');
  assert.equal(norm(await page.textContent('#sec-agenda-h')), 'Agenda das clínicas');
  assert.match(norm(await page.textContent('#sec-agenda > .cl-help')), /Aqui não aparece dado de paciente: só números, códigos e nomes de clínica\./);
  const ov = ceCalls(log, 'agenda_central_overview');
  assert.equal(ov.length, 1);
  assert.equal(ov[0].auth, 'Bearer tok-init', 'com a conta de quem entrou');
  assert.deepEqual(ov[0].body, {});
  assert.ok(log.findIndex((e) => e.path.endsWith('/rpc/is_imed_admin')) < log.findIndex((e) => e.path.endsWith('/rpc/agenda_central_overview')), 'só depois de o banco confirmar a equipe');
  // abas
  assert.equal(await page.getAttribute('#ceCorpo [role="tablist"]', 'aria-label'), 'Partes da agenda das clínicas');
  assert.deepEqual(await page.locator('#ceCorpo [role="tab"]').evaluateAll((l) => l.map((b) => `${b.textContent.replace(/\s+/g, ' ').trim()}|${b.getAttribute('aria-selected')}|${b.tabIndex}|${b.getAttribute('aria-controls')}`)),
    ['Clínicas|true|0|cePainel', 'Conflitos2 abertos|false|-1|cePainel', 'Auditoria|false|-1|cePainel', 'Feriados|false|-1|cePainel', 'Parâmetros|false|-1|cePainel', 'Equipe do IMED|false|-1|cePainel']);
  assert.equal(await page.getAttribute('#cePainel', 'role'), 'tabpanel');
  assert.equal(await page.getAttribute('#cePainel', 'aria-labelledby'), 'ceTab-clinicas');
  // números
  assert.deepEqual(await Promise.all(['ce-clinicas', 'ce-ativas', 'ce-online', 'ce-conflitos', 'ce-porvir', 'ce-fuso'].map((id) => kpiV(page, id))), ['4', '2', '0', '2', '20', '1']);
  assert.deepEqual(await page.locator('#ceKpis .gs-kpi.gs-warn').evaluateAll((l) => l.map((x) => x.dataset.kpi)), ['ce-conflitos', 'ce-fuso'], 'em destaque: conflitos abertos e fuso sem confirmar');
  assert.equal(norm(await page.textContent('#ceFeriadoAviso')), 'Nenhum feriado nacional foi lançado ainda. Enquanto isso, o IMED não oferece horário para marcar em nenhuma clínica. Lance os feriados na parte “Feriados”.');
  assert.ok(await page.locator('#ceFeriadoAviso.warn').count());
  assert.equal(norm(await page.textContent('#ceEstado')), 'Atualizado às 12:00. Esta parte confere sozinha, a cada 30 segundos, se algo mudou.');
  assert.equal(await page.locator('#ceEstado[aria-live], #cePainel[aria-live]').count(), 0, 'a atualização automática não é lida a cada vez');
  // por padrão, só as clínicas com a agenda ativa
  assert.equal(await page.inputValue('#ceClinFiltro'), 'ativas');
  assert.match(norm(await page.textContent('#ceClinConta')), /^2 clínicas \(com a agenda ativa\)\./);
  assert.equal(await page.locator('#ceClinTb tbody tr').count(), 2);
  assert.deepEqual(await linha(page, `#ceClinTb tr[data-clinica="${K(1)}"]`), {
    'Clínica': 'Imagem PaulistaSão Paulo · SP', 'Modalidade': 'Agenda no IMED', 'Agenda': 'AtivaSem venda online', 'Fuso': `${FUSO_SP}Confirmado em 20/10/2026`,
    'Feriados conferidos': 'Até 31/03/2027', 'Conflitos abertos': '2', 'Por vir': '17', 'Última atividade': '30/10/2026 às 11:40versão 42 · equipe de 4',
  });
  assert.deepEqual(await linha(page, `#ceClinTb tr[data-clinica="${K(2)}"]`), {
    'Clínica': 'Laboratório AnáliseCampinas · SP', 'Modalidade': 'Agenda no IMED, registro manual', 'Agenda': 'AtivaSem venda online', 'Fuso': `${FUSO_SP}Não confirmado`,
    'Feriados conferidos': 'Venceu em 15/10/2026', 'Conflitos abertos': '0', 'Por vir': '3', 'Última atividade': '29/10/2026 às 15:00versão 7 · equipe de 2',
  });
  assert.equal(await page.locator(`#ceClinTb tr[data-clinica="${K(2)}"] .bd-warn`).count(), 2, 'fuso não confirmado e feriados vencidos em destaque');
  await shot(page, 'agenda44-clinicas', '#sec-agenda');
  // todas: as sem agenda também, com o que o banco mandou como texto (nada vira HTML)
  await page.selectOption('#ceClinFiltro', 'todas');
  assert.equal(await page.locator('#ceClinTb tbody tr').count(), 4);
  assert.equal(await focoId(page), 'ceClinFiltro', 'o foco continua no filtro');
  assert.deepEqual(await linha(page, `#ceClinTb tr[data-clinica="${K(3)}"]`), {
    'Clínica': 'Clínica Sol <b>Norte</b>Manaus · AM', 'Modalidade': 'Pedido', 'Agenda': 'Não ativada', 'Fuso': 'Uma hora a menos que Brasília (Amazonas)Ainda não confirmado',
    'Feriados conferidos': '—', 'Conflitos abertos': '0', 'Por vir': '0', 'Última atividade': 'Nenhuma aindaequipe de 1',
  });
  assert.equal(await page.locator(`#ceClinTb tr[data-clinica="${K(3)}"] th b b`).count(), 0, 'o nome da clínica é texto');
  assert.match((await linha(page, `#ceClinTb tr[data-clinica="${K(4)}"]`))['Clínica'], /^Hospital VidaRecife · PE · demonstração · ainda não publicada$/);
  await page.selectOption('#ceClinFiltro', 'conflitos');
  assert.equal(await page.locator('#ceClinTb tbody tr').count(), 1);
  assert.match(norm(await page.textContent('#ceClinConta')), /^1 clínica \(com conflito aberto\)\./);
  // atualizar: busca de novo e o foco fica no botão (o número novo na tela diz que a resposta chegou e foi desenhada;
  // sem esperar por ele, a resposta podia chegar no meio dos passos seguintes e o teste falhava de vez em quando)
  const porVir = `#ceClinTb tr[data-clinica="${K(1)}"] [data-label="Por vir"]`;
  const desenhou = (n) => page.waitForFunction(([q, v]) => document.querySelector(q)?.textContent.trim() === v, [porVir, String(n)]);
  db.central.clinics[0].upcoming = 18;
  await page.click('#ceClinAtualizar');
  await desenhou(18);
  assert.equal(await focoId(page), 'ceClinAtualizar', 'depois de atualizar, o foco fica no botão');
  assert.equal(ceCalls(log, 'agenda_central_overview').length, 2);
  assert.equal(await page.inputValue('#ceClinFiltro'), 'conflitos', 'o filtro escolhido fica');
  // a pessoa foi para as abas enquanto o banco respondia: o foco fica onde ela pôs (não é puxado de volta para o botão)
  db.central.delay = { agenda_central_overview: 300 };
  db.central.clinics[0].upcoming = 19;
  await page.click('#ceClinAtualizar');
  await page.focus('#ceTab-clinicas');
  await desenhou(19);
  assert.equal(await focoId(page), 'ceTab-clinicas', 'quem saiu do botão enquanto atualizava continua onde estava');
  db.central.delay = null;
  assert.equal(ceCalls(log, 'agenda_central_overview').length, 3);
  // teclado nas abas: setas, End e Home (a aba ganha o foco e o painel troca)
  await page.focus('#ceTab-clinicas');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('#cePainel #ceConfConta');
  assert.equal(await focoId(page), 'ceTab-conflitos');
  assert.equal(await page.getAttribute('#ceTab-conflitos', 'aria-selected'), 'true');
  assert.equal(await page.getAttribute('#ceTab-clinicas', 'tabindex'), '-1');
  await page.keyboard.press('End');
  await page.waitForSelector('#cePainel #ceEqForm');
  assert.equal(await focoId(page), 'ceTab-equipe');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('#cePainel #ceKpis');
  assert.equal(await focoId(page), 'ceTab-clinicas', 'da última volta para a primeira');
  await page.keyboard.press('ArrowLeft');
  await page.waitForSelector('#cePainel #ceEqForm');
  await page.keyboard.press('Home');
  await page.waitForSelector('#cePainel #ceKpis');
  await page.keyboard.press('Tab');
  assert.equal(await focoId(page), 'cePainel', 'da aba, o Tab vai para o painel');
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await noOverflow(page);
  soCentral(log);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agenda das clínicas, conflitos: abertos de todas as clínicas (os mais antigos primeiro) e todos dos últimos 90 dias; nada do pedido nem do paciente', async () => {
  const { page, log, db, errors, context } = await newPage(browser, { logged: true });
  await abrirCentral(page, 'conflitos');
  assert.deepEqual(ceCalls(log, 'agenda_central_conflicts').at(-1).body, { p_all: false });
  assert.equal(norm(await page.textContent('#ceConfConta')), '2 conflitos abertos, os mais antigos primeiro.');
  assert.equal(await page.getAttribute('#cePainel > .cl-help a', 'href'), 'painel.html', 'resolver é na Área da clínica');
  assert.deepEqual(await page.locator('#ceConfTb tbody tr').evaluateAll((l) => l.map((r) => r.dataset.conflito.slice(-1))), ['1', '2']);
  assert.deepEqual(await linha(page, '#ceConfTb tbody tr:nth-child(1)'), {
    'Clínica': 'Imagem Paulista', 'O que houve': 'O horário não cabe mais na configuração', 'Horário do agendamento': 'qui., 05/11 às 14:30', 'Aberto em': '28/10/2026 às 09:00há 2 dias', 'Situação': 'Em andamento',
  });
  assert.deepEqual(await linha(page, '#ceConfTb tbody tr:nth-child(2)'), {
    'Clínica': 'Imagem Paulista', 'O que houve': 'Horário bloqueado pela clínica', 'Horário do agendamento': 'ter., 03/11 às 10:00', 'Aberto em': '30/10/2026 às 10:10há 2 h', 'Situação': 'Aberto',
  });
  await shot(page, 'agenda44-conflitos', '#sec-agenda');
  // todos dos últimos 90 dias: os resolvidos também, com o código da resolução em português; tipo que a tela não conhece aparece como veio
  await page.check('#ceConf-todos');
  await page.waitForFunction(() => document.querySelectorAll('#ceConfTb tbody tr').length === 4);
  assert.deepEqual(ceCalls(log, 'agenda_central_conflicts').at(-1).body, { p_all: true });
  assert.equal(await focoId(page), 'ceConf-todos', 'o foco fica na escolha');
  assert.equal(norm(await page.textContent('#ceConfConta')), '4 conflitos nos últimos 90 dias, 2 em aberto.');
  assert.deepEqual(await linha(page, '#ceConfTb tbody tr:nth-child(3)'), {
    'Clínica': 'Laboratório Análise', 'O que houve': 'Código: tipo_novo_do_banco', 'Horário do agendamento': 'Sem horário', 'Aberto em': '10/10/2026 às 09:00', 'Situação': 'Tirado da lista11/10/2026 às 09:00 · tirado da lista pela equipe',
  });
  assert.equal((await linha(page, '#ceConfTb tbody tr:nth-child(4)'))['Situação'], 'Resolvido21/10/2026 às 12:00 · remarcado');
  assert.equal(norm(await page.textContent('#ceConfN')), '2 abertos', 'o número da aba continua sendo o dos abertos');
  // sem conflito aberto: o número some da aba
  await page.check('#ceConf-abertos');
  await page.waitForFunction(() => document.querySelectorAll('#ceConfTb tbody tr').length === 2);
  db.central.conflicts = db.central.conflicts.filter((k) => !['aberto', 'em_andamento'].includes(k.status));
  await page.click('#ceConfAtualizar');
  await page.waitForSelector('#ceConfVazia');
  assert.equal(norm(await page.textContent('#ceConfVazia')), 'Nenhum conflito aberto agora.');
  assert.equal(norm(await page.textContent('#ceConfConta')), '0 conflitos abertos, os mais antigos primeiro.');
  assert.ok(await page.locator('#ceConfN').isHidden());
  // nada do pedido, do item ou do paciente no que foi pedido ao banco nem na tela
  assert.doesNotMatch(await page.textContent('#sec-agenda'), /request_id|item_id|telefone|@/i);
  soCentral(log);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agenda das clínicas, auditoria: quem mexeu em quê e as leituras de dado de paciente só somadas; filtros; código de conta inválido; conta sem a permissão', async () => {
  const { page, log, db, errors, context } = await newPage(browser, { logged: true });
  await abrirCentral(page, 'auditoria');
  assert.deepEqual(ceCalls(log, 'agenda_central_audit').at(-1).body, { p_filters: { days: 30 } });
  assert.deepEqual(await Promise.all(['ce-mudancas', 'ce-leituras', 'ce-leitores', 'ce-imed'].map((id) => kpiV(page, id))), ['4', '37', '3', '2']);
  assert.match(norm(await page.textContent('[data-kpi="ce-mudancas"]')), /desde 01\/10\/2026/);
  assert.deepEqual(await linha(page, '#ceMudTb tbody tr:nth-child(1)'), {
    'Quando': '30/10/2026 às 11:40', 'Clínica': 'Imagem Paulista', 'Quem': 'Recepçãoconta a1b2c3d4', 'O que fez': 'Bloqueou por cima de agendamentosBloqueio', 'Por onde': 'Painel da clínica',
  });
  assert.deepEqual(await linha(page, '#ceMudTb tbody tr:nth-child(2)'), {
    'Quando': '30/10/2026 às 10:00', 'Clínica': 'Todas (IMED)', 'Quem': 'Administração do IMEDconta e1e1e1e1', 'O que fez': 'Mudou um parâmetro globalParâmetro global', 'Por onde': 'Central do IMED',
  });
  // código que a tela ainda não conhece aparece como veio (nada escondido, nada inventado)
  assert.deepEqual(await linha(page, '#ceMudTb tbody tr:nth-child(4)'), {
    'Quando': '29/10/2026 às 09:00', 'Clínica': 'Imagem Paulista', 'Quem': 'Equipe técnica do IMED (correção manual)', 'O que fez': 'Código: acao_nova_do_bancoobjeto_novo', 'Por onde': 'Correção manualCódigo: teste_agenda',
  });
  assert.deepEqual(await linha(page, '#ceLeiTb tbody tr:nth-child(1)'), {
    'Dia': '30/10/2026', 'Clínica': 'Imagem Paulista', 'Quem': 'Recepçãoconta a1b2c3d4', 'O que abriu': 'Grade da agenda (nome curto)', 'Leituras': '31', 'Agendamentos diferentes': '—',
  });
  assert.deepEqual(await linha(page, '#ceLeiTb tbody tr:nth-child(2)'), {
    'Dia': '30/10/2026', 'Clínica': 'Imagem Paulista', 'Quem': 'Equipe do IMEDconta f0f0f0f0', 'O que abriu': 'Detalhe de um agendamentoMotivo: Suporte pedido pela clínica', 'Leituras': '2', 'Agendamentos diferentes': '1',
  });
  assert.deepEqual(await page.locator('#ceAudClinica option').evaluateAll((l) => l.map((o) => o.textContent)), ['Todas', 'Imagem Paulista', 'Laboratório Análise', 'Clínica Sol <b>Norte</b>', 'Hospital Vida']);
  assert.deepEqual(await page.locator('#ceAudObjeto option').evaluateAll((l) => l.map((o) => o.textContent)), ['Tudo', 'Bloqueio', 'Clínica', 'objeto_novo', 'Parâmetro global']);
  await shot(page, 'agenda44-auditoria', '#sec-agenda');
  // filtros: período, clínica e objeto
  await page.selectOption('#ceAudDias', '7');
  await page.selectOption('#ceAudClinica', K(2));
  await page.selectOption('#ceAudObjeto', 'clinic');
  await page.click('#ceAudAplicar');
  await page.waitForFunction(() => document.querySelectorAll('#ceMudTb tbody tr').length === 1);
  assert.deepEqual(ceCalls(log, 'agenda_central_audit').at(-1).body, { p_filters: { days: 7, clinic: K(2), object_type: 'clinic' } });
  assert.equal(await ceMsg(page), 'Filtros aplicados.');
  assert.equal(await focoId(page), 'ceAudAplicar');
  assert.deepEqual([await page.inputValue('#ceAudDias'), await page.inputValue('#ceAudClinica'), await page.inputValue('#ceAudObjeto')], ['7', K(2), 'clinic'], 'os filtros ficam como escolhidos');
  assert.equal((await linha(page, '#ceMudTb tbody tr:nth-child(1)'))['O que fez'], 'Trocou a modalidadeClínica');
  assert.equal(await page.locator('#ceLeiTb tbody tr').count(), 1);
  // "Aplicar filtros" sem internet: não diz "Filtros aplicados." e os filtros da tela voltam a ser os da tabela
  db.central.failNetFn = { agenda_central_audit: 1 };
  await page.selectOption('#ceAudClinica', K(3));
  await page.click('#ceAudAplicar');
  await page.waitForFunction(() => /Não foi possível aplicar os filtros agora/.test(document.querySelector('#ceMsg').textContent));
  assert.equal(await ceMsg(page), 'Não foi possível aplicar os filtros agora; a tabela abaixo ainda é a de antes.');
  assert.equal(await page.inputValue('#ceAudClinica'), K(2), 'o filtro volta à clínica da tabela');
  assert.equal(await page.locator('#ceMudTb tbody tr').count(), 1);
  // código de conta fora do formato: erro no campo, nada vai ao banco
  const n = ceCalls(log, 'agenda_central_audit').length;
  await page.fill('#ceAudConta', 'xyz');
  await page.click('#ceAudAplicar');
  assert.match(norm(await page.textContent('#ceAudContaErr')), /O código da conta tem 8 caracteres/);
  assert.equal(await page.getAttribute('#ceAudConta', 'aria-invalid'), 'true');
  assert.equal(await focoId(page), 'ceAudConta');
  assert.equal(ceCalls(log, 'agenda_central_audit').length, n);
  // código certo (maiúsculas viram minúsculas), todas as clínicas
  await page.selectOption('#ceAudDias', '30');
  await page.selectOption('#ceAudClinica', '');
  await page.selectOption('#ceAudObjeto', '');
  await page.fill('#ceAudConta', ' A1B2C3D4');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#ceAudConta')?.value === 'a1b2c3d4' && document.querySelectorAll('#ceMudTb tbody tr').length === 1);
  assert.deepEqual(ceCalls(log, 'agenda_central_audit').at(-1).body, { p_filters: { days: 30, actor: 'a1b2c3d4' } });
  assert.equal(await page.locator('#ceLeiTb tbody tr').count(), 1);
  // sem nada no período
  await page.fill('#ceAudConta', '00000000');
  await page.click('#ceAudAplicar');
  await page.waitForSelector('#ceMudVazia');
  assert.equal(norm(await page.textContent('#ceMudVazia')), 'Nenhuma mudança neste período com estes filtros.');
  assert.equal(norm(await page.textContent('#ceLeiVazia')), 'Nenhuma leitura neste período com estes filtros.');
  assert.deepEqual(await Promise.all(['ce-mudancas', 'ce-leituras', 'ce-leitores', 'ce-imed'].map((id) => kpiV(page, id))), ['0', '0', '0', '0']);
  // nunca qual paciente nem qual agendamento
  assert.doesNotMatch(await page.textContent('#sec-agenda'), /request_id|patient|old_value|new_value/);
  // conta da equipe sem a permissão da auditoria (papel de suporte, por exemplo): aviso, o resto continua
  db.central.auditForbidden = true;
  await irPara(page, 'clinicas');
  await page.click('#ceTab-auditoria');
  await page.waitForFunction(() => /A auditoria é só para o administrador e para quem tem o papel de auditoria\./.test(document.querySelector('#cePainel').textContent));
  assert.equal(await page.locator('#ceAudForm, #ceMudTb').count(), 0);
  await irPara(page, 'clinicas');
  soCentral(log);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agenda das clínicas, feriados: nenhum lançado; validar, conferir antes de lançar (clínicas e agendamentos atingidos), lançar, dia repetido, erro do banco e retirar com confirmação', async () => {
  const { page, log, db, errors, context } = await newPage(browser, { logged: true });
  await abrirCentral(page, 'feriados');
  assert.match(norm(await page.textContent('#ceFerAviso')), /^Nenhum feriado nacional foi lançado ainda\./);
  assert.equal(norm(await page.textContent('#ceFerVazia')), 'Nenhum feriado nacional lançado.');
  assert.deepEqual([await page.getAttribute('#ceFerDia', 'min'), await page.getAttribute('#ceFerDia', 'max')], ['2026-10-30', '2028-12-31']);
  for (const id of ['ceFerDia', 'ceFerNome', 'ceFerFonte']) assert.equal(await page.getAttribute(`#${id}`, 'aria-required'), 'true');
  // vazio: os três erros, foco no primeiro, nada vai ao banco
  await page.click('#ceFerLancar');
  assert.deepEqual(await Promise.all(['ceFerDiaErr', 'ceFerNomeErr', 'ceFerFonteErr'].map(async (id) => norm(await page.textContent(`#${id}`)))),
    ['Escolha o dia do feriado.', 'Escreva o nome do feriado (de 2 a 120 letras).', 'Informe a lei, o decreto ou a portaria que criou o feriado (de 3 a 300 letras).']);
  assert.equal(await focoId(page), 'ceFerDia');
  assert.equal(await page.getAttribute('#ceFerDia', 'aria-invalid'), 'true');
  // dia que já passou e ano digitado errado (esticaria o prazo de venda de todas as clínicas)
  await page.fill('#ceFerNome', 'Natal');
  await page.fill('#ceFerFonte', 'Fonte de teste (não é uma lei de verdade)');
  await page.fill('#ceFerDia', '2026-10-01');
  await page.click('#ceFerLancar');
  assert.equal(norm(await page.textContent('#ceFerDiaErr')), 'Escolha um dia de hoje em diante.');
  await page.fill('#ceFerDia', '2062-12-25');
  await page.click('#ceFerLancar');
  assert.equal(norm(await page.textContent('#ceFerDiaErr')), 'Use um dia até 31/12/2028.');
  assert.equal(ceCalls(log, 'agenda_central_holiday_preview').length, 0);
  assert.equal(ceCalls(log, 'agenda_holiday_save').length, 0);
  // certo: primeiro a conferência (só contagens), com os campos travados
  await page.fill('#ceFerDia', '2026-12-25');
  await page.click('#ceFerLancar');
  await page.waitForSelector('#ceFerPrevia');
  assert.deepEqual(ceCalls(log, 'agenda_central_holiday_preview').at(-1).body, { p_day: '2026-12-25' });
  assert.equal(norm(await page.textContent('#ceFerPreviaTxt')), 'Confira antes de lançar. sexta-feira, 25/12/2026: “Natal”. 2 clínicas com a agenda ativa fecham nesse dia. 3 agendamentos já marcados nesse dia vão para “Precisa de atenção” da clínica, para remarcar. O feriado vale para todas as clínicas na hora.');
  assert.equal(await focoId(page), 'ceFerOk', 'o foco vai para a confirmação');
  assert.equal(await page.getAttribute('#ceFerOk', 'aria-describedby'), 'ceFerPreviaTxt');
  assert.deepEqual(await page.locator('#ceFerDia, #ceFerNome, #ceFerFonte').evaluateAll((l) => l.map((x) => x.readOnly)), [true, true, true]);
  assert.equal(await page.locator('#ceFerLancar').count(), 0);
  assert.equal(ceCalls(log, 'agenda_holiday_save').length, 0, 'nada gravado antes da confirmação');
  await shot(page, 'agenda44-feriados-conferir', '#sec-agenda');
  // voltar: o que foi digitado fica e o foco volta para o botão
  await page.click('#ceFerPrevia [data-ce-back]');
  await page.waitForSelector('#ceFerLancar');
  assert.equal(await focoId(page), 'ceFerLancar');
  assert.deepEqual([await page.inputValue('#ceFerDia'), await page.inputValue('#ceFerNome')], ['2026-12-25', 'Natal']);
  // conferência sem internet: diz "conferir" (nada foi gravado) e o foco volta ao botão
  db.central.failNetFn = { agenda_central_holiday_preview: 1 };
  await page.focus('#ceFerLancar');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#ceFerErr .cl-note.err');
  assert.equal(norm(await page.textContent('#ceFerErr')), 'Não foi possível conferir agora. Tente de novo em instantes.');
  assert.equal(await focoId(page), 'ceFerLancar', 'o foco volta ao botão depois da falha');
  // erro do banco ao gravar: aparece dentro do quadro e nada muda
  await page.click('#ceFerLancar');
  await page.waitForSelector('#ceFerOk');
  db.central.saveError = 'invalid';
  await page.click('#ceFerOk');
  await page.waitForSelector('#ceQuadroErr .cl-note.err');
  assert.equal(norm(await page.textContent('#ceQuadroErr')), 'O banco não aceitou os dados. Confira e tente de novo.');
  assert.equal(await focoId(page), 'ceFerOk', 'erro do banco: o foco volta ao botão (não cai no começo da página)');
  assert.equal(db.central.holidays.length, 0);
  // confirmar: grava pela função da 3.2, com a fonte
  db.central.saveError = null;
  await page.click('#ceFerOk');
  await page.waitForSelector('#ceFerTb');
  assert.deepEqual(ceCalls(log, 'agenda_holiday_save').at(-1).body, { p_holiday: { scope: 'nacional', day: '2026-12-25', name: 'Natal', source: 'Fonte de teste (não é uma lei de verdade)' } });
  assert.equal(await ceMsg(page), 'Feriado lançado: Natal, 25/12/2026. 3 agendamentos foram para “Precisa de atenção” da clínica, para remarcar.');
  assert.equal(await page.getAttribute('#ceMsg', 'aria-live'), 'polite');
  assert.equal(await focoId(page), 'ceFerDia');
  assert.deepEqual([await page.inputValue('#ceFerDia'), await page.inputValue('#ceFerNome'), await page.inputValue('#ceFerFonte')], ['', '', ''], 'o formulário volta vazio');
  assert.deepEqual(await linha(page, '#ceFerTb tbody tr'), { 'Dia': '25/12/2026sexta-feira', 'Feriado': 'Natal', 'Fonte': 'Fonte de teste (não é uma lei de verdade)', 'Ações': 'Retirar: Natal, 25/12/2026' });
  assert.equal(norm(await page.textContent('#ceFerAviso')), 'Feriados nacionais lançados até 31/12/2026: nenhuma clínica oferece horário depois desse dia.');
  assert.ok(await page.locator('#ceFerAviso.info').count());
  await page.waitForFunction(() => /^5/.test(document.querySelector('#ceConfN').textContent), null, { timeout: 5000 });
  await shot(page, 'agenda44-feriados', '#sec-agenda');
  // o mesmo dia de novo: a conferência avisa, sem gravar
  await page.fill('#ceFerDia', '2026-12-25');
  await page.fill('#ceFerNome', 'Natal de novo');
  await page.fill('#ceFerFonte', 'Fonte de teste');
  await page.click('#ceFerLancar');
  await page.waitForSelector('#ceFerErr .cl-note.err');
  assert.equal(norm(await page.textContent('#ceFerErr')), 'Esse dia já está lançado como feriado nacional.');
  assert.equal(ceCalls(log, 'agenda_holiday_save').length, 2);
  // retirar: confirmação antes; "Voltar" devolve o foco; o rascunho do formulário fica
  const id = db.central.holidays[0].id;
  await page.click(`#ceFerDel-${id}`);
  await page.waitForSelector('#ceFerDelBox');
  assert.match(norm(await page.textContent('#ceFerDelTxt')), /^Retirar “Natal” de 25\/12\/2026\? As clínicas voltam a poder abrir nesse dia, e os agendamentos desse dia que o feriado mandou para “Para remarcar” e voltam a caber na agenda saem de lá sozinhos\./);
  assert.equal(await focoId(page), 'ceFerDelOk');
  assert.equal(await page.inputValue('#ceFerNome'), 'Natal de novo');
  await page.click('#ceFerDelBox [data-ce-back]');
  assert.equal(await focoId(page), `ceFerDel-${id}`);
  assert.match(norm(await page.textContent(`#ceFerDel-${id}`)), /Retirar/);
  assert.equal(ceCalls(log, 'agenda_holiday_remove').length, 0);
  await page.click(`#ceFerDel-${id}`);
  await page.click('#ceFerDelOk');
  await page.waitForSelector('#ceFerVazia');
  assert.deepEqual(ceCalls(log, 'agenda_holiday_remove').at(-1).body, { p_id: id });
  assert.equal(await ceMsg(page), 'Feriado retirado: Natal, 25/12/2026. 3 agendamentos voltaram a valer e saíram de “Para remarcar” da clínica.');
  await page.waitForFunction(() => /^2/.test(document.querySelector('#ceConfN').textContent), null, { timeout: 5000 }); // os 3 que o feriado abriu fecharam (5 → 2)
  assert.match(norm(await page.textContent('#ceFerAviso')), /^Nenhum feriado nacional foi lançado ainda\./);
  // feriado que já passou aparece marcado; os estaduais e municipais só são contados
  db.central.holidays = [{ id: 'hhhhhhhh-0000-4000-8000-000000000001', scope: 'nacional', uf: null, city_ibge: null, day: '2026-09-07', name: 'Independência', source: 'Fonte de teste', created_at: NOW },
    { id: 'hhhhhhhh-0000-4000-8000-000000000002', scope: 'uf', uf: 'SP', city_ibge: null, day: '2026-07-09', name: 'Data estadual de teste', source: 'Fonte de teste', created_at: NOW }];
  // "Atualizar" sem internet: avisa que os dados são os de antes
  db.central.failNetFn = { agenda_central_holidays: 1 };
  await page.click('#ceFerAtualizar');
  await page.waitForFunction(() => /Não foi possível atualizar agora/.test(document.querySelector('#ceMsg').textContent));
  assert.equal(await ceMsg(page), 'Não foi possível atualizar agora. Os dados abaixo ainda são os de antes.');
  await page.click('#ceFerAtualizar');
  await page.waitForSelector('#ceFerTb .gs-ce-passado');
  assert.match((await linha(page, '#ceFerTb tbody tr'))['Dia'], /^07\/09\/2026segunda-feira · já passou$/);
  assert.equal(await page.locator('#ceFerTb tbody tr').count(), 1, 'só os nacionais na lista');
  assert.match(norm(await page.textContent('#cePainel')), /Há também 1 feriado estadual ou municipal lançado\./);
  assert.equal(norm(await page.textContent('#ceFerAviso')), 'Feriados nacionais lançados até 31/12/2026: nenhuma clínica oferece horário depois desse dia.', 'o prazo é o fim do ano do último feriado nacional');
  soCentral(log);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agenda das clínicas, parâmetros: só o que o sistema lê; gravar dentro dos limites, o mesmo valor, voltar ao padrão; fica na auditoria', async () => {
  const { page, log, errors, context } = await newPage(browser, { logged: true });
  await abrirCentral(page, 'parametros');
  assert.equal(await page.locator('[data-ce-par]').count(), 1);
  assert.equal(norm(await page.textContent('#cePar0T')), 'Agendamentos por vir do mesmo telefone, na mesma clínica');
  assert.equal(norm(await page.textContent('#cePar0Vigor')), 'Valor em vigor: 3 (o padrão).');
  assert.deepEqual([await page.inputValue('#cePar0'), await page.getAttribute('#cePar0', 'min'), await page.getAttribute('#cePar0', 'max')], ['3', '1', '20']);
  assert.equal(await page.locator('#cePar0Padrao').count(), 0, 'sem "voltar ao padrão" enquanto vale o padrão');
  // fora dos limites: erro no campo, nada vai ao banco
  for (const v of ['0', '21', '']) {
    await page.fill('#cePar0', v);
    await page.click('#cePar0Gravar');
    assert.equal(norm(await page.textContent('#cePar0Err')), v === '' ? 'Digite um número inteiro.' : 'Use um número de 1 a 20.');
    assert.equal(await page.getAttribute('#cePar0', 'aria-invalid'), 'true');
  }
  assert.equal(ceCalls(log, 'agenda_central_setting_set').length, 0);
  await page.fill('#cePar0', '5');
  await page.click('#cePar0Gravar');
  await page.waitForSelector('#cePar0Padrao');
  assert.deepEqual(ceCalls(log, 'agenda_central_setting_set').at(-1).body, { p_key: 'agenda.limite_futuros_por_telefone', p_value: 5 });
  assert.equal(await ceMsg(page), 'Gravado: Agendamentos por vir do mesmo telefone, na mesma clínica = 5.');
  assert.equal(norm(await page.textContent('#cePar0Vigor')), 'Valor em vigor: 5, gravado em 30/10/2026 às 12:00. O padrão é 3.');
  assert.equal(await focoId(page), 'cePar0Gravar');
  await shot(page, 'agenda44-parametros', '#sec-agenda');
  await page.click('#cePar0Gravar');
  await page.waitForFunction(() => /nada mudou/.test(document.querySelector('#ceMsg').textContent));
  assert.equal(await ceMsg(page), 'O valor já era 5: nada mudou.');
  // a mudança aparece na auditoria
  await irPara(page, 'auditoria');
  assert.equal((await linha(page, '#ceMudTb tbody tr:nth-child(1)'))['O que fez'], 'Mudou um parâmetro globalParâmetro global');
  await irPara(page, 'parametros');
  await page.click('#cePar0Padrao');
  await page.waitForFunction(() => !document.querySelector('#cePar0Padrao'));
  assert.deepEqual(ceCalls(log, 'agenda_central_setting_set').at(-1).body, { p_key: 'agenda.limite_futuros_por_telefone', p_value: null });
  assert.equal(await ceMsg(page), 'Agendamentos por vir do mesmo telefone, na mesma clínica: voltou ao padrão (3).');
  assert.equal(norm(await page.textContent('#cePar0Vigor')), 'Valor em vigor: 3 (o padrão).');
  assert.equal(await page.inputValue('#cePar0'), '3');
  soCentral(log);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agenda das clínicas, avisos (5.3): o interruptor do envio com nome e explicação; a situação do envio só em números; falhas por clínica; celular e tema escuro', async () => {
  const avisos = { sending: false, due: 0, oldest_due_at: null, scheduled: 12, retrying: 0, last7: { sem_canal: 31, cancelada: 4, sem_contato: 2 }, failures: [] };
  let { page, log, errors, context } = await newPage(browser, { logged: true, db: { central: { avisos } } });
  await abrirCentral(page, 'parametros');
  await page.waitForSelector('#ceAvisos');
  assert.equal(await page.locator('[data-ce-par]').count(), 2, 'o interruptor do envio entra na lista de parâmetros');
  assert.equal(norm(await page.textContent('#cePar1T')), 'Envio de avisos e lembretes (0 = desligado, 1 = ligado)');
  assert.match(norm(await page.textContent('[data-ce-par="avisos.envio_ligado"]')), /Só coloque 1 depois que a função de envio estiver publicada e o e-mail do IMED estiver configurado/);
  assert.deepEqual([await page.inputValue('#cePar1'), await page.getAttribute('#cePar1', 'min'), await page.getAttribute('#cePar1', 'max')], ['0', '0', '1']);
  const quadro = norm(await page.textContent('#ceAvisos'));
  assert.match(quadro, /^Avisos e lembretes: situação do envio/);
  assert.match(quadro, /O envio está desligado: os avisos são só preparados, e o que chega à hora fica como “sem canal”\. Nenhum paciente e nenhuma clínica recebe aviso\./);
  assert.deepEqual(await page.locator('#ceAvisos [data-kpi]').evaluateAll((els) => els.map((e) => [e.dataset.kpi, e.querySelector('.gs-kpi-v').textContent])),
    [['avVencidos', '0'], ['avPreparados', '12'], ['avTentando', '0']]);
  assert.deepEqual(await page.locator('#ceAvisos [data-av]').evaluateAll((els) => els.map((e) => [e.dataset.av, e.textContent])),
    [['enviada', '0'], ['falhou', '0'], ['sem_canal', '31'], ['sem_contato', '2'], ['sem_consentimento', '0'], ['cancelada', '4']]);
  assert.match(quadro, /Nenhum aviso com falha de envio nos últimos 7 dias\./);
  assert.equal(await page.locator('#ceAvFalhas').count(), 0);
  soCentral(log);
  await shot(page, 'agenda53-avisos-central', '#sec-agenda');
  assert.deepEqual(errors, []);
  await context.close();

  // envio ligado, fila parada há mais de 10 minutos (alerta) e uma falha por clínica, com o código do erro
  const ligado = { sending: true, due: 3, oldest_due_at: '2026-10-30T14:40:00Z', scheduled: 5, retrying: 2, last7: { enviada: 40, falhou: 1 },
    failures: [{ clinic: 'Clínica Boa Imagem', event_type: 'lembrete_24h', channel: 'email', error: 'http_500', at: '2026-10-30T13:00:00Z' }] };
  ({ page, errors, context } = await newPage(browser, { logged: true, mobile: true, db: { central: { avisos: ligado } } }));
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await abrirCentral(page, 'parametros');
  await page.waitForSelector('#ceAvFalhas');
  const q2 = norm(await page.textContent('#ceAvisos'));
  assert.match(q2, /O envio está ligado\./);
  assert.doesNotMatch(q2, /O envio está desligado/);
  assert.equal(await page.locator('#ceAvisos [data-kpi="avVencidos"].gs-warn').count(), 1, 'fila parada há mais de 10 minutos: alerta');
  assert.match(norm(await page.textContent('#ceAvisos [data-kpi="avVencidos"]')), /Esperando envio agora3o mais antigo desde 30\/10\/2026 às 11:40/);
  assert.deepEqual(await page.locator('#ceAvFalhas tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.trim()))),
    [['Clínica Boa Imagem', 'Lembrete de 24 horas antes', 'E-mail', 'http_500', '30/10/2026 às 10:00']]);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(sw <= page.viewportSize().width, `sem rolagem lateral no celular (${sw}px)`);
  await shot(page, 'agenda53-avisos-central-celular-escuro', '#sec-agenda');
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agenda das clínicas, equipe do IMED: o que cada papel pode; dar papel (conta que não existe, e-mail de administrador), repetir, tirar com confirmação e dar de novo', async () => {
  const { page, log, db, errors, context } = await newPage(browser, { logged: true });
  await abrirCentral(page, 'equipe');
  assert.match(norm(await page.textContent('#ceEqAviso')), /^Por enquanto este painel e a visão “equipe do IMED” da Área da clínica só abrem para o administrador\./);
  assert.deepEqual(await page.locator('.gs-ce-papeis dt').allTextContents(), ['Operação', 'Suporte', 'Financeiro', 'Auditoria']);
  assert.match(norm(await page.textContent('.gs-ce-papeis > div:nth-child(2) dd')), /sem ver nenhum dado de paciente\.No banco: ver a agenda das clínicas, sem nome de paciente\.$/);
  assert.equal(norm(await page.textContent('#ceEqVazia')), 'Ninguém além do administrador tem papel na equipe ainda.');
  await page.click('#ceEqDar');
  assert.deepEqual([norm(await page.textContent('#ceEqEmailErr')), norm(await page.textContent('#ceEqPapelErr'))], ['Digite o e-mail da conta da pessoa.', 'Escolha o papel.']);
  assert.equal(await focoId(page), 'ceEqEmail');
  await page.fill('#ceEqEmail', 'ana.equipe@');
  await page.selectOption('#ceEqPapel', 'suporte');
  await page.click('#ceEqDar');
  assert.equal(norm(await page.textContent('#ceEqEmailErr')), 'Confira o e-mail: parece incompleto.');
  assert.equal(ceCalls(log, 'agenda_central_staff_grant').length, 0);
  // conta que não existe, conta sem e-mail confirmado e o e-mail do próprio administrador: o banco recusa e a tela explica
  for (const [e, re] of [['ninguem@imed.test', /^Não achamos uma conta com esse e-mail e o e-mail confirmado\./], ['semconfirmar@imed.test', /^Não achamos uma conta/], ['equipe@imed.com.br', /^Esse e-mail é de administrador do IMED/]]) {
    await page.fill('#ceEqEmail', e);
    await page.click('#ceEqDar');
    await page.waitForFunction(() => document.querySelector('#ceEqErr .cl-note.err') && !document.querySelector('#ceEqDar').disabled);
    assert.match(norm(await page.textContent('#ceEqErr')), re);
    assert.equal(await page.inputValue('#ceEqEmail'), e, 'o que foi digitado fica para corrigir');
  }
  assert.equal(db.central.staff.length, 0);
  // certo (maiúsculas e espaços no e-mail não atrapalham)
  await page.fill('#ceEqEmail', '  Ana.Equipe@IMED.test ');
  await page.click('#ceEqDar');
  await page.waitForSelector('#ceEqTb');
  assert.deepEqual(ceCalls(log, 'agenda_central_staff_grant').at(-1).body, { p_email: 'ana.equipe@imed.test', p_role: 'suporte' });
  assert.equal(await ceMsg(page), 'Papel “Suporte” dado a ana.equipe@imed.test.');
  assert.deepEqual([await page.inputValue('#ceEqEmail'), await page.inputValue('#ceEqPapel')], ['', '']);
  assert.equal(await focoId(page), 'ceEqEmail');
  assert.deepEqual(await linha(page, '#ceEqTb tbody tr'), { 'Pessoa': 'ana.equipe@imed.testconta f0f0f0f0', 'Papel': 'Suporte', 'Desde': '30/10/2026 às 12:00', 'Situação': 'Ativo', 'Ações': 'Tirar papel: Suporte, ana.equipe@imed.test' });
  await page.fill('#ceEqEmail', 'ana.equipe@imed.test');
  await page.selectOption('#ceEqPapel', 'suporte');
  await page.click('#ceEqDar');
  await page.waitForFunction(() => /nada mudou/.test(document.querySelector('#ceMsg').textContent));
  assert.equal(await ceMsg(page), 'ana.equipe@imed.test já tinha o papel “Suporte”: nada mudou.');
  await page.fill('#ceEqEmail', 'bia.equipe@imed.test');
  await page.selectOption('#ceEqPapel', 'operacao');
  await page.click('#ceEqDar');
  await page.waitForFunction(() => document.querySelectorAll('#ceEqTb tbody tr').length === 2);
  await shot(page, 'agenda44-equipe', '#sec-agenda');
  // tirar: confirmação; "Voltar" devolve o foco; confirmado, a linha fica marcada como retirada
  await page.click('#ceEqDel-f0f0f0f0-suporte');
  await page.waitForSelector('#ceEqDelBox');
  assert.equal(norm(await page.textContent('#ceEqDelTxt')), 'Tirar o papel “Suporte” de ana.equipe@imed.test? A pessoa perde essas permissões na hora. O registro fica guardado na auditoria.');
  assert.equal(await focoId(page), 'ceEqDelOk');
  await page.click('#ceEqDelBox [data-ce-back]');
  assert.equal(await focoId(page), 'ceEqDel-f0f0f0f0-suporte');
  assert.equal(ceCalls(log, 'agenda_central_staff_revoke').length, 0);
  await page.click('#ceEqDel-f0f0f0f0-suporte');
  await page.click('#ceEqDelOk');
  await page.waitForSelector('#ceEqTb .gs-ce-passado');
  assert.deepEqual(ceCalls(log, 'agenda_central_staff_revoke').at(-1).body, { p_user: 'f0f0f0f0-0000-4000-8000-000000000001', p_role: 'suporte' });
  assert.equal(await ceMsg(page), 'Papel “Suporte” retirado de ana.equipe@imed.test.');
  assert.equal((await linha(page, '#ceEqTb tr.gs-ce-passado'))['Situação'], 'Retiradoem 30/10/2026 às 12:00');
  assert.equal(await page.locator('#ceEqTb tr.gs-ce-passado button').count(), 0, 'papel retirado não tem o que tirar');
  // dar de novo o papel retirado: volta a valer, na mesma linha
  await page.fill('#ceEqEmail', 'ana.equipe@imed.test');
  await page.selectOption('#ceEqPapel', 'suporte');
  await page.click('#ceEqDar');
  await page.waitForFunction(() => !document.querySelector('#ceEqTb .gs-ce-passado'));
  assert.equal(await page.locator('#ceEqTb tbody tr').count(), 2);
  // o banco recusa a retirada de quem já não tem o papel (outra aba fez antes): o erro aparece no quadro
  db.central.staff.find((x) => x.role === 'operacao').active = false;
  await page.click('#ceEqDel-f1f1f1f1-operacao');
  await page.click('#ceEqDelOk');
  await page.waitForSelector('#ceQuadroErr .cl-note.err');
  assert.equal(norm(await page.textContent('#ceQuadroErr')), 'Não encontramos esse registro: a lista foi atualizada.');
  soCentral(log);
  assert.deepEqual(errors, []);
  await context.close();
});

// Um Realtime de mentira na própria página (tem precedência sobre o do contexto, que fecha o canal): aceita a entrada
// no canal e deixa o teste mandar o aviso {clinic_id, v} como o banco manda depois do COMMIT (private.agenda_touch).
async function realtimeCentral(page) {
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
  st.aviso = (clinicId, v) => st.ws.send(JSON.stringify({ topic: 'realtime:agenda:imed', event: 'broadcast', payload: { event: 'agenda', payload: { clinic_id: clinicId, v }, type: 'broadcast' } }));
  return st;
}

await scenario('agenda das clínicas, atualização automática: entra no canal agenda:imed com o token; o aviso faz reler só quando algo mudou; formulário em uso não é mexido; aba escondida para; sem conexão avisa; ao sair, o canal fecha', async () => {
  const { page, log, db, errors, context } = await newPage(browser, { logged: true });
  const rt = await realtimeCentral(page);
  await abrirCentral(page);
  await page.waitForTimeout(400);
  assert.equal(rt.joins.length, 1, 'entra no canal uma vez');
  const j = rt.joins[0];
  assert.equal(j.topic, 'realtime:agenda:imed', 'o canal da equipe do IMED');
  assert.deepEqual(j.payload, { config: { broadcast: { self: false, ack: false }, presence: { enabled: false }, private: true }, access_token: 'tok-init' });
  assert.equal(new URL(rt.url).searchParams.get('apikey'), PUBLISHABLE, 'a chave publishable em ?apikey=');
  assert.ok(!rt.url.includes('tok-'), 'o token da pessoa não vai no endereço');
  assert.deepEqual(ceCalls(log, 'agenda_central_version').at(-1).body, {});
  assert.ok(!/tempo real/i.test(await page.textContent('#sec-agenda')), 'a tela não promete "tempo real"');
  // uma clínica bloqueia um horário com agendamento: o banco sobe a versão e avisa; a tela relê sozinha
  const ov = ceCalls(log, 'agenda_central_overview').length;
  db.central.clinics[1].open_conflicts = 1; db.central.conflicts.push({ ...CE_CONFLITOS[1], id: 'kkkkkkkk-0000-4000-8000-000000000009', clinic_id: K(2), clinic_name: 'Laboratório Análise' }); db.central.version += 1;
  rt.aviso(K(2), 8);
  await page.waitForFunction(() => document.querySelector('[data-kpi="ce-conflitos"] .gs-kpi-v')?.textContent === '3');
  assert.equal(ceCalls(log, 'agenda_central_overview').length, ov + 1, 'uma leitura');
  assert.equal(norm(await page.textContent('#ceConfN')), '3 abertos');
  assert.equal(await ceMsg(page), '', 'sem aviso à vista a cada mudança');
  // rajada de avisos sem nada novo no banco: confere a versão uma vez e não relê
  const v0 = ceCalls(log, 'agenda_central_version').length;
  rt.aviso(K(1), 43); rt.aviso(K(1), 43); rt.aviso(K(2), 8);
  await page.waitForTimeout(1200);
  assert.equal(ceCalls(log, 'agenda_central_version').length, v0 + 1, 'a rajada vira uma conferência');
  assert.equal(ceCalls(log, 'agenda_central_overview').length, ov + 1, 'nada mudou: nada é relido');
  // na aba Feriados, com o formulário em uso: o aviso não redesenha nada (só o número de conflitos da aba muda)
  await irPara(page, 'feriados');
  await page.fill('#ceFerNome', 'Digitando o nome');
  const fe = ceCalls(log, 'agenda_central_holidays').length;
  db.central.conflicts.pop(); db.central.clinics[1].open_conflicts = 0; db.central.version += 1;
  rt.aviso(K(2), 9);
  await page.waitForFunction(() => /^2/.test(document.querySelector('#ceConfN').textContent));
  assert.equal(await page.inputValue('#ceFerNome'), 'Digitando o nome');
  assert.equal(await focoId(page), 'ceFerNome');
  assert.equal(ceCalls(log, 'agenda_central_holidays').length, fe, 'a aba com formulário não é relida sozinha');
  assert.equal(norm(await page.textContent('#ceEstado')), '', 'e a faixa não diz que confere sozinha');
  // aba do navegador escondida: nada de conferência; ao voltar, confere na hora
  await irPara(page, 'clinicas');
  await page.waitForTimeout(300);
  await setTabHidden(page, true);
  await page.waitForTimeout(500);
  const h0 = ceCalls(log, 'agenda_central_version').length;
  db.central.clinics[0].upcoming = 18; db.central.version += 1;
  await page.waitForTimeout(1200);
  assert.equal(ceCalls(log, 'agenda_central_version').length, h0, 'escondida: nenhuma conferência');
  await setTabHidden(page, false);
  await page.waitForFunction(() => document.querySelector('[data-kpi="ce-porvir"] .gs-kpi-v')?.textContent === '21');
  // sem conexão: a faixa avisa; quando volta, o aviso some
  // (várias falhas seguidas: ao voltar para a aba a conferência roda duas vezes, a da volta e a da reentrada no canal)
  db.central.failNet = 5;
  await setTabHidden(page, true); await setTabHidden(page, false);
  await page.waitForFunction(() => /Sem conexão agora: os números podem estar desatualizados\./.test(document.querySelector('#ceEstado').textContent));
  assert.equal(await kpiV(page, 'ce-porvir'), '21', 'os números de antes continuam à vista');
  db.central.failNet = 0;
  await setTabHidden(page, true); await setTabHidden(page, false);
  await page.waitForFunction(() => /confere sozinha/.test(document.querySelector('#ceEstado').textContent));
  // o auth.js renovou o token: o canal recebe o novo sem reconectar
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('imed:token', { detail: { access_token: 'tok-renovado' } })));
  await page.waitForTimeout(300);
  const at = rt.msgs.find((m) => m.event === 'access_token');
  assert.deepEqual(at && { topic: at.topic, payload: at.payload }, { topic: 'realtime:agenda:imed', payload: { access_token: 'tok-renovado' } });
  assert.equal(rt.joins.length >= 1, true);
  // "Atualizar números" (do alto do painel) também relê a aba à vista
  const ov2 = ceCalls(log, 'agenda_central_overview').length;
  await atualizar(page, log);
  await page.waitForTimeout(300);
  assert.equal(ceCalls(log, 'agenda_central_overview').length, ov2 + 1);
  // saiu da conta: o canal fecha e nada mais é conferido
  const fechados = rt.closed;
  await page.click('#authBox [data-signout]');
  await page.waitForSelector('#loginEmail');
  await page.waitForTimeout(400);
  assert.ok(rt.closed > fechados, 'o canal fecha ao sair');
  const fim = ceCalls(log, 'agenda_central_version').length;
  await setTabHidden(page, true); await setTabHidden(page, false);
  await page.waitForTimeout(600);
  assert.equal(ceCalls(log, 'agenda_central_version').length, fim, 'sem conta, nenhuma conferência');
  assert.equal(await page.locator('#sec-agenda').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agenda das clínicas: banco ainda sem as funções da central (migração não aplicada) → um aviso, o resto do painel funciona; outro erro tem "Tentar de novo"; conta que não é da equipe não chama nada', async () => {
  const { page, log, db, errors, context } = await newPage(browser, { logged: true, db: { central: { missing: true } } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-agenda .cl-note.warn');
  assert.equal(norm(await page.textContent('#ceCorpo')), 'A central da agenda ainda não está ligada no banco. Ela aparece aqui depois que a atualização do banco desta etapa for aplicada.');
  assert.equal(await page.locator('#ceCorpo [role="tab"], #cePainel').count(), 0);
  await page.waitForSelector('#sec-resumo .gs-kpi');
  await page.waitForSelector('#cobLista table');
  assert.equal(ceCalls(log, 'agenda_central_overview').length, 1);
  await page.waitForTimeout(500);
  assert.equal(ceCalls(log, 'agenda_central_version').length, 0, 'sem a central, nada de conferência');
  assert.deepEqual(errors, []);
  await context.close();
  // outro erro do banco ao abrir: "Tentar de novo" e, depois, funciona
  const b = await newPage(browser, { logged: true, db: { central: { error: { status: 500, body: { message: 'erro interno' } } } } });
  await b.page.goto(`${BASE}gestao.html`);
  await b.page.waitForSelector('#ceCorpo #ceRetry');
  assert.ok(await b.page.locator('#ceCorpo .cl-note.err').count());
  b.db.central.error = null;
  await b.page.click('#ceRetry');
  await b.page.waitForSelector('#cePainel #ceKpis');
  // erro numa aba depois de aberta: o aviso fica no painel da aba e as outras continuam
  b.db.central.error = { status: 500, body: { message: 'erro interno' } };
  await b.page.click('#ceTab-parametros');
  await b.page.waitForSelector('#cePainel #ceRetry');
  b.db.central.error = null;
  await b.page.click('#ceRetry');
  await b.page.waitForSelector('#cePainel [data-ce-par]');
  assert.deepEqual(b.errors, []);
  await b.context.close();
  // conta que não é da equipe: nenhuma função da central é chamada
  const c = await newPage(browser, { logged: true, email: 'dono@clinica.com.br', db: { admin: false } });
  await c.page.goto(`${BASE}gestao.html`);
  await c.page.waitForSelector('#denyTitle');
  await c.page.waitForTimeout(300);
  assert.equal(c.log.filter((e) => /agenda_/.test(e.path)).length, 0);
  assert.equal(await c.page.locator('#sec-agenda').count(), 0);
  assert.deepEqual(c.errors, []);
  await c.context.close();
  // a conta deixa de ser da equipe com a central aberta (o banco passa a responder "forbidden"): a parte avisa, sem número nenhum
  const d = await newPage(browser, { logged: true });
  await abrirCentral(d.page);
  d.db.admin = false;
  await d.page.click('#ceTab-equipe');
  await d.page.waitForFunction(() => /Os papéis da equipe são só para o administrador do IMED\./.test(document.querySelector('#cePainel').textContent));
  assert.equal(await d.page.locator('#ceEqForm, #ceEqTb').count(), 0);
  assert.deepEqual(d.errors, []);
  await d.context.close();
  void db;
});

await scenario('agenda das clínicas no celular (390 px): tabelas viram cartões, nada passa da tela, botões e abas com 44 px', async () => {
  const { page, db, errors, context } = await newPage(browser, { logged: true, mobile: true, width: 390 });
  db.central.staff = [{ user_id: 'f0f0f0f0-0000-4000-8000-000000000001', code: 'f0f0f0f0', email: 'ana.equipe@imed.test', role: 'suporte', granted_at: NOW, revoked_at: null, active: true }];
  db.central.holidays = [{ id: 'hhhhhhhh-0000-4000-8000-000000000001', scope: 'nacional', uf: null, city_ibge: null, day: '2026-12-25', name: 'Natal', source: 'Fonte de teste (não é uma lei de verdade)', created_at: NOW }];
  await abrirCentral(page);
  await page.selectOption('#ceClinFiltro', 'todas');
  const cartoes = async (sel) => page.locator(`${sel} tbody tr`).evaluateAll((l) => l.every((r) => getComputedStyle(r).display === 'block' && r.getBoundingClientRect().width <= 390));
  for (const [tab, tb] of [['clinicas', '#ceClinTb'], ['conflitos', '#ceConfTb'], ['auditoria', '#ceMudTb'], ['feriados', '#ceFerTb'], ['parametros', null], ['equipe', '#ceEqTb']]) {
    if (tab !== 'clinicas') await irPara(page, tab);
    if (tb) assert.ok(await cartoes(tb), `${tab}: cada linha é um cartão dentro da tela`);
    await noOverflow(page);
    const pequenos = await page.locator('#ceCorpo button:visible, #ceCorpo select:visible, #ceCorpo input:not([type="radio"]):visible, #ceCorpo .gs-seg span:visible').evaluateAll((l) => l.filter((x) => x.getBoundingClientRect().height < 43.5).map((x) => `${x.id || x.className}: ${Math.round(x.getBoundingClientRect().height)}px`));
    assert.deepEqual(pequenos, [], `${tab}: tudo o que se toca tem 44 px de altura`);
    await shot(page, `agenda44-celular-${tab}`, '#sec-agenda');
  }
  // o nome da coluna aparece em cada célula do cartão
  await irPara(page, 'clinicas');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#ceClinTb tbody td'), '::before').content), '"Modalidade"');
  // conferência do feriado no celular
  await irPara(page, 'feriados');
  await page.fill('#ceFerDia', '2026-11-15'); await page.fill('#ceFerNome', 'Feriado de teste'); await page.fill('#ceFerFonte', 'Fonte de teste');
  await page.click('#ceFerLancar');
  await page.waitForSelector('#ceFerOk');
  await noOverflow(page);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agenda das clínicas no celular (360 px): os selos (como "Venceu em 15/10/2026") ficam dentro do cartão', async () => {
  const { page, errors, context } = await newPage(browser, { logged: true, mobile: true, width: 360 });
  await abrirCentral(page);
  await page.selectOption('#ceClinFiltro', 'todas');
  await page.waitForFunction(() => /Venceu em/.test(document.querySelector('#ceClinTb').textContent));
  const fora = await page.locator('#ceClinTb .bd').evaluateAll((l) => l.map((b) => ({ t: b.textContent, sobra: b.getBoundingClientRect().right - b.closest('tr').getBoundingClientRect().right })).filter((x) => x.sobra > 0.5));
  assert.deepEqual(fora, [], 'nenhum selo passa da borda do cartão');
  await noOverflow(page);
  assert.deepEqual(errors, []);
  await context.close();
});

await scenario('agenda das clínicas, acessibilidade (axe): as 6 abas no computador e no celular, com os quadros de confirmação abertos, sem violação grave', async () => {
  if (!AXE) { console.log('   (axe-core não encontrado: defina AXE_PATH para auditar)'); return; }
  for (const mobile of [false, true]) {
    const { page, db, errors, context } = await newPage(browser, { logged: true, mobile, bypassCSP: true });
    db.central.staff = [{ user_id: 'f0f0f0f0-0000-4000-8000-000000000001', code: 'f0f0f0f0', email: 'ana.equipe@imed.test', role: 'suporte', granted_at: NOW, revoked_at: null, active: true },
      { user_id: 'f1f1f1f1-0000-4000-8000-000000000002', code: 'f1f1f1f1', email: 'bia.equipe@imed.test', role: 'operacao', granted_at: NOW, revoked_at: NOW, active: false }];
    db.central.holidays = [{ id: 'hhhhhhhh-0000-4000-8000-000000000001', scope: 'nacional', uf: null, city_ibge: null, day: '2026-12-25', name: 'Natal', source: 'Fonte de teste', created_at: NOW }];
    db.central.setting = 5; db.central.settingAt = NOW;
    await abrirCentral(page);
    const onde = mobile ? 'celular' : 'computador';
    const audita = async (nome) => assert.deepEqual(await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document.querySelector('#sec-agenda'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] });
      return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
    }), [], `${onde}: ${nome}`);
    await page.addScriptTag({ path: AXE });
    await page.selectOption('#ceClinFiltro', 'todas');
    await audita('clínicas');
    await irPara(page, 'conflitos'); await page.check('#ceConf-todos'); await page.waitForFunction(() => document.querySelectorAll('#ceConfTb tbody tr').length === 4); await audita('conflitos');
    await irPara(page, 'auditoria'); await page.fill('#ceAudConta', 'xyz'); await page.click('#ceAudAplicar'); await audita('auditoria, com erro no filtro');
    await irPara(page, 'feriados'); await page.click('#ceFerLancar'); await audita('feriados, com os erros do formulário');
    await page.fill('#ceFerDia', '2026-11-15'); await page.fill('#ceFerNome', 'Feriado de teste'); await page.fill('#ceFerFonte', 'Fonte de teste');
    await page.click('#ceFerLancar'); await page.waitForSelector('#ceFerOk'); await audita('feriados, conferência antes de lançar');
    await page.click('#ceFerPrevia [data-ce-back]'); await page.click('#ceFerDel-hhhhhhhh-0000-4000-8000-000000000001'); await page.waitForSelector('#ceFerDelOk'); await audita('feriados, retirar');
    await irPara(page, 'parametros'); await page.fill('#cePar0', '99'); await page.click('#cePar0Gravar'); await audita('parâmetros, com erro');
    await irPara(page, 'equipe'); await page.click('#ceEqDar'); await audita('equipe, com os erros do formulário');
    await page.click('#ceEqDel-f0f0f0f0-suporte'); await page.waitForSelector('#ceEqDelOk'); await audita('equipe, tirar papel');
    assert.deepEqual(errors, []);
    await context.close();
  }
  const { page, context } = await newPage(browser, { logged: true, bypassCSP: true, db: { central: { missing: true } } });
  await page.goto(`${BASE}gestao.html`);
  await page.waitForSelector('#sec-agenda .cl-note.warn');
  assert.deepEqual(await runAxe(page), [], 'banco sem a central');
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
