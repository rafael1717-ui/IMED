// Edge Function "pagamento-rotina" (iMed Pagamentos, fase P2a): o que o banco manda fazer a cada minuto.
//
// !!! NÃO PUBLICADA. Esta é só a fonte. Publicar depende do dono (veja "P2a: como ficou" em
// !!! memory/projects/imed-pagamento-arquitetura.md). Quando for a hora, SEMPRE com verify_jwt=false:
//   supabase functions deploy pagamento-rotina --no-verify-jwt --project-ref pyoqiecupxhdzigjudyd
//
// Quem chama: só o próprio banco. O pg_cron roda private.pag_rotina_chamar() (migração pagamentos_rotina), que só
// chama quando há o que fazer e quando private.app_settings tem o endereço das funções; o pedido traz o token interno
// "pagamentos" no cabeçalho x-imed-token, conferido por check_internal_token (como a fila de importação).
// Corpo (JSON): { "conciliar": true } na chamada da madrugada (compara o dia anterior com o provedor); vazio nas outras.
//
// O que faz: lib.ts (apaga cobrança vencida, consulta a que ficou sem aviso, solta reserva sem cobrança, envia
// devolução, reaplica aviso pendente e concilia). Nada aqui confirma pagamento por conta própria: sempre a situação
// consultada no provedor, aplicada pelo banco.
//
// Variáveis de ambiente (segredos da função): ASAAS_API_KEY e ASAAS_API_URL. Sem elas, só solta reserva sem cobrança.
import { criarRpc, json } from '../_shared/base.ts';
import { secretKey } from '../_shared/chaves.ts';
import { criarProvedor } from '../_shared/provedor.ts';
import { tratar } from './lib.ts';

const env = (name: string) => Deno.env.get(name);
const rpc = criarRpc(fetch, env('SUPABASE_URL') ?? '', secretKey(env), 20000);
const provedor = criarProvedor(env, fetch);

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ http: 405, corpo: { ok: false, status: 'method_not_allowed' } });
  const corpo = await req.json().catch(() => null);
  try {
    return json(await tratar(req.headers, corpo, { rpc, provedor, agora: () => Date.now() }));
  } catch (err) {
    console.error('pagamento-rotina: erro inesperado:', err instanceof Error ? err.name : 'desconhecido');
    return json({ http: 500, corpo: { ok: false, status: 'erro' } });
  }
});
