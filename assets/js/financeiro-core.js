// Regras puras da aba "Financeiro" do painel da clínica (iMed Pagamentos, fase P2b; arquitetura do pagamento §7.2).
// Sem tela e sem rede: testadas em tests/financeiro-core.test.mjs. A tela fica em financeiro.js (baixada só quando a
// pessoa abre a aba). NENHUM número nasce aqui: valores, taxa, preço mínimo e totais vêm das funções do banco
// (pag_clinic_status e pag_clinic_statement, da P1); este arquivo só dá nome às situações, monta a lista do que falta
// para ligar e escreve os valores em reais. Nenhum dado de paciente passa por aqui: as funções não mandam.
import { examLabel } from './agenda-core.js';

export const DASH = '—';
export const TZ_SP = 'America/Sao_Paulo';
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// Número inteiro que veio do banco (centavos, contagem); qualquer outra coisa vira null ("—" na tela, nunca zero).
export const int = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^-?\d{1,15}$/.test(v) ? Number(v) : null);

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtBRL = (cents) => (isNum(cents) ? BRL.format(Math.round(cents) / 100).replace(/ /g, ' ') : DASH);
export const isIsoDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
  && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
export const fmtDia = (iso) => (isIsoDay(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : DASH);
const diaFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ_SP, year: 'numeric', month: '2-digit', day: '2-digit' });
// O dia de hoje em São Paulo (os dias do extrato são os de São Paulo, como o banco conta).
export const hojeSP = (now = Date.now()) => diaFmt.format(new Date(now));
// O dia (AAAA-MM-DD, São Paulo) de um instante que o banco mandou; inválido: ''.
export const diaDe = (iso) => { const t = Date.parse(iso); return !iso || Number.isNaN(t) ? '' : diaFmt.format(new Date(t)); };
const somaDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const fmts = new Map();
// "12/11 às 09:30" no fuso da clínica (a hora do exame que a recepção conhece).
export function fmtQuando(iso, tz = TZ_SP) {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return '';
  let f = fmts.get(tz);
  if (!f) {
    try { f = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); } catch { f = null; }
    fmts.set(tz, f);
  }
  if (!f) return fmtQuando(iso, TZ_SP);
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
}
// 1500 → "15%"; 1250 → "12,5%" (pontos-base, como o banco guarda).
export function fmtPct(bps) {
  if (!isNum(bps)) return DASH;
  return `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

/* ======================= situação do recebimento ======================= */
// Resposta de pag_clinic_status. Devolve { tipo: 'ok', ...campos }, { tipo: 'forbidden' } ou null (resposta que esta
// tela não entende). Só passam os campos da lista (nada de campo novo aparece na tela sem alguém olhar).
const SITUACOES = ['nao_ligada', 'em_conferencia', 'ativa', 'suspensa'];
export function normalizeStatus(raw) {
  if (!obj(raw)) return null;
  if (raw.status === 'forbidden') return { tipo: 'forbidden' };
  if (raw.status !== 'ok' || !SITUACOES.includes(raw.situacao)) return null;
  const t = obj(raw.taxa) && ['percentual', 'fixo'].includes(raw.taxa.tipo) ? raw.taxa : null;
  const taxa = t && (t.tipo === 'percentual' ? int(t.bps) !== null : int(t.cents) !== null)
    ? { tipo: t.tipo, bps: int(t.bps), cents: int(t.cents) } : null;
  return {
    tipo: 'ok',
    situacao: raw.situacao,
    meios: Array.isArray(raw.meios) ? raw.meios.filter((m) => typeof m === 'string') : [],
    carteira_final: typeof raw.carteira_final === 'string' && /^[A-Za-z0-9_-]{1,4}$/.test(raw.carteira_final) ? raw.carteira_final : '',
    aceito_em: diaDe(raw.aceito_em),
    conferida_em: diaDe(raw.conferida_em),
    payment_mode: raw.payment_mode === 'online' ? 'online' : 'no_local',
    vendas_online_ligadas: raw.vendas_online_ligadas === true,
    recebendo: raw.recebendo === true,
    taxa,
    preco_minimo_cents: int(raw.preco_minimo_cents),
  };
}

// As 4 situações que a clínica vê. O banco diz "recebendo" quando as 3 travas estão abertas (conta ativa, unidade no
// modo on-line e a chave geral do IMED); aqui "ligado" exige isso E cada trava conferida de novo (na dúvida, desligado).
export const ESTADOS = ['indisponivel', 'analise', 'desligado', 'ligado'];
export function estadoRecebimento(st) {
  if (!st || st.tipo !== 'ok' || st.situacao === 'nao_ligada') {
    return { codigo: 'indisponivel', titulo: 'Recebimento on-line ainda não disponível', tom: 'neutro', icone: 'fa-circle-info',
      texto: 'Hoje os pacientes pagam direto na clínica, como sempre. Quando o pagamento pelo site estiver disponível para a sua clínica, a situação e o extrato aparecem aqui.' };
  }
  const carteira = st.carteira_final ? ` (carteira com final ${st.carteira_final})` : '';
  if (st.situacao === 'em_conferencia') {
    return { codigo: 'analise', titulo: 'Em análise', tom: 'aviso', icone: 'fa-clock',
      texto: `A conta da clínica no meio de pagamento${carteira} foi informada${st.aceito_em ? ` em ${fmtDia(st.aceito_em)}` : ''} e a equipe do IMED está conferindo. Enquanto isso, o pagamento continua direto na clínica.` };
  }
  if (st.situacao === 'suspensa') {
    return { codigo: 'desligado', titulo: 'Desligado', tom: 'erro', icone: 'fa-ban',
      texto: 'A equipe do IMED suspendeu o recebimento on-line desta clínica. Os pacientes pagam direto na clínica. O que já foi pago pelo site continua no extrato abaixo. Fale com o IMED para saber o motivo.' };
  }
  const ligado = st.recebendo && st.payment_mode === 'online' && st.vendas_online_ligadas;
  if (ligado) {
    return { codigo: 'ligado', titulo: 'Ligado', tom: 'ok', icone: 'fa-circle-check',
      texto: 'Os pacientes pagam pelo site ao marcar o horário. O IMED fica com a taxa e a parte da clínica vai para a conta dela no meio de pagamento.' };
  }
  return { codigo: 'desligado', titulo: 'Desligado', tom: 'aviso', icone: 'fa-pause',
    texto: 'A conta da clínica já foi conferida, mas o pagamento pelo site não está valendo agora: os pacientes pagam direto na clínica. Veja abaixo o que falta.' };
}

// "O que falta para ligar": os 4 passos, na ordem, cada um feito ou não (só com o que o banco respondeu).
export function passos(st) {
  if (!st || st.tipo !== 'ok' || st.situacao === 'nao_ligada') return [];
  const ativa = st.situacao === 'ativa';
  return [
    { id: 'conta', feito: true, texto: 'Conta da clínica no meio de pagamento informada',
      detalhe: [st.carteira_final && `carteira com final ${st.carteira_final}`, st.aceito_em && `termos aceitos em ${fmtDia(st.aceito_em)}`].filter(Boolean).join(' · ') },
    { id: 'conferida', feito: ativa, texto: 'Conta conferida pela equipe do IMED',
      detalhe: ativa ? (st.conferida_em ? `conferida em ${fmtDia(st.conferida_em)}` : '')
        : st.situacao === 'suspensa' ? 'O recebimento foi suspenso pela equipe do IMED: fale com o IMED.' : 'A equipe do IMED está conferindo.' },
    { id: 'unidade', feito: ativa && st.payment_mode === 'online', texto: 'Pagamento pelo site ligado nesta unidade',
      detalhe: st.payment_mode === 'online' ? '' : 'Hoje a unidade está em “pagamento no local”. Nesta etapa, quem liga é a equipe do IMED, junto com o(a) dono(a) da clínica.' },
    { id: 'geral', feito: st.vendas_online_ligadas, texto: 'Pagamento pelo site aberto pelo IMED',
      detalhe: st.vendas_online_ligadas ? '' : 'O IMED ainda não abriu o pagamento pelo site (vale para todas as clínicas).' },
  ];
}
export const faltam = (lista) => lista.filter((p) => !p.feito).length;

// A taxa do IMED em uma frase, com o número que o banco mandou (nunca um número daqui). Sem regra no banco: ''.
export function taxaTexto(taxa) {
  if (!taxa) return '';
  if (taxa.tipo === 'percentual' && isNum(taxa.bps)) return `${fmtPct(taxa.bps)} do valor de cada exame pago pelo site`;
  if (taxa.tipo === 'fixo' && isNum(taxa.cents)) return `${fmtBRL(taxa.cents)} por exame pago pelo site`;
  return '';
}
const MEIOS = { pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto' };
export const meioTexto = (m) => MEIOS[m] || (m ? String(m) : DASH);
// Os dados fixos do recebimento (taxa, meio e preço mínimo), só os que o banco informou.
export function condicoes(st) {
  if (!st || st.tipo !== 'ok') return [];
  const out = [];
  const t = taxaTexto(st.taxa);
  if (t) out.push(['Taxa do IMED', t]);
  if (st.meios.length) out.push(['Como o paciente paga', st.meios.map(meioTexto).join(', ')]);
  if (isNum(st.preco_minimo_cents)) out.push(['Preço mínimo', `Exame abaixo de ${fmtBRL(st.preco_minimo_cents)} (ou sem preço informado) continua com pagamento no local.`]);
  return out;
}

/* ======================= período do extrato ======================= */
// O banco aceita até 92 dias de diferença entre o primeiro e o último dia (pag_clinic_statement).
export const MAX_DIAS = 92;
export const PERIODOS = [['mes', 'Este mês'], ['mes_passado', 'Mês passado'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['datas', 'Escolher as datas']];
// Os dias de um período pronto (null para "Escolher as datas" e para código desconhecido).
export function periodo(codigo, hoje = hojeSP()) {
  if (!isIsoDay(hoje)) return null;
  if (codigo === 'mes') return { de: `${hoje.slice(0, 7)}-01`, ate: hoje };
  if (codigo === 'mes_passado') {
    const fim = somaDias(`${hoje.slice(0, 7)}-01`, -1);
    return { de: `${fim.slice(0, 7)}-01`, ate: fim };
  }
  if (codigo === '30' || codigo === '90') return { de: somaDias(hoje, -(Number(codigo) - 1)), ate: hoje };
  return null;
}
// Datas escolhidas à mão: as duas preenchidas, na ordem e dentro do limite do banco.
export function validarPeriodo(de, ate) {
  const errors = {};
  if (!isIsoDay(de)) errors.de = 'Escolha o primeiro dia.';
  if (!isIsoDay(ate)) errors.ate = 'Escolha o último dia.';
  if (!errors.de && !errors.ate) {
    if (ate < de) errors.ate = 'O último dia não pode ser antes do primeiro.';
    else if ((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000 > MAX_DIAS) errors.ate = `O extrato mostra até ${MAX_DIAS + 1} dias de cada vez. Escolha um período menor.`;
  }
  return { ok: !Object.keys(errors).length, errors, de, ate };
}

/* ======================= extrato ======================= */
// Situação de cada linha (um exame pago): pelo que o banco diz da cobrança e pelo que já voltou daquele exame.
export function situacaoLinha(l) {
  if (isNum(l.devolvido_cents) && isNum(l.preco_cents) && l.devolvido_cents > 0) {
    return l.devolvido_cents >= l.preco_cents ? { codigo: 'devolvido', texto: 'Devolvido', tom: 'neutro' } : { codigo: 'devolvido_parte', texto: 'Devolvido em parte', tom: 'aviso' };
  }
  if (l.situacao === 'contestada') return { codigo: 'contestado', texto: 'Contestado', tom: 'erro' };
  return { codigo: 'pago', texto: 'Pago', tom: 'ok' };
}
const SIT_COBRANCA = ['aprovada', 'devolvida_parcial', 'devolvida', 'contestada'];
// Resposta de pag_clinic_statement → { tipo: 'ok', de, ate, linhas, totais } | { tipo: 'forbidden' | 'invalid' } | null.
export function normalizeExtrato(raw) {
  if (!obj(raw)) return null;
  if (raw.status === 'forbidden' || raw.status === 'invalid') return { tipo: raw.status };
  if (raw.status !== 'ok' || !Array.isArray(raw.linhas) || !obj(raw.totais)) return null;
  const linhas = raw.linhas.filter(obj).map((l) => ({
    dia: isIsoDay(l.dia) ? l.dia : '',
    cobranca: typeof l.cobranca === 'string' && /^[0-9a-f]{8}$/.test(l.cobranca) ? l.cobranca : '',
    meio: typeof l.meio === 'string' ? l.meio : '',
    situacao: SIT_COBRANCA.includes(l.situacao) ? l.situacao : '',
    exam_code: typeof l.exam_code === 'string' ? l.exam_code : '',
    starts_at: typeof l.starts_at === 'string' && !Number.isNaN(Date.parse(l.starts_at)) ? l.starts_at : '',
    preco_cents: int(l.preco_cents), taxa_cents: int(l.taxa_cents), clinica_cents: int(l.clinica_cents), devolvido_cents: int(l.devolvido_cents),
    previsao: isIsoDay(l.previsao) ? l.previsao : '',
  }));
  const t = raw.totais;
  return {
    tipo: 'ok', de: isIsoDay(raw.de) ? raw.de : '', ate: isIsoDay(raw.ate) ? raw.ate : '', linhas,
    totais: { valor_cents: int(t.valor_cents), taxa_cents: int(t.taxa_cents), clinica_cents: int(t.clinica_cents), devolvido_cents: int(t.devolvido_cents),
      taxa_devolvida_cents: int(t.taxa_devolvida_cents), clinica_devolvida_cents: int(t.clinica_devolvida_cents), cobrancas: int(t.cobrancas) },
  };
}
export const exameTexto = (l) => (l.exam_code ? examLabel(l.exam_code) : 'Exame');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
// Os totais do período, como o banco somou (nenhuma conta feita aqui).
export function totaisItens(t) {
  const dev = isNum(t.devolvido_cents) && t.devolvido_cents > 0;
  return [
    { id: 'pago', label: 'Pago pelos pacientes', value: fmtBRL(t.valor_cents), sub: isNum(t.cobrancas) ? plural(t.cobrancas, 'pagamento pelo site', 'pagamentos pelo site') : '' },
    { id: 'clinica', label: 'Parte da clínica', value: fmtBRL(t.clinica_cents), sub: dev && isNum(t.clinica_devolvida_cents) ? `${fmtBRL(t.clinica_devolvida_cents)} voltaram para os pacientes` : 'vai para a conta da clínica no meio de pagamento' },
    { id: 'taxa', label: 'Taxa do IMED', value: fmtBRL(t.taxa_cents), sub: dev && isNum(t.taxa_devolvida_cents) ? `${fmtBRL(t.taxa_devolvida_cents)} voltaram para os pacientes` : 'sobre os exames pagos pelo site' },
    { id: 'devolvido', label: 'Devolvido aos pacientes', value: fmtBRL(t.devolvido_cents), sub: 'no total, do que foi pago no período' },
  ];
}
// Frase curta do período (lida pelo leitor de tela quando o extrato chega).
export function resumoExtrato(d) {
  const per = d.de && d.ate ? `de ${fmtDia(d.de)} a ${fmtDia(d.ate)}` : 'do período';
  if (!d.linhas.length) return `Nenhum pagamento pelo site ${per}.`;
  return `${plural(d.linhas.length, 'exame pago', 'exames pagos')} pelo site ${per}: ${fmtBRL(d.totais.valor_cents)} pagos pelos pacientes, ${fmtBRL(d.totais.clinica_cents)} para a clínica.`;
}
// Respostas que não são "ok", em linguagem simples.
export const AVISOS = {
  forbidden: 'Sua conta não tem permissão para ver o financeiro desta clínica.',
  invalid: 'O banco não aceitou este período. Escolha outras datas e tente de novo.',
  estranho: 'O banco respondeu de um jeito que esta tela não entende. Tente de novo em instantes.',
};
