-- VOLTA da migração feriados_nacionais (só se for preciso desfazer). Tem o mesmo nome da migração: se ela for renomeada,
-- renomeie esta também. Testada no CI (banco.yml) e no pgTAP 420_feriados_nacionais.sql.
--
-- Retira SÓ os feriados que a migração lançou: os da lista dela (mesmo dia, nome e fonte), sem usuário e com a
-- auditoria "feriado.criar" do motivo migracao_feriados_nacionais. Feriado do mesmo dia lançado pela central fica, e
-- nenhum outro feriado é tocado. É a mesma função que o pgTAP testa (private.agenda_feriados_ate_2027_retirar), e faz o
-- que a retirada pela central faz (agenda_holiday_remove): cada feriado tirado ganha uma linha "feriado.remover" na
-- auditoria (origem sql, motivo volta_feriados_nacionais); os conflitos já abertos e as aberturas "abrimos neste
-- feriado" ficam; as linhas de auditoria não se apagam (trilha só de acréscimo). Depois tira as 3 funções que a
-- migração criou (DROP aqui mesmo, à vista). Pode rodar de novo: sem as funções, não faz nada.
--
-- Atenção: sem feriado nacional lançado, o motor volta a não oferecer horário nenhum (relance pela central, no
-- gestao.html, aba Feriados).
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);
do $$
begin
  if to_regprocedure('private.agenda_feriados_ate_2027_retirar()') is not null then
    perform private.agenda_feriados_ate_2027_retirar();
  end if;
end $$;
drop function if exists private.agenda_feriados_ate_2027_retirar();
drop function if exists private.agenda_feriados_ate_2027_lancar();
drop function if exists private.agenda_feriados_ate_2027();
