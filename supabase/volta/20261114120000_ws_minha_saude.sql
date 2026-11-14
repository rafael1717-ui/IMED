-- VOLTA da migração ws_minha_saude ("Minha Saúde", etapa 1; só se for preciso desfazer). Tem o mesmo nome da migração:
-- se ela for renomeada, renomeie esta também. Tira as funções saude_* e a tabela prontuario.saude_vinculos (as
-- consultas que os pacientes guardaram na conta deixam de estar guardadas: avise antes; os documentos e o registro
-- do médico não mudam, e cada paciente continua vendo os documentos pelo aparelho em que fez a consulta) e a linha do
-- interruptor em private.app_settings. As linhas já gravadas na trilha de acesso ficam (a trilha não se apaga).
-- Antes de desfazer: voltar o site para a versão sem a página minha-saude.html.
-- Testada no CI (banco.yml): desfeita, o banco fica igual ao da produção.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

drop function if exists public.saude_documento_pdf(uuid);
drop function if exists public.saude_documentos(uuid);
drop function if exists public.saude_minhas_consultas();
drop function if exists public.saude_vinculo_revogar(uuid);
drop function if exists public.saude_guardar(uuid, text);
drop function if exists private.saude_vinculo(uuid);
drop function if exists private.saude_guardar_ligado();
drop function if exists private.saude_entrada_recente(integer);
drop function if exists private.saude_sessao();
drop table if exists prontuario.saude_vinculos;
delete from private.app_settings where key = 'saude_guardar';
