-- Balcão e "só ocupar" (iMed Agenda, fase 3.3; arquitetura §5, §11 e §13, teste 2 "Agendamento externo (balcão)"):
--   - a recepção marca pelo telefone (agenda_desk_book): o horário some na hora para o paciente (agenda_slots e
--     available_slots, como visitante); o paciente que tenta o mesmo horário recebe slot_taken;
--   - o balcão pode marcar para daqui a pouco (a antecedência mínima vale só para o paciente);
--   - idempotência pela chave; canal inválido; outra clínica e visitante: forbidden / sem permissão;
--   - a equipe do IMED marca pelo canal imed_equipe;
--   - "só ocupar" (agenda_desk_busy), sem dado de paciente: por recurso ou pelos recursos de um procedimento; choque:
--     slot_taken; tirar o "ocupado" devolve o horário;
--   - bloqueio sobre agendamento marcado pelo motor: has_appointments com a lista, e nada gravado (teste 5).
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(32);
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
  select pg_temp.entrar('authenticated', 'a3310000-0000-4000-8000-000000000001', 'dona.balcao@exemplo.test') $$;
create function pg_temp.recepcao() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3310000-0000-4000-8000-000000000002', 'recepcao.balcao@exemplo.test') $$;
create function pg_temp.outra() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3310000-0000-4000-8000-000000000003', 'outra.balcao@exemplo.test') $$;
create function pg_temp.admin() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3310000-0000-4000-8000-000000000004', 'admin.balcao@exemplo.test') $$;
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
-- o paciente marca (visitante): id "b3310000-...-0000000000NN", código "codigo-secreto-NN"
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b3310000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.marcar(p_n integer, p_itens jsonb) returns jsonb language sql as $$
  select public.agenda_book('c3310000-0000-4000-8000-000000000001', p_itens,
                            jsonb_build_object('name', 'Paciente ' || p_n, 'phone', '119' || lpad(p_n::text, 8, '0'), 'consent', true),
                            pg_temp.pid(p_n), 'codigo-secreto-' || lpad(p_n::text, 4, '0')) $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.horas(p_proc text) returns text[] language sql stable as $$
  select coalesce(array_agg(to_char(s.slot_start at time zone 'America/Sao_Paulo', 'HH24:MI') order by s.slot_start), '{}')
  from public.agenda_slots('c3310000-0000-4000-8000-000000000001', pg_temp.id(p_proc), pg_temp.dia(), pg_temp.dia()) s $$;
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
from (values ('a3310000-0000-4000-8000-000000000001'::uuid, 'dona.balcao@exemplo.test'),
             ('a3310000-0000-4000-8000-000000000002'::uuid, 'recepcao.balcao@exemplo.test'),
             ('a3310000-0000-4000-8000-000000000003'::uuid, 'outra.balcao@exemplo.test'),
             ('a3310000-0000-4000-8000-000000000004'::uuid, 'admin.balcao@exemplo.test')) u (id, email);
insert into public.admin_emails (email) values ('admin.balcao@exemplo.test');
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua da Agenda, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values ('c3310000-0000-4000-8000-000000000001'::uuid, 'Clínica da Agenda balcao', 1),
             ('c3310000-0000-4000-8000-000000000002'::uuid, 'Outra Clínica balcao', 2)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  ('c3310000-0000-4000-8000-000000000001', 'a3310000-0000-4000-8000-000000000001', 'owner'),
  ('c3310000-0000-4000-8000-000000000001', 'a3310000-0000-4000-8000-000000000002', 'staff'),
  ('c3310000-0000-4000-8000-000000000002', 'a3310000-0000-4000-8000-000000000003', 'owner');
insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949'
where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1));

select pg_temp.dona();
select public.agenda_unit_save('c3310000-0000-4000-8000-000000000001',
         jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_min', 30));
select set_config('teste.usg1', public.agenda_resource_save('c3310000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "USG-1"}') ->> 'id', true);
select set_config('teste.usg2', public.agenda_resource_save('c3310000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "USG-2"}') ->> 'id', true);
select set_config('teste.rm1', public.agenda_resource_save('c3310000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "RM-1"}') ->> 'id', true);
select set_config('teste.usg', public.agenda_procedure_save('c3310000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('usg1')), jsonb_build_object('resource_id', pg_temp.id('usg2'), 'priority', 2)))))) ->> 'id', true);
select set_config('teste.rm', public.agenda_procedure_save('c3310000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'rm', 'name', 'Ressonância', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('rm1'))))))) ->> 'id', true);
-- aberta todos os dias, o dia inteiro (as regras de horário do atendimento usam o relógio de agora)
select public.agenda_rules_set('c3310000-0000-4000-8000-000000000001', null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d));
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_agenda', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now()
where id = 'c3310000-0000-4000-8000-000000000001';
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
create function pg_temp.balcao(p_itens jsonb, p_nome text, p_canal text default 'clinica_telefone', p_chave uuid default null)
returns jsonb language sql as $$
  select public.agenda_desk_book('c3310000-0000-4000-8000-000000000001', p_itens,
           jsonb_build_object('name', p_nome, 'phone', '(11) 98888-7777', 'consent', true), p_canal, p_chave) $$;
create function pg_temp.livres_anon(p_proc text, p_exam text) returns text[] language plpgsql as $$
declare v text[];
begin
  perform pg_temp.entrar('anon');
  v := array(select to_char(s.slot_start at time zone 'America/Sao_Paulo', 'HH24:MI') from public.available_slots(
               'c3310000-0000-4000-8000-000000000001', p_exam, pg_temp.dia(), 1) s order by 1);
  perform pg_temp.entrar('postgres');
  return v;
end $$;

/* ===================== A recepção marca pelo telefone ===================== */
select pg_temp.recepcao();
select set_config('teste.b1', pg_temp.balcao(pg_temp.itens('rm', '10:00'), 'Paciente do Telefone') ->> 'id', true);
select ok(current_setting('teste.b1') is not null, 'a recepção marca a ressonância das 10:00 pelo telefone');
select pg_temp.entrar('anon');
select ok(not ('10:00' = any (pg_temp.horas('rm'))), 'logo depois, o visitante não vê o 10:00 (agenda_slots)');
select pg_temp.entrar('postgres');
select ok(not ('10:00' = any (pg_temp.livres_anon('rm', 'rm'))), 'nem em available_slots');
select pg_temp.entrar('anon');
select is(pg_temp.marcar(1, pg_temp.itens('rm', '10:00')) ->> 'status', 'slot_taken', 'o paciente que tenta o 10:00: slot_taken');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', status, channel, patient_phone, coalesce(user_id::text, '-'), coalesce(review_token_hash, '-'), uses_resources)
           from public.appointment_requests where id = pg_temp.id('b1')), 'confirmed|clinica_telefone|11988887777|-|-|t',
          'cabeçalho: confirmado, canal telefone, telefone só com dígitos, sem conta e sem código');
select is((select actor_kind || '|' || origin || '|' || actor_role from agenda.status_history where request_id = pg_temp.id('b1')),
          'clinica|painel|staff', 'histórico: a clínica, pelo painel, com o papel');

/* ===================== Idempotência, canal e permissões ===================== */
select pg_temp.recepcao();
select is(pg_temp.balcao(pg_temp.itens('rm', '11:00'), 'Paciente da Chave', 'clinica_balcao', 'e3310000-0000-4000-8000-000000000001') ->> 'status', 'ok',
          'marca com chave de idempotência');
select is((pg_temp.balcao(pg_temp.itens('rm', '11:00'), 'Paciente da Chave', 'clinica_balcao', 'e3310000-0000-4000-8000-000000000001') ->> 'replay'), 'true',
          'reenvio com a mesma chave: replay (sem duplicar)');
select is(pg_temp.balcao(pg_temp.itens('rm', '11:30'), 'Paciente da Chave', 'clinica_balcao', 'e3310000-0000-4000-8000-000000000001') ->> 'status',
          'idempotency_conflict', 'a mesma chave com outro horário: idempotency_conflict');
select is(pg_temp.balcao(pg_temp.itens('rm', '12:00'), 'Canal Errado', 'imed_app') ->> 'status', 'invalid', 'canal inválido: invalid');
select pg_temp.outra();
select is(pg_temp.balcao(pg_temp.itens('rm', '12:00'), 'Outra Clínica') ->> 'status', 'forbidden', 'quem é de outra clínica: forbidden');
select pg_temp.entrar('anon');
select throws_ok($$ select pg_temp.balcao(pg_temp.itens('rm', '12:00'), 'Visitante') $$, '42501', null, 'visitante não executa o balcão');
select pg_temp.admin();
select set_config('teste.b2', pg_temp.balcao(pg_temp.itens('rm', '12:00'), 'Pela Equipe') ->> 'id', true);
select pg_temp.entrar('postgres');
select is((select a.channel from public.appointment_requests a where a.id = pg_temp.id('b2')), 'imed_equipe',
          'a equipe do IMED marca pelo canal imed_equipe');
select is((select count(*)::integer from public.appointment_requests where clinic_id = 'c3310000-0000-4000-8000-000000000001'), 3,
          'três agendamentos (nada duplicado)');

/* ===================== Para daqui a pouco ===================== */
select pg_temp.dona();
select is(public.agenda_unit_save('c3310000-0000-4000-8000-000000000001', '{"min_notice_min": 600}') ->> 'status', 'ok',
          'a unidade passa a pedir 10 horas de antecedência ao paciente');
select set_config('teste.logo', (date_trunc('hour', now()) + interval '2 hours')::text, true);
select pg_temp.entrar('anon');
select is(public.agenda_book('c3310000-0000-4000-8000-000000000001',
            jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id('usg'), 'starts_at', current_setting('teste.logo'))),
            '{"name": "Paciente Apressado", "phone": "11999990099", "consent": true}', pg_temp.pid(99), pg_temp.codigo(99)) ->> 'status',
          'slot_taken', 'o paciente não marca para daqui a 2 horas (antecedência de 10 h)');
select pg_temp.recepcao();
select is(public.agenda_desk_book('c3310000-0000-4000-8000-000000000001',
            jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id('usg'), 'starts_at', current_setting('teste.logo'))),
            '{"name": "Paciente no Balcão", "phone": "11999990098", "consent": true}') ->> 'status',
          'ok', 'o balcão marca para daqui a 2 horas');

/* ===================== Só ocupar ===================== */
select pg_temp.recepcao();
select set_config('teste.oc1', public.agenda_desk_busy('c3310000-0000-4000-8000-000000000001', pg_temp.t('14:00'), pg_temp.t('15:00'),
                                                       pg_temp.id('rm1')) ->> 'id', true);
select ok(current_setting('teste.oc1') is not null, 'a recepção ocupa a RM-1 das 14:00 às 15:00 (agenda própria)');
select ok(not ('14:00' = any (pg_temp.horas('rm')) or '14:30' = any (pg_temp.horas('rm'))), 'o 14:00 e o 14:30 somem');
select is(public.agenda_desk_busy('c3310000-0000-4000-8000-000000000001', pg_temp.t('10:00'), pg_temp.t('10:30'), pg_temp.id('rm1')) ->> 'status',
          'slot_taken', 'ocupar por cima de um agendamento: slot_taken');
select is(public.agenda_desk_busy('c3310000-0000-4000-8000-000000000001', pg_temp.t('16:00'), null, null, pg_temp.id('usg')) ->> 'status',
          'ok', 'ocupar pelos recursos do ultrassom (um aparelho)');
select ok('16:00' = any (pg_temp.horas('usg')), 'o ultrassom das 16:00 continua (há o segundo aparelho)');
select is(public.agenda_desk_busy('c3310000-0000-4000-8000-000000000001', pg_temp.t('16:00'), null, null, pg_temp.id('usg')) ->> 'status',
          'ok', 'ocupar de novo: o segundo aparelho');
select ok(not ('16:00' = any (pg_temp.horas('usg'))), 'agora o 16:00 do ultrassom some');
select is(public.agenda_desk_busy('c3310000-0000-4000-8000-000000000001', pg_temp.t('16:00'), null, null, pg_temp.id('usg')) ->> 'status',
          'slot_taken', 'o terceiro: slot_taken');
select is(public.agenda_desk_busy('c3310000-0000-4000-8000-000000000001', pg_temp.t('16:00'), null, null, null) ->> 'status',
          'invalid', 'sem recurso nem procedimento: invalid');
select is(public.agenda_desk_busy_remove(current_setting('teste.oc1')::uuid) ->> 'status', 'ok', 'tira o "ocupado" da RM-1');
select ok('14:00' = any (pg_temp.horas('rm')), 'o 14:00 volta');
select pg_temp.entrar('postgres');
select is((select count(*)::integer from agenda.busy_marks b where b.clinic_id = 'c3310000-0000-4000-8000-000000000001'
           and b.removed_at is not null), 1, 'remoção lógica (o registro fica)');
select is((select count(*)::integer from agenda.audit_log where clinic_id = 'c3310000-0000-4000-8000-000000000001'
           and action in ('ocupado.criar', 'ocupado.remover')), 4, 'auditoria do "ocupado" (sem dado de paciente)');

/* ===================== Bloqueio sobre agendamento do motor (teste 5) ===================== */
select pg_temp.dona();
select is((public.agenda_block_add('c3310000-0000-4000-8000-000000000001', pg_temp.id('rm1'), pg_temp.t('09:30'), pg_temp.t('10:30'),
                                   'manutencao') -> 'items' -> 0 ->> 'request_id')::uuid, pg_temp.id('b1'),
          'manutenção sobre o agendamento do telefone: has_appointments com ele na lista');
select pg_temp.entrar('postgres');
select is((select count(*)::integer from public.clinic_blocks where clinic_id = 'c3310000-0000-4000-8000-000000000001'), 0,
          'e nada foi gravado');

select * from finish();
rollback;
