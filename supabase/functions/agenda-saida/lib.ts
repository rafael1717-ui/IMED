// Regras da função "agenda-saida" (avisos e lembretes da agenda, fase 5.3), sem nada do Deno: os testes rodam no Node
// (node --experimental-strip-types --test supabase/functions/agenda-saida/lib.test.ts).
//
// O banco PREPARA o aviso e entrega, na hora do envio, só o necessário (agenda_notify_claim): para quem, o horário, o
// fuso, o código do agendamento e os dados públicos da clínica. Aqui o aviso vira texto e sai pelo canal. Três regras:
//   1. o texto NÃO leva o nome do exame, o preparo, o nome do paciente nem nada de saúde (decisão 8 da arquitetura);
//   2. o que não saiu nunca é dado como enviado: canal sem credencial = sem_canal; destino que não serve = sem_contato;
//      erro do provedor = falhou, com um código curto (o texto do provedor e o destino nunca voltam para o banco);
//   3. nada do destino (e-mail) vai para log ou para a resposta da função.

/* ===================== o que o banco entrega ===================== */
export interface Clinica { name?: string | null; address_line?: string | null; neighborhood?: string | null; city?: string | null; state?: string | null; phone?: string | null }
export interface Aviso {
  id: string;
  event_type: string;
  channel: string;
  recipient_kind: string;
  to?: string | null;
  attempt?: number;
  code?: string | null;
  slot_start?: string | null;
  slot_end?: string | null;
  timezone?: string | null;
  cancelled_by?: string | null;
  booked_by?: string | null;
  clinic?: Clinica | null;
}
export interface Mensagem { to: string; subject: string; text: string }
export type Resultado = 'enviada' | 'sem_canal' | 'sem_contato' | 'falhou';
export type Envio = { ok: true; id: string | null } | { ok: false; code: string };
export interface Canal { enviar(m: Mensagem): Promise<Envio> }

/* ===================== data, hora e fuso ===================== */
// O fuso por extenso, como o paciente fala. Fuso que não é do Brasil (não deveria vir): nada de horário no texto.
const FUSO: Record<string, string> = {
  'America/Sao_Paulo': 'horário de Brasília', 'America/Bahia': 'horário de Brasília', 'America/Fortaleza': 'horário de Brasília',
  'America/Recife': 'horário de Brasília', 'America/Maceio': 'horário de Brasília', 'America/Belem': 'horário de Brasília',
  'America/Santarem': 'horário de Brasília', 'America/Araguaina': 'horário de Brasília',
  'America/Manaus': 'horário de Manaus', 'America/Porto_Velho': 'horário de Porto Velho', 'America/Boa_Vista': 'horário de Boa Vista',
  'America/Cuiaba': 'horário de Cuiabá', 'America/Campo_Grande': 'horário de Campo Grande',
  'America/Rio_Branco': 'horário do Acre', 'America/Eirunepe': 'horário do Acre', 'America/Noronha': 'horário de Fernando de Noronha',
};
export interface Quando { dia: string; hora: string; longo: string }
// "18/11", "09:00" e "quarta-feira, 18/11/2026, às 09:00 (horário de Brasília)", no fuso da clínica. null = não dá para dizer.
export function quando(iso: unknown, tz: unknown): Quando | null {
  if (typeof iso !== 'string' || typeof tz !== 'string' || !FUSO[tz]) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const dia = `${p.day}/${p.month}`;
  const hora = `${p.hour}:${p.minute}`;
  return { dia, hora, longo: `${p.weekday}, ${p.day}/${p.month}/${p.year}, às ${hora} (${FUSO[tz]})` };
}

/* ===================== o texto ===================== */
// Uma linha limpa: sem quebras (nada de cabeçalho injetado no assunto), espaços juntos, tamanho limitado.
export const linha = (v: unknown, max = 160): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const telefone = (v: unknown): string => {
  const d = typeof v === 'string' ? v.replace(/\D/g, '') : '';
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : '';
};
export function endereco(c: Clinica | null | undefined): string {
  const cidade = [linha(c?.city, 80), linha(c?.state, 2)].filter(Boolean).join('/');
  return [linha(c?.address_line, 200), linha(c?.neighborhood, 80), cidade].filter(Boolean).join(', ');
}
const EMAIL = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/;
export const emailValido = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && EMAIL.test(v);

// O assunto e o texto do aviso. null = este aviso não tem texto (evento, destinatário ou dados que esta versão não conhece).
export function textoDoAviso(a: Aviso, site: string): { subject: string; text: string } | null {
  const q = quando(a.slot_start, a.timezone);
  const nome = linha(a.clinic?.name, 120);
  if (!q || !nome) return null;
  const onde = endereco(a.clinic);
  const tel = telefone(a.clinic?.phone);
  const codigo = /^IMED-[0-9A-F]{8}$/.test(a.code ?? '') ? a.code : '';
  const rodape = 'IMED. Por segurança, este aviso não traz o nome do exame nem dados de saúde. Você recebeu esta mensagem porque este e-mail foi informado na marcação.';
  const dados = [`Onde: ${nome}`, onde ? `Endereço: ${onde}` : '', `Quando: ${q.longo}`, codigo ? `Código do agendamento: ${codigo}` : ''].filter(Boolean).join('\n');
  const falar = tel ? `Para remarcar ou tirar dúvidas, fale com a clínica: ${tel}.` : 'Para remarcar ou tirar dúvidas, fale com a clínica.';
  // só quem marcou pelo site tem o agendamento guardado no aparelho (o que a recepção marcou não aparece lá)
  const ver = a.booked_by === 'imed_app' ? `Para ver ou cancelar, abra o IMED no aparelho em que você marcou: ${site}index.html#agenda` : '';
  const corpo = (...partes: string[]) => partes.filter(Boolean).join('\n\n');

  if (a.recipient_kind === 'paciente') {
    switch (a.event_type) {
      case 'confirmado':
        return { subject: linha(`Agendamento confirmado: ${nome}, ${q.dia} às ${q.hora}`), text: corpo('Seu agendamento está confirmado.', dados, ver, falar, rodape) };
      case 'remarcado':
        return { subject: linha(`Agendamento remarcado: ${nome}, ${q.dia} às ${q.hora}`), text: corpo('Seu agendamento mudou de horário. O horário novo é este:', dados, ver, falar, rodape) };
      case 'lembrete_24h':
      case 'lembrete_2h':
        return { subject: linha(`Lembrete: agendamento em ${q.dia} às ${q.hora}, ${nome}`), text: corpo('Lembrete do seu agendamento.', dados, 'Se a clínica passou orientações de preparo, siga o que ela informou.', ver, falar, rodape) };
      case 'cancelado':
        return {
          subject: linha(`Agendamento cancelado: ${nome}, ${q.dia} às ${q.hora}`),
          text: corpo('Este agendamento foi cancelado:', dados,
            a.cancelled_by === 'patient' ? `Se não foi você quem cancelou, fale com a clínica${tel ? `: ${tel}` : ''}.` : `O cancelamento foi feito pela clínica. ${tel ? `Para entender ou marcar outro horário, fale com ela: ${tel}.` : 'Para marcar outro horário, fale com ela.'}`,
            `Para marcar de novo pelo IMED: ${site}`, rodape),
        };
      case 'alterado_pela_clinica':
        return { subject: linha(`A clínica precisou alterar o seu horário: ${nome}, ${q.dia} às ${q.hora}`), text: corpo('A clínica não vai conseguir atender neste horário e precisa remarcar com você:', dados, tel ? `Fale com a clínica para escolher outro horário: ${tel}.` : 'Fale com a clínica para escolher outro horário.', rodape) };
      default:
        return null;
    }
  }
  if (a.recipient_kind === 'clinica') {
    const painel = `Abra a Área da clínica para ver os detalhes: ${site}painel.html`;
    const resumo = [`Quando: ${q.longo}`, codigo ? `Código do agendamento: ${codigo}` : ''].filter(Boolean).join('\n');
    const fim = 'IMED. Este aviso não traz dados do paciente: eles ficam só no painel.';
    if (a.event_type === 'confirmado') return { subject: linha(`Novo agendamento pelo IMED: ${q.dia} às ${q.hora}`), text: corpo('Um paciente marcou um horário pelo site.', resumo, painel, fim) };
    if (a.event_type === 'cancelado') return { subject: linha(`Agendamento cancelado pelo paciente: ${q.dia} às ${q.hora}`), text: corpo('Um paciente cancelou um agendamento pelo site. O horário voltou a ficar livre.', resumo, painel, fim) };
  }
  return null;
}

/* ===================== o canal de e-mail ===================== */
// Código curto para o banco (só letras minúsculas, números, "_", ".", ":" e "-"; até 60): nunca o texto do provedor.
export const codigoDoErro = (v: unknown): string => {
  const s = typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) : '';
  return s || 'erro';
};
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
// E-mail pela API do Resend (POST /emails com from, to, subject e text; resposta com o id). A conferir na documentação
// do Resend no dia de ligar o canal: esta função nunca foi chamada contra o serviço de verdade.
export function canalResend(apiKey: string, from: string, fetchFn: Fetch, timeoutMs = 10000): Canal {
  return {
    async enviar(m: Mensagem): Promise<Envio> {
      let res;
      try {
        res = await fetchFn('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
          signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(timeoutMs) : undefined,
        });
      } catch (err) {
        return { ok: false, code: (err as { name?: string })?.name === 'TimeoutError' ? 'tempo_esgotado' : 'rede' };
      }
      if (!res.ok) return { ok: false, code: `http_${res.status}` };
      let id: string | null = null;
      try { const j = await res.json() as { id?: unknown }; if (typeof j?.id === 'string') id = j.id.slice(0, 200); } catch { /* enviado, sem protocolo legível */ }
      return { ok: true, id };
    },
  };
}
// Os canais que este servidor consegue usar agora: sem a chave e o remetente, o e-mail não existe (sem_canal).
export function canaisDoAmbiente(env: (name: string) => string | undefined, fetchFn: Fetch): Record<string, Canal> {
  const key = (env('RESEND_API_KEY') ?? '').trim();
  const from = linha(env('AVISOS_EMAIL_FROM') ?? '', 200);
  return key && from ? { email: canalResend(key, from, fetchFn) } : {};
}

/* ===================== o envio de um lote ===================== */
export interface Contagem { enviada: number; falhou: number; sem_canal: number; sem_contato: number; erro: number }
type Done = (id: string, result: Resultado, providerId: string | null, error: string | null) => Promise<unknown>;
// Envia cada aviso do lote e conta o resultado ao banco (done). Um aviso com problema não para os outros.
export async function processar(itens: unknown, canais: Record<string, Canal>, done: Done, site: string): Promise<Contagem> {
  const n: Contagem = { enviada: 0, falhou: 0, sem_canal: 0, sem_contato: 0, erro: 0 };
  for (const a of (Array.isArray(itens) ? itens : []) as Aviso[]) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string') { n.erro += 1; continue; }
    let r: Resultado; let pid: string | null = null; let erro: string | null = null;
    try {
      const canal = canais[a.channel];
      const texto = canal ? textoDoAviso(a, site) : null;
      if (!canal || !texto) r = 'sem_canal';
      else if (a.channel !== 'email' || !emailValido(a.to)) r = 'sem_contato';
      else {
        const e = await canal.enviar({ to: a.to, ...texto });
        if (e.ok) { r = 'enviada'; pid = e.id; } else { r = 'falhou'; erro = codigoDoErro(e.code); }
      }
    } catch { r = 'falhou'; erro = 'excecao'; }
    try { await done(a.id, r, pid, erro); n[r] += 1; } catch { n.erro += 1; }
  }
  return n;
}

/* ===== Chaves do Supabase: início (bloco igual em clinicas-proximas/lib.ts e importar-clinicas/lib.ts) ===== */
// O Supabase põe as chaves do projeto nas variáveis de ambiente de toda Edge Function:
// - novas: SUPABASE_PUBLISHABLE_KEYS e SUPABASE_SECRET_KEYS, um JSON com as chaves por nome
//   ({"default":"sb_publishable_..."}). Vão SÓ no cabeçalho "apikey": não são tokens (JWT), e a documentação do
//   Supabase manda nunca pô-las em "Authorization: Bearer" (onde o Supabase espera um token, como nas funções com
//   verify_jwt, ele tenta ler a chave como token e recusa: "Invalid JWT").
// - nova sem JSON: SUPABASE_PUBLISHABLE_KEY e SUPABASE_SECRET_KEY (uma chave só), o formato que a documentação cita
//   para o desenvolvimento local. Vale como a "default" quando o JSON falta.
// - antigas (tokens JWT, que param de funcionar no fim de 2026): SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.
//   Só são usadas se a nova faltar, e vão como sempre foram (apikey e Authorization: Bearer).
// Nada aqui usa APIs do Deno: quem chama passa a leitura do ambiente (env), e os testes rodam no Node.
export type EnvGet = (name: string) => string | undefined;
export interface ProjectKey { key: string; legacy: boolean }
export const PUBLISHABLE_VARS = { novas: 'SUPABASE_PUBLISHABLE_KEYS', uma: 'SUPABASE_PUBLISHABLE_KEY', antiga: 'SUPABASE_ANON_KEY' } as const;
export const SECRET_VARS = { novas: 'SUPABASE_SECRET_KEYS', uma: 'SUPABASE_SECRET_KEY', antiga: 'SUPABASE_SERVICE_ROLE_KEY' } as const;
type KeyVars = typeof PUBLISHABLE_VARS | typeof SECRET_VARS;

// Chaves de um JSON por nome. Faltando, vazio, quebrado ou fora do formato: nenhuma (nunca derruba a função).
export function namedKeys(raw: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== 'string' || !raw.trim()) return out;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return out; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [name, key] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof key === 'string' && key.trim()) out[name] = key.trim();
  }
  return out;
}

// As chaves novas do ambiente, por nome: o JSON ou, sem ele, a chave única (como "default").
export function newKeys(env: EnvGet, vars: KeyVars): Record<string, string> {
  const list = namedKeys(env(vars.novas));
  if (Object.keys(list).length) return list;
  const uma = (env(vars.uma) ?? '').trim();
  return uma ? { default: uma } : {};
}

// A chave nova de nome `name` ("default"; sem ela, a primeira da lista) ou, sem nenhuma nova, a antiga.
function pickKey(env: EnvGet, vars: KeyVars, name: string): ProjectKey | null {
  const list = newKeys(env, vars);
  const nova = list[name] ?? Object.values(list)[0];
  if (nova) return { key: nova, legacy: false };
  const antiga = (env(vars.antiga) ?? '').trim();
  return antiga ? { key: antiga, legacy: true } : null;
}
// Chave publishable: consulta o banco como visitante (o papel "anon"), sujeita às regras (RLS).
export const publishableKey = (env: EnvGet, name = 'default'): ProjectKey | null => pickKey(env, PUBLISHABLE_VARS, name);
// Chave secreta: acesso total ao banco. Só para chamadas do próprio servidor; nunca vai para resposta ou log.
export const secretKey = (env: EnvGet, name = 'default'): ProjectKey | null => pickKey(env, SECRET_VARS, name);

// Qual chave está em uso, sem mostrar a chave: "nova", "antiga" ou "ausente" (para a conferência depois do deploy).
export const keyKind = (k: ProjectKey | null): 'nova' | 'antiga' | 'ausente' => (k ? (k.legacy ? 'antiga' : 'nova') : 'ausente');

// Cabeçalhos para chamar a API do Supabase (banco ou outra função) com uma chave do servidor: a nova só em "apikey";
// a antiga (JWT) em "apikey" e em "Authorization: Bearer", como sempre foi. Uma chave "sb_" nunca vai em Bearer.
export function keyHeaders(k: ProjectKey | null): Record<string, string> {
  if (!k) return {};
  return k.legacy && !k.key.startsWith('sb_') ? { apikey: k.key, Authorization: `Bearer ${k.key}` } : { apikey: k.key };
}

// Todas as chaves aceitas de quem chama (função publicada com verify_jwt=false confere no código): as novas, de
// qualquer nome, e a antiga enquanto existir.
export function acceptedKeys(env: EnvGet, vars: KeyVars): string[] {
  const out = Object.values(newKeys(env, vars));
  const antiga = (env(vars.antiga) ?? '').trim();
  if (antiga) out.push(antiga);
  return [...new Set(out)];
}

// Comparação que leva o mesmo tempo acertando ou errando cada letra (não entrega a chave aos poucos).
export function sameKey(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

// A chamada traz uma destas chaves? No "apikey" vale qualquer uma; em "Authorization: Bearer", só as antigas (JWT),
// como mandam os chamadores antigos.
export function hasKey(headers: { get(name: string): string | null }, keys: string[]): boolean {
  const apikey = headers.get('apikey') ?? '';
  const bearer = (headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return keys.some((k) => sameKey(apikey, k) || (!k.startsWith('sb_') && sameKey(bearer, k)));
}
/* ===== Chaves do Supabase: fim ===== */
