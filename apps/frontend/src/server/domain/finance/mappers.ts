import type { BillingMoment, ProcessPhase, ProcessStatus } from "@/lib/constants/status";
import { paymentStatusFromDb, type DbPaymentStatus } from "@/repositories/api/db-mappings";
import type { ID } from "@/types";
import type {
  AgreementDbStatus,
  AgreementListItemDTO,
  AllocationDTO,
  CasePartnershipInternalDTO,
  CasePartnershipPartnerDTO,
  ExpenseCategory,
  ExpenseCategoryPoint,
  ExpenseDTO,
  ExpenseStatus,
  FeeModelDTO,
  FinanceTotals,
  FinancialAgreementDTO,
  PartnerAgreementShareDTO,
  PartnerShareTotals,
  PaymentDTO,
  PaymentType,
  ProcessFinanceDTO,
  ProcessFinanceTotalsDTO,
  ReceiptDTO,
  ReceiptKind,
  TransferInternalDTO,
  TransferItemDTO,
  TransferPartnerDTO,
  TransferStatus, PartnerShareTransferDTO, ContractedByModelPoint,
  FinanceSummaryDTO,
  ReceiptStatementItemDTO,
  ReceiptStatementTotalsDTO,
  ReceivableItemDTO,
  ReceivablesTotalsDTO } from "./dto";
import { EXPENSE_CATEGORIES, type CreateAgreementInput, type CreateExpenseInput, type CreateFeeModelInput, type UpdateAgreementInput, type UpdateExpenseInput, type UpdateFeeModelInput } from "./schemas";

/**
 * Banco (snake_case) ↔ domínio (camelCase). Funções puras, testadas em
 * mappers.test.ts. Valores `numeric` podem chegar como número ou texto do
 * PostgREST: sempre passam por `money()`.
 *
 * Nada aqui CALCULA divisão: as divisões e saldos vêm prontos do banco. A
 * única conta é a soma de colunas já derivadas pelo banco (totais do parceiro),
 * feita em centavos inteiros para não acumular erro de ponto flutuante.
 */

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */

type Numeric = number | string;

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

/** numeric do Postgres → number com 2 casas. */
export function money(v: Numeric): number {
  return Math.round(Number(v) * 100) / 100;
}
const optMoney = (v: Numeric | null | undefined): number | undefined => (v === null || v === undefined ? undefined : money(v));

export const toCents = (v: Numeric): number => Math.round(Number(v) * 100);
export const fromCents = (c: number): number => c / 100;

/* ------------------------------------------------------------------ */
/* Linhas do banco                                                     */
/* ------------------------------------------------------------------ */

export interface FeeModelRow {
  id: string;
  name: string;
  description: string | null;
  legal_area_id: string | null;
  upfront_fee: Numeric | null;
  fixed_fee: Numeric | null;
  installments: number | null;
  monthly_fee: Numeric | null;
  success_fee_percentage: Numeric | null;
  billing_moment: BillingMoment;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgreementRow {
  id: string;
  legal_case_id: string;
  /** 046: nulo só em contrato antigo (do caso). Opcional no tipo para linhas lidas antes da coluna existir. */
  legal_process_id?: string | null;
  fee_model_id: string | null;
  upfront_fee: Numeric | null;
  fixed_fee: Numeric | null;
  installments: number | null;
  monthly_fee: Numeric | null;
  success_fee_percentage: Numeric | null;
  currency: string;
  start_date: string | null;
  status: AgreementDbStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** 064: última reabertura. Opcionais no tipo para linhas lidas sem as colunas. */
  reopened_at?: string | null;
  reopen_reason?: string | null;
}

/** Linha da view payment_balances (derivada do ledger). */
export interface PaymentBalanceRow {
  payment_id: string;
  financial_agreement_id: string;
  legal_case_id: string;
  amount: Numeric;
  currency: string;
  due_date: string | null;
  received_amount: Numeric;
  balance: Numeric;
  last_receipt_at: string | null;
  status: DbPaymentStatus;
}

/** Colunas da obrigação que a view não traz. */
export interface PaymentRow {
  id: string;
  payment_type: PaymentType;
  description: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
}

export interface ReceiptRow {
  id: string;
  sequence: number;
  payment_id: string;
  kind: ReceiptKind;
  amount: Numeric;
  currency: string;
  occurred_at: string;
  original_receipt_id: string | null;
  method: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AllocationRow {
  id: string;
  sequence: number;
  receipt_id: string;
  case_partnership_agreement_id: string;
  reverses_allocation_id: string | null;
  base_amount: Numeric;
  partner_percentage: Numeric;
  partner_amount: Numeric;
  owner_amount: Numeric;
  created_at: string;
}

export interface PartnershipRow {
  id: string;
  legal_case_id: string;
  partner_organization_id: string;
  partner_percentage: Numeric;
  owner_percentage: Numeric;
  effective_at: string;
  created_by: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
}

/** Colunas do snapshot que o parceiro pode receber (consulta já não pede as outras). */
export type PartnershipPartnerRow = Pick<PartnershipRow, "id" | "legal_case_id" | "partner_percentage" | "effective_at" | "cancelled_at"> & {
  legal_cases?: { title: string } | { title: string }[] | null;
};

type Many<T> = T | T[] | null;
const first = <T>(v: Many<T> | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

/** Caso com o cliente (embed de leitura da lista geral de despesas). */
interface CaseEmbed {
  title: string;
  origin_organization_id: string;
  clients?: Many<{ individual_client_details?: Many<{ full_name: string }>; company_client_details?: Many<{ legal_name: string }> }>;
}

function clientNameOf(c: CaseEmbed): string {
  const client = first(c.clients);
  return first(client?.individual_client_details)?.full_name ?? first(client?.company_client_details)?.legal_name ?? "";
}

/** Linha da view finance_agreement_list (064): contrato + rótulos + totais do livro, tudo do banco. */
export interface AgreementListRow extends AgreementRow {
  fee_model_name: string | null;
  case_title: string | null;
  case_origin_organization_id: string | null;
  client_name: string | null;
  process_title: string | null;
  cnj_number: string | null;
  in_process_totals: boolean;
  contracted: Numeric;
  received: Numeric;
  outstanding: Numeric;
  overdue: Numeric;
  open_payments: number;
  next_due_date: string | null;
}

export interface TransferRow {
  id: string;
  partner_organization_id: string;
  amount: Numeric;
  status: TransferStatus;
  paid_at: string | null;
  reference: string | null;
  registered_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type TransferPartnerRow = Pick<TransferRow, "id" | "amount" | "status" | "paid_at" | "reference" | "cancelled_at" | "created_at">;

export interface TransferItemRow {
  allocation_id: string;
  amount: Numeric;
  created_at: string;
}

/** Linha da view partner_allocation_balances (só divisões de entrada). */
export interface AllocationBalanceRow {
  allocation_id: string;
  case_partnership_agreement_id: string;
  net_partner_amount: Numeric;
  transferred_amount: Numeric;
  paid_amount: Numeric;
}

/* ------------------------------------------------------------------ */
/* Banco → DTO                                                         */
/* ------------------------------------------------------------------ */

export function feeModelFromRow(r: FeeModelRow): FeeModelDTO {
  return {
    id: r.id,
    name: r.name,
    description: opt(r.description),
    legalAreaId: opt(r.legal_area_id),
    upfrontFee: optMoney(r.upfront_fee),
    fixedFee: optMoney(r.fixed_fee),
    installments: opt(r.installments),
    monthlyFee: optMoney(r.monthly_fee),
    successFeePercent: optMoney(r.success_fee_percentage),
    billingMoment: r.billing_moment,
    notes: opt(r.notes),
    active: r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function agreementFromRow(r: AgreementRow): FinancialAgreementDTO {
  return {
    id: r.id,
    legalCaseId: r.legal_case_id,
    legalProcessId: opt(r.legal_process_id),
    feeModelId: opt(r.fee_model_id),
    upfrontFee: optMoney(r.upfront_fee),
    fixedFee: optMoney(r.fixed_fee),
    installments: opt(r.installments),
    monthlyFee: optMoney(r.monthly_fee),
    successFeePercent: optMoney(r.success_fee_percentage),
    currency: r.currency.trim(),
    startDate: opt(r.start_date),
    status: r.status,
    notes: opt(r.notes),
    createdBy: opt(r.created_by),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    reopenedAt: opt(r.reopened_at),
    reopenReason: opt(r.reopen_reason),
  };
}

/** Junta a situação derivada (view) com os dados descritivos da obrigação. */
export function paymentFromRows(b: PaymentBalanceRow, p: PaymentRow | undefined): PaymentDTO {
  return {
    id: b.payment_id,
    agreementId: b.financial_agreement_id,
    legalCaseId: b.legal_case_id,
    amount: money(b.amount),
    currency: b.currency.trim(),
    dueDate: opt(b.due_date),
    paymentType: p?.payment_type ?? "OTHER",
    description: opt(p?.description),
    receivedAmount: money(b.received_amount),
    balance: money(b.balance),
    lastReceiptAt: opt(b.last_receipt_at),
    status: b.status,
    uiStatus: paymentStatusFromDb(b.status),
    cancelledAt: opt(p?.cancelled_at),
    cancellationReason: opt(p?.cancellation_reason),
    createdAt: p?.created_at ?? "",
  };
}

export function receiptFromRow(r: ReceiptRow): ReceiptDTO {
  return {
    id: r.id,
    sequence: Number(r.sequence),
    paymentId: r.payment_id,
    kind: r.kind,
    amount: money(r.amount),
    currency: r.currency.trim(),
    occurredAt: r.occurred_at,
    originalReceiptId: opt(r.original_receipt_id),
    method: opt(r.method),
    notes: opt(r.notes),
    createdBy: opt(r.created_by),
    createdAt: r.created_at,
  };
}

export function allocationFromRow(r: AllocationRow): AllocationDTO {
  return {
    id: r.id,
    sequence: Number(r.sequence),
    receiptId: r.receipt_id,
    casePartnershipAgreementId: r.case_partnership_agreement_id,
    reversesAllocationId: opt(r.reverses_allocation_id),
    baseAmount: money(r.base_amount),
    partnerPercentage: money(r.partner_percentage),
    partnerAmount: money(r.partner_amount),
    ownerAmount: money(r.owner_amount),
    createdAt: r.created_at,
  };
}

export function partnershipInternalFromRow(r: PartnershipRow): CasePartnershipInternalDTO {
  return {
    id: r.id,
    legalCaseId: r.legal_case_id,
    partnerOrganizationId: r.partner_organization_id,
    partnerPercentage: money(r.partner_percentage),
    ownerPercentage: money(r.owner_percentage),
    effectiveAt: r.effective_at,
    status: r.cancelled_at ? "CANCELLED" : "ACTIVE",
    createdBy: opt(r.created_by),
    createdAt: r.created_at,
    cancelledAt: opt(r.cancelled_at),
    cancelledBy: opt(r.cancelled_by),
    cancellationReason: opt(r.cancellation_reason),
  };
}

/**
 * Snapshot para o parceiro. Monta o objeto campo a campo (nunca `...row`): o
 * que não está listado aqui não sai, mesmo que a linha traga mais colunas.
 */
export function partnershipPartnerFromRow(r: PartnershipPartnerRow): CasePartnershipPartnerDTO {
  return {
    id: r.id,
    legalCaseId: r.legal_case_id,
    partnerPercentage: money(r.partner_percentage),
    effectiveAt: r.effective_at,
    status: r.cancelled_at ? "CANCELLED" : "ACTIVE",
    cancelledAt: opt(r.cancelled_at),
  };
}

export function transferItemFromRow(r: TransferItemRow): TransferItemDTO {
  return { allocationId: r.allocation_id, amount: money(r.amount), createdAt: r.created_at };
}

export function transferInternalFromRow(r: TransferRow, items?: TransferItemRow[]): TransferInternalDTO {
  return {
    id: r.id,
    partnerOrganizationId: r.partner_organization_id,
    amount: money(r.amount),
    status: r.status,
    paidAt: opt(r.paid_at),
    reference: opt(r.reference),
    registeredBy: opt(r.registered_by),
    cancelledAt: opt(r.cancelled_at),
    cancellationReason: opt(r.cancellation_reason),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(items ? { items: items.map(transferItemFromRow) } : {}),
  };
}

/** Repasse para o parceiro: sem quem registrou nem motivo interno. Campo a campo. */
export function transferPartnerFromRow(r: TransferPartnerRow): TransferPartnerDTO {
  return {
    id: r.id,
    amount: money(r.amount),
    status: r.status,
    paidAt: opt(r.paid_at),
    reference: opt(r.reference),
    cancelledAt: opt(r.cancelled_at),
    createdAt: r.created_at,
  };
}

/** Soma (em centavos) das colunas JÁ derivadas pelo banco para cada divisão. */
export function shareTotals(rows: Pick<AllocationBalanceRow, "net_partner_amount" | "transferred_amount" | "paid_amount">[]): PartnerShareTotals {
  let net = 0;
  let transferred = 0;
  let paid = 0;
  for (const r of rows) {
    net += toCents(r.net_partner_amount);
    transferred += toCents(r.transferred_amount);
    paid += toCents(r.paid_amount);
  }
  return {
    accruedAmount: fromCents(net),
    pendingTransferAmount: fromCents(transferred - paid),
    paidOutAmount: fromCents(paid),
    availableAmount: fromCents(net - transferred),
  };
}

export function agreementShareFromRows(agreement: PartnershipPartnerRow, balances: AllocationBalanceRow[], totals: { case_partnership_agreement_id: string; eligible_revenue: number | string }[] = []): PartnerAgreementShareDTO {
  const own = balances.filter((b) => b.case_partnership_agreement_id === agreement.id);
  const eligible = totals.find((t) => t.case_partnership_agreement_id === agreement.id);
  return {
    agreementId: agreement.id,
    legalCaseId: agreement.legal_case_id,
    caseTitle: first(agreement.legal_cases)?.title,
    partnerPercentage: money(agreement.partner_percentage),
    effectiveAt: agreement.effective_at,
    status: agreement.cancelled_at ? "CANCELLED" : "ACTIVE",
    cancelledAt: opt(agreement.cancelled_at),
    ...shareTotals(own),
    eligibleRevenue: eligible ? fromCents(toCents(eligible.eligible_revenue)) : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Totais (somados no servidor sobre o que o banco derivou)            */
/* ------------------------------------------------------------------ */

/** Totais que o banco já somou (colunas da view ou do JSON de finance_summary). */
function totalsFrom(t: { contracted: Numeric; received: Numeric; outstanding: Numeric; overdue: Numeric; open_payments: number }): FinanceTotals {
  return { contracted: money(t.contracted), received: money(t.received), outstanding: money(t.outstanding), overdue: money(t.overdue), openPayments: Number(t.open_payments) };
}

/** Linha da lista de contratos (view finance_agreement_list): nada é somado aqui. */
export function agreementListItemFromRow(row: AgreementListRow): AgreementListItemDTO {
  return {
    ...agreementFromRow(row),
    caseTitle: row.case_title ?? "",
    clientName: row.client_name ?? "",
    processTitle: opt(row.process_title),
    cnjNumber: opt(row.cnj_number),
    caseOriginOrganizationId: opt(row.case_origin_organization_id),
    feeModelName: opt(row.fee_model_name),
    totals: totalsFrom(row),
    nextDueDate: opt(row.next_due_date),
    inProcessTotals: row.in_process_totals,
  };
}

/** JSON de public.finance_summary (064). */
export interface FinanceSummaryRaw {
  totals: { contracted: Numeric; received: Numeric; outstanding: Numeric; overdue: Numeric; open_payments: number };
  outside: { contracted: Numeric; received: Numeric; outstanding: Numeric; overdue: Numeric; open_payments: number };
  /** 071: contratos em rascunho, à parte. Banco antigo (sem o bloco): zero. */
  draft?: { contracted: Numeric; received: Numeric; outstanding: Numeric; overdue: Numeric; open_payments: number };
  agreements_by_status: Record<AgreementDbStatus, number>;
  monthly: { month: string; amount: Numeric }[];
}

export function financeSummaryFromRaw(raw: FinanceSummaryRaw, byFeeModel: ContractedByModelPoint[]): FinanceSummaryDTO {
  const count = (status: AgreementDbStatus) => Number(raw.agreements_by_status?.[status] ?? 0);
  return {
    totals: totalsFrom(raw.totals),
    outside: totalsFrom(raw.outside),
    draft: totalsFrom(raw.draft ?? { contracted: 0, received: 0, outstanding: 0, overdue: 0, open_payments: 0 }),
    agreementsByStatus: { DRAFT: count("DRAFT"), ACTIVE: count("ACTIVE"), COMPLETED: count("COMPLETED"), CANCELLED: count("CANCELLED") },
    monthly: (raw.monthly ?? []).map((m) => ({ month: m.month, amount: money(m.amount) })),
    byFeeModel,
    truncated: false,
  };
}

/** Linha da view finance_receipt_statement (064). */
export interface ReceiptStatementRow {
  receipt_id: string;
  sequence: number;
  kind: ReceiptKind;
  amount: Numeric;
  currency: string;
  occurred_at: string;
  occurred_on: string;
  method: string | null;
  notes: string | null;
  payment_id: string;
  payment_type: PaymentType;
  payment_description: string | null;
  financial_agreement_id: string;
  legal_case_id: string;
  legal_process_id: string | null;
  client_name: string | null;
  case_title: string | null;
  process_title: string | null;
  cnj_number: string | null;
}

export function receiptStatementItemFromRow(r: ReceiptStatementRow): ReceiptStatementItemDTO {
  return {
    receiptId: r.receipt_id,
    sequence: Number(r.sequence),
    kind: r.kind,
    amount: money(r.amount),
    currency: r.currency.trim(),
    occurredAt: r.occurred_at,
    occurredOn: r.occurred_on,
    method: opt(r.method),
    notes: opt(r.notes),
    paymentId: r.payment_id,
    paymentType: r.payment_type,
    paymentDescription: opt(r.payment_description),
    agreementId: r.financial_agreement_id,
    legalCaseId: r.legal_case_id,
    legalProcessId: opt(r.legal_process_id),
    clientName: r.client_name ?? "",
    caseTitle: r.case_title ?? "",
    processTitle: opt(r.process_title),
    cnjNumber: opt(r.cnj_number),
  };
}

export function receiptStatementTotalsFromRaw(raw: { count: number; received: Numeric; deducted: Numeric; net: Numeric } | null | undefined): ReceiptStatementTotalsDTO {
  return { count: Number(raw?.count ?? 0), received: money(raw?.received ?? 0), deducted: money(raw?.deducted ?? 0), net: money(raw?.net ?? 0) };
}

/** Linha da view finance_receivables (064). */
export interface ReceivableRow {
  payment_id: string;
  financial_agreement_id: string;
  legal_case_id: string;
  legal_process_id: string | null;
  agreement_status: AgreementDbStatus;
  amount: Numeric;
  received_amount: Numeric;
  balance: Numeric;
  currency: string;
  due_date: string | null;
  status: DbPaymentStatus;
  days_overdue: number | null;
  payment_type: PaymentType;
  description: string | null;
  client_name: string | null;
  case_title: string | null;
  process_title: string | null;
  cnj_number: string | null;
  in_process_totals: boolean;
}

export function receivableFromRow(r: ReceivableRow): ReceivableItemDTO {
  return {
    paymentId: r.payment_id,
    agreementId: r.financial_agreement_id,
    legalCaseId: r.legal_case_id,
    legalProcessId: opt(r.legal_process_id),
    agreementStatus: r.agreement_status,
    amount: money(r.amount),
    receivedAmount: money(r.received_amount),
    balance: money(r.balance),
    currency: r.currency.trim(),
    dueDate: opt(r.due_date),
    status: r.status,
    daysOverdue: r.days_overdue === null || r.days_overdue === undefined ? undefined : Number(r.days_overdue),
    paymentType: r.payment_type,
    description: opt(r.description),
    clientName: r.client_name ?? "",
    caseTitle: r.case_title ?? "",
    processTitle: opt(r.process_title),
    cnjNumber: opt(r.cnj_number),
    inProcessTotals: r.in_process_totals,
  };
}

export function receivablesTotalsFromRaw(
  raw: { count: number; total: Numeric; overdue: Numeric; overdue_count: number; outside_totals: Numeric; draft_total?: Numeric; draft_count?: number } | null | undefined,
): ReceivablesTotalsDTO {
  return {
    count: Number(raw?.count ?? 0),
    total: money(raw?.total ?? 0),
    overdue: money(raw?.overdue ?? 0),
    overdueCount: Number(raw?.overdue_count ?? 0),
    outsideTotals: money(raw?.outside_totals ?? 0),
    draftTotal: money(raw?.draft_total ?? 0),
    draftCount: Number(raw?.draft_count ?? 0),
  };
}

const MONTH_SP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" });

/** "2026-10" no fuso de São Paulo. */
export function monthKey(iso: string): string {
  return MONTH_SP.format(new Date(iso)).slice(0, 7);
}

/** Últimos `count` meses (inclusive o de `now`), do mais antigo ao atual. */
export function lastMonths(now: Date, count = 12): string[] {
  const [y, m] = monthKey(now.toISOString()).split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/* ------------------------------------------------------------------ */
/* Domínio → colunas (insert/update)                                   */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

const FEE_TERMS_TO_COLUMN = {
  upfrontFee: "upfront_fee",
  fixedFee: "fixed_fee",
  installments: "installments",
  monthlyFee: "monthly_fee",
  successFeePercent: "success_fee_percentage",
} as const;

const FEE_MODEL_TO_COLUMN: Record<string, string> = {
  name: "name",
  description: "description",
  legalAreaId: "legal_area_id",
  ...FEE_TERMS_TO_COLUMN,
  billingMoment: "billing_moment",
  notes: "notes",
  active: "active",
};

const AGREEMENT_TO_COLUMN: Record<string, string> = {
  feeModelId: "fee_model_id",
  ...FEE_TERMS_TO_COLUMN,
  startDate: "start_date",
  notes: "notes",
};

/** Copia só as chaves PRESENTES (PATCH); undefined/null viram null. */
function columns(source: Record<string, unknown>, map: Record<string, string>): Json {
  const out: Json = {};
  for (const [field, column] of Object.entries(map)) {
    if (field in source) out[column] = source[field] ?? null;
  }
  return out;
}

export function feeModelInsert(input: CreateFeeModelInput): Json {
  return columns(input as unknown as Record<string, unknown>, FEE_MODEL_TO_COLUMN);
}

export function feeModelUpdate(patch: UpdateFeeModelInput["patch"]): Json {
  return columns(patch as Record<string, unknown>, FEE_MODEL_TO_COLUMN);
}

/**
 * Colunas do acordo. Status e autor NUNCA vêm do input: status é decidido pelo
 * service, autor pelo banco. O caso vem do PROCESSO, lido no servidor.
 */
export function agreementInsert(input: CreateAgreementInput, actorId: ID, legalCaseId: ID): Json {
  const { activate, legalProcessId, ...rest } = input;
  return {
    legal_case_id: legalCaseId,
    legal_process_id: legalProcessId,
    ...columns(rest as Record<string, unknown>, AGREEMENT_TO_COLUMN),
    status: activate ? "ACTIVE" : "DRAFT",
    created_by: actorId,
  };
}

export function agreementUpdate(patch: UpdateAgreementInput["patch"]): Json {
  return columns(patch as Record<string, unknown>, AGREEMENT_TO_COLUMN);
}

/** Histórico de repasses de um caso: um item por repasse (somado se o repasse tiver várias divisões do caso), mais recentes primeiro. */
export function shareTransfersFromRows(items: { transfer_id: string; amount: number | string; partner_transfers: unknown }[]): PartnerShareTransferDTO[] {
  const byTransfer = new Map<string, PartnerShareTransferDTO>();
  for (const it of items) {
    const t = first(it.partner_transfers as { status: string; created_at: string; paid_at: string | null; reference: string | null } | { status: string; created_at: string; paid_at: string | null; reference: string | null }[] | null);
    if (!t) continue;
    const current = byTransfer.get(it.transfer_id);
    const cents = toCents(it.amount) + (current ? toCents(current.amount) : 0);
    byTransfer.set(it.transfer_id, {
      transferId: it.transfer_id,
      amount: fromCents(cents),
      status: t.status as PartnerShareTransferDTO["status"],
      createdAt: t.created_at,
      paidAt: opt(t.paid_at),
      reference: opt(t.reference),
    });
  }
  return [...byTransfer.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export const NO_FEE_MODEL_LABEL = "Sem modelo (valores próprios)";

/**
 * Pontos do gráfico "Contratado por modelo": maior para menor; acima de 5
 * modelos, os 4 maiores + "Outros" (como no Front V1). Centavos inteiros.
 */
export function compositionByFeeModel(rows: { fee_model_id: string | null; fee_model_name: string | null; agreement_count: number; contracted_amount: number | string }[]): ContractedByModelPoint[] {
  const points = rows
    .map((r) => ({ name: r.fee_model_id ? (r.fee_model_name ?? "Modelo") : NO_FEE_MODEL_LABEL, feeModelId: r.fee_model_id, cents: toCents(r.contracted_amount), count: Number(r.agreement_count) }))
    .filter((p) => p.count > 0)
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  const out = points.length <= 5 ? points : [...points.slice(0, 4), points.slice(4).reduce((acc, p) => ({ ...acc, cents: acc.cents + p.cents, count: acc.count + p.count }), { name: "Outros", feeModelId: null, cents: 0, count: 0 })];
  return out.map((p) => ({ name: p.name, feeModelId: p.feeModelId, total: fromCents(p.cents), count: p.count }));
}

/* ------------------------------------------------------------------ */
/* Financeiro por processo (Roadmap 2.0, 046)                          */
/* ------------------------------------------------------------------ */

/** Linha da view process_finance_overview (tudo somado no banco). */
export interface ProcessFinanceRow {
  legal_process_id: string;
  legal_case_id: string;
  client_id: string;
  client_name: string | null;
  cnj_number: string | null;
  display_title: string | null;
  case_title: string | null;
  status: ProcessStatus;
  phase: ProcessPhase | null;
  created_at: string;
  case_value: Numeric | null;
  fee_amount: Numeric | null;
  fee_percentage: Numeric | null;
  partner_organization_id: string | null;
  partner_percentage: Numeric;
  owner_percentage: Numeric;
  fee_owner_share: Numeric;
  fee_partner_share: Numeric;
  contracted: Numeric;
  received: Numeric;
  open_balance: Numeric;
  overdue: Numeric;
  agreement_count: number;
  received_partner_share: Numeric;
  received_owner_share: Numeric;
  expenses_total: Numeric;
  expenses_paid: Numeric;
  expenses_open: Numeric;
  expenses_reimbursable: Numeric;
  expense_count: number;
  net_result: Numeric;
}

/** Linha da view process_finance_totals. */
export interface ProcessFinanceTotalsRow {
  process_count: number;
  case_value_total: Numeric;
  fee_total: Numeric;
  fee_owner_total: Numeric;
  fee_partner_total: Numeric;
  contracted_total: Numeric;
  received_total: Numeric;
  received_owner_total: Numeric;
  received_partner_total: Numeric;
  open_total: Numeric;
  overdue_total: Numeric;
  expenses_total: Numeric;
  expenses_paid_total: Numeric;
  expenses_open_total: Numeric;
  net_result_total: Numeric;
}

export interface ExpenseRow {
  id: string;
  legal_process_id: string;
  legal_case_id: string;
  category: ExpenseCategory;
  description: string;
  amount: Numeric;
  currency: string;
  incurred_on: string;
  paid_on: string | null;
  reimbursable: boolean;
  supplier: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  /** Rótulos do processo (embed de leitura, só na lista geral). */
  legal_processes?: Many<{ title: string | null; cnj_number: string | null; legal_cases?: Many<CaseEmbed> }>;
}

const zeroMoney = (v: Numeric | null | undefined): number => (v === null || v === undefined ? 0 : money(v));

export function processFinanceFromRow(r: ProcessFinanceRow): ProcessFinanceDTO {
  return {
    legalProcessId: r.legal_process_id,
    legalCaseId: r.legal_case_id,
    clientId: r.client_id,
    clientName: r.client_name ?? "",
    cnjNumber: opt(r.cnj_number),
    title: r.display_title?.trim() || r.case_title || "",
    caseTitle: r.case_title ?? "",
    status: r.status,
    phase: opt(r.phase),
    createdAt: r.created_at,
    caseValue: optMoney(r.case_value),
    feeAmount: optMoney(r.fee_amount),
    feePercentage: optMoney(r.fee_percentage),
    partnerOrganizationId: opt(r.partner_organization_id),
    partnerPercentage: zeroMoney(r.partner_percentage),
    ownerPercentage: r.owner_percentage === null || r.owner_percentage === undefined ? 100 : money(r.owner_percentage),
    feeOwnerShare: zeroMoney(r.fee_owner_share),
    feePartnerShare: zeroMoney(r.fee_partner_share),
    contracted: zeroMoney(r.contracted),
    received: zeroMoney(r.received),
    openBalance: zeroMoney(r.open_balance),
    overdue: zeroMoney(r.overdue),
    agreementCount: Number(r.agreement_count ?? 0),
    receivedPartnerShare: zeroMoney(r.received_partner_share),
    receivedOwnerShare: zeroMoney(r.received_owner_share),
    expensesTotal: zeroMoney(r.expenses_total),
    expensesPaid: zeroMoney(r.expenses_paid),
    expensesOpen: zeroMoney(r.expenses_open),
    expensesReimbursable: zeroMoney(r.expenses_reimbursable),
    expenseCount: Number(r.expense_count ?? 0),
    netResult: zeroMoney(r.net_result),
  };
}

/** Totais (uma linha). Sem linha (sem acesso) = zeros. */
export function processFinanceTotalsFromRow(r: ProcessFinanceTotalsRow | null | undefined): ProcessFinanceTotalsDTO {
  return {
    processCount: Number(r?.process_count ?? 0),
    caseValueTotal: zeroMoney(r?.case_value_total),
    feeTotal: zeroMoney(r?.fee_total),
    feeOwnerTotal: zeroMoney(r?.fee_owner_total),
    feePartnerTotal: zeroMoney(r?.fee_partner_total),
    contractedTotal: zeroMoney(r?.contracted_total),
    receivedTotal: zeroMoney(r?.received_total),
    receivedOwnerTotal: zeroMoney(r?.received_owner_total),
    receivedPartnerTotal: zeroMoney(r?.received_partner_total),
    openTotal: zeroMoney(r?.open_total),
    overdueTotal: zeroMoney(r?.overdue_total),
    expensesTotal: zeroMoney(r?.expenses_total),
    expensesPaidTotal: zeroMoney(r?.expenses_paid_total),
    expensesOpenTotal: zeroMoney(r?.expenses_open_total),
    netResultTotal: zeroMoney(r?.net_result_total),
  };
}

/** Situação derivada: cancelada › paga › a pagar. */
export function expenseStatusOf(r: Pick<ExpenseRow, "cancelled_at" | "paid_on">): ExpenseStatus {
  if (r.cancelled_at) return "CANCELLED";
  return r.paid_on ? "PAID" : "OPEN";
}

export function expenseFromRow(r: ExpenseRow): ExpenseDTO {
  const process = first(r.legal_processes);
  const legalCase = first(process?.legal_cases);
  return {
    id: r.id,
    legalProcessId: r.legal_process_id,
    legalCaseId: r.legal_case_id,
    category: r.category,
    description: r.description,
    amount: money(r.amount),
    currency: r.currency.trim(),
    incurredOn: r.incurred_on,
    paidOn: opt(r.paid_on),
    reimbursable: r.reimbursable,
    supplier: opt(r.supplier),
    notes: opt(r.notes),
    status: expenseStatusOf(r),
    createdBy: opt(r.created_by),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    cancelledAt: opt(r.cancelled_at),
    cancellationReason: opt(r.cancellation_reason),
    ...(process
      ? {
          processTitle: process.title?.trim() || legalCase?.title || undefined,
          cnjNumber: opt(process.cnj_number),
          clientName: legalCase ? clientNameOf(legalCase) || undefined : undefined,
        }
      : {}),
  };
}

const EXPENSE_TO_COLUMN: Record<string, string> = {
  category: "category",
  description: "description",
  amount: "amount",
  incurredOn: "incurred_on",
  paidOn: "paid_on",
  reimbursable: "reimbursable",
  supplier: "supplier",
  notes: "notes",
};

/**
 * Colunas da despesa nova. Processo do input; CASO lido do processo no
 * servidor (o banco também o sobrescreve); autor da sessão. Nasce ativa.
 */
export function expenseInsert(input: CreateExpenseInput, legalCaseId: ID, actorId: ID): Json {
  const { processId, ...rest } = input;
  return {
    legal_process_id: processId,
    legal_case_id: legalCaseId,
    ...columns(rest as Record<string, unknown>, EXPENSE_TO_COLUMN),
    reimbursable: input.reimbursable ?? false,
    created_by: actorId,
  };
}

export function expenseUpdate(patch: UpdateExpenseInput["patch"]): Json {
  return columns(patch as Record<string, unknown>, EXPENSE_TO_COLUMN);
}

/**
 * Despesas por categoria (pagas × a pagar; canceladas fora) — maior total
 * primeiro, sem categoria vazia. Centavos inteiros.
 */
export function expensesByCategory(rows: Pick<ExpenseRow, "category" | "amount" | "paid_on" | "cancelled_at">[]): ExpenseCategoryPoint[] {
  const acc = new Map<ExpenseCategory, { paid: number; open: number; count: number }>();
  for (const r of rows) {
    if (r.cancelled_at) continue;
    const cur = acc.get(r.category) ?? { paid: 0, open: 0, count: 0 };
    if (r.paid_on) cur.paid += toCents(r.amount);
    else cur.open += toCents(r.amount);
    cur.count += 1;
    acc.set(r.category, cur);
  }
  const points: ExpenseCategoryPoint[] = [];
  for (const category of EXPENSE_CATEGORIES) {
    const v = acc.get(category);
    if (v) points.push({ category, paid: fromCents(v.paid), open: fromCents(v.open), total: fromCents(v.paid + v.open), count: v.count });
  }
  return points.sort((a, b) => b.total - a.total);
}

/** Despesas PAGAS por mês (data do pagamento — data civil, sem fuso). Canceladas fora. */
export function monthlyPaidExpenses(rows: Pick<ExpenseRow, "amount" | "paid_on" | "cancelled_at">[], months: string[]): { month: string; amount: number }[] {
  const byMonth = new Map(months.map((m) => [m, 0]));
  for (const r of rows) {
    if (r.cancelled_at || !r.paid_on) continue;
    const key = r.paid_on.slice(0, 7);
    if (byMonth.has(key)) byMonth.set(key, (byMonth.get(key) ?? 0) + toCents(r.amount));
  }
  return months.map((month) => ({ month, amount: fromCents(byMonth.get(month) ?? 0) }));
}
