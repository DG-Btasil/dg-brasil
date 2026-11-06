import { parseCurrencyInput } from "@/lib/validation";
import { parsePercentInput, type ProcessEditValues, type ProcessFormValues } from "./schemas";

/**
 * Formulário de processo (strings) → entrada das Server Actions. Puro: o
 * servidor valida de novo (schemas de server/domain/processes). O processo
 * não tem nome próprio (exibido com o título do caso) e o cadastro não cria
 * prazo inicial — prazos são lançados na aba Prazos.
 */

/** Campos comuns ao cadastro e à edição (servidor valida de novo; "" limpa na edição). */
function processFields(v: ProcessEditValues) {
  return {
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
  return {
    ...processFields(v),
    legalCaseId: v.legalCaseId,
    // Cadastro: vazio = ausente (o servidor trata "" como ausente nos campos com formato).
    caseValue: parseCurrencyInput(v.caseValue),
    feeAmount: parseCurrencyInput(v.feeAmount),
    feePercentage: parsePercentInput(v.feePercentage),
  };
}

/** Formulário (edição) → patch de updateProcessAction: vazio limpa (null). */
export function processEditPatch(v: ProcessEditValues): Record<string, unknown> {
  return {
    ...processFields(v),
    caseValue: parseCurrencyInput(v.caseValue) ?? null,
    feeAmount: parseCurrencyInput(v.feeAmount) ?? null,
    feePercentage: parsePercentInput(v.feePercentage) ?? null,
  };
}
