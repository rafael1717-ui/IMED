// Edge Function "pagamento-webhook" (iMed Pagamentos, fase P2a): recebe os avisos do meio de pagamento.
//
// !!! NÃO PUBLICADA. Esta é só a fonte. Publicar depende do dono (veja "P2a: como ficou" em
// !!! memory/projects/imed-pagamento-arquitetura.md). Quando for a hora, SEMPRE com verify_jwt=false:
//   supabase functions deploy pagamento-webhook --no-verify-jwt --project-ref pyoqiecupxhdzigjudyd
// e o endereço dela é cadastrado no meio de pagamento junto com o segredo do aviso (o mesmo de ASAAS_WEBHOOK_TOKEN),
// com o envio SEQUENCIAL (recomendado pelo provedor para cobranças).
//
// Quem pode chamar: só quem traz o segredo do aviso no cabeçalho (comparação em tempo constante, lib.ts). Sem o segredo
// configurado, recusa TUDO. Não é chamada pelo navegador: não tem CORS e a origem não importa.
// O corpo do aviso NUNCA é guardado nem vai para registro (traz dados do pagador): só o id, o tipo e o hash. A situação
// aplicada é a consultada no provedor, nunca a do corpo.
//
// Variáveis de ambiente (segredos da função):
//   ASAAS_WEBHOOK_TOKEN   o segredo do aviso (32 a 255 caracteres, sem espaço; não pode ser uma chave de API)
//   ASAAS_API_KEY, ASAAS_API_URL   para consultar a cobrança (sem eles o aviso é só gravado e a rotina aplica depois)
import { criarRpc, json } from '../_shared/base.ts';
import { secretKey } from '../_shared/chaves.ts';
import { criarLeitor, criarProvedor } from '../_shared/provedor.ts';
import { receber, TAMANHO_MAXIMO } from './lib.ts';

const env = (name: string) => Deno.env.get(name);
const rpc = criarRpc(fetch, env('SUPABASE_URL') ?? '', secretKey(env));
const provedor = criarProvedor(env, fetch);
const leitor = criarLeitor(env);

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ http: 405, corpo: { ok: false, status: 'method_not_allowed' } });
  if (!leitor) return json({ http: 503, corpo: { ok: false, status: 'not_configured' } });
  try {
    if (Number(req.headers.get('content-length') ?? 0) > TAMANHO_MAXIMO) return json({ http: 413, corpo: { ok: false, status: 'too_large' } });
    return json(await receber(req.headers, await req.text(), { rpc, provedor, env, leitor }));
  } catch (err) {
    console.error('pagamento-webhook: erro inesperado:', err instanceof Error ? err.name : 'desconhecido');
    return json({ http: 500, corpo: { ok: false, status: 'erro' } });
  }
});
