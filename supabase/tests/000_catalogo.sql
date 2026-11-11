-- Guardas do catálogo (iMed Agenda, fases 3.0 e 3.1; arquitetura §12 e §13): regras de segurança que valem para
-- TODO objeto do banco, conferidas a cada envio num banco criado do zero pelas migrações (.github/workflows/banco.yml).
-- Quando uma guarda reprova, a mensagem traz o que está fora da regra ("have" = o que existe, "want" = o certo).
-- As guardas das fases seguintes já estão aqui e são puladas (SKIP) até o objeto existir (as da 3.1 já valem); o que
-- já se sabe que falta e depende de decisão fica como pendência (TODO: aparece no resumo do banco.yml, mas não reprova).
begin;
select plan(28);

/* ===================== Tabelas e views ===================== */

select is(
  array(select c.relname::text
        from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
          and not exists (select 1 from pg_depend d
                          where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
        order by 1),
  '{}'::text[],
  'nenhuma tabela de public sem RLS (ligue com: alter table ... enable row level security)'
);

-- private: RLS ligada e nenhuma permissão para os papéis da API, nem na tabela inteira nem coluna por coluna.
select is(
  array(select format('%s%s', c.relname, case when c.relrowsecurity then '' else ' (sem RLS)' end)
          || coalesce(' (' || (select string_agg(r || ' ' || lower(p), ', ' order by r, p)
                               from unnest(array['anon', 'authenticated', 'service_role']) r,
                                    unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES']) p
                               where has_table_privilege(r, c.oid, p)
                                  or (p in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                                      and has_any_column_privilege(r, c.oid, p))) || ')', '')
        from pg_class c
        where c.relnamespace = 'private'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
          and (not c.relrowsecurity and c.relkind in ('r', 'p')
               or exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r,
                                        unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES']) p
                          where has_table_privilege(r, c.oid, p)
                             or (p in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                                 and has_any_column_privilege(r, c.oid, p))))
        order by 1),
  '{}'::text[],
  'tabelas de private com RLS e sem nenhuma permissão (nem por coluna) para anon, authenticated e service_role'
);

select ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
  and not has_schema_privilege('authenticated', 'private', 'USAGE')
  and not has_schema_privilege('service_role', 'private', 'USAGE'),
  'schema private sem USAGE para anon, authenticated e service_role (a API não alcança)'
);

-- View lê as tabelas como a DONA (passa por cima da RLS), a menos que tenha security_invoker; view materializada
-- não tem RLS nenhuma. Em public, só com security_invoker ou sem SELECT para anon e authenticated.
select is(
  array(select c.relname || case c.relkind when 'm' then ' (view materializada com SELECT para a API)'
                                           else ' (view sem security_invoker, com SELECT para a API)' end
        from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
          and not exists (select 1 from pg_depend d
                          where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
          and (has_any_column_privilege('anon', c.oid, 'SELECT') or has_any_column_privilege('authenticated', c.oid, 'SELECT'))
          and (c.relkind = 'm'
               or not coalesce(c.reloptions, '{}') && array['security_invoker=true', 'security_invoker=on',
                                                             'security_invoker=1', 'security_invoker=yes'])
        order by 1),
  '{}'::text[],
  'views de public com security_invoker (respeitam a RLS) ou sem SELECT para anon e authenticated'
);

-- Realtime: nenhuma tabela com dado pessoal na publicação (§7 e §12: o Realtime só leva avisos sem dado pessoal).
select is(
  array(select pt.schemaname || '.' || pt.tablename
        from pg_publication_tables pt
        where pt.pubname = 'supabase_realtime' and pt.schemaname in ('public', 'private', 'agenda')
        order by 1),
  '{}'::text[],
  'nenhuma tabela de public, private ou agenda na publicação do Realtime (a fase 3.4 decide o que entra)'
);

-- Privilégios que objeto NOVO do schema public ganha sozinho (criado pelo postgres numa migração), iguais aos da
-- produção (conferidos em 31/10/2026): tabela arwd para anon/authenticated (a migração de segurança tirou
-- TRUNCATE, REFERENCES, TRIGGER e MAINTAIN), sequência só leitura e uso, função executável pelos três papéis.
-- Se a CLI do Supabase mudar o padrão (config.toml, api.auto_expose_new_tables), o banco do CI deixa de ser igual
-- ao da produção: esta guarda avisa. As migrações da agenda dão GRANT/REVOKE explícitos de qualquer forma.
select is(
  array(select d.defaclobjtype::text || ' ' || (select string_agg(a::text, ',' order by a::text collate "C") from unnest(d.defaclacl) a)
        from pg_default_acl d
        where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
        order by d.defaclobjtype::text collate "C"),
  array['S anon=rU/postgres,authenticated=rU/postgres,postgres=rwU/postgres,service_role=rwU/postgres',
        'f anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres',
        'r anon=arwd/postgres,authenticated=arwd/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'],
  'privilégios padrão do schema public iguais aos da produção (tabela, sequência e função nova)'
);

-- Extensão instalada em public põe as funções dela na API, sem passar pela lista de permissões abaixo.
-- Na produção, só o pg_net está em public (as funções dele ficam no schema net). btree_gist (fase 3.1) e qualquer
-- outra vão para o schema extensions.
select is(
  array(select e.extname::text from pg_extension e
        where e.extnamespace = 'public'::regnamespace and e.extname <> 'pg_net' order by 1),
  '{}'::text[],
  'nenhuma extensão nova no schema public (crie com: create extension ... with schema extensions)'
);

/* ===================== O pedido de agendamento que o site manda ===================== */

-- As colunas que o site grava num pedido (assets/js/geo-core.js, bookingRow, mais review_token_hash) precisam
-- continuar com INSERT para anon e authenticated: na fase 3.1 o INSERT passa a ser coluna por coluna (§2.3), e
-- esquecer uma delas quebra o pedido no ar (por exemplo, other_consent: todo pedido "para outra pessoa").
-- tests/banco/pedido-do-site.mjs confere que esta lista é EXATAMENTE o que o bookingRow manda hoje.
-- [colunas do pedido do site]
create temp table colunas_do_site (col text primary key) on commit drop;
insert into colunas_do_site (col) values
  ('id'), ('clinic_id'), ('place_source'), ('place_ref'), ('place_name'), ('place_address'), ('place_phone'),
  ('exam_code'), ('preferred_date'), ('preferred_period'), ('patient_name'), ('patient_phone'), ('patient_email'),
  ('notes'), ('consent'), ('slot_start'), ('for_other'), ('other_name'), ('relationship'), ('other_minor'),
  ('guardian_consent'), ('other_consent'), ('review_token_hash');
-- [fim das colunas do pedido do site]

select is(
  array(select r || ': ' || s.col || case when a.attname is null then ' (a coluna não existe)' else ' (sem INSERT)' end
        from colunas_do_site s
        cross join unnest(array['anon', 'authenticated']) r
        left join pg_attribute a on a.attrelid = 'public.appointment_requests'::regclass and a.attname = s.col
                                and not a.attisdropped
        where case when a.attname is null then true
                   else not has_column_privilege(r, 'public.appointment_requests'::regclass, s.col, 'INSERT') end
        order by 1),
  '{}'::text[],
  'anon e authenticated gravam (INSERT) as 23 colunas que o site manda no pedido de agendamento'
);

/* ===================== Funções ===================== */

-- SECURITY DEFINER sempre com search_path vazio. Exceção conhecida e listada (arquitetura §13):
-- public.imported_cities, com search_path=public (só lê tabelas de public; trocar exige testar as páginas de cidade).
select is(
  array(select format('%I.%I(%s): %s', n.nspname, p.proname, oidvectortypes(p.proargtypes),
                      coalesce(array_to_string(p.proconfig, ' '), 'sem search_path'))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private', 'agenda') and p.prosecdef
          and not exists (select 1 from pg_depend d
                          where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
          and not coalesce(p.proconfig, '{}') @> array['search_path=""']
          and not (n.nspname = 'public' and p.proname = 'imported_cities'
                   and coalesce(p.proconfig, '{}') @> array['search_path=public'])
        order by 1),
  '{}'::text[],
  'toda função SECURITY DEFINER tem search_path vazio (set search_path = ''''), fora a exceção listada'
);

-- Quem executa cada função de public: lista permitida para anon e authenticated (PUBLIC vale para os dois).
-- Gerada do estado das migrações e conferida com a produção em 31/10/2026 (82 funções, iguais; a 3.1 acrescentou
-- has_clinic_perm e imed_has, só para quem está logado).
-- Função nova SEM entrada aqui reprova: acrescente a linha com as permissões que ela deve ter
-- ('' = só o servidor; 'authenticated' = só quem está logado; 'anon,authenticated' = qualquer visitante).
create temp table esperado_acl (fn text primary key, acl text not null) on commit drop;
insert into esperado_acl (fn, acl) values
    ('add_my_block(uuid, timestamp with time zone, timestamp with time zone, text)', 'authenticated'),
    ('admin_cobranca_listar(text, integer)', 'authenticated'),
    -- 3.2: cadastros (só quem está logado; a função confere a permissão por dentro) e consulta pública sem dado pessoal
    ('agenda_block_add(uuid, uuid, timestamp with time zone, timestamp with time zone, text, text)', 'authenticated'),
    ('agenda_block_remove(uuid)', 'authenticated'),
    ('agenda_days(uuid, uuid, date, date)', 'anon,authenticated'),
    ('agenda_holiday_opening_set(uuid, date, boolean, boolean)', 'authenticated'),
    ('agenda_holiday_remove(uuid)', 'authenticated'),
    ('agenda_holiday_save(jsonb)', 'authenticated'),
    ('agenda_pair_rules_set(uuid, jsonb)', 'authenticated'),
    ('agenda_procedure_save(uuid, jsonb, boolean)', 'authenticated'),
    ('agenda_public_info(uuid)', 'anon,authenticated'),
    ('agenda_resource_save(uuid, jsonb, boolean)', 'authenticated'),
    ('agenda_rules_set(uuid, uuid, jsonb, boolean)', 'authenticated'),
    ('agenda_slots(uuid, uuid, date, date)', 'anon,authenticated'),
    -- 5.1: próximo horário livre na lista da busca (público, sem dado pessoal)
    ('agenda_next_free(uuid[], text, integer)', 'anon,authenticated'),
    ('agenda_unit_save(uuid, jsonb, boolean)', 'authenticated'),
    -- 3.3: marcar (paciente: visitante ou logado), reservar/confirmar/soltar (só o servidor: '' para anon e
    -- authenticated), cancelar e remarcar (paciente com o código, clínica, equipe), balcão e situação (só logado)
    ('agenda_book(uuid, jsonb, jsonb, uuid, text)', 'anon,authenticated'),
    ('agenda_cancel(uuid, text, text, integer)', 'anon,authenticated'),
    ('agenda_confirm(uuid)', ''),
    ('agenda_desk_book(uuid, jsonb, jsonb, text, uuid)', 'authenticated'),
    ('agenda_desk_busy(uuid, timestamp with time zone, timestamp with time zone, uuid, uuid, text)', 'authenticated'),
    ('agenda_desk_busy_remove(uuid)', 'authenticated'),
    ('agenda_hold(uuid, jsonb, jsonb, uuid, text)', ''),
    ('agenda_my_booking(uuid, text)', 'anon,authenticated'),
    ('agenda_package_options(uuid, uuid[], date, integer)', 'anon,authenticated'),
    ('agenda_release(uuid, text)', ''),
    ('agenda_reschedule(uuid, jsonb, text, uuid, integer)', 'anon,authenticated'),
    ('agenda_set_status(uuid, text, text, integer, uuid)', 'authenticated'),
    -- 3.4: painel, equipe e canal do Realtime (só quem está logado; cada função confere a permissão por dentro)
    ('agenda_conflict_resolve(uuid, text, text)', 'authenticated'),
    ('agenda_conflicts(uuid, boolean)', 'authenticated'),
    ('agenda_dashboard(uuid, date, date, jsonb)', 'authenticated'),
    ('agenda_dashboard_financeiro(uuid, date, date)', 'authenticated'),
    ('agenda_history(uuid)', 'authenticated'),
    ('agenda_invite(uuid, text, text)', 'authenticated'),
    ('agenda_invite_accept(uuid)', 'authenticated'),
    ('agenda_invite_cancel(uuid)', 'authenticated'),
    ('agenda_me()', 'authenticated'),
    ('agenda_member_remove(uuid, uuid)', 'authenticated'),
    ('agenda_member_role(uuid, uuid, text)', 'authenticated'),
    ('agenda_month(uuid, date)', 'authenticated'),
    ('agenda_my_invites()', 'authenticated'),
    ('agenda_realtime_ok(text)', 'authenticated'),
    ('agenda_request_detail(uuid, text)', 'authenticated'),
    ('agenda_search(uuid, text)', 'authenticated'),
    ('agenda_team(uuid)', 'authenticated'),
    ('agenda_version(uuid)', 'authenticated'),
    ('agenda_view(uuid, date, integer)', 'authenticated'),
    -- 4.1: ler a configuração e trocar a modalidade (só quem está logado; a função confere a permissão por dentro)
    ('agenda_config(uuid)', 'authenticated'),
    ('agenda_mode_set(uuid, text, boolean)', 'authenticated'),
    -- 4.2: agenda visual e recepção (só quem está logado; cada função confere a permissão na clínica por dentro)
    ('agenda_attend(uuid, text, text, integer, uuid)', 'authenticated'),
    ('agenda_block_force(uuid, uuid, timestamp with time zone, timestamp with time zone, text, text, text)', 'authenticated'),
    ('agenda_blocks(uuid, date, date)', 'authenticated'),
    ('agenda_catalog(uuid)', 'authenticated'),
    ('agenda_desk_slots(uuid, uuid, date, date, uuid, uuid)', 'authenticated'),
    ('agenda_free(uuid, date, integer)', 'authenticated'),
    ('agenda_requests(uuid, text, text)', 'authenticated'),
    -- 4.4: central do IMED no painel de gestão (só quem está logado; cada função confere a permissão da equipe por dentro)
    ('agenda_central_audit(jsonb)', 'authenticated'),
    ('agenda_central_conflicts(boolean)', 'authenticated'),
    ('agenda_central_holiday_preview(date)', 'authenticated'),
    ('agenda_central_holidays()', 'authenticated'),
    ('agenda_central_overview()', 'authenticated'),
    ('agenda_central_setting_set(text, integer)', 'authenticated'),
    ('agenda_central_settings()', 'authenticated'),
    ('agenda_central_staff()', 'authenticated'),
    ('agenda_central_staff_grant(text, text)', 'authenticated'),
    ('agenda_central_staff_revoke(uuid, text)', 'authenticated'),
    ('agenda_central_version()', 'authenticated'),
    ('admin_cobranca_salvar(jsonb)', 'authenticated'),
    ('admin_cobranca_status(uuid, text, text)', 'authenticated'),
    ('admin_gestao(integer)', 'authenticated'),
    ('admin_stats(integer)', 'authenticated'),
    ('approve_claim(uuid)', 'authenticated'),
    ('available_slots(uuid, text, date, integer)', 'anon,authenticated'),
    ('cancel_request(uuid, text)', 'anon,authenticated'),
    ('cat_cid_buscar(text)', 'authenticated'),
    ('check_appointment_request()', ''),
    ('check_establishment_claim()', ''),
    ('check_internal_token(text, text)', ''),
    ('clinic_perm_scope(uuid, text)', 'authenticated'),
    ('city_establishments(integer, text, integer, integer)', 'anon,authenticated'),
    ('clinics_with_schedule(uuid[])', 'anon,authenticated'),
    ('cnes_last_update(integer)', 'anon,authenticated'),
    ('establishment_points(double precision, double precision, integer, text, text, boolean, integer)', 'anon,authenticated'),
    ('finish_establishment_import(integer, timestamp with time zone, integer, text)', ''),
    ('has_clinic_perm(uuid, text)', 'authenticated'),
    ('imed_has(text)', 'authenticated'),
    ('import_queue_mark(integer, integer, text, text)', ''),
    ('imported_cities()', 'anon,authenticated'),
    ('is_clinic_member(uuid)', 'authenticated'),
    ('is_imed_admin()', 'authenticated'),
    -- busca pública; o PUBLIC (além de anon e authenticated) vem da migração marketplace, como na produção
    ('nearby_clinics(double precision, double precision, integer, text, text, text, integer, integer, boolean, integer)', 'anon,authenticated,PUBLIC'),
    ('nearby_establishments(double precision, double precision, integer, integer, text, text, boolean, integer)', 'anon,authenticated'),
    ('place_ratings(text[])', 'anon,authenticated'),
    ('place_reviews(text, integer)', 'anon,authenticated'),
    ('reject_claim(uuid, text)', 'authenticated'),
    ('remove_my_block(uuid)', 'authenticated'),
    ('report_place_issue(text, uuid, text, text)', 'anon,authenticated'),
    ('request_status(uuid[], text[])', 'anon,authenticated'),
    ('save_claim_checks(uuid, jsonb)', 'authenticated'),
    ('save_establishment_geocodes(integer, jsonb)', ''),
    ('send_contact(text, text, text, text, text)', 'anon,authenticated'),
    ('set_contact_status(uuid, text)', 'authenticated'),
    ('set_my_clinic_exams(uuid, jsonb)', 'authenticated'),
    ('set_my_schedule(uuid, jsonb)', 'authenticated'),
    ('set_place_report_status(uuid, text)', 'authenticated'),
    ('set_request_status(uuid, text)', 'authenticated'),
    ('start_establishment_import(integer, interval)', ''),
    ('submit_review(uuid, text, integer, text)', 'anon,authenticated'),
    ('tele_accept(uuid)', 'authenticated'),
    ('tele_admin_doctors()', 'authenticated'),
    ('tele_admin_documents(integer)', 'authenticated'),
    ('tele_admin_save_checks(uuid, jsonb)', 'authenticated'),
    ('tele_admin_set_doctor(uuid, text, text)', 'authenticated'),
    ('tele_answer(uuid, text, text, integer)', 'anon,authenticated'),
    ('tele_cancel(uuid, text)', 'anon,authenticated'),
    ('tele_dismiss(uuid)', 'authenticated'),
    ('tele_doc_cancel(uuid, text)', 'authenticated'),
    ('tele_doc_create(uuid, text, jsonb, jsonb)', 'authenticated'),
    ('tele_doc_list(uuid)', 'authenticated'),
    ('tele_doc_patient_data(uuid, text, text, boolean, boolean)', 'authenticated'),
    ('tele_doc_pdf(uuid)', 'authenticated'),
    ('tele_doc_pending()', 'authenticated'),
    ('tele_doc_upload(uuid, text)', 'authenticated'),
    ('tele_doc_verify(text)', 'anon,authenticated'),
    ('tele_doctor_me()', 'authenticated'),
    ('tele_doctor_messages(uuid, bigint)', 'authenticated'),
    ('tele_doctor_profile(text, text)', 'authenticated'),
    ('tele_doctor_register(text, text, text, text, text, text)', 'authenticated'),
    ('tele_doctor_send(uuid, text)', 'authenticated'),
    ('tele_doctor_status(uuid)', 'authenticated'),
    ('tele_doctors_online()', 'anon,authenticated'),
    ('tele_end(uuid, text, text)', 'authenticated'),
    ('tele_history()', 'authenticated'),
    ('tele_mark_started(uuid, boolean)', 'authenticated'),
    ('tele_offer(uuid, text)', 'authenticated'),
    ('tele_painel_medico()', 'authenticated'),
    ('tele_patient_details(uuid, text, text, text)', 'anon,authenticated'),
    ('tele_patient_document_pdf(uuid, text, uuid)', 'anon,authenticated'),
    ('tele_patient_documents(uuid, text)', 'anon,authenticated'),
    ('tele_patient_end(uuid, text)', 'anon,authenticated'),
    ('tele_patient_messages(uuid, text, bigint)', 'anon,authenticated'),
    ('tele_patient_send(uuid, text, text)', 'anon,authenticated'),
    ('tele_queue()', 'authenticated'),
    ('tele_request(text, date, text, text, text[], boolean, text, text, boolean, boolean, text, text, boolean)', 'anon,authenticated'),
    ('tele_set_available(boolean)', 'authenticated'),
    ('tele_set_exams(uuid, jsonb, text)', 'authenticated'),
    ('tele_status(uuid, text)', 'anon,authenticated'),
    ('touch_updated_at()', ''),
    ('track(text, text, text)', 'anon,authenticated'),
    ('update_my_clinic(uuid, jsonb)', 'authenticated'),
    ('upsert_establishments(integer, timestamp with time zone, jsonb)', ''),
    -- prontuário (Workspace, fase 2): só quem está logado; cada função confere o médico da consulta e grava a trilha
    ('ws_adendo_criar(uuid, text)', 'authenticated'),
    ('ws_integridade_conferir()', 'authenticated'),
    ('ws_registro_abrir(uuid, text)', 'authenticated'),
    ('ws_registro_finalizar(uuid, integer)', 'authenticated'),
    ('ws_registro_historico(uuid, text)', 'authenticated'),
    ('ws_registro_salvar(uuid, jsonb, integer)', 'authenticated'),
    ('ws_registro_versao(uuid, integer, text)', 'authenticated');

create temp table atual_acl on commit drop as
select format('%I(%s)', p.proname, oidvectortypes(p.proargtypes)) as fn,
       coalesce((select string_agg(x.g, ',' order by x.g)
                 from (select case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end as g
                       from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where a.privilege_type = 'EXECUTE'
                         and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole))) x), '') as acl
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');

select is(
  array(select a.fn || ' → executável por: ' || coalesce(nullif(a.acl, ''), 'só o servidor')
        from atual_acl a left join esperado_acl e using (fn) where e.fn is null order by 1),
  '{}'::text[],
  'toda função de public está na lista de permissões (função nova: acrescente a linha em 000_catalogo.sql)'
);

select is(
  array(select e.fn from esperado_acl e left join atual_acl a using (fn) where a.fn is null order by 1),
  '{}'::text[],
  'nenhuma função da lista sumiu (removeu de propósito? tire a linha da lista)'
);

select is(
  array(select format('%s: executável por "%s", a lista diz "%s"', a.fn, a.acl, e.acl)
        from atual_acl a join esperado_acl e using (fn) where a.acl <> e.acl order by 1),
  '{}'::text[],
  'quem executa cada função de public é exatamente o da lista (anon, authenticated, PUBLIC)'
);

/* ===================== Nada chama a internet nem aponta para a produção ===================== */
-- Um banco novo (o do GitHub, a cópia local de alguém) tem de ser incapaz de chamar a produção: endereço de
-- servidor fica em private.app_settings (vazia num banco novo), nunca no código.

-- Endereço de internet no código de função: proibido, fora a lista de exceções (hoje vazia). Se um dia uma
-- função precisar de um endereço fixo que NÃO seja de servidor do IMED (ex.: link para uma página pública),
-- acrescente '<schema>.<função>' na lista e explique ao lado.
select is(
  array(select format('%I.%I', n.nspname, p.proname)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private', 'agenda') and p.prosrc ~* 'https?://'
          and not exists (select 1 from pg_depend d
                          where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
          and format('%I.%I', n.nspname, p.proname) <> all (array[]::text[])
        order by 1),
  '{}'::text[],
  'nenhuma função com endereço de internet (http:// ou https://) no código (o endereço fica em private.app_settings)'
);

-- Sem exceção: endereço do Supabase (qualquer forma, inclusive <projeto>.functions.supabase.co ou montado em
-- pedaços com o código do projeto) em função ou job, e chamada HTTP direto no comando de um job.
select is(
  array(select format('função %I.%I', n.nspname, p.proname)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private', 'agenda')
          and p.prosrc ~* '(supabase\.(co|in|net)|pyoqiecupxhdzigjudyd)'
          and not exists (select 1 from pg_depend d
                          where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
        union all
        select format('job %s', j.jobname)
        from cron.job j
        where j.command ~* '(https?://|net\.http_|supabase\.(co|in|net)|pyoqiecupxhdzigjudyd)'
        order by 1),
  '{}'::text[],
  'nenhuma função nem job do pg_cron com endereço do Supabase, código do projeto ou chamada HTTP no comando'
);

-- Quem chama a internet pelo pg_net: só a fila de importação, como na produção (conferido em 31/10/2026).
-- Função nova que chame net.http_*: leia o endereço de private.app_settings e acrescente o nome aqui.
select is(
  array(select format('%I.%I', n.nspname, p.proname)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private', 'agenda') and p.prosrc ~* 'net\.http_'
          and not exists (select 1 from pg_depend d
                          where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
        order by 1),
  array['private.process_import_queue'],
  'só private.process_import_queue chama a internet (net.http_*), e lê o endereço de private.app_settings'
);

/* ===================== Pendências conhecidas (TODO: não reprovam) ===================== */

-- Já existia antes da 3.0 (revisão de segurança de 31/10/2026): anon e authenticated alcançam o schema net do
-- pg_net e leem net.http_request_queue (por onde o token interno passa por um instante, no cabeçalho
-- x-imed-token) e net._http_response.
-- DECISÃO DA 3.1: não dá para fechar por migração. Essas permissões foram dadas pelo supabase_admin (dono da extensão
-- pg_net, que as dá de novo sempre que a extensão é recriada: event trigger issue_pg_net_access), e o papel que
-- aplica as migrações (postgres) não tem GRANT OPTION nem é membro do supabase_admin: um REVOKE dele não teria efeito
-- (conferido na produção em 31/10/2026). Fechar de verdade = pedido ao suporte do Supabase. Enquanto isso, o risco
-- fica contido por guardas que reprovam: o schema net não é exposto pela API (config.toml; e o script
-- tests/banco/fora-das-migracoes.mjs confere no PostgREST local), nenhum Database Webhook (guarda abaixo) e só
-- private.process_import_queue chama net.http_* (guarda acima).
select todo_start('pg_net: só o suporte do Supabase fecha o schema net (o postgres não tem como; decisão da fase 3.1)');
select is(
  array(select r || ': ' || o
        -- PUBLIC também (na produção: =U no schema e arwdDxtm nas tabelas, dados pelo supabase_admin); o pedido ao
        -- suporte tem de incluir PUBLIC, senão revogar de anon e authenticated não fecha nada
        from unnest(array['anon', 'authenticated', 'public']) r,
             unnest(array['usage no schema net', 'select/insert em net.http_request_queue', 'select/insert em net._http_response']) o
        where case o when 'usage no schema net' then has_schema_privilege(r, 'net', 'USAGE')
                     when 'select/insert em net.http_request_queue' then has_table_privilege(r, 'net.http_request_queue', 'SELECT, INSERT')
                     else has_table_privilege(r, 'net._http_response', 'SELECT, INSERT') end
        order by 1),
  '{}'::text[],
  'anon e authenticated sem acesso ao schema net (onde o token interno passa)'
);
select todo_end();

-- Database Webhooks (gatilho que chama supabase_functions.http_request pelo pg_net) não é usado: na produção, nem o
-- schema supabase_functions existe (conferido em 31/10/2026). Se alguém ligar, esta guarda reprova e a decisão
-- sobre o schema net acima precisa ser revista.
select is(
  array(select format('%I.%I.%I', n.nspname, c.relname, g.tgname)
        from pg_trigger g
        join pg_class c on c.oid = g.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_proc p on p.oid = g.tgfoid
        where not g.tgisinternal
          and (p.pronamespace = to_regnamespace('supabase_functions') or p.proname = 'http_request')
        order by 1),
  '{}'::text[],
  'nenhum Database Webhook (gatilho que chama supabase_functions.http_request)'
);

/* ===================== O que fica fora das migrações (igual à produção) ===================== */

-- Tempo-limite de cada chamada pela API, por papel (conferido na produção em 31/10/2026: anon 3 s, authenticated 8 s).
-- Não vem das migrações: se o banco do CI ficar diferente da produção, os testes de tempo e de concorrência deixam de
-- valer para a produção. ("Confirm email" e os schemas expostos pela API não ficam no banco: quem confere é
-- tests/banco/fora-das-migracoes.mjs, no Auth e no PostgREST locais, contra o supabase/config.toml.)
select is(
  array(select r.rolname || ' ' || coalesce((select string_agg(c, ' ' order by c)
                                             from pg_db_role_setting s, unnest(s.setconfig) c
                                             where s.setrole = r.oid and s.setdatabase = 0 and c like 'statement\_timeout=%'),
                                            'sem statement_timeout')
        from pg_roles r where r.rolname in ('anon', 'authenticated') order by 1),
  array['anon statement_timeout=3s', 'authenticated statement_timeout=8s'],
  'tempos-limite dos papéis da API iguais aos da produção (anon 3 s, authenticated 8 s)'
);

/* ===================== Guardas das fases da agenda (as da 3.1 já valem; as seguintes, puladas até o objeto existir) ===================== */

-- 3.1: o schema agenda fica fora da API.
select case when to_regnamespace('agenda') is null
  then skip('fase 3.1: o schema agenda ainda não existe', 1)
  else is(array(select r::text from unnest(array['anon', 'authenticated', 'service_role']) r
                where has_schema_privilege(r, 'agenda', 'USAGE') order by 1),
          '{}'::text[], 'schema agenda sem USAGE para anon, authenticated e service_role')
end;

-- 3.1: toda tabela do schema agenda com RLS ligada, sem policy e sem permissão para os papéis da API.
select case when to_regnamespace('agenda') is null
  then skip('fase 3.1: o schema agenda ainda não existe', 1)
  else is(array(select c.relname || case when not c.relrowsecurity then ' (sem RLS)' else '' end
                       || case when exists (select 1 from pg_policy po where po.polrelid = c.oid) then ' (com policy)' else '' end
                       || case when exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r
                                            where has_table_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
                                               or has_any_column_privilege(r, c.oid, 'SELECT, INSERT, UPDATE'))
                               then ' (com permissão para a API)' else '' end
                from pg_class c
                where c.relnamespace = to_regnamespace('agenda') and c.relkind in ('r', 'p')
                  and (not c.relrowsecurity
                       or exists (select 1 from pg_policy po where po.polrelid = c.oid)
                       or exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r
                                  where has_table_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
                                     or has_any_column_privilege(r, c.oid, 'SELECT, INSERT, UPDATE')))
                order by 1),
          '{}'::text[], 'tabelas do schema agenda: RLS ligada, sem policy e sem permissão para a API')
end;

-- 3.1: o navegador grava SÓ as 23 colunas do site (INSERT por coluna, §2.3): nenhuma outra coluna de
-- appointment_requests (as novas, a situação, a conta, a data, quem cancelou, a versão...) tem INSERT para anon ou
-- authenticated, nem coluna que alguma migração futura criar.
select case when not exists (select 1 from pg_attribute
                             where attrelid = 'public.appointment_requests'::regclass and attname = 'channel' and not attisdropped)
  then skip('fase 3.1: appointment_requests ainda não tem as colunas novas', 1)
  else is(array(select r || ': ' || a.attname
                from pg_attribute a, unnest(array['anon', 'authenticated']) r
                where a.attrelid = 'public.appointment_requests'::regclass and a.attnum > 0 and not a.attisdropped
                  and a.attname not in (select col from colunas_do_site)
                  and has_column_privilege(r, 'public.appointment_requests'::regclass, a.attname, 'INSERT')
                order by 1),
          '{}'::text[], 'anon e authenticated só gravam (INSERT) as 23 colunas do site em appointment_requests')
end;

-- 3.1: trilhas só de acréscimo (UPDATE, DELETE e TRUNCATE barrados por gatilho).
select case when to_regclass('agenda.status_history') is null
  then skip('fase 3.1: as trilhas (agenda.status_history, audit_log, access_log) ainda não existem', 1)
  else is(array(select t
                from unnest(array['agenda.status_history', 'agenda.audit_log', 'agenda.access_log']) t
                where to_regclass(t) is null
                   -- tgtype: 8 = DELETE, 16 = UPDATE, 32 = TRUNCATE (um gatilho para cada um, ou um só para vários)
                   or not exists (select 1 from pg_trigger g
                                  where g.tgrelid = to_regclass(t) and not g.tgisinternal and (g.tgtype & 16) <> 0)
                   or not exists (select 1 from pg_trigger g
                                  where g.tgrelid = to_regclass(t) and not g.tgisinternal and (g.tgtype & 8) <> 0)
                   or not exists (select 1 from pg_trigger g
                                  where g.tgrelid = to_regclass(t) and not g.tgisinternal and (g.tgtype & 32) <> 0)
                order by 1),
          '{}'::text[], 'trilhas da agenda com guarda contra UPDATE, DELETE e TRUNCATE')
end;

-- 3.1: trilhas sem chave estrangeira (guardam o uuid; apagar um pedido não pode apagar o histórico dele; §2.1).
select case when to_regclass('agenda.status_history') is null
  then skip('fase 3.1: as trilhas ainda não existem', 1)
  else is(array(select co.conrelid::regclass::text || '.' || co.conname
                from pg_constraint co
                where co.contype = 'f'
                  and co.conrelid in (to_regclass('agenda.status_history'), to_regclass('agenda.audit_log'),
                                      to_regclass('agenda.access_log'))
                order by 1),
          '{}'::text[], 'trilhas da agenda sem chave estrangeira')
end;

-- 3.3: nenhuma função grava em agenda.occupancy com ON CONFLICT (pularia uma linha em silêncio; §2.5).
select case when to_regclass('agenda.occupancy') is null
  then skip('fase 3.3: agenda.occupancy ainda não existe', 1)
  else is(array(select format('%I.%I', n.nspname, p.proname)
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('public', 'private', 'agenda')
                  and p.prosrc ~* 'insert\s+into\s+agenda\.occupancy[^;]*on\s+conflict'
                order by 1),
          '{}'::text[], 'nenhuma função com INSERT ... ON CONFLICT em agenda.occupancy')
end;

-- 3.1: a equipe do IMED fica fora de admin_emails e o is_imed_admin continua só do dono (§12).
select case when to_regclass('private.imed_staff') is null
  then skip('fase 3.1: private.imed_staff ainda não existe', 1)
  else ok(not has_any_column_privilege('authenticated', 'private.imed_staff', 'SELECT')
          and not has_any_column_privilege('anon', 'private.imed_staff', 'SELECT'),
          'private.imed_staff fora do alcance de anon e authenticated')
end;

/* ===================== Marca de origem e gatilhos (fase 3.1) ===================== */

-- A marca de origem (imed.origin) e o motivo (imed.reason) só valem até o fim da transação: função que os defina
-- para a sessão inteira (set_config(..., false)) deixaria a marca numa conexão do PostgREST para o próximo cliente.
select is(
  array(select format('%I.%I', n.nspname, p.proname)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private', 'agenda')
          and p.prosrc ~* 'set_config\s*\(\s*''imed\.[a-z_]+''\s*,[^;]*,\s*false\s*\)'
          and not exists (select 1 from pg_depend d
                          where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
        order by 1),
  '{}'::text[],
  'nenhuma função define imed.* para a sessão inteira (só set_config(..., true), até o fim da transação)'
);

-- Nenhum gatilho desligado (ALTER TABLE ... DISABLE TRIGGER) em public, private e agenda ('O' = ligado; 'A' =
-- ligado sempre, inclusive com session_replication_role = replica; 'R' = só em replica; 'D' = desligado).
select is(
  array(select format('%I.%I.%I (%s)', n.nspname, c.relname, g.tgname, g.tgenabled)
        from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'private', 'agenda') and not g.tgisinternal and g.tgenabled not in ('O', 'A')
        order by 1),
  '{}'::text[],
  'nenhum gatilho desligado em public, private e agenda'
);

-- Guardas da agenda (gatilhos com função private.agenda_*) valem SEMPRE ('A'): com session_replication_role = replica,
-- que o dono do banco consegue ligar na produção, um gatilho comum não dispara e a guarda sumiria.
select is(
  array(select format('%I.%I.%I (%s)', n.nspname, c.relname, g.tgname, g.tgenabled)
        from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
        where not g.tgisinternal and g.tgfoid::regprocedure::text like 'private.agenda\_%' and g.tgenabled <> 'A'
        order by 1),
  '{}'::text[],
  'guardas da agenda ligadas sempre (ENABLE ALWAYS), também em session_replication_role = replica'
);

select * from finish();
rollback;
