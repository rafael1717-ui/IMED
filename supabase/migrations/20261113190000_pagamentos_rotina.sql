-- iMed Pagamentos, fase P2a ("Pix por dentro", invisível), 11/11/2026: a rotina do pagamento no banco. Arquitetura:
-- memory/projects/imed-pagamento-arquitetura.md (§4.4, §6.1 e "P2a: como ficou", no fim). Vem DEPOIS das 5 partes da
-- P1 (pagamentos_base_parte_1 a 5): usa as tabelas e as funções delas. Volta: supabase/volta/<mesmo nome>.sql.
--
-- NOME PROVISÓRIO (ainda não aplicada na produção): ao aplicar, siga os 5 passos de "Ao aplicar uma migração provisória
-- na produção" do .github/workflows/banco.yml (renomear esta e a volta com a versão que o conector gravar, tirar esta
-- marca, tirar o nome de PENDENTES_NA_PRODUCAO, renomear as outras provisórias para depois dela e trocar
-- ULTIMA_NA_PRODUCAO). Só DEPOIS das 5 partes da P1.
--
-- Em linguagem simples: só CRIA coisas novas; não muda nenhuma função, tabela ou dado que já existe.
--   1. Um token interno novo ("pagamentos", em private.app_tokens): o banco o manda no cabeçalho x-imed-token quando
--      chama a Edge Function pagamento-rotina, e a função confere por check_internal_token (como a fila de importação).
--   2. private.pag_tem_trabalho: há o que a rotina fazer agora? (reserva sem cobrança, cobrança vencida para apagar,
--      cobrança perto de vencer sem aviso, devolução para enviar, aviso gravado e não aplicado).
--   3. private.pag_rotina_chamar: se há trabalho, chama <endereço das funções>/pagamento-rotina pelo pg_net. O endereço
--      vem de private.app_settings (chave functions_url), nunca do código: banco sem o endereço (testes do GitHub, cópia
--      local) não chama nada; com trabalho esperando e sem endereço, a execução falha com o aviso (rotina parada).
--   4. Dois jobs do pg_cron: imed-pagamentos-rotina (a cada minuto) e imed-pagamentos-conciliacao (uma vez por dia, de
--      madrugada em São Paulo, pedindo também a conciliação do dia anterior).
--   5. public.pag_charge_lookup (só o servidor): acha a cobrança de um agendamento pelo código dele, para o "já paguei"
--      da Edge Function pagamento-criar consultar o provedor. Só leitura.
-- COM TUDO DESLIGADO NADA MUDA: sem cobrança nenhuma (a chave geral está desligada e nenhuma clínica tem conta),
-- pag_tem_trabalho responde "não" e nenhum job chama nada. As Edge Functions do pagamento NÃO estão publicadas.
-- Pode rodar de novo sem erro e sem mudar nada. Conferir na produção depois de aplicar (tem de dar true):
--   select (select count(*) from cron.job where jobname in ('imed-pagamentos-rotina', 'imed-pagamentos-conciliacao')) = 2
--      and not private.pag_tem_trabalho(true)
--      and not has_function_privilege('authenticated', 'public.pag_charge_lookup(uuid,text)', 'EXECUTE');

select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

/* ===================== 1. Token interno da rotina ===================== */
insert into private.app_tokens (name) values ('pagamentos') on conflict do nothing;

/* ===================== 2. Há trabalho? ===================== */
-- As mesmas perguntas de public.pag_due() (parte 3 da P1), um pouco mais largas (chamar sem ter o que fazer não muda
-- nada; deixar de chamar com trabalho esperando, sim). p_conciliar: a chamada da madrugada, que também compara o dia
-- anterior com o provedor (só faz sentido depois de existir alguma cobrança no provedor).
create or replace function private.pag_tem_trabalho(p_conciliar boolean default false)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from public.appointment_requests a
                 where a.payment_mode = 'online' and a.status = 'hold' and a.created_at < now() - interval '60 seconds')
      or exists (select 1 from pagamentos.charges c
                 where c.provedor_cobranca_id is not null and c.apagada_no_provedor_em is null and c.paga_em is null
                   and ((c.situacao = 'aguardando' and c.expira_em <= now() + interval '2 minutes')
                        or c.situacao in ('processando', 'cancelada', 'expirada')))
      or exists (select 1 from pagamentos.refunds f
                 where f.situacao = 'enviada' or (f.situacao in ('pedida', 'falhou') and f.tentativas < 10))
      or exists (select 1 from pagamentos.events e where e.resultado = 'pendente' and e.charge_id is not null)
      or (coalesce(p_conciliar, false) and exists (select 1 from pagamentos.charges c where c.provedor_cobranca_id is not null));
$$;

/* ===================== 3. Chamar a rotina ===================== */
-- Só o pg_cron (dono postgres) chama. Devolve o que fez: 'nada' (sem trabalho) ou 'chamada'. Nada de endereço no
-- código (guardas do catálogo, supabase/tests/000_catalogo.sql): o endereço das funções vem de private.app_settings.
create or replace function private.pag_rotina_chamar(p_conciliar boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  tok text;
begin
  if not private.pag_tem_trabalho(p_conciliar) then return 'nada'; end if;
  select nullif(btrim(s.value), '') into base from private.app_settings s where s.key = 'functions_url';
  select t.token into tok from private.app_tokens t where t.name = 'pagamentos';
  if base is null or tok is null then
    raise exception 'Rotina do pagamento parada: falta o endereço das funções (private.app_settings, chave functions_url) ou o token interno "pagamentos"'
      using errcode = '55000',
            hint = 'Na produção, o endereço é gravado uma vez (veja o cabeçalho da migração agenda_preparo). Em banco de teste, é o esperado.';
  end if;
  perform net.http_post(
    url := base || '/pagamento-rotina',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-imed-token', tok),
    body := jsonb_build_object('conciliar', coalesce(p_conciliar, false)),
    timeout_milliseconds := 55000
  );
  return 'chamada';
end $$;

revoke all on function private.pag_tem_trabalho(boolean) from public, anon, authenticated, service_role;
revoke all on function private.pag_rotina_chamar(boolean) from public, anon, authenticated, service_role;

/* ===================== 4. Jobs ===================== */
-- A cada minuto (§6.1). De madrugada: 07:17 UTC = 04:17 em São Paulo, com a conciliação do dia anterior (§5.4).
select cron.schedule('imed-pagamentos-rotina', '* * * * *', 'select private.pag_rotina_chamar()');
select cron.schedule('imed-pagamentos-conciliacao', '17 7 * * *', 'select private.pag_rotina_chamar(true)');

/* ===================== 5. "Já paguei": achar a cobrança pelo código do agendamento ===================== */
-- Só o servidor (service_role; a Edge Function pagamento-criar, ação "conferir"). Confere o código do agendamento (o
-- banco guarda o SHA-256) e devolve a cobrança mais recente dele (a viva primeiro), com o id no provedor: é o que a
-- função precisa para consultar o provedor e chamar pag_sync_apply. Só leitura; nada do pagador.
create or replace function public.pag_charge_lookup(p_request uuid, p_token text)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  r public.appointment_requests;
  c pagamentos.charges;
begin
  if not private.pag_servidor() then return jsonb_build_object('status', 'forbidden'); end if;
  select * into r from public.appointment_requests a where a.id = p_request;
  if not found or (r.review_token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')) is not true then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into c from pagamentos.charges x where x.request_id = r.id
  order by (x.situacao in ('criada', 'aguardando', 'processando', 'aprovada', 'devolvida_parcial', 'contestada')) desc, x.criado_em desc
  limit 1;
  if c.id is null then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok', 'charge_id', c.id, 'situacao', c.situacao,
                            'provedor_cobranca_id', c.provedor_cobranca_id, 'request_status', r.status);
end $$;
revoke all on function public.pag_charge_lookup(uuid, text) from public, anon, authenticated;
grant execute on function public.pag_charge_lookup(uuid, text) to service_role;

/* ===================== 6. Descrições ===================== */
comment on function private.pag_rotina_chamar(boolean) is
  'Só o pg_cron: se há trabalho do pagamento, chama a Edge Function pagamento-rotina (endereço de private.app_settings, token interno "pagamentos").';
comment on function public.pag_charge_lookup(uuid, text) is
  'Só o servidor: a cobrança de um agendamento, pelo código dele, para o "já paguei" consultar o provedor. Só leitura.';
