import { formatCurrency, formatDate } from "@/lib/formatting";
import { msg, parseCurrencyInput } from "@/lib/validation";
import type { DbAnalysisStatus } from "@/repositories/api/db-mappings";
import type { TemplateFieldDTO } from "@/server/domain/analyses/dto";

/**
 * Campos do template de análise (definição vinda do banco) → formulário.
 * Puro: o servidor valida de novo (validateTemplateFields em
 * server/domain/analyses/mappers.ts) e é a autoridade.
 */

/** Nome do controle no DOM, usado para focar o primeiro campo inválido. */
export const fieldInputName = (key: string) => `analysis-field-${key}`;

/** Obrigatoriedade e formato a partir da definição do template. */
export function validateFields(fields: TemplateFieldDTO[], values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.key] ?? "").trim();
    if (!v) {
      if (f.required) errors[f.key] = msg.required;
      continue;
    }
    if ((f.type === "number" || f.type === "currency") && !/^-?\d+([.,]\d+)?$/.test(v.replace(/\./g, "").replace(/^R\$\s*/, ""))) {
      errors[f.key] = f.type === "currency" ? "Informe um valor válido." : "Informe um número válido.";
    }
    if (f.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) errors[f.key] = msg.date;
    if (f.type === "boolean" && v !== "true" && v !== "false") errors[f.key] = "Use sim ou não.";
    if (f.type === "select" && !(f.options ?? []).some((o) => o.value === v)) errors[f.key] = "Selecione uma opção válida.";
  }
  return errors;
}

/** Respostas → entrada da action: só campos do template, aparados; vazio não vai. Moeda vai como número com ponto. */
export function fieldsPayload(fields: TemplateFieldDTO[], values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.key] ?? "").trim();
    if (!v) continue;
    if (f.type === "currency" || f.type === "number") {
      const n = parseCurrencyInput(v);
      out[f.key] = n === undefined ? v : String(n);
    } else out[f.key] = v;
  }
  return out;
}

/** Valor legível de um campo (respostas ficam como texto). */
export function formatFieldValue(field: TemplateFieldDTO, raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  switch (field.type) {
    case "select":
      return field.options?.find((o) => o.value === raw)?.label ?? raw;
    case "boolean":
      return raw === "true" ? "Sim" : raw === "false" ? "Não" : raw;
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? formatDate(raw) : raw;
    case "currency": {
      const n = Number(raw);
      return Number.isFinite(n) ? formatCurrency(n) : raw;
    }
    case "number":
      return raw.replace(".", ",");
    default:
      return raw;
  }
}

/** Com o agente ou aguardando revisão: não se inicia outra análise no caso. */
export const IN_FLIGHT_STATUSES: readonly DbAnalysisStatus[] = ["QUEUED", "RUNNING", "WAITING_REVIEW"];
/** Pode ir (ou voltar) para o agente — quem decide de fato é o banco (029). */
export const SENDABLE_STATUSES: readonly DbAnalysisStatus[] = ["PENDING", "WAITING_DOCUMENTS", "FAILED", "CANCELLED"];
