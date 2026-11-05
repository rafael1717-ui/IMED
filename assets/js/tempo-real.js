// Atualização automática do painel da clínica (iMed Agenda, fase 4.3; arquitetura §7).
// Dois caminhos, e a tela funciona bem com qualquer um deles:
//   1. Aviso do Supabase Realtime (canal privado "agenda:clinica:<id>", só com a versão da agenda, sem dado de
//      paciente): WebSocket com o protocolo Phoenix v1 em JSON, entrada com o token da pessoa (phx_join com
//      access_token), batimento a cada 25 s, nova tentativa em 1/2/5/10 s e token reenviado quando o auth.js renova
//      (evento "imed:token"). Sem biblioteca.
//   2. Consulta periódica de agenda_version (plano B, sempre ligada): a cada 15 s com o aviso no ar, a cada 5 s sem
//      ele. Cobre aviso perdido, realtime.send que falhou em silêncio e policy em cache.
// Com a aba escondida, os dois param; ao voltar, confere a versão na hora. A correção NUNCA depende do aviso: ele só
// dispara uma nova leitura. Nada aqui lê dados da agenda: só a versão. Quem lê é quem ouve o evento "imed:agenda-mudou"
// (agenda.js e a aba Pedidos do painel.js), que recarrega sem perder o que a pessoa está digitando.
// Lógica pura (sem DOM): testada em tests/tempo-real.test.mjs com relógio e WebSocket falsos.

export const RECONNECT_MS = [1000, 2000, 5000, 10000];
export const REFUSED_MS = 60000;      // entrada recusada 3 vezes seguidas (token velho, sem permissão): espera 1 min
export const HEARTBEAT_MS = 25000;
export const POLL_LIVE_MS = 15000;
export const POLL_ALONE_MS = 5000;
export const DEBOUNCE_MS = 300;
export const JOIN_TIMEOUT_MS = 10000;

export const nextDelay = (attempt) => RECONNECT_MS[Math.max(0, Math.min(Number(attempt) || 0, RECONNECT_MS.length - 1))];
// A chave publishable vai em ?apikey= (um WebSocket não leva cabeçalhos; é o que a documentação do Realtime pede).
// O endereço vem do config.js (supabaseUrl); o token da pessoa vai só dentro do phx_join (access_token), nunca no endereço.
export const wsUrl = (supabaseUrl, chave) => `${String(supabaseUrl).replace(/\/+$/, '').replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(chave)}&vsn=1.0.0`;
export const topicOf = (clinicId) => `realtime:agenda:clinica:${clinicId}`;
export const joinPayload = (token) => ({ config: { broadcast: { self: false, ack: false }, presence: { enabled: false }, private: true }, access_token: token });

// Recarregar só quando a versão que chegou é mais nova que a conhecida (um aviso atrasado ou repetido não recarrega).
export function shouldReload(known, incoming) {
  const v = Number(incoming);
  if (!Number.isFinite(v)) return false;
  if (known == null) return true;
  return v > Number(known);
}

// A versão dentro de um aviso do canal (só mensagens "broadcast" do evento "agenda" no tópico certo); senão null.
export function parseAviso(raw, topic) {
  let m = raw;
  if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch { return null; } }
  if (!m || typeof m !== 'object') return null;
  if (m.event !== 'broadcast' || (topic && m.topic !== topic)) return null;
  const p = m.payload;
  if (!p || p.event !== 'agenda' || !p.payload) return null;
  const v = Number(p.payload.v);
  return Number.isFinite(v) ? v : null;
}

// ---------- o canal (WebSocket) ----------
// token(): devolve o token atual da pessoa (ou null: sem conta → não conecta). onAviso(v), onState('fechado' |
// 'conectando' | 'ao_vivo'). WS e timers trocáveis nos testes.
export function createSocket({ url, topic, token, onAviso, onState, WS = globalThis.WebSocket, timers = globalThis }) {
  let ws = null;
  let state = 'fechado';
  let stopped = true;
  let attempt = 0;
  let refused = 0;
  let ref = 0;
  let joinRef = null;
  let heartbeat = null;
  let retry = null;
  let joinTimer = null;
  let lastToken = null;
  const set = (s) => { if (state !== s) { state = s; try { onState?.(s); } catch { /* quem ouve resolve */ } } };
  const clearTimers = () => {
    if (heartbeat != null) timers.clearTimeout(heartbeat);
    if (retry != null) timers.clearTimeout(retry);
    if (joinTimer != null) timers.clearTimeout(joinTimer);
    heartbeat = retry = joinTimer = null;
  };
  const send = (t, event, payload, withJoinRef = false) => {
    if (!ws || ws.readyState !== 1) return null;
    const r = String(++ref);
    const msg = { topic: t, event, payload, ref: r };
    if (withJoinRef) msg.join_ref = r;
    try { ws.send(JSON.stringify(msg)); } catch { return null; }
    return r;
  };
  const beat = () => {
    heartbeat = timers.setTimeout(() => { send('phoenix', 'heartbeat', {}); beat(); }, HEARTBEAT_MS);
  };
  const dropSocket = () => {
    const w = ws;
    ws = null;
    if (w) { w.onopen = w.onmessage = w.onclose = w.onerror = null; try { w.close(); } catch { /* já fechado */ } }
  };
  const scheduleRetry = (ms) => {
    clearTimers();
    if (stopped) return;
    set('conectando');
    retry = timers.setTimeout(() => { retry = null; connect(); }, ms);
  };
  // caiu (ou foi recusado): tenta de novo em 1/2/5/10 s; 3 recusas seguidas → 1 min
  const lost = (wasRefused = false) => {
    dropSocket();
    if (stopped) { clearTimers(); set('fechado'); return; }
    let ms;
    if (wasRefused) { refused += 1; ms = refused >= 3 ? REFUSED_MS : nextDelay(attempt); } else ms = nextDelay(attempt);
    attempt += 1;
    scheduleRetry(ms);
  };
  async function connect() {
    if (stopped || ws) return;
    let tok = null;
    try { tok = await token(); } catch { tok = null; }
    if (stopped) return;
    if (!tok) { lost(true); return; }
    lastToken = tok;
    set('conectando');
    let w;
    try { w = new WS(url); } catch { lost(); return; }
    ws = w;
    w.onopen = () => {
      if (ws !== w) return;
      joinRef = send(topic, 'phx_join', joinPayload(lastToken), true);
      if (joinRef == null) { lost(); return; }
      joinTimer = timers.setTimeout(() => { joinTimer = null; if (ws === w && state !== 'ao_vivo') lost(); }, JOIN_TIMEOUT_MS);
    };
    w.onmessage = (ev) => {
      if (ws !== w) return;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.event === 'phx_reply' && m.ref === joinRef && m.topic === topic) {
        if (m.payload?.status === 'ok') {
          if (joinTimer != null) { timers.clearTimeout(joinTimer); joinTimer = null; }
          attempt = 0; refused = 0;
          if (heartbeat == null) beat();
          set('ao_vivo');
        } else lost(true);
        return;
      }
      if (m.topic !== topic) return;
      if (m.event === 'phx_error' || m.event === 'phx_close' || (m.event === 'system' && m.payload?.status === 'error')) { lost(m.event === 'system'); return; }
      const v = parseAviso(m, topic);
      if (v != null) { try { onAviso?.(v); } catch { /* quem ouve resolve */ } }
    };
    w.onclose = () => { if (ws === w) lost(); };
    w.onerror = () => { if (ws === w) lost(); };
  }
  return {
    start() { if (!stopped) return; stopped = false; attempt = 0; refused = 0; connect(); },
    stop() { stopped = true; clearTimers(); dropSocket(); set('fechado'); },
    // Token novo (renovação do auth.js): reenvia no canal aberto; o próximo phx_join já usa o novo. Null: saiu da conta.
    setToken(t) {
      if (!t) { this.stop(); return; }
      lastToken = t;
      if (state === 'ao_vivo') send(topic, 'access_token', { access_token: t });
    },
    get state() { return state; },
    get active() { return !stopped; },
  };
}

// ---------- o vigia (canal + consulta periódica) ----------
// fetchVersion(): número (a versão), null (sem internet agora: tenta depois) ou undefined (função indisponível ou sem
// permissão: para de vez). onChange(v, reason) quando a versão mudou; onState({ mode, offline, at }) a cada mudança:
// mode 'ao_vivo' (aviso no ar), 'consultando' (só a consulta periódica), 'pausado' (aba escondida), 'parado'.
const vigias = new Map();
export const vigiaDe = (clinicId) => vigias.get(String(clinicId)) || null;

export function createWatcher({ clinicId, fetchVersion, onChange, onState, socket = null, doc = globalThis.document, timers = globalThis, win = globalThis }) {
  let known = null;
  let pending = null;
  let stopped = true;
  let running = false;
  let again = false;
  let offline = false;
  let at = null;
  let pollTimer = null;
  let debounce = null;
  let changing = false;
  let changeAgain = false;
  const hidden = () => !!(doc && (doc.hidden || doc.visibilityState === 'hidden'));
  const live = () => socket?.state === 'ao_vivo';
  const mode = () => (stopped ? 'parado' : hidden() ? 'pausado' : live() ? 'ao_vivo' : 'consultando');
  let lastState = '';
  const tell = () => {
    const s = { mode: mode(), offline, at, version: known };
    const key = `${s.mode}|${s.offline}|${s.at}|${s.version}`;
    if (key === lastState) return;
    lastState = key;
    try { onState?.(s); } catch { /* quem ouve resolve */ }
  };
  const clearPoll = () => { if (pollTimer != null) timers.clearTimeout(pollTimer); pollTimer = null; };
  const schedule = () => {
    clearPoll();
    if (stopped || hidden()) return;
    pollTimer = timers.setTimeout(() => { pollTimer = null; check(); }, live() ? POLL_LIVE_MS : POLL_ALONE_MS);
  };
  // A versão mudou: avisa quem lê (uma vez por mudança; mudança durante a leitura → avisa de novo no fim).
  // reason: 'aviso' (canal), 'consulta' (periódica), 'visible' (a aba voltou), 'reconectou' (o canal voltou).
  async function change(v, reason) {
    if (changing) { changeAgain = true; return; }
    changing = true;
    try { await onChange?.(v, reason); } catch { /* quem lê mostra o erro */ } finally { changing = false; }
    if (changeAgain) { changeAgain = false; if (known != null) change(known, 'consulta'); }
  }
  const take = (v, { announce = true, reason = 'consulta' } = {}) => {
    if (!Number.isFinite(Number(v))) return;
    const mudou = shouldReload(known, v) && known != null;
    if (known == null || Number(v) > Number(known)) known = Number(v);
    if (mudou && announce) change(known, reason);
  };
  let motivo = 'consulta';
  async function check(reason = 'consulta') {
    if (stopped || hidden()) return;
    if (reason !== 'consulta') motivo = reason;
    if (running) { again = true; return; }
    running = true;
    const porque = motivo; motivo = 'consulta';
    try {
      const v = await fetchVersion();
      if (stopped) return;
      if (v === undefined) { w.stop(); return; }
      if (v === null || !Number.isFinite(Number(v))) offline = true;
      else { offline = false; at = Date.now(); take(v, { reason: porque }); }
    } catch {
      offline = true;
    } finally { running = false; }
    if (stopped) return;
    tell();
    if (again) { again = false; return check(); }
    schedule();
  }
  // aviso do canal: junta os que chegam em rajada (300 ms) e recarrega uma vez
  const onAviso = (v) => {
    if (stopped) return;
    pending = pending == null ? Number(v) : Math.max(pending, Number(v));
    if (debounce != null) return;
    debounce = timers.setTimeout(() => {
      debounce = null;
      const p = pending; pending = null;
      offline = false; at = Date.now();
      take(p, { reason: 'aviso' });
      tell();
    }, DEBOUNCE_MS);
  };
  const onVis = () => {
    if (stopped) return;
    if (hidden()) { clearPoll(); socket?.stop(); tell(); return; }
    socket?.start();
    tell();
    check('visible');
  };
  const onToken = (e) => { if (!stopped) socket?.setToken(e?.detail?.access_token ?? null); };
  const w = {
    clinicId: String(clinicId),
    start() {
      if (!stopped) return;
      stopped = false;
      doc?.addEventListener?.('visibilitychange', onVis);
      win?.addEventListener?.('imed:token', onToken);
      vigias.set(this.clinicId, this);
      if (!hidden()) socket?.start();
      tell();
      check();
    },
    stop() {
      if (stopped) return;
      stopped = true; again = false;
      clearPoll();
      if (debounce != null) { timers.clearTimeout(debounce); debounce = null; }
      socket?.stop();
      doc?.removeEventListener?.('visibilitychange', onVis);
      win?.removeEventListener?.('imed:token', onToken);
      if (vigias.get(this.clinicId) === this) vigias.delete(this.clinicId);
      tell();
    },
    // quem leu a agenda diz a versão que tem: um aviso dessa versão (ou mais velho) não recarrega de novo
    seen(v) { take(v, { announce: false }); },
    // confere a versão agora (ex.: ao voltar para a aba)
    check(reason = 'visible') { if (!stopped) { clearPoll(); check(reason); } },
    onAviso,
    socketState: (s) => { if (!stopped) { tell(); if (s === 'ao_vivo') check('reconectou'); else schedule(); } },
    get state() { return { mode: mode(), offline, at, version: known }; },
    get active() { return !stopped; },
  };
  return w;
}

// O vigia pronto para o painel: canal da clínica com o token do auth.js + consulta de agenda_version, avisando pela
// janela: "imed:agenda-mudou" {clinicId, version} e "imed:agenda-estado" {clinicId, mode, offline, at}.
// rpc(fn, args) e token() vêm do auth.js (quem chama não precisa importá-lo aqui). Devolve o vigia já ligado.
export function startClinicWatcher({ clinicId, rpc, token, supabaseUrl, chave, WS = globalThis.WebSocket, win = globalThis, doc = globalThis.document, timers = globalThis }) {
  const id = String(clinicId);
  const emit = (name, detail) => { try { win.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* sem CustomEvent */ } };
  const isMissing = (err) => err?.status === 404 || err?.data?.code === 'PGRST202' || err?.data?.code === '42883';
  let vigia = null;
  const socket = WS && supabaseUrl && chave ? createSocket({
    url: wsUrl(supabaseUrl, chave), topic: topicOf(id), token, WS, timers,
    onAviso: (v) => vigia?.onAviso(v),
    onState: (s) => vigia?.socketState(s),
  }) : null;
  vigia = createWatcher({
    clinicId: id, socket, doc, timers, win,
    fetchVersion: async () => {
      try {
        const r = await rpc('agenda_version', { p_clinic: id });
        if (r?.status === 'ok') return Number(r.version);
        if (r?.status === 'forbidden') return undefined;
        return null;
      } catch (err) {
        if (isMissing(err) || err?.status === 401 || err?.status === 403) return undefined;
        return null;
      }
    },
    onChange: (version, reason) => { emit('imed:agenda-mudou', { clinicId: id, version, reason }); },
    onState: (s) => { emit('imed:agenda-estado', { clinicId: id, ...s }); },
  });
  vigia.start();
  return vigia;
}
