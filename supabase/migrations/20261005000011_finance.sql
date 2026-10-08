-- DG Brasil — 011: financeiro
--
-- Conceitos separados, nunca no mesmo campo:
--   legal_processes.case_value      valor da causa (jurídico, nunca dividido)
--   financial_agreements            honorários contratados do caso
--   payments                        OBRIGAÇÕES: o que se espera receber
--   payment_receipts                LEDGER append-only do que entrou (recebimento,
--                                   ajuste, estorno). Valor pago, saldo e status
--                                   são DERIVADOS (view payment_balances)
--   case_partnership_agreements     snapshot da divisão com o parceiro de origem;
--                                   histórico: cancelado, nunca sobrescrito
--   partner_revenue_allocations     parte do parceiro em CADA lançamento do ledger,
--                                   gerada pelo banco a partir do snapshot
--   partner_transfers / _items      repasses efetivamente feitos ao parceiro
--
-- O financeiro pertence ao CASO, não ao cliente nem ao processo.
--
-- Regra de histórico: o que foi recebido, dividido e repassado ANTES de uma
-- troca de origem continua ligado ao acordo antigo. Nada se move
-- retroativamente para o snapshot novo; só recebimentos novos seguem o acordo
-- ativo. Estorno sempre segue o acordo do recebimento que estorna.

create table public.fee_models (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (btrim(name) <> ''),
  description            text,
  legal_area_id          uuid references public.legal_areas (id) on delete restrict,
  upfront_fee            public.money_amount,
  fixed_fee              public.money_amount,
  installments           integer check (installments is null or installments > 0),
  monthly_fee            public.money_amount,
  success_fee_percentage public.percentage,
  billing_moment         text not null default 'ON_SIGNING'
                         check (billing_moment in ('ON_SIGNING', 'MONTHLY', 'ON_FILING', 'ON_SUCCESS', 'CUSTOM')),
  notes                  text,
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
-- Tem ciclo de vida próprio (DRAFT → ACTIVE → COMPLETED/CANCELLED): isso é
-- decisão de negócio, não valor derivado.

create table public.financial_agreements (
  id                     uuid primary key default gen_random_uuid(),
  legal_case_id          uuid not null references public.legal_cases (id) on delete restrict,
  fee_model_id           uuid references public.fee_models (id) on delete restrict,
  upfront_fee            public.money_amount,
  fixed_fee              public.money_amount,
  installments           integer check (installments is null or installments > 0),
  monthly_fee            public.money_amount,
  success_fee_percentage public.percentage,
  currency               public.currency_code not null default 'BRL',
  start_date             date,
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
-- Criado no ACEITE de caso cuja ORIGEM é um parceiro, copiando a divisão
-- vigente do parceiro naquele momento. Mudar o padrão do parceiro depois não
-- altera esta linha. Troca de origem CANCELA o acordo ativo (cancelled_at) e,
-- se a nova origem for parceiro, cria outro. No máximo um ATIVO por caso.

create table public.case_partnership_agreements (
  id                      uuid primary key default gen_random_uuid(),
  legal_case_id           uuid not null references public.legal_cases (id) on delete restrict,
  partner_organization_id uuid not null references public.organizations (id) on delete restrict,
  partner_percentage      public.percentage not null,
  owner_percentage        public.percentage not null,
  effective_at            timestamptz not null default now(),
  created_by              uuid references public.profiles (id) on delete restrict,
  created_at              timestamptz not null default now(),
  cancelled_at            timestamptz,
  cancelled_by            uuid references public.profiles (id) on delete restrict,
  cancellation_reason     text,
  constraint case_partnership_agreements_split_is_100
    check (partner_percentage + owner_percentage = 100),
  constraint case_partnership_agreements_cancel_has_reason
    check (cancelled_at is null or nullif(btrim(cancellation_reason), '') is not null)
);

create unique index case_partnership_agreements_one_active_per_case
  on public.case_partnership_agreements (legal_case_id) where cancelled_at is null;
create index case_partnership_agreements_case_idx
  on public.case_partnership_agreements (legal_case_id);
create index case_partnership_agreements_partner_idx
  on public.case_partnership_agreements (partner_organization_id);

-- Snapshot é imutável: a única mudança possível é o cancelamento (uma vez).
create or replace function private.case_partnership_agreements_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('dg.actor_user_id', true), '')::uuid);
begin
  if tg_op = 'INSERT' then
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
    if new.cancelled_at is not null then
      raise exception 'Acordo de parceria nasce ativo' using errcode = '23514';
    end if;
    new.created_by := coalesce(new.created_by, v_actor);
    return new;
  end if;

  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Somente ADMIN interno cancela acordo de parceria' using errcode = '42501';
  end if;
  if old.cancelled_at is not null then
    raise exception 'Acordo de parceria cancelado é histórico: não muda' using errcode = '23514';
  end if;
  if (to_jsonb(new) - array['cancelled_at', 'cancelled_by', 'cancellation_reason'])
     <> (to_jsonb(old) - array['cancelled_at', 'cancelled_by', 'cancellation_reason']) then
    raise exception 'Snapshot de parceria é imutável: cancele e crie outro' using errcode = '23514';
  end if;
  if new.cancelled_at is not null then
    new.cancelled_by := coalesce(new.cancelled_by, v_actor);
  end if;
  return new;
end
$$;

create trigger case_partnership_agreements_guard
  before insert or update on public.case_partnership_agreements
  for each row execute function private.case_partnership_agreements_guard();

-- Snapshot no aceite e na troca de origem de caso aceito (a troca só chega aqui
-- por private.change_case_origin, validada em legal_cases_guard).
--   Parceiro A → Parceiro B: cancela A, cria B.
--   Parceiro → OWNER:        cancela, não cria.
--   OWNER → Parceiro:        cria.
--   Parceiro → mesmo:        nada.
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

  if v_settings.partnership_active then
    insert into public.case_partnership_agreements
      (legal_case_id, partner_organization_id, partner_percentage, owner_percentage, effective_at, created_by)
    values
      (new.id, new.origin_organization_id, v_settings.default_partner_percentage,
       v_settings.default_owner_percentage,
       case when v_is_accept then new.accepted_at else now() end, v_actor);
  end if;

  return null;
end
$$;

create trigger legal_cases_partnership_snapshot
  after insert or update of accepted_at, origin_organization_id on public.legal_cases
  for each row execute function private.legal_cases_partnership_snapshot();

-- ───────────────────────────── obrigações (payments) ──────────────────────
-- O que se espera receber. Não guarda valor pago nem status: isso vem do
-- ledger. CANCELLED é decisão explícita (cancelled_at), não valor derivado.

create table public.payments (
  id                     uuid primary key default gen_random_uuid(),
  financial_agreement_id uuid not null references public.financial_agreements (id) on delete restrict,
  amount                 public.money_amount not null check (amount > 0),
  currency               public.currency_code not null default 'BRL',
  due_date               date,
  payment_type           text not null check (payment_type in ('UPFRONT', 'FIXED', 'MONTHLY', 'SUCCESS_FEE', 'OTHER')),
  description            text,
  cancelled_at           timestamptz,
  cancelled_by           uuid references public.profiles (id) on delete restrict,
  cancellation_reason    text,
  created_by             uuid references public.profiles (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint payments_cancel_has_reason
    check (cancelled_at is null or nullif(btrim(cancellation_reason), '') is not null)
);

create index payments_agreement_idx on public.payments (financial_agreement_id);
create index payments_due_idx on public.payments (due_date) where cancelled_at is null;

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function private.set_updated_at();

create or replace function private.payments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('dg.actor_user_id', true), '')::uuid);
  v_net   numeric(14,2);
begin
  -- Antes de qualquer regra (que poderia revelar valores na mensagem de erro):
  -- trigger roda ANTES do WITH CHECK da RLS, então a autorização vem primeiro.
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Somente ADMIN interno opera o financeiro' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, v_actor);
    if new.cancelled_at is not null then
      raise exception 'Obrigação nasce ativa' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.financial_agreement_id is distinct from old.financial_agreement_id then
    raise exception 'Obrigação não muda de acordo' using errcode = '23514';
  end if;
  if old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at then
    raise exception 'Obrigação cancelada não volta: registre outra' using errcode = '23514';
  end if;
  if new.cancelled_at is not null and old.cancelled_at is null then
    new.cancelled_by := coalesce(new.cancelled_by, v_actor);
  end if;

  if new.amount <> old.amount then
    select coalesce(sum(r.amount), 0) into v_net from public.payment_receipts r where r.payment_id = new.id;
    if new.amount < v_net then
      raise exception 'Valor da obrigação (%) menor que o já recebido (%)', new.amount, v_net using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger payments_guard
  before insert or update on public.payments
  for each row execute function private.payments_guard();

-- ───────────────────────────── ledger de recebimentos ─────────────────────
-- Append-only. Corrigir = novo lançamento:
--   RECEIPT     entrada (amount > 0)
--   REVERSAL    estorno de um lançamento (amount < 0, aponta o original)
--   ADJUSTMENT  ajuste com justificativa (qualquer sinal; pode apontar o original)
-- Invariantes: total líquido nunca negativo e nunca acima da obrigação; um
-- lançamento não é estornado além do próprio valor.

create table public.payment_receipts (
  id                  uuid primary key default gen_random_uuid(),
  -- Ordem total (created_at empata dentro da mesma transação).
  sequence            bigint generated always as identity unique,
  payment_id          uuid not null references public.payments (id) on delete restrict,
  kind                text not null check (kind in ('RECEIPT', 'ADJUSTMENT', 'REVERSAL')),
  amount              numeric(14,2) not null check (amount <> 0),
  currency            public.currency_code not null default 'BRL',
  occurred_at         timestamptz not null default now(),
  original_receipt_id uuid references public.payment_receipts (id) on delete restrict,
  method              text,  -- PIX, TED, boleto...
  notes               text,
  created_by          uuid references public.profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),
  constraint payment_receipts_kind_consistent check (
    case kind
      when 'RECEIPT'    then amount > 0 and original_receipt_id is null
      when 'REVERSAL'   then amount < 0 and original_receipt_id is not null
      when 'ADJUSTMENT' then nullif(btrim(notes), '') is not null
    end
  )
);

create index payment_receipts_payment_idx on public.payment_receipts (payment_id, sequence);
create index payment_receipts_original_idx on public.payment_receipts (original_receipt_id);

create or replace function private.payment_receipts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment  record;
  v_original record;
  v_reversed numeric(14,2);
  v_net      numeric(14,2);
begin
  -- Antes de qualquer regra (que poderia revelar valores na mensagem de erro):
  -- trigger roda ANTES do WITH CHECK da RLS, então a autorização vem primeiro.
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Somente ADMIN interno opera o financeiro' using errcode = '42501';
  end if;
  -- Serializa lançamentos da mesma obrigação.
  select p.amount, p.currency, p.cancelled_at into v_payment
  from public.payments p where p.id = new.payment_id
  for update;
  if not found then
    raise exception 'Obrigação % não existe', new.payment_id using errcode = '23503';
  end if;
  if new.currency <> v_payment.currency then
    raise exception 'Moeda do lançamento difere da obrigação' using errcode = '23514';
  end if;
  if v_payment.cancelled_at is not null and new.amount > 0 then
    raise exception 'Obrigação cancelada não recebe entrada' using errcode = '23514';
  end if;

  if new.original_receipt_id is not null then
    select r.payment_id, r.kind, r.amount into v_original
    from public.payment_receipts r where r.id = new.original_receipt_id;
    if v_original.payment_id is distinct from new.payment_id then
      raise exception 'O lançamento original é de outra obrigação' using errcode = '23514';
    end if;
    if v_original.amount < 0 then
      raise exception 'Só se estorna/ajusta lançamento de entrada' using errcode = '23514';
    end if;
    if new.amount < 0 then
      select coalesce(sum(r.amount), 0) into v_reversed
      from public.payment_receipts r
      where r.original_receipt_id = new.original_receipt_id and r.amount < 0;
      if v_reversed + new.amount < -v_original.amount then
        raise exception 'Estorno excede o valor do lançamento original' using errcode = '23514';
      end if;
    end if;
  end if;

  select coalesce(sum(r.amount), 0) into v_net from public.payment_receipts r where r.payment_id = new.payment_id;
  if v_net + new.amount < 0 then
    raise exception 'Total recebido ficaria negativo' using errcode = '23514';
  end if;
  if v_net + new.amount > v_payment.amount then
    raise exception 'Recebido (%) excederia a obrigação (%): ajuste a obrigação antes', v_net + new.amount, v_payment.amount
      using errcode = '23514';
  end if;

  new.created_by := coalesce(new.created_by, auth.uid(), nullif(current_setting('dg.actor_user_id', true), '')::uuid);
  return new;
end
$$;

create trigger payment_receipts_guard
  before insert on public.payment_receipts
  for each row execute function private.payment_receipts_guard();

create trigger payment_receipts_append_only
  before update or delete on public.payment_receipts
  for each row execute function private.prevent_mutation();

-- Situação de cada obrigação, derivada do ledger. OVERDUE usa a data de hoje
-- no fuso do escritório.
create view public.payment_balances
with (security_invoker = true)
as
select
  p.id as payment_id,
  p.financial_agreement_id,
  f.legal_case_id,
  p.amount,
  p.currency,
  p.due_date,
  coalesce(l.received, 0)::numeric(14,2) as received_amount,
  (p.amount - coalesce(l.received, 0))::numeric(14,2) as balance,
  l.last_occurred_at as last_receipt_at,
  case
    when p.cancelled_at is not null                         then 'CANCELLED'
    when coalesce(l.received, 0) >= p.amount                 then 'PAID'
    when p.due_date < (now() at time zone 'America/Sao_Paulo')::date then 'OVERDUE'
    when coalesce(l.received, 0) > 0                         then 'PARTIAL'
    else 'PENDING'
  end as status
from public.payments p
join public.financial_agreements f on f.id = p.financial_agreement_id
left join lateral (
  select sum(r.amount) as received, max(r.occurred_at) as last_occurred_at
  from public.payment_receipts r where r.payment_id = p.id
) l on true;

comment on view public.payment_balances is
  'Recebido, saldo e status (PENDING, PARTIAL, PAID, OVERDUE, CANCELLED) derivados de payment_receipts.';

-- ───────────────────────────── divisão da receita ─────────────────────────
-- Uma linha por lançamento do ledger, gerada pelo banco (nunca digitada): o
-- valor do parceiro sai do lançamento × percentual CONGELADO do snapshot. A
-- divisão incide sobre o que foi RECEBIDO, nunca sobre o valor da causa.
-- Arredondamento: round(base × % / 100, 2), metade para longe do zero
-- (simétrico: o estorno integral desfaz exatamente a parte do parceiro); o
-- escritório fica com a diferença, de modo que parceiro + escritório = base.

create table public.partner_revenue_allocations (
  id                            uuid primary key default gen_random_uuid(),
  sequence                      bigint generated always as identity unique,
  receipt_id                    uuid not null unique references public.payment_receipts (id) on delete restrict,
  case_partnership_agreement_id uuid not null references public.case_partnership_agreements (id) on delete restrict,
  -- Estorno/ajuste de um lançamento já dividido aponta a divisão original.
  reverses_allocation_id        uuid references public.partner_revenue_allocations (id) on delete restrict,
  base_amount                   numeric(14,2) not null check (base_amount <> 0),
  partner_percentage            public.percentage not null,
  partner_amount                numeric(14,2) not null,
  owner_amount                  numeric(14,2) not null,
  created_at                    timestamptz not null default now(),
  constraint partner_revenue_allocations_sum check (partner_amount + owner_amount = base_amount),
  constraint partner_revenue_allocations_formula
    check (partner_amount = round(base_amount * partner_percentage / 100, 2))
);

create index partner_revenue_allocations_agreement_idx
  on public.partner_revenue_allocations (case_partnership_agreement_id);
create index partner_revenue_allocations_reverses_idx
  on public.partner_revenue_allocations (reverses_allocation_id);

create or replace function private.partner_revenue_allocations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt   record;
  v_agreement record;
  v_original  record;
begin
  select r.amount, r.original_receipt_id, f.legal_case_id into v_receipt
  from public.payment_receipts r
  join public.payments p on p.id = r.payment_id
  join public.financial_agreements f on f.id = p.financial_agreement_id
  where r.id = new.receipt_id;

  select a.legal_case_id, a.partner_percentage into v_agreement
  from public.case_partnership_agreements a where a.id = new.case_partnership_agreement_id;

  if v_agreement.legal_case_id is distinct from v_receipt.legal_case_id then
    raise exception 'O lançamento e o acordo de parceria são de casos diferentes' using errcode = '23514';
  end if;
  if new.base_amount <> v_receipt.amount then
    raise exception 'Base da divisão precisa ser o valor do lançamento' using errcode = '23514';
  end if;
  if new.partner_percentage <> v_agreement.partner_percentage then
    raise exception 'Percentual da divisão difere do snapshot do acordo' using errcode = '23514';
  end if;

  if new.reverses_allocation_id is not null then
    select al.receipt_id, al.case_partnership_agreement_id into v_original
    from public.partner_revenue_allocations al where al.id = new.reverses_allocation_id;
    if v_original.receipt_id is distinct from v_receipt.original_receipt_id
       or v_original.case_partnership_agreement_id <> new.case_partnership_agreement_id then
      raise exception 'Divisão de estorno precisa apontar a divisão do lançamento original, no mesmo acordo'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger partner_revenue_allocations_guard
  before insert on public.partner_revenue_allocations
  for each row execute function private.partner_revenue_allocations_guard();

create trigger partner_revenue_allocations_append_only
  before update or delete on public.partner_revenue_allocations
  for each row execute function private.prevent_mutation();

-- Gera a divisão de cada lançamento, na mesma transação do lançamento.
--   Entrada/ajuste sem original: acordo ATIVO do caso neste momento (se houver).
--   Estorno/ajuste de um lançamento: o MESMO acordo da divisão original.
create or replace function private.payment_receipts_allocate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agreement uuid;
  v_pct       numeric(5,2);
  v_reverses  uuid;
  v_partner   numeric(14,2);
begin
  if new.original_receipt_id is not null then
    select al.id, al.case_partnership_agreement_id into v_reverses, v_agreement
    from public.partner_revenue_allocations al where al.receipt_id = new.original_receipt_id;
  else
    select a.id into v_agreement
    from public.payments p
    join public.financial_agreements f on f.id = p.financial_agreement_id
    join public.case_partnership_agreements a on a.legal_case_id = f.legal_case_id and a.cancelled_at is null
    where p.id = new.payment_id;
  end if;

  if v_agreement is null then
    return null;  -- caso sem parceria (origem é o escritório proprietário)
  end if;

  select a.partner_percentage into v_pct from public.case_partnership_agreements a where a.id = v_agreement;
  v_partner := round(new.amount * v_pct / 100, 2);

  insert into public.partner_revenue_allocations
    (receipt_id, case_partnership_agreement_id, reverses_allocation_id,
     base_amount, partner_percentage, partner_amount, owner_amount)
  values
    (new.id, v_agreement, v_reverses, new.amount, v_pct, v_partner, new.amount - v_partner);
  return null;
end
$$;

create trigger payment_receipts_allocate
  after insert on public.payment_receipts
  for each row execute function private.payment_receipts_allocate();

-- ───────────────────────────── repasses ───────────────────────────────────
-- PENDING → PAID → (CANCELLED com motivo); PENDING → CANCELLED. Repasse
-- cancelado continua no histórico, mas deixa de consumir o saldo do parceiro.

create table public.partner_transfers (
  id                      uuid primary key default gen_random_uuid(),
  partner_organization_id uuid not null references public.organizations (id) on delete restrict,
  amount                  public.money_amount not null check (amount > 0),
  status                  text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'CANCELLED')),
  paid_at                 timestamptz,
  reference               text,
  registered_by           uuid references public.profiles (id) on delete restrict,
  cancelled_at            timestamptz,
  cancellation_reason     text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint partner_transfers_paid_has_date check (status <> 'PAID' or paid_at is not null),
  constraint partner_transfers_cancel_consistent check (
    (status = 'CANCELLED') = (cancelled_at is not null)
    and (cancelled_at is null or nullif(btrim(cancellation_reason), '') is not null)
  )
);

create index partner_transfers_partner_idx on public.partner_transfers (partner_organization_id, created_at);

create trigger partner_transfers_set_updated_at
  before update on public.partner_transfers
  for each row execute function private.set_updated_at();

create or replace function private.partner_transfers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Antes de qualquer regra (que poderia revelar valores na mensagem de erro):
  -- trigger roda ANTES do WITH CHECK da RLS, então a autorização vem primeiro.
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Somente ADMIN interno opera o financeiro' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'PENDING' then
      raise exception 'Repasse nasce PENDING (itens primeiro, depois PAID)' using errcode = '23514';
    end if;
    new.registered_by := coalesce(new.registered_by, auth.uid(),
                                  nullif(current_setting('dg.actor_user_id', true), '')::uuid);
    return new;
  end if;

  if new.partner_organization_id is distinct from old.partner_organization_id then
    raise exception 'Repasse não muda de parceiro' using errcode = '23514';
  end if;
  if new.amount <> old.amount and old.status <> 'PENDING' then
    raise exception 'Valor de repasse pago ou cancelado não muda' using errcode = '23514';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'PENDING' and new.status in ('PAID', 'CANCELLED'))
            or (old.status = 'PAID' and new.status = 'CANCELLED')) then
      raise exception 'Transição de repasse inválida: % → %', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'PAID' then
      new.paid_at := coalesce(new.paid_at, now());
    end if;
    if new.status = 'CANCELLED' then
      new.cancelled_at := coalesce(new.cancelled_at, now());
    end if;
  end if;
  return new;
end
$$;

create trigger partner_transfers_guard
  before insert or update on public.partner_transfers
  for each row execute function private.partner_transfers_guard();

-- Itens: quanto de cada divisão (de entrada) vai neste repasse. Append-only.
create table public.partner_transfer_items (
  transfer_id   uuid not null references public.partner_transfers (id) on delete restrict,
  allocation_id uuid not null references public.partner_revenue_allocations (id) on delete restrict,
  amount        public.money_amount not null check (amount > 0),
  created_at    timestamptz not null default now(),
  primary key (transfer_id, allocation_id)
);

create index partner_transfer_items_allocation_idx on public.partner_transfer_items (allocation_id);

-- Parte do parceiro ainda disponível numa divisão: parte líquida (descontados
-- estornos) menos o que já está em repasses NÃO cancelados.
create or replace function private.allocation_available_amount(p_allocation_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select al.partner_amount
       + coalesce((select sum(rv.partner_amount) from public.partner_revenue_allocations rv
                   where rv.reverses_allocation_id = al.id), 0)
       - coalesce((select sum(i.amount)
                   from public.partner_transfer_items i
                   join public.partner_transfers t on t.id = i.transfer_id
                   where i.allocation_id = al.id and t.status <> 'CANCELLED'), 0)
  from public.partner_revenue_allocations al
  where al.id = p_allocation_id
$$;

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
  -- Antes de qualquer regra (que poderia revelar valores na mensagem de erro):
  -- trigger roda ANTES do WITH CHECK da RLS, então a autorização vem primeiro.
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Somente ADMIN interno opera o financeiro' using errcode = '42501';
  end if;
  select al.partner_amount, al.reverses_allocation_id, a.partner_organization_id into v_alloc
  from public.partner_revenue_allocations al
  join public.case_partnership_agreements a on a.id = al.case_partnership_agreement_id
  where al.id = new.allocation_id
  for update of al;

  select t.amount, t.status, t.partner_organization_id into v_transfer
  from public.partner_transfers t where t.id = new.transfer_id
  for update;

  if v_transfer.status <> 'PENDING' then
    raise exception 'Itens só entram em repasse PENDING' using errcode = '23514';
  end if;
  if v_alloc.reverses_allocation_id is not null or v_alloc.partner_amount <= 0 then
    raise exception 'Repasse só sai de divisão de entrada' using errcode = '23514';
  end if;
  if v_alloc.partner_organization_id <> v_transfer.partner_organization_id then
    raise exception 'Repasse e divisão são de parceiros diferentes' using errcode = '23514';
  end if;

  if new.amount > private.allocation_available_amount(new.allocation_id) then
    raise exception 'Repasse excede a parte do parceiro disponível nesta divisão' using errcode = '23514';
  end if;

  select coalesce(sum(i.amount), 0) into v_used
  from public.partner_transfer_items i where i.transfer_id = new.transfer_id;
  if v_used + new.amount > v_transfer.amount then
    raise exception 'Itens excedem o valor do repasse' using errcode = '23514';
  end if;

  return new;
end
$$;

create trigger partner_transfer_items_guard
  before insert on public.partner_transfer_items
  for each row execute function private.partner_transfer_items_guard();

create trigger partner_transfer_items_append_only
  before update or delete on public.partner_transfer_items
  for each row execute function private.prevent_mutation();

-- Saldo por divisão de entrada (o que o parceiro tem a receber).
create view public.partner_allocation_balances
with (security_invoker = true)
as
select
  al.id as allocation_id,
  al.case_partnership_agreement_id,
  a.partner_organization_id,
  a.legal_case_id,
  al.receipt_id,
  al.partner_amount as gross_partner_amount,
  (al.partner_amount
   + coalesce((select sum(rv.partner_amount) from public.partner_revenue_allocations rv
               where rv.reverses_allocation_id = al.id), 0))::numeric(14,2) as net_partner_amount,
  coalesce((select sum(i.amount)
            from public.partner_transfer_items i
            join public.partner_transfers t on t.id = i.transfer_id
            where i.allocation_id = al.id and t.status <> 'CANCELLED'), 0)::numeric(14,2) as transferred_amount,
  coalesce((select sum(i.amount)
            from public.partner_transfer_items i
            join public.partner_transfers t on t.id = i.transfer_id
            where i.allocation_id = al.id and t.status = 'PAID'), 0)::numeric(14,2) as paid_amount
from public.partner_revenue_allocations al
join public.case_partnership_agreements a on a.id = al.case_partnership_agreement_id
where al.reverses_allocation_id is null;

comment on view public.partner_allocation_balances is
  'Por divisão de entrada: parte líquida do parceiro, em repasse (não cancelado) e paga. available = net - transferred.';
