import type { DocumentCategory, Priority, ReviewDecisionKind, ReviewStatus } from "@/lib/constants/status";
import type { DbAnalysisStatus, DbReviewDecision, DbReviewStatus } from "@/repositories/api/db-mappings";
import type { AnalysisResult, ID, ISODateTime } from "@/types";
import type { REVIEW_TARGET_KINDS } from "./schemas";

/**
 * DTOs de revisão humana. Só ADMIN e LAWYER (RLS de reviews): não existe DTO
 * de parceiro. O CONTEÚDO revisado não é copiado na revisão: vem do alvo
 * (análise, versão de documento ou proposta do agente), lido na hora.
 */

export type ReviewTargetKind = (typeof REVIEW_TARGET_KINDS)[number];

export interface ReviewListItem {
  id: ID;
  targetKind: ReviewTargetKind;
  targetId: ID;
  /** Só quando o alvo é proposta de agente. */
  proposalType?: string;
  /** O que está em revisão (template da análise, documento e versão, tipo da proposta). Só rótulo. */
  subject: string;
  /** Agente que gerou a proposta (quando houver). */
  agentName?: string;
  caseTitle?: string;
  clientName?: string;
  /** Proposta que altera a configuração do DG Brasil: só ADMIN decide. */
  requiresAdmin: boolean;
  legalCaseId?: ID;
  processId?: ID;
  /** Status do front (PENDING + prioridade URGENT = URGENT). */
  status: ReviewStatus;
  dbStatus: DbReviewStatus;
  priority: Priority;
  assignedReviewerId?: ID;
  dueAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  decidedAt?: ISODateTime;
}

export type ReviewTargetDTO =
  | {
      kind: "ANALYSIS";
      analysisId: ID;
      analysisStatus: DbAnalysisStatus;
      templateId: ID;
      agentRunId?: ID;
      result?: AnalysisResult;
      resultData: Record<string, unknown>;
    }
  | {
      kind: "DOCUMENT_VERSION";
      documentVersionId: ID;
      documentId: ID;
      versionNumber: number;
      title: string;
      category: DocumentCategory;
      visibility: "INTERNAL" | "PARTNER_VISIBLE";
      originalFilename?: string;
      mimeType?: string;
      source: string;
      createdAt: ISODateTime;
    }
  | {
      kind: "AGENT_PROPOSAL";
      proposalId: ID;
      agentRunId: ID;
      proposalType: string;
      proposalStatus: string;
      payload: Record<string, unknown>;
      requiresHumanReview: boolean;
      createdAt: ISODateTime;
    };

export interface ReviewDecisionDTO {
  id: ID;
  /** Decisão no vocabulário do front; null para REOPEN (evento de histórico, não decisão). */
  decision: ReviewDecisionKind | null;
  dbDecision: DbReviewDecision;
  notes?: string;
  decidedById: ID;
  at: ISODateTime;
}

/**
 * Conteúdo editável da versão em revisão (034). Só texto (minutas .md/.txt do
 * agente ou enviadas como texto); PDF/DOCX seguem por "Enviar nova versão".
 */
export type ReviewContentDTO =
  | {
      kind: "TEXT";
      versionId: ID;
      versionNumber: number;
      mimeType: string;
      text: string;
      /** Editável agora? Revisão decidida ou documento arquivado: só leitura. */
      editable: boolean;
      readOnlyReason?: "DECIDED" | "ARCHIVED";
    }
  | { kind: "UNAVAILABLE"; reason: "NOT_DOCUMENT" | "FORMAT" | "TOO_LARGE" };

/** Resultado da edição manual: a revisão NOVA (da versão N+1) para onde a tela navega. */
export interface ManualRevisionDTO {
  reviewId: ID;
  previousReviewId: ID;
  versionId: ID;
  versionNumber: number;
  deduplicated: boolean;
}

export interface ReviewDetailDTO extends ReviewListItem {
  /** null quando o alvo não pôde ser lido (ex.: removido). */
  target: ReviewTargetDTO | null;
  decisions: ReviewDecisionDTO[];
}
