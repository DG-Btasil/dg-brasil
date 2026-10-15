import { z } from "zod";
import { onlyDigits } from "@/lib/formatting/masks";

/**
 * Validações de FORMATO para os formulários (em português).
 * Não validam existência nem dígito verificador contra bases oficiais:
 * os mocks usam identificadores fictícios, propositalmente não emitidos.
 */

const allSameDigit = (d: string) => /^(\d)\1+$/.test(d);

export const isCpfFormat = (v: string) => {
  const d = onlyDigits(v);
  return d.length === 11 && !allSameDigit(d);
};
export const isCnpjFormat = (v: string) => {
  const d = onlyDigits(v);
  return d.length === 14 && !allSameDigit(d);
};

/**
 * Motivo de um CPF/CNPJ ser recusado: tamanho errado ou todos os dígitos
 * iguais ("111.111.111-11" tem 11 dígitos — dizer "deve ter 11 dígitos"
 * confundia; QA 4.3, OBS-02). null = formato aceito.
 */
export function taxIdProblem(v: string, kind: "cpf" | "cnpj"): string | null {
  const d = onlyDigits(v);
  if (d.length !== (kind === "cpf" ? 11 : 14)) return msg[kind];
  return allSameDigit(d) ? msg.taxIdInvalid[kind] : null;
}
const taxIdRefine = (kind: "cpf" | "cnpj") => (v: string | undefined, ctx: z.RefinementCtx) => {
  const problem = v ? taxIdProblem(v, kind) : null;
  if (problem) ctx.addIssue({ code: "custom", message: problem });
};
export const isCepFormat = (v: string) => onlyDigits(v).length === 8;
export const isPhoneFormat = (v: string) => {
  const n = onlyDigits(v).length;
  return n === 10 || n === 11;
};
export const isCnjFormat = (v: string) => onlyDigits(v).length === 20;

export const msg = {
  required: "Campo obrigatório.",
  email: "Informe um e-mail válido.",
  cpf: "CPF deve ter 11 dígitos.",
  cnpj: "CNPJ deve ter 14 dígitos.",
  taxIdInvalid: { cpf: "CPF inválido.", cnpj: "CNPJ inválido." },
  cep: "CEP deve ter 8 dígitos.",
  phone: "Telefone deve ter DDD e 8 ou 9 dígitos.",
  cnj: "Número CNJ deve ter 20 dígitos (0000000-00.0000.0.00.0000).",
  date: "Informe uma data válida.",
  positive: "Informe um valor maior ou igual a zero.",
  percent: "Informe um percentual entre 0 e 100.",
};

/** String obrigatória (após trim). */
export const zRequired = (message = msg.required) => z.string().trim().min(1, message);

/** String opcional: vazio vira undefined. */
export const zOptional = () =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined));

export const zEmail = () => z.string().trim().min(1, msg.required).email(msg.email);
export const zEmailOptional = () =>
  z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, msg.email)
    .transform((v) => (v ? v : undefined));

export const zCpf = () => z.string().trim().min(1, msg.required).superRefine(taxIdRefine("cpf"));
export const zCnpj = () => z.string().trim().min(1, msg.required).superRefine(taxIdRefine("cnpj"));
export const zCpfOptional = () => z.string().trim().optional().superRefine(taxIdRefine("cpf"));
export const zCnpjOptional = () => z.string().trim().optional().superRefine(taxIdRefine("cnpj"));
export const zCepOptional = () =>
  z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isCepFormat(v), msg.cep);
export const zPhone = () => z.string().trim().min(1, msg.required).refine(isPhoneFormat, msg.phone);
export const zPhoneOptional = () =>
  z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isPhoneFormat(v), msg.phone);
export const zCnjOptional = () =>
  z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isCnjFormat(v), msg.cnj);

/** Valor monetário digitado como texto ("1.234,56") → número. */
export function parseCurrencyInput(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

export const zCurrencyOptional = () =>
  z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || parseCurrencyInput(v) !== undefined, "Informe um valor válido.")
    .refine((v) => !v || (parseCurrencyInput(v) ?? 0) >= 0, msg.positive);
