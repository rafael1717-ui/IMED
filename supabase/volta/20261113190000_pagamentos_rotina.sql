-- VOLTA da migração pagamentos_rotina (iMed Pagamentos, fase P2a; só se for preciso desfazer). Tem o mesmo nome da
-- migração: se ela for renomeada, renomeie esta também. Tira os dois jobs do pg_cron, as três funções novas e o token
-- interno "pagamentos". Nenhum dado de pagamento muda (a migração não grava nenhum). Vem ANTES da volta da P1
-- (pagamentos_base_parte_5), que apaga o schema pagamentos. Antes de desfazer, tire do ar a Edge Function
-- pagamento-rotina (sem o job ninguém a chama) e a ação "conferir" da pagamento-criar (usa pag_charge_lookup).
-- Testada no CI (banco.yml): depois dela a impressão digital do banco é igual à de antes, e reaplicada, igual à com ela.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);
select cron.unschedule('imed-pagamentos-rotina') where exists (select 1 from cron.job where jobname = 'imed-pagamentos-rotina');
select cron.unschedule('imed-pagamentos-conciliacao') where exists (select 1 from cron.job where jobname = 'imed-pagamentos-conciliacao');
drop function if exists public.pag_charge_lookup(uuid, text);
drop function if exists private.pag_rotina_chamar(boolean);
drop function if exists private.pag_tem_trabalho(boolean);
delete from private.app_tokens where name = 'pagamentos';
