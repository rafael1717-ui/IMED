-- Pedido novo pelo site sobe a versão da agenda (iMed Agenda, fase 4.3; migração agenda_aviso_pedido; arquitetura §7):
--   - o visitante pede SEM horário numa clínica parceira (INSERT direto, o fluxo antigo): a versão da clínica sobe
--     (o painel e a aba Pedidos releem sozinhos pelo vigia de tempo-real.js);
--   - um segundo pedido sobe de novo; pedido ao IMED (sem clínica) não cria versão para ninguém;
--   - o pedido nunca falha por causa do aviso (a função engole o erro e só avisa no log).
-- Tudo é desfeito no fim (rollback). Nomes fictícios.
begin;
select plan(8);

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
-- lê a versão como dono do banco (o visitante não enxerga o schema agenda; plpgsql para não ser embutida na consulta)
create function pg_temp.versao() returns bigint language plpgsql stable security definer as $$
begin
  return coalesce((select version from agenda.clinic_versions where clinic_id = pg_temp.c()), 0);
end $$;
select set_config('teste.dia', ((now() at time zone 'America/Sao_Paulo')::date + 7)::text, true);
select set_config('teste.hash', encode(extensions.digest('codigo-355', 'sha256'), 'hex'), true);

insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
values (pg_temp.c(), 'Clínica do Aviso de Pedido', 'imagem', 'Rua do Aviso, 355', 'São Paulo', 'SP',
        extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false);
insert into public.clinic_exams (clinic_id, exam_code) values (pg_temp.c(), 'usg');

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
select pg_temp.entrar('postgres');
select is((select count(*)::int from agenda.clinic_versions where clinic_id = pg_temp.c()), 1,
          'uma linha de versão por clínica (on conflict)');

select * from finish();
rollback;
