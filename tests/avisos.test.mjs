// Avisos e lembretes da agenda (iMed Agenda 5.3): as regras da tela (agenda-core.js) e o que elas têm de combinar com o
// banco (migração agenda_avisos) e com a função do servidor. Rodar com: node --test tests/avisos.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../assets/js/agenda-core.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const MIG = read(`supabase/migrations/${readdirSync(join(ROOT, 'supabase/migrations')).find((f) => f.endsWith('_agenda_avisos.sql'))}`);
const lista = (re) => [...MIG.match(re)[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
const TZ = 'America/Sao_Paulo';

test('a tela conhece todo evento, situação e canal que o banco aceita (nada aparece como código)', () => {
  const eventos = lista(/event_type text not null check \(event_type in \(([^)]+)\)\),\n  channel/);
  const situacoes = lista(/status text not null default 'agendada' check \(status in \(([^)]+)\)\)/);
  const canais = lista(/channel text not null check \(channel in \(([^)]+)\)\),\n  recipient_kind/);
  assert.equal(eventos.length, 9);
  assert.deepEqual(Object.keys(A.NOTIFY_EVENT).sort(), [...eventos].sort());
  assert.deepEqual(Object.keys(A.NOTIFY_STATUS).sort(), [...situacoes].sort());
  assert.deepEqual(Object.keys(A.NOTIFY_CHANNEL).sort(), [...canais].sort());
  assert.deepEqual(Object.keys(A.NOTIFY_RECIPIENT).sort(), ['clinica', 'paciente']);
  for (const t of [...Object.values(A.NOTIFY_EVENT), ...Object.values(A.NOTIFY_STATUS)]) assert.doesNotMatch(t, /_/, t);
});

test('a tela nunca chama de enviado o que não saiu', () => {
  for (const [k, t] of Object.entries(A.NOTIFY_STATUS)) {
    if (k === 'enviada') assert.equal(t, 'Enviado');
    else assert.doesNotMatch(t, /^Enviado\b/, `${k}: ${t}`);
  }
  for (const k of ['sem_canal', 'sem_consentimento', 'sem_contato']) assert.match(A.NOTIFY_STATUS[k], /^Não enviado: /, k);
  assert.equal(A.NOTIFY_STATUS.sem_canal, 'Não enviado: o envio de avisos ainda não está ligado');
  assert.equal(A.NOTIFY_STATUS.agendada, 'Preparado', 'o que ainda vai sair está só preparado');
});

test('as escolhas da clínica são as mesmas 4 do banco, na mesma ordem', () => {
  const doBanco = [...MIG.match(/create or replace function private\.agenda_notify_choices\(\)[\s\S]*?as \$\$\n([\s\S]*?)\$\$;/)[1]
    .matchAll(/\((\d), '([a-z0-9_]+)'(?:::text)?, '([a-z]+)'(?:::text)?\)/g)].map((m) => `${m[2]}|${m[3]}`);
  assert.deepEqual(A.NOTIFY_CHOICES.map((c) => `${c.event_type}|${c.recipient_kind}`), doBanco);
  assert.deepEqual(doBanco, ['lembrete_24h|paciente', 'lembrete_2h|paciente', 'confirmado|clinica', 'cancelado|clinica']);
  for (const c of A.NOTIFY_CHOICES) assert.ok(c.label.length > 10 && c.help.length > 10, c.event_type);
  // o que o paciente sempre recebe não está entre as escolhas (a restrição da tabela também recusa)
  assert.match(MIG, /recipient_kind = 'paciente' and event_type in \('lembrete_24h', 'lembrete_2h'\)/);
  assert.match(A.NOTIFY_ALWAYS, /confirmação, cancelamento, remarcação/);
});

test('normalizeNotifyConfig: só as escolhas conhecidas, na ordem da tela; resposta estranha = nada', () => {
  for (const ruim of [null, undefined, 'x', [], { status: 'forbidden' }, { rules: [] }]) assert.equal(A.normalizeNotifyConfig(ruim), null);
  const d = A.normalizeNotifyConfig({ status: 'ok', sending: 'sim', clinic_email: true, rules: [
    { event_type: 'cancelado', recipient_kind: 'clinica', enabled: true }, { event_type: 'lembrete_24h', recipient_kind: 'paciente', enabled: false },
    { event_type: 'confirmado', recipient_kind: 'paciente', enabled: false }, null, 'x', { event_type: 'lembrete_2h', recipient_kind: 'paciente', enabled: 'true' }] });
  assert.equal(d.sending, false, 'só o verdadeiro de verdade liga');
  assert.equal(d.clinicEmail, true);
  assert.deepEqual(d.rules.map((r) => [r.event_type, r.recipient_kind, r.enabled]),
    [['lembrete_24h', 'paciente', false], ['lembrete_2h', 'paciente', false], ['cancelado', 'clinica', true]]);
  assert.deepEqual(A.normalizeNotifyConfig({ status: 'ok' }), { sending: false, clinicEmail: false, rules: [] });
});

test('notifyRulesPayload: só o que o banco aceita (evento, destinatário e sim/não)', () => {
  assert.deepEqual(A.notifyRulesPayload([
    { event_type: 'lembrete_2h', recipient_kind: 'paciente', enabled: false, label: 'x', help: 'y', channel: 'sms' },
    { event_type: 'confirmado', recipient_kind: 'paciente', enabled: false }, { event_type: 'confirmado', recipient_kind: 'clinica', enabled: 1 }, null]),
  [{ event_type: 'lembrete_2h', recipient_kind: 'paciente', enabled: false }, { event_type: 'confirmado', recipient_kind: 'clinica', enabled: false }]);
  assert.deepEqual(A.notifyRulesPayload(null), []);
  // as chaves são as que agenda_notify_config_set aceita (a função recusa chave estranha)
  assert.match(MIG, /private\.agenda_unknown_keys\(e\.value, array\['event_type', 'recipient_kind', 'enabled'\]\)/);
});

test('normalizeNotifyList: cada aviso com o evento, para quem e a situação por extenso, no fuso da clínica', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-04T13:00:00Z') });
  for (const ruim of [null, {}, { status: 'forbidden' }]) assert.equal(A.normalizeNotifyList(ruim, TZ), null);
  const d = A.normalizeNotifyList({ status: 'ok', sending: true, items: [
    { event_type: 'confirmado', channel: 'email', recipient_kind: 'paciente', send_after: '2026-11-03T15:00:00Z', notification_status: 'enviada', sent_at: '2026-11-03T15:00:20Z', to: 'x@exemplo.test' },
    { event_type: 'lembrete_2h', channel: 'email', recipient_kind: 'paciente', send_after: '2026-11-04T18:00:00Z', notification_status: 'agendada' },
    { event_type: 'lembrete_24h', channel: 'email', recipient_kind: 'paciente', send_after: '2026-11-04T12:00:00Z', notification_status: 'agendada' },
    { event_type: 'cancelado', channel: 'pombo', recipient_kind: 'clinica', notification_status: 'situacao_nova' },
    { event_type: 'evento_novo', channel: 'email', recipient_kind: 'paciente', notification_status: 'enviada' }, null] }, TZ);
  assert.equal(d.sending, true);
  assert.deepEqual(d.items, [
    { event: 'Confirmação do agendamento', to: 'Paciente · E-mail', status: 'Enviado em ter., 03/11 às 12:00', tone: 'ok' },
    { event: 'Lembrete de 2 horas antes', to: 'Paciente · E-mail', status: 'Preparado para qua., 04/11 às 15:00', tone: 'info' },
    { event: 'Lembrete de 24 horas antes', to: 'Paciente · E-mail', status: 'Preparado aguardando a vez', tone: 'info' },
    { event: 'Aviso de cancelamento', to: 'Clínica', status: 'Situação desconhecida', tone: 'warn' },
  ], 'evento que a tela não conhece não aparece; situação desconhecida não vira "enviado"; nenhum destino');
  assert.equal(A.normalizeNotifyList({ status: 'ok', items: [{ event_type: 'confirmado', channel: 'email', recipient_kind: 'paciente', notification_status: 'sem_canal' }] }, 'America/Manaus').items[0].tone, 'warn');
});

test('o painel: as funções dos avisos, sem guardar nada no aparelho; banco de antes não quebra a configuração', () => {
  const cfg = read('assets/js/agenda-config.js');
  assert.match(cfg, /rpc\('agenda_notify_config', \{ p_clinic: cid \}\)\.catch\(\(\) => null\)/);
  assert.match(cfg, /rpc\('agenda_notify_config_set', \{ p_clinic: cid, p_rules: rules \}\)/);
  assert.match(cfg, /O envio de avisos ainda não está ligado pelo IMED: hoje nenhum aviso é enviado\./);
  const ag = read('assets/js/agenda.js');
  assert.match(ag, /call\('agenda_notify_list', \{ p_request: S\.det\.id \}\)/);
  for (const [f, t] of [['agenda-config.js', cfg], ['agenda.js', ag]]) assert.doesNotMatch(t.slice(t.indexOf('avisos e lembretes')), /localStorage\.setItem\([^)]*(nt|aviso)/i, f);
  // toda função chamada pelas telas existe na migração, só para quem está logado
  for (const fn of ['agenda_notify_config(uuid)', 'agenda_notify_config_set(uuid, jsonb)', 'agenda_notify_list(uuid)']) {
    assert.ok(MIG.includes(`revoke all on function public.${fn} from public, anon, authenticated;\ngrant execute on function public.${fn} to authenticated;`), fn);
  }
});

test('o banco: o envio nasce desligado, a fila é só do servidor e a tabela não guarda destino', () => {
  assert.match(MIG, /\('avisos\.envio_ligado'::text, 0, 0, 1\)/);
  for (const fn of ['agenda_notify_claim(integer)', 'agenda_notify_done(uuid, text, text, text)']) {
    assert.ok(MIG.includes(`revoke all on function public.${fn} from public, anon, authenticated;\ngrant execute on function public.${fn} to service_role;`), fn);
  }
  assert.equal((MIG.match(/if coalesce\(auth\.role\(\), ''\) <> 'service_role' then return jsonb_build_object\('status', 'forbidden'\); end if;/g) || []).length, 2, 'e as duas conferem de novo por dentro');
  const tabela = MIG.slice(MIG.indexOf('create table if not exists agenda.notifications ('), MIG.indexOf('create index if not exists notifications_fila_idx'));
  const colunas = [...tabela.matchAll(/^  ([a-z_]+) (?:uuid|text|timestamptz|smallint)\b/gm)].map((m) => m[1]);
  assert.deepEqual(colunas, ['id', 'request_id', 'clinic_id', 'event_type', 'channel', 'recipient_kind', 'send_after', 'slot_start', 'status', 'attempts',
    'next_try_at', 'claimed_at', 'last_error', 'provider_message_id', 'created_at', 'sent_at', 'closed_at'], 'sem coluna de e-mail, telefone, nome ou destino');
  assert.match(tabela, /last_error text check \(last_error is null or last_error ~ '\^\[a-z0-9_\.:-\]\{1,60\}\$'\)/, 'o erro é um código, nunca texto livre');
  assert.match(MIG, /exception when others then\n    raise warning 'agenda_notify_request: avisos não preparados/, 'erro ao preparar o aviso não derruba a marcação');
  assert.match(MIG, /NOME PROVISÓRIO, AINDA NÃO APLICADA NA PRODUÇÃO/);
});

test('a função do servidor: não publicada, com o roteiro de ligar; resposta só com contagens', () => {
  const idx = read('supabase/functions/agenda-saida/index.ts');
  assert.match(idx, /NÃO ESTÁ PUBLICADA/);
  assert.match(idx, /rpc\('check_internal_token', \{ p_name: 'agenda_saida', p_token: tok \}\)/, 'o token interno é o mesmo nome que o cron do banco usa');
  assert.match(MIG, /from private\.app_tokens t where t\.name = 'agenda_saida'/);
  assert.match(MIG, /url := v_base \|\| '\/agenda-saida'/);
  assert.match(MIG, /body := jsonb_build_object\('action', 'enviar'\)/);
  assert.match(idx, /if \(body\?\.action !== 'enviar'\) return json\(\{ ok: false, error: 'invalid_action' \}, 400\);/);
  assert.match(idx, /return json\(\{ ok: true, status, canais: Object\.keys\(canais\), \.\.\.total \}\);/);
  assert.doesNotMatch(idx, /console\.(log|info|debug)\(/, 'nada de destino ou aviso no log');
  // os resultados que a função manda são os que o banco aceita
  assert.match(MIG, /p_result not in \('enviada', 'sem_canal', 'sem_contato', 'falhou'\)/);
  assert.match(read('supabase/functions/agenda-saida/lib.ts'), /export type Resultado = 'enviada' \| 'sem_canal' \| 'sem_contato' \| 'falhou';/);
});

test('o site do paciente não promete lembrete enquanto o envio está desligado', () => {
  for (const f of ['local.html', 'conta.html', 'index.html', 'como-funciona.html', 'assets/js/local.js', 'assets/js/local-pacote.js', 'assets/js/conta.js']) {
    assert.doesNotMatch(read(f), /(vamos|você vai|enviaremos|enviamos|receberá|vai receber)[^.<]{0,60}(lembrete|aviso por e-mail|e-mail de confirmação)/i, f);
  }
});
