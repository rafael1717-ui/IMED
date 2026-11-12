// Edge Function "pagamento-criar" (iMed Pagamentos, fase P2a): "Ir para o pagamento" do paciente.
//
// !!! NÃO PUBLICADA. Esta é só a fonte. Publicar depende do dono (conta no meio de pagamento, respostas do contador e
// !!! do advogado, Turnstile) e dos passos de memory/projects/imed-pagamento-arquitetura.md ("P2a: como ficou").
// !!! Quando for a hora, SEMPRE com verify_jwt=false (a função confere quem chama no próprio código):
//   supabase functions deploy pagamento-criar --no-verify-jwt --project-ref pyoqiecupxhdzigjudyd
//
// Quem pode chamar (travas em lib.ts e ../_shared/base.ts, com testes):
//   - origem: no navegador, só o site (bloco endereco-do-site ou o segredo ALLOWED_ORIGINS); outro site recebe 403;
//   - chave: o "apikey" precisa ser uma chave publishable do projeto (a mesma regra de clinicas-proximas);
//   - Turnstile: OBRIGATÓRIO. Sem o segredo TURNSTILE_SECRET_KEY a função recusa tudo (503): fechada por padrão;
//   - limites por IP em cada instância; os limites de verdade (por telefone e por agendamento) são do banco;
//   - e o banco recusa enquanto a chave geral (vendas_online_ligadas) estiver desligada ou a clínica sem o recebimento.
//
// Ações (POST, JSON):
//   criar     { clinic, items: [{ procedure_id, starts_at }], patient: {...}, id, token, key, payer: { name, cpf }, captcha }
//             → reserva o horário, cria a cobrança Pix com a divisão e devolve { payment: { pix_copia_cola, expira_em, valor_cents } }.
//             Os valores vêm do banco (o preço fotografado na reserva); o que vem do navegador é só a escolha.
//   conferir  { id, token }  "já paguei": consulta o provedor e aplica a situação consultada. Não confirma nada sozinha.
//
// Variáveis de ambiente (segredos da função; nunca no repositório, no site, em tabela ou em registro):
//   ASAAS_API_KEY         chave da API do meio de pagamento (a de testes e a de produção, em projetos separados)
//   ASAAS_API_URL         endereço da API do meio de pagamento (sem ele, o provedor não é criado)
//   PAG_CPF_HMAC_KEY      chave (32+ caracteres) do HMAC do CPF: o CPF nunca é guardado em texto
//   TURNSTILE_SECRET_KEY  segredo do Turnstile (Cloudflare)
//   ALLOWED_ORIGINS       opcional: sites que podem chamar, separados por vírgula
// SUPABASE_URL e as chaves do projeto são preenchidas pelo Supabase (leitura em ../_shared/chaves.ts).
//
// LGPD (§6.3): o meio de pagamento recebe só o nome e o CPF de quem paga, o valor, a descrição fixa
// "IMED · agendamento <código>" e a carteira da clínica. Nunca o exame, a data, o telefone ou o e-mail. Nada do pagador
// vai para os registros (console): só códigos de erro.
import { chaveDoSite, chavesDoSite, cors, criarRpc, ipDeQuemChama, json, origemPermitida, origensPadrao, type Contagem } from '../_shared/base.ts';
import { keyHeaders, publishableKey, secretKey } from '../_shared/chaves.ts';
import { criarProvedor } from '../_shared/provedor.ts';
import { tratar } from './lib.ts';

const env = (name: string) => Deno.env.get(name);
const SUPABASE_URL = env('SUPABASE_URL') ?? '';
const PUBLIC_KEY = publishableKey(env);
const SECRET_KEY = secretKey(env);
const CHAVES_DO_SITE = chavesDoSite(env);
// >>> endereco-do-site (bloco mantido por scripts/trocar-endereco.mjs; não edite à mão, rode o script)
// SITE_URL: endereço público do site. SITE_ANTERIORES: endereços que o site já teve e que continuam aceitos como
// origem enquanto o site antigo existir (para tirar um: node scripts/trocar-endereco.mjs --esquecer=<endereço>).
const SITE_URL = 'https://rafael1717-ui.github.io/IMED/';
const SITE_ANTERIORES: string[] = ['https://drrafaelpereirabarreto-code.github.io/testedoapp/'];
// <<< endereco-do-site
const ALLOWED_ORIGINS = (env('ALLOWED_ORIGINS') ?? origensPadrao(SITE_URL, SITE_ANTERIORES).join(','))
  .split(',').map((s) => s.trim()).filter(Boolean);

const rpc = criarRpc(fetch, SUPABASE_URL, SECRET_KEY);
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
      rpc, provedor, env, fetch, agora: () => Date.now(), usuario, contagem,
    }), h);
  } catch (err) {
    console.error('pagamento-criar: erro inesperado:', err instanceof Error ? err.name : 'desconhecido');
    return json({ http: 500, corpo: { ok: false, status: 'erro' } }, h);
  }
});
