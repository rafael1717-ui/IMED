// Regras do pagamento pelo site (iMed Pagamentos, fase P2a), sem mexer na página: rodam também no Node
// (tests/pagamento-core.test.mjs). A tela é a de assets/js/pagamento.js.
//
// NADA É INVENTADO: preço, prazo e situação vêm sempre do banco (agenda_public_info, a resposta da função do servidor
// pagamento-criar e pag_my_payment). Sem o dado, a frase não aparece. O site nunca calcula taxa nem divisão (o paciente
// vê só o preço do exame) e nunca "confirma" nada: quem confirma é o banco, quando o pagamento chega de verdade.
// DESLIGADO: este módulo só é baixado quando a clínica tem o recebimento pelo site ligado (hoje, nenhuma).

export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

/* ======================= CPF de quem paga ======================= */
// 11 dígitos, não todos iguais, com os dois dígitos verificadores certos. (A mesma regra, com os mesmos casos de teste,
// está no servidor: supabase/functions/_shared/base.ts.) O CPF vai só para a função do servidor na hora de pagar:
// nunca é gravado no aparelho (nem no rascunho do formulário, nem em "Meus pedidos").
export function cpfValido(v) {
  const d = onlyDigits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
export function maskCpf(v) {
  const d = onlyDigits(v).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}
export const CPF_MSG = 'Digite o CPF de quem vai pagar, com os 11 números.';

/* ======================= dinheiro e datas ======================= */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
// 13323 → "R$ 133,23". Só inteiros de centavos; qualquer outra coisa = sem valor (a frase não aparece).
export const formatMoney = (cents) => (Number.isInteger(cents) && cents >= 0 ? BRL.format(cents / 100).replace(/ /g, ' ') : '');
const SP = 'America/Sao_Paulo';
function partes(iso, tz) {
  const d = new Date(iso ?? '');
  if (!iso || Number.isNaN(d.getTime())) return null;
  let f;
  try { f = new Intl.DateTimeFormat('pt-BR', { timeZone: tz || SP, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
  catch { f = new Intl.DateTimeFormat('pt-BR', { timeZone: SP, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
  return Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
}
// "16/11/2026 às 09:03" (no fuso da unidade) e "16/11".
export const dateTime = (iso, tz) => { const p = partes(iso, tz); return p ? `${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute}` : ''; };
export const dayMonth = (iso, tz) => { const p = partes(iso, tz); return p ? `${p.day}/${p.month}` : ''; };

/* ======================= antes de pagar ======================= */
// Esta marcação é paga pelo site? Só com a resposta do banco dizendo que a clínica recebe online por Pix e com o preço
// do procedimento a partir do mínimo que o banco informou. Exame "sob consulta" ou abaixo do mínimo: pagamento no local,
// como antes. (O banco confere de novo: agenda_book recusa quem deveria pagar e pagamento-criar recusa quem não deve.)
export function payable(info, proc) {
  if (!info || info.status !== 'ok' || info.payment !== 'online' || !proc) return false;
  if (!Array.isArray(info.payment_methods) || !info.payment_methods.includes('pix')) return false;
  const min = info.payment_min_cents;
  return Number.isInteger(proc.price_cents) && Number.isInteger(min) && min >= 0 && proc.price_cents >= min;
}
// "O horário fica guardado por 10 minutos enquanto você paga." (o prazo é o que o banco informou; sem ele, nada).
export function holdText(info) {
  const m = info?.payment_hold_min;
  return Number.isInteger(m) && m > 0 ? `O horário fica guardado por ${m} ${m === 1 ? 'minuto' : 'minutos'} enquanto você paga. Se o pagamento não chegar nesse tempo, o horário volta para a agenda.` : '';
}
// Frases fixas (fatos do desenho, §3.6, §6.3 e §9 da arquitetura do pagamento). O texto de termos e de privacidade é da fase P2b.
export const TXT = {
  golpe: 'O IMED só recebe pagamento dentro do site, na tela do seu agendamento. Nunca por telefone, WhatsApp, e-mail ou link enviado por mensagem.',
  cpf: 'O CPF é usado só para o pagamento: vai para o meio de pagamento com o nome de quem paga e o valor. O nome do exame não vai. O IMED não guarda o CPF.',
  nota: 'A nota fiscal do exame é emitida pela clínica.',
  fechar: 'Pode fechar esta página: o pagamento não se perde. A confirmação aparece aqui e em Meus pedidos.',
};
export const FUNCAO = 'pagamento-criar';

// O que o site manda para a função do servidor (ação "criar"): a escolha (clínica, procedimento, horário), os dados do
// formulário, o id e o código do agendamento (gerados no aparelho, gravados antes do envio), a chave da cobrança e o
// CPF de quem paga. NENHUM VALOR: o preço é o que está no banco.
export function criarBody(args, intent, { cpf, captcha = '' } = {}) {
  return {
    action: 'criar', clinic: args.p_clinic, items: args.p_items, patient: args.p_patient, id: intent.id, token: intent.token, key: intent.key,
    payer: { name: args.p_patient?.name ?? '', cpf: onlyDigits(cpf) }, captcha: String(captcha ?? ''),
  };
}
export const conferirBody = (id, token) => ({ action: 'conferir', id, token });

// O que fazer com a resposta de pagamento-criar (corpo JSON; null = sem resposta):
//   ok        cobrança criada (payment: copia e cola, prazo, valor);  retomar  já existia cobrança viva: ler pag_my_payment;
//   taken     o horário acabou de ser pego;   pending  este telefone já tem um pagamento em andamento;
//   wait      reservas seguidas vencidas: esperar;   provider  meio de pagamento fora do ar (a reserva foi solta);
//   expired   a reserva venceu antes de a cobrança ficar pronta;   captcha  o desafio contra robôs não passou;
//   limit     muitas tentativas;   bookings  limite de agendamentos por vir;   off  pagamento pelo site indisponível aqui;
//   closed    a clínica parou de vender online;   invalid  dados recusados;   retry  id já usado para outro horário;
//   error     sem resposta ou resposta estranha (mantém a intenção: o reenvio é seguro).
const KIND = {
  slot_taken: 'taken', payment_pending: 'pending', too_many_expired: 'wait', provider_unavailable: 'provider', hold_expired: 'expired',
  captcha_failed: 'captcha', rate_limited: 'limit', too_many_attempts: 'limit', too_many_bookings: 'bookings',
  payments_off: 'off', payment_not_available: 'off', captcha_not_configured: 'off', payments_not_configured: 'off', not_payable: 'off',
  method_not_available: 'off', fee_not_configured: 'off', fee_below_tariff: 'off', price_required: 'off', below_minimum: 'off',
  origin_not_allowed: 'off', unauthorized: 'off',
  not_online: 'closed', agenda_not_started: 'closed', not_found: 'closed',
  invalid: 'invalid', invalid_patient: 'invalid', consent_required: 'invalid', invalid_package: 'invalid', invalid_json: 'invalid',
  idempotency_conflict: 'retry',
};
export function outcome(body) {
  const b = body && typeof body === 'object' ? body : null;
  const st = b ? b.status : null;
  if (st === 'ok' && b.ok === true) {
    const p = b.payment && typeof b.payment === 'object' ? b.payment : null;
    if (b.retomar === true || !p || typeof p.pix_copia_cola !== 'string' || !p.pix_copia_cola) return { kind: 'retomar' };
    return { kind: 'ok', slot: b.slot_start ?? null, end: b.slot_end ?? null, agora: b.agora ?? null };
  }
  const kind = (typeof st === 'string' && Object.hasOwn(KIND, st) ? KIND[st] : null) ?? 'error';
  return { kind, ...(kind === 'taken' && Array.isArray(b.alternatives) ? { alternatives: b.alternatives.filter((x) => Number.isFinite(Date.parse(x))) } : {}) };
}
export const MSG = {
  pending: 'Este celular já tem um pagamento em andamento. Conclua ou cancele aquele pagamento em Meus pedidos antes de começar outro.',
  wait: 'As últimas reservas deste celular venceram sem pagamento. Espere um pouco e tente de novo mais tarde.',
  provider: 'O pagamento está indisponível agora. O horário foi liberado e nada foi cobrado. Tente de novo em alguns minutos.',
  expired: 'O tempo da reserva acabou antes de o pagamento ficar pronto. Escolha o horário de novo.',
  captcha: 'Não foi possível confirmar que o pedido veio de uma pessoa. Recarregue a página e tente de novo.',
  limit: 'Foram muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
  off: 'O pagamento pelo site não está disponível nesta clínica agora. Ligue para a clínica para agendar.',
  retry: 'Não deu para abrir o pagamento deste horário. Toque em Ir para o pagamento de novo.',
  error: 'Não foi possível abrir o pagamento agora. Verifique sua internet e toque em Tentar de novo: o mesmo pedido é reenviado, sem reservar duas vezes.',
};

/* ======================= a tela do pagamento ======================= */
const ATIVO = ['confirmed', 'checked_in', 'in_service', 'completed', 'no_show', 'reschedule_requested'];
const refunds = (p) => (Array.isArray(p?.devolucoes) ? p.devolucoes : [])
  .filter((d) => d && Number.isInteger(d.valor_cents) && d.valor_cents > 0)
  .map((d) => ({ cents: d.valor_cents, done: d.situacao === 'devolvida', at: (d.situacao === 'devolvida' ? d.devolvida_em : d.pedida_em) ?? null }));

// A situação que a tela mostra, a partir de pag_my_payment (res) e do relógio:
//   aguardando   QR e "copia e cola" valendo (expira: quando o QR some, em ms)
//   conferindo   o prazo do QR acabou e a reserva ainda vale: se o pagamento foi feito no último instante, ainda confirma
//   criando      a reserva existe e a cobrança ainda não (a página foi reaberta no meio da criação)
//   pago         pagamento aprovado e horário confirmado
//   vencido      não foi pago no prazo: horário liberado, nada cobrado
//   cancelado    cancelado antes de pagar (ou a cobrança não nasceu): horário liberado, nada cobrado
//   devolucao    o dinheiro chegou e o agendamento não vale (pagamento atrasado ou cancelamento): devolução pedida
//   devolvido    devolução concluída
//   sem_pagamento / nao_encontrado / indisponivel
export function viewOf(res, now = Date.now()) {
  if (!res || typeof res !== 'object' || (res.status !== 'ok' && res.status !== 'not_found')) return { view: 'indisponivel' };
  if (res.status === 'not_found') return { view: 'nao_encontrado' };
  if (res.payment_mode !== 'online') return { view: 'sem_pagamento' };
  const p = res.payment && typeof res.payment === 'object' ? res.payment : null;
  const st = res.request_status;
  const base = { cents: Number.isInteger(p?.valor_cents) ? p.valor_cents : null, refunds: refunds(p) };
  const pagou = !!p?.paga_em;
  // por que o dinheiro volta: o pagamento chegou depois do prazo (reserva expirada) ou o agendamento foi cancelado
  const motivo = st === 'expired' ? 'atrasado' : 'cancelado';
  if (p && ['aprovada', 'devolvida_parcial', 'contestada'].includes(p.situacao)) {
    return ATIVO.includes(st) ? { view: 'pago', ...base, paidAt: p.paga_em ?? null } : { view: 'devolucao', motivo, ...base };
  }
  if (p?.situacao === 'devolvida') return { view: 'devolvido', motivo, ...base };
  if (p && pagou && ['expirada', 'cancelada'].includes(p.situacao)) return { view: 'devolucao', motivo: 'atrasado', ...base };
  if (p && ['aguardando', 'processando'].includes(p.situacao) && ['hold', 'awaiting_payment'].includes(st)) {
    const exp = Date.parse(p.expira_em ?? '');
    if (p.situacao === 'aguardando' && typeof p.pix_copia_cola === 'string' && p.pix_copia_cola && exp > now) {
      return { view: 'aguardando', ...base, expira: exp, code: p.pix_copia_cola };
    }
    return { view: 'conferindo', ...base };
  }
  if (st === 'hold' && (!p || p.situacao === 'criada')) return { view: 'criando', ...base };
  if (st === 'expired' || p?.situacao === 'expirada') return { view: 'vencido', ...base };
  if (st === 'cancelled' || p?.situacao === 'cancelada' || p?.situacao === 'recusada') return { view: 'cancelado', ...base };
  return { view: 'indisponivel' };
}
// Telas que não mudam mais sozinhas (a página para de consultar).
export const FINAL = ['pago', 'vencido', 'cancelado', 'devolvido', 'sem_pagamento', 'nao_encontrado'];
// De quanto em quanto tempo a tela consulta a situação (ms), ou null para parar. elapsed: há quanto tempo está nesta tela.
export function pollDelay(view, elapsed = 0) {
  if (FINAL.includes(view)) return null;
  if (view === 'aguardando') return elapsed < 3 * 60000 ? 3000 : 5000;
  if (view === 'criando') return elapsed < 2 * 60000 ? 2000 : null;
  if (view === 'conferindo') return elapsed < 12 * 60000 ? 4000 : null;
  if (view === 'devolucao') return elapsed < 10 * 60000 ? 20000 : null;
  return elapsed < 5 * 60000 ? 8000 : null;   // indisponivel: tenta de novo por um tempo
}

// Relógio do QR: quanto falta (ms), "7:42" para a tela e a frase para o leitor de tela.
export function countdown(expira, now = Date.now()) {
  const ms = Math.max(0, (Number(expira) || 0) - now);
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const seg = s % 60;
  const falado = [m ? `${m} ${m === 1 ? 'minuto' : 'minutos'}` : '', seg || !m ? `${seg} ${seg === 1 ? 'segundo' : 'segundos'}` : ''].filter(Boolean).join(' e ');
  return { ms, ended: ms <= 0, text: `${m}:${String(seg).padStart(2, '0')}`, sr: `Faltam ${falado} para pagar.` };
}
// Avisos falados do relógio (região viva): só quando cruza 5, 2 e 1 minuto e 30 segundos, para não ler a cada segundo.
const MARCOS = [300000, 120000, 60000, 30000];
export function announceAt(prevMs, ms) {
  for (const m of MARCOS) if (prevMs > m && ms <= m && ms > 0) return m >= 60000 ? `Faltam ${m / 60000} ${m === 60000 ? 'minuto' : 'minutos'} para pagar.` : 'Faltam 30 segundos para pagar.';
  return '';
}

// Linhas do comprovante (só o que existe): valor, quando, meio, código, local, exame, horário.
export function receiptRows(v, ctx = {}) {
  return [
    ['Valor pago', formatMoney(v?.cents)],
    ['Pago em', dateTime(v?.paidAt, ctx.tz)],
    ['Forma de pagamento', v?.view === 'pago' ? 'Pix' : ''],
    ['Código do agendamento', ctx.code || ''],
    ['Local', ctx.place || ''],
    ['Exame', ctx.exam || ''],
    ['Horário', ctx.when || ''],
  ].filter(([, valor]) => valor);
}
// "Devolução pedida em 16/11: R$ 133,23" / "Devolvido em 17/11: R$ 133,23".
export function refundLines(v, tz) {
  return (v?.refunds ?? []).map((d) => {
    const dia = dayMonth(d.at, tz);
    return `${d.done ? 'Devolvido' : 'Devolução pedida'}${dia ? ` em ${dia}` : ''}: ${formatMoney(d.cents)}`;
  });
}
// Títulos e textos de cada tela (uma frase simples por situação).
export const VIEW_TXT = {
  conferindo: ['O tempo do QR Code acabou', 'Se você já pagou, espere um instante: estamos conferindo se o pagamento chegou. Se não pagou, o horário volta para a agenda sozinho.'],
  criando: ['Preparando o pagamento…', 'O horário já está guardado para você.'],
  vencido: ['O tempo para pagar acabou', 'O horário voltou para a agenda e nada foi cobrado. Se você pagou depois do prazo, o valor volta inteiro para a conta que pagou.'],
  cancelado: ['Pagamento cancelado', 'O horário foi liberado e nada foi cobrado.'],
  atrasado: ['O pagamento chegou depois do prazo', 'O horário já não estava mais guardado, por isso o agendamento não foi confirmado. O valor volta inteiro para a conta que pagou.'],
  devolvendo: ['Agendamento cancelado', 'O valor pago volta para a conta que pagou.'],
  devolvido: ['Valor devolvido', 'A devolução foi feita para a conta que pagou.'],
  indisponivel: ['Não foi possível ver o pagamento agora', 'Verifique sua internet. O pagamento não se perde: a situação aparece aqui assim que a conexão voltar.'],
  nao_encontrado: ['Não encontramos este pagamento', 'Ele pode ter sido feito em outro aparelho ou a reserva já foi apagada.'],
};

/* ======================= "Meus pedidos" e conta ======================= */
// Situação gravada no aparelho (imed_appts) enquanto o pagamento não chega: nunca "confirmado".
export const LOCAL_STATUS = 'aguardando_pagamento';
// Resumo do pagamento no cartão do pedido: { text, cls, canContinue, hasReceipt } ou null (sem pagamento pelo site).
export function contaResumo(res, { now = Date.now(), tz } = {}) {
  const v = viewOf(res, now);
  const valor = formatMoney(v.cents);
  const linhas = refundLines(v, tz);
  switch (v.view) {
    case 'aguardando': return { view: v.view, text: `Aguardando o pagamento por Pix${valor ? ` (${valor})` : ''}.`, cls: 'wait', canContinue: true, hasReceipt: false, lines: [] };
    case 'conferindo': return { view: v.view, text: 'O tempo do QR Code acabou. Estamos conferindo se o pagamento chegou.', cls: 'wait', canContinue: true, hasReceipt: false, lines: [] };
    case 'criando': return { view: v.view, text: 'Preparando o pagamento.', cls: 'wait', canContinue: true, hasReceipt: false, lines: [] };
    case 'pago': return { view: v.view, text: `Pago pelo site${valor ? `: ${valor}` : ''}${dayMonth(v.paidAt, tz) ? ` em ${dayMonth(v.paidAt, tz)}` : ''} · Pix`, cls: 'ok', canContinue: false, hasReceipt: true, lines: linhas };
    case 'devolucao': return { view: v.view, text: v.motivo === 'atrasado' ? 'O pagamento chegou depois do prazo. O valor volta inteiro para a conta que pagou.' : 'Pagamento com devolução pedida.', cls: 'back', canContinue: false, hasReceipt: false, lines: linhas };
    case 'devolvido': return { view: v.view, text: 'Pagamento devolvido.', cls: 'back', canContinue: false, hasReceipt: false, lines: linhas };
    case 'vencido': return { view: v.view, text: 'Não foi pago no prazo. Nada foi cobrado.', cls: 'off', canContinue: false, hasReceipt: false, lines: [] };
    case 'cancelado': return { view: v.view, text: 'Cancelado antes do pagamento. Nada foi cobrado.', cls: 'off', canContinue: false, hasReceipt: false, lines: [] };
    default: return null;
  }
}

/* ======================= QR Code ======================= */
// SVG do QR a partir da matriz de módulos (rows[r][c] = escuro?): fundo branco e margem de 4 módulos SEMPRE (também no
// tema escuro), para qualquer aplicativo de banco conseguir ler. Um caminho só, com os módulos escuros de cada linha juntos.
export function qrSvg(rows, { quiet = 4, title = 'QR Code do Pix' } = {}) {
  const n = Array.isArray(rows) ? rows.length : 0;
  if (!n) return '';
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!rows[r][c]) continue;
      let w = 1;
      while (c + w < n && rows[r][c + w]) w++;
      d += `M${c + quiet} ${r + quiet}h${w}v1h-${w}z`;
      c += w - 1;
    }
  }
  const t = n + quiet * 2;
  const esc = String(title).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" role="img" aria-label="${esc}" shape-rendering="crispEdges"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
// Matriz do QR com a biblioteca do site (assets/vendor/qrcode-generator), correção de erro M.
export function qrRows(text, qrcode) {
  const q = qrcode(0, 'M');
  q.addData(String(text));
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}
