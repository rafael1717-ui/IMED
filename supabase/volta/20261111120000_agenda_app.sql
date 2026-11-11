-- VOLTA da migração agenda_app (iMed Agenda, fase 5.1; só se for preciso desfazer). Tem o mesmo nome da migração: se
-- ela for renomeada, renomeie esta também. Tira a função nova do "próximo horário livre" e devolve as 4 leituras
-- públicas ao limite de tempo do papel (sem o da função). Nada de dado muda: a migração não grava nada.
-- Antes de desfazer, volte o site do paciente para a versão anterior (sem agenda_next_free, a lista só deixa de mostrar
-- o "próximo horário livre"; a marcação pelo motor continua com agenda_book, que já existia). Testada no CI (banco.yml).
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);
alter function public.clinics_with_schedule(uuid[]) reset statement_timeout;
alter function public.available_slots(uuid, text, date, integer) reset statement_timeout;
alter function public.agenda_my_booking(uuid, text) reset statement_timeout;
alter function public.agenda_public_info(uuid) reset statement_timeout;
drop function if exists public.agenda_next_free(uuid[], text, integer);
