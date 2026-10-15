-- 035 — Financeiro: cronograma de parcelas, valores da parceria e
-- "contratado por modelo" (Etapa 4.3.1)
--
-- Nada aqui toca o ledger conceitual: o cronograma cria OBRIGAÇÕES (payments);
-- recebimento, divisão com o parceiro e repasse continuam nascendo só quando
-- o dinheiro entra (payment_receipts → partner_revenue_allocations →
-- partner_transfers). As duas views são somas de leitura, com a mesma RLS das
-- tabelas (security_invoker): não abrem acesso nenhum.

-- ───────────────────────────── 1. cronograma de parcelas ──────────────────
--
-- create_payment_schedule_once(chave, acordo, total, quantidade, 1º vencimento,
-- periodicidade, tipo, descrição): N obrigações numa transação — todas ou
-- nenhuma. O servidor/banco é a fonte do cálculo: o navegador só mostra uma
-- prévia com a MESMA regra.
--
-- Regra de centavos (determinística, documentada): total em centavos (sem
-- fração de centavo); cada parcela = total ÷ N (divisão inteira); o RESTO vai
-- para as PRIMEIRAS parcelas, um centavo em cada. Ex.: R$ 100,00 em 3 →
-- 33,34 + 33,33 + 33,33. A soma é sempre exatamente o total.
--
-- Vencimentos: mensal = 1º vencimento + (i−1) meses, sempre a partir do 1º
-- (31/01 → 28/02 → 31/03: o dia é preservado quando o mês permite);
-- quinzenal = +14 dias; semanal = +7 dias.
--
-- Só ADMIN (a guarda de payments confere de novo), só acordo DRAFT/ACTIVE
-- (030). Mesma chave = mesmo cronograma (027); clique duplo não gera dois.

create or replace function private.payment_schedule_amounts(p_total numeric, p_count integer)
returns numeric[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_cents bigint;
  v_base  bigint;
  v_rest  bigint;
  v_out   numeric[] := '{}';
begin
  if p_count is null or p_count < 1 then
    raise exception 'Quantidade de parcelas inválida' using errcode = '22023';
  end if;
  if p_total is null or p_total <= 0 then
    raise exception 'Informe um total maior que zero' using errcode = '22023';
  end if;
  v_cents := round(p_total * 100);
  if v_cents::numeric <> p_total * 100 then
    raise exception 'O total não pode ter fração de centavo' using errcode = '22023';
  end if;
  if v_cents < p_count then
    raise exception 'Cada parcela precisa de pelo menos R$ 0,01' using errcode = '22023';
  end if;
  v_base := v_cents / p_count;
  v_rest := v_cents % p_count;
  for i in 1..p_count loop
    v_out := v_out || ((v_base + case when i <= v_rest then 1 else 0 end)::numeric / 100);
  end loop;
  return v_out;
end
$$;

create or replace function private.payment_schedule_due(p_first date, p_frequency text, p_index integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_frequency
    when 'MONTHLY'  then (p_first + make_interval(months => p_index - 1))::date
    when 'BIWEEKLY' then p_first + 14 * (p_index - 1)
    when 'WEEKLY'   then p_first + 7 * (p_index - 1)
  end
$$;

create or replace function private.create_payment_schedule_once(
  p_key          uuid,
  p_agreement_id uuid,
  p_total        numeric,
  p_count        integer,
  p_first_due    date,
  p_frequency    text,
  p_payment_type text,
  p_description  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev     jsonb;
  v_agr      record;
  v_amounts  numeric[];
  v_label    text := coalesce(nullif(btrim(p_description), ''), 'Parcela');
  v_ids      uuid[] := '{}';
  v_id       uuid;
  v_response jsonb;
begin
  if auth.uid() is null or not exists (select 1 from private.current_membership()) then
    raise exception 'Sem sessão liberada' using errcode = '42501';
  end if;
  if not private.is_admin() then
    raise exception 'Somente ADMIN interno opera o financeiro' using errcode = '42501';
  end if;

  v_prev := private.idempotency_begin('payment_schedule.create', p_key, jsonb_build_object(
    'agreement_id', p_agreement_id, 'total', p_total, 'count', p_count, 'first_due', p_first_due,
    'frequency', p_frequency, 'payment_type', p_payment_type, 'description', v_label));
  if v_prev is not null then
    return (v_prev -> 'response') || jsonb_build_object('deduplicated', true);
  end if;

  if p_count > 120 then
    raise exception 'No máximo 120 parcelas por cronograma' using errcode = '22023';
  end if;
  if p_frequency is null or p_frequency not in ('MONTHLY', 'BIWEEKLY', 'WEEKLY') then
    raise exception 'Periodicidade inválida' using errcode = '22023';
  end if;
  if p_payment_type is null or p_payment_type not in ('FIXED', 'MONTHLY', 'OTHER') then
    raise exception 'Tipo de parcela inválido' using errcode = '22023';
  end if;
  if p_first_due is null then
    raise exception 'Informe o primeiro vencimento' using errcode = '22023';
  end if;
  if length(v_label) > 120 then
    raise exception 'Descrição longa demais' using errcode = '22023';
  end if;
  v_amounts := private.payment_schedule_amounts(p_total, p_count);

  -- Trava o acordo: concluir/cancelar no meio espera o cronograma terminar.
  select f.id, f.status, f.currency into v_agr
  from public.financial_agreements f where f.id = p_agreement_id
  for update;
  if not found then
    raise exception 'Acordo não encontrado' using errcode = 'P0002';
  end if;
  if v_agr.status not in ('DRAFT', 'ACTIVE') then
    raise exception 'Acordo concluído ou cancelado não recebe obrigação nova' using errcode = '23514';
  end if;

  for i in 1..p_count loop
    insert into public.payments (financial_agreement_id, amount, currency, due_date, payment_type, description)
    values (p_agreement_id, v_amounts[i], v_agr.currency, private.payment_schedule_due(p_first_due, p_frequency, i),
            p_payment_type, format('%s %s/%s', v_label, i, p_count))
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  perform private.record_audit_event('PAYMENT_SCHEDULE_CREATED', 'financial_agreements', p_agreement_id,
    jsonb_build_object('count', p_count, 'frequency', p_frequency, 'payment_type', p_payment_type,
                       'first_due', p_first_due, 'payment_ids', to_jsonb(v_ids)));

  v_response := jsonb_build_object('agreement_id', p_agreement_id, 'payment_ids', to_jsonb(v_ids), 'count', p_count);
  perform private.idempotency_complete('payment_schedule.create', p_key, 'financial_agreements', p_agreement_id, v_response);
  return v_response || jsonb_build_object('deduplicated', false);
end
$$;

create or replace function public.create_payment_schedule_once(
  p_key uuid, p_agreement_id uuid, p_total numeric, p_count integer, p_first_due date,
  p_frequency text, p_payment_type text, p_description text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_payment_schedule_once(p_key, p_agreement_id, p_total, p_count, p_first_due,
                                               p_frequency, p_payment_type, p_description)
$$;

revoke all on function private.payment_schedule_amounts(numeric, integer) from public, anon, service_role;
revoke all on function private.payment_schedule_due(date, text, integer) from public, anon, service_role;
grant execute on function private.payment_schedule_amounts(numeric, integer) to authenticated;
grant execute on function private.payment_schedule_due(date, text, integer) to authenticated;
revoke all on function private.create_payment_schedule_once(uuid, uuid, numeric, integer, date, text, text, text) from public, anon, service_role;
grant execute on function private.create_payment_schedule_once(uuid, uuid, numeric, integer, date, text, text, text) to authenticated;
revoke all on function public.create_payment_schedule_once(uuid, uuid, numeric, integer, date, text, text, text) from public, anon;
grant execute on function public.create_payment_schedule_once(uuid, uuid, numeric, integer, date, text, text, text) to authenticated;

-- ───────────────────────────── 2. valores da parceria (leitura) ──────────
-- Por acordo de parceria (snapshot): receita ELEGÍVEL (soma líquida dos
-- lançamentos divididos sob este acordo, estornos inclusos), participação
-- calculada do parceiro e parte do escritório — derivadas de
-- partner_revenue_allocations, que o banco gera. Não há como "digitar" valor
-- do parceiro: não existe escrita aqui. Mesma RLS das tabelas de origem:
-- ADMIN vê todos; PARTNER_ADMIN só os do próprio escritório; PARTNER_USER,
-- nada.

create view public.partner_agreement_share_totals
with (security_invoker = true)
as
select
  a.id as case_partnership_agreement_id,
  a.partner_organization_id,
  a.legal_case_id,
  coalesce(sum(al.base_amount), 0)::numeric(14,2)    as eligible_revenue,
  coalesce(sum(al.partner_amount), 0)::numeric(14,2) as partner_share,
  coalesce(sum(al.owner_amount), 0)::numeric(14,2)   as owner_share,
  count(al.id) filter (where al.reverses_allocation_id is null)::int as receipt_count
from public.case_partnership_agreements a
left join public.partner_revenue_allocations al on al.case_partnership_agreement_id = a.id
group by a.id, a.partner_organization_id, a.legal_case_id;

comment on view public.partner_agreement_share_totals is
  'Valores da parceria por acordo (receita elegível, participação, parte do escritório), derivados do ledger. Só leitura.';

revoke all on public.partner_agreement_share_totals from public, anon;
grant select on public.partner_agreement_share_totals to authenticated, service_role;

-- ───────────────────────────── 3. contratado por modelo ───────────────────
-- Para o gráfico da visão geral: por modelo de honorários (sem modelo =
-- "valores próprios"), quantos acordos não cancelados e quanto contratado —
-- a soma das obrigações não canceladas (o mesmo "Contratado" da lista de
-- contratos). Somado no banco: o navegador não baixa contratos para agrupar.
-- Só ADMIN (RLS de financial_agreements/payments/fee_models).

create view public.financial_contracted_by_fee_model
with (security_invoker = true)
as
select
  f.fee_model_id,
  fm.name as fee_model_name,
  count(distinct f.id)::int as agreement_count,
  coalesce(sum(p.amount) filter (where p.cancelled_at is null), 0)::numeric(14,2) as contracted_amount
from public.financial_agreements f
left join public.fee_models fm on fm.id = f.fee_model_id
left join public.payments p on p.financial_agreement_id = f.id
where f.status <> 'CANCELLED'
group by f.fee_model_id, fm.name;

comment on view public.financial_contracted_by_fee_model is
  'Contratado (obrigações não canceladas) e quantidade de acordos não cancelados, por modelo de honorários.';

revoke all on public.financial_contracted_by_fee_model from public, anon;
grant select on public.financial_contracted_by_fee_model to authenticated, service_role;
