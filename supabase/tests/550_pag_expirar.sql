-- iMed Pagamentos, fase P1 (arquitetura do pagamento §4.2, §4.4, §4.6 e §11): prazos, com o relógio empurrado à mão.
--   A. o QR vence ANTES da reserva (8 min dentro de 10); a rotina consulta perto do fim e apaga a cobrança vencida; o
--      horário só é solto depois da carência (5 min): um Pix feito no último segundo ainda encontra o horário;
--   B. pagamento que chega DEPOIS de a reserva expirar: confirma pelo motor completo se o horário ainda está livre e o
--      paciente não tem outro agendamento no mesmo horário; senão devolve tudo, na mesma transação (P-I2). Nunca passa
--      por cima de outro paciente;
--   C. cartão em análise ("processando") segura a reserva até o teto (30 min);
--   D. reserva sem cobrança por mais de 60 s: a rotina solta; quem deixa vencer 3 reservas seguidas espera 30 min;
--   E. a chave geral desligada para as cobranças novas na hora; o que já foi pago continua sendo processado e devolvido.
-- Tudo é desfeito no fim (rollback).
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
  select ('a5550000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'gestor', 'caixa', 'admin', 'outra', 'equipe'])[p_n] || '.pag550@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.dona() returns void language sql as $$ select pg_temp.como(1) $$;
create function pg_temp.admin() returns void language sql as $$ select pg_temp.como(4) $$;
create function pg_temp.servidor() returns void language sql as $$ select pg_temp.entrar('service_role') $$;
create function pg_temp.banco() returns void language sql as $$ select pg_temp.entrar('postgres') $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c5550000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.d() returns uuid language sql immutable as $$ select 'c5550000-0000-4000-8000-000000000002'::uuid $$;
-- o dia do teste (daqui a 30 dias) e um horário dele, na hora de São Paulo
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.itens(variadic p text[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('procedure_id', pg_temp.id(p[i]), 'starts_at', pg_temp.t(p[i + 1])) order by i)
  from generate_series(1, cardinality(p), 2) i $$;
-- agendamento N: id "b5550...-N", código "codigo-secreto-N", chave da cobrança "d5550...-N" (tentativa T: ...-T-N)
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b5550000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.chave(p_n integer, p_tentativa integer default 1) returns uuid language sql immutable as $$
  select ('d5550000-0000-4000-' || lpad(p_tentativa::text, 4, '0') || '-' || lpad(p_n::text, 12, '0'))::uuid $$;
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
  return public.pag_charge_attach(pg_temp.cob(p_n), 'pay_t550_' || p_n || '_' || p_tentativa, null, '00020126-copia-e-cola-de-teste-' || p_n);
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
  return concat_ws('|', public.pag_refund_sent(v) ->> 'status', public.pag_refund_done(v, 'est_t550_' || p_n) ->> 'status');
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
from (values (pg_temp.c(), 'Clínica do Pagamento 550', 1), (pg_temp.d(), 'Outra Clínica 550', 2)) c (id, nome, n);
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
  v := v || '|' || (public.pag_clinic_connect(pg_temp.c(), 'wal_teste_550_0001', 'v1') ->> 'situacao');
  perform pg_temp.admin();
  v := v || '|' || (public.admin_pag_conta_conferir(pg_temp.c(), 'ativa', 'conta_conferida') ->> 'situacao');
  perform pg_temp.dona();
  v := v || '|' || (public.pag_clinic_pause(pg_temp.c(), false) ->> 'payment_mode');
  perform pg_temp.banco();
  return v;
end $$;

select is(pg_temp.ligar(), 'ok|em_conferencia|ativa|online', 'recebimento ligado');
create function pg_temp.tarefas(p_n integer) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.servidor();
  select coalesce(string_agg(a ->> 'acao', ',' order by a ->> 'acao'), '-') into v
  from jsonb_array_elements(public.pag_due() -> 'acoes') a
  where (a ->> 'charge_id')::uuid = pg_temp.cob(p_n) or (a ->> 'request_id')::uuid = pg_temp.pid(p_n);
  return v;
end $$;
create function pg_temp.horas(p_proc text) returns text[] language sql stable as $$
  select coalesce(array_agg(to_char(s.slot_start at time zone 'America/Sao_Paulo', 'HH24:MI') order by s.slot_start), '{}')
  from public.agenda_slots(pg_temp.c(), pg_temp.id(p_proc), pg_temp.dia(), pg_temp.dia()) s $$;
create function pg_temp.expirar(p_n integer) returns boolean language sql security definer as $$ select private.agenda_expire(pg_temp.pid(p_n)) $$;
create function pg_temp.reservar_de(p_n integer, p_fone integer, p_itens jsonb) returns jsonb language plpgsql as $$
begin
  perform pg_temp.servidor();
  return public.agenda_pay_hold(pg_temp.c(), p_itens, pg_temp.paciente(p_fone), pg_temp.pid(p_n), pg_temp.codigo(p_n));
end $$;

/* ===================== A. QR, reserva e carência ===================== */
select is(pg_temp.aguardando(1, pg_temp.itens('rm', '09:00')), 'ok|ok|ok', 'agendamento 1 aguardando pagamento');
select pg_temp.banco();
select is((select concat_ws('|', (c.expira_em between now() + interval '7 minutes 50 seconds' and now() + interval '8 minutes')::text,
                            (a.hold_expires_at between now() + interval '9 minutes 50 seconds' and now() + interval '10 minutes')::text,
                            (c.expira_em <= a.hold_expires_at - interval '119 seconds')::text,
                            (select (o.hold_until - a.hold_expires_at)::text from agenda.occupancy o where o.item_id = pg_temp.item(1)))
           from pagamentos.charges c join public.appointment_requests a on a.id = c.request_id where c.id = pg_temp.cob(1)),
          'true|true|true|00:05:00', 'QR de 8 min, reserva de 10 min (o QR some 2 min antes) e a ocupação segura mais 5 min de carência');
select is(pg_temp.tarefas(1), '-', 'no começo a rotina não tem nada a fazer com esta cobrança');
select pg_temp.passar(1, 7);
select is(pg_temp.tarefas(1), 'consultar', 'a 1 minuto do fim do QR sem aviso: a rotina consulta o meio de pagamento por conta própria');
select is(pg_temp.foto(1, '{"situacao": "aguardando"}') ->> 'resultado', 'repetido', 'consultou: continua esperando');
select is(pg_temp.tarefas(1), '-', 'consultada agora: não consulta de novo no mesmo minuto');
select pg_temp.passar(1, 2);
select is(pg_temp.tarefas(1), 'apagar', 'o QR venceu (9 min): a rotina apaga a cobrança no meio de pagamento');
select pg_temp.entrar('anon');
select is((select concat_ws('|', j #>> '{payment,situacao}', coalesce(j #>> '{payment,pix_copia_cola}', 'sem codigo'), j ->> 'request_status')
           from (select public.pag_my_payment(pg_temp.pid(1), pg_temp.codigo(1)) as j) x),
          'aguardando|sem codigo|awaiting_payment', 'a tela já não recebe o "copia e cola" (o prazo do QR passou), e a reserva ainda vale');
select is(pg_temp.expirar(1), false, 'a reserva ainda está no prazo: a agenda não expira');
select is(pg_temp.foto(1, '{"situacao": "apagada"}') ->> 'situacao', 'expirada', 'apagada lá depois de vencer: cobrança "expirada"');
select is(pg_temp.sit(1), 'awaiting_payment|expirada', 'o agendamento continua guardado (reserva + carência)');
select pg_temp.passar(1, 3);
select is(pg_temp.expirar(1), false, 'fim da reserva (12 min), dentro da carência: o horário continua guardado');
select ok(not ('09:00' = any (pg_temp.horas('rm'))), 'e não aparece como livre');
select pg_temp.passar(1, 4);
select is(pg_temp.expirar(1), true, 'fim da carência (16 min): a agenda expira a reserva');
select is(pg_temp.sit(1), 'expired|expirada', 'reserva expirada, cobrança expirada');
select ok('09:00' = any (pg_temp.horas('rm')), 'o horário volta para a agenda sozinho');
select is(pg_temp.tarefas(1), '-', 'nada pendente');
select is((select concat_ws('|', j ->> 'resultado', j ->> 'situacao', j ->> 'request_status', j ->> 'acao') from (select pg_temp.pagar(1) as j) x),
          'aplicado|expirada|expired|devolver', 'dinheiro numa cobrança já expirada (apagada lá): não reabre; volta inteiro');
select is(pg_temp.devolver(1), 'ok|ok', 'devolvido');
select is(pg_temp.sit(1), 'expired|devolvida', 'expirada → devolvida');

/* ===================== B. Pagamento depois de a reserva expirar ===================== */
-- (a rotina estava parada: a cobrança ficou "aguardando" e a agenda expirou a reserva)
select is(pg_temp.aguardando(2, pg_temp.itens('usg', '09:00')), 'ok|ok|ok', 'agendamento 2 aguardando pagamento');
select pg_temp.passar(2, 20);
select is(pg_temp.expirar(2), true, 'a reserva 2 expira');
select is(pg_temp.sit(2), 'expired|aguardando', 'reserva expirada; a cobrança ainda existe no meio de pagamento');
select is((select concat_ws('|', j ->> 'resultado', j ->> 'situacao', j ->> 'request_status', j ->> 'acao') from (select pg_temp.pagar(2) as j) x),
          'aplicado|aprovada|confirmed|nenhuma', 'o pagamento chega atrasado e o horário ainda está livre: confirma (expirado → confirmado)');
select pg_temp.banco();
select is((select string_agg(concat_ws(':', from_status, to_status, actor_kind, origin, coalesce(reason_code, '-')), ' ' order by id)
           from agenda.status_history where request_id = pg_temp.pid(2) and item_id is null and from_status = 'expired'),
          'expired:confirmed:sistema:cron:pagamento_atrasado', 'histórico: confirmado pelo sistema, motivo pagamento_atrasado');
select is((select concat_ws('|', count(*), bool_and(o.hold_until is null)::text) from agenda.occupancy o where o.item_id = pg_temp.item(2) and o.active),
          '1|true', 'a ocupação foi gravada de novo, pelo motor, sem prazo');
select is((select concat_ws('|', (cancel_reason is null)::text, (hold_expires_at is null)::text) from public.appointment_requests where id = pg_temp.pid(2)), 'true|true',
          'sem o motivo da expiração e sem prazo');
-- o horário foi pego por outro paciente
select is(pg_temp.aguardando(3, pg_temp.itens('rm', '10:00')), 'ok|ok|ok', 'agendamento 3 aguardando pagamento');
select pg_temp.passar(3, 20);
select is(pg_temp.reservar(4, pg_temp.itens('rm', '10:00')) ->> 'status', 'ok', 'a reserva 3 venceu e OUTRO paciente reserva o mesmo horário (a 3 expira na hora)');
select is(pg_temp.sit(3), 'expired|aguardando', 'reserva 3 expirada');
select is((select concat_ws('|', j ->> 'resultado', j ->> 'situacao', j ->> 'request_status', j ->> 'acao') from (select pg_temp.pagar(3) as j) x),
          'aplicado|aprovada|expired|devolver', 'o pagamento atrasado do 3 NÃO passa por cima do outro paciente: devolve tudo');
select pg_temp.banco();
select is((select concat_ws('|', f.valor_cents, f.motivo, f.situacao, f.automatica::text, f.integral::text) from pagamentos.refunds f where f.charge_id = pg_temp.cob(3)),
          '20000|pagamento_atrasado|pedida|true|false', 'devolução total pedida na mesma transação (P-I2)');
select is(pg_temp.sit(4), 'hold|-', 'o paciente 4 continua com o horário');
select is(pg_temp.devolver(3), 'ok|ok', 'devolvido');
select is(pg_temp.sit(3), 'expired|devolvida', 'expirado e devolvido');
select is(pg_temp.extrato(3), 'recebido:20000,taxa_imed:3000,repasse_clinica:17000,tarifa_meio:199,devolucao:-20000,devolucao_taxa:-3000,devolucao_repasse:-17000',
          'o extrato mostra a entrada e a volta inteira, inclusive a taxa do IMED');
-- o mesmo paciente já tem outro agendamento no mesmo horário
select is(pg_temp.aguardando(5, pg_temp.itens('usg', '11:00')), 'ok|ok|ok', 'agendamento 5 (ultrassom das 11:00) aguardando pagamento');
select pg_temp.passar(5, 20);
select is(pg_temp.expirar(5), true, 'a reserva 5 expira');
select is(pg_temp.reservar_de(6, 5, pg_temp.itens('eco', '11:00')) ->> 'status', 'ok', 'o mesmo paciente reserva OUTRO exame no mesmo horário');
select is((select concat_ws('|', j ->> 'request_status', j ->> 'acao') from (select pg_temp.pagar(5) as j) x), 'expired|devolver',
          'o pagamento atrasado do 5: o aparelho está livre, mas o paciente já tem outro agendamento no horário → devolve');
select pg_temp.banco();
select is((select count(*)::integer from pagamentos.charges c
           where c.situacao = 'aprovada' and c.request_id is not null
             and not exists (select 1 from public.appointment_requests a where a.id = c.request_id and private.agenda_active_status(a.status))
             and not exists (select 1 from pagamentos.refunds f where f.charge_id = c.id and f.situacao in ('pedida', 'enviada', 'falhou', 'concluida'))), 0,
          'P-I2 conferido nos dados: nenhuma cobrança aprovada sem agendamento ativo e sem devolução pedida');

/* ===================== C. Cartão em análise segura até o teto ===================== */
select is(pg_temp.aguardando(7, pg_temp.itens('eco', '13:00')), 'ok|ok|ok', 'agendamento 7 aguardando pagamento');
select is(pg_temp.foto(7, '{"situacao": "processando"}') ->> 'situacao', 'processando', 'o meio de pagamento está analisando (cartão)');
select pg_temp.banco();
select is((select (o.hold_until - a.hold_expires_at)::text from agenda.occupancy o join public.appointment_requests a on a.id = pg_temp.pid(7)
           where o.item_id = pg_temp.item(7)), '00:30:00', 'a ocupação passa a segurar até o teto (30 min depois do prazo da reserva)');
select pg_temp.passar(7, 16);
select is(pg_temp.expirar(7), false, 'reserva e carência vencidas (16 min), mas em análise: NÃO expira');
select is(pg_temp.tarefas(7), '-', 'acabou de ser consultada: a rotina espera 2 minutos');
select pg_temp.banco();
update pagamentos.charges set consultada_em = now() - interval '3 minutes' where id = pg_temp.cob(7);
select is(pg_temp.tarefas(7), 'consultar', '3 minutos sem notícia: a rotina consulta a cobrança em análise');
select pg_temp.passar(7, 23);
select is(pg_temp.expirar(7), false, '39 min: ainda dentro do teto (reserva de 10 + 30)');
select pg_temp.passar(7, 2);
select is(pg_temp.expirar(7), true, '41 min: passou do teto, expira');
select is(pg_temp.sit(7), 'expired|processando', 'reserva expirada; a cobrança ainda em análise');
select is(pg_temp.tarefas(7), 'apagar', 'além do teto, a rotina apaga a cobrança (consultando antes, como sempre)');
select is(pg_temp.foto(7, '{"situacao": "apagada"}') ->> 'situacao', 'expirada', 'apagada: expirada');

/* ===================== D. Reserva sem cobrança e castigo ===================== */
select is(pg_temp.reservar(8, pg_temp.itens('usg', '14:00')) ->> 'status', 'ok', 'reserva 8 feita; a função cai antes de criar a cobrança');
select is(pg_temp.tarefas(8), '-', 'nos primeiros 60 s a rotina espera');
select pg_temp.passar(8, 2);
select is(pg_temp.tarefas(8), 'abortar', 'reserva paga online sem cobrança há mais de 60 s: a rotina solta');
select pg_temp.servidor();
select is(public.pag_charge_abort(pg_temp.pid(8)) ->> 'status', 'ok', 'solta');
select is(public.pag_charge_abort(pg_temp.pid(8)) ->> 'replay', 'true', 'soltar de novo: replay');
select is(public.pag_charge_abort(pg_temp.pid(2)) ->> 'status', 'transition_not_allowed', 'só reserva ainda sem cobrança anexada (um confirmado, não)');
select is(pg_temp.sit(8), 'cancelled|-', 'cancelada pelo sistema; o horário volta');
select is(pg_temp.reservar_de(10, 9, pg_temp.itens('rm', '15:00')) ->> 'status', 'ok', 'paciente 9, reserva A');
select pg_temp.passar(10, 20);
select is(pg_temp.expirar(10), true, 'venceu');
select is(pg_temp.reservar_de(11, 9, pg_temp.itens('rm', '15:30')) ->> 'status', 'ok', 'reserva B');
select pg_temp.passar(11, 20);
select is(pg_temp.expirar(11), true, 'venceu');
select is(pg_temp.reservar_de(12, 9, pg_temp.itens('rm', '16:00')) ->> 'status', 'ok', 'reserva C');
select pg_temp.passar(12, 20);
select is(pg_temp.expirar(12), true, 'venceu');
select is(pg_temp.reservar_de(13, 9, pg_temp.itens('rm', '16:30')) ->> 'status', 'too_many_expired',
          'deixou vencer 3 reservas seguidas: espera 30 minutos (too_many_expired)');
select is(pg_temp.reservar_de(13, 18, pg_temp.itens('rm', '16:30')) ->> 'status', 'ok', 'outro telefone reserva normalmente (o castigo é por telefone)');

/* ===================== E. A chave geral ===================== */
select is(pg_temp.aguardando(14, pg_temp.itens('eco', '17:00')), 'ok|ok|ok', 'agendamento 14 aguardando pagamento');
select is(pg_temp.reservar(15, pg_temp.itens('usg', '17:00')) ->> 'status', 'ok', 'reserva 15, ainda sem cobrança');
select pg_temp.admin();
select is(public.admin_pag_chave_geral(false, 'teste_desligar') ->> 'vendas_online_ligadas', 'false', 'o dono do IMED DESLIGA a chave geral');
select is(pg_temp.reservar(16, pg_temp.itens('rm', '17:00')) ->> 'status', 'payments_off', 'nenhuma reserva nova para pagar');
select is(pg_temp.abrir(15) ->> 'status', 'payments_off', 'nenhuma cobrança nova, nem para a reserva que já existia');
select is((select concat_ws('|', j ->> 'situacao', j ->> 'request_status') from (select pg_temp.pagar(14) as j) x), 'aprovada|confirmed',
          'mas o pagamento da cobrança que já existia é processado normalmente');
select pg_temp.entrar('anon');
select is(public.agenda_cancel(pg_temp.pid(14), null, pg_temp.codigo(14)) ->> 'status', 'ok', 'e o paciente cancela');
select is(pg_temp.devolver(14), 'ok|ok', 'a devolução também funciona com a chave desligada');
select is(pg_temp.sit(14), 'cancelled|devolvida', 'cancelado e devolvido');
select pg_temp.entrar('anon');
select is(public.agenda_book(pg_temp.c(), pg_temp.itens('rm', '18:00'), pg_temp.paciente(17), pg_temp.pid(17), pg_temp.codigo(17)) ->> 'status', 'ok',
          'com a chave desligada a clínica volta, na hora, a confirmar de uma vez (pagamento no local)');
select is(public.agenda_public_info(pg_temp.c()) ->> 'payment', 'no_local', 'e agenda_public_info volta a dizer "no local"');
select pg_temp.banco();
select is((select count(*)::integer from pagamentos.audit_log where acao = 'chave_geral' and motivo in ('teste_ci', 'teste_desligar') and quem_user = pg_temp.u(4)), 2,
          'ligar e desligar a chave geral ficam na trilha, com o motivo');

select * from finish();
rollback;
