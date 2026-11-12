// iMed Pagamentos, fase P1 — o provedor de pagamento DE MENTIRA dos testes do banco (arquitetura do pagamento §10, P1,
// e §11). O CI não alcança a internet, e nada aqui fala com o Asaas de verdade: é um servidor HTTP dentro do próprio
// processo do teste (127.0.0.1, porta livre), com o pedaço da API que a fase P2 vai usar, e as "funções do servidor"
// de mentira (o que as Edge Functions pagamento-criar, pagamento-webhook e pagamento-rotina vão fazer), para os testes
// tests/banco/pagamento-*.mjs exercitarem o banco de verdade de ponta a ponta. NÃO é um teste: o banco.yml não o roda.
//
// O que ele imita vem do que a pesquisa de 11/11/2026 encontrou (arquitetura §2.1) e fica A CONFIRMAR no ambiente de
// testes do provedor (lista do §2.3, fase P0). Onde a pesquisa não confirmou, o falso escolhe o comportamento MAIS
// CHATO para o nosso lado (é o que os testes precisam aguentar):
//   - o QR de cobrança apagada ainda pode ser pago (pagar(id, { mesmoApagada: true }));
//   - apagar uma cobrança já paga é recusado;
//   - os avisos podem vir repetidos e fora de ordem (quem decide a ordem é o teste);
//   - a devolução aceita uma chave de idempotência no cabeçalho "x-chave-idempotencia" (a mesma chave = a mesma
//     devolução). Se o provedor de verdade não tiver isso, a P2 consulta antes de reenviar.
// Nenhum segredo: a "chave" e o "segredo do aviso" são textos fixos de teste, sem o formato de chave de provedor nenhum.
// Nenhuma tarifa inventada: a tarifa é a que o teste passar (ele lê o parâmetro do banco, pagamentos.settings).
//
//   const falso = await subirAsaasFalso({ tarifaPixCents });      // sobe; falso.fechar() no fim
//   const prov = clienteDoProvedor(falso);                         // a camada fina (o futuro provedor.ts)
//   await criarPagamento(db, prov, {...}); await receberAviso(db, prov, evento); await rotina(db, prov);

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const reais = (centavos) => (centavos / 100).toFixed(2);              // 13323 → "133.23"
const centavos = (v) => Math.round(Number(v) * 100);                  // "133.23" → 13323
const PAGAS = new Set(['RECEIVED', 'CONFIRMED', 'REFUNDED', 'CHARGEBACK_REQUESTED']);

/** Sobe o provedor falso. Devolve o endereço, os controles do teste e o que ele recebeu. */
export async function subirAsaasFalso({ tarifaPixCents = 0, chave = 'chave-de-teste-do-provedor-falso',
  segredoAviso = 'segredo-de-teste-do-aviso-falso' } = {}) {
  const cobrancas = new Map();      // id → cobrança
  const estornosPorChave = new Map();
  const recebido = [];              // tudo o que chegou (para o teste conferir o que o IMED manda: §6.3, LGPD)
  const avisos = [];                // avisos gerados e ainda não entregues (o teste entrega, na ordem que quiser)
  const estado = { foraDoAr: false, atrasoMs: 0, pedidos: 0, seq: 0 };
  const novoId = (prefixo) => `${prefixo}_falso_${(++estado.seq).toString().padStart(6, '0')}${randomUUID().slice(0, 8)}`;
  const aviso = (tipo, c) => {
    const e = { id: `evt_falso_${randomUUID()}`, event: tipo, dateCreated: new Date().toISOString(),
      payment: { id: c.id, status: c.status, value: Number(reais(c.valorCents)), externalReference: c.referencia } };
    avisos.push(e);
    return e;
  };
  const visao = (c) => ({
    id: c.id, status: c.status, deleted: c.apagada, billingType: c.meio, value: Number(reais(c.valorCents)),
    netValue: Number(reais(c.valorCents - (PAGAS.has(c.status) ? c.tarifaCents : 0))), externalReference: c.referencia,
    description: c.descricao, customer: c.cliente, paymentDate: c.pagaEm, refundedValue: Number(reais(c.devolvidoCents)),
    split: c.split.map((s) => ({ walletId: s.walletId, fixedValue: Number(reais(s.fixoCents)), status: PAGAS.has(c.status) ? 'DONE' : 'PENDING' })),
    refunds: c.estornos.map((r) => ({ id: r.id, value: Number(reais(r.valorCents)), status: 'DONE' })),
  });

  const servidor = http.createServer(async (req, res) => {
    estado.pedidos++;
    const partes = [];
    for await (const p of req) partes.push(p);
    let corpo = null;
    try { corpo = partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : null; } catch { /* corpo inválido */ }
    const url = new URL(req.url, 'http://127.0.0.1');
    recebido.push({ metodo: req.method, caminho: url.pathname, corpo });
    const responder = (status, json) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
    const erro = (status, codigo) => responder(status, { errors: [{ code: codigo }] });
    if (estado.atrasoMs) await new Promise((r) => setTimeout(r, estado.atrasoMs));
    if (estado.foraDoAr) return erro(503, 'fora_do_ar');
    if (req.headers.access_token !== chave) return erro(401, 'invalid_access_token');
    const m = url.pathname.match(/^\/v3\/payments\/([A-Za-z0-9_]+)(\/pixQrCode|\/refund)?$/);
    if (req.method === 'POST' && url.pathname === '/v3/customers') {
      return responder(200, { id: novoId('cus') });
    }
    if (req.method === 'POST' && url.pathname === '/v3/payments') {
      const valorCents = centavos(corpo?.value);
      const split = (corpo?.split ?? []).map((s) => ({ walletId: s.walletId, fixoCents: centavos(s.fixedValue) }));
      if (!(valorCents > 0) || !corpo?.customer || !['PIX', 'CREDIT_CARD'].includes(corpo?.billingType)) return erro(400, 'invalid_payment');
      // o valor fixo da divisão precisa caber no valor líquido (depois da tarifa): arquitetura §2.1
      if (split.reduce((t, s) => t + s.fixoCents, 0) > valorCents - tarifaPixCents) return erro(400, 'invalid_split');
      const c = { id: novoId('pay'), status: 'PENDING', apagada: false, meio: corpo.billingType, valorCents, tarifaCents: tarifaPixCents,
        referencia: corpo.externalReference ?? null, descricao: corpo.description ?? null, cliente: corpo.customer, split,
        pagaEm: null, devolvidoCents: 0, estornos: [], criadaEm: new Date() };
      cobrancas.set(c.id, c);
      return responder(200, visao(c));
    }
    if (req.method === 'GET' && url.pathname === '/v3/payments') {
      // lista para a conciliação: as cobranças criadas no dia (dateCreated, no fuso de São Paulo)
      // (ou a cobrança de uma referência externa: o que a P2a usa para não criar duas quando a criação cai no meio)
      const dia = url.searchParams.get('dateCreated');
      const ref = url.searchParams.get('externalReference');
      const doDia = (d) => new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10) === dia;
      return responder(200, { data: [...cobrancas.values()].filter((c) => (!dia || doDia(c.criadaEm)) && (!ref || c.referencia === ref)).map(visao) });
    }
    if (!m || !cobrancas.has(m[1])) return erro(404, 'not_found');
    const c = cobrancas.get(m[1]);
    if (req.method === 'GET' && !m[2]) return responder(200, visao(c));
    if (req.method === 'GET' && m[2] === '/pixQrCode') {
      // o QR do provedor NÃO vence em minutos (quem vence é a nossa cobrança): validade longa, de propósito
      return responder(200, { payload: `00020126-pix-falso-${c.id}`, encodedImage: '', expirationDate: new Date(Date.now() + 365 * 86400000).toISOString() });
    }
    if (req.method === 'DELETE' && !m[2]) {
      if (PAGAS.has(c.status)) return erro(400, 'ja_paga');
      c.apagada = true;
      return responder(200, { deleted: true, id: c.id });
    }
    if (req.method === 'POST' && m[2] === '/refund') {
      const chaveIdem = req.headers['x-chave-idempotencia'];
      if (chaveIdem && estornosPorChave.has(chaveIdem)) return responder(200, { ...visao(c), refundId: estornosPorChave.get(chaveIdem).id, repetido: true });
      if (!PAGAS.has(c.status)) return erro(400, 'nao_paga');
      const valor = corpo?.value == null ? c.valorCents - c.devolvidoCents : centavos(corpo.value);
      if (!(valor > 0) || valor > c.valorCents - c.devolvidoCents) return erro(400, 'invalid_refund_value');
      const r = { id: novoId('est'), valorCents: valor, split: corpo?.splitRefunds ?? [] };
      c.estornos.push(r);
      c.devolvidoCents += valor;
      if (c.devolvidoCents === c.valorCents) c.status = 'REFUNDED';
      if (chaveIdem) estornosPorChave.set(chaveIdem, r);
      aviso(c.status === 'REFUNDED' ? 'PAYMENT_REFUNDED' : 'PAYMENT_PARTIALLY_REFUNDED', c);
      return responder(200, { ...visao(c), refundId: r.id });
    }
    return erro(405, 'method_not_allowed');
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const { port } = servidor.address();

  return {
    url: `http://127.0.0.1:${port}`, chave, segredoAviso, cobrancas, recebido, estado,
    fechar: () => new Promise((ok) => { servidor.closeAllConnections?.(); servidor.close(() => ok()); }),
    /** O pagador paga o QR. Devolve o aviso que o provedor mandaria (o teste entrega quando e quantas vezes quiser). */
    pagar(id, { valorCents, mesmoApagada = false } = {}) {
      const c = cobrancas.get(id);
      if (!c) throw new Error(`provedor falso: cobrança ${id} não existe`);
      if (c.apagada && !mesmoApagada) throw new Error('provedor falso: cobrança apagada (use mesmoApagada para o caso do §4.4)');
      if (PAGAS.has(c.status)) throw new Error('provedor falso: o QR dinâmico só é pago uma vez');
      if (valorCents != null) c.valorCents = valorCents;   // "valor pago diferente do esperado"
      c.status = 'RECEIVED';
      c.pagaEm = new Date().toISOString();
      return aviso('PAYMENT_RECEIVED', c);
    },
    /** Tira os avisos gerados e ainda não entregues. */
    avisos: () => avisos.splice(0, avisos.length),
    foraDoAr(sim) { estado.foraDoAr = !!sim; },
    atrasar(ms) { estado.atrasoMs = ms; },
  };
}

/**
 * A camada fina do provedor (na P2: o provedor.ts das Edge Functions do pagamento): criar, consultar, apagar, devolver e
 * listar, devolvendo sempre a "foto" neutra que public.pag_sync_apply entende. Trocar de meio de pagamento é trocar isto.
 */
export function clienteDoProvedor(falso) {
  const chamar = async (metodo, caminho, corpo, cabecalhos = {}) => {
    const r = await fetch(`${falso.url}${caminho}`, {
      method: metodo, headers: { 'Content-Type': 'application/json', access_token: falso.chave, ...cabecalhos },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* sem JSON */ }
    if (!r.ok) {
      const e = new Error(`provedor: HTTP ${r.status} ${json?.errors?.[0]?.code ?? ''}`);
      e.status = r.status;
      e.codigo = json?.errors?.[0]?.code ?? 'erro_do_provedor';
      throw e;
    }
    return json;
  };
  // situação do provedor → situação neutra (só as que a P1 usa; a lista inteira é da P0)
  const foto = (p) => ({
    situacao: p.deleted && !['RECEIVED', 'CONFIRMED', 'REFUNDED'].includes(p.status) ? 'apagada'
      : p.status === 'PENDING' ? 'aguardando'
      : p.status === 'REFUNDED' ? 'devolvida'
      : ['RECEIVED', 'CONFIRMED'].includes(p.status) ? (p.refundedValue > 0 ? 'devolvida_parcial' : 'paga')
      : 'aguardando',
    valor_cents: centavos(p.value),
    tarifa_cents: centavos(p.value) - centavos(p.netValue),
    devolvido_cents: centavos(p.refundedValue ?? 0),
    paga_em: p.paymentDate ?? null,
    provedor_estorno_id: p.refunds?.at(-1)?.id ?? null,
  });
  return {
    criarCliente: async () => (await chamar('POST', '/v3/customers', { name: 'Pagador de teste', cpfCnpj: '00000000000', notificationDisabled: true })).id,
    /** Cria a cobrança Pix com a divisão em valor fixo para a carteira da clínica (§3.3). */
    async criarCobranca({ referencia, valorCents, clinicaCents, walletId, descricao, clienteId }) {
      const p = await chamar('POST', '/v3/payments', {
        customer: clienteId, billingType: 'PIX', value: Number(reais(valorCents)), description: descricao,
        externalReference: referencia, split: [{ walletId, fixedValue: Number(reais(clinicaCents)) }],
      });
      const qr = await chamar('GET', `/v3/payments/${p.id}/pixQrCode`);
      return { id: p.id, copiaCola: qr.payload };
    },
    consultar: async (id) => foto(await chamar('GET', `/v3/payments/${id}`)),
    /** Apaga a cobrança; se já foi paga, o provedor recusa e a foto diz "paga". */
    async apagar(id) {
      try {
        await chamar('DELETE', `/v3/payments/${id}`);
      } catch (e) {
        if (e.codigo !== 'ja_paga') throw e;
      }
      return foto(await chamar('GET', `/v3/payments/${id}`));
    },
    /** Devolve (total ou parte), dizendo quanto sai da carteira da clínica; a chave evita devolver duas vezes. */
    async devolver(id, { valorCents, clinicaCents, walletId, total, chave }) {
      const p = await chamar('POST', `/v3/payments/${id}/refund`, {
        ...(total ? {} : { value: Number(reais(valorCents)) }),
        ...(clinicaCents ? { splitRefunds: [{ walletId, value: Number(reais(clinicaCents)) }] } : {}),
      }, { 'x-chave-idempotencia': chave });
      return { estornoId: p.refundId, foto: foto(p) };
    },
    /** As cobranças do dia, no formato de public.pag_reconcile_apply. */
    async listar(dia) {
      const { data } = await chamar('GET', `/v3/payments?dateCreated=${dia}`);
      return data.map((p) => ({
        provedor_cobranca_id: p.id, situacao: foto(p).situacao, valor_cents: centavos(p.value),
        repasse_cents: centavos(p.split?.[0]?.fixedValue ?? 0), tarifa_cents: centavos(p.value) - centavos(p.netValue),
        devolvido_cents: centavos(p.refundedValue ?? 0),
      }));
    },
  };
}

/* ===================== As "funções do servidor" de mentira (o que as Edge Functions da P2 vão fazer) ===================== */

/** Roda `sql` como o servidor (service_role), numa transação própria. Devolve a primeira coluna da primeira linha. */
export async function comoServidor(db, sql, params = []) {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', '{"role": "service_role"}', true), set_config('role', 'service_role', true)`);
    const { rows } = await db.query(sql, params);
    await db.query('commit');
    return rows[0] ? Object.values(rows[0])[0] : undefined;
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  }
}

/**
 * "Ir para o pagamento" (pagamento-criar): reserva → cobrança aqui → cobrança no provedor → anexar. Se o provedor falhar,
 * a reserva é solta na hora (§4.4). Devolve { status, reserva, cobranca, provedorId }.
 */
export async function criarPagamento(db, prov, { clinica, itens, paciente, id, codigo, chave }) {
  const reserva = await comoServidor(db, 'select public.agenda_pay_hold($1, $2, $3, $4, $5)',
    [clinica, JSON.stringify(itens), JSON.stringify(paciente), id, codigo]);
  if (reserva.status !== 'ok') return { status: reserva.status, reserva };
  const cobranca = await comoServidor(db, 'select public.pag_charge_open($1, $2, $3, $4)', [id, codigo, 'pix', chave]);
  if (cobranca.status !== 'ok') return { status: cobranca.status, reserva, cobranca };
  let criada;
  try {
    criada = await prov.criarCobranca({
      referencia: cobranca.referencia, valorCents: cobranca.valor_cents, clinicaCents: cobranca.clinica_cents,
      walletId: cobranca.wallet_id, descricao: cobranca.descricao, clienteId: await prov.criarCliente(),
    });
  } catch (e) {
    const solta = await comoServidor(db, 'select public.pag_charge_abort($1)', [id]);
    return { status: 'provider_unavailable', erro: e.codigo ?? e.message, reserva, cobranca, solta };
  }
  const anexada = await comoServidor(db, 'select public.pag_charge_attach($1, $2, null, $3)', [cobranca.charge_id, criada.id, criada.copiaCola]);
  return { status: anexada.status, reserva, cobranca, anexada, provedorId: criada.id, chargeId: cobranca.charge_id };
}

/**
 * O aviso do provedor (pagamento-webhook): grava; se é novo, consulta a cobrança no provedor e aplica a situação
 * consultada (nunca o corpo do aviso). Devolve { gravado, aplicado }.
 */
export async function receberAviso(db, prov, evento) {
  const gravado = await comoServidor(db, 'select public.pag_event_store($1, $2, $3, $4, $5, $6, $7)',
    ['asaas', evento.id, evento.event, evento.payment.id, evento.payment.status, Math.round(evento.payment.value * 100), evento.dateCreated]);
  if (gravado.status !== 'ok') return { gravado };
  const foto = await prov.consultar(evento.payment.id);
  const aplicado = await comoServidor(db, 'select public.pag_sync_apply($1, $2, $3)', [gravado.charge_id, JSON.stringify(foto), gravado.event_id]);
  return { gravado, aplicado };
}

/** Envia UMA devolução pedida (o que a rotina faz com "enviar_devolucao" e "reenviar_devolucao"). */
export async function enviarDevolucao(db, prov, refundId) {
  const env = await comoServidor(db, 'select public.pag_refund_sent($1)', [refundId]);
  if (env.status !== 'ok') return { enviada: env };
  try {
    const r = await prov.devolver(env.provedor_cobranca_id, {
      valorCents: env.valor_cents, clinicaCents: env.integral ? 0 : env.clinica_cents, walletId: env.wallet_id,
      total: env.total, chave: env.chave_idempotencia,
    });
    return { enviada: env, concluida: await comoServidor(db, 'select public.pag_refund_done($1, $2)', [refundId, r.estornoId]) };
  } catch (e) {
    return { enviada: env, falhou: await comoServidor(db, 'select public.pag_refund_failed($1, $2)', [refundId, e.codigo ?? 'erro_no_envio']) };
  }
}

/** Uma passada da rotina (pagamento-rotina): faz tudo o que public.pag_due() pedir. Devolve o que fez, por ação. */
export async function rotina(db, prov, { so = null } = {}) {
  const { acoes } = await comoServidor(db, 'select public.pag_due()');
  const feito = {};
  for (const a of acoes) {
    if (so && !so.includes(a.acao)) continue;
    feito[a.acao] = (feito[a.acao] ?? 0) + 1;
    if (a.acao === 'abortar') {
      await comoServidor(db, 'select public.pag_charge_abort($1)', [a.request_id]);
    } else if (a.acao === 'apagar') {
      // (apagar já devolve a foto: se foi paga no último segundo, aplica o pagamento em vez de expirar)
      await comoServidor(db, 'select public.pag_sync_apply($1, $2)', [a.charge_id, JSON.stringify(await prov.apagar(a.provedor_cobranca_id))]);
    } else if (a.acao === 'consultar' || a.acao === 'reaplicar') {
      await comoServidor(db, 'select public.pag_sync_apply($1, $2, $3)',
        [a.charge_id, JSON.stringify(await prov.consultar(a.provedor_cobranca_id)), a.event_id ?? null]);
    } else if (a.acao === 'enviar_devolucao' || a.acao === 'reenviar_devolucao') {
      await enviarDevolucao(db, prov, a.refund_id);
    } else if (a.acao === 'conciliar') {
      await comoServidor(db, 'select public.pag_reconcile_apply($1, $2, $3)', [a.dia, JSON.stringify(await prov.listar(a.dia)), a.janela]);
    }
  }
  return feito;
}

/* ===================== Clínica de teste com o recebimento ligado ===================== */

/**
 * Liga o recebimento da clínica de teste pelos passos de verdade: a chave geral (dono do IMED), a carteira e os termos
 * (dona da clínica), a conferência (dono do IMED) e o modo online (dona). `admin`: { sub, email } de um usuário que o
 * teste põe em admin_emails. Devolve a tarifa do Pix que está no parâmetro do banco (para o provedor falso usar a mesma).
 */
export async function ligarRecebimento(db, comoUsuario, { clinica, dona, admin, carteira }) {
  await db.query(`insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
                  values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
                          '{"provider": "email", "providers": ["email"]}', '{}', now(), now()) on conflict (id) do nothing`, [admin.sub, admin.email]);
  await db.query('insert into public.admin_emails (email) values ($1) on conflict do nothing', [admin.email]);
  const ok = (j, o) => { if (j?.status !== 'ok') throw new Error(`${o}: ${JSON.stringify(j)}`); return j; };
  ok(await comoUsuario(db, admin, `select public.admin_pag_chave_geral(true, 'teste_ci')`), 'chave geral');
  ok(await comoUsuario(db, dona, 'select public.pag_clinic_connect($1, $2, $3)', [clinica, carteira, 'v1']), 'ligar o recebimento');
  ok(await comoUsuario(db, admin, `select public.admin_pag_conta_conferir($1, 'ativa', 'conta_de_teste_conferida')`, [clinica]), 'conferir a conta');
  ok(await comoUsuario(db, dona, 'select public.pag_clinic_pause($1, false)', [clinica]), 'modo online');
  const { rows: [t] } = await db.query(`select (valor #>> '{}')::int as c from pagamentos.settings where chave = 'tarifa_pix_cents'`);
  return { tarifaPixCents: t.c };
}

/**
 * Apaga tudo o que o teste gravou no pagamento desta clínica (com a marca de emergência, registrada) e desliga a chave
 * geral de novo. Chamar ANTES de limparClinicaAgenda (as cobranças apontam para os agendamentos). O extrato e a trilha
 * só acrescentam: as linhas deles ficam (sem chave estrangeira; o banco do CI é descartável).
 */
export async function limparPagamento(db, { clinica, admin }) {
  if ((await db.query(`select to_regclass('pagamentos.charges') is not null as tem`)).rows[0].tem) {
    await db.query('begin');
    await db.query(`select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'limpeza_teste_ci', true)`);
    await db.query(`delete from pagamentos.reconciliation_diffs d where d.charge_id in (select id from pagamentos.charges where clinic_id = $1)
                       or d.provedor_cobranca_id like 'pay_falso_%'`, [clinica]);
    await db.query(`delete from pagamentos.reconciliation_runs r where not exists (select 1 from pagamentos.reconciliation_diffs d where d.run_id = r.id)`);
    await db.query(`delete from pagamentos.events e where e.charge_id in (select id from pagamentos.charges where clinic_id = $1)
                       or e.provedor_evento_id like 'evt_falso_%'`, [clinica]);
    await db.query('delete from pagamentos.refunds where charge_id in (select id from pagamentos.charges where clinic_id = $1)', [clinica]);
    await db.query('delete from pagamentos.disputes where charge_id in (select id from pagamentos.charges where clinic_id = $1)', [clinica]);
    await db.query('delete from pagamentos.charge_items where charge_id in (select id from pagamentos.charges where clinic_id = $1)', [clinica]);
    await db.query('delete from pagamentos.charges where clinic_id = $1', [clinica]);
    await db.query('delete from pagamentos.payers p where not exists (select 1 from pagamentos.charges c where c.payer_id = p.id)');
    await db.query('delete from pagamentos.featured where clinic_id = $1', [clinica]);
    await db.query('delete from pagamentos.subscriptions where clinic_id = $1', [clinica]);
    await db.query('delete from pagamentos.fee_rules where clinic_id = $1', [clinica]);
    await db.query('delete from pagamentos.clinic_accounts where clinic_id = $1', [clinica]);
    await db.query(`update pagamentos.settings set valor = 'false', atualizado_em = now() where chave = 'vendas_online_ligadas'`);
    await db.query('commit');
  }
  if (admin) {
    await db.query('delete from public.admin_emails where email = $1', [admin.email]);
    await db.query('delete from auth.users where id = $1', [admin.sub]);
  }
}

/** O que nunca pode acontecer (P-I1 a P-I5), olhando os dados da clínica. Lista vazia = tudo certo. */
export async function violacoesPagamento(db, clinica) {
  const { rows } = await db.query(`
    select 'P-I1: agendamento ' || a.id || ' confirmado com pagamento online e ' || n.n || ' cobrança(s) aprovada(s) do valor dele' as v
    from public.appointment_requests a
    cross join lateral (select count(*) as n from pagamentos.charges c
                        where c.request_id = a.id and c.situacao in ('aprovada', 'devolvida_parcial', 'contestada') and c.valor_cents = a.total_cents) n
    where a.clinic_id = $1 and a.payment_mode = 'online' and a.status in ('confirmed', 'checked_in', 'in_service') and n.n <> 1
    union all
    select 'P-I2: cobrança ' || c.id || ' aprovada, agendamento ' || a.status || ' e nenhuma devolução pedida'
    from pagamentos.charges c join public.appointment_requests a on a.id = c.request_id
    where c.clinic_id = $1 and c.situacao = 'aprovada' and not private.agenda_active_status(a.status)
      and not exists (select 1 from pagamentos.refunds f where f.charge_id = c.id and f.situacao in ('pedida', 'enviada', 'falhou', 'concluida'))
    union all
    select 'P-I3: agendamento ' || c.request_id || ' com ' || count(*) || ' cobranças vivas'
    from pagamentos.charges c
    where c.clinic_id = $1 and c.request_id is not null and c.situacao in ('criada', 'aguardando', 'processando', 'aprovada', 'devolvida_parcial', 'contestada')
    group by c.request_id having count(*) > 1
    union all
    select 'P-I4: cobrança ' || c.id || ' com valor diferente de taxa + parte da clínica (ou da soma dos exames)'
    from pagamentos.charges c
    where c.clinic_id = $1 and (c.valor_cents <> c.taxa_cents + c.clinica_cents
       or (c.finalidade = 'agendamento' and c.valor_cents <> (select coalesce(sum(ci.preco_cents), 0) from pagamentos.charge_items ci where ci.charge_id = c.id)))
    union all
    select 'P-I5: cobrança ' || c.id || ' com devolvido acima do pago ou conta da devolução aberta'
    from pagamentos.charges c
    where c.clinic_id = $1 and (c.devolvido_cents > c.valor_cents or c.taxa_devolvida_cents > c.taxa_cents
       or c.clinica_devolvida_cents > c.clinica_cents or c.devolvido_cents <> c.taxa_devolvida_cents + c.clinica_devolvida_cents
       or c.devolvido_cents <> (select coalesce(sum(f.valor_cents), 0) from pagamentos.refunds f where f.charge_id = c.id and f.situacao = 'concluida' and not f.integral))
    union all
    select 'extrato: cobrança ' || l.charge_id || ' com ' || l.n || ' linhas "recebido"'
    from (select l.charge_id, count(*) as n from pagamentos.ledger l
          where l.clinic_id = $1 and l.tipo = 'recebido' group by 1 having count(*) > 1) l`, [clinica]);
  return rows.map((r) => r.v);
}
