// O roteiro das 12 conferências no ambiente de testes do Asaas (scripts/asaas-sandbox.mjs; arquitetura do pagamento,
// §2.3), rodado aqui contra o provedor DE MENTIRA (tests/banco/asaas-falso.mjs, em 127.0.0.1): prova que o roteiro
// funciona e que o adaptador (supabase/functions/_shared/asaas.ts) e o provedor de mentira contam a mesma história.
// O Asaas de verdade só é conferido à mão, pelo workflow asaas-sandbox.yml, quando a conta existir.
// Rodar com: node --test tests/asaas-sandbox.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { subirAsaasFalso } from './banco/asaas-falso.mjs';
import { CLINICA_CENTS, conferir, enderecoDeTestes, relatorio, VALOR_CENTS } from '../scripts/asaas-sandbox.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const por = (itens) => Object.fromEntries(itens.map((i) => [i.n, i.resposta]));

test('12 itens, na ordem do §2.3; sem como pagar, o que depende de pagamento sai "manual"', async (t) => {
  const falso = await subirAsaasFalso({ tarifaPixCents: 199 });
  t.after(() => falso.fechar());
  const itens = await conferir({ url: falso.url, chave: falso.chave, wallet: 'wal_teste_conferencia' });
  assert.deepEqual(itens.map((i) => i.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(por(itens), { 1: 'manual', 2: 'manual', 3: 'manual', 4: 'manual', 5: 'manual', 6: 'manual', 7: 'manual', 8: 'confirmado', 9: 'manual', 10: 'manual', 11: 'manual', 12: 'confirmado' });
  for (const i of itens) assert.ok(i.titulo.length > 20 && i.notas.length >= 1, `item ${i.n} diz o que conferiu ou o que falta`);
  // os títulos são os do documento
  const arq = read('memory/projects/imed-pagamento-arquitetura.md');
  const secao = arq.slice(arq.indexOf('### 2.3 Conferir no ambiente de testes'), arq.indexOf('## 3. Caminho do dinheiro'));
  assert.equal([...secao.matchAll(/^\d+\. /gm)].length, 12, 'o §2.3 tem 12 itens');
  for (const n of [9, 10, 11]) assert.match(itens[n - 1].notas[0], /fase P[45]/, `item ${n}: fora da P2a`);
  // o que foi para o provedor: só cobranças de teste de valor baixo, com a divisão; nada ficou vivo
  const cobrancas = falso.recebido.filter((x) => x.metodo === 'POST' && x.caminho === '/v3/payments').map((x) => x.corpo);
  assert.ok(cobrancas.length >= 3 && cobrancas.every((c) => c.value === VALOR_CENTS / 100));
  assert.deepEqual(cobrancas[0].split, [{ walletId: 'wal_teste_conferencia', fixedValue: CLINICA_CENTS / 100 }]);
});

test('com o pagamento de teste: divisão, tarifa, devolução parcial e total e a mesma chave duas vezes saem "confirmado"', async (t) => {
  const falso = await subirAsaasFalso({ tarifaPixCents: 199 });
  t.after(() => falso.fechar());
  // o provedor de mentira deixa pagar o QR de cobrança apagada (o caso mais chato): o roteiro acusa a diferença
  const itens = await conferir({ url: falso.url, chave: falso.chave, wallet: 'wal_teste_conferencia', pagar: async (id) => { falso.pagar(id, { mesmoApagada: true }); } });
  assert.deepEqual(por(itens), { 1: 'confirmado', 2: 'manual', 3: 'diferente do desenho', 4: 'manual', 5: 'manual', 6: 'confirmado', 7: 'manual', 8: 'confirmado', 9: 'manual', 10: 'manual', 11: 'manual', 12: 'confirmado' });
  assert.match(itens[0].notas.join(' '), /tarifa de 199 centavos/);
  assert.match(itens[2].notas.join(' '), /QR de cobrança APAGADA foi pago/);
  assert.match(itens[5].notas.join(' '), /a mesma chave não devolveu duas vezes/);
  const paga = [...falso.cobrancas.values()].find((c) => c.estornos.length);
  assert.deepEqual([paga.status, paga.devolvidoCents, paga.estornos.length], ['REFUNDED', VALOR_CENTS, 2], 'parcial (uma vez só) + total');
  // provedor que recusa pagar a cobrança apagada: o item 3 sai "confirmado"
  const falso2 = await subirAsaasFalso({ tarifaPixCents: 199 });
  t.after(() => falso2.fechar());
  const itens2 = await conferir({ url: falso2.url, chave: falso2.chave, wallet: 'w', pagar: async (id) => { falso2.pagar(id); } });
  assert.equal(por(itens2)[3], 'confirmado');
});

test('provedor que não se comporta como o desenho: o roteiro diz "diferente do desenho" (e não quebra)', async (t) => {
  const falso = await subirAsaasFalso({ tarifaPixCents: 199 });
  t.after(() => falso.fechar());
  // chave errada: nada é aceito
  const semChave = await conferir({ url: falso.url, chave: 'chave-errada-de-teste', wallet: 'w' });
  assert.equal(por(semChave)[1], 'diferente do desenho');
  assert.match(semChave[0].notas[0], /criar o pagador.*HTTP 401/);
  assert.equal(por(semChave)[12], 'diferente do desenho');
  // divisão que não cabe no valor (carteira com tarifa maior): a cobrança é recusada
  const caro = await subirAsaasFalso({ tarifaPixCents: 500 });
  t.after(() => caro.fechar());
  const r = await conferir({ url: caro.url, chave: caro.chave, wallet: 'w' });
  assert.equal(por(r)[1], 'diferente do desenho');
  assert.match(r[0].notas.join(' '), /criar a cobrança Pix com a divisão: HTTP 400 \(invalid_split\)/);
  // fora do ar
  falso.foraDoAr(true);
  const fora = await conferir({ url: falso.url, chave: falso.chave, wallet: 'w' });
  assert.equal(por(fora)[1], 'diferente do desenho');
});

test('relatório e trava do endereço: só ambiente de testes', () => {
  const txt = relatorio([{ n: 1, titulo: 'Um item', resposta: 'confirmado', notas: ['nota a'] }, { n: 2, titulo: 'Outro', resposta: 'manual', notas: [] }, { n: 3, titulo: 'Mais um', resposta: 'diferente do desenho', notas: ['x'] }]);
  assert.match(txt, /^Conferência no ambiente de testes do Asaas: 1 confirmado\(s\), 1 diferente\(s\) do desenho, 1 manual\(is\)\./);
  assert.match(txt, / 1\. \[CONFIRMADO\] Um item\n {6}- nota a/);
  assert.match(txt, / 3\. \[DIFERENTE DO DESENHO\] Mais um/);
  assert.equal(enderecoDeTestes('https://api-sandbox.exemplo.test'), true);
  assert.equal(enderecoDeTestes('https://sandbox.exemplo.test/api'), true);
  for (const ruim of ['https://api.exemplo.test', 'http://sandbox.exemplo.test', 'sandbox', '', 'https://exemplo.test/sandbox']) assert.equal(enderecoDeTestes(ruim), false, ruim);
});

test('o roteiro e o workflow: só à mão, chave só em segredo do GitHub, fora do banco.yml e do testes.yml, sem endereço do Asaas escrito', () => {
  const wf = read('.github/workflows/asaas-sandbox.yml');
  const gatilhos = wf.slice(wf.indexOf('\non:\n'), wf.indexOf('\npermissions:'));
  assert.match(gatilhos, /^\non:\n {2}workflow_dispatch:\n/);
  assert.doesNotMatch(gatilhos, /\b(push|pull_request|schedule|workflow_run)\b/, 'nunca roda sozinho');
  assert.match(wf, /ASAAS_SANDBOX_KEY: \$\{\{ secrets\.ASAAS_SANDBOX_KEY \}\}/);
  assert.match(wf, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(wf, /secrets\.(?!ASAAS_SANDBOX_KEY\b)/, 'nenhum outro segredo');
  for (const linha of wf.split('\n').filter((l) => l.includes('${{ inputs.'))) assert.match(linha, /^ {10}ASAAS_SANDBOX_[A-Z]+: \$\{\{ inputs\.[a-z_]+ \}\}$/, 'os campos do formulário só entram por variável de ambiente');
  assert.doesNotMatch(wf.slice(wf.indexOf('run: |')), /\$\{\{/, 'nada do formulário nem do segredo é colado dentro do script');
  for (const outro of ['.github/workflows/banco.yml', '.github/workflows/testes.yml']) assert.doesNotMatch(read(outro), /asaas-sandbox|ASAAS_/, `${outro} não usa a chave nem o roteiro`);
  const script = read('scripts/asaas-sandbox.mjs');
  assert.doesNotMatch(script + wf, /https?:\/\/[a-z0-9.-]*asaas/i, 'o endereço da API vem de quem roda, não do repositório');
  assert.match(script, /if \(!enderecoDeTestes\(url\)\) \{ console\.error\(/, 'recusa endereço que não é de testes');
  assert.match(script, /from '\.\.\/supabase\/functions\/_shared\/asaas\.ts'/, 'usa o mesmo adaptador das Edge Functions');
  assert.doesNotMatch(script, /console\.log\([^)]*(chave|access_token)/, 'a chave nunca vai para o registro');
});
