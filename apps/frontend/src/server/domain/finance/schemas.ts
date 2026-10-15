import { z } from "zod";
import { BILLING_MOMENTS } from "@/lib/constants/status";
import { pageInputSchema, sortSchema } from "@/server/core/pagination";
import { zIsoDate, zIsoDateTime, zOptionalText, zPercentage, zPositiveMoney, zMoney, zText, zUuid } from "@/server/core/validation";

/**
 * Entrada das operações do financeiro (validada no servidor, sempre).
 *
 * O que NUNCA vem do navegador: organização/papel/usuário (sessão), moeda da
 * obrigação (herdada do acordo), obrigação de um estorno (herdada do
 * lançamento original), e qualquer divisão parceiro × escritório (o banco
 * gera a partir do percentual congelado do snapshot).
 */

/* ------------------------------------------------------------------ */
/* Vocabulário (banco, canônico)                                       */
/* ------------------------------------------------------------------ */

export const AGREEMENT_DB_STATUSES = ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"] as const;
export const PAYMENT_TYPES = ["UPFRONT", "FIXED", "MONTHLY", "SUCCESS_FEE", "OTHER"] as const;
export const PAYMENT_DB_STATUSES = ["PENDING", "PARTIAL", "PAID", "OVERDUE", "CANCELLED"] as const;
export const RECEIPT_KINDS = ["RECEIPT", "ADJUSTMENT", "REVERSAL"] as const;
export const RECEIPT_METHODS = ["PIX", "TED", "DOC", "BOLETO", "CARD", "CASH", "CHECK", "OTHER"] as const;
export const TRANSFER_STATUSES = ["PENDING", "PAID", "CANCELLED"] as const;

/** Data/hora de um fato financeiro: nunca no futuro (tolerância de 5 min de relógio). */
const zPastDateTime = () =>
  zIsoDateTime().refine((v) => Date.parse(v) <= Date.now() + 5 * 60_000, "A data não pode estar no futuro.");

/** Inteiro positivo pequeno (número de parcelas). */
const zInstallments = () => z.number().int("Informe um número inteiro.").min(1, "Mínimo de 1 parcela.").max(600, "Máximo de 600 parcelas.");

/* ------------------------------------------------------------------ */
/* Modelos de honorários                                               */
/* ------------------------------------------------------------------ */

export const FEE_MODEL_SORT_FIELDS = { name: "name", updatedAt: "updated_at", createdAt: "created_at" } as const;

export const listFeeModelsSchema = pageInputSchema
  .extend({ active: z.boolean().optional(), legalAreaId: zUuid().optional() })
  .and(sortSchema(FEE_MODEL_SORT_FIELDS, "name", "asc"));
export type ListFeeModelsInput = z.infer<typeof listFeeModelsSchema>;

const feeTermsFields = {
  upfrontFee: zMoney().optional(),
  fixedFee: zMoney().optional(),
  installments: zInstallments().optional(),
  monthlyFee: zMoney().optional(),
  successFeePercent: zPercentage().optional(),
};

export const createFeeModelSchema = z.object({
  name: zText(120, "Informe o nome do modelo."),
  description: zOptionalText(1000),
  legalAreaId: zUuid().optional(),
  ...feeTermsFields,
  billingMoment: z.enum(BILLING_MOMENTS).default("ON_SIGNING"),
  notes: zOptionalText(2000),
  active: z.boolean().default(true),
});
export type CreateFeeModelInput = z.infer<typeof createFeeModelSchema>;

/** PATCH: chave ausente = não mexe; null = limpa. */
export const updateFeeModelSchema = z.object({
  id: zUuid(),
  patch: z
    .object({
      name: zText(120, "Informe o nome do modelo."),
      description: zOptionalText(1000).nullable(),
      legalAreaId: zUuid().nullable(),
      upfrontFee: zMoney().nullable(),
      fixedFee: zMoney().nullable(),
      installments: zInstallments().nullable(),
      monthlyFee: zMoney().nullable(),
      successFeePercent: zPercentage().nullable(),
      billingMoment: z.enum(BILLING_MOMENTS),
      notes: zOptionalText(2000).nullable(),
      active: z.boolean(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, "Nada para alterar."),
});
export type UpdateFeeModelInput = z.infer<typeof updateFeeModelSchema>;

/* ------------------------------------------------------------------ */
/* Acordos financeiros do caso                                         */
/* ------------------------------------------------------------------ */

export const AGREEMENT_SORT_FIELDS = { createdAt: "created_at", updatedAt: "updated_at", startDate: "start_date" } as const;

export const listAgreementsSchema = pageInputSchema
  .extend({ legalCaseId: zUuid().optional(), status: z.enum(AGREEMENT_DB_STATUSES).optional() })
  .and(sortSchema(AGREEMENT_SORT_FIELDS, "createdAt"));
export type ListAgreementsInput = z.infer<typeof listAgreementsSchema>;

export const idSchema = z.object({ id: zUuid() });

export const createAgreementSchema = z.object({
  legalCaseId: zUuid(),
  /** Chave do formulário (UUID gerado pelo navegador uma vez por formulário): reenvio devolve o já gravado. */
  idempotencyKey: zUuid(),
  feeModelId: zUuid().optional(),
  ...feeTermsFields,
  startDate: zIsoDate().optional(),
  notes: zOptionalText(2000),
  /** true = já nasce ACTIVE (um ativo por caso); false = rascunho. */
  activate: z.boolean().default(false),
});
export type CreateAgreementInput = z.infer<typeof createAgreementSchema>;

/** Termos só mudam em rascunho (DRAFT). Ativo muda só por transição de status. */
export const updateAgreementSchema = z.object({
  id: zUuid(),
  patch: z
    .object({
      feeModelId: zUuid().nullable(),
      upfrontFee: zMoney().nullable(),
      fixedFee: zMoney().nullable(),
      installments: zInstallments().nullable(),
      monthlyFee: zMoney().nullable(),
      successFeePercent: zPercentage().nullable(),
      startDate: zIsoDate().nullable(),
      notes: zOptionalText(2000).nullable(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, "Nada para alterar."),
});
export type UpdateAgreementInput = z.infer<typeof updateAgreementSchema>;

/** Ciclo de vida: DRAFT → ACTIVE → COMPLETED; DRAFT/ACTIVE → CANCELLED. */
export const changeAgreementStatusSchema = z.object({
  id: zUuid(),
  to: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]),
});
export type ChangeAgreementStatusInput = z.infer<typeof changeAgreementStatusSchema>;

/* ------------------------------------------------------------------ */
/* Obrigações (payments)                                               */
/* ------------------------------------------------------------------ */

export const PAYMENT_SORT_FIELDS = { dueDate: "due_date", amount: "amount" } as const;

export const listPaymentsSchema = pageInputSchema
  .extend({
    agreementId: zUuid().optional(),
    legalCaseId: zUuid().optional(),
    status: z.enum(PAYMENT_DB_STATUSES).optional(),
  })
  .and(sortSchema(PAYMENT_SORT_FIELDS, "dueDate", "asc"));
export type ListPaymentsInput = z.infer<typeof listPaymentsSchema>;

export const createPaymentSchema = z.object({
  agreementId: zUuid(),
  /** Chave do formulário (UUID gerado pelo navegador uma vez por formulário): reenvio devolve o já gravado. */
  idempotencyKey: zUuid(),
  amount: zPositiveMoney(),
  dueDate: zIsoDate().optional(),
  paymentType: z.enum(PAYMENT_TYPES),
  description: zOptionalText(300),
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

/** Cronograma de parcelas (035): periodicidade e tipos aceitos. */
export const SCHEDULE_FREQUENCIES = ["MONTHLY", "BIWEEKLY", "WEEKLY"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];
export const SCHEDULE_PAYMENT_TYPES = ["FIXED", "MONTHLY", "OTHER"] as const;
export const SCHEDULE_MAX_INSTALLMENTS = 120;

/**
 * Gera N obrigações de uma vez, no banco (create_payment_schedule_once): total
 * + quantidade + 1º vencimento + periodicidade. O navegador NÃO manda a lista
 * de valores: o servidor/banco calcula (centavos; resto nas primeiras).
 */
export const createPaymentScheduleSchema = z.object({
  agreementId: zUuid(),
  idempotencyKey: zUuid(),
  total: zPositiveMoney(),
  installments: z.coerce.number().int("Informe um número inteiro.").min(1, "Pelo menos 1 parcela.").max(SCHEDULE_MAX_INSTALLMENTS, `No máximo ${SCHEDULE_MAX_INSTALLMENTS} parcelas.`),
  firstDueDate: zIsoDate(),
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  paymentType: z.enum(SCHEDULE_PAYMENT_TYPES).default("FIXED"),
  description: zOptionalText(120),
});
export type CreatePaymentScheduleInput = z.infer<typeof createPaymentScheduleSchema>;

/** Corrige a obrigação (nunca o recebido: recebido é o ledger). */
export const updatePaymentSchema = z.object({
  id: zUuid(),
  patch: z
    .object({
      amount: zPositiveMoney(),
      dueDate: zIsoDate().nullable(),
      description: zOptionalText(300).nullable(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, "Nada para alterar."),
});
export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;

export const cancelPaymentSchema = z.object({
  id: zUuid(),
  reason: zText(500, "Informe o motivo do cancelamento."),
});
export type CancelPaymentInput = z.infer<typeof cancelPaymentSchema>;

/* ------------------------------------------------------------------ */
/* Ledger de recebimentos (append-only)                                */
/* ------------------------------------------------------------------ */

export const listReceiptsSchema = pageInputSchema.extend({ paymentId: zUuid() });
export type ListReceiptsInput = z.infer<typeof listReceiptsSchema>;

/** Entrada. Sem `amount`, quita o saldo restante da obrigação (lido do banco). */
export const registerReceiptSchema = z.object({
  paymentId: zUuid(),
  /** Chave do formulário (UUID gerado pelo navegador uma vez por formulário): reenvio devolve o já gravado. */
  idempotencyKey: zUuid(),
  amount: zPositiveMoney().optional(),
  occurredAt: zPastDateTime().optional(),
  method: z.enum(RECEIPT_METHODS).optional(),
  notes: zOptionalText(1000),
});
export type RegisterReceiptInput = z.infer<typeof registerReceiptSchema>;

/**
 * Ajuste com justificativa. O sinal vem de `direction` (o valor é sempre
 * positivo no formulário): INCREASE soma ao recebido, DECREASE subtrai.
 */
export const registerAdjustmentSchema = z.object({
  paymentId: zUuid(),
  /** Chave do formulário (UUID gerado pelo navegador uma vez por formulário): reenvio devolve o já gravado. */
  idempotencyKey: zUuid(),
  direction: z.enum(["INCREASE", "DECREASE"]),
  amount: zPositiveMoney(),
  justification: zText(1000, "Informe a justificativa do ajuste."),
  /** Lançamento de entrada que o ajuste corrige (opcional; mesma obrigação). */
  originalReceiptId: zUuid().optional(),
  occurredAt: zPastDateTime().optional(),
});
export type RegisterAdjustmentInput = z.infer<typeof registerAdjustmentSchema>;

/** Estorno de um lançamento de entrada. Sem `amount`, estorna o que resta dele. */
export const registerReversalSchema = z.object({
  originalReceiptId: zUuid(),
  /** Chave do formulário (UUID gerado pelo navegador uma vez por formulário): reenvio devolve o já gravado. */
  idempotencyKey: zUuid(),
  amount: zPositiveMoney().optional(),
  notes: zOptionalText(1000),
  occurredAt: zPastDateTime().optional(),
});
export type RegisterReversalInput = z.infer<typeof registerReversalSchema>;

/* ------------------------------------------------------------------ */
/* Parceria: snapshot, divisões e repasses                             */
/* ------------------------------------------------------------------ */

export const listCasePartnershipsSchema = z.object({ legalCaseId: zUuid() });

/** Divisões (leitura). Ao menos um filtro: nunca "tudo de todos". */
export const listAllocationsSchema = pageInputSchema
  .extend({
    legalCaseId: zUuid().optional(),
    partnerOrganizationId: zUuid().optional(),
    receiptId: zUuid().optional(),
  })
  .refine((v) => v.legalCaseId || v.partnerOrganizationId || v.receiptId, "Informe o caso, o parceiro ou o lançamento.");
export type ListAllocationsInput = z.infer<typeof listAllocationsSchema>;

export const TRANSFER_SORT_FIELDS = { createdAt: "created_at", paidAt: "paid_at", amount: "amount" } as const;

/** Parceiro: `partnerOrganizationId` é ignorado/recusado — vale o da sessão. */
export const listTransfersSchema = pageInputSchema
  .extend({ partnerOrganizationId: zUuid().optional(), status: z.enum(TRANSFER_STATUSES).optional() })
  .and(sortSchema(TRANSFER_SORT_FIELDS, "createdAt"));
export type ListTransfersInput = z.infer<typeof listTransfersSchema>;

/**
 * Novo repasse (ADMIN). Só o VALOR total é decidido por quem registra; quais
 * divisões ele consome é decidido pelo BANCO (public.create_partner_transfer,
 * migration 026: mais antigas primeiro, travadas, numa transação).
 * Opcionalmente restrito a um caso.
 */
export const createTransferSchema = z.object({
  partnerOrganizationId: zUuid(),
  /** Chave do formulário (UUID gerado pelo navegador uma vez por formulário): reenvio devolve o já gravado. */
  idempotencyKey: zUuid(),
  amount: zPositiveMoney(),
  legalCaseId: zUuid().optional(),
  reference: zOptionalText(200),
});
export type CreateTransferInput = z.infer<typeof createTransferSchema>;

export const markTransferPaidSchema = z.object({
  id: zUuid(),
  paidAt: zPastDateTime().optional(),
  reference: zOptionalText(200),
});
export type MarkTransferPaidInput = z.infer<typeof markTransferPaidSchema>;

export const cancelTransferSchema = z.object({
  id: zUuid(),
  reason: zText(500, "Informe o motivo do cancelamento."),
});
export type CancelTransferInput = z.infer<typeof cancelTransferSchema>;

/** Visão do parceiro. ADMIN informa o parceiro; PARTNER_ADMIN usa sempre o da sessão. */
export const partnerFinanceSchema = z.object({ partnerOrganizationId: zUuid().optional() });
export type PartnerFinanceInput = z.infer<typeof partnerFinanceSchema>;

export const listPartnerAgreementSharesSchema = pageInputSchema.extend({
  partnerOrganizationId: zUuid().optional(),
  includeCancelled: z.boolean().default(true),
});
export type ListPartnerAgreementSharesInput = z.infer<typeof listPartnerAgreementSharesSchema>;

/** "Valores da parceria" de um caso (só leitura). */
export const partnerShareDetailSchema = z.object({ agreementId: zUuid() });
