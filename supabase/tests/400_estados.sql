-- Máquina de estados (iMed Agenda, fase 3.3; arquitetura §5 e §13, 400_estados), pelo agenda_set_status e pela
-- fachada set_request_status (mesma assinatura e respostas de hoje):
--   - transições da tabela agenda.status_transitions, com a permissão de cada uma: chegada, atendimento, concluído
--     (com e sem "chegou"), não compareceu, remarcação solicitada, cancelado; a transição que não existe:
--     transition_not_allowed; regras de horário: too_early / too_late; motivo: reason_required; versão;
--   - encerrar solta a ocupação (motivos concluido, faltou, cancelado); voltar a ocupar (faltou → presente, reabrir
--     cancelado pela equipe) passa pelo motor e dá slot_taken se o horário foi pego;
--   - por item (pacote): o cabeçalho é a soma dos itens; histórico por item, só com códigos;
--   - quem não é da clínica: forbidden; o cancelado pelo paciente a clínica não reabre (cancelled_by_patient).
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(43);
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
  select pg_temp.entrar('authenticated', 'a3400000-0000-4000-8000-000000000001', 'dona.estados@exemplo.test') $$;
create function pg_temp.recepcao() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3400000-0000-4000-8000-000000000002', 'recepcao.estados@exemplo.test') $$;
create function pg_temp.outra() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3400000-0000-4000-8000-000000000003', 'outra.estados@exemplo.test') $$;
create function pg_temp.admin() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a3400000-0000-4000-8000-000000000004', 'admin.estados@exemplo.test') $$;
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
-- o paciente marca (visitante): id "b3400000-...-0000000000NN", código "codigo-secreto-NN"
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b3400000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.marcar(p_n integer, p_itens jsonb) returns jsonb language sql as $$
  select public.agenda_book('c3400000-0000-4000-8000-000000000001', p_itens,
                            jsonb_build_object('name', 'Paciente ' || p_n, 'phone', '119' || lpad(p_n::text, 8, '0'), 'consent', true),
                            pg_temp.pid(p_n), 'codigo-secreto-' || lpad(p_n::text, 4, '0')) $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.horas(p_proc text) returns text[] language sql stable as $$
  select coalesce(array_agg(to_char(s.slot_start at time zone 'America/Sao_Paulo', 'HH24:MI') order by s.slot_start), '{}')
  from public.agenda_slots('c3400000-0000-4000-8000-000000000001', pg_temp.id(p_proc), pg_temp.dia(), pg_temp.dia()) s $$;
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
from (values ('a3400000-0000-4000-8000-000000000001'::uuid, 'dona.estados@exemplo.test'),
             ('a3400000-0000-4000-8000-000000000002'::uuid, 'recepcao.estados@exemplo.test'),
             ('a3400000-0000-4000-8000-000000000003'::uuid, 'outra.estados@exemplo.test'),
             ('a3400000-0000-4000-8000-000000000004'::uuid, 'admin.estados@exemplo.test')) u (id, email);
insert into public.admin_emails (email) values ('admin.estados@exemplo.test');
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua da Agenda, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values ('c3400000-0000-4000-8000-000000000001'::uuid, 'Clínica da Agenda estados', 1),
             ('c3400000-0000-4000-8000-000000000002'::uuid, 'Outra Clínica estados', 2)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  ('c3400000-0000-4000-8000-000000000001', 'a3400000-0000-4000-8000-000000000001', 'owner'),
  ('c3400000-0000-4000-8000-000000000001', 'a3400000-0000-4000-8000-000000000002', 'staff'),
  ('c3400000-0000-4000-8000-000000000002', 'a3400000-0000-4000-8000-000000000003', 'owner');
insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949'
where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1));

select pg_temp.dona();
-- no_show_after_min 0: "faltou" vale assim que o horário começa (o teste do "faltou → chegou no mesmo dia" precisa de um
-- agendamento já começado e ainda do mesmo dia em São Paulo, o que logo depois da meia-noite não cabe com 15 min de tolerância)
select public.agenda_unit_save('c3400000-0000-4000-8000-000000000001',
         jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_min', 30, 'no_show_after_min', 0));
select set_config('teste.usg1', public.agenda_resource_save('c3400000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "USG-1"}') ->> 'id', true);
select set_config('teste.usg2', public.agenda_resource_save('c3400000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "USG-2"}') ->> 'id', true);
select set_config('teste.rm1', public.agenda_resource_save('c3400000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "RM-1"}') ->> 'id', true);
select set_config('teste.usg', public.agenda_procedure_save('c3400000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('usg1')), jsonb_build_object('resource_id', pg_temp.id('usg2'), 'priority', 2)))))) ->> 'id', true);
select set_config('teste.rm', public.agenda_procedure_save('c3400000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'rm', 'name', 'Ressonância', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('rm1'))))))) ->> 'id', true);
-- aberta todos os dias, o dia inteiro (as regras de horário do atendimento usam o relógio de agora)
select public.agenda_rules_set('c3400000-0000-4000-8000-000000000001', null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d));
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_agenda', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now()
where id = 'c3400000-0000-4000-8000-000000000001';
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
create function pg_temp.st(p_n integer, p_status text, p_motivo text default null, p_item uuid default null, p_versao integer default null)
returns text language sql as $$
  select public.agenda_set_status(pg_temp.pid(p_n), p_status, p_motivo, p_versao, p_item) ->> 'status' $$;
create function pg_temp.soltas(p_n integer) returns text language sql stable as $$
  select string_agg(distinct o.release_reason, ',') from agenda.occupancy o join agenda.appointment_items i on i.id = o.item_id
  where i.request_id = pg_temp.pid(p_n) and not o.active $$;

select pg_temp.entrar('anon');
select is(pg_temp.marcar(1, pg_temp.itens('rm', '09:00')) ->> 'status', 'ok', 'agendamento 1 (ressonância)');
select is(pg_temp.marcar(2, pg_temp.itens('rm', '10:00')) ->> 'status', 'ok', 'agendamento 2');
select is(pg_temp.marcar(3, pg_temp.itens('rm', '11:00')) ->> 'status', 'ok', 'agendamento 3');
select is(pg_temp.marcar(4, pg_temp.itens('usg', '12:00', 'rm', '12:30')) ->> 'status', 'ok', 'agendamento 4 (pacote)');
select is(pg_temp.marcar(5, pg_temp.itens('rm', '13:00')) ->> 'status', 'ok', 'agendamento 5');
select pg_temp.entrar('postgres');
select set_config('teste.item42', (select i.id from agenda.appointment_items i where i.request_id = pg_temp.pid(4) and i.seq = 2)::text, true);

/* ===================== Regras de horário e permissões ===================== */
select pg_temp.recepcao();
select is(pg_temp.st(1, 'checked_in'), 'too_early', 'chegou 30 dias antes: too_early (janela de 2 h)');
select is(pg_temp.st(1, 'completed'), 'too_early', 'concluir antes do início: too_early');
select is(pg_temp.st(1, 'no_show'), 'too_early', 'faltou antes da tolerância: too_early');
select is(pg_temp.st(1, 'contacted'), 'transition_not_allowed', 'confirmado → em contato: transition_not_allowed');
select is(public.set_request_status(pg_temp.pid(1), 'contacted'), 'transition_not_allowed', 'a fachada responde o mesmo');
select is(pg_temp.st(1, 'checked_in', null, null, 9), 'version_conflict', 'versão velha: version_conflict');
select is(pg_temp.st(1, 'inventado'), 'invalid_status', 'situação desconhecida: invalid_status');
select pg_temp.outra();
select is(pg_temp.st(1, 'cancelled', 'outro'), 'forbidden', 'outra clínica: forbidden');
select is(public.set_request_status(pg_temp.pid(1), 'cancelled'), 'forbidden', 'a fachada também: forbidden');
select pg_temp.entrar('anon');
select throws_ok($$ select public.agenda_set_status(pg_temp.pid(1), 'cancelled', 'outro') $$, '42501', null,
                 'visitante não executa agenda_set_status');

/* ===================== Chegou, em atendimento, concluído ===================== */
select pg_temp.entrar('postgres');
select pg_temp.mover(1, now() + interval '30 minutes' - pg_temp.t('09:00'));   -- começa daqui a 30 min
select pg_temp.recepcao();
select is(pg_temp.st(1, 'checked_in'), 'ok', 'na janela de chegada: presente');
select is(pg_temp.st(1, 'in_service'), 'ok', 'em atendimento');
select is(pg_temp.st(1, 'completed'), 'ok', 'concluído');
select pg_temp.entrar('postgres');
select is(pg_temp.situacao(1) || '|' || pg_temp.ativos(1) || '|' || pg_temp.soltas(1), 'completed|0|concluido',
          'concluído solta a ocupação (motivo concluido)');
select is((select string_agg(from_status || '>' || to_status, ',' order by id) from agenda.status_history
           where request_id = pg_temp.pid(1) and item_id is not null), 'confirmed>checked_in,checked_in>in_service,in_service>completed',
          'histórico de cada item');
select is((select actor_kind || '|' || actor_role from agenda.status_history where request_id = pg_temp.pid(1) and to_status = 'completed'
           and item_id is null), 'clinica|staff', 'o cabeçalho registra quem (a clínica, papel staff)');
select pg_temp.entrar('anon');
select is(public.submit_review(pg_temp.pid(1), pg_temp.codigo(1), 5, 'Atendimento ótimo'), 'ok', 'concluído libera a avaliação do paciente');

/* ===================== Fluxo simples, falta e volta ===================== */
select pg_temp.entrar('postgres');
select pg_temp.mover(2, now() - interval '5 minutes' - pg_temp.t('10:00'));     -- começou há 5 min
-- começou há 40 min, mas nunca antes da meia-noite de hoje em São Paulo: das 00:00 às 00:40 (horário de Brasília) a conta
-- "agora − 40 min" caía no dia anterior e "faltou → chegou no mesmo dia" dava too_late (o CI das 00:04 reprovou os testes 27 a 29)
select pg_temp.mover(3, greatest(now() - interval '40 minutes', (now() at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'America/Sao_Paulo')
                        - pg_temp.t('11:00'));
select pg_temp.recepcao();
select is(public.set_request_status(pg_temp.pid(2), 'completed'), 'ok', 'concluir sem "chegou", depois do início (fachada de hoje)');
select is(pg_temp.st(3, 'no_show'), 'ok', 'não compareceu (passou a tolerância)');
select pg_temp.entrar('postgres');
select is(pg_temp.soltas(3), 'faltou', 'faltou solta a ocupação (motivo faltou)');
select pg_temp.recepcao();
select is(pg_temp.st(3, 'checked_in'), 'reason_required', 'faltou → chegou pede motivo');
select is(pg_temp.st(3, 'checked_in', 'chegou_atrasado'), 'ok', 'com motivo, no mesmo dia: presente');
select pg_temp.entrar('postgres');
select is(pg_temp.ativos(3), 1, 'voltou a ocupar a RM-1 (pelo motor)');
select is((select reason_code from agenda.status_history where request_id = pg_temp.pid(3) and to_status = 'checked_in' and item_id is null),
          'chegou_atrasado', 'o motivo fica no histórico (código)');

/* ===================== Por item (pacote) ===================== */
select pg_temp.recepcao();
select is(pg_temp.st(4, 'cancelled', 'paciente_nao_pode', pg_temp.id('item42')), 'ok', 'cancela só a ressonância do pacote');
select pg_temp.entrar('postgres');
select is((select string_agg(i.status, ',' order by i.seq) from agenda.appointment_items i where i.request_id = pg_temp.pid(4)) || '|'
          || pg_temp.situacao(4) || '|' || pg_temp.ativos(4), 'confirmed,cancelled|confirmed|1', 'o cabeçalho continua confirmado (a soma)');
select pg_temp.recepcao();
select is(pg_temp.st(4, 'reschedule_requested'), 'ok', 'remarcação solicitada');
select pg_temp.entrar('postgres');
select is(pg_temp.ativos(4), 1, 'a ocupação continua (remarcação solicitada segura o horário)');
select pg_temp.recepcao();
select is(public.set_request_status(pg_temp.pid(4), 'cancelled'), 'ok', 'a fachada cancela (motivo "outro")');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', status, cancelled_by, cancel_reason) from public.appointment_requests where id = pg_temp.pid(4))
          || '|' || pg_temp.ativos(4), 'cancelled|clinic|outro|0', 'cancelado pela clínica, sem ocupação');

/* ===================== Reabrir (só a equipe do IMED) ===================== */
select pg_temp.recepcao();
select is(pg_temp.st(4, 'confirmed'), 'transition_not_allowed', 'a clínica não reabre um cancelado');
select pg_temp.entrar('anon');
select is(public.cancel_request(pg_temp.pid(5), pg_temp.codigo(5)), 'ok', 'o paciente 5 cancela');
select pg_temp.recepcao();
select is(public.set_request_status(pg_temp.pid(5), 'confirmed'), 'cancelled_by_patient', 'a clínica não reabre o cancelado pelo paciente');
select pg_temp.entrar('anon');
select is(pg_temp.marcar(6, pg_temp.itens('rm', '13:00')) ->> 'status', 'ok', 'outro paciente pega o 13:00');
select pg_temp.admin();
select is(pg_temp.st(5, 'confirmed'), 'slot_taken', 'a equipe reabre o cancelado: o horário foi pego, slot_taken');
select is(pg_temp.st(4, 'confirmed'), 'ok', 'a equipe reabre o pacote cancelado (horário livre)');
select pg_temp.entrar('postgres');
select is(pg_temp.situacao(4) || '|' || pg_temp.ativos(4), 'confirmed|2', 'reaberto pelo motor: os dois exames ocupam de novo');
select pg_temp.admin();
select is(public.set_request_status(pg_temp.pid(1), 'cancelled'), 'transition_not_allowed', 'concluído não se cancela');

select * from finish();
rollback;
