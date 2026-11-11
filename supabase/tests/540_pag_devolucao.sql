-- iMed Pagamentos, fase P1 (arquitetura do pagamento §4.4, §4.5 e §11): devoluções.
--   A. total: o paciente cancela → devolução pela regra, pedida NA MESMA TRANSAÇÃO; a rotina envia (com a divisão entre
--      a taxa do IMED e a parte da clínica) e conclui; o extrato zera; a taxa do IMED volta junto;
--   B. parcial (valor escolhido pela clínica) e por exame (um exame do pacote cancelado): a conta fecha no centavo e
--      nunca passa do pago; a mesma chave não vira duas devoluções; exame que ainda vale não é devolvido inteiro;
--   C. quem pode: só o dono da clínica (financeiro.estornar) e o dono do IMED (imed.financeiro.operar);
--   D. desfazer: reabrir um cancelado desfaz a devolução ainda não enviada; depois de enviada, a reabertura é recusada;
--   E. a regra por parâmetro: falta (sem devolução automática) e cancelamento do paciente.
-- Os preços são de exemplo. Tudo é desfeito no fim (rollback).
begin;
select plan(80);
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
  select ('a5540000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'gestor', 'caixa', 'admin', 'outra', 'equipe'])[p_n] || '.pag540@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.dona() returns void language sql as $$ select pg_temp.como(1) $$;
create function pg_temp.admin() returns void language sql as $$ select pg_temp.como(4) $$;
create function pg_temp.servidor() returns void language sql as $$ select pg_temp.entrar('service_role') $$;
create function pg_temp.banco() returns void language sql as $$ select pg_temp.entrar('postgres') $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c5540000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.d() returns uuid language sql immutable as $$ select 'c5540000-0000-4000-8000-000000000002'::uuid $$;
-- o dia do teste (daqui a 30 dias) e um horário dele, na hora de São Paulo
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.itens(variadic p text[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('procedure_id', pg_temp.id(p[i]), 'starts_at', pg_temp.t(p[i + 1])) order by i)
  from generate_series(1, cardinality(p), 2) i $$;
-- agendamento N: id "b5540...-N", código "codigo-secreto-N", chave da cobrança "d5540...-N" (tentativa T: ...-T-N)
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b5540000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.chave(p_n integer, p_tentativa integer default 1) returns uuid language sql immutable as $$
  select ('d5540000-0000-4000-' || lpad(p_tentativa::text, 4, '0') || '-' || lpad(p_n::text, 12, '0'))::uuid $$;
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
  return public.pag_charge_attach(pg_temp.cob(p_n), 'pay_t540_' || p_n || '_' || p_tentativa, null, '00020126-copia-e-cola-de-teste-' || p_n);
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
  return concat_ws('|', public.pag_refund_sent(v) ->> 'status', public.pag_refund_done(v, 'est_t540_' || p_n) ->> 'status');
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
from (values (pg_temp.c(), 'Clínica do Pagamento 540', 1), (pg_temp.d(), 'Outra Clínica 540', 2)) c (id, nome, n);
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
  v := v || '|' || (public.pag_clinic_connect(pg_temp.c(), 'wal_teste_540_0001', 'v1') ->> 'situacao');
  perform pg_temp.admin();
  v := v || '|' || (public.admin_pag_conta_conferir(pg_temp.c(), 'ativa', 'conta_conferida') ->> 'situacao');
  perform pg_temp.dona();
  v := v || '|' || (public.pag_clinic_pause(pg_temp.c(), false) ->> 'payment_mode');
  perform pg_temp.banco();
  return v;
end $$;

select is(pg_temp.ligar(), 'ok|em_conferencia|ativa|online', 'recebimento ligado');
create function pg_temp.r(p_n integer) returns text language sql stable security definer as $$
  select coalesce(string_agg(concat_ws(':', f.situacao, f.valor_cents, coalesce(f.taxa_cents::text, '-'), coalesce(f.clinica_cents::text, '-'), f.motivo,
                                       case when f.automatica then 'regra' else 'pessoa' end), ' '
                             order by array_position(array['concluida', 'desfeita', 'falhou', 'enviada', 'pedida'], f.situacao), f.valor_cents, f.motivo), '-')
  from pagamentos.refunds f where f.charge_id = pg_temp.cob(p_n) $$;
create function pg_temp.conta(p_n integer) returns text language sql stable security definer as $$
  select concat_ws('|', c.situacao, c.devolvido_cents, c.taxa_devolvida_cents, c.clinica_devolvida_cents) from pagamentos.charges c where c.id = pg_temp.cob(p_n) $$;
create function pg_temp.saldo(p_n integer) returns text language sql stable security definer as $$
  select string_agg(q.de_quem || ':' || q.total, ' ' order by q.de_quem)
  from (select l.de_quem, sum(l.valor_cents) as total from pagamentos.ledger l where l.charge_id = pg_temp.cob(p_n) and l.tipo <> 'tarifa_meio' group by 1) q $$;

/* ===================== A. Total: o paciente cancela ===================== */
select is(pg_temp.pago(1, pg_temp.itens('rm', '09:00')), 'ok|ok|ok|aplicado', 'agendamento 1 pago e confirmado (R$ 200,00)');
select pg_temp.entrar('anon');
select is(public.agenda_cancel(pg_temp.pid(1), null, pg_temp.codigo(1)) ->> 'status', 'ok', 'o paciente cancela (30 dias antes do exame)');
select is(pg_temp.r(1), 'pedida:20000:-:-:cancelado_paciente:regra', 'devolução total pedida na mesma transação, pela regra (§4.5)');
select is(pg_temp.sit(1), 'cancelled|aprovada', 'agendamento cancelado (o horário volta); a cobrança só muda quando a devolução conclui');
select is((select concat_ws('|', j #>> '{payment,devolucoes,0,situacao}', j #>> '{payment,devolucoes,0,valor_cents}')
           from (select public.pag_my_payment(pg_temp.pid(1), pg_temp.codigo(1)) as j) x), 'pedida|20000', 'o paciente vê "devolução pedida"');
select pg_temp.servidor();
select is((select concat_ws('|', a ->> 'acao', ((a ->> 'refund_id')::uuid = pg_temp.dev(1))::text) from jsonb_array_elements(public.pag_due() -> 'acoes') a
           where (a ->> 'charge_id')::uuid = pg_temp.cob(1)), 'enviar_devolucao|true', 'a rotina recebe a tarefa de enviar a devolução');
select is((select concat_ws('|', j ->> 'status', j ->> 'valor_cents', j ->> 'taxa_cents', j ->> 'clinica_cents', j ->> 'total', j ->> 'wallet_id',
                            (j ->> 'chave_idempotencia' is not null)::text, j ->> 'provedor_cobranca_id')
           from (select public.pag_refund_sent(pg_temp.dev(1)) as j) x),
          'ok|20000|3000|17000|true|wal_teste_540_0001|true|pay_t540_1_1',
          'envio: R$ 30,00 saem da taxa do IMED e R$ 170,00 da carteira da clínica; vai a chave de idempotência');
select is((select concat_ws('|', j ->> 'status', j ->> 'taxa_cents', j ->> 'tentativas') from (select public.pag_refund_sent(pg_temp.dev(1)) as j) x),
          'ok|3000|2', 'pedir o envio de novo: os mesmos valores (o provedor recebe a mesma chave)');
select is(public.pag_refund_failed(pg_temp.dev(1), 'provedor_fora_do_ar') ->> 'status', 'ok', 'o envio falhou (provedor fora do ar)');
select is(pg_temp.r(1), 'falhou:20000:3000:17000:cancelado_paciente:regra', 'fica "falhou", na fila da rotina; o dinheiro não saiu');
select is(pg_temp.conta(1), 'aprovada|0|0|0', 'nada foi somado na cobrança');
select is(pg_temp.devolver(1), 'ok|ok', 'nova tentativa: enviada e concluída');
select pg_temp.servidor();
select is(public.pag_refund_done(pg_temp.dev(1), 'est_x') ->> 'replay', 'true', 'concluir de novo: replay (não soma duas vezes)');
select is(pg_temp.conta(1), 'devolvida|20000|3000|17000', 'cobrança devolvida: a taxa do IMED voltou inteira, junto');
select is(pg_temp.extrato(1), 'recebido:20000,taxa_imed:3000,repasse_clinica:17000,tarifa_meio:199,devolucao:-20000,devolucao_taxa:-3000,devolucao_repasse:-17000',
          'extrato: as três linhas da devolução (a tarifa do meio não volta: é custo do IMED)');
select is(pg_temp.saldo(1), 'clinica:0 imed:0 paciente:0', 'e cada parte zera');
select is(public.pag_refund_sent(pg_temp.dev(1)) ->> 'status', 'done', 'devolução concluída não é enviada de novo');

/* ===================== B. Parcial e por exame ===================== */
select is(pg_temp.pago(2, pg_temp.itens('usg', '09:00', 'eco', '10:00')), 'ok|ok|ok|aplicado', 'pacote 2 pago: ultrassom (99,90) + eco (33,33) = 133,23; taxa 19,97');
select pg_temp.dona();
select is(public.pag_clinic_refund(pg_temp.pid(2), null, null, 'acordo_com_paciente') ->> 'status', 'cancel_first',
          'a clínica não devolve INTEIRO um agendamento que ainda vale (ficaria confirmado sem dinheiro): cancel_first');
select is(public.pag_clinic_refund(pg_temp.pid(2), null, 13323, 'acordo_com_paciente') ->> 'status', 'cancel_first', 'nem informando o valor inteiro');
select is(public.pag_clinic_refund(pg_temp.pid(2), null, 1000, 'porque sim') ->> 'status', 'invalid_reason', 'motivo fora da lista: invalid_reason');
select is(public.pag_clinic_refund(pg_temp.pid(2), null, 0, 'acordo_com_paciente') ->> 'status', 'invalid', 'valor zero: invalid');
select is((select concat_ws('|', j ->> 'status', j ->> 'valor_cents') from (select public.pag_clinic_refund(pg_temp.pid(2), null, 1000, 'acordo_com_paciente',
            'd5540000-0000-4000-9000-000000000001') as j) x), 'ok|1000', 'devolução parcial de R$ 10,00 (valor escolhido pela clínica)');
select is(public.pag_clinic_refund(pg_temp.pid(2), null, 1000, 'acordo_com_paciente', 'd5540000-0000-4000-9000-000000000001') ->> 'replay', 'true',
          'o mesmo pedido de novo (mesma chave): replay');
select is(pg_temp.r(2), 'pedida:1000:-:-:clinica_acordo_com_paciente:pessoa', 'uma devolução só');
select is((select concat_ws('|', j ->> 'status', j ->> 'resta_cents') from (select public.pag_clinic_refund(pg_temp.pid(2), null, 13000, 'acordo_com_paciente') as j) x),
          'over_limit|12323', 'pedir mais do que resta (pago − devolvido − já pedido): over_limit');
select is(pg_temp.devolver(2), 'ok|ok', 'enviada e concluída');
select is(pg_temp.conta(2), 'devolvida_parcial|1000|149|851', 'R$ 10,00 do ultrassom: taxa devolvida = piso(1000 × 1498 ÷ 9990) = 1,49; clínica 8,51');
select pg_temp.dona();
select is(public.agenda_set_status(pg_temp.pid(2), 'cancelled', 'equipamento_manutencao', null, pg_temp.item(2, 2)) ->> 'request_status', 'confirmed',
          'a clínica cancela SÓ o eco do pacote (aparelho em manutenção); o agendamento continua confirmado');
select is(pg_temp.r(2), 'concluida:1000:149:851:clinica_acordo_com_paciente:pessoa pedida:3333:-:-:cancelado_clinica:regra',
          'devolução do preço daquele exame, pedida na mesma transação');
select is(pg_temp.devolver(2), 'ok|ok', 'enviada e concluída');
select is(pg_temp.conta(2), 'devolvida_parcial|4333|648|3685', 'eco inteiro: a taxa dele (4,99) volta inteira; acumulado 1,49 + 4,99');
select pg_temp.dona();
select is(public.pag_clinic_refund(pg_temp.pid(2), pg_temp.item(2, 2), null, 'outro') ->> 'status', 'nothing_to_refund', 'o eco já foi devolvido inteiro: nada a devolver');
select is(public.pag_clinic_refund(pg_temp.pid(2), pg_temp.item(2, 2), 1, 'outro') ->> 'resta_cents', '0', 'nem 1 centavo a mais (over_limit, resta 0)');
select is(public.pag_clinic_refund(pg_temp.pid(2), pg_temp.item(2, 1), 2990, 'exame_nao_realizado') ->> 'status', 'ok', 'mais R$ 29,90 do ultrassom');
select is(pg_temp.devolver(2), 'ok|ok', 'enviada e concluída');
select is(pg_temp.conta(2), 'devolvida_parcial|7323|1097|6226',
          'ultrassom com 39,90 devolvidos: taxa acumulada dele = piso(3990 × 1498 ÷ 9990) = 5,98 (1,49 + 4,49); com a do eco, 10,97');
select pg_temp.dona();
select is(public.agenda_set_status(pg_temp.pid(2), 'cancelled', 'clinica_indisponivel') ->> 'request_status', 'cancelled', 'a clínica cancela o que resta');
select is(pg_temp.devolver(2), 'ok|ok', 'o resto do ultrassom (R$ 60,00) é devolvido pela regra');
select is(pg_temp.conta(2), 'devolvida|13323|1997|11326', 'tudo devolvido em 4 partes: a taxa devolvida fecha na taxa inteira, no centavo');
select is(pg_temp.saldo(2), 'clinica:0 imed:0 paciente:0', 'e o extrato zera para cada parte');
select pg_temp.banco();
select is((select string_agg(concat_ws(':', i.exam_code, (ci.devolvido_cents = ci.preco_cents)::text), ' ' order by i.seq)
           from pagamentos.charge_items ci join agenda.appointment_items i on i.id = ci.item_id where ci.charge_id = pg_temp.cob(2)),
          'usg:true eco:true', 'cada exame com o devolvido igual ao preço');
select is((select count(*)::integer from pagamentos.charges c where c.devolvido_cents > c.valor_cents or c.taxa_devolvida_cents > c.taxa_cents
              or c.clinica_devolvida_cents > c.clinica_cents or c.devolvido_cents <> c.taxa_devolvida_cents + c.clinica_devolvida_cents), 0,
          'P-I5 conferido nos dados');

/* ===================== C. Quem pode ===================== */
select is(pg_temp.pago(3, pg_temp.itens('rm', '10:00')), 'ok|ok|ok|aplicado', 'agendamento 3 pago');
select pg_temp.como(2);
select is(public.pag_clinic_refund(pg_temp.pid(3), null, 500, 'outro') ->> 'status', 'forbidden', 'o gestor não pede devolução (só o dono)');
select pg_temp.como(3);
select is(public.pag_clinic_refund(pg_temp.pid(3), null, 500, 'outro') ->> 'status', 'forbidden', 'nem o financeiro da clínica');
select pg_temp.como(5);
select is(public.pag_clinic_refund(pg_temp.pid(3), null, 500, 'outro') ->> 'status', 'forbidden', 'nem a dona de outra clínica');
select pg_temp.dona();
select is(public.admin_pag_estornar(pg_temp.cob(3), null, 500, 'decisao_da_equipe') ->> 'status', 'forbidden', 'a dona da clínica não usa a função da gestão');
select pg_temp.como(6);
select is(public.admin_pag_estornar(pg_temp.cob(3), null, 500, 'decisao_da_equipe') ->> 'status', 'forbidden', 'nem o financeiro da equipe do IMED (só lê)');
select pg_temp.admin();
select is(public.admin_pag_estornar(pg_temp.cob(3), null, 500, null) ->> 'status', 'reason_required', 'o dono do IMED precisa dar o motivo');
select is(public.admin_pag_estornar(pg_temp.cob(3), null, 500, 'decisao_da_equipe') ->> 'status', 'ok', 'com motivo, pede a devolução de R$ 5,00');
select is(pg_temp.r(3), 'pedida:500:-:-:imed_decisao_da_equipe:pessoa', 'pedido gravado (quem: IMED)');
select is(pg_temp.devolver(3), 'ok|ok', 'enviada e concluída');
select is(pg_temp.conta(3), 'devolvida_parcial|500|75|425', 'R$ 5,00: taxa 0,75, clínica 4,25');

/* ===================== D. Desfazer só enquanto não foi enviada ===================== */
select pg_temp.dona();
select is(public.agenda_set_status(pg_temp.pid(3), 'cancelled', 'profissional_ausente') ->> 'request_status', 'cancelled', 'a clínica cancela o agendamento 3');
select is(pg_temp.r(3), 'concluida:500:75:425:imed_decisao_da_equipe:pessoa pedida:19500:-:-:cancelado_clinica:regra',
          'devolução do que resta (R$ 195,00) pedida pela regra: culpa da clínica, total');
select pg_temp.admin();
select is(public.agenda_set_status(pg_temp.pid(3), 'confirmed', 'outro') ->> 'request_status', 'confirmed',
          'clínica e paciente preferem manter: a equipe do IMED reabre (o horário ainda estava livre)');
select is(pg_temp.r(3), 'concluida:500:75:425:imed_decisao_da_equipe:pessoa desfeita:19500:-:-:cancelado_clinica:regra',
          'a devolução ainda não enviada é DESFEITA');
select is(pg_temp.sit(3), 'confirmed|devolvida_parcial', 'confirmado de novo, com a cobrança valendo');
select pg_temp.servidor();
select is(public.pag_refund_sent(pg_temp.dev(3, 'desfeita')) ->> 'status', 'undone', 'devolução desfeita não é enviada');
select pg_temp.dona();
select is(public.agenda_set_status(pg_temp.pid(3), 'cancelled', 'profissional_ausente') ->> 'request_status', 'cancelled', 'a clínica cancela de novo');
select pg_temp.servidor();
select is(public.pag_refund_sent(pg_temp.dev(3)) ->> 'status', 'ok', 'desta vez a rotina já ENVIOU a devolução');
select pg_temp.admin();
select throws_ok($$ select public.agenda_set_status(pg_temp.pid(3), 'confirmed', 'outro') $$, 'IMP03', null,
                 'reabrir depois de a devolução ter sido enviada: recusado (pagamento_devolvido)');
select is(pg_temp.sit(3), 'cancelled|devolvida_parcial', 'continua cancelado');
select pg_temp.servidor();
select is(public.pag_refund_done(pg_temp.dev(3), 'est_3') ->> 'status', 'ok', 'devolução concluída');
select is(pg_temp.conta(3), 'devolvida|20000|3000|17000', 'tudo devolvido; a taxa fecha (0,75 + 29,25)');

/* ===================== E. A regra por parâmetro ===================== */
select is(pg_temp.pago(4, pg_temp.itens('rm', '11:00')), 'ok|ok|ok|aplicado', 'agendamento 4 pago');
select pg_temp.banco();
select set_config('imed.origin', 'painel', true);
select is(private.pag_refund_by_rule(pg_temp.pid(4), null, 'falta') ->> 'status', 'no_refund', 'falta do paciente: sem devolução automática (§4.5, item 4)');
select set_config('imed.origin', '', true);
select is(pg_temp.r(4), '-', 'nenhuma devolução pedida');
select is((select count(*)::integer from pagamentos.audit_log where acao = 'devolucao.regra_sem_devolucao' and charge_id = pg_temp.cob(4)), 1,
          'a decisão da regra fica na trilha');
select pg_temp.admin();
select is(public.admin_pag_parametro_definir('regra_devolucao_antes_24h', '"nenhuma"', 'teste_regra') ->> 'status', 'ok',
          '(só para o teste) a regra do cancelamento com mais de 24 h vira "nenhuma"');
select pg_temp.entrar('anon');
select is(public.agenda_cancel(pg_temp.pid(4), null, pg_temp.codigo(4)) ->> 'status', 'ok', 'o paciente cancela o agendamento 4');
select is(pg_temp.r(4), '-', 'com a regra em "nenhuma", o cancelamento do paciente não pede devolução sozinho');
select is(pg_temp.sit(4), 'cancelled|aprovada', 'cancelado, com a cobrança intacta (a clínica decide)');
select pg_temp.dona();
select is((select concat_ws('|', j ->> 'status', j ->> 'valor_cents') from (select public.pag_clinic_refund(pg_temp.pid(4), null, null, 'acordo_com_paciente') as j) x),
          'ok|20000', 'e a clínica pode devolver tudo (o agendamento não vale mais)');
select is(pg_temp.pago(5, pg_temp.itens('usg', '12:00')), 'ok|ok|ok|aplicado', 'agendamento 5 pago');
select pg_temp.dona();
select is(public.agenda_set_status(pg_temp.pid(5), 'cancelled', 'clinica_indisponivel') ->> 'request_status', 'cancelled', 'a clínica cancela o agendamento 5');
select is(pg_temp.r(5), 'pedida:9990:-:-:cancelado_clinica:regra', 'culpa da clínica: total, sempre, qualquer que seja o parâmetro (§4.5, item 5)');
select pg_temp.banco();
select is((select count(*)::integer from pagamentos.charges c
           where c.situacao = 'aprovada' and c.request_id is not null
             and not exists (select 1 from public.appointment_requests a where a.id = c.request_id and private.agenda_active_status(a.status))
             and not exists (select 1 from pagamentos.refunds f where f.charge_id = c.id and f.situacao in ('pedida', 'enviada', 'falhou', 'concluida'))
             and c.id <> pg_temp.cob(4)), 0,
          'P-I2 conferido nos dados: cobrança aprovada sem agendamento ativo tem devolução pedida (fora o caso em que a regra do teste disse "nenhuma")');

select * from finish();
rollback;
