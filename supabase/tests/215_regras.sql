-- Regras e intervalos do motor de horários (iMed Agenda, fase 3.2; arquitetura §4, os 15 itens de regra):
--   - janelas 'abre' da unidade, almoço ('pausa'), passo do procedimento, regra só de um procedimento;
--   - uso ocupado no recurso, alternativas (USG-1 ou USG-2), capacidade por vagas (sala com 2), dois grupos (sala e
--     profissional, com deslocamento), "chegadas" com bloco alinhado de 60 min;
--   - preparo e higienização precisam caber no horário do recurso (escala própria do aparelho);
--   - feriados nacional, da UF e da cidade (pelo CNES), abertura em feriado, "não fecha em feriado", conferência de
--     feriados (holidays_checked_until) e o último ano de feriados nacionais lançados;
--   - antecedência mínima e máxima; recurso inativo, procedimento arquivado ou sem requisito: sem horário;
--   - validações dos cadastros (horário fora do passo de 5 min, regras que se cruzam, chave desconhecida, recurso em
--     dois grupos, alternativa de outro tipo, nome repetido).
-- Os cadastros são feitos pela dona da clínica (papel authenticated, como o PostgREST); as conferências, pelo motor
-- (private.agenda_free_starts) como postgres. Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(50);
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
  select pg_temp.entrar('authenticated', 'a3200000-0000-4000-8000-000000000001', 'dona.regras@exemplo.test') $$;
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.dow() returns integer language sql stable as $$ select extract(dow from pg_temp.dia())::integer $$;
-- horas livres (hora de São Paulo) de um procedimento no dia do teste, pelo motor
create function pg_temp.horas(p_proc text) returns text[] language sql stable as $$
  select coalesce(array_agg(to_char(s.slot_start at time zone 'America/Sao_Paulo', 'HH24:MI') order by s.slot_start), '{}')
  from private.agenda_free_starts('c3200000-0000-4000-8000-000000000001',
                                  current_setting('teste.' || replace(p_proc, '-', '_'))::uuid, pg_temp.dia(), pg_temp.dia(), now()) s $$;
-- cadastros pela dona; guardam o id em teste.<nome>
create function pg_temp.recurso(p_nome text, p_kind text, p_extra jsonb default '{}') returns text language plpgsql as $$
declare r jsonb;
begin
  r := public.agenda_resource_save('c3200000-0000-4000-8000-000000000001',
         jsonb_build_object('kind', p_kind, 'name', p_nome) || p_extra);
  if r ->> 'status' = 'ok' then perform set_config('teste.' || replace(p_nome, '-', '_'), r ->> 'id', true); end if;
  return r ->> 'status';
end $$;
create function pg_temp.proc(p_nome text, p_def jsonb) returns text language plpgsql as $$
declare r jsonb;
begin
  r := public.agenda_procedure_save('c3200000-0000-4000-8000-000000000001', jsonb_build_object('name', p_nome) || p_def);
  if r ->> 'status' = 'ok' then perform set_config('teste.' || replace(p_nome, '-', '_'), r ->> 'id', true); end if;
  return r ->> 'status';
end $$;
create function pg_temp.opc(p_kind text, variadic p_nomes text[]) returns jsonb language sql stable as $$
  select jsonb_build_object('resource_kind', p_kind,
           'options', (select jsonb_agg(jsonb_build_object('resource_id', current_setting('teste.' || replace(n, '-', '_')))) from unnest(p_nomes) n)) $$;
create function pg_temp.regra(p_ini text, p_fim text, p_kind text default 'abre', p_extra jsonb default '{}') returns jsonb
language sql stable as $$
  select jsonb_build_object('weekday', pg_temp.dow(), 'start', p_ini, 'end', p_fim, 'kind', p_kind) || p_extra $$;
-- "ocupado" (sem paciente) num recurso e vaga, com a marca de emergência do SQL
create function pg_temp.ocupar(p_rec text, p_de text, p_ate text, p_vaga integer default 1) returns void language plpgsql as $$
declare v uuid;
begin
  perform set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_regras', true);
  insert into agenda.busy_marks (clinic_id, starts_at, ends_at, reason_code, created_by)
  values ('c3200000-0000-4000-8000-000000000001', (pg_temp.dia() + p_de::time) at time zone 'America/Sao_Paulo',
          (pg_temp.dia() + p_ate::time) at time zone 'America/Sao_Paulo', 'agenda_propria', gen_random_uuid())
  returning id into v;
  insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, busy_id)
  values ('c3200000-0000-4000-8000-000000000001', current_setting('teste.' || replace(p_rec, '-', '_'))::uuid, 'ocupado',
          int4range(p_vaga, p_vaga + 1),
          tstzrange((pg_temp.dia() + p_de::time) at time zone 'America/Sao_Paulo',
                    (pg_temp.dia() + p_ate::time) at time zone 'America/Sao_Paulo', '[)'), v);
  perform set_config('imed.origin', '', true), set_config('imed.reason', '', true);
end $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a3200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'dona.regras@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now());
insert into public.municipalities (ibge, cnes_code, name, name_key, uf) values (3550308, 355030, 'São Paulo', 'sao paulo', 'SP')
on conflict (ibge) do nothing;
insert into public.establishments (cnes, name, kind, cnes_type, city_ibge) values ('9320001', 'Clínica das Regras', 'imagem', 39, 3550308);
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo, cnes)
values ('c3200000-0000-4000-8000-000000000001', 'Clínica das Regras', 'imagem', 'Rua das Regras, 1', 'São Paulo', 'SP',
        extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false, '9320001');
insert into public.clinic_members (clinic_id, user_id, role) values ('c3200000-0000-4000-8000-000000000001', 'a3200000-0000-4000-8000-000000000001', 'owner');
-- feriado nacional lançado no ano seguinte ao do teste (o motor só vende até o fim do último ano com feriados nacionais)
insert into agenda.holidays (scope, day, name, source)
values ('nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949');

select pg_temp.dona();
select is(public.agenda_unit_save('c3200000-0000-4000-8000-000000000001',
            jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0)) ->> 'status', 'ok',
          'a dona coloca a clínica na agenda nova (unit_settings)');
select is(array[pg_temp.recurso('USG-1', 'equipamento'), pg_temp.recurso('USG-2', 'equipamento'),
                pg_temp.recurso('Sala', 'sala', '{"capacity": 2}'), pg_temp.recurso('Dra', 'profissional'),
                pg_temp.recurso('Chegadas', 'chegadas', '{"capacity": 2}'),
                pg_temp.recurso('RM-1', 'equipamento', '{"setup_min": 10, "cleanup_min": 5}')],
          array['ok', 'ok', 'ok', 'ok', 'ok', 'ok'], 'seis recursos cadastrados');
select is(public.agenda_rules_set('c3200000-0000-4000-8000-000000000001', null,
            jsonb_build_array(pg_temp.regra('08:00', '12:00'), pg_temp.regra('10:00', '10:30', 'pausa', '{"label": "Almoço"}'))) ->> 'status',
          'ok', 'unidade: 08:00–12:00 com almoço 10:00–10:30');
select is(array[
  pg_temp.proc('P1', jsonb_build_object('exam_code', 'usg', 'duration_min', 30, 'step_min', 30, 'requirements', jsonb_build_array(pg_temp.opc('equipamento', 'USG-1')))),
  pg_temp.proc('P2', jsonb_build_object('exam_code', 'usg', 'duration_min', 30, 'step_min', 30, 'requirements', jsonb_build_array(pg_temp.opc('equipamento', 'USG-1', 'USG-2')))),
  pg_temp.proc('P3', jsonb_build_object('exam_code', 'rm', 'duration_min', 30, 'step_min', 30, 'requirements', jsonb_build_array(pg_temp.opc('equipamento', 'RM-1')))),
  pg_temp.proc('P4', jsonb_build_object('exam_code', 'lab', 'duration_min', 15, 'step_min', 15, 'requirements', jsonb_build_array(pg_temp.opc('sala', 'Sala')))),
  pg_temp.proc('P5', jsonb_build_object('exam_code', 'eco', 'duration_min', 30, 'step_min', 30, 'requirements',
     jsonb_build_array(pg_temp.opc('sala', 'Sala'), pg_temp.opc('profissional', 'Dra') || '{"offset_min": 10, "duration_min": 20}'))),
  pg_temp.proc('P6', jsonb_build_object('exam_code', 'lab', 'duration_min', 10, 'step_min', 10, 'requirements',
     jsonb_build_array(pg_temp.opc('chegadas', 'Chegadas') || '{"align_min": 60}'))),
  pg_temp.proc('P7', jsonb_build_object('exam_code', 'ecg', 'duration_min', 15, 'step_min', 15))],
  array['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'], 'sete procedimentos cadastrados (P7 sem requisito)');
select pg_temp.entrar('postgres');

/* ===================== Janelas, almoço, passo ===================== */
select is(pg_temp.horas('P1'), array['08:00', '08:30', '09:00', '09:30', '10:30', '11:00', '11:30'],
          'USG de 30 min de 30 em 30: 08:00 a 11:30, sem o almoço (09:30 termina às 10:00, encostado)');
select is(pg_temp.horas('P7'), '{}'::text[], 'procedimento sem requisito não tem horário');

/* ===================== Ocupado, alternativas, vagas ===================== */
select pg_temp.ocupar('USG-1', '09:00', '09:30');
select is(pg_temp.horas('P1'), array['08:00', '08:30', '09:30', '10:30', '11:00', '11:30'], 'USG-1 ocupado 09:00–09:30: some o 09:00');
select ok('09:00' = any (pg_temp.horas('P2')), 'com a alternativa (USG-1 ou USG-2), o 09:00 continua');
select pg_temp.ocupar('USG-2', '09:00', '09:30');
select ok(not '09:00' = any (pg_temp.horas('P2')), 'com as duas ocupadas, o 09:00 some também na alternativa');
select pg_temp.ocupar('Sala', '08:00', '08:15', 1);
select ok('08:00' = any (pg_temp.horas('P4')), 'sala com 2 vagas: uma ocupada às 08:00, a outra atende');
select pg_temp.ocupar('Sala', '08:00', '08:15', 2);
select ok(not '08:00' = any (pg_temp.horas('P4')) and '08:15' = any (pg_temp.horas('P4')),
          'as duas vagas ocupadas: some o 08:00, o 08:15 fica');

/* ===================== Dois grupos com deslocamento ===================== */
select pg_temp.dona();
select is(public.agenda_rules_set('c3200000-0000-4000-8000-000000000001', current_setting('teste.Dra')::uuid,
            jsonb_build_array(pg_temp.regra('09:00', '11:00'))) ->> 'status', 'ok', 'escala própria da profissional: 09:00–11:00');
select pg_temp.entrar('postgres');
select is(pg_temp.horas('P5'), array['09:00', '09:30', '10:30'],
          'sala + profissional (dos 10 aos 30 min do exame): só onde os dois estão livres, sem o almoço');

/* ===================== Chegadas (bloco alinhado) ===================== */
select pg_temp.ocupar('Chegadas', '09:00', '10:00', 1);
select ok('09:20' = any (pg_temp.horas('P6')), 'chegadas: uma vaga do bloco das 09:00 ocupada, ainda cabe');
select pg_temp.ocupar('Chegadas', '09:00', '10:00', 2);
select ok(not exists (select 1 from unnest(pg_temp.horas('P6')) h where h like '09:%') and '08:50' = any (pg_temp.horas('P6'))
          and '11:50' = any (pg_temp.horas('P6')),
          'chegadas: bloco das 09:00 cheio (2 pacientes por hora): nenhum horário 09:xx; 08:50 e 11:50 continuam');

/* ===================== Regra só de um procedimento ===================== */
select pg_temp.dona();
select is(public.agenda_rules_set('c3200000-0000-4000-8000-000000000001', null,
            jsonb_build_array(pg_temp.regra('08:00', '12:00'), pg_temp.regra('10:00', '10:30', 'pausa'),
                              pg_temp.regra('14:00', '15:00', 'abre', jsonb_build_object('procedure_ids', jsonb_build_array(current_setting('teste.P6')))))) ->> 'status',
          'ok', 'regra 14:00–15:00 só para o exame de sangue (P6)');
select pg_temp.entrar('postgres');
select ok('14:00' = any (pg_temp.horas('P6')) and not '14:00' = any (pg_temp.horas('P1')),
          'a regra de um procedimento vale só para ele');

/* ===================== Preparo e higienização no horário do recurso ===================== */
select is(pg_temp.horas('P3'), array['08:30', '09:00', '11:00'],
          'RM com 10 min de preparo e 5 de higienização na escala da unidade: sem 08:00 (preparo antes de abrir), sem os que encostam no almoço, sem 11:30');
select pg_temp.dona();
select is(public.agenda_rules_set('c3200000-0000-4000-8000-000000000001', current_setting('teste.RM_1')::uuid,
            jsonb_build_array(pg_temp.regra('07:50', '12:10'))) ->> 'status', 'ok', 'a RM abre às 07:50 e fecha às 12:10');
select pg_temp.entrar('postgres');
select is(pg_temp.horas('P3'), array['08:00', '08:30', '09:00', '11:00', '11:30'],
          'com o aparelho aberto 10 min antes e depois: 08:00 e 11:30 entram (o almoço da unidade continua valendo)');

/* ===================== Feriados ===================== */
insert into agenda.holidays (scope, day, name, source) values ('nacional', pg_temp.dia(), 'Feriado de teste', 'Lei de teste');
select is(pg_temp.horas('P1'), '{}'::text[], 'feriado nacional: nenhum horário');
select pg_temp.dona();
select is(public.agenda_holiday_opening_set('c3200000-0000-4000-8000-000000000001', pg_temp.dia(), true) ->> 'status', 'ok',
          'a clínica marca "abrimos neste feriado"');
select pg_temp.entrar('postgres');
select is(cardinality(pg_temp.horas('P1')), 6, 'com a abertura, os horários voltam');
select pg_temp.dona();
select is(public.agenda_holiday_opening_set('c3200000-0000-4000-8000-000000000001', pg_temp.dia(), false) ->> 'status', 'ok',
          'desfaz a abertura');
select pg_temp.entrar('postgres');
select is(pg_temp.horas('P1'), '{}'::text[], 'sem a abertura, fecha de novo');
update agenda.unit_settings set closes_on_holidays = false where clinic_id = 'c3200000-0000-4000-8000-000000000001';
select is(cardinality(pg_temp.horas('P1')), 6, 'unidade que não fecha em feriado: horários normais');
update agenda.unit_settings set closes_on_holidays = true where clinic_id = 'c3200000-0000-4000-8000-000000000001';
delete from agenda.holidays where day = pg_temp.dia();
insert into agenda.holidays (scope, uf, day, name, source) values ('uf', 'SP', pg_temp.dia(), 'Feriado estadual de teste', 'Lei de teste');
select is(pg_temp.horas('P1'), '{}'::text[], 'feriado da UF da clínica (SP): fecha');
update agenda.holidays set uf = 'RJ' where day = pg_temp.dia();
select is(cardinality(pg_temp.horas('P1')), 6, 'feriado de outra UF (RJ): não fecha');
delete from agenda.holidays where day = pg_temp.dia();
insert into agenda.holidays (scope, uf, city_ibge, day, name, source) values ('municipio', 'SP', 3550308, pg_temp.dia(), 'Feriado municipal de teste', 'Lei de teste');
select is(pg_temp.horas('P1'), '{}'::text[], 'feriado da cidade da clínica (pelo CNES): fecha');
delete from agenda.holidays where day = pg_temp.dia();
update agenda.unit_settings set holidays_checked_until = pg_temp.dia() - 1 where clinic_id = 'c3200000-0000-4000-8000-000000000001';
select is(pg_temp.horas('P1'), '{}'::text[], 'depois do dia até onde a clínica conferiu os feriados: nenhum horário');
update agenda.unit_settings set holidays_checked_until = pg_temp.dia() + 200 where clinic_id = 'c3200000-0000-4000-8000-000000000001';
update agenda.holidays set day = make_date(extract(year from pg_temp.dia())::integer - 1, 1, 1) where scope = 'nacional';
select is(pg_temp.horas('P1'), '{}'::text[], 'ano sem feriados nacionais lançados: nenhum horário (nunca vende num feriado não lançado)');
update agenda.holidays set day = make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1) where scope = 'nacional';
select is(cardinality(pg_temp.horas('P1')), 6, 'feriados nacionais do ano lançados: horários de volta');

/* ===================== Antecedência ===================== */
update agenda.procedures set max_advance_days = 10 where id = current_setting('teste.P1')::uuid;
select is(pg_temp.horas('P1'), '{}'::text[], 'antecedência máxima do procedimento (10 dias) antes do dia: nenhum horário');
update agenda.procedures set max_advance_days = null, min_notice_min = 10080 where id = current_setting('teste.P1')::uuid;
select is((select count(*)::integer from private.agenda_free_starts('c3200000-0000-4000-8000-000000000001', current_setting('teste.P1')::uuid,
             pg_temp.dia(), pg_temp.dia(), (pg_temp.dia()::timestamp at time zone 'America/Sao_Paulo') - interval '6 days')), 0,
          'antecedência mínima de 7 dias, consultado 6 dias antes: nenhum horário');
update agenda.procedures set min_notice_min = null where id = current_setting('teste.P1')::uuid;
select is((select count(*)::integer from private.agenda_free_starts('c3200000-0000-4000-8000-000000000001', current_setting('teste.P1')::uuid,
             pg_temp.dia(), pg_temp.dia(), (pg_temp.dia()::timestamp at time zone 'America/Sao_Paulo') - interval '6 days')), 6,
          'sem a antecedência do procedimento (vale a da unidade, 0): os 6 horários');

/* ===================== Recurso inativo, procedimento arquivado ===================== */
select pg_temp.dona();
select is(public.agenda_resource_save('c3200000-0000-4000-8000-000000000001',
            jsonb_build_object('id', current_setting('teste.USG_2'), 'active', false)) ->> 'status', 'has_appointments',
          'desativar a USG-2 com uso futuro: has_appointments (redução é bloqueio, nunca edição)');
select is(pg_temp.recurso('USG-3', 'equipamento'), 'ok', 'USG-3 cadastrada');
select is(public.agenda_resource_save('c3200000-0000-4000-8000-000000000001',
            jsonb_build_object('id', current_setting('teste.USG_3'), 'active', false)) ->> 'status', 'ok', 'USG-3 (sem uso) desativada');
select pg_temp.entrar('postgres');
select ok(not exists (select 1 from private.agenda_free_map('c3200000-0000-4000-8000-000000000001', array[current_setting('teste.USG_3')::uuid],
                                                            now(), now() + interval '40 days', now()))
          and exists (select 1 from private.agenda_free_map('c3200000-0000-4000-8000-000000000001', array[current_setting('teste.USG_2')::uuid],
                                                            now(), now() + interval '40 days', now())),
          'recurso inativo sai do mapa; o ativo continua');
select pg_temp.dona();
select is(public.agenda_procedure_save('c3200000-0000-4000-8000-000000000001',
            jsonb_build_object('id', current_setting('teste.P1'), 'archived', true)) ->> 'status', 'ok', 'P1 arquivado');
select pg_temp.entrar('postgres');
select is(pg_temp.horas('P1'), '{}'::text[], 'procedimento arquivado: nenhum horário');

/* ===================== Validações dos cadastros ===================== */
select pg_temp.dona();
select is(public.agenda_rules_set('c3200000-0000-4000-8000-000000000001', null, jsonb_build_array(pg_temp.regra('08:03', '12:00'))) ->> 'status',
          'invalid', 'horário fora do passo de 5 min: invalid');
select is(public.agenda_rules_set('c3200000-0000-4000-8000-000000000001', null,
            jsonb_build_array(pg_temp.regra('08:00', '12:00'), pg_temp.regra('11:00', '13:00'))) ->> 'status',
          'overlapping_rules', 'duas janelas que se cruzam no mesmo dia: overlapping_rules');
select is(public.agenda_rules_set('c3200000-0000-4000-8000-000000000001', null, jsonb_build_array(pg_temp.regra('12:00', '08:00'))) ->> 'status',
          'invalid', 'fim antes do início: invalid');
select is(public.agenda_rules_set('c3200000-0000-4000-8000-000000000001', null, jsonb_build_array(pg_temp.regra('08:00', '12:00') || '{"dia": 1}')) ->> 'status',
          'invalid', 'chave desconhecida: invalid (erro de digitação não passa em silêncio)');
select pg_temp.entrar('postgres');
select is((select count(*)::integer from public.clinic_schedules where clinic_id = 'c3200000-0000-4000-8000-000000000001' and resource_id is null), 3,
          'regras recusadas não apagaram as que existiam (3 da unidade)');
select pg_temp.dona();
select is(pg_temp.proc('P8', jsonb_build_object('exam_code', 'usg', 'duration_min', 30, 'requirements',
            jsonb_build_array(pg_temp.opc('equipamento', 'USG-1'), pg_temp.opc('equipamento', 'USG-1')))),
          'resource_in_two_groups', 'o mesmo recurso em dois grupos: resource_in_two_groups');
select is(pg_temp.proc('P9', jsonb_build_object('exam_code', 'usg', 'duration_min', 30, 'requirements',
            jsonb_build_array(pg_temp.opc('sala', 'USG-1')))),
          'invalid_option', 'alternativa de outro tipo (aparelho num grupo de sala): invalid_option');
select is(pg_temp.recurso('usg-1', 'equipamento'), 'duplicate_name', 'nome de recurso repetido (sem diferença de maiúsculas): duplicate_name');
select pg_temp.entrar('postgres');
select is((select count(*)::integer from agenda.procedures where clinic_id = 'c3200000-0000-4000-8000-000000000001' and name in ('P8', 'P9')), 0,
          'procedimentos recusados não ficaram gravados');

select * from finish();
rollback;
