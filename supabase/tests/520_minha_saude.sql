-- "Minha Saúde", etapa 1 (arquitetura do prontuário §6.5 e regra R4-b): o paciente logado guarda a teleconsulta na
-- conta dele e abre os DOCUMENTOS dela em outro aparelho. Só isso.
--   A. estrutura: tabela fechada; quem executa o quê; guardar nasce DESLIGADO;
--   B. guardar: só com o código do aparelho; código errado, consulta que não existe e consulta apagada dão a MESMA
--      resposta; uma consulta fica em uma conta só; 10 erros em 1 hora travam;
--   C. ler: só o dono do vínculo; a lista de consultas não traz conteúdo; documentos e PDF exigem entrada há menos de
--      12 horas; cancelado não se baixa; documento de outra consulta não se baixa;
--   D. tirar da conta corta o acesso na hora e libera a consulta para ser guardada de novo;
--   E. médico, outra conta e visitante não leem; tudo fica na trilha de acesso (permitido e negado).
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test; nomes fictícios.
begin;
select plan(46);

-- p_ha: há quanto tempo foi a entrada (o "amr" do token guarda a hora em que a pessoa provou quem é)
create function pg_temp.entrar(p_papel text, p_usuario uuid default null, p_email text default null, p_ha interval default '5 minutes')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_papel = 'postgres' then ''
         else jsonb_strip_nulls(jsonb_build_object(
                'role', p_papel, 'sub', p_usuario, 'email', p_email,
                'aud', case when p_usuario is not null then 'authenticated' end,
                'amr', case when p_usuario is not null and p_ha is not null then jsonb_build_array(jsonb_build_object(
                         'method', 'password', 'timestamp', extract(epoch from now() - p_ha)::bigint)) end))::text
    end, true);
  perform set_config('role', p_papel, true);
end $$;
create function pg_temp.u(n integer) returns uuid language sql immutable as $$ select ('a5200000-0000-4000-8000-00000000000' || n)::uuid $$;
create function pg_temp.c(n integer) returns uuid language sql immutable as $$ select ('c5200000-0000-4000-8000-00000000000' || n)::uuid $$;
create function pg_temp.d(n integer) returns uuid language sql immutable as $$ select ('d5200000-0000-4000-8000-00000000000' || n)::uuid $$;
create function pg_temp.codigo(n integer) returns text language sql immutable as $$ select repeat(n::text, 64) $$;
create function pg_temp.ana(p_ha interval default '5 minutes') returns void language sql as $$
  select pg_temp.entrar('authenticated', pg_temp.u(1), 'ana.saude@exemplo.test', p_ha) $$;
create function pg_temp.bia() returns void language sql as $$ select pg_temp.entrar('authenticated', pg_temp.u(2), 'bia.saude@exemplo.test') $$;
create function pg_temp.medica() returns void language sql as $$ select pg_temp.entrar('authenticated', pg_temp.u(3), 'medica.saude@exemplo.test') $$;
create function pg_temp.trilha(p_fn text, p_resultado text, p_motivo text default null) returns integer language sql stable as $$
  select count(*)::integer from prontuario.trilha_acesso a
  where a.fn = p_fn and a.resultado = p_resultado and a.motivo is not distinct from p_motivo and a.papel = 'paciente' $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated', e || '.saude@exemplo.test',
       case when n <> 4 then now() end, '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from (values (1, 'ana'), (2, 'bia'), (3, 'medica'), (4, 'semconfirmar')) x (n, e);
insert into public.doctors (id, user_id, full_name, crm, crm_uf, status)
values ('e5200000-0000-4000-8000-000000000001', pg_temp.u(3), 'Médica de Teste da Saúde', '152001', 'SP', 'approved');
insert into public.teleconsultations (id, token_hash, status, patient_name, patient_birthdate, patient_phone, reason, consent_version, consent_at,
                                      doctor_id, doctor_info, accepted_at, started_at, ended_at, notes, anonymized_at)
select pg_temp.c(n), encode(extensions.digest(pg_temp.codigo(n), 'sha256'), 'hex'), 'ended', 'Paciente de Teste ' || n, '1980-01-01', '1190000520' || n,
       'Motivo reservado ' || n, '2026-10-30.2', now() - interval '3 days', 'e5200000-0000-4000-8000-000000000001',
       '{"full_name": "Médica de Teste da Saúde", "crm": "152001", "crm_uf": "SP", "rqe": null, "specialty": "Clínica médica"}', now() - interval '3 days', now() - interval '3 days',
       now() - make_interval(days => n), 'Anotação reservada do médico', null
from generate_series(1, 2) n;
-- a 3ª é um pedido que nenhum médico atendeu e já foi apagado (só esse tipo é apagado: regra da teleconsulta)
insert into public.teleconsultations (id, token_hash, status, consent_version, consent_at, anonymized_at)
values (pg_temp.c(3), encode(extensions.digest(pg_temp.codigo(3), 'sha256'), 'hex'), 'expired', '2026-10-30.2', now() - interval '40 days', now());
insert into public.tele_documents (id, consultation_id, doctor_id, kind, payload, code, status, cancel_reason, cancelled_by, cancelled_at, signed_at,
                                   doctor_snapshot, patient_snapshot)
values
  (pg_temp.d(1), pg_temp.c(1), 'e5200000-0000-4000-8000-000000000001', 'receita', '{"itens": ["conteúdo reservado da receita"]}', '2222222222', 'emitido', null, null, null, now(), '{}', '{}'),
  (pg_temp.d(2), pg_temp.c(1), 'e5200000-0000-4000-8000-000000000001', 'atestado', '{"texto": "conteúdo reservado do atestado"}', '3333333333', 'emitido', null, null, null, null, '{}', '{}'),
  (pg_temp.d(3), pg_temp.c(1), 'e5200000-0000-4000-8000-000000000001', 'exames', '{"exames": ["reservado"]}', '4444444444', 'cancelado', 'emitido por engano', 'Médica de Teste', now(), now(), '{}', '{}'),
  (pg_temp.d(4), pg_temp.c(2), 'e5200000-0000-4000-8000-000000000001', 'receita', '{"itens": ["outra consulta"]}', '5555555555', 'emitido', null, null, null, now(), '{}', '{}');
insert into public.tele_document_files (document_id, pdf, size, sha256)
select d, pdf, octet_length(pdf), encode(extensions.digest(pdf, 'sha256'), 'hex')
from (values (pg_temp.d(1), convert_to('%PDF-1.7 receita de teste', 'UTF8')), (pg_temp.d(3), convert_to('%PDF-1.7 pedido cancelado', 'UTF8')),
             (pg_temp.d(4), convert_to('%PDF-1.7 outra consulta', 'UTF8'))) x (d, pdf);

/* ===================== A. Estrutura ===================== */
select is((select c.relrowsecurity::text || '|' || (select count(*) from pg_policy p where p.polrelid = c.oid)
           from pg_class c where c.oid = 'prontuario.saude_vinculos'::regclass), 'true|0', 'prontuario.saude_vinculos: RLS ligada e nenhuma policy');
select is(array(select r from unnest(array['anon', 'authenticated', 'service_role']) r
                where has_table_privilege(r, 'prontuario.saude_vinculos', 'SELECT, INSERT, UPDATE, DELETE')),
          '{}'::text[], 'ninguém da API lê nem escreve na tabela dos vínculos');
select is(array(select p.proname::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'saude\_%'
                and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
                and p.prosecdef and p.proconfig @> array['search_path=""'] order by 1),
          array['saude_documento_pdf', 'saude_documentos', 'saude_guardar', 'saude_minhas_consultas', 'saude_vinculo_revogar'],
          'as 5 funções: só quem tem conta executa (o visitante não), SECURITY DEFINER com search_path vazio');
select is(array(select p.proname::text from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'saude\_%'
                and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     or has_function_privilege('service_role', p.oid, 'EXECUTE'))),
          '{}'::text[], 'as funções internas não são executáveis por nenhum papel da API');
select ok(not private.saude_guardar_ligado() and not exists (select 1 from private.app_settings where key = 'saude_guardar'),
          'guardar na conta nasce DESLIGADO');

/* ===================== B. Guardar ===================== */
select pg_temp.ana();
select is(public.saude_guardar(pg_temp.c(1), pg_temp.codigo(1)), '{"status": "off"}'::jsonb, 'desligado: mesmo com o código certo, responde "off"');
select pg_temp.entrar('postgres');
select is((select count(*)::int from prontuario.saude_vinculos), 0, 'e nada é gravado');
insert into private.app_settings (key, value) values ('saude_guardar', 'ligado');

select pg_temp.entrar('authenticated', pg_temp.u(4), 'semconfirmar.saude@exemplo.test');
select is(public.saude_guardar(pg_temp.c(1), pg_temp.codigo(1)) ->> 'status', 'forbidden', 'conta sem e-mail confirmado: não guarda');
select pg_temp.ana();
select is(array[public.saude_guardar(null, pg_temp.codigo(1)) ->> 'status', public.saude_guardar(pg_temp.c(1), null) ->> 'status',
                public.saude_guardar(pg_temp.c(1), 'curto') ->> 'status', public.saude_guardar(pg_temp.c(1), repeat('Z', 64)) ->> 'status'],
          array['invalid', 'invalid', 'invalid', 'invalid'], 'sem consulta ou com código fora do formato: invalid');
select is(array[public.saude_guardar(pg_temp.c(1), pg_temp.codigo(2)) ->> 'status',          -- código de outra consulta
                public.saude_guardar(gen_random_uuid(), pg_temp.codigo(1)) ->> 'status',      -- consulta que não existe
                public.saude_guardar(pg_temp.c(3), pg_temp.codigo(3)) ->> 'status'],          -- consulta apagada (anonimizada)
          array['not_found', 'not_found', 'not_found'],
          'código errado, consulta que não existe e consulta apagada: a mesma resposta (não revela se a consulta existe)');
select is(public.saude_guardar(pg_temp.c(1), pg_temp.codigo(1)), '{"status": "ok"}'::jsonb, 'com o código do aparelho: guarda');
select is(public.saude_guardar(pg_temp.c(1), pg_temp.codigo(1)), '{"status": "ok", "unchanged": true}'::jsonb, 'guardar de novo: nada muda');
select pg_temp.bia();
select is(public.saude_guardar(pg_temp.c(1), pg_temp.codigo(1)) ->> 'status', 'already_linked',
          'outra conta com o mesmo código: a consulta já está guardada em uma conta');
select pg_temp.entrar('postgres');
select is((select string_agg(v.user_id::text || '|' || v.alcance || '|' || v.prova || '|' || (v.revogado_em is null), ',') from prontuario.saude_vinculos v),
          pg_temp.u(1)::text || '|consulta|codigo_do_aparelho|true', 'um vínculo só, da conta que provou o código, com alcance "consulta"');
select is(array[pg_temp.trilha('saude_guardar', 'permitido'), pg_temp.trilha('saude_guardar', 'negado', 'codigo_errado'),
                pg_temp.trilha('saude_guardar', 'negado', 'ja_guardada_em_outra_conta')], array[1, 3, 1],
          'a trilha guarda o que foi permitido e o que foi negado, com o motivo');
-- 10 códigos errados em 1 hora: a conta espera
select pg_temp.bia();
select count(public.saude_guardar(pg_temp.c(2), pg_temp.codigo(9))) from generate_series(1, 10);
select is(public.saude_guardar(pg_temp.c(2), pg_temp.codigo(2)) ->> 'status', 'too_many', 'depois de 10 códigos errados em 1 hora, nem o código certo passa');
select pg_temp.entrar('postgres');
select is((select count(*)::int from prontuario.saude_vinculos where teleconsulta_id = pg_temp.c(2)), 0, 'e a consulta não foi guardada');
select throws_ok($$ insert into prontuario.saude_vinculos (user_id, teleconsulta_id) values (pg_temp.u(2), pg_temp.c(1)) $$, '23505', null,
                 'o banco recusa a mesma consulta em duas contas ao mesmo tempo');

/* ===================== C. Ler ===================== */
select pg_temp.ana();
select set_config('teste.lista', public.saude_minhas_consultas()::text, true);
select is(current_setting('teste.lista')::jsonb - 'items', '{"status": "ok", "can_save": true, "recent": true}'::jsonb,
          'a lista diz se dá para guardar e se a entrada é recente');
select is(jsonb_array_length(current_setting('teste.lista')::jsonb -> 'items'), 1, 'a Ana vê a consulta que guardou');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(current_setting('teste.lista')::jsonb -> 'items' -> 0) k),
          'consultation_id,consultation_status,created_at,doctor,documents,ended_at,saved_at',
          'cada consulta traz só: quando, a situação, o médico e quantos documentos');
select is(current_setting('teste.lista')::jsonb -> 'items' -> 0 -> 'doctor', '{"name": "Médica de Teste da Saúde", "crm": "152001", "crm_uf": "SP"}'::jsonb,
          'o médico: só o nome e o CRM (sem a especialidade nem outro campo da foto do médico)');
select is((current_setting('teste.lista')::jsonb -> 'items' -> 0 ->> 'documents')::int, 2, 'conta os documentos que valem (o cancelado não)');
select ok(current_setting('teste.lista') !~ '(Paciente de Teste|Motivo reservado|Anotação reservada|1190000520|conteúdo reservado)',
          'nada do conteúdo da consulta, do nome ou do telefone na lista');
select set_config('teste.docs', public.saude_documentos(pg_temp.c(1))::text, true);
select is((select string_agg((i ->> 'kind') || '/' || (i ->> 'document_status') || '/' || (i ->> 'signed') || '/' || (i ->> 'has_pdf'), ' ')
           from jsonb_array_elements(current_setting('teste.docs')::jsonb -> 'items') i),
          'receita/emitido/true/true atestado/emitido/false/false exames/cancelado/true/true',
          'os documentos da consulta: tipo, situação, se está assinado e se tem PDF');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(current_setting('teste.docs')::jsonb -> 'items' -> 0) k),
          'cancel_reason,cancelled_at,code,created_at,document_status,has_pdf,id,kind,signed,signed_at',
          'sem o conteúdo do documento (payload) e sem os dados do paciente');
select ok(current_setting('teste.docs') !~ 'reservad', 'nenhum texto do documento na lista');
select is(convert_from(decode(public.saude_documento_pdf(pg_temp.d(1)) ->> 'pdf', 'base64'), 'UTF8'), '%PDF-1.7 receita de teste',
          'o PDF assinado vem inteiro');
select is(public.saude_documento_pdf(pg_temp.d(1)) - 'pdf', '{"status": "ok", "kind": "receita", "code": "2222222222"}'::jsonb, 'com o tipo e o código de conferência');
select is(array[public.saude_documento_pdf(pg_temp.d(2)) ->> 'status', public.saude_documento_pdf(pg_temp.d(3)) ->> 'status',
                public.saude_documento_pdf(pg_temp.d(4)) ->> 'status', public.saude_documento_pdf(gen_random_uuid()) ->> 'status',
                public.saude_documentos(pg_temp.c(2)) ->> 'status', public.saude_documentos(null) ->> 'status'],
          array['no_pdf', 'cancelled', 'not_found', 'not_found', 'not_found', 'not_found'],
          'sem PDF ainda: no_pdf; cancelado: não se baixa; documento ou consulta que a conta não guardou: not_found');
-- entrada antiga (13 horas): a lista de consultas aparece, os documentos pedem para entrar de novo
select pg_temp.ana('13 hours');
select is((public.saude_minhas_consultas() ->> 'recent') || '|' || jsonb_array_length(public.saude_minhas_consultas() -> 'items'), 'false|1',
          'entrada há 13 horas: a lista de consultas aparece e avisa que a entrada é antiga');
select is(array[public.saude_documentos(pg_temp.c(1)) ->> 'status', public.saude_documento_pdf(pg_temp.d(1)) ->> 'status'], array['reauth', 'reauth'],
          'documentos e PDF: "entre de novo"');
select ok(public.saude_documento_pdf(pg_temp.d(1)) -> 'pdf' is null, 'e o PDF não vem');
select pg_temp.entrar('authenticated', pg_temp.u(1), 'ana.saude@exemplo.test', null);
select is(public.saude_documentos(pg_temp.c(1)) ->> 'status', 'reauth', 'token sem a hora da entrada: não vale como entrada recente');
select pg_temp.ana('11 hours');
select is(public.saude_documentos(pg_temp.c(1)) ->> 'status', 'ok', 'entrada há 11 horas: vale');

/* ===================== E. Outras pessoas ===================== */
select pg_temp.bia();
select is(array[jsonb_array_length(public.saude_minhas_consultas() -> 'items')::text, public.saude_documentos(pg_temp.c(1)) ->> 'status',
                public.saude_documento_pdf(pg_temp.d(1)) ->> 'status', public.saude_vinculo_revogar(pg_temp.c(1)) ->> 'status'],
          array['0', 'not_found', 'not_found', 'not_found'], 'outra conta: não vê, não baixa e não tira o vínculo da Ana');
select pg_temp.medica();
select is(array[jsonb_array_length(public.saude_minhas_consultas() -> 'items')::text, public.saude_documentos(pg_temp.c(1)) ->> 'status',
                public.saude_documento_pdf(pg_temp.d(1)) ->> 'status'],
          array['0', 'not_found', 'not_found'], 'a médica da consulta não lê por aqui (o caminho dela é o registro, com a trilha dela)');
select throws_ok($$ select count(*) from prontuario.saude_vinculos $$, '42501', null, 'nem lê a tabela dos vínculos direto');
select pg_temp.entrar('anon');
select throws_ok($$ select public.saude_minhas_consultas() $$, '42501', null, 'o visitante nem executa as funções');
select pg_temp.entrar('authenticated', pg_temp.u(4), 'semconfirmar.saude@exemplo.test');
select is(array[public.saude_minhas_consultas() ->> 'status', public.saude_documentos(pg_temp.c(1)) ->> 'status',
                public.saude_documento_pdf(pg_temp.d(1)) ->> 'status', public.saude_vinculo_revogar(pg_temp.c(1)) ->> 'status'],
          array['forbidden', 'forbidden', 'forbidden', 'forbidden'], 'conta sem e-mail confirmado: nada');

/* ===================== D. Tirar da conta ===================== */
select pg_temp.ana();
select is(public.saude_vinculo_revogar(pg_temp.c(1)), '{"status": "ok"}'::jsonb, 'a Ana tira a consulta da conta');
select is(array[jsonb_array_length(public.saude_minhas_consultas() -> 'items')::text, public.saude_documentos(pg_temp.c(1)) ->> 'status',
                public.saude_documento_pdf(pg_temp.d(1)) ->> 'status', public.saude_vinculo_revogar(pg_temp.c(1)) ->> 'status'],
          array['0', 'not_found', 'not_found', 'not_found'], 'o acesso acaba na hora: a consulta some da lista e os documentos não abrem');
select is(public.saude_guardar(pg_temp.c(1), pg_temp.codigo(1)), '{"status": "ok"}'::jsonb, 'quem tem o código pode guardar de novo');
select pg_temp.entrar('postgres');
select is((select count(*) filter (where revogado_em is not null) || '|' || count(*) filter (where revogado_em is null)
           from prontuario.saude_vinculos where teleconsulta_id = pg_temp.c(1)), '1|1', 'o vínculo tirado fica guardado (sem valer) e o novo vale');
select is((select t.status || '|' || (t.notes is not null) || '|' || (select count(*) from public.tele_documents d where d.consultation_id = t.id)
           from public.teleconsultations t where t.id = pg_temp.c(1)), 'ended|true|3', 'a consulta, as anotações e os documentos não mudaram');

/* ===================== A trilha ===================== */
select ok(pg_temp.trilha('saude_documentos', 'permitido') >= 2 and pg_temp.trilha('saude_documento_pdf', 'permitido') >= 2
          and pg_temp.trilha('saude_documentos', 'negado', 'entrada_antiga') = 2 and pg_temp.trilha('saude_documento_pdf', 'negado', 'entrada_antiga') = 2
          and pg_temp.trilha('saude_documentos', 'negado', 'sem_vinculo') >= 3 and pg_temp.trilha('saude_documento_pdf', 'negado', 'sem_vinculo') >= 4
          and pg_temp.trilha('saude_vinculo_revogar', 'permitido') = 1 and pg_temp.trilha('saude_guardar', 'negado', 'muitas_tentativas') = 1,
          'cada leitura, cada recusa e a retirada ficaram na trilha de acesso');

select * from finish();
rollback;
