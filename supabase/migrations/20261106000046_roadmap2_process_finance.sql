-- DG Brasil — 046: Roadmap 2.0, bloco 3 — financeiro por processo
--
-- Pedido da Barbara (2026-11-06): "tudo do financeiro vinculado ao processo".
-- O processo tem valor da causa, honorários (045, dados internos), a divisão
-- com o parceiro, o contrato de honorários (obrigações e recebimentos) e as
-- DESPESAS (custas, advogado contratado, perícia/avaliação, audiência...).
--
--   1. Contrato de honorários passa a ser DO PROCESSO: financial_agreements
--      ganha legal_process_id (do mesmo caso), obrigatório em contrato novo;
--      um contrato ATIVO por processo. Os contratos antigos (por caso) ficam
--      como estão; os rascunhos/ativos de caso com um processo só são ligados
--      a ele.
--   2. Despesas do processo (process_expenses): lançadas pelo ADMIN, nunca
--      apagadas (cancelar exige motivo), auditadas.
--   3. Visão consolidada por processo (process_finance_overview): valor da
--      causa, honorários (total, escritório, parceiro), contratado, recebido,
--      em aberto, em atraso, despesas e resultado.
--
-- A divisão com o parceiro continua vindo da parceria do CASO (snapshot no
-- aceite, 011/020) e vale para todos os processos dele. O ledger e as
-- divisões automáticas (partner_revenue_allocations) não mudam.
--
-- 001–045 não são alteradas.

-- ───────────────────────────── 1. contrato do processo ───────────────────

alter table public.financial_agreements add column legal_process_id uuid;

alter table public.financial_agreements
  add constraint financial_agreements_process_fkey
  foreign key (legal_process_id, legal_case_id)
  references public.legal_processes (id, legal_case_id) on delete restrict;

create index financial_agreements_process_idx on public.financial_agreements (legal_process_id);

comment on column public.financial_agreements.legal_process_id is
  'Processo do contrato de honorários (Roadmap 2.0). Nulo só em contratos antigos, do tempo em que o financeiro era do caso.';

-- Um contrato ATIVO por processo; contratos antigos (sem processo) seguem a
-- regra antiga, um ativo por caso.
drop index public.financial_agreements_one_active_per_case;
create unique index financial_agreements_one_active_per_process
  on public.financial_agreements (legal_process_id) where status = 'ACTIVE' and legal_process_id is not null;
create unique index financial_agreements_one_active_per_case_legacy
  on public.financial_agreements (legal_case_id) where status = 'ACTIVE' and legal_process_id is null;

-- Rascunho/ativo de caso com UM processo: liga a ele. Concluídos e cancelados
-- são histórico (a guarda não deixa mudar) e ficam como contrato do caso.
update public.financial_agreements f
   set legal_process_id = (select p.id from public.legal_processes p
                            where p.legal_case_id = f.legal_case_id and p.deleted_at is null)
 where f.legal_process_id is null
   and f.status in ('DRAFT', 'ACTIVE')
   and (select count(*) from public.legal_processes p
         where p.legal_case_id = f.legal_case_id and p.deleted_at is null) = 1;

-- Guarda (030) + as regras do processo.
create or replace function private.financial_agreements_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('dg.actor_user_id', true), '')::uuid);
begin
  -- Autorização antes de qualquer regra (a guarda roda antes do WITH CHECK da RLS).
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Somente ADMIN interno opera o financeiro' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('DRAFT', 'ACTIVE') then
      raise exception 'Acordo nasce em rascunho ou ativo' using errcode = '23514';
    end if;
    -- Roadmap 2.0: contrato novo é sempre de um processo.
    if new.legal_process_id is null then
      raise exception 'O contrato de honorários é do processo: informe o processo' using errcode = '23514';
    end if;
    if exists (select 1 from public.legal_processes p where p.id = new.legal_process_id and p.deleted_at is not null) then
      raise exception 'Processo excluído não recebe contrato' using errcode = '23514';
    end if;
    new.created_by := coalesce(new.created_by, v_actor);
    return new;
  end if;

  if new.legal_case_id is distinct from old.legal_case_id then
    raise exception 'Acordo não muda de caso' using errcode = '23514';
  end if;
  -- Processo: só se define uma vez (contrato antigo sem processo pode ser ligado).
  if old.legal_process_id is not null and new.legal_process_id is distinct from old.legal_process_id then
    raise exception 'Acordo não muda de processo' using errcode = '23514';
  end if;
  if old.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'Acordo concluído ou cancelado é histórico: não muda' using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'DRAFT' and new.status in ('ACTIVE', 'CANCELLED'))
         or (old.status = 'ACTIVE' and new.status in ('COMPLETED', 'CANCELLED'))) then
      raise exception 'Esta mudança de situação do acordo não é permitida' using errcode = '23514';
    end if;
  end if;

  if old.status <> 'DRAFT' and (
       new.fee_model_id is distinct from old.fee_model_id
    or new.upfront_fee is distinct from old.upfront_fee
    or new.fixed_fee is distinct from old.fixed_fee
    or new.installments is distinct from old.installments
    or new.monthly_fee is distinct from old.monthly_fee
    or new.success_fee_percentage is distinct from old.success_fee_percentage
    or new.currency is distinct from old.currency
    or new.start_date is distinct from old.start_date) then
    raise exception 'Só o rascunho do acordo pode ter os termos alterados' using errcode = '23514';
  end if;

  if new.status in ('COMPLETED', 'CANCELLED') and new.status is distinct from old.status then
    if exists (
      select 1
      from public.payments p
      where p.financial_agreement_id = new.id
        and p.cancelled_at is null
        and p.amount > coalesce((select sum(r.amount) from public.payment_receipts r where r.payment_id = p.id), 0)
    ) then
      raise exception 'Há obrigações em aberto neste acordo: registre o recebimento ou cancele-as antes' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

-- ───────────────────────────── 2. despesas do processo ───────────────────

create table public.process_expenses (
  id                  uuid primary key default gen_random_uuid(),
  legal_process_id    uuid not null,
  legal_case_id       uuid not null,
  category            text not null check (category in (
                        'COURT_COSTS', 'HIRED_LAWYER', 'EXPERT_FEE', 'HEARING', 'TRAVEL', 'NOTARY', 'OTHER')),
  description         text not null check (btrim(description) <> '' and length(description) <= 500),
  amount              numeric(14,2) not null check (amount > 0),
  currency            public.currency_code not null default 'BRL',
  incurred_on         date not null,
  -- Data em que foi paga; nula = a pagar.
  paid_on             date,
  -- Despesa que o cliente reembolsa (ex.: custas adiantadas pelo escritório).
  reimbursable        boolean not null default false,
  supplier            text check (supplier is null or length(supplier) <= 200),
  notes               text check (notes is null or length(notes) <= 2000),
  created_by          uuid references public.profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  cancelled_at        timestamptz,
  cancelled_by        uuid references public.profiles (id) on delete restrict,
  cancellation_reason text,
  constraint process_expenses_process_fkey
    foreign key (legal_process_id, legal_case_id)
    references public.legal_processes (id, legal_case_id) on delete restrict,
  constraint process_expenses_cancel_has_reason
    check (cancelled_at is null or nullif(btrim(cancellation_reason), '') is not null)
);

comment on table public.process_expenses is
  'Despesas do processo (custas, advogado contratado, perícia/avaliação, audiência, deslocamento, cartório). Só ADMIN. Nunca apagadas: cancelar exige motivo.';

create index process_expenses_process_idx on public.process_expenses (legal_process_id);
create index process_expenses_incurred_idx on public.process_expenses (incurred_on);

create trigger process_expenses_set_updated_at
  before update on public.process_expenses
  for each row execute function private.set_updated_at();

create or replace function private.process_expenses_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('dg.actor_user_id', true), '')::uuid);
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Somente ADMIN interno lança despesas' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    -- O caso vem do processo: nunca do navegador.
    select p.legal_case_id into new.legal_case_id
    from public.legal_processes p where p.id = new.legal_process_id and p.deleted_at is null;
    if new.legal_case_id is null then
      raise exception 'Processo não encontrado' using errcode = '23514';
    end if;
    if new.cancelled_at is not null then
      raise exception 'Despesa nasce ativa' using errcode = '23514';
    end if;
    new.created_by := coalesce(new.created_by, v_actor);
    return new;
  end if;

  if new.legal_process_id is distinct from old.legal_process_id or new.legal_case_id is distinct from old.legal_case_id then
    raise exception 'Despesa não muda de processo' using errcode = '23514';
  end if;
  if old.cancelled_at is not null then
    raise exception 'Despesa cancelada é histórico: não muda' using errcode = '23514';
  end if;
  if new.cancelled_at is not null then
    new.cancelled_by := coalesce(new.cancelled_by, v_actor);
  end if;
  return new;
end
$$;

create trigger process_expenses_guard
  before insert or update on public.process_expenses
  for each row execute function private.process_expenses_guard();

alter table public.process_expenses enable row level security;

create policy process_expenses_select_admin on public.process_expenses for select to authenticated
  using ((select private.is_admin()));
create policy process_expenses_insert_admin on public.process_expenses for insert to authenticated
  with check ((select private.is_admin()));
create policy process_expenses_update_admin on public.process_expenses for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.process_expenses from public, anon;
grant select, insert, update on public.process_expenses to authenticated;
grant select on public.process_expenses to service_role;

-- Trilha de auditoria (a função geral da 014 lista tabela a tabela; tabelas
-- novas do Roadmap 2.0 usam esta, com as mesmas regras: só nomes de campos).
create or replace function private.audit_roadmap2_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t      text := tg_table_name;
  o      jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n      jsonb := to_jsonb(new);
  v_cols text[];
begin
  if tg_op = 'UPDATE' then
    v_cols := private.changed_columns(o, n);
    if cardinality(v_cols) = 0 then
      return null;
    end if;
  end if;
  case t
  when 'process_expenses' then
    perform private.record_audit_event(
      case when tg_op = 'INSERT' then 'PROCESS_EXPENSE_CREATED'
           when 'cancelled_at' = any (v_cols) then 'PROCESS_EXPENSE_CANCELLED'
           else 'PROCESS_EXPENSE_UPDATED' end,
      t, (n ->> 'id')::uuid,
      jsonb_build_object('legal_process_id', n ->> 'legal_process_id', 'category', n ->> 'category', 'fields', coalesce(v_cols, '{}')));
  else
    perform private.record_audit_event(upper(t) || '_' || tg_op, t, (n ->> 'id')::uuid, jsonb_build_object('fields', coalesce(v_cols, '{}')));
  end case;
  return null;
end
$$;

create trigger process_expenses_audit
  after insert or update on public.process_expenses
  for each row execute function private.audit_roadmap2_row();

-- ───────────────────────────── 3. visão por processo ─────────────────────
-- Uma linha por processo, somada no banco (o navegador não baixa contratos
-- para somar). security_invoker: ADMIN vê tudo; para os demais as colunas de
-- dinheiro vêm vazias pela RLS das tabelas de origem — e o servidor só serve
-- esta visão a quem tem finance.view.

create view public.process_finance_overview
with (security_invoker = true)
as
select
  p.id                                   as legal_process_id,
  p.legal_case_id,
  c.client_id,
  coalesce(icd.full_name, ccd.legal_name) as client_name,
  p.cnj_number,
  coalesce(nullif(btrim(p.title), ''), c.title) as display_title,
  c.title                                as case_title,
  p.status,
  p.phase,
  p.created_at,
  p.case_value,
  d.fee_amount,
  d.fee_percentage,
  cpa.partner_organization_id,
  coalesce(cpa.partner_percentage, 0)::numeric(5,2) as partner_percentage,
  coalesce(cpa.owner_percentage, 100)::numeric(5,2) as owner_percentage,
  round(coalesce(d.fee_amount, 0) * coalesce(cpa.owner_percentage, 100) / 100, 2)::numeric(14,2) as fee_owner_share,
  round(coalesce(d.fee_amount, 0) * coalesce(cpa.partner_percentage, 0) / 100, 2)::numeric(14,2)  as fee_partner_share,
  coalesce(fin.contracted, 0)::numeric(14,2)   as contracted,
  coalesce(fin.received, 0)::numeric(14,2)     as received,
  coalesce(fin.open_balance, 0)::numeric(14,2) as open_balance,
  coalesce(fin.overdue, 0)::numeric(14,2)      as overdue,
  coalesce(fin.agreements, 0)::int             as agreement_count,
  coalesce(sh.partner_received, 0)::numeric(14,2) as received_partner_share,
  (coalesce(fin.received, 0) - coalesce(sh.partner_received, 0))::numeric(14,2) as received_owner_share,
  coalesce(ex.total, 0)::numeric(14,2)         as expenses_total,
  coalesce(ex.paid, 0)::numeric(14,2)          as expenses_paid,
  coalesce(ex.open, 0)::numeric(14,2)          as expenses_open,
  coalesce(ex.reimbursable, 0)::numeric(14,2)  as expenses_reimbursable,
  coalesce(ex.count, 0)::int                   as expense_count,
  (coalesce(fin.received, 0) - coalesce(sh.partner_received, 0) - coalesce(ex.paid, 0))::numeric(14,2) as net_result
from public.legal_processes p
join public.legal_cases c on c.id = p.legal_case_id
left join public.individual_client_details icd on icd.client_id = c.client_id
left join public.company_client_details ccd on ccd.client_id = c.client_id
left join public.legal_process_internal_details d on d.legal_process_id = p.id
left join public.case_partnership_agreements cpa on cpa.legal_case_id = p.legal_case_id and cpa.cancelled_at is null
left join lateral (
  select count(distinct f.id) filter (where f.status <> 'CANCELLED') as agreements,
         sum(b.amount) filter (where b.status <> 'CANCELLED')   as contracted,
         sum(b.received_amount)                                  as received,
         sum(b.balance) filter (where b.status in ('PENDING', 'PARTIAL', 'OVERDUE')) as open_balance,
         sum(b.balance) filter (where b.status = 'OVERDUE')      as overdue
  from public.financial_agreements f
  left join public.payment_balances b on b.financial_agreement_id = f.id
  where f.legal_process_id = p.id
) fin on true
left join lateral (
  select sum(al.partner_amount) as partner_received
  from public.financial_agreements f
  join public.payments pay on pay.financial_agreement_id = f.id
  join public.payment_receipts r on r.payment_id = pay.id
  join public.partner_revenue_allocations al on al.receipt_id = r.id
  where f.legal_process_id = p.id
) sh on true
left join lateral (
  select sum(e.amount) filter (where e.cancelled_at is null)                              as total,
         sum(e.amount) filter (where e.cancelled_at is null and e.paid_on is not null)    as paid,
         sum(e.amount) filter (where e.cancelled_at is null and e.paid_on is null)        as open,
         sum(e.amount) filter (where e.cancelled_at is null and e.reimbursable)           as reimbursable,
         count(*) filter (where e.cancelled_at is null)                                    as count
  from public.process_expenses e
  where e.legal_process_id = p.id
) ex on true
where p.deleted_at is null;

comment on view public.process_finance_overview is
  'Financeiro por processo: valor da causa, honorários (escritório × parceiro), contratado, recebido, em aberto, em atraso, despesas e resultado. Só leitura; ADMIN.';

revoke all on public.process_finance_overview from public, anon;
grant select on public.process_finance_overview to authenticated, service_role;

-- Totais do escritório (uma linha): indicadores do Financeiro.
create view public.process_finance_totals
with (security_invoker = true)
as
select
  count(*)::int                                       as process_count,
  coalesce(sum(case_value), 0)::numeric(14,2)         as case_value_total,
  coalesce(sum(fee_amount), 0)::numeric(14,2)         as fee_total,
  coalesce(sum(fee_owner_share), 0)::numeric(14,2)    as fee_owner_total,
  coalesce(sum(fee_partner_share), 0)::numeric(14,2)  as fee_partner_total,
  coalesce(sum(contracted), 0)::numeric(14,2)         as contracted_total,
  coalesce(sum(received), 0)::numeric(14,2)           as received_total,
  coalesce(sum(received_owner_share), 0)::numeric(14,2)   as received_owner_total,
  coalesce(sum(received_partner_share), 0)::numeric(14,2) as received_partner_total,
  coalesce(sum(open_balance), 0)::numeric(14,2)       as open_total,
  coalesce(sum(overdue), 0)::numeric(14,2)            as overdue_total,
  coalesce(sum(expenses_total), 0)::numeric(14,2)     as expenses_total,
  coalesce(sum(expenses_paid), 0)::numeric(14,2)      as expenses_paid_total,
  coalesce(sum(expenses_open), 0)::numeric(14,2)      as expenses_open_total,
  coalesce(sum(net_result), 0)::numeric(14,2)         as net_result_total
from public.process_finance_overview;

comment on view public.process_finance_totals is 'Totais do financeiro por processo (uma linha). ADMIN.';

revoke all on public.process_finance_totals from public, anon;
grant select on public.process_finance_totals to authenticated, service_role;

revoke all on function private.process_expenses_guard() from public, anon, authenticated;
revoke all on function private.audit_roadmap2_row() from public, anon, authenticated;
