// iMed Pagamentos, fase P1 — aviso repetido e fora de ordem, no banco de verdade (arquitetura do pagamento §4.4 e §11).
// Roda no GitHub (banco.yml):
//   node tests/banco/pagamento-aviso.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
//   1. O MESMO aviso 50 vezes ao mesmo tempo → 1 aplicado, 49 repetidos, um só conjunto de linhas no extrato.
//   2. 50 avisos DIFERENTES do mesmo pagamento ao mesmo tempo (o provedor manda "confirmado" e "recebido", e repete) →
//      todos gravados, 1 aplicado, 49 "repetido" (a situação já estava aplicada), um só conjunto de linhas.
//   3. Fora de ordem: um aviso antigo ("criada") entregue depois do pagamento não muda nada; o aviso de devolução que
//      chega antes de a rotina registrar a resposta conclui a devolução uma vez só.
// O provedor é o de mentira (tests/banco/asaas-falso.mjs); a parte sem COMMIT está em supabase/tests/530_pag_aviso.sql.
// Os dados são criados aqui e apagados no fim; a chave geral volta a ficar desligada.

import { randomUUID } from 'node:crypto';
import {
  afirmar, anotar, comoUsuario, configLocal, conectar, criarClinicaAgenda, descreverErro, horaSP, limparClinicaAgenda, principal,
  resumir, rodarJuntos,
} from './lib.mjs';
import {
  clienteDoProvedor, comoServidor, criarPagamento, enviarDevolucao, ligarRecebimento, limparPagamento, receberAviso, subirAsaasFalso,
  violacoesPagamento,
} from './asaas-falso.mjs';

const CLINICA = 'cc000000-0000-4000-8000-000000005a01';
const DONA = 'a5000000-0000-4000-8000-000000005a01';
const EMAIL = 'dona.pagaviso@exemplo.test';
const ADMIN = { sub: 'a5000000-0000-4000-8000-000000005a91', email: 'admin.pagaviso@exemplo.test' };
const DIA = 21;
const N = 50;

await principal('pagamento-aviso', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-pag-aviso');
  const notas = [];
  let falso = null;
  try {
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN });
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA });
    const { procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA, email: EMAIL, nome: 'Clínica do Aviso do CI',
      recursos: [{ chave: 'sala', name: 'Sala grande', kind: 'sala', capacity: 50 }],
      // preço de exemplo, só para a conta (não é preço de clínica nenhuma)
      procedimentos: [{ chave: 'p', name: 'Exame de 5 minutos', duration_min: 5, price_cents: 15000, grupos: [['sala']] }],
    });
    const { tarifaPixCents } = await ligarRecebimento(db, comoUsuario, { clinica: CLINICA, dona: { sub: DONA, email: EMAIL }, admin: ADMIN, carteira: 'wal_teste_aviso_0001' });
    falso = await subirAsaasFalso({ tarifaPixCents });
    const prov = clienteDoProvedor(falso);
    let n = 0;
    const novo = async (hhmm) => {
      n++;
      const id = randomUUID();
      const r = await criarPagamento(db, prov, {
        clinica: CLINICA, itens: [{ procedure_id: P.p, starts_at: horaSP(DIA, hhmm) }], id, codigo: `codigo-aviso-${randomUUID()}`,
        paciente: { name: `Paciente Aviso ${n}`, phone: `119${String(5000 + n).padStart(8, '0')}`, consent: true }, chave: randomUUID(),
      });
      if (r.status !== 'ok') throw new Error(`pagamento ${n}: ${JSON.stringify(r)}`);
      return { id, ...r };
    };
    const estado = async (p) => (await db.query(`
      select (select status from public.appointment_requests where id = $1) as pedido, c.situacao, c.devolvido_cents as devolvido,
             (select coalesce(string_agg(l.tipo || ':' || l.valor_cents, ',' order by l.id), '-') from pagamentos.ledger l where l.charge_id = c.id) as extrato
      from pagamentos.charges c where c.id = $2`, [p.id, p.chargeId])).rows[0];
    const servidor = (c) => c.query(`select set_config('request.jwt.claims', '{"role": "service_role"}', true), set_config('role', 'service_role', true)`);
    const esperado = `recebido:15000,taxa_imed:2250,repasse_clinica:12750,tarifa_meio:${tarifaPixCents}`;

    /* ---------- 1. O mesmo aviso 50 vezes ao mesmo tempo ---------- */
    {
      const p = await novo('09:00');
      const ev = falso.pagar(p.provedorId);
      const { resultados } = await rodarJuntos({
        conexao: cfg.dbUrl, n: N, chave: 5301,
        trabalho: async (c) => {
          await servidor(c);
          const { rows: [g] } = await c.query('select public.pag_event_store($1, $2, $3, $4, $5, $6, $7) as j',
            ['asaas', ev.id, ev.event, ev.payment.id, ev.payment.status, Math.round(ev.payment.value * 100), ev.dateCreated]);
          if (g.j.status !== 'ok') return g.j.status;
          const foto = await prov.consultar(ev.payment.id);
          const { rows: [a] } = await c.query('select public.pag_sync_apply($1, $2, $3) as j', [g.j.charge_id, JSON.stringify(foto), g.j.event_id]);
          return `gravado+${a.j.resultado}`;
        },
      });
      const conta = {};
      for (const r of resultados) conta[r.valor ?? r.code] = (conta[r.valor ?? r.code] ?? 0) + 1;
      const e = await estado(p);
      const { rows: [evs] } = await db.query(`select count(*)::int as linhas, max(repeticoes) as repeticoes, max(resultado) as resultado
                                             from pagamentos.events where provedor_evento_id = $1`, [ev.id]);
      afirmar(conta['gravado+aplicado'] === 1 && conta.repetido === N - 1, `o mesmo aviso ${N} vezes ao mesmo tempo: 1 aplicado e ${N - 1} repetidos`, JSON.stringify(conta));
      afirmar(evs.linhas === 1 && evs.repeticoes === N - 1 && evs.resultado === 'aplicado', 'uma linha do aviso, com as repetições contadas', JSON.stringify(evs));
      afirmar(e.pedido === 'confirmed' && e.situacao === 'aprovada' && e.extrato === esperado,
        'agendamento confirmado, cobrança aprovada e UM conjunto de linhas no extrato', JSON.stringify(e));
      notas.push(`O mesmo aviso ${N}× em paralelo: ${JSON.stringify(conta)}; um conjunto de linhas no extrato`);
    }

    /* ---------- 2. 50 avisos diferentes do mesmo pagamento ---------- */
    {
      const p = await novo('09:05');
      const ev = falso.pagar(p.provedorId);
      const { resultados } = await rodarJuntos({
        conexao: cfg.dbUrl, n: N, chave: 5302,
        trabalho: async (c, i) => {
          await servidor(c);
          const tipo = i % 2 ? 'PAYMENT_CONFIRMED' : 'PAYMENT_RECEIVED';
          const { rows: [g] } = await c.query('select public.pag_event_store($1, $2, $3, $4, $5, $6, $7) as j',
            ['asaas', `evt_falso_${randomUUID()}`, tipo, ev.payment.id, ev.payment.status, Math.round(ev.payment.value * 100), ev.dateCreated]);
          if (g.j.status !== 'ok') return g.j.status;
          const foto = await prov.consultar(ev.payment.id);
          const { rows: [a] } = await c.query('select public.pag_sync_apply($1, $2, $3) as j', [g.j.charge_id, JSON.stringify(foto), g.j.event_id]);
          return a.j.resultado;
        },
      });
      const conta = {};
      for (const r of resultados) conta[r.valor ?? r.code] = (conta[r.valor ?? r.code] ?? 0) + 1;
      const e = await estado(p);
      const { rows: res } = await db.query(`select resultado, count(*)::int as n from pagamentos.events where charge_id = $1 group by 1 order by 1`, [p.chargeId]);
      afirmar(conta.aplicado === 1 && conta.repetido === N - 1, `${N} avisos diferentes do mesmo pagamento ao mesmo tempo: 1 aplicado, ${N - 1} "repetido"`, JSON.stringify(conta));
      afirmar(JSON.stringify(res) === JSON.stringify([{ resultado: 'aplicado', n: 1 }, { resultado: 'repetido', n: N - 1 }]),
        'cada aviso guardou o próprio resultado; nenhum ficou pendente', JSON.stringify(res));
      afirmar(e.pedido === 'confirmed' && e.situacao === 'aprovada' && e.extrato === esperado, 'um conjunto de linhas no extrato', JSON.stringify(e));
    }

    /* ---------- 3. Fora de ordem ---------- */
    {
      const p = await novo('09:10');
      const pago = falso.pagar(p.provedorId);
      const r1 = await receberAviso(db, prov, pago);
      // um aviso antigo ("cobrança criada", pendente) entregue DEPOIS do pagamento
      const antigo = { id: `evt_falso_${randomUUID()}`, event: 'PAYMENT_CREATED', dateCreated: new Date(Date.now() - 600000).toISOString(),
        payment: { ...pago.payment, status: 'PENDING' } };
      const r2 = await receberAviso(db, prov, antigo);
      const e = await estado(p);
      afirmar(r1.aplicado?.resultado === 'aplicado' && r2.aplicado?.resultado === 'repetido' && e.pedido === 'confirmed' && e.extrato === esperado,
        'aviso antigo entregue depois do pagamento: vale a situação consultada no provedor (nada muda)',
        JSON.stringify({ primeiro: r1.aplicado, antigo: r2.aplicado, ...e }));
      // a clínica devolve parte; o provedor devolve, mas a resposta se perde; o AVISO de devolução chega primeiro
      const pedido = await comoUsuario(db, { sub: DONA, email: EMAIL }, `select public.pag_clinic_refund($1, null, 1000, 'acordo_com_paciente', $2)`, [p.id, randomUUID()]);
      const env = await comoServidor(db, 'select public.pag_refund_sent($1)', [pedido.refund_id]);
      await prov.devolver(env.provedor_cobranca_id, { valorCents: env.valor_cents, clinicaCents: env.clinica_cents, walletId: env.wallet_id, total: env.total, chave: env.chave_idempotencia });
      const avisoDev = falso.avisos().find((a) => a.event === 'PAYMENT_PARTIALLY_REFUNDED');
      const r3 = await receberAviso(db, prov, avisoDev);
      const depoisDoAviso = await estado(p);
      const r4 = await enviarDevolucao(db, prov, pedido.refund_id);   // a rotina tenta de novo: já concluída
      const fim = await estado(p);
      afirmar(r3.aplicado?.resultado === 'aplicado' && depoisDoAviso.situacao === 'devolvida_parcial' && depoisDoAviso.devolvido === 1000
        && r4.enviada?.status === 'done' && fim.devolvido === 1000 && falso.cobrancas.get(p.provedorId).estornos.length === 1,
      'o aviso de devolução chegou antes da resposta: a devolução é concluída UMA vez (aqui e no provedor)',
      JSON.stringify({ aviso: r3.aplicado, depoisDoAviso, rotina: r4.enviada, fim, noProvedor: falso.cobrancas.get(p.provedorId).estornos.length }));
      afirmar(fim.extrato === `${esperado},devolucao:-1000,devolucao_taxa:-150,devolucao_repasse:-850`, 'o extrato tem a devolução uma vez só', fim.extrato);
      notas.push(`Fora de ordem: aviso antigo → ${r2.aplicado?.resultado}; aviso de devolução antes da resposta → 1 estorno, ${fim.devolvido} centavos`);
    }

    const v = await violacoesPagamento(db, CLINICA);
    afirmar(v.length === 0, 'nenhum invariante do pagamento quebrado (P-I1 a P-I5)', v.join('\n'));
    resumir('pagamento-aviso', {}, notas);
  } finally {
    await falso?.fechar().catch(() => {});
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste do pagamento (aviso)', descreverErro(e)));
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (pagamento-aviso)', descreverErro(e)));
    await db.end();
  }
});
