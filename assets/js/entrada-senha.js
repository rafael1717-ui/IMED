// Entrada com E-MAIL E SENHA nos quadros de entrada do site (conta, painel da clínica, gestão, reivindicar e área do
// médico). Desde 13/11 a senha é o caminho principal (pedido do dono: o link por e-mail expira e o e-mail do sistema
// nem sempre chega): logo abaixo do e-mail ficam, já à mostra, o campo "Sua senha", o botão "Entrar" e "Esqueci a
// senha". O link por e-mail continua existindo, como opção secundária no fim do quadro (o botão de enviar do próprio
// quadro é movido para lá). Enter no e-mail leva para a senha (ou entra, se ela já estiver preenchida); não manda link.
// Quem nunca definiu uma senha define em definir-senha.html.
// Uso: montarSenha({ form, email: () => texto do campo de e-mail, msg: elemento da mensagem, depois: () => void })
//   - form: o <form> do quadro (o bloco entra no fim dele, antes da mensagem se ela estiver no form);
//   - depois: chamado quando a entrada com senha dá certo (a página redesenha e carrega os dados).
// Nenhuma senha fica guardada: só a sessão que o Supabase devolve (auth.js).
import * as auth from './auth.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Estilo do bloco, uma vez por página (as páginas têm style-src 'unsafe-inline'; as cores vêm do tema).
const CSS = `.es-bloco{margin-top:12px;width:100%;flex-basis:100%}
.es-form>*{grid-column:1/-1}
.es-campos{display:grid;gap:8px}
.es-email{margin-top:14px;padding-top:12px;border-top:1px solid var(--line,#cddbe2);display:grid;gap:8px;justify-items:start;width:100%;flex-basis:100%}
.es-lbl{display:block;font-weight:700;font-size:14px;color:var(--ink)}
.es-row{display:flex;gap:8px;flex-wrap:wrap}
.es-row input{flex:1 1 200px;min-width:0;border:1px solid var(--line,#cddbe2);border-radius:12px;padding:12px 14px;font-size:16px;background:var(--field,#fff);color:var(--ink);outline:none}
.es-row input:focus{border-color:var(--primary,#0E7C9C);box-shadow:0 0 0 3px rgba(14,124,156,.15)}
.es-row .btn{flex:0 0 auto}
.es-ajuda{font-size:13.5px;color:var(--muted);line-height:1.5;margin:0}
.es-ajuda a,.es-link{color:var(--primary,#0E7C9C);font-weight:600;text-decoration:underline;text-underline-offset:3px}
.es-link{background:none;border:0;padding:0;font:inherit;cursor:pointer}
.es-link:focus-visible{outline:3px solid var(--primary,#0E7C9C);outline-offset:2px;border-radius:4px}`;
function estilo() {
  if (document.getElementById('es-css')) return;
  const s = document.createElement('style');
  s.id = 'es-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function montarSenha({ form, email, msg, depois, classe = '' }) {
  if (!form || form.querySelector('[data-senha]')) return;
  estilo();
  const box = document.createElement('div');
  box.className = `es-bloco ${classe}`.trim();
  box.setAttribute('data-senha', '');
  box.innerHTML = `<div class="es-campos" id="senhaCampos">
      <label class="es-lbl" for="loginSenha">Sua senha</label>
      <div class="es-row">
        <input id="loginSenha" type="password" autocomplete="current-password" maxlength="200" aria-describedby="loginMsg" placeholder="Sua senha">
        <button class="btn btn-primary" type="button" id="loginSenhaBtn">Entrar</button>
      </div>
      <p class="es-ajuda">Ainda não tem senha? <a href="definir-senha.html">Definir ou trocar a senha</a> · <button class="es-link" type="button" id="loginEsqueci">Esqueci a senha</button></p>
    </div>`;
  // O bloco da senha entra logo depois do campo de e-mail; o botão de enviar o link (o submit do quadro) desce para o
  // fim, como opção secundária, antes da mensagem (#loginMsg), que continua por último.
  form.classList.add('es-form');
  const m = msg && msg.parentNode === form ? msg : null;
  const campoEmail = form.querySelector('input[type="email"]');
  let ondeEmail = campoEmail; // o filho direto do form que contém o campo de e-mail (rótulo, linha ou o próprio campo)
  while (ondeEmail && ondeEmail.parentNode !== form) ondeEmail = ondeEmail.parentNode;
  if (ondeEmail) ondeEmail.after(box); else if (m) form.insertBefore(box, m); else form.appendChild(box);
  const enviar = form.querySelector('button[type="submit"]');
  if (enviar) {
    const linha = document.createElement('div');
    linha.className = 'es-email';
    linha.innerHTML = '<p class="es-ajuda">Prefere entrar sem senha? Mandamos um link de entrada para o seu e-mail (vale 1 hora).</p>';
    enviar.classList.remove('btn-coral', 'btn-primary');
    enviar.classList.add('btn-ghost', 'btn-sm');
    linha.appendChild(enviar);
    if (m) form.insertBefore(linha, m); else form.appendChild(linha);
  }

  const senha = box.querySelector('#loginSenha');
  const entrar = box.querySelector('#loginSenhaBtn');
  const esqueci = box.querySelector('#loginEsqueci');
  const aviso = (texto, kind = 'err') => {
    if (!msg) return;
    msg.className = msg.className.replace(/\b(ok|err|warn)\b/g, '').trim();
    msg.textContent = texto;
    if (kind) msg.classList.add(kind);
    msg.hidden = !texto;
  };

  async function entrarComSenha() {
    const e = String(email() || '').trim();
    if (!EMAIL_OK.test(e)) { aviso('Digite um e-mail válido antes da senha.'); form.querySelector('input[type="email"]')?.focus(); return; }
    if (!senha.value) { aviso('Digite a sua senha.'); senha.focus(); return; }
    entrar.disabled = true;
    aviso('Entrando…', '');
    try {
      await auth.signInWithPassword(e, senha.value);
      senha.value = '';
      aviso('');
      depois?.();
    } catch (err) {
      aviso(err?.status === 429 ? 'Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.'
        : err?.code === 'invalid_credentials' || err?.status === 400 ? 'E-mail ou senha errados. Se você nunca definiu uma senha, use "Esqueci a senha" ou peça o link por e-mail, logo abaixo.'
          : err?.code === 'email_not_confirmed' ? 'Este e-mail ainda não foi confirmado. Entre uma vez pelo link do e-mail.'
            : 'Não foi possível entrar agora. Confira a internet e tente de novo.');
      senha.focus();
    } finally {
      entrar.disabled = false;
    }
  }
  entrar.addEventListener('click', entrarComSenha);
  senha.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); entrarComSenha(); } });
  // Enter no e-mail: vai para a senha (ou entra, se ela já estiver preenchida). Sem isto, o Enter mandaria o link.
  campoEmail?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    if (senha.value) entrarComSenha(); else senha.focus();
  });

  esqueci.addEventListener('click', async () => {
    const e = String(email() || '').trim();
    if (!EMAIL_OK.test(e)) { aviso('Digite o seu e-mail para receber o link de senha.'); form.querySelector('input[type="email"]')?.focus(); return; }
    esqueci.disabled = true;
    aviso('Enviando…', '');
    try {
      await auth.recover(e);
      aviso(`Enviamos um link para ${e.toLowerCase()}. Abra o e-mail e toque no link para definir a nova senha (vale 1 hora).`, 'ok');
    } catch (err) {
      aviso(err?.status === 429 ? 'Muitos pedidos em pouco tempo. Espere um minuto e tente de novo.'
        : 'Não foi possível enviar o e-mail agora. Tente de novo mais tarde ou fale com a equipe do IMED pela página "Fale com o IMED".');
    } finally {
      esqueci.disabled = false;
    }
  });
  return box;
}

// Mensagem curta para quando a entrada venceu (link ou senha).
export const ENTRADA_VENCIDA = 'Sua entrada expirou. Entre de novo abaixo (link por e-mail ou senha).';
export { esc };
