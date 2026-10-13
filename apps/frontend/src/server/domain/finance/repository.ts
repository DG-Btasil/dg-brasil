import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap, type DbErrorLike } from "@/server/core/db-errors";
import { conflict, notFound } from "@/server/core/errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type {
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
const PARTNERSHIP_PARTNER_COLUMNS = "id, legal_case_id, partner_percentage, effective_at, cancelled_at";
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

const since = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

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

export async function getAgreement(db: SupabaseClient, id: string): Promise<AgreementRow | null> {
  return check(await db.from("financial_agreements").select(AGREEMENT_COLUMNS).eq("id", id).maybeSingle()) as AgreementRow | null;
}

export async function insertAgreement(db: SupabaseClient, values: Record<string, unknown>): Promise<string> {
  return (check(await db.from("financial_agreements").insert(values).select("id").single()) as { id: string }).id;
}

/** Atualiza só se o acordo ainda está no status esperado (corrida/clique duplo não pula estado). */
export async function updateAgreementWhere(db: SupabaseClient, id: string, expectedStatus: string[], values: Record<string, unknown>): Promise<void> {
  requireOne(await db.from("financial_agreements").update(values, { count: "exact" }).eq("id", id).in("status", expectedStatus));
}

/** Acordo criado pelo mesmo usuário, para o mesmo caso, há poucos segundos (clique duplo). */
export async function findRecentAgreement(db: SupabaseClient, legalCaseId: string, actorId: string, windowSeconds: number): Promise<string | null> {
  const data = check(
    await db
      .from("financial_agreements")
      .select("id")
      .eq("legal_case_id", legalCaseId)
      .eq("created_by", actorId)
      .gte("created_at", since(windowSeconds))
      .order("created_at", { ascending: false })
      .limit(1),
  ) as { id: string }[] | null;
  return data?.[0]?.id ?? null;
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

export async function insertPayment(db: SupabaseClient, values: Record<string, unknown>): Promise<string> {
  return (check(await db.from("payments").insert(values).select("id").single()) as { id: string }).id;
}

/** Só obrigação não cancelada muda (o trigger também recusa reabrir). */
export async function updateOpenPayment(db: SupabaseClient, id: string, values: Record<string, unknown>): Promise<void> {
  requireOne(await db.from("payments").update(values, { count: "exact" }).eq("id", id).is("cancelled_at", null));
}

export async function findRecentPayment(
  db: SupabaseClient,
  values: { agreementId: string; amount: number; paymentType: string; dueDate?: string; actorId: string },
  windowSeconds: number,
): Promise<string | null> {
  let query = db
    .from("payments")
    .select("id")
    .eq("financial_agreement_id", values.agreementId)
    .eq("amount", values.amount)
    .eq("payment_type", values.paymentType)
    .eq("created_by", values.actorId)
    .is("cancelled_at", null)
    .gte("created_at", since(windowSeconds));
  query = values.dueDate ? query.eq("due_date", values.dueDate) : query.is("due_date", null);
  const data = check(await query.order("created_at", { ascending: false }).limit(1)) as { id: string }[] | null;
  return data?.[0]?.id ?? null;
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

export async function insertReceipt(db: SupabaseClient, values: Record<string, unknown>): Promise<string> {
  return (check(await db.from("payment_receipts").insert(values).select("id").single()) as { id: string }).id;
}

/**
 * Lançamento idêntico do MESMO usuário nos últimos segundos (clique duplo /
 * reenvio). A tabela não tem chave de idempotência (ver relatório: proposta
 * de coluna + índice único); esta checagem cobre o caso comum, e os
 * invariantes do banco (nunca acima da obrigação, estorno nunca além do
 * original) limitam o dano de uma corrida real.
 */
export async function findRecentReceipt(
  db: SupabaseClient,
  values: { paymentId: string; kind: string; amount?: number; originalReceiptId?: string; actorId: string },
  windowSeconds: number,
): Promise<string | null> {
  let query = db
    .from("payment_receipts")
    .select("id")
    .eq("payment_id", values.paymentId)
    .eq("kind", values.kind)
    .eq("created_by", values.actorId)
    .gte("created_at", since(windowSeconds));
  if (values.amount !== undefined) query = query.eq("amount", values.amount);
  query = values.originalReceiptId ? query.eq("original_receipt_id", values.originalReceiptId) : query.is("original_receipt_id", null);
  const data = check(await query.order("sequence", { ascending: false }).limit(1)) as { id: string }[] | null;
  return data?.[0]?.id ?? null;
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

/** sequence de cada divisão (para consumir as mais antigas primeiro). */
export async function allocationSequences(db: SupabaseClient, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const data = check(await db.from("partner_revenue_allocations").select("id, sequence").in("id", ids.slice(i, i + 200))) as { id: string; sequence: number }[] | null;
    for (const r of data ?? []) out.set(r.id, Number(r.sequence));
  }
  return out;
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

export async function insertTransfer(db: SupabaseClient, values: Record<string, unknown>): Promise<string> {
  return (check(await db.from("partner_transfers").insert(values).select("id").single()) as { id: string }).id;
}

/** Itens numa só requisição (um INSERT com várias linhas = uma transação no PostgREST). */
export async function insertTransferItems(db: SupabaseClient, transferId: string, items: { allocationId: string; amount: number }[]): Promise<void> {
  check(await db.from("partner_transfer_items").insert(items.map((i) => ({ transfer_id: transferId, allocation_id: i.allocationId, amount: i.amount }))));
}

export async function updateTransferWhere(db: SupabaseClient, id: string, expectedStatus: string[], values: Record<string, unknown>): Promise<void> {
  requireOne(await db.from("partner_transfers").update(values, { count: "exact" }).eq("id", id).in("status", expectedStatus));
}

export async function findRecentTransfer(
  db: SupabaseClient,
  values: { partnerOrganizationId: string; amount: number; actorId: string },
  windowSeconds: number,
): Promise<string | null> {
  const data = check(
    await db
      .from("partner_transfers")
      .select("id")
      .eq("partner_organization_id", values.partnerOrganizationId)
      .eq("amount", values.amount)
      .eq("registered_by", values.actorId)
      .eq("status", "PENDING")
      .gte("created_at", since(windowSeconds))
      .order("created_at", { ascending: false })
      .limit(1),
  ) as { id: string }[] | null;
  return data?.[0]?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

/** Organização é parceiro? (ADMIN lê todas; a RLS de organizations vale.) */
export async function isPartnerOrganization(db: SupabaseClient, id: string): Promise<boolean> {
  const data = unwrap(await db.from("organizations").select("id, type").eq("id", id).is("deleted_at", null).maybeSingle()) as { id: string; type: string } | null;
  return data?.type === "PARTNER";
}
