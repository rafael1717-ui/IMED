-- Feriados nacionais de 15/11/2026 a 25/12/2027 (migração <versão>_feriados_nacionais; arquitetura §4 e decisão 14;
-- fontes e decisões em memory/context/feriados-nacionais.md):
--   A. o que a migração deixou no banco: os 13 dias com o nome do calendário federal e a fonte certa de cada um (a lei,
--      com o endereço no Planalto; nos de 2026, também a portaria federal); escopo nacional, sem UF, cidade nem usuário;
--      a Sexta-feira da Paixão pela Páscoa de 2027 calculada aqui; Carnaval, Cinzas e Corpus Christi fora; uma auditoria
--      "feriado.criar" por feriado, com origem sql, o motivo da migração e as mesmas chaves da central (enquanto ela for
--      provisória, o CI a aplica DUAS vezes antes dos testes, no passo "aplicar de novo por cima dela mesma" do
--      banco.yml: uma linha só por feriado prova que reaplicar o arquivo não duplica); as 3 funções fora da API;
--      national_until = 31/12/2027 (o motor oferece horário até o fim de 2027), também na central (que lista os
--      feriados do ano passado em diante: a conta acompanha a data de hoje);
--   B. idempotência: lançar de novo não muda nada (feriados, auditoria, versões) e devolve a marca de quem chamou;
--   C. a volta (a mesma função que supabase/volta/<versão>_feriados_nacionais.sql chama): tira os 13, cada um com
--      "feriado.remover" na auditoria; national_until fica vazio; retirar de novo não faz nada; lançar de novo pula o
--      dia que a central já lançou; a trava: com um feriado nacional da central que segura o motor aberto (01/01/2028, ou
--      só o 25/12/2027 relançado pela central), retirar recusa (IMF01, com os dias que abririam) e nada muda (isso também
--      prova que o feriado do mesmo dia lançado pela central, com usuário, não é tirado); feriado nacional de um ano que
--      já passou não segura nada: a volta passa e não toca nele;
--   D. os mesmos efeitos de lançar pela central numa clínica com a agenda nova: o agendamento que cai no feriado vira
--      conflito "grade_mudou", a auditoria de cada dia conta 1 clínica e o conflito daquele dia (sem somar os de outro
--      feriado), o total devolvido conta os conflitos abertos de verdade (2 agendamentos em 2 feriados = 2), a versão
--      da agenda sobe uma vez, o motor não oferece horário no feriado (e oferece na véspera); lançar de novo não mexe
--      em nada. Os dias são os 2 primeiros da lista daqui a 2 dias ou mais (X e Y; depois de 20/11/2027 só há X, e
--      depois de 23/12/2027 nenhum: o que falta é pulado).
-- Uma função que grava (lançar, retirar) roda sozinha no comando: o que ela gravou só aparece no comando seguinte.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test; nomes fictícios.
begin;
select plan(39);

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
  select ('a4200000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['admin', 'dona'])[p_n] || '.feriados@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c4200000-0000-4000-8000-000000000001'::uuid $$;
-- (sem a configuração, nulo: o planejador pode calcular a função até no ramo de um "case" que não roda)
create function pg_temp.id(p text) returns uuid language sql stable as $$ select nullif(current_setting('teste.' || p, true), '')::uuid $$;
create function pg_temp.j(p text) returns jsonb language sql stable as $$ select nullif(current_setting('teste.' || p, true), '')::jsonb $$;
-- O que a migração tem de lançar (escrito aqui, sem ler a lista da migração): dia, nome, a lei com que a fonte começa e
-- o endereço dela no Planalto.
create function pg_temp.esperado() returns table (day date, name text, lei text, link text) language sql immutable as $$
  select x.day, x.name, l.lei, l.link
  from (values (date '2026-11-15', 'Proclamação da República', 662), (date '2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 14759),
               (date '2026-12-25', 'Natal', 662), (date '2027-01-01', 'Confraternização Universal', 662),
               (date '2027-03-26', 'Sexta-feira da Paixão', 9093), (date '2027-04-21', 'Tiradentes', 662),
               (date '2027-05-01', 'Dia Mundial do Trabalho', 662), (date '2027-09-07', 'Independência do Brasil', 662),
               (date '2027-10-12', 'Nossa Senhora Aparecida', 6802), (date '2027-11-02', 'Finados', 662),
               (date '2027-11-15', 'Proclamação da República', 662), (date '2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 14759),
               (date '2027-12-25', 'Natal', 662)) x (day, name, n)
  join (values (662, 'Lei 662/1949, art. 1º, com a redação da Lei 10.607/2002', 'planalto.gov.br/ccivil_03/leis/l0662.htm'),
               (6802, 'Lei 6.802/1980, art. 1º', 'planalto.gov.br/ccivil_03/leis/l6802.htm'),
               (9093, 'Lei 9.093/1995, art. 2º', 'planalto.gov.br/ccivil_03/leis/l9093.htm'),
               (14759, 'Lei 14.759/2023, art. 1º', 'planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm')) l (n, lei, link)
    on l.n = x.n $$;
-- Domingo de Páscoa (calendário gregoriano; algoritmo anônimo de Meeus/Jones/Butcher).
create function pg_temp.pascoa(p_ano integer) returns date language plpgsql immutable as $$
declare
  a integer := p_ano % 19; b integer := p_ano / 100; c integer := p_ano % 100; d integer := b / 4; e integer := b % 4;
  f integer := (b + 8) / 25; g integer := (b - f + 1) / 3; h integer := (19 * a + b - d - g + 15) % 30;
  i integer := c / 4; k integer := c % 4; l integer := (32 + 2 * e + 2 * i - h - k) % 7; m integer := (a + 11 * h + 22 * l) / 451;
begin
  return make_date(p_ano, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end $$;
-- o dia da parte D: o primeiro da lista daqui a 2 dias ou mais (São Paulo); nulo depois de 23/12/2027
create function pg_temp.x() returns date language sql stable as $$
  select min(e.day) from pg_temp.esperado() e where e.day >= (now() at time zone 'America/Sao_Paulo')::date + 2 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.x() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
-- o segundo dia da parte D (o feriado seguinte a X; nulo depois de 20/11/2027) e quantos dias a parte D usa
create function pg_temp.y() returns date language sql stable as $$
  select min(e.day) from pg_temp.esperado() e where e.day > pg_temp.x() $$;
create function pg_temp.n_d() returns integer language sql stable as $$
  select (pg_temp.x() is not null)::integer + (pg_temp.y() is not null)::integer $$;
-- os dias da lista que a trava da volta protege (de ontem em diante, hora de São Paulo), menos o 25/12/2027, que a parte
-- C deixa lançado pela central
create function pg_temp.futuros() returns text language sql stable as $$
  select string_agg(to_char(e.day, 'DD/MM/YYYY'), ', ' order by e.day) from pg_temp.esperado() e
  where e.day >= (now() at time zone 'America/Sao_Paulo')::date - 1 and e.day <> date '2027-12-25' $$;
-- roda um comando e devolve "código: mensagem" do erro (ou "sem erro"); o que ele gravou é desfeito
create function pg_temp.erro(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'sem erro';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
create function pg_temp.versao() returns bigint language sql stable as $$
  select coalesce((select v.version from agenda.clinic_versions v where v.clinic_id = pg_temp.c()), 0) $$;
create function pg_temp.nacionais() returns text language sql stable as $$
  select coalesce(string_agg(h.day::text, ',' order by h.day), '-') from agenda.holidays h where h.scope = 'nacional' $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated', pg_temp.email(n), now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from generate_series(1, 2) n;
insert into public.admin_emails (email) values (pg_temp.email(1));

/* ===================== A. O que a migração lançou ===================== */
select is(array(select h.day || ' ' || h.name from agenda.holidays h where h.scope = 'nacional' and h.day between date '2026-01-01' and date '2027-12-31'
                order by h.day),
          array(select e.day || ' ' || e.name from pg_temp.esperado() e order by e.day),
          'os 13 feriados nacionais de 15/11/2026 a 25/12/2027, com o nome do calendário federal (e nenhum outro em 2026 e 2027)');
select is(array(select e.day::text from pg_temp.esperado() e left join agenda.holidays h on h.scope = 'nacional' and h.day = e.day
                where h.id is null or h.source not like e.lei || ' (' || e.link || ')%' order by 1),
          '{}'::text[], 'a fonte de cada um: a lei certa do dia, com o endereço dela no Planalto');
select is(array(select h.day::text from agenda.holidays h where h.scope = 'nacional' and h.day between date '2026-11-15' and date '2026-12-31'
                  and h.source not like '%Portaria MGI 11.460/2025%' order by 1),
          '{}'::text[], 'os 3 de 2026 também com a portaria do calendário federal de 2026 (Portaria MGI 11.460/2025)');
select is(array(select split_part(h.source, ',', 1) || ' ' || to_char(h.day, 'DD/MM') from agenda.holidays h
                where h.scope = 'nacional' and extract(year from h.day) = 2027 and h.source !~ '^Lei 9\.093'
                order by split_part(h.source, ',', 1) collate "C", h.day),
          array['Lei 14.759/2023 20/11', 'Lei 6.802/1980 12/10', 'Lei 662/1949 01/01', 'Lei 662/1949 21/04', 'Lei 662/1949 01/05',
                'Lei 662/1949 07/09', 'Lei 662/1949 02/11', 'Lei 662/1949 15/11', 'Lei 662/1949 25/12'],
          '2027, dias fixos: os 7 da Lei 662/1949 (1º/1, 21/4, 1º/5, 7/9, 2/11, 15/11 e 25/12), 12/10 da Lei 6.802/1980 e 20/11 da Lei 14.759/2023');
select is(array[pg_temp.pascoa(2025), pg_temp.pascoa(2026), pg_temp.pascoa(2027)], array[date '2025-04-20', date '2026-04-05', date '2027-03-28'],
          'Páscoa calculada aqui: 20/04/2025 e 05/04/2026 (as Sextas-feiras da Paixão de 18/04/2025 e 03/04/2026 dos calendários federais) e 28/03/2027');
select is((select h.day || ' ' || split_part(h.source, ',', 1) from agenda.holidays h where h.scope = 'nacional' and h.name = 'Sexta-feira da Paixão'),
          (pg_temp.pascoa(2027) - 2) || ' Lei 9.093/1995',
          'Sexta-feira da Paixão: 2 dias antes da Páscoa (26/03/2027), pela Lei 9.093/1995');
select is((select count(*)::int from agenda.holidays h
           where h.scope = 'nacional' and h.day in (pg_temp.pascoa(2027) - 48, pg_temp.pascoa(2027) - 47, pg_temp.pascoa(2027) - 46, pg_temp.pascoa(2027) + 60)),
          0, 'Carnaval (08 e 09/02/2027), Quarta-feira de Cinzas (10/02) e Corpus Christi (27/05) não são feriado nacional: não entram');
select is((select count(*)::int from pg_temp.esperado() e join agenda.holidays h on h.day = e.day
           where h.scope = 'nacional' and h.uf is null and h.city_ibge is null and h.created_by is null),
          13, 'os 13 com escopo nacional, sem UF, sem cidade e sem usuário (lançados por migração)');
select is((select count(*)::int from agenda.audit_log a join agenda.holidays h on a.object_id = h.id::text
           where a.action = 'feriado.criar' and a.object_type = 'holiday' and a.reason_code = 'migracao_feriados_nacionais'
             and a.origin = 'sql' and a.actor_kind = 'sql' and a.actor_user is null and a.actor_role is null and a.clinic_id is null
             and a.old_value is null and (a.new_value ->> 'day')::date = h.day and a.new_value ->> 'scope' = 'nacional'
             and h.day in (select e.day from pg_temp.esperado() e)),
          13, 'auditoria de cada um: "feriado.criar", origem sql, sem usuário, com o motivo migracao_feriados_nacionais');
select is((select count(*)::int from agenda.audit_log a where a.action = 'feriado.criar' and a.reason_code = 'migracao_feriados_nacionais'),
          13, 'uma auditoria só por feriado (enquanto ela for provisória, o CI a aplica duas vezes: a segunda não lança nada)');
select is((select string_agg(distinct k, ',' order by k) from agenda.audit_log a, jsonb_object_keys(a.new_value) k
           where a.action = 'feriado.criar' and a.reason_code = 'migracao_feriados_nacionais'),
          'city_ibge,clinicas,conflitos,day,scope,uf', 'auditoria com as mesmas chaves da central (agenda_holiday_save)');
select is(array(select p.proname || ' por ' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
                from pg_proc p cross join aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.pronamespace = 'private'::regnamespace and p.proname like 'agenda\_feriados\_ate\_2027%'
                  and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
                order by 1),
          '{}'::text[], 'as 3 funções da migração: só o dono do banco executa (nenhum papel da API, nem PUBLIC)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'agenda\_feriados\_ate\_2027%'
             and not p.prosecdef and p.proconfig = array['search_path=""']),
          3, 'e as 3 sem SECURITY DEFINER e com search_path vazio');
select is(private.agenda_national_until(), date '2027-12-31', 'national_until = 31/12/2027: o motor oferece horário até o fim de 2027');
select pg_temp.como(1);
select is((select concat_ws('|', j ->> 'status', j ->> 'national_until',
                            (select count(*) from jsonb_array_elements(j -> 'holidays') h
                             where h ->> 'scope' = 'nacional' and (h ->> 'day')::date in (select e.day from pg_temp.esperado() e)))
           from (select public.agenda_central_holidays() j) x),
          'ok|2027-12-31|' || (select count(*) from pg_temp.esperado() e   -- a central lista do 1º de janeiro do ano passado em diante
                               where e.day >= (date_trunc('year', now() at time zone 'America/Sao_Paulo') - interval '1 year')::date),
          'na central (gestao.html, aba Feriados): os da lista na janela dela (os 13 até o fim de 2027) e "até 31/12/2027"');
select pg_temp.entrar('postgres');

/* ===================== B. Lançar de novo ===================== */
select set_config('teste.n_aud', (select count(*) from agenda.audit_log)::text, true);
select set_config('teste.n_ver', (select coalesce(sum(v.version), 0) from agenda.clinic_versions v)::text, true);
select set_config('teste.n_fer', pg_temp.nacionais(), true);
select set_config('imed.reason', 'motivo_de_fora', true);
select set_config('teste.l1', private.agenda_feriados_ate_2027_lancar()::text, true);
select is(concat_ws('|', pg_temp.j('l1') ->> 'status', pg_temp.j('l1') ->> 'launched', pg_temp.j('l1') ->> 'skipped'), 'ok|0|13',
          'lançar de novo: os 13 já estão lá, nada é lançado');
select is(concat_ws('|', pg_temp.nacionais() = current_setting('teste.n_fer'),
                    (select count(*) from agenda.audit_log)::text = current_setting('teste.n_aud'),
                    (select coalesce(sum(v.version), 0) from agenda.clinic_versions v)::text = current_setting('teste.n_ver')),
          't|t|t', 'e nada muda: os mesmos feriados, nenhuma linha de auditoria nova, nenhuma versão de clínica');
select is(concat_ws('|', coalesce(current_setting('imed.origin', true), ''), current_setting('imed.reason', true)), '|motivo_de_fora',
          'a marca de origem e o motivo de quem chamou voltam ao que eram');
select set_config('imed.reason', '', true);

/* ===================== C. A volta ===================== */
select set_config('teste.r1', private.agenda_feriados_ate_2027_retirar()::text, true);
select is(concat_ws('|', pg_temp.j('r1') ->> 'status', pg_temp.j('r1') ->> 'removed'), 'ok|13', 'retirar (a volta): os 13 saem');
select is(pg_temp.nacionais(), '-', 'nenhum feriado nacional fica');
select is(private.agenda_national_until(), null::date, 'sem feriado nacional lançado: national_until vazio (o motor volta a não oferecer horário)');
select is((select count(*)::int from agenda.audit_log a
           where a.action = 'feriado.remover' and a.object_type = 'holiday' and a.origin = 'sql' and a.actor_kind = 'sql' and a.actor_user is null
             and a.reason_code = 'volta_feriados_nacionais' and a.new_value is null and a.old_value ->> 'scope' = 'nacional'
             and (a.old_value ->> 'day')::date in (select e.day from pg_temp.esperado() e)),
          13, 'cada retirada na auditoria ("feriado.remover", origem sql, motivo volta_feriados_nacionais), como a retirada pela central');
select set_config('teste.r2', private.agenda_feriados_ate_2027_retirar()::text, true);
select is(pg_temp.j('r2') ->> 'removed', '0', 'retirar de novo: nada a retirar');
-- a central lança o 25/12/2027 com o MESMO nome e a MESMA fonte da lista, e um dia fora da lista
select set_config('teste.natal', (select to_jsonb(f) from private.agenda_feriados_ate_2027() f where f.day = date '2027-12-25')::text, true);
select pg_temp.como(1);
select is(concat_ws(',',
            public.agenda_holiday_save(jsonb_build_object('scope', 'nacional', 'day', pg_temp.j('natal') ->> 'day',
                                                          'name', pg_temp.j('natal') ->> 'name', 'source', pg_temp.j('natal') ->> 'source')) ->> 'status',
            public.agenda_holiday_save('{"scope": "nacional", "day": "2028-01-01", "name": "Confraternização Universal",
                                         "source": "Lei 662/1949, art. 1º (teste: lançado pela central)"}') ->> 'status'),
          'ok,ok', 'preparo: a central lança 25/12/2027 (mesmo nome e fonte da lista) e 01/01/2028');
select pg_temp.entrar('postgres');
select set_config('teste.l2', private.agenda_feriados_ate_2027_lancar()::text, true);
select is(concat_ws('|', pg_temp.j('l2') ->> 'launched', pg_temp.j('l2') ->> 'skipped'), '12|1',
          'lançar com o 25/12/2027 já lançado pela central: lança os outros 12 e pula esse');
-- A trava da volta: com o 01/01/2028 da central, o motor continuaria aberto até 31/12/2028 nos dias retirados.
select set_config('teste.n_fer', pg_temp.nacionais(), true);
select set_config('teste.n_aud', (select count(*) from agenda.audit_log)::text, true);
select case when pg_temp.futuros() is null then skip('nenhum dia da lista por vir (depois de 25/12/2027): a trava não tem o que proteger', 1)
  else is(concat_ws('|', pg_temp.erro('select private.agenda_feriados_ate_2027_retirar()')
                           like 'IMF01: %(' || pg_temp.futuros() || ')%até 31/12/2028. Nada foi mudado.',
                    pg_temp.nacionais() = current_setting('teste.n_fer'),
                    (select count(*) from agenda.audit_log)::text = current_setting('teste.n_aud')),
          't|t|t', 'volta com o 01/01/2028 da central: recusa (IMF01, com os dias que abririam) e nada muda') end;
-- A central retira o 01/01/2028; fica o 25/12/2027 dela (o mesmo dia relançado pela central), que segura até 31/12/2027.
select set_config('teste.id2028', (select h.id::text from agenda.holidays h where h.scope = 'nacional' and h.day = date '2028-01-01'), true);
select set_config('teste.idnatal', (select h.id::text from agenda.holidays h where h.scope = 'nacional' and h.day = date '2027-12-25'), true);
select pg_temp.como(1);
select public.agenda_holiday_remove(pg_temp.id('id2028'));
select pg_temp.entrar('postgres');
select case when pg_temp.futuros() is null then skip('nenhum dia da lista por vir (depois de 25/12/2027): a trava não tem o que proteger', 1)
  else is(concat_ws('|', pg_temp.erro('select private.agenda_feriados_ate_2027_retirar()')
                           like 'IMF01: %(' || pg_temp.futuros() || ')%até 31/12/2027. Nada foi mudado.',
                    pg_temp.nacionais() = replace(current_setting('teste.n_fer'), ',2028-01-01', '')),
          't|t', 'só com o 25/12/2027 da central (relançado): recusa também; o dele (com usuário) não é tirado') end;
-- A central retira o 25/12/2027; fica só um feriado nacional de um ano que já passou (não segura nada).
select pg_temp.como(1);
select public.agenda_holiday_remove(pg_temp.id('idnatal'));
select pg_temp.entrar('postgres');
insert into agenda.holidays (scope, day, name, source) values ('nacional', date '2025-12-25', 'Natal', 'Lei 662/1949 (teste: ano que já passou)');
select set_config('teste.r3', private.agenda_feriados_ate_2027_retirar()::text, true);
select is(concat_ws('|', pg_temp.j('r3') ->> 'removed', pg_temp.nacionais(), private.agenda_national_until()), '12|2025-12-25|2025-12-31',
          'sem feriado da central por vir: a volta tira os 12 da migração e não toca no feriado de 2025');
-- de volta ao estado da migração para a parte D
delete from agenda.holidays h where h.scope = 'nacional' and h.day = date '2025-12-25';
select set_config('teste.l3', private.agenda_feriados_ate_2027_lancar()::text, true);
select is(concat_ws('|', pg_temp.j('l3') ->> 'launched', pg_temp.j('l3') ->> 'skipped', private.agenda_national_until()), '13|0|2027-12-31',
          'lançar de novo depois da volta: os 13 voltam, até 31/12/2027');

/* ===================== D. Os mesmos efeitos da central numa clínica com a agenda nova ===================== */
-- A clínica abre todos os dias, o dia inteiro. Os dias X e Y (os 2 primeiros feriados da lista daqui a 2 dias ou mais)
-- ainda não estão lançados quando ela marca um exame em cada um às 10:00 (os feriados de X e Y saem antes, "à mão");
-- depois a migração lança X e Y.
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select pg_temp.c(), 'Clínica dos Feriados', 'imagem', 'Rua dos Feriados, 1', 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
where pg_temp.x() is not null;
insert into public.clinic_members (clinic_id, user_id, role) select pg_temp.c(), pg_temp.u(2), 'owner' where pg_temp.x() is not null;
select pg_temp.como(2);
select public.agenda_unit_save(pg_temp.c(), jsonb_build_object('holidays_checked_until', coalesce(pg_temp.y(), pg_temp.x()) + 30, 'min_notice_min', 0, 'step_min', 30,
                                                               'max_advance_days', 365))
where pg_temp.x() is not null;
select set_config('teste.rm1', public.agenda_resource_save(pg_temp.c(), '{"kind": "equipamento", "name": "RM-1"}') ->> 'id', true)
where pg_temp.x() is not null;
select set_config('teste.rm', public.agenda_procedure_save(pg_temp.c(), jsonb_build_object(
  'exam_code', 'rm', 'name', 'Ressonância', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('rm1'))))))) ->> 'id', true)
where pg_temp.x() is not null;
select public.agenda_rules_set(pg_temp.c(), null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d))
where pg_temp.x() is not null;
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_feriados', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now() where id = pg_temp.c();
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
delete from agenda.holidays h where h.scope = 'nacional' and h.day in (pg_temp.x(), pg_temp.y());
select pg_temp.como(2);
select set_config('teste.b1', public.agenda_desk_book(pg_temp.c(),
         jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id('rm'), 'starts_at', pg_temp.t('10:00'))),
         '{"name": "Zenaide Feriado Quintela", "phone": "(11) 97777-4420", "consent": true}', 'clinica_telefone') ->> 'id', true)
where pg_temp.x() is not null;
select set_config('teste.b2', public.agenda_desk_book(pg_temp.c(),
         jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id('rm'),
                                              'starts_at', (pg_temp.y() + time '10:00') at time zone 'America/Sao_Paulo')),
         '{"name": "Olavo Feriado Quintela", "phone": "(11) 97777-4421", "consent": true}', 'clinica_telefone') ->> 'id', true)
where pg_temp.y() is not null;
select pg_temp.entrar('postgres');
select case when pg_temp.x() is null then skip('nenhum feriado da lista daqui a 2 dias ou mais (depois de 23/12/2027)', 1)
  else ok(coalesce(current_setting('teste.b1', true), '') ~ '^[0-9a-f-]{36}$'
          and (pg_temp.y() is null or coalesce(current_setting('teste.b2', true), '') ~ '^[0-9a-f-]{36}$'),
          'preparo: a clínica marca um exame às 10:00 dos dias X e Y, antes de os feriados serem lançados') end;
select set_config('teste.v0', pg_temp.versao()::text, true);
select set_config('teste.l4', private.agenda_feriados_ate_2027_lancar()::text, true);
select case when pg_temp.x() is null then skip('nenhum feriado da lista daqui a 2 dias ou mais (depois de 23/12/2027)', 1)
  else is(concat_ws('|', pg_temp.j('l4') ->> 'launched', pg_temp.j('l4') ->> 'skipped', pg_temp.j('l4') ->> 'clinics', pg_temp.j('l4') ->> 'conflicts'),
          concat_ws('|', pg_temp.n_d(), 13 - pg_temp.n_d(), 1, pg_temp.n_d()),
          'lançar com a clínica: X e Y lançados, 1 clínica revalidada e 1 conflito por agendamento (2, não a soma 1 + 2 da central)') end;
select case when pg_temp.x() is null then skip('nenhum feriado da lista daqui a 2 dias ou mais (depois de 23/12/2027)', 1)
  else is((select string_agg(concat_ws('|', k.kind, k.status), ',') from agenda.conflicts k
           join agenda.appointment_items i on i.id = k.item_id
           where k.clinic_id = pg_temp.c() and i.request_id in (pg_temp.id('b1'), pg_temp.id('b2'))),
          array_to_string(array_fill('grade_mudou|aberto'::text, array[pg_temp.n_d()]), ','),
          'cada agendamento que caiu num feriado vira conflito "grade_mudou" (Precisa de atenção, para remarcar)') end;
select case when pg_temp.x() is null then skip('nenhum feriado da lista daqui a 2 dias ou mais (depois de 23/12/2027)', 1)
  else is((select string_agg(concat_ws('|', a.new_value ->> 'clinicas', a.new_value ->> 'conflitos', a.origin, a.reason_code), ',')
           from agenda.audit_log a join agenda.holidays h on a.object_id = h.id::text
           where a.action = 'feriado.criar' and h.scope = 'nacional' and h.day = pg_temp.x()),
          '1|1|sql|migracao_feriados_nacionais', 'a auditoria do dia X conta a clínica e o conflito, como a central') end;
select case when pg_temp.y() is null then skip('só um feriado da lista daqui a 2 dias ou mais (depois de 20/11/2027)', 1)
  else is((select string_agg(concat_ws('|', a.new_value ->> 'clinicas', a.new_value ->> 'conflitos'), ',')
           from agenda.audit_log a join agenda.holidays h on a.object_id = h.id::text
           where a.action = 'feriado.criar' and h.scope = 'nacional' and h.day = pg_temp.y()),
          '1|1', 'a auditoria do dia Y conta só o conflito do dia Y (não soma de novo o do dia X)') end;
select case when pg_temp.x() is null then skip('nenhum feriado da lista daqui a 2 dias ou mais (depois de 23/12/2027)', 1)
  else is(pg_temp.versao() - current_setting('teste.v0')::bigint, 1::bigint,
          'a versão da agenda da clínica sobe uma vez (o painel e a central buscam de novo)') end;
select case when pg_temp.x() is null then skip('nenhum feriado da lista daqui a 2 dias ou mais (depois de 23/12/2027)', 1)
  else is((select count(*)::int from private.agenda_free_starts(pg_temp.c(), pg_temp.id('rm'), pg_temp.x(), pg_temp.x())), 0,
          'o motor não oferece horário no feriado') end;
select case when pg_temp.x() is null then skip('nenhum feriado da lista daqui a 2 dias ou mais (depois de 23/12/2027)', 1)
  else ok((select count(*) from private.agenda_free_starts(pg_temp.c(), pg_temp.id('rm'), pg_temp.x() - 1, pg_temp.x() - 1)) > 0,
          'e oferece na véspera (que não é feriado)') end;
select set_config('teste.v1', pg_temp.versao()::text, true);
select set_config('teste.n_aud', (select count(*) from agenda.audit_log)::text, true);
select set_config('teste.l5', private.agenda_feriados_ate_2027_lancar()::text, true);
select case when pg_temp.x() is null then skip('nenhum feriado da lista daqui a 2 dias ou mais (depois de 23/12/2027)', 1)
  else is(concat_ws('|', pg_temp.j('l5') ->> 'launched', pg_temp.j('l5') ->> 'skipped', pg_temp.j('l5') ->> 'conflicts'), '0|13|0',
          'lançar de novo com a clínica: nada lançado, nenhum conflito novo') end;
select case when pg_temp.x() is null then skip('nenhum feriado da lista daqui a 2 dias ou mais (depois de 23/12/2027)', 1)
  else is(concat_ws('|', pg_temp.versao() = current_setting('teste.v1')::bigint,
                    (select count(*) from agenda.audit_log)::text = current_setting('teste.n_aud'),
                    (select count(*) from agenda.conflicts k where k.clinic_id = pg_temp.c())),
          concat_ws('|', 't', 't', pg_temp.n_d()), 'e nada muda: a versão não sobe, nenhuma auditoria nova, os conflitos continuam os mesmos') end;

select * from finish();
rollback;
