import { PROPOSAL_TYPE_LABEL } from "./labels";

/**
 * Regras da decisão em conjunto na fila de Revisões (puro: usado no servidor,
 * que é quem manda, e na tela, que só antecipa a resposta).
 *
 * O contrato não muda: cada item continua sendo decidido um a um por
 * `decide_review`, na sessão da pessoa, com a auditoria de cada um. Em
 * conjunto entra só o que dá para decidir sem abrir:
 *
 * - documento (minuta) e análise NUNCA entram: exigem abrir e ler;
 * - APROVAR em conjunto vale só para proposta simples: pedido de documento e
 *   proposta sem efeito automático ("OTHER"). Prazo, cadastro de processo,
 *   atualização do caso e mudança de agente ou skill criam ou alteram registro
 *   na hora: cada um é aberto e conferido;
 * - pedido de documento que leva MENSAGEM AO PARCEIRO também é aberto antes de
 *   aprovar: o texto sai do escritório e a fila não o mostra;
 * - REJEITAR em conjunto vale para qualquer proposta que a pessoa pode decidir
 *   (rejeitar não aplica nada);
 * - proposta estrutural (agente, skill…) continua só de ADMIN.
 */

export const BULK_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type BulkDecision = (typeof BULK_DECISIONS)[number];

/** Itens por pedido (o mesmo teto de uma página da listagem). */
export const MAX_BULK_REVIEWS = 50;

/** Tipos de proposta que podem ser APROVADOS em conjunto. */
export const BULK_APPROVABLE_PROPOSAL_TYPES: readonly string[] = ["REQUEST_DOCUMENT", "OTHER"];

export type BulkBlockReason = "DECIDED" | "DOCUMENT" | "ANALYSIS" | "ADMIN_ONLY" | "NEEDS_OPENING" | "PARTNER_MESSAGE";

export interface BulkCandidate {
  targetKind: "DOCUMENT_VERSION" | "ANALYSIS" | "AGENT_PROPOSAL";
  proposalType?: string;
  requiresAdmin: boolean;
  dbStatus: string;
  /** A proposta, se aprovada, manda um texto ao parceiro do caso. */
  sendsToPartner?: boolean;
}

/** Por que o item fica de fora da decisão em conjunto; `null` = pode entrar. */
export function bulkBlock(item: BulkCandidate, decision: BulkDecision, isAdmin: boolean): BulkBlockReason | null {
  if (item.dbStatus !== "PENDING" && item.dbStatus !== "REOPENED") return "DECIDED";
  if (item.targetKind === "DOCUMENT_VERSION") return "DOCUMENT";
  if (item.targetKind === "ANALYSIS") return "ANALYSIS";
  if (item.requiresAdmin && !isAdmin) return "ADMIN_ONLY";
  if (decision === "APPROVED" && !BULK_APPROVABLE_PROPOSAL_TYPES.includes(item.proposalType ?? "")) return "NEEDS_OPENING";
  if (decision === "APPROVED" && item.sendsToPartner) return "PARTNER_MESSAGE";
  return null;
}

/** O item pode ser marcado na fila? (Entra em pelo menos uma das duas decisões.) */
export function bulkSelectable(item: BulkCandidate, isAdmin: boolean): boolean {
  return bulkBlock(item, "REJECTED", isAdmin) === null;
}

/** "Solicitar alterações" não vale para proposta (o banco recusa, 067): não há o que o agente alterar. */
export const PROPOSAL_CHANGES_MESSAGE = "Proposta do agente só pode ser aprovada ou rejeitada. Para recusar, rejeite e escreva o motivo.";

/** "Solicitar alterações" faz sentido para este alvo? (Documento e análise: sim; proposta: não.) */
export function canRequestChanges(targetKind: BulkCandidate["targetKind"]): boolean {
  return targetKind !== "AGENT_PROPOSAL";
}

export interface BulkPlanItem {
  id: string;
  subject?: string;
  outcome: "DECIDED" | "SKIPPED" | "FAILED";
  reason?: BulkBlockReason | "NOT_FOUND";
  message?: string;
}

/** Um passo do laço: decidir (chamar decide_review) ou deixar de fora, já com o motivo. */
export type BulkStep = { outcome: "DECIDE"; item: BulkPlanItem } | { outcome: "SKIP"; item: BulkPlanItem };

/**
 * O que fazer com cada id pedido, na ordem pedida e sem repetir. Revisão que
 * não veio do banco (não existe ou a pessoa não vê) fica de fora como "não
 * encontrada"; as demais passam pela regra de `bulkBlock`.
 */
export function planBulkDecision(
  ids: readonly string[],
  found: readonly (BulkCandidate & { id: string; subject: string })[],
  decision: BulkDecision,
  isAdmin: boolean,
): BulkStep[] {
  const byId = new Map(found.map((r) => [r.id, r]));
  return [...new Set(ids)].map((id): BulkStep => {
    const review = byId.get(id);
    if (!review) return { outcome: "SKIP", item: { id, outcome: "SKIPPED", reason: "NOT_FOUND", message: "Revisão não encontrada." } };
    const reason = bulkBlock(review, decision, isAdmin);
    if (reason) return { outcome: "SKIP", item: { id, subject: review.subject, outcome: "SKIPPED", reason, message: bulkBlockMessage(reason, review) } };
    return { outcome: "DECIDE", item: { id, subject: review.subject, outcome: "DECIDED" } };
  });
}

/** Explicação para a pessoa, em uma frase. */
export function bulkBlockMessage(reason: BulkBlockReason, item: Pick<BulkCandidate, "proposalType">): string {
  switch (reason) {
    case "DECIDED":
      return "Já foi decidida.";
    case "DOCUMENT":
      return "Documento: abra para ler e decidir.";
    case "ANALYSIS":
      return "Análise: abra para ler e decidir.";
    case "ADMIN_ONLY":
      return "Só um administrador decide esta proposta.";
    case "NEEDS_OPENING":
      return `${(item.proposalType && PROPOSAL_TYPE_LABEL[item.proposalType]) ?? "Esta proposta"}: abra para conferir antes de aprovar.`;
    case "PARTNER_MESSAGE":
      return "Leva mensagem ao parceiro: abra para ler antes de aprovar.";
  }
}
