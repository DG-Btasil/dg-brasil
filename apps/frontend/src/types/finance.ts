import type { AgreementStatus, BillingMoment, PaymentStatus } from "@/lib/constants/status";
import type { LegalArea } from "@/lib/constants/legal";
import type { ID, ISODate, ISODateTime, OfficeScoped } from "./common";

/**
 * Dados financeiros internos. Visíveis apenas para quem tem "finance.view".
 * Não confundir com Process.caseValue, que é dado jurídico.
 */
export interface FeeModel extends OfficeScoped {
  name: string;
  description?: string;
  area?: LegalArea;
  upfrontFee?: number;
  fixedFee?: number;
  installments?: number;
  monthlyFee?: number;
  successFeePercent?: number;
  billingMoment: BillingMoment;
  notes?: string;
  active: boolean;
  updatedAt: ISODateTime;
}

/**
 * Contrato de honorários. NÃO guarda status: ele é derivado das parcelas
 * (lib/domain/finance.ts). Só o cancelamento é decisão manual.
 */
export interface FinancialAgreement extends OfficeScoped {
  clientId: ID;
  processId?: ID;
  feeModelId?: ID;
  /** true quando os valores foram ajustados para este cliente. */
  customized: boolean;
  upfrontFee: number;
  fixedFee: number;
  installments: number;
  monthlyFee?: number;
  successFeePercent?: number;
  totalContracted: number;
  estimatedSuccessFee?: number;
  cancelledAt?: ISODateTime;
  startDate: ISODate;
  notes?: string;
  createdAt: ISODateTime;
}

/**
 * Parcela. Os FATOS ficam gravados (valor, vencimento, quanto foi pago e
 * quando); o status é calculado a partir deles, nunca armazenado.
 */
export interface Payment extends OfficeScoped {
  agreementId: ID;
  description: string;
  amount: number;
  dueDate: ISODate;
  /** Total recebido para esta parcela. 0 = nada recebido. */
  paidAmount: number;
  /** Data do último recebimento registrado. */
  paidAt?: ISODateTime;
}

/** Parcela com os valores derivados (status e saldo). Só existe em leitura. */
export interface PaymentView extends Payment {
  status: PaymentStatus;
  balance: number;
}

/** Contrato com o status derivado. Só existe em leitura. */
export interface AgreementView extends FinancialAgreement {
  status: AgreementStatus;
}

/** Visão consolidada calculada a partir de acordo + pagamentos. */
export interface AgreementSummary {
  agreement: AgreementView;
  received: number;
  outstandingBalance: number;
  overdueAmount: number;
  nextDueDate?: ISODate;
}
