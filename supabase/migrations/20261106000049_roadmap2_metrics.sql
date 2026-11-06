-- DG Brasil — 049: Roadmap 2.0, bloco 8 — indicadores (KPIs) e séries
--
-- Pedido da Barbara (2026-11-06): o site está "seco"; quer números e gráficos
-- em todas as abas (Início, Clientes, Casos, Processos, Financeiro, Parceiros
-- e o portal do parceiro), com filtro de período ("quanto entrou na última
-- semana", "quanto passou, quanto não passou").
--
-- Uma consulta por tela, somada no banco. SECURITY INVOKER: cada número
-- respeita a RLS de quem pede — o parceiro vê só o próprio escritório, o
-- LAWYER não vê dinheiro (as tabelas financeiras são só do ADMIN), e nada
-- precisa ser filtrado no navegador.
--
--   get_dashboard_metrics(p_from, p_to)  → jsonb com clientes, casos,
--   processos, prazos, revisões, tarefas, financeiro e as séries por semana
--   (período até 120 dias) ou por mês.
--
-- 001–048 não são alteradas.

create or replace function public.get_dashboard_metrics(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_to    date := coalesce(p_to, (now() at time zone 'America/Sao_Paulo')::date);
  v_from  date := coalesce(p_from, v_to - 29);
  v_start timestamptz;
  v_end   timestamptz;
  v_unit  text;
  v_out   jsonb;
begin
  if v_from > v_to then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  v_start := (v_from::timestamp at time zone 'America/Sao_Paulo');
  v_end   := ((v_to + 1)::timestamp at time zone 'America/Sao_Paulo');
  v_unit  := case when v_to - v_from <= 120 then 'week' else 'month' end;

  with
  cl as (select c.id, c.kind, c.acquisition_channel, c.origin_organization_id, c.created_at, c.status
           from public.clients c where c.deleted_at is null),
  ca as (select c.id, c.status, c.acquisition_channel, c.origin_organization_id, c.legal_area_id, c.created_at,
                c.submitted_at, c.accepted_at, c.rejected_at
           from public.legal_cases c where c.deleted_at is null),
  pr as (select p.id, p.status, p.phase, p.case_value, p.created_at, p.distribution_date
           from public.legal_processes p where p.deleted_at is null),
  buckets as (
    select generate_series(date_trunc(v_unit, v_from::timestamp), date_trunc(v_unit, v_to::timestamp),
                           ('1 ' || v_unit)::interval)::date as b
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'unit', v_unit),
    'clients', jsonb_build_object(
      'total',        (select count(*) from cl),
      'active',       (select count(*) from cl where status = 'ACTIVE'),
      'new',          (select count(*) from cl where created_at >= v_start and created_at < v_end),
      'by_kind',      coalesce((select jsonb_object_agg(kind, n) from (select kind::text, count(*) n from cl group by kind) x), '{}'),
      'by_channel',   coalesce((select jsonb_agg(jsonb_build_object('key', coalesce(acquisition_channel, 'NONE'), 'total', n) order by n desc)
                                  from (select acquisition_channel, count(*) n from cl
                                         where created_at >= v_start and created_at < v_end group by 1) x), '[]'),
      'by_origin',    coalesce((select jsonb_agg(jsonb_build_object('key', origin_organization_id, 'name', o.name, 'total', n) order by n desc)
                                  from (select origin_organization_id, count(*) n from cl
                                         where created_at >= v_start and created_at < v_end group by 1) x
                                  left join public.organizations o on o.id = x.origin_organization_id), '[]')),
    'cases', jsonb_build_object(
      'total',        (select count(*) from ca),
      'new',          (select count(*) from ca where created_at >= v_start and created_at < v_end),
      'accepted',     (select count(*) from ca where accepted_at >= v_start and accepted_at < v_end),
      'rejected',     (select count(*) from ca where rejected_at >= v_start and rejected_at < v_end),
      'awaiting',     (select count(*) from ca where status in ('SUBMITTED', 'WAITING_DOCUMENTS')),
      'in_analysis',  (select count(*) from ca where status in ('READY_FOR_ANALYSIS', 'ANALYZING', 'WAITING_REVIEW')),
      'active',       (select count(*) from ca where status in ('ACCEPTED', 'IN_PROGRESS')),
      'by_status',    coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from ca group by status) x), '{}'),
      'by_channel',   coalesce((select jsonb_agg(jsonb_build_object('key', coalesce(acquisition_channel, 'NONE'), 'total', n) order by n desc)
                                  from (select acquisition_channel, count(*) n from ca
                                         where created_at >= v_start and created_at < v_end group by 1) x), '[]'),
      'by_origin',    coalesce((select jsonb_agg(jsonb_build_object('key', origin_organization_id, 'name', o.name, 'total', n) order by n desc)
                                  from (select origin_organization_id, count(*) n from ca
                                         where created_at >= v_start and created_at < v_end group by 1) x
                                  left join public.organizations o on o.id = x.origin_organization_id), '[]'),
      'by_area',      coalesce((select jsonb_agg(jsonb_build_object('key', a.code, 'name', a.name, 'total', n) order by n desc)
                                  from (select legal_area_id, count(*) n from ca group by 1) x
                                  join public.legal_areas a on a.id = x.legal_area_id), '[]')),
    'processes', jsonb_build_object(
      'total',        (select count(*) from pr),
      'active',       (select count(*) from pr where status not in ('RECEIVED', 'ARCHIVED')),
      'new',          (select count(*) from pr where created_at >= v_start and created_at < v_end),
      'distributed',  (select count(*) from pr where distribution_date between v_from and v_to),
      'case_value_total', coalesce((select sum(case_value) from pr where status not in ('ARCHIVED')), 0),
      'by_status',    coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from pr group by status) x), '{}'),
      'by_phase',     coalesce((select jsonb_object_agg(coalesce(phase, 'NONE'), n) from (select phase, count(*) n from pr group by phase) x), '{}')),
    'deadlines', jsonb_build_object(
      'overdue',      (select count(*) from public.deadlines d where d.status = 'OPEN' and d.due_at < now()),
      'next_7_days',  (select count(*) from public.deadlines d where d.status = 'OPEN' and d.due_at >= now() and d.due_at < now() + interval '7 days'),
      'completed',    (select count(*) from public.deadlines d where d.status = 'COMPLETED' and d.completed_at >= v_start and d.completed_at < v_end)),
    'reviews', jsonb_build_object(
      'pending',      (select count(*) from public.reviews r where r.status in ('PENDING', 'REOPENED')),
      'decided',      (select count(*) from public.reviews r where r.decided_at >= v_start and r.decided_at < v_end)),
    'tasks', jsonb_build_object(
      'open',         (select count(*) from public.process_tasks t where t.status in ('OPEN', 'QUEUED', 'IN_PROGRESS')),
      'in_review',    (select count(*) from public.process_tasks t where t.status = 'IN_REVIEW'),
      'done',         (select count(*) from public.process_tasks t where t.status = 'DONE' and t.completed_at >= v_start and t.completed_at < v_end)),
    'finance', jsonb_build_object(
      'received',     coalesce((select sum(r.amount) from public.payment_receipts r where r.occurred_at >= v_start and r.occurred_at < v_end), 0),
      'expenses_paid', coalesce((select sum(e.amount) from public.process_expenses e
                                  where e.cancelled_at is null and e.paid_on between v_from and v_to), 0),
      'partner_share', coalesce((select sum(al.partner_amount) from public.partner_revenue_allocations al
                                  where al.created_at >= v_start and al.created_at < v_end), 0)),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
               'bucket', b,
               'clients',   (select count(*) from cl where date_trunc(v_unit, (cl.created_at at time zone 'America/Sao_Paulo'))::date = b
                               and cl.created_at >= v_start and cl.created_at < v_end),
               'cases',     (select count(*) from ca where date_trunc(v_unit, (ca.created_at at time zone 'America/Sao_Paulo'))::date = b
                               and ca.created_at >= v_start and ca.created_at < v_end),
               'accepted',  (select count(*) from ca where date_trunc(v_unit, (ca.accepted_at at time zone 'America/Sao_Paulo'))::date = b
                               and ca.accepted_at >= v_start and ca.accepted_at < v_end),
               'processes', (select count(*) from pr where date_trunc(v_unit, (pr.created_at at time zone 'America/Sao_Paulo'))::date = b
                               and pr.created_at >= v_start and pr.created_at < v_end),
               'received',  coalesce((select sum(r.amount) from public.payment_receipts r
                               where date_trunc(v_unit, (r.occurred_at at time zone 'America/Sao_Paulo'))::date = b
                                 and r.occurred_at >= v_start and r.occurred_at < v_end), 0),
               'expenses',  coalesce((select sum(e.amount) from public.process_expenses e
                               where e.cancelled_at is null and date_trunc(v_unit, e.paid_on::timestamp)::date = b
                                 and e.paid_on between v_from and v_to), 0),
               'partner_share', coalesce((select sum(al.partner_amount) from public.partner_revenue_allocations al
                               where date_trunc(v_unit, (al.created_at at time zone 'America/Sao_Paulo'))::date = b
                                 and al.created_at >= v_start and al.created_at < v_end), 0))
             order by b)
      from buckets), '[]')
  ) into v_out;
  return v_out;
end
$$;

comment on function public.get_dashboard_metrics(date, date) is
  'Indicadores e séries do período (semana até 120 dias, senão mês), com a RLS de quem pede. Início, listas e portal do parceiro.';

revoke all on function public.get_dashboard_metrics(date, date) from public, anon;
grant execute on function public.get_dashboard_metrics(date, date) to authenticated;
