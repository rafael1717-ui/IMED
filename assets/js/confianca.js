// Regras dos recursos de confiança do IMED, sem mexer na página (também rodam no Node: tests/confianca.test.mjs):
// cancelar pedido, Fale com o IMED (protocolo), "Algo errado aqui?", Meus dados (LGPD), pedido para outra
// pessoa e a conferência da equipe antes de aprovar uma clínica. Funções do banco: migração 20261030143738_confianca.sql.

/* ======================= cancelar pedido ======================= */
// Situações do banco em que o paciente ainda pode cancelar pelo site (o banco confere de novo, inclusive o prazo da
// clínica: too_late). "Remarcação solicitada" também (fase 4.2): o banco aceita até o prazo da clínica.
export const CANCELLABLE = ['pending', 'contacted', 'confirmed', 'reschedule_requested'];

// Pode mostrar "Cancelar pedido"? status: situação que veio do banco (sem ela, não oferece: o banco é quem sabe).
// slot: horário marcado (ISO); se já passou, não dá mais para cancelar pelo site.
export function canCancel(status, slot = null, now = Date.now()) {
  if (!CANCELLABLE.includes(status)) return false;
  if (slot) {
    const t = Date.parse(slot);
    if (!Number.isFinite(t) || t <= now) return false;
  }
  return true;
}

// Respostas definitivas de cancel_request (inclusive o prazo da clínica, too_late — fase 4.2): a tela fecha a pergunta
// "Sim, cancelar" e confere a situação de novo. Erro de rede não está aqui: a pergunta fica aberta para tentar de novo.
export const CANCEL_FINAL = ['not_cancellable', 'past', 'too_late', 'not_found', 'forbidden'];

// "Adicionar à agenda" (lembrete .ics): só para o que ainda está de pé — aguardando contato, em contato ou confirmado,
// ou sem situação do banco (o aparelho ainda não sabe). Nada para reserva, chegada, atendimento, falta, remarcação
// solicitada, cancelado, concluído ou expirado. Regra única da página inicial e da conta.
export const REMIND_OK = ['pending', 'contacted', 'confirmed'];
export const canRemind = (status) => !status || REMIND_OK.includes(status);

// Cancelar solta um horário só quando o pedido ainda segura esse horário. "Remarcação solicitada" (fase 4.2) nasce do
// bloqueio da clínica ("Bloquear mesmo assim"): o horário já foi solto e o período está bloqueado.
const freesSlot = (slot, status) => !!slot && status !== 'reschedule_requested';

// Respostas de cancel_request em linguagem simples.
export const CANCEL_MSG = {
  already_cancelled: 'Este pedido já estava cancelado.',
  not_cancellable: 'Este pedido já foi concluído e não pode mais ser cancelado pelo site.',
  past: 'O horário deste pedido já passou. Se precisar, fale com o local.',
  too_late: 'O prazo para cancelar pelo site já passou. Fale com a clínica.',
  forbidden: 'Não conseguimos confirmar que este pedido é seu. Use o aparelho em que fez o pedido ou entre na conta usada nele.',
  not_found: 'Não encontramos este pedido. Ele pode ter sido apagado.',
  error: 'Não foi possível cancelar agora. Confira a internet e tente de novo.',
};

// Para quem vai o cancelamento: 'parceiro' (clínica parceira: ela vê o pedido no painel dela), 'local' (local que
// ainda não é parceiro: só a equipe do IMED vê, e nada avisa o local sozinho) ou '' (pedido antigo: não dá para saber).
// Aceita o pedido guardado no aparelho (place_key "imed:..." / "cnes:..." / "osm:...") ou a linha do banco
// (clinic_id / place_source).
export function placeType(o) {
  const key = String(o?.place_key ?? '');
  const src = String(o?.place_source ?? '');
  if (o?.clinic_id || src === 'imed' || key.startsWith('imed:')) return 'parceiro';
  if (['cnes', 'osm', 'google'].includes(src) || /^(cnes|osm|google):/.test(key)) return 'local';
  return '';
}
const LIGUE = 'Se o horário já tinha sido combinado com o local, ligue também para ele';
// Pergunta antes de cancelar. Só promete o que acontece de verdade: o IMED ainda não avisa o local sozinho.
// status: a situação do banco antes de cancelar (em "Remarcação solicitada", nada de "horário livre").
export function cancelConfirmText(type = '', slot = null, status = '') {
  const base = 'Cancelar este pedido? Cancelar pelo IMED é grátis.';
  if (type === 'parceiro') return `${base} A clínica vê o cancelamento no painel dela${freesSlot(slot, status) ? ' e o horário volta a ficar livre para outra pessoa' : ''}.`;
  if (type === 'local') return `${base} A equipe do IMED vê o cancelamento. ${LIGUE}.`;
  return `${base} ${LIGUE}.`;
}
export const CANCEL_CONFIRM = cancelConfirmText();
// Depois de cancelar. phone: telefone do local guardado no pedido (quando existe); status: a situação antes de cancelar.
export function cancelDoneText(slot = null, type = '', phone = '', status = '') {
  const tel = phone ? `: ${phone}` : '';
  const livre = freesSlot(slot, status) ? ' O horário voltou a ficar livre.' : '';
  if (type === 'parceiro') return `Pedido cancelado.${livre} A clínica vê o cancelamento no painel dela.`;
  if (type === 'local') return `Pedido cancelado. A equipe do IMED vê o cancelamento. ${LIGUE}${tel}.`;
  return `Pedido cancelado.${livre} ${LIGUE}${tel}.`;
}
// Aviso que fica no cartão do pedido cancelado neste aparelho (o aviso rápido da tela some sozinho).
// telHref: transforma o telefone em link (geo-core.telHref); sem link, mostra só o número. Tudo escapado.
export function cancelNoteHTML(type = '', phone = '', telHref = null) {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  if (type === 'parceiro') return 'A clínica vê o cancelamento no painel dela.';
  const href = phone && typeof telHref === 'function' ? telHref(phone) : '';
  const tel = phone ? `: ${href ? `<a class="link" href="${esc(href)}">${esc(phone)}</a>` : esc(phone)}` : '';
  return `${type === 'local' ? 'A equipe do IMED vê o cancelamento. ' : ''}${LIGUE}${tel}.`;
}

/* ======================= Fale com o IMED ======================= */
// [valor, rótulo, grupo]. Os três de "Meus dados" são os direitos da LGPD (art. 18): acesso, correção e exclusão.
export const CONTACT_SUBJECTS = [
  ['duvida', 'Dúvida sobre o IMED', ''],
  ['cancelamento', 'Cancelar um pedido', ''],
  ['dados_acesso', 'Quero uma cópia dos meus dados', 'Meus dados (LGPD)'],
  ['dados_correcao', 'Quero corrigir meus dados', 'Meus dados (LGPD)'],
  ['dados_exclusao', 'Quero apagar meus dados', 'Meus dados (LGPD)'],
  ['clinica', 'Sou de uma clínica, laboratório ou hospital', ''],
  ['outro', 'Outro assunto', ''],
];
const SUBJECT_ALIAS = { acesso: 'dados_acesso', copia: 'dados_acesso', correcao: 'dados_correcao', corrigir: 'dados_correcao', exclusao: 'dados_exclusao', excluir: 'dados_exclusao', apagar: 'dados_exclusao', cancelar: 'cancelamento' };
export const isSubject = (v) => CONTACT_SUBJECTS.some(([k]) => k === v);
// Assunto vindo do endereço (contato.html?assunto=correcao). Desconhecido: vazio.
export function subjectFromParam(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (isSubject(s)) return s;
  return SUBJECT_ALIAS[s] ?? '';
}
export const isLgpdSubject = (s) => /^dados_/.test(String(s ?? ''));
export const CONTACT_MAX = 2000;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[1-9]{2}(9\d{8}|[2-8]\d{7})$/;
// "E-mail ou celular" num campo só: com @ é e-mail; sem, celular com DDD (com ou sem +55). Inválido: null.
export function parseReplyContact(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.includes('@')) {
    const email = s.toLowerCase();
    return email.length <= 254 && EMAIL_RE.test(email) ? { email } : null;
  }
  let d = s.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return PHONE_RE.test(d) ? { phone: d } : null;
}

// Erros por campo: subject, name, contact, message, code.
export function validateContact(v) {
  const err = {};
  if (!isSubject(v.subject)) err.subject = 'Escolha o assunto.';
  const name = String(v.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) err.name = 'Digite seu nome.';
  else if (name.length > 120) err.name = 'Use até 120 caracteres.';
  if (!parseReplyContact(v.contact)) err.contact = 'Digite um e-mail (como voce@exemplo.com) ou um celular com DDD (como (11) 98765-4321).';
  const msg = String(v.message ?? '').trim();
  if (msg.length < 5) err.message = 'Escreva a sua mensagem.';
  else if (msg.length > CONTACT_MAX) err.message = `Use até ${CONTACT_MAX} caracteres.`;
  if (String(v.code ?? '').trim().length > 40) err.code = 'Confira o protocolo (até 40 caracteres).';
  return err;
}

// Argumentos de send_contact.
export function contactArgs(v) {
  const c = parseReplyContact(v.contact);
  return {
    p_subject: v.subject,
    p_name: String(v.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
    p_contact: c?.email ?? c?.phone ?? '',
    p_message: String(v.message ?? '').trim().slice(0, CONTACT_MAX),
    p_request_code: String(v.code ?? '').trim().slice(0, 40) || null,
  };
}

// Erro de send_contact (exceção P0001): 'dados_invalidos' com o campo em "details", ou um dos limites. Cada limite
// tem um texto verdadeiro: o do contato (sem conta), o da conta e o teto do banco (muitas mensagens de todo mundo).
const CONTACT_FIELD = { assunto: 'subject', nome: 'name', contato: 'contact', mensagem: 'message', protocolo: 'code' };
export const CONTACT_LIMIT_MSG = {
  limite_contato: 'Já recebemos várias mensagens com este e-mail ou celular em pouco tempo, e a equipe vai responder a elas. Para mandar outra agora, entre na sua conta (Minha conta) e escreva por ela, ou tente de novo mais tarde.',
  limite_conta: 'Sua conta já mandou várias mensagens em pouco tempo, e a equipe vai responder a elas. Tente de novo mais tarde.',
  limite_geral: 'Chegaram muitas mensagens ao mesmo tempo e o envio está pausado por alguns minutos. Tente de novo mais tarde.',
  limite: 'Chegaram muitas mensagens em pouco tempo. Tente de novo mais tarde.',
};
export function contactError(err) {
  const code = err?.data?.message ?? err?.message ?? '';
  if (CONTACT_LIMIT_MSG[code]) return { text: CONTACT_LIMIT_MSG[code] };
  if (code === 'dados_invalidos') {
    const field = CONTACT_FIELD[err?.data?.details] ?? null;
    return { field, text: 'Confira os campos marcados e tente de novo.' };
  }
  return { text: 'Não foi possível enviar agora. Confira a internet e tente de novo.' };
}
export const isProtocol = (v) => /^IMED-\d{8}-[A-Z0-9]{4}$/.test(String(v ?? ''));

/* ======================= "Algo errado aqui? Avise o IMED" ======================= */
export const REPORT_KINDS = [
  ['telefone', 'O telefone está errado ou não atende'],
  ['fechado', 'O local fechou'],
  ['endereco', 'O endereço mudou'],
  ['exame', 'Não faz o exame indicado'],
  ['outro', 'Outro problema'],
];
export const REPORT_NOTE_MAX = 300;
export const reportKindLabel = (k) => REPORT_KINDS.find(([v]) => v === k)?.[1] ?? 'Outro problema';
export function validateReport(v) {
  const err = {};
  if (!REPORT_KINDS.some(([k]) => k === v.kind)) err.kind = 'Escolha o que está errado.';
  if (String(v.note ?? '').trim().length > REPORT_NOTE_MAX) err.note = `Use até ${REPORT_NOTE_MAX} caracteres.`;
  return err;
}
// Argumentos de report_place_issue para um local da página (cadastro oficial: código CNES; parceiro: id).
export function reportArgs(place, v) {
  const cnes = place?.source === 'cnes' ? String(place.id ?? '').replace(/^cnes:/, '') : null;
  const note = String(v.note ?? '').trim().replace(/\s+/g, ' ').slice(0, REPORT_NOTE_MAX);
  return {
    p_cnes: cnes && /^\d{7}$/.test(cnes) ? cnes : null,
    p_clinic: place?.source === 'imed' ? place.clinic_id ?? null : null,
    p_kind: v.kind,
    p_note: note || null,
  };
}
export const REPORT_MSG = {
  ok: 'Obrigado! A equipe do IMED vai conferir.',
  // Só para aviso NOVO, quando chegam muitos de todo mundo ao mesmo tempo (o aviso repetido sempre entra).
  limite: 'Chegaram muitos avisos ao mesmo tempo e não deu para gravar o seu agora. Tente de novo mais tarde ou escreva pelo Fale com o IMED.',
  nao_encontrado: 'Este local não está mais no IMED.',
  dados_invalidos: 'Confira o que está errado e tente de novo.',
  error: 'Não foi possível enviar agora. Confira a internet e tente de novo.',
};

/* ======================= Meus dados (LGPD) ======================= */
// Cópia dos dados que a pessoa já vê no IMED, para baixar em JSON. O código secreto dos pedidos (token) fica
// de fora: ele só serve para este aparelho e, solto num arquivo, deixaria outra pessoa cancelar o pedido.
export function dataExport({ email = null, userId = null, requests = [], claims = [], device = [], now = Date.now() } = {}) {
  return {
    servico: 'IMED',
    gerado_em: new Date(now).toISOString(),
    sobre_este_arquivo: 'Cópia dos seus dados no IMED: os pedidos da sua conta (se você entrou), os pedidos de cadastro de clínica feitos por ela e os pedidos guardados neste aparelho. O código secreto de cada pedido não vem no arquivo. Para corrigir ou apagar dados, use o Fale com o IMED.',
    conta: email || userId ? { email, id: userId } : null,
    pedidos_da_conta: Array.isArray(requests) ? requests : [],
    pedidos_de_cadastro_de_clinica: Array.isArray(claims) ? claims : [],
    pedidos_deste_aparelho: (Array.isArray(device) ? device : []).filter((a) => a && typeof a === 'object').map(({ token, ...rest }) => rest),
  };
}
export const dataExportName = (now = Date.now()) => `imed-meus-dados-${new Date(now).toISOString().slice(0, 10)}.json`;

/* ======================= conferência antes de aprovar uma clínica ======================= */
// [campo de claim_checks, título, o que a equipe confere]. O profissional responsável pelo local nem sempre é
// médico (num laboratório pode ser biomédico ou farmacêutico; numa clínica odontológica, dentista): por isso a
// conferência é do registro ativo no conselho da profissão dele, com o conselho e o número.
export const CLAIM_CHECKS = [
  ['cnes_active', 'CNES ativo', 'A ficha do estabelecimento está ativa no CNES (link "Ficha no CNES", acima).'],
  ['cnpj_active', 'CNPJ ativo', 'O CNPJ do estabelecimento está ativo na Receita Federal.'],
  ['phone_confirmed', 'Ligação para o telefone oficial do CNES', 'Liguei para o telefone que está no CNES e confirmei que quem pediu responde pelo local.'],
  ['council_active', 'Profissional responsável com registro ativo no conselho', 'O profissional responsável pelo local tem registro ativo no conselho da profissão dele (CRM, CRF, CRBM, CRO…). Escolha o conselho e escreva o número abaixo.'],
];
// Conselhos aceitos (o banco confere a mesma lista). Só o do CFM tem link de consulta aqui; os outros, no site do
// conselho regional de cada profissão.
export const COUNCILS = [
  ['CRM', 'CRM (médico)'], ['CRF', 'CRF (farmacêutico)'], ['CRBM', 'CRBM (biomédico)'], ['CRBio', 'CRBio (biólogo)'],
  ['CRO', 'CRO (dentista)'], ['COREN', 'COREN (enfermagem)'], ['CREFITO', 'CREFITO (fisioterapia)'], ['CRP', 'CRP (psicologia)'],
  ['CRN', 'CRN (nutrição)'], ['CRFa', 'CRFa (fonoaudiologia)'], ['outro', 'Outro conselho (explique na observação)'],
];
export const COUNCIL_LINKS = { CRM: 'https://portal.cfm.org.br/busca-medicos/' };
export const isCouncil = (v) => COUNCILS.some(([k]) => k === v);
const councilNumber = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
export const checksComplete = (c) => CLAIM_CHECKS.every(([k]) => c?.[k] === true) && isCouncil(c?.council) && councilNumber(c?.council_number).length >= 2;
export function checksPayload(get) {
  const out = Object.fromEntries(CLAIM_CHECKS.map(([k]) => [k, get(k) === true]));
  const council = String(get('council') ?? '');
  if (isCouncil(council)) out.council = council;
  const number = councilNumber(get('council_number'));
  if (number.length >= 2) out.council_number = number;
  const note = String(get('note') ?? '').trim().slice(0, 300);
  if (note) out.note = note;
  return out;
}

/* ======================= datas ======================= */
const BR_DATE = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
const BR_LONG = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
// Instante (ISO) → "30/10/2026" no fuso de São Paulo. Inválido: ''.
export function dateBR(iso) {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? BR_DATE.format(new Date(t)) : '';
}
// Data do banco ("2026-10-30") → "30 de outubro de 2026". Inválida: ''.
export function dayLong(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ''))) return '';
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : BR_LONG.format(d);
}

/* ======================= ponto de partida da página inicial ======================= */
// Cidades que levam artigo ("do Rio de Janeiro", "da Serra"); as outras, "de" (de Belo Horizonte).
const ARTIGO_CIDADE = new Map([['Rio de Janeiro', 'do'], ['Rio Grande', 'do'], ['Recife', 'do'], ['Crato', 'do'], ['Guarujá', 'do'],
  ['Cabo de Santo Agostinho', 'do'], ['Serra', 'da']]);
export const deCidade = (name) => `${ARTIGO_CIDADE.get(String(name)) || 'de'} ${name}`;
