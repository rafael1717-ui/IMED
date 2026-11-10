-- VOLTA da migração agenda_central (iMed Agenda, fase 4.4; só se for preciso desfazer). Tem o mesmo nome da migração:
-- se ela for renomeada, renomeie esta também. Tira só as funções novas da Central (agenda_central_*). O que a equipe
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
