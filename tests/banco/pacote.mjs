// iMed Agenda, fase 5.2 — teste obrigatório 6 ("Vários exames") PELA REST, no banco de verdade (Supabase local), como
// o site do paciente faz: visitante, só com a chave publishable, chamando rpc/agenda_package_options e rpc/agenda_book
// pelo PostgREST. Roda no GitHub (banco.yml):
//   node tests/banco/pacote.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
//   1. Opções de pacote de 3 exames (3 aparelhos) e a marcação da 1ª: UM agendamento, 3 itens, 3 ocupações.
//   2. Reenvio do mesmo pedido (mesmo id e código, como o "Tentar de novo" do site): replay, sem duplicar.
//   3. Conflito no 3º exame (outra pessoa pega o horário entre as opções e a confirmação): slot_taken no item 3 e
//      NADA gravado (nem o 1º nem o 2º); as opções novas não trazem o horário pego; com id novo, marca.
//   4. Dois pacotes disputando o aparelho do meio, 20 POST ao mesmo tempo: um pacote inteiro, os outros nada.
//   5. Ocupação virtual (migração agenda_pacote): 2 e 4 exames no MESMO aparelho com higienização — toda opção
//      devolvida é aceita pela marcação, e as opções de 4 exames respondem dentro do tempo-limite da função (3 s).
// A parte sem COMMIT (regras de par, chegadas por hora, agenda_my_booking) está em supabase/tests/430_pacote.sql.
// Sem o PostgREST (banco local só com o Postgres), as mesmas chamadas vão por conexão direta, como visitante e com o
// tempo-limite do visitante; no GitHub o PostgREST é obrigatório. Os dados são criados aqui e apagados no fim.

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  NO_GITHUB, afirmar, anotar, configLocal, conectar, criarClinicaAgenda, descreverErro, horaSP, limparClinicaAgenda, postgrest, principal, resumir,
  violacoesAgenda,
} from './lib.mjs';

const CLINICA = 'cc000000-0000-4000-8000-0000000005c2';
const DONA = 'a5000000-0000-4000-8000-0000000005c2';
const EMAIL = 'dona.pacote@exemplo.test';
const DIA = 22;  // daqui a 22 dias
const DIA_LOCAL = new Date(Date.now() + DIA * 86400000 - 3 * 3600000).toISOString().slice(0, 10);

const paciente = (n) => ({ name: `Paciente Pacote ${n}`, phone: `118${String(n).padStart(8, '0')}`, consent: true });
const iso = (t) => new Date(t).toISOString();

await principal('pacote', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-pacote');
  const notas = [];
  const dados = {};
  const viaRest = !!(cfg.apiUrl && cfg.publishableKey);
  if (!viaRest) {
    if (NO_GITHUB) afirmar(false, 'pacote: sem o PostgREST local (API_URL e PUBLISHABLE_KEY)', 'o teste 6 pela REST precisa do "supabase start" completo');
    else anotar('warning', 'Sem o PostgREST local: as chamadas foram por conexão direta (como visitante, 3 s de limite)');
  }
  try {
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA });
    const { recursos, procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA, email: EMAIL, nome: 'Clínica do Pacote do CI',
      recursos: [
        { chave: 'a', name: 'Aparelho A' }, { chave: 'm', name: 'Aparelho do meio' }, { chave: 'b', name: 'Aparelho B' },
        { chave: 'u', name: 'Ultrassom único', cleanup_min: 10 },
      ],
      procedimentos: [
        { chave: 'pa', name: 'Exame A', duration_min: 30, grupos: [['a']] },
        { chave: 'pm', name: 'Exame do meio', duration_min: 30, grupos: [['m']] },
        { chave: 'pb', name: 'Exame B', duration_min: 30, grupos: [['b']] },
        { chave: 'px', name: 'Ultrassom X', duration_min: 20, grupos: [['u']] },
        { chave: 'py', name: 'Ultrassom Y', duration_min: 20, grupos: [['u']] },
        { chave: 'pz', name: 'Ultrassom Z', duration_min: 20, grupos: [['u']] },
        { chave: 'pw', name: 'Ultrassom W', duration_min: 20, grupos: [['u']] },
      ],
    });
    const nome = Object.fromEntries(Object.entries(P).map(([k, v]) => [v, k]));

    // Uma chamada de função como o site faz. Queda da conexão ou o erro genérico do gateway local: reenvia o MESMO
    // corpo (o site faz igual; a marcação é idempotente pelo id e código).
    const chamar = async (fn, corpo) => {
      if (viaRest) {
        for (let t = 0; ; t++) {
          try {
            const r = await postgrest(cfg, `rpc/${fn}`, { prefer: null, corpo });
            if (r.status === 500 && !r.code && r.message === 'An unexpected error occurred' && t < 5) { await new Promise((ok) => setTimeout(ok, 200 * (t + 1))); continue; }
            return r;
          } catch (e) {
            if (t >= 5) throw e;
            await new Promise((ok) => setTimeout(ok, 200 * (t + 1)));
          }
        }
      }
      const c = await conectar(cfg.dbUrl, 'imed-pacote-visitante');
      const t0 = performance.now();
      try {
        await c.query('begin');
        await c.query('set local role anon');
        await c.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('statement_timeout', '3s', true)`);
        const args = Object.keys(corpo);
        const { rows: [r] } = await c.query(`select public.${fn}(${args.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as j`,
          args.map((k) => (corpo[k] !== null && typeof corpo[k] === 'object' && !Array.isArray(corpo[k]) ? JSON.stringify(corpo[k])
            : k === 'p_items' ? JSON.stringify(corpo[k]) : corpo[k])));
        await c.query('commit');
        return { status: 200, ok: true, json: r.j, ms: performance.now() - t0 };
      } catch (e) {
        await c.query('rollback').catch(() => {});
        return { status: 500, ok: false, code: e.code, message: e.message, json: null, ms: performance.now() - t0 };
      } finally { await c.end().catch(() => {}); }
    };
    const opcoes = (chaves, limite = 5) => chamar('agenda_package_options', { p_clinic: CLINICA, p_procedures: chaves.map((k) => P[k]), p_day: DIA_LOCAL, p_limit: limite });
    const marcar = (itens, n, id = randomUUID(), codigo = `codigo-pacote-${n}-${randomUUID()}`) => chamar('agenda_book', {
      p_clinic: CLINICA, p_items: itens.map((i) => ({ procedure_id: i.procedure_id, starts_at: i.starts_at })), p_patient: paciente(n), p_id: id, p_token: codigo,
    }).then((r) => ({ ...r, id, codigo }));
    const item = (p, hhmm) => ({ procedure_id: P[p], starts_at: horaSP(DIA, hhmm) });
    const noBanco = async (id) => (await db.query(`
      select (select count(*)::int from public.appointment_requests a where a.id = $1) as pedidos,
             (select count(*)::int from agenda.appointment_items i where i.request_id = $1) as itens,
             (select count(*)::int from agenda.occupancy o join agenda.appointment_items i on i.id = o.item_id where i.request_id = $1 and o.active) as usos,
             (select count(distinct o.resource_id)::int from agenda.occupancy o join agenda.appointment_items i on i.id = o.item_id where i.request_id = $1 and o.active) as recursos`,
    [id])).rows[0];
    const usosEm = async (de, ate, quais) => (await db.query(
      `select count(*)::int as n from agenda.occupancy o where o.clinic_id = $1 and o.active and o.resource_id = any ($2::uuid[]) and o.during && tstzrange($3::timestamptz, $4::timestamptz)`,
      [CLINICA, quais, de, ate])).rows[0].n;
    const resumo = (o) => o.items.map((i) => `${nome[i.procedure_id]} ${iso(i.starts_at).slice(11, 16)}Z`).join(' + ');

    /* ---------- 1. Opções de 3 exames e a marcação da primeira ---------- */
    let primeira;
    {
      const r = await opcoes(['pa', 'pm', 'pb']);
      const ops = r.json?.options ?? [];
      afirmar(r.status === 200 && r.json?.status === 'ok' && ops.length === 5, '1: opções de pacote pela REST: 200, ok e 5 opções', JSON.stringify({ status: r.status, code: r.code, message: r.message, n: ops.length }));
      afirmar(ops.every((o) => o.items.length === 3 && new Set(o.items.map((i) => i.procedure_id)).size === 3 && o.wait_min === 0)
        && ops.every((o, k) => !k || (o.ends_at >= ops[k - 1].ends_at)),
      '1: cada opção tem os 3 exames, sem espera (3 aparelhos livres), da que termina mais cedo para a mais tarde', ops.map(resumo).join('\n'));
      afirmar(r.json?.same_day_blocked === false, '1: a resposta traz same_day_blocked (falso: a clínica não tem essa regra)', JSON.stringify(r.json?.same_day_blocked));
      primeira = ops[0];
      const m = await marcar(primeira.items, 1);
      const x = await noBanco(m.id);
      afirmar(m.status === 200 && m.json?.status === 'ok' && m.json.items?.length === 3 && x.pedidos === 1 && x.itens === 3 && x.usos === 3 && x.recursos === 3,
        '1: confirmar o pacote: UM agendamento, 3 itens e 3 ocupações (um aparelho por exame)', JSON.stringify({ resposta: m.json?.status ?? m.code, ...x }));
      afirmar(iso(m.json?.slot_start) === iso(primeira.starts_at) && iso(m.json?.slot_end) === iso(primeira.ends_at),
        '1: o agendamento vai do começo do 1º exame ao fim do último', JSON.stringify({ slot_start: m.json?.slot_start, slot_end: m.json?.slot_end }));
      notas.push(`1. opções de 3 exames em ${Math.round(r.ms)} ms; a 1ª (${resumo(primeira)}) marcada em ${Math.round(m.ms)} ms: 1 agendamento, 3 itens, 3 ocupações`);
      dados.opcoes3Ms = Math.round(r.ms);

      /* ---------- 2. Reenvio do mesmo pedido ---------- */
      const de = await marcar(primeira.items, 1, m.id, m.codigo);
      const y = await noBanco(m.id);
      const total = (await db.query('select count(*)::int as n from public.appointment_requests where clinic_id = $1', [CLINICA])).rows[0].n;
      afirmar(de.json?.status === 'ok' && de.json.replay === true && y.itens === 3 && y.usos === 3 && total === 1,
        '2: o reenvio com o mesmo id e código devolve o mesmo agendamento (replay), sem duplicar', JSON.stringify({ resposta: de.json, ...y, total }));
      const outro = await marcar(primeira.items, 1, m.id, `codigo-de-outro-aparelho-${randomUUID()}`);
      const depois = (await db.query('select count(*)::int as n from public.appointment_requests where clinic_id = $1', [CLINICA])).rows[0].n;
      afirmar(['slot_taken', 'idempotency_conflict'].includes(outro.json?.status) && outro.json.replay !== true && !outro.json.items && depois === 1,
        '2: o mesmo id com OUTRO código não devolve o agendamento (não é replay) nem grava outro', JSON.stringify({ resposta: outro.json, pedidos: depois }));
      notas.push('2. reenvio do mesmo pedido: replay, 1 agendamento só');
    }

    /* ---------- 3. Conflito no 3º exame ---------- */
    {
      const pacote = [item('pa', '10:00'), item('pm', '10:30'), item('pb', '11:00')];
      const avulso = await marcar([item('pb', '11:00')], 2);   // outra pessoa pega o exame B das 11:00
      const m = await marcar(pacote, 3);
      const x = await noBanco(m.id);
      const sobrou = await usosEm(horaSP(DIA, '10:00'), horaSP(DIA, '11:00'), [recursos.a, recursos.m]);
      afirmar(avulso.json?.status === 'ok' && m.status === 200 && m.json?.status === 'slot_taken' && m.json.seq === 3,
        '3: o 3º exame sem lugar: slot_taken no item 3', JSON.stringify({ avulso: avulso.json?.status, pacote: m.json ?? m.code }));
      afirmar(x.pedidos === 0 && x.itens === 0 && x.usos === 0 && sobrou === 0,
        '3: tudo ou nada: nada gravado (nem o 1º nem o 2º exame; os aparelhos A e do meio continuam livres)', JSON.stringify({ ...x, usosNosOutros: sobrou }));
      const r = await opcoes(['pa', 'pm', 'pb'], 20);
      const ops = r.json?.options ?? [];
      const pego = (o) => o.items.some((i) => i.procedure_id === P.pb && iso(i.starts_at) < horaSP(DIA, '11:30') && iso(i.ends_at) > horaSP(DIA, '11:00'));
      const antiga = (o) => o.items.some((i) => primeira.items.some((p) => p.procedure_id === i.procedure_id && iso(i.starts_at) < iso(p.ends_at) && iso(i.ends_at) > iso(p.starts_at)));
      afirmar(ops.length === 20 && !ops.some(pego) && !ops.some(antiga), '3: as opções novas não trazem o que foi ocupado (o exame B das 11:00 e o pacote do passo 1)',
        ops.filter((o) => pego(o) || antiga(o)).map(resumo).join('\n'));
      const de = await marcar(ops[0].items, 3);
      afirmar(de.json?.status === 'ok' && de.id !== m.id, '3: com id novo, a 1ª opção nova é marcada', JSON.stringify(de.json ?? de.code));
      notas.push(`3. conflito no 3º exame: slot_taken (item 3), nada gravado; opções novas sem o horário pego; id novo marcou ${resumo(ops[0])}`);
    }

    /* ---------- 4. Dois pacotes disputando o aparelho do meio (20 POST ao mesmo tempo) ---------- */
    {
      const desde = (await db.query('select now() as t')).rows[0].t;
      const pacote1 = [item('pa', '14:00'), item('pm', '14:30')];
      const pacote2 = [item('pm', '14:30'), item('pb', '15:00')];
      const t0 = performance.now();
      const res = await Promise.all(Array.from({ length: 20 }, (_, i) => marcar(i % 2 ? pacote2 : pacote1, 100 + i)));
      const ms = Math.round(performance.now() - t0);
      const ok = res.filter((r) => r.json?.status === 'ok');
      const outros = res.filter((r) => r.json?.status !== 'ok');
      const { rows: [x] } = await db.query(`
        select count(*)::int as pedidos, coalesce(sum((select count(*) from agenda.appointment_items i where i.request_id = a.id)), 0)::int as itens
        from public.appointment_requests a where a.clinic_id = $1 and a.created_at >= $2`, [CLINICA, desde]);
      const usos = await usosEm(horaSP(DIA, '14:00'), horaSP(DIA, '15:30'), [recursos.a, recursos.m, recursos.b]);
      afirmar(ok.length === 1 && x.pedidos === 1 && x.itens === 2 && usos === 2,
        '4: um pacote inteiro (2 exames, 2 ocupações) e os outros 19 nada (nem o 1º item)', JSON.stringify({ confirmados: ok.length, ...x, usos }));
      afirmar(outros.every((r) => r.status === 200 && r.json?.status === 'slot_taken'), '4: os outros recebem slot_taken, sem erro de banco (0 40P01, 0 57014)',
        outros.filter((r) => r.json?.status !== 'slot_taken').slice(0, 5).map((r) => `${r.status} ${r.code ?? ''} ${r.message ?? JSON.stringify(r.json)}`).join('\n'));
      notas.push(`4. dois pacotes (A 14:00 + meio 14:30; meio 14:30 + B 15:00), 20 POST ao mesmo tempo: ${ok.length} confirmado, ${outros.length} slot_taken, ${ms} ms`);
    }

    /* ---------- 5. Ocupação virtual: o mesmo aparelho, com higienização ---------- */
    {
      const r2 = await opcoes(['px', 'py'], 20);
      const ops2 = r2.json?.options ?? [];
      afirmar(r2.status === 200 && ops2.length === 20 && ops2.every((o) => Date.parse(o.items[1].starts_at) >= Date.parse(o.items[0].ends_at) + 10 * 60000) && ops2[0].wait_min === 10,
        '5: dois exames no mesmo aparelho (higienização de 10 min): nenhuma opção traz os dois colados; a melhor tem 10 min de espera',
        JSON.stringify({ status: r2.status, code: r2.code, n: ops2.length, primeira: ops2[0] && resumo(ops2[0]), espera: ops2[0]?.wait_min }));
      const m2 = await marcar(ops2[0].items, 200);
      afirmar(m2.json?.status === 'ok', '5: a marcação aceita a opção de 2 exames no mesmo aparelho', JSON.stringify(m2.json ?? m2.code));
      const r4 = await opcoes(['px', 'py', 'pz', 'pw']);
      const ops4 = r4.json?.options ?? [];
      afirmar(r4.status === 200 && r4.json?.status === 'ok' && ops4.length === 5 && ops4.every((o) => o.items.length === 4 && o.wait_min === 30),
        '5: quatro exames no mesmo aparelho (o caso mais caro: 24 ordens × 280 inícios): responde dentro do tempo-limite (3 s), 30 min de espera (3 higienizações)',
        JSON.stringify({ status: r4.status, code: r4.code, message: r4.message, n: ops4.length, ms: Math.round(r4.ms), esperas: ops4.map((o) => o.wait_min) }));
      const m4 = await marcar(ops4[0]?.items ?? [], 201);
      const x = await noBanco(m4.id);
      afirmar(m4.json?.status === 'ok' && x.itens === 4 && x.usos === 4 && x.recursos === 1, '5: a marcação aceita a opção de 4 exames: 4 itens, 4 ocupações, um aparelho',
        JSON.stringify({ resposta: m4.json ?? m4.code, ...x }));
      notas.push(`5. ocupação virtual: 2 exames no mesmo aparelho em ${Math.round(r2.ms)} ms (melhor: ${ops2[0] ? resumo(ops2[0]) : '-'}); 4 exames em ${Math.round(r4.ms)} ms (limite da função: 3000 ms)`);
      dados.opcoes4MesmoAparelhoMs = Math.round(r4.ms);
    }

    /* ---------- Oráculo ---------- */
    const viol = await violacoesAgenda(db, CLINICA);
    afirmar(viol.length === 0, 'oráculo: nenhum recurso acima da capacidade e nenhum uso dentro de bloqueio', viol.join('\n'));
    notas.push(`Oráculo: ${viol.length} violações; chamadas ${viaRest ? 'pela REST (PostgREST local, visitante com a chave publishable)' : 'por conexão direta (sem PostgREST nesta máquina)'}`);
    resumir('pacote', dados, notas);
  } finally {
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (pacote)', descreverErro(e)));
    await db.end();
  }
});
