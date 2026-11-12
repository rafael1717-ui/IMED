// "Banco" e função do servidor DE MENTIRA do pagamento pelo site, para os testes de ponta a ponta (Playwright) e para as
// fotos das telas (iMed Pagamentos, fase P2a). Não é um teste: não roda sozinho. Usado por tests/e2e-pagamento.mjs e
// tests/e2e-a11y.mjs. Nada aqui sai desta máquina: as rotas respondem no lugar do Supabase.
//
// Imita só o que o site lê: agenda_public_info (com o pagamento online ligado), agenda_slots, a função do servidor
// pagamento-criar (ações criar e conferir), pag_my_payment, agenda_my_booking, cancel_request e request_status, no
// formato das migrações pagamentos_base_parte_2 e 4. Os preços são de exemplo (não são de clínica nenhuma), o CPF é um
// número de teste e o "copia e cola" não é um Pix de verdade.
//
//   const st = bancoDoPagamento({ agora: () => relogio });   // relógio do teste (ms)
//   const log = await rotasDoPagamento(context, st);         // instala as rotas no contexto do Playwright
//   st.pagar(id) · st.vencer(id) · st.atrasar(id) · st.devolver(id) · st.falha = 'provider_unavailable' | 'rede' | ...
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SUPA = 'https://pyoqiecupxhdzigjudyd.supabase.co';
export const REST = `${SUPA}/rest/v1/`;
export const FUNCAO = `${SUPA}/functions/v1/pagamento-criar`;
export const CLINICA_ID = 'bbbbbbbb-0000-4000-8000-000000000021';
export const PROC_RM = 'dddddddd-0000-4000-8000-0000000000b1';
export const PROC_TC = 'dddddddd-0000-4000-8000-0000000000b2';
export const CPF = '529.982.247-25';   // CPF de teste (dígitos verificadores certos; não é de ninguém)
// Relógio fixo dos testes: segunda-feira, 16/11/2026, 09:00 em São Paulo.
export const NOW = '2026-11-16T12:00:00Z';
export const NOW_MS = Date.parse(NOW);
// Um "copia e cola" de mentira, com o tamanho de um de verdade (não paga nada).
export const COPIA_E_COLA = `00020126580014br.gov.bcb.pix0136${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}5204000053039865406450.005802BR5913IMED EXEMPLO6009SAO PAULO62290525EXEMPLODETESTE00000000000630400AA`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
/** Sobe o site (arquivos da pasta do repositório) em 127.0.0.1:porta. Devolve { base, fechar }. */
export async function servirSite(porta) {
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
  await new Promise((r) => server.listen(porta, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${porta}/`, fechar: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}

export const CLINICA = {
  id: CLINICA_ID, name: 'Clínica Exemplo de Imagem', kind: 'imagem', description: null, address_line: 'Rua de Exemplo, 100', neighborhood: 'Centro',
  city: 'São Paulo', state: 'SP', cep: '01000-000', location: { type: 'Point', coordinates: [-46.6565, -23.5625] }, phone: '(11) 3000-0000', whatsapp: null,
  email: null, website: null, specialties: ['Radiologia'], opening_hours: { seg: '07:00–19:00' }, accepts_online_booking: true, status: 'published', is_demo: false,
  insurances: [], cnes: null, verified_at: '2026-10-01T02:30:00+00:00',
  clinic_exams: [{ exam_code: 'rm', price_cents: 45000, price_updated_at: '2026-10-01T10:00:00Z' }, { exam_code: 'tc', price_cents: null, price_updated_at: null }],
};

const pg = (ms) => new Date(ms).toISOString().replace('.000Z', '+00:00');
const diaSP = (ms, n) => new Date(ms + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/**
 * O estado do "banco". online: a clínica tem o recebimento pelo site ligado (false = tudo desligado, como hoje).
 * agora: função que devolve o relógio do teste (ms).
 */
export function bancoDoPagamento({ agora = () => NOW_MS, online = true, holdMin = 10, qrMin = 8 } = {}) {
  const d1 = diaSP(agora(), 1);   // os horários livres são de amanhã (pelo relógio do teste)
  const horarios = { [PROC_RM]: { min: 30, lista: ['09:00', '09:30', '14:00'] }, [PROC_TC]: { min: 20, lista: ['16:00'] } };
  const iso = (hhmm) => new Date(`${d1}T${hhmm}:00-03:00`).toISOString();
  const st = { online, falha: '', pedidos: new Map(), chamadas: [], ocupados: new Set(), agora };
  st.info = () => ({
    status: 'ok', clinic_id: CLINICA_ID, timezone: 'America/Sao_Paulo', mode: 'nativa', online: true,
    mode_text: 'A clínica usa a agenda do IMED: os horários mostrados são os livres na agenda dela agora.', online_text: 'Escolha um horário livre e confirme.',
    payment: st.online ? 'online' : 'no_local',
    payment_text: st.online ? 'Pagamento aqui no site, na tela do seu agendamento. O horário só fica confirmado depois do pagamento.' : 'Pagamento no local, direto com a clínica.',
    cancel_until_min: 0, reschedule_until_min: 120,
    procedures: [
      { id: PROC_RM, exam_code: 'rm', name: 'Ressonância', duration_min: 30, price_cents: 45000, price_text: null, prep_text: 'Retire objetos de metal.', fasting_hours: null },
      { id: PROC_TC, exam_code: 'tc', name: 'Tomografia', duration_min: 20, price_cents: null, price_text: 'sob consulta', prep_text: null, fasting_hours: 4 },
    ],
    ...(st.online ? { payment_methods: ['pix'], payment_min_cents: 2000, payment_hold_min: holdMin } : {}),
  });
  st.rows = (pid) => (horarios[pid]?.lista ?? []).map(iso).filter((x) => !st.ocupados.has(x))
    .map((x) => ({ slot_start: pg(Date.parse(x)), slot_end: pg(Date.parse(x) + horarios[pid].min * 60000) }));
  const achar = (id, token) => { const p = st.pedidos.get(id); return p && (!token || p.token === token) ? p : null; };
  // pag_my_payment (parte 4): o "copia e cola" só enquanto a cobrança espera e o prazo não venceu
  const pagamento = (p) => (p.sit ? {
    situacao: p.sit, valor_cents: p.valor, meio: 'pix', tentativa: 1,
    expira_em: ['criada', 'aguardando'].includes(p.sit) ? pg(p.expira) : null,
    pix_copia_cola: p.sit === 'aguardando' && p.expira > st.agora() ? COPIA_E_COLA : null,
    paga_em: p.pagaEm ? pg(p.pagaEm) : null, devolvido_cents: p.devolucoes.filter((x) => x.situacao === 'devolvida').reduce((a, x) => a + x.valor_cents, 0),
    devolucoes: p.devolucoes,
  } : null);
  st.my = (b) => {
    const p = achar(b.p_request, b.p_token);
    if (!p) return { status: 'not_found' };
    if (!p.online) return { status: 'ok', payment_mode: 'no_local', request_status: p.status };
    return { status: 'ok', payment_mode: 'online', request_status: p.status, total_cents: p.valor, hold_expires_at: p.hold ? pg(p.hold) : null, payment: pagamento(p) };
  };
  st.booking = (b) => {
    const p = achar(b.p_id, b.p_token);
    if (!p) return { status: 'not_found' };
    const payment = pagamento(p);
    return { status: 'ok', id: p.id, request_status: p.status, version: 1, agenda: true, clinic_id: CLINICA_ID, clinic_name: CLINICA.name, timezone: 'America/Sao_Paulo',
      slot_start: pg(Date.parse(p.slot)), slot_end: pg(Date.parse(p.slot) + 30 * 60000), hold_expires_at: p.hold ? pg(p.hold) : null,
      items: [{ seq: 1, exam_code: 'rm', procedure: 'Ressonância', starts_at: pg(Date.parse(p.slot)), ends_at: pg(Date.parse(p.slot) + 30 * 60000), status: p.status, prep_text: 'Retire objetos de metal.', fasting_hours: null }],
      ...(p.online ? { payment: payment ? { situacao: payment.situacao, valor_cents: payment.valor_cents, meio: 'pix', expira_em: payment.expira_em, paga_em: payment.paga_em, devolvido_cents: payment.devolvido_cents } : { situacao: 'sem_cobranca', valor_cents: p.valor } } : {}) };
  };
  // a função do servidor pagamento-criar: devolve { http, corpo }
  st.funcao = (b) => {
    st.chamadas.push(b);
    if (st.falha === 'provider_unavailable') return { http: 502, corpo: { ok: false, status: 'provider_unavailable', released: true } };
    if (st.falha) return { http: st.falha === 'captcha_failed' ? 403 : st.falha.endsWith('configured') ? 503 : 200, corpo: { ok: false, status: st.falha } };
    if (b.action === 'conferir') {
      const p = achar(b.id, b.token);
      return { http: 200, corpo: p ? { ok: true, status: 'ok', situacao: p.sit, request_status: p.status } : { ok: false, status: 'not_found' } };
    }
    const item = b.items?.[0] ?? {};
    const slot = new Date(item.starts_at).toISOString();
    const antigo = st.pedidos.get(b.id);
    if (antigo) return antigo.token === b.token && antigo.slot === slot ? { http: 200, corpo: { ok: true, status: 'ok', retomar: true, id: b.id } } : { http: 200, corpo: { ok: false, status: 'idempotency_conflict' } };
    if (st.ocupados.has(slot) || !st.rows(item.procedure_id).some((r) => new Date(r.slot_start).toISOString() === slot)) {
      return { http: 200, corpo: { ok: false, status: 'slot_taken', alternatives: st.rows(item.procedure_id).map((r) => r.slot_start) } };
    }
    const t = st.agora();
    const p = { id: b.id, token: b.token, chave: b.key, slot, online: true, status: 'awaiting_payment', sit: 'aguardando', valor: 45000, hold: t + holdMin * 60000,
      expira: t + qrMin * 60000, pagaEm: null, devolucoes: [], paciente: b.patient };
    st.pedidos.set(b.id, p);
    st.ocupados.add(slot);
    return { http: 200, corpo: { ok: true, status: 'ok', id: b.id, request_status: 'awaiting_payment', slot_start: pg(Date.parse(slot)), slot_end: pg(Date.parse(slot) + 30 * 60000),
      hold_expires_at: pg(p.hold), total_cents: p.valor, payment: { situacao: 'aguardando', meio: 'pix', valor_cents: p.valor, expira_em: pg(p.expira), pix_copia_cola: COPIA_E_COLA }, agora: new Date(t).toISOString() } };
  };
  st.cancel = (b) => {
    const p = achar(b.p_id, b.p_token);
    if (!p) return 'not_found';
    if (p.status === 'cancelled') return 'already_cancelled';
    const pago = p.sit === 'aprovada';
    p.status = 'cancelled'; p.hold = null; st.ocupados.delete(p.slot);
    if (pago) p.devolucoes.push({ valor_cents: p.valor, situacao: 'pedida', pedida_em: pg(st.agora()), devolvida_em: null });
    else p.sit = 'cancelada';
    return 'ok';
  };
  st.status = (b) => (b.p_ids ?? []).map((id, i) => achar(id, b.p_tokens?.[i])).filter(Boolean).map((p) => ({ id: p.id, status: p.status, reviewed: false }));
  /* ---- o que o teste faz acontecer ---- */
  const de = (id) => { const p = st.pedidos.get(id); if (!p) throw new Error(`pedido ${id} não existe`); return p; };
  /** O pagamento chegou no prazo: aprovado e agendamento confirmado. */
  st.pagar = (id) => { const p = de(id); p.sit = 'aprovada'; p.status = 'confirmed'; p.pagaEm = st.agora(); p.hold = null; };
  /** Não pagou: cobrança expirada, reserva expirada, horário livre. */
  st.vencer = (id) => { const p = de(id); p.sit = 'expirada'; p.status = 'expired'; p.hold = null; st.ocupados.delete(p.slot); };
  /** O pagamento chegou depois de a reserva expirar e o horário já foi pego: devolução total pedida. */
  st.atrasar = (id) => { const p = de(id); p.sit = 'aprovada'; p.status = 'expired'; p.pagaEm = st.agora(); p.hold = null;
    p.devolucoes = [{ valor_cents: p.valor, situacao: 'pedida', pedida_em: pg(st.agora()), devolvida_em: null }]; };
  /** A devolução foi concluída. */
  st.devolver = (id) => { const p = de(id); p.sit = 'devolvida'; p.devolucoes = p.devolucoes.map((x) => ({ ...x, situacao: 'devolvida', devolvida_em: pg(st.agora()) })); };
  /** Um pedido já existente (para abrir a conta ou "Meus pedidos" direto numa situação). Devolve a linha do aparelho (imed_appts). */
  st.semear = ({ id, token = 'c'.repeat(64), hhmm = '09:00', situacao = 'aguardando' } = {}) => {
    const t = st.agora();
    const slot = iso(hhmm);
    st.pedidos.set(id, { id, token, chave: 'k', slot, online: true, status: 'awaiting_payment', sit: 'aguardando', valor: 45000, hold: t + holdMin * 60000, expira: t + qrMin * 60000,
      pagaEm: null, devolucoes: [], paciente: {} });
    st.ocupados.add(slot);
    if (situacao === 'pago') st.pagar(id);
    if (situacao === 'vencido') st.vencer(id);
    if (situacao === 'atrasado') st.atrasar(id);
    if (situacao === 'devolvido') { st.atrasar(id); st.devolver(id); }
    return { type: 'pedido', code: `IMED-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`, id, token, place_key: `imed:${CLINICA_ID}`, name: CLINICA.name, phone: CLINICA.phone,
      exam: 'rm', items: ['Ressonância'], date: d1, period: 'manha', slot, slot_end: new Date(Date.parse(slot) + 30 * 60000).toISOString(), tz: 'America/Sao_Paulo',
      prep: 'Retire objetos de metal.', status: situacao === 'pago' ? 'confirmado' : 'aguardando_pagamento', pay: 1, created: new Date(t).toISOString() };
  };
  return st;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+F9PQAJYwN6V0E0WwAAAABJRU5ErkJggg==', 'base64');

/**
 * Instala no contexto do Playwright as rotas que respondem no lugar do Supabase. Devolve o registro do que a página
 * pediu: log.rpc [{ fn, body }], log.funcao [{ body, headers }], log.arquivos [caminhos do site pedidos], log.outros.
 * book: resposta de agenda_book (clínica sem pagamento); contaRows: linhas de appointment_requests da conta.
 */
export async function rotasDoPagamento(context, st, { book, contaRows = [] } = {}) {
  const log = { rpc: [], funcao: [], arquivos: [], outros: [] };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
  const pre = (route) => route.request().method() === 'OPTIONS' && (route.fulfill({ status: 204, headers: CORS }), true);
  context.on('request', (req) => { const u = new URL(req.url()); if (u.hostname === '127.0.0.1') log.arquivos.push(u.pathname); });
  await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await context.route('https://challenges.cloudflare.com/**', (r) => { log.outros.push(r.request().url()); return r.abort(); });
  await context.route(`${SUPA}/**`, async (route) => {
    if (pre(route)) return undefined;
    const req = route.request();
    const u = new URL(req.url());
    if (u.href.startsWith(FUNCAO)) {
      const body = JSON.parse(req.postData() || '{}');
      log.funcao.push({ body, headers: req.headers() });
      if (st.falha === 'rede') return route.abort();
      const r = st.funcao(body);
      return json(route, r.corpo, r.http);
    }
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.split('/').pop();
      const body = JSON.parse(req.postData() || '{}');
      log.rpc.push({ fn, body });
      if (fn === 'agenda_public_info') return json(route, body.p_clinic === CLINICA_ID ? st.info() : { status: 'not_found' });
      if (fn === 'agenda_slots') return json(route, st.rows(body.p_procedure));
      if (fn === 'pag_my_payment') return st.falhaLeitura ? route.abort() : json(route, st.my(body));
      if (fn === 'agenda_my_booking') return json(route, st.booking(body));
      if (fn === 'cancel_request') return json(route, st.cancel(body));
      if (fn === 'request_status') return json(route, st.status(body));
      if (fn === 'agenda_book') return json(route, book ? book(body) : { status: 'payment_required' });
      if (fn === 'clinics_with_schedule') return json(route, []);
      return json(route, []);
    }
    if (u.pathname.startsWith('/rest/v1/clinics')) {
      const id = u.searchParams.get('id')?.replace('eq.', '');
      return json(route, id === CLINICA_ID ? [CLINICA] : []);
    }
    if (u.pathname.startsWith('/rest/v1/appointment_requests')) return json(route, contaRows);
    if (u.pathname.startsWith('/rest/v1/')) return json(route, []);
    log.outros.push(u.href);
    return json(route, {});
  });
  return log;
}
