# iMed Pagamentos — arquitetura (fase 1, análise e plano)

> O paciente paga o exame dentro do aplicativo, a clínica recebe a parte dela e o IMED fica com a taxa. Mais a
> mensalidade do "Destaque". Pedido do dono de 11/11/2026. Este documento é a referência para as fases P0 a P7.
> **É o desenho: nada mudou na produção.** (A fase P1, o banco com tudo desligado, foi escrita em 11/11 no ramo
> `ci/pagamento-p1`: veja "P1: como ficou", no fim. A P2a, o "Pix por dentro" ainda invisível, em 11 e 12/11 no ramo
> `ci/pagamento-p2a`: veja "P2a: como ficou", depois dela.)

**Como foi feito (só leitura).** Li as arquiteturas da agenda e do Workspace, as migrações da agenda (reserva,
confirmação, expiração, cancelamento e remarcação), o fluxo do "horário direto" (`assets/js/local.js`, `geo-core.js`),
a tabela de cobranças do painel de gestão e os textos do site, no ramo `ci/agenda-5-1` (commit `7ef24d87`). Não rodei
nada no banco de produção. A pesquisa sobre o meio de pagamento foi feita em **11/11/2026** só por busca na internet: a
documentação do Asaas (`docs.asaas.com`) **não abre nesta rede**, então li os trechos que a busca devolveu, e não as
páginas inteiras. Cada afirmação sobre terceiros traz a fonte (lista no fim) e uma marca:
**[doc]** = aparece na documentação ou página oficial; **[parcial]** = aparece só em parte ou em página de parceiro;
**[n/c]** = **não consegui confirmar** (§16 junta todos). O que é opinião minha está escrito como **recomendação**.

Convenção: valores sempre em centavos inteiros. As contas de exemplo usam números redondos só para explicar; **não
são preço nem faturamento de clínica nenhuma**.

---

## 0. Em uma página (para o dono)

1. **O que muda para o paciente.** Na clínica que ligar o recebimento, depois de escolher o horário o paciente paga
   ali mesmo, por Pix (primeiro) e depois por cartão. O horário fica **segurado por 10 minutos** enquanto ele paga e só
   vira "Confirmado" quando o pagamento chega de verdade. Não pagou no prazo: o horário volta para a agenda sozinho.
2. **Caminho do dinheiro (conta de exemplo, exame de R$ 200,00 no Pix).** O paciente paga R$ 200,00. O meio de
   pagamento separa na hora: **R$ 170,00 caem direto na conta da clínica** e R$ 30,00 (os 15%) ficam para o IMED, de
   onde sai a tarifa do Pix (R$ 1,99). O dinheiro da clínica **nunca fica parado na conta do IMED**.
3. **Por que a divisão automática ("split").** Se o IMED recebesse tudo e depois transferisse, estaria guardando
   dinheiro dos outros (assunto do Banco Central) e arriscaria pagar imposto sobre os R$ 200,00 em vez dos R$ 30,00.
   Com a divisão, cada um recebe só o que é seu. **Isso precisa da confirmação do contador** (pergunta C1 do §3.5).
4. **Meio de pagamento recomendado: Asaas.** Tem divisão automática, Pix, cartão, mensalidade recorrente, devolução
   total e parcial, ambiente de testes e não cobra mensalidade. Tarifa pública: R$ 1,99 por Pix recebido; 2,99% +
   R$ 0,49 no cartão à vista. No cartão, pelas páginas do Asaas, o dinheiro só fica disponível
   **32 dias depois**.
5. **Clínica sem conta no meio de pagamento não muda nada:** continua com "pagamento no local", como hoje.
6. **Destaque (mensalidade).** A lista continua **por distância**. Quem assina aparece também numa faixa "Destaques",
   **marcada como anúncio**. Pagar não muda posição na lista, nota nem selo. Atrasou: 5 dias de tolerância, depois o
   destaque desliga sozinho (o cadastro continua).
7. **O que o dono precisa resolver antes de qualquer código valer** (fase P0): CNPJ do IMED; conta no Asaas; contador
   e advogado respondendo às perguntas do §3.5; a clínica piloto abrir a conta dela no Asaas.
8. **Três riscos que não são de programação** (§12): (a) o **Código de Ética Médica, art. 59**, proíbe ao médico
   oferecer ou aceitar remuneração "por paciente encaminhado ou recebido"; os 15% por exame precisam do olhar de um
   advogado antes de entrar no ar; (b) o site promete hoje, em mais de 30 lugares, que "o IMED é gratuito", "nunca
   pede Pix" e "ninguém paga para aparecer primeiro": **esses textos mudam no mesmo dia** (§9); (c) no cartão existe
   a contestação da compra (chargeback) meses depois: por isso o cartão vem depois do Pix.
9. **Ordem das fases:** P0 conta, respostas e testes → P1 banco (desligado) → P2 Pix com divisão na clínica piloto →
   P3 devoluções completas e remarcação → P4 cartão → P5 Destaque → P6 gestão, extratos e conciliação completos →
   P7 validação. Cada fase é pequena, pode ser publicada sozinha e tem volta.
10. **O que fica pronto no desenho, sem construir agora:** teleconsulta paga e "consultório virtual" por mensalidade
    usam as mesmas tabelas (§15).

**Clínica piloto (indicada pelo dono):** Dimaze Diagnóstico por Imagem, Americana-SP, CNES 4781104 (centro de imagem).
Responde à decisão 24 da arquitetura da agenda.

---

## 1. O que já existe e o que muda

### 1.1 O que a agenda já deixou pronto

| Peça | Onde | Situação |
|---|---|---|
| Reserva temporária com dados do paciente | `agenda_hold` (só servidor), `hold_minutes` 10, `payment_grace_min` 5 em `agenda.unit_settings` | Pronta e testada (`210_reserva.sql`, `reserva.mjs`) |
| Confirmar e soltar a reserva | `agenda_confirm`, `agenda_release` (só servidor) | Prontas, mas só aceitam a situação `hold` |
| Expirar reserva vencida | `private.agenda_expire`, job `imed-agenda-manutencao` (30 s), liberação preguiçosa | Pronta; expira `hold` e `awaiting_payment` |
| Situações | `hold`, `awaiting_payment`, `expired` e as transições (`agenda.status_transitions`, inclusive `awaiting_payment → confirmed` por `gateway` e `expired → confirmed` pelo sistema) | Cadastradas; ninguém usa `awaiting_payment` ainda |
| Preço fotografado na marcação | `agenda.appointment_items.price_cents`, `appointment_requests.total_cents` (nulo se algum exame é "sob consulta") | Pronto |
| Modo de pagamento | `appointment_requests.payment_mode` (`no_local`, `online`); `unit_settings.payment_mode` só aceita `no_local` | A coluna existe; o gatilho força `no_local` no INSERT direto |
| Rótulos do paciente | "Aguardando pagamento", "O horário só fica confirmado depois do pagamento." (`geo-core.js`, `conta.js`) | Prontos |
| Cobranças registradas à mão | `private.billing_charges` (tipos `mensalidade_clinica` e `comissao_clinica` já previstos), painel de gestão | No ar; "nada é cobrado sozinho" |
| Papel financeiro | `imed_financeiro` com `imed.financeiro.ver`; na clínica, `financeiro.ver` | Prontos |
| Contra abuso | `agenda.rate_counters`, `private.agenda_count`, `agenda.idempotency` | Prontos |

### 1.2 Decisões da agenda que mudam

A arquitetura da agenda (§15) registrou, por recomendação: **decisão 1** "sem pagamento online, 'Confirmar' reserva e
confirma de uma vez" e **decisão 4** "pagamento no local até o dono decidir". O pedido de 11/11 muda as duas, **só para
a clínica que ligar o recebimento**:

- **Decisão 1 (nova):** com recebimento ligado, "Ir para o pagamento" **segura** o horário (10 min) e a confirmação
  vem do pagamento. Sem recebimento, continua "Confirmar" de uma vez (`agenda_book`), como na 5.1.
- **Decisão 4 (nova):** pagamento online por divisão automática, meio Asaas, IMED com 15%. Detalhes neste documento.
- **Decisão 5 (pagamento depois de expirar):** mantida e completada no §4.4: confirma sozinho se o horário ainda
  estiver livre; senão **devolve o dinheiro automaticamente** (em vez de esperar uma fila de pessoas).
- **§9 da agenda** (esboço `agenda.payments`): substituído por este documento. As tabelas vão para um schema próprio,
  `pagamentos`, porque a mensalidade do Destaque e, depois, a teleconsulta não são agendamentos.

### 1.3 Furos encontrados no código (para a fase P1)

1. `agenda_confirm` recusa `awaiting_payment` (`transition_not_allowed`) e não sabe confirmar um `expired`.
2. `agenda_hold` grava canal `externo` e origem `api` (foi feita para a integração); o paciente pagante precisa do
   canal `imed_app` e das regras de venda online (`p_public`).
3. `agenda_release` só solta `hold`.
4. `private.agenda_expire` não olha se há pagamento "processando" (a arquitetura da agenda pede isso no §5).
5. `agenda_public_info` devolve fixo `'payment': 'no_local'` e o texto "Pagamento no local, direto com a clínica."
6. `agenda_cancel` não sabe que existe dinheiro para devolver.
7. `total_cents` nulo (algum exame "sob consulta") → não dá para cobrar: pagamento online só com **todos** os exames
   da marcação com preço.

---

## 2. Meio de pagamento: o que o Asaas oferece (pesquisa de 11/11/2026)

### 2.1 Asaas

| Assunto | O que encontrei | Marca |
|---|---|---|
| **Divisão (split)** | Quem cria a cobrança informa, no campo `split`, a carteira de destino (`walletId`) e um valor fixo (`fixedValue`, 2 casas) ou percentual (`percentualValue`, 4 casas). Cada destinatário precisa ter conta no Asaas. Não se informa a própria carteira. O que não for dividido fica com quem emitiu a cobrança. Sem limite de carteiras | [doc] |
| **Base do percentual** | O percentual é calculado sobre o **valor líquido** (depois da tarifa do Asaas), não sobre o valor cheio. O valor fixo precisa caber no valor líquido | [doc] |
| **Quando a parte da clínica cai** | Existe o aviso `PAYMENT_SPLIT_DONE` (divisão liquidada). O momento exato por meio (Pix na hora? cartão só nos 32 dias?) | [n/c] |
| **Divisão recusada** | A divisão pode ficar `REFUSED` com motivo (ex.: contrato sobre os recebíveis da conta de destino). Se a conta de destino precisa estar aprovada | [parcial] |
| **Subcontas** | Criadas por API (`POST /v3/accounts`), só por conta com CNPJ; a resposta traz a chave e a carteira da subconta. Conta nova começa num "período de avaliação": no máximo 10 subcontas de titulares diferentes e R$ 2.000,00 em cobranças por subconta. Modelo sem marca própria: a clínica recebe e-mail e envia os documentos na tela do Asaas. Modelo "BaaS" (marca própria) é combinado com o gerente da conta | [doc] |
| **Garantia (Conta Escrow)** | Só para subcontas: o valor recebido fica retido na subconta por um prazo (`daysToExpire`) ou até a plataforma liberar (`POST /v3/escrow/{id}/finish`) | [doc] |
| **Pix** | Cobrança com QR Code dinâmico (imagem, "copia e cola" e `expirationDate` em `GET /v3/payments/{id}/pixQrCode`). **O QR vence 12 meses depois do vencimento da cobrança**; não achei como fazê-lo vencer em minutos. Sem chave Pix cadastrada na conta, o QR é de uma instituição parceira e vale só até 23h59 do dia. Só pode ser pago uma vez | [doc] |
| **Apagar cobrança** | `DELETE /v3/payments/{id}` responde `deleted: true`; a documentação manda conferir antes se já não foi paga. Existe o aviso `PAYMENT_DELETED`. **Se o QR de uma cobrança apagada ainda pode ser pago** | [n/c] |
| **Cartão** | Cobrança por cartão por API (dados do cartão ou `creditCardToken`), ou por página hospedada (Asaas Checkout, criado por API, aceita split e avisa `CHECKOUT_PAID`, com redirecionamento depois do pagamento). Pré-autorização: `authorizeOnly`, situação `AUTHORIZED`, captura depois; prazo padrão de 3 dias, depois estorna sozinha | [doc] |
| **Pré-autorização na página hospedada** | Se o Checkout hospedado aceita `authorizeOnly` | [n/c] |
| **Mensalidade** | Assinaturas com ciclo semanal, quinzenal ou mensal (`WEEKLY`, `BIWEEKLY`, `MONTHLY`), por cartão, Pix ou boleto; cada cobrança gerada manda os avisos normais, inclusive `PAYMENT_OVERDUE` (atrasada). Aceita split. O que o Asaas faz sozinho com assinatura atrasada (pausa? cancela?) | [doc] / [n/c] |
| **Avisos (webhooks)** | Cria-se por API ou pela tela; o `authToken` (32 a 255 caracteres, sem espaço, não pode ser uma chave de API) vem no cabeçalho `asaas-access-token` de cada aviso. Resposta fora de 2xx gera novas tentativas e "penaliza" a fila; há o modo de envio sequencial (recomendado para cobranças) e o campo `interrupted`. O Asaas guarda os avisos por 14 dias. A documentação manda tratar aviso repetido pelo `id` do evento. **Quantas falhas pausam a fila** | [doc] / [n/c] |
| **Nomes dos avisos de cobrança** | `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_DELETED`, `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`, `PAYMENT_SPLIT_DONE`. A lista inteira de situações da cobrança e se existe "em análise de risco" no cartão | [doc] / [n/c] |
| **Devolução (estorno)** | `POST /v3/payments/{id}/refund`. Sem valor = total. Com `value` = parcial; no Pix pode haver várias parciais até o total pago. Com `splitRefunds`, diz-se quanto sai de cada participante da divisão; o resto sai da conta principal. Devolução total também desfaz a divisão em todas as contas. **As tarifas da cobrança não voltam.** Boleto tem fluxo próprio | [doc] |
| **Devolução parcial no cartão** | Se funciona igual ao Pix | [n/c] |
| **Devolução sem saldo na clínica** | O que acontece se a clínica já sacou a parte dela | [n/c] |
| **Prazo de liquidação** | Pix: em segundos, 24 h. Boleto: 1 dia útil. Cartão de crédito: 32 dias corridos depois da confirmação (de cada parcela). Débito: até 3 dias úteis | [parcial] (página oficial e páginas de parceiros) |
| **Antecipação** | Cartão a partir de 1,25% ao mês, sujeita a análise. Com antecipação, o percentual da divisão incide sobre o líquido já descontada a antecipação | [doc] |
| **Contestação (chargeback)** | Há os avisos acima e uma API para enviar a defesa (documentos). **Quem fica com o prejuízo quando a cobrança tem divisão** (a parte da clínica volta sozinha? o saldo fica bloqueado em qual conta?) | [n/c] |
| **Cadastro (KYC)** | Do IMED: conta de pessoa jurídica (contrato social, CNPJ regular, dados dos sócios, segundo o blog do Asaas; a lista exata e o prazo de aprovação) [n/c]. Da clínica: abre a própria conta e é aprovada pelo Asaas, não pelo IMED | [parcial] |
| **Pagador** | Cria-se um "cliente" (`POST /v3/customers`) e usa-se o id na cobrança. A API aceita cliente repetido (cabe a nós não duplicar). `notificationDisabled: true` desliga os avisos do Asaas ao pagador. **Se o CPF é obrigatório** (as bibliotecas de terceiros tratam como obrigatório) | [doc] / [n/c] |
| **Ambiente de testes** | Conta separada em `sandbox.asaas.com`, com chave própria; dá para confirmar pagamento de teste pela tela ou por um endpoint só do sandbox; até 20 subcontas por dia | [doc] |
| **Nota fiscal de serviço** | Emite NFS-e ligada a cobrança ou assinatura; R$ 0,49 por nota; exige inscrição municipal e a prefeitura homologada | [doc] |
| **Tarifas** | Pix e boleto: R$ 1,99 por recebimento (R$ 0,99 nos 3 primeiros meses). Cartão à vista: 2,99% + R$ 0,49 (outra página do próprio Asaas anuncia 1,99% + R$ 0,49 nos 3 primeiros meses). Débito: 1,89% + R$ 0,35. Sem mensalidade. A página avisa que são tarifas padrão e que vale o que estiver na conta | [doc] |
| **Autorização do Banco Central** | Que o Asaas é instituição de pagamento autorizada | [n/c nesta pesquisa; conferir na lista do BC] |

### 2.2 Alternativas, só no que muda a decisão

| | Asaas | Mercado Pago | Pagar.me |
|---|---|---|---|
| Como divide | A cobrança sai na conta do IMED e a parte da clínica vai para a carteira dela (ou o contrário) [doc] | A cobrança sai **na conta da clínica** e o IMED recebe a comissão (`marketplace_fee`/`application_fee`); a clínica autoriza o IMED por OAuth [doc] | Regras por recebedor, em valor ou percentual [doc] |
| O que o IMED guarda de segredo por clínica | Nada na variante A (só o `walletId`, que não é segredo) | Um token por clínica (segredo que movimenta a conta dela) [doc] | [n/c] |
| Quem paga tarifa e contestação | Não achei opção explícita [n/c] | Tarifa do Mercado Pago sai primeiro, comissão depois; devolução é rateada e **não sai inteira se a clínica não tiver saldo** [doc] | Por recebedor, declarado na regra: `liable` (responde pela contestação), `charge_processing_fee`, `charge_remainder_fee` [doc] |
| Pix | R$ 1,99 fixo [doc] | 0,99% [parcial]; split com Pix [n/c] | [n/c] |
| Cartão | 2,99% + R$ 0,49, 32 dias [doc] | 3,98% a 4,98% conforme o prazo (na hora, 14 ou 30 dias) [parcial] | [n/c] (tarifa negociada) |
| Mensalidade, nota fiscal, testes | Tem os três [doc] | [n/c] | [n/c] |

**Leitura (recomendação):** Asaas continua a melhor escolha para começar: tarifa fixa no Pix (acima de
R$ 201,01, R$ 1,99 fixo sai mais barato que 0,99%; abaixo disso, o contrário), nenhuma mensalidade, divisão simples e tudo num lugar só.
O que faria trocar: (1) o contador ou o advogado exigirem que a cobrança saia em nome da clínica **e** o Asaas não
servir bem nesse formato → Mercado Pago faz isso de nascença; (2) na fase do cartão, se o Asaas não deixar claro quem
responde pela contestação → Pagar.me declara isso por recebedor. Por isso o banco guarda o nome do provedor e a
integração fica atrás de uma camada fina (§6.1): trocar de meio não mexe na agenda.

### 2.3 Conferir no ambiente de testes antes de escrever o código da P2 (lista da P0)

1. Divisão com `fixedValue` para a clínica num Pix: a clínica recebe exatamente o valor fixo? A tarifa sai só do IMED?
2. Quando a parte da clínica fica disponível (Pix e cartão) e quando chega `PAYMENT_SPLIT_DONE`.
3. Apagar uma cobrança Pix e tentar pagar o QR: é recusado? Chega dinheiro mesmo assim?
4. Pagar o QR no mesmo instante em que se apaga a cobrança (corrida).
5. Mesmo aviso reenviado; aviso fora de ordem; nosso servidor respondendo erro: o que o Asaas faz e quando pausa.
6. Devolução total e parcial (Pix e cartão) com `splitRefunds`; o que acontece com a carteira da clínica **sem saldo**.
7. O que o paciente vê como nome de quem recebe (no Pix e na fatura do cartão).
8. Cliente sem CPF: a cobrança é aceita? Avisos do Asaas ao pagador desligados de verdade?
9. Checkout hospedado com divisão; volta para o site; pré-autorização.
10. Assinatura mensal: primeira cobrança, atraso, cancelamento, troca de preço.
11. Contestação simulada (se o sandbox tiver) numa cobrança com divisão.
12. Listagens para a conciliação: cobranças por dia, divisões pagas, devoluções, extrato da conta.

---

## 3. Caminho do dinheiro e quem é o quê

### 3.1 Papéis

| Quem | O que é | O que faz com o dinheiro |
|---|---|---|
| **Paciente** | Consumidor e pagador (pode pagar por outra pessoa: filho, pai) | Paga o preço do exame, nada além |
| **Clínica** | Quem presta o serviço de saúde | Recebe a parte dela direto na conta; **emite a nota fiscal do exame para o paciente**, no valor inteiro |
| **IMED** | Plataforma de tecnologia e intermediação | Fica com a taxa (15%); **emite nota de serviço para a clínica** pela taxa e pela mensalidade do Destaque |
| **Asaas** | Instituição de pagamento | Recebe do paciente, divide, liquida e devolve; guarda os dados do cartão (o IMED nunca vê) |

### 3.2 Duas formas de montar a divisão

```
Variante A (padrão recomendado)                      Variante B (reserva)
paciente ──paga──> cobrança na conta do IMED         paciente ──paga──> cobrança na conta da CLÍNICA
                     ├─ split fixo ──> carteira da clínica (85%)          ├─ split ──> carteira do IMED (15%)
                     └─ resto ──────> IMED (15% − tarifa)                 └─ resto ──> clínica (85% − tarifa)
```

| | **A: cobrança emitida pelo IMED** | **B: cobrança emitida pela clínica** |
|---|---|---|
| Combina com o pedido do dono ("o paciente paga a gente primeiro") | Sim | Não: o paciente paga à clínica |
| O que a clínica precisa fazer | Abrir conta gratuita no Asaas e informar o `walletId` | Ser subconta criada pelo IMED (limites do período de avaliação) ou entregar uma chave da conta dela |
| Segredos de clínica no IMED | Nenhum | Uma chave por clínica, que movimenta a conta dela |
| Nome que o paciente vê | IMED | A clínica |
| Quem aparece como recebedor do valor inteiro perante o fisco e o meio de pagamento | O IMED (pergunta C1) | A clínica |
| Devolução e contestação | Saem primeiro da conta do IMED | Saem da conta da clínica |

**Recomendação: variante A**, porque é o que o dono pediu, não exige guardar segredo de clínica e a clínica entra com
um cadastro só. **Condição:** o contador responder que, na A, a receita do IMED é só a taxa (C1). Se a resposta for
"não", muda-se para a B sem refazer o resto: a tabela de cobranças já tem a coluna `emitida_por` (§5.2).

### 3.3 A conta, em centavos

- `taxa = piso(preço × 1500 / 10000)`, **por exame** (não pelo total do pacote), sempre para baixo: na dúvida de
  1 centavo, o centavo é da clínica. `parte da clínica = preço − taxa`.
- A divisão vai para o Asaas como **valor fixo** para a clínica (`fixedValue = parte da clínica`), não como
  percentual. Motivo: o percentual do Asaas incide sobre o valor **depois** da tarifa [doc]; com valor fixo a clínica
  recebe exatamente o combinado e a conta fecha com a nossa.
- **Tarifa do meio de pagamento: sai da parte do IMED** (recomendação; decisão 1). Assim a parte da clínica não depende
  de promoção nem de mudança de tarifa, e a frase para a clínica é uma só: "de cada R$ 100,00, R$ 85,00 caem na sua
  conta".

| Exemplo (não é preço de ninguém) | Pix | Cartão à vista |
|---|---|---|
| Paciente paga | R$ 200,00 | R$ 200,00 |
| Clínica recebe (85%) | R$ 170,00, direto | R$ 170,00, em 32 dias [parcial] |
| Taxa do IMED (15%) | R$ 30,00 | R$ 30,00 |
| Tarifa do Asaas (padrão) | R$ 1,99 | R$ 6,47 (2,99% + R$ 0,49) |
| Sobra para o IMED | R$ 28,01 | R$ 23,53 |

- **Preço mínimo para pagar online** (parâmetro): a taxa precisa cobrir a tarifa. No Pix, 15% só cobre R$ 1,99 a partir
  de R$ 13,27. Recomendação: mínimo de R$ 20,00; abaixo disso o exame continua "pagamento no local".
- **A taxa é um parâmetro por clínica, com histórico** (§5.2). Cada cobrança guarda a taxa de quando foi criada; mudar
  a taxa não altera cobrança antiga.

### 3.4 Notas fiscais (como o desenho supõe; confirmar com o contador)

- **Clínica → paciente:** nota do exame, valor inteiro, emitida pela clínica como hoje (é ela que presta o serviço; é
  esse documento que o paciente usa no imposto de renda). O IMED **não** emite nota em nome da clínica.
- **IMED → clínica:** nota de serviço pela taxa do período (por exame ou uma por mês) e pela mensalidade do Destaque.
- **IMED → paciente:** nenhuma nota; o paciente recebe do IMED um **comprovante de pagamento** que diz, com todas as
  letras, "a nota fiscal é emitida pela clínica".

### 3.5 Perguntas objetivas

**Para o contador**
- **C1.** Na variante A (cobrança emitida na conta do IMED, com a parte da clínica separada pelo meio de pagamento
  antes de chegar ao saldo do IMED), a receita tributável do IMED é só a taxa? O que o meio de pagamento informa ao
  fisco no CNPJ do IMED: o valor inteiro ou só a taxa? Se for o inteiro, como se demonstra a diferença?
- **C2.** Qual atividade (CNAE) e qual item da lista de serviços usar para a taxa (intermediação) e para o Destaque
  (publicidade/veiculação)? ISS de qual município e com qual alíquota? Há retenção pela clínica?
- **C3.** Qual regime tributário para a empresa nova, sabendo que haverá essas duas receitas?
- **C4.** A nota do IMED para a clínica pode ser uma por mês com o total das taxas, ou precisa ser uma por exame?
- **C5.** Devolução e contestação depois de a nota emitida: como se cancela ou compensa?
- **C6.** A tarifa do meio de pagamento paga pelo IMED entra como custo? Como registrar?
- **C7.** Por quanto tempo guardar os registros financeiros (o desenho supõe 5 anos)?
- **C8.** A reforma tributária (CBS/IBS) cria um "split payment" **de imposto**, que é outra coisa com o mesmo nome:
  o que muda para uma plataforma de intermediação e a partir de quando?

**Para o advogado**
- **A1.** Código de Ética Médica (Resolução CFM 2.217/2018), art. 59 ("oferecer ou aceitar remuneração ou vantagens
  por paciente encaminhado ou recebido"), art. 58 (exercício mercantilista) e art. 72 (redação da Resolução CFM
  2.226/2019): uma taxa de 15% por exame pago pelo aplicativo, cobrada da clínica por uma empresa cujo dono e
  responsável técnico é médico, cabe nessas vedações? E para o diretor técnico da clínica? Há formato mais seguro
  (valor fixo por agendamento, mensalidade, taxa de serviço paga pelo paciente)?
- **A2.** Banco Central: na variante A o IMED é só um cliente do Asaas que usa a divisão, ou vira participante do
  arranjo de pagamento (subcredenciador), sujeito à Resolução BCB 150/2021 com as mudanças da Resolução BCB 522/2025?
  E na variante B?
- **A3.** Código de Defesa do Consumidor, art. 49 (arrependimento em 7 dias na compra fora do estabelecimento) e
  Decreto 7.962/2013: vale para exame com hora marcada? A regra de devolução do §4.5 está de acordo? Pode haver
  retenção em cancelamento de última hora ou em falta, e com que aviso prévio?
- **A4.** O IMED responde junto com a clínica (cadeia de fornecimento) se o exame pago não for feito? O que o contrato
  com a clínica precisa dizer sobre devolução, contestação, saldo para estorno e preço igual ao do balcão?
- **A5.** Destaque: publicidade identificada (CDC, art. 36) e regras de publicidade médica (Resolução CFM
  2.336/2023): o que o anúncio de uma clínica precisa mostrar e o que não pode prometer?
- **A6.** LGPD: o meio de pagamento é operador do IMED ou controlador próprio? Base legal para tratar o CPF do
  pagador; o que entra na política de privacidade e no relatório de impacto; pagador diferente do paciente; menor.
- **A7.** Termos de uso novos (paciente e clínica) e o contrato de adesão da clínica ao recebimento e ao Destaque.

**Para o Asaas (gerente da conta ou suporte)**
- **S1.** Itens [n/c] do §2.1, principalmente: QR de cobrança apagada; contestação com divisão; devolução com a
  carteira da clínica sem saldo; momento da liquidação da divisão; CPF obrigatório.
- **S2.** O período de avaliação limita cobranças com divisão para carteiras de **contas comuns** (não subcontas)?
- **S3.** Dá para validar um `walletId` por API antes da primeira cobrança?
- **S4.** A atividade "intermediação de exames e consultas" é aceita? Há tarifa ou limite diferente para saúde?

### 3.6 Cuidados legais registrados como risco (sem parecer)

| Tema | O que diz a regra (fonte) | O que o desenho faz |
|---|---|---|
| **CFM, art. 59** | É vedado ao médico "oferecer ou aceitar remuneração ou vantagens por paciente encaminhado ou recebido, bem como por atendimentos não prestados". Um despacho do setor jurídico do CFM de 2022, sobre telemedicina, tratou a retenção de percentual da consulta por plataforma como caso do art. 59 [parcial: li só o resumo da busca] | **Bloqueia a P2 até a resposta A1.** A taxa é cobrada da clínica pelo serviço de tecnologia, agenda e cobrança, só sobre exame efetivamente pago, e é devolvida quando o exame não acontece. O modelo de dados aceita trocar o percentual por valor fixo ou por mensalidade sem refazer nada (`fee_rules.tipo`) |
| **Banco Central** | Quem recebe e repassa dinheiro de terceiros entra nas regras dos arranjos de pagamento; a Resolução BCB 522/2025 mexeu na definição de subcredenciador; há notícia de decisão judicial contra empresa que fazia split sem autorização [parcial] | O IMED **nunca** recebe para repassar depois: a divisão é do meio de pagamento, na liquidação. Proibido no código: saldo de clínica em conta do IMED, repasse manual, "carteira" de paciente. Pergunta A2 |
| **CDC** | Arrependimento em 7 dias (art. 49), devolução imediata, informação clara, publicidade identificável | Regra de devolução simples e a favor do paciente (§4.5); devolução sempre pelo mesmo meio; Destaque rotulado "Anúncio" |
| **LGPD** | Dado de pagamento e dado de saúde juntos | O meio de pagamento recebe só nome e CPF do pagador, valor e um código do agendamento. **Nunca** o nome do exame, a especialidade, a data ou qualquer dado clínico (§6.3). Dado de cartão não passa pelo IMED |
| **Golpe do falso agendamento** | Hoje o site diz "o IMED nunca pede Pix" | A frase muda para "o IMED só recebe pagamento **dentro do site**, na tela do seu agendamento; nunca por telefone, WhatsApp, e-mail ou link" (§9). Nenhum link de pagamento é enviado por mensagem na primeira versão |

---

## 4. Encaixe na agenda: os estados

### 4.1 Duas máquinas que andam juntas

O **agendamento** já tem a máquina dele (arquitetura da agenda, §5). A **cobrança** ganha a sua:

| Situação da cobrança | Quer dizer | Quem leva a ela |
|---|---|---|
| `criada` | Registrada aqui; ainda sem resposta do meio de pagamento | servidor |
| `aguardando` | Existe no meio de pagamento; QR ou página de cartão disponível | servidor |
| `processando` | O meio de pagamento está analisando (cartão) | aviso |
| `aprovada` | Dinheiro confirmado e valor conferido | aviso + consulta ao meio |
| `expirada` | Venceu sem pagamento e foi apagada no meio de pagamento | rotina |
| `cancelada` | O paciente desistiu ou a clínica cancelou antes de pagar | paciente, clínica |
| `recusada` | Cartão recusado | aviso |
| `devolvida_parcial` / `devolvida` | Devolução feita (o total devolvido fica em centavos) | devolução concluída |
| `contestada` | O titular do cartão contestou a compra | aviso |

Regras fixas: `devolvida` e `expirada` não voltam a `aprovada`; `contestada` só volta a `aprovada` se a contestação
for vencida; o total devolvido nunca diminui e nunca passa do valor pago.

### 4.2 Pix, passo a passo (clínica com recebimento ligado)

```
0:00  Paciente escolhe o horário, preenche os dados e toca em "Ir para o pagamento"
      servidor: reserva (hold, 10 min) ─> cria a cobrança ─> agendamento "Aguardando pagamento"
0:02  Tela mostra QR + "copia e cola" + relógio de 8 min
      (paga) aviso do Asaas ─> servidor consulta o Asaas ─> valor confere ─> "Confirmado" + comprovante
8:00  Relógio zera: a tela esconde o QR; a rotina apaga a cobrança no Asaas
10:00 Fim do prazo da reserva
15:00 Fim da carência: o horário volta para a agenda ("Reserva expirada")
```

O QR some da tela 2 minutos antes do fim da reserva e o horário só é solto 5 minutos depois: um Pix feito no último
segundo ainda encontra o horário guardado. Como o QR do Asaas não vence sozinho em minutos [doc], **quem vence é a
nossa cobrança**: a rotina apaga no Asaas. Se mesmo assim chegar dinheiro, vale a regra do "pagamento depois de
expirar" (§4.4).

### 4.3 Cartão (fase P4)

O paciente é levado à **página do Asaas** para digitar o cartão (o IMED não vê nem guarda número de cartão) e volta
para o site. O agendamento confirma com o aviso de pagamento confirmado; o dinheiro fica disponível 32 dias depois
[parcial]. Só à vista na primeira versão. Se a pré-autorização funcionar na página hospedada [n/c], o cartão é só
reservado, o horário é confirmado e aí se captura: assim ninguém é cobrado por horário que não levou.

### 4.4 Todos os casos

| Caso | O que acontece |
|---|---|
| **Pix não pago no prazo** | Cobrança `expirada` e apagada no Asaas; agendamento `expired`; horário livre. O paciente vê "O tempo acabou. Escolha o horário de novo." |
| **Pagamento chega depois de a reserva expirar** | O servidor tenta confirmar pelo motor completo: se o horário ainda está livre e o paciente não tem outro agendamento no mesmo horário, confirma (`expired → confirmed`). Se não, **devolve tudo automaticamente** e avisa. Nunca passa por cima de outro paciente |
| **Paciente fecha a página** | Nada se perde: a confirmação vem do aviso do Asaas, não da página. Ao voltar (o aparelho guarda o código do agendamento, como na 5.1), o site mostra "Continuar o pagamento" enquanto houver prazo, ou o comprovante, ou "o tempo acabou" |
| **Aviso repetido** | Cada aviso tem um `id`; o segundo cai na trava de unicidade e responde "repetido", sem efeito |
| **Aviso fora de ordem** | O aviso é só a campainha. O servidor **consulta a situação atual da cobrança no Asaas** e aplica essa situação; a ordem de chegada não importa. Situação que anda para trás é ignorada e registrada |
| **Aviso falso** | Sem o segredo no cabeçalho, é recusado. Mesmo com o segredo, o corpo não é aceito como verdade (vale a consulta) |
| **Valor pago diferente do esperado** | Não confirma; abre diferença crítica para a equipe; devolve o que chegou |
| **Asaas fora do ar ao criar a cobrança** | A reserva é solta na hora e o paciente vê "pagamento indisponível agora"; nenhuma reserva fica sem cobrança por mais de 60 s |
| **Aviso não chega** | A rotina consulta no Asaas toda cobrança `aguardando` perto de vencer, e a conciliação diária pega o resto |
| **Dois pacientes, mesmo horário** | Igual à 5.1: só um consegue a reserva; o outro recebe "horário ocupado" antes de qualquer cobrança |
| **Paciente tenta pagar duas vezes** | Uma cobrança viva por agendamento (trava no banco); QR dinâmico só é pago uma vez [doc] |
| **Paciente desiste antes de pagar** | "Cancelar": cobrança apagada no Asaas, horário solto |
| **Paciente cancela depois de pagar** | `agenda_cancel` como hoje + devolução pela regra do §4.5 |
| **Remarcação** | O dinheiro não se mexe: a mesma cobrança acompanha o agendamento (mesmo exame, mesmo preço fotografado). Trocar de exame = cancelar (devolve) e pagar o novo |
| **Clínica cancela, aparelho quebra, bloqueio forçado** | Devolução total automática, inclusive a taxa do IMED. Se a clínica e o paciente preferirem remarcar, a devolução é desfeita **só enquanto não foi enviada** |
| **Falta do paciente** | Sem devolução automática. A clínica pode devolver tudo ou parte pelo painel (decisão 4) |
| **Devolução parcial** | Pacote de 2 a 4 exames com um cancelado: devolve o preço daquele exame. Ou valor escolhido pela clínica, até o que resta. A taxa do IMED volta na mesma proporção |
| **Contestação no cartão** | Cobrança `contestada`; nada é cancelado sozinho; a central junta as provas (confirmação, chegada registrada, exame concluído, aceite dos termos) e responde pelo Asaas. Quem arca: contrato (decisão 12) |
| **Clínica desliga o recebimento com exames pagos por vir** | Só deixa de aceitar novos; os pagos seguem normais e as devoluções continuam funcionando |
| **Preço muda durante o pagamento** | Vale o preço fotografado na reserva; a mudança só vale para a próxima marcação |
| **Convênio e SUS** | Não passam por pagamento online (decisão 9) |

### 4.5 Regra de devolução (recomendação de partida; decisão 3)

1. **Até 24 h antes do exame:** devolução total, sem perguntar o motivo.
2. **Dentro de 7 dias da compra e antes do exame:** devolução total sempre (cobre o arrependimento do CDC; A3).
3. **Menos de 24 h antes:** devolução total também, **durante o piloto**; mede-se o abuso antes de criar retenção.
4. **Falta:** sem devolução automática; a clínica decide caso a caso.
5. **Culpa da clínica ou do IMED:** devolução total automática, sempre.
6. Devolução **sempre pelo mesmo meio e para o mesmo pagador** (Pix volta para a conta que pagou; cartão, para o
   cartão). Nunca para outra conta.
7. **A taxa do IMED volta junto, na proporção.** O IMED só ganha sobre exame que aconteceu. A tarifa do meio de
   pagamento não volta [doc] e fica como custo do IMED.

Conta da devolução parcial (fecha sempre no centavo): sendo `P` o preço do exame, `T` a taxa e `D` o total devolvido
até agora, a taxa devolvida acumulada é `piso(D × T / P)`, e é `T` quando `D = P`. A parte da clínica em cada devolução
é o valor devolvido menos o aumento da taxa devolvida.

### 4.6 O que muda nas funções da agenda (fase P1, tudo desligado por clínica)

| Função | Mudança |
|---|---|
| `agenda_pay_hold` (nova, só servidor) | Reserva do paciente pagante: chama o mesmo núcleo (`private.agenda_book_int`) com situação `hold`, canal `imed_app` e as regras de venda online |
| `private.agenda_to_awaiting` (nova) | `hold → awaiting_payment` quando a cobrança existe no meio de pagamento |
| `private.agenda_confirm_paid` (nova) | `awaiting_payment → confirmed`; e `expired → confirmed` **pelo motor completo** (travas, horário livre, paciente sem sobreposição) |
| `private.agenda_expire` | Não expira enquanto houver cobrança `processando` (teto de 30 min); trava a cobrança depois do pedido |
| `agenda_cancel`, `agenda_set_status` (cancelar), bloqueio forçado | Depois de cancelar, pedem a devolução pela regra (`private.pag_refund_by_rule`) na mesma transação |
| `agenda_reschedule` | Sem mudança de dinheiro; só recusa trocar de exame em agendamento pago |
| `agenda_public_info` | Passa a dizer o modo de pagamento da clínica (`no_local` ou `online`, meios aceitos, preço mínimo) e o texto certo |
| `agenda_my_booking` | Ganha o resumo do pagamento (situação, valor, prazo), sem dado do meio de pagamento |
| `unit_settings.payment_mode` | A restrição passa a aceitar `online`; só muda por função, com a conta da clínica ativa |

**Ordem das travas** (continua a da agenda): configuração da clínica → pedido → cobrança → recursos. Quem aplica um
aviso lê a cobrança sem trava para achar o pedido, trava o pedido, trava a cobrança e lê de novo.

**Invariantes novos (viram teste):**
- **P-I1.** Agendamento `confirmed` com `payment_mode = 'online'` tem exatamente uma cobrança `aprovada` (ou
  `devolvida_parcial`/`contestada`) de valor igual ao `total_cents`.
- **P-I2.** Cobrança `aprovada` sem agendamento ativo tem devolução total pedida na mesma transação.
- **P-I3.** No máximo uma cobrança viva (`criada`, `aguardando`, `processando`, `aprovada`) por agendamento.
- **P-I4.** Para toda cobrança: `valor = taxa + parte da clínica`, e o mesmo vale exame a exame.
- **P-I5.** `devolvido ≤ pago`; `taxa devolvida ≤ taxa`; `parte da clínica devolvida ≤ parte da clínica`.
- **P-I6.** Nenhuma linha do extrato é alterada ou apagada (só acrescenta).

---

## 5. Banco

### 5.1 Regras do schema

- Schema novo **`pagamentos`**, fora da API (como `agenda`, `prontuario` e `private`): RLS ligada, sem policy e sem
  permissão para `anon`/`authenticated`. Tudo entra e sai por funções `SECURITY DEFINER` com `search_path` vazio,
  permissão conferida por dentro e `REVOKE` explícito, função a função.
- **Dinheiro em `integer` de centavos.** Nada de `numeric`, `float` ou reais com vírgula. Percentual em pontos-base
  inteiros (`1500` = 15%).
- **Nunca guardar:** número, validade, código ou "token" de cartão; chave de API; o segredo do webhook; o corpo
  inteiro dos avisos (traz dados do pagador); CPF em texto puro.
- Trilhas só com códigos e ids (sem nome, sem texto livre), como na agenda.
- Nomes de restrição fixos; toda migração com volta testada no CI; nome do arquivo igual à versão aplicada.

### 5.2 Tabelas (referência)

```
pagamentos.settings          chave/valor com histórico pelo audit_log: vendas_online_ligadas (chave geral), minutos_qr,
                             preco_minimo_online_cents, tolerancia_destaque_dias, regra_devolucao_*
pagamentos.clinic_accounts   clinic_id PK, provedor 'asaas', wallet_id, emitida_por ('imed'|'clinica'),
                             situacao ('nao_ligada','em_conferencia','ativa','suspensa'), meios (pix, cartao),
                             termos_versao, aceito_em, aceito_por, conferida_em, conferida_por
pagamentos.fee_rules         id, clinic_id (nulo = padrão), finalidade ('exame','teleconsulta'), tipo ('percentual',
                             'fixo'), fee_bps, fee_cents, vale_de, vale_ate, motivo, criado_por
                             EXCLUDE: sem dois períodos sobrepostos para a mesma clínica e finalidade. Nunca UPDATE do
                             valor: taxa nova = linha nova que fecha a anterior
pagamentos.payers            id, user_id (nulo), cpf_hmac, provedor_cliente_id, criado_em   (sem nome, sem CPF puro)
pagamentos.charges           id, finalidade ('agendamento','destaque','teleconsulta','consultorio'), request_id,
                             subscription_id, clinic_id, payer_id, provedor, provedor_cobranca_id UNIQUE, emitida_por,
                             meio ('pix','cartao','boleto'), valor_cents, fee_bps (foto), taxa_cents, clinica_cents,
                             tarifa_meio_cents (real, vinda do provedor), situacao, expira_em, paga_em,
                             devolvido_cents, taxa_devolvida_cents, clinica_devolvida_cents, pix_copia_cola (apagado
                             ao sair de 'aguardando'), tentativa, chave_idempotencia UNIQUE, versao, criado_em
                             UNIQUE parcial: uma cobrança viva por request_id
pagamentos.charge_items      charge_id, item_id (agenda.appointment_items), preco_cents, taxa_cents, clinica_cents,
                             devolvido_cents
pagamentos.events            id, provedor, provedor_evento_id, charge_id, tipo, situacao_no_provedor, valor_cents,
                             ocorrido_em, recebido_em, hash_do_corpo, resultado ('pendente','aplicado','repetido',
                             'ignorado_antigo','sem_cobranca','valor_divergente','erro')
                             UNIQUE (provedor, provedor_evento_id)
pagamentos.refunds           id, charge_id, item_id (nulo = cobrança inteira), valor_cents, taxa_cents, clinica_cents,
                             motivo (código), pedido_por (tipo e user_id), situacao ('pedida','enviada','concluida',
                             'falhou'), provedor_estorno_id, chave_idempotencia UNIQUE, tentativas, criado_em
pagamentos.disputes          id, charge_id, provedor_disputa_id, motivo (código), situacao, aberta_em, prazo,
                             resultado ('ganha','perdida'), encerrada_em
pagamentos.ledger            extrato, só acrescenta: id, quando, charge_id, refund_id, clinic_id, tipo ('recebido',
                             'taxa_imed','repasse_clinica','tarifa_meio','devolucao','devolucao_taxa',
                             'devolucao_repasse','contestacao','contestacao_revertida','mensalidade'), valor_cents
                             (com sinal), de_quem ('paciente','imed','clinica','meio')
pagamentos.reconciliation_runs   id, dia, janela, começou, terminou, situacao, contadores
pagamentos.reconciliation_diffs  run_id, provedor_cobranca_id, charge_id, tipo ('falta_aqui','falta_la','valor',
                             'situacao','repasse','tarifa'), nosso, deles, critica, resolvida_em, resolvida_por,
                             resolucao (código)
pagamentos.plans             codigo ('destaque', depois 'consultorio_virtual'), preco_cents, vale_de, vale_ate
pagamentos.subscriptions     id, clinic_id (ou doctor_id), plano, preco_cents (foto), provedor_assinatura_id,
                             situacao ('pendente','ativa','atrasada','suspensa','cancelada'), pago_ate,
                             tolerancia_ate, cancelar_no_fim, criado_por
pagamentos.featured          clinic_id PK, desde, ate   (o que a busca lê; mantida pela função da assinatura)
pagamentos.audit_log         só acrescenta: quando, quem (user_id | 'webhook' | 'rotina' | 'sql'), ação (código),
                             ids, antes e depois (códigos e centavos)
```

`private.billing_charges` (cobranças registradas à mão pela equipe) **continua** para o que for cobrado por fora; o
painel de gestão soma as duas fontes e mostra de onde veio cada número.

### 5.3 Funções

| Quem chama | Função | O que faz |
|---|---|---|
| Só servidor (Edge Function) | `pag_charge_open(p_request, p_token, p_meio, p_key)` | Confere o código do agendamento, a reserva viva, a clínica ativa e o preço mínimo; **calcula os valores a partir dos itens do banco** (nunca do navegador); fotografa a taxa; grava a cobrança `criada`. Idempotente |
| Só servidor | `pag_charge_attach(p_charge, p_provedor_id, p_expira, p_copia_cola)` | `criada → aguardando`; agendamento `hold → awaiting_payment` |
| Só servidor | `pag_event_store(...)` / `pag_sync_apply(p_charge, p_foto)` | Grava o aviso (repetido não entra) e aplica a situação consultada no provedor: precedência, valor, confirmação do agendamento, extrato. Devolve a ação seguinte (ex.: "devolver tudo") |
| Só servidor | `pag_due()` | Lista o que a rotina deve fazer: apagar cobrança vencida, consultar cobrança sem aviso, enviar devolução pedida, reaplicar aviso pendente |
| Só servidor | `pag_refund_sent` / `pag_refund_done` / `pag_refund_failed` | Andamento da devolução |
| Só servidor | `pag_reconcile_apply(p_dia, p_linhas)` | Compara e grava as diferenças |
| Só servidor | `pag_subscription_sync(...)` | Situação da mensalidade e da faixa de destaque |
| Paciente (código do agendamento ou conta) | `pag_my_payment(p_request, p_token)` | Situação, valor, prazo, meio, "copia e cola" enquanto vale, devoluções. Sem id do provedor |
| Clínica (`financeiro.ver`) | `pag_clinic_status`, `pag_clinic_statement(p_clinic, p_de, p_ate)` | Situação do recebimento; extrato por exame (valor, taxa, parte dela, situação, previsão), com registro de leitura |
| Clínica (`financeiro.configurar`, nova, só dono) | `pag_clinic_connect`, `pag_clinic_pause` | Informar a carteira e aceitar os termos; pausar novos recebimentos |
| Clínica (`financeiro.estornar`, nova) | `pag_clinic_refund(p_request, p_item, p_valor, p_motivo)` | Pede devolução total ou parcial |
| IMED (`imed.financeiro.ver`) | `admin_pag_resumo`, `admin_pag_lista`, `admin_pag_conciliacao`, `admin_pag_assinaturas` | Leituras da gestão |
| IMED (`imed.financeiro.operar`, nova) | `admin_pag_taxa_definir`, `admin_pag_conta_conferir`, `admin_pag_estornar`, `admin_pag_diferenca_resolver`, `admin_pag_chave_geral` | Sempre com motivo em código e registro |

### 5.4 Conciliação diária

Todo dia, de madrugada, a rotina pede ao Asaas as cobranças, divisões e devoluções do dia anterior e compara com o
extrato do IMED, cobrança por cobrança:

| Diferença | Gravidade | O que quer dizer |
|---|---|---|
| `falta_aqui` | **crítica** | O Asaas recebeu e o IMED não sabe: dinheiro sem agendamento |
| `falta_la` | **crítica** | O IMED diz "pago" e o Asaas não: agendamento confirmado sem dinheiro |
| `valor` | **crítica** | Valores diferentes |
| `repasse` | **crítica** | A clínica recebeu diferente de `clinica_cents` |
| `situacao` | alta | Devolução ou contestação que não chegou por aviso |
| `tarifa` | informativa | Tarifa real diferente da esperada (registra a real) |

A rotina também refaz os dias D−7 e D−32 (o cartão muda de situação 32 dias depois) e nunca passa de 14 dias sem
olhar um dia (prazo em que o Asaas guarda os avisos [doc]). Diferença crítica aberta acende um aviso vermelho na
gestão; só uma pessoa com `imed.financeiro.operar` fecha, com motivo. A conciliação **não corrige nada sozinha**.

### 5.5 Retenção

Cobranças, devoluções, extrato e conciliação: 5 anos (C7). Avisos: 1 ano (só o hash e os campos da lista). "Copia e
cola" do Pix: apagado quando a cobrança sai de `aguardando`. `payers`: enquanto houver cobrança ligada.

---

## 6. Edge Functions e segurança

### 6.1 Funções (Deno, como as atuais)

| Função | Quem chama | O que faz |
|---|---|---|
| `pagamento-criar` | O site do paciente | Confere o Turnstile e os limites; `agenda_pay_hold`; `pag_charge_open`; cria (ou reaproveita) o cliente e a cobrança no Asaas com a divisão; `pag_charge_attach`; devolve QR, "copia e cola" e prazo (ou o endereço da página do cartão). Se o Asaas falhar, solta a reserva |
| `pagamento-webhook` | O Asaas | Compara o cabeçalho `asaas-access-token` com o segredo (comparação em tempo constante; sem segredo configurado, recusa tudo); grava o aviso; consulta a cobrança no Asaas; `pag_sync_apply`; responde 200 assim que o aviso está **gravado** (aplicar pode repetir depois; assim a fila do Asaas não é penalizada por erro nosso) |
| `pagamento-rotina` | pg_cron (a cada minuto e uma vez de madrugada), pelo endereço em `private.app_settings` | Executa `pag_due()`: apaga cobranças vencidas, consulta as sem aviso, envia devoluções, reaplica pendências, roda a conciliação |
| `pagamento-clinica` | Painel da clínica e gestão (com a sessão do usuário) | Ligar o recebimento, conferir a carteira, assinar e cancelar o Destaque |

Todas com `verify_jwt=false` e autorização própria (como `clinicas-proximas`), origem conferida pelo bloco
`endereco-do-site`, e uma camada fina `provedor.ts` (criar cobrança, consultar, apagar, devolver, listar) para que
trocar de meio de pagamento não toque no resto. `lib.ts` com `lib.test.ts`, como nas funções atuais.

### 6.2 Segredos e limites

- **Segredos só nos segredos das Edge Functions:** chave de API do Asaas (uma de testes, uma de produção, em projetos
  separados), segredo do webhook, chave do HMAC do CPF, chave do Turnstile. Nunca no repositório, no `config.js`, em
  tabela ou em log. Teste de catálogo (como `chaves.test.mjs`) reprova chave com cara de Asaas no código.
- **Chave do Asaas com o mínimo de permissão** que o Asaas permitir (a documentação tem uma página de permissões de chave [parcial]);
  se houver lista de IPs de origem, usar.
- **Contra abuso** (a reserva antes do pagamento é a porta para robô travar agenda): Turnstile **obrigatório** em
  `pagamento-criar` (vira pré-requisito da P2; era a decisão 10 da agenda); 1 reserva aguardando pagamento por telefone
  e por aparelho; no máximo 3 tentativas de cobrança por agendamento; limite por clínica e por IP com hash (decisões
  20 e 25 da agenda); quem deixa vencer 3 reservas seguidas espera 30 min.
- **Devolução:** nunca pelo navegador direto no Asaas; sempre pedido gravado no banco (com chave de idempotência) e
  enviado pela rotina. O mesmo pedido enviado duas vezes resulta em uma devolução.
- **Chave geral:** `vendas_online_ligadas = false` para de criar cobranças em todas as clínicas na hora; o que já foi
  pago continua sendo processado e devolvido normalmente.

### 6.3 O que o meio de pagamento recebe (LGPD)

| Vai para o Asaas | Não vai |
|---|---|
| Nome e CPF **do pagador** (pedidos na hora de pagar; o CPF não fica guardado aqui em texto, só um HMAC para não duplicar o cadastro) | Nome do exame, especialidade, data e hora, preparo, convênio, qualquer dado clínico |
| Valor | Telefone e e-mail (os avisos do Asaas ao pagador ficam desligados; quem avisa é o IMED) |
| Descrição fixa: "IMED · agendamento" + código curto | Nome do paciente quando é outra pessoa |
| Referência externa: o id da cobrança (uuid) | Endereço, localização |
| A carteira da clínica (é inerente à divisão) | |

O Asaas fica sabendo que a pessoa X pagou a clínica Y: isso é inevitável em qualquer pagamento e entra na política de
privacidade e na pergunta A6.

---

## 7. Telas

### 7.1 Paciente (`local.html`, "Meus pedidos", `conta.html`)

- No horário direto, clínica com recebimento: o botão vira **"Ir para o pagamento"**; antes dele, um resumo com o
  exame, o valor, "o horário fica guardado por 10 minutos" e a regra de devolução em uma frase.
- Tela do Pix: QR, botão "Copiar código", relógio, "já paguei" (só confere, não confirma nada), "Cancelar". Região
  viva para leitor de tela; tudo pelo teclado; funciona em 360 px.
- Confirmado: o mesmo cartão de confirmação da 5.1 + **comprovante** (valor, data e hora, meio, código do
  agendamento, nome da clínica, "nota fiscal emitida pela clínica") e "Adicionar à agenda".
- Voltar depois: "Continuar o pagamento" enquanto houver prazo.
- Cancelar agendamento pago: mostra antes quanto volta e em quanto tempo; depois, "Devolução pedida" → "Devolvido em
  dd/mm".
- Sempre o aviso novo contra golpe (§9).

### 7.2 Clínica (`painel.html`, aba Financeiro)

- **Ligar o recebimento:** passo a passo (abrir a conta no Asaas → colar o identificador da carteira → ler e aceitar
  os termos com a taxa → a equipe do IMED confere com uma cobrança de teste de valor baixo, devolvida em seguida →
  "Ativo"). Só o dono da clínica.
- **Extrato:** por dia e por exame: valor, taxa do IMED, o que caiu na conta, situação (pago, devolvido, contestado) e,
  no cartão, a data prevista. Totais do período; baixar em CSV. Mesmas permissões e registro de leitura da 3.4.
- **Devolver:** no detalhe do agendamento pago, "Devolver tudo" ou "Devolver parte", com motivo.
- **Pausar** novos recebimentos (volta ao "pagamento no local").
- **Destaque:** assinar, ver a situação, a próxima cobrança e cancelar.

### 7.3 Gestão do IMED (`gestao.html`)

- **Receita das taxas** (o que é do IMED), **tarifas do meio**, **repasses** (o que foi para as clínicas),
  **devoluções** e **contestações**, por período e por clínica. Cada número diz a fonte: "cobrado pelo site" ou
  "registrado à mão".
- **Conciliação:** último dia conferido, diferenças abertas, resolver com motivo.
- **Mensalidades:** em dia, atrasadas (dias), suspensas, canceladas; receita do mês.
- **Clínicas:** quem ligou o recebimento, quem está em conferência, taxa de cada uma e o histórico.
- **Chave geral** e o estado das rotinas (última execução, avisos pendentes).

---

## 8. Destaque (mensalidade)

**Preço:** recomendação já apresentada ao dono e **ainda não confirmada**: R$ 149,00/mês no lançamento e R$ 299,00 na
tabela (decisão 14). O preço mora em `pagamentos.plans`, com histórico; cada assinatura guarda o preço de quando
começou.

**O que o Destaque é:**
- A lista de resultados **continua por distância**, e o assinante continua na posição normal dele.
- Além disso, aparece numa faixa **"Destaques"**, com o rótulo **"Anúncio"** visível (e lido pelo leitor de tela),
  no alto da busca e da página da cidade.
- Só aparece quando faz sentido para a busca: dentro da área procurada e, com exame no filtro, só se a clínica faz
  esse exame. Nunca em busca pelo SUS.
- No máximo 3 por busca; havendo mais assinantes, **rodízio** (sem leilão, sem "quem paga mais").
- Só **parceiro verificado**, com cadastro em ordem.

**O que o Destaque nunca faz:** mudar a ordem da lista, a nota, o selo, o "próximo horário" ou o preço; esconder
concorrente; aparecer sem o rótulo.

**Estados:**

```
pendente ──1º pagamento──> ativa ──cobrança atrasada──> atrasada ──5 dias sem pagar──> suspensa ──30 dias──> cancelada
                             ^                              │ pagou                       │ pagou
                             └──────────────────────────────┴─────────────────────────────┘
```

- `atrasada`: o destaque **continua** por 5 dias (tolerância), com aviso à clínica nos dias 1, 3 e 5.
- `suspensa`: o destaque sai; cadastro, agenda e recebimento continuam normais; pagou, volta na hora.
- Cancelar a pedido: vale até o fim do mês já pago; sem cobrança nova.
- A cobrança é uma assinatura mensal no Asaas, na conta do IMED, sem divisão; nota de serviço do IMED para a clínica.

---

## 9. Textos do site que mudam (arquivo, frase e quando)

Regra: **o texto muda no mesmo envio que liga a novidade**, nunca depois. Linhas conferidas no ramo `ci/agenda-5-1`.

| Onde | Frase de hoje | Muda quando | Como fica (sugestão) |
|---|---|---|---|
| `assets/js/geo-core.js:571` (`TRUST.gratis`; aparece na busca e na página do local) | "O IMED é gratuito para você. Se houver cobrança pelo exame, o pagamento é feito direto no local. O IMED nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp." | P2 | "Usar o IMED não custa nada a mais: você paga só o preço do exame. Em alguns locais o pagamento é feito aqui no site, na tela do seu agendamento; nos outros, direto no local. O IMED nunca pede pagamento, senha ou código por telefone, WhatsApp, e-mail ou link." |
| `assets/js/geo-core.js:572` (`TRUST.privacidade`) | "Seus dados vão só para o IMED e para o local escolhido · … · sem anúncios e sem rastreadores de anúncio" | P2 (pagamento) e P5 (anúncios) | "…e, quando você paga pelo site, os dados do pagamento vão para o meio de pagamento · sem rastreadores de anúncio" (P5: tirar "sem anúncios"; os anúncios são só de clínicas e não usam seus dados) |
| `index.html:968` (pergunta "O IMED cobra alguma coisa?") | "Não. O IMED é gratuito para você. Se houver cobrança… direto no local. O IMED nunca pede Pix…" | P2 | Mesma ideia da linha de cima |
| `index.html:971` | "Os dados do pedido vão só para o IMED e para o local escolhido… O IMED não tem anúncios nem rastreadores de anúncio." | P2 e P5 | Idem |
| `index.html:973` | "Do mais perto para o mais longe. Ninguém paga para aparecer primeiro, e selo não se vende." | P5 | "Do mais perto para o mais longe. A faixa 'Destaques' é anúncio pago e vem marcada como anúncio; pagar não muda a ordem da lista, a nota nem o selo." |
| `index.html:958` e `:975`, `parceiros.html:8`, `:14`, `:86`, `contato.html:83`, `:120`, `scripts/gerar-cidades.mjs:327`, `:383` | "Cadastro sem custo" / "sem custo" | P2 | "Cadastro sem custo. Taxa só sobre exame pago pelo aplicativo." (o cadastro continua gratuito de verdade) |
| `parceiros.html:121` | "A lista de resultados é ordenada por distância. Ninguém paga para aparecer primeiro." | P5 | Como em `index.html:973` |
| `parceiros.html:122` | "Selo não se vende, e ninguém paga para mudar nota ou posição." | P5 | **Continua verdade e fica.** Acrescentar: "O Destaque é um anúncio à parte, identificado." |
| `como-funciona.html:60` | "Ninguém paga para aparecer primeiro. Parceiro e local do cadastro oficial entram na mesma ordem de distância." | P5 | Como em `index.html:973` |
| `como-funciona.html:61` | "Selo não se vende: o selo 'Parceiro verificado' depende só da conferência descrita abaixo." | — | **Continua verdade e fica** (o teste `cidades.test.mjs:372` continua valendo) |
| `como-funciona.html:120`, `termos.html:47`, `:78`, `contato.html:93`, `assets/js/confianca.js:61` | "Cancelar pelo IMED é grátis" | P2 | Continua verdade; acrescentar a regra de devolução para exame pago |
| `como-funciona.html:126`, `sobre.html:54` | "Para você, o IMED é gratuito. Se houver cobrança… direto no local." | P2 | Como `TRUST.gratis` |
| `como-funciona.html:127`, `contato.html:95`, `assets/js/contato.js:65`, `sobre.html:54` | "O IMED nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp." | P2 | "O IMED só recebe pagamento dentro do site, na tela do seu agendamento. Nunca por telefone, WhatsApp, e-mail ou link enviado por mensagem." |
| `termos.html:52` | "…é gratuito para o paciente." | P2 | "…não cobra do paciente nada além do preço do exame." |
| `termos.html:62` | "A lista de resultados é ordenada por distância. Ninguém paga para aparecer primeiro." | P5 | Como em `index.html:973` |
| `termos.html:73` | "O pagamento, quando houver, é feito direto no local: o IMED nunca pede Pix…" | P2 | Seção nova "Pagamento pelo site": quem recebe, a divisão, devolução, nota fiscal pela clínica, contestação (texto do advogado, A7) |
| `teleconsulta.html:122`, `termo-teleconsulta.html:115` | "O IMED não cobra nada pelo site nesta fase e nunca pede Pix…" | P2 | "A teleconsulta não é cobrada nesta fase." + aviso novo contra golpe (muda de novo quando a teleconsulta paga existir) |
| `perto.html:147` | "…e ninguém paga para aparecer primeiro." | P5 | "A lista vem do mais perto para o mais longe. 'Destaques' é anúncio." |
| `scripts/gerar-cidades.mjs:240`, `:510`, `:513` → **318 páginas de `cidades/`** e `llms.txt:16`, `:19` | As mesmas frases (gratuito, direto no local, nunca pede Pix, ninguém paga para aparecer primeiro) | P2 e P5 | Trocar no gerador e gerar de novo |
| `privacidade.html:79` | "Hoje o site não recebe pagamentos: a equipe registra as cobranças feitas por fora" | P2 | Linha nova "Pagamento pelo site": dados (nome e CPF do pagador, valor, situação), para quê, base legal, com quem (meio de pagamento, nomeado), por quanto tempo |
| `privacidade.html:89` | "Não vendemos seus dados e não os compartilhamos com anunciantes." | P5 | Continua verdade e fica; acrescentar que o Destaque não usa dado de paciente |
| `privacidade.html:104` e seguintes (onde ficam os dados, com quem compartilhamos) | Só Supabase e envio de e-mail | P2 | Acrescentar o meio de pagamento |
| `assets/js/gestao.js:101` | "O IMED ainda não recebe pagamentos pelo site; aqui a equipe registra as cobranças feitas por fora" | P2 | "Cobranças feitas por fora, registradas pela equipe. O que foi pago pelo site está em Recebimentos." |
| Banco: `agenda_public_info` (`…_agenda_motor_parte_1.sql:479`) | "Pagamento no local, direto com a clínica." | P1/P2 | Texto conforme o modo da clínica |
| `assets/js/geo-core.js:566` (comentário do código) | "Só fatos verdadeiros. Se algum deixar de valer (ex.: o IMED passar a cobrar ou a usar anúncios), mude aqui" | P2 | É exatamente este caso |

**Testes que travam essas frases e mudam junto:** `tests/geo-core.test.mjs:340-342`, `tests/cidades.test.mjs:222`,
`:336-337`, `:371-380`, `tests/e2e-conteudo.mjs:200-216`, `:342`, `tests/e2e-inicio.mjs:338`, `:346`,
`tests/e2e-local.mjs:374`, `:388`, `tests/e2e-perto.mjs:297`, `:364`, `:382`, `tests/e2e-cidades-faq.mjs:282`,
`tests/e2e-tele.mjs:1327`. Teste novo: nenhuma página pode dizer "gratuito", "nunca pede Pix" ou "ninguém paga para
aparecer" na forma antiga depois da fase correspondente.

---

## 10. Plano por fases

Regras de todas: banco antes do site; desligado por padrão e ligado **por clínica**; `VERSION` do `sw.js`; todos os
testes; migração com volta testada no CI e nome igual à versão aplicada; trabalho em worktree limpa; nada de produção
sem a aprovação do dono.

**P0 — Conta, respostas e ambiente de testes (nada no site)**
- O quê: CNPJ; conta do IMED no Asaas (produção) com chave Pix cadastrada e conta de testes (sandbox); respostas C1,
  C2, A1, A2 e S1 (as que podem mudar o desenho); a lista de 12 conferências do §2.3 feita no sandbox, por um
  roteiro manual do GitHub (`workflow_dispatch`, chave de testes em segredo do GitHub, fora do `banco.yml`); este
  documento atualizado com o que foi confirmado; um segundo projeto gratuito do Supabase só para os testes de ponta
  a ponta com o sandbox (decisão 18).
- Do dono: abrir o CNPJ; abrir as contas; levar as perguntas ao contador e ao advogado; combinar com a clínica piloto.
- Teste: o roteiro do sandbox responde cada item com "confirmado" ou "diferente do desenho".
- Volta: não há o que voltar.

**P1 — Banco e conciliação (desligado; nada muda para ninguém)**
- O quê: `<ts>_pagamentos_base_parte_1..N`: schema, tabelas do §5.2, funções do §5.3, mudanças da agenda do §4.6,
  permissões novas, `vendas_online_ligadas = false`, nenhuma clínica com conta. Um **provedor falso** local
  (`tests/banco/asaas-falso.mjs`) para o CI, que não alcança a internet.
- Do dono: aprovar o SQL quando o Supabase pedir.
- Testes: os do §11 (pgTAP, corrida, aviso repetido, falha no meio); `get_advisors` sem alerta novo; os testes
  atuais da agenda continuam verdes (a 5.1 não muda).
- Volta: script de volta única na última parte; como nada usa, voltar não perde dado.

**P2 — Pix com divisão na clínica piloto**
- **P2a (invisível):** Edge Functions `pagamento-criar`, `pagamento-webhook`, `pagamento-rotina`; fluxo "Ir para o
  pagamento" no `local.js`; comprovante; devolução automática total (pagamento atrasado, clínica cancela, paciente
  cancela); Turnstile; tudo ponta a ponta no projeto de testes com o sandbox e a clínica de demonstração.
- **P2b (piloto):** textos da coluna "P2" do §9, termos e privacidade novos; aba Financeiro mínima no painel (situação
  e extrato); gestão mínima (lista e conciliação diária); a piloto é ligada pela equipe (como na 5.1-d), depois de
  um pagamento real de valor baixo feito pela própria equipe e devolvido.
- Do dono: respostas A1 e C1 favoráveis (ou o ajuste); termos revisados; aceitar o contrato com a piloto; autorizar a
  publicação das funções e ligar a chave geral.
- Testes: e2e do pagamento (Pix pago, vencido, página fechada e reaberta, aviso repetido), a11y dos estados novos,
  velocidade, os testes de texto atualizados, conciliação de 7 dias seguidos sem diferença crítica antes de abrir a
  segunda clínica.
- Volta: chave geral desligada (segundos); a piloto volta a "pagamento no local"; os textos voltam com um commit.

**P3 — Devoluções completas e remarcação**
- O quê: devolução parcial e por exame; "Devolver" no painel da clínica e na gestão; regra do §4.5 parametrizada;
  remarcação de agendamento pago pelo site; "Devolução pedida/Devolvido" na conta do paciente.
- Do dono: decisão 3 (regra de cancelamento) e 4 (falta).
- Testes: pgTAP das contas de devolução (vetores compartilhados), duas devoluções iguais em paralelo → uma, e2e.
- Volta: os botões saem; a devolução automática da P2 continua.

**P4 — Cartão**
- O quê: página hospedada do Asaas; situação `processando`; contestações (`pagamentos.disputes`, tela na gestão);
  aviso da data de recebimento para a clínica.
- Do dono: decisão 7 (parcelamento), 12 (quem arca com contestação), 13 (antecipação); S1 respondida sobre
  contestação com divisão.
- Testes: e2e ida e volta da página hospedada (provedor falso), contestação simulada, conciliação D−32.
- Volta: `meios` da clínica volta a só `pix`.

**P5 — Mensalidade do Destaque** (independente da P3 e da P4: pode vir logo depois da P2, se o dono preferir)
- O quê: `plans`, `subscriptions`, `featured`; assinar e cancelar no painel; faixa "Destaques" com rótulo "Anúncio"
  na busca e nas páginas de cidade; rodízio; textos da coluna "P5" do §9.
- Do dono: decisão 14 (preço), 15 (quantos por busca), A5 respondida.
- Testes: pgTAP dos estados e da tolerância com relógio fixo; e2e (rótulo presente, ordem da lista igual com e sem
  destaque, exame no filtro); a11y.
- Volta: a faixa some com uma chave; as assinaturas ficam suspensas sem cobrar.

**P6 — Gestão, extratos e conciliação completos**
- O quê: telas do §7.3 inteiras; extrato com CSV; nota fiscal do IMED para a clínica (como o contador definir);
  alertas (rotina parada, diferença crítica, devolução travada); `billing_charges` somada na mesma visão.
- Do dono: C4 (nota por mês ou por exame).
- Testes: `gestao.test.mjs`, `e2e-gestao.mjs`, conciliação com diferenças plantadas.
- Volta: telas novas saem; os dados continuam.

**P7 — Validação**
- Todos os testes do §11 verdes; carga (300 pagamentos em paralelo no provedor falso); caos (queda no meio do aviso);
  pacote para o advogado (termos, privacidade, relatório de impacto, contrato da clínica); roteiro de operação
  (diferença crítica, contestação, Asaas fora do ar); 30 dias de piloto com a conciliação fechando; memória do projeto
  atualizada. Só então abrir para outras clínicas.

**Preparo fora da ordem:** teleconsulta paga e consultório virtual (§15) só depois da P7 e do que a teleconsulta já
exige (CREMESP, certificado).

---

## 11. Testes (no padrão do `banco.yml`)

| Tipo | Arquivo (proposto) | O que prova |
|---|---|---|
| pgTAP | `supabase/tests/500_pag_estrutura.sql` | Schema fechado; nenhuma permissão para `anon`/`authenticated`; funções "só servidor" recusam os outros papéis; restrições e nomes |
| pgTAP | `510_pag_taxa.sql` | Arredondamento (piso por exame), histórico da taxa sem sobreposição, foto na cobrança, taxa nova não mexe em cobrança antiga, preço mínimo |
| pgTAP | `520_pag_estados.sql` | Todas as transições do §4.1; proibidas recusadas; invariantes P-I1 a P-I6 |
| pgTAP | `530_pag_aviso.sql` | Aviso repetido → `repetido`; fora de ordem → situação final certa; valor divergente → não confirma; aviso de cobrança desconhecida |
| pgTAP | `540_pag_devolucao.sql` | Total, parcial, por exame; a conta fecha no centavo; nunca passa do pago; mesma chave → uma devolução |
| pgTAP | `550_pag_expirar.sql` | Relógio fixo: QR vence antes da reserva; carência; `processando` segura até o teto |
| pgTAP | `560_pag_conciliacao.sql` | Cada tipo de diferença com dados plantados |
| pgTAP | `570_destaque.sql` | Estados, tolerância, suspensão, volta ao pagar, rodízio |
| Script | `tests/banco/pagamento-aviso.mjs` | **O mesmo aviso 50 vezes em paralelo** → 1 aplicado, 49 repetidos, um só conjunto de linhas no extrato |
| Script | `tests/banco/pagamento-corrida.mjs` | **Pagamento aprovado × reserva expirando no mesmo instante**, 200 rodadas: o resultado é sempre "confirmado e pago" ou "expirado e devolução pedida"; nunca confirmado sem dinheiro nem dinheiro sem horário e sem devolução |
| Script | `tests/banco/pagamento-atrasado.mjs` | Pagamento depois de expirar × outro paciente marcando o mesmo horário: o segundo fica, o primeiro é devolvido |
| Script | `tests/banco/pagamento-estorno.mjs` | A mesma devolução pedida 20 vezes em paralelo → uma |
| Script | `tests/banco/pagamento-falha.mjs` | Conexão cortada no meio do aviso e da devolução (como `falha.mjs`): nada pela metade |
| Script | `tests/banco/pagamento-carga.mjs` | 300 pagamentos em paralelo, 80 conexões: sem impasse, p95 dentro do limite |
| Deno | `supabase/functions/pagamento-*/lib.test.ts` | Comparação do segredo em tempo constante; sem segredo, recusa; tradução das situações do provedor; **vetores de conta iguais aos do SQL** (`tests/pagamento-vetores.json`, um arquivo para os dois lados) |
| Node | `tests/pagamento-core.test.mjs` | Regras da tela (relógio, textos, estados) |
| e2e | `tests/e2e-pagamento.mjs` | Com o provedor falso: paga e confirma; deixa vencer; fecha e reabre; cancela e vê a devolução; clínica sem recebimento continua igual |
| e2e | `e2e-a11y`, `e2e-velocidade`, `e2e-clinica`, `e2e-agenda`, `e2e-gestao` | Estados novos |
| Catálogo | `tests/sem-dado-de-teste.test.mjs`, `tests/chaves.test.mjs` | Nenhuma chave, carteira ou valor de teste no site |
| Manual | roteiro do sandbox (P0 e antes de cada fase) | O Asaas de verdade se comporta como o provedor falso |

---

## 12. Riscos

| Risco | Efeito | O que o desenho faz |
|---|---|---|
| Art. 59 do Código de Ética Médica | A taxa por exame pode ser vista como remuneração por paciente recebido | P2 só depois da resposta A1; modelo aceita taxa fixa ou mensalidade |
| Contador dizer que, na variante A, o IMED fatura o valor inteiro | Imposto sobre 100% | Variante B pronta no modelo; ou outro meio de pagamento |
| IMED virar "subcredenciador" | Regulação do Banco Central | Sem custódia; pergunta A2 antes da P2 |
| Promessas públicas antigas ("gratuito", "nunca pede Pix", "ninguém paga para aparecer") | Perda de confiança; propaganda enganosa | Textos mudam no mesmo envio (§9), com teste |
| Golpe usando o nome do IMED para pedir Pix | Paciente lesado | Pagamento só dentro do site; nenhum link por mensagem; aviso novo em todas as telas |
| Devolução com a clínica sem saldo | O IMED paga a devolução inteira | S1; contrato com a clínica; alternativa: garantia (Conta Escrow) com subconta |
| Contestação no cartão | Prejuízo meses depois | Pix primeiro; cartão só à vista; provas guardadas; contrato |
| Robô segurando horários sem pagar | Agenda travada | Turnstile obrigatório, limites, castigo de 30 min |
| Dinheiro chega e o agendamento não confirma (ou o contrário) | Paciente pagou e não tem horário | Invariantes P-I1 e P-I2, rotina de minuto em minuto, conciliação diária, devolução automática |
| QR que não vence sozinho | Pagamento muito atrasado | A cobrança é apagada no Asaas; caso atrasado tratado |
| Asaas fora do ar ou fila de avisos pausada | Confirmação atrasa | Rotina consulta por conta própria; a reserva é solta se a cobrança não nasce |
| Período de avaliação do Asaas (limites de conta nova) | Trava o piloto | S2 na P0 |
| Cartão liquida em 32 dias | Clínica reclama do prazo | Avisado antes de ligar; antecipação é decisão 13 |
| Erro de centavo | Diferença acumulada | Inteiros, piso por exame, vetores iguais no SQL e no JS, conciliação |
| Vazamento da chave do Asaas | Movimentação indevida | Só nos segredos das funções; permissão mínima; teste de catálogo; troca de chave no roteiro de operação |
| Dado de saúde no meio de pagamento | Problema de LGPD | Descrição fixa, sem exame; pergunta A6 |
| Plano gratuito do Supabase (pausa, sem backup) com dinheiro passando | Parada no meio de um pagamento | Decisão 9 da agenda (Pro antes de operar) vira pré-requisito da P2b |
| Preço do app maior que o do balcão | "Gratuito para você" deixa de ser verdade | Cláusula de preço igual ou menor (decisão 8) |

---

## 13. Decisões que dependem do dono

Cada item traz a recomendação e o porquê. Sem resposta, vale a recomendação.

1. **Quem paga a tarifa do meio de pagamento.** Recomendo: o IMED, de dentro dos 15%. Porque a clínica recebe sempre
   85% exatos e a conta não depende de promoção de tarifa.
2. **Emissão da cobrança (variante A ou B).** Recomendo A (emitida pelo IMED, parte da clínica dividida na hora).
   Porque é o que o dono descreveu e não exige guardar segredo de clínica; depende da resposta C1.
3. **Cancelamento e devolução.** Recomendo: total até 24 h antes e sempre nos 7 primeiros dias; total também em cima da
   hora durante o piloto. Porque é simples de explicar e dá confiança; retenção só com dados do piloto e do advogado.
4. **Falta do paciente.** Recomendo: sem devolução automática; a clínica decide. Porque quem perdeu o horário foi ela.
5. **Prazo para pagar o Pix.** Recomendo: 8 minutos de QR dentro de 10 de reserva (+5 de carência). Porque é o que a
   agenda já usa e segura pouco o horário dos outros.
6. **A taxa aparece para o paciente?** Recomendo: não; o paciente vê só o preço do exame. Porque a taxa é da clínica
   com o IMED; mostrá-la sugere que o exame ficou mais caro.
7. **Parcelamento no cartão.** Recomendo: não na primeira versão. Porque aumenta tarifa, prazo e contestação.
8. **Preço no app e no balcão.** Recomendo: o preço do app não pode ser maior que o particular do balcão. Porque
   senão o paciente paga a taxa sem saber.
9. **Exame de convênio.** Recomendo: fora do pagamento online e fora dos 15%. Porque quem paga é o plano, e a taxa
   foi definida para "exame agendado e pago pelo aplicativo".
10. **15% fixo ou por tipo de exame.** Recomendo: 15% para todos no piloto. Porque uma regra só é fácil de conferir; o
    banco já aceita taxa por clínica (e depois por exame) sem mudança.
11. **Pagar no app é obrigatório na clínica que ligou?** Recomendo: sim, no horário direto particular; pedido sem
    horário e convênio continuam sem pagamento. Porque é o que sustenta a taxa e reduz a falta.
12. **Quem arca com a contestação do cartão.** Recomendo: a clínica fica com a parte dela quando o exame foi feito, e
    o IMED devolve a taxa. Porque cada um responde pelo que recebeu; precisa estar no contrato.
13. **Antecipação do cartão.** Recomendo: não oferecer agora; a clínica recebe em 32 dias. Porque antecipar custa e
    muda a conta da divisão.
14. **Preço do Destaque.** Recomendo: R$ 149,00/mês no lançamento (com data para acabar) e R$ 299,00 na tabela.
    Falta o dono confirmar e dizer por quanto tempo vale o preço de lançamento.
15. **Quantos destaques por busca.** Recomendo: até 3, em rodízio. Porque mais que isso vira parede de anúncio.
16. **Mensalidade e 15% juntos.** Recomendo: independentes: o Destaque é opcional e não muda a taxa. Porque desconto
    de taxa para quem anuncia complica a conta e a explicação.
17. **Nota fiscal.** Recomendo: a clínica emite a do exame para o paciente; o IMED emite a da taxa e a do Destaque
    para a clínica. Depende do contador (C1 a C5).
18. **Onde testar com o sandbox.** Recomendo: um segundo projeto gratuito do Supabase só para testes. Porque dinheiro
    de mentira não deve conviver com o banco de produção.
19. **Preço mínimo para pagar online.** Recomendo: R$ 20,00. Porque abaixo de R$ 13,27 a taxa não cobre a tarifa.
20. **CPF do pagador.** Recomendo: pedir só na hora de pagar e não guardar em texto. Porque é dado novo; pede-se o
    mínimo.
21. **Plano do Supabase.** Recomendo: Pro antes da P2b. Porque com dinheiro passando não pode haver pausa nem falta de
    backup (custo: decisão do dono).
22. **Quem da equipe pode devolver dinheiro e mudar a taxa.** Recomendo: só quem tiver `imed.financeiro.operar`, com
    motivo e registro; começar só com o dono.
23. **Trocar o percentual por outro formato** (valor fixo ou mensalidade), se o advogado apontar risco no art. 59.
    Recomendo: decidir só depois da resposta A1.

---

## 14. O que NÃO fazer na primeira versão

- **IMED receber tudo e transferir depois** (repasse manual, saldo de clínica em conta do IMED, "carteira" ou crédito
  do paciente): é guardar dinheiro de terceiros.
- **Guardar ou sequer ver dado de cartão;** salvar cartão para a próxima compra.
- **Boleto** (não serve para reserva de minutos) e **parcelamento.**
- **Link de pagamento por WhatsApp, SMS ou e-mail:** é o formato do golpe que o site ensina a recusar.
- **Cobrar convênio, coparticipação ou qualquer coisa do SUS.**
- **Multa automática por falta ou cancelamento.**
- **Cupom, desconto, cashback, preço que muda sozinho.**
- **Leilão de destaque, pagar por posição na lista, destaque sem rótulo.**
- **Taxa diferente por exame ou por horário;** desconto de taxa para quem anuncia.
- **Antecipação automática** do cartão.
- **Subcontas com marca própria (BaaS), garantia (escrow) e Pix Automático:** só se as respostas da P0 pedirem.
- **Dois meios de pagamento ao mesmo tempo.**
- **O IMED emitir nota em nome da clínica.**
- **Corrigir diferença de conciliação sozinho:** o sistema aponta, uma pessoa resolve.
- **Devolver para conta diferente da que pagou.**
- **Teleconsulta paga e consultório virtual:** só o preparo do §15.

---

## 15. Preparado para depois (sem detalhar)

- **Teleconsulta paga:** `charges.finalidade = 'teleconsulta'`, `fee_rules.finalidade = 'teleconsulta'`, a divisão vai
  para a carteira do médico (ou da empresa dele). O alerta do art. 59 é **mais forte** aqui (é honorário médico): por
  isso o segundo item existe.
- **Consultório virtual por mensalidade:** `plans.codigo = 'consultorio_virtual'` e `subscriptions` com `doctor_id` no
  lugar de `clinic_id`. Mesmos estados do Destaque (ativa, atrasada, suspensa).
- O que já fica pronto: a coluna de finalidade, a taxa por finalidade com histórico, o extrato único, a conciliação
  e a gestão, que somam tudo sem mudança.

---

## 16. O que não foi confirmado na pesquisa

A documentação do Asaas não abre nesta rede (`docs.asaas.com` precisa ser liberado nas configurações de rede da
sessão); trabalhei com os trechos devolvidos pela busca. Ficaram **sem confirmação**:

1. Se o QR de uma cobrança Pix **apagada** ainda pode ser pago, e se dá para fazer o QR vencer em minutos.
2. **Quando** a parte da clínica fica disponível na divisão (Pix e cartão).
3. **Contestação (chargeback) com divisão:** de qual conta sai e se a parte da clínica volta sozinha.
4. **Devolução com a carteira da clínica sem saldo.**
5. Devolução parcial no **cartão** (confirmada só para o Pix).
6. Se o **CPF** do pagador é obrigatório para criar a cobrança.
7. Quantas falhas pausam a fila de avisos; a garantia de entrega dos avisos.
8. A lista completa de situações da cobrança, inclusive análise de risco no cartão.
9. Pré-autorização na página hospedada (Checkout).
10. O que o Asaas faz sozinho com assinatura atrasada.
11. Lista exata de documentos e prazo de aprovação da conta do IMED; se a conta de destino precisa estar aprovada.
12. Se o período de avaliação limita divisão para contas comuns (não subcontas).
13. Como validar um `walletId` por API.
14. Que nome o paciente vê no Pix e na fatura do cartão.
15. Prazos de liquidação de cartão e débito: vieram de página oficial resumida e de páginas de parceiros.
16. Tarifa do cartão: a página de preços diz 2,99% + R$ 0,49, e outra página do Asaas anuncia 1,99% + R$ 0,49 nos 3
    primeiros meses; vale o que estiver na conta.
17. Que o Asaas é instituição de pagamento autorizada pelo Banco Central (não apareceu na busca).
18. Mercado Pago: se a divisão funciona com Pix; tarifas por prazo. Pagar.me: Pix na divisão, cadastro do recebedor e
    tarifas.
19. Textos legais: li o art. 59 citado em documento do CFM e o resumo do despacho de 2022; **não** li a redação atual
    do art. 72, o texto da Resolução CFM 2.336/2023 nem o das Resoluções BCB 150/2021 e 522/2025. Nada aqui é parecer.

---

## Fontes (consultadas em 11/11/2026, por busca; as páginas do Asaas não foram abertas por inteiro)

**Asaas, documentação**
- Divisão: <https://docs.asaas.com/docs/split-de-pagamentos> · <https://docs.asaas.com/docs/duvidas-frequentes-split> ·
  <https://docs.asaas.com/docs/split-em-cobrancas-avulsas> · <https://docs.asaas.com/docs/split-em-assinaturas> ·
  <https://docs.asaas.com/docs/checkout-com-split-de-pagamento> · <https://docs.asaas.com/reference/listar-splits-pagos>
- Subcontas e garantia: <https://docs.asaas.com/docs/criacao-de-subcontas> ·
  <https://docs.asaas.com/docs/duvidas-frequentes-subcontas> · <https://docs.asaas.com/docs/introducao-conta-escrow> ·
  <https://docs.asaas.com/docs/split-para-contas-com-conta-escrow>
- Pix: <https://docs.asaas.com/docs/cobrancas-via-pix> · <https://docs.asaas.com/reference/obter-qr-code-para-pagamentos-via-pix>
- Apagar cobrança: <https://docs.asaas.com/reference/excluir-cobranca>
- Cartão: <https://docs.asaas.com/docs/cobrancas-via-cartao-de-credito> ·
  <https://docs.asaas.com/reference/criar-cobranca-com-cartao-de-credito> ·
  <https://docs.asaas.com/reference/capturar-cobranca-com-pre-autorizacao> ·
  <https://docs.asaas.com/docs/duvidas-frequentes-cobrancas> · <https://docs.asaas.com/reference/tokenizacao-de-cartao-de-credito>
- Assinaturas: <https://docs.asaas.com/docs/assinaturas> · <https://docs.asaas.com/docs/criando-uma-assinatura> ·
  <https://docs.asaas.com/docs/faq-assinaturas>
- Avisos: <https://docs.asaas.com/docs/sobre-os-webhooks> · <https://docs.asaas.com/docs/criar-novo-webhook-pela-api> ·
  <https://docs.asaas.com/docs/webhook-para-cobrancas> · <https://docs.asaas.com/docs/tipos-de-envio> ·
  <https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook> ·
  <https://docs.asaas.com/docs/duvidas-frequentes-webhooks>
- Devolução: <https://docs.asaas.com/docs/estornos> · <https://docs.asaas.com/reference/estornar-cobranca> ·
  <https://docs.asaas.com/reference/estornar-parcelamento>
- Contestação: <https://docs.asaas.com/docs/chargeback> · <https://docs.asaas.com/reference/chargeback-1>
- Pagador: <https://docs.asaas.com/reference/criar-novo-cliente> · <https://docs.asaas.com/docs/duvidas-frequentes-notificacoes>
- Testes: <https://docs.asaas.com/docs/sandbox> · <https://docs.asaas.com/docs/duvidas-frequentes-sandbox> ·
  <https://docs.asaas.com/reference/confirmar-pagamento> · <https://docs.asaas.com/docs/testar-pagamento-de-qrcodes-pix>
- Chaves: <https://docs.asaas.com/docs/gerenciamento-de-permissões-de-chaves-de-api>
- Nota fiscal: <https://asaas.com/nota-fiscal> · <https://docs.asaas.com/docs/faq-de-notas-fiscais>

**Asaas, páginas comerciais**
- <https://www.asaas.com/precos-e-taxas> · <https://www.asaas.com/cobranca-cartao> · <https://blog.asaas.com/taxas-asaas/> ·
  <https://asaas.com/antecipacao-de-recebiveis> · <https://www.asaas.com/> · <https://blog.asaas.com/abrir-conta-pj> ·
  <https://blog.asaas.com/como-contestar-um-chargeback>
- Guia de terceiros sobre os avisos: <https://hookdeck.com/webhooks/platforms/guide-to-asaas-webhooks-features-and-best-practices>

**Alternativas**
- Mercado Pago: <https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/overview> ·
  <https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/prerequisites> ·
  <https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace> ·
  <https://www.mercadopago.com.br/ferramentas-para-vender/check-out>
- Pagar.me: <https://docs.pagar.me/reference/split-1>

**Regras**
- Código de Ética Médica (Resolução CFM 2.217/2018): <https://portal.cfm.org.br/images/PDF/cem2019.pdf> · alteração do
  art. 72: <https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2019/2226_2019.pdf> · despacho de 2022:
  <https://sistemas.cfm.org.br/normas/arquivos/despachos/BR/2022/60_2022.pdf>
- Publicidade médica (Resolução CFM 2.336/2023): <https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2023/2336_2023.pdf>
- Banco Central: <https://www.legisweb.com.br/legislacao/?id=486238> (Resolução BCB 522/2025) ·
  <https://legismap.com.br/leis-e-normas/resolucao-bcb-n-150-de-06-10-2021> ·
  <https://legale.com.br/blog/plataformas-separacao-valores-conformidade-riscos/>
- Consumidor: <https://idec.org.br/consultas/dicas-e-direitos/idec-destaca-direitos-do-consumidor-no-comercio-eletronico> ·
  <https://www.conjur.com.br/2015-fev-21/direito-arrependimento-nao-vale-toda-compra-internet/>
- Imposto sobre a intermediação: <https://www.prefeitura.sp.gov.br/cidade/upload/sc_01-2023_1676053011.pdf> ·
  <https://www.pwc.com.br/pt/thinking-about-taxes/tax-intelligence/2026/tax-intelligence-raciocinios-ed-07_marketplaces.pdf>

**Arquivos do projeto lidos (só leitura):** `CLAUDE.md`; `memory/projects/imed-agenda-arquitetura.md` (§0, §5, §6, §9,
§14 a §16) e `imed-workspace-arquitetura.md` (estrutura); migrações `20261030163758_gestao`,
`20261102200421`/`200607`/`200701`/`200810`/`200928_agenda_base_parte_1..5`, `20261103005641_agenda_motor_parte_1`,
`20261103053453`/`053814_agenda_operacao_parte_1..2`, `20261111120000_agenda_app`; `assets/js/local.js`,
`geo-core.js`, `conta.js`, `gestao.js`, `gestao-core.js`, `contato.js`, `confianca.js`; as páginas e os testes citados
no §9; `.github/workflows/banco.yml`; `supabase/tests/` e `tests/banco/` (lista).

---

## P1: como ficou (11/11/2026, só no ramo `ci/pagamento-p1`; nada aplicado na produção)

**O que existe.** 5 migrações provisórias `2026111318xxxx_pagamentos_base_parte_1..5` (volta única na parte 5), todas em
`PENDENTES_NA_PRODUCAO` do `banco.yml`, depois de todas as provisórias da agenda: (1) schema `pagamentos` fechado, 17
tabelas, guardas e referências; (2) contas, devolução pela regra e o que muda na agenda; (3) funções só do servidor;
(4) paciente, clínica, gestão e retenção; (5) a única com DROP (a restrição de `agenda.unit_settings.payment_mode`
trocada por outra mais larga). Testes: pgTAP `supabase/tests/500` a `570` (495) e `tests/banco/pagamento-aviso`,
`-corrida`, `-atrasado`, `-estorno` e `-falha.mjs`, com o provedor de mentira `tests/banco/asaas-falso.mjs`.
**Tudo desligado:** chave geral `false`, nenhuma conta, nenhum plano com preço; com isso `agenda_book`,
`agenda_public_info` e `agenda_my_booking` respondem exatamente como antes (testado).

**Escolhas onde o documento era ambíguo (sempre a mais conservadora):**

1. **Devolução "na mesma transação" por gatilho, não trocando o corpo das funções da agenda (§4.6).** Um gatilho nos itens
   do agendamento (`appointment_items_pag`) pede a devolução pela regra quando o exame é cancelado, vai para remarcação
   por bloqueio forçado ou vira falta. Vale para qualquer caminho (inclusive o SQL de emergência) e não mexe em
   `agenda_cancel`, `agenda_set_status` nem `agenda_block_force`. Mudaram de corpo só `private.agenda_expire`,
   `agenda_book`, `agenda_public_info` e `agenda_my_booking`.
2. **P-I1 virou guarda do banco.** Agendamento pago online só fica (ou volta a ficar) confirmado com uma cobrança aprovada
   do valor dele; sem isso a mudança é recusada (erros `IMP04` e `IMP03`), inclusive para `agenda_confirm` do servidor.
3. **`agenda_book` recusa quem pode pagar online (`payment_required`).** Não estava na tabela do §4.6, mas sem isso o
   pagamento era contornável chamando a função antiga (decisão 11: obrigatório). Exame "sob consulta" ou abaixo do
   mínimo continua confirmando de uma vez, com pagamento no local.
4. **Dinheiro em cobrança já expirada ou cancelada nunca reabre** (regra fixa do §4.1): volta inteiro, mesmo que a
   reserva ainda esteja na carência. O §4.4 ("confirma se o horário estiver livre") vale para a cobrança que ainda
   estava "aguardando" quando o dinheiro chegou. Rever com os itens 3 e 4 do §2.3 (QR apagado pode ser pago?).
5. **Pagamento atrasado, "motor completo":** horário ainda no futuro, regras, pausas, feriados e bloqueios de hoje, vaga
   livre, e o paciente (mesmo telefone, qualquer clínica) sem outro agendamento ativo no horário. A antecedência mínima
   não conta de novo (como no balcão). Reserva ainda não expirada pela agenda confirma direto.
6. **Valor pago diferente:** a cobrança é encerrada (`cancelada`), o que chegou é devolvido inteiro ("devolução
   integral", sem taxa nem repasse no extrato) e abre-se uma diferença crítica numa rodada `manual` da conciliação.
7. **Bloqueio forçado:** a devolução total é pedida na hora. "Desfeita só enquanto não foi enviada" na prática dura até a
   próxima passada da rotina (1 min); depois disso remarcar é recusado e a clínica cancela. Se o dono quiser uma espera
   antes de enviar, é parâmetro novo na P3.
8. **Devoluções:** uma por vez por cobrança; a divisão entre a taxa do IMED e a parte da clínica é calculada no envio,
   com o que já foi concluído (assim a soma fecha no centavo); valor escolhido sem exame é rateado pelos exames em
   ordem; a regra junta numa devolução só os exames cancelados na mesma transação. Além do §5.2: tabela `refund_items`,
   situação `desfeita` e colunas `integral`, `automatica` e `txid`. Exame que ainda vale não é devolvido inteiro sem
   cancelar antes (`cancel_first`).
9. **Permissões:** `financeiro.configurar` e `financeiro.estornar` só para o dono da clínica (nem gestor, nem
   financeiro); `imed.financeiro.operar` não foi dada a nenhum papel da equipe (só o dono do IMED; decisão 22).
10. **Ligar em passos separados:** a clínica informa a carteira (`em_conferencia`) → o IMED confere (`ativa`) → alguém
    liga o modo online da unidade (`pag_clinic_pause(clínica, false)`) → e ainda falta a chave geral. Só Pix em
    `pag_clinic_connect` (cartão é P4). A unidade só fica "online" com a conta ativa (guarda no banco).
11. **Contra abuso, no banco:** uma reserva aguardando pagamento por telefone, 3 cobranças por agendamento e 30 min de
    espera depois de 3 reservas vencidas seguidas. Por aparelho e por IP fica na Edge Function (P2), com o Turnstile.
12. **Cobrança que não nasce:** `pag_charge_abort` solta a reserva como "sistema" (transição nova `hold → cancelled`
    do sistema, a 60ª); `agenda_release` e `agenda_reschedule` não mudaram (a remarcação já não troca de exame).
13. **Avisos:** o mesmo id de aviso soma em `repeticoes` e responde `repetido`; o resultado `repetido` gravado quer dizer
    "a situação consultada já estava aplicada". Aviso gravado e não aplicado volta para a rotina (`reaplicar`).
14. **Parâmetros e tarifas:** `pagamentos.settings` tem a coluna `a_confirmar`; as tarifas (Pix R$ 1,99; cartão 2,99% +
    R$ 0,49; 32 dias) entram só como parâmetro **a confirmar**, usadas para a conciliação apontar tarifa diferente e
    para recusar cobrança em que a taxa não cobre a tarifa (`fee_below_tariff`). Função a mais:
    `admin_pag_parametro_definir`. Colunas a mais em `charges`: `pago_cents`, `fee_rule_id`,
    `apagada_no_provedor_em`, `consultada_em`.
15. **Cartão em análise:** segura a reserva até 30 min depois do prazo dela (`teto_processando_min`).
16. **Extrato e trilha sem chave estrangeira e sem saída de emergência** (nem o SQL altera); cobrança, devolução,
    conta e regra de taxa só se apagam pela emergência do SQL, registrada. A volta recusa se houver cobrança paga.
17. **Provedor de mentira:** onde a pesquisa não confirmou, ele faz o mais chato para nós (QR apagado ainda pode ser
    pago; avisos repetidos e fora de ordem; apagar cobrança paga é recusado). A chave de idempotência da devolução no
    cabeçalho é uma suposição: conferir no sandbox (P0).

**Furo que os testes acharam e já foi fechado:** impasse (40P01) entre a confirmação pelo pagamento e outro paciente
reservando o mesmo horário logo depois do prazo da reserva. A confirmação agora pega as travas dos recursos antes de
mexer na ocupação (ordem: configuração → pedido → cobrança → recursos). `agenda_confirm` (da integração, 3.3) mexe na
ocupação sem essa trava; só não cai no mesmo caso porque recusa depois do prazo (fica uma janela de instantes).

**Furos que ficam para as próximas fases:**
- **Retenção × pagamento:** a agenda apaga os dados do paciente da reserva expirada depois de 7 dias (3.4), inclusive o
  código do pedido. Se houver devolução em andamento, o paciente deixa de conseguir consultá-la pelo código. A P1 só
  impede que pagamento muito atrasado confirme uma reserva já sem dados (devolve). Decidir na P3 se a retenção espera a
  devolução concluir.
- **Agendamento pago que ficou "para remarcar" por bloqueio forçado** e já teve a devolução enviada não pode mais ser
  remarcado (o banco recusa): a clínica precisa cancelar. Falta a tela e a resposta amigável (P3).
- **Limite por telefone** é fácil de driblar trocando o número; o limite de verdade (aparelho, IP, Turnstile) é da P2.
- **O histórico da agenda** grava "paciente" na passagem reserva → aguardando pagamento, embora quem chame seja o
  servidor (é a transição que a máquina de estados já tinha).

**Fora da P1 (e por quê):** Edge Functions, `provedor.ts`, o job da rotina e o Turnstile (P2: falam com a internet e
precisam da conta); arquivo comum de vetores para o Deno (P2; por ora as contas são conferidas em JavaScript contra o
SQL em `pagamento-estorno.mjs`); telas, textos do §9 e e2e (P2 em diante); `pagamento-carga.mjs` (P7); rodízio e faixa
"Destaques", assinar e cancelar pelo painel (P5; aqui só os estados da mensalidade e `featured`); contestação além do
registro (P4); `get_advisors` (só faz sentido depois de aplicar).

---

## P2a: como ficou (11 e 12/11/2026, só no ramo `ci/pagamento-p2a`, por cima da P1; nada aplicado nem publicado)

**Em uma frase:** tudo o que o Pix precisa do nosso lado está escrito e testado com o provedor de mentira (funções do
servidor, rotina no banco, telas do paciente e o roteiro das 12 conferências), **desligado** e **sem nunca ter falado
com o Asaas de verdade**: não existe conta nem chave.

**O que existe**

- **Funções do servidor (só a fonte; não publicadas):** `supabase/functions/pagamento-criar/`, `pagamento-webhook/` e
  `pagamento-rotina/` (cada uma com `index.ts`, `lib.ts` e `lib.test.ts`) e as peças comuns em
  `supabase/functions/_shared/`: `provedor.ts` (a camada fina: criar cobrança Pix com divisão, consultar, apagar,
  devolver, listar, achar pela referência, ler o aviso), `asaas.ts` (o **único** arquivo que conhece o Asaas, com cada
  suposição marcada "A CONFERIR (§2.3, item N)"), `base.ts` (banco, origem, limites, CPF, HMAC, tempo constante) e
  `chaves.ts` (o mesmo bloco das chaves do Supabase das outras funções). Os `lib.ts` não usam nada do Deno: recebem o
  banco, o provedor e o ambiente por parâmetro.
- **Banco:** migração provisória `20261113190000_pagamentos_rotina` (só aditiva, com volta e em
  `PENDENTES_NA_PRODUCAO`): token interno `pagamentos`, `private.pag_tem_trabalho`, `private.pag_rotina_chamar` (chama
  `<endereço das funções>/pagamento-rotina` pelo pg_net, com o endereço de `private.app_settings`), os jobs
  `imed-pagamentos-rotina` (a cada minuto) e `imed-pagamentos-conciliacao` (04:17 em São Paulo) e
  `public.pag_charge_lookup` (só o servidor; o "já paguei"). pgTAP `580_pag_rotina.sql`; guardas do `000_catalogo`.
- **Telas do paciente:** `assets/js/pagamento.js` (a tela) e `assets/js/pagamento-core.js` (as regras, sem navegador),
  `assets/css/pagamento.css`; ligação em `local.js` (o botão vira "Ir para o pagamento", com o valor, as regras e o prazo
  que o banco informa e o CPF de quem paga), `conta.js` (situação, "Continuar o pagamento", comprovante) e `inicio.js`
  ("Aguardando pagamento" e o link para continuar). Situações: aguardando (QR, copia e cola, relógio), conferindo,
  pago (comprovante), vencido, cancelado, pagamento atrasado (devolução), devolvido e meio de pagamento fora do ar.
- **Roteiro do Asaas:** `scripts/asaas-sandbox.mjs` e `.github/workflows/asaas-sandbox.yml` (só à mão, chave de testes
  no segredo `ASAAS_SANDBOX_KEY`, fora do `banco.yml` e do `testes.yml`). **Ainda não foi rodado.**
- **Testes:** `lib.test.ts` de cada função e de `_shared`; `tests/banco/pagamento-ponta-a-ponta.mjs` (o código de
  verdade das funções com o banco de verdade e o provedor de mentira: pago, vencido, aviso repetido, 20 ao mesmo tempo
  e fora de ordem, provedor fora do ar, "já paguei", devoluções automáticas, token interno, conciliação);
  `tests/pagamento-core.test.mjs`; `tests/e2e-pagamento.mjs` (com o cenário "com tudo desligado nada muda");
  as telas novas no `e2e-a11y`; `tests/asaas-sandbox.test.mjs` (o roteiro contra o provedor de mentira);
  `tests/chaves.test.mjs` reprova chave com cara de Asaas e segredo do pagamento escrito no repositório.

**Como está desligado (quatro travas, uma atrás da outra):** (1) as funções não estão publicadas; (2) publicadas, sem
os segredos recusam tudo: `pagamento-criar` sem o segredo do Turnstile (503), o aviso sem o segredo do webhook (503),
a rotina sem o token interno (403); (3) com os segredos, o banco recusa enquanto `vendas_online_ligadas = false`;
(4) com a chave geral ligada, só a clínica com conta ativa e a unidade no modo online. No site, os arquivos do
pagamento só são baixados quando `agenda_public_info` responde `payment: "online"` (ou o aparelho guarda um
agendamento pago pelo site): hoje, nunca.

**Escolhas onde o desenho era ambíguo (sempre a mais conservadora)**

1. **Nenhum endereço do Asaas no repositório.** A pesquisa registrou os caminhos (`/v3/...`), não o endereço da API:
   ele vem do segredo `ASAAS_API_URL` (e, no roteiro, de quem roda). Sem chave ou sem endereço, o provedor não existe.
2. **O servidor não faz conta de dinheiro.** O §11 pedia um arquivo de vetores igual para o SQL e o JavaScript; como as
   funções só repassam os centavos que o banco calculou, o arquivo comum (`tests/pagamento-vetores.json`) ficou só com
   os casos de CPF (site e servidor conferem igual). Nenhum valor sai do navegador (testado).
3. **Aviso (webhook):** sem segredo configurado, 503 para tudo; segredo errado, 401; **200 assim que o aviso está
   gravado**, mesmo que consultar ou aplicar falhe (a rotina reaplica); 500 só quando nem gravar deu; aviso de outro
   assunto, de cobrança que não é nossa ou em formato que o banco não guarda: 200 (a fila do provedor não para).
4. **A rotina só é chamada quando há trabalho** (`pag_tem_trabalho`, um pouco mais larga que `pag_due`); a
   **conciliação só roda na chamada da madrugada** (`{"conciliar": true}`), embora `pag_due` a liste sempre.
5. **Devolução sem depender de idempotência do provedor:** recusa (4xx) → "falhou" com o código; sem resposta (rede,
   tempo, 5xx) → continua "enviada" e, depois de 5 min, a rotina **consulta antes de reenviar**; se o dinheiro já
   voltou, só conclui. (O cabeçalho com a chave continua indo, como suposição.)
6. **"Já paguei"** é a ação `conferir` de `pagamento-criar`: acha a cobrança pelo código do agendamento
   (`pag_charge_lookup`), consulta o provedor e aplica a situação consultada. Não confirma nada sozinha e não gasta o
   Turnstile.
7. **Criação que cai no meio:** com a mesma chave, procura a cobrança no provedor pela referência antes de criar outra;
   se o provedor não responde, solta a reserva na hora e tenta apagar a cobrança que possa ter nascido (até 8 s).
8. **CPF:** pedido no formulário, só para o pagamento; o pagador é o nome de "Seu nome completo"; o banco guarda só o
   HMAC; o aparelho não guarda (nem no rascunho). O texto ao lado do campo diz para onde o CPF vai.
9. **QR desenhado no navegador** a partir do "copia e cola" (com a biblioteca que o site já tinha), sempre preto no
   branco; a imagem do provedor não é usada nem guardada.
10. **Turnstile:** obrigatório no servidor. No site o ponto está pronto (`desafio()` em `pagamento.js`), mas sem a
    chave do site (`turnstileSiteKey` no `config.js`) e sem o endereço dele na CSP nada é carregado: o código do
    desafio vai vazio e o servidor recusa.
11. **Aparelho:** o agendamento pago fica como `aguardando_pagamento` (nunca "confirmado" antes de o banco dizer), com
    a marca `pay`; a intenção ganha a chave da cobrança (`charge`). Página fechada e reaberta: retoma pela intenção.
12. **"Com tudo desligado nada muda" levado ao pé da letra:** a consulta da conta não ganhou o modo de pagamento (o
    teste antigo fixa a lista de colunas). Por isso o pedido que veio **só da conta** (feito em outro aparelho) mostra
    o pagamento só enquanto espera; o comprovante fica no aparelho em que foi feito.
13. **Textos:** o aviso novo contra golpe (§9) aparece só nas telas do pagamento, no lugar do "gratuito / nunca pede
    Pix". Os textos do site (§9) **não** mudaram. A regra de devolução "em uma frase" **não** aparece antes de pagar,
    nem prazo de devolução: o banco não informa isso ao site. A taxa não aparece para o paciente (decisão 6).
14. **Arquivos fora do `CORE` do `sw.js`** (só baixam quando a tela existe) e `VERSION` igual (`imed-v32`).
15. **`pagamento-clinica`** (§6.1) não foi escrita: é da P2b (aba Financeiro). A entrada antiga `pagamentos-webhook`
    do `config.toml` deu lugar às três funções reais.

**Achado no caminho (corrigido):** os botões de zoom do mapa da página do local ficavam com 30 px no celular (o estilo
do Leaflet chega depois e ganhava da regra de 44 px); `local.css` agora garante os 44 px.

**O que ficou de fora (e por quê)**

- **Publicar e aplicar:** nada foi para a produção (depende do dono: P0, e da autorização de sempre).
- **Deno e Edge Runtime:** os `index.ts` (a casca) não foram executados: aqui não há Deno. Os `lib.ts` rodam no Node
  (tipos conferidos com o TypeScript, modo estrito, fora do repositório). A primeira execução de verdade é no projeto
  de testes do Supabase (decisão 18).
- **Ponta a ponta com o sandbox** e a conferência de 7 dias da conciliação: precisam da conta.
- **P2b:** textos do §9, termos e privacidade, aba Financeiro, gestão, `pagamento-clinica`.
- **Prévia do valor a devolver antes de cancelar** e **comprovante do pedido feito em outro aparelho**: precisam de
  leitura nova no banco (P2b/P3). **Imprimir ou baixar o comprovante**, **aviso por e-mail/WhatsApp** de pagamento:
  não pedidos nesta fase.
- **`pagamento-carga.mjs`** (300 pagamentos em paralelo): P7.

**Furos novos (para as próximas fases)**

- **Quem paga pode não ser quem preenche:** o pagador é sempre o nome de "Seu nome completo". Se o Pix sair da conta de
  outra pessoa, o nome no provedor não bate (ver item 7 do §2.3 e a pergunta A6).
- **Situação que o adaptador não conhece** vira erro de propósito: o aviso fica pendente e a conciliação daquele dia
  falha inteira até o adaptador aprender a situação (a lista completa é o item 5 do §2.3).
- **Cobrança órfã no provedor** se a criação estourar o tempo e o filtro por referência não existir (suposição): não é
  paga (o QR nunca chegou ao paciente), mas a conciliação precisa apontar.
- **Limites por IP** ficam na memória de cada instância e o IP vem de um cabeçalho que pode ser forjado: o limite de
  verdade continua sendo o do banco (telefone, tentativas) e o Turnstile.
- **A tela consulta o banco a cada 3 a 5 s** enquanto espera o pagamento: medir na P7 (o aviso em tempo real é a saída).
- **Relógio do aparelho errado:** o relógio do QR usa a hora do servidor só na criação; ao retomar, a do aparelho (a
  situação mostrada é sempre a do banco).
- **Provedor fora do ar por muito tempo:** cobrança cancelada que não dá para apagar lá mantém a rotina chamando a cada
  minuto (é trabalho de verdade, mas sem teto nem alerta: P6).
- **Tempo da rotina:** o banco espera a função por 55 s e ela trabalha até 45 s por chamada; com muito trabalho, o resto
  fica para o minuto seguinte (sem alerta de atraso: P6).
- Continuam os da P1 (retenção de 7 dias × devolução em andamento; remarcação depois da devolução enviada).

**O que falta ajustar quando a conta do Asaas existir (nesta ordem)**

1. Abrir a conta de **testes** e uma **segunda** conta de testes (a "clínica"); gravar a chave de testes no segredo
   `ASAAS_SANDBOX_KEY` do GitHub.
2. Rodar Actions → "Asaas: conferência no ambiente de testes", informando o endereço da API de testes, a carteira da
   segunda conta e, se der, o caminho do endpoint de testes que confirma um pagamento.
3. Para cada item "diferente do desenho", ajustar **só** `supabase/functions/_shared/asaas.ts` (e o provedor de
   mentira, `tests/banco/asaas-falso.mjs`, para os dois contarem a mesma história). O que pode mudar: o campo do
   vencimento (`dueDate`), o CPF (`cpfCnpj`) e se é obrigatório, o formato de `splitRefunds` e o id do estorno na
   resposta, se `netValue` desconta a divisão (muda a conta da tarifa), a lista de situações, o filtro por referência
   e a listagem por dia (com páginas), o cabeçalho de idempotência, e o que acontece ao apagar e ao pagar um QR apagado.
4. Fazer à mão os itens que o roteiro não alcança: 2 (quando a parte da clínica cai), 4 (pagar e apagar ao mesmo
   tempo), 5 (avisos repetidos, fora de ordem e a fila pausada), 7 (o nome que o pagador vê) e os "ainda assim" dos
   itens 1, 6, 8 e 12 (extratos das duas contas, carteira sem saldo, e-mail ao pagador, extrato por API).
5. No projeto de testes do Supabase: aplicar as migrações, publicar as três funções (`--no-verify-jwt`) com os segredos
   de **teste** (`ASAAS_API_KEY`, `ASAAS_API_URL`, `ASAAS_WEBHOOK_TOKEN`, `PAG_CPF_HMAC_KEY`, `TURNSTILE_SECRET_KEY`),
   cadastrar o aviso no Asaas (envio sequencial, com o mesmo segredo), gravar o endereço das funções em
   `private.app_settings` e rodar o Pix de ponta a ponta.
6. Turnstile: criar a chave do site e o segredo; `turnstileSiteKey` no `config.js`; liberar o endereço do Turnstile na
   CSP do `local.html` (`script-src` e `frame-src`).
7. Conferir as tarifas da conta e tirar o "a confirmar" dos parâmetros (`admin_pag_parametro_definir`).
8. Atualizar este documento (§2.1 e §16) com o que foi confirmado. Só então a P2b.

**Vários exames (5.2) + pagamento (13/11/2026, ao juntar a 5.2 publicada).** O pagamento de um pacote (2 a 4 exames
marcados juntos) ainda **não existe** na tela: a P2a paga um agendamento de um exame. Para não oferecer o que o banco
recusa (`agenda_book` → `payment_required` quando todos os exames têm preço e o total passa do mínimo), a entrada
"Marcar mais de um exame no mesmo dia" **não aparece** na clínica que recebe pelo site (`payment` "online" em
`agenda_public_info`; `local.js`, `slotsHTML`). Nas demais, a 5.2 funciona igual. No banco da P1 a reserva paga
(`agenda_pay_hold`) recebe a mesma lista de 1 a 4 exames da marcação e a taxa é por exame (§ da taxa); o caminho do
pacote pago não foi testado de ponta a ponta e falta a tela (resumo com os exames, um Pix só): **fica para a P3**.
Coberto por `tests/e2e-pagamento.mjs` (cenário "vários exames (5.2) e pagamento").

---

## P2b: como ficou (13/11/2026, só no ramo `ci/pagamento-p2b`, por cima da P2a; nada aplicado nem publicado)

**Em uma frase:** as telas de quem recebe e de quem confere estão prontas e testadas com dados simulados (a clínica vê a
situação do recebimento e o extrato; a equipe vê as cobranças, a conciliação e a chave geral), a função que grava a
conta da clínica está escrita, e os textos que mudam estão num rascunho para o advogado. **Continua tudo desligado:**
hoje nenhuma clínica tem recebimento on-line, as migrações do pagamento não foram aplicadas e nenhum texto do site
público mudou.

**O que existe**

- **Painel da clínica, aba "Financeiro"** (`assets/js/financeiro.js`, a tela, baixada só quando a aba é aberta, e
  `assets/js/financeiro-core.js`, as regras; estilo no fim do `assets/css/clinica.css`). Aparece para quem tem
  `financeiro.ver` (dono, gestor e o papel Financeiro, que agora tem uma aba em vez de "não há nada para o seu papel")
  e para a equipe do IMED. Só lê, por `pag_clinic_status` e `pag_clinic_statement` (P1):
  - a **situação** em 4 estados: *ainda não disponível* (sem conta, ou banco sem o pagamento: a mesma mensagem honesta
    e mais nada na tela), *em análise*, *desligado* (conta conferida com alguma trava fechada, ou suspensa) e *ligado*;
  - **o que falta para ligar**: os 4 passos (conta informada → conferida pelo IMED → unidade no modo on-line → chave
    geral), cada um feito ou não, pelo que o banco respondeu;
  - a taxa, o meio e o preço mínimo **que o banco informar** (nenhum número no código da tela);
  - o **extrato**: um exame pago por linha (dia do pagamento, exame e hora dele no fuso da clínica, valor, taxa do
    IMED, parte da clínica, situação: pago, devolvido, devolvido em parte, contestado) e os **totais somados pelo banco**;
    período pronto (este mês, mês passado, 30 e 90 dias) ou datas à mão, até 93 dias. **Nenhum nome de paciente**: a
    função não manda e a tela descarta qualquer campo fora da lista.
- **Gestão, parte "Pagamentos on-line"** (`assets/js/gestao-pagamentos.js` e `assets/js/gestao-pag-core.js`; estilo no
  `assets/css/gestao.css`), no trilho lateral entre "Faturamento e cobrança" e "Agenda das clínicas", pelas funções
  `admin_pag_resumo`, `admin_pag_lista` e `admin_pag_conciliacao`: a **chave geral** (estado, e ligar/desligar com
  confirmação e motivo em código), os números do período da página (pago pelos pacientes, taxas, parte das clínicas,
  tarifas, devolvido, cobranças), o **"precisa de atenção"** (diferença crítica, devolução com falha, contestação, aviso
  por aplicar), as **cobranças** (com filtro por situação) e a **conciliação** (última conferência, diferenças com os
  dois lados em texto, últimas rodadas). Banco sem as funções (a produção de hoje): "ainda não estão ligados no banco".
  A frase do alto de "Faturamento e cobrança" ("o IMED ainda não recebe pagamentos pelo site") troca sozinha quando a
  chave geral liga, e volta quando desliga (§9).
- **Função do servidor `supabase/functions/pagamento-clinica/`** (`index.ts`, `lib.ts`, `lib.test.ts`; **só a fonte**):
  ações `conferir` (confere a carteira no provedor; não grava) e `ligar` (confere e grava a carteira e o aceite dos
  termos por `pag_clinic_connect`: a conta fica "em conferência"). Peças novas em `_shared/`: `conferirCarteira` na
  interface do provedor e no adaptador do Asaas, e `criarRpcComo` (o banco chamado **com o token de quem chamou**).
- **Rascunho dos textos:** `memory/projects/imed-pagamento-textos-rascunho.md` (hoje → como fica, o que só muda no
  Destaque, esboço das seções novas dos Termos e da Privacidade, os pontos do termo de adesão da clínica e as dúvidas
  para o advogado).
- **Testes:** `tests/financeiro-core.test.mjs` e `tests/gestao-pagamentos.test.mjs` (regras e catálogo: funções
  chamadas, nada no aparelho, nenhum dado de paciente, ícones do recorte, nomes para todos os códigos do banco);
  `tests/e2e-financeiro.mjs` e `tests/e2e-gestao-pagamentos.mjs` (todos os estados, teclado, 360 px, tema escuro e
  axe); `lib.test.ts` da função; `tests/banco/pagamento-clinica.mjs` (a função de verdade + o adaptador de verdade no
  banco de verdade, com o provedor de mentira) e `tests/banco/pagamento-telas.mjs` (o que as funções `pag_clinic_*` e
  `admin_pag_*` respondem de verdade passa pelas regras das duas telas: prova que o contrato da tela com o banco é o
  mesmo dos e2e). `FOTOS=pasta` nos dois e2e grava as fotos em 2x. O `banco.yml` passou a rodar também quando as
  regras das telas mudam (`financeiro-core.js`, `gestao-pag-core.js` e as que elas importam).

**Não precisou de migração.** Tudo o que as telas leem já estava nas funções da P1.

**Escolhas onde o desenho era ambíguo (sempre a mais conservadora)**

1. **A aba Financeiro só lê.** O §7.2 lista "ligar o recebimento" (colar a carteira e aceitar os termos), mas o termo de
   adesão da clínica ainda não existe (pergunta A7) e a função não está publicada: um formulário agora faria o dono
   "aceitar" um texto que não foi escrito. A função já está pronta; a tela de ligar entra junto com o termo. Também
   ficaram de fora "devolver", "pausar", o CSV e o Destaque (P3, P5 e P6).
2. **"Não disponível" é uma tela só**, para a clínica sem conta e para o banco sem o pagamento, e sem nenhum número
   (nem a taxa padrão, que o banco já informa): quem não tem o recebimento não vê condição comercial nenhuma. Sem conta,
   o extrato **nem é pedido** (não gera registro de leitura à toa).
3. **"Ligado" exige as três travas conferidas de novo na tela**, mesmo que o banco responda `recebendo`; na dúvida,
   "desligado". Conta suspensa aparece como "desligado", com o motivo que a clínica precisa saber.
4. **Os totais são os do banco.** A tela não soma linhas nem calcula "líquido": mostra o que `pag_clinic_statement`
   somou e, quando houve devolução, quanto voltou de cada parte. Número que o banco não mandou vira "—", nunca zero.
5. **Gestão: o período é o da página** (7, 30, 90 dias e 12 meses), em dias de São Paulo, e a lista pede as 100
   cobranças mais novas (a função aceita 500). O id do agendamento que `admin_pag_lista` devolve é descartado antes da
   tela.
6. **Chave geral na tela, com duas confirmações diferentes.** A função da P1 já existia (`admin_pag_chave_geral`), então
   a tela liga e desliga, sempre num quadro com o que vai acontecer e um **motivo em código** escolhido numa lista (o
   banco exige código; fica na trilha). Para **ligar** há ainda a caixa "Entendi". Quem não tem
   `imed.financeiro.operar` recebe a recusa do banco em palavras. Desligar é o botão de emergência (§10, "volta").
7. **Conciliação só de leitura.** Fechar uma diferença (`admin_pag_diferenca_resolver`) continua pelo banco: a tela
   completa é da P6. Idem conferir a conta de uma clínica (`admin_pag_conta_conferir`), definir taxa e parâmetros.
8. **`pagamento-clinica` nunca usa a chave secreta do projeto.** Ela fala com o banco com o token de quem chamou
   (chave publishable + `Authorization` da pessoa): quem decide se a pessoa pode é o banco (`financeiro.configurar`, só
   o dono). A permissão é perguntada **antes** de consultar o provedor (quem não é dono não usa a função para sondar
   carteiras) e a equipe do IMED **não** informa carteira em nome da clínica.
9. **Fechada por padrão, com uma trava a mais:** sem o provedor configurado recusa tudo (503) antes do banco; e `ligar`
   exige a versão do termo da clínica em vigor numa variável da função (`PAG_TERMOS_CLINICA`, que não é segredo). Sem
   ela, ou com a versão que a pessoa aceitou diferente da de hoje, nada é gravado. Enquanto o advogado não devolver o
   termo, nenhuma clínica liga.
10. **"Conferir a carteira" sem mover dinheiro.** A pesquisa não achou como validar a carteira de outra conta antes da
    primeira cobrança (pergunta S3). O adaptador só afirma o que dá para afirmar: a carteira **é a do próprio IMED**
    (recusada) ou **não dá para saber** (segue para a conferência da equipe). Ele nunca responde "conferida" nem "não
    existe"; a função já trata os dois para quando o Asaas souber responder. A listagem das carteiras da própria conta
    (`GET /v3/wallets/`) é **suposição, a conferir no ambiente de testes**; se não existir, a função não trava.
    Nenhuma cobrança de teste é criada pela função: a conferência "com um pagamento de valor baixo" (§7.2) continua
    sendo um pagamento de verdade feito pela equipe pelo fluxo normal.
11. **A função ativa nada.** `ligar` deixa a conta "em conferência"; ativar, pôr a unidade no modo on-line e a chave
    geral continuam sendo três passos de outras pessoas. Trocar a carteira de uma conta ativa volta para a conferência
    e a unidade volta ao pagamento no local (é o que o banco já fazia; agora testado pela função).
12. **Arquivos fora do `CORE` do `sw.js`** e `VERSION` igual: os quatro arquivos novos de tela só baixam quando a tela
    existe (como `agenda.js`, `gestao-central.js` e `pagamento.js`); o estilo foi para arquivos que já estão no site.
13. **Textos:** nenhum texto público mudou. O que as telas novas dizem é só para clínica e equipe, e não promete
    prazo de repasse nem regra de devolução (o banco não informa; decisões 3 e 4 e itens do §2.3 em aberto).

**O que ficou de fora (e por quê)**

- **Publicar e aplicar:** nada foi para a produção nem para a `main`.
- **Tela de "ligar o recebimento" na aba Financeiro**, devolver pelo painel, pausar, CSV do extrato: dependem do termo
  da clínica (A7) e das fases P3 e P6. Na função `pagamento-clinica`, assinar e cancelar o Destaque (§6.1): P5.
- **Na gestão:** fechar diferença, conferir conta de clínica, taxa por clínica, parâmetros e tarifas, mensalidades do
  Destaque, lista das clínicas com conta (o resumo só traz a contagem por situação): P6 (a lista de contas pede uma
  leitura nova no banco).
- **Trocar os textos do site** (§9): só com o advogado e no mesmo envio que ligar a primeira clínica.
- **Item novo no roteiro do ambiente de testes** para a pergunta S3 (a listagem de carteiras e se há como validar a
  carteira de outra conta): o roteiro continua com os 12 itens do §2.3; acrescentar quando a conta existir.
- **Deno e Edge Runtime:** como na P2a, o `index.ts` (a casca) não foi executado; o `lib.ts` roda no Node e os tipos
  foram conferidos com o TypeScript em modo estrito, fora do repositório.

**Furos novos (para as próximas fases)**

- **A carteira errada só aparece no primeiro pagamento.** Sem validação no provedor, uma carteira com um caractere
  trocado passa pela função e pela conferência "de olho"; quem pega é o pagamento de valor baixo da equipe (a divisão é
  recusada ou vai para outra conta). Enquanto a S3 não for respondida, esse pagamento de teste é **obrigatório** antes
  de ativar a conta, e o termo da clínica precisa dizer de quem é o risco.
- **Aceite sem o texto guardado.** O banco grava a versão do termo, quem aceitou e quando, mas não o texto aceito: o
  texto de cada versão precisa ficar guardado em algum lugar que não mude (página versionada ou PDF), ou o aceite não
  prova nada (pergunta A7).
- **Limites da função por instância** (pessoa e IP na memória), como nas outras: o limite de verdade é a permissão do
  banco. Uma dona de clínica mal-intencionada pode testar muitas carteiras devagar; hoje isso só diria "é a do IMED".
- **O extrato mostra o dia do pagamento, não o da devolução.** A linha devolvida continua no dia em que foi paga, com
  "Devolvido: R$ X"; quem fecha o mês precisa saber que uma devolução de hoje muda o total de um mês passado. A data
  da devolução por linha pede uma leitura nova (P3/P6).
- **A gestão não avisa sozinha.** A diferença crítica só aparece quando alguém abre o painel (ou toca em "Atualizar
  números"): não há alerta nem atualização automática dessa parte (P6).
- **Ligar a chave geral pela tela é um clique com confirmação.** Está restrito a `imed.financeiro.operar` (hoje só o
  dono) e as outras três travas continuam; quando outras pessoas da equipe abrirem o painel (decisão 4.4-a da agenda),
  rever se a chave geral pede uma segunda pessoa.
- **Papel Financeiro e a aba Agenda:** o Financeiro não vê a Agenda (sem nome de paciente), então a frase "quem tem
  acesso à agenda abre o agendamento" manda procurar outra pessoa da clínica; não há ligação entre a linha do extrato e
  o agendamento para quem pode ver os dois (P3).
- Continuam os da P1 e da P2a.
