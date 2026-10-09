-- DG Brasil — 021: fecha public.rls_auto_enable() para a API
--
-- Achado pelo Security Advisor na validação real (Etapa 3.3, lints 0028/0029):
-- a função public.rls_auto_enable() é SECURITY DEFINER e executável por anon e
-- authenticated via /rest/v1/rpc. Ela NÃO é deste repositório: o Supabase a cria
-- quando o projeto nasce com "habilitar RLS automaticamente em tabelas novas"
-- (função do event trigger desse recurso).
--
-- Não a removemos — é do recurso da plataforma, e as tabelas do DG Brasil já
-- ligam RLS explicitamente (016). Só retiramos EXECUTE dos papéis da API. A
-- checagem de existência mantém a migration válida em projetos (e no PGlite)
-- onde o recurso não foi ligado.

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end
$$;
