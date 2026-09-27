import type {
  AgentAutonomy,
  AgentStatus,
  AgentTaskStatus,
  ChangeEntityType,
  ChangeStatus,
  SkillStatus,
  ThesisStatus,
} from "@/lib/constants/status";
import type { LegalArea } from "@/lib/constants/legal";
import type { ID, ISODateTime, OfficeScoped } from "./common";

export interface AgentConfig {
  model: string;
  maxOutputTokens: number;
  tools: string[];
  /** Limite de execuções simultâneas; relevante para o worker futuro. */
  concurrency: number;
}

export interface Agent extends OfficeScoped {
  name: string;
  role: string;
  description: string;
  status: AgentStatus;
  skillIds: ID[];
  thesisIds: ID[];
  /** Capacidades declaradas, em linguagem de negócio. */
  permissions: string[];
  autonomy: AgentAutonomy;
  rules: string[];
  lastRunAt?: ISODateTime;
  version: number;
  config: AgentConfig;
  updatedAt: ISODateTime;
}

export interface AgentTask extends OfficeScoped {
  agentId: ID;
  title: string;
  status: AgentTaskStatus;
  clientId?: ID;
  processId?: ID;
  reviewId?: ID;
  at: ISODateTime;
}

export interface SkillParameter {
  key: string;
  label: string;
  value: string;
}

export interface Skill extends OfficeScoped {
  name: string;
  description: string;
  purpose: string;
  status: SkillStatus;
  version: number;
  /** Parâmetros legíveis por leigos; o Tutor DG altera estes valores. */
  parameters: SkillParameter[];
  /** Área técnica (configuração avançada). */
  instructions: string;
  references: string[];
  templates: string[];
  files: { name: string; sizeKb: number }[];
  updatedAt: ISODateTime;
  updatedBy: ID;
}

export interface ThesisVersion {
  version: number;
  at: ISODateTime;
  authorId: ID;
  note: string;
}

export interface ThesisReference {
  title: string;
  note: string;
}

export interface LegalThesis extends OfficeScoped {
  name: string;
  area: LegalArea;
  status: ThesisStatus;
  version: number;
  summary: string;
  foundations: string[];
  applicationCriteria: string[];
  requiredDocuments: string[];
  references: ThesisReference[];
  relatedTemplates: string[];
  skillIds: ID[];
  versions: ThesisVersion[];
  updatedAt: ISODateTime;
}

export type DiffLineType = "added" | "removed" | "context";
export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface ChangeHistoryEntry extends OfficeScoped {
  at: ISODateTime;
  requestedBy: ID;
  originalRequest: string;
  suggestedChange: string;
  entityType: ChangeEntityType;
  entityId: ID;
  entityName: string;
  fromVersion: number;
  toVersion: number;
  responsible: "TUTOR_DG" | "USER";
  status: ChangeStatus;
  diff: DiffLine[];
  impact?: string;
  affectedAgentIds: ID[];
}
