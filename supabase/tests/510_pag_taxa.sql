-- iMed Pagamentos, fase P1 (arquitetura do pagamento §3.3, §5.2 e §11): a taxa do IMED e o preço mínimo.
--   A. as contas em centavos: piso por exame (na dúvida de 1 centavo, o centavo é da clínica) e a taxa devolvida
--      acumulada (piso de devolvido × taxa ÷ preço; inteira quando devolveu tudo): a soma fecha sempre;
--   B. a cobrança calcula tudo dos itens do banco, EXAME A EXAME (não pelo total do pacote), e fotografa a taxa;
--   C. histórico da taxa: taxa nova = linha nova que fecha a anterior; sem sobreposição; o valor não se altera; a taxa
--      nova não mexe em cobrança antiga; a regra da clínica vale mais que a padrão; só o dono do IMED define;
--   D. preço mínimo e exame "sob consulta": só paga online a marcação com todos os exames com preço e total a partir
--      do mínimo; o resto continua "pagamento no local" (e nada fica reservado quando a reserva para pagar é recusada);
--   E. na clínica que recebe pelo site, marcação que pode ser paga online não é confirmada sem pagar (payment_required).
-- Os preços são de exemplo, só para as contas. Tudo é desfeito no fim (rollback).
begin;
select plan(55);
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
  select ('a5510000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'gestor', 'caixa', 'admin', 'outra', 'equipe'])[p_n] || '.pag510@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.dona() returns void language sql as $$ select pg_temp.como(1) $$;
create function pg_temp.admin() returns void language sql as $$ select pg_temp.como(4) $$;
create function pg_temp.servidor() returns void language sql as $$ select pg_temp.entrar('service_role') $$;
create function pg_temp.banco() returns void language sql as $$ select pg_temp.entrar('postgres') $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c5510000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.d() returns uuid language sql immutable as $$ select 'c5510000-0000-4000-8000-000000000002'::uuid $$;
-- o dia do teste (daqui a 30 dias) e um horário dele, na hora de São Paulo
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.itens(variadic p text[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('procedure_id', pg_temp.id(p[i]), 'starts_at', pg_temp.t(p[i + 1])) order by i)
  from generate_series(1, cardinality(p), 2) i $$;
-- agendamento N: id "b5510...-N", código "codigo-secreto-N", chave da cobrança "d5510...-N" (tentativa T: ...-T-N)
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b5510000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.chave(p_n integer, p_tentativa integer default 1) returns uuid language sql immutable as $$
  select ('d5510000-0000-4000-' || lpad(p_tentativa::text, 4, '0') || '-' || lpad(p_n::text, 12, '0'))::uuid $$;
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
  return public.pag_charge_attach(pg_temp.cob(p_n), 'pay_t510_' || p_n || '_' || p_tentativa, null, '00020126-copia-e-cola-de-teste-' || p_n);
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
  return concat_ws('|', public.pag_refund_sent(v) ->> 'status', public.pag_refund_done(v, 'est_t510_' || p_n) ->> 'status');
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
from (values (pg_temp.c(), 'Clínica do Pagamento 510', 1), (pg_temp.d(), 'Outra Clínica 510', 2)) c (id, nome, n);
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
  v := v || '|' || (public.pag_clinic_connect(pg_temp.c(), 'wal_teste_510_0001', 'v1') ->> 'situacao');
  perform pg_temp.admin();
  v := v || '|' || (public.admin_pag_conta_conferir(pg_temp.c(), 'ativa', 'conta_conferida') ->> 'situacao');
  perform pg_temp.dona();
  v := v || '|' || (public.pag_clinic_pause(pg_temp.c(), false) ->> 'payment_mode');
  perform pg_temp.banco();
  return v;
end $$;


/* ===================== A. As contas ===================== */
select is(array(select private.pag_fee('percentual', 1500, null, p) from unnest(array[20000, 9990, 3333, 1500, 7, 6, 1, 10000000]) p),
          array[3000, 1498, 499, 225, 1, 0, 0, 1500000], 'taxa de 15%: piso de preço × 1500 ÷ 10000 (R$ 99,90 → R$ 14,98, não R$ 14,99)');
select is(array(select private.pag_fee('percentual', b, null, 9990) from unnest(array[0, 1, 1000, 10000]) b),
          array[0, 0, 999, 9990], 'pontos-base: 0%, 0,01%, 10% e 100%');
select is(array(select private.pag_fee('fixo', null, 500, p) from unnest(array[20000, 500, 300]) p),
          array[500, 500, 300], 'taxa fixa por exame: o valor fixo, nunca mais que o preço');
select is(array(select private.pag_refund_fee(9990, 1498, a, v) from (values (0, 9990), (0, 1), (0, 7), (7, 9983), (0, 4995), (4995, 4995), (9989, 1)) x (a, v)),
          array[1498, 0, 1, 1497, 749, 749, 1], 'taxa devolvida: piso do acumulado; devolveu tudo, a taxa inteira');
select is((select sum(private.pag_refund_fee(9990, 1498, (k - 1) * 333, 333))::integer from generate_series(1, 30) k), 1498,
          '30 devoluções parciais de R$ 3,33: a soma da taxa devolvida fecha na taxa inteira, no centavo');
select is((select count(*)::integer from generate_series(1, 9990) k
           where private.pag_refund_fee(9990, 1498, 0, k) + private.pag_refund_fee(9990, 1498, k, 9990 - k) <> 1498), 0,
          'qualquer corte em duas devoluções fecha na taxa inteira (todos os 9.990 cortes)');
select is((select count(*)::integer from generate_series(1, 9990) k
           where private.pag_refund_fee(9990, 1498, 0, k) not between 0 and least(k, 1498)), 0,
          'a taxa devolvida nunca é negativa nem passa do devolvido ou da taxa');

/* ===================== B. A cobrança, exame a exame ===================== */
select is(pg_temp.ligar(), 'ok|em_conferencia|ativa|online', 'recebimento ligado: chave geral, carteira e termos, conferência, modo online');
select is(pg_temp.reservar(1, pg_temp.itens('usg', '09:00', 'eco', '10:00')) ->> 'status', 'ok', 'reserva do pacote (ultrassom + eco) para pagar');
select pg_temp.banco();
select is((select concat_ws('|', status, payment_mode, channel, total_cents) from public.appointment_requests where id = pg_temp.pid(1)),
          'hold|online|imed_app|13323', 'reserva "hold", paga online, canal imed_app, total R$ 133,23 fotografado');
select is((select concat_ws('|', j ->> 'status', j ->> 'valor_cents', j ->> 'taxa_cents', j ->> 'clinica_cents', j ->> 'emitida_por',
                            j ->> 'wallet_id', j ->> 'descricao', j ->> 'meio', j ->> 'tentativa')
           from (select pg_temp.abrir(1) as j) x),
          'ok|13323|1997|11326|imed|wal_teste_510_0001|IMED · agendamento B5510000|pix|1',
          'cobrança: taxa 14,98 + 4,99 = 19,97 (por exame; pelo total seria 19,98); a clínica fica com 113,26; descrição sem exame');
select pg_temp.banco();
select is((select string_agg(concat_ws(':', i.exam_code, ci.preco_cents, ci.taxa_cents, ci.clinica_cents), ' ' order by i.seq)
           from pagamentos.charge_items ci join agenda.appointment_items i on i.id = ci.item_id where ci.charge_id = pg_temp.cob(1)),
          'usg:9990:1498:8492 eco:3333:499:2834', 'a conta de cada exame fica gravada (preço = taxa + parte da clínica)');
select is((select concat_ws('|', c.situacao, c.fee_bps, (c.valor_cents = c.taxa_cents + c.clinica_cents)::text,
                            (c.expira_em between now() + interval '7 minutes' and now() + interval '8 minutes')::text,
                            (c.fee_rule_id = (select id from pagamentos.fee_rules where clinic_id is null and vale_ate is null))::text)
           from pagamentos.charges c where c.id = pg_temp.cob(1)),
          'criada|1500|true|true|true', 'cobrança criada com a foto da taxa (15%), a conta fechada e o QR de 8 minutos');
select is(pg_temp.abrir(1) ->> 'replay', 'true', 'a mesma chave devolve a mesma cobrança (replay)');
select is(pg_temp.abrir(1, 2) ->> 'status', 'charge_exists', 'outra chave com uma cobrança viva: charge_exists (P-I3)');
select pg_temp.servidor();
select is(public.pag_charge_open(pg_temp.pid(1), 'codigo-errado-000000', 'pix', gen_random_uuid()) ->> 'status', 'not_found',
          'sem o código do agendamento: not_found');
select is(public.pag_charge_open(pg_temp.pid(1), pg_temp.codigo(1), 'cartao', gen_random_uuid()) ->> 'status', 'method_not_available',
          'cartão: a clínica só aceita Pix nesta fase (method_not_available)');

/* ===================== C. Histórico da taxa ===================== */
select pg_temp.dona();
select is(public.admin_pag_taxa_definir(null, 'percentual', 1000, 'teste_taxa') ->> 'status', 'forbidden', 'a dona da clínica não define a taxa');
select pg_temp.como(6);
select is(public.admin_pag_taxa_definir(null, 'percentual', 1000, 'teste_taxa') ->> 'status', 'forbidden',
          'o financeiro da equipe do IMED (só imed.financeiro.ver) também não: só o dono do IMED');
select is(public.admin_pag_resumo(current_date - 1, current_date) ->> 'status', 'ok', 'mas o financeiro da equipe lê o resumo');
select pg_temp.admin();
select is(public.admin_pag_taxa_definir(null, 'percentual', 1000, null) ->> 'status', 'reason_required', 'definir a taxa exige o motivo (código)');
select is(public.admin_pag_taxa_definir(null, 'percentual', 10001, 'teste_taxa') ->> 'status', 'invalid', 'percentual acima de 100%: invalid');
select is(public.admin_pag_taxa_definir(null, 'percentual', 1000, 'teste_taxa') ->> 'status', 'ok', 'o dono do IMED muda a taxa padrão para 10%');
select is(public.admin_pag_taxa_definir(null, 'percentual', 1200, 'teste_taxa') ->> 'status', 'too_soon',
          'duas mudanças no mesmo instante para a mesma clínica: too_soon');
select pg_temp.banco();
select is((select string_agg(concat_ws(':', fee_bps, (vale_ate is null)::text), ' ' order by vale_de) from pagamentos.fee_rules where clinic_id is null),
          '1500:false 1000:true', 'a regra antiga foi fechada e a nova entrou como outra linha');
select throws_ok($$ insert into pagamentos.fee_rules (clinic_id, finalidade, tipo, fee_bps, motivo) values (null, 'exame', 'percentual', 2000, 'teste_taxa') $$,
                 '23P01', null, 'dois períodos sobrepostos para a mesma clínica e finalidade: recusado');
select throws_ok($$ update pagamentos.fee_rules set fee_bps = 2000 where vale_ate is null $$, '42501', null, 'o valor de uma regra não se altera');
select throws_ok($$ update pagamentos.fee_rules set vale_ate = now() + interval '1 day' where vale_ate is not null $$, '42501', null,
                 'nem o fim de uma regra já fechada');
select is((select concat_ws('|', taxa_cents, fee_bps) from pagamentos.charges where id = pg_temp.cob(1)), '1997|1500',
          'a cobrança antiga guarda a taxa de quando foi criada');
select is(pg_temp.reservar(2, pg_temp.itens('rm', '09:00')) ->> 'status', 'ok', 'reserva nova, depois da mudança');
select is((select concat_ws('|', j ->> 'valor_cents', j ->> 'taxa_cents', j ->> 'clinica_cents') from (select pg_temp.abrir(2) as j) x),
          '20000|2000|18000', 'a cobrança nova usa a taxa nova (10%)');
select pg_temp.admin();
select is(public.admin_pag_taxa_definir(pg_temp.c(), 'fixo', 700, 'teste_taxa_clinica') ->> 'status', 'ok', 'taxa própria da clínica: R$ 7,00 fixos por exame');
select is(public.admin_pag_taxa_definir('00000000-0000-4000-8000-00000000dead', 'fixo', 700, 'teste_taxa_clinica') ->> 'status', 'not_found',
          'clínica que não existe: not_found');
select is(pg_temp.reservar(3, pg_temp.itens('rm', '11:00', 'eco', '12:00')) ->> 'status', 'ok', 'outro pacote, agora com a regra da clínica');
select is((select concat_ws('|', j ->> 'valor_cents', j ->> 'taxa_cents', j ->> 'clinica_cents') from (select pg_temp.abrir(3) as j) x),
          '23333|1400|21933', 'a regra da clínica vale mais que a padrão: R$ 7,00 por exame (2 exames)');
select pg_temp.dona();
select is((select concat_ws('|', j ->> 'situacao', j ->> 'recebendo', j #>> '{taxa,tipo}', j #>> '{taxa,cents}', j #>> '{taxa,da_clinica}', j ->> 'carteira_final',
                            j ->> 'pode_configurar')
           from (select public.pag_clinic_status(pg_temp.c()) as j) x),
          'ativa|true|fixo|700|true|0001|true', 'a dona vê a situação do recebimento e a taxa em vigor');
select pg_temp.banco();
select is((select count(*)::integer from pagamentos.audit_log where acao = 'taxa.definir' and motivo like 'teste_taxa%'), 2,
          'cada mudança de taxa fica na trilha, com o motivo');

/* ===================== D. Preço mínimo e "sob consulta" ===================== */
select is((select concat_ws('|', j ->> 'status', j ->> 'min_cents') from (select pg_temp.reservar(4, pg_temp.itens('ecg', '09:00')) as j) x),
          'below_minimum|2000', 'exame de R$ 15,00 (abaixo do mínimo de R$ 20,00): não reserva para pagar');
select is(pg_temp.reservar(5, pg_temp.itens('lab', '09:30')) ->> 'status', 'price_required', 'exame "sob consulta": não reserva para pagar');
select is(pg_temp.reservar(6, pg_temp.itens('usg', '13:00', 'lab', '14:00')) ->> 'status', 'price_required',
          'pacote com um exame "sob consulta": também não (todos precisam de preço)');
select pg_temp.banco();
select is((select count(*)::integer from public.appointment_requests where id in (pg_temp.pid(4), pg_temp.pid(5), pg_temp.pid(6))), 0,
          'e nada fica reservado nem segurando horário');
select is((select count(*)::integer from agenda.occupancy o where o.clinic_id = pg_temp.c() and o.active
           and not exists (select 1 from agenda.appointment_items i where i.id = o.item_id)), 0, 'nenhuma ocupação solta');

/* ===================== E. Quem pode pagar online não confirma sem pagar ===================== */
select pg_temp.entrar('anon');
select is(public.agenda_book(pg_temp.c(), pg_temp.itens('usg', '15:00'), pg_temp.paciente(7), pg_temp.pid(7), pg_temp.codigo(7)) ->> 'status',
          'payment_required', 'agenda_book com exame de R$ 99,90 na clínica que recebe pelo site: payment_required');
select is(public.agenda_book(pg_temp.c(), pg_temp.itens('ecg', '15:00'), pg_temp.paciente(8), pg_temp.pid(8), pg_temp.codigo(8)) ->> 'status',
          'ok', 'exame abaixo do mínimo: continua confirmando de uma vez (pagamento no local)');
select is(public.agenda_book(pg_temp.c(), pg_temp.itens('usg', '16:00', 'lab', '17:00'), pg_temp.paciente(9), pg_temp.pid(9), pg_temp.codigo(9)) ->> 'status',
          'ok', 'pacote com exame "sob consulta": também (pagamento no local)');
select is((select concat_ws('|', j ->> 'payment', j ->> 'payment_methods', j ->> 'payment_min_cents', j ->> 'payment_hold_min',
                            (j ->> 'payment_text' like 'Pagamento aqui no site%')::text)
           from (select public.agenda_public_info(pg_temp.c()) as j) x),
          'online|["pix"]|2000|10|true', 'agenda_public_info: pagamento online, só Pix, mínimo de R$ 20,00 e reserva de 10 minutos');
select is(public.agenda_public_info(pg_temp.d()) ->> 'payment', 'no_local', 'a outra clínica (sem conta) continua "no local"');
select pg_temp.banco();
select is((select string_agg(concat_ws(':', payment_mode, status, coalesce(total_cents::text, 'sob consulta')), ' ' order by created_at, id)
           from public.appointment_requests where id in (pg_temp.pid(8), pg_temp.pid(9))),
          'no_local:confirmed:1500 no_local:confirmed:sob consulta', 'os dois nasceram confirmados, com pagamento no local');
select pg_temp.admin();
select is(public.admin_pag_parametro_definir('preco_minimo_online_cents', '99', 'teste_minimo') ->> 'status', 'invalid', 'mínimo fora da faixa: invalid');
select is(public.admin_pag_parametro_definir('vendas_online_ligadas', 'true', 'teste_minimo') ->> 'status', 'invalid',
          'a chave geral não muda por aqui (tem a função dela)');
select is(public.admin_pag_parametro_definir('regra_devolucao_falta', '"metade"', 'teste_regra') ->> 'status', 'invalid', 'regra de devolução: só total ou nenhuma');
select is(public.admin_pag_parametro_definir('preco_minimo_online_cents', '1000', 'teste_minimo') ->> 'status', 'ok', 'o dono do IMED baixa o mínimo para R$ 10,00');
select is(public.admin_pag_parametro_definir('tarifa_pix_cents', '199', 'tarifa_conferida') ->> 'status', 'ok', 'e confere a tarifa do Pix');
select pg_temp.banco();
select is((select a_confirmar from pagamentos.settings where chave = 'tarifa_pix_cents'), false, 'tarifa definida por uma pessoa deixa de estar "a confirmar"');
select pg_temp.entrar('anon');
select is(public.agenda_book(pg_temp.c(), pg_temp.itens('ecg', '18:00'), pg_temp.paciente(10), pg_temp.pid(10), pg_temp.codigo(10)) ->> 'status',
          'payment_required', 'com o mínimo novo, o exame de R$ 15,00 passa a exigir pagamento');

select * from finish();
rollback;
