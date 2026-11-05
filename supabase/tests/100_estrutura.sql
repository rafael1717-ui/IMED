-- Fundação da agenda (iMed Agenda, fase 3.1; arquitetura §2.5, §3.2 e §3.4), na tabela DE VERDADE:
--   - as tabelas da 3.1 existem (e as das fases seguintes ainda não), btree_gist no schema extensions, as restrições
--     com o tipo certo (a de exclusão imediata; as dos itens adiáveis) e as colunas novas com valor padrão;
--   - os casos do §3.4 em agenda.occupancy: cruzamento recusado (inícios diferentes também), encostado aceito,
--     bloqueio × bloqueio aceito, uso dentro de bloqueio recusado, capacidade por vagas, CHECKs; e um oráculo que
--     não olha a vaga confere a regra fundamental (nenhum recurso acima da capacidade, nenhum uso em fechamento);
--   - guarda de capacidade do recurso, marca de origem na ocupação e nos itens, trilhas que só acrescentam,
--     restrições das outras tabelas e a versão da clínica (agenda_touch).
-- As escritas na agenda usam a marca de emergência (imed.origin = 'sql' + motivo), como o SQL do painel usaria.
-- Tudo é desfeito no fim (rollback). As restrições adiáveis dos itens são conferidas com SET CONSTRAINTS IMMEDIATE.
begin;
select plan(109);

/* ===================== Ferramentas do teste ===================== */
create function pg_temp.marca(p_origem text, p_motivo text default null) returns void language plpgsql as $$
begin
  perform set_config('imed.origin', coalesce(p_origem, ''), true);
  perform set_config('imed.reason', coalesce(p_motivo, ''), true);
end $$;
-- Dia do teste: daqui a 30 dias (horário de São Paulo); horários desse dia e faixas [de, até).
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.faixa(p_de text, p_ate text) returns tstzrange language sql stable as $$
  select tstzrange(pg_temp.t(p_de), pg_temp.t(p_ate), '[)') $$;

-- Clínicas, recursos e procedimento do teste.
--   RM (capacidade 1), SALA (capacidade 2), INATIVO, R3 (capacidade 3), R4 (sem usos), RM2 (outra clínica).
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
values
  ('c3100000-0000-4000-8000-000000000001', 'Clínica da Estrutura', 'imagem', 'Rua da Estrutura, 1', 'São Paulo', 'SP',
   extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false),
  ('c3100000-0000-4000-8000-000000000002', 'Outra Clínica da Estrutura', 'imagem', 'Rua da Estrutura, 2', 'São Paulo', 'SP',
   extensions.st_setsrid(extensions.st_makepoint(-46.64, -23.56), 4326)::extensions.geography, 'published', true, false);
insert into agenda.resources (id, clinic_id, kind, name, capacity, active) values
  ('e3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 'equipamento', 'RM-1', 1, true),
  ('e3100000-0000-4000-8000-000000000002', 'c3100000-0000-4000-8000-000000000001', 'sala', 'Coleta', 2, true),
  ('e3100000-0000-4000-8000-000000000003', 'c3100000-0000-4000-8000-000000000001', 'equipamento', 'RM antiga', 1, false),
  ('e3100000-0000-4000-8000-000000000004', 'c3100000-0000-4000-8000-000000000001', 'sala', 'Sala 3', 3, true),
  ('e3100000-0000-4000-8000-000000000005', 'c3100000-0000-4000-8000-000000000001', 'equipamento', 'USG-1', 1, true),
  ('e3100000-0000-4000-8000-000000000006', 'c3100000-0000-4000-8000-000000000002', 'equipamento', 'RM da outra', 1, true);
insert into agenda.procedures (id, clinic_id, exam_code, name, duration_min) values
  ('f3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 'usg', 'Ultrassom de teste', 30),
  ('f3100000-0000-4000-8000-000000000002', 'c3100000-0000-4000-8000-000000000002', 'usg', 'Ultrassom da outra', 30);

-- Um uso do recurso: 'agendamento' (cria pedido e item, com a marca de emergência) ou 'ocupado' (sem paciente).
-- A gravação na ocupação usa a marca pedida (p_marca/p_motivo), para testar a guarda de origem.
create function pg_temp.uso(p_rec uuid, p_de text, p_ate text, p_vaga int default 1, p_kind text default 'agendamento',
                            p_ativo boolean default true, p_marca text default 'sql', p_motivo text default 'teste_estrutura',
                            p_clinica uuid default 'c3100000-0000-4000-8000-000000000001')
returns bigint language plpgsql as $$
declare
  v_req uuid;
  v_item uuid;
  v_busy uuid;
  v_id bigint;
begin
  perform pg_temp.marca('sql', 'teste_estrutura');
  if p_kind = 'agendamento' then
    insert into public.appointment_requests (clinic_id, place_source, place_name, preferred_date, patient_name, patient_phone, consent)
    values (p_clinica, 'imed', 'Clínica da Estrutura', pg_temp.dia(), 'Paciente da Estrutura', '11999990031', true)
    returning id into v_req;
    insert into agenda.appointment_items (request_id, clinic_id, seq, procedure_id, exam_code, starts_at, ends_at,
                                          local_start, tz, groups, status)
    values (v_req, p_clinica, 1, (select p.id from agenda.procedures p where p.clinic_id = p_clinica), 'usg',
            pg_temp.t(p_de), pg_temp.t(p_ate), pg_temp.dia() + p_de::time, 'America/Sao_Paulo', '{1}', 'confirmed')
    returning id into v_item;
  elsif p_kind = 'ocupado' then
    insert into agenda.busy_marks (clinic_id, starts_at, ends_at, reason_code, created_by)
    values (p_clinica, pg_temp.t(p_de), pg_temp.t(p_ate), 'agenda_propria', gen_random_uuid())
    returning id into v_busy;
  end if;
  perform pg_temp.marca(p_marca, p_motivo);
  insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, item_id, group_no, busy_id, active, released_at)
  values (p_clinica, p_rec, p_kind, int4range(p_vaga, p_vaga + 1), pg_temp.faixa(p_de, p_ate), v_item,
          case when p_kind = 'agendamento' then 1 end, v_busy, p_ativo, case when p_ativo then null else now() end)
  returning id into v_id;
  perform pg_temp.marca('sql', 'teste_estrutura');
  return v_id;
end $$;

-- Um fechamento (bloqueio de manutenção) do recurso: a linha em clinic_blocks e o fechamento na ocupação.
create function pg_temp.bloqueio(p_rec uuid, p_de text, p_ate text, p_ativo boolean default true, p_grupo int8range default null)
returns bigint language plpgsql as $$
declare
  v_bloco uuid;
  v_id bigint;
begin
  insert into public.clinic_blocks (clinic_id, starts_at, ends_at, resource_id, kind)
  values ('c3100000-0000-4000-8000-000000000001', pg_temp.t(p_de), pg_temp.t(p_ate), p_rec, 'manutencao')
  returning id into v_bloco;
  insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, block_id, active, released_at, excl_group)
  values ('c3100000-0000-4000-8000-000000000001', p_rec, 'bloqueio', int4range(1, 51), pg_temp.faixa(p_de, p_ate), v_bloco,
          p_ativo, case when p_ativo then null else now() end, coalesce(p_grupo, '(,)'::int8range))
  returning id into v_id;
  return v_id;
end $$;

-- Oráculo da regra fundamental, sem olhar a vaga: recursos com mais usos ativos ao mesmo tempo do que a capacidade
-- ou com uso ativo dentro de um fechamento ativo (o máximo de intervalos que se cruzam está sempre num início).
create function pg_temp.violacoes() returns text[] language sql stable as $$
  with usos as (
    select o.* from agenda.occupancy o where o.active and o.kind <> 'bloqueio'
  ), pontos as (
    select distinct u.resource_id, lower(u.during) as t from usos u
  ), simultaneos as (
    select p.resource_id, count(*) as n
    from pontos p join usos u on u.resource_id = p.resource_id and u.during @> p.t
    group by p.resource_id, p.t
  )
  select coalesce(array_agg(r.name || ': ' || coalesce((select max(s.n) from simultaneos s where s.resource_id = r.id), 0)
                            || ' ao mesmo tempo, capacidade ' || r.capacity order by r.name), '{}')
  from agenda.resources r
  where coalesce((select max(s.n) from simultaneos s where s.resource_id = r.id), 0) > r.capacity
     or exists (select 1 from usos u join agenda.occupancy f
                  on f.resource_id = u.resource_id and f.active and f.kind = 'bloqueio' and f.during && u.during
                where u.resource_id = r.id)
$$;

select pg_temp.marca('sql', 'teste_estrutura');

/* ===================== A. Estrutura ===================== */

select is((select extnamespace::regnamespace::text from pg_extension where extname = 'btree_gist'), 'extensions',
          'btree_gist instalada no schema extensions');

select is(
  array(select t from unnest(array['agenda.unit_settings', 'agenda.resources', 'agenda.procedures',
          'agenda.procedure_requirements', 'agenda.requirement_options', 'agenda.procedure_pair_rules',
          'agenda.appointment_items', 'agenda.busy_marks', 'agenda.occupancy', 'agenda.holidays', 'agenda.holiday_openings',
          'agenda.status_history', 'agenda.audit_log', 'agenda.access_log', 'agenda.notes', 'agenda.idempotency',
          'agenda.clinic_versions', 'agenda.conflicts', 'agenda.rate_counters', 'agenda.role_permissions',
          'agenda.status_transitions', 'agenda.settings_global', 'private.imed_staff']) t
        where to_regclass(t) is null order by 1),
  '{}'::text[], 'as 23 tabelas da fase 3.1 existem');

select is(
  array(select t from unnest(array['agenda.notifications', 'agenda.notification_rules',
          'agenda.outbox', 'agenda.payments', 'agenda.payment_events', 'agenda.integrations', 'agenda.external_refs',
          'agenda.sync_events', 'agenda.snapshot_seq']) t
        where to_regclass(t) is not null order by 1),
  '{}'::text[], 'as tabelas das fases 5.3, 5.4 e 6.1 ainda não existem (cada tabela nasce na fase que a usa; member_invites nasceu na 3.4)');

select is(
  (select contype::text || '|' || condeferrable::text || '|' || pg_get_constraintdef(oid)
   from pg_constraint where conrelid = 'agenda.occupancy'::regclass and conname = 'occupancy_no_overlap'),
  'x|false|EXCLUDE USING gist (resource_id WITH =, seats WITH &&, during WITH &&, excl_group WITH &&) WHERE (active)',
  'occupancy_no_overlap: restrição de exclusão imediata (não adiável) sobre recurso, vaga, horário e grupo, só nas linhas ativas');

select is(
  array(select conname || ':' || contype::text || ':' || condeferrable::text || ':' || condeferred::text
        from pg_constraint where conrelid = 'agenda.appointment_items'::regclass
          and conname in ('items_seq_uq', 'items_patient_no_overlap') order by 1),
  array['items_patient_no_overlap:x:true:true', 'items_seq_uq:u:true:true'],
  'itens: ordem e "paciente em dois exames ao mesmo tempo" conferidas no COMMIT (adiáveis)');

select is(
  array(select format('%s %s %s %s', c.table_name, c.column_name, c.is_nullable, coalesce(c.column_default, '-'))
        from information_schema.columns c
        where c.table_schema = 'public'
          and (c.table_name, c.column_name) in (
            ('appointment_requests', 'channel'), ('appointment_requests', 'slot_end'), ('appointment_requests', 'hold_expires_at'),
            ('appointment_requests', 'version'), ('appointment_requests', 'updated_at'), ('appointment_requests', 'cancel_reason'),
            ('appointment_requests', 'total_cents'), ('appointment_requests', 'payment_mode'),
            ('appointment_requests', 'notify_channels'), ('appointment_requests', 'uses_resources'),
            ('clinics', 'timezone'), ('clinics', 'timezone_confirmed_at'), ('clinics', 'agenda_mode'), ('clinics', 'agenda_online_since'),
            ('clinic_members', 'created_by'), ('clinic_members', 'updated_at'),
            ('clinic_schedules', 'resource_id'), ('clinic_schedules', 'kind'), ('clinic_schedules', 'valid_from'),
            ('clinic_schedules', 'valid_to'), ('clinic_schedules', 'label'), ('clinic_schedules', 'procedure_ids'),
            ('clinic_schedules', 'created_by'), ('clinic_schedules', 'updated_at'),
            ('clinic_blocks', 'resource_id'), ('clinic_blocks', 'kind'), ('clinic_blocks', 'created_by'),
            ('clinic_blocks', 'removed_at'), ('clinic_blocks', 'removed_by'))
        order by 1),
  array['appointment_requests cancel_reason YES -', 'appointment_requests channel NO ''imed_app''::text',
        'appointment_requests hold_expires_at YES -', 'appointment_requests notify_channels NO ''{}''::text[]',
        'appointment_requests payment_mode NO ''no_local''::text', 'appointment_requests slot_end YES -',
        'appointment_requests total_cents YES -', 'appointment_requests updated_at NO now()',
        'appointment_requests uses_resources NO false', 'appointment_requests version NO 1',
        'clinic_blocks created_by YES -', 'clinic_blocks kind NO ''bloqueio''::text', 'clinic_blocks removed_at YES -',
        'clinic_blocks removed_by YES -', 'clinic_blocks resource_id YES -',
        'clinic_members created_by YES -', 'clinic_members updated_at NO now()',
        'clinic_schedules created_by YES -', 'clinic_schedules kind NO ''abre''::text', 'clinic_schedules label YES -',
        'clinic_schedules procedure_ids NO ''{}''::uuid[]', 'clinic_schedules resource_id YES -',
        'clinic_schedules updated_at NO now()', 'clinic_schedules valid_from YES -', 'clinic_schedules valid_to YES -',
        'clinics agenda_mode NO ''pedido''::text', 'clinics agenda_online_since YES -',
        'clinics timezone NO ''America/Sao_Paulo''::text', 'clinics timezone_confirmed_at YES -'],
  'as 29 colunas novas das tabelas de hoje: nulas ou com valor padrão (nada obrigatório sem padrão)');

/* ===================== B. Aparelho exclusivo (RM, capacidade 1) ===================== */

select lives_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '10:00', '10:45') $$,
                'RM: uso 10:00–10:45');
select throws_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '10:30', '11:00') $$,
                 '23P01', null, 'RM: outro uso 10:30–11:00 (início diferente que cruza) é recusado');
select throws_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '10:00', '10:30') $$,
                 '23P01', null, 'RM: uso com o mesmo início 10:00–10:30 é recusado');
select lives_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '10:45', '11:15') $$,
                'RM: uso encostado 10:45–11:15 é aceito');
select lives_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '10:15', '10:40', p_ativo := false) $$,
                'RM: uso liberado (inativo) por cima não conta');
select throws_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '10:50', '11:00', p_kind := 'ocupado') $$,
                 '23P01', null, 'RM: "ocupado" (sem paciente) em cima do uso é recusado');

/* ===================== C. Bloqueios (fechamento do recurso) ===================== */

select lives_ok($$ select pg_temp.bloqueio('e3100000-0000-4000-8000-000000000001', '13:00', '15:00') $$,
                'bloqueio 13:00–15:00');
select is((select count(*)::int from agenda.occupancy where kind = 'bloqueio' and excl_group <> int8range(id, id, '[]')), 0,
          'o gatilho dá a cada fechamento o próprio grupo ([id,id], id gerado pela identidade)');
select lives_ok($$ select pg_temp.bloqueio('e3100000-0000-4000-8000-000000000001', '14:00', '16:00') $$,
                'bloqueio 14:00–16:00 que cruza o outro é aceito (manutenção × feriado)');
select throws_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '14:30', '14:45') $$,
                 '23P01', null, 'uso 14:30–14:45 dentro do bloqueio é recusado');
select lives_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '16:00', '16:30') $$,
                'uso 16:00–16:30 encostado no fim do bloqueio é aceito');
select throws_ok($$ select pg_temp.bloqueio('e3100000-0000-4000-8000-000000000001', '16:15', '16:45') $$,
                 '23P01', null, 'bloqueio 16:15–16:45 em cima de um uso é recusado');
select throws_ok($$ select pg_temp.bloqueio('e3100000-0000-4000-8000-000000000001', '17:00', '18:00', p_grupo := '[5,5]') $$,
                 '23514', null, 'bloqueio com grupo errado é recusado pelo CHECK');
select lives_ok($$ select pg_temp.bloqueio('e3100000-0000-4000-8000-000000000001', '16:00', '16:30', p_ativo := false) $$,
                'bloqueio inativo (já removido) por cima do uso é aceito');
select throws_ok($$ update agenda.occupancy set active = true, released_at = null
                    where resource_id = 'e3100000-0000-4000-8000-000000000001' and kind = 'bloqueio' and not active $$,
                 '23P01', null, 'reativar esse bloqueio por cima do uso é recusado');

/* ===================== D. Sala com capacidade 2 (vagas) ===================== */

select lives_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000002', '10:00', '11:00', 1, 'ocupado') $$,
                'sala: "ocupado" na vaga 1, 10:00–11:00');
select throws_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000002', '10:30', '11:00', 1) $$,
                 '23P01', null, 'sala: outro na vaga 1, 10:30–11:00, é recusado');
select lives_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000002', '10:30', '11:00', 2) $$,
                'sala: agendamento na vaga 2, 10:30–11:00, é aceito');
select throws_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000002', '10:30', '11:00', 3) $$,
                 '23514', 'Vaga 3 acima da capacidade 2 do recurso', 'sala: vaga 3 (acima da capacidade) é recusada pelo gatilho');
select throws_ok($$ insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, busy_id)
                    values ('c3100000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000002', 'ocupado',
                            int4range(1, 3), pg_temp.faixa('12:00', '12:30'),
                            (select id from agenda.busy_marks limit 1)) $$,
                 '23514', null, 'sala: uso com 2 vagas de uma vez é recusado pelo CHECK');
select throws_ok($$ select pg_temp.bloqueio('e3100000-0000-4000-8000-000000000002', '10:45', '11:30') $$,
                 '23P01', null, 'sala: bloqueio com usos dentro é recusado');
select lives_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000002', '11:00', '11:30', 2) $$,
                'sala: vaga 2 encostada 11:00–11:30 é aceita');
select lives_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000002', '11:00', '11:30', 1) $$,
                'sala: vaga 1 com o mesmo início (11:00–11:30): 2 ao mesmo tempo, dentro da capacidade');

select is(pg_temp.violacoes(), '{}'::text[],
          'oráculo: nenhum recurso acima da capacidade e nenhum uso dentro de fechamento');

/* ===================== E. CHECKs da ocupação e recurso ===================== */

select throws_ok($$ insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, busy_id)
                    values ('c3100000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000005', 'ocupado',
                            int4range(1, 2), tstzrange(pg_temp.t('08:00'), pg_temp.t('08:30'), '(]'),
                            (select id from agenda.busy_marks limit 1)) $$,
                 '23514', null, 'horário tem de ser [início, fim)');
select throws_ok($$ insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, busy_id)
                    values ('c3100000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000005', 'ocupado',
                            int4range(1, 2), tstzrange(pg_temp.t('08:00'), null, '[)'),
                            (select id from agenda.busy_marks limit 1)) $$,
                 '23514', null, 'horário sem fim é recusado');
select throws_ok($$ insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, busy_id, hold_until)
                    values ('c3100000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000005', 'ocupado',
                            int4range(1, 2), pg_temp.faixa('08:00', '08:30'), (select id from agenda.busy_marks limit 1), now()) $$,
                 '23514', null, 'prazo de reserva (hold_until) só em agendamento');
select throws_ok($$ insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, busy_id, active)
                    values ('c3100000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000005', 'ocupado',
                            int4range(1, 2), pg_temp.faixa('08:00', '08:30'), (select id from agenda.busy_marks limit 1), false) $$,
                 '23514', null, 'linha liberada (inativa) precisa de released_at');
select throws_ok($$ insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during)
                    values ('c3100000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000005', 'agendamento',
                            int4range(1, 2), pg_temp.faixa('08:00', '08:30')) $$,
                 '23514', null, 'agendamento sem item é recusado');
select throws_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000003', '08:00', '08:30') $$,
                 '23503', 'Recurso inexistente, inativo ou arquivado', 'uso em recurso inativo é recusado');
select throws_ok($$ insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, busy_id)
                    values ('c3100000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001', 'ocupado',
                            int4range(1, 2), pg_temp.faixa('08:00', '08:30'), (select id from agenda.busy_marks limit 1)) $$,
                 '23503', null, 'uso com recurso de outra clínica é recusado');

/* ===================== F. Guarda de capacidade do recurso ===================== */

select throws_ok($$ update agenda.resources set capacity = 1 where id = 'e3100000-0000-4000-8000-000000000002' $$,
                 '23514', null, 'reduzir a capacidade da sala para 1 com uso futuro na vaga 2 é recusado');
select throws_ok($$ update agenda.resources set active = false where id = 'e3100000-0000-4000-8000-000000000001' $$,
                 '23514', null, 'desativar a RM com usos futuros é recusado');
select throws_ok($$ update agenda.resources set archived_at = now() where id = 'e3100000-0000-4000-8000-000000000001' $$,
                 '23514', null, 'arquivar a RM com usos futuros é recusado');
select lives_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000004', '09:00', '09:30', 2) $$,
                'sala 3: uso na vaga 2');
select lives_ok($$ update agenda.resources set capacity = 2 where id = 'e3100000-0000-4000-8000-000000000004' $$,
                'sala 3: reduzir de 3 para 2 vagas com uso na vaga 2 é aceito (a vaga 2 ainda cabe)');
select lives_ok($$ update agenda.resources set active = false where id = 'e3100000-0000-4000-8000-000000000005' $$,
                'desativar recurso sem usos futuros é aceito');

/* ===================== G. Marca de origem na ocupação e nos itens ===================== */
create function pg_temp.erro(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'sem erro';
exception when others then
  return sqlstate;
end $f$;

select throws_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '18:00', '18:30', p_marca := null) $$,
                 '42501', 'Itens e ocupação da agenda só mudam pelas funções da agenda',
                 'ocupação sem a marca de origem é recusada (até para o dono do banco)');
select throws_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '18:00', '18:30', p_motivo := null) $$,
                 '42501', null, 'marca de emergência (sql) sem motivo é recusada');
select throws_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '18:00', '18:30', p_marca := 'hacker') $$,
                 '22023', null, 'marca de origem desconhecida é recusada');
select lives_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '18:00', '18:30', p_marca := 'painel') $$,
                'com a marca de uma função (painel), a ocupação é gravada');
select ok((select count(*) from agenda.audit_log where action = 'occupancy_insert' and origin = 'sql'
             and reason_code = 'teste_estrutura') > 0,
          'cada ocupação gravada pela marca de emergência fica na auditoria (com o motivo)');
select throws_ok($$ select pg_temp.marca(null); delete from agenda.occupancy where kind = 'ocupado' $$,
                 '42501', null, 'apagar ocupação sem a marca é recusado');
-- (3.3: com as conferências adiadas do COMMIT pendentes, o próprio banco recusa o TRUNCATE antes da guarda: 55006)
select ok((select e from pg_temp.erro($$ select pg_temp.marca(null); truncate agenda.occupancy $$) e) in ('42501', '55006'),
          'TRUNCATE na ocupação sem a marca é recusado');
select lives_ok($$ select pg_temp.marca(null);
                   delete from public.clinic_blocks where resource_id = 'e3100000-0000-4000-8000-000000000001'
                     and starts_at = pg_temp.t('16:00') $$,
                'apagar o bloqueio dono do fechamento apaga o fechamento junto (cascata), sem marca');
select pg_temp.marca('sql', 'teste_estrutura');
select is((select count(*)::int from agenda.occupancy o where o.kind = 'bloqueio'
             and not exists (select 1 from public.clinic_blocks b where b.id = o.block_id)), 0,
          'nenhum fechamento ficou sem o bloqueio dono');
select throws_ok($$ select pg_temp.marca(null);
                    update agenda.appointment_items set status = 'cancelled' where clinic_id = 'c3100000-0000-4000-8000-000000000001' $$,
                 '42501', null, 'mudar a situação de um item sem a marca é recusado');

/* ===================== H. Itens: restrições conferidas no COMMIT ===================== */

insert into public.appointment_requests (id, clinic_id, place_source, place_name, preferred_date, patient_name, patient_phone, consent)
values ('b3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 'imed', 'Clínica da Estrutura',
        pg_temp.dia(), 'Paciente do Pacote', '11999990032', true);
insert into agenda.appointment_items (request_id, clinic_id, seq, procedure_id, exam_code, starts_at, ends_at, local_start, tz, groups, status)
values ('b3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 1,
        'f3100000-0000-4000-8000-000000000001', 'usg', pg_temp.t('07:00'), pg_temp.t('07:30'), pg_temp.dia() + '07:00'::time,
        'America/Sao_Paulo', '{1}', 'confirmed');
select throws_ok($$ insert into agenda.appointment_items (request_id, clinic_id, seq, procedure_id, exam_code, starts_at, ends_at,
                                                         local_start, tz, groups, status)
                    values ('b3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 1,
                            'f3100000-0000-4000-8000-000000000001', 'usg', pg_temp.t('08:00'), pg_temp.t('08:30'),
                            pg_temp.dia() + '08:00'::time, 'America/Sao_Paulo', '{1}', 'confirmed');
                    set constraints agenda.items_seq_uq immediate $$,
                 '23505', null, 'dois itens com a mesma ordem no pedido: recusado (no COMMIT)');
select throws_ok($$ insert into agenda.appointment_items (request_id, clinic_id, seq, procedure_id, exam_code, starts_at, ends_at,
                                                         local_start, tz, groups, status)
                    values ('b3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 2,
                            'f3100000-0000-4000-8000-000000000001', 'usg', pg_temp.t('07:15'), pg_temp.t('07:45'),
                            pg_temp.dia() + '07:15'::time, 'America/Sao_Paulo', '{1}', 'confirmed');
                    set constraints agenda.items_patient_no_overlap immediate $$,
                 '23P01', null, 'o mesmo paciente em dois exames ao mesmo tempo: recusado (no COMMIT)');
select lives_ok($$ insert into agenda.appointment_items (request_id, clinic_id, seq, procedure_id, exam_code, starts_at, ends_at,
                                                        local_start, tz, groups, status)
                   values ('b3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 2,
                           'f3100000-0000-4000-8000-000000000001', 'usg', pg_temp.t('07:30'), pg_temp.t('08:00'),
                           pg_temp.dia() + '07:30'::time, 'America/Sao_Paulo', '{1}', 'confirmed');
                   set constraints agenda.items_seq_uq, agenda.items_patient_no_overlap immediate $$,
                'segundo exame encostado no primeiro (ordem 2): aceito');
set constraints all deferred;
select throws_ok($$ insert into agenda.appointment_items (request_id, clinic_id, seq, procedure_id, exam_code, starts_at, ends_at,
                                                         local_start, tz, groups, status)
                    values ('b3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 3,
                            'f3100000-0000-4000-8000-000000000001', 'usg', pg_temp.t('09:00'), pg_temp.t('09:00'),
                            pg_temp.dia() + '09:00'::time, 'America/Sao_Paulo', '{1}', 'confirmed') $$,
                 '23514', null, 'item com fim igual ao início é recusado');
select throws_ok($$ insert into agenda.appointment_items (request_id, clinic_id, seq, procedure_id, exam_code, starts_at, ends_at,
                                                         local_start, tz, groups, status)
                    values ('b3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 3,
                            'f3100000-0000-4000-8000-000000000002', 'usg', pg_temp.t('09:00'), pg_temp.t('09:30'),
                            pg_temp.dia() + '09:00'::time, 'America/Sao_Paulo', '{1}', 'confirmed') $$,
                 '23503', null, 'item com procedimento de outra clínica é recusado');
select throws_ok($$ insert into agenda.appointment_items (request_id, clinic_id, seq, procedure_id, exam_code, starts_at, ends_at,
                                                         local_start, tz, groups, status)
                    values ('b3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 3,
                            'f3100000-0000-4000-8000-000000000001', 'usg', pg_temp.t('09:00'), pg_temp.t('09:30'),
                            pg_temp.dia() + '09:00'::time, 'America/Sao_Paulo', '{1}', 'pending') $$,
                 '23514', null, 'item não tem a situação "pending" (só o cabeçalho tem)');

/* ===================== I. Trilhas: só acrescentam ===================== */

insert into agenda.status_history (request_id, to_status, actor_kind, origin, reason_code)
values ('b3100000-0000-4000-8000-000000000001', 'confirmed', 'sql', 'sql', 'teste_estrutura');
select throws_ok($$ update agenda.status_history set to_status = 'cancelled' $$, 'P0001', null,
                 'histórico: UPDATE recusado');
select throws_ok($$ delete from agenda.status_history $$, 'P0001', null, 'histórico: DELETE recusado');
select throws_ok($$ truncate agenda.status_history $$, 'P0001', null, 'histórico: TRUNCATE recusado');
select throws_ok($$ update agenda.audit_log set reason_code = 'outro_motivo' $$, 'P0001', null, 'auditoria: UPDATE recusado');
select throws_ok($$ delete from agenda.audit_log $$, 'P0001', null, 'auditoria: DELETE recusado');
select lives_ok($$ select set_config('imed.retencao', 'on', true);
                   delete from agenda.status_history where reason_code = 'teste_estrutura';
                   select set_config('imed.retencao', '', true) $$,
                'a rotina de retenção (dono do banco, imed.retencao = on) apaga');
insert into agenda.access_log (day, user_id, clinic_id, fn, request_id, scope)
values (current_date, 'a3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 'agenda_request_detail',
        'b3100000-0000-4000-8000-000000000001', 'detalhe');
select lives_ok($$ insert into agenda.access_log (day, user_id, clinic_id, fn, request_id, scope)
                   values (current_date, 'a3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001',
                           'agenda_request_detail', 'b3100000-0000-4000-8000-000000000001', 'detalhe')
                   on conflict on constraint access_log_uq
                   do update set reads = agenda.access_log.reads + 1, last_at = now() $$,
                'registro de acesso: a mesma leitura no mesmo dia soma (upsert)');
select is((select reads from agenda.access_log where fn = 'agenda_request_detail'), 2, 'registro de acesso: reads = 2');
select throws_ok($$ update agenda.access_log set fn = 'outra_funcao' $$, 'P0001', null,
                 'registro de acesso: mudar outra coluna é recusado');
select throws_ok($$ delete from agenda.access_log $$, 'P0001', null, 'registro de acesso: DELETE recusado');

/* ===================== J. Outras tabelas ===================== */

insert into agenda.procedure_requirements (id, procedure_id, clinic_id, group_no, resource_kind) values
  ('d3100000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 1, 'equipamento'),
  ('d3100000-0000-4000-8000-000000000002', 'f3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001', 2, 'sala');
insert into agenda.requirement_options (requirement_id, procedure_id, clinic_id, resource_id)
values ('d3100000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001',
        'e3100000-0000-4000-8000-000000000001');
select throws_ok($$ insert into agenda.requirement_options (requirement_id, procedure_id, clinic_id, resource_id)
                    values ('d3100000-0000-4000-8000-000000000002', 'f3100000-0000-4000-8000-000000000001',
                            'c3100000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001') $$,
                 '23505', null, 'o mesmo recurso em dois grupos do mesmo procedimento é recusado (grupos disjuntos)');
select throws_ok($$ insert into agenda.requirement_options (requirement_id, procedure_id, clinic_id, resource_id)
                    values ('d3100000-0000-4000-8000-000000000002', 'f3100000-0000-4000-8000-000000000001',
                            'c3100000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000006') $$,
                 '23503', null, 'alternativa com recurso de outra clínica é recusada');
select throws_ok($$ insert into agenda.procedures (clinic_id, exam_code, name, duration_min)
                    values ('c3100000-0000-4000-8000-000000000001', 'usg', 'Duração quebrada', 7) $$,
                 '23514', null, 'duração do procedimento tem de ser múltipla de 5');
select throws_ok($$ insert into agenda.procedures (clinic_id, exam_code, name)
                    values ('c3100000-0000-4000-8000-000000000001', 'usg', 'Sem duração') $$,
                 '23502', null, 'procedimento sem duração é recusado (não há valor padrão)');
select throws_ok($$ insert into agenda.procedures (clinic_id, exam_code, name, duration_min)
                    values ('c3100000-0000-4000-8000-000000000001', 'usg', 'ULTRASSOM DE TESTE', 20) $$,
                 '23505', null, 'dois procedimentos com o mesmo nome na clínica são recusados');
select throws_ok($$ insert into agenda.holidays (scope, uf, day, name, source)
                    values ('nacional', 'SP', pg_temp.dia(), 'Feriado errado', 'Lei de teste') $$,
                 '23514', null, 'feriado nacional não tem UF');
insert into agenda.holidays (scope, day, name, source) values ('nacional', pg_temp.dia(), 'Feriado de teste', 'Lei de teste');
select throws_ok($$ insert into agenda.holidays (scope, day, name, source)
                    values ('nacional', pg_temp.dia(), 'Feriado repetido', 'Lei de teste') $$,
                 '23505', null, 'o mesmo feriado nacional duas vezes é recusado (nulos contam como iguais)');
insert into agenda.conflicts (clinic_id, kind, item_id)
select 'c3100000-0000-4000-8000-000000000001', 'grade_mudou', i.id from agenda.appointment_items i where i.seq = 1 limit 1;
select throws_ok($$ insert into agenda.conflicts (clinic_id, kind, item_id)
                    select 'c3100000-0000-4000-8000-000000000001', 'grade_mudou', i.id from agenda.appointment_items i
                    where i.seq = 1 limit 1 $$,
                 '23505', null, 'no máximo um conflito aberto por tipo e item');
select throws_ok($$ insert into agenda.procedure_pair_rules (clinic_id, first_procedure, second_procedure, rule)
                    values ('c3100000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000001',
                            'f3100000-0000-4000-8000-000000000001', 'ordem') $$,
                 '23514', null, 'regra de pacote não liga um procedimento a ele mesmo');
insert into agenda.unit_settings (clinic_id) values ('c3100000-0000-4000-8000-000000000001');
select is((select concat_ws('|', step_min, min_notice_min, max_advance_days, hold_minutes, payment_grace_min,
                            patient_cancel_until_min, patient_reschedule_until_min, checkin_before_min, no_show_after_min,
                            patient_gap_min, closes_on_holidays::text, payment_mode)
           from agenda.unit_settings where clinic_id = 'c3100000-0000-4000-8000-000000000001'),
          '5|120|90|10|5|0|120|120|15|0|true|no_local', 'configuração da unidade nasce com os padrões da arquitetura');
-- (4.3: os pedidos inseridos acima já subiram a versão pelo gatilho appointment_requests_aviso; conta a partir daí)
select set_config('teste.v0', coalesce((select version from agenda.clinic_versions where clinic_id = 'c3100000-0000-4000-8000-000000000001'), 0)::text, true);
select is(private.agenda_touch('c3100000-0000-4000-8000-000000000001'), current_setting('teste.v0')::bigint + 1, 'agenda_touch: sobe a versão da clínica (a primeira = 1)');
select is(private.agenda_touch('c3100000-0000-4000-8000-000000000001'), current_setting('teste.v0')::bigint + 2, 'agenda_touch: cada chamada sobe a versão');

/* ===================== K. Restrições novas nas tabelas de hoje ===================== */

select throws_ok($$ update public.clinics set agenda_online_since = now(), agenda_mode = 'nativa'
                    where id = 'c3100000-0000-4000-8000-000000000001' $$,
                 '23514', null, 'venda online sem o fuso confirmado é recusada (mesmo pela marca de emergência)');
select throws_ok($$ update public.appointment_requests set hold_expires_at = now() + interval '10 minutes'
                    where id = 'b3100000-0000-4000-8000-000000000001' $$,
                 '23514', null, 'prazo de reserva em pedido que não é reserva é recusado');
select throws_ok($$ update public.appointment_requests set slot_start = pg_temp.t('10:00'), slot_end = pg_temp.t('09:00')
                    where id = 'b3100000-0000-4000-8000-000000000001' $$,
                 '23514', null, 'fim do agendamento antes do início é recusado');
select throws_ok($$ insert into public.clinic_schedules (clinic_id, weekday, start_time, end_time, valid_from, valid_to)
                    values ('c3100000-0000-4000-8000-000000000001', 1, '08:00', '12:00', pg_temp.dia(), pg_temp.dia() - 1) $$,
                 '23514', null, 'regra de horário com validade invertida é recusada');
select throws_ok($$ insert into public.clinic_schedules (clinic_id, weekday, start_time, end_time, resource_id)
                    values ('c3100000-0000-4000-8000-000000000002', 1, '08:00', '12:00', 'e3100000-0000-4000-8000-000000000001') $$,
                 '23503', null, 'regra de horário com recurso de outra clínica é recusada');
select lives_ok($$ insert into public.clinic_schedules (clinic_id, weekday, start_time, end_time, resource_id, kind, label)
                   values ('c3100000-0000-4000-8000-000000000001', 1, '12:00', '13:00', 'e3100000-0000-4000-8000-000000000001',
                           'pausa', 'Almoço') $$,
                'pausa de almoço de um recurso (regra nova) é aceita');
select throws_ok($$ insert into public.clinic_blocks (clinic_id, starts_at, ends_at, kind)
                    values ('c3100000-0000-4000-8000-000000000001', pg_temp.t('08:00'), pg_temp.t('09:00'), 'ferias') $$,
                 '23514', null, 'tipo de bloqueio desconhecido é recusado');

/* ===================== L. Revisão da 3.1: vagas, donos, capacidade, replica, auditoria e formatos ===================== */
select pg_temp.marca('sql', 'teste_estrutura');
create function pg_temp.ocupado_cru(p_rec uuid, p_seats int4range, p_de text, p_ate text) returns void language sql as $$
  insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, busy_id)
  values ('c3100000-0000-4000-8000-000000000001', p_rec, 'ocupado', p_seats, pg_temp.faixa(p_de, p_ate),
          (select id from agenda.busy_marks limit 1)) $$;
select throws_ok($$ select pg_temp.ocupado_cru('e3100000-0000-4000-8000-000000000001', 'empty', '10:00', '11:00') $$,
                 '23514', null, 'vaga vazia é recusada (não fura a exclusão)');
select throws_ok($$ select pg_temp.ocupado_cru('e3100000-0000-4000-8000-000000000001', '[2,)', '10:00', '11:00') $$,
                 '23514', null, 'vaga sem limite em cima é recusada');
select throws_ok($$ select pg_temp.ocupado_cru('e3100000-0000-4000-8000-000000000001', '(,1)', '10:00', '11:00') $$,
                 '23514', null, 'vaga sem limite embaixo é recusada');
select throws_ok($$ insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, block_id)
                    select 'c3100000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000002', 'bloqueio',
                           int4range(1, 2), pg_temp.faixa('19:00', '20:00'), b.id from public.clinic_blocks b limit 1 $$,
                 '23514', null, 'fechamento que não cobre todas as vagas é recusado');
select throws_ok($$ insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, block_id, item_id)
                    select 'c3100000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000002', 'bloqueio',
                           int4range(1, 51), pg_temp.faixa('19:00', '20:00'), b.id, (select id from agenda.appointment_items limit 1)
                    from public.clinic_blocks b limit 1 $$,
                 '23514', null, 'fechamento com item_id é recusado (sumiria na cascata do pedido)');
select throws_ok($$ insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, busy_id, item_id)
                    values ('c3100000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000002', 'ocupado',
                            int4range(1, 2), pg_temp.faixa('19:00', '20:00'), (select id from agenda.busy_marks limit 1),
                            (select id from agenda.appointment_items limit 1)) $$,
                 '23514', null, '"ocupado" com item_id é recusado');
select throws_ok($$ insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, busy_id, group_no)
                    values ('c3100000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000002', 'ocupado',
                            int4range(1, 2), pg_temp.faixa('19:00', '20:00'), (select id from agenda.busy_marks limit 1), 1) $$,
                 '23514', null, '"ocupado" com group_no é recusado');
select throws_ok($$ insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, item_id, group_no)
                    select o.clinic_id, 'e3100000-0000-4000-8000-000000000004', 'agendamento', int4range(1, 2),
                           pg_temp.faixa('20:00', '20:30'), o.item_id, o.group_no
                    from agenda.occupancy o where o.kind = 'agendamento' and o.active limit 1 $$,
                 '23505', null, 'no máximo um uso ativo por grupo do item');
select throws_ok($$ select pg_temp.bloqueio('e3100000-0000-4000-8000-000000000004', '09:10', '09:20') $$,
                 '23P01', null, 'fechamento que só cruza um uso da vaga 2 é recusado');
insert into public.clinic_blocks (id, clinic_id, starts_at, ends_at)
values ('93100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000002', pg_temp.t('19:00'), pg_temp.t('20:00'));
select throws_ok($$ insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, block_id)
                    values ('c3100000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001', 'bloqueio',
                            int4range(1, 51), pg_temp.faixa('19:00', '20:00'), '93100000-0000-4000-8000-000000000001') $$,
                 '23503', 'insert or update on table "occupancy" violates foreign key constraint "occupancy_resource_fk"',
                 'fechamento com recurso de outra clínica: recusado pela chave estrangeira composta');
-- Capacidade: reativar um uso da vaga 2 depois de reduzir a capacidade para 1 é recusado.
insert into agenda.resources (id, clinic_id, kind, name, capacity)
values ('e3100000-0000-4000-8000-000000000007', 'c3100000-0000-4000-8000-000000000001', 'sala', 'Sala 7', 2);
select pg_temp.uso('e3100000-0000-4000-8000-000000000007', '09:00', '09:30', 2, p_ativo := false);
update agenda.resources set capacity = 1 where id = 'e3100000-0000-4000-8000-000000000007';
select throws_ok($$ update agenda.occupancy set active = true, released_at = null
                    where resource_id = 'e3100000-0000-4000-8000-000000000007' $$,
                 '23514', null, 'reativar uso na vaga 2 depois de reduzir a capacidade para 1 é recusado');
select throws_ok($$ set local session_replication_role = replica;
                    select pg_temp.uso('e3100000-0000-4000-8000-000000000002', '12:00', '12:30', 3) $$,
                 '23514', null, 'com session_replication_role = replica, a vaga acima da capacidade continua recusada (ALWAYS)');
select throws_ok($$ set local session_replication_role = replica;
                    select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '21:00', '21:30', p_marca := null) $$,
                 '42501', null, 'com session_replication_role = replica, a guarda de origem continua valendo (ALWAYS)');
select is((select count(*)::int from agenda.audit_log where action = 'occupancy_insert'
             and new_value ->> 'kind' = 'bloqueio' and new_value ->> 'excl_group' = '(,)'), 0,
          'auditoria do fechamento guarda a linha final (grupo [id,id]), registrada depois dos outros gatilhos');
select is((select count(*)::int from agenda.audit_log where action = 'occupancy_insert'
             and (new_value ? 'clinic_id' or new_value ? 'created_at')), 0,
          'auditoria guarda só a lista fixa de campos');
select throws_ok($$ select pg_temp.uso('e3100000-0000-4000-8000-000000000001', '22:00', '22:30', p_motivo := 'tel_11987654321') $$,
                 '22023', null, 'motivo com 4 ou mais algarismos seguidos (telefone, documento) é recusado');
select throws_ok($$ insert into agenda.idempotency (scope, actor, key, fingerprint)
                    values ('agenda_book', '11987654321', gen_random_uuid(), repeat('a', 64)) $$,
                 '23514', null, 'idempotência: quem pediu só como uuid ou hash (nunca telefone)');
insert into agenda.notes (id, clinic_id, request_id, kind, text)
values ('83100000-0000-4000-8000-000000000001', 'c3100000-0000-4000-8000-000000000001',
        'b3100000-0000-4000-8000-000000000001', 'observacao', 'Observação curta');
select throws_ok($$ update agenda.notes set deleted_at = now() where id = '83100000-0000-4000-8000-000000000001' $$,
                 '23514', null, 'nota apagada sem tirar o texto é recusada (apagar tira o texto de verdade)');
select throws_ok($$ insert into agenda.notes (clinic_id, request_id, kind, text)
                    values ('c3100000-0000-4000-8000-000000000002', 'b3100000-0000-4000-8000-000000000001', 'observacao', 'Outra') $$,
                 '23503', null, 'nota de uma clínica não aponta para pedido de outra');
-- Apagar o pedido pelo SQL: fica na auditoria; os itens saem em cascata sem auditoria própria.
delete from public.appointment_requests where id = 'b3100000-0000-4000-8000-000000000001';
select is((select count(*)::int from agenda.audit_log where object_id = 'b3100000-0000-4000-8000-000000000001'
             and action = 'pedido_apagado_sql'), 1, 'pedido apagado pelo SQL fica na auditoria');
select is((select count(*)::int from agenda.appointment_items where request_id = 'b3100000-0000-4000-8000-000000000001')
          + (select count(*)::int from agenda.audit_log where action = 'appointment_items_delete'), 0,
          'os itens do pedido saem em cascata, sem passar pela guarda (a cascata fica registrada no pedido)');

select * from finish();
rollback;
