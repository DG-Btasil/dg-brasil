-- 071 · Correções dos testes ao vivo (13/11/2026): o prazo de "Corrigir e
--       aprovar" nasce conferido por quem corrigiu; a exportação de planilha
--       entra no registro de acesso a dado pessoal; parcela de contrato em
--       rascunho sai do "Em aberto".
--
-- Achado dos testes ao vivo (13/11/2026): o prazo criado por uma proposta que
-- uma pessoa corrigiu e aprovou (069) aparecia na agenda como "Agente, sem
-- conferência". Não faz sentido: uma pessoa já leu a proposta, corrigiu a data
-- (ou o que fosse) e aprovou. Decisão da sessão principal: esse prazo nasce
-- conferido por quem corrigiu, na hora da correção.
--
--   1. Gatilho em agent_proposals (depois de mudar a situação): proposta
--      CREATE_DEADLINE que vira APPLIED com o prazo criado E que foi corrigida
--      (corrected_by preenchido, 069) grava a conferência do prazo:
--      checked_by = quem corrigiu, checked_at = quando corrigiu. Proposta só
--      aprovada (sem correção) continua como antes: o prazo nasce "sem
--      conferência" até alguém clicar em "Conferido" (063). O prazo direto da
--      059 nunca é corrigido: continua sem conferência.
--   2. A gravação passa pelo gatilho de sempre (deadlines_transition_guard,
--      063): conferência uma vez só, só em prazo do agente. Prazo já conferido
--      não muda.
--   3. Auditoria DEADLINE_CHECKED (a mesma da 063), com "via" = correção, a
--      proposta e quem corrigiu.
--
--   4. Exportação (achado C2 dos testes, LGPD): a planilha de clientes leva o
--      CPF completo, mas só aparecia na auditoria ("Planilha exportada",
--      DATA_EXPORTED da 066), não em "Acessos a dados pessoais". Agora
--      public.record_personal_data_export(exportação, tipo, clientes) grava UM
--      acesso "Exportou · Exportação de dados" para cada cliente da planilha,
--      ligado ao registro da exportação (resource_id = id do DATA_EXPORTED).
--      Só ADMIN (quem exporta), no máximo 5000 clientes por planilha (o limite
--      da exportação), cliente repetido conta uma vez, id que não é cliente é
--      ignorado. O painel LGPD já lê essa tabela: nada muda nele.
--
--   5. Financeiro (achado F1): o "Em aberto", o "Em atraso" e o contador de
--      parcelas somavam as parcelas de contrato em RASCUNHO, que ainda não
--      podem ser recebidas. Decisão da dona: rascunho fica fora dessas contas e
--      aparece à parte ("Em contratos em rascunho: R$ X"), com a MESMA conta na
--      Home e no Financeiro. Redefinidos a partir da 064 e da 046, com as
--      mesmas colunas:
--        - public.finance_summary: `totals` e `outside` sem rascunho; novo
--          bloco `draft` (contratado, em aberto, em atraso, parcelas);
--        - views finance_receivables e finance_agreement_list:
--          `in_process_totals` é falso em contrato em rascunho (a planilha diz
--          "Não" em "Nos totais por processo");
--        - public.finance_receivables_totals ganha `p_drafts` (a aba A receber
--          lista os contratos que não são rascunho ou, à parte, só os em
--          rascunho) e devolve `draft_total`/`draft_count` com os mesmos
--          filtros. A versão de 5 parâmetros sai (a nova tem `p_drafts` com
--          padrão);
--        - view process_finance_overview (046): contratado, em aberto e em
--          atraso de cada processo sem rascunho (a mesma conta da visão geral).
--   6. Despesas (sugestão dos testes): public.finance_expenses_totals, o total
--      do período com os mesmos filtros da lista (invoker: só ADMIN lê).
--
-- O contrato do README continua inteiro: nada é aplicado por aqui; o prazo já
-- foi criado pelo aplicador, depois da decisão humana. O aplicador, o gatilho
-- da 063 e a record_data_export da 066 não mudam. 001–070 não são alteradas.
-- Rodar de novo não quebra nem duplica.

-- ═════════════════════════════ 1. o gatilho do prazo ══════════════════════

create or replace function private.agent_proposals_corrected_deadline_checked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d record;
begin
  -- checked_at fica com a hora da correção: o gatilho da 063 grava now(); a
  -- hora exata da correção está na proposta (corrected_at) e na auditoria.
  update public.deadlines d
     set checked_at = coalesce(new.corrected_at, now()), checked_by = new.corrected_by
   where d.id = new.applied_entity_id
     and d.source = 'AGENT'
     and d.checked_at is null
  returning d.id, d.legal_case_id, d.legal_process_id, d.checked_by into v_d;
  if v_d.id is not null then
    perform private.record_audit_event('DEADLINE_CHECKED', 'deadlines', v_d.id,
      jsonb_build_object('legal_case_id', v_d.legal_case_id, 'legal_process_id', v_d.legal_process_id, 'source', 'AGENT',
                         'via', 'PROPOSAL_CORRECTED', 'agent_proposal_id', new.id, 'checked_by', v_d.checked_by));
  end if;
  return null;
end
$$;

drop trigger if exists agent_proposals_corrected_deadline_checked on public.agent_proposals;
create trigger agent_proposals_corrected_deadline_checked
  after update of status on public.agent_proposals
  for each row
  when (new.status = 'APPLIED' and old.status is distinct from new.status and new.proposal_type = 'CREATE_DEADLINE'
        and new.applied_entity_type = 'deadlines' and new.applied_entity_id is not null and new.corrected_by is not null)
  execute function private.agent_proposals_corrected_deadline_checked();

-- ═════════════════════════════ 2. exportação como acesso a dado pessoal ═════

create or replace function private.record_personal_data_export(p_export_id uuid, p_kind text, p_client_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_n     integer;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente o administrador exporta planilhas' using errcode = '42501';
  end if;
  if p_export_id is null or not exists (
       select 1 from public.audit_events a
       where a.id = p_export_id and a.action = 'DATA_EXPORTED' and a.actor_user_id = auth.uid()) then
    raise exception 'Exportação não encontrada' using errcode = '22023';
  end if;
  if coalesce(p_kind, '') !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Tipo de exportação inválido' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_client_ids), 0) > 5000 then
    raise exception 'No máximo 5000 clientes por planilha' using errcode = '22023';
  end if;
  select * into v_actor from private.current_actor();
  insert into public.personal_data_access_events
    (actor_type, actor_user_id, organization_id, agent_run_id, client_id,
     resource_type, resource_id, action, purpose, request_id)
  select v_actor.actor_type, v_actor.actor_user_id, v_actor.actor_organization_id, v_actor.agent_run_id, c.id,
         'EXPORT', p_export_id, 'EXPORT', 'Planilha exportada (' || p_kind || ')', nullif(current_setting('dg.request_id', true), '')
  from public.clients c
  where c.id = any (coalesce(p_client_ids, '{}'))
    and not exists (select 1 from public.personal_data_access_events e
                    where e.resource_id = p_export_id and e.action = 'EXPORT' and e.client_id = c.id);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

create or replace function public.record_personal_data_export(p_export_id uuid, p_kind text, p_client_ids uuid[])
returns integer
language sql
security invoker
set search_path = ''
as $$ select private.record_personal_data_export(p_export_id, p_kind, p_client_ids) $$;

-- ═════════════════════════════ 3. financeiro: rascunho fora do "em aberto" ═

-- Por processo (046): contratado, em aberto e em atraso só de contrato que não
-- é rascunho. Recebido não muda (rascunho não recebe: o livro exige contrato
-- ativo, 030/064). Mesmas colunas, na mesma ordem.
create or replace view public.process_finance_overview
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
         sum(b.amount) filter (where b.status <> 'CANCELLED' and f.status <> 'DRAFT')   as contracted,
         sum(b.received_amount)                                  as received,
         sum(b.balance) filter (where b.status in ('PENDING', 'PARTIAL', 'OVERDUE') and f.status <> 'DRAFT') as open_balance,
         sum(b.balance) filter (where b.status = 'OVERDUE' and f.status <> 'DRAFT')      as overdue
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

-- Contratos (064): `in_process_totals` falso também em rascunho.
create or replace view public.finance_agreement_list
with (security_invoker = true)
as
select
  f.id,
  f.legal_case_id,
  f.legal_process_id,
  f.fee_model_id,
  f.upfront_fee,
  f.fixed_fee,
  f.installments,
  f.monthly_fee,
  f.success_fee_percentage,
  f.currency,
  f.start_date,
  f.status,
  f.notes,
  f.created_by,
  f.created_at,
  f.updated_at,
  f.reopened_at,
  f.reopen_reason,
  fm.name                                  as fee_model_name,
  c.title                                  as case_title,
  c.origin_organization_id                 as case_origin_organization_id,
  c.client_id,
  coalesce(icd.full_name, ccd.legal_name)  as client_name,
  case when p.id is not null then coalesce(nullif(btrim(p.title), ''), c.title) end as process_title,
  p.cnj_number,
  (p.id is not null and p.deleted_at is null and f.status <> 'DRAFT') as in_process_totals,
  coalesce(f.start_date, (f.created_at at time zone 'America/Sao_Paulo')::date) as contract_date,
  coalesce(t.contracted, 0)::numeric(14,2)  as contracted,
  coalesce(t.received, 0)::numeric(14,2)    as received,
  coalesce(t.outstanding, 0)::numeric(14,2) as outstanding,
  coalesce(t.overdue, 0)::numeric(14,2)     as overdue,
  coalesce(t.open_payments, 0)::int         as open_payments,
  t.next_due_date
from public.financial_agreements f
left join public.legal_cases c on c.id = f.legal_case_id
left join public.legal_processes p on p.id = f.legal_process_id
left join public.fee_models fm on fm.id = f.fee_model_id
left join public.individual_client_details icd on icd.client_id = c.client_id
left join public.company_client_details ccd on ccd.client_id = c.client_id
left join lateral (
  select sum(b.amount) filter (where b.status <> 'CANCELLED')                          as contracted,
         sum(b.received_amount)                                                         as received,
         sum(b.balance) filter (where b.status in ('PENDING', 'PARTIAL', 'OVERDUE'))    as outstanding,
         sum(b.balance) filter (where b.status = 'OVERDUE')                             as overdue,
         count(*) filter (where b.status in ('PENDING', 'PARTIAL', 'OVERDUE'))          as open_payments,
         min(b.due_date) filter (where b.status in ('PENDING', 'PARTIAL', 'OVERDUE'))   as next_due_date
  from public.payment_balances b
  where b.financial_agreement_id = f.id
) t on true;

-- A receber (064): `in_process_totals` falso também em rascunho.
create or replace view public.finance_receivables
with (security_invoker = true)
as
select
  b.payment_id,
  b.financial_agreement_id,
  b.legal_case_id,
  f.legal_process_id,
  f.status                                 as agreement_status,
  b.amount,
  b.received_amount,
  b.balance,
  b.currency,
  b.due_date,
  b.status,
  case when b.status = 'OVERDUE' then (now() at time zone 'America/Sao_Paulo')::date - b.due_date end as days_overdue,
  pay.payment_type,
  pay.description,
  c.client_id,
  coalesce(icd.full_name, ccd.legal_name)  as client_name,
  c.title                                  as case_title,
  case when p.id is not null then coalesce(nullif(btrim(p.title), ''), c.title) end as process_title,
  p.cnj_number,
  (p.id is not null and p.deleted_at is null and f.status <> 'DRAFT') as in_process_totals
from public.payment_balances b
join public.payments pay on pay.id = b.payment_id
join public.financial_agreements f on f.id = b.financial_agreement_id
left join public.legal_cases c on c.id = f.legal_case_id
left join public.legal_processes p on p.id = f.legal_process_id
left join public.individual_client_details icd on icd.client_id = c.client_id
left join public.company_client_details ccd on ccd.client_id = c.client_id
where b.status in ('PENDING', 'PARTIAL', 'OVERDUE')
  and b.balance > 0;

-- Totais do "a receber": contratos ativos (padrão) ou só os em rascunho
-- (`p_drafts`), com os MESMOS filtros da lista; `draft_*` = a parte em
-- rascunho com os mesmos filtros, para a tela avisar.
drop function if exists public.finance_receivables_totals(date, date, boolean, text, text);
create or replace function public.finance_receivables_totals(
  p_from         date default null,
  p_to           date default null,
  p_overdue_only boolean default false,
  p_search       text default null,
  p_cnj_prefix   text default null,
  p_drafts       boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'count',          count(*) filter (where x.listed),
    'total',          coalesce(sum(s.balance) filter (where x.listed), 0)::numeric(14,2),
    'overdue',        coalesce(sum(s.balance) filter (where x.listed and s.status = 'OVERDUE'), 0)::numeric(14,2),
    'overdue_count',  count(*) filter (where x.listed and s.status = 'OVERDUE'),
    'outside_totals', coalesce(sum(s.balance) filter (where x.listed and not x.draft and not s.in_process_totals), 0)::numeric(14,2),
    'draft_total',    coalesce(sum(s.balance) filter (where x.draft), 0)::numeric(14,2),
    'draft_count',    count(*) filter (where x.draft))
  from public.finance_receivables s
  cross join lateral (select s.agreement_status = 'DRAFT' as draft,
                             (s.agreement_status = 'DRAFT') = coalesce(p_drafts, false) as listed) x
  where (p_from is null or s.due_date >= p_from)
    and (p_to is null or s.due_date <= p_to)
    and (not coalesce(p_overdue_only, false) or s.status = 'OVERDUE')
    and (p_search is null or s.client_name ilike p_search or s.process_title ilike p_search or s.case_title ilike p_search)
    and (p_cnj_prefix is null or s.cnj_number like p_cnj_prefix || '%')
$$;

-- Visão geral (064): `totals` e `outside` sem rascunho; `draft` à parte.
create or replace function public.finance_summary(p_months integer default 12)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_months  integer := least(greatest(coalesce(p_months, 12), 1), 36);
  v_today   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_first   timestamp := date_trunc('month', v_today::timestamp) - make_interval(months => v_months - 1);
  v_totals  jsonb;
  v_status  jsonb;
  v_monthly jsonb;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Somente ADMIN interno vê o financeiro' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'totals', jsonb_build_object(
      'contracted',    coalesce(sum(b.amount) filter (where x.inside and b.status <> 'CANCELLED'), 0)::numeric(14,2),
      'received',      coalesce(sum(b.received_amount) filter (where x.inside), 0)::numeric(14,2),
      'outstanding',   coalesce(sum(b.balance) filter (where x.inside and x.open), 0)::numeric(14,2),
      'overdue',       coalesce(sum(b.balance) filter (where x.inside and b.status = 'OVERDUE'), 0)::numeric(14,2),
      'open_payments', count(*) filter (where x.inside and x.open)),
    'outside', jsonb_build_object(
      'contracted',    coalesce(sum(b.amount) filter (where x.outside and b.status <> 'CANCELLED'), 0)::numeric(14,2),
      'received',      coalesce(sum(b.received_amount) filter (where x.outside), 0)::numeric(14,2),
      'outstanding',   coalesce(sum(b.balance) filter (where x.outside and x.open), 0)::numeric(14,2),
      'overdue',       coalesce(sum(b.balance) filter (where x.outside and b.status = 'OVERDUE'), 0)::numeric(14,2),
      'open_payments', count(*) filter (where x.outside and x.open)),
    'draft', jsonb_build_object(
      'contracted',    coalesce(sum(b.amount) filter (where x.draft and b.status <> 'CANCELLED'), 0)::numeric(14,2),
      'received',      coalesce(sum(b.received_amount) filter (where x.draft), 0)::numeric(14,2),
      'outstanding',   coalesce(sum(b.balance) filter (where x.draft and x.open), 0)::numeric(14,2),
      'overdue',       coalesce(sum(b.balance) filter (where x.draft and b.status = 'OVERDUE'), 0)::numeric(14,2),
      'open_payments', count(*) filter (where x.draft and x.open)))
    into v_totals
  from public.payment_balances b
  join public.financial_agreements f on f.id = b.financial_agreement_id
  left join public.legal_processes p on p.id = f.legal_process_id and p.deleted_at is null
  cross join lateral (select f.status = 'DRAFT' as draft,
                             f.status <> 'DRAFT' and p.id is not null as inside,
                             f.status <> 'DRAFT' and p.id is null as outside,
                             b.status in ('PENDING', 'PARTIAL', 'OVERDUE') as open) x;

  select jsonb_build_object(
    'DRAFT',     count(*) filter (where f.status = 'DRAFT'),
    'ACTIVE',    count(*) filter (where f.status = 'ACTIVE'),
    'COMPLETED', count(*) filter (where f.status = 'COMPLETED'),
    'CANCELLED', count(*) filter (where f.status = 'CANCELLED'))
    into v_status
  from public.financial_agreements f;

  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'amount', coalesce(s.amount, 0)::numeric(14,2)) order by m.month), '[]'::jsonb)
    into v_monthly
  from generate_series(v_first, date_trunc('month', v_today::timestamp), interval '1 month') as m(month)
  left join lateral (
    select sum(r.amount) as amount
    from public.payment_receipts r
    where r.occurred_at >= (m.month at time zone 'America/Sao_Paulo')
      and r.occurred_at < ((m.month + interval '1 month') at time zone 'America/Sao_Paulo')
  ) s on true;

  return v_totals || jsonb_build_object('agreements_by_status', v_status, 'monthly', v_monthly);
end
$$;

-- Despesas (sugestão dos testes): total do período com os MESMOS filtros da
-- lista (processo, categoria, situação, período pela data da despesa).
-- Cancelada só entra quando a lista mostra as canceladas.
create or replace function public.finance_expenses_totals(
  p_process_id uuid default null,
  p_category   text default null,
  p_status     text default null,
  p_from       date default null,
  p_to         date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'count', count(*),
    'total', coalesce(sum(e.amount), 0)::numeric(14,2),
    'paid',  coalesce(sum(e.amount) filter (where e.cancelled_at is null and e.paid_on is not null), 0)::numeric(14,2),
    'open',  coalesce(sum(e.amount) filter (where e.cancelled_at is null and e.paid_on is null), 0)::numeric(14,2))
  from public.process_expenses e
  where (p_process_id is null or e.legal_process_id = p_process_id)
    and (p_category is null or e.category = p_category)
    and (case coalesce(p_status, '')
           when 'CANCELLED' then e.cancelled_at is not null
           when 'PAID'      then e.cancelled_at is null and e.paid_on is not null
           when 'OPEN'      then e.cancelled_at is null and e.paid_on is null
           else e.cancelled_at is null
         end)
    and (p_from is null or e.incurred_on >= p_from)
    and (p_to is null or e.incurred_on <= p_to)
$$;

-- ═════════════════════════════ 4. permissões ══════════════════════════════

-- Função de gatilho: ninguém chama direto.
revoke all on function private.agent_proposals_corrected_deadline_checked() from public, anon, authenticated, service_role;
-- Exportação: pública (invoker) → privada (definer); a privada confere o papel.
revoke all on function private.record_personal_data_export(uuid, text, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.record_personal_data_export(uuid, text, uuid[]) from public, anon, service_role;
grant execute on function private.record_personal_data_export(uuid, text, uuid[]) to authenticated;
grant execute on function public.record_personal_data_export(uuid, text, uuid[]) to authenticated;
-- Financeiro: views só leitura (a RLS das tabelas de origem vale: só ADMIN vê dinheiro).
revoke all on public.process_finance_overview from public, anon;
grant select on public.process_finance_overview to authenticated, service_role;
revoke all on public.finance_agreement_list from public, anon;
grant select on public.finance_agreement_list to authenticated, service_role;
revoke all on public.finance_receivables from public, anon;
grant select on public.finance_receivables to authenticated, service_role;
revoke all on function public.finance_receivables_totals(date, date, boolean, text, text, boolean) from public, anon;
grant execute on function public.finance_receivables_totals(date, date, boolean, text, text, boolean) to authenticated;
revoke all on function public.finance_summary(integer) from public, anon;
grant execute on function public.finance_summary(integer) to authenticated;
revoke all on function public.finance_expenses_totals(uuid, text, text, date, date) from public, anon;
grant execute on function public.finance_expenses_totals(uuid, text, text, date, date) to authenticated;
