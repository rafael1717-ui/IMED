-- iMed Pagamentos, fase P1 (arquitetura do pagamento §4.4 e §11): os avisos do meio de pagamento.
--   A. o aviso é gravado só com os campos da lista e o hash do corpo; o MESMO aviso não entra duas vezes ("repetido");
--   B. o aviso é só a campainha: aplica-se a situação consultada no provedor. Fora de ordem → situação final certa;
--      situação que anda para trás é ignorada e registrada; "apagada" numa cobrança paga não mexe em nada e chama a equipe;
--   C. valor pago diferente do esperado: não confirma, abre diferença crítica e devolve o que chegou (inteiro);
--   D. dinheiro numa cobrança já cancelada: nunca reabre; volta inteiro;
--   E. aviso de cobrança desconhecida fica guardado como "sem_cobranca"; foto inválida é recusada; aviso gravado e não
--      aplicado volta para a rotina.
-- Tudo é desfeito no fim (rollback).
begin;
select plan(65);
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
  select ('a5530000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'gestor', 'caixa', 'admin', 'outra', 'equipe'])[p_n] || '.pag530@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.dona() returns void language sql as $$ select pg_temp.como(1) $$;
create function pg_temp.admin() returns void language sql as $$ select pg_temp.como(4) $$;
create function pg_temp.servidor() returns void language sql as $$ select pg_temp.entrar('service_role') $$;
create function pg_temp.banco() returns void language sql as $$ select pg_temp.entrar('postgres') $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c5530000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.d() returns uuid language sql immutable as $$ select 'c5530000-0000-4000-8000-000000000002'::uuid $$;
-- o dia do teste (daqui a 30 dias) e um horário dele, na hora de São Paulo
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.itens(variadic p text[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('procedure_id', pg_temp.id(p[i]), 'starts_at', pg_temp.t(p[i + 1])) order by i)
  from generate_series(1, cardinality(p), 2) i $$;
-- agendamento N: id "b5530...-N", código "codigo-secreto-N", chave da cobrança "d5530...-N" (tentativa T: ...-T-N)
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b5530000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.chave(p_n integer, p_tentativa integer default 1) returns uuid language sql immutable as $$
  select ('d5530000-0000-4000-' || lpad(p_tentativa::text, 4, '0') || '-' || lpad(p_n::text, 12, '0'))::uuid $$;
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
  return public.pag_charge_attach(pg_temp.cob(p_n), 'pay_t530_' || p_n || '_' || p_tentativa, null, '00020126-copia-e-cola-de-teste-' || p_n);
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
  return concat_ws('|', public.pag_refund_sent(v) ->> 'status', public.pag_refund_done(v, 'est_t530_' || p_n) ->> 'status');
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
from (values (pg_temp.c(), 'Clínica do Pagamento 530', 1), (pg_temp.d(), 'Outra Clínica 530', 2)) c (id, nome, n);
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
  v := v || '|' || (public.pag_clinic_connect(pg_temp.c(), 'wal_teste_530_0001', 'v1') ->> 'situacao');
  perform pg_temp.admin();
  v := v || '|' || (public.admin_pag_conta_conferir(pg_temp.c(), 'ativa', 'conta_conferida') ->> 'situacao');
  perform pg_temp.dona();
  v := v || '|' || (public.pag_clinic_pause(pg_temp.c(), false) ->> 'payment_mode');
  perform pg_temp.banco();
  return v;
end $$;

select is(pg_temp.ligar(), 'ok|em_conferencia|ativa|online', 'recebimento ligado');
create function pg_temp.aviso(p_evento text, p_tipo text, p_n integer, p_sit text default 'RECEIVED') returns jsonb language plpgsql as $$
begin
  perform pg_temp.servidor();
  return public.pag_event_store('asaas', p_evento, p_tipo, 'pay_t530_' || p_n || '_1', p_sit, 20000, now(), repeat('a', 64));
end $$;
create function pg_temp.evid(p_evento text) returns bigint language sql stable security definer as $$
  select e.id from pagamentos.events e where e.provedor_evento_id = p_evento $$;
create function pg_temp.ev(p_evento text) returns text language sql stable security definer as $$
  select concat_ws('|', e.resultado, e.repeticoes, (e.charge_id is not null)::text, (e.aplicado_em is not null)::text)
  from pagamentos.events e where e.provedor_evento_id = p_evento $$;

/* ===================== A. Gravar o aviso ===================== */
select is(pg_temp.aguardando(1, pg_temp.itens('rm', '09:00')), 'ok|ok|ok', 'agendamento 1 aguardando pagamento');
select is((select concat_ws('|', j ->> 'status', ((j ->> 'charge_id')::uuid = pg_temp.cob(1))::text) from (select pg_temp.aviso('evt_530_1', 'PAYMENT_RECEIVED', 1) as j) x),
          'ok|true', 'aviso novo: gravado e ligado à cobrança pelo id do provedor');
select is(pg_temp.ev('evt_530_1'), 'pendente|0|true|false', 'fica pendente até a situação ser aplicada');
select is(pg_temp.aviso('evt_530_1', 'PAYMENT_RECEIVED', 1) ->> 'status', 'repetido', 'o mesmo aviso de novo: repetido');
select is(pg_temp.aviso('evt_530_1', 'PAYMENT_RECEIVED', 1) ->> 'status', 'repetido', 'e de novo: repetido');
select pg_temp.banco();
select is((select concat_ws('|', count(*), max(repeticoes)) from pagamentos.events where provedor_evento_id = 'evt_530_1'), '1|2',
          'uma linha só, com a contagem das repetições');
select is((select concat_ws('|', tipo, situacao_no_provedor, valor_cents, length(hash_do_corpo)) from pagamentos.events where provedor_evento_id = 'evt_530_1'),
          'PAYMENT_RECEIVED|RECEIVED|20000|64', 'guardados: tipo, situação no provedor, valor e o hash do corpo (o corpo, não)');
select is(pg_temp.aviso('evt_530_x', 'payment received', 1) ->> 'status', 'invalid', 'tipo fora do formato de código: invalid (nada gravado)');
select is(pg_temp.aviso('evt_530_desconhecida', 'PAYMENT_RECEIVED', 99) ->> 'status', 'sem_cobranca', 'aviso de cobrança que não é nossa: sem_cobranca');
select is(pg_temp.ev('evt_530_desconhecida'), 'sem_cobranca|0|false|true', 'e fica guardado assim (a conciliação aponta se for dinheiro de verdade)');

/* ===================== B. A campainha e a ordem ===================== */
select is((select concat_ws('|', j ->> 'resultado', j ->> 'situacao', j ->> 'request_status')
           from (select pg_temp.foto(1, '{"situacao": "paga", "valor_cents": 20000, "tarifa_cents": 199}',
                                     pg_temp.evid('evt_530_1')) as j) x),
          'aplicado|aprovada|confirmed', 'consulta no provedor: paga, valor conferido → aprovada e confirmado');
select is(pg_temp.ev('evt_530_1'), 'aplicado|2|true|true', 'o aviso recebe o resultado: aplicado');
select is(pg_temp.aviso('evt_530_2', 'PAYMENT_CONFIRMED', 1, 'CONFIRMED') ->> 'status', 'ok', 'outro aviso (outro id) do mesmo pagamento');
select is(pg_temp.foto(1, '{"situacao": "paga", "valor_cents": 20000, "tarifa_cents": 199}', pg_temp.evid('evt_530_2')) ->> 'resultado',
          'repetido', 'a situação já estava aplicada: repetido');
select is(pg_temp.ev('evt_530_2'), 'repetido|0|true|true', 'o segundo aviso fica como repetido');
select is(pg_temp.extrato(1), 'recebido:20000,taxa_imed:3000,repasse_clinica:17000,tarifa_meio:199', 'um só conjunto de linhas no extrato');
select is((select concat_ws('|', j ->> 'resultado', j ->> 'situacao', j ->> 'request_status') from (select pg_temp.foto(1, '{"situacao": "aguardando"}') as j) x),
          'ignorado_antigo|aprovada|confirmed', 'aviso antigo chegando depois ("aguardando"): ignorado; continua aprovada e confirmado');
select is(pg_temp.foto(1, '{"situacao": "recusada"}') ->> 'resultado', 'ignorado_antigo', '"recusada" depois de aprovada: ignorado');
select is(pg_temp.foto(1, '{"situacao": "processando"}') ->> 'resultado', 'ignorado_antigo', '"processando" depois de aprovada: ignorado');
select pg_temp.banco();
select is((select count(*)::integer from pagamentos.audit_log where acao = 'cobranca.aviso_antigo' and charge_id = pg_temp.cob(1)), 3,
          'cada situação que andava para trás ficou registrada');
select is((select concat_ws('|', j ->> 'resultado', j ->> 'situacao', j ->> 'acao') from (select pg_temp.foto(1, '{"situacao": "apagada"}') as j) x),
          'erro|aprovada|conferir', '"apagada" numa cobrança paga: nada muda e a equipe é chamada');
select pg_temp.banco();
select is((select concat_ws('|', tipo, gravidade, (resolvida_em is null)::text) from pagamentos.reconciliation_diffs where charge_id = pg_temp.cob(1)),
          'falta_la|critica|true', 'diferença crítica aberta ("aqui pago, lá não")');
-- o aviso de devolução chega antes do de pagamento
select is(pg_temp.aguardando(2, pg_temp.itens('usg', '09:00')), 'ok|ok|ok', 'agendamento 2 aguardando pagamento');
select is((select concat_ws('|', j ->> 'resultado', j ->> 'situacao', j ->> 'acao') from (select pg_temp.foto(2, '{"situacao": "devolvida", "devolvido_cents": 9990}') as j) x),
          'valor_divergente|aguardando|conferir', 'aviso de devolução de algo que nem foi pago aqui: nada é aplicado; a equipe confere');
select is((select concat_ws('|', j ->> 'resultado', j ->> 'situacao', j ->> 'request_status') from (select pg_temp.pagar(2) as j) x),
          'aplicado|aprovada|confirmed', 'e o pagamento, quando chega, é aplicado normalmente');

/* ===================== C. Valor pago diferente ===================== */
select is(pg_temp.aguardando(3, pg_temp.itens('rm', '10:00')), 'ok|ok|ok', 'agendamento 3 aguardando R$ 200,00');
select is((select concat_ws('|', j ->> 'resultado', j ->> 'situacao', j ->> 'request_status', j ->> 'acao') from (select pg_temp.pagar(3, 19000) as j) x),
          'valor_divergente|cancelada|awaiting_payment|devolver', 'chegaram R$ 190,00: NÃO confirma; a cobrança é encerrada e o valor vai voltar');
select pg_temp.banco();
select is((select concat_ws('|', f.integral::text, f.automatica::text, f.valor_cents, f.motivo, f.situacao, f.pedido_por_tipo) from pagamentos.refunds f where f.charge_id = pg_temp.cob(3)),
          'true|true|19000|valor_divergente|pedida|sistema', 'devolução INTEIRA do que chegou, pedida na mesma transação');
select is((select concat_ws('|', d.tipo, d.gravidade, d.nosso ->> 'valor_cents', d.deles ->> 'valor_cents') from pagamentos.reconciliation_diffs d where d.charge_id = pg_temp.cob(3)),
          'valor|critica|20000|19000', 'diferença crítica aberta, com o esperado e o recebido');
select is(pg_temp.extrato(3), 'recebido:19000', 'extrato: só o que chegou (sem taxa nem repasse: não foi aprovada)');
select is(pg_temp.devolver(3), 'ok|ok', 'a rotina envia e conclui a devolução');
select is(pg_temp.extrato(3), 'recebido:19000,devolucao:-19000', 'e o extrato zera');
select pg_temp.banco();
select is((select concat_ws('|', situacao, pago_cents, devolvido_cents) from pagamentos.charges where id = pg_temp.cob(3)), 'devolvida|19000|0',
          'cobrança: cancelada → devolvida (nunca passou por aprovada)');
select is(pg_temp.abrir(3, 2) ->> 'tentativa', '2', 'com a reserva ainda viva, o paciente pode pagar de novo (cobrança nova)');

/* ===================== D. Dinheiro em cobrança já cancelada ===================== */
select is(pg_temp.aguardando(4, pg_temp.itens('usg', '11:00')), 'ok|ok|ok', 'agendamento 4 aguardando pagamento');
select pg_temp.entrar('anon');
select is(public.agenda_cancel(pg_temp.pid(4), null, pg_temp.codigo(4)) ->> 'status', 'ok', 'o paciente desiste');
select is((select concat_ws('|', j ->> 'resultado', j ->> 'situacao', j ->> 'request_status', j ->> 'acao') from (select pg_temp.pagar(4) as j) x),
          'aplicado|cancelada|cancelled|devolver', 'e paga mesmo assim: a cobrança NÃO reabre e o agendamento continua cancelado');
select pg_temp.banco();
select is((select concat_ws('|', f.integral::text, f.valor_cents, f.motivo) from pagamentos.refunds f where f.charge_id = pg_temp.cob(4)),
          'true|9990|pagamento_fora_do_prazo', 'devolução inteira pedida na mesma transação');
select is((select j ->> 'resultado' from (select pg_temp.pagar(4) as j) x), 'repetido', 'o mesmo pagamento de novo: repetido (não pede outra devolução)');
select pg_temp.banco();
select is((select count(*)::integer from pagamentos.refunds f where f.charge_id = pg_temp.cob(4)), 1, 'uma devolução só');
select is(pg_temp.devolver(4), 'ok|ok', 'enviada e concluída');
select is(pg_temp.sit(4), 'cancelled|devolvida', 'cancelada → devolvida');
select is((select concat_ws('|', j #>> '{payment,situacao}', j #>> '{payment,devolucoes,0,valor_cents}', j #>> '{payment,devolucoes,0,situacao}')
           from (select public.pag_my_payment(pg_temp.pid(4), pg_temp.codigo(4)) as j) x),
          'devolvida|9990|devolvida', 'o paciente vê a devolução');

/* ===================== E. Entradas inválidas e aviso pendente ===================== */
select pg_temp.servidor();
select is(public.pag_sync_apply(gen_random_uuid(), '{"situacao": "paga", "valor_cents": 100}') ->> 'status', 'not_found', 'cobrança desconhecida: not_found');
select is(public.pag_sync_apply(pg_temp.cob(1), '{"situacao": "estranha"}') ->> 'status', 'invalid', 'situação fora da lista: invalid');
select is(public.pag_sync_apply(pg_temp.cob(1), '{"situacao": "paga"}') ->> 'status', 'invalid', '"paga" sem o valor: invalid');
select is(public.pag_sync_apply(pg_temp.cob(1), '{"situacao": "paga", "valor_cents": -5}') ->> 'status', 'invalid', 'valor negativo: invalid');
select is(public.pag_sync_apply(pg_temp.cob(1), '{"situacao": "paga", "valor_cents": "muito"}') ->> 'status', 'invalid', 'valor que não é número: invalid');
select is(public.pag_sync_apply(pg_temp.cob(1), '[]') ->> 'status', 'invalid', 'foto que não é objeto: invalid');
select is(pg_temp.aguardando(5, pg_temp.itens('eco', '12:00')), 'ok|ok|ok', 'agendamento 5 aguardando pagamento');
select is(pg_temp.aviso('evt_530_5', 'PAYMENT_RECEIVED', 5) ->> 'status', 'ok', 'aviso gravado; o servidor cai antes de aplicar');
select pg_temp.servidor();
select is((select count(*)::integer from jsonb_array_elements(public.pag_due() -> 'acoes') a where a ->> 'acao' = 'reaplicar'), 0,
          'na hora, a rotina ainda não o pega (pode estar sendo aplicado)');
select pg_temp.banco();
update pagamentos.events set recebido_em = now() - interval '2 minutes' where provedor_evento_id = 'evt_530_5';
select pg_temp.servidor();
select is((select concat_ws('|', a ->> 'acao', ((a ->> 'charge_id')::uuid = pg_temp.cob(5))::text, a ->> 'provedor_cobranca_id')
           from jsonb_array_elements(public.pag_due() -> 'acoes') a where a ->> 'acao' = 'reaplicar'),
          'reaplicar|true|pay_t530_5_1', 'um minuto depois, a rotina recebe a tarefa de reaplicar o aviso pendente');
select is(pg_temp.foto(5, '{"situacao": "paga", "valor_cents": 3333}', pg_temp.evid('evt_530_5')) ->> 'request_status',
          'confirmed', 'reaplicado: confirmado');
select pg_temp.servidor();
select is((select count(*)::integer from jsonb_array_elements(public.pag_due() -> 'acoes') a where a ->> 'acao' = 'reaplicar'), 0, 'e a tarefa some');
select pg_temp.admin();
select is((select concat_ws('|', j ->> 'criticas_abertas', jsonb_array_length(j -> 'diferencas')) from (select public.admin_pag_conciliacao() as j) x),
          '2|3', 'a gestão vê as diferenças abertas: 2 críticas (paga × apagada; valor) e 1 alta (devolução desconhecida)');

/* ===================== F. Contestação (cartão, fase P4): o registro mínimo ===================== */
select pg_temp.servidor();
select is(public.pag_sync_apply(pg_temp.cob(2), '{"situacao": "contestada", "prazo": "amanhã cedo"}') ->> 'status', 'invalid',
          'prazo da contestação que não é data: invalid (nada aplicado)');
select is((select concat_ws('|', j ->> 'resultado', j ->> 'situacao', j ->> 'request_status', j ->> 'acao')
           from (select pg_temp.foto(2, '{"situacao": "contestada", "provedor_disputa_id": "disp_teste_2", "motivo": "nao_reconhece"}') as j) x),
          'aplicado|contestada|confirmed|conferir', 'contestação: cobrança "contestada"; nada é cancelado sozinho; a equipe é chamada');
select pg_temp.banco();
select is((select concat_ws('|', d.situacao, d.motivo, d.provedor_disputa_id) from pagamentos.disputes d where d.charge_id = pg_temp.cob(2)),
          'aberta|nao_reconhece|disp_teste_2', 'a contestação fica registrada');
select pg_temp.dona();
select is(public.pag_clinic_refund(pg_temp.pid(2), null, 500, 'outro') ->> 'status', 'not_refundable', 'cobrança contestada não aceita devolução nova');
select is(pg_temp.foto(2, '{"situacao": "contestada"}') ->> 'resultado', 'repetido', 'o mesmo aviso de contestação de novo: repetido');
select is((select concat_ws('|', j ->> 'resultado', j ->> 'situacao') from (select pg_temp.foto(2, '{"situacao": "contestacao_ganha"}') as j) x),
          'aplicado|aprovada', 'contestação vencida: a cobrança volta a "aprovada"');
select is(pg_temp.extrato(2), 'recebido:9990,taxa_imed:1498,repasse_clinica:8492,tarifa_meio:199,contestacao:-9990,contestacao_revertida:9990',
          'o extrato mostra a contestação e a reversão');
select pg_temp.banco();
select is((select concat_ws('|', d.situacao, d.resultado) from pagamentos.disputes d where d.charge_id = pg_temp.cob(2)), 'encerrada|ganha', 'contestação encerrada: ganha');

select * from finish();
rollback;
