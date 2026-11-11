-- Remarcação (iMed Agenda, fase 3.3; arquitetura §6 e §13, 240_remarcar):
--   - o paciente remarca com o código: o horário antigo volta à lista e o novo sai, no MESMO aparelho de antes
--     (preferência), numa transação; histórico e auditoria só com códigos e horários;
--   - horário novo sem lugar: slot_taken com alternativas, e NADA muda (o antigo continua valendo, com a ocupação);
--   - prazo do paciente (too_late); a clínica ainda remarca; versão velha; agendamento cancelado; outra clínica;
--   - pacote: remarcar só o 2º exame; o 2º antes do fim do 1º: invalid_package;
--   - "remarcação solicitada" (a ocupação continua) e a remarcação devolve "confirmado";
--   - idempotência pela chave.
-- A janela "quem tenta o horário antigo durante a remarcação espera o COMMIT" é provada no laço local (remarcacao)
-- e em tests/banco/concorrencia.mjs.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(34);
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
  select pg_temp.entrar('authenticated', 'a3240000-0000-4000-8000-000000000001', 'dona.remarcar@exemplo.test') $$;
create function pg_temp.recepcao() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3240000-0000-4000-8000-000000000002', 'recepcao.remarcar@exemplo.test') $$;
create function pg_temp.outra() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3240000-0000-4000-8000-000000000003', 'outra.remarcar@exemplo.test') $$;
create function pg_temp.admin() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3240000-0000-4000-8000-000000000004', 'admin.remarcar@exemplo.test') $$;
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
-- o paciente marca (visitante): id "b3240000-...-0000000000NN", código "codigo-secreto-NN"
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b3240000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.marcar(p_n integer, p_itens jsonb) returns jsonb language sql as $$
  select public.agenda_book('c3240000-0000-4000-8000-000000000001', p_itens,
                            jsonb_build_object('name', 'Paciente ' || p_n, 'phone', '119' || lpad(p_n::text, 8, '0'), 'consent', true),
                            pg_temp.pid(p_n), 'codigo-secreto-' || lpad(p_n::text, 4, '0')) $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.horas(p_proc text) returns text[] language sql stable as $$
  select coalesce(array_agg(to_char(s.slot_start at time zone 'America/Sao_Paulo', 'HH24:MI') order by s.slot_start), '{}')
  from public.agenda_slots('c3240000-0000-4000-8000-000000000001', pg_temp.id(p_proc), pg_temp.dia(), pg_temp.dia()) s $$;
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
from (values ('a3240000-0000-4000-8000-000000000001'::uuid, 'dona.remarcar@exemplo.test'),
             ('a3240000-0000-4000-8000-000000000002'::uuid, 'recepcao.remarcar@exemplo.test'),
             ('a3240000-0000-4000-8000-000000000003'::uuid, 'outra.remarcar@exemplo.test'),
             ('a3240000-0000-4000-8000-000000000004'::uuid, 'admin.remarcar@exemplo.test')) u (id, email);
insert into public.admin_emails (email) values ('admin.remarcar@exemplo.test');
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua da Agenda, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values ('c3240000-0000-4000-8000-000000000001'::uuid, 'Clínica da Agenda remarcar', 1),
             ('c3240000-0000-4000-8000-000000000002'::uuid, 'Outra Clínica remarcar', 2)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  ('c3240000-0000-4000-8000-000000000001', 'a3240000-0000-4000-8000-000000000001', 'owner'),
  ('c3240000-0000-4000-8000-000000000001', 'a3240000-0000-4000-8000-000000000002', 'staff'),
  ('c3240000-0000-4000-8000-000000000002', 'a3240000-0000-4000-8000-000000000003', 'owner');
insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949'
where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1));

select pg_temp.dona();
select public.agenda_unit_save('c3240000-0000-4000-8000-000000000001',
         jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_min', 30));
select set_config('teste.usg1', public.agenda_resource_save('c3240000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "USG-1"}') ->> 'id', true);
select set_config('teste.usg2', public.agenda_resource_save('c3240000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "USG-2"}') ->> 'id', true);
select set_config('teste.rm1', public.agenda_resource_save('c3240000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "RM-1"}') ->> 'id', true);
select set_config('teste.usg', public.agenda_procedure_save('c3240000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('usg1')), jsonb_build_object('resource_id', pg_temp.id('usg2'), 'priority', 2)))))) ->> 'id', true);
select set_config('teste.rm', public.agenda_procedure_save('c3240000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'rm', 'name', 'Ressonância', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('rm1'))))))) ->> 'id', true);
-- aberta todos os dias, o dia inteiro (as regras de horário do atendimento usam o relógio de agora)
select public.agenda_rules_set('c3240000-0000-4000-8000-000000000001', null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d));
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_agenda', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now()
where id = 'c3240000-0000-4000-8000-000000000001';
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
create function pg_temp.remarcar(p_n integer, p_seq integer, p_hhmm text, p_codigo text default null, p_chave uuid default null,
                                 p_versao integer default null)
returns jsonb language sql as $$
  select public.agenda_reschedule(pg_temp.pid(p_n), jsonb_build_array(jsonb_build_object('seq', p_seq, 'starts_at', pg_temp.t(p_hhmm))),
                                  p_codigo, p_chave, p_versao) $$;
create function pg_temp.recurso(p_n integer, p_seq integer default 1) returns text language sql stable as $$
  select string_agg(r.name, ',') from agenda.occupancy o join agenda.resources r on r.id = o.resource_id
  join agenda.appointment_items i on i.id = o.item_id where i.request_id = pg_temp.pid(p_n) and i.seq = p_seq and o.active $$;

/* ===================== O paciente remarca ===================== */
select pg_temp.entrar('anon');
select is(pg_temp.marcar(1, pg_temp.itens('usg', '09:00')) ->> 'status', 'ok', 'ultrassom das 09:00 (USG-1)');
select is(pg_temp.marcar(2, pg_temp.itens('usg', '10:00')) ->> 'status', 'ok', 'outro paciente, 10:00 (USG-1)');
select is(pg_temp.remarcar(1, 1, '10:00', pg_temp.codigo(1)) ->> 'status', 'ok', 'o paciente 1 remarca para as 10:00 com o código');
select pg_temp.entrar('postgres');
select is(pg_temp.recurso(1), 'USG-2', 'às 10:00 o USG-1 está ocupado: vai para o USG-2');
select is(pg_temp.remarcar(1, 1, '11:00', pg_temp.codigo(1)) ->> 'status', 'ok', 'remarca de novo, para as 11:00');
select is(pg_temp.recurso(1), 'USG-2', 'às 11:00 os dois estão livres: fica no mesmo aparelho de antes (USG-2)');
select is((select concat_ws('|', status, slot_start = pg_temp.t('11:00'), slot_end = pg_temp.t('11:30'), version)
           from public.appointment_requests where id = pg_temp.pid(1)), 'confirmed|t|t|3', 'cabeçalho com o horário novo e a versão');
select is((select count(*)::integer from agenda.occupancy o join agenda.appointment_items i on i.id = o.item_id
           where i.request_id = pg_temp.pid(1) and not o.active and o.release_reason = 'remarcado'), 2,
          'as ocupações antigas ficaram soltas com o motivo remarcado');
select is((select count(*)::integer from agenda.audit_log where action = 'agendamento.remarcar' and object_id = pg_temp.pid(1)::text
           and origin = 'app' and reason_code = 'remarcado'), 2, 'auditoria da remarcação (horários, sem dado pessoal)');

/* ===================== Sem lugar: nada muda ===================== */
select pg_temp.entrar('anon');
select is(pg_temp.marcar(3, pg_temp.itens('rm', '09:00')) ->> 'status', 'ok', 'ressonância das 09:00');
select is(pg_temp.marcar(4, pg_temp.itens('rm', '10:00')) ->> 'status', 'ok', 'ressonância das 10:00');
select is((pg_temp.remarcar(3, 1, '10:00', pg_temp.codigo(3)) - 'alternatives'), jsonb_build_object('status', 'slot_taken', 'seq', 1),
          'remarcar para um horário ocupado: slot_taken');
select ok(jsonb_array_length(pg_temp.remarcar(3, 1, '10:00', pg_temp.codigo(3)) -> 'alternatives') > 0, 'com alternativas');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', a.status, a.slot_start = pg_temp.t('09:00'), a.version) from public.appointment_requests a
           where a.id = pg_temp.pid(3)), 'confirmed|t|1', 'o agendamento antigo continua igual');
select is(pg_temp.recurso(3), 'RM-1', 'e com a ocupação (a soltura do antigo foi desfeita junto)');

/* ===================== Prazos, permissões e versão ===================== */
select pg_temp.dona();
select is(public.agenda_unit_save('c3240000-0000-4000-8000-000000000001', '{"patient_reschedule_until_min": 10080}') ->> 'status', 'ok',
          'a unidade aceita remarcação do paciente só até 7 dias antes');
select pg_temp.entrar('postgres');
select pg_temp.mover(3, now() + interval '2 days' - pg_temp.t('09:00'));   -- o exame passa a ser daqui a 2 dias
select pg_temp.entrar('anon');
select is(pg_temp.remarcar(3, 1, '11:00', pg_temp.codigo(3)) ->> 'status', 'too_late', 'o paciente fora do prazo: too_late');
select is(pg_temp.remarcar(3, 1, '11:00', 'codigo-errado-qualquer') ->> 'status', 'forbidden', 'código errado: forbidden');
select pg_temp.outra();
select is(pg_temp.remarcar(3, 1, '11:00') ->> 'status', 'forbidden', 'outra clínica: forbidden');
select pg_temp.recepcao();
select is(pg_temp.remarcar(3, 1, '11:00', null, null, 7) ->> 'status', 'version_conflict', 'versão velha: version_conflict');
select is(pg_temp.remarcar(3, 1, '11:00', null, 'e3240000-0000-4000-8000-000000000001') ->> 'status', 'ok',
          'a recepção remarca (o prazo do paciente não vale para ela)');
select is(pg_temp.remarcar(3, 1, '11:00', null, 'e3240000-0000-4000-8000-000000000001') ->> 'replay', 'true',
          'a mesma chave de novo: replay (sem remarcar duas vezes)');
select is(pg_temp.remarcar(3, 1, '12:00', null, 'e3240000-0000-4000-8000-000000000001') ->> 'status', 'idempotency_conflict',
          'a mesma chave com outro horário: idempotency_conflict');
select is(public.agenda_cancel(pg_temp.pid(4), 'outro') ->> 'status', 'ok', 'a recepção cancela o das 10:00');
select is(pg_temp.remarcar(4, 1, '12:00') ->> 'status', 'transition_not_allowed', 'remarcar um cancelado: transition_not_allowed');
select is(pg_temp.remarcar(3, 9, '12:00') ->> 'status', 'invalid', 'item que não existe: invalid');

/* ===================== Pacote: só o 2º exame ===================== */
select pg_temp.entrar('anon');
select is(pg_temp.marcar(5, pg_temp.itens('usg', '14:00', 'rm', '14:30')) ->> 'status', 'ok', 'pacote: ultrassom 14:00 e ressonância 14:30');
select pg_temp.recepcao();
select is(pg_temp.remarcar(5, 2, '15:00') ->> 'status', 'ok', 'remarca só a ressonância (15:00)');
select is(pg_temp.remarcar(5, 2, '14:00') ->> 'status', 'invalid_package', 'a ressonância junto do ultrassom (14:00): invalid_package');
select pg_temp.entrar('postgres');
select is((select string_agg(to_char(i.starts_at at time zone 'America/Sao_Paulo', 'HH24:MI'), ',' order by i.seq)
           from agenda.appointment_items i where i.request_id = pg_temp.pid(5)), '14:00,15:00', 'o 1º exame ficou onde estava');
select is((select (slot_start = pg_temp.t('14:00') and slot_end = pg_temp.t('15:30'))::text from public.appointment_requests
           where id = pg_temp.pid(5)), 'true', 'o cabeçalho vai do início do 1º ao fim do 2º');

/* ===================== Remarcação solicitada ===================== */
select pg_temp.recepcao();
select is(public.agenda_set_status(pg_temp.pid(5), 'reschedule_requested') ->> 'request_status', 'reschedule_requested',
          'a clínica pede remarcação (o horário continua seguro)');
select pg_temp.entrar('postgres');
select is(pg_temp.ativos(5), 2, 'as duas ocupações continuam');
select pg_temp.recepcao();
select is(pg_temp.remarcar(5, 1, '16:00') ->> 'request_status', 'confirmed', 'remarcado: volta a confirmado');

select * from finish();
rollback;
