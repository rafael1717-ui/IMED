-- Vários exames de uma vez (iMed Agenda, fase 5.2; arquitetura §6 e §13, teste 6 "Vários exames"): as opções de pacote
-- (agenda_package_options) e o contrato com a marcação (agenda_book, tudo ou nada) que o site do paciente usa.
--   - ocupação virtual: dois exames no MESMO aparelho não aparecem colados quando a higienização não cabe; com um
--     segundo aparelho, o 2º exame vai para ele (a prioridade da clínica, como na marcação); limite de chegadas por
--     hora (bloco alinhado) vale para os dois exames do mesmo paciente;
--   - intervalo mínimo da regra de par entre exames que não são vizinhos; regra de ordem; "não no mesmo dia" (resposta
--     vazia com same_day_blocked);
--   - TODA opção devolvida é aceita pela marcação (cada uma é marcada e desfeita);
--   - tudo ou nada com 4 exames; o pacote aparece inteiro em agenda_my_booking; depois de marcado, as opções mudam;
--   - limites da pergunta (2 a 4 procedimentos, sem repetir; p_limit de 1 a 20) e clínica sem a venda online.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(31);
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
  select pg_temp.entrar('authenticated', 'a4300000-0000-4000-8000-000000000001', 'dona.pacote@exemplo.test') $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c4300000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.hh(p timestamptz) returns text language sql stable as $$
  select to_char(p at time zone 'America/Sao_Paulo', 'HH24:MI') $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.recurso(p_nome text, p_tipo text, p_extra jsonb default '{}') returns void language sql as $$
  select set_config('teste.' || replace(lower(p_nome), '-', ''),
                    public.agenda_resource_save(pg_temp.c(), jsonb_build_object('kind', p_tipo, 'name', p_nome) || p_extra) ->> 'id', true) $$;
-- opção de requisito: tipo do recurso e os recursos, na ordem de prioridade
create function pg_temp.opc(p_tipo text, variadic p_recursos text[]) returns jsonb language sql stable as $$
  select jsonb_build_object('resource_kind', p_tipo, 'options',
           (select jsonb_agg(jsonb_build_object('resource_id', pg_temp.id(replace(lower(r), '-', '')), 'priority', n) order by n)
            from unnest(p_recursos) with ordinality x (r, n))) $$;
create function pg_temp.proc(p_chave text, p jsonb) returns void language sql as $$
  select set_config('teste.' || p_chave, public.agenda_procedure_save(pg_temp.c(), p) ->> 'id', true) $$;
create function pg_temp.opcoes(p_limite integer, variadic p text[]) returns jsonb language sql stable as $$
  select public.agenda_package_options(pg_temp.c(), array(select pg_temp.id(x) from unnest(p) x), pg_temp.dia(), p_limite) $$;
-- as opções em texto: "a 08:00 + b 08:40 (espera 10)"
create function pg_temp.resumo(p_resposta jsonb, p_chaves text[]) returns text[] language sql stable as $$
  select array(select (select string_agg((select k from unnest(p_chaves) k where pg_temp.id(k)::text = i.value ->> 'procedure_id')
                                          || ' ' || pg_temp.hh((i.value ->> 'starts_at')::timestamptz), ' + ' order by i.ordinality)
                       from jsonb_array_elements(o.value -> 'items') with ordinality i) || ' (espera ' || (o.value ->> 'wait_min') || ')'
               from jsonb_array_elements(p_resposta -> 'options') with ordinality o order by o.ordinality) $$;
create function pg_temp.paciente(p_n integer) returns jsonb language sql as $$
  select jsonb_build_object('name', 'Paciente do Pacote ' || p_n, 'phone', '1197' || lpad(p_n::text, 7, '0'), 'consent', true) $$;
create function pg_temp.itens(p_opcao jsonb) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('procedure_id', x.value ->> 'procedure_id', 'starts_at', x.value ->> 'starts_at') order by x.ordinality)
  from jsonb_array_elements(p_opcao -> 'items') with ordinality x $$;
-- A marcação aceita a opção? Marca de verdade (agenda_book) e desfaz em seguida (a exceção desfaz o bloco).
create function pg_temp.aceita(p_opcao jsonb, p_n integer) returns text language plpgsql as $$
declare v text;
begin
  begin
    v := public.agenda_book(pg_temp.c(), pg_temp.itens(p_opcao), pg_temp.paciente(p_n),
                            ('b4300000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid, 'codigo-secreto-do-teste-' || p_n) ->> 'status';
    raise exception using errcode = 'IMT99', message = coalesce(v, 'nulo');
  exception when sqlstate 'IMT99' then
    get stacked diagnostics v = message_text;
  end;
  return v;
end $$;
create function pg_temp.aceitas(p_resposta jsonb) returns text language sql as $$
  select coalesce(string_agg(pg_temp.aceita(o.value, 100 + o.ordinality::integer), ',' order by o.ordinality), 'nenhuma')
  from jsonb_array_elements(p_resposta -> 'options') with ordinality o $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a4300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'dona.pacote@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now());
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua do Pacote, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values ('c4300000-0000-4000-8000-000000000001'::uuid, 'Clínica do Pacote', 1),
             ('c4300000-0000-4000-8000-000000000002'::uuid, 'Clínica Sem Venda Online', 2)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  ('c4300000-0000-4000-8000-000000000001', 'a4300000-0000-4000-8000-000000000001', 'owner'),
  ('c4300000-0000-4000-8000-000000000002', 'a4300000-0000-4000-8000-000000000001', 'owner');
insert into agenda.holidays (scope, day, name, source)
values ('nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949')
on conflict do nothing;

select pg_temp.dona();
select public.agenda_unit_save(c, jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0))
from unnest(array['c4300000-0000-4000-8000-000000000001', 'c4300000-0000-4000-8000-000000000002']::uuid[]) c;
select pg_temp.recurso('USG-1', 'equipamento', '{"cleanup_min": 10}'), pg_temp.recurso('USG-2', 'equipamento'),
       pg_temp.recurso('RM-1', 'equipamento', '{"cleanup_min": 15}'), pg_temp.recurso('Chegadas', 'chegadas');
select pg_temp.proc('a', jsonb_build_object('exam_code', 'usg', 'name', 'Ultrassom do abdome', 'duration_min', 30, 'step_min', 10, 'price_cents', 15000,
         'requirements', jsonb_build_array(pg_temp.opc('equipamento', 'USG-1')))),
       pg_temp.proc('b', jsonb_build_object('exam_code', 'usg', 'name', 'Ultrassom da pelve', 'duration_min', 30, 'step_min', 10,
         'requirements', jsonb_build_array(pg_temp.opc('equipamento', 'USG-1')))),
       pg_temp.proc('c', jsonb_build_object('exam_code', 'rm', 'name', 'Ressonância', 'duration_min', 30, 'step_min', 15,
         'patient_prep_text', 'Retire objetos de metal.', 'requirements', jsonb_build_array(pg_temp.opc('equipamento', 'RM-1')))),
       pg_temp.proc('d', jsonb_build_object('exam_code', 'usg', 'name', 'Ultrassom da tireoide', 'duration_min', 20, 'step_min', 10,
         'requirements', jsonb_build_array(pg_temp.opc('equipamento', 'USG-1', 'USG-2')))),
       pg_temp.proc('e', jsonb_build_object('exam_code', 'lab', 'name', 'Coleta de sangue', 'duration_min', 10, 'step_min', 10, 'fasting_hours', 8,
         'requirements', jsonb_build_array(pg_temp.opc('chegadas', 'Chegadas') || '{"align_min": 60}'))),
       pg_temp.proc('f', jsonb_build_object('exam_code', 'lab', 'name', 'Coleta de urina', 'duration_min', 10, 'step_min', 10,
         'requirements', jsonb_build_array(pg_temp.opc('chegadas', 'Chegadas') || '{"align_min": 60}')));
select public.agenda_rules_set(pg_temp.c(), null,
         jsonb_build_array(jsonb_build_object('weekday', extract(dow from pg_temp.dia())::integer, 'start', '08:00', 'end', '12:00')));
-- venda online ligada (nenhuma função liga: só a marca de emergência, registrada)
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_pacote', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now()
where id = 'c4300000-0000-4000-8000-000000000001';
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
select pg_temp.entrar('anon');
select is((select count(*)::integer from (values ('a'), ('b'), ('c'), ('d'), ('e'), ('f')) x (k) where pg_temp.id(x.k) is not null), 6,
          'seis procedimentos cadastrados e à venda');

/* ===================== Ocupação virtual: o mesmo aparelho, com higienização ===================== */
select is(pg_temp.resumo(pg_temp.opcoes(3, 'a', 'b'), array['a', 'b']),
          array['a 08:00 + b 08:40 (espera 10)', 'b 08:00 + a 08:40 (espera 10)', 'a 08:10 + b 08:50 (espera 10)'],
          'dois ultrassons no mesmo aparelho: o 2º só depois da higienização do 1º (10 min), nunca colado');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.opcoes(20, 'a', 'b') -> 'options') o
                      where (o.value -> 'items' -> 1 ->> 'starts_at')::timestamptz
                            < (o.value -> 'items' -> 0 ->> 'ends_at')::timestamptz + interval '10 minutes'),
          'nenhuma das 20 opções traz os dois colados');
select is(pg_temp.aceitas(pg_temp.opcoes(5, 'a', 'b')), 'ok,ok,ok,ok,ok', 'a marcação aceita cada uma das 5 opções (marcadas e desfeitas)');
select is(public.agenda_book(pg_temp.c(), jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id('a'), 'starts_at', pg_temp.t('08:00')),
                                                             jsonb_build_object('procedure_id', pg_temp.id('b'), 'starts_at', pg_temp.t('08:30'))),
                             pg_temp.paciente(1), 'b4300000-0000-4000-8000-000000000001', 'codigo-secreto-do-teste-1') - 'alternatives',
          jsonb_build_object('status', 'slot_taken', 'seq', 2),
          'a prova do furo antigo: colados (08:00 e 08:30) a marcação recusa o 2º, e as opções não oferecem mais isso');
select pg_temp.entrar('postgres');
select is((select count(*)::integer from public.appointment_requests where id = 'b4300000-0000-4000-8000-000000000001')
          + (select count(*)::integer from agenda.occupancy o where o.clinic_id = pg_temp.c() and o.active), 0,
          'tudo ou nada: o 1º exame da tentativa recusada não ficou gravado');
select pg_temp.entrar('anon');

/* ===================== Outro aparelho na vez: a prioridade da clínica, como na marcação ===================== */
select is((pg_temp.resumo(pg_temp.opcoes(1, 'a', 'd'), array['a', 'd']))[1], 'a 08:00 + d 08:30 (espera 0)',
          'abdome (só USG-1) e tireoide (USG-1 ou USG-2): sem espera, porque a tireoide vai para o USG-2');
select is(pg_temp.aceitas(pg_temp.opcoes(5, 'a', 'd')), 'ok,ok,ok,ok,ok', 'a marcação aceita as 5 (põe a tireoide no USG-2)');

/* ===================== Limite de chegadas por hora (bloco alinhado), 1 vaga ===================== */
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.opcoes(20, 'e', 'f') -> 'options') o
                      where date_trunc('hour', (o.value -> 'items' -> 0 ->> 'starts_at')::timestamptz)
                            = date_trunc('hour', (o.value -> 'items' -> 1 ->> 'starts_at')::timestamptz)),
          'duas coletas com 1 chegada por hora: nunca as duas na mesma hora');
select is((pg_temp.resumo(pg_temp.opcoes(1, 'e', 'f'), array['e', 'f']))[1], 'e 08:50 + f 09:00 (espera 0)',
          'a melhor opção encosta as duas na virada da hora');
select is(pg_temp.aceitas(pg_temp.opcoes(5, 'e', 'f')), 'ok,ok,ok,ok,ok', 'a marcação aceita as 5');

/* ===================== Quatro exames ===================== */
select is(jsonb_array_length(pg_temp.opcoes(5, 'a', 'b', 'c', 'd') -> 'options'), 5, 'quatro exames: 5 opções');
select ok((select bool_and(jsonb_array_length(o.value -> 'items') = 4
                           and (select count(distinct i.value ->> 'procedure_id') from jsonb_array_elements(o.value -> 'items') i) = 4
                           and (o.value ->> 'starts_at') = (o.value -> 'items' -> 0 ->> 'starts_at')
                           and (o.value ->> 'ends_at') = (o.value -> 'items' -> 3 ->> 'ends_at')
                           and (o.value ->> 'wait_min')::integer
                               = (extract(epoch from (o.value ->> 'ends_at')::timestamptz - (o.value ->> 'starts_at')::timestamptz) / 60)::integer - 110)
           from jsonb_array_elements(pg_temp.opcoes(5, 'a', 'b', 'c', 'd') -> 'options') o),
          'cada opção tem os 4 exames, uma vez cada, em ordem de horário; a espera é o total menos os 110 min de exame');
select ok((select bool_and((a.value ->> 'wait_min')::integer <= (b.value ->> 'wait_min')::integer)
           from jsonb_array_elements(pg_temp.opcoes(20, 'a', 'b', 'c', 'd') -> 'options') with ordinality a
           join jsonb_array_elements(pg_temp.opcoes(20, 'a', 'b', 'c', 'd') -> 'options') with ordinality b on b.ordinality = a.ordinality + 1),
          'em ordem de menor espera');
select is(pg_temp.aceitas(pg_temp.opcoes(5, 'a', 'b', 'c', 'd')), 'ok,ok,ok,ok,ok', 'a marcação aceita cada uma das 5 opções de 4 exames');

/* ===================== Regras de par ===================== */
select pg_temp.dona();
select is(public.agenda_pair_rules_set(pg_temp.c(), jsonb_build_array(
            jsonb_build_object('first_procedure', pg_temp.id('a'), 'second_procedure', pg_temp.id('c'), 'rule', 'intervalo_min', 'min_gap_min', 60),
            jsonb_build_object('first_procedure', pg_temp.id('c'), 'second_procedure', pg_temp.id('d'), 'rule', 'ordem'))) ->> 'status', 'ok',
          'regras da clínica: 60 min entre o abdome e a ressonância (nessa ordem) e a ressonância antes da tireoide');
select pg_temp.entrar('anon');
select ok((select count(*) > 0 and bool_and(
             (select (i.value ->> 'starts_at')::timestamptz from jsonb_array_elements(o.value -> 'items') i where i.value ->> 'procedure_id' = pg_temp.id('c')::text)
               < (select (i.value ->> 'starts_at')::timestamptz from jsonb_array_elements(o.value -> 'items') i where i.value ->> 'procedure_id' = pg_temp.id('d')::text))
           from jsonb_array_elements(pg_temp.opcoes(20, 'c', 'd') -> 'options') o),
          'regra de ordem: a ressonância sempre antes da tireoide');
select ok((select count(*) > 0 and bool_and(
             (select (i.value ->> 'starts_at')::timestamptz from jsonb_array_elements(o.value -> 'items') i where i.value ->> 'procedure_id' = pg_temp.id('c')::text)
               not between (select (i.value ->> 'starts_at')::timestamptz from jsonb_array_elements(o.value -> 'items') i where i.value ->> 'procedure_id' = pg_temp.id('a')::text)
                       and (select (i.value ->> 'ends_at')::timestamptz + interval '59 minutes' from jsonb_array_elements(o.value -> 'items') i where i.value ->> 'procedure_id' = pg_temp.id('a')::text))
           from jsonb_array_elements(pg_temp.opcoes(20, 'a', 'b', 'c') -> 'options') o),
          'intervalo mínimo entre exames que NÃO são vizinhos (abdome, pelve no meio, ressonância): 60 min respeitados em todas');
select is(pg_temp.aceitas(pg_temp.opcoes(5, 'a', 'b', 'c')), 'ok,ok,ok,ok,ok', 'a marcação aceita as 5 (ela confere o intervalo de todos os pares)');
select is(pg_temp.opcoes(5, 'a', 'c') ->> 'same_day_blocked', 'false', 'sem regra "não no mesmo dia": same_day_blocked falso');
select pg_temp.dona();
select is(public.agenda_pair_rules_set(pg_temp.c(), jsonb_build_array(
            jsonb_build_object('first_procedure', pg_temp.id('a'), 'second_procedure', pg_temp.id('c'), 'rule', 'intervalo_min', 'min_gap_min', 60),
            jsonb_build_object('first_procedure', pg_temp.id('c'), 'second_procedure', pg_temp.id('d'), 'rule', 'ordem'),
            jsonb_build_object('first_procedure', pg_temp.id('b'), 'second_procedure', pg_temp.id('c'), 'rule', 'nao_mesmo_dia'))) ->> 'status', 'ok',
          'mais uma regra da clínica: pelve e ressonância não no mesmo dia');
select pg_temp.entrar('anon');
select is(pg_temp.opcoes(5, 'c', 'b', 'd'), jsonb_build_object('status', 'ok', 'options', '[]'::jsonb, 'same_day_blocked', true),
          '"não no mesmo dia" (em qualquer ordem do pedido): nenhuma opção e o aviso same_day_blocked');
select is(public.agenda_book(pg_temp.c(), jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id('b'), 'starts_at', pg_temp.t('08:00')),
                                                             jsonb_build_object('procedure_id', pg_temp.id('c'), 'starts_at', pg_temp.t('09:00'))),
                             pg_temp.paciente(2), 'b4300000-0000-4000-8000-000000000002', 'codigo-secreto-do-teste-2') ->> 'status',
          'invalid_package', 'e a marcação recusa os dois no mesmo dia (invalid_package)');

/* ===================== Tudo ou nada com 4 exames; o pacote inteiro em agenda_my_booking ===================== */
select set_config('teste.op4', (pg_temp.opcoes(1, 'a', 'c', 'd', 'e') -> 'options' -> 0)::text, true);
select is(pg_temp.resumo(jsonb_build_object('options', jsonb_build_array(current_setting('teste.op4')::jsonb)), array['a', 'c', 'd', 'e']),
          array['c 08:00 + a 08:30 + d 09:00 + e 09:20 (espera 0)'],
          'pacote de 4 exames: a melhor opção, sem espera (a tireoide vai para o USG-2 enquanto o USG-1 é higienizado)');
select is((select concat_ws('|', j ->> 'status', j ->> 'request_status', jsonb_array_length(j -> 'items'),
                            (j ->> 'slot_start')::timestamptz = pg_temp.t('08:00'), (j ->> 'slot_end')::timestamptz = pg_temp.t('09:30'))
           from (select public.agenda_book(pg_temp.c(), pg_temp.itens(current_setting('teste.op4')::jsonb), pg_temp.paciente(3),
                                           'b4300000-0000-4000-8000-000000000003', 'codigo-secreto-do-teste-3') j) x),
          'ok|confirmed|4|t|t', 'confirmar o pacote: os 4 exames de uma vez, do começo do 1º ao fim do último');
select is((select string_agg(concat_ws(' ', i.value ->> 'seq', i.value ->> 'procedure', pg_temp.hh((i.value ->> 'starts_at')::timestamptz),
                                       pg_temp.hh((i.value ->> 'ends_at')::timestamptz), i.value ->> 'status',
                                       coalesce(i.value ->> 'prep_text', '-'), coalesce(i.value ->> 'fasting_hours', '-')), '; ' order by (i.value ->> 'seq')::integer)
           from jsonb_array_elements(public.agenda_my_booking('b4300000-0000-4000-8000-000000000003', 'codigo-secreto-do-teste-3') -> 'items') i),
          '1 Ressonância 08:00 08:30 confirmed Retire objetos de metal. -; 2 Ultrassom do abdome 08:30 09:00 confirmed - -; '
          || '3 Ultrassom da tireoide 09:00 09:20 confirmed - -; 4 Coleta de sangue 09:20 09:30 confirmed - 8',
          'agenda_my_booking (com o código do aparelho) traz o pacote inteiro: exame, início, fim, situação, preparo e jejum de cada um');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', a.status, a.uses_resources, a.total_cents is null,
                            (select count(*) from agenda.appointment_items i where i.request_id = a.id),
                            (select count(*) from agenda.occupancy o join agenda.appointment_items i on i.id = o.item_id where i.request_id = a.id and o.active))
           from public.appointment_requests a where a.id = 'b4300000-0000-4000-8000-000000000003'),
          'confirmed|t|t|4|4',
          'um agendamento, 4 itens e 4 ocupações; sem total em dinheiro (só o abdome tem preço informado: nada de soma parcial)');
select pg_temp.entrar('anon');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.opcoes(20, 'a', 'd') -> 'options') o
                      cross join jsonb_array_elements(o.value -> 'items') i
                      where i.value ->> 'procedure_id' = pg_temp.id('a')::text
                        and tstzrange((i.value ->> 'starts_at')::timestamptz, (i.value ->> 'ends_at')::timestamptz + interval '10 minutes')
                            && tstzrange(pg_temp.t('08:30'), pg_temp.t('09:10'))),
          'depois de marcado, as opções não oferecem o abdome em cima do que foi ocupado (com a higienização)');
select is(public.cancel_request('b4300000-0000-4000-8000-000000000003', 'codigo-secreto-do-teste-3'), 'ok',
          'cancelar pelo código cancela o pacote inteiro (a regra que o banco já tinha)');
select pg_temp.entrar('postgres');
select is((select count(*)::integer from agenda.occupancy o where o.clinic_id = pg_temp.c() and o.active), 0, 'e os 4 horários voltam a ficar livres');
select pg_temp.entrar('anon');

/* ===================== Limites da pergunta ===================== */
select is(array[public.agenda_package_options(pg_temp.c(), array[pg_temp.id('a')], pg_temp.dia()) ->> 'status',
                public.agenda_package_options(pg_temp.c(), array[pg_temp.id('a'), pg_temp.id('a')], pg_temp.dia()) ->> 'status',
                public.agenda_package_options(pg_temp.c(), array[pg_temp.id('a'), pg_temp.id('b'), pg_temp.id('c'), pg_temp.id('d'), pg_temp.id('e')], pg_temp.dia()) ->> 'status',
                public.agenda_package_options(pg_temp.c(), array[pg_temp.id('a'), pg_temp.id('d')], null) ->> 'status',
                public.agenda_package_options('c4300000-0000-4000-8000-000000000002', array[pg_temp.id('a'), pg_temp.id('d')], pg_temp.dia()) ->> 'status',
                jsonb_array_length(pg_temp.opcoes(1, 'a', 'd') -> 'options')::text, jsonb_array_length(pg_temp.opcoes(99, 'a', 'd') -> 'options')::text,
                jsonb_array_length(public.agenda_package_options(pg_temp.c(), array[pg_temp.id('a'), pg_temp.id('d')], pg_temp.dia() + 1) -> 'options')::text],
          array['invalid', 'invalid', 'invalid', 'invalid', 'not_found', '1', '20', '0'],
          '1 exame, exame repetido, 5 exames e sem dia: invalid; clínica sem a venda online: not_found; p_limit de 1 a 20; dia sem atendimento: nenhuma opção');

select * from finish();
rollback;
