// Testes do rodapé igual em todas as páginas (scripts/rodape.mjs e scripts/aplicar-rodape.mjs)
// e da faxina do conteúdo inventado (página "Para clínicas", versão antiga do site, app instalado).
// Rodar com: node --test tests/rodape.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rodapeHtml, rodapeHref, GRUPOS, CFM_URL, FONTE, INICIO, FIM } from '../scripts/rodape.mjs';
import { OBRIGATORIAS, paginas, relDe, aplicar, temMarcadores } from '../scripts/aplicar-rodape.mjs';
import { generate, TYPES, cityDir, typePath } from '../scripts/gerar-cidades.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

test('modelo do rodapé: médico responsável, CFM, emergência, fonte dos dados e links', () => {
  const h = rodapeHtml('');
  assert.ok(h.startsWith(INICIO) && h.endsWith(FIM));
  assert.match(h, /Médico responsável: <b>Dr\. Rafael Pereira Barreto Silva<\/b> — <span class="rd-nw">CRM-SP 266930<\/span>/);
  assert.ok(h.includes(`<a href="${CFM_URL}" target="_blank" rel="noopener">conferir no CFM`), 'link para conferir no CFM');
  assert.equal(CFM_URL, 'https://portal.cfm.org.br/busca-medicos/');
  assert.match(h, /Emergência\? Ligue <a href="tel:192">192 \(SAMU\)<\/a>/);
  assert.equal(FONTE, 'Dados de endereço: CNES/Ministério da Saúde. O IMED é um serviço privado, sem vínculo com o governo ou o SUS.');
  assert.ok(h.includes(FONTE));
  const links = [...h.matchAll(/<a href="([^"]+)"[^>]*>(?:<[^>]+><\/i>)?([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]);
  for (const [txt, href] of [['Quem somos', 'sobre.html'], ['Como funciona', 'como-funciona.html'], ['Termos de uso', 'termos.html'],
    ['Privacidade', 'privacidade.html'], ['Acessibilidade', 'acessibilidade.html'], ['Fale com o IMED', 'contato.html'],
    ['Teleconsulta', 'teleconsulta.html'], ['Meus pedidos', './#agenda'], ['Para clínicas', 'parceiros.html']]) {
    assert.ok(links.some(([t, l]) => t === txt && l === href), `${txt} → ${href}`);
  }
  assert.match(h, /class="rd-a11y"><i class="fa-solid fa-universal-access" aria-hidden="true"><\/i>Acessibilidade/, 'símbolo de acessibilidade');
  assert.ok(!/Criado por|contato@imed|técnico|diretor/i.test(h), 'sem "Criado por", e-mail que não é do IMED nem título não confirmado');
  // Caminhos a partir da raiz, de exames/, das cidades e da página 404 (absoluta).
  assert.deepEqual([rodapeHref('', ''), rodapeHref('', '#agenda'), rodapeHref('', 'sobre.html')], ['./', './#agenda', 'sobre.html']);
  assert.deepEqual([rodapeHref('../', ''), rodapeHref('../', '#agenda'), rodapeHref('../', 'cidades/')], ['../', '../#agenda', '../cidades/']);
  assert.deepEqual([rodapeHref('/REPO/', ''), rodapeHref('/REPO/', 'termos.html')], ['/REPO/', '/REPO/termos.html']);
  assert.equal(relDe('exames/raio-x.html'), '../');
  assert.equal(relDe('index.html'), '');
  assert.equal(relDe('404.html'), new URL(read('assets/js/config.js').match(/siteUrl\s*:\s*'([^']+)'/)[1]).pathname);
});

test('todas as páginas fixas têm o rodapé atual (um só) e o CSS dele', () => {
  for (const f of OBRIGATORIAS) {
    assert.ok(existsSync(join(ROOT, f)), `${f} existe`);
    const html = read(f);
    assert.ok(temMarcadores(html), `${f}: marcadores do rodapé`);
    assert.equal(aplicar(html, relDe(f)), html, `${f}: rodapé desatualizado (rode node scripts/aplicar-rodape.mjs)`);
    assert.equal((html.match(/<footer\b/g) || []).length, 1, `${f}: um rodapé só`);
    assert.ok(html.includes(`<link rel="stylesheet" href="${relDe(f)}assets/css/rodape.css">`), `${f}: rodape.css`);
    assert.ok(html.includes('assets/vendor/fa/css/icones.min.css'), `${f}: ícones do rodapé (recorte do site, scripts/fontes.mjs)`);
  }
  // Páginas de outras frentes (ex.: teleconsulta.html) com os marcadores recebem o rodapé quando alguém roda
  // node scripts/aplicar-rodape.mjs; aqui só se confere que o script sabe fazer isso sem estragar a página.
  for (const f of paginas().filter((x) => !OBRIGATORIAS.includes(x))) {
    const html = read(f);
    if (!temMarcadores(html)) continue;
    const novo = aplicar(html, relDe(f));
    assert.equal(aplicar(novo, relDe(f)), novo, `${f}: aplicar de novo não muda nada`);
    assert.equal((novo.match(/<footer class="rodape">/g) || []).length, 1, `${f}: um rodapé só`);
  }
});

test('links do rodapé levam a páginas que existem', () => {
  for (const [, links] of GRUPOS) {
    for (const [, path] of links) {
      if (!path || path.startsWith('#')) continue;
      assert.ok(existsSync(join(ROOT, path.endsWith('/') ? `${path}index.html` : path)), path);
    }
  }
});

test('páginas das cidades: mesmo rodapé, fonte com "sem vínculo com o governo" e emergência nos hospitais', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'imed-rodape-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const cities = [{ ibge: 3550308, name: 'São Paulo', uf: 'SP', total: 10, imagem: 2, laboratorio: 2, clinica: 4, hospital: 2 }];
  generate({ cities, base: 'https://exemplo.com.br/', date: '2026-10-30', out, examPages: [] });
  const idx = readFileSync(join(out, 'cidades/index.html'), 'utf8');
  assert.ok(idx.includes(rodapeHtml('../')), 'índice: rodapé com ../');
  assert.ok(idx.includes('<link rel="stylesheet" href="../assets/css/rodape.css">'));
  const city = readFileSync(join(out, cityDir(cities[0]), 'index.html'), 'utf8');
  assert.ok(city.includes(rodapeHtml('../../../')), 'cidade: rodapé com ../../../');
  assert.equal((city.match(/<footer\b/g) || []).length, 1);
  assert.match(city, /base pública do Ministério da Saúde.*O IMED é um serviço privado, sem vínculo com o governo ou o SUS/s);
  for (const tp of TYPES) {
    const page = readFileSync(join(out, typePath(cities[0], tp)), 'utf8');
    assert.ok(page.includes(rodapeHtml('../../../')), tp.file);
    const sos = page.includes('class="cd-sos"');
    assert.equal(sos, tp.kind === 'hospital', `${tp.file}: aviso de emergência só na página de hospitais`);
  }
});

test('faxina: versão antiga, retratos e prints do app antigo fora do site', () => {
  assert.equal(existsSync(join(ROOT, 'versao-anterior.html')), false);
  const imgs = readdirSync(join(ROOT, 'assets/img'));
  assert.deepEqual(imgs.filter((f) => /^(av-|screen-|medica|paciente)/.test(f)), [], 'sem retratos nem prints antigos');
  const sm = read('sitemap.xml');
  assert.ok(!sm.includes('versao-anterior'));
  assert.ok(sm.includes('como-funciona.html') && sm.includes('acessibilidade.html'));
  assert.ok(sm.includes('/contato.html</loc>'), 'Fale com o IMED no sitemap');
});

test('faxina: nada inventado nem contato que não é do IMED nas páginas e scripts do site', () => {
  const files = [...paginas(), ...readdirSync(join(ROOT, 'assets/js')).filter((f) => f.endsWith('.js')).map((f) => `assets/js/${f}`)];
  const proibido = [
    [/contato@imed\.com\.br/, 'e-mail de um domínio que não é do IMED'],
    [/Criado por/, '"Criado por" no lugar do médico responsável'],
    [/Agendados/, '"Agendados" (é "Meus pedidos")'],
    [/[Rr]esponsável técnico médico|[Dd]iretor técnico/, 'título ainda não confirmado com o CREMESP'],
    [/Super Clínica|Mais escolhido|\+500|\+50 mil|4,8 ★|protótipo/i, 'número, selo ou plano inventado'],
    [/Teleconsulta \(em breve\)|médicos de verdade/, 'teleconsulta "em breve" antiga'],
  ];
  for (const f of files) {
    // Páginas e scripts de outras frentes desta noite (teleconsulta) ficam de fora.
    if (/^(teleconsulta|medico|termo-teleconsulta)\.html$|assets\/js\/(teleconsulta|medico|tele-core)\.js$/.test(f)) continue;
    const src = read(f);
    for (const [re, why] of proibido) assert.ok(!re.test(src), `${f}: ${why}`);
  }
  // O texto da página (sem o <style> e o <head>), como o visitante lê.
  const parc = read('parceiros.html');
  const texto = parc.slice(parc.indexOf('<body>')).replace(/<[^>]+>/g, ' ');
  assert.ok(!/R\$|★|\d+ ?%|depoimento|Pix e cartão|por agendamento/i.test(texto), 'Para clínicas: sem preço, nota, comissão, depoimento ou pagamento pelo app');
  assert.match(parc, /Cadastro sem custo/);
  assert.match(parc, /href="reivindicar\.html"/);
  assert.match(parc, /id="pform"/, 'formulário de contato de clínicas continua');
});

test('app instalado (manifest): texto sem nota, preço ou horário e atalhos para páginas que existem', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.ok(!/nota|preço|horário/i.test(m.description), m.description);
  const urls = m.shortcuts.map((s) => s.url);
  assert.ok(urls.includes('./teleconsulta.html'), 'atalho da teleconsulta para a página nova');
  assert.ok(!urls.some((u) => /#(lojas|tele)$/.test(u)), 'sem atalho para âncoras antigas');
  for (const u of urls) {
    const path = u.replace(/^\.\//, '').replace(/[?#].*$/, '') || 'index.html';
    assert.ok(existsSync(join(ROOT, path.endsWith('/') ? `${path}index.html` : path)), u);
  }
});

test('páginas de texto com título, descrição e imagem de compartilhamento', () => {
  for (const f of ['sobre.html', 'termos.html', 'privacidade.html', 'como-funciona.html', 'acessibilidade.html', 'parceiros.html', 'contato.html', 'para-medicos.html']) {
    const html = read(f);
    for (const re of [/<title>[^<]+\| IMED<\/title>/, /<meta name="description" content="[^"]{40,}">/, /<meta property="og:title" content="[^"]+">/,
      /<meta property="og:description" content="[^"]+">/, /<meta property="og:image" content="https:\/\/[^"]+\/assets\/img\/og\.jpg(\?v=\d+)?">/,
      /<meta property="og:url" content="https:\/\/[^"]+">/, /<link rel="canonical" href="https:\/\/[^"]+">/]) {
      assert.match(html, re, `${f}: ${re}`);
    }
  }
});

test('imagem de compartilhamento: JPEG de 1200 x 630', () => {
  const b = readFileSync(join(ROOT, 'assets/img/og.jpg'));
  assert.equal(b.readUInt16BE(0), 0xffd8, 'JPEG');
  let i = 2, size = null;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) { size = { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; break; }
    i += 2 + b.readUInt16BE(i + 2);
  }
  assert.deepEqual(size, { w: 1200, h: 630 });
  assert.ok(b.length < 300 * 1024, `leve para o WhatsApp (${Math.round(b.length / 1024)} KB)`);
});
