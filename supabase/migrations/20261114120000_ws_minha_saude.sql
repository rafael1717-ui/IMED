-- "Minha Saúde", etapa 1 (a página do paciente com o que já é dele), 14/11/2026. Arquitetura:
-- memory/projects/imed-workspace-arquitetura.md (§6.5 "Minha Saúde" e a regra R4-b de vínculo; "Minha Saúde, etapa 1:
-- como ficou"). Volta: supabase/volta/<mesmo nome>.sql.
-- NOME PROVISÓRIO, AINDA NÃO APLICADA NA PRODUÇÃO (14/11/2026; ao aplicar, tire esta marca): só entra com a
-- aprovação do dono. Ao aplicar, siga os 5 passos de "Ao aplicar uma migração provisória na produção" do
-- .github/workflows/banco.yml (renomear esta e a volta com a versão que o conector gravar, tirar esta marca, tirar o
-- nome de PENDENTES_NA_PRODUCAO, renomear as outras provisórias para depois dela e trocar ULTIMA_NA_PRODUCAO).
--
-- Em linguagem simples: hoje o paciente da teleconsulta não tem conta. O aparelho guarda um código secreto da
-- consulta e é com ele que o paciente vê os documentos (receita, atestado, pedido de exames...). Trocou de aparelho,
-- perdeu. Esta migração deixa o paciente LOGADO guardar a consulta na conta dele, para abrir os mesmos documentos em
-- outro aparelho. É a regra R4-b da arquitetura: vale só para AQUELA consulta e só para os DOCUMENTOS dela; não cria
-- histórico entre consultas, não mostra as anotações do médico, os exames pedidos em rascunho nem as mensagens.
--   1. prontuario.saude_vinculos     a conta, a consulta, quando guardou e quando tirou. Uma consulta fica em no
--                                    máximo uma conta por vez;
--   2. saude_guardar(consulta, código do aparelho)   a pessoa logada prova que tem o código daquela consulta. Nunca
--                                    pelo celular nem pelo nome. Código errado: "não encontrada", sem dizer se a consulta
--                                    existe; 10 erros em 1 hora travam a conta por 1 hora;
--   3. saude_minhas_consultas()      as consultas guardadas na conta: data, situação, o médico (nome e CRM) e quantos
--                                    documentos há. Nada do conteúdo da consulta;
--   4. saude_documentos(consulta) e saude_documento_pdf(documento)   a lista dos documentos e o PDF assinado. Exigem
--                                    ENTRADA RECENTE (menos de 12 horas, lida do próprio token da sessão): com a
--                                    entrada antiga a resposta é "entre de novo";
--   5. saude_vinculo_revogar(consulta)   o paciente tira a consulta da conta (o registro do médico não muda);
--   6. toda chamada, permitida ou negada, fica na trilha de acesso do prontuário (prontuario.trilha_acesso).
-- O INTERRUPTOR: guardar na conta nasce DESLIGADO (private.app_settings, chave 'saude_guardar', valor 'ligado' para
-- ligar). O termo de hoje diz que os dados "são usados só para este atendimento"; guardar na conta é um pedido do
-- próprio paciente sobre os documentos dele, mas quem decide se o termo de hoje cobre isso é o advogado. Desligado,
-- saude_guardar responde "off" e nada é gravado; o resto continua valendo para o que já estiver guardado.
--
-- Só aditiva: uma tabela nova e seis funções novas. Nenhuma tabela, coluna, policy, permissão ou função existente
-- muda. Pode rodar de novo sem erro.
-- Conferir na produção depois de aplicar (tem de dar true):
--   select to_regclass('prontuario.saude_vinculos') is not null
--      and not has_function_privilege('anon', 'public.saude_guardar(uuid, text)', 'EXECUTE')
--      and has_function_privilege('authenticated', 'public.saude_minhas_consultas()', 'EXECUTE')
--      and not private.saude_guardar_ligado()
--      and (select count(*) from prontuario.saude_vinculos) = 0;
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

/* ===================== 1. Tabela ===================== */
create table if not exists prontuario.saude_vinculos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  teleconsulta_id uuid not null references public.teleconsultations (id) on delete cascade,
  alcance text not null default 'consulta' check (alcance = 'consulta'),          -- R4-b: só aquela consulta
  prova text not null default 'codigo_do_aparelho' check (prova = 'codigo_do_aparelho'),
  criado_em timestamptz not null default now(),
  revogado_em timestamptz,
  constraint saude_vinculos_revogacao_ck check (revogado_em is null or revogado_em >= criado_em)
);
-- uma consulta em no máximo uma conta por vez (o vínculo tirado fica guardado, sem valer)
create unique index if not exists saude_vinculos_consulta_uq on prontuario.saude_vinculos (teleconsulta_id) where revogado_em is null;
create index if not exists saude_vinculos_conta_idx on prontuario.saude_vinculos (user_id, criado_em);
alter table prontuario.saude_vinculos enable row level security;
revoke all on table prontuario.saude_vinculos from public, anon, authenticated, service_role;
comment on table prontuario.saude_vinculos is
  'Minha Saúde, etapa 1 (regra R4-b): consulta que o paciente logado guardou na conta dele, provando ter o código do aparelho. Alcance: só os documentos daquela consulta. Tirar = revogado_em (nada se apaga).';

/* ===================== 2. Sessão e interruptor ===================== */
-- A conta serve para o Minha Saúde? Logada de verdade (não anônima), com e-mail confirmado, não banida.
create or replace function private.saude_sessao()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
           select 1 from auth.users u
           where u.id = auth.uid()
             and u.email is not null and u.email_confirmed_at is not null and u.deleted_at is null
             and (u.banned_until is null or u.banned_until <= now())
             and not coalesce(u.is_anonymous, false))
     and not exists (
           select 1
           from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) m
           where coalesce(m ->> 'method', m #>> '{}') = 'anonymous');
$$;

-- A entrada (senha, link ou código) foi há menos de p_horas horas? O "amr" do token guarda a hora de cada entrada e
-- não muda quando o token é renovado: é a hora em que a pessoa provou quem é. Sem a hora, não vale.
create or replace function private.saude_entrada_recente(p_horas integer default 12)
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((
    select max((m ->> 'timestamp')::bigint)
    from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) m
    where jsonb_typeof(m) = 'object' and m ->> 'timestamp' ~ '^[0-9]{9,11}$'
  ) > extract(epoch from now() - make_interval(hours => p_horas)), false);
$$;

-- Guardar na conta está ligado? Nasce desligado: só com a linha ('saude_guardar', 'ligado') em private.app_settings.
create or replace function private.saude_guardar_ligado()
returns boolean
language sql stable
set search_path = ''
as $$ select exists (select 1 from private.app_settings s where s.key = 'saude_guardar' and s.value = 'ligado') $$;

-- O vínculo ativo desta conta com a consulta (nulo = não tem).
create or replace function private.saude_vinculo(p_consulta uuid)
returns uuid
language sql stable
set search_path = ''
as $$
  select v.id from prontuario.saude_vinculos v
  where v.teleconsulta_id = p_consulta and v.user_id = auth.uid() and v.revogado_em is null;
$$;
revoke all on function private.saude_sessao() from public, anon, authenticated, service_role;
revoke all on function private.saude_entrada_recente(integer) from public, anon, authenticated, service_role;
revoke all on function private.saude_guardar_ligado() from public, anon, authenticated, service_role;
revoke all on function private.saude_vinculo(uuid) from public, anon, authenticated, service_role;

/* ===================== 3. Guardar e tirar ===================== */
create or replace function public.saude_guardar(p_consulta uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teleconsultations;
  v_outro uuid;
  v_erros integer;
begin
  if auth.uid() is null or not private.saude_sessao() then return jsonb_build_object('status', 'forbidden'); end if;
  if not private.saude_guardar_ligado() then return jsonb_build_object('status', 'off'); end if;
  if p_consulta is null or coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status', 'invalid'); end if;
  -- 10 códigos errados em 1 hora: a conta espera (ninguém fica tentando adivinhar o código de uma consulta)
  select count(*) into v_erros from prontuario.trilha_acesso a
  where a.user_id = auth.uid() and a.fn = 'saude_guardar' and a.resultado = 'negado' and a.motivo = 'codigo_errado'
    and a.em > now() - interval '1 hour';
  if v_erros >= 10 then
    perform private.ws_trilha('saude_guardar', 'negado', 'muitas_tentativas', 'paciente', null);
    return jsonb_build_object('status', 'too_many');
  end if;
  select * into t from public.teleconsultations x
  where x.id = p_consulta and x.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and x.anonymized_at is null;
  if not found then
    -- sem dizer se a consulta existe: a mesma resposta para id errado, código errado e consulta apagada
    perform private.ws_trilha('saude_guardar', 'negado', 'codigo_errado', 'paciente', null);
    return jsonb_build_object('status', 'not_found');
  end if;
  -- uma consulta de cada vez na mesma transação (dois aparelhos guardando juntos)
  perform pg_advisory_xact_lock(7301, hashtext(t.id::text));
  if private.saude_vinculo(t.id) is not null then
    return jsonb_build_object('status', 'ok', 'unchanged', true);
  end if;
  select v.user_id into v_outro from prontuario.saude_vinculos v where v.teleconsulta_id = t.id and v.revogado_em is null;
  if v_outro is not null then
    perform private.ws_trilha('saude_guardar', 'negado', 'ja_guardada_em_outra_conta', 'paciente', t.id);
    return jsonb_build_object('status', 'already_linked');
  end if;
  insert into prontuario.saude_vinculos (user_id, teleconsulta_id) values (auth.uid(), t.id);
  perform private.ws_trilha('saude_guardar', 'permitido', null, 'paciente', t.id);
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.saude_vinculo_revogar(p_consulta uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not private.saude_sessao() then return jsonb_build_object('status', 'forbidden'); end if;
  v_id := private.saude_vinculo(p_consulta);
  if v_id is null then return jsonb_build_object('status', 'not_found'); end if;
  update prontuario.saude_vinculos v set revogado_em = now() where v.id = v_id;
  perform private.ws_trilha('saude_vinculo_revogar', 'permitido', null, 'paciente', p_consulta);
  return jsonb_build_object('status', 'ok');
end $$;

/* ===================== 4. Ler ===================== */
-- As consultas guardadas na conta (as mais novas primeiro; até 50). Só o que identifica a consulta para o paciente:
-- a data, a situação, o médico e quantos documentos valem. Nada do conteúdo.
create or replace function public.saude_minhas_consultas()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.saude_sessao() then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object(
    'status', 'ok',
    'can_save', private.saude_guardar_ligado(),
    'recent', private.saude_entrada_recente(12),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'consultation_id', t.id, 'saved_at', v.criado_em, 'consultation_status', t.status,
               'created_at', t.created_at, 'ended_at', t.ended_at,
               'doctor', case when t.doctor_info is not null then jsonb_build_object(
                           'name', t.doctor_info ->> 'full_name', 'crm', t.doctor_info ->> 'crm', 'crm_uf', t.doctor_info ->> 'crm_uf') end,   -- doctor_info: a foto do médico no atendimento
               'documents', (select count(*) from public.tele_documents d where d.consultation_id = t.id and d.status = 'emitido'))
               order by coalesce(t.ended_at, t.created_at) desc, t.id)
      from (select * from prontuario.saude_vinculos x where x.user_id = auth.uid() and x.revogado_em is null
            order by x.criado_em desc limit 50) v
      join public.teleconsultations t on t.id = v.teleconsulta_id and t.anonymized_at is null), '[]'::jsonb));
end $$;

-- Os documentos de uma consulta guardada (sem o conteúdo: o tipo, o código de conferência, a situação e se já tem o
-- PDF assinado). Exige a entrada recente.
create or replace function public.saude_documentos(p_consulta uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.saude_sessao() then return jsonb_build_object('status', 'forbidden'); end if;
  if private.saude_vinculo(p_consulta) is null
     or not exists (select 1 from public.teleconsultations t where t.id = p_consulta and t.anonymized_at is null) then
    perform private.ws_trilha('saude_documentos', 'negado', 'sem_vinculo', 'paciente', null);
    return jsonb_build_object('status', 'not_found');
  end if;
  if not private.saude_entrada_recente(12) then
    perform private.ws_trilha('saude_documentos', 'negado', 'entrada_antiga', 'paciente', p_consulta);
    return jsonb_build_object('status', 'reauth');
  end if;
  perform private.ws_trilha('saude_documentos', 'permitido', null, 'paciente', p_consulta);
  return jsonb_build_object('status', 'ok', 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id, 'kind', d.kind, 'code', d.code, 'document_status', d.status, 'created_at', d.created_at,
             'cancelled_at', d.cancelled_at, 'cancel_reason', d.cancel_reason, 'signed', d.signed_at is not null,
             'signed_at', d.signed_at, 'has_pdf', exists (select 1 from public.tele_document_files f where f.document_id = d.id))
             order by d.created_at, d.id)
    from (select * from public.tele_documents x where x.consultation_id = p_consulta order by x.created_at, x.id limit 100) d), '[]'::jsonb));
end $$;

-- O PDF assinado de um documento (base64, sem quebras de linha). Exige o vínculo ativo e a entrada recente.
-- Documento cancelado não se baixa; documento ainda sem o PDF assinado responde "no_pdf".
create or replace function public.saude_documento_pdf(p_doc uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.tele_documents;
  v_b64 text;
begin
  if auth.uid() is null or not private.saude_sessao() then return jsonb_build_object('status', 'forbidden'); end if;
  select x.* into d from public.tele_documents x
  join public.teleconsultations t on t.id = x.consultation_id and t.anonymized_at is null
  where x.id = p_doc and private.saude_vinculo(x.consultation_id) is not null;
  if not found then
    perform private.ws_trilha('saude_documento_pdf', 'negado', 'sem_vinculo', 'paciente', null);
    return jsonb_build_object('status', 'not_found');
  end if;
  if not private.saude_entrada_recente(12) then
    perform private.ws_trilha('saude_documento_pdf', 'negado', 'entrada_antiga', 'paciente', d.consultation_id, 'tele_document', d.id);
    return jsonb_build_object('status', 'reauth');
  end if;
  if d.status = 'cancelado' then return jsonb_build_object('status', 'cancelled'); end if;
  select translate(encode(f.pdf, 'base64'), E'\n', '') into v_b64 from public.tele_document_files f where f.document_id = d.id;
  if v_b64 is null then return jsonb_build_object('status', 'no_pdf'); end if;
  perform private.ws_trilha('saude_documento_pdf', 'permitido', null, 'paciente', d.consultation_id, 'tele_document', d.id);
  return jsonb_build_object('status', 'ok', 'kind', d.kind, 'code', d.code, 'pdf', v_b64);
end $$;

revoke all on function public.saude_guardar(uuid, text) from public, anon, authenticated;
grant execute on function public.saude_guardar(uuid, text) to authenticated;
revoke all on function public.saude_vinculo_revogar(uuid) from public, anon, authenticated;
grant execute on function public.saude_vinculo_revogar(uuid) to authenticated;
revoke all on function public.saude_minhas_consultas() from public, anon, authenticated;
grant execute on function public.saude_minhas_consultas() to authenticated;
revoke all on function public.saude_documentos(uuid) from public, anon, authenticated;
grant execute on function public.saude_documentos(uuid) to authenticated;
revoke all on function public.saude_documento_pdf(uuid) from public, anon, authenticated;
grant execute on function public.saude_documento_pdf(uuid) to authenticated;
comment on function public.saude_guardar(uuid, text) is
  'Minha Saúde: o paciente logado guarda uma teleconsulta na conta, provando ter o código do aparelho (R4-b: só os documentos daquela consulta). Nasce desligado (private.app_settings saude_guardar). 10 códigos errados em 1 hora travam. Fica na trilha.';
comment on function public.saude_vinculo_revogar(uuid) is
  'Minha Saúde: o paciente tira a consulta da conta dele (revogado_em). O registro do médico não muda.';
comment on function public.saude_minhas_consultas() is
  'Minha Saúde: as consultas guardadas na conta (data, situação, médico e número de documentos), sem conteúdo.';
comment on function public.saude_documentos(uuid) is
  'Minha Saúde: os documentos de uma consulta guardada (tipo, código, situação, se tem PDF), sem o conteúdo. Exige entrada há menos de 12 horas. Fica na trilha.';
comment on function public.saude_documento_pdf(uuid) is
  'Minha Saúde: o PDF assinado de um documento de consulta guardada. Exige entrada há menos de 12 horas; cancelado não se baixa. Fica na trilha.';
