-- iMed Agenda: os feriados nacionais que faltam de 2026 (15/11, 20/11 e 25/12) e todos os de 2027, 11/11/2026.
-- Volta: supabase/volta/<mesmo nome>.sql. Teste: supabase/tests/420_feriados_nacionais.sql. As fontes, o que ficou de
-- fora e por quê, e como lançar os de 2028 pela central: memory/context/feriados-nacionais.md.
--
-- MIGRAÇÃO PROVISÓRIA, AINDA NÃO APLICADA NA PRODUÇÃO (o nome também é provisório). Aplicar logo depois da 4.4
-- (20261110190000_agenda_central), com a aprovação do dono. Ao aplicar, renomeie este arquivo e a volta com a versão que
-- o conector gravar (DEPOIS das migrações da 4.3, da 4.4 e da 5.1 que já estiverem aplicadas) e troque
-- ULTIMA_NA_PRODUCAO no .github/workflows/banco.yml. Ela só precisa das tabelas e funções da 3.1, 3.2 e 3.4 (todas na
-- produção desde 04/11): funciona com ou sem a 4.3, a 4.4 e a 5.1.
--
-- Em linguagem simples: o motor de horários só oferece horário até o fim do ano do último feriado nacional lançado
-- (private.agenda_national_until). A produção ainda não tem nenhum: sem esta migração (ou uns 13 lançamentos à mão na
-- central do gestao.html), nenhuma clínica oferece horário, nem a do "Horário direto" (5.1). Esta migração lança, de uma
-- vez, os 13 feriados nacionais de 15/11/2026 a 25/12/2027, cada um com a lei (e, nos de 2026, a portaria federal) que
-- o declara, com o MESMO efeito de lançar um por um na central (função agenda_holiday_save, da 3.2):
--   - o feriado em agenda.holidays: escopo nacional, sem UF nem cidade, o dia, o nome e a fonte (created_by fica vazio:
--     não há usuário numa migração);
--   - para as clínicas com a agenda nova (agenda.unit_settings): a trava EXCLUSIVA de configuração de cada uma, em
--     ordem, antes de gravar; a revalidação dos agendamentos futuros depois de cada feriado (o que cair no feriado vira
--     conflito "grade_mudou", em "Precisa de atenção" da clínica, para remarcar com o paciente); e, no fim, a versão da
--     agenda de cada uma sobe UMA vez (o painel e a central buscam de novo; arquitetura §3.2, passo 6);
--   - uma linha de auditoria "feriado.criar" por feriado, com as mesmas chaves da central (escopo, UF, cidade, dia,
--     clínicas atingidas e conflitos). Sem usuário logado, a origem é "sql" (a "Correção manual" da auditoria da
--     central: a lista de origens de agenda.audit_log não tem "migração") e o motivo é migracao_feriados_nacionais, que
--     diz que a linha veio desta migração.
-- Dia que já tiver feriado nacional (lançado pela central ou por esta migração antes) fica como está: rodar de novo não
-- duplica nem falha. Dia que já passou na hora de aplicar também entra: não muda horário nenhum (o motor e a
-- revalidação só olham o futuro) e fica no registro.
--
-- Os 13 (a fonte de cada um vai junto no feriado; o link oficial de cada lei está na memória):
--   15/11/2026 Proclamação da República ......... Lei 662/1949, art. 1º, com a redação da Lei 10.607/2002
--   20/11/2026 Dia Nacional de Zumbi e da Consciência Negra ... Lei 14.759/2023
--   25/12/2026 Natal ............................. Lei 662/1949 (os três de 2026 também na Portaria MGI 11.460/2025)
--   01/01/2027 Confraternização Universal ....... Lei 662/1949
--   26/03/2027 Sexta-feira da Paixão ............ Lei 9.093/1995, art. 2º; data pela Páscoa de 28/03/2027
--   21/04/2027 Tiradentes ....................... Lei 662/1949
--   01/05/2027 Dia Mundial do Trabalho .......... Lei 662/1949
--   07/09/2027 Independência do Brasil .......... Lei 662/1949
--   12/10/2027 Nossa Senhora Aparecida .......... Lei 6.802/1980
--   02/11/2027 Finados .......................... Lei 662/1949
--   15/11/2027 Proclamação da República ......... Lei 662/1949
--   20/11/2027 Dia Nacional de Zumbi e da Consciência Negra ... Lei 14.759/2023
--   25/12/2027 Natal ............................. Lei 662/1949
-- Sexta-feira da Paixão ENTRA como nacional: a Lei 9.093/1995 (art. 2º) a põe entre os feriados religiosos declarados
-- em lei municipal, mas o calendário federal (Portaria MGI 11.460/2025, que cita essa lei) a trata como "feriado
-- nacional", ela é feriado praticamente no país inteiro e a tela da clínica diz que os nacionais são lançados pelo IMED.
-- Deixar de fora venderia horário num dia em que a clínica está fechada se ela não bloqueasse; lançada, a clínica que
-- atende marca "Abrimos neste feriado" (padrão "fecha", decisão 14).
-- NÃO entram (não são feriado nacional por lei; no calendário federal são ponto facultativo): Carnaval (08 e 09/02/2027),
-- Quarta-feira de Cinzas (10/02/2027) e Corpus Christi (27/05/2027). Onde forem feriado estadual ou municipal, a clínica
-- bloqueia na configuração dela, como os outros estaduais e municipais (holidays_checked_until).
--
-- Ficam no banco 3 funções privadas (só o dono do banco executa; nenhuma é da API), para o CI rodar a MESMA coisa de
-- novo e testar a volta (pgTAP 420_feriados_nacionais.sql) e para a volta usar o mesmo código testado:
--   private.agenda_feriados_ate_2027()          a lista (dia, nome e fonte);
--   private.agenda_feriados_ate_2027_lancar()   lança os que faltam (o que esta migração roda no fim);
--   private.agenda_feriados_ate_2027_retirar()  retira só os que esta migração lançou (usada pela volta).
-- Nada é apagado nem trocado: só CREATE FUNCTION novas, REVOKE e as linhas novas (feriados, auditoria e, se houver
-- clínica com a agenda nova, conflitos e versões). Pode rodar de novo sem erro e sem mudar nada.
--
-- Conferir na produção depois de aplicar (só leitura; tem de dar true; se a central já tiver lançado algum destes dias
-- antes, a 3ª linha conta menos: 13 menos os já lançados):
--   select private.agenda_national_until() = date '2027-12-31'
--      and (select count(*) from agenda.holidays h join private.agenda_feriados_ate_2027() l on l.day = h.day
--           where h.scope = 'nacional') = 13
--      and (select count(*) from agenda.audit_log a
--           where a.action = 'feriado.criar' and a.origin = 'sql' and a.reason_code = 'migracao_feriados_nacionais') = 13
--      and not has_function_privilege('authenticated', 'private.agenda_feriados_ate_2027_lancar()', 'EXECUTE');

/* ===================== 0. Limite de espera ===================== */
-- Se uma clínica estiver no meio de uma marcação ou configuração por mais de 5 s (a trava da agenda dela), a migração
-- desiste (55P03) e nada é aplicado: é só rodar de novo.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. A lista ===================== */
-- Dia, nome e fonte de cada feriado (o nome do calendário federal; a fonte com a lei e o endereço dela no Planalto, sem
-- "https://": função não guarda endereço de internet, guarda do 000_catalogo). Mudar a lista = migração nova.
create or replace function private.agenda_feriados_ate_2027()
returns table (day date, name text, source text)
language sql immutable
set search_path = ''
as $$
  values
    (date '2026-11-15', 'Proclamação da República',
     'Lei 662/1949, art. 1º, com a redação da Lei 10.607/2002 (planalto.gov.br/ccivil_03/leis/l0662.htm); no calendário federal de 2026 (Portaria MGI 11.460/2025)'),
    (date '2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra',
     'Lei 14.759/2023, art. 1º (planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm); no calendário federal de 2026 (Portaria MGI 11.460/2025)'),
    (date '2026-12-25', 'Natal',
     'Lei 662/1949, art. 1º, com a redação da Lei 10.607/2002 (planalto.gov.br/ccivil_03/leis/l0662.htm); no calendário federal de 2026 (Portaria MGI 11.460/2025)'),
    (date '2027-01-01', 'Confraternização Universal',
     'Lei 662/1949, art. 1º, com a redação da Lei 10.607/2002 (planalto.gov.br/ccivil_03/leis/l0662.htm)'),
    (date '2027-03-26', 'Sexta-feira da Paixão',
     'Lei 9.093/1995, art. 2º (planalto.gov.br/ccivil_03/leis/l9093.htm): feriados religiosos, "neste incluída a Sexta-Feira da Paixão"; data pela Páscoa de 28/03/2027; feriado nacional no calendário federal (Portaria MGI 11.460/2025, para 2026)'),
    (date '2027-04-21', 'Tiradentes',
     'Lei 662/1949, art. 1º, com a redação da Lei 10.607/2002 (planalto.gov.br/ccivil_03/leis/l0662.htm)'),
    (date '2027-05-01', 'Dia Mundial do Trabalho',
     'Lei 662/1949, art. 1º, com a redação da Lei 10.607/2002 (planalto.gov.br/ccivil_03/leis/l0662.htm)'),
    (date '2027-09-07', 'Independência do Brasil',
     'Lei 662/1949, art. 1º, com a redação da Lei 10.607/2002 (planalto.gov.br/ccivil_03/leis/l0662.htm)'),
    (date '2027-10-12', 'Nossa Senhora Aparecida',
     'Lei 6.802/1980, art. 1º (planalto.gov.br/ccivil_03/leis/l6802.htm)'),
    (date '2027-11-02', 'Finados',
     'Lei 662/1949, art. 1º, com a redação da Lei 10.607/2002 (planalto.gov.br/ccivil_03/leis/l0662.htm)'),
    (date '2027-11-15', 'Proclamação da República',
     'Lei 662/1949, art. 1º, com a redação da Lei 10.607/2002 (planalto.gov.br/ccivil_03/leis/l0662.htm)'),
    (date '2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra',
     'Lei 14.759/2023, art. 1º (planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm)'),
    (date '2027-12-25', 'Natal',
     'Lei 662/1949, art. 1º, com a redação da Lei 10.607/2002 (planalto.gov.br/ccivil_03/leis/l0662.htm)')
$$;

/* ===================== 2. Lançar ===================== */
-- O mesmo que agenda_holiday_save faz para um feriado nacional, para os da lista que ainda não estão lançados, numa
-- transação só e sem usuário: travas exclusivas das clínicas com a agenda nova (em ordem de id) antes de gravar;
-- feriado; revalidação clínica a clínica (conflito "grade_mudou" para o que deixou de caber); auditoria
-- "feriado.criar" (origem sql, motivo migracao_feriados_nacionais); e, no fim, a versão de cada clínica sobe uma vez
-- (só se algum feriado foi lançado). A marca de origem e o motivo de quem chamou voltam ao que eram.
-- Devolve {status, launched (lançados agora), skipped (já estavam lançados), clinics, conflicts}.
create or replace function private.agenda_feriados_ate_2027_lancar()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_prev_origin text := coalesce(current_setting('imed.origin', true), '');
  v_prev_reason text := coalesce(current_setting('imed.reason', true), '');
  v_clinicas uuid[];
  v_c uuid;
  v_f record;
  v_id uuid;
  v_n integer;
  v_lancados integer := 0;
  v_pulados integer := 0;
  v_conflitos integer := 0;
begin
  -- um feriado nacional vale para todas as clínicas da agenda nova (as mesmas de agenda_holiday_save)
  select coalesce(array_agg(c.id order by c.id), '{}') into v_clinicas
  from agenda.unit_settings u join public.clinics c on c.id = u.clinic_id;
  foreach v_c in array v_clinicas loop
    perform private.agenda_lock_config(v_c, true);
  end loop;
  perform set_config('imed.origin', 'sql', true), set_config('imed.reason', 'migracao_feriados_nacionais', true);
  for v_f in select l.day, l.name, l.source from private.agenda_feriados_ate_2027() l order by l.day loop
    if exists (select 1 from agenda.holidays h where h.scope = 'nacional' and h.day = v_f.day) then
      v_pulados := v_pulados + 1;
      continue;
    end if;
    insert into agenda.holidays (scope, uf, city_ibge, day, name, source, created_by)
    values ('nacional', null, null, v_f.day, v_f.name, v_f.source, null)
    returning id into v_id;
    v_n := 0;
    foreach v_c in array v_clinicas loop
      v_n := v_n + jsonb_array_length(private.agenda_revalidate(v_c, true));
    end loop;
    perform private.agenda_audit(null, 'sql', 'feriado.criar', 'holiday', v_id::text, null,
      jsonb_build_object('scope', 'nacional', 'uf', null, 'city_ibge', null, 'day', v_f.day,
                         'clinicas', cardinality(v_clinicas), 'conflitos', v_n));
    v_lancados := v_lancados + 1;
    v_conflitos := v_conflitos + v_n;
  end loop;
  perform set_config('imed.origin', v_prev_origin, true), set_config('imed.reason', v_prev_reason, true);
  if v_lancados > 0 then
    foreach v_c in array v_clinicas loop
      perform private.agenda_touch(v_c);
    end loop;
  end if;
  return jsonb_build_object('status', 'ok', 'launched', v_lancados, 'skipped', v_pulados,
                            'clinics', cardinality(v_clinicas), 'conflicts', v_conflitos);
end $$;

/* ===================== 3. Retirar (a volta) ===================== */
-- Tira SÓ o que esta migração lançou: feriado nacional da lista (mesmo dia, nome e fonte), sem usuário (created_by
-- vazio) e com a auditoria "feriado.criar" de origem sql e motivo migracao_feriados_nacionais. Um feriado do mesmo dia
-- lançado pela central fica. Como agenda_holiday_remove (a retirada da central): uma linha de auditoria
-- "feriado.remover" por feriado (origem sql, motivo volta_feriados_nacionais), e nada mais (os conflitos abertos e as
-- aberturas em feriado ficam; a auditoria não se apaga). Devolve {status, removed}.
create or replace function private.agenda_feriados_ate_2027_retirar()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_prev_origin text := coalesce(current_setting('imed.origin', true), '');
  v_prev_reason text := coalesce(current_setting('imed.reason', true), '');
  v_h record;
  v_n integer := 0;
begin
  perform set_config('imed.origin', 'sql', true), set_config('imed.reason', 'volta_feriados_nacionais', true);
  for v_h in
    with tirados as (
      delete from agenda.holidays h
      using private.agenda_feriados_ate_2027() l
      where h.scope = 'nacional' and h.day = l.day and h.name = l.name and h.source = l.source and h.created_by is null
        and exists (select 1 from agenda.audit_log a
                    where a.action = 'feriado.criar' and a.object_type = 'holiday' and a.object_id = h.id::text
                      and a.origin = 'sql' and a.reason_code = 'migracao_feriados_nacionais')
      returning h.id, h.scope, h.uf, h.city_ibge, h.day
    )
    select * from tirados t order by t.day
  loop
    perform private.agenda_audit(null, 'sql', 'feriado.remover', 'holiday', v_h.id::text,
      jsonb_build_object('scope', v_h.scope, 'uf', v_h.uf, 'city_ibge', v_h.city_ibge, 'day', v_h.day), null);
    v_n := v_n + 1;
  end loop;
  perform set_config('imed.origin', v_prev_origin, true), set_config('imed.reason', v_prev_reason, true);
  return jsonb_build_object('status', 'ok', 'removed', v_n);
end $$;

revoke all on function private.agenda_feriados_ate_2027() from public, anon, authenticated, service_role;
revoke all on function private.agenda_feriados_ate_2027_lancar() from public, anon, authenticated, service_role;
revoke all on function private.agenda_feriados_ate_2027_retirar() from public, anon, authenticated, service_role;

/* ===================== 4. Lançar agora ===================== */
select private.agenda_feriados_ate_2027_lancar();
