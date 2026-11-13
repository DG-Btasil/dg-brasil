import { BILLING_MOMENTS, type BillingMoment } from "@/lib/constants/status";
import { readCurrencyInput, readPercentInput, type NumberInputReading } from "@/lib/validation";
import type { ExpenseCategory, ExpenseDTO, FeeModelDTO } from "@/server/domain/finance/dto";

/**
 * Formulários do financeiro (texto) → entrada das Server Actions. Puro: o
 * servidor valida de novo (schemas de server/domain/finance) e o banco é a
 * autoridade das contas (saldo, divisão, situação). Moeda: BRL, sempre do
 * acordo — nunca daqui.
 */

const BRL_INPUT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1500 → "1.500,00" (campo de formulário). */
export function moneyInput(v: number | undefined | null): string {
  return v === undefined || v === null ? "" : BRL_INPUT.format(v);
}

/** 12.5 → "12,5" */
export function percentInput(v: number | undefined | null): string {
  return v === undefined || v === null ? "" : String(v).replace(".", ",");
}

const filled = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
const valueOf = (reading: NumberInputReading) => (reading.kind === "ok" ? reading.value : undefined);
/** Número do campo já conferido (vazio ou inválido = ausente). Quem envia confere antes com `moneyField`/`feeTermsErrors`. */
const money = (v: string | undefined) => valueOf(readCurrencyInput(v));
const percent = (v: string | undefined) => valueOf(readPercentInput(v));
const integer = (v: string | undefined) => (filled(v) && /^\d+$/.test((v as string).trim()) ? Number((v as string).trim()) : undefined);

/**
 * Campo de dinheiro de um diálogo: `value` ausente = campo vazio DE PROPÓSITO
 * (ex.: quitar o saldo). Texto que não é número devolve `error`, nunca vazio.
 * `required` exige valor maior que zero.
 */
export function moneyField(text: string | undefined, options: { required?: boolean; requiredMessage?: string } = {}): { value?: number; error?: string } {
  const reading = readCurrencyInput(text);
  if (reading.kind === "invalid") return { error: reading.message };
  if (reading.kind === "empty") return options.required ? { error: options.requiredMessage ?? "Informe um valor maior que zero." } : {};
  if (reading.value <= 0) return { error: options.requiredMessage ?? "Informe um valor maior que zero." };
  return { value: reading.value };
}

export interface FeeTermsValues {
  upfrontFee: string;
  fixedFee: string;
  installments: string;
  monthlyFee: string;
  successFeePercent: string;
}

/** Termos preenchidos (vazio = ausente). Confira antes com `feeTermsErrors`: formato errado não pode sumir calado. */
export function feeTermsInput(v: FeeTermsValues) {
  return {
    upfrontFee: money(v.upfrontFee),
    fixedFee: money(v.fixedFee),
    installments: integer(v.installments),
    monthlyFee: money(v.monthlyFee),
    successFeePercent: percent(v.successFeePercent),
  };
}

/** Erros de FORMATO dos termos (por campo). Vazio é permitido aqui; obrigatoriedade é de cada formulário. */
export function feeTermsErrors(v: FeeTermsValues): Partial<Record<keyof FeeTermsValues, string>> {
  const errors: Partial<Record<keyof FeeTermsValues, string>> = {};
  for (const key of ["upfrontFee", "fixedFee", "monthlyFee"] as const) {
    const reading = readCurrencyInput(v[key]);
    if (reading.kind === "invalid") errors[key] = reading.message;
    else if (reading.kind === "ok" && reading.value < 0) errors[key] = "O valor não pode ser negativo.";
  }
  const pct = readPercentInput(v.successFeePercent);
  if (pct.kind === "invalid") errors.successFeePercent = pct.message;
  else if (pct.kind === "ok" && (pct.value < 0 || pct.value > 100)) errors.successFeePercent = "Informe um percentual entre 0 e 100.";
  if (filled(v.installments) && integer(v.installments) === undefined) errors.installments = "Informe um número inteiro de parcelas.";
  return errors;
}

/** PATCH dos termos: vazio = limpar (null). */
export function feeTermsPatch(v: FeeTermsValues) {
  const t = feeTermsInput(v);
  return {
    upfrontFee: t.upfrontFee ?? null,
    fixedFee: t.fixedFee ?? null,
    installments: t.installments ?? null,
    monthlyFee: t.monthlyFee ?? null,
    successFeePercent: t.successFeePercent ?? null,
  };
}

export function feeTermsFromModel(m: Pick<FeeModelDTO, "upfrontFee" | "fixedFee" | "installments" | "monthlyFee" | "successFeePercent"> | undefined): FeeTermsValues {
  return {
    upfrontFee: moneyInput(m?.upfrontFee),
    fixedFee: moneyInput(m?.fixedFee),
    installments: m?.installments ? String(m.installments) : "",
    monthlyFee: moneyInput(m?.monthlyFee),
    successFeePercent: percentInput(m?.successFeePercent),
  };
}

/* ------------------------------------------------------------------ */
/* Modelo de honorários                                                */
/* ------------------------------------------------------------------ */

/**
 * "Tipo de cobrança" do modelo (Roadmap 2.0): escolhido primeiro, decide quais
 * valores o formulário pede. As colunas do banco não mudam — o tipo só limpa
 * os valores que não pertencem a ele. "Personalizado" só aparece para modelo
 * antigo que combina valores de tipos diferentes (nada se perde ao abrir).
 */
export const FEE_BILLING_TYPES = ["SUCCESS", "FIXED", "INSTALLMENTS", "MONTHLY", "UPFRONT_SUCCESS"] as const;
export type FeeBillingType = (typeof FEE_BILLING_TYPES)[number] | "CUSTOM";

const ALL_TERMS: (keyof FeeTermsValues)[] = ["upfrontFee", "fixedFee", "installments", "monthlyFee", "successFeePercent"];

export const FEE_BILLING_TYPE_META: Record<FeeBillingType, { label: string; description: string; fields: (keyof FeeTermsValues)[]; moments: readonly BillingMoment[] }> = {
  SUCCESS: { label: "Êxito (%)", description: "Percentual sobre o proveito, cobrado no êxito.", fields: ["successFeePercent"], moments: ["ON_SUCCESS"] },
  FIXED: { label: "Valor fixo", description: "Um valor único.", fields: ["fixedFee"], moments: ["ON_SIGNING", "ON_FILING"] },
  INSTALLMENTS: { label: "Parcelado", description: "Valor total dividido em parcelas.", fields: ["fixedFee", "installments"], moments: ["ON_SIGNING", "ON_FILING"] },
  MONTHLY: { label: "Mensal", description: "Mensalidade enquanto o contrato durar.", fields: ["monthlyFee"], moments: ["MONTHLY"] },
  UPFRONT_SUCCESS: { label: "Entrada + êxito", description: "Entrada na assinatura e percentual no êxito.", fields: ["upfrontFee", "successFeePercent"], moments: ["ON_SIGNING"] },
  CUSTOM: { label: "Combinação personalizada", description: "Modelo antigo com valores de tipos diferentes.", fields: ALL_TERMS, moments: BILLING_MOMENTS },
};

type TermsSource = Pick<FeeModelDTO, "upfrontFee" | "fixedFee" | "installments" | "monthlyFee" | "successFeePercent">;

/** Tipo de um modelo já gravado (pelos valores preenchidos). Combinação fora dos tipos = "CUSTOM". */
export function feeBillingTypeOf(m?: TermsSource): FeeBillingType {
  if (!m) return "SUCCESS";
  const has = (v: number | undefined | null) => v !== undefined && v !== null;
  const key = [has(m.upfrontFee) ? "U" : "", has(m.fixedFee) ? "F" : "", has(m.monthlyFee) ? "M" : "", has(m.successFeePercent) ? "S" : ""].join("");
  const installments = m.installments ?? undefined;
  if (key === "F") return installments && installments > 1 ? "INSTALLMENTS" : "FIXED";
  if (installments && installments > 1) return "CUSTOM";
  if (key === "" || key === "S") return "SUCCESS";
  if (key === "M") return "MONTHLY";
  if (key === "US") return "UPFRONT_SUCCESS";
  return "CUSTOM";
}

export interface FeeModelValues extends FeeTermsValues {
  billingType: FeeBillingType;
  name: string;
  description: string;
  legalAreaId: string;
  billingMoment: BillingMoment;
  notes: string;
  active: boolean;
}

export function feeModelToValues(m?: FeeModelDTO): FeeModelValues {
  const billingType = feeBillingTypeOf(m);
  return {
    billingType,
    name: m?.name ?? "",
    description: m?.description ?? "",
    legalAreaId: m?.legalAreaId ?? "",
    billingMoment: m?.billingMoment ?? FEE_BILLING_TYPE_META[billingType].moments[0],
    notes: m?.notes ?? "",
    active: m?.active ?? true,
    ...feeTermsFromModel(m),
  };
}

/** Troca o tipo: o momento da cobrança passa a um permitido pelo tipo (os valores ficam até salvar). */
export function withBillingType(v: FeeModelValues, billingType: FeeBillingType): FeeModelValues {
  const moments = FEE_BILLING_TYPE_META[billingType].moments;
  return { ...v, billingType, billingMoment: moments.includes(v.billingMoment) ? v.billingMoment : moments[0] };
}

/** Só os valores do tipo escolhido; os demais ficam vazios (ausente na criação, null no PATCH). */
function termsOfType(v: FeeModelValues): FeeTermsValues {
  const fields = new Set(FEE_BILLING_TYPE_META[v.billingType].fields);
  const out = { upfrontFee: "", fixedFee: "", installments: "", monthlyFee: "", successFeePercent: "" };
  for (const f of ALL_TERMS) if (fields.has(f)) out[f] = v[f];
  return out;
}

/** O que o tipo exige e não foi preenchido (validação de UX; o servidor valida o formato). */
export function feeModelMissingFields(v: FeeModelValues): Partial<Record<keyof FeeModelValues, string>> {
  const errors: Partial<Record<keyof FeeModelValues, string>> = {};
  if (!v.name.trim()) errors.name = "Informe o nome do modelo.";
  // Formato primeiro: "1500.00" tem de dizer "use vírgula", não "informe o valor".
  const format = feeTermsErrors(termsOfType(v));
  if (v.billingType === "CUSTOM") return { ...errors, ...format };
  const t = feeTermsInput(termsOfType(v));
  const need = FEE_BILLING_TYPE_META[v.billingType].fields;
  if (need.includes("successFeePercent") && !(t.successFeePercent && t.successFeePercent > 0)) errors.successFeePercent = "Informe o percentual de êxito.";
  if (need.includes("fixedFee") && !(t.fixedFee && t.fixedFee > 0)) errors.fixedFee = v.billingType === "INSTALLMENTS" ? "Informe o valor total." : "Informe o valor.";
  if (need.includes("installments") && !(t.installments && t.installments >= 2)) errors.installments = "Parcelado tem 2 parcelas ou mais.";
  if (need.includes("monthlyFee") && !(t.monthlyFee && t.monthlyFee > 0)) errors.monthlyFee = "Informe a mensalidade.";
  if (need.includes("upfrontFee") && !(t.upfrontFee && t.upfrontFee > 0)) errors.upfrontFee = "Informe a entrada.";
  return { ...errors, ...format };
}

export function feeModelCreateInput(v: FeeModelValues): Record<string, unknown> {
  return {
    name: v.name.trim(),
    description: filled(v.description),
    legalAreaId: filled(v.legalAreaId),
    billingMoment: v.billingMoment,
    notes: filled(v.notes),
    active: v.active,
    ...feeTermsInput(termsOfType(v)),
  };
}

export function feeModelPatch(v: FeeModelValues): Record<string, unknown> {
  return {
    name: v.name.trim(),
    description: filled(v.description) ?? null,
    legalAreaId: filled(v.legalAreaId) ?? null,
    billingMoment: v.billingMoment,
    notes: filled(v.notes) ?? null,
    active: v.active,
    ...feeTermsPatch(termsOfType(v)),
  };
}

/* ------------------------------------------------------------------ */
/* Acordo                                                              */
/* ------------------------------------------------------------------ */

export interface AgreementValues extends FeeTermsValues {
  feeModelId: string;
  startDate: string;
  notes: string;
  activate: boolean;
}

/**
 * createAgreementAction (sem a chave). O contrato é do PROCESSO; o caso o
 * servidor lê do processo. Sem termos e com modelo, o SERVIDOR copia os termos
 * do modelo.
 */
export function agreementCreateInput(legalProcessId: string, v: AgreementValues): Record<string, unknown> {
  return {
    legalProcessId,
    feeModelId: filled(v.feeModelId),
    ...feeTermsInput(v),
    startDate: filled(v.startDate),
    notes: filled(v.notes),
    activate: v.activate,
  };
}

/* ------------------------------------------------------------------ */
/* Obrigação e ledger                                                  */
/* ------------------------------------------------------------------ */

/**
 * "2026-10-13" → meio-dia desse dia em São Paulo (ISO com fuso). O formulário
 * só pergunta o DIA: o servidor confere pela data civil de São Paulo (hoje
 * vale a qualquer hora) e nunca grava um instante no futuro.
 */
export function occurredAtInput(date: string): string | undefined {
  return filled(date) ? `${date}T12:00:00-03:00` : undefined;
}

/* ------------------------------------------------------------------ */
/* Despesa do processo (046)                                           */
/* ------------------------------------------------------------------ */

export interface ExpenseValues {
  category: ExpenseCategory | "";
  description: string;
  amount: string;
  incurredOn: string;
  /** Já paga? Sem data = a pagar. */
  paid: boolean;
  paidOn: string;
  reimbursable: boolean;
  supplier: string;
  notes: string;
}

export function expenseToValues(e: ExpenseDTO | undefined, today: string): ExpenseValues {
  return {
    category: e?.category ?? "",
    description: e?.description ?? "",
    amount: moneyInput(e?.amount),
    incurredOn: e?.incurredOn ?? today,
    paid: !!e?.paidOn,
    paidOn: e?.paidOn ?? today,
    reimbursable: e?.reimbursable ?? false,
    supplier: e?.supplier ?? "",
    notes: e?.notes ?? "",
  };
}

/** createExpenseAction. Processo do contexto (picker ou página); o caso o servidor lê do processo. */
export function expenseCreateInput(processId: string, v: ExpenseValues): Record<string, unknown> {
  return {
    processId,
    category: v.category || undefined,
    description: v.description.trim(),
    amount: money(v.amount),
    incurredOn: filled(v.incurredOn),
    paidOn: v.paid ? filled(v.paidOn) : undefined,
    reimbursable: v.reimbursable,
    supplier: filled(v.supplier),
    notes: filled(v.notes),
  };
}

/** PATCH da despesa: vazio = limpar (null); desmarcar "paga" volta para a pagar. */
export function expensePatch(v: ExpenseValues): Record<string, unknown> {
  return {
    category: v.category || undefined,
    description: v.description.trim(),
    amount: money(v.amount),
    incurredOn: filled(v.incurredOn),
    paidOn: v.paid ? (filled(v.paidOn) ?? null) : null,
    reimbursable: v.reimbursable,
    supplier: filled(v.supplier) ?? null,
    notes: filled(v.notes) ?? null,
  };
}

/** Conferência de UX antes do envio (o servidor valida de novo). */
export function expenseMissingFields(v: ExpenseValues): Partial<Record<keyof ExpenseValues, string>> {
  const errors: Partial<Record<keyof ExpenseValues, string>> = {};
  if (!v.category) errors.category = "Escolha a categoria.";
  if (!v.description.trim()) errors.description = "Descreva a despesa.";
  const amount = moneyField(v.amount, { required: true });
  if (amount.error) errors.amount = amount.error;
  if (!filled(v.incurredOn)) errors.incurredOn = "Informe a data da despesa.";
  if (v.paid && !filled(v.paidOn)) errors.paidOn = "Informe a data do pagamento.";
  return errors;
}
