-- Marcar pelo motor novo (iMed Agenda, fase 3.3; arquitetura §3, §6 e §13, testes 6 "Vários exames" e idempotência):
--   - agenda_book como visitante: confirma na hora, grava cabeçalho, item e ocupação; dois aparelhos = dois pacientes
--     no mesmo horário; o terceiro recebe slot_taken com alternativas; início fora da grade também;
--   - idempotência: o mesmo id, código e horários devolve o mesmo resultado (replay, sem duplicar); horários
--     diferentes ou outro código com o mesmo id: idempotency_conflict;
--   - recusas: venda online desligada, sem consentimento, telefone inválido, chave desconhecida, menor sem o
--     responsável, limite de agendamentos futuros por telefone;
--   - pacote (até 4 exames, tudo ou nada): grava todos; exames que se cruzam ou fora da ordem da regra de par:
--     invalid_package; o 2º sem lugar: slot_taken e NADA gravado (nem o 1º);
--   - opções de pacote (agenda_package_options);
--   - conferência no COMMIT (I2): item confirmado sem a ocupação de um grupo é recusado;
--   - o caminho antigo com horário (INSERT direto com slot_start) é recusado com 23P01 e a mensagem de sempre.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(42);
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
  select pg_temp.entrar('authenticated', 'a3230000-0000-4000-8000-000000000001', 'dona.marcar@exemplo.test') $$;
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.paciente(p_nome text, p_tel text default '11999990023') returns jsonb language sql as $$
  select jsonb_build_object('name', p_nome, 'phone', p_tel, 'consent', true) $$;
create function pg_temp.itens(variadic p text[]) returns jsonb language sql stable as $$
  -- pares "procedimento", "HH:MM"
  select jsonb_agg(jsonb_build_object('procedure_id', pg_temp.id(p[i]), 'starts_at', pg_temp.t(p[i + 1])) order by i)
  from generate_series(1, cardinality(p), 2) i $$;
create function pg_temp.marcar(p_id text, p_itens jsonb, p_pac jsonb default null, p_codigo text default null) returns jsonb language sql as $$
  select public.agenda_book('c3230000-0000-4000-8000-000000000001', p_itens, coalesce(p_pac, pg_temp.paciente('Paciente ' || right(p_id, 4), '119' || right(p_id, 8))),
                            p_id::uuid, coalesce(p_codigo, 'codigo-secreto-' || p_id)) $$;
create function pg_temp.ativos(p_pedido text) returns integer language sql stable as $$
  select count(*)::integer from agenda.occupancy o join agenda.appointment_items i on i.id = o.item_id
  where i.request_id = p_pedido::uuid and o.active $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a3230000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'dona.marcar@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now());
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua da Marcação, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values ('c3230000-0000-4000-8000-000000000001'::uuid, 'Clínica da Marcação', 1),
             ('c3230000-0000-4000-8000-000000000002'::uuid, 'Clínica Sem Venda Online', 2)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  ('c3230000-0000-4000-8000-000000000001', 'a3230000-0000-4000-8000-000000000001', 'owner'),
  ('c3230000-0000-4000-8000-000000000002', 'a3230000-0000-4000-8000-000000000001', 'owner');
insert into agenda.holidays (scope, day, name, source)
values ('nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949')
on conflict do nothing;

select pg_temp.dona();
select public.agenda_unit_save(c, jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0))
from unnest(array['c3230000-0000-4000-8000-000000000001', 'c3230000-0000-4000-8000-000000000002']::uuid[]) c;
select set_config('teste.usg1', public.agenda_resource_save('c3230000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "USG-1"}') ->> 'id', true);
select set_config('teste.usg2', public.agenda_resource_save('c3230000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "USG-2"}') ->> 'id', true);
select set_config('teste.rm1', public.agenda_resource_save('c3230000-0000-4000-8000-000000000001', '{"kind": "equipamento", "name": "RM-1", "cleanup_min": 15}') ->> 'id', true);
select set_config('teste.usg', public.agenda_procedure_save('c3230000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom', 'duration_min', 30, 'step_min', 30, 'price_cents', 15000,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('usg1')), jsonb_build_object('resource_id', pg_temp.id('usg2'), 'priority', 2)))))) ->> 'id', true);
select set_config('teste.rm', public.agenda_procedure_save('c3230000-0000-4000-8000-000000000001', jsonb_build_object(
  'exam_code', 'rm', 'name', 'Ressonância', 'duration_min', 30, 'step_min', 15,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('rm1'))))))) ->> 'id', true);
select public.agenda_rules_set('c3230000-0000-4000-8000-000000000001', null,
         jsonb_build_array(jsonb_build_object('weekday', extract(dow from pg_temp.dia())::integer, 'start', '08:00', 'end', '12:00')));
-- venda online ligada (nenhuma função liga antes da 5.1: só a marca de emergência, registrada)
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_marcar', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now()
where id = 'c3230000-0000-4000-8000-000000000001';
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);

/* ===================== Marcar como visitante ===================== */
select pg_temp.entrar('anon');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000001', pg_temp.itens('usg', '08:00')) ->> 'status', 'ok',
          'visitante marca o ultrassom das 08:00');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000002', pg_temp.itens('usg', '08:00')) ->> 'status', 'ok',
          'outro visitante marca o mesmo horário (há dois aparelhos)');
select is((pg_temp.marcar('b3230000-0000-4000-8000-000000000003', pg_temp.itens('usg', '08:00')) - 'alternatives' - 'seq') ->> 'status', 'slot_taken',
          'o terceiro no mesmo horário: slot_taken');
select is(jsonb_array_length(pg_temp.marcar('b3230000-0000-4000-8000-000000000004', pg_temp.itens('usg', '08:00')) -> 'alternatives'), 5,
          'slot_taken traz até 5 alternativas');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000005', pg_temp.itens('usg', '08:15')) ->> 'status', 'slot_taken',
          'início fora da grade (08:15, passo de 30 min): slot_taken');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', status, uses_resources, channel, slot_start = pg_temp.t('08:00'), slot_end = pg_temp.t('08:30'),
                            coalesce(user_id::text, '-'), review_token_hash = encode(extensions.digest('codigo-secreto-b3230000-0000-4000-8000-000000000001', 'sha256'), 'hex'),
                            total_cents, preferred_period, place_source, version)
           from public.appointment_requests where id = 'b3230000-0000-4000-8000-000000000001'),
          'confirmed|t|imed_app|t|t|-|t|15000|manha|imed|1', 'cabeçalho: confirmado, motor novo, horário, código (SHA-256), preço');
select is((select string_agg(r.name || ':' || lower(o.seats), ',' order by r.name)
           from agenda.occupancy o join agenda.resources r on r.id = o.resource_id join agenda.appointment_items i on i.id = o.item_id
           where i.request_id in ('b3230000-0000-4000-8000-000000000001', 'b3230000-0000-4000-8000-000000000002') and o.active),
          'USG-1:1,USG-2:1', 'um aparelho para cada (a prioridade da clínica primeiro)');
select is((select count(*)::integer from public.appointment_requests where id::text like 'b3230000-0000-4000-8000-00000000000%'), 2,
          'as recusas não deixaram pedido');
select is((select to_status || '|' || actor_kind || '|' || origin from agenda.status_history
           where request_id = 'b3230000-0000-4000-8000-000000000001'), 'confirmed|paciente|app', 'histórico do nascimento (só códigos)');
select ok(exists (select 1 from agenda.rate_counters where key = 'agenda_book.clinica:c3230000-0000-4000-8000-000000000001' and n = 2),
          'contador da clínica por hora (só os agendamentos feitos)');

/* ===================== Idempotência ===================== */
select pg_temp.entrar('anon');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000001', pg_temp.itens('usg', '08:00')) - 'slot_start' - 'slot_end' - 'items' - 'hold_expires_at',
          jsonb_build_object('status', 'ok', 'id', 'b3230000-0000-4000-8000-000000000001', 'request_status', 'confirmed', 'replay', true),
          'reenvio com o mesmo id, código e horário: replay com a situação atual');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000001', pg_temp.itens('usg', '09:00')) ->> 'status', 'idempotency_conflict',
          'mesmo id e código com outro horário: idempotency_conflict');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000001', pg_temp.itens('usg', '09:00'), null, 'outro-codigo-qualquer') ->> 'status',
          'idempotency_conflict', 'mesmo id com outro código: idempotency_conflict (não revela nada do agendamento)');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000003', pg_temp.itens('usg', '08:00')) ->> 'status', 'slot_taken',
          'o id que recebeu slot_taken repete slot_taken (o app gera id novo para outro horário)');
select pg_temp.entrar('postgres');
select is((select count(*)::integer from public.appointment_requests where clinic_id = 'c3230000-0000-4000-8000-000000000001'), 2,
          'nada duplicado');

/* ===================== Recusas ===================== */
select pg_temp.entrar('anon');
select is(public.agenda_book('c3230000-0000-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('procedure_id', 'e3230000-0000-4000-8000-000000000099',
            'starts_at', pg_temp.t('09:00'))), pg_temp.paciente('Paciente X'), 'b3230000-0000-4000-8000-000000000010', 'codigo-secreto-x-0010') ->> 'status',
          'not_found', 'procedimento que não é da clínica: not_found');
select is(public.agenda_book('c3230000-0000-4000-8000-000000000002', '[]'::jsonb, pg_temp.paciente('Paciente X'),
            'b3230000-0000-4000-8000-000000000011', 'codigo-secreto-x-0011') ->> 'status', 'invalid', 'sem item: invalid');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000012', pg_temp.itens('usg', '09:00'),
            jsonb_build_object('name', 'Sem Consentimento', 'phone', '11999990023', 'consent', false)) ->> 'status',
          'consent_required', 'sem consentimento: consent_required');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000013', pg_temp.itens('usg', '09:00'),
            jsonb_build_object('name', 'Telefone Ruim', 'phone', '123', 'consent', true)) ->> 'status',
          'invalid_patient', 'telefone inválido: invalid_patient');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000014', pg_temp.itens('usg', '09:00'),
            jsonb_build_object('name', 'Chave Errada', 'phone', '11999990023', 'consent', true, 'cpf', '1')) ->> 'status',
          'invalid', 'chave desconhecida no paciente: invalid (nada é guardado em silêncio)');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000015', pg_temp.itens('usg', '09:00'),
            jsonb_build_object('name', 'Mãe', 'phone', '11999990023', 'consent', true, 'for_other', true, 'other_name', 'Filho',
                               'relationship', 'Filho', 'other_minor', true)),
          jsonb_build_object('status', 'invalid_patient', 'message', 'Para menor de 18 anos, é preciso o consentimento do responsável legal'),
          'menor sem o consentimento do responsável: a mesma regra do pedido de hoje');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000016', pg_temp.itens('usg', '09:00'), pg_temp.paciente('Mesmo Telefone', '11988887777')) ->> 'status', 'ok',
          'mesmo telefone: 1º');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000017', pg_temp.itens('usg', '09:30'), pg_temp.paciente('Mesmo Telefone', '11988887777')) ->> 'status', 'ok',
          'mesmo telefone: 2º');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000018', pg_temp.itens('usg', '10:00'), pg_temp.paciente('Mesmo Telefone', '11988887777')) ->> 'status', 'ok',
          'mesmo telefone: 3º');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000019', pg_temp.itens('usg', '10:30'), pg_temp.paciente('Mesmo Telefone', '11988887777')) ->> 'status',
          'too_many_bookings', 'mesmo telefone: o 4º futuro na mesma clínica é recusado');
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_marcar', true);
update public.clinics set agenda_online_since = null where id = 'c3230000-0000-4000-8000-000000000001';
select pg_temp.entrar('anon');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000020', pg_temp.itens('usg', '11:00')) ->> 'status', 'not_online',
          'venda online desligada: not_online');
select pg_temp.entrar('postgres');
update public.clinics set agenda_online_since = now() where id = 'c3230000-0000-4000-8000-000000000001';
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);

/* ===================== Pacote: tudo ou nada ===================== */
select pg_temp.entrar('anon');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000030', pg_temp.itens('usg', '10:30', 'rm', '11:00')) ->> 'status', 'ok',
          'pacote: ultrassom 10:30 e ressonância 11:00 (a higienização da RM, 15 min, cabe até as 12:00)');
select pg_temp.entrar('postgres');
select is(pg_temp.ativos('b3230000-0000-4000-8000-000000000030'), 2, 'pacote: duas ocupações (um aparelho por exame)');
select pg_temp.entrar('anon');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000031', pg_temp.itens('usg', '10:00', 'rm', '10:15')) ->> 'status',
          'invalid_package', 'exames do pacote que se cruzam: invalid_package');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000032', pg_temp.itens('usg', '08:30', 'rm', '11:00')) - 'alternatives',
          jsonb_build_object('status', 'slot_taken', 'seq', 2), 'o 2º exame sem lugar (RM das 11:00 já ocupada): slot_taken no item 2');
select pg_temp.entrar('postgres');
select is((select count(*)::integer from public.appointment_requests where id = 'b3230000-0000-4000-8000-000000000032')
          + (select count(*)::integer from agenda.occupancy o join agenda.resources r on r.id = o.resource_id
             where r.clinic_id = 'c3230000-0000-4000-8000-000000000001' and o.active and o.during && tstzrange(pg_temp.t('08:30'), pg_temp.t('09:00'))),
          0, 'tudo ou nada: o ultrassom das 08:30 (1º item) também não ficou gravado');
select pg_temp.dona();
select is(public.agenda_pair_rules_set('c3230000-0000-4000-8000-000000000001', jsonb_build_array(jsonb_build_object(
            'first_procedure', pg_temp.id('rm'), 'second_procedure', pg_temp.id('usg'), 'rule', 'ordem'))) ->> 'status', 'ok',
          'regra de par: ressonância antes do ultrassom');
select pg_temp.entrar('anon');
select is(pg_temp.marcar('b3230000-0000-4000-8000-000000000033', pg_temp.itens('usg', '09:00', 'rm', '09:45')) ->> 'status',
          'invalid_package', 'fora da ordem da regra de par: invalid_package');
select is((select jsonb_agg(x.value -> 'items' -> 0 ->> 'procedure_id') from jsonb_array_elements(
             public.agenda_package_options('c3230000-0000-4000-8000-000000000001', array[pg_temp.id('usg'), pg_temp.id('rm')], pg_temp.dia())
             -> 'options') x) = (select jsonb_agg(pg_temp.id('rm')::text) from generate_series(1, 5)), true,
          'opções de pacote: 5, todas com a ressonância primeiro (a regra de ordem)');
select is((public.agenda_package_options('c3230000-0000-4000-8000-000000000001', array[pg_temp.id('usg'), pg_temp.id('rm')], pg_temp.dia())
           -> 'options' -> 0 ->> 'wait_min')::integer, 0, 'a melhor opção não tem espera');
select is(public.agenda_package_options('c3230000-0000-4000-8000-000000000001', array[pg_temp.id('usg')], pg_temp.dia()) ->> 'status',
          'invalid', 'opções de pacote pedem 2 a 4 procedimentos');

/* ===================== Conferência no COMMIT (I2) ===================== */
select pg_temp.entrar('postgres');
select throws_ok($$
  do $b$
  begin
    perform set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_i2', true);
    update agenda.occupancy set active = false, released_at = now(), release_reason = 'corrigido'
    where item_id = (select id from agenda.appointment_items where request_id = 'b3230000-0000-4000-8000-000000000001');
    set constraints all immediate;
  end $b$
$$, '23514', null, 'item confirmado sem a ocupação do grupo: recusado no COMMIT (I2), até pelo SQL de emergência');
select throws_ok($$
  do $b$
  begin
    perform set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_i2', true);
    update public.appointment_requests set status = 'completed' where id = 'b3230000-0000-4000-8000-000000000002';
    set constraints all immediate;
  end $b$
$$, '23514', null, 'cabeçalho diferente da soma dos itens: recusado no COMMIT (I2)');

/* ===================== O caminho antigo com horário acabou ===================== */
select pg_temp.entrar('anon');
select throws_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent, slot_start)
  values ('b3230000-0000-4000-8000-000000000040', 'c3230000-0000-4000-8000-000000000001', 'imed', 'Clínica da Marcação',
    'usg', pg_temp.dia(), 'Caminho Antigo', '11999990040', true, pg_temp.t('11:30'))
$$, '23P01', 'Este horário não está mais livre. Escolha outro.', 'INSERT direto com horário: recusado (23P01, a mensagem de sempre)');
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent)
  values ('b3230000-0000-4000-8000-000000000041', 'c3230000-0000-4000-8000-000000000001', 'imed', 'Clínica da Marcação',
    'usg', pg_temp.dia(), 'Pedido Sem Horário', '11999990041', true)
$$, 'o pedido SEM horário continua igual');
select ok(pg_temp.t('11:30') = any (array(select a.slot_start from public.available_slots('c3230000-0000-4000-8000-000000000001', 'usg', pg_temp.dia(), 1) a)),
          'available_slots responde pela agenda nova (o 11:30 do ultrassom está livre)');
select is(array(select clinic_id from public.clinics_with_schedule(array['c3230000-0000-4000-8000-000000000001', 'c3230000-0000-4000-8000-000000000002']::uuid[])),
          array['c3230000-0000-4000-8000-000000000001']::uuid[], 'clinics_with_schedule: só a clínica com venda online');

select * from finish();
rollback;
