/**
 * "Corrigir e aprovar" (069): regras puras, usadas no servidor (que manda) e
 * na tela (que só antecipa). O banco é a autoridade
 * (`public.correct_and_approve_review`).
 *
 * - Vale só para proposta do agente com efeito automático: prazo, pedido de
 *   documento, atualização do caso e cadastro de processo. "OTHER" não tem o
 *   que aplicar; proposta estrutural (agente, skill) fica de fora.
 * - Só revisão em aberto, e só quem pode decidir aquela revisão.
 * - Corrigir é a própria aprovação: as duas coisas acontecem juntas, numa
 *   decisão humana. Não existe "corrigir e deixar pendente".
 */

export const CORRECTABLE_PROPOSAL_TYPES = ["CREATE_DEADLINE", "REQUEST_DOCUMENT", "UPDATE_CASE", "CREATE_PROCESS"] as const;
export type CorrectableProposalType = (typeof CORRECTABLE_PROPOSAL_TYPES)[number];

export function isCorrectableProposalType(type: string | undefined | null): type is CorrectableProposalType {
  return (CORRECTABLE_PROPOSAL_TYPES as readonly string[]).includes(type ?? "");
}

export interface CorrectionCandidate {
  targetKind: "DOCUMENT_VERSION" | "ANALYSIS" | "AGENT_PROPOSAL";
  proposalType?: string;
  requiresAdmin: boolean;
  dbStatus: string;
}

/** A revisão mostra "Corrigir e aprovar"? */
export function canCorrectProposal(item: CorrectionCandidate, isAdmin: boolean): boolean {
  if (item.targetKind !== "AGENT_PROPOSAL") return false;
  if (item.dbStatus !== "PENDING" && item.dbStatus !== "REOPENED") return false;
  if (item.requiresAdmin && !isAdmin) return false;
  return isCorrectableProposalType(item.proposalType);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Nomes dos campos que mudaram entre os dados que o agente propôs e os
 * corrigidos (ordem alfabética, como o banco grava na auditoria).
 */
export function changedProposalFields(original: Record<string, unknown>, corrected: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(original), ...Object.keys(corrected)]);
  return [...keys].filter((k) => !same(original[k], corrected[k])).sort();
}

/** Mensagem quando a correção não muda nada (o banco recusa com o mesmo sentido). */
export const NOTHING_CHANGED_MESSAGE = 'Nada foi alterado. Para aprovar a proposta como está, use "Aprovar".';
