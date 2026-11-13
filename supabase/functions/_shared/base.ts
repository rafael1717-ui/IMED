// Peças comuns das funções do pagamento (pagamento-criar, pagamento-webhook, pagamento-rotina e, na P2b,
// pagamento-clinica), iMed Pagamentos.
// Nada aqui usa APIs do Deno: quem chama passa o fetch e a leitura do ambiente, e os testes rodam no Node
// (supabase/functions/_shared/lib.test.ts). Nenhum segredo neste arquivo: os segredos vêm só das variáveis de
// ambiente da função (a lista está em supabase/functions/.env.example e no topo do index.ts de cada função).
import { acceptedKeys, hasKey, keyHeaders, PUBLISHABLE_VARS, sameKey, type EnvGet, type ProjectKey } from './chaves.ts';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export interface Cabecalhos { get(name: string): string | null }
export interface Resposta { http: number; corpo: Record<string, unknown>; cabecalhos?: Record<string, string> }

/* ---------------- textos, números e conferências ---------------- */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
export const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// CPF: 11 dígitos, não todos iguais, com os dois dígitos verificadores certos. (A mesma regra, com os mesmos casos de
// teste, está em assets/js/pagamento-core.js: o site confere antes de enviar e o servidor confere de novo.)
export function cpfValido(v: unknown): boolean {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

// Comparação que leva o mesmo tempo acertando ou errando cada letra (o segredo do aviso não vaza aos poucos).
export const tempoConstante = (a: unknown, b: unknown): boolean => sameKey(a, b);

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(texto: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}
// HMAC-SHA-256 em hexadecimal (64 letras): o CPF do pagador só é guardado assim, com uma chave que fica fora do banco.
export async function hmacHex(chave: string, texto: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(chave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto)));
}

/* ---------------- quem chama: origem, IP e limite ---------------- */
// Origem: no navegador (cabeçalho Origin) só os sites da lista; outro site recebe 403. Sem Origin (servidor, curl) a
// origem não é conferida aqui: cada função tem a própria trava (chave publishable, segredo do aviso, token interno).
export const origemPermitida = (origin: string | null, permitidas: string[]): boolean => !origin || permitidas.includes(origin);
export const ORIGENS_LOCAIS = ['http://localhost:8765', 'http://127.0.0.1:8765'];
export function origensPadrao(site: string, anteriores: string[] = []): string[] {
  const out: string[] = [];
  for (const u of [site, ...anteriores]) {
    try { const o = new URL(u).origin; if (!out.includes(o)) out.push(o); } catch { /* endereço inválido: fica de fora */ }
  }
  return [...out, ...ORIGENS_LOCAIS];
}
// A chave de quem chama pelo site: uma chave publishable do projeto no "apikey" (a mesma que o site usa para o banco).
// Diferente de clinicas-proximas, aqui é SEMPRE conferida: sem chave publishable no ambiente, ninguém passa.
export const chavesDoSite = (env: EnvGet): string[] => acceptedKeys(env, PUBLISHABLE_VARS);
export const chaveDoSite = (h: Cabecalhos, chaves: string[]): boolean => chaves.length > 0 && hasKey(h, chaves);
export const ipDeQuemChama = (h: Cabecalhos): string => (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'desconhecido';

// Limite por chave (IP, IP + ação) em cada instância da função: a contagem fica na memória da instância (outra
// instância conta do zero; o limite de verdade por telefone e por agendamento é o do banco). true = passou do limite.
export type Contagem = Map<string, { n: number; ate: number }>;
export function limitado(c: Contagem, chave: string, agora: number, max: number, janelaMs: number): boolean {
  const h = c.get(chave);
  if (!h || h.ate < agora) {
    if (c.size > 5000) c.clear();
    c.set(chave, { n: 1, ate: agora + janelaMs });
    return false;
  }
  h.n += 1;
  return h.n > max;
}

/* ---------------- respostas ---------------- */
export function cors(origin: string | null, permitidas: string[]): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && permitidas.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
export function json(r: Resposta, cabecalhos: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(r.corpo), {
    status: r.http,
    headers: { ...cabecalhos, ...(r.cabecalhos ?? {}), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/* ---------------- banco (funções do banco pelo PostgREST, com a chave secreta da função) ---------------- */
export class ErroBanco extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string) {
    super(`banco ${status} ${codigo}`);
    this.status = status;
    this.codigo = codigo;
  }
}
export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;
// Chama public.<fn> como o servidor (service_role). Nunca recebe nada de quem chamou a função além dos argumentos já
// conferidos. A resposta de erro do banco vira ErroBanco só com o código (sem a mensagem, que pode citar dados).
export function criarRpc(fetchFn: Fetch, url: string, chave: ProjectKey | null, tempoMs = 12000): Rpc {
  return async (fn, args = {}) => {
    if (!url || !chave) throw new ErroBanco(0, 'sem_chave');
    const res = await fetchFn(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { ...keyHeaders(chave), 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(tempoMs),
    });
    const texto = await res.text();
    let dados: unknown = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = null; }
    if (!res.ok) throw new ErroBanco(res.status, ehObjeto(dados) && typeof dados.code === 'string' ? dados.code : 'erro');
    return dados;
  };
}
// Chama public.<fn> COMO A PESSOA LOGADA (função pagamento-clinica): a chave publishable no "apikey" e o token dela, como
// chegou, em "Authorization". Quem decide o que ela pode é o banco (auth.uid() e as permissões da clínica): a função do
// servidor não empresta a chave secreta para nada que a pessoa peça. Sem token (ou sem a chave publishable no ambiente),
// nada é chamado.
export function criarRpcComo(fetchFn: Fetch, url: string, chavePublica: ProjectKey | null, tempoMs = 12000): (autorizacao: string) => Rpc {
  return (autorizacao) => async (fn, args = {}) => {
    if (!url || !chavePublica || !/^Bearer\s+\S+$/i.test(autorizacao)) throw new ErroBanco(0, 'sem_chave');
    const res = await fetchFn(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: chavePublica.key, Authorization: autorizacao, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(tempoMs),
    });
    const texto = await res.text();
    let dados: unknown = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = null; }
    if (!res.ok) throw new ErroBanco(res.status, ehObjeto(dados) && typeof dados.code === 'string' ? dados.code : 'erro');
    return dados;
  };
}
// Resposta de uma função do banco que devolve { status: ... }: o objeto, ou { status: 'erro' } se veio outra coisa.
export const resp = (v: unknown): Record<string, unknown> => (ehObjeto(v) ? v : { status: 'erro' });
// Erro do banco que quer dizer "o horário acabou de ser pego" (restrição de exclusão, chave repetida, 409).
export const horarioPego = (e: unknown): boolean => e instanceof ErroBanco && (e.status === 409 || e.codigo === '23P01' || e.codigo === '23505');
