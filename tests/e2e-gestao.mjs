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
// telas médias (o bloco "Agora" com dois por linha até 1080 px, cada valor numa linha só); período 7/30/90/365 (12
// meses: colunas por
// semana, tabelas abertas continuam abertas); banco ainda sem as funções (aviso, sem quebrar); cobrança (criar, prévia
// do valor, erro de validação, erro do banco, marcar como paga hoje e noutro dia, cancelar e voltar para pendente com
// confirmação, Enter de novo não desfaz, filtro, lista cheia e planilha CSV); a conta deixa de ser da equipe com a
// página aberta (42501); banco novo (tudo zero); link "Painel de gestão" no painel.html só para a equipe; entrada
// vencida; celular 390 px sem rolagem lateral (também em 12 meses) e celular 360 px (o bloco "Agora" e a página toda,
// medidos contra a largura configurada); nenhum erro no console. Com o axe-core por perto
// (AXE_PATH ou node_modules), audita a página da equipe no computador e no celular, com as tabelas abertas, o bloco
// "Agora" com o aviso de nenhum médico e os quadros de pagamento e de voltar para pendente (falha com violação grave).
// Rodar com: node tests/e2e-gestao.mjs   (precisa do pacote "playwright" instalado)
// Opcional: TEMA=escuro (aparelho no escuro). SHOTS=pasta salva capturas de tela (para mostrar o teste); E2E_PORT muda a porta (padrão 4761);
//           ONLY="trecho" roda só os cenários com esse texto no nome; AXE_PATH=<pasta>/node_modules/axe-core.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comChaves, vigiarChaves } from './regra-chaves.mjs';

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
    viewport: mobile ? { width, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block', acceptDownloads: true, bypassCSP,
  });
  await context.clock.setFixedTime(new Date(NOW));
  const nowS = Math.floor(Date.parse(NOW) / 1000);
  const db = {
    admin: true, charges: clone(CHARGES), gestaoMissing: false, cobMissing: false, gestaoError: null, gestaoDelay: 0, cobError: null, saveError: null,
    failRefresh: false, members: [], clinics: [], calls: [], zero: false, agora: clone(AGORA),
    ...dbOpts,
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
const dataCalls = (log) => log.filter((e) => /\/rpc\/admin_(gestao|cobranca_)/.test(e.path));
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
  assert.deepEqual(await page.evaluate(() => [...document.querySelector('#app').children].map((el) => el.id || [...el.classList].at(-1))), ['gs-toc', 'sec-agora', 'gs-ctl', 'gsData', 'sec-cobranca']);
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
  assert.ok(xs.length >= 5, `rótulos das semanas: ${xs.length}`);
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

await browser.close();
server.close();
const failed = results.filter(([s]) => s !== 'ok');
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram`);
process.exit(failed.length ? 1 : 0);
