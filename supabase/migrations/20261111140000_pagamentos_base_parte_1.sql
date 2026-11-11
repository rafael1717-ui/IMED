-- iMed Pagamentos, fase P1 ("Banco e conciliação", tudo DESLIGADO), 11/11/2026. Arquitetura:
-- memory/projects/imed-pagamento-arquitetura.md (§1.3, §3.3, §4, §5, §10 "P1" e §11; as escolhas desta fase estão no fim
-- do documento, em "P1: como ficou").
-- Em 5 partes (supabase/migrations/<versão>_pagamentos_base_parte_1 a 5), cada uma uma migração própria, nesta ordem:
--   1. (esta) o schema pagamentos, as tabelas, as guardas e as referências (parâmetros, taxa de partida, permissões);
--   2. o núcleo (contas em centavos, extrato, devolução pela regra) e o que muda na agenda (§4.6);
--   3. as funções que só o servidor chama (cobrança, avisos, rotina, devolução, conciliação, mensalidade);
--   4. as funções do paciente, da clínica e da gestão, e a retenção;
--   5. a ÚNICA com DROP (uma restrição de agenda.unit_settings trocada por outra mais larga) e a guarda dela.
-- Volta única das 5 partes: supabase/volta/<versão>_pagamentos_base_parte_5.sql.
--
-- NOME PROVISÓRIO (ainda não aplicada na produção): ao aplicar, siga os 5 passos de "Ao aplicar uma migração provisória
-- na produção" do .github/workflows/banco.yml (renomear esta e a volta com a versão que o conector gravar, tirar esta
-- marca, tirar o nome de PENDENTES_NA_PRODUCAO, renomear as outras provisórias para depois dela e trocar
-- ULTIMA_NA_PRODUCAO). As 5 partes vêm DEPOIS de todas as provisórias da agenda (4.2 parte 2, 4.3, 4.4, 5.1 e feriados
-- nacionais): a parte 2 troca o corpo de funções que a 5.1 (agenda_app) ajusta. Se alguma delas for aplicada com versão
-- maior que a destas, o passo 4 de lá já manda renomear estas (e as voltas) para depois dela.
--
-- Em linguagem simples: esta parte só CRIA coisas novas, num lugar que o site não alcança.
--   - schema pagamentos, fora da API como agenda, prontuario e private: sem USAGE para anon, authenticated e
--     service_role; toda tabela com RLS ligada, sem policy e sem permissão. Tudo entra e sai por funções (partes 2 a 4).
--   - 17 tabelas (as 16 do §5.2 + refund_items, o rateio de cada devolução por exame). Dinheiro sempre em centavos
--     inteiros; percentual em pontos-base (1500 = 15%). Nunca guardam cartão, chave, segredo, corpo de aviso nem CPF.
--   - o extrato (ledger) e a trilha (audit_log) só acrescentam: UPDATE, DELETE e TRUNCATE dão erro.
--   - a cobrança só anda pelas situações permitidas (§4.1); valor, taxa e parte da clínica não mudam depois de gravados;
--     o devolvido nunca diminui nem passa do pago.
--   - TUDO DESLIGADO: vendas_online_ligadas = false, nenhuma clínica com conta, nenhum plano com preço. A taxa de
--     partida (15%, definida pelo dono) entra como regra padrão, com histórico. As tarifas do meio de pagamento entram
--     como parâmetro marcado "a confirmar" (valores públicos da pesquisa de 11/11; vale o que estiver na conta).
--   - 2 permissões novas para o dono da clínica (financeiro.configurar e financeiro.estornar) e 1 transição nova da
--     agenda (reserva → cancelada pelo sistema, quando a cobrança não nasce). imed.financeiro.operar não é dada a papel
--     nenhum da equipe: só o dono do IMED a tem (decisão 22).
-- Pode rodar de novo sem erro e sem mudar nada. Conferir na produção depois de aplicar as 5 partes (tem de dar true):
--   select not has_schema_privilege('service_role', 'pagamentos', 'USAGE')
--      and (select count(*) from pg_class where relnamespace = 'pagamentos'::regnamespace and relkind = 'r' and relrowsecurity) = 17
--      and (select valor from pagamentos.settings where chave = 'vendas_online_ligadas') = 'false'::jsonb
--      and (select count(*) from pagamentos.clinic_accounts) = 0
--      and (select fee_bps from pagamentos.fee_rules where clinic_id is null and finalidade = 'exame' and vale_ate is null) = 1500
--      and not has_function_privilege('authenticated', 'public.pag_sync_apply(uuid,jsonb,bigint)', 'EXECUTE');

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Schema ===================== */
create schema if not exists pagamentos;
comment on schema pagamentos is
  'iMed Pagamentos (memory/projects/imed-pagamento-arquitetura.md). Fora da API: sem USAGE para anon, authenticated e '
  'service_role; acesso só pelas funções. Toda tabela com RLS ligada, sem policy e sem permissão para a API.';
revoke all on schema pagamentos from public, anon, authenticated, service_role;

/* ===================== 2. Tabelas (§5.2) ===================== */
-- Regras de todas: RLS ligada, sem policy e sem permissão para a API; nomes de restrição fixos (as funções e os testes
-- se referem a eles); dinheiro em integer de centavos.

-- Parâmetros (chave/valor). Toda mudança passa por função e fica em pagamentos.audit_log. a_confirmar = valor que veio
-- da pesquisa e ainda não foi conferido na conta de verdade (tarifas do meio de pagamento).
create table if not exists pagamentos.settings (
  chave text primary key constraint settings_chave_ck check (chave ~ '^[a-z][a-z0-9_]{2,60}$'),
  valor jsonb not null constraint settings_valor_ck check (octet_length(valor::text) <= 500),
  a_confirmar boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);

-- Conta da clínica no meio de pagamento. wallet_id não é segredo (só diz para onde vai a parte dela).
create table if not exists pagamentos.clinic_accounts (
  clinic_id uuid primary key constraint clinic_accounts_clinic_fk references public.clinics (id) on delete restrict,
  provedor text not null default 'asaas' constraint clinic_accounts_provedor_ck check (provedor in ('asaas')),
  wallet_id text constraint clinic_accounts_wallet_ck check (wallet_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  emitida_por text not null default 'imed' constraint clinic_accounts_emitida_ck check (emitida_por in ('imed', 'clinica')),
  situacao text not null default 'nao_ligada'
    constraint clinic_accounts_situacao_ck check (situacao in ('nao_ligada', 'em_conferencia', 'ativa', 'suspensa')),
  meios text[] not null default '{pix}'
    constraint clinic_accounts_meios_ck check (meios <@ array['pix', 'cartao'] and cardinality(meios) between 1 and 2),
  termos_versao text constraint clinic_accounts_termos_ck check (termos_versao ~ '^[a-z0-9][a-z0-9._-]{0,30}$'),
  aceito_em timestamptz,
  aceito_por uuid,
  conferida_em timestamptz,
  conferida_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- em conferência, ativa ou suspensa: com carteira e termos aceitos; ativa: conferida pela equipe do IMED
  constraint clinic_accounts_ligada_ck check (situacao = 'nao_ligada'
    or (wallet_id is not null and termos_versao is not null and aceito_em is not null and aceito_por is not null)),
  constraint clinic_accounts_ativa_ck check (situacao <> 'ativa' or (conferida_em is not null and conferida_por is not null))
);

-- Taxa do IMED, com histórico. clinic_id nulo = padrão. Nunca UPDATE do valor: taxa nova = linha nova que fecha a
-- anterior (gatilho fee_rules_guard). Sem dois períodos sobrepostos para a mesma clínica e finalidade.
create table if not exists pagamentos.fee_rules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid constraint fee_rules_clinic_fk references public.clinics (id) on delete restrict,
  finalidade text not null constraint fee_rules_finalidade_ck check (finalidade in ('exame', 'teleconsulta')),
  tipo text not null constraint fee_rules_tipo_ck check (tipo in ('percentual', 'fixo')),
  fee_bps integer constraint fee_rules_bps_ck check (fee_bps between 0 and 10000),
  fee_cents integer constraint fee_rules_cents_ck check (fee_cents between 0 and 10000000),
  vale_de timestamptz not null default now(),
  vale_ate timestamptz,
  motivo text not null constraint fee_rules_motivo_ck check (motivo ~ '^[a-z][a-z0-9_]{2,59}$' and motivo !~ '[0-9]{4,}'),
  criado_por uuid,
  criado_em timestamptz not null default now(),
  constraint fee_rules_valor_ck check ((tipo = 'percentual') = (fee_bps is not null) and (tipo = 'fixo') = (fee_cents is not null)),
  constraint fee_rules_periodo_ck check (vale_ate is null or vale_ate > vale_de),
  constraint fee_rules_sem_sobreposicao exclude using gist (
    (coalesce(clinic_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    finalidade with =,
    tstzrange(vale_de, vale_ate, '[)') with &&)
);

-- Pagador: só o HMAC do CPF (calculado no servidor, com chave que não fica no banco) e o id do cliente no provedor.
-- Sem nome e sem CPF.
create table if not exists pagamentos.payers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  provedor text not null default 'asaas' constraint payers_provedor_ck check (provedor in ('asaas')),
  cpf_hmac text not null constraint payers_hmac_ck check (cpf_hmac ~ '^[0-9a-f]{64}$'),
  provedor_cliente_id text constraint payers_cliente_ck check (provedor_cliente_id ~ '^[A-Za-z0-9_-]{4,80}$'),
  criado_em timestamptz not null default now(),
  constraint payers_hmac_uq unique (provedor, cpf_hmac)
);

-- Planos de mensalidade (preço com histórico). Vazia: o preço do Destaque depende da decisão 14 do dono.
create table if not exists pagamentos.plans (
  codigo text not null constraint plans_codigo_ck check (codigo in ('destaque', 'consultorio_virtual')),
  preco_cents integer not null constraint plans_preco_ck check (preco_cents between 100 and 10000000),
  vale_de timestamptz not null default now(),
  vale_ate timestamptz,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  primary key (codigo, vale_de),
  constraint plans_periodo_ck check (vale_ate is null or vale_ate > vale_de),
  constraint plans_sem_sobreposicao exclude using gist (codigo with =, tstzrange(vale_de, vale_ate, '[)') with &&)
);

-- Mensalidades (Destaque; depois, consultório virtual com doctor_id).
create table if not exists pagamentos.subscriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid constraint subscriptions_clinic_fk references public.clinics (id) on delete restrict,
  doctor_id uuid,
  plano text not null constraint subscriptions_plano_ck check (plano in ('destaque', 'consultorio_virtual')),
  preco_cents integer not null constraint subscriptions_preco_ck check (preco_cents between 100 and 10000000),
  provedor text not null default 'asaas' constraint subscriptions_provedor_ck check (provedor in ('asaas')),
  provedor_assinatura_id text constraint subscriptions_assinatura_ck check (provedor_assinatura_id ~ '^[A-Za-z0-9_-]{4,80}$'),
  situacao text not null default 'pendente'
    constraint subscriptions_situacao_ck check (situacao in ('pendente', 'ativa', 'atrasada', 'suspensa', 'cancelada')),
  pago_ate date,
  tolerancia_ate timestamptz,
  suspensa_em timestamptz,
  cancelar_no_fim boolean not null default false,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint subscriptions_dono_ck check ((clinic_id is null) <> (doctor_id is null)),
  constraint subscriptions_atrasada_ck check (situacao <> 'atrasada' or tolerancia_ate is not null),
  constraint subscriptions_suspensa_ck check (situacao <> 'suspensa' or suspensa_em is not null),
  constraint subscriptions_assinatura_uq unique (provedor, provedor_assinatura_id)
);
create unique index if not exists subscriptions_viva_uq on pagamentos.subscriptions (clinic_id, plano)
  where clinic_id is not null and situacao <> 'cancelada';

-- O que a busca vai ler (fase P5): clínicas em destaque agora. Mantida só por pag_subscription_sync.
create table if not exists pagamentos.featured (
  clinic_id uuid primary key constraint featured_clinic_fk references public.clinics (id) on delete cascade,
  desde timestamptz not null default now(),
  ate timestamptz,
  constraint featured_periodo_ck check (ate is null or ate > desde)
);

-- Cobranças. Uma por tentativa de pagamento; no máximo uma "viva" por agendamento (P-I3). valor = taxa + parte da
-- clínica (P-I4), fotografados na criação. devolvido_* contam só devoluções de um pagamento reconhecido (aprovado);
-- pago_cents é o que o provedor disse que chegou (pode não bater: aí a cobrança não é aprovada e o valor volta inteiro).
create table if not exists pagamentos.charges (
  id uuid primary key default gen_random_uuid(),
  finalidade text not null constraint charges_finalidade_ck check (finalidade in ('agendamento', 'destaque', 'teleconsulta', 'consultorio')),
  request_id uuid constraint charges_request_fk references public.appointment_requests (id) on delete restrict,
  subscription_id uuid constraint charges_subscription_fk references pagamentos.subscriptions (id) on delete restrict,
  clinic_id uuid not null constraint charges_clinic_fk references public.clinics (id) on delete restrict,
  payer_id uuid constraint charges_payer_fk references pagamentos.payers (id) on delete restrict,
  provedor text not null default 'asaas' constraint charges_provedor_ck check (provedor in ('asaas')),
  provedor_cobranca_id text constraint charges_cobranca_ck check (provedor_cobranca_id ~ '^[A-Za-z0-9_-]{4,80}$'),
  emitida_por text not null constraint charges_emitida_ck check (emitida_por in ('imed', 'clinica')),
  meio text not null constraint charges_meio_ck check (meio in ('pix', 'cartao', 'boleto')),
  valor_cents integer not null constraint charges_valor_ck check (valor_cents between 1 and 100000000),
  fee_rule_id uuid constraint charges_fee_rule_fk references pagamentos.fee_rules (id) on delete restrict,
  fee_bps integer constraint charges_fee_bps_ck check (fee_bps between 0 and 10000),
  taxa_cents integer not null constraint charges_taxa_ck check (taxa_cents >= 0),
  clinica_cents integer not null constraint charges_clinica_ck check (clinica_cents >= 0),
  tarifa_meio_cents integer constraint charges_tarifa_ck check (tarifa_meio_cents >= 0),
  situacao text not null default 'criada'
    constraint charges_situacao_ck check (situacao in ('criada', 'aguardando', 'processando', 'aprovada', 'expirada', 'cancelada',
                                                       'recusada', 'devolvida_parcial', 'devolvida', 'contestada')),
  expira_em timestamptz,
  paga_em timestamptz,
  pago_cents integer constraint charges_pago_ck check (pago_cents >= 0),
  devolvido_cents integer not null default 0,
  taxa_devolvida_cents integer not null default 0,
  clinica_devolvida_cents integer not null default 0,
  pix_copia_cola text constraint charges_copia_cola_ck check (char_length(pix_copia_cola) <= 1000),
  tentativa smallint not null default 1 constraint charges_tentativa_ck check (tentativa between 1 and 9),
  chave_idempotencia uuid not null,
  versao integer not null default 1,
  apagada_no_provedor_em timestamptz,
  consultada_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint charges_cobranca_uq unique (provedor, provedor_cobranca_id),
  constraint charges_chave_uq unique (chave_idempotencia),
  constraint charges_conta_ck check (valor_cents = taxa_cents + clinica_cents),                                  -- P-I4
  constraint charges_devolvido_ck check (devolvido_cents between 0 and valor_cents                               -- P-I5
    and taxa_devolvida_cents between 0 and taxa_cents and clinica_devolvida_cents between 0 and clinica_cents
    and devolvido_cents = taxa_devolvida_cents + clinica_devolvida_cents),
  constraint charges_dono_ck check ((finalidade = 'agendamento') = (request_id is not null)
    and (finalidade in ('destaque', 'consultorio')) = (subscription_id is not null)),
  -- o "copia e cola" só existe enquanto a cobrança espera o pagamento (§5.5)
  constraint charges_copia_cola_viva_ck check (pix_copia_cola is null or situacao = 'aguardando'),
  constraint charges_provedor_id_ck check (situacao = 'criada' or provedor_cobranca_id is not null or situacao = 'cancelada'),
  constraint charges_aprovada_ck check (situacao not in ('aprovada', 'devolvida_parcial', 'contestada')
    or (paga_em is not null and pago_cents = valor_cents)),
  constraint charges_devolvida_parcial_ck check (situacao <> 'devolvida_parcial' or devolvido_cents between 1 and valor_cents - 1),
  -- situação e conta andam juntas: "aprovada" é a cobrança inteira, sem nada devolvido
  constraint charges_aprovada_inteira_ck check (situacao <> 'aprovada' or devolvido_cents = 0),
  constraint charges_devolvido_pago_ck check (devolvido_cents = 0 or paga_em is not null)
);
create unique index if not exists charges_viva_uq on pagamentos.charges (request_id)
  where request_id is not null
    and situacao in ('criada', 'aguardando', 'processando', 'aprovada', 'devolvida_parcial', 'contestada');
create index if not exists charges_request_idx on pagamentos.charges (request_id, criado_em);
create index if not exists charges_clinica_idx on pagamentos.charges (clinic_id, paga_em);
create index if not exists charges_rotina_idx on pagamentos.charges (situacao, expira_em)
  where situacao in ('criada', 'aguardando', 'processando', 'cancelada', 'expirada');
create index if not exists charges_subscription_idx on pagamentos.charges (subscription_id) where subscription_id is not null;

-- A conta exame a exame (a foto da taxa de cada um). item_id = agenda.appointment_items.id.
create table if not exists pagamentos.charge_items (
  charge_id uuid not null constraint charge_items_charge_fk references pagamentos.charges (id) on delete restrict,
  item_id uuid not null constraint charge_items_item_fk references agenda.appointment_items (id) on delete restrict,
  preco_cents integer not null constraint charge_items_preco_ck check (preco_cents between 1 and 10000000),
  taxa_cents integer not null constraint charge_items_taxa_ck check (taxa_cents >= 0),
  clinica_cents integer not null constraint charge_items_clinica_ck check (clinica_cents >= 0),
  devolvido_cents integer not null default 0,
  primary key (charge_id, item_id),
  constraint charge_items_conta_ck check (preco_cents = taxa_cents + clinica_cents),                             -- P-I4
  constraint charge_items_devolvido_ck check (devolvido_cents between 0 and preco_cents)                         -- P-I5
);
create index if not exists charge_items_item_idx on pagamentos.charge_items (item_id);

-- Avisos do provedor (webhooks): só os campos da lista e o hash do corpo; o corpo NÃO é guardado (traz dado do pagador).
create table if not exists pagamentos.events (
  id bigint generated always as identity primary key,
  provedor text not null constraint events_provedor_ck check (provedor in ('asaas')),
  provedor_evento_id text not null constraint events_evento_ck check (provedor_evento_id ~ '^[A-Za-z0-9_.:&=-]{1,160}$'),
  charge_id uuid,
  provedor_cobranca_id text constraint events_cobranca_ck check (provedor_cobranca_id ~ '^[A-Za-z0-9_-]{4,80}$'),
  tipo text not null constraint events_tipo_ck check (tipo ~ '^[A-Z][A-Z0-9_]{2,59}$'),
  situacao_no_provedor text constraint events_situacao_ck check (situacao_no_provedor ~ '^[A-Za-z][A-Za-z0-9_]{1,39}$'),
  valor_cents integer constraint events_valor_ck check (valor_cents >= 0),
  ocorrido_em timestamptz,
  recebido_em timestamptz not null default now(),
  hash_do_corpo text constraint events_hash_ck check (hash_do_corpo ~ '^[0-9a-f]{64}$'),
  resultado text not null default 'pendente'
    constraint events_resultado_ck check (resultado in ('pendente', 'aplicado', 'repetido', 'ignorado_antigo', 'sem_cobranca',
                                                        'valor_divergente', 'erro')),
  repeticoes integer not null default 0 constraint events_repeticoes_ck check (repeticoes >= 0),
  aplicado_em timestamptz,
  constraint events_evento_uq unique (provedor, provedor_evento_id)
);
create index if not exists events_pendente_idx on pagamentos.events (recebido_em) where resultado = 'pendente';
create index if not exists events_charge_idx on pagamentos.events (charge_id);

-- Devoluções. Sempre um pedido gravado aqui (com chave de idempotência) e enviado pela rotina, uma por vez por cobrança.
-- integral = devolve tudo o que chegou numa cobrança que não pôde ser aprovada (valor divergente, cobrança já expirada
-- ou cancelada); fora isso, o rateio por exame fica em refund_items e a divisão (taxa × clínica) é calculada no envio.
create table if not exists pagamentos.refunds (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null constraint refunds_charge_fk references pagamentos.charges (id) on delete restrict,
  item_id uuid,
  integral boolean not null default false,
  automatica boolean not null default false,           -- pedida pela regra (§4.5), não por uma pessoa
  txid bigint not null default txid_current(),         -- a regra junta numa devolução só os exames cancelados na mesma transação
  valor_cents integer not null constraint refunds_valor_ck check (valor_cents between 1 and 100000000),
  taxa_cents integer constraint refunds_taxa_ck check (taxa_cents >= 0),
  clinica_cents integer constraint refunds_clinica_ck check (clinica_cents >= 0),
  motivo text not null constraint refunds_motivo_ck check (motivo ~ '^[a-z][a-z0-9_]{2,59}$' and motivo !~ '[0-9]{4,}'),
  pedido_por_tipo text not null
    constraint refunds_pedido_por_ck check (pedido_por_tipo in ('paciente', 'clinica', 'imed', 'sistema', 'integracao', 'gateway', 'sql')),
  pedido_por_user uuid,
  situacao text not null default 'pedida'
    constraint refunds_situacao_ck check (situacao in ('pedida', 'enviada', 'concluida', 'falhou', 'desfeita')),
  provedor_estorno_id text constraint refunds_estorno_ck check (provedor_estorno_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  chave_idempotencia uuid not null,
  tentativas smallint not null default 0 constraint refunds_tentativas_ck check (tentativas between 0 and 99),
  ultimo_erro text constraint refunds_erro_ck check (ultimo_erro ~ '^[a-z][a-z0-9_]{2,59}$'),
  criado_em timestamptz not null default now(),
  enviada_em timestamptz,
  concluida_em timestamptz,
  atualizado_em timestamptz not null default now(),
  constraint refunds_chave_uq unique (chave_idempotencia),
  constraint refunds_divisao_ck check (integral or situacao not in ('enviada', 'concluida')
    or (taxa_cents is not null and clinica_cents is not null and valor_cents = taxa_cents + clinica_cents)),
  constraint refunds_concluida_ck check ((situacao = 'concluida') = (concluida_em is not null))
);
create index if not exists refunds_charge_idx on pagamentos.refunds (charge_id, criado_em);
create index if not exists refunds_rotina_idx on pagamentos.refunds (situacao, criado_em) where situacao in ('pedida', 'enviada', 'falhou');
-- no máximo uma devolução "no ar" por cobrança: a conta da divisão usa o que já foi concluído
create unique index if not exists refunds_enviada_uq on pagamentos.refunds (charge_id) where situacao = 'enviada';

create table if not exists pagamentos.refund_items (
  refund_id uuid not null constraint refund_items_refund_fk references pagamentos.refunds (id) on delete cascade,
  item_id uuid not null,
  valor_cents integer not null constraint refund_items_valor_ck check (valor_cents >= 1),
  taxa_cents integer constraint refund_items_taxa_ck check (taxa_cents >= 0),
  clinica_cents integer constraint refund_items_clinica_ck check (clinica_cents >= 0),
  primary key (refund_id, item_id),
  constraint refund_items_divisao_ck check ((taxa_cents is null) = (clinica_cents is null)
    and (taxa_cents is null or valor_cents = taxa_cents + clinica_cents))
);

-- Contestações do cartão (fase P4; a tabela e a situação da cobrança já existem).
create table if not exists pagamentos.disputes (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null constraint disputes_charge_fk references pagamentos.charges (id) on delete restrict,
  provedor_disputa_id text constraint disputes_provedor_ck check (provedor_disputa_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  motivo text constraint disputes_motivo_ck check (motivo ~ '^[a-z][a-z0-9_]{2,59}$'),
  situacao text not null default 'aberta' constraint disputes_situacao_ck check (situacao in ('aberta', 'em_defesa', 'encerrada')),
  aberta_em timestamptz not null default now(),
  prazo timestamptz,
  resultado text constraint disputes_resultado_ck check (resultado in ('ganha', 'perdida')),
  encerrada_em timestamptz,
  constraint disputes_encerrada_ck check ((situacao = 'encerrada') = (encerrada_em is not null)
    and (situacao = 'encerrada') = (resultado is not null))
);
create unique index if not exists disputes_aberta_uq on pagamentos.disputes (charge_id) where encerrada_em is null;

-- Extrato: só acrescenta (P-I6). Sem chave estrangeira (guarda os uuid), como as trilhas da agenda. Valor com sinal:
-- entra positivo (recebido do paciente, taxa do IMED, repasse da clínica, tarifa cobrada pelo meio), sai negativo.
create table if not exists pagamentos.ledger (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  charge_id uuid not null,
  refund_id uuid,
  clinic_id uuid not null,
  tipo text not null
    constraint ledger_tipo_ck check (tipo in ('recebido', 'taxa_imed', 'repasse_clinica', 'tarifa_meio', 'devolucao', 'devolucao_taxa',
                                              'devolucao_repasse', 'contestacao', 'contestacao_revertida', 'mensalidade')),
  valor_cents integer not null,
  de_quem text not null constraint ledger_de_quem_ck check (de_quem in ('paciente', 'imed', 'clinica', 'meio')),
  constraint ledger_sinal_ck check (
    case when tipo in ('devolucao', 'devolucao_taxa', 'devolucao_repasse', 'contestacao') then valor_cents < 0
         else valor_cents > 0 end)
);
create index if not exists ledger_charge_idx on pagamentos.ledger (charge_id, id);
create index if not exists ledger_clinica_idx on pagamentos.ledger (clinic_id, quando);

-- Conciliação diária (§5.4): cada rodada e as diferenças que ela achou. A conciliação não corrige nada sozinha.
create table if not exists pagamentos.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  dia date not null,
  janela text not null constraint reconciliation_runs_janela_ck check (janela in ('d1', 'd7', 'd32', 'manual')),
  comecou timestamptz not null default now(),
  terminou timestamptz,
  situacao text not null default 'rodando' constraint reconciliation_runs_situacao_ck check (situacao in ('rodando', 'concluida', 'falhou')),
  contadores jsonb not null default '{}'::jsonb constraint reconciliation_runs_contadores_ck check (octet_length(contadores::text) <= 2000)
);
create index if not exists reconciliation_runs_dia_idx on pagamentos.reconciliation_runs (dia, janela, comecou);

create table if not exists pagamentos.reconciliation_diffs (
  id bigint generated always as identity primary key,
  run_id uuid not null constraint reconciliation_diffs_run_fk references pagamentos.reconciliation_runs (id) on delete restrict,
  provedor_cobranca_id text constraint reconciliation_diffs_cobranca_ck check (provedor_cobranca_id ~ '^[A-Za-z0-9_-]{4,80}$'),
  charge_id uuid,
  tipo text not null constraint reconciliation_diffs_tipo_ck check (tipo in ('falta_aqui', 'falta_la', 'valor', 'situacao', 'repasse', 'tarifa')),
  nosso jsonb,
  deles jsonb,
  critica boolean not null,
  gravidade text not null constraint reconciliation_diffs_gravidade_ck check (gravidade in ('critica', 'alta', 'informativa')),
  criado_em timestamptz not null default now(),
  resolvida_em timestamptz,
  resolvida_por uuid,
  resolucao text constraint reconciliation_diffs_resolucao_ck check (resolucao ~ '^[a-z][a-z0-9_]{2,59}$' and resolucao !~ '[0-9]{4,}'),
  constraint reconciliation_diffs_alvo_ck check (provedor_cobranca_id is not null or charge_id is not null),
  constraint reconciliation_diffs_critica_ck check (critica = (gravidade = 'critica')),
  constraint reconciliation_diffs_resolvida_ck check ((resolvida_em is null) = (resolucao is null)),
  constraint reconciliation_diffs_tamanho_ck check (coalesce(octet_length(nosso::text), 0) + coalesce(octet_length(deles::text), 0) <= 2000)
);
-- a mesma diferença, ainda aberta, não entra duas vezes (a rodada do dia seguinte encontra a de ontem)
create unique index if not exists reconciliation_diffs_aberta_uq on pagamentos.reconciliation_diffs
  ((coalesce(provedor_cobranca_id, '')), (coalesce(charge_id, '00000000-0000-0000-0000-000000000000'::uuid)), tipo)
  where resolvida_em is null;

-- Trilha: só acrescenta, sem chave estrangeira, só códigos, ids e centavos (nunca nome nem texto livre).
create table if not exists pagamentos.audit_log (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  quem_tipo text not null constraint audit_log_quem_ck check (quem_tipo in ('usuario', 'webhook', 'rotina', 'servidor', 'sistema', 'sql')),
  quem_user uuid,
  acao text not null constraint audit_log_acao_ck check (acao ~ '^[a-z][a-z0-9_.]{2,59}$'),
  charge_id uuid,
  refund_id uuid,
  clinic_id uuid,
  objeto text constraint audit_log_objeto_ck check (objeto ~ '^[a-z0-9_.-]{1,64}$'),
  antes jsonb,
  depois jsonb,
  motivo text constraint audit_log_motivo_ck check (motivo ~ '^[a-z][a-z0-9_]{2,59}$' and motivo !~ '[0-9]{4,}'),
  constraint audit_log_tamanho_ck check (coalesce(octet_length(antes::text), 0) + coalesce(octet_length(depois::text), 0) <= 4000)
);
create index if not exists audit_log_quando_idx on pagamentos.audit_log (quando);
create index if not exists audit_log_charge_idx on pagamentos.audit_log (charge_id) where charge_id is not null;

/* ===================== 3. Fora do alcance da API ===================== */
alter table pagamentos.settings enable row level security;
alter table pagamentos.clinic_accounts enable row level security;
alter table pagamentos.fee_rules enable row level security;
alter table pagamentos.payers enable row level security;
alter table pagamentos.plans enable row level security;
alter table pagamentos.subscriptions enable row level security;
alter table pagamentos.featured enable row level security;
alter table pagamentos.charges enable row level security;
alter table pagamentos.charge_items enable row level security;
alter table pagamentos.events enable row level security;
alter table pagamentos.refunds enable row level security;
alter table pagamentos.refund_items enable row level security;
alter table pagamentos.disputes enable row level security;
alter table pagamentos.ledger enable row level security;
alter table pagamentos.reconciliation_runs enable row level security;
alter table pagamentos.reconciliation_diffs enable row level security;
alter table pagamentos.audit_log enable row level security;
revoke all on all tables in schema pagamentos from public, anon, authenticated, service_role;
revoke all on all sequences in schema pagamentos from public, anon, authenticated, service_role;

/* ===================== 4. Guardas ===================== */

-- Uma linha da trilha. quem: a pessoa logada, ou o servidor (p_quem diz se foi o aviso ou a rotina), ou o SQL.
create or replace function private.pag_audit(p_acao text, p_charge uuid, p_refund uuid, p_clinic uuid, p_objeto text,
                                             p_antes jsonb, p_depois jsonb, p_motivo text default null, p_quem text default null)
returns void
language sql
set search_path = ''
as $$
  insert into pagamentos.audit_log (quem_tipo, quem_user, acao, charge_id, refund_id, clinic_id, objeto, antes, depois, motivo)
  values (case when p_quem in ('webhook', 'rotina', 'sistema', 'sql') then p_quem
               when auth.uid() is not null then 'usuario'
               when coalesce(auth.role(), '') = 'service_role' then 'servidor'
               else 'sql' end,
          auth.uid(), p_acao, p_charge, p_refund, p_clinic, p_objeto, p_antes, p_depois, p_motivo);
$$;

-- Extrato e trilha: só acréscimo. (Sem saída de emergência: nem o SQL altera ou apaga uma linha; P-I6.)
create or replace function private.pag_so_acrescenta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '%: só acrescenta (nenhuma linha é alterada ou apagada)', tg_table_name using errcode = '42501';
end $$;

-- Apagar cobrança, devolução, conta ou regra de taxa: só pela saída de emergência do SQL (imed.origin = 'sql' + motivo),
-- registrada. Nenhuma função do sistema apaga.
create or replace function private.pag_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if tg_op = 'TRUNCATE' then
    raise exception '%: não se apaga em bloco', tg_table_name using errcode = '42501';
  end if;
  if private.agenda_origin() is distinct from 'sql' or private.agenda_reason() is null then
    raise exception '%: nenhuma linha é apagada (registros financeiros ficam guardados)', tg_table_name
      using errcode = '42501',
            hint = 'Emergência no SQL: select set_config(''imed.origin'', ''sql'', true), set_config(''imed.reason'', ''<codigo>'', true); (fica registrado)';
  end if;
  v := to_jsonb(old);   -- as tabelas não têm as mesmas colunas: pelo nome, o que faltar fica nulo
  perform private.pag_audit(tg_table_name || '_apagada_sql',
    (case tg_table_name when 'charges' then v ->> 'id' else v ->> 'charge_id' end)::uuid,
    (case tg_table_name when 'refunds' then v ->> 'id' end)::uuid,
    (v ->> 'clinic_id')::uuid, null, null, null, private.agenda_reason(), 'sql');
  return old;
end $$;

-- Cobrança: só as transições do §4.1; o que foi fotografado não muda; o devolvido nunca diminui; cada mudança sobe a
-- versão; o "copia e cola" some quando ela deixa de esperar o pagamento.
create or replace function private.pag_charges_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.id, new.finalidade, new.request_id, new.subscription_id, new.clinic_id, new.provedor, new.emitida_por, new.meio,
      new.valor_cents, new.fee_rule_id, new.fee_bps, new.taxa_cents, new.clinica_cents, new.tentativa, new.chave_idempotencia,
      new.criado_em)
     is distinct from
     (old.id, old.finalidade, old.request_id, old.subscription_id, old.clinic_id, old.provedor, old.emitida_por, old.meio,
      old.valor_cents, old.fee_rule_id, old.fee_bps, old.taxa_cents, old.clinica_cents, old.tentativa, old.chave_idempotencia,
      old.criado_em) then
    raise exception 'cobrança %: valor, taxa, parte da clínica e dono não mudam depois de gravados', old.id using errcode = '42501';
  end if;
  if old.provedor_cobranca_id is not null and new.provedor_cobranca_id is distinct from old.provedor_cobranca_id then
    raise exception 'cobrança %: o id no provedor não muda', old.id using errcode = '42501';
  end if;
  if new.devolvido_cents < old.devolvido_cents or new.taxa_devolvida_cents < old.taxa_devolvida_cents
     or new.clinica_devolvida_cents < old.clinica_devolvida_cents then
    raise exception 'cobrança %: o total devolvido nunca diminui', old.id using errcode = '23514';
  end if;
  if old.paga_em is not null and (new.paga_em is distinct from old.paga_em or new.pago_cents is distinct from old.pago_cents) then
    raise exception 'cobrança %: o pagamento registrado não muda', old.id using errcode = '42501';
  end if;
  if new.situacao is distinct from old.situacao and not (
       (old.situacao = 'criada' and new.situacao in ('aguardando', 'cancelada'))
    or (old.situacao = 'aguardando' and new.situacao in ('processando', 'aprovada', 'expirada', 'cancelada', 'recusada'))
    or (old.situacao = 'processando' and new.situacao in ('aprovada', 'recusada', 'expirada', 'cancelada'))
    or (old.situacao = 'aprovada' and new.situacao in ('devolvida_parcial', 'devolvida', 'contestada'))
    or (old.situacao = 'devolvida_parcial' and new.situacao in ('devolvida', 'contestada'))
    -- contestação vencida: volta a como estava antes dela; perdida: o dinheiro saiu
    or (old.situacao = 'contestada' and new.situacao in ('aprovada', 'devolvida_parcial', 'devolvida'))
    -- dinheiro que chegou numa cobrança já encerrada volta inteiro (nunca reabre: expirada e cancelada não voltam a aprovada)
    or (old.situacao in ('expirada', 'cancelada') and new.situacao = 'devolvida' and new.paga_em is not null)) then
    raise exception 'cobrança %: transição % → % não é permitida', old.id, old.situacao, new.situacao using errcode = '23514';
  end if;
  if new.situacao <> 'aguardando' then new.pix_copia_cola := null; end if;
  if new is distinct from old then
    new.versao := old.versao + 1;
    new.atualizado_em := now();
  end if;
  return new;
end $$;

-- Taxa: o valor não muda; a única mudança aceita é fechar o período (vale_ate, uma vez).
create or replace function private.pag_fee_rules_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.id, new.clinic_id, new.finalidade, new.tipo, new.fee_bps, new.fee_cents, new.vale_de, new.motivo, new.criado_por, new.criado_em)
     is distinct from
     (old.id, old.clinic_id, old.finalidade, old.tipo, old.fee_bps, old.fee_cents, old.vale_de, old.motivo, old.criado_por, old.criado_em)
     or (old.vale_ate is not null and new.vale_ate is distinct from old.vale_ate) then
    raise exception 'regra de taxa %: não se altera (taxa nova = linha nova que fecha a anterior)', old.id using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function private.pag_audit(text, uuid, uuid, uuid, text, jsonb, jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function private.pag_so_acrescenta() from public, anon, authenticated, service_role;
revoke all on function private.pag_guard_delete() from public, anon, authenticated, service_role;
revoke all on function private.pag_charges_guard() from public, anon, authenticated, service_role;
revoke all on function private.pag_fee_rules_guard() from public, anon, authenticated, service_role;

create or replace trigger ledger_guard
  before update or delete on pagamentos.ledger
  for each row execute function private.pag_so_acrescenta();
create or replace trigger ledger_guard_truncate
  before truncate on pagamentos.ledger
  for each statement execute function private.pag_so_acrescenta();
create or replace trigger audit_log_guard
  before update or delete on pagamentos.audit_log
  for each row execute function private.pag_so_acrescenta();
create or replace trigger audit_log_guard_truncate
  before truncate on pagamentos.audit_log
  for each statement execute function private.pag_so_acrescenta();
create or replace trigger charges_guard
  before update on pagamentos.charges
  for each row execute function private.pag_charges_guard();
create or replace trigger charges_guard_delete
  before delete on pagamentos.charges
  for each row execute function private.pag_guard_delete();
create or replace trigger charges_guard_truncate
  before truncate on pagamentos.charges
  for each statement execute function private.pag_guard_delete();
create or replace trigger charge_items_guard_delete
  before delete on pagamentos.charge_items
  for each row execute function private.pag_guard_delete();
create or replace trigger refunds_guard_delete
  before delete on pagamentos.refunds
  for each row execute function private.pag_guard_delete();
create or replace trigger clinic_accounts_guard_delete
  before delete on pagamentos.clinic_accounts
  for each row execute function private.pag_guard_delete();
create or replace trigger fee_rules_guard
  before update on pagamentos.fee_rules
  for each row execute function private.pag_fee_rules_guard();
create or replace trigger fee_rules_guard_delete
  before delete on pagamentos.fee_rules
  for each row execute function private.pag_guard_delete();

-- As guardas valem sempre, também com session_replication_role = replica (como as da agenda).
alter table pagamentos.ledger enable always trigger ledger_guard;
alter table pagamentos.ledger enable always trigger ledger_guard_truncate;
alter table pagamentos.audit_log enable always trigger audit_log_guard;
alter table pagamentos.audit_log enable always trigger audit_log_guard_truncate;
alter table pagamentos.charges enable always trigger charges_guard;
alter table pagamentos.charges enable always trigger charges_guard_delete;
alter table pagamentos.charges enable always trigger charges_guard_truncate;
alter table pagamentos.charge_items enable always trigger charge_items_guard_delete;
alter table pagamentos.refunds enable always trigger refunds_guard_delete;
alter table pagamentos.clinic_accounts enable always trigger clinic_accounts_guard_delete;
alter table pagamentos.fee_rules enable always trigger fee_rules_guard;
alter table pagamentos.fee_rules enable always trigger fee_rules_guard_delete;

/* ===================== 5. Referências (tudo desligado) ===================== */
-- Parâmetros. Linha que já existe fica como está (rodar de novo não desfaz uma mudança feita pela gestão).
insert into pagamentos.settings (chave, valor, a_confirmar) values
  ('vendas_online_ligadas', 'false', false),            -- a chave geral: desligada
  ('minutos_qr', '8', false),                           -- o QR some 2 min antes do fim da reserva de 10 (§4.2; decisão 5)
  ('preco_minimo_online_cents', '2000', false),         -- abaixo disso o exame continua "pagamento no local" (decisão 19)
  ('max_tentativas_cobranca', '3', false),              -- cobranças por agendamento (§6.2)
  ('teto_processando_min', '30', false),                -- quanto a análise do cartão segura a reserva (§4.6)
  ('regra_devolucao_antes_24h', '"total"', false),      -- §4.5, itens 1 a 4 (decisões 3 e 4)
  ('regra_devolucao_7_dias', '"total"', false),
  ('regra_devolucao_em_cima_da_hora', '"total"', false),
  ('regra_devolucao_falta', '"nenhuma"', false),
  ('tolerancia_destaque_dias', '5', false),             -- §8: atrasada → suspensa
  ('suspensao_destaque_dias', '30', false),             -- §8: suspensa → cancelada
  -- tarifas do meio de pagamento: valores públicos da pesquisa de 11/11/2026 (§2.1), A CONFIRMAR na conta de verdade
  ('tarifa_pix_cents', '199', true),
  ('tarifa_cartao_bps', '299', true),
  ('tarifa_cartao_fixo_cents', '49', true),
  ('liquidacao_cartao_dias', '32', true)
on conflict (chave) do nothing;

-- Taxa de partida do IMED: 15% por exame (definida pelo dono; decisão 10), para todas as clínicas.
insert into pagamentos.fee_rules (clinic_id, finalidade, tipo, fee_bps, motivo)
select null, 'exame', 'percentual', 1500, 'taxa_de_partida'
where not exists (select 1 from pagamentos.fee_rules f where f.clinic_id is null and f.finalidade = 'exame');

-- Permissões novas da clínica (§5.3): só o dono liga o recebimento e pede devolução. A equipe do IMED: nenhuma linha
-- (imed.financeiro.operar fica só com o dono do IMED, que tem todas; decisão 22).
insert into agenda.role_permissions (role, permission, scope) values
  ('owner', 'financeiro.configurar', 'clinica'),
  ('owner', 'financeiro.estornar', 'clinica')
on conflict (role, permission) do nothing;

-- A cobrança não nasceu (meio de pagamento fora do ar): o sistema solta a reserva na hora (§4.4).
insert into agenda.status_transitions (from_status, to_status, actor_kind, permission, requires_reason, time_rule, needs_engine)
values ('hold', 'cancelled', 'sistema', null, false, null, false)
on conflict (from_status, to_status, actor_kind) do nothing;

/* ===================== 6. Descrições ===================== */
comment on table pagamentos.settings is 'Parâmetros do pagamento (chave geral, prazos, preço mínimo, regra de devolução, tarifas a confirmar). Mudança só por função, com registro.';
comment on table pagamentos.clinic_accounts is 'Conta da clínica no meio de pagamento (carteira de destino da divisão). Vazia até a clínica ligar o recebimento.';
comment on table pagamentos.fee_rules is 'Taxa do IMED por clínica (nulo = padrão) e finalidade, com histórico e sem sobreposição. Nunca UPDATE do valor.';
comment on table pagamentos.charges is 'Cobranças (uma por tentativa). valor = taxa + parte da clínica, fotografados na criação. No máximo uma viva por agendamento.';
comment on table pagamentos.events is 'Avisos do provedor: só campos da lista e o hash do corpo. O corpo não é guardado.';
comment on table pagamentos.refunds is 'Devoluções: pedido gravado (com chave de idempotência) e enviado pela rotina, uma por vez por cobrança.';
comment on table pagamentos.ledger is 'Extrato: só acrescenta (P-I6). Valor em centavos, com sinal.';
comment on table pagamentos.audit_log is 'Trilha do pagamento: só acrescenta; só códigos, ids e centavos.';
