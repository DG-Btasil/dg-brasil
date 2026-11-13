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

const SP_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** Data civil (YYYY-MM-DD) de um instante no fuso de São Paulo. */
export function saoPauloDate(instant: Date): string {
  return SP_DATE.format(instant);
}

/** Hoje (YYYY-MM-DD) no fuso de São Paulo. */
export function todaySaoPaulo(now = new Date()): string {
  return saoPauloDate(now);
}

/**
 * Data de um fato financeiro (recebimento, ajuste, estorno, pagamento de
 * repasse): nunca num DIA futuro, pela data civil de São Paulo. A tela só
 * pergunta o dia e manda o meio-dia dele; comparar o instante recusava "hoje"
 * antes do meio-dia. O service grava no máximo o instante atual
 * (`pastInstant`), então nada no ledger fica com hora no futuro.
 */
const zPastDateTime = () => zIsoDateTime().refine((v) => saoPauloDate(new Date(v)) <= todaySaoPaulo(), "A data não pode estar no futuro.");

/** Instante de um fato já validado pelo dia: se a hora ainda não chegou (hoje, meio-dia, lançado de manhã), vale o agora. */
export function pastInstant(occurredAt: string | undefined, now = new Date()): string | undefined {
  if (occurredAt === undefined) return undefined;
  return Date.parse(occurredAt) > now.getTime() ? now.toISOString() : occurredAt;
}

/** Busca das listas: cliente, título do processo ou do caso; só dígitos = prefixo do número CNJ. */
const zSearch = () => z.string().trim().max(200).optional();

/** `from` não pode ser depois de `to` (os dois opcionais). */
const periodInOrder = (from: string | undefined, to: string | undefined) => !from || !to || from <= to;
const PERIOD_MESSAGE = "A data inicial não pode ser depois da final.";

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
  .extend({ legalCaseId: zUuid().optional(), legalProcessId: zUuid().optional(), status: z.enum(AGREEMENT_DB_STATUSES).optional() })
  .and(sortSchema(AGREEMENT_SORT_FIELDS, "createdAt"));
export type ListAgreementsInput = z.infer<typeof listAgreementsSchema>;

/**
 * Lista de contratos com rótulos e totais (view finance_agreement_list, 064):
 * busca por cliente/título/CNJ, período pela data do contrato (início ou, sem
 * início, o dia da criação) e vencimento pelo PRÓXIMO vencimento em aberto.
 */
export const AGREEMENT_ROW_SORT_FIELDS = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  startDate: "start_date",
  contractDate: "contract_date",
  nextDueDate: "next_due_date",
} as const;

export const listAgreementRowsSchema = pageInputSchema
  .extend({
    legalCaseId: zUuid().optional(),
    legalProcessId: zUuid().optional(),
    status: z.enum(AGREEMENT_DB_STATUSES).optional(),
    q: zSearch(),
    periodFrom: zIsoDate().optional(),
    periodTo: zIsoDate().optional(),
    dueFrom: zIsoDate().optional(),
    dueTo: zIsoDate().optional(),
  })
  .refine((v) => periodInOrder(v.periodFrom, v.periodTo), { message: PERIOD_MESSAGE, path: ["periodTo"] })
  .refine((v) => periodInOrder(v.dueFrom, v.dueTo), { message: PERIOD_MESSAGE, path: ["dueTo"] })
  .and(sortSchema(AGREEMENT_ROW_SORT_FIELDS, "createdAt"));
export type ListAgreementRowsInput = z.infer<typeof listAgreementRowsSchema>;

export const idSchema = z.object({ id: zUuid() });

/**
 * Contrato de honorários do PROCESSO (Roadmap 2.0, 046). O caso NÃO vem do
 * navegador: o servidor lê o caso do processo (processo excluído ou sem
 * acesso = recusado).
 */
export const createAgreementSchema = z.object({
  legalProcessId: zUuid(),
  /** Chave do formulário (UUID gerado pelo navegador uma vez por formulário): reenvio devolve o já gravado. */
  idempotencyKey: zUuid(),
  feeModelId: zUuid().optional(),
  ...feeTermsFields,
  startDate: zIsoDate().optional(),
  notes: zOptionalText(2000),
  /** true = já nasce ACTIVE (um ativo por processo); false = rascunho. */
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

/**
 * Reabrir contrato concluído ou cancelado (064): volta a ATIVO, com motivo,
 * auditado. É o caminho para estornar ou ajustar depois de concluir.
 */
export const reopenAgreementSchema = z.object({
  id: zUuid(),
  reason: zText(500, "Informe o motivo da reabertura."),
});
export type ReopenAgreementInput = z.infer<typeof reopenAgreementSchema>;

/** Ciclo de vida: DRAFT → ACTIVE → COMPLETED; DRAFT/ACTIVE → CANCELLED. Voltar de concluído/cancelado: `reopenAgreementSchema`. */
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

/**
 * Extrato de recebimentos por período (064; view finance_receipt_statement).
 * O período é o DIA do lançamento em São Paulo. Filtros e total no banco.
 */
export const RECEIPT_STATEMENT_SORT_FIELDS = { occurredAt: "occurred_at", amount: "amount" } as const;

export const listReceiptStatementSchema = pageInputSchema
  .extend({
    from: zIsoDate().optional(),
    to: zIsoDate().optional(),
    method: z.enum(RECEIPT_METHODS).optional(),
    kind: z.enum(RECEIPT_KINDS).optional(),
    q: zSearch(),
  })
  .refine((v) => periodInOrder(v.from, v.to), { message: PERIOD_MESSAGE, path: ["to"] })
  .and(sortSchema(RECEIPT_STATEMENT_SORT_FIELDS, "occurredAt", "desc"));
export type ListReceiptStatementInput = z.infer<typeof listReceiptStatementSchema>;

/** "A receber" (064; view finance_receivables): parcelas em aberto com saldo, por vencimento. */
export const RECEIVABLE_SORT_FIELDS = { dueDate: "due_date", balance: "balance" } as const;

export const listReceivablesSchema = pageInputSchema
  .extend({
    from: zIsoDate().optional(),
    to: zIsoDate().optional(),
    /** Só parcelas vencidas. */
    overdueOnly: z.boolean().optional(),
    q: zSearch(),
  })
  .refine((v) => periodInOrder(v.from, v.to), { message: PERIOD_MESSAGE, path: ["to"] })
  .and(sortSchema(RECEIVABLE_SORT_FIELDS, "dueDate", "asc"));
export type ListReceivablesInput = z.infer<typeof listReceivablesSchema>;

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
 * Para MENOS, o recebimento corrigido é obrigatório (064): a parte do parceiro
 * sai da mesma divisão do original. O banco recusa sem ele.
 */
export const registerAdjustmentSchema = z
  .object({
    paymentId: zUuid(),
    /** Chave do formulário (UUID gerado pelo navegador uma vez por formulário): reenvio devolve o já gravado. */
    idempotencyKey: zUuid(),
    direction: z.enum(["INCREASE", "DECREASE"]),
    amount: zPositiveMoney(),
    justification: zText(1000, "Informe a justificativa do ajuste."),
    /** Recebimento que o ajuste corrige (mesma parcela). Obrigatório no ajuste para menos. */
    originalReceiptId: zUuid().optional(),
    occurredAt: zPastDateTime().optional(),
  })
  .refine((v) => v.direction === "INCREASE" || !!v.originalReceiptId, { message: "Escolha o recebimento que este ajuste corrige.", path: ["originalReceiptId"] });
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

/* ------------------------------------------------------------------ */
/* Financeiro por processo (Roadmap 2.0, 046)                          */
/* ------------------------------------------------------------------ */

/** Categorias de despesa (check do banco, process_expenses.category). */
export const EXPENSE_CATEGORIES = ["COURT_COSTS", "HIRED_LAWYER", "EXPERT_FEE", "HEARING", "TRAVEL", "NOTARY", "OTHER"] as const;
/** Situação DERIVADA da despesa: cancelada (cancelled_at) › paga (paid_on) › a pagar. */
export const EXPENSE_STATUSES = ["OPEN", "PAID", "CANCELLED"] as const;

/** Ordenação da visão por processo (whitelist → coluna da view process_finance_overview). */
export const PROCESS_FINANCE_SORT_FIELDS = {
  received: "received",
  contracted: "contracted",
  expenses: "expenses_total",
  net: "net_result",
  title: "display_title",
  createdAt: "created_at",
} as const;

export const listProcessFinanceSchema = pageInputSchema
  .extend({
    /** Cliente, título do processo/caso ou número CNJ (só dígitos = prefixo do CNJ). */
    q: z.string().trim().max(200).optional(),
    legalCaseId: zUuid().optional(),
    /** Só processos com obrigação vencida e saldo em aberto. */
    overdueOnly: z.boolean().optional(),
    /** Só processos com despesa a pagar. */
    openExpensesOnly: z.boolean().optional(),
    /** Só processos sem contrato de honorários (não cancelado). */
    withoutAgreement: z.boolean().optional(),
  })
  .and(sortSchema(PROCESS_FINANCE_SORT_FIELDS, "received", "desc"));
export type ListProcessFinanceInput = z.infer<typeof listProcessFinanceSchema>;

export const processFinanceSchema = z.object({ processId: zUuid() });
export type ProcessFinanceInput = z.infer<typeof processFinanceSchema>;

export const EXPENSE_SORT_FIELDS = { incurredOn: "incurred_on", amount: "amount", createdAt: "created_at" } as const;

export const listExpensesSchema = pageInputSchema
  .extend({
    processId: zUuid().optional(),
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    status: z.enum(EXPENSE_STATUSES).optional(),
    /** Período pela data da despesa. */
    from: zIsoDate().optional(),
    to: zIsoDate().optional(),
  })
  .refine((v) => periodInOrder(v.from, v.to), { message: PERIOD_MESSAGE, path: ["to"] })
  .and(sortSchema(EXPENSE_SORT_FIELDS, "incurredOn", "desc"));
export type ListExpensesInput = z.infer<typeof listExpensesSchema>;

/** Data do pagamento: fato, nunca no futuro (dia de São Paulo). A data da despesa pode ser futura (ex.: audiência marcada). */
const zPaidOn = () => zIsoDate().refine((v) => v <= todaySaoPaulo(), "A data do pagamento não pode estar no futuro.");
const zExpenseDescription = () => zText(500, "Descreva a despesa.");

/**
 * Nova despesa do processo. O caso vem do processo (o banco também sobrescreve);
 * autor da sessão. Sem `paidOn` = a pagar. Clique duplo não lança duas (chave).
 */
export const createExpenseSchema = z.object({
  processId: zUuid(),
  /** Chave do formulário (UUID gerado pelo navegador uma vez por envio; 064): reenvio devolve a despesa já lançada. */
  idempotencyKey: zUuid(),
  category: z.enum(EXPENSE_CATEGORIES),
  description: zExpenseDescription(),
  amount: zPositiveMoney(),
  incurredOn: zIsoDate(),
  paidOn: zPaidOn().optional(),
  reimbursable: z.boolean().default(false),
  supplier: zOptionalText(200),
  notes: zOptionalText(2000),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

/** PATCH da despesa (ativa). `paidOn: null` volta para "a pagar". Processo nunca muda. */
export const updateExpenseSchema = z.object({
  id: zUuid(),
  patch: z
    .object({
      category: z.enum(EXPENSE_CATEGORIES),
      description: zExpenseDescription(),
      amount: zPositiveMoney(),
      incurredOn: zIsoDate(),
      paidOn: zPaidOn().nullable(),
      reimbursable: z.boolean(),
      supplier: zOptionalText(200).nullable(),
      notes: zOptionalText(2000).nullable(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, "Nada para alterar."),
});
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

/** Despesa nunca é apagada: cancelar exige motivo e fica no histórico. */
export const cancelExpenseSchema = z.object({
  id: zUuid(),
  reason: zText(500, "Informe o motivo do cancelamento."),
});
export type CancelExpenseInput = z.infer<typeof cancelExpenseSchema>;
