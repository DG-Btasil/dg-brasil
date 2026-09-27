import type { StepState } from "@/components/ui/display";
import type { AnalysisStatus } from "@/lib/constants/status";
import { formatCurrency, formatDate } from "@/lib/formatting";
import { parseCurrencyInput } from "@/lib/validation";
import type { AnalysisStepStatus, LegalAnalysis, TemplateField } from "@/types";

export const STEP_STATE: Record<AnalysisStepStatus, StepState> = {
  DONE: "done",
  CURRENT: "current",
  PENDING: "pending",
  BLOCKED: "blocked",
};

/** Análises que ainda estão em curso (impedem iniciar outra). */
export const ACTIVE_ANALYSIS_STATUSES: readonly AnalysisStatus[] = ["WAITING_DOCUMENTS", "READY", "ANALYZING", "WAITING_REVIEW"];

/** Estados em que a análise pode ser interrompida pelo usuário. */
export const INTERRUPTIBLE_STATUSES: readonly AnalysisStatus[] = ["WAITING_DOCUMENTS", "READY", "ANALYZING"];

export function isActiveAnalysis(analysis: LegalAnalysis): boolean {
  return ACTIVE_ANALYSIS_STATUSES.includes(analysis.status);
}

/** Ordena da mais recente para a mais antiga. */
export function sortAnalysesByRecent(list: LegalAnalysis[]): LegalAnalysis[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Análise em curso, ou a mais recente. */
export function currentAnalysis(list: LegalAnalysis[]): LegalAnalysis | undefined {
  const sorted = sortAnalysesByRecent(list);
  return sorted.find(isActiveAnalysis) ?? sorted[0];
}

/** Valor legível de um campo de template (respostas ficam como string). */
export function formatFieldValue(field: TemplateField, raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  switch (field.type) {
    case "select":
      return field.options?.find((o) => o.value === raw)?.label ?? raw;
    case "boolean":
      return raw === "true" ? "Sim" : raw === "false" ? "Não" : raw;
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? formatDate(raw) : raw;
    case "currency": {
      const n = parseCurrencyInput(raw);
      return n === undefined ? raw : formatCurrency(n);
    }
    case "number":
      return raw.replace(".", ",");
    default:
      return raw;
  }
}
