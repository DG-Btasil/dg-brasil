-- 032 — Desempenho da RLS nos caminhos quentes do portal (QA 4.3, BUG-06).
--
-- Problema: as políticas de leitura de clientes (e dados PF/PJ, contatos,
-- endereços, representantes, sócios), processos, partes, movimentações,
-- pendências e documentos chamavam private.can_access_*(id) LINHA A LINHA.
-- Cada chamada é security definer (não é "inlined") e refaz a consulta do
-- vínculo (current_membership). Para o parceiro, o custo cresce com o banco
-- inteiro, não com a carteira dele: no DEV (~600 clientes), a lista de
-- clientes do portal levou de 6,5 a 14 s e estourou o statement timeout
-- (57014). Para a equipe interna, as tabelas de detalhes PF/PJ também pagavam
-- a chamada por linha.
--
-- Correção: o mesmo critério de acesso, calculado UMA vez por consulta.
-- Funções set-returning (security definer, sem parâmetro → o escopo vem só da
-- sessão) devolvem os ids acessíveis ao parceiro; as políticas usam
-- `coluna in (select private.partner_*_ids())` — subplano não correlacionado,
-- executado uma vez e consultado por hash. Internos continuam pelo initplan
-- `(select private.is_internal_user())`.
--
-- Semântica idêntica às funções can_access_* (verificada no PGlite, seção
-- [032]): nada de acesso é ampliado. Escritas não mudam (continuam pelas
-- funções originais: poucas linhas por operação).

-- ───────────────────────────── conjuntos do parceiro ──────────────────────

-- Clientes com relacionamento ATIVO com o escritório do parceiro, não excluídos
-- (= ramo parceiro de private.can_access_client).
create or replace function private.partner_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.client_id
  from public.client_organization_relationships r
  join public.clients c on c.id = r.client_id
  where r.organization_id = private.current_partner_organization_id()
    and r.status = 'ACTIVE'
    and c.deleted_at is null
$$;

-- Casos operados pelo escritório do parceiro, não excluídos
-- (= ramo parceiro de private.can_access_case).
create or replace function private.partner_case_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.legal_cases c
  where c.partner_organization_id = private.current_partner_organization_id()
    and c.deleted_at is null
$$;

-- Processos (não excluídos) de casos do parceiro
-- (= ramo parceiro de private.can_access_process).
create or replace function private.partner_process_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.legal_processes p
  join public.legal_cases c on c.id = p.legal_case_id
  where c.partner_organization_id = private.current_partner_organization_id()
    and c.deleted_at is null
    and p.deleted_at is null
$$;

-- Documentos PARTNER_VISIBLE, não excluídos, de cliente acessível e ligados a
-- caso ou processo acessível (= ramo parceiro de private.can_access_document).
create or replace function private.partner_document_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with org as (select private.current_partner_organization_id() as id),
  cases as (
    select c.id from public.legal_cases c, org
    where c.partner_organization_id = org.id and c.deleted_at is null
  ),
  processes as (
    select p.id from public.legal_processes p
    join cases c on c.id = p.legal_case_id
    where p.deleted_at is null
  ),
  clients as (
    select r.client_id from public.client_organization_relationships r
    join public.clients cl on cl.id = r.client_id, org
    where r.organization_id = org.id and r.status = 'ACTIVE' and cl.deleted_at is null
  )
  select d.id
  from public.documents d
  where d.visibility = 'PARTNER_VISIBLE'
    and d.deleted_at is null
    and d.client_id in (select client_id from clients)
    and (
      exists (select 1 from public.case_documents cd where cd.document_id = d.id and cd.legal_case_id in (select id from cases))
      or exists (select 1 from public.process_documents pd where pd.document_id = d.id and pd.legal_process_id in (select id from processes))
    )
$$;

revoke all on function private.partner_client_ids() from public;
revoke all on function private.partner_case_ids() from public;
revoke all on function private.partner_process_ids() from public;
revoke all on function private.partner_document_ids() from public;
grant execute on function private.partner_client_ids() to authenticated;
grant execute on function private.partner_case_ids() to authenticated;
grant execute on function private.partner_process_ids() to authenticated;
grant execute on function private.partner_document_ids() to authenticated;

-- ───────────────────────────── clientes ───────────────────────────────────

drop policy clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (
    (select private.is_internal_user())
    or ((select private.is_partner_user()) and deleted_at is null and id in (select private.partner_client_ids()))
  );

-- Tabelas filhas do cliente: interno lê tudo; parceiro, só de cliente acessível.
do $$
declare
  t text;
begin
  foreach t in array array['individual_client_details', 'company_client_details', 'company_representatives',
                           'company_shareholders', 'client_contacts', 'client_addresses'] loop
    execute format('drop policy %I on public.%I', t || '_select', t);
    execute format($p$
      create policy %1$I on public.%2$I for select to authenticated
        using ((select private.is_internal_user()) or client_id in (select private.partner_client_ids()))$p$,
      t || '_select', t);
  end loop;
end
$$;

-- ───────────────────────────── processos e filhos ─────────────────────────

drop policy legal_processes_select on public.legal_processes;
create policy legal_processes_select on public.legal_processes for select to authenticated
  using (
    (select private.is_internal_user())
    or ((select private.is_partner_user()) and deleted_at is null and legal_case_id in (select private.partner_case_ids()))
  );

drop policy process_parties_select on public.process_parties;
create policy process_parties_select on public.process_parties for select to authenticated
  using ((select private.is_internal_user()) or legal_process_id in (select private.partner_process_ids()));

drop policy process_events_select on public.process_events;
create policy process_events_select on public.process_events for select to authenticated
  using (
    (select private.is_internal_user())
    or (source in ('JUDICIAL_INTEGRATION', 'IMPORT', 'SYSTEM') and legal_process_id in (select private.partner_process_ids()))
  );

drop policy case_document_requirements_select on public.case_document_requirements;
create policy case_document_requirements_select on public.case_document_requirements for select to authenticated
  using ((select private.is_internal_user()) or legal_case_id in (select private.partner_case_ids()));

-- ───────────────────────────── documentos ─────────────────────────────────

drop policy documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (
    (select private.is_internal_user())
    or ((select private.is_partner_user()) and visibility = 'PARTNER_VISIBLE' and id in (select private.partner_document_ids()))
  );

drop policy document_versions_select on public.document_versions;
create policy document_versions_select on public.document_versions for select to authenticated
  using ((select private.is_internal_user()) or document_id in (select private.partner_document_ids()));

drop policy case_documents_select on public.case_documents;
create policy case_documents_select on public.case_documents for select to authenticated
  using (
    (select private.is_internal_user())
    or (legal_case_id in (select private.partner_case_ids()) and document_id in (select private.partner_document_ids()))
  );

drop policy process_documents_select on public.process_documents;
create policy process_documents_select on public.process_documents for select to authenticated
  using (
    (select private.is_internal_user())
    or (legal_process_id in (select private.partner_process_ids()) and document_id in (select private.partner_document_ids()))
  );
