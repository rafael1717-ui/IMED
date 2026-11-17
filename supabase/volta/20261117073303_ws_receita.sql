-- VOLTA da migração ws_receita (Receita completa, etapa 1; só se for preciso desfazer). Tem o mesmo nome da migração:
-- se ela for renomeada, renomeie esta também. Tira o gatilho da lista de controle em public.tele_documents, as funções
-- ws_receita_* e cat_regra*, as tabelas prontuario.prescricoes, prescricao_itens e prescricao_modelos e a lista
-- catalogo.med_regras. Os rascunhos de receita e os modelos dos médicos se perdem (avise antes); as receitas já
-- emitidas continuam inteiras em public.tele_documents (o documento, o PDF e a conferência não mudam), só deixam de
-- ter a cópia campo a campo. As linhas já gravadas nas trilhas ficam (a trilha não se apaga).
-- Antes de desfazer: voltar o site para a versão sem assets/js/receita.js (a aba Receita antiga não usa nada daqui).
-- Testada no CI (banco.yml): desfeita, o banco fica igual ao da produção.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true);

drop trigger if exists tele_documents_rx_lista on public.tele_documents;
drop function if exists public.cat_regra_retirar(uuid, text);
drop function if exists public.cat_regra_lancar(text, text, text);
drop function if exists public.cat_regra_listar();
drop function if exists public.cat_regras_receita();
drop function if exists public.ws_receita_modelo_apagar(uuid);
drop function if exists public.ws_receita_modelo_salvar(uuid, text, jsonb);
drop function if exists public.ws_receita_modelos();
drop function if exists public.ws_receita_emitir(uuid, integer, jsonb, boolean);
drop function if exists public.ws_receita_salvar(uuid, jsonb, integer);
drop function if exists public.ws_receita_abrir(uuid, text);
drop table if exists prontuario.prescricao_modelos;
drop table if exists prontuario.prescricao_itens;
drop table if exists prontuario.prescricoes;
drop function if exists private.rx_medico();
drop function if exists private.rx_payload(jsonb, boolean);
drop function if exists private.rx_via_rotulo(text, text);
drop function if exists private.rx_emitir_erro(jsonb);
drop function if exists private.rx_conteudo_erro(jsonb);
drop function if exists private.rx_item_guard();
drop function if exists private.rx_guard();
drop function if exists private.rx_doc_guard();
drop function if exists private.rx_conferir(jsonb);
drop table if exists catalogo.med_regras;
drop function if exists private.rx_regra_guard();
