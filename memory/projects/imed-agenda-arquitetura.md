# iMed Agenda — arquitetura final (fase 2)

> Agenda compartilhada entre o app do paciente, o painel da clínica, a central do IMED e sistemas externos.
> Pedido do dono de 30/10/2026 (texto integral fora do repositório): as 15 regras de horário estão no §4, os cenários A a D
> nos §5 e §6, as três modalidades no §8 e os 10 testes obrigatórios no §13. Este documento é a referência para as fases 3 a 7.
> Versão final de 31/10/2026: proposta do arquiteto + duas revisões independentes, com as correções procedentes.

**Como foi feito (só leitura).** Nenhum arquivo do repositório foi alterado além deste. No banco `pyoqiecupxhdzigjudyd`
rodei só SELECT e consultas ao catálogo. A parte mais delicada (restrição de exclusão e concorrência) foi provada na
prática num PostgreSQL 16.15 descartável nesta máquina, fora do repositório e do banco de produção, e apagado depois
(resultados no §3.4; o roteiro vira teste automático na fase 3.0). Três pontos foram conferidos na documentação do
Supabase: prazo das chaves antigas, tempo-limite por função e limite de conexões públicas do Realtime.

---

## 0. A arquitetura em uma página

1. **Um sistema só.** `public.clinics` é a unidade; `public.appointment_requests` é o agendamento (o cabeçalho, inclusive
   de pacote). O resto mora num schema novo, `agenda`, fora da API. Nada de segunda tabela de clínicas, agendamentos ou reservas.
2. **Uma fonte de verdade para "ocupado".** Cada uso de aparelho, sala, profissional ou "vaga de chegada" é uma linha em
   `agenda.occupancy`, protegida por uma restrição de exclusão (EXCLUDE) do Postgres. É a última palavra, para qualquer
   caminho de escrita.
3. **Travas curtas por recurso.** Antes de planejar, cada escrita trava (só até o fim da transação) os recursos candidatos,
   em ordem fixa, e a configuração da clínica tem uma trava própria. Sem isso, o teste prático mostrou "tempestades de
   impasse" de 47 s e de 87 s; com isso, nenhuma.
4. **Sem reserva anônima.** Sem pagamento online (que é o caso hoje), o paciente escolhe o horário, preenche os dados e o
   botão "Confirmar" confere, reserva e confirma de uma vez. A reserva temporária (10 min) existe para o pagamento online e
   para a integração com o sistema da clínica, e sempre tem os dados do paciente.
5. **Sem "configuração implícita".** O editor simples de horários de hoje (nenhuma clínica usa) é substituído por cadastros
   reais de aparelhos, salas, profissionais e procedimentos, com uma "configuração rápida" para quem tem pressa.
6. **Venda online só depois da fase 5.1.** Até o app novo do paciente estar no ar, todas as clínicas continuam no modelo de
   pedido. A modalidade só muda por ação explícita da clínica (e, na manual, com o compromisso de registrar tudo no painel).
7. **Tempo real é acelerador, não garantia.** Aviso pelo Supabase Realtime (canal privado, sem dado pessoal) mais conferência
   periódica da versão da agenda. A correção nunca depende do aviso.
8. **Integração externa com autoridade definida por recurso.** Recurso que pertence ao sistema da clínica nunca é liberado
   por tempo. Nenhum conector é presumido: cada software é homologado com documentação e credenciais reais.
9. **Pagamento e avisos:** estrutura pronta e desligada até o dono escolher os provedores. Nada aparece como "pago" ou
   "enviado" sem evento real.
10. **Segurança e LGPD por padrão:** permissões explícitas função a função (inclusive para `authenticated`), papéis por
    clínica, equipe do IMED fora do `admin_emails`, trilhas só com códigos, dado pessoal nunca em URL nem em log.
11. **Urgente e fora da agenda:** as chaves antigas do Supabase (`anon` e `service_role`) param no fim de 2026 e o site
    inteiro depende delas. Isso virou a fase 0, com prazo.

---

## Revisões: o que entrou, o que mudou e o que foi descartado

Revisão 1 = integridade e concorrência. Revisão 2 = segurança, LGPD, compatibilidade e viabilidade.

| Item | Decisão | Onde |
|---|---|---|
| R1-A1 agendamento com horário sem linha de ocupação | **Aceito.** Gatilhos adiados (I2) em itens, ocupação e cabeçalho; confirmar com horário só pelo alocador; mudar situação, horário ou ocupação fora das funções é recusado (há saída de emergência registrada). "Proibir ON CONFLICT" o banco não consegue impor: vira regra de código + teste de catálogo, e o I2 pega o efeito no COMMIT | §3.2 |
| R1-A2 capacidade > 1 e "uso × fechamento" misturados | **Aceito, na forma da R2-10:** vagas viram faixa (`seats int4range`); uso ocupa 1 vaga; bloqueio cobre todas ([1,51)), inclusive vagas criadas depois; CHECK amarra tipo e forma; capacidade lida com FOR SHARE; reduzir capacidade só sem usos futuros acima dela | §2.5, §3.2 |
| R1-A3 configuração só no lado da leitura | **Aceito.** Trava de configuração por clínica (compartilhada para quem marca, exclusiva para quem configura) + revalidação dos agendamentos futuros na mesma transação; bloqueio de unidade vira ocupação em todos os recursos; recurso novo herda bloqueios futuros; revalidação diária (feriado nacional) | §3.2 |
| R1-A4 recurso implícito × explícito do mesmo aparelho | **Resolvido de outro jeito:** a configuração implícita foi eliminada | §2.4 |
| R1-A5 integração externa (409 não desfaz o paciente de lá, expiração, cota, remarcação, foto velha) | **Aceito integralmente** | §8 |
| R1-M1 ordem dos eventos externos | **Aceito** (portão atômico de versão, lápide, fila por agendamento, hash como chave reserva) | §8 |
| R1-M2 impasses (40P01) com 1 s cada | **Aceito e confirmado na prática, pior que o previsto** (cadeias de 47 s e 87 s). **Ajuste:** trava por recurso, não por (recurso, dia): o número de travas fica limitado (um bloqueio de um ano não pede 365 travas; a tabela de travas do Postgres é compartilhada, 64 por conexão) e a disputa real por recurso é pequena. Medido: 100 pedidos simultâneos no mesmo aparelho resolvidos sem erro | §3.2, §3.4 |
| R1-M3 sub-transações demais | **Aceito** (lotes de 50 com COMMIT; aviso uma vez por clínica por transação; conferir antes em vez de usar exceção) | §3.2 |
| R1-M4 fuso (transição, troca, regra nova de horário de verão, hora repetida) | **Aceito** (a, b, c, d) | §4 |
| R1-M5 ponte do INSERT antigo | **Resolvido de outro jeito:** não há ponte; o INSERT direto com horário é recusado a partir da 3.3. Permissão de INSERT por coluna e marca de transação continuam (R2-4) | §2.3, §2.4 |
| R1-M6 I2 conferindo contra a configuração atual | **Aceito:** o item guarda os grupos exigidos na marcação | §2.5 |
| R1-M7 configuração implícita com duração errada | **Não se aplica** (sem configuração implícita) | §2.4 |
| R1-M8 pacientes por horário ≠ capacidade simultânea | **Aceito:** recurso "chegadas" com bloco alinhado | §2.5, §4 |
| R1-M9 Pix depois de expirar | **Aceito** (fase 5.4) | §9 |
| R1-M10 desempenho | **Aceito** (mapa materializado; parar no primeiro livre; até 10 clínicas; tempo-limite por função, que a documentação do Supabase confirma valer pela API) | §4 |
| R1-B1 a B12 | **Aceitos.** B6 some (a otimização "seat+1000" saiu); B7: a migração para se encontrar dados antigos (hoje 0) | §3, §5, §6 |
| R2-1 funções "só do servidor" executáveis por qualquer logado | **Aceito** (confirmado: o padrão do schema public dá EXECUTE a anon, authenticated e service_role) | §12 |
| R2-2 papéis da equipe IMED viram admin total | **Aceito** (confirmado: 22 funções e 15 policies decidem só por `is_imed_admin()`) | §12 |
| R2-3 escrita anônima sem freio | **Aceito, mais forte:** sem reserva anônima; INSERT direto com horário recusado já na 3.3 (antes do que a revisão propôs, porque nenhuma clínica vende online antes da 5.1); contadores com upsert; IPv6 por /64; o teto por clínica pede Turnstile em vez de recusar todo mundo | §3.2, §12 |
| R2-4 colunas novas preenchíveis pelo navegador; validação presa a `current_user` | **Aceito** (INSERT por coluna; marca `imed.origin`; uma única função de validação) | §2.3 |
| R2-5 chaves antigas param no fim de 2026 | **Aceito como fase 0** (confirmado: "keep working until the end of 2026") | §14 |
| R2-6 reserva dentro da tabela de pedidos | **Parcial.** Como a reserva agora sempre tem dados do paciente, o cabeçalho continua em `appointment_requests` com nome, telefone e consentimento obrigatórios. **Descartado** guardar a reserva só no schema `agenda`: criaria um segundo lugar para o mesmo agendamento. **Aceito** filtrar `hold`/`expired` em todas as policies e somas, com teste | §2.3, §5 |
| R2-7 editor antigo reescreve regras novas | **Resolvido:** `set_my_schedule` responde `managed_by_agenda` a partir da 3.2 e a tela antiga sai na 4.1 | §2.4 |
| R2-8 fuso fixo de São Paulo no site | **Aceito** | §4 |
| R2-9 configuração implícita fere a regra e o texto honesto | **Aceito:** eliminada; modalidade só muda por ação explícita | §2.4, §8 |
| R2-10 bloqueio, capacidade e "bloquear mesmo assim" | (a) e (b) **aceitos**. (c) **descartado:** o `add_my_block` antigo não responde "ok" passando por cima de pacientes; responde `has_appointments` sem gravar, porque a tela antiga não consegue mostrar quem seria afetado | §2.4, §11 |
| R2-11 "só ocupar o horário" | **Aceito:** tipo `ocupado` + `agenda.busy_marks`, sem dado pessoal | §2.5 |
| R2-12 trilhas com texto livre e chaves estrangeiras | **Aceito** (trilhas só com códigos e sem FK; texto livre em tabela apagável; equipe por `user_id`) | §2.5, §12 |
| R2-13 `access_log` contornável pela REST | **Aceito** (leitura direta fecha quando o painel novo sai; funções VOLATILE por POST; registro agregado) | §11, §12 |
| R2-14 SSRF no webhook de saída e precedência do pagamento | **Aceito** | §8, §9 |
| R2-15 `agenda_next_free` e os 3 s do anon | **Aceito** | §4 |
| R2-16 situações novas no site antigo | **Aceito:** rótulos do paciente sobem na 4.2, antes de o painel criar essas situações | §5, §14 |
| R2-17 dependências do plano | **Aceito:** fase 0; cada tabela na fase que a usa; produto mínimo primeiro; laço rápido no PostgreSQL 16 local (já usado nesta revisão); script de volta | §14 |
| R2-18 a R2-26 | **Aceitos** (18: não anunciar tempo real antes do piloto; 19: limpeza do cron; 20: contadores e último dono com trava; 21: convite só com e-mail confirmado e link; 22: MFA entra na 4.1 se o dono decidir; 23: feriados por escopo e horizonte; 24: impressão digital sem dado pessoal; 25: Marco Civil vai ao advogado; 26: afirmação corrigida) | vários |
| R2 correção do diagnóstico | **Aceito:** são 17 funções, não 15 | §1 |

O que saiu da proposta original: a ponte do INSERT direto, a configuração implícita, a reserva sem dados pessoais (e o
afrouxamento do NOT NULL), o pacote parcial, as colunas `created_by`, `request_fingerprint` e `partial_allowed` no
cabeçalho, e a criação antecipada das tabelas de pagamento, integração e avisos.

---

## 1. Diagnóstico técnico

**Stack (conferida em 30–31/10/2026)**
- Site estático (HTML, CSS, módulos ES, sem build) no GitHub Pages, com service worker (`sw.js`, rede primeiro para scripts).
- Supabase em São Paulo, plano Free: PostgreSQL 17.11, `max_connections` 60, READ COMMITTED, servidor em UTC,
  `deadlock_timeout` 1 s, `max_locks_per_transaction` 64.
- Limites por papel: anon 3 s, authenticated 8 s (o authenticator também tem `lock_timeout`). PostgREST: uma transação por chamada.
- Login por link mágico pela REST, sem supabase-js (`assets/js/auth.js`). Duas Edge Functions (`clinicas-proximas`, `importar-clinicas`).
- Extensões: pg_cron 1.6.4, pg_net, pgcrypto, PostGIS, Vault (0 segredos). `btree_gist` 1.7 disponível e não instalado.
- pg_cron: 3 jobs (`imed-fila-importacao` a cada minuto, `imed-teleconsulta-expira` a cada 10 min, `imed-atualizacao-mensal`).
  `cron.job_run_details` com 1.391 linhas e sem limpeza.
- Realtime: nenhuma policy em `realtime.messages`, tabela particionada sem nenhuma partição, publicação vazia.
  `realtime.send` engole qualquer erro (bloco EXCEPTION, só WARNING) e faz `SET LOCAL realtime.topic`.
- **Chaves:** o site usa a chave `anon` antiga em `Authorization: Bearer`. A documentação do Supabase diz que as chaves
  antigas funcionam "até o fim de 2026" e que as novas (publishable/secret) não podem ir em `Bearer`.

**Dados reais hoje.** 12 clínicas, todas fictícias (`is_demo`); 0 membros; 0 contas no Auth; 0 faixas de horário;
0 bloqueios; 1 pedido (concierge, sem horário). Não há agendamento a converter: é o momento seguro de trocar o modelo.
Como não há contas e o e-mail padrão do Supabase só entrega para a equipe do projeto, hoje nenhuma clínica consegue entrar.

**Agenda atual (migração `20261030034539_agenda`)**
- `clinic_schedules`: faixas por dia da semana com `exam_codes` (vazio = todos) e `slot_minutes`; passo = duração;
  nenhuma conferência de faixas sobrepostas. `set_my_schedule` apaga e regrava tudo.
- `clinic_blocks`: vale para a clínica inteira.
- `available_slots`: fuso fixo de São Paulo, antecedência fixa de 2 h, até 300 linhas; confere só o INÍCIO do horário.
- O gatilho `check_appointment_request` (SECURITY INVOKER) grava "confirmed" na hora.
- O índice único `(clinic_id, coalesce(exam_code,''), slot_start)` não impede intervalos que se cruzam com inícios
  diferentes, exames diferentes no mesmo aparelho nem capacidade maior que 1.

**Permissões hoje**
- `appointment_requests`: anon tem INSERT/SELECT na tabela inteira; authenticated tem INSERT/SELECT/UPDATE/DELETE (com RLS).
  A policy "admin atualiza pedidos" (UPDATE) permite escrita direta fora de qualquer trilha. Toda coluna nova nasce gravável por anon.
- `clinics`: policy "admin gerencia clinicas" (ALL) — o admin troca qualquer coluna por PATCH.
- `clinic_schedules` e `clinic_blocks`: só leitura para membros.
- Privilégio padrão no schema public: função nova nasce executável por anon, authenticated e service_role; tabela nova
  nasce `arwd` para anon e authenticated (só a RLS protege).
- `private` não dá USAGE a anon, authenticated nem service_role.
- `is_imed_admin()`: robusto (e-mail confirmado, sessão aberta pelo link, sem senha/anônimo), mas é sim/não; 22 funções e
  15 policies decidem só por ele. `clinic_members` tem `owner`/`staff`, e o papel não muda nada (`is_clinic_member`).

**Funções que tocam agenda, pedidos ou membros (17; todas precisam continuar funcionando):** `private.clinic_slot_grid`,
`available_slots`, `clinics_with_schedule`, `check_appointment_request`, `set_my_schedule`, `add_my_block`,
`remove_my_block`, `cancel_request`, `set_request_status`, `request_status`, `submit_review`, `admin_gestao`, `admin_stats`,
`approve_claim`, `is_clinic_member`, `set_my_clinic_exams`, `update_my_clinic`.

**O site que não pode quebrar**
- Chamadas: `local.js:459, 483` (`clinics_with_schedule`, `available_slots`), `perto.js:294`, `painel.js:497-498, 723, 788, 825`,
  `conta.js:103, 481` (leitura direta dos pedidos), `local.js:710` e `perto.js:1748` (INSERT direto).
- O INSERT do pedido (`geo-core.js` `bookingRow`) manda 23 colunas: `id, clinic_id, place_source, place_ref, place_name,
  place_address, place_phone, exam_code, preferred_date, preferred_period, patient_name, patient_phone, patient_email,
  notes, consent, slot_start, for_other, other_name, relationship, other_minor, guardian_consent, other_consent,
  review_token_hash`.
- E2E que fixam o contrato: `e2e-local.mjs:391` e `:447` (409/23P01), `e2e-clinica.mjs:1338, 1400, 1495`;
  `visitas.test.mjs:298` confere o SQL de `admin_stats`.
- Fuso fixo de São Paulo em `geo-core.js` (inclusive o `.ics`), `conta.js`, `confianca.js`, `clinica.js` e `painel.js`
  (`SP_OFFSET='-03:00'`). `statusLabel` só conhece 5 situações. `local.js:699` gera um id novo a cada envio (o reenvio duplica).
- `clinics.opening_hours` (horário mostrado ao público) é editado no perfil da clínica: com a agenda ativa, viraria um segundo
  horário. Decisão: com a agenda ativa, ele passa a ser derivado das regras da unidade.

**Lacunas.** Não existem: recursos, durações por procedimento, preparo e higienização, feriados, reserva temporária,
remarcação, pacote, pagamento, integração externa, avisos, auditoria da agenda, tempo real e testes com Postgres de verdade.

---

## 2. Modelagem de dados

### 2.1 Regras do esquema
- `create schema agenda; revoke all on schema agenda from public, anon, authenticated, service_role;`
  Toda tabela com RLS ligada, sem policy e com `revoke all`. Acesso só por funções.
- Funções públicas: `public.agenda_*`, SECURITY DEFINER, `set search_path = ''`, sempre
  `revoke all on function … from public, anon, authenticated` seguido de `grant execute` explícito ao papel certo
  (anon só para consulta pública e marcação do paciente; authenticated para paciente logado e clínica; service_role para o servidor).
  Funções internas: `private.agenda_*`. Toda função confere a permissão por dentro e deriva a clínica do próprio registro.
- Trilhas (`status_history`, `audit_log`, `access_log`, depois `payment_events` e `sync_events`): só acréscimo, sem chave
  estrangeira (guardam o uuid), só códigos. Guarda no modelo do `tele_doc_guard`: UPDATE/DELETE/TRUNCATE dão erro, exceto a
  rotina de retenção (`session_user = 'postgres'` e `set local imed.retencao = 'on'`).
- Marca de origem: as funções fazem `set_config('imed.origin', '<app|painel|central|api|webhook_pagamento|cron>', true)`.
  O cliente REST não consegue definir essa variável. Gatilhos usam a marca para separar "caminho antigo" de "função da agenda"
  (no lugar de `current_user`, que deixa de servir em SECURITY DEFINER).
- Cada tabela nasce na fase que a usa (§14).

### 2.2 Mapa das entidades pedidas

| Entidade do pedido | Onde fica |
|---|---|
| Clínica / unidade / filial | `public.clinics` (1 linha = 1 local com CNES). Nova unidade = nova reivindicação do CNES; o usuário escolhe a unidade no painel. Agrupar redes (`clinic_orgs`) é decisão 16 |
| Usuários e permissões | `auth.users` + `public.clinic_members` (papéis) + `agenda.role_permissions`; equipe do IMED em `private.imed_staff` |
| Exames e catálogo de procedimentos | categorias continuam os 9 códigos (`clinic_exams`); procedimento específico em `agenda.procedures` |
| Equipamentos, salas, profissionais, vagas de chegada | `agenda.resources` (`kind`) |
| Escalas e regras de disponibilidade | `public.clinic_schedules` evoluída (abre/pausa, unidade ou recurso, validade) |
| Feriados | `agenda.holidays` (nacional, estadual, municipal) + `agenda.holiday_openings`; feriado só da unidade = bloqueio |
| Bloqueios | `public.clinic_blocks` evoluída (unidade ou recurso, tipo, remoção lógica) → linhas de fechamento na ocupação |
| Reserva temporária | situação `hold` / `awaiting_payment` do agendamento + prazo; não é tabela própria |
| Agendamento e itens | `appointment_requests` (cabeçalho, inclusive pacote) + `agenda.appointment_items` (1 por exame) |
| Ocupação de recurso (o coração) | `agenda.occupancy` com EXCLUDE |
| Ocupado sem paciente (balcão) | `agenda.busy_marks` |
| Pagamentos | `agenda.payments` + `agenda.payment_events` (fase 5.4) |
| Integrações e sincronização | `agenda.integrations`, `agenda.external_refs`, `agenda.sync_events` (fase 6.1) |
| Fila de saída e avisos | `agenda.outbox`, `agenda.notifications`, `agenda.notification_rules` (fase 5.3) |
| Auditoria | `agenda.status_history`, `agenda.audit_log`, `agenda.access_log`; texto livre em `agenda.notes` (apagável) |
| Idempotência, versão, conflitos, limites | `agenda.idempotency`, `agenda.clinic_versions`, `agenda.conflicts`, `agenda.rate_counters` |

### 2.3 Tabelas existentes (só colunas novas; nada apagado)

```sql
-- clinics: a unidade
alter table public.clinics
  add column timezone text not null default 'America/Sao_Paulo' check (timezone in (
    'America/Sao_Paulo','America/Bahia','America/Fortaleza','America/Recife','America/Maceio','America/Belem',
    'America/Santarem','America/Araguaina','America/Manaus','America/Eirunepe','America/Rio_Branco',
    'America/Porto_Velho','America/Boa_Vista','America/Cuiaba','America/Campo_Grande','America/Noronha')),
  add column timezone_confirmed_at timestamptz,          -- agenda só ativa depois que a clínica confirma o fuso
  add column agenda_mode text not null default 'pedido'
    check (agenda_mode in ('pedido','nativa','manual','externa')),
  add column agenda_online_since timestamptz;            -- nulo = não vende horário online
-- Preenchimento do fuso pela UF (coluna state); Fernando de Noronha (IBGE 2605459, pelo CNES) = America/Noronha.
-- Oeste do AM (UTC-5): não é deduzido; a clínica confirma (decisão 15).
-- Gatilho clinics_agenda_guard (BEFORE UPDATE OF timezone, agenda_mode, agenda_online_since): só por função da agenda
-- (marca imed.origin); trocar o fuso com agendamentos futuros abre conflito 'fuso_mudou' para cada um ou é recusado.
-- Isso fecha também o PATCH direto permitido hoje pela policy "admin gerencia clinicas".

-- clinic_members: papéis de verdade
alter table public.clinic_members drop constraint clinic_members_role_check,
  add constraint clinic_members_role_check
    check (role in ('owner','manager','reception','professional','finance','staff')),   -- staff = recepção (legado)
  add column created_by uuid, add column updated_at timestamptz not null default now();
-- O último dono não pode ser removido nem rebaixado: a função trava as linhas de dono (FOR UPDATE) antes de contar.

-- clinic_schedules: passa a ser a tabela de regras de disponibilidade
alter table public.clinic_schedules
  add column resource_id uuid,                            -- nulo = a unidade
  add column kind text not null default 'abre' check (kind in ('abre','pausa')),
  add column valid_from date, add column valid_to date,   -- escala de período ou dia específico
  add column label text check (char_length(label) <= 60), -- ex.: "Almoço"
  add column procedure_ids uuid[] not null default '{}',  -- vazio = todos os procedimentos
  add column created_by uuid, add column updated_at timestamptz not null default now(),
  add constraint clinic_schedules_valid_ck check (valid_to is null or valid_from is null or valid_to >= valid_from),
  add constraint clinic_schedules_resource_fk foreign key (resource_id, clinic_id)
    references agenda.resources (id, clinic_id) on delete cascade;
-- exam_codes e slot_minutes: só do editor antigo; o motor novo ignora; removidas depois da 4.1.
-- Janelas não atravessam a meia-noite; dia inteiro = 00:00–24:00. Sobreposição no mesmo escopo é recusada
-- pela função de cadastro ('overlapping_rules').

-- clinic_blocks: bloqueio de unidade ou de recurso
alter table public.clinic_blocks
  add column resource_id uuid,                            -- nulo = unidade inteira
  add column kind text not null default 'bloqueio' check (kind in ('bloqueio','manutencao','feriado','folga')),
  add column created_by uuid, add column removed_at timestamptz, add column removed_by uuid,
  add constraint clinic_blocks_resource_fk foreign key (resource_id, clinic_id)
    references agenda.resources (id, clinic_id) on delete cascade;
-- Remover = remoção lógica. A policy de leitura ganha "and removed_at is null".
-- Cada bloqueio ativo vira linhas de fechamento em agenda.occupancy (uma por recurso afetado).

-- appointment_requests: o agendamento (cabeçalho)
alter table public.appointment_requests
  add column channel text not null default 'imed_app' check (channel in
    ('imed_app','imed_equipe','clinica_telefone','clinica_balcao','clinica_outro','externo')),
  add column slot_end timestamptz,                        -- fim do último item
  add column hold_expires_at timestamptz,                 -- só em hold/awaiting_payment (fonte única do prazo)
  add column version integer not null default 1,
  add column updated_at timestamptz not null default now(),
  add column cancel_reason text check (cancel_reason in ('paciente_desistiu','paciente_nao_pode',
    'clinica_indisponivel','equipamento_manutencao','profissional_ausente','nao_pago','reserva_expirada',
    'duplicado','remarcado','outro')),
  add column total_cents integer check (total_cents >= 0),  -- soma dos preços informados; nulo se algum é "sob consulta"
  add column payment_mode text not null default 'no_local' check (payment_mode in ('no_local','online')),
  add column notify_channels text[] not null default '{}',  -- consentimento por canal
  add column uses_resources boolean not null default false; -- marcado pelo motor novo
alter table public.appointment_requests drop constraint appointment_requests_status_check,
  add constraint appointment_requests_status_check check (status in ('pending','contacted','hold',
    'awaiting_payment','confirmed','checked_in','in_service','completed','no_show','reschedule_requested',
    'cancelled','expired'));
alter table public.appointment_requests drop constraint appointment_requests_cancelled_by_check,
  add constraint appointment_requests_cancelled_by_check
    check (cancelled_by is null or cancelled_by in ('patient','clinic','imed','system','external'));
-- Nome, telefone e o CHECK (consent) continuam obrigatórios: toda reserva tem dados do paciente (§5).
create index on public.appointment_requests (clinic_id, slot_start) where slot_start is not null;
create index on public.appointment_requests (hold_expires_at) where status in ('hold','awaiting_payment');

-- Permissões (3.1): fim da escrita direta, INSERT só nas colunas do pedido de hoje
drop policy "admin atualiza pedidos" on public.appointment_requests;
revoke insert, update, delete on public.appointment_requests from anon, authenticated;
grant insert (id, clinic_id, place_source, place_ref, place_name, place_address, place_phone, exam_code,
  preferred_date, preferred_period, patient_name, patient_phone, patient_email, notes, consent, slot_start,
  for_other, other_name, relationship, other_minor, guardian_consent, other_consent, review_token_hash)
  on public.appointment_requests to anon, authenticated;
```

Gatilhos de `appointment_requests`:
- `appointment_requests_check` (BEFORE INSERT): a função passa a SECURITY DEFINER (`search_path = ''`, sem EXECUTE para
  ninguém, como hoje). Sem a marca `imed.origin` é o caminho antigo: as mesmas regras de hoje (inclusive o consentimento do
  responsável para menor, LGPD art. 14) por uma **única** função `private.agenda_validate_patient`, que as funções da agenda
  também usam; colunas novas zeradas (`channel 'imed_app'`, `uses_resources false`, `version 1`, prazos e motivos nulos).
  A partir da 3.3, `slot_start` não nulo no caminho antigo é recusado com 23P01 e a mensagem de hoje
  ("Este horário não está mais livre. Escolha outro.").
- `appointment_requests_touch` (BEFORE UPDATE): `updated_at = now()`, `version = old.version + 1`.
- `appointment_requests_guard` (BEFORE UPDATE OF status, slot_start, slot_end, clinic_id): sem a marca, recusa (42501).
  Saída de emergência: `set local imed.origin = 'sql'` + motivo; fica registrada.
- `appointment_requests_hist` (AFTER UPDATE OF status): linha em `status_history` com a origem da marca.
- `appointment_requests_items_ck` (CONSTRAINT TRIGGER, DEFERRABLE INITIALLY DEFERRED): situação ativa com `uses_resources`
  exige itens coerentes (I2); em clínica com `agenda_mode <> 'pedido'`, situação ativa com `slot_start` exige `uses_resources`.

Policies:
- "clinica ve pedidos para ela" passa a `has_clinic_perm(clinic_id, 'pedidos.ver') and status not in ('hold','expired')`.
- "admin le pedidos" ganha o mesmo filtro de situação. "paciente ve seus pedidos" continua (é o dado do próprio paciente).
- "qualquer pessoa pede agendamento" passa a `consent and status = 'pending'` na 3.3.
- Na 4.2 (painel novo no ar), a leitura direta da clínica pela REST fecha: o painel lê só por funções, com `access_log` (R2-13).
- `appointment_requests_slot_uq` sai na 3.3, junto com a recusa do horário no caminho antigo.

`set_request_status`, `cancel_request` e `request_status` viram fachadas das funções novas, com a mesma assinatura (§5).

### 2.4 O que acontece com a agenda antiga (sem configuração implícita)

- **Dados:** hoje há 0 faixas, 0 bloqueios e 0 pedidos com horário. A migração 3.2 confere as contagens e **para** se
  encontrar algo (alguém configurou nesse meio-tempo): aí um humano decide a conversão. Nada é convertido "no escuro".
- **Editor simples (`set_my_schedule`)**: a partir da 3.2 responde `managed_by_agenda` e não grava. Na 4.1 a tela antiga sai
  e entram os cadastros novos, com uma "configuração rápida" (para cada exame: quantos aparelhos ou salas, quanto dura,
  horários) que cria recursos e procedimentos de verdade. Motivo: a configuração implícita (um recurso inventado por exame
  ou por faixa) vendia ao mesmo tempo exames feitos no mesmo aparelho, errava a duração quando as faixas tinham passos
  diferentes e convivia mal com os recursos reais (R1-A4, R1-M7, R2-7, R2-9). Nenhuma clínica usa o editor hoje.
- **Bloqueios antigos (`add_my_block`, `remove_my_block`)**: mesma assinatura; viram bloqueio de unidade no modelo novo.
  Se houver agendamento ativo no intervalo, `add_my_block` responde `has_appointments` e não grava (o painel novo mostra a
  lista e oferece "bloquear mesmo assim"). `remove_my_block` faz remoção lógica e libera o fechamento.
- **Paciente (`clinics_with_schedule`, `available_slots`)**: mesmas assinaturas e permissões, por dentro no motor novo.
  `clinics_with_schedule` só devolve clínicas com venda online liberada (`agenda_online_since`), publicadas, aceitando pedidos
  e sem `is_demo` — nenhuma até a 5.1. `available_slots` traduz `p_exam` para os procedimentos da categoria com venda online
  (o `default_for_exam`, ou a união), até 31 dias e 2000 linhas.
- **INSERT direto com `slot_start`** (o `local.js` atual): **sem ponte**. Como nenhuma clínica vende online antes da 5.1, o
  site antigo nunca oferece horário; um cliente velho que tente recebe 23P01 com a mensagem de sempre. O pedido sem horário
  (concierge e parceiros no modelo de pedido) continua idêntico.
- **Ordem de publicação:** banco sempre antes do site; toda migração compatível com o JS no ar. O site novo usa o padrão já
  existente (42703/PGRST202) para funcionar com o banco antigo durante a troca.

### 2.5 Tabelas novas (SQL de referência)

```sql
create extension if not exists btree_gist with schema extensions;   -- "=" em uuid/int no índice GiST

-- ===== Fase 3.1 =====
create table agenda.unit_settings (                 -- 1:1 com clinics; criada ao ativar a agenda
  clinic_id uuid primary key references public.clinics on delete cascade,
  step_min smallint not null default 5 check (step_min in (5,10,15,20,30,60)),
  min_notice_min integer not null default 120 check (min_notice_min between 0 and 10080),
  max_advance_days smallint not null default 90 check (max_advance_days between 1 and 365),
  holidays_checked_until date,                       -- até quando a clínica conferiu feriados estaduais/municipais
  hold_minutes smallint not null default 10 check (hold_minutes between 3 and 30),       -- pagamento/integração
  payment_grace_min smallint not null default 5 check (payment_grace_min between 0 and 15),
  patient_cancel_until_min integer not null default 0 check (patient_cancel_until_min between 0 and 10080),
  patient_reschedule_until_min integer not null default 120 check (patient_reschedule_until_min between 0 and 10080),
  checkin_before_min smallint not null default 120 check (checkin_before_min between 0 and 1440),
  no_show_after_min smallint not null default 15 check (no_show_after_min between 0 and 240),
  patient_gap_min smallint not null default 0 check (patient_gap_min between 0 and 240 and patient_gap_min % 5 = 0),
  closes_on_holidays boolean not null default true,
  manual_commitment_at timestamptz, manual_commitment_by uuid,   -- modalidade manual: "registro tudo no painel antes"
  payment_mode text not null default 'no_local' check (payment_mode in ('no_local')),  -- 'online_*' só na 5.4
  updated_at timestamptz not null default now(), updated_by uuid);

create table agenda.resources (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics on delete cascade,
  kind text not null check (kind in ('equipamento','sala','profissional','chegadas')),
  name text not null check (char_length(name) between 2 and 80),
  capacity smallint not null default 1 check (capacity between 1 and 50),        -- vagas simultâneas
  setup_min smallint not null default 0 check (setup_min between 0 and 240 and setup_min % 5 = 0),      -- preparo
  cleanup_min smallint not null default 0 check (cleanup_min between 0 and 240 and cleanup_min % 5 = 0), -- higienização
  member_user_id uuid references auth.users on delete set null,   -- profissional que vê a própria agenda
  council text check (council in ('CRM','CRBM','CRF','CRBio','CRO','COREN','CRTR','outro')),
  council_number text check (char_length(council_number) <= 20), -- só se a clínica informar
  active boolean not null default true, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  unique (id, clinic_id));                                         -- FKs compostas = mesma clínica
create unique index on agenda.resources (clinic_id, lower(name)) where archived_at is null;
-- Gatilho resources_guard: reduzir capacity, desativar ou arquivar só sem usos futuros ativos que deixem de caber
-- (senão a função devolve a lista ou abre conflito 'capacidade'). Redução temporária = bloqueio, nunca edição.
-- (authority e integration_id entram na fase 6.1)

create table agenda.procedures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics on delete cascade,
  exam_code text not null check (exam_code in ('rx','usg','tc','rm','mamo','dens','ecg','eco','lab')),
  name text not null check (char_length(name) between 2 and 120),            -- "Ultrassonografia de tireoide"
  duration_min smallint not null check (duration_min between 5 and 480 and duration_min % 5 = 0), -- sem valor padrão
  step_min smallint check (step_min is null or (step_min between 5 and 120 and step_min % 5 = 0)),
  price_cents integer check (price_cents is null or price_cents between 100 and 10000000),        -- nulo = sob consulta
  price_confirmed_at timestamptz,                                              -- trava L11 (preço fora do normal)
  patient_prep_text text check (char_length(patient_prep_text) <= 600),
  fasting_hours smallint check (fasting_hours between 0 and 24),
  min_notice_min integer, max_advance_days smallint,                           -- sobrepõem a unidade
  online_booking boolean not null default true,
  default_for_exam boolean not null default false,                             -- usado por available_slots(p_exam)
  active boolean not null default true, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  unique (id, clinic_id));
create unique index on agenda.procedures (clinic_id, lower(name)) where archived_at is null;
create unique index on agenda.procedures (clinic_id, exam_code) where default_for_exam and archived_at is null;

create table agenda.procedure_requirements (       -- "precisa de 1 aparelho de USG" (grupo)…
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null, clinic_id uuid not null,
  group_no smallint not null check (group_no between 1 and 5),
  resource_kind text not null check (resource_kind in ('equipamento','sala','profissional','chegadas')),
  offset_min smallint not null default 0 check (offset_min >= 0 and offset_min % 5 = 0),
  duration_min smallint check (duration_min is null or (duration_min between 5 and 480 and duration_min % 5 = 0)),
  align_min smallint check (align_min is null or align_min in (5,10,15,20,30,60)),  -- "chegadas": bloco alinhado
  label text check (char_length(label) <= 60),
  foreign key (procedure_id, clinic_id) references agenda.procedures (id, clinic_id) on delete cascade,
  unique (procedure_id, group_no), unique (id, clinic_id));
create table agenda.requirement_options (          -- …"USG-1 ou USG-2" (alternativas)
  requirement_id uuid not null, clinic_id uuid not null, resource_id uuid not null,
  priority smallint not null default 1,
  primary key (requirement_id, resource_id),
  foreign key (requirement_id, clinic_id) references agenda.procedure_requirements (id, clinic_id) on delete cascade,
  foreign key (resource_id, clinic_id) references agenda.resources (id, clinic_id) on delete cascade);
-- Gatilho: um recurso não aparece em dois grupos do mesmo procedimento (grupos disjuntos ⇒ conferência exata por grupo).

create table agenda.procedure_pair_rules (         -- regras de pacote, sempre configuradas pela clínica
  clinic_id uuid not null, first_procedure uuid not null, second_procedure uuid not null,
  rule text not null check (rule in ('ordem','intervalo_min','nao_mesmo_dia')),
  min_gap_min smallint check (min_gap_min is null or min_gap_min % 5 = 0),
  primary key (first_procedure, second_procedure, rule),
  foreign key (first_procedure, clinic_id) references agenda.procedures (id, clinic_id) on delete cascade,
  foreign key (second_procedure, clinic_id) references agenda.procedures (id, clinic_id) on delete cascade);

create table agenda.appointment_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.appointment_requests on delete cascade,
  clinic_id uuid not null references public.clinics,
  seq smallint not null check (seq between 1 and 4),
  procedure_id uuid not null, exam_code text not null,
  starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at),
  local_start timestamp not null, tz text not null,     -- hora local pretendida (detecta mudança de regra de fuso)
  groups smallint[] not null,                           -- grupos exigidos na marcação: o I2 confere contra isto
  status text not null check (status in ('hold','awaiting_payment','confirmed','checked_in','in_service',
                                         'completed','no_show','reschedule_requested','cancelled','expired')),
  price_cents integer,                                  -- foto do preço na marcação (receita estimada)
  version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (procedure_id, clinic_id) references agenda.procedures (id, clinic_id),
  constraint items_seq_uq unique (request_id, seq) deferrable initially deferred,
  constraint items_patient_no_overlap exclude using gist          -- o paciente não está em 2 exames ao mesmo tempo
    (request_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('hold','awaiting_payment','confirmed','checked_in','in_service','reschedule_requested'))
    deferrable initially deferred);
create index on agenda.appointment_items (clinic_id, starts_at);
create index on agenda.appointment_items (request_id);

create table agenda.busy_marks (                   -- "ocupado (agenda própria)", sem dado pessoal
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics on delete cascade,
  procedure_id uuid,                                -- opcional: ocupa os recursos do procedimento
  starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at),
  reason_code text not null check (reason_code in ('agenda_propria','uso_interno','outro')),
  created_by uuid not null, created_at timestamptz not null default now(),
  removed_at timestamptz, removed_by uuid);

create table agenda.occupancy (                    -- O ÚNICO lugar que diz "este recurso está ocupado"
  id bigint generated always as identity primary key,
  clinic_id uuid not null,
  resource_id uuid not null,
  kind text not null check (kind in ('agendamento','ocupado','bloqueio')),  -- uso, uso sem paciente, fechamento
  seats int4range not null,                         -- uso: uma vaga [s,s+1); fechamento: todas [1,51)
  during tstzrange not null check (not isempty(during) and lower_inc(during) and not upper_inc(during)
                                   and not lower_inf(during) and not upper_inf(during)),
  excl_group int8range not null default '(,)',      -- gatilho: [id,id] para fechamento
  item_id uuid references agenda.appointment_items on delete cascade, group_no smallint,
  busy_id uuid references agenda.busy_marks on delete cascade,
  block_id uuid references public.clinic_blocks on delete cascade,
  hold_until timestamptz,                           -- cópia de hold_expires_at + carência; nula depois de confirmar
  active boolean not null default true,
  released_at timestamptz,
  release_reason text check (release_reason in ('cancelado','expirada','remarcado','bloqueio_forcado',
                                                'removido','capacidade','corrigido')),
  created_at timestamptz not null default now(),
  foreign key (resource_id, clinic_id) references agenda.resources (id, clinic_id) on delete restrict,
  check ((kind = 'agendamento') = (item_id is not null) and (kind = 'agendamento') = (group_no is not null)),
  check ((kind = 'ocupado') = (busy_id is not null)),           -- fase 6.1: "ou external_ref_id"
  check ((kind = 'bloqueio') = (block_id is not null)),
  -- vaga vazia ou sem limite daria NULL no CASE (e CHECK com NULL passa): recusadas fora dele (revisão da 3.1)
  check (not isempty(seats) and not lower_inf(seats) and not upper_inf(seats) and case when kind = 'bloqueio'
              then seats = int4range(1, 51) and excl_group = int8range(id, id, '[]')
              else upper(seats) - lower(seats) = 1 and lower(seats) >= 1 and upper(seats) <= 51
                   and excl_group = '(,)'::int8range end),
  check (hold_until is null or kind = 'agendamento'),
  check (active or released_at is not null),
  constraint occupancy_no_overlap exclude using gist                    -- imediata, nunca adiável
    (resource_id with =, seats with &&, during with &&, excl_group with &&) where (active));
create index on agenda.occupancy (item_id);
create index on agenda.occupancy (block_id) where block_id is not null;
create index on agenda.occupancy (busy_id) where busy_id is not null;
create index on agenda.occupancy (hold_until) where active and hold_until is not null;
-- BEFORE INSERT/UPDATE (occupancy_bi): define excl_group; para uso novo, recurso ativo; lê a capacidade com
--   "select capacity from agenda.resources … for share" e exige upper(seats) - 1 <= capacity (NULL = recusa).
-- create unique index … (item_id, group_no) where active and kind = 'agendamento' (no máximo um uso por grupo, na hora).
-- Guardas da agenda ENABLE ALWAYS (valem também com session_replication_role = replica; revisão da 3.1).
-- CONSTRAINT TRIGGER adiado (AFTER UPDATE OF active, DELETE): o item dono continua com o conjunto completo (I2).
-- Regra de código (teste de catálogo): nenhuma função usa INSERT … ON CONFLICT nesta tabela.
```

Por que `seats` e `excl_group` (conferido no §3.4): uso × uso na mesma vaga conflita; uso × fechamento sempre conflita
(o fechamento cobre todas as vagas, inclusive as que surgirem se a capacidade aumentar); fechamento × fechamento não
conflita (manutenção e feriado podem se cruzar). O `excl_group` de um fechamento é o próprio id; o de um uso é o intervalo
infinito, que cruza com tudo.

Demais tabelas da 3.1 (colunas principais):
- `agenda.holidays(id, scope in ('nacional','uf','municipio'), uf, city_ibge, day, name, source not null, created_by, created_at)`,
  `unique nulls not distinct (scope, uf, city_ibge, day)`. Lançados pela equipe do IMED a partir de lei, decreto ou
  portaria (fonte obrigatória). A clínica confere os estaduais e municipais da sua cidade (`holidays_checked_until`) e
  lança o que faltar como bloqueio `feriado` da unidade. `agenda.holiday_openings(clinic_id, day)` = "abrimos neste feriado".
- `agenda.status_history(id identity, request_id, item_id, from_status, to_status, at, actor_kind in ('paciente','clinica',
  'imed','sistema','integracao','gateway','sql'), actor_user, actor_role, origin in ('app','painel','central','api',
  'webhook_pagamento','cron','sql'), reason_code, request_version)` — sem texto livre.
- `agenda.audit_log(id identity, at, clinic_id, actor_kind, actor_user, actor_role, origin, action, object_type, object_id,
  old_value jsonb, new_value jsonb, reason_code, txid)` — valores sem dado pessoal nem texto livre (configuração, preços,
  equipe, bloqueios, chaves, conflitos).
- `agenda.access_log(id identity, day, first_at, last_at, user_id, clinic_id, fn, request_id, scope, reads, justification_code)`,
  único por `(day, user_id, clinic_id, fn, request_id, scope)`: a consulta periódica soma em `reads` em vez de multiplicar linhas.
  Na 4.2 (parte 1 da `agenda_leitura`) a chave ganha `justification_code`: a mesma leitura no mesmo dia com OUTRO motivo da
  equipe do IMED vira outra linha (antes o segundo motivo sumia dentro do primeiro); só os 4 motivos da decisão 4.2-f valem.
- `agenda.notes(id, clinic_id, request_id, kind in ('observacao','justificativa_acesso','motivo'), text ≤ 300, author_user,
  created_at, deleted_at)` — o único lugar com texto livre; apagável.
- `agenda.idempotency(scope, actor, key uuid, fingerprint, result jsonb, created_at, primary key (scope, actor, key))`;
  `fingerprint` = SHA-256 de parâmetros **sem** dado pessoal (clínica, procedimentos, horários). Apagada em 7 dias.
- `agenda.clinic_versions(clinic_id pk, version bigint, changed_at)`.
- `agenda.conflicts(id, clinic_id, kind in ('grade_mudou','capacidade','bloqueio_sobre_agendamento','fuso_mudou',
  'pagamento_apos_expirar','divergencia_externa','evento_externo_rejeitado','paciente_em_dois_horarios'), request_id,
  item_id, details jsonb sem dado pessoal, status in ('aberto','em_andamento','resolvido','descartado'), resolution_code,
  created_at, resolved_at, resolved_by)`; no máximo um conflito aberto por (tipo, item).
- `agenda.rate_counters(key, window_start, n, primary key (key, window_start))` — limites contra abuso por
  `upsert … returning n` (serializa no contador; sem "conta e depois insere").
- `agenda.role_permissions(role, permission)`, `agenda.status_transitions(from_status, to_status, actor_kind, permission,
  requires_reason, time_rule)`, `agenda.settings_global(key pk, value jsonb, updated_at, updated_by)`: referência.
- `private.imed_staff(user_id, role in ('operacao','suporte','financeiro','auditoria'), granted_by, granted_at, revoked_at,
  primary key (user_id, role))` — a equipe do IMED fica fora do `admin_emails`; o dono continua sendo `is_imed_admin()`.

Tabelas que nascem depois: `agenda.member_invites` (3.4); `agenda.notifications`, `agenda.notification_rules`,
`agenda.outbox` (5.3); `agenda.payments`, `agenda.payment_events` (5.4); `agenda.integrations`, `agenda.external_refs`,
`agenda.sync_events`, `agenda.snapshot_seq`, mais `resources.authority/integration_id` e `occupancy.external_ref_id` (6.1).

**Preço.** `clinic_exams.price_cents` continua sendo o índice por categoria que a busca usa. Com a agenda ativa, vira
"a partir de" = menor preço entre os procedimentos ativos da categoria, recalculado por gatilho depois de travar a linha de
`clinic_exams` (R1-B9); `set_my_clinic_exams` responde `managed_by_agenda` para essas categorias.

---

## 3. Concorrência e integridade

### 3.1 A regra fundamental em termos do banco
"Nenhum horário vendido ou reservado ao mesmo tempo para dois pacientes quando depender do mesmo recurso exclusivo" =
para todo recurso `r` e todo instante `t`, o número de usos ativos de `r` que cobrem `t` é no máximo `capacity(r)`
(1 para recurso exclusivo), nenhum uso cruza um fechamento ativo, e todo item vendido segura todos os seus recursos.

### 3.2 Mecanismos
1. **Restrição de exclusão** `occupancy_no_overlap` (§2.5): mecanismo nativo do banco, pedido no item 6.
2. **Vagas:** cada uso ocupa uma vaga de 1 a `capacity`. O alocador escolhe a menor vaga livre no intervalo. Pode haver
   recusa falsa rara com durações misturadas no mesmo recurso compartilhado; nunca há venda dobrada.
   O gatilho lê a capacidade com `FOR SHARE` (que conflita com o UPDATE de capacidade; a chave estrangeira sozinha usa
   `FOR KEY SHARE`, que não conflita — R1-A2).
3. **Itens seguram seus recursos (I2):** cada item guarda os grupos exigidos na marcação; gatilhos adiados conferem no COMMIT
   (em itens, na ocupação e no cabeçalho). Mudar situação, horário ou ocupação sem a marca `imed.origin` é recusado.
4. **Protocolo de travas** (igual em todas as funções; cada trava numa instrução própria, ANTES das leituras que dependem
   dela, porque em READ COMMITTED cada instrução da função enxerga o que já foi confirmado):
   1. `pg_advisory_xact_lock_shared(7101, hashtext(clinic_id::text))` — trava de configuração, compartilhada por toda escrita
      que **ocupa** recurso na clínica; **exclusiva** para mudar configuração (regras, recursos, capacidade, procedimentos,
      requisitos, fuso, modalidade, bloqueio de unidade, feriado da clínica). Quem configura espera quem está marcando e
      vice-versa.
   2. Linhas do(s) próprio(s) pedido(s) em `appointment_requests`: `FOR UPDATE`, em ordem de id.
   3. `pg_advisory_xact_lock(7102, hashtext(resource_id::text))` para cada recurso candidato, sem repetição, em ordem
      crescente da chave (forma de duas chaves: não colide com as travas de uma chave que a teleconsulta usa).
   4. Liberação preguiçosa de reservas vencidas nesses recursos: outros pedidos só com `FOR UPDATE SKIP LOCKED` e nova
      conferência do prazo (quem espera nunca segura nada que o outro queira).
   5. Planejar com o mapa materializado e gravar ocupação, itens, cabeçalho, histórico.
   6. `private.agenda_touch(clinic)` como **última** instrução, uma vez por clínica (em ordem de `clinic_id` se houver mais de uma).
   - Quem **aloca** (marcar, balcão, "só ocupar", remarcar, bloqueio de recurso, pagamento atrasado, "cancelado → anterior",
     evento externo que ocupa) segue os passos 1 a 6.
   - Quem **só libera ou muda a situação sem alocar** (cancelar, expirar, chegada, falta, concluir, confirmar reserva ainda
     segura) trava só o pedido e faz o touch; não pega trava de clínica nem de recurso.
   - Bloqueio de unidade e qualquer bloqueio "mesmo assim" usam a trava **exclusiva** da clínica e travam os pedidos
     afetados (em ordem de id) **antes** das travas de recurso.
   - O cron de manutenção não pega travas de agenda: só `SKIP LOCKED` nos pedidos e o touch no fim.
   - Feriado nacional novo: processado clínica a clínica (procedimento com COMMIT por clínica, trava exclusiva e revalidação).
5. **Revalidação de configuração (A3):** regras de horário, pausas, feriados, preparo, higienização e durações não viram
   ocupação; quem muda configuração pega a trava exclusiva, aplica e, na mesma transação, revalida os itens ativos futuros
   com o mesmo motor. Cada item que deixou de caber vira conflito `grade_mudou` (ou `capacidade`); a tela mostra a lista
   **antes** de salvar e pede confirmação. Bloqueios de unidade e de recurso viram fechamento na ocupação (protegidos pelo
   EXCLUDE); recurso novo herda os bloqueios futuros da unidade na mesma transação. Revalidação diária completa pelo cron.
6. **Reserva vencida:** o EXCLUDE não usa `now()`, então a reserva vencida continua ativa até ser liberada.
   Leitura: o mapa de livres ignora `hold_until <= now()`. Escrita: liberação preguiçosa (passo 4) + cron
   `imed-agenda-manutencao` a cada 30 s (`call private.agenda_manutencao()`, lotes de 50 com COMMIT entre eles, um único
   comando para o COMMIT funcionar). O prazo tem fonte única (`hold_expires_at`); `hold_until` é cópia mantida pela função de
   transição; liberar é sempre a partir do pedido travado. Reserva de recurso externo nunca é liberada por tempo (§8).
7. **Idempotência:** o id do agendamento é gerado uma vez por intenção no aparelho e guardado antes do envio, com o código;
   o reenvio com o mesmo id, código e impressão digital devolve a situação atual (`replay`); com parâmetros diferentes,
   `idempotency_conflict`. Depois de `slot_taken` ou de trocar de horário, o app gera id novo (B11). Cancelar, remarcar,
   marcar no balcão e a API externa usam `agenda.idempotency` (`insert … on conflict do nothing`; a segunda chamada espera a
   primeira e lê o resultado). Pagamento: `unique (provider, provider_event_id)`.
8. **Versão para tempo real:** `agenda_touch` faz `insert … on conflict do update set version = version + 1` na linha da
   clínica; a trava curta da linha garante que a ordem das versões é a ordem dos COMMITs. Correção da proposta (R2-26):
   isso serializa o finzinho (touch → COMMIT, cerca de 1 ms) de todas as escritas da mesma clínica; não há trava global.
9. **Sub-transações (R1-M3):** um único bloco BEGIN … EXCEPTION por chamada (converte 23P01 em `slot_taken` amigável);
   `realtime.send` uma vez por clínica por transação; lotes conferem antes em vez de usar exceção como controle de fluxo.
10. **Limites contra abuso** (valores em `settings_global`, decisão 25): por hash de IP (IPv6 agrupado por /64, sal diário):
    agendamentos e reservas por hora; por telefone (HMAC): até 3 agendamentos futuros na mesma clínica; por clínica: pico
    acima do normal pede Turnstile (quando existir) e alerta a clínica — nunca recusa todo mundo. O cabeçalho de IP confiável
    é conferido no CI com um `x-forwarded-for` forjado antes de valer.

### 3.3 Prova de que a regra vale sob concorrência
- **I1 (banco, sempre).** Para todo recurso `r`: (a) dois usos ativos na mesma vaga nunca se cruzam no tempo; (b) nenhum uso
  ativo cruza um fechamento ativo; (c) todo uso ativo tem vaga ≤ capacidade. Logo, num instante `t`, os usos que cobrem `t`
  têm vagas distintas em [1, capacidade]: no máximo `capacidade` (casa dos pombos).
  - (a) e (b) são a restrição de exclusão. O Postgres a verifica **no índice**, não no retrato da transação: ao gravar uma
    linha ativa (ou reativar uma), procura toda linha conflitante, inclusive de transação ainda aberta; se a outra está aberta,
    espera o fim dela e decide (erro se ela confirmou, segue se desfez). Vale para qualquer caminho de escrita, qualquer
    isolamento e qualquer número de conexões, porque é propriedade da tabela. Reativar é UPDATE, conferido de novo.
  - (c) é o gatilho com `FOR SHARE` na linha do recurso + a guarda de redução de capacidade: ou a redução espera a marcação e
    então vê o uso na vaga alta (recusa), ou a marcação espera a redução e então lê a capacidade nova (recusa).
- **I2 (no COMMIT).** Item em `hold`, `awaiting_payment`, `confirmed`, `checked_in` ou `in_service` tem exatamente uma linha
  de uso ativa por grupo gravado na marcação; `reschedule_requested` tem todas ou nenhuma; demais situações, nenhuma.
  Itens e ocupação nascem na mesma transação e os gatilhos adiados derrubam o COMMIT se faltar algo (inclusive um
  `ON CONFLICT DO NOTHING` que tenha pulado uma linha em silêncio).
- **I1 + I2 ⇒ regra fundamental:** dois itens ativos que dependem do mesmo recurso exclusivo nunca se sobrepõem; com
  capacidade k, no máximo k ao mesmo tempo; `items_patient_no_overlap` impede o mesmo paciente em dois exames do pedido.
- **I3 (tudo ou nada).** Marcar (até 4 itens), remarcar, cancelar, bloquear e confirmar pagamento atrasado são uma transação.
- **I4 (remarcação sem janela).** Desativar o antigo e gravar o novo acontecem na mesma transação; quem tenta o horário antigo
  encontra a versão antiga da linha no índice e espera o COMMIT; se a remarcação desfaz, o antigo continua valendo.
- **I5 (confirmar × expirar).** As duas travam primeiro o pedido; quem chega depois relê a linha nova e a condição
  `hold_until <= now()` deixa de valer depois da confirmação; se a expiração ganhou, a confirmação passa pelo motor completo.
- **I6 (configuração).** Regras são lidas sob a trava compartilhada da clínica e mudadas sob a exclusiva: nenhuma marcação fica
  entre "leu a regra velha" e "confirmou"; tudo o que já existia e foi afetado sai na lista de conflitos da própria mudança.
- **I7 (sem tempestade de impasses).** Quem escreve no mesmo recurso fica em fila na trava do recurso antes de planejar; travas
  em ordem crescente não formam ciclo; travas de linha seguem a ordem global; quem pega linha alheia usa SKIP LOCKED.

**O que o EXCLUDE sozinho não cobre e onde foi coberto:** agendamento sem linha de ocupação (I2 + guarda de origem);
capacidade e usos empilhados (vagas + FOR SHARE); regras e feriados (I6); dois recursos para o mesmo aparelho (sem
configuração implícita); paciente que já existe no sistema externo (autoridade por recurso, §8); fuso mostrado errado (§4).

### 3.4 Verificação prática (31/10/2026, PostgreSQL 16.15 descartável, `btree_gist` 1.7, `deadlock_timeout` 1 s, 4 CPUs)

Tabela igual à do §2.5 (sem as chaves estrangeiras), conferida nestes casos:

| Caso | Resultado |
|---|---|
| Uso 10:00–10:45 e outro 10:30–11:00 na mesma vaga (inícios diferentes) | segundo recusado (23P01) |
| Uso encostado 10:45–11:15 | aceito |
| Dois bloqueios que se cruzam | aceitos |
| Uso dentro de um bloqueio | recusado |
| Sala de capacidade 2: "ocupado" na vaga 1, outro na vaga 1, agendamento na vaga 2 | 1º e 3º aceitos, 2º recusado |
| Bloqueio sobre a sala com usos | recusado |
| Bloqueio com `excl_group` errado; uso com 2 vagas | recusados pelo CHECK |
| Bloqueio com id gerado (o gatilho preenche `excl_group`) | aceito; o CHECK com a coluna de identidade funciona |
| Reativar um bloqueio por cima de um uso | recusado |

Concorrência (barreira: todos esperam uma trava e partem juntos; mesmo aparelho; inícios 10:00/10:05/10:10, 45 min):

| Modo | Rodadas | Resultado |
|---|---|---|
| Só o EXCLUDE (sem trava por recurso) | 9 (40, 60 e 100 ao mesmo tempo) | integridade sempre: 1 linha ativa, 0 pares sobrepostos. Em 7 rodadas os perdedores receberam 23P01 (tempo máximo de 1,7 a 5,7 s, contando a espera na barreira e a abertura dos processos); **em 2 rodadas houve cadeia de impasses: todos os perdedores com 40P01, o último depois de 47 s (60 pedidos) e de 87 s (100 pedidos)** |
| EXCLUDE + trava por recurso (instrução separada, antes de conferir e gravar) | 6 (40 e 100 ao mesmo tempo) | sempre 1 vencedor, 0 erros, 0 impasses; perdedores recebem "sem horário" sem erro; tempo máximo de 1,9 a 4,2 s, contando a mesma espera na barreira e a abertura dos processos |
| Remarcação (desativa o antigo + grava o novo, segura 2 s) | 2 | quem tentou o horário antigo esperou ~1,5 s e entrou depois do COMMIT; com ROLLBACK, recebeu 23P01 e o antigo continuou ativo |
| Capacidade 2 com trava, 60 pedidos de 15 min com inícios variados | 1 | 3 gravados, máximo de 2 ao mesmo tempo |

Conclusão: o EXCLUDE garante a regra em qualquer situação; a trava por recurso é o que garante tempo de resposta (sem ela,
os perdedores estourariam os 3 s do anon com 57014 e prenderiam conexões do PostgREST). O CI repete tudo no PostgreSQL 17
com o PostgREST de verdade (§13).

### 3.5 Corridas e resultados

| Corrida | Resultado |
|---|---|
| Duas marcações no mesmo aparelho e intervalo (inícios iguais ou diferentes, 30 × 45 min) | 1 confirmada, o resto `slot_taken` com alternativas (teste 1) |
| App × balcão | quem pega a trava primeiro ganha; o outro recebe `slot_taken` (teste 2) |
| Bloqueio de manutenção × marcação | um dos dois espera o outro; o bloqueio devolve a lista; com "bloquear mesmo assim", os pacientes vão para remarcação com conflito aberto (teste 5) |
| Mudança de grade × marcação | a marcação ou entra antes (e aparece na lista de afetados) ou vê a grade nova (I6) |
| Reserva vencida × nova marcação × pagamento atrasado | trava do pedido e liberação condicional; nunca duas pessoas (testes 4 e 8) |
| Remarcação × alguém pegando o horário antigo | o antigo só fica livre no COMMIT (I4) |
| Pacote × marcação avulsa no recurso do meio | um ganha por inteiro, o outro não grava nada (teste 6) |
| Evento externo × marcação do app | decide a autoridade do recurso (§8; teste 10) |
| Reenvio por falha de rede | mesmo id e código: `replay`, sem duplicar |
| Redução de capacidade × marcação na vaga alta | um espera o outro e o segundo é recusado (I1-c) |

### 3.6 Desempenho
- Sem trava global; a fila só se forma entre escritas no mesmo recurso (milissegundos cada) e no touch da mesma clínica.
- 300 chamadas ao mesmo tempo: o pool do PostgREST enfileira; o reenvio com a mesma chave é seguro.
- Metas medidas no CI: `agenda_book` p95 < 300 ms sem disputa; 0 impasses e 0 estouros de tempo no teste 1.

---

## 4. Cálculo de disponibilidade (no banco, fonte única)

Duas funções internas servem tanto para mostrar horários quanto para marcar:

```sql
private.agenda_free_map(p_clinic uuid, p_resources uuid[], p_from timestamptz, p_to timestamptz, p_now timestamptz)
  returns table (resource_id uuid, seat smallint, free tstzmultirange)
--  aberto   = janelas 'abre' da unidade ∩ janelas 'abre' do recurso (sem escala própria = as da unidade),
--             cada janela convertida dia a dia com ((dia + hora_local) at time zone clinics.timezone)
--  fechado  = pausas da unidade e do recurso ∪ feriados (nacional, da UF e do município, se closes_on_holidays
--             e sem holiday_openings) ∪ fechamentos ativos do recurso (bloqueios de unidade e de recurso)
--  ocupado  = range_agg(during) dos usos ativos da vaga, ignorando hold_until <= p_now
--  livre    = aberto − fechado − ocupado   (operações de multirange do PG 14+), calculado UMA vez (materializado)

private.agenda_free_starts(p_clinic uuid, p_procedure uuid, p_from date, p_to date, p_now timestamptz)
  returns table (slot_start timestamptz, slot_end timestamptz)
--  candidatos: generate_series(início da janela, fim − duração, passo) em cada janela aberta da unidade
--  t vale se:
--   · t >= p_now + antecedência mínima e t < p_now + antecedência máxima (procedimento ou unidade), e o dia de t
--     não passa de holidays_checked_until nem do último ano de feriados nacionais lançados
--     (liberar a venda online exige essa conferência de feriados);
--   · [t, t+duração) cabe no aberto da unidade (sem pausas, feriados e bloqueios de unidade);
--   · para CADA grupo de requisito existe ALGUM recurso permitido (ativo) e ALGUMA vaga com
--     free @> [t + offset − preparo, t + offset + duração do grupo + higienização)
--     (grupo "chegadas" com align_min: o bloco alinhado [piso(t, align), piso(t, align) + align));
--   · grupos disjuntos (regra de cadastro) ⇒ a conferência por grupo é exata.
```
Preparo e higienização precisam caber no horário do recurso (para atender às 08:00 com 10 min de preparo, o recurso abre 07:50).

**Funções públicas (sem dado pessoal; anon):**
- `agenda_public_info(p_clinic)`: fuso, modalidade com texto honesto, procedimentos (nome, duração, preço ou "sob consulta",
  preparo), forma de pagamento, regras de cancelamento e remarcação.
- `agenda_slots(p_clinic, p_procedure, p_from date, p_to date)` até 62 dias; `agenda_days(...)` com `(day, livres, primeiro)`
  para o calendário do mês (resolve o limite de 300 linhas).
- `agenda_next_free(p_clinics uuid[≤10], p_exam, p_days 14)`: "próximo horário livre" nos cartões da busca; para no primeiro
  horário de cada clínica, dia a dia. Cache (fora da transação de escrita) só se o p95 do CI passar de 300 ms.
- Fachadas `available_slots` e `clinics_with_schedule` (§2.4).
- Limites: tamanho da pergunta (dias, número de clínicas, procedimento obrigatório onde for caro) e `set statement_timeout`
  na própria função (a documentação do Supabase confirma que vale para chamadas pela API).
- Clínica fictícia (`is_demo`) nunca tem horário.

**Os 15 itens de regra do pedido:** 1 início e 2 fim (janelas `abre`); 3 almoço e 4 pausas (`pausa`, unidade ou recurso);
5 dias da semana; 6 feriados; 7 bloqueios extraordinários; 8 preparo do equipamento (`setup_min`); 9 higienização
(`cleanup_min`); 10 tempo entre exames (8 + 9 + `patient_gap_min` + regras de par); 11 e 12 antecedência mínima e máxima
(unidade e procedimento); 13 limite de pacientes por horário (recurso "chegadas" com bloco alinhado, R1-M8); 14 capacidade
simultânea (vagas); 15 duração por procedimento (múltipla de 5). Granularidade de 5 min (`step_min`); ocupação por recurso
com `offset_min`/`duration_min` do requisito.

**Fuso e horário de verão**
- Instantes em UTC; regras na hora local da unidade, convertidas dia a dia pela regra do tzdata daquele dia.
- Hora inexistente (início do horário de verão) não gera horário; hora repetida (fim) não gera duplicata, porque os inícios
  são instantes em série crescente. Nesses dias a tela mostra o deslocamento junto da hora (R1-M4d).
- O item guarda a hora local pretendida e o fuso (`local_start`, `tz`); a revalidação diária abre `fuso_mudou` se uma regra
  nova de fuso (por exemplo, a volta do horário de verão) mudar a hora local de um agendamento futuro (R1-M4c).
- Telas e avisos sempre no fuso da unidade, escrito quando diferente do de quem lê ("09:00, horário de Cuiabá").
  O `.ics` passa a usar instantes UTC com a duração real.
- Transição (R1-M4a, R2-8): ninguém vende online antes da 5.1, que é quando o app mostra o fuso da unidade; o painel já nasce
  no fuso da unidade (4.x). Por cautela, o piloto começa com clínicas em UTC−3.
- Teste com datas reais de America/Sao_Paulo (04/11/2018 e 16/02/2019) e com Manaus (UTC−4).

**Desempenho medido pela revisão 1 (SELECT sintético no banco):** 14 dias, 9 recursos-vaga, 3.186 ocupações, 15.876 testes
`@>`: 26 ms com o mapa materializado; 3.500 ms com o mapa refeito por candidato. Por isso o mapa é sempre materializado
(CTE MATERIALIZED, arrays ou tabela temporária) e há teste de tempo no CI (meta: `agenda_slots` de 14 dias < 150 ms p95).

---

## 5. Máquina de estados

Situações (com o rótulo do site): `pending` Aguardando contato · `contacted` Em contato · `hold` Reservado temporariamente ·
`awaiting_payment` Aguardando pagamento · `confirmed` Confirmado · `checked_in` Paciente presente · `in_service` Em
atendimento · `completed` Exame concluído · `no_show` Não compareceu · `reschedule_requested` Remarcação solicitada ·
`cancelled` Cancelado · `expired` Reserva expirada.

`private.agenda_transition(p_request, p_item, p_to, p_actor, p_reason, p_version)`, nesta ordem: trava o pedido; confere a
versão (`version_conflict`), a tabela `agenda.status_transitions` (ator, permissão, regra de horário, motivo); libera ou
recupera a ocupação **pelo motor completo**; grava `status_history`; agenda avisos (5.3+); `agenda_touch`. Itens têm situação
própria; o cabeçalho é a soma (`private.agenda_rollup`): concluído quando todos estão concluídos, cancelados ou faltaram e
pelo menos um foi concluído.

| De → para | Quem (permissão) | Regra |
|---|---|---|
| novo → `pending` | paciente (site) | pedido sem horário, igual a hoje |
| novo → `confirmed` | paciente (`agenda_book`, sem pagamento online); recepção (`agenda_desk_book`, `agenda.marcar`); equipe IMED | horário livre no motor, dados, consentimento e limites |
| novo → `hold` | integração 2a (aguardando o sistema da clínica); paciente quando houver pagamento online | prazo `hold_minutes` |
| `hold` → `awaiting_payment` | paciente | pagamento online ligado |
| `hold` → `confirmed` | integração (confirmação do sistema externo) | antes do prazo |
| `awaiting_payment` → `confirmed` | gateway | pagamento aprovado e valor conferido |
| `hold`/`awaiting_payment` → `expired` | sistema | prazo + carência vencidos e nenhum pagamento "processando"; recurso externo nunca por tempo (§8) |
| `hold`/`awaiting_payment` → `cancelled` | paciente (desistir) ou clínica | motivo em código |
| `expired` → `confirmed` | sistema (pagamento atrasado) | motor completo; horário ainda livre e o paciente sem outro agendamento no mesmo horário; senão conflito `pagamento_apos_expirar` |
| `pending` ↔ `contacted`; ambos → `confirmed`/`cancelled` | clínica, IMED | como hoje; em clínica com agenda, confirmar com horário passa pelo alocador |
| `confirmed` → `checked_in` | recepção/profissional (`agenda.atender`) | a partir de `checkin_before_min` antes do início |
| `checked_in` → `in_service` → `completed` | recepção/profissional | — |
| `confirmed` → `completed` | recepção (fluxo simples) | só depois do início (`too_early`); decisão 23 |
| `confirmed` → `no_show` | recepção | só depois do início + `no_show_after_min` |
| `no_show` → `checked_in` | recepção | mesmo dia, motivo obrigatório |
| `confirmed` → `reschedule_requested` | paciente ou clínica | mantém o horário até remarcar |
| `confirmed` → `reschedule_requested` (sem horário) | sistema (bloqueio forçado) | ocupação liberada + conflito aberto |
| `reschedule_requested` → `confirmed` | quem remarca (`agenda_reschedule`) ou "desistir da remarcação" | se o horário foi liberado, desistir passa pelo motor |
| `confirmed`/`reschedule_requested`/`checked_in` → `cancelled` | paciente (antes do início e de `patient_cancel_until_min`; senão `too_late`); clínica e IMED (motivo obrigatório) | libera os recursos |
| `cancelled` → situação anterior | só IMED | motor completo; senão `slot_taken` |
| `completed`/`no_show` → correção | só IMED | motivo obrigatório |

**Compatibilidade.** `set_request_status(p_id, p_status)` passa pela tabela de transições e mantém `ok`, `forbidden`,
`not_found`, `invalid_status`, `cancelled_by_patient` e `slot_taken`; ganha `transition_not_allowed`, `too_early`,
`reason_required` e `version_conflict`. `cancel_request` mantém `ok`, `already_cancelled`, `not_cancellable` e `past`; ganha
`too_late`. `request_status` mantém a assinatura (o detalhe novo vem de `agenda_my_booking(p_id, p_token)`). `submit_review`
continua exigindo `completed`. `admin_gestao` e `admin_stats` ignoram `hold` e `expired` nos totais e ganham baldes para as
situações novas (com o `visitas.test.mjs` atualizado junto). Os rótulos novos do paciente (`geo-core.js`, `conta.js`) sobem
na 4.2, antes de o painel criar essas situações (R2-16).

**Auditoria.** Toda mudança grava: id, situação anterior e nova, data e hora, quem (usuário, papel ou integração), origem e
motivo (código). Mudança pelo editor SQL só passa com `imed.origin = 'sql'` explícito e fica registrada.

---

## 6. Remarcação atômica e pacote de exames

**`agenda_reschedule(p_id, p_token null, p_items jsonb, p_key uuid, p_version int null)`**, tudo numa transação:
1. trava de configuração (compartilhada), trava do pedido e conferência da versão (`version_conflict`);
2. regra de prazo do paciente (`too_late`);
3. travas dos recursos antigos e novos (juntos, em ordem crescente);
4. desativa a ocupação antiga; planeja e grava a nova, preferindo os mesmos recursos;
5. atualiza itens e cabeçalho (`slot_start`, `slot_end`, `preferred_date`); `status_history` (`remarcado`) e `audit_log`
   (horários antigos e novos, sem dado pessoal); refaz avisos e lembretes; `agenda_touch`.

Se o passo 4 falhar, tudo desfaz: o agendamento antigo fica intacto e a resposta é `slot_taken` com alternativas. Em
recurso de autoridade externa, o horário novo fica seguro como reserva até o sistema externo responder (§8). Trocar de
procedimento não é remarcação: é cancelar e marcar outro. Trocas de ordem entre itens não esbarram em recusa falsa porque
`items_seq_uq` e `items_patient_no_overlap` são conferidas no COMMIT (R1-B5); a da ocupação continua imediata.

**`agenda_package_options(p_clinic, p_procedures uuid[2..4], p_day date, p_limit 5)`**
1. `S_i = agenda_free_starts` de cada procedimento no dia (listas ordenadas).
2. Para cada ordem possível (até 24) que respeita as regras de par, e cada t1 em S_π1: o próximo começa no menor t de
   S_π(k+1) com t ≥ fim_k + max(`patient_gap_min`, intervalo do par) (busca binária).
3. Cada plano é validado com ocupação virtual (pega dois exames no mesmo aparelho cuja higienização se cruzaria).
4. Ordena por menor espera total, depois fim mais cedo, depois início mais cedo; devolve os 5 melhores (< 200 ms).
Regras de par (`ordem`, `intervalo_min`, `nao_mesmo_dia`) vêm sempre da clínica; jejum e preparo aparecem na revisão.

**Reserva coordenada.** `agenda_book` com até 4 itens é tudo ou nada, numa transação, com as travas em ordem crescente.
Pacote parcial ficou fora da primeira versão (§16): o paciente pode marcar os exames separadamente.

---

## 7. Tempo real

**Painel da clínica e central do IMED: Supabase Realtime (Broadcast vindo do banco, canal privado).**
- `agenda_touch` chama `realtime.send({v, dias[], tipo}, 'agenda', 'agenda:clinica:<uuid>', true)` uma vez por transação.
  A mensagem só sai depois do COMMIT; transação desfeita não avisa ninguém. Sem dado de paciente (as mensagens ficam 3 dias).
- Policies novas em `realtime.messages` (só leitura; nenhuma de INSERT: cliente não publica):
```sql
create policy "agenda: membro recebe avisos da clinica" on realtime.messages for select to authenticated using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) ~ '^agenda:clinica:[0-9a-f-]{36}$'
  and public.clinic_perm_scope(split_part((select realtime.topic()), ':', 3)::uuid, 'agenda.ver') is not null);
  -- (has_clinic_perm só vale para o escopo 'clinica'; o profissional, de escopo 'propria', também recebe o aviso)
create policy "agenda: equipe imed recebe avisos" on realtime.messages for select to authenticated using (
  realtime.messages.extension = 'broadcast' and (select realtime.topic()) = 'agenda:imed'
  and public.imed_has('imed.agenda.monitor'));
```
- Cliente sem supabase-js: `assets/js/tempo-real.js` (protocolo documentado): `wss://pyoqiecupxhdzigjudyd.supabase.co/realtime/v1/websocket?apikey=<publishable>&vsn=1.0.0`,
  `phx_join` com `{config: {broadcast: {self: false}, presence: {enabled: false}, private: true}, access_token}`,
  batimento a cada 25 s, nova tentativa em 1/2/5/10 s, `access_token` reenviado quando o `auth.js` renovar (evento `imed:token`).
  Conexão pública sem usuário dura no máximo 24 h (documentação); o painel sempre usa o token do usuário.

**A correção não depende do aviso.** O aviso só dispara uma nova leitura. Consulta periódica de `agenda_version(p_clinic)`
(`createPoller`, `tele-core.js`): 15 s com o WebSocket no ar, 5 s sem. Ao reconectar, relê a faixa visível inteira. O painel
lê a versão **antes** dos dados (R1-B10). Isso cobre `realtime.send` que falha em silêncio (hoje não há partição em
`realtime.messages`), aviso perdido e policy em cache. Não anunciar "tempo real" antes de o piloto provar (R2-18): a tela
mostra "Atualizado há N s" e uma faixa "sem conexão".

**App do paciente:** sem WebSocket; com a lista visível, relê `agenda_slots` do dia aberto a cada 30 s. A garantia é a
conferência no servidor na hora de confirmar. A versão da clínica não é pública (revelaria o movimento).

**Ajustes:** CSP do `painel.html` (e do `gestao.html`) com `wss://pyoqiecupxhdzigjudyd.supabase.co`; dono desliga "Allow public
access" do Realtime. Limites do Free (200 conexões, 100 mensagens/s) bastam para o começo.

**Descartados:** `postgres_changes` (manda a linha inteira com dado pessoal, uma checagem de RLS por assinante, não funciona
com tabelas sem policy) e SSE por Edge Function (no Free o worker vive no máximo 150 s, um por pessoa conectada).

---

## 8. Integração externa e modalidades

| Modo (`clinics.agenda_mode`) | Autoridade | O que paciente e painel veem | Venda online |
|---|---|---|---|
| `pedido` (padrão) | — | "A clínica (ou o IMED) liga para combinar o horário" | não |
| `nativa` | iMed | "Agenda da clínica no iMed: horário confirmado na hora" | sim |
| `manual` (assistida) | iMed, com registro manual da clínica | "Agenda atualizada pela própria clínica no iMed" (nunca "tempo real") | só com o compromisso aceito (`manual_commitment_at`): a recepção ocupa no painel **antes** de confirmar ao paciente; sem compromisso, fica em `pedido` (decisão 6) |
| `externa` 2a: confirmação por reserva | sistema da clínica | "Agenda conectada ao sistema da clínica: a confirmação chega em instantes" | reserva no iMed → envio → confirmação do externo → confirmado |
| `externa` 2b: cota do iMed | iMed, dentro das janelas liberadas e bloqueadas no software externo | o mesmo | confirma na hora, dentro da cota; o externo é avisado |
| externa sem saúde (`atrasada`/`fora`) | — | "Agendamento online pausado — faça um pedido" | não |

A modalidade só muda por ação explícita da clínica (ou da equipe do IMED com acordo escrito), nunca sozinha. "Só ocupar o
horário" (`agenda_desk_busy`) registra ocupado sem dado do paciente: o menor dado possível para quem não é paciente do iMed.

**Autoridade e conflito (R1-A5)**
- Recurso de autoridade externa: o evento externo vence; a reserva do iMed que bater nele é desfeita, com aviso ao paciente.
- Recurso de autoridade iMed (2b): o externo só confirma depois de receber 2xx do iMed (requisito de homologação).
- Recurso externo nunca é liberado por tempo: a reserva vencida vai para "liberando" (ocupação mantida, cancelamento enviado)
  até o externo confirmar o cancelamento ou a reconciliação provar que ele não tem o paciente.
- Todo envio leva validade (TTL); o externo recusa confirmação vencida (homologação).
- Remarcação em recurso externo segura o horário novo como reserva até a resposta.
- 2b só é homologado com a cota bloqueada no software externo.

**API** (Edge Function `agenda-api`, `verify_jwt=false`, autenticação própria, sem CORS)
- Chave por integração `imed_<amb>_<prefixo8>_<segredo>`: o banco guarda prefixo e `sha256(segredo)`, com segunda chave para
  troca sem parada; a chave aparece uma vez só.
- Escopos: `disponibilidade:ler`, `agendamentos:escrever`, `bloqueios:escrever`, `ocupacao:espelhar`, `status:ler`.
- Obrigatórios: `Idempotency-Key` em POST/PATCH; HMAC do corpo (`X-Imed-Signature: t=…,v1=…`, tolerância de 5 min); tamanho
  máximo do JSON.
- Fluxo: a função chama `agenda_api_call(p_prefix, p_secret_hash, p_action, p_body, p_idem)` — a integração é autenticada
  **dentro** do SQL (nunca um `p_integration` vindo de fora); executável só por service_role, com a chave secreta nova, e a
  função confere o papel do token por dentro.
- Rotas v1: `GET /v1/disponibilidade`, `POST /v1/agendamentos`, `PATCH /v1/agendamentos/{external_id}`,
  `POST /v1/agendamentos/{external_id}/cancelar`, `POST`/`DELETE /v1/bloqueios`, `PUT /v1/ocupacao` (foto dos ocupados de um
  recurso num intervalo, com número de sequência), `GET /v1/eventos?desde=<cursor>`, `GET /v1/status-sincronizacao`.

**Identificadores, versão e ordem (R1-M1)**
- `agenda.external_refs(id, integration_id, object_type, external_id, local_id, external_version, last_event_at, tombstone)`;
  únicos por `(integration, tipo, external_id)` e `(integration, tipo, local_id)`. Cancelado vira lápide, nunca é apagado
  (um "criar v1" atrasado não ressuscita o agendamento).
- Portão atômico antes de aplicar: `update agenda.external_refs set external_version = v where … and external_version < v
  returning …` (ou `insert … on conflict do update … where external_refs.external_version < excluded.external_version`).
  Mais antigo vira `ignorado_antigo`; repetido, `duplicado`; salto de versão marca o objeto para conferência.
- `agenda.sync_events(…, status in ('recebido','aplicado','ignorado_antigo','duplicado','conflito','erro','pendente_envio',
  'enviado','falhou'), payload_hash, payload jsonb mínimo)`; único por `(integration_id, direction, coalesce(external_event_id,
  payload_hash))`.
- Foto de ocupação: número de sequência por (integração, recurso) em `agenda.snapshot_seq`; foto mais velha é recusada.
  Linha da foto que contradiz o iMed vira `divergencia_externa`, sem derrubar o resto (conferência antes, não exceção).

**Saída: fila `agenda.outbox`** (nasce na 5.3, usada por avisos e webhooks)
- Cron `imed-agenda-saida` (30 s, só se houver item vencido) chama via pg_net a Edge Function `agenda-saida` com `x-imed-token`;
  URL em `private.app_settings`.
- `agenda_outbox_claim` (`FOR UPDATE SKIP LOCKED`) entrega só o evento pendente **mais antigo de cada agendamento** (FIFO por
  agregado); `agenda_outbox_done` fecha. Novas tentativas em 1 min, 5 min, 15 min, 1 h e 6 h; depois de 10, `falhou` com alerta.
  Cada envio leva `event_id` e a versão do agendamento.
- Proteção contra SSRF (R2-14): só https na porta 443; DNS resolvido e IP privado, loopback, link-local e de metadados
  recusados; sem redirecionamento; tempo e tamanho máximos.

**Reconciliação e saúde.** Diária e sob demanda: compara o dia (lista do externo ou a foto) com o local; diferença vira
conflito. `last_ok_at` e batimento: 5 min = `atrasada`, 15 min = `fora` (decisão 25). Alerta no painel da clínica, na central
(`agenda:imed`) e por e-mail quando houver canal.

**Política segura.** Integração sem confirmação ou sem saúde: os recursos dela saem da venda, as reservas pendentes não
confirmam e o paciente vê a alternativa "pedido". Nenhum conector é presumido; cada software é homologado com documentação,
contrato e credenciais reais (fase 6.3).

---

## 9. Pagamentos (estrutura independente do gateway; fase 5.4, só depois da decisão 4)

- `agenda.payments(id, request_id, clinic_id, provider, provider_payment_id, method in ('pix','cartao','no_local'),
  amount_cents, currency 'BRL', status in ('criado','aguardando','processando','autorizado','aprovado','recusado','expirado',
  'cancelado','estornado','estorno_parcial','contestado'), expires_at, refunded_cents, version, created_at, updated_at)`.
- `agenda.payment_events(id, provider, provider_event_id, payment_id, type, amount_cents, occurred_at, received_at,
  payload_hash, result)`, `unique (provider, provider_event_id)`. Nunca dado de cartão.
- Webhook (Edge Function `pagamentos-webhook/<provedor>`): confere a assinatura; **consulta o estado no provedor** em vez de
  confiar no corpo; chama `agenda_payment_event(...)` (só service_role, conferido por dentro), que insere com
  `on conflict do nothing` (repetido = `duplicate`, sem efeito — teste 8) e aplica precedência completa: estornado,
  cancelado e contestado nunca voltam a aprovado; evento mais antigo que o último aplicado é ignorado.
- Aprovado: confere o valor com `total_cents` e confirma pela regra do §5 (dentro do prazo; atrasado com o horário ainda
  dele; ou conflito `pagamento_apos_expirar` para remarcar ou reembolsar). Nunca passa por cima de outro paciente.
- Contra pagamento atrasado (R1-M9): o QR do Pix vence 1 a 2 min **antes** da reserva; a ocupação em `awaiting_payment` só é
  liberada depois do prazo + carência; a liberação trava o pagamento (`FOR SHARE`) na ordem pedido → pagamento; cartão só
  autorizado e capturado depois de garantir o horário, se o gateway permitir. Boleto não serve para reserva de minutos.
- Padrão: `payment_mode = 'no_local'`. Os textos públicos ("gratuito", "pagamento no local", "o IMED nunca pede Pix")
  continuam verdadeiros; nada mostra "pago" sem evento real.
- Painel financeiro: receita estimada = soma de `price_cents` dos itens confirmados ou concluídos de origem iMed (com contagem
  de "sem preço informado"); receita confirmada = pagamentos aprovados + "pago no local" marcado pela recepção.
  `private.billing_charges` ganha `appointment_id` para a comissão.

---

## 10. Notificações (fase 5.3)

- `agenda.notifications(id, request_id, clinic_id, event_type in ('confirmado','pagamento_aprovado','pagamento_nao_concluido',
  'cancelado','remarcado','lembrete_24h','lembrete_2h','alterado_pela_clinica','orientacoes_preparo'), channel in ('email',
  'whatsapp','sms','push'), recipient_kind in ('paciente','clinica'), send_after, status in ('agendada','enviando','enviada',
  'falhou','cancelada','sem_canal','sem_consentimento'), attempts, last_error, provider_message_id, created_at, sent_at)`,
  `unique (request_id, event_type, channel, send_after)`.
- Minimização: endereço e telefone não são copiados para a fila; o envio lê do pedido na hora.
- `agenda.notification_rules(clinic_id, procedure_id null, event_type, channel, enabled, offset_min)`: padrões 24 h e 2 h,
  por clínica e por exame.
- Geração dentro de `agenda_transition`; lembrete que já passou não é criado; cancelar ou remarcar cancela e refaz os lembretes.
- Envio pelo `agenda-saida`: confere na hora se ainda está confirmado e no mesmo horário (senão `cancelada`). Canal sem
  credencial = `sem_canal`, nunca "enviada". Sem consentimento no canal = `sem_consentimento`. Web Push (chaves VAPID) não
  tem custo, mas no iOS só funciona com o app instalado. Resend e WhatsApp dependem do dono.
- Conteúdo sem dado sensível: clínica, data e hora com o fuso, endereço e link. Nome do exame e preparo desligados por padrão
  (decisão 8). Para a clínica: "Novo agendamento 05/11 09:30 (USG). Abra o painel."

---

## 11. Painéis

**Painel da clínica** (`painel.html`; módulos novos para não inchar o `painel.js`, que tem mais de 1.500 linhas)
- Arquivos: `assets/js/agenda-core.js` (funções puras testadas: grade, cores, transições na tela, fuso),
  `assets/js/agenda.js` (visões), `assets/js/agenda-config.js` (cadastros), `assets/js/tempo-real.js`; estilos em
  `assets/css/clinica.css`. Abas por permissão (`agenda_me()` devolve unidades, papéis e permissões; corrige junto o erro
  do admin em `painel.js:102`, que lê vínculos sem filtrar o próprio usuário).
- **Dia:** colunas por equipamento, sala ou profissional; linhas de 15 min com passo de 5. **Semana:** dias × horário.
  **Mês:** ocupação de cada dia, clique abre o dia.
- **Filtros:** unidade, exame/procedimento, equipamento, profissional, sala e origem.
- **Legenda** (cor sempre com texto e ícone; tokens de `clinica.css`; contraste AA; tabela alternativa):
  verde "Livre"; azul "Confirmado", "Paciente presente", "Em atendimento"; amarelo "Reserva temporária até 10:42",
  "Aguardando pagamento até 10:42"; vermelho "Bloqueado: Manutenção", "Feriado", "Ocupado (agenda própria)"; cinza
  "Cancelado", "Não compareceu" (ocultáveis); roxo "Concluído".
- **Recepção ("Hoje"):** lista por hora com botões grandes (Chegou, Em atendimento, Concluído, Não compareceu) e busca rápida
  (`agenda_search` sempre por POST, para o nome não ir à URL; mínimo 3 caracteres; até 20 resultados).
- **Novo agendamento (cenário B):** procedimento → dia → horários livres (mesmo motor) → nome e celular → aviso ao paciente de
  que o agendamento fica registrado no sistema → confirmação → canal telefone ou balcão. "Só ocupar o horário": sem dados.
- **Detalhe:** dados conforme o papel (com `access_log`), histórico (`agenda_history`), cancelar (motivo em código), remarcar
  (seletor + troca atômica), pagamento (só financeiro). Ações críticas pedem confirmação; o botão manda `p_version`
  (se outra pessoa mexeu antes: "atualize").
- **Cadastros:** unidade (fuso com confirmação, antecedências, passo, prazos, feriados conferidos até quando); recursos
  (capacidade, preparo, higienização, manutenção); procedimentos (duração sem valor padrão, preço com a trava L11, preparo,
  grupos de recursos com alternativas); horários (funcionamento, pausas, escalas); feriados e bloqueios (bloqueio sobre
  agendamento devolve a lista; "bloquear mesmo assim" manda os pacientes para remarcação com conflito); configuração rápida;
  modalidade e compromisso; equipe (convite por e-mail, papéis, último dono protegido); integração (6.1); avisos (5.3).
  Toda mudança de configuração mostra antes quantos agendamentos futuros seriam afetados.
- Com a agenda ativa, o horário de funcionamento público (`clinics.opening_hours`) passa a ser derivado das regras da unidade.
- **"Precisa de atenção":** conflitos abertos. **"Atualizado há N s"** e faixa "sem conexão".
- Telas: computador e tablet (1024 px) e lista simplificada em 390 px. Saída por inatividade (30 min) e "Sair de todos os aparelhos".

**Painel gerencial da clínica**
- `agenda_dashboard(p_clinic, p_from, p_to, p_filters)`, operacional e sem dado pessoal: agendamentos do dia, da semana e do
  mês; taxa de ocupação = minutos ocupados (agendamento + ocupado) ÷ minutos abertos (aberto − bloqueios), por recurso, com a
  fórmula na tela; livres e bloqueados; cancelamentos por motivo; não comparecimentos (%); exames realizados; origem
  (iMed, clínica, externo).
- `agenda_dashboard_financeiro`, separado (`financeiro.ver`): receitas estimada e confirmada (§9).
- Filtros: unidade, período, exame, equipamento, profissional e origem.

**Central do IMED** (`gestao.html`, aba "Agenda"; `gestao.js`, `gestao-core.js`)
- Clínicas com agenda: modo, saúde da integração, último sincronismo, conflitos abertos e baixa utilização (< X% em 30 dias);
  monitor de conflitos e falhas; eventos de sincronização e novas tentativas; próximo horário por unidade; auditoria (busca por
  clínica, objeto e autor); parâmetros globais; feriados (lançar com fonte); papéis da equipe (só o dono).
- Ver dados de um agendamento exige `imed.pacientes.ver` e justificativa ("quebra de vidro"), registrada em `access_log`.
- Atualiza por consulta periódica a cada 30 s (e pelo canal `agenda:imed`).

---

## 12. Segurança e LGPD

**Papéis da clínica** (`agenda.role_permissions`; `public.has_clinic_perm(p_clinic, p_perm)`, SECURITY DEFINER, STABLE)

| Permissão | owner | manager | reception | professional | finance |
|---|---|---|---|---|---|
| pedidos.ver (lista antiga, contatos) | sim | sim | sim | não | não |
| agenda.ver | sim | sim | sim | só a própria | não |
| agenda.pacientes (nome, contato, detalhe) | sim | sim | sim | só a própria, sem telefone | não |
| agenda.marcar / cancelar / remarcar | sim | sim | sim | não | não |
| agenda.atender (presente, atendimento, concluído, faltou) | sim | sim | sim | só a própria | não |
| agenda.bloquear | sim | sim | sim | não | não |
| agenda.configurar, precos.editar, clinica.editar | sim | sim | não | não | não |
| equipe.gerenciar | sim | sim (menos donos) | não | não | não |
| financeiro.ver | sim | sim | não | não | sim |
| integracao.gerenciar | sim | não | não | não | não |
| auditoria.ver, conflitos.resolver | sim | sim | conflitos | não | não |

`staff` (legado) = reception. Antes de liberar convites (3.4), as policies e RPCs antigas trocam `is_clinic_member` pela
permissão certa (pedidos, exames, grade, bloqueios, `update_my_clinic`, `set_my_clinic_exams`); sem isso, "finance" leria telefones.

**Equipe do IMED (R2-2).** `public.imed_has(p_perm)` = `is_imed_admin()` (o dono, inalterado) **ou** papel ativo em
`private.imed_staff` com as mesmas exigências de sessão do `is_imed_admin` (e-mail confirmado, sessão pelo link, sem senha ou
anônimo). Papéis: `operacao`, `suporte` (sem dado de paciente), `financeiro`, `auditoria`. Ninguém além do dono entra em
`admin_emails`; as 22 funções e 15 policies que usam `is_imed_admin()` migram para `imed_has(<permissão>)` antes de cadastrar
a segunda pessoa (pgTAP: "suporte" recebe `forbidden` ou vazio em cada uma). Prontuário continua em `tele_record_readers`.

**Permissões de função (R2-1).** Funções só do servidor (`agenda_api_call`, `agenda_payment_event`, `agenda_outbox_claim`,
`agenda_outbox_done`, `agenda_book_srv`): `revoke all … from public, anon, authenticated; grant execute … to service_role`,
e recusa por dentro se `auth.jwt()->>'role'` não for `service_role`. Guarda pgTAP compara o `proacl` exato de cada função
com listas permitidas para anon **e** authenticated.

**Isolamento.** Toda função deriva a clínica do registro (nunca confia só em `p_clinic`); tabelas `agenda.*` fora da API;
membro removido perde o acesso na próxima chamada (o WebSocket só recebe avisos sem dado pessoal até reconectar).

**Minimização.** Reserva sempre ligada a um agendamento real (sem reserva anônima); a grade mostra "Maria S." e o
procedimento; telefone só no detalhe; finance não vê nomes; observações livres viram campos fechados + nota curta apagável
com aviso "não escreva dados de saúde" (decisão 22); IP só como hash com sal diário; impressão digital sem dado pessoal.

**Trilhas (R2-12).** `status_history`, `audit_log`, `access_log`: só acréscimo, só códigos, sem chave estrangeira; equipe por
`user_id`. Texto livre só em `agenda.notes`. Leitura de dado de paciente só por funções VOLATILE chamadas por POST (o PostgREST
abre transação só de leitura para STABLE), com registro agregado por dia; a leitura direta pela REST fecha na 4.2 (R2-13).

**Sessão.** Saída por inatividade no navegador; "Sair de todos os aparelhos"; MFA por aplicativo (TOTP, sem custo) exigido
(`aal2`) para `equipe.gerenciar` e `integracao.gerenciar`, com as telas de cadastro e verificação no `auth.js` (4.1, se o dono
decidir). Tempo-limite de sessão no servidor é recurso do plano Pro. Convite (R2-21): aceito só com e-mail confirmado e sessão
pelo link; preso ao `user_id` na primeira aceitação; um convite aberto por (clínica, e-mail).

**Credenciais.** Chaves de API só em hash; segredos de webhook e sal no Vault; funções do servidor com a chave secreta nova
(fase 0); HMAC com proteção contra reenvio; tamanho de todo JSON validado; limites contra abuso (§3.2); Turnstile verificado
numa Edge Function (`agenda-reservar`) que chama `agenda_book_srv`, quando o dono liberar (decisão 10).

**Logs.** Nenhum dado pessoal nem token nos logs das Edge Functions; dado pessoal nunca em URL.

**Retenção (proposta para o advogado)**

| Dado | Prazo proposto |
|---|---|
| Reserva expirada sem pagamento | anonimizar nome, telefone e e-mail em 7 dias |
| Dado pessoal do agendamento | anonimizar 5 anos depois do atendimento (CDC art. 27) |
| Histórico de situação e auditoria (só códigos) | 5 anos |
| `access_log` | 1 ano |
| Hash de IP e contadores | 48 h — **conferir com o advogado** o Marco Civil (art. 15: registros de acesso a aplicações por 6 meses) |
| Conteúdo dos eventos de sincronização | 90 dias |
| Pagamentos | 5 anos (fiscal) |
| Fila de avisos | 90 dias |
| Notas livres | apagáveis a qualquer momento; no máximo 1 ano |
| Idempotência / `cron.job_run_details` | 7 dias |

**Papéis de tratamento (proposta para revisão jurídica).** Agendamento feito pelo paciente no app: IMED e clínica como
controladores independentes, cada um na sua finalidade (intermediação; atendimento). Agendamento de balcão ou telefone
registrado pela clínica: a clínica é controladora e o IMED operador, com contrato de tratamento (instruções, sigilo, segurança,
suboperadores — Supabase/AWS em São Paulo, e-mail, WhatsApp —, aviso de incidente em 3 dias úteis pela Res. CD/ANPD 15/2024,
devolução ou eliminação no fim). Encarregado: verificar se a dispensa da Res. CD/ANPD 2/2022 vale para dado de saúde em escala
(a tendência é não). RIPD antes da operação comercial. Revisão de termos e privacidade antes de existir reserva temporária ou
pagamento online.

---

## 13. Testes

**Infraestrutura**
- **Laço rápido local (3.0):** `tests/banco/local/` sobe um PostgreSQL 16 descartável quando existir na máquina (existe aqui)
  com uma base mínima e stubs de `auth.uid()`/`auth.jwt()` e dos papéis, e roda a semântica do EXCLUDE, o motor e a
  concorrência em segundos. Não substitui o CI (falta PostGIS, PostgREST, Auth e Realtime).
- **CI do banco:** `.github/workflows/banco.yml`, separado do `testes.yml`: ubuntu-24.04, `supabase/setup-cli` em versão fixa,
  `supabase start` sem studio, imgproxy, storage, logflare, vector, mailpit, postgres-meta e supavisor (sobe Postgres 17,
  Auth, PostgREST, Realtime e edge-runtime e aplica todas as migrações); desliga os jobs do pg_cron logo depois;
  `supabase test db` (pgTAP em `supabase/tests/*.sql`); `npm i --no-save pg` e os scripts de `tests/banco/` (conexões
  diretas, HTTP no PostgREST com JWTs assinados pelo segredo local, WebSocket no Realtime). O resumo mostra p95, 40P01 e 57014.
- `supabase/config.toml`: `[db] major_version = 17`; `verify_jwt = false` para `importar-clinicas`, `agenda-api`,
  `agenda-saida`, `agenda-reservar` e `pagamentos-webhook`.
- Pré-requisito (3.0): a URL da fila de importação sai do código e vai para `private.app_settings`; sem isso o CI chamaria a
  função de produção a cada minuto.
- **Produção:** depois de cada migração aplicada pelo conector, conferências de leitura e roteiros `begin; … rollback;`
  (`set local role`, `request.jwt.claims`, `do $$ … assert … $$`); filas do pg_net e do Realtime desfazem junto. Caminhos que
  exigem criar usuário no Auth ficam só no CI.
- **E2E (banco simulado, padrão atual):** `tests/e2e-agenda.mjs` e `tests/e2e-agenda-config.mjs` (novos) e ajustes em
  `e2e-local`, `e2e-perto`, `e2e-conta`, `e2e-clinica`, `e2e-a11y`, `e2e-gestao`. Página com `wss://` usa `page.routeWebSocket`
  (o `context.route` não intercepta WebSocket e o teste conectaria na produção).
- **Unidade:** `tests/agenda-core.test.mjs`, `tests/tempo-real.test.mjs` (socket falso), `supabase/functions/*/lib.test.ts`.
- **Guardas de catálogo** (`supabase/tests/000_catalogo.sql`): nenhuma tabela de public sem RLS; `proacl` de cada função igual
  à lista permitida para anon e authenticated; toda SECURITY DEFINER com `search_path` definido (exceção conhecida e
  listada: `public.imported_cities`, com `search_path=public`); schema `agenda` sem USAGE para anon, authenticated e
  service_role; nenhuma função com `ON CONFLICT` em `agenda.occupancy`; trilhas com guarda; colunas novas de
  `appointment_requests` sem INSERT para anon/authenticated.

**Os 10 testes obrigatórios (todos com Postgres 17 de verdade no CI)**

| # | Onde | Como prova |
|---|---|---|
| 1 Concorrência | `tests/banco/concorrencia.mjs` + `200_exclusao.sql` | (a) 80 conexões diretas com barreira (coordenador segura `pg_advisory_lock(42)`; cada uma faz `pg_advisory_xact_lock_shared(42)` antes de `agenda_book`) no mesmo procedimento e aparelho, com inícios iguais e diferentes (30 × 45 min): exatamente 1 confirmado; (b) 300 POST simultâneos no PostgREST com ids distintos (limites contra abuso ajustados só para o teste): 1 confirmado, 299 `slot_taken`; (c) capacidade 2: no máximo 2 em qualquer instante. Oráculo: por recurso, máximo de usos ativos simultâneos ≤ capacidade (sem olhar a vaga) e nenhum uso cruza fechamento; 0 respostas 40P01 e 57014; p95 registrado |
| 2 Agendamento externo (balcão) | `310_balcao.sql` + HTTP + e2e | `agenda_desk_book` com JWT de recepção da clínica A; logo depois, como anon pela REST, `agenda_slots` e `available_slots` não trazem o horário |
| 3 Cancelamento | `220_cancelar.sql` | `cancel_request` (código) e `agenda_cancel` (clínica, motivo) liberam a ocupação e o horário volta; `past` e `too_late` respeitados |
| 4 Reserva expirada | `210_reserva.sql` + script | reserva com prazo no passado (gravado como postgres no teste); `call private.agenda_manutencao()` libera; liberação preguiçosa sem cron; confirmar × expirar ao mesmo tempo ⇒ só um vence; na 5.4, pagamento atrasado confirma ou abre conflito; na 6.1, recurso externo não é liberado por tempo |
| 5 Equipamento indisponível | `320_bloqueio.sql` | bloqueio de manutenção na RM-1: some todo horário que só depende dela; procedimento com alternativa (RM-2) continua; bloqueio sobre agendamento devolve a lista; "mesmo assim" libera e abre conflito; bloqueio × marcação simultâneos: um espera o outro |
| 6 Vários exames | `230_pacote.sql` + script concorrente | 3 itens, 3+ ocupações; conflito no 3º ⇒ nada gravado; dois pacotes disputando o recurso do meio ⇒ um inteiro, o outro nada |
| 7 Falha de conexão | `tests/banco/falha.mjs` + e2e `routeWebSocket` | `pg_terminate_backend` no meio de uma marcação (transação aberta depois de gravar a ocupação) ⇒ nenhuma linha parcial; painel desconectado enquanto alguém marca ⇒ ao reconectar, a versão mudou e a tela mostra o agendamento |
| 8 Webhook duplicado | `500_pagamento.sql` + 2 chamadas paralelas (5.4) | mesmo `provider_event_id` duas vezes ao mesmo tempo ⇒ 1 `payment_events`, 1 confirmação, 1 histórico, 1 aviso |
| 9 Isolamento | `300_isolamento.sql` + `tests/banco/tempo-real.mjs` | membro de A chama cada função com ids de B ⇒ `forbidden` ou vazio; REST em `agenda.*` ⇒ negado; REST direta em pedidos de B ⇒ vazio; canal `agenda:clinica:B` ⇒ entrada recusada |
| 10 Sincronização externa | `600_integracao.sql` + Deno `agenda-api/lib.test.ts` + HTTP local | v3 antes de v2 ⇒ v2 `ignorado_antigo`, estado final v3; v2 e v3 em paralelo ⇒ fica v3 (portão atômico); repetido ⇒ `duplicado`; salto ⇒ marcado; choque com marcação do iMed em recurso iMed ⇒ 409 + conflito; foto velha depois da nova ⇒ recusada; criar e cancelar fora de ordem na saída ⇒ FIFO |

**Extras:** fuso e horário de verão (`205_fuso.sql`); regras, pausas, feriados e buffers; mudança de grade, pausa, feriado,
capacidade ou higienização durante marcações simultâneas (`250_configuracao.sql`); redução de capacidade × marcação; máquina
de estados completa (`400_estados.sql`); remarcação (`240_remarcar.sql`); idempotência (mesmo id e código; id novo depois de
`slot_taken`); "Chegou" depois de mudar requisito ou higienização (M6); pedido sem horário igual ao de hoje
(`010_pedidos_atuais.sql`); permissões (`120_permissoes.sql`); desempenho (`agenda_slots` p95 < 150 ms; `agenda_next_free` com
10 clínicas). Na 3.0, `tests/banco/concorrencia-atual.mjs` demonstra o defeito de hoje (inícios diferentes que se cruzam
passam) como falha esperada; na 3.3 o defeito some junto com o caminho antigo.

**Definição de pronto:** uma fase só é declarada pronta com os testes dela verdes no CI (`banco.yml` e `testes.yml`) e as
conferências de produção feitas.

---

## 14. Plano por fases

Cada entrega: publicável e reversível no comportamento (por clínica, `agenda_mode`/`agenda_online_since`); banco antes do
site; `VERSION` do `sw.js` (arquivos novos no `CORE`); todos os testes; commit na `main`; trabalho numa git worktree limpa
(a pasta principal tem mudanças de outro agente). Toda migração tem script de volta testado no CI. Migrações com o nome igual
à versão aplicada no banco.

**Fase 0 — com o dono, em paralelo (não é da agenda, mas bloqueia tudo)**
- **0.1 Chaves novas do Supabase — prazo: antes de 31/12/2026.** Conferido em 31/10 (`get_publishable_keys`): o projeto
  **já tem** a chave publishable `default` ativa, ao lado da `anon` antiga; o dono não precisa criar nada. Código: `assets/js/config.js` com a publishable; os módulos que hoje mandam `Bearer` com a chave pública
  passam a mandar só `apikey` (Authorization só com o token do usuário) — conferir um a um: `auth.js`, `cidade.js`, `db.js`,
  `documento.js`, `inicio.js`, `local.js`, `medico.js`, `parceiros.js`, `perto.js`, `visitas.js`; Edge Functions
  `clinicas-proximas` e `importar-clinicas` leem `SUPABASE_SECRET_KEYS`, com `verify_jwt=false` e autorização própria; teste
  `tests/chaves.test.mjs` reprova `"Bearer " + chave pública`. Depois de tudo no ar e conferido, o dono desliga as antigas.
- **0.2 E-mail de login com domínio (Resend) e Auth → URL Configuration.** Sem isso nenhum funcionário de clínica recebe o
  link de entrada (bloqueia clínicas reais, não o desenvolvimento).
- **0.3 Backup:** plano Pro (custo) ou cópia diária criptografada pelo GitHub Actions (decidir onde guardar).
- **0.4 Turnstile** (conta Cloudflare, grátis) antes de vender online em clínica real.

**Fase 3 — Banco (nada muda para o paciente)**
- **3.0 Banco de verdade no GitHub.** Arquivos: `supabase/config.toml`, `.github/workflows/banco.yml`,
  `supabase/tests/000_catalogo.sql`, `010_pedidos_atuais.sql`, `tests/banco/lib.mjs`, `tests/banco/local/`,
  `tests/banco/concorrencia-atual.mjs`. Migração `<ts>_agenda_preparo` (URL das funções em `private.app_settings`; limpeza
  diária de `cron.job_run_details` com mais de 7 dias). Dono: nada.
- **3.1 Fundação** (`<ts>_agenda_base`). `btree_gist`; schema `agenda`; tabelas da 3.1 (§2.5); ALTERs (§2.3); INSERT por
  coluna; fim da policy "admin atualiza pedidos" e de UPDATE/DELETE diretos; `has_clinic_perm`, `imed_has`, `imed_staff`;
  gatilhos de origem, validação única e guardas de trilha; `agenda_touch` (sem Realtime ainda); tabelas de referência.
  As duas únicas funções que hoje mudam pedidos (`set_request_status` e `cancel_request`, conferido no catálogo) ganham só a
  marca `imed.origin`, para a guarda nova não barrá-las. Sem mudança de comportamento. Testes: `100_estrutura.sql` (os casos
  do §3.4), `110_papeis.sql`, `120_permissoes.sql`, `010_pedidos_atuais.sql` (pedido, cancelamento e mudança de situação de hoje).
  Dono: aprovar o SQL quando o Supabase pedir.
- **3.2 Cadastros e motor de disponibilidade** (`<ts>_agenda_motor`). Funções de cadastro (unidade, recursos, procedimentos,
  requisitos e alternativas, regras de par, regras abre/pausa, feriados da equipe, aberturas em feriado, bloqueios) com a
  trava de configuração e a revalidação; `agenda_free_map`/`agenda_free_starts`; `agenda_public_info`, `agenda_slots`,
  `agenda_days`; fachadas `available_slots`, `clinics_with_schedule`, `set_my_schedule` (`managed_by_agenda`),
  `add_my_block`/`remove_my_block`; parada se houver dados antigos. Testes: `205_fuso.sql`, `250_configuracao.sql`,
  `320_bloqueio.sql` (parte de horários), regras e buffers, `tests/banco/desempenho.mjs`.
- **3.3 Marcar, cancelar, remarcar e balcão** (`<ts>_agenda_operacao`). Alocador (travas, vagas); `agenda_book` (1–4 itens);
  `agenda_package_options`; `agenda_hold`/`agenda_confirm`/`agenda_release` (pagamento e integração; testados no banco);
  `agenda_cancel` + fachada `cancel_request`; `agenda_reschedule`; `agenda_desk_book`; `agenda_desk_busy`;
  `agenda_set_status` + fachada `set_request_status`; `agenda_my_booking`; gatilhos adiados do I2; cron
  `imed-agenda-manutencao` (30 s, `call`, lotes de 50); idempotência; contadores; histórico; caminho antigo com horário
  recusado e `appointment_requests_slot_uq` removido; `admin_gestao`/`admin_stats` sem `hold`/`expired` (+ `visitas.test.mjs`).
  Testes: 1, 2 (banco), 3, 4, 5 (com agendamentos), 6, 7 (parte do banco), `240_remarcar.sql`, `400_estados.sql`, idempotência.
- **3.4 Painel no banco** (`<ts>_agenda_painel`). `agenda_me`, `agenda_view` (dia e semana), `agenda_month`, `agenda_search`,
  `agenda_request_detail` (+ `access_log`), `agenda_history`, `agenda_version`, `agenda_dashboard`,
  `agenda_dashboard_financeiro`; equipe (`agenda.member_invites`, papéis, remoção, último dono); conflitos (listar, resolver);
  policies antigas por permissão; policies do Realtime + `realtime.send` no touch; preço "a partir de" em `clinic_exams`.
  Testes: 9, `tests/banco/tempo-real.mjs` (canal autorizado; aviso só depois do COMMIT), `access_log`.

**Fase 4 — Painel da clínica**
- **4.1 Equipe e cadastros.** `painel.html`, `painel.js` (`agenda_me`; correção da linha 102; editor antigo sai),
  `assets/js/agenda-core.js`, `assets/js/agenda-config.js`, `assets/css/clinica.css`; configuração rápida; confirmação do fuso;
  modalidade e compromisso; convites; MFA no `auth.js` (se decisão 17). Testes: `tests/agenda-core.test.mjs`,
  `tests/e2e-agenda-config.mjs`, `e2e-clinica`, a11y. Dono: 0.2 para funcionários reais.
  **Feita em 04/11/2026:** faltavam funções de leitura da configuração e de troca da modalidade; entraram na migração
  `20261104184120_agenda_config` (`agenda_config`, `agenda_mode_set`; só aditiva). MFA desligado: decisão 17 pendente do dono
  (recomendação registrada: obrigatório para dono e gestor).
- **4.2 Agenda visual e recepção.** `assets/js/agenda.js` (dia, semana, mês, legenda, filtros, busca, balcão, "só ocupar",
  detalhe e histórico, cancelar e remarcar, chegada e falta, bloqueios com a lista de afetados); rótulos novos do paciente em
  `geo-core.js` e `conta.js`; a lista de pedidos do painel passa a vir de função e a leitura direta pela REST fecha para a
  clínica (migração `<ts>_agenda_leitura`). Testes: `tests/e2e-agenda.mjs` (cores
  com texto, teclado, 1024 e 390 px, confirmações), `geo-core.test`, `e2e-conta`; a parte HTTP do teste 2 (balcão pela API e
  o visitante sem o horário) em `tests/banco/leitura-direta.mjs`; o bloqueio forçado sob disputa (conexões diretas e
  PostgREST) em `tests/banco/bloqueio-forcado.mjs`. A migração vai em 2 partes, em dias diferentes, cada uma com a
  própria volta (ao aplicar a parte 1, renomear a parte 2 para depois dela; o `banco.yml` reprova partes fora de ordem).
  **Feita em 05/11/2026 (parte 1 na produção):** migração `20261105050257_agenda_leitura_parte_1` (funções novas, gatilho
  `appointment_items_fecha_conflitos` ENABLE ALWAYS, `access_log_uq` com o motivo, `agenda_reschedule` e
  `agenda_request_detail` trocadas; 53 funções `agenda_*`), site no ar (`agenda.js` fora do CORE do `sw.js`, v31). A
  **parte 2** (`20261105050258_agenda_leitura_parte_2`, nome provisório: fecha a leitura direta da clínica) fica
  pendente de nova autorização do dono, uns dias depois do painel conferido (decisão 4.2-g). Até lá o painel lê pelas
  funções e a leitura direta continua aberta como reserva.
- **4.3 Atualização automática e painel gerencial.** `assets/js/tempo-real.js`, evento `imed:token` no `auth.js`, CSP com
  `wss`, consulta periódica de `agenda_version`, "Precisa de atenção", painéis operacional e financeiro. Testes: 7 (e2e),
  `tests/tempo-real.test.mjs`, a11y. Dono: desligar "Allow public access" do Realtime.
  **Feita em 05/11/2026 no ramo `ci/agenda-4-3` (não publicada):** `tempo-real.js` (canal + vigia; §7 como escrito; sem
  supabase-js), `imed:token`, `wss:` só no `painel.html`, "Precisa de atenção" (só com `agenda_view`, `agenda_conflicts` e
  `agenda_requests`), visão "Resumo" na aba Agenda (dono/gestor e equipe do IMED; financeiro só com `financeiro.ver`), a
  aba Pedidos relê no aviso. Faltava no banco: o pedido novo do site (INSERT direto, sem horário) não subia a versão →
  migração provisória `20261105190000_agenda_aviso_pedido` (gatilho aditivo com volta e pgTAP `355`), pendente de
  autorização. Revisão de 11/11: o gatilho vale só para o pedido antigo (`uses_resources = false`; no `agenda_book` ele
  tocava a versão no meio da marcação, antes de planejar: marcações da mesma clínica se esperavam e havia impasse com a
  manutenção), também quando a situação dele muda (cancelado pelo paciente, respondido pela equipe), e espera no máximo
  200 ms pela linha da versão (`lock_timeout`): um erro ou uma espera longa no aviso não derruba o pedido. Revisão de
  11/11 (lote site): os pedidos sem resposta do "Precisa de atenção" vêm de `agenda_requests_pending_count` (na mesma
  migração: só o número, sem dado de paciente e sem registro de leitura; antes o bloco baixava os 100 pedidos mais novos
  a cada carga e não via o pendente mais antigo); banco sem ela, a lista, com "pode haver mais" quando vêm 100; a aba
  Pedidos relê em silêncio no aviso, sem "Carregando" e guardando o foco; no Resumo, "Esta semana"/"Este mês" são os de
  hoje e o financeiro avisa que não usa os filtros. Na produção `realtime.messages` continua sem partição (conferido 05/11): até o serviço criar, só a
  consulta periódica funciona — a tela foi feita para isso. Testes: `tests/tempo-real.test.mjs`, teste 7 (com o aviso e
  sem Realtime) em `e2e-agenda.mjs`, a11y com a visão Resumo; todo e2e recebe um Realtime simulado que fecha o canal
  (`tests/regra-chaves.mjs`): nenhum teste sai para o Supabase de verdade.
- **4.4 Central do IMED (básico).** `gestao.html`, `gestao.js`, `gestao-core.js` (aba Agenda: clínicas, conflitos, auditoria,
  parâmetros, feriados, papéis da equipe); migração `<ts>_agenda_central` (`agenda_central_*`; troca para `imed_has` onde for
  preciso). Testes: `e2e-gestao`, `130_central.sql`.
  **Feita em 10/11/2026 no ramo `ci/agenda-4-4` (por cima do `ci/agenda-4-3`; não publicada; em 11/11 trazida para o
  ramo `ci/agenda-5-1` por cima da 4.3 rebaseada, com o pgTAP `130_central.sql` corrigido — as 2 leituras de preparo
  imprimiam "ok" solto e o pg_prove reprovava "Tests out of sequence"; agora são testes, plano 89):** parte "Agenda das clínicas" no fim do `gestao.html`
  (`assets/js/gestao-central.js`; regras e nomes dos códigos em `gestao-core.js`), 6 abas (Clínicas, Conflitos, Auditoria,
  Feriados, Parâmetros, Equipe do IMED); `startCentralWatcher` em `tempo-real.js` (canal `agenda:imed` + consulta de
  `agenda_central_version` a cada 30 s; `wss:` só do Supabase na CSP do `gestao.html`). Migração provisória
  `20261110190000_agenda_central`: 11 funções `agenda_central_*` + `private.agenda_central_params()`, **só aditiva** (CREATE
  FUNCTION, REVOKE, GRANT), com volta e pgTAP `130_central.sql` (87 testes); **nenhuma troca de `is_imed_admin` por
  `imed_has` foi precisa** (quem não é admin continua sem acesso às funções antigas), então não há parte que mude regra
  existente. Lançar e retirar feriado reutilizam `agenda_holiday_save`/`_remove` (3.2); papéis reutilizam `private.imed_staff`,
  `imed_has` e o gatilho de auditoria (3.1); a regra de justificativa (4.2-f) não muda: a central não abre dado de paciente
  (só mostra as leituras somadas, com o código do motivo). Fora do "básico" (ficam para as fases próprias): saúde da
  integração e eventos de sincronização (6.2), "próximo horário por unidade" (5.1), "baixa utilização" (falta o X% da
  decisão 25), resolver conflito pela central (o painel da clínica já faz, com o paciente).
  Decisões tomadas pela recomendação (o dono pode mudar): **4.4-a** o `gestao.html` continua só admin (as funções já aceitam
  os papéis; abrir as telas para a equipe é outra etapa, junto com a decisão 21); **4.4-b** na auditoria, quem agiu aparece
  pelo papel e pelo código curto da conta (8 caracteres), sem e-mail (o e-mail só na aba Equipe, da própria equipe do IMED);
  **4.4-c** feriado: só nacional pela central, com fonte obrigatória (decisão 14), de hoje até o fim do ano que vem depois do
  próximo (ano digitado errado esticaria o prazo de venda de todas as clínicas) e com conferência antes (clínicas que
  fecham e agendamentos atingidos); nenhum feriado foi lançado pelo Claude; **4.4-d** parâmetro global: só os que o código
  lê (hoje `agenda.limite_futuros_por_telefone`, padrão 3, aceito de 1 a 20), mudar é só do admin (decisão 25 segue aberta:
  a tabela continua vazia); **4.4-e** papéis: só o admin dá e tira (arquitetura §11), para conta existente com e-mail
  confirmado; ninguém foi cadastrado (decisão 21 aberta); **4.4-f** conflitos na central são só para acompanhar.

**Fase 5 — App do paciente**
- **5.1 Marcar no motor novo (libera a venda online).** `local.js`, `perto.js`, `inicio.js`, `geo-core.js` (fuso da unidade;
  id e código uma vez por intenção, salvos antes do envio; id novo depois de `slot_taken`; `isSlotTaken` separando chave
  primária de 23P01), `conta.js`, `confianca.js` (`.ics` em UTC com a duração real), `local.html`; selo honesto por modalidade
  (no lugar de "agenda confirmada pela clínica"); "próximo horário livre". Migração `<ts>_agenda_app` (`agenda_next_free`,
  limites, tempo-limite por função; `agenda-reservar` + `agenda_book_srv` se o Turnstile existir). Testes: `e2e-local`,
  `e2e-perto`, `e2e-conta`, `e2e-inicio`, `geo-core.test`, desempenho. Depois de publicado e conferido: clínica piloto
  (decisão 24), em UTC−3.
  **Feita em 11/11/2026 no ramo `ci/agenda-5-1` (por cima da 4.3 e da 4.4; não publicada; nada aplicado na produção):**
  - Paciente: na página do local, clínica parceira com a venda online ligada (`agenda_public_info.online`) numa
    modalidade que confirma na hora (nativa ou manual) mostra "Escolha o horário": exame (procedimento da clínica, com
    preço ou "preço sob consulta" e a duração), preparo e jejum informados pela clínica, "Próximo horário livre", 14 dias
    em abas (setas do teclado), horários no fuso da unidade e "Os horários estão no horário de Brasília, o da clínica";
    ao escolher, os dados (sem observações livres), as regras reais da clínica (pagamento no local; até quando cancelar)
    e "Confirmar agendamento" → `agenda_book` → "Agendamento confirmado para …" com o protocolo, `.ics` em UTC com o fim
    real e o resumo em Meus pedidos/conta (com o fuso e o fim). Horário pego por outra pessoa: aviso, horários de novo,
    dados mantidos, id novo. Na busca: selo da modalidade e "Próximo horário livre" no cartão e na ficha. Qualquer outra
    clínica (e qualquer falha) continua no pedido de antes: **nada muda para o paciente até a clínica piloto ser ligada**.
  - Banco: migração provisória `20261111120000_agenda_app` (só aditiva: `agenda_next_free` + tempo-limite de 2 s nas 4
    leituras públicas que não tinham), volta e pgTAP `410_app.sql` (38 testes, inclusive o contrato da marcação: replay
    com o mesmo id e código, dois pacientes no mesmo horário → 1 confirmado e o outro com `slot_taken` e outros
    horários, id novo depois de `slot_taken`); desempenho com 10 clínicas (9 só com buracos menores que o exame).
  - Testes: `geo-core.test` (fuso, intenção, argumentos, respostas, `.ics`, selo), e2e-local (relógio fixo: escolhe e
    sai confirmado; dois pacientes no mesmo horário; resposta perdida e "Tentar de novo" com o mesmo id; 409/23P01,
    limite e venda desligada; Manaus; sem venda), e2e-perto, e2e-inicio, e2e-conta, e2e-a11y (estados confirmado e
    ocupado, teclado e leitor de tela), e2e-velocidade.
  - Decisões tomadas pela recomendação (o dono pode mudar): decisão 1 (sem pagamento online, "Confirmar" reserva e
    confirma de uma vez); 4 (pagamento no local); 6 (manual só com o compromisso, que `agenda_mode_set` já exige); 13
    (preço por procedimento ou "sob consulta"); 15 (fuso confirmado pela clínica; a tela mostra o da unidade); 22 (sem
    observações livres na marcação direta); R2-18 (nenhum selo diz "tempo real"). Novas: **5.1-a** agenda externa fica
    no pedido até a integração (fase 6); **5.1-b** "próximo horário livre" só na busca e na página do local (a página
    inicial não, para não pesar); **5.1-c** a intenção vale 24 h no aparelho; **5.1-d** sem função para ligar a venda: a
    piloto é ligada pela equipe com UPDATE registrado (`imed.origin = 'sql'` e motivo) e a aprovação do dono; **5.1-e**
    `agenda_book` fica com o limite de tempo do papel (3 s/8 s, que a prova de 300 POST já usa); **5.1-f** remarcar pelo
    site ainda não (o paciente cancela em Meus pedidos e marca outro; `agenda_reschedule` já existe para a 5.x).
  - Ficaram de fora: Turnstile (`agenda-reservar` + `agenda_book_srv`, decisão 10); limites por IP (decisões 20 e 25);
    remarcar pelo site; avisos (5.3). Pendentes do dono: 10 (Turnstile antes de vender online em clínica real, como
    recomendado, ou piloto sem ele só com o limite por telefone), 24 (clínica piloto), 2 (prazo de remarcar),
    20/25 (limites).
  - Publicar, nesta ordem: 4.3 → 4.4 → feriados nacionais lançados pela central (sem eles o motor não oferece horário)
    → 5.1 (renomear `agenda_app` e a volta com a versão que o conector gravar, depois das da 4.3/4.4; a parte 2 da 4.2
    continua com versão posterior à última aplicada; `VERSION` do `sw.js`). Guardas do `banco.yml`: "Provisória antes
    da produção" reprova toda migração com a marca `NOME PROVISÓRIO` no cabeçalho e versão até `ULTIMA_NA_PRODUCAO`
    (ao aplicar uma, renomear as outras provisórias para depois dela e tirar a marca da aplicada); "Partes fora de
    ordem" só confere a parte N contra a parte N−1 do mesmo nome.
    → clínica piloto (UTC−3, com a configuração conferida no painel e a venda ligada pela equipe).
- **5.2 Vários exames.** Escolher até 4 procedimentos e o dia → opções com menor espera → confirmar o pacote (tudo ou nada).
  Testes: e2e + teste 6 pela REST.
- **5.3 Avisos.** `<ts>_agenda_avisos` (`notifications`, `notification_rules`, `outbox` com FIFO), Edge Function `agenda-saida`
  (+ `lib.test.ts`), cron `imed-agenda-saida`; canais `sem_canal` até o dono liberar; Web Push opcional. Testes: Deno,
  `510_avisos.sql`.
- **5.4 Pagamento (só depois da decisão 4).** `<ts>_agenda_pagamentos` (`payments`, `payment_events`, precedência),
  `pagamentos-webhook/<provedor>`, fluxo "Ir para o pagamento" (reserva `awaiting_payment` com dados) no `local.js`; textos de
  termos, privacidade e contato. Testes: 8 (pgTAP + paralelo), e2e.

**Fase 6 — Sincronização externa**
- **6.1 API.** `<ts>_agenda_integracao` (integrações, chaves em hash, `external_refs` com lápide, `sync_events`,
  `snapshot_seq`, autoridade por recurso, `occupancy.external_ref_id`, saúde, reconciliação), Edge Function `agenda-api`
  (`index.ts`, `lib.ts`, `lib.test.ts`), aba "Integração" no painel (chave mostrada uma vez, saúde, eventos). Teste: 10.
- **6.2 Central:** monitor de integrações, eventos de sincronização e novas tentativas.
- **6.3 Conectores homologados:** só com documentação, contrato e credenciais reais do fornecedor (dono).

**Fase 7 — Validação**
Os 10 testes verdes no CI; carga (300+ em paralelo) e caos (queda de conexão e de backend); `get_advisors` sem alerta novo;
pacote LGPD para o advogado (RIPD, retenção, contrato de operador, Marco Civil); roteiro de operação (resolver conflitos,
alertas); memória do projeto atualizada (`memory/projects/imed-agenda-*.md`); piloto com uma clínica real. Nada é declarado
pronto sem esses testes.

**Produto mínimo (R2-17):** 3.0 → 3.3 + 4.1 → 4.2 + 5.1 já entregam o pedido inteiro para clínicas na modalidade nativa ou
manual (configurar, ver horários, marcar pelo app e pelo balcão, cancelar, remarcar, bloquear, histórico). Pacote, avisos,
pagamento e integração vêm depois.

---

## 15. Decisões que dependem do dono

Cada item traz a recomendação e o que vale se o dono não responder.

1. **Momento da reserva.** Recomendo: sem pagamento online, "Confirmar" reserva e confirma de uma vez; reserva temporária
   (10 min) só com pagamento online ou integração. (Alternativa: segurar o horário antes do formulário — só com Turnstile.)
2. **Cancelar e remarcar pelo paciente.** Cancelar até o início (como hoje); remarcar até 2 h antes; sem multa.
3. **Falta.** Tolerância de 15 min; sem consequência por enquanto.
4. **Pagamento online.** Se o IMED vai cobrar (muda as promessas públicas), qual gateway, o modelo (intermediação ou divisão) e
   a regra de reembolso. Até decidir: pagamento no local.
5. **Pagamento depois de expirar.** Confirmar sozinho se o horário ainda estiver livre e o paciente não tiver outro agendamento
   no mesmo horário; senão, fila de resolução (remarcar ou reembolsar).
6. **Modalidade manual.** Venda online com confirmação na hora só com o compromisso da clínica; sem compromisso, só pedido.
7. **Integrações externas.** Quais softwares homologar, contratos e custos.
8. **Canais de aviso.** Resend (com domínio), provedor de WhatsApp e modelos, Web Push. Nome do exame e preparo desligados.
9. **Plano do Supabase.** Free agora; Pro antes de operar comercialmente (backup, sem pausa, conexões). Sem custo: cópia diária
   criptografada pelo GitHub.
10. **Proteção contra robôs.** Turnstile (conta Cloudflare grátis) antes de vender online em clínica real.
11. **Prazos de retenção** da tabela do §12.
12. **Jurídico.** Controlador e operador, contrato com as clínicas, encarregado, RIPD e Marco Civil (art. 15) × hash de IP.
13. **Preço.** Por procedimento, com "a partir de" na busca.
14. **Feriados.** Nacionais lançados pela equipe com fonte oficial; estaduais e municipais conferidos pela clínica; não vender
    além da data conferida; padrão "fecha", com exceção por unidade.
15. **Fuso do oeste do AM.** A clínica confirma na ativação (recomendado) ou lista oficial.
16. **Redes com várias unidades.** Criar `clinic_orgs`? Padrão: não; cada unidade entra pela reivindicação do CNES.
17. **MFA.** Obrigatório para dono e gestor da clínica.
18. **Domínio próprio, Auth e SMTP.** Bloqueia a entrada de funcionários (fase 0.2).
19. **Chaves do Supabase — até 31/12/2026** (fase 0.1). A chave nova já existe; a troca no código é do Claude. Ao dono fica só
    desligar as chaves antigas no painel, depois de tudo conferido.
20. **IP com hash** para os limites contra abuso, e por quanto tempo guardar.
21. **Equipe do IMED.** Quem recebe cada papel (fora do `admin_emails`).
22. **Observações livres.** Trocar por campos fechados + nota curta.
23. **Concluir sem "Chegou".** Permitir no fluxo simples, só depois do início (recomendado).
24. **Clínica piloto.**
25. **Limites:** saúde da integração (5 e 15 min) e contra abuso (por IP, telefone e clínica).
26. **Editor simples de horários.** Aposentar e trocar pela configuração rápida (recomendado; nenhuma clínica usa hoje).

---

## 16. O que fica fora desta primeira versão e por quê

- **Segurar o horário antes do formulário (reserva anônima):** é a principal porta para robôs lotarem a agenda; só com
  Turnstile e decisão do dono.
- **Pacote parcial com aceite:** o pedido não exige; tudo ou nada é mais simples e seguro (o paciente marca separado).
- **Reacomodar vagas automaticamente** (para evitar recusa falsa rara em recurso compartilhado): ganho pequeno, risco alto.
- **Configuração implícita a partir do editor antigo:** vende ao mesmo tempo exames do mesmo aparelho (§2.4).
- **Conectores prontos de softwares específicos:** nenhum é presumido; dependem de documentação e contrato reais.
- **SMS:** custo e baixo ganho frente a e-mail/WhatsApp; a estrutura aceita depois.
- **Pagamento online e qualquer "pago":** até a decisão 4.
- **Organização de redes (`clinic_orgs`):** até a decisão 16; unidades já funcionam separadas.
- **Agendamento recorrente, lista de espera de horários, encaixe acima da capacidade (overbooking):** fora do pedido; mudariam a
  regra fundamental.
- **Teleconsulta na mesma agenda:** a teleconsulta tem fila própria e depende da inscrição no CREMESP.
- **Feriados municipais automáticos:** sem fonte oficial única; a clínica confere.
- **Painel funcionando sem internet:** a autoridade é o servidor; sem conexão o painel mostra a faixa "sem conexão".
- **Cache do "próximo horário livre":** só se o p95 do CI pedir.
- **Tempo-limite de sessão no servidor:** recurso do plano Pro.

---

**Arquivos lidos nesta etapa final (só leitura):** `CLAUDE.md`, `memory/context/arquitetura.md`, o pedido do dono, a
migração `20261030034539_agenda` (inteira) e trechos de `20261030143738_confianca` (gatilho do pedido),
`20261030021434_fila_importacao`, `20261030092931_teleconsulta` e `20261030121427_tele_documentos`; trechos de
`assets/js/geo-core.js`, `local.js`, `perto.js`, `painel.js` e `conta.js`. As revisões leram também `marketplace`,
`seguranca`, `gestao`, `painel_medico`, `auth.js`, `config.js`, `clinica.js` e `clinicas-proximas/index.ts`.

**Conferido no banco (só leitura, 30–31/10/2026):** contagens (clínicas, membros, faixas, bloqueios, pedidos, contas no Auth);
`pg_default_acl`; grants e policies de `appointment_requests`, `clinics`, `clinic_schedules`, `clinic_blocks`,
`clinic_members`, `clinic_exams`; colunas, CHECKs, índices e gatilhos de `appointment_requests`; corpo de `is_imed_admin`,
`is_clinic_member`, `set_request_status`, `cancel_request`, `request_status`, `realtime.send` e `realtime.topic`;
`has_schema_privilege` em `private`; funções e policies que usam `is_imed_admin()`; funções que fazem UPDATE/DELETE em
`appointment_requests` (só `set_request_status` e `cancel_request`); `cron.job`; `cron.job_run_details`;
`vault.secrets`; partições de `realtime.messages`; `deadlock_timeout`, `max_locks_per_transaction`, `max_connections`, versão.
