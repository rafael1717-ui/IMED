-- VOLTA da migração agenda_avisos (iMed Agenda, fase 5.3; só se for preciso desfazer). Tem o mesmo nome da migração: se
-- ela for renomeada, renomeie esta também. Tira o cron imed-agenda-saida, o gatilho appointment_requests_avisos, as
-- funções agenda_notify_* e agenda_central_avisos e as duas tabelas (agenda.notifications e agenda.notification_rules:
-- os avisos e as escolhas gravadas somem com elas; nenhum agendamento muda) e devolve private.agenda_central_params ao
-- texto da 4.4 (sem o parâmetro avisos.envio_ligado; a linha dele em agenda.settings_global, se houver, é apagada).
-- Antes de desfazer: desligar o envio (parâmetro em 0) e voltar o site para a versão sem o bloco "Avisos".
-- Testada no CI (banco.yml): desfeita, o banco fica igual ao da produção.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

select cron.unschedule(jobid) from cron.job where jobname = 'imed-agenda-saida';

drop trigger if exists appointment_requests_avisos on public.appointment_requests;

drop function if exists public.agenda_central_avisos();
drop function if exists public.agenda_notify_list(uuid);
drop function if exists public.agenda_notify_config_set(uuid, jsonb);
drop function if exists public.agenda_notify_config(uuid);
drop function if exists public.agenda_notify_done(uuid, text, text, text);
drop function if exists public.agenda_notify_claim(integer);
drop function if exists private.agenda_notify_tick();
drop function if exists private.agenda_notify_choices();
drop function if exists private.agenda_notify_sending();
drop function if exists private.agenda_notify_take(integer, boolean);
drop function if exists private.agenda_notify_request();
drop function if exists private.agenda_notify_reminders(uuid, uuid, timestamptz, timestamptz);
drop function if exists private.agenda_notify_add(uuid, uuid, text, text, timestamptz, timestamptz);
drop function if exists private.agenda_notify_consent(boolean, text[], text);
drop function if exists private.agenda_notify_on(uuid, text, text, text);
drop function if exists private.agenda_notify_channels();

drop table if exists agenda.notifications;
drop table if exists agenda.notification_rules;

delete from agenda.settings_global where key = 'avisos.envio_ligado';

-- private.agenda_central_params como na 4.4 (20261113121245_agenda_central)
create or replace function private.agenda_central_params()
returns table (key text, def integer, min integer, max integer)
language sql immutable
set search_path = ''
as $$
  values ('agenda.limite_futuros_por_telefone'::text, 3, 1, 20);
$$;
revoke all on function private.agenda_central_params() from public, anon, authenticated, service_role;
