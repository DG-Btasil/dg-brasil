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
  status: AgreementStatus;
  startDate: ISODate;
  notes?: string;
  createdAt: ISODateTime;
}

export interface Payment extends OfficeScoped {
  agreementId: ID;
  description: string;
  amount: number;
  dueDate: ISODate;
  paidAt?: ISODateTime;
  status: PaymentStatus;
}

/** Visão consolidada calculada a partir de acordo + pagamentos. */
export interface AgreementSummary {
  agreement: FinancialAgreement;
  received: number;
  outstandingBalance: number;
  overdueAmount: number;
  nextDueDate?: ISODate;
}
