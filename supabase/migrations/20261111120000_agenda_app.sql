-- iMed Agenda, fase 5.1 ("Horário direto": o paciente marca o horário sozinho), 11/11/2026. Arquitetura:
-- memory/projects/imed-agenda-arquitetura.md (§4 funções públicas e limites, §14 item 5.1).
-- Volta: supabase/volta/<mesmo nome>.sql.
-- NOME PROVISÓRIO (ainda não aplicada na produção): ao aplicar, siga os 5 passos de "Ao aplicar uma migração provisória
-- na produção" do .github/workflows/banco.yml (renomear esta e a volta com a versão que o conector gravar, tirar esta
-- marca, tirar o nome de PENDENTES_NA_PRODUCAO, renomear as outras provisórias para depois dela e trocar
-- ULTIMA_NA_PRODUCAO). Ela precisa ficar DEPOIS das migrações da 4.3 (20261105190000_agenda_aviso_pedido), da 4.4
-- (20261110190000_agenda_central) e dos feriados nacionais (20261111130000_feriados_nacionais; sem feriado nacional
-- lançado o motor não oferece horário), também provisórias: se alguma for aplicada com versão maior que esta, o passo 4
-- de lá já manda renomear esta (e a volta) para depois dela.
--
-- Em linguagem simples: o site do paciente passa a marcar pelo motor novo (agenda_public_info, agenda_slots e
-- agenda_book já existem desde a 3.2 e a 3.3). Faltava só:
--   1. agenda_next_free(clínicas, exame, dias)   o "próximo horário livre" de até 10 clínicas de uma vez, para a lista
--                                    da busca: para no primeiro horário livre de cada clínica, dia a dia, até 14 dias.
--                                    Só clínica que vende horário online agora (publicada, aceita pedidos, não é de
--                                    demonstração, com a agenda nova e a venda ligada) e só procedimento à venda. Sem
--                                    dado de paciente (só o horário). Pedido grande demais não vira trabalho grande:
--                                    mais de 10 clínicas → só as 10 primeiras; dias fora de 1 a 14 → o mais perto disso;
--                                    código de exame estranho → nada. Vem junto a modalidade da agenda (nativa,
--                                    manual...), para a lista mostrar o selo honesto de cada uma;
--   2. tempo-limite por função nas leituras públicas que ainda não tinham (agenda_public_info, agenda_my_booking,
--      available_slots, clinics_with_schedule: 2 s). Pela API o PostgREST aplica o statement_timeout da própria função
--      na transação da chamada (configuração "hoisted" do PostgREST 12+), como já acontece com agenda_slots, agenda_days
--      e agenda_package_options. A marcação (agenda_book) fica com o limite do papel (3 s visitante, 8 s com conta),
--      que a prova de concorrência do CI já usa.
--
-- Nada aqui muda regra nem dado: uma função nova (CREATE FUNCTION, REVOKE, GRANT) e ALTER FUNCTION ... SET
-- statement_timeout em 4 funções existentes (a volta tira). Nenhuma clínica passa a vender online por causa desta
-- migração: a venda continua desligada em todas (agenda_online_since nulo) até a clínica piloto ser ligada (decisão 24).
-- Pode rodar de novo sem erro.
-- Conferir na produção depois de aplicar (tem de dar true):
--   select has_function_privilege('anon', 'public.agenda_next_free(uuid[],text,integer)', 'EXECUTE')
--      and (select proconfig @> array['statement_timeout=2s'] from pg_proc where oid = 'public.agenda_public_info(uuid)'::regprocedure)
--      and (select proconfig @> array['statement_timeout=2s'] from pg_proc where oid = 'public.available_slots(uuid,text,date,integer)'::regprocedure);

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Próximo horário livre (lista da busca) ===================== */
-- Para cada clínica pedida (até 10), o primeiro horário livre de hoje (no fuso da unidade) até p_days dias (1 a 14).
-- p_exam: código do exame (rm, usg...); com ele, só o procedimento padrão desse exame (ou, se a clínica não marcou um
-- padrão, todos os desse exame); sem ele, até 6 procedimentos à venda da clínica. Usa o mesmo motor que mostra e marca
-- (private.agenda_free_starts) em duas janelas — hoje; depois, de amanhã até p_days — e para na primeira com horário:
-- no máximo 2 consultas ao motor por procedimento, mesmo numa clínica lotada (medido no CI: tests/banco/desempenho.mjs,
-- 10 clínicas, 9 delas lotadas). Devolve uma linha por clínica com horário; clínica sem horário no prazo (ou que não
-- vende online) não aparece.
create or replace function public.agenda_next_free(p_clinics uuid[], p_exam text default null, p_days integer default 14)
returns table (clinic_id uuid, procedure_id uuid, exam_code text, slot_start timestamptz, slot_end timestamptz, timezone text,
               agenda_mode text)
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  v_ids uuid[];
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 14);
  c record;
  v_procs uuid[];
  v_day date;
  v_best record;
  k integer;
begin
  if p_clinics is null or cardinality(p_clinics) = 0 then return; end if;
  if p_exam is not null and p_exam !~ '^[a-z_]{1,20}$' then return; end if;
  -- limite do tamanho da pergunta: as 10 primeiras clínicas distintas, na ordem pedida
  v_ids := array(select x.id from unnest(p_clinics) with ordinality x (id, n)
                 where x.id is not null group by x.id order by min(x.n) limit 10);
  for c in
    select cl.id, cl.timezone, cl.agenda_mode
    from public.clinics cl
    join agenda.unit_settings u on u.clinic_id = cl.id
    where cl.id = any (v_ids) and cl.status = 'published' and cl.accepts_online_booking and not cl.is_demo
      and cl.agenda_online_since is not null
    order by array_position(v_ids, cl.id)
  loop
    v_procs := array(
      select p.id from agenda.procedures p
      where p.clinic_id = c.id and p.active and p.archived_at is null and p.online_booking
        and exists (select 1 from agenda.procedure_requirements g where g.procedure_id = p.id)
        and (p_exam is null or p.exam_code = p_exam)
        and (p_exam is null or p.default_for_exam
             or not exists (select 1 from agenda.procedures d
                            where d.clinic_id = c.id and d.exam_code = p_exam and d.default_for_exam and d.active
                              and d.archived_at is null and d.online_booking))
      order by p.exam_code, p.name, p.id
      limit 6);
    continue when cardinality(v_procs) = 0;
    v_day := (now() at time zone c.timezone)::date;
    -- atalho: procedimento cujos recursos não têm NENHUM tempo livre de agora até o fim do prazo (+1 dia, para caber o
    -- exame que começa no último dia) — clínica lotada, fechada ou em manutenção — nem passa pelo motor. É só um filtro
    -- (todo horário começa depois de agora e precisa de recurso livre nesse intervalo); quem passa vai para o motor.
    v_procs := array(
      select f.pid from unnest(v_procs) with ordinality f (pid, ord)
      where exists (select 1 from private.agenda_free_map(c.id,
                                    array(select o.resource_id from agenda.requirement_options o where o.procedure_id = f.pid),
                                    now(), (v_day + v_days + 1)::timestamp at time zone c.timezone, now(), f.pid, '{}') m
                    where not isempty(m.free))
      order by f.ord);
    continue when cardinality(v_procs) = 0;
    -- janelas [hoje] e [amanhã, hoje + p_days - 1]
    foreach k in array array[0, 1] loop
      exit when k > v_days - 1;
      select f.pid, s.slot_start, s.slot_end into v_best
      from unnest(v_procs) with ordinality f (pid, ord)
      cross join lateral private.agenda_free_starts(c.id, f.pid, v_day + k, v_day + k * (v_days - 1), now(), null) s
      order by s.slot_start, f.ord
      limit 1;
      if found then
        clinic_id := c.id;
        procedure_id := v_best.pid;
        exam_code := (select p.exam_code from agenda.procedures p where p.id = v_best.pid);
        slot_start := v_best.slot_start;
        slot_end := v_best.slot_end;
        timezone := c.timezone;
        agenda_mode := c.agenda_mode;
        return next;
        exit;
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.agenda_next_free(uuid[], text, integer) from public, anon, authenticated;
grant execute on function public.agenda_next_free(uuid[], text, integer) to anon, authenticated;
comment on function public.agenda_next_free(uuid[], text, integer) is
  'Próximo horário livre de até 10 clínicas (até 14 dias), para a lista da busca. Só clínica com a venda online ligada; sem dado de paciente.';

/* ===================== 2. Tempo-limite nas leituras públicas ===================== */
alter function public.agenda_public_info(uuid) set statement_timeout = '2s';
alter function public.agenda_my_booking(uuid, text) set statement_timeout = '2s';
alter function public.available_slots(uuid, text, date, integer) set statement_timeout = '2s';
alter function public.clinics_with_schedule(uuid[]) set statement_timeout = '2s';
