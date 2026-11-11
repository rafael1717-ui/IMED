// iMed Pagamentos, fase P1 — pagamento que chega DEPOIS de a reserva expirar, no banco de verdade (arquitetura do
// pagamento §4.4 e §11). Roda no GitHub (banco.yml):
//   node tests/banco/pagamento-atrasado.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
//   1. A reserva expirou, OUTRO paciente já reservou o mesmo horário e só então o pagamento do primeiro chega: o segundo
//      fica; o primeiro é devolvido inteiro (a rotina envia; o provedor devolve; o extrato zera). Nunca passa por cima.
//   2. A reserva expirou e ninguém pegou o horário: o pagamento atrasado confirma, pelo motor completo.
//   3. As duas coisas AO MESMO TEMPO (40 rodadas; RODADAS=n muda): o pagamento atrasado e o outro paciente reservando o
//      mesmo horário, num aparelho de 1 vaga. Só um fica com o horário; o primeiro, se perdeu, tem a devolução pedida.
// O provedor é o de mentira (tests/banco/asaas-falso.mjs). Os dados são apagados no fim.

import { randomUUID } from 'node:crypto';
import {
  afirmar, anotar, comoUsuario, configLocal, conectar, criarClinicaAgenda, descreverErro, horaSP, limparClinicaAgenda, principal, resumir,
  violacoesAgenda,
} from './lib.mjs';
import {
  clienteDoProvedor, criarPagamento, ligarRecebimento, limparPagamento, receberAviso, rotina, subirAsaasFalso, violacoesPagamento,
} from './asaas-falso.mjs';

const CLINICA = 'cc000000-0000-4000-8000-000000005a03';
const DONA = 'a5000000-0000-4000-8000-000000005a03';
const EMAIL = 'dona.pagatrasado@exemplo.test';
const ADMIN = { sub: 'a5000000-0000-4000-8000-000000005a93', email: 'admin.pagatrasado@exemplo.test' };
const DIA = 18;
const RODADAS = Math.max(4, Math.min(Number(process.env.RODADAS ?? 40), 200));

await principal('pagamento-atrasado', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-pag-atrasado');
  const [dbA, dbC] = await Promise.all(['aviso', 'outro'].map((s) => conectar(cfg.dbUrl, `imed-pag-atrasado-${s}`)));
  const notas = [];
  let falso = null;
  try {
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN });
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA });
    const { procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA, email: EMAIL, nome: 'Clínica do Pagamento Atrasado do CI',
      recursos: [{ chave: 'unico', name: 'Aparelho único' }],
      // preço de exemplo, só para a conta
      procedimentos: [{ chave: 'q', name: 'Exame no aparelho', duration_min: 5, price_cents: 9990, exam_code: 'rm', grupos: [['unico']] }],
    });
    const { tarifaPixCents } = await ligarRecebimento(db, comoUsuario, { clinica: CLINICA, dona: { sub: DONA, email: EMAIL }, admin: ADMIN, carteira: 'wal_teste_atrasado_0001' });
    falso = await subirAsaasFalso({ tarifaPixCents });
    const prov = clienteDoProvedor(falso);
    const hhmm = (i) => `${String(Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}`;
    let n = 0;
    const pagamento = (c, i, quem) => criarPagamento(c, prov, {
      clinica: CLINICA, itens: [{ procedure_id: P.q, starts_at: horaSP(DIA, hhmm(i)) }], id: randomUUID(), codigo: `codigo-atrasado-${randomUUID()}`,
      chave: randomUUID(), paciente: { name: `Paciente ${quem} ${i}`, phone: `119${String(30000 + (++n)).padStart(8, '0')}`, consent: true },
    });
    // a reserva vence (prazo + carência) e a manutenção da agenda a expira; a cobrança continua "aguardando" no provedor
    const expirar = async (id) => {
      await db.query('begin');
      await db.query(`select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_atrasado', true)`);
      await db.query(`update public.appointment_requests set hold_expires_at = now() - interval '20 minutes' where id = $1`, [id]);
      await db.query(`update agenda.occupancy o set hold_until = now() - interval '15 minutes'
                      where o.active and o.item_id in (select i.id from agenda.appointment_items i where i.request_id = $1)`, [id]);
      await db.query('commit');
      return (await db.query('select private.agenda_expire($1) as ok', [id])).rows[0].ok;
    };
    const estado = async (id) => (await db.query(`
      select a.status as pedido, c.situacao, c.devolvido_cents as devolvido,
             (select coalesce(string_agg(r.situacao || ':' || r.valor_cents || ':' || r.motivo, ','), '-') from pagamentos.refunds r where r.charge_id = c.id) as devolucoes,
             (select coalesce(sum(l.valor_cents), 0)::int from pagamentos.ledger l where l.charge_id = c.id and l.tipo <> 'tarifa_meio') as saldo
      from public.appointment_requests a left join pagamentos.charges c on c.request_id = a.id where a.id = $1`, [id])).rows[0];

    /* ---------- 1. O horário já foi pego: o segundo fica, o primeiro é devolvido ---------- */
    {
      const p1 = await pagamento(db, 0, 'Primeiro');
      const ev = falso.pagar(p1.provedorId);                 // pagou no último segundo; o aviso demora
      const expirou = await expirar(p1.reserva.id);
      const p2 = await pagamento(db, 0, 'Segundo');          // outro paciente reserva o mesmo horário
      const r = await receberAviso(db, prov, ev);            // só agora o aviso do primeiro chega
      const e1 = await estado(p1.reserva.id);
      const e2 = await estado(p2.reserva.id);
      afirmar(expirou && p2.status === 'ok' && r.aplicado?.acao === 'devolver' && e1.pedido === 'expired' && e1.situacao === 'aprovada'
        && e1.devolucoes === 'pedida:9990:pagamento_atrasado' && e2.pedido === 'awaiting_payment',
      'pagamento atrasado com o horário já pego: o segundo paciente fica e a devolução total do primeiro é pedida na hora',
      JSON.stringify({ expirou, segundo: p2.status, aviso: r.aplicado, primeiro: e1, segundoPedido: e2.pedido }));
      const feito = await rotina(db, prov, { so: ['enviar_devolucao'] });
      const fim = await estado(p1.reserva.id);
      const noProvedor = falso.cobrancas.get(p1.provedorId);
      afirmar(feito.enviar_devolucao === 1 && fim.situacao === 'devolvida' && fim.devolvido === 9990 && fim.saldo === 0
        && noProvedor.status === 'REFUNDED' && noProvedor.estornos.length === 1,
      'a rotina envia a devolução: o provedor devolve tudo, a cobrança fica "devolvida" e o extrato zera (a taxa do IMED volta junto)',
      JSON.stringify({ feito, fim, noProvedor: { status: noProvedor.status, estornos: noProvedor.estornos.length } }));
      // o segundo paga normalmente
      const r2 = await receberAviso(db, prov, falso.pagar(p2.provedorId));
      afirmar(r2.aplicado?.request_status === 'confirmed', 'e o segundo paciente paga e confirma normalmente', JSON.stringify(r2.aplicado));
      notas.push(`Horário já pego: primeiro ${e1.pedido} com devolução ${fim.situacao}; segundo ${r2.aplicado?.request_status}`);
    }

    /* ---------- 2. Ninguém pegou o horário: confirma pelo motor ---------- */
    {
      const p = await pagamento(db, 1, 'Sozinho');
      const ev = falso.pagar(p.provedorId);
      await expirar(p.reserva.id);
      const r = await receberAviso(db, prov, ev);
      const e = await estado(p.reserva.id);
      afirmar(r.aplicado?.request_status === 'confirmed' && r.aplicado?.acao === 'nenhuma' && e.devolucoes === '-',
        'pagamento atrasado com o horário ainda livre: confirma (expirado → confirmado, pelo motor completo)', JSON.stringify({ aviso: r.aplicado, ...e }));
      notas.push(`Horário ainda livre: ${r.aplicado?.request_status}`);
    }

    /* ---------- 3. Ao mesmo tempo ---------- */
    {
      const conta = { primeiro_confirmou: 0, segundo_ficou: 0 };
      const ruins = [];
      const erros = [];
      const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
      for (let i = 2; i < RODADAS + 2; i++) {
        const p1 = await pagamento(db, i, 'Primeiro');
        const ev = falso.pagar(p1.provedorId);
        await expirar(p1.reserva.id);
        const [a, c] = await Promise.all([
          (async () => { await pausa(Math.random() * 8); return receberAviso(dbA, prov, ev); })().catch((e) => ({ erro: e.code ?? e.message })),
          (async () => { await pausa(Math.random() * 8); return pagamento(dbC, i, 'Segundo'); })().catch((e) => ({ erro: e.code ?? e.message })),
        ]);
        for (const [quem, r] of [['aviso', a], ['outro', c]]) if (r?.erro) erros.push(`rodada ${i}, ${quem}: ${r.erro}`);
        const e1 = await estado(p1.reserva.id);
        const segundoFicou = c?.status === 'ok';
        const primeiroConfirmou = e1.pedido === 'confirmed' && e1.situacao === 'aprovada' && e1.devolucoes === '-';
        const primeiroDevolvido = e1.pedido === 'expired' && e1.situacao === 'aprovada' && e1.devolucoes === 'pedida:9990:pagamento_atrasado';
        if (primeiroConfirmou === segundoFicou || !(primeiroConfirmou || primeiroDevolvido)) {
          ruins.push(`rodada ${i}: ${JSON.stringify({ primeiro: e1, segundo: c?.status ?? c, aviso: a?.aplicado ?? a })}`);
        }
        conta[primeiroConfirmou ? 'primeiro_confirmou' : 'segundo_ficou']++;
      }
      afirmar(erros.length === 0, `${RODADAS} rodadas sem erro (nenhum impasse)`, erros.slice(0, 10).join('\n'));
      afirmar(ruins.length === 0, 'em toda rodada só UM ficou com o horário; quando foi o segundo, a devolução total do primeiro ficou pedida', ruins.slice(0, 10).join('\n'));
      notas.push(`Ao mesmo tempo (${RODADAS} rodadas): ${conta.primeiro_confirmou} vezes o pagamento atrasado confirmou, ${conta.segundo_ficou} vezes o segundo paciente ficou e o primeiro foi devolvido`);
    }

    const vp = await violacoesPagamento(db, CLINICA);
    const va = await violacoesAgenda(db, CLINICA);
    afirmar(vp.length === 0, 'nenhum invariante do pagamento quebrado (P-I1 a P-I5)', vp.join('\n'));
    afirmar(va.length === 0, 'nenhum aparelho com mais pacientes do que a capacidade', va.join('\n'));
    resumir('pagamento-atrasado', {}, notas);
  } finally {
    await falso?.fechar().catch(() => {});
    await Promise.all([dbA, dbC].map((c) => c.end().catch(() => {})));
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste do pagamento (atrasado)', descreverErro(e)));
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (pagamento-atrasado)', descreverErro(e)));
    await db.end();
  }
});
