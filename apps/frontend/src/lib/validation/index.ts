import { z } from "zod";
import { onlyDigits } from "@/lib/formatting/masks";

/**
 * Validações de FORMATO para os formulários (em português).
 * Não validam existência nem dígito verificador contra bases oficiais:
 * os mocks usam identificadores fictícios, propositalmente não emitidos.
 */

const allSameDigit = (d: string) => /^(\d)\1+$/.test(d);

/**
 * Dígitos verificadores do CPF (módulo 11). NÃO entra na validação do
 * formulário (os dados fictícios não têm dígito válido): serve para não gastar
 * uma consulta paga na Receita com um CPF digitado errado.
 */
export function cpfCheckDigitsOk(v: string): boolean {
  const d = onlyDigits(v);
  if (d.length !== 11 || allSameDigit(d)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

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

/**
 * Leitura de um número digitado no formato brasileiro. Três respostas, nunca
 * misturadas: campo vazio (de propósito), número, ou texto que NÃO é número.
 * Texto inválido nunca vira "em branco": em branco tem significado nas telas
 * (quitar o saldo, estornar tudo, limpar o valor).
 */
export type NumberInputReading =
  | { kind: "empty" }
  | { kind: "ok"; value: number }
  | { kind: "invalid"; problem: "DOT_DECIMAL" | "TOO_MANY_DECIMALS" | "NOT_A_NUMBER"; message: string };

/** "1234", "1.234", "1.234.567,8", "1234,56": ponto só como separador de milhar, vírgula para os decimais (até 2). */
const BR_NUMBER = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/;
const BR_NUMBER_LONG_DECIMALS = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{3,}$/;

function readBrNumber(text: string, messages: { dot: string; decimals: string; invalid: string }): NumberInputReading {
  if (!text) return { kind: "empty" };
  if (BR_NUMBER.test(text)) return { kind: "ok", value: Number(text.replace(/\./g, "").replace(",", ".")) };
  if (BR_NUMBER_LONG_DECIMALS.test(text)) return { kind: "invalid", problem: "TOO_MANY_DECIMALS", message: messages.decimals };
  // Só dígitos, pontos e vírgulas, com ponto fora do lugar de milhar: é o ponto usado como decimal ("1500.00", "2.5", "1,234.56").
  if (/^-?[\d.,]+$/.test(text) && text.includes(".")) return { kind: "invalid", problem: "DOT_DECIMAL", message: messages.dot };
  return { kind: "invalid", problem: "NOT_A_NUMBER", message: messages.invalid };
}

const CURRENCY_MESSAGES = {
  dot: "Use vírgula para os centavos. Exemplo: 1.500,00.",
  decimals: "Use no máximo 2 casas depois da vírgula.",
  invalid: "Informe um valor válido. Exemplo: 1.500,00.",
};
const PERCENT_MESSAGES = {
  dot: "Use vírgula para as casas decimais. Exemplo: 2,5.",
  decimals: "Use no máximo 2 casas depois da vírgula.",
  invalid: "Informe um percentual válido. Exemplo: 30 ou 2,5.",
};

/**
 * Valor em reais digitado como texto. Aceita "1.234,56", "1234,56", "1234" e
 * "R$ 1.234,56". Recusa o ponto como decimal ("1500.00" já virou 150000 aqui):
 * a resposta diz o que fazer.
 */
export function readCurrencyInput(value: string | undefined | null): NumberInputReading {
  return readBrNumber((value ?? "").replace(/R\$/i, "").replace(/\s/g, ""), CURRENCY_MESSAGES);
}

/** Percentual digitado como texto ("30", "2,5", "33,33%"). Mesma disciplina do dinheiro: "2.5" é recusado, não vira 25. */
export function readPercentInput(value: string | undefined | null): NumberInputReading {
  return readBrNumber((value ?? "").replace(/\s/g, "").replace(/%$/, ""), PERCENT_MESSAGES);
}

/**
 * Valor monetário digitado como texto ("1.234,56") → número. Vazio E inválido
 * devolvem `undefined`: quem chama já validou o campo (`zCurrencyOptional` no
 * formulário, ou `readCurrencyInput` quando "em branco" tem significado).
 */
export function parseCurrencyInput(value: string | undefined): number | undefined {
  const reading = readCurrencyInput(value);
  return reading.kind === "ok" ? reading.value : undefined;
}

export const zCurrencyOptional = () =>
  z
    .string()
    .trim()
    .optional()
    .superRefine((v, ctx) => {
      const reading = readCurrencyInput(v);
      if (reading.kind === "invalid") ctx.addIssue({ code: "custom", message: reading.message });
      else if (reading.kind === "ok" && reading.value < 0) ctx.addIssue({ code: "custom", message: msg.positive });
    });
