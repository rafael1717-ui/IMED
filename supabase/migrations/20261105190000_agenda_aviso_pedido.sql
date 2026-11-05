-- iMed Agenda, fase 4.3 ("Atualização automática e painel gerencial"), 05/11/2026. Arquitetura:
-- memory/projects/imed-agenda-arquitetura.md (§7 tempo real, §14 item 4.3). Volta: supabase/volta/<mesmo nome>.sql.
-- NOME PROVISÓRIO (ainda não aplicada na produção): ao aplicar, renomeie este arquivo e a volta com a versão que o
-- conector gravar; se a parte 2 da 4.2 (20261105050258_agenda_leitura_parte_2, também provisória) ainda não tiver
-- sido aplicada, renomeie-a (e a volta dela) para uma versão DEPOIS desta.
--
-- Em linguagem simples: o painel da clínica agora se atualiza sozinho quando a VERSÃO da agenda da clínica muda
-- (agenda.clinic_versions, subida por private.agenda_touch, que também manda o aviso {v} pelo Realtime). Hoje só as
-- funções da agenda sobem a versão; o pedido novo feito pelo site SEM horário (INSERT direto do visitante, o fluxo
-- antigo) não avisa ninguém, e a aba Pedidos só o vê quando alguém toca em "Atualizar lista". Esta migração é só um
-- gatilho AFTER INSERT em appointment_requests: pedido com clínica → sobe a versão da clínica (e sai o mesmo aviso).
--   - só aditiva: nada muda no pedido, nas colunas, nas policies nem nas funções;
--   - um erro no aviso NUNCA derruba o pedido (bloco EXCEPTION → só um aviso no log);
--   - pedido ao IMED (sem clínica) não mexe em nada;
--   - security definer: o visitante (anon) não tem acesso ao schema agenda; a função grava por ele, com search_path vazio.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

create or replace function private.agenda_request_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.clinic_id is not null then
    begin
      perform private.agenda_touch(new.clinic_id);
    exception when others then
      raise warning 'agenda_request_inserted: aviso da agenda não enviado (%: %)', sqlstate, sqlerrm;
    end;
  end if;
  return null;
end $$;
revoke all on function private.agenda_request_inserted() from public, anon, authenticated, service_role;
comment on function private.agenda_request_inserted() is
  'Fase 4.3: pedido novo pelo site (INSERT direto) sobe a versão da agenda da clínica (agenda_touch) para o painel e a aba Pedidos relerem sozinhos. Nunca derruba o pedido.';

drop trigger if exists appointment_requests_aviso on public.appointment_requests;
create trigger appointment_requests_aviso
  after insert on public.appointment_requests
  for each row execute function private.agenda_request_inserted();
