# Arquitetura do IMED (referência técnica)

## Páginas
| Arquivo | Para quê |
|---------|----------|
| `index.html` | Início: topo com a foto de satélite (com a chave da Esri) ou o mapa 3D com os prédios reais (`assets/js/hero3d.js`), "Clínicas perto de você" (#reais: os 10 mais perto, abas por tipo, mapa e seletor "Onde você está?"), agendados, lista de espera |
| `assets/js/inicio-perto.js` + `inicio-core.js` | Início "perto de você": pede a localização ao abrir (1 vez por aba; não pede sozinho depois de 2 recusas ou pedidos sem resposta), lista e mapa (no celular, mapa em tela cheia só depois do toque), seletor de cidade. Regras puras em `inicio-core.js` (testadas em `tests/inicio-core.test.mjs`; posição simulada nos e2e com `tests/geo-simulado.mjs`) |
| `perto.html` + `assets/js/perto.js` | Busca por localização/CEP: mapa, lista, filtros, detalhes, pedido |
| `assets/js/geo-core.js` | Regras puras (normalizar, filtrar, ordenar, pedido) — testadas em `tests/geo-core.test.mjs` |
| `assets/js/exames-nomes.js` | Dicionário de nomes de exames (nome popular, sigla, uma letra errada → código da busca; "eco" e doença sozinha perguntam). Baixado só quando a pessoa digita (início, busca e área do médico); testes em `tests/exames-nomes.test.mjs` |
| `assets/js/auth.js` | Login por link mágico ou por e-mail e senha (Supabase Auth via REST) para conta, painel, reivindicação, médico e gestão: `signIn` (otp), `signInWithPassword`, `recover` (link de recuperação → `definir-senha.html`), `setPassword` (PUT /auth/v1/user), `handleRedirect` (link `type=recovery` em qualquer página leva para `definir-senha.html#definir`) |
| `assets/js/entrada-senha.js` | Bloco "Entrar com senha" / "Esqueci a senha" posto no fim de cada quadro de entrada (`clinica.js` `renderAuth` com `onSignIn`, `medico.js`, `conta.js`); estilo injetado uma vez (`#es-css`); nunca guarda a senha |
| `definir-senha.html` + `assets/js/definir-senha.js` | Definir ou trocar a senha: com sessão (link de recuperação ou já logado) pede a senha 2 vezes (mín. 8) e salva; sem sessão pede o link de recuperação. `noindex`. Teste: `tests/e2e-senha.mjs` (também no `e2e-a11y`) |
| `parceiros.html` | Cadastro de clínicas/médicos parceiros (`partner_leads`) |
| `painel.html` + `assets/js/painel.js` | Área da clínica. Quem sou por `agenda_me` (só os próprios vínculos; banco sem a função: `clinic_members` filtrado pelo `user_id`); abas por permissão (`agenda-core.js` `clinicTabs`): Pedidos (lista por `agenda_requests`, com registro de leitura; reserva: leitura direta enquanto a parte 2 da 4.2 não fecha), Agenda (4.2: `assets/js/agenda.js`, baixado só ao abrir a aba — dia/semana/mês, legenda, filtros, busca, balcão, "só ocupar", detalhe e histórico, cancelar/remarcar, chegada/atendimento/falta, bloqueios com a lista de afetados e "bloquear mesmo assim"; funções `agenda_catalog`, `agenda_free`, `agenda_desk_slots`, `agenda_blocks`, `agenda_block_force`, `agenda_attend`), Configuração (`agenda-config.js`), Dados, Exames e preços, Equipe; convites para a conta (`agenda_my_invites`/`_accept`) no topo. Profissional vê só a própria agenda (escopo `propria`); financeiro ainda sem aba (4.3) |
| `assets/js/agenda-config.js` + `agenda-core.js` | iMed Agenda 4.1: aba Agenda (configuração rápida que cria unidade, recursos, procedimentos e regras de verdade; unidade e fuso; modalidade com compromisso; horários da unidade; aparelhos/salas/profissionais; exames com grupos e preço com conferência L11; conferir horários livres por `agenda_slots`) e aba Equipe (convites, papéis, último dono). Mudança que tira agendamento do lugar mostra quantos e pede "Salvar mesmo assim" (`p_confirm`). Bloqueios da unidade continuam no `painel.js` (`add_my_block`). Regras puras testadas em `tests/agenda-core.test.mjs`; tela em `tests/e2e-agenda-config.mjs` (1024 e 390 px, teclado, tema escuro, relógio fixo). MFA desligado: **decisão 17 pendente do dono** (quando decidir, entra no `auth.js` e as funções de equipe/integração passam a exigir `aal2`) |
| `exames/` | Guias de preparo dos exames |
| `privacidade.html` | Política de privacidade (LGPD) |
| `sw.js` | Service worker: scripts/páginas pela internet primeiro; suba `VERSION` a cada mudança |
| `teleconsulta.html` + `assets/js/teleconsulta.js` | Paciente: termo, fila, vídeo (WebRTC direto, sinalização pelo banco), chat, resumo e documentos |
| `medico.html` + `assets/js/medico.js` | Médico: cadastro, fila, atendimento, documentos (PDF com `assets/vendor/pdf-lib`, QR) e admin (aprovar médicos) |
| `assets/js/tele-core.js`, `assets/js/tele-docs.js` | Regras puras da teleconsulta e dos documentos (testadas em `tests/tele-*.test.mjs`) |
| `documento.html` | Conferência pública de documento pelo código (só tipo, data, médico, iniciais, situação) |
| `gestao.html` + `assets/js/gestao.js`, `gestao-core.js` | Painel de gestão só do admin (`noindex`, fora da navegação, sem contador): pacientes atendidos, funil do paciente, entrada de médicos (fluxograma com números) e clínicas, resultados, faturamento e cobrança (registro manual, CSV). Gráficos SVG feitos à mão, com tabela em "Ver em tabela" |
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

## Mapa 3D do topo (04/11; sem a chave da Esri — com ela, veja "Foto de satélite")
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
- **Edge Functions (só no repo, nada publicado em 10/11):** `SITE_URL` + `SITE_ANTERIORES` no bloco; `clinicas-proximas`
  aceita as origens do atual e dos anteriores (`defaultOrigins` em `lib.ts`) quando o segredo `ALLOWED_ORIGINS` não existe;
  `link-admin` aceita `redirect_to` em qualquer um deles (padrão: o atual).
- **Produção em 10/11 (lido, não mudado):** `clinicas-proximas` v7 (`verify_jwt=true`, fonte ANTIGA, de antes das chaves
  novas) com o padrão de origens só `https://<conta antiga>.github.io` + localhost; `importar-clinicas` v8 (sem conferência
  de origem; o endereço antigo só no User-Agent); `link-admin` v2 com `SITE` = endereço antigo (redirect fora dele cai no
  padrão antigo). Banco: nenhuma função, view, policy, job ou migração aplicada guarda o endereço do site;
  `private.app_settings` só tem `functions_url` (do Supabase). Não dá para ler daqui se o segredo `ALLOWED_ORIGINS` existe.
- **Para o site novo funcionar inteiro** (com o dono): ligar o Pages do repo novo; Auth → URL Configuration (Site URL e
  Redirect URLs `https://rafael1717-ui.github.io/IMED/**`); publicar `clinicas-proximas` e `link-admin` (ou, na função
  antiga, trocar só a linha do padrão de origens). Sem a origem nova, a busca do site novo recebe 403/CORS da função e usa
  o plano B (funções do banco direto), sem geocodificação de CEP/endereço pela função.

## Foto de satélite no topo e nos mapas (05/11; ramo `site/mapa-realista`, NÃO publicado: espera a chave e a aprovação)
- Pedido do Dr. Rafael: o 3D "parece desenho, perde a credibilidade"; quer a **foto aérea real**, de cima, com a
  pessoa, os locais reais, a distância e o prédio. Fonte escolhida: **Esri World Imagery** pelo ArcGIS Location
  Platform, com **chave gratuita** (nenhuma fonte sem chave serve — avaliação no fim desta seção).
- **Como funciona.** `IMED_CONFIG.satelite` em `assets/js/config.js` (`chave`, `url` com `{z}/{y}/{x}` e `{chave}`,
  `maxZoom` 19, `attribution`) e `IMED_CONFIG.sateliteUrl()` (`''` sem chave). **Sem chave o site é o de antes**
  (3D no topo, OpenStreetMap nos mapas, nenhum pedido à Esri; teste confere). Com chave:
  - Topo (`hero3d.js`, modo satélite; `body[data-hero="satelite"]`): `estiloSatelite()` = raster da Esri (256 px) +
    camada invisível `predios-base`, que faz baixar o ladrilho z14 do OpenFreeMap numa área de ~400 m (quase sempre 1)
    só para os **contornos** (`contornos()`: o polígono da camada `building` que contém o ponto do local; o maior
    quando há partes; local na rua ou sem desenho fica sem contorno) + `eu-area` (110 m) + `locais-chao`. Vista de
    cima (pitch 0, norte para cima), **sem giro nem animação**; enquadramento `enquadrar()` = pessoa + locais mais
    perto que couberem (zoom 15,6–17,2 no computador, 15,2 no celular), com as margens dos rótulos; se não cabem, a
    pessoa no meio. Gestos só explícitos: `cooperativeGestures` do MapLibre (Ctrl/⌘ + rolagem, dois dedos; textos em
    português em `TEXTOS_PT`; CSS da tela em index.html), arrastar com o mouse, botões `#heroZoom` + e − (44 px, texto,
    sem ícone); sem "Pausar animação" nem `.hero-hint` de girar (texto muda por JS). Chave recusada (498/499 em 3
    pedaços sem nenhum recebido) ou serviço fora → versão leve na hora (sem os 15 s), com aviso no console. Créditos em
    `#heroAttrib`: `satelite.attribution` ("Powered by Esri · Esri, Maxar, Earthstar Geographics, and the GIS User
    Community") + "Contornos: © OpenStreetMap · © OpenMapTiles · OpenFreeMap". `info()` ganha `modo`, `contornos`,
    `locais`, `gestos`, `mexeu`, `errosFoto`. O tema não muda a foto (só rótulos).
  - Outros mapas (`assets/js/mapa-fundo.js`, `fundoDoMapa(L, map, { padrao, posicao })`): botões **"Mapa | Satélite"**
    (`.mapa-fundo`, `aria-pressed`, 44 px, CSS em `tema.css`), foto no pane `satelite` (sem o filtro escuro do tema:
    `.leaflet-satelite-pane{filter:none}`), escolha guardada em `localStorage imed_mapa_fundo` e válida para o site
    inteiro. Padrão **satélite** no bloco "Clínicas perto de você" e em `local.html`; **mapa** em `perto.html`
    (a área vai a 50 km). Sem chave: sem botões. O mapa do local ganhou + e − em português com 44 px.
  - CSP: `https://ibasemaps-api.arcgis.com` em `img-src` (index, local, perto) e em `connect-src` só no index (o
    MapLibre busca os pedaços por fetch). `privacidade.html`: item "Esri" em "Serviços fora do Brasil".
- **Testes** (sem internet): `tests/mapa-simulado.mjs` — `simularSatelite(context, { invalida, log })` põe a chave de
  teste no `config.js` servido à página e devolve pedaços PNG gerados (ou 499 "Invalid token"); `predioEm(lat, lng)` e
  `ladrilhoDe()` dizem onde o contorno vai aparecer. `tests/hero3d.test.mjs` (estilo, contornos, config sem chave, CSP,
  privacidade, sw). Cenários "foto de satélite" em `e2e-inicio` (5), `e2e-local`, `e2e-perto`, `e2e-a11y` (3 páginas) e
  `e2e-velocidade` (1). `scripts/capturas.mjs` (`telas=mapa3d`) fotografa o modo que estiver no ar e grava os bytes.
- **Dados no 1º acesso** (ainda só com pedaços simulados; o real sai do `capturas.yml` em `mapa3d-*.json`):
  computador ~20 pedaços da foto, celular ~9–16, + 1 ladrilho do OpenFreeMap para os contornos. Estimativa com a
  foto real (JPEG z16–17 da Esri, 15–40 KB cada): celular ≈ 300–600 KB de foto + 250–400 KB do ladrilho + MapLibre
  (295 KB comprimido) — parecido com o 3D de hoje (1 a 4 ladrilhos de 250–400 KB + MapLibre).
- **Passo a passo para o Dr. Rafael (chave gratuita da Esri):**
  1. Criar a conta gratuita em https://location.arcgis.com (ArcGIS Location Platform; sem cartão).
  2. No painel da conta → "API keys" → nova chave ("API key credential"): em privilégios marque só **Basemaps**
     (Location services); em **Referrers** ponha `https://drrafaelpereirabarreto-code.github.io/*` (e o domínio
     próprio quando tiver); validade: a maior que o painel aceitar (a chave expira — anotar a data para renovar).
     Copie a chave (começa com `AAPT`).
  3. Colar em `assets/js/config.js` → `satelite: { chave: 'AAPT…', …}`. É uma chave pública (vai no site, como a
     publishable do Supabase), presa ao endereço do site. Depois: testes, `VERSION` do `sw.js`, commit e push na main.
  4. Deixar **pay-as-you-go desligado** (é o padrão): passando de 2 milhões de pedaços/mês a foto só para de
     responder (o site volta ao 3D e ao mapa desenhado sozinho), sem cobrança.
  5. Conferir no site: foto no topo e botões "Mapa | Satélite". Se não aparecer e o console disser "Mapa 3D
     indisponível: satelite HTTP 498/499", a chave ou o referrer estão errados; "HTTP 403/404": conferir o endereço
     `satelite.url` na documentação da Esri (basemap styles service, World Imagery raster).
  6. Fotos reais antes de publicar: Actions → "Capturas do site" no ramo, `local=true`, `telas=mapa3d` e a chave em
     `chave_satelite` (ou o segredo `SATELITE_CHAVE`): ela entra só na cópia servida na máquina do GitHub; a chave
     precisa aceitar também o referrer `http://127.0.0.1:8080/*` (pode ser uma segunda chave só para isso).
- **Avaliação das fontes (05/11/2026, pela web; os sites da Esri, EOX e o wiki do OSM não abrem desta sessão):**
  - Esri World Imagery sem chave (`server.arcgisonline.com/.../World_Imagery/MapServer/tile`): a melhor resolução no
    Brasil (0,3–1 m; metrópoles 30 cm) e funciona, MAS o README oficial do Esri Leaflet diz "you'll need to license
    your usage with an API key or an ArcGIS identity", o leaflet-providers lista a Esri entre os que exigem cadastro e
    o serviço antigo está deprecado. Com a chave gratuita (2 milhões de pedaços/mês ou 1.000 "basemap sessions"/mês;
    uso comercial permitido) é permitido, com "Powered by Esri" + provedores.
  - EOX Sentinel-2 cloudless: 10 m/pixel (não se vê prédio); mosaico 2024 CC BY-NC-SA. NASA GIBS: 30–250 m. Bing:
    contas grátis desligadas em 30/06/2025. Google: só com chave e faturamento (sem chave viola os termos; o Embed é
    grátis, mas iframe sem os nossos pinos). MapTiler: chave, plano grátis só não comercial. Mapbox: chave, 50 mil
    carregamentos/mês. Complemento possível só para a capital: ortofotos abertas do GeoSampa.

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
  depois dela, e só então trocar `ULTIMA_NA_PRODUCAO` (o `banco.yml` reprova "Partes fora de ordem").
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
