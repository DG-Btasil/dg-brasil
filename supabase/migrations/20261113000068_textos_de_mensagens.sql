-- 068 · Dois textos de mensagens do banco: nome do escritório sem acento e o
--       caminho certo da tela de Integrações.
--
-- Achados da revisão final:
--
--   a) private.partner_submit_case (definição vigente: 045) recusa o CPF/CNPJ
--      de um cliente excluído com "Fale com o escritório Bárbara Cardoso.". A
--      grafia confirmada pela dona do escritório é sem acento: "Barbara
--      Cardoso". É a mensagem que o PARCEIRO lê.
--   b) private.judicial_sync_finish (definição vigente: 057; a 062 não a
--      redefiniu) avisa a falha da busca judicial com "Veja os detalhes em
--      Configurações → Integrações.". A tela mudou de lugar no Roadmap 2.0:
--      hoje é "DG Brasil → Integrações".
--
-- Como corrige: SEM redigitar as funções. Para cada uma, lê a definição que
-- está no banco (pg_get_functiondef), troca só o texto e executa. Assim nada
-- mais muda, mesmo que a função tenha sido redefinida depois da migration que
-- esta revisão leu. `create or replace` mantém dono, permissões (grants) e
-- comentário; o cabeçalho que o pg_get_functiondef devolve traz de volta
-- `security definer` e `set search_path = ''`.
--
-- Conferências (a migration FALHA, com frase clara, em vez de passar calada):
--   - a função não existe;
--   - o texto antigo não está na definição (e o novo também não): alguém
--     mudou a função e esta correção precisa ser revista;
--   - depois da troca, o corpo não é exatamente o de antes com o texto
--     trocado, ou mudou dono, permissões, search_path, security definer,
--     volatilidade ou tipo de retorno.
--
-- Pode rodar de novo sem efeito: função que já tem o texto novo é pulada.
--
-- O que NÃO muda aqui: o nome do escritório gravado pelo seed (019) corrige-se
-- pela tela; os termos de uso ficam como estão.
-- Não foi achada outra mensagem de função com "Bárbara" nem com o caminho
-- antigo da tela.

do $$
declare
  r        record;
  v_oid    oid;
  v_def    text;
  v_before record;
  v_after  record;
begin
  for r in
    select * from (values
      ('private.partner_submit_case(jsonb, jsonb)',
       'Fale com o escritório Bárbara Cardoso.',
       'Fale com o escritório Barbara Cardoso.'),
      ('private.judicial_sync_finish(uuid, text, jsonb, text)',
       'Veja os detalhes em Configurações → Integrações.',
       'Veja os detalhes em DG Brasil → Integrações.')
    ) as t(fn, old_text, new_text)
  loop
    v_oid := to_regprocedure(r.fn);
    if v_oid is null then
      raise exception '068: a função % não existe; a correção do texto precisa ser revista', r.fn;
    end if;

    select p.prosrc, p.proowner, p.proacl::text as acl, p.proconfig::text as config,
           p.prosecdef, p.provolatile, p.prorettype
      into v_before
      from pg_catalog.pg_proc p where p.oid = v_oid;

    if position(r.old_text in v_before.prosrc) = 0 then
      if position(r.new_text in v_before.prosrc) > 0 then
        raise notice '068: % já está com o texto novo; nada a fazer', r.fn;
        continue;
      end if;
      raise exception '068: o texto "%" não foi encontrado em %; a função mudou e esta correção precisa ser revista',
        r.old_text, r.fn;
    end if;

    v_def := pg_catalog.pg_get_functiondef(v_oid);
    execute replace(v_def, r.old_text, r.new_text);

    select p.prosrc, p.proowner, p.proacl::text as acl, p.proconfig::text as config,
           p.prosecdef, p.provolatile, p.prorettype
      into v_after
      from pg_catalog.pg_proc p where p.oid = to_regprocedure(r.fn);

    if v_after.prosrc is distinct from replace(v_before.prosrc, r.old_text, r.new_text)
       or position(r.old_text in v_after.prosrc) > 0 then
      raise exception '068: a troca do texto em % não ficou como esperado', r.fn;
    end if;
    if (v_after.proowner, v_after.acl, v_after.config, v_after.prosecdef, v_after.provolatile, v_after.prorettype)
       is distinct from
       (v_before.proowner, v_before.acl, v_before.config, v_before.prosecdef, v_before.provolatile, v_before.prorettype) then
      raise exception '068: dono, permissões ou configuração de % mudaram com a troca do texto', r.fn;
    end if;
  end loop;
end
$$;
