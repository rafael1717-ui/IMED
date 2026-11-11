// iMed Pagamentos, fase P1 — corrida entre o pagamento aprovado e a reserva expirando, no banco de verdade (arquitetura
// do pagamento §4.6 e §11). Roda no GitHub (banco.yml):
//   node tests/banco/pagamento-corrida.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
// 200 rodadas (RODADAS=n muda). Em cada uma, uma reserva paga online chega ao fim do prazo + carência e, NO MESMO
// INSTANTE, em conexões diferentes:
//   A. chega o aviso do pagamento (grava o aviso, consulta o provedor, aplica: trava configuração → pedido → cobrança);
//   B. a manutenção da agenda expira a reserva (private.agenda_expire, com SKIP LOCKED);
//   C. (nas rodadas ímpares, num aparelho de 1 vaga) OUTRO paciente tenta reservar o mesmo horário para pagar.
// O resultado tem de ser sempre um destes dois: "confirmado e pago" ou "expirado e devolução total pedida". Nunca
// confirmado sem dinheiro, nunca dinheiro sem horário e sem devolução, nunca dois pacientes no mesmo horário, nenhum
// erro de impasse. O provedor é o de mentira (tests/banco/asaas-falso.mjs). Os dados são apagados no fim.

import { randomUUID } from 'node:crypto';
import {
  afirmar, anotar, comoUsuario, configLocal, conectar, criarClinicaAgenda, descreverErro, horaSP, limparClinicaAgenda, principal, resumir,
  violacoesAgenda,
} from './lib.mjs';
import {
  clienteDoProvedor, criarPagamento, ligarRecebimento, limparPagamento, receberAviso, subirAsaasFalso, violacoesPagamento,
} from './asaas-falso.mjs';

const CLINICA = 'cc000000-0000-4000-8000-000000005a02';
const DONA = 'a5000000-0000-4000-8000-000000005a02';
const EMAIL = 'dona.pagcorrida@exemplo.test';
const ADMIN = { sub: 'a5000000-0000-4000-8000-000000005a92', email: 'admin.pagcorrida@exemplo.test' };
const DIA = 19;
const RODADAS = Math.max(4, Math.min(Number(process.env.RODADAS ?? 200), 280));

await principal('pagamento-corrida', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-pag-corrida');
  const [dbA, dbB, dbC] = await Promise.all(['aviso', 'expira', 'outro'].map((s) => conectar(cfg.dbUrl, `imed-pag-corrida-${s}`)));
  const notas = [];
  let falso = null;
  try {
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN });
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA });
    const { procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA, email: EMAIL, nome: 'Clínica da Corrida do Pagamento do CI',
      recursos: [{ chave: 'sala', name: 'Sala grande', kind: 'sala', capacity: 50 }, { chave: 'unico', name: 'Aparelho único' }],
      // preços de exemplo, só para a conta
      procedimentos: [{ chave: 'p', name: 'Exame na sala', duration_min: 5, price_cents: 12345, grupos: [['sala']] },
        { chave: 'q', name: 'Exame no aparelho', duration_min: 5, price_cents: 9990, exam_code: 'rm', grupos: [['unico']] }],
    });
    const { tarifaPixCents } = await ligarRecebimento(db, comoUsuario, { clinica: CLINICA, dona: { sub: DONA, email: EMAIL }, admin: ADMIN, carteira: 'wal_teste_corrida_0001' });
    falso = await subirAsaasFalso({ tarifaPixCents });
    const prov = clienteDoProvedor(falso);
    const hhmm = (i) => `${String(Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}`;
    const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
    const conta = { confirmado_direto: 0, confirmado_pelo_motor: 0, expirado_devolucao: 0, outro_ficou: 0, outro_recusado: 0 };
    const ruins = [];
    const erros = [];
    const t0 = Date.now();

    for (let i = 0; i < RODADAS; i++) {
      const comOutro = i % 2 === 1;
      const proc = comOutro ? P.q : P.p;
      const itens = [{ procedure_id: proc, starts_at: horaSP(DIA, hhmm(i)) }];
      const id = randomUUID();
      const pag = await criarPagamento(db, prov, {
        clinica: CLINICA, itens, id, codigo: `codigo-corrida-${randomUUID()}`, chave: randomUUID(),
        paciente: { name: `Paciente Corrida ${i}`, phone: `119${String(10000 + i).padStart(8, '0')}`, consent: true },
      });
      if (pag.status !== 'ok') throw new Error(`rodada ${i}: ${JSON.stringify(pag)}`);
      const ev = falso.pagar(pag.provedorId);
      // o prazo + a carência (5 min) acabam de vencer
      await db.query('begin');
      await db.query(`select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_corrida', true)`);
      await db.query(`update public.appointment_requests set hold_expires_at = now() - interval '5 minutes 1 second' where id = $1`, [id]);
      await db.query(`update agenda.occupancy o set hold_until = now() - interval '1 second'
                      where o.active and o.item_id in (select i.id from agenda.appointment_items i where i.request_id = $1)`, [id]);
      await db.query('commit');

      const idOutro = randomUUID();
      const [a, b, c] = await Promise.all([
        (async () => { await pausa(Math.random() * 6); return receberAviso(dbA, prov, ev); })().catch((e) => ({ erro: e.code ?? e.message })),
        (async () => { await pausa(Math.random() * 14); return (await dbB.query('select private.agenda_expire($1) as ok', [id])).rows[0].ok; })()
          .catch((e) => ({ erro: e.code ?? e.message })),
        comOutro
          ? (async () => {
            await pausa(Math.random() * 6);
            return criarPagamento(dbC, prov, {
              clinica: CLINICA, itens, id: idOutro, codigo: `codigo-corrida-${randomUUID()}`, chave: randomUUID(),
              paciente: { name: `Outro Paciente ${i}`, phone: `119${String(20000 + i).padStart(8, '0')}`, consent: true },
            });
          })().catch((e) => ({ erro: e.code ?? e.message }))
          : null,
      ]);
      for (const [quem, r] of [['aviso', a], ['expirar', b], ['outro', c]]) if (r?.erro) erros.push(`rodada ${i}, ${quem}: ${r.erro}`);

      const { rows: [f] } = await db.query(`
        select a.status as pedido, c.situacao,
               (select count(*)::int from pagamentos.refunds r where r.charge_id = c.id and r.situacao = 'pedida' and r.valor_cents = c.valor_cents) as devolucao_total,
               (select count(*)::int from pagamentos.refunds r where r.charge_id = c.id) as devolucoes,
               (select count(*)::int from agenda.status_history h where h.request_id = a.id and h.from_status = 'expired' and h.to_status = 'confirmed') as pelo_motor,
               (select o.status from public.appointment_requests o where o.id = $2) as outro
        from public.appointment_requests a join pagamentos.charges c on c.request_id = a.id where a.id = $1`, [id, idOutro]);
      const confirmado = f.pedido === 'confirmed' && f.situacao === 'aprovada' && f.devolucoes === 0;
      const devolvido = f.pedido === 'expired' && f.situacao === 'aprovada' && f.devolucao_total === 1 && f.devolucoes === 1;
      const outroFicou = ['hold', 'awaiting_payment'].includes(f.outro);
      if (!(confirmado || devolvido) || (confirmado && outroFicou) || (devolvido && !outroFicou)) {
        ruins.push(`rodada ${i}: ${JSON.stringify({ ...f, aviso: a?.aplicado ?? a, expirou: b, outro: c?.status ?? c })}`);
      }
      if (confirmado) conta[f.pelo_motor ? 'confirmado_pelo_motor' : 'confirmado_direto']++;
      if (devolvido) conta.expirado_devolucao++;
      if (comOutro) conta[outroFicou ? 'outro_ficou' : 'outro_recusado']++;
    }

    const ms = Date.now() - t0;
    afirmar(erros.length === 0, `${RODADAS} rodadas sem erro (nenhum impasse, nenhum estouro de tempo)`, erros.slice(0, 10).join('\n'));
    afirmar(ruins.length === 0, 'toda rodada terminou em "confirmado e pago" ou "expirado e devolução total pedida" (e o outro paciente só fica se o primeiro saiu)',
      ruins.slice(0, 10).join('\n'));
    afirmar(conta.confirmado_direto + conta.confirmado_pelo_motor + conta.expirado_devolucao === RODADAS, 'todas as rodadas contadas', JSON.stringify(conta));
    const vp = await violacoesPagamento(db, CLINICA);
    const va = await violacoesAgenda(db, CLINICA);
    afirmar(vp.length === 0, 'nenhum invariante do pagamento quebrado (P-I1 a P-I5)', vp.join('\n'));
    afirmar(va.length === 0, 'nenhum aparelho com mais pacientes do que a capacidade', va.join('\n'));
    if (conta.confirmado_pelo_motor === 0 || conta.confirmado_direto === 0) {
      anotar('notice', 'pagamento-corrida: uma das ordens não apareceu nesta execução',
        `${JSON.stringify(conta)} (a ordem entre o aviso e a expiração é sorteada; as duas aparecem na maioria das execuções)`);
    }
    notas.push(`${RODADAS} rodadas em ${ms} ms: ${conta.confirmado_direto} confirmadas direto (o aviso travou primeiro), ${conta.confirmado_pelo_motor} confirmadas pelo motor (expirou e o horário seguia livre), ${conta.expirado_devolucao} expiradas com devolução total pedida`);
    notas.push(`Com outro paciente no mesmo horário (${Math.floor(RODADAS / 2)} rodadas): ${conta.outro_ficou} vezes ele ficou (o primeiro foi devolvido), ${conta.outro_recusado} vezes foi recusado (o primeiro confirmou)`);
    resumir('pagamento-corrida', { conta }, notas);
  } finally {
    await falso?.fechar().catch(() => {});
    await Promise.all([dbA, dbB, dbC].map((c) => c.end().catch(() => {})));
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste do pagamento (corrida)', descreverErro(e)));
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (pagamento-corrida)', descreverErro(e)));
    await db.end();
  }
});
