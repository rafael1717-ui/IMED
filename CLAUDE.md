# Memória do projeto IMED

> Lido automaticamente pelo Claude no início de cada sessão. Mantenha curto (~100 linhas).
> Detalhes em `memory/`. Este repositório é público (GitHub Pages): **nunca** escreva aqui segredos, senhas ou dados de pacientes.

## Quem sou eu (dono do projeto)
Dr. Rafael Pereira Barreto Silva, médico, **CRM-SP 266930**, dono e responsável técnico médico do IMED (autorizou usar nome e CRM no site). Fala português do Brasil, não é programador.

## Preferências (seguir sempre)
- Responder em **português do Brasil**, linguagem simples, sem jargão.
- **"Aceite tudo, não precisa perguntar"**: pode executar as tarefas do projeto sem pedir confirmação a cada passo
  (exceto gastar dinheiro, apagar dados reais ou algo irreversível fora do projeto).
- **Nunca inventar** preço, nota, horário, contagem, depoimento ou médico. Sem dado → não mostrar ("sob consulta").
- Localização do paciente: arredondar (~110 m), nunca gravar. Chaves secretas só no servidor.
- Depois de mudar o site: rodar os testes, subir `VERSION` em `sw.js`, commit e push na `main` (o Pages publica).

## O que é
| Item | Valor |
|------|-------|
| **IMED** | Marketplace de saúde: clínicas, laboratórios, diagnóstico por imagem e hospitais reais perto do paciente, com pedido de agendamento |
| Site | https://rafael1717-ui.github.io/IMED/ (repo `rafael1717-ui/IMED`, com maiúsculas; branch `main`). Endereço num lugar só: `siteUrl` do `assets/js/config.js`; para trocar: `node scripts/trocar-endereco.mjs <endereço novo>` |
| Banco | Supabase projeto `pyoqiecupxhdzigjudyd` (região São Paulo) — conector Supabase do claude.ai |
| Dados reais | **CNES** (cadastro do Ministério da Saúde), importado por cidade |
| Stack | HTML/CSS/JS sem build, Leaflet, MapLibre GL JS (mapa 3D do topo, prédios do OpenStreetMap via OpenFreeMap), Edge Functions Deno, Playwright nos testes |

## Termos
| Termo | Significado |
|-------|-------------|
| **CNES** | Cadastro Nacional de Estabelecimentos de Saúde (dados oficiais, públicos) |
| **Parceiro / Parceiro verificado** | Clínica que fechou com o IMED (`clinics`), com preço/agenda informados por ela |
| **Cadastro oficial** | Estabelecimento do CNES ainda não parceiro (`establishments`) |
| **Concierge** | Pedido para local não parceiro: a equipe do IMED liga e marca |
| **Reivindicar** | Clínica assume o próprio cadastro do CNES (`establishment_claims` → `approve_claim`) |
| **Fila** | `import_queue` + pg_cron: pré-carrega capitais e grandes cidades |
| **wip/melhorias** | Branch com cópia de segurança de trabalho ainda não publicado |

## Estado atual (atualize ao terminar cada etapa)
- No ar (30/10/2026): as 14 melhorias — página inicial só com dados reais, selos, filtros SUS/convênio, faixa de preço,
  avaliações, "Adicionar à agenda", conta do paciente (`conta.html`), reivindicar cadastro (`reivindicar.html`),
  área da clínica/admin (`painel.html`), páginas por cidade (`cidades/`, gerar com `scripts/gerar-cidades.mjs`),
  teleconsulta "em breve". Fila de importação (143 cidades) rodando sozinha.
- Testes: `node --test tests/*.test.mjs` e todos os `tests/e2e-*.mjs` (o GitHub roda tudo a cada envio; `E2E_PORT` muda a porta; o e2e-a11y precisa do axe-core via `AXE_PATH`).
- Também no ar: página de cada local (`local.html`), agenda com horário (aba Agenda no painel; reserva já confirmada), "Quem somos" e "Termos". O Dr. Rafael é admin (`admin_emails`) e aprova cadastros no `painel.html`.
- Noite de 30/10 (no ar): busca na área inteira (até 50 km); mapa da página inicial com todos os locais em 2 km; segurança do banco; testes automáticos no GitHub; 318 cidades (`scripts/cidades.json`, páginas geradas).
- 30/10 de manhã (no ar): **teleconsulta** por vídeo (`teleconsulta.html` paciente, `medico.html` médico/admin, `termo-teleconsulta.html`), com **documentos médicos** (pedido de exames, receita simples, atestado, comparecimento, encaminhamento, relatório, orientações; PDF com QR → `documento.html`; o médico assina com ICP-Brasil e envia o PDF); **confiança** (rodapé único com médico responsável em todas as páginas — `scripts/rodape.mjs` + `aplicar-rodape.mjs`; faxina do inventado; `como-funciona.html`, `acessibilidade.html`, `contato.html` "Fale com o IMED"; cancelar pedido; "Algo errado? Avise"; conferência de clínica no painel); **contador de visitas** próprio sem cookies (`assets/js/visitas.js`, aba Visitas no painel); acessibilidade (axe) e velocidade (fontes e ícones do próprio site — `scripts/fontes.mjs`).
- Migrações aplicadas: `..._seguranca`, `..._teleconsulta`, `..._tele_documentos`, `..._confianca`, `..._visitas`, `20261030163758_gestao`, `20261030191354_painel_medico`, `20261031034327_agenda_preparo`, `20261031192337_equipamentos`, `20261102200421` a `20261102200928_agenda_base_parte_1` a `_5` (a fundação da agenda em 5 partes; volta única na parte 5), `20261103005641`/`013510`/`041548_agenda_motor_parte_1..3`, `20261103045051_prontuario`, `20261103053453`/`053814`/`053921`/`053937_agenda_operacao_parte_1..4` (3.3; volta única na parte 4), `20261103181553`/`20261104170552`/`20261104170608_agenda_painel_parte_1..3` (3.4; volta única na parte 3), `20261104184120_agenda_config` (4.1), `20261105030413_entrada_senha`, `20261105050257_agenda_leitura_parte_1` (4.2, parte 1; a parte 2 `20261105050258_agenda_leitura_parte_2` tem nome provisório e **ainda não foi aplicada**) (nomes iguais às versões do banco; endereço das funções em `private.app_settings`).
- Tarde de 30/10: **vídeo de divulgação** gravado no GitHub (`scripts/gravar-video.mjs`, Actions → "Vídeo de divulgação", ramo `video/execucao-N`); correção da lista do mapa em celular de 360 px; análise dos concorrentes (`memory/projects/concorrentes-2026-10-30.md`, melhorias L1–L16).
- Noite de 30/10 (no ar): **painel de gestão** `gestao.html` (só admin, `noindex`, sem contador de visitas; dados só pelas funções `admin_gestao` e `admin_cobranca_*` da migração `..._gestao`, que conferem `is_imed_admin`; cobranças registradas pela equipe em `private.billing_charges`, com histórico) e **"Para médicos"** `para-medicos.html` (fluxograma da inscrição até o atendimento) + etapas do cadastro na área do médico.
- 30/10, 20h (no ar): **plataforma do médico** — `medico.html` virou "Plataforma de atendimento do IMED" (menu próprio e volta ao site) com o painel "Agora na plataforma" (aguardando, espera mais longa, em atendimento, atendimentos hoje, documentos para assinar, médicos disponíveis; função `tele_painel_medico`, só números, sem dado de paciente); "Sou médico" e perguntas frequentes na `teleconsulta.html`; bloco "Agora" no painel de gestão; "Área do médico" no rodapé.
- 30/10, noite (no ar): melhorias dos concorrentes — L1 "o que perguntar ao ligar" nos locais não parceiros (local e busca); L6 perguntas frequentes com JSON-LD nas 318 páginas de cidade + `llms.txt`; L7 "O que levar" nos 8 guias; L11 confirmação de preço fora do normal no painel da clínica + `tests/sem-dado-de-teste.test.mjs`; "não é plano de saúde nem cartão de desconto" em Quem somos e Termos.
- 30/10, noite (no ar): página inicial **"Clínicas perto de você"** — pede a localização ao abrir (1 vez por aba; não pede sozinha depois de 2 recusas ou pedidos sem resposta; o aviso LGPD espera a resposta), os 10 mais perto com abas por tipo e mapa (no celular, tela cheia e mapa só depois do toque), seletor "Onde você está?" no lugar de "Clínicas por cidade" (`assets/js/inicio-perto.js` + `inicio-core.js`; detalhes em `memory/context/arquitetura.md`).
- 31/10, madrugada (no ar): **L2** — a busca entende o nome popular, a sigla e uma letra errada do exame (hemograma, TSH, USG, tomo, "ressonancia"…), na página inicial, na busca ("ressonância em Campinas" liga o filtro e procura só Campinas) e na área do médico; "eco" e doença sozinha perguntam; laboratório sempre com "confirme se o local faz este exame" (`assets/js/exames-nomes.js`, baixado só quando a pessoa digita).
- 31/10, tarde (no ar): **aparelhos do CNES na busca por exame** — workflow `equipamentos.yml` (FTP DATASUS → ramo `dados/cnes-equip`, competência 09/2026), migração `20261031192337_equipamentos` (`establishment_equipment` + `equip_exams`; carga com `private.carregar_equipamentos`), aviso "Tem aparelho … em uso (cadastro oficial). Confirme com o local." e centros de imagem quando nenhum local tem o exame; ressonância em Campinas 0 → 29.
- **iMed Agenda** (pedido de 30/10): arquitetura final pronta em 31/10 (`memory/projects/imed-agenda-arquitetura.md`: modelo, concorrência com EXCLUDE, estados, fases 0 a 7 e as 26 decisões do dono com recomendação). Ordem: 0.1 chaves novas (a publishable já existe; em andamento no ramo `ci/chaves`) → **3.0 feita** (31/10: `banco.yml` sobe o Supabase com todas as migrações e roda pgTAP e concorrência a cada envio; laço local em `tests/banco/local/`) → **3.1 feita** (02/11: fundação na produção — schema `agenda` fora da API, ocupação com EXCLUDE, papéis, marca de origem, histórico; o site continua igual; INSERT do pedido coluna por coluna, sem UPDATE/DELETE diretos) → **3.2 feita** (03/11: motor de horários e cadastros, `20261103005641`, `20261103013510`, `20261103041548_agenda_motor_parte_1..3`; clínicas sem `agenda.unit_settings` seguem no modo antigo; nenhum feriado nacional lançado ainda) → **3.3 feita** (03/11: marcar/cancelar/remarcar/balcão no banco — `agenda_book` (1–4 exames, tudo ou nada, idempotente), `agenda_hold/confirm/release` (só servidor), `agenda_cancel`, `agenda_reschedule`, `agenda_desk_book/busy`, `agenda_set_status`, `agenda_my_booking`, `agenda_package_options`; conferências no COMMIT; job `imed-agenda-manutencao` (30 s); o INSERT direto com horário é recusado (23P01) e a grade antiga não oferece horário; pedido sem horário igual; prova no CI: 80 conexões e 300 POST → 1 confirmado; `tests/banco/concorrencia.mjs`, `reserva.mjs`, `falha.mjs`) → **3.4 feita** (04/11: painel no banco — leituras por permissão com `access_log`, equipe/convites com último dono protegido, aviso Realtime em canal privado só com a versão, preço "a partir de", retenção de 7 dias da reserva expirada, papéis novos em `clinic_members` e policies antigas por permissão; o site do paciente igual) → **4.1 feita** (04/11: painel da clínica com `agenda_me` (só os próprios vínculos; abas por permissão), aba Agenda = configuração rápida + unidade/fuso, modalidade com compromisso, horários, aparelhos/salas/profissionais, exames e conferência de horários livres (`agenda-config.js`, regras em `agenda-core.js`); aba Equipe (convites e papéis); editor antigo de faixas saiu; funções novas `agenda_config` e `agenda_mode_set`; MFA desligado: decisão 17 pendente do dono) → **4.2 feita — parte 1 na produção** (05/11: agenda visual e recepção na aba Agenda do painel — `assets/js/agenda.js` (dia/semana/mês, balcão, "só ocupar", detalhe, cancelar/remarcar, chegada/falta, bloqueios com afetados e "bloquear mesmo assim"), lista de pedidos por `agenda_requests` com registro de leitura, rótulos novos do paciente na conta; migração `20261105050257_agenda_leitura_parte_1`; **parte 2 pendente de aprovação do dono**: `20261105050258_agenda_leitura_parte_2` fecha a leitura direta de pedidos/horários/bloqueios pela API para a clínica (REVOKE + policies `false`); aplicar uns dias depois, com o painel conferido e nova autorização) → 4.3 → 5.
- 03/11 (no ar): **prontuário, fase 2 do Workspace** (`memory/projects/imed-workspace-arquitetura.md`) — migração `20261103045051_prontuario` (schemas `prontuario`/`catalogo` fechados, funções `ws_*` e `cat_cid_buscar`, registro com versão, finalizado imutável com hash encadeado, adendo, trilhas inclusive negados; CID-10 do DATASUS carregada pelo workflow `cid10.yml` → ramo `dados/cid10`); tela da consulta em 3 colunas (`ws-layout.js`, `ws-prontuario.js`, `ws-core.js`, `ws.css`), botões "Mostrar" no celular; testes `ws-core.test.mjs`, `e2e-prontuario.mjs`, pgTAP `200_prontuario.sql`. Falta: identidade do paciente/TCLE v3 (histórico entre consultas), MFA, âncora externa do hash, modelos.
- 04/11 (no ar): **mapa 3D do topo com os prédios reais** — MapLibre GL JS 6.16.0 do próprio site (`assets/vendor/maplibre`) + ladrilhos gratuitos do OpenFreeMap (prédios do OpenStreetMap com a altura da camada), luz, sombras, claro/escuro, pinos e rótulos dos locais reais; sem ladrilhos ou WebGL 2 → versão leve (detalhes em `memory/context/arquitetura.md`).
- 05/11 (no ar): **entrada com senha** — o dono saiu da conta em 03/11 e ficou sem acesso porque o site só entrava por link no e-mail e o e-mail do Supabase Auth está parado (SMTP/Resend sem domínio verificado, limite de 2 e-mails/h). Agora todo quadro de entrada tem "Entrar com senha" e "Esqueci a senha" (`assets/js/entrada-senha.js`), a página `definir-senha.html` define/troca a senha (link de recuperação ou já logado), `auth.js` ganhou `signInWithPassword`, `recover`, `setPassword` (link `type=recovery` em qualquer página leva para `definir-senha.html`); migração `20261105030413_entrada_senha` (`is_imed_admin`, `private.agenda_secure_session` e `vincular_admin` aceitam sessão por senha; anônima continua barrada); Edge Function `link-admin` (fonte em `supabase/functions/link-admin/`) gera link `magiclink` ou `recovery` sem e-mail. Links de recuperação enviados pelo Gmail do dono em 05/11; teste `tests/e2e-senha.mjs`.
- 05/11, noite (**só no ramo `ci/agenda-4-3`**, não publicado): **iMed Agenda 4.3** — atualização automática do painel
  (`assets/js/tempo-real.js`: canal privado do Realtime com o token da pessoa + consulta periódica de `agenda_version`,
  15 s/5 s, pausa com a aba escondida; `imed:token` no `auth.js`; CSP do `painel.html` com `wss:`), a agenda e a aba Pedidos
  releem sozinhas sem perder o que a pessoa digita, bloco "Precisa de atenção" e visão "Resumo" (painéis operacional e
  financeiro) na aba Agenda; migração provisória `20261105190000_agenda_aviso_pedido` (gatilho: pedido novo do site sobe a
  versão) **não aplicada**. Na produção o Realtime ainda não grava (sem partição em `realtime.messages`): vale a consulta
  periódica. Publicar: juntar na `main`, subir `VERSION` no `sw.js` e aplicar a migração (depende do dono; ver pendências).
- 10/11 (**só no código; produção igual**): a conta antiga do GitHub (`drrafaelpereirabarreto-code`) foi banida em 10/11 e o site antigo pode sair do ar. O código mudou para o repo novo `rafael1717-ui/IMED` e para o endereço novo (config, páginas, 404, cidades, sitemap, testes, workflows; `scripts/trocar-endereco.mjs` + `scripts/endereco.json`, teste `tests/endereco.test.mjs`; sw `imed-v32`). No repo, as Edge Functions aceitam o endereço novo e o antigo (bloco `endereco-do-site`), mas **nada foi publicado**: as funções no ar ainda só aceitam o antigo, o Auth do Supabase não conhece o novo e o Pages do repo novo está desligado (detalhes e passos em `memory/context/arquitetura.md`, "Endereço do site").
- 10/11 (**só no ramo `ci/agenda-4-4`**, por cima do `ci/agenda-4-3`; não publicado): **iMed Agenda 4.4, central do IMED (básico)** — parte "Agenda das clínicas" no fim do
  `gestao.html` (`assets/js/gestao-central.js`, regras em `gestao-core.js`), em 6 abas: Clínicas (modalidade, agenda ativa,
  fuso, feriados conferidos, conflitos, por vir, versão, última atividade), Conflitos (de todas as clínicas; resolver é na Área
  da clínica), Auditoria (quem mexeu em quê + leituras de dado de paciente só somadas; conta pelo código de 8 caracteres),
  Feriados (nacionais: lançar com fonte e conferência antes, retirar), Parâmetros (só o que o sistema lê: limite por telefone)
  e Equipe do IMED (dar e tirar papel; só o admin). Nenhum dado de paciente. Confere sozinha a cada 30 s e pelo canal
  `agenda:imed` (`startCentralWatcher` em `tempo-real.js`; `wss:` na CSP do `gestao.html`). Migração provisória
  `20261110190000_agenda_central` (11 funções `agenda_central_*`, só aditiva, com volta e pgTAP `130_central.sql`) **não
  aplicada**; sem ela a parte mostra "ainda não está ligada no banco". Detalhes e decisões 4.4-a…f na arquitetura (§14).
- 11/11 (**só no ramo `ci/agenda-5-1`**, por cima da 4.3 e da 4.4; não publicado): **iMed Agenda 5.1, "Horário direto"** —
  na página do local, clínica com a venda online ligada (nativa ou manual) mostra os horários livres do motor no fuso
  da unidade e o paciente marca sozinho (`agenda_book`, confirmado na hora; id e código gravados antes do envio;
  horário pego → id novo e outros horários); "Próximo horário livre" e selo honesto por modalidade na busca e no local;
  `.ics` em UTC com a duração real. Migração provisória `20261111120000_agenda_app` (`agenda_next_free` + tempo-limite;
  só aditiva, volta, pgTAP `410_app.sql`) **não aplicada**. Nada muda para o paciente até a clínica piloto ser ligada.
  Detalhes e decisões 5.1-a…f na arquitetura (§14).
- 11/11 (**só no ramo `ci/pagamento-p1`**, por cima da 5.1; não publicado): **iMed Pagamentos, fase P1 (banco, TUDO DESLIGADO)** —
  schema `pagamentos` fechado (cobrança com divisão em centavos, avisos, devoluções, extrato, conciliação, mensalidade), funções
  `pag_*`/`admin_pag_*` e a reserva de quem vai pagar (`agenda_pay_hold`); chave geral desligada e nenhuma clínica com conta: nada
  muda para ninguém. 5 migrações provisórias `2026111114…_pagamentos_base_parte_1..5` (volta única na 5, a única com DROP) **não
  aplicadas**; pgTAP `500`–`570` e `tests/banco/pagamento-*.mjs` com provedor de mentira (`asaas-falso.mjs`). Desenho, escolhas e o que
  ficou de fora: `memory/projects/imed-pagamento-arquitetura.md` ("P1: como ficou", no fim).
- 12/11 (**só no ramo `ci/pagamento-p2a`**, por cima da P1; não publicado): **iMed Pagamentos, fase P2a ("Pix por dentro", invisível)** —
  fonte das funções `pagamento-criar`, `pagamento-webhook` e `pagamento-rotina` (com `supabase/functions/_shared/`: camada do provedor e
  adaptador do Asaas isolado, tudo "a conferir"), migração provisória `20261111150000_pagamentos_rotina` (jobs da rotina; **não aplicada**),
  telas do paciente (`assets/js/pagamento.js` + `pagamento-core.js`: QR, copia e cola, relógio, comprovante; só aparecem em clínica com
  recebimento ligado, e não há nenhuma) e o roteiro das 12 conferências (`scripts/asaas-sandbox.mjs`, Actions → "Asaas: conferência no
  ambiente de testes", **ainda não rodado**). Nada publicado; nunca falou com o Asaas de verdade. Detalhes e o que falta ajustar quando a
  conta existir: `memory/projects/imed-pagamento-arquitetura.md` ("P2a: como ficou"). Decisões de 11/11: `memory/projects/decisoes-2026-11-11.md`.
- **Próximo:** ligar o site novo (pendências abaixo); fases do iMed Agenda acima; Turnstile e TURN; domínio próprio antes do 1º documento real.

## Pendências que dependem do Dr. Rafael
- **Site novo (10/11), nesta ordem:** (1) GitHub → repo `rafael1717-ui/IMED` → Settings → Pages → Source "Deploy from a branch" → `main` e `/ (root)` → Save (e conferir Settings → Actions → General → "Allow all actions"); (2) Supabase → Authentication → URL Configuration: Site URL `https://rafael1717-ui.github.io/IMED/` e, em Redirect URLs, `https://rafael1717-ui.github.io/IMED/**` (sem isso a entrada por link e "Esqueci a senha" não voltam para o site novo); (3) autorizar publicar as Edge Functions `clinicas-proximas` e `link-admin` com as origens nova e antiga (hoje a busca do site novo cai no plano B, direto no banco); (4) domínio próprio (um comando: `node scripts/trocar-endereco.mjs https://dominio/`).
- **iMed Agenda 4.4** (ramo `ci/agenda-4-4`): depois da 4.3 publicada, autorizar a publicação e a migração provisória
  `agenda_central` (só funções novas, com volta); decidir quem da equipe recebe papel (decisão 21) e se as telas abrem para
  quem não é admin (4.4-a); autorizar a migração provisória `20261111130000_feriados_nacionais` (os 13 feriados nacionais
  até 2027, com a fonte oficial e volta própria; hoje nenhum lançado: o motor não oferece horário; `memory/context/feriados-nacionais.md`).
- **iMed Agenda 5.1** (ramo `ci/agenda-5-1`, com a 4.3, a 4.4 e os feriados juntos; os 5 passos de aplicar estão no `banco.yml`): publicar só depois da 4.3, da 4.4 e dos feriados nacionais lançados;
  decidir o Turnstile (decisão 10: recomendado antes de vender online em clínica real) e a clínica piloto (decisão 24,
  em UTC−3); a venda da piloto é ligada pela equipe, com a aprovação do dono.
- **iMed Agenda 4.3** (ramo `ci/agenda-4-3`): autorizar a publicação e a migração provisória `agenda_aviso_pedido` (só um
  gatilho aditivo, com volta); no Supabase, em Realtime → Settings, **desligar "Allow public access"** (o painel entra no canal
  com o token da pessoa) e conferir se `realtime.messages` ganhou partições depois da 1ª conexão (até lá o aviso fica só no
  log e o painel se vira com a consulta periódica).
- **iMed Agenda 4.2, parte 2** (`supabase/migrations/20261105050258_agenda_leitura_parte_2.sql`): autorizar o fechamento da leitura direta (a clínica passa a ler pedidos, horários e bloqueios só pelas funções, com registro de quem leu) uns dias depois de usar a aba Agenda do painel e confirmar que está tudo certo. Nada é apagado; tem volta própria.
- Razão social e CNPJ do IMED → `sobre.html` (hoje "em atualização"). Termos de uso: pedir revisão de um advogado.
- Comprar domínio (ex.: imed.com.br; dá para ver na Hostinger) → `node scripts/trocar-endereco.mjs https://dominio/` (README, "Trocar o endereço do site").
- **iMed Pagamentos** (ramos `ci/pagamento-p1` e `ci/pagamento-p2a`; até lá o painel de gestão registra as cobranças feitas por fora): primeiro a fase P0, que é
  do dono (CNPJ, conta no Asaas, e as perguntas do §3.5 da arquitetura ao contador e ao advogado, principalmente C1 e A1); depois
  autorizar as 5 migrações da P1 (só depois das provisórias da agenda; não ligam nada) e conferir as tarifas na conta (hoje "a confirmar").
  Com a conta de **testes** do Asaas aberta: gravar a chave de testes no segredo `ASAAS_SANDBOX_KEY` do GitHub e rodar o roteiro das 12
  conferências (lista em "P2a: como ficou"); o Turnstile (chave do site e segredo) é obrigatório antes de vender em clínica real.
- Número de WhatsApp do IMED → `whatsapp` em `assets/js/config.js`.
- **E-mail do Supabase Auth parado** (SMTP com Resend sem domínio verificado: todo link por e-mail dá erro 500; sem SMTP próprio, só 2 e-mails/h): verificar um domínio no Resend (ou usar outro SMTP) e configurar em Authentication → SMTP; Auth → URL Configuration: Site URL ainda é `http://localhost:3000` → trocar pelo endereço do site e conferir que `definir-senha.html` está nos Redirect URLs. Até lá, a equipe entra com e-mail e senha; link sem e-mail pela função `link-admin` (SQL em `supabase/functions/link-admin/index.ts`).
- Ligar "Leaked password protection" em Authentication → Attack protection (aviso do advisor de segurança, agora que há entrada com senha).
- Aprovar quando o Supabase pedir confirmação de SQL (o tempo esgota se ninguém responde).
- Segurança: manter "Confirm email" ligado; depois de o sócio (mohamad) entrar com a senha, rodar `select * from private.vincular_admin();` (o dono já está vinculado); 2FA no Supabase e no GitHub; backup (plano Pro, custo).
- Teleconsulta: inscrição da empresa no CRM (CREMESP) com diretor técnico antes de atender; certificado digital ICP-Brasil para assinar documentos; advogado revisar termo e textos; aprovar médicos em `medico.html` só depois de conferir identidade e CRM.

→ Detalhes técnicos: `memory/context/arquitetura.md` · Histórico: `memory/projects/`
