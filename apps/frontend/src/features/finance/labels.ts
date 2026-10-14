import type { Tone } from "@/lib/constants/status";
import type { DbPaymentStatus } from "@/repositories/api/db-mappings";
import type { AgreementDbStatus, PaymentType, ReceiptKind, TransferStatus } from "@/server/domain/finance/dto";
import type { RECEIPT_METHODS } from "@/server/domain/finance/schemas";

/** Vocabulário do banco (ciclo de vida é decisão, não valor derivado). */
export const AGREEMENT_DB_STATUS_LABEL: Record<AgreementDbStatus, string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativo",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};
export const AGREEMENT_DB_STATUS_TONE: Record<AgreementDbStatus, Tone> = { DRAFT: "neutral", ACTIVE: "success", COMPLETED: "navy", CANCELLED: "danger" };

/** Situação da obrigação, derivada do ledger (view payment_balances). */
export const PAYMENT_DB_STATUS_LABEL: Record<DbPaymentStatus, string> = {
  PENDING: "A vencer",
  PARTIAL: "Parcialmente recebida",
  PAID: "Recebida",
  OVERDUE: "Em atraso",
  CANCELLED: "Cancelada",
};
export const PAYMENT_DB_STATUS_TONE: Record<DbPaymentStatus, Tone> = { PENDING: "info", PARTIAL: "warning", PAID: "success", OVERDUE: "danger", CANCELLED: "neutral" };

export const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  UPFRONT: "Entrada",
  FIXED: "Parcela do valor fixo",
  MONTHLY: "Mensalidade",
  SUCCESS_FEE: "Êxito",
  OTHER: "Outra",
};

export const RECEIPT_KIND_LABEL: Record<ReceiptKind, string> = { RECEIPT: "Recebimento", ADJUSTMENT: "Ajuste", REVERSAL: "Estorno" };

export const RECEIPT_METHOD_LABEL: Record<(typeof RECEIPT_METHODS)[number], string> = {
  PIX: "Pix",
  TED: "TED",
  DOC: "DOC",
  BOLETO: "Boleto",
  CARD: "Cartão",
  CASH: "Dinheiro",
  CHECK: "Cheque",
  OTHER: "Outro",
};

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = { PENDING: "Pendente", PAID: "Pago", CANCELLED: "Cancelado" };
export const TRANSFER_STATUS_TONE: Record<TransferStatus, Tone> = { PENDING: "warning", PAID: "success", CANCELLED: "neutral" };
