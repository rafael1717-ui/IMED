-- iMed Pagamentos, fase P1: parte 3 de 5 (as funções que SÓ O SERVIDOR chama, §5.3). O cabeçalho, com o que a migração
-- faz e as conferências, está na parte 1. Volta única: supabase/volta/<versão>_pagamentos_base_parte_5.sql.
--
-- NOME PROVISÓRIO (ainda não aplicada na produção): os 5 passos de "Ao aplicar uma migração provisória na produção" do
-- .github/workflows/banco.yml valem para cada parte (veja o cabeçalho da parte 1).
--
-- Em linguagem simples: o que as Edge Functions da fase P2 (pagamento-criar, pagamento-webhook, pagamento-rotina) vão
-- chamar. Todas ficam em public só para o servidor alcançar (o schema pagamentos é fechado até para ele): conferem
-- auth.role() = 'service_role' por dentro e só service_role tem EXECUTE; visitante e pessoa logada nem executam.
--   pag_payer_upsert / pag_payer_attach   o pagador (só o HMAC do CPF e o id do cliente no provedor)
--   pag_charge_open                       confere o código do agendamento, a reserva viva, a clínica e o preço mínimo;
--                                         calcula tudo a partir dos itens do banco; fotografa a taxa; cobrança "criada"
--   pag_charge_attach                     a cobrança existe no provedor: "aguardando"; agendamento "aguardando pagamento"
--   pag_charge_abort                      a cobrança não nasceu: solta a reserva na hora
--   pag_event_store                       grava o aviso (repetido não entra duas vezes)
--   pag_sync_apply                        aplica a situação CONSULTADA no provedor (o aviso é só a campainha): ordem das
--                                         travas, precedência, valor, confirmação do agendamento, extrato; devolve a
--                                         próxima ação
--   pag_due                               o que a rotina tem a fazer agora
--   pag_refund_sent / _done / _failed     andamento da devolução (uma por vez por cobrança; a divisão é calculada no envio)
--   pag_reconcile_apply                   conciliação diária: compara e grava as diferenças (não corrige nada)
--   pag_subscription_sync                 situação da mensalidade e da faixa de destaque
-- Nada chama a internet daqui: quem fala com o provedor é a Edge Function. Pode rodar de novo sem erro.

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Apoio ===================== */

create or replace function private.pag_servidor()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role';
$$;

-- O que o servidor precisa para criar a cobrança no provedor (§6.3: só valor, divisão, descrição fixa e referência).
create or replace function private.pag_charge_payload(p_charge uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'charge_id', c.id, 'situacao', c.situacao, 'meio', c.meio, 'valor_cents', c.valor_cents, 'taxa_cents', c.taxa_cents,
    'clinica_cents', c.clinica_cents, 'emitida_por', c.emitida_por, 'wallet_id', a.wallet_id, 'expira_em', c.expira_em,
    'tentativa', c.tentativa, 'referencia', c.id, 'provedor_cobranca_id', c.provedor_cobranca_id,
    'descricao', 'IMED · agendamento ' || upper(left(c.request_id::text, 8)),
    'provedor_cliente_id', (select p.provedor_cliente_id from pagamentos.payers p where p.id = c.payer_id))
  from pagamentos.charges c left join pagamentos.clinic_accounts a on a.clinic_id = c.clinic_id
  where c.id = p_charge;
$$;

-- Abre uma diferença para a equipe fora da rodada diária (valor pago diferente, devolução feita por fora): entra numa
-- rodada "manual" e aparece na conciliação da gestão. A mesma diferença, ainda aberta, não entra duas vezes.
create or replace function private.pag_diff_abrir(p_tipo text, p_charge uuid, p_provedor_id text, p_nosso jsonb, p_deles jsonb,
                                                  p_gravidade text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_run uuid;
begin
  if exists (select 1 from pagamentos.reconciliation_diffs d
             where d.resolvida_em is null and d.tipo = p_tipo and coalesce(d.provedor_cobranca_id, '') = coalesce(p_provedor_id, '')
               and coalesce(d.charge_id, '00000000-0000-0000-0000-000000000000') = coalesce(p_charge, '00000000-0000-0000-0000-000000000000')) then
    return;
  end if;
  insert into pagamentos.reconciliation_runs (dia, janela, terminou, situacao, contadores)
  values ((now() at time zone 'America/Sao_Paulo')::date, 'manual', now(), 'concluida', jsonb_build_object('origem', 'aviso'))
  returning id into v_run;
  insert into pagamentos.reconciliation_diffs (run_id, provedor_cobranca_id, charge_id, tipo, nosso, deles, critica, gravidade)
  values (v_run, p_provedor_id, p_charge, p_tipo, p_nosso, p_deles, p_gravidade = 'critica', p_gravidade);
end $$;

-- Dinheiro que chegou numa cobrança que não pode ser aprovada: pede a devolução INTEIRA do que chegou (uma só).
create or replace function private.pag_refund_integral(p_charge uuid, p_valor integer, p_motivo text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_clinic uuid;
begin
  select r.id into v_id from pagamentos.refunds r where r.charge_id = p_charge and r.integral and r.situacao <> 'desfeita' limit 1;
  if v_id is not null then return v_id; end if;
  insert into pagamentos.refunds (charge_id, integral, automatica, valor_cents, motivo, pedido_por_tipo, chave_idempotencia)
  values (p_charge, true, true, p_valor, p_motivo, 'sistema', gen_random_uuid())
  returning id into v_id;
  select c.clinic_id into v_clinic from pagamentos.charges c where c.id = p_charge;
  perform private.pag_audit('devolucao.pedida', p_charge, v_id, v_clinic, null, null,
                            jsonb_build_object('valor_cents', p_valor, 'integral', true), p_motivo, 'sistema');
  return v_id;
end $$;

-- Conclui uma devolução (quem chama já travou a cobrança): soma no exame e na cobrança, grava o extrato e fecha o
-- pedido. Na devolução integral (cobrança que não foi aprovada) só o que chegou sai: não há taxa nem repasse a desfazer.
create or replace function private.pag_refund_conclude(p_refund uuid, p_estorno text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  f pagamentos.refunds;
  c pagamentos.charges;
begin
  select * into f from pagamentos.refunds x where x.id = p_refund for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if f.situacao = 'concluida' then return jsonb_build_object('status', 'ok', 'replay', true); end if;
  if f.situacao not in ('enviada', 'falhou') or (not f.integral and f.taxa_cents is null) then
    return jsonb_build_object('status', 'not_sent', 'situacao', f.situacao);
  end if;
  select * into c from pagamentos.charges x where x.id = f.charge_id for update;
  if f.integral then
    perform private.pag_ledger(c.id, f.id, c.clinic_id, 'devolucao', -f.valor_cents, 'paciente');
    if c.situacao in ('expirada', 'cancelada') then
      update pagamentos.charges x set situacao = 'devolvida' where x.id = c.id;
    end if;
  else
    update pagamentos.charge_items ci set devolvido_cents = ci.devolvido_cents + fi.valor_cents
    from pagamentos.refund_items fi where fi.refund_id = f.id and ci.charge_id = c.id and ci.item_id = fi.item_id;
    update pagamentos.charges x
       set devolvido_cents = x.devolvido_cents + f.valor_cents,
           taxa_devolvida_cents = x.taxa_devolvida_cents + f.taxa_cents,
           clinica_devolvida_cents = x.clinica_devolvida_cents + f.clinica_cents,
           situacao = case when x.situacao = 'contestada' then x.situacao
                           when x.devolvido_cents + f.valor_cents = x.valor_cents then 'devolvida'
                           else 'devolvida_parcial' end
     where x.id = c.id;
    perform private.pag_ledger(c.id, f.id, c.clinic_id, 'devolucao', -f.valor_cents, 'paciente');
    perform private.pag_ledger(c.id, f.id, c.clinic_id, 'devolucao_taxa', -f.taxa_cents, 'imed');
    perform private.pag_ledger(c.id, f.id, c.clinic_id, 'devolucao_repasse', -f.clinica_cents, 'clinica');
  end if;
  update pagamentos.refunds x
     set situacao = 'concluida', concluida_em = now(), atualizado_em = now(), ultimo_erro = null,
         provedor_estorno_id = coalesce(case when p_estorno ~ '^[A-Za-z0-9_-]{1,80}$' then p_estorno end, x.provedor_estorno_id)
   where x.id = f.id;
  perform private.pag_audit('devolucao.concluida', c.id, f.id, c.clinic_id, null, null,
                            jsonb_build_object('valor_cents', f.valor_cents, 'taxa_cents', f.taxa_cents,
                                               'clinica_cents', f.clinica_cents, 'integral', f.integral), f.motivo, 'rotina');
  return jsonb_build_object('status', 'ok', 'valor_cents', f.valor_cents);
end $$;

-- Tarifa esperada do meio de pagamento (parâmetros "a confirmar"): só para a conciliação apontar quando a real difere.
create or replace function private.pag_tarifa_esperada(p_meio text, p_valor integer)
returns integer
language sql stable
set search_path = ''
as $$
  select case p_meio
    when 'pix' then private.pag_setting_int('tarifa_pix_cents', null)
    when 'cartao' then ((p_valor::bigint * private.pag_setting_int('tarifa_cartao_bps', null) + 5000) / 10000)::integer
                       + private.pag_setting_int('tarifa_cartao_fixo_cents', null) end;
$$;

revoke all on function private.pag_servidor() from public, anon, authenticated, service_role;
revoke all on function private.pag_charge_payload(uuid) from public, anon, authenticated, service_role;
revoke all on function private.pag_diff_abrir(text, uuid, text, jsonb, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function private.pag_refund_integral(uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function private.pag_refund_conclude(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.pag_tarifa_esperada(text, integer) from public, anon, authenticated, service_role;

/* ===================== 2. Pagador ===================== */

-- O pagador pelo HMAC do CPF (calculado na Edge Function, com chave que não fica no banco): o mesmo CPF não vira dois
-- clientes no provedor. Sem nome e sem CPF aqui.
create or replace function public.pag_payer_upsert(p_cpf_hmac text, p_user uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p pagamentos.payers;
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  if p_cpf_hmac is null or p_cpf_hmac !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status', 'invalid'); end if;
  insert into pagamentos.payers (cpf_hmac, user_id)
  values (p_cpf_hmac, (select u.id from auth.users u where u.id = p_user))
  on conflict on constraint payers_hmac_uq do update set user_id = coalesce(pagamentos.payers.user_id, excluded.user_id)
  returning * into p;
  return jsonb_build_object('status', 'ok', 'payer_id', p.id, 'provedor_cliente_id', p.provedor_cliente_id);
end $$;

create or replace function public.pag_payer_attach(p_payer uuid, p_provedor_cliente_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  if p_payer is null or coalesce(p_provedor_cliente_id, '') !~ '^[A-Za-z0-9_-]{4,80}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  update pagamentos.payers p set provedor_cliente_id = coalesce(p.provedor_cliente_id, p_provedor_cliente_id) where p.id = p_payer;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok',
    'provedor_cliente_id', (select p.provedor_cliente_id from pagamentos.payers p where p.id = p_payer));
end $$;

/* ===================== 3. Cobrança ===================== */

-- Abre a cobrança de um agendamento reservado para pagar (agenda_pay_hold). p_token: o código do agendamento (o banco
-- guarda o SHA-256). p_key: idempotência (a mesma chave devolve a mesma cobrança). Os valores vêm SEMPRE dos itens do
-- banco (o preço fotografado na reserva), nunca do navegador; a taxa é a regra em vigor agora, fotografada exame a exame.
create or replace function public.pag_charge_open(p_request uuid, p_token text, p_meio text, p_key uuid, p_payer uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  a pagamentos.clinic_accounts;
  c pagamentos.charges;
  v_rule pagamentos.fee_rules;
  v_min integer := private.pag_setting_int('preco_minimo_online_cents', 2000);
  v_n integer;
  v_sem_preco integer;
  v_valor bigint;
  v_taxa bigint;
  v_id uuid;
  v_exp timestamptz;
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  if p_request is null or p_key is null or p_meio is null or p_meio not in ('pix', 'cartao') then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into r from public.appointment_requests x where x.id = p_request for update;
  if not found or (r.review_token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')) is not true then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into c from pagamentos.charges x where x.chave_idempotencia = p_key;
  if found then
    if c.request_id is distinct from p_request then return jsonb_build_object('status', 'idempotency_conflict'); end if;
    return jsonb_build_object('status', 'ok', 'replay', true) || private.pag_charge_payload(c.id);
  end if;
  if not private.pag_vendas_ligadas() then return jsonb_build_object('status', 'payments_off'); end if;
  if r.payment_mode <> 'online' or not r.uses_resources then return jsonb_build_object('status', 'not_payable'); end if;
  if r.status not in ('hold', 'awaiting_payment') or r.hold_expires_at is null or r.hold_expires_at <= now() then
    return jsonb_build_object('status', 'hold_expired', 'request_status', r.status);
  end if;
  select * into a from pagamentos.clinic_accounts x where x.clinic_id = r.clinic_id;
  if a.clinic_id is null or a.situacao <> 'ativa' or not private.pag_clinic_online(r.clinic_id) then
    return jsonb_build_object('status', 'payment_not_available');
  end if;
  if not (p_meio = any (a.meios)) then return jsonb_build_object('status', 'method_not_available'); end if;
  select count(*), count(*) filter (where i.price_cents is null), sum(i.price_cents) into v_n, v_sem_preco, v_valor
  from agenda.appointment_items i where i.request_id = r.id and i.status in ('hold', 'awaiting_payment');
  if v_n = 0 or v_sem_preco > 0 or r.total_cents is null then return jsonb_build_object('status', 'price_required'); end if;
  if v_valor <> r.total_cents then return jsonb_build_object('status', 'invalid'); end if;
  if v_valor < v_min then return jsonb_build_object('status', 'below_minimum', 'min_cents', v_min); end if;
  select * into c from pagamentos.charges x
  where x.request_id = r.id and x.situacao in ('criada', 'aguardando', 'processando', 'aprovada', 'devolvida_parcial', 'contestada');
  if found then
    return jsonb_build_object('status', 'charge_exists') || private.pag_charge_payload(c.id);
  end if;
  select count(*) into v_n from pagamentos.charges x where x.request_id = r.id;
  if v_n >= private.pag_setting_int('max_tentativas_cobranca', 3) then
    return jsonb_build_object('status', 'too_many_attempts');
  end if;
  v_rule := private.pag_fee_rule(r.clinic_id, 'exame', now());
  if v_rule.id is null then return jsonb_build_object('status', 'fee_not_configured'); end if;
  select sum(private.pag_fee(v_rule.tipo, v_rule.fee_bps, v_rule.fee_cents, i.price_cents)) into v_taxa
  from agenda.appointment_items i where i.request_id = r.id and i.status in ('hold', 'awaiting_payment');
  -- Pix: o QR some antes do fim da reserva (minutos_qr); cartão: até o fim da reserva
  v_exp := case when p_meio = 'pix'
                then least(now() + make_interval(mins => private.pag_setting_int('minutos_qr', 8)), r.hold_expires_at)
                else r.hold_expires_at end;
  insert into pagamentos.charges (finalidade, request_id, clinic_id, payer_id, emitida_por, meio, valor_cents, fee_rule_id, fee_bps,
                                  taxa_cents, clinica_cents, expira_em, tentativa, chave_idempotencia)
  values ('agendamento', r.id, r.clinic_id, (select p.id from pagamentos.payers p where p.id = p_payer), a.emitida_por, p_meio,
          v_valor, v_rule.id, v_rule.fee_bps, v_taxa, v_valor - v_taxa, v_exp, v_n + 1, p_key)
  returning id into v_id;
  insert into pagamentos.charge_items (charge_id, item_id, preco_cents, taxa_cents, clinica_cents)
  select v_id, i.id, i.price_cents, private.pag_fee(v_rule.tipo, v_rule.fee_bps, v_rule.fee_cents, i.price_cents),
         i.price_cents - private.pag_fee(v_rule.tipo, v_rule.fee_bps, v_rule.fee_cents, i.price_cents)
  from agenda.appointment_items i where i.request_id = r.id and i.status in ('hold', 'awaiting_payment');
  perform private.pag_audit('cobranca.criada', v_id, null, r.clinic_id, null, null,
    jsonb_build_object('valor_cents', v_valor, 'taxa_cents', v_taxa, 'meio', p_meio, 'tentativa', v_n + 1), null, 'servidor');
  return jsonb_build_object('status', 'ok') || private.pag_charge_payload(v_id);
end $$;

-- A cobrança foi criada no provedor: criada → aguardando, e o agendamento hold → awaiting_payment. Quem vence é a NOSSA
-- cobrança (o QR do provedor não vence em minutos): o prazo nunca passa do calculado na criação. Se a reserva já não
-- vale (expirou ou foi cancelada no meio do caminho), a cobrança fica cancelada com o id do provedor, e a rotina a apaga lá.
create or replace function public.pag_charge_attach(p_charge uuid, p_provedor_id text, p_expira timestamptz default null,
                                                    p_copia_cola text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req uuid;
  r public.appointment_requests;
  c pagamentos.charges;
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  if p_charge is null or coalesce(p_provedor_id, '') !~ '^[A-Za-z0-9_-]{4,80}$' or char_length(coalesce(p_copia_cola, '')) > 1000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select x.request_id into v_req from pagamentos.charges x where x.id = p_charge;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_req is not null then
    select * into r from public.appointment_requests x where x.id = v_req for update;
  end if;
  select * into c from pagamentos.charges x where x.id = p_charge for update;
  if c.situacao = 'aguardando' and c.provedor_cobranca_id = p_provedor_id then
    return jsonb_build_object('status', 'ok', 'replay', true, 'expira_em', c.expira_em);
  end if;
  if c.provedor_cobranca_id is not null and c.provedor_cobranca_id <> p_provedor_id then
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;
  if exists (select 1 from pagamentos.charges x where x.provedor = c.provedor and x.provedor_cobranca_id = p_provedor_id and x.id <> c.id) then
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;
  if c.situacao <> 'criada' then
    -- (cancelada enquanto o provedor respondia: guarda o id para a rotina apagar lá)
    if c.situacao = 'cancelada' and c.provedor_cobranca_id is null then
      update pagamentos.charges x set provedor_cobranca_id = p_provedor_id where x.id = c.id;
    end if;
    return jsonb_build_object('status', 'not_attachable', 'situacao', c.situacao, 'acao', 'apagar');
  end if;
  if v_req is not null and not (r.status = 'awaiting_payment' and r.hold_expires_at > now())
     and not private.agenda_to_awaiting(r.id) then
    update pagamentos.charges x set situacao = 'cancelada', provedor_cobranca_id = p_provedor_id where x.id = c.id;
    return jsonb_build_object('status', 'hold_expired', 'acao', 'apagar');
  end if;
  update pagamentos.charges x
     set situacao = 'aguardando', provedor_cobranca_id = p_provedor_id,
         expira_em = least(x.expira_em, coalesce(p_expira, x.expira_em)),
         pix_copia_cola = nullif(p_copia_cola, '')
   where x.id = c.id
  returning * into c;
  return jsonb_build_object('status', 'ok', 'expira_em', c.expira_em);
end $$;

-- A cobrança não nasceu no provedor (fora do ar, ou a função caiu no meio): o sistema solta a reserva na hora (§4.4).
-- Só reserva paga online ainda em "hold" (sem cobrança no provedor). O gatilho do pedido cancela a cobrança "criada".
create or replace function public.pag_charge_abort(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  select * into r from public.appointment_requests x where x.id = p_request for update;
  if not found or r.payment_mode <> 'online' or not r.uses_resources then return jsonb_build_object('status', 'not_found'); end if;
  if r.status = 'cancelled' then return jsonb_build_object('status', 'ok', 'replay', true); end if;
  if r.status <> 'hold' then return jsonb_build_object('status', 'transition_not_allowed', 'request_status', r.status); end if;
  perform private.agenda_cancel_do(r.id, 'cron', 'system', 'nao_pago');
  perform private.agenda_touch(r.clinic_id);
  return jsonb_build_object('status', 'ok');
end $$;

/* ===================== 4. Avisos ===================== */

-- Grava o aviso do provedor: só os campos da lista e o hash do corpo. O mesmo aviso (mesmo id) não entra duas vezes: o
-- segundo só soma em "repeticoes" e responde "repetido". Aviso de cobrança que não é nossa: guardado como sem_cobranca.
create or replace function public.pag_event_store(p_provedor text, p_evento_id text, p_tipo text, p_provedor_cobranca_id text,
                                                  p_situacao text default null, p_valor_cents integer default null,
                                                  p_ocorrido_em timestamptz default null, p_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_novo boolean;
  v_res text;
  v_charge uuid;
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  begin
    insert into pagamentos.events as e (provedor, provedor_evento_id, tipo, provedor_cobranca_id, situacao_no_provedor, valor_cents,
                                        ocorrido_em, hash_do_corpo)
    values (p_provedor, p_evento_id, p_tipo, p_provedor_cobranca_id, p_situacao, p_valor_cents, p_ocorrido_em, p_hash)
    on conflict on constraint events_evento_uq do update set repeticoes = e.repeticoes + 1
    returning e.id, (e.xmax = 0), e.resultado, e.charge_id into v_id, v_novo, v_res, v_charge;
  exception when check_violation or not_null_violation then
    return jsonb_build_object('status', 'invalid');
  end;
  if not v_novo then
    return jsonb_build_object('status', 'repetido', 'event_id', v_id, 'resultado', v_res, 'charge_id', v_charge);
  end if;
  select c.id into v_charge from pagamentos.charges c where c.provedor = p_provedor and c.provedor_cobranca_id = p_provedor_cobranca_id;
  if v_charge is null then
    update pagamentos.events e set resultado = 'sem_cobranca', aplicado_em = now() where e.id = v_id;
    return jsonb_build_object('status', 'sem_cobranca', 'event_id', v_id);
  end if;
  update pagamentos.events e set charge_id = v_charge where e.id = v_id;
  return jsonb_build_object('status', 'ok', 'event_id', v_id, 'charge_id', v_charge);
end $$;

-- Aplica a situação da cobrança CONSULTADA no provedor (p_foto), não o corpo do aviso: a ordem de chegada não importa.
-- p_foto: situacao (aguardando, processando, paga, recusada, apagada, devolvida, devolvida_parcial, contestada,
-- contestacao_ganha, contestacao_perdida), valor_cents (o que foi pago), tarifa_cents, devolvido_cents, paga_em,
-- provedor_estorno_id, provedor_disputa_id, motivo. p_event: o aviso que tocou a campainha (recebe o resultado).
-- Travas, nesta ordem: configuração da clínica (compartilhada) → pedido → cobrança → recursos (só no pagamento atrasado).
-- Situação que anda para trás é ignorada e registrada. Devolve o resultado e a próxima ação para a rotina:
-- nenhuma, devolver (há devolução pedida para enviar) ou conferir (diferença aberta para a equipe).
create or replace function public.pag_sync_apply(p_charge uuid, p_foto jsonb, p_event bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req uuid;
  v_clinic uuid;
  r public.appointment_requests;
  c pagamentos.charges;
  f pagamentos.refunds;
  v_sit text;
  v_valor integer;
  v_tarifa integer;
  v_dev integer;
  v_paga timestamptz;
  v_res text := 'aplicado';
  v_acao text := 'nenhuma';
  v_conf text;
  v_prev text := coalesce(current_setting('imed.origin', true), '');
  v_teto integer := private.pag_setting_int('teto_processando_min', 30);
  v_resto integer;
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  if p_charge is null or jsonb_typeof(p_foto) is distinct from 'object' then return jsonb_build_object('status', 'invalid'); end if;
  v_sit := p_foto ->> 'situacao';
  if v_sit is null or v_sit not in ('aguardando', 'processando', 'paga', 'recusada', 'apagada', 'devolvida', 'devolvida_parcial',
                                    'contestada', 'contestacao_ganha', 'contestacao_perdida') then
    return jsonb_build_object('status', 'invalid');
  end if;
  begin
    v_valor := (p_foto ->> 'valor_cents')::integer;
    v_tarifa := (p_foto ->> 'tarifa_cents')::integer;
    v_dev := (p_foto ->> 'devolvido_cents')::integer;
    v_paga := (p_foto ->> 'paga_em')::timestamptz;
  exception when others then
    return jsonb_build_object('status', 'invalid');
  end;
  if coalesce(v_valor, 0) < 0 or coalesce(v_tarifa, 0) < 0 or coalesce(v_dev, 0) < 0 or (v_sit = 'paga' and v_valor is null) then
    return jsonb_build_object('status', 'invalid');
  end if;
  -- lê a cobrança sem trava para achar o pedido; trava o pedido, trava a cobrança e lê de novo (§4.6)
  select x.request_id, x.clinic_id into v_req, v_clinic from pagamentos.charges x where x.id = p_charge;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_req is not null then
    perform private.agenda_lock_config(v_clinic, false);
    select * into r from public.appointment_requests x where x.id = v_req for update;
  end if;
  select * into c from pagamentos.charges x where x.id = p_charge for update;

  if v_sit = 'aguardando' then
    v_res := case when c.situacao = 'aguardando' then 'repetido' else 'ignorado_antigo' end;

  elsif v_sit = 'processando' then
    if c.situacao = 'aguardando' then
      update pagamentos.charges x set situacao = 'processando' where x.id = c.id;
      if v_req is not null and r.status in ('hold', 'awaiting_payment') and r.hold_expires_at is not null then
        -- a análise do cartão segura o horário até o teto (a expiração da agenda espera: private.agenda_expire)
        perform set_config('imed.origin', 'webhook_pagamento', true);
        update agenda.occupancy o set hold_until = greatest(o.hold_until, r.hold_expires_at + make_interval(mins => v_teto))
        where o.active and o.hold_until is not null
          and o.item_id in (select i.id from agenda.appointment_items i where i.request_id = r.id);
        perform set_config('imed.origin', v_prev, true);
      end if;
    else
      v_res := case when c.situacao = 'processando' then 'repetido' else 'ignorado_antigo' end;
    end if;

  elsif v_sit = 'recusada' then
    if c.situacao in ('aguardando', 'processando') then
      update pagamentos.charges x set situacao = 'recusada' where x.id = c.id;
    else
      v_res := case when c.situacao = 'recusada' then 'repetido' else 'ignorado_antigo' end;
    end if;

  elsif v_sit = 'apagada' then
    if c.situacao in ('aguardando', 'processando') then
      update pagamentos.charges x
         set situacao = case when x.expira_em <= now() then 'expirada' else 'cancelada' end, apagada_no_provedor_em = now()
       where x.id = c.id;
    elsif c.situacao in ('criada', 'cancelada', 'expirada', 'recusada') then
      if c.apagada_no_provedor_em is null and c.situacao <> 'criada' then
        update pagamentos.charges x set apagada_no_provedor_em = now() where x.id = c.id;
      else
        v_res := 'repetido';
      end if;
    else
      -- o provedor diz "apagada" e aqui ela está paga: não mexe em nada; a equipe confere
      v_res := 'erro';
      v_acao := 'conferir';
      perform private.pag_diff_abrir('falta_la', c.id, c.provedor_cobranca_id, jsonb_build_object('situacao', c.situacao),
                                     jsonb_build_object('situacao', 'apagada'), 'critica');
    end if;

  elsif v_sit = 'paga' then
    if c.situacao in ('aprovada', 'devolvida_parcial', 'devolvida', 'contestada') or (c.situacao in ('expirada', 'cancelada') and c.paga_em is not null) then
      v_res := 'repetido';
      if c.tarifa_meio_cents is null and v_tarifa is not null and c.situacao in ('aprovada', 'devolvida_parcial', 'contestada') then
        update pagamentos.charges x set tarifa_meio_cents = v_tarifa where x.id = c.id;
        perform private.pag_ledger(c.id, null, c.clinic_id, 'tarifa_meio', v_tarifa, 'meio');
      end if;
    elsif c.situacao in ('aguardando', 'processando') and v_valor <> c.valor_cents then
      -- valor pago diferente do esperado: não confirma, abre diferença crítica e devolve o que chegou (§4.4)
      update pagamentos.charges x set situacao = 'cancelada', paga_em = coalesce(v_paga, now()), pago_cents = v_valor where x.id = c.id;
      perform private.pag_ledger(c.id, null, c.clinic_id, 'recebido', v_valor, 'paciente');
      perform private.pag_refund_integral(c.id, v_valor, 'valor_divergente');
      perform private.pag_diff_abrir('valor', c.id, c.provedor_cobranca_id, jsonb_build_object('valor_cents', c.valor_cents),
                                     jsonb_build_object('valor_cents', v_valor), 'critica');
      perform private.pag_audit('cobranca.valor_divergente', c.id, null, c.clinic_id, null,
                                jsonb_build_object('valor_cents', c.valor_cents), jsonb_build_object('valor_cents', v_valor), null, 'webhook');
      v_res := 'valor_divergente';
      v_acao := 'devolver';
    elsif c.situacao in ('aguardando', 'processando') then
      update pagamentos.charges x
         set situacao = 'aprovada', paga_em = coalesce(v_paga, now()), pago_cents = v_valor, tarifa_meio_cents = v_tarifa
       where x.id = c.id;
      perform private.pag_ledger(c.id, null, c.clinic_id, 'recebido', c.valor_cents, 'paciente');
      if c.finalidade in ('destaque', 'consultorio') then
        perform private.pag_ledger(c.id, null, c.clinic_id, 'mensalidade', c.valor_cents, 'imed');
      else
        perform private.pag_ledger(c.id, null, c.clinic_id, 'taxa_imed', c.taxa_cents, 'imed');
        perform private.pag_ledger(c.id, null, c.clinic_id, 'repasse_clinica', c.clinica_cents, 'clinica');
      end if;
      perform private.pag_ledger(c.id, null, c.clinic_id, 'tarifa_meio', coalesce(v_tarifa, 0), 'meio');
      perform private.pag_audit('cobranca.aprovada', c.id, null, c.clinic_id, null, null,
                                jsonb_build_object('valor_cents', c.valor_cents, 'tarifa_cents', v_tarifa), null, 'webhook');
      if v_req is not null then
        v_conf := private.agenda_confirm_paid(r.id);
        if v_conf <> 'confirmed' then
          -- pagamento depois de a reserva expirar e o horário não está mais livre (ou o agendamento não pode mais ser
          -- confirmado): devolve tudo, na mesma transação (P-I2). Nunca passa por cima de outro paciente.
          perform set_config('imed.origin', 'cron', true);
          perform private.pag_refund_by_rule(r.id, null, 'pagamento_atrasado');
          perform set_config('imed.origin', v_prev, true);
          v_acao := 'devolver';
        end if;
      end if;
    elsif c.situacao in ('expirada', 'cancelada') then
      -- dinheiro numa cobrança já encerrada: nunca reabre; volta inteiro (expirada e cancelada não voltam a aprovada)
      update pagamentos.charges x set paga_em = coalesce(v_paga, now()), pago_cents = v_valor where x.id = c.id;
      perform private.pag_ledger(c.id, null, c.clinic_id, 'recebido', v_valor, 'paciente');
      perform private.pag_refund_integral(c.id, v_valor, 'pagamento_fora_do_prazo');
      perform private.pag_audit('cobranca.paga_fora_do_prazo', c.id, null, c.clinic_id, null, jsonb_build_object('situacao', c.situacao),
                                jsonb_build_object('valor_cents', v_valor), null, 'webhook');
      v_acao := 'devolver';
    else
      v_res := 'erro';
      v_acao := 'conferir';
    end if;

  elsif v_sit in ('devolvida', 'devolvida_parcial') then
    select * into f from pagamentos.refunds x where x.charge_id = c.id and x.situacao = 'enviada';
    if c.situacao = 'devolvida' then
      v_res := 'repetido';
    elsif f.id is not null and (f.integral or v_dev is null or v_dev = c.devolvido_cents + f.valor_cents) then
      perform private.pag_refund_conclude(f.id, p_foto ->> 'provedor_estorno_id');
    elsif v_dev is not null and v_dev = c.devolvido_cents then
      v_res := 'repetido';
    else
      -- devolução que não saiu daqui (feita na tela do provedor) ou de outro valor: a equipe confere
      v_res := 'valor_divergente';
      v_acao := 'conferir';
      perform private.pag_diff_abrir('situacao', c.id, c.provedor_cobranca_id, jsonb_build_object('devolvido_cents', c.devolvido_cents),
                                     jsonb_build_object('devolvido_cents', v_dev), 'alta');
    end if;

  elsif v_sit = 'contestada' then
    if c.situacao in ('aprovada', 'devolvida_parcial') then
      v_resto := c.valor_cents - c.devolvido_cents;
      update pagamentos.charges x set situacao = 'contestada' where x.id = c.id;
      insert into pagamentos.disputes (charge_id, provedor_disputa_id, motivo, prazo)
      values (c.id, case when p_foto ->> 'provedor_disputa_id' ~ '^[A-Za-z0-9_-]{1,80}$' then p_foto ->> 'provedor_disputa_id' end,
              case when p_foto ->> 'motivo' ~ '^[a-z][a-z0-9_]{2,59}$' then p_foto ->> 'motivo' end,
              case when p_foto ->> 'prazo' is not null then (p_foto ->> 'prazo')::timestamptz end)
      on conflict (charge_id) where encerrada_em is null do nothing;
      perform private.pag_ledger(c.id, null, c.clinic_id, 'contestacao', -v_resto, 'paciente');
      perform private.pag_audit('cobranca.contestada', c.id, null, c.clinic_id, null, null, jsonb_build_object('valor_cents', v_resto), null, 'webhook');
      v_acao := 'conferir';
    else
      v_res := case when c.situacao = 'contestada' then 'repetido' else 'ignorado_antigo' end;
    end if;

  elsif v_sit in ('contestacao_ganha', 'contestacao_perdida') then
    if c.situacao = 'contestada' then
      v_resto := c.valor_cents - c.devolvido_cents;
      update pagamentos.disputes d
         set situacao = 'encerrada', encerrada_em = now(), resultado = case v_sit when 'contestacao_ganha' then 'ganha' else 'perdida' end
       where d.charge_id = c.id and d.encerrada_em is null;
      if v_sit = 'contestacao_ganha' then
        update pagamentos.charges x set situacao = case when x.devolvido_cents > 0 then 'devolvida_parcial' else 'aprovada' end where x.id = c.id;
        perform private.pag_ledger(c.id, null, c.clinic_id, 'contestacao_revertida', v_resto, 'paciente');
      else
        update pagamentos.charges x set situacao = 'devolvida' where x.id = c.id;
      end if;
      perform private.pag_audit('cobranca.contestacao_encerrada', c.id, null, c.clinic_id, null, null,
                                jsonb_build_object('resultado', v_sit), null, 'webhook');
    else
      v_res := 'ignorado_antigo';
    end if;
  end if;

  update pagamentos.charges x set consultada_em = now() where x.id = c.id;
  if v_res = 'ignorado_antigo' then
    perform private.pag_audit('cobranca.aviso_antigo', c.id, null, c.clinic_id, null, jsonb_build_object('situacao', c.situacao),
                              jsonb_build_object('situacao', v_sit), null, 'webhook');
  end if;
  if p_event is not null then
    update pagamentos.events e set resultado = v_res, aplicado_em = now(), charge_id = c.id
    where e.id = p_event and e.resultado = 'pendente';
  end if;
  select * into c from pagamentos.charges x where x.id = p_charge;
  return jsonb_build_object('status', 'ok', 'resultado', v_res, 'situacao', c.situacao, 'acao', v_acao,
    'request_status', (select a.status from public.appointment_requests a where a.id = v_req));
end $$;

/* ===================== 5. Rotina ===================== */

-- O que a rotina (Edge Function pagamento-rotina, a cada minuto) tem a fazer agora. Só leitura.
--   abortar ............. reserva paga online sem cobrança no provedor há mais de 60 s (§4.4) → pag_charge_abort
--   apagar .............. cobrança vencida, cancelada ou com a análise além do teto, ainda não apagada no provedor
--                         (a rotina consulta antes: se já foi paga, aplica o pagamento em vez de apagar)
--   consultar ........... cobrança esperando perto de vencer ou em análise, sem aviso
--   enviar_devolucao .... devolução pedida (ou que falhou), a mais antiga de cada cobrança, sem outra no ar
--   reenviar_devolucao .. devolução enviada há mais de 5 min sem resposta (mesma chave: não devolve duas vezes)
--   reaplicar ........... aviso gravado e ainda não aplicado há mais de 1 min
--   conciliar ........... dias sem conciliação concluída: ontem, D−7, D−32 e qualquer buraco dos últimos 14 dias (§5.4)
create or replace function public.pag_due()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_teto integer := private.pag_setting_int('teto_processando_min', 30);
  v_acoes jsonb;
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  select coalesce(jsonb_agg(x.a order by x.ord, x.quando), '[]'::jsonb) into v_acoes
  from (
    (select 1 as ord, a.created_at as quando, jsonb_build_object('acao', 'abortar', 'request_id', a.id) as a
     from public.appointment_requests a
     where a.payment_mode = 'online' and a.status = 'hold' and a.created_at < now() - interval '60 seconds'
     order by a.created_at limit 100)
    union all
    (select 2, c.criado_em, jsonb_build_object('acao', 'apagar', 'charge_id', c.id, 'provedor_cobranca_id', c.provedor_cobranca_id)
     from pagamentos.charges c
     where c.provedor_cobranca_id is not null and c.apagada_no_provedor_em is null and c.paga_em is null
       and ((c.situacao = 'aguardando' and c.expira_em <= now())
            or (c.situacao = 'processando' and c.expira_em + make_interval(mins => v_teto) <= now())
            or c.situacao in ('cancelada', 'expirada'))
     order by c.criado_em limit 100)
    union all
    (select 3, c.criado_em, jsonb_build_object('acao', 'consultar', 'charge_id', c.id, 'provedor_cobranca_id', c.provedor_cobranca_id)
     from pagamentos.charges c
     where (c.situacao = 'aguardando' and c.expira_em > now() and c.expira_em <= now() + interval '2 minutes'
            and (c.consultada_em is null or c.consultada_em < now() - interval '1 minute'))
        or (c.situacao = 'processando' and c.expira_em + make_interval(mins => v_teto) > now()
            and (c.consultada_em is null or c.consultada_em < now() - interval '2 minutes'))
     order by c.criado_em limit 100)
    union all
    (select 4, f.criado_em, jsonb_build_object('acao', 'enviar_devolucao', 'refund_id', f.id, 'charge_id', f.charge_id)
     from pagamentos.refunds f
     where f.situacao in ('pedida', 'falhou') and f.tentativas < 10
       and (f.situacao = 'pedida' or f.atualizado_em < now() - make_interval(mins => f.tentativas::integer))
       and not exists (select 1 from pagamentos.refunds o
                       where o.charge_id = f.charge_id and o.id <> f.id
                         and (o.situacao = 'enviada' or (o.situacao in ('pedida', 'falhou') and (o.criado_em, o.id) < (f.criado_em, f.id))))
     order by f.criado_em limit 100)
    union all
    (select 5, f.criado_em, jsonb_build_object('acao', 'reenviar_devolucao', 'refund_id', f.id, 'charge_id', f.charge_id)
     from pagamentos.refunds f
     where f.situacao = 'enviada' and f.enviada_em < now() - interval '5 minutes' and f.atualizado_em < now() - interval '5 minutes'
     order by f.criado_em limit 100)
    union all
    (select 6, e.recebido_em, jsonb_build_object('acao', 'reaplicar', 'event_id', e.id, 'charge_id', e.charge_id,
                                                'provedor_cobranca_id', e.provedor_cobranca_id)
     from pagamentos.events e
     where e.resultado = 'pendente' and e.charge_id is not null and e.recebido_em < now() - interval '1 minute'
     order by e.recebido_em limit 100)
    union all
    (select 7, d.dia::timestamptz, jsonb_build_object('acao', 'conciliar', 'dia', d.dia, 'janela', d.janela)
     from (select v_hoje - 1 as dia, 'd1' as janela
           union all select v_hoje - 7, 'd7'
           union all select v_hoje - 32, 'd32'
           union all select g::date, 'd1' from generate_series(v_hoje - 14, v_hoje - 2, interval '1 day') g) d
     where exists (select 1 from pagamentos.charges c where c.provedor_cobranca_id is not null)
       and not exists (select 1 from pagamentos.reconciliation_runs rr
                       where rr.dia = d.dia and rr.janela = d.janela and rr.situacao = 'concluida'))
  ) x;
  return jsonb_build_object('status', 'ok', 'acoes', v_acoes);
end $$;

/* ===================== 6. Devolução: andamento ===================== */

-- A rotina vai enviar esta devolução ao provedor: calcula a divisão (quanto sai da taxa do IMED e quanto da parte da
-- clínica) com o que JÁ foi concluído, marca "enviada" e devolve o que mandar. Uma por vez por cobrança (wait): assim a
-- conta de cada uma parte de um estado fechado e a soma fecha no centavo. Chamar de novo com a devolução já enviada
-- devolve os mesmos valores (o provedor recebe a mesma chave: não devolve duas vezes).
create or replace function public.pag_refund_sent(p_refund uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_charge uuid;
  c pagamentos.charges;
  f pagamentos.refunds;
  v_taxa integer;
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  select x.charge_id into v_charge from pagamentos.refunds x where x.id = p_refund;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into c from pagamentos.charges x where x.id = v_charge for update;
  select * into f from pagamentos.refunds x where x.id = p_refund for update;
  if f.situacao = 'concluida' then return jsonb_build_object('status', 'done'); end if;
  if f.situacao = 'desfeita' then return jsonb_build_object('status', 'undone'); end if;
  if f.situacao <> 'enviada' then
    if exists (select 1 from pagamentos.refunds o where o.charge_id = c.id and o.situacao = 'enviada') then
      return jsonb_build_object('status', 'wait');
    end if;
    if not f.integral then
      if c.situacao not in ('aprovada', 'devolvida_parcial') then
        return jsonb_build_object('status', 'not_refundable', 'situacao', c.situacao);
      end if;
      if exists (select 1 from pagamentos.refund_items fi where fi.refund_id = f.id) then
        update pagamentos.refund_items fi
           set taxa_cents = private.pag_refund_fee(ci.preco_cents, ci.taxa_cents, ci.devolvido_cents, fi.valor_cents),
               clinica_cents = fi.valor_cents - private.pag_refund_fee(ci.preco_cents, ci.taxa_cents, ci.devolvido_cents, fi.valor_cents)
        from pagamentos.charge_items ci
        where fi.refund_id = f.id and ci.charge_id = c.id and ci.item_id = fi.item_id;
        select sum(fi.taxa_cents)::integer into v_taxa from pagamentos.refund_items fi where fi.refund_id = f.id;
      else
        v_taxa := private.pag_refund_fee(c.valor_cents, c.taxa_cents, c.devolvido_cents, f.valor_cents);
      end if;
    end if;
    update pagamentos.refunds x
       set situacao = 'enviada', enviada_em = coalesce(x.enviada_em, now()), tentativas = x.tentativas + 1, atualizado_em = now(),
           taxa_cents = case when f.integral then x.taxa_cents else v_taxa end,
           clinica_cents = case when f.integral then x.clinica_cents else f.valor_cents - v_taxa end
     where x.id = f.id
    returning * into f;
  else
    update pagamentos.refunds x set tentativas = x.tentativas + 1, atualizado_em = now() where x.id = f.id returning * into f;
  end if;
  return jsonb_build_object('status', 'ok', 'refund_id', f.id, 'charge_id', c.id, 'provedor_cobranca_id', c.provedor_cobranca_id,
    'valor_cents', f.valor_cents, 'integral', f.integral, 'taxa_cents', f.taxa_cents, 'clinica_cents', f.clinica_cents,
    'total', f.integral or f.valor_cents = c.valor_cents - c.devolvido_cents,
    'wallet_id', (select a.wallet_id from pagamentos.clinic_accounts a where a.clinic_id = c.clinic_id),
    'chave_idempotencia', f.chave_idempotencia, 'tentativas', f.tentativas);
end $$;

-- O provedor confirmou a devolução. Idempotente (chamar de novo não soma duas vezes).
create or replace function public.pag_refund_done(p_refund uuid, p_provedor_estorno_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_charge uuid;
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  select x.charge_id into v_charge from pagamentos.refunds x where x.id = p_refund;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  perform 1 from pagamentos.charges x where x.id = v_charge for update;
  return private.pag_refund_conclude(p_refund, p_provedor_estorno_id);
end $$;

-- O envio falhou: volta para a fila da rotina (com espera crescente), com o código do erro. O dinheiro não saiu.
create or replace function public.pag_refund_failed(p_refund uuid, p_codigo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_charge uuid;
  f pagamentos.refunds;
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  select x.charge_id into v_charge from pagamentos.refunds x where x.id = p_refund;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  perform 1 from pagamentos.charges x where x.id = v_charge for update;
  select * into f from pagamentos.refunds x where x.id = p_refund for update;
  if f.situacao <> 'enviada' then return jsonb_build_object('status', 'not_sent', 'situacao', f.situacao); end if;
  update pagamentos.refunds x
     set situacao = 'falhou', atualizado_em = now(),
         ultimo_erro = case when p_codigo ~ '^[a-z][a-z0-9_]{2,59}$' then p_codigo else 'erro_no_envio' end
   where x.id = f.id;
  perform private.pag_audit('devolucao.falhou', f.charge_id, f.id, null, null, null,
                            jsonb_build_object('tentativas', f.tentativas), case when p_codigo ~ '^[a-z][a-z0-9_]{2,59}$' and p_codigo !~ '[0-9]{4,}' then p_codigo end, 'rotina');
  return jsonb_build_object('status', 'ok', 'tentativas', f.tentativas);
end $$;

/* ===================== 7. Conciliação diária (§5.4) ===================== */

-- Compara as cobranças que o provedor informou para o dia (p_linhas) com o que está gravado aqui e grava as diferenças.
-- NÃO corrige nada: só aponta; quem fecha é uma pessoa com imed.financeiro.operar. p_linhas: lista de
-- {provedor_cobranca_id, situacao (paga, devolvida, devolvida_parcial, contestada, aguardando...), valor_cents,
--  repasse_cents (o que foi para a carteira da clínica), tarifa_cents, devolvido_cents}. O dia é o de São Paulo.
--   falta_aqui (crítica)   o provedor recebeu e aqui não consta: dinheiro sem agendamento
--   falta_la (crítica)     aqui consta pago e no provedor não: agendamento confirmado sem dinheiro
--   valor (crítica)        valores diferentes
--   repasse (crítica)      a clínica recebeu diferente da parte dela
--   situacao (alta)        devolução ou contestação que não chegou por aviso
--   tarifa (informativa)   tarifa real diferente da esperada (a real fica na diferença)
create or replace function public.pag_reconcile_apply(p_dia date, p_linhas jsonb, p_janela text default 'd1')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid;
  l record;
  c pagamentos.charges;
  v_pago_la boolean;
  v_rec boolean;
  v_esp integer;
  v_cont jsonb;
  v_ini timestamptz;
  v_d jsonb := '[]'::jsonb;   -- as diferenças achadas: [{pid, charge, tipo, nosso, deles, gravidade}]
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  if p_dia is null or p_janela is null or p_janela not in ('d1', 'd7', 'd32', 'manual')
     or jsonb_typeof(p_linhas) is distinct from 'array' or jsonb_array_length(p_linhas) > 5000
     or exists (select 1 from jsonb_array_elements(p_linhas) x
                where jsonb_typeof(x.value) <> 'object' or coalesce(x.value ->> 'provedor_cobranca_id', '') !~ '^[A-Za-z0-9_-]{4,80}$'
                   or coalesce(x.value ->> 'valor_cents', '0') !~ '^[0-9]{1,9}$' or coalesce(x.value ->> 'repasse_cents', '0') !~ '^[0-9]{1,9}$'
                   or coalesce(x.value ->> 'tarifa_cents', '0') !~ '^[0-9]{1,9}$' or coalesce(x.value ->> 'devolvido_cents', '0') !~ '^[0-9]{1,9}$') then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_ini := p_dia::timestamp at time zone 'America/Sao_Paulo';
  insert into pagamentos.reconciliation_runs (dia, janela) values (p_dia, p_janela) returning id into v_run;
  for l in select x.value ->> 'provedor_cobranca_id' as pid, x.value ->> 'situacao' as sit, (x.value ->> 'valor_cents')::integer as valor,
                  (x.value ->> 'repasse_cents')::integer as repasse, (x.value ->> 'tarifa_cents')::integer as tarifa,
                  (x.value ->> 'devolvido_cents')::integer as devolvido
           from jsonb_array_elements(p_linhas) x loop
    v_pago_la := coalesce(l.sit, '') in ('paga', 'devolvida', 'devolvida_parcial', 'contestada');
    select * into c from pagamentos.charges x where x.provedor = 'asaas' and x.provedor_cobranca_id = l.pid;
    if not found then
      if v_pago_la then
        v_d := v_d || jsonb_build_object('pid', l.pid, 'tipo', 'falta_aqui', 'gravidade', 'critica',
                                         'deles', jsonb_build_object('situacao', l.sit, 'valor_cents', l.valor));
      end if;
      continue;
    end if;
    v_rec := c.paga_em is not null and c.pago_cents = c.valor_cents and c.situacao in ('aprovada', 'devolvida_parcial', 'devolvida', 'contestada');
    if v_pago_la and c.paga_em is null then
      v_d := v_d || jsonb_build_object('pid', l.pid, 'charge', c.id, 'tipo', 'falta_aqui', 'gravidade', 'critica',
                                       'nosso', jsonb_build_object('situacao', c.situacao),
                                       'deles', jsonb_build_object('situacao', l.sit, 'valor_cents', l.valor));
    elsif not v_pago_la and c.paga_em is not null then
      v_d := v_d || jsonb_build_object('pid', l.pid, 'charge', c.id, 'tipo', 'falta_la', 'gravidade', 'critica',
                                       'nosso', jsonb_build_object('situacao', c.situacao, 'valor_cents', c.pago_cents),
                                       'deles', jsonb_build_object('situacao', l.sit));
    elsif v_pago_la then
      if l.valor is not null and l.valor <> c.pago_cents then
        v_d := v_d || jsonb_build_object('pid', l.pid, 'charge', c.id, 'tipo', 'valor', 'gravidade', 'critica',
                                         'nosso', jsonb_build_object('valor_cents', c.pago_cents),
                                         'deles', jsonb_build_object('valor_cents', l.valor));
      end if;
      if v_rec and c.finalidade = 'agendamento' and l.repasse is not null and l.repasse <> c.clinica_cents then
        v_d := v_d || jsonb_build_object('pid', l.pid, 'charge', c.id, 'tipo', 'repasse', 'gravidade', 'critica',
                                         'nosso', jsonb_build_object('clinica_cents', c.clinica_cents),
                                         'deles', jsonb_build_object('repasse_cents', l.repasse));
      end if;
      if (l.devolvido is not null and l.devolvido <> case when v_rec then c.devolvido_cents
                                                          when c.situacao = 'devolvida' then c.pago_cents else 0 end)
         or ((coalesce(l.sit, '') = 'contestada') <> (c.situacao = 'contestada')) then
        v_d := v_d || jsonb_build_object('pid', l.pid, 'charge', c.id, 'tipo', 'situacao', 'gravidade', 'alta',
                                         'nosso', jsonb_build_object('situacao', c.situacao, 'devolvido_cents', c.devolvido_cents),
                                         'deles', jsonb_build_object('situacao', l.sit, 'devolvido_cents', l.devolvido));
      end if;
      v_esp := private.pag_tarifa_esperada(c.meio, c.valor_cents);
      if l.tarifa is not null and v_esp is not null and l.tarifa <> v_esp then
        v_d := v_d || jsonb_build_object('pid', l.pid, 'charge', c.id, 'tipo', 'tarifa', 'gravidade', 'informativa',
                                         'nosso', jsonb_build_object('tarifa_cents', v_esp),
                                         'deles', jsonb_build_object('tarifa_cents', l.tarifa));
      end if;
    end if;
  end loop;
  -- pago aqui no dia e ausente da lista do provedor
  select v_d || coalesce(jsonb_agg(jsonb_build_object('pid', x.provedor_cobranca_id, 'charge', x.id, 'tipo', 'falta_la', 'gravidade', 'critica',
                                   'nosso', jsonb_build_object('situacao', x.situacao, 'valor_cents', x.pago_cents))), '[]'::jsonb)
    into v_d
  from pagamentos.charges x
  where x.paga_em >= v_ini and x.paga_em < v_ini + interval '1 day'
    and not exists (select 1 from jsonb_array_elements(p_linhas) y where y.value ->> 'provedor_cobranca_id' = x.provedor_cobranca_id);
  -- a mesma diferença ainda aberta (de uma rodada anterior) não entra de novo
  insert into pagamentos.reconciliation_diffs (run_id, provedor_cobranca_id, charge_id, tipo, nosso, deles, critica, gravidade)
  select v_run, t.pid, t.charge, t.tipo, t.nosso, t.deles, t.gravidade = 'critica', t.gravidade
  from (select distinct on (y.value ->> 'pid', y.value ->> 'charge', y.value ->> 'tipo')
               y.value ->> 'pid' as pid, (y.value ->> 'charge')::uuid as charge, y.value ->> 'tipo' as tipo,
               nullif(y.value -> 'nosso', 'null'::jsonb) as nosso, nullif(y.value -> 'deles', 'null'::jsonb) as deles,
               y.value ->> 'gravidade' as gravidade
        from jsonb_array_elements(v_d) y) t
  where not exists (select 1 from pagamentos.reconciliation_diffs d
                    where d.resolvida_em is null and d.tipo = t.tipo
                      and coalesce(d.provedor_cobranca_id, '') = coalesce(t.pid, '')
                      and coalesce(d.charge_id, '00000000-0000-0000-0000-000000000000') = coalesce(t.charge, '00000000-0000-0000-0000-000000000000'));
  select jsonb_build_object(
           'linhas', jsonb_array_length(p_linhas),
           'pagas_aqui', (select count(*) from pagamentos.charges x where x.paga_em >= v_ini and x.paga_em < v_ini + interval '1 day'),
           'achadas', jsonb_array_length(v_d),
           'novas', (select count(*) from pagamentos.reconciliation_diffs d where d.run_id = v_run),
           'criticas', (select count(*) from pagamentos.reconciliation_diffs d where d.run_id = v_run and d.critica),
           'por_tipo', coalesce((select jsonb_object_agg(q.tipo, q.n)
                                 from (select y.value ->> 'tipo' as tipo, count(*) as n from jsonb_array_elements(v_d) y group by 1) q), '{}'::jsonb))
    into v_cont;
  update pagamentos.reconciliation_runs rr set terminou = now(), situacao = 'concluida', contadores = v_cont where rr.id = v_run;
  return jsonb_build_object('status', 'ok', 'run_id', v_run) || v_cont;
end $$;

/* ===================== 8. Mensalidade (Destaque, §8) ===================== */

-- Situação da mensalidade e da faixa de destaque. p_foto.evento:
--   paga (com pago_ate) ... pendente, atrasada ou suspensa → ativa (o destaque volta na hora)
--   atrasada ............. ativa → atrasada: o destaque CONTINUA pela tolerância (5 dias)
--   cancelar ............. a pedido: vale até o fim do período já pago (cancelar_no_fim); pendente cancela já
--   tick ................. o relógio: atrasada além da tolerância → suspensa (o destaque sai); suspensa há 30 dias →
--                          cancelada; "cancelar no fim" com o período vencido → cancelada
-- pagamentos.featured (o que a busca vai ler na P5) só tem a clínica com mensalidade ativa ou na tolerância, publicada.
create or replace function public.pag_subscription_sync(p_subscription uuid, p_foto jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s pagamentos.subscriptions;
  v_ev text;
  v_ate date;
  v_antes text;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_destaque boolean;
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  if p_subscription is null or jsonb_typeof(p_foto) is distinct from 'object' then return jsonb_build_object('status', 'invalid'); end if;
  v_ev := p_foto ->> 'evento';
  if v_ev is null or v_ev not in ('paga', 'atrasada', 'cancelar', 'tick') then return jsonb_build_object('status', 'invalid'); end if;
  begin
    v_ate := (p_foto ->> 'pago_ate')::date;
  exception when others then
    return jsonb_build_object('status', 'invalid');
  end;
  select * into s from pagamentos.subscriptions x where x.id = p_subscription for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  v_antes := s.situacao;
  if s.situacao <> 'cancelada' then
    if v_ev = 'paga' then
      if v_ate is null then return jsonb_build_object('status', 'invalid'); end if;
      update pagamentos.subscriptions x
         set situacao = 'ativa', pago_ate = greatest(coalesce(x.pago_ate, v_ate), v_ate), tolerancia_ate = null, suspensa_em = null,
             atualizado_em = now()
       where x.id = s.id;
    elsif v_ev = 'atrasada' and s.situacao = 'ativa' then
      update pagamentos.subscriptions x
         set situacao = 'atrasada',
             tolerancia_ate = now() + make_interval(days => private.pag_setting_int('tolerancia_destaque_dias', 5)), atualizado_em = now()
       where x.id = s.id;
    elsif v_ev = 'cancelar' then
      update pagamentos.subscriptions x
         set cancelar_no_fim = true, situacao = case when x.situacao = 'pendente' then 'cancelada' else x.situacao end, atualizado_em = now()
       where x.id = s.id;
    elsif v_ev = 'tick' then
      if s.situacao = 'atrasada' and s.tolerancia_ate <= now() then
        update pagamentos.subscriptions x set situacao = 'suspensa', suspensa_em = now(), atualizado_em = now() where x.id = s.id;
      elsif s.situacao = 'suspensa'
            and s.suspensa_em + make_interval(days => private.pag_setting_int('suspensao_destaque_dias', 30)) <= now() then
        update pagamentos.subscriptions x set situacao = 'cancelada', atualizado_em = now() where x.id = s.id;
      elsif s.situacao = 'ativa' and s.cancelar_no_fim and s.pago_ate is not null and s.pago_ate < v_hoje then
        update pagamentos.subscriptions x set situacao = 'cancelada', atualizado_em = now() where x.id = s.id;
      end if;
    end if;
  end if;
  select * into s from pagamentos.subscriptions x where x.id = p_subscription;
  v_destaque := s.plano = 'destaque' and s.clinic_id is not null and s.situacao in ('ativa', 'atrasada')
                and exists (select 1 from public.clinics c where c.id = s.clinic_id and c.status = 'published' and not c.is_demo);
  if s.plano = 'destaque' and s.clinic_id is not null then
    if v_destaque then
      insert into pagamentos.featured (clinic_id) values (s.clinic_id) on conflict (clinic_id) do nothing;
    else
      delete from pagamentos.featured ft where ft.clinic_id = s.clinic_id;
    end if;
  end if;
  if s.situacao <> v_antes then
    perform private.pag_audit('mensalidade.situacao', null, null, s.clinic_id, null, jsonb_build_object('situacao', v_antes),
                              jsonb_build_object('situacao', s.situacao), null, 'rotina');
  end if;
  return jsonb_build_object('status', 'ok', 'situacao', s.situacao, 'destaque', v_destaque, 'pago_ate', s.pago_ate,
                            'tolerancia_ate', s.tolerancia_ate);
end $$;

/* ===================== 9. Permissões: só o servidor ===================== */
revoke all on function public.pag_payer_upsert(text, uuid) from public, anon, authenticated;
revoke all on function public.pag_payer_attach(uuid, text) from public, anon, authenticated;
revoke all on function public.pag_charge_open(uuid, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.pag_charge_attach(uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.pag_charge_abort(uuid) from public, anon, authenticated;
revoke all on function public.pag_event_store(text, text, text, text, text, integer, timestamptz, text) from public, anon, authenticated;
revoke all on function public.pag_sync_apply(uuid, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.pag_due() from public, anon, authenticated;
revoke all on function public.pag_refund_sent(uuid) from public, anon, authenticated;
revoke all on function public.pag_refund_done(uuid, text) from public, anon, authenticated;
revoke all on function public.pag_refund_failed(uuid, text) from public, anon, authenticated;
revoke all on function public.pag_reconcile_apply(date, jsonb, text) from public, anon, authenticated;
revoke all on function public.pag_subscription_sync(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pag_payer_upsert(text, uuid) to service_role;
grant execute on function public.pag_payer_attach(uuid, text) to service_role;
grant execute on function public.pag_charge_open(uuid, text, text, uuid, uuid) to service_role;
grant execute on function public.pag_charge_attach(uuid, text, timestamptz, text) to service_role;
grant execute on function public.pag_charge_abort(uuid) to service_role;
grant execute on function public.pag_event_store(text, text, text, text, text, integer, timestamptz, text) to service_role;
grant execute on function public.pag_sync_apply(uuid, jsonb, bigint) to service_role;
grant execute on function public.pag_due() to service_role;
grant execute on function public.pag_refund_sent(uuid) to service_role;
grant execute on function public.pag_refund_done(uuid, text) to service_role;
grant execute on function public.pag_refund_failed(uuid, text) to service_role;
grant execute on function public.pag_reconcile_apply(date, jsonb, text) to service_role;
grant execute on function public.pag_subscription_sync(uuid, jsonb) to service_role;
