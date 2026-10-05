-- DG Brasil — 011: financeiro
--
-- Conceitos separados, nunca no mesmo campo:
--   legal_processes.case_value      valor da causa (jurídico, nunca dividido)
--   financial_agreements            honorários contratados do caso
--   payments                        recebimentos (receita realizada)
--   partner_revenue_allocations     quanto de cada recebimento é do parceiro
--   partner_transfers               repasses efetivamente feitos ao parceiro
--
-- O financeiro pertence ao CASO, não ao cliente nem ao processo.

create table public.fee_models (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (btrim(name) <> ''),
  description            text,
  upfront_fee            public.money_amount,
  fixed_fee              public.money_amount,
  monthly_fee            public.money_amount,
  success_fee_percentage public.percentage,
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

create unique index fee_models_name_key on public.fee_models (name) where deleted_at is null;

create trigger fee_models_set_updated_at
  before update on public.fee_models
  for each row execute function private.set_updated_at();

-- ───────────────────────────── acordo financeiro do caso ──────────────────

create table public.financial_agreements (
  id                     uuid primary key default gen_random_uuid(),
  legal_case_id          uuid not null references public.legal_cases (id) on delete restrict,
  fee_model_id           uuid references public.fee_models (id) on delete restrict,
  upfront_fee            public.money_amount,
  fixed_fee              public.money_amount,
  monthly_fee            public.money_amount,
  success_fee_percentage public.percentage,
  currency               public.currency_code not null default 'BRL',
  status                 text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  notes                  text,
  created_by             uuid references public.profiles (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Um acordo principal ATIVO por caso.
create unique index financial_agreements_one_active_per_case
  on public.financial_agreements (legal_case_id) where status = 'ACTIVE';
create index financial_agreements_case_idx on public.financial_agreements (legal_case_id);

create trigger financial_agreements_set_updated_at
  before update on public.financial_agreements
  for each row execute function private.set_updated_at();

-- ───────────────────────────── acordo de parceria (snapshot) ──────────────
-- Criado no ACEITE de caso cuja ORIGEM é um parceiro. Copia a divisão vigente
-- do parceiro naquele momento. Mudar o padrão do parceiro depois não altera
-- esta linha.

create table public.case_partnership_agreements (
  id                      uuid primary key default gen_random_uuid(),
  legal_case_id           uuid not null unique references public.legal_cases (id) on delete restrict,
  partner_organization_id uuid not null references public.organizations (id) on delete restrict,
  partner_percentage      public.percentage not null,
  owner_percentage        public.percentage not null,
  effective_at            timestamptz not null default now(),
  created_by              uuid references public.profiles (id) on delete restrict,
  created_at              timestamptz not null default now(),
  constraint case_partnership_agreements_split_is_100
    check (partner_percentage + owner_percentage = 100)
);

create index case_partnership_agreements_partner_idx
  on public.case_partnership_agreements (partner_organization_id);

-- O acordo é do parceiro de ORIGEM de um caso aceito. Percentuais só mudam por
-- ADMIN (ou backend), e a mudança é auditada (014).
create or replace function private.case_partnership_agreements_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.legal_cases c
    join public.organizations o on o.id = c.origin_organization_id
    where c.id = new.legal_case_id
      and c.accepted_at is not null
      and o.type = 'PARTNER'
      and c.origin_organization_id = new.partner_organization_id
  ) then
    raise exception 'Acordo de parceria só existe para caso aceito cuja origem é este parceiro'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.legal_case_id is distinct from old.legal_case_id then
      raise exception 'O caso de um acordo de parceria não muda' using errcode = '23514';
    end if;
    if auth.uid() is not null and not private.is_admin() then
      raise exception 'Somente ADMIN interno altera acordo de parceria' using errcode = '42501';
    end if;
  else
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;

  return new;
end
$$;

create trigger case_partnership_agreements_guard
  before insert or update on public.case_partnership_agreements
  for each row execute function private.case_partnership_agreements_guard();

-- Snapshot no aceite. Também cobre a troca de origem depois do aceite (só ADMIN,
-- validado em legal_cases_guard).
create or replace function private.legal_cases_partnership_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin_type public.organization_type;
  v_settings    record;
  v_existing    record;
begin
  if new.accepted_at is null then
    return null;
  end if;

  -- Só age no aceite ou na troca de origem de caso já aceito.
  if tg_op = 'UPDATE'
     and old.accepted_at is not null
     and new.origin_organization_id is not distinct from old.origin_organization_id then
    return null;
  end if;

  select a.id, a.partner_organization_id into v_existing
  from public.case_partnership_agreements a where a.legal_case_id = new.id;

  select o.type into v_origin_type
  from public.organizations o where o.id = new.origin_organization_id;

  if v_existing.id is not null then
    if v_origin_type = 'PARTNER' and v_existing.partner_organization_id = new.origin_organization_id then
      return null;
    end if;
    raise exception 'O caso já tem acordo de parceria com outra origem: ajuste o acordo explicitamente antes de trocar a origem'
      using errcode = '23514';
  end if;

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

  if v_settings.partnership_active then
    insert into public.case_partnership_agreements
      (legal_case_id, partner_organization_id, partner_percentage, owner_percentage, effective_at, created_by)
    values
      (new.id, new.origin_organization_id, v_settings.default_partner_percentage,
       v_settings.default_owner_percentage, new.accepted_at, auth.uid());
  end if;

  return null;
end
$$;

create trigger legal_cases_partnership_snapshot
  after insert or update of accepted_at, origin_organization_id on public.legal_cases
  for each row execute function private.legal_cases_partnership_snapshot();

-- ───────────────────────────── pagamentos ─────────────────────────────────

create table public.payments (
  id                     uuid primary key default gen_random_uuid(),
  financial_agreement_id uuid not null references public.financial_agreements (id) on delete restrict,
  amount                 public.money_amount not null check (amount > 0),
  -- Quanto já entrou. PAID ⇔ paid_amount = amount; PARTIAL ⇔ 0 < paid_amount < amount.
  paid_amount            public.money_amount not null default 0,
  currency               public.currency_code not null default 'BRL',
  due_date               date,
  paid_at                timestamptz,
  payment_type           text not null check (payment_type in ('UPFRONT', 'FIXED', 'MONTHLY', 'SUCCESS_FEE', 'OTHER')),
  status                 text not null default 'PENDING' check (status in ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED')),
  description            text,
  created_by             uuid references public.profiles (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint payments_paid_not_above_amount check (paid_amount <= amount),
  constraint payments_status_consistent check (
    case status
      when 'PAID'    then paid_amount = amount and paid_at is not null
      when 'PARTIAL' then paid_amount > 0 and paid_amount < amount
      when 'PENDING' then paid_amount = 0
      else true
    end
  )
);

create index payments_agreement_idx on public.payments (financial_agreement_id);
create index payments_status_due_idx on public.payments (status, due_date);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function private.set_updated_at();

-- ───────────────────────────── divisão da receita ─────────────────────────
-- A divisão incide sobre o que foi RECEBIDO, nunca sobre o valor da causa.

create table public.partner_revenue_allocations (
  id                            uuid primary key default gen_random_uuid(),
  payment_id                    uuid not null unique references public.payments (id) on delete restrict,
  case_partnership_agreement_id uuid not null references public.case_partnership_agreements (id) on delete restrict,
  base_amount                   public.money_amount not null,
  partner_amount                public.money_amount not null,
  owner_amount                  public.money_amount not null,
  created_at                    timestamptz not null default now(),
  constraint partner_revenue_allocations_sum check (partner_amount + owner_amount = base_amount)
);

create index partner_revenue_allocations_agreement_idx
  on public.partner_revenue_allocations (case_partnership_agreement_id);

create or replace function private.partner_revenue_allocations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid numeric(14,2);
begin
  select p.paid_amount into v_paid
  from public.payments p
  join public.financial_agreements f on f.id = p.financial_agreement_id
  join public.case_partnership_agreements a on a.legal_case_id = f.legal_case_id
  where p.id = new.payment_id and a.id = new.case_partnership_agreement_id;

  if not found then
    raise exception 'O pagamento e o acordo de parceria são de casos diferentes' using errcode = '23514';
  end if;
  if new.base_amount > v_paid then
    raise exception 'Base da divisão (%) maior que o valor recebido (%)', new.base_amount, v_paid
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger partner_revenue_allocations_guard
  before insert or update on public.partner_revenue_allocations
  for each row execute function private.partner_revenue_allocations_guard();

-- ───────────────────────────── repasses ───────────────────────────────────

create table public.partner_transfers (
  id                      uuid primary key default gen_random_uuid(),
  partner_organization_id uuid not null references public.organizations (id) on delete restrict,
  amount                  public.money_amount not null check (amount > 0),
  status                  text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'CANCELLED')),
  paid_at                 timestamptz,
  reference               text,
  registered_by           uuid references public.profiles (id) on delete restrict,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint partner_transfers_paid_has_date check (status <> 'PAID' or paid_at is not null)
);

create index partner_transfers_partner_idx on public.partner_transfers (partner_organization_id, created_at);

create trigger partner_transfers_set_updated_at
  before update on public.partner_transfers
  for each row execute function private.set_updated_at();

create table public.partner_transfer_items (
  transfer_id   uuid not null references public.partner_transfers (id) on delete restrict,
  allocation_id uuid not null references public.partner_revenue_allocations (id) on delete restrict,
  amount        public.money_amount not null check (amount > 0),
  created_at    timestamptz not null default now(),
  primary key (transfer_id, allocation_id)
);

create index partner_transfer_items_allocation_idx on public.partner_transfer_items (allocation_id);

-- Item de repasse: mesmo parceiro, sem repassar mais que a parte do parceiro
-- nem mais que o valor do repasse.
create or replace function private.partner_transfer_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alloc    record;
  v_transfer record;
  v_used     numeric(14,2);
begin
  select al.partner_amount, a.partner_organization_id into v_alloc
  from public.partner_revenue_allocations al
  join public.case_partnership_agreements a on a.id = al.case_partnership_agreement_id
  where al.id = new.allocation_id
  for update of al;

  select t.amount, t.partner_organization_id into v_transfer
  from public.partner_transfers t where t.id = new.transfer_id
  for update;

  if v_alloc.partner_organization_id <> v_transfer.partner_organization_id then
    raise exception 'Repasse e divisão são de parceiros diferentes' using errcode = '23514';
  end if;

  select coalesce(sum(i.amount), 0) into v_used
  from public.partner_transfer_items i
  where i.allocation_id = new.allocation_id
    and not (i.transfer_id = new.transfer_id and i.allocation_id = new.allocation_id);
  if v_used + new.amount > v_alloc.partner_amount then
    raise exception 'Repasse excede a parte do parceiro nesta divisão' using errcode = '23514';
  end if;

  select coalesce(sum(i.amount), 0) into v_used
  from public.partner_transfer_items i
  where i.transfer_id = new.transfer_id
    and not (i.transfer_id = new.transfer_id and i.allocation_id = new.allocation_id);
  if v_used + new.amount > v_transfer.amount then
    raise exception 'Itens excedem o valor do repasse' using errcode = '23514';
  end if;

  return new;
end
$$;

create trigger partner_transfer_items_guard
  before insert or update on public.partner_transfer_items
  for each row execute function private.partner_transfer_items_guard();
