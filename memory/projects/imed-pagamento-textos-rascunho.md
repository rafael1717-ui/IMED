# iMed Pagamentos: textos que mudam quando o pagamento pelo site ligar (RASCUNHO para o advogado)

> **Rascunho, 13/11/2026 (fase P2b).** Nada aqui está no site. **Nenhum texto do site público mudou.** Este arquivo é a
> lista do que precisa mudar, lado a lado (como está hoje → como fica), para o advogado revisar antes de qualquer
> clínica receber pelo site. A regra do projeto (arquitetura do pagamento, §9): **o texto muda no mesmo envio que liga a
> novidade**, nunca antes e nunca depois.
>
> As frases de "como está hoje" foram copiadas do ramo `ci/pagamento-p2b` em 13/11/2026 (arquivo e linha de hoje; as
> linhas andam). As de "como fica" são **sugestão**, em linguagem simples: o advogado pode reescrever tudo.
> Onde a frase depende de uma decisão que o dono ainda não tomou, está marcado **[DECISÃO n]** (lista do §13 da
> arquitetura) e o texto não inventa a resposta. Onde depende do contador ou do meio de pagamento, **[C n]** e **[S n]**.

## 0. Em uma página

Hoje o site diz três coisas que deixam de ser verdade quando o pagamento ligar:

| Hoje o site diz | Por que deixa de valer | Quando |
|---|---|---|
| "O IMED é gratuito para você… o pagamento é feito direto no local" | Em clínica com o recebimento ligado, o paciente paga **no site** | Quando a 1ª clínica ligar (fase P2) |
| "O IMED nunca pede Pix…" | O IMED passa a mostrar um Pix **na tela do agendamento** (e continua sem pedir por telefone, WhatsApp, e-mail ou link) | Fase P2 |
| "Ninguém paga para aparecer primeiro" / "sem anúncios" | Só muda com o **Destaque** (anúncio pago, identificado). **Não muda agora** | Fase P5 |

E três coisas continuam verdade e **ficam**: cadastro da clínica sem custo; "selo não se vende"; "cancelar pelo IMED é
grátis" (com a regra de devolução do que foi pago ao lado).

O que é novo e precisa ser escrito do zero (seções 3 a 5): a seção **"Pagamento pelo site"** dos Termos, a linha
**"Pagamento pelo site"** da Privacidade e o **termo de adesão da clínica** ao recebimento.

## 1. Frases que mudam na fase P2 (pagamento pelo site), lado a lado

### 1.1 "Gratuito" e "direto no local"

| Onde (hoje) | Como está hoje | Como fica (sugestão) |
|---|---|---|
| `assets/js/geo-core.js:571` (`TRUST.gratis`; aparece na busca e na página de cada local) | "**O IMED é gratuito para você.** Se houver cobrança pelo exame, o pagamento é feito direto no local. O IMED nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp." | "**Usar o IMED não custa nada a mais: você paga só o preço do exame.** Em alguns locais o pagamento é feito aqui no site, na tela do seu agendamento; nos outros, direto no local. O IMED nunca pede pagamento, senha ou código por telefone, WhatsApp, e-mail ou link." |
| `index.html:968` (pergunta "O IMED cobra alguma coisa?") | "Não. O IMED é gratuito para você. Se houver cobrança pelo exame ou pela consulta, o pagamento é feito direto no local. O IMED nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp: se alguém pedir em nome do IMED, não pague e avise…" | "Do paciente, nada além do preço do exame. Em alguns locais você paga aqui no site, na tela do seu agendamento (o valor é o mesmo do local); nos outros, direto no local. O IMED nunca pede pagamento, senha ou código por telefone, WhatsApp, e-mail ou link: se alguém pedir em nome do IMED, não pague e avise…" |
| `como-funciona.html:126` | "Para você, o IMED é gratuito. Se houver cobrança pelo exame ou pela consulta, o pagamento é feito direto no local." | "Você paga só o preço do exame. Em alguns locais o pagamento é feito aqui no site, na tela do seu agendamento; nos outros, direto no local." |
| `sobre.html:54` | "Para você, o IMED é gratuito: se houver cobrança pelo exame ou pela consulta no local, o pagamento é feito direto lá. O IMED nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp." | A mesma ideia das duas linhas de cima. |
| `contato.html:95` | "O IMED é gratuito para você e nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp. Se alguém pedir em nome do IMED, não pague e avise aqui." | "O IMED não cobra de você nada além do preço do exame, e só recebe pagamento dentro do site, na tela do seu agendamento. Nunca por telefone, WhatsApp, e-mail ou link. Se alguém pedir em nome do IMED, não pague e avise aqui." |
| `termos.html:52` | "…O IMED é um serviço privado, sem vínculo com o governo ou o SUS, e é gratuito para o paciente." | "…e não cobra do paciente nada além do preço do exame." |
| `scripts/gerar-cidades.mjs:239-240` (pergunta das **318 páginas de cidade**) e `:513` → `llms.txt:19` | "Buscar e pedir agendamento pelo IMED é grátis?" / "Para o paciente, sim: buscar, pedir e cancelar o pedido pelo IMED não têm custo. Se houver cobrança pelo exame, pela consulta ou por falta, ela segue as regras do local, e o pagamento é feito direto lá. O IMED nunca pede Pix…" | "Para o paciente, sim: buscar, pedir e cancelar pelo IMED não têm custo. Você paga só o preço do exame: em alguns locais, aqui no site, na tela do seu agendamento; nos outros, direto no local. O IMED nunca pede pagamento, senha ou código por telefone, WhatsApp, e-mail ou link." (trocar no gerador e gerar as páginas de novo) |
| `teleconsulta.html:122` e `termo-teleconsulta.html:115` | "O IMED não cobra nada pelo site nesta fase e nunca pede Pix, senha ou código por telefone ou WhatsApp." | "A teleconsulta não é cobrada nesta fase. O IMED nunca pede pagamento, senha ou código por telefone, WhatsApp, e-mail ou link." (muda de novo quando existir teleconsulta paga) |

### 1.2 O aviso contra golpe ("nunca pede Pix")

| Onde (hoje) | Como está hoje | Como fica (sugestão) |
|---|---|---|
| `como-funciona.html:127`, `assets/js/contato.js:65` | "O IMED nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp. Se alguém pedir em nome do IMED, não pague e avise pelo Fale com o IMED." | "**O IMED só recebe pagamento dentro do site, na tela do seu agendamento.** Nunca por telefone, WhatsApp, e-mail ou link enviado por mensagem, e nunca pede senha ou código. Se alguém pedir em nome do IMED, não pague e avise pelo Fale com o IMED." |
| `termos.html:73` | "Pagamento, preparo e regras de atendimento seguem as condições do local. O pagamento, quando houver, é feito direto no local: o IMED nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp." | "Preparo e regras de atendimento seguem as condições do local. O pagamento é feito direto no local ou, nos locais que oferecem, aqui no site (veja 'Pagamento pelo site'). O IMED nunca pede pagamento, senha ou código por telefone, WhatsApp, e-mail ou link." |

Observação: as telas do pagamento (P2a, ainda desligadas) **já** usam o aviso novo, só nelas. Na primeira versão nenhum
link de pagamento é enviado por mensagem; se um dia for, este aviso muda de novo.

### 1.3 Cancelar e devolução

| Onde (hoje) | Como está hoje | Como fica (sugestão) |
|---|---|---|
| `como-funciona.html:120` | "Cancelar pelo IMED é grátis; a cobrança por falta segue as regras de cada clínica." | Continua. Acrescentar: "Se você pagou pelo site e cancelar, o valor volta pelo mesmo meio, para quem pagou: **[regra de devolução: DECISÃO 3]**." |
| `termos.html:47` e `:78`, `contato.html:93` | "Cancelar pelo IMED é grátis. A cobrança por falta, quando houver, segue as regras de cada clínica." | Continua. Acrescentar a mesma frase da devolução, apontando para "Pagamento pelo site". |
| `assets/js/confianca.js:61` (pergunta ao cancelar) | "Cancelar este pedido? Cancelar pelo IMED é grátis." | Sem pagamento: igual. Agendamento pago pelo site: "Cancelar este agendamento? **[quanto volta e em quanto tempo: DECISÃO 3 e S1]**" (a tela precisa do valor que o banco calcula; ainda não existe: ficou para a P3). |

A recomendação de partida para a regra de devolução está no §4.5 da arquitetura (total até 24 h antes e sempre nos 7
primeiros dias; total também em cima da hora durante o piloto; falta: a clínica decide; a taxa do IMED volta junto, na
proporção). **O dono ainda não confirmou (decisões 3 e 4) e o advogado precisa dizer se está de acordo com o CDC (A3).**
Enquanto isso, nenhum texto promete prazo nem percentual de devolução.

### 1.4 Para a clínica ("sem custo")

| Onde (hoje) | Como está hoje | Como fica (sugestão) |
|---|---|---|
| `index.html:958` e `:975`, `parceiros.html:8`, `:14` e `:86`, `contato.html:120`, `scripts/gerar-cidades.mjs` (páginas de cidade) | "Cadastro sem custo" / "…assuma o cadastro, sem custo" | "Cadastro sem custo. Taxa só sobre exame pago pelo aplicativo." (o cadastro continua gratuito de verdade; a taxa só existe para a clínica que escolhe receber pelo site) |

A taxa **não aparece para o paciente** (recomendação da decisão 6) e, nas páginas públicas para clínicas, a sugestão é
não escrever o percentual: ele fica no termo de adesão (seção 5), que é o que a clínica aceita.

### 1.5 Privacidade

| Onde (hoje) | Como está hoje | Como fica (sugestão) |
|---|---|---|
| `assets/js/geo-core.js:572` (`TRUST.privacidade`) | "Seus dados vão só para o IMED e para o local escolhido · ficam em servidor no Brasil · sem anúncios e sem rastreadores de anúncio · sua localização é aproximada e não é gravada." | "Seus dados vão só para o IMED e para o local escolhido; quando você paga pelo site, os dados do pagamento vão também para o meio de pagamento · ficam em servidor no Brasil **[conferir onde o meio de pagamento guarda: A6]** · sem anúncios e sem rastreadores de anúncio · …" |
| `index.html:971` | "Os dados do pedido vão só para o IMED e para o local escolhido… O IMED não tem anúncios nem rastreadores de anúncio." | Acrescentar a mesma frase sobre o meio de pagamento. |
| `privacidade.html:79` (linha "Cobranças (registradas pela equipe do IMED)") | "…Hoje o site não recebe pagamentos: a equipe registra as cobranças feitas por fora" | Linha nova **"Pagamento pelo site"** (seção 4). A linha das cobranças registradas à mão continua, sem o "hoje o site não recebe pagamentos". |
| `privacidade.html:104` e seguintes ("Onde os dados ficam e quem acessa") | Só o banco do IMED (Supabase), a consulta de CEP e os mapas | Acrescentar o meio de pagamento, pelo nome, com o que ele recebe (seção 4). |

### 1.6 Painel de gestão (interno; já resolvido no código)

| Onde | Como está hoje | Como fica |
|---|---|---|
| `assets/js/gestao.js` (alto de "Faturamento e cobrança") | "O IMED ainda não recebe pagamentos pelo site; aqui a equipe registra as cobranças feitas por fora (Pix, cartão, boleto)." | "Aqui ficam as cobranças feitas por fora (Pix, cartão, boleto), registradas pela equipe. O que foi pago pelo site está em 'Pagamentos on-line', logo abaixo." **Já troca sozinha** quando a chave geral do pagamento liga (e volta quando desliga); não é texto público. |
| Banco, `agenda_public_info` | "Pagamento no local, direto com a clínica." | Já responde conforme o modo da clínica desde a P1 (não é deste rascunho). |

## 2. Frases que só mudam na fase P5 (Destaque). NÃO mudam agora

Ficam listadas para o advogado ver o conjunto (pergunta A5). Enquanto não existir anúncio, **continuam verdade**.

| Onde (hoje) | Como está hoje | Como fica na P5 (sugestão) |
|---|---|---|
| `index.html:973`, `parceiros.html:121`, `como-funciona.html:60`, `termos.html:62`, `perto.html`, páginas de cidade | "Do mais perto para o mais longe. Ninguém paga para aparecer primeiro, e selo não se vende." | "Do mais perto para o mais longe. A faixa 'Destaques' é anúncio pago e vem marcada como anúncio; pagar não muda a ordem da lista, a nota nem o selo." |
| `parceiros.html:122`, `como-funciona.html:61` | "Selo não se vende…" | **Continua verdade e fica.** Acrescentar: "O Destaque é um anúncio à parte, identificado." |
| `geo-core.js:572`, `index.html:971` | "sem anúncios e sem rastreadores de anúncio" | "sem rastreadores de anúncio" (os anúncios são só de clínicas e não usam seus dados) |
| `privacidade.html:89` | "Não vendemos seus dados e não os compartilhamos com anunciantes." | **Continua verdade e fica.** Acrescentar que o Destaque não usa dado de paciente. |

## 3. Seção nova dos Termos de uso: "Pagamento pelo site" (esboço)

Texto do advogado (pergunta A7). O que a seção precisa dizer, em linguagem simples, com o que **o sistema já faz**:

1. **Quem oferece.** Só alguns locais (os que escolheram receber pelo site); nos outros, o pagamento continua no local.
   Só exame particular com preço informado; convênio e exame "sob consulta" continuam no local **[DECISÕES 9 e 19]**.
2. **Quanto.** O preço do exame informado pela clínica. O IMED não acrescenta nada ao paciente **[DECISÃO 8: o preço do
   site não pode ser maior que o do balcão; precisa estar no contrato da clínica]**.
3. **Como.** Pix, na tela do agendamento. O horário fica guardado por alguns minutos enquanto a pessoa paga; sem
   pagamento no prazo, o horário volta a ficar livre e nada é cobrado. (Cartão: fase P4.)
4. **Quando vale.** O agendamento só fica "Confirmado" depois que o pagamento é confirmado pelo meio de pagamento.
5. **Quem recebe.** **[C1 e A2: quem é o recebedor perante o paciente e o fisco]** Hoje o desenho é: a cobrança sai em
   nome do IMED e o meio de pagamento separa, na hora, a parte da clínica e a taxa do IMED; o IMED nunca guarda o
   dinheiro da clínica para repassar depois.
6. **Nota fiscal.** A nota do exame é emitida **pela clínica**, no valor inteiro. O IMED entrega um comprovante de
   pagamento, que não é nota fiscal **[C1 a C5]**.
7. **Cancelamento e devolução.** **[DECISÕES 3 e 4; A3]** Sempre pelo mesmo meio e para quem pagou; quando a clínica
   cancela ou o horário deixa de existir, devolução total automática.
8. **Pagamento que chega atrasado** (depois de o horário ter sido liberado): se o horário ainda estiver livre, vale; se
   não, o dinheiro volta inteiro, sozinho.
9. **Quem paga é outra pessoa.** Pode pagar por um filho ou um pai; a devolução volta para quem pagou **[A6]**.
10. **Problemas.** Por onde reclamar (Fale com o IMED), em quanto tempo o IMED responde, e o que acontece em caso de
    contestação.
11. **Segurança.** O IMED só recebe dentro do site; nunca por telefone, WhatsApp, e-mail ou link.

## 4. Linha nova da Política de privacidade: "Pagamento pelo site" (esboço)

O que o sistema faz hoje (arquitetura §6.3), para o advogado conferir e redigir (pergunta A6):

| Pergunta | O que o sistema faz |
|---|---|
| Que dados | Nome completo e CPF **de quem paga**, valor, situação do pagamento, data e hora, e um código do agendamento |
| Para quê | Criar a cobrança, confirmar o agendamento, devolver e prestar contas (clínica, contador, fisco) |
| Com quem | O meio de pagamento (**nomear a empresa**), que recebe: nome e CPF do pagador, o valor, a descrição fixa "IMED · agendamento" com um código curto e a conta da clínica. **Não recebe** o nome do exame, a especialidade, a data, o telefone, o e-mail nem qualquer dado de saúde |
| O que o IMED guarda | O CPF **não fica guardado em texto**: só uma marca embaralhada, para não cadastrar a mesma pessoa duas vezes. Dado de cartão nunca passa pelo IMED |
| O que a clínica vê | O extrato da clínica mostra exame, valores e situação. O papel "Financeiro" da clínica **não vê o nome do paciente** |
| Por quanto tempo | Registros financeiros: **[C7: o desenho supõe 5 anos]**; avisos do meio de pagamento: 1 ano |
| Base legal | **[A6]** (execução de contrato? obrigação legal para os registros fiscais?) |
| O que o meio de pagamento fica sabendo | Que a pessoa X pagou um agendamento na clínica Y. É inevitável em qualquer pagamento e precisa estar dito |

## 5. Termo de adesão da clínica ao recebimento pelo site (esboço dos pontos)

Não existe ainda. **Sem ele nenhuma clínica consegue ligar o recebimento**: a função do servidor que grava a conta da
clínica só aceita o pedido com a versão do termo em vigor, e essa versão só é configurada depois da revisão do
advogado. Pontos que o termo precisa cobrir (perguntas A1, A4 e A7):

1. O que é o serviço (tecnologia, agenda e cobrança) e o que **não** é (o IMED não presta o serviço de saúde, não é
   plano de saúde nem cartão de desconto).
2. A taxa: quanto, sobre o quê (só exame efetivamente pago pelo site), que ela volta na proporção quando o exame é
   devolvido, e como muda (aviso prévio; a taxa de cada cobrança é a do dia em que ela foi criada) **[A1: formato da
   taxa diante do art. 59 do Código de Ética Médica; DECISÕES 10 e 23]**.
3. Quem paga a tarifa do meio de pagamento **[DECISÃO 1: recomendação, o IMED]**.
4. A conta da clínica no meio de pagamento: é dela, aprovada por ele; a clínica informa o identificador; o IMED confere
   antes de ativar; trocar a conta volta para a conferência.
5. Preço: o do site não pode ser maior que o particular do balcão **[DECISÃO 8]**.
6. Nota fiscal do exame: da clínica, no valor inteiro. Nota do IMED para a clínica pela taxa **[C4]**.
7. Devolução: a regra, quem pode pedir, que a parte da clínica sai da conta dela, e o que acontece se a conta não tiver
   saldo **[S1; A4]**.
8. Contestação (cartão, fase P4): quem arca **[DECISÃO 12]**.
9. Suspensão e pausa: quando o IMED pode suspender o recebimento; a clínica pode pausar quando quiser; o que já foi pago
   continua valendo.
10. Dados: o que a clínica recebe (o mesmo de hoje) e o que ela não pode fazer com eles (LGPD).
11. Responsabilidade perante o paciente se o exame pago não for feito **[A4]**.
12. Prazo, rescisão e foro.

## 6. Dúvidas para o advogado (as que mexem nos textos)

1. **"Gratuito".** Podemos dizer "não custa nada a mais: você paga só o preço do exame" se a clínica paga uma taxa ao
   IMED sobre esse preço? Precisa dizer ao paciente que existe a taxa (CDC, informação clara)? A recomendação de hoje é
   não mostrar a taxa ao paciente (decisão 6).
2. **Quem é o fornecedor do pagamento.** Na tela e no comprovante, quem aparece como recebedor: o IMED, a clínica ou os
   dois? O que o comprovante precisa dizer para não ser confundido com nota fiscal? (A2, A4, C1)
3. **Arrependimento em 7 dias** (CDC, art. 49) vale para exame com hora marcada? A regra de devolução recomendada está
   de acordo? Dá para ter retenção em cancelamento de última hora ou em falta, e com que aviso antes de pagar? (A3)
4. **Taxa e ética médica** (CFM, arts. 58, 59 e 72): o texto do termo da clínica muda conforme o formato da taxa
   (percentual, valor fixo, mensalidade). Qual formato e quais palavras evitar? (A1)
5. **LGPD:** o meio de pagamento é operador do IMED ou controlador próprio? Qual a base legal para o CPF do pagador?
   Quem paga é diferente do paciente (inclusive menor): muda algum texto ou aceite? Precisa de relatório de impacto? (A6)
6. **Aceite dos termos novos.** Quem já tem pedido ou conta precisa aceitar de novo? O aceite da clínica pelo dono, com
   data e versão gravadas, basta como contrato de adesão? (A7)
7. **Aviso contra golpe.** A frase nova ("só recebe dentro do site, na tela do seu agendamento") é suficiente? Precisa
   dizer o nome que aparece no Pix para o pagador (ainda não conferido no meio de pagamento)?
8. **Publicidade (só na P5):** como o "Destaque" precisa ser identificado (CDC, art. 36) e o que a clínica não pode
   prometer (Resolução CFM 2.336/2023)? (A5)
9. **Páginas de cidade e `llms.txt`:** são 318 páginas geradas com a mesma resposta; alguma delas precisa de texto
   diferente por município (ISS, Procon)?

## 7. Como aplicar quando for a hora (para quem for fazer)

1. Advogado devolve os textos → o dono aprova → trocam-se as frases das seções 1, 3, 4 e 5 **no mesmo envio** que liga a
   primeira clínica (nunca antes).
2. Testes que travam as frases de hoje e mudam junto: `tests/geo-core.test.mjs`, `tests/cidades.test.mjs`,
   `tests/e2e-conteudo.mjs`, `tests/e2e-inicio.mjs`, `tests/e2e-local.mjs`, `tests/e2e-perto.mjs`,
   `tests/e2e-cidades-faq.mjs`, `tests/e2e-tele.mjs` (lista com as linhas no §9 da arquitetura).
3. Teste novo, no mesmo envio: nenhuma página pode dizer "gratuito" ou "nunca pede Pix" na forma antiga.
4. Gerar de novo as 318 páginas de cidade e o `llms.txt` (`node scripts/gerar-cidades.mjs`).
5. Subir a versão dos termos (paciente e clínica); a versão do termo da clínica vai para a configuração da função
   `pagamento-clinica`.
6. Voltar atrás: desligar a chave geral (segundos) e reverter o commit dos textos.
