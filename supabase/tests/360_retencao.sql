-- Retenção da reserva expirada (iMed Agenda, fase 3.4; arquitetura §12: "anonimizar nome, telefone e e-mail em 7 dias"):
--   - reserva expirada há mais de 7 dias perde nome, telefone, e-mail, observação, quem faria o exame, o vínculo com a
--     conta e o código; as notas livres do pedido somem; ficam situação, horários e códigos;
--   - expirada há menos de 7 dias e agendamento confirmado não mudam; rodar de novo não mexe no que já foi apagado;
--   - a rotina de 30 s (agenda_manutencao) chama a retenção.
-- Tudo é desfeito no fim (rollback).
begin;
select plan(11);
delete from agenda.holidays where scope = 'nacional';  -- sem os da migração feriados_nacionais: o teste lança os dele (dias relativos a hoje)

create function pg_temp.entrar(p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when p_papel = 'postgres' then '' else jsonb_build_object('role', p_papel)::text end, true);
  perform set_config('role', p_papel, true);
end $$;
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b3600000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.dia() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date + 10 $$;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a3600000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'dona.retencao@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now());
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
values ('c3600000-0000-4000-8000-000000000001', 'Clínica da Retenção', 'imagem', 'Rua da Retenção, 1', 'São Paulo', 'SP',
        extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false);
insert into public.clinic_members (clinic_id, user_id, role) values ('c3600000-0000-4000-8000-000000000001', 'a3600000-0000-4000-8000-000000000001', 'owner');
insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949'
where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1));
select set_config('request.jwt.claims', '{"role": "authenticated", "sub": "a3600000-0000-4000-8000-000000000001", "email": "dona.retencao@exemplo.test", "aud": "authenticated", "amr": [{"method": "otp", "timestamp": 1}]}', true),
       set_config('role', 'authenticated', true);
select public.agenda_unit_save('c3600000-0000-4000-8000-000000000001', jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_min', 30));
select set_config('teste.r', public.agenda_resource_save('c3600000-0000-4000-8000-000000000001', '{"kind": "sala", "name": "Sala 1", "capacity": 10}') ->> 'id', true);
select set_config('teste.p', public.agenda_procedure_save('c3600000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'ecg', 'name', 'Eletrocardiograma', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'sala', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', current_setting('teste.r')::uuid)))))) ->> 'id', true);
select public.agenda_rules_set('c3600000-0000-4000-8000-000000000001', null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d));
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_agenda', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now()
where id = 'c3600000-0000-4000-8000-000000000001';
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);

-- três reservas (servidor), com e-mail (a 1 também com observação e nota); a 3 vira agendamento confirmado
create function pg_temp.reservar(p_n integer, p_hhmm text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.entrar('service_role');
  v := public.agenda_hold('c3600000-0000-4000-8000-000000000001',
         jsonb_build_array(jsonb_build_object('procedure_id', current_setting('teste.p')::uuid,
                                              'starts_at', (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo')),
         jsonb_build_object('name', 'Paciente Retido ' || p_n, 'phone', '119' || lpad(p_n::text, 8, '0'), 'email', 'p' || p_n || '@exemplo.test', 'consent', true),
         pg_temp.pid(p_n), 'codigo-retencao-' || p_n);
  perform pg_temp.entrar('postgres');
  return v;
end $$;
select ok(j ->> 'status' = 'ok', 'reserva ' || n || ': ' || j::text)
from (select n, pg_temp.reservar(n, h) as j from (values (1, '09:00'), (2, '10:00'), (3, '11:00')) v (n, h)) x order by n;
select pg_temp.entrar('service_role');
select ok(j ->> 'status' = 'ok', 'a reserva 3 é confirmada: ' || j::text) from (select public.agenda_confirm(pg_temp.pid(3)) as j) x;
select pg_temp.entrar('postgres');
update public.appointment_requests set notes = 'Observação do pedido' where id = pg_temp.pid(1);
insert into agenda.notes (clinic_id, request_id, kind, text) values ('c3600000-0000-4000-8000-000000000001', pg_temp.pid(1), 'observacao', 'Nota livre');
-- 1 e 2 vencem e expiram; a 1 expirou há 8 dias, a 2 há 6 (o gatilho de updated_at fica parado só neste teste)
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_retencao', true);
update public.appointment_requests set hold_expires_at = now() - interval '20 minutes' where id in (pg_temp.pid(1), pg_temp.pid(2));
update agenda.occupancy o set hold_until = now() - interval '15 minutes'
where o.active and o.item_id in (select i.id from agenda.appointment_items i where i.request_id in (pg_temp.pid(1), pg_temp.pid(2)));
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
select private.agenda_expire(pg_temp.pid(1)), private.agenda_expire(pg_temp.pid(2));
set constraints all immediate;   -- (as conferências adiadas rodam agora: ALTER TABLE não aceita eventos pendentes)
alter table public.appointment_requests disable trigger appointment_requests_touch;
update public.appointment_requests set updated_at = now() - interval '8 days' where id = pg_temp.pid(1);
update public.appointment_requests set updated_at = now() - interval '6 days' where id = pg_temp.pid(2);
alter table public.appointment_requests enable trigger appointment_requests_touch;
set constraints all deferred;

select is(private.agenda_anonimizar(), 1, 'a retenção apaga os dados de 1 reserva (a expirada há mais de 7 dias)');
select is((select concat_ws('|', status, patient_name, patient_phone, coalesce(patient_email, '-'), coalesce(notes, '-'),
                            coalesce(user_id::text, '-'), coalesce(review_token_hash, '-'), anonymized_at is not null, slot_start is not null)
           from public.appointment_requests where id = pg_temp.pid(1)),
          'expired|Removido|0000000000|-|-|-|-|t|t', 'sem nome, telefone, e-mail, observação, conta e código; situação e horário ficam');
select is((select concat_ws('|', deleted_at is not null, coalesce(text, '-')) from agenda.notes where request_id = pg_temp.pid(1)),
          't|-', 'a nota livre do pedido também some');
select is((select string_agg(patient_name, ',' order by id) from public.appointment_requests where id in (pg_temp.pid(2), pg_temp.pid(3))),
          'Paciente Retido 2,Paciente Retido 3', 'expirada há 6 dias e agendamento confirmado não mudam');
select is(private.agenda_anonimizar(), 0, 'rodar de novo não mexe em nada');
select ok((select prosrc from pg_proc where oid = 'private.agenda_manutencao()'::regprocedure) ~ 'agenda_anonimizar',
          'a rotina de 30 s (agenda_manutencao) chama a retenção');
select ok(not has_function_privilege('authenticated', 'private.agenda_anonimizar(integer)', 'EXECUTE')
          and not has_function_privilege('service_role', 'private.agenda_anonimizar(integer)', 'EXECUTE'), 'só o banco roda a retenção');

select * from finish();
rollback;
