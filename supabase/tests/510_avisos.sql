-- "Avisos" (iMed Agenda, fase 5.3; arquitetura §10 e §14): o banco prepara os avisos e os lembretes; enviar é do servidor.
--   A. estrutura: tabelas fechadas (RLS, sem permissão), sem coluna de e-mail ou telefone; gatilho sempre ligado; quem
--      executa o quê; cron; o envio nasce desligado;
--   B. o paciente marca pelo site: confirmação para ele e para a clínica + lembretes de 24 h e de 2 h do horário;
--      lembrete que já passou não nasce; o balcão não avisa a clínica;
--   C. remarcar: lembretes antigos cancelados, "remarcado" e lembretes do horário novo;
--   D. cancelar pelo paciente: lembretes cancelados, "cancelado" para ele e para a clínica; reserva solta não avisa;
--   E. as escolhas da clínica (agenda_notify_config e _set): quem pode, o que pode, desligar cancela os pendentes e
--      vale para os próximos; fica na auditoria;
--   F. a fila com o envio DESLIGADO: o cron fecha os vencidos como sem_canal (nunca "enviada"); o servidor recebe "off";
--   G. a fila com o envio LIGADO: só o servidor; o destino vem do pedido na hora; o que não vale mais é cancelado; sem
--      e-mail = sem_contato; o mais antigo de cada agendamento primeiro; falha tenta de novo (1 min, 5 min...) e
--      depois de 10 vira "falhou"; resposta repetida = stale;
--   H. leituras: agenda_notify_list (sem destino) e agenda_central_avisos (só números; só a equipe do IMED);
--   I. um erro ao preparar o aviso não derruba a marcação.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test; nomes fictícios.
begin;
select plan(71);
delete from agenda.holidays where scope = 'nacional';  -- sem os da migração feriados_nacionais: o teste lança os dele (dias relativos a hoje)

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
create function pg_temp.dona() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a5100000-0000-4000-8000-000000000001', 'dona.avisos53@exemplo.test') $$;
create function pg_temp.recepcao() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a5100000-0000-4000-8000-000000000002', 'recepcao.avisos53@exemplo.test') $$;
create function pg_temp.outra() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a5100000-0000-4000-8000-000000000003', 'outra.avisos53@exemplo.test') $$;
create function pg_temp.admin() returns void language sql as $$
  select pg_temp.entrar('authenticated', 'a5100000-0000-4000-8000-000000000004', 'admin.avisos53@exemplo.test') $$;
create function pg_temp.servidor() returns void language sql as $$ select pg_temp.entrar('service_role') $$;
create function pg_temp.a() returns uuid language sql immutable as $$ select 'c5100000-0000-4000-8000-000000000001'::uuid $$;
-- o dia D (daqui a 5 dias, em São Paulo), aberto das 08:00 às 12:00
create function pg_temp.dia() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date + 5 $$;
create function pg_temp.t(p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.dia() + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.pid(p_n integer) returns uuid language sql immutable as $$
  select ('b5100000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.codigo(p_n integer) returns text language sql immutable as $$ select 'codigo-secreto-do-aparelho-' || lpad(p_n::text, 4, '0') $$;
-- o paciente marca pelo site (com ou sem e-mail)
create function pg_temp.marcar(p_n integer, p_hhmm text, p_email text default null) returns jsonb language sql as $$
  select public.agenda_book(pg_temp.a(), jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id('rm'), 'starts_at', pg_temp.t(p_hhmm))),
                            jsonb_strip_nulls(jsonb_build_object('name', 'Paciente Teste ' || p_n, 'phone', '1198765' || lpad(p_n::text, 4, '0'),
                                                                 'email', p_email, 'consent', true)),
                            pg_temp.pid(p_n), pg_temp.codigo(p_n)) $$;
-- os avisos de um pedido, em texto: evento/destinatário/situação, na ordem do envio
create function pg_temp.avisos(p_n integer, p_so text default null) returns text language sql stable as $$
  select coalesce(string_agg(n.event_type || '/' || n.recipient_kind || '/' || n.status, ' '
                             order by n.send_after, n.event_type, n.recipient_kind, n.created_at), '-')
  from agenda.notifications n where n.request_id = pg_temp.pid(p_n) and (p_so is null or n.status = p_so) $$;
create function pg_temp.ligar_envio(p_ligado boolean) returns void language sql as $$
  insert into agenda.settings_global (key, value) values ('avisos.envio_ligado', to_jsonb(case when p_ligado then 1 else 0 end))
  on conflict (key) do update set value = excluded.value $$;
-- o que o servidor recebeu de um pedido (um item da resposta de agenda_notify_claim)
create function pg_temp.item(p_j jsonb, p_n integer, p_evento text, p_para text default 'paciente') returns jsonb language sql stable security definer as $$
  select i from jsonb_array_elements(p_j -> 'items') i
  join agenda.notifications n on n.id = (i ->> 'id')::uuid
  where n.request_id = pg_temp.pid(p_n) and i ->> 'event_type' = p_evento and i ->> 'recipient_kind' = p_para $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('a5100000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       e || '.avisos53@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from (values (1, 'dona'), (2, 'recepcao'), (3, 'outra'), (4, 'admin')) x (n, e);
insert into public.admin_emails (email) values ('admin.avisos53@exemplo.test');
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo, email)
values (pg_temp.a(), 'Clínica dos Avisos', 'imagem', 'Rua do Lembrete, 53', 'São Paulo', 'SP',
        extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false,
        'contato.avisos53@exemplo.test');
insert into public.clinic_members (clinic_id, user_id, role) values
  (pg_temp.a(), 'a5100000-0000-4000-8000-000000000001', 'owner'),
  (pg_temp.a(), 'a5100000-0000-4000-8000-000000000002', 'reception');
insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1), 'Confraternização Universal', 'Fonte de teste (Lei 662/1949)'
where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from pg_temp.dia())::integer + 1, 1, 1));

select pg_temp.dona();
select public.agenda_unit_save(pg_temp.a(), jsonb_build_object('holidays_checked_until', pg_temp.dia() + 200, 'min_notice_min', 0, 'step_min', 30));
select set_config('teste.rm1', public.agenda_resource_save(pg_temp.a(), '{"kind": "equipamento", "name": "RM-1"}') ->> 'id', true);
select set_config('teste.rm', public.agenda_procedure_save(pg_temp.a(), jsonb_build_object('exam_code', 'rm', 'name', 'Ressonância', 'duration_min', 30,
         'default_for_exam', true, 'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
           jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('rm1'))))))) ->> 'id', true);
select public.agenda_rules_set(pg_temp.a(), null, jsonb_build_array(jsonb_build_object('weekday', extract(dow from pg_temp.dia())::integer, 'start', '08:00', 'end', '12:00')));
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_avisos', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = coalesce(timezone_confirmed_at, now()), agenda_online_since = now()
where id = pg_temp.a();
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);

/* ===================== A. Estrutura ===================== */
select is(array(select c.relname::text from pg_class c where c.oid in ('agenda.notifications'::regclass, 'agenda.notification_rules'::regclass)
                and c.relrowsecurity and not exists (select 1 from pg_policy p where p.polrelid = c.oid) order by 1),
          array['notification_rules', 'notifications'], 'as duas tabelas têm RLS ligada e nenhuma policy');
select is(array(select r || ':' || t from unnest(array['anon', 'authenticated', 'service_role']) r,
                unnest(array['agenda.notifications', 'agenda.notification_rules']) t
                where has_table_privilege(r, t, 'SELECT') or has_table_privilege(r, t, 'INSERT')
                   or has_table_privilege(r, t, 'UPDATE') or has_table_privilege(r, t, 'DELETE')),
          '{}'::text[], 'ninguém da API lê nem escreve nas tabelas dos avisos (nem o service_role)');
select is(array(select a.attname::text from pg_attribute a where a.attrelid = 'agenda.notifications'::regclass and a.attnum > 0
                and not a.attisdropped and a.attname ~ '(mail|phone|fone|name|nome|destin|recipient$|^to$)'),
          '{}'::text[], 'agenda.notifications não tem coluna de e-mail, telefone ou nome (o destino é lido na hora do envio)');
select is((select t.tgenabled::text || '|' || (t.tgtype & 1) || '|' || (pg_get_triggerdef(t.oid) ~ 'AFTER INSERT OR UPDATE OF status, slot_start')::text
           from pg_trigger t where t.tgrelid = 'public.appointment_requests'::regclass and t.tgname = 'appointment_requests_avisos'),
          'A|1|true', 'gatilho appointment_requests_avisos: sempre ligado, por linha, depois de INSERT ou de UPDATE da situação ou do horário');
select is(array(select f from unnest(array['public.agenda_notify_claim(integer)', 'public.agenda_notify_done(uuid, text, text, text)']) f
                where has_function_privilege('service_role', f, 'EXECUTE')
                  and not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE')),
          array['public.agenda_notify_claim(integer)', 'public.agenda_notify_done(uuid, text, text, text)'],
          'a fila (claim e done): só o service_role executa');
select is(array(select f from unnest(array['public.agenda_notify_config(uuid)', 'public.agenda_notify_config_set(uuid, jsonb)',
                                           'public.agenda_notify_list(uuid)', 'public.agenda_central_avisos()']) f
                where has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE')),
          array['public.agenda_notify_config(uuid)', 'public.agenda_notify_config_set(uuid, jsonb)',
                'public.agenda_notify_list(uuid)', 'public.agenda_central_avisos()'],
          'as leituras e as escolhas: só quem tem conta executa (o visitante não)');
select is(array(select p.proname::text from pg_proc p where p.pronamespace = 'public'::regnamespace
                and (p.proname like 'agenda\_notify\_%' or p.proname = 'agenda_central_avisos')
                and not (p.prosecdef and p.proconfig @> array['search_path=""']) order by 1),
          '{}'::text[], 'todas as funções públicas dos avisos são SECURITY DEFINER com search_path vazio');
select is(array(select p.proname::text from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'agenda\_notify\_%'
                and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     or has_function_privilege('service_role', p.oid, 'EXECUTE')) order by 1),
          '{}'::text[], 'as funções internas dos avisos não são executáveis por nenhum papel da API');
select is((select j.schedule || '|' || j.command from cron.job j where j.jobname = 'imed-agenda-saida'),
          '* * * * *|select private.agenda_notify_tick()', 'cron imed-agenda-saida: a cada minuto');
select ok(not private.agenda_notify_sending() and not exists (select 1 from agenda.settings_global where key = 'avisos.envio_ligado'),
          'o envio nasce DESLIGADO (parâmetro avisos.envio_ligado sem linha = 0)');
select is((select def || '|' || min || '|' || max from private.agenda_central_params() where key = 'avisos.envio_ligado'), '0|0|1',
          'o interruptor do envio está nos parâmetros da central (padrão 0, de 0 a 1)');

/* ===================== B. O paciente marca pelo site ===================== */
select pg_temp.entrar('anon');
select is(pg_temp.marcar(1, '09:00', 'paciente1.avisos53@exemplo.test') ->> 'request_status', 'confirmed', 'o paciente marca às 09:00 (com e-mail)');
select pg_temp.entrar('postgres');
select is(pg_temp.avisos(1),
          'confirmado/clinica/agendada confirmado/paciente/agendada lembrete_24h/paciente/agendada lembrete_2h/paciente/agendada',
          'nascem a confirmação (paciente e clínica) e os lembretes de 24 h e de 2 h');
select is((select string_agg(n.event_type || '=' || (extract(epoch from n.slot_start - n.send_after) / 3600)::integer || 'h', ' ' order by n.event_type)
           from agenda.notifications n where n.request_id = pg_temp.pid(1) and n.event_type like 'lembrete%'),
          'lembrete_24h=24h lembrete_2h=2h', 'os lembretes saem 24 h e 2 h antes do horário marcado');
select ok((select bool_and(n.channel = 'email' and n.slot_start = pg_temp.t('09:00') and n.next_try_at = n.send_after and n.attempts = 0)
           from agenda.notifications n where n.request_id = pg_temp.pid(1)),
          'todos pelo canal e-mail, com o horário do agendamento e nenhuma tentativa');
-- lembrete que já passou não nasce (a função dos lembretes, com um "agora" escolhido)
select private.agenda_notify_reminders(pg_temp.pid(1), pg_temp.a(), pg_temp.t('11:30'), pg_temp.t('11:30') - interval '5 hours');
select is((select string_agg(n.event_type, ',' order by n.event_type) from agenda.notifications n
           where n.request_id = pg_temp.pid(1) and n.slot_start = pg_temp.t('11:30')), 'lembrete_2h',
          'faltando 5 h para o horário: só o lembrete de 2 h nasce (o de 24 h já passou)');
select private.agenda_notify_reminders(pg_temp.pid(1), pg_temp.a(), pg_temp.t('11:00'), pg_temp.t('11:00') - interval '1 hour');
select is((select count(*)::int from agenda.notifications n where n.request_id = pg_temp.pid(1) and n.slot_start = pg_temp.t('11:00')), 0,
          'faltando 1 h: nenhum lembrete nasce');
delete from agenda.notifications n where n.request_id = pg_temp.pid(1) and n.slot_start = pg_temp.t('11:30');
-- o balcão marca: o paciente recebe a confirmação e os lembretes; a clínica não é avisada do que ela mesma marcou
select pg_temp.recepcao();
select set_config('teste.balcao', public.agenda_desk_book(pg_temp.a(),
         jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id('rm'), 'starts_at', pg_temp.t('11:00'))),
         jsonb_build_object('name', 'Paciente do Balcão', 'phone', '11987650099', 'consent', true)) ->> 'id', true);
select pg_temp.entrar('postgres');
select is((select string_agg(n.event_type || '/' || n.recipient_kind, ' ' order by n.send_after, n.event_type)
           from agenda.notifications n where n.request_id = pg_temp.id('balcao')),
          'confirmado/paciente lembrete_24h/paciente lembrete_2h/paciente', 'marcado no balcão: avisos só para o paciente');

/* ===================== C. Remarcar ===================== */
select pg_temp.entrar('anon');
select is(public.agenda_reschedule(pg_temp.pid(1), jsonb_build_array(jsonb_build_object('seq', 1, 'starts_at', pg_temp.t('10:00'))),
                                   pg_temp.codigo(1), 'd5100000-0000-4000-8000-000000000001') ->> 'status', 'ok',
          'o paciente remarca das 09:00 para as 10:00');
select pg_temp.entrar('postgres');
select is((select string_agg(n.event_type || '/' || n.status, ' ' order by n.event_type)
           from agenda.notifications n where n.request_id = pg_temp.pid(1) and n.slot_start = pg_temp.t('09:00') and n.event_type like 'lembrete%'),
          'lembrete_24h/cancelada lembrete_2h/cancelada', 'os lembretes do horário antigo são cancelados');
select is((select string_agg(n.event_type || '/' || n.recipient_kind || '/' || n.status, ' ' order by n.send_after, n.event_type)
           from agenda.notifications n where n.request_id = pg_temp.pid(1) and n.slot_start = pg_temp.t('10:00')),
          'remarcado/paciente/agendada lembrete_24h/paciente/agendada lembrete_2h/paciente/agendada',
          'nascem o aviso de remarcação e os lembretes do horário novo');

/* ===================== D. Cancelar ===================== */
select pg_temp.entrar('anon');
select is(pg_temp.marcar(2, '08:00', 'paciente2.avisos53@exemplo.test') ->> 'request_status', 'confirmed', 'outro paciente marca às 08:00');
select is(public.agenda_cancel(pg_temp.pid(2), 'paciente_desistiu', pg_temp.codigo(2)) ->> 'status', 'ok', 'e cancela pelo site');
select pg_temp.entrar('postgres');
select is((select string_agg(n.event_type || '/' || n.status, ' ' order by n.event_type)
           from agenda.notifications n where n.request_id = pg_temp.pid(2) and n.event_type like 'lembrete%'),
          'lembrete_24h/cancelada lembrete_2h/cancelada', 'cancelado: os lembretes são cancelados');
select is((select string_agg(n.recipient_kind, ',' order by n.recipient_kind) from agenda.notifications n
           where n.request_id = pg_temp.pid(2) and n.event_type = 'cancelado' and n.status = 'agendada'),
          'clinica,paciente', 'nasce o aviso de cancelamento para o paciente e, como foi ele quem cancelou, para a clínica');
-- a clínica cancela: só o paciente é avisado
select pg_temp.entrar('anon');
select pg_temp.marcar(3, '08:00', 'paciente3.avisos53@exemplo.test');
select pg_temp.recepcao();
select is(public.agenda_cancel(pg_temp.pid(3), 'equipamento_manutencao') ->> 'status', 'ok', 'a recepção cancela outro agendamento');
select pg_temp.entrar('postgres');
select is((select string_agg(n.recipient_kind, ',') from agenda.notifications n where n.request_id = pg_temp.pid(3) and n.event_type = 'cancelado'),
          'paciente', 'cancelado pela clínica: só o paciente é avisado');
-- pedido antigo (sem o motor novo): nenhum aviso
insert into public.appointment_requests (clinic_id, place_source, place_name, preferred_date, patient_name, patient_phone, consent)
values (pg_temp.a(), 'imed', 'Clínica dos Avisos', pg_temp.dia(), 'Paciente do Pedido Antigo', '11987650000', true);
select is((select count(*)::int from agenda.notifications n join public.appointment_requests r on r.id = n.request_id where not r.uses_resources), 0,
          'pedido sem horário (fluxo antigo): nenhum aviso é preparado');

/* ===================== E. As escolhas da clínica ===================== */
select pg_temp.outra();
select is(public.agenda_notify_config(pg_temp.a()) ->> 'status', 'forbidden', 'quem não é da clínica não lê as escolhas');
select is(public.agenda_notify_config_set(pg_temp.a(), '[{"event_type": "lembrete_2h", "recipient_kind": "paciente", "enabled": false}]') ->> 'status',
          'forbidden', 'nem grava');
select pg_temp.recepcao();
select is(public.agenda_notify_config(pg_temp.a()) ->> 'status', 'forbidden', 'a recepção (sem agenda.configurar) não lê as escolhas');
select pg_temp.dona();
select is((select string_agg((x ->> 'event_type') || '/' || (x ->> 'recipient_kind') || '=' || (x ->> 'enabled'), ' ')
           from jsonb_array_elements(public.agenda_notify_config(pg_temp.a()) -> 'rules') x),
          'lembrete_24h/paciente=true lembrete_2h/paciente=true confirmado/clinica=true cancelado/clinica=true',
          'a dona vê as 4 escolhas, todas ligadas por padrão');
select is(public.agenda_notify_config(pg_temp.a()) - 'rules', '{"status": "ok", "sending": false, "clinic_email": true}'::jsonb,
          'e vê que o envio está desligado e que a clínica tem e-mail no cadastro');
select is(array(select public.agenda_notify_config_set(pg_temp.a(), p::jsonb) ->> 'status'
                from unnest(array['[]', '{}', '[{"event_type": "confirmado", "recipient_kind": "paciente", "enabled": false}]',
                                  '[{"event_type": "lembrete_2h", "recipient_kind": "paciente", "enabled": "nao"}]',
                                  '[{"event_type": "lembrete_2h", "recipient_kind": "paciente", "enabled": false, "channel": "sms"}]']) p),
          array['invalid', 'invalid', 'invalid', 'invalid', 'invalid'],
          'recusa: lista vazia, forma errada, desligar a confirmação do paciente, valor que não é sim/não, chave estranha');
select is(public.agenda_notify_config_set(pg_temp.a(), '[{"event_type": "lembrete_2h", "recipient_kind": "paciente", "enabled": false},
                                                         {"event_type": "lembrete_24h", "recipient_kind": "paciente", "enabled": true}]'),
          '{"status": "ok", "changed": 1}'::jsonb, 'a dona desliga o lembrete de 2 h (o de 24 h, que já estava ligado, não conta como mudança)');
select pg_temp.entrar('postgres');
select is((select string_agg(distinct n.status, ',') from agenda.notifications n
           where n.clinic_id = pg_temp.a() and n.event_type = 'lembrete_2h' and n.closed_at is not null and n.request_id in (pg_temp.pid(1), pg_temp.id('balcao'))
             and n.slot_start in (pg_temp.t('10:00'), pg_temp.t('11:00'))),
          'cancelada', 'desligar cancela os lembretes de 2 h ainda não enviados');
select is((select count(*)::int from agenda.audit_log l where l.clinic_id = pg_temp.a() and l.action = 'avisos.regra'
           and l.new_value = '{"event_type": "lembrete_2h", "recipient_kind": "paciente", "enabled": false}'::jsonb
           and l.old_value ->> 'enabled' = 'true' and l.actor_user = 'a5100000-0000-4000-8000-000000000001'), 1,
          'a mudança fica na auditoria, com quem fez');
select pg_temp.entrar('anon');
select pg_temp.marcar(4, '08:00', 'paciente4.avisos53@exemplo.test');
select pg_temp.entrar('postgres');
select is(pg_temp.avisos(4), 'confirmado/clinica/agendada confirmado/paciente/agendada lembrete_24h/paciente/agendada',
          'o agendamento seguinte nasce sem o lembrete de 2 h');
select pg_temp.dona();
select is(public.agenda_notify_config_set(pg_temp.a(), '[{"event_type": "confirmado", "recipient_kind": "clinica", "enabled": false}]') ->> 'changed', '1',
          'a dona desliga o aviso de novo agendamento para a clínica');

/* ===================== F. A fila com o envio DESLIGADO ===================== */
select pg_temp.servidor();
select is(public.agenda_notify_claim(20), '{"status": "off", "items": []}'::jsonb, 'envio desligado: o servidor recebe "off" e nenhum aviso');
select pg_temp.entrar('postgres');
select private.agenda_notify_tick();
select is(pg_temp.avisos(4), 'confirmado/clinica/cancelada confirmado/paciente/sem_canal lembrete_24h/paciente/agendada',
          'o cron fecha a confirmação vencida como sem_canal (a da clínica já tinha sido cancelada pela escolha); o lembrete futuro continua agendado');
select is((select count(*)::int from agenda.notifications n where n.status = 'enviada' or n.sent_at is not null), 0,
          'com o envio desligado, nada fica como "enviada"');
select is((select count(*)::int from agenda.notifications n where n.status = 'agendada' and n.next_try_at <= clock_timestamp()), 0,
          'e a fila de vencidos fica vazia');

/* ===================== G. A fila com o envio LIGADO ===================== */
select pg_temp.ligar_envio(true);
select pg_temp.entrar('anon');
-- pedidos 5 (com e-mail), 6 (sem e-mail) e 7 (com e-mail, cancelado logo depois pela clínica)
select pg_temp.marcar(5, '08:30', 'paciente5.avisos53@exemplo.test');
select pg_temp.marcar(6, '09:00');
select pg_temp.marcar(7, '09:30', 'paciente7.avisos53@exemplo.test');
select pg_temp.recepcao();
select public.agenda_cancel(pg_temp.pid(7), 'equipamento_manutencao');
select pg_temp.servidor();
select set_config('teste.lote1', public.agenda_notify_claim(20)::text, true);
select is(current_setting('teste.lote1')::jsonb ->> 'status', 'ok', 'envio ligado: o servidor pega a fila');
select is(pg_temp.item(current_setting('teste.lote1')::jsonb, 5, 'confirmado') - 'id',
          jsonb_build_object('event_type', 'confirmado', 'channel', 'email', 'recipient_kind', 'paciente',
            'to', 'paciente5.avisos53@exemplo.test', 'attempt', 1, 'code', 'IMED-B5100000',
            'slot_start', pg_temp.t('08:30'), 'slot_end', pg_temp.t('09:00'), 'timezone', 'America/Sao_Paulo', 'cancelled_by', null, 'booked_by', 'imed_app',
            'clinic', jsonb_build_object('name', 'Clínica dos Avisos', 'address_line', 'Rua do Lembrete, 53', 'neighborhood', null,
                                         'city', 'São Paulo', 'state', 'SP', 'phone', null)),
          'o aviso vai com o destino lido do pedido, o horário, o fuso, o código e os dados da clínica (nada do exame)');
select pg_temp.entrar('postgres');
select is(pg_temp.avisos(5), 'confirmado/paciente/enviando lembrete_24h/paciente/agendada', 'o que foi entregue ao servidor fica "enviando"');
select is(pg_temp.avisos(6), 'confirmado/paciente/sem_contato lembrete_24h/paciente/agendada', 'paciente sem e-mail: sem_contato (nada é entregue)');
select is(pg_temp.avisos(7), 'cancelado/paciente/agendada confirmado/paciente/cancelada lembrete_24h/paciente/cancelada',
          'a confirmação de um agendamento já cancelado não sai (cancelada); o aviso de cancelamento espera a vez dele (a próxima rodada)');
select ok(pg_temp.item(current_setting('teste.lote1')::jsonb, 6, 'confirmado') is null
          and pg_temp.item(current_setting('teste.lote1')::jsonb, 7, 'confirmado') is null, 'e nenhum dos dois foi entregue ao servidor');
-- a ordem: de um mesmo agendamento, só o mais antigo dos vencidos
select pg_temp.entrar('anon');
select pg_temp.marcar(8, '11:30', 'paciente8.avisos53@exemplo.test');
select pg_temp.entrar('postgres');
update agenda.notifications set send_after = now() - interval '1 minute', next_try_at = now() - interval '1 minute'
where request_id = pg_temp.pid(8) and event_type = 'lembrete_24h';
select pg_temp.servidor();
select set_config('teste.lote2', public.agenda_notify_claim(20)::text, true);
select ok(pg_temp.item(current_setting('teste.lote2')::jsonb, 8, 'lembrete_24h') is not null
          and pg_temp.item(current_setting('teste.lote2')::jsonb, 8, 'confirmado') is null,
          'dois vencidos do mesmo agendamento: só o mais antigo é entregue nesta rodada');
select ok(pg_temp.item(current_setting('teste.lote2')::jsonb, 7, 'cancelado') ->> 'to' = 'paciente7.avisos53@exemplo.test',
          'o aviso de cancelamento do agendamento 7 sai nesta rodada');
select is(jsonb_array_length(public.agenda_notify_claim(20) -> 'items'), 0, 'e o seguinte espera o primeiro terminar');
-- o resultado: falha tenta de novo; enviada fecha; resposta repetida = stale
select set_config('teste.n5', (pg_temp.item(current_setting('teste.lote1')::jsonb, 5, 'confirmado') ->> 'id'), true);
select is(public.agenda_notify_done(pg_temp.id('n5'), 'falhou', null, 'http_500'), '{"status": "ok", "notification_status": "agendada"}'::jsonb,
          'falha na 1ª tentativa: volta para a fila');
select pg_temp.entrar('postgres');
select is((select n.attempts || '|' || n.last_error || '|' || (n.next_try_at > clock_timestamp() + interval '50 seconds'
                                                               and n.next_try_at < clock_timestamp() + interval '70 seconds')
           from agenda.notifications n where n.id = pg_temp.id('n5')), '1|http_500|true', 'com o código do erro e nova tentativa em 1 minuto');
update agenda.notifications set next_try_at = now() - interval '1 second' where id = pg_temp.id('n5');
select pg_temp.servidor();
select is((pg_temp.item(public.agenda_notify_claim(20), 5, 'confirmado') ->> 'attempt')::int, 2, 'vencido o prazo, é entregue de novo (2ª tentativa)');
select is(public.agenda_notify_done(pg_temp.id('n5'), 'enviada', 'msg-do-provedor-123'), '{"status": "ok", "notification_status": "enviada"}'::jsonb,
          'enviada: fecha');
select is(public.agenda_notify_done(pg_temp.id('n5'), 'enviada') ->> 'status', 'stale', 'resposta repetida do mesmo envio: stale, sem efeito');
select is(array[public.agenda_notify_done(pg_temp.id('n5'), 'entregue') ->> 'status', public.agenda_notify_done(null, 'enviada') ->> 'status',
                public.agenda_notify_done(gen_random_uuid(), 'enviada') ->> 'status'],
          array['invalid', 'invalid', 'not_found'], 'resultado desconhecido ou aviso que não existe: recusado');
-- depois de 10 tentativas, "falhou"; texto livre no erro vira o código genérico
select set_config('teste.n8', (pg_temp.item(current_setting('teste.lote2')::jsonb, 8, 'lembrete_24h') ->> 'id'), true);
select pg_temp.entrar('postgres');
update agenda.notifications set attempts = 10 where id = pg_temp.id('n8');
select pg_temp.servidor();
select is(public.agenda_notify_done(pg_temp.id('n8'), 'falhou', null, 'Mensagem do provedor com paciente8.avisos53@exemplo.test') ->> 'notification_status',
          'falhou', 'na 10ª tentativa: falhou (fecha)');
select pg_temp.entrar('postgres');
select is((select n.last_error from agenda.notifications n where n.id = pg_temp.id('n8')), 'erro',
          'o texto do provedor não é gravado: só um código (aqui, o genérico)');
select is((select n.provider_message_id || '|' || (n.sent_at is not null) || '|' || (n.closed_at is not null)
           from agenda.notifications n where n.id = pg_temp.id('n5')), 'msg-do-provedor-123|true|true', 'o enviado guarda o protocolo do provedor e a hora');
-- envio que não respondeu em 5 minutos volta para a fila
update agenda.notifications set claimed_at = now() - interval '6 minutes'
where request_id = pg_temp.pid(7) and event_type = 'cancelado' and status = 'enviando';
select pg_temp.servidor();
select is((pg_temp.item(public.agenda_notify_claim(20), 7, 'cancelado') ->> 'attempt')::int, 2,
          'envio sem resposta há mais de 5 minutos é entregue de novo');
select pg_temp.entrar('postgres');
select set_config('teste.n7', (select n.id::text from agenda.notifications n where n.request_id = pg_temp.pid(7) and n.event_type = 'cancelado'), true);
select pg_temp.servidor();
select is(public.agenda_notify_done(pg_temp.id('n7'), 'sem_contato') ->> 'notification_status', 'sem_contato',
          'o servidor também pode fechar como sem_contato (destino do cadastro que não serve)');

/* ===================== H. Leituras ===================== */
select pg_temp.recepcao();
select is((select string_agg((i ->> 'event_type') || '/' || (i ->> 'notification_status'), ' ')
           from jsonb_array_elements(public.agenda_notify_list(pg_temp.pid(5)) -> 'items') i),
          'confirmado/enviada lembrete_24h/agendada', 'a recepção vê os avisos do agendamento e a situação de cada um');
select ok(not (public.agenda_notify_list(pg_temp.pid(5))::text ~ '(exemplo\.test|1198765|Paciente)'),
          'sem destino e sem dado de paciente na resposta');
select pg_temp.outra();
select is(public.agenda_notify_list(pg_temp.pid(5)) ->> 'status', 'forbidden', 'quem não é da clínica não vê os avisos');
select is(public.agenda_central_avisos() ->> 'status', 'forbidden', 'nem a saúde dos avisos da central');
select pg_temp.admin();
select is((select (j ->> 'status') || '|' || (j ->> 'sending') || '|' || (j -> 'last7' ->> 'enviada') || '|' || (j -> 'last7' ->> 'falhou')
                  || '|' || jsonb_array_length(j -> 'failures') || '|' || (j -> 'failures' -> 0 ->> 'clinic') || '|' || (j -> 'failures' -> 0 ->> 'error')
           from (select public.agenda_central_avisos() as j) x),
          'ok|true|1|1|1|Clínica dos Avisos|erro', 'a central vê os números (enviada, falhou) e a falha por clínica, com o código');
select ok(not (public.agenda_central_avisos()::text ~ '(exemplo\.test|1198765|Paciente|b5100000)'),
          'sem dado de paciente e sem id de pedido na resposta da central');

/* ===================== I. Erro ao preparar o aviso não derruba a marcação ===================== */
select pg_temp.entrar('postgres');
alter table agenda.notifications add constraint teste_quebra_ck check (event_type <> 'confirmado') not valid;
select pg_temp.entrar('anon');
select is(pg_temp.marcar(9, '10:30', 'paciente9.avisos53@exemplo.test') ->> 'request_status', 'confirmed',
          'com a tabela dos avisos recusando a gravação, o paciente marca do mesmo jeito');
select pg_temp.entrar('postgres');
select is(pg_temp.avisos(9), '-', 'e nenhum aviso pela metade fica gravado');

select * from finish();
rollback;
