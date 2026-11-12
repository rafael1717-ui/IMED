-- iMed Pagamentos, fase P2a (migração pagamentos_rotina; arquitetura do pagamento §4.4 e §6.1): a rotina no banco.
--   A. estrutura: o token interno "pagamentos", os dois jobs do pg_cron e as permissões (só o pg_cron chama a rotina; só o
--      servidor chama pag_charge_lookup);
--   B. com tudo desligado não há trabalho e NADA é chamado;
--   C. com trabalho esperando: sem o endereço das funções a rotina falha com o aviso (não chama nada); com o endereço,
--      UMA chamada para <endereço>/pagamento-rotina, com o token interno no cabeçalho e o tempo-limite certo;
--   D. "há trabalho?" acompanha o que public.pag_due() pede: reserva sem cobrança, cobrança perto de vencer, devolução
--      na fila, aviso pendente; e a conciliação só quando a chamada da madrugada pede;
--   E. pag_charge_lookup: a cobrança pelo código do agendamento; código errado não acha nada.
-- Tudo é desfeito no fim (rollback): nenhum pedido sai do banco (a fila do pg_net é desfeita junto).
begin;
select plan(45);
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
  select ('a5580000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'gestor', 'caixa', 'admin', 'outra', 'equipe'])[p_n] || '.pag580@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.dona() returns void language sql as $$ select pg_temp.como(1) $$;
create function pg_temp.admin() returns void language sql as $$ select pg_temp.como(4) $$;
create function pg_temp.servidor() returns void language sql as $$ select pg_temp.entrar('service_role') $$;
create function pg_temp.banco() returns void language sql as $$ select pg_temp.entrar('postgres') $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c5580000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.d() returns uuid language sql immutable as $$ select 'c5580000-0000-4000-8000-000000000002'::uuid $$;
-- o dia do teste (daqui a 30 dias) e um horário dele, na hora de São Paulo
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.itens(variadic p text[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('procedure_id', pg_temp.id(p[i]), 'starts_at', pg_temp.t(p[i + 1])) order by i)
  from generate_series(1, cardinality(p), 2) i $$;
-- agendamento N: id "b5580...-N", código "codigo-secreto-N", chave da cobrança "d5580...-N" (tentativa T: ...-T-N)
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b5580000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.chave(p_n integer, p_tentativa integer default 1) returns uuid language sql immutable as $$
  select ('d5580000-0000-4000-' || lpad(p_tentativa::text, 4, '0') || '-' || lpad(p_n::text, 12, '0'))::uuid $$;
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
  return public.pag_charge_attach(pg_temp.cob(p_n), 'pay_t580_' || p_n || '_' || p_tentativa, null, '00020126-copia-e-cola-de-teste-' || p_n);
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
  return concat_ws('|', public.pag_refund_sent(v) ->> 'status', public.pag_refund_done(v, 'est_t580_' || p_n) ->> 'status');
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
from (values (pg_temp.c(), 'Clínica do Pagamento 580', 1), (pg_temp.d(), 'Outra Clínica 580', 2)) c (id, nome, n);
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
  v := v || '|' || (public.pag_clinic_connect(pg_temp.c(), 'wal_teste_580_0001', 'v1') ->> 'situacao');
  perform pg_temp.admin();
  v := v || '|' || (public.admin_pag_conta_conferir(pg_temp.c(), 'ativa', 'conta_conferida') ->> 'situacao');
  perform pg_temp.dona();
  v := v || '|' || (public.pag_clinic_pause(pg_temp.c(), false) ->> 'payment_mode');
  perform pg_temp.banco();
  return v;
end $$;

create function pg_temp.trabalho(p_conciliar boolean default false) returns boolean language sql stable security definer as $$
  select private.pag_tem_trabalho(p_conciliar) $$;
create function pg_temp.chamar(p_conciliar boolean default false) returns text language sql security definer as $$
  select private.pag_rotina_chamar(p_conciliar) $$;
create function pg_temp.fila() returns integer language sql stable security definer as $$
  select count(*)::integer from net.http_request_queue q where q.url like '%/pagamento-rotina' $$;
create function pg_temp.tarefas() returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.servidor();
  select coalesce(string_agg(distinct a ->> 'acao', ',' order by a ->> 'acao'), '-') into v
  from jsonb_array_elements(public.pag_due() -> 'acoes') a where a ->> 'acao' <> 'conciliar';
  perform pg_temp.banco();
  return v;
end $$;

/* ===================== A. Estrutura ===================== */
select pg_temp.banco();
select ok((select t.token ~ '^[0-9a-f]{64}$' from private.app_tokens t where t.name = 'pagamentos'),
          'token interno "pagamentos" em private.app_tokens (64 letras hexadecimais)');
select isnt((select t.token from private.app_tokens t where t.name = 'pagamentos'), (select t.token from private.app_tokens t where t.name = 'importer'),
            'e é diferente do token da fila de importação');
select is(array(select j.jobname || ' | ' || j.schedule || ' | ' || j.command from cron.job j where j.jobname like 'imed-pagamentos-%' order by 1),
          array['imed-pagamentos-conciliacao | 17 7 * * * | select private.pag_rotina_chamar(true)',
                'imed-pagamentos-retencao | 23 6 * * * | select private.pag_retencao()',
                'imed-pagamentos-rotina | * * * * * | select private.pag_rotina_chamar()'],
          'jobs do pagamento: a rotina a cada minuto, a conciliação de madrugada (04:17 em São Paulo) e a retenção da P1');
select is(array(select format('%s:%s', f, r) from unnest(array['private.pag_tem_trabalho(boolean)', 'private.pag_rotina_chamar(boolean)']) f,
                                               unnest(array['anon', 'authenticated', 'service_role']) r
                where has_function_privilege(r, f, 'EXECUTE') order by 1),
          '{}'::text[], 'ninguém da API executa private.pag_tem_trabalho nem private.pag_rotina_chamar (só o pg_cron, dono postgres)');
select is(array(select r from unnest(array['anon', 'authenticated', 'service_role']) r
                where has_function_privilege(r, 'public.pag_charge_lookup(uuid, text)', 'EXECUTE') order by 1),
          array['service_role'], 'pag_charge_lookup: só o servidor executa');
select is((select p.prosecdef and p.provolatile = 's' from pg_proc p where p.oid = 'public.pag_charge_lookup(uuid, text)'::regprocedure), true,
          'pag_charge_lookup só lê (STABLE) e roda como dona (SECURITY DEFINER, com a conferência por dentro)');

/* ===================== B. Com tudo desligado ===================== */
select is(pg_temp.trabalho(true), false, 'com tudo desligado (sem cobrança nenhuma): não há trabalho, nem com a conciliação');
select is(pg_temp.chamar() || '|' || pg_temp.chamar(true), 'nada|nada', 'a rotina não chama nada');
select is(pg_temp.fila(), 0, 'nenhum pedido HTTP enfileirado');

/* ===================== C. Com trabalho: endereço e chamada ===================== */
select is(pg_temp.ligar(), 'ok|em_conferencia|ativa|online', 'recebimento ligado');
select is(pg_temp.reservar(1, pg_temp.itens('rm', '09:00')) ->> 'status', 'ok', 'reserva 1 para pagar (ainda sem cobrança)');
select is(pg_temp.trabalho() || '|' || pg_temp.tarefas(), 'false|-', 'reserva nova (menos de 60 s): ainda não é trabalho');
select pg_temp.passar(1, 2);
select is(pg_temp.trabalho() || '|' || pg_temp.tarefas(), 'true|abortar', 'reserva sem cobrança há mais de 60 s: há trabalho (soltar a reserva)');
delete from private.app_settings where key = 'functions_url';
select throws_ok($$ select pg_temp.chamar() $$, '55000', null, 'com trabalho e SEM o endereço das funções: a rotina falha com o aviso (rotina parada)');
select is(pg_temp.fila(), 0, 'e não chama nada');
insert into private.app_settings (key, value) values ('functions_url', 'http://127.0.0.1:9/functions/v1')
on conflict (key) do update set value = excluded.value;
select is(pg_temp.chamar(), 'chamada', 'com o endereço: a rotina chama');
select is((select count(*)::integer from net.http_request_queue q
           where q.url = 'http://127.0.0.1:9/functions/v1/pagamento-rotina' and q.method = 'POST'), 1,
          'UMA chamada POST para <endereço>/pagamento-rotina');
select ok((select bool_and(q.headers ->> 'x-imed-token' = t.token and q.headers ->> 'Content-Type' = 'application/json'
                           and q.timeout_milliseconds = 55000 and convert_from(q.body, 'UTF8')::jsonb = '{"conciliar": false}'::jsonb)
           from net.http_request_queue q, private.app_tokens t
           where q.url = 'http://127.0.0.1:9/functions/v1/pagamento-rotina' and t.name = 'pagamentos'),
          'com o token interno "pagamentos" no cabeçalho x-imed-token, corpo {"conciliar": false} e tempo-limite de 55 s');
select set_config('teste.token_enviado', (select q.headers ->> 'x-imed-token' from net.http_request_queue q where q.url like '%/pagamento-rotina' limit 1), true);
select pg_temp.servidor();
select is(concat_ws('|', public.check_internal_token('pagamentos', current_setting('teste.token_enviado')),
                         public.check_internal_token('pagamentos', repeat('0', 64)),
                         public.check_internal_token('importer', current_setting('teste.token_enviado'))),
          't|f|f', 'a função confere o token por check_internal_token: o certo passa; outro, ou o nome de outro token, não');
select is(public.pag_charge_abort(pg_temp.pid(1)) ->> 'status', 'ok', '(o servidor solta a reserva 1)');
select pg_temp.banco();
select is(pg_temp.trabalho() || '|' || pg_temp.tarefas(), 'false|-', 'reserva solta: acabou o trabalho');

/* ===================== D. "Há trabalho?" acompanha pag_due ===================== */
select is(pg_temp.aguardando(2, pg_temp.itens('rm', '10:00')), 'ok|ok|ok', 'agendamento 2 aguardando pagamento');
select pg_temp.banco();
select is(pg_temp.trabalho() || '|' || pg_temp.tarefas(), 'false|-', 'cobrança nova (QR de 8 min): nada a fazer ainda');
select is(pg_temp.trabalho(true), true, 'já existe cobrança no provedor: a chamada da madrugada tem a conciliação a fazer');
select pg_temp.passar(2, 7);
select is(pg_temp.trabalho() || '|' || pg_temp.tarefas(), 'true|consultar', 'a 1 minuto do fim do QR: há trabalho (consultar)');
select is(pg_temp.pagar(2) ->> 'request_status', 'confirmed', 'o pagamento chega: agendamento 2 confirmado');
select pg_temp.banco();
select is(pg_temp.trabalho() || '|' || pg_temp.tarefas(), 'false|-', 'pago e confirmado: nada a fazer');
select pg_temp.entrar('anon');
select is(public.agenda_cancel(pg_temp.pid(2), null, pg_temp.codigo(2)) ->> 'status', 'ok', 'o paciente cancela o agendamento pago');
select pg_temp.banco();
select is(pg_temp.trabalho() || '|' || pg_temp.tarefas(), 'true|enviar_devolucao', 'devolução pedida: há trabalho (enviar a devolução)');
select is(pg_temp.devolver(2), 'ok|ok', '(o servidor envia e conclui a devolução)');
select pg_temp.banco();
select is(pg_temp.trabalho() || '|' || pg_temp.tarefas(), 'false|-', 'devolvido: nada a fazer');
select is(pg_temp.aguardando(3, pg_temp.itens('usg', '11:00')), 'ok|ok|ok', 'agendamento 3 aguardando pagamento');
select is(public.pag_event_store('asaas', 'evt_t580_1', 'PAYMENT_RECEIVED', 'pay_t580_3_1', 'RECEIVED', 9990, now(), repeat('a', 64)) ->> 'status', 'ok',
          'chega um aviso da cobrança 3, gravado e ainda não aplicado');
select pg_temp.banco();
select is(pg_temp.trabalho(), true, 'aviso pendente: há trabalho (a rotina reaplica depois de 1 minuto)');
select is(pg_temp.chamar(true), 'chamada', 'a chamada da madrugada');
select is((select convert_from(q.body, 'UTF8')::jsonb from net.http_request_queue q where q.url like '%/pagamento-rotina' order by q.id desc limit 1),
          '{"conciliar": true}'::jsonb, 'vai com {"conciliar": true}');

/* ===================== E. pag_charge_lookup ===================== */
select pg_temp.servidor();
select is((select concat_ws('|', j ->> 'status', (j ->> 'charge_id')::uuid = pg_temp.cob(3), j ->> 'situacao', j ->> 'provedor_cobranca_id', j ->> 'request_status')
           from (select public.pag_charge_lookup(pg_temp.pid(3), pg_temp.codigo(3)) as j) x),
          'ok|t|aguardando|pay_t580_3_1|awaiting_payment', 'com o código do agendamento: a cobrança viva dele, com o id no provedor');
select is(array(select jsonb_object_keys(public.pag_charge_lookup(pg_temp.pid(3), pg_temp.codigo(3))) order by 1),
          array['charge_id', 'provedor_cobranca_id', 'request_status', 'situacao', 'status'], 'só o necessário: nada do pagador, nenhum valor');
select is(public.pag_charge_lookup(pg_temp.pid(3), 'codigo-errado-0000') ->> 'status', 'not_found', 'código errado: não acha');
select is(public.pag_charge_lookup(pg_temp.pid(3), null) ->> 'status', 'not_found', 'sem código: não acha');
select is(public.pag_charge_lookup(pg_temp.pid(1), pg_temp.codigo(1)) ->> 'status', 'not_found', 'reserva que nunca teve cobrança (a 1, solta): não acha');
select is(public.pag_charge_lookup(pg_temp.pid(2), pg_temp.codigo(2)) ->> 'situacao', 'devolvida', 'agendamento cancelado e devolvido (o 2): a cobrança dele, com a situação');
select is(public.pag_charge_lookup(pg_temp.pid(99), pg_temp.codigo(99)) ->> 'status', 'not_found', 'agendamento que não existe: não acha');
select pg_temp.como(1);
select throws_ok($$ select public.pag_charge_lookup(pg_temp.pid(3), pg_temp.codigo(3)) $$, '42501', null, 'a dona da clínica (logada) não executa pag_charge_lookup');
select pg_temp.entrar('anon');
select throws_ok($$ select public.pag_charge_lookup(pg_temp.pid(3), pg_temp.codigo(3)) $$, '42501', null, 'visitante não executa pag_charge_lookup');

select * from finish();
rollback;
