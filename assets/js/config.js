// Configuração pública do site. Tudo aqui pode ficar no navegador:
// a chave "publishable" do Supabase (sb_publishable_...) é pública por natureza, como a antiga "anon", e só faz o que
// as regras do banco (RLS) permitem. Chaves secretas, como a chave secreta do Supabase e a do Google Maps Platform,
// ficam só no servidor, como segredos das Edge Functions (veja o README).
window.IMED_CONFIG = {
  supabaseUrl: 'https://pyoqiecupxhdzigjudyd.supabase.co',
  // Chave publishable "default" do projeto (Supabase → Settings → API Keys). Vai só no cabeçalho "apikey":
  // toda chamada monta os cabeçalhos com IMED_CONFIG.supabaseHeaders, logo abaixo.
  supabaseKey: 'sb_publishable_Ei-J3FK8Dl9wqsAou3sQlw_RAiPO_Xf',
  functionsUrl: 'https://pyoqiecupxhdzigjudyd.supabase.co/functions/v1',
  // Endereço público do site, usado nos links de login e nas páginas para o Google. Não troque à mão: para mudar
  // de endereço (domínio próprio, outro GitHub Pages), rode  node scripts/trocar-endereco.mjs https://endereco-novo/
  // (troca aqui, nas páginas, no sitemap, nas cidades e nas Edge Functions; veja o README).
  siteUrl: 'https://rafael1717-ui.github.io/IMED/',
  // WhatsApp do IMED, só dígitos com DDI e DDD (ex.: '5511987654321'). Vazio esconde os botões de WhatsApp.
  whatsapp: '',
  // Imagens do mapa. Ao trocar de provedor, atualize também a Content-Security-Policy de perto.html.
  map: {
    tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores do OpenStreetMap</a>',
    maxZoom: 19
  },
  // Servidores públicos do OpenStreetMap (Overpass) usados quando o Google Places não está ativo no servidor.
  overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
};

// Cabeçalhos de TODA chamada ao Supabase (banco, funções do banco, login e funções do servidor). A regra das chaves
// mora só aqui, para o site inteiro:
//   - "apikey": sempre a chave publishable (supabaseKey);
//   - "Authorization: Bearer <token>": só com o token de quem entrou na conta (auth.js). Visitante não manda
//     Authorization: com a chave publishable sozinha, o Supabase atende como visitante (o papel "anon" do banco).
// A chave publishable nunca vai em Authorization: ela não é um token (JWT), e a documentação do Supabase manda pô-la
// só no "apikey" (onde o Supabase espera um token, como nas funções com verify_jwt, recusa: "Invalid JWT").
// Uso: IMED_CONFIG.supabaseHeaders()                                  visitante
//      IMED_CONFIG.supabaseHeaders(token)                             pessoa logada
//      IMED_CONFIG.supabaseHeaders(token, { 'Content-Type': ... })    com outros cabeçalhos (Content-Type, Prefer...)
// "apikey" e "Authorization" vindos em extra são ignorados: só esta função decide os dois.
window.IMED_CONFIG.supabaseHeaders = function (token, extra) {
  var cfg = window.IMED_CONFIG || {};
  var h = {};
  if (extra) {
    for (var k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k) && !/^(apikey|authorization)$/i.test(k)) h[k] = extra[k];
    }
  }
  h.apikey = cfg.supabaseKey;
  if (typeof token === 'string' && token && token !== cfg.supabaseKey && token.indexOf('sb_') !== 0) {
    h.Authorization = 'Bearer ' + token;
  }
  return h;
};

// iPhone com iOS 15 (e outros navegadores antigos) não tem AbortSignal.timeout, usado nas chamadas ao banco.
// Este arquivo carrega antes dos outros scripts em todas as páginas, então a troca vale para o site inteiro.
if (window.AbortSignal && typeof AbortSignal.timeout !== 'function' && typeof AbortController === 'function') {
  AbortSignal.timeout = (ms) => {
    const c = new AbortController();
    setTimeout(() => { try { c.abort(new DOMException('Tempo esgotado', 'TimeoutError')); } catch { c.abort(); } }, ms);
    return c.signal;
  };
}
