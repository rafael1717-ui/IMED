// iMed Pagamentos, fase P2b — as TELAS novas contra o banco de verdade: o que as funções pag_clinic_* e admin_pag_*
// respondem (P1) passa pelas regras que as telas usam (assets/js/financeiro-core.js, a aba Financeiro da clínica, e
// assets/js/gestao-pag-core.js, a parte "Pagamentos on-line" da gestão) e sai com o que a pessoa vai ler. Os testes de
// ponta a ponta das telas (tests/e2e-financeiro.mjs e e2e-gestao-pagamentos.mjs) usam um banco de mentira; este prova
// que o contrato entre a tela e o banco de verdade é o mesmo. Roda no GitHub (banco.yml):
//   node tests/banco/pagamento-telas.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
//   1. Tudo desligado (o banco de hoje, depois das migrações): a clínica vê "ainda não disponível"; a gestão, zeros.
//   2. Do "em análise" ao "ligado": cada passo do que falta, com o que o banco responde.
//   3. Extrato da clínica: o papel Financeiro lê exames, valores e situações, NUNCA o paciente; os totais são os do
//      banco; a leitura fica registrada; a recepção não lê.
//   4. Gestão: resumo, lista e conciliação (com uma diferença crítica plantada), sem dado de paciente.
//   5. Chave geral: todo motivo que a tela oferece é aceito pelo banco; quem não é da equipe não liga nem lê.
// Os valores são de exemplo (não são preço de clínica nenhuma). Os dados são apagados no fim.

import { randomUUID } from 'node:crypto';
import {
  afirmar, anotar, comoUsuario, configLocal, conectar, criarClinicaAgenda, descreverErro, horaSP, limparClinicaAgenda, principal, resumir,
} from './lib.mjs';
import { clienteDoProvedor, comoServidor, criarPagamento, ligarRecebimento, limparPagamento, receberAviso, rotina, subirAsaasFalso } from './asaas-falso.mjs';
import * as F from '../../assets/js/financeiro-core.js';
import * as P from '../../assets/js/gestao-pag-core.js';

const CLINICA = 'cc000000-0000-4000-8000-000000005b03';
const DONA = { sub: 'a5000000-0000-4000-8000-000000005b03', email: 'dona.pagtelas@exemplo.test' };
const ADMIN = { sub: 'a5000000-0000-4000-8000-000000005b93', email: 'admin.pagtelas@exemplo.test' };
const FINANCEIRO = { sub: 'a5000000-0000-4000-8000-000000005b23', email: 'financeiro.pagtelas@exemplo.test' };
const RECEPCAO = { sub: 'a5000000-0000-4000-8000-000000005b13', email: 'recepcao.pagtelas@exemplo.test' };
const DIA = 21;
const n = (v) => (typeof v === 'string' ? v.replace(/ /g, ' ') : v);

await principal('pagamento-telas', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-pag-telas');
  const notas = [];
  let falso = null;
  const extras = [FINANCEIRO.sub, RECEPCAO.sub];
  const apagarExtras = () => db.query('delete from auth.users where id = any($1::uuid[])', [extras]);
  try {
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN });
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA.sub });
    await apagarExtras();
    const { procedimentos: PR } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA.sub, email: DONA.email, nome: 'Clínica das Telas do Pagamento do CI',
      recursos: [{ chave: 'sala', name: 'Sala grande', kind: 'sala', capacity: 20 }],
      // preços de exemplo, só para a conta
      procedimentos: [{ chave: 'rm', name: 'Exame A', duration_min: 5, price_cents: 13323, exam_code: 'rm', grupos: [['sala']] },
        { chave: 'usg', name: 'Exame B', duration_min: 5, price_cents: 20000, exam_code: 'usg', grupos: [['sala']] }],
    });
    for (const [o, papel] of [[FINANCEIRO, 'finance'], [RECEPCAO, 'reception'], [ADMIN, null]]) {
      await db.query(`insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
                      values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
                              '{"provider": "email", "providers": ["email"]}', '{}', now(), now()) on conflict (id) do nothing`, [o.sub, o.email]);
      if (papel) await db.query('insert into public.clinic_members (clinic_id, user_id, role) values ($1, $2, $3)', [CLINICA, o.sub, papel]);
    }
    await db.query('insert into public.admin_emails (email) values ($1) on conflict do nothing', [ADMIN.email]);
    const hoje = F.hojeSP();
    const status = async (quem) => F.normalizeStatus(await comoUsuario(db, quem, 'select public.pag_clinic_status($1)', [CLINICA]));
    const extrato = async (quem, de = hoje, ate = hoje) => comoUsuario(db, quem, 'select public.pag_clinic_statement($1, $2, $3)', [CLINICA, de, ate]);
    const per = P.periodoDias(30, hoje);
    const admin = (sql, params) => comoUsuario(db, ADMIN, sql, params);
    // o paciente sem conta (visitante), com o código do pedido
    const visitante = async (sql, params) => {
      await db.query('begin');
      try {
        await db.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('role', 'anon', true)`);
        const { rows } = await db.query(sql, params);
        await db.query('commit');
        return Object.values(rows[0])[0];
      } catch (e) { await db.query('rollback').catch(() => {}); throw e; }
    };

    /* ---------- 1. Tudo desligado ---------- */
    {
      const st = await status(FINANCEIRO);
      const e = F.estadoRecebimento(st);
      const rec = await status(RECEPCAO);
      const res = P.normalizeResumo(await admin('select public.admin_pag_resumo($1, $2)', [per.de, per.ate]));
      const lista = P.normalizeLista(await admin('select public.admin_pag_lista($1, $2, null, null, $3)', [per.de, per.ate, P.PG_LIMITE]));
      afirmar(st?.tipo === 'ok' && e.codigo === 'indisponivel' && F.passos(st).length === 0 && rec?.tipo === 'forbidden',
        'tudo desligado: o papel Financeiro lê a situação e a tela diz "Recebimento on-line ainda não disponível"; a recepção não lê (forbidden)',
        JSON.stringify({ situacao: st, estado: e.codigo, recepcao: rec }));
      afirmar(res?.tipo === 'ok' && res.ligada === false && P.resumoKpis(res).every((k) => k.value !== '—') && Object.values(res.atencao).every((v) => v !== null)
        && lista?.tipo === 'ok' && lista.linhas.every((l) => l.clinica !== 'Clínica das Telas do Pagamento do CI'),
      'gestão com tudo desligado: a chave geral aparece desligada e os números do período e do "precisa de atenção" vêm como número (zero é zero, não traço)',
      JSON.stringify({ resumo: res, kpis: P.resumoKpis(res).map((k) => `${k.id}=${n(k.value)}`) }));
    }

    /* ---------- 2. Do "em análise" ao "ligado" ---------- */
    {
      const ok = (j, o) => { if (j?.status !== 'ok') throw new Error(`${o}: ${JSON.stringify(j)}`); return j; };
      const feitos = async () => F.passos(await status(FINANCEIRO)).map((p) => (p.feito ? 1 : 0)).join('');
      ok(await comoUsuario(db, DONA, 'select public.pag_clinic_connect($1, $2, $3)', [CLINICA, 'wal_teste_telas_0001', 'v1']), 'informar a carteira');
      const s1 = await status(FINANCEIRO);
      const a = [F.estadoRecebimento(s1).codigo, await feitos()];
      ok(await admin(`select public.admin_pag_conta_conferir($1, 'ativa', 'conta_de_teste_conferida')`, [CLINICA]), 'conferir');
      const b = [F.estadoRecebimento(await status(FINANCEIRO)).codigo, await feitos()];
      ok(await comoUsuario(db, DONA, 'select public.pag_clinic_pause($1, false)', [CLINICA]), 'modo online');
      const c = [F.estadoRecebimento(await status(FINANCEIRO)).codigo, await feitos()];
      ok(await admin(`select public.admin_pag_chave_geral(true, 'teste_da_equipe')`), 'chave geral');
      const s4 = await status(FINANCEIRO);
      const d = [F.estadoRecebimento(s4).codigo, await feitos()];
      afirmar(a.join() === 'analise,1000' && b.join() === 'desligado,1100' && c.join() === 'desligado,1110' && d.join() === 'ligado,1111'
        && s1.carteira_final === '0001' && s1.aceito_em === hoje && s4.conferida_em === hoje && F.condicoes(s4).length >= 2 && !JSON.stringify(s4).includes('wal_teste_telas'),
      'do "em análise" ao "ligado": carteira informada (1 de 4), conta conferida, unidade no modo on-line, chave geral; a tela só mostra o final da carteira e as condições que o banco informou',
      JSON.stringify({ analise: a, conferida: b, unidade: c, ligado: d, condicoes: F.condicoes(s4) }));
      notas.push(`Estados: ${[a, b, c, d].map((x) => x.join(':')).join(' → ')}; condições: ${F.condicoes(s4).map(([k, v]) => `${k} = ${v}`).join(' | ')}`);
    }

    /* ---------- 3. Extrato da clínica ---------- */
    const { rows: [t] } = await db.query(`select (valor #>> '{}')::int as c from pagamentos.settings where chave = 'tarifa_pix_cents'`);
    falso = await subirAsaasFalso({ tarifaPixCents: t.c });
    const prov = clienteDoProvedor(falso);
    let seq = 0;
    const pagar = async (proc, hhmm, { paga = true } = {}) => {
      seq++;
      const id = randomUUID();
      const codigo = `codigo-telas-${randomUUID()}`;
      const r = await criarPagamento(db, prov, { clinica: CLINICA, itens: [{ procedure_id: proc, starts_at: horaSP(DIA, hhmm) }], id, codigo,
        paciente: { name: `Paciente Secreto ${seq}`, phone: `119${String(71000 + seq).padStart(8, '0')}`, email: `secreto${seq}@exemplo.test`, consent: true }, chave: randomUUID() });
      if (r.status !== 'ok') throw new Error(`pagamento ${seq}: ${JSON.stringify(r)}`);
      if (paga) await receberAviso(db, prov, falso.pagar(r.provedorId));
      return { id, codigo, ...r };
    };
    {
      const p1 = await pagar(PR.rm, '09:00');
      const p2 = await pagar(PR.usg, '09:10');
      await pagar(PR.rm, '09:20', { paga: false });   // aguardando: não entra no extrato da clínica
      // o paciente cancela o segundo: a devolução total é pedida e a rotina envia
      const canc = await visitante('select public.cancel_request($1, $2)', [p2.id, p2.codigo]);
      await rotina(db, prov, { so: ['enviar_devolucao', 'reenviar_devolucao'] });
      for (const ev of falso.avisos()) await receberAviso(db, prov, ev);
      const bruto = await extrato(FINANCEIRO);
      const d = F.normalizeExtrato(bruto);
      const rec = F.normalizeExtrato(await extrato(RECEPCAO));
      const sit = d?.linhas?.map((l) => `${F.exameTexto(l)}:${F.situacaoLinha(l).texto}:${l.preco_cents}:${l.taxa_cents}:${l.clinica_cents}:${l.devolvido_cents}`) ?? [];
      const tot = d?.totais ?? {};
      const texto = JSON.stringify(bruto);
      const { rows: [log] } = await db.query(`select count(*)::int as n from agenda.access_log where user_id = $1 and clinic_id = $2 and fn = 'pag_clinic_statement'`, [FINANCEIRO.sub, CLINICA]);
      afirmar(canc === 'ok' && d?.tipo === 'ok' && d.linhas.length === 2 && sit[0] === 'Ressonância:Pago:13323:1998:11325:0' && sit[1] === 'Ultrassom:Devolvido:20000:3000:17000:20000'
        && d.linhas.every((l) => l.dia === hoje && l.cobranca.length === 8 && l.meio === 'pix' && l.starts_at)
        && tot.valor_cents === 33323 && tot.taxa_cents === 4998 && tot.clinica_cents === 28325 && tot.devolvido_cents === 20000 && tot.clinica_devolvida_cents === 17000
        && tot.taxa_devolvida_cents === 3000 && tot.cobrancas === 2,
      'extrato da clínica (papel Financeiro): um exame por linha com valor, taxa do IMED, parte da clínica e situação (pago; devolvido depois do cancelamento); os totais são os do banco; a cobrança que só aguarda não entra',
      JSON.stringify({ cancelar: canc, linhas: sit, totais: tot }));
      afirmar(!/Paciente Secreto|secreto\d|1190007|patient|phone|request_id|payer/i.test(texto) && !texto.includes(p1.id) && !texto.includes(p2.id) && log.n >= 1 && rec?.tipo === 'forbidden',
        'o extrato não traz NENHUM dado de paciente nem o id do agendamento (o papel Financeiro não tem como chegar ao nome); a leitura fica registrada; a recepção não lê o extrato',
        JSON.stringify({ leituras_registradas: log.n, recepcao: rec, chaves_da_linha: Object.keys(bruto.linhas?.[0] ?? {}) }));
      const fora = F.normalizeExtrato(await extrato(FINANCEIRO, '2026-01-01', '2026-06-30'));
      afirmar(fora?.tipo === 'invalid' && F.validarPeriodo('2026-01-01', '2026-06-30').ok === false,
        'período maior que o limite: o banco recusa ("invalid") e a tela já recusa antes de pedir', JSON.stringify(fora));
      notas.push(`Extrato: ${sit.join(' | ')}; totais: ${n(F.totaisItens(tot).map((x) => `${x.label} ${x.value}`).join(', '))}`);
    }

    /* ---------- 4. Gestão: resumo, lista e conciliação ---------- */
    {
      const res = P.normalizeResumo(await admin('select public.admin_pag_resumo($1, $2)', [per.de, per.ate]));
      // uma cobrança que o meio de pagamento recebeu e o IMED não conhece (dinheiro sem agendamento): diferença crítica
      const orfa = await prov.criarCobranca({ referencia: randomUUID(), valorCents: 5000, clinicaCents: 4000, walletId: 'wal_teste_telas_0001', descricao: 'cobrança órfã de teste', clienteId: await prov.criarCliente() });
      falso.pagar(orfa.id);
      falso.avisos();
      const conc0 = await comoServidor(db, 'select public.pag_reconcile_apply($1, $2, $3)', [hoje, JSON.stringify(await prov.listar(hoje)), 'd1']);
      const brutoLista = await admin('select public.admin_pag_lista($1, $2, $3, null, $4)', [per.de, per.ate, CLINICA, P.PG_LIMITE]);
      const lista = P.normalizeLista(brutoLista);
      const pagas = P.normalizeLista(await admin(`select public.admin_pag_lista($1, $2, $3, 'aprovada', $4)`, [per.de, per.ate, CLINICA, P.PG_LIMITE]));
      const conc = P.normalizeConciliacao(await admin('select public.admin_pag_conciliacao(true)'));
      const dif = conc?.diferencas.find((x) => x.no_meio === orfa.id);
      const situacoes = lista?.linhas.map((l) => P.situacaoTexto(l.situacao)).sort() ?? [];
      const k = Object.fromEntries(P.resumoKpis(res).map((x) => [x.id, n(x.value)]));
      afirmar(res?.tipo === 'ok' && res.ligada === true && res.extrato.recebido >= 33323 && res.extrato.devolucao <= -20000 && res.contas.ativa >= 1
        && lista?.tipo === 'ok' && lista.linhas.length === 3 && situacoes.join() === 'Aguardando pagamento,Devolvida,Paga' && pagas.linhas.length === 1
        && lista.linhas.every((l) => l.clinica === 'Clínica das Telas do Pagamento do CI' && l.codigo.length === 8 && l.valor_cents > 0 && l.taxa_cents + l.clinica_cents === l.valor_cents)
        && !/Paciente Secreto|secreto\d|1190007|patient|payer|cpf/i.test(JSON.stringify(brutoLista)) && !JSON.stringify(lista).includes('request_id'),
      'gestão: o resumo do período (recebido, taxas, parte das clínicas, devolvido), a lista da clínica com o filtro por situação e nenhum dado de paciente; o id do agendamento que a função manda é descartado pela tela',
      JSON.stringify({ kpis: k, situacoes, pagas: pagas?.linhas.length, contas: res?.contas }));
      afirmar(conc0.status === 'ok' && conc?.tipo === 'ok' && conc.criticas >= 1 && dif?.tipo === 'falta_aqui' && dif.critica && dif.cobranca === ''
        && n(P.ladoTexto(dif.deles, true)) === 'paga · valor R$ 50,00' && P.ladoTexto(dif.nosso) === '—' && P.diffTexto(dif.tipo) === P.PG_DIFF.falta_aqui
        && P.ultimaRodada(conc)?.dia === hoje && /^Última conferência: o dia \d{2}\/\d{2}\/\d{4} \(do dia anterior\), concluída\./.test(P.ultimaRodadaTexto(conc)),
      'conciliação: a cobrança que o meio de pagamento recebeu e o IMED não conhece vira diferença CRÍTICA, com os dois lados em texto; a última conferência aparece com as contagens',
      JSON.stringify({ rodada: P.ultimaRodadaTexto(conc), diferenca: dif && { tipo: dif.tipo, deles: n(P.ladoTexto(dif.deles, true)) }, criticas: conc?.criticas }));
      const res2 = P.normalizeResumo(await admin('select public.admin_pag_resumo($1, $2)', [per.de, per.ate]));
      afirmar(res2.atencao.diferencas_criticas === res.atencao.diferencas_criticas + 1 && P.temCritica(res2) && P.atencaoItens(res2)[0]?.id === 'diferencas_criticas' && res2.atencao.ultima_conciliacao === hoje,
        'depois da conferência, o resumo acende "precisa de atenção" com a diferença crítica em primeiro lugar e diz o último dia conferido', JSON.stringify(res2.atencao));
      notas.push(`Gestão: ${Object.entries(k).map(([a, b]) => `${a}=${b}`).join(', ')}; ${P.ultimaRodadaTexto(conc)}`);
    }

    /* ---------- 5. Chave geral ---------- */
    {
      const r = [];
      for (const [ligar, lista] of [[false, P.MOTIVOS_DESLIGAR], [true, P.MOTIVOS_LIGAR]]) {
        for (const [motivo] of lista) {
          const v = P.validarChave({ ligar, motivo, ciente: true });
          const j = await admin('select public.admin_pag_chave_geral($1, $2)', [v.payload.p_ligar, v.payload.p_motivo]);
          r.push(`${motivo}:${j.status}:${j.vendas_online_ligadas}`);
        }
      }
      const deFora = await comoUsuario(db, DONA, `select public.admin_pag_chave_geral(true, 'abertura_do_piloto')`);
      const lerDeFora = P.normalizeResumo(await comoUsuario(db, DONA, 'select public.admin_pag_resumo($1, $2)', [per.de, per.ate]));
      const desliga = await admin(`select public.admin_pag_chave_geral(false, 'fim_do_teste')`);
      const st = await status(FINANCEIRO);
      const { rows: [tr] } = await db.query(`select count(*)::int as n from pagamentos.audit_log where acao = 'chave_geral' and quem_user = $1`, [ADMIN.sub]);
      afirmar(r.every((x) => /:ok:(true|false)$/.test(x)) && r.length === P.MOTIVOS_LIGAR.length + P.MOTIVOS_DESLIGAR.length && deFora.status === 'forbidden' && lerDeFora?.tipo === 'forbidden'
        && desliga.vendas_online_ligadas === false && F.estadoRecebimento(st).codigo === 'desligado' && F.passos(st).map((p) => (p.feito ? 1 : 0)).join('') === '1110' && tr.n >= r.length + 1,
      'chave geral: todo motivo que a tela oferece é aceito pelo banco e fica na trilha; a dona de uma clínica não liga nem lê a gestão; com a chave desligada, a clínica vê "Desligado" e o que falta é só o IMED abrir o pagamento',
      JSON.stringify({ motivos: r, de_fora: deFora.status, ler_de_fora: lerDeFora?.tipo, estado_da_clinica: F.estadoRecebimento(st).codigo, trilha: tr.n }));
    }
    resumir('pagamento-telas', {}, notas);
  } finally {
    await falso?.fechar().catch(() => {});
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste do pagamento (pagamento-telas)', descreverErro(e)));
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA.sub })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (pagamento-telas)', descreverErro(e)));
    await apagarExtras().catch(() => {});
    await db.end();
  }
});
