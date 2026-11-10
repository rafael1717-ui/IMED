// Grava o vídeo de divulgação do IMED com o site no ar: locais reais do CNES e mapa do OpenStreetMap.
//
// Roda no GitHub (Actions → "Vídeo de divulgação" → Run workflow), porque lá o mapa e o banco abrem.
// Só navega e rola as páginas: não envia pedido nenhum e não conta visita (o contador é respondido aqui mesmo).
// A teleconsulta fica de fora: só deve ser divulgada depois da inscrição da empresa no CREMESP.
//
//   node scripts/gravar-video.mjs [--url=https://...] [--saida=video] [--formatos=vertical,horizontal]
// Sem --url (ou com ele vazio), vale o endereço do site em assets/js/config.js (IMED_CONFIG.siteUrl).
//
// Na pasta de saída: imed-vertical.mp4 (1080×1920: Reels, Stories, TikTok e WhatsApp),
// imed-horizontal.mp4 (1920×1080: YouTube e site) e capturas/ com um quadro de cada cena.
// Precisa do Playwright e do ffmpeg.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');

const arg = (nome, padrao) => {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.slice(nome.length + 3) : padrao;
};
// Endereço do site: o de assets/js/config.js, a fonte única (para trocá-lo: node scripts/trocar-endereco.mjs).
const SITE_CONFIG = readFileSync(fileURLToPath(new URL('../assets/js/config.js', import.meta.url)), 'utf8').match(/siteUrl\s*:\s*['"]([^'"]+)['"]/)[1];
const URL_BASE = (arg('url', '') || SITE_CONFIG).replace(/\/?$/, '/');
const SAIDA = resolve(arg('saida', 'video'));
const FORMATOS = arg('formatos', 'vertical,horizontal').split(',').map((s) => s.trim()).filter(Boolean);

// Av. Paulista, o mesmo exemplo da página inicial. O site arredonda a posição e não grava.
const PAULISTA = { latitude: -23.5650, longitude: -46.6520 };
const NAVY = '#05161e';

// A escala (dsf) vai no próprio Chromium: com a escala só emulada, os quadros saem no tamanho da tela em CSS (360×640).
// No computador, a cidade 3D em tela grande, desenhada sem placa de vídeo (no servidor do GitHub), deixa a página
// quase parada (7 quadros por segundo, digitação travada; pausar não adianta, a cena continua sendo desenhada).
// Com "movimento reduzido" ela aparece pronta e parada, e o vídeo vai direto para a busca do exame.
const TELAS = {
  vertical: { viewport: { width: 360, height: 640 }, dsf: 3, movel: true, movimento: 'no-preference' },
  horizontal: { viewport: { width: 1280, height: 720 }, dsf: 1.5, movel: false, movimento: 'reduce' },
};
const UA_CELULAR = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// Cortina azul-marinho: cobre a página enquanto ela carrega e some depois (passagem suave entre as páginas).
// Também marca o aviso de privacidade como lido, para ele não cobrir a tela no vídeo.
const CORTINA = `(() => {
  try { localStorage.setItem('imed_lgpd', '1'); } catch (e) {}
  const pr = () => {
    if (document.getElementById('__cortina')) return;
    const c = document.createElement('div');
    c.id = '__cortina';
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'position:fixed;inset:0;background:${NAVY};z-index:2147483646;pointer-events:none;opacity:1;transition:opacity .55s ease';
    document.documentElement.appendChild(c);
    const tira = () => { c.style.opacity = '0'; };
    addEventListener('load', () => setTimeout(tira, 350), { once: true });
    setTimeout(tira, 4000);
  };
  if (document.documentElement) pr(); else addEventListener('DOMContentLoaded', pr, { once: true });
})();`;

async function fecharCortina(page) {
  await page.evaluate(() => {
    const c = document.getElementById('__cortina');
    if (c) { c.style.transition = 'opacity .45s ease'; c.style.opacity = '1'; }
  }).catch(() => {});
  await pausa(500);
}

async function ir(page, caminho) {
  await fecharCortina(page);
  await page.goto(URL_BASE + caminho, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
}

// Legenda grande por cima da página (só no vídeo; o site não muda).
async function legenda(page, texto, { movel }) {
  await page.evaluate(({ texto, movel }) => {
    let el = document.getElementById('__legenda');
    if (!el) {
      el = document.createElement('div');
      el.id = '__legenda';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = [
        'position:fixed', 'left:50%', `bottom:${movel ? 92 : 44}px`, 'z-index:2147483645', 'pointer-events:none',
        // Largura do próprio texto (até 90% da tela): com left 50% e largura automática, a caixa ficaria com só metade da tela.
        'width:max-content', `max-width:${movel ? '90vw' : '62vw'}`, 'box-sizing:border-box', `padding:${movel ? '12px 16px' : '14px 24px'}`,
        'border-radius:16px', 'background:rgba(5,22,30,.9)', 'color:#fff', 'text-align:center',
        `font:700 ${movel ? 19 : 26}px/1.3 Inter, system-ui, sans-serif`, 'letter-spacing:-.01em',
        'box-shadow:0 8px 30px rgba(0,0,0,.28)', 'border-bottom:4px solid #2EE6D6',
        'opacity:0', 'transform:translate(-50%, 12px)', 'transition:opacity .4s ease, transform .4s ease',
      ].join(';');
      document.documentElement.appendChild(el);
    }
    el.textContent = texto;
    el.getBoundingClientRect();
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, 0)';
  }, { texto, movel }).catch(() => {});
}

async function semLegenda(page) {
  await page.evaluate(() => {
    const el = document.getElementById('__legenda');
    if (el) { el.style.opacity = '0'; el.style.transform = 'translate(-50%, 12px)'; }
  }).catch(() => {});
  await pausa(400);
}

// Rola devagar (com aceleração suave) até o elemento, ou por "dy" pixels, no rolador mais próximo.
async function rolar(page, { ate, dy, ms = 1800, folga = 70 }) {
  await page.evaluate(async ({ ate, dy, ms, folga }) => {
    const alvo = ate ? document.querySelector(ate) : null;
    if (ate && !alvo) return;
    const rolavel = (el) => {
      for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 4) return p;
      }
      return document.scrollingElement;
    };
    const box = rolavel(alvo);
    const y0 = box.scrollTop;
    let y1 = alvo
      ? y0 + alvo.getBoundingClientRect().top - (box === document.scrollingElement ? 0 : box.getBoundingClientRect().top) - folga
      : y0 + dy;
    y1 = Math.max(0, Math.min(y1, box.scrollHeight - box.clientHeight));
    const t0 = performance.now();
    await new Promise((fim) => {
      const passo = (t) => {
        const k = Math.min(1, (t - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        box.scrollTo({ top: y0 + (y1 - y0) * e, behavior: 'instant' });
        if (k < 1) requestAnimationFrame(passo); else fim();
      };
      requestAnimationFrame(passo);
    });
  }, { ate, dy, ms, folga }).catch((e) => log('  (não rolou:', e.message.split('\n')[0], ')'));
}

// Círculo onde o dedo tocaria, sem rolar a tela nem clicar (some sozinho).
async function marcarToque(page, alvo) {
  const loc = typeof alvo === 'string' ? page.locator(alvo).first() : alvo;
  const b = await loc.boundingBox({ timeout: 2000 }).catch(() => null);
  if (b) await circulo(page, b);
  await pausa(280);
}

// Toque visível: um círculo aparece onde o dedo tocaria, depois clica.
async function tocar(page, alvo) {
  const loc = typeof alvo === 'string' ? page.locator(alvo).first() : alvo;
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const b = await loc.boundingBox({ timeout: 5000 });
  if (!b) throw new Error('sem posição na tela');
  await circulo(page, b);
  await pausa(280);
  await loc.click({ timeout: 5000 });
}

async function circulo(page, b) {
  await page.evaluate(({ x, y }) => {
    const d = document.createElement('div');
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;background:rgba(46,230,214,.45);border:2px solid rgba(255,255,255,.9);z-index:2147483647;pointer-events:none;transform:scale(.4);opacity:1;transition:transform .45s ease, opacity .6s ease .2s`;
    document.documentElement.appendChild(d);
    d.getBoundingClientRect();
    d.style.transform = 'scale(1.25)'; d.style.opacity = '0';
    setTimeout(() => d.remove(), 900);
  }, { x: b.x + b.width / 2, y: b.y + b.height / 2 }).catch(() => {});
}

async function cartaoFinal(page, { movel }) {
  const host = URL_BASE.replace(/^https?:\/\//, '').replace(/\/$/, '');
  await page.evaluate(({ host, movel, NAVY }) => {
    const c = document.createElement('div');
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:radial-gradient(120% 90% at 50% 20%, #0B7290 0%, ${NAVY} 70%);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${movel ? 14 : 18}px;text-align:center;padding:24px;box-sizing:border-box;font-family:Inter, system-ui, sans-serif;opacity:0;transition:opacity .7s ease`;
    c.innerHTML = `
      <div style="font:800 ${movel ? 64 : 96}px/1 Inter, system-ui, sans-serif;letter-spacing:-.03em">IMED</div>
      <div style="width:${movel ? 56 : 80}px;height:5px;border-radius:3px;background:#2EE6D6"></div>
      <div style="font:600 ${movel ? 21 : 30}px/1.35 Inter, system-ui, sans-serif;max-width:${movel ? 300 : 760}px">Clínicas, laboratórios e exames de imagem perto de você</div>
      <div style="font:500 ${movel ? 13 : 18}px/1.4 Inter, system-ui, sans-serif;opacity:.85;max-width:${movel ? 320 : 900}px;word-break:break-all">${host}</div>`;
    document.documentElement.appendChild(c);
    c.getBoundingClientRect();
    c.style.opacity = '1';
  }, { host, movel, NAVY });
}

// ---------------------------------------------------------------- roteiro
async function roteiro(page, tela, cena) {
  const movel = tela.movel;
  const L = (t) => legenda(page, t, { movel });

  await cena('inicio', async () => {
    await page.locator('#hero3d canvas, #heroLite:not([hidden])').first().waitFor({ timeout: 12000 }).catch(() => {});
    await pausa(1600);
    await L('Clínicas, laboratórios e exames de imagem perto de você');
    await pausa(3600);
  });

  await cena('mapa-reais', async () => {
    await semLegenda(page);
    await rolar(page, { ate: '#reais', ms: 2200, folga: 10 });
    if (movel) {
      // Celular: a lista dos mais perto vem primeiro; o mapa abre em tela cheia com um toque em "Ver no mapa"
      // (só aí o Leaflet é baixado) e fecha em "Voltar para a lista".
      await page.locator('#realList li a').first().waitFor({ timeout: 15000 }).catch(() => {});
      await pausa(900);
      await L('Locais reais, do cadastro oficial do Ministério da Saúde (CNES)');
      await pausa(3000);
      await semLegenda(page);
      await tocar(page, '#mapOpen');
      await page.locator('#realMap .leaflet-tile-loaded').first().waitFor({ timeout: 10000 }).catch(() => {});
      await pausa(700);
      await L('No mapa, os mesmos números da lista');
      await pausa(3200);
      await semLegenda(page);
      await tocar(page, '#mapClose');
      await pausa(900);
      await rolar(page, { dy: 360, ms: 1800 });
      await pausa(1400);
      return;
    }
    await page.locator('#realMap .leaflet-tile-loaded').first().waitFor({ timeout: 10000 }).catch(() => {});
    await pausa(700);
    await L('Locais reais, do cadastro oficial do Ministério da Saúde (CNES)');
    await pausa(3800);
    await rolar(page, { dy: 260, ms: 1800 });
    await pausa(1600);
  }, async () => {
    // Plano B: o mapa ficou aberto em tela cheia (algo falhou no meio da cena): fecha para a próxima cena.
    if (await page.locator('#pvMapa.cheio').count()) await page.keyboard.press('Escape');
  });

  await cena('busca-exame', async () => {
    await semLegenda(page);
    if (!movel) {
      await ir(page, 'perto.html?exame=rm');
      await L('Procure pelo exame que você precisa');
      await pausa(2400);
      return;
    }
    await rolar(page, { dy: -100000, ms: 1300 });
    await pausa(400);
    await L('Procure pelo exame que você precisa');
    // Foco e digitação direto pelo teclado, com o círculo do toque: o clique e o pressSequentially do Playwright
    // esperam a página parar de se mexer, e a cidade 3D sem placa de vídeo não deixa (as gravações de 30/10 falharam assim).
    await marcarToque(page, '#heroQ');
    await page.evaluate(() => document.querySelector('#heroQ').focus());
    await page.keyboard.type('ressonância', { delay: 115 });
    await page.locator('#heroSug .sug').first().waitFor({ timeout: 5000 });
    await pausa(1300);
    // Escolhe a primeira sugestão pelo teclado (seta para baixo e Enter), mostrando o toque onde ela está:
    // no computador, rolar a tela até a sugestão pode fechar a lista (a gravação de 30/10 falhou assim).
    await marcarToque(page, '#heroSug .sug');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForURL(/perto\.html/, { timeout: 15000 });
  }, async () => {
    await ir(page, 'perto.html?exame=rm');
  });

  await cena('resultados', async () => {
    await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    await page.locator('#list article.pc').first().waitFor({ timeout: 25000 });
    await pausa(1200);
    await L('Compare por distância, SUS e convênio');
    await pausa(2600);
    await rolar(page, { ate: '#list article.pc:nth-of-type(3)', ms: 2000, folga: 140 });
    await pausa(1400);
    if (movel && await page.locator('#viewToggle:not(.hide)').isVisible().catch(() => false)) {
      await tocar(page, '#viewToggle');
      await page.locator('#map .leaflet-tile-loaded').first().waitFor({ timeout: 10000 }).catch(() => {});
      await pausa(3200);
      await tocar(page, '#viewToggle');
      await pausa(900);
    } else {
      await pausa(1600);
    }
  });

  await cena('detalhe', async () => {
    await semLegenda(page);
    await rolar(page, { ate: '#list article.pc', ms: 1200, folga: 120 });
    await tocar(page, '#list article.pc .pc-open');
    await pausa(1000);
    await L('Veja endereço, como chegar e peça o agendamento');
    await pausa(3200);
    const link = page.locator('#sheet a[href*="local.html"], a[href*="local.html"]:visible').first();
    if (await link.count()) {
      await tocar(page, link);
      await page.waitForURL(/local\.html/, { timeout: 15000 }).catch(() => {});
    }
  });

  await cena('local', async () => {
    if (!/local\.html/.test(page.url())) throw new Error('não abriu a página do local');
    await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    await page.locator('h1').first().waitFor({ timeout: 15000 });
    await pausa(1800);
    await rolar(page, { dy: movel ? 520 : 380, ms: 2600 });
    await pausa(1800);
  });

  await cena('responsavel', async () => {
    await semLegenda(page);
    await rolar(page, { ate: '.rd-med', ms: 2200, folga: movel ? 260 : 300 });
    await L('Médico responsável: Dr. Rafael Pereira Barreto Silva · CRM-SP 266930');
    await pausa(3800);
  });

  await cena('final', async () => {
    await semLegenda(page);
    await cartaoFinal(page, { movel });
    await pausa(4200);
  });
}

// ---------------------------------------------------------------- gravação
function montar(quadros, fim, pasta, arquivo, tela) {
  const W = Math.round(tela.viewport.width * tela.dsf), H = Math.round(tela.viewport.height * tela.dsf);
  const linhas = ['ffconcat version 1.0'];
  quadros.forEach((q, i) => {
    const dur = Math.max(0.001, (quadros[i + 1]?.t ?? fim) - q.t);
    linhas.push(`file '${q.arq}'`, `duration ${dur.toFixed(4)}`);
  });
  linhas.push(`file '${quadros.at(-1).arq}'`);
  const lista = join(pasta, 'lista.ffconcat');
  writeFileSync(lista, linhas.join('\n') + '\n');
  const r = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lista,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${NAVY},fps=30,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-movflags', '+faststart', arquivo,
  ], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg falhou (${r.status})`);
}

async function gravar(formato) {
  const tela = TELAS[formato];
  if (!tela) throw new Error(`formato desconhecido: ${formato}`);
  log(`== ${formato}: ${tela.viewport.width}×${tela.viewport.height} @${tela.dsf}x`);
  const browser = await chromium.launch({
    args: [`--force-device-scale-factor=${tela.dsf}`, `--window-size=${tela.viewport.width},${tela.viewport.height}`],
  });
  const context = await browser.newContext({
    viewport: null, hasTouch: tela.movel,
    userAgent: tela.movel ? UA_CELULAR : undefined, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    geolocation: PAULISTA, permissions: ['geolocation'], serviceWorkers: 'block', reducedMotion: tela.movimento,
  });
  // O contador de visitas do site não conta a gravação.
  await context.route('**/rest/v1/rpc/track*', (r) => r.fulfill({ status: 204, body: '' }));
  await context.addInitScript(CORTINA);
  const page = await context.newPage();
  page.on('pageerror', (e) => log('  erro na página:', e.message.split('\n')[0]));

  const pasta = join(SAIDA, `quadros-${formato}`);
  rmSync(pasta, { recursive: true, force: true });
  mkdirSync(pasta, { recursive: true });
  mkdirSync(join(SAIDA, 'capturas'), { recursive: true });
  const quadros = [];
  await page.goto(URL_BASE + 'index.html', { waitUntil: 'commit', timeout: 45000 });
  // A sessão de gravação é aberta depois que a página começou a carregar (antes, a troca de processo do
  // about:blank para o site pode derrubar a sessão: "Not attached to an active page"). Tenta de novo se cair.
  let cdp;
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      cdp = await context.newCDPSession(page);
      const sessao = cdp;
      sessao.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        const arq = join(pasta, `${String(quadros.length).padStart(6, '0')}.jpg`);
        writeFileSync(arq, Buffer.from(data, 'base64'));
        quadros.push({ arq, t: metadata.timestamp });
        sessao.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      });
      await sessao.send('Page.startScreencast', {
        format: 'jpeg', quality: 90, everyNthFrame: 1,
        maxWidth: Math.round(tela.viewport.width * tela.dsf), maxHeight: Math.round(tela.viewport.height * tela.dsf),
      });
      break;
    } catch (e) {
      if (tentativa >= 5) throw e;
      log(`  (gravação ainda não começou: ${e.message.split('\n')[0]}; tentando de novo)`);
      await pausa(500);
    }
  }
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});

  const falhas = [];
  let n = 0;
  const cena = async (nome, fazer, plano) => {
    n += 1;
    log(`  cena ${n}: ${nome}`);
    try {
      await fazer();
    } catch (e) {
      log(`  ! ${nome}: ${e.message.split('\n')[0]}`);
      falhas.push(nome);
      if (plano) await plano().catch((e2) => log(`  ! plano B de ${nome}: ${e2.message.split('\n')[0]}`));
    }
    if (quadros.length) copyFileSync(quadros.at(-1).arq, join(SAIDA, 'capturas', `${formato}-${String(n).padStart(2, '0')}-${nome}.jpg`));
  };
  await roteiro(page, tela, cena);

  await cdp.send('Page.stopScreencast').catch(() => {});
  const fim = Date.now() / 1000;
  await context.close();
  await browser.close();
  if (quadros.length < 30) throw new Error(`poucos quadros gravados (${quadros.length})`);
  const arquivo = join(SAIDA, `imed-${formato}.mp4`);
  const duracao = fim - quadros[0].t;
  log(`  ${quadros.length} quadros em ${duracao.toFixed(1)} s; montando ${arquivo}`);
  montar(quadros, fim, pasta, arquivo, tela);
  rmSync(pasta, { recursive: true, force: true });
  return { formato, arquivo, quadros: quadros.length, segundos: Number(duracao.toFixed(1)), falhas };
}

mkdirSync(SAIDA, { recursive: true });
const feitos = [];
let erro = false;
for (const f of FORMATOS) {
  try {
    feitos.push(await gravar(f));
  } catch (e) {
    erro = true;
    log(`!! ${f}: ${e.message}`);
  }
}
writeFileSync(join(SAIDA, 'resumo.json'), JSON.stringify({ url: URL_BASE, feitos }, null, 2));
log('resumo:', JSON.stringify(feitos));
if (erro || !feitos.length) process.exit(1);
