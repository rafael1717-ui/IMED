-- iMed Pagamentos, fase P1 (arquitetura do pagamento §5.1, §5.2 e §11): a estrutura e o "tudo desligado".
--   A. o schema pagamentos fica fora da API: sem USAGE, toda tabela com RLS, sem policy e sem permissão;
--   B. as 17 tabelas existem, com as restrições de nome fixo, e nenhuma guarda cartão, chave, segredo ou CPF;
--   C. as funções "só servidor" recusam visitante e pessoa logada (nem executam) e respondem forbidden a quem não é o
--      servidor; as da clínica e da gestão não são do visitante;
--   D. extrato e trilha só acrescentam; cobrança, devolução, conta e taxa só são apagadas pela emergência do SQL, registrada;
--   E. as guardas valem sempre (ENABLE ALWAYS); a unidade só fica "online" com a conta da clínica ativa;
--   F. TUDO DESLIGADO: chave geral, nenhuma conta, nenhum plano; a taxa de partida e as tarifas "a confirmar";
--   G. com tudo desligado NADA MUDA: agenda_public_info, agenda_book e agenda_my_booking respondem como antes, e as
--      funções do pagamento respondem "desligado".
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(62);
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
  select ('a5500000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'gestor', 'caixa', 'admin', 'outra', 'equipe'])[p_n] || '.pag500@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.dona() returns void language sql as $$ select pg_temp.como(1) $$;
create function pg_temp.admin() returns void language sql as $$ select pg_temp.como(4) $$;
create function pg_temp.servidor() returns void language sql as $$ select pg_temp.entrar('service_role') $$;
create function pg_temp.banco() returns void language sql as $$ select pg_temp.entrar('postgres') $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select 'c5500000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.d() returns uuid language sql immutable as $$ select 'c5500000-0000-4000-8000-000000000002'::uuid $$;
-- o dia do teste (daqui a 30 dias) e um horário dele, na hora de São Paulo
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 30 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.itens(variadic p text[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('procedure_id', pg_temp.id(p[i]), 'starts_at', pg_temp.t(p[i + 1])) order by i)
  from generate_series(1, cardinality(p), 2) i $$;
-- agendamento N: id "b5500...-N", código "codigo-secreto-N", chave da cobrança "d5500...-N" (tentativa T: ...-T-N)
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b5500000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-' || lpad(p_n::text, 4, '0') $$;
create function pg_temp.chave(p_n integer, p_tentativa integer default 1) returns uuid language sql immutable as $$
  select ('d5500000-0000-4000-' || lpad(p_tentativa::text, 4, '0') || '-' || lpad(p_n::text, 12, '0'))::uuid $$;
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
  return public.pag_charge_attach(pg_temp.cob(p_n), 'pay_t500_' || p_n || '_' || p_tentativa, null, '00020126-copia-e-cola-de-teste-' || p_n);
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
  return concat_ws('|', public.pag_refund_sent(v) ->> 'status', public.pag_refund_done(v, 'est_t500_' || p_n) ->> 'status');
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
from (values (pg_temp.c(), 'Clínica do Pagamento 500', 1), (pg_temp.d(), 'Outra Clínica 500', 2)) c (id, nome, n);
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
  v := v || '|' || (public.pag_clinic_connect(pg_temp.c(), 'wal_teste_500_0001', 'v1') ->> 'situacao');
  perform pg_temp.admin();
  v := v || '|' || (public.admin_pag_conta_conferir(pg_temp.c(), 'ativa', 'conta_conferida') ->> 'situacao');
  perform pg_temp.dona();
  v := v || '|' || (public.pag_clinic_pause(pg_temp.c(), false) ->> 'payment_mode');
  perform pg_temp.banco();
  return v;
end $$;


/* ===================== A. Fora da API ===================== */
select is(array(select r::text from unnest(array['anon', 'authenticated', 'service_role']) r where has_schema_privilege(r, 'pagamentos', 'USAGE')),
          '{}'::text[], 'schema pagamentos sem USAGE para anon, authenticated e service_role');
select is(
  array(select c.relname || case when not c.relrowsecurity then ' (sem RLS)' else '' end
               || case when exists (select 1 from pg_policy po where po.polrelid = c.oid) then ' (com policy)' else '' end
               || case when exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r
                                    where has_table_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES')
                                       or has_any_column_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
                       then ' (com permissão para a API)' else '' end
        from pg_class c
        where c.relnamespace = 'pagamentos'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
          and (not c.relrowsecurity or exists (select 1 from pg_policy po where po.polrelid = c.oid)
               or exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r
                          where has_table_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES')
                             or has_any_column_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')))
        order by 1),
  '{}'::text[], 'tabelas do schema pagamentos: RLS ligada, sem policy e sem permissão para a API');
select is(
  array(select s.relname::text from pg_class s
        where s.relnamespace = 'pagamentos'::regnamespace and s.relkind = 'S'
          and exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r where has_sequence_privilege(r, s.oid, 'USAGE, SELECT, UPDATE'))
        order by 1),
  '{}'::text[], 'sequências do schema pagamentos sem permissão para a API');
select is(
  array(select p.proname::text from pg_proc p where p.pronamespace = 'pagamentos'::regnamespace order by 1),
  '{}'::text[], 'nenhuma função dentro do schema pagamentos (as internas ficam em private; as da API, em public)');

/* ===================== B. Tabelas e restrições ===================== */
select is(
  array(select c.relname::text from pg_class c where c.relnamespace = 'pagamentos'::regnamespace and c.relkind = 'r' order by 1),
  array['audit_log', 'charge_items', 'charges', 'clinic_accounts', 'disputes', 'events', 'featured', 'fee_rules', 'ledger', 'payers',
        'plans', 'reconciliation_diffs', 'reconciliation_runs', 'refund_items', 'refunds', 'settings', 'subscriptions'],
  'as 17 tabelas (as 16 do §5.2 + refund_items, o rateio da devolução por exame)');
select is(
  array(select t from unnest(array['charges_conta_ck', 'charges_devolvido_ck', 'charges_cobranca_uq', 'charges_chave_uq', 'charges_dono_ck',
          'charges_copia_cola_viva_ck', 'charges_aprovada_ck', 'charge_items_conta_ck', 'charge_items_devolvido_ck', 'events_evento_uq',
          'refunds_chave_uq', 'refunds_divisao_ck', 'fee_rules_sem_sobreposicao', 'fee_rules_valor_ck', 'ledger_sinal_ck',
          'clinic_accounts_ligada_ck', 'clinic_accounts_ativa_ck', 'payers_hmac_uq', 'plans_sem_sobreposicao',
          'reconciliation_diffs_critica_ck', 'unit_settings_payment_mode_check']) t
        where not exists (select 1 from pg_constraint co where co.conname = t
                            and co.connamespace in ('pagamentos'::regnamespace, 'agenda'::regnamespace)) order by 1),
  '{}'::text[], 'as restrições de nome fixo existem');
select is(
  array(select i from unnest(array['charges_viva_uq', 'refunds_enviada_uq', 'subscriptions_viva_uq', 'reconciliation_diffs_aberta_uq',
                                   'disputes_aberta_uq']) i
        where to_regclass('pagamentos.' || i) is null order by 1),
  '{}'::text[], 'os índices únicos parciais existem (uma cobrança viva por agendamento, uma devolução no ar por cobrança...)');
select is(
  array(select a.attrelid::regclass::text || '.' || a.attname
        from pg_attribute a join pg_class c on c.oid = a.attrelid
        where c.relnamespace = 'pagamentos'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
          and (a.attname ~* '(cartao|card|cvv|cvc|validade|senha|secret|segredo|token|api_?key|nome|name|telefone|phone|email|corpo|body|payload)'
               or (a.attname ~* 'cpf' and a.attname <> 'cpf_hmac'))
          and a.attname <> 'hash_do_corpo'   -- do corpo do aviso só fica o hash
        order by 1),
  '{}'::text[], 'nenhuma coluna para cartão, chave, segredo, corpo de aviso, nome, telefone, e-mail ou CPF puro (só o HMAC do CPF)');
select is(
  array(select a.attrelid::regclass::text || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
        from pg_attribute a join pg_class c on c.oid = a.attrelid
        where c.relnamespace = 'pagamentos'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
          and (a.attname ~ '_cents$' or a.attname ~ '_bps$') and a.atttypid <> 'integer'::regtype
        order by 1),
  '{}'::text[], 'dinheiro sempre em integer de centavos (e percentual em pontos-base inteiros)');
select is(
  array(select a.attrelid::regclass::text || '.' || a.attname
        from pg_attribute a join pg_class c on c.oid = a.attrelid
        where c.relnamespace = 'pagamentos'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
          and a.atttypid in ('numeric'::regtype, 'real'::regtype, 'double precision'::regtype, 'money'::regtype)
        order by 1),
  '{}'::text[], 'nenhuma coluna numeric, float ou money');
select is(
  array(select co.conrelid::regclass::text || '.' || co.conname from pg_constraint co
        where co.contype = 'f' and co.conrelid in ('pagamentos.ledger'::regclass, 'pagamentos.audit_log'::regclass) order by 1),
  '{}'::text[], 'extrato e trilha sem chave estrangeira (guardam o uuid, como as trilhas da agenda)');

/* ===================== C. Quem executa ===================== */
create temp table so_servidor (fn text primary key) on commit drop;
insert into so_servidor values
  ('public.agenda_pay_hold(uuid,jsonb,jsonb,uuid,text,uuid)'), ('public.pag_payer_upsert(text,uuid)'), ('public.pag_payer_attach(uuid,text)'),
  ('public.pag_charge_open(uuid,text,text,uuid,uuid)'), ('public.pag_charge_attach(uuid,text,timestamptz,text)'),
  ('public.pag_charge_abort(uuid)'), ('public.pag_event_store(text,text,text,text,text,integer,timestamptz,text)'),
  ('public.pag_sync_apply(uuid,jsonb,bigint)'), ('public.pag_due()'), ('public.pag_refund_sent(uuid)'), ('public.pag_refund_done(uuid,text)'),
  ('public.pag_refund_failed(uuid,text)'), ('public.pag_reconcile_apply(date,jsonb,text)'), ('public.pag_subscription_sync(uuid,jsonb)');
grant select on so_servidor to anon, authenticated, service_role;
select is(
  array(select s.fn || ' ' || r from so_servidor s, unnest(array['anon', 'authenticated']) r where has_function_privilege(r, s.fn, 'EXECUTE') order by 1),
  '{}'::text[], 'as 14 funções só do servidor: visitante e pessoa logada nem executam');
select is(
  array(select s.fn from so_servidor s where not has_function_privilege('service_role', s.fn, 'EXECUTE') order by 1),
  '{}'::text[], 'o servidor (service_role) executa as 14');
select is(
  array(select p.oid::regprocedure::text from pg_proc p
        where p.pronamespace = 'public'::regnamespace and (p.proname like 'pag\_%' or p.proname like 'admin\_pag\_%' or p.proname = 'agenda_pay_hold')
          and (not p.prosecdef or not coalesce(p.proconfig, '{}') @> array['search_path=""']) order by 1),
  '{}'::text[], 'toda função do pagamento em public é SECURITY DEFINER com search_path vazio');
select is(
  array(select p.oid::regprocedure::text from pg_proc p
        where p.pronamespace = 'private'::regnamespace and (p.proname like 'pag\_%' or p.proname in ('agenda_to_awaiting', 'agenda_confirm_paid'))
          and exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, p.oid, 'EXECUTE'))
        order by 1),
  '{}'::text[], 'as funções internas (private.pag_*) não são de ninguém da API');
select is(
  array(select p.oid::regprocedure::text from pg_proc p
        where p.pronamespace = 'public'::regnamespace and (p.proname like 'pag\_clinic\_%' or p.proname like 'admin\_pag\_%')
          and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE')) order by 1),
  '{}'::text[], 'as funções da clínica e da gestão: só quem está logado (a permissão é conferida por dentro)');
select ok(has_function_privilege('anon', 'public.pag_my_payment(uuid,text)', 'EXECUTE'), 'o paciente (visitante com o código) consulta o próprio pagamento');
select pg_temp.entrar('anon');
select throws_ok($$ select public.pag_due() $$, '42501', null, 'visitante não executa pag_due');
select throws_ok($$ select public.pag_sync_apply(gen_random_uuid(), '{"situacao": "paga", "valor_cents": 1}') $$, '42501', null,
                 'visitante não executa pag_sync_apply');
select throws_ok($$ select public.admin_pag_chave_geral(true, 'teste_ci') $$, '42501', null, 'visitante não executa admin_pag_chave_geral');
select pg_temp.dona();
select throws_ok($$ select public.pag_charge_open(gen_random_uuid(), 'x', 'pix', gen_random_uuid()) $$, '42501', null,
                 'logado (mesmo a dona da clínica) não executa pag_charge_open');
select throws_ok($$ select public.agenda_pay_hold(pg_temp.c(), '[]', '{}', gen_random_uuid(), 'x') $$, '42501', null, 'nem agenda_pay_hold');
select throws_ok($$ select count(*) from pagamentos.charges $$, '42501', null, 'logado não lê pagamentos.charges direto');
select pg_temp.servidor();
select throws_ok($$ select count(*) from pagamentos.settings $$, '42501', null, 'nem o servidor lê o schema pagamentos direto (só pelas funções)');
select pg_temp.banco();
select is(
  array(select fn from (values ('pag_due', public.pag_due() ->> 'status'),
                               ('pag_charge_abort', public.pag_charge_abort(gen_random_uuid()) ->> 'status'),
                               ('pag_refund_sent', public.pag_refund_sent(gen_random_uuid()) ->> 'status'),
                               ('pag_event_store', public.pag_event_store('asaas', 'evt_x', 'PAYMENT_RECEIVED', 'pay_x') ->> 'status'),
                               ('pag_reconcile_apply', public.pag_reconcile_apply(current_date, '[]') ->> 'status'),
                               ('agenda_pay_hold', public.agenda_pay_hold(pg_temp.c(), '[]', '{}', gen_random_uuid(), 'codigo-secreto-0000') ->> 'status')
                       ) x (fn, st) where st is distinct from 'forbidden' order by 1),
  '{}'::text[], 'quem não é o servidor (sem o papel no token) recebe forbidden por dentro, mesmo executando');

/* ===================== D. Só acrescenta; apagar só pela emergência ===================== */
insert into pagamentos.ledger (charge_id, clinic_id, tipo, valor_cents, de_quem) values (gen_random_uuid(), pg_temp.c(), 'recebido', 100, 'paciente');
select throws_ok($$ update pagamentos.ledger set valor_cents = 1 $$, '42501', null, 'extrato: UPDATE recusado (P-I6)');
select throws_ok($$ delete from pagamentos.ledger $$, '42501', null, 'extrato: DELETE recusado');
select throws_ok($$ truncate pagamentos.ledger $$, '42501', null, 'extrato: TRUNCATE recusado');
select throws_ok($$ insert into pagamentos.ledger (charge_id, clinic_id, tipo, valor_cents, de_quem) values (gen_random_uuid(), pg_temp.c(), 'devolucao', 100, 'paciente') $$,
                 '23514', null, 'extrato: devolução entra com sinal negativo');
select private.pag_audit('teste.linha', null, null, pg_temp.c(), null, null, null, 'teste_ci', 'sql');
select throws_ok($$ update pagamentos.audit_log set acao = 'outra_coisa' $$, '42501', null, 'trilha: UPDATE recusado');
select throws_ok($$ delete from pagamentos.audit_log $$, '42501', null, 'trilha: DELETE recusado');
insert into pagamentos.subscriptions (id, clinic_id, plano, preco_cents) values ('e5500000-0000-4000-8000-000000000001', pg_temp.c(), 'destaque', 10000);
insert into pagamentos.charges (id, finalidade, subscription_id, clinic_id, emitida_por, meio, valor_cents, taxa_cents, clinica_cents, chave_idempotencia)
values ('f5500000-0000-4000-8000-000000000001', 'destaque', 'e5500000-0000-4000-8000-000000000001', pg_temp.c(), 'imed', 'pix', 10000, 10000, 0, gen_random_uuid());
select throws_ok($$ delete from pagamentos.charges where id = 'f5500000-0000-4000-8000-000000000001' $$, '42501', null, 'cobrança: DELETE recusado');
select throws_ok($$ truncate pagamentos.charges cascade $$, '42501', null, 'cobrança: TRUNCATE recusado');
select throws_ok($$ delete from pagamentos.fee_rules $$, '42501', null, 'regra de taxa: DELETE recusado');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_limpeza', true);
select lives_ok($$ delete from pagamentos.charges where id = 'f5500000-0000-4000-8000-000000000001' $$, 'pela emergência do SQL (com motivo), apaga');
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
select is((select concat_ws('|', quem_tipo, motivo) from pagamentos.audit_log where acao = 'charges_apagada_sql' and charge_id = 'f5500000-0000-4000-8000-000000000001'),
          'sql|teste_limpeza', 'e fica registrado na trilha (quem: sql; o motivo)');

/* ===================== E. Guardas sempre ligadas ===================== */
select is(
  array(select format('%s.%s (%s)', c.relname, g.tgname, g.tgenabled)
        from pg_trigger g join pg_class c on c.oid = g.tgrelid
        where not g.tgisinternal and g.tgfoid::regprocedure::text like 'private.pag\_%' and g.tgenabled <> 'A' order by 1),
  '{}'::text[], 'todos os gatilhos do pagamento valem sempre (ENABLE ALWAYS)');
select is(
  array(select c.relname || '.' || g.tgname from pg_trigger g join pg_class c on c.oid = g.tgrelid
        where not g.tgisinternal and g.tgfoid::regprocedure::text like 'private.pag\_%' and c.relnamespace <> 'pagamentos'::regnamespace order by 1),
  array['appointment_items.appointment_items_pag', 'appointment_requests.appointment_requests_pag', 'unit_settings.unit_settings_pag'],
  'nas tabelas da agenda, só os 3 gatilhos novos');
select throws_ok($$ update agenda.unit_settings set payment_mode = 'online' where clinic_id = pg_temp.c() $$, '23514', null,
                 'a unidade não fica "online" sem a conta da clínica ativa (nem pelo SQL)');
select throws_ok($$ update agenda.unit_settings set payment_mode = 'pix' where clinic_id = pg_temp.c() $$, '23514', null,
                 'modo de pagamento da unidade: só no_local e online');

/* ===================== F. Tudo desligado ===================== */
select is((select valor::text from pagamentos.settings where chave = 'vendas_online_ligadas'), 'false', 'a chave geral nasce DESLIGADA');
select is((select count(*)::integer from pagamentos.clinic_accounts), 0, 'nenhuma clínica com conta');
select is((select count(*)::integer from pagamentos.plans), 0, 'nenhum plano com preço (o do Destaque depende da decisão do dono)');
select is((select count(*)::integer from agenda.unit_settings where payment_mode <> 'no_local'), 0, 'toda unidade em "pagamento no local"');
select is((select concat_ws('|', tipo, fee_bps, coalesce(clinic_id::text, 'padrao'), finalidade, coalesce(vale_ate::text, 'aberta'), motivo) from pagamentos.fee_rules),
          'percentual|1500|padrao|exame|aberta|taxa_de_partida', 'uma regra de taxa: 15% (valor de partida), padrão, sem fim');
select is(array(select chave from pagamentos.settings where a_confirmar order by 1),
          array['liquidacao_cartao_dias', 'tarifa_cartao_bps', 'tarifa_cartao_fixo_cents', 'tarifa_pix_cents'],
          'as tarifas e o prazo do meio de pagamento são parâmetros marcados "a confirmar"');
select is((select string_agg(chave || '=' || (valor #>> '{}'), ' ' order by chave) from pagamentos.settings
           where chave in ('minutos_qr', 'preco_minimo_online_cents', 'max_tentativas_cobranca', 'teto_processando_min', 'tolerancia_destaque_dias',
                           'regra_devolucao_falta', 'regra_devolucao_antes_24h')),
          'max_tentativas_cobranca=3 minutos_qr=8 preco_minimo_online_cents=2000 regra_devolucao_antes_24h=total regra_devolucao_falta=nenhuma teto_processando_min=30 tolerancia_destaque_dias=5',
          'os parâmetros de partida (recomendações da arquitetura)');
select is(array(select role from agenda.role_permissions where permission in ('financeiro.configurar', 'financeiro.estornar') order by 1, permission),
          array['owner', 'owner'], 'ligar o recebimento e pedir devolução: só o dono da clínica');
select is((select count(*)::integer from agenda.role_permissions where permission = 'imed.financeiro.operar'), 0,
          'imed.financeiro.operar não é de nenhum papel da equipe: só o dono do IMED (decisão 22)');
select is((select count(*)::integer from cron.job where jobname = 'imed-pagamentos-retencao' and command = 'select private.pag_retencao()'), 1,
          'job diário da retenção agendado (não chama a internet)');

/* ===================== G. Com tudo desligado nada muda ===================== */
select pg_temp.entrar('anon');
select is((select concat_ws('|', j ->> 'payment', j ->> 'payment_text', (j ? 'payment_methods')::text, (j ? 'payment_min_cents')::text)
           from (select public.agenda_public_info(pg_temp.c()) as j) x),
          'no_local|Pagamento no local, direto com a clínica.|false|false', 'agenda_public_info: pagamento no local, o mesmo texto, sem chave nova');
select is(public.agenda_book(pg_temp.c(), pg_temp.itens('rm', '09:00'), pg_temp.paciente(1), pg_temp.pid(1), pg_temp.codigo(1)) ->> 'status', 'ok',
          'agenda_book: o paciente marca e confirma de uma vez, como hoje');
select is((select concat_ws('|', j ->> 'request_status', (j ? 'payment')::text) from (select public.agenda_my_booking(pg_temp.pid(1), pg_temp.codigo(1)) as j) x),
          'confirmed|false', 'agenda_my_booking: igual, sem a chave do pagamento');
select is(public.pag_my_payment(pg_temp.pid(1), pg_temp.codigo(1)) ->> 'payment_mode', 'no_local', 'pag_my_payment: agendamento com pagamento no local');
select is(public.pag_my_payment(pg_temp.pid(1), 'codigo-errado-000000') ->> 'status', 'not_found', 'pag_my_payment com o código errado: not_found');
select pg_temp.banco();
select is((select concat_ws('|', status, payment_mode, total_cents) from public.appointment_requests where id = pg_temp.pid(1)),
          'confirmed|no_local|20000', 'o agendamento nasce confirmado, com pagamento no local e o preço fotografado');
select is(pg_temp.reservar(2, pg_temp.itens('rm', '10:00')) ->> 'status', 'payments_off', 'agenda_pay_hold com a chave geral desligada: payments_off');
select pg_temp.banco();
select is((select count(*)::integer from public.appointment_requests where id = pg_temp.pid(2)), 0, 'e nada fica reservado');
select pg_temp.admin();
select is(public.admin_pag_chave_geral(true, 'teste_ci') ->> 'status', 'ok', 'o dono do IMED liga a chave geral (com motivo)');
select is(pg_temp.reservar(2, pg_temp.itens('rm', '10:00')) ->> 'status', 'payment_not_available',
          'chave ligada e clínica sem conta: payment_not_available (clínica sem conta não muda nada)');
select pg_temp.entrar('anon');
select is(public.agenda_book(pg_temp.c(), pg_temp.itens('rm', '10:00'), pg_temp.paciente(2), pg_temp.pid(2), pg_temp.codigo(2)) ->> 'status', 'ok',
          'e a clínica sem conta continua confirmando de uma vez');
select pg_temp.banco();
select is((select count(*)::integer from pagamentos.charges), 0, 'nenhuma cobrança nasceu');

select * from finish();
rollback;
