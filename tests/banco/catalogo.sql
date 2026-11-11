-- "Impressão digital" do banco do IMED: uma linha curta por objeto, "<tipo> <objeto> <hash>".
-- O hash (12 primeiros caracteres do MD5) cobre a definição inteira do objeto, NORMALIZADA: corpo de função sem
-- comentários e com os espaços juntados, permissões em ordem alfabética, sem oids e sem o id ou o estado dos jobs.
-- Tipos: schema, extensao (nome e schema; a versão fica de fora), funcao, tabela (colunas, RLS, dono e permissões,
-- inclusive por coluna), restricao, indice, policy, gatilho, tipo, job (pg_cron), padrao (privilégios padrão do
-- dono postgres) e publicacao.
--
-- Serve para duas coisas:
--   1. banco.yml: o banco que nasce SEM as migrações que têm volta (F0) e o banco COM todas (F1); depois dos testes,
--      a volta tem de deixar o banco igual a F0, e a reaplicação, igual a F1 (linha a linha).
--   2. Conferir que o banco do CI é igual ao da PRODUÇÃO: o SQL é só leitura (um SELECT) e roda também na produção
--      (conector Supabase). Junte as linhas por tipo com "node tests/banco/anotar.mjs impressao <arquivo>" e compare
--      com a linha "Impressão digital" do resumo do banco.yml (ou as linhas inteiras: banco.yml rodado à mão com
--      impressao=todos, ou só alguns tipos, como impressao=funcao,tabela).
--
-- Rode como postgres (o search_path dele, "$user", public, extensions, é o mesmo na produção e no CI e entra na
-- forma como os tipos aparecem nas definições).
--   psql "$DB_URL" -qAt -f tests/banco/catalogo.sql > impressao.txt
with esquemas as (
  select oid, nspname from pg_namespace where nspname in ('public', 'private', 'agenda', 'prontuario', 'catalogo', 'pagamentos')
),
-- objetos que pertencem a uma extensão (PostGIS, pg_net...) ficam de fora: não são do IMED
de_extensao as (
  select classid, objid from pg_depend where deptype = 'e'
)
select linha from (
  select format('schema %s %s', n.nspname,
                left(md5(concat_ws('|', pg_get_userbyid(n.nspowner),
                                   coalesce((select string_agg(a::text, ',' order by a::text) from unnest(n.nspacl) a), '-'))), 12)) as linha
  from pg_namespace n where n.nspname in ('public', 'private', 'agenda', 'prontuario', 'catalogo', 'pagamentos')

  union all
  select format('extensao %s %s', e.extname, e.extnamespace::regnamespace) from pg_extension e

  union all
  select format('funcao %s.%s(%s) %s', n.nspname, p.proname, oidvectortypes(p.proargtypes),
                left(md5(concat_ws('|', pg_get_userbyid(p.proowner),
                                   (select string_agg(a::text, ',' order by a::text)
                                    from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a),
                                   btrim(regexp_replace(regexp_replace(regexp_replace(pg_get_functiondef(p.oid),
                                         '/\*.*?\*/', '', 'g'), '--[^' || chr(10) || ']*', '', 'g'), '\s+', ' ', 'g')))), 12))
  from pg_proc p join esquemas n on n.oid = p.pronamespace
  where p.prokind <> 'a'
    and not exists (select 1 from de_extensao d where d.classid = 'pg_proc'::regclass and d.objid = p.oid)

  union all
  select format('tabela %s.%s %s', n.nspname, c.relname,
                left(md5(concat_ws('|', c.relkind, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner),
                                   coalesce((select string_agg(a::text, ',' order by a::text) from unnest(c.relacl) a), '-'),
                                   coalesce((select string_agg(format('%s:%s:%s:%s:%s:%s:%s', a.attname,
                                                     format_type(a.atttypid, a.atttypmod), a.attnotnull,
                                                     coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''), a.attidentity,
                                                     a.attgenerated,
                                                     coalesce((select string_agg(x::text, ',' order by x::text)
                                                               from unnest(a.attacl) x), '')), ',' order by a.attnum)
                                             from pg_attribute a
                                             left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
                                             where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '-'),
                                   case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid) else '-' end)), 12))
  from pg_class c join esquemas n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    and not exists (select 1 from de_extensao d where d.classid = 'pg_class'::regclass and d.objid = c.oid)

  union all
  select format('restricao %s.%s.%s %s', n.nspname,
                coalesce((select c.relname from pg_class c where c.oid = co.conrelid),
                         (select t.typname from pg_type t where t.oid = co.contypid)),
                co.conname, left(md5(pg_get_constraintdef(co.oid)), 12))
  from pg_constraint co join esquemas n on n.oid = co.connamespace

  union all
  select format('indice %s.%s %s', n.nspname, ic.relname, left(md5(pg_get_indexdef(i.indexrelid)), 12))
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  join esquemas n on n.oid = ic.relnamespace
  where not exists (select 1 from de_extensao d where d.classid = 'pg_class'::regclass and d.objid = i.indrelid)

  union all
  select format('policy %s.%s.%s %s', po.schemaname, po.tablename, replace(po.policyname, ' ', '_'),
                left(md5(concat_ws('|', po.permissive, po.cmd,
                                   (select string_agg(r, ',' order by r) from unnest(po.roles) r),
                                   coalesce(po.qual, '-'), coalesce(po.with_check, '-'))), 12))
  from pg_policies po where po.schemaname in ('public', 'private', 'agenda', 'prontuario', 'catalogo', 'pagamentos')

  union all
  select format('gatilho %s.%s.%s %s', n.nspname, c.relname, g.tgname,
                left(md5(concat_ws('|', pg_get_triggerdef(g.oid), g.tgenabled)), 12))
  from pg_trigger g join pg_class c on c.oid = g.tgrelid join esquemas n on n.oid = c.relnamespace
  where not g.tgisinternal

  union all
  select format('tipo %s.%s %s', n.nspname, t.typname,
                left(md5(concat_ws('|', t.typtype, pg_get_userbyid(t.typowner),
                                   coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder)
                                             from pg_enum e where e.enumtypid = t.oid), '-'),
                                   coalesce(format_type(t.typbasetype, t.typtypmod), '-'))), 12))
  from pg_type t join esquemas n on n.oid = t.typnamespace
  where t.typtype in ('e', 'd', 'c', 'r')
    and (t.typtype <> 'c' or (select c.relkind from pg_class c where c.oid = t.typrelid) = 'c')
    and not exists (select 1 from de_extensao d where d.classid = 'pg_type'::regclass and d.objid = t.oid)

  union all
  select format('job %s %s', j.jobname,
                left(md5(concat_ws('|', j.schedule, btrim(regexp_replace(j.command, '\s+', ' ', 'g')), j.username,
                                   j.database)), 12))
  from cron.job j

  union all
  select format('padrao %s/%s/%s %s', pg_get_userbyid(d.defaclrole),
                coalesce(nullif(d.defaclnamespace, 0)::regnamespace::text, 'todos'), d.defaclobjtype,
                left(md5(coalesce((select string_agg(a::text, ',' order by a::text) from unnest(d.defaclacl) a), '-')), 12))
  from pg_default_acl d
  where d.defaclrole = 'postgres'::regrole
    and (d.defaclnamespace = 0 or d.defaclnamespace in (select oid from esquemas))

  union all
  select format('publicacao %s %s.%s', pt.pubname, pt.schemaname, pt.tablename)
  from pg_publication_tables pt where pt.schemaname in ('public', 'private', 'agenda', 'prontuario', 'catalogo', 'pagamentos')
) s
order by linha collate "C";
