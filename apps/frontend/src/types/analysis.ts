import type { AnalysisStatus, ClientKind, DocumentCategory } from "@/lib/constants/status";
import type { LegalArea } from "@/lib/constants/legal";
import type { ActorRef, ID, ISODateTime, OfficeScoped, Timestamps } from "./common";

export interface DocumentRequirement {
  category: DocumentCategory;
  label: string;
  description?: string;
  /** Quando ausente, vale para PF e PJ. */
  appliesTo?: ClientKind[];
}

export type TemplateFieldType = "text" | "textarea" | "number" | "currency" | "date" | "select" | "boolean";

export interface TemplateField {
  key: string;
  label: string;
  type: TemplateFieldType;
  required: boolean;
  helpText?: string;
  options?: { value: string; label: string }[];
}

/**
 * Define o que uma análise de determinada área precisa.
 * A aplicação não é "de bancário": bancário é o primeiro template.
 */
export interface AnalysisTemplate extends OfficeScoped {
  name: string;
  area: LegalArea;
  description: string;
  requiredDocuments: DocumentRequirement[];
  recommendedDocuments: DocumentRequirement[];
  fields: TemplateField[];
  primaryAgentId: ID;
  skillIds: ID[];
  thesisIds: ID[];
  active: boolean;
}

export type AnalysisStepStatus = "DONE" | "CURRENT" | "PENDING" | "BLOCKED";

export interface AnalysisStep {
  key: string;
  label: string;
  status: AnalysisStepStatus;
  at?: ISODateTime;
}

export interface AnalysisEvent {
  id: ID;
  at: ISODateTime;
  actor: ActorRef;
  message: string;
}

export interface AnalysisFinding {
  title: string;
  detail: string;
  relevance: "HIGH" | "MEDIUM" | "LOW";
  documentVersionIds: ID[];
}

/**
 * Resultado de análise. `summary`/`recommendation`/`identifiedThesisIds` existem
 * desde a 4.3; o restante é o resultado ESTRUTURADO entregue pelo agente (039,
 * schema_version 1). É resultado da IA: só vale depois da revisão humana.
 */
export interface AnalysisResult {
  summary: string;
  identifiedThesisIds: ID[];
  recommendation: string;
  resultId?: ID;
  schemaVersion?: number;
  findings?: AnalysisFinding[];
  missingInformation?: string[];
  recommendations?: string[];
  proposedActions?: { description: string; proposalType?: string }[];
  referencesUsed?: { referenceId: ID; title: string; howUsed: string }[];
  thesesConsidered?: { thesisId: ID; title?: string; applicable: boolean; rationale: string }[];
}

export interface LegalAnalysis extends OfficeScoped, Timestamps {
  clientId: ID;
  /** Cada análise pertence a um caso (um cliente pode ter vários casos e análises). */
  legalCaseId?: ID;
  templateId: ID;
  status: AnalysisStatus;
  /** Respostas aos campos específicos do template (dados da relação bancária etc.). */
  fields: Record<string, string>;
  missingDocuments: DocumentCategory[];
  steps: AnalysisStep[];
  timeline: AnalysisEvent[];
  startedAt?: ISODateTime;
  startedBy?: ID;
  completedAt?: ISODateTime;
  result?: AnalysisResult;
  reviewId?: ID;
  processId?: ID;
  interruptionReason?: string;
}
