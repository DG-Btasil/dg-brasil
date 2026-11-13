-- 064 · Financeiro: correções da revisão final antes da produção.
--
-- Erro aqui é erro em dinheiro, num livro que não aceita edição. Cada regra
-- abaixo fecha um achado da revisão e tem conferência em tests/verificar.mjs.
--
--   1. Estorno depois de concluir o contrato. Até a 046, estorno e ajuste para
--      menos valiam em qualquer situação do contrato (030), mas a parcela de um
--      contrato concluído não pode mais ser alterada nem cancelada: o saldo
--      ficava "em aberto / em atraso" para sempre, sem caminho de volta.
--      Escolha (a mais simples e a mais segura): TODO lançamento do livro exige
--      contrato ATIVO, e contrato concluído ou cancelado pode ser REABERTO pelo
--      ADMIN, com motivo, auditado (FINANCIAL_AGREEMENT_REOPENED). Reaberto, é
--      um contrato ativo como outro: estorna, recebe de novo ou cancela a
--      parcela, e conclui outra vez. Assim a regra que já existia continua
--      verdadeira sempre: contrato concluído ou cancelado não tem parcela em
--      aberto. A alternativa (deixar estornar e cancelar a parcela depois)
--      criava um estado sem saída para receber de novo e dependia de alguém
--      lembrar de cancelar a parcela.
--        - Só a situação e os dados da reabertura mudam na reabertura; os
--          termos continuam congelados.
--        - O índice "um contrato ativo por processo" (046) vale na reabertura:
--          se o processo já tem outro contrato ativo, a reabertura é recusada.
--   2. Ajuste para menos sem lançamento original. A divisão de um ajuste sem
--      original nascia no acordo de parceria vigente no momento (ou em nenhum),
--      e não no do recebimento corrigido: a parte do parceiro ficava errada.
--      Agora ajuste para menos exige o lançamento que ele corrige.
--   3. Cancelar parcela com recebimento só era barrado no servidor do painel:
--      duas pessoas ao mesmo tempo passavam. Agora a guarda da parcela recusa.
--   4. Repasse acima do saldo real do parceiro. O laço da 026 tratava divisão
--      negativa como zero e seguia para a próxima: recebe 1.000 a 30%, repassa
--      300, estorna, recebe outros 1.000 e o sistema aceitava mais 300 (600
--      pagos para 300 devidos). Agora o repasse é recusado quando passa da soma
--      LÍQUIDA das divisões do parceiro, contando as negativas. Restrito a um
--      caso, vale o menor entre o líquido do caso e o líquido do parceiro.
--   5. Listas com filtro no banco: contratos (cliente, período, vencimento),
--      extrato de recebimentos por período (com total) e parcelas a receber.
--      Views security_invoker: a RLS das tabelas de origem continua valendo
--      (só ADMIN vê dinheiro).
--   6. Totais da visão geral somados no banco (public.finance_summary), na
--      mesma conta dos totais por processo (046). A Home e o Financeiro leem
--      daqui: o "em aberto" é o mesmo número nos dois lugares. O que fica fora
--      dessa conta (contrato antigo, ligado só ao caso, ou de processo
--      excluído) vem separado, para as duas telas avisarem do mesmo jeito.
--   7. Despesa com chave de idempotência (clique duplo não lança duas).
--
-- Vocabulário das mensagens novas: "contrato" e "parcela" (o que a pessoa lê na
-- tela). Tabelas e colunas não mudam de nome.
--
-- 001–061 não são alteradas. Funções redefinidas aqui partem da definição mais
-- recente: financial_agreements_guard (046), payment_receipts_guard e
-- payments_guard (011), payment_receipts_require_active_agreement (030) e
-- create_partner_transfer (026).

-- ───────────────────────────── 1. reabrir contrato ───────────────────────

alter table public.financial_agreements
  add column reopened_at   timestamptz,
  add column reopened_by   uuid references public.profiles (id) on delete restrict,
  add column reopen_reason text;

alter table public.financial_agreements
  add constraint financial_agreements_reopen_has_reason
  check (reopened_at is null or (nullif(btrim(reopen_reason), '') is not null and length(reopen_reason) <= 500));

comment on column public.financial_agreements.reopened_at is
  'Última reabertura (concluído ou cancelado → ativo). Motivo em reopen_reason; cada reabertura fica na auditoria.';

create or replace function private.financial_agreements_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := coalesce(auth.uid(), nullif(current_setting('dg.actor_user_id', true), '')::uuid);
  v_reopen text[] := array['status', 'reopened_at', 'reopened_by', 'reopen_reason', 'updated_at'];
begin
  -- Autorização antes de qualquer regra (a guarda roda antes do WITH CHECK da RLS).
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Somente ADMIN interno opera o financeiro' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('DRAFT', 'ACTIVE') then
      raise exception 'Contrato nasce em rascunho ou ativo' using errcode = '23514';
    end if;
    -- Roadmap 2.0 (046): contrato novo é sempre de um processo.
    if new.legal_process_id is null then
      raise exception 'O contrato de honorários é do processo: informe o processo' using errcode = '23514';
    end if;
    if exists (select 1 from public.legal_processes p where p.id = new.legal_process_id and p.deleted_at is not null) then
      raise exception 'Processo excluído não recebe contrato' using errcode = '23514';
    end if;
    if new.reopened_at is not null or new.reopened_by is not null or new.reopen_reason is not null then
      raise exception 'Contrato novo não nasce reaberto' using errcode = '23514';
    end if;
    new.created_by := coalesce(new.created_by, v_actor);
    return new;
  end if;

  if new.legal_case_id is distinct from old.legal_case_id then
    raise exception 'Contrato não muda de caso' using errcode = '23514';
  end if;
  -- Processo: só se define uma vez (contrato antigo sem processo pode ser ligado).
  if old.legal_process_id is not null and new.legal_process_id is distinct from old.legal_process_id then
    raise exception 'Contrato não muda de processo' using errcode = '23514';
  end if;

  -- Concluído ou cancelado é histórico. A única mudança possível é a
  -- REABERTURA (064): volta a ativo, com motivo. Nada mais muda junto.
  if old.status in ('COMPLETED', 'CANCELLED') then
    if new.status <> 'ACTIVE' or (to_jsonb(new) - v_reopen) <> (to_jsonb(old) - v_reopen) then
      raise exception 'Contrato concluído ou cancelado é histórico: para mudar, reabra o contrato' using errcode = '23514';
    end if;
    -- Quem reabre manda o motivo e a data: sem os dois, não é uma reabertura pedida.
    if nullif(btrim(coalesce(new.reopen_reason, '')), '') is null
       or new.reopened_at is null or new.reopened_at is not distinct from old.reopened_at then
      raise exception 'Informe o motivo para reabrir o contrato' using errcode = '23514';
    end if;
    if length(btrim(new.reopen_reason)) > 500 then
      raise exception 'O motivo da reabertura tem no máximo 500 caracteres' using errcode = '23514';
    end if;
    new.reopen_reason := btrim(new.reopen_reason);
    new.reopened_at := now();
    new.reopened_by := v_actor;
    return new;
  end if;

  if new.reopened_at is distinct from old.reopened_at
     or new.reopened_by is distinct from old.reopened_by
     or new.reopen_reason is distinct from old.reopen_reason then
    raise exception 'Os dados da reabertura só mudam ao reabrir o contrato' using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'DRAFT' and new.status in ('ACTIVE', 'CANCELLED'))
         or (old.status = 'ACTIVE' and new.status in ('COMPLETED', 'CANCELLED'))) then
      raise exception 'Esta mudança de situação do contrato não é permitida' using errcode = '23514';
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
    raise exception 'Só o rascunho do contrato pode ter os termos alterados' using errcode = '23514';
  end if;

  if new.status in ('COMPLETED', 'CANCELLED') and new.status is distinct from old.status then
    if exists (
      select 1
      from public.payments p
      where p.financial_agreement_id = new.id
        and p.cancelled_at is null
        and p.amount > coalesce((select sum(r.amount) from public.payment_receipts r where r.payment_id = p.id), 0)
    ) then
      raise exception 'Há parcelas em aberto neste contrato: registre o recebimento ou cancele-as antes' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

-- Cada reabertura na trilha de auditoria, com o motivo e de onde o contrato
-- voltou (a coluna guarda só a última). Depois da gravação: se a reabertura for
-- recusada (ex.: outro contrato ativo no processo), nada fica registrado.
create or replace function private.financial_agreements_reopen_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_audit_event('FINANCIAL_AGREEMENT_REOPENED', 'financial_agreements', new.id,
    jsonb_build_object('legal_case_id', new.legal_case_id, 'legal_process_id', new.legal_process_id,
                       'from_status', old.status, 'status', new.status, 'reason', new.reopen_reason));
  return null;
end
$$;

drop trigger if exists financial_agreements_reopen_audit on public.financial_agreements;
create trigger financial_agreements_reopen_audit
  after update of status on public.financial_agreements
  for each row
  when (old.status in ('COMPLETED', 'CANCELLED') and new.status = 'ACTIVE')
  execute function private.financial_agreements_reopen_audit();

-- Todo lançamento do livro exige contrato ATIVO (antes: só as entradas).
create or replace function private.payment_receipts_require_active_agreement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  -- Trava o contrato (FOR SHARE): concluir, cancelar ou reabrir espera este lançamento, e vice-versa.
  select a.status into v_status
  from public.payments p
  join public.financial_agreements a on a.id = p.financial_agreement_id
  where p.id = new.payment_id
  for share of a;
  if v_status = 'ACTIVE' then
    return new;
  end if;
  if new.amount > 0 then
    raise exception 'Ative o contrato antes de registrar recebimentos' using errcode = '23514';
  end if;
  if v_status = 'COMPLETED' then
    raise exception 'Este contrato está concluído. Reabra o contrato antes de registrar estorno ou ajuste' using errcode = '23514';
  end if;
  if v_status = 'CANCELLED' then
    raise exception 'Este contrato está cancelado. Reabra o contrato antes de registrar estorno ou ajuste' using errcode = '23514';
  end if;
  raise exception 'Ative o contrato antes de registrar estorno ou ajuste' using errcode = '23514';
end
$$;

-- ───────────────────────────── 2. ajuste para menos ──────────────────────

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
  -- Serializa lançamentos da mesma parcela.
  select p.amount, p.currency, p.cancelled_at into v_payment
  from public.payments p where p.id = new.payment_id
  for update;
  if not found then
    raise exception 'Parcela % não existe', new.payment_id using errcode = '23503';
  end if;
  if new.currency <> v_payment.currency then
    raise exception 'Moeda do lançamento difere da parcela' using errcode = '23514';
  end if;
  if v_payment.cancelled_at is not null and new.amount > 0 then
    raise exception 'Parcela cancelada não recebe entrada' using errcode = '23514';
  end if;
  -- 064: ajuste para menos é a correção de UM recebimento. Sem o original, a
  -- parte do parceiro sairia do acordo de parceria errado (ou de nenhum).
  if new.kind = 'ADJUSTMENT' and new.amount < 0 and new.original_receipt_id is null then
    raise exception 'Ajuste para menos precisa indicar o recebimento que ele corrige' using errcode = '23514';
  end if;

  if new.original_receipt_id is not null then
    select r.payment_id, r.kind, r.amount into v_original
    from public.payment_receipts r where r.id = new.original_receipt_id;
    if v_original.payment_id is distinct from new.payment_id then
      raise exception 'O lançamento original é de outra parcela' using errcode = '23514';
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
    raise exception 'Recebido (%) excederia a parcela (%): corrija a parcela antes', v_net + new.amount, v_payment.amount
      using errcode = '23514';
  end if;

  new.created_by := coalesce(new.created_by, auth.uid(), nullif(current_setting('dg.actor_user_id', true), '')::uuid);
  return new;
end
$$;

-- ───────────────────────────── 3. cancelar parcela com recebimento ───────

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
      raise exception 'Parcela nasce ativa' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.financial_agreement_id is distinct from old.financial_agreement_id then
    raise exception 'Parcela não muda de contrato' using errcode = '23514';
  end if;
  if old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at then
    raise exception 'Parcela cancelada não volta: registre outra' using errcode = '23514';
  end if;

  -- O UPDATE já travou a linha da parcela; a guarda do livro trava a mesma
  -- linha antes de lançar. Cancelamento e recebimento simultâneos: um espera o
  -- outro, e o segundo enxerga o que o primeiro gravou.
  if new.cancelled_at is not null and old.cancelled_at is null or new.amount <> old.amount then
    select coalesce(sum(r.amount), 0) into v_net from public.payment_receipts r where r.payment_id = new.id;
  end if;
  if new.cancelled_at is not null and old.cancelled_at is null then
    -- 064: antes só o servidor do painel conferia (corrida entre duas pessoas passava).
    if v_net > 0 then
      raise exception 'Esta parcela tem recebimento: estorne os recebimentos antes de cancelar' using errcode = '23514';
    end if;
    new.cancelled_by := coalesce(new.cancelled_by, v_actor);
  end if;

  if new.amount <> old.amount and new.amount < v_net then
    raise exception 'Valor da parcela (%) menor que o já recebido (%)', new.amount, v_net using errcode = '23514';
  end if;
  return new;
end
$$;

-- ───────────────────────────── 4. repasse: saldo real do parceiro ────────

create or replace function private.create_partner_transfer(
  p_partner_organization_id uuid,
  p_amount                  numeric,
  p_reference               text default null,
  p_legal_case_id           uuid default null,
  p_idempotency_key         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := auth.uid();
  v_transfer    uuid;
  v_remaining   numeric(14,2) := p_amount;
  v_take        numeric(14,2);
  v_net_partner numeric(14,2);
  v_net_scope   numeric(14,2);
  r             record;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Somente ADMIN interno registra repasse' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'O valor do repasse precisa ser maior que zero' using errcode = '22023';
  end if;
  if p_idempotency_key is not null then
    select t.id into v_transfer from public.partner_transfers t
    where t.registered_by = v_actor and t.idempotency_key = p_idempotency_key;
    if v_transfer is not null then
      return jsonb_build_object('transfer_id', v_transfer, 'deduplicated', true);
    end if;
  end if;

  -- Trava TODAS as divisões de entrada do parceiro (o saldo real é do parceiro
  -- inteiro, não de um caso): dois repasses simultâneos não usam o mesmo saldo.
  perform 1
  from public.partner_revenue_allocations al
  join public.case_partnership_agreements a on a.id = al.case_partnership_agreement_id
  where a.partner_organization_id = p_partner_organization_id
    and al.reverses_allocation_id is null
  order by al.sequence
  for update of al;

  -- Reenvio da mesma chave que esperou a trava: devolve o repasse do primeiro
  -- envio (senão cairia no "saldo insuficiente" abaixo).
  if p_idempotency_key is not null then
    select t.id into v_transfer from public.partner_transfers t
    where t.registered_by = v_actor and t.idempotency_key = p_idempotency_key;
    if v_transfer is not null then
      return jsonb_build_object('transfer_id', v_transfer, 'deduplicated', true);
    end if;
  end if;

  -- 064: o limite é a soma LÍQUIDA, contando as divisões negativas (parte já
  -- repassada de um recebimento que depois foi estornado). Antes, a divisão
  -- negativa valia zero e o repasse seguinte pagava o parceiro em dobro.
  select coalesce(sum(x.available), 0),
         coalesce(sum(x.available) filter (where p_legal_case_id is null or x.legal_case_id = p_legal_case_id), 0)
    into v_net_partner, v_net_scope
  from (
    select a.legal_case_id, private.allocation_available_amount(al.id) as available
    from public.partner_revenue_allocations al
    join public.case_partnership_agreements a on a.id = al.case_partnership_agreement_id
    where a.partner_organization_id = p_partner_organization_id
      and al.reverses_allocation_id is null
  ) x;

  if p_amount > least(v_net_partner, v_net_scope) then
    raise exception 'Saldo disponível insuficiente para o repasse' using errcode = '23514';
  end if;

  insert into public.partner_transfers (partner_organization_id, amount, reference, registered_by, idempotency_key)
  values (p_partner_organization_id, p_amount, nullif(btrim(coalesce(p_reference, '')), ''), v_actor, p_idempotency_key)
  returning id into v_transfer;

  -- Consome as divisões com saldo, mais antigas primeiro (já travadas acima).
  for r in
    select al.id
    from public.partner_revenue_allocations al
    join public.case_partnership_agreements a on a.id = al.case_partnership_agreement_id
    where a.partner_organization_id = p_partner_organization_id
      and (p_legal_case_id is null or a.legal_case_id = p_legal_case_id)
      and al.reverses_allocation_id is null
    order by al.sequence
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, greatest(private.allocation_available_amount(r.id), 0));
    continue when v_take <= 0;
    insert into public.partner_transfer_items (transfer_id, allocation_id, amount) values (v_transfer, r.id, v_take);
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Saldo disponível insuficiente para o repasse' using errcode = '23514';
  end if;
  return jsonb_build_object('transfer_id', v_transfer, 'deduplicated', false);
end
$$;

-- ───────────────────────────── 5. listas com filtro no banco ─────────────
-- security_invoker: vale a RLS das tabelas de origem (ADMIN vê tudo; para os
-- demais, as linhas de dinheiro nem aparecem). O painel só serve estas listas
-- a quem tem finance.view.

-- Contratos: uma linha por contrato, com cliente, processo, modelo e os totais
-- do livro. `contract_date` = início do contrato (ou, sem início, o dia em que
-- foi criado); `next_due_date` = vencimento mais próximo ainda em aberto.
-- `in_process_totals` = entra nos totais por processo (046)? Falso em contrato
-- antigo, ligado só ao caso, e em contrato de processo excluído.
create view public.finance_agreement_list
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
  (p.id is not null and p.deleted_at is null) as in_process_totals,
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

comment on view public.finance_agreement_list is
  'Contratos de honorários com cliente, processo, modelo e totais do livro, para listar com busca, período e vencimento. Só leitura; ADMIN.';

revoke all on public.finance_agreement_list from public, anon;
grant select on public.finance_agreement_list to authenticated, service_role;

-- Extrato de recebimentos: uma linha por lançamento do livro (recebimento,
-- ajuste, estorno), com o cliente, o processo e a parcela. `occurred_on` = dia
-- do lançamento em São Paulo (é por ele que o período filtra).
create view public.finance_receipt_statement
with (security_invoker = true)
as
select
  r.id                                     as receipt_id,
  r.sequence,
  r.kind,
  r.amount,
  r.currency,
  r.occurred_at,
  (r.occurred_at at time zone 'America/Sao_Paulo')::date as occurred_on,
  r.method,
  r.notes,
  r.original_receipt_id,
  r.created_at,
  pay.id                                   as payment_id,
  pay.payment_type,
  pay.description                          as payment_description,
  pay.due_date,
  f.id                                     as financial_agreement_id,
  f.legal_case_id,
  f.legal_process_id,
  c.client_id,
  coalesce(icd.full_name, ccd.legal_name)  as client_name,
  c.title                                  as case_title,
  case when p.id is not null then coalesce(nullif(btrim(p.title), ''), c.title) end as process_title,
  p.cnj_number
from public.payment_receipts r
join public.payments pay on pay.id = r.payment_id
join public.financial_agreements f on f.id = pay.financial_agreement_id
left join public.legal_cases c on c.id = f.legal_case_id
left join public.legal_processes p on p.id = f.legal_process_id
left join public.individual_client_details icd on icd.client_id = c.client_id
left join public.company_client_details ccd on ccd.client_id = c.client_id;

comment on view public.finance_receipt_statement is
  'Extrato do livro de recebimentos (recebimento, ajuste, estorno) com cliente, processo e parcela. Só leitura; ADMIN.';

revoke all on public.finance_receipt_statement from public, anon;
grant select on public.finance_receipt_statement to authenticated, service_role;

-- Total do período do extrato, com os MESMOS filtros da lista. `p_search` já
-- chega como padrão do ILIKE (curingas do usuário escapados no servidor);
-- `p_cnj_prefix` = só dígitos.
create or replace function public.finance_receipt_statement_totals(
  p_from       date default null,
  p_to         date default null,
  p_method     text default null,
  p_kind       text default null,
  p_search     text default null,
  p_cnj_prefix text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'count',    count(*),
    'received', coalesce(sum(s.amount) filter (where s.amount > 0), 0)::numeric(14,2),
    'deducted', coalesce(sum(s.amount) filter (where s.amount < 0), 0)::numeric(14,2),
    'net',      coalesce(sum(s.amount), 0)::numeric(14,2))
  from public.finance_receipt_statement s
  where (p_from is null or s.occurred_on >= p_from)
    and (p_to is null or s.occurred_on <= p_to)
    and (p_method is null or s.method = p_method)
    and (p_kind is null or s.kind = p_kind)
    and (p_search is null or s.client_name ilike p_search or s.process_title ilike p_search or s.case_title ilike p_search)
    and (p_cnj_prefix is null or s.cnj_number like p_cnj_prefix || '%')
$$;

-- A receber: parcelas em aberto com saldo, por vencimento. `days_overdue` só
-- nas vencidas (hoje em São Paulo, como a situação da parcela).
create view public.finance_receivables
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
  (p.id is not null and p.deleted_at is null) as in_process_totals
from public.payment_balances b
join public.payments pay on pay.id = b.payment_id
join public.financial_agreements f on f.id = b.financial_agreement_id
left join public.legal_cases c on c.id = f.legal_case_id
left join public.legal_processes p on p.id = f.legal_process_id
left join public.individual_client_details icd on icd.client_id = c.client_id
left join public.company_client_details ccd on ccd.client_id = c.client_id
where b.status in ('PENDING', 'PARTIAL', 'OVERDUE')
  and b.balance > 0;

comment on view public.finance_receivables is
  'Parcelas em aberto com saldo (a receber), com cliente e processo, para listar por vencimento. Só leitura; ADMIN.';

revoke all on public.finance_receivables from public, anon;
grant select on public.finance_receivables to authenticated, service_role;

-- Totais do "a receber" com os MESMOS filtros da lista. `outside_totals` = a
-- parte que não entra nos totais por processo (contrato antigo ou de processo
-- excluído), para a tela dizer a diferença.
create or replace function public.finance_receivables_totals(
  p_from         date default null,
  p_to           date default null,
  p_overdue_only boolean default false,
  p_search       text default null,
  p_cnj_prefix   text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'count',          count(*),
    'total',          coalesce(sum(s.balance), 0)::numeric(14,2),
    'overdue',        coalesce(sum(s.balance) filter (where s.status = 'OVERDUE'), 0)::numeric(14,2),
    'overdue_count',  count(*) filter (where s.status = 'OVERDUE'),
    'outside_totals', coalesce(sum(s.balance) filter (where not s.in_process_totals), 0)::numeric(14,2))
  from public.finance_receivables s
  where (p_from is null or s.due_date >= p_from)
    and (p_to is null or s.due_date <= p_to)
    and (not coalesce(p_overdue_only, false) or s.status = 'OVERDUE')
    and (p_search is null or s.client_name ilike p_search or s.process_title ilike p_search or s.case_title ilike p_search)
    and (p_cnj_prefix is null or s.cnj_number like p_cnj_prefix || '%')
$$;

-- ───────────────────────────── 6. totais da visão geral ──────────────────
-- Uma chamada, somada no banco (antes: o servidor do painel lia até 20.000
-- linhas e somava). `totals` é a MESMA conta de process_finance_totals (046):
-- parcelas de contratos ligados a processo não excluído. `outside` é o resto
-- (contrato antigo, só do caso, ou de processo excluído). `monthly` = líquido
-- lançado por mês (São Paulo), do mais antigo ao atual, todo o livro.
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
      'contracted',    coalesce(sum(b.amount) filter (where not x.inside and b.status <> 'CANCELLED'), 0)::numeric(14,2),
      'received',      coalesce(sum(b.received_amount) filter (where not x.inside), 0)::numeric(14,2),
      'outstanding',   coalesce(sum(b.balance) filter (where not x.inside and x.open), 0)::numeric(14,2),
      'overdue',       coalesce(sum(b.balance) filter (where not x.inside and b.status = 'OVERDUE'), 0)::numeric(14,2),
      'open_payments', count(*) filter (where not x.inside and x.open)))
    into v_totals
  from public.payment_balances b
  join public.financial_agreements f on f.id = b.financial_agreement_id
  left join public.legal_processes p on p.id = f.legal_process_id and p.deleted_at is null
  cross join lateral (select p.id is not null as inside, b.status in ('PENDING', 'PARTIAL', 'OVERDUE') as open) x;

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

-- ───────────────────────────── 7. despesa idempotente ────────────────────
-- Mesmo contrato das demais (026): chave UUID por envio, única por autor.

alter table public.process_expenses add column idempotency_key uuid;
create unique index process_expenses_idempotency
  on public.process_expenses (created_by, idempotency_key) where idempotency_key is not null;

comment on column public.process_expenses.idempotency_key is
  'Chave do formulário (UUID gerado pelo navegador uma vez por envio). Reenvio com a mesma chave devolve a despesa já lançada.';

-- ───────────────────────────── grants ────────────────────────────────────

revoke all on function private.financial_agreements_guard() from public, anon, authenticated;
revoke all on function private.financial_agreements_reopen_audit() from public, anon, authenticated;
revoke all on function private.payment_receipts_require_active_agreement() from public, anon, authenticated;
revoke all on function private.payment_receipts_guard() from public, anon, authenticated;
revoke all on function private.payments_guard() from public, anon, authenticated;

revoke all on function private.create_partner_transfer(uuid, numeric, text, uuid, uuid) from public, anon, service_role;
grant execute on function private.create_partner_transfer(uuid, numeric, text, uuid, uuid) to authenticated;

revoke all on function public.finance_receipt_statement_totals(date, date, text, text, text, text) from public, anon;
grant execute on function public.finance_receipt_statement_totals(date, date, text, text, text, text) to authenticated;
revoke all on function public.finance_receivables_totals(date, date, boolean, text, text) from public, anon;
grant execute on function public.finance_receivables_totals(date, date, boolean, text, text) to authenticated;
revoke all on function public.finance_summary(integer) from public, anon;
grant execute on function public.finance_summary(integer) to authenticated;
