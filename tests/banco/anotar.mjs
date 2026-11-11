// Transforma a saída de um passo do banco.yml em avisos (anotações) no topo da execução do GitHub.
// O registro completo das execuções fica num lugar que o Claude não consegue ler: só os avisos aparecem
// (gh api .../check-runs/<job>/annotations). Cada aviso leva até 14 linhas úteis, sem linhas vazias.
//
//   node tests/banco/anotar.mjs migracoes <registro>        "supabase start" ou "supabase migration up" que falhou:
//                                                           a migração culpada (nome, erro, SQLSTATE, comando) ou,
//                                                           se o banco subiu, o fim do registro e o dos contêineres
//   node tests/banco/anotar.mjs vigia <registro com hora> <vigia.log>   em quanto tempo o vigia desligou o pg_cron
//   node tests/banco/anotar.mjs pgtap <registro>            cada teste pgTAP que falhou (com have/want) e erros de SQL
//   node tests/banco/anotar.mjs cauda "<título>" <registro> as últimas linhas do registro
//   node tests/banco/anotar.mjs resumo <pasta> "<passos>"   o resumo de todos os passos (até 3 notas de 40 linhas)
//   node tests/banco/anotar.mjs impressao <arquivo> "<rótulo>"         resumo por tipo da impressão digital
//   node tests/banco/anotar.mjs impressao-linhas <arquivo> "<tipos>"   as linhas da impressão, em notas
//     (a impressão é a saída de tests/banco/catalogo.sql; o resumo por tipo é igual ao que a mesma consulta dá na
//      produção, para conferir que o banco do CI é igual ao de lá)
//
// O GitHub mostra no máximo 10 avisos de erro por passo e 50 por execução: aqui são no máximo 8 por chamada.

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { anotar, cortarBytes, MAX_BYTES_AVISO } from './lib.mjs';

const [modo, ...resto] = process.argv.slice(2);
const MAX = 8;
const ler = (arq) => (existsSync(arq) ? readFileSync(arq, 'utf8') : '')
  // tira cores e o \r das barras de progresso
  .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n').replace(/\r/g, '');
const linhasDe = (texto) => texto.split('\n').map((l) => l.replace(/\s+$/, ''));
const util = (l) => l.trim() !== '';

function cauda(titulo, texto, n = 42) {
  const linhas = linhasDe(texto).filter(util).slice(-n);
  anotar('error', titulo, linhas.length ? linhas.join('\n') : '(registro vazio)', { maxAvisos: 3 });
}

// Saída de "supabase start" ou de "supabase migration up". A CLI aplica as migrações ANTES de escrever
// "Starting containers..." e, quando uma falha, escreve no fim o erro do banco (com SQLSTATE e "At statement: N").
// Só culpa uma migração se esse erro existe e o banco não chegou a subir os outros contêineres; senão, o título é
// "O Supabase local não subiu", com o fim do registro e o registro de cada contêiner que a CLI mostrou
// ("<contêiner> container logs:", quando um não fica de pé a tempo).
function migracoes(texto) {
  const linhas = linhasDe(texto);
  const iConteineres = linhas.findIndex((l) => /^Starting containers\.\.\./.test(l.trim()));
  const fimMigracoes = iConteineres >= 0 ? iConteineres : linhas.length;
  let ultimaMig = -1;
  for (let i = 0; i < fimMigracoes; i++) if (/Applying migration /.test(linhas[i])) ultimaMig = i;
  const iErro = iConteineres < 0 && ultimaMig >= 0
    ? linhas.findIndex((l, i) => i > ultimaMig && /(SQLSTATE|At statement:)/.test(l)) : -1;
  if (iErro >= 0) {
    const migracao = linhas[ultimaMig].match(/Applying migration (\S+?)(\.\.\.)?$/)?.[1] ?? '?';
    const aplicadas = linhas.filter((l) => /Applying migration /.test(l)).length;
    const bloco = linhas.slice(Math.max(ultimaMig + 1, iErro - 2), iErro + 40).filter(util);
    anotar('error', `Migração falhou - ${migracao}`,
      `${migracao} (${aplicadas}ª aplicada neste passo) falhou num banco novo:\n${bloco.join('\n')}`, { maxAvisos: 3 });
    return;
  }
  // Registros dos contêineres que a CLI despejou (cada um até o próximo).
  const secoes = [];
  linhas.forEach((l, i) => {
    const m = l.trim().match(/^(\S+) container logs:$/);
    if (m) secoes.push({ nome: m[1], ini: i + 1 });
  });
  secoes.forEach((sec, k) => { sec.fim = k + 1 < secoes.length ? secoes[k + 1].ini - 1 : linhas.length; });
  // O erro final da CLI vem depois do último registro de contêiner: as 6 últimas linhas do registro entram sempre.
  const foraDasSecoes = linhas.filter((_, i) => !secoes.some((sec) => i >= sec.ini - 1 && i < sec.fim));
  const fim = linhas.filter(util).slice(-6);
  const visivel = secoes.length ? [...foraDasSecoes.filter(util).slice(-22), '(...)', ...fim] : linhas;
  cauda(ultimaMig >= 0 && iConteineres < 0 ? 'O Supabase local não subiu (durante as migrações)' : 'O Supabase local não subiu',
    visivel.join('\n'), 28);
  for (const sec of secoes.slice(0, 2)) {
    const corpo = linhas.slice(sec.ini, sec.fim).filter(util);
    const erros = corpo.filter((l) => /(error|fatal|panic|fail|refused|denied|exception|timeout)/i.test(l));
    anotar('error', `Registro do contêiner ${sec.nome}`, (erros.length ? erros : corpo).slice(-14).join('\n') || '(vazio)',
      { maxAvisos: 1 });
  }
}

function pgtap(texto) {
  const linhas = linhasDe(texto);
  const blocos = [];
  let arquivo = '';
  for (let i = 0; i < linhas.length && blocos.length < MAX; i++) {
    const l = linhas[i];
    const arq = l.match(/(?:^|\/)([\w.-]+\.(?:sql|pg))\s+\.{2,}/);
    if (arq) arquivo = arq[1];
    if (/^#\s+Failed test/.test(l)) {
      const b = [l.replace(/^#\s+/, '')];
      for (let j = i + 1; j < linhas.length && b.length < 14; j++) {
        if (!/^#/.test(linhas[j]) || /^#\s+(Failed test|Looks like)/.test(linhas[j])) break;
        if (util(linhas[j].replace(/^#/, ''))) b.push(linhas[j].replace(/^#\s?/, ''));
      }
      blocos.push({ titulo: `pgTAP reprovou - ${arquivo || 'teste'}`, texto: b.join('\n') });
    } else if (/psql:.*(ERROR|FATAL):/.test(l)) {
      const b = [l];
      for (let j = i + 1; j < linhas.length && b.length < 14; j++) {
        if (!/^(DETAIL|HINT|CONTEXT|LINE \d+|QUERY|\s|psql:.*(DETAIL|HINT|CONTEXT|LINE))/.test(linhas[j])) break;
        if (util(linhas[j])) b.push(linhas[j]);
      }
      const nome = l.match(/psql:(?:.*\/)?([\w.-]+\.(?:sql|pg)):\d+/)?.[1] ?? arquivo;
      blocos.push({ titulo: `Erro de SQL no teste - ${nome || 'pgTAP'}`, texto: b.join('\n') });
    } else if (/(Bad plan|Dubious, test returned|No subtests run|planned \d+ tests? but ran)/.test(l)) {
      blocos.push({ titulo: `pgTAP parou no meio - ${arquivo || 'teste'}`, texto: l.trim() });
    }
  }
  const vistos = new Set();
  const unicos = blocos.filter((b) => !vistos.has(b.texto) && vistos.add(b.texto));
  if (!unicos.length) return cauda('pgTAP falhou', texto);
  for (const b of unicos) anotar('error', b.titulo, b.texto, { maxAvisos: 1 });
  const resultado = linhasDe(texto).filter((l) => /^(Files=|Result:|Failed \d+\/\d+ test programs)/.test(l));
  if (resultado.length) anotar('error', 'pgTAP - resultado', resultado.join('\n'), { maxAvisos: 1 });
}

// O resumo vai em até 7 notas de no máximo 40 linhas e ~3.800 bytes cada (o GitHub corta cada anotação em ~4.096
// bytes e mostra no máximo 10 notas por passo; eram 5 até os testes do pagamento entrarem). Se passar disso, um aviso diz quantas linhas ficaram de fora; o
// resumo inteiro fica no resumo da execução (GITHUB_STEP_SUMMARY).
function resumo(pasta, passos) {
  const linhas = [];
  if (passos) linhas.push(`Passos: ${passos}`);
  const arquivos = existsSync(pasta) ? readdirSync(pasta).sort() : [];
  for (const a of arquivos) {
    const p = path.join(pasta, a);
    if (a.endsWith('.txt')) linhas.push(...linhasDe(readFileSync(p, 'utf8')).filter(util));
    else if (a.endsWith('.json')) {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      for (const n of j.notas ?? []) linhas.push(`${j.nome}: ${n}`);
    }
  }
  if (!linhas.length) linhas.push('nenhum passo deixou resumo');
  const POR_NOTA = 40;
  const MAX_NOTAS = 7;
  const blocos = [];
  let atual = [];
  let bytes = 0;
  for (const bruta of linhas) {
    const l = cortarBytes(bruta, 1500);
    const b = Buffer.byteLength(l, 'utf8') + 1;
    if (atual.length && (atual.length >= POR_NOTA || bytes + b > MAX_BYTES_AVISO)) { blocos.push(atual); atual = []; bytes = 0; }
    atual.push(l);
    bytes += b;
  }
  if (atual.length) blocos.push(atual);
  const mostrados = blocos.slice(0, MAX_NOTAS);
  mostrados.forEach((b, k) => {
    anotar('notice', mostrados.length > 1 ? `Resumo do banco (${k + 1}/${mostrados.length})` : 'Resumo do banco', b.join('\n'),
      { maxAvisos: 1, maxLinhas: POR_NOTA });
  });
  if (blocos.length > MAX_NOTAS) {
    const fora = blocos.slice(MAX_NOTAS).reduce((n, b) => n + b.length, 0);
    anotar('warning', 'Resumo do banco cortado',
      `${linhas.length} linhas; ${fora} ficaram fora das notas (estão no resumo da execução).`, { maxAvisos: 1 });
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Resumo do banco\n\n${linhas.map((l) => `- ${l}`).join('\n')}\n`);
  }
}

/* ===================== Vigia do pg_cron (banco.yml, passo F0) ===================== */
// <registro com hora>: cada linha do "supabase start" com o instante (ms) na frente; <vigia.log>: "<ms> conectou",
// "<ms> cron" (o schema cron apareceu) e "<ms> desligou <n>". A migração da fila (20261030021434_fila_importacao)
// agenda o job que, nas migrações antigas, tem o endereço da produção no código: mostra quanto tempo ele pode ter
// ficado ligado (do fim dessa migração até o primeiro desligamento). O instante de cada linha é o de quando a CLI a
// escreveu; "Applying migration X" sai ANTES de aplicar X, então a migração da fila terminou antes da linha seguinte.
function vigia(arqTempo, arqVigia) {
  const linhas = linhasDe(ler(arqTempo)).filter(util).map((l) => {
    const i = l.indexOf(' ');
    return { ms: Number(l.slice(0, i)), texto: l.slice(i + 1) };
  }).filter((x) => Number.isFinite(x.ms));
  const eventos = linhasDe(ler(arqVigia)).filter(util).map((l) => l.split(' '))
    .map(([ms, tipo, n]) => ({ ms: Number(ms), tipo, n: Number(n ?? 0) }));
  const inicio = linhas[0]?.ms;
  const iFila = linhas.findIndex((x) => /Applying migration 20261030021434_/.test(x.texto));
  const depois = iFila >= 0 ? linhas.slice(iFila + 1).find((x) => /Applying migration |Starting containers|Seeding/.test(x.texto)) : null;
  const conectou = eventos.find((e) => e.tipo === 'conectou');
  const desligou = eventos.filter((e) => e.tipo === 'desligou');
  const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
  const partes = [];
  if (conectou && inicio) partes.push(`conectou ao banco ${s(conectou.ms - inicio)} depois do início do start`);
  else partes.push('não conseguiu conectar durante o start');
  if (depois && desligou.length) {
    const delta = desligou[0].ms - depois.ms;
    partes.push(`a migração da fila terminou até ${s(depois.ms - inicio)} e o primeiro desligamento veio ${delta <= 0 ? 'antes da linha seguinte da CLI' : `${delta} ms depois`}`);
  }
  partes.push(`${desligou.length} desligamento(s), ${desligou.reduce((n, e) => n + e.n, 0)} job(s) no total`);
  console.log(`Vigia do pg_cron: ${partes.join('; ')}`);
}

/* ===================== Impressão digital (tests/banco/catalogo.sql) ===================== */
// Linhas "<tipo> <objeto> <hash>". O resumo de cada tipo é o MD5 (12 caracteres) das linhas do tipo em ordem de
// bytes, unidas por "\n" — o mesmo que dá, rodada na produção, a consulta
//   select split_part(linha, ' ', 1), count(*), left(md5(string_agg(linha, chr(10) order by linha collate "C")), 12)
//   from (<tests/banco/catalogo.sql sem o "order by" do fim>) z group by 1 order by 1;
const linhasImpressao = (arq) => linhasDe(ler(arq)).filter(util).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

function resumoImpressao(linhas) {
  const porTipo = new Map();
  for (const l of linhas) {
    const tipo = l.split(' ', 1)[0];
    if (!porTipo.has(tipo)) porTipo.set(tipo, []);
    porTipo.get(tipo).push(l);
  }
  const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex').slice(0, 12);
  return [...porTipo.keys()].sort().map((tipo) => ({ tipo, n: porTipo.get(tipo).length, hash: md5(porTipo.get(tipo).join('\n')) }));
}

function impressao(arq, rotulo) {
  const linhas = linhasImpressao(arq);
  if (!linhas.length) {
    anotar('error', `Impressão digital vazia - ${rotulo}`, `nenhuma linha em ${arq}`);
    process.exitCode = 1;
    return;
  }
  const tipos = resumoImpressao(linhas);
  const extensoes = linhas.filter((l) => l.startsWith('extensao ')).map((l) => l.split(' ').slice(1).join(' ')).join(', ');
  const texto = `Impressão digital ${rotulo}: ${linhas.length} objetos; ${tipos.map((t) => `${t.tipo} ${t.n} ${t.hash}`).join(' · ')}`
    + `\nExtensões ${rotulo}: ${extensoes || 'nenhuma'}`;
  console.log(texto);
  const dir = process.env.IMED_RESUMO_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    const nome = `45-impressao-${rotulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.txt`;
    writeFileSync(path.join(dir, nome), `${texto}\n`);
  }
}

// As linhas da impressão (de alguns tipos ou de todas), em notas de até ~3.500 caracteres, para comparar objeto a
// objeto com a produção quando o resumo por tipo não bate. No máximo 9 notas (o GitHub mostra 10 por passo).
function impressaoLinhas(arq, tiposTexto) {
  const tipos = new Set(String(tiposTexto || 'todos').split(/[\s,]+/).filter(Boolean));
  const todas = linhasImpressao(arq);
  const linhas = todas.filter((l) => tipos.has('todos') || tipos.has(l.split(' ', 1)[0]));
  if (!linhas.length) {
    const existentes = [...new Set(todas.map((l) => l.split(' ', 1)[0]))].sort().join(', ');
    anotar('warning', 'Impressão digital: nenhum objeto com esses tipos',
      `pedido: ${[...tipos].join(', ')}; tipos que existem: ${existentes || 'nenhum (impressão vazia)'} (ou "todos")`,
      { maxAvisos: 1 });
    return;
  }
  const blocos = [];
  let atual = [];
  let tamanho = 0;
  for (const l of linhas) {
    if (atual.length && tamanho + l.length + 1 > 3500) { blocos.push(atual); atual = []; tamanho = 0; }
    atual.push(l);
    tamanho += l.length + 1;
  }
  if (atual.length) blocos.push(atual);
  const MAX_NOTAS = 9;
  blocos.slice(0, MAX_NOTAS).forEach((b, i) => {
    anotar('notice', `Impressão digital (${[...tipos].join(',')}) ${i + 1}/${blocos.length}`, b.join('\n'),
      { maxAvisos: 1, maxLinhas: b.length });
  });
  if (blocos.length > MAX_NOTAS) {
    anotar('warning', 'Impressão digital cortada',
      `${blocos.length} blocos; só os ${MAX_NOTAS} primeiros viraram nota. Peça menos tipos (impressao=funcao,tabela...).`);
  }
}

if (modo === 'migracoes' || modo === 'supabase-start') migracoes(ler(resto[0]));
else if (modo === 'pgtap') pgtap(ler(resto[0]));
else if (modo === 'vigia') vigia(resto[0], resto[1]);
else if (modo === 'cauda') cauda(resto[0], ler(resto[1]));
else if (modo === 'resumo') resumo(resto[0], resto[1]);
else if (modo === 'impressao') impressao(resto[0], resto[1] || 'do banco');
else if (modo === 'impressao-linhas') impressaoLinhas(resto[0], resto[1]);
else {
  console.error('uso: node tests/banco/anotar.mjs migracoes|pgtap <registro> | cauda "<título>" <registro> | '
    + 'resumo <pasta> "<passos>" | impressao <arquivo> "<rótulo>" | impressao-linhas <arquivo> "<tipos>"');
  process.exitCode = 2;
}
