// Painel de gestão do IMED (gestao.html, só para a equipe do IMED): regras puras, sem página.
// - formatação: R$ (Intl pt-BR), números, porcentagens, datas e horas no fuso de São Paulo;
// - a resposta de public.admin_gestao arrumada para mostrar (o que o banco não consegue calcular fica null e a tela
//   mostra "—"; zero continua zero: nada é inventado);
// - "Agora": a fila da teleconsulta neste momento (chave "agora" de admin_gestao), com os 4 números do bloco, a hora
//   deles (e há quanto tempo chegaram) e a frase curta para o leitor de tela;
// - gráficos em SVG feitos à mão, sem biblioteca: linhas (a série por dia), colunas (por dia; somadas por semana no
//   período longo) e colunas agrupadas (faturamento por mês) e barras horizontais (funil e situações). Cada um sai com
//   role="img" e um resumo em aria-label; a página põe ao lado uma tabela com os mesmos números ("Ver em tabela");
// - fluxograma da entrada de médicos (HTML), planilha CSV das cobranças e validação do formulário "Nova cobrança".
// - "Agenda das clínicas" (central do IMED, iMed Agenda 4.4; a tela fica em gestao-central.js): as respostas das funções
//   agenda_central_* arrumadas para mostrar, os nomes em português de cada código (o que o banco manda é só código) e a
//   validação dos formulários (feriado nacional, parâmetro, papel da equipe, filtros da auditoria).
// Roda no navegador (gestao.js) e no Node (tests/gestao.test.mjs). Nada aqui busca dados: os números vêm das funções
// do banco public.admin_gestao e public.admin_cobranca_*, que conferem no servidor se a conta é da equipe do IMED.
import { niceTicks } from './estatisticas.js';
import { MODE_LABEL, CONFLICT_KIND, JUSTIFICATIONS, ROLE_LABEL, EMAIL_RE, tzLabel, fmtWhen, NOTIFY_STATUS, NOTIFY_EVENT, NOTIFY_CHANNEL } from './agenda-core.js';

export const DASH = '—';
export const TZ = 'America/Sao_Paulo';
export const CFM_URL = 'https://portal.cfm.org.br/busca-medicos/';
export const PERIODOS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '12 meses']];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/* ======================= números e dinheiro ======================= */
const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const DEC1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BRL_CURTO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 });

// Contagem (1.234). Sem número: "—".
export const fmtInt = (n) => (isNum(n) ? INT.format(Math.round(n)) : DASH);
// Centavos → "R$ 1.234,56" (com o espaço fixo do Intl entre "R$" e o número). Sem número: "—".
export const fmtBRL = (cents) => (isNum(cents) ? BRL.format(Math.round(cents) / 100) : DASH);
// Reais → "R$ 2,5 mil" (para o eixo do gráfico).
export const fmtBRLCurto = (reais) => (isNum(reais) ? BRL_CURTO.format(reais) : DASH);

// Porcentagem de a sobre b (0 a 100 ou mais). null quando não dá para calcular (sem número ou b zero).
export function pct(a, b) {
  if (!isNum(a) || !isNum(b) || b <= 0) return null;
  return (a / b) * 100;
}
// 40 → "40%", 2,5 → "2,5%", 99,6 → "99,6%", 0,01 → "menos de 0,1%".
// Quase tudo nunca vira "100%": de 99 a 100 corta na primeira casa (99,96 → "99,9%").
export function fmtPct(p) {
  if (!isNum(p)) return DASH;
  if (p > 0 && p < 0.05) return 'menos de 0,1%';
  if (p > 99 && p < 100) return `${DEC1.format(Math.min(99.9, Math.floor(Math.round(p * 1e6) / 1e5) / 10))}%`;
  const casas = p > 0 && p < 10 ? 1 : 0;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas }).format(p)}%`;
}
// Minutos (média) → "8 min", "1 h 05 min".
export function fmtMin(m) {
  if (!isNum(m) || m < 0) return DASH;
  if (m < 1) return 'menos de 1 min';
  const t = Math.round(m);
  if (t < 60) return `${t} min`;
  const h = Math.floor(t / 60);
  const r = t % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')} min` : `${h} h`;
}
// Horas (média até aprovar o médico) → "5 horas", "2,5 dias".
export function fmtHoras(h) {
  if (!isNum(h) || h < 0) return DASH;
  if (h < 1) return 'menos de 1 hora';
  if (h < 48) { const r = Math.round(h); return `${r} ${r === 1 ? 'hora' : 'horas'}`; }
  return `${DEC1.format(Math.round((h / 24) * 10) / 10)} dias`;
}
// Média das avaliações (1 a 5) → "4,7 de 5".
export const fmtNota = (m) => (isNum(m) ? `${DEC1.format(m)} de 5` : DASH);
export const plural = (n, um, varios) => `${fmtInt(n)} ${n === 1 ? um : varios}`;

// Valor digitado em reais ("150", "150,00", "1.234,56", "R$ 99,9", "1234.5") → centavos inteiros.
// null quando vazio; NaN quando não é um valor (letras, mais de 2 casas, sinal de menos, pontos fora do lugar).
export function parseReais(v) {
  let s = String(v ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    // vírgula nas casas: ponto só separando milhar antes dela ("1.234,56")
    if (!/^(\d{1,3}(\.\d{3})+|\d+),\d{1,2}$/.test(s)) return NaN;
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}
// Centavos → "1234,56" (planilha: sem separador de milhar, vírgula nas casas).
export const centsPlanilha = (c) => `${Math.trunc(c / 100)},${String(Math.abs(Math.round(c)) % 100).padStart(2, '0')}`;
// Como o valor digitado vai ficar ("Vai registrar R$ 1.500,00."): "1.500" e "1.50" ficam bem diferentes antes de salvar.
// Vazio ou inválido: "" (o erro aparece ao registrar).
export function previaValor(v) {
  const c = parseReais(v);
  return isNum(c) && c >= VALOR_MIN && c <= VALOR_MAX ? `Vai registrar ${fmtBRL(c)}.` : '';
}

/* ======================= datas (fuso de São Paulo) ======================= */
const DIA_SP = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const DATA_SP = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const HORA_SP = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const todaySP = (now = Date.now()) => DIA_SP.format(new Date(now));

// "2026-10-30" de verdade (sem 30 de fevereiro).
export function isIsoDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}
export const shortDay = (iso) => (isIsoDay(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : DASH);
export const fullDay = (iso) => (isIsoDay(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : DASH);
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const weekDay = (iso) => (isIsoDay(iso) ? `${SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()]}, ${fullDay(iso)}` : DASH);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const monthLabel = (ym) => { const m = MES_RE.exec(String(ym ?? '')); return m ? `${MESES[Number(m[2]) - 1]}/${m[1].slice(2)}` : String(ym ?? ''); };
export const monthLong = (ym) => { const m = MES_RE.exec(String(ym ?? '')); return m ? `${MESES_LONGOS[Number(m[2]) - 1]} de ${m[1]}` : String(ym ?? ''); };
// "2026-10-29T12:00:00Z" → "29/10/2026 às 09:00" (horário de São Paulo).
export function fmtDateTime(iso) {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return DASH;
  return `${DATA_SP.format(new Date(t))} às ${HORA_SP.format(new Date(t))}`;
}
const dateTimePlanilha = (iso) => { const t = Date.parse(iso); return !iso || Number.isNaN(t) ? '' : `${DATA_SP.format(new Date(t))} ${HORA_SP.format(new Date(t))}`; };
export const fmtHora = (iso) => { const t = Date.parse(iso); return !iso || Number.isNaN(t) ? DASH : HORA_SP.format(new Date(t)); };
// Data do pagamento. Informada só com o dia ("Pago em" de outro dia), o banco grava a meia-noite de São Paulo: aparece
// só o dia, sem uma hora que ninguém informou ("25/10/2026"); paga "hoje", com a hora ("30/10/2026 às 12:00").
const HMS_SP = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const soDia = (t) => HMS_SP.format(new Date(t)) === '00:00:00';
export function fmtPagoEm(iso) {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return DASH;
  return soDia(t) ? DATA_SP.format(new Date(t)) : fmtDateTime(iso);
}
const pagoEmPlanilha = (iso) => { const t = Date.parse(iso); return !iso || Number.isNaN(t) ? '' : soDia(t) ? DATA_SP.format(new Date(t)) : dateTimePlanilha(iso); };
// Há quanto tempo: "há 5 min", "há 3 h", "há 2 dias".
export function sinceText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 60) return min < 1 ? 'agora há pouco' : `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

/* ======================= nomes ======================= */
// Situações do pedido (admin_gestao); presente, faltou e remarcação vêm da agenda nova (iMed Agenda 3.3/3.4).
export const PEDIDO_STATUS = [['pendente', 'Pendente'], ['contatado', 'Contatado'], ['confirmado', 'Confirmado'], ['presente', 'Paciente presente'], ['concluido', 'Concluído'], ['faltou', 'Não compareceu'], ['remarcacao', 'Remarcação solicitada'], ['cancelado', 'Cancelado']];
export const TELE_STATUS = [['aguardando', 'Na fila'], ['aceita', 'Aceita pelo médico'], ['em_atendimento', 'Em atendimento'], ['encerrada', 'Encerrada'], ['cancelada', 'Cancelada'], ['expirada', 'Expirada']];
// Os mesmos tipos de documento da teleconsulta (tele-docs.js); o teste confere que nenhum fica sem nome.
export const DOC_TIPOS = [['exames', 'Pedido de exames'], ['receita', 'Receita'], ['atestado', 'Atestado'], ['comparecimento', 'Comparecimento'], ['encaminhamento', 'Encaminhamento'], ['relatorio', 'Relatório'], ['orientacoes', 'Orientações']];
export const COB_TIPOS = [['teleconsulta', 'Teleconsulta'], ['mensalidade_clinica', 'Mensalidade de clínica'], ['comissao_clinica', 'Comissão de clínica'], ['outro', 'Outro']];
export const PAGADORES = [['paciente', 'Paciente'], ['clinica', 'Clínica'], ['medico', 'Médico'], ['outro', 'Outro']];
export const COB_STATUS = [['pendente', 'Pendente'], ['pago', 'Paga'], ['cancelado', 'Cancelada']];
export const FORMAS = [['pix', 'Pix'], ['cartao', 'Cartão'], ['boleto', 'Boleto'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência'], ['outro', 'Outra']];
// Filtro da tabela: "Atrasadas" são as pendentes com vencimento antes de hoje (o banco devolve as pendentes).
export const COB_FILTROS = [['', 'Todas'], ['pendente', 'Pendentes'], ['atrasada', 'Atrasadas'], ['pago', 'Pagas'], ['cancelado', 'Canceladas']];
export const VALOR_MIN = 1;
export const VALOR_MAX = 100000000;
const keys = (list) => new Set(list.map(([k]) => k));
const TIPO_OK = keys(COB_TIPOS);
const PAGADOR_OK = keys(PAGADORES);
export const labelOf = (list, key) => (list.find(([k]) => k === key)?.[1] ?? String(key ?? ''));

// Etapas dos funis (as chaves de "funil" do banco). As três primeiras de cada um são páginas abertas.
export const FUNIL_AGENDA = [['abriram_busca', 'Abriram a busca (Perto de mim)'], ['abriram_local', 'Abriram a página de um local'], ['pedidos', 'Pediram agendamento'], ['confirmados', 'Pedido confirmado'], ['concluidos', 'Atendimento concluído']];
export const FUNIL_TELE = [['abriram_tele', 'Abriram a teleconsulta'], ['tele_fila', 'Entraram na fila'], ['tele_atendidas', 'Atendidas por um médico'], ['tele_encerradas', 'Consulta encerrada'], ['tele_com_documento', 'Com documento emitido']];
// Séries do gráfico "Atendimentos por dia" (as visitas vão em outro gráfico, com a escala delas).
export const SERIES_ATEND = [['pedidos', 'Pedidos de agendamento'], ['tele_pedidas', 'Teleconsultas pedidas'], ['tele_encerradas', 'Teleconsultas encerradas'], ['documentos', 'Documentos emitidos']];

/* ======================= resposta do banco ======================= */
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v) => (v === null || v === undefined ? '' : String(v));
// Número que dá para mostrar (zero ou mais). Qualquer outra coisa (null, texto, negativo, NaN) vira null → "—".
export function num(v) {
  if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
const pick = (o, list) => Object.fromEntries(list.map((k) => [k, num(o[k])]));
const SERIE_KEYS = ['visitas', 'pedidos', 'tele_pedidas', 'tele_encerradas', 'documentos'];
const PED_KEYS = ['total', 'pendente', 'contatado', 'confirmado', 'cancelado', 'concluido', 'presente', 'faltou', 'remarcacao', 'parceiro', 'concierge'];
const TELE_KEYS = ['total', 'aguardando', 'aceita', 'em_atendimento', 'encerrada', 'cancelada', 'expirada', 'espera_media_min', 'duracao_media_min'];
const FUNIL_KEYS = ['visitas', ...FUNIL_AGENDA.map(([k]) => k), ...FUNIL_TELE.map(([k]) => k)];
const MED_KEYS = ['inscritos_periodo', 'pendente', 'aprovado', 'recusado', 'suspenso', 'disponiveis_agora', 'aprovacao_media_horas'];
const CLI_KEYS = ['parceiras', 'com_agenda', 'com_preco', 'interessadas'];
const COB_KEYS = ['faturado_cents', 'a_receber_cents', 'atrasado_cents', 'cancelado_cents', 'qtd_pagas', 'qtd_pendentes'];

// Resposta de admin_gestao → o que a tela mostra. Tolera campo faltando ou fora do formato (vira null, "—").
export function normalizeGestao(raw, dias = 30) {
  const r = obj(raw);
  const pac = obj(r.pacientes);
  const docs = obj(pac.documentos);
  const av = obj(pac.avaliacoes);
  const med = obj(r.medicos);
  const cli = obj(r.clinicas);
  const cob = obj(r.cobranca);
  // Série: um item por dia, em ordem e sem repetir o dia.
  const seen = new Set();
  const serie = (Array.isArray(r.serie) ? r.serie : [])
    .filter((x) => x && isIsoDay(x.dia) && !seen.has(x.dia) && seen.add(x.dia))
    .map((x) => ({ dia: x.dia, ...pick(x, SERIE_KEYS) }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
  const porTipo = {};
  for (const [k, v] of Object.entries(obj(docs.por_tipo))) if (/^[a-z_]{1,40}$/.test(k)) porTipo[k] = num(v);
  const media = num(av.media);
  const nDias = num(r.dias);
  const seenMes = new Set();
  return {
    dias: Number.isInteger(nDias) && nDias > 0 ? nDias : dias,
    de: isIsoDay(r.de) ? r.de : serie[0]?.dia ?? null,
    ate: isIsoDay(r.ate) ? r.ate : serie.at(-1)?.dia ?? null,
    gerado_em: r.gerado_em && !Number.isNaN(Date.parse(r.gerado_em)) ? String(r.gerado_em) : null,
    serie,
    pacientes: {
      atendidos: num(pac.atendidos),
      pedidos: pick(obj(pac.pedidos), PED_KEYS),
      tele: pick(obj(pac.tele), TELE_KEYS),
      documentos: { total: num(docs.total), por_tipo: porTipo, cancelados: num(docs.cancelados), pdf_assinado: num(docs.pdf_assinado) },
      avaliacoes: { total: num(av.total), media: media !== null && media <= 5 ? media : null },
    },
    funil: pick(obj(r.funil), FUNIL_KEYS),
    medicos: {
      ...pick(med, MED_KEYS),
      aguardando: (Array.isArray(med.aguardando) ? med.aguardando : []).filter((d) => d && typeof d === 'object').slice(0, 50).map((d) => ({
        id: str(d.id), nome: str(d.nome).trim(), crm: str(d.crm).trim(), uf: str(d.uf).trim().toUpperCase().slice(0, 2),
        especialidade: d.especialidade === null || d.especialidade === undefined || !String(d.especialidade).trim() ? null : String(d.especialidade).trim(),
        desde: d.desde && !Number.isNaN(Date.parse(d.desde)) ? String(d.desde) : null,
      })),
    },
    clinicas: { ...pick(cli, CLI_KEYS), reivindicacoes: pick(obj(cli.reivindicacoes), ['pendente', 'aprovado', 'recusado']) },
    outros: pick(obj(r.outros), ['lista_espera', 'contatos', 'avisos_de_erro']),
    cobranca: {
      ...pick(cob, COB_KEYS),
      por_mes: (Array.isArray(cob.por_mes) ? cob.por_mes : [])
        .filter((x) => x && MES_RE.test(String(x.mes)) && !seenMes.has(x.mes) && seenMes.add(x.mes))
        .map((x) => ({ mes: x.mes, faturado_cents: num(x.faturado_cents), a_receber_cents: num(x.a_receber_cents) }))
        .sort((a, b) => a.mes.localeCompare(b.mes)),
    },
    agora: normalizeAgora(r.agora),
  };
}

/* ======================= agora: a teleconsulta neste momento ======================= */
// Chave "agora" de admin_gestao (migração 20261030191354_painel_medico; a mesma conta do painel do médico): pacientes
// na fila agora, há quantos minutos espera o primeiro da fila, consultas em atendimento e médicos disponíveis. Não
// depende do período escolhido. Só estas 4 contagens passam daqui para a tela (LGPD, só o necessário: nada de nome,
// idade ou motivo de paciente, mesmo que a resposta trouxesse mais alguma coisa).
// Banco ainda sem a migração (sem a chave), chave fora do formato ou sem nenhum número: null (a página não mostra o
// bloco e o resto do painel segue igual).
export const AGORA_KEYS = ['aguardando', 'espera_mais_longa_min', 'em_atendimento', 'medicos_disponiveis'];
export function normalizeAgora(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const a = pick(v, AGORA_KEYS);
  if (AGORA_KEYS.every((k) => a[k] === null)) return null;
  // Ninguém na fila: não há espera (o banco manda null; um número aqui não seria a espera de ninguém).
  if (a.aguardando === 0) a.espera_mais_longa_min = null;
  return a;
}
// Médico disponível = aprovado com o "Disponível para atender" ligado na área do médico (a mesma regra de
// tele_doctors_online). Ter a página aberta não basta, e aceitar um paciente não desliga o "Disponível": o número pode
// incluir médico ocupado numa consulta.
// Destaque: há paciente esperando e nenhum médico disponível (ninguém atende até um médico ligar o "Disponível"). Com
// médicos disponíveis não há destaque, mesmo que talvez estejam todos em consulta (o banco não diz quem está livre).
export const agoraSemMedico = (a) => isNum(a?.aguardando) && a.aguardando > 0 && a.medicos_disponiveis === 0;
// Número e unidade juntos: se precisar quebrar a linha, "1 h 59 min" vira "1 h" e "59 min" (nunca "1 h 59" e "min").
const juntaUnidade = (s) => s.replace(/(\d) (h|min)\b/g, '$1\u00a0$2');
// Os 4 números do bloco, na ordem da tela (sem número: "—"; zero é zero). warn: em destaque. A explicação embaixo do
// número fica no singular quando ele é 1 ("1 / paciente na fila", nunca "1 / pacientes na fila").
export function agoraItens(a) {
  const x = obj(a);
  const sp = (n, um, varios) => (n === 1 ? um : varios);
  return [
    { id: 'agora-aguardando', label: 'Aguardando atendimento', value: fmtInt(x.aguardando), sub: `${sp(x.aguardando, 'paciente', 'pacientes')} na fila, esperando um médico aceitar`, warn: agoraSemMedico(x) },
    { id: 'agora-espera', label: 'Espera mais longa', value: juntaUnidade(fmtMin(x.espera_mais_longa_min)), sub: x.aguardando === 0 ? 'ninguém na fila agora' : 'do primeiro paciente da fila', warn: false },
    { id: 'agora-atendimento', label: 'Em atendimento', value: fmtInt(x.em_atendimento), sub: sp(x.em_atendimento, 'consulta aceita por um médico ou em andamento', 'consultas aceitas por um médico ou em andamento'), warn: false },
    { id: 'agora-medicos', label: 'Médicos disponíveis', value: fmtInt(x.medicos_disponiveis), sub: sp(x.medicos_disponiveis, 'aprovado com o “Disponível” ligado (pode estar em consulta)', 'aprovados com o “Disponível” ligado (pode incluir quem está em consulta)'), warn: false },
  ];
}
// Hora dos números de "agora" (no alto do bloco): a do banco (gerado_em), nunca a do relógio daqui. idadeMs: há quanto
// tempo a página recebeu os números, medido aqui pela diferença entre dois Date.now() (relógio do aparelho adiantado
// ou atrasado não muda a conta). "Atualizado às 12:00"; com 2 min ou mais: "Atualizado às 12:00 (há 5 min)"; se já é
// outro dia em São Paulo, com a data: "Atualizado em 29/10 às 23:50 (há 3 h)". Sem a hora do banco: "".
export const AGORA_VELHO_MIN = 2;
export function agoraHora(geradoEm, idadeMs = 0) {
  const t = Date.parse(geradoEm);
  if (!geradoEm || Number.isNaN(t)) return '';
  const idade = isNum(idadeMs) && idadeMs > 0 ? idadeMs : 0;
  const dia = todaySP(t);
  const hora = HORA_SP.format(new Date(t));
  const base = todaySP(t + idade) === dia ? `Atualizado às ${hora}` : `Atualizado em ${shortDay(dia)} às ${hora}`;
  return idade >= AGORA_VELHO_MIN * 60000 ? `${base} (${sinceText(geradoEm, t + idade)})` : base;
}
// Minutos por extenso, para o leitor de tela: "menos de 1 minuto", "12 minutos", "1 hora e 5 minutos", "2 horas".
export function fmtMinFala(m) {
  if (!isNum(m) || m < 0) return '';
  if (m < 1) return 'menos de 1 minuto';
  const t = Math.round(m);
  const min = (n) => `${n} ${n === 1 ? 'minuto' : 'minutos'}`;
  if (t < 60) return min(t);
  const h = Math.floor(t / 60);
  const r = t % 60;
  return `${h} ${h === 1 ? 'hora' : 'horas'}${r ? ` e ${min(r)}` : ''}`;
}
// Frase curta do bloco para o leitor de tela (a página põe numa região aria-live educada, fora do bloco, só quando os
// números mudam com a página aberta):
// "Agora: 3 pacientes aguardando atendimento (o primeiro espera há 12 minutos), 1 consulta em atendimento e nenhum
// médico disponível." Sem número: "sem o número de …" (nada inventado). Sem o bloco: "".
export function agoraTexto(a) {
  if (!a || typeof a !== 'object') return '';
  const n = a.aguardando;
  const esp = fmtMinFala(a.espera_mais_longa_min);
  const fila = !isNum(n) ? `sem o número de pacientes aguardando${esp ? ` (o primeiro da fila espera há ${esp})` : ''}`
    : n === 0 ? 'nenhum paciente aguardando atendimento'
      : `${plural(n, 'paciente aguardando', 'pacientes aguardando')} atendimento${esp ? ` (${n === 1 ? 'espera' : 'o primeiro espera'} há ${esp})` : ''}`;
  const em = a.em_atendimento;
  const atend = !isNum(em) ? 'sem o número de consultas em atendimento' : em === 0 ? 'nenhuma consulta em atendimento' : `${plural(em, 'consulta', 'consultas')} em atendimento`;
  const md = a.medicos_disponiveis;
  const med = !isNum(md) ? 'sem o número de médicos disponíveis' : md === 0 ? 'nenhum médico disponível' : plural(md, 'médico disponível', 'médicos disponíveis');
  return `Agora: ${lista([fila, atend, med])}.`;
}

// Soma de uma coluna da série (null se nenhum dia tiver o número).
export function somaSerie(serie, key) {
  const vals = serie.map((x) => x[key]).filter(isNum);
  return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
}

// Período longo (mais de SEMANAL_DESDE dias): as colunas somam semanas (365 colunas de um dia não cabem no celular;
// a tabela continua dia a dia). Semanas de 7 dias contadas do dia mais novo para trás; os dias que sobram (menos de 7)
// entram na semana mais antiga, que fica com 8 a 13 dias (o balão diz quantos). Nenhum número na semana: null ("—").
export const SEMANAL_DESDE = 90;
const DIA_MS = 86400000;
const diaNum = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DIA_MS;
const isoDia = (n) => new Date(n * DIA_MS).toISOString().slice(0, 10);
export function porSemana(serie, keys = SERIE_KEYS) {
  const s = (Array.isArray(serie) ? serie : []).filter((x) => x && isIsoDay(x.dia));
  if (!s.length) return [];
  const nums = s.map((x) => diaNum(x.dia));
  const first = Math.min(...nums);
  const last = Math.max(...nums);
  const n = Math.max(1, Math.floor((last - first + 1) / 7));
  const semanas = Array.from({ length: n }, (_, k) => {
    const ate = last - (n - 1 - k) * 7;
    const de = k === 0 ? first : ate - 6;
    return { de: isoDia(de), ate: isoDia(ate), dias: ate - de + 1, itens: [] };
  });
  s.forEach((x, i) => { semanas[n - 1 - Math.min(n - 1, Math.floor((last - nums[i]) / 7))].itens.push(x); });
  return semanas.map(({ itens, ...b }) => ({ ...b, ...Object.fromEntries(keys.map((k) => [k, somaSerie(itens, k)])) }));
}
// Balão de uma semana: "Semana de 24/10/2026 a 30/10/2026" (a mais antiga diz quantos dias tem).
export const semanaTip = (b) => `Semana de ${fullDay(b.de)} a ${fullDay(b.ate)}${b.dias !== 7 ? ` (${b.dias} dias)` : ''}`;

// Funil: cada etapa com a % sobre a etapa anterior e sobre a primeira (null quando não dá para calcular).
export function funnel(steps) {
  return steps.map((s, i) => ({
    ...s,
    pctPrev: i ? pct(s.value, steps[i - 1].value) : null,
    pctFirst: i ? pct(s.value, steps[0].value) : isNum(s.value) && s.value > 0 ? 100 : null,
  }));
}

/* ======================= gráficos em SVG ======================= */
// Largura aproximada de um texto (Inter): basta para reservar espaço e não deixar rótulo sair do desenho.
export const textW = (s, size = 12, bold = false) => String(s).length * size * (bold ? 0.62 : 0.58);
const r1 = (n) => Math.round(n * 10) / 10;
const svgOpen = (W, H, label, cls = '') => `<svg class="gs-svg${cls ? ` ${cls}` : ''}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">`;
// Texto do eixo de baixo que não passa da borda do desenho. Devolve o texto e onde ele ocupa (esquerda e direita).
function xLabelBox(x, text, W, size = 11.5) {
  const w = textW(text, size);
  if (x - w / 2 < 1) { const at = Math.max(1, x - 4); return { anchor: 'start', at, l: at, r: at + w }; }
  if (x + w / 2 > W - 1) { const at = Math.min(W - 1, x + 4); return { anchor: 'end', at, l: at - w, r: at }; }
  return { anchor: 'middle', at: x, l: x - w / 2, r: x + w / 2 };
}
function xLabel(x, y, text, W, size = 11.5, cls = 'gs-tick') {
  const b = xLabelBox(x, text, W, size);
  return `<text class="${cls}" x="${r1(b.at)}" y="${y}" text-anchor="${b.anchor}">${esc(text)}</text>`;
}
// Rótulos do eixo de baixo: um a cada `step` pontos contando do mais novo (que sempre aparece); o que encostaria no
// rótulo seguinte (o do canto, empurrado para caber) fica de fora.
function xLabels(xs, texts, step, y, W) {
  let out = '';
  let limite = Infinity;
  for (let i = xs.length - 1; i >= 0; i -= 1) {
    if ((xs.length - 1 - i) % step !== 0) continue;
    const b = xLabelBox(xs[i], texts[i], W);
    if (b.r + 8 > limite) continue;
    out = `<text class="gs-tick" x="${r1(b.at)}" y="${y}" text-anchor="${b.anchor}">${esc(texts[i])}</text>${out}`;
    limite = b.l;
  }
  return out;
}
// Quais rótulos do eixo de baixo aparecem: no máximo um a cada `minGap` px, sempre o último (o dia mais novo).
export function labelStep(n, plotW, minGap = 56) {
  if (n <= 1) return 1;
  const cabem = Math.max(2, Math.floor(plotW / minGap));
  return Math.max(1, Math.ceil(n / cabem));
}
// Coluna (ou barra) com 4 px arredondados só na ponta do dado; reta na linha de base.
function colPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${r1(x)} ${r1(y + h)}V${r1(y + r)}Q${r1(x)} ${r1(y)} ${r1(x + r)} ${r1(y)}H${r1(x + w - r)}Q${r1(x + w)} ${r1(y)} ${r1(x + w)} ${r1(y + r)}V${r1(y + h)}Z`;
}
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h / 2);
  return `M${r1(x)} ${r1(y)}H${r1(x + w - r)}Q${r1(x + w)} ${r1(y)} ${r1(x + w)} ${r1(y + r)}V${r1(y + h - r)}Q${r1(x + w)} ${r1(y + h)} ${r1(x + w - r)} ${r1(y + h)}H${r1(x)}Z`;
}
// Eixo de valores: linhas de grade finas e os números à esquerda. Devolve a escala e o espaço usado.
function yAxis(maxVal, tickFmt, H, padT, padB) {
  const ticks = niceTicks(maxVal);
  const top = ticks[ticks.length - 1] || 1;
  const labels = ticks.map((t) => tickFmt(t));
  const padL = Math.ceil(Math.max(...labels.map((t) => textW(t, 11.5)))) + 10;
  const ph = H - padT - padB;
  const y = (v) => padT + ph - (Math.min(v, top) / top) * ph;
  return { ticks, labels, top, padL, ph, y };
}
function gridSvg(ax, x0, x1) {
  return ax.ticks.map((t, i) => `<line class="${t ? 'gs-grid' : 'gs-base'}" x1="${r1(x0)}" x2="${r1(x1)}" y1="${r1(ax.y(t))}" y2="${r1(ax.y(t))}"/>`
    + `<text class="gs-tick" x="${r1(x0 - 6)}" y="${r1(ax.y(t) + 4)}" text-anchor="end">${esc(ax.labels[i])}</text>`).join('');
}

// Linhas por dia. series: [{ label, cls: 'gs-c1', values: [n|null, ...] }], um valor por dia de `days`.
// area: preenche de leve embaixo (só para uma série). peak: escreve o número do dia com mais.
// Cada dia tem uma faixa invisível (data-tip) que mostra todos os números daquele dia ao passar o mouse.
export function lineSvg({ width = 640, height = 220, days = [], series = [], label = '', fmt = fmtInt, area = false, peak = false } = {}) {
  const W = Math.max(240, Math.round(width));
  const H = Math.max(140, Math.round(height));
  const n = days.length;
  const vals = series.flatMap((s) => s.values.filter(isNum));
  const max = vals.length ? Math.max(...vals) : 0;
  const padT = peak ? 22 : 12;
  const padB = 26;
  const padR = 10;
  const ax = yAxis(max, fmt, H, padT, padB);
  const pw = W - ax.padL - padR;
  const x = (i) => ax.padL + (n <= 1 ? pw / 2 : (i * pw) / (n - 1));
  let out = svgOpen(W, H, label) + gridSvg(ax, ax.padL, W - padR);
  // eixo de baixo
  out += xLabels(days.map((_, i) => x(i)), days.map(shortDay), labelStep(n, pw), H - 7, W);
  // linhas (um valor sem número interrompe a linha)
  const dots = n > 0 && n <= 31 && (n === 1 || pw / (n - 1) >= 14);
  for (const s of series) {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => { if (!isNum(v)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${r1(x(i))} ${r1(ax.y(v))}`; pen = true; });
    if (area && series.length === 1 && d && s.values.every(isNum) && n > 1) {
      out += `<path class="gs-area ${esc(s.cls)}" d="${d}L${r1(x(n - 1))} ${r1(ax.y(0))}L${r1(x(0))} ${r1(ax.y(0))}Z"/>`;
    }
    if (d) out += `<path class="gs-line ${esc(s.cls)}" d="${d}"/>`;
    if (dots) s.values.forEach((v, i) => { if (isNum(v)) out += `<circle class="gs-dot ${esc(s.cls)}" cx="${r1(x(i))}" cy="${r1(ax.y(v))}" r="4"/>`; });
  }
  // o dia com mais (uma série só): o número em cima do ponto
  if (peak && series.length === 1 && max > 0) {
    const v = series[0].values;
    const i = v.lastIndexOf(max);
    out += xLabel(x(i), r1(ax.y(max) - 9), fmt(max), W, 12, 'gs-peak');
  }
  // faixas para o mouse (uma por dia)
  for (let i = 0; i < n; i += 1) {
    const a = i === 0 ? ax.padL : (x(i - 1) + x(i)) / 2;
    const b = i === n - 1 ? W - padR : (x(i) + x(i + 1)) / 2;
    const tip = [weekDay(days[i]), ...series.map((s) => `${s.label}: ${fmt(s.values[i])}`)].join('\n');
    out += `<rect class="gs-hit" x="${r1(a)}" y="${padT}" width="${r1(Math.max(1, b - a))}" height="${r1(ax.ph)}" data-tip="${esc(tip)}"/>`;
  }
  return `${out}</svg>`;
}

// Colunas (uma série: um dia por coluna) ou colunas agrupadas (faturado e a receber por mês).
// cats: [{ label, tip }]; series: [{ label, cls, values }].
// fmt: número no balão; tickFmt: número do eixo.
export function columnsSvg({ width = 640, height = 220, cats = [], series = [], label = '', fmt = fmtInt, tickFmt = fmtInt } = {}) {
  const W = Math.max(240, Math.round(width));
  const H = Math.max(140, Math.round(height));
  const n = cats.length;
  const m = Math.max(1, series.length);
  const vals = series.flatMap((s) => s.values.filter(isNum));
  const max = vals.length ? Math.max(...vals) : 0;
  const padT = 12;
  const padB = 26;
  const padR = 6;
  const ax = yAxis(max, tickFmt, H, padT, padB);
  const pw = W - ax.padL - padR;
  const gw = n ? pw / n : pw;
  const gap = Math.min(2, gw * 0.08);
  const inner = gw - (m - 1) * gap;
  // Coluna de 2 a 24 px; nunca passa de 80% do espaço do dia (ou do mês): vizinhas nunca se encostam, nem com muitas
  // colunas numa tela estreita.
  const bw = Math.min(gw >= 12 ? Math.max(2, Math.min(24, (inner - 8) / m)) : (inner * 0.7) / m, (gw * 0.8 - (m - 1) * gap) / m);
  const cx = (i) => ax.padL + gw * i + gw / 2;
  let out = svgOpen(W, H, label) + gridSvg(ax, ax.padL, W - padR);
  out += xLabels(cats.map((_, i) => cx(i)), cats.map((c) => c.label), labelStep(n, pw, 46), H - 7, W);
  for (let i = 0; i < n; i += 1) {
    const x0 = cx(i) - (m * bw + (m - 1) * gap) / 2;
    series.forEach((s, j) => {
      const v = s.values[i];
      if (!isNum(v) || v <= 0) return;
      const h = Math.max(2, ax.y(0) - ax.y(v));
      out += `<path class="gs-bar ${esc(s.cls)}" d="${colPath(x0 + j * (bw + gap), ax.y(0) - h, bw, h)}"/>`;
    });
    const tip = [cats[i].tip || cats[i].label, ...series.map((s) => `${s.label}: ${fmt(s.values[i])}`)].join('\n');
    out += `<rect class="gs-hit" x="${r1(ax.padL + gw * i)}" y="${padT}" width="${r1(gw)}" height="${r1(ax.ph)}" data-tip="${esc(tip)}"/>`;
  }
  return `${out}</svg>`;
}

// Quebra um rótulo em linhas que cabem na largura, palavra por palavra (sem cortar letra).
export function wrapText(text, maxW, size = 13) {
  const lines = [];
  let cur = '';
  for (const w of String(text ?? '').split(/\s+/).filter(Boolean)) {
    const tentativa = cur ? `${cur} ${w}` : w;
    if (!cur || textW(tentativa, size, true) <= maxW) cur = tentativa;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// Barras deitadas: o nome em cima, a barra embaixo e o número na ponta direita. A barra mede a parte sobre `max`
// (um trilho claro mostra o todo). rows: [{ label, value, extra, cls }]; extra entra depois do número ("40%").
export function hbarsSvg({ width = 640, rows = [], label = '', max = null, fmt = fmtInt } = {}) {
  const W = Math.max(240, Math.round(width));
  const vals = rows.map((r) => r.value).filter(isNum);
  const top = isNum(max) && max > 0 ? max : vals.length ? Math.max(...vals) : 0;
  const texts = rows.map((r) => `${fmt(r.value)}${r.extra ? ` · ${r.extra}` : ''}`);
  const valW = Math.ceil(Math.max(40, ...texts.map((t) => textW(t, 13, true)))) + 10;
  const trackW = Math.max(60, W - valW);
  const BAR = 12;
  let y = 0;
  let body = '';
  rows.forEach((r, i) => {
    const lines = wrapText(r.label, W - 2);
    lines.forEach((ln, k) => { body += `<text class="gs-lab" x="0" y="${y + 14 + k * 16}">${esc(ln)}</text>`; });
    const by = y + 6 + lines.length * 16;
    body += `<rect class="gs-track" x="0" y="${by}" width="${r1(trackW)}" height="${BAR}" rx="4"/>`;
    if (isNum(r.value) && r.value > 0 && top > 0) {
      const w = Math.max(3, (Math.min(r.value, top) / top) * trackW);
      body += `<path class="gs-bar ${esc(r.cls || 'gs-c1')}" d="${barPath(0, by, w, BAR)}"/>`;
    }
    body += `<text class="gs-val" x="${W}" y="${by + BAR - 1}" text-anchor="end">${esc(texts[i])}</text>`;
    const rowH = by + BAR + 10 - y;
    body += `<rect class="gs-hit" x="0" y="${y}" width="${W}" height="${rowH}" data-tip="${esc(`${r.label}: ${texts[i]}`)}"/>`;
    y += rowH;
  });
  const H = Math.max(20, y);
  return `${svgOpen(W, H, label, 'gs-hsvg')}${body}</svg>`;
}

// Mini-curva (sparkline) de um cartão do resumo: a mesma série por dia do gráfico grande, sem eixo nem texto.
// É enfeite feito com dado de verdade: sai com aria-hidden (o número está no cartão; o dia a dia, no gráfico "por dia"
// e na tabela dele). Nada é inventado: menos de 2 pontos com número, ou lugar pequeno demais, não desenha nada (''),
// dia sem número interrompe a linha, e tudo zero vira uma linha reta na base (classe gs-spark-zero).
export const SPARK_MIN_W = 40;
export function sparkSvg({ width = 120, height = 30, values = [], cls = 'gs-c1' } = {}) {
  const W = Math.round(width);
  const H = Math.round(height);
  const v = Array.isArray(values) ? values : [];
  const n = v.length;
  if (!(W >= SPARK_MIN_W) || !(H >= 14) || v.filter(isNum).length < 2) return '';
  const max = Math.max(...v.filter(isNum));
  const pad = 3;
  const x = (i) => pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (val) => (max > 0 ? H - pad - (Math.min(val, max) / max) * (H - 2 * pad) : H - pad);
  let d = '';
  let pen = false;
  let last = -1;
  v.forEach((val, i) => { if (!isNum(val)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${r1(x(i))} ${r1(y(val))}`; pen = true; last = i; });
  let out = `<svg class="gs-spark${max > 0 ? '' : ' gs-spark-zero'}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" focusable="false">`;
  if (max > 0 && v.every(isNum)) out += `<path class="gs-spark-a ${esc(cls)}" d="${d}L${r1(x(n - 1))} ${H}L${r1(x(0))} ${H}Z"/>`;
  out += `<path class="gs-spark-l ${esc(cls)}" d="${d}"/>`;
  out += `<circle class="gs-spark-p ${esc(cls)}" cx="${r1(x(last))}" cy="${r1(y(v[last]))}" r="2.5"/>`;
  return `${out}</svg>`;
}
// Os pontos da mini-curva: um por dia; no período longo, um por semana (a mesma soma das colunas do gráfico grande).
export function sparkValues(serie, key) {
  const s = Array.isArray(serie) ? serie : [];
  return (s.length > SEMANAL_DESDE ? porSemana(s, [key]) : s).map((x) => x[key]);
}

/* ======================= resumos (aria-label dos gráficos) ======================= */
const lista = (itens) => (itens.length > 1 ? `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}` : itens[0] || '');
// Período que passa de um ano para o outro (12 meses): as datas vão com o ano ("de 31/10/2025 a 30/10/2026").
const cruzaAno = (a, b) => isIsoDay(a) && isIsoDay(b) && a.slice(0, 4) !== b.slice(0, 4);
const periodo = (de, ate) => {
  if (!isIsoDay(de) || !isIsoDay(ate)) return 'no período';
  const dia = cruzaAno(de, ate) ? fullDay : shortDay;
  return `de ${dia(de)} a ${dia(ate)}`;
};

// "Pedidos de agendamento por dia, de 01/10 a 30/10: 21 no total; o dia com mais foi 04/10, com 2."
export function resumoSerie(nome, serie, key, de, ate) {
  const total = somaSerie(serie, key);
  const v = serie.map((x) => x[key]);
  const mx = Math.max(0, ...v.filter(isNum));
  const dia = cruzaAno(de, ate) || cruzaAno(serie[0]?.dia, serie.at(-1)?.dia) ? fullDay : shortDay;
  return `${nome} por dia, ${periodo(de, ate)}: ${fmtInt(total)} no total${mx > 0 ? `; o dia com mais foi ${dia(serie[v.lastIndexOf(mx)].dia)}, com ${fmtInt(mx)}` : ''}.`;
}
// Colunas por semana (período longo): "Pedidos de agendamento por semana, de 31/10/2025 a 30/10/2026: 120 no total;
// a semana com mais foi a de 12/10/2026 a 18/10/2026, com 9."
export function resumoSemanas(nome, semanas, key, de, ate) {
  const total = somaSerie(semanas, key);
  const v = semanas.map((x) => x[key]);
  const mx = Math.max(0, ...v.filter(isNum));
  const b = mx > 0 ? semanas[v.lastIndexOf(mx)] : null;
  return `${nome} por semana, ${periodo(de ?? semanas[0]?.de, ate ?? semanas.at(-1)?.ate)}: ${fmtInt(total)} no total${b ? `; a semana com mais foi a de ${fullDay(b.de)} a ${fullDay(b.ate)}, com ${fmtInt(mx)}` : ''}.`;
}
export const resumoVisitas = (serie, de, ate) => resumoSerie('Visualizações de página', serie, 'visitas', de, ate);
export function resumoFunil(titulo, steps) {
  return `${titulo}: ${lista(funnel(steps).map((s, i) => `${s.label.toLowerCase()} ${fmtInt(s.value)}${i ? ` (${fmtPct(s.pctPrev)} da etapa anterior)` : ''}`))}.`;
}
export const resumoBarras = (titulo, rows, fmt = fmtInt) => `${titulo}: ${rows.length ? lista(rows.map((r) => `${r.label.toLowerCase()} ${fmt(r.value)}`)) : 'nenhum'}.`;
export function resumoMeses(porMes) {
  if (!porMes.length) return 'Faturamento por mês: sem meses para mostrar.';
  const fat = somaSerie(porMes, 'faturado_cents');
  const rec = somaSerie(porMes, 'a_receber_cents');
  const v = porMes.map((x) => x.faturado_cents);
  const mx = Math.max(0, ...v.filter(isNum));
  const pico = mx > 0 ? `; o mês com mais faturamento foi ${monthLong(porMes[v.lastIndexOf(mx)].mes)}, com ${fmtBRL(mx)}` : '';
  return `Faturamento por mês, de ${monthLong(porMes[0].mes)} a ${monthLong(porMes.at(-1).mes)}: ${fmtBRL(fat)} faturado e ${fmtBRL(rec)} a receber com vencimento nesses meses${pico}.`;
}

/* ======================= fluxograma da entrada de médicos ======================= */
// Inscrição → Conferência do CRM no CFM → Aprovado → Disponível para atender, com os ramos Recusado (sai da
// conferência) e Suspenso (sai do aprovado). Cada caixa com o número de agora. HTML (o texto quebra sozinho no
// celular); as setas são desenho do CSS. Ordem de leitura: as etapas, cada ramo logo depois da etapa de onde sai.
export function fluxoMedicosHtml(m) {
  const md = m || {};
  const box = (cls, icon, n, title, caption, branch = '') => `<li class="gs-fx ${cls}">
      ${branch ? `<span class="sr">${esc(branch)} </span>` : ''}<span class="gs-fx-ic" aria-hidden="true"><i class="fa-solid ${icon}"></i></span>
      <span class="gs-fx-tx"><b class="gs-fx-n">${esc(fmtInt(n))}</b><span class="gs-fx-t">${esc(title)}</span><small>${esc(caption)}</small></span>
    </li>`;
  const tempo = isNum(md.aprovacao_media_horas) ? `aprovados · em média ${fmtHoras(md.aprovacao_media_horas)} até aprovar` : 'aprovados';
  return `<ol class="gs-flow" aria-label="Fluxograma da entrada de médicos">
    ${box('gs-fs1', 'fa-user-plus', md.inscritos_periodo, 'Inscrição', 'inscritos no período, na área do médico')}
    ${box('gs-fs2', 'fa-id-card', md.pendente, 'Conferência do CRM no CFM', 'aguardando a equipe conferir CRM e identidade')}
    ${box('gs-fb2 gs-fx-no', 'fa-user-xmark', md.recusado, 'Recusado', 'não passaram na conferência', 'Ramo da conferência:')}
    ${box('gs-fs3 gs-fx-ok', 'fa-user-check', md.aprovado, 'Aprovado', tempo)}
    ${box('gs-fb3 gs-fx-warn', 'fa-ban', md.suspenso, 'Suspenso', 'aprovados e depois suspensos', 'Ramo do aprovado:')}
    ${box('gs-fs4', 'fa-user-doctor', md.disponiveis_agora, 'Disponível para atender', isNum(md.disponiveis_agora) ? 'aprovados com o “Disponível” ligado agora (pode incluir quem está em consulta)' : 'sem esse número no banco')}
  </ol>`;
}

// Documentos por tipo, na ordem dos tipos da teleconsulta; um tipo que o site ainda não conhece entra no fim, pelo nome.
export function docRows(porTipo) {
  const pt = obj(porTipo);
  const has = (k) => Object.prototype.hasOwnProperty.call(pt, k);
  const known = DOC_TIPOS.filter(([k]) => has(k)).map(([k, label]) => ({ label, value: num(pt[k]), cls: 'gs-c1' }));
  const extra = Object.keys(pt).filter((k) => !DOC_TIPOS.some(([x]) => x === k)).sort().map((k) => ({ label: k, value: num(pt[k]), cls: 'gs-c1' }));
  return [...known, ...extra];
}

/* ======================= cobranças ======================= */
export const isOverdue = (r, today = todaySP()) => r?.status === 'pendente' && isIsoDay(r.vencimento) && r.vencimento < today;

// Filtro da tabela: o que pedir ao banco (p_status) e quais linhas ficam na tela ("" = todas).
export const filtroStatus = (f) => (f === 'atrasada' ? 'pendente' : ['pendente', 'pago', 'cancelado'].includes(f) ? f : null);
export const noFiltro = (r, f, today = todaySP()) => (!f ? true : f === 'atrasada' ? isOverdue(r, today) : r?.status === f);
export const aplicaFiltro = (rows, f, today = todaySP()) => (Array.isArray(rows) ? rows : []).filter((r) => noFiltro(r, f, today));
// Quantas pedir ao banco (as mais novas primeiro). Pendentes e atrasadas: o máximo do banco (1.000), para as atrasadas
// mais antigas (as que mais importam) não ficarem de fora; as outras: 200. A tela avisa quando a lista vem cheia.
export const LIMITE_LISTA = 200;
export const LIMITE_MAX = 1000;
export const limiteCobrancas = (f) => (f === 'pendente' || f === 'atrasada' ? LIMITE_MAX : LIMITE_LISTA);

// "Marcar como pago": forma de pagamento obrigatória; "Pago em" em branco vale hoje; de 2020 até hoje (São Paulo).
// pagoEm: null quando é hoje (o banco grava a hora de agora) ou "AAAA-MM-DD" (o banco grava esse dia).
export function validarPagamento({ forma, pago_em: pagoEm } = {}, today = todaySP()) {
  const errors = {};
  const f = String(forma ?? '').trim();
  if (!FORMAS.some(([v]) => v === f)) errors.forma = 'Escolha a forma de pagamento.';
  const dia = String(pagoEm ?? '').trim() || today;
  if (!isIsoDay(dia) || dia < '2020-01-01') errors.pago_em = 'Data do pagamento inválida: use uma data de 2020 até hoje.';
  else if (dia > today) errors.pago_em = 'A data do pagamento não pode ser no futuro.';
  const ok = !Object.keys(errors).length;
  return { ok, errors, forma: ok ? f : null, pagoEm: ok && dia !== today ? dia : null };
}

// Aviso antes de voltar uma cobrança para pendente. Paga: sai do faturado e a data do pagamento é apagada (ao marcar
// como paga de novo, vale a data informada no "Pago em").
export function avisoReabrir(r) {
  const valor = fmtBRL(num(r?.valor_cents));
  if (r?.status !== 'pago') return `Voltar a cobrança de ${valor} para pendente? Ela volta para o “a receber”.`;
  const t = Date.parse(r.pago_em);
  const dia = r.pago_em && !Number.isNaN(t) ? ` (${DATA_SP.format(new Date(t))})` : '';
  return `Voltar a cobrança de ${valor} para pendente? Ela sai do faturado e a data do pagamento${dia} será apagada.`;
}

// Formulário "Nova cobrança" → { ok, errors: { campo: texto }, payload } com as mesmas regras do banco.
export function validarCobranca(f = {}, today = todaySP()) {
  const errors = {};
  const tipo = String(f.tipo ?? '').trim();
  if (!TIPO_OK.has(tipo)) errors.tipo = 'Escolha o tipo da cobrança.';
  const descricao = String(f.descricao ?? '').replace(/\s+/g, ' ').trim();
  if (descricao.length < 3) errors.descricao = 'Descreva a cobrança (pelo menos 3 letras).';
  else if (descricao.length > 200) errors.descricao = 'Use até 200 letras na descrição.';
  const pagadorTipo = String(f.pagador_tipo ?? '').trim();
  if (!PAGADOR_OK.has(pagadorTipo)) errors.pagador_tipo = 'Escolha quem paga.';
  const nome = String(f.pagador_nome ?? '').replace(/\s+/g, ' ').trim();
  if (nome.length > 120) errors.pagador_nome = 'Use até 120 letras no nome.';
  const cents = parseReais(f.valor);
  if (cents === null) errors.valor = 'Informe o valor.';
  else if (Number.isNaN(cents)) errors.valor = 'Valor inválido. Use, por exemplo, 150 ou 1.234,56.';
  else if (cents < VALOR_MIN || cents > VALOR_MAX) errors.valor = 'O valor precisa ficar entre R$ 0,01 e R$ 1.000.000,00.';
  let vencimento = String(f.vencimento ?? '').trim();
  if (!vencimento) vencimento = today;
  else if (!isIsoDay(vencimento) || vencimento < '2020-01-01' || vencimento > '2099-12-31') errors.vencimento = 'Vencimento inválido: use uma data de 2020 a 2099.';
  const obs = String(f.obs ?? '').trim();
  if (obs.length > 500) errors.obs = 'Use até 500 letras na observação.';
  const ok = !Object.keys(errors).length;
  return { ok, errors, payload: ok ? { tipo, descricao, pagador_tipo: pagadorTipo, pagador_nome: nome || null, valor_cents: cents, vencimento, obs: obs || null } : null };
}

// Célula da planilha: texto que começa com = + - @ ganha um apóstrofo (a planilha não roda como fórmula);
// com ponto e vírgula, aspas ou quebra de linha vai entre aspas, com as aspas dobradas.
export function csvCell(v, { text = true } = {}) {
  let s = v === null || v === undefined ? '' : String(v);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const CSV_HEADER = ['Criada em', 'Tipo', 'Descrição', 'Quem paga', 'Nome de quem paga', 'Valor (R$)', 'Vencimento', 'Situação', 'Atrasada', 'Pago em', 'Forma de pagamento', 'Observação', 'Código'];
// Planilha das cobranças (Excel e Google Planilhas em português): ponto e vírgula, BOM do UTF-8 e quebra CRLF.
// Data e forma de pagamento só na paga (o banco guarda a forma depois de voltar para pendente ou cancelar; a tela
// também só mostra na paga).
export function cobrancasCsv(rows, today = todaySP()) {
  const lines = [CSV_HEADER.map((h) => csvCell(h)).join(';')];
  for (const r of Array.isArray(rows) ? rows : []) {
    const cents = num(r?.valor_cents);
    const paga = r.status === 'pago';
    const cells = [
      dateTimePlanilha(r.criado_em), labelOf(COB_TIPOS, r.tipo), r.descricao, labelOf(PAGADORES, r.pagador_tipo), r.pagador_nome,
      cents === null ? '' : centsPlanilha(cents), isIsoDay(r.vencimento) ? fullDay(r.vencimento) : '', labelOf(COB_STATUS, r.status),
      r.status === 'pendente' ? (isOverdue(r, today) ? 'sim' : 'não') : '', paga ? pagoEmPlanilha(r.pago_em) : '', paga && r.forma ? labelOf(FORMAS, r.forma) : '', r.obs, r.id,
    ];
    lines.push(cells.map((v, i) => csvCell(v, { text: i !== 5 })).join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/* ======================= Agenda das clínicas (central do IMED, iMed Agenda 4.4) ======================= */
// Tudo o que as funções agenda_central_* mandam são números, datas, códigos e nomes de clínica. Aqui cada código
// ganha um nome em português; código que a tela ainda não conhece aparece como veio (nada é inventado nem escondido).
export const CE_TABS = [['clinicas', 'Clínicas'], ['conflitos', 'Conflitos'], ['auditoria', 'Auditoria'], ['feriados', 'Feriados'], ['parametros', 'Parâmetros'], ['equipe', 'Equipe do IMED']];
export const CE_LIMITE = 200;          // conflitos, mudanças e leituras: o banco manda no máximo 200 linhas
export const CE_LIMITE_CLINICAS = 500;
const bool = (v) => v === true;
const dia = (v) => (isIsoDay(v) ? v : null);
const quando = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const codigo = (v) => (typeof v === 'string' && /^[a-z][a-z0-9_.]{1,60}$/.test(v) ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const veio = (raw) => obj(raw).status === 'ok';

// ---------- clínicas ----------
export const CE_MODO_CURTO = { pedido: 'Pedido', nativa: 'Agenda no IMED', manual: 'Agenda no IMED, registro manual', externa: 'Sistema da clínica' };
export const modoTexto = (m) => CE_MODO_CURTO[m] || (m ? String(m) : DASH);
export const modoAjuda = (m) => MODE_LABEL[m] || '';
export function normalizeCentral(raw) {
  const r = obj(raw);
  if (!veio(r)) return null;
  const t = obj(r.totals);
  const m = obj(t.by_mode);
  return {
    gerado_em: quando(r.generated_at),
    feriados_ate: dia(r.national_holidays_until),
    cortada: bool(r.truncated),
    totais: { ...pick(t, ['clinics', 'agenda_active', 'online', 'timezone_pending', 'open_conflicts', 'upcoming']), por_modo: pick(m, ['pedido', 'nativa', 'manual', 'externa']) },
    clinicas: arr(r.clinics).map((c) => {
      const x = obj(c);
      return {
        id: str(x.clinic_id), nome: str(x.name), cidade: str(x.city), uf: str(x.state), situacao: str(x.status), demo: bool(x.demo),
        modo: str(x.agenda_mode), ativa: bool(x.agenda_active), online_desde: quando(x.online_since), vendendo: bool(x.selling),
        fuso: str(x.timezone), fuso_confirmado_em: quando(x.timezone_confirmed_at),
        feriados_ate: dia(x.holidays_checked_until), fecha_feriado: x.closes_on_holidays === null || x.closes_on_holidays === undefined ? null : bool(x.closes_on_holidays),
        versao: num(x.version), atividade: quando(x.changed_at),
        conflitos: num(x.open_conflicts), por_vir: num(x.upcoming), equipe: num(x.members),
      };
    }).filter((c) => c.id && c.nome),
  };
}
// Os números do alto da parte "Clínicas".
export function centralKpis(d) {
  const t = d?.totais || {};
  return [
    { id: 'ce-clinicas', label: 'Clínicas no IMED', value: fmtInt(t.clinics), sub: 'todas as cadastradas como parceiras' },
    { id: 'ce-ativas', label: 'Com a agenda ativa', value: fmtInt(t.agenda_active), sub: 'já configuraram a agenda no IMED' },
    { id: 'ce-online', label: 'Vendendo horário online', value: fmtInt(t.online), sub: 'o paciente marca pelo site' },
    { id: 'ce-conflitos', label: 'Conflitos abertos', value: fmtInt(t.open_conflicts), sub: 'agendamentos para remarcar', warn: isNum(t.open_conflicts) && t.open_conflicts > 0 },
    { id: 'ce-porvir', label: 'Agendamentos por vir', value: fmtInt(t.upcoming), sub: 'na agenda do IMED, de hoje em diante' },
    { id: 'ce-fuso', label: 'Fuso sem confirmar', value: fmtInt(t.timezone_pending), sub: 'agenda ativa, fuso ainda não confirmado', warn: isNum(t.timezone_pending) && t.timezone_pending > 0 },
  ];
}
export const CE_FILTRO_CLINICAS = [['ativas', 'Com a agenda ativa'], ['conflitos', 'Com conflito aberto'], ['todas', 'Todas']];
export function filtraClinicas(clinicas, f) {
  const l = arr(clinicas);
  if (f === 'ativas') return l.filter((c) => c.ativa);
  if (f === 'conflitos') return l.filter((c) => isNum(c.conflitos) && c.conflitos > 0);
  return l;
}
// Feriados estaduais e municipais conferidos pela clínica: até quando, e se já venceu (a clínica não vende além dessa data).
export function feriadosClinica(c, hoje = todaySP()) {
  if (!c?.ativa) return { texto: DASH, tom: '' };
  if (!c.feriados_ate) return { texto: 'Não conferidos', tom: 'warn' };
  if (c.feriados_ate < hoje) return { texto: `Venceu em ${fullDay(c.feriados_ate)}`, tom: 'warn' };
  return { texto: `Até ${fullDay(c.feriados_ate)}`, tom: '' };
}
export function fusoClinica(c) {
  const nome = tzLabel(c?.fuso) || DASH;
  if (c?.fuso_confirmado_em) return { nome, texto: `Confirmado em ${fmtDateTime(c.fuso_confirmado_em).slice(0, 10)}`, tom: 'ok' };
  return { nome, texto: c?.ativa ? 'Não confirmado' : 'Ainda não confirmado', tom: c?.ativa ? 'warn' : '' };
}
// "Vende online" só quando o paciente consegue marcar de fato (selling: a regra do motor); só a data da venda ligada,
// com a clínica sem aceitar pedidos, suspensa ou de demonstração, é venda pausada.
export function agendaClinica(c) {
  if (!c?.ativa) return { texto: 'Não ativada', tom: '', sub: '' };
  if (!c.online_desde) return { texto: 'Ativa', tom: 'ok', sub: 'Sem venda online' };
  if (c.vendendo) return { texto: 'Ativa', tom: 'ok', sub: `Vende online desde ${fmtDateTime(c.online_desde).slice(0, 10)}` };
  return { texto: 'Ativa', tom: 'ok', sub: 'Venda ligada, pausada (a clínica não aceita pedidos, está suspensa ou é demonstração)' };
}
// Sem nenhum feriado nacional lançado o motor não oferece horário em clínica nenhuma (arquitetura §4): aviso em destaque.
export function avisoFeriadoNacional(ate, hoje = todaySP()) {
  if (!ate) return { tom: 'warn', texto: 'Nenhum feriado nacional foi lançado ainda. Enquanto isso, o IMED não oferece horário para marcar em nenhuma clínica. Lance os feriados na parte “Feriados”.' };
  if (ate < hoje) return { tom: 'warn', texto: `Os feriados nacionais estão lançados só até ${fullDay(ate)}, que já passou: o IMED não oferece mais horário para marcar. Lance os feriados do ano na parte “Feriados”.` };
  return { tom: 'info', texto: `Feriados nacionais lançados até ${fullDay(ate)}: nenhuma clínica oferece horário depois desse dia.` };
}
// A "versão" que a tela compara para saber se algo mudou em qualquer clínica (agenda_central_version).
export function centralFingerprint(raw) {
  const r = obj(raw);
  return veio(r) ? [r.version, r.changed_at, r.clinics, r.open_conflicts].map((x) => str(x)).join('|') : '';
}

// ---------- conflitos ----------
const CE_CONFLITO = {
  ...CONFLICT_KIND, fuso_mudou: 'O fuso da clínica mudou', pagamento_apos_expirar: 'Pagamento chegou depois de a reserva vencer',
  divergencia_externa: 'Diferença com o sistema da clínica', evento_externo_rejeitado: 'Aviso do sistema da clínica recusado',
  paciente_em_dois_horarios: 'Paciente em dois horários ao mesmo tempo',
};
export const conflitoTexto = (k) => CE_CONFLITO[k] || (k ? `Código: ${k}` : DASH);
export const CE_CONFLITO_STATUS = { aberto: 'Aberto', em_andamento: 'Em andamento', resolvido: 'Resolvido', descartado: 'Tirado da lista' };
// feriado_retirado: o feriado que abriu o conflito foi retirado (pela central ou pela volta da migração dos feriados nacionais)
const CE_RESOLUCAO = { remarcado: 'remarcado', cancelado: 'cancelado', mantido: 'mantido no horário', tirado_da_lista: 'tirado da lista pela equipe',
  feriado_retirado: 'feriado retirado, o horário voltou a valer' };
export function normalizeConflitos(raw) {
  const r = obj(raw);
  if (!veio(r)) return null;
  return {
    gerado_em: quando(r.generated_at), total: num(r.total), abertos: num(r.open),
    linhas: arr(r.conflicts).map((k) => {
      const x = obj(k);
      const aberto = x.status === 'aberto' || x.status === 'em_andamento';
      return {
        id: str(x.id), clinica: str(x.clinic_name), tipo: str(x.kind), situacao: str(x.status), aberto,
        criado_em: quando(x.created_at), resolvido_em: quando(x.resolved_at),
        horario: quando(x.starts_at) ? fmtWhen(str(x.timezone) || TZ, x.starts_at) : '',
        resolucao: x.resolution_code ? (CE_RESOLUCAO[x.resolution_code] || `código: ${x.resolution_code}`) : '',
      };
    }).filter((k) => k.id),
  };
}

// ---------- auditoria ----------
export const CE_DIAS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '12 meses']];
const CE_QUEM = { paciente: 'Paciente', clinica: 'Clínica', imed: 'Equipe do IMED', sistema: 'Automático', integracao: 'Sistema da clínica', gateway: 'Pagamento', sql: 'Equipe técnica do IMED (correção manual)' };
const CE_PAPEL = { ...ROLE_LABEL, imed: 'Equipe do IMED', imed_admin: 'Administração do IMED', imed_operacao: 'Equipe do IMED (operação)', imed_suporte: 'Equipe do IMED (suporte)', imed_financeiro: 'Equipe do IMED (financeiro)', imed_auditoria: 'Equipe do IMED (auditoria)' };
const CE_ORIGEM = { app: 'Site', painel: 'Painel da clínica', central: 'Central do IMED', api: 'Integração', webhook_pagamento: 'Pagamento', cron: 'Automático', sql: 'Correção manual' };
const CE_ACAO = {
  'unidade.criar': 'Ativou a agenda', 'unidade.salvar': 'Mudou as configurações da unidade', 'modalidade.trocar': 'Trocou a modalidade',
  'recurso.criar': 'Criou aparelho, sala ou profissional', 'recurso.salvar': 'Mudou aparelho, sala ou profissional',
  'procedimento.criar': 'Criou um exame', 'procedimento.salvar': 'Mudou um exame (duração, preço ou recursos)',
  'regras.salvar': 'Mudou os horários de funcionamento', 'pacote.regras': 'Mudou as regras de exames juntos',
  'bloqueio.criar': 'Criou um bloqueio', 'bloqueio.criar_forcado': 'Bloqueou por cima de agendamentos', 'bloqueio.remover': 'Tirou um bloqueio',
  'ocupado.criar': 'Marcou um horário como ocupado', 'ocupado.remover': 'Liberou um horário ocupado',
  'feriado.criar': 'Lançou um feriado', 'feriado.remover': 'Retirou um feriado', 'feriado.abrir': 'Marcou “abrimos neste feriado”', 'feriado.fechar': 'Desfez “abrimos neste feriado”',
  'agendamento.remarcar': 'Remarcou um agendamento',
  conflito_em_andamento: 'Assumiu um conflito', conflito_resolvido: 'Resolveu um conflito', conflito_descartado: 'Tirou um conflito da lista',
  convite_criado: 'Convidou uma pessoa para a equipe', convite_cancelado: 'Cancelou um convite', convite_aceito: 'Aceitou um convite',
  membro_removido: 'Tirou uma pessoa da equipe', papel_trocado: 'Trocou o papel de uma pessoa da equipe',
  imed_staff_insert: 'Deu um papel da equipe do IMED', imed_staff_update: 'Mudou um papel da equipe do IMED (dar de novo ou tirar)', imed_staff_delete: 'Conta da equipe do IMED apagada',
  role_permissions_insert: 'Acrescentou uma permissão a um papel', role_permissions_update: 'Mudou uma permissão de um papel', role_permissions_delete: 'Tirou uma permissão de um papel',
  'parametro.definir': 'Mudou um parâmetro global', 'parametro.padrao': 'Voltou um parâmetro global ao padrão',
  'avisos.regra': 'Mudou os avisos e lembretes da clínica',
  // correções feitas direto no banco pela equipe técnica (sempre com um código de motivo)
  pedido_criado_sql: 'Criou um agendamento direto no banco', pedido_alterado_sql: 'Mudou um agendamento direto no banco', pedido_apagado_sql: 'Apagou um agendamento direto no banco',
  clinica_criada_sql: 'Criou uma clínica direto no banco', clinica_agenda_sql: 'Mudou fuso, modalidade ou venda online direto no banco',
  occupancy_insert: 'Incluiu uma ocupação direto no banco', occupancy_update: 'Mudou uma ocupação direto no banco', occupancy_delete: 'Apagou uma ocupação direto no banco',
  appointment_items_insert: 'Incluiu um exame de agendamento direto no banco', appointment_items_update: 'Mudou um exame de agendamento direto no banco', appointment_items_delete: 'Apagou um exame de agendamento direto no banco',
};
const CE_OBJETO = {
  clinic: 'Clínica', clinic_block: 'Bloqueio', busy_mark: 'Horário ocupado', holiday: 'Feriado', conflict: 'Conflito', member_invite: 'Convite',
  clinic_member: 'Equipe da clínica', resource: 'Aparelho, sala ou profissional', procedure: 'Exame', setting: 'Parâmetro global', notification_rule: 'Avisos e lembretes',
  imed_staff: 'Equipe do IMED', role_permissions: 'Permissões dos papéis', appointment_request: 'Agendamento', appointment_item: 'Agendamento', appointment_items: 'Exame de um agendamento', occupancy: 'Ocupação', unit_settings: 'Unidade',
};
const CE_LEITURA = {
  agenda_view: 'Grade da agenda (nome curto)', agenda_search: 'Busca de paciente', agenda_request_detail: 'Detalhe de um agendamento',
  agenda_requests: 'Lista de pedidos', agenda_history: 'Histórico de um agendamento', agenda_block_force: 'Lista de atingidos por um bloqueio',
  agenda_desk_book: 'Marcação de balcão', agenda_month: 'Mês da agenda', agenda_conflicts: 'Conflitos',
};
const CE_MOTIVO = Object.fromEntries(JUSTIFICATIONS);
export const acaoTexto = (a) => CE_ACAO[a] || (a ? `Código: ${a}` : DASH);
export const objetoTexto = (o) => CE_OBJETO[o] || (o ? String(o) : DASH);
export const origemTexto = (o) => CE_ORIGEM[o] || (o ? String(o) : DASH);
export const leituraTexto = (fn) => CE_LEITURA[fn] || (fn ? `Função: ${fn}` : DASH);
export const motivoTexto = (c) => (c ? CE_MOTIVO[c] || `Código: ${c}` : '');
// "Recepção", "Equipe do IMED (operação)"… pelo papel; sem papel, pelo tipo de quem agiu.
export const quemTexto = (tipo, papel) => (papel && CE_PAPEL[papel]) || CE_QUEM[tipo] || (papel ? String(papel) : tipo ? String(tipo) : DASH);
export function normalizeAuditoria(raw) {
  const r = obj(raw);
  if (!veio(r)) return null;
  const t = obj(r.totals);
  return {
    gerado_em: quando(r.generated_at), dias: num(r.days), de: dia(r.from),
    totais: pick(t, ['changes', 'reads', 'readers', 'imed_reads']),
    objetos: arr(r.object_types).map(codigo).filter(Boolean).sort((a, b) => objetoTexto(a).localeCompare(objetoTexto(b), 'pt-BR')),
    mudancas: arr(r.changes).map((c) => {
      const x = obj(c);
      return { id: str(x.id), em: quando(x.at), clinica: str(x.clinic_name), quem: quemTexto(str(x.actor_kind), str(x.actor_role)), conta: str(x.actor),
        acao: acaoTexto(str(x.action)), objeto: objetoTexto(str(x.object_type)), origem: origemTexto(str(x.origin)), motivo: x.reason_code ? `Código: ${x.reason_code}` : '' };
    }),
    leituras: arr(r.reads).map((l) => {
      const x = obj(l);
      return { dia: dia(x.day), clinica: str(x.clinic_name), quem: quemTexto(x.justification_code ? 'imed' : 'clinica', str(x.actor_role)), conta: str(x.actor),
        tela: leituraTexto(str(x.fn)), escopo: str(x.scope), motivo: motivoTexto(x.justification_code), leituras: num(x.reads), agendamentos: num(x.requests) };
    }),
  };
}
export const CONTA_RE = /^[0-9a-f]{8}$/;
// Filtros da auditoria → p_filters (só o que foi escolhido). Código de conta fora do formato: erro, nada é enviado.
export function filtrosAuditoria({ dias = 30, clinica = '', objeto = '', conta = '' } = {}) {
  const errors = {};
  const f = { days: CE_DIAS.some(([d]) => d === Number(dias)) ? Number(dias) : 30 };
  if (clinica) f.clinic = String(clinica);
  if (objeto) f.object_type = String(objeto);
  const c = String(conta ?? '').trim().toLowerCase();
  if (c) { if (CONTA_RE.test(c)) f.actor = c; else errors.conta = 'O código da conta tem 8 caracteres (números e letras de “a” a “f”), como aparece na coluna “Quem”.'; }
  return { ok: !Object.keys(errors).length, errors, filters: f };
}

// ---------- parâmetros globais ----------
// Só os parâmetros que o banco diz que o sistema lê (agenda_central_settings). O nome e a explicação ficam aqui.
const CE_PARAM = {
  'agenda.limite_futuros_por_telefone': {
    nome: 'Agendamentos por vir do mesmo telefone, na mesma clínica',
    ajuda: 'Quantos agendamentos ainda por acontecer o mesmo número de telefone pode ter numa clínica quando a marcação é feita pelo site. Chegando a esse número, uma nova marcação pelo site com esse telefone é recusada. Protege a agenda contra abuso; o balcão da clínica não tem esse limite.',
  },
  'avisos.envio_ligado': {
    nome: 'Envio de avisos e lembretes (0 = desligado, 1 = ligado)',
    ajuda: 'Com 0, o sistema só prepara os avisos (confirmação, cancelamento, remarcação e lembretes) e nenhum é enviado: o que chega à hora fica marcado como “sem canal”. Só coloque 1 depois que a função de envio estiver publicada e o e-mail do IMED estiver configurado. Voltar para 0 para o envio na hora.',
  },
};
export function normalizeParametros(raw) {
  const r = obj(raw);
  if (!veio(r)) return null;
  return {
    pode_editar: bool(r.can_edit),
    lista: arr(r.params).map((p) => {
      const x = obj(p);
      const info = CE_PARAM[x.key] || { nome: str(x.key), ajuda: '' };
      return { chave: str(x.key), nome: info.nome, ajuda: info.ajuda, padrao: num(x.default), min: num(x.min), max: num(x.max),
        gravado: x.value === null || x.value === undefined ? null : num(x.value), em_vigor: num(x.effective), mudado_em: quando(x.updated_at) };
    }).filter((p) => p.chave),
  };
}
export function validarParametro(p, valor) {
  const s = String(valor ?? '').trim();
  if (!/^\d{1,6}$/.test(s)) return { ok: false, error: 'Digite um número inteiro.' };
  const n = Number(s);
  if (isNum(p?.min) && isNum(p?.max) && (n < p.min || n > p.max)) return { ok: false, error: `Use um número de ${fmtInt(p.min)} a ${fmtInt(p.max)}.` };
  return { ok: true, value: n };
}

// ---------- avisos: situação do envio (agenda_central_avisos, fase 5.3) ----------
// Só números e códigos: nenhum dado de paciente chega aqui. null = o banco ainda não tem a função (o quadro não aparece).
const AVISO_ORDEM = ['enviada', 'falhou', 'sem_canal', 'sem_contato', 'sem_consentimento', 'cancelada'];
export function normalizeAvisos(raw) {
  const r = obj(raw);
  if (!veio(r)) return null;
  const u = obj(r.last7);
  return {
    ligado: bool(r.sending),
    vencidos: num(r.due) ?? 0, mais_antigo: quando(r.oldest_due_at), preparados: num(r.scheduled) ?? 0, tentando: num(r.retrying) ?? 0,
    ultimos7: AVISO_ORDEM.map((k) => ({ situacao: k, nome: NOTIFY_STATUS[k], n: num(u[k]) ?? 0 })),
    falhas: arr(r.failures).map((f) => { const x = obj(f); return { clinica: str(x.clinic), aviso: NOTIFY_EVENT[x.event_type] || str(x.event_type), canal: NOTIFY_CHANNEL[x.channel] || str(x.channel), erro: str(x.error), quando: quando(x.at) }; }),
  };
}

// ---------- feriados ----------
const DIA_LONGO = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
export const diaLongo = (iso) => (isIsoDay(iso) ? DIA_LONGO.format(new Date(`${iso}T12:00:00Z`)) : DASH);
export function normalizeFeriados(raw) {
  const r = obj(raw);
  if (!veio(r)) return null;
  const todos = arr(r.holidays).map((h) => {
    const x = obj(h);
    return { id: str(x.id), escopo: str(x.scope), uf: str(x.uf), dia: dia(x.day), nome: str(x.name), fonte: str(x.source) };
  }).filter((h) => h.id && h.dia);
  return {
    hoje: dia(r.today) || todaySP(), pode_editar: bool(r.can_edit), nacional_ate: dia(r.national_until), clinicas_com_agenda: num(r.clinics_with_agenda),
    nacionais: todos.filter((h) => h.escopo === 'nacional'), outros: todos.filter((h) => h.escopo !== 'nacional').length,
  };
}
// Último dia aceito no formulário: o fim do ano que vem depois do próximo (um ano digitado errado, como 2062, esticaria
// até lá o prazo em que as clínicas oferecem horário).
export const feriadoMax = (hoje = todaySP()) => `${Number(hoje.slice(0, 4)) + 2}-12-31`;
export function validarFeriado({ dia: d = '', nome = '', fonte = '' } = {}, hoje = todaySP()) {
  const errors = {};
  const n = String(nome ?? '').trim();
  const f = String(fonte ?? '').trim();
  if (!isIsoDay(d)) errors.dia = 'Escolha o dia do feriado.';
  else if (d < hoje) errors.dia = 'Escolha um dia de hoje em diante.';
  else if (d > feriadoMax(hoje)) errors.dia = `Use um dia até ${fullDay(feriadoMax(hoje))}.`;
  if (n.length < 2 || n.length > 120) errors.nome = 'Escreva o nome do feriado (de 2 a 120 letras).';
  if (f.length < 3 || f.length > 300) errors.fonte = 'Informe a lei, o decreto ou a portaria que criou o feriado (de 3 a 300 letras).';
  return { ok: !Object.keys(errors).length, errors, payload: { scope: 'nacional', day: d, name: n, source: f } };
}
// A frase de conferência antes de lançar (resposta de agenda_central_holiday_preview): só contagens.
export function previaFeriado(raw, payload) {
  const r = obj(raw);
  if (!veio(r)) return null;
  const fecham = num(r.clinics_closing);
  const ag = num(r.appointments);
  const partes = [`${diaLongo(payload?.day)}: “${payload?.name ?? ''}”.`];
  if (fecham !== null) partes.push(fecham === 0 ? 'Nenhuma clínica com a agenda ativa fecha nesse dia hoje.' : `${plural(fecham, 'clínica com a agenda ativa fecha', 'clínicas com a agenda ativa fecham')} nesse dia.`);
  if (ag !== null) partes.push(ag === 0 ? 'Não há agendamento marcado nesse dia.' : `${plural(ag, 'agendamento já marcado nesse dia vai', 'agendamentos já marcados nesse dia vão')} para “Precisa de atenção” da clínica, para remarcar.`);
  return { ja_existe: bool(r.already), agendamentos: ag, texto: partes.join(' ') };
}

// ---------- papéis da equipe do IMED ----------
export const IMED_PAPEIS = [
  ['operacao', 'Operação', 'Acompanha e opera a agenda das clínicas: marca, remarca, resolve conflitos, lança feriados e abre dado de paciente com motivo registrado.'],
  ['suporte', 'Suporte', 'Acompanha a agenda das clínicas sem ver nenhum dado de paciente.'],
  ['financeiro', 'Financeiro', 'Vê o financeiro da agenda. Não vê a agenda nem pacientes.'],
  ['auditoria', 'Auditoria', 'Acompanha a agenda sem dado de paciente e vê a auditoria.'],
];
export const papelImed = (r) => IMED_PAPEIS.find(([k]) => k === r)?.[1] || (r ? String(r) : DASH);
const IMED_PERM = {
  'imed.agenda.monitor': 'ver a agenda das clínicas, sem nome de paciente', 'imed.agenda.operar': 'marcar, cancelar e remarcar pela clínica',
  'imed.pacientes.ver': 'abrir dados de um paciente, sempre com o motivo registrado', 'imed.conflitos.resolver': 'resolver conflitos',
  'imed.feriados.editar': 'lançar e retirar feriados', 'imed.clinicas.configurar': 'configurar a agenda de uma clínica',
  'imed.financeiro.ver': 'ver o financeiro da agenda', 'imed.auditoria.ver': 'ver a auditoria',
};
export const permImed = (p) => IMED_PERM[p] || String(p ?? '');
export function normalizeEquipe(raw) {
  const r = obj(raw);
  if (!veio(r)) return null;
  return {
    papeis: arr(r.roles).map((x) => ({ papel: str(obj(x).role), pode: arr(obj(x).permissions).map((p) => permImed(str(p))) })).filter((x) => x.papel),
    pessoas: arr(r.staff).map((s) => {
      const x = obj(s);
      return { user_id: str(x.user_id), conta: str(x.code), email: str(x.email), papel: str(x.role), desde: quando(x.granted_at), retirado_em: quando(x.revoked_at), ativo: bool(x.active) };
    }).filter((s) => s.user_id && s.papel),
  };
}
export function validarPapel({ email = '', papel = '' } = {}) {
  const errors = {};
  const e = String(email ?? '').trim().toLowerCase();
  if (!e) errors.email = 'Digite o e-mail da conta da pessoa.';
  else if (e.length > 254 || !EMAIL_RE.test(e)) errors.email = 'Confira o e-mail: parece incompleto.';
  if (!IMED_PAPEIS.some(([k]) => k === papel)) errors.papel = 'Escolha o papel.';
  return { ok: !Object.keys(errors).length, errors, payload: { p_email: e, p_role: papel } };
}

// ---------- respostas das funções que gravam (o banco devolve um código em "status") ----------
const CE_STATUS = {
  forbidden: 'Esta conta não tem permissão para isso.',
  invalid: 'O banco não aceitou os dados. Confira e tente de novo.',
  not_found: 'Não encontramos esse registro: a lista foi atualizada.',
  user_not_found: 'Não achamos uma conta com esse e-mail e o e-mail confirmado. A pessoa precisa primeiro criar a conta no site (em “Minha conta”) com esse e-mail e abrir o link de confirmação.',
  already_admin: 'Esse e-mail é de administrador do IMED: já tem todas as permissões, não precisa de papel.',
  holiday_exists: 'Esse dia já está lançado como feriado nacional.',
  duplicate: 'Esse dia já está lançado como feriado nacional.',
};
export const centralStatus = (s, fallback = 'Não foi possível concluir agora. Tente de novo em instantes.') => CE_STATUS[s] || fallback;
