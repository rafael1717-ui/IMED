// Regras puras da aba "Financeiro" do painel da clínica (iMed Pagamentos, fase P2b). Rodar: node --test tests/financeiro-core.test.mjs
// Todos os valores daqui são SIMULADOS (exemplos para a conta; não são preço, taxa nem movimento de clínica nenhuma).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as F from '../assets/js/financeiro-core.js';
import * as A from '../assets/js/agenda-core.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

// Como o banco responde (formato de pag_clinic_status, migração pagamentos_base_parte_4).
const STATUS = (o = {}) => ({
  status: 'ok', clinic_id: 'cccccccc-0000-4000-8000-000000000001', situacao: 'ativa', meios: ['pix'], carteira_final: '0001', emitida_por: 'imed', termos_versao: 'v1',
  aceito_em: '2026-11-10T14:00:00+00:00', conferida_em: '2026-11-11T02:30:00+00:00', payment_mode: 'online', vendas_online_ligadas: true, recebendo: true,
  taxa: { tipo: 'percentual', bps: 1500, cents: null, da_clinica: false, vale_de: '2026-11-01T00:00:00+00:00' }, preco_minimo_cents: 2000,
  pode_configurar: false, pode_estornar: false, ...o,
});
const LINHA = (o = {}) => ({ dia: '2026-11-12', cobranca: 'a1b2c3d4', meio: 'pix', situacao: 'aprovada', exam_code: 'rm', starts_at: '2026-11-14T12:30:00+00:00',
  preco_cents: 13323, taxa_cents: 1998, clinica_cents: 11325, devolvido_cents: 0, previsao: '2026-11-12', ...o });
const EXTRATO = (linhas = [LINHA()], totais = {}) => ({ status: 'ok', de: '2026-11-01', ate: '2026-11-13', linhas,
  totais: { valor_cents: 13323, taxa_cents: 1998, clinica_cents: 11325, devolvido_cents: 0, taxa_devolvida_cents: 0, clinica_devolvida_cents: 0, cobrancas: 1, ...totais } });

test('valores e datas: reais com centavos, porcentagem a partir dos pontos-base, dia de São Paulo e hora no fuso da clínica', () => {
  assert.equal(F.fmtBRL(13323), 'R$ 133,23');
  assert.equal(F.fmtBRL(0), 'R$ 0,00');
  assert.equal(F.fmtBRL(null), '—', 'sem o número do banco: traço, nunca zero');
  assert.equal(F.fmtBRL('133'), '—');
  assert.equal(F.fmtPct(1500), '15%');
  assert.equal(F.fmtPct(1250), '12,5%');
  assert.equal(F.fmtPct(null), '—');
  assert.equal(F.fmtDia('2026-11-13'), '13/11/2026');
  assert.equal(F.fmtDia('2026-02-30'), '—');
  assert.equal(F.hojeSP(Date.parse('2026-11-14T02:30:00Z')), '2026-11-13', 'às 23:30 de São Paulo ainda é dia 13');
  assert.equal(F.diaDe('2026-11-11T02:30:00+00:00'), '2026-11-10');
  assert.equal(F.diaDe('lixo'), '');
  assert.equal(F.fmtQuando('2026-11-14T12:30:00+00:00'), '14/11 às 09:30');
  assert.equal(F.fmtQuando('2026-11-14T12:30:00+00:00', 'America/Manaus'), '14/11 às 08:30', 'a hora do exame é a da clínica');
  assert.equal(F.fmtQuando('2026-11-14T12:30:00+00:00', 'Fuso/Inexistente'), '14/11 às 09:30', 'fuso desconhecido: São Paulo');
  assert.equal(F.fmtQuando(''), '');
  assert.equal(F.int('15'), 15);
  assert.equal(F.int(1.5), null);
  assert.equal(F.int(undefined), null);
});

test('situação do recebimento: só o que o banco respondeu; resposta estranha não vira "ligado"', () => {
  assert.equal(F.normalizeStatus(null), null);
  assert.equal(F.normalizeStatus({ status: 'ok', situacao: 'inventada' }), null);
  assert.deepEqual(F.normalizeStatus({ status: 'forbidden' }), { tipo: 'forbidden' });
  const st = F.normalizeStatus(STATUS());
  assert.deepEqual(st, { tipo: 'ok', situacao: 'ativa', meios: ['pix'], carteira_final: '0001', aceito_em: '2026-11-10', conferida_em: '2026-11-10', payment_mode: 'online',
    vendas_online_ligadas: true, recebendo: true, taxa: { tipo: 'percentual', bps: 1500, cents: null }, preco_minimo_cents: 2000 });
  assert.ok(!('pode_configurar' in st) && !('clinic_id' in st), 'só os campos da lista passam');
  // campos faltando ou tortos: tudo desligado e sem número
  const torto = F.normalizeStatus({ status: 'ok', situacao: 'ativa', recebendo: 'sim', vendas_online_ligadas: 1, payment_mode: 'ONLINE', taxa: { tipo: 'percentual', bps: 'quinze' }, carteira_final: '<b>x', meios: 'pix' });
  assert.deepEqual([torto.recebendo, torto.vendas_online_ligadas, torto.payment_mode, torto.taxa, torto.carteira_final, torto.meios, torto.preco_minimo_cents], [false, false, 'no_local', null, '', [], null]);
});

test('os 4 estados que a clínica vê: não disponível, em análise, desligado e ligado', () => {
  const e = (o) => F.estadoRecebimento(o === null ? null : F.normalizeStatus(STATUS(o)));
  assert.deepEqual(F.ESTADOS, ['indisponivel', 'analise', 'desligado', 'ligado']);
  // sem conta (hoje, todas as clínicas) e banco sem o pagamento: a mesma mensagem honesta
  for (const x of [e(null), e({ situacao: 'nao_ligada', recebendo: false, payment_mode: 'no_local', vendas_online_ligadas: false, carteira_final: null, aceito_em: null, conferida_em: null })]) {
    assert.equal(x.codigo, 'indisponivel');
    assert.equal(x.titulo, 'Recebimento on-line ainda não disponível');
    assert.match(x.texto, /^Hoje os pacientes pagam direto na clínica, como sempre\./);
  }
  assert.equal(F.estadoRecebimento({ tipo: 'forbidden' }).codigo, 'indisponivel');
  const an = e({ situacao: 'em_conferencia', recebendo: false, payment_mode: 'no_local', conferida_em: null });
  assert.equal(an.codigo, 'analise');
  assert.equal(an.titulo, 'Em análise');
  assert.match(an.texto, /carteira com final 0001\) foi informada em 10\/11\/2026 e a equipe do IMED está conferindo\. Enquanto isso, o pagamento continua direto na clínica\./);
  const lig = e({});
  assert.equal(lig.codigo, 'ligado');
  assert.equal(lig.titulo, 'Ligado');
  // conta ativa, mas alguma trava fechada: desligado
  for (const o of [{ recebendo: false, payment_mode: 'no_local' }, { recebendo: false, vendas_online_ligadas: false }, { recebendo: true, vendas_online_ligadas: false }, { recebendo: true, payment_mode: 'no_local' }]) {
    const d = e(o);
    assert.equal(d.codigo, 'desligado', JSON.stringify(o));
    assert.match(d.texto, /os pacientes pagam direto na clínica\. Veja abaixo o que falta\./);
  }
  const sus = e({ situacao: 'suspensa', recebendo: false, payment_mode: 'no_local' });
  assert.equal(sus.codigo, 'desligado');
  assert.match(sus.texto, /A equipe do IMED suspendeu o recebimento on-line desta clínica\./);
  // cada estado tem título, texto, ícone do recorte e um tom
  for (const x of [e(null), an, lig, sus]) assert.ok(x.titulo && x.texto && /^fa-[a-z-]+$/.test(x.icone) && ['ok', 'aviso', 'erro', 'neutro'].includes(x.tom));
});

test('"o que falta para ligar": 4 passos na ordem, cada um pelo que o banco respondeu', () => {
  const p = (o) => F.passos(F.normalizeStatus(STATUS(o)));
  assert.deepEqual(F.passos(null), []);
  assert.deepEqual(p({ situacao: 'nao_ligada' }), [], 'sem conta: nenhuma lista (só a mensagem)');
  const tudo = p({});
  assert.deepEqual(tudo.map((x) => [x.id, x.feito]), [['conta', true], ['conferida', true], ['unidade', true], ['geral', true]]);
  assert.equal(F.faltam(tudo), 0);
  assert.equal(tudo[0].detalhe, 'carteira com final 0001 · termos aceitos em 10/11/2026');
  assert.equal(tudo[1].detalhe, 'conferida em 10/11/2026');
  const an = p({ situacao: 'em_conferencia', recebendo: false, payment_mode: 'no_local', vendas_online_ligadas: false, conferida_em: null });
  assert.deepEqual(an.map((x) => x.feito), [true, false, false, false]);
  assert.equal(F.faltam(an), 3);
  assert.equal(an[1].detalhe, 'A equipe do IMED está conferindo.');
  assert.match(an[2].detalhe, /Hoje a unidade está em “pagamento no local”\./);
  assert.match(an[3].detalhe, /O IMED ainda não abriu o pagamento pelo site \(vale para todas as clínicas\)\./);
  const pausada = p({ recebendo: false, payment_mode: 'no_local' });
  assert.deepEqual(pausada.map((x) => x.feito), [true, true, false, true]);
  const sus = p({ situacao: 'suspensa', recebendo: false, payment_mode: 'no_local' });
  assert.equal(sus[1].feito, false);
  assert.match(sus[1].detalhe, /suspenso pela equipe do IMED/);
  // conta que deixou de ser ativa nunca mostra a unidade como ligada (o banco também não deixa)
  assert.equal(p({ situacao: 'em_conferencia', payment_mode: 'online' })[2].feito, false);
});

test('taxa, meio e preço mínimo: só com o número do banco (sem regra no banco, a linha não aparece)', () => {
  assert.equal(F.taxaTexto({ tipo: 'percentual', bps: 1500, cents: null }), '15% do valor de cada exame pago pelo site');
  assert.equal(F.taxaTexto({ tipo: 'fixo', bps: null, cents: 500 }), 'R$ 5,00 por exame pago pelo site');
  assert.equal(F.taxaTexto(null), '');
  assert.equal(F.taxaTexto({ tipo: 'percentual', bps: null }), '');
  assert.deepEqual(F.condicoes(F.normalizeStatus(STATUS())), [['Taxa do IMED', '15% do valor de cada exame pago pelo site'], ['Como o paciente paga', 'Pix'],
    ['Preço mínimo', 'Exame abaixo de R$ 20,00 (ou sem preço informado) continua com pagamento no local.']]);
  assert.deepEqual(F.condicoes(F.normalizeStatus(STATUS({ taxa: null, meios: [], preco_minimo_cents: null }))), [], 'nada inventado quando o banco não informa');
  assert.deepEqual(F.condicoes(null), []);
  assert.equal(F.meioTexto('cartao'), 'Cartão');
  // nenhum número de taxa, tarifa ou preço escrito no código da aba (tudo vem do banco)
  for (const f of ['assets/js/financeiro-core.js', 'assets/js/financeiro.js']) {
    const js = read(f).replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(js, /\b1500\b|\b15\s*%|R\$\s*\d|\b2000\b|1[,.]99/, `${f}: sem taxa, tarifa ou preço fixo no código`);
  }
});

test('período do extrato: prontos (dias de São Paulo) e datas à mão dentro do limite do banco (92 dias de diferença)', () => {
  const hoje = '2026-11-13';
  assert.deepEqual(F.PERIODOS.map(([k]) => k), ['mes', 'mes_passado', '30', '90', 'datas']);
  assert.deepEqual(F.periodo('mes', hoje), { de: '2026-11-01', ate: '2026-11-13' });
  assert.deepEqual(F.periodo('mes_passado', hoje), { de: '2026-10-01', ate: '2026-10-31' });
  assert.deepEqual(F.periodo('mes_passado', '2027-01-05'), { de: '2026-12-01', ate: '2026-12-31' }, 'vira o ano');
  assert.deepEqual(F.periodo('mes_passado', '2028-03-31'), { de: '2028-02-01', ate: '2028-02-29' }, 'fevereiro de ano bissexto');
  assert.deepEqual(F.periodo('30', hoje), { de: '2026-10-15', ate: '2026-11-13' });
  assert.deepEqual(F.periodo('90', hoje), { de: '2026-08-16', ate: '2026-11-13' });
  assert.equal(F.periodo('datas', hoje), null);
  assert.equal(F.periodo('outro', hoje), null);
  // todo período pronto cabe no limite do banco
  const dif = (p) => (Date.parse(`${p.ate}T12:00:00Z`) - Date.parse(`${p.de}T12:00:00Z`)) / 86400000;
  for (const k of ['mes', 'mes_passado', '30', '90']) for (const h of ['2026-11-13', '2026-12-31', '2027-01-01', '2028-02-29']) assert.ok(dif(F.periodo(k, h)) <= F.MAX_DIAS, `${k} em ${h}`);
  assert.equal(F.MAX_DIAS, 92);
  assert.match(read(migracao('pagamentos_base_parte_4')), /if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 92 then return jsonb_build_object\('status', 'invalid'\); end if;/, 'o mesmo limite do banco');
  assert.deepEqual(F.validarPeriodo('2026-10-01', '2026-10-31'), { ok: true, errors: {}, de: '2026-10-01', ate: '2026-10-31' });
  assert.equal(F.validarPeriodo('2026-08-01', '2026-11-01').ok, true, '92 dias de diferença: pode');
  assert.match(F.validarPeriodo('2026-07-31', '2026-11-01').errors.ate, /até 93 dias de cada vez/);
  assert.equal(F.validarPeriodo('2026-11-02', '2026-11-01').errors.ate, 'O último dia não pode ser antes do primeiro.');
  assert.deepEqual(F.validarPeriodo('', '').errors, { de: 'Escolha o primeiro dia.', ate: 'Escolha o último dia.' });
  assert.equal(F.validarPeriodo('2026-13-01', '2026-11-01').ok, false);
});

test('extrato: uma linha por exame pago, situação pelo que voltou, totais como o banco somou e nenhum dado de paciente', () => {
  assert.equal(F.normalizeExtrato(null), null);
  assert.equal(F.normalizeExtrato({ status: 'ok', linhas: [] }), null, 'sem os totais do banco não há extrato');
  assert.deepEqual(F.normalizeExtrato({ status: 'forbidden' }), { tipo: 'forbidden' });
  assert.deepEqual(F.normalizeExtrato({ status: 'invalid' }), { tipo: 'invalid' });
  const d = F.normalizeExtrato(EXTRATO([LINHA(), LINHA({ cobranca: 'b2c3d4e5', exam_code: 'usg', situacao: 'devolvida', preco_cents: 20000, taxa_cents: 3000, clinica_cents: 17000, devolvido_cents: 20000 }),
    LINHA({ cobranca: 'c3d4e5f6', situacao: 'devolvida_parcial', devolvido_cents: 5000 }), LINHA({ cobranca: 'd4e5f6a7', situacao: 'contestada' }),
    { ...LINHA({ cobranca: 'XYZ', exam_code: null, starts_at: 'ontem' }), patient_name: 'Fulana', patient_phone: '11999990000', request_id: 'abc' }],
  { valor_cents: 73292, taxa_cents: 10992, clinica_cents: 62300, devolvido_cents: 25000, taxa_devolvida_cents: 3750, clinica_devolvida_cents: 21250, cobrancas: 5 }));
  assert.equal(d.tipo, 'ok');
  assert.deepEqual(d.linhas.map((l) => F.situacaoLinha(l).texto), ['Pago', 'Devolvido', 'Devolvido em parte', 'Contestado', 'Pago']);
  assert.deepEqual(d.linhas.map((l) => F.exameTexto(l)), [A.examLabel('rm'), A.examLabel('usg'), A.examLabel('rm'), A.examLabel('rm'), 'Exame']);
  // campo que a função não manda (e não deve mandar) nunca passa adiante
  assert.deepEqual(Object.keys(d.linhas[4]).sort(), ['clinica_cents', 'cobranca', 'devolvido_cents', 'dia', 'exam_code', 'meio', 'preco_cents', 'previsao', 'situacao', 'starts_at', 'taxa_cents']);
  assert.deepEqual([d.linhas[4].cobranca, d.linhas[4].exam_code, d.linhas[4].starts_at], ['', '', '']);
  const t = F.totaisItens(d.totais);
  assert.deepEqual(t.map((x) => [x.id, x.value]), [['pago', 'R$ 732,92'], ['clinica', 'R$ 623,00'], ['taxa', 'R$ 109,92'], ['devolvido', 'R$ 250,00']]);
  assert.equal(t[0].sub, '5 pagamentos pelo site');
  assert.equal(t[1].sub, 'R$ 212,50 voltaram para os pacientes');
  assert.equal(t[2].sub, 'R$ 37,50 voltaram para os pacientes');
  // um pagamento só, sem devolução; número que o banco não mandou: traço
  const um = F.normalizeExtrato(EXTRATO());
  assert.equal(F.totaisItens(um.totais)[0].sub, '1 pagamento pelo site');
  assert.equal(F.totaisItens(um.totais)[1].sub, 'vai para a conta da clínica no meio de pagamento');
  assert.equal(F.totaisItens(F.normalizeExtrato(EXTRATO([], { valor_cents: null, cobrancas: null })).totais)[0].value, '—');
  assert.equal(F.resumoExtrato(um), '1 exame pago pelo site de 01/11/2026 a 13/11/2026: R$ 133,23 pagos pelos pacientes, R$ 113,25 para a clínica.');
  assert.equal(F.resumoExtrato(F.normalizeExtrato(EXTRATO([], { valor_cents: 0, taxa_cents: 0, clinica_cents: 0, cobrancas: 0 }))), 'Nenhum pagamento pelo site de 01/11/2026 a 13/11/2026.');
  // a soma da tela é a do banco: nada é somado aqui
  const js = read('assets/js/financeiro-core.js');
  assert.doesNotMatch(js.slice(js.indexOf('export function totaisItens')), /reduce\(|\+=/, 'totaisItens não soma nada');
});

// A migração da P1 que tem as funções da clínica (o nome muda quando ela for aplicada: procura pelo sufixo).
function migracao(sufixo) {
  const f = readdirSync(join(ROOT, 'supabase/migrations')).find((x) => x.endsWith(`_${sufixo}.sql`));
  assert.ok(f, `migração *_${sufixo}.sql`);
  return `supabase/migrations/${f}`;
}

test('a tela (financeiro.js): só lê, só pelas duas funções da clínica, nada no aparelho, nada do meio de pagamento, ícones do recorte', () => {
  const js = read('assets/js/financeiro.js').replace(/^\s*\/\/.*$/gm, '');
  assert.deepEqual([...new Set([...js.matchAll(/auth\.rpc\('([a-z_]+)'/g)].map((m) => m[1]))].sort(), ['pag_clinic_statement', 'pag_clinic_status']);
  assert.ok(!/auth\.select\(|localStorage|sessionStorage|fetch\s*\(|indexedDB|document\.cookie/.test(js), 'nenhuma tabela direta, nada guardado no aparelho, nenhuma chamada própria');
  for (const f of ['assets/js/financeiro.js', 'assets/js/financeiro-core.js']) assert.doesNotMatch(read(f), /asaas|wallet|pag_clinic_(connect|pause|refund)/i, `${f}: não liga, não pausa, não devolve e não fala do meio de pagamento pelo nome`);
  // a aba é baixada só quando alguém a abre
  const painel = read('assets/js/painel.js');
  assert.match(painel, /import\('\.\/financeiro\.js'\)/);
  assert.doesNotMatch(painel, /^import .* from '\.\/financeiro(-core)?\.js';$/m, 'painel.js não importa o financeiro de saída');
  assert.match(painel, /financeiro: tabFinanceiro/);
  // ícones: todos no recorte
  const css = read('assets/vendor/fa/css/icones.min.css');
  const usados = new Set();
  for (const f of ['assets/js/financeiro.js', 'assets/js/financeiro-core.js']) for (const m of read(f).matchAll(/(?<![\w-])fa-[a-z0-9]+(?:-[a-z0-9]+)*/g)) usados.add(m[0]);
  assert.ok(usados.size >= 6);
  for (const n of usados) if (n !== 'fa-solid') assert.ok(new RegExp(`\\.${n}:before[,{]`).test(css), `${n} fora do recorte de ícones`);
  // o estilo da aba usa só as cores do tema (claro e escuro sem regra a mais) e nenhum fundo branco fixo
  const fi = read('assets/css/clinica.css').split('/* ---------- aba Financeiro')[1].split('/* ---------- Tema escuro')[0];
  assert.ok(fi.length > 1500);
  const cores = (fi.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((c) => !['#146B3D'].includes(c));
  assert.deepEqual(cores, [], 'cor fixa só como reserva dos tokens --conta-*');
});

test('o banco (P1): as duas funções da aba conferem a permissão, registram a leitura e não devolvem dado de paciente', () => {
  const sql = read(migracao('pagamentos_base_parte_4'));
  const corpo = (fn) => sql.slice(sql.indexOf(`create or replace function public.${fn}(`)).split('\nend $$;')[0];
  for (const fn of ['pag_clinic_status', 'pag_clinic_statement']) {
    const c = corpo(fn);
    assert.match(c, /security definer\nset search_path = ''/, `${fn}: search_path vazio`);
    assert.match(c, /private\.agenda_scope\(p_clinic, 'financeiro\.ver', 'imed\.financeiro\.ver'\)/, `${fn}: financeiro.ver (ou a equipe do IMED)`);
    assert.match(c, /if p_clinic is null or v_scope is null or v_scope not in \('clinica', 'central'\) then\n\s+return jsonb_build_object\('status', 'forbidden'\);/, `${fn}: sem permissão, nada`);
    assert.doesNotMatch(c, /patient_|\bphone\b|\bemail\b|\bnotes\b|'request_id'|payer|cpf/i, `${fn}: nada do paciente nem do pagador`);
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([a-z, ]*\\) from public, anon, authenticated;`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([a-z, ]*\\) to authenticated;`));
  }
  assert.match(corpo('pag_clinic_statement'), /perform private\.agenda_log_access\('pag_clinic_statement', p_clinic, null, 'extrato'\);/, 'a leitura do extrato fica registrada');
  assert.match(corpo('pag_clinic_status'), /'carteira_final', right\(a\.wallet_id, 4\)/, 'da carteira, só o final');
  // o que a tela lê do extrato é o que a função manda
  const linhaSql = corpo('pag_clinic_statement').split('select coalesce(jsonb_agg(jsonb_build_object(')[1].split('into v_linhas')[0];
  const campos = [...linhaSql.matchAll(/'([a-z_]+)', /g)].map((m) => m[1]);
  assert.deepEqual(campos.sort(), ['clinica_cents', 'cobranca', 'devolvido_cents', 'dia', 'exam_code', 'meio', 'preco_cents', 'previsao', 'situacao', 'starts_at', 'taxa_cents']);
  // papel Financeiro: financeiro.ver e mais nada (espelho conferido com o banco em agenda-core.test.mjs)
  assert.deepEqual(A.permsOf('finance'), { 'financeiro.ver': 'clinica' });
});
