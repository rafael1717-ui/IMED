-- VOLTA ÚNICA das 5 partes da migração do pagamento (supabase/migrations/*_pagamentos_base_parte_1 a 5; iMed Pagamentos,
-- fase P1; só se for preciso desfazer). As voltas das partes 1 a 4 não fazem nada. Tem o mesmo nome da última parte: se
-- ela for renomeada, renomeie esta também. Deixa o banco como estava antes da P1 (testado no CI, banco.yml: depois desta
-- volta a impressão digital é IGUAL à de antes, e reaplicada, igual à com ela):
--   - as 4 funções da agenda que mudaram de corpo voltam ao de antes: private.agenda_expire e agenda_book (da 3.3),
--     agenda_public_info (da 3.2) e agenda_my_booking (da 3.3), as duas últimas com o tempo-limite de 2 s da 5.1
--     (a volta da 5.1, que vem depois desta, é quem o tira);
--   - a restrição do modo de pagamento da unidade volta a aceitar só "no_local" (toda unidade volta a "no_local" antes);
--   - saem os gatilhos novos da agenda, o índice novo de appointment_requests, o job imed-pagamentos-retencao, as funções
--     novas (public.pag_*, public.admin_pag_*, public.agenda_pay_hold, private.pag_* e as duas private.agenda_* novas), as
--     2 permissões e a transição novas, e o schema pagamentos inteiro.
-- ATENÇÃO: apaga o schema pagamentos com os dados dele. Com pagamento de verdade registrado a volta RECUSA (os registros
-- financeiros ficam guardados 5 anos): desligue a chave geral (admin_pag_chave_geral) em vez de desfazer. Na P1, com tudo
-- desligado, nada usa o schema: voltar não perde dado.

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 0. Não desfaz por cima de dinheiro ===================== */
do $$
begin
  if to_regclass('pagamentos.charges') is not null
     and exists (select 1 from pagamentos.charges c where c.paga_em is not null) then
    raise exception 'A volta do pagamento recusa: há cobranças pagas registradas (pagamentos.charges). Desligue a chave geral em vez de desfazer.'
      using errcode = '55000';
  end if;
end $$;

/* ===================== 1. Job e gatilhos nas tabelas da agenda ===================== */
select cron.unschedule('imed-pagamentos-retencao') where exists (select 1 from cron.job where jobname = 'imed-pagamentos-retencao');
drop trigger if exists appointment_items_pag on agenda.appointment_items;
drop trigger if exists appointment_requests_pag on public.appointment_requests;
drop trigger if exists unit_settings_pag on agenda.unit_settings;
drop index if exists public.appointment_requests_pag_fone_idx;

/* ===================== 2. O modo de pagamento da unidade como era ===================== */
update agenda.unit_settings set payment_mode = 'no_local' where payment_mode <> 'no_local';
alter table agenda.unit_settings drop constraint if exists unit_settings_payment_mode_check;
alter table agenda.unit_settings add constraint unit_settings_payment_mode_check check (payment_mode in ('no_local'));

/* ===================== 3. As 4 funções da agenda com o corpo de antes ===================== */
-- private.agenda_expire (20261103053453_agenda_operacao_parte_1)
create or replace function private.agenda_expire(p_request uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_grace integer;
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_prev_reason text := coalesce(current_setting('imed.reason', true), '');
begin
  select * into r from public.appointment_requests a
  where a.id = p_request and a.status in ('hold', 'awaiting_payment')
  for update skip locked;
  if not found then return false; end if;
  select coalesce(u.payment_grace_min, 0) into v_grace from agenda.unit_settings u where u.clinic_id = r.clinic_id;
  if r.hold_expires_at is null or r.hold_expires_at + make_interval(mins => coalesce(v_grace, 0)) > now() then
    return false;
  end if;
  perform set_config('imed.origin', 'cron', true), set_config('imed.reason', 'reserva_expirada', true);
  update agenda.occupancy o set active = false, released_at = now(), release_reason = 'expirada'
  where o.active and o.item_id in (select i.id from agenda.appointment_items i where i.request_id = r.id);
  update agenda.appointment_items i set status = 'expired', version = i.version + 1, updated_at = now()
  where i.request_id = r.id and i.status in ('hold', 'awaiting_payment');
  update public.appointment_requests a set status = 'expired', hold_expires_at = null, cancel_reason = 'reserva_expirada'
  where a.id = r.id;
  perform set_config('imed.origin', v_prev, true), set_config('imed.reason', v_prev_reason, true);
  return true;
end $$;

-- agenda_book (20261103053814_agenda_operacao_parte_2)
create or replace function public.agenda_book(p_clinic uuid, p_items jsonb, p_patient jsonb, p_id uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if p_clinic is null or p_id is null or char_length(coalesce(p_token, '')) not between 16 and 200 then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  return private.agenda_book_int(p_clinic, p_items, p_patient, p_id, v_hash, 'confirmed', 'imed_app', 'app', true, false,
                                 'agenda_book', v_hash, p_id);
end $$;

-- agenda_public_info (20261103005641_agenda_motor_parte_1), com o tempo-limite da 5.1
create or replace function public.agenda_public_info(p_clinic uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c public.clinics;
  u agenda.unit_settings;
  v_online boolean;
begin
  select * into c from public.clinics x where x.id = p_clinic and x.status = 'published' and not x.is_demo;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into u from agenda.unit_settings s where s.clinic_id = p_clinic;
  v_online := u.clinic_id is not null and c.accepts_online_booking and c.agenda_online_since is not null;
  return jsonb_build_object(
    'status', 'ok',
    'clinic_id', c.id,
    'timezone', c.timezone,
    'mode', c.agenda_mode,
    'mode_text', case c.agenda_mode
      when 'nativa' then 'A clínica usa a agenda do IMED: os horários mostrados são os livres na agenda dela agora.'
      when 'manual' then 'A clínica registra os agendamentos dela na agenda do IMED. Em caso de dúvida, confirme com a clínica.'
      when 'externa' then 'A agenda é a do sistema da própria clínica; o IMED mostra os horários que esse sistema informa.'
      else 'Você envia um pedido e a clínica ou a equipe do IMED entra em contato para combinar o horário.' end,
    'online', v_online,
    'online_text', case when v_online then 'Escolha um horário livre e confirme.'
                        else 'Esta clínica ainda não marca horário pelo site.' end,
    'payment', 'no_local',
    'payment_text', 'Pagamento no local, direto com a clínica.',
    'cancel_until_min', case when v_online then u.patient_cancel_until_min end,
    'reschedule_until_min', case when v_online then u.patient_reschedule_until_min end,
    'procedures', case when not v_online then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'exam_code', p.exam_code, 'name', p.name, 'duration_min', p.duration_min,
               'price_cents', p.price_cents,
               'price_text', case when p.price_cents is null then 'sob consulta' end,
               'prep_text', p.patient_prep_text, 'fasting_hours', p.fasting_hours) order by p.exam_code, p.name)
      from agenda.procedures p
      where p.clinic_id = p_clinic and p.active and p.archived_at is null and p.online_booking
        and exists (select 1 from agenda.procedure_requirements g where g.procedure_id = p.id)), '[]'::jsonb) end);
end $$;
alter function public.agenda_public_info(uuid) set statement_timeout = '2s';

-- agenda_my_booking (20261103053814_agenda_operacao_parte_2), com o tempo-limite da 5.1
create or replace function public.agenda_my_booking(p_id uuid, p_token text default null)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  c public.clinics;
  u agenda.unit_settings;
begin
  select * into r from public.appointment_requests a where a.id = p_id;
  if not found or not ((r.user_id = auth.uid()) is true
                       or (r.review_token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')) is true) then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into c from public.clinics x where x.id = r.clinic_id;
  select * into u from agenda.unit_settings s where s.clinic_id = r.clinic_id;
  return jsonb_build_object(
    'status', 'ok', 'id', r.id, 'request_status', r.status, 'version', r.version, 'agenda', r.uses_resources,
    'clinic_id', r.clinic_id, 'clinic_name', c.name, 'timezone', coalesce(c.timezone, 'America/Sao_Paulo'),
    'slot_start', r.slot_start, 'slot_end', r.slot_end, 'hold_expires_at', r.hold_expires_at,
    'cancel_until', case when r.uses_resources and r.slot_start is not null
                         then r.slot_start - make_interval(mins => coalesce(u.patient_cancel_until_min, 0)) end,
    'reschedule_until', case when r.uses_resources and r.slot_start is not null
                             then r.slot_start - make_interval(mins => coalesce(u.patient_reschedule_until_min, 120)) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('seq', i.seq, 'exam_code', i.exam_code, 'procedure', p.name,
                                                           'starts_at', i.starts_at, 'ends_at', i.ends_at, 'status', i.status,
                                                           'prep_text', p.patient_prep_text, 'fasting_hours', p.fasting_hours)
                                        order by i.seq)
                       from agenda.appointment_items i join agenda.procedures p on p.id = i.procedure_id
                       where i.request_id = r.id), '[]'::jsonb));
end $$;
alter function public.agenda_my_booking(uuid, text) set statement_timeout = '2s';

/* ===================== 4. Funções novas ===================== */
drop function if exists public.agenda_pay_hold(uuid, jsonb, jsonb, uuid, text, uuid);
drop function if exists public.pag_payer_upsert(text, uuid);
drop function if exists public.pag_payer_attach(uuid, text);
drop function if exists public.pag_charge_open(uuid, text, text, uuid, uuid);
drop function if exists public.pag_charge_attach(uuid, text, timestamptz, text);
drop function if exists public.pag_charge_abort(uuid);
drop function if exists public.pag_event_store(text, text, text, text, text, integer, timestamptz, text);
drop function if exists public.pag_sync_apply(uuid, jsonb, bigint);
drop function if exists public.pag_due();
drop function if exists public.pag_refund_sent(uuid);
drop function if exists public.pag_refund_done(uuid, text);
drop function if exists public.pag_refund_failed(uuid, text);
drop function if exists public.pag_reconcile_apply(date, jsonb, text);
drop function if exists public.pag_subscription_sync(uuid, jsonb);
drop function if exists public.pag_my_payment(uuid, text);
drop function if exists public.pag_clinic_status(uuid);
drop function if exists public.pag_clinic_statement(uuid, date, date);
drop function if exists public.pag_clinic_connect(uuid, text, text, text[]);
drop function if exists public.pag_clinic_pause(uuid, boolean);
drop function if exists public.pag_clinic_refund(uuid, uuid, integer, text, uuid);
drop function if exists public.admin_pag_resumo(date, date);
drop function if exists public.admin_pag_lista(date, date, uuid, text, integer);
drop function if exists public.admin_pag_conciliacao(boolean);
drop function if exists public.admin_pag_assinaturas();
drop function if exists public.admin_pag_taxa_definir(uuid, text, integer, text, text);
drop function if exists public.admin_pag_conta_conferir(uuid, text, text);
drop function if exists public.admin_pag_estornar(uuid, uuid, integer, text, uuid);
drop function if exists public.admin_pag_diferenca_resolver(bigint, text);
drop function if exists public.admin_pag_chave_geral(boolean, text);
drop function if exists public.admin_pag_parametro_definir(text, jsonb, text);
drop function if exists private.agenda_to_awaiting(uuid);
drop function if exists private.agenda_confirm_paid(uuid);
drop function if exists private.pag_on_item_status();
drop function if exists private.pag_on_request_status();
drop function if exists private.pag_refund_by_rule(uuid, uuid, text);
drop function if exists private.pag_refund_manual(uuid, uuid, integer, text, text, uuid);
drop function if exists private.pag_refund_request(uuid, uuid, integer, text, text, uuid, uuid, boolean);
drop function if exists private.pag_refund_conclude(uuid, text);
drop function if exists private.pag_refund_integral(uuid, integer, text);
drop function if exists private.pag_resta(uuid, uuid);
drop function if exists private.pag_diff_abrir(text, uuid, text, jsonb, jsonb, text);
drop function if exists private.pag_charge_payload(uuid);
drop function if exists private.pag_tarifa_esperada(text, integer);
drop function if exists private.pag_retencao();
drop function if exists private.pag_motivo_ok(text);
drop function if exists private.pag_servidor();
drop function if exists private.pag_actor();
drop function if exists private.pag_ledger(uuid, uuid, uuid, text, integer, text);
drop function if exists private.pag_must_pay(uuid, jsonb);
drop function if exists private.pag_clinic_online(uuid);
drop function if exists private.pag_vendas_ligadas();
drop function if exists private.pag_setting_int(text, integer);
drop function if exists private.pag_setting_text(text, text);
drop function if exists private.pag_fee(text, integer, integer, integer);
drop function if exists private.pag_refund_fee(integer, integer, integer, integer);

/* ===================== 5. Referências da agenda ===================== */
delete from agenda.role_permissions where role = 'owner' and permission in ('financeiro.configurar', 'financeiro.estornar');
delete from agenda.status_transitions where from_status = 'hold' and to_status = 'cancelled' and actor_kind = 'sistema';

/* ===================== 6. O schema (tabelas, gatilhos e os dados dele) ===================== */
-- (private.pag_fee_rule devolve uma linha de pagamentos.fee_rules: sai junto com o schema, pelo CASCADE)
drop schema if exists pagamentos cascade;
drop function if exists private.pag_fee_rule(uuid, text, timestamptz);
drop function if exists private.pag_unit_settings_guard();
drop function if exists private.pag_clinic_accounts_guard();
drop function if exists private.pag_charges_guard();
drop function if exists private.pag_fee_rules_guard();
drop function if exists private.pag_guard_delete();
drop function if exists private.pag_so_acrescenta();
drop function if exists private.pag_audit(text, uuid, uuid, uuid, text, jsonb, jsonb, text, text);
