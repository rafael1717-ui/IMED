-- iMed Pagamentos, fase P1: parte 5 de 5 (a ÚNICA com DROP, pequena e aplicada por último; o conector pede a aprovação do
-- dono). O cabeçalho, com o que a migração faz e as conferências, está na parte 1. Volta ÚNICA das 5 partes:
-- supabase/volta/<versão>_pagamentos_base_parte_5.sql (este mesmo nome).
--
-- NOME PROVISÓRIO (ainda não aplicada na produção): os 5 passos de "Ao aplicar uma migração provisória na produção" do
-- .github/workflows/banco.yml valem para cada parte (veja o cabeçalho da parte 1).
--
-- Em linguagem simples: nada de dado é apagado. Uma restrição de agenda.unit_settings é trocada por outra MAIS LARGA
-- (§4.6): o modo de pagamento da unidade, que só aceitava "no_local", passa a aceitar também "online". Todas as unidades
-- continuam em "no_local" (o valor de hoje continua valendo) e nenhuma função da agenda grava essa coluna. Junto, duas
-- guardas para o "online" nunca ficar solto:
--   1. a unidade só fica "online" com a conta da clínica ATIVA em pagamentos.clinic_accounts (qualquer caminho de
--      escrita, inclusive o SQL de emergência);
--   2. conta que deixa de estar ativa leva a unidade de volta a "no_local" na mesma transação.
-- Pode rodar de novo sem erro e sem mudar nada.

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

alter table agenda.unit_settings drop constraint if exists unit_settings_payment_mode_check;
alter table agenda.unit_settings add constraint unit_settings_payment_mode_check
  check (payment_mode in ('no_local', 'online'));

create or replace function private.pag_unit_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_mode = 'online'
     and not exists (select 1 from pagamentos.clinic_accounts a where a.clinic_id = new.clinic_id and a.situacao = 'ativa') then
    raise exception 'unidade %: pagamento online só com a conta da clínica ativa no meio de pagamento', new.clinic_id
      using errcode = '23514', hint = 'A clínica liga o recebimento (pag_clinic_connect) e a equipe do IMED confere (admin_pag_conta_conferir).';
  end if;
  return new;
end $$;

create or replace function private.pag_clinic_accounts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.situacao <> 'ativa' then
    update agenda.unit_settings u set payment_mode = 'no_local', updated_at = now()
    where u.clinic_id = new.clinic_id and u.payment_mode <> 'no_local';
  end if;
  return null;
end $$;

revoke all on function private.pag_unit_settings_guard() from public, anon, authenticated, service_role;
revoke all on function private.pag_clinic_accounts_guard() from public, anon, authenticated, service_role;

create or replace trigger unit_settings_pag
  before insert or update of payment_mode on agenda.unit_settings
  for each row execute function private.pag_unit_settings_guard();
create or replace trigger clinic_accounts_guard
  after update of situacao on pagamentos.clinic_accounts
  for each row when (old.situacao is distinct from new.situacao) execute function private.pag_clinic_accounts_guard();
alter table agenda.unit_settings enable always trigger unit_settings_pag;
alter table pagamentos.clinic_accounts enable always trigger clinic_accounts_guard;
