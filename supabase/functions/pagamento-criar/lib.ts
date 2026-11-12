// Lógica da função "pagamento-criar" (iMed Pagamentos, P2a; arquitetura do pagamento §4.2, §6.1 e §6.2).
// Não usa APIs do Deno: recebe o banco (rpc), o provedor, o fetch e o ambiente por parâmetro, então roda (e é testada)
// no Node: lib.test.ts (com tudo simulado) e tests/banco/pagamento-ponta-a-ponta.mjs (banco de verdade + provedor de mentira).
//
// "Ir para o pagamento": confere o pedido, os limites e o Turnstile → reserva o horário (agenda_pay_hold) → abre a
// cobrança (pag_charge_open: os valores vêm SEMPRE do banco, nunca do navegador) → cria o pagador e a cobrança Pix com
// a divisão no provedor → anexa (pag_charge_attach) → devolve o "copia e cola" e o prazo. Se o provedor falhar, a
// reserva é solta na hora (pag_charge_abort). "Já paguei" (ação conferir) só consulta o provedor e aplica a situação.
//
// FECHADA POR PADRÃO: sem o segredo do Turnstile, sem a chave do HMAC do CPF ou sem o provedor configurado, recusa
// tudo (503) antes de tocar no banco. E, com tudo configurado, o banco ainda recusa enquanto a chave geral
// (vendas_online_ligadas) estiver desligada ou a clínica não tiver o recebimento ligado.
import {
  cpfValido, ehObjeto, ehUuid, ErroBanco, hmacHex, horarioPego, limitado, resp, soDigitos, type Contagem, type Fetch, type Resposta, type Rpc,
} from '../_shared/base.ts';
import type { EnvGet } from '../_shared/chaves.ts';
import { diaSP, ErroProvedor, type Provedor } from '../_shared/provedor.ts';

export interface Deps {
  rpc: Rpc;
  provedor: Provedor | null;
  env: EnvGet;
  fetch: Fetch;
  agora: () => number;
  /** A conta de quem está logado (id), a partir do cabeçalho Authorization que veio; null = visitante. */
  usuario: (autorizacao: string) => Promise<string | null>;
  contagem: Contagem;
}
export interface Quem { ip: string; autorizacao: string }

// Limites por IP em cada instância (a porta de entrada; o limite por telefone e por agendamento é o do banco, §6.2).
export const LIMITE = { criar: { max: 8, janelaMs: 10 * 60_000 }, conferir: { max: 30, janelaMs: 10 * 60_000 } } as const;
export const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const texto = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const falha = (http: number, status: string, extra: Record<string, unknown> = {}): Resposta => ({ http, corpo: { ok: false, status, ...extra } });

export interface Pedido {
  acao: 'criar' | 'conferir';
  id: string;
  token: string;
  clinica: string;
  itens: { procedure_id: string; starts_at: string }[];
  paciente: Record<string, unknown>;
  chave: string;
  pagador: { nome: string; cpf: string };
  captcha: string;
}

// Lê e confere o formato do que veio do navegador. Só passa adiante os campos da lista (nada de campo extra chega ao
// banco). O que cada campo PODE valer (horário livre, consentimento, preço) quem decide é o banco.
export function lerPedido(b: unknown): Pedido | null {
  if (!ehObjeto(b)) return null;
  const acao = b.action === 'conferir' ? 'conferir' : b.action === 'criar' ? 'criar' : null;
  const token = typeof b.token === 'string' ? b.token : '';
  if (!acao || !ehUuid(b.id) || token.length < 16 || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const base = { acao, id: b.id.toLowerCase(), token, clinica: '', itens: [], paciente: {}, chave: '', pagador: { nome: '', cpf: '' }, captcha: '' } as Pedido;
  if (acao === 'conferir') return base;
  if (!ehUuid(b.clinic) || !ehUuid(b.key) || !Array.isArray(b.items) || b.items.length < 1 || b.items.length > 4) return null;
  const itens = [];
  for (const i of b.items) {
    if (!ehObjeto(i) || !ehUuid(i.procedure_id) || typeof i.starts_at !== 'string' || !Number.isFinite(Date.parse(i.starts_at))) return null;
    itens.push({ procedure_id: i.procedure_id.toLowerCase(), starts_at: new Date(i.starts_at).toISOString() });
  }
  const p = ehObjeto(b.patient) ? b.patient : null;
  const pg = ehObjeto(b.payer) ? b.payer : null;
  if (!p || !pg) return null;
  const nome = texto(p.name, 120);
  const fone = soDigitos(p.phone).slice(0, 13);
  const email = texto(p.email, 254).toLowerCase();
  const pagNome = texto(pg.name, 120);
  const cpf = soDigitos(pg.cpf);
  if (nome.length < 2 || fone.length < 10 || p.consent !== true || pagNome.length < 2 || !cpfValido(cpf)) return null;
  const paciente: Record<string, unknown> = { name: nome, phone: fone, consent: true, ...(email ? { email } : {}) };
  if (p.for_other === true) {
    Object.assign(paciente, {
      for_other: true, other_name: texto(p.other_name, 120), relationship: texto(p.relationship, 60),
      other_minor: p.other_minor === true, guardian_consent: p.guardian_consent === true, other_consent: p.other_consent === true,
    });
  }
  const captcha = typeof b.captcha === 'string' ? b.captcha.slice(0, 2048) : '';
  return { ...base, clinica: b.clinic.toLowerCase(), itens, paciente, chave: b.key.toLowerCase(), pagador: { nome: pagNome, cpf }, captcha };
}

// Turnstile (Cloudflare): o site manda o código do desafio e o servidor confere com o segredo. true só com "success".
export async function conferirTurnstile(fetchFn: Fetch, segredo: string, codigo: string, ip: string): Promise<boolean> {
  if (!segredo || !codigo) return false;
  try {
    const corpo = new URLSearchParams({ secret: segredo, response: codigo });
    if (ip && ip !== 'desconhecido') corpo.set('remoteip', ip);
    const res = await fetchFn(TURNSTILE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: corpo.toString(), signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const j = await res.json().catch(() => null);
    return ehObjeto(j) && j.success === true;
  } catch {
    return false;
  }
}

// O que está configurado nos segredos da função (sem mostrar nenhum): para a recusa e para a conferência depois de publicar.
export function configuracao(env: EnvGet, provedor: Provedor | null) {
  return {
    turnstile: (env('TURNSTILE_SECRET_KEY') ?? '').trim().length > 0,
    hmac: (env('PAG_CPF_HMAC_KEY') ?? '').trim().length >= 32,
    provedor: !!provedor,
  };
}

// Respostas do banco que o site entende do mesmo jeito (o texto de cada uma está em assets/js/pagamento-core.js).
const DO_BANCO = ['slot_taken', 'payments_off', 'payment_not_available', 'payment_pending', 'too_many_expired', 'price_required',
  'below_minimum', 'too_many_bookings', 'not_online', 'agenda_not_started', 'not_found', 'invalid_patient', 'consent_required', 'invalid',
  'invalid_package', 'idempotency_conflict', 'hold_expired', 'not_payable', 'method_not_available', 'too_many_attempts',
  'fee_not_configured', 'fee_below_tariff', 'too_soon', 'too_far', 'closed', 'past'];
const doBanco = (r: Record<string, unknown>): Resposta => {
  const st = typeof r.status === 'string' && DO_BANCO.includes(r.status) ? r.status : 'erro';
  return {
    http: st === 'erro' ? 500 : 200,
    corpo: {
      ok: false, status: st,
      ...(Array.isArray(r.alternatives) ? { alternatives: r.alternatives.filter((x) => typeof x === 'string').slice(0, 10) } : {}),
      ...(Number.isInteger(r.min_cents) ? { min_cents: r.min_cents } : {}),
    },
  };
};

export async function tratar(corpo: unknown, quem: Quem, d: Deps): Promise<Resposta> {
  const pedido = lerPedido(corpo);
  if (!pedido) return falha(400, 'invalid');
  const lim = LIMITE[pedido.acao];
  if (limitado(d.contagem, `${pedido.acao}:${quem.ip}`, d.agora(), lim.max, lim.janelaMs)) {
    return { ...falha(429, 'rate_limited'), cabecalhos: { 'Retry-After': '600' } };
  }
  const cfg = configuracao(d.env, d.provedor);
  if (pedido.acao === 'conferir') {
    if (!d.provedor) return falha(503, 'payments_not_configured');
    return await conferir(pedido, d, d.provedor);
  }
  // Fechada por padrão: sem o Turnstile configurado NINGUÉM cria reserva para pagar (a reserva antes do pagamento é a
  // porta para robô travar a agenda; decisão 10 da agenda e §6.2).
  if (!cfg.turnstile) return falha(503, 'captcha_not_configured');
  if (!cfg.hmac || !d.provedor) return falha(503, 'payments_not_configured');
  if (!(await conferirTurnstile(d.fetch, (d.env('TURNSTILE_SECRET_KEY') ?? '').trim(), pedido.captcha, quem.ip))) return falha(403, 'captcha_failed');
  return await criar(pedido, quem, d, d.provedor);
}

async function criar(p: Pedido, quem: Quem, d: Deps, prov: Provedor): Promise<Resposta> {
  const usuario = quem.autorizacao ? await d.usuario(quem.autorizacao).catch(() => null) : null;

  /* 1. a reserva (ou a mesma de antes: o id e o código são do aparelho, gravados antes do envio) */
  let reserva: Record<string, unknown>;
  try {
    reserva = resp(await d.rpc('agenda_pay_hold', {
      p_clinic: p.clinica, p_items: p.itens, p_patient: p.paciente, p_id: p.id, p_token: p.token, p_user: ehUuid(usuario) ? usuario : null,
    }));
  } catch (e) {
    return horarioPego(e) ? { http: 200, corpo: { ok: false, status: 'slot_taken' } } : falha(500, 'erro');
  }
  if (reserva.status !== 'ok') return doBanco(reserva);

  /* 2. a cobrança aqui (valores do banco) e o pagador (só o HMAC do CPF fica guardado) */
  const soltar = async (): Promise<boolean> => {
    try { return resp(await d.rpc('pag_charge_abort', { p_request: p.id })).status === 'ok'; } catch { return false; }
  };
  let cob: Record<string, unknown>;
  let pagador: Record<string, unknown>;
  try {
    pagador = resp(await d.rpc('pag_payer_upsert', {
      p_cpf_hmac: await hmacHex((d.env('PAG_CPF_HMAC_KEY') ?? '').trim(), p.pagador.cpf), p_user: ehUuid(usuario) ? usuario : null,
    }));
    if (pagador.status !== 'ok') throw new ErroBanco(0, 'pagador');
    cob = resp(await d.rpc('pag_charge_open', { p_request: p.id, p_token: p.token, p_meio: 'pix', p_key: p.chave, p_payer: pagador.payer_id }));
  } catch {
    return falha(500, 'erro', { released: await soltar() });
  }
  if (cob.status === 'charge_exists' || (cob.status === 'ok' && cob.situacao !== 'criada')) {
    // já existe cobrança viva deste agendamento (a página foi reaberta, ou o botão foi tocado de novo): o site retoma
    // por pag_my_payment, que devolve o "copia e cola" enquanto vale
    return { http: 200, corpo: { ok: true, status: 'ok', retomar: true, id: p.id } };
  }
  if (cob.status !== 'ok') {
    const r = doBanco(cob);
    // a reserva nova não pode ficar segurando o horário sem cobrança (reserva repetida de antes: fica como estava)
    const solta = reserva.replay === true ? false : await soltar();
    return { ...r, corpo: { ...r.corpo, released: solta } };
  }
  const chargeId = String(cob.charge_id);
  const referencia = String(cob.referencia);

  /* 3. a cobrança no provedor (com a divisão em valor fixo para a carteira da clínica) */
  let provedorId = '';
  let copiaCola = '';
  let fotoJaExistente = null;
  let tentouCriar = false;
  try {
    // a mesma chave de antes sem o id do provedor: a criação anterior pode ter caído depois de criar lá
    const antiga = cob.replay === true ? await prov.buscarPorReferencia(referencia) : null;
    if (antiga) {
      provedorId = antiga.id;
      copiaCola = await prov.copiaCola(antiga.id);
      fotoJaExistente = antiga.foto;
    } else {
      let clienteId = typeof pagador.provedor_cliente_id === 'string' ? pagador.provedor_cliente_id : '';
      if (!clienteId) {
        clienteId = await prov.criarCliente(p.pagador);
        const anexo = resp(await d.rpc('pag_payer_attach', { p_payer: pagador.payer_id, p_provedor_cliente_id: clienteId }));
        if (typeof anexo.provedor_cliente_id === 'string') clienteId = anexo.provedor_cliente_id;
      }
      tentouCriar = true;
      const criada = await prov.criarCobranca({
        referencia, valorCents: Number(cob.valor_cents), clinicaCents: Number(cob.clinica_cents), walletId: String(cob.wallet_id),
        descricao: String(cob.descricao), clienteId, vencimento: diaSP(d.agora()),
      });
      provedorId = criada.id;
      copiaCola = criada.copiaCola;
    }
  } catch {
    // Provedor fora do ar (ou recusou): a reserva é solta na hora (§4.4) e o paciente vê "pagamento indisponível agora".
    const solta = await soltar();
    // Se a cobrança pode ter nascido lá (a criação foi pedida e a resposta não veio inteira), procura pela referência
    // e apaga, sem segurar a resposta por mais de 8 s: o QR nunca chegou ao paciente, e a conciliação aponta o que sobrar.
    if (tentouCriar || provedorId) {
      const limpar = (async () => {
        const orfa = provedorId ? { id: provedorId } : await prov.buscarPorReferencia(referencia);
        if (orfa) await prov.apagar(orfa.id);
      })().catch(() => {});
      let relogio: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([limpar, new Promise((ok) => { relogio = setTimeout(ok, 8000); })]);
      clearTimeout(relogio);
    }
    return falha(502, 'provider_unavailable', { released: solta });
  }

  /* 4. anexa: cobrança "aguardando" e agendamento "aguardando pagamento" */
  let anexada: Record<string, unknown>;
  try {
    anexada = resp(await d.rpc('pag_charge_attach', { p_charge: chargeId, p_provedor_id: provedorId, p_expira: null, p_copia_cola: copiaCola }));
    if (anexada.status === 'ok' && fotoJaExistente && fotoJaExistente.situacao !== 'aguardando') {
      await d.rpc('pag_sync_apply', { p_charge: chargeId, p_foto: fotoJaExistente, p_event: null });
      return { http: 200, corpo: { ok: true, status: 'ok', retomar: true, id: p.id } };
    }
  } catch {
    // a cobrança existe no provedor e não foi anexada: a rotina solta a reserva em até 60 s; aqui, tenta apagar lá
    try { await prov.apagar(provedorId); } catch { /* conciliação */ }
    return falha(500, 'erro', { released: await soltar() });
  }
  if (anexada.status !== 'ok') {
    // a reserva venceu ou foi cancelada enquanto o provedor respondia: o banco guardou o id e a rotina apaga lá
    try { await prov.apagar(provedorId); } catch { /* a rotina tenta de novo */ }
    return { http: 200, corpo: { ok: false, status: 'hold_expired' } };
  }
  return {
    http: 200,
    corpo: {
      ok: true, status: 'ok', id: p.id, request_status: 'awaiting_payment',
      slot_start: reserva.slot_start ?? null, slot_end: reserva.slot_end ?? null, hold_expires_at: reserva.hold_expires_at ?? null,
      total_cents: Number(cob.valor_cents),
      // só o que o paciente vê (decisão 6): nada de taxa, carteira nem id do provedor
      payment: { situacao: 'aguardando', meio: 'pix', valor_cents: Number(cob.valor_cents), expira_em: anexada.expira_em ?? null, pix_copia_cola: copiaCola },
      agora: new Date(d.agora()).toISOString(),
    },
  };
}

// "Já paguei": acha a cobrança pelo código do agendamento, consulta o provedor e aplica a situação consultada. Não
// confirma nada por conta própria: quem confirma é pag_sync_apply, com o valor conferido.
async function conferir(p: Pedido, d: Deps, prov: Provedor): Promise<Resposta> {
  try {
    const c = resp(await d.rpc('pag_charge_lookup', { p_request: p.id, p_token: p.token }));
    if (c.status !== 'ok') return { http: 200, corpo: { ok: false, status: c.status === 'not_found' ? 'not_found' : 'erro' } };
    if (typeof c.provedor_cobranca_id !== 'string' || !c.provedor_cobranca_id) return { http: 200, corpo: { ok: true, status: 'ok', situacao: c.situacao ?? null } };
    const foto = await prov.consultar(c.provedor_cobranca_id);
    const r = resp(await d.rpc('pag_sync_apply', { p_charge: c.charge_id, p_foto: foto, p_event: null }));
    return { http: 200, corpo: { ok: r.status === 'ok', status: r.status === 'ok' ? 'ok' : 'erro', situacao: r.situacao ?? null, request_status: r.request_status ?? null } };
  } catch (e) {
    return e instanceof ErroProvedor ? falha(502, 'provider_unavailable') : falha(500, 'erro');
  }
}
