-- iMed Agenda, fase 5.2 ("Vários exames": o paciente marca de 2 a 4 exames de uma vez), 13/11/2026. Arquitetura:
-- memory/projects/imed-agenda-arquitetura.md (§6 "pacote de exames", passo 3, e §14 item 5.2).
-- Volta: supabase/volta/<mesmo nome>.sql (devolve a função como estava).
-- Aplicada na produção em 13/11/2026, com a aprovação do dono ("pode publicar os varios exames"), junto com o site da
-- 5.2; o nome do arquivo é a versão que o banco gravou (o texto gravado lá é este, com a marca de nome provisório
-- que havia no lugar destas três linhas: só comentário mudou).
--
-- Em linguagem simples: agenda_package_options (as "opções de pacote": em que ordem e em que horários dá para fazer
-- 2 a 4 exames no mesmo dia, com a menor espera) existe desde a 3.3, mas ninguém a usava. Com o site da 5.2 ela passa
-- a ser usada, e a versão antiga tinha dois furos (a marcação, agenda_book, sempre conferiu tudo: nenhum paciente
-- ficou com horário errado; o furo era oferecer uma opção que a marcação recusava em seguida):
--   1. ela olhava os horários livres de cada exame SEPARADOS. Dois exames que usam o MESMO aparelho, sala ou
--      profissional apareciam um colado no outro mesmo quando a higienização (ou o preparo) do aparelho não cabia
--      entre eles, ou quando o limite de chegadas do horário não comportava os dois: o paciente escolhia a opção e a
--      marcação respondia "horário ocupado", sempre. Agora cada opção é montada com OCUPAÇÃO VIRTUAL (arquitetura §6,
--      passo 3): o 2º exame só entra num horário em que ainda cabe DEPOIS de reservar (no papel) os recursos do 1º, na
--      mesma ordem em que a marcação escolhe os recursos (prioridade da clínica, recurso, vaga). Se não cabe, tenta o
--      próximo horário livre daquele exame;
--   2. o "intervalo mínimo" de uma regra de par só valia entre exames vizinhos. A marcação confere todos os pares
--      (private.agenda_package_check): agora as opções também.
-- E um aviso novo na resposta, para o site ser honesto: same_day_blocked = true quando a clínica tem a regra "não no
-- mesmo dia" entre dois dos exames pedidos (aí não adianta procurar outro dia: é marcar separado).
--
-- Só CREATE OR REPLACE FUNCTION da mesma função (mesma assinatura, mesmas permissões, mesmo tempo-limite de 3 s,
-- mesmas respostas; a resposta 'ok' ganha a chave same_day_blocked). Nenhum dado muda; nenhuma tabela, policy ou
-- permissão muda. Pode rodar de novo sem erro.
-- Conferir na produção depois de aplicar (tem de dar true):
--   select pg_get_functiondef('public.agenda_package_options(uuid,uuid[],date,integer)'::regprocedure) like '%ocupação virtual%'
--      and has_function_privilege('anon', 'public.agenda_package_options(uuid,uuid[],date,integer)', 'EXECUTE')
--      and (select proconfig @> array['statement_timeout=3s'] from pg_proc
--           where oid = 'public.agenda_package_options(uuid,uuid[],date,integer)'::regprocedure);

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

-- Para 2 a 4 procedimentos num dia (hora local da unidade): os inícios livres de cada um (o motor), todas as ordens
-- permitidas pelas regras de par e, para cada início do primeiro, cada exame seguinte no primeiro horário livre dele
-- que (a) respeita o intervalo do paciente e os intervalos mínimos das regras de par com TODOS os exames anteriores e
-- (b) ainda cabe com a ocupação virtual dos exames anteriores do mesmo plano. Ordena por menor espera total, fim mais
-- cedo e início mais cedo; até p_limit opções (padrão 5, no máximo 20). São sugestões: a marcação (agenda_book)
-- confere tudo de novo, tudo ou nada.
create or replace function public.agenda_package_options(p_clinic uuid, p_procedures uuid[], p_day date, p_limit integer default 5)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  v_n integer := coalesce(cardinality(p_procedures), 0);
  v_now timestamptz := now();
  v_tz text;
  v_gap integer;
  v_de timestamptz;
  v_ate timestamptz;
  v_ref timestamptz;
  v_dur integer[];              -- duração de cada procedimento, em minutos
  v_soma integer;
  v_min integer[];              -- intervalo mínimo entre o fim de a e o início de b: posição (a - 1) * n + b
  v_bloq boolean;               -- há regra "não no mesmo dia" entre dois dos procedimentos
  v_div boolean[];              -- o procedimento divide algum recurso com outro do pacote?
  v_s timestamptz[] := '{}';    -- inícios livres de todos os procedimentos, um depois do outro
  v_s_lo integer[] := '{}';
  v_s_hi integer[] := '{}';
  v_lista timestamptz[];
  -- opções de recurso e vaga dos procedimentos que dividem recurso, na ordem em que a marcação escolhe
  -- (procedimento, grupo, prioridade da clínica, recurso, vaga), com o que está livre hoje em cada vaga
  o_g integer[]; o_rid uuid[]; o_seat integer[]; o_free tstzmultirange[];
  o_off integer[]; o_dur integer[]; o_al integer[]; o_setup integer[]; o_cleanup integer[];
  o_antes interval[]; o_depois interval[];
  o_lo integer[] := '{}';
  o_hi integer[] := '{}';
  -- ocupação virtual do plano em construção
  u_rid uuid[] := '{}'; u_seat integer[] := '{}'; u_need tstzrange[] := '{}';
  u_n integer;
  u_antes integer;
  -- candidatos (planos inteiros)
  c_n integer := 0;
  c_espera integer[] := '{}'; c_ini timestamptz[] := '{}'; c_fim timestamptz[] := '{}';
  c_ord integer[] := '{}'; c_t timestamptz[] := '{}';
  v_ord integer[];
  v_t timestamptz[];
  v_fim timestamptz[];
  v_min_t timestamptz;
  v_cand timestamptz;
  v_need tstzrange;
  v_g integer;
  v_achou boolean;
  v_livre boolean;
  v_ok boolean;
  v_lo integer;
  v_hi integer;
  v_meio integer;
  v_idx integer;
  v_opcoes jsonb;
  k integer;
  j integer;
  i integer;
  q integer;
  i0 integer;
begin
  if p_clinic is null or p_day is null or v_n not between 2 and 4
     or (select count(distinct x) from unnest(p_procedures) x where x is not null) <> v_n then
    return jsonb_build_object('status', 'invalid');
  end if;
  for k in 1 .. v_n loop
    if not private.agenda_can_see_slots(p_clinic, p_procedures[k]) then return jsonb_build_object('status', 'not_found'); end if;
  end loop;
  select c.timezone, coalesce(u.patient_gap_min, 0) into v_tz, v_gap
  from public.clinics c left join agenda.unit_settings u on u.clinic_id = c.id where c.id = p_clinic;
  v_dur := array(select p.duration_min::integer from unnest(p_procedures) with ordinality x (id, n)
                 join agenda.procedures p on p.id = x.id order by x.n);
  v_soma := (select sum(d) from unnest(v_dur) d)::integer;

  -- regras de par: "não no mesmo dia" elimina o dia inteiro; o intervalo mínimo vale entre QUALQUER par (a antes de b)
  v_bloq := exists (select 1 from agenda.procedure_pair_rules r
                    where r.rule = 'nao_mesmo_dia' and r.first_procedure = any (p_procedures) and r.second_procedure = any (p_procedures));
  if v_bloq then
    return jsonb_build_object('status', 'ok', 'options', '[]'::jsonb, 'same_day_blocked', true);
  end if;
  v_min := array(select greatest(v_gap, coalesce((select max(r.min_gap_min)::integer from agenda.procedure_pair_rules r
                                                  where r.first_procedure = p_procedures[a] and r.second_procedure = p_procedures[b]
                                                    and r.rule = 'intervalo_min'), 0))
                 from generate_series(1, v_n) a cross join generate_series(1, v_n) b order by a, b);

  -- inícios livres de cada procedimento no dia (o mesmo motor que mostra e marca)
  for k in 1 .. v_n loop
    v_lista := array(select s.slot_start from private.agenda_free_starts(p_clinic, p_procedures[k], p_day, p_day, v_now) s
                     order by s.slot_start);
    if coalesce(cardinality(v_lista), 0) = 0 then
      return jsonb_build_object('status', 'ok', 'options', '[]'::jsonb, 'same_day_blocked', false);
    end if;
    v_s_lo[k] := coalesce(cardinality(v_s), 0) + 1;
    v_s := v_s || v_lista;
    v_s_hi[k] := cardinality(v_s);
  end loop;

  -- quem divide recurso com outro exame do pacote (só esses precisam da ocupação virtual)
  v_div := array(select exists (select 1 from agenda.requirement_options oa
                                join agenda.requirement_options ob on ob.resource_id = oa.resource_id
                                where oa.procedure_id = p_procedures[a] and ob.procedure_id = any (p_procedures)
                                  and ob.procedure_id <> p_procedures[a])
                 from generate_series(1, v_n) a order by a);
  v_de := (p_day::timestamp at time zone v_tz) - interval '1 day';
  v_ate := ((p_day + 1)::timestamp at time zone v_tz) + interval '1 day';
  v_ref := p_day::timestamp at time zone v_tz;
  for k in 1 .. v_n loop
    o_lo[k] := coalesce(cardinality(o_g), 0) + 1;
    if v_div[k] then
      select o_g || coalesce(array_agg(z.g order by z.g, z.prio, z.rid, z.seat), '{}'),
             o_rid || coalesce(array_agg(z.rid order by z.g, z.prio, z.rid, z.seat), '{}'),
             o_seat || coalesce(array_agg(z.seat order by z.g, z.prio, z.rid, z.seat), '{}'),
             o_free || coalesce(array_agg(z.free order by z.g, z.prio, z.rid, z.seat), '{}'),
             o_off || coalesce(array_agg(z.off order by z.g, z.prio, z.rid, z.seat), '{}'),
             o_dur || coalesce(array_agg(z.dur order by z.g, z.prio, z.rid, z.seat), '{}'),
             o_al || coalesce(array_agg(z.al order by z.g, z.prio, z.rid, z.seat), '{}'),
             o_setup || coalesce(array_agg(z.setup order by z.g, z.prio, z.rid, z.seat), '{}'),
             o_cleanup || coalesce(array_agg(z.cleanup order by z.g, z.prio, z.rid, z.seat), '{}'),
             o_antes || coalesce(array_agg(v_ref - lower(z.need) order by z.g, z.prio, z.rid, z.seat), '{}'),
             o_depois || coalesce(array_agg(upper(z.need) - v_ref order by z.g, z.prio, z.rid, z.seat), '{}')
        into o_g, o_rid, o_seat, o_free, o_off, o_dur, o_al, o_setup, o_cleanup, o_antes, o_depois
      from (
        with mapa as materialized (
          select m.resource_id, m.seat, m.free
          from private.agenda_free_map(p_clinic,
                 array(select distinct o.resource_id from agenda.requirement_options o where o.procedure_id = p_procedures[k]),
                 v_de, v_ate, v_now, p_procedures[k]) m
        )
        select g.group_no::integer as g, o.priority::integer as prio, o.resource_id as rid, m.seat::integer as seat, m.free,
               g.offset_min::integer as off, coalesce(g.duration_min, v_dur[k])::integer as dur, g.align_min::integer as al,
               r.setup_min::integer as setup, r.cleanup_min::integer as cleanup,
               private.agenda_need(v_ref, g.offset_min::integer, coalesce(g.duration_min, v_dur[k])::integer, null,
                                   r.setup_min::integer, r.cleanup_min::integer, v_tz) as need
        from agenda.procedure_requirements g
        join agenda.requirement_options o on o.requirement_id = g.id
        join agenda.resources r on r.id = o.resource_id and r.active and r.archived_at is null
        join mapa m on m.resource_id = o.resource_id
        where g.procedure_id = p_procedures[k]
      ) z;
    end if;
    o_hi[k] := coalesce(cardinality(o_g), 0);
  end loop;

  -- todas as ordens (até 24) que respeitam as regras de ordem
  for v_ord in
    with recursive perm (ord) as (
      select array[x] from generate_series(1, v_n) x
      union all
      select perm.ord || x from perm cross join generate_series(1, v_n) x where x <> all (perm.ord) and cardinality(perm.ord) < v_n)
    select perm.ord from perm where cardinality(perm.ord) = v_n order by perm.ord
  loop
    continue when exists (select 1 from agenda.procedure_pair_rules r
                          join generate_subscripts(v_ord, 1) a (ia) on p_procedures[v_ord[ia]] = r.first_procedure
                          join generate_subscripts(v_ord, 1) b (ib) on p_procedures[v_ord[ib]] = r.second_procedure
                          where r.rule = 'ordem' and ia > ib);
    for i0 in v_s_lo[v_ord[1]] .. v_s_hi[v_ord[1]] loop
      u_n := 0;
      v_ok := true;
      for j in 1 .. v_n loop
        k := v_ord[j];
        if j = 1 then
          v_idx := i0;
        else
          -- o mais cedo que as regras deixam: depois do fim de cada exame anterior + o intervalo do par
          v_min_t := null;
          for i in 1 .. j - 1 loop
            v_cand := v_fim[i] + make_interval(mins => v_min[(v_ord[i] - 1) * v_n + k]);
            if v_min_t is null or v_cand > v_min_t then v_min_t := v_cand; end if;
          end loop;
          -- primeiro início livre do exame a partir daí (busca binária na lista ordenada)
          v_lo := v_s_lo[k];
          v_hi := v_s_hi[k] + 1;
          while v_lo < v_hi loop
            v_meio := (v_lo + v_hi) / 2;
            if v_s[v_meio] < v_min_t then v_lo := v_meio + 1; else v_hi := v_meio; end if;
          end loop;
          v_idx := v_lo;
        end if;
        loop
          if v_idx > v_s_hi[k] then v_ok := false; exit; end if;
          exit when not v_div[k];
          -- ocupação virtual: em cada grupo do exame, a primeira vaga (na ordem da marcação) livre hoje e que não
          -- cruza o que os exames anteriores deste plano já reservaram
          u_antes := u_n;
          v_g := null;
          v_achou := false;
          for i in o_lo[k] .. o_hi[k] loop
            if o_g[i] is distinct from v_g then
              exit when v_g is not null and not v_achou;
              v_g := o_g[i];
              v_achou := false;
            end if;
            continue when v_achou;
            if o_al[i] is null then
              v_need := tstzrange(v_s[v_idx] - o_antes[i], v_s[v_idx] + o_depois[i], '[)');
            else
              v_need := private.agenda_need(v_s[v_idx], o_off[i], o_dur[i], o_al[i], o_setup[i], o_cleanup[i], v_tz);
            end if;
            continue when not o_free[i] @> v_need;
            v_livre := true;
            for q in 1 .. u_n loop
              if u_rid[q] = o_rid[i] and u_seat[q] = o_seat[i] and u_need[q] && v_need then v_livre := false; exit; end if;
            end loop;
            if v_livre then
              u_n := u_n + 1;
              u_rid[u_n] := o_rid[i];
              u_seat[u_n] := o_seat[i];
              u_need[u_n] := v_need;
              v_achou := true;
            end if;
          end loop;
          exit when v_achou;
          u_n := u_antes;
          -- o primeiro exame do plano começa no início escolhido (i0) ou o plano não existe
          if j = 1 then v_ok := false; exit; end if;
          v_idx := v_idx + 1;
        end loop;
        exit when not v_ok;
        v_t[j] := v_s[v_idx];
        v_fim[j] := v_s[v_idx] + make_interval(mins => v_dur[k]);
      end loop;
      continue when not v_ok;
      c_n := c_n + 1;
      c_ini[c_n] := v_t[1];
      c_fim[c_n] := v_fim[v_n];
      c_espera[c_n] := (extract(epoch from (v_fim[v_n] - v_t[1])) / 60)::integer - v_soma;
      for j in 1 .. v_n loop
        c_ord[(c_n - 1) * v_n + j] := v_ord[j];
        c_t[(c_n - 1) * v_n + j] := v_t[j];
      end loop;
    end loop;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'items', (select jsonb_agg(jsonb_build_object(
                                'procedure_id', p_procedures[c_ord[(b.n - 1) * v_n + jj]],
                                'starts_at', c_t[(b.n - 1) * v_n + jj],
                                'ends_at', c_t[(b.n - 1) * v_n + jj] + make_interval(mins => v_dur[c_ord[(b.n - 1) * v_n + jj]])) order by jj)
                     from generate_series(1, v_n) jj),
           'wait_min', b.espera, 'starts_at', b.ini, 'ends_at', b.fim) order by b.espera, b.fim, b.ini, b.n), '[]'::jsonb)
    into v_opcoes
  from (select x.espera, x.ini, x.fim, x.n::integer as n
        from unnest(c_espera, c_ini, c_fim) with ordinality x (espera, ini, fim, n)
        order by x.espera, x.fim, x.ini, x.n
        limit least(greatest(coalesce(p_limit, 5), 1), 20)) b;
  return jsonb_build_object('status', 'ok', 'options', v_opcoes, 'same_day_blocked', false);
end $$;

revoke all on function public.agenda_package_options(uuid, uuid[], date, integer) from public, anon, authenticated;
grant execute on function public.agenda_package_options(uuid, uuid[], date, integer) to anon, authenticated;
