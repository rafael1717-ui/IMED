// Receita completa, etapa 1: as regras puras (assets/js/receita-core.js) e a igualdade entre a tela e o banco
// (supabase/migrations/..._ws_receita.sql). Sem navegador e sem rede. Rodar: node --test tests/receita.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as R from '../assets/js/receita-core.js';

const raiz = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const MIG = (() => {
  const nome = readdirSync(raiz('supabase/migrations')).find((f) => /_ws_receita\.sql$/.test(f));
  assert.ok(nome, 'a migração da receita existe');
  return readFileSync(raiz(`supabase/migrations/${nome}`), 'utf8');
})();
const funcao = (nome) => {
  const i = MIG.indexOf(`function ${nome}(`);
  assert.ok(i > 0, `${nome} está na migração`);
  return MIG.slice(i, MIG.indexOf('end $$;', i) > 0 && MIG.indexOf('end $$;', i) < MIG.indexOf('$$;', i) + 8 ? MIG.indexOf('end $$;', i) : MIG.indexOf('$$;', MIG.indexOf('as $$', i) + 5));
};

/* ===================== o modo de usar por extenso ===================== */
test('modo de usar por extenso: verbo pela via, dose no singular e no plural, frequência e duração', () => {
  const g = (it) => R.gerarPosologia({ tipo: 'industrializado', ...it });
  assert.equal(g({ dose: '1', unidade: 'comprimido', via: 'oral', freq_modo: 'intervalo', freq_n: 6, dur_modo: 'dias', dur_n: 7 }),
    'Tomar 1 comprimido por via oral a cada 6 horas, por 7 dias.');
  assert.equal(g({ dose: '2', unidade: 'comprimido', via: 'oral', freq_modo: 'vezes', freq_n: 3, dur_modo: 'continuo' }),
    'Tomar 2 comprimidos por via oral 3 vezes ao dia, uso contínuo.');
  assert.equal(g({ dose: '1/2', unidade: 'comprimidos', via: 'oral', freq_modo: 'uma' }), 'Tomar 1/2 comprimido por via oral 1 vez ao dia.', 'meio comprimido fica no singular');
  assert.equal(g({ dose: '1,5', unidade: 'mL', via: 'oral', freq_modo: 'intervalo', freq_n: 1, dur_modo: 'dias', dur_n: 1 }),
    'Tomar 1,5 mL por via oral a cada 1 hora, por 1 dia.', 'hora e dia no singular');
  assert.equal(g({ dose: '20', unidade: 'gota', via: 'oral', freq_modo: 'se_precisar', freq_texto: 'dor ou febre, até de 6 em 6 horas' }),
    'Tomar 20 gotas por via oral, se precisar: dor ou febre, até de 6 em 6 horas.');
  assert.equal(g({ dose: '1', unidade: 'comprimido', via: 'sublingual', freq_modo: 'uma' }), 'Colocar debaixo da língua 1 comprimido 1 vez ao dia.');
  assert.equal(g({ dose: '2', unidade: 'jato', via: 'inalatoria', freq_modo: 'intervalo', freq_n: 12 }), 'Inalar 2 jatos por via inalatória a cada 12 horas.');
  assert.equal(g({ dose: '1', unidade: 'gota', via: 'oftalmica', freq_modo: 'vezes', freq_n: 4, dur_modo: 'outra', dur_texto: 'até acabar o frasco' }),
    'Pingar 1 gota por via oftálmica 4 vezes ao dia, até acabar o frasco.');
  // creme: sem dose nem unidade
  assert.equal(g({ via: 'topica', freq_modo: 'vezes', freq_n: 2, dur_modo: 'dias', dur_n: 10 }), 'Aplicar por via tópica 2 vezes ao dia, por 10 dias.');
  assert.equal(g({ dose: '1', unidade: 'aplicação', via: 'outra', via_outra: 'bucal', freq_modo: 'outra', freq_texto: 'depois das refeições' }),
    'Usar 1 aplicação por via bucal, depois das refeições.');
  // unidade que não está na lista sai como foi escrita
  assert.equal(g({ dose: '3', unidade: 'borrifada', via: 'nasal', freq_modo: 'uma' }), 'Aplicar 3 borrifada por via nasal 1 vez ao dia.');
});

test('modo de usar: enquanto falta campo o texto fica vazio (nada é completado por conta própria)', () => {
  const g = R.gerarPosologia;
  assert.equal(g({}), '');
  assert.equal(g({ via: 'oral' }), '', 'sem frequência');
  assert.equal(g({ freq_modo: 'uma' }), '', 'sem via');
  assert.equal(g({ via: 'oral', freq_modo: 'intervalo' }), '', 'intervalo sem número');
  assert.equal(g({ via: 'oral', freq_modo: 'vezes', freq_n: 0 }), '', 'número fora da faixa');
  assert.equal(g({ via: 'oral', freq_modo: 'vezes', freq_n: 49 }), '');
  assert.equal(g({ via: 'oral', freq_modo: 'se_precisar' }), '', '"se precisar" pede o texto');
  assert.equal(g({ via: 'outra', freq_modo: 'uma' }), '', 'via "outra" pede o texto');
  assert.equal(g({ via: 'pela boca', freq_modo: 'uma' }), '', 'via fora da lista não vale');
});

test('texto editado à mão não é trocado quando os campos mudam; apagado, volta a acompanhar os campos', () => {
  const base = { via: 'oral', dose: '1', unidade: 'comprimido', freq_modo: 'uma' };
  let it = R.comPosologia(base);
  assert.equal(it.posologia, 'Tomar 1 comprimido por via oral 1 vez ao dia.');
  assert.equal(it.posologia_manual, false);
  it = R.comPosologiaDigitada(it, 'Tomar 1 comprimido pela manhã, em jejum.');
  assert.equal(it.posologia_manual, true);
  it = R.comPosologia({ ...it, dose: '2' });
  assert.equal(it.posologia, 'Tomar 1 comprimido pela manhã, em jejum.', 'o texto do médico fica');
  // digitou exatamente o texto gerado: não conta como editado
  assert.equal(R.comPosologiaDigitada(base, 'Tomar 1 comprimido por via oral 1 vez ao dia.').posologia_manual, false);
  // apagou: volta a ser gerado
  it = R.comPosologia(R.comPosologiaDigitada(it, '   '));
  assert.equal(it.posologia, 'Tomar 2 comprimidos por via oral 1 vez ao dia.');
  assert.equal(it.posologia_manual, false);
});

/* ===================== o que se salva ===================== */
test('item arrumado: só as chaves conhecidas, sem espaço sobrando, número como número e sempre o mesmo objeto', () => {
  const sujo = { tipo: 'qualquer', medicamento: '  Dipirona   sódica ', concentracao: ' 500 mg ', forma: 'comprimido', dose: ' 1 ', unidade: 'comprimido', via: 'oral', via_outra: 'sobra',
    freq_modo: 'intervalo', freq_n: '6', freq_texto: 'sobra', dur_modo: 'dias', dur_n: ' 5 ', dur_texto: 'sobra', composicao: 'sobra', quantidade: '1 caixa',
    orientacoes: ' Tomar com água. ', posologia: ' Tomar 1 comprimido. ', posologia_manual: 1, estranho: 'x', __proto__: { herdado: 1 } };
  const o = R.arrumarItem(sujo);
  assert.deepEqual(o, { tipo: 'industrializado', medicamento: 'Dipirona sódica', concentracao: '500 mg', forma: 'comprimido', dose: '1', unidade: 'comprimido', quantidade: '1 caixa',
    orientacoes: 'Tomar com água.', posologia: 'Tomar 1 comprimido.', via: 'oral', freq_modo: 'intervalo', freq_n: 6, dur_modo: 'dias', dur_n: 5, posologia_manual: false });
  assert.deepEqual(R.arrumarItem(o), o, 'arrumar de novo não muda nada');
  assert.equal(JSON.stringify(R.arrumarItem(o)), JSON.stringify(o), 'nem a ordem das chaves');
  // limites dos textos: corta no tamanho do banco
  for (const [k, max] of Object.entries(R.LIMITES)) {
    const it = R.arrumarItem({ tipo: 'manipulado', via: 'outra', freq_modo: 'outra', dur_modo: 'outra', [k]: 'a'.repeat(max + 50) });
    assert.equal(it[k].length, max, k);
  }
  // número fora da faixa não entra
  assert.equal('freq_n' in R.arrumarItem({ freq_modo: 'vezes', freq_n: 49 }), false);
  assert.equal('dur_n' in R.arrumarItem({ dur_modo: 'dias', dur_n: 366 }), false);
  assert.equal('freq_n' in R.arrumarItem({ freq_modo: 'uma', freq_n: 2 }), false, 'número só nos modos que usam número');
  // separadores de linha estranhos (U+2028/2029) viram quebra comum no texto longo
  assert.equal(R.arrumarItem({ posologia: 'a\u2028b\u2029c' }).posologia, 'a\nb\nc');
});

test('conteúdo do rascunho: itens vazios do fim não contam, no máximo 20, observação sem espaço sobrando', () => {
  const c = R.conteudo([{ medicamento: 'Dipirona' }, {}, { tipo: 'manipulado' }, R.itemNovo()], '  beber água  ');
  assert.deepEqual(c, { itens: [{ tipo: 'industrializado', medicamento: 'Dipirona' }], observacao: 'beber água' });
  // vazio no meio fica (a posição dos outros não muda sozinha)
  assert.equal(R.conteudo([{}, { medicamento: 'A' }], '').itens.length, 2);
  assert.equal(R.conteudo(Array.from({ length: 30 }, (_, i) => ({ medicamento: `M${i}` })), '').itens.length, R.MAX_ITENS);
  assert.equal(R.conteudo(null, '   ').observacao, null);
  assert.equal(R.conteudoVazio(R.conteudo([{}], '')), true);
  assert.equal(R.conteudoVazio(R.conteudo([], 'x')), false);
  assert.equal(R.conteudoVazio(null), true);
});

/* ===================== o que sai impresso ===================== */
test('impresso: mesmo formato da receita simples; fórmula manipulada com a composição; ida e volta', () => {
  const it = R.comPosologia({ medicamento: 'Dipirona sódica', concentracao: '500 mg', forma: 'comprimido', dose: '1', unidade: 'comprimido', via: 'oral',
    freq_modo: 'intervalo', freq_n: 6, dur_modo: 'dias', dur_n: 3, quantidade: '1 caixa', orientacoes: 'Se a febre continuar, procure atendimento.' });
  const p = R.paraImpresso(it);
  assert.deepEqual(p, { medicamento: 'Dipirona sódica', concentracao: '500 mg', forma: 'comprimido', via: 'oral', posologia: 'Tomar 1 comprimido por via oral a cada 6 horas, por 3 dias.',
    quantidade: '1 caixa', duracao: '3 dias', observacao: 'Se a febre continuar, procure atendimento.' });
  assert.equal(R.duracaoTexto({ dur_modo: 'dias', dur_n: 1 }), '1 dia');
  assert.equal(R.duracaoTexto({ dur_modo: 'continuo' }), 'uso contínuo');
  assert.equal(R.duracaoTexto({ dur_modo: 'outra', dur_texto: 'até a consulta de volta' }), 'até a consulta de volta');
  assert.equal(R.duracaoTexto({}), '');
  // manipulado
  const m = { tipo: 'manipulado', medicamento: 'Creme hidratante', composicao: 'ureia 10%, creme base qsp 100 g', forma: 'creme', via: 'topica', freq_modo: 'vezes', freq_n: 2 };
  assert.equal(R.medicamentoImpresso(m), 'Creme hidratante (fórmula manipulada): ureia 10%, creme base qsp 100 g');
  assert.equal(R.medicamentoImpresso({ ...m, medicamento: '' }), 'Fórmula manipulada: ureia 10%, creme base qsp 100 g');
  assert.equal(R.paraImpresso(m).concentracao, 'conforme a fórmula');
  assert.equal(R.paraImpresso({ ...m, composicao: '' }).medicamento, '', 'manipulado sem composição não imprime nome (falta campo)');
  assert.equal(R.medicamentoImpresso({ medicamento: 'Dipirona', composicao: 'não entra' }), 'Dipirona', 'composição só no manipulado');
  // volta: o texto entra como editado à mão; a duração volta para os campos
  const v = R.deImpresso(p);
  assert.equal(v.posologia_manual, true);
  assert.deepEqual([v.via, v.dur_modo, v.dur_n, v.orientacoes], ['oral', 'dias', 3, 'Se a febre continuar, procure atendimento.']);
  assert.deepEqual(R.paraImpresso(v), p, 'ida e volta dá o mesmo impresso');
  assert.deepEqual([R.deImpresso({ via: 'Subcutânea' }).via, R.deImpresso({ via: 'bucal' }).via, R.deImpresso({ via: 'bucal' }).via_outra], ['subcutanea', 'outra', 'bucal']);
  assert.equal(R.deImpresso({ duracao: 'uso contínuo' }).dur_modo, 'continuo');
  assert.deepEqual([R.deImpresso({ duracao: '2 semanas' }).dur_modo, R.deImpresso({ duracao: '2 semanas' }).dur_texto], ['outra', '2 semanas']);
  assert.deepEqual(R.listaImpressa(null), []);
});

/* ===================== mexer na lista ===================== */
test('lista: subir, descer, duplicar e juntar um modelo sem passar de 20 nem mexer na lista original', () => {
  const a = [{ medicamento: 'A' }, { medicamento: 'B' }, { medicamento: 'C' }];
  assert.deepEqual(R.mover(a, 0, 1).map((x) => x.medicamento), ['B', 'A', 'C']);
  assert.deepEqual(R.mover(a, 2, -1).map((x) => x.medicamento), ['A', 'C', 'B']);
  assert.equal(R.mover(a, 0, -1), a, 'o primeiro não sobe');
  assert.equal(R.mover(a, 2, 1), a, 'o último não desce');
  assert.deepEqual(a.map((x) => x.medicamento), ['A', 'B', 'C'], 'a original fica como estava');
  const d = R.duplicar(a, 1);
  assert.deepEqual(d.map((x) => x.medicamento), ['A', 'B', 'B', 'C']);
  assert.notEqual(d[1], d[2], 'a cópia é outro objeto');
  const cheia = Array.from({ length: R.MAX_ITENS }, (_, i) => ({ medicamento: `M${i}` }));
  assert.equal(R.duplicar(cheia, 0), cheia, 'com 20 não duplica');
  assert.deepEqual(R.acrescentar([{ medicamento: 'A' }, {}], [{ medicamento: ' B ' }, {}]).map((x) => x.medicamento), ['A', 'B'], 'vazios saem; o que entra é arrumado');
  assert.equal(R.acrescentar(cheia, [{ medicamento: 'X' }]).length, R.MAX_ITENS);
});

/* ===================== a lista de controle ===================== */
test('lista de controle: palavra inteira, sem acento e sem maiúscula; o nome mais comprido ganha; só o campo do nome', () => {
  const regras = R.regrasPadrao();
  const c = (...nomes) => R.conferirLista(nomes.map((medicamento) => ({ medicamento })), regras);
  assert.deepEqual(c('Amoxicilina 500 mg'), [{ n: 1, nome: 'Amoxicilina 500 mg', termo: 'amoxicilina', lista: 'antimicrobiano' }]);
  assert.deepEqual(c('Dipirona', 'OZEMPIC caneta', 'Paracetamol', 'Nitrofurantoína').map((b) => [b.n, b.termo, b.lista]),
    [[2, 'ozempic', 'glp1'], [4, 'nitrofurantoina', 'antimicrobiano']]);
  assert.deepEqual(c('Amoxicilina + clavulanato')[0].termo, 'amoxicilina', 'um item, um aviso (o nome mais comprido)');
  assert.deepEqual(c('Frontalina', 'Sulfametoxazol/trimetoprima', 'afrontal'), [{ n: 2, nome: 'Sulfametoxazol/trimetoprima', termo: 'sulfametoxazol', lista: 'antimicrobiano' }],
    'pedaço de palavra não trava');
  assert.deepEqual(c('Creme (fórmula manipulada): clonazepam 0,5 mg').map((b) => b.lista), ['portaria_344'], 'a composição do manipulado é conferida (vai no nome impresso)');
  assert.deepEqual(R.conferirLista([{ medicamento: 'Dipirona', posologia: 'não tomar com rivotril' }], regras), [], 'só o nome do remédio');
  assert.deepEqual(R.conferirLista(null, regras), []);
  assert.deepEqual(R.conferirLista([{ medicamento: 'Amoxicilina' }], null), [], 'sem lista não há trava na tela (a do banco continua valendo)');
});

test('aviso de bloqueio: diz o item, o nome e a lista, e manda para o caminho certo; não classifica remédio', () => {
  assert.equal(R.textoBloqueio([]), '');
  assert.equal(R.textoBloqueio([{ n: 1, termo: 'x', lista: 'desconhecida' }]), '', 'lista que a tela não conhece não vira texto');
  const um = R.textoBloqueio([{ n: 2, termo: 'amoxicilina', lista: 'antimicrobiano' }]);
  assert.match(um, /^Este item não sai pelo IMED: item 2 \(“amoxicilina”: antibiótico\)\. /);
  assert.match(um, /receita com retenção, pelo sistema da Anvisa \(SNCR\)\. Tire o item desta receita e prescreva pela Plataforma de Prescrição Eletrônica do CFM ou em papel\.$/);
  const dois = R.textoBloqueio([{ n: 1, termo: 'ozempic', lista: 'glp1' }, { n: 3, termo: 'rivotril', lista: 'portaria_344' }]);
  assert.match(dois, /^Estes itens não saem pelo IMED: item 1 \(“ozempic”: caneta GLP-1\); item 3 \(“rivotril”: remédio controlado \(Portaria 344\)\)\. /);
  assert.match(R.AVISO_LISTA, /só serve para travar: não classifica remédio\. A responsabilidade .* continua sendo do médico\.$/);
});

/* ===================== respostas do banco ===================== */
test('respostas do banco: formato estranho vira "não veio"; o que veio é arrumado', () => {
  assert.equal(R.normalizeRegras(null), null);
  assert.equal(R.normalizeRegras({ ok: false }), null);
  assert.deepEqual(R.normalizeRegras({ ok: true, itens: [{ nome: 'amoxicilina', lista: 'antimicrobiano', sobra: 1 }, { nome: 'Com Maiúscula', lista: 'glp1' }, { nome: 'a.*', lista: 'glp1' },
    { nome: 'x', lista: 'inventada' }, null] }), [{ nome: 'amoxicilina', lista: 'antimicrobiano' }], 'nome que não é só letra minúscula e número não entra (vai para uma expressão regular)');
  assert.equal(R.normalizeAbrir({ ok: false }), null);
  const a = R.normalizeAbrir({ ok: true, pode_editar: true, rascunho: { versao: 3, conteudo: { itens: [{ medicamento: ' A ', estranho: 1 }], observacao: ' o ' } },
    emitidas: [{ id: 7, emitida_em: '2026-11-16T12:00:00Z', documento_situacao: 'cancelado', conteudo: { itens: [] } }, { id: 'sem conteúdo' }, null] });
  assert.deepEqual(a, { podeEditar: true, versao: 3, conteudo: { itens: [{ tipo: 'industrializado', medicamento: 'A' }], observacao: 'o' },
    emitidas: [{ id: '7', emitidaEm: '2026-11-16T12:00:00Z', cancelada: true, conteudo: { itens: [], observacao: null } }] });
  assert.deepEqual(R.normalizeAbrir({ ok: true }), { podeEditar: false, versao: 0, conteudo: null, emitidas: [] }, 'sem rascunho');
  assert.equal(R.normalizeModelos({ ok: true }), null);
  assert.deepEqual(R.normalizeModelos({ ok: true, itens: [{ id: 'm1', nome: '  Dor  de cabeça ', conteudo: { itens: [{ medicamento: 'Dipirona' }] } }, { id: 2, nome: 'x', conteudo: {} }, { id: 'm3', nome: ' ', conteudo: {} }] }),
    [{ id: 'm1', nome: 'Dor de cabeça', conteudo: { itens: [{ tipo: 'industrializado', medicamento: 'Dipirona' }], observacao: null } }]);
  assert.equal(R.campoDaTela('itens.2.dur_n'), 'itens.2.duracao');
  assert.equal(R.campoDaTela('itens.1.freq_texto'), 'itens.1.frequencia');
  assert.equal(R.campoDaTela('itens.3.unidade'), 'itens.3.dose');
  assert.equal(R.campoDaTela('itens.1.medicamento'), 'itens.1.medicamento');
  assert.equal(R.campoDaTela('observacao'), 'observacao');
  assert.equal(R.campoDaTela('outra coisa'), null);
  assert.match(R.erroTexto('versao_conflito'), /alterada em outra aba/);
  assert.match(R.erroTexto('erro_que_nao_existe'), /^Não foi possível concluir agora\./);
});

/* ===================== a lista na mão da equipe ===================== */
test('equipe: lançar pede nome só com letras e números (3 a 60), lista e fonte; retirar pede motivo; as mesmas regras do banco', () => {
  assert.deepEqual(R.validarRegra('  Nitrofurantoína ', 'antimicrobiano', '  RDC 471/2021,   anexo I '), { ok: true, nome: 'nitrofurantoina', lista: 'antimicrobiano', fonte: 'RDC 471/2021, anexo I' });
  assert.equal(R.validarRegra('ab', 'glp1', 'fonte boa').campo, 'nome');
  assert.equal(R.validarRegra('amoxicilina 500mg/5ml', 'antimicrobiano', 'fonte boa').campo, 'nome', 'pontuação não entra (o nome vai para uma expressão regular)');
  assert.equal(R.validarRegra('a'.repeat(61), 'glp1', 'fonte boa').campo, 'nome');
  assert.equal(R.validarRegra('ozempic', '', 'fonte boa').campo, 'lista');
  assert.equal(R.validarRegra('ozempic', 'inventada', 'fonte boa').campo, 'lista');
  assert.equal(R.validarRegra('ozempic', 'glp1', 'abc').campo, 'fonte');
  assert.equal(R.validarRegra('ozempic', 'glp1', 'a'.repeat(301)).campo, 'fonte');
  assert.deepEqual(R.validarMotivo('  lançado por   engano '), { ok: true, motivo: 'lançado por engano' });
  assert.equal(R.validarMotivo('não').campo, 'motivo');
  assert.deepEqual(R.LISTAS, ['antimicrobiano', 'glp1', 'portaria_344']);
  // as mesmas regras em public.cat_regra_lancar e cat_regra_retirar
  const lancar = funcao('public.cat_regra_lancar');
  assert.match(lancar, /v_nome !~ '\^\[a-z0-9\]\+\( \[a-z0-9\]\+\)\*\$' or char_length\(v_nome\) not between 3 and 60/);
  assert.match(lancar, /not in \('antimicrobiano', 'glp1', 'portaria_344'\)/);
  assert.match(lancar, /char_length\(v_fonte\) not between 5 and 300/);
  assert.match(funcao('public.cat_regra_retirar'), /char_length\(v_motivo\) not between 5 and 300/);
});

test('equipe: a resposta da lista vira ativas e retiradas; formato estranho vira "não veio"', () => {
  assert.equal(R.normalizeRegrasAdmin(null), null);
  assert.equal(R.normalizeRegrasAdmin({ erro: 'forbidden' }), null);
  const d = R.normalizeRegrasAdmin({ ok: true, itens: [
    { id: 'a1', nome: 'amoxicilina', lista: 'antimicrobiano', fonte: ' Lista   de alerta ', vigente_desde: '2026-11-16T12:00:00Z', retirada_em: null, retirada_motivo: null },
    { id: 'a2', nome: 'tadalafila', lista: 'portaria_344', fonte: 'x', vigente_desde: 'ontem', retirada_em: '2026-11-17T12:00:00Z', retirada_motivo: 'lançado por engano' },
    { id: 3, nome: 'sem id de texto', lista: 'glp1' }, { id: 'a4', nome: 'x', lista: 'inventada' }, null] });
  assert.deepEqual(d.ativas, [{ id: 'a1', nome: 'amoxicilina', lista: 'antimicrobiano', fonte: 'Lista de alerta', desde: '2026-11-16T12:00:00Z', retiradaEm: null, motivo: '' }]);
  assert.deepEqual(d.retiradas, [{ id: 'a2', nome: 'tadalafila', lista: 'portaria_344', fonte: 'x', desde: null, retiradaEm: '2026-11-17T12:00:00Z', motivo: 'lançado por engano' }]);
});

/* ===================== a tela e o banco dizem a mesma coisa ===================== */
test('tela e banco: os mesmos 40 nomes na lista inicial, com a mesma lista de cada um', () => {
  const i = MIG.indexOf('insert into catalogo.med_regras (nome_busca, lista, fonte)');
  assert.ok(i > 0);
  const bloco = MIG.slice(i, MIG.indexOf(';', i));
  const doBanco = [...bloco.matchAll(/\('([a-z0-9 ]+)', '(antimicrobiano|glp1|portaria_344)'\)/g)].map((m) => `${m[1]}|${m[2]}`).sort();
  const daTela = R.regrasPadrao().map((r) => `${r.nome}|${r.lista}`).sort();
  assert.equal(doBanco.length, 40);
  assert.deepEqual(doBanco, daTela);
  assert.ok(R.regrasPadrao().every((r) => /^[a-z0-9]+( [a-z0-9]+)*$/.test(r.nome)), 'nomes já sem acento e em minúscula, como o banco guarda');
});

test('tela e banco: os mesmos limites de texto, as mesmas vias, frequências e durações, e os mesmos tetos (20 itens, 48, 365)', () => {
  const f = funcao('private.rx_conteudo_erro');
  const doBanco = Object.fromEntries([...f.matchAll(/when '([a-z_]+)' then (\d+)/g)].map((m) => [m[1], Number(m[2])]));
  for (const [k, max] of Object.entries(R.LIMITES)) assert.equal(doBanco[k], max, `limite de ${k}`);
  const lista = (campo) => { const m = new RegExp(`e ->> '${campo}', ''\\) not in \\(([^)]*)\\)`, 's').exec(f); assert.ok(m, campo); return [...m[1].matchAll(/'([a-z_]*)'/g)].map((x) => x[1]).filter(Boolean); };
  assert.deepEqual(lista('via'), R.VIAS.map(([id]) => id));
  assert.deepEqual(lista('freq_modo'), R.FREQS.map(([id]) => id));
  assert.deepEqual(lista('dur_modo'), R.DURS.map(([id]) => id));
  assert.match(f, /jsonb_array_length\(v_itens\) > 20/);
  assert.equal(R.MAX_ITENS, 20);
  assert.match(f, /'freq_n'\)::integer not between 1 and 48/);
  assert.match(f, /'dur_n'\)::integer not between 1 and 365/);
  assert.match(f, /char_length\(coalesce\(p ->> 'observacao', ''\)\) > 500/);
});

test('tela e banco: a via sai impressa com o mesmo nome dos dois lados', () => {
  const f = funcao('private.rx_via_rotulo');
  const doBanco = Object.fromEntries([...f.matchAll(/when '([a-z]+)' then '([^']+)'/g)].map((m) => [m[1], m[2]]));
  for (const [id, rotulo] of R.VIAS) {
    if (id === 'outra') continue;
    assert.equal(doBanco[id], rotulo, id);
    assert.equal(R.viaRotulo(id), rotulo);
  }
  assert.equal(R.viaRotulo('outra', '  bucal '), 'bucal');
  assert.equal(R.viaRotulo('outra', ''), '');
  assert.equal(R.viaRotulo('nao_existe'), '');
});
