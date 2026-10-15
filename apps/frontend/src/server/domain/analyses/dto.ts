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
  /** Nome do template (catálogo). */
  templateName: string;
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
  /** Interrupção pedida e ainda não confirmada pelo worker (033). */
  cancelRequested: boolean;
}

/** Campo do template para o formulário (só definição; sem apresentação no banco). */
export interface TemplateFieldDTO {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "currency" | "date" | "select" | "boolean";
  required: boolean;
  helpText?: string;
  options?: { value: string; label: string }[];
}

/** Template ativo da área do caso, com o que falta de documento NESTE caso. */
export interface AnalysisTemplateSetupDTO {
  id: ID;
  name: string;
  description?: string;
  /** Sem agente principal: dá para criar a análise, mas não enviar. */
  hasAgent: boolean;
  fields: TemplateFieldDTO[];
  /** Checklist completo do template (para o tipo de cliente do caso). */
  requirements: (MissingRequirementDTO & { satisfied: boolean })[];
}

export interface AnalysisSetupDTO {
  templates: AnalysisTemplateSetupDTO[];
}

/** Resultado do início (029). `agentRunId` só quando já foi enviada. */
export interface AnalysisStartedDTO {
  id: ID;
  agentRunId?: ID;
  deduplicated: boolean;
}
