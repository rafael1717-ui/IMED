-- VOLTA da migração tele_valores (valores da teleconsulta; só se for preciso desfazer). Tem o mesmo nome da migração:
-- se ela for renomeada, renomeie esta também. Tira as três funções e a tabela private.tele_valores (o preço e o
-- repasse lançados e o histórico deles se perdem: anote antes). Nenhuma consulta, documento ou médico muda.
-- Antes de desfazer: voltar o site para a versão sem o bloco do repasse (área do médico e painel de gestão).
-- Testada no CI (banco.yml): desfeita, o banco fica igual ao da produção.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

drop function if exists public.admin_tele_valores_definir(integer, integer);
drop function if exists public.admin_tele_repasses(text);
drop function if exists public.tele_repasse_medico();
drop function if exists private.tele_atendidas(uuid, timestamptz, timestamptz);
drop table if exists private.tele_valores;
drop function if exists private.tele_valores_guard();
