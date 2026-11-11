-- Reserva temporária (iMed Agenda, fase 3.3; arquitetura §3.2 item 6, §5 e §13, teste 4 "Reserva expirada"):
--   - agenda_hold, agenda_confirm e agenda_release só para o servidor (service_role; visitante e logado nem executam);
--   - a reserva segura o horário até o prazo (hold_minutes) + a carência, e a clínica não a vê na leitura direta;
--   - confirmar no prazo: confirmado, sem prazo na ocupação;
--   - reserva vencida: some da lista de horários; a próxima marcação nos mesmos recursos a expira na hora (liberação
--     preguiçosa, sem cron) e fica com o horário; confirmar depois: expired;
--   - expirar (a rotina do cron, uma reserva por vez) e soltar (agenda_release: o sistema da clínica recusou).
-- O cron de verdade (CALL com COMMIT entre lotes) e confirmar × expirar ao mesmo tempo: tests/banco/reserva.mjs.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(30);
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
  select pg_temp.entrar('authenticated', 'a3210000-0000-4000-8000-000000000001', 'dona.reserva@exemplo.test') $$;
create function pg_temp.recepcao() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3210000-0000-4000-8000-000000000002', 'recepcao.reserva@exemplo.test') $$;
create function pg_temp.outra() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3210000-0000-4000-8000-000000000003', 'outra.reserva@exemplo.test') $$;
create function pg_temp.admin() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3210000-0000-4000-8000-000000000004', 'admin.reserva@exemplo.test') $$;
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
-- o paciente marca (visitante): id "b3210000-...-0000000000NN", código "codigo-secreto-NN"
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b3210000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.marcar(p_n integer, p_itens jsonb) returns jsonb language sql as $$
  select public.agenda_book('c3210000-0000-4000-8000-000000000001', p_itens,
                            jsonb_build_object('name', 'Paciente ' || p_n, 'phone', '119' || lpad(p_n::text, 8, '0'), 'consent', true),
                            pg_temp.pid(p_n), 'codigo-secreto-' || lpad(p_n::text, 4, '0')) $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.horas(p_proc text) returns text[] language sql stable as $$
  select coalesce(array_agg(to_char(s.slot_start at time zone 'America/Sao_Paulo', 'HH24:MI') order by s.slot_start), '{}')
  from public.agenda_slots('c3210000-0000-4000-8000-000000000001', pg_temp.id(p_proc), pg_temp.dia(), pg_temp.dia()) s $$;
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
from (values ('a3210000-0000-4000-8000-000000000001'::uuid, 'dona.reserva@exemplo.test'),
             ('a3210000-0000-4000-8000-000000000002'::uuid, 'recepcao.reserva@exemplo.test'),
             ('a3210000-0000-4000-8000-000000000003'::uuid, 'outra.reserva@exemplo.test'),
             ('a3210000-0000-4000-8000-000000000004'::uuid, 'admin.reserva@exemplo.test')) u (id, email);
insert into public.admin_emails (email) values ('admin.reserva@exemplo.test');
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua da Agenda, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values ('c3210000-0000-4000-8000-000000000001'::uuid, 'Clínica da Agenda reserva', 1),
             ('c3210000-0000-4000-8000-000000000002'::uuid, 'Outra Clínica reserva', 2)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  ('c3210000-0000-4000-8000-000000000001', 'a3210000-0000-4000-8000-000000000001', 'owner'),
  ('c3210000-0000-4000-8000-000000000001', 'a3210000-0000-4000-8000-000000000002', 'staff'),
  ('c3210000-0000-4000-8000-000000000002', 'a3210000-0000-4000-8000-000000000003', 'owner');
insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949'
where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1));

select pg_temp.dona();
select public.agenda_unit_save('c3210000-0000-4000-8000-000000000001',
         jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_min', 30));
select set_config('teste.usg1', public.agenda_resource_save('c3210000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "USG-1"}') ->> 'id', true);
select set_config('teste.usg2', public.agenda_resource_save('c3210000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "USG-2"}') ->> 'id', true);
select set_config('teste.rm1', public.agenda_resource_save('c3210000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "RM-1"}') ->> 'id', true);
select set_config('teste.usg', public.agenda_procedure_save('c3210000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('usg1')), jsonb_build_object('resource_id', pg_temp.id('usg2'), 'priority', 2)))))) ->> 'id', true);
select set_config('teste.rm', public.agenda_procedure_save('c3210000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'rm', 'name', 'Ressonância', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('rm1'))))))) ->> 'id', true);
-- aberta todos os dias, o dia inteiro (as regras de horário do atendimento usam o relógio de agora)
select public.agenda_rules_set('c3210000-0000-4000-8000-000000000001', null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d));
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_agenda', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now()
where id = 'c3210000-0000-4000-8000-000000000001';
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
create function pg_temp.reservar(p_n integer, p_itens jsonb) returns jsonb language sql as $$
  select public.agenda_hold('c3210000-0000-4000-8000-000000000001', p_itens,
                            jsonb_build_object('name', 'Paciente ' || p_n, 'phone', '119' || lpad(p_n::text, 8, '0'), 'consent', true),
                            pg_temp.pid(p_n), pg_temp.codigo(p_n)) $$;
-- o prazo da reserva "vence" (à mão, com a marca de emergência)
create function pg_temp.vencer(p_n integer) returns void language plpgsql as $$
begin
  perform set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_reserva', true);
  update public.appointment_requests set hold_expires_at = now() - interval '20 minutes' where id = pg_temp.pid(p_n);
  update agenda.occupancy o set hold_until = now() - interval '15 minutes'
  where o.active and o.item_id in (select i.id from agenda.appointment_items i where i.request_id = pg_temp.pid(p_n));
  perform set_config('imed.origin', '', true), set_config('imed.reason', '', true);
end $$;

/* ===================== Só o servidor ===================== */
select pg_temp.entrar('anon');
select throws_ok($$ select public.agenda_hold('c3210000-0000-4000-8000-000000000001', '[]', '{}', pg_temp.pid(90), 'x') $$,
                 '42501', null, 'visitante não executa agenda_hold');
select pg_temp.dona();
select throws_ok($$ select public.agenda_confirm(pg_temp.pid(90)) $$, '42501', null, 'logado (mesmo a dona) não executa agenda_confirm');
select throws_ok($$ select public.agenda_release(pg_temp.pid(90)) $$, '42501', null, 'nem agenda_release');

/* ===================== Reservar e confirmar ===================== */
select pg_temp.servidor();
select is(pg_temp.reservar(1, pg_temp.itens('rm', '09:00')) ->> 'status', 'ok', 'o servidor reserva a ressonância das 09:00');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', status, channel, hold_expires_at between now() + interval '9 minutes' and now() + interval '11 minutes')
           from public.appointment_requests where id = pg_temp.pid(1)), 'hold|externo|t', 'reserva com prazo de 10 minutos');
select is((select (o.hold_until - a.hold_expires_at)::text from agenda.occupancy o join agenda.appointment_items i on i.id = o.item_id
           join public.appointment_requests a on a.id = i.request_id where a.id = pg_temp.pid(1)), '00:05:00',
          'a ocupação segura até o prazo + a carência (5 min)');
select ok(not ('09:00' = any (pg_temp.horas('rm'))), 'o horário reservado sai da lista');
select pg_temp.dona();
select is((select count(*)::integer from jsonb_array_elements(public.agenda_requests('c3210000-0000-4000-8000-000000000001') -> 'requests') r
           where (r ->> 'id')::uuid = pg_temp.pid(1)), 0,
          'a clínica não vê a reserva na lista de pedidos (é da integração)');
select pg_temp.entrar('anon');
select is(pg_temp.marcar(2, pg_temp.itens('rm', '09:00')) ->> 'status', 'slot_taken', 'outro paciente no horário reservado: slot_taken');
select pg_temp.servidor();
select is(public.agenda_confirm(pg_temp.pid(1)) ->> 'status', 'ok', 'o servidor confirma no prazo');
select is(public.agenda_confirm(pg_temp.pid(1)) ->> 'replay', 'true', 'confirmar de novo: ok (replay)');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', a.status, coalesce(a.hold_expires_at::text, '-'), coalesce(o.hold_until::text, '-'), o.active)
           from public.appointment_requests a join agenda.appointment_items i on i.request_id = a.id join agenda.occupancy o on o.item_id = i.id
           where a.id = pg_temp.pid(1)), 'confirmed|-|-|t', 'confirmado: sem prazo no cabeçalho nem na ocupação');
select pg_temp.dona();
select is((select count(*)::integer from jsonb_array_elements(public.agenda_requests('c3210000-0000-4000-8000-000000000001') -> 'requests') r
           where (r ->> 'id')::uuid = pg_temp.pid(1)), 1, 'confirmado, a clínica vê (lista de pedidos pela função, 4.2)');

/* ===================== Reserva vencida: liberação preguiçosa ===================== */
select pg_temp.servidor();
select is(pg_temp.reservar(3, pg_temp.itens('rm', '10:00')) ->> 'status', 'ok', 'reserva das 10:00');
select pg_temp.entrar('postgres');
select pg_temp.vencer(3);
select ok('10:00' = any (pg_temp.horas('rm')), 'reserva vencida: o horário volta à lista (o motor ignora o prazo vencido)');
select pg_temp.entrar('anon');
select is(pg_temp.marcar(4, pg_temp.itens('rm', '10:00')) ->> 'status', 'ok',
          'o paciente marca o horário da reserva vencida (a marcação a expira antes de gravar)');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', a.status, a.cancel_reason, o.active, o.release_reason) from public.appointment_requests a
           join agenda.appointment_items i on i.request_id = a.id join agenda.occupancy o on o.item_id = i.id
           where a.id = pg_temp.pid(3)), 'expired|reserva_expirada|f|expirada', 'a reserva vencida virou "expirada" e soltou o recurso');
select is((select string_agg(to_status || ':' || origin || ':' || coalesce(reason_code, '-'), ',') from agenda.status_history
           where request_id = pg_temp.pid(3) and from_status = 'hold'), 'expired:cron:reserva_expirada', 'histórico: expirada pelo sistema');
select pg_temp.servidor();
select is(public.agenda_confirm(pg_temp.pid(3)) ->> 'status', 'expired', 'confirmar depois de expirar: expired');

/* ===================== Expirar pela rotina e soltar pelo servidor ===================== */
select is(pg_temp.reservar(5, pg_temp.itens('rm', '11:00')) ->> 'status', 'ok', 'reserva das 11:00');
select pg_temp.entrar('postgres');
select is(private.agenda_expire(pg_temp.pid(5)), false, 'no prazo, a rotina não expira');
select pg_temp.vencer(5);
select is(private.agenda_expire(pg_temp.pid(5)), true, 'vencida, a rotina expira (um pedido por vez, com SKIP LOCKED)');
select is(pg_temp.situacao(5), 'expired', 'expirada');
select pg_temp.servidor();
select is(pg_temp.reservar(6, pg_temp.itens('rm', '12:00')) ->> 'status', 'ok', 'reserva das 12:00');
select is(public.agenda_release(pg_temp.pid(6), 'texto livre') ->> 'status', 'invalid_reason', 'soltar com motivo fora da lista: invalid_reason');
select is(public.agenda_release(pg_temp.pid(6)) ->> 'status', 'ok', 'o sistema da clínica recusou: o servidor solta');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', status, cancelled_by, cancel_reason) from public.appointment_requests where id = pg_temp.pid(6)),
          'cancelled|external|clinica_indisponivel', 'solta: cancelada pelo sistema externo');
select ok('12:00' = any (pg_temp.horas('rm')), 'o 12:00 volta à lista');
select pg_temp.servidor();
select is(public.agenda_release(pg_temp.pid(1)) ->> 'status', 'transition_not_allowed', 'soltar um confirmado: transition_not_allowed');
select is(public.agenda_hold('c3210000-0000-4000-8000-000000000001', pg_temp.itens('rm', '13:00'),
            '{"name": "Sem Código", "phone": "11999990000", "consent": true}', pg_temp.pid(7), 'curto') ->> 'status', 'invalid',
          'reserva exige o código do pedido (16 caracteres ou mais)');

select * from finish();
rollback;
