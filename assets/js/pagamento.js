// A tela do pagamento pelo site (iMed Pagamentos, fase P2a): QR do Pix, "copia e cola", relógio, e as situações
// (aguardando, pago, vencido, devolução...). Usada pela página do local (local.js) e pela conta (conta.js).
//
// DESLIGADO: este arquivo (e o estilo dele, assets/css/pagamento.css) só é baixado quando a clínica tem o recebimento
// pelo site ligado, ou quando o aparelho guarda um agendamento pago pelo site. Hoje nenhuma clínica tem: nada muda.
//
// Quem manda é o banco: a tela só MOSTRA o que pag_my_payment devolve e nunca confirma nada por conta própria. Fechar a
// página não perde o pagamento (a confirmação vem do aviso do meio de pagamento para o servidor, não daqui). As regras
// (situações, textos, relógio, CPF) estão em pagamento-core.js, com testes sem navegador.
import * as C from './pagamento-core.js';

export const core = C;
const CFG = window.IMED_CONFIG || {};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

/* ======================= estilo (baixado só com a tela) ======================= */
let cssP = null;
export function ensureCss() {
  cssP ??= new Promise((ok) => {
    if (document.querySelector('link[data-pg]')) return ok();
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'assets/css/pagamento.css';
    l.dataset.pg = '1';
    l.onload = ok;
    l.onerror = ok;
    document.head.append(l);
    setTimeout(ok, 2000);
    return undefined;
  });
  return cssP;
}

/* ======================= servidor ======================= */
// A função do servidor (Edge Function pagamento-criar). Com a conta aberta, o token da pessoa vai junto (regra dos
// cabeçalhos do config.js), para o agendamento aparecer na conta dela. Sem resposta: null.
export async function chamar(body) {
  let token = null;
  try { token = await (await import('./auth.js')).token(); } catch { token = null; }
  try {
    const res = await fetch(`${CFG.functionsUrl}/${C.FUNCAO}`, {
      method: 'POST', headers: CFG.supabaseHeaders(token, { 'Content-Type': 'application/json' }), body: JSON.stringify(body), signal: AbortSignal.timeout(40000),
    });
    return await res.json();
  } catch {
    return null;
  }
}

// Desafio contra robôs (Turnstile). FECHADO POR PADRÃO: sem a chave do site em config.js (turnstileSiteKey), não há
// desafio, o código vai vazio e o servidor recusa. Para ligar (com o dono): a chave em config.js e o endereço do
// Turnstile na Content-Security-Policy da página (script-src e frame-src), como está em "P2a: como ficou".
const TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let turnstileP = null;
export async function desafio(host) {
  const key = typeof CFG.turnstileSiteKey === 'string' ? CFG.turnstileSiteKey : '';
  if (!key || !host) return '';
  try {
    if (!window.turnstile) {
      turnstileP ??= new Promise((ok, fail) => {
        const s = document.createElement('script');
        s.src = TURNSTILE; s.async = true; s.onload = ok; s.onerror = fail;
        document.head.append(s);
      });
      await turnstileP;
    }
    return await new Promise((ok) => {
      const fim = setTimeout(() => ok(''), 60000);
      const done = (t) => { clearTimeout(fim); ok(typeof t === 'string' ? t : ''); };
      host.hidden = false;
      window.turnstile.render(host, { sitekey: key, language: 'pt-BR', callback: done, 'error-callback': () => done(''), 'expired-callback': () => done('') });
    });
  } catch {
    turnstileP = null;
    return '';
  }
}

/* ======================= antes de pagar: bloco do formulário ======================= */
// Resumo antes do botão "Ir para o pagamento": o valor (o preço do procedimento, do banco), as regras que o banco
// informou (payment_text, o prazo da reserva, o prazo de cancelamento) e o CPF de quem paga.
export function formHTML({ info, proc, cancelText = '' }) {
  const valor = C.formatMoney(proc?.price_cents);
  const regras = [info?.payment_text, C.holdText(info), cancelText].filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join('');
  return `<div class="pg-pre" id="pgPre">
      <h3><i class="fa-solid fa-lock" aria-hidden="true"></i>Pagamento por Pix, aqui no site</h3>
      ${valor ? `<p class="pg-valor"><span>Valor do exame</span><b>${esc(valor)}</b></p>` : ''}
      ${regras ? `<ul class="sl-rules">${regras}</ul>` : ''}
      <div class="fld" data-f="cpf"><label for="bkCpf">CPF de quem vai pagar</label>
        <input id="bkCpf" name="cpf" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" maxlength="14" required aria-describedby="h-cpf">
        <span class="err" id="e-cpf"></span>
        <small class="h" id="h-cpf">${esc(C.TXT.cpf)} O pagamento sai no nome informado em “Seu nome completo”.</small></div>
      <div class="pg-captcha" id="pgCaptcha" hidden></div>
    </div>`;
}
export const trustHTML = () => `<div class="trust"><p class="free"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i><span>${esc(C.TXT.golpe)}</span></p></div>`;
export function bindForm(form) {
  const cpf = form.querySelector('#bkCpf');
  cpf?.addEventListener('input', () => { cpf.value = C.maskCpf(cpf.value); });
}

/* ======================= aparelho ("Meus pedidos") ======================= */
// Muda a situação guardada no aparelho do agendamento `id` (nunca "confirmado" antes de o banco dizer que foi pago).
export function markLocal(id, status) {
  try {
    const list = JSON.parse(localStorage.getItem('imed_appts') || '[]');
    if (!Array.isArray(list)) return;
    localStorage.setItem('imed_appts', JSON.stringify(list.map((a) => (a && a.id === id ? { ...a, status } : a))));
  } catch { /* sem armazenamento: a situação vem do banco */ }
}

/* ======================= QR ======================= */
let qrLib = null;
const qrCache = new Map();
async function qrFor(code) {
  if (qrCache.has(code)) return qrCache.get(code);
  qrLib ??= import('../vendor/qrcode-generator/qrcode.js').then((m) => m.default || m.qrcode);
  const svg = C.qrSvg(C.qrRows(code, await qrLib), { title: 'QR Code do Pix deste pagamento' });
  qrCache.set(code, svg);
  return svg;
}

/* ======================= a tela ======================= */
// mount(box, o): desenha a tela do pagamento dentro de `box` e a mantém em dia. Devolve { stop, refresh }.
//   o.id, o.token      o agendamento (o código fica só no aparelho; pedido que veio só da conta: token vazio)
//   o.rpc(fn, args)    chamada de função do banco (visitante com o código, ou a conta da pessoa)
//   o.ctx              { place, phone, code, exam, when, tz } para os textos e o comprovante
//   o.first            resposta de pagamento-criar (para desenhar na hora, sem outra consulta)
//   o.h                'h2' (página do local) ou 'h3' (cartão da conta);  o.hid: id do título
//   o.paidHTML(v)      o que a página põe depois do comprovante (passos, botões); o.onView(view, v): cada mudança
//   o.onRestart()      "Escolher o horário de novo" (sem ela, o botão vira um link para a página do local, o.restartHref)
//   o.announce(text)   região viva da página (leitor de tela)
export function mount(box, o) {
  const H = o.h || 'h2';
  const H2 = `h${Math.min(6, Number(H.slice(1)) + 1)}`;   // subtítulo (comprovante): um nível abaixo do título
  const hid = o.hid || 'pg-titulo';
  const ctx = o.ctx || {};
  const skew = o.first?.agora && Number.isFinite(Date.parse(o.first.agora)) ? Date.parse(o.first.agora) - Date.now() : 0;
  const now = () => Date.now() + skew;
  const st = { res: null, v: { view: '' }, since: Date.now(), poll: 0, tick: 0, stopped: false, lastMs: Infinity, ask: false, busy: '', msg: '', focus: false };
  if (o.first?.payment) {
    st.res = { status: 'ok', payment_mode: 'online', request_status: o.first.request_status || 'awaiting_payment', total_cents: o.first.total_cents, hold_expires_at: o.first.hold_expires_at, payment: o.first.payment };
  }
  box.innerHTML = '<div class="pg-body"></div><p class="sr pg-live" aria-live="polite"></p>';
  const body = box.querySelector('.pg-body');
  const say = (t) => {
    if (!t) return;
    if (o.announce) return o.announce(t);
    const live = box.querySelector('.pg-live');
    live.textContent = '';
    setTimeout(() => { live.textContent = t; }, 60);
    return undefined;
  };
  const title = (icon, text) => `<${H} class="pg-h" id="${hid}" tabindex="-1"><i class="fa-solid ${icon}" aria-hidden="true"></i>${esc(text)}</${H}>`;
  const what = () => (ctx.exam || ctx.when || ctx.place ? `<p class="pg-sub">${[ctx.exam ? `<b>${esc(ctx.exam)}</b>` : '', ctx.when ? esc(ctx.when) : ''].filter(Boolean).join(' · ')}${ctx.place ? `<br>${esc(ctx.place)}` : ''}</p>` : '');
  const restart = () => (o.onRestart ? '<button class="btn btn-primary" type="button" data-pg="restart"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i>Escolher o horário de novo</button>'
    : o.restartHref ? `<a class="btn btn-primary" href="${esc(o.restartHref)}"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i>Escolher o horário de novo</a>` : '');
  const linhas = (v) => { const l = C.refundLines(v, ctx.tz); return l.length ? `<ul class="pg-dev">${l.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''; };
  const golpe = () => `<p class="pg-golpe"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i><span>${esc(C.TXT.golpe)}</span></p>`;
  const msg = () => `<p class="pg-msg" role="status">${esc(st.msg)}</p>`;

  function html(v) {
    const valor = C.formatMoney(v.cents);
    const valorHTML = valor ? `<p class="pg-valor"><span>Valor</span><b>${esc(valor)}</b></p>` : '';
    if (v.view === 'aguardando') {
      const c = C.countdown(v.expira, now());
      return `${title('fa-clock', 'Pague com Pix para confirmar o horário')}${what()}${valorHTML}
        <p class="pg-relogio"><i class="fa-regular fa-clock" aria-hidden="true"></i><span>Tempo para pagar: <b class="pg-tempo" role="timer" aria-label="${esc(c.sr)}">${c.text}</b></span></p>
        <div class="pg-qr" data-code="${esc(v.code)}"><span class="spin" aria-hidden="true"></span></div>
        <ol class="pg-passos"><li>Abra o aplicativo do seu banco e escolha pagar com Pix.</li><li>Leia o QR Code com a câmera ou use o Pix Copia e Cola.</li><li>Confira o valor e pague. Esta tela avisa quando o pagamento chegar.</li></ol>
        <div class="fld pg-copia"><label for="${hid}-code">Pix Copia e Cola</label><textarea id="${hid}-code" class="pg-code" rows="3" readonly spellcheck="false">${esc(v.code)}</textarea></div>
        <div class="lc-book-acts pg-acts">
          <button class="btn btn-primary" type="button" data-pg="copy"><i class="fa-regular fa-copy" aria-hidden="true"></i>Copiar código</button>
          <button class="btn btn-ghost" type="button" data-pg="check"${st.busy === 'check' ? ' disabled' : ''}>${st.busy === 'check' ? '<span class="spin" aria-hidden="true"></span>Conferindo…' : '<i class="fa-solid fa-rotate" aria-hidden="true"></i>Já paguei'}</button>
          ${st.ask ? '' : '<button class="btn btn-ghost pg-cancel" type="button" data-pg="cancel"><i class="fa-solid fa-ban" aria-hidden="true"></i>Cancelar</button>'}
        </div>
        ${st.ask ? `<div class="pg-ask" role="group" aria-label="Confirmar o cancelamento"><p>Cancelar o pagamento e liberar o horário?</p>
          <div class="pg-row"><button class="btn btn-coral btn-sm" type="button" data-pg="cancel-yes"${st.busy === 'cancel' ? ' disabled' : ''}>${st.busy === 'cancel' ? 'Cancelando…' : 'Sim, cancelar'}</button><button class="btn btn-ghost btn-sm" type="button" data-pg="cancel-no">Não</button></div></div>` : ''}
        ${msg()}${golpe()}<p class="src">${esc(C.TXT.fechar)}</p>`;
    }
    if (v.view === 'pago') {
      const rows = C.receiptRows(v, ctx).map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('');
      return `<div class="ok lc-ok pg-ok"><div class="ic"><i class="fa-solid fa-check" aria-hidden="true"></i></div>
        ${title('fa-circle-check', `Pagamento aprovado. Agendamento confirmado${ctx.when ? ` para ${ctx.when}` : ''}`)}
        ${ctx.place ? `<p><b>${esc(ctx.place)}</b>${ctx.exam ? `<br>${esc(ctx.exam)}` : ''}</p>` : ''}
        ${ctx.code ? `<span class="code">${esc(ctx.code)}</span>` : ''}</div>
        <section class="pg-recibo" aria-labelledby="${hid}-rec"><${H2} class="pg-rh" id="${hid}-rec">Comprovante de pagamento</${H2}><dl>${rows}</dl>${linhas(v)}
          <p class="src">${esc(C.TXT.nota)}</p></section>
        ${o.paidHTML ? o.paidHTML(v) : ''}${golpe()}`;
    }
    if (v.view === 'conferindo' || v.view === 'criando') {
      const [t, p] = C.VIEW_TXT[v.view];
      return `${title('fa-clock', t)}${what()}<p class="pg-txt"><span class="spin" aria-hidden="true"></span> ${esc(p)}</p>
        ${v.view === 'conferindo' ? `<div class="lc-book-acts pg-acts"><button class="btn btn-ghost" type="button" data-pg="check"${st.busy === 'check' ? ' disabled' : ''}>${st.busy === 'check' ? '<span class="spin" aria-hidden="true"></span>Conferindo…' : '<i class="fa-solid fa-rotate" aria-hidden="true"></i>Já paguei'}</button></div>` : ''}
        ${msg()}${golpe()}`;
    }
    if (v.view === 'devolucao' || v.view === 'devolvido') {
      const [t, p] = C.VIEW_TXT[v.view === 'devolvido' ? 'devolvido' : v.motivo === 'atrasado' ? 'atrasado' : 'devolvendo'];
      return `${title(v.view === 'devolvido' ? 'fa-circle-check' : 'fa-circle-info', t)}${what()}<p class="pg-txt">${esc(p)}</p>${linhas(v)}
        <div class="lc-book-acts pg-acts">${restart()}</div>${golpe()}`;
    }
    if (v.view === 'vencido' || v.view === 'cancelado') {
      const [t, p] = C.VIEW_TXT[v.view];
      return `${title(v.view === 'vencido' ? 'fa-clock' : 'fa-ban', t)}${what()}<p class="pg-txt">${esc(p)}</p><div class="lc-book-acts pg-acts">${restart()}</div>`;
    }
    if (v.view === 'erro') {
      const tel = ctx.telHref ? ` Se preferir, <a class="link" href="${esc(ctx.telHref)}">ligue para a clínica</a>.` : '';
      return `${title('fa-triangle-exclamation', 'Pagamento indisponível agora')}${what()}<p class="pg-txt">${esc(C.MSG.provider)}${tel}</p><div class="lc-book-acts pg-acts">${restart()}</div>`;
    }
    const [t, p] = C.VIEW_TXT[v.view === 'nao_encontrado' ? 'nao_encontrado' : 'indisponivel'];
    return `${title('fa-plug-circle-xmark', t)}<p class="pg-txt">${esc(p)}</p>
      ${v.view === 'nao_encontrado' ? '' : '<div class="lc-book-acts pg-acts"><button class="btn btn-ghost" type="button" data-pg="reload"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Tentar de novo</button></div>'}`;
  }

  function draw({ focus = false } = {}) {
    const active = document.activeElement && body.contains(document.activeElement) ? document.activeElement.dataset?.pg : '';
    body.dataset.view = st.v.view;
    body.innerHTML = html(st.v);
    const qr = body.querySelector('.pg-qr');
    if (qr) {
      const code = qr.dataset.code;
      qrFor(code).then((svg) => { if (qr.isConnected && svg) qr.innerHTML = svg; })
        .catch(() => { if (qr.isConnected) { qr.innerHTML = ''; qr.hidden = true; } });
    }
    if (focus) body.querySelector('.pg-h')?.focus({ preventScroll: !o.scroll });
    else if (active) body.querySelector(`[data-pg="${active}"]`)?.focus({ preventScroll: true });
  }

  function apply(res, { user = false } = {}) {
    if (st.stopped) return;
    const prev = st.v.view;
    // sem resposta agora, mas a tela já sabia a situação: continua mostrando (o relógio segue) e tenta de novo
    if ((!res || res.status !== 'ok') && st.res && prev && prev !== 'indisponivel' && !(res && res.status === 'not_found')) return schedule();
    if (res) st.res = res;
    const v = st.forced ? { view: 'erro' } : C.viewOf(st.res, now());
    const changed = v.view !== prev;
    st.v = v;
    if (changed) { st.since = Date.now(); st.ask = false; st.msg = ''; st.lastMs = Infinity; }
    if (changed || user) draw({ focus: changed && (prev !== '' || o.focusFirst) });
    if (changed) {
      if (v.view === 'pago') { markLocal(o.id, 'confirmado'); say('Pagamento aprovado. Agendamento confirmado.'); }
      else if (v.view === 'vencido') say(C.VIEW_TXT.vencido[0]);
      else if (v.view === 'devolucao') say(C.VIEW_TXT[v.motivo === 'atrasado' ? 'atrasado' : 'devolvendo'][0]);
      o.onView?.(v.view, v);
    }
    return schedule();
  }
  const load = async () => { try { return await o.rpc('pag_my_payment', { p_request: o.id, p_token: o.token || null }); } catch { return null; } };
  async function refresh(opts) { if (!st.stopped) apply(await load(), opts); }
  function schedule() {
    clearTimeout(st.poll);
    const d = C.pollDelay(st.v.view, Date.now() - st.since);
    if (d != null && !st.stopped) st.poll = setTimeout(() => { if (document.visibilityState === 'hidden') schedule(); else refresh(); }, d);
  }
  // relógio: a cada segundo, só o texto; quando zera, a tela confere na hora
  st.tick = setInterval(() => {
    if (st.stopped || st.v.view !== 'aguardando') return;
    const c = C.countdown(st.v.expira, now());
    const el = body.querySelector('.pg-tempo');
    if (el) { el.textContent = c.text; el.setAttribute('aria-label', c.sr); }
    say(C.announceAt(st.lastMs, c.ms));
    st.lastMs = c.ms;
    if (c.ended) apply(st.res);
  }, 1000);
  const onVisible = () => { if (document.visibilityState === 'visible' && !st.stopped && !C.FINAL.includes(st.v.view)) refresh(); };
  document.addEventListener('visibilitychange', onVisible);

  const setMsg = (t, { announce = true } = {}) => { st.msg = t; const m = body.querySelector('.pg-msg'); if (m) m.textContent = t; if (announce) say(t); };
  async function onClick(e) {
    const act = e.target.closest('[data-pg]')?.dataset.pg;
    if (!act || st.stopped) return;
    if (act === 'copy') {
      const code = st.v.code || '';
      try { await navigator.clipboard.writeText(code); setMsg('Código copiado. Cole no aplicativo do seu banco, em Pix Copia e Cola.'); }
      catch { const ta = body.querySelector('.pg-code'); ta?.focus(); ta?.select(); setMsg('Não deu para copiar sozinho. O código está selecionado: copie e cole no aplicativo do seu banco.'); }
    } else if (act === 'check') {
      if (st.busy) return;
      st.busy = 'check'; st.msg = ''; draw();
      if (o.token) await chamar(C.conferirBody(o.id, o.token));
      const res = await load();
      st.busy = '';
      const antes = st.v.view;
      apply(res, { user: true });
      if (st.v.view === antes && (antes === 'aguardando' || antes === 'conferindo')) setMsg('Ainda não recebemos o pagamento. Pode levar alguns instantes: esta tela atualiza sozinha.');
    } else if (act === 'cancel') {
      st.ask = true; draw(); body.querySelector('[data-pg="cancel-yes"]')?.focus();
    } else if (act === 'cancel-no') {
      st.ask = false; draw(); body.querySelector('[data-pg="cancel"]')?.focus();
    } else if (act === 'cancel-yes') {
      if (st.busy) return;
      st.busy = 'cancel'; draw();
      let r;
      try { r = await o.rpc('cancel_request', { p_id: o.id, p_token: o.token || null }); } catch { r = 'error'; }
      st.busy = '';
      if (r === 'ok' || r === 'already_cancelled') { markLocal(o.id, 'cancelado'); return refresh({ user: true }); }
      st.ask = false; draw();
      setMsg('Não foi possível cancelar agora. Verifique sua internet e tente de novo.');
    } else if (act === 'reload') {
      refresh({ user: true });
    } else if (act === 'restart') {
      o.onRestart?.();
    }
  }
  box.addEventListener('click', onClick);

  function stop() {
    st.stopped = true;
    clearTimeout(st.poll);
    clearInterval(st.tick);
    document.removeEventListener('visibilitychange', onVisible);
    box.removeEventListener('click', onClick);
  }
  // tela de erro do meio de pagamento (a reserva foi solta): não consulta nada
  ensureCss();
  if (o.erro) { st.forced = true; st.v = { view: 'erro' }; draw({ focus: !!o.focusFirst }); o.onView?.('erro', st.v); return { stop, refresh }; }
  if (st.res) apply(st.res); else { st.v = { view: '' }; body.innerHTML = '<div class="lc-load sm" role="status"><span class="spin" aria-hidden="true"></span>Conferindo o pagamento…</div>'; refresh(); }
  return { stop, refresh };
}

// Só a consulta (para o cartão da conta): a resposta de pag_my_payment, ou null.
export async function status(rpc, id, token) {
  try { return await rpc('pag_my_payment', { p_request: id, p_token: token || null }); } catch { return null; }
}
