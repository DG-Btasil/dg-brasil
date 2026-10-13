import type { BillingMoment } from "@/lib/constants/status";
import { paymentStatusFromDb, type DbPaymentStatus } from "@/repositories/api/db-mappings";
import type { ID } from "@/types";
import type {
  AgreementDbStatus,
  AllocationDTO,
  CasePartnershipInternalDTO,
  CasePartnershipPartnerDTO,
  FeeModelDTO,
  FinancialAgreementDTO,
  PartnerAgreementShareDTO,
  PartnerShareTotals,
  PaymentDTO,
  PaymentType,
  ReceiptDTO,
  ReceiptKind,
  TransferInternalDTO,
  TransferItemDTO,
  TransferPartnerDTO,
  TransferStatus,
} from "./dto";
import type { CreateAgreementInput, CreateFeeModelInput, UpdateAgreementInput, UpdateFeeModelInput } from "./schemas";

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
export type PartnershipPartnerRow = Pick<PartnershipRow, "id" | "legal_case_id" | "partner_percentage" | "effective_at" | "cancelled_at">;

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

export function agreementShareFromRows(agreement: PartnershipPartnerRow, balances: AllocationBalanceRow[]): PartnerAgreementShareDTO {
  const own = balances.filter((b) => b.case_partnership_agreement_id === agreement.id);
  return {
    agreementId: agreement.id,
    legalCaseId: agreement.legal_case_id,
    partnerPercentage: money(agreement.partner_percentage),
    effectiveAt: agreement.effective_at,
    status: agreement.cancelled_at ? "CANCELLED" : "ACTIVE",
    cancelledAt: opt(agreement.cancelled_at),
    ...shareTotals(own),
  };
}

/** Saldo disponível de uma divisão segundo o banco (líquido − em repasse não cancelado). */
export function availableCents(row: Pick<AllocationBalanceRow, "net_partner_amount" | "transferred_amount">): number {
  return toCents(row.net_partner_amount) - toCents(row.transferred_amount);
}

/**
 * Escolhe as divisões que cobrem o valor do repasse, na ordem recebida (o
 * repositório entrega as mais antigas primeiro). Não calcula divisão: só
 * consome o saldo que o banco já informou. null = saldo insuficiente.
 */
export function pickTransferItems(
  rows: Pick<AllocationBalanceRow, "allocation_id" | "net_partner_amount" | "transferred_amount">[],
  amount: number,
): { allocationId: ID; amount: number }[] | null {
  let remaining = toCents(amount);
  const items: { allocationId: ID; amount: number }[] = [];
  for (const r of rows) {
    if (remaining <= 0) break;
    const available = availableCents(r);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    items.push({ allocationId: r.allocation_id, amount: fromCents(take) });
    remaining -= take;
  }
  return remaining > 0 ? null : items;
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

/** Colunas do acordo. Status e autor NUNCA vêm do input: status é decidido pelo service, autor pelo banco. */
export function agreementInsert(input: CreateAgreementInput, actorId: ID): Json {
  const { activate, legalCaseId, ...rest } = input;
  return {
    legal_case_id: legalCaseId,
    ...columns(rest as Record<string, unknown>, AGREEMENT_TO_COLUMN),
    status: activate ? "ACTIVE" : "DRAFT",
    created_by: actorId,
  };
}

export function agreementUpdate(patch: UpdateAgreementInput["patch"]): Json {
  return columns(patch as Record<string, unknown>, AGREEMENT_TO_COLUMN);
}
