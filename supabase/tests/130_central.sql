-- Central do IMED (iMed Agenda, fase 4.4; arquitetura §11 e §12): as funções agenda_central_* do painel de gestão.
--   A. quem executa: visitante não executa nenhuma; conta de clínica e o papel "financeiro" recebem forbidden em
--      todas; "suporte" lê (versão, clínicas, conflitos, parâmetros, feriados) e não vê auditoria, prévia de feriado,
--      papéis nem muda parâmetro; "auditoria" lê a auditoria; "operação" lança feriado e vê a prévia; papéis e
--      parâmetros são só do administrador;
--   B. clínicas e versão: modalidade, agenda ativa, fuso confirmado, feriados conferidos, versão, conflitos abertos,
--      agendamentos por vir e equipe (contagens);
--   C. feriados: prévia (clínicas que fecham e agendamentos no dia), lançar (função da 3.2) abre o conflito, a lista
--      mostra o feriado e até quando o motor oferece horário; retirar;
--   D. conflitos de todas as clínicas, sem nada do pedido;
--   E. auditoria: mudanças com papel, origem e o código curto da conta; leituras de dado de paciente só somadas;
--      filtros; nenhum dado de paciente em nenhuma resposta;
--   F. parâmetros globais: padrão igual ao do código, limites, voltar ao padrão, auditoria;
--   G. papéis da equipe: dar (conta existente e confirmada), repetir, tirar, dar de novo; tudo na auditoria.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test; nomes fictícios.
begin;
select plan(89);

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
  select ('a130000' || p_n::text || '-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['admin', 'operacao', 'suporte', 'auditoria', 'financeiro', 'dona', 'recepcao', 'nova', 'semconfirmar'])[p_n] || '.central44@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.cod(p_n integer) returns text language sql immutable as $$ select left(pg_temp.u(p_n)::text, 8) $$;
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.a() returns uuid language sql immutable as $$ select 'c1300000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.b() returns uuid language sql immutable as $$ select 'c1300000-0000-4000-8000-000000000002'::uuid $$;
-- a linha de uma clínica na resposta de agenda_central_overview
create function pg_temp.linha(p_j jsonb, p_clinic uuid) returns jsonb language sql immutable as $$
  select c from jsonb_array_elements(p_j -> 'clinics') c where (c ->> 'clinic_id')::uuid = p_clinic $$;
-- as 11 funções, cada uma com uma chamada de exemplo
create function pg_temp.chamadas() returns table (fn text, sql text) language sql immutable as $$
  values ('version', 'select public.agenda_central_version()'),
         ('overview', 'select public.agenda_central_overview()'),
         ('conflicts', 'select public.agenda_central_conflicts(false)'),
         ('audit', 'select public.agenda_central_audit(''{}'')'),
         ('settings', 'select public.agenda_central_settings()'),
         ('setting_set', 'select public.agenda_central_setting_set(''agenda.limite_futuros_por_telefone'', 4)'),
         ('holidays', 'select public.agenda_central_holidays()'),
         ('holiday_preview', 'select public.agenda_central_holiday_preview(current_date + 30)'),
         ('staff', 'select public.agenda_central_staff()'),
         ('staff_grant', 'select public.agenda_central_staff_grant(''nova.central44@exemplo.test'', ''suporte'')'),
         ('staff_revoke', 'select public.agenda_central_staff_revoke(''a1300008-0000-4000-8000-000000000008'', ''suporte'')') $$;
-- quais das 11 respondem "forbidden" para quem está logado agora (em ordem alfabética)
create function pg_temp.negadas(p_so_leitura boolean default false) returns text language plpgsql as $$
declare
  k record;
  j jsonb;
  v text[] := '{}';
begin
  for k in select * from pg_temp.chamadas() c where not (p_so_leitura and c.fn in ('setting_set', 'staff_grant', 'staff_revoke')) order by fn loop
    execute k.sql into j;
    if j ->> 'status' = 'forbidden' then v := v || k.fn; end if;
  end loop;
  return array_to_string(v, ',');
end $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated', pg_temp.email(n),
       case when n <> 9 then now() end, '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from generate_series(1, 9) n;
insert into public.admin_emails (email) values (pg_temp.email(1));
insert into private.imed_staff (user_id, role) values
  (pg_temp.u(2), 'operacao'), (pg_temp.u(3), 'suporte'), (pg_temp.u(4), 'auditoria'), (pg_temp.u(5), 'financeiro');
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua da Central, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values (pg_temp.a(), 'Clínica da Central', 1), (pg_temp.b(), 'Outra Clínica da Central', 2)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  (pg_temp.a(), pg_temp.u(6), 'owner'), (pg_temp.a(), pg_temp.u(7), 'reception');
insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Fonte de teste (Lei 662/1949)'
where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1));

-- A clínica A com a agenda ativa (um aparelho, um exame, aberta o dia inteiro) e um agendamento de balcão no dia D.
select pg_temp.como(6);
select public.agenda_unit_save(pg_temp.a(), jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_min', 30));
select set_config('teste.rm1', public.agenda_resource_save(pg_temp.a(), '{"kind": "equipamento", "name": "RM-1"}') ->> 'id', true);
select set_config('teste.rm', public.agenda_procedure_save(pg_temp.a(), jsonb_build_object(
  'exam_code', 'rm', 'name', 'Ressonância', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('rm1'))))))) ->> 'id', true);
select public.agenda_rules_set(pg_temp.a(), null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d));
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_agenda', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now() where id = pg_temp.a();
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
select pg_temp.como(7);
select set_config('teste.b1', public.agenda_desk_book(pg_temp.a(),
         jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id('rm'), 'starts_at', pg_temp.t('10:00'))),
         '{"name": "Zuleica Central Quaresma", "phone": "(11) 98888-4411", "consent": true}', 'clinica_telefone') ->> 'id', true);
select ok(current_setting('teste.b1', true) ~ '^[0-9a-f-]{36}$', 'preparo: a recepção marca uma ressonância no dia D');
-- duas leituras da grade (dado de paciente) pela recepção: vão para o access_log
-- (como testes: um "ok" solto na saída seria lido pelo pg_prove como um teste fora de ordem)
select is(public.agenda_view(pg_temp.a(), pg_temp.dia(), 1) ->> 'status', 'ok', 'preparo: a recepção lê a grade do dia D (1ª leitura)');
select is(public.agenda_view(pg_temp.a(), pg_temp.dia(), 1) ->> 'status', 'ok', 'preparo: a recepção lê a grade do dia D (2ª leitura)');

/* ===================== A. Quem executa ===================== */
select pg_temp.entrar('anon');
select is((select count(*)::int from pg_temp.chamadas() k
           where not has_function_privilege('anon', regexp_replace(k.sql, '^select (public\.[a-z_]+)\(.*$', '\1')::regproc, 'EXECUTE')), 11,
          'visitante não executa nenhuma das 11 funções da central');
select throws_ok($$ select public.agenda_central_overview() $$, '42501', null, 'visitante: agenda_central_overview recusada pelo banco');
select throws_ok($$ select public.agenda_central_staff() $$, '42501', null, 'visitante: agenda_central_staff recusada pelo banco');
select pg_temp.como(6);
select is(pg_temp.negadas(), 'audit,conflicts,holiday_preview,holidays,overview,setting_set,settings,staff,staff_grant,staff_revoke,version',
          'a dona de uma clínica recebe forbidden nas 11');
select pg_temp.como(8);
select is(pg_temp.negadas(), 'audit,conflicts,holiday_preview,holidays,overview,setting_set,settings,staff,staff_grant,staff_revoke,version',
          'uma conta comum recebe forbidden nas 11');
select pg_temp.como(5);
select is(pg_temp.negadas(), 'audit,conflicts,holiday_preview,holidays,overview,setting_set,settings,staff,staff_grant,staff_revoke,version',
          'o papel financeiro (sem imed.agenda.monitor) recebe forbidden nas 11');
select pg_temp.como(3);
select is(pg_temp.negadas(), 'audit,holiday_preview,setting_set,staff,staff_grant,staff_revoke',
          'suporte: lê versão, clínicas, conflitos, parâmetros e feriados; sem auditoria, prévia, papéis nem mudar parâmetro');
select pg_temp.como(4);
select is(pg_temp.negadas(), 'holiday_preview,setting_set,staff,staff_grant,staff_revoke',
          'auditoria: lê também a auditoria; não lança feriado, não mexe em papéis nem em parâmetro');
select pg_temp.como(2);
select is(pg_temp.negadas(), 'audit,setting_set,staff,staff_grant,staff_revoke',
          'operação: vê a prévia do feriado; sem auditoria, papéis nem mudar parâmetro (só o administrador)');
select pg_temp.entrar('postgres');
select is((select count(*)::int from private.imed_staff where user_id = pg_temp.u(8)), 0, 'nenhuma das tentativas recusadas gravou papel');
select is((select count(*)::int from agenda.settings_global), 0, 'nem parâmetro');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'agenda\_central\_%'
             and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])), 0,
          'as funções da central são SECURITY DEFINER com search_path vazio');
select ok(not has_function_privilege('authenticated', 'private.agenda_central_params()', 'EXECUTE')
          and not has_function_privilege('service_role', 'private.agenda_central_params()', 'EXECUTE'),
          'a lista de parâmetros (private) não é executável pela API');

/* ===================== B. Clínicas e versão ===================== */
select pg_temp.como(3);
select set_config('teste.ov', public.agenda_central_overview()::text, true);
select is((select concat_ws('|', l ->> 'name', l ->> 'city', l ->> 'state', l ->> 'agenda_mode', l ->> 'agenda_active', l ->> 'timezone',
                            (l ->> 'timezone_confirmed_at') is not null, l ->> 'holidays_checked_until', l ->> 'open_conflicts',
                            l ->> 'upcoming', l ->> 'members', l ->> 'online_since' is null, l ->> 'closes_on_holidays')
           from (select pg_temp.linha(current_setting('teste.ov')::jsonb, pg_temp.a()) l) x),
          concat_ws('|', 'Clínica da Central', 'São Paulo', 'SP', 'nativa', 'true', 'America/Sao_Paulo', 't', (pg_temp.dia() + 200)::text,
                    '0', '1', '2', 't', 'true'),
          'clínica A: modalidade, agenda ativa, fuso confirmado, feriados conferidos até, 0 conflito, 1 agendamento por vir, equipe de 2');
select ok((pg_temp.linha(current_setting('teste.ov')::jsonb, pg_temp.a()) ->> 'version')::bigint >= 2
          and (pg_temp.linha(current_setting('teste.ov')::jsonb, pg_temp.a()) ->> 'changed_at')::timestamptz <= now(),
          'clínica A: versão e última atividade');
select is((select concat_ws('|', l ->> 'agenda_mode', l ->> 'agenda_active', l ->> 'version', l ->> 'changed_at' is null,
                            l ->> 'holidays_checked_until' is null, l ->> 'timezone_confirmed_at' is null, l ->> 'members')
           from (select pg_temp.linha(current_setting('teste.ov')::jsonb, pg_temp.b()) l) x),
          'pedido|false|0|t|t|t|0', 'clínica B (sem agenda): pedido, sem versão, sem atividade, fuso não confirmado');
select ok((select (j #>> '{totals,clinics}')::int >= 2 and (j #>> '{totals,agenda_active}')::int >= 1
                  and (j #>> '{totals,by_mode,nativa}')::int >= 1 and (j #>> '{totals,upcoming}')::int >= 1
                  and (j ->> 'truncated') = 'false' and (j ->> 'national_holidays_until') is not null
           from (select current_setting('teste.ov')::jsonb j) x), 'totais das clínicas e até quando há feriado nacional lançado');
select ok((select (c ->> 'agenda_active')::boolean from jsonb_array_elements(current_setting('teste.ov')::jsonb -> 'clinics') with ordinality t (c, n)
           order by n limit 1), 'as clínicas com a agenda ativa vêm primeiro');
select set_config('teste.v0', public.agenda_central_version() ->> 'version', true);
select ok(current_setting('teste.v0')::bigint >= 2 and (public.agenda_central_version() ->> 'clinics')::int >= 1,
          'versão da central: soma das versões e número de clínicas com agenda');

/* ===================== C. Feriados ===================== */
select pg_temp.como(2);
select is((select concat_ws('|', j ->> 'status', j ->> 'already', (j ->> 'clinics_closing')::int >= 1, j ->> 'appointments')
           from (select public.agenda_central_holiday_preview(pg_temp.dia()) j) x), 'ok|false|t|1',
          'prévia do feriado no dia D: a clínica A fecha e tem 1 agendamento nesse dia');
select is(public.agenda_central_holiday_preview(pg_temp.dia() + 1) ->> 'appointments', '0', 'prévia de um dia sem agendamento: 0');
select is(public.agenda_central_holiday_preview(null) ->> 'status', 'invalid', 'prévia sem dia: invalid');
select set_config('teste.fer', public.agenda_holiday_save(jsonb_build_object('scope', 'nacional', 'day', pg_temp.dia(),
         'name', 'Feriado de Teste da Central', 'source', 'Fonte de teste (não é lei)'))::text, true);
select is((select concat_ws('|', j ->> 'status', j ->> 'conflicts') from (select current_setting('teste.fer')::jsonb j) x), 'ok|1',
          'a operação lança o feriado (função da 3.2): 1 conflito aberto na clínica A');
select is(public.agenda_central_holiday_preview(pg_temp.dia()) ->> 'already', 'true', 'a prévia passa a dizer que o dia já é feriado');
select is((select concat_ws('|', j ->> 'status', j ->> 'can_edit', (j ->> 'national_until')::date >= pg_temp.dia(),
                            (j ->> 'clinics_with_agenda')::int >= 1, j ->> 'today')
           from (select public.agenda_central_holidays() j) x),
          concat_ws('|', 'ok', 'true', 't', 't', ((now() at time zone 'America/Sao_Paulo')::date)::text),
          'feriados: a operação pode editar; até quando o motor oferece horário');
select is((select concat_ws('|', h ->> 'scope', h ->> 'name', h ->> 'source', h ->> 'uf' is null)
           from jsonb_array_elements(public.agenda_central_holidays() -> 'holidays') h where (h ->> 'day')::date = pg_temp.dia()),
          'nacional|Feriado de Teste da Central|Fonte de teste (não é lei)|t', 'a lista traz o feriado com o nome e a fonte');
select pg_temp.como(3);
select is(public.agenda_central_holidays() ->> 'can_edit', 'false', 'feriados: o suporte lê, mas não pode editar');
select is(public.agenda_holiday_save('{"scope": "nacional", "day": "2031-01-01", "name": "Outro", "source": "Fonte de teste"}') ->> 'status',
          'forbidden', 'e a função de lançar recusa o suporte');
select ok(public.agenda_central_version() ->> 'version' > '' and (public.agenda_central_version() ->> 'version')::bigint > current_setting('teste.v0')::bigint
          and (public.agenda_central_version() ->> 'open_conflicts')::int >= 1,
          'a versão da central subiu com o feriado e conta o conflito aberto');

/* ===================== D. Conflitos ===================== */
select set_config('teste.kf', public.agenda_central_conflicts()::text, true);
select is((select concat_ws('|', k ->> 'clinic_name', k ->> 'kind', k ->> 'status', (k ->> 'starts_at')::timestamptz = pg_temp.t('10:00'),
                            k ->> 'timezone', k ->> 'resolved_at' is null)
           from jsonb_array_elements(current_setting('teste.kf')::jsonb -> 'conflicts') k where (k ->> 'clinic_id')::uuid = pg_temp.a()),
          'Clínica da Central|grade_mudou|aberto|t|America/Sao_Paulo|t', 'conflito aberto: clínica, tipo, situação e horário do item');
select ok((select (j ->> 'open')::int >= 1 and (j ->> 'total')::int >= (j ->> 'open')::int from (select current_setting('teste.kf')::jsonb j) x),
          'conflitos: contagem dos abertos e do total');
select ok(not exists (select 1 from jsonb_array_elements(current_setting('teste.kf')::jsonb -> 'conflicts') k
                      where k ?| array['request_id', 'item_id', 'details', 'patient', 'patient_name']),
          'conflitos: nada do pedido, do item ou do paciente na resposta');
select is((pg_temp.linha(public.agenda_central_overview(), pg_temp.a()) ->> 'open_conflicts'), '1', 'e a clínica A passa a mostrar 1 conflito aberto');
-- resolvido pela operação (função da 3.4): sai dos abertos e aparece em "todos"
select pg_temp.entrar('postgres');
select set_config('teste.k1', (select k.id::text from agenda.conflicts k where k.clinic_id = pg_temp.a()), true);
select pg_temp.como(2);
select is(public.agenda_conflict_resolve(pg_temp.id('k1'), 'descartado', 'tirado_da_lista') ->> 'status',
          'ok', 'a operação fecha o conflito (função da 3.4)');
select ok(not exists (select 1 from jsonb_array_elements(public.agenda_central_conflicts() -> 'conflicts') k where (k ->> 'clinic_id')::uuid = pg_temp.a()),
          'fechado: sai da lista dos abertos');
select is((select concat_ws('|', k ->> 'status', k ->> 'resolution_code', k ->> 'resolved_at' is not null)
           from jsonb_array_elements(public.agenda_central_conflicts(true) -> 'conflicts') k where (k ->> 'clinic_id')::uuid = pg_temp.a()),
          'descartado|tirado_da_lista|t', 'e aparece em "todos" (90 dias) com o código da resolução');

/* ===================== E. Auditoria ===================== */
select pg_temp.como(4);
select set_config('teste.au', public.agenda_central_audit()::text, true);
select is((select concat_ws('|', j ->> 'status', j ->> 'days', j ->> 'from') from (select current_setting('teste.au')::jsonb j) x),
          concat_ws('|', 'ok', '30', ((now() at time zone 'America/Sao_Paulo')::date - 29)::text), 'auditoria: padrão de 30 dias');
select is((select concat_ws('|', c ->> 'actor_kind', c ->> 'actor_role', c ->> 'actor', c ->> 'origin', c ->> 'object_type', c ->> 'clinic_id' is null)
           from jsonb_array_elements(current_setting('teste.au')::jsonb -> 'changes') c where c ->> 'action' = 'feriado.criar'),
          concat_ws('|', 'imed', 'imed_operacao', pg_temp.cod(2), 'central', 'holiday', 't'),
          'mudança: o feriado lançado pela operação (papel, origem e o código curto da conta)');
select is((select concat_ws('|', c ->> 'actor_kind', c ->> 'actor_role', c ->> 'actor', c ->> 'origin', c ->> 'clinic_name')
           from jsonb_array_elements(current_setting('teste.au')::jsonb -> 'changes') c
           where c ->> 'action' = 'conflito_descartado'),
          concat_ws('|', 'imed', 'imed_operacao', pg_temp.cod(2), 'central', 'Clínica da Central'),
          'mudança: o conflito fechado pela operação, com o nome da clínica');
select ok((select bool_and(not (c ?| array['old_value', 'new_value', 'actor_user', 'object_id']))
           from jsonb_array_elements(current_setting('teste.au')::jsonb -> 'changes') c),
          'mudanças: sem os valores antigos e novos, sem o id inteiro da conta e sem o id do objeto');
select is((select concat_ws('|', r ->> 'clinic_name', r ->> 'actor', r ->> 'actor_role', r ->> 'scope' is not null, r ->> 'reads', r ->> 'requests',
                            r ->> 'justification_code' is null, r ->> 'day')
           from jsonb_array_elements(current_setting('teste.au')::jsonb -> 'reads') r where r ->> 'fn' = 'agenda_view'),
          concat_ws('|', 'Clínica da Central', pg_temp.cod(7), 'reception', 't', '2', '0', 't', ((now() at time zone 'America/Sao_Paulo')::date)::text),
          'leituras: a grade lida 2 vezes pela recepção = uma linha somada, com o papel e o código da conta');
select ok((select bool_and(not (r ?| array['request_id', 'user_id'])) from jsonb_array_elements(current_setting('teste.au')::jsonb -> 'reads') r),
          'leituras: nunca qual agendamento nem o id inteiro da conta');
select ok((select (j #>> '{totals,changes}')::int >= 2 and (j #>> '{totals,reads}')::int >= 2 and (j #>> '{totals,readers}')::int >= 1
                  and (j #>> '{totals,imed_reads}')::int >= 0 and j -> 'object_types' ? 'holiday'
           from (select current_setting('teste.au')::jsonb j) x), 'auditoria: totais e a lista de objetos para o filtro');
-- leitura da equipe do IMED com justificativa ("quebra de vidro", 3.4/4.2): aparece somada, com o motivo
select pg_temp.como(2);
select is(public.agenda_request_detail(pg_temp.id('b1'), 'suporte_clinica') ->> 'status', 'ok', 'a operação abre o agendamento com justificativa (regra da 4.2)');
select pg_temp.como(4);
select is((select concat_ws('|', r ->> 'actor', r ->> 'actor_role', r ->> 'justification_code', r ->> 'reads', r ->> 'requests')
           from jsonb_array_elements(public.agenda_central_audit() -> 'reads') r where r ->> 'fn' = 'agenda_request_detail'),
          concat_ws('|', pg_temp.cod(2), 'imed', 'suporte_clinica', '1', '1'),
          'leitura da equipe do IMED: papel imed, o código do motivo e 1 agendamento (sem dizer qual)');
select ok((public.agenda_central_audit() #>> '{totals,imed_reads}')::int >= 1, 'e entra no total de leituras da equipe do IMED');
-- filtros
select is((select count(*)::int from jsonb_array_elements(public.agenda_central_audit(jsonb_build_object('clinic', pg_temp.b())) -> 'changes')), 0,
          'filtro por clínica: a clínica B não tem mudanças');
select ok((select count(*) > 0 and bool_and(c ->> 'clinic_id' = pg_temp.a()::text)
           from jsonb_array_elements(public.agenda_central_audit(jsonb_build_object('clinic', pg_temp.a())) -> 'changes') c),
          'filtro por clínica: só as mudanças da clínica A');
select ok((select count(*) > 0 and bool_and(c ->> 'object_type' = 'holiday')
           from jsonb_array_elements(public.agenda_central_audit('{"object_type": "holiday"}') -> 'changes') c), 'filtro por objeto');
select ok((select count(*) > 0 and bool_and(c ->> 'actor' = pg_temp.cod(2))
           from jsonb_array_elements(public.agenda_central_audit(jsonb_build_object('actor', pg_temp.cod(2))) -> 'changes') c)
          and (select count(*) > 0 and bool_and(r ->> 'actor' = pg_temp.cod(2))
               from jsonb_array_elements(public.agenda_central_audit(jsonb_build_object('actor', pg_temp.cod(2))) -> 'reads') r),
          'filtro por conta (código curto): vale para as mudanças e para as leituras');
select is((select string_agg(public.agenda_central_audit(f) ->> 'status', ',' order by n)
           from (values (1, '{"days": 0}'::jsonb), (2, '{"days": 366}'), (3, '{"days": "7"}'), (4, '{"clinic": "abc"}'),
                        (5, '{"object_type": "Holiday; drop"}'), (6, '{"actor": "ZZZZZZZZ"}'), (7, '{"qualquer": 1}'), (8, '[]')) t (n, f)),
          'invalid,invalid,invalid,invalid,invalid,invalid,invalid,invalid', 'filtros fora do formato: invalid');
select is(public.agenda_central_audit('{"days": 1}') ->> 'from', ((now() at time zone 'America/Sao_Paulo')::date)::text, 'filtro de 1 dia: só hoje');
-- nenhum dado de paciente em nenhuma resposta
select pg_temp.como(1);
select ok((select bool_and(j::text !~* '(Zuleica|Quaresma|98888-4411|988884411)' and j::text not like '%' || current_setting('teste.b1') || '%')
           from (values (public.agenda_central_version()), (public.agenda_central_overview()), (public.agenda_central_conflicts(true)),
                        (public.agenda_central_audit('{"days": 365}')), (public.agenda_central_settings()), (public.agenda_central_holidays()),
                        (public.agenda_central_holiday_preview(pg_temp.dia())), (public.agenda_central_staff())) t (j)),
          'nenhuma resposta da central traz nome, telefone ou o id do pedido do paciente');
select is(pg_temp.negadas(true), '', 'o administrador não recebe forbidden em nenhuma das leituras (as 3 que gravam vêm a seguir)');

/* ===================== F. Parâmetros globais ===================== */
select pg_temp.entrar('postgres');
select is((select string_agg(distinct m[1], ',' order by m[1])
           from pg_proc p, regexp_matches(p.prosrc, 'agenda_setting_int\(''([a-z0-9_.]+)''', 'g') m
           where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)),
          (select string_agg(x.key, ',' order by x.key) from private.agenda_central_params() x),
          'a lista da central tem exatamente os parâmetros que o código lê');
select is((select count(*)::int from private.agenda_central_params() x
           where not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
                             and p.prosrc like '%agenda_setting_int(''' || x.key || ''', ' || x.def || ')%')), 0,
          'e o padrão de cada um é o mesmo do código');
select pg_temp.como(3);
select is((select concat_ws('|', j ->> 'status', j ->> 'can_edit', jsonb_array_length(j -> 'params'), p ->> 'key', p ->> 'default', p ->> 'min',
                            p ->> 'max', p ->> 'value' is null, p ->> 'effective', p ->> 'updated_at' is null)
           from (select public.agenda_central_settings() j) x, jsonb_array_elements(j -> 'params') p),
          'ok|false|1|agenda.limite_futuros_por_telefone|3|1|20|t|3|t', 'parâmetros: nada gravado, vale o padrão (3); o suporte só lê');
select pg_temp.como(1);
select is((select string_agg(public.agenda_central_setting_set(k, v) ->> 'status', ',' order by n)
           from (values (1, 'agenda.limite_futuros_por_telefone', 0), (2, 'agenda.limite_futuros_por_telefone', 21),
                        (3, 'agenda.outro', 5), (4, null, 5)) t (n, k, v)),
          'invalid,invalid,not_found,not_found', 'parâmetro fora dos limites: invalid; chave desconhecida: not_found');
select is(public.agenda_central_setting_set('agenda.limite_futuros_por_telefone', null) ->> 'unchanged', 'true', 'voltar ao padrão sem nada gravado: nada muda');
select is((select concat_ws('|', j ->> 'status', j ->> 'effective') from (select public.agenda_central_setting_set('agenda.limite_futuros_por_telefone', 5) j) x),
          'ok|5', 'o administrador grava 5');
select is((select concat_ws('|', p ->> 'value', p ->> 'effective', p ->> 'updated_at' is not null, j ->> 'can_edit')
           from (select public.agenda_central_settings() j) x, jsonb_array_elements(j -> 'params') p), '5|5|t|true', 'a leitura mostra o valor gravado');
select is(public.agenda_central_setting_set('agenda.limite_futuros_por_telefone', 5) ->> 'unchanged', 'true', 'o mesmo valor de novo: nada muda');
select pg_temp.entrar('postgres');
select is(private.agenda_setting_int('agenda.limite_futuros_por_telefone', 3), 5, 'o motor passa a ler 5');
select is((select updated_by from agenda.settings_global where key = 'agenda.limite_futuros_por_telefone'), pg_temp.u(1), 'fica gravado quem mudou');
select pg_temp.como(1);
select is((select concat_ws('|', j ->> 'status', j ->> 'effective') from (select public.agenda_central_setting_set('agenda.limite_futuros_por_telefone', null) j) x),
          'ok|3', 'voltar ao padrão: a linha sai e vale 3 de novo');
select pg_temp.entrar('postgres');
select is((select count(*)::int from agenda.settings_global), 0, 'a tabela de parâmetros volta a ficar vazia');
select is((select string_agg(concat_ws(':', a.action, a.actor_kind, a.origin, a.actor_role, a.old_value ->> 'value', a.new_value ->> 'value', a.new_value ->> 'key'), ' ' order by a.id)
           from agenda.audit_log a where a.object_type = 'setting' and a.actor_user = pg_temp.u(1)),
          'parametro.definir:imed:central:imed_admin:5:agenda.limite_futuros_por_telefone parametro.padrao:imed:central:imed_admin:5:agenda.limite_futuros_por_telefone',
          'auditoria: as duas mudanças do parâmetro, com o valor antigo e o novo');

/* ===================== G. Papéis da equipe ===================== */
select pg_temp.como(1);
select is((select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'roles'),
                            (select string_agg(r ->> 'role', ',' order by r ->> 'role') from jsonb_array_elements(j -> 'roles') r),
                            (select r -> 'permissions' from jsonb_array_elements(j -> 'roles') r where r ->> 'role' = 'suporte'))
           from (select public.agenda_central_staff() j) x),
          'ok|4|auditoria,financeiro,operacao,suporte|["imed.agenda.monitor"]', 'papéis: os 4 da equipe e o que cada um pode (da matriz da 3.1)');
select is((select string_agg(concat_ws(':', s ->> 'email', s ->> 'role', s ->> 'active', s ->> 'code'), ' ' order by s ->> 'email')
           from jsonb_array_elements(public.agenda_central_staff() -> 'staff') s where s ->> 'email' like '%.central44@exemplo.test' and (s ->> 'active')::boolean),
          concat_ws(' ', 'auditoria.central44@exemplo.test:auditoria:true:' || pg_temp.cod(4), 'financeiro.central44@exemplo.test:financeiro:true:' || pg_temp.cod(5),
                    'operacao.central44@exemplo.test:operacao:true:' || pg_temp.cod(2), 'suporte.central44@exemplo.test:suporte:true:' || pg_temp.cod(3)),
          'equipe: e-mail, papel e o código curto de cada conta (o mesmo código da auditoria)');
select is((select string_agg(public.agenda_central_staff_grant(e, r) ->> 'status', ',' order by n)
           from (values (1, 'nova.central44@exemplo.test', 'dono'), (2, 'nova.central44@exemplo.test', null), (3, 'sem-arroba', 'suporte'),
                        (4, null, 'suporte'), (5, 'ninguem.central44@exemplo.test', 'suporte'), (6, 'semconfirmar.central44@exemplo.test', 'suporte'),
                        (7, 'admin.central44@exemplo.test', 'suporte')) t (n, e, r)),
          'invalid,invalid,invalid,invalid,user_not_found,user_not_found,already_admin',
          'dar papel: papel ou e-mail inválido, conta que não existe ou sem e-mail confirmado, e o próprio administrador');
select is((select concat_ws('|', j ->> 'status', j ->> 'unchanged', j ->> 'code') from (select public.agenda_central_staff_grant('  Nova.Central44@Exemplo.TEST ', 'auditoria') j) x),
          concat_ws('|', 'ok', 'false', pg_temp.cod(8)), 'dá "auditoria" à conta nova (e-mail com maiúsculas e espaços)');
select is(public.agenda_central_staff_grant('nova.central44@exemplo.test', 'auditoria') ->> 'unchanged', 'true', 'o mesmo papel de novo: nada muda');
select pg_temp.como(8);
select ok(public.imed_has('imed.auditoria.ver') and not public.imed_has('imed.pacientes.ver') and not public.is_imed_admin(),
          'a conta nova passa a ter imed.auditoria.ver (e só o que o papel dá; não vira administradora)');
select is(public.agenda_central_audit() ->> 'status', 'ok', 'e lê a auditoria da central');
select pg_temp.como(1);
select is(public.agenda_central_staff_revoke(pg_temp.u(8), 'auditoria') ->> 'status', 'ok', 'o administrador tira o papel');
select is((select string_agg(public.agenda_central_staff_revoke(u, r) ->> 'status', ',' order by n)
           from (values (1, pg_temp.u(8), 'auditoria'), (2, pg_temp.u(8), 'operacao'), (3, null::uuid, 'auditoria'), (4, pg_temp.u(8), null)) t (n, u, r)),
          'not_found,not_found,invalid,invalid', 'tirar de novo, papel que a conta não tem ou dado faltando');
select pg_temp.como(8);
select ok(not public.imed_has('imed.auditoria.ver'), 'sem o papel, a permissão acaba na chamada seguinte');
select is(public.agenda_central_audit() ->> 'status', 'forbidden', 'e a auditoria volta a recusar');
select pg_temp.como(1);
select is((select concat_ws('|', s ->> 'active', s ->> 'revoked_at' is not null)
           from jsonb_array_elements(public.agenda_central_staff() -> 'staff') s where s ->> 'email' = pg_temp.email(8) and s ->> 'role' = 'auditoria'),
          'false|t', 'a linha fica, marcada como retirada (nada se apaga)');
select is((select concat_ws('|', j ->> 'status', j ->> 'unchanged') from (select public.agenda_central_staff_grant('nova.central44@exemplo.test', 'auditoria') j) x),
          'ok|false', 'dar de novo o papel retirado: volta a valer');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', count(*), count(*) filter (where s.revoked_at is null), bool_and(s.granted_by = pg_temp.u(1)))
           from private.imed_staff s where s.user_id = pg_temp.u(8) and s.role = 'auditoria'), '1|1|t',
          'uma linha só por conta e papel, ativa, com quem deu');
select is((select string_agg(concat_ws(':', a.action, a.actor_kind, a.origin, (a.new_value ->> 'revoked_at') is null), ' ' order by a.id)
           from agenda.audit_log a where a.object_type = 'imed_staff' and a.object_id = pg_temp.u(8)::text and a.actor_user = pg_temp.u(1)
             and coalesce(a.new_value ->> 'role', '') = 'auditoria'),
          'imed_staff_insert:imed:central:t imed_staff_update:imed:central:f imed_staff_update:imed:central:t',
          'auditoria: dar, tirar e dar de novo, como feitos pela equipe do IMED (central)');
select is(coalesce(current_setting('imed.origin', true), ''), '', 'a marca de origem não vaza para o resto da transação');

/* ===================== Feriado: retirar ===================== */
select pg_temp.como(2);
select is(public.agenda_holiday_remove((current_setting('teste.fer')::jsonb ->> 'id')::uuid) ->> 'status', 'ok',
          'a operação retira o feriado lançado por engano (função da 3.2)');
select ok(not exists (select 1 from jsonb_array_elements(public.agenda_central_holidays() -> 'holidays') h where (h ->> 'day')::date = pg_temp.dia()),
          'e ele sai da lista da central');
select pg_temp.como(4);
select is((select string_agg(c ->> 'action', ',' order by c ->> 'action')
           from jsonb_array_elements(public.agenda_central_audit('{"object_type": "holiday"}') -> 'changes') c
           where c ->> 'actor' = pg_temp.cod(2)), 'feriado.criar,feriado.remover', 'lançar e retirar ficam na auditoria');

select * from finish();
rollback;
