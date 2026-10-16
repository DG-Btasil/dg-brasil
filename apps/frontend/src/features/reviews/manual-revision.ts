import type { DbReviewStatus } from "@/repositories/api/db-mappings";
import type { ReviewContentDTO } from "@/server/domain/reviews/dto";

/**
 * Regras de tela da edição manual (4.3.1). Puras e testadas; o banco decide
 * de verdade (prepare/commit_manual_revision, 034).
 */

/** Só texto é editável aqui (minutas .md/.txt). PDF/DOCX: nova versão do arquivo. */
export function isEditableMime(mime: string | null | undefined): boolean {
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  return base === "text/plain" || base === "text/markdown";
}

/** Revisão aberta para edição: aguardando decisão, reaberta ou com alterações pedidas. */
export function canEditReview(status: DbReviewStatus): boolean {
  return status === "PENDING" || status === "REOPENED" || status === "CHANGES_REQUESTED";
}

type NotEditable = Extract<ReviewContentDTO, { kind: "UNAVAILABLE" }>["reason"] | NonNullable<Extract<ReviewContentDTO, { kind: "TEXT" }>["readOnlyReason"]>;

export function contentNotEditableMessage(reason: NotEditable): string {
  switch (reason) {
    case "FORMAT":
      return "Este formato (PDF, DOCX ou imagem) não é editável aqui. Para corrigir, envie uma nova versão do arquivo na aba Documentos do caso — a versão atual continua no histórico.";
    case "TOO_LARGE":
      return "O arquivo é grande demais para editar aqui. Envie uma nova versão do arquivo na aba Documentos do caso.";
    case "SUPERSEDED":
      return "Esta versão já foi substituída por uma mais nova: edite pela revisão da versão atual.";
    case "DECIDED":
      return "Esta revisão já foi decidida. Para editar, reabra a revisão.";
    case "ARCHIVED":
      return "O documento está arquivado. Reative-o antes de editar.";
    case "NOT_DOCUMENT":
      return "Esta revisão não tem documento para editar.";
  }
}
