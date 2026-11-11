-- Bloqueios e horários (iMed Agenda, fase 3.2; arquitetura §2.4, §3.2 e §13, teste 5 "Equipamento indisponível",
-- a parte de HORÁRIOS; o "bloquear mesmo assim" e o bloqueio × marcação simultâneos vêm com a marcação, na 3.3):
--   - manutenção na RM-1: some todo horário que só depende dela; o procedimento com alternativa (RM-2) continua;
--   - bloqueio da unidade inteira: fecha todos os recursos (uma linha de fechamento por recurso na ocupação);
--   - bloqueio sobre agendamento ou "ocupado": has_appointments com a lista e NADA gravado;
--   - quem bloqueia (dona e recepção sim; outra clínica não); período e tipo inválidos;
--   - remover = remoção lógica e os fechamentos liberados; os horários voltam;
--   - add_my_block e remove_my_block (as funções de hoje): na agenda nova, bloqueio de unidade e remoção lógica (a
--     leitura direta não mostra o removido); na clínica do modo de hoje, EXATAMENTE como antes (grava e apaga).
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(37);
delete from agenda.holidays where scope = 'nacional';  -- sem os da migração feriados_nacionais: o teste lança os dele (dias relativos a hoje)

create function pg_temp.entrar(p_papel text, p_usuario uuid default null, p_email text default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_papel = 'postgres' then ''
         else jsonb_strip_nulls(jsonb_build_object(
                'role', p_papel, 'sub', p_usuario, 'email', p_email,
                'aud', case when p_usuario is not null then 'authenticated' end,
                'amr', case when p_usuario is not null then '[{"method": "otp", "timestamp": 1}]'::jsonb end))::text
    end, true);
  perform set_config('role', p_papel, true);
end $$;
create function pg_temp.dona() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3320000-0000-4000-8000-000000000001', 'dona.bloqueio@exemplo.test') $$;
create function pg_temp.staff() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3320000-0000-4000-8000-000000000002', 'staff.bloqueio@exemplo.test') $$;
create function pg_temp.outra() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3320000-0000-4000-8000-000000000003', 'outra.bloqueio@exemplo.test') $$;
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.horas(p_proc text) returns text[] language sql stable as $$
  select coalesce(array_agg(to_char(s.slot_start at time zone 'America/Sao_Paulo', 'HH24:MI') order by s.slot_start), '{}')
  from private.agenda_free_starts('c3320000-0000-4000-8000-000000000001', pg_temp.id(p_proc), pg_temp.dia(), pg_temp.dia(), now()) s $$;
create function pg_temp.proc(p_nome text, variadic p_recursos text[]) returns jsonb language sql as $$
  select public.agenda_procedure_save('c3320000-0000-4000-8000-000000000001', jsonb_build_object(
    'exam_code', 'rm', 'name', p_nome, 'duration_min', 30, 'step_min', 30,
    'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento',
      'options', (select jsonb_agg(jsonb_build_object('resource_id', pg_temp.id(r))) from unnest(p_recursos) r))))) $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from (values ('a3320000-0000-4000-8000-000000000001'::uuid, 'dona.bloqueio@exemplo.test'),
             ('a3320000-0000-4000-8000-000000000002'::uuid, 'staff.bloqueio@exemplo.test'),
             ('a3320000-0000-4000-8000-000000000003'::uuid, 'outra.bloqueio@exemplo.test')) u (id, email);
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua do Bloqueio, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values ('c3320000-0000-4000-8000-000000000001'::uuid, 'Clínica do Bloqueio', 1),
             ('c3320000-0000-4000-8000-000000000002'::uuid, 'Clínica do Bloqueio Antigo', 2)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  ('c3320000-0000-4000-8000-000000000001', 'a3320000-0000-4000-8000-000000000001', 'owner'),
  ('c3320000-0000-4000-8000-000000000001', 'a3320000-0000-4000-8000-000000000002', 'staff'),
  ('c3320000-0000-4000-8000-000000000002', 'a3320000-0000-4000-8000-000000000003', 'owner');
insert into agenda.holidays (scope, day, name, source)
values ('nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949');

select pg_temp.dona();
select public.agenda_unit_save('c3320000-0000-4000-8000-000000000001',
         jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0));
select set_config('teste.rm1', public.agenda_resource_save('c3320000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "RM-1"}') ->> 'id', true);
select set_config('teste.rm2', public.agenda_resource_save('c3320000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "RM-2"}') ->> 'id', true);
select set_config('teste.pa', pg_temp.proc('Ressonância só na RM-1', 'rm1') ->> 'id', true);
select set_config('teste.pb', pg_temp.proc('Ressonância na RM-1 ou RM-2', 'rm1', 'rm2') ->> 'id', true);
select public.agenda_rules_set('c3320000-0000-4000-8000-000000000001', null,
         jsonb_build_array(jsonb_build_object('weekday', extract(dow from pg_temp.dia())::integer, 'start', '08:00', 'end', '12:00')));
select pg_temp.entrar('postgres');
select is(cardinality(pg_temp.horas('pa')) || ' ' || cardinality(pg_temp.horas('pb')), '8 8', 'antes: 8 horários em cada (08:00 a 11:30)');

/* ===================== Manutenção num aparelho ===================== */
select pg_temp.dona();
select is(public.agenda_block_add('c3320000-0000-4000-8000-000000000001', pg_temp.id('rm1'), pg_temp.t('08:00'), pg_temp.t('10:00'),
                                  'manutencao', 'Troca de bobina') ->> 'status', 'ok', 'manutenção na RM-1, 08:00–10:00');
select pg_temp.entrar('postgres');
select is(pg_temp.horas('pa'), array['10:00', '10:30', '11:00', '11:30'], 'só na RM-1: some tudo das 08:00 às 10:00');
select is(cardinality(pg_temp.horas('pb')), 8, 'com a alternativa RM-2: continua tudo');
select is((select count(*)::integer from agenda.occupancy o join public.clinic_blocks b on b.id = o.block_id
           where b.clinic_id = 'c3320000-0000-4000-8000-000000000001' and o.active and o.kind = 'bloqueio'), 1,
          'uma linha de fechamento (só a RM-1)');

/* ===================== Bloqueio da unidade inteira ===================== */
select pg_temp.staff();
select is(public.agenda_block_add('c3320000-0000-4000-8000-000000000001', null, pg_temp.t('11:00'), pg_temp.t('12:00')) ->> 'status', 'ok',
          'a recepção bloqueia a unidade inteira, 11:00–12:00');
select pg_temp.entrar('postgres');
select is(pg_temp.horas('pb'), array['08:00', '08:30', '09:00', '09:30', '10:00', '10:30'], 'some 11:00 e 11:30 de todos');
select is((select count(*)::integer from agenda.occupancy o
           where o.block_id = (select id from public.clinic_blocks where clinic_id = 'c3320000-0000-4000-8000-000000000001'
                                 and resource_id is null) and o.active), 2,
          'bloqueio de unidade: um fechamento em cada recurso');

/* ===================== Bloqueio sobre agendamento ===================== */
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_bloqueio', true);
insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date, patient_name,
                                         patient_phone, consent, status, slot_start, slot_end, uses_resources)
values ('b3320000-0000-4000-8000-000000000001', 'c3320000-0000-4000-8000-000000000001', 'imed', 'Clínica do Bloqueio', 'rm',
        pg_temp.dia(), 'Paciente do Bloqueio', '11999990033', true, 'confirmed', pg_temp.t('10:00'), pg_temp.t('10:30'), true);
insert into agenda.appointment_items (id, request_id, clinic_id, seq, procedure_id, exam_code, starts_at, ends_at, local_start, tz, groups, status)
values ('d3320000-0000-4000-8000-000000000001', 'b3320000-0000-4000-8000-000000000001', 'c3320000-0000-4000-8000-000000000001', 1,
        pg_temp.id('pb'), 'rm', pg_temp.t('10:00'), pg_temp.t('10:30'), pg_temp.dia() + '10:00'::time, 'America/Sao_Paulo', '{1}', 'confirmed');
insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, item_id, group_no)
values ('c3320000-0000-4000-8000-000000000001', pg_temp.id('rm2'), 'agendamento', int4range(1, 2),
        tstzrange(pg_temp.t('10:00'), pg_temp.t('10:30'), '[)'), 'd3320000-0000-4000-8000-000000000001', 1);
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
select is((select count(*)::integer from pg_temp.horas('pb') h where h && array['10:00']), 1,
          'o das 10:00 ainda aparece (a RM-1 está livre às 10:00)');
select pg_temp.dona();
select is(public.agenda_block_add('c3320000-0000-4000-8000-000000000001', pg_temp.id('rm2'), pg_temp.t('09:30'), pg_temp.t('10:30'), 'manutencao')
            - 'busy',
          jsonb_build_object('status', 'has_appointments', 'items', jsonb_build_array(jsonb_build_object(
            'item_id', 'd3320000-0000-4000-8000-000000000001', 'request_id', 'b3320000-0000-4000-8000-000000000001',
            'starts_at', pg_temp.t('10:00')))),
          'manutenção sobre um agendamento: has_appointments com a lista (só ids e horário)');
select is(public.add_my_block('c3320000-0000-4000-8000-000000000001', pg_temp.t('10:00'), pg_temp.t('10:30')), 'has_appointments',
          'add_my_block (o de hoje) sobre o agendamento: has_appointments');
select pg_temp.entrar('postgres');
select is((select count(*)::integer from public.clinic_blocks where clinic_id = 'c3320000-0000-4000-8000-000000000001'), 2,
          '... e nada foi gravado (continuam 2 bloqueios)');

/* ===================== Quem bloqueia e o que é inválido ===================== */
select pg_temp.outra();
select is(public.agenda_block_add('c3320000-0000-4000-8000-000000000001', null, pg_temp.t('08:00'), pg_temp.t('09:00')) ->> 'status',
          'forbidden', 'dona de outra clínica: forbidden');
select is(public.add_my_block('c3320000-0000-4000-8000-000000000001', pg_temp.t('08:00'), pg_temp.t('09:00')), 'forbidden',
          'add_my_block de outra clínica: forbidden (como antes)');
select pg_temp.entrar('anon');
select throws_ok($$select public.agenda_block_add('c3320000-0000-4000-8000-000000000001', null, now() + interval '1 day', now() + interval '2 days')$$,
                 '42501', null, 'visitante não executa agenda_block_add');
select pg_temp.dona();
select is(public.agenda_block_add('c3320000-0000-4000-8000-000000000001', null, pg_temp.t('09:00'), pg_temp.t('08:00')) ->> 'status',
          'invalid_period', 'fim antes do início: invalid_period');
select is(public.agenda_block_add('c3320000-0000-4000-8000-000000000001', null, now() - interval '2 days', now() - interval '1 day') ->> 'status',
          'invalid_period', 'bloqueio todo no passado: invalid_period');
select is(public.agenda_block_add('c3320000-0000-4000-8000-000000000001', null, pg_temp.t('08:00'), pg_temp.t('09:00'), 'ferias') ->> 'status',
          'invalid', 'tipo desconhecido: invalid');
select is(public.agenda_block_add('c3320000-0000-4000-8000-000000000001', gen_random_uuid(), pg_temp.t('08:00'), pg_temp.t('09:00')) ->> 'status',
          'not_found', 'recurso de fora: not_found');

/* ===================== Remover ===================== */
select set_config('teste.manut', (select b ->> 'id' from jsonb_array_elements(public.agenda_blocks('c3320000-0000-4000-8000-000000000001') -> 'blocks') b
                                   where (b ->> 'resource_id')::uuid = pg_temp.id('rm1')), true);
select is(public.agenda_block_remove(pg_temp.id('manut')) ->> 'status', 'ok', 'a dona tira a manutenção da RM-1');
select pg_temp.entrar('postgres');
select is(pg_temp.horas('pa'), array['08:00', '08:30', '09:00', '09:30', '10:00', '10:30'], 'os horários da RM-1 voltam');
select is((select (removed_at is not null)::text || ' ' || (removed_by = 'a3320000-0000-4000-8000-000000000001')::text
           from public.clinic_blocks where id = pg_temp.id('manut')), 'true true', 'remoção lógica: o bloqueio fica, com quem removeu');
select is((select string_agg(active::text || ' ' || release_reason, ',') from agenda.occupancy where block_id = pg_temp.id('manut')),
          'false removido', 'o fechamento é liberado na ocupação (removido)');
select pg_temp.dona();
select is(public.agenda_block_remove(pg_temp.id('manut')) ->> 'status', 'not_found', 'remover de novo: not_found');

/* ===================== As funções de hoje na agenda nova ===================== */
select pg_temp.staff();
select is(public.add_my_block('c3320000-0000-4000-8000-000000000001', pg_temp.t('08:00'), pg_temp.t('08:30'), 'Reunião'), 'ok',
          'add_my_block na agenda nova: ok');
select pg_temp.entrar('postgres');
select set_config('teste.antigo', (select id::text from public.clinic_blocks where clinic_id = 'c3320000-0000-4000-8000-000000000001'
                                    and starts_at = pg_temp.t('08:00') and resource_id is null), true);
select is((select count(*)::integer from agenda.occupancy where block_id = pg_temp.id('antigo') and active), 2,
          '... vira bloqueio da unidade (fechamento nos 2 recursos)');
select ok(not '08:00' = any (pg_temp.horas('pb')), '... e o 08:00 some');
select pg_temp.staff();
select is(jsonb_array_length(public.agenda_blocks('c3320000-0000-4000-8000-000000000001') -> 'blocks'), 2,
          'a recepção lê os 2 bloqueios ativos, não o removido (pela função agenda_blocks; a leitura direta fecha na 4.2)');
select is(public.remove_my_block(pg_temp.id('antigo')), 'ok', 'remove_my_block na agenda nova: ok');
select is(jsonb_array_length(public.agenda_blocks('c3320000-0000-4000-8000-000000000001') -> 'blocks'), 1,
          'a lista de bloqueios não mostra o recém-removido');
select is(public.remove_my_block(pg_temp.id('antigo')), 'not_found', 'remover de novo: not_found (o painel de hoje aceita)');
select pg_temp.entrar('postgres');
select ok(exists (select 1 from public.clinic_blocks where id = pg_temp.id('antigo') and removed_at is not null)
          and '08:00' = any (pg_temp.horas('pb')), 'remoção lógica, e o 08:00 volta');

/* ===================== Clínica no modo de hoje: igual a antes ===================== */
select pg_temp.outra();
select is(public.add_my_block('c3320000-0000-4000-8000-000000000002', pg_temp.t('08:00'), pg_temp.t('09:00'), 'Feriado da cidade'), 'ok',
          'modo de hoje: add_my_block grava');
select pg_temp.entrar('postgres');
select set_config('teste.velho', (select id::text from public.clinic_blocks where clinic_id = 'c3320000-0000-4000-8000-000000000002'), true);
select is((select kind || ' ' || coalesce(reason, '-') || ' ' || (resource_id is null) from public.clinic_blocks where id = pg_temp.id('velho')),
          'bloqueio Feriado da cidade true', '... um bloqueio de unidade, como antes');
select is((select count(*)::integer from agenda.occupancy where block_id = pg_temp.id('velho')), 0, '... sem ocupação (não há recursos)');
select pg_temp.outra();
select is(public.remove_my_block(pg_temp.id('velho')), 'ok', 'modo de hoje: remove_my_block');
select pg_temp.entrar('postgres');
select is((select count(*)::integer from public.clinic_blocks where id = pg_temp.id('velho')), 0, '... apaga, como antes');

select * from finish();
rollback;
