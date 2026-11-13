-- VOLTA da migração agenda_pacote (iMed Agenda, fase 5.2; só se for preciso desfazer). Tem o mesmo nome da migração: se
-- ela for renomeada, renomeie esta também. Devolve public.agenda_package_options ao texto da 3.3
-- (20261103053814_agenda_operacao_parte_2, seção 16), sem a ocupação virtual: as opções voltam a poder trazer dois
-- exames colados no mesmo aparelho (a marcação continua conferindo tudo; a opção só é recusada ao confirmar).
-- Nada de dado muda: a migração não grava nada. Antes de desfazer, volte o site do paciente para a versão anterior
-- (sem "vários exames"), para ninguém ver opção que a marcação recusa. Testada no CI (banco.yml): desfeita, o banco
-- fica igual ao da produção.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

create or replace function public.agenda_package_options(p_clinic uuid, p_procedures uuid[], p_day date, p_limit integer default 5)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  v_n integer := coalesce(cardinality(p_procedures), 0);
  v_gap integer;
  v_dur integer[];
  v_starts jsonb := '[]'::jsonb;
  v_ord integer[];
  v_t0 timestamptz;
  v_t timestamptz;
  v_fim timestamptz;
  v_plano jsonb;
  v_ok boolean;
  v_espera integer;
  v_opcoes jsonb := '[]'::jsonb;
  v_regra integer;
  k integer;
  j integer;
begin
  if p_clinic is null or p_day is null or v_n not between 2 and 4
     or (select count(distinct x) from unnest(p_procedures) x where x is not null) <> v_n then
    return jsonb_build_object('status', 'invalid');
  end if;
  for k in 1 .. v_n loop
    if not private.agenda_can_see_slots(p_clinic, p_procedures[k]) then return jsonb_build_object('status', 'not_found'); end if;
  end loop;
  select coalesce(u.patient_gap_min, 0) into v_gap from agenda.unit_settings u where u.clinic_id = p_clinic;
  v_dur := array(select p.duration_min::integer from unnest(p_procedures) with ordinality x (id, n)
                 join agenda.procedures p on p.id = x.id order by x.n);
  for k in 1 .. v_n loop
    v_starts := v_starts || jsonb_build_array(coalesce((select jsonb_agg(s.slot_start order by s.slot_start)
                                                        from private.agenda_free_starts(p_clinic, p_procedures[k], p_day, p_day, now()) s),
                                                       '[]'::jsonb));
  end loop;
  for v_ord in
    with recursive perm (ord) as (
      select array[i] from generate_series(1, v_n) i
      union all
      select perm.ord || i from perm cross join generate_series(1, v_n) i where i <> all (perm.ord) and cardinality(perm.ord) < v_n)
    select perm.ord from perm where cardinality(perm.ord) = v_n
  loop
    -- regras de ordem e "não no mesmo dia" (num dia só, "não no mesmo dia" elimina a combinação)
    continue when exists (select 1 from agenda.procedure_pair_rules r
                          join generate_subscripts(v_ord, 1) a (ia) on p_procedures[v_ord[ia]] = r.first_procedure
                          join generate_subscripts(v_ord, 1) b (ib) on p_procedures[v_ord[ib]] = r.second_procedure
                          where (r.rule = 'ordem' and ia > ib) or r.rule = 'nao_mesmo_dia');
    for v_t0 in select (x.value #>> '{}')::timestamptz from jsonb_array_elements(v_starts -> (v_ord[1] - 1)) x loop
      v_plano := jsonb_build_array(jsonb_build_object('procedure_id', p_procedures[v_ord[1]], 'starts_at', v_t0,
                                                      'ends_at', v_t0 + make_interval(mins => v_dur[v_ord[1]])));
      v_fim := v_t0 + make_interval(mins => v_dur[v_ord[1]]);
      v_ok := true;
      for j in 2 .. v_n loop
        select coalesce(max(r.min_gap_min), 0) into v_regra from agenda.procedure_pair_rules r
        where r.first_procedure = p_procedures[v_ord[j - 1]] and r.second_procedure = p_procedures[v_ord[j]] and r.rule = 'intervalo_min';
        select min((x.value #>> '{}')::timestamptz) into v_t from jsonb_array_elements(v_starts -> (v_ord[j] - 1)) x
        where (x.value #>> '{}')::timestamptz >= v_fim + make_interval(mins => greatest(v_gap, v_regra));
        if v_t is null then v_ok := false; exit; end if;
        v_plano := v_plano || jsonb_build_array(jsonb_build_object('procedure_id', p_procedures[v_ord[j]], 'starts_at', v_t,
                                                                   'ends_at', v_t + make_interval(mins => v_dur[v_ord[j]])));
        v_fim := v_t + make_interval(mins => v_dur[v_ord[j]]);
      end loop;
      continue when not v_ok;
      v_espera := (extract(epoch from (v_fim - v_t0)) / 60)::integer - (select sum(d) from unnest(v_dur) d)::integer;
      v_opcoes := v_opcoes || jsonb_build_array(jsonb_build_object('items', v_plano, 'wait_min', v_espera,
                                                                   'starts_at', v_t0, 'ends_at', v_fim));
    end loop;
  end loop;
  return jsonb_build_object('status', 'ok', 'options', coalesce((
    select jsonb_agg(o.value order by (o.value ->> 'wait_min')::integer, (o.value ->> 'ends_at')::timestamptz,
                     (o.value ->> 'starts_at')::timestamptz)
    from (select x.value from jsonb_array_elements(v_opcoes) x
          order by (x.value ->> 'wait_min')::integer, (x.value ->> 'ends_at')::timestamptz, (x.value ->> 'starts_at')::timestamptz
          limit least(greatest(coalesce(p_limit, 5), 1), 20)) o), '[]'::jsonb));
end $$;

revoke all on function public.agenda_package_options(uuid, uuid[], date, integer) from public, anon, authenticated;
grant execute on function public.agenda_package_options(uuid, uuid[], date, integer) to anon, authenticated;
