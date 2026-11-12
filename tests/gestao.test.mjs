// Testes das regras puras do painel de gestão (assets/js/gestao-core.js) e da página gestao.html:
// R$ e números (Intl pt-BR), datas no fuso de São Paulo, a resposta do banco (null vira "—", zero é zero), o bloco
// "Agora" (a fila da teleconsulta neste momento: só as 4 contagens, sem a chave não aparece, frase curta para o leitor
// de tela, a hora do banco com há quanto tempo os números chegaram), os gráficos
// em SVG (linhas, colunas e barras: resumo para leitor de tela, nada fora do desenho, nada de NaN), funil, fluxograma
// da entrada de médicos, validação do formulário "Nova cobrança" e a planilha CSV (aspas, ponto e vírgula e fórmulas).
// A página: só para a equipe (fora do Google, fora do mapa do site, sem o contador de visitas, nenhuma página pública
// aponta para ela) e os ícones que ela usa estão no recorte do site.
// Rodar com: node --test tests/gestao.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../assets/js/gestao-core.js';
import { KINDS } from '../assets/js/tele-docs.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const sp = (s) => String(s).replace(/\s/g, ' '); // o Intl separa "R$" do número com espaço fixo
// O arquivo da migração pelo fim do nome (a versão do começo muda quando ela é aplicada na produção).
const migracao = (fim) => `supabase/migrations/${readdirSync(join(ROOT, 'supabase/migrations')).find((f) => f.endsWith(fim))}`;
const svgOk = (svg) => {
  assert.ok(!/NaN|undefined|Infinity|null/.test(svg), `SVG sem NaN/undefined: ${svg.slice(0, 200)}`);
  assert.match(svg, /^<svg class="gs-svg[^"]*" viewBox="0 0 \d+ \d+" width="\d+" height="\d+" role="img" aria-label="[^"]*">/);
  assert.ok(svg.endsWith('</svg>'));
};
// Onde cada texto do SVG fica (estimado como a página faz): não pode passar das bordas.
function textsInside(svg, W) {
  for (const m of svg.matchAll(/<text class="([\w-]+)" x="([\d.-]+)" y="[\d.-]+"(?: text-anchor="(\w+)")?>([^<]*)<\/text>/g)) {
    const [, cls, xs, anchor = 'start', raw] = m;
    const t = raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const size = cls === 'gs-tick' ? 11.5 : cls === 'gs-peak' ? 12 : 13;
    const w = G.textW(t, size, cls !== 'gs-tick');
    const x = Number(xs);
    const [l, r] = anchor === 'end' ? [x - w, x] : anchor === 'middle' ? [x - w / 2, x + w / 2] : [x, x + w];
    assert.ok(l >= -0.5 && r <= W + 0.5, `"${t}" (${cls}) sai do desenho: ${l.toFixed(1)}..${r.toFixed(1)} de 0..${W}`);
  }
}
const days = (n, ate = '2026-10-30') => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${ate}T12:00:00Z`) - (n - 1 - i) * 86400000).toISOString().slice(0, 10));

/* ======================= números e datas ======================= */
test('R$, números e porcentagens em pt-BR; sem número: "—"; zero é zero', () => {
  assert.equal(sp(G.fmtBRL(123456)), 'R$ 1.234,56');
  assert.equal(sp(G.fmtBRL(0)), 'R$ 0,00');
  assert.equal(sp(G.fmtBRL(1)), 'R$ 0,01');
  assert.equal(sp(G.fmtBRL(100000000)), 'R$ 1.000.000,00');
  for (const v of [null, undefined, NaN, '12', Infinity]) assert.equal(G.fmtBRL(v), '—', String(v));
  assert.equal(sp(G.fmtBRLCurto(2500)), 'R$ 2,5 mil');
  assert.equal(sp(G.fmtBRLCurto(0)), 'R$ 0');
  assert.equal(G.fmtInt(1234567), '1.234.567');
  assert.equal(G.fmtInt(0), '0');
  assert.equal(G.fmtInt(null), '—');
  assert.equal(G.pct(1, 4), 25);
  assert.equal(G.pct(3, 0), null, 'sem a etapa anterior: não dá para calcular');
  assert.equal(G.pct(null, 4), null);
  assert.equal(G.pct(0, 4), 0);
  assert.deepEqual([40, 2.5, 99.6, 100, 0, 0.01, 140, null].map(G.fmtPct), ['40%', '2,5%', '99,6%', '100%', '0%', 'menos de 0,1%', '140%', '—']);
  // Quase tudo não vira "100%": de 99 a 100 corta na primeira casa.
  assert.deepEqual([99.96, 99.95, 99.99, 99.999999, 99.3, 99.0001].map(G.fmtPct), ['99,9%', '99,9%', '99,9%', '99,9%', '99,3%', '99%']);
  assert.equal(G.fmtPct(G.pct(9999, 10000)), '99,9%', '9.999 de 10.000 não é 100%');
  assert.deepEqual([0.4, 7.5, 59.6, 75, 120, null, -1].map(G.fmtMin), ['menos de 1 min', '8 min', '1 h', '1 h 15 min', '2 h', '—', '—']);
  assert.deepEqual([0.5, 1, 30.5, 47, 60, null].map(G.fmtHoras), ['menos de 1 hora', '1 hora', '31 horas', '47 horas', '2,5 dias', '—']);
  assert.equal(G.fmtNota(4.666), '4,7 de 5');
  assert.equal(G.fmtNota(null), '—');
  assert.equal(G.plural(1, 'cobrança', 'cobranças'), '1 cobrança');
  assert.equal(G.plural(2, 'cobrança', 'cobranças'), '2 cobranças');
  assert.equal(G.plural(null, 'cobrança', 'cobranças'), '— cobranças');
});

test('valor digitado em reais vira centavos inteiros (vazio: null; inválido: NaN)', () => {
  const ok = { 150: 15000, '150,00': 15000, '1.234,56': 123456, 'R$ 1.234,56': 123456, 'R$ 99,9': 9990, '1234.5': 123450, '1.234': 123400, '0,29': 29, ' 12 ': 1200, '1.000.000,00': 100000000 };
  for (const [v, c] of Object.entries(ok)) assert.equal(G.parseReais(v), c, v);
  assert.equal(G.parseReais(''), null);
  assert.equal(G.parseReais('   '), null);
  assert.equal(G.parseReais(null), null);
  for (const v of ['abc', '-10', '1,234,56', '0,001', '12,3.4', '1.2.3,45', '12.34,5', '1e3', '10 reais']) assert.ok(Number.isNaN(G.parseReais(v)), v);
  assert.equal(G.parseReais('R$'), null, 'só o "R$": vazio');
  assert.equal(G.parseReais('1,5'), 150);
  assert.equal(G.parseReais('1234,56'), 123456);
  assert.equal(G.centsPlanilha(123456), '1234,56');
  assert.equal(G.centsPlanilha(5), '0,05');
  assert.equal(G.centsPlanilha(100000000), '1000000,00');
  // Prévia antes de registrar: "1.500" e "1.50" ficam bem diferentes; vazio, inválido ou fora do limite: nada.
  assert.equal(sp(G.previaValor('1.500')), 'Vai registrar R$ 1.500,00.');
  assert.equal(sp(G.previaValor('1.50')), 'Vai registrar R$ 1,50.');
  assert.equal(sp(G.previaValor('R$ 99,9')), 'Vai registrar R$ 99,90.');
  for (const v of ['', '  ', 'abc', '0', '0,00', '1.000.000,01', null]) assert.equal(G.previaValor(v), '', String(v));
});

test('datas: dia de São Paulo, data de verdade, nomes curtos e longos, há quanto tempo', () => {
  assert.equal(G.todaySP(Date.parse('2026-10-30T02:59:00Z')), '2026-10-29', 'antes das 3h UTC ainda é o dia anterior em São Paulo');
  assert.equal(G.todaySP(Date.parse('2026-10-30T03:00:00Z')), '2026-10-30');
  assert.ok(G.isIsoDay('2028-02-29'));
  for (const v of ['2026-02-30', '2026-13-01', '2026-1-01', '30/10/2026', '', null]) assert.equal(G.isIsoDay(v), false, String(v));
  assert.equal(G.shortDay('2026-10-05'), '05/10');
  assert.equal(G.fullDay('2026-10-05'), '05/10/2026');
  assert.equal(G.shortDay('x'), '—');
  assert.equal(G.weekDay('2026-10-30'), 'sex, 30/10/2026');
  assert.equal(G.weekDay('2026-11-01'), 'dom, 01/11/2026');
  assert.equal(G.monthLabel('2026-10'), 'out/26');
  assert.equal(G.monthLong('2025-11'), 'novembro de 2025');
  assert.equal(G.monthLabel('2026-13'), '2026-13');
  assert.equal(G.fmtDateTime('2026-10-29T12:00:00Z'), '29/10/2026 às 09:00');
  assert.equal(G.fmtDateTime(null), '—');
  assert.equal(G.fmtDateTime('ontem'), '—');
  assert.equal(G.fmtHora('2026-10-30T15:00:00Z'), '12:00');
  const now = Date.parse('2026-10-30T15:00:00Z');
  assert.equal(G.sinceText('2026-10-30T14:59:40Z', now), 'agora há pouco');
  assert.equal(G.sinceText('2026-10-30T14:15:00Z', now), 'há 45 min');
  assert.equal(G.sinceText('2026-10-29T12:00:00Z', now), 'há 27 h');
  assert.equal(G.sinceText('2026-10-28T09:30:00Z', now), 'há 2 dias');
  assert.equal(G.sinceText(null, now), '');
  // Data do pagamento: informada só com o dia (meia-noite de São Paulo no banco) aparece sem hora inventada.
  assert.equal(G.fmtPagoEm('2026-10-25T03:00:00Z'), '25/10/2026');
  assert.equal(G.fmtPagoEm('2026-10-30T15:00:00Z'), '30/10/2026 às 12:00');
  assert.equal(G.fmtPagoEm('2026-10-30T03:00:01Z'), '30/10/2026 às 00:00', 'com segundos: houve hora');
  assert.equal(G.fmtPagoEm(null), '—');
});

/* ======================= resposta do banco ======================= */
// O exemplo do contrato de public.admin_gestao.
const RAW = {
  dias: 3, de: '2026-10-28', ate: '2026-10-30', gerado_em: '2026-10-30T15:00:00Z',
  serie: [
    { dia: '2026-10-30', visitas: 60, pedidos: 1, tele_pedidas: 0, tele_encerradas: 0, documentos: 0 },
    { dia: '2026-10-28', visitas: 200, pedidos: 2, tele_pedidas: 1, tele_encerradas: 1, documentos: 2 },
    { dia: '2026-10-29', visitas: 1000, pedidos: 0, tele_pedidas: 2, tele_encerradas: 1, documentos: 1 },
    { dia: '2026-10-29', visitas: 5, pedidos: 9, tele_pedidas: 9, tele_encerradas: 9, documentos: 9 },
    { dia: 'ontem', visitas: 1 },
  ],
  pacientes: {
    atendidos: 3,
    pedidos: { total: 3, pendente: 1, contatado: 0, confirmado: 1, cancelado: 0, concluido: 1, presente: 0, faltou: 0, remarcacao: 0, parceiro: 2, concierge: 1 },
    tele: { total: 3, aguardando: 0, aceita: 0, em_atendimento: 0, encerrada: 2, cancelada: 1, expirada: 0, espera_media_min: null, duracao_media_min: 12.5 },
    documentos: { total: 3, por_tipo: { exames: 2, receita: 1, atestado: 0, comparecimento: 0, encaminhamento: 0, relatorio: 0, orientacoes: 0 }, cancelados: 0, pdf_assinado: 1 },
    avaliacoes: { total: 0, media: null },
  },
  funil: { visitas: 1260, abriram_busca: 300, abriram_local: 120, pedidos: 3, confirmados: 2, concluidos: 1, abriram_tele: 50, tele_fila: 3, tele_atendidas: 2, tele_encerradas: 2, tele_com_documento: 1 },
  medicos: { inscritos_periodo: 2, pendente: 1, aprovado: 4, recusado: 0, suspenso: 1, disponiveis_agora: null, aprovacao_media_horas: null,
    aguardando: [{ id: 'd1', nome: ' Dra. Ana ', crm: '123456', uf: 'sp', especialidade: '', desde: '2026-10-29T12:00:00Z' }, null, 'x'] },
  clinicas: { parceiras: 7, com_agenda: 3, com_preco: 5, interessadas: 11, reivindicacoes: { pendente: 2, aprovado: 7, recusado: 1 } },
  outros: { lista_espera: 40, contatos: 6, avisos_de_erro: 2 },
  cobranca: { faturado_cents: 49900, a_receber_cents: 33950, atrasado_cents: 8900, cancelado_cents: 15000, qtd_pagas: 1, qtd_pendentes: 2,
    por_mes: [{ mes: '2026-10', faturado_cents: 49900, a_receber_cents: 8900 }, { mes: '2026-09', faturado_cents: 0, a_receber_cents: 0 }, { mes: 'out', faturado_cents: 1 }] },
};

test('resposta do banco: série em ordem e sem repetir, null continua null ("—"), zero continua zero', () => {
  const d = G.normalizeGestao(RAW, 30);
  assert.equal(d.dias, 3);
  assert.deepEqual([d.de, d.ate, d.gerado_em], ['2026-10-28', '2026-10-30', '2026-10-30T15:00:00Z']);
  assert.deepEqual(d.serie.map((x) => x.dia), ['2026-10-28', '2026-10-29', '2026-10-30'], 'em ordem, um por dia (o repetido fica de fora)');
  assert.equal(d.serie[1].visitas, 1000);
  assert.equal(d.pacientes.tele.espera_media_min, null);
  assert.equal(d.pacientes.tele.duracao_media_min, 12.5);
  assert.equal(d.pacientes.tele.aguardando, 0);
  assert.equal(d.pacientes.avaliacoes.media, null);
  assert.equal(d.pacientes.documentos.por_tipo.atestado, 0);
  assert.equal(d.medicos.disponiveis_agora, null);
  assert.deepEqual(d.medicos.aguardando, [{ id: 'd1', nome: 'Dra. Ana', crm: '123456', uf: 'SP', especialidade: null, desde: '2026-10-29T12:00:00Z' }]);
  assert.deepEqual(d.cobranca.por_mes.map((x) => x.mes), ['2026-09', '2026-10'], 'meses em ordem, só os válidos');
  assert.equal(d.clinicas.reivindicacoes.pendente, 2);
  assert.equal(d.outros.avisos_de_erro, 2);
  assert.equal(G.somaSerie(d.serie, 'pedidos'), 3);
  assert.equal(G.somaSerie([{ pedidos: null }], 'pedidos'), null, 'nenhum número: null, não zero');
  assert.equal(d.agora, null, 'banco ainda sem a migração nova (sem a chave "agora"): sem o bloco');
});

test('resposta do banco fora do formato: tudo vira null ("—"), nada é inventado', () => {
  for (const raw of [null, undefined, 'erro', 42, [], {}]) {
    const d = G.normalizeGestao(raw, 7);
    assert.equal(d.dias, 7);
    assert.deepEqual(d.serie, []);
    assert.equal(d.de, null);
    assert.equal(d.pacientes.atendidos, null);
    assert.deepEqual(Object.values(d.pacientes.pedidos), Array(11).fill(null));
    assert.equal(d.funil.visitas, null);
    assert.deepEqual(d.medicos.aguardando, []);
    assert.equal(d.cobranca.faturado_cents, null);
    assert.deepEqual(d.cobranca.por_mes, []);
    assert.equal(d.agora, null);
  }
  const d = G.normalizeGestao({ pacientes: { atendidos: -3, pedidos: { total: '12', pendente: 'muitos', contatado: true, confirmado: '' }, avaliacoes: { total: 2, media: 7 } } });
  assert.equal(d.pacientes.atendidos, null, 'negativo não é contagem');
  assert.equal(d.pacientes.pedidos.total, 12);
  assert.equal(d.pacientes.pedidos.pendente, null);
  assert.equal(d.pacientes.pedidos.contatado, null);
  assert.equal(d.pacientes.pedidos.confirmado, null);
  assert.equal(d.pacientes.avaliacoes.media, null, 'média fora de 1 a 5');
  const muitos = G.normalizeGestao({ medicos: { aguardando: Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, nome: `M ${i}` })) } });
  assert.equal(muitos.medicos.aguardando.length, 50, 'no máximo 50 aguardando');
  assert.equal(muitos.medicos.aguardando[0].desde, null);
});

/* ======================= agora: a teleconsulta neste momento ======================= */
// O exemplo do contrato da chave "agora" de admin_gestao (migração 20261030191354_painel_medico).
const AGORA = { aguardando: 3, espera_mais_longa_min: 12, em_atendimento: 1, medicos_disponiveis: 0 };

test('agora: só as 4 contagens da chave "agora" (nada de nome, idade ou motivo); sem a chave ou sem número, null (o bloco não aparece)', () => {
  assert.deepEqual(G.AGORA_KEYS, ['aguardando', 'espera_mais_longa_min', 'em_atendimento', 'medicos_disponiveis']);
  assert.deepEqual(G.normalizeAgora(AGORA), AGORA);
  assert.deepEqual(G.normalizeGestao({ ...RAW, agora: AGORA }).agora, AGORA, 'vem junto com o resto da página');
  assert.deepEqual(G.normalizeAgora({ aguardando: 0, espera_mais_longa_min: null, em_atendimento: 0, medicos_disponiveis: 0 }), { aguardando: 0, espera_mais_longa_min: null, em_atendimento: 0, medicos_disponiveis: 0 }, 'banco novo: zero é zero');
  // LGPD: mesmo que a resposta trouxesse quem está na fila, só as contagens passam.
  const extra = G.normalizeAgora({ ...AGORA, fila: [{ nome: 'Maria Paciente', idade: 47, motivo: 'dor no peito' }], nome: 'João' });
  assert.deepEqual(Object.keys(extra), G.AGORA_KEYS);
  assert.ok(!/Maria|João|dor|47/.test(JSON.stringify(extra)));
  // Sem a chave, fora do formato ou sem nenhum número: null.
  for (const v of [undefined, null, 'agora', 3, true, [], [AGORA], {}, { outra: 1 }, { aguardando: -1, espera_mais_longa_min: 'muito', em_atendimento: '', medicos_disponiveis: false }]) {
    assert.equal(G.normalizeAgora(v), null, JSON.stringify(v));
  }
  // Parte faltando: só ela fica "—" (null); número em texto vale (como no resto da resposta).
  assert.deepEqual(G.normalizeAgora({ aguardando: '2', medicos_disponiveis: 1, em_atendimento: -3 }), { aguardando: 2, espera_mais_longa_min: null, em_atendimento: null, medicos_disponiveis: 1 });
  // Ninguém na fila: não há espera, mesmo que viesse um número.
  assert.equal(G.normalizeAgora({ ...AGORA, aguardando: 0, espera_mais_longa_min: 5 }).espera_mais_longa_min, null);
  assert.equal(G.normalizeAgora({ ...AGORA, aguardando: null, espera_mais_longa_min: 5 }).espera_mais_longa_min, 5, 'sem o número da fila: a espera do banco fica');
});

test('agora: os 4 números com nome e explicação ("—" sem número); paciente esperando sem médico disponível fica em destaque', () => {
  const it = G.agoraItens(AGORA);
  assert.deepEqual(it.map((x) => [x.id, x.label, x.value, x.sub, x.warn]), [
    ['agora-aguardando', 'Aguardando atendimento', '3', 'pacientes na fila, esperando um médico aceitar', true],
    ['agora-espera', 'Espera mais longa', '12\u00a0min', 'do primeiro paciente da fila', false],
    ['agora-atendimento', 'Em atendimento', '1', 'consulta aceita por um médico ou em andamento', false],
    ['agora-medicos', 'Médicos disponíveis', '0', 'aprovados com o “Disponível” ligado (pode incluir quem está em consulta)', false],
  ]);
  // A explicação embaixo do número no singular quando ele é 1 (nunca "1 / pacientes na fila").
  assert.deepEqual(G.agoraItens({ aguardando: 1, espera_mais_longa_min: 3, em_atendimento: 2, medicos_disponiveis: 1 }).map((x) => x.sub), [
    'paciente na fila, esperando um médico aceitar', 'do primeiro paciente da fila', 'consultas aceitas por um médico ou em andamento', 'aprovado com o “Disponível” ligado (pode estar em consulta)',
  ]);
  // "Disponível" é o botão "Disponível para atender" da área do médico (página aberta não basta) e aceitar um paciente
  // não desliga: o número pode incluir médico em consulta, e a explicação diz isso.
  assert.ok(G.agoraItens(AGORA).every((x) => !/página de atendimento aberta/.test(x.sub)));
  const vazio = G.agoraItens(G.normalizeAgora({ aguardando: 0, espera_mais_longa_min: null, em_atendimento: 0, medicos_disponiveis: 0 }));
  assert.deepEqual(vazio.map((x) => x.value), ['0', '—', '0', '0']);
  assert.equal(vazio[1].sub, 'ninguém na fila agora');
  assert.ok(vazio.every((x) => !x.warn), 'ninguém esperando: sem destaque, mesmo sem médico');
  assert.deepEqual(G.agoraItens({ aguardando: null, espera_mais_longa_min: null, em_atendimento: null, medicos_disponiveis: 2 }).map((x) => x.value), ['—', '—', '—', '2']);
  assert.deepEqual(G.agoraItens(null).map((x) => x.value), ['—', '—', '—', '—']);
  // Espera: em minutos inteiros (de 0 até perto das 2 h, quando o pedido expira). Número e unidade com espaço que não
  // quebra: se a linha quebrar, fica "1 h" e "59 min" (nunca "1 h 59" e "min").
  const espera = (m) => G.agoraItens({ ...AGORA, espera_mais_longa_min: m })[1].value;
  assert.deepEqual([0, 1, 59, 60, 119].map(espera), ['menos de 1\u00a0min', '1\u00a0min', '59\u00a0min', '1\u00a0h', '1\u00a0h 59\u00a0min']);
  assert.deepEqual([0, 119].map((m) => espera(m).replace(/\u00a0/g, ' ')), ['menos de 1 min', '1 h 59 min'], 'na tela, o mesmo texto de sempre');
  assert.equal(espera(null), '—');
  // Destaque só com paciente esperando e o número de médicos igual a zero (sem o número: sem destaque inventado).
  assert.equal(G.agoraSemMedico(AGORA), true);
  for (const a of [{ ...AGORA, medicos_disponiveis: 1 }, { ...AGORA, medicos_disponiveis: null }, { ...AGORA, aguardando: 0 }, { ...AGORA, aguardando: null }, null, undefined]) assert.equal(G.agoraSemMedico(a), false, JSON.stringify(a));
});

test('agora: frase curta e em português simples para o leitor de tela (singular, plural, zero e sem número)', () => {
  assert.deepEqual([0, 0.4, 1, 12, 60, 61, 75, 119, 120, null, -1].map(G.fmtMinFala),
    ['menos de 1 minuto', 'menos de 1 minuto', '1 minuto', '12 minutos', '1 hora', '1 hora e 1 minuto', '1 hora e 15 minutos', '1 hora e 59 minutos', '2 horas', '', '']);
  assert.equal(G.agoraTexto(AGORA), 'Agora: 3 pacientes aguardando atendimento (o primeiro espera há 12 minutos), 1 consulta em atendimento e nenhum médico disponível.');
  assert.equal(G.agoraTexto({ aguardando: 1, espera_mais_longa_min: 0, em_atendimento: 2, medicos_disponiveis: 1 }), 'Agora: 1 paciente aguardando atendimento (espera há menos de 1 minuto), 2 consultas em atendimento e 1 médico disponível.');
  assert.equal(G.agoraTexto(G.normalizeAgora({ aguardando: 0, espera_mais_longa_min: null, em_atendimento: 0, medicos_disponiveis: 3 })), 'Agora: nenhum paciente aguardando atendimento, nenhuma consulta em atendimento e 3 médicos disponíveis.');
  assert.equal(G.agoraTexto({ aguardando: 1234, espera_mais_longa_min: null, em_atendimento: 1, medicos_disponiveis: 2 }), 'Agora: 1.234 pacientes aguardando atendimento, 1 consulta em atendimento e 2 médicos disponíveis.');
  assert.equal(G.agoraTexto({ aguardando: null, espera_mais_longa_min: 75, em_atendimento: null, medicos_disponiveis: null }), 'Agora: sem o número de pacientes aguardando (o primeiro da fila espera há 1 hora e 15 minutos), sem o número de consultas em atendimento e sem o número de médicos disponíveis.');
  for (const v of [null, undefined, 'x']) assert.equal(G.agoraTexto(v), '', String(v));
  // A frase não leva hora (mudaria a cada atualização e seria lida de novo sem nada ter mudado).
  assert.ok(!/\d\d:\d\d/.test(G.agoraTexto(AGORA)));
});

test('agora: a hora do bloco é a do banco e diz há quanto tempo os números chegaram (e a data, se já for outro dia)', () => {
  const T = '2026-10-30T15:00:00Z'; // 12:00 em São Paulo
  const min = 60000;
  assert.equal(G.AGORA_VELHO_MIN, 2);
  // Acabaram de chegar (ou menos de 2 min): só a hora do banco.
  for (const idade of [0, undefined, null, 30e3, 2 * min - 1]) assert.equal(G.agoraHora(T, idade), 'Atualizado às 12:00', String(idade));
  // 2 min ou mais com a página parada: há quanto tempo (medido aqui pela diferença de dois Date.now()).
  assert.equal(G.agoraHora(T, 2 * min), 'Atualizado às 12:00 (há 2 min)');
  assert.equal(G.agoraHora(T, 59 * min), 'Atualizado às 12:00 (há 59 min)');
  assert.equal(G.agoraHora(T, 60 * min), 'Atualizado às 12:00 (há 1 h)');
  assert.equal(G.agoraHora(T, 11 * 60 * min), 'Atualizado às 12:00 (há 11 h)');
  // Passou da meia-noite de São Paulo (pela hora do banco mais o tempo que passou): com a data.
  assert.equal(G.agoraHora(T, 12 * 60 * min), 'Atualizado em 30/10 às 12:00 (há 12 h)');
  assert.equal(G.agoraHora('2026-10-31T02:50:00Z', 15 * min), 'Atualizado em 30/10 às 23:50 (há 15 min)');
  assert.equal(G.agoraHora('2026-10-31T02:50:00Z', 9 * min), 'Atualizado às 23:50 (há 9 min)', 'ainda 23:59: mesmo dia');
  assert.equal(G.agoraHora(T, 3 * 24 * 60 * min), 'Atualizado em 30/10 às 12:00 (há 3 dias)');
  // Relógio do aparelho voltou (diferença negativa) ou fora do formato: sem "há" inventado.
  assert.equal(G.agoraHora(T, -5 * min), 'Atualizado às 12:00');
  assert.equal(G.agoraHora(T, NaN), 'Atualizado às 12:00');
  // Sem a hora do banco: nada (nunca a hora do relógio daqui).
  for (const v of [null, undefined, '', 'ontem']) assert.equal(G.agoraHora(v, 5 * min), '', String(v));
});

test('funil: % de cada etapa sobre a anterior e sobre a primeira; sem a anterior, null', () => {
  const f = G.funnel([{ label: 'a', value: 200 }, { label: 'b', value: 50 }, { label: 'c', value: 0 }, { label: 'd', value: 3 }, { label: 'e', value: null }]);
  assert.deepEqual(f.map((x) => x.pctPrev), [null, 25, 0, null, null]);
  assert.deepEqual(f.map((x) => x.pctFirst), [100, 25, 0, 1.5, null]);
  assert.equal(G.funnel([{ label: 'a', value: 0 }])[0].pctFirst, null);
  assert.equal(G.resumoFunil('Agendamento', f.slice(0, 2)), 'Agendamento: a 200 e b 50 (25% da etapa anterior).');
  assert.deepEqual(G.FUNIL_AGENDA.map(([k]) => k), ['abriram_busca', 'abriram_local', 'pedidos', 'confirmados', 'concluidos']);
  assert.deepEqual(G.FUNIL_TELE.map(([k]) => k), ['abriram_tele', 'tele_fila', 'tele_atendidas', 'tele_encerradas', 'tele_com_documento']);
});

test('tipos de documento: todos os da teleconsulta têm nome; tipo novo entra no fim pelo nome', () => {
  assert.deepEqual(G.DOC_TIPOS.map(([k]) => k), KINDS.map((k) => k.id), 'os mesmos tipos e na mesma ordem de tele-docs.js');
  assert.deepEqual(G.docRows({ receita: 1, exames: 2, laudo_novo: 4, atestado: 'x' }).map((r) => [r.label, r.value]),
    [['Pedido de exames', 2], ['Receita', 1], ['Atestado', null], ['laudo_novo', 4]]);
  assert.deepEqual(G.docRows(null), []);
});

/* ======================= gráficos ======================= */
test('linhas: resumo para leitor de tela (escapado), um caminho por série, uma faixa por dia, nada fora do desenho', () => {
  const ds = days(30);
  const series = [
    { label: 'Pedidos', cls: 'gs-c1', values: ds.map((_, i) => i % 4) },
    { label: 'Tele <b>', cls: 'gs-c2', values: ds.map((_, i) => (i === 10 ? null : i % 2)) },
  ];
  for (const W of [320, 640, 1100]) {
    const svg = G.lineSvg({ width: W, days: ds, series, label: 'Resumo <img src=x onerror=1> "aspas"' });
    svgOk(svg);
    assert.match(svg, /aria-label="Resumo &lt;img src=x onerror=1&gt; &quot;aspas&quot;"/);
    assert.ok(svg.includes(`viewBox="0 0 ${W} 220"`), 'desenhado na largura pedida');
    assert.equal((svg.match(/class="gs-line /g) || []).length, 2);
    assert.equal((svg.match(/class="gs-hit"/g) || []).length, 30);
    assert.match(svg, /data-tip="sex, 30\/10\/2026\nPedidos: 1\nTele &lt;b&gt;: 1"/, 'balão com todas as séries do dia (escapado)');
    assert.equal((svg.match(/<path class="gs-line gs-c2" d="([^"]+)"/)[1].match(/M/g) || []).length, 2, 'o dia sem número interrompe a linha');
    textsInside(svg, W);
  }
  // muitos dias: sem bolinhas; com poucos, bolinhas de 8 px
  assert.equal((G.lineSvg({ width: 600, days: days(365), series: [{ label: 'a', cls: 'gs-c1', values: Array(365).fill(1) }] }).match(/<circle/g) || []).length, 0);
  assert.equal((G.lineSvg({ width: 600, days: days(7), series: [{ label: 'a', cls: 'gs-c1', values: [0, 1, 2, 3, 4, 5, 6] }] }).match(/<circle [^>]*r="4"/g) || []).length, 7);
  // uma série com área e o número do dia com mais
  const one = G.lineSvg({ width: 500, days: days(7), series: [{ label: 'Visitas', cls: 'gs-c1', values: [5, 9, 1000, 3, 0, 2, 1] }], area: true, peak: true, label: 'x' });
  svgOk(one);
  assert.equal((one.match(/class="gs-area gs-c1"/g) || []).length, 1);
  assert.match(one, /<text class="gs-peak" [^>]*>1\.000<\/text>/);
  textsInside(one, 500);
  // casos extremos: tudo zero, um dia só, nenhum dia
  svgOk(G.lineSvg({ width: 400, days: days(5), series: [{ label: 'a', cls: 'gs-c1', values: [0, 0, 0, 0, 0] }], label: 'z' }));
  svgOk(G.lineSvg({ width: 400, days: days(1), series: [{ label: 'a', cls: 'gs-c1', values: [3] }], label: 'u' }));
  svgOk(G.lineSvg({ width: 400, days: [], series: [], label: 'v' }));
  assert.ok(G.lineSvg({ width: 50, days: days(3), series: [] }).includes('viewBox="0 0 240 '), 'largura mínima');
});

test('colunas: só valor maior que zero desenha coluna (até 24 px, ponta arredondada), uma faixa por coluna, rótulos sem se encostar', () => {
  const cats = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => ({ label: G.monthLabel(m), tip: G.monthLong(m) }));
  const series = [{ label: 'Faturado', cls: 'gs-c1', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 499, null, 499] }, { label: 'A receber', cls: 'gs-c2', values: Array(11).fill(0).concat([89]) }];
  for (const W of [300, 700, 1100]) {
    const svg = G.columnsSvg({ width: W, cats, series, label: 'Faturamento', fmt: (v) => G.fmtBRL(G.isNum(v) ? v * 100 : null), tickFmt: G.fmtBRLCurto });
    svgOk(svg);
    assert.equal((svg.match(/class="gs-bar /g) || []).length, 3);
    assert.equal((svg.match(/class="gs-hit"/g) || []).length, 12);
    assert.match(svg, /data-tip="setembro de 2026\nFaturado: —\nA receber: R\$ 0,00"/, 'sem número: "—"; zero: R$ 0,00');
    for (const m of svg.matchAll(/class="gs-bar [^"]+" d="M([\d.]+) [\d.]+V[\d.]+Q[\d.]+ [\d.]+ [\d.]+ [\d.]+H[\d.]+Q([\d.]+)/g)) {
      assert.ok(Number(m[2]) - Number(m[1]) <= 24.05, 'coluna fina (até 24 px)');
    }
    textsInside(svg, W);
    const ticks = [...svg.matchAll(/<text class="gs-tick" x="([\d.]+)" y="(\d+)" text-anchor="(\w+)">([^<]+)<\/text>/g)].filter((m) => /\//.test(m[4]));
    assert.equal(ticks.at(-1)[4], 'out/26', 'o mês mais novo sempre aparece');
  }
  // 365 dias: colunas finas, sem uma encostar na outra
  const big = G.columnsSvg({ width: 520, cats: days(365).map((d) => ({ label: G.shortDay(d) })), series: [{ label: 'a', cls: 'gs-c1', values: Array.from({ length: 365 }, (_, i) => i % 3) }] });
  svgOk(big);
  const xs = [...big.matchAll(/class="gs-bar gs-c1" d="M([\d.]+) [\d.]+V[\d.]+Q[\d.]+ [\d.]+ [\d.]+ [\d.]+H([\d.]+)Q([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[3])]);
  assert.ok(xs.length > 200);
  for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i][0] >= xs[i - 1][1], 'colunas separadas');
  textsInside(big, 520);
  const lab = [...big.matchAll(/<text class="gs-tick" x="([\d.]+)" y="(\d+)" text-anchor="(\w+)">(\d\d\/\d\d)<\/text>/g)].map((m) => {
    const x = Number(m[1]); const w = G.textW(m[4], 11.5);
    return m[3] === 'end' ? [x - w, x] : m[3] === 'start' ? [x, x + w] : [x - w / 2, x + w / 2];
  });
  for (let i = 1; i < lab.length; i += 1) assert.ok(lab[i][0] >= lab[i - 1][1] + 4, 'rótulos dos dias sem se encostar');
});

// Coluna: [início, fim] e o espaço de cada coluna (largura do desenho menos o eixo, dividida pelas colunas).
const colunas = (svg) => [...svg.matchAll(/class="gs-bar gs-c\d" d="M([\d.]+) [\d.]+V[\d.]+Q[\d.]+ [\d.]+ [\d.]+ [\d.]+H[\d.]+Q([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const faixas = (svg) => [...svg.matchAll(/<rect class="gs-hit" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)].map((m) => Number(m[2]));

test('colunas numa tela estreita: a coluna nunca passa do espaço do dia (365 dias em 282 px não viram uma mancha)', () => {
  const vals = Array.from({ length: 365 }, (_, i) => 1 + (i % 3));
  const svg = G.columnsSvg({ width: 282, height: 130, cats: days(365).map((d) => ({ label: G.shortDay(d) })), series: [{ label: 'a', cls: 'gs-c1', values: vals }] });
  svgOk(svg);
  const cols = colunas(svg);
  const gw = faixas(svg)[0];
  assert.equal(cols.length, 365);
  assert.ok(gw < 1, `espaço de cada dia: ${gw} px`);
  for (const [a, b] of cols) assert.ok(b - a <= gw * 0.8 + 0.11, `coluna de ${(b - a).toFixed(2)} px num espaço de ${gw} px`);
  for (let i = 1; i < cols.length; i += 1) assert.ok(cols[i][0] >= cols[i - 1][1], 'nenhuma coluna em cima da vizinha');
  textsInside(svg, 282);
  // Agrupadas (faturado e a receber) num espaço estreito: também cabem no mês.
  const duas = G.columnsSvg({ width: 240, cats: Array.from({ length: 40 }, (_, i) => ({ label: String(i) })), series: [{ label: 'a', cls: 'gs-c1', values: Array(40).fill(5) }, { label: 'b', cls: 'gs-c2', values: Array(40).fill(3) }] });
  const g2 = faixas(duas)[0];
  const c2 = colunas(duas).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < c2.length; i += 1) assert.ok(c2[i][0] >= c2[i - 1][1] - 0.11, 'barras do mesmo mês lado a lado, sem se cobrir');
  assert.ok(c2.every(([a, b]) => b - a <= g2 * 0.4 + 0.11), 'cada uma no máximo 40% do mês');
});

test('período longo: colunas por semana (contadas do dia mais novo), somas iguais às do dia a dia, ano no resumo', () => {
  const ds = days(365);
  const serie = ds.map((dia, i) => ({ dia, pedidos: i % 3, tele_pedidas: i === 0 ? null : 1, tele_encerradas: null, documentos: 0 }));
  const sem = G.porSemana(serie, ['pedidos', 'tele_pedidas', 'tele_encerradas', 'documentos']);
  assert.equal(sem.length, 52);
  assert.deepEqual(sem.at(-1), { de: '2026-10-24', ate: '2026-10-30', dias: 7, pedidos: G.somaSerie(serie.slice(-7), 'pedidos'), tele_pedidas: 7, tele_encerradas: null, documentos: 0 }, 'a mais nova termina hoje');
  assert.deepEqual([sem[0].de, sem[0].ate, sem[0].dias], ['2025-10-31', '2025-11-07', 8], 'a mais antiga leva o dia que sobra');
  assert.ok(sem.slice(1).every((b) => b.dias === 7));
  const diaSeguinte = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  for (let i = 1; i < sem.length; i += 1) assert.equal(sem[i].de, diaSeguinte(sem[i - 1].ate), 'semanas seguidas, sem buraco');
  for (const k of ['pedidos', 'tele_pedidas', 'documentos']) assert.equal(G.somaSerie(sem, k), G.somaSerie(serie, k), `${k}: o total não muda`);
  assert.equal(sem[0].tele_pedidas, 7, 'dia sem número não conta como zero, os outros somam');
  assert.equal(G.somaSerie(sem, 'tele_encerradas'), null, 'nenhum número: null, não zero');
  assert.equal(G.semanaTip(sem.at(-1)), 'Semana de 24/10/2026 a 30/10/2026');
  assert.equal(G.semanaTip(sem[0]), 'Semana de 31/10/2025 a 07/11/2025 (8 dias)');
  assert.deepEqual(G.porSemana([], ['pedidos']), []);
  assert.deepEqual(G.porSemana(serie.slice(-3), ['pedidos']).map((b) => b.dias), [3], 'menos de uma semana: um grupo só');
  assert.equal(G.SEMANAL_DESDE, 90, 'até 90 dias, uma coluna por dia');
  // Desenho: 52 colunas cabem no celular (282 px), com coluna de verdade (pelo menos 2 px).
  const svg = G.columnsSvg({ width: 282, height: 130, cats: sem.map((b) => ({ label: G.shortDay(b.de), tip: G.semanaTip(b) })), series: [{ label: 'Pedidos', cls: 'gs-c1', values: sem.map((b) => b.pedidos) }] });
  svgOk(svg);
  assert.equal(faixas(svg).length, 52);
  assert.ok(colunas(svg).every(([a, b]) => b - a >= 2), 'colunas de pelo menos 2 px');
  assert.match(svg, /data-tip="Semana de 24\/10\/2026 a 30\/10\/2026\nPedidos: \d+"/);
  textsInside(svg, 282);
  // Resumo para leitor de tela com o ano (o período passa de um ano para o outro).
  const mx = Math.max(...sem.map((b) => b.pedidos));
  const pico = sem[sem.map((b) => b.pedidos).lastIndexOf(mx)];
  assert.equal(G.resumoSemanas('Pedidos de agendamento', sem, 'pedidos', ds[0], ds.at(-1)),
    `Pedidos de agendamento por semana, de 31/10/2025 a 30/10/2026: ${G.fmtInt(G.somaSerie(serie, 'pedidos'))} no total; a semana com mais foi a de ${G.fullDay(pico.de)} a ${G.fullDay(pico.ate)}, com ${mx}.`);
  assert.match(G.resumoSerie('Visualizações de página', serie.map((x, i) => ({ ...x, visitas: i === 3 ? 50 : 1 })), 'visitas', ds[0], ds.at(-1)),
    /^Visualizações de página por dia, de 31\/10\/2025 a 30\/10\/2026: 414 no total; o dia com mais foi 03\/11\/2025, com 50\.$/);
  assert.match(G.resumoSemanas('Documentos', sem, 'documentos', null, null), /^Documentos por semana, de 31\/10\/2025 a 30\/10\/2026: 0 no total\.$/);
});

test('barras deitadas: trilho do todo, barra proporcional, zero sem barra, sem número "—", nome comprido quebra em duas linhas', () => {
  const rows = [
    { label: 'Abriram a busca (Perto de mim)', value: 1200, extra: '', cls: 'gs-o1' },
    { label: 'Abriram a página de um local', value: 480, extra: '40%', cls: 'gs-o2' },
    { label: 'Pediram agendamento', value: 0, extra: '0%', cls: 'gs-o3' },
    { label: 'Pedido confirmado', value: null, extra: '—', cls: 'gs-o4' },
  ];
  const svg = G.hbarsSvg({ width: 400, rows, label: 'Funil <x>' });
  svgOk(svg.replace('—', ''));
  assert.match(svg, /aria-label="Funil &lt;x&gt;"/);
  assert.equal((svg.match(/class="gs-track"/g) || []).length, 4);
  assert.equal((svg.match(/class="gs-bar /g) || []).length, 2, 'zero e sem número não desenham barra');
  const w = [...svg.matchAll(/class="gs-bar gs-o\d" d="M0 [\d.]+H([\d.]+)Q([\d.]+)/g)].map((m) => Number(m[2]));
  const track = Number(svg.match(/class="gs-track" x="0" y="[\d.]+" width="([\d.]+)"/)[1]);
  assert.equal(w[0], track, 'a maior ocupa o trilho todo');
  assert.ok(Math.abs(w[1] / w[0] - 0.4) < 0.01, 'proporcional (480 de 1.200)');
  assert.match(svg, />1\.200<\/text>/);
  assert.match(svg, />480 · 40%<\/text>/);
  assert.match(svg, />— · —<\/text>/);
  assert.match(svg, /data-tip="Abriram a página de um local: 480 · 40%"/);
  textsInside(svg, 400);
  // com o total (max): a barra mostra a parte do todo
  const part = G.hbarsSvg({ width: 400, rows: [{ label: 'Pendente', value: 5, cls: 'gs-c1' }], max: 20 });
  const pw = Number(part.match(/class="gs-bar gs-c1" d="M0 [\d.]+H[\d.]+Q([\d.]+)/)[1]);
  const pt = Number(part.match(/class="gs-track" x="0" y="[\d.]+" width="([\d.]+)"/)[1]);
  assert.ok(Math.abs(pw / pt - 0.25) < 0.01);
  // celular: nome comprido quebra em linhas, nada sai do desenho
  const narrow = G.hbarsSvg({ width: 240, rows: [{ label: 'Pedidos pelo IMED (concierge) para locais do cadastro oficial', value: 3, cls: 'gs-c1' }] });
  assert.ok((narrow.match(/class="gs-lab"/g) || []).length >= 2);
  assert.deepEqual(G.wrapText('a b c', 20, 13), ['a', 'b', 'c']);
  assert.deepEqual(G.wrapText('', 100), ['']);
  textsInside(narrow, 240);
  assert.deepEqual(G.wrapText('curto', 300), ['curto']);
});

test('resumos dos gráficos em português simples', () => {
  const d = G.normalizeGestao(RAW);
  assert.equal(G.resumoSerie('Pedidos de agendamento', d.serie, 'pedidos', d.de, d.ate), 'Pedidos de agendamento por dia, de 28/10 a 30/10: 3 no total; o dia com mais foi 28/10, com 2.');
  assert.equal(G.resumoVisitas(d.serie, d.de, d.ate), 'Visualizações de página por dia, de 28/10 a 30/10: 1.260 no total; o dia com mais foi 29/10, com 1.000.');
  assert.equal(G.resumoSerie('Documentos', [{ dia: '2026-10-30', documentos: 0 }], 'documentos', null, null), 'Documentos por dia, no período: 0 no total.');
  assert.equal(G.resumoBarras('Situação', [{ label: 'Pendente', value: 1 }, { label: 'Concluído', value: null }]), 'Situação: pendente 1 e concluído —.');
  assert.equal(sp(G.resumoMeses(d.cobranca.por_mes)), 'Faturamento por mês, de setembro de 2026 a outubro de 2026: R$ 499,00 faturado e R$ 89,00 a receber com vencimento nesses meses; o mês com mais faturamento foi outubro de 2026, com R$ 499,00.');
  assert.equal(G.resumoMeses([]), 'Faturamento por mês: sem meses para mostrar.');
});

test('fluxograma da entrada de médicos: os 4 passos e os 2 ramos com o número de agora (null: "—"), escapado', () => {
  const html = G.fluxoMedicosHtml({ inscritos_periodo: 4, pendente: 2, aprovado: 5, recusado: 1, suspenso: 0, disponiveis_agora: null, aprovacao_media_horas: 30.5 });
  const boxes = [...html.matchAll(/<li class="gs-fx (gs-f[sb]\d)[^"]*">[\s\S]*?<b class="gs-fx-n">([^<]*)<\/b><span class="gs-fx-t">([^<]*)<\/span><small>([^<]*)<\/small>/g)].map((m) => [m[1], m[2], m[3], m[4]]);
  assert.deepEqual(boxes.map((b) => b.slice(0, 3)), [
    ['gs-fs1', '4', 'Inscrição'], ['gs-fs2', '2', 'Conferência do CRM no CFM'], ['gs-fb2', '1', 'Recusado'],
    ['gs-fs3', '5', 'Aprovado'], ['gs-fb3', '0', 'Suspenso'], ['gs-fs4', '—', 'Disponível para atender'],
  ], 'na ordem de leitura: cada ramo logo depois da etapa de onde sai');
  assert.equal(boxes[3][3], 'aprovados · em média 31 horas até aprovar');
  assert.equal(boxes[5][3], 'sem esse número no banco');
  assert.match(html, /^<ol class="gs-flow" aria-label="Fluxograma da entrada de médicos">/);
  assert.match(html, /<span class="sr">Ramo da conferência: <\/span>/);
  assert.match(html, /<span class="sr">Ramo do aprovado: <\/span>/);
  assert.equal((html.match(/aria-hidden="true"/g) || []).length, 6, 'ícones escondidos do leitor de tela');
  const vazio = G.fluxoMedicosHtml(null);
  assert.equal((vazio.match(/<b class="gs-fx-n">—<\/b>/g) || []).length, 6, 'sem dado: "—" em todas as caixas');
  assert.ok(!/em média/.test(vazio));
  // "Disponível": aprovados com o botão "Disponível para atender" ligado (página aberta não basta); aceitar um paciente
  // não desliga o botão, então o número pode incluir quem está em consulta (não quer dizer que estão livres).
  assert.match(G.fluxoMedicosHtml({ disponiveis_agora: 2 }), /<b class="gs-fx-n">2<\/b><span class="gs-fx-t">Disponível para atender<\/span><small>aprovados com o “Disponível” ligado agora \(pode incluir quem está em consulta\)<\/small>/);
  assert.ok(!/atendendo agora|página de atendimento aberta/.test(G.fluxoMedicosHtml({ disponiveis_agora: 2 })));
});

/* ======================= cobranças ======================= */
const HOJE = '2026-10-30';
const FORM = { tipo: 'mensalidade_clinica', descricao: '  Mensalidade   de novembro ', pagador_tipo: 'clinica', pagador_nome: ' Clínica Sol ', valor: 'R$ 1.234,56', vencimento: '2026-11-05', obs: ' Pix combinado \n com a Ana ' };

test('nova cobrança: dados certos viram o que o banco recebe (texto limpo, valor em centavos)', () => {
  const r = G.validarCobranca(FORM, HOJE);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
  assert.deepEqual(r.payload, { tipo: 'mensalidade_clinica', descricao: 'Mensalidade de novembro', pagador_tipo: 'clinica', pagador_nome: 'Clínica Sol', valor_cents: 123456, vencimento: '2026-11-05', obs: 'Pix combinado \n com a Ana' });
  const min = G.validarCobranca({ ...FORM, pagador_nome: '', obs: '   ', vencimento: '', valor: '0,01' }, HOJE);
  assert.equal(min.ok, true);
  assert.equal(min.payload.pagador_nome, null);
  assert.equal(min.payload.obs, null);
  assert.equal(min.payload.vencimento, HOJE, 'vencimento em branco: hoje');
  assert.equal(min.payload.valor_cents, 1);
  assert.equal(G.validarCobranca({ ...FORM, valor: '1.000.000,00' }, HOJE).payload.valor_cents, 100000000);
  for (const [tipo] of G.COB_TIPOS) assert.equal(G.validarCobranca({ ...FORM, tipo }, HOJE).ok, true, tipo);
  for (const [p] of G.PAGADORES) assert.equal(G.validarCobranca({ ...FORM, pagador_tipo: p }, HOJE).ok, true, p);
});

test('nova cobrança: cada erro no seu campo, com as regras do banco', () => {
  const err = (patch) => G.validarCobranca({ ...FORM, ...patch }, HOJE).errors;
  assert.deepEqual(Object.keys(G.validarCobranca({}, HOJE).errors), ['tipo', 'descricao', 'pagador_tipo', 'valor'], 'formulário vazio');
  assert.equal(err({ tipo: 'doacao' }).tipo, 'Escolha o tipo da cobrança.');
  assert.equal(err({ descricao: ' ab ' }).descricao, 'Descreva a cobrança (pelo menos 3 letras).');
  assert.equal(err({ descricao: 'x'.repeat(201) }).descricao, 'Use até 200 letras na descrição.');
  assert.deepEqual(err({ descricao: 'x'.repeat(200) }), {});
  assert.equal(err({ pagador_tipo: 'empresa' }).pagador_tipo, 'Escolha quem paga.');
  assert.equal(err({ pagador_nome: 'n'.repeat(121) }).pagador_nome, 'Use até 120 letras no nome.');
  assert.deepEqual(err({ pagador_nome: 'n'.repeat(120) }), {});
  assert.equal(err({ valor: '' }).valor, 'Informe o valor.');
  assert.equal(err({ valor: 'cem' }).valor, 'Valor inválido. Use, por exemplo, 150 ou 1.234,56.');
  assert.equal(err({ valor: '0' }).valor, 'O valor precisa ficar entre R$ 0,01 e R$ 1.000.000,00.');
  assert.equal(err({ valor: '1.000.000,01' }).valor, 'O valor precisa ficar entre R$ 0,01 e R$ 1.000.000,00.');
  for (const v of ['2026-02-30', '05/11/2026', '2019-12-31', '2100-01-01']) assert.equal(err({ vencimento: v }).vencimento, 'Vencimento inválido: use uma data de 2020 a 2099.', v);
  assert.equal(err({ obs: 'o'.repeat(501) }).obs, 'Use até 500 letras na observação.');
  assert.equal(G.validarCobranca({ ...FORM, valor: 'x' }, HOJE).payload, null, 'com erro, nada vai para o banco');
});

test('filtro das cobranças: o que pedir ao banco e o que fica na tela ("Atrasadas" = pendentes vencidas)', () => {
  const rows = [
    { id: 1, status: 'pendente', vencimento: '2026-10-29' },
    { id: 2, status: 'pendente', vencimento: HOJE },
    { id: 3, status: 'pago', vencimento: '2026-10-01' },
    { id: 4, status: 'cancelado', vencimento: '2026-09-01' },
  ];
  assert.deepEqual(G.COB_FILTROS.map(([f]) => [f, G.filtroStatus(f)]), [['', null], ['pendente', 'pendente'], ['atrasada', 'pendente'], ['pago', 'pago'], ['cancelado', 'cancelado']]);
  assert.equal(G.filtroStatus('qualquer'), null);
  assert.deepEqual(G.aplicaFiltro(rows, '', HOJE).map((r) => r.id), [1, 2, 3, 4]);
  assert.deepEqual(G.aplicaFiltro(rows, 'atrasada', HOJE).map((r) => r.id), [1], 'vence hoje ainda não está atrasada');
  assert.deepEqual(G.aplicaFiltro(rows, 'pago', HOJE).map((r) => r.id), [3]);
  assert.equal(G.isOverdue(rows[3], HOJE), false, 'cancelada não fica atrasada');
  assert.equal(G.noFiltro(rows[2], 'pendente', HOJE), false);
  assert.deepEqual(G.aplicaFiltro(null, '', HOJE), []);
  // Pendentes e atrasadas: o máximo do banco (as atrasadas mais antigas não ficam de fora); as outras: 200.
  assert.deepEqual(G.COB_FILTROS.map(([f]) => G.limiteCobrancas(f)), [200, 1000, 1000, 200, 200]);
});

test('marcar como pago: forma obrigatória, "Pago em" de 2020 até hoje (em branco: hoje); hoje usa a hora do banco', () => {
  const v = G.validarPagamento({ forma: 'pix', pago_em: '' }, HOJE);
  assert.deepEqual(v, { ok: true, errors: {}, forma: 'pix', pagoEm: null }, 'em branco: hoje (o banco grava a hora de agora)');
  assert.equal(G.validarPagamento({ forma: 'pix', pago_em: HOJE }, HOJE).pagoEm, null);
  assert.equal(G.validarPagamento({ forma: 'boleto', pago_em: '2026-10-25' }, HOJE).pagoEm, '2026-10-25', 'outro dia: vai a data');
  assert.equal(G.validarPagamento({ forma: 'outro', pago_em: '2020-01-01' }, HOJE).ok, true);
  assert.deepEqual(G.validarPagamento({ forma: '', pago_em: '2026-10-31' }, HOJE).errors, { forma: 'Escolha a forma de pagamento.', pago_em: 'A data do pagamento não pode ser no futuro.' });
  for (const d of ['2019-12-31', '2026-02-30', '30/10/2026', 'ontem']) assert.equal(G.validarPagamento({ forma: 'pix', pago_em: d }, HOJE).errors.pago_em, 'Data do pagamento inválida: use uma data de 2020 até hoje.', d);
  assert.equal(G.validarPagamento({ forma: 'cheque', pago_em: '' }, HOJE).errors.forma, 'Escolha a forma de pagamento.');
  assert.equal(G.validarPagamento({ forma: 'cheque' }, HOJE).forma, null, 'com erro, nada vai para o banco');
});

test('voltar para pendente: o aviso diz o que acontece (paga: sai do faturado e a data do pagamento é apagada)', () => {
  assert.equal(sp(G.avisoReabrir({ status: 'pago', valor_cents: 49900, pago_em: '2026-10-22T15:00:00Z' })), 'Voltar a cobrança de R$ 499,00 para pendente? Ela sai do faturado e a data do pagamento (22/10/2026) será apagada.');
  assert.equal(sp(G.avisoReabrir({ status: 'pago', valor_cents: 100, pago_em: null })), 'Voltar a cobrança de R$ 1,00 para pendente? Ela sai do faturado e a data do pagamento será apagada.');
  assert.equal(sp(G.avisoReabrir({ status: 'cancelado', valor_cents: 15000 })), 'Voltar a cobrança de R$ 150,00 para pendente? Ela volta para o “a receber”.');
  assert.equal(G.avisoReabrir({ status: 'cancelado', valor_cents: null }), 'Voltar a cobrança de — para pendente? Ela volta para o “a receber”.');
});

test('planilha CSV: BOM, ponto e vírgula, CRLF, aspas dobradas, quebra de linha entre aspas e fórmula desligada', () => {
  assert.equal(G.csvCell('simples'), 'simples');
  assert.equal(G.csvCell('a;b'), '"a;b"');
  assert.equal(G.csvCell('ele disse "oi"'), '"ele disse ""oi"""');
  assert.equal(G.csvCell('linha 1\nlinha 2'), '"linha 1\nlinha 2"');
  assert.equal(G.csvCell(' espaço '), '" espaço "');
  for (const f of ['=1+1', '+5511999', '-2', '@SOMA(A1)']) assert.equal(G.csvCell(f), `'${f}`, f);
  assert.equal(G.csvCell('=HYPERLINK("x";"y")'), '"\'=HYPERLINK(""x"";""y"")"');
  assert.equal(G.csvCell('-12,50', { text: false }), '-12,50', 'número não ganha apóstrofo');
  assert.equal(G.csvCell(null), '');
  const csv = G.cobrancasCsv([
    { id: 'a1', criado_em: '2026-10-29T13:00:00Z', tipo: 'teleconsulta', descricao: 'Tele; "urgente"', pagador_tipo: 'paciente', pagador_nome: '=cmd', valor_cents: 8900, vencimento: '2026-10-29', status: 'pendente', pago_em: null, forma: null, obs: 'linha 1\nlinha 2' },
    { id: 'a2', criado_em: '2026-10-20T10:00:00Z', tipo: 'mensalidade_clinica', descricao: 'Mensalidade', pagador_tipo: 'clinica', pagador_nome: null, valor_cents: 49900, vencimento: '2026-10-25', status: 'pago', pago_em: '2026-10-22T15:00:00Z', forma: 'transferencia', obs: null },
    { id: 'a3', criado_em: null, tipo: 'novo_tipo', descricao: 'X', pagador_tipo: 'outro', valor_cents: null, vencimento: null, status: 'cancelado' },
  ], HOJE);
  assert.ok(csv.startsWith('﻿'), 'BOM para o Excel abrir com acento');
  assert.ok(csv.endsWith('\r\n'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], G.CSV_HEADER.join(';'));
  assert.equal(lines[0], 'Criada em;Tipo;Descrição;Quem paga;Nome de quem paga;Valor (R$);Vencimento;Situação;Atrasada;Pago em;Forma de pagamento;Observação;Código');
  assert.equal(lines[1], `29/10/2026 10:00;Teleconsulta;"Tele; ""urgente""";Paciente;'=cmd;89,00;29/10/2026;Pendente;sim;;;"linha 1\nlinha 2";a1`);
  assert.equal(lines[2], '20/10/2026 07:00;Mensalidade de clínica;Mensalidade;Clínica;;499,00;25/10/2026;Paga;;22/10/2026 12:00;Transferência;;a2');
  assert.equal(lines[3], ';novo_tipo;X;Outro;;;;Cancelada;;;;;a3', 'sem dado: célula vazia (nada inventado)');
  assert.equal(lines.length, 5, 'cabeçalho, 3 linhas e o fim');
  assert.equal(G.cobrancasCsv([], HOJE), `﻿${G.CSV_HEADER.join(';')}\r\n`);
  // Forma e data de pagamento só na paga (o banco guarda a forma depois de voltar para pendente ou cancelar);
  // paga informando só o dia: a data, sem uma hora inventada.
  const extra = G.cobrancasCsv([
    { id: 'b1', criado_em: null, tipo: 'outro', descricao: 'Volta', pagador_tipo: 'outro', valor_cents: 100, vencimento: '2026-11-01', status: 'pendente', pago_em: null, forma: 'pix' },
    { id: 'b2', criado_em: null, tipo: 'outro', descricao: 'Cancelada', pagador_tipo: 'outro', valor_cents: 100, vencimento: '2026-11-01', status: 'cancelado', pago_em: null, forma: 'boleto' },
    { id: 'b3', criado_em: null, tipo: 'outro', descricao: 'Paga dia 25', pagador_tipo: 'outro', valor_cents: 100, vencimento: '2026-10-20', status: 'pago', pago_em: '2026-10-25T03:00:00Z', forma: 'dinheiro' },
  ], HOJE).slice(1).split('\r\n');
  assert.equal(extra[1], ';Outro;Volta;Outro;;1,00;01/11/2026;Pendente;não;;;;b1');
  assert.equal(extra[2], ';Outro;Cancelada;Outro;;1,00;01/11/2026;Cancelada;;;;;b2');
  assert.equal(extra[3], ';Outro;Paga dia 25;Outro;;1,00;20/10/2026;Paga;;25/10/2026;Dinheiro;;b3');
});

/* ======================= o visual de painel (dashboard) ======================= */
test('mini-curva (sparkline): a série de verdade, sem texto e fora do leitor de tela; sem série ou sem lugar, nada; tudo zero, linha reta', () => {
  const v = [0, 1, 0, 2, 1, 0, 1, 0, 4, 0];
  const svg = G.sparkSvg({ width: 120, height: 30, values: v, cls: 'gs-c1' });
  assert.match(svg, /^<svg class="gs-spark" viewBox="0 0 120 30" width="120" height="30" aria-hidden="true" focusable="false">/);
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(!/NaN|undefined|Infinity|null|<text|role=|aria-label/.test(svg), 'enfeite: sem texto, sem nome, nada quebrado');
  const linha = svg.match(/<path class="gs-spark-l gs-c1" d="([^"]+)"\/>/)[1];
  const pts = linha.match(/[ML][\d.]+ [\d.]+/g).map((p) => p.slice(1).split(' ').map(Number));
  assert.equal(pts.length, v.length, 'um ponto por dia');
  assert.equal((linha.match(/M/g) || []).length, 1);
  for (const [x, y] of pts) assert.ok(x >= 0 && x <= 120 && y >= 0 && y <= 30, `ponto dentro do desenho: ${x},${y}`);
  assert.deepEqual([pts[0][0], pts.at(-1)[0]], [3, 117], 'da primeira à última coluna');
  assert.equal(pts[8][1], 3, 'o dia com mais fica no alto');
  assert.ok(pts.filter((_, i) => v[i] === 0).every(([, y]) => y === 27), 'zero fica na base');
  assert.ok(pts[3][1] < pts[1][1] && pts[1][1] < pts[0][1], 'proporcional ao número');
  assert.equal((svg.match(/class="gs-spark-a gs-c1"/g) || []).length, 1, 'preenchimento de leve embaixo');
  assert.match(svg, /<circle class="gs-spark-p gs-c1" cx="117" cy="27" r="2.5"\/>/, 'bolinha no dia mais novo');
  // Dia sem número: a linha para e recomeça; sem preenchimento por cima do buraco; a bolinha no último dia com número.
  const furo = G.sparkSvg({ width: 120, height: 30, values: [1, 2, null, 3, 1, null] });
  assert.equal((furo.match(/<path class="gs-spark-l gs-c1" d="([^"]+)"/)[1].match(/M/g) || []).length, 2);
  assert.ok(!furo.includes('gs-spark-a'));
  assert.match(furo, /<circle class="gs-spark-p gs-c1" cx="94\.2" /);
  // Sem série (ou com um número só), sem curva. Lugar pequeno demais, também.
  for (const values of [[], [5], [null, 5, null], [null, null, null], undefined, 'abc', null]) assert.equal(G.sparkSvg({ width: 120, height: 30, values }), '', JSON.stringify(values));
  assert.equal(G.sparkSvg({ width: G.SPARK_MIN_W - 1, height: 30, values: v }), '');
  assert.equal(G.sparkSvg({ width: 0, height: 30, values: v }), '');
  assert.equal(G.sparkSvg({ width: NaN, height: 30, values: v }), '');
  assert.equal(G.sparkSvg({ width: 120, height: 8, values: v }), '');
  assert.notEqual(G.sparkSvg({ width: G.SPARK_MIN_W, height: 14, values: v }), '');
  // Banco novo (tudo zero): linha reta na base, marcada para o desenho apagado; nenhum pico inventado.
  const zero = G.sparkSvg({ width: 100, height: 26, values: [0, 0, 0, 0] });
  assert.match(zero, /^<svg class="gs-spark gs-spark-zero" /);
  assert.ok(!zero.includes('gs-spark-a'));
  assert.deepEqual([...new Set(zero.match(/<path class="gs-spark-l[^"]*" d="([^"]+)"/)[1].match(/[ML][\d.]+ [\d.]+/g).map((p) => p.split(' ')[1]))], ['23']);
  // A classe da cor é escapada.
  assert.ok(!G.sparkSvg({ values: [1, 2], cls: '"><script>' }).includes('<script>'));
});

test('mini-curva: um ponto por dia; no período longo, um por semana (a mesma soma das colunas)', () => {
  const serie = (n) => days(n).map((dia, i) => ({ dia, visitas: 100 + i, pedidos: i % 3, tele_pedidas: null }));
  assert.deepEqual(G.sparkValues(serie(7), 'pedidos'), [0, 1, 2, 0, 1, 2, 0]);
  assert.equal(G.sparkValues(serie(90), 'visitas').length, 90, 'até 90 dias: dia a dia');
  const s365 = serie(365);
  const semanas = G.porSemana(s365, ['pedidos']);
  assert.deepEqual(G.sparkValues(s365, 'pedidos'), semanas.map((x) => x.pedidos));
  assert.equal(G.sparkValues(s365, 'pedidos').length, 52);
  assert.equal(G.sparkValues(s365, 'pedidos').reduce((a, b) => a + b, 0), G.somaSerie(s365, 'pedidos'), 'nada some na soma');
  assert.ok(G.sparkValues(serie(30), 'tele_pedidas').every((x) => x === null), 'sem número no banco: sem ponto');
  assert.equal(G.sparkSvg({ values: G.sparkValues(serie(30), 'tele_pedidas') }), '');
  for (const ruim of [null, undefined, 'x', {}]) assert.deepEqual(G.sparkValues(ruim, 'pedidos'), []);
});

test('painel: folha de estilo própria depois do gestao.css (e no sw.js), só com as cores do tema; séries e ícones com 3:1 no claro e no escuro', () => {
  const h = read('gestao.html');
  assert.match(h, /<link rel="stylesheet" href="assets\/css\/clinica\.css">\n<link rel="stylesheet" href="assets\/css\/gestao\.css">\n<link rel="stylesheet" href="assets\/css\/gestao-painel\.css">\n/, 'depois do gestao.css');
  const sw = read('sw.js');
  assert.ok(sw.slice(sw.indexOf('const CORE'), sw.indexOf('];', sw.indexOf('const CORE'))).includes("'./assets/css/gestao-painel.css'"), 'no CORE do sw.js');
  assert.ok(Number(sw.match(/const VERSION = 'imed-v(\d+)';/)[1]) >= 34, 'versão do sw.js subiu com o painel');
  const st = statSync(join(ROOT, 'assets/css/gestao-painel.css'));
  assert.ok(st.size > 3000 && st.size < 80000, `gestao-painel.css: ${st.size} bytes`);
  const p = read('assets/css/gestao-painel.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // Cores: só os tokens (o escuro vem deles). Cor fixa só onde o fundo é o cabeçalho escuro dos dois temas (a conta) e
  // na máscara das fichas (preto = "aparece").
  const fixas = [...new Set(p.match(/#[0-9A-Fa-f]{3,8}\b/g) || [])].sort();
  assert.deepEqual(fixas, ['#000', '#05161e', '#7FF0E4', '#fff'].sort(), 'nenhuma cor fixa nova');
  for (const linha of p.split('\n').filter((l) => /#fff|#7FF0E4|#05161e|rgba\(255,255,255/.test(l))) assert.match(linha, /#authCard/, `cor fixa fora da conta: ${linha.slice(0, 80)}`);
  assert.ok(!/prefers-color-scheme|data-theme/.test(p), 'sem regra própria de tema: tudo por token');
  // Só vira painel com a classe que o script põe depois de o banco confirmar a equipe; nada de regra solta no topo ou na conta.
  let regras = 0;
  for (const m of p.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const sels = m[1].trim();
    if (sels.startsWith('@') || /^(from|to|\d+%)/.test(sels)) continue;
    regras += 1;
    for (const sel of sels.split(/,(?![^()]*\))/)) {
      if (/(^|[\s>])(\.pt-top|\.cl-hero|#authCard|#authBox|\.cl\.gs|#app|#gsData|\.cl-foot|main|html)(?![\w-])/.test(sel.trim())) assert.match(sel, /\.gs-painel/, `regra fora do modo painel: ${sel.trim().slice(0, 80)}`);
    }
  }
  assert.ok(regras > 150, `regras lidas: ${regras}`);
  const js = read('assets/js/gestao.js').replace(/^\s*\/\/.*$/gm, '');
  assert.equal((js.match(/classList\.toggle\('gs-painel', on\)/g) || []).length, 1);
  assert.deepEqual((js.match(/modoPainel\((true|false)\)/g) || []).sort(), ['modoPainel(false)', 'modoPainel(true)'], 'liga com a equipe confirmada (renderAreas) e desliga ao sair (reset)');
  assert.match(js.slice(js.indexOf('function reset()'), js.indexOf('function lost()')), /modoPainel\(false\);/);
  assert.match(js.slice(js.indexOf('function renderAreas()')), /modoPainel\(true\);/);
  // Trilho de 1280 px em diante; barra do período e fichas grudam (menos na tela baixa); movimento respeitado.
  assert.match(p, /@media \(min-width:1280px\)\{[^@]*\.gs-painel #app>\.gs-toc\{[^}]*position:sticky|@media \(min-width:1280px\)\{[\s\S]*?\.gs-painel #app>\.gs-toc\{grid-column:1;/);
  assert.match(p, /\.gs-painel \.gs-ctl\{position:sticky;top:var\(--gs-toc-h\);/);
  assert.match(p, /\.gs-painel \.gs-toc\{position:sticky;top:0;/);
  assert.match(p, /@media \(max-height:520px\)\{\.gs-painel \.gs-toc,\.gs-painel \.gs-ctl\{position:static\}\}/);
  assert.match(p, /@media \(prefers-reduced-motion:reduce\)\{\s*\.gs-live::after,\.gs-skel-g>span\{animation:none\}/);
  assert.ok(!/scroll-padding-top:var/.test(p), 'a folga do que gruda vai em cada parte (scroll-margin), não na página');

  // Contraste de gráfico (3:1, WCAG 1.4.11) no escuro: séries sobre o cartão escuro; etapas do funil também sobre o trilho.
  const lum = (hex) => {
    const [r, gg, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const g = read('assets/css/gestao.css');
  const escuros = [...g.matchAll(/:root(?::not\(\[data-theme="light"\]\)|\[data-theme="dark"\]) \.cl\.gs\{([^}]+)\}/g)].map((m) => m[1].replace(/\s+/g, ''));
  assert.equal(escuros.length, 2, 'os dois blocos do escuro (automático e escolhido)');
  assert.equal(escuros[0], escuros[1], 'iguais');
  const tok = (bloco, k) => bloco.match(new RegExp(`--${k}:(#[0-9A-Fa-f]{6})`))[1];
  const tema = read('assets/css/tema.css');
  const temaEscuro = tema.slice(tema.indexOf(':root[data-theme="dark"]{'), tema.indexOf('}', tema.indexOf(':root[data-theme="dark"]{'))).replace(/\s+/g, '');
  const CARTAO_ESCURO = tok(temaEscuro, 'card');
  const TRILHO_ESCURO = g.match(/:root\[data-theme="dark"\] \.gs-track\{fill:(#[0-9A-Fa-f]{6})\}/)[1];
  for (const k of ['gs-c1', 'gs-c2', 'gs-c3', 'gs-c4']) assert.ok(ratio(tok(escuros[0], k), CARTAO_ESCURO) >= 3, `${k} no escuro: ${ratio(tok(escuros[0], k), CARTAO_ESCURO).toFixed(2)}:1`);
  for (const k of ['gs-c1', 'gs-o1', 'gs-o2', 'gs-o3', 'gs-o4', 'gs-o5']) {
    for (const fundo of [CARTAO_ESCURO, TRILHO_ESCURO]) assert.ok(ratio(tok(escuros[0], k), fundo) >= 3, `${k} no escuro sobre ${fundo}: ${ratio(tok(escuros[0], k), fundo).toFixed(2)}:1`);
  }
  // A mini-curva das visualizações usa a 3ª cor de série: 3:1 sobre o branco no claro.
  assert.ok(ratio(g.match(/--gs-c3:(#[0-9A-Fa-f]{6})/)[1], '#FFFFFF') >= 3);
  // Ícone de cada tema (atendimento, fluxo, dinheiro) sobre o fundo suave dele, nos dois temas.
  const claro = read('assets/css/clinica.css').match(/:root\{([^}]+)\}/)[1].replace(/\s+/g, '');
  for (const [nome, bloco] of [['claro', claro], ['escuro', temaEscuro]]) {
    for (const [cor, suave] of [['primary', 'primary-s'], ['purple', 'purple-s'], ['green', 'green-s']]) {
      assert.ok(ratio(tok(bloco, cor), tok(bloco, suave)) >= 3, `ícone ${cor} sobre ${suave} no ${nome}: ${ratio(tok(bloco, cor), tok(bloco, suave)).toFixed(2)}:1`);
    }
  }
});

/* ======================= a página ======================= */
test('gestao.html: só para a equipe — fora do Google e do mapa do site, sem o contador, ninguém aponta para ela', () => {
  const h = read('gestao.html');
  assert.match(h, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(!h.includes('visitas.js'), 'sem o contador de visitas');
  assert.ok(!h.includes('rel="canonical"'), 'sem endereço canônico (a página não é para o Google)');
  assert.match(h, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self';[^"]*connect-src 'self' https:\/\/pyoqiecupxhdzigjudyd\.supabase\.co wss:\/\/pyoqiecupxhdzigjudyd\.supabase\.co;/);
  assert.match(h, /<script src="assets\/js\/config\.js" defer><\/script>\n<script type="module" src="assets\/js\/gestao\.js"><\/script>/, 'config.js antes do módulo');
  assert.match(h, /<div id="flash" aria-live="polite"><\/div>/, 'avisos de cima ("Sua entrada expirou") lidos pelo leitor de tela');
  assert.ok(!/\b\d{1,3}(\.\d{3})+\b|R\$\s*\d/.test(h.replace(/<style[\s\S]*?<\/style>/, '')), 'nenhum número de exemplo no HTML');
  assert.ok(!read('sitemap.xml').includes('gestao.html'), 'fora do mapa do site');
  // Nenhuma página do site aponta para gestao.html (a área da clínica mostra o link pelo script, só para a equipe).
  const FORA = new Set(['node_modules', '.git', '.github', 'supabase', 'tests', 'scripts', 'memory']);
  const pages = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!FORA.has(e.name)) walk(rel); } else if (/\.(html|js|mjs|xml|webmanifest)$/.test(e.name)) pages.push(rel);
    }
  };
  walk('');
  assert.ok(pages.length > 100);
  const apontam = pages.filter((f) => !['gestao.html', 'assets/js/gestao.js', 'assets/js/gestao-core.js', 'assets/js/painel.js', 'sw.js'].includes(f) && read(f).includes('gestao.html'));
  assert.deepEqual(apontam, [], 'só o painel da equipe (pelo script) leva para a gestão');
  // O link do painel.js só sai quando a conta é da equipe.
  const painel = read('assets/js/painel.js').replace(/^\s*\/\/.*$/gm, ''); // sem os comentários
  assert.equal((painel.match(/gestao\.html/g) || []).length, 1);
  assert.match(painel, /\$\{state\.admin \? GESTAO_LINK : ''\}/);
});

test('gestao: os dados só vêm das funções do banco que conferem a equipe; ícones dentro do recorte do site', () => {
  const js = read('assets/js/gestao.js').replace(/^\s*\/\/.*$/gm, ''); // sem os comentários
  assert.deepEqual([...new Set([...js.matchAll(/auth\.rpc\('([a-z_]+)'/g)].map((m) => m[1]))].sort(), ['admin_cobranca_listar', 'admin_cobranca_salvar', 'admin_cobranca_status', 'admin_gestao', 'is_imed_admin']);
  assert.ok(!/auth\.select\(|localStorage|sessionStorage/.test(js), 'nada de tabela direta nem de guardar números no aparelho');
  // Só busca os números depois de o banco dizer que a conta é da equipe.
  const check = js.slice(js.indexOf('async function checkAdmin'), js.indexOf('function notAdmin'));
  assert.match(check, /if \(!admin\) \{ notAdmin\(\); return; \}\n {2}renderShell\(\);/);
  assert.ok(!/admin_gestao|admin_cobranca/.test(check));
  // Todo ícone usado está no recorte (assets/vendor/fa/css/icones.min.css): nada de baixar a fonte completa.
  const css = read('assets/vendor/fa/css/icones.min.css');
  const usados = new Set();
  for (const f of ['gestao.html', 'assets/js/gestao.js', 'assets/js/gestao-core.js', 'assets/js/gestao-central.js', 'assets/js/painel.js']) {
    for (const m of read(f).matchAll(/(?<![\w-])fa-[a-z0-9]+(?:-[a-z0-9]+)*/g)) usados.add(m[0]);
  }
  assert.ok(usados.size >= 15);
  for (const n of usados) if (!['fa-solid', 'fa-regular', 'fa-brands'].includes(n)) assert.ok(new RegExp(`\\.${n}:before[,{]`).test(css), `${n} fora do recorte de ícones`);
  // Cores das séries: as conferidas (daltonismo e contraste) em gestao.css.
  const g = read('assets/css/gestao.css');
  for (const [k, v] of Object.entries({ c1: '#0E7C9C', c2: '#E8512F', c3: '#6C4BD8', c4: '#C98500' })) assert.ok(g.includes(`--gs-${k}:${v}`), k);
  // Contraste de 3:1 (WCAG 1.4.11) das barras: sobre o branco e sobre o trilho claro (#EEF3F6, .gs-track), onde ficam as
  // barras do funil e das situações; o "a receber" (c2) só aparece sobre o branco.
  const lum = (hex) => {
    const [r, gg, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const cor = (k) => g.match(new RegExp(`--gs-${k}:(#[0-9A-Fa-f]{6})`))[1];
  assert.match(g, /\.gs-track\{fill:#EEF3F6\}/);
  for (const k of ['c1', 'o1', 'o2', 'o3', 'o4', 'o5']) {
    for (const fundo of ['#FFFFFF', '#EEF3F6']) assert.ok(ratio(cor(k), fundo) >= 3, `${k} (${cor(k)}) sobre ${fundo}: ${ratio(cor(k), fundo).toFixed(2)}:1`);
  }
  assert.ok(ratio(cor('c2'), '#FFFFFF') >= 3, 'c2 sobre o branco');
  // Do escuro ao claro, de verdade.
  const tons = ['o1', 'o2', 'o3', 'o4', 'o5'].map((k) => lum(cor(k)));
  for (let i = 1; i < tons.length; i += 1) assert.ok(tons[i] > tons[i - 1], 'etapas do funil do escuro ao claro');
});

// Arquivos do projeto que existem (para o teste de cima não depender de outra frente).
test('arquivos da gestão existem e são pequenos', () => {
  for (const f of ['gestao.html', 'assets/js/gestao.js', 'assets/js/gestao-core.js', 'assets/js/gestao-central.js', 'assets/css/gestao.css']) {
    const st = statSync(join(ROOT, f));
    assert.ok(st.size > 1000 && st.size < 80000, `${f}: ${st.size} bytes`);
  }
  assert.equal(relative(ROOT, join(ROOT, 'gestao.html')).split(sep).join('/'), 'gestao.html');
});

/* ======================= agenda das clínicas (central do IMED, iMed Agenda 4.4) ======================= */
const OV = {
  status: 'ok', generated_at: '2026-10-30T15:00:00Z', national_holidays_until: null, truncated: false,
  totals: { clinics: 3, agenda_active: 2, online: 1, timezone_pending: 1, open_conflicts: 2, upcoming: 20, by_mode: { pedido: 1, nativa: 1, manual: 1, externa: 0 } },
  clinics: [
    { clinic_id: 'c1', name: 'Imagem Paulista', city: 'São Paulo', state: 'SP', status: 'published', demo: false, agenda_mode: 'nativa', agenda_active: true, online_since: '2026-10-25T12:00:00Z', selling: true,
      timezone: 'America/Sao_Paulo', timezone_confirmed_at: '2026-10-20T14:00:00Z', holidays_checked_until: '2027-03-31', closes_on_holidays: true, version: 42, changed_at: '2026-10-30T14:40:00Z', open_conflicts: 2, upcoming: 17, members: 4 },
    { clinic_id: 'c2', name: 'Laboratório Análise', city: 'Campinas', state: 'SP', status: 'published', demo: false, agenda_mode: 'manual', agenda_active: true, online_since: null,
      timezone: 'America/Sao_Paulo', timezone_confirmed_at: null, holidays_checked_until: '2026-10-15', closes_on_holidays: true, version: 7, changed_at: '2026-10-29T18:00:00Z', open_conflicts: 0, upcoming: 3, members: 2 },
    { clinic_id: 'c3', name: 'Clínica Sol', city: 'Manaus', state: 'AM', status: 'draft', demo: true, agenda_mode: 'pedido', agenda_active: false, online_since: null,
      timezone: 'America/Manaus', timezone_confirmed_at: null, holidays_checked_until: null, closes_on_holidays: null, version: 0, changed_at: null, open_conflicts: 0, upcoming: 0, members: 0 },
    { clinic_id: '', name: 'sem id' }, { clinic_id: 'c9' }, null, 'lixo',
  ],
};

test('central, clínicas: a resposta do banco arrumada; o que falta vira "—" (nada inventado); resposta que não é "ok" não mostra nada', () => {
  const d = G.normalizeCentral(OV);
  assert.equal(d.clinicas.length, 3, 'linha sem id ou sem nome fica de fora');
  assert.deepEqual(d.totais, { clinics: 3, agenda_active: 2, online: 1, timezone_pending: 1, open_conflicts: 2, upcoming: 20, por_modo: { pedido: 1, nativa: 1, manual: 1, externa: 0 } });
  assert.equal(d.feriados_ate, null);
  assert.equal(d.cortada, false);
  assert.deepEqual(d.clinicas[0], { id: 'c1', nome: 'Imagem Paulista', cidade: 'São Paulo', uf: 'SP', situacao: 'published', demo: false, modo: 'nativa', ativa: true, online_desde: '2026-10-25T12:00:00Z', vendendo: true,
    fuso: 'America/Sao_Paulo', fuso_confirmado_em: '2026-10-20T14:00:00Z', feriados_ate: '2027-03-31', fecha_feriado: true, versao: 42, atividade: '2026-10-30T14:40:00Z', conflitos: 2, por_vir: 17, equipe: 4 });
  assert.equal(d.clinicas[2].fecha_feriado, null, 'sem agenda, o banco não diz se fecha em feriado');
  for (const ruim of [null, undefined, 'x', [], {}, { status: 'forbidden' }, { status: 'invalid' }]) {
    for (const fn of [G.normalizeCentral, G.normalizeConflitos, G.normalizeAuditoria, G.normalizeParametros, G.normalizeFeriados, G.normalizeEquipe]) assert.equal(fn(ruim), null);
  }
  // resposta incompleta: números que não vieram ficam null (a tela mostra "—"), nunca zero
  const inc = G.normalizeCentral({ status: 'ok', clinics: [{ clinic_id: 'c1', name: 'X', version: 'abc', open_conflicts: -1 }] });
  assert.deepEqual([inc.totais.clinics, inc.clinicas[0].versao, inc.clinicas[0].conflitos, inc.clinicas[0].equipe, inc.gerado_em], [null, null, null, null, null]);
  assert.deepEqual(G.centralKpis(inc).map((k) => k.value), ['—', '—', '—', '—', '—', '—']);
  const k = G.centralKpis(d);
  assert.deepEqual(k.map((x) => [x.id, x.value, !!x.warn]), [['ce-clinicas', '3', false], ['ce-ativas', '2', false], ['ce-online', '1', false], ['ce-conflitos', '2', true], ['ce-porvir', '20', false], ['ce-fuso', '1', true]]);
  assert.equal(G.centralKpis(G.normalizeCentral({ ...OV, totals: { ...OV.totals, open_conflicts: 0, timezone_pending: 0 } })).some((x) => x.warn), false, 'zero não fica em destaque');
});

test('central, clínicas: filtro, modalidade, agenda, fuso e feriados conferidos em palavras simples', () => {
  const d = G.normalizeCentral(OV);
  assert.deepEqual(G.filtraClinicas(d.clinicas, 'ativas').map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(G.filtraClinicas(d.clinicas, 'conflitos').map((c) => c.id), ['c1']);
  assert.equal(G.filtraClinicas(d.clinicas, 'todas').length, 3);
  assert.deepEqual(G.filtraClinicas(null, 'ativas'), []);
  assert.deepEqual(['pedido', 'nativa', 'manual', 'externa', 'nova', ''].map(G.modoTexto), ['Pedido', 'Agenda no IMED', 'Agenda no IMED, registro manual', 'Sistema da clínica', 'nova', '—']);
  assert.equal(G.modoAjuda('manual'), 'Agenda no IMED, com registro manual', 'a explicação é a mesma do painel da clínica (agenda-core.js)');
  const [a, b, c] = d.clinicas;
  assert.deepEqual(G.agendaClinica(a), { texto: 'Ativa', tom: 'ok', sub: 'Vende online desde 25/10/2026' });
  assert.deepEqual(G.agendaClinica(b), { texto: 'Ativa', tom: 'ok', sub: 'Sem venda online' });
  assert.deepEqual(G.agendaClinica(c), { texto: 'Não ativada', tom: '', sub: '' });
  // a data da venda ligada sem a clínica vender de fato (não aceita pedidos, suspensa ou demonstração): pausada
  assert.deepEqual(G.agendaClinica({ ...a, vendendo: false }), { texto: 'Ativa', tom: 'ok', sub: 'Venda ligada, pausada (a clínica não aceita pedidos, está suspensa ou é demonstração)' });
  assert.equal(G.normalizeCentral({ ...OV, clinics: [{ ...OV.clinics[0], selling: undefined }] }).clinicas[0].vendendo, false, 'sem "selling" do banco, não diz que vende');
  assert.deepEqual(G.fusoClinica(a), { nome: 'Horário de Brasília (SP, RJ, MG, ES, PR, SC, RS, GO, DF)', texto: 'Confirmado em 20/10/2026', tom: 'ok' });
  assert.deepEqual([G.fusoClinica(b).texto, G.fusoClinica(b).tom], ['Não confirmado', 'warn'], 'agenda ativa sem fuso confirmado: em destaque');
  assert.deepEqual([G.fusoClinica(c).texto, G.fusoClinica(c).tom, G.fusoClinica(c).nome], ['Ainda não confirmado', '', 'Uma hora a menos que Brasília (Amazonas)']);
  assert.deepEqual(G.feriadosClinica(a, '2026-10-30'), { texto: 'Até 31/03/2027', tom: '' });
  assert.deepEqual(G.feriadosClinica(a, '2027-03-31'), { texto: 'Até 31/03/2027', tom: '' }, 'no último dia ainda vale');
  assert.deepEqual(G.feriadosClinica(a, '2027-04-01'), { texto: 'Venceu em 31/03/2027', tom: 'warn' });
  assert.deepEqual(G.feriadosClinica(b, '2026-10-30'), { texto: 'Venceu em 15/10/2026', tom: 'warn' });
  assert.deepEqual(G.feriadosClinica({ ativa: true, feriados_ate: null }, '2026-10-30'), { texto: 'Não conferidos', tom: 'warn' });
  assert.deepEqual(G.feriadosClinica(c, '2026-10-30'), { texto: '—', tom: '' }, 'sem agenda não há o que conferir');
});

test('central: aviso do feriado nacional (sem nenhum, o IMED não oferece horário) e a chave que diz se algo mudou', () => {
  assert.equal(G.avisoFeriadoNacional(null, '2026-10-30').tom, 'warn');
  assert.match(G.avisoFeriadoNacional(null, '2026-10-30').texto, /^Nenhum feriado nacional foi lançado ainda\. Enquanto isso, o IMED não oferece horário para marcar em nenhuma clínica\./);
  assert.deepEqual(G.avisoFeriadoNacional('2026-12-31', '2026-10-30'), { tom: 'info', texto: 'Feriados nacionais lançados até 31/12/2026: nenhuma clínica oferece horário depois desse dia.' });
  assert.equal(G.avisoFeriadoNacional('2026-12-31', '2026-12-31').tom, 'info');
  assert.equal(G.avisoFeriadoNacional('2026-12-31', '2027-01-01').tom, 'warn');
  assert.match(G.avisoFeriadoNacional('2026-12-31', '2027-01-01').texto, /só até 31\/12\/2026, que já passou/);
  const v = { status: 'ok', version: 49, changed_at: '2026-10-30T15:00:00Z', clinics: 2, open_conflicts: 2 };
  assert.equal(G.centralFingerprint(v), '49|2026-10-30T15:00:00Z|2|2');
  assert.notEqual(G.centralFingerprint(v), G.centralFingerprint({ ...v, open_conflicts: 3 }));
  assert.equal(G.centralFingerprint({ status: 'forbidden' }), '');
});

test('central, conflitos: tipo e situação em português, horário no fuso da clínica; código desconhecido aparece como veio', () => {
  const d = G.normalizeConflitos({ status: 'ok', generated_at: '2026-10-30T15:00:00Z', total: 3, open: 1, conflicts: [
    { id: 'k1', clinic_id: 'c1', clinic_name: 'Clínica de Manaus', timezone: 'America/Manaus', kind: 'bloqueio_sobre_agendamento', status: 'aberto', resolution_code: null, created_at: '2026-10-30T13:10:00Z', resolved_at: null, starts_at: '2026-11-03T13:00:00Z' },
    { id: 'k2', clinic_name: 'B', timezone: null, kind: 'grade_mudou', status: 'resolvido', resolution_code: 'remarcado', created_at: '2026-10-20T12:00:00Z', resolved_at: '2026-10-21T15:00:00Z', starts_at: null },
    { id: 'k3', clinic_name: 'C', kind: 'tipo_novo', status: 'descartado', resolution_code: 'codigo_novo', created_at: 'lixo', resolved_at: null },
    { clinic_name: 'sem id' },
  ] });
  assert.deepEqual([d.total, d.abertos, d.linhas.length], [3, 1, 3]);
  assert.deepEqual(d.linhas[0], { id: 'k1', clinica: 'Clínica de Manaus', tipo: 'bloqueio_sobre_agendamento', situacao: 'aberto', aberto: true, criado_em: '2026-10-30T13:10:00Z', resolvido_em: null, horario: 'ter., 03/11 às 09:00', resolucao: '' });
  assert.equal(d.linhas[0].horario, 'ter., 03/11 às 09:00', '13:00 UTC = 09:00 em Manaus (o fuso da clínica, não o de quem olha)');
  assert.deepEqual([d.linhas[1].horario, d.linhas[1].resolucao, d.linhas[1].aberto], ['', 'remarcado', false]);
  assert.deepEqual([d.linhas[2].resolucao, d.linhas[2].criado_em], ['código: codigo_novo', null]);
  assert.equal(G.normalizeConflitos({ status: 'ok', conflicts: [{ id: 'k4', kind: 'grade_mudou', status: 'resolvido', resolution_code: 'feriado_retirado' }] }).linhas[0].resolucao,
    'feriado retirado, o horário voltou a valer', 'conflito fechado porque o feriado foi retirado (central ou volta dos feriados nacionais): tem nome');
  assert.deepEqual(['bloqueio_sobre_agendamento', 'grade_mudou', 'capacidade', 'fuso_mudou', 'tipo_novo', ''].map(G.conflitoTexto),
    ['Horário bloqueado pela clínica', 'O horário não cabe mais na configuração', 'Capacidade reduzida', 'O fuso da clínica mudou', 'Código: tipo_novo', '—']);
  // os 8 tipos que o banco aceita (CHECK de agenda.conflicts) têm nome
  const base2 = read(migracao('_agenda_base_parte_2.sql'));
  const tipos = base2.slice(base2.indexOf('create table if not exists agenda.conflicts')).match(/kind text not null check \(kind in \(([^)]+)\)\)/)[1].match(/'[a-z_]+'/g).map((x) => x.slice(1, -1));
  assert.equal(tipos.length, 8);
  for (const t of tipos) assert.doesNotMatch(G.conflitoTexto(t), /^Código:/, `conflito ${t} com nome em português`);
});

test('central, auditoria: papel, origem, ação e objeto em português; leituras só somadas; filtros', () => {
  const d = G.normalizeAuditoria({ status: 'ok', generated_at: '2026-10-30T15:00:00Z', days: 30, from: '2026-10-01', totals: { changes: 3, reads: 37, readers: 3, imed_reads: 2 },
    object_types: ['setting', 'clinic_block', 'Coisa Feia; drop', 'objeto_novo', null],
    changes: [
      { id: 9, at: '2026-10-30T14:40:00Z', clinic_id: 'c1', clinic_name: 'Imagem Paulista', actor_kind: 'clinica', actor_role: 'reception', actor: 'a1b2c3d4', origin: 'painel', action: 'bloqueio.criar_forcado', object_type: 'clinic_block', reason_code: null },
      { id: 8, at: '2026-10-30T13:00:00Z', clinic_id: null, clinic_name: null, actor_kind: 'imed', actor_role: 'imed_operacao', actor: 'e1e1e1e1', origin: 'central', action: 'feriado.criar', object_type: 'holiday', reason_code: null },
      { id: 7, at: '2026-10-29T12:00:00Z', clinic_name: 'X', actor_kind: 'sql', actor_role: null, actor: null, origin: 'sql', action: 'acao_nova', object_type: 'objeto_novo', reason_code: 'teste_agenda' },
    ],
    reads: [
      { day: '2026-10-30', clinic_name: 'Imagem Paulista', actor: 'a1b2c3d4', actor_role: 'reception', fn: 'agenda_view', scope: 'clinica', justification_code: null, reads: 31, requests: 0 },
      { day: '2026-10-30', clinic_name: 'Imagem Paulista', actor: 'f0f0f0f0', actor_role: 'imed', fn: 'agenda_request_detail', scope: 'central', justification_code: 'suporte_clinica', reads: 2, requests: 1 },
      { day: '2026-10-29', clinic_name: 'B', actor: 'b2b2b2b2', actor_role: null, fn: 'funcao_nova', scope: 'x', justification_code: 'motivo_novo', reads: 1, requests: 1 },
    ] });
  assert.deepEqual(d.totais, { changes: 3, reads: 37, readers: 3, imed_reads: 2 });
  assert.deepEqual(d.objetos, ['clinic_block', 'objeto_novo', 'setting'], 'só códigos, na ordem do nome em português (Bloqueio, objeto_novo, Parâmetro global)');
  assert.deepEqual(d.mudancas[0], { id: '9', em: '2026-10-30T14:40:00Z', clinica: 'Imagem Paulista', quem: 'Recepção', conta: 'a1b2c3d4', acao: 'Bloqueou por cima de agendamentos', objeto: 'Bloqueio', origem: 'Painel da clínica', motivo: '' });
  assert.deepEqual([d.mudancas[1].quem, d.mudancas[1].acao, d.mudancas[1].objeto, d.mudancas[1].origem, d.mudancas[1].clinica], ['Equipe do IMED (operação)', 'Lançou um feriado', 'Feriado', 'Central do IMED', '']);
  assert.deepEqual([d.mudancas[2].quem, d.mudancas[2].acao, d.mudancas[2].objeto, d.mudancas[2].origem, d.mudancas[2].motivo, d.mudancas[2].conta],
    ['Equipe técnica do IMED (correção manual)', 'Código: acao_nova', 'objeto_novo', 'Correção manual', 'Código: teste_agenda', '']);
  assert.deepEqual(d.leituras[0], { dia: '2026-10-30', clinica: 'Imagem Paulista', quem: 'Recepção', conta: 'a1b2c3d4', tela: 'Grade da agenda (nome curto)', escopo: 'clinica', motivo: '', leituras: 31, agendamentos: 0 });
  assert.deepEqual([d.leituras[1].quem, d.leituras[1].tela, d.leituras[1].motivo], ['Equipe do IMED', 'Detalhe de um agendamento', 'Suporte pedido pela clínica']);
  assert.deepEqual([d.leituras[2].quem, d.leituras[2].tela, d.leituras[2].motivo], ['Equipe do IMED', 'Função: funcao_nova', 'Código: motivo_novo'], 'com motivo registrado, foi a equipe do IMED');
  // nenhuma linha traz id de pedido, de conta inteira ou valores da auditoria
  for (const l of [...d.mudancas, ...d.leituras]) assert.deepEqual(Object.keys(l).filter((k) => /request|user|old|new|paciente|patient/.test(k)), []);
  // os 4 motivos da "quebra de vidro" (decisão 4.2-f) são os do painel da clínica, sem cópia
  assert.deepEqual(['suporte_clinica', 'pedido_do_paciente', 'auditoria', 'conflito_agenda'].map(G.motivoTexto), ['Suporte pedido pela clínica', 'Pedido do próprio paciente', 'Conferência ou auditoria', 'Resolver um problema da agenda']);
  assert.equal(G.motivoTexto(null), '');
  assert.deepEqual([G.quemTexto('clinica', 'owner'), G.quemTexto('imed', 'imed_admin'), G.quemTexto('sistema', ''), G.quemTexto('', 'papel_novo'), G.quemTexto('', '')],
    ['Dono(a)', 'Administração do IMED', 'Automático', 'papel_novo', '—']);
  // toda ação que as migrações gravam na auditoria tem nome em português
  const sql = readdirSync(join(ROOT, 'supabase/migrations')).map((f) => read(`supabase/migrations/${f}`)).join('\n');
  const acoes = new Set([...sql.matchAll(/agenda_audit\([^;]*?'(?:painel|central|cron)'\s*,\s*'([a-z_.]+)'/g)].map((m) => m[1]));
  for (const m of sql.matchAll(/agenda_audit\(\s*[a-z_.()]+\s*,\s*[a-z_]+\s*,\s*(?:case when [^']*)?'([a-z]+[._][a-z_.]+)'/g)) acoes.add(m[1]);
  for (const m of sql.matchAll(/'((?:pedido|clinica)_[a-z_]+_sql)'/g)) acoes.add(m[1]); // correções pelo SQL (guardas da 3.1)
  for (const t of ['occupancy', 'appointment_items']) for (const op of ['insert', 'update', 'delete']) acoes.add(`${t}_${op}`);
  for (const a of ['pedido_criado_sql', 'pedido_alterado_sql', 'pedido_apagado_sql', 'clinica_criada_sql', 'clinica_agenda_sql']) assert.ok(acoes.has(a), `achou ${a} nas migrações`);
  for (const a of ['parametro.definir', 'parametro.padrao', 'feriado.criar', 'feriado.remover', 'modalidade.trocar', 'bloqueio.criar_forcado', 'convite_criado', 'membro_removido', 'papel_trocado', 'imed_staff_insert', 'imed_staff_update', 'conflito_resolvido', 'conflito_descartado', 'conflito_em_andamento']) acoes.add(a);
  assert.ok(acoes.size >= 20, `ações achadas nas migrações: ${acoes.size}`);
  for (const a of acoes) if (!a.endsWith('_')) assert.doesNotMatch(G.acaoTexto(a), /^Código:/, `ação ${a} com nome em português`);
  // filtros
  assert.deepEqual(G.filtrosAuditoria(), { ok: true, errors: {}, filters: { days: 30 } });
  assert.deepEqual(G.filtrosAuditoria({ dias: 7, clinica: 'c1', objeto: 'holiday', conta: ' A1B2C3D4 ' }).filters, { days: 7, clinic: 'c1', object_type: 'holiday', actor: 'a1b2c3d4' });
  assert.equal(G.filtrosAuditoria({ dias: 13 }).filters.days, 30, 'período fora da lista: 30 dias');
  for (const ruim of ['xyz', 'a1b2c3d', 'a1b2c3d4e', 'g1b2c3d4', 'a1b2-3d4']) {
    const v = G.filtrosAuditoria({ conta: ruim });
    assert.equal(v.ok, false, ruim);
    assert.match(v.errors.conta, /8 caracteres/);
    assert.ok(!('actor' in v.filters));
  }
});

test('central, parâmetros: só o que o banco manda; limites; nome e explicação do único parâmetro em uso', () => {
  const d = G.normalizeParametros({ status: 'ok', can_edit: true, params: [
    { key: 'agenda.limite_futuros_por_telefone', default: 3, min: 1, max: 20, value: null, effective: 3, updated_at: null },
    { key: 'agenda.parametro_novo', default: 10, min: 5, max: 50, value: 12, effective: 12, updated_at: '2026-10-30T15:00:00Z' }, { default: 1 }] });
  assert.equal(d.pode_editar, true);
  assert.equal(d.lista.length, 2);
  assert.deepEqual([d.lista[0].nome, d.lista[0].padrao, d.lista[0].gravado, d.lista[0].em_vigor], ['Agendamentos por vir do mesmo telefone, na mesma clínica', 3, null, 3]);
  assert.match(d.lista[0].ajuda, /o balcão da clínica não tem esse limite/);
  assert.deepEqual([d.lista[1].nome, d.lista[1].ajuda, d.lista[1].gravado], ['agenda.parametro_novo', '', 12], 'parâmetro que a tela não conhece aparece pela chave, sem explicação inventada');
  assert.equal(G.normalizeParametros({ status: 'ok', params: [] }).pode_editar, false);
  const p = d.lista[0];
  assert.deepEqual(G.validarParametro(p, ' 5 '), { ok: true, value: 5 });
  assert.deepEqual([1, 20].map((v) => G.validarParametro(p, v).ok), [true, true]);
  for (const v of [0, 21, 999999]) assert.deepEqual(G.validarParametro(p, v), { ok: false, error: 'Use um número de 1 a 20.' });
  for (const v of ['', 'abc', '3,5', '3.5', '-1', '1e1', null]) assert.deepEqual(G.validarParametro(p, v), { ok: false, error: 'Digite um número inteiro.' });
  // o padrão e a chave são os do banco (a migração da central e a função que lê o parâmetro)
  const mig = read(migracao('_agenda_central.sql'));
  assert.match(mig, /values \('agenda\.limite_futuros_por_telefone'::text, 3, 1, 20\);/);
  assert.match(read(migracao('_agenda_operacao_parte_2.sql')), /agenda_setting_int\('agenda\.limite_futuros_por_telefone', 3\)/);
});

test('central, feriados: só nacionais na lista; validação (dia de hoje em diante, até o fim do ano que vem depois do próximo); a frase da conferência', () => {
  const d = G.normalizeFeriados({ status: 'ok', today: '2026-10-30', can_edit: true, national_until: '2026-12-31', clinics_with_agenda: 2, holidays: [
    { id: 'h1', scope: 'nacional', uf: null, day: '2026-12-25', name: 'Natal', source: 'Fonte de teste' },
    { id: 'h2', scope: 'uf', uf: 'SP', day: '2026-07-09', name: 'Estadual', source: 'Fonte' }, { id: 'h3', scope: 'municipio', uf: 'SP', day: '2026-01-25', name: 'Municipal', source: 'Fonte' },
    { id: 'h4', scope: 'nacional', day: '31/12/2026', name: 'dia fora do formato' }, { scope: 'nacional', day: '2026-01-01' }] });
  assert.deepEqual(d.nacionais, [{ id: 'h1', escopo: 'nacional', uf: '', dia: '2026-12-25', nome: 'Natal', fonte: 'Fonte de teste' }]);
  assert.deepEqual([d.outros, d.hoje, d.pode_editar, d.nacional_ate, d.clinicas_com_agenda], [2, '2026-10-30', true, '2026-12-31', 2]);
  assert.equal(G.feriadoMax('2026-10-30'), '2028-12-31');
  const bom = { dia: '2026-12-25', nome: ' Natal ', fonte: ' Fonte de teste ' };
  assert.deepEqual(G.validarFeriado(bom, '2026-10-30'), { ok: true, errors: {}, payload: { scope: 'nacional', day: '2026-12-25', name: 'Natal', source: 'Fonte de teste' } });
  assert.equal(G.validarFeriado({ ...bom, dia: '2026-10-30' }, '2026-10-30').ok, true, 'hoje vale');
  assert.equal(G.validarFeriado({ ...bom, dia: '2028-12-31' }, '2026-10-30').ok, true);
  assert.deepEqual(G.validarFeriado({}, '2026-10-30').errors, { dia: 'Escolha o dia do feriado.', nome: 'Escreva o nome do feriado (de 2 a 120 letras).', fonte: 'Informe a lei, o decreto ou a portaria que criou o feriado (de 3 a 300 letras).' });
  assert.equal(G.validarFeriado({ ...bom, dia: '2026-10-29' }, '2026-10-30').errors.dia, 'Escolha um dia de hoje em diante.');
  assert.equal(G.validarFeriado({ ...bom, dia: '2029-01-01' }, '2026-10-30').errors.dia, 'Use um dia até 31/12/2028.', 'um ano digitado errado esticaria o prazo de venda de todas as clínicas');
  assert.equal(G.validarFeriado({ ...bom, dia: '2026-02-30' }, '2026-01-01').errors.dia, 'Escolha o dia do feriado.');
  assert.ok(G.validarFeriado({ ...bom, nome: 'N' }, '2026-10-30').errors.nome);
  assert.ok(G.validarFeriado({ ...bom, nome: 'x'.repeat(121) }, '2026-10-30').errors.nome);
  assert.ok(G.validarFeriado({ ...bom, fonte: 'ab' }, '2026-10-30').errors.fonte);
  assert.ok(G.validarFeriado({ ...bom, fonte: 'x'.repeat(301) }, '2026-10-30').errors.fonte);
  const pay = { day: '2026-12-25', name: 'Natal' };
  assert.deepEqual(G.previaFeriado({ status: 'ok', already: false, clinics_closing: 2, appointments: 3 }, pay),
    { ja_existe: false, agendamentos: 3, texto: 'sexta-feira, 25/12/2026: “Natal”. 2 clínicas com a agenda ativa fecham nesse dia. 3 agendamentos já marcados nesse dia vão para “Precisa de atenção” da clínica, para remarcar.' });
  assert.equal(G.previaFeriado({ status: 'ok', already: false, clinics_closing: 1, appointments: 1 }, pay).texto,
    'sexta-feira, 25/12/2026: “Natal”. 1 clínica com a agenda ativa fecha nesse dia. 1 agendamento já marcado nesse dia vai para “Precisa de atenção” da clínica, para remarcar.');
  assert.equal(G.previaFeriado({ status: 'ok', already: false, clinics_closing: 0, appointments: 0 }, pay).texto,
    'sexta-feira, 25/12/2026: “Natal”. Nenhuma clínica com a agenda ativa fecha nesse dia hoje. Não há agendamento marcado nesse dia.');
  assert.equal(G.previaFeriado({ status: 'ok', already: true }, pay).ja_existe, true);
  assert.equal(G.previaFeriado({ status: 'ok' }, pay).texto, 'sexta-feira, 25/12/2026: “Natal”.', 'sem as contagens, nenhum número inventado');
  assert.equal(G.previaFeriado({ status: 'forbidden' }, pay), null);
  assert.equal(G.diaLongo('2026-12-25'), 'sexta-feira, 25/12/2026');
});

test('central, equipe do IMED: os 4 papéis da matriz do banco, o que cada um pode, e a validação de "dar papel"', () => {
  assert.deepEqual(G.IMED_PAPEIS.map(([k, n]) => [k, n]), [['operacao', 'Operação'], ['suporte', 'Suporte'], ['financeiro', 'Financeiro'], ['auditoria', 'Auditoria']]);
  // os mesmos papéis do CHECK de private.imed_staff e as mesmas permissões da matriz (agenda.role_permissions)
  const base2 = read(migracao('_agenda_base_parte_2.sql'));
  assert.match(base2, /role text not null check \(role in \('operacao', 'suporte', 'financeiro', 'auditoria'\)\)/);
  const perms = new Set([...read(migracao('_agenda_base_parte_5.sql')).matchAll(/\('imed_[a-z]+', '(imed\.[a-z_.]+)', 'imed'\)/g)].map((m) => m[1]));
  assert.equal(perms.size, 8);
  for (const p of perms) assert.notEqual(G.permImed(p), p, `permissão ${p} com explicação em português`);
  assert.equal(G.permImed('imed.nova.permissao'), 'imed.nova.permissao', 'permissão que a tela não conhece aparece como veio');
  assert.match(G.IMED_PAPEIS.find(([k]) => k === 'suporte')[2], /sem ver nenhum dado de paciente/);
  const d = G.normalizeEquipe({ status: 'ok', roles: [{ role: 'suporte', permissions: ['imed.agenda.monitor'] }, { permissions: [] }],
    staff: [{ user_id: 'u1', code: 'f0f0f0f0', email: 'ana.equipe@imed.test', role: 'suporte', granted_at: '2026-10-30T15:00:00Z', revoked_at: null, active: true },
      { user_id: 'u2', code: 'f1f1f1f1', email: 'bia.equipe@imed.test', role: 'operacao', granted_at: '2026-10-01T15:00:00Z', revoked_at: '2026-10-20T15:00:00Z', active: false }, { email: 'sem id' }] });
  assert.deepEqual(d.papeis, [{ papel: 'suporte', pode: ['ver a agenda das clínicas, sem nome de paciente'] }]);
  assert.deepEqual(d.pessoas[0], { user_id: 'u1', conta: 'f0f0f0f0', email: 'ana.equipe@imed.test', papel: 'suporte', desde: '2026-10-30T15:00:00Z', retirado_em: null, ativo: true });
  assert.deepEqual([d.pessoas.length, d.pessoas[1].ativo, d.pessoas[1].retirado_em], [2, false, '2026-10-20T15:00:00Z']);
  assert.deepEqual(['operacao', 'auditoria', 'papel_novo', ''].map(G.papelImed), ['Operação', 'Auditoria', 'papel_novo', '—']);
  assert.deepEqual(G.validarPapel({ email: '  Ana.Equipe@IMED.test ', papel: 'suporte' }), { ok: true, errors: {}, payload: { p_email: 'ana.equipe@imed.test', p_role: 'suporte' } });
  assert.deepEqual(G.validarPapel({}).errors, { email: 'Digite o e-mail da conta da pessoa.', papel: 'Escolha o papel.' });
  for (const e of ['ana', 'ana@', 'ana@imed', '@imed.test', 'a b@imed.test', `${'x'.repeat(250)}@a.test`]) assert.equal(G.validarPapel({ email: e, papel: 'suporte' }).errors.email, 'Confira o e-mail: parece incompleto.', e);
  assert.ok(G.validarPapel({ email: 'ana@imed.test', papel: 'admin' }).errors.papel, 'administrador não é um papel que se dá por aqui');
  // respostas do banco em palavras simples
  assert.match(G.centralStatus('user_not_found'), /^Não achamos uma conta com esse e-mail e o e-mail confirmado\./);
  assert.match(G.centralStatus('already_admin'), /já tem todas as permissões/);
  assert.equal(G.centralStatus('status_novo'), 'Não foi possível concluir agora. Tente de novo em instantes.');
  assert.equal(G.centralStatus('status_novo', 'Outro texto.'), 'Outro texto.');
});

test('central, a tela (gestao-central.js): só as funções da central (que conferem a equipe no banco), nada guardado no aparelho, nenhum dado de paciente pedido', () => {
  const js = read('assets/js/gestao-central.js').replace(/^\s*\/\/.*$/gm, ''); // sem os comentários
  const fns = [...new Set([...js.matchAll(/(?:auth\.rpc|gravar)\('([a-z_]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(fns, ['agenda_central_audit', 'agenda_central_conflicts', 'agenda_central_holiday_preview', 'agenda_central_holidays', 'agenda_central_overview', 'agenda_central_setting_set',
    'agenda_central_settings', 'agenda_central_staff', 'agenda_central_staff_grant', 'agenda_central_staff_revoke', 'agenda_holiday_remove', 'agenda_holiday_save']);
  assert.match(read('assets/js/tempo-real.js'), /rpc\('agenda_central_version', \{\}\)/, 'a 13ª chamada (a versão) é do vigia');
  // toda função chamada existe nas migrações, com EXECUTE só para quem está logado
  const sql = readdirSync(join(ROOT, 'supabase/migrations')).map((f) => read(`supabase/migrations/${f}`)).join('\n');
  for (const fn of [...fns, 'agenda_central_version']) assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`), `${fn} existe no banco`);
  const mig = read(migracao('_agenda_central.sql'));
  const novas = [...mig.matchAll(/create or replace function public\.(agenda_central_[a-z_]+)\(/g)].map((m) => m[1]);
  assert.equal(novas.length, 11);
  for (const fn of novas) {
    assert.match(mig, new RegExp(`revoke all on function public\\.${fn}\\([a-z, ]*\\) from public, anon, authenticated;\\ngrant execute on function public\\.${fn}\\([a-z, ]*\\) to authenticated;`), `${fn}: só quem está logado executa`);
    const corpo = mig.slice(mig.indexOf(`create or replace function public.${fn}(`)).split('\nend $$;')[0];
    assert.match(corpo, /security definer\nset search_path = ''/, `${fn}: search_path vazio`);
    assert.match(corpo, /if not (public\.imed_has\('imed\.[a-z_.]+'\)|coalesce\(public\.is_imed_admin\(\), false\)) then return jsonb_build_object\('status', 'forbidden'\); end if;/, `${fn}: confere a equipe antes de qualquer coisa`);
    assert.doesNotMatch(corpo, /patient_|\bphone\b|notes\b|'request_id'|'item_id'/, `${fn}: nada do paciente nem do pedido na resposta`);
  }
  // papéis e parâmetros: só o administrador; a prévia e a auditoria, pela permissão certa
  for (const fn of ['agenda_central_staff', 'agenda_central_staff_grant', 'agenda_central_staff_revoke', 'agenda_central_setting_set']) {
    assert.match(mig.slice(mig.indexOf(`create or replace function public.${fn}(`)).split('\nend $$;')[0], /if not coalesce\(public\.is_imed_admin\(\), false\) then/, `${fn}: só o administrador`);
  }
  assert.match(mig.slice(mig.indexOf('function public.agenda_central_audit(')).split('\nend $$;')[0], /imed_has\('imed\.auditoria\.ver'\)/);
  assert.match(mig.slice(mig.indexOf('function public.agenda_central_holiday_preview(')).split('\nend $$;')[0], /imed_has\('imed\.feriados\.editar'\)/);
  // migração só aditiva (nada apagado nem trocado) e a volta desfaz exatamente o que ela cria
  const semComentario = mig.replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(semComentario, /\b(drop|alter|truncate|delete from public|create (table|policy|trigger|index))\b/i, 'só funções novas, REVOKE e GRANT');
  const volta = read(`supabase/volta/${migracao('_agenda_central.sql').split('/').pop()}`);
  const criadas = [...mig.matchAll(/create or replace function ((?:public|private)\.agenda_central_[a-z_]+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual([...volta.matchAll(/drop function if exists ((?:public|private)\.[a-z_]+)\(/g)].map((m) => m[1]).sort(), criadas, 'a volta tira as 12 funções (11 públicas e a lista de parâmetros)');
  assert.equal(criadas.length, 12);
  // a tela
  assert.ok(!/auth\.select\(|auth\.insert\(|localStorage|sessionStorage|document\.cookie/.test(js), 'nada de tabela direta nem de guardar no aparelho');
  assert.ok(!/patient|paciente_nome|telefone|phone/.test(js), 'a tela não pede nem mostra campo de paciente');
  assert.ok(!/tempo real/i.test(js), 'a tela não promete "tempo real" (R2-18)');
  assert.match(js, /startCentralWatcher\(/);
  const g = read('assets/js/gestao.js').replace(/^\s*\/\/.*$/gm, '');
  assert.match(g, /startCentral\(\{ lost, forbidden: notAdmin \}\);/);
  assert.ok(g.indexOf('startCentral(') > g.indexOf('function renderShell'), 'a central só começa com o painel montado (depois de o banco confirmar a equipe)');
  assert.match(g, /function reset\(\) \{[\s\S]*?stopCentral\(\);/, 'ao sair da conta, a central para (canal fechado, nada mais é conferido)');
  // mesma largura de quebra das tabelas → cartões que a das cobranças
  const css = read('assets/css/gestao.css');
  assert.match(css, /@media \(max-width:760px\)\{\n {2}\/\* as tabelas da central viram cartões/);
});
