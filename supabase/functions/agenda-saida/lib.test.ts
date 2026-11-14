// Testes da função de envio dos avisos da agenda (5.3).
// Rodar com: node --experimental-strip-types --test supabase/functions/agenda-saida/lib.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canaisDoAmbiente, canalResend, codigoDoErro, emailValido, endereco, linha, processar, quando, textoDoAviso,
  type Aviso, type Canal, type Envio, type Mensagem, type Resultado,
} from './lib.ts';

const SITE = 'https://imed.exemplo.br/';
const aviso = (o: Partial<Aviso> = {}): Aviso => ({
  id: '11111111-1111-4111-8111-111111111111', event_type: 'confirmado', channel: 'email', recipient_kind: 'paciente',
  to: 'paciente@exemplo.test', attempt: 1, code: 'IMED-B5100000', slot_start: '2026-11-18T12:00:00+00:00',
  slot_end: '2026-11-18T12:30:00+00:00', timezone: 'America/Sao_Paulo', cancelled_by: null, booked_by: 'imed_app',
  clinic: { name: 'Clínica dos Avisos', address_line: 'Rua do Lembrete, 53', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', phone: '1933334444' },
  ...o,
});
const EVENTOS_PACIENTE = ['confirmado', 'remarcado', 'lembrete_24h', 'lembrete_2h', 'cancelado', 'alterado_pela_clinica'];

test('data e hora no fuso da clínica, com o fuso por extenso', () => {
  assert.deepEqual(quando('2026-11-18T12:00:00+00:00', 'America/Sao_Paulo'),
    { dia: '18/11', hora: '09:00', longo: 'quarta-feira, 18/11/2026, às 09:00 (horário de Brasília)' });
  assert.equal(quando('2026-11-18T12:00:00+00:00', 'America/Manaus')?.longo, 'quarta-feira, 18/11/2026, às 08:00 (horário de Manaus)');
  assert.equal(quando('2026-11-18T02:30:00+00:00', 'America/Rio_Branco')?.longo, 'terça-feira, 17/11/2026, às 21:30 (horário do Acre)', 'o dia é o da clínica, não o de Brasília');
  // meia-noite aparece como 00:00, nunca 24:00
  assert.equal(quando('2026-11-18T03:00:00+00:00', 'America/Sao_Paulo')?.hora, '00:00');
  for (const [iso, tz] of [[null, 'America/Sao_Paulo'], ['ontem', 'America/Sao_Paulo'], ['2026-11-18T12:00:00Z', 'Europe/Lisbon'], ['2026-11-18T12:00:00Z', null]]) {
    assert.equal(quando(iso, tz), null, `sem horário ou com fuso que não é do Brasil: nada (${iso}, ${tz})`);
  }
});

test('linha limpa: sem quebra de linha (nada de cabeçalho injetado), espaços juntos e tamanho limitado', () => {
  assert.equal(linha('Clínica\r\nBcc: outro@exemplo.test'), 'Clínica Bcc: outro@exemplo.test');
  assert.equal(linha('a b\u0000c\t d'), 'a b c d');
  assert.equal(linha('x'.repeat(500)).length, 160);
  assert.equal(linha(null), '');
  assert.equal(linha(42), '');
});

test('endereço e e-mail', () => {
  assert.equal(endereco(aviso().clinic), 'Rua do Lembrete, 53, Centro, São Paulo/SP');
  assert.equal(endereco({ name: 'X', city: 'Americana', state: 'SP' }), 'Americana/SP');
  assert.equal(endereco(null), '');
  for (const ok of ['a@b.co', 'nome.sobrenome+tag@exemplo.com.br']) assert.ok(emailValido(ok), ok);
  for (const ruim of ['', 'a@b', 'a b@c.com', 'a@b.com, c@d.com', 'Nome <a@b.com>', 'a@b.com\nBcc: x@y.com', null, 42, `${'a'.repeat(250)}@b.com`]) {
    assert.ok(!emailValido(ruim), `recusa ${JSON.stringify(ruim)}`);
  }
});

test('paciente: cada aviso tem assunto e texto com a clínica, o endereço, o horário com o fuso e o código', () => {
  for (const ev of EVENTOS_PACIENTE) {
    const t = textoDoAviso(aviso({ event_type: ev }), SITE);
    assert.ok(t, ev);
    assert.match(t.subject, /18\/11 às 09:00/, `${ev}: assunto com o dia e a hora`);
    assert.match(t.subject, /Clínica dos Avisos/, `${ev}: assunto com a clínica`);
    assert.ok(!/[\r\n]/.test(t.subject) && t.subject.length <= 160, `${ev}: assunto numa linha só`);
    assert.match(t.text, /Onde: Clínica dos Avisos\nEndereço: Rua do Lembrete, 53, Centro, São Paulo\/SP\nQuando: quarta-feira, 18\/11\/2026, às 09:00 \(horário de Brasília\)\nCódigo do agendamento: IMED-B5100000/, ev);
    assert.match(t.text, /não traz o nome do exame nem dados de saúde/, `${ev}: diz por que não traz o exame`);
  }
  assert.match(textoDoAviso(aviso(), SITE)!.text, /^Seu agendamento está confirmado\./);
  assert.match(textoDoAviso(aviso({ event_type: 'remarcado' }), SITE)!.text, /mudou de horário\. O horário novo é este:/);
  assert.match(textoDoAviso(aviso({ event_type: 'lembrete_2h' }), SITE)!.subject, /^Lembrete: agendamento em 18\/11 às 09:00/);
  assert.match(textoDoAviso(aviso({ event_type: 'alterado_pela_clinica' }), SITE)!.text, /precisa remarcar com você[\s\S]*Fale com a clínica para escolher outro horário: \(19\) 3333-4444\./);
});

test('o texto nunca leva exame, preparo, nome do paciente nem o destino', () => {
  // mesmo que o banco mandasse campos a mais, o texto só usa os que conhece
  const sujo = { ...aviso(), exam_code: 'rm', procedure: 'Ressonância do crânio', prep_text: 'Jejum de 4 horas', patient_name: 'Maria da Silva', notes: 'gestante' } as Aviso;
  for (const ev of EVENTOS_PACIENTE) {
    for (const para of ['paciente', 'clinica']) {
      const t = textoDoAviso({ ...sujo, event_type: ev, recipient_kind: para }, SITE);
      if (!t) continue;
      const tudo = `${t.subject}\n${t.text}`;
      assert.doesNotMatch(tudo, /Ressonância|crânio|Jejum|Maria|gestante|paciente@exemplo\.test/i, `${ev}/${para}`);
    }
  }
});

test('quem marcou pelo site recebe o caminho para ver ou cancelar; o que a recepção marcou, não', () => {
  assert.match(textoDoAviso(aviso(), SITE)!.text, /Para ver ou cancelar, abra o IMED no aparelho em que você marcou: https:\/\/imed\.exemplo\.br\/index\.html#agenda/);
  for (const canal of ['clinica_balcao', 'clinica_telefone', 'imed_equipe', null]) {
    assert.doesNotMatch(textoDoAviso(aviso({ booked_by: canal }), SITE)!.text, /aparelho em que você marcou/, String(canal));
  }
});

test('cancelado: diz quem cancelou sem inventar; sem telefone, não promete telefone', () => {
  const peloPaciente = textoDoAviso(aviso({ event_type: 'cancelado', cancelled_by: 'patient' }), SITE)!.text;
  assert.match(peloPaciente, /Se não foi você quem cancelou, fale com a clínica: \(19\) 3333-4444\./);
  const pelaClinica = textoDoAviso(aviso({ event_type: 'cancelado', cancelled_by: 'clinic' }), SITE)!.text;
  assert.match(pelaClinica, /O cancelamento foi feito pela clínica\. Para entender ou marcar outro horário, fale com ela: \(19\) 3333-4444\./);
  assert.match(pelaClinica, /Para marcar de novo pelo IMED: https:\/\/imed\.exemplo\.br\//);
  const semTel = textoDoAviso(aviso({ clinic: { ...aviso().clinic, phone: null } }), SITE)!.text;
  assert.match(semTel, /Para remarcar ou tirar dúvidas, fale com a clínica\./);
  assert.doesNotMatch(semTel, /\(\d{2}\)/);
  assert.match(textoDoAviso(aviso({ clinic: { ...aviso().clinic, phone: '11987654321' } }), SITE)!.text, /\(11\) 98765-4321/);
});

test('clínica: só o horário, o código e o caminho do painel; nenhum dado do paciente', () => {
  const novo = textoDoAviso(aviso({ recipient_kind: 'clinica', to: 'contato@clinica.exemplo.test' }), SITE)!;
  assert.equal(novo.subject, 'Novo agendamento pelo IMED: 18/11 às 09:00');
  assert.match(novo.text, /Um paciente marcou um horário pelo site\.\n\nQuando: quarta-feira, 18\/11\/2026, às 09:00 \(horário de Brasília\)\nCódigo do agendamento: IMED-B5100000\n\nAbra a Área da clínica para ver os detalhes: https:\/\/imed\.exemplo\.br\/painel\.html/);
  assert.match(novo.text, /não traz dados do paciente/);
  const canc = textoDoAviso(aviso({ recipient_kind: 'clinica', event_type: 'cancelado', cancelled_by: 'patient' }), SITE)!;
  assert.equal(canc.subject, 'Agendamento cancelado pelo paciente: 18/11 às 09:00');
  for (const ev of ['remarcado', 'lembrete_24h', 'lembrete_2h', 'alterado_pela_clinica']) {
    assert.equal(textoDoAviso(aviso({ recipient_kind: 'clinica', event_type: ev }), SITE), null, `clínica não recebe ${ev}`);
  }
});

test('sem texto: evento ou destinatário desconhecido, sem horário, sem fuso ou sem o nome da clínica', () => {
  assert.equal(textoDoAviso(aviso({ event_type: 'pagamento_aprovado' }), SITE), null);
  assert.equal(textoDoAviso(aviso({ recipient_kind: 'medico' }), SITE), null);
  assert.equal(textoDoAviso(aviso({ slot_start: null }), SITE), null);
  assert.equal(textoDoAviso(aviso({ timezone: 'Europe/Lisbon' }), SITE), null);
  assert.equal(textoDoAviso(aviso({ clinic: { name: '  ' } }), SITE), null);
  // código fora do formato não entra no texto
  assert.doesNotMatch(textoDoAviso(aviso({ code: 'qualquer coisa\nBcc: x' }), SITE)!.text, /Código do agendamento/);
});

test('código do erro: curto, sem texto do provedor e sem destino', () => {
  assert.equal(codigoDoErro('http_500'), 'http_500');
  assert.equal(codigoDoErro('Mensagem com paciente@exemplo.test e espaços'), 'mensagem_com_paciente_exemplo.test_e_espa_os');
  assert.match(codigoDoErro('x'.repeat(200)), /^x{60}$/);
  for (const v of ['', '   ', null, undefined, 42, '@@@']) assert.equal(codigoDoErro(v), 'erro');
  assert.match(codigoDoErro('ÁÉ rede!'), /^[a-z0-9_.:-]{1,60}$/);
});

test('canal de e-mail (Resend): manda só remetente, destino, assunto e texto; a chave vai no cabeçalho; erros viram códigos', async () => {
  const chamadas: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const responde = (status: number, corpo: unknown) => async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    chamadas.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => corpo };
  };
  const m: Mensagem = { to: 'paciente@exemplo.test', subject: 'Assunto', text: 'Texto' };
  assert.deepEqual(await canalResend('chave-de-teste', 'IMED <avisos@imed.exemplo.br>', responde(200, { id: 'msg_123' })).enviar(m), { ok: true, id: 'msg_123' });
  assert.equal(chamadas[0].url, 'https://api.resend.com/emails');
  assert.equal(chamadas[0].init.method, 'POST');
  assert.equal(chamadas[0].init.headers.Authorization, 'Bearer chave-de-teste');
  assert.deepEqual(JSON.parse(chamadas[0].init.body), { from: 'IMED <avisos@imed.exemplo.br>', to: ['paciente@exemplo.test'], subject: 'Assunto', text: 'Texto' });
  assert.ok(!chamadas[0].init.body.includes('chave-de-teste'), 'a chave não vai no corpo');
  assert.deepEqual(await canalResend('k', 'f', responde(200, 'sem id')).enviar(m), { ok: true, id: null }, 'enviado sem protocolo legível');
  assert.deepEqual(await canalResend('k', 'f', responde(429, { message: 'muitas chamadas para paciente@exemplo.test' })).enviar(m), { ok: false, code: 'http_429' });
  assert.deepEqual(await canalResend('k', 'f', responde(500, null)).enviar(m), { ok: false, code: 'http_500' });
  assert.deepEqual(await canalResend('k', 'f', async () => { throw new Error('caiu'); }).enviar(m), { ok: false, code: 'rede' });
  assert.deepEqual(await canalResend('k', 'f', async () => { throw Object.assign(new Error('demorou'), { name: 'TimeoutError' }); }).enviar(m), { ok: false, code: 'tempo_esgotado' });
});

test('canais do ambiente: sem a chave ou sem o remetente, não há canal de e-mail', () => {
  const nada = async () => ({ ok: true, status: 200, json: async () => ({}) });
  assert.deepEqual(Object.keys(canaisDoAmbiente(() => undefined, nada)), []);
  assert.deepEqual(Object.keys(canaisDoAmbiente((n) => (n === 'RESEND_API_KEY' ? 'k' : undefined), nada)), [], 'só a chave: não');
  assert.deepEqual(Object.keys(canaisDoAmbiente((n) => (n === 'AVISOS_EMAIL_FROM' ? 'IMED <a@b.co>' : '  '), nada)), [], 'só o remetente: não');
  assert.deepEqual(Object.keys(canaisDoAmbiente((n) => ({ RESEND_API_KEY: 'k', AVISOS_EMAIL_FROM: 'IMED <a@b.co>' } as Record<string, string>)[n], nada)), ['email']);
});

// Um canal de mentira que anota o que recebeu e responde o que o teste mandar.
function canalFalso(respostas: (Envio | Error)[]): Canal & { recebidas: Mensagem[] } {
  const recebidas: Mensagem[] = [];
  return { recebidas, async enviar(m) { recebidas.push(m); const r = respostas.shift() ?? { ok: true, id: 'ok' }; if (r instanceof Error) throw r; return r; } };
}
function anotador() {
  const feitos: { id: string; result: Resultado; pid: string | null; erro: string | null }[] = [];
  return { feitos, done: async (id: string, result: Resultado, pid: string | null, erro: string | null) => { feitos.push({ id, result, pid, erro }); } };
}

test('lote: sem canal = sem_canal (nunca "enviada"); com canal, cada aviso tem o resultado certo e um problema não para os outros', async () => {
  const lote = [
    aviso({ id: 'a1' }),
    aviso({ id: 'a2', to: 'não é e-mail' }),
    aviso({ id: 'a3', channel: 'whatsapp', to: '11987654321' }),
    aviso({ id: 'a4' }),
    aviso({ id: 'a5', event_type: 'pagamento_aprovado' }),
    aviso({ id: 'a6' }),
    aviso({ id: 'a7', to: null }),
  ];
  // envio desligado no servidor (sem credencial): tudo sem_canal, nada enviado
  const semCanal = anotador();
  assert.deepEqual(await processar(lote, {}, semCanal.done, SITE), { enviada: 0, falhou: 0, sem_canal: 7, sem_contato: 0, erro: 0 });
  assert.ok(semCanal.feitos.every((f) => f.result === 'sem_canal' && f.pid === null && f.erro === null));

  const canal = canalFalso([{ ok: true, id: 'msg_1' }, { ok: false, code: 'HTTP 500: falhou para paciente@exemplo.test' }, new Error('explodiu')]);
  const a = anotador();
  assert.deepEqual(await processar(lote, { email: canal }, a.done, SITE), { enviada: 1, falhou: 2, sem_canal: 2, sem_contato: 2, erro: 0 });
  assert.deepEqual(a.feitos, [
    { id: 'a1', result: 'enviada', pid: 'msg_1', erro: null },
    { id: 'a2', result: 'sem_contato', pid: null, erro: null },
    { id: 'a3', result: 'sem_canal', pid: null, erro: null },
    { id: 'a4', result: 'falhou', pid: null, erro: 'http_500:_falhou_para_paciente_exemplo.test' },
    { id: 'a5', result: 'sem_canal', pid: null, erro: null },
    { id: 'a6', result: 'falhou', pid: null, erro: 'excecao' },
    { id: 'a7', result: 'sem_contato', pid: null, erro: null },
  ]);
  assert.equal(canal.recebidas.length, 3, 'só os válidos chegam ao canal');
  assert.deepEqual(Object.keys(canal.recebidas[0]).sort(), ['subject', 'text', 'to']);
  assert.equal(canal.recebidas[0].to, 'paciente@exemplo.test');
});

test('lote: resposta do banco que falha conta como erro e não derruba; lista estranha não quebra', async () => {
  let n = 0;
  const done = async () => { n += 1; if (n === 1) throw new Error('banco fora'); };
  assert.deepEqual(await processar([aviso({ id: 'b1' }), aviso({ id: 'b2' })], { email: canalFalso([]) }, done, SITE),
    { enviada: 1, falhou: 0, sem_canal: 0, sem_contato: 0, erro: 1 });
  for (const ruim of [null, undefined, 'x', {}, [null, 42, { semId: true }]]) {
    const r = await processar(ruim, {}, async () => {}, SITE);
    assert.equal(r.enviada + r.falhou + r.sem_canal + r.sem_contato, 0);
  }
});
