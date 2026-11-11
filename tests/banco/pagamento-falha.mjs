// iMed Pagamentos, fase P1 — falha no meio, no banco de verdade (arquitetura do pagamento §4.4 e §11). Roda no GitHub
// (banco.yml):
//   node tests/banco/pagamento-falha.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
//   1. A conexão cai (pg_terminate_backend) no meio do aviso de pagamento, depois de aplicar e antes do COMMIT: nada
//      pela metade (nem aviso, nem cobrança aprovada, nem extrato, nem agendamento confirmado); reentregue, aplica.
//   2. A conexão cai no meio do envio da devolução: a devolução continua "pedida"; o provedor nem foi chamado.
//   3. O provedor devolveu e a resposta se perdeu (a conexão cai antes de registrar): a rotina reenvia com a MESMA chave;
//      o provedor não devolve duas vezes e a cobrança soma uma vez.
//   4. O provedor está fora do ar ao criar a cobrança: a reserva é solta na hora; depois, funciona.
//   5. A função cai entre a reserva e a cobrança: a rotina solta a reserva sem cobrança (60 s).
//   6. O aviso nunca chega: a rotina consulta a cobrança perto de vencer e confirma.
//   7. O QR venceu e foi pago no último segundo: ao apagar, a rotina descobre o pagamento e confirma (a reserva ainda vale).
//   8. O QR foi apagado e MESMO ASSIM foi pago: não reabre; o dinheiro volta inteiro.
//   9. No fim, a conciliação do dia com o provedor não acha nenhuma diferença.
// O provedor é o de mentira (tests/banco/asaas-falso.mjs). Os dados são apagados no fim.

import { randomUUID } from 'node:crypto';
import {
  afirmar, anotar, comoUsuario, configLocal, conectar, criarClinicaAgenda, descreverErro, horaSP, limparClinicaAgenda, principal, resumir,
} from './lib.mjs';
import {
  clienteDoProvedor, comoServidor, criarPagamento, ligarRecebimento, limparPagamento, receberAviso, rotina, subirAsaasFalso,
  violacoesPagamento,
} from './asaas-falso.mjs';

const CLINICA = 'cc000000-0000-4000-8000-000000005a05';
const DONA = 'a5000000-0000-4000-8000-000000005a05';
const EMAIL = 'dona.pagfalha@exemplo.test';
const ADMIN = { sub: 'a5000000-0000-4000-8000-000000005a95', email: 'admin.pagfalha@exemplo.test' };
const DIA = 16;

await principal('pagamento-falha', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-pag-falha');
  const notas = [];
  let falso = null;
  try {
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN });
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA });
    const { procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA, email: EMAIL, nome: 'Clínica da Falha do Pagamento do CI',
      recursos: [{ chave: 'sala', name: 'Sala grande', kind: 'sala', capacity: 50 }],
      // preço de exemplo, só para a conta
      procedimentos: [{ chave: 'p', name: 'Exame de 5 minutos', duration_min: 5, price_cents: 9990, grupos: [['sala']] }],
    });
    const dona = { sub: DONA, email: EMAIL };
    const { tarifaPixCents } = await ligarRecebimento(db, comoUsuario, { clinica: CLINICA, dona, admin: ADMIN, carteira: 'wal_teste_falha_0001' });
    falso = await subirAsaasFalso({ tarifaPixCents });
    const prov = clienteDoProvedor(falso);
    let n = 0;
    const dados = (hhmm) => {
      n++;
      return { clinica: CLINICA, itens: [{ procedure_id: P.p, starts_at: horaSP(DIA, hhmm) }], id: randomUUID(), codigo: `codigo-falha-pag-${randomUUID()}`,
        chave: randomUUID(), paciente: { name: `Paciente Falha ${n}`, phone: `119${String(50000 + n).padStart(8, '0')}`, consent: true } };
    };
    const novo = async (hhmm) => {
      const d = dados(hhmm);
      const r = await criarPagamento(db, prov, d);
      if (r.status !== 'ok') throw new Error(`pagamento ${n}: ${JSON.stringify(r)}`);
      return { ...d, ...r };
    };
    const estado = async (p) => (await db.query(`
      select (select status from public.appointment_requests where id = $1) as pedido, c.situacao, c.devolvido_cents as devolvido,
             (select count(*)::int from pagamentos.ledger l where l.charge_id = c.id) as extrato,
             (select count(*)::int from pagamentos.events e where e.charge_id = c.id) as avisos,
             (select coalesce(string_agg(f.situacao, ','), '-') from pagamentos.refunds f where f.charge_id = c.id) as devolucoes
      from pagamentos.charges c where c.request_id = $1 order by c.criado_em desc limit 1`, [p.id])).rows[0];
    const servidor = (c) => c.query(`select set_config('request.jwt.claims', '{"role": "service_role"}', true), set_config('role', 'service_role', true)`);
    const pid = async (c) => (await c.query('select pg_backend_pid() as p')).rows[0].p;
    const derrubar = async (c, p) => {
      await db.query('select pg_terminate_backend($1)', [p]);
      await c.end().catch(() => {});
      await new Promise((ok) => setTimeout(ok, 300));
    };
    const cancelar = async (p) => {
      await db.query('begin');
      await db.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('role', 'anon', true)`);
      const { rows: [r] } = await db.query('select public.agenda_cancel($1, null, $2) as j', [p.id, p.codigo]);
      await db.query('commit');
      return r.j;
    };
    // "relógio": empurra o prazo da cobrança (e, se pedido, o da reserva) para trás
    const passar = async (p, { cobrancaMin = 0, reservaMin = 0 }) => {
      await db.query('begin');
      await db.query(`select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_relogio', true)`);
      await db.query(`update pagamentos.charges set expira_em = expira_em - make_interval(mins => $2) where request_id = $1`, [p.id, cobrancaMin]);
      if (reservaMin) {
        await db.query(`update public.appointment_requests set hold_expires_at = hold_expires_at - make_interval(mins => $2), created_at = created_at - make_interval(mins => $2)
                        where id = $1`, [p.id, reservaMin]);
      }
      await db.query('commit');
    };

    /* ---------- 1. Cai no meio do aviso de pagamento ---------- */
    {
      const p = await novo('09:00');
      const ev = falso.pagar(p.provedorId);
      const c = await conectar(cfg.dbUrl, 'imed-pag-vai-cair');
      const p0 = await pid(c);
      await c.query('begin');
      await servidor(c);
      const { rows: [g] } = await c.query('select public.pag_event_store($1, $2, $3, $4, $5, $6, $7) as j',
        ['asaas', ev.id, ev.event, ev.payment.id, ev.payment.status, Math.round(ev.payment.value * 100), ev.dateCreated]);
      const { rows: [a] } = await c.query('select public.pag_sync_apply($1, $2, $3) as j', [g.j.charge_id, JSON.stringify(await prov.consultar(ev.payment.id)), g.j.event_id]);
      await derrubar(c, p0);
      const e = await estado(p);
      afirmar(a.j.request_status === 'confirmed' && e.pedido === 'awaiting_payment' && e.situacao === 'aguardando' && e.extrato === 0 && e.avisos === 0,
        'a conexão caiu no meio do aviso (depois de aplicar, antes do COMMIT): nada pela metade', JSON.stringify({ dentroDaTransacao: a.j, depois: e }));
      const r = await receberAviso(db, prov, ev);   // o provedor reentrega
      const e2 = await estado(p);
      afirmar(r.gravado.status === 'ok' && r.aplicado?.request_status === 'confirmed' && e2.pedido === 'confirmed' && e2.situacao === 'aprovada' && e2.extrato === 4,
        'o aviso é reentregue e aplicado uma vez', JSON.stringify({ r, e2 }));
      notas.push(`Queda no meio do aviso: ${e.pedido}/${e.situacao}, ${e.extrato} linha no extrato; reentregue → ${e2.pedido}/${e2.situacao}`);

      /* ---------- 2. Cai no meio do envio da devolução ---------- */
      const canc = await cancelar(p);
      const { rows: [f] } = await db.query(`select id from pagamentos.refunds where charge_id = $1`, [p.chargeId]);
      const c2 = await conectar(cfg.dbUrl, 'imed-pag-vai-cair-2');
      const p2 = await pid(c2);
      await c2.query('begin');
      await servidor(c2);
      const { rows: [env] } = await c2.query('select public.pag_refund_sent($1) as j', [f.id]);
      await derrubar(c2, p2);
      const e3 = await estado(p);
      afirmar(canc.status === 'ok' && env.j.status === 'ok' && e3.devolucoes === 'pedida' && falso.cobrancas.get(p.provedorId).estornos.length === 0,
        'a conexão caiu no meio do envio da devolução: ela continua "pedida" e o provedor não foi chamado', JSON.stringify({ dentro: env.j.status, depois: e3 }));

      /* ---------- 3. O provedor devolveu e a resposta se perdeu ---------- */
      const env2 = await comoServidor(db, 'select public.pag_refund_sent($1)', [f.id]);
      const dev = await prov.devolver(env2.provedor_cobranca_id, { valorCents: env2.valor_cents, clinicaCents: env2.clinica_cents, walletId: env2.wallet_id, total: env2.total, chave: env2.chave_idempotencia });
      const c3 = await conectar(cfg.dbUrl, 'imed-pag-vai-cair-3');
      const p3 = await pid(c3);
      await c3.query('begin');
      await servidor(c3);
      await c3.query('select public.pag_refund_done($1, $2)', [f.id, dev.estornoId]);
      await derrubar(c3, p3);
      const e4 = await estado(p);
      afirmar(e4.devolucoes === 'enviada' && e4.situacao === 'aprovada' && e4.devolvido === 0 && falso.cobrancas.get(p.provedorId).estornos.length === 1,
        'o provedor devolveu e o registro se perdeu: aqui a devolução fica "enviada", sem nada somado', JSON.stringify(e4));
      const vazio = await rotina(db, prov, { so: ['enviar_devolucao', 'reenviar_devolucao'] });
      await db.query(`update pagamentos.refunds set enviada_em = now() - interval '6 minutes', atualizado_em = now() - interval '6 minutes' where id = $1`, [f.id]);
      const feito = await rotina(db, prov, { so: ['enviar_devolucao', 'reenviar_devolucao'] });
      const e5 = await estado(p);
      falso.avisos();
      afirmar(Object.keys(vazio).length === 0 && feito.reenviar_devolucao === 1 && e5.devolucoes === 'concluida' && e5.situacao === 'devolvida'
        && e5.devolvido === 9990 && falso.cobrancas.get(p.provedorId).estornos.length === 1,
      'a rotina espera 5 minutos e reenvia com a MESMA chave: o provedor não devolve duas vezes e a cobrança soma uma vez',
      JSON.stringify({ antesDos5Min: vazio, feito, e5, estornosNoProvedor: falso.cobrancas.get(p.provedorId).estornos.length }));
      notas.push(`Devolução: queda no envio → ${e3.devolucoes}; resposta perdida → ${e4.devolucoes}; reenvio → ${e5.devolucoes}, 1 estorno no provedor`);
    }

    /* ---------- 4. Provedor fora do ar ao criar a cobrança ---------- */
    {
      falso.foraDoAr(true);
      const d = dados('09:10');
      const r = await criarPagamento(db, prov, d);
      falso.foraDoAr(false);
      const e = await estado(d);
      const { rows: [a] } = await db.query(`select cancelled_by, cancel_reason from public.appointment_requests where id = $1`, [d.id]);
      const { rows: [o] } = await db.query(`select count(*)::int as ativas from agenda.occupancy o join agenda.appointment_items i on i.id = o.item_id
                                           where i.request_id = $1 and o.active`, [d.id]);
      afirmar(r.status === 'provider_unavailable' && e.pedido === 'cancelled' && e.situacao === 'cancelada' && a.cancelled_by === 'system' && o.ativas === 0,
        'provedor fora do ar ao criar a cobrança: a reserva é solta na hora (pelo sistema) e nada fica segurando o horário',
        JSON.stringify({ resposta: r.status, erro: r.erro, ...e, ...a, ...o }));
      const d2 = { ...dados('09:10'), paciente: d.paciente };
      const r2 = await criarPagamento(db, prov, d2);
      afirmar(r2.status === 'ok', 'com o provedor de volta, o mesmo paciente consegue reservar e pagar o mesmo horário', JSON.stringify(r2.status));
      const r3 = await receberAviso(db, prov, falso.pagar(r2.provedorId));
      afirmar(r3.aplicado?.request_status === 'confirmed', 'e o pagamento confirma', JSON.stringify(r3.aplicado));
      notas.push(`Provedor fora do ar: ${r.status} (${r.erro}); reserva ${e.pedido} por ${a.cancelled_by}; depois ${r3.aplicado?.request_status}`);
    }

    /* ---------- 5. A função cai entre a reserva e a cobrança ---------- */
    {
      const d = dados('09:15');
      const res = await comoServidor(db, 'select public.agenda_pay_hold($1, $2, $3, $4, $5)', [d.clinica, JSON.stringify(d.itens), JSON.stringify(d.paciente), d.id, d.codigo]);
      const antes = await rotina(db, prov, { so: ['abortar'] });
      await passar(d, { reservaMin: 2 });
      const depois = await rotina(db, prov, { so: ['abortar'] });
      const { rows: [a] } = await db.query(`select status, cancelled_by from public.appointment_requests where id = $1`, [d.id]);
      afirmar(res.status === 'ok' && !antes.abortar && depois.abortar === 1 && a.status === 'cancelled' && a.cancelled_by === 'system',
        'reserva sem cobrança: nos primeiros 60 s a rotina espera; depois, solta', JSON.stringify({ antes, depois, ...a }));
      notas.push(`Reserva sem cobrança: solta pela rotina depois de 60 s (${a.status})`);
    }

    /* ---------- 6. O aviso nunca chega ---------- */
    {
      const p = await novo('09:20');
      falso.pagar(p.provedorId);
      falso.avisos();                                   // o aviso se perde
      const antes = await rotina(db, prov, { so: ['consultar'] });
      await passar(p, { cobrancaMin: 7 });              // falta 1 minuto para o QR vencer
      const depois = await rotina(db, prov, { so: ['consultar'] });
      const e = await estado(p);
      afirmar(!antes.consultar && depois.consultar === 1 && e.pedido === 'confirmed' && e.situacao === 'aprovada' && e.avisos === 0,
        'o aviso não chegou: a rotina consulta a cobrança perto de vencer e confirma por conta própria', JSON.stringify({ antes, depois, ...e }));
      notas.push(`Aviso perdido: a rotina consultou e ${e.pedido}`);
    }

    /* ---------- 7. Pago no último segundo, a rotina ia apagar ---------- */
    {
      const p = await novo('09:25');
      falso.pagar(p.provedorId);
      falso.avisos();
      await passar(p, { cobrancaMin: 9 });              // o QR venceu há 1 minuto; a reserva ainda vale
      const feito = await rotina(db, prov, { so: ['apagar'] });
      const e = await estado(p);
      afirmar(feito.apagar === 1 && e.pedido === 'confirmed' && e.situacao === 'aprovada' && !falso.cobrancas.get(p.provedorId).apagada,
        'pago no último segundo: ao apagar a cobrança vencida, o provedor recusa (já paga) e a rotina aplica o pagamento', JSON.stringify({ feito, ...e }));
      notas.push(`Pago no último segundo: ${e.pedido}/${e.situacao}`);
    }

    /* ---------- 8. Apagada e paga mesmo assim ---------- */
    {
      const p = await novo('09:30');
      await passar(p, { cobrancaMin: 9 });
      const feito = await rotina(db, prov, { so: ['apagar'] });
      const e0 = await estado(p);
      const r = await receberAviso(db, prov, falso.pagar(p.provedorId, { mesmoApagada: true }));
      const e1 = await estado(p);
      const dev = await rotina(db, prov, { so: ['enviar_devolucao'] });
      const e2 = await estado(p);
      falso.avisos();
      afirmar(feito.apagar === 1 && e0.situacao === 'expirada' && r.aplicado?.acao === 'devolver' && e1.situacao === 'expirada' && e1.devolucoes === 'pedida'
        && dev.enviar_devolucao === 1 && e2.situacao === 'devolvida' && falso.cobrancas.get(p.provedorId).status === 'REFUNDED',
      'QR apagado e pago mesmo assim: a cobrança NÃO reabre; o dinheiro volta inteiro (aqui e no provedor)',
      JSON.stringify({ apagada: e0.situacao, aviso: r.aplicado, pedida: e1, devolvida: e2, noProvedor: falso.cobrancas.get(p.provedorId).status }));
      notas.push(`Apagada e paga: ${e1.situacao} → ${e2.situacao}; reserva ${e2.pedido}`);
    }

    /* ---------- 9. A conciliação do dia fecha ---------- */
    {
      const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
      const linhas = await prov.listar(hoje);
      const c = await comoServidor(db, 'select public.pag_reconcile_apply($1, $2)', [hoje, JSON.stringify(linhas)]);
      const { rows: difs } = await db.query(`select d.tipo, d.gravidade, d.nosso, d.deles from pagamentos.reconciliation_diffs d where d.run_id = $1`, [c.run_id]);
      afirmar(c.status === 'ok' && c.novas === 0 && c.linhas === linhas.length && c.linhas >= 5,
        'conciliação do dia com o provedor: nenhuma diferença (pagas, devolvidas, canceladas e a paga depois de apagada)', JSON.stringify({ c, difs }));
      notas.push(`Conciliação: ${c.linhas} cobranças do provedor, ${c.pagas_aqui} pagas aqui, ${c.novas} diferenças`);
    }

    const v = await violacoesPagamento(db, CLINICA);
    afirmar(v.length === 0, 'nenhum invariante do pagamento quebrado (P-I1 a P-I5)', v.join('\n'));
    resumir('pagamento-falha', {}, notas);
  } finally {
    await falso?.fechar().catch(() => {});
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste do pagamento (falha)', descreverErro(e)));
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (pagamento-falha)', descreverErro(e)));
    await db.end();
  }
});
