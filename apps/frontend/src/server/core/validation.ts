import { z } from "zod";

/**
 * Validação de entrada no SERVIDOR (o formulário valida de novo só por UX).
 * Formato apenas: CPF/CNPJ não têm dígito verificador conferido porque o DEV
 * usa identificadores fictícios (999…), como os formulários. O banco é a
 * defesa final (domínios cpf_digits/cnpj_digits, CNJ único, checks).
 */

const digits = (v: string) => v.replace(/\D/g, "");
const allSame = (d: string) => /^(\d)\1+$/.test(d);

export const zUuid = () => z.string().uuid("Identificador inválido.");

/** CPF → 11 dígitos (aceita máscara). */
export const zCpf = () =>
  z
    .string()
    .trim()
    .transform(digits)
    .refine((d) => d.length === 11 && !allSame(d), "CPF deve ter 11 dígitos.");

/** CNPJ → 14 dígitos (aceita máscara). */
export const zCnpj = () =>
  z
    .string()
    .trim()
    .transform(digits)
    .refine((d) => d.length === 14 && !allSame(d), "CNPJ deve ter 14 dígitos.");

/** CPF ou CNPJ (consulta de cliente). */
export const zTaxId = () =>
  z
    .string()
    .trim()
    .transform(digits)
    .refine((d) => (d.length === 11 || d.length === 14) && !allSame(d), "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).");

/** Número CNJ → 20 dígitos (aceita máscara NNNNNNN-DD.AAAA.J.TR.OOOO). */
export const zCnj = () =>
  z
    .string()
    .trim()
    .transform(digits)
    .refine((d) => d.length === 20, "Número CNJ deve ter 20 dígitos.");

export const zCep = () =>
  z
    .string()
    .trim()
    .transform(digits)
    .refine((d) => d.length === 8, "CEP deve ter 8 dígitos.");

/** Data civil YYYY-MM-DD (sem fuso). */
export const zIsoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Data inválida.");

export const zIsoDateTime = () => z.string().datetime({ offset: true, message: "Data/hora inválida." });

/** Valor monetário em reais: número ≥ 0, no máximo 2 casas, até 999 bilhões. */
export const zMoney = () =>
  z
    .number({ message: "Informe um valor." })
    .finite()
    .min(0, "O valor não pode ser negativo.")
    .max(999_999_999_999.99, "Valor muito alto.")
    .refine((v) => Math.round(v * 100) === Number((v * 100).toFixed(6)), "Use no máximo 2 casas decimais.");

/** Valor monetário estritamente positivo. */
export const zPositiveMoney = () => zMoney().refine((v) => v > 0, "O valor precisa ser maior que zero.");

/** Percentual 0–100 com até 2 casas. */
export const zPercentage = () => z.number().min(0).max(100).refine((v) => Math.round(v * 100) === Number((v * 100).toFixed(6)), "Use no máximo 2 casas decimais.");

/** Texto obrigatório (trim), com limite. */
export const zText = (max = 2000, message = "Campo obrigatório.") => z.string().trim().min(1, message).max(max, `Máximo de ${max} caracteres.`);

/** Texto opcional: vazio vira undefined. */
export const zOptionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .transform((v) => (v ? v : undefined))
    .optional();

export const zEmailOptional = () =>
  z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail inválido.")
    .transform((v) => (v ? v : undefined))
    .optional();

export const zUf = () => z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "UF inválida.");
