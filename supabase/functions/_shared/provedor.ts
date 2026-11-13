// A CAMADA FINA do meio de pagamento (arquitetura do pagamento, §6.1): criar cobrança Pix com divisão, consultar,
// apagar, devolver, listar e conferir a carteira de uma clínica. As funções pagamento-criar, pagamento-webhook,
// pagamento-rotina e pagamento-clinica só conhecem ISTO; o que é
// do Asaas (endereços, nomes de campo, situações) fica em asaas.ts. Trocar de meio de pagamento é escrever outro
// adaptador com esta mesma interface e registrar em criarProvedor: a agenda e o banco não mudam.
//
// Tudo em centavos inteiros. A "foto" é a situação da cobrança CONSULTADA no provedor, no formato neutro que
// public.pag_sync_apply entende (o aviso é só a campainha: nunca se aplica o corpo do aviso).
import type { Cabecalhos, Fetch } from './base.ts';
import type { EnvGet } from './chaves.ts';
import { criarAsaas, leitorAsaas } from './asaas.ts';

export type Situacao = 'aguardando' | 'processando' | 'paga' | 'recusada' | 'apagada' | 'devolvida' | 'devolvida_parcial'
  | 'contestada' | 'contestacao_ganha' | 'contestacao_perdida';
export const SITUACOES: Situacao[] = ['aguardando', 'processando', 'paga', 'recusada', 'apagada', 'devolvida', 'devolvida_parcial',
  'contestada', 'contestacao_ganha', 'contestacao_perdida'];

export interface Foto {
  situacao: Situacao;
  valor_cents: number | null;      // o que foi cobrado (ou pago)
  tarifa_cents: number | null;     // tarifa real do meio de pagamento, quando o provedor informa
  devolvido_cents: number | null;  // total já devolvido
  paga_em: string | null;
  provedor_estorno_id: string | null;
}
// §6.3 (LGPD): o provedor recebe SÓ isto. Nada de exame, data, telefone, e-mail ou nome do paciente que não paga.
export interface Pagador { nome: string; cpf: string }
export interface CobrancaNova {
  referencia: string;     // o id da nossa cobrança (uuid)
  valorCents: number;
  clinicaCents: number;   // a parte da clínica, em VALOR FIXO (§3.3: o percentual do provedor incide sobre o líquido)
  walletId: string;       // a carteira da clínica (não é segredo)
  descricao: string;      // fixa: "IMED · agendamento XXXXXXXX" (vem do banco)
  clienteId: string;
  vencimento: string;     // AAAA-MM-DD (dia de hoje em São Paulo); quem vence em minutos é a NOSSA cobrança
}
export interface CobrancaCriada { id: string; copiaCola: string }
export interface Devolucao {
  valorCents: number;
  clinicaCents: number;   // quanto sai da carteira da clínica (0 na devolução integral do que chegou)
  walletId: string | null;
  total: boolean;         // devolve tudo o que resta (sem informar valor)
  chave: string;          // idempotência: a mesma chave não pode devolver duas vezes
}
export interface LinhaConciliacao {
  provedor_cobranca_id: string;
  situacao: Situacao;
  valor_cents: number;
  repasse_cents: number;
  tarifa_cents: number;
  devolvido_cents: number;
}
export interface Aviso {
  id: string;                 // id do evento (a trava contra aviso repetido)
  tipo: string;
  cobrancaId: string | null;  // aviso que não é de cobrança: null (é ignorado)
  situacao: string | null;
  valorCents: number | null;
  ocorridoEm: string | null;
}

// A carteira que a clínica informou, conferida no provedor ANTES de qualquer cobrança (função pagamento-clinica, P2b):
//   conferida       o provedor confirmou que a carteira existe e pode receber a divisão;
//   propria         é a carteira da própria conta do IMED (a divisão para si mesmo é recusada);
//   nao_existe      o provedor disse que não conhece a carteira;
//   sem_como_saber  o provedor não oferece (ou não respondeu de um jeito que dê para confiar) essa conferência: quem
//                   confere é a equipe do IMED, antes de ativar a conta (admin_pag_conta_conferir).
export type Carteira = 'conferida' | 'propria' | 'nao_existe' | 'sem_como_saber';

// Quem lê o aviso (webhook) de um provedor: não precisa da chave da API.
export interface Leitor {
  nome: string;
  /** O segredo que veio no aviso (cada provedor manda num cabeçalho). */
  segredoDoAviso(h: Cabecalhos): string;
  /** Lê o corpo do aviso. null: não é um aviso que dê para entender. */
  lerAviso(corpo: unknown): Aviso | null;
}

export interface Provedor extends Leitor {
  criarCliente(p: Pagador): Promise<string>;
  criarCobranca(c: CobrancaNova): Promise<CobrancaCriada>;
  /** A cobrança que já existe no provedor com esta referência (a criação caiu no meio do caminho), ou null. */
  buscarPorReferencia(referencia: string): Promise<{ id: string; foto: Foto } | null>;
  consultar(id: string): Promise<Foto>;
  /** O "copia e cola" de uma cobrança que já existe. */
  copiaCola(id: string): Promise<string>;
  /** Apaga a cobrança; se já foi paga, o provedor recusa e a foto devolvida diz "paga". */
  apagar(id: string): Promise<Foto>;
  devolver(id: string, d: Devolucao): Promise<{ estornoId: string | null; foto: Foto }>;
  /** As cobranças criadas no dia (AAAA-MM-DD, São Paulo), para a conciliação. */
  listar(dia: string): Promise<LinhaConciliacao[]>;
  /** Confere, sem mover dinheiro, a carteira que uma clínica informou. Nunca cria cobrança. */
  conferirCarteira(walletId: string): Promise<Carteira>;
}

// Erro do provedor, só com código (nunca a resposta inteira, que pode trazer dados do pagador).
//   definitivo = o provedor RECUSOU (4xx): repetir igual não adianta. Não definitivo (rede, tempo esgotado, 5xx, 429):
//   não se sabe se a operação aconteceu; quem chama confere antes de repetir.
export class ErroProvedor extends Error {
  status: number;
  codigo: string;
  definitivo: boolean;
  constructor(status: number, codigo: string) {
    super(`provedor ${status} ${codigo}`);
    this.status = status;
    this.codigo = codigo;
    this.definitivo = status >= 400 && status < 500 && status !== 408 && status !== 429;
  }
}
// Código de erro no formato que o banco guarda (letras minúsculas, números e _; sem sequência longa de dígitos).
export function codigoDoErro(e: unknown): string {
  const bruto = e instanceof ErroProvedor ? e.codigo : e instanceof Error && e.name === 'TimeoutError' ? 'tempo_esgotado' : 'erro_no_envio';
  const c = String(bruto).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/\d{4,}/g, 'n').replace(/^_+|_+$/g, '').slice(0, 60);
  return /^[a-z][a-z0-9_]{2,59}$/.test(c) ? c : 'erro_no_envio';
}

export const reais = (centavos: number): number => Number((centavos / 100).toFixed(2));   // 13323 → 133.23
export const centavos = (v: unknown): number => Math.round(Number(v) * 100);              // 133.23 → 13323

// Dia de hoje em São Paulo (AAAA-MM-DD), para o vencimento da cobrança.
export function diaSP(agoraMs: number): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(agoraMs));
}

const nomeDoProvedor = (env: EnvGet): string => (env('PAG_PROVEDOR') ?? 'asaas').trim().toLowerCase();
// Quem lê os avisos do provedor configurado (hoje só o Asaas).
export const criarLeitor = (env: EnvGet): Leitor | null => (nomeDoProvedor(env) === 'asaas' ? leitorAsaas : null);

// O provedor configurado nos segredos da função, ou null (sem chave ou sem endereço: nada é criado nem consultado).
// PAG_PROVEDOR: hoje só "asaas" (padrão). A chave e o endereço da API vêm só do ambiente; nenhum endereço fixo aqui.
export function criarProvedor(env: EnvGet, fetchFn: Fetch): Provedor | null {
  if (nomeDoProvedor(env) !== 'asaas') return null;
  const chave = (env('ASAAS_API_KEY') ?? '').trim();
  const url = (env('ASAAS_API_URL') ?? '').trim().replace(/\/+$/, '');
  if (!chave || !/^https?:\/\//.test(url)) return null;
  return criarAsaas({ url, chave }, fetchFn);
}
