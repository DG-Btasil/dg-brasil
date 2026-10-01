import { z } from "zod";
import { BILLING_MOMENTS } from "@/lib/constants/status";
import { LEGAL_AREAS } from "@/lib/constants/legal";
import { msg, parseCurrencyInput, zCurrencyOptional, zRequired } from "@/lib/validation";
import type { NewFeeModelInput } from "@/store/types";
import type { FeeModel } from "@/types";
import { toMoneyInput, toPercentInput, type FeeValues } from "./utils";

/* Campos numéricos ficam como texto no formulário e são convertidos no envio. */

const zPercentOptional = () =>
  z
    .string()
    .trim()
    .optional()
    .refine((v) => {
      if (!v) return true;
      const n = parseCurrencyInput(v);
      return n !== undefined && n >= 0 && n <= 100;
    }, msg.percent);

const zInstallmentsOptional = () =>
  z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 120), "Informe um número de parcelas entre 1 e 120.");

const feeValueFields = {
  upfrontFee: zCurrencyOptional(),
  fixedFee: zCurrencyOptional(),
  installments: zInstallmentsOptional(),
  monthlyFee: zCurrencyOptional(),
  successFeePercent: zPercentOptional(),
};

/* ------------------------------------------------------------------ */
/* Modelo de honorários                                                */
/* ------------------------------------------------------------------ */

export const feeModelSchema = z.object({
  name: zRequired(),
  description: z.string().trim().optional(),
  area: z.union([z.enum(LEGAL_AREAS), z.literal("")]).optional(),
  ...feeValueFields,
  billingMoment: z.enum(BILLING_MOMENTS),
  notes: z.string().trim().optional(),
  active: z.boolean(),
});
export type FeeModelFormValues = z.infer<typeof feeModelSchema>;

export function feeModelToForm(model?: FeeModel): FeeModelFormValues {
  return {
    name: model?.name ?? "",
    description: model?.description ?? "",
    area: model?.area ?? "",
    upfrontFee: toMoneyInput(model?.upfrontFee),
    fixedFee: toMoneyInput(model?.fixedFee),
    installments: model?.installments ? String(model.installments) : "",
    monthlyFee: toMoneyInput(model?.monthlyFee),
    successFeePercent: toPercentInput(model?.successFeePercent),
    billingMoment: model?.billingMoment ?? "ON_SIGNING",
    notes: model?.notes ?? "",
    active: model?.active ?? true,
  };
}

export function formToFeeModelInput(values: FeeModelFormValues): NewFeeModelInput {
  return {
    name: values.name.trim(),
    description: values.description || undefined,
    area: values.area || undefined,
    upfrontFee: parseCurrencyInput(values.upfrontFee),
    fixedFee: parseCurrencyInput(values.fixedFee),
    installments: values.installments ? Number(values.installments) : undefined,
    monthlyFee: parseCurrencyInput(values.monthlyFee),
    successFeePercent: parseCurrencyInput(values.successFeePercent),
    billingMoment: values.billingMoment,
    notes: values.notes || undefined,
    active: values.active,
  };
}

/* ------------------------------------------------------------------ */
/* Contrato de honorários                                              */
/* ------------------------------------------------------------------ */

export const agreementSchema = z.object({
  clientId: zRequired("Selecione o cliente."),
  /** O contrato pertence ao CASO (abrange todos os processos dele). */
  legalCaseId: zRequired("Selecione o caso."),
  feeModelId: z.string().optional(),
  customized: z.boolean(),
  ...feeValueFields,
  startDate: zRequired(msg.date),
  notes: z.string().trim().optional(),
});
export type AgreementFormValues = z.infer<typeof agreementSchema>;

export type FeeFieldName = "upfrontFee" | "fixedFee" | "installments" | "monthlyFee" | "successFeePercent";

/** Valores do modelo convertidos para os campos do formulário. */
export function feeModelToFeeFields(model: FeeModel | undefined): Pick<AgreementFormValues, FeeFieldName> {
  return {
    upfrontFee: toMoneyInput(model?.upfrontFee),
    fixedFee: toMoneyInput(model?.fixedFee),
    installments: model?.installments ? String(model.installments) : "",
    monthlyFee: toMoneyInput(model?.monthlyFee),
    successFeePercent: toPercentInput(model?.successFeePercent),
  };
}

/** Campos do formulário → números (tolerante a valores parciais, usado na prévia). */
export function formToFeeValues(values: Partial<Pick<AgreementFormValues, FeeFieldName>>): FeeValues {
  const installments = values.installments && /^\d+$/.test(values.installments) ? Number(values.installments) : 1;
  return {
    upfrontFee: parseCurrencyInput(values.upfrontFee) ?? 0,
    fixedFee: parseCurrencyInput(values.fixedFee) ?? 0,
    installments,
    monthlyFee: parseCurrencyInput(values.monthlyFee) || undefined,
    successFeePercent: parseCurrencyInput(values.successFeePercent) || undefined,
  };
}
