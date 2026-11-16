-- Receita completa, etapa 1 (arquitetura do prontuário §5; migração ws_receita):
--   A. estrutura: tabelas fechadas, quem executa o quê, a carga inicial da lista de controle e o gatilho;
--   B. a lista de controle: bate por palavra inteira, sem acento e sem maiúscula; só a equipe lança e retira; nada se
--      apaga; nome retirado deixa de travar;
--   C. o rascunho: só o médico da consulta; versão (duas abas = conflito); conteúdo conferido; fora do prazo não salva;
--   D. emitir: o que falta, a lista de controle (caminho novo E antigo), o endereço residencial, o mesmo documento da
--      receita simples, os itens gravados campo a campo, sem duplicar, e a receita emitida imutável;
--   E. modelos: só do próprio médico, sem consulta e sem paciente.
-- Tudo é desfeito no fim (rollback). E-mails no domínio reservado .test; nomes fictícios.
begin;
select plan(80);

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
create function pg_temp.u(n integer) returns uuid language sql immutable as $$ select ('a5300000-0000-4000-8000-00000000000' || n)::uuid $$;
create function pg_temp.c(n integer) returns uuid language sql immutable as $$ select ('c5300000-0000-4000-8000-00000000000' || n)::uuid $$;
create function pg_temp.medica() returns void language sql as $$ select pg_temp.entrar('authenticated', pg_temp.u(1), 'medica.receita@exemplo.test') $$;
create function pg_temp.medico2() returns void language sql as $$ select pg_temp.entrar('authenticated', pg_temp.u(2), 'medico2.receita@exemplo.test') $$;
create function pg_temp.equipe() returns void language sql as $$ select pg_temp.entrar('authenticated', pg_temp.u(3), 'equipe.receita@exemplo.test') $$;
create function pg_temp.paciente() returns void language sql as $$ select pg_temp.entrar('authenticated', pg_temp.u(4), 'paciente.receita@exemplo.test') $$;
create function pg_temp.dono() returns void language sql as $$ select pg_temp.entrar('postgres') $$;
-- o que o médico conferiu do paciente (tem de bater com a consulta)
create function pg_temp.conferido() returns jsonb language sql immutable as $$ select '{"sem_cpf": true, "endereco": "Rua de Teste, 100, Centro, Americana/SP"}'::jsonb $$;
create function pg_temp.item(p jsonb default '{}') returns jsonb language sql immutable as $$
  select '{"tipo": "industrializado", "medicamento": "Dipirona sódica", "concentracao": "500 mg", "forma": "comprimido", "dose": "1",
           "unidade": "comprimido", "via": "oral", "freq_modo": "intervalo", "freq_n": 6, "dur_modo": "dias", "dur_n": 7,
           "quantidade": "1 caixa com 30 comprimidos", "orientacoes": "Se a dor continuar, avise o médico.",
           "posologia": "Tomar 1 comprimido por via oral a cada 6 horas, por 7 dias.", "posologia_manual": false}'::jsonb || p $$;
create function pg_temp.manipulado(p jsonb default '{}') returns jsonb language sql immutable as $$
  select '{"tipo": "manipulado", "composicao": "Ureia 10%, creme base qsp 100 g", "forma": "creme", "via": "topica", "freq_modo": "vezes",
           "freq_n": 2, "dur_modo": "continuo", "quantidade": "1 pote com 100 g", "posologia": "Aplicar nas mãos 2 vezes ao dia.",
           "posologia_manual": true}'::jsonb || p $$;
create function pg_temp.receita(variadic p_itens jsonb[]) returns jsonb language sql immutable as $$
  select jsonb_build_object('itens', to_jsonb(p_itens), 'observacao', null) $$;
create function pg_temp.negados(p_fn text, p_motivo text) returns integer language sql stable security definer as $$
  select count(*)::integer from prontuario.trilha_acesso a where a.fn = p_fn and a.resultado = 'negado' and a.motivo = p_motivo $$;
create function pg_temp.docs(n integer) returns integer language sql stable security definer as $$
  select count(*)::integer from public.tele_documents d where d.consultation_id = pg_temp.c(n) $$;

/* ===================== Dados ===================== */
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated', e || '.receita@exemplo.test',
       now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
from (values (1, 'medica'), (2, 'medico2'), (3, 'equipe'), (4, 'paciente')) x (n, e);
insert into public.doctors (id, user_id, full_name, crm, crm_uf, status, prof_address, prof_contact)
values ('e5300000-0000-4000-8000-000000000001', pg_temp.u(1), 'Médica de Teste da Receita', '153001', 'SP', 'approved', 'Rua do Consultório de Teste, 10, Americana/SP', '19900005301'),
       ('e5300000-0000-4000-8000-000000000002', pg_temp.u(2), 'Médico Dois de Teste da Receita', '153002', 'SP', 'approved', 'Rua do Consultório de Teste, 20, Americana/SP', '19900005302');
insert into public.admin_emails (email) values ('equipe.receita@exemplo.test');
insert into public.tele_record_readers (email) values ('equipe.receita@exemplo.test');
-- 1: em atendimento, dados do paciente conferidos; 2: encerrada há 3 dias (fora do prazo); 3: encerrada há 1 hora (no prazo), sem endereço
insert into public.teleconsultations (id, token_hash, status, patient_name, patient_birthdate, patient_phone, reason, consent_version, consent_at,
                                      doctor_id, accepted_at, started_at, ended_at, patient_address, patient_no_cpf, identity_checked_at)
values
  (pg_temp.c(1), repeat('1', 64), 'in_call', 'Paciente de Teste da Receita Um', '1980-01-01', '11900005301', 'Teste da receita', '2026-10-30.2', now(),
   'e5300000-0000-4000-8000-000000000001', now() - interval '10 minutes', now() - interval '9 minutes', null, 'Rua de Teste, 100, Centro, Americana/SP', true, now() - interval '8 minutes'),
  (pg_temp.c(2), repeat('2', 64), 'ended', 'Paciente de Teste da Receita Dois', '1980-01-01', '11900005302', 'Teste da receita', '2026-10-30.2', now() - interval '3 days',
   'e5300000-0000-4000-8000-000000000001', now() - interval '3 days', now() - interval '3 days', now() - interval '3 days', 'Rua de Teste, 200, Centro, Americana/SP', true, now() - interval '3 days'),
  (pg_temp.c(3), repeat('3', 64), 'ended', 'Paciente de Teste da Receita Três', '1980-01-01', '11900005303', 'Teste da receita', '2026-10-30.2', now() - interval '2 hours',
   'e5300000-0000-4000-8000-000000000001', now() - interval '2 hours', now() - interval '110 minutes', now() - interval '1 hour', null, true, now() - interval '100 minutes');

/* ===================== A. Estrutura ===================== */
select is(array(select c.relname::text from pg_class c
                where c.oid in ('catalogo.med_regras'::regclass, 'prontuario.prescricoes'::regclass, 'prontuario.prescricao_itens'::regclass, 'prontuario.prescricao_modelos'::regclass)
                  and (not c.relrowsecurity or exists (select 1 from pg_policy p where p.polrelid = c.oid))),
          '{}'::text[], 'as 4 tabelas novas: RLS ligada e nenhuma policy');
select is(array(select t || ' ' || r from unnest(array['catalogo.med_regras', 'prontuario.prescricoes', 'prontuario.prescricao_itens', 'prontuario.prescricao_modelos']) t,
                       unnest(array['anon', 'authenticated', 'service_role']) r
                where has_table_privilege(r, t, 'SELECT, INSERT, UPDATE, DELETE')),
          '{}'::text[], 'ninguém da API lê nem escreve nas tabelas da receita e da lista');
select is(array(select p.oid::regprocedure::text || ' ' || r
                from pg_proc p, unnest(array['anon', 'service_role', 'public']) r
                where p.pronamespace = 'public'::regnamespace and (p.proname like 'ws\_receita\_%' or p.proname like 'cat\_regra%')
                  and case when r = 'public' then exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                           else has_function_privilege(r, p.oid, 'EXECUTE') end),
          '{}'::text[], 'ws_receita_* e cat_regra*: nem anon, nem service_role, nem PUBLIC executam');
select is((select count(*)::integer from pg_proc p where p.pronamespace = 'public'::regnamespace
           and (p.proname like 'ws\_receita\_%' or p.proname like 'cat\_regra%') and has_function_privilege('authenticated', p.oid, 'EXECUTE') and p.prosecdef),
          10, 'as 10 funções novas: só para quem está logado, SECURITY DEFINER');
select is(array(select p.proname::text from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'rx\_%'
                  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE'))),
          '{}'::text[], 'as funções private.rx_* não são de ninguém da API');
select is((select count(*)::integer || '|' || count(*) filter (where lista = 'antimicrobiano') || '|' || count(*) filter (where lista = 'glp1') || '|' || count(*) filter (where lista = 'portaria_344')
           from catalogo.med_regras where retirada_em is null and lancado_por is null),
          '40|15|11|14', 'carga inicial: os 40 nomes que a tela já avisa (15 antibióticos, 11 canetas GLP-1, 14 da Portaria 344)');
select is((select tgenabled::text || '|' || (tgtype & 2 > 0)::text || '|' || (tgtype & 4 > 0)::text from pg_trigger
           where tgrelid = 'public.tele_documents'::regclass and tgname = 'tele_documents_rx_lista'),
          'O|true|true', 'o gatilho da lista de controle está em public.tele_documents (antes de inserir)');
select is(array(select a.attname::text from pg_attribute a where a.attrelid = 'prontuario.prescricao_modelos'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum),
          array['id', 'medico_id', 'nome', 'conteudo', 'criado_em', 'atualizado_em', 'apagado_em'], 'o modelo não tem coluna de consulta nem de paciente');

/* ===================== B. A lista de controle ===================== */
select is(private.rx_conferir('[{"medicamento": "AMOXICILINA 500 mg"}, {"medicamento": "Paracetamol"}, {"medicamento": "Fórmula manipulada: Fluoxetina 20 mg, excipiente qsp"}]'),
          '[{"n": 1, "nome": "AMOXICILINA 500 mg", "termo": "amoxicilina", "lista": "antimicrobiano"}, {"n": 3, "nome": "Fórmula manipulada: Fluoxetina 20 mg, excipiente qsp", "termo": "fluoxetina", "lista": "portaria_344"}]'::jsonb,
          'a lista bate sem maiúscula, no meio do texto e no componente do manipulado; o que não é da lista passa');
select is(private.rx_conferir('[{"medicamento": "Semaglutída (Ozempic)"}, {"medicamento": "Frontalina"}, {"medicamento": "pré-valium"}, {"medicamento": 12}, "texto", null]'),
          '[{"n": 1, "nome": "Semaglutída (Ozempic)", "termo": "semaglutida", "lista": "glp1"}, {"n": 3, "nome": "pré-valium", "termo": "valium", "lista": "portaria_344"}]'::jsonb,
          'sem acento; só palavra inteira ("Frontalina" não é "frontal"); item estranho não quebra');
select is(private.rx_conferir(null), '[]'::jsonb, 'sem itens: nada bate');
select pg_temp.medica();
select is(public.cat_regra_lancar('Tramadol', 'portaria_344', 'Fonte de teste, lista A2') ->> 'erro', 'forbidden', 'médico não lança nome na lista');
select is(public.cat_regra_listar() ->> 'erro', 'forbidden', 'médico não lê a lista inteira (fonte e retirados)');
select is(jsonb_array_length(public.cat_regras_receita() -> 'itens'), 40, 'médico lê os nomes vigentes (para a tela marcar o item)');
select is((public.cat_regras_receita() -> 'itens' -> 0)::text, '{"nome": "amoxicilina", "lista": "antimicrobiano"}', 'só o nome e a lista, sem a fonte');
select pg_temp.paciente();
select is(public.cat_regras_receita() ->> 'erro', 'forbidden', 'quem não é médico nem equipe não lê a lista');
select pg_temp.equipe();
select is(public.cat_regra_lancar('  Tramadól  ', 'portaria_344', 'Fonte de teste, lista A2') - 'id', '{"ok": true, "nome": "tramadol"}'::jsonb, 'equipe lança: o nome vira minúsculo e sem acento');
select is(public.cat_regra_lancar('tramadol', 'portaria_344', 'Fonte de teste, lista A2') ->> 'erro', 'ja_existe', 'o mesmo nome não entra duas vezes');
select is(array[public.cat_regra_lancar('a+b', 'portaria_344', 'Fonte de teste') ->> 'campo', public.cat_regra_lancar('ab', 'portaria_344', 'Fonte de teste') ->> 'campo',
                public.cat_regra_lancar('codeina', 'lista_que_nao_existe', 'Fonte de teste') ->> 'campo', public.cat_regra_lancar('codeina', 'portaria_344', 'abc') ->> 'campo'],
          array['nome', 'nome', 'lista', 'fonte'], 'nome com símbolo ou curto, lista desconhecida e fonte curta: recusados');
select pg_temp.dono();
create temp table ids as select id, nome_busca from catalogo.med_regras;
grant select on ids to authenticated;
select pg_temp.equipe();
select is(public.cat_regra_retirar((select id from ids where nome_busca = 'frontal'), 'abc') ->> 'campo', 'motivo', 'retirar pede o motivo');
select is(public.cat_regra_retirar((select id from ids where nome_busca = 'frontal'), 'Nome comum demais: teste de retirada'), '{"ok": true}'::jsonb, 'equipe retira com o motivo');
select is(public.cat_regra_retirar((select id from ids where nome_busca = 'frontal'), 'Nome comum demais: teste de retirada') ->> 'erro', 'nao_encontrado', 'retirar de novo: não encontrado');
select is((select count(*)::integer || '|' || count(*) filter (where retirada_em is not null) from jsonb_to_recordset(public.cat_regra_listar() -> 'itens') as x(nome text, retirada_em timestamptz)),
          '41|1', 'a equipe vê a lista inteira: 41 lançados, 1 retirado (nada foi apagado)');
select pg_temp.dono();
select is(private.rx_conferir('[{"medicamento": "Frontal 0,5 mg"}, {"medicamento": "Tramadol 50 mg"}]'),
          '[{"n": 2, "nome": "Tramadol 50 mg", "termo": "tramadol", "lista": "portaria_344"}]'::jsonb, 'nome retirado deixa de travar; nome lançado passa a travar');
select throws_ok($$delete from catalogo.med_regras where nome_busca = 'tramadol'$$, 'P0001', null, 'nome lançado não se apaga');
select throws_ok($$update catalogo.med_regras set nome_busca = 'outro nome' where nome_busca = 'tramadol'$$, 'P0001', null, 'nome lançado não muda');
select throws_ok($$update catalogo.med_regras set retirada_motivo = 'outro motivo de teste' where nome_busca = 'frontal'$$, 'P0001', null, 'nome retirado não muda');

/* ===================== C. O rascunho ===================== */
select pg_temp.medico2();
select is(public.ws_receita_abrir(pg_temp.c(1)) ->> 'erro', 'forbidden', 'outro médico não abre a receita da consulta');
select is(public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item()), 0) ->> 'erro', 'forbidden', 'outro médico não salva');
select is(public.ws_receita_emitir(pg_temp.c(1), 1, pg_temp.conferido(), true) ->> 'erro', 'forbidden', 'outro médico não emite');
select pg_temp.paciente();
select is(public.ws_receita_abrir(pg_temp.c(1)) ->> 'erro', 'forbidden', 'quem não é médico não abre');
select pg_temp.dono();
select is(pg_temp.negados('ws_receita_abrir', 'sem_vinculo') || '|' || pg_temp.negados('ws_receita_salvar', 'sem_vinculo') || '|' || pg_temp.negados('ws_receita_emitir', 'sem_vinculo'),
          '2|1|1', 'as recusas ficaram na trilha');
select pg_temp.medica();
select is(public.ws_receita_abrir(pg_temp.c(1)) - 'acesso', '{"ok": true, "pode_editar": true, "rascunho": null, "emitidas": []}'::jsonb, 'a médica abre: ainda sem rascunho');
select is(public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item('{"via": ""}')), 0) -> 'versao', '1'::jsonb, 'primeiro salvar: versão 1 (o rascunho pode estar incompleto)');
select is(public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item()), 0) ->> 'erro', 'versao_conflito', 'outra aba com a versão antiga: conflito');
select is(public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item()), 0) #>> '{conteudo,itens,0,via}', '', 'o conflito devolve o que está salvo');
select is(public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item('{"via": ""}')), 1) ->> 'igual', 'true', 'salvar o mesmo conteúdo não sobe a versão');
select is(array[public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item('{"paciente": "nome"}')), 1) ->> 'campo',
                public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item('{"via": "bucal"}')), 1) ->> 'campo',
                public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item('{"freq_n": 0}')), 1) ->> 'campo',
                public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item('{"dur_n": 400}')), 1) ->> 'campo',
                public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item(), pg_temp.item(jsonb_build_object('posologia', repeat('a', 501)))), 1) ->> 'campo',
                public.ws_receita_salvar(pg_temp.c(1), '{"itens": [], "paciente": "x"}', 1) ->> 'campo',
                public.ws_receita_salvar(pg_temp.c(1), jsonb_build_object('itens', (select jsonb_agg(pg_temp.item()) from generate_series(1, 21))), 1) ->> 'campo'],
          array['itens.1.paciente', 'itens.1.via', 'itens.1.freq_n', 'itens.1.dur_n', 'itens.2.posologia', 'conteudo', 'itens'],
          'chave desconhecida, via fora da lista, números fora da faixa, texto longo demais e mais de 20 itens: recusados, dizendo o campo');
select is(public.ws_receita_salvar(pg_temp.c(2), pg_temp.receita(pg_temp.item()), 0) ->> 'erro', 'prazo_encerrado', 'consulta encerrada há mais de 24 horas: não salva');
select pg_temp.equipe();
select is(public.ws_receita_abrir(pg_temp.c(1)) ->> 'erro', 'justificativa', 'a equipe médica só abre com justificativa');
select is(public.ws_receita_abrir(pg_temp.c(1), 'auditoria') #>> '{rascunho,versao}', '1', 'com justificativa, a equipe lê o rascunho');
select is(public.ws_receita_abrir(pg_temp.c(1), 'auditoria') ->> 'pode_editar', 'false', 'a equipe não edita');

/* ===================== D. Emitir ===================== */
select pg_temp.medica();
select is(public.ws_receita_emitir(pg_temp.c(1), 1, pg_temp.conferido(), true), '{"erro": "dados_invalidos", "campo": "itens.1.via"}'::jsonb, 'emitir com item sem via: recusado, dizendo o campo');
select is(public.ws_receita_emitir(pg_temp.c(1), 7, pg_temp.conferido(), true) ->> 'erro', 'versao_conflito', 'emitir com versão que não é a salva: conflito');
select is(public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item(), pg_temp.item('{"medicamento": "Cloridrato de SERTRALINA"}')), 1) -> 'versao', '2'::jsonb, 'o rascunho aceita o nome da lista (quem trava é a emissão)');
select is(public.ws_receita_emitir(pg_temp.c(1), 2, pg_temp.conferido(), true),
          '{"erro": "receita_bloqueada", "motivo": "lista", "itens": [{"n": 2, "nome": "Cloridrato de SERTRALINA", "termo": "sertralina", "lista": "portaria_344"}]}'::jsonb,
          'nome da lista de controle: a emissão é recusada e diz qual item e qual lista');
select is(public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item(), pg_temp.manipulado('{"composicao": "Azitromicina 2%, gel base qsp 30 g"}')), 2) -> 'versao', '3'::jsonb, 'troca por um manipulado com componente da lista');
select is(public.ws_receita_emitir(pg_temp.c(1), 3, pg_temp.conferido(), true) #>> '{itens,0,termo}', 'azitromicina', 'manipulado com componente da lista: recusado');
select is(public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item(), pg_temp.manipulado()), 3) -> 'versao', '4'::jsonb, 'receita acertada: versão 4');
select is(public.ws_receita_emitir(pg_temp.c(1), 4, pg_temp.conferido(), false), '{"erro": "dados_invalidos", "detalhe": "endereco_residencial", "dica": null}'::jsonb,
          'sem a confirmação do endereço residencial: recusado pela regra da receita simples');
select is(public.ws_receita_emitir(pg_temp.c(1), 4, '{"sem_cpf": true, "endereco": "Outro endereço, 1"}', true) ->> 'erro', 'dados_paciente_mudaram', 'dados do paciente diferentes dos conferidos: recusado');
select is(pg_temp.docs(1), 0, 'nenhuma recusa deixou documento');
create temp table emitida as select public.ws_receita_emitir(pg_temp.c(1), 4, pg_temp.conferido(), true) as r;
grant select on emitida to authenticated;
select is((select (r ->> 'ok') || '|' || (r ? 'id')::text || '|' || ((r ->> 'code') ~ '^[0-9A-Z]{6,}$')::text from emitida), 'true|true|true', 'receita emitida: devolve o documento e o código');
select is(public.ws_receita_emitir(pg_temp.c(1), 4, pg_temp.conferido(), true), (select r || '{"repetida": true}' from emitida), 'emitir de novo em seguida: a mesma receita, sem duplicar');
select is(public.ws_receita_abrir(pg_temp.c(1)) #>> '{emitidas,0,conteudo,itens,1,composicao}', 'Ureia 10%, creme base qsp 100 g', 'abrir mostra a emitida (para repetir) e o rascunho vazio');
select is(public.ws_receita_salvar(pg_temp.c(1), pg_temp.receita(pg_temp.item()), 0) -> 'versao', '1'::jsonb, 'depois de emitir, dá para começar outra receita');
select pg_temp.dono();
select is((select d.kind || '|' || d.status || '|' || (d.payload ->> 'tipo') || '|' || jsonb_array_length(d.payload -> 'itens') from public.tele_documents d where d.id = (select (r ->> 'id')::uuid from emitida)),
          'receita|emitido|simples|2', 'o documento é a receita simples de sempre, com os 2 itens');
select is((select d.payload -> 'itens' -> 0 from public.tele_documents d where d.id = (select (r ->> 'id')::uuid from emitida)),
          '{"medicamento": "Dipirona sódica", "concentracao": "500 mg", "forma": "comprimido", "via": "oral", "posologia": "Tomar 1 comprimido por via oral a cada 6 horas, por 7 dias.", "quantidade": "1 caixa com 30 comprimidos", "duracao": "7 dias", "observacao": "Se a dor continuar, avise o médico."}'::jsonb,
          'item 1 impresso: os campos de hoje, com a duração por extenso');
select is((select (d.payload -> 'itens' -> 1) - 'posologia' - 'quantidade' from public.tele_documents d where d.id = (select (r ->> 'id')::uuid from emitida)),
          '{"medicamento": "Fórmula manipulada: Ureia 10%, creme base qsp 100 g", "concentracao": "conforme a fórmula", "forma": "creme", "via": "tópica", "duracao": "uso contínuo", "observacao": null}'::jsonb,
          'item 2 impresso: a fórmula no lugar do nome, "conforme a fórmula" e "uso contínuo"');
select is((select string_agg(i.ordem || ':' || i.tipo || ':' || i.via || ':' || i.posologia_editada_a_mao || ':' || coalesce(i.frequencia ->> 'modo', '-') || ':' || coalesce(i.duracao ->> 'n', '-'), ' ' order by i.ordem)
           from prontuario.prescricao_itens i join prontuario.prescricoes p on p.id = i.prescricao_id where p.documento_id = (select (r ->> 'id')::uuid from emitida)),
          '1:industrializado:oral:false:intervalo:7 2:manipulado:topica:true:vezes:-', 'os itens ficam gravados campo a campo, com a marca do texto editado à mão');
select is(pg_temp.docs(1) || '|' || (select count(*) from prontuario.prescricoes p where p.teleconsulta_id = pg_temp.c(1) and p.situacao = 'emitida'), '1|1', 'um documento e uma receita emitida');
select is(pg_temp.negados('ws_receita_emitir', 'lista_de_controle') || '|' || pg_temp.negados('ws_receita_emitir', 'dados_invalidos') || '|' || pg_temp.negados('ws_receita_emitir', 'dados_paciente_mudaram'),
          '2|1|1', 'as recusas da emissão ficaram na trilha');
select throws_ok($$update prontuario.prescricoes set conteudo = '{}' where situacao = 'emitida'$$, 'P0001', null, 'receita emitida não muda');
select throws_ok($$delete from prontuario.prescricoes$$, 'P0001', null, 'receita não se apaga (nem o rascunho)');
select throws_ok($$update prontuario.prescricao_itens set medicamento = 'outro'$$, 'P0001', null, 'item emitido não muda');
select throws_ok($$insert into prontuario.prescricao_itens (prescricao_id, ordem, tipo, medicamento, via, quantidade, posologia_texto)
                   select p.id, 9, 'industrializado', 'entrou depois', 'oral', '1', 'texto' from prontuario.prescricoes p where p.situacao = 'emitida'$$,
                 'P0001', null, 'não entra item em receita já emitida');
-- o caminho antigo (tele_doc_create direto) também passa pela lista
select pg_temp.medica();
select throws_ok($$select * from public.tele_doc_create(pg_temp.c(1), 'receita',
                     '{"tipo": "simples", "endereco_residencial": true, "itens": [{"medicamento": "Rivotril", "concentracao": "2 mg", "via": "oral", "posologia": "Tomar 1 comprimido à noite.", "quantidade": "1 caixa", "duracao": "30 dias"}]}',
                     pg_temp.conferido())$$, 'P0001', 'receita_bloqueada', 'caminho antigo com nome da lista: recusado pelo gatilho');
select lives_ok($$select * from public.tele_doc_create(pg_temp.c(1), 'receita',
                     '{"tipo": "simples", "endereco_residencial": true, "itens": [{"medicamento": "Frontal", "concentracao": "0,5 mg", "via": "oral", "posologia": "Tomar 1 comprimido à noite.", "quantidade": "1 caixa", "duracao": "30 dias"}]}',
                     pg_temp.conferido())$$, 'caminho antigo com nome que a equipe retirou da lista: passa (a lista só recusa o que está vigente)');
select lives_ok($$select * from public.tele_doc_create(pg_temp.c(1), 'atestado', '{"dias": "1", "finalidade": "trabalho"}', pg_temp.conferido())$$,
                'outros documentos não passam pela lista');
select is(public.ws_receita_salvar(pg_temp.c(3), pg_temp.receita(pg_temp.item()), 0) -> 'versao', '1'::jsonb, 'consulta sem o endereço do paciente: o rascunho salva');
select is(public.ws_receita_emitir(pg_temp.c(3), 1, '{"sem_cpf": true}', true), '{"erro": "paciente_incompleto", "detalhe": "endereco", "dica": null}'::jsonb,
          'sem o endereço do paciente a receita não sai (a lei exige o endereço residencial)');
select is(public.ws_receita_emitir(pg_temp.c(3), 1, '{"sem_cpf": true}', true) ->> 'erro', 'paciente_incompleto', 'a recusa não emitiu nem gastou o rascunho');

/* ===================== E. Modelos ===================== */
select pg_temp.paciente();
select is(array[public.ws_receita_modelos() ->> 'erro', public.ws_receita_modelo_salvar(null, 'Modelo', pg_temp.receita(pg_temp.item())) ->> 'erro', public.ws_receita_modelo_apagar(pg_temp.u(1)) ->> 'erro'],
          array['forbidden', 'forbidden', 'forbidden'], 'quem não é médico aprovado não tem modelos');
select pg_temp.medica();
create temp table modelo as select public.ws_receita_modelo_salvar(null, '  Dor   de cabeça ', pg_temp.receita(pg_temp.item())) as r;
grant select on modelo to authenticated;
select is((select r ->> 'ok' from modelo) || '|' || (public.ws_receita_modelos() #>> '{itens,0,nome}'), 'true|Dor de cabeça', 'a médica salva um modelo (o nome fica arrumado)');
select is(array[public.ws_receita_modelo_salvar(null, 'DOR DE CABEÇA', pg_temp.receita(pg_temp.item())) ->> 'erro',
                public.ws_receita_modelo_salvar(null, 'x', pg_temp.receita(pg_temp.item())) ->> 'campo',
                public.ws_receita_modelo_salvar(null, 'Vazio', '{"itens": []}') ->> 'campo',
                public.ws_receita_modelo_salvar(null, 'Estranho', pg_temp.receita(pg_temp.item('{"paciente": "nome"}'))) ->> 'campo'],
          array['nome_repetido', 'nome', 'itens', 'itens.1.paciente'], 'nome repetido, nome curto, modelo vazio e chave desconhecida: recusados');
select pg_temp.medico2();
select is(jsonb_array_length(public.ws_receita_modelos() -> 'itens') || '|' || (public.ws_receita_modelo_salvar((select (r ->> 'id')::uuid from modelo), 'Tomado', pg_temp.receita(pg_temp.item())) ->> 'erro')
          || '|' || (public.ws_receita_modelo_apagar((select (r ->> 'id')::uuid from modelo)) ->> 'erro'),
          '0|nao_encontrado|nao_encontrado', 'outro médico não vê, não troca e não apaga o modelo da médica');
select pg_temp.medica();
select is(public.ws_receita_modelo_salvar((select (r ->> 'id')::uuid from modelo), 'Dor de cabeça forte', pg_temp.receita(pg_temp.item(), pg_temp.manipulado())) ->> 'ok', 'true', 'a médica troca o próprio modelo');
select is(public.ws_receita_modelos() #>> '{itens,0,nome}', 'Dor de cabeça forte', 'o modelo trocado aparece');
select is((public.ws_receita_modelo_apagar((select (r ->> 'id')::uuid from modelo)) ->> 'ok') || '|' || jsonb_array_length(public.ws_receita_modelos() -> 'itens'), 'true|0', 'apagar tira da lista');
select pg_temp.dono();
select is((select count(*)::integer || '|' || count(*) filter (where apagado_em is not null) from prontuario.prescricao_modelos), '1|1', 'apagar só marca (a linha fica)');

select * from finish();
rollback;
