-- iMed Agenda, fase 5.3 ("Avisos": confirmação, cancelamento, remarcação e lembretes de 24 h e de 2 h), 13/11/2026.
-- Arquitetura: memory/projects/imed-agenda-arquitetura.md (§10 Notificações, §8 "fila de saída", §14 item 5.3).
-- Volta: supabase/volta/<mesmo nome>.sql (tira tudo o que esta migração cria; os avisos gravados somem com a tabela).
-- NOME PROVISÓRIO, AINDA NÃO APLICADA NA PRODUÇÃO (13/11/2026; ao aplicar, tire esta marca): só entra com a
-- aprovação do dono. Ao aplicar, siga os 5 passos de "Ao aplicar uma migração provisória na produção" do
-- .github/workflows/banco.yml (renomear esta e a volta com a versão que o conector gravar, tirar esta marca, tirar o
-- nome de PENDENTES_NA_PRODUCAO, renomear as outras provisórias para depois dela e trocar ULTIMA_NA_PRODUCAO).
--
-- Em linguagem simples: quando um agendamento da agenda nova é confirmado, cancelado, remarcado ou precisa ser
-- remarcado, o banco passa a PREPARAR os avisos (para o paciente e para a clínica) e os lembretes de 24 h e de 2 h
-- antes. Preparar não é enviar: o envio é da função do servidor "agenda-saida" (supabase/functions/agenda-saida), que
-- NÃO está publicada, e fica desligado por um parâmetro (avisos.envio_ligado, padrão 0). Com o envio desligado, o aviso
-- que chega à hora é fechado como "sem_canal" — nunca como "enviada". Nada muda para o paciente nem para a clínica
-- até o dono liberar um canal (e-mail do IMED; WhatsApp depois).
--   1. agenda.notifications          cada aviso: evento, canal, para quem (paciente ou clínica), quando enviar e a
--                                    situação (agendada, enviando, enviada, falhou, cancelada, sem_canal,
--                                    sem_consentimento, sem_contato). SEM e-mail e SEM telefone: o destino é lido do
--                                    pedido (ou do cadastro da clínica) só na hora do envio (minimização, §10);
--   2. agenda.notification_rules     o que a clínica desligou: lembrete de 24 h, lembrete de 2 h (paciente) e os
--                                    avisos para a própria clínica. Sem linha = padrão (ligado). Os avisos do paciente
--                                    sobre o próprio agendamento (confirmado, cancelado, remarcado, "a clínica
--                                    precisou alterar") não se desligam;
--   3. gatilho appointment_requests_avisos (depois de INSERT ou de UPDATE da situação ou do horário, só no pedido da
--      agenda nova): prepara os avisos e cancela os lembretes que perderam o sentido. Um erro aqui NUNCA derruba a
--      marcação (bloco EXCEPTION → só um aviso no log);
--   4. a fila: agenda_notify_claim (pega os vencidos, o mais antigo de cada agendamento primeiro, com FOR UPDATE SKIP
--      LOCKED; confere NA HORA se o agendamento continua confirmado e no mesmo horário, o consentimento e se há
--      destino) e agenda_notify_done (enviada, sem_canal ou falhou; novas tentativas em 1 min, 5 min, 15 min, 1 h e
--      6 h; depois de 10, "falhou"). Só o servidor (service_role) chama;
--   5. cron imed-agenda-saida (a cada minuto): se não há aviso vencido, não faz nada; com o envio desligado, fecha os
--      vencidos como sem_canal; com o envio ligado (parâmetro + endereço das funções + token), chama a função do servidor;
--   6. painel da clínica: agenda_notify_config e agenda_notify_config_set (agenda.configurar; fica na auditoria) e
--      agenda_notify_list (os avisos de um agendamento, para quem vê a agenda; sem dado de paciente);
--   7. central do IMED: agenda_central_avisos (só contagens e códigos; imed.agenda.monitor) e o parâmetro
--      avisos.envio_ligado em private.agenda_central_params (só o administrador muda, pela função da 4.4).
-- Escolhas onde o desenho era aberto (o dono pode mudar; arquitetura §14, 5.3-a…f): a fila é a própria tabela dos avisos
-- (agenda.outbox, genérica, nasce com os webhooks da 6.1); só o canal "email" é preparado (os outros nascem com o
-- canal); regra por clínica (por exame fica para depois); o e-mail ao paciente sobre o PRÓPRIO agendamento usa o
-- consentimento da marcação ("entrar em contato comigo sobre este agendamento"); WhatsApp, SMS e push exigem o
-- consentimento do canal (notify_channels), que o site ainda não colhe.
--
-- Só aditiva: nenhuma tabela, coluna, policy ou permissão existente muda. Uma função existente é trocada
-- (private.agenda_central_params ganha um parâmetro; a volta a devolve). Pode rodar de novo sem erro.
-- Conferir na produção depois de aplicar (tem de dar true):
--   select to_regclass('agenda.notifications') is not null and to_regclass('agenda.notification_rules') is not null
--      and exists (select 1 from pg_trigger where tgrelid = 'public.appointment_requests'::regclass
--                  and tgname = 'appointment_requests_avisos' and tgenabled = 'A')
--      and (select count(*) from cron.job where jobname = 'imed-agenda-saida') = 1
--      and private.agenda_setting_int('avisos.envio_ligado', 0) = 0
--      and not has_function_privilege('authenticated', 'public.agenda_notify_claim(integer)', 'EXECUTE');
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

/* ===================== 1. Tabelas ===================== */
create table if not exists agenda.notifications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  clinic_id uuid not null,
  event_type text not null check (event_type in ('confirmado', 'pagamento_aprovado', 'pagamento_nao_concluido', 'cancelado',
    'remarcado', 'lembrete_24h', 'lembrete_2h', 'alterado_pela_clinica', 'orientacoes_preparo')),
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'push')),
  recipient_kind text not null check (recipient_kind in ('paciente', 'clinica')),
  send_after timestamptz not null,
  slot_start timestamptz,                              -- o horário do agendamento quando o aviso nasceu
  status text not null default 'agendada' check (status in ('agendada', 'enviando', 'enviada', 'falhou', 'cancelada',
    'sem_canal', 'sem_consentimento', 'sem_contato')),
  attempts smallint not null default 0 check (attempts between 0 and 10),
  next_try_at timestamptz not null,
  claimed_at timestamptz,
  last_error text check (last_error is null or last_error ~ '^[a-z0-9_.:-]{1,60}$'),   -- código, nunca texto livre
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  created_at timestamptz not null default clock_timestamp(),   -- o relógio de verdade: avisos da mesma transação ficam em ordem
  sent_at timestamptz,
  closed_at timestamptz,
  constraint notifications_request_fk foreign key (request_id, clinic_id)
    references public.appointment_requests (id, clinic_id) on delete cascade,
  constraint notifications_uq unique (request_id, event_type, channel, recipient_kind, send_after),
  constraint notifications_fechada_ck check ((status in ('agendada', 'enviando')) = (closed_at is null)),
  constraint notifications_enviada_ck check ((status = 'enviada') = (sent_at is not null))
);
create index if not exists notifications_fila_idx on agenda.notifications (next_try_at) where status in ('agendada', 'enviando');
create index if not exists notifications_pedido_idx on agenda.notifications (request_id);
create index if not exists notifications_clinica_idx on agenda.notifications (clinic_id, created_at);

create table if not exists agenda.notification_rules (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  event_type text not null check (event_type in ('confirmado', 'cancelado', 'lembrete_24h', 'lembrete_2h')),
  recipient_kind text not null check (recipient_kind in ('paciente', 'clinica')),
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'push')),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (clinic_id, event_type, recipient_kind, channel),
  -- só o que a clínica pode escolher: os lembretes do paciente e os avisos para a própria clínica
  constraint notification_rules_escolha_ck check (
    (recipient_kind = 'paciente' and event_type in ('lembrete_24h', 'lembrete_2h'))
    or (recipient_kind = 'clinica' and event_type in ('confirmado', 'cancelado')))
);

-- Ninguém da API lê nem escreve (como as outras tabelas da agenda): RLS ligada, sem policy, sem permissão.
alter table agenda.notifications enable row level security;
alter table agenda.notification_rules enable row level security;
revoke all on table agenda.notifications, agenda.notification_rules from public, anon, authenticated, service_role;

comment on table agenda.notifications is
  'Fase 5.3: avisos e lembretes preparados para um agendamento da agenda nova. Sem e-mail e sem telefone: o destino é lido na hora do envio. A fila de envio é esta tabela (status agendada/enviando + next_try_at).';
comment on table agenda.notification_rules is
  'Fase 5.3: o que a clínica desligou ou ligou nos avisos (lembretes do paciente e avisos para a clínica). Sem linha = padrão (ligado).';

/* ===================== 2. Regras e parâmetros ===================== */
-- Os canais que o banco prepara hoje. WhatsApp, SMS e push entram aqui quando o canal existir.
create or replace function private.agenda_notify_channels()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['email']::text[] $$;

-- A regra em vigor: o que a clínica gravou, ou o padrão (ligado).
create or replace function private.agenda_notify_on(p_clinic uuid, p_event text, p_recipient text, p_channel text)
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((select r.enabled from agenda.notification_rules r
                   where r.clinic_id = p_clinic and r.event_type = p_event and r.recipient_kind = p_recipient
                     and r.channel = p_channel), true);
$$;

-- O paciente autorizou este canal? O e-mail sobre o PRÓPRIO agendamento vale pelo consentimento da marcação ("entrar em
-- contato comigo sobre este agendamento"); os outros canais só com o consentimento do canal (notify_channels).
create or replace function private.agenda_notify_consent(p_consent boolean, p_channels text[], p_channel text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(p_consent, false) and (p_channel = 'email' or p_channel = any (coalesce(p_channels, '{}'::text[])));
$$;

-- Os parâmetros globais que a central mostra (4.4) ganham o interruptor do envio: 0 = desligado (padrão), 1 = ligado.
create or replace function private.agenda_central_params()
returns table (key text, def integer, min integer, max integer)
language sql immutable
set search_path = ''
as $$
  values ('agenda.limite_futuros_por_telefone'::text, 3, 1, 20),
         ('avisos.envio_ligado'::text, 0, 0, 1);
$$;
revoke all on function private.agenda_notify_channels() from public, anon, authenticated, service_role;
revoke all on function private.agenda_notify_on(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_notify_consent(boolean, text[], text) from public, anon, authenticated, service_role;
revoke all on function private.agenda_central_params() from public, anon, authenticated, service_role;

/* ===================== 3. Preparar os avisos (gatilho no pedido) ===================== */
-- Grava um aviso (se a regra da clínica deixar e se ainda não existe um igual).
create or replace function private.agenda_notify_add(p_request uuid, p_clinic uuid, p_event text, p_recipient text,
                                                    p_at timestamptz, p_slot timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ch text;
begin
  foreach v_ch in array private.agenda_notify_channels() loop
    if private.agenda_notify_on(p_clinic, p_event, p_recipient, v_ch) then
      insert into agenda.notifications (request_id, clinic_id, event_type, channel, recipient_kind, send_after, slot_start, next_try_at)
      values (p_request, p_clinic, p_event, v_ch, p_recipient, p_at, p_slot, p_at)
      on conflict on constraint notifications_uq do nothing;
    end if;
  end loop;
end $$;

-- Os lembretes do paciente para o horário dado: só os que ainda não passaram.
create or replace function private.agenda_notify_reminders(p_request uuid, p_clinic uuid, p_slot timestamptz, p_now timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_slot is null then return; end if;
  if p_slot - interval '24 hours' > p_now then
    perform private.agenda_notify_add(p_request, p_clinic, 'lembrete_24h', 'paciente', p_slot - interval '24 hours', p_slot);
  end if;
  if p_slot - interval '2 hours' > p_now then
    perform private.agenda_notify_add(p_request, p_clinic, 'lembrete_2h', 'paciente', p_slot - interval '2 hours', p_slot);
  end if;
end $$;

create or replace function private.agenda_notify_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_old text := case when tg_op = 'UPDATE' then old.status end;
  v_mudou_horario boolean := tg_op = 'UPDATE' and old.slot_start is distinct from new.slot_start;
begin
  -- só o agendamento da agenda nova, de uma clínica, com dados de paciente de verdade
  if not new.uses_resources or new.clinic_id is null or new.anonymized_at is not null then return null; end if;
  if tg_op = 'UPDATE' and v_old is not distinct from new.status and not v_mudou_horario then return null; end if;
  begin
    -- lembretes do horário antigo ou de um agendamento que deixou de estar confirmado: não fazem mais sentido
    if tg_op = 'UPDATE' and (v_mudou_horario or new.status <> 'confirmed') then
      update agenda.notifications n set status = 'cancelada', closed_at = v_now
      where n.request_id = new.id and n.status = 'agendada' and n.event_type in ('lembrete_24h', 'lembrete_2h');
    end if;

    if new.status = 'confirmed' then
      if tg_op = 'INSERT' or v_old in ('hold', 'awaiting_payment', 'pending') then
        perform private.agenda_notify_add(new.id, new.clinic_id, 'confirmado', 'paciente', v_now, new.slot_start);
        -- a clínica é avisada do que o paciente marcou sozinho (o que a recepção marcou, ela já sabe)
        if new.channel = 'imed_app' then
          perform private.agenda_notify_add(new.id, new.clinic_id, 'confirmado', 'clinica', v_now, new.slot_start);
        end if;
      elsif v_mudou_horario then
        perform private.agenda_notify_add(new.id, new.clinic_id, 'remarcado', 'paciente', v_now, new.slot_start);
      end if;
      perform private.agenda_notify_reminders(new.id, new.clinic_id, new.slot_start, v_now);
    elsif new.status = 'cancelled' and v_old in ('confirmed', 'reschedule_requested') then
      perform private.agenda_notify_add(new.id, new.clinic_id, 'cancelado', 'paciente', v_now, new.slot_start);
      if new.cancelled_by = 'patient' then
        perform private.agenda_notify_add(new.id, new.clinic_id, 'cancelado', 'clinica', v_now, new.slot_start);
      end if;
    elsif new.status = 'reschedule_requested' and v_old is distinct from 'reschedule_requested' then
      perform private.agenda_notify_add(new.id, new.clinic_id, 'alterado_pela_clinica', 'paciente', v_now, new.slot_start);
    end if;
  exception when others then
    raise warning 'agenda_notify_request: avisos não preparados (%: %)', sqlstate, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.agenda_notify_add(uuid, uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.agenda_notify_reminders(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.agenda_notify_request() from public, anon, authenticated, service_role;
comment on function private.agenda_notify_request() is
  'Fase 5.3: prepara os avisos e os lembretes quando o agendamento da agenda nova é confirmado, cancelado, remarcado ou vai para remarcação; cancela os lembretes que perderam o sentido. Erro só vira aviso no log, sem derrubar a marcação.';

drop trigger if exists appointment_requests_avisos on public.appointment_requests;
create trigger appointment_requests_avisos
  after insert or update of status, slot_start on public.appointment_requests
  for each row execute function private.agenda_notify_request();
-- como as outras guardas da agenda: vale sempre, também com session_replication_role = replica
alter table public.appointment_requests enable always trigger appointment_requests_avisos;

/* ===================== 4. A fila ===================== */
-- Pega até p_limit avisos vencidos. De cada agendamento (e destinatário), só o mais antigo dos vencidos: a ordem dos
-- avisos de um mesmo agendamento é respeitada. Confere tudo NA HORA; o que não vale mais é fechado aqui mesmo.
-- p_send = true: os válidos viram "enviando" e são devolvidos COM o destino (só para a função do servidor).
-- p_send = false (envio desligado): os válidos são fechados como "sem_canal" e nada é devolvido.
create or replace function private.agenda_notify_take(p_limit integer, p_send boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_out jsonb := '[]'::jsonb;
  n agenda.notifications;
  r public.appointment_requests;
  c public.clinics;
  v_dest text;
  v_fim text;
begin
  -- envio que não deu resposta em 5 minutos (a função caiu no meio): volta para a fila
  update agenda.notifications x set status = 'agendada', claimed_at = null, next_try_at = v_now
  where x.status = 'enviando' and x.claimed_at < v_now - interval '5 minutes';

  for n in
    select x.* from agenda.notifications x
    where x.status = 'agendada' and x.next_try_at <= v_now
      -- a ordem só importa quando há envio (sem envio, todos os vencidos são fechados de uma vez)
      and (not p_send or not exists (select 1 from agenda.notifications o
                      where o.request_id = x.request_id and o.recipient_kind = x.recipient_kind
                        and (o.status = 'enviando' or (o.status = 'agendada' and o.next_try_at <= v_now))
                        and (o.send_after, o.created_at, o.id) < (x.send_after, x.created_at, x.id)))
    order by x.next_try_at, x.id
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update of x skip locked
  loop
    select * into r from public.appointment_requests a where a.id = n.request_id;
    v_fim := null;
    v_dest := null;
    if r.id is null or r.anonymized_at is not null then
      v_fim := 'cancelada';
    elsif n.event_type = 'cancelado' then
      if r.status <> 'cancelled' then v_fim := 'cancelada'; end if;
    elsif n.event_type = 'alterado_pela_clinica' then
      if r.status <> 'reschedule_requested' then v_fim := 'cancelada'; end if;
    elsif r.status <> 'confirmed' or r.slot_start is distinct from n.slot_start then
      v_fim := 'cancelada';                            -- deixou de estar confirmado ou mudou de horário
    elsif n.event_type in ('lembrete_24h', 'lembrete_2h') and r.slot_start <= v_now then
      v_fim := 'cancelada';                            -- lembrete de horário que já passou
    end if;
    if v_fim is null and not p_send then
      v_fim := 'sem_canal';
    end if;
    if v_fim is null then
      select * into c from public.clinics k where k.id = n.clinic_id;
      if n.recipient_kind = 'paciente' then
        if not private.agenda_notify_consent(r.consent, r.notify_channels, n.channel) then
          v_fim := 'sem_consentimento';
        else
          v_dest := case n.channel when 'email' then r.patient_email else r.patient_phone end;
        end if;
      else
        v_dest := case n.channel when 'email' then nullif(btrim(c.email), '') else nullif(btrim(c.whatsapp), '') end;
      end if;
      if v_fim is null and v_dest is null then v_fim := 'sem_contato'; end if;
    end if;

    if v_fim is not null then
      update agenda.notifications x set status = v_fim, closed_at = v_now, claimed_at = null where x.id = n.id;
    else
      update agenda.notifications x set status = 'enviando', claimed_at = v_now, attempts = x.attempts + 1 where x.id = n.id;
      v_out := v_out || jsonb_build_object(
        'id', n.id, 'event_type', n.event_type, 'channel', n.channel, 'recipient_kind', n.recipient_kind,
        'to', v_dest, 'attempt', n.attempts + 1,
        'code', 'IMED-' || upper(left(replace(r.id::text, '-', ''), 8)),   -- o mesmo código que o site mostra ao paciente
        'slot_start', r.slot_start, 'slot_end', r.slot_end, 'timezone', c.timezone,
        'cancelled_by', r.cancelled_by, 'booked_by', r.channel,   -- quem marcou (site ou recepção): muda o texto
        'clinic', jsonb_build_object('name', c.name, 'address_line', c.address_line, 'neighborhood', c.neighborhood,
                                     'city', c.city, 'state', c.state, 'phone', c.phone));
    end if;
  end loop;
  return v_out;
end $$;
revoke all on function private.agenda_notify_take(integer, boolean) from public, anon, authenticated, service_role;

-- O envio está ligado? Parâmetro global (padrão 0), que só o administrador muda (central, 4.4).
create or replace function private.agenda_notify_sending()
returns boolean
language sql stable
set search_path = ''
as $$ select private.agenda_setting_int('avisos.envio_ligado', 0) = 1 $$;
revoke all on function private.agenda_notify_sending() from public, anon, authenticated, service_role;

create or replace function public.agenda_notify_claim(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then return jsonb_build_object('status', 'forbidden'); end if;
  if not private.agenda_notify_sending() then return jsonb_build_object('status', 'off', 'items', '[]'::jsonb); end if;
  return jsonb_build_object('status', 'ok', 'items', private.agenda_notify_take(p_limit, true));
end $$;

-- O resultado de um envio. p_result: 'enviada', 'sem_canal' (o servidor não tem a credencial do canal), 'sem_contato'
-- (o destino lido do cadastro não serve: e-mail da clínica mal escrito, por exemplo) ou 'falhou' (com um código curto
-- do erro; nunca o texto do provedor nem o destino). Falha: tenta de novo em 1 min, 5 min,
-- 15 min, 1 h e 6 h; depois de 10 tentativas, fica "falhou".
create or replace function public.agenda_notify_done(p_id uuid, p_result text, p_provider_id text default null, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n agenda.notifications;
  v_now timestamptz := clock_timestamp();
  v_err text := case when p_error ~ '^[a-z0-9_.:-]{1,60}$' then p_error else 'erro' end;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return jsonb_build_object('status', 'forbidden'); end if;
  if p_id is null or p_result is null or p_result not in ('enviada', 'sem_canal', 'sem_contato', 'falhou') then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into n from agenda.notifications x where x.id = p_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if n.status <> 'enviando' then return jsonb_build_object('status', 'stale', 'notification_status', n.status); end if;
  if p_result = 'enviada' then
    update agenda.notifications x set status = 'enviada', sent_at = v_now, closed_at = v_now, claimed_at = null, last_error = null,
      provider_message_id = left(p_provider_id, 200) where x.id = p_id;
  elsif p_result in ('sem_canal', 'sem_contato') then
    update agenda.notifications x set status = p_result, closed_at = v_now, claimed_at = null where x.id = p_id;
  elsif n.attempts >= 10 then
    update agenda.notifications x set status = 'falhou', closed_at = v_now, claimed_at = null, last_error = v_err where x.id = p_id;
  else
    update agenda.notifications x set status = 'agendada', claimed_at = null, last_error = v_err,
      next_try_at = v_now + case n.attempts when 1 then interval '1 minute' when 2 then interval '5 minutes'
                                            when 3 then interval '15 minutes' when 4 then interval '1 hour'
                                            else interval '6 hours' end
    where x.id = p_id;
  end if;
  return jsonb_build_object('status', 'ok', 'notification_status',
    (select x.status from agenda.notifications x where x.id = p_id));
end $$;
revoke all on function public.agenda_notify_claim(integer) from public, anon, authenticated;
grant execute on function public.agenda_notify_claim(integer) to service_role;
revoke all on function public.agenda_notify_done(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.agenda_notify_done(uuid, text, text, text) to service_role;
comment on function public.agenda_notify_claim(integer) is
  'Só o servidor (agenda-saida): pega os avisos vencidos (o mais antigo de cada agendamento), conferidos na hora, com o destino lido do pedido. Com o envio desligado, devolve status off. Fase 5.3.';
comment on function public.agenda_notify_done(uuid, text, text, text) is
  'Só o servidor (agenda-saida): resultado de um envio (enviada, sem_canal, sem_contato ou falhou com código). Falha tenta de novo em 1 min, 5 min, 15 min, 1 h e 6 h; depois de 10, falhou. Fase 5.3.';

/* ===================== 5. Cron ===================== */
-- A cada minuto. Sem aviso vencido: nada. Envio desligado (ou sem endereço/token): fecha os vencidos como sem_canal.
-- Envio ligado: chama a função do servidor, que pega a fila por agenda_notify_claim.
create or replace function private.agenda_notify_tick()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_base text;
  v_tok text;
begin
  if not exists (select 1 from agenda.notifications x
                 where (x.status = 'agendada' and x.next_try_at <= now())
                    or (x.status = 'enviando' and x.claimed_at < now() - interval '5 minutes')) then
    return;
  end if;
  if private.agenda_notify_sending() then
    select s.value into v_base from private.app_settings s where s.key = 'functions_url';
    select t.token into v_tok from private.app_tokens t where t.name = 'agenda_saida';
  end if;
  if v_base is null or v_tok is null then
    perform private.agenda_notify_take(100, false);
    return;
  end if;
  perform net.http_post(
    url := v_base || '/agenda-saida',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-imed-token', v_tok),
    body := jsonb_build_object('action', 'enviar'),
    timeout_milliseconds := 25000
  );
end $$;
revoke all on function private.agenda_notify_tick() from public, anon, authenticated, service_role;
comment on function private.agenda_notify_tick() is
  'pg_cron imed-agenda-saida (a cada minuto): sem aviso vencido não faz nada; envio desligado fecha os vencidos como sem_canal; envio ligado chama a função do servidor agenda-saida. Fase 5.3.';

select cron.unschedule(jobid) from cron.job where jobname = 'imed-agenda-saida';
select cron.schedule('imed-agenda-saida', '* * * * *', 'select private.agenda_notify_tick()');

/* ===================== 6. Painel da clínica ===================== */
-- O que a clínica pode escolher, na ordem da tela.
create or replace function private.agenda_notify_choices()
returns table (ord integer, event_type text, recipient_kind text)
language sql immutable
set search_path = ''
as $$
  values (1, 'lembrete_24h'::text, 'paciente'::text), (2, 'lembrete_2h', 'paciente'),
         (3, 'confirmado', 'clinica'), (4, 'cancelado', 'clinica');
$$;
revoke all on function private.agenda_notify_choices() from public, anon, authenticated, service_role;

create or replace function public.agenda_notify_config(p_clinic uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.agenda_actor(p_clinic, 'agenda.configurar', 'imed.agenda.monitor') is null then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if not exists (select 1 from public.clinics c where c.id = p_clinic) then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object(
    'status', 'ok',
    'sending', private.agenda_notify_sending(),
    'clinic_email', exists (select 1 from public.clinics c where c.id = p_clinic and nullif(btrim(c.email), '') is not null),
    'rules', (select jsonb_agg(jsonb_build_object(
                       'event_type', x.event_type, 'recipient_kind', x.recipient_kind, 'channel', 'email',
                       'enabled', private.agenda_notify_on(p_clinic, x.event_type, x.recipient_kind, 'email')) order by x.ord)
              from private.agenda_notify_choices() x));
end $$;

-- Grava as escolhas: p_rules = [{event_type, recipient_kind, enabled}], só as de agenda_notify_choices, canal e-mail.
-- Desligar um lembrete cancela os lembretes desse tipo ainda não enviados; ligar de novo vale para os próximos agendamentos.
create or replace function public.agenda_notify_config_set(p_clinic uuid, p_rules jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := private.agenda_actor(p_clinic, 'agenda.configurar', 'imed.clinicas.configurar');
  x record;
  v_antes boolean;
  v_mudou integer := 0;
begin
  if auth.uid() is null or v_origin is null then return jsonb_build_object('status', 'forbidden'); end if;
  if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules) not between 1 and 8
     or exists (select 1 from jsonb_array_elements(p_rules) e
                where jsonb_typeof(e.value) is distinct from 'object'
                   or private.agenda_unknown_keys(e.value, array['event_type', 'recipient_kind', 'enabled'])
                   or jsonb_typeof(e.value -> 'enabled') is distinct from 'boolean'
                   or not exists (select 1 from private.agenda_notify_choices() c
                                  where c.event_type = e.value ->> 'event_type' and c.recipient_kind = e.value ->> 'recipient_kind')) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not exists (select 1 from public.clinics c where c.id = p_clinic) then return jsonb_build_object('status', 'not_found'); end if;
  for x in select e.value ->> 'event_type' as event_type, e.value ->> 'recipient_kind' as recipient_kind,
                  (e.value ->> 'enabled')::boolean as enabled
           from jsonb_array_elements(p_rules) e
  loop
    v_antes := private.agenda_notify_on(p_clinic, x.event_type, x.recipient_kind, 'email');
    continue when v_antes = x.enabled;
    insert into agenda.notification_rules as r (clinic_id, event_type, recipient_kind, channel, enabled, updated_at, updated_by)
    values (p_clinic, x.event_type, x.recipient_kind, 'email', x.enabled, now(), auth.uid())
    on conflict (clinic_id, event_type, recipient_kind, channel)
    do update set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
    if not x.enabled then
      update agenda.notifications n set status = 'cancelada', closed_at = now()
      where n.clinic_id = p_clinic and n.status = 'agendada' and n.channel = 'email'
        and n.event_type = x.event_type and n.recipient_kind = x.recipient_kind;
    end if;
    -- o objeto é a clínica (a auditoria só aceita id); qual aviso mudou vai no valor
    perform private.agenda_audit(p_clinic, v_origin, 'avisos.regra', 'notification_rule', p_clinic::text,
      jsonb_build_object('event_type', x.event_type, 'recipient_kind', x.recipient_kind, 'enabled', v_antes),
      jsonb_build_object('event_type', x.event_type, 'recipient_kind', x.recipient_kind, 'enabled', x.enabled));
    v_mudou := v_mudou + 1;
  end loop;
  return jsonb_build_object('status', 'ok', 'changed', v_mudou);
end $$;

-- Os avisos de um agendamento, para quem vê a agenda da clínica (ou a equipe do IMED que monitora). Sem destino e
-- sem dado de paciente: só o evento, o canal, para quem, quando e a situação.
create or replace function public.agenda_notify_list(p_request uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_scope text;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'forbidden'); end if;
  select * into r from public.appointment_requests a where a.id = p_request;
  if not found or r.clinic_id is null then return jsonb_build_object('status', 'not_found'); end if;
  v_scope := public.clinic_perm_scope(r.clinic_id, 'agenda.ver');
  if v_scope = 'propria' and not private.agenda_request_on(r.id, private.agenda_own_resources(r.clinic_id)) then
    v_scope := null;
  end if;
  if v_scope is null or v_scope not in ('clinica', 'propria') then
    if not public.imed_has('imed.agenda.monitor') then return jsonb_build_object('status', 'forbidden'); end if;
  end if;
  return jsonb_build_object(
    'status', 'ok', 'sending', private.agenda_notify_sending(),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                 'event_type', n.event_type, 'channel', n.channel, 'recipient_kind', n.recipient_kind,
                 'send_after', n.send_after, 'notification_status', n.status, 'sent_at', n.sent_at)
                 order by n.send_after, n.created_at, n.id)
               from agenda.notifications n where n.request_id = r.id), '[]'::jsonb));
end $$;

revoke all on function public.agenda_notify_config(uuid) from public, anon, authenticated;
grant execute on function public.agenda_notify_config(uuid) to authenticated;
revoke all on function public.agenda_notify_config_set(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.agenda_notify_config_set(uuid, jsonb) to authenticated;
revoke all on function public.agenda_notify_list(uuid) from public, anon, authenticated;
grant execute on function public.agenda_notify_list(uuid) to authenticated;
comment on function public.agenda_notify_config(uuid) is
  'Painel da clínica: as escolhas de aviso (lembretes do paciente e avisos para a clínica), se o envio está ligado e se a clínica tem e-mail no cadastro. agenda.configurar. Fase 5.3.';
comment on function public.agenda_notify_config_set(uuid, jsonb) is
  'Painel da clínica: grava as escolhas de aviso; desligar cancela os avisos desse tipo ainda não enviados; vai para a auditoria. agenda.configurar. Fase 5.3.';
comment on function public.agenda_notify_list(uuid) is
  'Painel da clínica: os avisos de um agendamento (evento, canal, para quem, quando, situação), sem destino e sem dado de paciente. agenda.ver. Fase 5.3.';

/* ===================== 7. Central do IMED ===================== */
-- A saúde dos avisos, em números e códigos (nenhum dado de paciente, nenhum id de pedido): se o envio está ligado, a
-- fila (vencidos e o mais antigo), os últimos 7 dias por situação e as últimas falhas por clínica.
create or replace function public.agenda_central_avisos()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if auth.uid() is null or not public.imed_has('imed.agenda.monitor') then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object(
    'status', 'ok',
    'sending', private.agenda_notify_sending(),
    'due', (select count(*) from agenda.notifications n where n.status = 'agendada' and n.next_try_at <= v_now),
    'oldest_due_at', (select min(n.next_try_at) from agenda.notifications n where n.status = 'agendada' and n.next_try_at <= v_now),
    'scheduled', (select count(*) from agenda.notifications n where n.status = 'agendada' and n.next_try_at > v_now),
    'retrying', (select count(*) from agenda.notifications n where n.status = 'agendada' and n.attempts > 0),
    'last7', coalesce((select jsonb_object_agg(x.status, x.n)
                       from (select n.status, count(*) as n from agenda.notifications n
                             where n.closed_at >= v_now - interval '7 days' group by n.status) x), '{}'::jsonb),
    'failures', coalesce((select jsonb_agg(jsonb_build_object(
                    'clinic', y.name, 'event_type', y.event_type, 'channel', y.channel, 'error', y.last_error, 'at', y.closed_at)
                    order by y.closed_at desc)
                  from (select c.name, n.event_type, n.channel, n.last_error, n.closed_at
                        from agenda.notifications n join public.clinics c on c.id = n.clinic_id
                        where n.status = 'falhou' and n.closed_at >= v_now - interval '7 days'
                        order by n.closed_at desc limit 20) y), '[]'::jsonb));
end $$;
revoke all on function public.agenda_central_avisos() from public, anon, authenticated;
grant execute on function public.agenda_central_avisos() to authenticated;
comment on function public.agenda_central_avisos() is
  'Central do IMED: saúde dos avisos (envio ligado, fila, últimos 7 dias por situação, últimas falhas por clínica). Só números e códigos (imed.agenda.monitor). Fase 5.3.';
