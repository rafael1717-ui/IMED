# Arquitetura do IMED (referência técnica)

## Páginas
| Arquivo | Para quê |
|---------|----------|
| `index.html` | Início: mapa 3D com os prédios reais (`assets/js/hero3d.js`), "Clínicas perto de você" (#reais: os 10 mais perto, abas por tipo, mapa e seletor "Onde você está?"), agendados, lista de espera |
| `assets/js/inicio-perto.js` + `inicio-core.js` | Início "perto de você": pede a localização ao abrir (1 vez por aba; não pede sozinho depois de 2 recusas ou pedidos sem resposta), lista e mapa (no celular, mapa em tela cheia só depois do toque), seletor de cidade. Regras puras em `inicio-core.js` (testadas em `tests/inicio-core.test.mjs`; posição simulada nos e2e com `tests/geo-simulado.mjs`) |
| `perto.html` + `assets/js/perto.js` | Busca por localização/CEP: mapa, lista, filtros, detalhes, pedido. 5.1 (ramo `ci/agenda-5-1`): parceiro com venda online ganha o selo da modalidade e "Próximo horário livre" (`agenda_next_free`, até 10 clínicas por pergunta, exame do filtro) no cartão, no leitor de tela e na ficha; o botão leva aos horários da página do local |
| `local.html` + `assets/js/local.js` | Página de cada local. 5.1 (ramo): "Horário direto" — parceiro com a venda online ligada em modalidade nativa ou manual (`agenda_public_info`) mostra os horários do motor (`agenda_slots`, 14 dias no fuso da unidade), "Próximo horário livre", preparo/jejum da clínica, preço do procedimento ou "sob consulta", e marca com `agenda_book` (confirmado na hora; id e código da intenção gravados em `localStorage.imed_intencao` antes do envio; "Tentar de novo" reenvia o mesmo; id novo depois de `slot_taken`; revisão de 11/11: a intenção guardada desta clínica é conferida com `agenda_my_booking` ao abrir a página, antes de marcar outro horário e em Meus pedidos — o agendamento que existe aparece e vai para `imed_appts` com o código); exame pedido (`?exame=`) que a clínica faz mas não vende com horário: aviso e pedido desse exame; `&proc=` da busca escolhe o procedimento do "próximo horário livre"; horário que já começou sai da lista e a página relê ao voltar para a aba; limite do celular, venda desligada no meio (vira pedido) e 409/23P01 com mensagens simples; sem observações livres na marcação direta; região viva `#lcLive` para o leitor de tela. Os outros continuam no pedido (concierge) |
| `assets/js/geo-core.js` | Regras puras (normalizar, filtrar, ordenar, pedido) — testadas em `tests/geo-core.test.mjs`. 5.1: fuso da unidade (`zonedDateTime`, `zonedDate`, `groupSlots`/`formatSlot`/`nextDays` com fuso, `tzLabel`, `tzDiffers`), `nextFreeText`, `durationText`, selo por modalidade (`MODE_SEAL`, `modeSeal`, `ONLINE_SEAL`), `bookableProcedures` (só nativa e manual), intenção (`newIntent`/`intentFor`, 24 h), `agendaBookArgs`, `bookOutcome`/`BOOK_MSG`, `isSlotTaken` × `isDuplicateId` (chave primária não é horário ocupado); `.ics` do horário marcado em UTC com o fim real |
| `assets/js/exames-nomes.js` | Dicionário de nomes de exames (nome popular, sigla, uma letra errada → código da busca; "eco" e doença sozinha perguntam). Baixado só quando a pessoa digita (início, busca e área do médico); testes em `tests/exames-nomes.test.mjs` |
| `assets/js/auth.js` | Login por link mágico ou por e-mail e senha (Supabase Auth via REST) para conta, painel, reivindicação, médico e gestão: `signIn` (otp), `signInWithPassword`, `recover` (link de recuperação → `definir-senha.html`), `setPassword` (PUT /auth/v1/user), `handleRedirect` (link `type=recovery` em qualquer página leva para `definir-senha.html#definir`) |
| `assets/js/entrada-senha.js` | Bloco "Entrar com senha" / "Esqueci a senha" posto no fim de cada quadro de entrada (`clinica.js` `renderAuth` com `onSignIn`, `medico.js`, `conta.js`); estilo injetado uma vez (`#es-css`); nunca guarda a senha |
| `definir-senha.html` + `assets/js/definir-senha.js` | Definir ou trocar a senha: com sessão (link de recuperação ou já logado) pede a senha 2 vezes (mín. 8) e salva; sem sessão pede o link de recuperação. `noindex`. Teste: `tests/e2e-senha.mjs` (também no `e2e-a11y`) |
| `parceiros.html` | Cadastro de clínicas/médicos parceiros (`partner_leads`) |
| `painel.html` + `assets/js/painel.js` | Área da clínica. Quem sou por `agenda_me` (só os próprios vínculos; banco sem a função: `clinic_members` filtrado pelo `user_id`); abas por permissão (`agenda-core.js` `clinicTabs`): Pedidos (lista por `agenda_requests`, com registro de leitura; reserva: leitura direta enquanto a parte 2 da 4.2 não fecha), Agenda (4.2: `assets/js/agenda.js`, baixado só ao abrir a aba — dia/semana/mês, legenda, filtros, busca, balcão, "só ocupar", detalhe e histórico, cancelar/remarcar, chegada/atendimento/falta, bloqueios com a lista de afetados e "bloquear mesmo assim"; funções `agenda_catalog`, `agenda_free`, `agenda_desk_slots`, `agenda_blocks`, `agenda_block_force`, `agenda_attend`), Configuração (`agenda-config.js`), Dados, Exames e preços, Equipe; convites para a conta (`agenda_my_invites`/`_accept`) no topo. Profissional vê só a própria agenda (escopo `propria`). 4.3 (ramo): bloco "Precisa de atenção" (`agenda-core.js` `attentionItems`: chegadas sem registro, reservas vencendo, para remarcar, pedidos sem resposta — este só com `pedidos.ver`, pela contagem `agenda_requests_pending_count` (só o número, sem registro de leitura; banco sem ela: `agenda_requests`, com "pode haver mais" quando vêm 100)), visão "Resumo" (`agenda_dashboard` com período/filtros, `agenda_dashboard_financeiro` só com `financeiro.ver` ou admin; o profissional não tem a visão), "Atualizado às … · atualização automática ligada / confere a cada 5 s" e faixa "Sem conexão"; recarga automática adia o redesenho enquanto a pessoa digita num campo da área principal ou cancela/remarca no detalhe. Financeiro ainda sem aba própria |
| `assets/js/agenda-config.js` + `agenda-core.js` | iMed Agenda 4.1: aba Agenda (configuração rápida que cria unidade, recursos, procedimentos e regras de verdade; unidade e fuso; modalidade com compromisso; horários da unidade; aparelhos/salas/profissionais; exames com grupos e preço com conferência L11; conferir horários livres por `agenda_slots`) e aba Equipe (convites, papéis, último dono). Mudança que tira agendamento do lugar mostra quantos e pede "Salvar mesmo assim" (`p_confirm`). Bloqueios da unidade continuam no `painel.js` (`add_my_block`). Regras puras testadas em `tests/agenda-core.test.mjs`; tela em `tests/e2e-agenda-config.mjs` (1024 e 390 px, teclado, tema escuro, relógio fixo). MFA desligado: **decisão 17 pendente do dono** (quando decidir, entra no `auth.js` e as funções de equipe/integração passam a exigir `aal2`) |
| `exames/` | Guias de preparo dos exames |
| `privacidade.html` | Política de privacidade (LGPD) |
| `sw.js` | Service worker: scripts/páginas pela internet primeiro; suba `VERSION` a cada mudança |
| `teleconsulta.html` + `assets/js/teleconsulta.js` | Paciente: termo, fila, vídeo (WebRTC direto, sinalização pelo banco), chat, resumo e documentos |
| `medico.html` + `assets/js/medico.js` | Médico: cadastro, fila, atendimento, documentos (PDF com `assets/vendor/pdf-lib`, QR) e admin (aprovar médicos) |
| `assets/js/tele-core.js`, `assets/js/tele-docs.js` | Regras puras da teleconsulta e dos documentos (testadas em `tests/tele-*.test.mjs`) |
| `documento.html` | Conferência pública de documento pelo código (só tipo, data, médico, iniciais, situação) |
| `gestao.html` + `assets/js/gestao.js`, `gestao-core.js` | Painel de gestão só do admin (`noindex`, fora da navegação, sem contador): pacientes atendidos, funil do paciente, entrada de médicos (fluxograma com números) e clínicas, resultados, faturamento e cobrança (registro manual, CSV). No fim, "Agenda das clínicas" (central do IMED, 4.4, ramo `ci/agenda-4-4`): `gestao-central.js`, 6 abas, só funções `agenda_central_*`. Gráficos SVG feitos à mão, com tabela em "Ver em tabela" |
| `para-medicos.html` | Página pública "Atenda pelo IMED": requisitos, situação do IMED, fluxograma da inscrição até o atendimento, perguntas |
| `contato.html`, `como-funciona.html`, `acessibilidade.html` | Fale com o IMED (protocolo), regras do site, acessibilidade |
| `scripts/rodape.mjs`, `aplicar-rodape.mjs`, `aplicar-visitas.mjs`, `fontes.mjs` | Rodapé único, contador de visitas em todas as páginas, letras e ícones do próprio site (rode depois de criar página) |
| `scripts/trocar-endereco.mjs` + `scripts/endereco.json` | Troca o endereço público do site no repositório inteiro (veja "Endereço do site") |

## Página inicial "perto de você" (decisões)
- Decisão do Dr. Rafael (30/10): a página inicial pede a localização assim que abre. A busca (`perto.html`) continua
  pedindo só no toque. O aviso do Lighthouse sobre "pede localização ao carregar" é esperado na página inicial.
- A posição fica só na memória da página (arredondada, ~110 m): nunca vai para o aparelho, o endereço ou o banco.
- Chaves do aparelho: `imed_cidade` e `imed_cidades_recentes` (cidade escolhida no seletor), `imed_geo_recusas`
  (contagem de recusas), `imed_geo_pedido` (sessionStorage: já pediu nesta aba). A chave antiga `imed_place`
  (bairros de São Paulo) é apagada ao abrir.
- Aviso LGPD: com `data-lgpd-depois` no `<html>`, `assets/js/aviso.js` espera a página chamar `IMED_LGPD.mostrar()`
  (depois da resposta do pedido de localização), ou aparece sozinho em 15 s.
- Botão voltar do celular: mapa em tela cheia e seletor de cidade entram no histórico (`history.pushState` com
  `imedMapa` / `imedCid`), então "voltar" fecha o que está aberto em vez de sair da página.

## Mapa 3D do topo (04/11)
- `assets/js/hero3d.js` (contrato com `inicio.js`: `initHero3D(el, API)` → `setPaused`, `setOrigin`, `refreshLabels`,
  `setTema`, `destroy`, `info`). Biblioteca: **MapLibre GL JS 6.16.0** em `assets/vendor/maplibre` (módulos ES renomeados
  para `.js`, `setWorkerUrl` para o trabalhador do próprio site; LEIA-ME com origem, SHA-256 e licença BSD-3-Clause).
  O three.js saiu do repositório.
- Dados: ladrilhos vetoriais do **OpenFreeMap** (`https://tiles.openfreemap.org/planet`, esquema OpenMapTiles, grátis,
  sem chave, sem cookies; prédios = camada `building`, `render_height`/`render_min_height`, sem `hide_3d`). Prédio sem
  altura no OSM fica com a altura padrão da camada. Estilo feito em JS (`estilo(tema, limites)`), sem letras: não baixa
  fontes nem ícones de lá. Só ladrilhos z14 (`minzoom: 14`), inteiros (`zoomLevelsToOverscale: undefined`), numa área
  de ~1,1 km (computador) ou ~750 m (celular) em volta do ponto (`bounds`): 1 a 4 ladrilhos; no centro de São Paulo cada
  um tem ~250–400 KB pela rede (guardados 10 anos no cache do navegador). Zoom fixo (15,9 / 15,45) dentro do nível 15.
- Desenho: luz do sol presa ao mapa (oeste-sudoeste), sombra de contato (contorno borrado) e sombras longas (polígonos
  calculados em pedaços de 8 ms a partir das alturas, camada `sombras` com `fill-layer-opacity`); claro = dia, escuro =
  noite com ruas âmbar; troca de tema na hora (evento `imed:tema` → `setTema`). Pinos e rótulos são HTML por cima
  (`map.project`), com as mesmas regras de antes (até 2 no celular e 4 no computador, sem cobrir o texto do topo, os
  botões, os créditos ou o "Você está aqui", que fica embaixo do ponto; o rótulo também tenta os lados do pino; pino
  em cima de outro some). Círculo de ~110 m no chão no modo "perto".
- Privacidade: o mapa só abre quando a origem é conhecida (não baixa ladrilhos de outro lugar enquanto espera a
  localização) e parte do ponto arredondado (~110 m). O OpenFreeMap recebe IP e os pedidos dos ladrilhos (está na
  política de privacidade). Créditos à vista em `#heroAttrib` (© OpenStreetMap, © OpenMapTiles, OpenFreeMap).
- CSP do index.html: só `connect-src` ganhou `https://tiles.openfreemap.org` (sem `blob:`, sem `unsafe-eval`).
- Quando falha (sem WebGL 2, biblioteca não baixou, sem a lista de ladrilhos ou nenhum ladrilho em 15 s): `goLite`,
  a versão leve de antes. Aparelho fraco, economia de dados e "reduzir movimento" nem baixam o mapa.
- Testes sem internet: `tests/mapa-simulado.mjs` (TileJSON e ladrilhos MVT de teste montados no próprio teste) nos e2e
  do início, a11y e velocidade; `tests/hero3d.test.mjs` (estilo, área, sombras, CSP, créditos). Fotos reais: Actions →
  "Capturas do site" com `local` (serve o ramo no próprio GitHub) e `telas=mapa3d`.

## Endereço do site (mudança de 10/11/2026)
- A conta antiga do GitHub (`drrafaelpereirabarreto-code`, repo `testedoapp`) foi banida em 10/11/2026. Repo novo:
  `rafael1717-ui/IMED` (maiúsculas); site novo: `https://rafael1717-ui.github.io/IMED/` (o caminho `/IMED/` tem maiúsculas).
- **Fonte única:** `siteUrl` em `assets/js/config.js` (+ `scripts/endereco.json`: `atual` e `anteriores`). Scripts
  (`gerar-cidades`, `aplicar-rodape`, `capturas`, `gravar-video`, `verificar-chaves`), workflows (`url` vazio = config.js)
  e testes (`tests/endereco.mjs`: `SITE`, `ORIGEM`, `CAMINHO`, `PASTA`, `semCaminho`) leem de lá; ninguém escreve o endereço.
- **Trocar (domínio próprio etc.):** `node scripts/trocar-endereco.mjs https://novo/` (idempotente; `--check` só confere;
  `--esquecer=<anterior>`). Troca config, páginas fixas (canônico, og, JSON-LD), 404 (caminho absoluto), README/CLAUDE,
  o bloco `endereco-do-site` das Edge Functions e roda os geradores; no fim lista o que ainda cita um endereço anterior
  (só `PERMITIDOS`: endereco.json, bloco das funções, `.env.example`, `memory/projects`, migrações). `tests/endereco.test.mjs`
  reprova se algo ficar fora. Ramo antigo com conflito de endereço: resolver e rodar o script sem argumentos.
- **Edge Functions (no repo):** `SITE_URL` + `SITE_ANTERIORES` no bloco; `clinicas-proximas`
  aceita as origens do atual e dos anteriores (`defaultOrigins` em `lib.ts`) quando o segredo `ALLOWED_ORIGINS` não existe;
  `link-admin` aceita `redirect_to` em qualquer um deles (padrão: o atual).
- **Produção em 10/11 (lido, não mudado):** `clinicas-proximas` v7 (`verify_jwt=true`, fonte ANTIGA, de antes das chaves
  novas) com o padrão de origens só `https://<conta antiga>.github.io` + localhost; `importar-clinicas` v8 (sem conferência
  de origem; o endereço antigo só no User-Agent); `link-admin` v2 com `SITE` = endereço antigo (redirect fora dele cai no
  padrão antigo). Banco: nenhuma função, view, policy, job ou migração aplicada guarda o endereço do site;
  `private.app_settings` só tem `functions_url` (do Supabase). Não dá para ler daqui se o segredo `ALLOWED_ORIGINS` existe.
- **Produção em 11/11 (publicado, autorizado pelo dono):** `clinicas-proximas` **v8** (`verify_jwt=true`, como antes) =
  a fonte da v7 + o bloco `endereco-do-site`; as origens do site (atual e anteriores) valem SEMPRE, somadas às do segredo
  `ALLOWED_ORIGINS` (exista ele ou não). Cópia exata do que está no ar em `supabase/implantado/clinicas-proximas/`
  (o `trocar-endereco.mjs` mantém o bloco de lá também); a versão com as chaves novas (`supabase/functions/`) segue sem
  publicar. `link-admin` **v3** (`verify_jwt=false`) = `supabase/functions/link-admin/` (retorno no atual e nos anteriores;
  padrão no atual). `importar-clinicas` v8 sem mudança (≈ commit `6c130129`; só o User-Agent cita o endereço antigo).
  Conferido pelo banco (pg_net): Origin novo → 200 (status e busca, só com a chave publishable no `apikey`, como o site
  manda), Origin antigo → 200, origem estranha → 403 `origin_not_allowed`; `link-admin` sem token → 403. As respostas
  de teste (ids 324–330 em `net._http_response`, sem segredo) ficaram: o apagar pediu confirmação que não foi respondida
  (o pg_net limpa sozinho depois de algumas horas).
- **Para o site novo funcionar inteiro** (com o dono): Auth → URL Configuration (Site URL e Redirect URLs
  `https://rafael1717-ui.github.io/IMED/**`); sem isso a entrada por link e "Esqueci a senha" não voltam para o site novo.

## Supabase (`pyoqiecupxhdzigjudyd`)
- Migrações em `supabase/migrations` com o **mesmo número de versão aplicado no banco** (confira `list_migrations` e renomeie o arquivo).
- Edge Functions: `clinicas-proximas` (busca pública: parceiros + CNES + cobertura; Google Places opcional) e
  `importar-clinicas` (importa CNES por cidade; aceita chave service_role ou token interno `x-imed-token`; deploy com `verify_jwt=false`).
- Tabelas principais: `clinics`, `clinic_exams`, `clinic_members`, `appointment_requests`, `reviews`,
  `establishments`, `municipalities`, `establishment_imports`, `establishment_claims`, `import_queue`,
  `partner_leads`, `app_waitlist`, `admin_emails` (quem é admin).
- RPCs públicas: `nearby_clinics`, `nearby_establishments` (filtros p_kind/p_exam/p_sus, p_offset e `total`),
  `establishment_points` (pontos leves da área toda para o mapa, até 5.000), `imported_cities`, `city_establishments`,
  `request_status`, `submit_review`, `place_ratings`, `place_reviews`, `available_slots`.
- Agenda 3.3 (`..._agenda_operacao_parte_1..4`): `agenda_book` (anon), `agenda_cancel`, `agenda_reschedule`, `agenda_my_booking`,
  `agenda_package_options` (anon/logado); `agenda_desk_book`, `agenda_desk_busy(_remove)`, `agenda_set_status` (logado);
  `agenda_hold/confirm/release` (só service_role). INSERT direto com `slot_start` → 23P01; `set_my_schedule` com faixas →
  `managed_by_agenda`. Job `imed-agenda-manutencao` (30 s, `call private.agenda_manutencao()`).
- Agenda 3.4 (`..._agenda_painel_parte_1..3`, na produção): leituras do painel só por função e permissão —
  `agenda_me`, `agenda_version`, `agenda_view` (1–7 dias, "Maria S."), `agenda_month`, `agenda_search` (POST, ≥3 letras),
  `agenda_request_detail` (profissional sem telefone; equipe do IMED com justificativa), `agenda_history`, `agenda_dashboard`,
  `agenda_dashboard_financeiro`, `agenda_conflicts`/`_resolve`; leitura de paciente → `agenda.access_log`. Parte 2: equipe
  (`agenda.member_invites`, `agenda_invite/_cancel/_accept`, `agenda_my_invites`, `agenda_team`, `agenda_member_role/_remove`,
  último dono protegido), `agenda_touch` manda `{v}` por `realtime.send` (tópicos privados `agenda:clinica:<id>` e
  `agenda:imed`; policy em `realtime.messages` via `agenda_realtime_ok`), preço "a partir de" (gatilho em `agenda.procedures`),
  `update_my_clinic`/`set_my_clinic_exams` por permissão, `agenda_anonimizar` (reserva expirada > 7 dias) na manutenção.
  Parte 3: papéis manager/reception/professional/finance em `clinic_members` e policies antigas por `has_clinic_perm`.
- Agenda 4.1 (`20261104184120_agenda_config`, na produção): `agenda_config(p_clinic)` (a configuração inteira para o painel:
  unidade, fuso e confirmação, modalidade, recursos, procedimentos com grupos, regras abre/pausa, regras de pacote, aberturas em
  feriado; só `agenda.configurar` ou `imed.clinicas.configurar`; sem dado de paciente) e `agenda_mode_set(p_clinic, p_mode,
  p_commitment)` (pedido/nativa/manual/externa; `agenda_not_started`, `timezone_not_confirmed`, `commitment_required`,
  externa só com `integracao.gerenciar`, `online_active`; não liga a venda online). pgTAP `370_config.sql`.
- Agenda 4.3 (ramo `ci/agenda-4-3`; migração provisória `20261105190000_agenda_aviso_pedido`, NÃO aplicada): gatilho
  `appointment_requests_aviso` (AFTER INSERT) e `appointment_requests_aviso_situacao` (AFTER UPDATE OF status, só quando a
  situação muda) com `private.agenda_request_inserted` (security definer, `lock_timeout` de 200 ms, engole erro) → pedido
  ANTIGO (`uses_resources = false`) com clínica criado pelo site, cancelado pelo paciente ou respondido pela equipe sobe a
  versão da clínica (`agenda_touch`, que também manda o aviso `{v}`); as funções da agenda nova não passam pelo gatilho (já
  tocam por último, uma vez). pgTAP `355_aviso_pedido.sql`; a espera pela versão presa em `tests/banco/pedido-do-site.mjs`. O painel:
  `assets/js/tempo-real.js` (`createSocket`: Phoenix v1 em JSON, `phx_join` com `access_token`, batimento 25 s, nova tentativa
  1/2/5/10 s, 3 recusas → 1 min, `access_token` reenviado no evento `imed:token` do `auth.js`; `createWatcher`: consulta de
  `agenda_version` a cada 15 s com o canal no ar e 5 s sem, pausa com a aba escondida, confere ao voltar, debounce de 300 ms,
  só versão maior recarrega; `startClinicWatcher` no `painel.js`, um por clínica, avisa pela janela `imed:agenda-mudou`
  {clinicId, version, reason} e `imed:agenda-estado`). Na produção `realtime.messages` segue sem partição (05/11): o aviso
  fica no log e vale a consulta periódica; o site nunca promete "tempo real" (R2-18).
- Agenda 4.4 (ramo `ci/agenda-4-4`; migração provisória `20261110190000_agenda_central`, NÃO aplicada; só CREATE FUNCTION,
  REVOKE e GRANT): `agenda_central_version` (soma das versões, última mudança, clínicas com agenda, conflitos abertos),
  `_overview` (todas as clínicas, até 500, as ativas primeiro; `selling`/"Vendendo horário online" com a regra do motor:
  venda ligada + publicada + aceita pedidos + não é demonstração; só a data = "venda ligada, pausada"), `_conflicts(p_all)` (até 200; sem pedido nem item),
  `_audit(p_filters {days, clinic, object_type, actor})` (`audit_log` sem old/new + `access_log` somado por dia, clínica,
  conta, função, escopo e motivo; conta = 8 primeiros caracteres do id), `_settings`/`_setting_set` (lista em
  `private.agenda_central_params()`: hoje só `agenda.limite_futuros_por_telefone`, padrão 3, de 1 a 20; gravar é só admin e vai
  para a auditoria como `parametro.definir`/`parametro.padrao`), `_holidays`/`_holiday_preview(p_day)` (lançar e retirar
  continuam em `agenda_holiday_save`/`_remove`, da 3.2), `_staff`/`_staff_grant(e-mail, papel)`/`_staff_revoke(user, papel)`
  (só admin; `private.imed_staff`, origem `central`, auditoria pelo gatilho da 3.1). Permissões: leitura
  `imed.agenda.monitor`; auditoria `imed.auditoria.ver`; prévia `imed.feriados.editar`. Nenhuma função antiga trocou
  `is_imed_admin` por `imed_has` (não foi preciso). pgTAP `130_central.sql` (89 testes). A tela: `gestao-central.js`
  (abas com teclado, tabelas que viram cartões, conferência antes de lançar feriado, rascunho dos formulários preservado),
  nomes dos códigos e validação em `gestao-core.js`; `startCentralWatcher` (`tempo-real.js`): canal `agenda:imed` + consulta
  de `agenda_central_version` a cada 30 s, relê só Clínicas e Conflitos, para com a aba escondida e ao sair da conta. O
  `gestao.html` continua só admin (`is_imed_admin` no `checkAdmin`); as funções já aceitam os papéis da equipe.
- Agenda 5.1 (ramo `ci/agenda-5-1`; migração provisória `20261111120000_agenda_app`, NÃO aplicada; só CREATE FUNCTION e
  ALTER FUNCTION ... SET statement_timeout): `agenda_next_free(p_clinics uuid[], p_exam, p_days)` → (clinic_id,
  procedure_id, exam_code, slot_start, slot_end, timezone, agenda_mode): até 10 clínicas distintas (as primeiras), 1 a 14
  dias, código de exame `^[a-z_]{1,20}$`; só clínica publicada, aceitando pedidos, não fictícia, com agenda nova e
  `agenda_online_since`; procedimento padrão do exame (ou todos do exame; sem exame, até 6); atalho por `agenda_free_map`
  (recurso sem nenhum tempo livre no prazo nem passa pelo motor); motor (`agenda_free_starts`) em 2 janelas (hoje;
  amanhã em diante); `statement_timeout` 3 s; anon e authenticated. Tempo-limite de 2 s em `agenda_public_info`,
  `agenda_my_booking`, `available_slots` e `clinics_with_schedule` (pela API o PostgREST aplica o da função). A marcação
  continua em `agenda_book` (3.3), com o limite do papel. pgTAP `410_app.sql` (38); desempenho: 10 clínicas, 9 só com
  buracos menores que o exame, meta p95 < 300 ms. Nenhuma função liga a venda online: a clínica piloto é ligada pela
  equipe (UPDATE com `imed.origin = 'sql'` e motivo, registrado), com a aprovação do dono.
- RPCs logadas: `set_request_status`, `update_my_clinic`, `set_my_clinic_exams`, `approve_claim`, `reject_claim`, `is_imed_admin`.
- Teleconsulta (`..._teleconsulta`, `..._tele_documentos`): tabelas `doctors`, `doctor_checks`, `teleconsultations`,
  `tele_messages`, `tele_record_*`, `tele_access_log`, `tele_documents`, `tele_document_files`; tudo por funções `tele_*`
  (paciente com id + token; médico aprovado; admin). Quem lê prontuário: `tele_record_readers`. Job `imed-teleconsulta-expira`.
  Receita só simples (antibiótico/controlados bloqueados: SNCR da Anvisa). Versão do termo em `tele-core.js` (TCLE_VERSION) e no SQL.
- Gestão (`20261030163758_gestao`): `admin_gestao(p_days)` (todos os números do painel, contrato no comentário da
  migração), `admin_cobranca_listar/salvar/status` e as tabelas `private.billing_charges` e `private.billing_charge_log`
  (histórico só de situação, valor, vencimento e pagamento). Tudo confere `is_imed_admin`. O site não recebe pagamento:
  a equipe registra as cobranças feitas por fora.
- Painel do médico (`20261030191354_painel_medico`): `tele_painel_medico()` (só médico aprovado; 7 números, nenhum dado
  de paciente) e `admin_gestao` com a chave `agora` (aguardando, espera mais longa, em atendimento, médicos disponíveis).
- Confiança/visitas (`..._confianca`, `..._visitas`): `cancel_request`, `send_contact`, avisos de erro de locais,
  conferência de clínica, `cnes_last_update(p_city)`, `track` (contador agregado em `private.*_daily`), `admin_stats`.
- pg_cron: `imed-fila-importacao` (a cada minuto, 2 cidades) e `imed-atualizacao-mensal`. A fila tem 316 cidades
  (capitais, grandes e as de ~100 mil habitantes ou mais); `imported_cities()` → `scripts/cidades.json` → `node scripts/gerar-cidades.mjs`.
- Segurança (migração `20261030074604_seguranca`, mudada em `20261105030413_entrada_senha`): `is_imed_admin` só vale
  para a conta certa, com e-mail confirmado, só provedor e-mail (sem Google etc.), sem celular, não anônima; a sessão
  pode ser pelo link do e-mail (otp/magiclink/recovery) OU por senha (desde 05/11; sessão anônima continua recusada).
  O mesmo vale para `private.agenda_secure_session` (`imed_has`, convites da equipe). Depois da 1ª entrada do admin
  rode `select * from private.vincular_admin();`. `submit_review` usa `is true` (sem brecha de nulo). Quem mexer nessas
  funções mantém as regras. pgTAP: `110_papeis.sql` e `340_equipe.sql` (senha vale, anônimo não).
- Acesso da equipe sem e-mail (05/11): o Auth do Supabase não envia e-mail (SMTP/Resend sem domínio verificado →
  500 em `/otp` e `/recover`; sem SMTP, 2 e-mails/h). A Edge Function `link-admin` (`supabase/functions/link-admin/`,
  `verify_jwt=false`, só com `x-imed-token` de `private.app_tokens` e só para `public.admin_emails`) gera o link
  `magiclink` ou `recovery` (`redirect_to` só dentro do site) via `auth/v1/admin/generate_link`; chamada pelo SQL com
  pg_net (receita no cabeçalho do arquivo), link lido em `net._http_response` (apagar depois) e mandado por fora
  (Gmail do dono). O Site URL do Auth ainda é `http://localhost:3000`: link sem `redirect_to` cai lá (aconteceu em 03/11).
- Entrada sem redirecionamento (12/11, `link-admin` **v4**): os links de 05/11 nunca foram usados (ninguém entrou de
  03/11 a 12/11), porque o Auth devolve a pessoa para um endereço que não é o do site. Agora a resposta da função traz
  `site_link` = `<site>/definir-senha.html#token_hash=<código>&type=recovery` (ou `painel.html…&type=magiclink`): o
  PRÓPRIO SITE troca o código pela sessão (`auth.js`, `handleRedirect` → `POST /auth/v1/verify` com `{type, token_hash}`),
  sem passar pela URL Configuration do Auth. Vale 1 h e 1 uso; código malformado nem chama o servidor; vencido/usado
  avisa e mostra o quadro de pedir outro. A função também **cria a conta** do e-mail de `admin_emails` que ainda não
  existe em Authentication (e-mail confirmado, sem senha; `created: true`). Mandar sempre o `site_link`, nunca o `link`
  antigo (usar um gasta o outro). Depois da entrada: `select * from private.vincular_admin();`. Teste: `e2e-senha.mjs`.
  A URL Configuration e o SMTP continuam pendentes do dono para clínicas e pacientes (link por e-mail).

## Limitações conhecidas do ambiente do Claude
- A sessão na nuvem não acessa supabase.co, IBGE, CNES nem Photon diretamente; usar o conector Supabase (SQL/MCP).
- Overpass/Nominatim bloqueiam servidores do Supabase → OpenStreetMap roda no navegador.
- Para testar chamadas HTTP pelo banco: extensão `http` (instalar só para o teste e remover depois).
- No modo automático, envio forçado (`push -f`) é bloqueado: a cópia de segurança em `wip/melhorias` é um commit com
  dois pais (HEAD e a ponta antiga da wip), enviado sem forçar. Commits de trabalho de agentes: testar e
  commitar a partir de uma `git worktree` limpa e depois `git reset <commit>` (sem --hard) na pasta principal.
- O registro das execuções do GitHub (logs e artifacts) fica num armazenamento bloqueado daqui. Para ver por que um
  teste falhou: `gh api repos/<repo>/check-runs/<job>/annotations` — o testes.yml põe em cada aviso até 14 linhas do erro.
  Cada envio para a main cancela a execução de testes anterior que ainda estiver rodando (concurrency).
- Os mapas (OpenStreetMap, OpenFreeMap) também ficam bloqueados daqui: o vídeo de divulgação e as fotos do mapa 3D
  são feitos no GitHub (capturas.yml com `local` para um ramo).

## Vídeo de divulgação
- `scripts/gravar-video.mjs` (Playwright + ffmpeg) grava o site no ar com dados reais: início, mapa com locais reais,
  busca de ressonância, resultados, página do local, médico responsável e cartão final. Não envia pedido e não conta
  visita. A teleconsulta fica de fora até a inscrição no CREMESP.
- Rodar: Actions → "Vídeo de divulgação" → Run workflow (`gh workflow run video.yml -f formatos=vertical,horizontal`).
  O resultado vai para o ramo `video/execucao-N` (baixar com `git fetch --depth 1 origin refs/heads/video/execucao-N`).
- Escala de verdade no Chromium (`--force-device-scale-factor`, sem viewport emulado): com a escala só emulada os
  quadros saem pequenos. No computador grava com "movimento reduzido": a cidade 3D sem placa de vídeo deixa a página
  quase parada (no celular ela é menor e gira normalmente).

## Testes
```bash
node --test tests/*.test.mjs
node --experimental-strip-types --test supabase/functions/*/lib.test.ts
node tests/e2e-perto.mjs   # e e2e-inicio, e2e-local, e2e-conta, e2e-clinica
```
- `E2E_PORT=<porta>` roda um e2e em outra porta (para rodar em paralelo); `ONLY="trecho"` no e2e-perto roda só alguns cenários.
- **Banco de verdade (iMed Agenda 3.0):** `.github/workflows/banco.yml` (separado do `testes.yml`; roda em envio para a
  `main` ou `ci/**` que mude `supabase/**`, `tests/banco/**`, `assets/js/geo-core.js` ou o próprio arquivo, e à mão pela
  API: `gh api -X POST repos/<repo>/actions/workflows/banco.yml/dispatches -f ref=<ramo>`; `gh workflow run` não
  funciona daqui). Versões presas: CLI do Supabase 2.121.0, ações pelo commit, Node 22.23.4 e o `pg` por
  `tests/banco/package-lock.json` (`npm ci --prefix tests/banco --ignore-scripts`). Passos: laço local; fecha a saída
  dos contêineres para a internet; **F0** = `supabase start` (Postgres 17, Auth, PostgREST, Realtime, Kong e Edge
  Runtime; `-x` tira studio, imgproxy, storage-api, logflare, vector, mailpit, postgres-meta e supavisor) só com as
  migrações que já estão na produção (as que têm volta saem da pasta), com um vigia que desliga cada job do pg_cron
  assim que uma migração o cria; prova a trava de rede (2 pedidos do pg_net para IP de fora têm de falhar); **F1** =
  `supabase migration up --local` com as que têm volta; `supabase test db` (pgTAP em `supabase/tests/`: `000_catalogo`
  guardas de RLS, private fechada até por coluna, views, Realtime, extensões em public, as 23 colunas do pedido do site
  com INSERT, search_path, permissões de cada função de public, nada de endereço de internet no código, só a fila chama
  `net.http_*`; `005_preparo`; `010_pedidos_atuais`); os scripts `tests/banco/*.mjs` (`concorrencia-atual.mjs` agora prova que o defeito antigo
  sumiu (invertido na 3.3); `concorrencia.mjs` = teste 1 (80 conexões, 300 POST; o CI usa `max_connections` 200); `pedido-do-site.mjs` monta o pedido com o próprio `geo-core.js` e
  manda pelo PostgREST como visitante e logado); a volta (`supabase/volta/<mesmo nome>.sql`) tem de deixar o banco
  igual a F0, e a reaplicação, igual a F1 (impressão digital); no fim, qualquer resposta da internet registrada pelo
  banco reprova. Migração mais nova que `20261030191354` sem volta reprova. Falhas viram avisos com as linhas do erro
  (`tests/banco/anotar.mjs`) e o fim deixa as notas "Resumo do banco" (serviços e imagens, trava de rede, p95, 40P01,
  57014, impressão digital): `gh api repos/<repo>/actions/runs/<run>/jobs` e
  `gh api repos/<repo>/check-runs/<job>/annotations` (o registro completo e os artifacts não abrem daqui).
- **Nunca** use `supabase/` com a produção: nada de `supabase link`, `config push`, `db push` ou `migration up --linked`
  (o `config.toml` é de TESTE: gravaria `site_url` de 127.0.0.1 e outros valores locais na produção). Migração na
  produção só pelo conector, aprovada pelo dono; depois, renomear o arquivo (e a volta) com a versão gravada e só então
  juntar o ramo na `main`. Migração em partes aplicadas em dias diferentes (4.2: `agenda_leitura_parte_1` e `_2`): cada
  parte tem a própria volta; ao aplicar uma parte, renomear também as seguintes (e as voltas) para versões provisórias
  depois dela, e só então trocar `ULTIMA_NA_PRODUCAO` (o `banco.yml` reprova "Partes fora de ordem"). Toda migração não
  aplicada leva a marca `NOME PROVISÓRIO` no cabeçalho e o nome na lista `PENDENTES_NA_PRODUCAO` do `banco.yml`; ao
  aplicar uma, os 5 passos escritos ao lado dessa lista (renomear com a versão gravada, tirar a marca, tirar da lista,
  renomear as outras provisórias para depois dela, trocar `ULTIMA_NA_PRODUCAO`); o que faltar, o `banco.yml` reprova
  ("Provisória fora do lugar" ou "Provisória antes da produção").
  Estado em 05/11/2026: a parte 1 está na produção como `20261105050257_agenda_leitura_parte_1` (md5 do arquivo igual
  ao de `schema_migrations.statements`); a parte 2 (`20261105050258_agenda_leitura_parte_2`, nome provisório) ainda
  NÃO foi aplicada — fecha a leitura direta de pedidos/horários/bloqueios pela clínica (REVOKE + policies `false`) e
  só entra com nova autorização do dono.
- **Impressão digital** (`tests/banco/catalogo.sql`, só SELECT): uma linha por objeto (função, tabela, policy,
  job...) com hash da definição normalizada. O resumo por tipo sai no "Resumo do banco" para F0 e F1. Para conferir a
  produção: rodar no conector o SELECT de resumo
  (`select split_part(linha,' ',1), count(*), left(md5(string_agg(linha, chr(10) order by linha collate "C")),12)
  from (<catalogo.sql sem o order by do fim>) z group by 1`) e comparar; para achar o objeto que difere, rodar o
  banco.yml à mão com `-f 'inputs[impressao]=funcao,tabela'` (ou `todos`; linhas em notas). Conferido em 31/10/2026:
  F0 deu o MESMO resumo da produção nos 10 tipos (527 objetos); depois que o preparo for aplicado lá, o resumo da
  produção tem de bater com F1.
- Função nova em `public`: acrescente a linha com quem pode executar em `supabase/tests/000_catalogo.sql` (senão reprova).
  Migração nova a partir da 3.0: escreva também a volta em `supabase/volta/` com o mesmo nome (senão reprova).
- **Laço rápido do banco (sem Docker, segundos):** `npm ci --prefix tests/banco --ignore-scripts` e
  `node tests/banco/local/rodar.mjs` (casos do §3.4 da arquitetura; `--concorrencia` para 40 e 100 ao mesmo tempo com
  e sem trava por recurso, remarcação com COMMIT e ROLLBACK e sala com 2 vagas; `<modo>:N` escolhe N; `--sem-limite`
  tira os 3 s do anon). Usa o PostgreSQL 16 da máquina (initdb numa pasta temporária, porta livre; como root roda como
  o usuário `postgres`). Detalhes em `tests/banco/local/README.md`.
- Celular: no modo celular do Playwright, quando algo passa da tela o navegador afasta o zoom e o `innerWidth` cresce
  junto; para conferir rolagem lateral, medir contra a largura configurada (ex.: 360), não contra `innerWidth`.
- GitHub Actions (`.github/workflows/testes.yml`) roda tudo a cada envio para a main; veja com `gh run list`.
