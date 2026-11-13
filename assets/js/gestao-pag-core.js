// Regras puras da parte "Pagamentos on-line" do painel de gestão (iMed Pagamentos, fase P2b; arquitetura do pagamento
// §7.3). Sem tela e sem rede: testadas em tests/gestao-pagamentos.test.mjs. A tela fica em gestao-pagamentos.js.
// NENHUM número nasce aqui: tudo vem das funções admin_pag_resumo, admin_pag_lista e admin_pag_conciliacao (P1), que
// conferem no banco a permissão da equipe (imed.financeiro.ver). Este arquivo só confere o formato, dá nome aos códigos
// e escreve os valores em reais. Nenhum dado de paciente nem do pagador: as funções não mandam (o id do agendamento,
// que admin_pag_lista devolve, é descartado aqui e nunca chega à tela).
import { DASH, fmtBRL, fmtInt, isNum, isIsoDay, fullDay, todaySP, plural } from './gestao-core.js';

const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// Inteiro que veio do banco (centavos ou contagem); qualquer outra coisa vira null ("—" na tela, nunca zero).
export const int = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^-?\d{1,15}$/.test(v) ? Number(v) : null);
const texto = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');
const instante = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

export const PG_TABS = [['cobrancas', 'Cobranças'], ['conciliacao', 'Conciliação']];
export const PG_LIMITE = 100;   // quantas cobranças a lista pede (a função aceita até 500)
export const AVISO_SEM_BANCO = 'Os pagamentos on-line ainda não estão ligados no banco. Esta parte aparece aqui depois que a atualização do banco do pagamento for aplicada.';

// O período da página (7, 30, 90 dias ou 12 meses) em dias de São Paulo: termina hoje. A função aceita até 366 dias.
export function periodoDias(dias, hoje = todaySP()) {
  const n = Math.min(366, Math.max(1, Math.round(Number(dias)) || 30));
  const de = new Date(Date.parse(`${hoje}T12:00:00Z`) - (n - 1) * 86400000).toISOString().slice(0, 10);
  return { de, ate: hoje };
}

/* ======================= códigos → nomes ======================= */
// Situação da cobrança (pagamentos.charges.situacao). tom: a cor do selo (sempre com o texto).
export const PG_SITUACAO = {
  criada: ['Criada, sem QR', ''], aguardando: ['Aguardando pagamento', 'warn'], processando: ['Em análise', 'warn'], aprovada: ['Paga', 'ok'],
  expirada: ['Venceu sem pagamento', ''], cancelada: ['Cancelada', ''], recusada: ['Recusada', 'err'], devolvida_parcial: ['Devolvida em parte', 'warn'],
  devolvida: ['Devolvida', ''], contestada: ['Contestada', 'err'],
};
export const situacaoTexto = (s) => PG_SITUACAO[s]?.[0] || (s ? `Código: ${s}` : DASH);
export const situacaoTom = (s) => PG_SITUACAO[s]?.[1] || '';
export const PG_FILTRO = [['', 'Todas'], ...Object.entries(PG_SITUACAO).map(([k, [n]]) => [k, n])];
const MEIO = { pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto' };
export const meioTexto = (m) => MEIO[m] || (m ? String(m) : DASH);
const FINALIDADE = { agendamento: 'Exame agendado', destaque: 'Mensalidade do Destaque', teleconsulta: 'Teleconsulta', consultorio: 'Consultório virtual' };
export const finalidadeTexto = (f) => FINALIDADE[f] || (f ? String(f) : DASH);
// A situação que o meio de pagamento informou (formato neutro da camada do provedor).
const LA = { aguardando: 'aguardando', processando: 'em análise', paga: 'paga', recusada: 'recusada', apagada: 'apagada', devolvida: 'devolvida',
  devolvida_parcial: 'devolvida em parte', contestada: 'contestada', contestacao_ganha: 'contestação ganha', contestacao_perdida: 'contestação perdida' };

// Diferenças da conciliação (§5.4): o que cada tipo quer dizer.
export const PG_DIFF = {
  falta_aqui: 'O meio de pagamento recebeu e o IMED não registrou o pagamento',
  falta_la: 'O IMED registrou como pago e o meio de pagamento não',
  valor: 'O valor pago é diferente nos dois lados',
  repasse: 'A parte da clínica saiu diferente do combinado',
  situacao: 'Devolução ou contestação que não bate nos dois lados',
  tarifa: 'A tarifa do meio de pagamento veio diferente da esperada',
};
export const diffTexto = (t) => PG_DIFF[t] || (t ? `Código: ${t}` : DASH);
export const PG_GRAVIDADE = { critica: ['Crítica', 'err'], alta: ['Alta', 'warn'], informativa: ['Informativa', ''] };
export const gravidadeTexto = (g) => PG_GRAVIDADE[g]?.[0] || (g ? String(g) : DASH);
export const gravidadeTom = (g) => PG_GRAVIDADE[g]?.[1] || '';
export const PG_JANELA = { d1: 'do dia anterior', d7: 'de 7 dias atrás', d32: 'de 32 dias atrás', manual: 'aberta por uma diferença achada na hora' };
export const janelaTexto = (j) => PG_JANELA[j] || (j ? String(j) : DASH);
const RODADA = { rodando: ['Em andamento', 'warn'], concluida: ['Concluída', 'ok'], falhou: ['Falhou', 'err'] };
export const rodadaTexto = (s) => RODADA[s]?.[0] || (s ? String(s) : DASH);
export const rodadaTom = (s) => RODADA[s]?.[1] || '';

// Um lado da diferença ("nosso" ou "deles") em texto: só as chaves que a conciliação grava (situação e centavos).
const LADO = [['valor_cents', 'valor'], ['clinica_cents', 'parte da clínica'], ['repasse_cents', 'parte da clínica'], ['tarifa_cents', 'tarifa'], ['devolvido_cents', 'devolvido']];
export function ladoTexto(v, deles = false) {
  if (!obj(v)) return DASH;
  const out = [];
  if (typeof v.situacao === 'string' && v.situacao) out.push(deles ? (LA[v.situacao] || v.situacao) : situacaoTexto(v.situacao).toLowerCase());
  for (const [k, nome] of LADO) if (int(v[k]) !== null) out.push(`${nome} ${fmtBRL(int(v[k]))}`);
  return out.length ? out.join(' · ') : DASH;
}

/* ======================= resumo (admin_pag_resumo) ======================= */
const EXTRATO = ['recebido', 'taxa_imed', 'repasse_clinica', 'tarifa_meio', 'devolucao', 'devolucao_taxa', 'devolucao_repasse', 'contestacao', 'contestacao_revertida', 'mensalidade'];
const ATENCAO = ['diferencas_criticas', 'diferencas_abertas', 'devolucoes_na_fila', 'devolucoes_com_falha', 'avisos_pendentes', 'contestacoes_abertas'];
const mapaInt = (v, chaves) => Object.fromEntries(chaves.map((k) => [k, obj(v) ? int(v[k]) : null]));
// → { tipo: 'ok', ... } | { tipo: 'forbidden' } | null (resposta que esta tela não entende).
export function normalizeResumo(raw) {
  if (!obj(raw)) return null;
  if (raw.status === 'forbidden') return { tipo: 'forbidden' };
  if (raw.status !== 'ok' || typeof raw.vendas_online_ligadas !== 'boolean' || !obj(raw.atencao)) return null;
  const ext = obj(raw.extrato) ? raw.extrato : {};
  const cob = obj(raw.cobrancas) ? raw.cobrancas : {};
  const contas = obj(raw.contas) ? raw.contas : {};
  return {
    tipo: 'ok', de: isIsoDay(raw.de) ? raw.de : '', ate: isIsoDay(raw.ate) ? raw.ate : '',
    ligada: raw.vendas_online_ligadas,
    // tipo que não apareceu no período = nenhuma linha no extrato = zero (o banco só manda os tipos que têm linha)
    extrato: Object.fromEntries(EXTRATO.map((k) => [k, k in ext ? int(ext[k]) : 0])),
    cobrancas: Object.fromEntries(Object.keys(PG_SITUACAO).map((k) => [k, k in cob ? int(cob[k]) : 0])),
    contas: Object.fromEntries(['ativa', 'em_conferencia', 'suspensa', 'nao_ligada'].map((k) => [k, k in contas ? int(contas[k]) : 0])),
    atencao: { ...mapaInt(raw.atencao, ATENCAO), ultima_conciliacao: isIsoDay(raw.atencao.ultima_conciliacao) ? raw.atencao.ultima_conciliacao : '' },
  };
}
const abs = (v) => (isNum(v) ? Math.abs(v) : null);
const somaCob = (c) => { const v = Object.values(c); return v.every(isNum) ? v.reduce((a, b) => a + b, 0) : null; };
// Os números do período, na ordem do caminho do dinheiro. O extrato do banco tem sinal (devolução é negativa): aqui
// cada cartão diz em palavras o que é, e o valor aparece sem sinal.
export function resumoKpis(d) {
  const e = d.extrato;
  return [
    { id: 'pg-recebido', label: 'Pago pelos pacientes', value: fmtBRL(e.recebido), sub: 'pelo site, no período', icon: 'fa-landmark', tom: 'din' },
    { id: 'pg-taxa', label: 'Taxas do IMED', value: fmtBRL(e.taxa_imed), sub: 'a parte do IMED nos exames pagos', icon: 'fa-tags', tom: 'din' },
    { id: 'pg-repasse', label: 'Parte das clínicas', value: fmtBRL(e.repasse_clinica), sub: 'separada pelo meio de pagamento', icon: 'fa-hospital', tom: 'din' },
    { id: 'pg-tarifa', label: 'Tarifas do meio de pagamento', value: fmtBRL(e.tarifa_meio), sub: 'saem da parte do IMED', icon: 'fa-tag', tom: 'din' },
    { id: 'pg-devolvido', label: 'Devolvido aos pacientes', value: fmtBRL(abs(e.devolucao)), sub: 'devoluções concluídas no período', icon: 'fa-reply', tom: 'din' },
    { id: 'pg-cobrancas', label: 'Cobranças criadas', value: fmtInt(somaCob(d.cobrancas)), sub: `${fmtInt(d.cobrancas.aprovada)} pagas · ${fmtInt(d.cobrancas.aguardando)} aguardando`, icon: 'fa-list', tom: 'at' },
  ];
}
// "Precisa de atenção": só entra o que é maior que zero (número que o banco não mandou também entra, como "—").
export function atencaoItens(d) {
  const a = d.atencao;
  const itens = [
    ['diferencas_criticas', 'diferença crítica aberta na conciliação', 'diferenças críticas abertas na conciliação', 'err'],
    ['devolucoes_com_falha', 'devolução com falha no envio', 'devoluções com falha no envio', 'err'],
    ['contestacoes_abertas', 'contestação aberta', 'contestações abertas', 'err'],
    ['avisos_pendentes', 'aviso do meio de pagamento ainda não aplicado', 'avisos do meio de pagamento ainda não aplicados', 'warn'],
    ['devolucoes_na_fila', 'devolução na fila', 'devoluções na fila', 'warn'],
  ];
  return itens.filter(([k]) => a[k] === null || a[k] > 0).map(([k, um, varios, tom]) => ({ id: k, tom, texto: a[k] === null ? `${DASH} ${varios}` : plural(a[k], um, varios) }));
}
export const temCritica = (d) => !(d.atencao.diferencas_criticas === 0);
export function contasTexto(d) {
  const c = d.contas;
  if (![c.ativa, c.em_conferencia, c.suspensa].every(isNum)) return 'Clínicas com conta no meio de pagamento: sem o número.';
  if (c.ativa + c.em_conferencia + c.suspensa === 0) return 'Nenhuma clínica informou a conta no meio de pagamento ainda.';
  return `Clínicas: ${plural(c.ativa, 'com a conta ativa', 'com a conta ativa')}, ${fmtInt(c.em_conferencia)} em conferência e ${fmtInt(c.suspensa)} ${c.suspensa === 1 ? 'suspensa' : 'suspensas'}.`;
}
// A chave geral em uma frase.
export const chaveTexto = (ligada) => (ligada
  ? 'O pagamento pelo site está aberto: clínica com a conta conferida e a unidade no modo on-line cobra pelo site.'
  : 'Nenhuma cobrança nova nasce, em nenhuma clínica. O que já foi pago continua sendo processado e devolvido normalmente.');

/* ======================= cobranças (admin_pag_lista) ======================= */
export function normalizeLista(raw) {
  if (!obj(raw)) return null;
  if (raw.status === 'forbidden' || raw.status === 'invalid') return { tipo: raw.status };
  if (raw.status !== 'ok' || !Array.isArray(raw.cobrancas)) return null;
  return { tipo: 'ok', linhas: raw.cobrancas.filter((c) => obj(c) && typeof c.id === 'string').map((c) => ({
    codigo: c.id.slice(0, 8), criado_em: instante(c.criado_em), clinica: texto(c.clinic_name, 160), finalidade: texto(c.finalidade, 30), meio: texto(c.meio, 20),
    situacao: texto(c.situacao, 30), valor_cents: int(c.valor_cents), taxa_cents: int(c.taxa_cents), clinica_cents: int(c.clinica_cents),
    tarifa_meio_cents: int(c.tarifa_meio_cents), devolvido_cents: int(c.devolvido_cents), paga_em: instante(c.paga_em), tentativa: int(c.tentativa),
  })) };
}

/* ======================= conciliação (admin_pag_conciliacao) ======================= */
export function normalizeConciliacao(raw) {
  if (!obj(raw)) return null;
  if (raw.status === 'forbidden') return { tipo: 'forbidden' };
  if (raw.status !== 'ok' || !Array.isArray(raw.rodadas) || !Array.isArray(raw.diferencas)) return null;
  return {
    tipo: 'ok', criticas: int(raw.criticas_abertas),
    rodadas: raw.rodadas.filter(obj).map((r) => {
      const c = obj(r.contadores) ? r.contadores : {};
      return { dia: isIsoDay(r.dia) ? r.dia : '', janela: texto(r.janela, 12), comecou: instante(r.comecou), terminou: instante(r.terminou), situacao: texto(r.situacao, 12),
        linhas: int(c.linhas), pagas_aqui: int(c.pagas_aqui), achadas: int(c.achadas), novas: int(c.novas), criticas: int(c.criticas) };
    }),
    diferencas: raw.diferencas.filter(obj).map((x) => ({
      id: int(x.id), tipo: texto(x.tipo, 20), gravidade: texto(x.gravidade, 20), critica: x.critica === true, criado_em: instante(x.criado_em), dia: isIsoDay(x.dia) ? x.dia : '',
      cobranca: typeof x.charge_id === 'string' ? x.charge_id.slice(0, 8) : '', no_meio: texto(x.provedor_cobranca_id, 80),
      nosso: obj(x.nosso) ? x.nosso : null, deles: obj(x.deles) ? x.deles : null, resolvida_em: instante(x.resolvida_em), resolucao: texto(x.resolucao, 60),
    })),
  };
}
// A conferência mais recente de um dia inteiro (as "manuais" são diferenças abertas na hora, não uma conferência).
export const ultimaRodada = (d) => d.rodadas.find((r) => r.janela !== 'manual') || null;
export function ultimaRodadaTexto(d) {
  const r = ultimaRodada(d);
  if (!r) return 'Nenhuma conferência feita ainda. Ela roda sozinha de madrugada, depois que o pagamento for ligado.';
  const partes = [`Última conferência: o dia ${fullDay(r.dia)} (${janelaTexto(r.janela)}), ${rodadaTexto(r.situacao).toLowerCase()}.`];
  if (r.situacao === 'concluida') partes.push(`${isNum(r.linhas) ? plural(r.linhas, 'cobrança comparada', 'cobranças comparadas') : 'Cobranças comparadas: —'}; ${isNum(r.achadas) ? plural(r.achadas, 'diferença achada', 'diferenças achadas') : 'diferenças: —'}.`);
  return partes.join(' ');
}

/* ======================= chave geral (admin_pag_chave_geral) ======================= */
// Motivos em código (o banco exige um código, não um texto livre; fica na trilha do pagamento).
export const MOTIVOS_LIGAR = [['abertura_do_piloto', 'Abertura do piloto'], ['retomada_apos_incidente', 'Retomada depois de um incidente'], ['retomada_apos_manutencao', 'Retomada depois de manutenção'], ['teste_da_equipe', 'Teste da equipe']];
export const MOTIVOS_DESLIGAR = [['incidente', 'Incidente (algo errado com pagamentos)'], ['diferenca_na_conciliacao', 'Diferença na conciliação'], ['manutencao', 'Manutenção'], ['pedido_do_dono', 'Pedido do dono do IMED'], ['fim_do_teste', 'Fim de um teste']];
export const motivosDe = (ligar) => (ligar ? MOTIVOS_LIGAR : MOTIVOS_DESLIGAR);
// Confere o quadro antes de chamar o banco: motivo escolhido e, para ligar, a caixa "entendi" marcada.
export function validarChave({ ligar, motivo = '', ciente = false } = {}) {
  const errors = {};
  if (typeof ligar !== 'boolean') errors.motivo = 'Escolha de novo: ligar ou desligar.';
  else if (!motivosDe(ligar).some(([k]) => k === motivo)) errors.motivo = 'Escolha o motivo.';
  if (ligar === true && !ciente) errors.ciente = 'Marque a caixa para confirmar que entendeu.';
  return { ok: !Object.keys(errors).length, errors, payload: { p_ligar: ligar === true, p_motivo: motivo } };
}
const STATUS = {
  forbidden: 'Só o administrador do IMED liga ou desliga o pagamento pelo site.',
  reason_required: 'O banco não aceitou o motivo. Escolha um motivo da lista.',
  invalid: 'O banco não entendeu o pedido. Atualize a página e tente de novo.',
};
export const pgStatus = (s, fallback = 'Não foi possível concluir agora. Tente de novo em instantes.') => STATUS[s] || fallback;
