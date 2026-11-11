-- Isolamento entre clínicas (iMed Agenda, fase 3.4; arquitetura §12 e §13, teste 9 "Isolamento"):
--   - a dona da clínica A chama cada função do painel e da equipe com ids da clínica B: forbidden, not_found ou vazio;
--   - leitura direta (como o PostgREST): pedidos de B vazios para A; schema agenda negado;
--   - canal do Realtime: agenda:clinica:B recusado para quem é de A; o financeiro (sem agenda.ver) não ouve nem a
--     própria clínica; o profissional (escopo 'propria') ouve; agenda:imed só a equipe do IMED; tópico estranho, não;
--   - visitante não executa nenhuma função do painel.
-- A parte do WebSocket de verdade (entrar no canal) está em tests/banco/tempo-real.mjs.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(19);
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
create function pg_temp.u(p_n integer) returns uuid language sql immutable as $$
  select ('a3300000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['donaa', 'donab', 'fina', 'profa', 'admin'])[p_n] || '.isolamento@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.ca() returns uuid language sql immutable as $$ select 'c3300000-0000-4000-8000-00000000000a'::uuid $$;
create function pg_temp.cb() returns uuid language sql immutable as $$ select 'c3300000-0000-4000-8000-00000000000b'::uuid $$;
create function pg_temp.dia() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date + 20 $$;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated', pg_temp.email(n), now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from generate_series(1, 5) n;
insert into public.admin_emails (email) values (pg_temp.email(5));
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua do Isolamento, 1', 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values (pg_temp.ca(), 'Clínica A do Isolamento'), (pg_temp.cb(), 'Clínica B do Isolamento')) c (id, nome);
insert into public.clinic_members (clinic_id, user_id, role) values
  (pg_temp.ca(), pg_temp.u(1), 'owner'), (pg_temp.cb(), pg_temp.u(2), 'owner'),
  (pg_temp.ca(), pg_temp.u(3), 'finance'), (pg_temp.ca(), pg_temp.u(4), 'professional');

insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949'
where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1));
-- a clínica B com agenda, um aparelho, um procedimento e um agendamento de balcão
select pg_temp.como(2);
select public.agenda_unit_save(pg_temp.cb(), jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_min', 30));
select set_config('teste.rb', public.agenda_resource_save(pg_temp.cb(), '{"kind": "equipamento", "name": "USG-B"}') ->> 'id', true);
select set_config('teste.pb', public.agenda_procedure_save(pg_temp.cb(), jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom B', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', current_setting('teste.rb')::uuid)))))) ->> 'id', true);
select public.agenda_rules_set(pg_temp.cb(), null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d));
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_agenda', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now() where id = pg_temp.cb();
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
select pg_temp.como(2);
select set_config('teste.bb', public.agenda_desk_book(pg_temp.cb(),
         jsonb_build_array(jsonb_build_object('procedure_id', current_setting('teste.pb')::uuid,
                                              'starts_at', (pg_temp.dia() + time '09:00') at time zone 'America/Sao_Paulo')),
         '{"name": "Paciente da Clínica B", "phone": "(11) 95555-4444", "consent": true}', 'clinica_telefone') ->> 'id', true);
select set_config('teste.ib', (select public.agenda_invite(pg_temp.cb(), 'novo.isolamento@exemplo.test', 'reception') ->> 'id'), true);
select pg_temp.entrar('postgres');
insert into agenda.conflicts (clinic_id, kind, request_id, details)
values (pg_temp.cb(), 'grade_mudou', current_setting('teste.bb')::uuid, '{}');
select set_config('teste.kb', (select id::text from agenda.conflicts where clinic_id = pg_temp.cb()), true);

/* ===================== A dona de A com ids de B ===================== */
select pg_temp.como(1);
select ok(current_setting('teste.bb', true) is not null, 'a clínica B tem um agendamento');
select is(array(select x from unnest(array[
    'version ' || (public.agenda_version(pg_temp.cb()) ->> 'status'),
    'view ' || (public.agenda_view(pg_temp.cb(), pg_temp.dia(), 1) ->> 'status'),
    'month ' || (public.agenda_month(pg_temp.cb(), pg_temp.dia()) ->> 'status'),
    'search ' || (public.agenda_search(pg_temp.cb(), 'paciente') ->> 'status'),
    'detail ' || (public.agenda_request_detail(current_setting('teste.bb')::uuid) ->> 'status'),
    'history ' || (public.agenda_history(current_setting('teste.bb')::uuid) ->> 'status'),
    'dashboard ' || (public.agenda_dashboard(pg_temp.cb(), pg_temp.dia(), pg_temp.dia()) ->> 'status'),
    'financeiro ' || (public.agenda_dashboard_financeiro(pg_temp.cb(), pg_temp.dia(), pg_temp.dia()) ->> 'status'),
    'conflicts ' || (public.agenda_conflicts(pg_temp.cb()) ->> 'status'),
    'resolve ' || (public.agenda_conflict_resolve(current_setting('teste.kb')::uuid, 'resolvido', 'teste_isolamento') ->> 'status'),
    'team ' || (public.agenda_team(pg_temp.cb()) ->> 'status'),
    'invite ' || (public.agenda_invite(pg_temp.cb(), 'x.isolamento@exemplo.test', 'reception') ->> 'status'),
    'invite_cancel ' || (public.agenda_invite_cancel(current_setting('teste.ib')::uuid) ->> 'status'),
    'member_role ' || (public.agenda_member_role(pg_temp.cb(), pg_temp.u(2), 'manager') ->> 'status'),
    'member_remove ' || (public.agenda_member_remove(pg_temp.cb(), pg_temp.u(2)) ->> 'status'),
    'set_status ' || (public.agenda_set_status(current_setting('teste.bb')::uuid, 'cancelled', 'clinica_indisponivel') ->> 'status'),
    'cancel ' || (public.agenda_cancel(current_setting('teste.bb')::uuid, 'clinica_indisponivel') ->> 'status'),
    -- 4.2
    'catalog ' || (public.agenda_catalog(pg_temp.cb()) ->> 'status'),
    'free ' || (public.agenda_free(pg_temp.cb(), pg_temp.dia(), 1) ->> 'status'),
    'desk_slots ' || (public.agenda_desk_slots(pg_temp.cb(), current_setting('teste.pb')::uuid, pg_temp.dia()) ->> 'status'),
    'blocks ' || (public.agenda_blocks(pg_temp.cb()) ->> 'status'),
    'requests ' || (public.agenda_requests(pg_temp.cb()) ->> 'status'),
    'block_force ' || (public.agenda_block_force(pg_temp.cb(), null, (pg_temp.dia() + time '08:00') at time zone 'America/Sao_Paulo',
                                                 (pg_temp.dia() + time '12:00') at time zone 'America/Sao_Paulo') ->> 'status'),
    'block_force_confirm ' || (public.agenda_block_force(pg_temp.cb(), null, (pg_temp.dia() + time '08:00') at time zone 'America/Sao_Paulo',
                                                 (pg_temp.dia() + time '12:00') at time zone 'America/Sao_Paulo', 'bloqueio', null, 'x') ->> 'status'),
    'attend ' || (public.agenda_attend(current_setting('teste.bb')::uuid, 'checked_in') ->> 'status')]) x
  where x !~ ' (forbidden|not_found)$' order by 1), '{}'::text[],
  'todas as funções do painel, da equipe e da recepção (4.2) com ids da clínica B respondem forbidden/not_found para a dona de A');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', status, (select count(*) from public.clinic_members where clinic_id = pg_temp.cb()),
                            (select status from agenda.member_invites where id = current_setting('teste.ib')::uuid))
           from public.appointment_requests where id = current_setting('teste.bb')::uuid),
          'confirmed|1|aberto', 'e nada de B mudou (agendamento, equipe, convite)');
select is((select count(*)::int from agenda.access_log where user_id = pg_temp.u(1)), 0, 'nenhuma leitura de A em B registrada (nada foi lido)');

/* ===================== Leitura direta (PostgREST) ===================== */
select pg_temp.como(1);
select is((select count(*)::int from public.appointment_requests where clinic_id = pg_temp.cb()), 0, 'REST: os pedidos de B não aparecem para A');
select throws_ok($$ select count(*) from agenda.appointment_items $$, '42501', null, 'REST: agenda.* negado');
select throws_ok($$ select count(*) from agenda.member_invites $$, '42501', null, 'REST: convites negados');
select pg_temp.como(3);
select throws_ok($$ select count(*) from public.clinic_schedules where clinic_id = pg_temp.ca() $$, '42501', null,
                 'REST: horários da clínica só pelas funções (a leitura direta fecha na 4.2)');
select is((select count(*)::int from public.appointment_requests where clinic_id = pg_temp.ca()), 0,
          'REST: o financeiro de A não lê os pedidos da própria clínica');

/* ===================== Canal do Realtime ===================== */
select pg_temp.como(1);
select is(public.agenda_realtime_ok('agenda:clinica:' || pg_temp.ca()), true, 'canal: a dona de A ouve a clínica A');
select is(public.agenda_realtime_ok('agenda:clinica:' || pg_temp.cb()), false, 'canal: a dona de A NÃO ouve a clínica B');
select is(public.agenda_realtime_ok('agenda:imed'), false, 'canal: agenda:imed só para a equipe do IMED');
select is(public.agenda_realtime_ok('agenda:clinica:' || pg_temp.ca() || ':x'), false, 'canal: tópico fora do formato, não');
select pg_temp.como(3);
select is(public.agenda_realtime_ok('agenda:clinica:' || pg_temp.ca()), false, 'canal: o financeiro (sem agenda.ver) não ouve');
select pg_temp.como(4);
select is(public.agenda_realtime_ok('agenda:clinica:' || pg_temp.ca()), true, 'canal: o profissional (própria agenda) ouve o aviso');
select pg_temp.como(5);
select is(public.agenda_realtime_ok('agenda:imed') and public.agenda_realtime_ok('agenda:clinica:' || pg_temp.cb()), true,
          'canal: a equipe do IMED ouve agenda:imed e as clínicas');
select pg_temp.entrar('postgres');
select is((select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages'
           and policyname = 'agenda: avisos da agenda' and cmd = 'SELECT' and roles = '{authenticated}'), 1,
          'realtime.messages: uma policy só de leitura, para quem está logado');
select is((select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages' and cmd in ('INSERT', 'ALL')
           and policyname like 'agenda%'), 0, 'nenhuma policy da agenda deixa o cliente publicar');

/* ===================== Visitante ===================== */
select is(array(select f from unnest(array['public.agenda_me()', 'public.agenda_view(uuid,date,integer)',
                  'public.agenda_request_detail(uuid,text)', 'public.agenda_search(uuid,text)', 'public.agenda_team(uuid)',
                  'public.agenda_invite_accept(uuid)', 'public.agenda_realtime_ok(text)', 'public.agenda_version(uuid)',
                  'public.agenda_catalog(uuid)', 'public.agenda_free(uuid,date,integer)',
                  'public.agenda_desk_slots(uuid,uuid,date,date,uuid,uuid)', 'public.agenda_blocks(uuid,date,date)',
                  'public.agenda_requests(uuid,text,text)', 'public.agenda_block_force(uuid,uuid,timestamptz,timestamptz,text,text,text)',
                  'public.agenda_attend(uuid,text,text,integer,uuid)']) f
                where has_function_privilege('anon', f, 'EXECUTE')), '{}'::text[], 'visitante não executa nenhuma função do painel');

select * from finish();
rollback;
