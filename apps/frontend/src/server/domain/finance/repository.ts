import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap, type DbErrorLike } from "@/server/core/db-errors";
import { conflict, notFound } from "@/server/core/errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type {
  AgreementListRow,
  AgreementRow,
  AllocationBalanceRow,
  AllocationRow,
  FeeModelRow,
  PartnershipPartnerRow,
  PartnershipRow,
  PaymentBalanceRow,
  PaymentRow,
  ReceiptRow,
  TransferItemRow,
  TransferPartnerRow,
  TransferRow,
} from "./mappers";

/**
 * Acesso a dados do financeiro (PostgREST, JWT do usuário). Sem regra de
 * negócio: autorização contextual fica no service; RLS (só ADMIN; parceiro só a
 * própria parceria) e os triggers financeiros (ADMIN primeiro, ledger
 * append-only, divisão gerada pelo banco, transições de repasse) são a segunda
 * barreira. Colunas sempre explícitas.
 *
 * Não existe aqui nenhuma função que altere ou apague lançamento do ledger,
 * divisão ou item de repasse: o banco nem concede UPDATE/DELETE nessas tabelas.
 */

/* ------------------------------------------------------------------ */
/* Colunas                                                             */
/* ------------------------------------------------------------------ */

const FEE_MODEL_COLUMNS =
  "id, name, description, legal_area_id, upfront_fee, fixed_fee, installments, monthly_fee, success_fee_percentage, billing_moment, notes, active, created_at, updated_at";
const AGREEMENT_COLUMNS =
  "id, legal_case_id, fee_model_id, upfront_fee, fixed_fee, installments, monthly_fee, success_fee_percentage, currency, start_date, status, notes, created_by, created_at, updated_at";
const BALANCE_COLUMNS = "payment_id, financial_agreement_id, legal_case_id, amount, currency, due_date, received_amount, balance, last_receipt_at, status";
const PAYMENT_COLUMNS = "id, payment_type, description, cancelled_at, cancellation_reason, created_at";
const RECEIPT_COLUMNS = "id, sequence, payment_id, kind, amount, currency, occurred_at, original_receipt_id, method, notes, created_by, created_at";
const ALLOCATION_COLUMNS =
  "id, sequence, receipt_id, case_partnership_agreement_id, reverses_allocation_id, base_amount, partner_percentage, partner_amount, owner_amount, created_at";
const PARTNERSHIP_COLUMNS =
  "id, legal_case_id, partner_organization_id, partner_percentage, owner_percentage, effective_at, created_by, created_at, cancelled_at, cancelled_by, cancellation_reason";
/** Parceiro: só o que o DTO dele tem. */
const PARTNERSHIP_PARTNER_COLUMNS = "id, legal_case_id, partner_percentage, effective_at, cancelled_at, legal_cases(title)";
const TRANSFER_COLUMNS =
  "id, partner_organization_id, amount, status, paid_at, reference, registered_by, cancelled_at, cancellation_reason, created_at, updated_at";
const TRANSFER_PARTNER_COLUMNS = "id, amount, status, paid_at, reference, cancelled_at, created_at";
const ALLOCATION_BALANCE_COLUMNS = "allocation_id, case_partnership_agreement_id, net_partner_amount, transferred_amount, paid_amount";

/** Lote de leitura para agregações (limite do PostgREST por requisição). */
const CHUNK = 1000;
/** Teto de segurança das agregações em memória (ver relatório: RPC de totais proposta). */
const MAX_AGGREGATE_ROWS = 20_000;

/* ------------------------------------------------------------------ */
/* Erros com mensagem própria                                          */
/* ------------------------------------------------------------------ */

/** Índices únicos do financeiro → mensagem de domínio (o core não conhece estes nomes). */
const FINANCE_UNIQUE: Record<string, string> = {
  financial_agreements_one_active_per_case: "Este caso já tem um acordo financeiro ativo.",
  fee_models_name_key: "Já existe um modelo de honorários com este nome.",
};

function financeError(error: DbErrorLike): Error {
  if (error.code === "23505") {
    const text = `${error.message ?? ""} ${error.details ?? ""}`;
    for (const [constraint, message] of Object.entries(FINANCE_UNIQUE)) {
      if (text.includes(constraint)) return conflict(message);
    }
  }
  return fromDbError(error);
}

function check<T>(result: { data: T; error: DbErrorLike | null }): T {
  if (result.error) throw financeError(result.error);
  return result.data;
}

/** UPDATE que precisa ter atingido exatamente uma linha (filtro de estado = trava otimista). */
function requireOne(result: { error: DbErrorLike | null; count: number | null }): void {
  if (result.error) throw financeError(result.error);
  if (!result.count) throw notFound();
}

/* ------------------------------------------------------------------ */
/* Idempotência por chave (migration 026)                              */
/* ------------------------------------------------------------------ */

/**
 * Tabelas com `idempotency_key` + índice único (autor, chave). O navegador
 * gera uma chave por formulário; reenviar a mesma chave devolve o registro já
 * gravado. Chaves diferentes = registros diferentes, mesmo que idênticos.
 */
const IDEMPOTENCY_INDEX = {
  payment_receipts: "payment_receipts_idempotency",
  payments: "payments_idempotency",
  financial_agreements: "financial_agreements_idempotency",
} as const;
export type IdempotentTable = keyof typeof IDEMPOTENCY_INDEX;

function violates(error: DbErrorLike, index: string): boolean {
  return error.code === "23505" && `${error.message ?? ""} ${error.details ?? ""}`.includes(index);
}

/** Registro do MESMO autor com a mesma chave (o autor é a sessão, nunca o input). */
export async function findByIdempotencyKey(db: SupabaseClient, table: IdempotentTable, actorId: string, key: string): Promise<string | null> {
  const data = check(await db.from(table).select("id").eq("created_by", actorId).eq("idempotency_key", key).maybeSingle()) as { id: string } | null;
  return data?.id ?? null;
}

/**
 * INSERT com chave. Corrida (dois envios simultâneos): o segundo cai no índice
 * único e devolve o primeiro. `created_by` dos lançamentos e obrigações é
 * preenchido pelo trigger com auth.uid() — o mesmo `actorId` da sessão.
 */
export async function insertIdempotent(
  db: SupabaseClient,
  table: IdempotentTable,
  values: Record<string, unknown>,
  actorId: string,
  key: string,
): Promise<{ id: string; deduplicated: boolean }> {
  const result = await db.from(table).insert({ ...values, idempotency_key: key }).select("id").single();
  if (!result.error) return { id: (result.data as { id: string }).id, deduplicated: false };
  if (violates(result.error, IDEMPOTENCY_INDEX[table])) {
    const existing = await findByIdempotencyKey(db, table, actorId, key);
    if (existing) return { id: existing, deduplicated: true };
  }
  throw financeError(result.error);
}

/* ------------------------------------------------------------------ */
/* Modelos de honorários                                               */
/* ------------------------------------------------------------------ */

export async function listFeeModels(
  db: SupabaseClient,
  filters: { active?: boolean; legalAreaId?: string },
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: FeeModelRow[]; total: number }> {
  let query = db.from("fee_models").select(FEE_MODEL_COLUMNS, { count: "exact" }).is("deleted_at", null);
  if (filters.active !== undefined) query = query.eq("active", filters.active);
  if (filters.legalAreaId) query = query.eq("legal_area_id", filters.legalAreaId);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending }).order("id").range(from, to);
  if (error) throw financeError(error);
  return { rows: (data ?? []) as FeeModelRow[], total: count ?? 0 };
}

export async function getFeeModel(db: SupabaseClient, id: string): Promise<FeeModelRow | null> {
  return check(await db.from("fee_models").select(FEE_MODEL_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle()) as FeeModelRow | null;
}

export async function insertFeeModel(db: SupabaseClient, values: Record<string, unknown>): Promise<string> {
  return (check(await db.from("fee_models").insert(values).select("id").single()) as { id: string }).id;
}

export async function updateFeeModel(db: SupabaseClient, id: string, values: Record<string, unknown>): Promise<void> {
  requireOne(await db.from("fee_models").update(values, { count: "exact" }).eq("id", id).is("deleted_at", null));
}

/* ------------------------------------------------------------------ */
/* Acordos                                                             */
/* ------------------------------------------------------------------ */

export async function listAgreements(
  db: SupabaseClient,
  filters: { legalCaseId?: string; status?: string },
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: AgreementRow[]; total: number }> {
  let query = db.from("financial_agreements").select(AGREEMENT_COLUMNS, { count: "exact" });
  if (filters.legalCaseId) query = query.eq("legal_case_id", filters.legalCaseId);
  if (filters.status) query = query.eq("status", filters.status);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).order("id").range(from, to);
  if (error) throw financeError(error);
  return { rows: (data ?? []) as AgreementRow[], total: count ?? 0 };
}

/** Acordos com rótulos do caso (título, cliente, origem) e do modelo — embeds de leitura sob RLS. */
const AGREEMENT_LIST_COLUMNS = `${AGREEMENT_COLUMNS}, fee_models(name),
  legal_cases(title, origin_organization_id, clients!legal_cases_client_id_fkey(individual_client_details(full_name), company_client_details(legal_name)))`;

export async function listAgreementRows(
  db: SupabaseClient,
  filters: { legalCaseId?: string; status?: string },
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: AgreementListRow[]; total: number }> {
  let query = db.from("financial_agreements").select(AGREEMENT_LIST_COLUMNS, { count: "exact" });
  if (filters.legalCaseId) query = query.eq("legal_case_id", filters.legalCaseId);
  if (filters.status) query = query.eq("status", filters.status);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).order("id").range(from, to);
  if (error) throw financeError(error);
  return { rows: (data ?? []) as unknown as AgreementListRow[], total: count ?? 0 };
}

/** Saldos (view payment_balances) das obrigações destes acordos — uma página de acordos por vez. */
export async function balancesOfAgreements(db: SupabaseClient, agreementIds: string[]): Promise<PaymentBalanceRow[]> {
  if (agreementIds.length === 0) return [];
  const rows: PaymentBalanceRow[] = [];
  for (let from = 0; from < MAX_AGGREGATE_ROWS; from += CHUNK) {
    const data = check(
      await db.from("payment_balances").select(BALANCE_COLUMNS).in("financial_agreement_id", agreementIds).order("payment_id").range(from, from + CHUNK - 1),
    ) as PaymentBalanceRow[] | null;
    rows.push(...(data ?? []));
    if (!data || data.length < CHUNK) break;
  }
  return rows;
}

type BalanceTotalsRow = Pick<PaymentBalanceRow, "amount" | "received_amount" | "balance" | "status">;

/** Todos os saldos (para a visão geral), em lotes, até o teto. `truncated` = passou do teto. */
export async function allBalances(db: SupabaseClient): Promise<{ rows: BalanceTotalsRow[]; truncated: boolean }> {
  const rows: BalanceTotalsRow[] = [];
  for (let from = 0; from < MAX_AGGREGATE_ROWS; from += CHUNK) {
    const data = check(await db.from("payment_balances").select("amount, received_amount, balance, status").order("payment_id").range(from, from + CHUNK - 1)) as BalanceTotalsRow[] | null;
    rows.push(...(data ?? []));
    if (!data || data.length < CHUNK) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

type ReceiptMonthRow = { amount: number | string; occurred_at: string };

/** Lançamentos do ledger desde `fromIso` (valor com sinal e data), em lotes, até o teto. */
export async function receiptsSince(db: SupabaseClient, fromIso: string): Promise<{ rows: ReceiptMonthRow[]; truncated: boolean }> {
  const rows: ReceiptMonthRow[] = [];
  for (let from = 0; from < MAX_AGGREGATE_ROWS; from += CHUNK) {
    const data = check(
      await db.from("payment_receipts").select("amount, occurred_at").gte("occurred_at", fromIso).order("sequence").range(from, from + CHUNK - 1),
    ) as ReceiptMonthRow[] | null;
    rows.push(...(data ?? []));
    if (!data || data.length < CHUNK) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

const AGREEMENT_STATUS_LIST = ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"] as const;

/** Quantidade de acordos por situação (contagens no banco). */
export async function countAgreementsByStatus(db: SupabaseClient): Promise<Record<(typeof AGREEMENT_STATUS_LIST)[number], number>> {
  const counts = await Promise.all(
    AGREEMENT_STATUS_LIST.map(async (status) => {
      const { error, count } = await db.from("financial_agreements").select("id", { count: "exact", head: true }).eq("status", status);
      if (error) throw financeError(error);
      return count ?? 0;
    }),
  );
  return { DRAFT: counts[0], ACTIVE: counts[1], COMPLETED: counts[2], CANCELLED: counts[3] };
}

export async function getAgreement(db: SupabaseClient, id: string): Promise<AgreementRow | null> {
  return check(await db.from("financial_agreements").select(AGREEMENT_COLUMNS).eq("id", id).maybeSingle()) as AgreementRow | null;
}

/** Atualiza só se o acordo ainda está no status esperado (corrida/clique duplo não pula estado). */
export async function updateAgreementWhere(db: SupabaseClient, id: string, expectedStatus: string[], values: Record<string, unknown>): Promise<void> {
  requireOne(await db.from("financial_agreements").update(values, { count: "exact" }).eq("id", id).in("status", expectedStatus));
}

/* ------------------------------------------------------------------ */
/* Obrigações                                                          */
/* ------------------------------------------------------------------ */

export async function listPaymentBalances(
  db: SupabaseClient,
  filters: { agreementId?: string; legalCaseId?: string; status?: string; paymentIds?: string[] },
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: PaymentBalanceRow[]; total: number }> {
  let query = db.from("payment_balances").select(BALANCE_COLUMNS, { count: "exact" });
  if (filters.agreementId) query = query.eq("financial_agreement_id", filters.agreementId);
  if (filters.legalCaseId) query = query.eq("legal_case_id", filters.legalCaseId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.paymentIds) query = query.in("payment_id", filters.paymentIds);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).order("payment_id").range(from, to);
  if (error) throw financeError(error);
  return { rows: (data ?? []) as PaymentBalanceRow[], total: count ?? 0 };
}

export async function getPaymentBalance(db: SupabaseClient, paymentId: string): Promise<PaymentBalanceRow | null> {
  return check(await db.from("payment_balances").select(BALANCE_COLUMNS).eq("payment_id", paymentId).maybeSingle()) as PaymentBalanceRow | null;
}

export async function getPaymentRows(db: SupabaseClient, ids: string[]): Promise<PaymentRow[]> {
  if (ids.length === 0) return [];
  return (check(await db.from("payments").select(PAYMENT_COLUMNS).in("id", ids)) ?? []) as PaymentRow[];
}

/** Obrigações ainda em aberto de um acordo (PENDING, PARTIAL ou OVERDUE). */
export async function countOpenPayments(db: SupabaseClient, agreementId: string): Promise<number> {
  const { error, count } = await db
    .from("payment_balances")
    .select("payment_id", { count: "exact", head: true })
    .eq("financial_agreement_id", agreementId)
    .in("status", ["PENDING", "PARTIAL", "OVERDUE"]);
  if (error) throw financeError(error);
  return count ?? 0;
}

/** Só obrigação não cancelada muda (o trigger também recusa reabrir). */
export async function updateOpenPayment(db: SupabaseClient, id: string, values: Record<string, unknown>): Promise<void> {
  requireOne(await db.from("payments").update(values, { count: "exact" }).eq("id", id).is("cancelled_at", null));
}

/* ------------------------------------------------------------------ */
/* Ledger (append-only: só INSERT e SELECT)                            */
/* ------------------------------------------------------------------ */

export async function listReceipts(db: SupabaseClient, paymentId: string, page: PageInput): Promise<{ rows: ReceiptRow[]; total: number }> {
  const { from, to } = toRange(page);
  const { data, error, count } = await db
    .from("payment_receipts")
    .select(RECEIPT_COLUMNS, { count: "exact" })
    .eq("payment_id", paymentId)
    .order("sequence", { ascending: true })
    .range(from, to);
  if (error) throw financeError(error);
  return { rows: (data ?? []) as ReceiptRow[], total: count ?? 0 };
}

export async function getReceipt(db: SupabaseClient, id: string): Promise<ReceiptRow | null> {
  return check(await db.from("payment_receipts").select(RECEIPT_COLUMNS).eq("id", id).maybeSingle()) as ReceiptRow | null;
}

/** Quanto já foi estornado (soma negativa) de um lançamento de entrada. */
export async function reversedAmountOf(db: SupabaseClient, originalReceiptId: string): Promise<number[]> {
  const data = check(await db.from("payment_receipts").select("amount").eq("original_receipt_id", originalReceiptId).lt("amount", 0)) as
    | { amount: number | string }[]
    | null;
  return (data ?? []).map((r) => Number(r.amount));
}

/* ------------------------------------------------------------------ */
/* Parceria: snapshot e divisões (leitura)                             */
/* ------------------------------------------------------------------ */

/** Histórico de snapshots do caso (no máximo um ativo). Parceiro: só colunas e linhas do próprio escritório. */
export async function listPartnershipsByCase(db: SupabaseClient, legalCaseId: string, partnerOrganizationId?: string): Promise<PartnershipRow[]> {
  let query = db.from("case_partnership_agreements").select(PARTNERSHIP_COLUMNS).eq("legal_case_id", legalCaseId);
  if (partnerOrganizationId) query = query.eq("partner_organization_id", partnerOrganizationId);
  return (check(await query.order("effective_at", { ascending: false }).limit(100)) ?? []) as PartnershipRow[];
}

export async function listPartnerPartnershipsByCase(db: SupabaseClient, legalCaseId: string, partnerOrganizationId: string): Promise<PartnershipPartnerRow[]> {
  return (check(
    await db
      .from("case_partnership_agreements")
      .select(PARTNERSHIP_PARTNER_COLUMNS)
      .eq("legal_case_id", legalCaseId)
      .eq("partner_organization_id", partnerOrganizationId)
      .order("effective_at", { ascending: false })
      .limit(100),
  ) ?? []) as PartnershipPartnerRow[];
}

/** Snapshots de um parceiro (paginado). A RLS já limita o PARTNER_ADMIN ao próprio escritório. */
export async function listPartnershipsByPartner(
  db: SupabaseClient,
  partnerOrganizationId: string,
  includeCancelled: boolean,
  page: PageInput,
): Promise<{ rows: PartnershipPartnerRow[]; total: number }> {
  let query = db.from("case_partnership_agreements").select(PARTNERSHIP_PARTNER_COLUMNS, { count: "exact" }).eq("partner_organization_id", partnerOrganizationId);
  if (!includeCancelled) query = query.is("cancelled_at", null);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order("effective_at", { ascending: false }).order("id").range(from, to);
  if (error) throw financeError(error);
  return { rows: (data ?? []) as PartnershipPartnerRow[], total: count ?? 0 };
}

export async function countPartnerships(db: SupabaseClient, partnerOrganizationId: string): Promise<{ total: number; active: number }> {
  const all = await db.from("case_partnership_agreements").select("id", { count: "exact", head: true }).eq("partner_organization_id", partnerOrganizationId);
  if (all.error) throw financeError(all.error);
  const active = await db
    .from("case_partnership_agreements")
    .select("id", { count: "exact", head: true })
    .eq("partner_organization_id", partnerOrganizationId)
    .is("cancelled_at", null);
  if (active.error) throw financeError(active.error);
  return { total: all.count ?? 0, active: active.count ?? 0 };
}

/**
 * Divisões (visão interna). Filtro por caso/parceiro pelo snapshot embutido
 * (`!inner`), sem listar ids na URL.
 */
export async function listAllocations(
  db: SupabaseClient,
  filters: { legalCaseId?: string; partnerOrganizationId?: string; receiptId?: string },
  page: PageInput,
): Promise<{ rows: AllocationRow[]; total: number }> {
  const embed = filters.legalCaseId || filters.partnerOrganizationId ? ", case_partnership_agreements!inner(legal_case_id, partner_organization_id)" : "";
  let query = db.from("partner_revenue_allocations").select(`${ALLOCATION_COLUMNS}${embed}`, { count: "exact" });
  if (filters.legalCaseId) query = query.eq("case_partnership_agreements.legal_case_id", filters.legalCaseId);
  if (filters.partnerOrganizationId) query = query.eq("case_partnership_agreements.partner_organization_id", filters.partnerOrganizationId);
  if (filters.receiptId) query = query.eq("receipt_id", filters.receiptId);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order("sequence", { ascending: true }).range(from, to);
  if (error) throw financeError(error);
  return { rows: (data ?? []) as unknown as AllocationRow[], total: count ?? 0 };
}

/**
 * Saldos por divisão de entrada (view partner_allocation_balances), em lotes.
 * `agreementIds` restringe a snapshots específicos. Ordem: divisão mais antiga
 * primeiro (sequence da divisão, lido à parte porque a view não o expõe).
 */
export async function listAllocationBalances(
  db: SupabaseClient,
  filters: { partnerOrganizationId: string; agreementIds?: string[]; legalCaseId?: string },
): Promise<AllocationBalanceRow[]> {
  const rows: AllocationBalanceRow[] = [];
  for (let from = 0; from < MAX_AGGREGATE_ROWS; from += CHUNK) {
    let query = db.from("partner_allocation_balances").select(ALLOCATION_BALANCE_COLUMNS).eq("partner_organization_id", filters.partnerOrganizationId);
    if (filters.agreementIds) query = query.in("case_partnership_agreement_id", filters.agreementIds);
    if (filters.legalCaseId) query = query.eq("legal_case_id", filters.legalCaseId);
    const data = check(await query.order("allocation_id").range(from, from + CHUNK - 1)) as AllocationBalanceRow[] | null;
    rows.push(...(data ?? []));
    if (!data || data.length < CHUNK) break;
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Repasses                                                            */
/* ------------------------------------------------------------------ */

export async function listTransfers(
  db: SupabaseClient,
  filters: { partnerOrganizationId?: string; status?: string },
  page: PageInput,
  sort: { column: string; ascending: boolean },
  scope: "INTERNAL" | "PARTNER",
): Promise<{ rows: TransferRow[] | TransferPartnerRow[]; total: number }> {
  let query = db.from("partner_transfers").select(scope === "INTERNAL" ? TRANSFER_COLUMNS : TRANSFER_PARTNER_COLUMNS, { count: "exact" });
  if (filters.partnerOrganizationId) query = query.eq("partner_organization_id", filters.partnerOrganizationId);
  if (filters.status) query = query.eq("status", filters.status);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).order("id").range(from, to);
  if (error) throw financeError(error);
  return { rows: (data ?? []) as unknown as TransferRow[] | TransferPartnerRow[], total: count ?? 0 };
}

export async function getTransfer(db: SupabaseClient, id: string): Promise<TransferRow | null> {
  return check(await db.from("partner_transfers").select(TRANSFER_COLUMNS).eq("id", id).maybeSingle()) as TransferRow | null;
}

export async function listTransferItems(db: SupabaseClient, transferId: string): Promise<TransferItemRow[]> {
  return (check(await db.from("partner_transfer_items").select("allocation_id, amount, created_at").eq("transfer_id", transferId).order("created_at").limit(1000)) ??
    []) as TransferItemRow[];
}

/**
 * Repasse atômico (public.create_partner_transfer, migration 026): cria o
 * repasse PENDING e consome as divisões com saldo — mais antigas primeiro,
 * travadas — numa transação. Chave repetida devolve o repasse já gravado;
 * corrida com a mesma chave cai no índice único e devolve o do primeiro envio.
 */
export async function createTransferRpc(
  db: SupabaseClient,
  args: { partnerOrganizationId: string; amount: number; reference?: string; legalCaseId?: string; idempotencyKey: string },
  actorId: string,
): Promise<{ transferId: string; deduplicated: boolean }> {
  const { data, error } = await db.rpc("create_partner_transfer", {
    p_partner_organization_id: args.partnerOrganizationId,
    p_amount: args.amount,
    p_reference: args.reference ?? null,
    p_legal_case_id: args.legalCaseId ?? null,
    p_idempotency_key: args.idempotencyKey,
  });
  if (error) {
    if (violates(error, "partner_transfers_idempotency")) {
      const existing = check(
        await db.from("partner_transfers").select("id").eq("registered_by", actorId).eq("idempotency_key", args.idempotencyKey).maybeSingle(),
      ) as { id: string } | null;
      if (existing) return { transferId: existing.id, deduplicated: true };
    }
    throw financeError(error);
  }
  const result = data as { transfer_id: string; deduplicated: boolean };
  return { transferId: result.transfer_id, deduplicated: result.deduplicated };
}

export async function updateTransferWhere(db: SupabaseClient, id: string, expectedStatus: string[], values: Record<string, unknown>): Promise<void> {
  requireOne(await db.from("partner_transfers").update(values, { count: "exact" }).eq("id", id).in("status", expectedStatus));
}

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

/** Organização é parceiro? (ADMIN lê todas; a RLS de organizations vale.) */
export async function isPartnerOrganization(db: SupabaseClient, id: string): Promise<boolean> {
  const data = unwrap(await db.from("organizations").select("id, type").eq("id", id).is("deleted_at", null).maybeSingle()) as { id: string; type: string } | null;
  return data?.type === "PARTNER";
}

/** Cronograma de parcelas (035): N obrigações numa transação, idempotente pela chave. */
export async function createPaymentSchedule(
  db: SupabaseClient,
  p: { key: string; agreementId: string; total: number; installments: number; firstDueDate: string; frequency: string; paymentType: string; description: string | null },
): Promise<{ payment_ids: string[]; count: number; deduplicated: boolean }> {
  return unwrap(
    await db.rpc("create_payment_schedule_once", {
      p_key: p.key,
      p_agreement_id: p.agreementId,
      p_total: p.total,
      p_count: p.installments,
      p_first_due: p.firstDueDate,
      p_frequency: p.frequency,
      p_payment_type: p.paymentType,
      p_description: p.description,
    }),
  ) as { payment_ids: string[]; count: number; deduplicated: boolean };
}

/* ------------------------------------------------------------------ */
/* Valores da parceria (035, só leitura)                               */
/* ------------------------------------------------------------------ */

export interface ShareTotalsRow {
  case_partnership_agreement_id: string;
  eligible_revenue: number | string;
  partner_share: number | string;
  owner_share: number | string;
}

/** Receita elegível e divisão por snapshot (view partner_agreement_share_totals; mesma RLS). Uma consulta por página. */
export async function listShareTotals(db: SupabaseClient, agreementIds: string[]): Promise<ShareTotalsRow[]> {
  if (agreementIds.length === 0) return [];
  return (check(
    await db.from("partner_agreement_share_totals").select("case_partnership_agreement_id, eligible_revenue, partner_share, owner_share").in("case_partnership_agreement_id", agreementIds),
  ) ?? []) as ShareTotalsRow[];
}

/** Um snapshot de parceria (RLS: ADMIN; PARTNER_ADMIN só os do próprio escritório). */
export async function getPartnershipById(db: SupabaseClient, id: string): Promise<(PartnershipPartnerRow & { partner_organization_id: string; owner_percentage: number | string }) | null> {
  return check(
    await db.from("case_partnership_agreements").select(`${PARTNERSHIP_PARTNER_COLUMNS}, partner_organization_id, owner_percentage`).eq("id", id).maybeSingle(),
  ) as (PartnershipPartnerRow & { partner_organization_id: string; owner_percentage: number | string }) | null;
}

export interface ShareTransferItemRow {
  transfer_id: string;
  amount: number | string;
  partner_transfers: { status: string; created_at: string; paid_at: string | null; reference: string | null } | { status: string; created_at: string; paid_at: string | null; reference: string | null }[] | null;
}

/** Itens de repasse que saíram das divisões deste snapshot (histórico de repasses do caso). */
export async function listShareTransferItems(db: SupabaseClient, agreementId: string): Promise<ShareTransferItemRow[]> {
  return (check(
    await db
      .from("partner_transfer_items")
      .select("transfer_id, amount, partner_transfers!inner(status, created_at, paid_at, reference), partner_revenue_allocations!inner(case_partnership_agreement_id)")
      .eq("partner_revenue_allocations.case_partnership_agreement_id", agreementId)
      .limit(MAX_AGGREGATE_ROWS),
  ) ?? []) as unknown as ShareTransferItemRow[];
}

/** Recebido líquido no caso inteiro (payment_balances; só ADMIN). */
export async function caseReceived(db: SupabaseClient, legalCaseId: string): Promise<number> {
  const rows = (check(await db.from("payment_balances").select("received_amount").eq("legal_case_id", legalCaseId).limit(MAX_AGGREGATE_ROWS)) ?? []) as { received_amount: number | string }[];
  return rows.reduce((acc, r) => acc + Math.round(Number(r.received_amount) * 100), 0) / 100;
}

export interface ContractedByModelRow {
  fee_model_id: string | null;
  fee_model_name: string | null;
  agreement_count: number;
  contracted_amount: number | string;
}

/** Contratado por modelo (035): uma linha por modelo, somada no banco (ADMIN pela RLS). */
export async function contractedByFeeModel(db: SupabaseClient): Promise<ContractedByModelRow[]> {
  return (check(await db.from("financial_contracted_by_fee_model").select("fee_model_id, fee_model_name, agreement_count, contracted_amount").limit(1000)) ?? []) as ContractedByModelRow[];
}
