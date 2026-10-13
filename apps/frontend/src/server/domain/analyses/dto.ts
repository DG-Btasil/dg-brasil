import type { AnalysisStatus, DocumentCategory } from "@/lib/constants/status";
import type { DbAnalysisStatus } from "@/repositories/api/db-mappings";
import type { AnalysisResult, ID, ISODateTime } from "@/types";

/**
 * DTOs de análise jurídica. Só equipe interna ADMIN/LAWYER (RLS de
 * legal_analyses): não existe DTO de parceiro.
 */

export interface AnalysisListItem {
  id: ID;
  legalCaseId: ID;
  templateId: ID;
  /** Status canônico do banco (o do front depende dos documentos: ver o detalhe). */
  dbStatus: DbAnalysisStatus;
  agentRunId?: ID;
  startedAt?: ISODateTime;
  completedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Documento do checklist do template que o caso ainda não tem. */
export interface MissingRequirementDTO {
  category: DocumentCategory;
  label: string;
  description?: string;
  /** false = recomendado (não bloqueia a análise). */
  required: boolean;
}

export interface AnalysisDetailDTO extends AnalysisListItem {
  /** Status do front (READY × NOT_STARTED derivado dos documentos obrigatórios). */
  status: AnalysisStatus;
  fields: Record<string, string>;
  /** Resultado estruturado (resumo, teses identificadas, recomendação). Nunca raciocínio do modelo. */
  result?: AnalysisResult;
  /** Saída estruturada completa (result_data), para telas que precisem de outras chaves. */
  resultData: Record<string, unknown>;
  interruptionReason?: string;
  startedById?: ID;
  missingRequirements: MissingRequirementDTO[];
  requiredDocumentsComplete: boolean;
  /** Revisão humana mais recente desta análise. */
  reviewId?: ID;
}
