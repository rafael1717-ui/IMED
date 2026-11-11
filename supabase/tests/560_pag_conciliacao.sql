-- iMed Pagamentos, fase P1 (arquitetura do pagamento §5.4 e §11): a conciliação diária, com diferenças plantadas.
--   A. cada tipo de diferença, com a gravidade certa: falta_aqui, falta_la, valor e repasse (críticas), situacao (alta)
--      e tarifa (informativa, com a tarifa real guardada);
--   B. a conciliação NÃO corrige nada sozinha; a mesma diferença ainda aberta não entra duas vezes;
--   C. só o servidor concilia; a gestão lê (imed.financeiro.ver) e só o dono do IMED fecha, com motivo;
--   D. a rotina pede a conciliação de ontem, de D−7, de D−32 e dos buracos dos últimos 14 dias.
-- Os valores são de exemplo. Tudo é desfeito no fim (rollback).
begin;
select plan(37);
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
  select ('a5560000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'gestor', 'caixa', 'admin', 'outra', 'equipe'])[p_n] || '.pag560@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.dona() returns void language sql as $$ select pg_temp.como(1) $$;
create function pg_temp.admin() returns void language sql as $$ select pg_temp.como(4) $$;
create function pg_temp.servidor() returns void language sql as $$ select pg_temp.entrar('service_role') $$;
create function pg_temp.banco() returns void language sql as $$ select pg_temp.entrar('postgres') $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c5560000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.d() returns uuid language sql immutable as $$ select 'c5560000-0000-4000-8000-000000000002'::uuid $$;
-- o dia do teste (daqui a 30 dias) e um horário dele, na hora de São Paulo
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.itens(variadic p text[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('procedure_id', pg_temp.id(p[i]), 'starts_at', pg_temp.t(p[i + 1])) order by i)
  from generate_series(1, cardinality(p), 2) i $$;
-- agendamento N: id "b5560...-N", código "codigo-secreto-N", chave da cobrança "d5560...-N" (tentativa T: ...-T-N)
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b5560000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.chave(p_n integer, p_tentativa integer default 1) returns uuid language sql immutable as $$
  select ('d5560000-0000-4000-' || lpad(p_tentativa::text, 4, '0') || '-' || lpad(p_n::text, 12, '0'))::uuid $$;
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
  return public.pag_charge_attach(pg_temp.cob(p_n), 'pay_t560_' || p_n || '_' || p_tentativa, null, '00020126-copia-e-cola-de-teste-' || p_n);
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
  return concat_ws('|', public.pag_refund_sent(v) ->> 'status', public.pag_refund_done(v, 'est_t560_' || p_n) ->> 'status');
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
from (values (pg_temp.c(), 'Clínica do Pagamento 560', 1), (pg_temp.d(), 'Outra Clínica 560', 2)) c (id, nome, n);
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
  v := v || '|' || (public.pag_clinic_connect(pg_temp.c(), 'wal_teste_560_0001', 'v1') ->> 'situacao');
  perform pg_temp.admin();
  v := v || '|' || (public.admin_pag_conta_conferir(pg_temp.c(), 'ativa', 'conta_conferida') ->> 'situacao');
  perform pg_temp.dona();
  v := v || '|' || (public.pag_clinic_pause(pg_temp.c(), false) ->> 'payment_mode');
  perform pg_temp.banco();
  return v;
end $$;

select is(pg_temp.ligar(), 'ok|em_conferencia|ativa|online', 'recebimento ligado');
create function pg_temp.hoje() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create function pg_temp.linha(p_n integer, p_sit text, p_valor integer, p_repasse integer default null, p_tarifa integer default null,
                              p_devolvido integer default null) returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('provedor_cobranca_id', 'pay_t560_' || p_n || '_1', 'situacao', p_sit, 'valor_cents', p_valor,
                                              'repasse_cents', p_repasse, 'tarifa_cents', p_tarifa, 'devolvido_cents', p_devolvido)) $$;
create function pg_temp.conciliar(p_linhas jsonb, p_dia date default null) returns jsonb language plpgsql as $$
begin
  perform pg_temp.servidor();
  return public.pag_reconcile_apply(coalesce(p_dia, pg_temp.hoje()), p_linhas);
end $$;
create function pg_temp.difs() returns text language sql stable security definer as $$
  select coalesce(string_agg(concat_ws(':', right(d.provedor_cobranca_id, 4), d.tipo, d.gravidade), ' ' order by d.provedor_cobranca_id, d.tipo), '-')
  from pagamentos.reconciliation_diffs d where d.resolvida_em is null $$;
create function pg_temp.dif(p_tipo text, p_n integer) returns bigint language sql stable security definer as $$
  select d.id from pagamentos.reconciliation_diffs d where d.tipo = p_tipo and d.provedor_cobranca_id = 'pay_t560_' || p_n || '_1' and d.resolvida_em is null $$;

/* ===================== A. Cada tipo de diferença ===================== */
select is(pg_temp.pago(1, pg_temp.itens('rm', '09:00')), 'ok|ok|ok|aplicado', 'cobrança 1 paga (R$ 200,00; parte da clínica R$ 170,00)');
select is(pg_temp.pago(2, pg_temp.itens('usg', '09:00')), 'ok|ok|ok|aplicado', 'cobrança 2 paga (R$ 99,90; parte da clínica R$ 84,92)');
select is(pg_temp.pago(3, pg_temp.itens('eco', '12:00')), 'ok|ok|ok|aplicado', 'cobrança 3 paga (R$ 33,33)');
select is(pg_temp.aguardando(4, pg_temp.itens('rm', '10:00')), 'ok|ok|ok', 'cobrança 4 esperando pagamento');
select is((select concat_ws('|', j ->> 'status', j ->> 'linhas', j ->> 'pagas_aqui', j ->> 'novas', j ->> 'criticas')
           from (select pg_temp.conciliar(jsonb_build_array(pg_temp.linha(1, 'paga', 20000, 17000, 199, 0), pg_temp.linha(2, 'paga', 9990, 8492, 199, 0),
                                                            pg_temp.linha(3, 'paga', 3333, 2834, 199, 0), pg_temp.linha(4, 'aguardando', 20000))) as j) x),
          'ok|4|3|0|0', 'o provedor e o IMED dizem a mesma coisa: nenhuma diferença');
select is((select concat_ws('|', j ->> 'novas', j ->> 'criticas', j #>> '{por_tipo,repasse}', j #>> '{por_tipo,tarifa}', j #>> '{por_tipo,falta_la}',
                            j #>> '{por_tipo,falta_aqui}')
           from (select pg_temp.conciliar(jsonb_build_array(
                   pg_temp.linha(1, 'paga', 20000, 17000, 199, 0),          -- igual
                   pg_temp.linha(2, 'paga', 9990, 8000, 250, 0),            -- repasse menor que a parte da clínica; tarifa diferente da esperada
                                                                             -- (a cobrança 3 não veio na lista)
                   pg_temp.linha(4, 'paga', 20000, 17000, 199, 0),          -- lá está paga, aqui ainda espera
                   pg_temp.linha(99, 'paga', 5000, 4250, 199, 0))) as j) x), -- cobrança que não existe aqui
          '5|4|1|1|1|2', '5 diferenças: repasse, falta_la e 2 falta_aqui (críticas) e tarifa (informativa)');
select is(pg_temp.difs(), '_2_1:repasse:critica _2_1:tarifa:informativa _3_1:falta_la:critica _4_1:falta_aqui:critica 99_1:falta_aqui:critica',
          'cada uma com o tipo e a gravidade certos');
select pg_temp.banco();
select is((select concat_ws('|', d.nosso ->> 'clinica_cents', d.deles ->> 'repasse_cents') from pagamentos.reconciliation_diffs d where d.tipo = 'repasse'),
          '8492|8000', 'repasse: a parte da clínica aqui × o que o provedor diz que ela recebeu');
select is((select concat_ws('|', d.nosso ->> 'tarifa_cents', d.deles ->> 'tarifa_cents', d.critica::text) from pagamentos.reconciliation_diffs d where d.tipo = 'tarifa'),
          '199|250|false', 'tarifa: a esperada (parâmetro) × a real (fica guardada na diferença); não é crítica');
select is((select concat_ws('|', (d.charge_id is null)::text, d.deles ->> 'valor_cents') from pagamentos.reconciliation_diffs d
           where d.tipo = 'falta_aqui' and d.provedor_cobranca_id like '%99_1'), 'true|5000', 'falta_aqui sem cobrança nossa: dinheiro sem agendamento');
select is((select concat_ws('|', j ->> 'novas', j #>> '{por_tipo,valor}', j #>> '{por_tipo,situacao}')
           from (select pg_temp.conciliar(jsonb_build_array(
                   pg_temp.linha(1, 'paga', 19000, 17000, 199, 0),              -- valor diferente
                   pg_temp.linha(2, 'devolvida_parcial', 9990, 8492, 199, 500), -- devolução que não chegou por aviso
                   pg_temp.linha(3, 'contestada', 3333, 2834, 199, 0))) as j) x), -- contestação que não chegou por aviso
          '3|1|2', 'outra rodada: valor (crítica) e 2 de situação (alta)');
select is(pg_temp.difs(),
          '_1_1:valor:critica _2_1:repasse:critica _2_1:situacao:alta _2_1:tarifa:informativa _3_1:falta_la:critica _3_1:situacao:alta _4_1:falta_aqui:critica 99_1:falta_aqui:critica',
          'as 8 abertas: as 6 do §5.4, com as gravidades da tabela');

/* ===================== B. Não corrige nada; não duplica ===================== */
select pg_temp.banco();
select is((select string_agg(concat_ws(':', situacao, coalesce(pago_cents::text, '-'), devolvido_cents, coalesce(tarifa_meio_cents::text, '-')), ' ' order by provedor_cobranca_id)
           from pagamentos.charges where clinic_id = pg_temp.c()),
          'aprovada:20000:0:199 aprovada:9990:0:199 aprovada:3333:0:199 aguardando:-:0:-', 'nenhuma cobrança foi alterada pela conciliação');
select is((select count(*)::integer from pagamentos.ledger where clinic_id = pg_temp.c()), 12, 'nem o extrato (3 pagamentos × 4 linhas)');
select is((select concat_ws('|', j ->> 'achadas', j ->> 'novas')
           from (select pg_temp.conciliar(jsonb_build_array(pg_temp.linha(1, 'paga', 19000, 17000, 199, 0), pg_temp.linha(2, 'paga', 9990, 8000, 250, 0),
                                                            pg_temp.linha(3, 'paga', 3333, 2834, 199, 0))) as j) x),
          '3|0', 'a rodada seguinte acha de novo as mesmas diferenças e não as grava duas vezes (continuam abertas)');
select pg_temp.banco();
select is((select count(*)::integer from pagamentos.reconciliation_diffs), 8, '8 linhas ao todo');

/* ===================== C. Quem concilia, quem lê, quem fecha ===================== */
select pg_temp.admin();
select throws_ok($$ select public.pag_reconcile_apply(current_date, '[]') $$, '42501', null, 'nem o dono do IMED roda a conciliação à mão (só o servidor)');
select pg_temp.servidor();
select is(public.pag_reconcile_apply(pg_temp.hoje(), '{}') ->> 'status', 'invalid', 'lista que não é lista: invalid');
select is(public.pag_reconcile_apply(pg_temp.hoje(), '[{"provedor_cobranca_id": "x y"}]') ->> 'status', 'invalid', 'id de cobrança fora do formato: invalid');
select is(public.pag_reconcile_apply(pg_temp.hoje(), '[{"provedor_cobranca_id": "pay_ok_1", "valor_cents": "1e9"}]') ->> 'status', 'invalid', 'valor que não é inteiro: invalid');
select is(public.pag_reconcile_apply(pg_temp.hoje(), '[]', 'd99') ->> 'status', 'invalid', 'janela desconhecida: invalid');
select pg_temp.dona();
select is(public.admin_pag_conciliacao() ->> 'status', 'forbidden', 'a dona da clínica não lê a conciliação');
select pg_temp.como(6);
select is((select concat_ws('|', j ->> 'status', j ->> 'criticas_abertas', jsonb_array_length(j -> 'diferencas'), (jsonb_array_length(j -> 'rodadas') >= 4)::text)
           from (select public.admin_pag_conciliacao() as j) x), 'ok|5|8|true', 'o financeiro da equipe do IMED lê: 5 críticas abertas (aviso vermelho)');
select is((select j #>> '{atencao,diferencas_criticas}' from (select public.admin_pag_resumo(pg_temp.hoje() - 1, pg_temp.hoje()) as j) x), '5',
          'o resumo da gestão também acusa as críticas');
select is(public.admin_pag_diferenca_resolver((select (j #>> '{diferencas,0,id}')::bigint from (select public.admin_pag_conciliacao() as j) x), 'conferido_no_provedor') ->> 'status',
          'forbidden', 'mas não fecha diferença (só lê)');
select pg_temp.admin();
select is(public.admin_pag_diferenca_resolver(pg_temp.dif('valor', 1), null) ->> 'status', 'reason_required', 'fechar exige o código do que foi feito');
select is(public.admin_pag_diferenca_resolver(pg_temp.dif('valor', 1), 'texto livre com espaço') ->> 'status', 'reason_required', 'código, não texto livre');
select is(public.admin_pag_diferenca_resolver(pg_temp.dif('valor', 1), 'conferido_no_provedor') ->> 'status', 'ok', 'o dono do IMED fecha a diferença de valor');
select is(public.admin_pag_diferenca_resolver(999999999, 'conferido_no_provedor') ->> 'status', 'not_found', 'diferença que não existe: not_found');
select is(public.admin_pag_conciliacao() ->> 'criticas_abertas', '4', 'uma crítica a menos');
select pg_temp.banco();
select is((select concat_ws('|', resolucao, (resolvida_por = pg_temp.u(4))::text) from pagamentos.reconciliation_diffs where tipo = 'valor'), 'conferido_no_provedor|true',
          'fica gravado quem fechou e com que código');
select is((select count(*)::integer from pagamentos.audit_log where acao = 'conciliacao.resolver' and motivo = 'conferido_no_provedor'), 1, 'e na trilha');
select is((select j ->> 'novas' from (select pg_temp.conciliar(jsonb_build_array(pg_temp.linha(1, 'paga', 19000, 17000, 199, 0), pg_temp.linha(2, 'paga', 9990, 8492, 199, 0),
                                                                                  pg_temp.linha(3, 'paga', 3333, 2834, 199, 0))) as j) x), '1',
          'se a diferença fechada continua existindo no dia seguinte, ela abre de novo (ninguém "resolve" sem resolver)');

/* ===================== D. O que a rotina pede ===================== */
select pg_temp.servidor();
select is((select string_agg(concat_ws(':', (pg_temp.hoje() - (a ->> 'dia')::date)::text, a ->> 'janela'), ' ' order by (a ->> 'dia')::date desc, a ->> 'janela')
           from jsonb_array_elements(public.pag_due() -> 'acoes') a where a ->> 'acao' = 'conciliar'),
          '1:d1 2:d1 3:d1 4:d1 5:d1 6:d1 7:d1 7:d7 8:d1 9:d1 10:d1 11:d1 12:d1 13:d1 14:d1 32:d32',
          'a rotina pede: ontem, os 13 dias antes (nunca passa de 14 sem olhar um dia), D−7 e D−32 de novo');
select is(pg_temp.conciliar('[]', pg_temp.hoje() - 1) ->> 'status', 'ok', 'ontem conciliado (nada aconteceu ontem)');
select pg_temp.servidor();
select is((select count(*)::integer from jsonb_array_elements(public.pag_due() -> 'acoes') a where a ->> 'acao' = 'conciliar' and (a ->> 'dia')::date = pg_temp.hoje() - 1), 0,
          'e sai da lista da rotina');

select * from finish();
rollback;
