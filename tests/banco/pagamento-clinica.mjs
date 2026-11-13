// iMed Pagamentos, fase P2b — a função do servidor "pagamento-clinica" com o CÓDIGO DE VERDADE (lib.ts) e o adaptador
// do provedor de verdade (_shared/asaas.ts), no banco de verdade, com o provedor de mentira (asaas-falso.mjs, em
// 127.0.0.1). Roda no GitHub (banco.yml):
//   node tests/banco/pagamento-clinica.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
// A função fala com o banco COMO A PESSOA que chamou (nunca como o servidor): aqui, cada "sessão" de teste vira as
// claims daquela pessoa numa conexão direta, o mesmo que o PostgREST faz com o token dela. O Deno e o Edge Runtime não
// entram: o index.ts (a casca) não é exercitado.
//
//   1. Fechada por padrão: sem o provedor, sem a versão dos termos ou sem sessão, nada é gravado nem perguntado.
//   2. Só a dona: recepção, financeiro, gestor, uma conta de fora e a equipe do IMED recebem 403, e o meio de pagamento
//      nem é consultado.
//   3. A carteira do próprio IMED é recusada; "conferir" não grava nada.
//   4. "ligar": a conta fica EM CONFERÊNCIA, com o aceite e a trilha; nada é ativado (a clínica continua sem receber).
//   5. Provedor fora do ar: nada é gravado; provedor sem a listagem de carteiras: segue para a conferência do IMED.
//   6. Trocar a carteira de uma conta ativa: volta para a conferência e a unidade volta ao pagamento no local.
//   7. Conta suspensa pelo IMED: a clínica não religa sozinha.
//   8. Do começo ao fim, o provedor só recebeu leituras da lista de carteiras: nenhum cliente, nenhuma cobrança.
// Os dados são apagados no fim. Carteiras e nomes são de teste (não são de clínica nenhuma).

import {
  afirmar, anotar, comoUsuario, configLocal, conectar, criarClinicaAgenda, descreverErro, limparClinicaAgenda, principal, resumir,
} from './lib.mjs';
import { limparPagamento, subirAsaasFalso } from './asaas-falso.mjs';
import { criarAsaas } from '../../supabase/functions/_shared/asaas.ts';
import { ErroBanco } from '../../supabase/functions/_shared/base.ts';
import { tratar } from '../../supabase/functions/pagamento-clinica/lib.ts';

const CLINICA = 'cc000000-0000-4000-8000-000000005b02';
const DONA = { sub: 'a5000000-0000-4000-8000-000000005b02', email: 'dona.pagclinica@exemplo.test' };
const ADMIN = { sub: 'a5000000-0000-4000-8000-000000005b92', email: 'admin.pagclinica@exemplo.test' };
const OUTROS = {
  recepcao: { sub: 'a5000000-0000-4000-8000-000000005b12', email: 'recepcao.pagclinica@exemplo.test', papel: 'reception' },
  financeiro: { sub: 'a5000000-0000-4000-8000-000000005b22', email: 'financeiro.pagclinica@exemplo.test', papel: 'finance' },
  gestor: { sub: 'a5000000-0000-4000-8000-000000005b32', email: 'gestor.pagclinica@exemplo.test', papel: 'manager' },
  de_fora: { sub: 'a5000000-0000-4000-8000-000000005b42', email: 'defora.pagclinica@exemplo.test', papel: null },
};
const CARTEIRA = 'wal_teste_clinica_p2b_0001';
const CARTEIRA_NOVA = 'wal_teste_clinica_p2b_0002';
const AMBIENTE = { PAG_TERMOS_CLINICA: 'v1' };

await principal('pagamento-clinica', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-pag-clinica');
  const notas = [];
  let falso = null;
  const extras = Object.values(OUTROS).map((o) => o.sub);
  const apagarExtras = () => db.query('delete from auth.users where id = any($1::uuid[])', [extras]);
  try {
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN });
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA.sub });
    await apagarExtras();
    await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA.sub, email: DONA.email, nome: 'Clínica da Conta no Meio de Pagamento do CI',
      recursos: [{ chave: 'unico', name: 'Aparelho único' }],
      procedimentos: [{ chave: 'q', name: 'Exame no aparelho', duration_min: 5, price_cents: 13323, exam_code: 'rm', grupos: [['unico']] }],
    });
    for (const o of [...Object.values(OUTROS), ADMIN]) {
      await db.query(`insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
                      values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
                              '{"provider": "email", "providers": ["email"]}', '{}', now(), now()) on conflict (id) do nothing`, [o.sub, o.email]);
      if (o.papel) await db.query('insert into public.clinic_members (clinic_id, user_id, role) values ($1, $2, $3)', [CLINICA, o.sub, o.papel]);
    }
    await db.query('insert into public.admin_emails (email) values ($1) on conflict do nothing', [ADMIN.email]);

    falso = await subirAsaasFalso();
    // o adaptador DE VERDADE, apontado para o provedor de mentira
    const provedor = criarAsaas({ url: falso.url, chave: falso.chave }, fetch);
    // as "sessões": cada token de teste é uma pessoa; a função fala com o banco como ela
    const SESSOES = { 'Bearer tok-dona': DONA, 'Bearer tok-admin': ADMIN, ...Object.fromEntries(Object.entries(OUTROS).map(([k, v]) => [`Bearer tok-${k}`, v])) };
    const rpcComo = (autorizacao) => async (fn, args = {}) => {
      const pessoa = SESSOES[autorizacao];
      if (!pessoa) throw new ErroBanco(401, 'PGRST301');
      if (!/^[a-z_]+$/.test(fn)) throw new Error(`função ${fn}`);
      const nomes = Object.keys(args);
      return comoUsuario(db, pessoa, `select public.${fn}(${nomes.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, nomes.map((k) => args[k]));
    };
    const deps = (o = {}) => ({
      rpcComo, provedor: o.provedor === undefined ? provedor : o.provedor, env: (n) => (o.ambiente ?? AMBIENTE)[n], agora: () => Date.now(),
      usuario: async (a) => SESSOES[a]?.sub ?? null, contagem: new Map(),
    });
    const chamar = (corpo, quem = 'dona', o) => tratar({ clinic: CLINICA, wallet: CARTEIRA, terms: 'v1', ...corpo }, { ip: '203.0.113.9', autorizacao: quem ? `Bearer tok-${quem}` : '' }, deps(o));
    const conta = async () => (await db.query(`select a.situacao, a.wallet_id, a.termos_versao, a.aceito_por, a.conferida_em is not null as conferida,
        (select u.payment_mode from agenda.unit_settings u where u.clinic_id = a.clinic_id) as modo, private.pag_clinic_online(a.clinic_id) as recebendo
      from pagamentos.clinic_accounts a where a.clinic_id = $1`, [CLINICA])).rows[0] ?? null;
    const noProvedor = () => falso.recebido.length;
    // a trilha só acrescenta (as linhas de uma rodada anterior deste teste, no mesmo banco, ficam): conta a partir de agora
    const { rows: [{ ate }] } = await db.query('select coalesce(max(id), 0)::bigint as ate from pagamentos.audit_log');
    const trilha = async () => (await db.query(`select acao, quem_user, depois from pagamentos.audit_log where clinic_id = $1 and id > $2 order by id`, [CLINICA, ate])).rows;

    /* ---------- 1. Fechada por padrão ---------- */
    {
      const semProvedor = await chamar({ action: 'ligar' }, 'dona', { provedor: null });
      const semTermos = await chamar({ action: 'ligar' }, 'dona', { ambiente: {} });
      const termosVelhos = await chamar({ action: 'ligar', terms: 'v0' });
      const semSessao = await chamar({ action: 'ligar' }, null);
      const sessaoFalsa = await chamar({ action: 'ligar' }, 'ninguem');
      const malFeito = await chamar({ action: 'ligar', wallet: 'curta' });
      afirmar(semProvedor.http === 503 && semProvedor.corpo.status === 'provider_not_configured' && semTermos.http === 503 && semTermos.corpo.status === 'terms_not_configured'
        && termosVelhos.http === 409 && termosVelhos.corpo.termos === 'v1' && semSessao.http === 401 && sessaoFalsa.http === 401 && malFeito.http === 400
        && await conta() === null && noProvedor() === 0,
      'fechada por padrão: sem o provedor, sem a versão dos termos, com termos de outra versão, sem sessão ou com pedido mal feito, nada é gravado e nada vai ao provedor',
      JSON.stringify({ semProvedor: semProvedor.corpo, semTermos: semTermos.corpo, termosVelhos: termosVelhos.corpo, semSessao: semSessao.corpo, sessaoFalsa: sessaoFalsa.corpo, malFeito: malFeito.corpo, conta: await conta(), noProvedor: noProvedor() }));
    }

    /* ---------- 2. Só a dona ---------- */
    {
      const r = {};
      for (const quem of ['recepcao', 'financeiro', 'gestor', 'de_fora', 'admin']) {
        r[quem] = [(await chamar({ action: 'conferir' }, quem)).http, (await chamar({ action: 'ligar' }, quem)).http];
      }
      // o financeiro VÊ a situação (financeiro.ver), mas não configura
      const ve = await comoUsuario(db, OUTROS.financeiro, 'select public.pag_clinic_status($1)', [CLINICA]);
      afirmar(Object.values(r).every(([a, b]) => a === 403 && b === 403) && ve.status === 'ok' && ve.pode_configurar === false && await conta() === null && noProvedor() === 0,
        'só a dona da clínica: recepção, financeiro, gestor, conta de fora e equipe do IMED recebem 403 (conferir e ligar), nada é gravado e o meio de pagamento nem é consultado',
        JSON.stringify({ respostas: r, financeiro_ve: ve.status, pode_configurar: ve.pode_configurar, conta: await conta(), noProvedor: noProvedor() }));
    }

    /* ---------- 3. Carteira do próprio IMED e "conferir" ---------- */
    {
      const propria = await chamar({ action: 'ligar', wallet: falso.carteiraPropria });
      const propriaConf = await chamar({ action: 'conferir', wallet: falso.carteiraPropria });
      const conf = await chamar({ action: 'conferir' });
      afirmar(propria.http === 422 && propria.corpo.status === 'own_wallet' && propriaConf.http === 422 && conf.http === 200 && conf.corpo.carteira === 'a_conferir'
        && conf.corpo.carteira_final === '0001' && !JSON.stringify(conf.corpo).includes(CARTEIRA) && await conta() === null,
      'a carteira do próprio IMED é recusada; "conferir" responde "a conferir" (o provedor não sabe validar a carteira de outra conta), devolve só o final da carteira e NÃO grava nada',
      JSON.stringify({ propria: propria.corpo, conferir: conf.corpo, conta: await conta() }));
    }

    /* ---------- 4. Ligar: em conferência, com aceite e trilha; nada é ativado ---------- */
    {
      const r = await chamar({ action: 'ligar' });
      const c = await conta();
      const t = await trilha();
      const st = await comoUsuario(db, DONA, 'select public.pag_clinic_status($1)', [CLINICA]);
      const { rows: [g] } = await db.query(`select private.pag_vendas_ligadas() as chave`);
      afirmar(r.http === 200 && r.corpo.status === 'ok' && r.corpo.situacao === 'em_conferencia' && r.corpo.unchanged === false && r.corpo.carteira === 'a_conferir'
        && c?.situacao === 'em_conferencia' && c.wallet_id === CARTEIRA && c.termos_versao === 'v1' && c.aceito_por === DONA.sub && c.conferida === false
        && c.modo === 'no_local' && c.recebendo === false && g.chave === false && st.situacao === 'em_conferencia' && st.recebendo === false && st.carteira_final === '0001'
        && t.length === 1 && t[0].acao === 'conta.ligar' && t[0].quem_user === DONA.sub && !JSON.stringify(t[0].depois).includes(CARTEIRA),
      '"ligar": a conta fica EM CONFERÊNCIA com a carteira e o aceite da dona, a trilha registra quem foi (sem a carteira inteira) e NADA é ativado: unidade no pagamento no local, chave geral desligada, clínica sem receber',
      JSON.stringify({ resposta: r.corpo, conta: c, trilha: t, status: { situacao: st.situacao, recebendo: st.recebendo }, chave_geral: g.chave }));
      const de_novo = await chamar({ action: 'ligar' });
      afirmar(de_novo.http === 200 && de_novo.corpo.unchanged === true && (await trilha()).length === 1,
        'o mesmo pedido de novo: "sem mudança", nenhuma linha nova na trilha', JSON.stringify({ resposta: de_novo.corpo, trilha: (await trilha()).length }));
      notas.push(`Ligar: ${r.corpo.situacao}, carteira ${r.corpo.carteira} (final ${r.corpo.carteira_final}); de novo: unchanged=${de_novo.corpo.unchanged}`);
    }

    /* ---------- 5. Provedor fora do ar; provedor sem a listagem de carteiras ---------- */
    {
      falso.foraDoAr(true);
      const fora = await chamar({ action: 'ligar', wallet: CARTEIRA_NOVA });
      falso.foraDoAr(false);
      const depois = await conta();
      falso.estado.semCarteiras = true;
      const semLista = await chamar({ action: 'conferir', wallet: CARTEIRA_NOVA });
      const semListaPropria = await chamar({ action: 'conferir', wallet: falso.carteiraPropria });
      falso.estado.semCarteiras = false;
      afirmar(fora.http === 503 && fora.corpo.status === 'provider_unavailable' && depois.wallet_id === CARTEIRA && (await trilha()).length === 1
        && semLista.http === 200 && semLista.corpo.carteira === 'a_conferir' && semListaPropria.http === 200,
      'provedor FORA DO AR: "tente de novo" e nada é gravado (a carteira de antes continua); provedor SEM a listagem de carteiras: a função não trava, responde "a conferir" e a conferência fica com a equipe do IMED',
      JSON.stringify({ fora: fora.corpo, carteira_depois: depois.wallet_id, semLista: semLista.corpo, semListaPropria: semListaPropria.corpo }));
    }

    /* ---------- 6. Trocar a carteira de uma conta ativa ---------- */
    {
      const ok = (j, o) => { if (j?.status !== 'ok') throw new Error(`${o}: ${JSON.stringify(j)}`); return j; };
      ok(await comoUsuario(db, ADMIN, `select public.admin_pag_conta_conferir($1, 'ativa', 'conta_de_teste_conferida')`, [CLINICA]), 'conferir a conta');
      ok(await comoUsuario(db, DONA, 'select public.pag_clinic_pause($1, false)', [CLINICA]), 'modo online');
      const antes = await conta();
      const r = await chamar({ action: 'ligar', wallet: CARTEIRA_NOVA });
      const c = await conta();
      afirmar(antes.situacao === 'ativa' && antes.modo === 'online' && r.http === 200 && r.corpo.situacao === 'em_conferencia' && r.corpo.carteira_final === '0002'
        && c.situacao === 'em_conferencia' && c.wallet_id === CARTEIRA_NOVA && c.conferida === false && c.modo === 'no_local' && c.recebendo === false,
      'trocar a carteira de uma conta ATIVA: volta para a conferência do IMED e a unidade volta ao pagamento no local na hora (carteira nova não recebe sem ser conferida)',
      JSON.stringify({ antes, resposta: r.corpo, depois: c }));
    }

    /* ---------- 7. Conta suspensa pelo IMED ---------- */
    {
      const s = await comoUsuario(db, ADMIN, `select public.admin_pag_conta_conferir($1, 'suspensa', 'teste_de_suspensao')`, [CLINICA]);
      const n = noProvedor();
      const r = await chamar({ action: 'ligar', wallet: CARTEIRA });
      const conf = await chamar({ action: 'conferir', wallet: CARTEIRA });
      const c = await conta();
      afirmar(s.status === 'ok' && r.http === 409 && r.corpo.status === 'suspended' && conf.http === 409 && c.situacao === 'suspensa' && c.wallet_id === CARTEIRA_NOVA && noProvedor() === n,
        'conta SUSPENSA pelo IMED: a clínica não religa sozinha (409), nada muda e o meio de pagamento nem é consultado', JSON.stringify({ resposta: r.corpo, conferir: conf.corpo, conta: c }));
    }

    /* ---------- 8. O que o provedor recebeu, do começo ao fim ---------- */
    {
      const outros = falso.recebido.filter((x) => !(x.metodo === 'GET' && x.caminho === '/v3/wallets/'));
      const { rows: [n] } = await db.query(`select (select count(*) from pagamentos.charges where clinic_id = $1)::int as cobrancas, (select count(*) from pagamentos.payers)::int as pagadores`, [CLINICA]);
      afirmar(falso.recebido.length > 0 && outros.length === 0 && falso.cobrancas.size === 0 && n.cobrancas === 0,
        'do começo ao fim, o meio de pagamento só recebeu LEITURAS da lista de carteiras da conta: nenhum cliente, nenhuma cobrança, nenhum dado de clínica ou de pessoa; e nenhuma cobrança nasceu no banco',
        JSON.stringify({ pedidos: falso.recebido.length, outros: outros.map((x) => `${x.metodo} ${x.caminho}`), cobrancas: n.cobrancas }));
      notas.push(`Provedor: ${falso.recebido.length} leituras de /v3/wallets/, 0 de outro tipo`);
    }
    resumir('pagamento-clinica', {}, notas);
  } finally {
    await falso?.fechar().catch(() => {});
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste do pagamento (pagamento-clinica)', descreverErro(e)));
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA.sub })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (pagamento-clinica)', descreverErro(e)));
    await apagarExtras().catch(() => {});
    await db.end();
  }
});
