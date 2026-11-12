// Roteiro das 12 conferências no AMBIENTE DE TESTES do Asaas (arquitetura do pagamento, §2.3 e fase P0).
// Roda só à mão, pelo GitHub (Actions → "Asaas: conferência no ambiente de testes"), com a chave DE TESTES guardada em
// segredo do GitHub. Nunca roda sozinho, nunca na produção e não faz parte do banco.yml nem do testes.yml.
//
// !!! AINDA NÃO FOI RODADO: não existe conta nem chave. Foi escrito a partir do que a pesquisa de 11/11/2026 registrou
// !!! (memory/projects/imed-pagamento-arquitetura.md, §2.1). Onde a pesquisa não confirmou, o roteiro tenta do jeito que
// !!! o adaptador supõe (supabase/functions/_shared/asaas.ts) e responde "diferente do desenho" se o Asaas não aceitar.
//
// Para cada item do §2.3 responde uma destas três coisas:
//   confirmado ............. o Asaas de testes se comportou como o desenho (e como o provedor de mentira dos testes)
//   diferente do desenho ... não se comportou: ajustar supabase/functions/_shared/asaas.ts (e, se for o caso, o desenho)
//   manual ................. não dá para conferir por aqui (precisa de uma pessoa: pagar um QR, olhar a tela, o extrato
//                            do banco, o aviso chegando numa função publicada...). O texto diz o que fazer.
// Usa o MESMO adaptador das Edge Functions: o que passar aqui é o código que vai rodar.
//
// Variáveis (no GitHub, vêm do workflow; aqui ninguém escreve chave):
//   ASAAS_SANDBOX_KEY     a chave da API do ambiente de testes (segredo do GitHub)
//   ASAAS_SANDBOX_URL     o endereço da API do ambiente de testes (da documentação do Asaas; tem de ter "sandbox")
//   ASAAS_SANDBOX_WALLET  a carteira (walletId) de uma SEGUNDA conta de testes, que faz o papel da clínica
//   ASAAS_SANDBOX_PAGAR   opcional: o caminho do endpoint só do ambiente de testes que confirma um pagamento, com {id}
//                         no lugar do id da cobrança (está na documentação, em "Confirmar pagamento"; a pesquisa não
//                         registrou o caminho, então ele não está escrito aqui). Sem ele, o que depende de um pagamento
//                         sai como "manual".
//   node --experimental-strip-types scripts/asaas-sandbox.mjs
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { criarAsaas } from '../supabase/functions/_shared/asaas.ts';
import { diaSP, ErroProvedor } from '../supabase/functions/_shared/provedor.ts';

export const CPF_DE_TESTE = '52998224725';   // dígitos verificadores certos; não é de ninguém
export const VALOR_CENTS = 2000;             // o preço mínimo para pagar online (parâmetro do banco), só para a conta
export const CLINICA_CENTS = 1700;           // 85% do valor: o que iria para a carteira da clínica
const OK = 'confirmado';
const DIF = 'diferente do desenho';
const MAN = 'manual';

const erro = (e) => (e instanceof ErroProvedor ? `HTTP ${e.status} (${e.codigo})` : e instanceof Error ? e.message : String(e));

/**
 * Faz as conferências. Devolve a lista [{ n, titulo, resposta, notas: [] }], na ordem do §2.3.
 *   url, chave: o ambiente de testes;  wallet: a carteira da "clínica" de testes;  fetchFn: o fetch
 *   pagar(id): confirma o pagamento de uma cobrança de testes (ou null: o que depende de pagamento vira "manual")
 */
export async function conferir({ url, chave, wallet, pagar = null, fetchFn = fetch, agora = () => Date.now() }) {
  const prov = criarAsaas({ url: String(url).replace(/\/+$/, ''), chave }, fetchFn);
  const cru = async (metodo, caminho, corpo) => {
    const res = await fetchFn(`${String(url).replace(/\/+$/, '')}${caminho}`, {
      method: metodo, headers: { 'Content-Type': 'application/json', 'User-Agent': 'IMED', access_token: chave },
      body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(20000),
    });
    let dados = null;
    try { dados = await res.json(); } catch { dados = null; }
    return { http: res.status, dados };
  };
  const itens = [];
  const item = (n, titulo) => { const it = { n, titulo, resposta: MAN, notas: [] }; itens.push(it); return it; };
  const tenta = async (it, o_que, fn) => {
    try { return await fn(); } catch (e) { it.resposta = DIF; it.notas.push(`${o_que}: ${erro(e)}`); return undefined; }
  };
  let n = 0;
  const nova = async (it, clienteId) => tenta(it, 'criar a cobrança Pix com a divisão', () => prov.criarCobranca({
    referencia: `conferencia-${agora()}-${++n}`, valorCents: VALOR_CENTS, clinicaCents: CLINICA_CENTS, walletId: wallet,
    descricao: 'IMED · agendamento CONFERE', clienteId, vencimento: diaSP(agora()),
  }));

  /* ---- 1. Divisão com valor fixo ---- */
  const i1 = item(1, 'Divisão com valor fixo (fixedValue) num Pix: a clínica recebe exatamente o valor fixo? A tarifa sai só do IMED?');
  const cliente = await tenta(i1, 'criar o pagador (nome, CPF e avisos desligados)', () => prov.criarCliente({ nome: 'Pagador de Teste IMED', cpf: CPF_DE_TESTE }));
  let paga = null;
  if (cliente) {
    const c = await nova(i1, cliente);
    if (c) {
      i1.notas.push('cobrança Pix com "split" de valor fixo aceita (o campo dueDate do adaptador foi aceito) e o "copia e cola" veio');
      const foto = await tenta(i1, 'consultar a cobrança', () => prov.consultar(c.id));
      if (foto && foto.situacao !== 'aguardando') { i1.resposta = DIF; i1.notas.push(`situação da cobrança nova: ${foto.situacao} (esperado: aguardando)`); }
      if (foto && foto.valor_cents !== VALOR_CENTS) { i1.resposta = DIF; i1.notas.push(`valor lido: ${foto.valor_cents} centavos (esperado ${VALOR_CENTS})`); }
      if (pagar && i1.resposta !== DIF) {
        const pg = await tenta(i1, 'confirmar o pagamento de teste', async () => { await pagar(c.id); return true; });
        const depois = pg === undefined ? null : await tenta(i1, 'consultar depois de pagar', () => prov.consultar(c.id));
        if (depois) {
          paga = c.id;
          const { dados } = await cru('GET', `/v3/payments/${encodeURIComponent(c.id)}`);
          const fixo = Array.isArray(dados?.split) ? Math.round(Number(dados.split[0]?.fixedValue) * 100) : null;
          if (depois.situacao !== 'paga') { i1.resposta = DIF; i1.notas.push(`depois de pagar a situação é ${depois.situacao} (esperado: paga)`); }
          else if (fixo !== CLINICA_CENTS) { i1.resposta = DIF; i1.notas.push(`divisão lida na cobrança: ${fixo} centavos (esperado ${CLINICA_CENTS})`); }
          else if (depois.tarifa_cents == null || depois.tarifa_cents >= VALOR_CENTS - CLINICA_CENTS) {
            i1.resposta = DIF;
            i1.notas.push(`tarifa lida (value − netValue): ${depois.tarifa_cents} centavos. Se "netValue" já desconta a parte da clínica, o cálculo da tarifa do adaptador muda`);
          } else {
            i1.resposta = OK;
            i1.notas.push(`paga: divisão de ${CLINICA_CENTS} centavos para a carteira da clínica e tarifa de ${depois.tarifa_cents} centavos (value − netValue)`);
            i1.notas.push('MANUAL, ainda assim: conferir no extrato das DUAS contas de teste que a clínica recebeu exatamente o valor fixo e que a tarifa saiu só da conta do IMED');
          }
        }
      } else if (i1.resposta !== DIF) {
        i1.notas.push('falta pagar a cobrança (pela tela do ambiente de testes, ou informando ASAAS_SANDBOX_PAGAR) e conferir o extrato das duas contas');
      }
    }
  }

  /* ---- 2. Quando a parte da clínica fica disponível ---- */
  item(2, 'Quando a parte da clínica fica disponível (Pix e cartão) e quando chega PAYMENT_SPLIT_DONE').notas
    .push('olhar no extrato da conta da clínica de testes quando o valor aparece depois de um Pix pago, e o horário do aviso PAYMENT_SPLIT_DONE na lista de avisos enviados; cartão: fase P4');

  /* ---- 3 e 4. Apagar a cobrança ---- */
  const i3 = item(3, 'Apagar uma cobrança Pix e tentar pagar o QR: é recusado? Chega dinheiro mesmo assim?');
  if (cliente) {
    const c = await nova(i3, cliente);
    if (c) {
      const foto = await tenta(i3, 'apagar a cobrança', () => prov.apagar(c.id));
      if (foto && foto.situacao !== 'apagada') { i3.resposta = DIF; i3.notas.push(`depois de apagar a situação lida é ${foto.situacao} (esperado: apagada)`); }
      if (foto?.situacao === 'apagada') {
        i3.notas.push('DELETE respondeu "deleted: true"');
        const { http, dados } = await cru('GET', `/v3/payments/${encodeURIComponent(c.id)}`);
        i3.notas.push(`consultar a cobrança apagada: HTTP ${http}${dados && 'deleted' in dados ? `, deleted = ${dados.deleted}` : ''}${dados?.status ? `, status = ${dados.status}` : ''}`);
        if (pagar) {
          try {
            await pagar(c.id);
            const depois = await prov.consultar(c.id);
            if (depois.situacao === 'paga') { i3.resposta = DIF; i3.notas.push('o QR de cobrança APAGADA foi pago e a cobrança ficou paga: o banco já trata (devolve tudo), e o provedor de mentira imita isto; anotar no desenho (§16, item 1)'); }
            else { i3.resposta = OK; i3.notas.push(`pagar a cobrança apagada não a deixou paga (situação: ${depois.situacao})`); }
          } catch (e) { i3.resposta = OK; i3.notas.push(`pagar a cobrança apagada foi recusado: ${erro(e)}`); }
        } else {
          i3.notas.push('falta tentar pagar o QR da cobrança apagada (aplicativo de testes ou ASAAS_SANDBOX_PAGAR) e ver se chega dinheiro');
        }
      }
    }
  }
  item(4, 'Pagar o QR no mesmo instante em que se apaga a cobrança (corrida)').notas
    .push('duas pessoas, ao mesmo tempo: uma paga o QR, a outra roda o DELETE. Anotar o que cada uma recebeu e a situação final. O banco aceita os dois finais (apagada, ou paga e confirmada/devolvida)');

  /* ---- 5. Avisos ---- */
  item(5, 'Mesmo aviso reenviado; aviso fora de ordem; nosso servidor respondendo erro: o que o Asaas faz e quando pausa a fila').notas
    .push('precisa da função pagamento-webhook publicada num projeto de testes e cadastrada no Asaas com o segredo: reenviar um aviso pela tela, responder 500 de propósito e anotar quantas falhas pausam a fila; conferir os campos id, event, dateCreated e payment.{id,status,value} e a lista inteira de situações');

  /* ---- 6. Devolução ---- */
  const i6 = item(6, 'Devolução total e parcial (Pix e cartão) com splitRefunds; a carteira da clínica SEM saldo');
  if (paga) {
    const parcial = { valorCents: 100, clinicaCents: 85, walletId: wallet, total: false, chave: `conferencia-parcial-${agora()}` };
    const d1 = await tenta(i6, 'devolução parcial com splitRefunds', () => prov.devolver(paga, parcial));
    if (d1) {
      if (d1.foto.situacao !== 'devolvida_parcial' || d1.foto.devolvido_cents !== 100) {
        i6.resposta = DIF; i6.notas.push(`depois da devolução parcial: situação ${d1.foto.situacao}, devolvido ${d1.foto.devolvido_cents} centavos (esperado: devolvida_parcial, 100)`);
      } else i6.notas.push(`devolução parcial de 100 centavos aceita com splitRefunds${d1.estornoId ? ' (veio o id do estorno)' : ' (SEM id do estorno na resposta: conferir o campo)'}`);
      // a mesma chave de novo: o desenho supõe que NÃO devolve outra vez
      const d2 = await tenta(i6, 'repetir a mesma devolução com a mesma chave', () => prov.devolver(paga, parcial));
      if (d2 && d2.foto.devolvido_cents !== 100) {
        i6.resposta = DIF;
        i6.notas.push(`a MESMA chave devolveu de novo (devolvido: ${d2.foto.devolvido_cents} centavos): o cabeçalho de idempotência não vale. A rotina já consulta antes de reenviar; tirar a suposição do adaptador`);
      } else if (d2) i6.notas.push('a mesma chave não devolveu duas vezes');
      const d3 = await tenta(i6, 'devolução total do que resta', () => prov.devolver(paga, { valorCents: VALOR_CENTS - (d2?.foto.devolvido_cents ?? 100), clinicaCents: 0, walletId: null, total: true, chave: `conferencia-total-${agora()}` }));
      if (d3 && d3.foto.situacao !== 'devolvida') { i6.resposta = DIF; i6.notas.push(`depois da devolução total a situação é ${d3.foto.situacao} (esperado: devolvida)`); }
      if (d3 && i6.resposta !== DIF) { i6.resposta = OK; i6.notas.push('devolução total aceita: cobrança devolvida'); }
    }
    i6.notas.push('MANUAL, ainda assim: repetir com a carteira da clínica de testes SEM saldo (sacar antes) e anotar o que o Asaas faz; conferir nos extratos de onde saiu cada parte; cartão: fase P4');
  } else {
    i6.notas.push('precisa de uma cobrança de testes PAGA (ASAAS_SANDBOX_PAGAR, ou pagar pela tela e rodar de novo): devolução parcial com splitRefunds, a mesma chave duas vezes, a total, e a carteira da clínica sem saldo');
  }

  /* ---- 7. O nome que o pagador vê ---- */
  item(7, 'O que o paciente vê como nome de quem recebe (no Pix e na fatura do cartão)').notas
    .push('ler o QR de uma cobrança de testes num aplicativo de banco (ou na tela de pagamento de testes) e anotar o nome que aparece; cartão: fase P4');

  /* ---- 8. Pagador sem CPF ---- */
  const i8 = item(8, 'Cliente sem CPF: a cobrança é aceita? Avisos do Asaas ao pagador desligados de verdade?');
  if (cliente) {
    const sem = await cru('POST', '/v3/customers', { name: 'Pagador de Teste Sem CPF', notificationDisabled: true });
    if (sem.http >= 200 && sem.http < 300 && typeof sem.dados?.id === 'string') {
      const cob = await cru('POST', '/v3/payments', { customer: sem.dados.id, billingType: 'PIX', value: VALOR_CENTS / 100, dueDate: diaSP(agora()), description: 'IMED · agendamento CONFERE' });
      i8.notas.push(`pagador SEM CPF foi aceito; a cobrança Pix dele: HTTP ${cob.http}${cob.dados?.errors?.[0]?.code ? ` (${cob.dados.errors[0].code})` : ''}`);
      i8.notas.push(cob.http >= 200 && cob.http < 300 ? 'o desenho pede o CPF de qualquer jeito (decisão 20): nada muda, mas dá para discutir pedir só quando o Asaas exigir' : 'sem CPF não há cobrança: o desenho (pedir o CPF na hora de pagar) está certo');
      if (cob.http >= 200 && cob.http < 300 && typeof cob.dados?.id === 'string') await cru('DELETE', `/v3/payments/${encodeURIComponent(cob.dados.id)}`);
    } else {
      i8.notas.push(`pagador SEM CPF foi recusado: HTTP ${sem.http}${sem.dados?.errors?.[0]?.code ? ` (${sem.dados.errors[0].code})` : ''}. O desenho (pedir o CPF na hora de pagar) está certo`);
    }
    i8.resposta = OK;
    i8.notas.push('MANUAL, ainda assim: conferir que o pagador de teste (com notificationDisabled) não recebeu e-mail nem SMS do Asaas');
  } else {
    i8.resposta = DIF;
    i8.notas.push('o pagador com nome e CPF não pôde ser criado (veja o item 1)');
  }

  /* ---- 9, 10 e 11: fora da P2a ---- */
  item(9, 'Checkout hospedado com divisão; volta para o site; pré-autorização').notas.push('é da fase P4 (cartão): conferir quando ela começar');
  item(10, 'Assinatura mensal: primeira cobrança, atraso, cancelamento, troca de preço').notas.push('é da fase P5 (Destaque): conferir quando ela começar');
  item(11, 'Contestação simulada (se o ambiente de testes tiver) numa cobrança com divisão').notas.push('é da fase P4 (cartão): conferir quando ela começar, com o gerente da conta (pergunta S1)');

  /* ---- 12. Listagens ---- */
  const i12 = item(12, 'Listagens para a conciliação: cobranças por dia, divisões pagas, devoluções, extrato da conta');
  if (cliente) {
    const c = await nova(i12, cliente);
    if (c) {
      const hoje = diaSP(agora());
      const linhas = await tenta(i12, `listar as cobranças do dia ${hoje} (filtro dateCreated, offset e limit)`, () => prov.listar(hoje));
      if (linhas) {
        const achou = linhas.find((l) => l.provedor_cobranca_id === c.id);
        if (!achou) { i12.resposta = DIF; i12.notas.push(`a cobrança criada agora não veio na lista do dia ${hoje} (${linhas.length} linhas): conferir o filtro por dia e o fuso`); }
        else if (achou.valor_cents !== VALOR_CENTS || achou.repasse_cents !== CLINICA_CENTS) { i12.resposta = DIF; i12.notas.push(`na lista: valor ${achou.valor_cents} e repasse ${achou.repasse_cents} centavos (esperado ${VALOR_CENTS} e ${CLINICA_CENTS})`); }
        else i12.notas.push(`a lista do dia traz a cobrança com o valor e a divisão (${linhas.length} linhas)`);
      }
      const ref = await cru('GET', `/v3/payments/${encodeURIComponent(c.id)}`);
      const referencia = ref.dados?.externalReference;
      const pelaRef = typeof referencia === 'string' ? await tenta(i12, 'achar a cobrança pela referência externa (filtro externalReference)', () => prov.buscarPorReferencia(referencia)) : null;
      if (typeof referencia !== 'string') { i12.resposta = DIF; i12.notas.push('a cobrança não devolve a referência externa (externalReference)'); }
      else if (pelaRef !== undefined && pelaRef?.id !== c.id) { i12.resposta = DIF; i12.notas.push('o filtro externalReference não achou a cobrança: sem ele, uma criação que cai no meio pode deixar cobrança órfã (a conciliação aponta)'); }
      else if (pelaRef) i12.notas.push('o filtro externalReference acha a cobrança');
      await tenta(i12, 'apagar a cobrança da conferência', () => prov.apagar(c.id));
      if (i12.resposta !== DIF) i12.resposta = OK;
      i12.notas.push('MANUAL, ainda assim: divisões pagas, devoluções e extrato da conta por API (a pesquisa só registrou "listar splits pagos"): ver na documentação o que a conciliação completa (fase P6) vai usar');
    }
  } else {
    i12.resposta = DIF;
    i12.notas.push('sem o pagador de teste não deu para criar a cobrança (veja o item 1)');
  }
  return itens.sort((a, b) => a.n - b.n);
}

export function relatorio(itens) {
  const conta = (r) => itens.filter((i) => i.resposta === r).length;
  const linhas = [`Conferência no ambiente de testes do Asaas: ${conta(OK)} confirmado(s), ${conta(DIF)} diferente(s) do desenho, ${conta(MAN)} manual(is).`, ''];
  for (const i of itens) {
    linhas.push(`${String(i.n).padStart(2)}. [${i.resposta.toUpperCase()}] ${i.titulo}`);
    for (const nota of i.notas) linhas.push(`      - ${nota}`);
  }
  return linhas.join('\n');
}

// Só ambiente de testes: o endereço precisa ser https e ter "sandbox" no nome do servidor.
export function enderecoDeTestes(url) {
  try { const u = new URL(String(url)); return u.protocol === 'https:' && /sandbox/i.test(u.hostname); } catch { return false; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const url = (env.ASAAS_SANDBOX_URL ?? '').trim();
  const chave = (env.ASAAS_SANDBOX_KEY ?? '').trim();
  const wallet = (env.ASAAS_SANDBOX_WALLET ?? '').trim();
  const caminho = (env.ASAAS_SANDBOX_PAGAR ?? '').trim();
  const falta = [!chave && 'ASAAS_SANDBOX_KEY (segredo do GitHub)', !url && 'ASAAS_SANDBOX_URL', !wallet && 'ASAAS_SANDBOX_WALLET'].filter(Boolean);
  if (falta.length) { console.error(`Faltou: ${falta.join(', ')}. Nada foi chamado.`); process.exit(2); }
  if (!enderecoDeTestes(url)) { console.error('O endereço não é do ambiente de testes (precisa ser https e ter "sandbox" no nome do servidor). Nada foi chamado.'); process.exit(2); }
  if (caminho && !/^\/[A-Za-z0-9/_{}.-]+$/.test(caminho)) { console.error('ASAAS_SANDBOX_PAGAR precisa ser um caminho começando com "/", com {id} no lugar do id da cobrança. Nada foi chamado.'); process.exit(2); }
  const pagar = caminho ? async (id) => {
    const res = await fetch(`${url.replace(/\/+$/, '')}${caminho.replace('{id}', encodeURIComponent(id))}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'IMED', access_token: chave }, body: '{}', signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new ErroProvedor(res.status, 'confirmar_pagamento_de_teste');
  } : null;
  const itens = await conferir({ url, chave, wallet, pagar });
  const texto = relatorio(itens);
  console.log(texto);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Asaas: conferência no ambiente de testes\n\n\`\`\`\n${texto}\n\`\`\`\n`);
  // No topo da página da execução (o registro não é lido pelo Claude): uma nota por item.
  if (env.GITHUB_ACTIONS === 'true') {
    const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    for (const i of itens) console.log(`::${i.resposta === DIF ? 'error' : 'notice'} title=${i.n}. ${i.resposta}::${esc(`${i.titulo}\n${i.notas.join('\n')}`.slice(0, 3500))}`);
  }
  process.exit(itens.some((i) => i.resposta === DIF) ? 1 : 0);
}
