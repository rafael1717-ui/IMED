-- "Bloquear mesmo assim" (iMed Agenda, fase 4.2; arquitetura §3.2 item 4, §5 e §11; decisões 4.2-a e 4.2-b):
--   - agenda_block_add continua recusando bloqueio com paciente no período (has_appointments) sem gravar nada;
--   - agenda_block_force sem o código: a prévia (quem seria atingido e um código), sem gravar nada (só o access_log);
--   - com o código certo: os pacientes vão para remarcação (TODOS os recursos do item soltos, inclusive a sala), um
--     conflito "Para remarcar" por item, os "só ocupar" do período saem, o bloqueio é gravado; código velho ou errado:
--     affected_changed; alguém já presente: cannot_move (com nomes: fica no access_log); a conferência adiada (I2) passa no fim;
--   - depois: voltar ao horário de antes dá slot_taken (o bloqueio está lá); remarcar fecha o conflito SOZINHO
--     (gatilho, com auditoria), e também cancelar (pela clínica ou pelo próprio paciente), cancelar um exame e voltar
--     ao horário de antes (só o conflito do bloqueio; o de grade que mudou continua);
--   - o que JÁ COMEÇOU (o exame em andamento) não é atingido nem impede: o fechamento do recurso começa quando ele
--     termina; o mesmo "mesmo assim" reenviado não grava outro bloqueio;
--   - remarcar pela clínica com antecedência mínima: as alternativas do slot_taken são as da clínica (agora − antecedência);
--   - permissões: recepção e gestor sim; profissional, financeiro e outra clínica não; equipe do IMED sem nomes.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test; nomes fictícios.
begin;
select plan(60);
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
create function pg_temp.u(p_n integer) returns uuid language sql immutable as $$
  select ('a3385000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.email(p_n integer) returns text language sql immutable as $$
  select (array['dona', 'recepcao', 'gestor', 'prof', 'fin', 'donab', 'admin', 'paciente'])[p_n] || '.forcado@exemplo.test' $$;
create function pg_temp.como(p_n integer) returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(p_n), pg_temp.email(p_n)) $$;
create function pg_temp.a() returns uuid language sql immutable as $$ select 'c3385000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.b() returns uuid language sql immutable as $$ select 'c3385000-0000-4000-8000-000000000002'::uuid $$;
create function pg_temp.hoje() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create function pg_temp.t(p_dias integer, p_hhmm text) returns timestamptz language sql stable as $$
  select (pg_temp.hoje() + p_dias + p_hhmm::time) at time zone 'America/Sao_Paulo' $$;
create function pg_temp.id(p text) returns uuid language sql stable as $$ select current_setting('teste.' || p)::uuid $$;
create function pg_temp.item(p_req text) returns uuid language sql stable as $$
  select i.id from agenda.appointment_items i where i.request_id = pg_temp.id(p_req) order by i.seq limit 1 $$;
create function pg_temp.balcao(p_proc text, p_t timestamptz, p_nome text) returns text language sql as $$
  select public.agenda_desk_book(pg_temp.a(), jsonb_build_array(jsonb_build_object('procedure_id', pg_temp.id(p_proc), 'starts_at', p_t)),
           jsonb_build_object('name', p_nome, 'phone', '(11) 97777-' || lpad((abs(hashtext(p_nome)) % 10000)::text, 4, '0'), 'consent', true),
           'clinica_balcao') ->> 'id' $$;
-- prévia do bloqueio do USG-1 amanhã das 08:00 às 12:00 (o caso principal)
create function pg_temp.forcar(p_confirm text default null) returns jsonb language sql as $$
  select public.agenda_block_force(pg_temp.a(), pg_temp.id('usg1'), pg_temp.t(1, '08:00'), pg_temp.t(1, '12:00'), 'manutencao',
                                   'Troca da sonda', p_confirm) $$;
create function pg_temp.blocos() returns integer language sql stable as $$
  select count(*)::integer from public.clinic_blocks where clinic_id = pg_temp.a() $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated', pg_temp.email(n), now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from generate_series(1, 8) n;
insert into public.admin_emails (email) values (pg_temp.email(7));
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
select c.id, c.nome, 'imagem', 'Rua do Bloqueio, ' || c.n, 'São Paulo', 'SP',
       extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false
from (values (pg_temp.a(), 'Clínica do Bloqueio Forçado', 1), (pg_temp.b(), 'Outra Clínica do Bloqueio Forçado', 2)) c (id, nome, n);
insert into public.clinic_members (clinic_id, user_id, role) values
  (pg_temp.a(), pg_temp.u(1), 'owner'), (pg_temp.a(), pg_temp.u(2), 'reception'), (pg_temp.a(), pg_temp.u(3), 'manager'),
  (pg_temp.a(), pg_temp.u(4), 'professional'), (pg_temp.a(), pg_temp.u(5), 'finance'), (pg_temp.b(), pg_temp.u(6), 'owner');
insert into agenda.holidays (scope, day, name, source)
select 'nacional', make_date(extract(year from pg_temp.hoje())::integer + 2, 1, 1), 'Confraternização Universal', 'Fonte de teste (Lei 662/1949)'
where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from pg_temp.hoje())::integer + 2, 1, 1));

-- USG-1 com 2 vagas, a Sala 2 e a Dra. Forçado (do profissional); ultrassom (USG-1), exame combinado (Sala 2 + USG-1)
-- e consulta na sala (só a Sala 2). Aberta o dia inteiro, de 15 em 15 minutos.
select pg_temp.como(1);
select public.agenda_unit_save(pg_temp.a(), jsonb_build_object('holidays_checked_until', pg_temp.hoje() + 60, 'min_notice_min', 0, 'step_min', 15));
select set_config('teste.usg1', public.agenda_resource_save(pg_temp.a(), '{"kind": "equipamento", "name": "USG-1", "capacity": 2}') ->> 'id', true);
select set_config('teste.sala', public.agenda_resource_save(pg_temp.a(), '{"kind": "sala", "name": "Sala 2"}') ->> 'id', true);
select set_config('teste.dra', public.agenda_resource_save(pg_temp.a(),
         jsonb_build_object('kind', 'profissional', 'name', 'Dra. Forçado', 'member_user_id', pg_temp.u(4))) ->> 'id', true);
select set_config('teste.usg', public.agenda_procedure_save(pg_temp.a(), jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'equipamento', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('usg1'))))))) ->> 'id', true);
select set_config('teste.comb', public.agenda_procedure_save(pg_temp.a(), jsonb_build_object(
  'exam_code', 'usg', 'name', 'Ultrassom com sala', 'duration_min', 30,
  'requirements', jsonb_build_array(
    jsonb_build_object('resource_kind', 'sala', 'options', jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('sala')))),
    jsonb_build_object('resource_kind', 'equipamento', 'options', jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('usg1'))))))) ->> 'id', true);
select set_config('teste.cons', public.agenda_procedure_save(pg_temp.a(), jsonb_build_object(
  'exam_code', 'ecg', 'name', 'Eletro na sala', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'sala', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('sala'))))))) ->> 'id', true);
select public.agenda_rules_set(pg_temp.a(), null,
         (select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00')) from generate_series(0, 6) d));
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_agenda', true);
update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now() where id = pg_temp.a();
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);

-- amanhã: ultrassom 09:00 e 10:00 (USG-1), combinado 09:00 (Sala 2 + USG-1, a 2ª vaga), "ocupado" no USG-1 11:00–11:30;
-- depois de amanhã: eletro na sala 09:00 (só a Sala 2); hoje: um ultrassom daqui a pouco, já com a chegada registrada
select pg_temp.como(2);
select set_config('teste.a1', pg_temp.balcao('usg', pg_temp.t(1, '09:00'), 'Maria Souza Forçado'), true);
select set_config('teste.a2', pg_temp.balcao('usg', pg_temp.t(1, '10:00'), 'João Lima Forçado'), true);
select set_config('teste.a3', pg_temp.balcao('comb', pg_temp.t(1, '09:00'), 'Ana Costa Forçado'), true);
select set_config('teste.a4', pg_temp.balcao('cons', pg_temp.t(2, '09:00'), 'Rui Alves Forçado'), true);
select set_config('teste.busy', public.agenda_desk_busy(pg_temp.a(), pg_temp.t(1, '11:00'), pg_temp.t(1, '11:30'), pg_temp.id('usg1'),
                                                        null, 'agenda_propria') ->> 'id', true);
select set_config('teste.h0', (select min((s ->> 'start')::timestamptz)
                               from jsonb_array_elements(public.agenda_desk_slots(pg_temp.a(), pg_temp.id('usg'), pg_temp.hoje(), pg_temp.hoje() + 1) -> 'slots') s
                               where (s ->> 'start')::timestamptz >= now() + interval '5 minutes')::text, true);
select set_config('teste.a5', pg_temp.balcao('usg', current_setting('teste.h0')::timestamptz, 'Lia Rocha Forçado'), true);
select is(public.agenda_attend(pg_temp.id('a5'), 'checked_in') ->> 'request_status', 'checked_in', 'hoje: a paciente das 5 chegou');
select ok(current_setting('teste.a1', true) is not null and current_setting('teste.a2', true) is not null and current_setting('teste.a3', true) is not null
          and current_setting('teste.a4', true) is not null and current_setting('teste.busy', true) is not null,
          'quatro agendamentos e um "só ocupar" marcados pela recepção');
select pg_temp.entrar('postgres');
select set_config('teste.i1', pg_temp.item('a1')::text, true), set_config('teste.i2', pg_temp.item('a2')::text, true),
       set_config('teste.i3', pg_temp.item('a3')::text, true), set_config('teste.i4', pg_temp.item('a4')::text, true),
       set_config('teste.blocos0', pg_temp.blocos()::text, true);

/* ===================== Sem "mesmo assim": recusa, nada gravado ===================== */
select pg_temp.como(2);
select is((select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'items'), j ->> 'busy')
           from (select public.agenda_block_add(pg_temp.a(), pg_temp.id('usg1'), pg_temp.t(1, '08:00'), pg_temp.t(1, '12:00'), 'manutencao') as j) x),
          'has_appointments|3|1', 'agenda_block_add: com pacientes no período, recusa (3 agendamentos e 1 "só ocupar")');
select pg_temp.entrar('postgres');
select is(pg_temp.blocos(), current_setting('teste.blocos0')::integer, '... e nada é gravado');

/* ===================== A prévia ===================== */
select pg_temp.como(2);
select set_config('teste.previa', pg_temp.forcar()::text, true);
select is((select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'items'),
                            (select count(*) from jsonb_array_elements(j -> 'items') y where y ->> 'kind' = 'agendamento' and y ->> 'patient' is not null),
                            (select count(*) from jsonb_array_elements(j -> 'items') y where y ->> 'kind' = 'ocupado' and y ->> 'patient' is null),
                            (select bool_and((y ->> 'can_move')::boolean) from jsonb_array_elements(j -> 'items') y),
                            j ->> 'confirm' ~ '^[0-9a-f]{64}$')
           from (select current_setting('teste.previa')::jsonb as j) x),
          'confirm_required|4|3|1|t|t', 'prévia: 3 agendamentos (com o nome curto) e 1 "só ocupar", todos podem sair; um código de 64 letras');
select is((select string_agg(y ->> 'patient', ',' order by y ->> 'patient') from jsonb_array_elements(current_setting('teste.previa')::jsonb -> 'items') y
           where y ->> 'kind' = 'agendamento'), 'Ana F.,João F.,Maria F.', 'prévia: só o nome curto ("Maria F."), nunca o telefone');
select ok(current_setting('teste.previa') !~ '(97777|Souza|Lima|Costa)', 'prévia: nada de telefone nem sobrenome do meio');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', count(*), max(scope)) from agenda.access_log where user_id = pg_temp.u(2) and fn = 'agenda_block_force'),
          '1|bloqueio', 'prévia com nomes fica no access_log');
select is(pg_temp.blocos(), current_setting('teste.blocos0')::integer, 'prévia não grava bloqueio nenhum');

/* ===================== Código errado: nada muda ===================== */
select pg_temp.como(2);
select is((select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'items'), j ->> 'confirm' = current_setting('teste.previa')::jsonb ->> 'confirm')
           from (select pg_temp.forcar(repeat('0', 64)) as j) x),
          'affected_changed|4|t', 'código errado: affected_changed, com a lista e o código de agora');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', pg_temp.blocos() = current_setting('teste.blocos0')::integer,
                            (select string_agg(i.status, ',' order by i.id) from agenda.appointment_items i
                             where i.id in (pg_temp.id('i1'), pg_temp.id('i2'), pg_temp.id('i3')))
                            = 'confirmed,confirmed,confirmed')), 't|t', '... nada gravado, os 3 continuam confirmados');

/* ===================== Para valer ===================== */
select pg_temp.como(2);
select is((select concat_ws('|', j ->> 'status', j ->> 'moved', j ->> 'busy_removed')
           from (select pg_temp.forcar(current_setting('teste.previa')::jsonb ->> 'confirm') as j) x),
          'ok|3|1', 'com o código da prévia: bloqueado, 3 pacientes para remarcar e 1 "só ocupar" retirado');
select pg_temp.entrar('postgres');
select lives_ok($$ set constraints all immediate $$, 'a conferência adiada (I2: todos os recursos ou nenhum) passa');
set constraints all deferred;
select is((select string_agg(i.status, ',') from agenda.appointment_items i where i.id in (pg_temp.id('i1'), pg_temp.id('i2'), pg_temp.id('i3'))),
          'reschedule_requested,reschedule_requested,reschedule_requested', 'os 3 itens ficam em "remarcação solicitada"');
select is((select concat_ws('|', count(*), count(*) filter (where not o.active and o.release_reason = 'bloqueio_forcado'),
                            count(*) filter (where o.resource_id = pg_temp.id('sala') and not o.active))
           from agenda.occupancy o where o.item_id in (pg_temp.id('i1'), pg_temp.id('i2'), pg_temp.id('i3'))),
          '4|4|1', 'todas as ocupações deles soltas com bloqueio_forcado, inclusive a da Sala 2 (o combinado)');
select is((select string_agg(a.status, ',') from public.appointment_requests a where a.id in (pg_temp.id('a1'), pg_temp.id('a2'), pg_temp.id('a3'))),
          'reschedule_requested,reschedule_requested,reschedule_requested', 'os 3 agendamentos ficam em "remarcação solicitada"');
select is((select concat_ws('|', count(*), count(*) filter (where k.details ->> 'block_id' is not null and k.status = 'aberto'))
           from agenda.conflicts k where k.clinic_id = pg_temp.a() and k.kind = 'bloqueio_sobre_agendamento'),
          '3|3', 'um conflito "Para remarcar" aberto por item, com o bloqueio');
select is((select concat_ws('|', b.removed_at is not null, (select count(*) from agenda.occupancy o where o.busy_id = b.id and o.active))
           from agenda.busy_marks b where b.id = pg_temp.id('busy')), 't|0', 'o "só ocupar" do período sai');
select is((select concat_ws('|', count(*), bool_and(h.reason_code = 'bloqueio_forcado'), bool_and(h.origin = 'painel'))
           from agenda.status_history h
           where h.request_id in (pg_temp.id('a1'), pg_temp.id('a2'), pg_temp.id('a3')) and h.to_status = 'reschedule_requested'),
          '6|t|t', 'histórico de cada item e de cada agendamento com o motivo bloqueio_forcado e a origem painel');
select is((select concat_ws('|', count(*), max(new_value ->> 'remarcar'), max(new_value ->> 'ocupados_retirados'))
           from agenda.audit_log where clinic_id = pg_temp.a() and action = 'bloqueio.criar_forcado'),
          '1|3|1', 'auditoria do bloqueio forçado, só com números');
select is((select concat_ws('|', count(*), max(kind), bool_and(resource_id = pg_temp.id('usg1')))
           from public.clinic_blocks where clinic_id = pg_temp.a() and removed_at is null),
          '1|manutencao|t', 'o bloqueio de manutenção do USG-1 está gravado');

/* ===================== Depois: voltar, remarcar e resolver ===================== */
select pg_temp.como(2);
select is(public.agenda_set_status(pg_temp.id('a1'), 'confirmed', null, null, pg_temp.id('i1')) ->> 'status', 'slot_taken',
          'voltar ao horário de antes: slot_taken (o bloqueio está lá)');
select is((select concat_ws('|', j ->> 'status', j ->> 'request_status')
           from (select public.agenda_reschedule(pg_temp.id('a1'), jsonb_build_array(jsonb_build_object('seq', 1, 'starts_at', pg_temp.t(1, '13:00'))),
                                                 null, gen_random_uuid()) as j) x),
          'ok|confirmed', 'remarcar para amanhã às 13:00: confirmado de novo');
select ok(not exists (select 1 from jsonb_array_elements(public.agenda_conflicts(pg_temp.a()) -> 'conflicts') k
                      where (k ->> 'item_id')::uuid = pg_temp.id('i1')),
          'e o conflito sai SOZINHO da lista "Para remarcar" (sem a tela chamar agenda_conflict_resolve)');
select pg_temp.entrar('postgres');
select set_config('teste.k1', (select k.id::text from agenda.conflicts k where k.item_id = pg_temp.id('i1')), true);
select is((select concat_ws('|', k.status, k.resolution_code, k.resolved_by = pg_temp.u(2),
                            (select concat_ws('/', count(*), max(l.origin), max(l.actor_kind), max(l.reason_code), bool_and((l.new_value ->> 'automatico')::boolean))
                             from agenda.audit_log l where l.action = 'conflito_resolvido' and l.object_id = k.id::text))
           from agenda.conflicts k where k.id = pg_temp.id('k1')),
          'resolvido|remarcado|t|1/painel/clinica/remarcado/t', 'resolvido: remarcado, por quem remarcou, com auditoria (automático)');
select pg_temp.como(2);
select is(public.agenda_conflict_resolve(pg_temp.id('k1'), 'resolvido', 'remarcado') ->> 'status', 'already_closed',
          'resolver de novo pela tela: already_closed (a tela trata como resolvido)');

/* ===================== Alguém já presente: não sai ===================== */
select set_config('teste.previa2', public.agenda_block_force(pg_temp.a(), pg_temp.id('usg1'), current_setting('teste.h0')::timestamptz,
                                     current_setting('teste.h0')::timestamptz + interval '30 minutes')::text, true);
select is((select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'items'), j #>> '{items,0,can_move}', j #>> '{items,0,status}')
           from (select current_setting('teste.previa2')::jsonb as j) x),
          'confirm_required|1|false|checked_in', 'prévia por cima de quem já chegou: não pode sair');
select pg_temp.entrar('postgres');
select set_config('teste.lidas', (select coalesce(sum(reads), 0)::text from agenda.access_log
                                  where user_id = pg_temp.u(2) and fn = 'agenda_block_force'), true);
select pg_temp.como(2);
select is((select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'items'), j #>> '{items,0,patient}' is not null)
           from (select public.agenda_block_force(pg_temp.a(), pg_temp.id('usg1'), current_setting('teste.h0')::timestamptz,
                          current_setting('teste.h0')::timestamptz + interval '30 minutes', 'bloqueio', null,
                          current_setting('teste.previa2')::jsonb ->> 'confirm') as j) x),
          'cannot_move|1|t', 'mesmo com o código: cannot_move (a lista volta com o nome curto)');
select pg_temp.entrar('postgres');
select is((select coalesce(sum(reads), 0) from agenda.access_log where user_id = pg_temp.u(2) and fn = 'agenda_block_force'),
          current_setting('teste.lidas')::bigint + 1, 'cannot_move com nomes também fica no access_log (como a prévia)');
select is((select concat_ws('|', count(*), (select a.status from public.appointment_requests a where a.id = pg_temp.id('a5')))
           from public.clinic_blocks where clinic_id = pg_temp.a() and removed_at is null), '1|checked_in', '... nada gravado');

/* ===================== Clínica inteira ===================== */
select pg_temp.como(3);
select set_config('teste.previa3', public.agenda_block_force(pg_temp.a(), null, pg_temp.t(2, '08:00'), pg_temp.t(2, '12:00'), 'folga')::text, true);
select is((select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'items'), j #>> '{items,0,item_id}' = current_setting('teste.i4'))
           from (select current_setting('teste.previa3')::jsonb as j) x),
          'confirm_required|1|t', 'o gestor também pode; a clínica inteira atinge o eletro só da sala');
select is((select concat_ws('|', j ->> 'status', j ->> 'moved')
           from (select public.agenda_block_force(pg_temp.a(), null, pg_temp.t(2, '08:00'), pg_temp.t(2, '12:00'), 'folga', null,
                          current_setting('teste.previa3')::jsonb ->> 'confirm') as j) x),
          'ok|1', 'bloqueio da clínica inteira com "mesmo assim": o eletro vai para remarcar');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', i.status, (select count(*) from agenda.occupancy o where o.item_id = i.id and o.active),
                            (select count(*) from agenda.occupancy o join public.clinic_blocks b on b.id = o.block_id
                             where b.clinic_id = pg_temp.a() and b.resource_id is null and o.active))
           from agenda.appointment_items i where i.id = pg_temp.id('i4')),
          'reschedule_requested|0|3', 'o eletro sem recurso e o fechamento nos 3 recursos da clínica');

/* ===================== Saem sozinhos da lista: paciente cancela, voltar ao horário de antes, cancelar um exame ===================== */
-- o pedido do João (a2) passa a ser da conta de um paciente, que cancela pelo site
select pg_temp.entrar('postgres');
update public.appointment_requests set user_id = pg_temp.u(8) where id = pg_temp.id('a2');
select pg_temp.como(8);
select is(public.cancel_request(pg_temp.id('a2')), 'ok', 'o próprio paciente cancela pela conta (estava para remarcar)');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', k.status, k.resolution_code,
                            (select concat_ws('/', l.origin, l.actor_kind) from agenda.audit_log l
                             where l.action = 'conflito_resolvido' and l.object_id = k.id::text))
           from agenda.conflicts k where k.item_id = pg_temp.id('i2') and k.kind = 'bloqueio_sobre_agendamento'),
          'resolvido|cancelado|app/paciente', 'o conflito do João fecha sozinho: cancelado, pelo paciente');
-- a Ana (a3, combinado) também tem um conflito de grade que mudou; tirado o bloqueio, volta ao horário de antes
insert into agenda.conflicts (clinic_id, kind, request_id, item_id, details)
values (pg_temp.a(), 'grade_mudou', pg_temp.id('a3'), pg_temp.id('i3'), jsonb_build_object('teste', true));
select set_config('teste.blk', (select b.id::text from public.clinic_blocks b where b.clinic_id = pg_temp.a()
                                and b.resource_id = pg_temp.id('usg1') and b.kind = 'manutencao' and b.removed_at is null), true);
select pg_temp.como(2);
select is(public.agenda_block_remove(pg_temp.id('blk')) ->> 'status', 'ok', 'a recepção tira o bloqueio de manutenção');
select is(public.agenda_set_status(pg_temp.id('a3'), 'confirmed', null, null, pg_temp.id('i3')) ->> 'status', 'ok',
          'voltar ao horário de antes (a sala e o aparelho de novo)');
select pg_temp.entrar('postgres');
select is((select string_agg(k.kind || ':' || k.status || coalesce(':' || k.resolution_code, ''), ',' order by k.kind)
           from agenda.conflicts k where k.item_id = pg_temp.id('i3')),
          'bloqueio_sobre_agendamento:resolvido:mantido,grade_mudou:aberto',
          'o do bloqueio fecha (mantido); o da grade que mudou continua aberto (o horário é o mesmo)');
-- o eletro do Rui (a4, para remarcar pelo bloqueio da clínica inteira): cancelar só este exame
select pg_temp.como(2);
select is(public.agenda_set_status(pg_temp.id('a4'), 'cancelled', 'clinica_indisponivel', null, pg_temp.id('i4')) ->> 'status', 'ok',
          'cancelar o exame (agenda_set_status com o item)');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', k.status, k.resolution_code) from agenda.conflicts k where k.item_id = pg_temp.id('i4')),
          'resolvido|cancelado', 'o conflito do Rui fecha sozinho: cancelado');

/* ===================== O que já começou não é atingido nem impede ===================== */
-- Eva e Gil na Sala 2 (eletro); o exame da Eva "já começou" há 10 minutos (correção pelo SQL, só no teste: o relógio
-- do banco não anda dentro da transação) e ela está presente; o do Gil é daqui a mais de 1 hora.
select pg_temp.como(2);
select set_config('teste.hs', (select min((s ->> 'start')::timestamptz)
                               from jsonb_array_elements(public.agenda_desk_slots(pg_temp.a(), pg_temp.id('cons'), pg_temp.hoje(), pg_temp.hoje() + 1) -> 'slots') s
                               where (s ->> 'start')::timestamptz >= now() + interval '5 minutes')::text, true);
-- o do Gil é o primeiro horário livre a partir de 1 hora depois (não "hs + 1 hora" direto: das 23:00 em diante essa
-- conta cai num exame que passaria da meia-noite, que a grade não oferece, e o teste dependia da hora em que rodava)
select set_config('teste.hg', (select min((s ->> 'start')::timestamptz)
                               from jsonb_array_elements(public.agenda_desk_slots(pg_temp.a(), pg_temp.id('cons'), pg_temp.hoje(), pg_temp.hoje() + 1) -> 'slots') s
                               where (s ->> 'start')::timestamptz >= current_setting('teste.hs')::timestamptz + interval '1 hour')::text, true);
select set_config('teste.e1', pg_temp.balcao('cons', current_setting('teste.hs')::timestamptz, 'Eva Duarte Forçado'), true);
select set_config('teste.e2', pg_temp.balcao('cons', current_setting('teste.hg')::timestamptz, 'Gil Prado Forçado'), true);
select pg_temp.entrar('postgres');
select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_agenda', true);
update agenda.appointment_items i set starts_at = now() - interval '10 minutes', ends_at = now() + interval '20 minutes',
       local_start = (now() - interval '10 minutes') at time zone 'America/Sao_Paulo'
where i.request_id = pg_temp.id('e1');
update agenda.occupancy o set during = tstzrange(now() - interval '10 minutes', now() + interval '20 minutes', '[)')
where o.item_id = pg_temp.item('e1') and o.active;
update public.appointment_requests a set slot_start = now() - interval '10 minutes', slot_end = now() + interval '20 minutes'
where a.id = pg_temp.id('e1');
select set_config('imed.origin', '', true), set_config('imed.reason', '', true);
select pg_temp.como(2);
select is(public.agenda_attend(pg_temp.id('e1'), 'checked_in') ->> 'status', 'ok', 'a Eva chegou (o exame dela já começou)');
-- bloqueio pedido desde 1 hora atrás ("dia inteiro" de hoje) até daqui a 4 horas, na Sala 2
select set_config('teste.previa4', public.agenda_block_force(pg_temp.a(), pg_temp.id('sala'), now() - interval '1 hour',
                                     now() + interval '4 hours', 'bloqueio')::text, true);
select is((select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'items'), j #>> '{items,0,request_id}' = current_setting('teste.e2'))
           from (select current_setting('teste.previa4')::jsonb as j) x),
          'confirm_required|1|t', 'prévia: só o Gil; a Eva, que já começou, não aparece (nem como "não pode sair")');
select is((select concat_ws('|', j ->> 'status', j ->> 'moved')
           from (select public.agenda_block_force(pg_temp.a(), pg_temp.id('sala'), now() - interval '1 hour', now() + interval '4 hours',
                          'bloqueio', null, current_setting('teste.previa4')::jsonb ->> 'confirm') as j) x),
          'ok|1', 'quem já começou não impede: bloqueado, só o Gil vai para remarcar');
select pg_temp.entrar('postgres');
select is((select concat_ws('|', (select i.status from agenda.appointment_items i where i.request_id = pg_temp.id('e1')),
                            (select count(*) from agenda.occupancy o where o.item_id = pg_temp.item('e1') and o.active),
                            (select i.status from agenda.appointment_items i where i.request_id = pg_temp.id('e2')))),
          'checked_in|1|reschedule_requested', 'a Eva continua presente, com a sala; o Gil vai para remarcação');
select is((select concat_ws('|', count(*), bool_and(lower(o.during) = now() + interval '20 minutes'), bool_and(upper(o.during) = now() + interval '4 hours'),
                            bool_and(b.starts_at = now() - interval '1 hour'))
           from agenda.occupancy o join public.clinic_blocks b on b.id = o.block_id
           where b.clinic_id = pg_temp.a() and b.resource_id = pg_temp.id('sala') and b.removed_at is null and o.active),
          '1|t|t|t', 'o fechamento da sala começa quando o exame da Eva termina; o bloqueio guarda o período pedido');
-- a resposta do "mesmo assim" se perdeu e a tela manda de novo: nada novo
select pg_temp.como(2);
select is((select concat_ws('|', j ->> 'status', j ->> 'replay', j ->> 'moved')
           from (select public.agenda_block_force(pg_temp.a(), pg_temp.id('sala'), now() - interval '1 hour', now() + interval '4 hours',
                          'bloqueio', null, current_setting('teste.previa4')::jsonb ->> 'confirm') as j) x),
          'ok|true|0', 'o mesmo "mesmo assim" de novo: ok (replay), sem gravar outro bloqueio');
select pg_temp.entrar('postgres');
select is((select count(*)::integer from public.clinic_blocks b
           where b.clinic_id = pg_temp.a() and b.resource_id = pg_temp.id('sala') and b.removed_at is null), 1, '... um bloqueio só na sala');

/* ===================== Remarcar pela clínica: alternativas com o "agora" da clínica ===================== */
-- Consulta com a Dra. (profissional), com 10 horas de antecedência para o paciente. Ivo e Léa marcados pelo balcão;
-- remarcar o Ivo para o horário da Léa: slot_taken, e as alternativas são as que a clínica pode marcar (desde agora).
select pg_temp.como(1);
select set_config('teste.pro', public.agenda_procedure_save(pg_temp.a(), jsonb_build_object(
  'exam_code', 'eco', 'name', 'Consulta com a Dra.', 'duration_min', 30,
  'requirements', jsonb_build_array(jsonb_build_object('resource_kind', 'profissional', 'options',
    jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('dra'))))))) ->> 'id', true);
select is(public.agenda_unit_save(pg_temp.a(), '{"min_notice_min": 600}') ->> 'status', 'ok', 'a unidade passa a pedir 10 horas de antecedência');
select pg_temp.como(2);
select set_config('teste.t1', (select min((s ->> 'start')::timestamptz)
                               from jsonb_array_elements(public.agenda_desk_slots(pg_temp.a(), pg_temp.id('pro'), pg_temp.hoje(), pg_temp.hoje() + 1) -> 'slots') s
                               where (s ->> 'start')::timestamptz >= now() + interval '3 hours')::text, true);
select set_config('teste.t2', (select min((s ->> 'start')::timestamptz)
                               from jsonb_array_elements(public.agenda_desk_slots(pg_temp.a(), pg_temp.id('pro'), pg_temp.hoje(), pg_temp.hoje() + 1) -> 'slots') s
                               where (s ->> 'start')::timestamptz >= now() + interval '5 hours')::text, true);
select set_config('teste.g1', pg_temp.balcao('pro', current_setting('teste.t1')::timestamptz, 'Ivo Ramos Forçado'), true);
select set_config('teste.g2', pg_temp.balcao('pro', current_setting('teste.t2')::timestamptz, 'Léa Moura Forçado'), true);
select is((select concat_ws('|', j ->> 'status', jsonb_array_length(j -> 'alternatives') > 0,
                            (j #>> '{alternatives,0}')::timestamptz < now() + interval '10 hours')
           from (select public.agenda_reschedule(pg_temp.id('g1'), jsonb_build_array(jsonb_build_object('seq', 1, 'starts_at', current_setting('teste.t2'))),
                                                 null, gen_random_uuid()) as j) x),
          'slot_taken|t|t', 'horário pego: as alternativas da clínica começam antes das 10 horas de antecedência (como "Ver horários")');
select pg_temp.como(1);
select is(public.agenda_unit_save(pg_temp.a(), '{"min_notice_min": 0}') ->> 'status', 'ok', 'antecedência de volta a zero');

/* ===================== Permissões e erros ===================== */
select pg_temp.como(4);
select is(pg_temp.forcar() ->> 'status', 'forbidden', 'o profissional não bloqueia');
select pg_temp.como(5);
select is(pg_temp.forcar() ->> 'status', 'forbidden', 'o financeiro não bloqueia');
select pg_temp.como(6);
select is(pg_temp.forcar() ->> 'status', 'forbidden', 'a dona de outra clínica não bloqueia');
select pg_temp.como(7);
select is((select concat_ws('|', j ->> 'status', (select count(*) from jsonb_array_elements(j -> 'items') y where y ->> 'patient' is not null))
           from (select public.agenda_block_force(pg_temp.a(), pg_temp.id('usg1'), pg_temp.t(1, '12:00'), pg_temp.t(1, '14:00')) as j) x),
          'confirm_required|0', 'a equipe do IMED vê a prévia sem nomes');
select pg_temp.entrar('postgres');
select is((select count(*)::integer from agenda.access_log where user_id = pg_temp.u(7)), 0, '... e sem registro de leitura (não leu nome)');
select pg_temp.como(2);
select is(public.agenda_block_force(pg_temp.a(), null, now() - interval '2 days', now() - interval '1 day') ->> 'status', 'invalid_period',
          'período que já passou: invalid_period');
select is(public.agenda_block_force(pg_temp.a(), null, pg_temp.t(5, '08:00'), pg_temp.t(5, '09:00'), 'ferias') ->> 'status', 'invalid',
          'tipo desconhecido: invalid');
select is(public.agenda_block_force(pg_temp.a(), gen_random_uuid(), pg_temp.t(5, '08:00'), pg_temp.t(5, '09:00')) ->> 'status', 'not_found',
          'recurso de fora: not_found');
select pg_temp.como(6);
select is(public.agenda_block_force(pg_temp.b(), null, pg_temp.t(5, '08:00'), pg_temp.t(5, '09:00')) ->> 'status', 'agenda_not_started',
          'clínica sem a agenda nova: agenda_not_started');
select pg_temp.entrar('anon');
select throws_ok($$ select pg_temp.forcar() $$, '42501', null, 'visitante nem executa');

select * from finish();
rollback;
