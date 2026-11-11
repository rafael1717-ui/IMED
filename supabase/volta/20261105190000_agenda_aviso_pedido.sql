-- VOLTA da migração agenda_aviso_pedido (iMed Agenda, fase 4.3; só se for preciso desfazer). Tem o mesmo nome da
-- migração: se ela for renomeada, renomeie esta também. Tira só os dois gatilhos e a função deles; as versões já gravadas em
-- agenda.clinic_versions ficam (são dados, e as funções da agenda continuam a usá-las). Testada no CI (banco.yml).
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);
drop trigger if exists appointment_requests_aviso_situacao on public.appointment_requests;
drop trigger if exists appointment_requests_aviso on public.appointment_requests;
drop function if exists private.agenda_request_inserted();
