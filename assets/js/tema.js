/* Tema do IMED: Automático (segue o aparelho; o padrão), Claro ou Escuro. Como usar: topo de assets/css/tema.css.
   Script clássico e SÍNCRONO no <head> de todas as páginas, logo depois do <meta name="theme-color"> e antes de
   qualquer CSS (node scripts/aplicar-tema.mjs; as cidades pelo gerador): marca o <html> antes da primeira pintura.
   <html data-theme="light|dark"> = o tema que vale agora; <html data-tema-escolha="auto|claro|escuro"> = a escolha.
   A escolha fica no aparelho (localStorage "imed_tema"; Automático = sem chave) e vale para todas as páginas e abas;
   sem armazenamento, segue o aparelho. O <meta name="theme-color"> acompanha o tema.
   Botões (ligados por delegação, também os criados depois): button[data-tema] alterna Automático → Claro → Escuro;
   button[data-tema-opcao="claro"] escolhe direto (rodapé). window.IMED_TEMA: atual(), escolher(), alternar(),
   ligar() e as regras puras; evento "imed:tema" no document, com detail { escolha, tema }.
   No Node (tests/tema.test.mjs) devolve só as regras puras. */
(function () {
  'use strict';
  var CHAVE = 'imed_tema', ESCOLHAS = ['auto', 'claro', 'escuro'], COR_ESCURA = '#080D20'; // = --bg escuro (visual novo: assets/css/visual.css)
  var NOMES = { auto: 'automático', claro: 'claro', escuro: 'escuro' };

  function normalizar(v) { return v === 'claro' || v === 'escuro' ? v : 'auto'; }
  // 'claro' ou 'escuro'; aparelhoEscuro = o aparelho pede tema escuro (prefers-color-scheme: dark).
  function efetivo(escolha, aparelhoEscuro) {
    var e = normalizar(escolha);
    return e === 'auto' ? (aparelhoEscuro ? 'escuro' : 'claro') : e;
  }
  function proxima(escolha) { return ESCOLHAS[(ESCOLHAS.indexOf(normalizar(escolha)) + 1) % ESCOLHAS.length]; }
  function rotulo(escolha) { return 'Tema: ' + NOMES[normalizar(escolha)]; }
  // O que o leitor de tela fala depois de uma troca.
  function aviso(escolha, tema) {
    var e = normalizar(escolha);
    return e === 'auto' ? 'Tema automático, igual ao do aparelho (agora ' + (tema === 'escuro' ? 'escuro' : 'claro') + ')' : 'Tema ' + e;
  }
  function atributo(tema) { return tema === 'escuro' ? 'dark' : 'light'; }
  // Barra do navegador: no escuro, a do meta (data-escuro) ou o fundo escuro; no claro, a cor da própria página.
  function corDaBarra(tema, corClara, corEscura) { return tema === 'escuro' ? (corEscura || COR_ESCURA) : corClara; }

  var regras = { CHAVE: CHAVE, ESCOLHAS: ESCOLHAS.slice(), COR_ESCURA: COR_ESCURA, normalizar: normalizar, efetivo: efetivo,
    proxima: proxima, rotulo: rotulo, aviso: aviso, atributo: atributo, corDaBarra: corDaBarra };
  if (typeof module === 'object' && module && module.exports) module.exports = regras;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var raiz = document.documentElement, mq = null, barra = null, barraClara = null, criada = false, fala = null;
  try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) { mq = null; }
  function ler() { try { return normalizar(window.localStorage.getItem(CHAVE)); } catch (e) { return null; } } // null: sem armazenamento
  function gravar(e) {
    try { if (e === 'auto') window.localStorage.removeItem(CHAVE); else window.localStorage.setItem(CHAVE, e); } catch (x) { /* fica só nesta página */ }
  }
  var estado = { escolha: ler() || 'auto', tema: '' };

  function pintarBarra() {
    if (!barra || !barra.isConnected) {
      barra = document.querySelector('meta[name="theme-color"]:not([media])');
      barraClara = barra ? barra.getAttribute('content') : null;
      criada = false;
    }
    if (estado.tema === 'escuro') {
      if (!barra && document.head) {
        barra = document.head.appendChild(document.createElement('meta'));
        barra.setAttribute('name', 'theme-color');
        criada = true;
      }
      if (barra) barra.setAttribute('content', corDaBarra('escuro', barraClara, barra.getAttribute('data-escuro')));
    } else if (barra && criada) {
      barra.parentNode.removeChild(barra);
      barra = null;
    } else if (barra && barra.getAttribute('content') !== barraClara) {
      if (barraClara === null) barra.removeAttribute('content'); else barra.setAttribute('content', barraClara);
    }
  }

  function ligar(onde) {
    var r = onde && onde.querySelectorAll ? onde : document, i, b = r.querySelectorAll('button[data-tema]');
    for (i = 0; i < b.length; i++) { b[i].setAttribute('aria-label', rotulo(estado.escolha)); b[i].setAttribute('title', rotulo(estado.escolha)); }
    b = r.querySelectorAll('button[data-tema-opcao]');
    for (i = 0; i < b.length; i++) b[i].setAttribute('aria-pressed', String(normalizar(b[i].getAttribute('data-tema-opcao')) === estado.escolha));
  }

  function aplicar() {
    estado.tema = efetivo(estado.escolha, !!(mq && mq.matches));
    raiz.setAttribute('data-theme', atributo(estado.tema));
    raiz.setAttribute('data-tema-escolha', estado.escolha);
    pintarBarra();
    ligar();
  }
  function atual() { return { escolha: estado.escolha, tema: estado.tema }; }

  // Leitor de tela: região "ao vivo" escondida, criada quando a pessoa chega num botão de tema.
  function regiaoFala() {
    if (fala && fala.isConnected) return fala;
    if (!document.body) return null;
    fala = document.createElement('div');
    fala.className = 'tema-fala';
    fala.setAttribute('role', 'status');
    fala.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    return document.body.appendChild(fala);
  }

  // Troca as cores de uma vez (sem cada transição da página num tempo) e avisa quem estiver ouvindo.
  function trocar(escolha, porPessoa) {
    var antes = estado.escolha + estado.tema;
    estado.escolha = normalizar(escolha);
    raiz.classList.add('tema-trocando');
    aplicar();
    void (document.body || raiz).offsetHeight; // calcula as cores novas já sem transições
    var volta = function () { raiz.classList.remove('tema-trocando'); };
    if (window.requestAnimationFrame) window.requestAnimationFrame(volta); else setTimeout(volta, 0);
    var r = porPessoa && regiaoFala();
    if (r) {
      r.textContent = '';
      setTimeout(function () { r.textContent = aviso(estado.escolha, estado.tema); }, 80);
    }
    if (antes !== estado.escolha + estado.tema) {
      try { document.dispatchEvent(new CustomEvent('imed:tema', { bubbles: true, detail: atual() })); } catch (e) { /* navegador antigo */ }
    }
    return atual();
  }
  function escolher(escolha, porPessoa) { gravar(normalizar(escolha)); return trocar(escolha, porPessoa); }
  function alternar(porPessoa) { return escolher(proxima(estado.escolha), porPessoa); }
  // Outra aba mudou a escolha, ou a página voltou pelo histórico (a escolha ou o aparelho podem ter mudado): acompanha.
  function sincronizar() {
    var e = ler();
    if (e === null) e = estado.escolha;
    if (e !== estado.escolha || efetivo(e, !!(mq && mq.matches)) !== estado.tema) trocar(e, false);
  }

  aplicar(); // antes da primeira pintura

  if (mq) {
    var mudou = function () { if (estado.escolha === 'auto') trocar('auto', false); };
    if (mq.addEventListener) mq.addEventListener('change', mudou); else if (mq.addListener) mq.addListener(mudou);
  }
  window.addEventListener('storage', function (ev) { if (ev.key === CHAVE || ev.key === null) sincronizar(); });
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) sincronizar(); });
  var botao = function (ev) { return ev.target && ev.target.closest ? ev.target.closest('button[data-tema], button[data-tema-opcao]') : null; };
  // Na captura: funciona mesmo se a página parar o clique (stopPropagation) no cabeçalho ou num menu.
  document.addEventListener('click', function (ev) {
    var b = botao(ev);
    if (!b || b.disabled) return;
    if (b.hasAttribute('data-tema-opcao')) escolher(b.getAttribute('data-tema-opcao'), true); else alternar(true);
  }, true);
  document.addEventListener('focusin', function (ev) { if (botao(ev)) regiaoFala(); });
  document.addEventListener('DOMContentLoaded', function () {
    // O meta criado acima sobra se a página tiver o próprio theme-color depois deste script.
    if (criada && document.querySelectorAll('meta[name="theme-color"]:not([media])').length > 1) { barra.parentNode.removeChild(barra); barra = null; }
    pintarBarra();
    ligar();
  });

  window.IMED_TEMA = Object.assign({
    atual: atual,
    escolher: function (escolha) { return escolher(escolha, false); },
    alternar: function () { return alternar(false); },
    ligar: ligar,
  }, regras);
})();
