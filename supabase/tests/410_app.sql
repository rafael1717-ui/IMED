-- "Horário direto" (iMed Agenda, fase 5.1; arquitetura §4 e §14): o que o site do paciente usa para marcar sozinho.
--   A. agenda_next_free (próximo horário livre na lista da busca): quem executa, SECURITY DEFINER com search_path vazio
--      e tempo-limite próprio; só clínica com a venda online ligada; o mesmo primeiro horário que agenda_slots mostra;
--      exame do pedido (padrão do exame); fuso da unidade (Manaus); limites da pergunta (10 clínicas, 1 a 14 dias,
--      código de exame estranho); nenhuma coluna de paciente; depois de marcado, o próximo livre anda;
--   B. tempo-limite por função nas leituras públicas (agenda_public_info, agenda_my_booking, available_slots,
--      clinics_with_schedule);
--   C. o contrato da marcação que o site segue: o mesmo id e código reenviados devolvem o mesmo agendamento (replay,
--      sem duplicar); dois pacientes no mesmo horário: só um confirma, o outro recebe slot_taken com outros horários
--      livres (sem o ocupado); o id que levou slot_taken não serve para outro horário (idempotency_conflict: o site gera
--      id novo); com id novo, o outro horário confirma; agenda_my_booking devolve o fuso e o fim real.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test; nomes fictícios.
begin;
select plan(38);

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
  select pg_temp.entrar('authenticated', 'a4100000-0000-4000-8000-000000000001', 'dona.app51@exemplo.test') $$;
-- clínicas: A (São Paulo, vende online), B (não vende online), M (Manaus, vende online)
create function pg_temp.a() returns uuid language sql immutable as $$ select 'c4100000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.b() returns uuid language sql immutable as $$ select 'c4100000-0000-4000-8000-000000000002'::uuid $$;
create function pg_temp.m() returns uuid language sql immutable as $$ select 'c4100000-0000-4000-8000-000000000003'::uuid $$;
-- o dia D (daqui a 3 dias, em São Paulo): a única grade aberta é a do dia da semana de D, das 08:00 às 10:00
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 3 $$;
create function pg_temp.t(p_hhmm text, p_tz text default 'America/Sao_Paulo') returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone p_tz $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.livre(p_clinics uuid[], p_exam text default null, p_days integer default 14) returns text language sql stable as $$
  select coalesce(string_agg(concat_ws('|', n.clinic_id, n.exam_code, n.slot_start, n.slot_end - n.slot_start, n.timezone), ' ' order by n.clinic_id), '-')
  from public.agenda_next_free(p_clinics, p_exam, p_days) n $$;
create function pg_temp.marcar(p_id uuid, p_hhmm text, p_tel text, p_codigo text default null) returns jsonb language sql as $$
  select public.agenda_book(pg_temp.a(), jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id('rm'), 'starts_at', pg_temp.t(p_hhmm))),
                            jsonb_build_object('name', 'Paciente Teste ' || right(p_tel, 4), 'phone', p_tel, 'consent', true),
                            p_id, coalesce(p_codigo, 'codigo-secreto-do-aparelho-' || p_id)) $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a4100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'dona.app51@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now());
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua do Horário Direto, ' || c.n, c.cidade, c.uf,
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values (pg_temp.a(), 'Clínica do Horário Direto', 1, 'São Paulo', 'SP'),
             (pg_temp.b(), 'Clínica Só de Pedido', 2, 'São Paulo', 'SP'),
             (pg_temp.m(), 'Clínica de Manaus', 3, 'Manaus', 'AM')) c (id, nome, n, cidade, uf);
insert into public.clinic_members (clinic_id, user_id, role)
select c, 'a4100000-0000-4000-8000-000000000001', 'owner' from unnest(array[pg_temp.a(), pg_temp.b(), pg_temp.m()]) c;
insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Fonte de teste (Lei 662/1949)'
where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1));

select pg_temp.dona();
select public.agenda_unit_save(c, jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_min', 30))
from unnest(array[pg_temp.a(), pg_temp.b()]) c;
select public.agenda_unit_save(pg_temp.m(), jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_min', 30,
                                                               'timezone', 'America/Manaus', 'confirm_timezone', true));
select set_config('teste.rm1_' || n, public.agenda_resource_save(c, '{"kind": "equipamento", "name": "RM-1"}') ->> 'id', true)
from unnest(array[pg_temp.a(), pg_temp.b(), pg_temp.m()]) with ordinality x (c, n);
select set_config('teste.usg1', public.agenda_resource_save(pg_temp.a(), '{"kind": "equipamento", "name": "USG-1"}') ->> 'id', true);
select set_config(case n when 1 then 'teste.rm' when 2 then 'teste.rm_b' else 'teste.rm_m' end,
       public.agenda_procedure_save(c, jsonb_build_object('exam_code', 'rm', 'name', 'Ressonância', 'duration_min', 30, 'default_for_exam', true,
         'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
           jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('rm1_' || n))))))) ->> 'id', true)
from unnest(array[pg_temp.a(), pg_temp.b(), pg_temp.m()]) with ordinality x (c, n);
-- uma 2ª ressonância na clínica A, NÃO padrão do exame, aberta mais cedo (07:00): o "próximo livre" do exame rm usa só a padrão
select set_config('teste.rm_extra', public.agenda_procedure_save(pg_temp.a(), jsonb_build_object('exam_code', 'rm', 'name', 'Ressonância com contraste',
         'duration_min', 60, 'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
           jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('usg1'))))))) ->> 'id', true);
select set_config('teste.usg', public.agenda_procedure_save(pg_temp.a(), jsonb_build_object('exam_code', 'usg', 'name', 'Ultrassom', 'duration_min', 20,
         'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
           jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('usg1'))))))) ->> 'id', true);
select public.agenda_rules_set(c, null, jsonb_build_array(jsonb_build_object('weekday', extract(dow from pg_temp.dia())::integer, 'start', '08:00', 'end', '10:00')))
from unnest(array[pg_temp.a(), pg_temp.b(), pg_temp.m()]) c;
-- o USG-1 abre às 07:00 no dia D (escala própria do recurso dentro da unidade não vale: a unidade abre às 08:00; então
-- a unidade A abre 07:00 e a RM-1 da A fica com a escala das 08:00)
select public.agenda_rules_set(pg_temp.a(), null, jsonb_build_array(jsonb_build_object('weekday', extract(dow from pg_temp.dia())::integer, 'start', '07:00', 'end', '10:00')));
select public.agenda_rules_set(pg_temp.a(), pg_temp.id('rm1_1'), jsonb_build_array(jsonb_build_object('weekday', extract(dow from pg_temp.dia())::integer, 'start', '08:00', 'end', '10:00')));
-- venda online ligada na A e na M (a 5.1 não traz função que liga: a clínica piloto é ligada pela equipe, registrado)
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_app', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = coalesce(timezone_confirmed_at, now()), agenda_online_since = now()
where id in (pg_temp.a(), pg_temp.m());
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now() where id = pg_temp.b();
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);

/* ===================== A. Próximo horário livre ===================== */
select ok(has_function_privilege('anon', 'public.agenda_next_free(uuid[], text, integer)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.agenda_next_free(uuid[], text, integer)', 'EXECUTE'),
          'agenda_next_free: visitante e conta executam');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""', 'statement_timeout=3s'] and p.provolatile = 's'
           from pg_proc p where p.oid = 'public.agenda_next_free(uuid[], text, integer)'::regprocedure),
          'agenda_next_free: SECURITY DEFINER, search_path vazio, só leitura e tempo-limite de 3 s');
select is(pg_get_function_result('public.agenda_next_free(uuid[], text, integer)'::regprocedure),
          'TABLE(clinic_id uuid, procedure_id uuid, exam_code text, slot_start timestamp with time zone, slot_end timestamp with time zone, timezone text, agenda_mode text)',
          'devolve só clínica, procedimento, exame, horário, fuso e modalidade (nada de paciente)');

select pg_temp.entrar('anon');
select is(pg_temp.livre(array[pg_temp.a()], 'rm'),
          concat_ws('|', pg_temp.a(), 'rm', pg_temp.t('08:00'), '00:30:00', 'America/Sao_Paulo'),
          'clínica A, ressonância: o primeiro livre é o de D às 08:00 (São Paulo), com 30 min, do procedimento padrão');
select is((select n.agenda_mode from public.agenda_next_free(array[pg_temp.a()], 'rm') n), 'nativa',
          'com a modalidade da agenda (para o selo honesto da lista)');
select is((select n.procedure_id from public.agenda_next_free(array[pg_temp.a()], 'rm') n), pg_temp.id('rm'),
          'o procedimento é o padrão do exame (a outra ressonância, aberta às 07:00, não entra)');
select is((select n.slot_start from public.agenda_next_free(array[pg_temp.a()], 'rm') n),
          (select min(s.slot_start) from public.agenda_slots(pg_temp.a(), pg_temp.id('rm')) s),
          'o mesmo primeiro horário que agenda_slots mostra na página do local');
select is(pg_temp.livre(array[pg_temp.a()], null),
          concat_ws('|', pg_temp.a(), 'rm', pg_temp.t('07:00'), '01:00:00', 'America/Sao_Paulo'),
          'sem exame: o mais cedo entre os procedimentos à venda (a ressonância com contraste, 07:00, 60 min)');
select is(pg_temp.livre(array[pg_temp.a()], 'usg'), concat_ws('|', pg_temp.a(), 'usg', pg_temp.t('07:00'), '00:20:00', 'America/Sao_Paulo'),
          'exame ultrassom: o procedimento dele');
select is(pg_temp.livre(array[pg_temp.a()], 'tc'), '-', 'exame que a clínica não vende online: nada');
select is(pg_temp.livre(array[pg_temp.b()], 'rm'), '-', 'clínica sem a venda online ligada: nada (continua no pedido)');
select is(pg_temp.livre(array[pg_temp.m()], 'rm'),
          concat_ws('|', pg_temp.m(), 'rm', pg_temp.t('08:00', 'America/Manaus'), '00:30:00', 'America/Manaus'),
          'clínica de Manaus: 08:00 no horário de Manaus (o fuso vem junto)');
select is(pg_temp.livre(array[pg_temp.m(), pg_temp.b(), pg_temp.a()], 'rm'),
          concat_ws(' ', concat_ws('|', pg_temp.a(), 'rm', pg_temp.t('08:00'), '00:30:00', 'America/Sao_Paulo'),
                    concat_ws('|', pg_temp.m(), 'rm', pg_temp.t('08:00', 'America/Manaus'), '00:30:00', 'America/Manaus')),
          'várias clínicas de uma vez: uma linha por clínica com horário');
-- limites da pergunta
select is(pg_temp.livre(array[pg_temp.a()], 'rm', 3), '-', 'até 3 dias (hoje e os 2 seguintes): D fica de fora');
select is(pg_temp.livre(array[pg_temp.a()], 'rm', 4), concat_ws('|', pg_temp.a(), 'rm', pg_temp.t('08:00'), '00:30:00', 'America/Sao_Paulo'),
          'até 4 dias: D entra');
select is(pg_temp.livre(array[pg_temp.a()], 'rm', 0), '-', 'dias abaixo de 1 viram 1 (só hoje)');
select is(pg_temp.livre(array[pg_temp.a()], 'rm', 500), concat_ws('|', pg_temp.a(), 'rm', pg_temp.t('08:00'), '00:30:00', 'America/Sao_Paulo'),
          'dias acima de 14 viram 14');
select is(pg_temp.livre(array(select gen_random_uuid() from generate_series(1, 10)) || pg_temp.a(), 'rm'), '-',
          'mais de 10 clínicas: só as 10 primeiras (a 11ª fica de fora)');
select is(pg_temp.livre(array[pg_temp.a()] || array(select gen_random_uuid() from generate_series(1, 30)), 'rm'),
          concat_ws('|', pg_temp.a(), 'rm', pg_temp.t('08:00'), '00:30:00', 'America/Sao_Paulo'), 'a 1ª de 31 entra');
select is(pg_temp.livre(array[pg_temp.a(), pg_temp.a(), pg_temp.a()], 'rm'),
          concat_ws('|', pg_temp.a(), 'rm', pg_temp.t('08:00'), '00:30:00', 'America/Sao_Paulo'), 'repetida conta uma vez');
select is(pg_temp.livre(null, 'rm') || pg_temp.livre('{}', 'rm') || pg_temp.livre(array[pg_temp.a()], 'RM')
          || pg_temp.livre(array[pg_temp.a()], 'rm'' or 1=1') || pg_temp.livre(array[null::uuid], 'rm'), '-----',
          'sem clínica, lista vazia, código de exame estranho ou id nulo: nada');

-- o atalho (recurso sem nenhum tempo livre no prazo não roda o motor) e o motor dizem a mesma coisa
select pg_temp.dona();
select set_config('teste.bloq', public.agenda_block_add(pg_temp.m(), pg_temp.id('rm1_3'), now(), now() + interval '20 days', 'bloqueio', 'manutencao')::text, true);
select pg_temp.entrar('anon');
select is(current_setting('teste.bloq')::jsonb ->> 'status', 'ok', 'a RM-1 de Manaus fica em manutenção pelos próximos 20 dias');
select is(pg_temp.livre(array[pg_temp.m()], 'rm'), '-', 'aparelho parado o prazo inteiro: sem próximo horário (o atalho)');
select pg_temp.dona();
select public.agenda_block_remove((current_setting('teste.bloq')::jsonb ->> 'id')::uuid);
select pg_temp.entrar('anon');
select is(pg_temp.livre(array[pg_temp.m()], 'rm'),
          concat_ws('|', pg_temp.m(), 'rm', pg_temp.t('08:00', 'America/Manaus'), '00:30:00', 'America/Manaus'),
          'manutenção retirada: o horário volta');

/* ===================== B. Tempo-limite nas leituras públicas ===================== */
select is((select string_agg(p.proname || ':' || coalesce((select c from unnest(p.proconfig) c where c like 'statement_timeout=%'), 'sem'), ' ' order by p.proname)
           from pg_proc p where p.oid in ('public.agenda_public_info(uuid)'::regprocedure, 'public.agenda_my_booking(uuid, text)'::regprocedure,
                                          'public.available_slots(uuid, text, date, integer)'::regprocedure, 'public.clinics_with_schedule(uuid[])'::regprocedure)),
          'agenda_my_booking:statement_timeout=2s agenda_public_info:statement_timeout=2s available_slots:statement_timeout=2s clinics_with_schedule:statement_timeout=2s',
          'as 4 leituras públicas que não tinham ganham 2 s');
select ok((select bool_and(p.proconfig @> array['search_path=""'])
           from pg_proc p where p.oid in ('public.agenda_public_info(uuid)'::regprocedure, 'public.agenda_my_booking(uuid, text)'::regprocedure,
                                          'public.available_slots(uuid, text, date, integer)'::regprocedure, 'public.clinics_with_schedule(uuid[])'::regprocedure)),
          'e continuam com o search_path vazio');
select is(public.agenda_public_info(pg_temp.a()) ->> 'online', 'true', 'agenda_public_info continua respondendo (venda ligada na A)');

/* ===================== C. O contrato da marcação que o site segue ===================== */
-- 1º paciente: id e código gravados no aparelho ANTES do envio; confirma às 08:00
select is(pg_temp.marcar('b4100000-0000-4000-8000-000000000001', '08:00', '11999995101') ->> 'status', 'ok',
          '1º paciente marca D às 08:00: confirmado na hora');
-- a resposta se perdeu (rede caiu) e o aparelho reenvia com o MESMO id e código: o mesmo agendamento, sem duplicar
select is((select concat_ws('|', r ->> 'status', r ->> 'replay', r ->> 'request_status')
           from (select pg_temp.marcar('b4100000-0000-4000-8000-000000000001', '08:00', '11999995101') r) x), 'ok|true|confirmed',
          'reenvio com o mesmo id e código: replay do mesmo agendamento');
select pg_temp.entrar('postgres');
select is((select count(*)::int from public.appointment_requests a where a.clinic_id = pg_temp.a() and a.slot_start = pg_temp.t('08:00')), 1,
          'só um agendamento gravado');
select pg_temp.entrar('anon');
-- 2º paciente, mesmo horário, ao mesmo tempo (um aparelho diferente): slot_taken com outros horários
select set_config('teste.taken', pg_temp.marcar('b4100000-0000-4000-8000-000000000002', '08:00', '11999995102')::text, true);
select is(current_setting('teste.taken')::jsonb ->> 'status', 'slot_taken', '2º paciente no mesmo horário: slot_taken');
select ok((select jsonb_array_length(j -> 'alternatives') >= 1
                  and not (j -> 'alternatives') @> to_jsonb(array[pg_temp.t('08:00')])
                  and (j -> 'alternatives' ->> 0)::timestamptz = pg_temp.t('08:30')
           from (select current_setting('teste.taken')::jsonb j) x),
          'e recebe outros horários livres do dia, sem o ocupado (o próximo é 08:30)');
select pg_temp.entrar('postgres');
select is((select count(*)::int from public.appointment_requests a where a.id = 'b4100000-0000-4000-8000-000000000002'), 0,
          'nada gravado para o 2º');
select pg_temp.entrar('anon');
select is(pg_temp.marcar('b4100000-0000-4000-8000-000000000002', '08:30', '11999995102') ->> 'status', 'idempotency_conflict',
          'o id que levou slot_taken não serve para outro horário: o site gera um id novo');
select is(pg_temp.marcar('b4100000-0000-4000-8000-000000000003', '08:30', '11999995102') ->> 'status', 'ok',
          'com id novo, o 2º paciente confirma às 08:30');
select is(pg_temp.livre(array[pg_temp.a()], 'rm'), concat_ws('|', pg_temp.a(), 'rm', pg_temp.t('09:00'), '00:30:00', 'America/Sao_Paulo'),
          'o próximo horário livre anda para as 09:00');
select is((select concat_ws('|', j ->> 'status', j ->> 'request_status', j ->> 'timezone', (j ->> 'slot_start')::timestamptz = pg_temp.t('08:30'),
                            (j ->> 'slot_end')::timestamptz - (j ->> 'slot_start')::timestamptz, j -> 'items' -> 0 ->> 'procedure')
           from (select public.agenda_my_booking('b4100000-0000-4000-8000-000000000003', 'codigo-secreto-do-aparelho-b4100000-0000-4000-8000-000000000003') j) x),
          'ok|confirmed|America/Sao_Paulo|t|00:30:00|Ressonância',
          'agenda_my_booking (com o código do aparelho): confirmado, fuso da unidade, início e fim reais e o procedimento');
select is(public.agenda_my_booking('b4100000-0000-4000-8000-000000000003', 'codigo-errado-de-outro-aparelho-qualquer') ->> 'status', 'not_found',
          'com outro código: nada');

select * from finish();
rollback;
