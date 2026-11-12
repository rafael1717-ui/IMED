// iMed Pagamentos, fase P2a — o Pix de PONTA A PONTA com o CÓDIGO DE VERDADE das funções do servidor, no banco de
// verdade (arquitetura do pagamento §4.2, §4.4 e §11). Roda no GitHub (banco.yml):
//   node tests/banco/pagamento-ponta-a-ponta.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
// Diferente dos pagamento-*.mjs da P1 (que usavam "funções do servidor" de mentira, de asaas-falso.mjs), aqui rodam os
// lib.ts das Edge Functions pagamento-criar, pagamento-webhook e pagamento-rotina e o adaptador do provedor
// (supabase/functions/_shared/asaas.ts), dentro deste processo: o banco é o de verdade (as funções pag_* como o
// servidor) e o provedor é o de mentira (tests/banco/asaas-falso.mjs, em 127.0.0.1). Nada sai desta máquina. O Deno e o
// Edge Runtime não entram aqui: os index.ts (a casca) não são exercitados.
//
//   1. Fechada por padrão: sem o Turnstile configurado, com o desafio errado ou com a chave geral desligada, NADA é reservado.
//   2. Pix pago: "Ir para o pagamento" → o pagador paga → o aviso chega → confirmado; o que o paciente vê; LGPD.
//   3. Aviso: segredo errado ou ausente não grava nada; o mesmo aviso de novo e 20 vezes ao mesmo tempo; fora de ordem.
//   4. Vencido: o QR vence, a rotina apaga no provedor, a reserva expira e o horário volta a ficar livre.
//   5. Provedor fora do ar: a reserva é solta na hora; depois, o mesmo horário funciona.
//   6. "Já paguei": o aviso não chegou; a consulta ao provedor confirma.
//   7. Devolução automática total: paciente cancela o que pagou; pagamento que chega com o horário já pego; devolução
//      sem resposta (o provedor devolveu e a resposta se perdeu): a rotina consulta antes e não devolve duas vezes.
//   8. A rotina só atende com o token interno; a conciliação do dia não acha diferença.
// Os dados são apagados no fim.

import { randomUUID } from 'node:crypto';
import {
  afirmar, anotar, comoUsuario, configLocal, conectar, criarClinicaAgenda, descreverErro, horaSP, limparClinicaAgenda, principal, resumir,
  violacoesAgenda,
} from './lib.mjs';
import { comoServidor, ligarRecebimento, limparPagamento, subirAsaasFalso, violacoesPagamento } from './asaas-falso.mjs';
import { criarAsaas, leitorAsaas } from '../../supabase/functions/_shared/asaas.ts';
import { tratar as criar } from '../../supabase/functions/pagamento-criar/lib.ts';
import { receber } from '../../supabase/functions/pagamento-webhook/lib.ts';
import { rodar, tratar as rotina } from '../../supabase/functions/pagamento-rotina/lib.ts';

const CLINICA = 'cc000000-0000-4000-8000-000000005a06';
const DONA = 'a5000000-0000-4000-8000-000000005a06';
const EMAIL = 'dona.pagponta@exemplo.test';
const ADMIN = { sub: 'a5000000-0000-4000-8000-000000005a96', email: 'admin.pagponta@exemplo.test' };
const DIA = 19;
const CPF = '52998224725';   // CPF de teste (dígitos verificadores certos; não é de ninguém)
const SEGREDO_AVISO = 'segredo-de-teste-do-aviso-falso-com-mais-de-32-letras';
const AMBIENTE = { TURNSTILE_SECRET_KEY: 'segredo-de-teste-do-turnstile', PAG_CPF_HMAC_KEY: 'chave-de-teste-do-hmac-com-mais-de-32-letras', ASAAS_WEBHOOK_TOKEN: SEGREDO_AVISO };

// As funções do banco como o servidor (service_role), pela conexão direta: o mesmo que o PostgREST faz para a Edge Function.
const rpcPeloBanco = (db) => async (fn, args = {}) => {
  if (!/^[a-z_]+$/.test(fn)) throw new Error(`função ${fn}`);
  const nomes = Object.keys(args);
  const valores = nomes.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  return comoServidor(db, `select public.${fn}(${nomes.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, valores);
};
const cabecalhos = (h) => ({ get: (n) => h[n.toLowerCase()] ?? null });

await principal('pagamento-ponta-a-ponta', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-pag-ponta');
  const extras = await Promise.all(Array.from({ length: 5 }, (_, i) => conectar(cfg.dbUrl, `imed-pag-ponta-${i}`)));
  const notas = [];
  let falso = null;
  try {
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN });
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA });
    const { procedimentos: P } = await criarClinicaAgenda(db, {
      clinica: CLINICA, dona: DONA, email: EMAIL, nome: 'Clínica do Pix de Ponta a Ponta do CI',
      recursos: [{ chave: 'unico', name: 'Aparelho único' }],
      // preço de exemplo, só para a conta (não é preço de clínica nenhuma)
      procedimentos: [{ chave: 'q', name: 'Exame no aparelho', duration_min: 5, price_cents: 13323, exam_code: 'rm', grupos: [['unico']] }],
    });
    const { tarifaPixCents } = await ligarRecebimento(db, comoUsuario, { clinica: CLINICA, dona: { sub: DONA, email: EMAIL }, admin: ADMIN, carteira: 'wal_teste_ponta_0001' });
    falso = await subirAsaasFalso({ tarifaPixCents });
    // o adaptador DE VERDADE, apontado para o provedor de mentira
    const provedor = criarAsaas({ url: falso.url, chave: falso.chave }, fetch);
    const rpc = rpcPeloBanco(db);
    const turnstile = async (url, init) => new Response(JSON.stringify({ success: new URLSearchParams(String(init?.body)).get('response') === 'desafio-ok' }), { status: 200 });
    const deps = (o = {}) => ({
      rpc: o.rpc ?? rpc, provedor: o.provedor === undefined ? provedor : o.provedor, env: (n) => (o.ambiente ?? AMBIENTE)[n], fetch: turnstile,
      agora: () => Date.now(), usuario: async () => null, contagem: new Map(),
    });
    let n = 0;
    const hhmm = (i) => `${String(Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}`;
    const pedido = (i, extra = {}) => {
      n++;
      return {
        action: 'criar', clinic: CLINICA, items: [{ procedure_id: P.q, starts_at: horaSP(DIA, hhmm(i)) }], id: randomUUID(), token: randomUUID().replace(/-/g, '').repeat(2),
        key: randomUUID(), captcha: 'desafio-ok', payer: { name: `Pagador de Teste ${n}`, cpf: CPF },
        patient: { name: `Paciente Ponta ${n}`, phone: `119${String(60000 + n).padStart(8, '0')}`, email: `paciente${n}@exemplo.test`, consent: true }, ...extra,
      };
    };
    const irParaOPagamento = (p, o) => criar(p, { ip: '203.0.113.9', autorizacao: '' }, deps(o));
    const aviso = (evento, o = {}) => receber(cabecalhos({ 'asaas-access-token': o.segredo ?? SEGREDO_AVISO }), JSON.stringify(evento),
      { rpc: o.rpc ?? rpc, provedor, env: (x) => (o.ambiente ?? AMBIENTE)[x], leitor: leitorAsaas });
    const passada = (so, conciliar = false) => rodar({ conciliar, limiteMs: 60000, so }, { rpc, provedor, agora: () => Date.now() });
    const visitante = async (sql, params) => {
      await db.query('begin');
      try {
        await db.query(`select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('role', 'anon', true)`);
        const { rows } = await db.query(sql, params);
        await db.query('commit');
        return Object.values(rows[0])[0];
      } catch (e) { await db.query('rollback').catch(() => {}); throw e; }
    };
    const meuPagamento = (p) => visitante('select public.pag_my_payment($1, $2)', [p.id, p.token]);
    const emergencia = async (motivo, sqls) => {
      await db.query('begin');
      await db.query(`select set_config('imed.origin', 'sql', true), set_config('imed.reason', $1, true)`, [motivo]);
      for (const [sql, params] of sqls) await db.query(sql, params);
      await db.query('commit');
    };
    // "relógio": empurra os prazos da reserva e da cobrança `min` minutos para trás
    const passar = (id, min) => emergencia('teste_relogio', [
      [`update public.appointment_requests set hold_expires_at = hold_expires_at - make_interval(mins => $2) where id = $1 and hold_expires_at is not null`, [id, min]],
      [`update agenda.occupancy o set hold_until = o.hold_until - make_interval(mins => $2)
        where o.active and o.hold_until is not null and o.item_id in (select i.id from agenda.appointment_items i where i.request_id = $1)`, [id, min]],
      [`update pagamentos.charges set expira_em = expira_em - make_interval(mins => $2) where request_id = $1`, [id, min]],
    ]);
    const estado = async (id) => (await db.query(`
      select a.status as pedido, c.situacao, c.provedor_cobranca_id as provedor, c.devolvido_cents as devolvido,
             (select coalesce(string_agg(r.situacao || ':' || r.valor_cents || ':' || r.motivo, ','), '-') from pagamentos.refunds r where r.charge_id = c.id) as devolucoes,
             (select coalesce(string_agg(l.tipo || ':' || l.valor_cents, ',' order by l.id), '-') from pagamentos.ledger l where l.charge_id = c.id) as extrato,
             (select coalesce(sum(l.valor_cents), 0)::int from pagamentos.ledger l where l.charge_id = c.id and l.tipo <> 'tarifa_meio') as saldo
      from public.appointment_requests a left join pagamentos.charges c on c.request_id = a.id where a.id = $1
      order by c.criado_em desc limit 1`, [id])).rows[0];
    const livre = async (i) => (await db.query(`select exists (select 1 from public.agenda_slots($1, $2, $3::date, $3::date) s where s.slot_start = $4::timestamptz) as ok`,
      [CLINICA, P.q, horaSP(DIA, '12:00').slice(0, 10), horaSP(DIA, hhmm(i))])).rows[0].ok;
    const contar = async () => (await db.query('select count(*)::int as n from public.appointment_requests where clinic_id = $1', [CLINICA])).rows[0].n;

    /* ---------- 1. Fechada por padrão ---------- */
    {
      const sem = await irParaOPagamento(pedido(0), { ambiente: { PAG_CPF_HMAC_KEY: AMBIENTE.PAG_CPF_HMAC_KEY } });
      const errado = await irParaOPagamento(pedido(0, { captcha: 'desafio-errado' }));
      const semProvedor = await irParaOPagamento(pedido(0), { provedor: null });
      afirmar(sem.http === 503 && sem.corpo.status === 'captcha_not_configured' && errado.http === 403 && errado.corpo.status === 'captcha_failed'
        && semProvedor.http === 503 && await contar() === 0 && falso.estado.pedidos === 0,
      'fechada por padrão: sem o Turnstile configurado, com o desafio errado ou sem o provedor, nada é reservado e nada vai ao provedor',
      JSON.stringify({ sem: sem.corpo, errado: errado.corpo, semProvedor: semProvedor.corpo, pedidos: await contar(), noProvedor: falso.estado.pedidos }));
      // a chave geral desligada para tudo, mesmo com as funções configuradas
      await comoUsuario(db, ADMIN, `select public.admin_pag_chave_geral(false, 'teste_ci')`);
      const off = await irParaOPagamento(pedido(0));
      await comoUsuario(db, ADMIN, `select public.admin_pag_chave_geral(true, 'teste_ci')`);
      afirmar(off.http === 200 && off.corpo.status === 'payments_off' && await contar() === 0 && falso.estado.pedidos === 0,
        'com a chave geral desligada (vendas_online_ligadas = false): "payments_off", nada reservado, nada no provedor', JSON.stringify(off.corpo));
    }

    /* ---------- 2. Pix pago ---------- */
    let pago;
    {
      const p = pedido(1);
      const r = await irParaOPagamento(p);
      const e0 = await estado(p.id);
      const tela = await meuPagamento(p);
      afirmar(r.http === 200 && r.corpo.status === 'ok' && r.corpo.payment?.valor_cents === 13323 && r.corpo.payment.pix_copia_cola?.startsWith('00020126')
        && e0.pedido === 'awaiting_payment' && e0.situacao === 'aguardando' && tela.payment?.pix_copia_cola === r.corpo.payment.pix_copia_cola
        && Date.parse(r.corpo.payment.expira_em) < Date.parse(r.corpo.hold_expires_at),
      '"Ir para o pagamento": horário reservado, cobrança "aguardando" com o copia e cola, e o QR vence antes da reserva',
      JSON.stringify({ resposta: r.corpo, banco: e0, tela }));
      // (o "copia e cola" do provedor de mentira leva o id da cobrança dentro dele; fora dele, o id não aparece)
      const semCodigo = (o) => JSON.stringify(o, (k, v) => (k === 'pix_copia_cola' ? undefined : v));
      const proibidos = ['wal_teste_ponta_0001', 'taxa', 'clinica_cents', e0.provedor, CPF, 'charge_id', 'provedor'];
      afirmar(proibidos.every((x) => !semCodigo(r.corpo).includes(x)) && proibidos.every((x) => !semCodigo(tela).includes(x)),
        'o paciente não recebe taxa, carteira da clínica, id do provedor nem o CPF de volta (na resposta e em pag_my_payment)', JSON.stringify({ resposta: r.corpo, tela }));
      // o que o provedor recebeu (§6.3): só nome e CPF do pagador, o valor, a divisão, a descrição fixa e a referência
      const cliente = falso.recebido.find((x) => x.caminho === '/v3/customers')?.corpo;
      const cobranca = falso.recebido.find((x) => x.metodo === 'POST' && x.caminho === '/v3/payments')?.corpo;
      const tudo = JSON.stringify(falso.recebido);
      afirmar(JSON.stringify(Object.keys(cliente ?? {}).sort()) === '["cpfCnpj","name","notificationDisabled"]' && cliente.notificationDisabled === true
        && JSON.stringify(Object.keys(cobranca ?? {}).sort()) === '["billingType","customer","description","dueDate","externalReference","split","value"]'
        && cobranca.value === 133.23 && cobranca.split[0].fixedValue === 113.25 && cobranca.split[0].walletId === 'wal_teste_ponta_0001'
        && /^IMED · agendamento [0-9A-F]{8}$/.test(cobranca.description)
        && ['Paciente Ponta', 'exemplo.test', '1190006', 'Exame no aparelho', horaSP(DIA, hhmm(1)).slice(0, 10)].every((x) => !tudo.includes(x)),
      'LGPD: o provedor recebe só o nome e o CPF de quem paga, o valor, a divisão (R$ 113,25 fixos para a clínica de R$ 133,23) e a descrição fixa; nunca o paciente, o telefone, o e-mail, o exame ou a data',
      JSON.stringify({ cliente, cobranca }));
      const { rows: [g] } = await db.query(`select (select count(*)::int from pagamentos.payers where cpf_hmac ~ '^[0-9a-f]{64}$') as pagadores,
        (select count(*)::int from pagamentos.payers p where p::text like '%' || $1 || '%') + (select count(*)::int from pagamentos.charges c where c::text like '%' || $1 || '%')
        + (select count(*)::int from public.appointment_requests a where a.clinic_id = $2 and a::text like '%' || $1 || '%') as cpf_em_texto`, [CPF, CLINICA]);
      afirmar(g.pagadores >= 1 && g.cpf_em_texto === 0, 'o CPF não fica guardado em texto em lugar nenhum: só o HMAC, em pagamentos.payers', JSON.stringify(g));

      const ev = falso.pagar(e0.provedor);
      const a = await aviso(ev);
      const e1 = await estado(p.id);
      const tela1 = await meuPagamento(p);
      afirmar(a.http === 200 && a.corpo.status === 'aplicado' && e1.pedido === 'confirmed' && e1.situacao === 'aprovada'
        && e1.extrato === `recebido:13323,taxa_imed:1998,repasse_clinica:11325,tarifa_meio:${tarifaPixCents}`
        && tela1.request_status === 'confirmed' && tela1.payment.situacao === 'aprovada' && tela1.payment.pix_copia_cola === null && tela1.payment.paga_em,
      'o pagador paga, o aviso chega: agendamento CONFIRMADO, cobrança aprovada e o extrato fecha (15% de R$ 133,23 = R$ 19,98, para baixo; R$ 113,25 para a clínica)',
      JSON.stringify({ aviso: a.corpo, banco: e1, tela: tela1 }));
      pago = { p, provedor: e0.provedor, ev };
      notas.push(`Pix pago: ${e1.pedido}, cobrança ${e1.situacao}, extrato ${e1.extrato}`);
    }

    /* ---------- 3. Avisos: segredo, repetido, ao mesmo tempo e fora de ordem ---------- */
    {
      const antes = (await db.query('select count(*)::int as n from pagamentos.events')).rows[0].n;
      const novo = { ...pago.ev, id: `evt_falso_${randomUUID()}` };
      const errado = await aviso(novo, { segredo: 'outro-segredo-qualquer-com-mais-de-32-letras-aqui' });
      const vazio = await aviso(novo, { segredo: '' });
      const semSegredo = await aviso(novo, { ambiente: {} });
      const depois = (await db.query('select count(*)::int as n from pagamentos.events')).rows[0].n;
      afirmar(errado.http === 401 && vazio.http === 401 && semSegredo.http === 503 && depois === antes,
        'aviso com o segredo errado ou sem segredo: 401; função sem o segredo configurado: recusa tudo (503); nada é gravado',
        JSON.stringify({ errado: errado.corpo, vazio: vazio.corpo, semSegredo: semSegredo.corpo, antes, depois }));

      const de_novo = await aviso(pago.ev);
      const e = await estado(pago.p.id);
      afirmar(de_novo.http === 200 && de_novo.corpo.status === 'repetido' && e.extrato.split(',').length === 4,
        'o MESMO aviso de novo: 200 "repetido", nada muda (um só conjunto de linhas no extrato)', JSON.stringify({ de_novo: de_novo.corpo, extrato: e.extrato }));

      // outro agendamento, pago; o mesmo aviso chega 20 vezes ao mesmo tempo, por 5 conexões
      const p = pedido(2);
      await irParaOPagamento(p);
      const ev = falso.pagar((await estado(p.id)).provedor);
      const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => extras[i % extras.length]).reduce((filas, c, i) => { (filas[i % extras.length] ??= []).push(c); return filas; }, [])
        .map(async (fila) => { const out = []; for (const c of fila) out.push(await aviso(ev, { rpc: rpcPeloBanco(c) })); return out; }));
      const conta = {};
      for (const r of rs.flat()) conta[`${r.http}:${r.corpo.status}`] = (conta[`${r.http}:${r.corpo.status}`] ?? 0) + 1;
      const e2 = await estado(p.id);
      afirmar(Object.keys(conta).every((k) => k.startsWith('200:')) && conta['200:aplicado'] === 1 && e2.pedido === 'confirmed' && e2.extrato.split(',').length === 4,
        'o mesmo aviso 20 vezes ao mesmo tempo: todos respondem 200, UM aplica, e o extrato tem um conjunto só', JSON.stringify({ conta, banco: e2 }));

      // fora de ordem: o paciente cancela, a devolução sai, e o aviso ANTIGO de "recebido" (outro id) chega depois
      const cancel = await visitante('select public.cancel_request($1, $2)', [p.id, p.token]);
      const feito = await passada(['enviar_devolucao']);
      const [devolvido] = falso.avisos().filter((x) => x.event === 'PAYMENT_REFUNDED');
      const velho = await aviso({ ...ev, id: `evt_falso_${randomUUID()}` });
      const refund = await aviso(devolvido);
      const e3 = await estado(p.id);
      afirmar(cancel === 'ok' && feito.feito.enviar_devolucao === 1 && velho.http === 200 && refund.http === 200 && e3.pedido === 'cancelled' && e3.situacao === 'devolvida'
        && e3.saldo === 0 && falso.cobrancas.get(e3.provedor).estornos.length === 1,
      'aviso fora de ordem (o "recebido" antigo chega depois da devolução): vale a situação CONSULTADA no provedor; continua devolvida, uma devolução só',
      JSON.stringify({ cancel, feito, velho: velho.corpo, refund: refund.corpo, banco: e3 }));
      notas.push(`Avisos: 20 ao mesmo tempo → ${JSON.stringify(conta)}; fora de ordem → ${e3.situacao}`);
    }

    /* ---------- 4. Vencido ---------- */
    {
      const p = pedido(3);
      await irParaOPagamento(p);
      const e0 = await estado(p.id);
      await passar(p.id, 9);                                  // o QR (8 min) venceu; a reserva (10 min) ainda não
      const tela = await meuPagamento(p);
      const feito = await passada(['apagar']);
      const e1 = await estado(p.id);
      const ocupado = !(await livre(3));
      await passar(p.id, 7);                                  // fim da reserva e da carência (16 min)
      const expirou = (await db.query('select private.agenda_expire($1) as ok', [p.id])).rows[0].ok;
      const e2 = await estado(p.id);
      const tela2 = await meuPagamento(p);
      afirmar(tela.payment.pix_copia_cola === null && feito.feito.apagar === 1 && e1.situacao === 'expirada' && falso.cobrancas.get(e0.provedor).apagada === true
        && e1.pedido === 'awaiting_payment' && ocupado && expirou === true && e2.pedido === 'expired' && await livre(3) && tela2.request_status === 'expired'
        && e2.extrato === '-',
      'Pix não pago: o copia e cola some no fim do QR, a rotina apaga a cobrança no provedor, a reserva expira depois da carência e o horário volta a ficar livre; nenhum dinheiro registrado',
      JSON.stringify({ tela: tela.payment, feito, e1, ocupado, expirou, e2, tela2: tela2.request_status }));
      notas.push(`Vencido: cobrança ${e2.situacao}, agendamento ${e2.pedido}, horário livre de novo`);
    }

    /* ---------- 5. Provedor fora do ar ---------- */
    {
      const p = pedido(4);
      falso.foraDoAr(true);
      const r = await irParaOPagamento(p);
      const e = await estado(p.id);
      const solto = await livre(4);
      falso.foraDoAr(false);
      const p2 = pedido(4);
      const r2 = await irParaOPagamento(p2);
      afirmar(r.http === 502 && r.corpo.status === 'provider_unavailable' && r.corpo.released === true && e.pedido === 'cancelled' && e.situacao === 'cancelada'
        && e.provedor === null && solto && r2.corpo.status === 'ok',
      'provedor FORA DO AR ao criar a cobrança: "pagamento indisponível", a reserva é solta NA HORA (horário livre de novo) e, quando ele volta, o mesmo horário funciona',
      JSON.stringify({ resposta: r.corpo, banco: e, solto, depois: r2.corpo.status }));

      /* ---------- 6. "Já paguei" (o aviso não chegou) ---------- */
      const e0 = await estado(p2.id);
      const antes = await criar({ action: 'conferir', id: p2.id, token: p2.token }, { ip: '203.0.113.9', autorizacao: '' }, deps());
      falso.pagar(e0.provedor);                               // paga; o aviso se perde
      const errado = await criar({ action: 'conferir', id: p2.id, token: 'c'.repeat(64) }, { ip: '203.0.113.9', autorizacao: '' }, deps());
      const depois = await criar({ action: 'conferir', id: p2.id, token: p2.token }, { ip: '203.0.113.9', autorizacao: '' }, deps());
      const e1 = await estado(p2.id);
      afirmar(antes.corpo.situacao === 'aguardando' && errado.corpo.status === 'not_found' && depois.corpo.situacao === 'aprovada' && depois.corpo.request_status === 'confirmed'
        && e1.pedido === 'confirmed',
      '"já paguei": antes de pagar só confere (continua aguardando); com o código errado não acha nada; depois de pagar, a consulta ao provedor confirma, sem depender do aviso',
      JSON.stringify({ antes: antes.corpo, errado: errado.corpo, depois: depois.corpo, banco: e1 }));
      notas.push(`Provedor fora do ar: ${r.corpo.status}, reserva ${e.pedido}; "já paguei": ${depois.corpo.situacao}`);
    }

    /* ---------- 7. Devolução automática total ---------- */
    {
      // (a) o paciente cancela o agendamento que pagou (o primeiro, do item 2)
      const cancel = await visitante('select public.cancel_request($1, $2)', [pago.p.id, pago.p.token]);
      const e0 = await estado(pago.p.id);
      const tela0 = await meuPagamento(pago.p);
      const feito = await passada(['enviar_devolucao']);
      const e1 = await estado(pago.p.id);
      const tela1 = await meuPagamento(pago.p);
      const noProvedor = falso.cobrancas.get(pago.provedor);
      afirmar(cancel === 'ok' && e0.devolucoes.startsWith('pedida:13323:') && tela0.payment.devolucoes[0]?.situacao === 'pedida' && feito.feito.enviar_devolucao === 1
        && e1.situacao === 'devolvida' && e1.devolvido === 13323 && e1.saldo === 0 && noProvedor.status === 'REFUNDED' && noProvedor.estornos.length === 1
        && noProvedor.estornos[0].split[0]?.value === 113.25 && tela1.payment.devolucoes[0]?.situacao === 'devolvida' && tela1.payment.devolvido_cents === 13323,
      'o paciente cancela o que pagou: devolução TOTAL pedida na hora, a rotina envia (R$ 113,25 saem da carteira da clínica, a taxa do IMED volta junto), o extrato zera e o paciente vê "devolvida"',
      JSON.stringify({ cancel, e0, feito, e1, noProvedor: { status: noProvedor.status, estornos: noProvedor.estornos }, tela: tela1.payment }));

      // (b) pagamento que chega depois de a reserva expirar, com o horário já pego por outro paciente
      const p1 = pedido(5);
      await irParaOPagamento(p1);
      const prov1 = (await estado(p1.id)).provedor;
      const ev = falso.pagar(prov1);                          // pagou no último segundo; o aviso demora
      await passar(p1.id, 20);
      await db.query('select private.agenda_expire($1)', [p1.id]);
      const p2 = pedido(5);
      const r2 = await irParaOPagamento(p2);                  // outro paciente reserva o mesmo horário
      const a = await aviso(ev);
      const e2 = await estado(p1.id);
      const f2 = await passada(['enviar_devolucao', 'apagar']);
      const e3 = await estado(p1.id);
      const tela3 = await meuPagamento(p1);
      afirmar(r2.corpo.status === 'ok' && a.corpo.acao === 'devolver' && e2.pedido === 'expired' && e2.devolucoes === 'pedida:13323:pagamento_atrasado'
        && f2.feito.enviar_devolucao === 1 && e3.situacao === 'devolvida' && e3.saldo === 0 && (await estado(p2.id)).pedido === 'awaiting_payment'
        && tela3.request_status === 'expired' && tela3.payment.paga_em && tela3.payment.devolucoes[0]?.situacao === 'devolvida',
      'pagamento ATRASADO com o horário já pego: nunca passa por cima do outro paciente; o dinheiro volta inteiro sozinho e o paciente vê que foi devolvido',
      JSON.stringify({ segundo: r2.corpo.status, aviso: a.corpo, e2, f2, e3, tela: tela3 }));

      // (c) devolução sem resposta: o provedor devolveu e a resposta se perdeu. A rotina CONSULTA antes de reenviar.
      const p3 = pedido(6);
      await irParaOPagamento(p3);
      const prov3 = (await estado(p3.id)).provedor;
      await aviso(falso.pagar(prov3));
      await visitante('select public.cancel_request($1, $2)', [p3.id, p3.token]);
      const { rows: [dev] } = await db.query(`select f.id from pagamentos.refunds f join pagamentos.charges c on c.id = f.charge_id where c.request_id = $1`, [p3.id]);
      const env = await rpc('pag_refund_sent', { p_refund: dev.id });
      await provedor.devolver(prov3, { valorCents: env.valor_cents, clinicaCents: env.clinica_cents, walletId: env.wallet_id, total: true, chave: env.chave_idempotencia });
      falso.avisos();                                         // ...e nem a resposta nem o aviso chegam
      const cedo = await passada(['reenviar_devolucao', 'enviar_devolucao']);
      await emergencia('teste_relogio', [[`update pagamentos.refunds set enviada_em = now() - interval '6 minutes', atualizado_em = now() - interval '6 minutes' where id = $1`, [dev.id]]]);
      const tarde = await passada(['reenviar_devolucao']);
      const e4 = await estado(p3.id);
      afirmar(!cedo.feito.reenviar_devolucao && tarde.feito.reenviar_devolucao === 1 && e4.situacao === 'devolvida' && e4.devolvido === 13323 && e4.saldo === 0
        && falso.cobrancas.get(prov3).estornos.length === 1 && falso.cobrancas.get(prov3).devolvidoCents === 13323,
      'devolução enviada e sem resposta: a rotina espera 5 min, CONSULTA o provedor, vê que o dinheiro já voltou e só conclui (uma devolução só, aqui e lá)',
      JSON.stringify({ cedo, tarde, e4, estornos: falso.cobrancas.get(prov3).estornos.length }));

      // (d) provedor fora do ar na hora de devolver: o pedido fica de pé e sai quando ele volta
      const p4 = pedido(7);
      await irParaOPagamento(p4);
      const prov4 = (await estado(p4.id)).provedor;
      await aviso(falso.pagar(prov4));
      await visitante('select public.cancel_request($1, $2)', [p4.id, p4.token]);
      falso.foraDoAr(true);
      const fora = await passada(['enviar_devolucao']);
      const e5 = await estado(p4.id);
      falso.foraDoAr(false);
      await emergencia('teste_relogio', [[`update pagamentos.refunds f set enviada_em = now() - interval '6 minutes', atualizado_em = now() - interval '6 minutes'
                                           where f.charge_id in (select c.id from pagamentos.charges c where c.request_id = $1)`, [p4.id]]]);
      const volta = await passada(['reenviar_devolucao']);
      const e6 = await estado(p4.id);
      afirmar(e5.devolucoes.startsWith('enviada:') && falso.cobrancas.get(prov4).estornos.length === 1 && e6.situacao === 'devolvida' && e6.saldo === 0
        && volta.feito.reenviar_devolucao === 1 && fora.feito.enviar_devolucao === 1,
      'provedor fora do ar na devolução: o pedido não se perde nem vira "falhou" (não se sabe se saiu); quando ele volta, a rotina confere e devolve UMA vez',
      JSON.stringify({ fora, e5, volta, e6 }));
      notas.push(`Devoluções: paciente cancelou → ${e1.situacao}; atrasado → ${e3.situacao}; sem resposta → ${e4.situacao} (1 estorno); fora do ar → ${e6.situacao}`);
    }

    /* ---------- 8. A rotina: token interno, tudo o que sobrou e a conciliação ---------- */
    {
      const { rows: [t] } = await db.query(`select token from private.app_tokens where name = 'pagamentos'`);
      const semToken = await rotina(cabecalhos({}), null, { rpc, provedor, agora: () => Date.now() });
      const errado = await rotina(cabecalhos({ 'x-imed-token': 'f'.repeat(64) }), null, { rpc, provedor, agora: () => Date.now() });
      const outro = (await db.query(`select token from private.app_tokens where name = 'importer'`)).rows[0]?.token ?? 'e'.repeat(64);
      const deOutro = await rotina(cabecalhos({ 'x-imed-token': outro }), null, { rpc, provedor, agora: () => Date.now() });
      const certo = await rotina(cabecalhos({ 'x-imed-token': t.token }), { conciliar: true }, { rpc, provedor, agora: () => Date.now() });
      const resto = await rpc('pag_due');
      const { rows: [dif] } = await db.query(`select count(*)::int as n from pagamentos.reconciliation_diffs d
        where d.resolvida_em is null and (d.charge_id in (select id from pagamentos.charges where clinic_id = $1) or d.provedor_cobranca_id like 'pay_falso_%')`, [CLINICA]);
      afirmar(semToken.http === 403 && errado.http === 403 && deOutro.http === 403 && certo.http === 200 && certo.corpo.feito.conciliar >= 1
        && Object.keys(certo.corpo.falhou).length === 0 && resto.acoes.length === 0 && dif.n === 0,
      'a rotina só atende com o token interno "pagamentos" (sem token, errado ou o da fila de importação: 403); com ele, faz tudo o que sobrou, concilia os dias com o provedor e não acha diferença',
      JSON.stringify({ semToken: semToken.corpo, errado: errado.corpo, deOutro: deOutro.corpo, certo: certo.corpo, resto: resto.acoes, diferencas: dif.n }));
      notas.push(`Rotina: ${JSON.stringify(certo.corpo.feito)}; diferenças abertas na conciliação: ${dif.n}`);
    }

    const vp = await violacoesPagamento(db, CLINICA);
    const va = await violacoesAgenda(db, CLINICA);
    afirmar(vp.length === 0, 'nenhum invariante do pagamento quebrado (P-I1 a P-I5)', vp.join('\n'));
    afirmar(va.length === 0, 'nenhum aparelho com mais pacientes do que a capacidade', va.join('\n'));
    resumir('pagamento-ponta-a-ponta', {}, notas);
  } finally {
    await falso?.fechar().catch(() => {});
    await Promise.all(extras.map((c) => c.end().catch(() => {})));
    await limparPagamento(db, { clinica: CLINICA, admin: ADMIN })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste do pagamento (ponta a ponta)', descreverErro(e)));
    await limparClinicaAgenda(db, { clinica: CLINICA, dona: DONA })
      .catch((e) => anotar('warning', 'Não deu para apagar os dados de teste (pagamento-ponta-a-ponta)', descreverErro(e)));
    await db.end();
  }
});
