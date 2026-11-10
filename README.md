# IMED

Marketplace de saúde: clínicas de imagem, laboratórios e centros de diagnóstico perto de você, com pedido de agendamento e teleconsulta. Protótipo publicado em <https://rafael1717-ui.github.io/IMED/>.

## Arquitetura

| Parte | Tecnologia | Onde |
| --- | --- | --- |
| Site e app instalável (PWA) | HTML, CSS e JavaScript sem etapa de build, GitHub Pages | raiz do repositório |
| Mapa interativo | Leaflet 1.9.4 (copiado em `assets/vendor/leaflet`) com imagens do OpenStreetMap | `perto.html` |
| Banco de dados | Supabase (PostgreSQL + PostGIS), região São Paulo | `supabase/migrations` |
| Servidor da busca | Supabase Edge Function `clinicas-proximas` (Deno) | `supabase/functions/clinicas-proximas` |
| Clínicas reais (cadastro oficial) | CNES do Ministério da Saúde, importado por cidade pela Edge Function `importar-clinicas` | `supabase/functions/importar-clinicas` |
| Estabelecimentos do mapa | CNES no banco; Google Places API (New), se a chave estiver no servidor; OpenStreetMap (Overpass) enquanto a cidade ainda não foi importada | — |
| CEP, cidade e endereço | ViaCEP e BrasilAPI (CEP) + Google Geocoding ou Photon (OpenStreetMap) | — |

Páginas principais:

- `index.html` + `assets/js/inicio.js`: página inicial só com dados reais (cidade 3D com estabelecimentos do CNES, mapa "Clínicas reais perto de você", categorias de exame, cidades, "Agendados" com a situação real dos pedidos, teleconsulta "em breve" com lista de espera).
- `perto.html`: busca por localização ou por CEP, cidade ou endereço. Mapa, lista, selos ("Parceiro verificado" e "Cadastro oficial"), filtros (tipo, exame, especialidade, distância, preço, SUS, convênio), faixa de preço por exame, avaliações, detalhes e pedido de agendamento com "Adicionar à agenda" (.ics com o preparo). Aceita `?exame=<código>`.
- `conta.html`: conta do paciente (login por link no e-mail), pedidos da conta e do aparelho, avaliação de pedidos concluídos.
- `reivindicar.html`: a clínica encontra o próprio estabelecimento do CNES e pede para assumir o cadastro (aceita `?cnes=`).
- `painel.html`: área da clínica (pedidos, situação, dados, convênios, horários, exames e preços) e, para a equipe do IMED, aprovação dos pedidos de cadastro e pedidos de locais não parceiros.
- `local.html`: página própria de cada local (`?cnes=<código>` para o cadastro oficial, `?id=<uuid>` para parceiro), com mapa, contatos, exames, convênios, avaliações, dados estruturados para o Google e, nos parceiros com agenda, escolha do horário com confirmação na hora. A busca abre um local direto com `perto.html?local=cnes:<código>` ou `?local=imed:<uuid>`.
- `sobre.html` e `termos.html`: quem somos (responsável técnico médico) e termos de uso.
- `cidades/`: páginas por cidade e por tipo, geradas por `scripts/gerar-cidades.mjs` (para o Google), com `sitemap.xml` e `robots.txt`.
- `parceiros.html`: cadastro de clínicas e médicos interessados em parceria.
- `exames/`: guias de preparo dos exames.

## Como funciona a busca "perto de mim"

1. A pessoa toca em **Encontrar clínicas perto de mim** (`perto.html?usar=localizacao`). O navegador pede a permissão de localização. Se a pessoa entrar direto em `perto.html`, a página explica o uso da localização e só pede a permissão depois de um toque.
2. A posição é arredondada para 3 casas decimais (cerca de 110 m) assim que chega e fica só na memória da página. A localização precisa não é pedida (`enableHighAccuracy: false`).
3. O site chama a Edge Function `clinicas-proximas` com a ação `search`. A função consulta o banco pela função `nearby_clinics`, que devolve as clínicas IMED publicadas dentro do raio, ordenadas pela distância real (PostGIS `ST_DWithin` + `ST_Distance`). Se a chave do Google estiver configurada, a função também busca no Google Places.
4. Sem a chave do Google, o próprio navegador busca os estabelecimentos no OpenStreetMap (Overpass). Os servidores públicos do OpenStreetMap recusam pedidos vindos de servidores em nuvem, e essa busca não precisa de chave.
5. O site junta as fontes e não repete no mapa uma clínica que já é parceira. Ele classifica cada estabelecimento (imagem, laboratório, clínica ou hospital) e reconhece os exames pelo nome. Os filtros são exame, tipo, especialidade, distância e faixa de preço.
6. Preço e horário só aparecem quando vêm da fonte: a clínica parceira (banco do IMED), o OpenStreetMap ou o Google. Nada é estimado. Sem preço informado, aparece "Preço sob consulta".
7. O pedido de agendamento grava uma linha em `appointment_requests`. A linha guarda o estabelecimento escolhido e os dados de contato, não a localização. Para clínicas parceiras, o pedido vai para a clínica. Para estabelecimentos do mapa, a equipe do IMED faz a ponte ("Pedir ao IMED para agendar").

## Clínicas reais do CNES

As clínicas, laboratórios, centros de diagnóstico e hospitais reais vêm do CNES (Cadastro Nacional de Estabelecimentos de Saúde), pela API de dados abertos do Ministério da Saúde (`apidadosabertos.saude.gov.br`). Não precisa de chave.

1. Na busca, `clinicas-proximas` consulta `nearby_establishments` no banco e, ao mesmo tempo, chama `importar-clinicas` com a ação `garantir`. Ela descobre a cidade do ponto (geocodificação reversa no Photon) e o código IBGE (API de localidades do IBGE).
2. Se a cidade nunca foi importada, ou se a importação tem mais de 30 dias, a importação começa em segundo plano. A busca espera no máximo 3,5 s. Enquanto isso, o site mostra o aviso "Carregando as clínicas oficiais de <cidade>", usa o OpenStreetMap e busca de novo sozinho a cada 9 s (até 4 vezes). Com raio de 3 km ou mais, as cidades vizinhas também são importadas.
3. A importação busca os tipos 39 (diagnose e terapia), 36 (clínica especializada), 4 (policlínica), 5 e 7 (hospitais) e 62 (hospital-dia). Ela tira estabelecimentos desativados, dentistas, veterinários, estética, farmácias, óticas e serviços não médicos (fisioterapia, psicologia, nutrição etc.). Também descarta coordenadas falsas: o centro da cidade repetido, pontos fora do Brasil ou muito longe dos outros.
4. Sem coordenada válida, o endereço é geocodificado no Photon (1 pedido por segundo, aos poucos). A distância desses aparece com `~` ("aproximada").
5. Tabelas: `municipalities`, `establishments` (só os que têm localização são públicos) e `establishment_imports` (situação de cada cidade). Só o servidor escreve nelas.
6. O CNES informa o turno (por exemplo "Manhã e tarde" ou "Aberto 24 horas"), não o horário exato, e não informa preço. O site mostra o turno com essa ressalva e "Preço sob consulta". O pedido de agendamento vai pela equipe do IMED (`place_source = 'cnes'`).

Para forçar uma nova importação de uma cidade:

```sql
update public.establishment_imports set finished_at = now() - interval '31 days'
where city_ibge = 3550308;  -- São Paulo
```

Sem permissão de localização, a pessoa digita CEP, cidade ou endereço. A Edge Function faz a geocodificação (ação `geocode`) e a busca segue igual.

Estados tratados na tela:

- carregando;
- sem resultados (com sugestão de aumentar a distância);
- localização negada, indisponível, demorada ou sem suporte;
- falha do servidor (o site busca as clínicas IMED direto no banco);
- falha do mapa (aviso e só parceiros);
- falha total (botão "Tentar de novo");
- erro ao enviar o pedido.

## Marketplace: avaliações, clínicas e conta

- **Login (Supabase Auth, link mágico):** `assets/js/auth.js`. Sem biblioteca; a sessão fica no navegador.
- **Pedido:** o navegador gera um código aleatório e manda só o SHA-256 (`review_token_hash`). Com o código, `request_status` mostra a situação e `submit_review` permite avaliar quando a clínica (ou o IMED) marca "Concluído" (`set_request_status`).
- **Avaliações:** `reviews`, uma por pedido concluído. `place_ratings` e `place_reviews` são públicas. A equipe do IMED pode ocultar (`status = 'hidden'`).
- **Reivindicar cadastro:** `establishment_claims` → no `painel.html`, a equipe do IMED aprova (`approve_claim`): o estabelecimento vira clínica parceira publicada e quem pediu vira dono (`clinic_members`).
- **Painel da clínica:** `update_my_clinic` (dados, horários, convênios, especialidades) e `set_my_clinic_exams` (exames e preços).
- **Agenda com horário:** a clínica monta a agenda semanal (`clinic_schedules`, via `set_my_schedule`) e os bloqueios (`clinic_blocks`, via `add_my_block`/`remove_my_block`) na aba Agenda do painel. O site mostra os horários livres (`available_slots`) e o pedido com `slot_start` já sai **confirmado**; o gatilho do banco recusa horário ocupado (erro 23P01) e o índice único impede duas reservas no mesmo horário.
- **Admins:** e-mails em `admin_emails`.

### Configurar uma vez (no painel do Supabase)

1. **Authentication → URL Configuration:** em *Site URL* coloque o endereço do site e, em *Redirect URLs*, `https://rafael1717-ui.github.io/IMED/**` (e o domínio próprio, quando houver). Sem isso, o link do e-mail volta para `localhost`.
2. **Authentication → SMTP Settings:** ligue um SMTP próprio (ex.: Resend). O SMTP padrão do Supabase só envia para os e-mails da equipe do projeto e tem limite por hora.

### Fila de pré-carga das cidades

`import_queue` tem as capitais e as maiores cidades. O pg_cron (`imed-fila-importacao`) manda 2 cidades por minuto ao importador e `imed-atualizacao-mensal` recoloca na fila as que passaram de 30 dias. Para acompanhar:

```sql
select status, count(*) from public.import_queue group by 1;
```

Para acrescentar uma cidade: `insert into public.import_queue (uf, city_name) values ('SP', 'Bragança Paulista');`

### Páginas por cidade

1. Exporte as cidades com `select json_agg(c) from public.imported_cities() c;` e salve em `scripts/cidades.json`.
2. Rode:

```bash
node scripts/gerar-cidades.mjs
```

### Domínio próprio

1. Compre o domínio (ex.: na Hostinger ou no registro.br).
2. No GitHub: Settings → Pages → Custom domain. No DNS do domínio, crie os registros que o GitHub indicar (CNAME `www` para `rafael1717-ui.github.io` e os registros A do domínio raiz).
3. Troque o endereço do site (abaixo).

### Trocar o endereço do site

O endereço público mora num lugar só: `siteUrl` em `assets/js/config.js` (e `scripts/endereco.json`, com o atual e os anteriores). Para mudar de endereço (domínio próprio, outro GitHub Pages), um comando troca tudo no repositório:

```bash
node scripts/trocar-endereco.mjs https://imed.com.br/
```

Ele troca o `config.js`, os endereços das páginas (canônico, redes sociais, dados para o Google), a página 404, o README, as Edge Functions (o endereço novo e os anteriores continuam aceitos enquanto o site antigo existir) e gera de novo as cidades, o `sitemap.xml`, o `robots.txt` e o `llms.txt`. Pode rodar de novo à vontade; `--check` só confere. No fim ele mostra o que ainda cita o endereço antigo (só o que é de propósito).

O que o comando **não** faz, porque é na produção:

1. Suba o `VERSION` do `sw.js`, rode os testes, commit e push.
2. **Supabase → Authentication → URL Configuration:** *Site URL* com o endereço novo e, em *Redirect URLs*, o endereço novo com `**` no fim (ex.: `https://imed.com.br/**`). Mantenha o antigo na lista enquanto o site antigo existir.
3. **Edge Functions:** publique `clinicas-proximas` (e `link-admin`) de novo, para aceitarem a origem nova. Se existir o segredo `ALLOWED_ORIGINS` (Edge Functions → Secrets), acrescente a origem nova nele ou apague-o (sem o segredo, valem o endereço do site e os anteriores).
4. Quando o site antigo sair do ar de vez: `node scripts/trocar-endereco.mjs --esquecer=<endereço antigo>` e publique as funções de novo.

### WhatsApp do IMED

Coloque o número (só dígitos, com 55 e DDD) em `whatsapp` em `assets/js/config.js`. Vazio esconde os botões.

## Chaves e variáveis de ambiente

O site só usa a chave **publishable** do Supabase (`sb_publishable_...`, em `supabaseKey` no `assets/js/config.js`). Ela é pública por natureza, como a antiga `anon`: as regras de segurança do banco (RLS) só deixam o público ver clínicas publicadas e inserir pedidos. Ninguém de fora consegue ler os pedidos.

Regra das chaves (as antigas `anon` e `service_role` param de funcionar no fim de 2026): a chave publishable vai **só** no cabeçalho `apikey`; `Authorization: Bearer` leva só o token de quem entrou na conta. A chave não é um token (JWT): a documentação do Supabase manda nunca pô-la em `Bearer` (onde ele espera um token, recusa com "Invalid JWT"). A regra mora num lugar só, `IMED_CONFIG.supabaseHeaders` (em `config.js`), usada por todas as chamadas do site; `tests/chaves.test.mjs` confere.

As Edge Functions leem as chaves que o próprio Supabase põe no ambiente delas: `SUPABASE_PUBLISHABLE_KEYS` e `SUPABASE_SECRET_KEYS` (JSON com as chaves por nome; usam a `default`), com volta para as antigas `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` enquanto existirem. A chave secreta nunca sai do servidor e também vai só no `apikey`.

As chaves secretas ficam só no servidor, como segredos da Edge Function (modelo em `supabase/functions/.env.example`):

| Variável | Para quê |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Opcional. Ativa Google Places API (New) e Geocoding API. Sem ela, a busca usa OpenStreetMap. |
| `ALLOWED_ORIGINS` | Sites que podem chamar a função, separados por vírgula. Opcional. Sem ele, valem o endereço do site (`SITE_URL`), os anteriores durante uma troca de endereço (`SITE_ANTERIORES`) e `localhost:8765`. |
| `NOMINATIM_CONTACT` | E-mail de contato enviado no User-Agent aos serviços do OpenStreetMap. |

Para configurar pelo terminal:

```bash
supabase secrets set --env-file supabase/functions/.env --project-ref pyoqiecupxhdzigjudyd
```

Também dá para configurar pelo painel: Supabase → Edge Functions → Secrets.

### Como restringir a chave do Google

- Crie uma chave só para o servidor. Em **Restrições de API**, permita apenas **Places API (New)** e **Geocoding API**.
- As Edge Functions não têm IP fixo, então a restrição por IP não se aplica. Proteja a chave com cotas diárias por API e um alerta de orçamento no Google Cloud.
- Nunca coloque essa chave no site, no Git ou em mensagens. Se vazar, gere outra e apague a antiga.
- Se um dia o site usar o Maps JavaScript API no navegador, crie outra chave, restrita por referenciador HTTP (`https://rafael1717-ui.github.io/*`) e só às APIs do navegador.

## Banco de dados

As migrações estão em `supabase/migrations`:

- `clinics`: clínicas parceiras com localização (`geography(point)`), contato, especialidades, horário (opcional) e situação (`draft`, `published`, `suspended`).
- `clinic_exams`: exames de cada clínica, com preço em centavos. O preço fica vazio até a clínica informar.
- `appointment_requests`: pedidos de agendamento. Um gatilho confere a data (de hoje até 120 dias) e se a clínica aceita pedidos, e sempre grava o status `pending`.
- `nearby_clinics(...)`: busca por raio, com filtros de exame, tipo, especialidade e preço, ordenada por distância.

### Cadastrar uma clínica parceira

```sql
with c as (
  insert into public.clinics (name, kind, address_line, neighborhood, city, state, cep, location,
                              phone, whatsapp, specialties, opening_hours, accepts_online_booking, status)
  values ('Clínica Exemplo', 'imagem', 'Rua Exemplo, 100', 'Centro', 'São Paulo', 'SP', '01000-000',
          extensions.st_setsrid(extensions.st_makepoint(-46.6333, -23.5505), 4326)::extensions.geography,
          '(11) 3000-0000', '5511999999999', '{Radiologia}',
          '{"seg": "07:00–19:00", "sab": "08:00–12:00"}', true, 'published')
  returning id
)
insert into public.clinic_exams (clinic_id, exam_code, price_cents, price_updated_at)
select id, e.code, e.price, now() from c,
  (values ('rx', 9000), ('usg', null::integer)) as e(code, price);
```

O ponto é `st_makepoint(longitude, latitude)`, nessa ordem. Deixe `price_cents` vazio (`null`) quando a clínica não informar o preço.

### Pedidos de agendamento

Só administradores leem os pedidos. Para isso, o e-mail precisa estar em `admin_emails` e a pessoa precisa entrar com Supabase Auth. Também dá para ver os pedidos no Table Editor do painel:

```sql
select created_at, place_name, place_source, exam_code, preferred_date, preferred_period,
       patient_name, patient_phone, status
from public.appointment_requests
order by created_at desc;
```

### Clínicas de demonstração

As 12 clínicas fictícias do protótipo estão no banco com `is_demo = true`, sem preço e sem horário. Elas não aparecem na busca normal. Para ver o fluxo completo de parceiros, abra `perto.html?demo=1` e use um endereço em São Paulo (por exemplo, o botão "Testar na Av. Paulista").

Para apagá-las:

```sql
delete from public.clinics where is_demo;
```

## Publicar

- Site: faça o push para a branch `main`. O GitHub Pages publica sozinho. Ao mudar arquivos do site, aumente `VERSION` em `sw.js` para os celulares baixarem a nova versão.
- Edge Functions: as duas são publicadas com `verify_jwt` desligado (`--no-verify-jwt`), porque a conferência automática do Supabase só entende tokens (JWT) e as chaves novas não são tokens. Cada função confere quem chama no próprio código. Publique primeiro a `importar-clinicas` e depois a `clinicas-proximas`, e só então o site:

```bash
supabase functions deploy importar-clinicas --no-verify-jwt --project-ref pyoqiecupxhdzigjudyd
supabase functions deploy clinicas-proximas --no-verify-jwt --project-ref pyoqiecupxhdzigjudyd
```

`importar-clinicas` aceita a chave secreta no `apikey` (usada pela `clinicas-proximas`), a `service_role` antiga enquanto existir, ou o token interno da fila (cabeçalho `x-imed-token`, guardado em `private.app_tokens`, usado pelo pg_cron). `clinicas-proximas` aceita a chave publishable no `apikey` (ou a `anon` antiga, do site antigo ainda guardado no aparelho), com limite de 40 chamadas por minuto por IP. A lista de sites (`ALLOWED_ORIGINS`) só vale no navegador (pedido com o cabeçalho `Origin`): outro site recebe 403; fora do navegador (curl, servidor) entra quem tiver a chave pública, com o mesmo limite por IP.

Para voltar atrás numa Edge Function, publique a versão anterior **também** com `--no-verify-jwt`: o site novo não manda token de visitante, e com `verify_jwt` ligado o Supabase pode recusar a chamada.

- Conferência na produção: Actions → **Chaves do Supabase** → Run workflow (`.github/workflows/chaves.yml` e `scripts/verificar-chaves.mjs`). Chama a API com a chave publishable, a função `clinicas-proximas` do jeito novo (e do jeito do site publicado, enquanto ele for o antigo), pergunta se o importador aceita a chave secreta da busca e abre o site deste ramo e o site publicado num navegador de verdade. Depois de publicar as funções, marque **depois_do_deploy**: toda pendência "aguardando o deploy" vira erro. As escritas do site ficam bloqueadas no navegador; a única coisa que a conferência pode disparar na produção é o mesmo que a busca de um paciente dispara (o importador atualizar a cidade de São Paulo, se a importação tiver mais de 30 dias, e localizar endereços pendentes). O resultado aparece nas anotações da execução.

- Banco: aplique as novas migrações de `supabase/migrations`, por exemplo com `supabase db push`.

## Testes

```bash
node --test tests/*.test.mjs
```

```bash
node --experimental-strip-types --test supabase/functions/clinicas-proximas/lib.test.ts supabase/functions/importar-clinicas/lib.test.ts
```

```bash
node tests/e2e-perto.mjs
node tests/e2e-inicio.mjs
node tests/e2e-clinica.mjs
node tests/e2e-conta.mjs
```

1. Regras de busca do site: classificação, filtros, distância e validação do pedido.
2. Lógica das Edge Functions: Google Places, CEP, geocodificação e a leitura do CNES (classificação, coordenadas falsas, turnos, acentos).
3. Ponta a ponta num navegador de verdade. Precisa do pacote `playwright`. Simula localização, servidor, banco e OpenStreetMap, e cobre página inicial (com o mapa de clínicas reais), clínicas do CNES, cidade sendo importada, busca, filtros, detalhes, pedido e todos os estados de erro.

## Privacidade

- A localização só é usada depois da permissão do navegador. Ela é arredondada (cerca de 110 m) antes de sair do aparelho.
- A localização não é gravada no banco, nos logs da função nem no aparelho. O pedido de agendamento não leva a localização.
- O pedido pede consentimento específico, porque o exame é um dado de saúde (LGPD, art. 11).
- Detalhes em `privacidade.html`.
