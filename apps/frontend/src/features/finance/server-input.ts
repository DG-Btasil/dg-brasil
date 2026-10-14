import type { BillingMoment } from "@/lib/constants/status";
import { parseCurrencyInput } from "@/lib/validation";
import type { FeeModelDTO } from "@/server/domain/finance/dto";

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
const money = (v: string | undefined) => (filled(v) ? parseCurrencyInput(v) : undefined);
const integer = (v: string | undefined) => (filled(v) && /^\d+$/.test((v as string).trim()) ? Number((v as string).trim()) : undefined);

export interface FeeTermsValues {
  upfrontFee: string;
  fixedFee: string;
  installments: string;
  monthlyFee: string;
  successFeePercent: string;
}

/** Termos preenchidos (vazio = ausente). */
export function feeTermsInput(v: FeeTermsValues) {
  return {
    upfrontFee: money(v.upfrontFee),
    fixedFee: money(v.fixedFee),
    installments: integer(v.installments),
    monthlyFee: money(v.monthlyFee),
    successFeePercent: money(v.successFeePercent),
  };
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

export interface FeeModelValues extends FeeTermsValues {
  name: string;
  description: string;
  legalAreaId: string;
  billingMoment: BillingMoment;
  notes: string;
  active: boolean;
}

export function feeModelToValues(m?: FeeModelDTO): FeeModelValues {
  return {
    name: m?.name ?? "",
    description: m?.description ?? "",
    legalAreaId: m?.legalAreaId ?? "",
    billingMoment: m?.billingMoment ?? "ON_SIGNING",
    notes: m?.notes ?? "",
    active: m?.active ?? true,
    ...feeTermsFromModel(m),
  };
}

export function feeModelCreateInput(v: FeeModelValues): Record<string, unknown> {
  return {
    name: v.name.trim(),
    description: filled(v.description),
    legalAreaId: filled(v.legalAreaId),
    billingMoment: v.billingMoment,
    notes: filled(v.notes),
    active: v.active,
    ...feeTermsInput(v),
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
    ...feeTermsPatch(v),
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

/** createAgreementAction (sem a chave). Sem termos e com modelo, o SERVIDOR copia os termos do modelo. */
export function agreementCreateInput(legalCaseId: string, v: AgreementValues): Record<string, unknown> {
  return {
    legalCaseId,
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

/** "2026-10-13" + hora local → ISO com o fuso de São Paulo (fato financeiro; nunca no futuro — o servidor confere). */
export function occurredAtInput(date: string): string | undefined {
  return filled(date) ? `${date}T12:00:00-03:00` : undefined;
}

export { money as parseMoneyField };
