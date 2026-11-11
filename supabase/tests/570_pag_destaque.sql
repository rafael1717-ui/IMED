-- iMed Pagamentos, fase P1 (arquitetura do pagamento §8 e §11): a mensalidade do Destaque, só a parte do banco.
--   A. estados: pendente → ativa (1º pagamento) → atrasada (o destaque CONTINUA pela tolerância de 5 dias) → suspensa
--      (o destaque sai; cadastro e agenda continuam) → cancelada (30 dias); pagou, volta na hora;
--   B. cancelar a pedido vale até o fim do período já pago;
--   C. pagamentos.featured (o que a busca vai ler na fase P5) só tem clínica publicada com mensalidade ativa ou na
--      tolerância; uma mensalidade viva por clínica e plano; só o servidor sincroniza; a gestão lê.
-- O rodízio e a faixa "Destaques" na busca são da fase P5 (não existem aqui). O preço abaixo é de exemplo: nenhum plano
-- tem preço gravado (decisão 14 do dono). Tudo é desfeito no fim (rollback).
begin;
select plan(41);
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
  select ('a5570000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'gestor', 'caixa', 'admin', 'outra', 'equipe'])[p_n] || '.pag570@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.dona() returns void language sql as $$ select pg_temp.como(1) $$;
create function pg_temp.admin() returns void language sql as $$ select pg_temp.como(4) $$;
create function pg_temp.servidor() returns void language sql as $$ select pg_temp.entrar('service_role') $$;
create function pg_temp.banco() returns void language sql as $$ select pg_temp.entrar('postgres') $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c5570000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.d() returns uuid language sql immutable as $$ select 'c5570000-0000-4000-8000-000000000002'::uuid $$;
-- o dia do teste (daqui a 30 dias) e um horário dele, na hora de São Paulo
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.itens(variadic p text[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('procedure_id', pg_temp.id(p[i]), 'starts_at', pg_temp.t(p[i + 1])) order by i)
  from generate_series(1, cardinality(p), 2) i $$;
-- agendamento N: id "b5570...-N", código "codigo-secreto-N", chave da cobrança "d5570...-N" (tentativa T: ...-T-N)
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b5570000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.chave(p_n integer, p_tentativa integer default 1) returns uuid language sql immutable as $$
  select ('d5570000-0000-4000-' || lpad(p_tentativa::text, 4, '0') || '-' || lpad(p_n::text, 12, '0'))::uuid $$;
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
  return public.pag_charge_attach(pg_temp.cob(p_n), 'pay_t570_' || p_n || '_' || p_tentativa, null, '00020126-copia-e-cola-de-teste-' || p_n);
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
  return concat_ws('|', public.pag_refund_sent(v) ->> 'status', public.pag_refund_done(v, 'est_t570_' || p_n) ->> 'status');
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
from (values (pg_temp.c(), 'Clínica do Pagamento 570', 1), (pg_temp.d(), 'Outra Clínica 570', 2)) c (id, nome, n);
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
  v := v || '|' || (public.pag_clinic_connect(pg_temp.c(), 'wal_teste_570_0001', 'v1') ->> 'situacao');
  perform pg_temp.admin();
  v := v || '|' || (public.admin_pag_conta_conferir(pg_temp.c(), 'ativa', 'conta_conferida') ->> 'situacao');
  perform pg_temp.dona();
  v := v || '|' || (public.pag_clinic_pause(pg_temp.c(), false) ->> 'payment_mode');
  perform pg_temp.banco();
  return v;
end $$;

create function pg_temp.s() returns uuid language sql immutable as $$ select 'e5570000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.sync(p_foto jsonb, p_sub uuid default null) returns text language plpgsql as $$
declare
  j jsonb;
begin
  perform pg_temp.servidor();
  j := public.pag_subscription_sync(coalesce(p_sub, pg_temp.s()), p_foto);
  return concat_ws('|', j ->> 'status', j ->> 'situacao', j ->> 'destaque');
end $$;
create function pg_temp.vitrine() returns integer language sql stable security definer as $$
  select count(*)::integer from pagamentos.featured f where f.clinic_id = pg_temp.c() $$;
create function pg_temp.hoje() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
insert into pagamentos.subscriptions (id, clinic_id, plano, preco_cents, criado_por) values (pg_temp.s(), pg_temp.c(), 'destaque', 10000, pg_temp.u(1));

/* ===================== A. Estados ===================== */
select is(pg_temp.vitrine(), 0, 'mensalidade pendente: sem destaque');
select is(pg_temp.sync('{"evento": "tick"}'), 'ok|pendente|false', 'o relógio não mexe em mensalidade pendente');
select is(pg_temp.sync('{"evento": "atrasada"}'), 'ok|pendente|false', 'nem um aviso de atraso antes do 1º pagamento');
select is(pg_temp.sync(jsonb_build_object('evento', 'paga')), 'invalid', '"paga" sem dizer até quando: invalid');
select is(pg_temp.sync(jsonb_build_object('evento', 'paga', 'pago_ate', pg_temp.hoje() + 30)), 'ok|ativa|true', '1º pagamento: ativa, e a clínica entra em destaque');
select is(pg_temp.vitrine(), 1, 'está na lista que a busca vai ler');
select is(pg_temp.sync('{"evento": "atrasada"}'), 'ok|atrasada|true', 'cobrança atrasada: "atrasada", e o destaque CONTINUA');
select pg_temp.banco();
select is((select (tolerancia_ate between now() + interval '4 days 23 hours' and now() + interval '5 days')::text from pagamentos.subscriptions where id = pg_temp.s()),
          'true', 'tolerância de 5 dias (parâmetro tolerancia_destaque_dias)');
select is(pg_temp.sync('{"evento": "tick"}'), 'ok|atrasada|true', 'dentro da tolerância, o relógio não suspende');
select pg_temp.banco();
update pagamentos.subscriptions set tolerancia_ate = now() - interval '1 minute' where id = pg_temp.s();
select is(pg_temp.sync('{"evento": "tick"}'), 'ok|suspensa|false', '5 dias sem pagar: suspensa, o destaque sai sozinho');
select is(pg_temp.vitrine(), 0, 'fora da lista');
select pg_temp.banco();
select is((select concat_ws('|', status, accepts_online_booking::text) from public.clinics where id = pg_temp.c()), 'published|true',
          'o cadastro e a agenda da clínica continuam normais');
select is(pg_temp.sync(jsonb_build_object('evento', 'paga', 'pago_ate', pg_temp.hoje() + 30)), 'ok|ativa|true', 'pagou: volta na hora');
select is(pg_temp.vitrine(), 1, 'de volta à lista');
select is(pg_temp.sync('{"evento": "atrasada"}'), 'ok|atrasada|true', 'atrasa de novo');
select is(pg_temp.sync(jsonb_build_object('evento', 'paga', 'pago_ate', pg_temp.hoje() + 60)), 'ok|ativa|true', 'e paga dentro da tolerância: ativa, sem nunca ter saído');
select pg_temp.banco();
select is((select concat_ws('|', pago_ate = pg_temp.hoje() + 60, tolerancia_ate is null, suspensa_em is null) from pagamentos.subscriptions where id = pg_temp.s()),
          't|t|t', 'pago até a data nova; sem tolerância nem suspensão pendentes');
select is(pg_temp.sync(jsonb_build_object('evento', 'paga', 'pago_ate', pg_temp.hoje() + 10)), 'ok|ativa|true', 'aviso antigo de pagamento (data menor)');
select pg_temp.banco();
select is((select (pago_ate = pg_temp.hoje() + 60)::text from pagamentos.subscriptions where id = pg_temp.s()), 'true', 'o "pago até" não anda para trás');
select is(pg_temp.sync('{"evento": "atrasada"}'), 'ok|atrasada|true', 'atrasa');
select pg_temp.banco();
update pagamentos.subscriptions set tolerancia_ate = now() - interval '1 minute' where id = pg_temp.s();
select is(pg_temp.sync('{"evento": "tick"}'), 'ok|suspensa|false', 'suspensa');
select is(pg_temp.sync('{"evento": "tick"}'), 'ok|suspensa|false', 'suspensa há pouco: continua suspensa');
select pg_temp.banco();
update pagamentos.subscriptions set suspensa_em = now() - interval '31 days' where id = pg_temp.s();
select is(pg_temp.sync('{"evento": "tick"}'), 'ok|cancelada|false', '30 dias suspensa: cancelada');
select is(pg_temp.sync(jsonb_build_object('evento', 'paga', 'pago_ate', pg_temp.hoje() + 30)), 'ok|cancelada|false', 'mensalidade cancelada não volta (assina-se outra)');
select is(pg_temp.vitrine(), 0, 'fora da lista');
select pg_temp.banco();
select is((select string_agg((antes ->> 'situacao') || '>' || (depois ->> 'situacao'), ' ' order by id) from pagamentos.audit_log
           where acao = 'mensalidade.situacao' and clinic_id = pg_temp.c()),
          'pendente>ativa ativa>atrasada atrasada>suspensa suspensa>ativa ativa>atrasada atrasada>ativa ativa>atrasada atrasada>suspensa suspensa>cancelada',
          'cada mudança de situação ficou na trilha');

/* ===================== B. Cancelar a pedido ===================== */
insert into pagamentos.subscriptions (id, clinic_id, plano, preco_cents) values ('e5570000-0000-4000-8000-000000000002', pg_temp.c(), 'destaque', 10000);
select throws_ok($$ insert into pagamentos.subscriptions (clinic_id, plano, preco_cents) values (pg_temp.c(), 'destaque', 10000) $$, '23505', null,
                 'uma mensalidade viva por clínica e plano');
select is(pg_temp.sync(jsonb_build_object('evento', 'paga', 'pago_ate', pg_temp.hoje() + 20), 'e5570000-0000-4000-8000-000000000002'), 'ok|ativa|true', 'mensalidade nova, paga');
select is(pg_temp.sync('{"evento": "cancelar"}', 'e5570000-0000-4000-8000-000000000002'), 'ok|ativa|true', 'cancelar a pedido: continua valendo até o fim do período pago');
select is(pg_temp.sync('{"evento": "tick"}', 'e5570000-0000-4000-8000-000000000002'), 'ok|ativa|true', 'antes do fim do período: ativa, em destaque');
select pg_temp.banco();
update pagamentos.subscriptions set pago_ate = pg_temp.hoje() - 1 where id = 'e5570000-0000-4000-8000-000000000002';
select is(pg_temp.sync('{"evento": "tick"}', 'e5570000-0000-4000-8000-000000000002'), 'ok|cancelada|false', 'período pago vencido: cancelada, sem cobrança nova');
select is(pg_temp.vitrine(), 0, 'fora da lista');
select pg_temp.banco();
insert into pagamentos.subscriptions (id, clinic_id, plano, preco_cents) values ('e5570000-0000-4000-8000-000000000003', pg_temp.c(), 'destaque', 10000);
select is(pg_temp.sync('{"evento": "cancelar"}', 'e5570000-0000-4000-8000-000000000003'), 'ok|cancelada|false', 'cancelar antes do 1º pagamento: cancelada já');

/* ===================== C. Quem aparece, quem sincroniza, quem lê ===================== */
select pg_temp.banco();
insert into pagamentos.subscriptions (id, clinic_id, plano, preco_cents) values ('e5570000-0000-4000-8000-000000000004', pg_temp.d(), 'destaque', 10000);
update public.clinics set status = 'draft' where id = pg_temp.d();
select is(pg_temp.sync(jsonb_build_object('evento', 'paga', 'pago_ate', pg_temp.hoje() + 30), 'e5570000-0000-4000-8000-000000000004'), 'ok|ativa|false',
          'clínica que não está publicada: a mensalidade fica ativa, mas ela não entra em destaque');
select pg_temp.banco();
select is((select count(*)::integer from pagamentos.featured), 0, 'ninguém na lista');
select is(pg_temp.sync('{"evento": "inventado"}'), 'invalid', 'evento desconhecido: invalid');
select is(pg_temp.sync('{"evento": "tick"}', gen_random_uuid()), 'not_found', 'mensalidade que não existe: not_found');
select pg_temp.dona();
select throws_ok($$ select public.pag_subscription_sync(pg_temp.s(), '{"evento": "paga"}') $$, '42501', null, 'a dona da clínica não sincroniza a mensalidade (só o servidor)');
select is(public.admin_pag_assinaturas() ->> 'status', 'forbidden', 'nem lê a lista da gestão');
select pg_temp.como(6);
select is((select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'assinaturas'),
                            (select count(*) from jsonb_array_elements(j -> 'assinaturas') a where a ->> 'situacao' = 'cancelada'),
                            (select count(*) from jsonb_array_elements(j -> 'assinaturas') a where (a ->> 'em_destaque')::boolean))
           from (select public.admin_pag_assinaturas() as j) x), 'ok|4|3|0', 'o financeiro da equipe do IMED lê as mensalidades e a situação de cada uma');
select pg_temp.banco();
select is((select count(*)::integer from pagamentos.plans), 0, 'nenhum preço de plano foi gravado (decisão 14 pendente)');

select * from finish();
rollback;
