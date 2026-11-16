-- Valores da teleconsulta (migração tele_valores): a consulta custa R$ 70,00 e o repasse ao médico é de R$ 35,00.
--   A. estrutura: tabela fechada, só acréscimo, o primeiro valor é 70/35, quem executa o quê;
--   B. o médico aprovado vê o repasse em vigor e as atendidas dele por mês; quem não é médico não vê; o preço do
--      paciente não sai por aqui;
--   C. a equipe vê o repasse por médico no mês, sem dado de paciente; consulta de antes do primeiro valor não tem repasse;
--   D. só a equipe muda os valores; o que já foi atendido continua com o valor de antes.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test; nomes fictícios.
begin;
select plan(24);

create function pg_temp.entrar(p_papel text, p_usuario uuid default null, p_email text default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_papel = 'postgres' then ''
         else jsonb_strip_nulls(jsonb_build_object('role', p_papel, 'sub', p_usuario, 'email', p_email,
                'aud', case when p_usuario is not null then 'authenticated' end))::text
    end, true);
  perform set_config('role', p_papel, true);
end $$;
create function pg_temp.u(n integer) returns uuid language sql immutable as $$ select ('a5400000-0000-4000-8000-00000000000' || n)::uuid $$;
create function pg_temp.c(n integer) returns uuid language sql immutable as $$ select ('c5400000-0000-4000-8000-00000000000' || n)::uuid $$;
create function pg_temp.medica() returns void language sql as $$ select pg_temp.entrar('authenticated', pg_temp.u(1), 'medica.valores@exemplo.test') $$;
create function pg_temp.medico2() returns void language sql as $$ select pg_temp.entrar('authenticated', pg_temp.u(2), 'medico2.valores@exemplo.test') $$;
create function pg_temp.equipe() returns void language sql as $$ select pg_temp.entrar('authenticated', pg_temp.u(3), 'equipe.valores@exemplo.test') $$;
create function pg_temp.paciente() returns void language sql as $$ select pg_temp.entrar('authenticated', pg_temp.u(4), 'paciente.valores@exemplo.test') $$;
create function pg_temp.dono() returns void language sql as $$ select pg_temp.entrar('postgres') $$;
-- o mês (AAAA-MM) de um instante, em São Paulo
create function pg_temp.mes(p timestamptz) returns text language sql stable as $$ select to_char(p at time zone 'America/Sao_Paulo', 'YYYY-MM') $$;

/* ===================== A. Estrutura (antes de mexer nos dados) ===================== */
select is((select count(*)::integer || '|' || max(preco_centavos) || '|' || max(repasse_medico_centavos) from private.tele_valores), '1|7000|3500',
          'o primeiro valor: consulta R$ 70,00 e repasse R$ 35,00');
select is((select c.relrowsecurity::text || '|' || (select count(*) from pg_policy p where p.polrelid = c.oid) from pg_class c where c.oid = 'private.tele_valores'::regclass),
          'true|0', 'private.tele_valores: RLS ligada e nenhuma policy');
select is(array(select r from unnest(array['anon', 'authenticated', 'service_role']) r where has_table_privilege(r, 'private.tele_valores', 'SELECT, INSERT, UPDATE, DELETE')),
          '{}'::text[], 'ninguém da API lê nem escreve na tabela dos valores');
select is(array(select p.proname || ' ' || r from pg_proc p, unnest(array['anon', 'service_role']) r
                where p.oid in ('public.tele_repasse_medico()'::regprocedure, 'public.admin_tele_repasses(text)'::regprocedure, 'public.admin_tele_valores_definir(integer, integer)'::regprocedure)
                  and has_function_privilege(r, p.oid, 'EXECUTE')),
          '{}'::text[], 'as 3 funções: nem anon nem service_role executam');
select is((select count(*)::integer from pg_proc p
           where p.oid in ('public.tele_repasse_medico()'::regprocedure, 'public.admin_tele_repasses(text)'::regprocedure, 'public.admin_tele_valores_definir(integer, integer)'::regprocedure)
             and has_function_privilege('authenticated', p.oid, 'EXECUTE') and p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""']),
          3, 'as 3 funções: só para quem está logado, SECURITY DEFINER com search_path vazio');
select throws_ok($$update private.tele_valores set repasse_medico_centavos = 1$$, 'P0001', null, 'valor lançado não muda');
select throws_ok($$delete from private.tele_valores$$, 'P0001', null, 'valor lançado não se apaga');

/* ===================== Dados ===================== */
-- Para o teste: o mesmo valor valendo desde 100 dias atrás (o da migração vale só a partir de quando ela foi aplicada).
insert into private.tele_valores (preco_centavos, repasse_medico_centavos, vigente_desde) values (7000, 3500, now() - interval '100 days');
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated', e || '.valores@exemplo.test',
       now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from (values (1, 'medica'), (2, 'medico2'), (3, 'equipe'), (4, 'paciente')) x (n, e);
insert into public.doctors (id, user_id, full_name, crm, crm_uf, status)
values ('e5400000-0000-4000-8000-000000000001', pg_temp.u(1), 'Médica de Teste dos Valores', '154001', 'SP', 'approved'),
       ('e5400000-0000-4000-8000-000000000002', pg_temp.u(2), 'Médico Dois de Teste dos Valores', '154002', 'SP', 'approved');
insert into public.admin_emails (email) values ('equipe.valores@exemplo.test');
-- 1: da médica, atendida há 2 horas; 2: da médica, expirou sem começar (não conta); 3: da médica, atendida no mês passado;
-- 4: do médico 2, atendida há 3 horas; 5: da médica, atendida há 200 dias (antes do primeiro valor: sem repasse).
insert into public.teleconsultations (id, token_hash, status, patient_name, patient_birthdate, patient_phone, reason, consent_version, consent_at,
                                      doctor_id, created_at, accepted_at, started_at, ended_at)
select pg_temp.c(x.n), repeat(x.n::text, 64), x.st, 'Paciente Reservado dos Valores ' || x.n, '1980-01-01', '1190000540' || x.n, 'Motivo reservado', '2026-10-30.2', x.fim - interval '1 hour',
       ('e5400000-0000-4000-8000-00000000000' || x.med)::uuid, x.fim - interval '1 hour', x.fim - interval '50 minutes', case when x.comecou then x.fim - interval '40 minutes' end, x.fim
from (values (1, 'ended', 1, true, now() - interval '2 hours'),
             (2, 'expired', 1, false, now() - interval '5 hours'),
             (3, 'ended', 1, true, (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '10 days') at time zone 'America/Sao_Paulo'),
             (4, 'ended', 2, true, now() - interval '3 hours'),
             (5, 'ended', 1, true, now() - interval '200 days')) x (n, st, med, comecou, fim);

/* ===================== B. O médico vê o repasse dele ===================== */
select pg_temp.medica();
select is(public.tele_repasse_medico() - 'meses' - 'vigente_desde', '{"definido": true, "repasse_centavos": 3500}'::jsonb, 'a médica vê o repasse em vigor (R$ 35,00) e nada do preço do paciente');
select is(jsonb_array_length(public.tele_repasse_medico() -> 'meses'), 3, 'este mês e os 2 anteriores');
select is(public.tele_repasse_medico() -> 'meses' -> 0, jsonb_build_object('mes', pg_temp.mes(now()), 'atendidas', 1, 'repasse_centavos', 3500),
          'este mês: 1 atendida (a que expirou sem começar não conta) = R$ 35,00');
select is(public.tele_repasse_medico() -> 'meses' -> 1 -> 'atendidas', '1'::jsonb, 'mês passado: 1 atendida');
select pg_temp.medico2();
select is(public.tele_repasse_medico() -> 'meses' -> 0 ->> 'repasse_centavos', '3500', 'o outro médico vê só as dele');
select pg_temp.paciente();
select throws_ok($$select public.tele_repasse_medico()$$, 'P0001', 'sem_cadastro', 'quem não é médico não vê repasse');
select pg_temp.entrar('anon');
select throws_ok($$select public.tele_repasse_medico()$$, '42501', null, 'visitante não executa');

/* ===================== C. A equipe vê o repasse por médico ===================== */
select pg_temp.medica();
select is(array[public.admin_tele_repasses() ->> 'erro', public.admin_tele_valores_definir(7000, 7000) ->> 'erro'], array['forbidden', 'forbidden'], 'médico não vê o repasse dos outros nem muda os valores');
select pg_temp.equipe();
select is((public.admin_tele_repasses() -> 'valores') - 'vigente_desde', '{"preco_centavos": 7000, "repasse_centavos": 3500}'::jsonb, 'a equipe vê os valores em vigor');
select is(public.admin_tele_repasses() -> 'medicos',
          '[{"nome": "Médica de Teste dos Valores", "crm": "154001", "crm_uf": "SP", "atendidas": 1, "repasse_centavos": 3500},
            {"nome": "Médico Dois de Teste dos Valores", "crm": "154002", "crm_uf": "SP", "atendidas": 1, "repasse_centavos": 3500}]'::jsonb,
          'este mês, por médico: atendidas e repasse');
select ok(public.admin_tele_repasses()::text !~ 'Reservado|1190000540', 'nenhum dado de paciente na resposta');
select is((public.admin_tele_repasses(pg_temp.mes(now() - interval '200 days')) -> 'medicos')::text || '|' || (public.admin_tele_repasses(pg_temp.mes(now() - interval '200 days')) ->> 'sem_valor'),
          '[]|1', 'consulta de antes do primeiro valor: sem repasse, contada à parte');
select is(public.admin_tele_repasses('2026-13') ->> 'campo', 'mes', 'mês inválido: recusado');

/* ===================== D. Mudar os valores ===================== */
select is(array[public.admin_tele_valores_definir(7000, 7001) ->> 'campo', public.admin_tele_valores_definir(-1, 0) ->> 'campo', public.admin_tele_valores_definir(null, 100) ->> 'campo'],
          array['repasse', 'preco', 'preco'], 'repasse maior que o preço e preço inválido: recusados');
select is(public.admin_tele_valores_definir(7000, 3500), '{"ok": true, "igual": true}'::jsonb, 'os mesmos valores não criam linha nova');
select is(public.admin_tele_valores_definir(8000, 4000), '{"ok": true}'::jsonb, 'a equipe muda para R$ 80,00 e R$ 40,00');
select pg_temp.dono();
-- uma consulta da médica que termina depois da mudança
insert into public.teleconsultations (id, token_hash, status, patient_name, patient_birthdate, patient_phone, reason, consent_version, consent_at,
                                      doctor_id, created_at, accepted_at, started_at, ended_at)
values (pg_temp.c(6), repeat('6', 64), 'ended', 'Paciente Reservado dos Valores 6', '1980-01-01', '11900005406', 'Motivo reservado', '2026-10-30.2', now(),
        'e5400000-0000-4000-8000-000000000001', clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '10 minutes', clock_timestamp() + interval '1 second');
select pg_temp.medica();
select is((public.tele_repasse_medico() ->> 'repasse_centavos') || '|' || (public.tele_repasse_medico() -> 'meses' -> 0 ->> 'atendidas') || '|' || (public.tele_repasse_medico() -> 'meses' -> 0 ->> 'repasse_centavos'),
          '4000|2|7500', 'depois da mudança: o repasse em vigor é R$ 40,00; a consulta de antes continua R$ 35,00 e a nova vale R$ 40,00');

select * from finish();
rollback;
