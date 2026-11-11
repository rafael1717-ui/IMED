-- Papéis e permissões (iMed Agenda, fase 3.1; arquitetura §5 e §12):
--   - a referência agenda.role_permissions é a matriz do §12 (staff = recepção; profissional só a própria agenda;
--     financeiro só o financeiro; gestor sem integração e sem mexer nos donos);
--   - has_clinic_perm: permissão pelo papel na clínica (dono e staff de hoje), nunca em outra clínica;
--   - imed_has: o dono (is_imed_admin) tem todas; a equipe (private.imed_staff), só as do papel ativo e só com conta
--     e sessão seguras (e-mail confirmado, sessão pelo link ou com senha, sem celular ou login anônimo); suporte sem dado
--     de paciente; papel revogado não vale; is_imed_admin continua só do dono;
--   - a referência agenda.status_transitions é a máquina de estados do §5 (permissões que existem, regras de horário,
--     motor completo onde volta a ocupar horário).
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test.
begin;
select plan(59);

-- Troca de papel como o PostgREST faz (role + request.jwt.claims). p_amr: como a sessão foi aberta.
create function pg_temp.entrar(p_papel text, p_usuario uuid default null, p_email text default null, p_amr text default 'otp')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_papel = 'postgres' then ''
         else jsonb_strip_nulls(jsonb_build_object(
                'role', p_papel, 'sub', p_usuario, 'email', p_email,
                'aud', case when p_usuario is not null then 'authenticated' end,
                'amr', case when p_usuario is not null then jsonb_build_array(jsonb_build_object('method', p_amr, 'timestamp', 1)) end))::text
    end, true);
  perform set_config('role', p_papel, true);
end $$;

/* ===================== A. A matriz de permissões da clínica (§12) ===================== */

select is(
  array(select permission || ' ' || scope from agenda.role_permissions where role = 'owner' order by 1),
  array['agenda.atender clinica', 'agenda.bloquear clinica', 'agenda.cancelar clinica', 'agenda.configurar clinica',
        'agenda.marcar clinica', 'agenda.pacientes clinica', 'agenda.remarcar clinica', 'agenda.ver clinica',
        'auditoria.ver clinica', 'clinica.editar clinica', 'conflitos.resolver clinica', 'equipe.gerenciar clinica',
        'financeiro.configurar clinica', 'financeiro.estornar clinica',
        'financeiro.ver clinica', 'integracao.gerenciar clinica', 'pedidos.ver clinica', 'precos.editar clinica'],
  'dono: as 16 permissões da agenda + ligar o recebimento e pedir devolução (iMed Pagamentos, P1), na clínica inteira');
select is(
  array(select q.permission from (select o.permission from agenda.role_permissions o where o.role = 'owner'
                                  except select g.permission from agenda.role_permissions g where g.role = 'manager') q order by 1),
  array['financeiro.configurar', 'financeiro.estornar', 'integracao.gerenciar'],
  'gestor: tudo o que o dono tem, menos a integração e o dinheiro (ligar o recebimento e devolver: só o dono)');
select is((select scope from agenda.role_permissions where role = 'manager' and permission = 'equipe.gerenciar'), 'sem_donos',
          'gestor gerencia a equipe, menos os donos');
select is(
  array(select permission || ' ' || scope from agenda.role_permissions where role = 'reception' order by 1),
  array['agenda.atender clinica', 'agenda.bloquear clinica', 'agenda.cancelar clinica', 'agenda.marcar clinica',
        'agenda.pacientes clinica', 'agenda.remarcar clinica', 'agenda.ver clinica', 'conflitos.resolver clinica',
        'pedidos.ver clinica'],
  'recepção: pedidos, agenda, atendimento, bloqueios e conflitos (sem configurar, preços, equipe, financeiro, auditoria)');
select is(
  array(select permission || ' ' || scope from agenda.role_permissions where role = 'staff' order by 1),
  array(select permission || ' ' || scope from agenda.role_permissions where role = 'reception' order by 1),
  'staff (o papel de hoje) = recepção');
select is(
  array(select permission || ' ' || scope from agenda.role_permissions where role = 'professional' order by 1),
  array['agenda.atender propria', 'agenda.pacientes propria', 'agenda.ver propria'],
  'profissional: só a própria agenda (sem pedidos antigos, que têm telefones)');
select is(
  array(select permission from agenda.role_permissions where role = 'finance' order by 1),
  array['financeiro.ver'], 'financeiro: só o financeiro (não vê nomes nem telefones)');
select is(
  array(select role from agenda.role_permissions where permission = 'pedidos.ver' order by 1),
  array['manager', 'owner', 'reception', 'staff'], 'pedidos antigos (com telefones): só dono, gestor e recepção');

/* ===================== B. has_clinic_perm ===================== */

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, u.confirmado,
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from (values
  ('a1100000-0000-4000-8000-000000000001'::uuid, 'dono.papeis@exemplo.test', now()),
  ('a1100000-0000-4000-8000-000000000002'::uuid, 'staff.papeis@exemplo.test', now()),
  ('a1100000-0000-4000-8000-000000000003'::uuid, 'fora.papeis@exemplo.test', now()),
  ('a1100000-0000-4000-8000-000000000004'::uuid, 'admin.papeis@exemplo.test', now()),
  ('a1100000-0000-4000-8000-000000000005'::uuid, 'operacao.papeis@exemplo.test', now()),
  ('a1100000-0000-4000-8000-000000000006'::uuid, 'suporte.papeis@exemplo.test', now()),
  ('a1100000-0000-4000-8000-000000000007'::uuid, 'revogado.papeis@exemplo.test', now()),
  ('a1100000-0000-4000-8000-000000000008'::uuid, 'celular.papeis@exemplo.test', now()),
  ('a1100000-0000-4000-8000-000000000009'::uuid, 'naoconfirmado.papeis@exemplo.test', null::timestamptz)
) as u (id, email, confirmado);
update auth.users set phone = '5511999990000' where id = 'a1100000-0000-4000-8000-000000000008';
insert into public.admin_emails (email) values ('admin.papeis@exemplo.test');
insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
values
  ('c1100000-0000-4000-8000-000000000001', 'Clínica dos Papéis', 'imagem', 'Rua dos Papéis, 1', 'São Paulo', 'SP',
   extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false),
  ('c1100000-0000-4000-8000-000000000002', 'Outra Clínica dos Papéis', 'imagem', 'Rua dos Papéis, 2', 'São Paulo', 'SP',
   extensions.st_setsrid(extensions.st_makepoint(-46.64, -23.56), 4326)::extensions.geography, 'published', true, false);
insert into public.clinic_members (clinic_id, user_id, role) values
  ('c1100000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001', 'owner'),
  ('c1100000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000002', 'staff');
insert into private.imed_staff (user_id, role, revoked_at) values
  ('a1100000-0000-4000-8000-000000000005', 'operacao', null),
  ('a1100000-0000-4000-8000-000000000006', 'suporte', null),
  ('a1100000-0000-4000-8000-000000000007', 'operacao', now()),
  ('a1100000-0000-4000-8000-000000000008', 'operacao', null),
  ('a1100000-0000-4000-8000-000000000009', 'operacao', null);

select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000001', 'dono.papeis@exemplo.test');
select ok(public.has_clinic_perm('c1100000-0000-4000-8000-000000000001', 'pedidos.ver')
          and public.has_clinic_perm('c1100000-0000-4000-8000-000000000001', 'integracao.gerenciar'),
          'dono: tem as permissões da própria clínica');
select ok(not public.has_clinic_perm('c1100000-0000-4000-8000-000000000002', 'pedidos.ver'),
          'dono: nada na clínica dos outros');
select ok(not public.has_clinic_perm('c1100000-0000-4000-8000-000000000001', 'permissao.inventada'),
          'permissão desconhecida: não');

select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000002', 'staff.papeis@exemplo.test');
select ok(public.has_clinic_perm('c1100000-0000-4000-8000-000000000001', 'pedidos.ver')
          and public.has_clinic_perm('c1100000-0000-4000-8000-000000000001', 'agenda.marcar'),
          'staff: lê pedidos e marca, como a recepção');
select is(
  array(select p from unnest(array['agenda.configurar', 'precos.editar', 'clinica.editar', 'equipe.gerenciar',
                                   'financeiro.ver', 'integracao.gerenciar', 'auditoria.ver']) p
        where public.has_clinic_perm('c1100000-0000-4000-8000-000000000001', p)),
  '{}'::text[], 'staff: não configura, não muda preço nem clínica, não gerencia equipe, financeiro, integração nem auditoria');

select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000003', 'fora.papeis@exemplo.test');
select ok(not public.has_clinic_perm('c1100000-0000-4000-8000-000000000001', 'pedidos.ver'),
          'quem não é membro: nenhuma permissão');

select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000004', 'admin.papeis@exemplo.test');
select ok(public.is_imed_admin() and not public.has_clinic_perm('c1100000-0000-4000-8000-000000000001', 'pedidos.ver'),
          'o admin do IMED não vira membro de clínica (has_clinic_perm é só papel na clínica; a equipe usa imed_has)');

-- Escopo: has_clinic_perm só vale para a clínica inteira; o escopo parcial sai em clinic_perm_scope.
select pg_temp.entrar('postgres');
insert into agenda.role_permissions (role, permission, scope) values ('staff', 'teste.parcial', 'propria');
select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000002', 'staff.papeis@exemplo.test');
select ok(not public.has_clinic_perm('c1100000-0000-4000-8000-000000000001', 'teste.parcial')
          and public.clinic_perm_scope('c1100000-0000-4000-8000-000000000001', 'teste.parcial') = 'propria',
          'permissão de escopo parcial (propria): has_clinic_perm nega; clinic_perm_scope diz o escopo');
select is(public.clinic_perm_scope('c1100000-0000-4000-8000-000000000001', 'pedidos.ver'), 'clinica',
          'clinic_perm_scope: staff lê pedidos da clínica inteira');
select pg_temp.entrar('postgres');
select is((select count(*)::int from agenda.audit_log where action = 'role_permissions_insert' and new_value ->> 'permission' = 'teste.parcial'),
          1, 'mudança na matriz de permissões fica na auditoria');
-- Conta sem e-mail confirmado ou banida: o papel não vale.
insert into public.clinic_members (clinic_id, user_id, role) values
  ('c1100000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000009', 'owner'),
  ('c1100000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000007', 'owner');
update auth.users set banned_until = now() + interval '1 day' where id = 'a1100000-0000-4000-8000-000000000007';
select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000009', 'naoconfirmado.papeis@exemplo.test');
select ok(not public.has_clinic_perm('c1100000-0000-4000-8000-000000000001', 'pedidos.ver'),
          'membro com e-mail não confirmado: nenhuma permissão');
select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000007', 'revogado.papeis@exemplo.test');
select ok(not public.has_clinic_perm('c1100000-0000-4000-8000-000000000001', 'pedidos.ver'),
          'membro banido: nenhuma permissão (mesmo com o token ainda válido)');
select pg_temp.entrar('postgres');
update auth.users set banned_until = null where id = 'a1100000-0000-4000-8000-000000000007';
delete from public.clinic_members where user_id in ('a1100000-0000-4000-8000-000000000009', 'a1100000-0000-4000-8000-000000000007');

select pg_temp.entrar('anon');
select throws_ok($$ select public.has_clinic_perm('c1100000-0000-4000-8000-000000000001', 'pedidos.ver') $$,
                 '42501', null, 'visitante (anon) não executa has_clinic_perm');

/* ===================== C. imed_has (equipe do IMED fora de admin_emails) ===================== */

select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000004', 'admin.papeis@exemplo.test');
select ok(public.imed_has('imed.pacientes.ver') and public.imed_has('imed.auditoria.ver') and public.imed_has('imed.equipe.gerenciar'),
          'o dono (is_imed_admin) tem todas as permissões da equipe');

select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000005', 'operacao.papeis@exemplo.test');
select ok(public.imed_has('imed.pacientes.ver') and public.imed_has('imed.agenda.operar') and public.imed_has('imed.agenda.monitor'),
          'operação: vê pacientes (com justificativa, 3.4), opera a agenda e monitora');
select is(
  array(select p from unnest(array['imed.auditoria.ver', 'imed.financeiro.ver', 'imed.equipe.gerenciar',
                                   'imed.parametros.editar', 'pedidos.ver']) p where public.imed_has(p)),
  '{}'::text[], 'operação: sem auditoria, financeiro, equipe, parâmetros globais nem permissão de clínica');
select ok(not public.is_imed_admin(), 'operação NÃO vira admin (is_imed_admin continua só do dono)');

select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000006', 'suporte.papeis@exemplo.test');
select ok(public.imed_has('imed.agenda.monitor') and not public.imed_has('imed.pacientes.ver')
          and not public.imed_has('imed.agenda.operar'),
          'suporte: monitora, sem dado de paciente e sem operar');

select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000007', 'revogado.papeis@exemplo.test');
select ok(not public.imed_has('imed.agenda.monitor'), 'papel revogado não vale');

select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000005', 'operacao.papeis@exemplo.test', 'password');
select ok(public.imed_has('imed.agenda.monitor'), 'sessão aberta com senha vale (entrada com senha, 05/11)');

select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000005', 'operacao.papeis@exemplo.test', 'anonymous');
select ok(not public.imed_has('imed.agenda.monitor'), 'sessão anônima não vale');

select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000005', 'outro.email@exemplo.test');
select ok(not public.imed_has('imed.agenda.monitor'), 'sessão com e-mail diferente do da conta não vale');

select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000008', 'celular.papeis@exemplo.test');
select ok(not public.imed_has('imed.agenda.monitor'), 'conta com celular (outra forma de entrar) não vale');

select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000009', 'naoconfirmado.papeis@exemplo.test');
select ok(not public.imed_has('imed.agenda.monitor'), 'conta com e-mail não confirmado não vale');

select throws_ok($$ select count(*) from private.imed_staff $$, '42501', null,
                 'quem está logado não alcança private.imed_staff');

select pg_temp.entrar('anon');
select throws_ok($$ select public.imed_has('imed.agenda.monitor') $$, '42501', null, 'visitante (anon) não executa imed_has');

select pg_temp.entrar('postgres');
select throws_ok($$ insert into private.imed_staff (user_id, role) values ('a1100000-0000-4000-8000-000000000003', 'dono') $$,
                 '23514', null, 'papel da equipe fora da lista é recusado');
select throws_ok($$ delete from private.imed_staff where user_id = 'a1100000-0000-4000-8000-000000000005' $$,
                 '42501', null, 'equipe do IMED: o acesso não se apaga (revogar = revoked_at)');
select throws_ok($$ truncate private.imed_staff $$, '42501', null, 'equipe do IMED: TRUNCATE recusado');
select is((select count(*)::int from agenda.audit_log where action = 'imed_staff_insert'), 5,
          'quem recebeu acesso da equipe do IMED fica na auditoria');
select throws_ok($$ insert into agenda.role_permissions (role, permission, scope) values ('owner', 'imed.agenda.monitor', 'clinica') $$,
                 '23514', null, 'papel de clínica não recebe permissão da equipe do IMED (e vice-versa)');

/* ===================== D. A máquina de estados (§5) ===================== */

select is(
  array(select distinct t.permission from agenda.status_transitions t where t.actor_kind = 'clinica'
        except select r.permission from agenda.role_permissions r where r.role not like 'imed\_%' order by 1),
  '{}'::text[], 'toda permissão de clínica usada nas transições existe na matriz de papéis');
select is(
  array(select distinct t.permission from agenda.status_transitions t where t.actor_kind = 'imed'
        except select r.permission from agenda.role_permissions r where r.role like 'imed\_%' order by 1),
  '{}'::text[], 'toda permissão da equipe usada nas transições existe na matriz de papéis');
select is(
  array(select s from unnest(array['pending', 'contacted', 'hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service',
                                   'completed', 'no_show', 'reschedule_requested', 'cancelled', 'expired']) s
        where not exists (select 1 from agenda.status_transitions t where t.to_status = s) order by 1),
  '{}'::text[], 'toda situação tem como ser alcançada');
select is(
  array(select t.from_status || '→' || t.to_status || ' ' || t.actor_kind from agenda.status_transitions t
        where t.from_status in ('completed', 'cancelled', 'expired') and t.actor_kind not in ('imed', 'sistema') order by 1),
  '{}'::text[], 'de concluído, cancelado ou expirado só sai a equipe do IMED (reabrir, corrigir) ou o sistema (pagamento atrasado)');
select is(
  array(select t.from_status || '→' || t.to_status || ' ' || t.actor_kind from agenda.status_transitions t
        -- I2 (§3.3): ocupam horário hold, awaiting_payment, confirmed, checked_in e in_service; as outras situações do
        -- agendamento com itens não ocupam (pending e contacted são o pedido antigo, sem ocupação)
        where t.to_status in ('hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service')
          and t.from_status not in ('pending', 'contacted', 'hold', 'awaiting_payment', 'confirmed', 'checked_in', 'in_service')
          and not t.needs_engine order by 1),
  '{}'::text[], 'toda transição que volta a ocupar horário (de uma situação sem ocupação) passa pelo motor completo');
select is((select concat_ws('|', permission, time_rule, requires_reason::text, needs_engine::text) from agenda.status_transitions
           where from_status = 'confirmed' and to_status = 'checked_in' and actor_kind = 'clinica'),
          'agenda.atender|janela_de_chegada|false|false', 'confirmado → chegou: atender, a partir da janela de chegada');
select is((select concat_ws('|', permission, time_rule, requires_reason::text) from agenda.status_transitions
           where from_status = 'confirmed' and to_status = 'no_show' and actor_kind = 'clinica'),
          'agenda.atender|depois_da_tolerancia|false', 'confirmado → faltou: só depois do início + tolerância');
select is((select concat_ws('|', permission, time_rule, requires_reason::text) from agenda.status_transitions
           where from_status = 'no_show' and to_status = 'checked_in' and actor_kind = 'clinica'),
          'agenda.atender|mesmo_dia|true', 'faltou → chegou: mesmo dia, com motivo');
select is((select needs_engine from agenda.status_transitions
           where from_status = 'no_show' and to_status = 'checked_in' and actor_kind = 'clinica'),
          true, 'faltou → chegou volta a ocupar o horário: pelo motor completo (pode já ter sido dado a outro paciente)');
select is((select concat_ws('|', coalesce(permission, '-'), time_rule) from agenda.status_transitions
           where from_status = 'confirmed' and to_status = 'cancelled' and actor_kind = 'paciente'),
          '-|prazo_cancelar_paciente', 'o paciente cancela até o prazo da unidade');
select is((select requires_reason from agenda.status_transitions
           where from_status = 'confirmed' and to_status = 'cancelled' and actor_kind = 'clinica'),
          true, 'a clínica cancela agendamento confirmado só com motivo');
select is((select concat_ws('|', coalesce(permission, '-'), coalesce(time_rule, '-'), needs_engine::text) from agenda.status_transitions
           where from_status = 'expired' and to_status = 'confirmed' and actor_kind = 'sistema'),
          '-|-|true', 'expirado → confirmado (pagamento atrasado): só o sistema, pelo motor completo');
select is(
  array(select t.actor_kind from agenda.status_transitions t where t.from_status = 'cancelled' and t.to_status = 'confirmed'),
  array['imed'], 'reabrir um cancelado: só a equipe do IMED');
select is(
  array(select t.from_status || '→' || t.to_status from agenda.status_transitions t
        where t.actor_kind = 'paciente' and t.to_status not in ('pending', 'confirmed', 'hold', 'awaiting_payment',
                                                                  'cancelled', 'reschedule_requested') order by 1),
  '{}'::text[], 'o paciente nunca marca chegada, atendimento, conclusão ou falta');
select throws_ok($$ insert into agenda.status_transitions (from_status, to_status, actor_kind, permission)
                    values ('pending', 'completed', 'clinica', null) $$,
                 '23514', null, 'transição da clínica sem permissão é recusada');
select throws_ok($$ insert into agenda.status_transitions (from_status, to_status, actor_kind, permission)
                    values ('pending', 'completed', 'paciente', 'agenda.atender') $$,
                 '23514', null, 'transição do paciente não leva permissão de papel');
select is((select count(*)::int from agenda.status_transitions), 60,
          'as 58 transições da arquitetura §5 + a da integração que solta a reserva (3.3) + a do sistema que solta a reserva sem cobrança (pagamento, P1)');

/* ===================== E. Referências fora do alcance da API ===================== */
select pg_temp.entrar('authenticated', 'a1100000-0000-4000-8000-000000000001', 'dono.papeis@exemplo.test');
select throws_ok($$ select count(*) from agenda.role_permissions $$, '42501', null,
                 'quem está logado não lê a referência de papéis direto (schema agenda fora da API)');
select pg_temp.entrar('anon');
select throws_ok($$ select count(*) from agenda.status_transitions $$, '42501', null,
                 'visitante não lê a máquina de estados direto');
select pg_temp.entrar('postgres');
select is((select count(*)::int from agenda.settings_global), 0,
          'parâmetros globais vazios até a decisão do dono (limites, decisão 25)');

select * from finish();
rollback;
