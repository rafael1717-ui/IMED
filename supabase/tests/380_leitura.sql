-- Leituras da recepção e atendimento pelo profissional (iMed Agenda, fase 4.2; arquitetura §5, §11 e §12):
--   - agenda_catalog (catálogo da recepção, sem paciente), agenda_free (o "Livre" da grade), agenda_desk_slots
--     (horários do balcão e da remarcação, com o "agora" recuado da antecedência), agenda_blocks (bloqueios por função),
--     agenda_requests (a aba Pedidos, com registro de quem leu) e agenda_attend (chegada, atendimento, concluído e
--     falta; o profissional só na própria agenda);
--   - cada papel vê o que a matriz do §12 manda; ninguém de outra clínica; a equipe do IMED só com um dos 4 motivos
--     da decisão 4.2-f, cada motivo numa linha própria do access_log.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test; nomes fictícios.
begin;
select plan(62);
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
  select ('a3380000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'recepcao', 'fin', 'prof', 'donab', 'admin'])[p_n] || '.leitura@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.a() returns uuid language sql immutable as $$ select 'c3380000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.b() returns uuid language sql immutable as $$ select 'c3380000-0000-4000-8000-000000000002'::uuid $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c3380000-0000-4000-8000-000000000003'::uuid $$;
create function pg_temp.hoje() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create function pg_temp.amanha() returns date language sql stable as $$ select pg_temp.hoje() + 1 $$;
create function pg_temp.t(p_dia date, p_hhmm text) returns timestamptz language sql stable as $$
  select (p_dia + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.item(p_req text) returns uuid language sql stable as $$
  select i.id from agenda.appointment_items i where i.request_id = pg_temp.id(p_req) order by i.seq limit 1 $$;
create function pg_temp.versao(p_req text) returns integer language sql stable as $$
  select a.version from public.appointment_requests a where a.id = pg_temp.id(p_req) $$;
-- o primeiro horário do balcão (Ecocardiograma, com a Dra. Teste) a pelo menos p_min minutos de agora
create function pg_temp.eco_depois(p_min integer) returns timestamptz language sql stable as $$
  select min((s ->> 'start')::timestamptz)
  from jsonb_array_elements(public.agenda_desk_slots(pg_temp.a(), pg_temp.id('eco'), pg_temp.hoje(), pg_temp.hoje() + 2) -> 'slots') s
  where (s ->> 'start')::timestamptz >= now() + make_interval(mins => p_min) $$;
create function pg_temp.balcao(p_proc text, p_t timestamptz, p_nome text) returns text language sql as $$
  select public.agenda_desk_book(pg_temp.a(), jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id(p_proc), 'starts_at', p_t)),
           jsonb_build_object('name', p_nome, 'phone', '(11) 98888-' || lpad((abs(hashtext(p_nome)) % 10000)::text, 4, '0'), 'consent', true),
           'clinica_telefone') ->> 'id' $$;
-- muda os horários de um agendamento à mão (marca de emergência): para testar a falta, que só vale depois do início
create function pg_temp.mover(p_req text, p_delta interval) returns void language plpgsql as $$
begin
  perform set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_horario', true);
  update agenda.occupancy o set during = tstzrange(lower(o.during) + p_delta, upper(o.during) + p_delta, '[)')
  where o.item_id in (select i.id from agenda.appointment_items i where i.request_id = pg_temp.id(p_req));
  update agenda.appointment_items i set starts_at = i.starts_at + p_delta, ends_at = i.ends_at + p_delta
  where i.request_id = pg_temp.id(p_req);
  update public.appointment_requests a set slot_start = a.slot_start + p_delta, slot_end = a.slot_end + p_delta
  where a.id = pg_temp.id(p_req);
  perform set_config('imed.origin', '', true), set_config('imed.reason', '', true);
end $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated', pg_temp.email(n), now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from generate_series(1, 6) n;
insert into public.admin_emails (email) values (pg_temp.email(6));
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua da Leitura, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values (pg_temp.a(), 'Clínica A da Leitura', 1), (pg_temp.b(), 'Clínica B da Leitura', 2),
             (pg_temp.c(), 'Clínica C da Leitura (sem agenda)', 3)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  (pg_temp.a(), pg_temp.u(1), 'owner'), (pg_temp.a(), pg_temp.u(2), 'reception'), (pg_temp.a(), pg_temp.u(3), 'finance'),
  (pg_temp.a(), pg_temp.u(4), 'professional'), (pg_temp.b(), pg_temp.u(5), 'owner'), (pg_temp.c(), pg_temp.u(1), 'owner');
-- um feriado nacional lançado (com fonte), longe dos dias do teste
insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.hoje())::integer + 2, 1, 1), 'Confraternização Universal', 'Fonte de teste (Lei 662/1949)'
where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from pg_temp.hoje())::integer + 2, 1, 1));

-- clínica A: aberta o dia inteiro, de 15 em 15 minutos, antecedência de 2 h para o site; USG-1 e a Dra. Teste
select pg_temp.como(1);
select public.agenda_unit_save(pg_temp.a(), jsonb_build_object('holidays_checked_until', pg_temp.hoje() + 60, 'min_notice_min', 120, 'step_min', 15));
select set_config('teste.usg1', public.agenda_resource_save(pg_temp.a(), '{"kind": "equipamento", "name": "USG-1"}') ->> 'id', true);
select set_config('teste.dra', public.agenda_resource_save(pg_temp.a(),
         jsonb_build_object('kind', 'profissional', 'name', 'Dra. Teste', 'member_user_id', pg_temp.u(4))) ->> 'id', true);
select set_config('teste.usg', public.agenda_procedure_save(pg_temp.a(), jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom', 'duration_min', 30, 'price_cents', 18000,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('usg1'))))))) ->> 'id', true);
select set_config('teste.eco', public.agenda_procedure_save(pg_temp.a(), jsonb_build_object(
  'exam_code', 'eco', 'name', 'Ecocardiograma', 'duration_min', 20,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'profissional', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('dra'))))))) ->> 'id', true);
select public.agenda_rules_set(pg_temp.a(), null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d));
-- clínica B: a dona dela, um aparelho, um exame e um agendamento
select pg_temp.como(5);
select public.agenda_unit_save(pg_temp.b(), jsonb_build_object('holidays_checked_until', pg_temp.hoje() + 60, 'min_notice_min', 0, 'step_min', 15));
select set_config('teste.rb', public.agenda_resource_save(pg_temp.b(), '{"kind": "equipamento", "name": "USG-B"}') ->> 'id', true);
select set_config('teste.pb', public.agenda_procedure_save(pg_temp.b(), jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom B', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('rb'))))))) ->> 'id', true);
select public.agenda_rules_set(pg_temp.b(), null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d));
select set_config('teste.bb', public.agenda_desk_book(pg_temp.b(),
         jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id('pb'), 'starts_at', pg_temp.t(pg_temp.amanha(), '10:00'))),
         '{"name": "Paciente da Clínica B", "phone": "(11) 95555-4444", "consent": true}', 'clinica_telefone') ->> 'id', true);
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_agenda', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now() where id in (pg_temp.a(), pg_temp.b());
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
-- um pedido do site (sem horário, para hoje), como o site manda
select pg_temp.entrar('anon');
insert into public.appointment_requests (id, clinic_id, place_source, place_name, exam_code, preferred_date, preferred_period,
                                         patient_name, patient_phone, consent)
values ('b3380000-0000-4000-8000-000000000001', pg_temp.a(), 'imed', 'Clínica A da Leitura', 'usg', pg_temp.hoje(), 'tarde',
        'Paciente do Site Teste', '11977776666', true);
select set_config('teste.site', 'b3380000-0000-4000-8000-000000000001', true);

/* ===================== agenda_catalog ===================== */
select pg_temp.como(1);
select is((select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'procedures'), jsonb_array_length(j -> 'resources'),
                            j #>> '{unit,checkin_before_min}', j ->> 'national_holidays_until', j #>> '{can,marcar}', j ->> 'active')
           from (select public.agenda_catalog(pg_temp.a()) as j) x),
          concat_ws('|', 'ok', 2, 2, 120, make_date(extract(year from pg_temp.hoje())::integer + 2, 12, 31), 'true', 'true'),
          'agenda_catalog: a dona recebe os 2 exames, os 2 recursos, os prazos da unidade e até quando há feriado nacional');
select pg_temp.como(2);
select is((select concat_ws('|', j ->> 'scope', jsonb_array_length(j -> 'procedures'), j #>> '{can,marcar}', j #>> '{can,bloquear}',
                            j #>> '{can,conflitos}', j #>> '{procedures,0,groups,0,resource_ids,0}' is not null)
           from (select public.agenda_catalog(pg_temp.a()) as j) x),
          'clinica|2|true|true|true|t', 'agenda_catalog: a recepção marca, bloqueia e resolve conflitos (e vê o que cada exame usa)');
select ok(public.agenda_catalog(pg_temp.a())::text !~ '(Paciente|98888|77776666)', 'agenda_catalog: nenhum dado de paciente');
select pg_temp.como(4);
select is((select concat_ws('|', j ->> 'scope', j #>> '{resources,0,name}', jsonb_array_length(j -> 'resources'), j #>> '{resources,0,mine}',
                            j #>> '{procedures,0,name}', jsonb_array_length(j -> 'procedures'), j #>> '{can,marcar}', j #>> '{can,atender}')
           from (select public.agenda_catalog(pg_temp.a()) as j) x),
          'propria|Dra. Teste|1|true|Ecocardiograma|1|false|true',
          'agenda_catalog: o profissional vê só o próprio cadastro e o exame dele; atende, mas não marca');
select pg_temp.como(3);
select is(public.agenda_catalog(pg_temp.a()) ->> 'status', 'forbidden', 'agenda_catalog: o financeiro não vê a agenda');
select pg_temp.como(5);
select is(public.agenda_catalog(pg_temp.a()) ->> 'status', 'forbidden', 'agenda_catalog: a dona de outra clínica não vê');
select pg_temp.entrar('anon');
select throws_ok($$ select public.agenda_catalog(pg_temp.a()) $$, '42501', null, 'agenda_catalog: visitante nem executa');

/* ===================== agenda_free ===================== */
select pg_temp.como(2);
select ok(exists (select 1 from jsonb_array_elements(public.agenda_free(pg_temp.a(), pg_temp.amanha(), 1) -> 'resources') r
                  cross join lateral jsonb_array_elements(r -> 'free') f
                  where (r ->> 'id')::uuid = pg_temp.id('usg1')
                    and (f ->> 0)::timestamptz <= pg_temp.t(pg_temp.amanha(), '08:00')
                    and (f ->> 1)::timestamptz >= pg_temp.t(pg_temp.amanha(), '12:00')),
          'agenda_free: o USG-1 está livre amanhã das 08:00 às 12:00');
select is((select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'unit_open'), j ->> 'holidays_checked_until',
                            (j ->> 'from')::timestamptz = pg_temp.t(pg_temp.amanha(), '00:00'))
           from (select public.agenda_free(pg_temp.a(), pg_temp.amanha(), 1) as j) x),
          concat_ws('|', 'ok', 1, pg_temp.hoje() + 60, 't'), 'agenda_free: a unidade atende o dia inteiro; até quando os feriados foram conferidos');
select set_config('teste.b1', pg_temp.balcao('usg', pg_temp.t(pg_temp.amanha(), '09:00'), 'Maria Souza Leitura'), true);
select ok(current_setting('teste.b1', true) is not null, 'a recepção marca um ultrassom para amanhã às 09:00 pelo balcão');
select ok(not exists (select 1 from jsonb_array_elements(public.agenda_free(pg_temp.a(), pg_temp.amanha(), 1) -> 'resources') r
                      cross join lateral jsonb_array_elements(r -> 'free') f
                      where (r ->> 'id')::uuid = pg_temp.id('usg1')
                        and (f ->> 0)::timestamptz < pg_temp.t(pg_temp.amanha(), '09:30')
                        and (f ->> 1)::timestamptz > pg_temp.t(pg_temp.amanha(), '09:00'))
          and exists (select 1 from jsonb_array_elements(public.agenda_free(pg_temp.a(), pg_temp.amanha(), 1) -> 'resources') r
                      cross join lateral jsonb_array_elements(r -> 'free') f
                      where (r ->> 'id')::uuid = pg_temp.id('usg1')
                        and (f ->> 0)::timestamptz <= pg_temp.t(pg_temp.amanha(), '09:30')
                        and (f ->> 1)::timestamptz >= pg_temp.t(pg_temp.amanha(), '12:00')),
          'agenda_free: depois da marcação, o livre do USG-1 pula 09:00–09:30');
select pg_temp.como(4);
select is((select string_agg(r ->> 'id', ',') from jsonb_array_elements(public.agenda_free(pg_temp.a(), pg_temp.amanha(), 1) -> 'resources') r),
          pg_temp.id('dra')::text, 'agenda_free: o profissional vê só o livre do próprio cadastro');
select pg_temp.como(2);
select is(public.agenda_free(pg_temp.a(), pg_temp.amanha(), 8) ->> 'status', 'invalid', 'agenda_free: no máximo 7 dias');
select pg_temp.como(1);
select is(public.agenda_free(pg_temp.c(), pg_temp.amanha(), 1) ->> 'status', 'agenda_not_started', 'agenda_free: clínica sem a agenda nova');
select pg_temp.como(3);
select is(public.agenda_free(pg_temp.a(), pg_temp.amanha(), 1) ->> 'status', 'forbidden', 'agenda_free: o financeiro não vê');
select pg_temp.entrar('postgres');
select set_config('teste.b1item', pg_temp.item('b1')::text, true);

/* ===================== agenda_desk_slots ===================== */
select pg_temp.como(2);
select ok(exists (select 1 from jsonb_array_elements(public.agenda_desk_slots(pg_temp.a(), pg_temp.id('usg'), pg_temp.hoje(), pg_temp.hoje() + 1) -> 'slots') s
                  where (s ->> 'start')::timestamptz < now() + interval '120 minutes' and (s ->> 'start')::timestamptz >= now()),
          'agenda_desk_slots: o balcão oferece horário para daqui a pouco (menos de 2 h)');
select is((select count(*)::integer from public.agenda_slots(pg_temp.a(), pg_temp.id('usg'), pg_temp.hoje(), pg_temp.hoje() + 1) s
           where s.slot_start < now() + interval '120 minutes'), 0,
          'agenda_slots (o do site) respeita a antecedência de 2 h para a mesma pessoa');
select is((select concat_ws('|', count(*) filter (where (s ->> 'start')::timestamptz = pg_temp.t(pg_temp.amanha(), '09:15')),
                            j ->> 'holidays_checked_until' is not null, j ->> 'national_holidays_until' is not null)
           from (select public.agenda_desk_slots(pg_temp.a(), pg_temp.id('usg'), pg_temp.amanha(), pg_temp.amanha(),
                                                 pg_temp.id('b1'), pg_temp.id('b1item')) as j) x
           cross join lateral jsonb_array_elements(x.j -> 'slots') s group by j),
          '1|t|t', 'agenda_desk_slots: na remarcação, o próprio horário não conta (09:15 aparece)');
select is((select count(*)::integer from jsonb_array_elements(public.agenda_desk_slots(pg_temp.a(), pg_temp.id('usg'), pg_temp.amanha(), pg_temp.amanha()) -> 'slots') s
           where (s ->> 'start')::timestamptz = pg_temp.t(pg_temp.amanha(), '09:15')), 0,
          'agenda_desk_slots: sem a remarcação, 09:15 está ocupado');
select is(public.agenda_desk_slots(pg_temp.a(), pg_temp.id('usg'), pg_temp.hoje(), pg_temp.hoje() + 14) ->> 'status', 'invalid',
          'agenda_desk_slots: no máximo 14 dias');
select is(public.agenda_desk_slots(pg_temp.a(), pg_temp.id('pb'), pg_temp.hoje()) ->> 'status', 'not_found',
          'agenda_desk_slots: exame de outra clínica: not_found');
select is(public.agenda_desk_slots(pg_temp.a(), pg_temp.id('usg'), pg_temp.hoje(), null, pg_temp.id('bb')) ->> 'status', 'not_found',
          'agenda_desk_slots: agendamento de outra clínica: not_found');
select pg_temp.como(4);
select is(public.agenda_desk_slots(pg_temp.a(), pg_temp.id('eco'), pg_temp.hoje()) ->> 'status', 'forbidden',
          'agenda_desk_slots: o profissional não marca');

/* ===================== agenda_blocks ===================== */
select pg_temp.como(1);
select is(concat_ws('|',
            public.agenda_block_add(pg_temp.a(), null, pg_temp.t(pg_temp.hoje() + 3, '08:00'), pg_temp.t(pg_temp.hoje() + 3, '09:00'),
                                    'bloqueio', 'Reforma') ->> 'status',
            public.agenda_block_add(pg_temp.a(), pg_temp.id('usg1'), pg_temp.t(pg_temp.hoje() + 3, '10:00'), pg_temp.t(pg_temp.hoje() + 3, '11:00'),
                                    'manutencao', 'Troca de peça') ->> 'status'), 'ok|ok', 'a dona bloqueia a unidade e o USG-1');
select pg_temp.como(2);
select is((select concat_ws('|', j ->> 'can_edit', string_agg(concat_ws(':', b ->> 'kind', coalesce(b ->> 'resource_name', 'unidade'),
                                                                        coalesce(b ->> 'reason', '-')), ',' order by b ->> 'starts_at'))
           from (select public.agenda_blocks(pg_temp.a()) as j) x cross join lateral jsonb_array_elements(x.j -> 'blocks') b group by j),
          'true|bloqueio:unidade:Reforma,manutencao:USG-1:Troca de peça', 'agenda_blocks: a recepção vê os 2 bloqueios, com o motivo');
select pg_temp.como(4);
select is((select concat_ws('|', j ->> 'can_edit', string_agg(concat_ws(':', b ->> 'kind', coalesce(b ->> 'resource_id', 'unidade'),
                                                                        coalesce(b ->> 'reason', '-')), ','))
           from (select public.agenda_blocks(pg_temp.a()) as j) x cross join lateral jsonb_array_elements(x.j -> 'blocks') b group by j),
          'false|bloqueio:unidade:-', 'agenda_blocks: o profissional vê só o da unidade, sem o motivo');
select pg_temp.como(6);
select is((select concat_ws('|', j ->> 'scope', j ->> 'can_edit', count(*), count(b ->> 'reason'))
           from (select public.agenda_blocks(pg_temp.a()) as j) x cross join lateral jsonb_array_elements(x.j -> 'blocks') b group by j),
          'central|true|2|0', 'agenda_blocks: a equipe do IMED vê os 2, sem o motivo, e pode mexer');
select pg_temp.como(3);
select is(public.agenda_blocks(pg_temp.a()) ->> 'status', 'forbidden', 'agenda_blocks: o financeiro não vê');

/* ===================== agenda_requests ===================== */
select pg_temp.como(2);
select is((select concat_ws('|', j ->> 'status', j ->> 'scope', jsonb_array_length(j -> 'requests'),
                            (select bool_and(r ->> 'patient_phone' is not null and r ? 'uses_resources' and r ? 'version')
                             from jsonb_array_elements(j -> 'requests') r))
           from (select public.agenda_requests(pg_temp.a()) as j) x),
          'ok|clinica|2|t', 'agenda_requests: a recepção recebe os 2 pedidos, com o telefone, a versão e se é da agenda');
select is((select concat_ws('|', jsonb_array_length(public.agenda_requests(pg_temp.a(), 'hoje') -> 'requests'),
                            public.agenda_requests(pg_temp.a(), 'hoje') #>> '{requests,0,id}' = current_setting('teste.site'),
                            jsonb_array_length(public.agenda_requests(pg_temp.a(), 'semana') -> 'requests'),
                            public.agenda_requests(pg_temp.a(), 'hoje') ->> 'today' = pg_temp.hoje()::text)),
          '1|t|2|t', 'agenda_requests: "hoje" e "semana" pela data do exame, no fuso da clínica');
select is(public.agenda_requests(pg_temp.a(), 'mes') ->> 'status', 'invalid', 'agenda_requests: período fora da lista: invalid');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', count(*), max(reads) >= 4, max(scope)) from agenda.access_log
           where user_id = pg_temp.u(2) and fn = 'agenda_requests' and clinic_id = pg_temp.a()),
          '1|t|lista', 'agenda_requests fica no access_log: uma linha por dia, a leitura repetida só soma');
select pg_temp.como(3);
select is(public.agenda_requests(pg_temp.a()) ->> 'status', 'forbidden', 'agenda_requests: o financeiro não vê os pedidos');
select pg_temp.como(4);
select is(public.agenda_requests(pg_temp.a()) ->> 'status', 'forbidden', 'agenda_requests: o profissional não vê a lista de pedidos');
select pg_temp.como(5);
select is(public.agenda_requests(pg_temp.a()) ->> 'status', 'forbidden', 'agenda_requests: a dona de outra clínica não vê');
select pg_temp.como(6);
select is(public.agenda_requests(pg_temp.a()) ->> 'status', 'justification_required', 'agenda_requests: a equipe do IMED precisa do motivo');
select is(public.agenda_requests(pg_temp.a(), null, 'tel 11999998888') ->> 'status', 'justification_required',
          'agenda_requests: motivo só em código (sem texto livre nem números longos)');
select is(public.agenda_requests(pg_temp.a(), null, 'abc') ->> 'status', 'justification_required',
          'agenda_requests: só os 4 motivos da decisão 4.2-f (um código qualquer no formato certo não abre)');
select is((select concat_ws('|', j ->> 'status', j ->> 'scope', jsonb_array_length(j -> 'requests'))
           from (select public.agenda_requests(pg_temp.a(), null, 'suporte_clinica') as j) x), 'ok|central|2',
          'agenda_requests: com o motivo, a equipe do IMED vê a lista');
select pg_temp.entrar('postgres');
select is((select justification_code from agenda.access_log where user_id = pg_temp.u(6) and fn = 'agenda_requests'), 'suporte_clinica',
          'agenda_requests: o motivo da equipe fica registrado');
-- a mesma pessoa, a mesma lista, o mesmo dia, OUTRO motivo (duas vezes): uma linha por motivo
select pg_temp.como(6);
select is(concat_ws('|', public.agenda_requests(pg_temp.a(), null, 'auditoria') ->> 'status',
                    public.agenda_requests(pg_temp.a(), null, 'auditoria') ->> 'status'), 'ok|ok',
          'agenda_requests: a mesma lista de novo, com outro motivo');
select pg_temp.entrar('postgres');
select is((select string_agg(justification_code || ':' || reads, ',' order by justification_code) from agenda.access_log
           where user_id = pg_temp.u(6) and fn = 'agenda_requests' and clinic_id = pg_temp.a()),
          'auditoria:2,suporte_clinica:1',
          'access_log: cada motivo numa linha própria (o segundo não some dentro do primeiro); o mesmo motivo repetido só soma');
select ok((select pg_get_constraintdef(c.oid) from pg_constraint c
           where c.conrelid = 'agenda.access_log'::regclass and c.conname = 'access_log_uq') like '%scope, justification_code)',
          'access_log: a chave da leitura do dia inclui o motivo');

/* ===================== agenda_attend ===================== */
select pg_temp.como(2);
select set_config('teste.e1', pg_temp.balcao('eco', pg_temp.eco_depois(5), 'Joana Lima Atendimento'), true);
select set_config('teste.e2', pg_temp.balcao('eco', pg_temp.eco_depois(60), 'Pedro Alves Atendimento'), true);
select set_config('teste.e3', pg_temp.balcao('eco', pg_temp.eco_depois(180), 'Rita Costa Atendimento'), true);
select ok(current_setting('teste.e1', true) is not null and current_setting('teste.e2', true) is not null
          and current_setting('teste.e3', true) is not null, 'três ecocardiogramas marcados com a Dra. Teste (daqui a pouco, em 1 h e em 3 h)');
select pg_temp.entrar('postgres');
select set_config('teste.e1item', pg_temp.item('e1')::text, true), set_config('teste.e1v', pg_temp.versao('e1')::text, true),
       set_config('teste.e3item', pg_temp.item('e3')::text, true);
select pg_temp.como(4);
select is((select concat_ws('|', j ->> 'status', j ->> 'request_status', (j ->> 'version')::integer > current_setting('teste.e1v')::integer)
           from (select public.agenda_attend(pg_temp.id('e1'), 'checked_in', null, current_setting('teste.e1v')::integer, pg_temp.id('e1item')) as j) x),
          'ok|checked_in|t', 'agenda_attend: o profissional registra a chegada na própria agenda');
select is((select concat_ws('|', j ->> 'status', j ->> 'version' is not null)
           from (select public.agenda_attend(pg_temp.id('e1'), 'in_service', null, current_setting('teste.e1v')::integer, pg_temp.id('e1item')) as j) x),
          'version_conflict|t', 'agenda_attend: versão velha (outra pessoa mudou antes): version_conflict');
select is(public.agenda_attend(pg_temp.id('e1'), 'in_service', null, null, pg_temp.id('e1item')) ->> 'request_status', 'in_service',
          'agenda_attend: em atendimento');
select is(public.agenda_attend(pg_temp.id('e1'), 'completed', null, null, pg_temp.id('e1item')) ->> 'request_status', 'completed',
          'agenda_attend: concluído');
select is(public.agenda_attend(pg_temp.id('b1'), 'checked_in', null, null, pg_temp.id('b1item')) ->> 'status', 'forbidden',
          'agenda_attend: o profissional não mexe em exame de outro aparelho (USG-1)');
select is(public.agenda_attend(pg_temp.id('e2'), 'no_show') ->> 'status', 'too_early',
          'agenda_attend: "não compareceu" só depois do início + tolerância');
select is(public.agenda_attend(pg_temp.id('e2'), 'in_service') ->> 'status', 'transition_not_allowed',
          'agenda_attend: de confirmado não vai direto para "em atendimento"');
select is(public.agenda_attend(pg_temp.id('e2'), 'cancelled') ->> 'status', 'invalid_status',
          'agenda_attend: só chegada, atendimento, concluído e falta');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', bool_and(not o.active), max(o.release_reason)) from agenda.occupancy o where o.item_id = pg_temp.id('e1item')),
          't|concluido', 'concluído solta a ocupação (concluido)');
select is((select string_agg(concat_ws(':', h.to_status, h.actor_role, h.origin), ',' order by h.at, h.id)
           from agenda.status_history h where h.item_id = pg_temp.id('e1item') and h.from_status is not null),
          'checked_in:professional:painel,in_service:professional:painel,completed:professional:painel',
          'histórico de cada item com o papel (profissional) e a origem (painel)');
-- falta: o exame das 3 h passa a ter começado há 40 min; a recepção marca a falta; o profissional não desfaz
select pg_temp.mover('e3', now() - interval '40 minutes' - (select a.slot_start from public.appointment_requests a where a.id = pg_temp.id('e3')));
select pg_temp.como(2);
select is(public.agenda_attend(pg_temp.id('e3'), 'no_show', null, null, pg_temp.id('e3item')) ->> 'request_status', 'no_show',
          'agenda_attend: a recepção marca "não compareceu" (o mesmo caminho de agenda_set_status)');
select pg_temp.como(4);
select is(public.agenda_attend(pg_temp.id('e3'), 'checked_in', 'chegou_atrasado', null, pg_temp.id('e3item')) ->> 'status', 'transition_not_allowed',
          'agenda_attend: o profissional não desfaz a falta (volta a ocupar: só a recepção)');
select pg_temp.como(2);
select is(public.agenda_attend(pg_temp.id('e2'), 'checked_in') ->> 'request_status', 'checked_in',
          'agenda_attend: a recepção registra a chegada (janela de 2 h antes do início)');
select is(public.agenda_attend(pg_temp.id('site'), 'checked_in') ->> 'status', 'not_agenda',
          'agenda_attend: pedido sem horário não é da agenda');
select pg_temp.como(3);
select is(public.agenda_attend(pg_temp.id('e2'), 'in_service') ->> 'status', 'forbidden', 'agenda_attend: o financeiro não atende');
select pg_temp.como(5);
select is(public.agenda_attend(pg_temp.id('e2'), 'in_service') ->> 'status', 'forbidden', 'agenda_attend: a dona de outra clínica não atende');
select pg_temp.entrar('anon');
select throws_ok($$ select public.agenda_attend(pg_temp.id('e2'), 'in_service') $$, '42501', null, 'agenda_attend: visitante nem executa');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', a.status, (select string_agg(i.status, ',') from agenda.appointment_items i where i.request_id = a.id))
           from public.appointment_requests a where a.id = pg_temp.id('bb')), 'confirmed|confirmed', 'nada da clínica B mudou');

select * from finish();
rollback;
