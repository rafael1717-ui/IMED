// "Minha Saúde", etapa 1: as regras puras da página (sem tela e sem rede; testes em tests/minha-saude.test.mjs).
// A página junta o que JÁ é do paciente: os agendamentos deste aparelho, as teleconsultas deste aparelho (o código
// secreto de cada uma fica no aparelho) e as teleconsultas que ele guardou na conta (migração ws_minha_saude).
// Nada aqui inventa dado: o que o banco não mandou não aparece.
import { KIND, fmtCode, verifyPath } from './tele-docs.js';

export const IDLE_MS = 30 * 60 * 1000;   // meia hora sem mexer: a página esconde os documentos
export const TABS = [['agendamentos', 'Agendamentos'], ['consultas', 'Consultas e documentos'], ['conta', 'Na minha conta']];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => UUID.test(String(v ?? ''));
const quando = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const texto = (v, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const DIA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
const DIA_HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const fmtDia = (iso) => (quando(iso) ? DIA.format(new Date(iso)) : '');
export const fmtDiaHora = (iso) => (quando(iso) ? DIA_HORA.format(new Date(iso)).replace(', ', ' às ') : '');
// Dia e hora num fuso do Brasil (o da clínica). Fuso estranho ou que o aparelho não conhece: o de São Paulo.
function noFuso(iso, tz) {
  if (typeof tz !== 'string' || !/^America\/[A-Za-z_]{3,30}$/.test(tz) || tz === 'America/Sao_Paulo') return fmtDiaHora(iso);
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(new Date(iso)).replace(', ', ' às ') + ' (horário da clínica)';
  } catch { return fmtDiaHora(iso); }
}

/* ===================== consultas ===================== */
// Situação da teleconsulta em palavras. Desconhecida: nada (a tela não mostra código).
const SITUACAO = { waiting: 'Na fila', accepted: 'Médico a caminho', in_call: 'Em andamento', ended: 'Encerrada', cancelled: 'Cancelada', expired: 'Não atendida' };
export const situacaoTexto = (s) => SITUACAO[s] || '';
export const emAndamento = (s) => ['waiting', 'accepted', 'in_call'].includes(s);

// O médico como o banco mandou (nome e CRM). Sem nome: nada.
export function medicoTexto(d) {
  const nome = texto(d?.name ?? d?.full_name);   // a conta manda name; a teleconsulta (tele_status), full_name
  if (!nome) return '';
  const crm = texto(d?.crm, 12);
  const uf = texto(d?.crm_uf, 2).toUpperCase();
  return crm ? `${nome} · CRM${uf ? `-${uf}` : ''} ${crm}` : nome;
}

// A resposta de saude_minhas_consultas. null = não veio (banco de antes, conta sem permissão, resposta estranha).
export function normalizeConta(raw) {
  if (!raw || typeof raw !== 'object' || raw.status !== 'ok') return null;
  return {
    podeGuardar: raw.can_save === true,
    recente: raw.recent === true,
    itens: (Array.isArray(raw.items) ? raw.items : []).filter((x) => x && isUuid(x.consultation_id)).map((x) => ({
      id: x.consultation_id, status: texto(x.consultation_status, 20), inicio: quando(x.created_at), fim: quando(x.ended_at),
      guardadaEm: quando(x.saved_at), medico: medicoTexto(x.doctor), documentos: Number.isInteger(x.documents) && x.documents >= 0 ? x.documents : null,
    })),
  };
}

// Uma consulta deste aparelho, com o que tele_status respondeu (a primeira linha). null = o código não vale mais.
export function consultaDoAparelho(entrada, linha) {
  if (!entrada || !isUuid(entrada.id) || !linha || typeof linha !== 'object') return null;
  return { id: entrada.id, status: texto(linha.status, 20), inicio: quando(linha.created_at), fim: quando(linha.ended_at), medico: medicoTexto(linha.doctor), documentos: null, guardadaEm: null };
}

// Junta as duas listas numa só, sem repetir: cada consulta diz onde está (neste aparelho, na conta, ou nos dois).
// As mais novas primeiro (pela data do fim; sem fim, pela do começo).
export function juntarConsultas(doAparelho, daConta) {
  const mapa = new Map();
  for (const c of Array.isArray(doAparelho) ? doAparelho : []) if (c && isUuid(c.id)) mapa.set(c.id, { ...c, noAparelho: true, naConta: false });
  for (const c of Array.isArray(daConta) ? daConta : []) {
    if (!c || !isUuid(c.id)) continue;
    const a = mapa.get(c.id);
    mapa.set(c.id, a ? { ...a, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null && v !== '')), noAparelho: true, naConta: true } : { ...c, noAparelho: false, naConta: true });
  }
  const t = (c) => Date.parse(c.fim || c.inicio || '') || 0;
  return [...mapa.values()].sort((a, b) => t(b) - t(a) || a.id.localeCompare(b.id));
}

// O título do cartão: "Teleconsulta de 12/11/2026" (sem data conhecida: só "Teleconsulta").
export const tituloConsulta = (c) => { const d = fmtDia(c?.fim || c?.inicio); return d ? `Teleconsulta de ${d}` : 'Teleconsulta'; };

// O que dá para fazer com a consulta: guardar na conta (logado, ligado, neste aparelho e ainda não guardada).
export function podeGuardar(c, { logado, ligado }) {
  return !!(c && logado && ligado && c.noAparelho && !c.naConta && !emAndamento(c.status));
}
// Por que não dá para guardar agora (texto para a tela; '' = dá, ou não se aplica).
export function porQueNaoGuarda(c, { logado, ligado, temFuncoes }) {
  if (!c || c.naConta || !c.noAparelho) return '';
  // sem entrar não dá para saber se guardar está ligado: a tela não promete nem nega
  if (!logado) return '';
  if (!temFuncoes || !ligado) return 'Guardar na conta ainda não está disponível. Por enquanto esta consulta aparece só neste aparelho.';
  if (emAndamento(c.status)) return 'Depois que a consulta terminar, você pode guardá-la na sua conta.';
  return '';
}

/* ===================== documentos ===================== */
// Um documento como a tela mostra, venha do aparelho (tele_patient_documents) ou da conta (saude_documentos).
export function normalizeDocumento(x) {
  if (!x || typeof x !== 'object' || !isUuid(x.id) || !KIND[x.kind]) return null;
  const status = x.document_status ?? x.status;
  if (status !== 'emitido' && status !== 'cancelado') return null;
  const assinado = x.signed === true;
  const temPdf = x.has_pdf === undefined ? assinado : x.has_pdf === true;
  const codigo = fmtCode(x.code);
  return {
    id: x.id, kind: x.kind, titulo: KIND[x.kind].title, cancelado: status === 'cancelado',
    motivo: status === 'cancelado' ? texto(x.cancel_reason, 300) : '',
    emitidoEm: quando(x.created_at), assinadoEm: assinado ? quando(x.signed_at) : null,
    codigo, conferir: codigo ? verifyPath(x.code) : '',
    baixa: status === 'emitido' && assinado && temPdf,
  };
}
export const normalizeDocumentos = (lista) => (Array.isArray(lista) ? lista : []).map(normalizeDocumento).filter(Boolean);

// A situação do documento em palavras (nunca "assinado" sem a assinatura).
export function situacaoDocumento(d) {
  if (!d) return '';
  if (d.cancelado) return d.motivo ? `Cancelado pelo médico: ${d.motivo}` : 'Cancelado pelo médico';
  if (d.baixa) return d.assinadoEm ? `Assinado pelo médico em ${fmtDiaHora(d.assinadoEm)}` : 'Assinado pelo médico';
  return 'Aguardando a assinatura do médico. Sem a assinatura, o documento ainda não vale.';
}

// O que cada resposta do banco quer dizer para a pessoa (guardar, ler documentos, baixar, tirar da conta).
const RESPOSTA = {
  off: 'Guardar na conta ainda não está disponível.',
  forbidden: 'Entre na sua conta para continuar.',
  invalid: 'Não foi possível concluir. Atualize a página e tente de novo.',
  not_found: 'Não achamos esta consulta. Ela pode ter sido tirada da conta ou o acesso deste aparelho não vale mais.',
  too_many: 'Muitas tentativas seguidas. Espere uma hora e tente de novo.',
  already_linked: 'Esta consulta já está guardada em outra conta. Se foi você, entre nela; se não foi, fale com o IMED.',
  reauth: 'Por segurança, os documentos só abrem com entrada feita há menos de 12 horas. Saia e entre de novo.',
  cancelled: 'Este documento foi cancelado pelo médico e não pode ser baixado.',
  no_pdf: 'O PDF assinado ainda não chegou. Tente de novo mais tarde.',
};
export const respostaTexto = (status, padrao = 'Não foi possível concluir agora. Confira a internet e tente de novo.') => RESPOSTA[status] || padrao;

/* ===================== agendamentos ===================== */
// Os agendamentos deste aparelho (localStorage 'imed_appts', gravado pela busca e pela página do local), resumidos:
// onde, quando e o código. A situação, cancelar e avaliar ficam em "Minha conta" (o link leva ao pedido).
export function agendamentosDoAparelho(lista, protocolo = (id) => `IMED-${String(id).replace(/-/g, '').slice(0, 8).toUpperCase()}`) {
  return (Array.isArray(lista) ? lista : []).filter((a) => a && typeof a === 'object' && texto(a.name) && (a.type === 'pedido' || a.id)).slice(0, 30).map((a) => {
    const horario = quando(a.slot);
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(a.date ?? '')) ? `${a.date.slice(8, 10)}/${a.date.slice(5, 7)}/${a.date.slice(0, 4)}` : '';
    return {
      id: isUuid(a.id) ? a.id : '', local: texto(a.name, 200),
      // o horário marcado aparece no fuso da clínica (gravado na marcação); sem ele, o de São Paulo
      quando: horario ? noFuso(horario, a.tz) : dia ? `${dia} (data preferida)` : '',
      codigo: isUuid(a.id) ? (typeof a.code === 'string' && /^IMED-[0-9A-F]{8}$/.test(a.code) ? a.code : protocolo(a.id)) : '',
      link: isUuid(a.id) ? `conta.html#pedido-${a.id}` : 'conta.html',
    };
  });
}
