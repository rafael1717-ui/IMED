// Atualização automática do painel (assets/js/tempo-real.js; iMed Agenda, fase 4.3): lógica pura, com relógio e
// WebSocket falsos — quando recarregar (só versão mais nova), a rajada de avisos virando uma recarga (debounce), a
// reconexão em 1/2/5/10 s, o token reenviado, a pausa com a aba escondida e a consulta periódica como plano B.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../assets/js/tempo-real.js';

const ler = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));

function fakeTimers() {
  let now = 0; let seq = 0; const q = new Map();
  return {
    setTimeout(fn, ms) { const id = ++seq; q.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { q.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...q.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        q.delete(next[0]); now = next[1].at; next[1].fn();
        await flush(); await flush();
      }
      now = end;
      await flush();
    },
    get pending() { return q.size; },
    get now() { return now; },
  };
}
function fakeDoc() {
  const l = new Set();
  return { hidden: false, visibilityState: 'visible', addEventListener: (t, f) => l.add(f), removeEventListener: (t, f) => l.delete(f), fire() { l.forEach((f) => f()); }, get n() { return l.size; } };
}
function fakeWin() {
  const l = new Map();
  return {
    addEventListener: (t, f) => l.set(t, f), removeEventListener: (t) => l.delete(t),
    fire(t, detail) { l.get(t)?.({ detail }); }, get n() { return l.size; },
  };
}
// Um WebSocket falso: guarda as instâncias criadas; o teste abre, responde e derruba quando quiser.
function fakeWS() {
  const all = [];
  class WS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; all.push(this); }
    send(s) { this.sent.push(JSON.parse(s)); }
    close() { this.readyState = 3; }
    // o teste: abre; responde ao phx_join; manda um aviso; derruba
    open() { this.readyState = 1; this.onopen?.(); }
    reply(status = 'ok') { const j = this.sent.find((m) => m.event === 'phx_join'); this.onmessage?.({ data: JSON.stringify({ topic: j.topic, event: 'phx_reply', ref: j.ref, payload: { status, response: {} } }) }); }
    aviso(v, topic = this.sent.find((m) => m.event === 'phx_join')?.topic) { this.onmessage?.({ data: JSON.stringify({ topic, event: 'broadcast', payload: { event: 'agenda', payload: { v }, type: 'broadcast' } }) }); }
    drop() { this.readyState = 3; this.onclose?.(); }
  }
  return { WS, all };
}
const C = 'cccccccc-0000-4000-8000-000000000001';

test('endereço, tópico, entrada no canal e aviso: o que a arquitetura (§7) descreve', () => {
  assert.equal(R.wsUrl('https://pyoqiecupxhdzigjudyd.supabase.co', 'sb_publishable_x'), 'wss://pyoqiecupxhdzigjudyd.supabase.co/realtime/v1/websocket?apikey=sb_publishable_x&vsn=1.0.0');
  assert.equal(R.wsUrl('https://x.supabase.co/', 'a b'), 'wss://x.supabase.co/realtime/v1/websocket?apikey=a%20b&vsn=1.0.0');
  assert.equal(R.topicOf(C), `realtime:agenda:clinica:${C}`);
  assert.deepEqual(R.joinPayload('tok-1'), { config: { broadcast: { self: false, ack: false }, presence: { enabled: false }, private: true }, access_token: 'tok-1' });
  const t = R.topicOf(C);
  assert.equal(R.parseAviso({ topic: t, event: 'broadcast', payload: { event: 'agenda', payload: { v: 12 }, type: 'broadcast' } }, t), 12);
  assert.equal(R.parseAviso(JSON.stringify({ topic: t, event: 'broadcast', payload: { event: 'agenda', payload: { v: '13', id: 'x' } } }), t), 13);
  assert.equal(R.parseAviso({ topic: 'realtime:agenda:clinica:outra', event: 'broadcast', payload: { event: 'agenda', payload: { v: 1 } } }, t), null, 'outro tópico');
  assert.equal(R.parseAviso({ topic: t, event: 'broadcast', payload: { event: 'outro', payload: { v: 1 } } }, t), null, 'outro evento');
  assert.equal(R.parseAviso({ topic: t, event: 'phx_reply', payload: {} }, t), null);
  assert.equal(R.parseAviso('não é json', t), null);
  assert.equal(R.parseAviso({ topic: t, event: 'broadcast', payload: { event: 'agenda', payload: { v: 'x' } } }, t), null);
});

test('quando recarregar: só com versão mais nova que a conhecida', () => {
  assert.equal(R.shouldReload(null, 7), true, 'sem versão conhecida: a primeira vale');
  assert.equal(R.shouldReload(7, 8), true);
  assert.equal(R.shouldReload(7, 7), false, 'a mesma versão não recarrega');
  assert.equal(R.shouldReload(7, 6), false, 'aviso atrasado não recarrega');
  assert.equal(R.shouldReload(7, 'x'), false);
  assert.equal(R.shouldReload(7, null), false);
});

test('reconexão: 1, 2, 5 e 10 s, e fica em 10 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(R.nextDelay), [1000, 2000, 5000, 10000, 10000, 10000]);
  assert.equal(R.nextDelay(-1), 1000);
  assert.equal(R.HEARTBEAT_MS, 25000);
  assert.equal(R.POLL_LIVE_MS, 15000);
  assert.equal(R.POLL_ALONE_MS, 5000);
});

test('canal: entra com o token, batimento a cada 25 s, aviso chega, token renovado é reenviado', async () => {
  const timers = fakeTimers();
  const { WS, all } = fakeWS();
  const avisos = []; const estados = [];
  const s = R.createSocket({ url: 'wss://x/realtime/v1/websocket', topic: R.topicOf(C), token: async () => 'tok-1', WS, timers, onAviso: (v) => avisos.push(v), onState: (e) => estados.push(e) });
  assert.equal(s.state, 'fechado');
  s.start();
  await flush();
  assert.equal(all.length, 1);
  assert.equal(s.state, 'conectando');
  all[0].open();
  const join = all[0].sent[0];
  assert.equal(join.event, 'phx_join');
  assert.equal(join.topic, R.topicOf(C));
  assert.equal(join.join_ref, join.ref);
  assert.deepEqual(join.payload, R.joinPayload('tok-1'));
  all[0].reply('ok');
  assert.equal(s.state, 'ao_vivo');
  all[0].aviso(8);
  all[0].aviso(9, 'realtime:agenda:clinica:outra');
  assert.deepEqual(avisos, [8], 'só o aviso do próprio tópico');
  await timers.advance(25000);
  assert.deepEqual(all[0].sent.filter((m) => m.event === 'heartbeat').map((m) => m.topic), ['phoenix'], 'batimento aos 25 s');
  await timers.advance(25000);
  assert.equal(all[0].sent.filter((m) => m.event === 'heartbeat').length, 2);
  s.setToken('tok-2');
  const at = all[0].sent.at(-1);
  assert.equal(at.event, 'access_token');
  assert.deepEqual(at.payload, { access_token: 'tok-2' });
  assert.deepEqual(estados, ['conectando', 'ao_vivo']);
  s.stop();
  assert.equal(s.state, 'fechado');
  assert.equal(all[0].readyState, 3, 'fechou o WebSocket');
  assert.equal(timers.pending, 0, 'sem batimento nem nova tentativa depois de parar');
});

test('canal: caiu → tenta de novo em 1, 2, 5, 10 s; ao entrar de novo, a contagem zera; sem token não conecta', async () => {
  const timers = fakeTimers();
  const { WS, all } = fakeWS();
  let tok = 'tok-1';
  const s = R.createSocket({ url: 'wss://x', topic: R.topicOf(C), token: async () => tok, WS, timers, onAviso: () => {} });
  s.start(); await flush();
  all[0].open(); all[0].reply('ok');
  all[0].drop();
  assert.equal(s.state, 'conectando');
  await timers.advance(999); assert.equal(all.length, 1);
  await timers.advance(1); assert.equal(all.length, 2, '1 s');
  all[1].drop();
  await timers.advance(2000); assert.equal(all.length, 3, '2 s');
  all[2].drop();
  await timers.advance(5000); assert.equal(all.length, 4, '5 s');
  all[3].drop();
  await timers.advance(10000); assert.equal(all.length, 5, '10 s');
  all[4].drop();
  await timers.advance(10000); assert.equal(all.length, 6, 'fica em 10 s');
  all[5].open(); all[5].reply('ok');
  assert.equal(s.state, 'ao_vivo');
  all[5].drop();
  await timers.advance(1000); assert.equal(all.length, 7, 'depois de entrar, a espera volta a 1 s');
  // o token renovado vale na próxima entrada
  s.setToken('tok-9');
  all[6].open();
  assert.equal(all[6].sent[0].payload.access_token, 'tok-9');
  // entrada recusada 3 vezes (token velho ou sem permissão): a espera cresce (2 s, 5 s) e depois fica em 1 min
  all[6].reply('error');
  await timers.advance(2000); assert.equal(all.length, 8, 'recusada: 2 s'); all[7].open(); all[7].reply('error');
  await timers.advance(5000); assert.equal(all.length, 9, 'recusada de novo: 5 s'); all[8].open(); all[8].reply('error');
  await timers.advance(59999); assert.equal(all.length, 9, '3 recusas: 1 min de espera');
  await timers.advance(1); assert.equal(all.length, 10);
  s.stop();
  // sem conta: não abre WebSocket
  tok = null;
  const { WS: WS2, all: all2 } = fakeWS();
  const s2 = R.createSocket({ url: 'wss://x', topic: R.topicOf(C), token: async () => tok, WS: WS2, timers });
  s2.start(); await flush();
  assert.equal(all2.length, 0);
  s2.stop();
  assert.equal(timers.pending, 0);
});

test('canal: a entrada sem resposta em 10 s derruba e tenta de novo; phx_error e system/error também', async () => {
  const timers = fakeTimers();
  const { WS, all } = fakeWS();
  const s = R.createSocket({ url: 'wss://x', topic: R.topicOf(C), token: async () => 'tok-1', WS, timers });
  s.start(); await flush();
  all[0].open();
  await timers.advance(10000);
  assert.equal(all[0].readyState, 3, 'sem resposta: fecha');
  await timers.advance(1000);
  assert.equal(all.length, 2);
  all[1].open(); all[1].reply('ok');
  all[1].onmessage({ data: JSON.stringify({ topic: R.topicOf(C), event: 'phx_error', payload: {} }) });
  assert.equal(s.state, 'conectando');
  await timers.advance(1000);
  all[2].open(); all[2].reply('ok');
  all[2].onmessage({ data: JSON.stringify({ topic: R.topicOf(C), event: 'system', payload: { status: 'error', message: 'Unauthorized' } }) });
  assert.equal(s.state, 'conectando');
  s.stop();
});

function vigia({ versions, socket = null, doc = fakeDoc(), win = fakeWin(), timers = fakeTimers() } = {}) {
  const changes = []; const states = []; const calls = [];
  const fv = () => { calls.push(1); return typeof versions === 'function' ? versions() : versions.shift(); };
  const reasons = [];
  const w = R.createWatcher({ clinicId: C, fetchVersion: async () => fv(), onChange: (v, r) => { changes.push(v); reasons.push(r); }, onState: (s) => states.push(s), socket, doc, win, timers });
  return { w, changes, reasons, states, calls, doc, win, timers };
}

test('vigia só com a consulta periódica: 5 s; a versão mudou → recarrega uma vez; a mesma versão não', async () => {
  let v = 7;
  const { w, changes, reasons, states, calls, timers } = vigia({ versions: () => v });
  w.start();
  await flush();
  assert.equal(calls.length, 1, 'confere na hora');
  assert.deepEqual(changes, [], 'a primeira versão só fica conhecida');
  assert.equal(states.at(-1).mode, 'consultando');
  assert.equal(R.vigiaDe(C), w, 'registrado para a tela perguntar o estado');
  await timers.advance(4999); assert.equal(calls.length, 1);
  await timers.advance(1); assert.equal(calls.length, 2, 'a cada 5 s');
  assert.deepEqual(changes, []);
  v = 8;
  await timers.advance(5000);
  assert.deepEqual(changes, [8], 'mudou: recarrega');
  assert.deepEqual(reasons, ['consulta']);
  await timers.advance(5000);
  assert.deepEqual(changes, [8], 'igual: não recarrega');
  v = 6;
  await timers.advance(5000);
  assert.deepEqual(changes, [8], 'versão mais velha (banco voltou?): ignorada');
  assert.equal(w.state.version, 8);
  w.stop();
  assert.equal(R.vigiaDe(C), null);
  assert.equal(timers.pending, 0);
  assert.equal(states.at(-1).mode, 'parado');
});

test('vigia: quem leu diz a versão (seen) e o aviso dessa versão não recarrega; rajada de avisos → uma recarga', async () => {
  const { w, changes, reasons, timers } = vigia({ versions: () => 7 });
  w.start(); await flush();
  w.seen(9);
  w.onAviso(8); w.onAviso(9);
  await timers.advance(300);
  assert.deepEqual(changes, [], 'avisos até a versão já lida não recarregam');
  w.onAviso(10); w.onAviso(12); w.onAviso(11);
  await timers.advance(299); assert.deepEqual(changes, []);
  await timers.advance(1);
  assert.deepEqual(changes, [12], 'a rajada vira uma recarga, com a maior versão');
  assert.deepEqual(reasons, ['aviso']);
  assert.equal(w.state.version, 12);
  w.stop();
});

test('vigia: recarga em andamento quando chega outra versão → recarrega de novo no fim (uma vez só)', async () => {
  let resolve;
  const changes = [];
  const timers = fakeTimers();
  const w = R.createWatcher({ clinicId: C, fetchVersion: async () => 1, onChange: (v) => { changes.push(v); return new Promise((r) => { resolve = r; }); }, doc: fakeDoc(), win: fakeWin(), timers });
  w.start(); await flush();
  w.onAviso(2); await timers.advance(300);
  assert.deepEqual(changes, [2]);
  w.onAviso(3); await timers.advance(300);
  w.onAviso(4); await timers.advance(300);
  assert.deepEqual(changes, [2], 'espera a recarga acabar');
  resolve(); await flush(); await flush();
  assert.deepEqual(changes, [2, 4], 'uma recarga só, com a última versão');
  resolve(); await flush();
  w.stop();
});

test('vigia: aba escondida pausa tudo; ao voltar, confere na hora', async () => {
  let v = 7;
  const { w, changes, reasons, states, calls, doc, timers } = vigia({ versions: () => v });
  w.start(); await flush();
  doc.hidden = true; doc.visibilityState = 'hidden'; doc.fire();
  assert.equal(states.at(-1).mode, 'pausado');
  const n = calls.length;
  await timers.advance(60000);
  assert.equal(calls.length, n, 'escondida: nenhuma consulta');
  v = 9;
  doc.hidden = false; doc.visibilityState = 'visible'; doc.fire();
  await flush();
  assert.equal(calls.length, n + 1, 'voltou: confere na hora');
  assert.deepEqual(changes, [9]);
  assert.deepEqual(reasons, ['visible'], 'a tela sabe que foi ao voltar para a aba (mensagem própria)');
  w.stop();
  assert.equal(doc.n, 0, 'sai do visibilitychange ao parar');
});

test('vigia: sem internet marca "offline" sem parar; função indisponível ou sem permissão para de vez', async () => {
  const seq = [7, null, 7, undefined];
  const { w, states, timers } = vigia({ versions: seq });
  w.start(); await flush();
  assert.equal(states.at(-1).offline, false);
  await timers.advance(5000);
  assert.equal(states.at(-1).offline, true, 'null: sem internet agora');
  await timers.advance(5000);
  assert.equal(states.at(-1).offline, false, 'voltou');
  await timers.advance(5000);
  assert.equal(w.active, false, 'undefined: para de vez');
  assert.equal(timers.pending, 0);
  // erro (exceção) também conta como sem internet
  const { w: w2, states: s2 } = vigia({ versions: () => { throw new Error('rede'); } });
  w2.start(); await flush();
  assert.equal(s2.at(-1).offline, true);
  w2.stop();
});

test('vigia com o canal: 15 s com o aviso no ar, 5 s sem; o token do auth.js vai para o canal; ao reconectar confere', async () => {
  const timers = fakeTimers();
  const { WS, all } = fakeWS();
  let v = 7;
  let vig = null;
  const socket = R.createSocket({ url: 'wss://x', topic: R.topicOf(C), token: async () => 'tok-1', WS, timers, onAviso: (x) => vig.onAviso(x), onState: (s) => vig.socketState(s) });
  const { w, changes, reasons, states, calls, win } = vigia({ versions: () => v, socket, timers });
  vig = w;
  w.start(); await flush();
  assert.equal(all.length, 1, 'abre o canal');
  assert.equal(states.at(-1).mode, 'consultando');
  all[0].open(); all[0].reply('ok');
  await flush();
  assert.equal(states.at(-1).mode, 'ao_vivo');
  const n = calls.length;
  await timers.advance(14999); assert.equal(calls.length, n);
  await timers.advance(1); assert.equal(calls.length, n + 1, 'ao vivo: confere a cada 15 s');
  all[0].aviso(8);
  await timers.advance(300);
  assert.deepEqual(changes, [8], 'o aviso recarrega sem esperar a consulta');
  win.fire('imed:token', { access_token: 'tok-2' });
  assert.deepEqual(all[0].sent.at(-1), { topic: R.topicOf(C), event: 'access_token', payload: { access_token: 'tok-2' }, ref: all[0].sent.at(-1).ref });
  // o canal cai: a consulta passa para 5 s; ao voltar, confere na hora (versão perdida no meio)
  all[0].drop();
  await flush();
  assert.equal(states.at(-1).mode, 'consultando');
  const m = calls.length;
  await timers.advance(5000); assert.equal(calls.length, m + 1, 'sem o canal: 5 s');
  v = 9;
  await timers.advance(1000 - 5000 % 1000); // a nova tentativa do canal (1 s depois da queda) já passou; abre a próxima
  const last = all.at(-1);
  last.open(); last.reply('ok');
  await flush();
  assert.deepEqual(changes, [8, 9], 'ao reconectar, confere a versão e recarrega o que mudou enquanto estava fora');
  assert.deepEqual(reasons, ['aviso', 'reconectou']);
  // saiu da conta: o canal fecha
  win.fire('imed:token', { access_token: null });
  assert.equal(socket.state, 'fechado');
  w.stop();
  assert.equal(win.n, 0);
  assert.equal(timers.pending, 0);
});

test('o site: CSP do painel com wss, auth.js avisa o token, painel.js liga o vigia, sw.js guarda o módulo', () => {
  const painel = ler('painel.html');
  assert.match(painel, /connect-src 'self' https:\/\/pyoqiecupxhdzigjudyd\.supabase\.co wss:\/\/pyoqiecupxhdzigjudyd\.supabase\.co;/, 'só o host do Supabase em wss');
  assert.ok(!ler('gestao.html').includes('wss:'), 'a central (4.4) ainda não usa o canal');
  const auth = ler('assets/js/auth.js');
  assert.match(auth, /new CustomEvent\('imed:token'/);
  assert.ok(/function store\(t\) \{[\s\S]*?avisarToken\(s\.access_token\)/.test(auth), 'entrada e renovação avisam');
  assert.ok(/export async function signOut\(\) \{[\s\S]*?avisarToken\(null\)/.test(auth), 'a saída avisa com null');
  const painelJs = ler('assets/js/painel.js');
  assert.match(painelJs, /startClinicWatcher\(/);
  assert.match(painelJs, /addEventListener\('imed:agenda-mudou'/, 'a aba Pedidos ouve o aviso');
  assert.match(ler('sw.js'), /'\.\/assets\/js\/tempo-real\.js'/);
  const agenda = ler('assets/js/agenda.js');
  assert.match(agenda, /addEventListener\('imed:agenda-mudou'/);
  assert.ok(!/tempo real/i.test(agenda.replace(/\/\/.*$/gm, '')), 'a tela não promete "tempo real" (R2-18)');
});
