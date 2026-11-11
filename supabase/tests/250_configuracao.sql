-- Cadastros e configuração da agenda (iMed Agenda, fase 3.2; arquitetura §2.4, §3.2 itens 4 e 5, §12):
--   A. quem configura: visitante não executa; staff (recepção) e dona de OUTRA clínica: forbidden; a dona: ok
--      (origem painel); a equipe do IMED (dono do IMED): ok (origem central); auditoria só com ids e códigos;
--   B. entrar na agenda nova: clínica com faixas do editor antigo é recusada (old_schedule_exists) até apagá-las;
--      depois, o editor antigo responde managed_by_agenda e não grava; a trava exclusiva de configuração fica presa
--      até o fim da transação (quem marca na 3.3 espera);
--   C. revalidação: mudar as regras ou a higienização de um jeito que tira um agendamento futuro do lugar responde
--      affects_appointments e NÃO grava nada; com a confirmação, grava e abre conflito 'grade_mudou'; feriado
--      lançado pela equipe abre o conflito na hora; trocar o fuso com agendamento futuro é recusado;
--   D. as funções de hoje na clínica da agenda nova: available_slots e clinics_with_schedule só com a venda online
--      (e então pelo motor, com o procedimento padrão da categoria); recurso novo herda o bloqueio da unidade;
--      a versão da agenda sobe.
-- Agendamentos com horário ainda não têm função (3.3): aqui são gravados com a marca de emergência do SQL.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(45);
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
  select pg_temp.entrar('authenticated', 'a3250000-0000-4000-8000-000000000001', 'dona.config@exemplo.test') $$;
create function pg_temp.staff() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3250000-0000-4000-8000-000000000002', 'staff.config@exemplo.test') $$;
create function pg_temp.outra() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3250000-0000-4000-8000-000000000003', 'outra.config@exemplo.test') $$;
create function pg_temp.admin() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3250000-0000-4000-8000-000000000004', 'admin.config@exemplo.test') $$;
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.regras(variadic p jsonb[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x || jsonb_build_object('weekday', extract(dow from pg_temp.dia())::integer)), '[]'::jsonb) from unnest(p) x $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
-- agendamento confirmado com horário na clínica C, recurso R, vaga 1 (marca de emergência do SQL; a função vem na 3.3)
create function pg_temp.item(p_de text, p_ate text) returns uuid language plpgsql as $$
declare
  v_req uuid;
  v_item uuid;
begin
  perform set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_configuracao', true);
  insert into public.appointment_requests (clinic_id, place_source, place_name, exam_code, preferred_date, patient_name,
                                           patient_phone, consent, status, slot_start, slot_end, uses_resources)
  values ('c3250000-0000-4000-8000-000000000001', 'imed', 'Clínica da Configuração', 'usg', pg_temp.dia(),
          'Paciente da Configuração', '11999990032', true, 'confirmed', pg_temp.t(p_de), pg_temp.t(p_ate), true)
  returning id into v_req;
  insert into agenda.appointment_items (request_id, clinic_id, seq, procedure_id, exam_code, starts_at, ends_at, local_start,
                                        tz, groups, status)
  values (v_req, 'c3250000-0000-4000-8000-000000000001', 1, pg_temp.id('p'), 'usg', pg_temp.t(p_de), pg_temp.t(p_ate),
          pg_temp.dia() + p_de::time, 'America/Sao_Paulo', '{1}', 'confirmed')
  returning id into v_item;
  insert into agenda.occupancy (clinic_id, resource_id, kind, seats, during, item_id, group_no)
  values ('c3250000-0000-4000-8000-000000000001', pg_temp.id('r'), 'agendamento', int4range(1, 2),
          tstzrange(pg_temp.t(p_de), pg_temp.t(p_ate), '[)'), v_item, 1);
  perform set_config('imed.origin', '', true), set_config('imed.reason', '', true);
  return v_item;
end $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from (values ('a3250000-0000-4000-8000-000000000001'::uuid, 'dona.config@exemplo.test'),
             ('a3250000-0000-4000-8000-000000000002'::uuid, 'staff.config@exemplo.test'),
             ('a3250000-0000-4000-8000-000000000003'::uuid, 'outra.config@exemplo.test'),
             ('a3250000-0000-4000-8000-000000000004'::uuid, 'admin.config@exemplo.test')) u (id, email);
insert into public.admin_emails (email) values ('admin.config@exemplo.test');
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua da Configuração, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values ('c3250000-0000-4000-8000-000000000001'::uuid, 'Clínica da Configuração', 1),
             ('c3250000-0000-4000-8000-000000000002'::uuid, 'Outra Clínica da Configuração', 2),
             ('c3250000-0000-4000-8000-000000000003'::uuid, 'Clínica do Editor Antigo', 3),
             ('c3250000-0000-4000-8000-000000000004'::uuid, 'Clínica Antiga com Grade', 4)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  ('c3250000-0000-4000-8000-000000000001', 'a3250000-0000-4000-8000-000000000001', 'owner'),
  ('c3250000-0000-4000-8000-000000000001', 'a3250000-0000-4000-8000-000000000002', 'staff'),
  ('c3250000-0000-4000-8000-000000000002', 'a3250000-0000-4000-8000-000000000003', 'owner');
-- faixas do editor antigo (clínicas 3 e 4)
insert into public.clinic_schedules (clinic_id, weekday, start_time, end_time, slot_minutes, exam_codes)
values ('c3250000-0000-4000-8000-000000000003', 1, '08:00', '12:00', 30, '{}'),
       ('c3250000-0000-4000-8000-000000000004', 1, '08:00', '12:00', 30, '{}');
insert into agenda.holidays (scope, day, name, source)
values ('nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949');

/* ===================== A. Quem configura ===================== */
select pg_temp.entrar('anon');
select throws_ok($$select public.agenda_unit_save('c3250000-0000-4000-8000-000000000001', '{}')$$, '42501', null,
                 'visitante não executa agenda_unit_save');
select pg_temp.staff();
select is(public.agenda_unit_save('c3250000-0000-4000-8000-000000000001', '{}') ->> 'status', 'forbidden',
          'recepção (staff) não configura a agenda');
select pg_temp.outra();
select is(public.agenda_unit_save('c3250000-0000-4000-8000-000000000001', '{}') ->> 'status', 'forbidden',
          'dona de outra clínica não configura esta');
select is(public.agenda_rules_set('c3250000-0000-4000-8000-000000000001', null, '[]') ->> 'status', 'forbidden',
          'nem as regras desta');
select pg_temp.dona();
select is(public.agenda_resource_save('c3250000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "USG"}') ->> 'status',
          'agenda_not_started', 'recurso antes de entrar na agenda nova: agenda_not_started');
select is(public.agenda_unit_save('c3250000-0000-4000-8000-000000000001',
            jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_minutos', 5)) ->> 'status',
          'invalid', 'chave desconhecida: invalid');
select is(public.agenda_unit_save('c3250000-0000-4000-8000-000000000001',
            jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0)) ->> 'status',
          'ok', 'a dona coloca a clínica na agenda nova');
select ok((select count(*) = 1 from pg_locks l
           where l.pid = pg_backend_pid() and l.locktype = 'advisory' and l.mode = 'ExclusiveLock' and l.classid = 7101
             and l.objid::bigint = (hashtext('c3250000-0000-4000-8000-000000000001')::bigint + 4294967296) % 4294967296),
          'a trava EXCLUSIVA de configuração da clínica fica presa até o fim da transação');
select pg_temp.admin();
select is(public.agenda_unit_save('c3250000-0000-4000-8000-000000000002', '{}') ->> 'status', 'ok',
          'a equipe do IMED (dono do IMED) configura qualquer clínica');
select pg_temp.entrar('postgres');
select is(array(select actor_kind || ' ' || coalesce(actor_role, '-') || ' ' || origin || ' ' || action from agenda.audit_log
                where object_type = 'unit_settings' order by id),
          array['clinica owner painel unidade.criar', 'imed imed_admin central unidade.criar'],
          'auditoria: quem (papel), de onde e o quê');

/* ===================== B. Editor antigo × agenda nova ===================== */
select pg_temp.admin();
select is(public.agenda_unit_save('c3250000-0000-4000-8000-000000000003', '{}') ->> 'status', 'old_schedule_exists',
          'clínica com faixas do editor antigo não entra na agenda nova (nada é convertido no escuro)');
select is(public.set_my_schedule('c3250000-0000-4000-8000-000000000003', '[]'), 'ok', 'o editor antigo apaga as faixas');
select is(public.agenda_unit_save('c3250000-0000-4000-8000-000000000003', '{}') ->> 'status', 'ok', 'aí entra');
select is(public.set_my_schedule('c3250000-0000-4000-8000-000000000003',
            '[{"weekday": 1, "start": "08:00", "end": "12:00", "slot_minutes": 30}]'), 'managed_by_agenda',
          'depois, o editor antigo responde managed_by_agenda');
select pg_temp.entrar('postgres');
select is((select count(*)::integer from public.clinic_schedules where clinic_id = 'c3250000-0000-4000-8000-000000000003'), 0,
          '... e não grava nada');
select pg_temp.dona();
select is(public.set_my_schedule('c3250000-0000-4000-8000-000000000001', '[]'), 'managed_by_agenda',
          'na clínica da dona também (managed_by_agenda)');

/* ===================== Cadastro da clínica C ===================== */
select set_config('teste.r', public.agenda_resource_save('c3250000-0000-4000-8000-000000000001',
                                '{"kind": "equipamento", "name": "USG-1"}') ->> 'id', true);
select set_config('teste.p', public.agenda_procedure_save('c3250000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom de abdome', 'duration_min', 30, 'step_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento',
                                    'options', jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('r'))))))) ->> 'id', true);
select is(public.agenda_rules_set('c3250000-0000-4000-8000-000000000001', null,
            pg_temp.regras('{"start": "08:00", "end": "12:00"}')) ->> 'status', 'ok', 'regras: 08:00–12:00 no dia do teste');
select pg_temp.entrar('postgres');
select ok(pg_temp.id('r') is not null and pg_temp.id('p') is not null, 'recurso e procedimento cadastrados');

/* ===================== D. As funções de hoje na agenda nova ===================== */
select pg_temp.entrar('anon');
select is((select count(*)::integer from public.available_slots('c3250000-0000-4000-8000-000000000001', 'usg', pg_temp.dia(), 1)), 0,
          'available_slots: sem venda online, nenhum horário (nada muda para o site)');
select is(array(select clinic_id from public.clinics_with_schedule(array['c3250000-0000-4000-8000-000000000001',
                                                                          'c3250000-0000-4000-8000-000000000004']::uuid[])),
          '{}'::uuid[],
          'clinics_with_schedule: a da agenda nova sem venda online, não; a antiga com grade também não (3.3: a grade antiga não oferece horário)');
select pg_temp.dona();
select set_config('teste.pd', public.agenda_procedure_save('c3250000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom padrão', 'duration_min', 60, 'step_min', 60, 'default_for_exam', true,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento',
                                    'options', jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('r'))))))) ->> 'id', true);
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_configuracao', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now()
where id = 'c3250000-0000-4000-8000-000000000001';
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
select pg_temp.entrar('anon');
select is(array(select to_char(a.slot_start at time zone 'America/Sao_Paulo', 'HH24:MI')
                from public.available_slots('c3250000-0000-4000-8000-000000000001', 'usg', pg_temp.dia(), 1) a),
          array['08:00', '09:00', '10:00', '11:00'],
          'available_slots com a venda online: o motor, pelo procedimento PADRÃO da categoria (60 min de 60 em 60)');
select is(array(select clinic_id from public.clinics_with_schedule(array['c3250000-0000-4000-8000-000000000001',
                                                                          'c3250000-0000-4000-8000-000000000004']::uuid[]) order by 1),
          array['c3250000-0000-4000-8000-000000000001']::uuid[],
          'clinics_with_schedule: com a venda online, a clínica da agenda nova entra (só ela)');
select is((select count(*)::integer from public.available_slots('c3250000-0000-4000-8000-000000000001', 'rm', pg_temp.dia(), 1)), 0,
          'categoria sem procedimento: nenhum horário');

/* ===================== C. Revalidação ===================== */
select pg_temp.entrar('postgres');
select set_config('teste.i1', pg_temp.item('09:00', '09:30')::text, true);
select set_config('teste.i2', pg_temp.item('09:30', '10:00')::text, true);
select ok(private.agenda_item_fits(pg_temp.id('i1')) and private.agenda_item_fits(pg_temp.id('i2')),
          'os dois agendamentos (09:00 e 09:30) cabem na configuração');
select pg_temp.dona();
select is(public.agenda_rules_set('c3250000-0000-4000-8000-000000000001', null,
            pg_temp.regras('{"start": "09:30", "end": "12:00"}')) #>> '{items,0,item_id}', pg_temp.id('i1')::text,
          'abrir só às 09:30 tira o das 09:00: affects_appointments com a lista (sem dado de paciente)');
select pg_temp.entrar('postgres');
select is((select string_agg(to_char(start_time, 'HH24:MI'), ',') from public.clinic_schedules
           where clinic_id = 'c3250000-0000-4000-8000-000000000001' and resource_id is null), '08:00',
          '... e NADA foi gravado (as regras continuam 08:00–12:00)');
select is((select count(*)::integer from agenda.conflicts where clinic_id = 'c3250000-0000-4000-8000-000000000001'), 0,
          '... nem conflito aberto');
select pg_temp.dona();
select is(public.agenda_rules_set('c3250000-0000-4000-8000-000000000001', null,
            pg_temp.regras('{"start": "09:30", "end": "12:00"}'), true) - 'rules',
          jsonb_build_object('status', 'ok', 'conflicts', 1), 'com a confirmação: grava e conta 1 conflito');
select pg_temp.entrar('postgres');
select is(array(select kind || ' ' || status || ' ' || (item_id = pg_temp.id('i1')) from agenda.conflicts
                where clinic_id = 'c3250000-0000-4000-8000-000000000001'),
          array['grade_mudou aberto true'], 'conflito grade_mudou aberto para o agendamento das 09:00');
select pg_temp.dona();
select is(public.agenda_rules_set('c3250000-0000-4000-8000-000000000001', null,
            pg_temp.regras('{"start": "08:00", "end": "12:00"}')) ->> 'status', 'ok', 'volta a abrir às 08:00 (nada fica fora)');
select is(public.agenda_resource_save('c3250000-0000-4000-8000-000000000001',
            jsonb_build_object('id', pg_temp.id('r'), 'cleanup_min', 10)) #>> '{items,0,item_id}', pg_temp.id('i1')::text,
          'higienização de 10 min no USG-1: o das 09:00 encosta no das 09:30 e sai na lista');
select is(public.agenda_resource_save('c3250000-0000-4000-8000-000000000001',
            jsonb_build_object('id', pg_temp.id('r'), 'cleanup_min', 10)) -> 'items' -> 1, null,
          '... só ele (o das 09:30 tem a sala livre depois)');
select pg_temp.entrar('postgres');
select is((select cleanup_min::integer from agenda.resources where id = pg_temp.id('r')), 0, '... e a higienização não mudou');
select pg_temp.dona();
select is(public.agenda_unit_save('c3250000-0000-4000-8000-000000000001', '{"timezone": "America/Manaus"}') ->> 'status',
          'online_active', 'trocar o fuso com a venda online ligada: online_active');
select is(public.agenda_holiday_save(jsonb_build_object('scope', 'nacional', 'day', pg_temp.dia(), 'name', 'Feriado de teste',
                                                        'source', 'Lei de teste')) ->> 'status', 'forbidden',
          'a clínica não lança feriado (é da equipe do IMED)');
select pg_temp.admin();
select is(public.agenda_holiday_save(jsonb_build_object('scope', 'nacional', 'day', pg_temp.dia(), 'name', 'Feriado de teste')) ->> 'status',
          'invalid', 'feriado sem a fonte (lei, decreto ou portaria): invalid');
select is(public.agenda_holiday_save(jsonb_build_object('scope', 'nacional', 'day', pg_temp.dia(), 'name', 'Feriado de teste',
                                                        'source', 'Lei de teste')) - 'id',
          jsonb_build_object('status', 'ok', 'conflicts', 2), 'a equipe lança o feriado: os 2 agendamentos do dia deixam de caber');
select is(public.agenda_holiday_save(jsonb_build_object('scope', 'nacional', 'day', pg_temp.dia(), 'name', 'Outro nome',
                                                        'source', 'Lei de teste')) ->> 'status', 'duplicate',
          'o mesmo feriado de novo: duplicate');
select pg_temp.entrar('postgres');
select is(array(select (item_id = pg_temp.id('i1'))::text || ' ' || kind from agenda.conflicts
                where clinic_id = 'c3250000-0000-4000-8000-000000000001' and status = 'aberto' order by 1),
          array['false grade_mudou', 'true grade_mudou'], 'um conflito aberto por agendamento (o das 09:00 não duplicou)');
select set_config('teste.feriado', (select id from agenda.holidays where day = pg_temp.dia())::text, true);
select pg_temp.admin();
select is(public.agenda_holiday_remove(pg_temp.id('feriado')) ->> 'status', 'ok',
          'a equipe tira o feriado lançado por engano');
select pg_temp.dona();
select is(public.agenda_resource_save('c3250000-0000-4000-8000-000000000001',
            jsonb_build_object('id', pg_temp.id('r'), 'capacity', 1, 'active', false)) ->> 'status', 'has_appointments',
          'desativar o aparelho com agendamentos futuros: has_appointments');

/* ===================== Bloqueio herdado, versão, auditoria ===================== */
select is(public.agenda_block_add('c3250000-0000-4000-8000-000000000001', null, pg_temp.t('13:00'), pg_temp.t('14:00')) ->> 'status',
          'ok', 'bloqueio da unidade inteira (13:00–14:00)');
select set_config('teste.r2', public.agenda_resource_save('c3250000-0000-4000-8000-000000000001',
                                 '{"kind": "sala", "name": "Sala nova"}') ->> 'id', true);
select pg_temp.entrar('postgres');
select is((select count(*)::integer from agenda.occupancy where resource_id = pg_temp.id('r2') and kind = 'bloqueio' and active
             and during = tstzrange(pg_temp.t('13:00'), pg_temp.t('14:00'), '[)')), 1,
          'recurso criado depois herda o bloqueio futuro da unidade');
select ok((select version from agenda.clinic_versions where clinic_id = 'c3250000-0000-4000-8000-000000000001') >= 8,
          'a versão da agenda da clínica subiu a cada mudança gravada');
select is((select count(*)::integer from agenda.audit_log
           where clinic_id = 'c3250000-0000-4000-8000-000000000001' and origin <> 'sql'
             and (coalesce(old_value::text, '') || coalesce(new_value::text, '')) ~* '(paciente|usg-1|sala nova|ultrassom|"name")'), 0,
          'auditoria sem nomes (de paciente, de recurso ou de procedimento) nem texto livre');

select * from finish();
rollback;
