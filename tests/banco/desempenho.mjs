// iMed Agenda, fase 3.2 — desempenho do motor de horários e a trava de configuração, no banco de verdade
// (Postgres 17 do Supabase local, com todas as migrações). Roda no GitHub (banco.yml):
//   node tests/banco/desempenho.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
// 1. Tempo (arquitetura §4 e §13): uma clínica com 9 vagas de recurso (3 aparelhos de USG, uma sala com 3 vagas e 3
//    profissionais), aberta de segunda a sábado das 07:00 às 19:00 com almoço, e uns 3.000 usos "ocupado" nos
//    próximos 14 dias (metade da grade). Mede, como visitante (anon), 30 vezes cada: agenda_slots de 14 dias de um
//    procedimento com 3 alternativas e de um com 2 grupos (sala + profissional), agenda_days de 31 dias e a fachada
//    available_slots. Meta da arquitetura: agenda_slots de 14 dias com p95 < 150 ms (reprova acima de 150 ms).
//    Fase 5.1: agenda_next_free (o "próximo horário livre" da lista da busca) com 10 clínicas de uma vez — a do teste
//    e 9 lotadas nos 14 dias, só com buracos menores que o exame (o pior caso: o motor roda inteiro em todas as janelas
//    de todas, sem achar horário). Meta: p95 < 300 ms (acima
//    disso a arquitetura manda pôr um cache; §16).
// 2. Trava de configuração (§3.2, passo 1; I6): quem muda a configuração segura a trava EXCLUSIVA da clínica até o
//    fim da transação — quem marca (a trava compartilhada, na 3.3) espera; e quem está marcando faz a configuração
//    esperar. Provado com duas conexões e lock_timeout (55P03 = esperou e desistiu).
//
// Tudo é feito numa transação desfeita no fim (ROLLBACK): nada fica no banco.

import { afirmar, configLocal, conectar, estatisticas, principal, resumir } from './lib.mjs';

const CLINICA = 'cd320000-0000-4000-8000-0000000000d1';
const CLINICA2 = 'cd320000-0000-4000-8000-0000000000d2';
const DONA = 'ad320000-0000-4000-8000-0000000000d1';
const EMAIL = 'dona.desempenho@exemplo.test';
const RODADAS = Number(process.env.N_DESEMPENHO ?? 30);
const META_MS = 150;
const META_PROXIMO_MS = 300;
const LOTADAS = Array.from({ length: 9 }, (_, i) => `cd320000-0000-4000-8000-0000000001${String(i + 1).padStart(2, '0')}`);

async function comoDona(db, sql, params = []) {
  await db.query(`select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`,
    [JSON.stringify({ role: 'authenticated', sub: DONA, email: EMAIL, aud: 'authenticated', amr: [{ method: 'otp', timestamp: 1 }] })]);
  try {
    const { rows } = await db.query(sql, params);
    return rows;
  } finally {
    await db.query(`select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true)`);
  }
}

async function ok(db, sql, params, titulo) {
  const [r] = await comoDona(db, sql, params);
  const st = r && Object.values(r)[0]?.status;
  if (st !== 'ok') throw new Error(`${titulo}: ${JSON.stringify(r)}`);
  return Object.values(r)[0];
}

async function medir(db, sql, params) {
  await db.query(`select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true)`);
  const tempos = [];
  let linhas = 0;
  try {
    for (let i = 0; i < RODADAS; i++) {
      const t0 = performance.now();
      const { rowCount } = await db.query(sql, params);
      tempos.push({ ok: true, ms: performance.now() - t0 });
      linhas = rowCount;
    }
  } finally {
    await db.query(`select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true)`);
  }
  return { ...estatisticas(tempos), linhas };
}

await principal('desempenho', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-desempenho');
  const outra = await conectar(cfg.dbUrl, 'imed-desempenho-trava');
  const notas = [];
  const dados = {};
  try {
    await db.query('begin');
    await db.query(`insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
                    values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
                            '{"provider": "email", "providers": ["email"]}', '{}', now(), now())`, [DONA, EMAIL]);
    await db.query(`insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
                    select x.id, x.nome, 'imagem', 'Rua do Desempenho, 1', 'São Paulo', 'SP',
                           extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
                    from (values ($1::uuid, 'Clínica do Desempenho'), ($2::uuid, 'Outra Clínica do Desempenho')) x (id, nome)`, [CLINICA, CLINICA2]);
    await db.query(`insert into public.clinic_members (clinic_id, user_id, role) values ($1, $3, 'owner'), ($2, $3, 'owner')`, [CLINICA, CLINICA2, DONA]);
    await db.query(`insert into agenda.holidays (scope, day, name, source)
                    select 'nacional', make_date(extract(year from now())::integer + 1, 12, 25), 'Natal', 'Lei 662/1949'
                    where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from now())::integer + 1, 12, 25))`);

    // cadastros pela dona (as funções de verdade)
    await ok(db, `select public.agenda_unit_save($1, jsonb_build_object('holidays_checked_until', current_date + 400, 'min_notice_min', 0))`, [CLINICA], 'unidade');
    const rec = {};
    for (const [nome, kind, cap] of [['USG-1', 'equipamento', 1], ['USG-2', 'equipamento', 1], ['USG-3', 'equipamento', 1],
      ['Sala', 'sala', 3], ['Prof-1', 'profissional', 1], ['Prof-2', 'profissional', 1], ['Prof-3', 'profissional', 1]]) {
      rec[nome] = (await ok(db, 'select public.agenda_resource_save($1, $2)', [CLINICA, JSON.stringify({ kind, name: nome, capacity: cap })], nome)).id;
    }
    const opc = (kind, nomes, extra = {}) => ({ resource_kind: kind, options: nomes.map((n) => ({ resource_id: rec[n] })), ...extra });
    const p1 = (await ok(db, 'select public.agenda_procedure_save($1, $2)', [CLINICA, JSON.stringify({
      exam_code: 'usg', name: 'Ultrassom', duration_min: 15, default_for_exam: true, requirements: [opc('equipamento', ['USG-1', 'USG-2', 'USG-3'])] })], 'P1')).id;
    const p2 = (await ok(db, 'select public.agenda_procedure_save($1, $2)', [CLINICA, JSON.stringify({
      exam_code: 'eco', name: 'Eco com profissional', duration_min: 20,
      requirements: [opc('sala', ['Sala']), opc('profissional', ['Prof-1', 'Prof-2', 'Prof-3'], { offset_min: 5, duration_min: 15 })] })], 'P2')).id;
    const regras = [];
    for (let d = 1; d <= 6; d++) regras.push({ weekday: d, start: '07:00', end: '19:00' }, { weekday: d, start: '12:00', end: '13:00', kind: 'pausa' });
    await ok(db, 'select public.agenda_rules_set($1, null, $2)', [CLINICA, JSON.stringify(regras)], 'regras');

    // ~3.000 usos "ocupado" de 15 min (metade da grade de cada vaga, alternando) nos próximos 14 dias
    await db.query(`select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_desempenho', true)`);
    await db.query(`
      create temp table usos on commit drop as
      select md5(r.id::text || v.seat || d.d || k.k)::uuid as busy, r.id as rid, v.seat,
             ((d.d + time '07:00' + make_interval(mins => 15 * k.k)) at time zone 'America/Sao_Paulo') as ini
      from agenda.resources r
      cross join lateral generate_series(1, r.capacity::integer) v (seat)
      cross join generate_series((now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date + 13, interval '1 day') d (d)
      cross join generate_series(0, 47) k (k)
      where r.clinic_id = $1 and (k.k + v.seat + extract(day from d.d)::integer) % 2 = 0 and extract(dow from d.d) between 1 and 6`, [CLINICA]);
    await db.query(`insert into agenda.busy_marks (id, clinic_id, starts_at, ends_at, reason_code, created_by)
                    select busy, $1, ini, ini + interval '15 minutes', 'agenda_propria', $2 from usos`, [CLINICA, DONA]);
    const { rowCount: nUsos } = await db.query(`
      insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, busy_id)
      select $1, rid, 'ocupado', int4range(seat, seat + 1), tstzrange(ini, ini + interval '15 minutes', '[)'), busy from usos`, [CLINICA]);
    await db.query(`update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now() where id = $1`, [CLINICA]);
    await db.query(`select set_config('imed.origin', '', true), set_config('imed.reason', '', true)`);
    await db.query('analyze agenda.occupancy');
    const { rows: [{ vagas }] } = await db.query('select sum(capacity)::int as vagas from agenda.resources where clinic_id = $1', [CLINICA]);
    notas.push(`Clínica de teste: ${vagas} vagas de recurso, ${nUsos} usos "ocupado" em 14 dias, ${RODADAS} rodadas por consulta (como visitante)`);

    // 5.1: 9 clínicas lotadas (um aparelho com usos de 20 min a cada 30 min nos próximos 15 dias), com a venda online ligada
    await db.query(`insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
                    select x.id, 'Clínica Lotada ' || x.n, 'imagem', 'Rua do Desempenho, ' || (x.n + 1), 'São Paulo', 'SP',
                           extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
                    from unnest($1::uuid[]) with ordinality x (id, n)`, [LOTADAS]);
    await db.query(`insert into public.clinic_members (clinic_id, user_id, role) select x, $2, 'owner' from unnest($1::uuid[]) x`, [LOTADAS, DONA]);
    const regrasLotada = Array.from({ length: 6 }, (_, i) => ({ weekday: i + 1, start: '07:00', end: '19:00' }));
    for (const id of LOTADAS) {
      await ok(db, `select public.agenda_unit_save($1, jsonb_build_object('holidays_checked_until', current_date + 400, 'min_notice_min', 0))`, [id], 'unidade lotada');
      const usg = (await ok(db, 'select public.agenda_resource_save($1, $2)', [id, JSON.stringify({ kind: 'equipamento', name: 'USG' })], 'USG lotada')).id;
      await ok(db, 'select public.agenda_procedure_save($1, $2)', [id, JSON.stringify({ exam_code: 'usg', name: 'Ultrassom', duration_min: 15,
        default_for_exam: true, requirements: [{ resource_kind: 'equipamento', options: [{ resource_id: usg }] }] })], 'procedimento lotada');
      await ok(db, 'select public.agenda_rules_set($1, null, $2)', [id, JSON.stringify(regrasLotada)], 'regras lotada');
      await db.query(`select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_desempenho', true)`);
      // usos de 20 min a cada 30 min, de agora até daqui a 15 dias: sobram buracos de 10 min, menores que o exame (15
      // min) — o motor roda inteiro e não acha horário (o atalho de "nenhum tempo livre" não serve aqui)
      await db.query(`with b as (insert into agenda.busy_marks (id, clinic_id, starts_at, ends_at, reason_code, created_by)
                                 select md5($1::text || k)::uuid, $1::uuid, date_trunc('hour', now()) + make_interval(mins => 30 * k),
                                        date_trunc('hour', now()) + make_interval(mins => 30 * k + 20), 'agenda_propria', $3
                                 from generate_series(-2, 48 * 15) k
                                 returning id, starts_at, ends_at)
                      insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, busy_id)
                      select $1::uuid, $2::uuid, 'ocupado', int4range(1, 2), tstzrange(b.starts_at, b.ends_at, '[)'), b.id from b`, [id, usg, DONA]);
      await db.query(`update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now() where id = $1`, [id]);
      await db.query(`select set_config('imed.origin', '', true), set_config('imed.reason', '', true)`);
    }
    await db.query('analyze agenda.occupancy');
    const dez = [CLINICA, ...LOTADAS];

    const consultas = [
      ['agenda_slots 14 dias, 1 grupo com 3 alternativas', 'select * from public.agenda_slots($1, $2, null, null)', [CLINICA, p1], true],
      ['agenda_slots 14 dias, 2 grupos (sala + profissional)', 'select * from public.agenda_slots($1, $2, null, null)', [CLINICA, p2], true],
      ['agenda_days 31 dias', `select * from public.agenda_days($1, $2, null, (now() at time zone 'America/Sao_Paulo')::date + 30)`, [CLINICA, p1], false],
      ['available_slots 14 dias (fachada)', `select * from public.available_slots($1, 'usg', null, 14)`, [CLINICA], false],
      ['agenda_next_free 10 clínicas (9 lotadas), ultrassom', `select * from public.agenda_next_free($1::uuid[], 'usg', 14)`, [dez], META_PROXIMO_MS],
      ['agenda_next_free 10 clínicas (9 lotadas), sem exame', 'select * from public.agenda_next_free($1::uuid[], null, 14)', [dez], META_PROXIMO_MS],
    ];
    for (const [nome, sql, params, metaArg] of consultas) {
      const meta = metaArg === true ? META_MS : metaArg;
      const r = await medir(db, sql, params);
      dados[nome] = r;
      const linha = `${nome}: ${r.linhas} linhas; p50 ${r.p50} ms, p95 ${r.p95} ms, máximo ${r.max} ms`;
      notas.push(linha);
      console.log(linha);
      afirmar(r.linhas > 0, `${nome}: devolve horários`, linha);
      if (meta) afirmar(r.p95 < meta, `${nome}: p95 abaixo de ${meta} ms (meta da arquitetura)`, linha);
    }
    // o "próximo livre" das 10: só a clínica com horário aparece, com o mesmo primeiro horário de agenda_slots
    await db.query(`select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    const { rows: prox } = await db.query(`select clinic_id, slot_start from public.agenda_next_free($1::uuid[], 'usg', 14)`, [dez]);
    const { rows: [{ primeiro }] } = await db.query('select min(slot_start) as primeiro from public.agenda_slots($1, $2, null, null)', [CLINICA, p1]);
    await db.query(`select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true)`);
    afirmar(prox.length === 1 && prox[0].clinic_id === CLINICA && +prox[0].slot_start === +primeiro,
      'agenda_next_free: só a clínica com horário, com o mesmo primeiro horário de agenda_slots',
      `linhas: ${JSON.stringify(prox)}; primeiro de agenda_slots: ${primeiro?.toISOString?.()}`);

    // conferência de sentido: nenhum horário devolvido cai num uso das 3 USG ao mesmo tempo
    const { rows: [{ cheios }] } = await db.query(`
      select count(*)::int as cheios from public.agenda_slots($1, $2, null, null) s
      where (select count(*) from agenda.occupancy o where o.clinic_id = $1 and o.kind = 'ocupado' and o.active
               and o.resource_id in (select resource_id from agenda.requirement_options where procedure_id = $2)
               and o.during && tstzrange(s.slot_start, s.slot_end, '[)')) >= 3`, [CLINICA, p1]);
    afirmar(cheios === 0, 'nenhum horário mostrado com as 3 USG ocupadas', `horários com as 3 ocupadas: ${cheios}`);

    // 2. Trava de configuração
    await outra.query('begin');
    await outra.query(`set local lock_timeout = '300ms'`);
    let codigo = null;
    try {
      await outra.query('select pg_advisory_xact_lock_shared(7101, hashtext($1))', [CLINICA]);
    } catch (e) { codigo = e.code; }
    await outra.query('rollback');
    afirmar(codigo === '55P03', 'quem marca (trava compartilhada) espera quem está configurando (exclusiva)',
      `resposta da segunda conexão: ${codigo ?? 'pegou a trava (a configuração não segurou a exclusiva)'}`);
    notas.push(`Trava de configuração: marcação durante a configuração ${codigo === '55P03' ? 'esperou (55P03 com lock_timeout de 300 ms)' : 'NÃO esperou'}`);

    await outra.query('begin');
    await outra.query('select pg_advisory_xact_lock_shared(7101, hashtext($1))', [CLINICA2]);
    await db.query('savepoint antes');
    await db.query(`set local lock_timeout = '300ms'`);
    await db.query(`select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`,
      [JSON.stringify({ role: 'authenticated', sub: DONA, email: EMAIL, aud: 'authenticated', amr: [{ method: 'otp', timestamp: 1 }] })]);
    let codigo2 = null;
    try {
      await db.query(`select public.agenda_unit_save($1, '{}')`, [CLINICA2]);
    } catch (e) { codigo2 = e.code; }
    await db.query('rollback to savepoint antes');
    await outra.query('commit');
    const [r2] = await comoDona(db, `select public.agenda_unit_save($1, '{}') as r`, [CLINICA2]);
    afirmar(codigo2 === '55P03' && r2.r.status === 'ok', 'a configuração espera quem está marcando e grava depois',
      `durante a marcação: ${codigo2 ?? 'não esperou'}; depois: ${JSON.stringify(r2.r)}`);
    notas.push(`Trava de configuração: configuração durante uma marcação ${codigo2 === '55P03' ? 'esperou' : 'NÃO esperou'}; depois gravou (${r2.r.status})`);
  } finally {
    await db.query('rollback').catch(() => {});
    await db.end().catch(() => {});
    await outra.end().catch(() => {});
  }
  resumir('desempenho', dados, notas);
});
