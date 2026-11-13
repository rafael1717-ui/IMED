# Feriados nacionais na agenda (iMed Agenda)

> Preparado em 11/11/2026, no ramo `ci/feriados-nacionais`, e juntado no mesmo dia à versão de teste da agenda
> (`ci/agenda-5-1`, com a 4.3, a 4.4 e a 5.1 depois da revisão). **Nada foi aplicado na produção.**
> **Aplicada na produção em 13/11/2026** (13 lançados, 0 clínicas, 0 conflitos). Migração `supabase/migrations/20261113121400_feriados_nacionais.sql`, volta
> `supabase/volta/20261113121400_feriados_nacionais.sql`, teste `supabase/tests/420_feriados_nacionais.sql`.

## Por que existe

O motor de horários só oferece horário até o **fim do ano do último feriado nacional lançado**
(`private.agenda_national_until()`; arquitetura §4: nunca vender num dia que pode ser feriado e ainda não foi lançado).
Em 11/11/2026 a produção não tinha nenhum feriado nacional lançado: nenhuma clínica oferecia horário, nem a do
"Horário direto" (5.1). A central (`gestao.html`, parte "Agenda das clínicas", aba **Feriados**, fase 4.4) lança um
feriado de cada vez; esta migração lança os 13 que faltam de uma vez, com uma aprovação só do dono.

**Quando aplicar:** logo depois da 4.4 (`20261113121245_agenda_central`) e antes da 5.1, com a aprovação do dono, e
depois de rodar a consulta "Antes de aplicar" (abaixo). A migração e a volta dela só usam tabelas e funções que já
estão na produção (3.1, 3.2, 3.4 e a parte 1 da 4.2), então funcionam com ou sem a 4.3, a 4.4 e a 5.1, em qualquer
ordem (provado no banco de testes: só com a produção de hoje, só com a 4.3, e com tudo).

**Ao aplicar (a migração e a volta, sempre juntas):** os 5 passos de "Ao aplicar uma migração provisória na produção",
escritos no `.github/workflows/banco.yml` ao lado da lista `PENDENTES_NA_PRODUCAO`: (1) renomear a migração e a volta
com a versão que o conector gravar; (2) tirar a marca `NOME PROVISÓRIO` do cabeçalho; (3) tirar o nome da lista;
(4) renomear as provisórias ainda não aplicadas que ficarem com versão menor que a gravada (se a ordem for seguida,
`agenda_app`, da 5.1, e `agenda_leitura_parte_2`, com as voltas) para versões depois dela, trocando os nomes na
lista; (5) trocar `ULTIMA_NA_PRODUCAO`. O que faltar, o CI reprova ("Provisória fora do lugar" ou "Provisória antes
da produção"). **Aplicada na produção em 13/11/2026** (versão `20261113121400`; resultado: 13 lançados, 0 clínicas, 0 conflitos).

## Os 13 feriados lançados

| Dia | Dia da semana | Feriado | Fonte | Link oficial |
|-----|---------------|---------|-------|--------------|
| 15/11/2026 | domingo | Proclamação da República | Lei 662/1949, art. 1º (redação da Lei 10.607/2002); calendário federal de 2026 | [Lei 662](https://www.planalto.gov.br/ccivil_03/leis/l0662.htm) · [Lei 10.607](https://www.planalto.gov.br/ccivil_03/leis/2002/l10607.htm) |
| 20/11/2026 | sexta | Dia Nacional de Zumbi e da Consciência Negra | Lei 14.759/2023, art. 1º; calendário federal de 2026 | [Lei 14.759](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm) |
| 25/12/2026 | sexta | Natal | Lei 662/1949, art. 1º; calendário federal de 2026 | [Lei 662](https://www.planalto.gov.br/ccivil_03/leis/l0662.htm) |
| 01/01/2027 | sexta | Confraternização Universal | Lei 662/1949, art. 1º | [Lei 662](https://www.planalto.gov.br/ccivil_03/leis/l0662.htm) |
| 26/03/2027 | sexta | Sexta-feira da Paixão | Lei 9.093/1995, art. 2º; data pela Páscoa de 28/03/2027 (ver abaixo) | [Lei 9.093](https://www.planalto.gov.br/ccivil_03/leis/l9093.htm) |
| 21/04/2027 | quarta | Tiradentes | Lei 662/1949, art. 1º (redação da Lei 10.607/2002) | [Lei 662](https://www.planalto.gov.br/ccivil_03/leis/l0662.htm) |
| 01/05/2027 | sábado | Dia Mundial do Trabalho | Lei 662/1949, art. 1º | [Lei 662](https://www.planalto.gov.br/ccivil_03/leis/l0662.htm) |
| 07/09/2027 | terça | Independência do Brasil | Lei 662/1949, art. 1º | [Lei 662](https://www.planalto.gov.br/ccivil_03/leis/l0662.htm) |
| 12/10/2027 | terça | Nossa Senhora Aparecida | Lei 6.802/1980, art. 1º | [Lei 6.802](https://www.planalto.gov.br/ccivil_03/leis/l6802.htm) |
| 02/11/2027 | terça | Finados | Lei 662/1949, art. 1º (redação da Lei 10.607/2002) | [Lei 662](https://www.planalto.gov.br/ccivil_03/leis/l0662.htm) |
| 15/11/2027 | segunda | Proclamação da República | Lei 662/1949, art. 1º | [Lei 662](https://www.planalto.gov.br/ccivil_03/leis/l0662.htm) |
| 20/11/2027 | sábado | Dia Nacional de Zumbi e da Consciência Negra | Lei 14.759/2023, art. 1º | [Lei 14.759](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm) |
| 25/12/2027 | sábado | Natal | Lei 662/1949, art. 1º | [Lei 662](https://www.planalto.gov.br/ccivil_03/leis/l0662.htm) |

- **Lei 662, de 6/4/1949**, art. 1º, com a redação da **Lei 10.607, de 19/12/2002**: "São feriados nacionais os dias
  1º de janeiro, 21 de abril, 1º de maio, 7 de setembro, 2 de novembro, 15 de novembro e 25 de dezembro."
- **Lei 6.802, de 30/6/1980**: 12 de outubro, Nossa Senhora Aparecida, feriado nacional.
- **Lei 14.759, de 21/12/2023**: 20 de novembro, Dia Nacional de Zumbi e da Consciência Negra, feriado nacional.
- **Calendário federal de 2026:** Portaria MGI nº 11.460, de 29/12/2025 (DOU de 30/12/2025, edição 248, seção 1,
  p. 59): [texto no DOU](https://www.in.gov.br/web/dou/-/portaria-mgi-n-11.460-de-29-de-dezembro-de-2025-678388627) ·
  [notícia do Ministério da Gestão](https://www.gov.br/gestao/pt-br/assuntos/noticias/2025/dezembro/confira-o-calendario-oficial-de-feriados-nacionais-e-pontos-facultativos-em-2026).
  Lista 10 feriados nacionais em 2026 (entre eles 15/11, 20/11 e 25/12, e "3 de abril, Paixão de Cristo (feriado
  nacional)") e os pontos facultativos (Carnaval 16 e 17/2, Cinzas 18/2, Corpus Christi 4/6...).
- **Calendário federal de 2027:** a portaria ainda não tinha saído em 11/11/2026 (costuma sair no fim de dezembro).
  Os dias fixos de 2027 vêm direto das leis. Quando a portaria de 2027 sair, comparar com a tabela; se algo divergir,
  corrigir pela central (retirar e lançar de novo).
- Os nomes são os do calendário federal. A fonte gravada em cada feriado traz a lei e o endereço dela no Planalto (sem
  "https://": função do banco não guarda endereço de internet, guarda do `000_catalogo.sql`).
- Como as fontes foram conferidas: pela busca na web nos sites oficiais (planalto.gov.br, gov.br, in.gov.br e
  tribunais). Nesta sessão, abrir as páginas de planalto.gov.br e gov.br direto não era permitido pela rede; as
  confirmações vieram dos resultados de busca dessas páginas oficiais.

## Sexta-feira da Paixão: entra como nacional (decisão e motivo)

- **Lei 9.093/1995, art. 2º:** "São feriados religiosos os dias de guarda, declarados em lei municipal, de acordo com a
  tradição local e em número não superior a quatro, **neste incluída a Sexta-Feira da Paixão**." Pela lei, é feriado
  religioso declarado pelo município (um dos quatro), não um feriado nacional de lei federal (a lista da Lei 662/1949
  não a inclui).
- **Portarias federais:** o calendário federal (Portaria MGI 11.460/2025 para 2026 e Portaria MGI 9.783/2024 para
  2025) a lista como "Paixão de Cristo (**feriado nacional**)", e a portaria cita a Lei 9.093/1995 como base.
- **Decisão:** lançar 26/03/2027 como feriado **nacional** na agenda. Motivos: (1) o governo federal a trata como
  feriado nacional no calendário oficial; (2) é feriado praticamente no país inteiro; (3) a tela da clínica diz "Os
  feriados nacionais são lançados pelo IMED", então ela não vai bloquear sozinha; (4) o risco é desigual: sem o
  lançamento, o IMED venderia horário num dia em que a clínica está fechada; com ele, a clínica que atende nesse dia só
  marca "Abrimos neste feriado" na configuração (padrão "fecha", decisão 14 da arquitetura).
- **Data:** Páscoa de 2027 em **28/03/2027** (domingo), calculada por código (algoritmo de Meeus/Jones/Butcher, o mesmo
  que acerta 20/04/2025 e 05/04/2026, as Páscoas dos calendários federais de 2025 e 2026; o pgTAP refaz a conta), então
  a Sexta-feira da Paixão é **26/03/2027**. Conferido em calendários oficiais de 2027:
  [TRF da 3ª Região](https://www.trf3.jus.br/documentos/seju/Feriados/2027/2027_calendario_de_feriados_de_2027-_made_01.09.2026.pdf)
  (26/03, Sexta-feira Santa) e
  [TRE-PR](https://www.tre-pr.jus.br/comunicacao/noticias/2026/Outubro/confira-o-calendario-de-feriados-da-justica-eleitoral-do-parana-em-2027)
  (Semana Santa de 24 a 28/03/2027).
- Se o dono preferir o contrário: retirar o 26/03/2027 na central (aba Feriados, "Retirar") e avisar as clínicas para
  lançarem como feriado municipal.

## O que não entra, e por quê

- **Carnaval (08 e 09/02/2027), Quarta-feira de Cinzas (10/02/2027) e Corpus Christi (27/05/2027):** não são feriado
  nacional por lei; no calendário federal são **ponto facultativo**. Onde forem feriado por lei estadual ou municipal
  (Corpus Christi é feriado em muitas cidades), é a **clínica** que bloqueia, na configuração da agenda dela.
- **Feriados estaduais** (como a data magna do estado) **e municipais** (aniversário da cidade, padroeiro, os
  religiosos da Lei 9.093/1995): cada clínica confere os da cidade e do estado dela, informa "Feriados da cidade e do
  estado conferidos até" (`holidays_checked_until`; o motor não oferece horário depois dessa data) e lança o que faltar
  como bloqueio "Feriado" da unidade.
- **Dias de 2026 que já passaram** (1º/1, 3/4, 21/4, 1º/5, 7/9, 12/10 e 2/11): não mudam nada no motor.

## O que a migração faz (o mesmo que lançar pela central)

Para cada um dos 13, se o dia ainda não tiver feriado nacional (lançado pela central ou pela própria migração antes),
faz o que `agenda_holiday_save` faz: grava o feriado (escopo nacional, sem UF, cidade nem usuário), com a trava
exclusiva de configuração de cada clínica com a agenda nova pega antes; revalida os agendamentos futuros dessas
clínicas (o que cair num dos feriados vira conflito "grade_mudou", em "Precisa de atenção", para remarcar com o
paciente); grava a auditoria "feriado.criar" com as mesmas chaves da central. No fim, a versão da agenda de cada
clínica sobe uma vez (o painel e a central buscam de novo).

- **Uma revalidação por clínica:** a central revalida as clínicas a cada lançamento; a migração grava os feriados que
  faltam e revalida cada clínica **uma vez** no fim, ainda com as travas. O resultado é o mesmo (os mesmos conflitos), e
  as clínicas ficam travadas bem menos tempo (enquanto travadas, marcar nelas espera). Medido no banco de testes: uma
  clínica com 400 agendamentos por vir, 0,6 a 0,8 s; antes, com 13 revalidações, cerca de 13 vezes isso.
- **Conflitos contados de verdade:** o resultado da migração (`"conflicts"`, o número que quem aplica vê) é o número de
  conflitos abertos agora (os que já estavam abertos não contam). Na auditoria de cada feriado, `conflitos` conta os
  conflitos abertos agora de agendamentos que começam naquele dia (hora local da clínica). Diferença da central: lá, a
  auditoria de cada lançamento conta todos os agendamentos que não cabem naquele momento, inclusive os de feriados
  lançados antes (13 lançamentos seguidos somam o mesmo agendamento várias vezes).

- **Auditoria:** a lista de origens de `agenda.audit_log` não tem "migração"; sem usuário logado, a linha fica com a
  origem `sql` ("Correção manual" na aba Auditoria da central; quem: "Equipe técnica do IMED (correção manual)") e o
  motivo `migracao_feriados_nacionais`, que identifica a migração.
- **Pode rodar de novo:** dia já lançado é pulado; nada duplica (no CI ela é aplicada duas vezes de propósito).
- **3 funções privadas** ficam no banco (só o dono do banco executa): `private.agenda_feriados_ate_2027()` (a lista),
  `private.agenda_feriados_ate_2027_lancar()` e `private.agenda_feriados_ate_2027_retirar()`. Servem para o CI testar o
  mesmo código de novo e a volta; a volta as apaga.
- **Volta:** retira só os feriados que a migração lançou (mesmo dia, nome e fonte, sem usuário e com a auditoria do
  motivo dela). Feriado do mesmo dia lançado pela central fica. Tem o **mesmo efeito da retirada pela central de hoje**
  (`agenda_holiday_remove` depois da revisão da 4.4, de 11/11): com a trava de configuração de cada clínica da agenda
  nova, os conflitos "grade_mudou" dos dias retirados cujo agendamento **voltou a caber** são fechados como
  "resolvido", código `feriado_retirado` (saem de "Para remarcar"; a recepção não liga para quem não precisa); o que
  continua sem caber (feriado estadual ou municipal no mesmo dia, regra, bloqueio) fica aberto; cada feriado tirado
  ganha "feriado.remover" na auditoria (motivo `volta_feriados_nacionais`, com `conflitos_fechados` daquele dia, a
  mesma chave da central); a versão da agenda de cada clínica sobe **uma vez** (os painéis abertos e a central
  releem; a central, retirando os 13 um a um, subiria 13 vezes). "Abrimos neste feriado" fica. Depois apaga as 3
  funções. Rodar numa transação só, parando no primeiro erro (o conector já faz assim; no psql,
  `-1 -v ON_ERROR_STOP=1`).
- **A volta não depende da 4.4** (decisão de 11/11, no encaixe com a revisão): ela não chama `agenda_holiday_remove`;
  repete a regra dela com funções que já estão na produção (`agenda_lock_config`, `agenda_item_fits`, `agenda_audit`,
  `agenda_touch`). Assim a migração dos feriados pode entrar antes ou depois da 4.4, e a volta funciona igual nos dois
  casos (com a função da 3.2, que não fecha conflito, a volta dos feriados fecha mesmo assim). Se a regra de
  `agenda_holiday_remove` mudar de novo, mudar também `private.agenda_feriados_ate_2027_retirar` (há um aviso no
  comentário das duas) e o pgTAP `420` (parte E).
- **Trava da volta:** se a central tiver lançado **outro** feriado nacional depois da migração (um de 2028, ou um destes
  dias retirado e relançado, por exemplo quando sair a portaria de 2027), ele mantém o motor oferecendo horário até o
  fim do ano dele, e os dias retirados ficariam abertos para marcar. Aí a volta **recusa** (erro `IMF01`, com os dias
  que abririam) e nada muda: retirar antes, pela central (aba Feriados), os feriados nacionais lançados depois da
  migração, e rodar a volta de novo (na recusa nenhum feriado sai, nenhum conflito fecha e nenhuma versão sobe). A
  central não tem essa trava: ela é só da volta, que tira 13 dias de uma vez. Só quando não sobra nenhum feriado
  nacional que segure o motor o resultado é "o motor volta a não oferecer horário nenhum". (Dia de ontem em diante, na hora de São Paulo, conta como "ainda não
  passou".)

## Antes de aplicar (só leitura)

A central mostra, antes de cada lançamento, quantas clínicas fecham e quantos agendamentos viram conflito
(`agenda_central_holiday_preview`). A migração não tem essa tela: rodar esta consulta antes (só lê; as funções da
migração ainda não existem, por isso a lista de dias vem escrita aqui). Uma linha por dia ainda sem feriado nacional:
clínicas com a agenda nova que fecham nele, agendamentos ativos e por vir nele que vão virar conflito para remarcar, e
o total de agendamentos por vir (a revalidação passa por todos; com milhares, a migração pode passar dos 120 s do
limite dela e não entrar: aí aplicar num horário de pouco movimento).

```sql
with dias (day) as (values (date '2026-11-15'), (date '2026-11-20'), (date '2026-12-25'), (date '2027-01-01'),
                           (date '2027-03-26'), (date '2027-04-21'), (date '2027-05-01'), (date '2027-09-07'),
                           (date '2027-10-12'), (date '2027-11-02'), (date '2027-11-15'), (date '2027-11-20'),
                           (date '2027-12-25')),
     fecha as (select d.day, u.clinic_id from dias d cross join agenda.unit_settings u
               where u.closes_on_holidays
                 and not exists (select 1 from agenda.holiday_openings o where o.clinic_id = u.clinic_id and o.day = d.day))
select d.day as dia,
       (select count(*) from fecha f where f.day = d.day) as clinicas_que_fecham,
       (select count(*) from agenda.appointment_items i join fecha f on f.clinic_id = i.clinic_id and f.day = d.day
        where i.local_start >= d.day::timestamp and i.local_start < (d.day + 1)::timestamp
          and i.starts_at > now() and private.agenda_active_status(i.status)) as agendamentos_viram_conflito,
       (select count(*) from agenda.appointment_items i
        where i.starts_at > now() and private.agenda_active_status(i.status)) as agendamentos_por_vir_no_total
from dias d
where not exists (select 1 from agenda.holidays h where h.scope = 'nacional' and h.day = d.day)
order by d.day;
```

A soma da coluna `agendamentos_viram_conflito` tem de bater com o `"conflicts"` que a migração devolver (se nenhum
agendamento for marcado ou cancelado no meio).

## O que muda na produção quando for aplicada

- `private.agenda_national_until()` passa de vazio para **31/12/2027**: o motor passa a oferecer horário **até
  31/12/2027**, sempre limitado também pelo "feriados conferidos até" de cada clínica e pela antecedência máxima dela
  (até 365 dias; padrão 90).
- Nos 13 dias, as clínicas que fecham em feriado não oferecem horário (a que atende marca "Abrimos neste feriado").
- Na central, aba Feriados: os 13 aparecem com a fonte, e o aviso passa a "Feriados nacionais lançados até
  31/12/2027". A aba Auditoria mostra 13 "Lançou um feriado" (correção manual).
- Clínica com a agenda nova (`agenda.unit_settings`) e agendamento num desses dias: o agendamento vira conflito para
  remarcar e a versão da agenda dela sobe, como na central. Sem nenhuma (era assim na última conferência registrada, na
  3.2; esta sessão não consultou a produção), nada disso acontece. O site do paciente só muda quando uma clínica for
  ligada (5.1).
- Conferir depois de aplicar (só leitura; tem de dar `true`):

```sql
select private.agenda_national_until() = date '2027-12-31'
   and (select count(*) from agenda.holidays h join private.agenda_feriados_ate_2027() l on l.day = h.day
        where h.scope = 'nacional') = 13
   and (select count(*) from agenda.audit_log a
        where a.action = 'feriado.criar' and a.origin = 'sql' and a.reason_code = 'migracao_feriados_nacionais') = 13
   and not has_function_privilege('authenticated', 'private.agenda_feriados_ate_2027_lancar()', 'EXECUTE');
```

(Se a central já tiver lançado algum desses dias antes, a contagem da auditoria dá 13 menos os já lançados.)

## Testes que mudaram por causa dos feriados no banco

Com feriados nacionais vindos de uma migração, um teste com dias relativos a hoje ("daqui a 30 dias") cairia num
feriado em certas datas (por exemplo, rodando em 25/11/2026, "daqui a 30 dias" é 25/12) e quebraria o CI só naquele dia.

- 19 pgTAP que montam clínica com a agenda nova (`100`, `130`, `205`, `210`, `215`, `220`, `230`, `240`, `250`, `300`,
  `310`, `320`, `330`, `355`, `360`, `380`, `385`, `400`, `410`) ganharam, logo depois do `plan`, uma linha que tira os
  feriados nacionais **dentro da transação do teste** (desfeita no fim): o teste volta a lançar só os dele, como antes.
  O `355_aviso_pedido.sql` entrou na lista no encaixe com a revisão (ela criou nele um teste que marca horário "daqui
  a 7 dias" com `agenda_book`; sem a linha, o CI cairia em 13/11/2026, 7 dias antes do 20/11). Prova refeita: com um
  feriado nacional em todos os dias, todos os pgTAP passam (menos o `420`, que confere a lista exata dos 13).
  **Teste novo que monta clínica com a agenda nova e usa dias relativos a hoje: pôr a mesma linha.**
- `130_central.sql`: a conferência da auditoria do feriado lançado pela operação passou a olhar só a conta da operação
  (as 13 linhas da migração também são "feriado.criar").
- `tests/banco/lib.mjs` (`criarClinicaAgenda`): a clínica dos scripts do banco abre também nos feriados
  (`closes_on_holidays = false`); o feriado nacional de 1º/1 do ano que vem que ela lança (se faltar) é tirado de novo
  por `limparClinicaAgenda`. Se ficasse, a partir de 2027 (1º/1/2028) ele seguraria o motor aberto e a trava da volta
  recusaria no passo "Volta e reaplicação" do CI.
- `.github/workflows/banco.yml`: a lista `PENDENTES_NA_PRODUCAO` e a guarda "Provisória fora do lugar" (ver
  "Renomear", acima).
- `420_feriados_nacionais.sql`: a conta da central acompanha a janela dela (do 1º de janeiro do ano passado em diante;
  de 2028 em diante, os 3 de 2026 saem da lista e o teste continua certo). A parte E prova a volta com uma clínica:
  a trava recusa sem mexer em nada; sem o que a segure, fecha o conflito do agendamento que voltou a caber, deixa
  aberto o que continua sem caber (feriado estadual no mesmo dia), conta os fechados por dia e sobe a versão uma vez.

## Como lançar os de 2028

**Atenção: o 1º feriado de 2028 lançado já abre o ano de 2028 inteiro.** O motor oferece horário até o fim do ano do
feriado nacional mais novo (`private.agenda_national_until()`), então, no instante em que um feriado de 2028 é gravado,
todo 2028 fica à venda nas clínicas com antecedência suficiente (até 365 dias), inclusive os feriados de 2028 que ainda
não foram lançados. Um paciente pode marcar num deles; quando esse dia for lançado, o agendamento vira conflito
"grade_mudou" e a clínica tem de remarcar com o paciente.

- **Recomendado:** lançar todos os de 2028 **de uma vez**, numa migração nova igual a esta (uma transação, uma
  aprovação do dono, com a fonte de cada dia), bem antes de as clínicas chegarem a 2028 (com a antecedência padrão de
  90 dias, antes do começo de outubro de 2027; com 365 dias, a qualquer momento de 2027).
- **Pela central (se for assim):** lançar todos os dias de 2028 **em sequência, sem intervalo**, num horário de pouco
  movimento, conferindo antes de cada um quantos agendamentos já existem no dia:
  1. Entrar no `gestao.html` como administrador (ou com o papel "operação"), parte **Agenda das clínicas**, aba
     **Feriados**.
  2. Em **Lançar feriado nacional**: Dia, Nome do feriado e Fonte oficial (a lei com número e ano; copiar o formato
     da tabela acima). O formulário aceita dias de hoje até o fim do ano seguinte ao próximo (em 2026, até 31/12/2028).
  3. **Conferir e lançar** mostra quantas clínicas fecham e quantos agendamentos já existem no dia; **Confirmar: lançar
     feriado** grava (os agendamentos do dia vão para "Precisa de atenção" da clínica).
  4. Repetir para cada dia, logo em seguida.

Dias de 2028 pelas mesmas leis (conferir com a portaria federal de 2028, que deve sair no fim de 2027): 01/01 (sábado),
**14/04 Sexta-feira da Paixão** (Páscoa em 16/04/2028), 21/04 (sexta), 01/05 (segunda), 07/09 (quinta), 12/10 (quinta),
02/11 (quinta), 15/11 (quarta), 20/11 (segunda) e 25/12 (segunda). Carnaval (28 e 29/02), Cinzas (01/03) e Corpus
Christi (15/06/2028) continuam fora.
