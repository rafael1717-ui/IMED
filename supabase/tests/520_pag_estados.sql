-- iMed Pagamentos, fase P1 (arquitetura do pagamento §4.1, §4.2, §4.6 e §11): as situações e os invariantes.
--   A. a cobrança só anda pelas transições do §4.1 (a matriz inteira, 10 × 10); o que foi fotografado não muda;
--   B. o caminho do Pix: reserva → cobrança criada → aguardando (agendamento "aguardando pagamento") → aprovada
--      (agendamento "confirmado", pelo aviso; histórico "gateway"); o extrato fecha; o paciente vê o resumo;
--   C. P-I1: confirmado com pagamento online só com UMA cobrança aprovada do valor do agendamento (nem o servidor
--      confirma sem dinheiro); P-I3: uma cobrança viva por agendamento; P-I4 e P-I5: as contas; P-I6: o extrato;
--   D. o paciente desiste antes de pagar; a cobrança não nasce (o sistema solta a reserva); limites contra abuso
--      (uma reserva aguardando pagamento por telefone; 3 cobranças por agendamento; quem deixa vencer 3 espera 30 min).
-- Tudo é desfeito no fim (rollback).
begin;
select plan(68);
delete from agenda.holidays where scope = 'nacional';  -- sem os da migração feriados_nacionais: o teste lança o dele (dias relativos a hoje)

/* ===================== Ferramentas do teste ===================== */
create function pg_temp.entrar(p_papel text, p_usuario uuid default null, p_email text default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_papel = 'postgres' then ''
         else jsonb_strip_nulls(jsonb_build_object(
                'role', p_papel, 'sub', p_usuario, 'email', p_email,
                'aud', case when p_usuario is not null then 'authenticated' end,
                'amr', case when p_usuario is not null then '[{"method": "otp", "timestamp": 1}]'::jsonb end))::text
    end, true);
  perform set_config('role', p_papel, true);
end $$;
-- pessoas: 1 dona, 2 gestor, 3 financeiro da clínica, 4 dono do IMED (admin), 5 dona de outra clínica, 6 financeiro do IMED
create function pg_temp.u(p_n integer) returns uuid language sql immutable as $$
  select ('a5520000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'gestor', 'caixa', 'admin', 'outra', 'equipe'])[p_n] || '.pag520@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.dona() returns void language sql as $$ select pg_temp.como(1) $$;
create function pg_temp.admin() returns void language sql as $$ select pg_temp.como(4) $$;
create function pg_temp.servidor() returns void language sql as $$ select pg_temp.entrar('service_role') $$;
create function pg_temp.banco() returns void language sql as $$ select pg_temp.entrar('postgres') $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c5520000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.d() returns uuid language sql immutable as $$ select 'c5520000-0000-4000-8000-000000000002'::uuid $$;
-- o dia do teste (daqui a 30 dias) e um horário dele, na hora de São Paulo
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.itens(variadic p text[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('procedure_id', pg_temp.id(p[i]), 'starts_at', pg_temp.t(p[i + 1])) order by i)
  from generate_series(1, cardinality(p), 2) i $$;
-- agendamento N: id "b5520...-N", código "codigo-secreto-N", chave da cobrança "d5520...-N" (tentativa T: ...-T-N)
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b5520000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.chave(p_n integer, p_tentativa integer default 1) returns uuid language sql immutable as $$
  select ('d5520000-0000-4000-' || lpad(p_tentativa::text, 4, '0') || '-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.paciente(p_n integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('name', 'Paciente ' || p_n, 'phone', '119' || lpad(p_n::text, 8, '0'), 'consent', true) $$;
-- leituras (como o dono do banco, qualquer que seja o papel da vez)
create function pg_temp.cob(p_n integer) returns uuid language sql stable security definer as $$
  select c.id from pagamentos.charges c where c.request_id = pg_temp.pid(p_n) order by c.criado_em desc, c.tentativa desc limit 1 $$;
create function pg_temp.sit(p_n integer) returns text language sql stable security definer as $$
  select concat_ws('|', (select a.status from public.appointment_requests a where a.id = pg_temp.pid(p_n)),
                        coalesce((select c.situacao from pagamentos.charges c where c.id = pg_temp.cob(p_n)), '-')) $$;
create function pg_temp.item(p_n integer, p_seq integer default 1) returns uuid language sql stable security definer as $$
  select i.id from agenda.appointment_items i where i.request_id = pg_temp.pid(p_n) and i.seq = p_seq $$;
-- a devolução do agendamento N que está na fila (pedida, enviada ou que falhou); ou a da situação pedida
create function pg_temp.dev(p_n integer, p_situacao text default null) returns uuid language sql stable security definer as $$
  select f.id from pagamentos.refunds f
  where f.charge_id = pg_temp.cob(p_n) and (p_situacao is null or f.situacao = p_situacao)
  order by (f.situacao in ('pedida', 'enviada', 'falhou')) desc, f.criado_em desc, f.id desc limit 1 $$;
create function pg_temp.extrato(p_n integer) returns text language sql stable security definer as $$
  select coalesce(string_agg(l.tipo || ':' || l.valor_cents, ',' order by l.id), '-') from pagamentos.ledger l where l.charge_id = pg_temp.cob(p_n) $$;
-- o caminho do servidor (a Edge Function da P2 fará estas chamadas)
create function pg_temp.reservar(p_n integer, p_itens jsonb) returns jsonb language plpgsql as $$
begin
  perform pg_temp.servidor();
  return public.agenda_pay_hold(pg_temp.c(), p_itens, pg_temp.paciente(p_n), pg_temp.pid(p_n), pg_temp.codigo(p_n));
end $$;
create function pg_temp.abrir(p_n integer, p_tentativa integer default 1) returns jsonb language plpgsql as $$
begin
  perform pg_temp.servidor();
  return public.pag_charge_open(pg_temp.pid(p_n), pg_temp.codigo(p_n), 'pix', pg_temp.chave(p_n, p_tentativa));
end $$;
create function pg_temp.anexar(p_n integer, p_tentativa integer default 1) returns jsonb language plpgsql as $$
begin
  perform pg_temp.servidor();
  return public.pag_charge_attach(pg_temp.cob(p_n), 'pay_t520_' || p_n || '_' || p_tentativa, null, '00020126-copia-e-cola-de-teste-' || p_n);
end $$;
create function pg_temp.foto(p_n integer, p_foto jsonb, p_event bigint default null) returns jsonb language plpgsql as $$
begin
  perform pg_temp.servidor();
  return public.pag_sync_apply(pg_temp.cob(p_n), p_foto, p_event);
end $$;
create function pg_temp.valor(p_n integer) returns integer language sql stable security definer as $$
  select c.valor_cents from pagamentos.charges c where c.id = pg_temp.cob(p_n) $$;
create function pg_temp.pagar(p_n integer, p_valor integer default null) returns jsonb language plpgsql as $$
begin
  return pg_temp.foto(p_n, jsonb_build_object('situacao', 'paga', 'tarifa_cents', 199, 'valor_cents', coalesce(p_valor, pg_temp.valor(p_n))));
end $$;
-- reserva + cobrança + anexar (fica "aguardando pagamento"); pago() ainda paga (fica "confirmado")
create function pg_temp.aguardando(p_n integer, p_itens jsonb) returns text language plpgsql as $$
begin
  return concat_ws('|', pg_temp.reservar(p_n, p_itens) ->> 'status', pg_temp.abrir(p_n) ->> 'status', pg_temp.anexar(p_n) ->> 'status');
end $$;
create function pg_temp.pago(p_n integer, p_itens jsonb) returns text language plpgsql as $$
begin
  return concat_ws('|', pg_temp.aguardando(p_n, p_itens), pg_temp.pagar(p_n) ->> 'resultado');
end $$;
-- a devolução mais recente do agendamento N: enviada e concluída pelo servidor
create function pg_temp.devolver(p_n integer) returns text language plpgsql as $$
declare
  v uuid := pg_temp.dev(p_n);
begin
  perform pg_temp.servidor();
  return concat_ws('|', public.pag_refund_sent(v) ->> 'status', public.pag_refund_done(v, 'est_t520_' || p_n) ->> 'status');
end $$;
-- "relógio": empurra os prazos do agendamento N e da cobrança dele p_min minutos para trás (marca de emergência)
create function pg_temp.passar(p_n integer, p_min integer) returns void language plpgsql security definer as $$
begin
  perform set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_relogio', true);
  update public.appointment_requests set hold_expires_at = hold_expires_at - make_interval(mins => p_min), created_at = created_at - make_interval(mins => p_min)
  where id = pg_temp.pid(p_n) and hold_expires_at is not null;
  update agenda.occupancy o set hold_until = o.hold_until - make_interval(mins => p_min)
  where o.active and o.hold_until is not null and o.item_id in (select i.id from agenda.appointment_items i where i.request_id = pg_temp.pid(p_n));
  update pagamentos.charges set expira_em = expira_em - make_interval(mins => p_min) where request_id = pg_temp.pid(p_n);
  perform set_config('imed.origin', '', true), set_config('imed.reason', '', true);
end $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated', pg_temp.email(n), now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from generate_series(1, 6) n;
insert into public.admin_emails (email) values (pg_temp.email(4));
insert into private.imed_staff (user_id, role) values (pg_temp.u(6), 'financeiro');
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua do Pagamento, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values (pg_temp.c(), 'Clínica do Pagamento 520', 1), (pg_temp.d(), 'Outra Clínica 520', 2)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  (pg_temp.c(), pg_temp.u(1), 'owner'), (pg_temp.c(), pg_temp.u(2), 'manager'), (pg_temp.c(), pg_temp.u(3), 'finance'),
  (pg_temp.d(), pg_temp.u(5), 'owner');
insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949';

select pg_temp.dona();
select public.agenda_unit_save(pg_temp.c(), jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_min', 30));
select set_config('teste.rm1', public.agenda_resource_save(pg_temp.c(), '{"kind": "equipamento", "name": "RM-1"}') ->> 'id', true);
select set_config('teste.usg1', public.agenda_resource_save(pg_temp.c(), '{"kind": "equipamento", "name": "USG-1"}') ->> 'id', true);
select set_config('teste.sala', public.agenda_resource_save(pg_temp.c(), '{"kind": "sala", "name": "Sala de coleta", "capacity": 10}') ->> 'id', true);
-- preços de exemplo, só para as contas (não são preço de clínica nenhuma): R$ 200,00, R$ 99,90, R$ 33,33, R$ 15,00 e "sob consulta"
select set_config('teste.' || x.chave, public.agenda_procedure_save(pg_temp.c(), jsonb_strip_nulls(jsonb_build_object(
         'exam_code', x.exame, 'name', x.nome, 'duration_min', 30, 'price_cents', x.preco,
         'requirements', jsonb_build_array(jsonb_build_object('resource_kind', x.tipo, 'options',
           jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id(x.recurso)))))))) ->> 'id', true)
from (values ('rm', 'rm', 'Ressonância', 20000, 'equipamento', 'rm1'), ('usg', 'usg', 'Ultrassom', 9990, 'equipamento', 'usg1'),
             ('eco', 'eco', 'Ecocardiograma', 3333, 'sala', 'sala'), ('ecg', 'ecg', 'Eletrocardiograma', 1500, 'sala', 'sala'),
             ('lab', 'lab', 'Exame sob consulta', null, 'sala', 'sala')) x (chave, exame, nome, preco, tipo, recurso);
select public.agenda_rules_set(pg_temp.c(), null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d));
select pg_temp.banco();
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_agenda', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now() where id = pg_temp.c();
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
-- liga o recebimento da clínica do teste, pelos passos de verdade: chave geral (IMED) → carteira e termos (dona) →
-- conferência (IMED) → unidade no modo online (dona)
create function pg_temp.ligar() returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.admin();
  v := public.admin_pag_chave_geral(true, 'teste_ci') ->> 'status';
  perform pg_temp.dona();
  v := v || '|' || (public.pag_clinic_connect(pg_temp.c(), 'wal_teste_520_0001', 'v1') ->> 'situacao');
  perform pg_temp.admin();
  v := v || '|' || (public.admin_pag_conta_conferir(pg_temp.c(), 'ativa', 'conta_conferida') ->> 'situacao');
  perform pg_temp.dona();
  v := v || '|' || (public.pag_clinic_pause(pg_temp.c(), false) ->> 'payment_mode');
  perform pg_temp.banco();
  return v;
end $$;


/* ===================== A. A matriz de transições da cobrança ===================== */
-- Para cada par (de, para): cria uma cobrança na situação "de" e tenta levar a "para". Devolve os pares aceitos.
insert into pagamentos.subscriptions (id, clinic_id, plano, preco_cents) values ('e5520000-0000-4000-8000-000000000001', pg_temp.c(), 'destaque', 10000);
create function pg_temp.matriz() returns text[] language plpgsql as $$
declare
  v_sits text[] := array['criada', 'aguardando', 'processando', 'aprovada', 'expirada', 'cancelada', 'recusada', 'devolvida_parcial', 'devolvida', 'contestada'];
  v_de text;
  v_para text;
  v_id uuid;
  v_ok text[] := '{}';
  n integer := 0;
begin
  foreach v_de in array v_sits loop
    foreach v_para in array v_sits loop
      continue when v_de = v_para;
      n := n + 1;
      v_id := gen_random_uuid();
      begin
        insert into pagamentos.charges (id, finalidade, subscription_id, clinic_id, emitida_por, meio, valor_cents, taxa_cents, clinica_cents,
                                        chave_idempotencia, situacao, provedor_cobranca_id, paga_em, pago_cents, devolvido_cents,
                                        taxa_devolvida_cents, clinica_devolvida_cents)
        values (v_id, 'destaque', 'e5520000-0000-4000-8000-000000000001', pg_temp.c(), 'imed', 'pix', 10000, 1500, 8500, gen_random_uuid(), v_de,
                case when v_de <> 'criada' then 'pay_matriz_' || n end,
                case when v_de in ('aprovada', 'devolvida_parcial', 'devolvida', 'contestada') then now() end,
                case when v_de in ('aprovada', 'devolvida_parcial', 'devolvida', 'contestada') then 10000 end,
                case v_de when 'devolvida_parcial' then 1000 when 'devolvida' then 10000 else 0 end,
                case v_de when 'devolvida_parcial' then 150 when 'devolvida' then 1500 else 0 end,
                case v_de when 'devolvida_parcial' then 850 when 'devolvida' then 8500 else 0 end);
        -- vai com tudo o que a situação de destino pede (para a recusa ser só da transição)
        update pagamentos.charges c set
          situacao = v_para,
          provedor_cobranca_id = coalesce(c.provedor_cobranca_id, 'pay_matriz_' || n),
          paga_em = coalesce(c.paga_em, case when v_para in ('aprovada', 'devolvida_parcial', 'devolvida', 'contestada') then now() end),
          pago_cents = coalesce(c.pago_cents, case when v_para in ('aprovada', 'devolvida_parcial', 'devolvida', 'contestada') then 10000 end),
          devolvido_cents = greatest(c.devolvido_cents, case v_para when 'devolvida_parcial' then 1000 when 'devolvida' then 10000 else 0 end),
          taxa_devolvida_cents = greatest(c.taxa_devolvida_cents, case v_para when 'devolvida_parcial' then 150 when 'devolvida' then 1500 else 0 end),
          clinica_devolvida_cents = greatest(c.clinica_devolvida_cents, case v_para when 'devolvida_parcial' then 850 when 'devolvida' then 8500 else 0 end)
        where c.id = v_id;
        v_ok := v_ok || (v_de || '>' || v_para);
      exception when others then
        null;   -- transição recusada (ou a situação de destino não fecha com as contas)
      end;
    end loop;
  end loop;
  return v_ok;
end $$;
select is(pg_temp.matriz(),
  array['criada>aguardando', 'criada>cancelada',
        'aguardando>processando', 'aguardando>aprovada', 'aguardando>expirada', 'aguardando>cancelada', 'aguardando>recusada',
        'processando>aprovada', 'processando>expirada', 'processando>cancelada', 'processando>recusada',
        'aprovada>devolvida_parcial', 'aprovada>devolvida', 'aprovada>contestada',
        'expirada>devolvida', 'cancelada>devolvida',
        'devolvida_parcial>devolvida', 'devolvida_parcial>contestada',
        'contestada>aprovada', 'contestada>devolvida_parcial', 'contestada>devolvida'],
  'das 90 transições possíveis, só as 21 do §4.1 (devolvida e recusada não saem; expirada e cancelada nunca voltam a aprovada)');

/* ===================== B. O caminho do Pix ===================== */
select is(pg_temp.ligar(), 'ok|em_conferencia|ativa|online', 'recebimento ligado');
select is(pg_temp.reservar(1, pg_temp.itens('rm', '09:00')) ->> 'status', 'ok', 'o paciente toca em "Ir para o pagamento": reserva de 10 minutos');
select is(pg_temp.sit(1), 'hold|-', 'reserva, ainda sem cobrança');
select is(pg_temp.abrir(1) ->> 'status', 'ok', 'cobrança criada aqui');
select is(pg_temp.sit(1), 'hold|criada', 'reserva + cobrança "criada" (ainda sem resposta do meio de pagamento)');
select is(pg_temp.anexar(1) ->> 'status', 'ok', 'a cobrança existe no meio de pagamento');
select is(pg_temp.sit(1), 'awaiting_payment|aguardando', 'agendamento "aguardando pagamento", cobrança "aguardando"');
select is(pg_temp.anexar(1) ->> 'replay', 'true', 'anexar de novo com o mesmo id: replay');
select pg_temp.entrar('anon');
select is((select concat_ws('|', j ->> 'request_status', j #>> '{payment,situacao}', j #>> '{payment,valor_cents}', j #>> '{payment,meio}',
                            (j #>> '{payment,pix_copia_cola}' like '00020126%')::text, ((j #>> '{payment,expira_em}')::timestamptz < (j ->> 'hold_expires_at')::timestamptz)::text,
                            (j::text ~ 'pay_t|wal_teste|taxa')::text)
           from (select public.pag_my_payment(pg_temp.pid(1), pg_temp.codigo(1)) as j) x),
          'awaiting_payment|aguardando|20000|pix|true|true|false',
          'o paciente vê valor, meio, "copia e cola" e o prazo (antes do fim da reserva); nada do provedor nem da taxa');
select is((select j #>> '{payment,situacao}' from (select public.agenda_my_booking(pg_temp.pid(1), pg_temp.codigo(1)) as j) x), 'aguardando',
          'agenda_my_booking traz o resumo do pagamento');
select is(public.agenda_book(pg_temp.c(), pg_temp.itens('rm', '09:00'), pg_temp.paciente(2), pg_temp.pid(2), pg_temp.codigo(2)) ->> 'status',
          'payment_required', 'outro paciente tentando confirmar sem pagar: payment_required');
select is(pg_temp.reservar(2, pg_temp.itens('rm', '09:00')) ->> 'status', 'slot_taken', 'e, indo pagar o mesmo horário: slot_taken, antes de qualquer cobrança');
select is((select concat_ws('|', j ->> 'status', j ->> 'resultado', j ->> 'situacao', j ->> 'request_status', j ->> 'acao') from (select pg_temp.pagar(1) as j) x),
          'ok|aplicado|aprovada|confirmed|nenhuma', 'pagamento confirmado e valor conferido: cobrança aprovada, agendamento confirmado');
select is(pg_temp.extrato(1), 'recebido:20000,taxa_imed:3000,repasse_clinica:17000,tarifa_meio:199',
          'extrato: R$ 200,00 do paciente = R$ 30,00 do IMED + R$ 170,00 da clínica; tarifa de R$ 1,99 do meio');
select pg_temp.banco();
select is((select concat_ws('|', a.status, coalesce(a.hold_expires_at::text, '-'), (select bool_and(o.hold_until is null and o.active) from agenda.occupancy o
                                                                                  where o.item_id = pg_temp.item(1))::text)
           from public.appointment_requests a where a.id = pg_temp.pid(1)),
          'confirmed|-|true', 'confirmado: sem prazo no cabeçalho nem na ocupação');
select is((select string_agg(concat_ws(':', coalesce(from_status, 'novo'), to_status, actor_kind, origin), ' ' order by id)
           from agenda.status_history where request_id = pg_temp.pid(1) and item_id is null),
          'novo:hold:paciente:app hold:awaiting_payment:paciente:app awaiting_payment:confirmed:gateway:webhook_pagamento',
          'histórico: reserva e espera pelo paciente; confirmação pelo meio de pagamento (gateway)');
select is((select concat_ws('|', c.situacao, c.pago_cents, c.tarifa_meio_cents, (c.pix_copia_cola is null)::text, (c.paga_em is not null)::text)
           from pagamentos.charges c where c.id = pg_temp.cob(1)),
          'aprovada|20000|199|true|true', 'cobrança aprovada: o "copia e cola" foi apagado ao sair de "aguardando" (§5.5)');
select is((select concat_ws('|', j ->> 'resultado', j ->> 'situacao') from (select pg_temp.pagar(1) as j) x), 'repetido|aprovada',
          'aplicar o pagamento de novo: repetido, nada muda');
select is(pg_temp.extrato(1), 'recebido:20000,taxa_imed:3000,repasse_clinica:17000,tarifa_meio:199', 'e o extrato continua com um conjunto de linhas só');
select pg_temp.dona();
select is((select count(*)::integer from jsonb_array_elements(public.agenda_requests(pg_temp.c()) -> 'requests') r where (r ->> 'id')::uuid = pg_temp.pid(1)), 1,
          'a clínica vê o agendamento pago na lista de pedidos');
select is((select concat_ws('|', j #>> '{totais,valor_cents}', j #>> '{totais,taxa_cents}', j #>> '{totais,clinica_cents}', jsonb_array_length(j -> 'linhas'),
                            j #>> '{linhas,0,exam_code}', (j::text ~ 'Paciente|1190000')::text)
           from (select public.pag_clinic_statement(pg_temp.c(), current_date - 1, current_date + 1) as j) x),
          '20000|3000|17000|1|rm|false', 'extrato da clínica: valor, taxa e parte dela por exame, sem dado de paciente');
select pg_temp.como(3);
select is(public.pag_clinic_statement(pg_temp.c(), current_date - 1, current_date + 1) ->> 'status', 'ok', 'o financeiro da clínica lê o extrato');
select pg_temp.como(5);
select is(public.pag_clinic_statement(pg_temp.c(), current_date - 1, current_date + 1) ->> 'status', 'forbidden', 'a dona de OUTRA clínica não');
select is(public.pag_clinic_status(pg_temp.c()) ->> 'status', 'forbidden', 'nem a situação do recebimento');
select pg_temp.banco();
select is((select sum(reads)::integer from agenda.access_log where fn = 'pag_clinic_statement' and clinic_id = pg_temp.c()), 2,
          'cada leitura do extrato fica registrada (quem leu)');

/* ===================== C. Invariantes ===================== */
select is(pg_temp.aguardando(3, pg_temp.itens('rm', '10:00')), 'ok|ok|ok', 'outro agendamento aguardando pagamento');
select pg_temp.servidor();
select is(public.agenda_confirm(pg_temp.pid(3)) ->> 'status', 'transition_not_allowed',
          'agenda_confirm (da integração) não confirma quem aguarda pagamento');
select is(pg_temp.reservar(30, pg_temp.itens('usg', '10:00')) ->> 'status', 'ok', 'uma reserva para pagar, ainda sem cobrança');
select pg_temp.servidor();
select throws_ok($$ select public.agenda_confirm(pg_temp.pid(30)) $$, 'IMP04', null,
                 'P-I1: nem o servidor confirma (agenda_confirm) uma reserva paga online sem a cobrança aprovada');
select is(public.agenda_cancel(pg_temp.pid(30), null, pg_temp.codigo(30)) ->> 'status', 'ok', '(a reserva de teste é cancelada pelo paciente)');
select pg_temp.banco();
select is(pg_temp.sit(3), 'awaiting_payment|aguardando', 'continua aguardando pagamento');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_invariante', true);
select throws_ok($$ update agenda.appointment_items set status = 'confirmed' where request_id = pg_temp.pid(3) $$, 'IMP04', null,
                 'P-I1 nos itens: nem pelo SQL de emergência o exame fica confirmado sem cobrança aprovada');
select throws_ok($$ update public.appointment_requests set status = 'confirmed', hold_expires_at = null where id = pg_temp.pid(3) $$, 'IMP04', null,
                 'P-I1 no cabeçalho: idem');
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
select throws_ok($$ insert into pagamentos.charges (finalidade, request_id, clinic_id, emitida_por, meio, valor_cents, taxa_cents, clinica_cents, chave_idempotencia)
                    values ('agendamento', pg_temp.pid(3), pg_temp.c(), 'imed', 'pix', 20000, 3000, 17000, gen_random_uuid()) $$,
                 '23505', null, 'P-I3: segunda cobrança viva para o mesmo agendamento: recusada');
select throws_ok($$ insert into pagamentos.charges (finalidade, request_id, clinic_id, emitida_por, meio, valor_cents, taxa_cents, clinica_cents, chave_idempotencia, situacao, provedor_cobranca_id)
                    values ('agendamento', pg_temp.pid(1), pg_temp.c(), 'imed', 'pix', 20000, 3001, 17000, gen_random_uuid(), 'expirada', 'pay_x_1') $$,
                 '23514', null, 'P-I4: valor ≠ taxa + parte da clínica: recusado');
select throws_ok($$ update pagamentos.charges set valor_cents = 1, clinica_cents = 0, taxa_cents = 1 where id = pg_temp.cob(1) $$, '42501', null,
                 'valor, taxa e parte da clínica não mudam depois de gravados');
select throws_ok($$ update pagamentos.charges set devolvido_cents = 20001, clinica_devolvida_cents = 17001, taxa_devolvida_cents = 3000 where id = pg_temp.cob(1) $$,
                 '23514', null, 'P-I5: devolvido não passa do pago');
select throws_ok($$ update pagamentos.charges set devolvido_cents = 100, clinica_devolvida_cents = 100 where id = pg_temp.cob(1) $$, '23514', null,
                 'aprovada com devolução parcial registrada tem de estar em "devolvida_parcial" (situação e conta juntas)');
select throws_ok($$ update pagamentos.charge_items set devolvido_cents = preco_cents + 1 where charge_id = pg_temp.cob(1) $$, '23514', null,
                 'P-I5 por exame: devolvido não passa do preço');
select throws_ok($$ update pagamentos.charges set situacao = 'aguardando' where id = pg_temp.cob(1) $$, '23514', null,
                 'aprovada não volta a aguardando');
update pagamentos.charges set pix_copia_cola = 'x' where id = pg_temp.cob(1);
select is((select pix_copia_cola from pagamentos.charges where id = pg_temp.cob(1)), null,
          'o "copia e cola" não volta numa cobrança que não espera mais (a guarda apaga)');
select is((select count(*)::integer from public.appointment_requests a
           where a.payment_mode = 'online' and a.status = 'confirmed'
             and (select count(*) from pagamentos.charges c where c.request_id = a.id and c.situacao in ('aprovada', 'devolvida_parcial', 'contestada')
                    and c.valor_cents = a.total_cents) <> 1), 0,
          'P-I1 conferido nos dados: todo confirmado com pagamento online tem exatamente uma cobrança aprovada do valor dele');
select is((select count(*)::integer from pagamentos.charges c where c.valor_cents <> c.taxa_cents + c.clinica_cents
              or c.valor_cents <> (select sum(ci.preco_cents) from pagamentos.charge_items ci where ci.charge_id = c.id) and c.finalidade = 'agendamento'), 0,
          'P-I4 conferido nos dados: valor = taxa + parte da clínica, e a soma dos exames é o valor');

/* ===================== D. Desistir, cobrança que não nasce e limites ===================== */
select pg_temp.entrar('anon');
select is(public.agenda_cancel(pg_temp.pid(3), null, pg_temp.codigo(3)) ->> 'status', 'ok', 'o paciente desiste antes de pagar ("Cancelar")');
select is(pg_temp.sit(3), 'cancelled|cancelada', 'agendamento cancelado e cobrança cancelada na mesma hora; o horário volta');
select pg_temp.servidor();
select is((select string_agg(a ->> 'acao', ',') from jsonb_array_elements(public.pag_due() -> 'acoes') a where (a ->> 'charge_id')::uuid = pg_temp.cob(3)),
          'apagar', 'a rotina recebe a tarefa de apagar a cobrança no meio de pagamento');
select is(pg_temp.foto(3, '{"situacao": "apagada"}') ->> 'resultado', 'aplicado', 'apagada lá: registrado');
select is((select count(*)::integer from jsonb_array_elements(public.pag_due() -> 'acoes') a where (a ->> 'charge_id')::uuid = pg_temp.cob(3)), 0,
          'e a tarefa some');
select is(pg_temp.reservar(4, pg_temp.itens('rm', '10:00')) ->> 'status', 'ok', 'o horário cancelado é reservado por outro paciente');
select is(pg_temp.abrir(4) ->> 'status', 'ok', 'cobrança criada, mas o meio de pagamento está fora do ar (não anexa)');
select is(pg_temp.reservar(4, pg_temp.itens('usg', '10:00')) ->> 'status', 'idempotency_conflict', 'o mesmo id de agendamento com outro exame: idempotency_conflict');
select pg_temp.servidor();
select is(public.pag_charge_abort(pg_temp.pid(4)) ->> 'status', 'ok', 'o servidor solta a reserva na hora');
select is(pg_temp.sit(4), 'cancelled|cancelada', 'reserva cancelada (pelo sistema) e cobrança cancelada');
select pg_temp.banco();
select is((select concat_ws('|', cancelled_by, cancel_reason) from public.appointment_requests where id = pg_temp.pid(4)), 'system|nao_pago',
          'quem cancelou: o sistema; motivo: nao_pago');
select is(pg_temp.reservar(5, pg_temp.itens('rm', '11:00')) ->> 'status', 'ok', 'paciente 5 reserva para pagar');
create function pg_temp.reservar_de(p_n integer, p_fone integer, p_itens jsonb) returns jsonb language plpgsql as $$
begin
  perform pg_temp.servidor();
  return public.agenda_pay_hold(pg_temp.c(), p_itens, pg_temp.paciente(p_fone), pg_temp.pid(p_n), pg_temp.codigo(p_n));
end $$;
select is(pg_temp.reservar_de(6, 5, pg_temp.itens('usg', '11:00')) ->> 'status', 'payment_pending',
          'o mesmo telefone com outra reserva aguardando pagamento: payment_pending');
select is(pg_temp.reservar(5, pg_temp.itens('rm', '11:00')) ->> 'replay', 'true', 'reenviar a MESMA reserva (mesmo id e código): replay, não esbarra no limite');
select is(pg_temp.abrir(5) ->> 'status', 'ok', 'cobrança 1');
select is(pg_temp.anexar(5) ->> 'status', 'ok', 'anexada');
select is(pg_temp.foto(5, '{"situacao": "recusada"}') ->> 'situacao', 'recusada', 'recusada (como um cartão recusado)');
select is(pg_temp.abrir(5, 2) ->> 'tentativa', '2', 'com a reserva ainda viva, nova tentativa: cobrança 2');
select is(pg_temp.anexar(5, 2) ->> 'status', 'ok', 'anexada (o agendamento já estava aguardando pagamento)');
select is(pg_temp.foto(5, '{"situacao": "recusada"}') ->> 'situacao', 'recusada', 'recusada de novo');
select is(pg_temp.abrir(5, 3) ->> 'tentativa', '3', 'cobrança 3');
select is(pg_temp.anexar(5, 3) ->> 'status', 'ok', 'anexada');
select is(pg_temp.foto(5, '{"situacao": "recusada"}') ->> 'situacao', 'recusada', 'recusada pela terceira vez');
select is(pg_temp.abrir(5, 4) ->> 'status', 'too_many_attempts', 'quarta cobrança para o mesmo agendamento: too_many_attempts (máximo 3)');

select * from finish();
rollback;
