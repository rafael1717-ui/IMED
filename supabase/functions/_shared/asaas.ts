// ADAPTADOR DO ASAAS: a única parte do pagamento que conhece o Asaas. Implementa a interface de provedor.ts.
//
// !!! NADA AQUI FOI CONFERIDO NO ASAAS DE VERDADE. Foi escrito a partir do que a pesquisa de 11/11/2026 registrou
// !!! (memory/projects/imed-pagamento-arquitetura.md, §2.1), SEM conta, sem chave e sem abrir a documentação inteira.
// !!! Cada suposição abaixo tem a marca "A CONFERIR (§2.3, item N)": é um dos 12 itens do roteiro do ambiente de testes
// !!! (scripts/asaas-sandbox.mjs, Actions → "Asaas: conferência no ambiente de testes"). Antes de ligar em clínica real,
// !!! rode o roteiro e ajuste este arquivo. O provedor de mentira dos testes (tests/banco/asaas-falso.mjs) imita estas
// !!! mesmas suposições: teste verde NÃO quer dizer que o Asaas se comporta assim.
//
// O que NÃO está aqui de propósito: nenhum endereço do Asaas (vem do segredo ASAAS_API_URL: a pesquisa não registrou o
// endereço da API, só os caminhos /v3/...) e nenhuma chave (segredo ASAAS_API_KEY).
import type { Cabecalhos, Fetch } from './base.ts';
import { ehObjeto } from './base.ts';
import {
  centavos, ErroProvedor, reais, type Aviso, type Carteira, type CobrancaCriada, type CobrancaNova, type Devolucao, type Foto, type Leitor,
  type LinhaConciliacao, type Pagador, type Provedor, type Situacao,
} from './provedor.ts';

export interface ConfigAsaas { url: string; chave: string }

// Situações da cobrança no Asaas → situação neutra.
//   [doc] nos nomes dos avisos (§2.1): CONFIRMED, RECEIVED, OVERDUE, REFUNDED, CHARGEBACK_REQUESTED, CHARGEBACK_DISPUTE,
//   AWAITING_CHARGEBACK_REVERSAL. "PENDING" é a situação da cobrança recém-criada.
// A CONFERIR (§2.3, item 5): a lista inteira de situações (a pesquisa não confirmou; §16, item 8). Situação que não
// está aqui NÃO é adivinhada: vira erro "situacao_desconhecida", o aviso fica pendente e a conciliação aponta.
const AGUARDANDO = ['PENDING', 'OVERDUE'];
const PAGAS = ['RECEIVED', 'CONFIRMED'];
const CONTESTADAS = ['CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'];

// A CONFERIR (§2.3, itens 1, 5 e 6): nomes dos campos da cobrança (value, netValue, refundedValue, paymentDate,
// deleted, refunds) e se, com divisão, "netValue" desconta só a tarifa (e não a parte da clínica). Se descontar a
// divisão, a tarifa lida aqui sai errada: a conciliação acusa (diferença "tarifa") e este cálculo muda.
export function fotoDoAsaas(p: unknown): Foto {
  if (!ehObjeto(p) || typeof p.status !== 'string') throw new ErroProvedor(0, 'resposta_invalida');
  const st = p.status.toUpperCase();
  const devolvido = p.refundedValue == null ? 0 : centavos(p.refundedValue);
  let situacao: Situacao;
  if (p.deleted === true && !PAGAS.includes(st) && st !== 'REFUNDED' && !CONTESTADAS.includes(st)) situacao = 'apagada';
  else if (AGUARDANDO.includes(st)) situacao = 'aguardando';
  else if (st === 'REFUNDED') situacao = 'devolvida';
  else if (PAGAS.includes(st)) situacao = devolvido > 0 ? 'devolvida_parcial' : 'paga';
  else if (CONTESTADAS.includes(st)) situacao = 'contestada';
  else throw new ErroProvedor(0, 'situacao_desconhecida');
  const valor = Number.isFinite(Number(p.value)) ? centavos(p.value) : null;
  const liquido = Number.isFinite(Number(p.netValue)) ? centavos(p.netValue) : null;
  const paga = situacao !== 'aguardando' && situacao !== 'apagada';
  const estornos = Array.isArray(p.refunds) ? p.refunds : [];
  const ultimo = estornos.length ? estornos[estornos.length - 1] : null;
  return {
    situacao,
    valor_cents: valor,
    tarifa_cents: paga && valor != null && liquido != null && valor >= liquido ? valor - liquido : null,
    devolvido_cents: devolvido,
    paga_em: typeof p.paymentDate === 'string' && p.paymentDate ? p.paymentDate : null,
    provedor_estorno_id: ehObjeto(ultimo) && typeof ultimo.id === 'string' ? ultimo.id : null,
  };
}

// Corpo do aviso (webhook). [doc] (§2.1): cada aviso tem um "id" de evento, o nome em "event" e a cobrança em
// "payment". A CONFERIR (§2.3, item 5): os campos dateCreated, payment.status e payment.value.
export function avisoDoAsaas(corpo: unknown): Aviso | null {
  if (!ehObjeto(corpo) || typeof corpo.id !== 'string' || !corpo.id || typeof corpo.event !== 'string' || !corpo.event) return null;
  const p = ehObjeto(corpo.payment) ? corpo.payment : null;
  const quando = typeof corpo.dateCreated === 'string' && Number.isFinite(Date.parse(corpo.dateCreated)) ? new Date(corpo.dateCreated).toISOString() : null;
  return {
    id: corpo.id.slice(0, 200),
    tipo: corpo.event.slice(0, 80),
    cobrancaId: p && typeof p.id === 'string' && p.id ? p.id : null,
    situacao: p && typeof p.status === 'string' ? p.status.slice(0, 60) : null,
    valorCents: p && Number.isFinite(Number(p.value)) ? centavos(p.value) : null,
    ocorridoEm: quando,
  };
}

// [doc] (§2.1): o segredo do aviso ("authToken", 32 a 255 caracteres) vem no cabeçalho "asaas-access-token".
export const leitorAsaas: Leitor = {
  nome: 'asaas',
  segredoDoAviso: (h: Cabecalhos): string => h.get('asaas-access-token') ?? '',
  lerAviso: avisoDoAsaas,
};

export function criarAsaas(cfg: ConfigAsaas, fetchFn: Fetch): Provedor {
  // [doc] (§2.1): a chave vai no cabeçalho "access_token". O corpo de erro traz errors[].code.
  // Só o código do erro sai daqui: a resposta inteira pode trazer dados do pagador e nunca vai para registro.
  const chamar = async (metodo: string, caminho: string, corpo?: unknown, extra: Record<string, string> = {}): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetchFn(`${cfg.url}${caminho}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'IMED', access_token: cfg.chave, ...extra },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new ErroProvedor(0, e instanceof Error && e.name === 'TimeoutError' ? 'tempo_esgotado' : 'sem_resposta');
    }
    const texto = await res.text().catch(() => '');
    let dados: unknown = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = null; }
    if (!res.ok) {
      const erros = ehObjeto(dados) && Array.isArray(dados.errors) ? dados.errors : [];
      const codigo = ehObjeto(erros[0]) && typeof erros[0].code === 'string' ? erros[0].code : 'erro_do_provedor';
      throw new ErroProvedor(res.status, codigo);
    }
    return dados;
  };
  const idDe = (v: unknown): string => {
    if (!ehObjeto(v) || typeof v.id !== 'string' || !/^[A-Za-z0-9_-]{4,80}$/.test(v.id)) throw new ErroProvedor(0, 'resposta_invalida');
    return v.id;
  };
  const consultar = async (id: string): Promise<Foto> => fotoDoAsaas(await chamar('GET', `/v3/payments/${encodeURIComponent(id)}`));
  const copiaCola = async (id: string): Promise<string> => {
    // [doc] (§2.1): GET /v3/payments/{id}/pixQrCode devolve "payload" (copia e cola), "encodedImage" e "expirationDate".
    // A imagem não é usada: o site desenha o QR a partir do "copia e cola". O QR do Asaas NÃO vence em minutos [doc]:
    // quem vence é a nossa cobrança, que a rotina apaga. A CONFERIR (§2.3, itens 3 e 4): QR de cobrança apagada.
    const qr = await chamar('GET', `/v3/payments/${encodeURIComponent(id)}/pixQrCode`);
    if (!ehObjeto(qr) || typeof qr.payload !== 'string' || !qr.payload || qr.payload.length > 1000) throw new ErroProvedor(0, 'qr_invalido');
    return qr.payload;
  };

  return {
    ...leitorAsaas,

    // [doc] (§2.1): POST /v3/customers; "notificationDisabled: true" desliga os avisos do Asaas ao pagador (quem avisa é
    // o IMED). A CONFERIR (§2.3, item 8): se o CPF é obrigatório, o nome do campo (cpfCnpj) e se os avisos ficam
    // desligados de verdade. Só nome e CPF de quem paga (§6.3): sem telefone, e-mail ou endereço.
    async criarCliente(p: Pagador): Promise<string> {
      return idDe(await chamar('POST', '/v3/customers', { name: p.nome, cpfCnpj: p.cpf, notificationDisabled: true }));
    },

    // [doc] (§2.1): POST /v3/payments com "split": [{ walletId, fixedValue }] (valor fixo em reais, 2 casas) e
    // "externalReference". A CONFERIR (§2.3, item 1): a clínica recebe exatamente o valor fixo e a tarifa sai só do
    // IMED; (item 7) o nome que o pagador vê. O campo "dueDate" (vencimento) é SUPOSIÇÃO: a pesquisa cita o
    // "vencimento da cobrança" sem o nome do campo (conferir no item 1). A descrição é fixa e vem do banco (§6.3).
    async criarCobranca(c: CobrancaNova): Promise<CobrancaCriada> {
      const p = await chamar('POST', '/v3/payments', {
        customer: c.clienteId, billingType: 'PIX', value: reais(c.valorCents), dueDate: c.vencimento,
        description: c.descricao, externalReference: c.referencia,
        split: [{ walletId: c.walletId, fixedValue: reais(c.clinicaCents) }],
      });
      const id = idDe(p);
      return { id, copiaCola: await copiaCola(id) };
    },

    // A CONFERIR (§2.3, item 12): o filtro "externalReference" na listagem é SUPOSIÇÃO (a pesquisa só registrou que a
    // referência externa existe na cobrança). Serve para não criar duas cobranças quando a criação cai no meio.
    async buscarPorReferencia(referencia: string) {
      const r = await chamar('GET', `/v3/payments?externalReference=${encodeURIComponent(referencia)}`);
      const lista = ehObjeto(r) && Array.isArray(r.data) ? r.data : [];
      const p = lista.find((x) => ehObjeto(x) && x.externalReference === referencia && x.deleted !== true);
      return p ? { id: idDe(p), foto: fotoDoAsaas(p) } : null;
    },

    consultar,
    copiaCola,

    // [doc] (§2.1): DELETE /v3/payments/{id} responde "deleted: true"; a documentação manda conferir antes se já não
    // foi paga. Aqui: se o Asaas recusar (por exemplo, já paga), consulta e devolve a situação de verdade.
    // A CONFERIR (§2.3, itens 3 e 4): apagar no mesmo instante do pagamento; QR de cobrança apagada ainda pago.
    async apagar(id: string): Promise<Foto> {
      try {
        const r = await chamar('DELETE', `/v3/payments/${encodeURIComponent(id)}`);
        if (ehObjeto(r) && r.deleted === true) {
          return { situacao: 'apagada', valor_cents: null, tarifa_cents: null, devolvido_cents: null, paga_em: null, provedor_estorno_id: null };
        }
      } catch (e) {
        if (!(e instanceof ErroProvedor) || !e.definitivo) throw e;
      }
      return await consultar(id);
    },

    // [doc] (§2.1): POST /v3/payments/{id}/refund; sem "value" = total; com "splitRefunds" diz quanto sai de cada
    // carteira. A CONFERIR (§2.3, item 6): o formato de "splitRefunds" ([{ walletId, value }] é SUPOSIÇÃO), a carteira
    // da clínica SEM saldo e o campo com o id do estorno na resposta. O cabeçalho com a chave de idempotência também é
    // SUPOSIÇÃO: por isso a rotina consulta a cobrança antes de reenviar uma devolução sem resposta.
    async devolver(id: string, d: Devolucao) {
      const p = await chamar('POST', `/v3/payments/${encodeURIComponent(id)}/refund`, {
        ...(d.total ? {} : { value: reais(d.valorCents) }),
        ...(d.clinicaCents > 0 && d.walletId ? { splitRefunds: [{ walletId: d.walletId, value: reais(d.clinicaCents) }] } : {}),
      }, { 'x-chave-idempotencia': d.chave });
      const foto = fotoDoAsaas(p);
      const direto = ehObjeto(p) && typeof p.refundId === 'string' ? p.refundId : null;
      return { estornoId: direto ?? foto.provedor_estorno_id, foto };
    },

    // A CONFERIR (§2.3, item 12): a listagem por dia (filtro "dateCreated"), a paginação (offset, limit, hasMore) e de
    // onde vem o que foi para a carteira da clínica (aqui: split[0].fixedValue). Tudo SUPOSIÇÃO até o roteiro.
    async listar(dia: string): Promise<LinhaConciliacao[]> {
      const linhas: LinhaConciliacao[] = [];
      for (let pagina = 0; pagina < 50; pagina++) {
        const r = await chamar('GET', `/v3/payments?dateCreated=${encodeURIComponent(dia)}&offset=${pagina * 100}&limit=100`);
        const lista = ehObjeto(r) && Array.isArray(r.data) ? r.data : [];
        for (const p of lista) {
          if (!ehObjeto(p)) continue;
          const foto = fotoDoAsaas(p);
          const split = Array.isArray(p.split) && ehObjeto(p.split[0]) ? p.split[0] : null;
          linhas.push({
            provedor_cobranca_id: idDe(p), situacao: foto.situacao, valor_cents: foto.valor_cents ?? 0,
            repasse_cents: split && Number.isFinite(Number(split.fixedValue)) ? centavos(split.fixedValue) : 0,
            tarifa_cents: foto.tarifa_cents ?? 0, devolvido_cents: foto.devolvido_cents ?? 0,
          });
        }
        if (!(ehObjeto(r) && r.hasMore === true) || !lista.length) break;
      }
      return linhas;
    },

    // A CONFERIR NO AMBIENTE DE TESTES (pergunta S3 do §3.5; não é um dos 12 itens do roteiro): a pesquisa NÃO achou
    // como validar a carteira de OUTRA conta antes da primeira cobrança. Por isso, aqui só se confere o que dá para
    // conferir sem mover dinheiro: que a carteira informada não é a da própria conta do IMED ("não se informa a própria
    // carteira" na divisão [doc], §2.1). O endpoint que lista as carteiras da própria conta (GET /v3/wallets/, resposta
    // { data: [{ id }] }) é SUPOSIÇÃO: se ele não existir (4xx) ou responder de outro jeito, a resposta é
    // "sem_como_saber" e a clínica segue para a conferência da equipe do IMED. Nunca responde "conferida" nem
    // "nao_existe": quem pode dizer isso é o Asaas, e ainda não se sabe como perguntar. Nunca cria cobrança.
    async conferirCarteira(walletId: string): Promise<Carteira> {
      let r: unknown;
      try {
        r = await chamar('GET', '/v3/wallets/');
      } catch (e) {
        // chave recusada (401/403) é erro de configuração, não "não dá para saber": sobe para quem chamou
        if (e instanceof ErroProvedor && e.definitivo && e.status !== 401 && e.status !== 403) return 'sem_como_saber';
        throw e;
      }
      const lista = ehObjeto(r) && Array.isArray(r.data) ? r.data : null;
      if (!lista) return 'sem_como_saber';
      return lista.some((w) => ehObjeto(w) && w.id === walletId) ? 'propria' : 'sem_como_saber';
    },
  };
}
