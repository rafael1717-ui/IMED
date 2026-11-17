-- Receita completa, etapa 1 (receita montada por campos, rascunho guardado, modelos do médico e conferência da lista
-- de controle no servidor), 16/11/2026. Arquitetura: memory/projects/imed-workspace-arquitetura.md (§5 "Prescrição",
-- fases 3.1 e 3.2; "§5.5 Etapa 1: como ficou"). Volta: supabase/volta/<mesmo nome>.sql.
-- Aplicada na produção em 17/11/2026, com a aprovação do dono ("pode publicar tudo"), junto com o site; o nome do
-- arquivo é a versão que o banco gravou (o texto gravado lá é este, com a marca de nome provisório que havia no
-- lugar destas três linhas: só comentário mudou).
--
-- Em linguagem simples: hoje a receita do IMED é digitada inteira à mão, o rascunho fica só na tela e a única
-- conferência de remédio controlado é um aviso na tela. Esta migração guarda o rascunho da receita no servidor,
-- guarda os modelos de cada médico e confere, no servidor, o nome de cada remédio contra a lista de controle.
--   1. catalogo.med_regras           os nomes que travam a receita simples (antibiótico, caneta GLP-1, Portaria 344).
--                                    Carga inicial: os MESMOS 40 nomes que a tela já avisa hoje (RX_ALERTS do site).
--                                    Nenhum nome novo. A equipe médica lança e retira nomes (nada é apagado);
--   2. gatilho em public.tele_documents (só kind = 'receita'): nome da lista no medicamento de qualquer item recusa
--                                    a emissão com 'receita_bloqueada' (detail 'lista'). Vale para o caminho novo e
--                                    para o antigo (tele_doc_create), sem mudar nenhuma função que já existe;
--   3. prontuario.prescricoes        a receita de uma consulta: um rascunho por vez (jsonb com versão; duas abas =
--                                    versao_conflito) e as emitidas (imutáveis, ligadas ao documento);
--      prontuario.prescricao_itens   os itens gravados na emissão, campo a campo, com a marca "modo de usar editado
--                                    à mão" (o texto impresso é o que manda);
--      prontuario.prescricao_modelos os modelos do médico (sem consulta e sem paciente);
--   4. ws_receita_abrir / ws_receita_salvar / ws_receita_emitir   só o médico da consulta, pelas mesmas regras do
--                                    registro (private.ws_acesso), tudo na trilha. Emitir monta o MESMO payload da
--                                    receita simples de hoje e chama public.tele_doc_create: o PDF, o que o paciente
--                                    vê e a assinatura não mudam;
--   5. ws_receita_modelos / ws_receita_modelo_salvar / ws_receita_modelo_apagar   só o médico aprovado, só os dele;
--   6. cat_regras_receita()          a lista vigente, para a tela marcar o item antes de emitir (médico ou equipe);
--      cat_regra_listar / cat_regra_lancar / cat_regra_retirar   só a equipe do IMED (is_imed_admin).
-- O QUE NÃO MUDA: os tipos bloqueados (private.tele_receita_liberada continua só 'simples'); o SNCR; o catálogo de
-- remédios (não há: o nome continua em campo livre). A lista é curta e só RECUSA: nunca libera nem classifica; a
-- responsabilidade de classificar o remédio continua do médico (a tela diz isso).
--
-- Só aditiva: quatro tabelas, um gatilho novo em public.tele_documents e funções novas. Nenhuma tabela, coluna,
-- policy, permissão ou função existente muda. Pode rodar de novo sem erro.
-- Conferir na produção depois de aplicar (tem de dar true):
--   select to_regclass('prontuario.prescricoes') is not null
--      and (select count(*) from catalogo.med_regras where retirada_em is null) = 40
--      and exists (select 1 from pg_trigger where tgname = 'tele_documents_rx_lista' and not tgisinternal)
--      and not has_function_privilege('anon', 'public.ws_receita_emitir(uuid, integer, jsonb, boolean)', 'EXECUTE')
--      and has_function_privilege('authenticated', 'public.ws_receita_abrir(uuid, text)', 'EXECUTE')
--      and (select count(*) from prontuario.prescricoes) = 0;
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

/* ===================== 1. A lista de controle ===================== */
create table if not exists catalogo.med_regras (
  id uuid primary key default gen_random_uuid(),
  nome_busca text not null check (nome_busca ~ '^[a-z0-9]+( [a-z0-9]+)*$' and char_length(nome_busca) between 3 and 60),
  lista text not null check (lista in ('antimicrobiano', 'glp1', 'portaria_344')),
  fonte text not null check (char_length(btrim(fonte)) between 5 and 300),
  vigente_desde timestamptz not null default now(),
  lancado_por uuid,
  retirada_em timestamptz,
  retirada_por uuid,
  retirada_motivo text check (retirada_motivo is null or char_length(btrim(retirada_motivo)) between 5 and 300),
  check ((retirada_em is null) = (retirada_motivo is null))
);
comment on table catalogo.med_regras is
  'Nomes (sem acento, minúsculos) que travam a receita simples: antibiótico, caneta GLP-1 e Portaria 344. Só recusa, nunca libera. Lançados pela equipe médica com a fonte; retirar não apaga.';
create unique index if not exists med_regras_nome_vigente on catalogo.med_regras (nome_busca) where retirada_em is null;
alter table catalogo.med_regras enable row level security;
revoke all on table catalogo.med_regras from public, anon, authenticated, service_role;

-- Nada se apaga; a única mudança aceita é retirar (uma vez), sem tocar no nome, na lista nem na fonte.
create or replace function private.rx_regra_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('TRUNCATE', 'DELETE') then
    raise exception 'lista_de_controle: nome lançado não se apaga (retire, com o motivo)' using errcode = 'P0001';
  end if;
  if old.retirada_em is not null then
    raise exception 'lista_de_controle: nome já retirado não muda' using errcode = 'P0001';
  end if;
  if new.id <> old.id or new.nome_busca <> old.nome_busca or new.lista <> old.lista or new.fonte <> old.fonte
     or new.vigente_desde <> old.vigente_desde or new.lancado_por is distinct from old.lancado_por then
    raise exception 'lista_de_controle: o que foi lançado não muda' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.rx_regra_guard() from public, anon, authenticated, service_role;
create or replace trigger med_regras_guard before update or delete on catalogo.med_regras
  for each row execute function private.rx_regra_guard();
create or replace trigger med_regras_guard_truncate before truncate on catalogo.med_regras
  for each statement execute function private.rx_regra_guard();

-- Carga inicial: os nomes que a tela já avisa hoje (assets/js/tele-docs.js, RX_ALERTS). Um teste do site compara as
-- duas listas. Nome que já existe (mesmo retirado) não entra de novo.
insert into catalogo.med_regras (nome_busca, lista, fonte)
select v.nome, v.lista, 'Lista de alerta do IMED, mantida pelo responsável técnico (RX_ALERTS do site, 16/11/2026)'
from (values
  ('amoxicilina', 'antimicrobiano'), ('clavulanato', 'antimicrobiano'), ('azitromicina', 'antimicrobiano'), ('claritromicina', 'antimicrobiano'),
  ('cefalexina', 'antimicrobiano'), ('cefuroxima', 'antimicrobiano'), ('ciprofloxacino', 'antimicrobiano'), ('levofloxacino', 'antimicrobiano'),
  ('sulfametoxazol', 'antimicrobiano'), ('nitrofurantoina', 'antimicrobiano'), ('doxiciclina', 'antimicrobiano'), ('amoxil', 'antimicrobiano'),
  ('clavulin', 'antimicrobiano'), ('zitromax', 'antimicrobiano'), ('bactrim', 'antimicrobiano'), ('semaglutida', 'glp1'),
  ('liraglutida', 'glp1'), ('tirzepatida', 'glp1'), ('dulaglutida', 'glp1'), ('ozempic', 'glp1'),
  ('wegovy', 'glp1'), ('rybelsus', 'glp1'), ('mounjaro', 'glp1'), ('saxenda', 'glp1'),
  ('victoza', 'glp1'), ('trulicity', 'glp1'), ('clonazepam', 'portaria_344'), ('alprazolam', 'portaria_344'),
  ('diazepam', 'portaria_344'), ('zolpidem', 'portaria_344'), ('sertralina', 'portaria_344'), ('fluoxetina', 'portaria_344'),
  ('escitalopram', 'portaria_344'), ('rivotril', 'portaria_344'), ('frontal', 'portaria_344'), ('valium', 'portaria_344'),
  ('stilnox', 'portaria_344'), ('zoloft', 'portaria_344'), ('prozac', 'portaria_344'), ('lexapro', 'portaria_344')
) as v(nome, lista)
where not exists (select 1 from catalogo.med_regras r where r.nome_busca = v.nome);

-- Itens (no formato da receita emitida: [{medicamento, ...}]) cujo medicamento traz um nome vigente da lista, como
-- palavra inteira. Devolve [{n, nome, termo, lista}] ([] = nada bateu).
create or replace function private.rx_conferir(p_itens jsonb)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('n', x.n, 'nome', left(x.med, 200), 'termo', m.nome_busca, 'lista', m.lista) order by x.n), '[]'::jsonb)
  from (select i.n::integer as n, i.e ->> 'medicamento' as med, private.ws_fold(i.e ->> 'medicamento') as dobrado
        from jsonb_array_elements(case when jsonb_typeof(p_itens) = 'array' then p_itens else '[]'::jsonb end) with ordinality as i(e, n)
        where jsonb_typeof(i.e) = 'object') x
  cross join lateral (select r.nome_busca, r.lista
                      from catalogo.med_regras r
                      where r.retirada_em is null and x.dobrado ~ ('(^|[^a-z0-9])' || r.nome_busca || '([^a-z0-9]|$)')
                      order by char_length(r.nome_busca) desc, r.nome_busca
                      limit 1) m;
$$;
revoke all on function private.rx_conferir(jsonb) from public, anon, authenticated, service_role;

-- O gatilho: receita com nome da lista não entra em public.tele_documents, venha de onde vier.
create or replace function private.rx_doc_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v jsonb := private.rx_conferir(new.payload -> 'itens');
begin
  if jsonb_array_length(v) > 0 then
    raise exception 'receita_bloqueada' using errcode = 'P0001', detail = 'lista',
      hint = (select string_agg('item ' || (x ->> 'n') || ': ' || (x ->> 'termo'), '; ' order by (x ->> 'n')::integer) from jsonb_array_elements(v) x);
  end if;
  return new;
end $$;
revoke all on function private.rx_doc_guard() from public, anon, authenticated, service_role;
create or replace trigger tele_documents_rx_lista before insert on public.tele_documents
  for each row when (new.kind = 'receita') execute function private.rx_doc_guard();

/* ===================== 2. Tabelas da receita ===================== */
create table if not exists prontuario.prescricoes (
  id uuid primary key default gen_random_uuid(),
  teleconsulta_id uuid not null references public.teleconsultations (id) on delete restrict,
  medico_id uuid not null references public.doctors (id) on delete restrict,
  situacao text not null check (situacao in ('rascunho', 'emitida')),
  conteudo jsonb not null check (jsonb_typeof(conteudo) = 'object' and pg_column_size(conteudo) <= 100000),
  versao integer not null default 1 check (versao >= 1),
  salvo_em timestamptz not null default now(),
  documento_id uuid unique references public.tele_documents (id) on delete restrict,
  emitida_em timestamptz,
  criado_em timestamptz not null default now(),
  check ((situacao = 'rascunho') = (documento_id is null)),
  check ((situacao = 'emitida') = (emitida_em is not null))
);
comment on table prontuario.prescricoes is
  'Receita de uma teleconsulta: um rascunho por vez (jsonb com versão) e as emitidas, imutáveis e ligadas ao documento (private.rx_guard).';
create unique index if not exists prescricoes_um_rascunho on prontuario.prescricoes (teleconsulta_id) where situacao = 'rascunho';
create index if not exists prescricoes_consulta on prontuario.prescricoes (teleconsulta_id, criado_em desc);
create index if not exists prescricoes_medico on prontuario.prescricoes (medico_id, criado_em desc);

create table if not exists prontuario.prescricao_itens (
  id uuid primary key default gen_random_uuid(),
  prescricao_id uuid not null references prontuario.prescricoes (id) on delete restrict,
  ordem smallint not null check (ordem between 1 and 20),
  tipo text not null check (tipo in ('industrializado', 'manipulado')),
  medicamento text not null,
  concentracao text,
  forma text,
  composicao text,
  dose text,
  dose_unidade text,
  via text not null check (via in ('oral', 'sublingual', 'subcutanea', 'intramuscular', 'intravenosa', 'topica', 'inalatoria',
    'nasal', 'oftalmica', 'otologica', 'retal', 'vaginal', 'transdermica', 'outra')),
  via_outra text,
  frequencia jsonb,
  duracao jsonb,
  quantidade text not null,
  orientacoes text,
  posologia_texto text not null,
  posologia_editada_a_mao boolean not null default false,
  unique (prescricao_id, ordem),
  check ((tipo = 'manipulado') = (composicao is not null)),
  check ((via = 'outra') = (via_outra is not null))
);
comment on table prontuario.prescricao_itens is
  'Itens da receita emitida, campo a campo. O texto impresso (posologia_texto) é o que manda; se foi editado à mão, os campos não alimentam conferências.';

create table if not exists prontuario.prescricao_modelos (
  id uuid primary key default gen_random_uuid(),
  medico_id uuid not null references public.doctors (id) on delete restrict,
  nome text not null check (char_length(nome) between 2 and 80),
  conteudo jsonb not null check (jsonb_typeof(conteudo) = 'object' and pg_column_size(conteudo) <= 100000),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  apagado_em timestamptz
);
comment on table prontuario.prescricao_modelos is 'Modelos de receita de cada médico (sem consulta e sem paciente). Apagar só marca.';
create unique index if not exists prescricao_modelos_nome on prontuario.prescricao_modelos (medico_id, lower(nome)) where apagado_em is null;

alter table prontuario.prescricoes enable row level security;
alter table prontuario.prescricao_itens enable row level security;
alter table prontuario.prescricao_modelos enable row level security;
revoke all on table prontuario.prescricoes from public, anon, authenticated, service_role;
revoke all on table prontuario.prescricao_itens from public, anon, authenticated, service_role;
revoke all on table prontuario.prescricao_modelos from public, anon, authenticated, service_role;

-- Receita: o rascunho muda (só pelas funções); emitida nunca muda. Nada se apaga. A identidade nunca muda.
create or replace function private.rx_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'prontuario_imutavel: % não pode ser esvaziada', tg_table_name using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'prontuario_imutavel: receita não se apaga' using errcode = 'P0001';
  end if;
  if old.situacao <> 'rascunho' then
    raise exception 'prontuario_imutavel: receita emitida não muda (cancele o documento e emita outra)' using errcode = 'P0001';
  end if;
  if new.id <> old.id or new.teleconsulta_id <> old.teleconsulta_id or new.medico_id <> old.medico_id or new.criado_em <> old.criado_em then
    raise exception 'prontuario_imutavel: identidade da receita não muda' using errcode = 'P0001';
  end if;
  if new.versao < old.versao then
    raise exception 'prontuario_imutavel: versão não volta' using errcode = 'P0001';
  end if;
  return new;
end $$;
-- Itens: só entram enquanto a receita ainda é rascunho (no ato de emitir); depois, nada muda nem se apaga.
create or replace function private.rx_item_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'prontuario_imutavel: % não muda nem se apaga', tg_table_name using errcode = 'P0001';
  end if;
  if not exists (select 1 from prontuario.prescricoes r where r.id = new.prescricao_id and r.situacao = 'rascunho') then
    raise exception 'prontuario_imutavel: % só entra na receita ainda não emitida', tg_table_name using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.rx_guard() from public, anon, authenticated, service_role;
revoke all on function private.rx_item_guard() from public, anon, authenticated, service_role;
create or replace trigger prescricoes_guard before update or delete on prontuario.prescricoes
  for each row execute function private.rx_guard();
create or replace trigger prescricoes_guard_truncate before truncate on prontuario.prescricoes
  for each statement execute function private.rx_guard();
create or replace trigger prescricao_itens_guard before insert or update or delete on prontuario.prescricao_itens
  for each row execute function private.rx_item_guard();
create or replace trigger prescricao_itens_guard_truncate before truncate on prontuario.prescricao_itens
  for each statement execute function private.ws_so_acrescimo();

/* ===================== 3. Regras do conteúdo ===================== */
-- O rascunho: {itens: [até 20], observacao}. Cada item, só com estas chaves (todas opcionais no rascunho):
--   tipo ('industrializado' | 'manipulado'), medicamento, concentracao, forma, composicao (manipulado), dose, unidade,
--   via (lista fechada) e via_outra, freq_modo ('intervalo' | 'vezes' | 'uma' | 'se_precisar' | 'outra'), freq_n,
--   freq_texto, dur_modo ('dias' | 'continuo' | 'outra'), dur_n, dur_texto, quantidade, orientacoes, posologia (o
--   modo de usar por extenso, que é o que sai impresso) e posologia_manual (o médico editou o texto à mão).
-- Devolve o campo com problema ('itens.2.via') ou null.
create or replace function private.rx_conteudo_erro(p jsonb)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_itens jsonb;
  e jsonb;
  n integer;
  k text;
  v jsonb;
  v_max integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'conteudo'; end if;
  if exists (select 1 from jsonb_object_keys(p) x where x not in ('itens', 'observacao')) then return 'conteudo'; end if;
  if jsonb_typeof(coalesce(p -> 'observacao', 'null'::jsonb)) not in ('string', 'null') or char_length(coalesce(p ->> 'observacao', '')) > 500 then
    return 'observacao';
  end if;
  v_itens := coalesce(p -> 'itens', '[]'::jsonb);
  if jsonb_typeof(v_itens) <> 'array' or jsonb_array_length(v_itens) > 20 then return 'itens'; end if;
  for e, n in select x.e, x.n::integer from jsonb_array_elements(v_itens) with ordinality as x(e, n) loop
    if jsonb_typeof(e) <> 'object' then return 'itens.' || n; end if;
    for k, v in select x.key, x.value from jsonb_each(e) x loop
      v_max := case k
        when 'tipo' then 20 when 'medicamento' then 200 when 'concentracao' then 60 when 'forma' then 60
        when 'composicao' then 180 when 'dose' then 20 when 'unidade' then 30 when 'via' then 20 when 'via_outra' then 40
        when 'freq_modo' then 20 when 'freq_texto' then 120 when 'dur_modo' then 20 when 'dur_texto' then 60
        when 'quantidade' then 100 when 'orientacoes' then 300 when 'posologia' then 500 end;
      if v_max is not null then
        if jsonb_typeof(v) not in ('string', 'null') or char_length(coalesce(v #>> '{}', '')) > v_max then return 'itens.' || n || '.' || k; end if;
      elsif k in ('freq_n', 'dur_n') then
        if jsonb_typeof(v) not in ('number', 'null') or (jsonb_typeof(v) = 'number' and v::text !~ '^[0-9]{1,3}$') then return 'itens.' || n || '.' || k; end if;
      elsif k = 'posologia_manual' then
        if jsonb_typeof(v) not in ('boolean', 'null') then return 'itens.' || n || '.' || k; end if;
      else
        return 'itens.' || n || '.' || left(k, 30);
      end if;
    end loop;
    if coalesce(e ->> 'tipo', '') not in ('', 'industrializado', 'manipulado') then return 'itens.' || n || '.tipo'; end if;
    if coalesce(e ->> 'via', '') not in ('', 'oral', 'sublingual', 'subcutanea', 'intramuscular', 'intravenosa', 'topica', 'inalatoria',
         'nasal', 'oftalmica', 'otologica', 'retal', 'vaginal', 'transdermica', 'outra') then return 'itens.' || n || '.via'; end if;
    if coalesce(e ->> 'freq_modo', '') not in ('', 'intervalo', 'vezes', 'uma', 'se_precisar', 'outra') then return 'itens.' || n || '.freq_modo'; end if;
    if coalesce(e ->> 'dur_modo', '') not in ('', 'dias', 'continuo', 'outra') then return 'itens.' || n || '.dur_modo'; end if;
    if (e ->> 'freq_n')::integer not between 1 and 48 then return 'itens.' || n || '.freq_n'; end if;
    if (e ->> 'dur_n')::integer not between 1 and 365 then return 'itens.' || n || '.dur_n'; end if;
  end loop;
  return null;
end $$;

-- O que falta para emitir (o rascunho pode estar incompleto; a receita emitida não). Os tamanhos e o resto das
-- regras da receita simples quem confere é private.tele_doc_payload, na emissão.
create or replace function private.rx_emitir_erro(p jsonb)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  e jsonb;
  n integer;
  v_manip boolean;
begin
  if jsonb_array_length(coalesce(p -> 'itens', '[]'::jsonb)) < 1 then return 'itens'; end if;
  for e, n in select x.e, x.n::integer from jsonb_array_elements(p -> 'itens') with ordinality as x(e, n) loop
    v_manip := coalesce(e ->> 'tipo', '') = 'manipulado';
    if v_manip then
      if char_length(btrim(coalesce(e ->> 'composicao', ''))) < 3 then return 'itens.' || n || '.composicao'; end if;
    else
      if char_length(btrim(coalesce(e ->> 'medicamento', ''))) < 2 then return 'itens.' || n || '.medicamento'; end if;
      if btrim(coalesce(e ->> 'concentracao', '')) = '' then return 'itens.' || n || '.concentracao'; end if;
    end if;
    if coalesce(e ->> 'via', '') = '' then return 'itens.' || n || '.via'; end if;
    if e ->> 'via' = 'outra' and btrim(coalesce(e ->> 'via_outra', '')) = '' then return 'itens.' || n || '.via_outra'; end if;
    if char_length(btrim(coalesce(e ->> 'posologia', ''))) < 3 then return 'itens.' || n || '.posologia'; end if;
    if btrim(coalesce(e ->> 'quantidade', '')) = '' then return 'itens.' || n || '.quantidade'; end if;
    if coalesce(e ->> 'dur_modo', '') = '' then return 'itens.' || n || '.dur_modo'; end if;
    if e ->> 'dur_modo' = 'dias' and (e ->> 'dur_n') is null then return 'itens.' || n || '.dur_n'; end if;
    if e ->> 'dur_modo' = 'outra' and btrim(coalesce(e ->> 'dur_texto', '')) = '' then return 'itens.' || n || '.dur_texto'; end if;
  end loop;
  return null;
end $$;

-- A via como sai impressa.
create or replace function private.rx_via_rotulo(p_via text, p_outra text)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_via
    when 'oral' then 'oral' when 'sublingual' then 'sublingual' when 'subcutanea' then 'subcutânea'
    when 'intramuscular' then 'intramuscular' when 'intravenosa' then 'intravenosa' when 'topica' then 'tópica'
    when 'inalatoria' then 'inalatória' when 'nasal' then 'nasal' when 'oftalmica' then 'oftálmica'
    when 'otologica' then 'otológica' when 'retal' then 'retal' when 'vaginal' then 'vaginal'
    when 'transdermica' then 'transdérmica' when 'outra' then nullif(btrim(coalesce(p_outra, '')), '') end;
$$;

-- O rascunho no formato da receita simples de hoje (o que private.tele_doc_payload confere e o PDF imprime).
-- Manipulado: o "medicamento" impresso é a fórmula ("Fórmula manipulada: ..."), e a concentração, quando o médico não
-- escreve uma, sai "conforme a fórmula".
create or replace function private.rx_payload(p jsonb, p_endereco_residencial boolean)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'tipo', 'simples',
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'medicamento', case when coalesce(x.e ->> 'tipo', '') = 'manipulado'
          then case when btrim(coalesce(x.e ->> 'medicamento', '')) <> '' then btrim(x.e ->> 'medicamento') || ' (fórmula manipulada): ' else 'Fórmula manipulada: ' end
               || btrim(coalesce(x.e ->> 'composicao', ''))
          else btrim(coalesce(x.e ->> 'medicamento', '')) end,
        'concentracao', case when coalesce(x.e ->> 'tipo', '') = 'manipulado' and btrim(coalesce(x.e ->> 'concentracao', '')) = ''
          then 'conforme a fórmula' else nullif(btrim(coalesce(x.e ->> 'concentracao', '')), '') end,
        'forma', nullif(btrim(coalesce(x.e ->> 'forma', '')), ''),
        'via', private.rx_via_rotulo(x.e ->> 'via', x.e ->> 'via_outra'),
        'posologia', nullif(btrim(coalesce(x.e ->> 'posologia', '')), ''),
        'quantidade', nullif(btrim(coalesce(x.e ->> 'quantidade', '')), ''),
        'duracao', case x.e ->> 'dur_modo'
          when 'dias' then (x.e ->> 'dur_n') || case when (x.e ->> 'dur_n') = '1' then ' dia' else ' dias' end
          when 'continuo' then 'uso contínuo'
          when 'outra' then nullif(btrim(coalesce(x.e ->> 'dur_texto', '')), '') end,
        'observacao', nullif(btrim(coalesce(x.e ->> 'orientacoes', '')), '')) order by x.n)
      from jsonb_array_elements(p -> 'itens') with ordinality as x(e, n)), '[]'::jsonb),
    'observacao', nullif(btrim(coalesce(p ->> 'observacao', '')), ''),
    'endereco_residencial', coalesce(p_endereco_residencial, false));
$$;

-- O médico aprovado que está logado (para os modelos, que não têm consulta). null = não é.
create or replace function private.rx_medico()
returns uuid
language sql stable
set search_path = ''
as $$
  select d.id from public.doctors d where d.user_id = auth.uid() and d.status = 'approved';
$$;
revoke all on function private.rx_conteudo_erro(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.rx_emitir_erro(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.rx_via_rotulo(text, text) from public, anon, authenticated, service_role;
revoke all on function private.rx_payload(jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function private.rx_medico() from public, anon, authenticated, service_role;

/* ===================== 4. A receita da consulta ===================== */
-- Abre: o rascunho (se houver) e as receitas já emitidas nesta consulta (para "repetir").
create or replace function public.ws_receita_abrir(p_consulta uuid, p_justificativa text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  a jsonb := private.ws_acesso(p_consulta, 'ws_receita_abrir', p_justificativa);
  r prontuario.prescricoes;
  v_emitidas jsonb;
begin
  if a ? 'erro' then return a; end if;
  select * into r from prontuario.prescricoes x where x.teleconsulta_id = p_consulta and x.situacao = 'rascunho';
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'documento_id', x.documento_id, 'emitida_em', x.emitida_em,
           'conteudo', x.conteudo, 'codigo', d.code, 'documento_situacao', d.status) order by x.emitida_em desc), '[]'::jsonb)
    into v_emitidas
  from prontuario.prescricoes x
  join public.tele_documents d on d.id = x.documento_id
  where x.teleconsulta_id = p_consulta and x.situacao = 'emitida';
  return jsonb_build_object('ok', true, 'acesso', a ->> 'acesso', 'pode_editar', (a ->> 'pode_editar')::boolean,
    'rascunho', case when r.id is not null then jsonb_build_object('versao', r.versao, 'conteudo', r.conteudo, 'salvo_em', r.salvo_em) end,
    'emitidas', v_emitidas);
end $$;

-- Salva o rascunho inteiro, com versão. p_versao = a versão que a tela tem (0 = ainda não há rascunho). Outra aba
-- salvou antes: versao_conflito, com o que está salvo.
create or replace function public.ws_receita_salvar(p_consulta uuid, p_conteudo jsonb, p_versao integer)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  a jsonb := private.ws_acesso(p_consulta, 'ws_receita_salvar');
  r prontuario.prescricoes;
  v_err text;
begin
  if a ? 'erro' then return a; end if;
  if not (a ->> 'pode_editar')::boolean then return jsonb_build_object('erro', 'prazo_encerrado'); end if;
  v_err := private.rx_conteudo_erro(p_conteudo);
  if v_err is not null then return jsonb_build_object('erro', 'dados_invalidos', 'campo', v_err); end if;
  perform pg_advisory_xact_lock(7202, hashtext(p_consulta::text));
  select * into r from prontuario.prescricoes x where x.teleconsulta_id = p_consulta and x.situacao = 'rascunho' for update;
  if r.id is null then
    if coalesce(p_versao, 0) <> 0 then
      return jsonb_build_object('erro', 'versao_conflito', 'versao', 0, 'conteudo', null);
    end if;
    insert into prontuario.prescricoes (teleconsulta_id, medico_id, situacao, conteudo, versao)
    values (p_consulta, (a ->> 'medico_id')::uuid, 'rascunho', p_conteudo, 1)
    returning * into r;
    perform private.ws_escrita('ws_receita_salvar', 'criar_rascunho', 'prescricao', r.id, p_consulta, null, 1, null);
    return jsonb_build_object('ok', true, 'id', r.id, 'versao', 1, 'salvo_em', r.salvo_em);
  end if;
  if r.versao <> coalesce(p_versao, -1) then
    return jsonb_build_object('erro', 'versao_conflito', 'versao', r.versao, 'conteudo', r.conteudo, 'salvo_em', r.salvo_em);
  end if;
  if r.conteudo = p_conteudo then
    return jsonb_build_object('ok', true, 'id', r.id, 'versao', r.versao, 'salvo_em', r.salvo_em, 'igual', true);
  end if;
  update prontuario.prescricoes set conteudo = p_conteudo, versao = r.versao + 1, salvo_em = now() where id = r.id;
  perform private.ws_escrita('ws_receita_salvar', 'salvar_rascunho', 'prescricao', r.id, p_consulta, r.versao, r.versao + 1, null);
  return jsonb_build_object('ok', true, 'id', r.id, 'versao', r.versao + 1, 'salvo_em', now());
end $$;

-- Emite o rascunho salvo (p_versao = a versão que a tela mostra). Confere o que falta, a lista de controle e, por
-- public.tele_doc_create, tudo o que a receita simples já exige (dados do paciente conferidos, endereço residencial,
-- tamanhos). As recusas voltam como {"erro": ...} sem raise, para a trilha ficar. Chamar de novo em até 2 minutos
-- devolve a mesma receita.
create or replace function public.ws_receita_emitir(p_consulta uuid, p_versao integer, p_expect jsonb,
                                                    p_endereco_residencial boolean default false)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  a jsonb := private.ws_acesso(p_consulta, 'ws_receita_emitir');
  r prontuario.prescricoes;
  v_err text;
  v_payload jsonb;
  v_bate jsonb;
  v_doc uuid;
  v_code text;
  v_msg text;
  v_det text;
  v_hint text;
begin
  if a ? 'erro' then return a; end if;
  if not (a ->> 'pode_editar')::boolean then return jsonb_build_object('erro', 'prazo_encerrado'); end if;
  perform pg_advisory_xact_lock(7202, hashtext(p_consulta::text));
  select * into r from prontuario.prescricoes x where x.teleconsulta_id = p_consulta and x.situacao = 'rascunho' for update;
  if r.id is null then
    select x.documento_id, d.code into v_doc, v_code
    from prontuario.prescricoes x join public.tele_documents d on d.id = x.documento_id
    where x.teleconsulta_id = p_consulta and x.situacao = 'emitida' and x.versao = p_versao
      and x.emitida_em > now() - interval '2 minutes'
    order by x.emitida_em desc
    limit 1;
    if v_doc is not null then return jsonb_build_object('ok', true, 'id', v_doc, 'code', v_code, 'repetida', true); end if;
    return jsonb_build_object('erro', 'sem_rascunho');
  end if;
  if r.versao <> coalesce(p_versao, -1) then
    return jsonb_build_object('erro', 'versao_conflito', 'versao', r.versao, 'conteudo', r.conteudo, 'salvo_em', r.salvo_em);
  end if;
  v_err := private.rx_emitir_erro(r.conteudo);
  if v_err is not null then return jsonb_build_object('erro', 'dados_invalidos', 'campo', v_err); end if;
  v_payload := private.rx_payload(r.conteudo, p_endereco_residencial);
  v_bate := private.rx_conferir(v_payload -> 'itens');
  if jsonb_array_length(v_bate) > 0 then
    perform private.ws_trilha('ws_receita_emitir', 'negado', 'lista_de_controle', 'medico', p_consulta, 'prescricao', r.id);
    return jsonb_build_object('erro', 'receita_bloqueada', 'motivo', 'lista', 'itens', v_bate);
  end if;
  begin
    select d.id, d.code into v_doc, v_code from public.tele_doc_create(p_consulta, 'receita', v_payload, p_expect) as d;
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail, v_hint = pg_exception_hint;
    perform private.ws_trilha('ws_receita_emitir', 'negado', left(v_msg, 60), 'medico', p_consulta, 'prescricao', r.id);
    return jsonb_build_object('erro', v_msg, 'detalhe', nullif(v_det, ''), 'dica', nullif(v_hint, ''));
  end;
  insert into prontuario.prescricao_itens (prescricao_id, ordem, tipo, medicamento, concentracao, forma, composicao, dose,
    dose_unidade, via, via_outra, frequencia, duracao, quantidade, orientacoes, posologia_texto, posologia_editada_a_mao)
  select r.id, x.n, case when coalesce(x.e ->> 'tipo', '') = 'manipulado' then 'manipulado' else 'industrializado' end,
         i.e ->> 'medicamento', i.e ->> 'concentracao', i.e ->> 'forma',
         case when coalesce(x.e ->> 'tipo', '') = 'manipulado' then btrim(x.e ->> 'composicao') end,
         nullif(btrim(coalesce(x.e ->> 'dose', '')), ''), nullif(btrim(coalesce(x.e ->> 'unidade', '')), ''),
         x.e ->> 'via', case when x.e ->> 'via' = 'outra' then btrim(x.e ->> 'via_outra') end,
         case when coalesce(x.e ->> 'freq_modo', '') <> '' then jsonb_strip_nulls(jsonb_build_object('modo', x.e ->> 'freq_modo', 'n', x.e -> 'freq_n', 'texto', nullif(btrim(coalesce(x.e ->> 'freq_texto', '')), ''))) end,
         jsonb_strip_nulls(jsonb_build_object('modo', x.e ->> 'dur_modo', 'n', x.e -> 'dur_n', 'texto', nullif(btrim(coalesce(x.e ->> 'dur_texto', '')), ''))),
         i.e ->> 'quantidade', i.e ->> 'observacao', i.e ->> 'posologia', coalesce((x.e ->> 'posologia_manual')::boolean, false)
  from jsonb_array_elements(r.conteudo -> 'itens') with ordinality as x(e, n)
  join jsonb_array_elements(v_payload -> 'itens') with ordinality as i(e, n) on i.n = x.n;
  update prontuario.prescricoes set situacao = 'emitida', documento_id = v_doc, emitida_em = now() where id = r.id;
  perform private.ws_escrita('ws_receita_emitir', 'emitir', 'prescricao', r.id, p_consulta, r.versao, r.versao, null);
  return jsonb_build_object('ok', true, 'id', v_doc, 'code', v_code);
end $$;

/* ===================== 5. Modelos do médico ===================== */
create or replace function public.ws_receita_modelos()
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_medico uuid := private.rx_medico();
begin
  if v_medico is null then return jsonb_build_object('erro', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'itens', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome, 'conteudo', m.conteudo, 'atualizado_em', m.atualizado_em) order by lower(m.nome))
    from prontuario.prescricao_modelos m
    where m.medico_id = v_medico and m.apagado_em is null), '[]'::jsonb));
end $$;

-- Cria (p_id null) ou troca um modelo. Até 50 por médico; o nome não repete.
create or replace function public.ws_receita_modelo_salvar(p_id uuid, p_nome text, p_conteudo jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_medico uuid := private.rx_medico();
  v_nome text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_err text;
  v_id uuid;
begin
  if v_medico is null then return jsonb_build_object('erro', 'forbidden'); end if;
  if char_length(v_nome) not between 2 and 80 then return jsonb_build_object('erro', 'dados_invalidos', 'campo', 'nome'); end if;
  v_err := private.rx_conteudo_erro(p_conteudo);
  if v_err is null and jsonb_array_length(coalesce(p_conteudo -> 'itens', '[]'::jsonb)) < 1 then v_err := 'itens'; end if;
  if v_err is not null then return jsonb_build_object('erro', 'dados_invalidos', 'campo', v_err); end if;
  perform pg_advisory_xact_lock(7203, hashtext(v_medico::text));
  if exists (select 1 from prontuario.prescricao_modelos m
             where m.medico_id = v_medico and m.apagado_em is null and lower(m.nome) = lower(v_nome) and m.id is distinct from p_id) then
    return jsonb_build_object('erro', 'nome_repetido');
  end if;
  if p_id is null then
    if (select count(*) from prontuario.prescricao_modelos m where m.medico_id = v_medico and m.apagado_em is null) >= 50 then
      return jsonb_build_object('erro', 'limite_modelos');
    end if;
    insert into prontuario.prescricao_modelos (medico_id, nome, conteudo) values (v_medico, v_nome, p_conteudo) returning id into v_id;
    perform private.ws_escrita('ws_receita_modelo_salvar', 'criar_modelo', 'prescricao_modelo', v_id, null, null, null, null);
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;
  update prontuario.prescricao_modelos m set nome = v_nome, conteudo = p_conteudo, atualizado_em = now()
  where m.id = p_id and m.medico_id = v_medico and m.apagado_em is null
  returning m.id into v_id;
  if v_id is null then return jsonb_build_object('erro', 'nao_encontrado'); end if;
  perform private.ws_escrita('ws_receita_modelo_salvar', 'trocar_modelo', 'prescricao_modelo', v_id, null, null, null, null);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.ws_receita_modelo_apagar(p_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_medico uuid := private.rx_medico();
  v_id uuid;
begin
  if v_medico is null then return jsonb_build_object('erro', 'forbidden'); end if;
  update prontuario.prescricao_modelos m set apagado_em = now()
  where m.id = p_id and m.medico_id = v_medico and m.apagado_em is null
  returning m.id into v_id;
  if v_id is null then return jsonb_build_object('erro', 'nao_encontrado'); end if;
  perform private.ws_escrita('ws_receita_modelo_apagar', 'apagar_modelo', 'prescricao_modelo', v_id, null, null, null, null);
  return jsonb_build_object('ok', true);
end $$;

/* ===================== 6. A lista de controle: ler, lançar e retirar ===================== */
-- A lista vigente (só o nome e a lista), para a tela marcar o item antes de emitir. Quem tem cadastro de médico ou é
-- da equipe do IMED.
create or replace function public.cat_regras_receita()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (public.is_imed_admin() or exists (select 1 from public.doctors d where d.user_id = auth.uid())) then
    return jsonb_build_object('erro', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'itens', coalesce((
    select jsonb_agg(jsonb_build_object('nome', r.nome_busca, 'lista', r.lista) order by r.lista, r.nome_busca)
    from catalogo.med_regras r where r.retirada_em is null), '[]'::jsonb));
end $$;

create or replace function public.cat_regra_listar()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_imed_admin() then return jsonb_build_object('erro', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'itens', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'nome', r.nome_busca, 'lista', r.lista, 'fonte', r.fonte,
             'vigente_desde', r.vigente_desde, 'retirada_em', r.retirada_em, 'retirada_motivo', r.retirada_motivo)
           order by (r.retirada_em is not null), r.lista, r.nome_busca)
    from catalogo.med_regras r), '[]'::jsonb));
end $$;

-- Lança um nome (vira minúsculo e sem acento; só letras, números e espaço simples), com a lista e a fonte.
create or replace function public.cat_regra_lancar(p_nome text, p_lista text, p_fonte text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_nome text := btrim(private.ws_fold(p_nome));
  v_fonte text := btrim(regexp_replace(coalesce(p_fonte, ''), '\s+', ' ', 'g'));
  v_id uuid;
begin
  if not public.is_imed_admin() then return jsonb_build_object('erro', 'forbidden'); end if;
  if v_nome !~ '^[a-z0-9]+( [a-z0-9]+)*$' or char_length(v_nome) not between 3 and 60 then
    return jsonb_build_object('erro', 'dados_invalidos', 'campo', 'nome');
  end if;
  if coalesce(p_lista, '') not in ('antimicrobiano', 'glp1', 'portaria_344') then return jsonb_build_object('erro', 'dados_invalidos', 'campo', 'lista'); end if;
  if char_length(v_fonte) not between 5 and 300 then return jsonb_build_object('erro', 'dados_invalidos', 'campo', 'fonte'); end if;
  perform pg_advisory_xact_lock(7204, hashtext(v_nome));
  if exists (select 1 from catalogo.med_regras r where r.nome_busca = v_nome and r.retirada_em is null) then
    return jsonb_build_object('erro', 'ja_existe');
  end if;
  insert into catalogo.med_regras (nome_busca, lista, fonte, lancado_por) values (v_nome, p_lista, v_fonte, auth.uid()) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'nome', v_nome);
end $$;

create or replace function public.cat_regra_retirar(p_id uuid, p_motivo text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(regexp_replace(coalesce(p_motivo, ''), '\s+', ' ', 'g'));
  v_id uuid;
begin
  if not public.is_imed_admin() then return jsonb_build_object('erro', 'forbidden'); end if;
  if char_length(v_motivo) not between 5 and 300 then return jsonb_build_object('erro', 'dados_invalidos', 'campo', 'motivo'); end if;
  update catalogo.med_regras r set retirada_em = now(), retirada_por = auth.uid(), retirada_motivo = v_motivo
  where r.id = p_id and r.retirada_em is null
  returning r.id into v_id;
  if v_id is null then return jsonb_build_object('erro', 'nao_encontrado'); end if;
  return jsonb_build_object('ok', true);
end $$;

/* ===================== 7. Quem executa ===================== */
revoke all on function public.ws_receita_abrir(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.ws_receita_abrir(uuid, text) to authenticated;
revoke all on function public.ws_receita_salvar(uuid, jsonb, integer) from public, anon, authenticated, service_role;
grant execute on function public.ws_receita_salvar(uuid, jsonb, integer) to authenticated;
revoke all on function public.ws_receita_emitir(uuid, integer, jsonb, boolean) from public, anon, authenticated, service_role;
grant execute on function public.ws_receita_emitir(uuid, integer, jsonb, boolean) to authenticated;
revoke all on function public.ws_receita_modelos() from public, anon, authenticated, service_role;
grant execute on function public.ws_receita_modelos() to authenticated;
revoke all on function public.ws_receita_modelo_salvar(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ws_receita_modelo_salvar(uuid, text, jsonb) to authenticated;
revoke all on function public.ws_receita_modelo_apagar(uuid) from public, anon, authenticated, service_role;
grant execute on function public.ws_receita_modelo_apagar(uuid) to authenticated;
revoke all on function public.cat_regras_receita() from public, anon, authenticated, service_role;
grant execute on function public.cat_regras_receita() to authenticated;
revoke all on function public.cat_regra_listar() from public, anon, authenticated, service_role;
grant execute on function public.cat_regra_listar() to authenticated;
revoke all on function public.cat_regra_lancar(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.cat_regra_lancar(text, text, text) to authenticated;
revoke all on function public.cat_regra_retirar(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cat_regra_retirar(uuid, text) to authenticated;
comment on function public.ws_receita_abrir(uuid, text) is
  'Receita da consulta: o rascunho e as emitidas. Só o médico da consulta (ou a equipe médica, com justificativa); tudo na trilha.';
comment on function public.ws_receita_salvar(uuid, jsonb, integer) is
  'Salva o rascunho da receita com versão (versao_conflito se outra aba salvou antes). Só o médico da consulta, no prazo.';
comment on function public.ws_receita_emitir(uuid, integer, jsonb, boolean) is
  'Emite o rascunho como receita simples (mesmo payload e mesmo caminho de tele_doc_create). Nome da lista de controle: recusa.';
comment on function public.ws_receita_modelos() is 'Modelos de receita do médico logado (sem paciente).';
comment on function public.ws_receita_modelo_salvar(uuid, text, jsonb) is 'Cria ou troca um modelo de receita do médico logado (até 50).';
comment on function public.ws_receita_modelo_apagar(uuid) is 'Apaga (marca) um modelo de receita do médico logado.';
comment on function public.cat_regras_receita() is 'Nomes vigentes que travam a receita simples (para a tela do médico marcar o item).';
comment on function public.cat_regra_listar() is 'Lista de controle inteira, com fonte e retirados. Só a equipe do IMED.';
comment on function public.cat_regra_lancar(text, text, text) is 'Lança um nome na lista de controle, com a lista e a fonte. Só a equipe do IMED.';
comment on function public.cat_regra_retirar(uuid, text) is 'Retira um nome da lista de controle, com o motivo (nada é apagado). Só a equipe do IMED.';
