// Ferramentas dos testes do banco de verdade (iMed Agenda, fase 3.0; arquitetura §13).
// Usadas pelos scripts tests/banco/*.mjs (no GitHub: .github/workflows/banco.yml) e pelo laço local (tests/banco/local/).
// Dependem só do Node 22 e do pacote "pg", com a versão travada em tests/banco/package-lock.json:
//   npm ci --prefix tests/banco --ignore-scripts
//
//   configLocal()            endereços e segredo do Supabase LOCAL (nunca da produção)
//   jwt(), tokenUsuario()    tokens assinados com o segredo do banco local, iguais aos do Auth
//   conectar()               conexão direta com o Postgres (recusa banco com dados da produção)
//   rodarJuntos()            N transações que partem juntas (barreira com pg_advisory_lock)
//   estatisticas()           p50, p95, máximo e erros por código (23P01, 23505, 40P01, 57014...)
//   postgrest()              chamada HTTP no PostgREST local, com os cabeçalhos que o site manda (cabecalhosDoSite)
//   anotar(), resumir()      avisos no topo da execução do GitHub e resumo (o registro do GitHub não é lido daqui)

import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';

export const NO_GITHUB = process.env.GITHUB_ACTIONS === 'true';

/* ===================== Avisos (anotações) e resumo ===================== */

const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

// O GitHub corta a mensagem de cada anotação em ~4.096 bytes (conferido: o resumo parou no byte 4.096).
export const MAX_BYTES_AVISO = 3800;
/** Corta o texto em `max` bytes (UTF-8), sem quebrar letra, e marca o corte. */
export function cortarBytes(texto, max = MAX_BYTES_AVISO) {
  const t = String(texto);
  if (Buffer.byteLength(t, 'utf8') <= max) return t;
  let fim = Math.min(t.length, max);
  while (fim > 0 && Buffer.byteLength(t.slice(0, fim), 'utf8') > max - 12) fim--;
  return `${t.slice(0, fim)} …(cortado)`;
}

/**
 * Mostra um aviso. No GitHub vira anotação (::error, ::warning ou ::notice) no topo da página da execução,
 * com até 14 linhas por aviso (linhas vazias são puladas), até ~3.800 bytes cada, e no máximo `maxAvisos` avisos;
 * fora dele, texto simples.
 */
export function anotar(nivel, titulo, texto = '', { maxLinhas = 14, maxAvisos = 3 } = {}) {
  const linhas = String(texto).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
  const blocos = [];
  for (let i = 0; i < Math.max(linhas.length, 1) && blocos.length < maxAvisos; i += maxLinhas) {
    blocos.push(cortarBytes(linhas.slice(i, i + maxLinhas).join('\n')));
  }
  blocos.forEach((b, k) => {
    const t = blocos.length > 1 ? `${titulo} (${k + 1}/${blocos.length})` : titulo;
    if (NO_GITHUB) console.log(`::${nivel} title=${escProp(t)}::${esc(b || t)}`);
    else console.log(`[${nivel === 'error' ? 'ERRO' : nivel === 'warning' ? 'ATENÇÃO' : 'nota'}] ${t}${b ? `\n  ${b.replace(/\n/g, '\n  ')}` : ''}`);
  });
}

/** Texto útil de um erro do Postgres (código, mensagem, detalhe, dica, onde) ou de um erro qualquer. */
export function descreverErro(e) {
  if (!e) return 'erro desconhecido';
  const partes = [];
  if (e.code) partes.push(`código ${e.code}`);
  partes.push(e.message || String(e));
  for (const k of ['detail', 'hint', 'where', 'table', 'constraint']) if (e[k]) partes.push(`${k}: ${e[k]}`);
  if (e.stack && !e.code) partes.push(...String(e.stack).split('\n').slice(1, 6).map((l) => l.trim()));
  return partes.join('\n');
}

let falhas = 0;
/** Confere uma condição: se não vale, avisa (anotação de erro) e o script termina com código 1. */
export function afirmar(cond, titulo, detalhes = '') {
  if (cond) {
    console.log(`ok - ${titulo}`);
    return true;
  }
  falhas++;
  console.log(`FALHOU - ${titulo}`);
  anotar('error', `Falhou - ${titulo}`, detalhes);
  process.exitCode = 1;
  return false;
}
export const falhou = () => falhas > 0;

/**
 * Guarda o resumo do script: JSON em $IMED_RESUMO_DIR (o último passo do banco.yml junta todos numa nota no topo
 * da página) e uma lista no resumo da execução ($GITHUB_STEP_SUMMARY).
 */
export function resumir(nome, dados, notas = []) {
  console.log(`\nResumo - ${nome}\n${notas.map((l) => `  ${l}`).join('\n')}`);
  const dir = process.env.IMED_RESUMO_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${nome}.json`), JSON.stringify({ nome, notas, ...dados }, null, 2));
  }
  const sumario = process.env.GITHUB_STEP_SUMMARY;
  if (sumario && notas.length) appendFileSync(sumario, `### ${nome}\n\n${notas.map((l) => `- ${l}`).join('\n')}\n\n`);
}

/** Roda o corpo do script; erro inesperado vira aviso com a causa (e código de saída 1). */
export async function principal(nome, corpo) {
  try {
    await corpo();
  } catch (e) {
    process.exitCode = 1;
    console.error(e);
    anotar('error', `${nome} - erro inesperado`, descreverErro(e));
  }
}

/* ===================== Supabase LOCAL ===================== */

/**
 * Endereços, chave e segredo do Supabase local. Ordem: arquivo de $IMED_SUPABASE_STATUS (o banco.yml grava a saída
 * de "supabase status -o json"), depois o próprio "supabase status -o json", depois as variáveis DB_URL, API_URL,
 * JWT_SECRET e PUBLISHABLE_KEY. Recusa endereço que não seja desta máquina: os testes nunca falam com a produção.
 * A chave publishable LOCAL (sb_publishable_..., como a do site) vai no "apikey"; o gateway local (Kong) atende
 * quem vem só com ela como o papel anon, igual à produção.
 */
// A saída de "supabase status -o json" pode vir com avisos antes ou depois do JSON: pega só o objeto.
export const jsonDaSaida = (texto) => JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));

export function configLocal() {
  let st = null;
  const arq = process.env.IMED_SUPABASE_STATUS;
  if (arq && existsSync(arq)) st = jsonDaSaida(readFileSync(arq, 'utf8'));
  if (!st && !process.env.DB_URL) {
    try {
      st = jsonDaSaida(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch { /* sem a CLI ou sem o Supabase local de pé */ }
  }
  st ??= {};
  const cfg = {
    dbUrl: st.DB_URL ?? process.env.DB_URL,
    apiUrl: st.API_URL ?? process.env.API_URL,
    jwtSecret: st.JWT_SECRET ?? process.env.JWT_SECRET,
    publishableKey: st.PUBLISHABLE_KEY ?? process.env.PUBLISHABLE_KEY,
  };
  if (!cfg.dbUrl) throw new Error('Supabase local não encontrado: rode "supabase start" (ou defina DB_URL).');
  for (const [k, v] of Object.entries({ dbUrl: cfg.dbUrl, apiUrl: cfg.apiUrl })) {
    if (v && !ehDestaMaquina(v)) {
      throw new Error(`${k} não é desta máquina (${v.replace(/\/\/[^@/]*@/, '//***@')}): os testes do banco só rodam no Supabase local.`);
    }
  }
  return cfg;
}

/**
 * Endereço desta máquina (127.0.0.1, localhost ou [::1]) e SEM parâmetro que troque o servidor de verdade: o pacote
 * "pg" dá prioridade a host=, hostaddr= e service= da query (ex.: ...@127.0.0.1/postgres?host=db.<projeto>.supabase.co
 * iria para a produção). Um túnel local para a produção passaria daqui: quem pega isso é a conferência de conectar().
 */
export function ehDestaMaquina(endereco) {
  let u;
  try { u = new URL(endereco); } catch { return false; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return false;
  for (const p of u.searchParams.keys()) if (['host', 'hostaddr', 'service'].includes(p.toLowerCase())) return false;
  return true;
}

/* ===================== Tokens (JWT HS256, assinados com o segredo do banco local) ===================== */

const b64url = (obj) => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');

export function jwt(claims, segredo, { validadeS = 3600 } = {}) {
  if (!segredo) throw new Error('Sem o segredo dos tokens do Supabase local (JWT_SECRET).');
  const agora = Math.floor(Date.now() / 1000);
  const corpo = { iat: agora, exp: agora + validadeS, ...claims };
  const base = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(corpo)}`;
  return `${base}.${createHmac('sha256', segredo).update(base).digest('base64url')}`;
}

/**
 * Token do papel anon, assinado aqui com o segredo do Supabase local. O site NÃO manda mais token de visitante (fase
 * 0.1: visitante vai só com a chave publishable no "apikey"); fica para algum teste que precise do papel num token.
 */
export const tokenAnon = (cfg) => jwt({ role: 'anon', iss: 'supabase' }, cfg.jwtSecret);

/** Pessoa logada pelo link do e-mail (amr "otp"), como o Auth emite. */
export const tokenUsuario = (cfg, { sub, email }) => jwt({
  role: 'authenticated', aud: 'authenticated', iss: 'supabase', sub, email,
  amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) }],
}, cfg.jwtSecret);

/* ===================== Postgres ===================== */

let pgMod = null;
export async function carregarPg() {
  if (pgMod) return pgMod;
  try {
    pgMod = (await import('pg')).default;
  } catch {
    throw new Error('Falta o pacote "pg": rode "npm ci --prefix tests/banco --ignore-scripts" na pasta do repositório.');
  }
  return pgMod;
}

const bancosConferidos = new Set();

/**
 * Conexão direta. Na primeira conexão com cada banco, confere que ele NÃO tem dados da produção: banco novo (CI,
 * cópia local) não tem nenhuma importação do CNES (public.establishment_imports vazia; a produção tem centenas).
 * Assim, nem um túnel local para a produção deixa os scripts gravarem clínicas e pedidos de teste lá.
 */
export async function conectar(conexao, nome = 'imed-teste') {
  const pg = await carregarPg();
  const opcoes = typeof conexao === 'string' ? { connectionString: conexao } : { ...conexao };
  const c = new pg.Client({ ...opcoes, application_name: nome, connectionTimeoutMillis: 15000 });
  await c.connect();
  c.on('error', () => {}); // conexão derrubada no meio de um teste não derruba o processo
  const chave = typeof conexao === 'string' ? conexao : `${conexao.host}:${conexao.port}/${conexao.database}`;
  if (!bancosConferidos.has(chave)) {
    try {
      const { rows: [t] } = await c.query(`select to_regclass('public.establishment_imports') is not null as tem`);
      if (t.tem) {
        const { rows: [r] } = await c.query('select exists (select 1 from public.establishment_imports) as producao');
        if (r.producao) {
          throw new Error('este banco tem importações do CNES (public.establishment_imports): parece a PRODUÇÃO, '
            + 'e os testes só rodam num banco novo (Supabase local)');
        }
      }
    } catch (e) {
      await c.end().catch(() => {});
      throw e;
    }
    bancosConferidos.add(chave);
  }
  return c;
}

/**
 * Roda `n` transações que partem juntas. Cada uma abre a transação, espera na barreira
 * (pg_advisory_xact_lock_shared enquanto o coordenador segura pg_advisory_lock da mesma chave), chama
 * `trabalho(cliente, i)` e faz COMMIT; erro faz ROLLBACK e é guardado com o código do Postgres.
 * O tempo de cada uma conta da saída da barreira até o fim do COMMIT (sem a abertura da conexão).
 */
export async function rodarJuntos({ conexao, n, trabalho, chave = 424242, limiteEsperaMs = 60000 }) {
  const coord = await conectar(conexao, 'imed-coordenador');
  await coord.query('select pg_advisory_lock($1::bigint)', [chave]);
  const clientes = [];
  try {
    for (let i = 0; i < n; i += 20) {
      clientes.push(...await Promise.all(Array.from({ length: Math.min(20, n - i) }, (_, k) => conectar(conexao, `imed-trabalho-${i + k}`))));
    }
    const resultados = new Array(n);
    const corridas = clientes.map(async (c, i) => {
      let t0 = 0;
      try {
        await c.query('begin');
        await c.query('select pg_advisory_xact_lock_shared($1::bigint)', [chave]);
        t0 = performance.now();
        const valor = await trabalho(c, i);
        await c.query('commit');
        resultados[i] = { ok: valor !== false, valor, ms: performance.now() - t0 };
      } catch (e) {
        const ms = t0 ? performance.now() - t0 : 0;
        try { await c.query('rollback'); } catch { /* conexão perdida */ }
        resultados[i] = { ok: false, code: e.code ?? 'sem_codigo', message: e.message, ms };
      }
    });
    // Solta a barreira só quando todas estão esperando nela.
    const limite = performance.now() + limiteEsperaMs;
    for (;;) {
      const { rows } = await coord.query(
        `select count(*)::int as n from pg_locks
          where locktype = 'advisory' and classid::bigint = 0 and objid::bigint = $1::bigint and objsubid = 1
            and not granted`, [chave % 4294967296]);
      if (rows[0].n >= n) break;
      if (performance.now() > limite) throw new Error(`só ${rows[0].n} de ${n} transações chegaram à barreira em ${limiteEsperaMs} ms`);
      await new Promise((r) => setTimeout(r, 20));
    }
    const solta = performance.now();
    await coord.query('select pg_advisory_unlock($1::bigint)', [chave]);
    await Promise.all(corridas);
    return { resultados, totalMs: performance.now() - solta };
  } finally {
    await Promise.all(clientes.map((c) => c.end().catch(() => {})));
    await coord.end().catch(() => {});
  }
}

/* ===================== Números ===================== */

export function percentil(valores, p) {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

/** Resumo de uma rodada: quantas deram certo, erros por código e tempos (ms). */
export function estatisticas(resultados) {
  const porCodigo = {};
  for (const r of resultados) if (!r.ok && r.code) porCodigo[r.code] = (porCodigo[r.code] ?? 0) + 1;
  const ms = resultados.map((r) => r.ms);
  return {
    total: resultados.length,
    ok: resultados.filter((r) => r.ok).length,
    porCodigo,
    p50: Math.round(percentil(ms, 50)),
    p95: Math.round(percentil(ms, 95)),
    max: Math.round(Math.max(0, ...ms.filter(Number.isFinite))),
  };
}

export const textoCodigos = (porCodigo) =>
  Object.keys(porCodigo).length ? Object.entries(porCodigo).map(([k, v]) => `${v}× ${k}`).join(', ') : 'nenhum erro';

/* ===================== HTTP no PostgREST local ===================== */

// A regra dos cabeçalhos do PRÓPRIO site (IMED_CONFIG.supabaseHeaders, em assets/js/config.js), carregada daqui num
// navegador de mentira (node:vm), com a chave publishable do Supabase LOCAL no lugar da de produção.
let regraDoSite = null;
/**
 * Cabeçalhos exatamente como o site manda: "apikey" com a chave publishable sempre; "Authorization: Bearer" só com o
 * token de quem entrou na conta (sem token = visitante, sem Authorization). `extra`: Content-Type, Prefer...
 */
export function cabecalhosDoSite(cfg, token, extra) {
  if (!cfg.publishableKey) {
    throw new Error('Sem a chave publishable do Supabase local (PUBLISHABLE_KEY de "supabase status -o json").');
  }
  if (!regraDoSite) {
    const g = {};
    g.window = g;
    vm.createContext(g);
    vm.runInContext(readFileSync(new URL('../../assets/js/config.js', import.meta.url), 'utf8'), g);
    regraDoSite = g.IMED_CONFIG;
    if (typeof regraDoSite?.supabaseHeaders !== 'function') throw new Error('assets/js/config.js sem IMED_CONFIG.supabaseHeaders');
  }
  regraDoSite.supabaseKey = cfg.publishableKey;
  return { ...regraDoSite.supabaseHeaders(token ?? null, extra) };
}

/**
 * Chamada no PostgREST local como o site faz (cabecalhosDoSite): visitante sem `token` (só a chave publishable no
 * "apikey"); paciente logado com `token` (o JWT dele em "Authorization: Bearer"). Devolve status, código do erro e
 * tempo. `prefer: null` não manda o cabeçalho Prefer (chamada de função, rpc/...).
 */
export async function postgrest(cfg, caminho, { token, metodo = 'POST', corpo, prefer = 'return=minimal' } = {}) {
  const t0 = performance.now();
  const resp = await fetch(`${cfg.apiUrl}/rest/v1/${caminho}`, {
    method: metodo,
    headers: cabecalhosDoSite(cfg, token, { 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }),
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resp.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta sem JSON */ }
  return { status: resp.status, ok: resp.ok, code: json?.code, message: json?.message ?? texto.slice(0, 300), json, ms: performance.now() - t0 };
}

/* ===================== Agenda: clínica de teste (fase 3.3) ===================== */

/**
 * Roda `sql` como a pessoa logada (role authenticated + request.jwt.claims, como o PostgREST faz), numa transação
 * própria. Devolve a primeira coluna da primeira linha.
 */
export async function comoUsuario(db, { sub, email }, sql, params = []) {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`,
      [JSON.stringify({ role: 'authenticated', aud: 'authenticated', sub, email, amr: [{ method: 'otp', timestamp: 1 }] })]);
    const { rows } = await db.query(sql, params);
    await db.query('commit');
    return rows[0] ? Object.values(rows[0])[0] : undefined;
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  }
}

/** O feriado nacional que criarClinicaAgenda lançou para cada clínica de teste (limparClinicaAgenda o tira). */
const feriadosDosTestes = new Map();

/**
 * Cria uma clínica de teste na agenda nova, pelas funções de verdade (como a dona), com a venda online ligada (marca
 * de emergência, registrada: nenhuma função liga antes da 5.1). `recursos`: [{ chave, kind, name, capacity }];
 * `procedimentos`: [{ chave, exam_code, name, duration_min, step_min, price_cents, grupos: [[chaves dos recursos], ...] }].
 * Aberta todos os dias, o dia inteiro (também nos feriados: os dias dos testes são relativos a hoje e não podem cair
 * num feriado nacional lançado por migração), sem antecedência mínima, de 5 em 5 minutos. Devolve { recursos, procedimentos }.
 */
export async function criarClinicaAgenda(db, { clinica, dona, email, nome, recursos, procedimentos }) {
  await db.query(`insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
                  values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
                          '{"provider": "email", "providers": ["email"]}', '{}', now(), now())`, [dona, email]);
  await db.query(`insert into public.clinics (id, name, kind, address_line, city, state, location, status, accepts_online_booking, is_demo)
                  values ($1, $2, 'imagem', 'Rua do Teste da Agenda, 1', 'São Paulo', 'SP',
                          extensions.st_setsrid(extensions.st_makepoint(-46.63, -23.55), 4326)::extensions.geography, 'published', true, false)`,
  [clinica, nome]);
  await db.query(`insert into public.clinic_members (clinic_id, user_id, role) values ($1, $2, 'owner')`, [clinica, dona]);
  // O motor só oferece horário até o fim do ano do último feriado nacional: lança o 1º/1 do ano que vem, se faltar, e
  // limparClinicaAgenda o tira de novo. Se ficasse, a volta da migração dos feriados nacionais recusaria (a partir de
  // 2027, ele manteria abertos os dias que ela retira).
  const feriado = await db.query(`insert into agenda.holidays (scope, day, name, source)
                  select 'nacional', make_date(extract(year from now())::integer + 1, 1, 1), 'Confraternização Universal', 'Lei 662/1949'
                  where not exists (select 1 from agenda.holidays where scope = 'nacional' and day = make_date(extract(year from now())::integer + 1, 1, 1))
                  returning id`);
  if (feriado.rows[0]) feriadosDosTestes.set(clinica, feriado.rows[0].id);
  const u = { sub: dona, email };
  const status = (j, o) => { if (j?.status !== 'ok') throw new Error(`${o}: ${JSON.stringify(j)}`); return j; };
  status(await comoUsuario(db, u, `select public.agenda_unit_save($1, jsonb_build_object('holidays_checked_until', current_date + 300,
                                     'min_notice_min', 0, 'step_min', 5, 'max_advance_days', 365, 'closes_on_holidays', false))`, [clinica]), 'unidade');
  const rec = {};
  for (const r of recursos) {
    rec[r.chave] = status(await comoUsuario(db, u, 'select public.agenda_resource_save($1, $2)',
      [clinica, JSON.stringify({ kind: r.kind ?? 'equipamento', name: r.name, capacity: r.capacity ?? 1 })]), r.name).id;
  }
  const proc = {};
  for (const p of procedimentos) {
    proc[p.chave] = status(await comoUsuario(db, u, 'select public.agenda_procedure_save($1, $2)', [clinica, JSON.stringify({
      exam_code: p.exam_code ?? 'usg', name: p.name, duration_min: p.duration_min, step_min: p.step_min ?? 5,
      price_cents: p.price_cents,   // sem preço = "sob consulta" (os testes do pagamento dão preço de exemplo)
      requirements: p.grupos.map((g) => ({
        resource_kind: recursos.find((r) => r.chave === g[0]).kind ?? 'equipamento',
        options: g.map((k, i) => ({ resource_id: rec[k], priority: i + 1 })),
      })),
    })]), p.name).id;
  }
  const regras = Array.from({ length: 7 }, (_, d) => ({ weekday: d, start: '00:00', end: '24:00' }));
  status(await comoUsuario(db, u, 'select public.agenda_rules_set($1, null, $2)', [clinica, JSON.stringify(regras)]), 'regras');
  await db.query('begin');
  await db.query(`select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'teste_ci', true)`);
  await db.query(`update public.clinics set agenda_mode = 'nativa', timezone_confirmed_at = now(), agenda_online_since = now() where id = $1`, [clinica]);
  await db.query('commit');
  return { recursos: rec, procedimentos: proc };
}

/** Apaga a clínica de teste e tudo dela (pedidos, ocupação, "ocupados", bloqueios), com a marca de emergência. */
export async function limparClinicaAgenda(db, { clinica, dona }) {
  await db.query('begin');
  await db.query(`select set_config('imed.origin', 'sql', true), set_config('imed.reason', 'limpeza_teste_ci', true)`);
  await db.query('delete from public.appointment_requests where clinic_id = $1', [clinica]);
  await db.query('delete from agenda.occupancy where clinic_id = $1', [clinica]);
  await db.query('delete from agenda.busy_marks where clinic_id = $1', [clinica]);
  await db.query('delete from public.clinic_blocks where clinic_id = $1', [clinica]);
  if (feriadosDosTestes.has(clinica)) {
    await db.query('delete from agenda.holidays where id = $1', [feriadosDosTestes.get(clinica)]);
    feriadosDosTestes.delete(clinica);
  }
  await db.query('commit');
  await db.query('delete from public.clinics where id = $1', [clinica]);
  if (dona) await db.query('delete from auth.users where id = $1', [dona]);
}

/** Horário de São Paulo (sem horário de verão) de daqui a `dias` dias: "HH:MM" → ISO. */
export function horaSP(dias, hhmm) {
  const d = new Date(Date.now() + dias * 86400000 - 3 * 3600000).toISOString().slice(0, 10);
  return new Date(`${d}T${hhmm}:00-03:00`).toISOString();
}

/**
 * Oráculo da regra fundamental (§3.1), sem olhar a vaga: por recurso, o máximo de usos ativos ao mesmo tempo não passa
 * da capacidade, e nenhum uso ativo cruza um fechamento ativo. Devolve as violações (lista vazia = tudo certo).
 */
export async function violacoesAgenda(db, clinica) {
  const { rows } = await db.query(`
    with usos as (
      select o.resource_id, o.during from agenda.occupancy o where o.clinic_id = $1 and o.active and o.kind <> 'bloqueio'
    ), pico as (
      select u.resource_id, (select count(*) from usos x where x.resource_id = u.resource_id and x.during @> lower(u.during)) as n
      from usos u
    )
    select 'capacidade: ' || r.name || ' com ' || max(p.n) || ' ao mesmo tempo (capacidade ' || r.capacity || ')' as v
    from pico p join agenda.resources r on r.id = p.resource_id group by r.id, r.name, r.capacity having max(p.n) > r.capacity
    union all
    select 'fechamento: uso ' || u.id || ' dentro do bloqueio ' || b.id
    from agenda.occupancy u join agenda.occupancy b on b.resource_id = u.resource_id and b.kind = 'bloqueio' and b.active
    where u.clinic_id = $1 and u.active and u.kind <> 'bloqueio' and u.during && b.during`, [clinica]);
  return rows.map((r) => r.v);
}
