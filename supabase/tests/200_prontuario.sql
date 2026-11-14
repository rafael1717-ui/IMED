-- Prontuário (iMed Medical Workspace, fase 2; memory/projects/imed-workspace-arquitetura.md §4.1 a §4.6 e §4.10):
--   - schemas prontuario e catalogo fora da API (sem USAGE, tabelas com RLS, sem policy e sem permissão);
--   - funções ws_* e cat_cid_buscar só para quem está logado (nem anon, nem service_role);
--   - rascunho salvo no servidor com versão (conflito), conteúdo conferido (chaves, faixas, origem da medida, CID do
--     catálogo), finalizar grava medidas e diagnósticos e o hash encadeado; depois, só adendo;
--   - guardas: registro finalizado, medidas, diagnósticos, versões e trilhas não mudam nem se apagam (também em
--     session_replication_role = replica); adulteração aparece na conferência da cadeia;
--   - só o médico da consulta lê e escreve; outro médico e quem não tem vínculo recebem "forbidden" e a trilha guarda o
--     "negado"; a equipe médica só lê, com justificativa;
--   - rascunho esquecido vira "encerrada_sem_finalizar" (nunca "finalizada").
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test; nenhum dado de paciente real.
begin;
select plan(63);

create function pg_temp.entrar(p_papel text, p_usuario uuid default null, p_email text default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_papel = 'postgres' then ''
         else jsonb_strip_nulls(jsonb_build_object('role', p_papel, 'sub', p_usuario, 'email', p_email,
                'aud', case when p_usuario is not null then 'authenticated' end))::text
    end, true);
  perform set_config('role', p_papel, true);
end $$;

/* ===================== Dados do teste ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'medica.um@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'medico.dois@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'equipe.medica@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'paciente.qualquer@exemplo.test', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now());
insert into public.doctors (id, user_id, full_name, crm, crm_uf, status)
values ('d2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Médica de Teste Um', '100001', 'SP', 'approved'),
       ('d2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'Médico de Teste Dois', '100002', 'SP', 'approved');
insert into public.admin_emails (email) values ('equipe.medica@exemplo.test');
insert into public.tele_record_readers (email) values ('equipe.medica@exemplo.test');
insert into public.teleconsultations (id, token_hash, status, patient_name, patient_birthdate, patient_phone, reason,
                                      consent_version, consent_at, doctor_id, accepted_at, started_at, ended_at)
values
  ('c2000000-0000-4000-8000-000000000001', repeat('a', 64), 'in_call', 'Paciente de Teste Um', '1980-01-01', '11900000001',
   'Teste do prontuário', '2026-10-30.2', now(), 'd2000000-0000-4000-8000-000000000001', now() - interval '10 minutes', now() - interval '9 minutes', null),
  ('c2000000-0000-4000-8000-000000000002', repeat('b', 64), 'ended', 'Paciente de Teste Dois', '1990-01-01', '11900000002',
   'Teste do prontuário', '2026-10-30.2', now() - interval '3 days', 'd2000000-0000-4000-8000-000000000001',
   now() - interval '3 days', now() - interval '3 days', now() - interval '2 days'),
  ('c2000000-0000-4000-8000-000000000003', repeat('c', 64), 'ended', 'Paciente de Teste Três', '1995-01-01', '11900000003',
   'Teste do prontuário', '2026-10-30.2', now() - interval '1 hour', 'd2000000-0000-4000-8000-000000000001',
   now() - interval '1 hour', now() - interval '50 minutes', now() - interval '20 minutes');
select private.cid10_carregar(E'codigo\tcapitulo\trestr_sexo\tdescricao\tdescricao_abrev\n'
  || E'J06\t10\t\tInfecções agudas das vias aéreas superiores de localizações múltiplas e não especificadas\tInfec ag vias aer sup loc mult NE\n'
  || E'J069\t10\t\tInfecção aguda das vias aéreas superiores não especificada\tInfec aguda vias aereas super NE\n'
  || E'N40\t14\tM\tHiperplasia da próstata\tHiperplasia da prostata\n'
  || E'linha quebrada sem tab\n',
  'Amostra do teste (formato do arquivo do DATASUS)', 'teste');

/* ===================== A. Fora da API ===================== */
select is(array(select format('%s %s', s, r) from unnest(array['prontuario', 'catalogo']) s, unnest(array['anon', 'authenticated', 'service_role']) r
                where has_schema_privilege(r, s, 'USAGE') order by 1),
          '{}'::text[], 'schemas prontuario e catalogo sem USAGE para anon, authenticated e service_role');
select is(array(select n.nspname || '.' || c.relname
                       || case when not c.relrowsecurity then ' (sem RLS)' else '' end
                       || case when exists (select 1 from pg_policy po where po.polrelid = c.oid) then ' (com policy)' else '' end
                       || case when exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r
                                            where has_table_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
                                               or has_any_column_privilege(r, c.oid, 'SELECT, INSERT, UPDATE'))
                               then ' (com permissão para a API)' else '' end
                from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname in ('prontuario', 'catalogo') and c.relkind in ('r', 'p')
                  and (not c.relrowsecurity or exists (select 1 from pg_policy po where po.polrelid = c.oid)
                       or exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r
                                  where has_table_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
                                     or has_any_column_privilege(r, c.oid, 'SELECT, INSERT, UPDATE')))
                order by 1),
          '{}'::text[], 'tabelas do prontuário e do catálogo: RLS ligada, sem policy e sem permissão para a API');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname in ('prontuario', 'catalogo') and c.relkind in ('r', 'p')), 8, 'as 8 tabelas existem (7 do prontuário e do catálogo + os vínculos do Minha Saúde)');
select is(array(select p.oid::regprocedure::text || ' ' || r
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                     unnest(array['anon', 'service_role']) r
                where n.nspname = 'public' and (p.proname like 'ws\_%' or p.proname = 'cat_cid_buscar')
                  and has_function_privilege(r, p.oid, 'EXECUTE')
                order by 1),
          '{}'::text[], 'funções ws_* e cat_cid_buscar: nem anon nem service_role executam');
select is(array(select p.oid::regprocedure::text
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'private' and (p.proname like 'ws\_%' or p.proname like 'cid10\_%')
                  and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE')
                       or has_function_privilege('service_role', p.oid, 'EXECUTE'))
                order by 1),
          '{}'::text[], 'funções internas private.ws_* e private.cid10_* fora do alcance da API');
select is(array(select p.oid::regprocedure::text
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and (p.proname like 'ws\_%' or p.proname = 'cat_cid_buscar')
                  and (not p.prosecdef or not coalesce(p.proconfig, '{}') @> array['search_path=""'])
                order by 1),
          '{}'::text[], 'funções ws_* e cat_cid_buscar: SECURITY DEFINER com search_path vazio');
select is((select count(*)::integer from cron.job where jobname = 'imed-prontuario-encerra'), 1, 'job do rascunho esquecido agendado');

select pg_temp.entrar('anon');
select throws_ok($$ select public.ws_registro_abrir('c2000000-0000-4000-8000-000000000001') $$, '42501', null,
                 'visitante não chama as funções do prontuário');
select throws_ok($$ select public.cat_cid_buscar('garganta') $$, '42501', null, 'visitante não busca no catálogo');
select pg_temp.entrar('authenticated', 'a2000000-0000-4000-8000-000000000001');
select throws_ok($$ select count(*) from prontuario.evolucoes $$, '42501', null, 'médico não lê a tabela direto (só pelas funções)');
select throws_ok($$ select count(*) from catalogo.cid10 $$, '42501', null, 'nem o catálogo direto');

/* ===================== B. Catálogo CID-10 ===================== */
select pg_temp.entrar('postgres');
select is((select count(*)::integer from catalogo.cid10), 3, 'carga: só as linhas válidas entram (a quebrada fica de fora)');
select is((select restr_sexo from catalogo.cid10 where codigo = 'N40'), 'M', 'restrição por sexo vem do arquivo');
select pg_temp.entrar('authenticated', 'a2000000-0000-4000-8000-000000000001');
select is((select array_agg(x ->> 'codigo' order by x ->> 'codigo') from jsonb_array_elements(public.cat_cid_buscar('vias aereas superiores') -> 'itens') x),
          array['J06', 'J069'], 'busca por palavras, sem acento');
select is((select array_agg(x ->> 'codigo') from jsonb_array_elements(public.cat_cid_buscar('j06.9') -> 'itens') x),
          array['J069'], 'busca pelo código com ponto');
select is(public.cat_cid_buscar('x') -> 'itens', '[]'::jsonb, 'menos de 2 letras: nada');
select pg_temp.entrar('authenticated', 'a2000000-0000-4000-8000-000000000004');
select is(public.cat_cid_buscar('garganta') ->> 'erro', 'forbidden', 'quem não é médico aprovado não busca');

/* ===================== C. Rascunho, versões e conferência do conteúdo ===================== */
select pg_temp.entrar('authenticated', 'a2000000-0000-4000-8000-000000000001');
select is(public.ws_registro_abrir('c2000000-0000-4000-8000-000000000001') - 'assinatura',
          '{"acesso": "own", "adendos": [], "evolucao": null, "pode_adendo": false, "pode_editar": true}'::jsonb,
          'médico da consulta abre o registro vazio e pode editar');
select is(public.ws_registro_abrir('c2000000-0000-4000-8000-000000000001') ->> 'assinatura', 'registro não assinado digitalmente',
          'a resposta diz que o registro não é assinado digitalmente');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000001',
            '{"modo": "soap", "anamnese": {"queixa": "Dor de garganta"}, "exame": {"medidas": [{"tipo": "temperatura", "valor": 38.2, "quem_mediu": "paciente", "como_obtido": "relato"}]}}', 0) ->> 'versao',
          '1', 'primeiro salvamento cria o rascunho (versão 1)');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000001', '{"modo": "livre", "livre": "outra aba"}', 0) ->> 'erro',
          'versao_conflito', 'versão velha: versao_conflito (outra aba salvou antes)');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000001',
            '{"modo": "soap", "exame": {"medidas": [{"tipo": "fc", "valor": 80, "quem_mediu": "medico", "como_obtido": "contado_pelo_medico_no_video"}]}}', 1),
          '{"erro": "dados_invalidos", "campo": "medida.1.como_obtido"}'::jsonb, 'só a frequência respiratória pode ser contada pelo médico no vídeo');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000001',
            '{"modo": "soap", "exame": {"medidas": [{"tipo": "spo2", "valor": 140, "quem_mediu": "paciente", "como_obtido": "relato"}]}}', 1),
          '{"erro": "dados_invalidos", "campo": "medida.1.valor"}'::jsonb, 'valor fora da faixa plausível recusado');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000001',
            '{"modo": "soap", "exame": {"medidas": [{"tipo": "fc", "valor": 80, "quem_mediu": "paciente", "como_obtido": "aparelho_na_camera"}]}}', 1),
          '{"erro": "dados_invalidos", "campo": "medida.1.medido_em"}'::jsonb, 'aparelho na câmera exige a hora da medida');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000001',
            '{"modo": "soap", "exame": {"medidas": [{"tipo": "fc", "valor": 80, "quem_mediu": "paciente", "como_obtido": "integracao", "medido_em": "2026-11-03T10:00:00Z"}]}}', 1),
          '{"erro": "dados_invalidos", "campo": "medida.1.como_obtido"}'::jsonb, 'integração com aparelho ainda não existe: recusada');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000001',
            '{"modo": "soap", "exame": {"medidas": [{"tipo": "fc", "quem_mediu": "paciente", "como_obtido": "relato"}]}}', 1),
          '{"erro": "dados_invalidos", "campo": "medida.1.valor"}'::jsonb, 'medida sem valor recusada (nada se preenche sozinho)');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000001',
            '{"modo": "soap", "diagnosticos": [{"cid": "Z999", "descricao": "Inexistente", "papel": "principal", "situacao": "suspeito"}]}', 1),
          '{"erro": "dados_invalidos", "campo": "cid_desconhecido"}'::jsonb, 'CID fora do catálogo recusado');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000001', '{"modo": "soap", "prescricao": "x"}', 1),
          '{"erro": "dados_invalidos", "campo": "prescricao"}'::jsonb, 'chave fora do modelo recusada');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000001',
            '{"modo": "soap", "anamnese": {"queixa": "Dor de garganta há 3 dias"}, "soap": {"s": "Dor ao engolir", "a": "Provável IVAS"},
              "livre": "Texto escrito antes no modo livre",
              "exame": {"geral": "Corado, sem esforço respiratório no vídeo",
                        "medidas": [{"tipo": "temperatura", "valor": 38.2, "quem_mediu": "paciente", "como_obtido": "relato"},
                                    {"tipo": "fr", "valor": 18, "quem_mediu": "medico", "como_obtido": "contado_pelo_medico_no_video"}]},
              "diagnosticos": [{"cid": "J069", "descricao": "Infecção aguda das vias aéreas superiores não especificada", "papel": "principal", "situacao": "suspeito"},
                               {"cid": null, "descricao": "Faringite estreptocócica", "papel": "hipotese", "situacao": "descartado"}],
              "conduta": "Sintomáticos e retorno se piorar"}', 1) ->> 'versao',
          '2', 'segundo salvamento: versão 2 (SOAP e texto livre guardados juntos)');
select is(public.ws_registro_versao('c2000000-0000-4000-8000-000000000001', 1) #>> '{conteudo,anamnese,queixa}', 'Dor de garganta',
          'a versão 1 continua no histórico de versões');

/* ===================== D. Outro médico, sem vínculo e equipe ===================== */
select pg_temp.entrar('authenticated', 'a2000000-0000-4000-8000-000000000002');
select is(public.ws_registro_abrir('c2000000-0000-4000-8000-000000000001'), '{"erro": "forbidden"}'::jsonb, 'outro médico não abre');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000001', '{"modo": "livre", "livre": "x"}', 2), '{"erro": "forbidden"}'::jsonb,
          'outro médico não grava');
select is(public.ws_registro_abrir('c2000000-0000-4000-8000-0000000000ff'), '{"erro": "forbidden"}'::jsonb,
          'consulta inexistente: a mesma resposta (não revela se existe)');
select pg_temp.entrar('authenticated', 'a2000000-0000-4000-8000-000000000003', 'equipe.medica@exemplo.test');
select is(public.ws_registro_abrir('c2000000-0000-4000-8000-000000000001') ->> 'erro', 'justificativa', 'equipe sem justificativa: recusado');
select is(public.ws_registro_abrir('c2000000-0000-4000-8000-000000000001', 'auditoria') ->> 'pode_editar', 'false',
          'equipe com justificativa lê, sem editar');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000001', '{"modo": "livre"}', 2) ->> 'erro', 'justificativa',
          'equipe não grava');
select pg_temp.entrar('postgres');
select is((select array_agg(format('%s %s %s', fn, resultado, coalesce(motivo, '-')) order by id)
           from prontuario.trilha_acesso where resultado = 'negado'),
          array['ws_registro_abrir negado sem_vinculo', 'ws_registro_salvar negado sem_vinculo', 'ws_registro_abrir negado sem_vinculo',
                'ws_registro_abrir negado sem_justificativa', 'ws_registro_salvar negado sem_justificativa'],
          'cada acesso negado ficou na trilha');
select ok((select count(*) from prontuario.trilha_acesso where resultado = 'permitido' and fn = 'ws_registro_salvar') >= 9,
          'cada chamada permitida também ficou na trilha');

/* ===================== E. Finalizar, imutável, adendo e cadeia ===================== */
select pg_temp.entrar('authenticated', 'a2000000-0000-4000-8000-000000000001');
select is(public.ws_registro_finalizar('c2000000-0000-4000-8000-000000000001', 1) ->> 'erro', 'versao_conflito',
          'finalizar com versão velha: versao_conflito');
select is(public.ws_registro_finalizar('c2000000-0000-4000-8000-000000000001', 2) #>> '{evolucao,situacao}', 'finalizada', 'finaliza');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000001', '{"modo": "livre", "livre": "mudar"}', 2) ->> 'erro',
          'ja_finalizado', 'depois de finalizar, o rascunho não muda');
select is(public.ws_registro_abrir('c2000000-0000-4000-8000-000000000001') ->> 'pode_adendo', 'true', 'pode acrescentar adendo');
select is(public.ws_adendo_criar('c2000000-0000-4000-8000-000000000001', 'ok') ->> 'erro', 'dados_invalidos', 'adendo vazio ou curto recusado');
select ok((public.ws_adendo_criar('c2000000-0000-4000-8000-000000000001', 'Paciente retornou o contato: sem febre.') ->> 'hash') ~ '^[0-9a-f]{64}$',
          'adendo finalizado na hora, com hash');
select is(jsonb_array_length(public.ws_registro_abrir('c2000000-0000-4000-8000-000000000001') -> 'adendos'), 1, 'o adendo aparece com o registro');
select is((select array_agg(x ->> 'tipo' order by x ->> 'tipo') from jsonb_array_elements(public.ws_registro_historico('c2000000-0000-4000-8000-000000000001') -> 'eventos') x
           where x ->> 'tipo' in ('adendo', 'finalizado', 'diagnostico')),
          array['adendo', 'diagnostico', 'diagnostico', 'finalizado'], 'linha do tempo: finalização, diagnósticos e adendo');
select pg_temp.entrar('postgres');
select is((select array_agg(format('%s %s %s', m.tipo, m.quem_mediu, m.como_obtido) order by m.ordem) from prontuario.medidas m
           join prontuario.evolucoes e on e.id = m.evolucao_id where e.teleconsulta_id = 'c2000000-0000-4000-8000-000000000001'),
          array['temperatura paciente relato', 'fr medico contado_pelo_medico_no_video'], 'medidas gravadas com a origem de cada número');
select is((select array_agg(coalesce(d.cid, '-') || ' ' || d.papel || ' ' || d.situacao order by d.ordem) from prontuario.diagnosticos d
           join prontuario.evolucoes e on e.id = d.evolucao_id where e.teleconsulta_id = 'c2000000-0000-4000-8000-000000000001'),
          array['J069 principal suspeito', '- hipotese descartado'], 'diagnósticos gravados como o médico escolheu');
select is((select array_agg(operacao order by id) from prontuario.trilha_escrita where teleconsulta_id = 'c2000000-0000-4000-8000-000000000001'),
          array['criar_rascunho', 'salvar_rascunho', 'finalizar', 'adendo'], 'trilha de escrita de cada gravação');
select throws_ok($$ update prontuario.evolucoes set conteudo = '{}' where teleconsulta_id = 'c2000000-0000-4000-8000-000000000001' and tipo = 'evolucao' $$,
                 'P0001', null, 'registro finalizado não muda, nem para o dono do banco');
select throws_ok($$ delete from prontuario.medidas $$, 'P0001', null, 'medidas não se apagam');
select throws_ok($$ update prontuario.diagnosticos set situacao = 'confirmado' $$, 'P0001', null, 'diagnósticos não mudam');
select throws_ok($$ truncate prontuario.trilha_acesso $$, 'P0001', null, 'trilha não se esvazia');
select throws_ok($$ delete from prontuario.evolucao_versoes $$, 'P0001', null, 'versões não se apagam');
select throws_ok($$ set local session_replication_role = replica; update prontuario.evolucoes set conteudo = '{}' where tipo = 'evolucao' $$,
                 'P0001', null, 'guarda vale também em session_replication_role = replica');
reset session_replication_role;
select throws_ok($$ insert into prontuario.medidas (evolucao_id, ordem, tipo, valor, unidade, quem_mediu, como_obtido, registrado_por)
                    select id, 9, 'fc', 80, 'bpm', 'paciente', 'relato', medico_id from prontuario.evolucoes
                    where teleconsulta_id = 'c2000000-0000-4000-8000-000000000001' and tipo = 'evolucao' $$,
                 'P0001', null, 'nenhuma medida entra depois de finalizar');

/* ===================== F. Rascunho esquecido e conferência da cadeia ===================== */
insert into prontuario.evolucoes (teleconsulta_id, medico_id, tipo, situacao, conteudo)
values ('c2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'evolucao', 'rascunho', '{"modo": "livre", "livre": "Rascunho esquecido"}');
select is(private.ws_encerrar_rascunhos(), 1, 'rascunho de consulta fora do prazo é encerrado');
select is((select situacao from prontuario.evolucoes where teleconsulta_id = 'c2000000-0000-4000-8000-000000000002'),
          'encerrada_sem_finalizar', 'encerrado sem finalizar (nunca "finalizada" pelo sistema)');
select pg_temp.entrar('authenticated', 'a2000000-0000-4000-8000-000000000001');
select is(public.ws_registro_salvar('c2000000-0000-4000-8000-000000000003', '{"modo": "livre", "livre": "Encerrada há 20 minutos"}', 0) ->> 'versao', '1',
          'consulta encerrada há menos de 24 h ainda aceita o registro');
select is(public.ws_registro_finalizar('c2000000-0000-4000-8000-000000000002', 1) ->> 'erro', 'prazo_encerrado',
          'fora do prazo de 24 h não finaliza');
select pg_temp.entrar('authenticated', 'a2000000-0000-4000-8000-000000000003', 'equipe.medica@exemplo.test');
select is(public.ws_integridade_conferir() -> 'quebras', '[]'::jsonb, 'cadeia de hash íntegra');
select pg_temp.entrar('postgres');
alter table prontuario.evolucoes disable trigger evolucoes_guard;
update prontuario.evolucoes set conteudo = jsonb_set(conteudo, '{conduta}', '"adulterado"')
 where teleconsulta_id = 'c2000000-0000-4000-8000-000000000001' and tipo = 'evolucao';
alter table prontuario.evolucoes enable always trigger evolucoes_guard;
select pg_temp.entrar('authenticated', 'a2000000-0000-4000-8000-000000000003', 'equipe.medica@exemplo.test');
select is(jsonb_array_length(public.ws_integridade_conferir() -> 'quebras'), 1, 'adulteração por fora das funções aparece na conferência');
select pg_temp.entrar('authenticated', 'a2000000-0000-4000-8000-000000000001');
select is(public.ws_integridade_conferir() ->> 'erro', 'forbidden', 'médico não confere a cadeia inteira');

select * from finish();
rollback;
