-- DG Brasil — 030: ciclo de vida do ACORDO FINANCEIRO no banco (Etapa 4.3, Fase F)
--
-- Auditoria antes de ligar as telas do financeiro: o acordo do caso
-- (financial_agreements) não tinha guarda no banco. Transições de situação,
-- termos imutáveis fora do rascunho e "nenhuma obrigação em aberto ao
-- concluir/cancelar" existiam só no servidor (TypeScript), com janela de
-- corrida entre conferir e gravar; obrigação nova e recebimento também só
-- conferiam a situação do acordo no TypeScript.
--
-- Agora o banco garante, sem mudar nenhuma regra já existente (001–029
-- inalteradas; os triggers novos se somam aos antigos):
--
--   1. financial_agreements_guard
--      - só ADMIN interno (antes de qualquer regra, como nas demais guardas);
--      - nasce DRAFT ou ACTIVE (um ACTIVE por caso continua pelo índice único);
--      - transições: DRAFT → ACTIVE | CANCELLED; ACTIVE → COMPLETED | CANCELLED;
--        COMPLETED e CANCELLED são histórico (nada muda);
--      - termos (modelo, valores, parcelas, êxito, moeda, início) só mudam em
--        DRAFT; o caso nunca muda; observações podem mudar em DRAFT e ACTIVE;
--      - concluir ou cancelar exige nenhuma obrigação em aberto (não
--        cancelada e com recebido líquido menor que o valor).
--   2. payments_require_open_agreement
--      - obrigação nova ou alteração de obrigação só em acordo DRAFT/ACTIVE.
--   3. payment_receipts_require_active_agreement
--      - ENTRADA (valor positivo: recebimento ou ajuste para mais) só em acordo
--        ACTIVE. Estorno e ajuste para menos são CORREÇÃO e continuam valendo
--        em qualquer situação (ex.: devolução bancária depois de concluir).
--
-- Corrida: obrigação/entrada travam o acordo em FOR SHARE; concluir/cancelar
-- trava a linha do acordo (UPDATE). Um espera o outro: não há conclusão com
-- obrigação criada "no meio", nem entrada em acordo recém-concluído.
-- Ordem dos triggers: o nome dos novos ordena DEPOIS das guardas existentes
-- (payments_guard, payment_receipts_guard), que conferem o papel primeiro.
--
-- Mensagens sem valores (nada de dinheiro no texto do erro).
--
-- Pós-baseline: 001–029 não são alteradas.

-- ───────────────────────────── 1. acordo ──────────────────────────────────

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
    new.created_by := coalesce(new.created_by, v_actor);
    return new;
  end if;

  if new.legal_case_id is distinct from old.legal_case_id then
    raise exception 'Acordo não muda de caso' using errcode = '23514';
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

create trigger financial_agreements_guard
  before insert or update on public.financial_agreements
  for each row execute function private.financial_agreements_guard();

-- ───────────────────────────── 2. obrigações ──────────────────────────────

create or replace function private.payments_require_open_agreement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  -- Trava o acordo (FOR SHARE): concluir/cancelar o acordo espera esta obrigação, e vice-versa.
  select a.status into v_status
  from public.financial_agreements a
  where a.id = new.financial_agreement_id
  for share;
  if v_status is null then
    raise exception 'Acordo da obrigação não existe' using errcode = '23503';
  end if;
  if v_status not in ('DRAFT', 'ACTIVE') then
    raise exception 'Acordo concluído ou cancelado não recebe nem altera obrigações' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger payments_require_open_agreement
  before insert or update on public.payments
  for each row execute function private.payments_require_open_agreement();

-- ───────────────────────────── 3. entradas no ledger ──────────────────────

create or replace function private.payment_receipts_require_active_agreement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  -- Estorno e ajuste para menos são correção: valem em qualquer situação do acordo.
  if new.amount <= 0 then
    return new;
  end if;
  select a.status into v_status
  from public.payments p
  join public.financial_agreements a on a.id = p.financial_agreement_id
  where p.id = new.payment_id
  for share of a;
  if v_status is distinct from 'ACTIVE' then
    raise exception 'Ative o acordo antes de registrar recebimentos' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger payment_receipts_require_active_agreement
  before insert on public.payment_receipts
  for each row execute function private.payment_receipts_require_active_agreement();

-- Funções de trigger: ninguém as chama diretamente.
revoke all on function private.financial_agreements_guard() from public, anon, authenticated;
revoke all on function private.payments_require_open_agreement() from public, anon, authenticated;
revoke all on function private.payment_receipts_require_active_agreement() from public, anon, authenticated;
