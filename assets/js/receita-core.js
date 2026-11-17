// Receita completa, etapa 1: as regras puras da receita montada por campos (sem tela e sem rede; testes em
// tests/receita.test.mjs). O médico preenche dose, via, frequência e duração; daqui sai o modo de usar por extenso
// (a lei pede por extenso: Lei 5.991/1973, art. 35), que ele sempre pode corrigir à mão. O que vai impresso continua
// no formato da receita simples (tele-docs.js); as mesmas conversões existem no banco (migração ws_receita,
// private.rx_payload, private.rx_conferir) e um teste compara as duas.
// Nada aqui inventa remédio, dose ou classificação: o nome é o que o médico escreve.
import { RX_ALERTS, oneLine } from './tele-docs.js';

export const MAX_ITENS = 20;
export const MAX_MODELOS = 50;
// [código gravado, como sai impresso]
export const VIAS = [
  ['oral', 'oral'], ['sublingual', 'sublingual'], ['subcutanea', 'subcutânea'], ['intramuscular', 'intramuscular'],
  ['intravenosa', 'intravenosa'], ['topica', 'tópica'], ['inalatoria', 'inalatória'], ['nasal', 'nasal'], ['oftalmica', 'oftálmica'],
  ['otologica', 'otológica'], ['retal', 'retal'], ['vaginal', 'vaginal'], ['transdermica', 'transdérmica'], ['outra', 'outra (escrever)'],
];
const VIA = Object.fromEntries(VIAS);
// [uma, mais de uma]
export const UNIDADES = [
  ['comprimido', 'comprimidos'], ['cápsula', 'cápsulas'], ['drágea', 'drágeas'], ['gota', 'gotas'], ['mL', 'mL'], ['jato', 'jatos'],
  ['aplicação', 'aplicações'], ['sachê', 'sachês'], ['medida', 'medidas'], ['ampola', 'ampolas'], ['supositório', 'supositórios'],
  ['óvulo', 'óvulos'], ['adesivo', 'adesivos'], ['unidade', 'unidades'],
];
export const FREQS = [['intervalo', 'a cada … horas'], ['vezes', '… vezes ao dia'], ['uma', '1 vez ao dia'], ['se_precisar', 'se precisar (escrever quando)'], ['outra', 'outra (escrever)']];
export const DURS = [['dias', 'por … dias'], ['continuo', 'uso contínuo'], ['outra', 'outra (escrever)']];
export const LISTA_ROTULO = { antimicrobiano: 'antibiótico', glp1: 'caneta GLP-1', portaria_344: 'remédio controlado (Portaria 344)' };

// Limites de cada campo de texto: os mesmos de private.rx_conteudo_erro.
export const LIMITES = { medicamento: 200, concentracao: 60, forma: 60, composicao: 180, dose: 20, unidade: 30, via_outra: 40, freq_texto: 120, dur_texto: 60, quantidade: 100, orientacoes: 300, posologia: 500 };
const TEXTOS = Object.keys(LIMITES);
const txt = (v, max) => (typeof v === 'string' ? v.replace(/[\u2028\u2029]/g, '\n') : '').slice(0, max);
const linha = (v, max) => oneLine(typeof v === 'string' ? v : '').slice(0, max);
const inteiro = (v, min, max) => { const n = typeof v === 'number' ? v : /^\d{1,3}$/.test(String(v ?? '').trim()) ? Number(String(v).trim()) : NaN; return Number.isInteger(n) && n >= min && n <= max ? n : null; };

export const viaRotulo = (via, outra) => (via === 'outra' ? linha(outra, LIMITES.via_outra) : VIA[via] && via !== 'outra' ? VIA[via] : '');
export const itemNovo = () => ({ tipo: 'industrializado' });
export const ehManipulado = (it) => it?.tipo === 'manipulado';

/* ===================== o item arrumado (o que se salva) ===================== */
// Só as chaves conhecidas, sem espaço sobrando, número como número; campo vazio não entra. É o formato que
// ws_receita_salvar aceita e é estável (o mesmo item dá sempre o mesmo objeto, para "salvar igual" não subir versão).
export function arrumarItem(it) {
  const o = { tipo: ehManipulado(it) ? 'manipulado' : 'industrializado' };
  for (const k of TEXTOS) {
    const v = k === 'posologia' || k === 'orientacoes' ? txt(it?.[k], LIMITES[k]).trim() : linha(it?.[k], LIMITES[k]);
    if (v) o[k] = v;
  }
  if (VIA[it?.via]) o.via = it.via;
  if (o.via !== 'outra') delete o.via_outra;
  if (FREQS.some(([id]) => id === it?.freq_modo)) o.freq_modo = it.freq_modo;
  const fn = inteiro(it?.freq_n, 1, 48);
  if (fn !== null && (o.freq_modo === 'intervalo' || o.freq_modo === 'vezes')) o.freq_n = fn;
  if (o.freq_modo !== 'se_precisar' && o.freq_modo !== 'outra') delete o.freq_texto;
  if (DURS.some(([id]) => id === it?.dur_modo)) o.dur_modo = it.dur_modo;
  const dn = inteiro(it?.dur_n, 1, 365);
  if (dn !== null && o.dur_modo === 'dias') o.dur_n = dn;
  if (o.dur_modo !== 'outra') delete o.dur_texto;
  if (!ehManipulado(o)) delete o.composicao;
  if (o.posologia) o.posologia_manual = it?.posologia_manual === true;
  return o;
}
export const itemVazio = (it) => { const o = arrumarItem(it); return Object.keys(o).every((k) => k === 'tipo'); };
// O conteúdo do rascunho: itens arrumados (os vazios do fim não contam) e a observação geral.
export function conteudo(itens, observacao) {
  const lista = (Array.isArray(itens) ? itens : []).slice(0, MAX_ITENS).map(arrumarItem);
  while (lista.length && itemVazio(lista[lista.length - 1])) lista.pop();
  return { itens: lista, observacao: txt(observacao, 500).trim() || null };
}
export const conteudoVazio = (c) => !c || (!c.itens?.length && !c.observacao);

/* ===================== o modo de usar por extenso ===================== */
const VERBO = { oral: 'Tomar', sublingual: 'Colocar debaixo da língua', inalatoria: 'Inalar', oftalmica: 'Pingar', otologica: 'Pingar', outra: 'Usar' };
const numero = (dose) => { const s = String(dose ?? '').trim().replace(',', '.'); const f = /^(\d+)\s*\/\s*(\d+)$/.exec(s); return f ? Number(f[1]) / Number(f[2]) : /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; };
export function unidadeTexto(unidade, dose) {
  const u = linha(unidade, LIMITES.unidade);
  if (!u) return '';
  const par = UNIDADES.find(([um, mais]) => um.toLowerCase() === u.toLowerCase() || mais.toLowerCase() === u.toLowerCase());
  if (!par) return u;
  const n = numero(dose);
  return Number.isNaN(n) || n > 1 ? par[1] : par[0];
}
// O texto gerado a partir dos campos. '' = ainda falta campo (via e frequência no mínimo; "se precisar" e "outra"
// pedem o texto). A dose e a unidade são opcionais (creme, pomada).
export function gerarPosologia(it) {
  const o = arrumarItem(it);
  const via = viaRotulo(o.via, o.via_outra);
  if (!via || !o.freq_modo) return '';
  let freq;
  if (o.freq_modo === 'intervalo') { if (!o.freq_n) return ''; freq = ` a cada ${o.freq_n} ${o.freq_n === 1 ? 'hora' : 'horas'}`; }
  else if (o.freq_modo === 'vezes') { if (!o.freq_n) return ''; freq = ` ${o.freq_n} ${o.freq_n === 1 ? 'vez' : 'vezes'} ao dia`; }
  else if (o.freq_modo === 'uma') freq = ' 1 vez ao dia';
  else { if (!o.freq_texto) return ''; freq = o.freq_modo === 'se_precisar' ? `, se precisar: ${o.freq_texto}` : `, ${o.freq_texto}`; }
  const dose = o.dose ? ` ${o.dose}${o.unidade ? ` ${unidadeTexto(o.unidade, o.dose)}` : ''}` : '';
  const verbo = VERBO[o.via] || 'Aplicar';
  const viaTxt = o.via === 'sublingual' ? '' : ` por via ${via}`;
  const dur = o.dur_modo === 'dias' && o.dur_n ? `, por ${o.dur_n} ${o.dur_n === 1 ? 'dia' : 'dias'}` : o.dur_modo === 'continuo' ? ', uso contínuo' : o.dur_modo === 'outra' && o.dur_texto ? `, ${o.dur_texto}` : '';
  return `${verbo}${dose}${viaTxt}${freq}${dur}.`;
}
// Mexeu num campo: se o texto não foi editado à mão, ele acompanha os campos. Devolve o item com a posologia em dia.
export function comPosologia(it) {
  if (it?.posologia_manual === true && String(it?.posologia ?? '').trim()) return { ...it };
  return { ...it, posologia: gerarPosologia(it), posologia_manual: false };
}
// O médico digitou no modo de usar: vira "editado à mão" se ficou diferente do texto gerado.
export function comPosologiaDigitada(it, texto) {
  const t = txt(texto, LIMITES.posologia);
  return { ...it, posologia: t, posologia_manual: t.trim() !== '' && t.trim() !== gerarPosologia(it) };
}

/* ===================== o que sai impresso (formato da receita simples) ===================== */
export function duracaoTexto(it) {
  const o = arrumarItem(it);
  return o.dur_modo === 'dias' && o.dur_n ? `${o.dur_n} ${o.dur_n === 1 ? 'dia' : 'dias'}` : o.dur_modo === 'continuo' ? 'uso contínuo' : o.dur_modo === 'outra' ? (o.dur_texto || '') : '';
}
export function medicamentoImpresso(it) {
  const o = arrumarItem(it);
  if (!ehManipulado(o)) return o.medicamento || '';
  return `${o.medicamento ? `${o.medicamento} (fórmula manipulada): ` : 'Fórmula manipulada: '}${o.composicao || ''}`;
}
export function paraImpresso(it) {
  const o = arrumarItem(it);
  return {
    medicamento: ehManipulado(o) && !o.composicao ? '' : medicamentoImpresso(o),
    concentracao: ehManipulado(o) && !o.concentracao ? 'conforme a fórmula' : (o.concentracao || ''),
    forma: o.forma || '', via: viaRotulo(o.via, o.via_outra), posologia: o.posologia || '', quantidade: o.quantidade || '',
    duracao: duracaoTexto(o), observacao: o.orientacoes || '',
  };
}
export const listaImpressa = (itens) => (Array.isArray(itens) ? itens : []).map(paraImpresso);
// De uma receita já emitida (formato impresso) para os campos: o texto entra como "editado à mão" (não dá para
// adivinhar dose e frequência de um texto livre).
export function deImpresso(p) {
  const via = oneLine(p?.via).toLowerCase();
  const cod = VIAS.find(([id, rot]) => id !== 'outra' && (rot === via || id === via))?.[0];
  const dur = oneLine(p?.duracao);
  const dias = /^(\d{1,3}) dias?$/.exec(dur);
  return arrumarItem({
    tipo: 'industrializado', medicamento: p?.medicamento, concentracao: p?.concentracao, forma: p?.forma,
    via: cod || (via ? 'outra' : ''), via_outra: cod ? '' : via,
    posologia: p?.posologia, posologia_manual: true, quantidade: p?.quantidade,
    ...(dias ? { dur_modo: 'dias', dur_n: Number(dias[1]) } : dur.toLowerCase() === 'uso contínuo' ? { dur_modo: 'continuo' } : dur ? { dur_modo: 'outra', dur_texto: dur } : {}),
    orientacoes: p?.observacao,
  });
}

/* ===================== mexer na lista ===================== */
export function mover(itens, i, passo) {
  const j = i + passo;
  if (!Array.isArray(itens) || i < 0 || j < 0 || i >= itens.length || j >= itens.length) return itens;
  const lista = itens.slice();
  [lista[i], lista[j]] = [lista[j], lista[i]];
  return lista;
}
export function duplicar(itens, i) {
  if (!Array.isArray(itens) || !itens[i] || itens.length >= MAX_ITENS) return itens;
  return [...itens.slice(0, i + 1), { ...itens[i] }, ...itens.slice(i + 1)];
}
// Juntar os itens de um modelo (ou de uma receita emitida) aos que já estão na tela, sem passar de 20.
export function acrescentar(itens, novos) {
  const atuais = (Array.isArray(itens) ? itens : []).filter((it) => !itemVazio(it));
  return [...atuais, ...(Array.isArray(novos) ? novos : []).map(arrumarItem).filter((it) => !itemVazio(it))].slice(0, MAX_ITENS);
}

/* ===================== a lista de controle ===================== */
const dobrar = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
// A lista que a tela já tinha (para o banco de antes): os mesmos nomes da carga inicial do banco.
const CAT = { 'antibiótico': 'antimicrobiano', 'caneta GLP-1': 'glp1', 'remédio controlado (Portaria 344)': 'portaria_344' };
export const regrasPadrao = () => RX_ALERTS.flatMap((g) => g.names.map((nome) => ({ nome, lista: CAT[g.cat] })));
// A resposta de cat_regras_receita. null = não veio.
export function normalizeRegras(raw) {
  if (!raw || raw.ok !== true || !Array.isArray(raw.itens)) return null;
  return raw.itens.filter((r) => r && /^[a-z0-9]+( [a-z0-9]+)*$/.test(String(r.nome ?? '')) && LISTA_ROTULO[r.lista]).map((r) => ({ nome: r.nome, lista: r.lista }));
}
// Itens (no formato impresso) com nome da lista, como palavra inteira; o nome mais comprido ganha. Igual a
// private.rx_conferir: [{n, nome, termo, lista}].
export function conferirLista(impressos, regras) {
  const lista = (Array.isArray(regras) ? regras : []).slice().sort((a, b) => b.nome.length - a.nome.length || a.nome.localeCompare(b.nome));
  const out = [];
  (Array.isArray(impressos) ? impressos : []).forEach((it, i) => {
    const texto = dobrar(it?.medicamento);
    const r = lista.find((x) => new RegExp(`(^|[^a-z0-9])${x.nome}([^a-z0-9]|$)`).test(texto));
    if (r) out.push({ n: i + 1, nome: oneLine(it?.medicamento).slice(0, 200), termo: r.nome, lista: r.lista });
  });
  return out;
}
export function textoBloqueio(bate) {
  const lista = (Array.isArray(bate) ? bate : []).filter((b) => b && LISTA_ROTULO[b.lista]);
  if (!lista.length) return '';
  const partes = lista.map((b) => `item ${b.n} (“${b.termo}”: ${LISTA_ROTULO[b.lista]})`);
  return `${lista.length === 1 ? 'Este item não sai' : 'Estes itens não saem'} pelo IMED: ${partes.join('; ')}. Antibiótico, caneta GLP-1 e remédio controlado precisam de receita com retenção, pelo sistema da Anvisa (SNCR). Tire o item desta receita e prescreva pela Plataforma de Prescrição Eletrônica do CFM ou em papel.`;
}
export const AVISO_LISTA = 'O IMED confere uma lista curta de nomes conhecidos e só serve para travar: não classifica remédio. A responsabilidade de saber se o remédio exige retenção continua sendo do médico.';

/* ===================== a lista de controle na mão da equipe (cat_regra_listar/lancar/retirar) ===================== */
export const LISTAS = Object.keys(LISTA_ROTULO);
// Como o banco guarda o nome: sem acento, em minúscula, um espaço só.
export const nomeDeBusca = (s) => dobrar(s).trim();
// O que a equipe digitou para lançar um nome. { ok, nome, lista, fonte } ou { campo, texto } (as mesmas regras de
// public.cat_regra_lancar: nome só com letras e números, de 3 a 60; fonte de 5 a 300).
export function validarRegra(nome, lista, fonte) {
  const n = nomeDeBusca(nome);
  if (!/^[a-z0-9]+( [a-z0-9]+)*$/.test(n) || n.length < 3 || n.length > 60) return { campo: 'nome', texto: 'Escreva o nome só com letras e números (de 3 a 60), sem dose nem pontuação. Exemplo: amoxicilina.' };
  if (!LISTA_ROTULO[lista]) return { campo: 'lista', texto: 'Escolha a lista.' };
  const f = oneLine(typeof fonte === 'string' ? fonte : '');
  if (f.length < 5 || f.length > 300) return { campo: 'fonte', texto: 'Diga de onde vem a regra (norma, bula ou lista oficial), em 5 a 300 letras.' };
  return { ok: true, nome: n, lista, fonte: f };
}
export function validarMotivo(motivo) {
  const m = oneLine(typeof motivo === 'string' ? motivo : '');
  return m.length < 5 || m.length > 300 ? { campo: 'motivo', texto: 'Escreva o motivo da retirada (de 5 a 300 letras).' } : { ok: true, motivo: m };
}
// A resposta de cat_regra_listar. null = não veio.
export function normalizeRegrasAdmin(raw) {
  if (!raw || raw.ok !== true || !Array.isArray(raw.itens)) return null;
  const data = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
  const itens = raw.itens.filter((r) => r && typeof r.id === 'string' && typeof r.nome === 'string' && r.nome && LISTA_ROTULO[r.lista]).map((r) => ({
    id: r.id, nome: oneLine(r.nome).slice(0, 60), lista: r.lista, fonte: oneLine(typeof r.fonte === 'string' ? r.fonte : '').slice(0, 300),
    desde: data(r.vigente_desde), retiradaEm: data(r.retirada_em), motivo: oneLine(typeof r.retirada_motivo === 'string' ? r.retirada_motivo : '').slice(0, 300),
  }));
  return { ativas: itens.filter((r) => !r.retiradaEm), retiradas: itens.filter((r) => r.retiradaEm) };
}

/* ===================== respostas do banco ===================== */
export function normalizeAbrir(raw) {
  if (!raw || raw.ok !== true) return null;
  const r = raw.rascunho && typeof raw.rascunho === 'object' && Number.isInteger(raw.rascunho.versao) ? raw.rascunho : null;
  return {
    podeEditar: raw.pode_editar === true,
    versao: r ? r.versao : 0,
    conteudo: r ? conteudo(r.conteudo?.itens, r.conteudo?.observacao) : null,
    emitidas: (Array.isArray(raw.emitidas) ? raw.emitidas : []).filter((e) => e && typeof e === 'object' && e.conteudo && typeof e.conteudo === 'object').map((e) => ({
      id: String(e.id ?? ''), emitidaEm: typeof e.emitida_em === 'string' ? e.emitida_em : null, cancelada: e.documento_situacao === 'cancelado',
      conteudo: conteudo(e.conteudo.itens, e.conteudo.observacao),
    })),
  };
}
export function normalizeModelos(raw) {
  if (!raw || raw.ok !== true || !Array.isArray(raw.itens)) return null;
  return raw.itens.filter((m) => m && typeof m.id === 'string' && oneLine(m.nome) && m.conteudo && typeof m.conteudo === 'object').slice(0, MAX_MODELOS)
    .map((m) => ({ id: m.id, nome: oneLine(m.nome).slice(0, 80), conteudo: conteudo(m.conteudo.itens, m.conteudo.observacao) }));
}
// O campo que o banco apontou ('itens.2.dur_n') como a tela chama ('itens.2.duracao').
const CAMPO = { freq_modo: 'frequencia', freq_n: 'frequencia', freq_texto: 'frequencia', dur_modo: 'duracao', dur_n: 'duracao', dur_texto: 'duracao', orientacoes: 'observacao', unidade: 'dose' };
export function campoDaTela(campo) {
  const m = /^itens\.(\d+)\.([a-z_]+)$/.exec(String(campo ?? ''));
  return m ? `itens.${m[1]}.${CAMPO[m[2]] || m[2]}` : campo === 'itens' || campo === 'observacao' ? campo : null;
}
const ERRO = {
  forbidden: 'Só o médico desta consulta mexe na receita.',
  prazo_encerrado: 'O prazo para mexer na receita desta consulta (24 horas depois de encerrar) terminou.',
  versao_conflito: 'Esta receita foi alterada em outra aba ou aparelho. A tela mostra agora o que está salvo: confira e continue daqui.',
  sem_rascunho: 'Não há receita em rascunho para emitir. Atualize a página.',
  dados_invalidos: 'Algum campo da receita não está no formato aceito. Confira os campos marcados.',
  limite_modelos: `Você já tem ${MAX_MODELOS} modelos. Apague um para salvar outro.`,
  nome_repetido: 'Você já tem um modelo com esse nome. Escolha outro nome.',
  nao_encontrado: 'Não achamos esse modelo. Ele pode ter sido apagado em outra aba.',
  ja_existe: 'Esse nome já está na lista.',
  forbidden_admin: 'Só a equipe do IMED mexe nesta lista.',
};
export const erroTexto = (erro, padrao = 'Não foi possível concluir agora. Confira a internet e tente de novo.') => ERRO[erro] || padrao;
