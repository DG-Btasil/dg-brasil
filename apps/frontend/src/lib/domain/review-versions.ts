/**
 * Versões de documento de uma revisão (fonte única, pura).
 *
 * A aprovação pertence a UMA versão: `ReviewDecision.contentVersion`. Uma
 * versão criada depois (edição manual, edição pelo agente, reabertura +
 * edição) começa sempre pendente, mesmo que a anterior tenha sido aprovada.
 */
import type { DocumentVersion, Review, ReviewDecision } from "@/types";

export function currentVersionNumber(review: Pick<Review, "contentVersion">): number {
  return review.contentVersion ?? 1;
}

/** A versão foi aprovada e essa aprovação continua valendo? */
export function isApprovedVersion(review: Pick<Review, "status" | "contentVersion">, decisions: ReviewDecision[], version: number): boolean {
  const current = currentVersionNumber(review);
  if (version === current) {
    // A versão atual só conta como aprovada enquanto a revisão está aprovada
    // (reabrir invalida a decisão para a versão vigente).
    if (review.status !== "APPROVED") return false;
    const last = decisions.find((d) => d.decision === "APPROVED");
    return (last?.contentVersion ?? 1) === current;
  }
  // Versão antiga: aprovada se recebeu aprovação (fica no histórico).
  return decisions.some((d) => d.decision === "APPROVED" && (d.contentVersion ?? 1) === version);
}

/** Lista de versões (mais recente primeiro), derivada da revisão. */
export function reviewVersions(review: Review, decisions: ReviewDecision[]): DocumentVersion[] {
  const current = currentVersionNumber(review);
  const history = review.history ?? [];
  const editFor = (version: number) => history.find((h) => (h.kind === "MANUAL_EDIT" || h.kind === "AGENT_EDIT") && h.toVersion === version);
  const status = (version: number): DocumentVersion["approvalStatus"] =>
    isApprovedVersion(review, decisions, version) ? "APPROVED" : version === current ? "PENDING" : "SUPERSEDED";

  const previous = (review.previousVersions ?? []).map((p) => {
    const edit = editFor(p.version);
    return {
      id: `${review.id}_v${p.version}`,
      documentId: review.id,
      versionNumber: p.version,
      source: p.origin,
      createdBy: edit?.actor ?? { type: "AGENT" as const, id: review.agentId, name: "Agente" },
      createdAt: edit?.at ?? review.createdAt,
      content: p.content,
      approvalStatus: status(p.version),
      instruction: edit?.instruction,
      current: false,
    };
  });
  const currentEdit = editFor(current);
  const currentVersion: DocumentVersion = {
    id: `${review.id}_v${current}`,
    documentId: review.id,
    versionNumber: current,
    source: currentEdit?.kind === "MANUAL_EDIT" ? "MANUAL_EDIT" : currentEdit?.kind === "AGENT_EDIT" ? "AGENT_EDIT" : "AGENT",
    createdBy: currentEdit?.actor ?? { type: "AGENT", id: review.agentId, name: "Agente" },
    createdAt: currentEdit?.at ?? review.createdAt,
    content: review.content,
    approvalStatus: status(current),
    instruction: currentEdit?.instruction,
    current: true,
  };
  return [currentVersion, ...previous.sort((a, b) => b.versionNumber - a.versionNumber)];
}
