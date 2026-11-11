-- iMed Pagamentos, fase P1: parte 2 de 5 (o núcleo das contas e o que muda na agenda, §4.6). O cabeçalho, com o que a
-- migração faz e as conferências, está na parte 1. Volta única: supabase/volta/<versão>_pagamentos_base_parte_5.sql.
--
-- NOME PROVISÓRIO (ainda não aplicada na produção): os 5 passos de "Ao aplicar uma migração provisória na produção" do
-- .github/workflows/banco.yml valem para cada parte (veja o cabeçalho da parte 1).
--
-- Em linguagem simples:
--   1. As contas, sempre em centavos inteiros: a taxa de cada exame é o piso de preço × taxa (na dúvida de 1 centavo, o
--      centavo é da clínica); na devolução, a taxa devolvida acumulada é o piso de devolvido × taxa ÷ preço e é a taxa
--      inteira quando o exame foi devolvido inteiro (§3.3 e §4.5: a conta fecha sempre no centavo).
--   2. A devolução pela regra do §4.5 (private.pag_refund_by_rule), pedida NA MESMA TRANSAÇÃO do cancelamento por um
--      gatilho nos itens do agendamento: vale para qualquer caminho que cancele (agenda_cancel, agenda_set_status, a
--      fachada antiga, o bloqueio forçado, o SQL de emergência), sem trocar o corpo dessas funções.
--   3. P-I1 no banco: agendamento pago online só fica (ou volta a ficar) confirmado com a cobrança aprovada e sem
--      devolução automática já enviada; a devolução ainda não enviada é desfeita (§4.4, "só enquanto não foi enviada").
--   4. Funções novas da agenda: agenda_pay_hold (só servidor; a reserva do paciente pagante, pelo mesmo núcleo de
--      agenda_book), private.agenda_to_awaiting e private.agenda_confirm_paid (inclusive expirado → confirmado pelo
--      motor completo).
--   5. Funções da agenda que mudam de corpo (a volta devolve o de antes): private.agenda_expire (não expira enquanto o
--      cartão está em análise, até o teto), agenda_book (na clínica com recebimento ligado, exame com preço não é
--      confirmado sem pagar: payment_required), agenda_public_info e agenda_my_booking (dizem o modo de pagamento).
-- COM TUDO DESLIGADO NADA MUDA: sem a chave geral e sem clínica com conta ativa, agenda_book, agenda_public_info e
-- agenda_my_booking respondem exatamente o mesmo de antes, e os gatilhos novos não acham o que fazer.
-- Pode rodar de novo sem erro e sem mudar nada.

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Parâmetros e situação da clínica ===================== */

create or replace function private.pag_setting_int(p_chave text, p_default integer)
returns integer
language sql stable
set search_path = ''
as $$
  select coalesce((select (s.valor #>> '{}')::integer from pagamentos.settings s
                   where s.chave = p_chave and jsonb_typeof(s.valor) = 'number'), p_default);
$$;

create or replace function private.pag_setting_text(p_chave text, p_default text)
returns text
language sql stable
set search_path = ''
as $$
  select coalesce((select s.valor #>> '{}' from pagamentos.settings s
                   where s.chave = p_chave and jsonb_typeof(s.valor) = 'string'), p_default);
$$;

-- A chave geral (§6.2): desligada, nenhuma cobrança nova nasce em clínica nenhuma.
create or replace function private.pag_vendas_ligadas()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((select s.valor = 'true'::jsonb from pagamentos.settings s where s.chave = 'vendas_online_ligadas'), false);
$$;

-- A clínica recebe pelo site agora? Chave geral ligada, conta ativa e a unidade no modo online.
create or replace function private.pag_clinic_online(p_clinic uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.pag_vendas_ligadas()
     and exists (select 1 from pagamentos.clinic_accounts a where a.clinic_id = p_clinic and a.situacao = 'ativa')
     and exists (select 1 from agenda.unit_settings u where u.clinic_id = p_clinic and u.payment_mode = 'online');
$$;

-- Esta marcação TEM de ser paga pelo site (decisão 11)? Clínica recebendo, todos os exames com preço e o total a partir
-- do mínimo. Exame "sob consulta" ou abaixo do mínimo continua "pagamento no local" (§1.3 item 7 e §3.3).
create or replace function private.pag_must_pay(p_clinic uuid, p_items jsonb)
returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  v_n integer;
  v_com_preco integer;
  v_total bigint;
begin
  if not private.pag_vendas_ligadas() or not private.pag_clinic_online(p_clinic) then return false; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 4 then return false; end if;
  select count(*), count(p.price_cents), sum(p.price_cents) into v_n, v_com_preco, v_total
  from jsonb_array_elements(p_items) x
  join agenda.procedures p on p.clinic_id = p_clinic and p.id::text = lower(x.value ->> 'procedure_id');
  return v_n = jsonb_array_length(p_items) and v_com_preco = v_n
     and v_total >= private.pag_setting_int('preco_minimo_online_cents', 2000);
end $$;

/* ===================== 2. As contas (§3.3 e §4.5) ===================== */

-- Taxa do IMED sobre UM exame: percentual = piso(preço × pontos-base ÷ 10000); fixo = o valor fixo, até o preço.
create or replace function private.pag_fee(p_tipo text, p_bps integer, p_cents integer, p_preco integer)
returns integer
language sql immutable
set search_path = ''
as $$
  select case p_tipo when 'percentual' then ((p_preco::bigint * p_bps) / 10000)::integer
                     when 'fixo' then least(p_preco, p_cents) end;
$$;

-- Parte da taxa que volta numa devolução de p_valor, com p_antes já devolvido do exame (preço P, taxa T): a taxa
-- devolvida acumulada é piso(D × T ÷ P), e é T quando D = P.
create or replace function private.pag_refund_fee(p_preco integer, p_taxa integer, p_antes integer, p_valor integer)
returns integer
language sql immutable
set search_path = ''
as $$
  select (case when p_antes + p_valor >= p_preco then p_taxa::bigint else ((p_antes + p_valor)::bigint * p_taxa) / p_preco end
        - case when p_antes >= p_preco then p_taxa::bigint else (p_antes::bigint * p_taxa) / p_preco end)::integer;
$$;

-- A regra de taxa que vale para a clínica agora: a dela, se houver; senão, a padrão.
create or replace function private.pag_fee_rule(p_clinic uuid, p_finalidade text, p_quando timestamptz)
returns pagamentos.fee_rules
language sql stable
set search_path = ''
as $$
  select f from pagamentos.fee_rules f
  where f.finalidade = p_finalidade and (f.clinic_id = p_clinic or f.clinic_id is null)
    and f.vale_de <= p_quando and (f.vale_ate is null or f.vale_ate > p_quando)
  order by (f.clinic_id is not null) desc
  limit 1;
$$;

-- Uma linha do extrato (valor zero não entra).
create or replace function private.pag_ledger(p_charge uuid, p_refund uuid, p_clinic uuid, p_tipo text, p_valor integer, p_de_quem text)
returns void
language sql
set search_path = ''
as $$
  insert into pagamentos.ledger (charge_id, refund_id, clinic_id, tipo, valor_cents, de_quem)
  select p_charge, p_refund, p_clinic, p_tipo, p_valor, p_de_quem where p_valor <> 0;
$$;

-- Quem age, pela marca de origem da agenda (sem marca = SQL).
create or replace function private.pag_actor()
returns text
language sql stable
set search_path = ''
as $$
  select case coalesce(private.agenda_origin(), 'sql')
           when 'app' then 'paciente' when 'painel' then 'clinica' when 'central' then 'imed' when 'api' then 'integracao'
           when 'webhook_pagamento' then 'gateway' when 'cron' then 'sistema' else 'sql' end;
$$;

/* ===================== 3. Pedir devolução (o núcleo) ===================== */
-- Grava o PEDIDO de devolução (a rotina envia: parte 3). p_item nulo = a cobrança inteira; p_valor nulo = tudo o que
-- resta do alvo. O rateio por exame fica em refund_items (em ordem, até o que resta de cada um); a divisão entre taxa
-- e parte da clínica é calculada no envio. Nunca passa do que foi pago menos o já devolvido e o já pedido. A mesma
-- chave devolve o mesmo pedido (replay). p_auto (a regra): junta numa devolução só os exames da mesma transação.
create or replace function private.pag_refund_request(p_charge uuid, p_item uuid, p_valor integer, p_motivo text,
                                                      p_por_tipo text, p_por_user uuid, p_key uuid, p_auto boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c pagamentos.charges;
  f pagamentos.refunds;
  v_resta integer := 0;
  v_falta integer;
  v_total integer := 0;
  v_parte integer;
  v_rateio jsonb := '[]'::jsonb;
  it record;
  v_id uuid;
begin
  if p_key is not null then
    select * into f from pagamentos.refunds x where x.chave_idempotencia = p_key;
    if found then
      if f.charge_id <> p_charge then return jsonb_build_object('status', 'idempotency_conflict'); end if;
      return jsonb_build_object('status', 'ok', 'replay', true, 'refund_id', f.id, 'valor_cents', f.valor_cents);
    end if;
  end if;
  select * into c from pagamentos.charges x where x.id = p_charge for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  -- (de novo, depois da trava: outro pedido com a mesma chave pode ter entrado enquanto esperávamos)
  if p_key is not null then
    select * into f from pagamentos.refunds x where x.chave_idempotencia = p_key;
    if found then
      return jsonb_build_object('status', 'ok', 'replay', true, 'refund_id', f.id, 'valor_cents', f.valor_cents);
    end if;
  end if;
  if c.situacao not in ('aprovada', 'devolvida_parcial') then
    return jsonb_build_object('status', 'not_refundable', 'situacao', c.situacao);
  end if;
  if p_valor is not null and p_valor < 1 then return jsonb_build_object('status', 'invalid'); end if;
  if exists (select 1 from pagamentos.charge_items ci where ci.charge_id = c.id) then
    if p_item is not null and not exists (select 1 from pagamentos.charge_items ci where ci.charge_id = c.id and ci.item_id = p_item) then
      return jsonb_build_object('status', 'not_found');
    end if;
    v_falta := p_valor;
    for it in
      select ci.item_id,
             ci.preco_cents - ci.devolvido_cents
               - coalesce((select sum(fi.valor_cents) from pagamentos.refund_items fi join pagamentos.refunds r on r.id = fi.refund_id
                           where r.charge_id = c.id and fi.item_id = ci.item_id and r.situacao in ('pedida', 'enviada', 'falhou')), 0)::integer
               as resta
      from pagamentos.charge_items ci
      left join agenda.appointment_items ai on ai.id = ci.item_id
      where ci.charge_id = c.id and (p_item is null or ci.item_id = p_item)
      order by ai.seq nulls last, ci.item_id
    loop
      v_resta := v_resta + greatest(it.resta, 0);
      v_parte := case when p_valor is null then greatest(it.resta, 0) else least(greatest(it.resta, 0), v_falta) end;
      if v_parte > 0 then
        v_rateio := v_rateio || jsonb_build_object('item_id', it.item_id, 'valor', v_parte);
        v_total := v_total + v_parte;
        if p_valor is not null then v_falta := v_falta - v_parte; end if;
      end if;
    end loop;
  else
    -- cobrança sem exames (mensalidade): a conta é a da cobrança inteira
    if p_item is not null then return jsonb_build_object('status', 'not_found'); end if;
    v_resta := c.valor_cents - c.devolvido_cents
      - coalesce((select sum(r.valor_cents) from pagamentos.refunds r
                  where r.charge_id = c.id and r.situacao in ('pedida', 'enviada', 'falhou')), 0)::integer;
    v_total := case when p_valor is null then greatest(v_resta, 0) else least(greatest(v_resta, 0), p_valor) end;
  end if;
  if p_valor is not null and p_valor > v_resta then
    return jsonb_build_object('status', 'over_limit', 'resta_cents', greatest(v_resta, 0));
  end if;
  if v_total < 1 then return jsonb_build_object('status', 'nothing_to_refund'); end if;
  if p_auto then
    select * into f from pagamentos.refunds x
    where x.charge_id = c.id and x.automatica and x.situacao = 'pedida' and x.txid = txid_current() and x.motivo = p_motivo
    order by x.criado_em limit 1;
  end if;
  if p_auto and f.id is not null then
    update pagamentos.refunds x set valor_cents = x.valor_cents + v_total, item_id = null, atualizado_em = now() where x.id = f.id;
    v_id := f.id;
  else
    insert into pagamentos.refunds (charge_id, item_id, automatica, valor_cents, motivo, pedido_por_tipo, pedido_por_user, chave_idempotencia)
    values (c.id, p_item, coalesce(p_auto, false), v_total, p_motivo, p_por_tipo, p_por_user, coalesce(p_key, gen_random_uuid()))
    returning id into v_id;
  end if;
  insert into pagamentos.refund_items (refund_id, item_id, valor_cents)
  select v_id, (x.value ->> 'item_id')::uuid, (x.value ->> 'valor')::integer from jsonb_array_elements(v_rateio) x;
  perform private.pag_audit('devolucao.pedida', c.id, v_id, c.clinic_id, null, null,
    jsonb_build_object('valor_cents', v_total, 'item', p_item is not null, 'automatica', coalesce(p_auto, false)), p_motivo,
    case when p_por_tipo in ('sistema', 'gateway') then 'sistema' when p_por_tipo = 'sql' then 'sql' end);
  return jsonb_build_object('status', 'ok', 'refund_id', v_id, 'valor_cents', v_total);
end $$;

-- A regra de devolução (§4.5). p_causa: 'cancelado' (quem cancelou vem da marca de origem), 'bloqueio_forcado' e
-- 'pagamento_atrasado' (culpa da clínica, do IMED ou do sistema: total, sempre) ou 'falta' (sem devolução automática,
-- pelo parâmetro). O paciente que cancela: até 24 h antes; ou dentro de 7 dias da compra e antes do exame; ou em cima
-- da hora, cada caso com o seu parâmetro (hoje os três devolvem tudo). p_item nulo = o agendamento inteiro.
create or replace function private.pag_refund_by_rule(p_request uuid, p_item uuid, p_causa text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c pagamentos.charges;
  v_tipo text := private.pag_actor();
  v_inicio timestamptz;
  v_regra text;
  v_motivo text;
begin
  select * into c from pagamentos.charges x
  where x.request_id = p_request and x.situacao in ('aprovada', 'devolvida_parcial') for update;
  if not found then return jsonb_build_object('status', 'no_charge'); end if;
  if p_causa = 'falta' then
    v_regra := private.pag_setting_text('regra_devolucao_falta', 'nenhuma');
    v_motivo := 'falta';
  elsif p_causa in ('bloqueio_forcado', 'pagamento_atrasado') then
    v_regra := 'total';
    v_motivo := p_causa;
  elsif v_tipo <> 'paciente' then
    v_regra := 'total';
    v_motivo := 'cancelado_' || v_tipo;
  else
    v_inicio := coalesce((select i.starts_at from agenda.appointment_items i where i.id = p_item),
                         (select a.slot_start from public.appointment_requests a where a.id = p_request));
    v_regra := case
      when v_inicio is not null and now() <= v_inicio - interval '24 hours' then private.pag_setting_text('regra_devolucao_antes_24h', 'total')
      when c.paga_em >= now() - interval '7 days' and (v_inicio is null or now() < v_inicio) then private.pag_setting_text('regra_devolucao_7_dias', 'total')
      else private.pag_setting_text('regra_devolucao_em_cima_da_hora', 'total') end;
    v_motivo := 'cancelado_paciente';
  end if;
  if v_regra is distinct from 'total' then
    perform private.pag_audit('devolucao.regra_sem_devolucao', c.id, null, c.clinic_id, null, null,
                              jsonb_build_object('causa', p_causa, 'regra', v_regra), v_motivo, 'sistema');
    return jsonb_build_object('status', 'no_refund', 'regra', v_regra);
  end if;
  return private.pag_refund_request(c.id, p_item, null, v_motivo, v_tipo, auth.uid(), null, true);
end $$;

/* ===================== 4. Gatilhos na agenda: devolução na mesma transação e P-I1 ===================== */

-- Item de agendamento pago online que muda de situação (qualquer caminho de escrita):
--   cancelado ................................ devolução pela regra, do exame;
--   remarcação por bloqueio forçado .......... devolução total (culpa da clínica);
--   não compareceu ........................... a regra da falta (hoje: nenhuma devolução automática);
--   volta a valer (confirmado, chegou, em atendimento): a devolução automática ainda não enviada é desfeita; se já foi
--     enviada ou concluída, a mudança é recusada (pagamento_devolvido); e só vale com a cobrança aprovada (P-I1).
-- Pedido sem pagamento online: não faz nada.
create or replace function private.pag_on_item_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ativas text[] := array['confirmed', 'checked_in', 'in_service'];
  f record;
begin
  if not exists (select 1 from public.appointment_requests a where a.id = new.request_id and a.payment_mode = 'online') then
    return null;
  end if;
  if new.status = 'cancelled' then
    perform private.pag_refund_by_rule(new.request_id, new.id, 'cancelado');
  elsif new.status = 'reschedule_requested' and private.agenda_reason() = 'bloqueio_forcado' then
    perform private.pag_refund_by_rule(new.request_id, new.id, 'bloqueio_forcado');
  elsif new.status = 'no_show' then
    perform private.pag_refund_by_rule(new.request_id, new.id, 'falta');
  elsif new.status = any (v_ativas) and not (old.status = any (v_ativas)) then
    for f in
      select r.id, r.situacao, r.charge_id, fi.valor_cents,
             (select count(*) from pagamentos.refund_items o where o.refund_id = r.id) as itens
      from pagamentos.refund_items fi join pagamentos.refunds r on r.id = fi.refund_id
      where fi.item_id = new.id and r.automatica and r.situacao in ('pedida', 'enviada', 'falhou', 'concluida')
      order by r.criado_em
      for update of r
    loop
      if f.situacao <> 'pedida' then
        raise exception 'pagamento_devolvido: o exame % já teve o pagamento devolvido (ou a devolução já foi enviada)', new.id
          using errcode = 'IMP03', hint = 'Agendamento pago e devolvido não volta a valer: o paciente marca e paga de novo.';
      end if;
      if f.itens > 1 then
        delete from pagamentos.refund_items o where o.refund_id = f.id and o.item_id = new.id;
        update pagamentos.refunds r set valor_cents = r.valor_cents - f.valor_cents, atualizado_em = now() where r.id = f.id;
      else
        update pagamentos.refunds r set situacao = 'desfeita', atualizado_em = now() where r.id = f.id;
      end if;
      perform private.pag_audit('devolucao.desfeita', f.charge_id, f.id, new.clinic_id, null, null,
                                jsonb_build_object('valor_cents', f.valor_cents), 'agendamento_voltou_a_valer', 'sistema');
    end loop;
    if not exists (select 1 from pagamentos.charge_items ci join pagamentos.charges c on c.id = ci.charge_id
                   where ci.item_id = new.id and c.situacao in ('aprovada', 'devolvida_parcial', 'contestada')) then
      raise exception 'pagamento_ausente: o exame % é de agendamento pago online e não tem cobrança aprovada', new.id
        using errcode = 'IMP04', hint = 'P-I1: confirmado com pagamento online só com a cobrança aprovada (arquitetura do pagamento, §4.6).';
    end if;
  end if;
  return null;
end $$;

-- Cabeçalho do agendamento pago online:
--   cancelado: a cobrança que ainda não foi paga é cancelada na hora (a rotina apaga no provedor);
--   confirmado (ou chegou, em atendimento) vindo de outra situação: exatamente uma cobrança aprovada, de valor igual ao
--   total do agendamento (P-I1).
create or replace function private.pag_on_request_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ativas text[] := array['confirmed', 'checked_in', 'in_service'];
begin
  if new.status = 'cancelled' then
    update pagamentos.charges c set situacao = 'cancelada'
    where c.request_id = new.id and c.situacao in ('criada', 'aguardando', 'processando');
  elsif new.status = any (v_ativas) and not (old.status = any (v_ativas)) then
    if (select count(*) from pagamentos.charges c
        where c.request_id = new.id and c.situacao in ('aprovada', 'devolvida_parcial', 'contestada')
          and c.valor_cents = new.total_cents) <> 1 then
      raise exception 'pagamento_ausente: o agendamento % é pago online e não tem uma cobrança aprovada do valor dele', new.id
        using errcode = 'IMP04', hint = 'P-I1: confirmado com pagamento online só com a cobrança aprovada (arquitetura do pagamento, §4.6).';
    end if;
  end if;
  return null;
end $$;

revoke all on function private.pag_setting_int(text, integer) from public, anon, authenticated, service_role;
revoke all on function private.pag_setting_text(text, text) from public, anon, authenticated, service_role;
revoke all on function private.pag_vendas_ligadas() from public, anon, authenticated, service_role;
revoke all on function private.pag_clinic_online(uuid) from public, anon, authenticated, service_role;
revoke all on function private.pag_must_pay(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.pag_fee(text, integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function private.pag_refund_fee(integer, integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function private.pag_fee_rule(uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.pag_ledger(uuid, uuid, uuid, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function private.pag_actor() from public, anon, authenticated, service_role;
revoke all on function private.pag_refund_request(uuid, uuid, integer, text, text, uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.pag_refund_by_rule(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.pag_on_item_status() from public, anon, authenticated, service_role;
revoke all on function private.pag_on_request_status() from public, anon, authenticated, service_role;

create or replace trigger appointment_items_pag
  after update of status on agenda.appointment_items
  for each row when (old.status is distinct from new.status) execute function private.pag_on_item_status();
create or replace trigger appointment_requests_pag
  after update of status on public.appointment_requests
  for each row when (new.payment_mode = 'online' and old.status is distinct from new.status)
  execute function private.pag_on_request_status();
alter table agenda.appointment_items enable always trigger appointment_items_pag;
alter table public.appointment_requests enable always trigger appointment_requests_pag;

-- "1 reserva aguardando pagamento por telefone" (§6.2): a consulta de agenda_pay_hold, só nos pedidos pagos online.
create index if not exists appointment_requests_pag_fone_idx on public.appointment_requests (patient_phone, created_at)
  where payment_mode = 'online';

/* ===================== 5. Funções novas da agenda (§4.6) ===================== */

-- Só o servidor (service_role; a Edge Function pagamento-criar, fase P2): a reserva do paciente que vai pagar. O mesmo
-- núcleo de agenda_book (private.agenda_book_int), com a situação "hold", o canal imed_app e as regras da venda online
-- (clínica publicada e com a venda ligada, só procedimento à venda, limite por telefone). Só com a chave geral ligada,
-- a clínica recebendo, todos os exames com preço e o total a partir do mínimo; senão nada fica reservado.
-- Contra abuso (§6.2): uma reserva aguardando pagamento por telefone; quem deixou vencer as 3 últimas espera 30 min.
-- p_user: a conta de quem está logado (conferida pela Edge Function), para o agendamento aparecer em "Meus pedidos".
create or replace function public.agenda_pay_hold(p_clinic uuid, p_items jsonb, p_patient jsonb, p_id uuid, p_token text,
                                                  p_user uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_out jsonb;
  v_phone text;
  v_total integer;
  v_min integer := private.pag_setting_int('preco_minimo_online_cents', 2000);
begin
  if coalesce(auth.role(), '') <> 'service_role' then return jsonb_build_object('status', 'forbidden'); end if;
  if p_clinic is null or p_id is null or char_length(coalesce(p_token, '')) not between 16 and 200 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not private.pag_vendas_ligadas() then return jsonb_build_object('status', 'payments_off'); end if;
  if not private.pag_clinic_online(p_clinic) then return jsonb_build_object('status', 'payment_not_available'); end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_phone := regexp_replace(coalesce(p_patient ->> 'phone', ''), '\D', '', 'g');
  if not exists (select 1 from public.appointment_requests a where a.id = p_id) then
    if exists (select 1 from public.appointment_requests a
               where a.patient_phone = v_phone and a.payment_mode = 'online' and a.status in ('hold', 'awaiting_payment')
                 and a.hold_expires_at > now()) then
      return jsonb_build_object('status', 'payment_pending');
    end if;
    if (select count(*) = 3 and bool_and(x.status = 'expired') and max(x.updated_at) > now() - interval '30 minutes'
        from (select a.status, a.updated_at from public.appointment_requests a
              where a.patient_phone = v_phone and a.payment_mode = 'online' order by a.created_at desc limit 3) x) then
      return jsonb_build_object('status', 'too_many_expired');
    end if;
  end if;
  begin
    v_out := private.agenda_book_int(p_clinic, p_items, p_patient, p_id, v_hash, 'hold', 'imed_app', 'app', true, false,
                                     'agenda_pay_hold', v_hash, p_id);
    if v_out ->> 'status' = 'ok' and not coalesce((v_out ->> 'replay')::boolean, false) then
      select a.total_cents into v_total from public.appointment_requests a where a.id = p_id;
      if v_total is null then raise exception 'price_required' using errcode = 'IMP01'; end if;
      if v_total < v_min then raise exception 'below_minimum' using errcode = 'IMP02'; end if;
      update public.appointment_requests a
         set payment_mode = 'online',
             user_id = coalesce((select u.id from auth.users u where u.id = p_user), a.user_id)
       where a.id = p_id;
      v_out := v_out || jsonb_build_object('total_cents', v_total, 'payment_mode', 'online');
    end if;
  exception
    -- (o bloco desfaz tudo o que a reserva gravou: nada fica segurando o horário)
    when sqlstate 'IMP01' then return jsonb_build_object('status', 'price_required');
    when sqlstate 'IMP02' then return jsonb_build_object('status', 'below_minimum', 'min_cents', v_min);
  end;
  return v_out;
end $$;

-- hold → awaiting_payment, quando a cobrança existe no meio de pagamento (o pedido já está travado por quem chama).
-- Só dentro do prazo da reserva. Devolve true se mudou.
create or replace function private.agenda_to_awaiting(p_request uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_prev text := coalesce(current_setting('imed.origin', true), '');
begin
  select * into r from public.appointment_requests a where a.id = p_request for update;
  if not found or not r.uses_resources or r.status <> 'hold' or r.hold_expires_at is null or r.hold_expires_at <= now() then
    return false;
  end if;
  perform set_config('imed.origin', 'app', true);
  update agenda.appointment_items i set status = 'awaiting_payment', version = i.version + 1, updated_at = now()
  where i.request_id = r.id and i.status = 'hold';
  update public.appointment_requests a set status = 'awaiting_payment' where a.id = r.id;
  perform set_config('imed.origin', v_prev, true);
  perform private.agenda_touch(r.clinic_id);
  return true;
end $$;

-- Pagamento aprovado e conferido: confirma o agendamento. Quem chama já pegou, nesta ordem, a trava compartilhada da
-- configuração da clínica, o pedido e a cobrança (§4.6), e já marcou a cobrança como aprovada (P-I1). Aqui entram as
-- travas dos recursos (a última da ordem: configuração → pedido → cobrança → recursos).
--   reserva ou aguardando pagamento (a ocupação ainda é dele): confirma direto, como agenda_confirm;
--   expirado (pagamento atrasado, §4.4): pelo motor completo — travas dos recursos, reservas vencidas soltas, o horário
--     ainda no futuro e livre (regras, pausas, feriados, bloqueios; a antecedência mínima não conta de novo, como no
--     balcão: o paciente marcou no prazo) e o paciente sem outro agendamento no mesmo horário. Não coube: nada muda.
-- Devolve 'confirmed', 'slot_taken' (não dá mais: quem chama devolve o dinheiro) ou 'not_confirmable'.
create or replace function private.agenda_confirm_paid(p_request uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_prev_reason text := coalesce(current_setting('imed.reason', true), '');
  v_tz text;
  v_notice integer;
  v_res uuid[];
  it record;
begin
  select * into r from public.appointment_requests a where a.id = p_request for update;
  if not found or not r.uses_resources then return 'not_confirmable'; end if;
  if r.status = 'confirmed' then return 'confirmed'; end if;
  if r.status not in ('hold', 'awaiting_payment', 'expired') then return 'not_confirmable'; end if;
  -- As travas dos recursos ANTES de mexer na ocupação, também na confirmação direta: com o prazo da reserva vencido, quem
  -- está marcando o mesmo horário já trata a vaga como livre (liberação preguiçosa) e grava a ocupação dele; sem a trava,
  -- as duas transações esperariam uma pela outra na restrição de exclusão (impasse; tests/banco/pagamento-corrida.mjs).
  v_res := private.agenda_candidates(array(select i.procedure_id from agenda.appointment_items i where i.request_id = r.id));
  perform private.agenda_lock_resources(v_res);
  if r.status in ('hold', 'awaiting_payment') then
    perform set_config('imed.origin', 'webhook_pagamento', true);
    update agenda.occupancy o set hold_until = null
    where o.active and o.item_id in (select i.id from agenda.appointment_items i where i.request_id = r.id);
    update agenda.appointment_items i set status = 'confirmed', version = i.version + 1, updated_at = now()
    where i.request_id = r.id and i.status in ('hold', 'awaiting_payment');
    update public.appointment_requests a set status = 'confirmed', hold_expires_at = null where a.id = r.id;
    perform set_config('imed.origin', v_prev, true);
    perform private.agenda_touch(r.clinic_id);
    return 'confirmed';
  end if;
  if r.slot_start is null or r.slot_start <= now() then return 'slot_taken'; end if;
  -- o paciente (mesmo telefone) não pode ter outro agendamento ativo que cruze este horário
  if exists (select 1 from public.appointment_requests o
             where o.id <> r.id and o.patient_phone = r.patient_phone and o.uses_resources
               and private.agenda_active_status(o.status)
               and tstzrange(o.slot_start, o.slot_end, '[)') && tstzrange(r.slot_start, r.slot_end, '[)')) then
    return 'slot_taken';
  end if;
  select c.timezone into v_tz from public.clinics c where c.id = r.clinic_id;
  perform private.agenda_release_expired(v_res);
  begin
    perform set_config('imed.origin', 'cron', true), set_config('imed.reason', 'pagamento_atrasado', true);
    for it in select i.id, i.procedure_id, i.starts_at from agenda.appointment_items i
              where i.request_id = r.id and i.status = 'expired' order by i.seq loop
      select coalesce(p.min_notice_min, u.min_notice_min, 0) into v_notice
      from agenda.procedures p left join agenda.unit_settings u on u.clinic_id = p.clinic_id where p.id = it.procedure_id;
      if not private.agenda_start_ok(r.clinic_id, it.procedure_id, it.starts_at, now() - make_interval(mins => coalesce(v_notice, 0)), v_tz) then
        raise exception 'slot_taken' using errcode = 'IMA03';
      end if;
      perform private.agenda_place(it.id, null,
        array(select distinct o.resource_id from agenda.occupancy o where o.item_id = it.id and o.kind = 'agendamento'));
      update agenda.appointment_items i set status = 'confirmed', version = i.version + 1, updated_at = now() where i.id = it.id;
      perform private.agenda_history(r.id, it.id, 'expired', 'confirmed', 'cron', r.clinic_id, r.version);
    end loop;
    update public.appointment_requests a set status = 'confirmed', cancel_reason = null where a.id = r.id;
  exception
    when sqlstate 'IMA03' or exclusion_violation then
      perform set_config('imed.origin', v_prev, true), set_config('imed.reason', v_prev_reason, true);
      return 'slot_taken';
  end;
  perform set_config('imed.origin', v_prev, true), set_config('imed.reason', v_prev_reason, true);
  perform private.agenda_touch(r.clinic_id);
  return 'confirmed';
end $$;

revoke all on function public.agenda_pay_hold(uuid, jsonb, jsonb, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.agenda_pay_hold(uuid, jsonb, jsonb, uuid, text, uuid) to service_role;
revoke all on function private.agenda_to_awaiting(uuid) from public, anon, authenticated, service_role;
revoke all on function private.agenda_confirm_paid(uuid) from public, anon, authenticated, service_role;

/* ===================== 6. Funções da agenda que mudam de corpo (a volta devolve o de antes) ===================== */

-- private.agenda_expire (3.3): igual, mais uma conferência depois de travar o pedido (§4.6): com uma cobrança
-- "processando" (cartão em análise, fase P4), a reserva só expira depois do teto (teto_processando_min, 30 min depois do
-- prazo da reserva). A cobrança é travada DEPOIS do pedido (a ordem das travas: configuração → pedido → cobrança →
-- recursos).
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
  if r.payment_mode = 'online' then
    perform 1 from pagamentos.charges c where c.request_id = r.id and c.situacao = 'processando' for update;
    if found and r.hold_expires_at
                 + make_interval(mins => greatest(coalesce(v_grace, 0), private.pag_setting_int('teto_processando_min', 30))) > now() then
      return false;
    end if;
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

-- agenda_book (3.3): igual, mais uma recusa (decisão 11): na clínica que recebe pelo site, marcação que pode ser paga
-- online (todos os exames com preço e total a partir do mínimo) não é confirmada sem pagar: payment_required (o site
-- vai por "Ir para o pagamento"). Com tudo desligado a conferência responde "não" na primeira linha.
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
  if private.pag_must_pay(p_clinic, p_items) then return jsonb_build_object('status', 'payment_required'); end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  return private.agenda_book_int(p_clinic, p_items, p_patient, p_id, v_hash, 'confirmed', 'imed_app', 'app', true, false,
                                 'agenda_book', v_hash, p_id);
end $$;

-- agenda_public_info (3.2; o tempo-limite de 2 s é o da 5.1): igual, e o modo de pagamento deixa de ser fixo: na
-- clínica que recebe pelo site, "online", com os meios aceitos e o preço mínimo (três chaves a mais, só nesse caso).
create or replace function public.agenda_public_info(p_clinic uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  c public.clinics;
  u agenda.unit_settings;
  v_online boolean;
  v_pago boolean;
begin
  select * into c from public.clinics x where x.id = p_clinic and x.status = 'published' and not x.is_demo;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into u from agenda.unit_settings s where s.clinic_id = p_clinic;
  v_online := u.clinic_id is not null and c.accepts_online_booking and c.agenda_online_since is not null;
  v_pago := v_online and private.pag_clinic_online(p_clinic);
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
    'payment', case when v_pago then 'online' else 'no_local' end,
    'payment_text', case when v_pago then 'Pagamento aqui no site, na tela do seu agendamento. O horário só fica confirmado depois do pagamento.'
                         else 'Pagamento no local, direto com a clínica.' end,
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
        and exists (select 1 from agenda.procedure_requirements g where g.procedure_id = p.id)), '[]'::jsonb) end)
    || case when v_pago then jsonb_build_object(
         'payment_methods', (select to_jsonb(a.meios) from pagamentos.clinic_accounts a where a.clinic_id = p_clinic),
         'payment_min_cents', private.pag_setting_int('preco_minimo_online_cents', 2000),
         'payment_hold_min', u.hold_minutes)
       else '{}'::jsonb end;
end $$;

-- agenda_my_booking (3.3; o tempo-limite de 2 s é o da 5.1): igual, e no agendamento pago online vem o resumo do
-- pagamento (situação, valor, meio e prazo), sem nenhum dado do meio de pagamento. O "copia e cola" e as devoluções
-- ficam em pag_my_payment (parte 4).
create or replace function public.agenda_my_booking(p_id uuid, p_token text default null)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '2s'
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
                       where i.request_id = r.id), '[]'::jsonb))
    || case when r.payment_mode = 'online' then jsonb_build_object('payment', coalesce((
         select jsonb_build_object('situacao', x.situacao, 'valor_cents', x.valor_cents, 'meio', x.meio,
                                   'expira_em', case when x.situacao in ('criada', 'aguardando') then x.expira_em end,
                                   'paga_em', x.paga_em, 'devolvido_cents', x.devolvido_cents)
         from pagamentos.charges x where x.request_id = r.id
         order by (x.situacao in ('criada', 'aguardando', 'processando', 'aprovada', 'devolvida_parcial', 'contestada')) desc, x.criado_em desc
         limit 1), jsonb_build_object('situacao', 'sem_cobranca', 'valor_cents', r.total_cents)))
       else '{}'::jsonb end;
end $$;

/* ===================== 7. Descrições ===================== */
comment on function public.agenda_pay_hold(uuid, jsonb, jsonb, uuid, text, uuid) is
  'Só o servidor: reserva (hold) do paciente que vai pagar pelo site, pelo núcleo de agenda_book. Só com a chave geral ligada e a clínica recebendo.';
comment on function private.pag_refund_by_rule(uuid, uuid, text) is
  'Regra de devolução (§4.5 da arquitetura do pagamento): pede a devolução na mesma transação do cancelamento. Hoje: total, menos na falta.';
