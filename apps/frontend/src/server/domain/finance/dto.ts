import type { BillingMoment, PaymentStatus, ProcessPhase, ProcessStatus } from "@/lib/constants/status";
import type { DbPaymentStatus } from "@/repositories/api/db-mappings";
import type { Page } from "@/server/core/pagination";
import type { ID, ISODate, ISODateTime } from "@/types";
import type { ReceivableAging } from "./aging";
import type { AGREEMENT_DB_STATUSES, EXPENSE_CATEGORIES, EXPENSE_STATUSES, PAYMENT_TYPES, RECEIPT_KINDS, TRANSFER_STATUSES } from "./schemas";

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

/** Acordo de honorários do processo (046). Status é o ciclo de vida do banco (decisão, não derivado). */
export interface FinancialAgreementDTO {
  id: ID;
  legalCaseId: ID;
  /** Processo do contrato. Ausente só em contratos antigos, do tempo em que o financeiro era do caso. */
  legalProcessId?: ID;
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
  /** Última reabertura (concluído ou cancelado → ativo; 064), com o motivo informado. */
  reopenedAt?: ISODateTime;
  reopenReason?: string;
}

/** Totais de parcelas, todos derivados do ledger (view payment_balances), somados NO BANCO. */
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

/** Linha da lista de acordos: acordo + rótulos do caso/processo + totais do ledger. */
export interface AgreementListItemDTO extends FinancialAgreementDTO {
  caseTitle: string;
  clientName: string;
  /** Título do processo (ou do caso, quando o processo não tem título próprio). Ausente em contrato antigo, do caso. */
  processTitle?: string;
  cnjNumber?: string;
  caseOriginOrganizationId?: ID;
  feeModelName?: string;
  totals: FinanceTotals;
  /** Próximo vencimento em aberto. */
  nextDueDate?: ISODate;
  /**
   * Entra nos totais por processo (046)? Falso em contrato antigo, ligado só
   * ao caso, e em contrato de processo excluído: a lista mostra, os totais não.
   */
  inProcessTotals: boolean;
}

/**
 * Visão geral do financeiro (ADMIN), somada NO BANCO (public.finance_summary,
 * 064). `totals` é a MESMA conta dos totais por processo (046): a Home e o
 * Financeiro mostram o mesmo "em aberto". `outside` é o que fica fora dessa
 * conta (contrato antigo, só do caso, ou de processo excluído).
 */
export interface FinanceSummaryDTO {
  totals: FinanceTotals;
  /** Fora dos totais por processo. Tudo zero quando não há contrato antigo nem de processo excluído. */
  outside: FinanceTotals;
  /** Parcelas de contratos em RASCUNHO (071): ainda não podem ser recebidas, ficam fora dos totais e aparecem à parte. */
  draft: FinanceTotals;
  agreementsByStatus: Record<AgreementDbStatus, number>;
  /** Recebido líquido por mês (America/Sao_Paulo), últimos 12 meses, do mais antigo ao atual. */
  monthly: { month: string; amount: number }[];
  /**
   * Contratado por modelo de honorários (4.3.1): obrigações não canceladas de
   * acordos não cancelados, somadas NO BANCO (view financial_contracted_by_fee_model).
   * Até 4 modelos + "Outros", do maior para o menor.
   */
  byFeeModel: ContractedByModelPoint[];
  /** Sempre falso desde a 064 (a soma é do banco, sem teto de leitura). Mantido para as telas que já o leem. */
  truncated: boolean;
}

export interface ContractedByModelPoint {
  name: string;
  /** null = "Sem modelo (valores próprios)" ou o agrupamento "Outros". */
  feeModelId: ID | null;
  total: number;
  count: number;
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

/** Linha do extrato de recebimentos (064): o lançamento com o cliente, o processo e a parcela. */
export interface ReceiptStatementItemDTO {
  receiptId: ID;
  sequence: number;
  kind: ReceiptKind;
  /** Com sinal: estorno e ajuste para menos são negativos. */
  amount: number;
  currency: string;
  occurredAt: ISODateTime;
  /** Dia do lançamento em São Paulo (é por ele que o período filtra). */
  occurredOn: ISODate;
  method?: string;
  notes?: string;
  paymentId: ID;
  paymentType: PaymentType;
  paymentDescription?: string;
  agreementId: ID;
  legalCaseId: ID;
  legalProcessId?: ID;
  clientName: string;
  caseTitle: string;
  processTitle?: string;
  cnjNumber?: string;
}

/** Total do período do extrato, com os mesmos filtros da lista (somado no banco). */
export interface ReceiptStatementTotalsDTO {
  count: number;
  /** Soma das entradas (recebimentos e ajustes para mais). */
  received: number;
  /** Soma dos estornos e ajustes para menos (negativa ou zero). */
  deducted: number;
  /** Líquido do período. */
  net: number;
}

/** Página do extrato + o total do período inteiro (todas as páginas, mesmos filtros). */
export interface ReceiptStatementDTO extends Page<ReceiptStatementItemDTO> {
  totals: ReceiptStatementTotalsDTO;
}

/** Parcela em aberto com saldo ("A receber", 064). */
export interface ReceivableItemDTO {
  paymentId: ID;
  agreementId: ID;
  legalCaseId: ID;
  legalProcessId?: ID;
  agreementStatus: AgreementDbStatus;
  amount: number;
  receivedAmount: number;
  balance: number;
  currency: string;
  dueDate?: ISODate;
  /** PENDING, PARTIAL ou OVERDUE (as demais não estão em aberto). */
  status: DbPaymentStatus;
  /** Dias de atraso; ausente quando não está vencida. */
  daysOverdue?: number;
  paymentType: PaymentType;
  description?: string;
  clientName: string;
  caseTitle: string;
  processTitle?: string;
  cnjNumber?: string;
  inProcessTotals: boolean;
}

export interface ReceivablesTotalsDTO {
  count: number;
  total: number;
  overdue: number;
  overdueCount: number;
  /** Parte do total em contrato antigo ou de processo excluído (fora dos totais por processo). */
  outsideTotals: number;
  /** Em contratos em rascunho, com os mesmos filtros (071): fora do total da lista dos contratos ativos. */
  draftTotal: number;
  draftCount: number;
}

/** Página do "a receber" + os totais de todas as páginas (mesmos filtros). */
export interface ReceivablesDTO extends Page<ReceivableItemDTO> {
  totals: ReceivablesTotalsDTO;
}

/** Total das despesas com os mesmos filtros da lista (071). Canceladas só contam quando a lista mostra as canceladas. */
export interface ExpensesTotalsDTO {
  count: number;
  total: number;
  paid: number;
  open: number;
}

/** Página de despesas + o total do período (todas as páginas, mesmos filtros). Sem `totals` = não deu para somar. */
export interface ExpensesDTO extends Page<ExpenseDTO> {
  totals?: ExpensesTotalsDTO;
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
  /**
   * Receita ELEGÍVEL (4.3.1): soma líquida dos recebimentos divididos sob este
   * snapshot (estornos inclusos), derivada do ledger pelo banco. É a base da
   * participação; não é o valor da causa nem uma estimativa.
   */
  eligibleRevenue: number;
}

/** Repasse que incluiu parte deste caso (valor do item, não o total do repasse). */
export interface PartnerShareTransferDTO {
  transferId: ID;
  /** Quanto deste caso entrou no repasse. */
  amount: number;
  status: TransferStatus;
  createdAt: ISODateTime;
  paidAt?: ISODateTime;
  reference?: string;
}

/**
 * "Valores da parceria" de UM caso (4.3.1): SÓ LEITURA, tudo derivado do
 * banco (ledger → divisões → repasses). Não existe campo para digitar valor
 * do parceiro. `ownerShare` e `caseReceived` só para a equipe interna.
 */
export interface PartnerShareDetailDTO {
  share: PartnerAgreementShareDTO;
  ownerPercentage: number;
  /** Parte do escritório sobre a receita elegível (interno). */
  ownerShare?: number;
  /** Tudo o que entrou no caso, inclusive antes desta parceria (interno). */
  caseReceived?: number;
  transfers: PartnerShareTransferDTO[];
}

/* ------------------------------------------------------------------ */
/* Financeiro por processo (Roadmap 2.0, 046) — só ADMIN               */
/* ------------------------------------------------------------------ */

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

/**
 * Uma linha da view process_finance_overview: tudo somado NO BANCO. Honorários
 * (045, dados internos) divididos pelo percentual da parceria do caso;
 * contratado/recebido/em aberto/atraso do ledger; despesas; resultado =
 * recebido − parte do parceiro − despesas pagas.
 */
export interface ProcessFinanceDTO {
  legalProcessId: ID;
  legalCaseId: ID;
  clientId: ID;
  clientName: string;
  cnjNumber?: string;
  /** Título do processo ou, sem título próprio, o do caso. */
  title: string;
  caseTitle: string;
  status: ProcessStatus;
  phase?: ProcessPhase;
  createdAt: ISODateTime;
  caseValue?: number;
  feeAmount?: number;
  feePercentage?: number;
  partnerOrganizationId?: ID;
  partnerPercentage: number;
  ownerPercentage: number;
  feeOwnerShare: number;
  feePartnerShare: number;
  contracted: number;
  received: number;
  openBalance: number;
  overdue: number;
  agreementCount: number;
  receivedPartnerShare: number;
  receivedOwnerShare: number;
  expensesTotal: number;
  expensesPaid: number;
  expensesOpen: number;
  expensesReimbursable: number;
  expenseCount: number;
  netResult: number;
}

/** Totais do escritório (view process_finance_totals, uma linha). */
export interface ProcessFinanceTotalsDTO {
  processCount: number;
  caseValueTotal: number;
  feeTotal: number;
  feeOwnerTotal: number;
  feePartnerTotal: number;
  contractedTotal: number;
  receivedTotal: number;
  receivedOwnerTotal: number;
  receivedPartnerTotal: number;
  openTotal: number;
  overdueTotal: number;
  expensesTotal: number;
  expensesPaidTotal: number;
  expensesOpenTotal: number;
  netResultTotal: number;
}

/** Despesa do processo. Nunca apagada: cancelada fica no histórico com o motivo. */
export interface ExpenseDTO {
  id: ID;
  legalProcessId: ID;
  legalCaseId: ID;
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency: string;
  incurredOn: ISODate;
  /** Ausente = a pagar. */
  paidOn?: ISODate;
  reimbursable: boolean;
  supplier?: string;
  notes?: string;
  /** Derivada: cancelada › paga › a pagar. */
  status: ExpenseStatus;
  createdBy?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  cancelledAt?: ISODateTime;
  cancellationReason?: string;
  /** Rótulos do processo (lista geral de despesas). */
  processTitle?: string;
  cnjNumber?: string;
  clientName?: string;
}

/** Financeiro de UM processo: a linha consolidada + contratos + despesas (primeiras páginas). */
export interface ProcessFinanceDetailDTO {
  process: ProcessFinanceDTO;
  agreements: Page<AgreementListItemDTO>;
  expenses: Page<ExpenseDTO>;
}

export interface ExpenseCategoryPoint {
  category: ExpenseCategory;
  paid: number;
  open: number;
  total: number;
  count: number;
}

/**
 * Despesas dos últimos 12 meses (agregadas no servidor sobre a lista, teto de
 * leitura): por categoria (pela data da despesa; pagas × a pagar) e pagas por
 * mês (pela data do pagamento — o mesmo regime de caixa do "Recebido por mês").
 */
export interface ExpenseSummaryDTO {
  byCategory: ExpenseCategoryPoint[];
  /** Do mais antigo ao atual (America/Sao_Paulo), alinhado com FinanceSummaryDTO.monthly. */
  monthlyPaid: { month: string; amount: number }[];
  truncated: boolean;
}

/**
 * "A receber por vencimento" (E-06): saldo em aberto (PENDING, PARTIAL,
 * OVERDUE; saldo > 0) dos contratos de PROCESSO, por faixa de vencimento a
 * partir de hoje em São Paulo — somado no servidor. Contratos antigos (só do
 * caso) ficam fora, como em process_finance_totals (046).
 */
export interface ReceivableAgingDTO extends ReceivableAging {
  truncated: boolean;
}
