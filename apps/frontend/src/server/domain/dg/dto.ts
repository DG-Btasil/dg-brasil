import type { AgentStatus, ReferenceMaterialStatus, ReferenceMaterialType, SkillStatus, ThesisStatus } from "@/lib/constants/status";
import type { DiffLine, ID, ISODateTime } from "@/types";
import type { AgentConfigInput } from "./schemas";

/** DTOs da área DG Brasil (dados reais do banco, só ADMIN). */

export interface DgOverviewDTO {
  activeAgents: number;
  totalAgents: number;
  activeSkills: number;
  activeTheses: number;
  changesLast30Days: number;
  monthRuns: number;
}

export interface NamedRef {
  id: ID;
  name: string;
}

export interface AgentListItemDTO {
  id: ID;
  slug: string;
  name: string;
  description?: string;
  purpose?: string;
  status: AgentStatus;
  version: number;
  model: string;
  codeExecution: boolean;
  skillCount: number;
  thesisCount: number;
  lastRunAt?: ISODateTime;
  runsLast7Days: number;
  updatedAt: ISODateTime;
}

export interface VersionItemDTO {
  id: ID;
  number: number;
  createdAt: ISODateTime;
  createdByName?: string;
}

export interface AgentDetailDTO extends AgentListItemDTO {
  versionId?: ID;
  instructions: string;
  config: AgentConfigInput;
  /** Campos da configuração gravada que a tela não conhece (versão antiga). */
  versions: VersionItemDTO[];
  skillIds: ID[];
  thesisIds: ID[];
  referenceIds: ID[];
  templates: NamedRef[];
}

export interface SkillFileDTO {
  path: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export interface SkillListItemDTO {
  id: ID;
  slug: string;
  name: string;
  description?: string;
  status: SkillStatus;
  version: number;
  fileCount: number;
  agentIds: ID[];
  updatedAt: ISODateTime;
}

export interface SkillDetailDTO extends SkillListItemDTO {
  versionId?: ID;
  instructions: string;
  files: SkillFileDTO[];
  versions: VersionItemDTO[];
  /** Versão atual já registrada no provedor de IA (enviada por uma execução). */
  providerRegistered: boolean;
}

export interface ThesisListItemDTO {
  id: ID;
  slug: string;
  title: string;
  description?: string;
  legalAreaId: ID;
  legalAreaName: string;
  status: ThesisStatus;
  version: number;
  agentIds: ID[];
  updatedAt: ISODateTime;
}

export interface ThesisDetailDTO extends ThesisListItemDTO {
  foundations?: string;
  applicationCriteria?: string;
  exclusionCriteria?: string;
  notes?: string;
  versions: VersionItemDTO[];
  skillIds: ID[];
  referenceIds: ID[];
}

export interface ReferenceItemDTO {
  id: ID;
  type: ReferenceMaterialType;
  title: string;
  description?: string;
  legalAreaId?: ID;
  tags: string[];
  status: ReferenceMaterialStatus;
  version: number;
  hasText: boolean;
  file?: { name: string; mimeType?: string; size?: number };
  agentIds: ID[];
  skillIds: ID[];
  thesisIds: ID[];
  updatedAt: ISODateTime;
}

export interface TemplateDTO {
  id: ID;
  name: string;
  legalAreaName: string;
  active: boolean;
  agentId?: ID;
}

/** Catálogos para os seletores (nomes de agentes, skills, teses, referências, áreas, templates). */
export interface DgCatalogDTO {
  agents: NamedRef[];
  skills: NamedRef[];
  theses: NamedRef[];
  references: NamedRef[];
  legalAreas: NamedRef[];
  templates: TemplateDTO[];
}

export interface PreparedFileDTO {
  path: string;
  bucket: string;
  storageObjectName: string;
  token: string;
  mimeType: string;
}

export interface PreparedSkillFilesDTO {
  skillId: ID;
  versionId: ID;
  files: PreparedFileDTO[];
}

export interface PreparedReferenceFileDTO {
  referenceId: ID;
  versionId: ID;
  file: PreparedFileDTO;
}

export interface SaveResultDTO {
  id: ID;
  versionNumber?: number;
  versionCreated: boolean;
  created: boolean;
  deduplicated: boolean;
}

export type HistoryEntityType = "AGENT" | "SKILL" | "THESIS" | "REFERENCE";

export interface HistoryEntryDTO {
  id: ID;
  entityType: HistoryEntityType;
  entityId: ID;
  entityName: string;
  version: number;
  at: ISODateTime;
  authorName?: string;
  action: "CREATED" | "UPDATED";
  diff: DiffLine[];
}

export interface AiRuntimeStatusDTO {
  executionEnabled: boolean;
  reason?: string;
  updatedAt?: ISODateTime;
  updatedByName?: string;
}

export interface AiUsageRow {
  key: string;
  label: string;
  runs: number;
  failed?: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface AiUsageDTO {
  days: number;
  since: ISODateTime;
  totals: { runs: number; completed: number; waitingHuman: number; failed: number; cancelled: number; active: number; inputTokens: number; outputTokens: number; estimatedCost: number };
  byAgent: AiUsageRow[];
  byDay: AiUsageRow[];
  byModel: AiUsageRow[];
}
