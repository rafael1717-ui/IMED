// Nenhuma página pública mostra dado de teste ou de exemplo como se fosse real (melhoria L11 da análise dos
// concorrentes: um concorrente mostrou perfis "(Teste)" em páginas públicas). Varre o que vai para o ar — as páginas
// da raiz (*.html), exames/, cidades/, o sitemap.xml e os arquivos de texto públicos (ARQUIVOS_DE_TEXTO) — e falha se
// aparecer "teste", "exemplo", "lorem ipsum", "demo", "demonstração", "fictício" ou "fulano" fora dos lugares onde
// isso é de propósito (EXCECOES, abaixo, cada uma com o motivo).
// Olha o que o visitante e o Google leem: o texto da página, o título e as descrições (meta), os textos de imagens e
// botões (alt, title, aria-label, aria-description e o value dos botões <input>), as dicas e o que já vem escrito
// dentro dos campos (placeholder e value) e os dados estruturados (JSON-LD). Nas páginas, não olha código,
// comentários, nomes de classes nem endereços de links (um nome de repositório como "testedosite" num endereço
// não conta), e "por exemplo" também não. Nos arquivos de texto, olha tudo (uma cidade "teste" num endereço conta).
// Limite: só lê o que já vem escrito nos arquivos; o texto que a página monta na hora (pelo JavaScript ou com dados
// do banco) fica de fora.
// Rodar com: node --test tests/sem-dado-de-teste.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Palavras de dado de teste ou de exemplo, como palavra inteira (sem acento, maiúscula ou minúscula, com número
// grudado: "teste2", "demo1"). "testedosite", "testar", "demora" e "exemplar" não contam.
const PALAVRAS = /(?<![\p{L}\p{N}_])(?:test(?:es?)?\d*|exemplos?|lorem|ipsum|demo\d*|demonstra(?:[çc][ãa]o|[çc][õo]es)|fict[íi]ci[oa]s?|fulan[oa]s?|(?:ciclan|sicran)[oa]s?|beltran[oa]s?)(?![\p{L}\p{N}_])/giu;
// "Por exemplo" é jeito de explicar, nunca dado.
const POR_EXEMPLO = /(?<![\p{L}\p{N}_])por\s+exemplo(?![\p{L}\p{N}_])/giu;

// Onde a palavra é de propósito (não é dado de teste fingindo ser real). paginas: caminhos a partir da raiz do site
// ('*' = qualquer página); trecho: o pedaço liberado (só ele: o resto da página continua sendo conferido); motivo:
// por que é de propósito. Para liberar um caso novo, acrescente aqui com o motivo.
// As dicas dentro dos campos aparecem como [placeholder: ...] e os textos de atributos como [alt: ...], [title: ...].
const EXCECOES = [
  {
    paginas: ['index.html'],
    trecho: /exemplo[\s:–-]*(?:perto\s+)?(?:da\s+)?Av\. Paulista|Av\. Paulista[^()]{0,40}\(exemplo\)/giu,
    motivo: 'a página inicial usa a Av. Paulista (São Paulo) como ponto de partida, marcado como exemplo, até a pessoa escolher a cidade ou usar a localização',
  },
  {
    paginas: ['perto.html'],
    trecho: /Demonstração\s+Clínica fictícia do modo de teste do site\./gu,
    motivo: 'legenda do selo "Demonstração" da busca: só aparece no modo de demonstração (perto.html?demo=1) e avisa que a clínica é fictícia',
  },
  {
    paginas: ['teleconsulta.html'],
    trecho: /Teste de câmera e microfone|Parar o teste|Imagem da sua câmera \(teste\)/gu,
    motivo: 'o teste de câmera e microfone antes da teleconsulta (é a função da página, não um dado)',
  },
  {
    paginas: ['acessibilidade.html'],
    trecho: /O site tem testes automáticos/gu,
    motivo: 'a página de acessibilidade explica que o site tem testes automáticos',
  },
  {
    paginas: ['termo-teleconsulta.html'],
    trecho: /Exemplos de sinais de alerta/gu,
    motivo: 'orientação de saúde do termo: exemplos de sinais de alerta para ir ao pronto-socorro',
  },
  {
    paginas: '*',
    trecho: /\[placeholder: voce@exemplo\.com/gu,
    motivo: 'dica dentro do campo de e-mail mostrando o formato (some quando a pessoa digita); não é um contato',
  },
];

// ---------- o que o visitante e o Google leem ----------
const ATRIBUTOS = new Set(['alt', 'title', 'aria-label', 'aria-description', 'placeholder', 'content', 'label']);
// O value aparece na tela só no <input> de texto (o que já vem escrito no campo) e nos botões <input type="submit">,
// "button" e "reset". O de <option>, de caixas de marcar e de campos escondidos não aparece: fica de fora.
const VALUE_NA_TELA = /^(?:text|search|email|tel|url|number|submit|button|reset)$/i;
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodificar = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m;
  const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
});
const TAG = /<[a-z][a-z0-9-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/gi;
const ATRIBUTO = /\s([^\s"'>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function textoPublico(html) {
  return decodificar(String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    // Dados estruturados (JSON-LD) contam: o Google mostra. O resto dos <script> é código (e a página só roda
    // script de arquivo: a política de segurança barra código no meio do HTML).
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, attrs, corpo) => (/application\/ld\+json/i.test(attrs) ? ` ${corpo} ` : ' '))
    .replace(TAG, (tag) => {
      const attrs = [...tag.matchAll(ATRIBUTO)].map((a) => [a[1].toLowerCase(), a[2] ?? a[3]]);
      // Tipo do <input> (sem type, é campo de texto); fora de um <input>, o value não aparece na tela.
      const tipo = /^<input\b/i.test(tag) ? (attrs.find(([nome]) => nome === 'type')?.[1] ?? 'text').trim() : '';
      const out = attrs.filter(([nome]) => ATRIBUTOS.has(nome) || (nome === 'value' && VALUE_NA_TELA.test(tipo)))
        .map(([nome, valor]) => `[${nome}: ${valor}]`);
      return ` ${out.join(' ')} `;
    })
    .replace(/<\/[a-z][^>]*>/gi, ' '));
}

// Achados de uma página: { palavra, contexto }. usadas: conta quantas vezes cada exceção liberou um trecho.
function achados(texto, pagina, usadas = new Map()) {
  let t = texto.replace(POR_EXEMPLO, (m) => ' '.repeat(m.length));
  for (const ex of EXCECOES) {
    if (ex.paginas !== '*' && !ex.paginas.includes(pagina)) continue;
    t = t.replace(ex.trecho, (m) => { usadas.set(ex, (usadas.get(ex) || 0) + 1); return ' '.repeat(m.length); });
  }
  return [...t.matchAll(PALAVRAS)].map((m) => ({
    palavra: m[0],
    contexto: texto.slice(Math.max(0, m.index - 45), m.index + m[0].length + 45).replace(/\s+/g, ' ').trim(),
  }));
}

// ---------- as páginas que vão para o ar ----------
// Arquivos de texto públicos da raiz, além das páginas: o llms.txt (gerado junto com as páginas das cidades e lido por
// assistentes de IA), o manifest.webmanifest (o nome e os atalhos que aparecem quando a pessoa instala o app) e o
// robots.txt. Os que ainda não existem na pasta ficam de fora; o sitemap.xml é obrigatório.
const ARQUIVOS_DE_TEXTO = ['llms.txt', 'manifest.webmanifest', 'robots.txt'];

function htmlDe(dir, recursivo, out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) { if (recursivo) htmlDe(rel, true, out); } else if (e.name.endsWith('.html')) out.push(rel);
  }
  return out;
}

test('a varredura acha dado de teste e de exemplo e deixa passar endereço, código e "por exemplo"', () => {
  const palavras = (html, pagina = 'qualquer.html') => achados(textoPublico(html), pagina).map((a) => a.palavra);
  // Achar (o que derrubaria a confiança no site):
  assert.deepEqual(palavras('<li><b>Clínica Teste</b> · (Teste)</li>'), ['Teste', 'Teste']);
  assert.deepEqual(palavras('<h3>Hospital Santa Exemplo</h3><p>Exemplo de preço</p>'), ['Exemplo', 'Exemplo']);
  assert.deepEqual(palavras('<p>Lorem ipsum dolor sit amet</p>'), ['Lorem', 'ipsum']);
  assert.deepEqual(palavras('<span>Clínica DEMO</span><span>demo2</span><span>teste123</span><span>test</span>'), ['DEMO', 'demo2', 'teste123', 'test']);
  assert.deepEqual(palavras('<p>Endereço de demonstração · Bela Vista</p><p>Clínica fictícia</p><p>Dr. Fulano de Tal</p>'), ['demonstração', 'fictícia', 'Fulano']);
  assert.deepEqual(palavras('<img src="a.webp" alt="Foto de teste"><meta name="description" content="Laboratório exemplo">'), ['teste', 'exemplo']);
  assert.deepEqual(palavras('<input placeholder="Paciente teste"><a href="x.html" title="Teste" aria-label="Exemplo">ok</a>'), ['teste', 'Teste', 'Exemplo']);
  assert.deepEqual(palavras('<script type="application/ld+json">{"@type":"MedicalClinic","name":"Laboratório Teste"}</script>'), ['Teste']);
  assert.deepEqual(palavras('<url><loc>https://x.github.io/testedosite/cidades/sp/teste/</loc></url>', 'sitemap.xml'), ['teste'], 'cidade de teste no mapa do site');
  assert.deepEqual(palavras('<p>Clínica&nbsp;Teste &amp; Cia</p>'), ['Teste']);
  assert.deepEqual(palavras('<input type="submit" value="Enviar teste"><input value="Clínica Demo"><button aria-description="Exemplo">Ok</button>'), ['teste', 'Demo', 'Exemplo'], 'texto do botão, valor já escrito no campo e descrição para o leitor de tela');
  assert.deepEqual(palavras('{"name":"IMED (teste)","short_name":"IMED","start_url":"./?origem=app"}', 'manifest.webmanifest'), ['teste'], 'nome do app instalado');
  assert.deepEqual(palavras('- [Clínica Exemplo](https://x.github.io/testedosite/local.html?id=1): demo\n', 'llms.txt'), ['Exemplo', 'demo'], 'texto para assistentes de IA');
  // Deixar passar:
  assert.deepEqual(palavras('<select><option value="teste">Raio-X</option></select><input type="hidden" value="demo"><input type="checkbox" value="exemplo"><input type="radio" value="teste2">'), [], 'value que não aparece na tela');
  assert.deepEqual(palavras('<link rel="canonical" href="https://x.github.io/testedosite/"><a href="/testedosite/perto.html">Perto de mim</a>'), [], 'nome do repositório nos endereços');
  assert.deepEqual(palavras('<span class="bd bd-demo" id="legDemo" data-x="teste">Selo</span><!-- teste --><style>.teste{color:red}</style><script src="assets/js/teste.js"></script>'), [], 'código, classe e comentário');
  assert.deepEqual(palavras('<p>Escreva, por exemplo, o CEP. Por exemplo: Recife/PE.</p>'), [], '"por exemplo"');
  assert.deepEqual(palavras('<p>Quanto tempo demora? Testar a câmera. Contestar. Atendimento exemplar. Testemunha. Democracia.</p>'), []);
  // As exceções liberam só o trecho, e só na página certa:
  assert.deepEqual(palavras('<span>Exemplo: Av. Paulista</span>', 'index.html'), []);
  assert.deepEqual(palavras('<small>Exemplo</small><b>Av. Paulista (São Paulo)</b>', 'index.html'), []);
  assert.deepEqual(palavras('<p>Exemplo: perto da Av. Paulista</p><p>perto da Av. Paulista, em São Paulo (exemplo)</p>', 'index.html'), []);
  assert.deepEqual(palavras('<span>Exemplo: Av. Paulista</span><p>Clínica Exemplo</p>', 'index.html'), ['Exemplo'], 'outro "Exemplo" na mesma página continua contando');
  assert.deepEqual(palavras('<span>Exemplo: Av. Paulista</span>', 'perto.html'), ['Exemplo'], 'a exceção é só da página inicial');
  assert.deepEqual(palavras('<input type="email" placeholder="voce@exemplo.com">'), [], 'dica de formato no campo de e-mail');
  assert.deepEqual(palavras('<p>Escreva para voce@exemplo.com</p>'), ['exemplo'], 'o mesmo e-mail no texto da página conta');
});

test('as exceções têm motivo e apontam para páginas que existem', () => {
  for (const ex of EXCECOES) {
    assert.ok(typeof ex.motivo === 'string' && ex.motivo.length >= 20, `motivo da exceção ${ex.trecho}`);
    assert.ok(ex.trecho.global && ex.trecho.unicode, `a exceção ${ex.trecho} precisa das marcas g e u`);
    if (ex.paginas !== '*') for (const p of ex.paginas) assert.ok(existsSync(join(ROOT, p)), `${p} (exceção ${ex.trecho}) não existe mais`);
  }
});

test('páginas e arquivos públicos (raiz, exames/, cidades/, sitemap.xml, llms.txt, manifest e robots.txt) sem dado de teste ou de exemplo como se fosse real', (t) => {
  const textos = ARQUIVOS_DE_TEXTO.filter((f) => existsSync(join(ROOT, f)));
  const paginas = [...htmlDe('', false), ...htmlDe('exames', true), ...htmlDe('cidades', true), 'sitemap.xml', ...textos];
  const conta = (pre) => paginas.filter((p) => (pre ? p.startsWith(pre) : !p.includes('/'))).length;
  assert.ok(conta('') >= 15, `páginas da raiz: ${conta('')}`);
  assert.ok(conta('exames/') >= 9, `guias de exames: ${conta('exames/')}`);
  assert.ok(conta('cidades/') >= 100, `páginas de cidades: ${conta('cidades/')}`);
  const usadas = new Map();
  const erros = [];
  for (const p of paginas) {
    const texto = textoPublico(readFileSync(join(ROOT, p), 'utf8'));
    for (const a of achados(texto, p, usadas)) erros.push(`${p}: «${a.palavra}» em “…${a.contexto}…”`);
  }
  t.diagnostic(`${paginas.length} páginas e arquivos conferidos (com sitemap.xml${textos.map((f) => `, ${f}`).join('')}); ${EXCECOES.length} exceções.`);
  // Exceção que não achou mais nada (a página mudou): só avisa; pode sair da lista.
  for (const ex of EXCECOES) if (!usadas.has(ex)) t.diagnostic(`exceção sem uso (a página mudou?): ${ex.trecho} — ${ex.motivo}`);
  assert.deepEqual(erros.slice(0, 40), [], `${erros.length} trecho(s) com cara de dado de teste ou de exemplo numa página pública. `
    + 'Se for dado de teste, tire da página (ou do banco, se a página é gerada, e gere de novo). Se for de propósito, '
    + 'acrescente em EXCECOES (tests/sem-dado-de-teste.test.mjs) o trecho e o motivo.');
});
