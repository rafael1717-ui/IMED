-- Cancelamento (iMed Agenda, fase 3.3; arquitetura §5 e §13, teste 3 "Cancelamento"):
--   - o paciente cancela com o código do pedido (cancel_request, a fachada de hoje): a ocupação é solta e o horário
--     volta; de novo: already_cancelled; código errado: forbidden; depois do início: past; depois do prazo da
--     unidade: too_late;
--   - a clínica cancela com motivo (agenda_cancel): sem motivo, reason_required; outra clínica: forbidden;
--   - a equipe do IMED cancela com motivo; versão velha: version_conflict; pedido sem o motor novo: not_agenda;
--   - quem cancelou, quando e o motivo ficam no cabeçalho; o histórico só com códigos.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(35);
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
  select pg_temp.entrar('authenticated', 'a3220000-0000-4000-8000-000000000001', 'dona.cancelar@exemplo.test') $$;
create function pg_temp.recepcao() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3220000-0000-4000-8000-000000000002', 'recepcao.cancelar@exemplo.test') $$;
create function pg_temp.outra() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3220000-0000-4000-8000-000000000003', 'outra.cancelar@exemplo.test') $$;
create function pg_temp.admin() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3220000-0000-4000-8000-000000000004', 'admin.cancelar@exemplo.test') $$;
create function pg_temp.servidor() returns void language sql as $$
  select pg_temp.entrar('service_role') $$;
-- o dia do teste (daqui a 30 dias) e um horário dele, na hora de São Paulo
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.itens(variadic p text[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('procedure_id', pg_temp.id(p[i]), 'starts_at', pg_temp.t(p[i + 1])) order by i)
  from generate_series(1, cardinality(p), 2) i $$;
-- o paciente marca (visitante): id "b3220000-...-0000000000NN", código "codigo-secreto-NN"
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b3220000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.marcar(p_n integer, p_itens jsonb) returns jsonb language sql as $$
  select public.agenda_book('c3220000-0000-4000-8000-000000000001', p_itens,
                            jsonb_build_object('name', 'Paciente ' || p_n, 'phone', '119' || lpad(p_n::text, 8, '0'), 'consent', true),
                            pg_temp.pid(p_n), 'codigo-secreto-' || lpad(p_n::text, 4, '0')) $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.horas(p_proc text) returns text[] language sql stable as $$
  select coalesce(array_agg(to_char(s.slot_start at time zone 'America/Sao_Paulo', 'HH24:MI') order by s.slot_start), '{}')
  from public.agenda_slots('c3220000-0000-4000-8000-000000000001', pg_temp.id(p_proc), pg_temp.dia(), pg_temp.dia()) s $$;
create function pg_temp.ativos(p_n integer) returns integer language sql stable as $$
  select count(*)::integer from agenda.occupancy o join agenda.appointment_items i on i.id = o.item_id
  where i.request_id = pg_temp.pid(p_n) and o.active $$;
create function pg_temp.situacao(p_n integer) returns text language sql stable as $$
  select status from public.appointment_requests where id = pg_temp.pid(p_n) $$;
-- muda os horários de um agendamento à mão (marca de emergência): para testar regras de horário "depois do início"
create function pg_temp.mover(p_n integer, p_delta interval) returns void language plpgsql as $$
begin
  perform set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_horario', true);
  update agenda.occupancy o set during = tstzrange(lower(o.during) + p_delta, upper(o.during) + p_delta, '[)')
  where o.item_id in (select i.id from agenda.appointment_items i where i.request_id = pg_temp.pid(p_n));
  update agenda.appointment_items i set starts_at = i.starts_at + p_delta, ends_at = i.ends_at + p_delta
  where i.request_id = pg_temp.pid(p_n);
  update public.appointment_requests a set slot_start = a.slot_start + p_delta, slot_end = a.slot_end + p_delta
  where a.id = pg_temp.pid(p_n);
  perform set_config('imed.origin', '', true), set_config('imed.reason', '', true);
end $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from (values ('a3220000-0000-4000-8000-000000000001'::uuid, 'dona.cancelar@exemplo.test'),
             ('a3220000-0000-4000-8000-000000000002'::uuid, 'recepcao.cancelar@exemplo.test'),
             ('a3220000-0000-4000-8000-000000000003'::uuid, 'outra.cancelar@exemplo.test'),
             ('a3220000-0000-4000-8000-000000000004'::uuid, 'admin.cancelar@exemplo.test')) u (id, email);
insert into public.admin_emails (email) values ('admin.cancelar@exemplo.test');
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua da Agenda, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values ('c3220000-0000-4000-8000-000000000001'::uuid, 'Clínica da Agenda cancelar', 1),
             ('c3220000-0000-4000-8000-000000000002'::uuid, 'Outra Clínica cancelar', 2)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  ('c3220000-0000-4000-8000-000000000001', 'a3220000-0000-4000-8000-000000000001', 'owner'),
  ('c3220000-0000-4000-8000-000000000001', 'a3220000-0000-4000-8000-000000000002', 'staff'),
  ('c3220000-0000-4000-8000-000000000002', 'a3220000-0000-4000-8000-000000000003', 'owner');
insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949'
where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1));

select pg_temp.dona();
select public.agenda_unit_save('c3220000-0000-4000-8000-000000000001',
         jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_min', 30));
select set_config('teste.usg1', public.agenda_resource_save('c3220000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "USG-1"}') ->> 'id', true);
select set_config('teste.usg2', public.agenda_resource_save('c3220000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "USG-2"}') ->> 'id', true);
select set_config('teste.rm1', public.agenda_resource_save('c3220000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "RM-1"}') ->> 'id', true);
select set_config('teste.usg', public.agenda_procedure_save('c3220000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('usg1')), jsonb_build_object('resource_id', pg_temp.id('usg2'), 'priority', 2)))))) ->> 'id', true);
select set_config('teste.rm', public.agenda_procedure_save('c3220000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'rm', 'name', 'Ressonância', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('rm1'))))))) ->> 'id', true);
-- aberta todos os dias, o dia inteiro (as regras de horário do atendimento usam o relógio de agora)
select public.agenda_rules_set('c3220000-0000-4000-8000-000000000001', null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d));
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_agenda', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now()
where id = 'c3220000-0000-4000-8000-000000000001';
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);

/* ===================== O paciente cancela com o código ===================== */
select pg_temp.entrar('anon');
select is(pg_temp.marcar(1, pg_temp.itens('rm', '09:00')) ->> 'status', 'ok', 'visitante marca a ressonância das 09:00');
select ok(not ('09:00' = any (pg_temp.horas('rm'))), 'o 09:00 sai da lista de horários livres');
select is(public.cancel_request(pg_temp.pid(1), 'codigo-errado-qualquer'), 'forbidden', 'código errado: forbidden');
select is(public.cancel_request(pg_temp.pid(1), pg_temp.codigo(1)), 'ok', 'cancela com o código do pedido: ok');
select is(public.cancel_request(pg_temp.pid(1), pg_temp.codigo(1)), 'already_cancelled', 'de novo: already_cancelled');
select ok('09:00' = any (pg_temp.horas('rm')), 'o horário volta a ficar livre na hora');
select is(public.agenda_my_booking(pg_temp.pid(1), pg_temp.codigo(1)) ->> 'request_status', 'cancelled',
          'agenda_my_booking com o código mostra cancelado');
select is(public.agenda_my_booking(pg_temp.pid(1), 'codigo-errado-qualquer') ->> 'status', 'not_found',
          'agenda_my_booking com código errado: not_found (não confirma nem que existe)');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', status, cancelled_by, cancel_reason, cancelled_at is not null) from public.appointment_requests
           where id = pg_temp.pid(1)), 'cancelled|patient|paciente_desistiu|t', 'cabeçalho: quem, motivo e quando');
select is((select string_agg(o.release_reason || ':' || o.active, ',') from agenda.occupancy o
           join agenda.appointment_items i on i.id = o.item_id where i.request_id = pg_temp.pid(1)), 'cancelado:false',
          'a ocupação foi solta (motivo cancelado)');
select is((select string_agg(coalesce(from_status, '-') || '>' || to_status || ':' || origin, ',' order by id)
           from agenda.status_history where request_id = pg_temp.pid(1) and item_id is null),
          '->confirmed:app,confirmed>cancelled:app', 'histórico: nasceu confirmado e foi cancelado pelo app');

/* ===================== A clínica cancela com motivo ===================== */
select pg_temp.entrar('anon');
select is(pg_temp.marcar(2, pg_temp.itens('rm', '10:00')) ->> 'status', 'ok', 'outro paciente marca 10:00');
select pg_temp.recepcao();
select is(public.agenda_cancel(pg_temp.pid(2)) ->> 'status', 'reason_required', 'a clínica sem motivo: reason_required');
select is(public.agenda_cancel(pg_temp.pid(2), 'motivo inventado') ->> 'status', 'invalid_reason', 'motivo fora da lista: invalid_reason');
select is(public.agenda_cancel(pg_temp.pid(2), 'equipamento_manutencao', null, 99) ->> 'status', 'version_conflict',
          'versão velha: version_conflict');
select pg_temp.outra();
select is(public.agenda_cancel(pg_temp.pid(2), 'equipamento_manutencao') ->> 'status', 'forbidden', 'outra clínica: forbidden');
select pg_temp.recepcao();
select is(public.agenda_cancel(pg_temp.pid(2), 'equipamento_manutencao', null, 1) ->> 'status', 'ok', 'a recepção cancela com motivo');
select ok('10:00' = any (pg_temp.horas('rm')), 'o 10:00 volta a ficar livre');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', status, cancelled_by, cancel_reason) from public.appointment_requests where id = pg_temp.pid(2)),
          'cancelled|clinic|equipamento_manutencao', 'cancelado pela clínica, com o motivo');

/* ===================== A equipe do IMED ===================== */
select pg_temp.entrar('anon');
select is(pg_temp.marcar(3, pg_temp.itens('rm', '11:00')) ->> 'status', 'ok', 'paciente marca 11:00');
select pg_temp.admin();
select is(public.agenda_cancel(pg_temp.pid(3), 'duplicado') ->> 'status', 'ok', 'a equipe do IMED cancela com motivo');
select pg_temp.entrar('postgres');
select is((select cancelled_by from public.appointment_requests where id = pg_temp.pid(3)), 'imed', 'cancelado pela equipe');

/* ===================== Prazos do paciente: past e too_late ===================== */
select pg_temp.entrar('anon');
select is(pg_temp.marcar(4, pg_temp.itens('rm', '12:00')) ->> 'status', 'ok', 'paciente marca 12:00');
select is(pg_temp.marcar(5, pg_temp.itens('rm', '13:00')) ->> 'status', 'ok', 'paciente marca 13:00');
select pg_temp.entrar('postgres');
select pg_temp.mover(4, now() - interval '1 hour' - pg_temp.t('12:00'));   -- começou há 1 hora
select pg_temp.entrar('anon');
select is(public.cancel_request(pg_temp.pid(4), pg_temp.codigo(4)), 'past', 'depois do início: past');
select pg_temp.dona();
select is(public.agenda_unit_save('c3220000-0000-4000-8000-000000000001', '{"patient_cancel_until_min": 10080}') ->> 'status', 'ok',
          'a unidade passa a aceitar cancelamento do paciente só até 7 dias antes');
select pg_temp.entrar('anon');
select is(public.cancel_request(pg_temp.pid(5), pg_temp.codigo(5)), 'ok', 'faltam 30 dias: ok');
select is(pg_temp.marcar(6, pg_temp.itens('rm', '14:00')) ->> 'status', 'ok', 'paciente marca 14:00');
select pg_temp.entrar('postgres');
select pg_temp.mover(6, now() + interval '2 days' - pg_temp.t('14:00'));    -- daqui a 2 dias
select pg_temp.entrar('anon');
select is(public.cancel_request(pg_temp.pid(6), pg_temp.codigo(6)), 'too_late', 'dentro dos 7 dias: too_late');
select is(public.agenda_cancel(pg_temp.pid(6), null, pg_temp.codigo(6)) ->> 'status', 'too_late', 'agenda_cancel com o código: too_late');
select pg_temp.recepcao();
select is(public.agenda_cancel(pg_temp.pid(6), 'paciente_nao_pode') ->> 'status', 'ok', 'a clínica ainda cancela (com motivo)');

/* ===================== Pedido sem o motor novo ===================== */
select pg_temp.entrar('anon');
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent, review_token_hash)
  values (pg_temp.pid(9), 'c3220000-0000-4000-8000-000000000001', 'imed', 'Clínica da Agenda', 'usg', pg_temp.dia(),
    'Pedido Sem Horário', '11999990009', true, encode(extensions.digest(pg_temp.codigo(9), 'sha256'), 'hex'))
$$, 'pedido sem horário (como hoje)');
select is(public.agenda_cancel(pg_temp.pid(9), null, pg_temp.codigo(9)) ->> 'status', 'not_agenda',
          'agenda_cancel em pedido sem o motor: not_agenda');
select is(public.cancel_request(pg_temp.pid(9), pg_temp.codigo(9)), 'ok', 'cancel_request em pedido sem o motor: como hoje');
select is(public.agenda_cancel('b0000000-0000-4000-8000-000000000999', null, 'x') ->> 'status', 'not_found', 'pedido inexistente: not_found');

select * from finish();
rollback;
