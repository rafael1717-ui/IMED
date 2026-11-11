-- Fuso e horário de verão no motor de horários (iMed Agenda, fase 3.2; arquitetura §4, "Fuso e horário de verão"):
--   - regras na hora local da unidade, convertidas dia a dia pela regra do tzdata daquele dia; instantes em UTC;
--   - datas reais de America/Sao_Paulo: 04/11/2018 (começo do horário de verão: 00:00–00:59 não existiram) e
--     16/02/2019 (fim: 23:00–23:59 aconteceram duas vezes): hora inexistente não gera horário, hora repetida não gera
--     duplicata (instantes em série crescente);
--   - Manaus (UTC−4, sem horário de verão): a mesma regra "08:00" vira outro instante; agenda_days agrupa pelo dia
--     LOCAL da unidade (23:30 em Manaus já é o dia seguinte em UTC);
--   - o fuso da clínica nova vem da UF; trocar o fuso desfaz a confirmação; fuso fora da lista é recusado; com a venda
--     online ligada, trocar o fuso é recusado (online_active);
--   - consulta pública: sem venda online, nada para o visitante (a dona vê a pré-visualização); com a venda ligada,
--     horários e procedimentos para qualquer um.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(24);
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
  select pg_temp.entrar('authenticated', 'a3205000-0000-4000-8000-000000000001', 'dona.fuso@exemplo.test') $$;
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
-- prepara uma clínica: unidade, um aparelho e um procedimento de 30 min de 30 em 30 (id em teste.proc_<sufixo>)
create function pg_temp.preparar(p_clinica uuid, p_sufixo text, p_regras jsonb) returns text language plpgsql as $$
declare
  r jsonb;
  s text[] := '{}';
begin
  s := s || (public.agenda_unit_save(p_clinica, jsonb_build_object('holidays_checked_until', '2099-12-31', 'min_notice_min', 0)) ->> 'status');
  r := public.agenda_resource_save(p_clinica, '{"kind": "equipamento", "name": "USG"}');
  s := s || (r ->> 'status');
  r := public.agenda_procedure_save(p_clinica, jsonb_build_object('exam_code', 'usg', 'name', 'Ultrassom', 'duration_min', 30,
         'step_min', 30, 'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento',
         'options', jsonb_build_array(jsonb_build_object('resource_id', r ->> 'id'))))));
  s := s || (r ->> 'status');
  perform set_config('teste.proc_' || p_sufixo, r ->> 'id', true);
  s := s || (public.agenda_rules_set(p_clinica, null, p_regras) ->> 'status');
  return array_to_string(s, ',');
end $$;
create function pg_temp.regra(p_dow integer, p_ini text, p_fim text) returns jsonb language sql immutable as $$
  select jsonb_build_object('weekday', p_dow, 'start', p_ini, 'end', p_fim) $$;
-- horários livres de um dia (hora local e UTC), pelo motor, consultado em p_agora
create function pg_temp.livres(p_clinica uuid, p_sufixo text, p_dia date, p_agora timestamptz)
returns table (inicio timestamptz, local text, utc text) language sql stable as $$
  select s.slot_start, to_char(s.slot_start at time zone c.timezone, 'HH24:MI'), to_char(s.slot_start at time zone 'UTC', 'HH24:MI')
  from public.clinics c,
       private.agenda_free_starts(p_clinica, current_setting('teste.proc_' || p_sufixo)::uuid, p_dia, p_dia, p_agora) s
  where c.id = p_clinica order by 1 $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a3205000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'dona.fuso@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now());
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo, timezone)
values
  ('c3205000-0000-4000-8000-000000000001', 'Clínica do Fuso SP', 'imagem', 'Rua do Fuso, 1', 'São Paulo', 'SP',
   extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false, 'America/Sao_Paulo'),
  ('c3205000-0000-4000-8000-000000000002', 'Clínica do Fuso AM', 'imagem', 'Rua do Fuso, 2', 'Manaus', 'AM',
   extensions.st_setsrid(extensions.st_makepoint(-60.02, -3.10), 4326)::extensions.geography, 'published', true, false, 'America/Sao_Paulo');
insert into public.clinic_members (clinic_id, user_id, role) values
  ('c3205000-0000-4000-8000-000000000001', 'a3205000-0000-4000-8000-000000000001', 'owner'),
  ('c3205000-0000-4000-8000-000000000002', 'a3205000-0000-4000-8000-000000000001', 'owner');
insert into agenda.holidays (scope, day, name, source)
values ('nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949');

select is((select timezone from public.clinics where id = 'c3205000-0000-4000-8000-000000000002'), 'America/Manaus',
          'clínica nova do AM nasce com o fuso de Manaus (pela UF; o que o INSERT mandou é ignorado)');

select pg_temp.dona();
-- SP: domingo 00:00–02:00 e sábado 22:00–24:00 (os dois dias de troca); o dia do teste 08:00–09:00, se não for sábado ou domingo
select is(pg_temp.preparar('c3205000-0000-4000-8000-000000000001', 'sp',
            jsonb_build_array(pg_temp.regra(0, '00:00', '02:00'), pg_temp.regra(6, '22:00', '24:00'))),
          'ok,ok,ok,ok', 'SP: unidade, aparelho, procedimento e regras de domingo 00:00–02:00 e sábado 22:00–24:00');
select is(pg_temp.preparar('c3205000-0000-4000-8000-000000000002', 'am',
            jsonb_build_array(pg_temp.regra(extract(dow from pg_temp.dia())::integer, '08:00', '09:00'),
                              pg_temp.regra(extract(dow from pg_temp.dia())::integer, '23:00', '24:00'))),
          'ok,ok,ok,ok', 'Manaus: 08:00–09:00 e 23:00–24:00 no dia do teste');
select pg_temp.entrar('postgres');

/* ===================== Começo do horário de verão (04/11/2018) ===================== */
select is(array(select local from pg_temp.livres('c3205000-0000-4000-8000-000000000001', 'sp', '2018-11-04', '2018-10-20 12:00+00')),
          array['01:00', '01:30'], '04/11/2018: 00:00 e 00:30 não existiram; a janela de domingo dá 01:00 e 01:30 (hora local)');
select is(array(select utc from pg_temp.livres('c3205000-0000-4000-8000-000000000001', 'sp', '2018-11-04', '2018-10-20 12:00+00')),
          array['03:00', '03:30'], '04/11/2018: instantes 03:00 e 03:30 UTC (UTC−2 depois da troca)');

/* ===================== Fim do horário de verão (16/02/2019) ===================== */
select is(array(select local from pg_temp.livres('c3205000-0000-4000-8000-000000000001', 'sp', '2019-02-16', '2019-02-01 12:00+00')),
          array['22:00', '22:30', '23:00', '23:30', '23:00', '23:30'],
          '16/02/2019: a janela 22:00–24:00 durou 3 horas; 23:00 e 23:30 aparecem duas vezes na hora local');
select is((select count(distinct inicio)::integer from pg_temp.livres('c3205000-0000-4000-8000-000000000001', 'sp', '2019-02-16', '2019-02-01 12:00+00')),
          6, '... mas são 6 instantes diferentes (nenhuma duplicata)');
select is(array(select utc from pg_temp.livres('c3205000-0000-4000-8000-000000000001', 'sp', '2019-02-16', '2019-02-01 12:00+00')),
          array['00:00', '00:30', '01:00', '01:30', '02:00', '02:30'], '16/02/2019: instantes em série crescente, de 30 em 30 min (UTC)');
select is(array(select local from pg_temp.livres('c3205000-0000-4000-8000-000000000001', 'sp', '2019-02-23', '2019-02-01 12:00+00')),
          array['22:00', '22:30', '23:00', '23:30'], 'sábado seguinte, sem troca: as 4 de sempre');

/* ===================== Manaus (UTC−4) e o dia local ===================== */
select is(array(select utc from pg_temp.livres('c3205000-0000-4000-8000-000000000002', 'am', pg_temp.dia(), now())),
          array['12:00', '12:30', '03:00', '03:30'], 'Manaus: 08:00 local = 12:00 UTC; 23:00 local = 03:00 UTC do dia seguinte');
select pg_temp.dona();
select is(array(select d.day::text || ' ' || d.livres from public.agenda_days('c3205000-0000-4000-8000-000000000002',
                  current_setting('teste.proc_am')::uuid, pg_temp.dia(), pg_temp.dia()) d),
          array[pg_temp.dia()::text || ' 4'], 'agenda_days agrupa pelo dia LOCAL da unidade (os 4 horários no mesmo dia)');
select is((select count(*)::integer from public.agenda_slots('c3205000-0000-4000-8000-000000000002',
             current_setting('teste.proc_am')::uuid, pg_temp.dia(), pg_temp.dia())), 4,
          'a dona vê a pré-visualização (agenda_slots) antes de ligar a venda online');
select pg_temp.entrar('anon');
select is((select count(*)::integer from public.agenda_slots('c3205000-0000-4000-8000-000000000002',
             current_setting('teste.proc_am')::uuid, pg_temp.dia(), pg_temp.dia())), 0,
          'visitante: sem venda online, nenhum horário');
select is(public.agenda_public_info('c3205000-0000-4000-8000-000000000002') - 'mode_text' - 'online_text' - 'payment_text' - 'clinic_id',
          jsonb_build_object('status', 'ok', 'timezone', 'America/Manaus', 'mode', 'pedido', 'online', false, 'payment', 'no_local',
                             'cancel_until_min', null, 'reschedule_until_min', null, 'procedures', '[]'::jsonb),
          'agenda_public_info sem venda online: modo de pedido, fuso da unidade, nenhum procedimento');

/* ===================== Fuso: confirmar, trocar, recusar ===================== */
select pg_temp.dona();
select is(public.agenda_unit_save('c3205000-0000-4000-8000-000000000001', '{"confirm_timezone": true}') ->> 'status', 'ok', 'a dona confirma o fuso');
select pg_temp.entrar('postgres');
select ok((select timezone_confirmed_at is not null from public.clinics where id = 'c3205000-0000-4000-8000-000000000001'), 'fuso confirmado');
select pg_temp.dona();
select is(public.agenda_unit_save('c3205000-0000-4000-8000-000000000001', '{"timezone": "America/Bahia"}') ->> 'status', 'ok', 'troca o fuso');
select pg_temp.entrar('postgres');
select is((select timezone || ' ' || (timezone_confirmed_at is null) from public.clinics where id = 'c3205000-0000-4000-8000-000000000001'),
          'America/Bahia true', 'trocar o fuso desfaz a confirmação');
select pg_temp.dona();
select is(public.agenda_unit_save('c3205000-0000-4000-8000-000000000001', '{"timezone": "Europe/Lisbon"}') ->> 'status', 'invalid',
          'fuso fora da lista do Brasil: invalid');
select is(public.agenda_unit_save('c3205000-0000-4000-8000-000000000001', '{"timezone": "America/Sao_Paulo", "confirm_timezone": true}') ->> 'status',
          'ok', 'volta para São Paulo, confirmado');

/* ===================== Venda online ligada (pela marca de emergência; a função vem na 4.1/5.1) ===================== */
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_fuso', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now()
where id = 'c3205000-0000-4000-8000-000000000002';
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
select pg_temp.entrar('anon');
select is((select count(*)::integer from public.agenda_slots('c3205000-0000-4000-8000-000000000002',
             current_setting('teste.proc_am')::uuid, pg_temp.dia(), pg_temp.dia())), 4,
          'com a venda online ligada, o visitante vê os horários');
select is(jsonb_array_length(public.agenda_public_info('c3205000-0000-4000-8000-000000000002') -> 'procedures'), 1,
          'e o procedimento (nome, duração, preço ou "sob consulta")');
select is(public.agenda_public_info('c3205000-0000-4000-8000-000000000002') #>> '{procedures,0,price_text}', 'sob consulta',
          'sem preço informado: "sob consulta" (nunca inventado)');
select pg_temp.dona();
select is(public.agenda_unit_save('c3205000-0000-4000-8000-000000000002', '{"timezone": "America/Cuiaba"}') ->> 'status', 'online_active',
          'com a venda online ligada, trocar o fuso é recusado');

select * from finish();
rollback;
