// Edge Function "pagamento-clinica" (iMed Pagamentos, fase P2b): a clínica informa a conta dela no meio de pagamento.
//
// !!! NÃO PUBLICADA. Esta é só a fonte. Publicar depende do dono (conta no meio de pagamento, contrato de adesão da
// !!! clínica revisado pelo advogado) e dos passos de memory/projects/imed-pagamento-arquitetura.md ("P2b: como ficou").
// !!! Quando for a hora, SEMPRE com verify_jwt=false (a função confere quem chama no próprio código):
//   supabase functions deploy pagamento-clinica --no-verify-jwt --project-ref pyoqiecupxhdzigjudyd
//
// Quem pode chamar (travas em lib.ts e ../_shared/base.ts, com testes):
//   - origem: no navegador, só o site (bloco endereco-do-site ou o segredo ALLOWED_ORIGINS); outro site recebe 403;
//   - chave: o "apikey" precisa ser uma chave publishable do projeto (a mesma regra de pagamento-criar);
//   - sessão: SEMPRE. O token de quem chamou é conferido pelo Auth do projeto e é com ele (nunca com a chave secreta)
//     que a função fala com o banco: quem decide se a pessoa pode é o banco (financeiro.configurar: só o dono da clínica);
//   - limites por pessoa e por IP em cada instância.
//
// Ações (POST, JSON), as duas para o(a) dono(a) da clínica:
//   conferir  { clinic, wallet }          confere a carteira no meio de pagamento. Não grava nada.
//   ligar     { clinic, wallet, terms }   confere e grava a carteira e o aceite dos termos: a conta fica "em conferência".
//             Não ativa nada: a equipe do IMED confere, depois a unidade é posta no modo on-line e, por último, a chave geral.
// Esta função nunca cria cobrança e nunca move dinheiro.
//
// Variáveis de ambiente (da função; nunca no repositório, no site, em tabela ou em registro):
//   ASAAS_API_KEY        chave da API do meio de pagamento (segredo)
//   ASAAS_API_URL        endereço da API do meio de pagamento (sem ele, o provedor não é criado e a função recusa tudo)
//   PAG_TERMOS_CLINICA   versão em vigor dos termos da clínica (ex.: "v1"; não é segredo). Sem ela, "ligar" recusa tudo:
//                        só existe depois de o contrato de adesão ser revisado pelo advogado
//   ALLOWED_ORIGINS      opcional: sites que podem chamar, separados por vírgula
// SUPABASE_URL e a chave publishable do projeto são preenchidas pelo Supabase (leitura em ../_shared/chaves.ts). A chave
// secreta do projeto NÃO é usada aqui.
//
// Nada do que a pessoa manda vai para os registros (console): só códigos de erro. A carteira não é segredo, mas também
// não é registrada; a resposta só devolve os 4 últimos caracteres.
import { chaveDoSite, chavesDoSite, cors, criarRpcComo, ipDeQuemChama, json, origemPermitida, origensPadrao, type Contagem } from '../_shared/base.ts';
import { keyHeaders, publishableKey } from '../_shared/chaves.ts';
import { criarProvedor } from '../_shared/provedor.ts';
import { tratar } from './lib.ts';

const env = (name: string) => Deno.env.get(name);
const SUPABASE_URL = env('SUPABASE_URL') ?? '';
const PUBLIC_KEY = publishableKey(env);
const CHAVES_DO_SITE = chavesDoSite(env);
// >>> endereco-do-site (bloco mantido por scripts/trocar-endereco.mjs; não edite à mão, rode o script)
// SITE_URL: endereço público do site. SITE_ANTERIORES: endereços que o site já teve e que continuam aceitos como
// origem enquanto o site antigo existir (para tirar um: node scripts/trocar-endereco.mjs --esquecer=<endereço>).
const SITE_URL = 'https://rafael1717-ui.github.io/IMED/';
const SITE_ANTERIORES: string[] = ['https://drrafaelpereirabarreto-code.github.io/testedoapp/'];
// <<< endereco-do-site
const ALLOWED_ORIGINS = (env('ALLOWED_ORIGINS') ?? origensPadrao(SITE_URL, SITE_ANTERIORES).join(','))
  .split(',').map((s) => s.trim()).filter(Boolean);

// O banco como a pessoa logada: a chave publishable e o token dela. A chave secreta não entra nesta função.
const rpcComo = criarRpcComo(fetch, SUPABASE_URL, PUBLIC_KEY);
const provedor = criarProvedor(env, fetch);
const contagem: Contagem = new Map();

// A conta de quem está logado: o Auth do projeto confere o token que veio (o cabeçalho Authorization passa como chegou).
async function usuario(autorizacao: string): Promise<string | null> {
  if (!/^Bearer\s+\S+$/i.test(autorizacao) || !PUBLIC_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { ...keyHeaders(PUBLIC_KEY), Authorization: autorizacao }, signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && typeof u.id === 'string' ? u.id : null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const h = cors(origin, ALLOWED_ORIGINS);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (!origemPermitida(origin, ALLOWED_ORIGINS)) return json({ http: 403, corpo: { ok: false, status: 'origin_not_allowed' } }, h);
  if (req.method !== 'POST') return json({ http: 405, corpo: { ok: false, status: 'method_not_allowed' } }, h);
  // Aqui a chave de quem chama é SEMPRE conferida: sem a chave publishable no ambiente, ninguém passa.
  if (!chaveDoSite(req.headers, CHAVES_DO_SITE)) return json({ http: 401, corpo: { ok: false, status: 'unauthorized' } }, h);
  let corpo: unknown;
  try { corpo = await req.json(); } catch { return json({ http: 400, corpo: { ok: false, status: 'invalid_json' } }, h); }
  try {
    return json(await tratar(corpo, { ip: ipDeQuemChama(req.headers), autorizacao: req.headers.get('authorization') ?? '' }, {
      rpcComo, provedor, env, agora: () => Date.now(), usuario, contagem,
    }), h);
  } catch (err) {
    console.error('pagamento-clinica: erro inesperado:', err instanceof Error ? err.name : 'desconhecido');
    return json({ http: 500, corpo: { ok: false, status: 'erro' } }, h);
  }
});
