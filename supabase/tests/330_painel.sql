-- Painel no banco (iMed Agenda, fase 3.4; arquitetura §11, §12 e §13):
--   - agenda_me (unidades, papel e permissões), agenda_version, agenda_view (dia/semana), agenda_month, agenda_search,
--     agenda_request_detail, agenda_history, agenda_dashboard, agenda_dashboard_financeiro, conflitos;
--   - cada papel vê o que a matriz do §12 manda: recepção vê tudo da clínica; profissional só a própria agenda e sem
--     telefone; financeiro só o financeiro; a equipe do IMED vê a grade sem nomes e abre dado de paciente só com
--     justificativa (desde a 4.2, só um dos 4 motivos da decisão 4.2-f); leitura de dado de paciente fica em
--     agenda.access_log (repetida soma; outro motivo no mesmo dia, outra linha);
--   - preço "a partir de" em clinic_exams; set_my_clinic_exams e update_my_clinic por permissão.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test; nomes fictícios.
begin;
select plan(56);
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
  select ('a3340000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'recepcao', 'prof', 'fin', 'donab', 'admin'])[p_n] || '.painel@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.itens(p_proc text, p_hhmm text) returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id(p_proc), 'starts_at', pg_temp.t(p_hhmm))) $$;
create function pg_temp.clinica() returns uuid language sql immutable as $$ select 'c3340000-0000-4000-8000-000000000001'::uuid $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated', pg_temp.email(n), now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from generate_series(1, 6) n;
insert into public.admin_emails (email) values (pg_temp.email(6));
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua do Painel, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values ('c3340000-0000-4000-8000-000000000001'::uuid, 'Clínica do Painel', 1),
             ('c3340000-0000-4000-8000-000000000002'::uuid, 'Outra Clínica do Painel', 2)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  (pg_temp.clinica(), pg_temp.u(1), 'owner'), (pg_temp.clinica(), pg_temp.u(2), 'reception'),
  (pg_temp.clinica(), pg_temp.u(3), 'professional'), (pg_temp.clinica(), pg_temp.u(4), 'finance'),
  ('c3340000-0000-4000-8000-000000000002', pg_temp.u(5), 'owner');
insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949'
where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1));

select pg_temp.como(1);
select public.agenda_unit_save(pg_temp.clinica(), jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_min', 30));
select set_config('teste.usg1', public.agenda_resource_save(pg_temp.clinica(),
         jsonb_build_object('kind', 'equipamento', 'name', 'USG-1', 'member_user_id', pg_temp.u(3))) ->> 'id', true);
select set_config('teste.rm1', public.agenda_resource_save(pg_temp.clinica(), '{"kind": "equipamento", "name": "RM-1"}') ->> 'id', true);
select set_config('teste.usg', public.agenda_procedure_save(pg_temp.clinica(), jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom', 'duration_min', 30, 'price_cents', 15000,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('usg1'))))))) ->> 'id', true);
select set_config('teste.rm', public.agenda_procedure_save(pg_temp.clinica(), jsonb_build_object(
  'exam_code', 'rm', 'name', 'Ressonância', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('rm1'))))))) ->> 'id', true);
select public.agenda_rules_set(pg_temp.clinica(), null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d));
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_agenda', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now() where id = pg_temp.clinica();
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);

select pg_temp.como(2);
select set_config('teste.b1', public.agenda_desk_book(pg_temp.clinica(), pg_temp.itens('rm', '10:00'),
         '{"name": "Maria Souza Lima", "phone": "(11) 98888-7777", "consent": true}', 'clinica_telefone') ->> 'id', true);
select set_config('teste.b2', public.agenda_desk_book(pg_temp.clinica(), pg_temp.itens('usg', '11:00'),
         '{"name": "João Pedro Teste", "phone": "(11) 97777-6666", "consent": true}', 'clinica_balcao') ->> 'id', true);
select ok(current_setting('teste.b1', true) is not null and current_setting('teste.b2', true) is not null,
          'a recepção marca dois exames pelo balcão (ressonância 10:00 e ultrassom 11:00)');

/* ===================== Quem sou e versão ===================== */
select is((select concat_ws('|', jsonb_array_length(j -> 'clinics'), j #>> '{clinics,0,role}', j #>> '{clinics,0,permissions,agenda.marcar}',
                            j #>> '{clinics,0,agenda_active}')
           from (select public.agenda_me() as j) x), '1|reception|clinica|true', 'agenda_me: a recepção vê a unidade, o papel e as permissões');
select pg_temp.como(4);
select is((select concat_ws('|', j #>> '{clinics,0,permissions,financeiro.ver}', coalesce(j #>> '{clinics,0,permissions,agenda.ver}', '-'))
           from (select public.agenda_me() as j) x), 'clinica|-', 'agenda_me: o financeiro tem só o financeiro');
select is(public.agenda_version(pg_temp.clinica()) ->> 'status', 'forbidden', 'agenda_version: o financeiro não vê a agenda');
select pg_temp.como(6);
select is(public.agenda_me() #>> '{imed,admin}', 'true', 'agenda_me: o dono do IMED aparece como admin');
select pg_temp.entrar('anon');
select throws_ok($$ select public.agenda_me() $$, '42501', null, 'visitante nem executa agenda_me');
select pg_temp.como(2);
select ok((public.agenda_version(pg_temp.clinica()) ->> 'version')::bigint >= 2, 'agenda_version: a versão subiu com as marcações');

/* ===================== Grade ===================== */
select is((select concat_ws('|', jsonb_array_length(j -> 'items'), j #>> '{items,0,patient}', j #>> '{items,1,patient}', j ->> 'patients')
           from (select public.agenda_view(pg_temp.clinica(), pg_temp.dia(), 1) as j) x),
          '2|Maria L.|João T.|true', 'agenda_view: a recepção vê os 2 agendamentos com o nome curto ("Maria L.")');
select ok(public.agenda_view(pg_temp.clinica(), pg_temp.dia(), 1)::text !~ '(Souza|98888|7777)',
          'agenda_view: nem sobrenome do meio nem telefone na grade');
select pg_temp.entrar('postgres');
select is((select reads from agenda.access_log where user_id = pg_temp.u(2) and fn = 'agenda_view' and clinic_id = pg_temp.clinica()),
          2, 'access_log: duas leituras da grade no mesmo dia = uma linha com reads 2');
select pg_temp.como(2);
select is(public.agenda_view(pg_temp.clinica(), pg_temp.dia(), 8) ->> 'status', 'invalid', 'agenda_view: no máximo 7 dias');
select is(jsonb_array_length(public.agenda_view(pg_temp.clinica(), pg_temp.dia() - 3, 7) -> 'items'), 2, 'agenda_view: a semana');
select pg_temp.como(3);
select is((select concat_ws('|', jsonb_array_length(j -> 'items'), j #>> '{items,0,patient}', jsonb_array_length(j -> 'resources'), j ->> 'scope')
           from (select public.agenda_view(pg_temp.clinica(), pg_temp.dia(), 1) as j) x),
          '1|João T.|1|propria', 'agenda_view: o profissional vê só o próprio aparelho (USG-1) e o exame dele');
select pg_temp.como(4);
select is(public.agenda_view(pg_temp.clinica(), pg_temp.dia(), 1) ->> 'status', 'forbidden', 'agenda_view: o financeiro não vê a grade');
select pg_temp.como(6);
select is((select concat_ws('|', jsonb_array_length(j -> 'items'), coalesce(j #>> '{items,0,patient}', '-'), j ->> 'scope')
           from (select public.agenda_view(pg_temp.clinica(), pg_temp.dia(), 1) as j) x),
          '2|-|central', 'agenda_view: a equipe do IMED vê a grade sem nomes');
select pg_temp.como(2);
select is((select (d ->> 'ativos')::int from jsonb_array_elements(public.agenda_month(pg_temp.clinica(), pg_temp.dia()) -> 'days') d
           where (d ->> 'day')::date = pg_temp.dia()), 2, 'agenda_month: 2 agendamentos ativos no dia');
select is(jsonb_array_length(public.agenda_month(pg_temp.clinica(), pg_temp.dia()) -> 'days'),
          extract(day from (date_trunc('month', pg_temp.dia()) + interval '1 month - 1 day'))::int, 'agenda_month: um item por dia do mês');

/* ===================== Busca ===================== */
select is(public.agenda_search(pg_temp.clinica(), 'Ma') ->> 'status', 'too_short', 'agenda_search: mínimo 3 caracteres');
select is((select concat_ws('|', jsonb_array_length(j -> 'results'), j #>> '{results,0,name}', j #>> '{results,0,phone_end}')
           from (select public.agenda_search(pg_temp.clinica(), 'souza') as j) x),
          '1|Maria Souza Lima|7777', 'agenda_search: acha pelo nome (maiúscula ou minúscula) e mostra só o fim do telefone');
select is(jsonb_array_length(public.agenda_search(pg_temp.clinica(), '97777') -> 'results'), 1, 'agenda_search: acha pelos dígitos do telefone');
select is(jsonb_array_length(public.agenda_search(pg_temp.clinica(), '%%%') -> 'results'), 0, 'agenda_search: curinga do LIKE não vale');
select pg_temp.entrar('postgres');
select ok(exists (select 1 from agenda.access_log where user_id = pg_temp.u(2) and fn = 'agenda_search' and scope = 'busca'),
          'agenda_search fica no access_log');
select pg_temp.como(2);
select pg_temp.como(3);
select is((select concat_ws('|', jsonb_array_length(public.agenda_search(pg_temp.clinica(), 'maria') -> 'results'),
                            jsonb_array_length(public.agenda_search(pg_temp.clinica(), '97777') -> 'results'),
                            coalesce(public.agenda_search(pg_temp.clinica(), 'joão') #>> '{results,0,phone_end}', '-'))),
          '0|0|-', 'agenda_search: o profissional só acha os pacientes dele, sem telefone');
select pg_temp.como(4);
select is(public.agenda_search(pg_temp.clinica(), 'maria') ->> 'status', 'forbidden', 'agenda_search: o financeiro não busca pacientes');

/* ===================== Detalhe e histórico ===================== */
select pg_temp.como(2);
select is((select concat_ws('|', j ->> 'scope', j #>> '{patient,name}', j #>> '{patient,phone}', j #>> '{items,0,resources,0,name}')
           from (select public.agenda_request_detail(pg_temp.id('b1')) as j) x),
          'clinica|Maria Souza Lima|11988887777|RM-1', 'detalhe: a recepção vê nome, telefone e o aparelho');
select pg_temp.como(3);
select is((select concat_ws('|', j ->> 'scope', j #>> '{patient,name}', coalesce(j #>> '{patient,phone}', '-'), coalesce(j #>> '{patient,email}', '-'))
           from (select public.agenda_request_detail(pg_temp.id('b2')) as j) x),
          'propria|João Pedro Teste|-|-', 'detalhe: o profissional vê o paciente dele sem telefone nem e-mail');
select is(public.agenda_request_detail(pg_temp.id('b1')) ->> 'status', 'forbidden', 'detalhe: o profissional não abre agendamento de outro aparelho');
select pg_temp.como(4);
select is(public.agenda_request_detail(pg_temp.id('b1')) ->> 'status', 'forbidden', 'detalhe: o financeiro não abre');
select pg_temp.como(6);
select is(public.agenda_request_detail(pg_temp.id('b1')) ->> 'status', 'justification_required',
          'detalhe: a equipe do IMED precisa de justificativa ("quebra de vidro")');
select is(public.agenda_request_detail(pg_temp.id('b1'), 'Suporte ao paciente') ->> 'status', 'justification_required',
          'detalhe: justificativa só em código');
select is(public.agenda_request_detail(pg_temp.id('b1'), 'paciente_pediu_ajuda') ->> 'status', 'justification_required',
          'detalhe (4.2): código fora dos 4 motivos da decisão 4.2-f não abre, mesmo no formato certo');
select is(public.agenda_request_detail(pg_temp.id('b1'), 'pedido_do_paciente') #>> '{patient,phone}', '11988887777',
          'detalhe: com a justificativa, abre');
select pg_temp.entrar('postgres');
select is((select justification_code from agenda.access_log where user_id = pg_temp.u(6) and fn = 'agenda_request_detail'),
          'pedido_do_paciente', 'access_log guarda a justificativa da equipe do IMED');
select pg_temp.como(6);
select is(public.agenda_request_detail(pg_temp.id('b1'), 'auditoria') ->> 'status', 'ok', 'detalhe: o mesmo agendamento, no mesmo dia, com outro motivo');
select pg_temp.entrar('postgres');
select is((select string_agg(justification_code || ':' || reads, ',' order by justification_code) from agenda.access_log
           where user_id = pg_temp.u(6) and fn = 'agenda_request_detail'),
          'auditoria:1,pedido_do_paciente:1', 'access_log (4.2): cada motivo numa linha própria (o segundo não some dentro do primeiro)');
select pg_temp.como(6);
select pg_temp.como(2);
select is((select concat_ws('|', h ->> 'to', h ->> 'actor_kind', h ->> 'origin')
           from jsonb_array_elements(public.agenda_history(pg_temp.id('b1')) -> 'history') h limit 1),
          'confirmed|clinica|painel', 'agenda_history: só códigos (situação, quem, origem)');
select ok(public.agenda_history(pg_temp.id('b1'))::text !~ '(Maria|98888)', 'agenda_history sem dado de paciente');
select pg_temp.como(5);
select is(concat_ws('|', public.agenda_view(pg_temp.clinica(), pg_temp.dia(), 1) ->> 'status',
                    public.agenda_request_detail(pg_temp.id('b1')) ->> 'status', public.agenda_history(pg_temp.id('b1')) ->> 'status',
                    public.agenda_search(pg_temp.clinica(), 'maria') ->> 'status'),
          'forbidden|forbidden|forbidden|forbidden', 'a dona de OUTRA clínica não vê nada desta');

/* ===================== Painel gerencial ===================== */
select pg_temp.como(2);
select is((select concat_ws('|', j ->> 'total', j #>> '{por_situacao,confirmado}', j #>> '{origem,clinica}', j #>> '{origem,imed}')
           from (select public.agenda_dashboard(pg_temp.clinica(), pg_temp.dia(), pg_temp.dia()) as j) x),
          '2|2|2|0', 'agenda_dashboard: totais, situação e origem');
select is((select concat_ws('|', r ->> 'name', r ->> 'minutos_ocupados', r ->> 'minutos_abertos')
           from jsonb_array_elements(public.agenda_dashboard(pg_temp.clinica(), pg_temp.dia(), pg_temp.dia()) -> 'recursos') r
           where r ->> 'name' = 'RM-1'), 'RM-1|30|1440', 'agenda_dashboard: ocupação do RM-1 = 30 de 1440 minutos');
select is(public.agenda_dashboard(pg_temp.clinica(), pg_temp.dia(), pg_temp.dia(), jsonb_build_object('procedure_id', pg_temp.id('usg'))) ->> 'total',
          '1', 'agenda_dashboard: filtro por procedimento');
select is(public.agenda_dashboard(pg_temp.clinica(), pg_temp.dia(), pg_temp.dia() + 100) ->> 'status', 'invalid', 'agenda_dashboard: até 92 dias');
select ok(public.agenda_dashboard(pg_temp.clinica(), pg_temp.dia(), pg_temp.dia())::text !~ '(Maria|João|98888)', 'agenda_dashboard sem dado pessoal');
select is(public.agenda_dashboard_financeiro(pg_temp.clinica(), pg_temp.dia(), pg_temp.dia()) ->> 'status', 'forbidden',
          'financeiro: a recepção não vê');
select pg_temp.como(4);
select is((select concat_ws('|', j ->> 'receita_estimada_cents', j ->> 'receita_concluida_cents', j ->> 'sob_consulta', j ->> 'agendamentos')
           from (select public.agenda_dashboard_financeiro(pg_temp.clinica(), pg_temp.dia(), pg_temp.dia()) as j) x),
          '15000|0|1|2', 'financeiro: receita estimada pelo preço informado; "sob consulta" só contado');
select is(public.agenda_dashboard(pg_temp.clinica(), pg_temp.dia(), pg_temp.dia()) ->> 'status', 'forbidden', 'agenda_dashboard: o financeiro não vê a operação');

/* ===================== Conflitos ===================== */
select pg_temp.entrar('postgres');
insert into agenda.conflicts (clinic_id, kind, request_id, item_id, details)
select pg_temp.clinica(), 'grade_mudou', i.request_id, i.id, jsonb_build_object('starts_at', i.starts_at)
from agenda.appointment_items i where i.request_id = pg_temp.id('b1');
select set_config('teste.k1', (select id::text from agenda.conflicts where request_id = pg_temp.id('b1')), true);
select pg_temp.como(2);
select is(jsonb_array_length(public.agenda_conflicts(pg_temp.clinica()) -> 'conflicts'), 1, 'agenda_conflicts: o conflito aberto aparece');
select is(public.agenda_conflict_resolve(pg_temp.id('k1'), 'resolvido') ->> 'status',
          'reason_required', 'resolver exige o código da resolução');
select is(public.agenda_conflict_resolve(pg_temp.id('k1'), 'resolvido', 'confirmado_com_paciente') ->> 'status',
          'ok', 'a recepção resolve o conflito');
select is(concat_ws('|', jsonb_array_length(public.agenda_conflicts(pg_temp.clinica()) -> 'conflicts'),
                    jsonb_array_length(public.agenda_conflicts(pg_temp.clinica(), true) -> 'conflicts')),
          '0|1', 'resolvido some dos abertos e fica no histórico de 90 dias');
select pg_temp.como(5);
select is(public.agenda_conflicts(pg_temp.clinica()) ->> 'status', 'forbidden', 'conflitos: outra clínica não vê');

/* ===================== Preço "a partir de" e funções antigas ===================== */
select pg_temp.entrar('postgres');
select is((select concat_ws('|', (select price_cents from public.clinic_exams where clinic_id = pg_temp.clinica() and exam_code = 'usg'),
                            coalesce((select price_cents::text from public.clinic_exams where clinic_id = pg_temp.clinica() and exam_code = 'rm'), 'sob consulta'))),
          '15000|sob consulta', 'clinic_exams: o preço da categoria vem dos procedimentos ("a partir de")');
select pg_temp.como(2);
select is(public.set_my_clinic_exams(pg_temp.clinica(), '[{"code": "usg", "price_cents": 9000}]'), 'forbidden',
          'set_my_clinic_exams: a recepção não muda preço (precos.editar)');
select is(public.update_my_clinic(pg_temp.clinica(), '{"phone": "(11) 3000-3340"}'), 'forbidden',
          'update_my_clinic: a recepção não muda o cadastro (clinica.editar)');
select pg_temp.como(1);
select is(public.set_my_clinic_exams(pg_temp.clinica(), '[{"code": "usg", "price_cents": 9000}, {"code": "rm"}, {"code": "rx", "price_cents": 5000}]'),
          'managed_by_agenda', 'set_my_clinic_exams: categoria da agenda não muda pelo editor antigo');
select pg_temp.entrar('postgres');
select is((select string_agg(exam_code || ':' || coalesce(price_cents::text, '-'), ',' order by exam_code) from public.clinic_exams where clinic_id = pg_temp.clinica()),
          'rm:-,rx:5000,usg:15000', 'o resto da lista é gravado; usg continua com o preço da agenda');

select * from finish();
rollback;
