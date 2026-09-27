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

export interface AnalysisResult {
  summary: string;
  identifiedThesisIds: ID[];
  recommendation: string;
}

export interface LegalAnalysis extends OfficeScoped, Timestamps {
  clientId: ID;
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
