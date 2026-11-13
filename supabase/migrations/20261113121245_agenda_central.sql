-- iMed Agenda, fase 4.4 ("Central do IMED, básico"), 10/11/2026. Arquitetura:
-- memory/projects/imed-agenda-arquitetura.md (§11 Central do IMED, §12 equipe do IMED e trilhas, §14 item 4.4).
-- Volta: supabase/volta/<mesmo nome>.sql.
-- Aplicada na produção em 13/11/2026, com a aprovação do dono, logo depois da 4.3 (20261113121033_agenda_aviso_pedido);
-- o nome do arquivo é a versão que o banco gravou.
--
-- Em linguagem simples: o painel de gestão (gestao.html) ganha a parte "Agenda das clínicas", e ela precisa LER, de
-- uma vez e para todas as clínicas, o que hoje só existe clínica por clínica ou só dentro do banco. São funções novas,
-- todas "agenda_central_*", e nada mais:
--   1. agenda_central_version()      um número que muda quando a agenda de qualquer clínica muda (para a tela saber
--                                    a hora de buscar de novo; só números);
--   2. agenda_central_overview()     as clínicas: modalidade, agenda ativa, venda online, fuso e se foi confirmado,
--                                    feriados conferidos até quando, versão, última atividade, conflitos abertos,
--                                    agendamentos por vir e tamanho da equipe (contagens);
--   3. agenda_central_conflicts()    os conflitos abertos de todas as clínicas (tipo, clínica, desde quando, horário);
--   4. agenda_central_audit()        quem mexeu em quê (agenda.audit_log: ação, objeto, papel, origem, código do
--                                    motivo) e as LEITURAS de dado de paciente (agenda.access_log) só em contagens:
--                                    por dia, clínica, função, escopo e código do motivo. Quem agiu aparece pelo papel
--                                    e por um código curto da conta (8 caracteres do id), nunca por nome ou e-mail;
--   5. agenda_central_settings() e agenda_central_setting_set()   os parâmetros globais que o sistema realmente lê
--                                    (hoje um só: o limite de agendamentos por vir do mesmo telefone na mesma clínica);
--                                    mudar é só do administrador, com limites, e fica na auditoria;
--   6. agenda_central_holidays() e agenda_central_holiday_preview()   os feriados lançados e, antes de lançar um, quantas
--                                    clínicas fecham e quantos agendamentos já existem naquele dia (lançar e retirar
--                                    continuam nas funções da 3.2: agenda_holiday_save e agenda_holiday_remove);
--   7. agenda_central_staff(), agenda_central_staff_grant() e agenda_central_staff_revoke()   os papéis da equipe do
--                                    IMED (private.imed_staff, da 3.1): só o administrador vê, dá e tira. Dar exige
--                                    conta já criada com e-mail confirmado; tirar = revoked_at (nada se apaga); cada
--                                    mudança vai sozinha para a auditoria (gatilho imed_staff_audit, da 3.1).
-- Quem pode: a leitura, quem tem imed.agenda.monitor (operação, suporte, auditoria); a auditoria, imed.auditoria.ver;
-- a prévia do feriado, imed.feriados.editar; parâmetros e papéis, só o administrador (is_imed_admin). O administrador
-- tem todas (imed_has). Nenhuma destas funções devolve nome, telefone, e-mail ou qualquer dado de paciente, nem o
-- id de um pedido: só números, códigos e nomes de clínica (o e-mail que aparece em agenda_central_staff é o da
-- PRÓPRIA equipe do IMED, e só para o administrador).
--
--   8. agenda_holiday_remove (a da 3.2, trocada; revisão de 11/11): retirar um feriado lançado por engano agora fecha
--                                    os conflitos "grade_mudou" que ele abriu (os do dia retirado cujo agendamento
--                                    voltou a caber) como "resolvido" com o código feriado_retirado, sobe a versão das
--                                    clínicas afetadas (os painéis abertos releem) e devolve quantos fechou. Antes ficavam
--                                    abertos em "Para remarcar" e a recepção ligava para remarcar quem não precisava.
-- Nada aqui apaga o que existe: CREATE FUNCTION novas, REVOKE e GRANT, e a troca do corpo de agenda_holiday_remove
-- (mesma assinatura e mesmas permissões; a volta põe a da 3.2, letra por letra). Nenhuma tabela, policy ou gatilho
-- muda; nenhuma troca de is_imed_admin por imed_has foi precisa: quem não é administrador continua sem acesso às
-- funções antigas. Pode rodar de novo sem erro.
-- Conferir na produção depois de aplicar (tem de dar true):
--   select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'agenda\_central\_%') = 11
--      and has_function_privilege('authenticated', 'public.agenda_central_overview()', 'EXECUTE')
--      and not has_function_privilege('anon', 'public.agenda_central_overview()', 'EXECUTE')
--      and not has_function_privilege('anon', 'public.agenda_central_staff_grant(text,text)', 'EXECUTE')
--      and not has_function_privilege('authenticated', 'private.agenda_central_params()', 'EXECUTE');

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Versão da central ===================== */
-- Muda quando a agenda de qualquer clínica muda (private.agenda_touch) ou um conflito abre ou fecha. A tela compara
-- com o que tinha e só então busca os dados de novo. Só números.
create or replace function public.agenda_central_version()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if not public.imed_has('imed.agenda.monitor') then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object(
    'status', 'ok',
    'version', (select coalesce(sum(v.version), 0) from agenda.clinic_versions v),
    'changed_at', (select max(v.changed_at) from agenda.clinic_versions v),
    'clinics', (select count(*) from agenda.unit_settings),
    'open_conflicts', (select count(*) from agenda.conflicts k where k.status in ('aberto', 'em_andamento')));
end $$;

/* ===================== 2. As clínicas ===================== */
-- Todas as clínicas do IMED (até 500; as que têm a agenda ativa primeiro) com o estado da agenda de cada uma.
-- "upcoming" = agendamentos do motor novo ainda por vir (itens ativos); "members" = pessoas na equipe da clínica;
-- "selling" = o paciente consegue marcar pelo site agora (venda ligada, publicada, aceita pedidos, não é demonstração).
create or replace function public.agenda_central_overview()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not public.imed_has('imed.agenda.monitor') then return jsonb_build_object('status', 'forbidden'); end if;
  with k as (
    select x.clinic_id, count(*)::integer as n from agenda.conflicts x
    where x.status in ('aberto', 'em_andamento') group by x.clinic_id
  ), f as (
    select i.clinic_id, count(*)::integer as n from agenda.appointment_items i
    where i.starts_at > now() and private.agenda_active_status(i.status) group by i.clinic_id
  ), m as (
    select x.clinic_id, count(*)::integer as n from public.clinic_members x group by x.clinic_id
  ), l as (
    select c.id, c.name, c.city, c.state, c.status, c.is_demo, c.agenda_mode, c.timezone, c.timezone_confirmed_at,
           c.agenda_online_since, (u.clinic_id is not null) as active, u.holidays_checked_until, u.closes_on_holidays,
           -- vendendo de fato: a venda ligada e a clínica no ar, aceitando pedidos e sem ser demonstração (a mesma
           -- regra do motor, private.agenda_can_see_slots); só a data não basta
           (c.agenda_online_since is not null and c.status = 'published' and coalesce(c.accepts_online_booking, false)
            and not coalesce(c.is_demo, false)) as selling,
           coalesce(v.version, 0) as version, v.changed_at,
           coalesce(k.n, 0) as conflicts, coalesce(f.n, 0) as upcoming, coalesce(m.n, 0) as members
    from public.clinics c
    left join agenda.unit_settings u on u.clinic_id = c.id
    left join agenda.clinic_versions v on v.clinic_id = c.id
    left join k on k.clinic_id = c.id
    left join f on f.clinic_id = c.id
    left join m on m.clinic_id = c.id
  ), t as (
    select * from l order by l.active desc, l.conflicts desc, l.name, l.id limit 500
  )
  select jsonb_build_object(
    'status', 'ok',
    'generated_at', now(),
    'national_holidays_until', private.agenda_national_until(),
    'totals', (select jsonb_build_object(
                 'clinics', count(*),
                 'agenda_active', count(*) filter (where l.active),
                 'online', count(*) filter (where l.selling),
                 'timezone_pending', count(*) filter (where l.active and l.timezone_confirmed_at is null),
                 'open_conflicts', coalesce(sum(l.conflicts), 0),
                 'upcoming', coalesce(sum(l.upcoming), 0),
                 'by_mode', jsonb_build_object(
                   'pedido', count(*) filter (where l.agenda_mode = 'pedido'),
                   'nativa', count(*) filter (where l.agenda_mode = 'nativa'),
                   'manual', count(*) filter (where l.agenda_mode = 'manual'),
                   'externa', count(*) filter (where l.agenda_mode = 'externa')))
               from l),
    'truncated', (select count(*) > 500 from l),
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object(
               'clinic_id', t.id, 'name', t.name, 'city', t.city, 'state', t.state, 'status', t.status, 'demo', t.is_demo,
               'agenda_mode', t.agenda_mode, 'agenda_active', t.active, 'online_since', t.agenda_online_since, 'selling', t.selling,
               'timezone', t.timezone, 'timezone_confirmed_at', t.timezone_confirmed_at,
               'holidays_checked_until', t.holidays_checked_until, 'closes_on_holidays', t.closes_on_holidays,
               'version', t.version, 'changed_at', t.changed_at,
               'open_conflicts', t.conflicts, 'upcoming', t.upcoming, 'members', t.members)
             order by t.active desc, t.conflicts desc, t.name, t.id)
      from t), '[]'::jsonb))
  into v_out;
  return v_out;
end $$;

/* ===================== 3. Conflitos de todas as clínicas ===================== */
-- Abertos e em andamento (padrão) ou todos dos últimos 90 dias (p_all). Até 200, os mais antigos em aberto primeiro.
-- Só o tipo, a clínica, as datas e o horário do item: nada do pedido nem do paciente (resolver é no painel da clínica).
create or replace function public.agenda_central_conflicts(p_all boolean default false)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not public.imed_has('imed.agenda.monitor') then return jsonb_build_object('status', 'forbidden'); end if;
  with q as (
    select k.id, k.clinic_id, c.name as clinic_name, c.timezone, k.kind, k.status, k.resolution_code, k.created_at,
           k.resolved_at, i.starts_at
    from agenda.conflicts k
    join public.clinics c on c.id = k.clinic_id
    left join agenda.appointment_items i on i.id = k.item_id
    where case when coalesce(p_all, false) then k.created_at > now() - interval '90 days'
               else k.status in ('aberto', 'em_andamento') end
  ), t as (
    select * from q order by (q.status in ('aberto', 'em_andamento')) desc, q.created_at, q.id limit 200
  )
  select jsonb_build_object(
    'status', 'ok',
    'generated_at', now(),
    'total', (select count(*) from q),
    'open', (select count(*) from q where q.status in ('aberto', 'em_andamento')),
    'conflicts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'clinic_id', t.clinic_id, 'clinic_name', t.clinic_name, 'timezone', t.timezone,
               'kind', t.kind, 'status', t.status, 'resolution_code', t.resolution_code,
               'created_at', t.created_at, 'resolved_at', t.resolved_at, 'starts_at', t.starts_at)
             order by (t.status in ('aberto', 'em_andamento')) desc, t.created_at, t.id)
      from t), '[]'::jsonb))
  into v_out;
  return v_out;
end $$;

/* ===================== 4. Auditoria ===================== */
-- p_filters: {days (1 a 365; padrão 30), clinic (uuid), object_type (código), actor (os 8 primeiros caracteres do id
-- da conta)}. Devolve as mudanças (agenda.audit_log; até 200, as mais novas primeiro) e as leituras de dado de
-- paciente (agenda.access_log) SOMADAS por dia, clínica, conta, função, escopo e motivo (até 200 linhas): quantas
-- leituras e de quantos agendamentos diferentes, nunca qual agendamento. Os valores antigos e novos da auditoria
-- (old_value, new_value) não saem daqui.
create or replace function public.agenda_central_audit(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_days integer := 30;
  v_clinic uuid;
  v_type text;
  v_actor text;
  v_from timestamptz;
  v_day date;
  v_out jsonb;
begin
  if not public.imed_has('imed.auditoria.ver') then return jsonb_build_object('status', 'forbidden'); end if;
  if private.agenda_unknown_keys(v_f, array['days', 'clinic', 'object_type', 'actor']) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_f ? 'days' and jsonb_typeof(v_f -> 'days') <> 'null' then
    if jsonb_typeof(v_f -> 'days') <> 'number' or (v_f ->> 'days') !~ '^[0-9]{1,3}$' or (v_f ->> 'days')::integer not between 1 and 365 then
      return jsonb_build_object('status', 'invalid');
    end if;
    v_days := (v_f ->> 'days')::integer;
  end if;
  if nullif(v_f ->> 'clinic', '') is not null then
    if (v_f ->> 'clinic') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('status', 'invalid');
    end if;
    v_clinic := (v_f ->> 'clinic')::uuid;
  end if;
  v_type := nullif(v_f ->> 'object_type', '');
  if v_type is not null and v_type !~ '^[a-z][a-z0-9_]{2,40}$' then return jsonb_build_object('status', 'invalid'); end if;
  v_actor := nullif(v_f ->> 'actor', '');
  if v_actor is not null and v_actor !~ '^[0-9a-f]{8}$' then return jsonb_build_object('status', 'invalid'); end if;
  v_day := (now() at time zone 'America/Sao_Paulo')::date - (v_days - 1);
  v_from := v_day::timestamp at time zone 'America/Sao_Paulo';

  with a as (
    select x.id, x.at, x.clinic_id, x.actor_kind, x.actor_role, x.actor_user, x.origin, x.action, x.object_type, x.reason_code
    from agenda.audit_log x
    where x.at >= v_from
      and (v_clinic is null or x.clinic_id = v_clinic)
      and (v_type is null or x.object_type = v_type)
      and (v_actor is null or left(x.actor_user::text, 8) = v_actor)
  ), a200 as (
    select * from a order by a.at desc, a.id desc limit 200
  ), r as (
    select x.day, x.clinic_id, x.user_id, x.fn, x.scope, x.justification_code,
           sum(x.reads)::bigint as reads, count(distinct x.request_id)::integer as requests, max(x.last_at) as last_at
    from agenda.access_log x
    where x.day >= v_day
      and (v_clinic is null or x.clinic_id = v_clinic)
      and (v_actor is null or left(x.user_id::text, 8) = v_actor)
    group by x.day, x.clinic_id, x.user_id, x.fn, x.scope, x.justification_code
  ), r200 as (
    select * from r order by r.day desc, r.last_at desc, r.reads desc limit 200
  )
  select jsonb_build_object(
    'status', 'ok',
    'generated_at', now(),
    'days', v_days, 'from', v_day,
    'totals', jsonb_build_object(
      'changes', (select count(*) from a),
      'reads', (select coalesce(sum(r.reads), 0) from r),
      'readers', (select count(distinct r.user_id) from r),
      'imed_reads', (select coalesce(sum(r.reads), 0) from r where r.justification_code is not null)),
    'object_types', coalesce((select jsonb_agg(distinct x.object_type) from agenda.audit_log x where x.at >= v_from), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a200.id, 'at', a200.at, 'clinic_id', a200.clinic_id,
               'clinic_name', (select c.name from public.clinics c where c.id = a200.clinic_id),
               'actor_kind', a200.actor_kind, 'actor_role', a200.actor_role, 'actor', left(a200.actor_user::text, 8),
               'origin', a200.origin, 'action', a200.action, 'object_type', a200.object_type,
               'reason_code', a200.reason_code)
             order by a200.at desc, a200.id desc)
      from a200), '[]'::jsonb),
    'reads', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', r200.day, 'clinic_id', r200.clinic_id,
               'clinic_name', (select c.name from public.clinics c where c.id = r200.clinic_id),
               'actor', left(r200.user_id::text, 8),
               'actor_role', coalesce((select m.role from public.clinic_members m
                                       where m.clinic_id = r200.clinic_id and m.user_id = r200.user_id),
                                      case when r200.justification_code is not null then 'imed' end),
               'fn', r200.fn, 'scope', r200.scope, 'justification_code', r200.justification_code,
               'reads', r200.reads, 'requests', r200.requests)
             order by r200.day desc, r200.last_at desc, r200.reads desc)
      from r200), '[]'::jsonb))
  into v_out;
  return v_out;
end $$;

/* ===================== 5. Parâmetros globais ===================== */
-- Os parâmetros que o sistema REALMENTE lê de agenda.settings_global (private.agenda_setting_int), com o padrão e os
-- limites de cada um. Parâmetro novo no código → acrescente a linha aqui (o pgTAP confere o padrão com o do código).
create or replace function private.agenda_central_params()
returns table (key text, def integer, min integer, max integer)
language sql immutable
set search_path = ''
as $$
  values ('agenda.limite_futuros_por_telefone'::text, 3, 1, 20);
$$;
revoke all on function private.agenda_central_params() from public, anon, authenticated, service_role;

-- Leitura: o valor em vigor de cada parâmetro (o gravado ou, sem gravação, o padrão).
create or replace function public.agenda_central_settings()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if not public.imed_has('imed.agenda.monitor') then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object(
    'status', 'ok',
    'can_edit', coalesce(public.is_imed_admin(), false),
    'params', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', p.key, 'default', p.def, 'min', p.min, 'max', p.max,
               'value', case when jsonb_typeof(s.value) = 'number' then s.value end,
               'effective', private.agenda_setting_int(p.key, p.def),
               'updated_at', s.updated_at)
             order by p.key)
      from private.agenda_central_params() p
      left join agenda.settings_global s on s.key = p.key), '[]'::jsonb));
end $$;

-- Grava (p_value dentro dos limites) ou volta ao padrão (p_value nulo: a linha sai). Só o administrador. Vai para a
-- auditoria com a chave e os valores (números).
create or replace function public.agenda_central_setting_set(p_key text, p_value integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  v_old jsonb;
begin
  if not coalesce(public.is_imed_admin(), false) then return jsonb_build_object('status', 'forbidden'); end if;
  select * into p from private.agenda_central_params() x where x.key = p_key;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if p_value is not null and p_value not between p.min and p.max then
    return jsonb_build_object('status', 'invalid', 'min', p.min, 'max', p.max);
  end if;
  select s.value into v_old from agenda.settings_global s where s.key = p_key for update;
  if (p_value is null and v_old is null) or (p_value is not null and v_old = to_jsonb(p_value)) then
    return jsonb_build_object('status', 'ok', 'unchanged', true, 'effective', private.agenda_setting_int(p_key, p.def));
  end if;
  if p_value is null then
    delete from agenda.settings_global s where s.key = p_key;
  else
    insert into agenda.settings_global as s (key, value, updated_at, updated_by)
    values (p_key, to_jsonb(p_value), now(), auth.uid())
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  end if;
  perform private.agenda_audit(null, 'central', case when p_value is null then 'parametro.padrao' else 'parametro.definir' end,
    'setting', null, jsonb_build_object('key', p_key, 'value', v_old), jsonb_build_object('key', p_key, 'value', p_value));
  return jsonb_build_object('status', 'ok', 'effective', private.agenda_setting_int(p_key, p.def));
end $$;

/* ===================== 6. Feriados ===================== */
-- Os feriados lançados (do ano passado em diante; até 400) e até quando o motor oferece horário
-- (national_until: o fim do ano do feriado nacional mais novo; nulo = nenhum lançado = nenhum horário oferecido).
create or replace function public.agenda_central_holidays()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_desde date := (date_trunc('year', now() at time zone 'America/Sao_Paulo') - interval '1 year')::date;
begin
  if not public.imed_has('imed.agenda.monitor') then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object(
    'status', 'ok',
    'today', (now() at time zone 'America/Sao_Paulo')::date,
    'can_edit', public.imed_has('imed.feriados.editar'),
    'national_until', private.agenda_national_until(),
    'clinics_with_agenda', (select count(*) from agenda.unit_settings),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'scope', h.scope, 'uf', h.uf, 'city_ibge', h.city_ibge,
                                          'day', h.day, 'name', h.name, 'source', h.source, 'created_at', h.created_at)
                       order by h.day, h.scope, h.uf, h.city_ibge)
      from (select * from agenda.holidays x where x.day >= v_desde order by x.day, x.scope, x.uf, x.city_ibge limit 400) h),
      '[]'::jsonb));
end $$;

-- Antes de lançar um feriado NACIONAL num dia: quantas clínicas com a agenda ativa fecham nesse dia (fecham em
-- feriado e não marcaram "abrimos neste feriado") e quantos agendamentos ativos e por vir elas já têm nesse dia
-- (viram conflito para remarcar quando o feriado é lançado). Só contagens.
create or replace function public.agenda_central_holiday_preview(p_day date)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not public.imed_has('imed.feriados.editar') then return jsonb_build_object('status', 'forbidden'); end if;
  if p_day is null then return jsonb_build_object('status', 'invalid'); end if;
  with fecha as (
    select u.clinic_id
    from agenda.unit_settings u
    where u.closes_on_holidays
      and not exists (select 1 from agenda.holiday_openings o where o.clinic_id = u.clinic_id and o.day = p_day)
  )
  select jsonb_build_object(
    'status', 'ok',
    'day', p_day,
    'already', exists (select 1 from agenda.holidays h where h.scope = 'nacional' and h.day = p_day),
    'clinics_with_agenda', (select count(*) from agenda.unit_settings),
    'clinics_closing', (select count(*) from fecha),
    'appointments', (select count(*) from agenda.appointment_items i
                     join fecha f on f.clinic_id = i.clinic_id
                     where i.local_start >= p_day::timestamp and i.local_start < (p_day + 1)::timestamp
                       and i.starts_at > now() and private.agenda_active_status(i.status)))
  into v_out;
  return v_out;
end $$;

/* ===================== 7. Papéis da equipe do IMED (só o administrador) ===================== */
-- A equipe (private.imed_staff) com o e-mail de cada conta, o papel, desde quando e se foi retirado; e o que cada
-- papel pode (agenda.role_permissions, escopo imed). O administrador (admin_emails) não aparece: ele tem todas.
create or replace function public.agenda_central_staff()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_imed_admin(), false) then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object(
    'status', 'ok',
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('role', x.role, 'permissions', x.perms) order by x.role)
      from (select substr(rp.role, 6) as role, jsonb_agg(rp.permission order by rp.permission) as perms
            from agenda.role_permissions rp where rp.scope = 'imed' group by rp.role) x), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', s.user_id, 'code', left(s.user_id::text, 8), 'email', u.email, 'role', s.role,
               'granted_at', s.granted_at, 'revoked_at', s.revoked_at, 'active', s.revoked_at is null)
             order by (s.revoked_at is null) desc, lower(u.email), s.role)
      from private.imed_staff s join auth.users u on u.id = s.user_id), '[]'::jsonb));
end $$;

-- Dá um papel a uma conta que JÁ existe, com e-mail confirmado (a pessoa cria a conta no site antes). Papel já ativo:
-- nada muda (unchanged). Papel retirado antes: volta a valer, com a data de hoje. A marca de origem 'central' faz o
-- gatilho da 3.1 gravar a mudança na auditoria como feita pela equipe do IMED.
create or replace function public.agenda_central_staff_grant(p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid;
  v_n integer;
begin
  if not coalesce(public.is_imed_admin(), false) then return jsonb_build_object('status', 'forbidden'); end if;
  if p_role is null or p_role not in ('operacao', 'suporte', 'financeiro', 'auditoria')
     or char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (select 1 from public.admin_emails a where a.email = v_email) then
    return jsonb_build_object('status', 'already_admin');
  end if;
  select u.id into v_user
  from auth.users u
  where lower(u.email) = v_email
    and u.email_confirmed_at is not null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now()) and not coalesce(u.is_anonymous, false)
  order by u.id limit 1;
  if v_user is null then return jsonb_build_object('status', 'user_not_found'); end if;
  perform set_config('imed.origin', 'central', true);
  insert into private.imed_staff as s (user_id, role, granted_by, granted_at, revoked_at)
  values (v_user, p_role, auth.uid(), now(), null)
  on conflict (user_id, role) do update set granted_by = excluded.granted_by, granted_at = excluded.granted_at, revoked_at = null
    where s.revoked_at is not null;
  get diagnostics v_n = row_count;
  perform set_config('imed.origin', v_prev, true);
  return jsonb_build_object('status', 'ok', 'code', left(v_user::text, 8), 'unchanged', v_n = 0);
end $$;

-- Tira um papel (revoked_at = agora; a linha fica). Vale na próxima chamada da pessoa.
create or replace function public.agenda_central_staff_revoke(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_n integer;
begin
  if not coalesce(public.is_imed_admin(), false) then return jsonb_build_object('status', 'forbidden'); end if;
  if p_user is null or p_role is null then return jsonb_build_object('status', 'invalid'); end if;
  perform set_config('imed.origin', 'central', true);
  update private.imed_staff s set revoked_at = now()
  where s.user_id = p_user and s.role = p_role and s.revoked_at is null;
  get diagnostics v_n = row_count;
  perform set_config('imed.origin', v_prev, true);
  if v_n = 0 then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok');
end $$;

/* ===================== 8. Permissões ===================== */
-- Só quem está logado executa (cada função confere a permissão da equipe por dentro); nada para visitante.
revoke all on function public.agenda_central_version() from public, anon, authenticated;
grant execute on function public.agenda_central_version() to authenticated;
revoke all on function public.agenda_central_overview() from public, anon, authenticated;
grant execute on function public.agenda_central_overview() to authenticated;
revoke all on function public.agenda_central_conflicts(boolean) from public, anon, authenticated;
grant execute on function public.agenda_central_conflicts(boolean) to authenticated;
revoke all on function public.agenda_central_audit(jsonb) from public, anon, authenticated;
grant execute on function public.agenda_central_audit(jsonb) to authenticated;
revoke all on function public.agenda_central_settings() from public, anon, authenticated;
grant execute on function public.agenda_central_settings() to authenticated;
revoke all on function public.agenda_central_setting_set(text, integer) from public, anon, authenticated;
grant execute on function public.agenda_central_setting_set(text, integer) to authenticated;
revoke all on function public.agenda_central_holidays() from public, anon, authenticated;
grant execute on function public.agenda_central_holidays() to authenticated;
revoke all on function public.agenda_central_holiday_preview(date) from public, anon, authenticated;
grant execute on function public.agenda_central_holiday_preview(date) to authenticated;
revoke all on function public.agenda_central_staff() from public, anon, authenticated;
grant execute on function public.agenda_central_staff() to authenticated;
revoke all on function public.agenda_central_staff_grant(text, text) from public, anon, authenticated;
grant execute on function public.agenda_central_staff_grant(text, text) to authenticated;
revoke all on function public.agenda_central_staff_revoke(uuid, text) from public, anon, authenticated;
grant execute on function public.agenda_central_staff_revoke(uuid, text) to authenticated;

comment on function public.agenda_central_version() is
  'Central do IMED: número que muda quando a agenda de qualquer clínica muda (imed.agenda.monitor). Só números. Fase 4.4.';
comment on function public.agenda_central_overview() is
  'Central do IMED: estado da agenda de cada clínica (modalidade, fuso, feriados conferidos, versão, conflitos; só contagens). Fase 4.4.';
comment on function public.agenda_central_conflicts(boolean) is
  'Central do IMED: conflitos abertos de todas as clínicas (tipo, clínica, datas), sem dado de paciente. Fase 4.4.';
comment on function public.agenda_central_audit(jsonb) is
  'Central do IMED: mudanças (audit_log) e leituras de dado de paciente (access_log) só em códigos e contagens (imed.auditoria.ver). Fase 4.4.';
comment on function public.agenda_central_settings() is
  'Central do IMED: parâmetros globais que o sistema lê, com padrão, limites e valor em vigor. Fase 4.4.';
comment on function public.agenda_central_setting_set(text, integer) is
  'Central do IMED: grava um parâmetro global dentro dos limites, ou volta ao padrão (nulo). Só o administrador; vai para a auditoria. Fase 4.4.';
comment on function public.agenda_central_holidays() is
  'Central do IMED: feriados lançados e até quando o motor oferece horário. Lançar e retirar: agenda_holiday_save e agenda_holiday_remove. Fase 4.4.';
comment on function public.agenda_central_holiday_preview(date) is
  'Central do IMED: antes de lançar um feriado nacional, quantas clínicas fecham e quantos agendamentos já existem no dia (contagens). Fase 4.4.';
comment on function public.agenda_central_staff() is
  'Central do IMED: equipe do IMED e os papéis (private.imed_staff). Só o administrador. Fase 4.4.';
comment on function public.agenda_central_staff_grant(text, text) is
  'Central do IMED: dá um papel da equipe a uma conta existente com e-mail confirmado. Só o administrador; fica na auditoria. Fase 4.4.';
comment on function public.agenda_central_staff_revoke(uuid, text) is
  'Central do IMED: tira um papel da equipe (revoked_at; nada se apaga). Só o administrador; fica na auditoria. Fase 4.4.';

/* ===================== 8. Retirar feriado fecha os conflitos que ele abriu (revisão de 11/11) ===================== */
-- A mesma função da 3.2 (20261103013510_agenda_motor_parte_2), com o que faltava: as clínicas afetadas (o mesmo critério
-- do lançamento, agenda_holiday_save) ficam com a trava exclusiva, o feriado sai, e cada conflito "grade_mudou" aberto
-- de um agendamento daquele dia (no fuso da clínica) que VOLTOU a caber (private.agenda_item_fits: outro feriado no mesmo
-- dia, regra ou bloqueio continuam valendo) é fechado como "resolvido", código feriado_retirado. Depois sobe a versão
-- de cada clínica afetada (agenda_touch, a última coisa, como nas outras funções). Devolve {status, conflicts_closed}.
-- A volta da migração dos feriados nacionais (private.agenda_feriados_ate_2027_retirar, em <versão>_feriados_nacionais)
-- faz o mesmo para os 13 de uma vez, sem chamar esta função (não depende da 4.4): mudou a regra aqui, mude lá também.
create or replace function public.agenda_holiday_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_h agenda.holidays;
  v_clinicas uuid[];
  v_c uuid;
  v_n integer := 0;
  v_k integer;
begin
  if not public.imed_has('imed.feriados.editar') then return jsonb_build_object('status', 'forbidden'); end if;
  select * into v_h from agenda.holidays h where h.id = p_id;
  if v_h.id is null then return jsonb_build_object('status', 'not_found'); end if;
  select array_agg(c.id order by c.id) into v_clinicas
  from agenda.unit_settings u join public.clinics c on c.id = u.clinic_id
  where v_h.scope = 'nacional'
     or (v_h.scope = 'uf' and upper(c.state) = upper(v_h.uf))
     or (v_h.scope = 'municipio' and (select e.city_ibge from public.establishments e where e.cnes = c.cnes) = v_h.city_ibge);
  foreach v_c in array coalesce(v_clinicas, '{}') loop
    perform private.agenda_lock_config(v_c, true);
  end loop;
  perform set_config('imed.origin', 'central', true);
  delete from agenda.holidays h where h.id = p_id returning * into v_h;
  if v_h.id is null then
    perform set_config('imed.origin', v_prev, true);
    return jsonb_build_object('status', 'not_found');
  end if;
  foreach v_c in array coalesce(v_clinicas, '{}') loop
    with fechados as (
      update agenda.conflicts k
      set status = 'resolvido', resolution_code = 'feriado_retirado', resolved_at = now(), resolved_by = auth.uid()
      from agenda.appointment_items i join public.clinics c on c.id = i.clinic_id
      where k.clinic_id = v_c and k.kind = 'grade_mudou' and k.status in ('aberto', 'em_andamento')
        and i.id = k.item_id and (i.starts_at at time zone c.timezone)::date = v_h.day
        and private.agenda_item_fits(k.item_id)
      returning k.id)
    select count(*) into v_k from fechados;
    v_n := v_n + v_k;
  end loop;
  perform private.agenda_audit(null, 'central', 'feriado.remover', 'holiday', v_h.id::text,
    jsonb_build_object('scope', v_h.scope, 'uf', v_h.uf, 'city_ibge', v_h.city_ibge, 'day', v_h.day),
    jsonb_build_object('conflitos_fechados', v_n));
  perform set_config('imed.origin', v_prev, true);
  foreach v_c in array coalesce(v_clinicas, '{}') loop
    perform private.agenda_touch(v_c);
  end loop;
  return jsonb_build_object('status', 'ok', 'conflicts_closed', v_n);
end $$;
revoke all on function public.agenda_holiday_remove(uuid) from public, anon, authenticated;
grant execute on function public.agenda_holiday_remove(uuid) to authenticated;
comment on function public.agenda_holiday_remove(uuid) is
  'Retira um feriado lançado por engano (imed.feriados.editar): fecha os conflitos "grade_mudou" do dia cujo agendamento voltou a caber (feriado_retirado), sobe a versão das clínicas afetadas e diz quantos fechou. Fase 3.2; revisão 4.4.';
