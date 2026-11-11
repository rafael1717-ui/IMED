// iMed Agenda, fase 3.3 — teste obrigatório 1 (Concorrência) e as corridas dos testes 5 e 6 e da remarcação (§3.5 e
// §13 da arquitetura), no banco de verdade (Postgres 17 + PostgREST do Supabase local). Roda no GitHub (banco.yml):
//   node tests/banco/concorrencia.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
//   1a. 80 conexões diretas partem juntas (barreira: o coordenador segura pg_advisory_lock e cada uma espera
//       pg_advisory_xact_lock_shared antes de agenda_book), como visitante (anon, com o tempo-limite de 3 s da produção),
//       no MESMO aparelho, com inícios iguais e diferentes que se cruzam (45 e 30 min): exatamente 1 confirmado, as
//       outras 79 recebem slot_taken (sem erro), 0 impasses (40P01) e 0 estouros de tempo (57014).
//   1b. 300 POST simultâneos no PostgREST (rpc/agenda_book, como o site vai mandar, só com a chave publishable), ids
//       e telefones distintos, o mesmo horário: 1 confirmado, 299 slot_taken.
//   1c. Sala com 2 vagas, 60 pedidos de 15 min com inícios variados ao mesmo tempo: nunca 3 ao mesmo tempo.
//   Oráculo (sem olhar a vaga): por recurso, o máximo de usos ativos ao mesmo tempo ≤ capacidade e nenhum uso dentro de
//   bloqueio. p95 de agenda_book sem disputa (meta < 300 ms).
//   6.  Dois pacotes disputando o recurso do meio (20 ao mesmo tempo): um pacote inteiro, os outros nada (nem o 1º item).
//   I4. Remarcação × alguém tentando o horário antigo: quem tenta espera o COMMIT da remarcação e entra depois; com
//       ROLLBACK, recebe slot_taken e o agendamento antigo continua.
//   5.  Bloqueio de manutenção × marcação ao mesmo tempo: um espera o outro (nas duas ordens).
//
// Os dados (uma clínica de teste e os agendamentos) são criados aqui e apagados no fim.

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  afirmar, anotar, configLocal, conectar, criarClinicaAgenda, descreverErro, estatisticas, horaSP, limparClinicaAgenda,
  postgrest, principal, resumir, rodarJuntos, textoCodigos, violacoesAgenda,
} from './lib.mjs';

const CLINICA = 'cc000000-0000-4000-8000-0000000003c3';
const DONA = 'a5000000-0000-4000-8000-0000000003c3';
const EMAIL = 'dona.concorrencia@exemplo.test';
const N_DIRETO = Number(process.env.N_DIRETO ?? 80);
const N_HTTP = Number(process.env.N_HTTP ?? 300);
const DIA = 20;  // daqui a 20 dias

const telefone = (n) => `119${String(n).padStart(8, '0')}`;
const paciente = (n) => ({ name: `Paciente Concorrência ${n}`, phone: telefone(n), consent: true });

await principal('concorrencia', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-concorrencia-33');
  const notas = [];
  const rodadas = [];
  try {
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA });
    const { recursos, procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA, email: EMAIL, nome: 'Clínica da Concorrência do CI',
      recursos: [
        { chave: 'unico', name: 'Aparelho único' }, { chave: 'a', name: 'Aparelho A' }, { chave: 'm', name: 'Aparelho do meio' },
        { chave: 'b', name: 'Aparelho B' }, { chave: 'sala', name: 'Sala dupla', kind: 'sala', capacity: 2 },
      ],
      procedimentos: [
        { chave: 'p45', name: 'Exame de 45 minutos', duration_min: 45, grupos: [['unico']] },
        { chave: 'p30', name: 'Exame de 30 minutos', duration_min: 30, grupos: [['unico']] },
        { chave: 'pa', name: 'Exame A', duration_min: 30, grupos: [['a']] },
        { chave: 'pm', name: 'Exame do meio', duration_min: 30, grupos: [['m']] },
        { chave: 'pb', name: 'Exame B', duration_min: 30, grupos: [['b']] },
        { chave: 'p15', name: 'Exame de 15 minutos na sala', duration_min: 15, exam_code: 'ecg', grupos: [['sala']] },
      ],
    });

    // Marca como visitante numa conexão direta (o mesmo que o PostgREST faz), com o tempo-limite do anon na produção.
    const marcarDireto = async (c, itens, n) => {
      await c.query('set local role anon');
      await c.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('statement_timeout', '3s', true)`);
      const { rows: [r] } = await c.query('select public.agenda_book($1, $2, $3, $4, $5) as j',
        [CLINICA, JSON.stringify(itens), JSON.stringify(paciente(n)), randomUUID(), `codigo-concorrencia-${n}-${randomUUID()}`]);
      return r.j;
    };
    const item = (p, hhmm) => ({ procedure_id: P[p], starts_at: horaSP(DIA, hhmm) });
    const registrar = (nome, resultados, totalMs, extra = {}) => {
      const e = estatisticas(resultados.map((r) => (r.ok && r.valor?.status !== 'ok' ? { ...r, ok: false, code: r.valor?.status } : r)));
      rodadas.push({ nome, ...e, totalMs: Math.round(totalMs), ...extra });
      notas.push(`${nome}: ${e.ok} confirmado(s) de ${e.total}; ${textoCodigos(e.porCodigo)}; 40P01: ${e.porCodigo['40P01'] ?? 0}; `
        + `57014: ${e.porCodigo['57014'] ?? 0}; p95 ${e.p95} ms, máx ${e.max} ms, total ${Math.round(totalMs)} ms`);
      console.log(notas.at(-1));
      return e;
    };
    const confirmados = async (desde) => (await db.query(
      `select count(*)::int as n from public.appointment_requests where clinic_id = $1 and status = 'confirmed' and created_at >= $2`,
      [CLINICA, desde])).rows[0].n;
    const semErroDeBanco = (e) => Object.keys(e.porCodigo).every((k) => ['slot_taken'].includes(k));

    /* ---------- 1a. 80 conexões diretas, inícios iguais e diferentes ---------- */
    {
      const desde = (await db.query('select now() as t')).rows[0].t;
      const inicios = [['p45', '10:00'], ['p45', '10:05'], ['p45', '10:10'], ['p30', '10:15'], ['p30', '10:20']];
      const { resultados, totalMs } = await rodarJuntos({
        conexao: cfg.dbUrl, n: N_DIRETO, chave: 433001,
        trabalho: (c, i) => marcarDireto(c, [item(...inicios[i % inicios.length])], 1000 + i),
      });
      const e = registrar(`1a. ${N_DIRETO} conexões diretas, mesmo aparelho, inícios 10:00/10:05/10:10 (45 min) e 10:15/10:20 (30 min)`,
        resultados, totalMs);
      afirmar(e.ok === 1, `1a: exatamente 1 confirmado entre ${N_DIRETO} ao mesmo tempo`, `confirmados: ${e.ok}; ${textoCodigos(e.porCodigo)}`);
      afirmar(e.porCodigo.slot_taken === N_DIRETO - 1 && semErroDeBanco(e), `1a: os outros ${N_DIRETO - 1} recebem slot_taken, sem erro (0 40P01, 0 57014)`,
        resultados.filter((r) => !r.ok).slice(0, 5).map((r) => `${r.code}: ${r.message}`).join('\n'));
      afirmar(await confirmados(desde) === 1, '1a: 1 agendamento confirmado no banco');
    }

    /* ---------- 1b. 300 POST no PostgREST ---------- */
    if (cfg.apiUrl && cfg.publishableKey) {
      const desde = (await db.query('select now() as t')).rows[0].t;
      const t0 = performance.now();
      let reenvios = 0;
      let gateway = 0;
      const resultados = await Promise.all(Array.from({ length: N_HTTP }, async (_, i) => {
        // Se a conexão HTTP cair (300 sockets ao mesmo tempo no gateway local) ou o gateway (Kong) responder o erro
        // genérico dele ("An unexpected error occurred", sem nada do banco), o "aparelho" reenvia o MESMO pedido (mesmo
        // id e código), como o site faz desde a 5.1 ("Tentar de novo"): a idempotência devolve o resultado da primeira
        // vez, sem duplicar. Erro do banco (40P01, 57014, outro código) NÃO é reenviado: reprova abaixo.
        const corpo = { p_clinic: CLINICA, p_items: [item('p45', '13:00')], p_patient: paciente(5000 + i), p_id: randomUUID(),
                        p_token: `codigo-http-${i}-${randomUUID()}` };
        let r;
        for (let t = 0; ; t++) {
          try {
            r = await postgrest(cfg, 'rpc/agenda_book', { prefer: null, corpo });
            if (r.status === 500 && !r.code && r.message === 'An unexpected error occurred' && t < 5) {
              reenvios++;
              gateway++;
              await new Promise((ok) => setTimeout(ok, 200 * (t + 1)));
              continue;
            }
            break;
          } catch (e) {
            if (t >= 5) throw e;
            reenvios++;
            await new Promise((ok) => setTimeout(ok, 200 * (t + 1)));
          }
        }
        if (r.status !== 200) return { ok: false, code: r.code ?? `HTTP ${r.status}`, message: r.message, ms: r.ms };
        return { ok: true, valor: r.json, ms: r.ms };
      }));
      const e = registrar(`1b. ${N_HTTP} POST simultâneos no PostgREST (rpc/agenda_book, visitante), o mesmo horário`, resultados,
        performance.now() - t0);
      afirmar(e.ok === 1 && e.porCodigo.slot_taken === N_HTTP - 1,
        `1b: ${N_HTTP} POST: 1 confirmado e ${N_HTTP - 1} slot_taken`, `${e.ok} confirmados; ${textoCodigos(e.porCodigo)}`);
      afirmar(semErroDeBanco(e), '1b: nenhuma resposta de erro (0 40P01, 0 57014, nenhum HTTP de erro)',
        resultados.filter((r) => !r.ok && r.code !== 'slot_taken').slice(0, 5).map((r) => `${r.code}: ${r.message}`).join('\n'));
      afirmar(await confirmados(desde) === 1, '1b: 1 agendamento confirmado no banco');
      notas.push(`1b: ${reenvios} reenvio(s) do mesmo pedido depois de queda da conexão HTTP ou erro genérico do gateway (${gateway}) (idempotência: sem duplicar)`);
    } else {
      anotar('warning', 'Sem o PostgREST local (API_URL): o 1b (300 POST) não rodou');
    }

    /* ---------- 1c. Sala com 2 vagas ---------- */
    {
      const { resultados, totalMs } = await rodarJuntos({
        conexao: cfg.dbUrl, n: 60, chave: 433002,
        trabalho: (c, i) => marcarDireto(c, [item('p15', `14:${String((i % 12) * 5).padStart(2, '0')}`)], 2000 + i),
      });
      const e = registrar('1c. sala com 2 vagas, 60 pedidos de 15 min (inícios 14:00 a 14:55)', resultados, totalMs);
      const { rows: [{ pico }] } = await db.query(`
        select coalesce(max((select count(*) from agenda.occupancy x where x.resource_id = o.resource_id and x.active
                             and x.during @> lower(o.during))), 0)::int as pico
        from agenda.occupancy o where o.resource_id = $1 and o.active`, [recursos.sala]);
      afirmar(pico <= 2 && e.ok >= 2, '1c: no máximo 2 ao mesmo tempo na sala de 2 vagas', `pico ${pico}; confirmados ${e.ok}`);
      afirmar(semErroDeBanco(e), '1c: sem erro de banco', textoCodigos(e.porCodigo));
      notas.push(`1c: pico de ${pico} ao mesmo tempo na sala de 2 vagas (${e.ok} confirmados)`);
    }

    /* ---------- p95 sem disputa ---------- */
    {
      const c = await conectar(cfg.dbUrl, 'imed-concorrencia-p95');
      const tempos = [];
      try {
        for (let i = 0; i < 30; i++) {
          const hh = String(15 + Math.floor(i / 12)).padStart(2, '0');
          const mm = String((i % 12) * 5).padStart(2, '0');
          await c.query('begin');
          const t0 = performance.now();
          const j = await marcarDireto(c, [item('pa', `${hh}:${mm}`)], 3000 + i);
          await c.query('commit');
          tempos.push({ ok: j.status === 'ok', ms: performance.now() - t0, code: j.status === 'ok' ? undefined : j.status });
        }
      } finally { await c.end(); }
      const e = estatisticas(tempos);
      notas.push(`agenda_book sem disputa (30 seguidas, conexão direta): p50 ${e.p50} ms, p95 ${e.p95} ms (meta < 300 ms)`);
      afirmar(e.ok >= 1 && e.p95 < 300, 'agenda_book sem disputa: p95 < 300 ms', `p95 ${e.p95} ms; ${e.ok} confirmados; ${textoCodigos(e.porCodigo)}`);
    }

    /* ---------- 6. Dois pacotes disputando o recurso do meio ---------- */
    {
      const desde = (await db.query('select now() as t')).rows[0].t;
      const pacote1 = [item('pa', '08:00'), item('pm', '08:30')];
      const pacote2 = [item('pm', '08:30'), item('pb', '09:00')];
      const { resultados, totalMs } = await rodarJuntos({
        conexao: cfg.dbUrl, n: 20, chave: 433003, trabalho: (c, i) => marcarDireto(c, i % 2 ? pacote2 : pacote1, 4000 + i),
      });
      const e = registrar('6. dois pacotes (A 08:00 + meio 08:30; meio 08:30 + B 09:00), 20 ao mesmo tempo', resultados, totalMs);
      const { rows: [x] } = await db.query(`
        select count(*)::int as pedidos, coalesce(sum((select count(*) from agenda.appointment_items i where i.request_id = a.id)), 0)::int as itens,
               (select count(*)::int from agenda.occupancy o where o.clinic_id = $1 and o.active
                  and o.resource_id = any ($3::uuid[]) and o.during && tstzrange($4::timestamptz, $5::timestamptz)) as usos
        from public.appointment_requests a where a.clinic_id = $1 and a.created_at >= $2`, [CLINICA, desde, [recursos.a, recursos.m, recursos.b],
           horaSP(DIA, '08:00'), horaSP(DIA, '09:30')]);
      afirmar(e.ok === 1 && x.pedidos === 1 && x.itens === 2 && x.usos === 2,
        '6: um pacote inteiro (2 exames, 2 ocupações) e os outros nada (nem o 1º item)', JSON.stringify({ ...x, confirmados: e.ok }));
      afirmar(semErroDeBanco(e), '6: sem erro de banco', textoCodigos(e.porCodigo));
    }

    /* ---------- I4. Remarcação × o horário antigo ---------- */
    for (const desfecho of ['commit', 'rollback']) {
      const c1 = await conectar(cfg.dbUrl, 'imed-remarcar');
      const c2 = await conectar(cfg.dbUrl, 'imed-horario-antigo');
      try {
        const hh = desfecho === 'commit' ? '11:00' : '12:00';
        const novo = desfecho === 'commit' ? '21:00' : '22:00';
        const id = randomUUID();
        const codigo = `codigo-remarcar-${randomUUID()}`;
        await c1.query('begin');
        await c1.query('set local role anon');
        await c1.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true)`);
        const { rows: [m] } = await c1.query('select public.agenda_book($1, $2, $3, $4, $5) as j',
          [CLINICA, JSON.stringify([item('p45', hh)]), JSON.stringify(paciente(6000)), id, codigo]);
        await c1.query('commit');
        await c1.query('begin');
        await c1.query('set local role anon');
        await c1.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true)`);
        const { rows: [rm] } = await c1.query('select public.agenda_reschedule($1, $2, $3) as j',
          [id, JSON.stringify([{ seq: 1, starts_at: horaSP(DIA, novo) }]), codigo]);
        const t0 = performance.now();
        const outro = (async () => {
          await c2.query('begin');
          const j = await marcarDireto(c2, [item('p45', hh)], 6001);
          await c2.query('commit');
          return { j, ms: performance.now() - t0 };
        })();
        await new Promise((r) => setTimeout(r, 1500));
        await c1.query(desfecho);
        const { j, ms } = await outro;
        const { rows: [a] } = await db.query('select status, slot_start from public.appointment_requests where id = $1', [id]);
        const antigo = new Date(a.slot_start).toISOString() === horaSP(DIA, hh);
        if (desfecho === 'commit') {
          afirmar(m.j.status === 'ok' && rm.j.status === 'ok' && j.status === 'ok' && ms >= 1000 && !antigo,
            'I4 (COMMIT): quem tenta o horário antigo espera a remarcação e entra depois',
            JSON.stringify({ marcou: m.j.status, remarcou: rm.j.status, outro: j.status, esperouMs: Math.round(ms), antigo }));
        } else {
          afirmar(m.j.status === 'ok' && rm.j.status === 'ok' && j.status === 'slot_taken' && ms >= 1000 && antigo,
            'I4 (ROLLBACK): quem tenta o horário antigo espera, recebe slot_taken e o agendamento antigo continua',
            JSON.stringify({ marcou: m.j.status, remarcou: rm.j.status, outro: j.status, esperouMs: Math.round(ms), antigo }));
        }
        notas.push(`I4 remarcação × horário antigo (${desfecho}): o outro esperou ${Math.round(ms)} ms e recebeu ${j.status}`);
      } finally {
        await c1.end().catch(() => {});
        await c2.end().catch(() => {});
      }
    }

    /* ---------- 5. Bloqueio × marcação ao mesmo tempo ---------- */
    for (const ordem of ['bloqueio-primeiro', 'marcacao-primeiro']) {
      const c1 = await conectar(cfg.dbUrl, 'imed-primeiro');
      const c2 = await conectar(cfg.dbUrl, 'imed-segundo');
      try {
        const hh = ordem === 'bloqueio-primeiro' ? '18:00' : '19:00';
        const fim = ordem === 'bloqueio-primeiro' ? '19:00' : '20:00';
        const bloquear = async (c) => {
          await c.query(`select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`,
            [JSON.stringify({ role: 'authenticated', aud: 'authenticated', sub: DONA, email: EMAIL, amr: [{ method: 'otp', timestamp: 1 }] })]);
          const { rows: [r] } = await c.query(`select public.agenda_block_add($1, $2, $3, $4, 'manutencao') as j`,
            [CLINICA, recursos.unico, horaSP(DIA, hh), horaSP(DIA, fim)]);
          return r.j;
        };
        await c1.query('begin');
        const primeiro = ordem === 'bloqueio-primeiro' ? await bloquear(c1) : await marcarDireto(c1, [item('p30', hh)], 7000);
        const t0 = performance.now();
        const segundo = (async () => {
          await c2.query('begin');
          const j = ordem === 'bloqueio-primeiro' ? await marcarDireto(c2, [item('p30', hh)], 7001) : await bloquear(c2);
          await c2.query('commit');
          return { j, ms: performance.now() - t0 };
        })();
        await new Promise((r) => setTimeout(r, 1000));
        await c1.query('commit');
        const { j, ms } = await segundo;
        const esperado = ordem === 'bloqueio-primeiro' ? 'slot_taken' : 'has_appointments';
        afirmar(primeiro.status === 'ok' && j.status === esperado && ms >= 800,
          `5 (${ordem}): o segundo espera o primeiro e recebe ${esperado}`,
          JSON.stringify({ primeiro: primeiro.status, segundo: j.status, esperouMs: Math.round(ms) }));
        notas.push(`5 bloqueio × marcação (${ordem}): o segundo esperou ${Math.round(ms)} ms e recebeu ${j.status}`);
      } finally {
        await c1.end().catch(() => {});
        await c2.end().catch(() => {});
      }
    }

    /* ---------- Oráculo ---------- */
    const viol = await violacoesAgenda(db, CLINICA);
    afirmar(viol.length === 0, 'oráculo: nenhum recurso acima da capacidade e nenhum uso dentro de bloqueio', viol.join('\n'));
    const { rows: [{ ativos }] } = await db.query(
      `select count(*)::int as ativos from agenda.occupancy where clinic_id = $1 and active and kind = 'agendamento'`, [CLINICA]);
    notas.push(`Oráculo: ${ativos} usos ativos, ${viol.length} violações`);
    resumir('concorrencia', { rodadas }, notas);
  } finally {
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (concorrencia)', descreverErro(e)));
    await db.end();
  }
});
