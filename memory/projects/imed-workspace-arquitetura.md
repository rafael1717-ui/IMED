# iMed Medical Workspace: arquitetura (fase 1, análise e plano)

> Projeto IMED, 31/10/2026. Atende à seção "Ao iniciar, apresente" do pedido do dono (`/home/user/imed-trabalho/workspace-pedido.md`), módulos 1 a 16.
> Versão final: proposta + correções de duas revisões (clínica/regulatória e dados/LGPD/viabilidade). O §12 diz o que entrou e o que foi descartado.
> Para chegar aqui só li arquivos e rodei SELECT de contagens e do catálogo no banco `pyoqiecupxhdzigjudyd`, sem dado de paciente. Este é o único arquivo criado.
> Referência para qualquer marcação de exame: `memory/projects/imed-agenda-arquitetura.md` (iMed Agenda). Não existe agenda paralela.

**Marcações**
- **[NORMA]**: lei ou norma conferida na pesquisa de 31/10/2026, com fonte.
- **[NORMA, a confirmar]**: regra encontrada, texto oficial, artigo ou vigência não conferidos.
- **[RECOMENDAÇÃO]**: escolha técnica ou de produto; não é exigência legal.
- **[DECISÃO DO DONO]**: ver §10, sempre com o que vale sem resposta.

---

## 1. Em uma página

1. **Nada é reconstruído.** A teleconsulta continua com o mesmo vídeo, fila, plano B e as 39 funções `tele_*`. O `medico.html` evolui para o Workspace com módulos JS novos; os `<video>` não mudam de lugar (layout só por CSS).
2. **Onde ficam os dados.** `teleconsultations` = atendimento; `doctors` = profissional; `tele_documents` + `tele_document_files` = documento formal com PDF. O clínico novo fica no schema `prontuario` (e referências no `catalogo`), fechado para a API e para o `service_role`; tudo por funções `SECURITY DEFINER`, como no schema `agenda`.
   - **Limite honesto:** quem entra no banco como `postgres` (editor SQL do painel, conector do claude.ai, pg_cron, membros da organização Supabase) lê sem passar pela trilha. Por isso: regra operacional de não consultar tabelas clínicas pelo conector depois do 1º dado real, âncora de hash externa **obrigatória** e registro disso no RIPD (§3.6).
3. **Paciente.** Hoje não existe "paciente" no banco. Entram `prontuario.pacientes` e `prontuario.paciente_contas`. Vínculos conservadores: nunca pelo celular; CPF só vale conferido pelo médico; ligar a um cadastro antigo exige **confirmação do próprio paciente**; a pesquisa nunca revela se um CPF existe; unir cadastros é ato humano registrado.
4. **Nada de histórico antes do termo novo.** O termo atual diz que os dados são "usados só para este atendimento" (`termo-teleconsulta.html:93`). Nenhuma ligação longitudinal antes do **TCLE v3** aceito naquela consulta; consultas com o termo v2 nunca entram no histórico (hoje são 0).
5. **Registro clínico** (anamnese, exame físico com quem mediu e como, CID-10, conduta, SOAP ou texto livre): rascunho salvo no servidor sozinho; ao finalizar, o registro e **todas as linhas filhas** (medidas, diagnósticos) ficam imutáveis e entram no hash encadeado; correção = adendo identificado. Até haver assinatura ICP-Brasil do registro, a tela diz "registro não assinado digitalmente".
6. **Receita e pedido de exames** são rascunhos estruturados que, ao emitir, geram o mesmo `tele_documents` (PDF, código, QR, conferência pública, travas). Só a receita simples sai; especiais bloqueadas. **O servidor confere cada item** contra as listas oficiais e recusa antibiótico/controlado em receita simples (não basta o alerta da tela). Pedido de exames único, com catálogo; CID no pedido só com autorização expressa do paciente (norma CFM).
7. **"Ver clínicas disponíveis"** usa a busca de hoje e, quando prontas, as funções do iMed Agenda (`agenda_slots`, `agenda_next_free`, `agenda_book`, pacote). A clínica nunca recebe indicação, CID, PDF nem a origem "teleconsulta".
8. **Assinatura.** Sem custo: o servidor passa a conferir de verdade o PDF assinado fora do site (cadeia ICP-Brasil, revogação lida de verdade, CPF do médico, conteúdo igual ao emitido). Com contrato de PSC: assinar sem sair da consulta. Nunca imagem de assinatura nem chave privada no IMED.
9. **"Minha Saúde"**: página nova do paciente, com reforço de sessão; resultados no Storage privado; médico só vê com autorização ativa do paciente, e o texto avisa que o médico **não acompanha em tempo real**.
10. **IA e alertas clínicos**: só preparados, sem regra inventada.
11. **O que trava o uso real:** CNPJ, CREMESP com diretor técnico, plano pago com backup **e** arquivo de longo prazo, TCLE v3 e privacidade revisados por advogado, RIPD, conferência do CRM (webservice CFM ou rotina manual de 3 meses aceita como pendência), contrato com PSC (opcional). **Todo o produto mínimo roda só em homologação, sem dado clínico real**, até esses itens.

---

## 2. Diagnóstico da arquitetura atual

### 2.1 Plataforma

| Item | Hoje |
|---|---|
| Framework | Site estático (HTML, CSS, módulos ES sem build) no GitHub Pages. `sw.js` `VERSION 'imed-v21'`. |
| Banco | Supabase São Paulo, plano Free, PostgreSQL 17.11, 54 MB, 20 migrações iguais às da pasta (última `20261031034327_agenda_preparo`). |
| Extensões | Instaladas: pg_cron, pg_net, pgcrypto, PostGIS, Vault, uuid-ossp, pg_stat_statements. Disponíveis: `pg_trgm`, `unaccent`, `btree_gist`, `pg_jsonschema`, `pgsodium`. |
| Autenticação | Link mágico pela REST (`assets/js/auth.js`), sem supabase-js. Sem senha nem MFA (0 fatores). |
| Teleconsulta | WebRTC direto; sinalização pelo banco por consulta periódica; plano B por telefone e mensagens. |
| Médicos | `doctors` + `doctor_checks`; aprovação manual, válida 12 meses. |
| Pacientes | Não existem como entidade; identificação repetida em cada `teleconsultations` e `appointment_requests`. |
| Registro | `teleconsultations.notes`, texto livre gravado só ao encerrar; adendo colado no texto até 24 h. |
| Documentos | 7 tipos em `tele_documents` (PDF pdf-lib, QR, código); PDF assinado em `tele_document_files`; gatilhos impedem alterar/apagar. |
| Integrações | Edge Functions `clinicas-proximas` e `importar-clinicas`; STUN público. Nenhum PSC, e-mail, SNCR ou CFM. |
| Permissões | Tabelas da teleconsulta com RLS, acesso por funções `tele_*` (`search_path=''`). **Mas o `service_role` tem hoje SELECT/INSERT/UPDATE/DELETE/TRUNCATE em `teleconsultations` e EXECUTE nas 39 `tele_*`** (permissões automáticas do schema `public`). O conector roda como `postgres` com BYPASSRLS. |
| Testes | 68 unidade da teleconsulta; e2e com banco simulado (e2e-tele 27, e2e-tele-docs 11, e2e-medicos 16, e2e-conta 15…); `banco.yml` com pgTAP em Postgres real. |

### 2.2 Contagens em produção (31/10/2026, só números)

| Objeto | Linhas |
|---|---|
| Médicos, teleconsultas, documentos, PDFs | 0 cada |
| Contas no Auth | 1 |
| Admin vinculado | 0 |
| Buckets do Storage | 0 |
| Clínicas | 12, todas de demonstração |
| Pedidos de agendamento | 1 |
| Schema `agenda` | ainda não existe |

Consequências: remodelar sem migrar dados; o risco está no código no ar e nos testes que fixam o contrato; ninguém aprova médico até a conta do admin existir.

### 2.3 iMed Agenda

- Fase 3.1 escrita e no CI, ramo `ci/agenda-3-1` (`/home/user/imed-trabalho/wt-agenda/supabase/migrations/20261031100000_agenda_base.sql`, 1.481 linhas), **não aplicada**.
- Traz schema `agenda` fechado, `agenda.procedures` (9 categorias), `agenda.occupancy` com EXCLUDE, `has_clinic_perm`, `imed_has`, `private.imed_staff`, `imed.origin`, `private.agenda_trail_guard`.
- O Workspace reusa padrões e funções; não toca em `appointment_requests` nem grava em `agenda.*`.

### 2.4 Modo escuro e claro

- Outra frente: ramo `ci/tema` (`/home/user/imed-trabalho/wt-tema`): `assets/css/tema.css`, `assets/js/tema.js`, `tests/tema.test.mjs`. Automático/Claro/Escuro; impressão e PDF sempre claros. `tele.css` tem 143 cores fixas (conversão é daquela frente).
- O Workspace nasce só com variáveis de tema; `.td-sheet` continua branca.

### 2.5 Lacunas frente ao pedido

Sem histórico por paciente; rascunho se perde ao recarregar (critério 4 falha hoje); sem CID estruturado, catálogo de medicamentos, TUSS/SIGTAP, resultados, Minha Saúde, 3 colunas, abas no celular, conferência real de assinatura; sem trilha de escrita; sem MFA; `service_role` com acesso total; sem backup; sem criptografia de coluna; sem conferência automática do CRM.

---

## 3. Componentes existentes reutilizados

| Componente | Como entra | Muda? |
|---|---|---|
| `medico.html` + `medico.js` | Página e motor da consulta; Workspace em módulos carregados ao abrir a consulta | Só layout (CSS) e troca dos quadros de exames/registro. Oferta/resposta do vídeo não muda. `medico.js` não cresce. |
| `teleconsulta.html` + `teleconsulta.js` | Paciente igual; ganha "Guardar no Minha Saúde" | Pouco |
| `tele-core.js` | Catálogo de exames vira carga inicial do banco (mesmos `id`); `fold` normaliza buscas; `createPoller` | Catálogo JS fica de reserva até a 4.1 |
| `tele-docs.js` | Motor único dos documentos, no navegador e no servidor (mesmo arquivo) | Ganha campos e tipo `personalizado` |
| `documento.html` + `tele_doc_verify` | Conferência pública; linha "assinatura conferida pelo IMED" quando houver | Pouco |
| `doctors`, `doctor_checks` | Profissional e conferência | CPF vai para tabela privada `private.doctor_cpf`, **não** coluna em `doctors` |
| `teleconsultations` | Atendimento | + `patient_id`, `requested_by_user`, `shares_health_summary`, `tcle_versao`; `notes` só legado |
| `tele_documents`, `tele_document_files`, `tele_doc_guard` | Documento formal, imutável | CHECK de `kind` + `personalizado` |
| `tele_record_changes`, `tele_access_log`, `tele_record_readers` | Legado; `tele_record_readers` continua sendo a lista de leitores da equipe | Trilhas novas no `prontuario` |
| `auth.js` | Login de médico e paciente | MFA TOTP, reforço de sessão, evento `imed:token` (já planejado pela agenda) |
| `conta.html` + `conta.js` | Aba "Meus agendamentos" do Minha Saúde (módulo comum) | Pouco |
| `perto.html`, `perto.js`, `local.js`, `exames-nomes.js` | Marketplace | Lê o exame escolhido sem pô-lo na URL |
| iMed Agenda | Única agenda e única fila de avisos | Só a tabela de configuração `agenda.procedure_exams`, combinada com aquele projeto |
| Padrões de UI (`.tl-card`, `.btn`, `.fld`, `.tl-confirm`, `.tl-chip`, abas com setas, `.td-sheet`, `esc()`) | Base dos componentes novos | Não |
| `scripts/aplicar-rodape.mjs`, `fontes.mjs`, `aplicar-tema.mjs` | Aplicados às páginas novas | Não |
| CI (`banco.yml`, `000_catalogo.sql`, `supabase/volta/`, impressão digital) | Regras de toda migração nova | `000_catalogo.sql` passa a conferir também o `service_role` |

Fora de propósito: supabase-js, frameworks de interface, pdf.js, integrações não oficiais (bulário de terceiros, raspagem).

---

## 4. Estrutura do prontuário

### 4.1 Princípios

- **[RECOMENDAÇÃO]** Schemas `prontuario` (clínico) e `catalogo` (referência). `revoke all … from public, anon, authenticated, service_role`; RLS ligada sem policy.
- Funções `public.ws_*` (médico), `public.saude_*` (paciente), `public.cat_*` (catálogos), `public.ws_srv_*` (só servidor), internas `private.ws_*`. Todas `SECURITY DEFINER`, `search_path=''`, e **em cada uma: `revoke execute from public, anon, authenticated, service_role` e depois grant explícito** (toda função nasce executável por PUBLIC). Linha no `000_catalogo.sql`, que confere também o `service_role`.
- **Fechar o `service_role` nas tabelas existentes** (`teleconsultations`, `tele_messages`, `tele_documents`, `tele_document_files`, `tele_record_*`, `tele_access_log`, `doctors`, `doctor_checks`), em **migração própria**, com pgTAP provando que pg_cron, `admin_gestao` e `tele_painel_medico` continuam funcionando.
- **Quem fica fora da trilha (declarado):** o papel `postgres` e quem o usa (painel SQL, conector Supabase do claude.ai, pg_cron, membros da organização). Medidas:
  - regra operacional: depois do 1º dado real, **nenhum SELECT nas tabelas do `prontuario` pelo conector**; só contagens por funções próprias (o conector é acesso de operador e possível transferência internacional, LGPD art. 33 **[NORMA, a reconferir]**);
  - estudar um papel só de leitura de catálogo para o conector;
  - pgaudit (logs de auditoria do Postgres) no plano pago;
  - âncora de hash diária fora do banco (§4.5), **obrigatória**;
  - tudo isso no RIPD.
- Marca de origem `imed.origin` em toda escrita (`private.agenda_origin()`), **nunca exposta à clínica**.
- Advisory lock de duas chaves: 7201 (prontuário do paciente) e 7202 (documento). Não colide com teleconsulta nem agenda (7101/7102).
- Datas em UTC; telas e PDFs na hora de São Paulo.
- Limite de chamadas por usuário nas funções `ws_*`/`saude_*` (raspagem e força bruta de vínculo), em tabela de contadores por janela.

### 4.2 Identidade do paciente

```sql
create table prontuario.pacientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 3 and 120),
  nome_social text check (char_length(nome_social) between 2 and 120),
  nascimento date not null,
  sexo_registro text not null default 'nao_informado'
    check (sexo_registro in ('feminino','masculino','ignorado','nao_informado')),   -- D18
  cpf text check (cpf ~ '^[0-9]{11}$'),           -- em claro só para impressão
  cpf_hmac text,                                  -- índice e busca; chave no Vault
  sem_cpf boolean not null default false,
  identidade text not null check (identidade in ('declarada','conferida')),
  conferida_em timestamptz, conferida_por uuid references public.doctors(id),
  conferida_na_consulta uuid references public.teleconsultations(id),
  celular text, email text, contato_emergencia jsonb,
  unificado_em uuid references prontuario.pacientes(id),
  versao integer not null default 1, criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  check (identidade = 'declarada' or (conferida_em is not null and conferida_por is not null)),
  check (not (sem_cpf and cpf is not null)));
create unique index on prontuario.pacientes (cpf_hmac) where cpf_hmac is not null and unificado_em is null;
-- Mudança de identificação: linha anterior em prontuario.paciente_versoes (gatilho), com autor e origem.

create table prontuario.paciente_contas (
  paciente_id uuid not null references prontuario.pacientes(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  papel text not null check (papel in ('titular','responsavel_legal')),
  alcance text not null check (alcance in ('prontuario','consulta')),    -- 'consulta' = só documentos daquela consulta
  consulta_id uuid references public.teleconsultations(id),
  prova text not null check (prova in ('medico_na_consulta','confirmacao_do_paciente','equipe_imed','codigo_unico_consulta')),
  vinculado_em timestamptz not null default now(), revogado_em timestamptz, revogado_por uuid, motivo_revogacao text,
  primary key (paciente_id, user_id),
  check ((alcance = 'consulta') = (consulta_id is not null)));

alter table public.teleconsultations
  add column patient_id uuid references prontuario.pacientes(id),
  add column requested_by_user uuid,
  add column shares_health_summary boolean not null default false,
  add column tcle_versao text;                      -- só 'v3' (ou maior) entra no histórico
```

Criptografia em repouso: disco e backups do Supabase com AES-256; Storage em S3 criptografado. **Não há** criptografia de coluna: `pgsodium`/TCE está obsoleto e a chave no Vault é legível pelo `postgres`, então não protegeria do operador. Medida adotada: CPF com HMAC para índice/busca.

**Regras de vínculo [RECOMENDAÇÃO]**

- **R0. Termo.** Sem `tcle_versao` v3 aceito naquela consulta, ela não é ligada a nenhum paciente com histórico. Teste pgTAP.
- **R1. Nunca pelo celular nem pelo nome.**
- **R2. Pedido sem conta.** A consulta nasce sem paciente. Ao conferir documento com foto e CPF, o médico cria ou atualiza a identidade **desta consulta**. A busca por CPF é interna e **não responde ao médico se o CPF existe**. Se houver cadastro com o mesmo CPF e nascimento, o sistema pede **confirmação do próprio paciente** (aviso no Minha Saúde da conta já ligada, ou código enviado ao contato que já está no cadastro). Até confirmar, o médico vê só a consulta atual. Divergência vai para a equipe. Toda tentativa entra na trilha, com limite por médico. Sem CPF: cadastro novo, nunca une sozinho.
- **R3. Pedido logado.** "Para mim" ou "para meu dependente". Nasce `declarada`; vira `conferida` quando o médico confere o documento. Menor sem responsável segue a regra que já existe (`patient_agrees`). Pedido por terceiro (o termo já prevê) **não** gera vínculo de titular para quem pediu.
- **R4. Conta → pessoa.** Minha Saúde só mostra com vínculo provado:
  - (a) **titular do prontuário**: o médico confirma na consulta "este login é do próprio paciente", ou a equipe com documento e motivo;
  - (b) **só aquela consulta**: código de uso único mostrado ao paciente durante a consulta, usado por conta logada; alcance `consulta` (documentos daquela consulta), nunca o prontuário inteiro;
  - toda nova ligação gera aviso a todas as contas já ligadas; o titular vê e revoga (`saude_vinculos`, `saude_vinculo_revogar`).
- **R5. Unir duplicados**: só equipe médica (`tele_record_readers`), com motivo; por `unificado_em`, sem mover dados, reversível.
- **R6. Menores.** `responsavel_legal` só com prova `equipe_imed` (documento de responsabilidade). Perde o vínculo sozinho aos 18 anos; daí em diante, o que via deixa de ser visível e o novo adulto é avisado e pode ver a lista de acessos passados. Entre 12 e 17, notas clínicas não aparecem ao responsável sem decisão do médico na consulta (Código de Ética Médica, art. 74 **[NORMA, a confirmar com o advogado]**; LGPD art. 14 **[NORMA, a reconferir]**). O adolescente pode pedir à equipe revisão do vínculo.

### 4.3 Modelo de dados do registro clínico

| Entidade do pedido | Onde | Tipo |
|---|---|---|
| MedicalProfessional | `doctors` + `doctor_checks` + `private.doctor_cpf` | Fica + tabela privada nova |
| PatientMedicalRecord | `prontuario.pacientes`, `paciente_versoes`, `paciente_contas` | Novas |
| MedicalEncounter | `teleconsultations` | Fica + 4 colunas |
| ClinicalNote | `prontuario.evolucoes` (+ `medidas`) | Novas |
| MedicalHistory, Allergy, CurrentMedication | `prontuario.problemas`, `alergias`, `medicamentos_uso` | Novas |
| Diagnosis | `prontuario.diagnosticos` + `catalogo.cid10` | Novas |
| Prescription / Item | `prontuario.prescricoes`, `prescricao_itens`, `prescricoes_externas`; documento em `tele_documents` 'receita' | Novas |
| MedicationCatalog | `catalogo.med_*` | Novas |
| ExamCatalog | `catalogo.exames` | Nova |
| ExamOrder / Item | `prontuario.pedidos_exame`, `pedido_exame_itens`, `pedido_item_agendamentos`; documento 'exames' | Novas |
| ExamResult | `prontuario.resultados` + Storage privado | Novas |
| MedicalDocument | `tele_documents` (+ `prontuario.documento_pdfs`) | Fica + `personalizado` |
| DocumentTemplate | `prontuario.modelos` | Nova |
| DigitalSignature | `prontuario.assinaturas` (+ `tele_document_files`) | Nova |
| AuditLog | `prontuario.trilha_acesso`, `trilha_escrita` | Novas |
| PatientConsent, Access | `prontuario.autorizacoes`; leitores da equipe em `tele_record_readers` | Nova |
| Retorno | `prontuario.retornos` | Nova |

```sql
create table prontuario.evolucoes (
  id uuid primary key default gen_random_uuid(),
  teleconsulta_id uuid not null references public.teleconsultations(id) on delete restrict,
  paciente_id uuid references prontuario.pacientes(id),
  medico_id uuid not null references public.doctors(id) on delete restrict,
  tipo text not null check (tipo in ('evolucao','adendo')),
  adendo_de uuid references prontuario.evolucoes(id),
  modelo_id uuid, modelo_versao integer,
  situacao text not null check (situacao in ('rascunho','finalizada','encerrada_sem_finalizar')),
  conteudo jsonb not null,
  versao integer not null default 1,
  salvo_em timestamptz,
  finalizada_em timestamptz,
  encerrada_em timestamptz,                    -- fechamento automático, sem finalizar em nome do médico
  hash_sha256 text, hash_anterior text,
  assinatura_id uuid,
  criado_em timestamptz not null default now(),
  check ((tipo = 'adendo') = (adendo_de is not null)),
  check (situacao <> 'finalizada' or (finalizada_em is not null and hash_sha256 is not null and encerrada_em is null)),
  check (situacao <> 'encerrada_sem_finalizar' or (encerrada_em is not null and finalizada_em is null)),
  check (situacao <> 'rascunho' or (finalizada_em is null and encerrada_em is null)));
create unique index on prontuario.evolucoes (teleconsulta_id) where tipo = 'evolucao';
```

O encerrado sem finalizar é congelado pelo `ws_guard` e entra na cadeia de hash **marcado como não finalizado** (preserva prova de integridade sem fingir finalização).

`conteudo` (JSON de chaves fixas, tamanhos limitados, validado por `private.ws_conteudo_ok()`): `queixa`, `hda`, `antecedentes`, `familiares`, `habitos`, `revisao_sistemas`, `exame_fisico_texto`, `raciocinio`, `soap {s,o,a,p}`, `plano`, `texto_livre`, `nao_classificado` (o que não coube ao voltar do texto livre para SOAP; nada se perde).

```sql
create table prontuario.medidas (
  id uuid primary key default gen_random_uuid(),
  evolucao_id uuid not null references prontuario.evolucoes(id),
  paciente_id uuid references prontuario.pacientes(id),
  tipo text not null check (tipo in ('pa_sistolica','pa_diastolica','fc','fr','temperatura','spo2','peso','altura','glicemia_capilar')),
  valor numeric not null, unidade text not null,
  quem_mediu text not null check (quem_mediu in ('paciente','acompanhante','profissional','medico')),
  como_obtido text not null check (como_obtido in ('relato','estimado','aparelho_na_camera','contado_pelo_medico_no_video','integracao')),
  aparelho text, medido_em timestamptz,
  registrado_por uuid not null references public.doctors(id), registrado_em timestamptz not null default now(),
  check (como_obtido <> 'contado_pelo_medico_no_video' or tipo in ('fr')),
  check (quem_mediu <> 'medico' or como_obtido = 'contado_pelo_medico_no_video'),
  check (como_obtido not in ('aparelho_na_camera','integracao') or medido_em is not null));
```

- Nada se preenche sozinho. O IMC aparece na tela com a origem dos dois números e não é gravado como medida. Menores de 20 anos: **só o número**, sem classificação de adulto (exige percentil).
- "Aspecto geral" observado pelo médico vai no texto do exame físico, não como medida.
- `quem_mediu='profissional'` (alguém junto do paciente) fica bloqueado na tela até existir esse caso.

```sql
create table prontuario.diagnosticos (
  id uuid primary key default gen_random_uuid(),
  evolucao_id uuid not null references prontuario.evolucoes(id),
  paciente_id uuid references prontuario.pacientes(id),
  cid text references catalogo.cid10(codigo), descricao text not null,
  papel text not null check (papel in ('principal','secundario','hipotese')),
  situacao text not null check (situacao in ('suspeito','confirmado','descartado')),
  registrado_por uuid not null, registrado_em timestamptz not null default now());

-- Listas longitudinais: nunca mudam; mudar = linha nova com substitui_id. Autor e origem sempre.
create table prontuario.alergias (
  id uuid primary key default gen_random_uuid(), paciente_id uuid not null references prontuario.pacientes(id),
  substancia text not null, substancia_dcb text,
  categoria text check (categoria in ('medicamento','alimento','ambiente','outro')),
  reacao text, gravidade text check (gravidade in ('leve','moderada','grave','desconhecida')),
  situacao text not null check (situacao in ('ativa','inativa','refutada')),
  origem text not null check (origem in ('paciente','medico')),
  registrado_por_medico uuid, registrado_por_conta uuid, teleconsulta_id uuid,
  substitui_id uuid references prontuario.alergias(id), registrado_em timestamptz not null default now());
-- medicamentos_uso e problemas seguem o mesmo molde.

create table prontuario.retornos (               -- "+ Retorno": recomendação, não marcação
  id uuid primary key default gen_random_uuid(), teleconsulta_id uuid not null, paciente_id uuid,
  medico_id uuid not null, em_dias smallint check (em_dias between 1 and 365), motivo text,
  situacao text not null default 'recomendado' check (situacao in ('recomendado','feito','dispensado')),
  criado_em timestamptz not null default now());
```

"+ Retorno" registra a recomendação e aparece no Minha Saúde ("Seu médico recomendou retorno em 30 dias", com "Pedir teleconsulta"). Marcar de verdade só com a agenda do médico no motor do iMed Agenda (D14). Nada de botão que finge marcar.

A linha do tempo mostra a data da última consulta presencial **informada**, sem bloquear (regra de presencial a cada 180 dias em doença crônica, Res. CFM 2.314/2022, art. 6º **[NORMA, a confirmar]**, já citada em `medico.html:99`).

### 4.4 Quem lê e quem escreve

| Quem | O que pode |
|---|---|
| Médico aprovado da consulta (`private.tele_me` + MFA, D7) | Escreve rascunho, finaliza, adenda, prescreve, pede exames, emite documentos na própria consulta. Lê o histórico conforme D1. Sempre vê os **dados de segurança** (abaixo). |
| Outro médico aprovado | Adendo só com acesso pela D1. Nunca edita registro alheio. |
| Equipe médica (`tele_record_readers` + `imed_has('imed.prontuario.ler')`, com MFA) | Lê com justificativa em código ("quebra de vidro"), cada leitura na trilha. Escreve só: unir cadastros, cancelar documentos, vínculos com prova. |
| Paciente (vínculo R4) | Lê documentos, receitas, pedidos, resultados, orientações, resumo, **suas alergias e remédios registrados por qualquer médico**, e a lista de acessos. Escreve dados declarados, envia resultados, dá e tira autorizações, revoga vínculos. |
| Clínica | Nada do `prontuario`. Não vê a origem do agendamento. |
| `service_role` / Edge Functions | Só funções `ws_srv_*`, que conferem `auth.jwt()->>'role' = 'service_role'`. Nenhuma tabela. |
| `postgres` (operador) | Fora da trilha; regra operacional do §4.1. |

**Dados de segurança [RECOMENDAÇÃO, base a confirmar com advogado]:** alergias e remédios em uso ativos são visíveis ao médico que está atendendo, mesmo quando registrados por outro médico (tutela da saúde, LGPD art. 11, II, "f" **[NORMA, a reconferir]**), informado no TCLE v3. Se o advogado não aprovar: o médico vê ao menos "há alergia registrada por outro médico; pergunte ao paciente".

**D1. Histórico feito por outros médicos.**
- Recomendação: tutela da saúde; só o médico que está atendendo, do aceite até 24 h após o fim; TCLE v3; o paciente vê cada acesso e pode marcar consultas "não compartilhar" (o médico vê só que há registro restrito; alergias e remédios ativos continuam visíveis como dado de segurança).
- **Sem resposta:** cada médico vê só as próprias consultas com aquele paciente (com TCLE v3), mais o que o paciente levou (`shares_health_summary`), mais os dados de segurança se o advogado aprovar (senão, o aviso).

**Tabela de base legal por tratamento [RECOMENDAÇÃO, a validar com advogado]:**

| Tratamento | Base (LGPD) |
|---|---|
| Registro clínico, documentos, prescrição | Tutela da saúde (art. 11, II, "f") |
| Guarda do prontuário e trilhas | Obrigação legal/regulatória (art. 11, II, "a") |
| Histórico compartilhado entre médicos | Tutela da saúde, com transparência (D1) |
| Levar resumo de saúde, enviar pedido à clínica, mostrar resultado ao médico, transcrição por IA | Consentimento específico (art. 11, I) |
| Cópia, portabilidade, lista de acessos | Exercício de direito do titular (art. 18) |
| Segurança (trilha, `ip_hmac`, limites) | Exercício regular de direitos / prevenção à fraude (art. 11, II, "d" e "g") |

### 4.5 Imutabilidade, adendos, versões e hash

- **Rascunho:** salvo no servidor ~2 s após parar de digitar e a cada 15 s com mudança (`ws_evolucao_salvar(p_id, p_conteudo, p_versao)`); conflito → `versao_conflito`; só `sessionStorage` para o trecho não enviado; Web Locks impedem duas abas no mesmo registro.
- **Finalizar** (`ws_evolucao_finalizar`): confere obrigatórios do modelo; calcula o hash do **conteúdo canônico completo**: `conteudo` + medidas + diagnósticos da evolução, em ordem fixa (tipo, id); grava `hash_sha256` e `hash_anterior`.
- **Guarda `private.ws_guard`** (molde do `tele_doc_guard`) recusa UPDATE/DELETE/TRUNCATE em: evoluções finalizadas ou encerradas, `medidas`, `diagnosticos`, listas longitudinais, `retornos`, itens de receita e de pedido depois de emitidos, prescrições e pedidos emitidos (exceto a mudança para `cancelada` pela equipe, registrada).
- **Rascunho esquecido:** 24 h depois do fim, pg_cron fecha como `encerrada_sem_finalizar` com `encerrada_em`; nunca finaliza pelo médico.
- **Adendo:** linha nova, autor e data próprios, a qualquer tempo, finalizado e encadeado. O "[Adendo …]" em `notes` fica no legado.
- **Versões:** identificação e listas por linha nova; nada sobrescrito.
- **Âncora externa (obrigatória):** hash do fim da cadeia de cada dia gravado fora do banco (repositório **privado** ou serviço de carimbo), única defesa contra o `postgres`. `ws_integridade_conferir()` confere a cadeia.
- **Assinatura do registro:** só na fase 5.2 (CAdES). Até lá, tela e termo dizem **"registro não assinado digitalmente"**. Nenhum texto para o usuário fala em "aproxima do NGS2".
- Base: Lei 13.787/2018 (art. 6º: prazo mínimo e eliminação após 20 anos; arts. 2º e 4º tratam de digitalização de papel, usados só como referência de integridade) **[NORMA, texto lido em transcrição]**; Res. CFM 1.821/2007, art. 7º, guarda **permanente** do prontuário eletrônico **[NORMA, conferir texto consolidado; a Res. 2.218/2018 revogou só o art. 10]**; Res. CFM 2.314/2022, art. 3º, §2º, requisitos NGS2 padrão ICP-Brasil **[NORMA]**.

### 4.6 Auditoria

```sql
create table prontuario.trilha_acesso (
  id bigint generated always as identity primary key, em timestamptz not null default now(),
  user_id uuid, papel text, fn text not null, resultado text not null check (resultado in ('permitido','negado')),
  paciente_id uuid, teleconsulta_id uuid, objeto_tipo text, objeto_id uuid,
  justificativa_codigo text, sessao_id text, aal text, origem text, ip_hmac text);
create table prontuario.trilha_escrita (
  id bigint generated always as identity primary key, em timestamptz not null default now(),
  user_id uuid, papel text, fn text not null, operacao text not null, objeto_tipo text not null, objeto_id uuid not null,
  versao_antes integer, versao_depois integer, hash_antes text, hash_depois text, origem text, sessao_id text, ip_hmac text);
```

- **Acessos negados ficam registrados:** nas recusas, as funções gravam a trilha e **devolvem um código de erro sem `raise`** (o `raise` desfaria a gravação). O site trata `{erro:'forbidden'}` como hoje trata o P0001. Teste obrigatório no critério 19.
- Sem FK, só acrescentar, guarda `private.agenda_trail_guard`. A exceção de retenção só pode ser usada por uma função de descarte aprovada pelo dono e pelo advogado (hoje não existe).
- **A trilha é dado sensível** (o fato de existir consulta ou exame é dado de saúde): mesmo controle de acesso e mesma retenção do prontuário.
- `sessao_id` e `aal` do JWT; `ip_hmac` com chave no Vault (cabeçalho confiável conferido no CI).
- Leitura: `ws_trilha_paciente` (equipe) e `saude_meus_acessos` (paciente vê papel e nome do médico; da equipe, só "equipe médica do IMED", sem identificadores internos).

### 4.7 Retenção e direitos do titular [para o advogado, exceto onde marcado]

| Dado | Prazo |
|---|---|
| Prontuário, documentos, PDFs, assinaturas, listas clínicas | **Guarda permanente pelo CFM** (Res. 1.821/2007, art. 7º **[NORMA, conferir consolidação]**); mínimo de 20 anos pela Lei 13.787/2018, art. 6º **[NORMA]**. **Nenhuma eliminação programada.** |
| Trilhas de acesso e escrita | Mesmo prazo do prontuário |
| `ip_hmac` | Conforme o advogado (Marco Civil, art. 15 **[NORMA, a confirmar]**) |
| Pedido de teleconsulta não atendido | 30 dias, como hoje |
| Upload de resultado incompleto | 24 h |
| Idempotência | 7 dias |
| Rascunho no `sessionStorage` | Até salvar ou fechar a aba |

- **Excluir a conta:** `paciente_contas` cai em cascata; o prontuário fica (obrigação legal, LGPD art. 16, I **[NORMA, a reconferir]**). O paciente é avisado disso antes de confirmar.
- **Revogar autorização** (`autorizacoes`, `shares_health_summary`): para o acesso futuro; o que já foi visto continua registrado como visto.
- **Correção** (art. 18, III): só por adendo ou nova versão em `paciente_versoes`.
- **Cópia do prontuário** (Código de Ética Médica, art. 88 **[NORMA, a confirmar]**): é dever. Mesmo pelo "Fale com o IMED", tem **prazo definido** (proposta: 15 dias, a confirmar com o advogado) e trilha (pedido, entrega, quem entregou).
- **Fim do prazo:** sem rotina de descarte; decisão futura com advogado.

### 4.8 Layout do Workspace (módulos 1 e 13)

**Computador (≥ 1280 px):** 3 colunas em grid.

| Esquerda: PACIENTE | Centro: CONSULTA | Direita: FERRAMENTAS |
|---|---|---|
| Identificação, idade, alergias em destaque, remédios, problemas, histórico resumido | Vídeo no topo, fixo ao rolar; registro em abas: Anamnese, Exame, Diagnóstico, Conduta, Evolução | Abas: Receita, Exames, Documentos, Histórico, Mensagens |

- Faixa fixa: nome, idade, alergias, situação da chamada, "Salvo há 3 s", "Finalizar consulta".
- Divisores arrastáveis (WAI-ARIA window splitter: `role="separator"`, setas, `aria-valuenow`); larguras em variável CSS.
- Recolher painéis (`aria-expanded`); preferência em `localStorage 'imed_ws_layout'` (só larguras).
- 1024–1279 px: centro + ferramentas; paciente vira gaveta.
- < 1024 px: vídeo `sticky` (até 35% da altura, 16:9); "Minimizar" o leva a um canto (`position: fixed`) sem tirá-lo do lugar; PiP opcional; barra de abas Paciente, Registro, Receita, Exames, Docs, Mensagens (mesmos quadros, só CSS).
- **Regra de ouro:** `#cRemote` e `#cLocal` nunca são movidos nem recriados. Teste e2e com câmera falsa: após cada troca, `paused === false`, `currentTime` avança, nenhuma conexão nova.
- `manifest.webmanifest`: `portrait` → `any` (conferir testes). Frame-busting em JS em `medico.html` e `minha-saude.html`. Saída por inatividade 30 min.
- Velocidade: módulos por `import()` na 1ª abertura; catálogo só ao digitar; teste em `tests/velocidade.test.mjs`.
- Arquivos novos: `assets/js/ws-layout.js`, `ws-core.js` (puro, testado: SOAP ↔ texto livre, IMC, posologia por extenso, validações iguais às do banco), `ws-api.js`, `ws-registro.js`, `ws-paciente.js`, `ws-receita.js`, `ws-exames.js`, `ws-historico.js`, `catalogo-busca.js`, `assets/css/ws.css`.

### 4.9 Modelos por especialidade (módulo 3)

```sql
create table prontuario.modelos (
  id uuid primary key default gen_random_uuid(),
  escopo text not null check (escopo in ('imed','medico')), medico_id uuid references public.doctors(id),
  tipo text not null check (tipo in ('evolucao','texto_salvo','receita','pedido_exames','documento')),
  especialidade text, nome text not null, definicao jsonb not null,
  versao integer not null default 1, copiado_de uuid, publicado_em timestamptz, arquivado_em timestamptz,
  check ((escopo = 'medico') = (medico_id is not null)));
```

- Criar, editar (versão nova), duplicar, arquivar, campos obrigatórios. A evolução guarda `modelo_id` e `modelo_versao`. Sem paciente nem conduta automática.
- 9 modelos iniciais (clínica médica, endocrinologia, cardiologia, pediatria, ginecologia, dermatologia, psiquiatria, medicina esportiva, retorno) como rascunho, publicados só após revisão do Dr. Rafael (D11). Sem revisão: só "Clínica médica (SOAP)" e "Consulta de retorno".
- Validação da `definicao` em plpgsql no padrão de `tele_doc_payload`.

### 4.10 CID-10 com autocomplete

- Fonte: DATASUS `CID10CSV.zip` (v2008, ISO-8859-1, ";"). Licença: distribuição gratuita com crédito à OMS, CBCD/FSP-USP e DATASUS **[NORMA: página de direitos do DATASUS]**; crédito em "Sobre os catálogos".
- `catalogo.cid10(codigo pk, sistema default 'CID-10', descricao, descricao_abrev, restr_sexo, capitulo, categoria, busca, fonte, fonte_versao)`. `sistema` deixa espaço para a CID-11 (data de adoção no Brasil **a confirmar**).
- Códigos pós-2008 só com ato oficial citado em `fonte`, lançados pela equipe médica.
- `cat_cid_buscar(q)`, só médico aprovado; código ou palavras; `pg_trgm` em `extensions` sobre `busca` (normalizada como `fold()`); até 20 resultados.
- Restrição por sexo: **só aviso**, texto neutro ("este código costuma se aplicar a…; confira"), porque o sexo de registro pode não refletir a pessoa (ex.: pessoa trans).
- Nada atribuído sozinho. CID no atestado e relatório só com autorização do paciente (já no banco: `private.tele_doc_cid` recusa sem `cid_autorizado`; Res. CFM 2.381/2024 **[NORMA; artigo e parágrafos a confirmar, considerar a redação da Res. 2.418/2024]**). CID do prontuário separado do CID impresso.

### 4.11 Fluxo da consulta (módulo 9)

| Passo | Como fica |
|---|---|
| 1. Início | Fila + "Atender" (agenda do médico só com D14) |
| 2. Abertura | `tele_accept` abre o Workspace; paciente se houver vínculo; histórico pela D1; dados de segurança |
| 3. Registro | Rascunho automático no servidor |
| 4. Diagnóstico | CID-10 do catálogo, papel e situação |
| 5. Conduta | Receita, exames, atestado, documento, retorno |
| 6. Documentos | Pré-visualização igual ao PDF e assinatura (§6.4) |
| 7. Finalizar | `ws_consulta_finalizar` lista pendências, pede confirmação, chama `tele_end` (`p_notes` vazio), finaliza registro, hashes |
| 8. Pós-consulta | Avisos sem dado clínico pela fila do iMed Agenda (§6.6); até lá, só na tela |

---

## 5. Prescrição ("iMed Prescrição Digital")

### 5.1 Catálogo de medicamentos

| Fonte | O que traz | Atualização |
|---|---|---|
| CMED (`TA_PRECO_MEDICAMENTO.csv`, 17,1 MB, 09/10/2026) | Princípio ativo, produto, apresentação em texto livre, registro, GGREM, EAN, classe, tarja | Mensal |
| Anvisa, registros (`DADOS_ABERTOS_MEDICAMENTOS.csv`, 13/10/2026) | Situação e vencimento do registro | — |
| DCB (IN Anvisa 473/2026 **[a confirmar]**) | Nome oficial do princípio ativo | — |
| Listas de controle | Portaria SVS/MS 344/1998, Anexo I (A1 a C5, com adendos de exceção) e lista de antimicrobianos (RDC 471/2021 e atos ligados; IN 360/2025 citada para retenção de antimicrobianos e GLP-1 **[NORMA, a confirmar a fonte vigente]**) | Lançadas pela equipe médica, com ato e data |

- Tabelas: `catalogo.med_cargas`, `med_substancias`, `med_produtos`, `med_apresentacoes` (`apresentacao_oficial` como está na CMED), `med_substancia_apresentacao`, `med_regras` (substância, lista, nomes de busca normalizados, fonte, vigente desde).
- **Não inventar:** a CMED não separa concentração, forma e via; a tela mostra a apresentação oficial e o médico preenche/confirma a linha da receita.
- Carga: Edge Function `catalogo-carga` mensal (pg_cron + pg_net + `x-imed-token`), confere cabeçalho e contagens, troca a versão de uma vez; versões antigas ficam (cada item guarda `catalogo_carga` e o texto impresso). Se a rede do Supabase não alcançar a Anvisa (aqui deu 403), uma Action do GitHub baixa e entrega com HMAC.
- Tamanho: alguns MB.
- `cat_med_buscar(q)`: nome comercial, genérico, princípio ativo, trigramas, mínimo 3 letras, só médico aprovado.
- Licença **não confirmada** (D9). Sem resposta: sem catálogo carregado; receita em campo livre, **mas `med_regras` carregada** (só nomes de substâncias citados nos atos oficiais), usada na conferência do servidor (§5.3).
- Alternativas: Memed (gratuita para a plataforma, base proprietária, dados passam por ela), Mevo (sem preço público, diz já ligada ao SNCR), Simpro e Brasíndice (licença anual). D9.

### 5.2 Modelo da receita

```sql
create table prontuario.prescricoes (
  id uuid primary key default gen_random_uuid(),
  teleconsulta_id uuid not null references public.teleconsultations(id), paciente_id uuid,
  medico_id uuid not null references public.doctors(id),
  tipo_receituario text not null check (tipo_receituario in ('simples','antimicrobiano','controle_especial',
    'notificacao_a','notificacao_b','notificacao_b2','retinoide','talidomida')),
  situacao text not null check (situacao in ('rascunho','emitida','cancelada')),
  documento_id uuid unique references public.tele_documents(id),
  observacao text, versao integer not null default 1,
  criado_em timestamptz not null default now(), emitida_em timestamptz,
  check ((situacao = 'rascunho') = (documento_id is null)));
create table prontuario.prescricao_itens (
  id uuid primary key default gen_random_uuid(), prescricao_id uuid not null references prontuario.prescricoes(id),
  ordem smallint not null, tipo text not null check (tipo in ('industrializado','manipulado')),
  apresentacao_id uuid, catalogo_carga text,
  medicamento text not null, principio_ativo text, concentracao text, forma text,
  composicao jsonb,
  dose_valor numeric, dose_unidade text,
  via text not null check (via in ('oral','sublingual','subcutanea','intramuscular','intravenosa','topica','inalatoria',
    'nasal','oftalmica','otologica','retal','vaginal','transdermica','outra')), via_outra text,
  frequencia jsonb, duracao jsonb,
  quantidade text not null, orientacoes text,
  posologia_texto text not null,                 -- o que sai impresso; é o que manda
  posologia_editada_a_mao boolean not null default false,   -- se true, os campos "não conferem" e não alimentam alertas
  regra_excecao jsonb,                           -- exceção da conferência de lista: justificativa, quem revisou
  unique (prescricao_id, ordem) deferrable initially deferred);
create table prontuario.prescricoes_externas (
  id uuid primary key default gen_random_uuid(), teleconsulta_id uuid not null, paciente_id uuid, medico_id uuid not null,
  tipo_receituario text not null, medicamento text not null, plataforma text not null check (plataforma in
    ('cfm_prescricao_eletronica','papel','outra')), registrado_em timestamptz not null default now());
```

| Função | O que faz |
|---|---|
| `ws_receita_rascunho` | Cria/salva com versão |
| `ws_receita_item_*` | Adicionar, remover, editar, reordenar, duplicar |
| `ws_receita_modelo_salvar` / `ws_receita_de_modelo` | Modelos sem paciente |
| `ws_receitas_anteriores(paciente)` | Conforme D1 |
| `ws_receita_emitir(p_id, p_chave)` | Conferência de listas (§5.3) → payload 'receita' → **mesma** `private.tele_doc_payload` (endereço residencial, limites) → `tele_documents`; idempotente |

O médico revisa e confirma antes de emitir e de assinar. O texto impresso manda: se `posologia_texto` for editado à mão, os campos estruturados ficam marcados "não conferem".

### 5.3 Regras por tipo de receita (bloqueios)

| Tipo | Regra | No IMED |
|---|---|---|
| Simples | Lei 14.063/2020, art. 14, e Lei 5.991/1973, art. 35, §2º: avançada ou qualificada; CFM: qualificada ICP-Brasil (Res. 2.299/2021, art. 4º; Res. 2.381/2024 **[artigo a confirmar]**) **[NORMA]** | **Liberada**, com a regra do CFM |
| Antimicrobianos e retenção (GLP-1) | Só eletrônica por plataforma ligada ao SNCR (RDC Anvisa 1.000/2025, art. 4º **[NORMA]**); transição até 03/03/2027 **[a confirmar no DOU]** | **Bloqueada** |
| Controle especial (C1, C5, adendos) | SNCR + ICP-Brasil (RDC 1.000/2025, arts. 4º e 8º **[NORMA]**); Lei 14.063/2020, **art. 13**: assinatura **qualificada** em receita de controle especial e atestado eletrônicos **[NORMA, a confirmar redação]** | **Bloqueada** |
| Notificações A, B, B2, retinoides, talidomida | Só por plataforma SNCR, com cota da Vigilância e ICP-Brasil; emergencial em papel (RDC 1.000/2025; P&R Anvisa Q29) | **Bloqueada** |

**Como o bloqueio funciona**
- Banco: `private.tele_receita_liberada` e `receita_bloqueada` continuam.
- **Conferência no servidor de todo item** (catálogo ou texto livre): `medicamento`, `principio_ativo` e componentes de manipulado, normalizados como `fold`, comparados aos nomes de `med_regras`. Se bater, **a emissão é recusada e a tela explica** qual lista e qual ato; não muda o tipo sozinho.
- Exceção (ex.: uso tópico que a norma não retém) só com justificativa registrada, revisão da equipe médica e só para vias/formas que a norma realmente exclui; fica em `regra_excecao`.
- Bloquear pela substância bloqueia mais do que a norma em alguns casos (adendos com exceção de concentração da Portaria 344/98). É o lado seguro, e a tela diz isso.
- Tela: `BLOCK_TEXT` oferece a Plataforma de Prescrição Eletrônica do CFM ou o papel e registra em `prescricoes_externas`.
- O paciente vê "Rascunho, aguardando assinatura do médico" até haver PDF assinado e conferido.

**Para desbloquear o SNCR (fase 3.3)** (P&R SNCR, 2ª ed.): CNPJ (Q34); retorno em domínio `.br` (Q18); inscrição da empresa no CRM com diretor técnico (Res. CFM 2.314/2022, art. 17 **[a confirmar]**; 2.299/2021, art. 5º); login do médico pelo gov.br, numeração por lotes (Q32–Q38), modelo sem logotipo (Q40–Q41); testes em `sncr-treinamento.anvisa.gov.br`; advogado. Sem credenciamento nem taxa (Q6, Q7, Q9). Em outubro de 2026 houve falhas reais no SNCR (inclusive numeração entregue ao médico errado em 09/10).

### 5.4 Manipulados

`tipo='manipulado'` com `composicao`, forma, quantidade e orientações digitados pelo médico. Componente em lista de controle → recusa pela mesma conferência.

---

## 6. Integrações

### 6.1 Pedido de exames → marketplace → iMed Agenda

**Catálogo**: `catalogo.exames(id, codigo_imed unique, nome, sinonimos, grupo, categoria_busca (rx, usg, tc, rm, mamo, dens, ecg, eco, lab), tuss, tuss_versao, sigtap, sigtap_competencia, codigo_confirmado_por, codigo_confirmado_em, preparo_slug, ativo, catalogo_versao, fonte)`.
- Carga inicial: os 90 exames de `tele-core.js` (versão 2026-10-30), mesmos `id`.
- TUSS (202609, tabela 22) e SIGTAP: script propõe, **médico confirma um a um**; sem confirmação o código fica nulo e não sai impresso. Licença TUSS não confirmada (D9).
- Preparo só dos guias que já existem (`exames/<slug>.html`).

```sql
create table prontuario.pedidos_exame (
  id uuid primary key default gen_random_uuid(), teleconsulta_id uuid not null, paciente_id uuid,
  medico_id uuid not null, situacao text not null check (situacao in ('rascunho','emitido','cancelado')),
  prioridade text not null default 'rotina' check (prioridade in ('rotina','prioritario','urgente')),
  indicacao text not null,
  cid text[],
  cid_impresso boolean not null default false,   -- só com autorização expressa do paciente (tele_doc_cid)
  cid_autorizado_em timestamptz,
  documento_id uuid unique references public.tele_documents(id), versao integer not null default 1,
  criado_em timestamptz not null default now(), emitido_em timestamptz,
  check (not cid_impresso or cid_autorizado_em is not null));
create table prontuario.pedido_exame_itens (
  id uuid primary key default gen_random_uuid(), pedido_id uuid not null references prontuario.pedidos_exame(id),
  ordem smallint not null, exame_id uuid references catalogo.exames(id), catalogo_versao text,
  nome_impresso text not null, categoria_busca text, tuss text, sigtap text, observacao text);
create table prontuario.pedido_item_agendamentos (
  item_id uuid not null references prontuario.pedido_exame_itens(id),
  appointment_request_id uuid not null, appointment_item_id uuid,
  vinculado_em timestamptz not null default now(), vinculado_por uuid not null,
  primary key (item_id, appointment_request_id));
```

- **CID no pedido de exames: [NORMA, a confirmar o texto atual]** Res. CFM 1.819/2007 (redação da 1.976/2011) veda o CID nas guias de solicitação de exames junto com a identificação do paciente, salvo casos legais. Só a pedido e com autorização expressa do paciente, reusando `tele_doc_cid`; nunca marcado de fábrica.
- Indicação clínica obrigatória: Res. CFM 2.381/2024, art. 4º, XII **[NORMA, a confirmar]**.
- `ws_pedido_emitir` monta o payload 'exames' (validação de hoje) e escreve `teleconsultations.exams` como espelho (critério 17). A fonte é o pedido emitido.
- **`tele_set_exams` continua funcionando sem mudar a resposta** enquanto a interface antiga existir. Desligá-lo é fase própria, com o e2e atualizado de propósito.

**"Ver clínicas disponíveis"**
1. Em "Seus exames solicitados", cada item com categoria tem o botão; `{exame_id, item_id}` vai para `sessionStorage`; abre `perto.html?exame=<categoria>`. Nome do exame e pedido nunca na URL.
2. Até a agenda 3.2/5.1: busca de hoje por categoria.
3. Depois da agenda 3.2: `agenda.procedure_exams(clinic_id, procedure_id, exame_id)` (configuração, sem dado clínico); parceiros com o exame exato, preço ou "sob consulta", `agenda_next_free`; CNES continua. "Você pode fazer o exame onde preferir."
4. Marcar: `agenda_book` (5.1); depois `saude_vincular_agendamento(item, request)` grava a ligação no `prontuario`. Mesma `agenda.occupancy` com EXCLUDE, mesmas travas e idempotência.
5. Vários exames: "Marcar juntos" com `agenda_package_options` + `agenda_book` (agenda 5.2).
6. **Isolamento [RECOMENDAÇÃO firme]:** a clínica recebe procedimento, data, hora, nome e telefone. Não recebe indicação, CID, PDF **nem a origem** (`imed.origin` nunca exposto à clínica). O próprio agendamento revela o exame à clínica: inevitável e necessário, e vai no aviso de privacidade. Enviar o pedido pelo sistema = autorização expressa por envio (`autorizacoes`, `pedido_para_clinica`), só depois do painel novo da clínica.
7. Sem vantagem por encaminhamento (Código de Ética Médica, arts. 68 e 69 **[NORMA]**).
8. **Pedido sem PDF assinado:** na lista, "Pedido ainda sem assinatura: não vale na clínica". O botão continua, com esse aviso; lembrete quando o PDF assinado chegar.

### 6.2 Resultados de exames

- Bucket privado `resultados`, sem policy para anon/authenticated.
- Edge Function `ws-arquivos`, **única** com a chave secreta: sempre chama antes `saude_resultado_reservar` / `ws_resultado_abrir` com o token do usuário e confere a resposta; teste Deno garante que não há caminho de leitura sem essa chamada.
- Confere os bytes iniciais (PDF, JPEG, PNG), tamanho até 10 MB, SHA-256; grava por `ws_srv_resultado_recebido`. Avaliar URL assinada de upload para não passar 10 MB pela função.
- Entrega sempre com `Content-Disposition: attachment` ou só tipos aceitos (nunca HTML ou SVG); na tela, `blob:` (CSP `img-src blob:`).
- **Região fixa `sa-east-1`** nas chamadas às Edge Functions (`x-region`), com teste.
- `prontuario.resultados(id, paciente_id, pedido_item_id, enviado_por, objeto, mime, tamanho, sha256, situacao, recebido_em, visto_por_medico, visto_em)`.
- Autorização ao médico sempre por escolha ativa ("Enviar e mostrar ao Dr. X" / "Só guardar para mim"), nunca pré-marcada.
- **Texto fixo ao enviar:** "O médico não é avisado em tempo real e pode não ver logo. Se tiver sintomas ou dúvida urgente, procure atendimento." Nenhum indicador de "revisado" sem ação do médico; registra quem marcou como visto e quando.
- Recebimento automático da clínica: só com integração homologada (agenda 6.1, `POST /v1/resultados`, HMAC, idempotência), contrato e autorização do paciente.

### 6.3 Documentos (módulo 6)

- 7 tipos + `personalizado`. Encaminhamento ganha "profissional de destino"; relatório ganha modelos.
- `tele_doc_payload` redefinida em migração nova; testes leem a definição mais recente.
- PDF com identificação, CRM/UF, data/hora, código, QR e "emitido em modalidade de telemedicina" (Res. CFM 2.314/2022, art. 13 **[NORMA]**; já em `tele-docs.js:29`).
- Atestado: só ICP-Brasil (Lei 14.063/2020, art. 13 **[a confirmar]**; regra CFM).
- `prontuario.documento_pdfs(document_id, sha256_original, tamanho, gerado_em)` guarda a impressão digital do PDF gerado pelo servidor.

### 6.4 Assinatura digital (módulo 7)

**Fase 5.1 (sem contrato)**
1. PDF oficial gerado no servidor (`ws-documentos`, mesmo `tele-docs.js` e pdf-lib); guarda `sha256_original`.
2. O médico assina fora (VIDaaS gratuito pelo CFM, Assinador SERPRO, Adobe).
3. `ws-assinatura` confere: bytes iniciais = PDF gerado (incremental; senão `pdf_alterado`); `/ByteRange` cobre tudo menos a assinatura; `messageDigest`; assinatura CMS; cadeia até AC-Raiz ICP-Brasil (raízes do `ACcompactado.zip` do ITI, SHA-512 conferido); validade na data; **revogação interpretando a LCR de verdade (ASN.1, ex.: pkijs) ou OCSP quando houver** (nada de "procurar o número de série nos bytes"); CPF do certificado igual a `private.doctor_cpf` (campo antigo e `serialNumber` novo, Res. CG ICP-Brasil 211/2024 **[a confirmar]**).
4. **Meta de tempo definida e medida no CI antes da 5.1** (limites: 2 s de CPU e 256 MB por chamada). **Plano B:** conferência numa Action do GitHub agendada, sem dado no repositório, entrada e saída pela função com HMAC.
5. `prontuario.assinaturas(…, resultado ('conferida','recusada','pendente'), …)`, só linhas novas. Só `conferida` grava em `tele_document_files` (`ws_srv_doc_assinado`). **`pendente` nunca libera o PDF ao paciente como assinado.**
6. Textos: "Assinatura conferida pelo IMED em DD/MM/AAAA: certificado ICP-Brasil de NOME, válido na data. Confira também no validar.iti.gov.br". Nunca "válido para qualquer fim".
7. Certificados e PDFs reais fora do repositório público; testes com AC de teste.
8. CPF do médico em `private.doctor_cpf`, conferido pela equipe; teste que procura `cpf` nas respostas de **todas** as funções públicas.

**Fase 5.2 (com PSC)**: "Assinar com certificado em nuvem" (OAuth + PKCE); retorno numa página estática; `client_secret` só nos segredos do Supabase; servidor monta PAdES (AD-RB, DocMDP P=2, metadados de CRM/UF/tipo), manda só o hash, fecha o PDF, roda o mesmo verificador. Token descartado; sem chave privada nem senha. Lote se o PSC permitir. Registro finalizado com CAdES separado. Candidatos: IntegraICP (Valid; cobre o VIDaaS), BirdID (Soluti), outros PSCs da lista do ITI (17/09/2026). Preço sem informação pública; relato de demora da Valid. Carimbo do tempo (AD-RT) depois. Contrato com cláusula de operador e transferência internacional.

**Fase 5.3 (domínio e CNPJ)**: QR no protocolo do ITI (endpoint dinâmico; exige domínio próprio, D4). Webservice do CFM (R$ 948/ano, exige PJ, pedido no SEI-Medicina **[valor e art. 8º da Res. 2.299/2021 a confirmar]**).

**Conferência do CRM: pendência regulatória que trava o uso real.** Sem o webservice, a conferência manual não cumpre por inteiro o dever da plataforma (Res. CFM 2.299/2021, art. 8º **[a confirmar]**). Até lá: conferência manual **a cada 3 meses** (não 12), registrada, e uso real só com o dono ciente e de acordo (D6).

Atesta CFM: obrigação suspensa por decisão judicial (CFM, 29/07/2025 **[a confirmar]**); opcional depois.

### 6.5 "Minha Saúde" (módulo 8)

- `minha-saude.html` + `minha-saude.js` + `minha-saude-core.js` (regras puras).
- Abas: Minhas consultas, receitas, exames (pedidos e resultados), documentos, agendamentos (módulo comum com `conta.js`), **Meus vínculos e acessos**.
- Cada documento: ver, baixar o PDF assinado, compartilhar, "Conferir autenticidade" (`documento.html?c=`).
- Entrada por link mágico. Reforço: documentos, resultados e notas exigem sessão aberta pelo link há menos de 12 h (`amr` do JWT, conferido no SQL); TOTP opcional; nomes de exames escondidos até tocar; inatividade 30 min; "Sair de todos os aparelhos".
- Consultas sem conta: "Guardar no Minha Saúde" pelo código de uso único (R4-b, só aquela consulta).
- "Baixar meus dados": inclui teleconsulta e prontuário; JSON hoje, FHIR depois.
- Excluir conta: aviso de que o prontuário fica guardado por obrigação legal.
- Cópia completa das notas: D10 (com prazo e trilha em qualquer caso).

#### 6.5.1 Etapa 1: como ficou (14/11/2026, ramo `ci/minha-saude-1`, **não publicado**)

Feita só com o que **já é do paciente hoje**, porque a identidade do paciente e o TCLE v3 (§4.2, fase 2.2) dependem do
advogado. Não cria histórico médico e não mostra nada do prontuário.

- **Página** `minha-saude.html` (`noindex`, **sem contador de visitas**: fica em `SEM_CONTADOR` e `NUNCA_CONTA` de
  `scripts/aplicar-visitas.mjs`, fora da lista fechada do banco) + `assets/js/minha-saude.js` +
  `minha-saude-core.js` (regras puras) + `assets/css/minha-saude.css`. Três abas:
  **Agendamentos** (os deste aparelho, resumidos: onde, quando no fuso da clínica e o código; situação, cancelar e
  avaliar continuam em `conta.html`, para onde o link leva), **Consultas e documentos** (as teleconsultas deste aparelho
  pelo código secreto que já fica nele + as guardadas na conta; ver documentos, baixar o PDF assinado, "Conferir
  autenticidade") e **Na minha conta** (o que está guardado, com "Tirar da minha conta").
- **Banco:** migração provisória `20261114120000_ws_minha_saude` (só aditiva, com volta e pgTAP `520_minha_saude.sql`):
  tabela `prontuario.saude_vinculos` (conta, consulta, alcance `consulta`, prova `codigo_do_aparelho`, criado/tirado; uma
  consulta só fica guardada em **uma** conta por vez) e as funções `saude_guardar(consulta, código)`,
  `saude_vinculo_revogar`, `saude_minhas_consultas`, `saude_documentos`, `saude_documento_pdf` (só `authenticated`; sessão
  anônima barrada). Toda chamada, inclusive a recusada, entra na trilha (`private.ws_trilha`, papel `paciente`).
- **O que a conta enxerga de uma consulta guardada:** a data, a situação, o nome e o CRM do médico e os **documentos
  emitidos** (tipo, código de conferência, situação da assinatura e o PDF assinado). **Nunca** a anotação do médico, o
  motivo da consulta, as mensagens, os exames pedidos em texto, o conteúdo do documento fora do PDF nem dado de outra
  consulta. A clínica onde o paciente marca exame não vê nada disso.
- **Escolhas desta etapa:**
  - *MS1-a.* A prova é o **código secreto que a teleconsulta já grava no aparelho** (o mesmo que hoje abre os documentos).
    Não é o "código de uso único" da R4-b (esse nasce com a identidade, fase 2.2); é mais estreito: quem guarda já tinha
    o acesso. Nunca pelo celular, CPF ou nome (R1). 10 códigos errados em 1 hora travam a conta por 1 hora.
  - *MS1-b.* **Guardar nasce desligado** (`private.app_settings`: `saude_guardar` = `ligado` para ligar; a migração não
    grava a linha). Desligado, a página mostra só o que é do aparelho e diz "ainda não está disponível" a quem entrou.
    Ligar depende da resposta do advogado (pergunta abaixo) e de nova autorização do dono.
  - *MS1-c.* Documentos e PDF pela conta exigem **entrada feita há menos de 12 horas** (`amr` do token, conferido no
    banco). Pelo código do aparelho continua como já era na teleconsulta.
  - *MS1-d.* 30 minutos sem mexer com documentos à mostra: a página **fecha os documentos** e pede "Continuar usando"
    (não derruba a sessão, para não tirar a pessoa da conta em outras abas). "Sair de todos os aparelhos" usa o
    `logout?scope=global` (`signOutAll` no `auth.js`).
  - *MS1-e.* O tipo do documento só aparece depois de tocar em "Ver os documentos" (tela à vista de outras pessoas).
  - *MS1-f.* Banco de antes (sem as funções `saude_*`): a página funciona só com o aparelho, sem erro.
  - *MS1-g.* Consulta pedida e nunca atendida que foi anonimizada não pode ser guardada (o código não vale mais).
- **Testes:** `tests/minha-saude.test.mjs` (regras + o que a tela combina com a migração), `tests/e2e-minha-saude.mjs`
  (sem conta, com conta, outro aparelho, entrada antiga, desligado/banco de antes/recusas, trava de 30 min, celular
  360 px escuro, axe, ícones no recorte), duas entradas no `tests/e2e-a11y.mjs`, pgTAP `520_minha_saude.sql` (46).
- **Fica para a etapa 2** (depois do TCLE v3 e da identidade): histórico entre consultas, resultados de exames, pedido
  de exames com "marcar no IMED", compartilhar documento, "Baixar meus dados", médico ver com autorização do paciente,
  TOTP, excluir conta com o aviso da guarda legal.
- **Perguntas novas para o advogado (junto do pacote W0-L):** (1) o termo de teleconsulta de hoje cobre o paciente
  **guardar na conta dele** os documentos de uma consulta que ele já acessa pelo aparelho, ou precisa de texto novo no
  termo/na privacidade antes de ligar? (2) "Tirar da minha conta" só desfaz o atalho (o documento e o prontuário
  continuam guardados por obrigação legal): o texto da página está suficiente? (3) Guardar por 12 h a regra de "entrada
  recente" e a trilha de leituras do próprio paciente: base legal e prazo.

### 6.6 Avisos

- Uma fila só: a do iMed Agenda (5.3: `agenda.outbox` + `agenda-saida`). Pedido de coordenação: eventos de origem `prontuario` (`consulta_finalizada`, `documento_disponivel`, `exames_disponiveis`, `resultado_recebido`).
- Conteúdo sem dado clínico ("Você tem um documento novo no IMED. Abra o Minha Saúde.").
- Canais: e-mail (Resend, D5 da agenda; contrato de operador) e Web Push. Até a 5.3, só na tela.

### 6.7 Funções, APIs e FHIR (módulo 12)

| Módulo | Funções |
|---|---|
| Médico | `ws_abrir`, `ws_evolucao_salvar`, `ws_evolucao_finalizar`, `ws_adendo_criar`, `ws_medidas_salvar`, `ws_diagnostico_*`, `ws_alergia_*`, `ws_medicamento_uso_*`, `ws_problema_*`, `ws_receita_*`, `ws_pedido_*`, `ws_retorno_*`, `ws_modelo_*`, `ws_historico`, `ws_paciente_identificar`, `ws_consulta_finalizar`, `ws_resultados_novos`, `ws_resultado_visto` |
| Paciente | `saude_resumo`, `saude_documentos`, `saude_exames`, `saude_vincular_consulta`, `saude_confirmar_vinculo`, `saude_vincular_agendamento`, `saude_vinculos`, `saude_vinculo_revogar`, `saude_autorizacao_*`, `saude_meus_acessos`, `saude_dados_declarados_*`, `saude_pedir_copia` |
| Catálogos | `cat_cid_buscar`, `cat_med_buscar`, `cat_exame_buscar` |
| Só servidor | `ws_srv_doc_assinado`, `ws_srv_resultado_recebido`, `ws_srv_catalogo_*` |
| Edge Functions | `ws-documentos`, `ws-assinatura`, `ws-arquivos`, `catalogo-carga` (cada uma com `lib.ts` + `lib.test.ts`; região `sa-east-1`) |

Regras: erros curtos e estáveis (recusas de acesso como código devolvido, para a trilha ficar); idempotência (`p_chave`) em emitir, finalizar, assinar, enviar; leitura clínica só por funções VOLATILE via POST; logs sem dado pessoal; limite de chamadas; documentação no cabeçalho de cada migração.

FHIR R4 / BR Core 1.7.1 [RECOMENDAÇÃO]: `pacientes`→Patient; `doctors`→Practitioner; `teleconsultations`→Encounter; `diagnosticos`, `problemas`→Condition; `alergias`→AllergyIntolerance; `medicamentos_uso`→MedicationStatement; `prescricao_itens`→MedicationRequest; `pedido_exame_itens`→ServiceRequest; `resultados`→DocumentReference/DiagnosticReport; `tele_documents`→DocumentReference; `autorizacoes`→Consent; `assinaturas`→Provenance; `trilha_*`→AuditEvent; agenda→Appointment/Slot/Schedule. Primeira entrega: exportação do paciente. RNDS depois (exige estabelecimento com e-CNPJ/e-CPF).

### 6.8 IA e alertas (módulo 14): só preparados

- `prontuario.sugestoes` (origem, tipo, conteúdo, modelo/versão, situação proposta/aceita/editada/rejeitada, quem aceitou). Nada entra sem clique do médico; nada assinado ou enviado sozinho; transcrição só com autorização por consulta (`transcricao_ia`). D15. **Não implementar agora.**
- `catalogo.alertas_regras` **vazia** até base licenciada e validada. Tela: "Alertas de interação: indisponíveis (sem base clínica validada)". Conferências de fato (mesma substância já como alergia; repetida na receita) prontas e desligadas (D16). A conferência de **listas de controle** (§5.3) não é alerta clínico: é regra legal e fica ligada.
- Acompanhamento: `retornos` + avisos + linha do tempo.

### 6.9 Modo escuro e claro

Só variáveis de `assets/css/tema.css`; `.td-sheet`, impressão e PDF sempre claros; `e2e-tema` cobre `medico.html` e `minha-saude.html`.

### 6.10 Segurança operacional

- **RIPD** (relatório de impacto) como entregável antes de qualquer dado real (fase W0-L).
- **Plano de incidente:** aviso à ANPD e ao titular (Res. CD/ANPD 15/2024 **[NORMA, a confirmar prazos]**), responsáveis, modelo de comunicado.
- **Chaves:** troca periódica do HMAC do IP/CPF e do `x-imed-token`; roteiro se a chave secreta vazar (trocar no painel, revogar, revisar trilha); **varredura de segredos no CI** (repositório público).
- **MFA:** obrigatório para médico e para `tele_record_readers`; sem MFA, funções clínicas respondem `mfa_obrigatorio`. Sessão do médico expira por inatividade (30 min) e no máximo 12 h.

---

## 7. Dependências externas e custos

| Dependência | Para quê | Custo | Situação |
|---|---|---|---|
| Supabase plano pago (Pro) | Backup diário (guardado 7 dias), sem pausa, pgaudit | Mensal; conferir valor no painel (fonte: página de preços do Supabase) | **D2, antes do 1º prontuário real** |
| PITR (recuperação a qualquer momento) | Perder no máximo minutos de dado | Cobrado à parte do Pro; conferir no painel | D2 |
| **Arquivo de longo prazo** | Guarda permanente/20 anos: exportação lógica criptografada fora do Supabase, restauração testada por semestre; **nunca** no GitHub público nem em artefatos do Actions | Armazenamento de baixo custo (centavos a poucos reais por GB/mês, conforme provedor); sem cotação | D2 |
| Projeto de homologação (2º projeto Free) | Testes com certificado real e rede real, sem dado de mentira na produção | Zero (conferir limite) | **D12, antecipada para a W0** |
| Storage | Resultados | Dentro do plano | Fase 4.3 |
| Certificado ICP-Brasil do médico | Assinar | VIDaaS grátis pelo CFM; e-CPF pago ~R$ 160–400 (fonte não oficial) | Dono usa o gratuito na homologação |
| PSC (API de assinatura) | Assinar sem sair do site | Sem preço público; contrato | D3 |
| Carimbo do tempo | AD-RT | Por carimbo; sem preço levantado | Opcional |
| Webservice do CFM | Situação do CRM | **R$ 948/ano** (a confirmar), exige CNPJ | D6 |
| SNCR | Receitas especiais | Gratuito; exige CNPJ, `.br`, CREMESP, desenvolvimento | D5 |
| Domínio `.br` + serviço dinâmico | SNCR, QR do ITI, e-mail, cabeçalhos | Domínio anual (Registro.br, ~R$ 40/ano); Cloudflare grátis; custom domain do Supabase à parte | D4 |
| Resend / WhatsApp | Avisos | Conforme provedor | D5 da agenda |
| SBIS NGS2 | Certificação | Sem valor publicado (manual v5.2); selo 2 anos | D8 |
| Catálogo pago | Alternativa à CMED | Memed grátis (dados na Memed); outros sem preço | D9 |
| Base de interações | Alertas | Licença paga | D16 |
| IA | Módulo 14 | Por uso | D15 |
| Advogado | TCLE v3, privacidade, RIPD, contratos de operador, retenção, Marco Civil, licenças, cópia do prontuário | Honorários | D1, D9, D10, D13 |

Custo zero no plano: pg_trgm, MFA TOTP, Web Push, Edge Functions dentro dos limites, GitHub Actions.

---

## 8. Plano por fases (módulo 16)

**Regras de todas as fases:** `git worktree` limpa; banco antes do site; migração aplicada pelo conector com aprovação do dono, arquivo renomeado com a versão gravada, volta em `supabase/volta/` testada no CI; função nova no `000_catalogo.sql` (inclusive `service_role`); nenhum arquivo novo terminando em `_teleconsulta.sql`, `_tele_documentos.sql`, `_painel_medico.sql`, `_gestao.sql`; `sw.js` com arquivos novos e `VERSION` subida; `testes.yml` e `banco.yml` verdes; commit na `main`.

**Definição de pronto:** testes verdes no CI + conferência de leitura na produção.

**Produto mínimo útil:** W0 → 2.0 → 2.1 → 2.2 → 2.3 → 3.2 → 4.1 → 5.1. **Roda só em homologação (D12), sem dado clínico real**, até D2 (backup e arquivo), TCLE v3 revisado, RIPD e CREMESP. A 2.0 depende da agenda 3.1 aplicada.

| Fase | Entregável | Verificação | Depende de |
|---|---|---|---|
| 1. Análise | Este documento | Revisão | — |
| W0-L. Jurídico e LGPD (paralela) | Pacote ao advogado: TCLE v3, privacidade, RIPD, base legal (§4.4), retenção (§4.7), contratos de operador, plano de incidente | Pareceres registrados | Advogado |
| W0. Preparação | Projeto de homologação (D12). Migração `<ts>_ws_preparo_permissoes` **só** para tirar o `service_role` (pgTAP: pg_cron, `admin_gestao`, `tele_painel_medico` continuam). `pg_trgm` em `extensions`. Novo `tests/mock-supabase.mjs` **rodando junto** dos 3 simuladores antigos até passar nos mesmos 27, 11 e 16 casos; só então os antigos saem. Testes que leem SQL pegam a definição mais recente. a11y da consulta. Frame-busting. Varredura de segredos no CI | pgTAP sem acesso do `service_role`; e2e-tele, e2e-tele-docs, e2e-medicos iguais nos dois simuladores | D0; chaves novas (agenda 0.1, até 31/12/2026) |
| 2.0 Fundação | `<ts>_ws_base`: schemas, trilhas (com negados), guarda, idempotência, limites, `ws_guard`, permissões `imed.prontuario.*` | `200_ws_estrutura.sql` | Agenda 3.1 |
| 2.1 Layout | `ws-layout.js`, `ws.css` | e2e-workspace 1440/1024/768/390/360 px; vídeo não pausa; teclado; axe | W0 |
| 2.2 Identidade | `<ts>_ws_paciente` (R0–R6, `cpf_hmac`, `private.doctor_cpf`, vínculos e revogação, código de uso único, confirmação pelo paciente); TCLE v3 (`TCLE_VERSION` em JS e SQL) | pgTAP: R0–R6, IDOR, busca não revela CPF, termo v2 nunca no histórico, `cpf` em nenhuma resposta pública; e2e de vínculo | D1; TCLE v3 do advogado para dado real |
| 2.3 Registro | `<ts>_ws_registro` + `<ts>_ws_cid`; medidas com `quem_mediu`/`como_obtido`; hash do conteúdo canônico com filhas; âncora externa | Unidade (SOAP ida e volta, IMC com origem, sem classificação < 20 anos); e2e rascunho volta após recarregar (critério 4); pgTAP: guarda em todas as tabelas filhas, CHECKs das medidas, encerrado sem finalizar | 2.0, 2.2 |
| 2.4 Histórico | Listas com origem, dados de segurança, linha do tempo, `shares_health_summary` | e2e-historico; pgTAP da D1 e dos dados de segurança | 2.3 |
| 2.5 Modelos | `prontuario.modelos`, editor, 9 rascunhos | e2e criar/duplicar/obrigatório | D11 para publicar |
| 3.1 Catálogo | `<ts>_ws_medicamentos`, `catalogo-carga`, `med_regras` (sempre) | Amostras contra o arquivo; p95 < 150 ms | D9 (só para a parte CMED) |
| 3.2 Prescrição | `<ts>_ws_receita` com conferência de listas no servidor | e2e-receita; pgTAP: mesma chave não duplica; tipo especial recusado; **item livre com substância controlada recusado**; exceção exige justificativa; endereço exigido | 2.3, `med_regras` |
| 3.3 SNCR | Integração Anvisa (bloqueada) | Ambiente de treinamento | D5 |
| 4.1 Exames | `<ts>_ws_exames`, pedido único, espelho, CID só autorizado | e2e-exames; pgTAP: espelho igual; código não confirmado não sai; CID sem autorização recusado | 2.3 |
| 4.2 Documentos | `personalizado`, destino, modelos | e2e-tele-docs ampliado | 2.5 |
| 4.3 Minha Saúde e resultados | Página, `<ts>_ws_minha_saude`, `<ts>_ws_resultados`, bucket + `ws-arquivos` (região, attachment), reforço, MFA | e2e-minha-saude; Deno (tipos, tamanho, sem leitura sem `ws_resultado_abrir`, região); pgTAP: médico sem autorização não lê (critérios 11 e 15) | 2.2; D2 antes de dado real |
| 5.1 Assinatura conferida | `ws-documentos`, `ws-assinatura` (LCR interpretada/OCSP), meta de tempo, plano B por Action | Deno com AC de teste (válido, cadeia errada, revogado, CPF diferente, alterado, reescrito); homologação com VIDaaS: "Aprovado" no ITI e "conferida" no IMED (critério 10) | D12 |
| 5.2 PSC | OAuth+PKCE, PAdES, lote, CAdES do registro | Homologação com o PSC | D3 |
| 5.3 QR ITI e CFM | Endpoint do QR; webservice CFM | Validador do ITI | D4, D6 |
| 6.1 Marketplace por categoria | Botão com `sessionStorage`; aviso "sem assinatura: não vale na clínica" | e2e sem exame na URL | 4.1 |
| 6.2 Exame exato e agenda | `agenda.procedure_exams`, próximo horário, `agenda_book` + ligação, pacote | Testes 1, 6 e 9 da agenda verdes; pgTAP: clínica não lê `prontuario` nem a origem (12, 13, 14) | Agenda 3.2, 3.3, 5.1, 5.2 |
| 6.3 Avisos | Eventos do prontuário na fila | `510_avisos.sql` ampliado | Agenda 5.3 |
| 6.4 Desligar `tele_set_exams` | Mudança de contrato de propósito | e2e atualizado de propósito | Interface antiga removida |
| 7. Testes | Carga (50 médicos), queda de rede, `/security-review`, `get_advisors`, axe | Relatório do CI | todas |
| 8. Homologação | Roteiro do §9, dono como médico, paciente de teste "HOMOLOGAÇÃO" | §9 completo | D12; uso real: D2, D6, D13, TCLE v3, RIPD, CREMESP |

O marketplace pelo exame exato acompanha o ritmo do iMed Agenda.

---

## 9. Critérios de homologação

| # | Como se prova | Fase |
|---|---|---|
| 1. Abrir teleconsulta existente | e2e-tele igual + Workspace com vídeo | 2.1 |
| 2. Prontuário certo | pgTAP/e2e: paciente certo, histórico pela D1, dados de segurança, trilha | 2.2, 2.4 |
| 3. Anamnese e evolução | e2e-registro | 2.3 |
| 4. Rascunho sem perda | e2e: recarregar, fechar aba, rede caindo **de verdade no projeto de homologação**; duas abas → `versao_conflito` | 2.3 |
| 5. Histórico longitudinal | e2e com 3 consultas (TCLE v3), filtros | 2.4 |
| 6. Criar receita | e2e-receita | 3.2 |
| 7. Catálogo válido | Amostras contra o arquivo oficial; versão e data visíveis; nada criado pelo IMED | 3.1 |
| 8. Pedir exames | e2e-exames | 4.1 |
| 9. Emitir documentos | e2e-tele-docs ampliado | 4.2 |
| 10. Assinatura verificável | ITI "Aprovado" + IMED "conferida"; negativos recusados; `pendente` não libera | 5.1 |
| 11. Documentos ao paciente autorizado | e2e-minha-saude; outro usuário `forbidden`; código de consulta não dá prontuário inteiro | 4.3 |
| 12. Pedido inicia agendamento | e2e pedido → busca → horário | 6.1, 6.2 |
| 13. Agenda real | Marcação por `agenda_book`; nenhuma tabela de horário no `prontuario` | 6.2 |
| 14. Sem reserva duplicada | Teste 1 da agenda verde; origem não visível à clínica | 6.2 |
| 15. Permissões | `300_ws_isolamento.sql`: médico × consulta alheia, paciente × paciente, clínica × prontuário, `service_role` × tabelas e funções, anon × tudo, busca de CPF não revela existência | todas |
| 16. Registro íntegro | pgTAP: guarda em evolução **e filhas**, cadeia por `ws_integridade_conferir()`, âncora externa conferida, trilha de escrita | 2.3 |
| 17. Teleconsulta original continua | e2e-tele (27), e2e-tele-docs (11), e2e-medicos (16), e2e-teleconsulta-faq (7) sem mudar expectativa | todas |
| 18. Testes automáticos | `testes.yml`, `banco.yml` verdes | todas |
| 19. Trilhas | pgTAP: cada função de leitura e escrita gera linha, **inclusive as negadas** | todas |
| 20. Não homologado fica bloqueado | Receitas especiais e itens controlados recusados no banco e na tela; botões só quando funcionam; IA e alertas desligados | 3.2, 6.8 |
| 21. Operador fora da trilha controlado | Regra do conector registrada e seguida; RIPD menciona; âncora externa ativa | antes do uso real |

Além disso: conferência regulatória com fonte de cada regra (inclusive as marcadas "a confirmar"); nenhum texto que afirme conformidade, certificação NGS2 ou "validade" sem prova; "registro não assinado digitalmente" enquanto for verdade; restauração de backup e do arquivo de longo prazo testada (D2); revisão jurídica do TCLE v3 e da privacidade antes de dado real.

---

## 10. O que depende do dono

| # | Decisão | Recomendação | Se não responder |
|---|---|---|---|
| D0 | Conta do admin | Entrar pelo link e rodar `select * from private.vincular_admin();` | Ninguém aprova médico |
| D1 | Médico vê histórico de outros médicos | Tutela da saúde com transparência e "não compartilhar"; TCLE v3 com advogado | Só as próprias consultas + resumo levado pelo paciente + dados de segurança (ou o aviso) |
| D2 | Plano pago, backup, PITR e arquivo de longo prazo | Pro antes do 1º prontuário real, com arquivo criptografado fora do Supabase e restauração testada | Só homologação; nada de dado clínico real |
| D3 | PSC | Pedir proposta à Valid (IntegraICP) e a mais um | Assinatura manual + conferência (5.1) |
| D4 | Domínio `.br` | Comprar e usar Cloudflare (grátis) | QR leva ao `documento.html` |
| D5 | Receitas especiais pelo SNCR | Só após CNPJ, domínio, CREMESP e advogado; avaliar Memed/Mevo | Bloqueadas, com link do CFM |
| D6 | Webservice do CFM (R$ 948/ano) | Contratar logo após o CNPJ | Conferência manual a cada 3 meses, registrada como **pendência regulatória que trava o uso real** até o dono aceitar por escrito |
| D7 | MFA obrigatório | Sim | Obrigatório |
| D8 | SBIS NGS2 | Seguir os requisitos desde já; certificar depois | Aviso "sem certificação" (`medico.html:110`) |
| D9 | Licenças (CMED/Anvisa, TUSS) | Advogado confirmar; CMED + Anvisa + DCB | Sem catálogo CMED; receita livre com conferência das listas oficiais; TUSS vazio |
| D10 | Paciente vê notas completas | Cópia em PDF no Minha Saúde, com reforço (CEM art. 88, a confirmar) | Resumo e documentos no Minha Saúde; cópia completa pelo Fale com o IMED **com prazo (proposta 15 dias) e trilha** |
| D11 | Revisar os 9 modelos | Dono revisar | Só "Clínica médica (SOAP)" e "Retorno" |
| D12 | Projeto de homologação | Criar já, na W0 | Critérios 4 (rede real) e 10 sem prova |
| D13 | Retenção, Marco Civil, RIPD, contratos de operador (PSC, Resend), incidente | Levar §4.4, §4.7 e §6.10 ao advogado | Guarda permanente, IP só como HMAC, sem descarte |
| D14 | Teleconsulta com agenda do médico | Depois do CREMESP, no iMed Agenda | Fila; "+ Retorno" só recomenda |
| D15 | IA | Não agora | Só preparado |
| D16 | Conferências de fato (mesma substância) | Ligar depois de revisar | Desligadas |
| D17 | Responsável de adolescente vê notas | Não, salvo decisão do médico | Não vê |
| D18 | Sexo de registro e nome social | `feminino`, `masculino`, `ignorado`, `nao_informado` (conferir Provimento CNJ 122/2021) + nome social; aviso de CID neutro | Essa lista |
| — | Já pendentes (CLAUDE.md) | CNPJ e razão social, CREMESP com diretor técnico, Resend, 2FA no Supabase e GitHub | Bloqueiam o uso real |

---

## 11. Riscos de compatibilidade e o que não muda

1. **Vídeo:** oferta/resposta, trava de aba e reconexão não mudam (`medico.js:1005-1271`, `teleconsulta.js:472-862`).
2. **Regras repetidas no site e no banco:** o caminho novo chama as mesmas funções internas (`tele_doc_payload`, `tele_doc_create`, `tele_doc_cid`).
3. **Contratos:** as 39 `tele_*` mantêm assinatura e respostas **durante todo o projeto**, inclusive `tele_set_exams`; mudar contrato só na fase 6.4, de propósito. `notes` legado; `exams` espelho. Números de `admin_gestao`, `tele_agora`, `tele_painel_medico`, `admin_stats` só mudam com `visitas.test.mjs` e `painel-medico.test.mjs` juntos.
4. **Termo:** TCLE v3, aceite novo, revisão jurídica; consultas v2 fora do histórico.
5. **Testes que leem SQL pelo nome do arquivo** (`tele-core.test.mjs:12, 633`, `tele-docs.test.mjs:13-14`, `painel-medico.test.mjs:15-42`): ajustados na W0.
6. **Simuladores:** novo roda junto dos antigos até empatar.
7. **CSP:** `blob:` para resultados; nenhuma origem nova; PSC em nova página.
8. **iMed Agenda:** o Workspace não grava em `appointment_requests` nem `agenda.*`; só `agenda.procedure_exams`, combinada; travas 7201/7202.
9. **`medico.js` (2.780 linhas):** não cresce; menu com observador de `hidden` (`medico.js:411`) coberto pelo e2e.
10. **Chaves antigas do Supabase** param no fim de 2026; código novo com a publishable e `SUPABASE_SECRET_KEYS`.
11. **`doctors`:** nenhuma coluna sensível nova; CPF em tabela privada.

---

## 12. Revisões: o que entrou e o que foi descartado

### 12.1 Revisão clínica e regulatória

| # | Ponto | Decisão |
|---|---|---|
| 1 | Prazo de guarda: CFM 1.821/2007 manda guarda permanente; Lei 13.787 art. 6º é mínimo com permissão de eliminar | **Entrou** (§4.5, §4.7): guarda permanente, nenhuma eliminação programada |
| 2 | CID no pedido de exames é norma (Res. 1.819/2007) | **Entrou** (§6.1): `[NORMA, a confirmar]`, autorização expressa, CHECK no banco; citação 2.381 art. 4º XII marcada a confirmar |
| 3 | Item livre deixa passar antibiótico/controlado | **Entrou** (§5.3): conferência no servidor de todo item; recusa e explica; exceção com justificativa e revisão; `med_regras` carregada mesmo sem D9 |
| 4 | Hash não cobria filhas | **Entrou** (§4.5): conteúdo canônico com filhas; guarda em todas as tabelas |
| 5 | Origem do sinal vital | **Entrou** (§4.3): `quem_mediu` + `como_obtido`, CHECKs, `medido_em`, IMC sem classificação < 20 anos. "Aspecto geral" fica no texto, não como medida |
| 6 | Alergia de outro médico invisível | **Entrou** (§4.4): dados de segurança, com alternativa mínima do aviso |
| 7 | R4-b dava titularidade a terceiro | **Entrou** (§4.2), junto com o item 3 da outra revisão |
| 8 | Resultado sem expectativa de revisão | **Entrou** (§6.2): texto fixo, sem "revisado" automático, quem viu |
| 9 | Posologia por campos × texto | **Entrou** (§5.2): texto manda; `posologia_editada_a_mao` |
| 10 | CRM manual descumpre art. 8º | **Entrou** (§6.4, D6): pendência que trava o uso real; 3 meses; valor e artigo a confirmar |
| 11 | Citações a conferir | **Entrou**: todas marcadas "a confirmar"; acrescentados Res. 2.418/2024, RDC 471/2021, Lei 14.063 art. 13 |
| 12 | `sexo_registro` e aviso de CID | **Entrou** (§4.2, §4.10, D18): "ignorado" no lugar de "intersexo" (a confirmar no Provimento CNJ 122/2021); aviso neutro |
| 13 | Registro sem ICP-Brasil | **Entrou** (§4.5): "registro não assinado digitalmente"; "aproxima do NGS2" fora dos textos ao usuário |
| 14 | Pedido sem assinatura | **Entrou** (§6.1 item 8) |
| Faltas | Menor sem responsável (`patient_agrees`) em R3; 18 anos; presencial 180 dias; cópia com prazo | **Entraram** (§4.2, §4.3, §4.7) |

### 12.2 Revisão de dados, LGPD e viabilidade

| # | Ponto | Decisão |
|---|---|---|
| 1 | `postgres` fora da trilha | **Entrou** (§1, §4.1): declarado; regra do conector; âncora obrigatória; pgaudit; RIPD; critério 21 |
| 2 | Médico "puxa" prontuário por CPF | **Entrou** (§4.2 R2): busca não revela; confirmação do paciente; limites e trilha |
| 3 | Código + nascimento não prova identidade | **Entrou** (§4.2 R4): código de uso único com alcance só da consulta; aviso às contas; `saude_vinculos` e revogação |
| 4 | Termo atual proíbe histórico | **Entrou** (R0, `tcle_versao`, pgTAP) |
| 5 | CHECK de `evolucoes` | **Entrou**: `encerrada_em` e CHECK por situação; encerrado congelado e encadeado como não finalizado |
| 6 | Negados sem trilha | **Entrou** (§4.6): código de erro devolvido sem `raise`; coluna `resultado`. Descartada a alternativa de gravar em outra transação (dblink/pg_background não disponíveis no plano; mais complexo) |
| 7 | Trilha é dado sensível | **Entrou** (§4.6) |
| 8 | Criptografia em repouso | **Entrou** (§4.2): o que existe e o que não; `cpf_hmac` |
| 9 | CPF em `doctors` | **Entrou**: `private.doctor_cpf` + teste de varredura de respostas |
| 10 | Região das Edge Functions | **Entrou** (§6.2, §6.7): `sa-east-1` com teste; cláusulas de operador |
| 11 | Storage fora do fechamento | **Entrou** (§6.2) |
| 12 | Backup do Pro não cobre 20 anos | **Entrou** (§7, D2): arquivo de longo prazo, nunca no GitHub público |
| 13 | Direitos do titular × retenção | **Entrou** (§4.7) |
| 14 | Verificador de assinatura | **Entrou** (§6.4): LCR interpretada ou OCSP; meta de tempo; plano B por Action; `pendente` não libera |
| 15 | `tele_set_exams` × contrato | **Entrou**: mantido até a fase 6.4 própria |
| 16 | Unificar simuladores | **Entrou**: novo roda junto até empatar; `service_role` em migração separada |
| 17 | Produto mínimo "sem contrato" irreal | **Entrou** (§1, §8): só homologação até D2, TCLE v3, RIPD, CREMESP; D12 antecipada para a W0 |
| 18 | Origem visível à clínica | **Entrou** (§6.1 item 6) |
| 19 | Permissões automáticas | **Entrou** (§4.1): revoke de PUBLIC e grant explícito em toda função; catálogo confere `service_role` |
| 20 | Menores: prova e revogação | **Entrou** (R6) |
| Faltas | Base legal por tratamento, RIPD, incidente, chaves e varredura de segredos, limites de chamada, MFA e sessão, critério de negados e do conector, custos de arquivo e PITR | **Entraram** (§4.4, §6.10, §8 W0-L, §9, §7) |

### 12.3 Descartado ou adiado

- Gravar a trilha de negados em transação separada: descartado (ver 12.2 #6).
- Mudar o tipo da receita sozinho quando o item é de lista: descartado; agora bloqueia e explica.
- "Âncora externa opcional": descartado; virou obrigatória.
- Prazo de 15 dias para cópia do prontuário: proposta, depende do advogado.
- Papel só de leitura para o conector: estudo, não compromisso, porque o conector do claude.ai é configurado fora do projeto.
- Classificação do IMC para crianças por percentil: adiada (exige tabela oficial licenciada); por ora só o número.

---

**Arquivos de referência:** `/home/user/imed-trabalho/workspace-pedido.md`; `/home/user/testedoapp/memory/projects/imed-agenda-arquitetura.md`; `/home/user/imed-trabalho/wt-agenda/supabase/migrations/20261031100000_agenda_base.sql`; `/home/user/imed-trabalho/wt-tema/assets/css/tema.css`; `/home/user/testedoapp/supabase/migrations/20261030092931_teleconsulta.sql`; `/home/user/testedoapp/supabase/migrations/20261030121427_tele_documentos.sql`; `/home/user/testedoapp/medico.html`; `/home/user/testedoapp/assets/js/medico.js`; `/home/user/testedoapp/assets/js/tele-core.js`; `/home/user/testedoapp/assets/js/tele-docs.js`; `/home/user/testedoapp/termo-teleconsulta.html`; `/home/user/testedoapp/privacidade.html`.
