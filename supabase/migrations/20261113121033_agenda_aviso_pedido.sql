-- iMed Agenda, fase 4.3 ("Atualização automática e painel gerencial"), 05/11/2026. Arquitetura:
-- memory/projects/imed-agenda-arquitetura.md (§7 tempo real, §14 item 4.3). Volta: supabase/volta/<mesmo nome>.sql.
-- Aplicada na produção em 13/11/2026, com a aprovação do dono (o nome do arquivo é a versão que o banco gravou).
--
-- Em linguagem simples: o painel da clínica agora se atualiza sozinho quando a VERSÃO da agenda da clínica muda
-- (agenda.clinic_versions, subida por private.agenda_touch, que também manda o aviso {v} pelo Realtime). Hoje só as
-- funções da agenda sobem a versão; o pedido novo feito pelo site SEM horário (INSERT direto do visitante, o fluxo
-- antigo) não avisa ninguém, e a aba Pedidos só o vê quando alguém toca em "Atualizar lista"; o mesmo vale para o
-- pedido antigo cancelado pelo paciente (cancel_request) ou respondido por outra pessoa da equipe (set_request_status).
-- Esta migração são só dois gatilhos em appointment_requests: pedido antigo (sem o motor novo) com clínica criado, ou
-- com a situação mudada → sobe a versão da clínica (e sai o mesmo aviso).
--   - só aditiva: nada muda no pedido, nas colunas, nas policies nem nas funções;
--   - só o fluxo antigo (uses_resources = false): as funções da agenda (agenda_book, balcão, cancelar, remarcar...)
--     já sobem a versão como ÚLTIMA instrução (§3.2 item 4.6); tocar também no meio delas travaria a linha da versão
--     antes de planejar (as marcações da mesma clínica passariam a esperar umas às outras, com risco de impasse);
--   - um erro ou uma espera longa no aviso não derruba o pedido: a espera pela linha da versão é curta (lock_timeout
--     de 200 ms, só dentro da função) e o erro cai no bloco EXCEPTION → só um aviso no log; o painel vê o pedido na
--     consulta periódica seguinte;
--   - pedido ao IMED (sem clínica) não mexe em nada;
--   - security definer: o visitante (anon) não tem acesso ao schema agenda; a função grava por ele, com search_path vazio.
-- E uma função de leitura só com um número (revisão da 4.3): agenda_requests_pending_count(clínica) = quantos pedidos
-- esperam resposta ("Aguardando contato"), para o bloco "Precisa de atenção" da aba Agenda. Antes o bloco baixava a
-- lista inteira (até 100 pedidos, com nome e telefone) só para contar, gravava uma leitura de dado de paciente a cada
-- carga e não via o pedido pendente mais antigo que os 100 mais novos. Só o número, sem dado de paciente e sem
-- registro de leitura; mesma permissão da lista (pedidos.ver na clínica, ou a equipe do IMED com imed.pacientes.ver).
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

create or replace function private.agenda_request_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
set lock_timeout = '200ms'
as $$
begin
  -- só o fluxo antigo; o pedido da agenda nova (uses_resources) já sobe a versão no fim da própria função
  if new.clinic_id is not null and not new.uses_resources then
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
  'Fase 4.3: pedido antigo (sem o motor novo, uses_resources = false) criado pelo site (INSERT direto) ou com a situação mudada sobe a versão da agenda da clínica (agenda_touch) para o painel e a aba Pedidos relerem sozinhos. Espera no máximo 200 ms pela linha da versão; erro só vira aviso no log, sem derrubar o pedido.';

drop trigger if exists appointment_requests_aviso on public.appointment_requests;
create trigger appointment_requests_aviso
  after insert on public.appointment_requests
  for each row execute function private.agenda_request_inserted();
-- como as outras guardas da agenda (private.agenda_*): vale sempre, também com session_replication_role = replica
alter table public.appointment_requests enable always trigger appointment_requests_aviso;

-- pedido antigo cancelado pelo paciente (cancel_request) ou respondido pela equipe (set_request_status): a outra
-- recepcionista vê a mudança sem tocar em "Atualizar lista" (os agendamentos da agenda nova já tocam pelas funções)
drop trigger if exists appointment_requests_aviso_situacao on public.appointment_requests;
create trigger appointment_requests_aviso_situacao
  after update of status on public.appointment_requests
  for each row
  when (old.status is distinct from new.status and new.clinic_id is not null and not new.uses_resources)
  execute function private.agenda_request_inserted();
alter table public.appointment_requests enable always trigger appointment_requests_aviso_situacao;

-- Quantos pedidos da clínica esperam resposta ("Aguardando contato"), sem limite e sem dado de paciente (revisão 4.3).
-- Mesmo filtro da lista de pedidos (agenda_requests): sem reserva em andamento ou expirada e sem pedido anonimizado.
create or replace function public.agenda_requests_pending_count(p_clinic uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
begin
  if auth.uid() is null then return jsonb_build_object('status', 'forbidden'); end if;
  -- coalesce: quem não é da clínica tem escopo nulo (e "nulo = 'clinica'" não é falso: seria um furo)
  if not (coalesce(public.clinic_perm_scope(p_clinic, 'pedidos.ver') = 'clinica', false) or public.imed_has('imed.pacientes.ver')) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  return jsonb_build_object('status', 'ok', 'pending',
    (select count(*) from public.appointment_requests a
     where a.clinic_id = p_clinic and a.status = 'pending' and a.anonymized_at is null));
end $$;
revoke all on function public.agenda_requests_pending_count(uuid) from public, anon, authenticated;
grant execute on function public.agenda_requests_pending_count(uuid) to authenticated;
comment on function public.agenda_requests_pending_count(uuid) is
  'Fase 4.3 (revisão): quantos pedidos da clínica esperam resposta, para o bloco "Precisa de atenção". Só o número: sem dado de paciente e sem registro de leitura; mesma permissão da lista de pedidos.';
