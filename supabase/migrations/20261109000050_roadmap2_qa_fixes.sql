-- DG Brasil — 050: Roadmap 2.0, correções da validação (docs/qa/roadmap-2.0)
--
--   1. E-14 — divisão do parceiro vale pela CRIAÇÃO do caso (decisão de
--      2026-11-09). Antes, o snapshot da parceria lia a divisão vigente no
--      ACEITE: um caso criado a 50/50 e aceito depois de a divisão mudar para
--      60/40 ficava 60/40. Agora o caso guarda a divisão do parceiro de origem
--      quando nasce (ou quando a origem muda) e o aceite usa essa divisão.
--      Acordos de parceria já existentes não mudam.
--   2. R2-12 — índices nas chaves estrangeiras novas das migrations 046–048.
--
-- 001–049 não são alteradas. Nada é apagado.

-- ───────────────────────────── 1. divisão guardada no caso ───────────────

alter table public.legal_cases
  add column partner_split_organization_id uuid references public.organizations (id) on delete restrict,
  add column partner_split_partner_percentage public.percentage,
  add column partner_split_owner_percentage public.percentage,
  add column partner_split_captured_at timestamptz,
  add constraint legal_cases_partner_split_complete check (
    (partner_split_organization_id is null) = (partner_split_partner_percentage is null)
    and (partner_split_partner_percentage is null) = (partner_split_owner_percentage is null)
    and (partner_split_partner_percentage is null or partner_split_partner_percentage + partner_split_owner_percentage = 100));

comment on column public.legal_cases.partner_split_partner_percentage is
  'Divisão do parceiro de origem vigente quando o caso nasceu (ou quando a origem mudou). O snapshot do aceite usa esta divisão.';

-- Guarda a divisão vigente do parceiro de origem ao criar o caso e quando a
-- origem muda. Origem = escritório principal, ou parceria inativa: nada.
create or replace function private.legal_cases_capture_partner_split()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if tg_op = 'UPDATE' and new.origin_organization_id is not distinct from old.origin_organization_id then
    return new;
  end if;
  select s.default_partner_percentage, s.default_owner_percentage
    into v
  from public.organizations o
  join public.partner_office_settings s on s.organization_id = o.id
  where o.id = new.origin_organization_id and o.type = 'PARTNER' and s.partnership_active;
  if found then
    new.partner_split_organization_id    := new.origin_organization_id;
    new.partner_split_partner_percentage := v.default_partner_percentage;
    new.partner_split_owner_percentage   := v.default_owner_percentage;
    new.partner_split_captured_at        := now();
  else
    new.partner_split_organization_id    := null;
    new.partner_split_partner_percentage := null;
    new.partner_split_owner_percentage   := null;
    new.partner_split_captured_at        := null;
  end if;
  return new;
end
$$;

create trigger legal_cases_capture_partner_split
  before insert or update of origin_organization_id on public.legal_cases
  for each row execute function private.legal_cases_capture_partner_split();

-- Casos ainda não aceitos de parceiro: guardam a divisão vigente hoje (a de
-- quando nasceram não foi registrada; é a melhor aproximação e evita que uma
-- mudança futura os atinja). Casos aceitos já têm o acordo e não mudam.
update public.legal_cases c
   set partner_split_organization_id    = c.origin_organization_id,
       partner_split_partner_percentage = s.default_partner_percentage,
       partner_split_owner_percentage   = s.default_owner_percentage,
       partner_split_captured_at        = now()
  from public.organizations o
  join public.partner_office_settings s on s.organization_id = o.id
 where o.id = c.origin_organization_id and o.type = 'PARTNER' and s.partnership_active
   and c.accepted_at is null and c.partner_split_organization_id is null;

-- Snapshot da parceria (011/020): igual, mas no aceite usa a divisão guardada
-- no caso quando ela é do mesmo parceiro de origem.
create or replace function private.legal_cases_partnership_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := coalesce(auth.uid(), nullif(current_setting('dg.actor_user_id', true), '')::uuid);
  v_is_accept   boolean;
  v_origin_type public.organization_type;
  v_settings    record;
  v_active      record;
  v_partner_pct numeric;
  v_owner_pct   numeric;
begin
  if new.accepted_at is null then
    return null;
  end if;

  v_is_accept := tg_op = 'INSERT' or old.accepted_at is null;
  if not v_is_accept and new.origin_organization_id is not distinct from old.origin_organization_id then
    return null;
  end if;

  select a.id, a.partner_organization_id into v_active
  from public.case_partnership_agreements a
  where a.legal_case_id = new.id and a.cancelled_at is null
  for update;

  if v_active.id is not null then
    if v_active.partner_organization_id = new.origin_organization_id then
      return null;  -- mesma origem: o snapshot vigente continua
    end if;
    update public.case_partnership_agreements
       set cancelled_at = now(),
           cancelled_by = v_actor,
           cancellation_reason = coalesce(nullif(current_setting('dg.case_origin_change_reason', true), ''),
                                          'Troca de origem do caso')
     where id = v_active.id;
  end if;

  select o.type into v_origin_type
  from public.organizations o where o.id = new.origin_organization_id;

  if v_origin_type <> 'PARTNER' then
    return null;  -- origem é o escritório proprietário: não nasce divisão
  end if;

  select s.default_partner_percentage, s.default_owner_percentage, s.partnership_active
    into v_settings
  from public.partner_office_settings s
  where s.organization_id = new.origin_organization_id;

  if not found then
    raise exception 'Parceiro de origem sem configuração de parceria (partner_office_settings)'
      using errcode = '23514';
  end if;

  -- Roadmap 2.0 (E-14): a divisão é a do momento em que o caso nasceu (ou em
  -- que a origem mudou), guardada no próprio caso; sem ela, a vigente.
  if new.partner_split_organization_id is not distinct from new.origin_organization_id
     and new.partner_split_partner_percentage is not null then
    v_partner_pct := new.partner_split_partner_percentage;
    v_owner_pct   := new.partner_split_owner_percentage;
  elsif v_settings.partnership_active then
    v_partner_pct := v_settings.default_partner_percentage;
    v_owner_pct   := v_settings.default_owner_percentage;
  end if;

  if v_partner_pct is not null then
    insert into public.case_partnership_agreements
      (legal_case_id, partner_organization_id, partner_percentage, owner_percentage, effective_at, created_by)
    values
      (new.id, new.origin_organization_id, v_partner_pct, v_owner_pct,
       case when v_is_accept then new.accepted_at else now() end, v_actor);
  end if;

  return null;
end
$$;

revoke all on function private.legal_cases_capture_partner_split() from public, anon, authenticated;

-- ───────────────────────────── 2. índices (R2-12) ────────────────────────

create index if not exists process_expenses_created_by_idx       on public.process_expenses (created_by);
create index if not exists process_expenses_cancelled_by_idx     on public.process_expenses (cancelled_by);
create index if not exists process_expenses_case_idx             on public.process_expenses (legal_case_id);
create index if not exists process_tasks_agent_idx               on public.process_tasks (agent_id);
create index if not exists process_tasks_created_by_idx          on public.process_tasks (created_by);
create index if not exists process_tasks_completed_by_idx        on public.process_tasks (completed_by);
create index if not exists process_tasks_case_idx                on public.process_tasks (legal_case_id);
create index if not exists process_task_settings_orchestrator_idx on public.process_task_settings (orchestrator_agent_id);
create index if not exists process_task_settings_updated_by_idx  on public.process_task_settings (updated_by);
create index if not exists legal_cases_partner_split_org_idx     on public.legal_cases (partner_split_organization_id);

-- ───────────────────────────── 3. convite de parceiro (R2-06/R2-16) ──────
-- A 048 criava um escritório novo a cada tentativa, com o nome tirado do
-- e-mail; um convite que não saía deixava escritórios "Convite: …" inativos.
-- Agora o escritório leva o NOME DO CONTATO e o e-mail, e uma nova tentativa
-- para o mesmo e-mail reaproveita o escritório que ainda não completou o
-- cadastro (pendente ou desativado pela falha anterior).
drop function public.create_partner_invite_office(text, numeric);

create function public.create_partner_invite_office(p_contact text, p_email text, p_partner_percentage numeric default 50)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_pct   numeric := coalesce(p_partner_percentage, 50);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name  text := left('Convite: ' || btrim(coalesce(p_contact, '')), 200);
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente ADMIN interno convida parceiro' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_contact, '')), '') is null then
    raise exception 'Informe o nome do contato do parceiro' using errcode = '22023';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Informe um e-mail válido' using errcode = '22023';
  end if;
  if v_pct < 0 or v_pct > 100 then
    raise exception 'Percentual do parceiro entre 0 e 100' using errcode = '22023';
  end if;

  select o.id into v_id
  from public.organizations o
  join public.partner_office_settings s on s.organization_id = o.id
  where o.type = 'PARTNER' and o.email = v_email and o.status in ('PENDING', 'INACTIVE')
    and s.profile_completed_at is null and o.deleted_at is null
  order by o.created_at desc
  limit 1;

  if v_id is not null then
    update public.organizations set status = 'PENDING', name = v_name where id = v_id;
    update public.partner_office_settings
       set default_partner_percentage = v_pct, default_owner_percentage = 100 - v_pct
     where organization_id = v_id;
    return v_id;
  end if;

  v_id := private.create_partner_office(
    jsonb_build_object('name', v_name, 'email', v_email),
    jsonb_build_object('default_partner_percentage', v_pct, 'default_owner_percentage', 100 - v_pct));
  update public.partner_office_settings set profile_completed_at = null where organization_id = v_id;
  return v_id;
end
$$;

revoke all on function public.create_partner_invite_office(text, text, numeric) from public, anon;
grant execute on function public.create_partner_invite_office(text, text, numeric) to authenticated;
