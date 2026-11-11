# Feriados nacionais na agenda (iMed Agenda)

> Preparado em 11/11/2026, no ramo `ci/feriados-nacionais`. **Nada foi aplicado na produção.**
> Migração provisória `supabase/migrations/20261111130000_feriados_nacionais.sql`, volta
> `supabase/volta/20261111130000_feriados_nacionais.sql`, teste `supabase/tests/420_feriados_nacionais.sql`.

## Por que existe

O motor de horários só oferece horário até o **fim do ano do último feriado nacional lançado**
(`private.agenda_national_until()`; arquitetura §4: nunca vender num dia que pode ser feriado e ainda não foi lançado).
Em 11/11/2026 a produção não tinha nenhum feriado nacional lançado: nenhuma clínica oferecia horário, nem a do
"Horário direto" (5.1). A central (`gestao.html`, parte "Agenda das clínicas", aba **Feriados**, fase 4.4) lança um
feriado de cada vez; esta migração lança os 13 que faltam de uma vez, com uma aprovação só do dono.

**Quando aplicar:** logo depois da 4.4 (`20261110190000_agenda_central`), com a aprovação do dono. Ao aplicar, renomear
a migração e a volta com a versão que o conector gravar (depois das migrações já aplicadas) e trocar
`ULTIMA_NA_PRODUCAO` no `.github/workflows/banco.yml`. Ela só usa tabelas e funções que já estão na produção (3.1, 3.2 e
3.4), então funciona com ou sem a 4.3, a 4.4 e a 5.1.

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
clínicas (o que cair no feriado vira conflito "grade_mudou", em "Precisa de atenção", para remarcar com o paciente);
grava a auditoria "feriado.criar" com as mesmas chaves da central. No fim, a versão da agenda de cada clínica sobe uma
vez (o painel e a central buscam de novo).

- **Auditoria:** a lista de origens de `agenda.audit_log` não tem "migração"; sem usuário logado, a linha fica com a
  origem `sql` ("Correção manual" na aba Auditoria da central; quem: "Equipe técnica do IMED (correção manual)") e o
  motivo `migracao_feriados_nacionais`, que identifica a migração.
- **Pode rodar de novo:** dia já lançado é pulado; nada duplica (no CI ela é aplicada duas vezes de propósito).
- **3 funções privadas** ficam no banco (só o dono do banco executa): `private.agenda_feriados_ate_2027()` (a lista),
  `private.agenda_feriados_ate_2027_lancar()` e `private.agenda_feriados_ate_2027_retirar()`. Servem para o CI testar o
  mesmo código de novo e a volta; a volta as apaga.
- **Volta:** retira só os feriados que a migração lançou (mesmo dia, nome e fonte, sem usuário e com a auditoria do
  motivo dela), cada um com "feriado.remover" na auditoria (motivo `volta_feriados_nacionais`), como a retirada pela
  central. Feriado do mesmo dia lançado pela central fica. Conflitos já abertos e "abrimos neste feriado" ficam (como na
  central). Depois apaga as 3 funções. Sem feriado nacional, o motor volta a não oferecer horário.

## O que muda na produção quando for aplicada

- `private.agenda_national_until()` passa de vazio para **31/12/2027**: o motor passa a oferecer horário **até
  31/12/2027**, sempre limitado também pelo "feriados conferidos até" de cada clínica e pela antecedência máxima dela
  (até 365 dias; padrão 90).
- Nos 13 dias, as clínicas que fecham em feriado não oferecem horário (a que atende marca "Abrimos neste feriado").
- Na central, aba Feriados: os 13 aparecem com a fonte, e o aviso passa a "Feriados nacionais lançados até
  31/12/2027". A aba Auditoria mostra 13 "Lançou um feriado" (correção manual).
- Hoje nenhuma clínica tem a agenda nova (`agenda.unit_settings` vazia): nenhum conflito nem versão muda. O site do
  paciente só muda quando uma clínica for ligada (5.1).
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

- 18 pgTAP que montam clínica com a agenda nova (`100`, `130`, `205`, `210`, `215`, `220`, `230`, `240`, `250`, `300`,
  `310`, `320`, `330`, `360`, `380`, `385`, `400`, `410`) ganharam, logo depois do `plan`, uma linha que tira os
  feriados nacionais **dentro da transação do teste** (desfeita no fim): o teste volta a lançar só os dele, como antes.
- `130_central.sql`: a conferência da auditoria do feriado lançado pela operação passou a olhar só a conta da operação
  (as 13 linhas da migração também são "feriado.criar").
- `tests/banco/lib.mjs` (`criarClinicaAgenda`): a clínica dos scripts do banco abre também nos feriados
  (`closes_on_holidays = false`).

## Como lançar os de 2028 (pela central)

1. Entrar no `gestao.html` como administrador (ou com o papel "operação"), parte **Agenda das clínicas**, aba
   **Feriados**.
2. Em **Lançar feriado nacional**: Dia, Nome do feriado e Fonte oficial (a lei com número e ano; copiar o formato
   da tabela acima). O formulário aceita dias de hoje até o fim do ano seguinte ao próximo (em 2026, até 31/12/2028).
3. **Conferir e lançar** mostra quantas clínicas fecham e quantos agendamentos já existem no dia; **Confirmar: lançar
   feriado** grava (os agendamentos do dia vão para "Precisa de atenção" da clínica).
4. Repetir para cada dia. O motor só oferece horário em 2028 depois de lançado **pelo menos um** feriado de 2028; lance
   **todos** antes de as clínicas abrirem a agenda para 2028 (com a antecedência padrão de 90 dias, até o começo de
   outubro de 2027).

Dias de 2028 pelas mesmas leis (conferir com a portaria federal de 2028, que deve sair no fim de 2027): 01/01 (sábado),
**14/04 Sexta-feira da Paixão** (Páscoa em 16/04/2028), 21/04 (sexta), 01/05 (segunda), 07/09 (quinta), 12/10 (quinta),
02/11 (quinta), 15/11 (quarta), 20/11 (segunda) e 25/12 (segunda). Carnaval (28 e 29/02), Cinzas (01/03) e Corpus
Christi (15/06/2028) continuam fora.
