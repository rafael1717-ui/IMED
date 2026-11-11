-- Pedido novo pelo site sobe a versão da agenda (iMed Agenda, fase 4.3; migração agenda_aviso_pedido; arquitetura §7):
--   - o visitante pede SEM horário numa clínica parceira (INSERT direto, o fluxo antigo): a versão da clínica sobe
--     (o painel e a aba Pedidos releem sozinhos pelo vigia de tempo-real.js);
--   - um segundo pedido sobe de novo; pedido ao IMED (sem clínica) não cria versão para ninguém;
--   - pedido antigo cancelado pelo paciente (cancel_request) ou respondido pela equipe (set_request_status) sobe a
--     versão; a mesma situação de novo, não;
--   - agendamento da agenda nova (agenda_book) sobe a versão UMA vez só (o toque é a última instrução da função; o
--     gatilho não toca no meio dela, antes de planejar);
--   - um erro ou uma espera longa no aviso não derruba o pedido: a função espera no máximo 200 ms pela linha da versão
--     (lock_timeout) e engole o erro (só avisa no log). A espera com duas conexões: tests/banco/pedido-do-site.mjs.
-- Tudo é desfeito no fim (rollback). Nomes fictícios.
begin;
select plan(25);
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
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c3550000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.c2() returns uuid language sql immutable as $$ select 'c3550000-0000-4000-8000-000000000002'::uuid $$;
-- lê a versão como dono do banco (o visitante não enxerga o schema agenda; plpgsql para não ser embutida na consulta)
create function pg_temp.versao(p_clinic uuid default pg_temp.c()) returns bigint language plpgsql stable security definer as $$
begin
  return coalesce((select version from agenda.clinic_versions where clinic_id = p_clinic), 0);
end $$;
create function pg_temp.leituras() returns bigint language plpgsql stable security definer as $$
begin
  return (select count(*) from agenda.access_log);
end $$;
create function pg_temp.linhas_de_versao() returns bigint language plpgsql stable security definer as $$
begin
  return (select count(*) from agenda.clinic_versions);
end $$;
select set_config('teste.dia', ((now() at time zone 'America/Sao_Paulo')::date + 7)::text, true);
select set_config('teste.hash', encode(extensions.digest('codigo-355', 'sha256'), 'hex'), true);

insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
values (pg_temp.c(), 'Clínica do Aviso de Pedido', 'imagem', 'Rua do Aviso, 355', 'São Paulo', 'SP',
        extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false);
insert into public.clinic_exams (clinic_id, exam_code) values (pg_temp.c(), 'usg');
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a3550000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'dona.aviso@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now());
insert into public.clinic_members (clinic_id, user_id, role) values
  (pg_temp.c(), 'a3550000-0000-4000-8000-000000000001', 'owner');

select has_trigger('public', 'appointment_requests', 'appointment_requests_aviso', 'o gatilho do aviso existe');
select is((select g.tgenabled from pg_trigger g where g.tgrelid = 'public.appointment_requests'::regclass and g.tgname = 'appointment_requests_aviso'),
          'A', 'o gatilho vale sempre (ENABLE ALWAYS), como as outras guardas da agenda');
select is(pg_temp.versao(), 0::bigint, 'antes de qualquer pedido a clínica não tem versão');

select pg_temp.entrar('anon');
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent, review_token_hash)
  values ('b3550000-0000-4000-8000-000000000001', pg_temp.c(), 'imed', 'Clínica do Aviso de Pedido', 'usg',
    current_setting('teste.dia')::date, 'Paciente do Aviso', '11999993551', true, current_setting('teste.hash'))
$$, 'o visitante pede agendamento sem horário (INSERT direto)');
select is(pg_temp.versao(), 1::bigint, 'o pedido novo sobe a versão da agenda da clínica');
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date,
    patient_name, patient_phone, consent)
  values ('b3550000-0000-4000-8000-000000000002', pg_temp.c(), 'imed', 'Clínica do Aviso de Pedido', 'usg',
    current_setting('teste.dia')::date, 'Outro Paciente do Aviso', '11999993552', true)
$$, 'um segundo pedido');
select is(pg_temp.versao(), 2::bigint, 'sobe de novo');
-- "Precisa de atenção": só o número de pedidos sem resposta, sem dado de paciente e sem registro de leitura
select set_config('teste.leituras', pg_temp.leituras()::text, true);
select pg_temp.entrar('authenticated', 'a3550000-0000-4000-8000-000000000001', 'dona.aviso@exemplo.test');
select is(public.agenda_requests_pending_count(pg_temp.c()), '{"status": "ok", "pending": 2}'::jsonb,
          'a dona vê quantos pedidos esperam resposta: só o número');
select pg_temp.entrar('postgres');
select is(pg_temp.leituras(), current_setting('teste.leituras')::bigint, 'contar não grava leitura de dado de paciente (access_log)');
select pg_temp.entrar('authenticated', 'a3550000-0000-4000-8000-000000000009', 'outra.pessoa@exemplo.test');
select is(public.agenda_requests_pending_count(pg_temp.c()) ->> 'status', 'forbidden', 'quem não é da clínica não conta');
select pg_temp.entrar('anon');
select throws_ok($$ select public.agenda_requests_pending_count(pg_temp.c()) $$, '42501', null, 'o visitante nem chama a função');
select set_config('teste.linhas', pg_temp.linhas_de_versao()::text, true);
select lives_ok($$
  insert into public.appointment_requests (id, clinic_id, place_source, place_ref, place_name, exam_code, preferred_date,
    preferred_period, patient_name, patient_phone, consent)
  values ('b3550000-0000-4000-8000-000000000003', null, 'cnes', 'cnes:3550003', 'Laboratório do Cadastro Oficial', 'lab',
    current_setting('teste.dia')::date, 'manha', 'Paciente do Concierge', '11999993553', true)
$$, 'pedido ao IMED (local não parceiro, sem clínica)');
select is(pg_temp.linhas_de_versao(), current_setting('teste.linhas')::bigint, 'pedido ao IMED não cria versão para ninguém');
select is(pg_temp.versao(), 2::bigint, '... nem mexe na versão da clínica');

-- o paciente cancela o pedido antigo pelo site (com o código): a outra tela vê sem tocar em "Atualizar lista"
select is(public.cancel_request('b3550000-0000-4000-8000-000000000001', 'codigo-355'), 'ok', 'o paciente cancela o pedido antigo');
select is(pg_temp.versao(), 3::bigint, 'pedido cancelado pelo paciente sobe a versão');
-- a recepção responde o outro pedido ("Em contato"); a mesma situação de novo não muda nada
select pg_temp.entrar('authenticated', 'a3550000-0000-4000-8000-000000000001', 'dona.aviso@exemplo.test');
select is(public.set_request_status('b3550000-0000-4000-8000-000000000002', 'contacted'), 'ok', 'a recepção marca "Em contato"');
select pg_temp.entrar('anon');
select is(pg_temp.versao(), 4::bigint, 'pedido respondido pela equipe sobe a versão');
select pg_temp.entrar('authenticated', 'a3550000-0000-4000-8000-000000000001', 'dona.aviso@exemplo.test');
select is(public.set_request_status('b3550000-0000-4000-8000-000000000002', 'contacted'), 'ok', 'a mesma situação de novo');
select pg_temp.entrar('anon');
select is(pg_temp.versao(), 4::bigint, '... não sobe a versão (a situação não mudou)');
select pg_temp.entrar('authenticated', 'a3550000-0000-4000-8000-000000000001', 'dona.aviso@exemplo.test');
select is(public.agenda_requests_pending_count(pg_temp.c()) ->> 'pending', '0', 'cancelado e "Em contato" não esperam mais resposta');
select pg_temp.entrar('anon');

select pg_temp.entrar('postgres');
select is((select count(*)::int from agenda.clinic_versions where clinic_id = pg_temp.c()), 1,
          'uma linha de versão por clínica (on conflict)');
select ok((select p.proconfig @> array['lock_timeout=200ms'] from pg_proc p
           where p.oid = 'private.agenda_request_inserted()'::regprocedure),
          'o aviso espera no máximo 200 ms pela linha da versão (lock_timeout da função): uma espera longa não derruba o pedido');

-- Agenda nova (agenda_book): o gatilho não toca; só o toque do fim da função (uma versão por marcação).
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
values (pg_temp.c2(), 'Clínica da Agenda do Aviso', 'imagem', 'Rua do Aviso, 356', 'São Paulo', 'SP',
        extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false);
insert into public.clinic_members (clinic_id, user_id, role) values
  (pg_temp.c2(), 'a3550000-0000-4000-8000-000000000001', 'owner');
insert into agenda.holidays (scope, day, name, source)
values ('nacional', make_date(extract(year from current_setting('teste.dia')::date)::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949')
on conflict do nothing;
select pg_temp.entrar('authenticated', 'a3550000-0000-4000-8000-000000000001', 'dona.aviso@exemplo.test');
select public.agenda_unit_save(pg_temp.c2(), jsonb_build_object('holidays_checked_until', current_setting('teste.dia')::date + 200, 'min_notice_min', 0));
select set_config('teste.usg1', public.agenda_resource_save(pg_temp.c2(), '{"kind": "equipamento", "name": "USG-1"}') ->> 'id', true);
select set_config('teste.usg', public.agenda_procedure_save(pg_temp.c2(), jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom', 'duration_min', 30, 'step_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', current_setting('teste.usg1')::uuid)))))) ->> 'id', true);
select public.agenda_rules_set(pg_temp.c2(), null,
         jsonb_build_array(jsonb_build_object('weekday', extract(dow from current_setting('teste.dia')::date)::integer, 'start', '08:00', 'end', '12:00')));
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_aviso_pedido', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now() where id = pg_temp.c2();
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
select set_config('teste.v2', pg_temp.versao(pg_temp.c2())::text, true);
select pg_temp.entrar('anon');
select is(public.agenda_book(pg_temp.c2(),
            jsonb_build_array(jsonb_build_object('procedure_id', current_setting('teste.usg')::uuid,
              'starts_at', (current_setting('teste.dia')::date + '09:00'::time) at time zone 'America/Sao_Paulo')),
            jsonb_build_object('name', 'Paciente da Agenda do Aviso', 'phone', '11999993554', 'consent', true),
            'b3550000-0000-4000-8000-000000000004', 'codigo-355-agenda') ->> 'status', 'ok',
          'o visitante marca pela agenda nova (agenda_book)');
select is(pg_temp.versao(pg_temp.c2()), current_setting('teste.v2')::bigint + 1,
          'agenda_book sobe a versão uma vez só (o gatilho não toca no meio da marcação)');

select * from finish();
rollback;
