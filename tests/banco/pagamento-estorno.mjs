// iMed Pagamentos, fase P1 — a mesma devolução pedida e enviada várias vezes ao mesmo tempo, no banco de verdade
// (arquitetura do pagamento §4.5, §6.2 e §11). Roda no GitHub (banco.yml):
//   node tests/banco/pagamento-estorno.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
//   1. As contas no JavaScript e no SQL dão o mesmo resultado (500 casos sorteados): a taxa por exame (piso) e a taxa
//      devolvida acumulada. Na P2 os mesmos vetores viram um arquivo comum para as Edge Functions.
//   2. A MESMA devolução (mesma chave) pedida 20 vezes ao mesmo tempo → uma devolução.
//   3. 20 devoluções parciais DIFERENTES ao mesmo tempo → só entram as que cabem no que resta; nunca passa do pago.
//   4. A mesma devolução ENVIADA 20 vezes ao mesmo tempo (a rotina rodando em dobro) → o provedor devolve uma vez, a
//      cobrança soma uma vez e o extrato tem um conjunto de linhas.
//   5. Depois de todas as devoluções concluídas, a conta fecha no centavo, aqui e no provedor.
// O provedor é o de mentira (tests/banco/asaas-falso.mjs). Os dados são apagados no fim.

import { randomInt, randomUUID } from 'node:crypto';
import {
  afirmar, anotar, comoUsuario, configLocal, conectar, criarClinicaAgenda, descreverErro, horaSP, limparClinicaAgenda, principal, resumir,
} from './lib.mjs';
import {
  clienteDoProvedor, criarPagamento, enviarDevolucao, ligarRecebimento, limparPagamento, receberAviso, rotina, subirAsaasFalso,
  violacoesPagamento,
} from './asaas-falso.mjs';

const CLINICA = 'cc000000-0000-4000-8000-000000005a04';
const DONA = 'a5000000-0000-4000-8000-000000005a04';
const EMAIL = 'dona.pagestorno@exemplo.test';
const ADMIN = { sub: 'a5000000-0000-4000-8000-000000005a94', email: 'admin.pagestorno@exemplo.test' };
const DIA = 17;
const N = 20;

// As mesmas contas do SQL (private.pag_fee e private.pag_refund_fee), com inteiros.
const taxa = (preco, bps) => Number((BigInt(preco) * BigInt(bps)) / 10000n);
const acumulada = (preco, t, devolvido) => (devolvido >= preco ? t : Number((BigInt(devolvido) * BigInt(t)) / BigInt(preco)));
const taxaDevolvida = (preco, t, antes, valor) => acumulada(preco, t, antes + valor) - acumulada(preco, t, antes);

await principal('pagamento-estorno', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-pag-estorno');
  const notas = [];
  let falso = null;
  try {
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN });
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA });
    const { procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA, email: EMAIL, nome: 'Clínica do Estorno do CI',
      recursos: [{ chave: 'sala', name: 'Sala grande', kind: 'sala', capacity: 50 }],
      // preço de exemplo, só para a conta
      procedimentos: [{ chave: 'p', name: 'Exame de 5 minutos', duration_min: 5, price_cents: 20000, grupos: [['sala']] }],
    });
    const dona = { sub: DONA, email: EMAIL };
    const { tarifaPixCents } = await ligarRecebimento(db, comoUsuario, { clinica: CLINICA, dona, admin: ADMIN, carteira: 'wal_teste_estorno_0001' });
    falso = await subirAsaasFalso({ tarifaPixCents });
    const prov = clienteDoProvedor(falso);
    let n = 0;
    const pago = async (hhmm) => {
      n++;
      const id = randomUUID();
      const codigo = `codigo-estorno-${randomUUID()}`;
      const r = await criarPagamento(db, prov, {
        clinica: CLINICA, itens: [{ procedure_id: P.p, starts_at: horaSP(DIA, hhmm) }], id, codigo, chave: randomUUID(),
        paciente: { name: `Paciente Estorno ${n}`, phone: `119${String(40000 + n).padStart(8, '0')}`, consent: true },
      });
      if (r.status !== 'ok') throw new Error(`pagamento ${n}: ${JSON.stringify(r)}`);
      const a = await receberAviso(db, prov, falso.pagar(r.provedorId));
      if (a.aplicado?.request_status !== 'confirmed') throw new Error(`pagamento ${n} não confirmou: ${JSON.stringify(a)}`);
      return { id, codigo, ...r };
    };
    const conta = async (p) => (await db.query(`
      select c.situacao, c.valor_cents as valor, c.taxa_cents as taxa, c.devolvido_cents as devolvido, c.taxa_devolvida_cents as taxa_devolvida,
             c.clinica_devolvida_cents as clinica_devolvida,
             (select count(*)::int from pagamentos.refunds f where f.charge_id = c.id and f.situacao <> 'desfeita') as devolucoes,
             (select count(*)::int from pagamentos.ledger l where l.charge_id = c.id and l.tipo = 'devolucao') as linhas_devolucao,
             (select coalesce(sum(l.valor_cents), 0)::int from pagamentos.ledger l where l.charge_id = c.id and l.tipo in ('recebido', 'devolucao')) as saldo_paciente
      from pagamentos.charges c where c.id = $1`, [p.chargeId])).rows[0];
    const emParalelo = (trabalhos) => Promise.all(trabalhos.map(async (t) => {
      const c = await conectar(cfg.dbUrl, 'imed-pag-estorno-n');
      try { return await t(c); } catch (e) { return { erro: e.code ?? e.message }; } finally { await c.end().catch(() => {}); }
    }));
    const contar = (lista) => lista.reduce((m, r) => { const k = r?.erro ? `erro ${r.erro}` : r.replay ? `${r.status} (replay)` : r.status; m[k] = (m[k] ?? 0) + 1; return m; }, {});

    /* ---------- 1. As contas: JavaScript = SQL ---------- */
    {
      const casos = Array.from({ length: 500 }, () => {
        const preco = randomInt(1, 2000000);
        const bps = randomInt(0, 10001);
        const antes = randomInt(0, preco);
        const valor = randomInt(1, preco - antes + 1);
        return [preco, bps, antes, valor];
      });
      casos.push([9990, 1500, 0, 9990], [9990, 1500, 4995, 4995], [1, 1500, 0, 1], [20000, 1500, 19999, 1], [3333, 1500, 0, 3333]);
      const { rows } = await db.query(`
        select x.preco, x.bps, x.antes, x.valor, private.pag_fee('percentual', x.bps, null, x.preco) as taxa,
               private.pag_refund_fee(x.preco, private.pag_fee('percentual', x.bps, null, x.preco), x.antes, x.valor) as devolvida
        from unnest($1::int[], $2::int[], $3::int[], $4::int[]) x (preco, bps, antes, valor)`,
      [casos.map((c) => c[0]), casos.map((c) => c[1]), casos.map((c) => c[2]), casos.map((c) => c[3])]);
      const diferentes = rows.filter((r) => r.taxa !== taxa(r.preco, r.bps) || r.devolvida !== taxaDevolvida(r.preco, r.taxa, r.antes, r.valor));
      afirmar(rows.length === casos.length && diferentes.length === 0, `${casos.length} contas sorteadas: a taxa e a taxa devolvida dão o mesmo no JavaScript e no SQL`,
        JSON.stringify(diferentes.slice(0, 5)));
    }

    /* ---------- 2. A mesma devolução pedida 20 vezes ---------- */
    const a = await pago('09:00');
    {
      const chave = randomUUID();
      const r = await emParalelo(Array.from({ length: N }, () => (c) =>
        comoUsuario(c, dona, `select public.pag_clinic_refund($1, null, 1000, 'acordo_com_paciente', $2)`, [a.id, chave])));
      const c0 = contar(r);
      const e = await conta(a);
      afirmar(c0.ok === 1 && c0['ok (replay)'] === N - 1 && e.devolucoes === 1, `a mesma devolução pedida ${N} vezes ao mesmo tempo (mesma chave): uma só`,
        JSON.stringify({ respostas: c0, ...e }));
      notas.push(`Mesma devolução pedida ${N}× em paralelo: ${e.devolucoes} devolução`);
    }

    /* ---------- 3. 20 devoluções parciais diferentes ---------- */
    {
      // restam R$ 190,00 (200,00 − 10,00 já pedidos): cabem 12 de R$ 15,00; as outras 8 não cabem
      const r = await emParalelo(Array.from({ length: N }, () => (c) =>
        comoUsuario(c, dona, `select public.pag_clinic_refund($1, null, 1500, 'acordo_com_paciente', $2)`, [a.id, randomUUID()])));
      const c0 = contar(r);
      const { rows: [s] } = await db.query(`select coalesce(sum(f.valor_cents), 0)::int as pedido, count(*)::int as n from pagamentos.refunds f where f.charge_id = $1`, [a.chargeId]);
      afirmar(c0.ok === 12 && c0.over_limit === 8 && s.pedido === 19000 && s.n === 13,
        `${N} devoluções parciais ao mesmo tempo: entram as 12 que cabem (R$ 180,00) e as outras 8 recebem over_limit; nunca passa do pago`,
        JSON.stringify({ respostas: c0, ...s }));
    }

    /* ---------- 4. A mesma devolução enviada 20 vezes ---------- */
    const b = await pago('09:05');
    {
      // o paciente cancela → devolução total pela regra
      await db.query('begin');
      await db.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('role', 'anon', true)`);
      const { rows: [canc] } = await db.query('select public.agenda_cancel($1, null, $2) as j', [b.id, b.codigo]);
      await db.query('commit');
      const { rows: [f] } = await db.query(`select id, valor_cents, automatica, motivo from pagamentos.refunds where charge_id = $1`, [b.chargeId]);
      afirmar(canc.j.status === 'ok' && f?.valor_cents === 20000 && f.automatica && f.motivo === 'cancelado_paciente',
        'o paciente cancela o agendamento pago: devolução total pedida pela regra, na mesma transação', JSON.stringify({ cancelar: canc.j, devolucao: f }));
      const r = await emParalelo(Array.from({ length: N }, () => (c) => enviarDevolucao(c, prov, f.id).then((x) => x.concluida ?? x.enviada ?? x.falhou)));
      const c0 = contar(r);
      const e = await conta(b);
      const noProvedor = falso.cobrancas.get(b.provedorId);
      afirmar(!Object.keys(c0).some((k) => k.startsWith('erro')) && e.situacao === 'devolvida' && e.devolvido === 20000 && e.taxa_devolvida === 3000
        && e.clinica_devolvida === 17000 && e.linhas_devolucao === 1 && e.saldo_paciente === 0 && noProvedor.estornos.length === 1 && noProvedor.status === 'REFUNDED',
      `a mesma devolução enviada ${N} vezes ao mesmo tempo: o provedor devolve UMA vez e a cobrança soma uma vez`,
      JSON.stringify({ respostas: c0, ...e, estornosNoProvedor: noProvedor.estornos.length }));
      notas.push(`Mesma devolução enviada ${N}× em paralelo: ${noProvedor.estornos.length} estorno no provedor, ${e.linhas_devolucao} linha no extrato`);
    }

    /* ---------- 5. Tudo concluído: a conta fecha ---------- */
    {
      let passadas = 0;
      for (; passadas < 30; passadas++) {
        const feito = await rotina(db, prov, { so: ['enviar_devolucao'] });
        if (!feito.enviar_devolucao) break;
      }
      const e = await conta(a);
      const noProvedor = falso.cobrancas.get(a.provedorId);
      afirmar(e.situacao === 'devolvida_parcial' && e.devolvido === 19000 && e.taxa_devolvida === taxaDevolvida(20000, 3000, 0, 19000)
        && e.clinica_devolvida === 19000 - e.taxa_devolvida && e.linhas_devolucao === 13 && noProvedor.devolvidoCents === 19000 && noProvedor.estornos.length === 13,
      'as 13 devoluções saem uma por vez (a rotina, 13 passadas) e a conta fecha no centavo: aqui e no provedor, R$ 190,00',
      JSON.stringify({ passadas, ...e, noProvedor: { devolvido: noProvedor.devolvidoCents, estornos: noProvedor.estornos.length } }));
      const { rows: [soma] } = await db.query(`select sum(f.taxa_cents)::int as taxa, sum(f.clinica_cents)::int as clinica from pagamentos.refunds f
                                              where f.charge_id = $1 and f.situacao = 'concluida'`, [a.chargeId]);
      afirmar(soma.taxa === e.taxa_devolvida && soma.clinica === e.clinica_devolvida, 'a soma das 13 divisões (taxa × clínica) é igual ao acumulado da cobrança',
        JSON.stringify(soma));
    }

    const v = await violacoesPagamento(db, CLINICA);
    afirmar(v.length === 0, 'nenhum invariante do pagamento quebrado (P-I1 a P-I5)', v.join('\n'));
    resumir('pagamento-estorno', {}, notas);
  } finally {
    await falso?.fechar().catch(() => {});
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste do pagamento (estorno)', descreverErro(e)));
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (pagamento-estorno)', descreverErro(e)));
    await db.end();
  }
});
