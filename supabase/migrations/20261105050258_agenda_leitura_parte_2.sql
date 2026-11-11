-- iMed Agenda, fase 4.2: parte 2 de 2 — FECHA a leitura direta (arquitetura §2.3 e §12, R2-13). Pequena, aplicada
-- por último e separada, só depois do painel novo no ar e conferido (decisão 4.2-g; ele lê só pelas funções, com
-- registro de quem leu). O conector pede a confirmação do dono (REVOKE). Nada é apagado: as policies ficam (com
-- "using (false)"), como já foi feito com "admin atualiza pedidos".
--   1. A clínica deixa de ler os pedidos direto pela API (lê por agenda_requests, agenda_view, agenda_search e
--      agenda_request_detail, que registram a leitura).
--   2. A equipe do IMED continua lendo direto SÓ os pedidos ao IMED (sem clínica: a aba "Pedidos ao IMED"); os de
--      clínica, pelas funções, com o motivo registrado (decisão 4.2-d).
--   3. Horários e bloqueios da clínica: só pelas funções (agenda_config, agenda_view, agenda_blocks). Quem tiver uma
--      tela antiga aberta recebe um erro claro (sem permissão) em vez de uma lista vazia.
--   O paciente continua lendo os próprios pedidos (policy "paciente ve seus pedidos", intacta), cancelando
--   (cancel_request) e acompanhando (request_status, agenda_my_booking): são funções, não leitura direta. O pedido
--   pelo site (INSERT das 23 colunas) não muda.
-- Pode rodar de novo sem erro e sem mudar nada. Volta: supabase/volta/<versão>_agenda_leitura_parte_2.sql (só o
-- fechamento; a parte 1 tem a volta dela).
-- NOME PROVISÓRIO, AINDA NÃO APLICADA NA PRODUÇÃO (05/11/2026; ao aplicar, tire esta marca): a parte 1 entrou como 20261105050257_agenda_leitura_parte_1; este
-- arquivo e a volta dele ficaram com o nome provisório 20261105050258 (a versão da parte 1 mais 1 segundo: o banco.yml
-- reprova a parte 2 antes da parte 1). Só entra uns dias depois do painel novo no ar e conferido, com NOVA autorização
-- do dono (decisão 4.2-g). Quando for aplicada, este arquivo e a volta ganham a versão que o conector gravar, e
-- ULTIMA_NA_PRODUCAO no banco.yml muda junto.
--
-- Conferir na produção depois desta parte (só leitura; tem de dar true):
--   select (select qual from pg_policies where tablename = 'appointment_requests' and policyname = 'clinica ve pedidos para ela') = 'false'
--      and (select qual from pg_policies where tablename = 'appointment_requests' and policyname = 'admin le pedidos') like '%clinic_id IS NULL%'
--      and (select qual from pg_policies where tablename = 'appointment_requests' and policyname = 'paciente ve seus pedidos') = '(user_id = auth.uid())'
--      and (select with_check from pg_policies where tablename = 'appointment_requests' and policyname = 'qualquer pessoa pede agendamento') = '(consent AND (status = ''pending''::text))'
--      and (select qual from pg_policies where tablename = 'clinic_blocks' and policyname = 'membro ve os bloqueios da clinica') = 'false'
--      and (select qual from pg_policies where tablename = 'clinic_schedules' and policyname = 'membro ve a agenda da clinica') = 'false'
--      and not has_table_privilege('authenticated', 'public.clinic_blocks', 'SELECT')
--      and not has_table_privilege('authenticated', 'public.clinic_schedules', 'SELECT')
--      and has_table_privilege('authenticated', 'public.appointment_requests', 'SELECT')
--      and has_column_privilege('anon', 'public.appointment_requests', 'review_token_hash', 'INSERT')
--      and has_function_privilege('anon', 'public.cancel_request(uuid,text)', 'EXECUTE')
--      and has_function_privilege('anon', 'public.request_status(uuid[],text[])', 'EXECUTE')
--      and has_function_privilege('authenticated', 'public.agenda_requests(uuid,text,text)', 'EXECUTE');
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

alter policy "clinica ve pedidos para ela" on public.appointment_requests using (false);
alter policy "admin le pedidos" on public.appointment_requests
  using (public.is_imed_admin() and clinic_id is null and status not in ('hold', 'expired'));
alter policy "membro ve a agenda da clinica" on public.clinic_schedules using (false);
alter policy "membro ve os bloqueios da clinica" on public.clinic_blocks using (false);
revoke select on table public.clinic_schedules, public.clinic_blocks from authenticated;
