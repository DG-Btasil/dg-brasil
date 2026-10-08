-- DG Brasil — 019: seed de produção (mínimo e idempotente)
--
-- Só o que precisa existir em qualquer ambiente. Nada fictício aqui.
-- Usuários NÃO são criados por migration (nenhuma senha em código): veja
-- private.bootstrap_owner_admin abaixo.

insert into public.organizations (type, name, legal_name, status)
select 'OWNER', 'Bárbara Cardoso Advocacia', 'Bárbara Cardoso Advocacia', 'ACTIVE'
where not exists (
  select 1 from public.organizations where type = 'OWNER' and deleted_at is null
);

insert into public.owner_office_settings (organization_id, principal_lawyer_name)
select o.id, 'Bárbara Cardoso'
from public.organizations o
where o.type = 'OWNER' and o.deleted_at is null
on conflict (organization_id) do nothing;

-- Vocabulário canônico de categoria de documento: o MESMO do front-end
-- (DocumentCategory). Não há segundo nome para o mesmo conceito.
insert into public.document_categories (code, label, sort_order)
values
  ('IDENTIFICATION',       'Documento de identificação',     10),
  ('ADDRESS_PROOF',        'Comprovante de residência',      20),
  ('INCOME_PROOF',         'Comprovante de renda',           30),
  ('BANK_STATEMENT',       'Extrato bancário',               40),
  ('LOAN_CONTRACT',        'Contrato bancário',              50),
  ('BENEFIT_STATEMENT',    'Extrato de benefício',           60),
  ('POWER_OF_ATTORNEY',    'Procuração',                     70),
  ('HARDSHIP_DECLARATION', 'Declaração de hipossuficiência', 80),
  ('CORPORATE_DOCUMENTS',  'Documentos societários',         90),
  ('PETITION',             'Peça processual',               100),
  ('COURT_DECISION',       'Decisão judicial',              110),
  ('OTHER',                'Outro',                         999)
on conflict (code) do nothing;

-- Áreas do front-end (LegalArea). Novas áreas são linhas, não código.
insert into public.legal_areas (code, name, description)
values
  ('BANKING',         'Direito Bancário',       'Contratos bancários, consignados, revisionais e fraudes.'),
  ('CONSUMER',        'Direito do Consumidor',  null),
  ('SOCIAL_SECURITY', 'Direito Previdenciário', null),
  ('CIVIL',           'Direito Civil',          null),
  ('LABOR',           'Direito do Trabalho',    null),
  ('TAX',             'Direito Tributário',     null),
  ('CORPORATE',       'Direito Empresarial',    null),
  ('FAMILY',          'Direito de Família',     null)
on conflict (code) do nothing;

insert into public.analysis_templates (legal_area_id, name, description)
select a.id, 'Análise Bancária', 'Checklist inicial para análise de casos bancários.'
from public.legal_areas a
where a.code = 'BANKING'
on conflict (legal_area_id, name) do nothing;

insert into public.analysis_template_requirements
  (analysis_template_id, document_category, label, required, sort_order)
select t.id, r.category, r.label, r.required, r.sort_order
from public.analysis_templates t
join public.legal_areas a on a.id = t.legal_area_id and a.code = 'BANKING'
cross join (values
  ('IDENTIFICATION',    'Documento de identidade com CPF', true,  10),
  ('ADDRESS_PROOF',     'Comprovante de residência',       true,  20),
  ('BENEFIT_STATEMENT', 'Extrato de empréstimos (HISCON)', true,  30),
  ('BANK_STATEMENT',    'Extrato bancário do período',     false, 40)
) as r(category, label, required, sort_order)
where t.name = 'Análise Bancária'
on conflict (analysis_template_id, document_category, label) do nothing;

-- ───────────────────────────── bootstrap da primeira admin ────────────────
-- 1. Crie a usuária no Supabase Auth (Dashboard → Authentication → Add user).
-- 2. No SQL Editor, como postgres:
--      select private.bootstrap_owner_admin('<uuid do auth.users>');
-- Só funciona enquanto não existir nenhum ADMIN ativo: depois disso, papéis são
-- geridos pelo backend.

create or replace function private.bootstrap_owner_admin(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_id    uuid;
begin
  if exists (
    select 1 from public.organization_memberships
    where role = 'ADMIN' and status = 'ACTIVE'
  ) then
    raise exception 'Já existe ADMIN ativo: use o fluxo normal de convite' using errcode = '42501';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Usuário % não existe no Supabase Auth', p_user_id using errcode = '23503';
  end if;

  select id into v_owner from public.organizations where type = 'OWNER' and deleted_at is null;

  insert into public.profiles (id, full_name)
  select u.id, coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1))
  from auth.users u where u.id = p_user_id
  on conflict (id) do nothing;

  insert into public.organization_memberships (organization_id, user_id, role, status, joined_at)
  values (v_owner, p_user_id, 'ADMIN', 'ACTIVE', now())
  returning id into v_id;

  return v_id;
end
$$;

revoke all on function private.bootstrap_owner_admin(uuid) from public, anon, authenticated, service_role;
