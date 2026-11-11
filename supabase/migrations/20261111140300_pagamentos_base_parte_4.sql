-- iMed Pagamentos, fase P1: parte 4 de 5 (o que o paciente, a clínica e a gestão do IMED chamam, e a retenção; §5.3 e
-- §5.5). O cabeçalho, com o que a migração faz e as conferências, está na parte 1. Volta única:
-- supabase/volta/<versão>_pagamentos_base_parte_5.sql.
--
-- NOME PROVISÓRIO (ainda não aplicada na produção): os 5 passos de "Ao aplicar uma migração provisória na produção" do
-- .github/workflows/banco.yml valem para cada parte (veja o cabeçalho da parte 1).
--
-- Em linguagem simples (nenhuma tela usa estas funções ainda; as telas são das fases P2, P3 e P6):
--   paciente (código do agendamento ou a conta dele)  pag_my_payment: situação, valor, prazo, meio, "copia e cola"
--                                                     enquanto vale e as devoluções. Sem id do meio de pagamento.
--   clínica, financeiro.ver ........................  pag_clinic_status e pag_clinic_statement (extrato por exame, sem
--                                                     nenhum dado de paciente, com registro de leitura)
--   clínica, financeiro.configurar (só o dono) .....  pag_clinic_connect (informa a carteira e aceita os termos: fica
--                                                     "em conferência") e pag_clinic_pause (volta ao pagamento no local)
--   clínica, financeiro.estornar (só o dono) .......  pag_clinic_refund (devolução total ou parcial, com motivo)
--   IMED, imed.financeiro.ver ......................  admin_pag_resumo, admin_pag_lista, admin_pag_conciliacao,
--                                                     admin_pag_assinaturas
--   IMED, imed.financeiro.operar (só o dono do IMED)  admin_pag_taxa_definir, admin_pag_conta_conferir,
--                                                     admin_pag_estornar, admin_pag_diferenca_resolver,
--                                                     admin_pag_chave_geral, admin_pag_parametro_definir: sempre com
--                                                     motivo em código e registro
--   retenção (§5.5) ................................  avisos com mais de 1 ano e pagador sem cobrança saem (job diário
--                                                     imed-pagamentos-retencao; não chama a internet)
-- Pode rodar de novo sem erro e sem mudar nada.

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Apoio ===================== */

-- Quanto ainda pode ser devolvido (do exame, ou da cobrança inteira): pago − devolvido − já pedido.
create or replace function private.pag_resta(p_charge uuid, p_item uuid)
returns integer
language sql stable
set search_path = ''
as $$
  select case when exists (select 1 from pagamentos.charge_items ci where ci.charge_id = p_charge) then
    coalesce((select sum(greatest(ci.preco_cents - ci.devolvido_cents
                - coalesce((select sum(fi.valor_cents) from pagamentos.refund_items fi join pagamentos.refunds r on r.id = fi.refund_id
                            where r.charge_id = p_charge and fi.item_id = ci.item_id and r.situacao in ('pedida', 'enviada', 'falhou')), 0), 0))
              from pagamentos.charge_items ci where ci.charge_id = p_charge and (p_item is null or ci.item_id = p_item)), 0)::integer
  else
    (select greatest(c.valor_cents - c.devolvido_cents
                     - coalesce((select sum(r.valor_cents) from pagamentos.refunds r
                                 where r.charge_id = c.id and r.situacao in ('pedida', 'enviada', 'falhou')), 0), 0)::integer
     from pagamentos.charges c where c.id = p_charge and p_item is null)
  end;
$$;

-- Devolução pedida por uma pessoa (clínica ou equipe do IMED). Exame que ainda vale (confirmado, chegou, em atendimento
-- ou aguardando remarcação) não pode ser devolvido INTEIRO sem cancelar antes (cancel_first): senão ficaria confirmado
-- sem dinheiro (P-I1). Parte do valor pode. O pedido já está travado por quem chama.
create or replace function private.pag_refund_manual(p_charge uuid, p_item uuid, p_valor integer, p_motivo text, p_tipo text, p_key uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c pagamentos.charges;
begin
  select * into c from pagamentos.charges x where x.id = p_charge for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if p_key is not null and exists (select 1 from pagamentos.refunds f where f.chave_idempotencia = p_key) then
    return private.pag_refund_request(c.id, p_item, p_valor, p_motivo, p_tipo, auth.uid(), p_key, false);
  end if;
  if exists (select 1 from pagamentos.charge_items ci join agenda.appointment_items i on i.id = ci.item_id
             where ci.charge_id = c.id and (p_item is null or ci.item_id = p_item)
               and i.status in ('confirmed', 'checked_in', 'in_service', 'reschedule_requested'))
     and (p_valor is null or p_valor >= private.pag_resta(c.id, p_item)) then
    return jsonb_build_object('status', 'cancel_first');
  end if;
  return private.pag_refund_request(c.id, p_item, p_valor, p_motivo, p_tipo, auth.uid(), p_key, false);
end $$;

revoke all on function private.pag_resta(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.pag_refund_manual(uuid, uuid, integer, text, text, uuid) from public, anon, authenticated, service_role;

/* ===================== 2. Paciente ===================== */

-- O pagamento do próprio agendamento, com o código do pedido (ou a conta dele). Nada do meio de pagamento (nem id, nem
-- carteira), nada de taxa (decisão 6: o paciente vê só o preço). O "copia e cola" só enquanto a cobrança espera e o
-- prazo não venceu.
create or replace function public.pag_my_payment(p_request uuid, p_token text default null)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  r public.appointment_requests;
  c pagamentos.charges;
begin
  select * into r from public.appointment_requests a where a.id = p_request;
  if not found or not ((r.user_id = auth.uid()) is true
                       or (r.review_token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')) is true) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if r.payment_mode <> 'online' then
    return jsonb_build_object('status', 'ok', 'payment_mode', 'no_local', 'request_status', r.status);
  end if;
  select * into c from pagamentos.charges x where x.request_id = r.id
  order by (x.situacao in ('criada', 'aguardando', 'processando', 'aprovada', 'devolvida_parcial', 'contestada')) desc, x.criado_em desc
  limit 1;
  return jsonb_build_object(
    'status', 'ok', 'payment_mode', 'online', 'request_status', r.status, 'total_cents', r.total_cents,
    'hold_expires_at', r.hold_expires_at,
    'payment', case when c.id is null then null else jsonb_build_object(
      'situacao', c.situacao, 'valor_cents', c.valor_cents, 'meio', c.meio, 'tentativa', c.tentativa,
      'expira_em', case when c.situacao in ('criada', 'aguardando') then c.expira_em end,
      'pix_copia_cola', case when c.situacao = 'aguardando' and c.expira_em > now() then c.pix_copia_cola end,
      'paga_em', c.paga_em, 'devolvido_cents', c.devolvido_cents,
      'devolucoes', coalesce((select jsonb_agg(jsonb_build_object(
                                 'valor_cents', f.valor_cents,
                                 'situacao', case f.situacao when 'concluida' then 'devolvida' else 'pedida' end,
                                 'pedida_em', f.criado_em, 'devolvida_em', f.concluida_em) order by f.criado_em)
                              from pagamentos.refunds f
                              where f.situacao <> 'desfeita'
                                and f.charge_id in (select x.id from pagamentos.charges x where x.request_id = r.id)), '[]'::jsonb)) end);
end $$;

/* ===================== 3. Clínica ===================== */

-- Situação do recebimento da clínica (financeiro.ver; a equipe do IMED com imed.financeiro.ver). Sem dado de paciente.
create or replace function public.pag_clinic_status(p_clinic uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_scope text := private.agenda_scope(p_clinic, 'financeiro.ver', 'imed.financeiro.ver');
  a pagamentos.clinic_accounts;
  f pagamentos.fee_rules;
begin
  if p_clinic is null or v_scope is null or v_scope not in ('clinica', 'central') then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select * into a from pagamentos.clinic_accounts x where x.clinic_id = p_clinic;
  f := private.pag_fee_rule(p_clinic, 'exame', now());
  return jsonb_build_object(
    'status', 'ok', 'clinic_id', p_clinic,
    'situacao', coalesce(a.situacao, 'nao_ligada'),
    'meios', coalesce(to_jsonb(a.meios), '[]'::jsonb),
    'carteira_final', right(a.wallet_id, 4),
    'emitida_por', a.emitida_por, 'termos_versao', a.termos_versao, 'aceito_em', a.aceito_em, 'conferida_em', a.conferida_em,
    'payment_mode', coalesce((select u.payment_mode from agenda.unit_settings u where u.clinic_id = p_clinic), 'no_local'),
    'vendas_online_ligadas', private.pag_vendas_ligadas(),
    'recebendo', private.pag_clinic_online(p_clinic),
    'taxa', case when f.id is null then null
                 else jsonb_build_object('tipo', f.tipo, 'bps', f.fee_bps, 'cents', f.fee_cents, 'da_clinica', f.clinic_id is not null,
                                         'vale_de', f.vale_de) end,
    'preco_minimo_cents', private.pag_setting_int('preco_minimo_online_cents', 2000),
    'pode_configurar', public.has_clinic_perm(p_clinic, 'financeiro.configurar'),
    'pode_estornar', public.has_clinic_perm(p_clinic, 'financeiro.estornar'));
end $$;

-- Extrato da clínica por exame (financeiro.ver): o que foi pago pelo site no período (dias de São Paulo, até 92), a
-- taxa do IMED, a parte dela, o devolvido e a previsão (Pix: no dia; cartão: dias do parâmetro, a confirmar). Nenhum
-- dado de paciente; mesmo assim a leitura fica registrada (agenda.access_log), como as outras do painel.
create or replace function public.pag_clinic_statement(p_clinic uuid, p_de date, p_ate date)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_scope text := private.agenda_scope(p_clinic, 'financeiro.ver', 'imed.financeiro.ver');
  v_ini timestamptz;
  v_fim timestamptz;
  v_dias integer := private.pag_setting_int('liquidacao_cartao_dias', 32);
  v_linhas jsonb;
  v_tot jsonb;
begin
  if p_clinic is null or v_scope is null or v_scope not in ('clinica', 'central') then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 92 then return jsonb_build_object('status', 'invalid'); end if;
  v_ini := p_de::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
  select coalesce(jsonb_agg(jsonb_build_object(
           'dia', (c.paga_em at time zone 'America/Sao_Paulo')::date, 'cobranca', left(c.id::text, 8), 'meio', c.meio,
           'situacao', c.situacao, 'exam_code', i.exam_code, 'starts_at', i.starts_at,
           'preco_cents', ci.preco_cents, 'taxa_cents', ci.taxa_cents, 'clinica_cents', ci.clinica_cents,
           'devolvido_cents', ci.devolvido_cents,
           'previsao', case c.meio when 'cartao' then (c.paga_em at time zone 'America/Sao_Paulo')::date + v_dias
                                   else (c.paga_em at time zone 'America/Sao_Paulo')::date end)
           order by c.paga_em, i.seq), '[]'::jsonb)
    into v_linhas
  from pagamentos.charges c
  join pagamentos.charge_items ci on ci.charge_id = c.id
  left join agenda.appointment_items i on i.id = ci.item_id
  where c.clinic_id = p_clinic and c.paga_em >= v_ini and c.paga_em < v_fim and c.pago_cents = c.valor_cents
    and c.situacao in ('aprovada', 'devolvida_parcial', 'devolvida', 'contestada');
  select jsonb_build_object('valor_cents', coalesce(sum(c.valor_cents), 0), 'taxa_cents', coalesce(sum(c.taxa_cents), 0),
                            'clinica_cents', coalesce(sum(c.clinica_cents), 0), 'devolvido_cents', coalesce(sum(c.devolvido_cents), 0),
                            'taxa_devolvida_cents', coalesce(sum(c.taxa_devolvida_cents), 0),
                            'clinica_devolvida_cents', coalesce(sum(c.clinica_devolvida_cents), 0), 'cobrancas', count(*))
    into v_tot
  from pagamentos.charges c
  where c.clinic_id = p_clinic and c.paga_em >= v_ini and c.paga_em < v_fim and c.pago_cents = c.valor_cents
    and c.situacao in ('aprovada', 'devolvida_parcial', 'devolvida', 'contestada');
  perform private.agenda_log_access('pag_clinic_statement', p_clinic, null, 'extrato');
  return jsonb_build_object('status', 'ok', 'de', p_de, 'ate', p_ate, 'linhas', v_linhas, 'totais', v_tot);
end $$;

-- Ligar o recebimento (financeiro.configurar: só o dono da clínica): informa a carteira no meio de pagamento e aceita os
-- termos. A conta fica "em conferência" até a equipe do IMED conferir (admin_pag_conta_conferir); trocar a carteira de
-- uma conta ativa volta para a conferência e a clínica deixa de receber pelo site até lá. Só Pix nesta fase (o cartão é
-- da P4). Conta suspensa pelo IMED: só o IMED reativa.
create or replace function public.pag_clinic_connect(p_clinic uuid, p_wallet text, p_termos_versao text, p_meios text[] default '{pix}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a pagamentos.clinic_accounts;
  v_muda boolean;
begin
  if p_clinic is null or not public.has_clinic_perm(p_clinic, 'financeiro.configurar') then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if coalesce(p_wallet, '') !~ '^[A-Za-z0-9_-]{8,80}$' or coalesce(p_termos_versao, '') !~ '^[a-z0-9][a-z0-9._-]{0,30}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if p_meios is null or p_meios <> array['pix'] then return jsonb_build_object('status', 'method_not_available'); end if;
  perform private.agenda_lock_config(p_clinic, true);
  select * into a from pagamentos.clinic_accounts x where x.clinic_id = p_clinic for update;
  if a.situacao = 'suspensa' then return jsonb_build_object('status', 'suspended'); end if;
  v_muda := a.clinic_id is null or a.wallet_id is distinct from p_wallet;
  if a.clinic_id is null then
    insert into pagamentos.clinic_accounts (clinic_id, wallet_id, situacao, meios, termos_versao, aceito_em, aceito_por)
    values (p_clinic, p_wallet, 'em_conferencia', p_meios, p_termos_versao, now(), auth.uid());
  elsif v_muda or a.situacao = 'nao_ligada' then
    update pagamentos.clinic_accounts x
       set wallet_id = p_wallet, situacao = 'em_conferencia', meios = p_meios, termos_versao = p_termos_versao, aceito_em = now(),
           aceito_por = auth.uid(), conferida_em = null, conferida_por = null, atualizado_em = now()
     where x.clinic_id = p_clinic;
    update agenda.unit_settings u set payment_mode = 'no_local', updated_at = now(), updated_by = auth.uid()
    where u.clinic_id = p_clinic and u.payment_mode <> 'no_local';
    perform private.agenda_touch(p_clinic);
  elsif a.termos_versao is distinct from p_termos_versao then
    update pagamentos.clinic_accounts x
       set termos_versao = p_termos_versao, aceito_em = now(), aceito_por = auth.uid(), atualizado_em = now()
     where x.clinic_id = p_clinic;
  else
    return jsonb_build_object('status', 'ok', 'situacao', a.situacao, 'unchanged', true);
  end if;
  select * into a from pagamentos.clinic_accounts x where x.clinic_id = p_clinic;
  perform private.pag_audit('conta.ligar', null, null, p_clinic, null, null,
    jsonb_build_object('situacao', a.situacao, 'carteira_final', right(a.wallet_id, 4), 'termos', a.termos_versao, 'trocou_carteira', v_muda));
  return jsonb_build_object('status', 'ok', 'situacao', a.situacao);
end $$;

-- Pausar (ou retomar) os novos recebimentos da clínica: a unidade volta ao "pagamento no local" (ou ao online, só com a
-- conta ativa). O que já foi pago continua valendo e as devoluções continuam funcionando (§4.4). O dono da clínica
-- (financeiro.configurar) ou a equipe do IMED (imed.financeiro.operar).
create or replace function public.pag_clinic_pause(p_clinic uuid, p_pausar boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modo text := case when coalesce(p_pausar, true) then 'no_local' else 'online' end;
  v_antes text;
begin
  if p_clinic is null or not (public.has_clinic_perm(p_clinic, 'financeiro.configurar') or public.imed_has('imed.financeiro.operar')) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  perform private.agenda_lock_config(p_clinic, true);
  select u.payment_mode into v_antes from agenda.unit_settings u where u.clinic_id = p_clinic for update;
  if not found then return jsonb_build_object('status', 'agenda_not_started'); end if;
  if v_modo = 'online'
     and not exists (select 1 from pagamentos.clinic_accounts a where a.clinic_id = p_clinic and a.situacao = 'ativa') then
    return jsonb_build_object('status', 'account_not_active');
  end if;
  if v_antes = v_modo then return jsonb_build_object('status', 'ok', 'payment_mode', v_modo, 'unchanged', true); end if;
  update agenda.unit_settings u set payment_mode = v_modo, updated_at = now(), updated_by = auth.uid() where u.clinic_id = p_clinic;
  perform private.pag_audit('conta.modo', null, null, p_clinic, null, jsonb_build_object('payment_mode', v_antes),
                            jsonb_build_object('payment_mode', v_modo));
  perform private.agenda_touch(p_clinic);
  return jsonb_build_object('status', 'ok', 'payment_mode', v_modo);
end $$;

-- A clínica pede uma devolução (financeiro.estornar: só o dono), total ou parcial, do agendamento ou de um exame.
-- p_valor nulo = tudo o que resta. Motivo: código da lista. Sempre pedido gravado (a rotina envia; nunca direto no
-- provedor); p_key: a mesma chave não vira duas devoluções.
create or replace function public.pag_clinic_refund(p_request uuid, p_item uuid default null, p_valor integer default null,
                                                    p_motivo text default null, p_key uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  v_charge uuid;
begin
  select * into r from public.appointment_requests a where a.id = p_request for update;
  if not found or r.clinic_id is null or not public.has_clinic_perm(r.clinic_id, 'financeiro.estornar') then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_motivo is null or p_motivo not in ('falta', 'acordo_com_paciente', 'exame_nao_realizado', 'erro_de_cobranca', 'outro') then
    return jsonb_build_object('status', 'invalid_reason');
  end if;
  select c.id into v_charge from pagamentos.charges c
  where c.request_id = r.id and c.situacao in ('aprovada', 'devolvida_parcial', 'devolvida', 'contestada')
  order by c.criado_em desc limit 1;
  if v_charge is null then return jsonb_build_object('status', 'no_charge'); end if;
  return private.pag_refund_manual(v_charge, p_item, p_valor, 'clinica_' || p_motivo, 'clinica', p_key);
end $$;

/* ===================== 4. Gestão do IMED: leituras (imed.financeiro.ver) ===================== */

-- Os números do período (dias de São Paulo, até 366): o extrato somado por tipo, as cobranças por situação e o que
-- precisa de atenção. Só centavos e contagens; nenhum dado de paciente.
create or replace function public.admin_pag_resumo(p_de date, p_ate date)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_ini timestamptz;
  v_fim timestamptz;
begin
  if not public.imed_has('imed.financeiro.ver') then return jsonb_build_object('status', 'forbidden'); end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 366 then return jsonb_build_object('status', 'invalid'); end if;
  v_ini := p_de::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
  return jsonb_build_object(
    'status', 'ok', 'de', p_de, 'ate', p_ate, 'fonte', 'cobrado_pelo_site',
    'vendas_online_ligadas', private.pag_vendas_ligadas(),
    'extrato', coalesce((select jsonb_object_agg(q.tipo, q.total)
                         from (select l.tipo, sum(l.valor_cents) as total from pagamentos.ledger l
                               where l.quando >= v_ini and l.quando < v_fim group by l.tipo) q), '{}'::jsonb),
    'cobrancas', coalesce((select jsonb_object_agg(q.situacao, q.n)
                           from (select c.situacao, count(*) as n from pagamentos.charges c
                                 where c.criado_em >= v_ini and c.criado_em < v_fim group by c.situacao) q), '{}'::jsonb),
    'contas', coalesce((select jsonb_object_agg(q.situacao, q.n)
                        from (select a.situacao, count(*) as n from pagamentos.clinic_accounts a group by a.situacao) q), '{}'::jsonb),
    'atencao', jsonb_build_object(
      'diferencas_criticas', (select count(*) from pagamentos.reconciliation_diffs d where d.resolvida_em is null and d.critica),
      'diferencas_abertas', (select count(*) from pagamentos.reconciliation_diffs d where d.resolvida_em is null),
      'devolucoes_na_fila', (select count(*) from pagamentos.refunds f where f.situacao in ('pedida', 'enviada', 'falhou')),
      'devolucoes_com_falha', (select count(*) from pagamentos.refunds f where f.situacao = 'falhou'),
      'avisos_pendentes', (select count(*) from pagamentos.events e where e.resultado = 'pendente'),
      'contestacoes_abertas', (select count(*) from pagamentos.disputes d where d.encerrada_em is null),
      'ultima_conciliacao', (select max(rr.dia) from pagamentos.reconciliation_runs rr where rr.situacao = 'concluida' and rr.janela <> 'manual')));
end $$;

-- Lista de cobranças do período (até 500), com filtro por clínica e situação. Sem dado de paciente nem do pagador.
create or replace function public.admin_pag_lista(p_de date, p_ate date, p_clinic uuid default null, p_situacao text default null,
                                                  p_limit integer default 100)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_ini timestamptz;
  v_fim timestamptz;
begin
  if not public.imed_has('imed.financeiro.ver') then return jsonb_build_object('status', 'forbidden'); end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 366 then return jsonb_build_object('status', 'invalid'); end if;
  v_ini := p_de::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
  return jsonb_build_object('status', 'ok', 'cobrancas', coalesce((
    select jsonb_agg(to_jsonb(q) order by q.criado_em desc)
    from (select c.id, c.criado_em, c.clinic_id, cl.name as clinic_name, c.finalidade, c.meio, c.situacao, c.valor_cents, c.taxa_cents,
                 c.clinica_cents, c.tarifa_meio_cents, c.devolvido_cents, c.paga_em, c.tentativa, c.request_id, c.fee_bps
          from pagamentos.charges c left join public.clinics cl on cl.id = c.clinic_id
          where c.criado_em >= v_ini and c.criado_em < v_fim
            and (p_clinic is null or c.clinic_id = p_clinic) and (p_situacao is null or c.situacao = p_situacao)
          order by c.criado_em desc
          limit least(greatest(coalesce(p_limit, 100), 1), 500)) q), '[]'::jsonb));
end $$;

-- Conciliação: as últimas rodadas e as diferenças (só as abertas, por padrão). Diferença crítica aberta = aviso vermelho.
create or replace function public.admin_pag_conciliacao(p_so_abertas boolean default true)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  if not public.imed_has('imed.financeiro.ver') then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object(
    'status', 'ok',
    'criticas_abertas', (select count(*) from pagamentos.reconciliation_diffs d where d.resolvida_em is null and d.critica),
    'rodadas', coalesce((select jsonb_agg(to_jsonb(q) order by q.comecou desc)
                         from (select rr.id, rr.dia, rr.janela, rr.comecou, rr.terminou, rr.situacao, rr.contadores
                               from pagamentos.reconciliation_runs rr order by rr.comecou desc limit 30) q), '[]'::jsonb),
    'diferencas', coalesce((select jsonb_agg(to_jsonb(q) order by q.critica desc, q.criado_em desc)
                            from (select d.id, d.tipo, d.gravidade, d.critica, d.criado_em, d.charge_id, d.provedor_cobranca_id, d.nosso,
                                         d.deles, d.resolvida_em, d.resolucao, rr.dia
                                  from pagamentos.reconciliation_diffs d join pagamentos.reconciliation_runs rr on rr.id = d.run_id
                                  where not coalesce(p_so_abertas, true) or d.resolvida_em is null
                                  order by d.critica desc, d.criado_em desc limit 200) q), '[]'::jsonb));
end $$;

-- Mensalidades (Destaque): situação de cada uma e os dias de atraso.
create or replace function public.admin_pag_assinaturas()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  if not public.imed_has('imed.financeiro.ver') then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object('status', 'ok', 'assinaturas', coalesce((
    select jsonb_agg(to_jsonb(q) order by q.criado_em desc)
    from (select s.id, s.clinic_id, cl.name as clinic_name, s.plano, s.preco_cents, s.situacao, s.pago_ate, s.tolerancia_ate,
                 s.suspensa_em, s.cancelar_no_fim, s.criado_em,
                 case when s.situacao in ('atrasada', 'suspensa') and s.pago_ate is not null
                      then greatest((now() at time zone 'America/Sao_Paulo')::date - s.pago_ate, 0) end as dias_de_atraso,
                 exists (select 1 from pagamentos.featured ft where ft.clinic_id = s.clinic_id) as em_destaque
          from pagamentos.subscriptions s left join public.clinics cl on cl.id = s.clinic_id
          order by s.criado_em desc limit 500) q), '[]'::jsonb));
end $$;

/* ===================== 5. Gestão do IMED: operações (imed.financeiro.operar; motivo em código, sempre registrado) ===================== */

create or replace function private.pag_motivo_ok(p_motivo text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_motivo is not null and p_motivo ~ '^[a-z][a-z0-9_]{2,59}$' and p_motivo !~ '[0-9]{4,}';
$$;
revoke all on function private.pag_motivo_ok(text) from public, anon, authenticated, service_role;

-- Define a taxa do IMED (p_clinic nulo = a padrão de todas). Não altera a regra antiga: fecha o período dela agora e
-- grava uma linha nova. Cobrança já criada guarda a taxa de quando nasceu.
create or replace function public.admin_pag_taxa_definir(p_clinic uuid, p_tipo text, p_valor integer, p_motivo text,
                                                         p_finalidade text default 'exame')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes pagamentos.fee_rules;
  v_id uuid;
begin
  if not public.imed_has('imed.financeiro.operar') then return jsonb_build_object('status', 'forbidden'); end if;
  if not private.pag_motivo_ok(p_motivo) then return jsonb_build_object('status', 'reason_required'); end if;
  if p_tipo is null or p_tipo not in ('percentual', 'fixo') or p_valor is null or p_valor < 0
     or (p_tipo = 'percentual' and p_valor > 10000) or (p_tipo = 'fixo' and p_valor > 10000000)
     or p_finalidade is null or p_finalidade not in ('exame', 'teleconsulta') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if p_clinic is not null and not exists (select 1 from public.clinics c where c.id = p_clinic) then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- uma mudança por vez para a mesma clínica e finalidade
  perform pg_advisory_xact_lock(7103, hashtext(coalesce(p_clinic::text, 'padrao') || ':' || p_finalidade));
  select * into v_antes from pagamentos.fee_rules f
  where f.clinic_id is not distinct from p_clinic and f.finalidade = p_finalidade and f.vale_ate is null;
  if found and v_antes.vale_de >= now() then return jsonb_build_object('status', 'too_soon'); end if;
  if found then
    update pagamentos.fee_rules f set vale_ate = now() where f.id = v_antes.id;
  end if;
  insert into pagamentos.fee_rules (clinic_id, finalidade, tipo, fee_bps, fee_cents, vale_de, motivo, criado_por)
  values (p_clinic, p_finalidade, p_tipo, case when p_tipo = 'percentual' then p_valor end, case when p_tipo = 'fixo' then p_valor end,
          now(), p_motivo, auth.uid())
  returning id into v_id;
  perform private.pag_audit('taxa.definir', null, null, p_clinic, v_id::text,
    case when v_antes.id is not null then jsonb_build_object('tipo', v_antes.tipo, 'bps', v_antes.fee_bps, 'cents', v_antes.fee_cents) end,
    jsonb_build_object('tipo', p_tipo, 'valor', p_valor, 'finalidade', p_finalidade), p_motivo);
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- A equipe confere a conta da clínica: ativa (depois da cobrança de teste), suspensa ou de volta para a conferência.
-- Ativar NÃO liga o recebimento sozinho: quem liga é pag_clinic_pause(clínica, false), um passo à parte. Sair de "ativa"
-- põe a unidade de volta no pagamento no local.
create or replace function public.admin_pag_conta_conferir(p_clinic uuid, p_situacao text, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a pagamentos.clinic_accounts;
begin
  if not public.imed_has('imed.financeiro.operar') then return jsonb_build_object('status', 'forbidden'); end if;
  if not private.pag_motivo_ok(p_motivo) then return jsonb_build_object('status', 'reason_required'); end if;
  if p_situacao is null or p_situacao not in ('ativa', 'suspensa', 'em_conferencia') then return jsonb_build_object('status', 'invalid'); end if;
  perform private.agenda_lock_config(p_clinic, true);
  select * into a from pagamentos.clinic_accounts x where x.clinic_id = p_clinic for update;
  if not found or a.situacao = 'nao_ligada' or a.wallet_id is null then return jsonb_build_object('status', 'not_connected'); end if;
  if a.situacao = p_situacao then return jsonb_build_object('status', 'ok', 'situacao', a.situacao, 'unchanged', true); end if;
  update pagamentos.clinic_accounts x
     set situacao = p_situacao,
         conferida_em = case when p_situacao = 'ativa' then now() else x.conferida_em end,
         conferida_por = case when p_situacao = 'ativa' then auth.uid() else x.conferida_por end,
         atualizado_em = now()
   where x.clinic_id = p_clinic;
  if p_situacao <> 'ativa' then
    update agenda.unit_settings u set payment_mode = 'no_local', updated_at = now(), updated_by = auth.uid()
    where u.clinic_id = p_clinic and u.payment_mode <> 'no_local';
    perform private.agenda_touch(p_clinic);
  end if;
  perform private.pag_audit('conta.conferir', null, null, p_clinic, null, jsonb_build_object('situacao', a.situacao),
                            jsonb_build_object('situacao', p_situacao), p_motivo);
  return jsonb_build_object('status', 'ok', 'situacao', p_situacao);
end $$;

-- A equipe pede uma devolução (total ou parcial) de uma cobrança. Mesmas regras da clínica (cancel_first, limites, chave).
create or replace function public.admin_pag_estornar(p_charge uuid, p_item uuid default null, p_valor integer default null,
                                                     p_motivo text default null, p_key uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req uuid;
begin
  if not public.imed_has('imed.financeiro.operar') then return jsonb_build_object('status', 'forbidden'); end if;
  if not private.pag_motivo_ok(p_motivo) then return jsonb_build_object('status', 'reason_required'); end if;
  select c.request_id into v_req from pagamentos.charges c where c.id = p_charge;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_req is not null then perform 1 from public.appointment_requests a where a.id = v_req for update; end if;
  return private.pag_refund_manual(p_charge, p_item, p_valor, left('imed_' || p_motivo, 60), 'imed', p_key);
end $$;

-- Fecha uma diferença da conciliação, com o código do que foi feito. A conciliação não corrige nada sozinha.
create or replace function public.admin_pag_diferenca_resolver(p_diff bigint, p_resolucao text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d pagamentos.reconciliation_diffs;
begin
  if not public.imed_has('imed.financeiro.operar') then return jsonb_build_object('status', 'forbidden'); end if;
  if not private.pag_motivo_ok(p_resolucao) then return jsonb_build_object('status', 'reason_required'); end if;
  select * into d from pagamentos.reconciliation_diffs x where x.id = p_diff for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if d.resolvida_em is not null then return jsonb_build_object('status', 'ok', 'unchanged', true); end if;
  update pagamentos.reconciliation_diffs x set resolvida_em = now(), resolvida_por = auth.uid(), resolucao = p_resolucao where x.id = d.id;
  perform private.pag_audit('conciliacao.resolver', d.charge_id, null, null, d.id::text, null,
                            jsonb_build_object('tipo', d.tipo, 'gravidade', d.gravidade), p_resolucao);
  return jsonb_build_object('status', 'ok');
end $$;

-- A chave geral (§6.2): desligada, nenhuma cobrança nova nasce, em nenhuma clínica, na hora. O que já foi pago continua
-- sendo processado e devolvido normalmente.
create or replace function public.admin_pag_chave_geral(p_ligar boolean, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes boolean := private.pag_vendas_ligadas();
begin
  if not public.imed_has('imed.financeiro.operar') then return jsonb_build_object('status', 'forbidden'); end if;
  if not private.pag_motivo_ok(p_motivo) then return jsonb_build_object('status', 'reason_required'); end if;
  if p_ligar is null then return jsonb_build_object('status', 'invalid'); end if;
  insert into pagamentos.settings (chave, valor, atualizado_por) values ('vendas_online_ligadas', to_jsonb(p_ligar), auth.uid())
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now(), atualizado_por = excluded.atualizado_por;
  perform private.pag_audit('chave_geral', null, null, null, 'vendas_online_ligadas', jsonb_build_object('ligada', v_antes),
                            jsonb_build_object('ligada', p_ligar), p_motivo);
  return jsonb_build_object('status', 'ok', 'vendas_online_ligadas', p_ligar);
end $$;

-- Os outros parâmetros (prazos, preço mínimo, regra de devolução, tarifas do meio de pagamento). Só as chaves da lista,
-- cada uma com o tipo e a faixa dela; definir uma tarifa tira a marca "a confirmar" (alguém conferiu na conta).
create or replace function public.admin_pag_parametro_definir(p_chave text, p_valor jsonb, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes jsonb;
  v_n integer;
  v_ok boolean := false;
begin
  if not public.imed_has('imed.financeiro.operar') then return jsonb_build_object('status', 'forbidden'); end if;
  if not private.pag_motivo_ok(p_motivo) then return jsonb_build_object('status', 'reason_required'); end if;
  if p_chave is null or p_valor is null then return jsonb_build_object('status', 'invalid'); end if;
  if p_chave like 'regra\_devolucao\_%' then
    v_ok := p_chave in ('regra_devolucao_antes_24h', 'regra_devolucao_7_dias', 'regra_devolucao_em_cima_da_hora', 'regra_devolucao_falta')
            and jsonb_typeof(p_valor) = 'string' and p_valor #>> '{}' in ('total', 'nenhuma');
  elsif jsonb_typeof(p_valor) = 'number' and p_valor #>> '{}' ~ '^[0-9]{1,9}$' then
    v_n := (p_valor #>> '{}')::integer;
    v_ok := case p_chave
      when 'minutos_qr' then v_n between 2 and 30
      when 'preco_minimo_online_cents' then v_n between 100 and 1000000
      when 'max_tentativas_cobranca' then v_n between 1 and 9
      when 'teto_processando_min' then v_n between 5 and 120
      when 'tolerancia_destaque_dias' then v_n between 0 and 60
      when 'suspensao_destaque_dias' then v_n between 1 and 365
      when 'tarifa_pix_cents' then v_n between 0 and 100000
      when 'tarifa_cartao_bps' then v_n between 0 and 2000
      when 'tarifa_cartao_fixo_cents' then v_n between 0 and 100000
      when 'liquidacao_cartao_dias' then v_n between 0 and 120
      else false end;
  end if;
  if not v_ok then return jsonb_build_object('status', 'invalid'); end if;
  select s.valor into v_antes from pagamentos.settings s where s.chave = p_chave;
  insert into pagamentos.settings (chave, valor, a_confirmar, atualizado_por) values (p_chave, p_valor, false, auth.uid())
  on conflict (chave) do update set valor = excluded.valor, a_confirmar = false, atualizado_em = now(), atualizado_por = excluded.atualizado_por;
  perform private.pag_audit('parametro.definir', null, null, null, p_chave, jsonb_build_object('valor', v_antes),
                            jsonb_build_object('valor', p_valor), p_motivo);
  return jsonb_build_object('status', 'ok', 'chave', p_chave, 'valor', p_valor);
end $$;

/* ===================== 6. Retenção (§5.5) ===================== */
-- Avisos: 1 ano (só o hash e os campos da lista). Pagador: só enquanto houver cobrança ligada (o que não virou cobrança
-- sai no dia seguinte). O "copia e cola" do Pix já some quando a cobrança deixa de esperar (gatilho da parte 1).
-- Cobranças, devoluções, extrato e conciliação ficam (5 anos; pergunta C7 ao contador): nada aqui os apaga.
create or replace function private.pag_retencao()
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from pagamentos.events e where e.id in (
    select x.id from pagamentos.events x where x.recebido_em < now() - interval '1 year' limit 5000);
  delete from pagamentos.payers p where p.id in (
    select x.id from pagamentos.payers x
    where x.criado_em < now() - interval '1 day' and not exists (select 1 from pagamentos.charges c where c.payer_id = x.id)
    limit 5000);
end $$;
revoke all on function private.pag_retencao() from public, anon, authenticated, service_role;
select cron.schedule('imed-pagamentos-retencao', '23 6 * * *', 'select private.pag_retencao()');

/* ===================== 7. Permissões ===================== */
revoke all on function public.pag_my_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.pag_my_payment(uuid, text) to anon, authenticated;
revoke all on function public.pag_clinic_status(uuid) from public, anon, authenticated;
revoke all on function public.pag_clinic_statement(uuid, date, date) from public, anon, authenticated;
revoke all on function public.pag_clinic_connect(uuid, text, text, text[]) from public, anon, authenticated;
revoke all on function public.pag_clinic_pause(uuid, boolean) from public, anon, authenticated;
revoke all on function public.pag_clinic_refund(uuid, uuid, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_pag_resumo(date, date) from public, anon, authenticated;
revoke all on function public.admin_pag_lista(date, date, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.admin_pag_conciliacao(boolean) from public, anon, authenticated;
revoke all on function public.admin_pag_assinaturas() from public, anon, authenticated;
revoke all on function public.admin_pag_taxa_definir(uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.admin_pag_conta_conferir(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_pag_estornar(uuid, uuid, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_pag_diferenca_resolver(bigint, text) from public, anon, authenticated;
revoke all on function public.admin_pag_chave_geral(boolean, text) from public, anon, authenticated;
revoke all on function public.admin_pag_parametro_definir(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.pag_clinic_status(uuid) to authenticated;
grant execute on function public.pag_clinic_statement(uuid, date, date) to authenticated;
grant execute on function public.pag_clinic_connect(uuid, text, text, text[]) to authenticated;
grant execute on function public.pag_clinic_pause(uuid, boolean) to authenticated;
grant execute on function public.pag_clinic_refund(uuid, uuid, integer, text, uuid) to authenticated;
grant execute on function public.admin_pag_resumo(date, date) to authenticated;
grant execute on function public.admin_pag_lista(date, date, uuid, text, integer) to authenticated;
grant execute on function public.admin_pag_conciliacao(boolean) to authenticated;
grant execute on function public.admin_pag_assinaturas() to authenticated;
grant execute on function public.admin_pag_taxa_definir(uuid, text, integer, text, text) to authenticated;
grant execute on function public.admin_pag_conta_conferir(uuid, text, text) to authenticated;
grant execute on function public.admin_pag_estornar(uuid, uuid, integer, text, uuid) to authenticated;
grant execute on function public.admin_pag_diferenca_resolver(bigint, text) to authenticated;
grant execute on function public.admin_pag_chave_geral(boolean, text) to authenticated;
grant execute on function public.admin_pag_parametro_definir(text, jsonb, text) to authenticated;
