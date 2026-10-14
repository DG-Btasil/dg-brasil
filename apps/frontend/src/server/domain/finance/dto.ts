import type { BillingMoment, PaymentStatus } from "@/lib/constants/status";
import type { DbPaymentStatus } from "@/repositories/api/db-mappings";
import type { ID, ISODate, ISODateTime } from "@/types";
import type { AGREEMENT_DB_STATUSES, PAYMENT_TYPES, RECEIPT_KINDS, TRANSFER_STATUSES } from "./schemas";

/**
 * DTOs do financeiro POR SUPERFÍCIE.
 *
 * - Interno (ADMIN, `finance.view`): obrigação, ledger, divisão completa
 *   (parceiro e escritório), repasses com motivo de cancelamento.
 * - Portal do Parceiro (PARTNER_ADMIN, `partnerPortal.finance.view`): SÓ a
 *   participação do próprio escritório. Os tipos `Partner*` não têm campo para
 *   valor do escritório, base do recebimento, lançamento do ledger, obrigação
 *   ou acordo de honorários — não há como devolvê-los por engano.
 *
 * Não existe "valor pago" gravado: recebido, saldo e status vêm do ledger
 * (view payment_balances), sempre derivados.
 */

export type AgreementDbStatus = (typeof AGREEMENT_DB_STATUSES)[number];
export type PaymentType = (typeof PAYMENT_TYPES)[number];
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/* ------------------------------------------------------------------ */
/* Interno (ADMIN)                                                     */
/* ------------------------------------------------------------------ */

export interface FeeModelDTO {
  id: ID;
  name: string;
  description?: string;
  legalAreaId?: ID;
  upfrontFee?: number;
  fixedFee?: number;
  installments?: number;
  monthlyFee?: number;
  successFeePercent?: number;
  billingMoment: BillingMoment;
  notes?: string;
  active: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Acordo de honorários do caso. Status é o ciclo de vida do banco (decisão, não derivado). */
export interface FinancialAgreementDTO {
  id: ID;
  legalCaseId: ID;
  feeModelId?: ID;
  upfrontFee?: number;
  fixedFee?: number;
  installments?: number;
  monthlyFee?: number;
  successFeePercent?: number;
  currency: string;
  startDate?: ISODate;
  status: AgreementDbStatus;
  notes?: string;
  createdBy?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Totais de obrigações, todos derivados do ledger (view payment_balances), somados no servidor. */
export interface FinanceTotals {
  /** Soma das obrigações não canceladas. */
  contracted: number;
  received: number;
  /** Saldo das obrigações em aberto (pendente, parcial, vencida). */
  outstanding: number;
  /** Parte do saldo em aberto já vencida. */
  overdue: number;
  openPayments: number;
}

/** Linha da lista de acordos: acordo + rótulos do caso + totais do ledger. */
export interface AgreementListItemDTO extends FinancialAgreementDTO {
  caseTitle: string;
  clientName: string;
  caseOriginOrganizationId?: ID;
  feeModelName?: string;
  totals: FinanceTotals;
  /** Próximo vencimento em aberto. */
  nextDueDate?: ISODate;
}

/** Visão geral do financeiro (ADMIN). Agregado no servidor; `truncated` = passou do teto de leitura. */
export interface FinanceSummaryDTO {
  totals: FinanceTotals;
  agreementsByStatus: Record<AgreementDbStatus, number>;
  /** Recebido líquido por mês (America/Sao_Paulo), últimos 12 meses, do mais antigo ao atual. */
  monthly: { month: string; amount: number }[];
  truncated: boolean;
}

/** Obrigação + situação derivada do ledger. `receivedAmount` é SEMPRE derivado. */
export interface PaymentDTO {
  id: ID;
  agreementId: ID;
  legalCaseId: ID;
  amount: number;
  currency: string;
  dueDate?: ISODate;
  paymentType: PaymentType;
  description?: string;
  /** Soma líquida do ledger (entradas − estornos ± ajustes). */
  receivedAmount: number;
  balance: number;
  lastReceiptAt?: ISODateTime;
  /** Vocabulário do banco (payment_balances). */
  status: DbPaymentStatus;
  /** Vocabulário do front (paymentStatusFromDb). null = cancelada. */
  uiStatus: PaymentStatus | null;
  cancelledAt?: ISODateTime;
  cancellationReason?: string;
  createdAt: ISODateTime;
}

/** Lançamento do ledger. Imutável: corrigir = novo lançamento. */
export interface ReceiptDTO {
  id: ID;
  sequence: number;
  paymentId: ID;
  kind: ReceiptKind;
  /** Com sinal: estorno é negativo. */
  amount: number;
  currency: string;
  occurredAt: ISODateTime;
  originalReceiptId?: ID;
  method?: string;
  notes?: string;
  createdBy?: ID;
  createdAt: ISODateTime;
}

/** Resultado de um lançamento. `deduplicated` = clique repetido; nada novo foi gravado. */
export interface ReceiptResultDTO {
  receiptId: ID;
  deduplicated: boolean;
}

/** Divisão de um lançamento, gerada pelo banco. Visão interna completa. */
export interface AllocationDTO {
  id: ID;
  sequence: number;
  receiptId: ID;
  casePartnershipAgreementId: ID;
  reversesAllocationId?: ID;
  baseAmount: number;
  partnerPercentage: number;
  partnerAmount: number;
  ownerAmount: number;
  createdAt: ISODateTime;
}

/** Snapshot de parceria do caso, visão interna. */
export interface CasePartnershipInternalDTO {
  id: ID;
  legalCaseId: ID;
  partnerOrganizationId: ID;
  partnerPercentage: number;
  ownerPercentage: number;
  effectiveAt: ISODateTime;
  status: "ACTIVE" | "CANCELLED";
  createdBy?: ID;
  createdAt: ISODateTime;
  cancelledAt?: ISODateTime;
  cancelledBy?: ID;
  cancellationReason?: string;
}

export interface TransferItemDTO {
  allocationId: ID;
  amount: number;
  createdAt: ISODateTime;
}

export interface TransferInternalDTO {
  id: ID;
  partnerOrganizationId: ID;
  amount: number;
  status: TransferStatus;
  paidAt?: ISODateTime;
  reference?: string;
  registeredBy?: ID;
  cancelledAt?: ISODateTime;
  cancellationReason?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Só no detalhe. */
  items?: TransferItemDTO[];
}

/* ------------------------------------------------------------------ */
/* Portal do Parceiro (PARTNER_ADMIN) — só a própria participação      */
/* ------------------------------------------------------------------ */

/** Snapshot visto pelo parceiro: percentual DELE, sem dado do escritório. */
export interface CasePartnershipPartnerDTO {
  id: ID;
  legalCaseId: ID;
  partnerPercentage: number;
  effectiveAt: ISODateTime;
  status: "ACTIVE" | "CANCELLED";
  cancelledAt?: ISODateTime;
}

export type CasePartnershipDTO = { surface: "INTERNAL"; items: CasePartnershipInternalDTO[] } | { surface: "PARTNER"; items: CasePartnershipPartnerDTO[] };

/** Repasse visto pelo parceiro (sem quem registrou nem motivo interno de cancelamento). */
export interface TransferPartnerDTO {
  id: ID;
  amount: number;
  status: TransferStatus;
  paidAt?: ISODateTime;
  reference?: string;
  cancelledAt?: ISODateTime;
  createdAt: ISODateTime;
}

export type TransferListItemDTO = TransferInternalDTO | TransferPartnerDTO;

/** Totais da participação do parceiro. Todos derivados do banco (view partner_allocation_balances). */
export interface PartnerShareTotals {
  /** Parte líquida do parceiro (divisões de entrada − estornos). */
  accruedAmount: number;
  /** Em repasses PENDING (reservado, ainda não pago). */
  pendingTransferAmount: number;
  /** Em repasses PAID. */
  paidOutAmount: number;
  /** Ainda não incluído em nenhum repasse (líquido − em repasse não cancelado). */
  availableAmount: number;
}

/**
 * Resumo financeiro da parceria (Portal do Parceiro e visão do ADMIN sobre um
 * parceiro). NUNCA tem total do escritório, receita do caso, obrigação ou ledger.
 */
export interface PartnerFinanceDTO {
  partnerOrganizationId: ID;
  totals: PartnerShareTotals;
  agreementCount: number;
  activeAgreementCount: number;
}

/** Participação do parceiro em um caso (por snapshot). */
export interface PartnerAgreementShareDTO extends PartnerShareTotals {
  agreementId: ID;
  legalCaseId: ID;
  /** Título do caso, quando o parceiro tem acesso operacional a ele (RLS). */
  caseTitle?: string;
  partnerPercentage: number;
  effectiveAt: ISODateTime;
  status: "ACTIVE" | "CANCELLED";
  cancelledAt?: ISODateTime;
}
