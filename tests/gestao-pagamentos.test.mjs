// Regras puras da parte "Pagamentos on-line" do painel de gestão (iMed Pagamentos, fase P2b).
// Rodar: node --test tests/gestao-pagamentos.test.mjs
// Todos os valores e nomes daqui são SIMULADOS (não são movimento, taxa nem clínica de verdade).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as P from '../assets/js/gestao-pag-core.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
// Os valores em reais saem com o espaço que não quebra a linha (como no resto do painel); aqui, espaço comum.
const n = (v) => (typeof v === 'string' ? v.replace(/\u00a0/g, ' ') : v);
function migracao(sufixo) {
  const f = readdirSync(join(ROOT, 'supabase/migrations')).find((x) => x.endsWith(`_${sufixo}.sql`));
  assert.ok(f, `migração *_${sufixo}.sql`);
  return `supabase/migrations/${f}`;
}

// Como o banco responde (formato das funções admin_pag_* da migração pagamentos_base_parte_4).
const RESUMO = (o = {}) => ({
  status: 'ok', de: '2026-10-15', ate: '2026-11-13', fonte: 'cobrado_pelo_site', vendas_online_ligadas: true,
  extrato: { recebido: 46646, taxa_imed: 6994, repasse_clinica: 39652, tarifa_meio: 597, devolucao: -13323, devolucao_taxa: -1998, devolucao_repasse: -11325 },
  cobrancas: { aprovada: 2, devolvida: 1, expirada: 1, aguardando: 1 }, contas: { ativa: 1, em_conferencia: 1 },
  atencao: { diferencas_criticas: 1, diferencas_abertas: 2, devolucoes_na_fila: 0, devolucoes_com_falha: 0, avisos_pendentes: 1, contestacoes_abertas: 0, ultima_conciliacao: '2026-11-12' }, ...o,
});
const COB = (o = {}) => ({ id: 'a1b2c3d4-0000-4000-8000-000000000001', criado_em: '2026-11-12T12:30:00+00:00', clinic_id: 'cccccccc-0000-4000-8000-000000000001', clinic_name: 'Clínica Simulada A',
  finalidade: 'agendamento', meio: 'pix', situacao: 'aprovada', valor_cents: 13323, taxa_cents: 1998, clinica_cents: 11325, tarifa_meio_cents: 199, devolvido_cents: 0,
  paga_em: '2026-11-12T12:31:10+00:00', tentativa: 1, request_id: 'eeeeeeee-0000-4000-8000-000000000001', fee_bps: 1500, ...o });

test('período da página em dias de São Paulo: termina hoje e cabe no limite do banco (366 dias)', () => {
  assert.deepEqual(P.periodoDias(30, '2026-11-13'), { de: '2026-10-15', ate: '2026-11-13' });
  assert.deepEqual(P.periodoDias(7, '2026-11-13'), { de: '2026-11-07', ate: '2026-11-13' });
  assert.deepEqual(P.periodoDias(365, '2026-11-13'), { de: '2025-11-14', ate: '2026-11-13' });
  assert.deepEqual(P.periodoDias(1, '2026-01-01'), { de: '2026-01-01', ate: '2026-01-01' });
  assert.deepEqual(P.periodoDias(9999, '2026-11-13'), P.periodoDias(366, '2026-11-13'), 'nunca mais que o banco aceita');
  assert.deepEqual(P.periodoDias('x', '2026-11-13'), P.periodoDias(30, '2026-11-13'));
  assert.match(read(migracao('pagamentos_base_parte_4')), /p_ate - p_de > 366 then return jsonb_build_object\('status', 'invalid'\)/);
});

test('resumo: só o que o banco mandou; tipo sem linha no extrato é zero, número torto é traço, resposta estranha não vira tela', () => {
  assert.equal(P.normalizeResumo(null), null);
  assert.equal(P.normalizeResumo({ status: 'ok' }), null);
  assert.equal(P.normalizeResumo({ ...RESUMO(), vendas_online_ligadas: 'sim' }), null, 'a chave geral precisa vir como verdadeiro ou falso');
  assert.deepEqual(P.normalizeResumo({ status: 'forbidden' }), { tipo: 'forbidden' });
  const d = P.normalizeResumo(RESUMO());
  assert.equal(d.ligada, true);
  assert.equal(d.extrato.mensalidade, 0);
  assert.equal(d.extrato.devolucao, -13323);
  assert.equal(d.cobrancas.recusada, 0);
  assert.deepEqual(d.contas, { ativa: 1, em_conferencia: 1, suspensa: 0, nao_ligada: 0 });
  const k = P.resumoKpis(d);
  assert.deepEqual(k.map((x) => [x.id, n(x.value)]), [['pg-recebido', 'R$ 466,46'], ['pg-taxa', 'R$ 69,94'], ['pg-repasse', 'R$ 396,52'], ['pg-tarifa', 'R$ 5,97'], ['pg-devolvido', 'R$ 133,23'], ['pg-cobrancas', '5']]);
  assert.equal(k[5].sub, '2 pagas · 1 aguardando');
  assert.equal(P.resumoKpis(P.normalizeResumo(RESUMO({ extrato: { recebido: 'muito' }, cobrancas: { aprovada: 1.5 } })))[0].value, '—');
  assert.equal(P.resumoKpis(P.normalizeResumo(RESUMO({ extrato: { recebido: 'muito' }, cobrancas: { aprovada: 1.5 } })))[5].value, '—');
  // tudo zerado (o dia em que o pagamento for aplicado e ninguém pagou ainda)
  const zero = P.normalizeResumo(RESUMO({ vendas_online_ligadas: false, extrato: {}, cobrancas: {}, contas: {},
    atencao: { diferencas_criticas: 0, diferencas_abertas: 0, devolucoes_na_fila: 0, devolucoes_com_falha: 0, avisos_pendentes: 0, contestacoes_abertas: 0, ultima_conciliacao: null } }));
  assert.deepEqual(P.resumoKpis(zero).map((x) => n(x.value)), ['R$ 0,00', 'R$ 0,00', 'R$ 0,00', 'R$ 0,00', 'R$ 0,00', '0']);
  assert.deepEqual(P.atencaoItens(zero), []);
  assert.equal(P.temCritica(zero), false);
  assert.equal(P.contasTexto(zero), 'Nenhuma clínica informou a conta no meio de pagamento ainda.');
  assert.match(P.chaveTexto(false), /^Nenhuma cobrança nova nasce, em nenhuma clínica\./);
  assert.match(P.chaveTexto(true), /^O pagamento pelo site está aberto/);
  // precisa de atenção: só o que passa de zero, o mais grave primeiro
  assert.deepEqual(P.atencaoItens(d).map((x) => [x.id, x.tom, x.texto]), [['diferencas_criticas', 'err', '1 diferença crítica aberta na conciliação'], ['avisos_pendentes', 'warn', '1 aviso do meio de pagamento ainda não aplicado']]);
  assert.equal(P.temCritica(d), true);
  assert.equal(P.contasTexto(d), 'Clínicas: 1 com a conta ativa, 1 em conferência e 0 suspensas.');
  const semNumero = P.normalizeResumo(RESUMO({ atencao: { ultima_conciliacao: null } }));
  assert.equal(P.atencaoItens(semNumero).length, 5, 'número que o banco não mandou aparece (com traço), nunca some como se fosse zero');
  assert.equal(P.temCritica(semNumero), true);
});

test('cobranças: situação, valores e clínica; o id do agendamento nunca passa adiante', () => {
  assert.equal(P.normalizeLista(null), null);
  assert.equal(P.normalizeLista({ status: 'ok' }), null);
  assert.deepEqual(P.normalizeLista({ status: 'invalid' }), { tipo: 'invalid' });
  const d = P.normalizeLista({ status: 'ok', cobrancas: [COB(), COB({ id: 'b2c3d4e5-0000-4000-8000-000000000002', situacao: 'aguardando', paga_em: null, tarifa_meio_cents: null }), 'lixo', { sem: 'id' }] });
  assert.equal(d.linhas.length, 2);
  assert.deepEqual(Object.keys(d.linhas[0]).sort(), ['clinica', 'clinica_cents', 'codigo', 'criado_em', 'devolvido_cents', 'finalidade', 'meio', 'paga_em', 'situacao', 'tarifa_meio_cents', 'taxa_cents', 'tentativa', 'valor_cents']);
  assert.equal(d.linhas[0].codigo, 'a1b2c3d4');
  assert.equal(d.linhas[1].tarifa_meio_cents, null, 'tarifa que o meio de pagamento ainda não informou: sem número');
  assert.doesNotMatch(JSON.stringify(d), /request_id|eeeeeeee|clinic_id|fee_bps/);
  // nomes das situações: todas as do banco, e código novo aparece como código (nunca some)
  const sql = read(migracao('pagamentos_base_parte_1'));
  const doBanco = sql.match(/charges_situacao_ck check \(situacao in \(([^)]+)\)/s)[1].match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1));
  assert.deepEqual(Object.keys(P.PG_SITUACAO).sort(), doBanco.sort());
  assert.equal(P.situacaoTexto('aprovada'), 'Paga');
  assert.equal(P.situacaoTexto('nova_situacao'), 'Código: nova_situacao');
  assert.equal(P.situacaoTom('contestada'), 'err');
  assert.deepEqual(P.PG_FILTRO[0], ['', 'Todas']);
  assert.equal(P.PG_FILTRO.length, 11);
  assert.equal(P.meioTexto('pix'), 'Pix');
  assert.equal(P.finalidadeTexto('agendamento'), 'Exame agendado');
  assert.ok(P.PG_LIMITE <= 500, 'a função aceita até 500');
});

test('conciliação: rodadas, diferenças com os dois lados em texto e a última conferência', () => {
  assert.equal(P.normalizeConciliacao(null), null);
  assert.deepEqual(P.normalizeConciliacao({ status: 'forbidden' }), { tipo: 'forbidden' });
  const raw = { status: 'ok', criticas_abertas: 1,
    rodadas: [{ id: 'r2', dia: '2026-11-12', janela: 'manual', comecou: '2026-11-12T15:00:00+00:00', terminou: '2026-11-12T15:00:00+00:00', situacao: 'concluida', contadores: {} },
      { id: 'r1', dia: '2026-11-12', janela: 'd1', comecou: '2026-11-13T07:17:00+00:00', terminou: '2026-11-13T07:17:02+00:00', situacao: 'concluida', contadores: { linhas: 4, pagas_aqui: 3, achadas: 2, novas: 2, criticas: 1, por_tipo: { valor: 1, tarifa: 1 } } }],
    diferencas: [{ id: 7, tipo: 'falta_aqui', gravidade: 'critica', critica: true, criado_em: '2026-11-13T07:17:01+00:00', charge_id: null, provedor_cobranca_id: 'pay_simulado_0001', nosso: null,
      deles: { situacao: 'paga', valor_cents: 20000 }, resolvida_em: null, resolucao: null, dia: '2026-11-12' },
    { id: 8, tipo: 'tarifa', gravidade: 'informativa', critica: false, criado_em: '2026-11-13T07:17:01+00:00', charge_id: 'a1b2c3d4-0000-4000-8000-000000000001', provedor_cobranca_id: 'pay_simulado_0002',
      nosso: { tarifa_cents: 199 }, deles: { tarifa_cents: 99 }, resolvida_em: '2026-11-13T12:00:00+00:00', resolucao: 'tarifa_promocional', dia: '2026-11-12' }] };
  const d = P.normalizeConciliacao(raw);
  assert.equal(d.criticas, 1);
  assert.equal(P.ultimaRodada(d).janela, 'd1', 'a rodada "manual" não é uma conferência do dia');
  assert.equal(P.ultimaRodadaTexto(d), 'Última conferência: o dia 12/11/2026 (do dia anterior), concluída. 4 cobranças comparadas; 2 diferenças achadas.');
  assert.match(P.ultimaRodadaTexto(P.normalizeConciliacao({ status: 'ok', criticas_abertas: 0, rodadas: [], diferencas: [] })), /^Nenhuma conferência feita ainda\./);
  assert.match(P.ultimaRodadaTexto(P.normalizeConciliacao({ ...raw, rodadas: [{ dia: '2026-11-12', janela: 'd1', situacao: 'falhou', contadores: {} }] })), /\(do dia anterior\), falhou\.$/);
  assert.equal(d.diferencas[0].cobranca, '');
  assert.equal(d.diferencas[1].cobranca, 'a1b2c3d4');
  assert.equal(P.ladoTexto(d.diferencas[0].nosso), '—');
  assert.equal(n(P.ladoTexto(d.diferencas[0].deles, true)), 'paga · valor R$ 200,00');
  assert.equal(n(P.ladoTexto({ situacao: 'aprovada', valor_cents: 13323 })), 'paga · valor R$ 133,23');
  assert.equal(n(P.ladoTexto({ clinica_cents: 11325 })), 'parte da clínica R$ 113,25');
  assert.equal(n(P.ladoTexto({ repasse_cents: 11000 }, true)), 'parte da clínica R$ 110,00');
  assert.equal(n(P.ladoTexto({ situacao: 'devolvida_parcial', devolvido_cents: 5000 }, true)), 'devolvida em parte · devolvido R$ 50,00');
  assert.equal(P.ladoTexto({ nome: 'Fulana', cpf: '000' }), '—', 'chave fora da lista nunca aparece');
  // todos os tipos e gravidades do banco têm nome
  const sql = read(migracao('pagamentos_base_parte_1'));
  const lista = (re) => sql.match(re)[1].match(/'([a-z0-9_]+)'/g).map((x) => x.slice(1, -1)).sort();
  assert.deepEqual(Object.keys(P.PG_DIFF).sort(), lista(/reconciliation_diffs_tipo_ck check \(tipo in \(([^)]+)\)/));
  assert.deepEqual(Object.keys(P.PG_GRAVIDADE).sort(), lista(/reconciliation_diffs_gravidade_ck check \(gravidade in \(([^)]+)\)/));
  assert.deepEqual(Object.keys(P.PG_JANELA).sort(), lista(/reconciliation_runs_janela_ck check \(janela in \(([^)]+)\)/));
  assert.equal(P.diffTexto('outro'), 'Código: outro');
  assert.equal(P.gravidadeTom('critica'), 'err');
  assert.equal(P.rodadaTexto('rodando'), 'Em andamento');
});

test('chave geral: confirmação com motivo em código (o formato que o banco aceita) e, para ligar, o "entendi"', () => {
  for (const [k] of [...P.MOTIVOS_LIGAR, ...P.MOTIVOS_DESLIGAR]) {
    assert.match(k, /^[a-z][a-z0-9_]{2,59}$/, k);
    assert.doesNotMatch(k, /[0-9]{4,}/, k);
  }
  assert.match(read(migracao('pagamentos_base_parte_4')), /select p_motivo is not null and p_motivo ~ '\^\[a-z\]\[a-z0-9_\]\{2,59\}\$' and p_motivo !~ '\[0-9\]\{4,\}';/, 'a mesma regra do banco');
  assert.deepEqual(P.validarChave({ ligar: false, motivo: 'incidente' }), { ok: true, errors: {}, payload: { p_ligar: false, p_motivo: 'incidente' } });
  assert.deepEqual(P.validarChave({ ligar: false, motivo: '' }).errors, { motivo: 'Escolha o motivo.' });
  assert.deepEqual(P.validarChave({ ligar: false, motivo: 'abertura_do_piloto' }).errors, { motivo: 'Escolha o motivo.' }, 'motivo de ligar não serve para desligar');
  assert.deepEqual(P.validarChave({ ligar: true, motivo: 'abertura_do_piloto', ciente: false }).errors, { ciente: 'Marque a caixa para confirmar que entendeu.' });
  assert.deepEqual(P.validarChave({ ligar: true, motivo: 'abertura_do_piloto', ciente: true }).payload, { p_ligar: true, p_motivo: 'abertura_do_piloto' });
  assert.equal(P.validarChave({ motivo: 'incidente' }).ok, false, 'sem dizer se liga ou desliga, não vai');
  assert.equal(P.validarChave().ok, false);
  assert.equal(P.pgStatus('forbidden'), 'Só o administrador do IMED liga ou desliga o pagamento pelo site.');
  assert.equal(P.pgStatus('novo'), 'Não foi possível concluir agora. Tente de novo em instantes.');
  assert.match(P.AVISO_SEM_BANCO, /ainda não estão ligados no banco/);
});

test('a tela (gestao-pagamentos.js): só as funções admin_pag_* (que conferem a equipe no banco), uma ação só, nada no aparelho, nenhum dado de paciente', () => {
  const js = read('assets/js/gestao-pagamentos.js').replace(/^\s*\/\/.*$/gm, '');
  const fns = [...new Set([...js.matchAll(/auth\.rpc\('([a-z_]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(fns, ['admin_pag_chave_geral', 'admin_pag_conciliacao', 'admin_pag_lista', 'admin_pag_resumo']);
  assert.ok(!/auth\.select\(|localStorage|sessionStorage|fetch\s*\(|indexedDB|new\s+WebSocket/.test(js), 'nenhuma tabela direta, nada guardado no aparelho, nenhuma chamada própria');
  for (const f of ['assets/js/gestao-pagamentos.js', 'assets/js/gestao-pag-core.js']) assert.doesNotMatch(read(f), /asaas|wallet_id|request_id(?!, que)|patient|cpf/i, `${f}: sem o nome do meio de pagamento e sem dado de paciente ou de pagador`);
  // cada função existe na migração, só para quem está logado, e confere a permissão da equipe antes de qualquer coisa
  const sql = read(migracao('pagamentos_base_parte_4'));
  const corpo = (fn) => sql.slice(sql.indexOf(`create or replace function public.${fn}(`)).split('\nend $$;')[0];
  for (const fn of fns) {
    const c = corpo(fn);
    assert.match(c, /security definer\nset search_path = ''/, `${fn}: search_path vazio`);
    assert.match(c, new RegExp(`begin\\n  if not public\\.imed_has\\('imed\\.financeiro\\.${fn === 'admin_pag_chave_geral' ? 'operar' : 'ver'}'\\) then return jsonb_build_object\\('status', 'forbidden'\\); end if;`), `${fn}: confere a equipe antes de qualquer coisa`);
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([a-z, ]*\\) from public, anon, authenticated;`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([a-z, ]*\\) to authenticated;`));
    assert.doesNotMatch(c, /patient_|\bphone\b|\bemail\b|payer|cpf/i, `${fn}: nada do paciente nem do pagador`);
  }
  // a chave geral: sempre com o quadro de confirmação (a chamada só existe dentro de confirmarChave, depois de validarChave)
  const conf = js.slice(js.indexOf('async function confirmarChave'), js.indexOf('async function aoClicar'));
  assert.equal(js.split("auth.rpc('admin_pag_chave_geral'").length, 2, 'uma chamada só');
  assert.ok(conf.indexOf('P.validarChave(q)') > 0 && conf.indexOf('P.validarChave(q)') < conf.indexOf("auth.rpc('admin_pag_chave_geral'"), 'valida antes de chamar');
  assert.match(js, /if \(t\.id === 'pgChaveOk'\) confirmarChave\(\);/);
  // o painel liga a parte nova no trilho e segue o período da página
  const g = read('assets/js/gestao.js');
  assert.match(g, /\['sec-pagamentos', 'Pagamentos on-line'\]/);
  assert.match(g, /'sec-pagamentos': 'fa-landmark'/);
  assert.match(g, /startPagamentos\(\{ lost, forbidden: notAdmin, chave: notaCobranca \}, S\.days\);/);
  assert.match(g, /stopPagamentos\(\);/);
  // ícones do recorte; arquivos pequenos
  const css = read('assets/vendor/fa/css/icones.min.css');
  const usados = new Set();
  for (const f of ['assets/js/gestao-pagamentos.js', 'assets/js/gestao-pag-core.js']) for (const m of read(f).matchAll(/(?<![\w-])fa-[a-z0-9]+(?:-[a-z0-9]+)*/g)) usados.add(m[0]);
  assert.ok(usados.size >= 8);
  for (const n of usados) if (n !== 'fa-solid') assert.ok(new RegExp(`\\.${n}:before[,{]`).test(css), `${n} fora do recorte de ícones`);
  for (const f of ['assets/js/gestao-pagamentos.js', 'assets/js/gestao-pag-core.js', 'assets/js/financeiro.js', 'assets/js/financeiro-core.js']) {
    const st = statSync(join(ROOT, f));
    assert.ok(st.size > 1000 && st.size < 40000, `${f}: ${st.size} bytes`);
  }
});

test('a frase de "Faturamento e cobrança" muda com a chave geral (arquitetura do pagamento, §9), e só com ela', () => {
  const g = read('assets/js/gestao.js');
  assert.match(g, /const COB_SEM_SITE = 'O IMED ainda não recebe pagamentos pelo site; aqui a equipe registra as cobranças feitas por fora \(Pix, cartão, boleto\)\.';/);
  assert.match(g, /const COB_COM_SITE = 'Aqui ficam as cobranças feitas por fora \(Pix, cartão, boleto\), registradas pela equipe\. O que foi pago pelo site está em “Pagamentos on-line”, logo abaixo\.';/);
  assert.match(g, /function notaCobranca\(ligada\) \{ setText\(\$\('#cobHonesto'\), ligada === true \? COB_COM_SITE : COB_SEM_SITE\); \}/);
});
