-- VOLTA da migração agenda_central (iMed Agenda, fase 4.4; só se for preciso desfazer). Tem o mesmo nome da migração:
-- se ela for renomeada, renomeie esta também. Tira só as funções novas da Central (agenda_central_*) e põe de volta a
-- agenda_holiday_remove da 3.2 (20261103013510_agenda_motor_parte_2), letra por letra. O que a equipe
-- gravou por elas FICA, porque são dados em tabelas da 3.1: os papéis em private.imed_staff, os parâmetros em
-- agenda.settings_global e as linhas da auditoria. Os feriados continuam com as funções da 3.2. Testada no CI (banco.yml).
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);
drop function if exists public.agenda_central_staff_revoke(uuid, text);
drop function if exists public.agenda_central_staff_grant(text, text);
drop function if exists public.agenda_central_staff();
drop function if exists public.agenda_central_holiday_preview(date);
drop function if exists public.agenda_central_holidays();
drop function if exists public.agenda_central_setting_set(text, integer);
drop function if exists public.agenda_central_settings();
drop function if exists private.agenda_central_params();
drop function if exists public.agenda_central_audit(jsonb);
drop function if exists public.agenda_central_conflicts(boolean);
drop function if exists public.agenda_central_overview();
drop function if exists public.agenda_central_version();
-- agenda_holiday_remove como na 3.2 (sem fechar os conflitos do feriado retirado); mesmas permissões, sem comentário
-- Tira um feriado lançado por engano (só libera horários; nada a revalidar).
create or replace function public.agenda_holiday_remove(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h agenda.holidays;
begin
  if not public.imed_has('imed.feriados.editar') then return jsonb_build_object('status', 'forbidden'); end if;
  delete from agenda.holidays h where h.id = p_id returning * into v_h;
  if v_h.id is null then return jsonb_build_object('status', 'not_found'); end if;
  perform private.agenda_audit(null, 'central', 'feriado.remover', 'holiday', v_h.id::text,
    jsonb_build_object('scope', v_h.scope, 'uf', v_h.uf, 'city_ibge', v_h.city_ibge, 'day', v_h.day), null);
  return jsonb_build_object('status', 'ok');
end $$;
revoke all on function public.agenda_holiday_remove(uuid) from public, anon, authenticated;
grant execute on function public.agenda_holiday_remove(uuid) to authenticated;
comment on function public.agenda_holiday_remove(uuid) is null;
