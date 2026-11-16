-- Valores da teleconsulta (decisão do dono em 16/11/2026): a consulta custa R$ 70,00 e o repasse ao médico é de
-- R$ 35,00 por teleconsulta atendida. Volta: supabase/volta/<mesmo nome>.sql.
-- NOME PROVISÓRIO, AINDA NÃO APLICADA NA PRODUÇÃO (16/11/2026; ao aplicar, tire esta marca): só entra com a
-- aprovação do dono. Ao aplicar, siga os 5 passos de "Ao aplicar uma migração provisória na produção" do
-- .github/workflows/banco.yml (renomear esta e a volta com a versão que o conector gravar, tirar esta marca, tirar o
-- nome de PENDENTES_NA_PRODUCAO, renomear as outras provisórias para depois dela e trocar ULTIMA_NA_PRODUCAO).
--
-- Em linguagem simples: até hoje o sistema não sabia quanto custa a teleconsulta nem quanto o médico recebe. Esta
-- migração guarda os dois valores (com histórico: mudar o valor não mexe no que já foi atendido) e faz a conta do
-- repasse. NADA É COBRADO NEM PAGO PELO SITE: o paciente não vê preço (o site continua dizendo que não cobra nesta
-- fase; o preço só aparece quando o pagamento pelo site existir) e o repasse é pago pela equipe do IMED, por fora.
--   1. private.tele_valores          preço da consulta e repasse ao médico, em centavos, e desde quando valem. Só se
--                                    acrescenta (o valor antigo fica, para a conta do que já foi atendido);
--   2. tele_repasse_medico()         o médico APROVADO vê o repasse em vigor e, mês a mês (este e os 2 anteriores), quantas
--                                    teleconsultas dele foram atendidas e quanto isso dá. Só os números dele;
--   3. admin_tele_repasses(mês)      a equipe do IMED vê, por médico, as atendidas no mês e o repasse (para pagar por
--                                    fora), e os valores em vigor. Nenhum dado de paciente;
--   4. admin_tele_valores_definir(preço, repasse)   a equipe do IMED muda os valores (vale daí em diante).
-- "Atendida" é a mesma regra do painel do médico (tele_painel_medico): o atendimento começou (started_at) e a consulta
-- foi encerrada; o dia é o do fim (o gravado ou 3 horas depois do começo, o que vier primeiro), no horário de São
-- Paulo. Cada consulta usa o repasse que valia no fim dela. Consulta encerrada ANTES do primeiro valor não tem repasse.
-- O preço do paciente não é exposto por nenhuma função pública nesta migração.
--
-- Só aditiva: uma tabela e funções novas. Nenhuma tabela, coluna, policy, permissão ou função existente muda. Pode
-- rodar de novo sem erro.
-- Conferir na produção depois de aplicar (tem de dar true):
--   select (select count(*) from private.tele_valores) = 1
--      and (select preco_centavos = 7000 and repasse_medico_centavos = 3500 from private.tele_valores order by vigente_desde desc limit 1)
--      and not has_function_privilege('anon', 'public.tele_repasse_medico()', 'EXECUTE')
--      and has_function_privilege('authenticated', 'public.admin_tele_repasses(text)', 'EXECUTE')
--      and not has_table_privilege('authenticated', 'private.tele_valores', 'SELECT');
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

/* ===================== 1. Os valores, com histórico ===================== */
create table if not exists private.tele_valores (
  id bigint generated always as identity primary key,
  preco_centavos integer not null check (preco_centavos between 0 and 1000000),
  repasse_medico_centavos integer not null check (repasse_medico_centavos >= 0),
  vigente_desde timestamptz not null default now(),
  criado_por uuid,
  check (repasse_medico_centavos <= preco_centavos)
);
comment on table private.tele_valores is
  'Preço da teleconsulta e repasse ao médico (centavos), com a data em que passam a valer. Só acréscimo: cada atendimento usa o valor que valia no fim dele.';
create unique index if not exists tele_valores_desde on private.tele_valores (vigente_desde);
alter table private.tele_valores enable row level security;
revoke all on table private.tele_valores from public, anon, authenticated, service_role;
revoke all on sequence private.tele_valores_id_seq from public, anon, authenticated, service_role;

create or replace function private.tele_valores_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'tele_valores: valor lançado não muda nem se apaga (lance um valor novo)' using errcode = 'P0001';
end $$;
revoke all on function private.tele_valores_guard() from public, anon, authenticated, service_role;
create or replace trigger tele_valores_guard before update or delete on private.tele_valores
  for each row execute function private.tele_valores_guard();
create or replace trigger tele_valores_guard_truncate before truncate on private.tele_valores
  for each statement execute function private.tele_valores_guard();

-- O primeiro valor: R$ 70,00 a consulta, R$ 35,00 o repasse, valendo a partir de quando esta migração é aplicada.
insert into private.tele_valores (preco_centavos, repasse_medico_centavos)
select 7000, 3500 where not exists (select 1 from private.tele_valores);

-- As teleconsultas ATENDIDAS (regra do painel do médico) com o fim que conta e o repasse que valia nesse fim.
-- p_medico nulo = todos. Só as com fim dentro de [p_de, p_ate).
create or replace function private.tele_atendidas(p_medico uuid, p_de timestamptz, p_ate timestamptz)
returns table (doctor_id uuid, fim timestamptz, repasse_centavos integer)
language sql stable
set search_path = ''
as $$
  select x.doctor_id, x.fim,
         (select v.repasse_medico_centavos from private.tele_valores v where v.vigente_desde <= x.fim order by v.vigente_desde desc limit 1)
  from (select t.doctor_id, least(t.ended_at, t.started_at + interval '3 hours') as fim
        from public.teleconsultations t
        where t.doctor_id is not null and (p_medico is null or t.doctor_id = p_medico)
          and t.started_at is not null
          and t.created_at >= p_de - interval '1 day'
          and private.tele_effective_status(t.status, t.created_at, t.accepted_at, t.started_at) = 'ended') x
  where x.fim >= p_de and x.fim < p_ate;
$$;
revoke all on function private.tele_atendidas(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;

/* ===================== 2. O médico vê o repasse dele ===================== */
create or replace function public.tele_repasse_medico()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_doc public.doctors;
  v_val private.tele_valores;
  v_mes date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
begin
  -- Só médico com cadastro aprovado, como a fila: sem_login, sem_cadastro ou nao_aprovado (P0001).
  v_doc := private.tele_me(true);
  select * into v_val from private.tele_valores v order by v.vigente_desde desc limit 1;   -- o último lançado é o que vale
  if v_val.id is null then return jsonb_build_object('definido', false); end if;
  return jsonb_build_object(
    'definido', true, 'repasse_centavos', v_val.repasse_medico_centavos, 'vigente_desde', v_val.vigente_desde,
    'meses', (
      select jsonb_agg(jsonb_build_object('mes', to_char(m.ini, 'YYYY-MM'), 'atendidas', a.n, 'repasse_centavos', a.total) order by m.ini desc)
      from (select (v_mes - make_interval(months => g))::date as ini from generate_series(0, 2) g) m
      cross join lateral (
        select count(*) filter (where x.repasse_centavos is not null)::integer as n, coalesce(sum(x.repasse_centavos), 0)::integer as total
        from private.tele_atendidas(v_doc.id, m.ini::timestamp at time zone 'America/Sao_Paulo',
                                    (m.ini + interval '1 month')::timestamp at time zone 'America/Sao_Paulo') x) a));
end $$;

/* ===================== 3. A equipe vê o repasse de cada médico no mês ===================== */
-- p_mes: 'AAAA-MM' (vazio = o mês de hoje em São Paulo). Só médico com pelo menos uma atendida com repasse no mês.
create or replace function public.admin_tele_repasses(p_mes text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_val private.tele_valores;
  v_ini date;
  v_de timestamptz;
  v_ate timestamptz;
begin
  if not public.is_imed_admin() then return jsonb_build_object('erro', 'forbidden'); end if;
  if coalesce(p_mes, '') = '' then
    v_ini := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  elsif p_mes ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then
    v_ini := (p_mes || '-01')::date;
  else
    return jsonb_build_object('erro', 'dados_invalidos', 'campo', 'mes');
  end if;
  v_de := v_ini::timestamp at time zone 'America/Sao_Paulo';
  v_ate := (v_ini + interval '1 month')::timestamp at time zone 'America/Sao_Paulo';
  select * into v_val from private.tele_valores v order by v.vigente_desde desc limit 1;   -- o último lançado é o que vale
  return jsonb_build_object(
    'ok', true, 'mes', to_char(v_ini, 'YYYY-MM'),
    'valores', case when v_val.id is not null then jsonb_build_object('preco_centavos', v_val.preco_centavos,
                 'repasse_centavos', v_val.repasse_medico_centavos, 'vigente_desde', v_val.vigente_desde) end,
    'historico', coalesce((select jsonb_agg(jsonb_build_object('preco_centavos', h.preco_centavos, 'repasse_centavos', h.repasse_medico_centavos,
                             'vigente_desde', h.vigente_desde) order by h.vigente_desde desc) from private.tele_valores h), '[]'::jsonb),
    'medicos', coalesce((
      select jsonb_agg(jsonb_build_object('nome', d.full_name, 'crm', d.crm, 'crm_uf', d.crm_uf::text, 'atendidas', a.n, 'repasse_centavos', a.total)
                       order by a.total desc, d.full_name)
      from (select x.doctor_id, count(*)::integer as n, sum(x.repasse_centavos)::integer as total
            from private.tele_atendidas(null, v_de, v_ate) x where x.repasse_centavos is not null group by x.doctor_id) a
      join public.doctors d on d.id = a.doctor_id), '[]'::jsonb),
    'sem_valor', (select count(*)::integer from private.tele_atendidas(null, v_de, v_ate) x where x.repasse_centavos is null));
end $$;

/* ===================== 4. A equipe muda os valores ===================== */
-- Em centavos. Vale a partir de agora; o que já foi atendido continua com o valor de antes.
create or replace function public.admin_tele_valores_definir(p_preco_centavos integer, p_repasse_centavos integer)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_ult private.tele_valores;
begin
  if not public.is_imed_admin() then return jsonb_build_object('erro', 'forbidden'); end if;
  if p_preco_centavos is null or p_preco_centavos not between 0 and 1000000 then return jsonb_build_object('erro', 'dados_invalidos', 'campo', 'preco'); end if;
  if p_repasse_centavos is null or p_repasse_centavos < 0 or p_repasse_centavos > p_preco_centavos then
    return jsonb_build_object('erro', 'dados_invalidos', 'campo', 'repasse');
  end if;
  perform pg_advisory_xact_lock(7301, 1);
  select * into v_ult from private.tele_valores v order by v.vigente_desde desc limit 1;
  if v_ult.preco_centavos = p_preco_centavos and v_ult.repasse_medico_centavos = p_repasse_centavos then
    return jsonb_build_object('ok', true, 'igual', true);
  end if;
  insert into private.tele_valores (preco_centavos, repasse_medico_centavos, vigente_desde, criado_por)
  values (p_preco_centavos, p_repasse_centavos, clock_timestamp(), auth.uid());
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.tele_repasse_medico() from public, anon, authenticated, service_role;
grant execute on function public.tele_repasse_medico() to authenticated;
revoke all on function public.admin_tele_repasses(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_tele_repasses(text) to authenticated;
revoke all on function public.admin_tele_valores_definir(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_tele_valores_definir(integer, integer) to authenticated;
comment on function public.tele_repasse_medico() is
  'Médico aprovado: o repasse por teleconsulta atendida em vigor e, nos 3 últimos meses, quantas ele atendeu e quanto dá. Só os números dele.';
comment on function public.admin_tele_repasses(text) is
  'Equipe do IMED: valores da teleconsulta em vigor (e o histórico) e, por médico, as atendidas no mês e o repasse. Sem dado de paciente.';
comment on function public.admin_tele_valores_definir(integer, integer) is
  'Equipe do IMED: define o preço da teleconsulta e o repasse ao médico (centavos), valendo a partir de agora.';
