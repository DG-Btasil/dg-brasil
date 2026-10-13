import { parseCurrencyInput } from "@/lib/validation";
import type { ProcessEditValues, ProcessFormValues } from "./schemas";

/**
 * Formulário de processo (strings) → entrada das Server Actions. Puro: o
 * servidor valida de novo (schemas de server/domain/processes).
 */

export const DEFAULT_DEADLINE_TITLE = "Acompanhamento do processo";

/** Campos comuns ao cadastro e à edição (servidor valida de novo; "" limpa na edição). */
function processFields(v: Omit<ProcessFormValues, "legalCaseId" | "deadlineTitle" | "deadlineType" | "deadlineDueDate">) {
  return {
    title: v.title.trim(),
    cnj: v.cnj ?? "",
    court: v.court ?? "",
    unit: v.unit ?? "",
    district: v.district ?? "",
    state: v.state ?? "",
    actionType: v.actionType,
    subject: v.subject ?? "",
    clientPole: v.clientPole,
    opposingParty: v.opposingParty ?? "",
    responsibleUserId: v.responsibleUserId,
    distributionDate: v.distributionDate ?? "",
    status: v.status,
    phase: v.phase,
    notes: v.notes ?? "",
  };
}

/** Formulário (cadastro) → createProcessAction (sem a chave de idempotência). */
export function processCreateInput(v: ProcessFormValues): Record<string, unknown> {
  const f = processFields(v);
  return {
    ...f,
    legalCaseId: v.legalCaseId,
    // Cadastro: vazio = ausente (o servidor trata "" como ausente nos campos com formato).
    caseValue: parseCurrencyInput(v.caseValue),
    nextDeadline: { title: v.deadlineTitle?.trim() || DEFAULT_DEADLINE_TITLE, type: v.deadlineType || "INTERNAL", dueDate: v.deadlineDueDate },
  };
}

/** Formulário (edição) → patch de updateProcessAction: vazio limpa (null). */
export function processEditPatch(v: ProcessEditValues): Record<string, unknown> {
  return { ...processFields(v), caseValue: parseCurrencyInput(v.caseValue) ?? null };
}
