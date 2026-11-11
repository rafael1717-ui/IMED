// iMed Agenda, fase 3.0 — o pedido de agendamento EXATAMENTE como o site manda, no banco de verdade (Postgres 17 +
// PostgREST do Supabase local, com todas as migrações). Roda no GitHub (banco.yml):
//   node tests/banco/pedido-do-site.mjs   (precisa do "supabase start" e de "npm ci --prefix tests/banco --ignore-scripts")
//
// Cada pedido é montado pelo próprio código do site (assets/js/geo-core.js): o local vem de normalizeImedRow (a
// clínica parceira, buscada em nearby_clinics pelo PostgREST, como a busca faz) ou de normalizeCnes; o formulário
// passa por validateBooking; a linha sai de bookingRow (com review_token_hash, como local.js e perto.js); e o envio é
// o POST /rest/v1/appointment_requests com Prefer: return=minimal e os cabeçalhos da regra do site
// (IMED_CONFIG.supabaseHeaders, fase 0.1): como visitante, só a chave publishable no "apikey" (sem Authorization); como
// paciente logado, a chave no "apikey" e o token dele em "Authorization: Bearer". Casos: local não parceiro sem horário, parceiro com horário, para outra pessoa adulta e
// menor.
// Fase 3.3: o caminho antigo COM horário acabou. A grade antiga não oferece horário (available_slots e
// clinics_with_schedule vazios) e o pedido com horário montado pelo site antigo é recusado com 409/23P01, que o site
// reconhece como "este horário acabou de ser ocupado" (isSlotTaken); nada fica gravado. Horário agora só pelas funções
// da agenda (agenda_book: tests/banco/concorrencia.mjs).
// Confere: HTTP 201; cada coluna gravada igual à enviada; request_status e cancel_request com o código do pedido;
// e que a lista "colunas do pedido do site" de supabase/tests/000_catalogo.sql é EXATAMENTE o que o bookingRow
// manda, com INSERT para anon e authenticated em cada coluna (a fase 3.1 passa o INSERT para coluna por coluna).
// Fase 3.1: as colunas novas do pedido nascem no padrão (o navegador nem tem permissão para gravá-las) e o PATCH
// direto no pedido pela API é recusado (42501): a situação só muda pelas funções (cancel_request, set_request_status).
//
// Os dados (uma clínica, a grade, um usuário e os pedidos) são criados aqui e apagados no fim.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as G from '../../assets/js/geo-core.js';
import {
  afirmar, anotar, cabecalhosDoSite, configLocal, conectar, descreverErro, estatisticas, postgrest, principal, resumir,
  tokenUsuario,
} from './lib.mjs';

const CLINICA = 'cc000000-0000-4000-8000-0000000000d1';
const USUARIO = 'a5000000-0000-4000-8000-0000000000d1';
const EMAIL_USUARIO = 'paciente.site@exemplo.test';
const NOME_CLINICA = 'Clínica do Teste do Site';
const ORIGEM = { lat: -23.5489, lng: -46.6388 };
const CATALOGO = fileURLToPath(new URL('../../supabase/tests/000_catalogo.sql', import.meta.url));

const sha256 = (t) => createHash('sha256').update(t).digest('hex');

async function limpar(db) {
  // Desde a 3.1, apagar pedido exige a marca de emergência (imed.origin = 'sql' + motivo; fica na auditoria).
  await db.query('begin');
  await db.query("select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'limpeza_teste_ci', true)");
  await db.query(`delete from public.appointment_requests where clinic_id = $1 or patient_name like 'Teste do Site %'`, [CLINICA]);
  await db.query('commit');
  await db.query('delete from public.clinics where id = $1', [CLINICA]);
  await db.query('delete from auth.users where id = $1', [USUARIO]);
}

/** Colunas da lista "colunas do pedido do site" do 000_catalogo.sql (entre os marcadores). */
function colunasDoCatalogo() {
  const sql = readFileSync(CATALOGO, 'utf8');
  const ini = sql.indexOf('-- [colunas do pedido do site]');
  const fim = sql.indexOf('-- [fim das colunas do pedido do site]');
  if (ini < 0 || fim < ini) return null;
  return [...sql.slice(ini, fim).matchAll(/\('([a-z_]+)'\)/g)].map((m) => m[1]).sort();
}

await principal('pedido-do-site', async () => {
  const cfg = configLocal();
  const db = await conectar(cfg.dbUrl, 'imed-pedido-do-site');
  const notas = [];
  const tempos = [];
  try {
    await limpar(db);
    const dia = G.spDate(7);
    const { rows: [{ dow }] } = await db.query('select extract(dow from $1::date)::int as dow', [dia]);

    // Clínica parceira publicada, com agenda (08:00–10:00 de 30 em 30 min, ultrassom) no dia do teste.
    await db.query(
      `insert into public.clinics (id, name, kind, address_line, neighborhood, city, state, location, phone, status,
                                   accepts_online_booking, is_demo)
       values ($1, $2, 'imagem', 'Rua do Teste do Site, 500', 'Centro', 'São Paulo', 'SP',
               extensions.st_setsrid(extensions.st_makepoint($4, $3), 4326)::extensions.geography, '(11) 3000-1234',
               'published', true, false)`,
      [CLINICA, NOME_CLINICA, ORIGEM.lat, ORIGEM.lng]);
    await db.query(`insert into public.clinic_exams (clinic_id, exam_code) values ($1, 'usg')`, [CLINICA]);
    await db.query(
      `insert into public.clinic_schedules (clinic_id, weekday, start_time, end_time, slot_minutes, exam_codes)
       values ($1, $2, '08:00', '10:00', 30, '{usg}')`, [CLINICA, dow]);
    // Paciente com conta (e-mail confirmado), como o Auth cria.
    await db.query(
      `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                               created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
               '{"provider": "email", "providers": ["email"]}', '{}', now(), now())`, [USUARIO, EMAIL_USUARIO]);

    // Visitante: sem token (o site manda só a chave publishable no "apikey"); paciente logado: o token dele.
    const tokens = { anon: null, usuario: tokenUsuario(cfg, { sub: USUARIO, email: EMAIL_USUARIO }) };
    const hVisitante = cabecalhosDoSite(cfg, tokens.anon);
    const hPaciente = cabecalhosDoSite(cfg, tokens.usuario);
    afirmar(hVisitante.apikey === cfg.publishableKey && !('Authorization' in hVisitante)
      && hPaciente.apikey === cfg.publishableKey && hPaciente.Authorization === `Bearer ${tokens.usuario}`,
      'cabeçalhos do site (fase 0.1): visitante só com a chave publishable no apikey; paciente com a chave e o token dele em Bearer',
      `visitante: ${Object.keys(hVisitante).join(', ')}; paciente: ${Object.keys(hPaciente).join(', ')}`);

    // O local parceiro como a busca do site recebe (nearby_clinics) e normaliza; o local do CNES, como normalizeCnes.
    const busca = await postgrest(cfg, 'rpc/nearby_clinics', {
      token: tokens.anon, prefer: null,
      corpo: { p_lat: ORIGEM.lat, p_lng: ORIGEM.lng, p_radius_m: 2000, p_include_demo: false, p_limit: 100 },
    });
    const linhaClinica = Array.isArray(busca.json) ? busca.json.find((r) => r.id === CLINICA) : null;
    if (!linhaClinica) throw new Error(`nearby_clinics não trouxe a clínica de teste (HTTP ${busca.status}: ${busca.message})`);
    const parceiro = G.normalizeImedRow(linhaClinica, ORIGEM);
    const naoParceiro = G.normalizeCnes({
      cnes: '7654321', name: 'Laboratório do Teste do Site', kind: 'laboratorio', address_line: 'Rua do Laboratório, 10',
      neighborhood: 'Centro', city: 'São Paulo', uf: 'SP', phone: '(11) 3141-1000', lat: ORIGEM.lat, lng: ORIGEM.lng,
      distance_m: 120, sus: true,
    }, ORIGEM);

    const vagas = await postgrest(cfg, 'rpc/available_slots', {
      token: tokens.anon, prefer: null, corpo: { p_clinic: CLINICA, p_exam: 'usg', p_from: dia, p_days: 1 },
    });
    afirmar(vagas.status === 200 && Array.isArray(vagas.json) && vagas.json.length === 0,
      'fase 3.3: a grade antiga não oferece horário (available_slots vazio, como visitante)',
      `HTTP ${vagas.status}; ${JSON.stringify(vagas.json)?.slice(0, 200)}`);
    const comAgenda = await postgrest(cfg, 'rpc/clinics_with_schedule', { token: tokens.anon, prefer: null, corpo: { p_ids: [CLINICA] } });
    afirmar(Array.isArray(comAgenda.json) && comAgenda.json.length === 0,
      'fase 3.3: clinics_with_schedule não lista a clínica da grade antiga (o site mostra o pedido sem horário)',
      `HTTP ${comAgenda.status}; ${JSON.stringify(comAgenda.json)?.slice(0, 200)}`);
    // Horários que o site ANTIGO teria oferecido (grade 08:00–10:00 de São Paulo, sem horário de verão).
    const horarios = [`${dia}T08:00:00-03:00`, `${dia}T08:30:00-03:00`].map((t) => new Date(t).toISOString());

    const casos = [
      {
        nome: 'visitante, local não parceiro, sem horário, para mim (com e-mail e observação)', quem: 'anon', local: naoParceiro,
        v: { exam: 'lab', date: dia, period: 'manha', name: '  Teste do Site   Um ', phone: '(11) 98765-0001',
             email: 'Teste.Um@Exemplo.test', notes: '  Chego cedo, em jejum.  ', consent: true, forOther: false },
        situacao: 'pending',
      },
      {
        nome: 'visitante, parceiro com horário, para mim', quem: 'anon', local: parceiro,
        v: { exam: 'usg', slot: horarios[0], name: 'Teste do Site Dois', phone: '11987650002', email: '', notes: '',
             consent: true, forOther: false },
        recusa: true,
      },
      {
        nome: 'visitante, local não parceiro, para outra pessoa adulta', quem: 'anon', local: naoParceiro,
        v: { exam: 'lab', date: dia, period: 'tarde', name: 'Teste do Site Três', phone: '(11) 98765-0003', email: '',
             notes: '', consent: true, forOther: true, otherName: 'Maria  do Teste', relationship: 'Pai ou mãe',
             otherMinor: false, otherConsent: true },
        situacao: 'pending',
      },
      {
        nome: 'paciente logado, parceiro com horário, para um menor de idade', quem: 'usuario', local: parceiro,
        v: { exam: 'usg', slot: horarios[1], name: 'Teste do Site Quatro', phone: '(11) 98765-0004',
             email: 'paciente.site@exemplo.test', notes: 'Criança de 8 anos', consent: true, forOther: true,
             otherName: 'João do Teste', relationship: 'Filho ou filha', otherMinor: true, guardianConsent: true },
        recusa: true,
      },
      {
        nome: 'paciente logado, local não parceiro, sem horário, para mim', quem: 'usuario', local: naoParceiro,
        v: { exam: 'lab', date: dia, period: 'qualquer', name: 'Teste do Site Cinco', phone: '(11) 3333-4444', email: '',
             notes: '', consent: true, forOther: false },
        situacao: 'pending',
      },
    ];

    const enviados = [];
    const colunasEnviadas = new Set();
    for (const c of casos) {
      const erros = G.validateBooking(c.v);
      afirmar(Object.keys(erros).length === 0, `o formulário do caso é válido para o site (${c.nome})`, JSON.stringify(erros));
      const id = randomUUID();
      const codigo = randomBytes(32).toString('hex');
      const linha = G.bookingRow(c.local, c.v, id, { review_token_hash: sha256(codigo) });
      Object.keys(linha).forEach((k) => colunasEnviadas.add(k));
      const r = await postgrest(cfg, 'appointment_requests', { token: tokens[c.quem], corpo: linha });
      if (c.recusa) {
        // Fase 3.3: com horário, recusado com 23P01; o site (local.js) reconhece pelo erro e mostra "horário ocupado".
        const erro = Object.assign(new Error(`http ${r.status}`), { status: r.status, data: r.json });
        const { rows: [{ n }] } = await db.query('select count(*)::int as n from public.appointment_requests where id = $1', [id]);
        afirmar(!r.ok && r.code === '23P01' && G.isSlotTaken(erro) && n === 0,
          `fase 3.3: pedido COM horário pelo caminho antigo recusado (23P01; o site mostra "horário ocupado"; nada gravado): ${c.nome}`,
          `HTTP ${r.status} ${r.code ?? ''}: ${r.message}; gravados: ${n}`);
        notas.push(`pedido com horário pelo caminho antigo: HTTP ${r.status}, código ${r.code ?? '-'} (recusado; o site reconhece pelo código)`);
        continue;
      }
      tempos.push({ ok: r.status === 201, ms: r.ms, code: r.status === 201 ? undefined : (r.code ?? `HTTP ${r.status}`) });
      if (!afirmar(r.status === 201, `pedido aceito (HTTP 201): ${c.nome}`, `HTTP ${r.status} ${r.code ?? ''}: ${r.message}`)) continue;

      const { rows: [gravado] } = await db.query(
        'select to_jsonb(a) as j from public.appointment_requests a where a.id = $1', [id]);
      const j = gravado?.j ?? {};
      const diferencas = Object.entries(linha).filter(([k, enviado]) => {
        const valor = j[k];
        if (k === 'slot_start') return new Date(valor).getTime() !== new Date(enviado).getTime();
        return valor !== enviado;
      }).map(([k, enviado]) => `${k}: enviado ${JSON.stringify(enviado)}, gravado ${JSON.stringify(j[k])}`);
      afirmar(diferencas.length === 0, `cada coluna gravada igual à enviada: ${c.nome}`, diferencas.join('\n'));
      const conta = c.quem === 'usuario' ? USUARIO : null;
      afirmar(j.status === c.situacao && (j.user_id ?? null) === conta,
        `situação ${c.situacao} e ${conta ? 'ligado à conta de quem está logado' : 'sem conta'}: ${c.nome}`,
        `status ${j.status}, user_id ${j.user_id}`);
      enviados.push({ ...c, id, codigo, linha });
    }

    // Fase 3.1: as colunas novas nascem no padrão em todo pedido do site (canal imed_app, versão 1, sem recursos...).
    {
      const ids = enviados.map((e) => e.id);
      const { rows } = await db.query(
        `select id, channel, version, uses_resources, payment_mode, notify_channels, slot_end, hold_expires_at, cancel_reason,
                total_cents from public.appointment_requests where id = any($1::uuid[])`, [ids]);
      const fora = rows.filter((x) => x.channel !== 'imed_app' || x.version !== 1 || x.uses_resources !== false
        || x.payment_mode !== 'no_local' || (x.notify_channels ?? []).length > 0 || x.slot_end !== null
        || x.hold_expires_at !== null || x.cancel_reason !== null || x.total_cents !== null);
      afirmar(ids.length > 0 && rows.length === ids.length && fora.length === 0,
        'fase 3.1: os pedidos do site nascem com as colunas novas no padrão (canal imed_app, versão 1, sem recursos)',
        JSON.stringify(fora).slice(0, 600));
    }
    // Fase 3.1: ninguém muda o pedido direto pela API (PATCH), nem o dono do pedido: só pelas funções.
    {
      const alvo = enviados.find((e) => e.quem === 'usuario');
      if (alvo) {
        const r = await postgrest(cfg, `appointment_requests?id=eq.${alvo.id}`, {
          token: tokens.usuario, metodo: 'PATCH', corpo: { status: 'cancelled' },
        });
        const { rows: [x] } = await db.query('select status, version from public.appointment_requests where id = $1', [alvo.id]);
        afirmar(!r.ok && r.code === '42501' && x?.status === alvo.situacao && x?.version === 1,
          'fase 3.1: PATCH direto no pedido pela API é recusado (42501) e nada muda',
          `HTTP ${r.status} ${r.code ?? ''}: ${r.message}; situação ${x?.status}, versão ${x?.version}`);
        notas.push(`PATCH direto no pedido: HTTP ${r.status}, código ${r.code ?? '-'} (recusado; só as funções mudam o pedido)`);
      }
    }

    // O aparelho guarda id e código; a página inicial e a conta perguntam a situação com eles (request_status).
    {
      const meus = enviados.filter((e) => e.quem === 'anon');
      const r = await postgrest(cfg, 'rpc/request_status', {
        token: tokens.anon, prefer: null, corpo: { p_ids: meus.map((e) => e.id), p_tokens: meus.map((e) => e.codigo) },
      });
      const situacao = Object.fromEntries((Array.isArray(r.json) ? r.json : []).map((x) => [x.id, `${x.status}|${x.reviewed}`]));
      afirmar(meus.length > 0 && meus.every((e) => situacao[e.id] === `${e.situacao}|false`),
        'request_status com o código do pedido mostra a situação de cada pedido do visitante',
        `HTTP ${r.status}: ${JSON.stringify(r.json)?.slice(0, 400)}`);
      const errado = await postgrest(cfg, 'rpc/request_status', {
        token: tokens.anon, prefer: null, corpo: { p_ids: meus.map((e) => e.id), p_tokens: meus.map(() => 'codigo-errado') },
      });
      afirmar(Array.isArray(errado.json) && errado.json.length === 0, 'request_status com código errado não mostra nada',
        `HTTP ${errado.status}: ${JSON.stringify(errado.json)?.slice(0, 200)}`);
    }

    // Cancelar pelo site (cancel_request com o código), como hoje.
    {
      const alvo = enviados.find((e) => e.quem === 'anon');
      if (alvo) {
        const r = await postgrest(cfg, 'rpc/cancel_request', { token: tokens.anon, prefer: null, corpo: { p_id: alvo.id, p_token: alvo.codigo } });
        const { rows: [x] } = await db.query('select status, cancelled_by from public.appointment_requests where id = $1', [alvo.id]);
        afirmar(r.json === 'ok' && x?.status === 'cancelled' && x?.cancelled_by === 'patient',
          'cancel_request com o código: ok, cancelado pelo paciente (como hoje)',
          `cancel_request: HTTP ${r.status} ${JSON.stringify(r.json)}; situação ${x?.status}, quem ${x?.cancelled_by}`);
      }
    }

    // Fase 4.3: o pedido do site sem horário numa clínica parceira sobe a versão da agenda (aviso ao painel); com a linha
    // da versão presa por outra escrita da agenda ainda aberta, o pedido NÃO se perde: o aviso espera no máximo 200 ms
    // (lock_timeout da função do gatilho) e desiste, bem antes do tempo-limite do visitante (o painel vê na consulta
    // periódica seguinte).
    {
      const versao = async () => Number((await db.query(
        'select coalesce((select version from agenda.clinic_versions where clinic_id = $1), 0) as v', [CLINICA])).rows[0].v);
      const pedido = (n) => {
        const id = randomUUID();
        return { id, linha: G.bookingRow(parceiro, { exam: 'usg', date: dia, period: 'manha', name: `Teste do Site Aviso ${n}`,
          phone: `(11) 98765-010${n}`, email: '', notes: '', consent: true, forOther: false }, id,
        { review_token_hash: sha256(randomBytes(32).toString('hex')) }) };
      };
      const v0 = await versao();
      const livre = pedido(1);
      const r1 = await postgrest(cfg, 'appointment_requests', { token: tokens.anon, corpo: livre.linha });
      const v1 = await versao();
      afirmar(r1.status === 201 && v1 === v0 + 1,
        'fase 4.3: pedido do site sem horário numa clínica parceira sobe a versão da agenda uma vez (aviso ao painel)',
        `HTTP ${r1.status} ${r1.code ?? ''}: ${r1.message}; versão ${v0} → ${v1}`);
      const outra = await conectar(cfg.dbUrl, 'imed-pedido-do-site-versao');
      try {
        await outra.query('begin');
        await outra.query('select private.agenda_touch($1)', [CLINICA]);
        const preso = pedido(2);
        const r2 = await postgrest(cfg, 'appointment_requests', { token: tokens.anon, corpo: preso.linha });
        const { rows: [{ n }] } = await db.query('select count(*)::int as n from public.appointment_requests where id = $1', [preso.id]);
        afirmar(r2.status === 201 && n === 1 && r2.ms < 2000,
          'fase 4.3: com a versão da agenda presa por outra escrita, o pedido do site é gravado mesmo assim (o aviso desiste em 200 ms)',
          `HTTP ${r2.status} ${r2.code ?? ''}: ${r2.message}; gravados: ${n}; ${Math.round(r2.ms)} ms`);
        notas.push(`pedido do site com a versão da agenda presa: HTTP ${r2.status} em ${Math.round(r2.ms)} ms (o aviso desiste; o pedido fica)`);
      } finally {
        await outra.query('rollback').catch(() => {});
        await outra.end();
      }
    }

    // A lista do 000_catalogo.sql é exatamente o que o bookingRow manda, e cada coluna tem INSERT para os dois papéis.
    const enviadas = [...colunasEnviadas].sort();
    const doCatalogo = colunasDoCatalogo();
    afirmar(doCatalogo && JSON.stringify(doCatalogo) === JSON.stringify(enviadas),
      `a lista "colunas do pedido do site" do 000_catalogo.sql é exatamente o que o site manda (${enviadas.length} colunas)`,
      `site manda: ${enviadas.join(', ')}\nlista do 000: ${doCatalogo?.join(', ') ?? '(marcadores não encontrados)'}`);
    const { rows: semInsert } = await db.query(
      `select r || ': ' || c as falta from unnest($1::text[]) c, unnest(array['anon', 'authenticated']) r
        where not exists (select 1 from pg_attribute a where a.attrelid = 'public.appointment_requests'::regclass
                            and a.attname = c and not a.attisdropped)
           or not has_column_privilege(r, 'public.appointment_requests'::regclass, c, 'INSERT')
        order by 1`, [enviadas]);
    afirmar(semInsert.length === 0, 'anon e authenticated têm INSERT em cada coluna que o site manda',
      semInsert.map((x) => x.falta).join(', '));

    const e = estatisticas(tempos);
    notas.push(`${enviados.length} de ${casos.filter((c) => !c.recusa).length} pedidos do site sem horário aceitos (bookingRow → PostgREST, visitante e logado; `
      + `${enviadas.length} colunas conferidas); p95 ${e.p95} ms, máx ${e.max} ms`);
    resumir('pedido-do-site', { enviados: enviados.length, casos: casos.filter((c) => !c.recusa).length, colunas: enviadas, ...e }, notas);
  } finally {
    await limpar(db).catch((err) => anotar('warning', 'Não deu para apagar os dados de teste (pedido-do-site)', descreverErro(err)));
    await db.end();
  }
});
