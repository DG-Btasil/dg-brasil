-- DG Brasil — 015: helpers de autorização (schema private)
--
-- Todos SECURITY DEFINER com search_path vazio: leem as tabelas sem passar
-- pela RLS (evita políticas recursivas) e não podem ser sequestrados por
-- objeto de mesmo nome em outro schema. EXECUTE só para authenticated e
-- service_role; anon não chama nenhum.
--
-- Identidade = auth.uid() + vínculo ATIVO em organização ATIVA, com perfil
-- ativo. Parceiro suspenso/inativo, ou usuário inativado, perde o acesso
-- inteiro sem que nenhuma política precise saber disso.
--
-- Nas políticas, chame como (select private.fn()) para o Postgres avaliar uma
-- vez por consulta, não uma vez por linha.

create or replace function private.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select auth.uid()
$$;

create or replace function private.current_membership()
returns table (
  membership_id     uuid,
  organization_id   uuid,
  organization_type public.organization_type,
  role              public.membership_role
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.organization_id, o.type, m.role
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid()
    and m.status = 'ACTIVE'
    and o.status = 'ACTIVE'
    and o.deleted_at is null
    and p.active
  limit 1
$$;

create or replace function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from private.current_membership()
$$;

-- (Nome diferente de current_role, que é palavra reservada do SQL.)
create or replace function private.current_user_role()
returns public.membership_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from private.current_membership()
$$;

create or replace function private.owner_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.organizations where type = 'OWNER' and deleted_at is null
$$;

create or replace function private.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select organization_type = 'OWNER' from private.current_membership()), false)
$$;

create or replace function private.has_internal_role(variadic p_roles public.membership_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select organization_type = 'OWNER' and role = any (p_roles) from private.current_membership()),
    false)
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_internal_role('ADMIN')
$$;

create or replace function private.is_partner_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select organization_type = 'PARTNER' from private.current_membership()), false)
$$;

create or replace function private.is_partner_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select organization_type = 'PARTNER' and role = 'PARTNER_ADMIN' from private.current_membership()),
    false)
$$;

-- Organização do parceiro logado; null para usuário interno ou sem sessão.
create or replace function private.current_partner_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from private.current_membership() where organization_type = 'PARTNER'
$$;

-- ───────────────────────────── acesso a registros ─────────────────────────

-- Interno: todos os clientes. Parceiro: só com relacionamento ATIVO do próprio
-- escritório, e nunca cliente excluído.
create or replace function private.can_access_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_internal_user() then
      exists (select 1 from public.clients c where c.id = p_client_id)
    when private.is_partner_user() then
      exists (
        select 1
        from public.clients c
        join public.client_organization_relationships r on r.client_id = c.id
        where c.id = p_client_id
          and c.deleted_at is null
          and r.organization_id = private.current_partner_organization_id()
          and r.status = 'ACTIVE'
      )
    else false
  end
$$;

-- Parceiro: partner_organization_id = escritório do usuário. A ORIGEM do caso
-- (atribuição comercial) não entra na autorização.
create or replace function private.can_access_case(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_internal_user() then
      exists (select 1 from public.legal_cases c where c.id = p_case_id)
    when private.is_partner_user() then
      exists (
        select 1 from public.legal_cases c
        where c.id = p_case_id
          and c.deleted_at is null
          and c.partner_organization_id = private.current_partner_organization_id()
      )
    else false
  end
$$;

-- Processo herda o acesso do caso.
create or replace function private.can_access_process(p_process_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_internal_user() then
      exists (select 1 from public.legal_processes p where p.id = p_process_id)
    when private.is_partner_user() then
      exists (
        select 1
        from public.legal_processes p
        join public.legal_cases c on c.id = p.legal_case_id
        where p.id = p_process_id
          and p.deleted_at is null
          and c.deleted_at is null
          and c.partner_organization_id = private.current_partner_organization_id()
      )
    else false
  end
$$;

-- Parceiro vê documento se: PARTNER_VISIBLE, não excluído, cliente acessível e
-- ligado a caso ou processo acessível. INTERNAL nunca.
create or replace function private.can_access_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_internal_user() then
      exists (select 1 from public.documents d where d.id = p_document_id)
    when private.is_partner_user() then
      exists (
        select 1
        from public.documents d
        where d.id = p_document_id
          and d.visibility = 'PARTNER_VISIBLE'
          and d.deleted_at is null
          and private.can_access_client(d.client_id)
          and (
            exists (select 1 from public.case_documents cd
                    where cd.document_id = d.id and private.can_access_case(cd.legal_case_id))
            or
            exists (select 1 from public.process_documents pd
                    where pd.document_id = d.id and private.can_access_process(pd.legal_process_id))
          )
      )
    else false
  end
$$;

-- Parceiro pode vincular um documento a um caso/processo do próprio escritório
-- se o documento é visível ao parceiro, do mesmo cliente, e foi enviado por
-- ele ou já é acessível. Impede "adivinhar" UUID de documento de outro parceiro.
create or replace function private.partner_can_link_document(p_document_id uuid, p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_partner_user()
     and private.can_access_case(p_case_id)
     and exists (
       select 1
       from public.documents d
       join public.legal_cases c on c.id = p_case_id and c.client_id = d.client_id
       where d.id = p_document_id
         and d.visibility = 'PARTNER_VISIBLE'
         and d.deleted_at is null
         and (d.created_by = auth.uid() or private.can_access_document(d.id))
     )
$$;

create or replace function private.partner_can_link_process_document(p_document_id uuid, p_process_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_process(p_process_id)
     and private.partner_can_link_document(
           p_document_id,
           (select p.legal_case_id from public.legal_processes p where p.id = p_process_id))
$$;

-- Financeiro da parceria: só PARTNER_ADMIN do próprio parceiro.
create or replace function private.partner_admin_owns_agreement(p_agreement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_partner_admin()
     and exists (
       select 1 from public.case_partnership_agreements a
       where a.id = p_agreement_id
         and a.partner_organization_id = private.current_partner_organization_id()
     )
$$;

create or replace function private.partner_admin_owns_allocation(p_allocation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.partner_revenue_allocations al
    where al.id = p_allocation_id
      and private.partner_admin_owns_agreement(al.case_partnership_agreement_id)
  )
$$;

create or replace function private.partner_admin_owns_transfer(p_transfer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_partner_admin()
     and exists (
       select 1 from public.partner_transfers t
       where t.id = p_transfer_id
         and t.partner_organization_id = private.current_partner_organization_id()
     )
$$;

-- Perfis que o parceiro enxerga: só os do próprio escritório.
create or replace function private.shares_partner_organization(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_partner_user()
     and exists (
       select 1 from public.organization_memberships m
       where m.user_id = p_user_id
         and m.organization_id = private.current_partner_organization_id()
     )
$$;

create or replace function private.can_access_partner_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_internal_user() then true
    when private.is_partner_user() then exists (
      select 1 from public.partner_requests r
      where r.id = p_request_id
        and r.partner_organization_id = private.current_partner_organization_id()
    )
    else false
  end
$$;

-- ───────────────────────────── grants ─────────────────────────────────────

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'current_user_id', 'current_membership', 'current_organization_id', 'current_user_role',
        'owner_organization_id', 'is_internal_user', 'has_internal_role', 'is_admin',
        'is_partner_user', 'is_partner_admin', 'current_partner_organization_id',
        'can_access_client', 'can_access_case', 'can_access_process', 'can_access_document',
        'partner_can_link_document', 'partner_can_link_process_document',
        'partner_admin_owns_agreement', 'partner_admin_owns_allocation', 'partner_admin_owns_transfer',
        'shares_partner_organization', 'can_access_partner_request')
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
