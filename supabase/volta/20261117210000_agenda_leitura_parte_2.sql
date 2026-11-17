-- VOLTA da parte 2 de 2 da migração agenda_leitura (iMed Agenda, fase 4.2; só se for preciso desfazer): desfaz SÓ o
-- fechamento — a clínica volta a ler pedidos, horários e bloqueios direto pela API, como antes da parte 2. Tem o mesmo
-- nome da migração da parte 2: se ela for renomeada, renomeie esta também. Para desfazer a 4.2 inteira, rode depois a
-- volta da parte 1 (supabase/volta/<versão>_agenda_leitura_parte_1.sql). Testada no CI (banco.yml): com a parte 1 na
-- produção e a parte 2 ainda não, esta volta deixa o banco igual ao da produção.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);

grant select on table public.clinic_schedules, public.clinic_blocks to authenticated;
alter policy "membro ve os bloqueios da clinica" on public.clinic_blocks
  using ((public.has_clinic_perm(clinic_id, 'agenda.ver') or public.is_imed_admin()) and removed_at is null);
alter policy "membro ve a agenda da clinica" on public.clinic_schedules
  using (public.has_clinic_perm(clinic_id, 'agenda.ver') or public.is_imed_admin());
alter policy "admin le pedidos" on public.appointment_requests
  using (public.is_imed_admin() and status not in ('hold', 'expired'));
alter policy "clinica ve pedidos para ela" on public.appointment_requests
  using (clinic_id is not null and public.has_clinic_perm(clinic_id, 'pedidos.ver') and status not in ('hold', 'expired'));
