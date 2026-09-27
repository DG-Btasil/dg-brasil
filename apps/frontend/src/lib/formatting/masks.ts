/**
 * Máscaras de entrada e de exibição.
 * - format*: formata para exibição completa (ex.: 000.123.456-10).
 * - mask*:   oculta parte do identificador para listagens (LGPD — minimização).
 * - input masks: aplicadas enquanto o usuário digita.
 */

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Aplica um padrão onde "9" representa um dígito. */
export function applyPattern(value: string, pattern: string): string {
  const digits = onlyDigits(value);
  let out = "";
  let i = 0;
  for (const ch of pattern) {
    if (i >= digits.length) break;
    if (ch === "9") {
      out += digits[i];
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

export const PATTERNS = {
  cpf: "999.999.999-99",
  cnpj: "99.999.999/9999-99",
  cep: "99999-999",
  phone: "(99) 9999-9999",
  mobile: "(99) 99999-9999",
  cnj: "9999999-99.9999.9.99.9999",
  date: "99/99/9999",
} as const;

export function formatCPF(value: string): string {
  return applyPattern(value, PATTERNS.cpf);
}

export function formatCNPJ(value: string): string {
  return applyPattern(value, PATTERNS.cnpj);
}

export function formatCEP(value: string): string {
  return applyPattern(value, PATTERNS.cep);
}

export function formatPhone(value: string): string {
  const digits = onlyDigits(value);
  return applyPattern(digits, digits.length > 10 ? PATTERNS.mobile : PATTERNS.phone);
}

export function formatCNJ(value: string): string {
  return applyPattern(value, PATTERNS.cnj);
}

export function formatDocument(value: string): string {
  const digits = onlyDigits(value);
  return digits.length > 11 ? formatCNPJ(digits) : formatCPF(digits);
}

/** ***.456.789-** */
export function maskCPF(value: string): string {
  const d = onlyDigits(value).padEnd(11, "0");
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/** **.345.678/0001-** */
export function maskCNPJ(value: string): string {
  const d = onlyDigits(value).padEnd(14, "0");
  return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
}

export function maskDocument(value: string): string {
  return onlyDigits(value).length > 11 ? maskCNPJ(value) : maskCPF(value);
}

/** Máscaras usadas pelos inputs (ver components/ui/masked-input). */
export const INPUT_MASKS = {
  cpf: (v: string) => formatCPF(v),
  cnpj: (v: string) => formatCNPJ(v),
  cep: (v: string) => formatCEP(v),
  phone: (v: string) => formatPhone(v),
  cnj: (v: string) => formatCNJ(v),
  document: (v: string) => formatDocument(v),
  oab: (v: string) => v.toUpperCase().replace(/[^0-9A-Z/ ]/g, "").slice(0, 12),
} as const;
export type InputMaskName = keyof typeof INPUT_MASKS;
