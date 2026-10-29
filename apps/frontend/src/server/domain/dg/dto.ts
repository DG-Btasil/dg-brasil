import type { AgentStatus, ReferenceMaterialStatus, ReferenceMaterialType, ThesisStatus } from "@/lib/constants/status";
import type { DiffLine, ID, ISODateTime } from "@/types";
import type { AgentConfigInput } from "./schemas";

/** DTOs da área DG Brasil (dados reais do banco, só ADMIN). */

export interface DgOverviewDTO {
  activeAgents: number;
  totalAgents: number;
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
  /** Nome do agente no Claude Code do escritório (configuration.local_agent). */
  localAgent?: string;
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
  thesisIds: ID[];
  referenceIds: ID[];
  templates: NamedRef[];
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

/** Catálogos para os seletores (nomes de agentes, teses, referências, áreas, templates). */
export interface DgCatalogDTO {
  agents: NamedRef[];
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

export interface ExecutorDTO {
  id: ID;
  name: string;
  tokenPrefix: string;
  online: boolean;
  lastSeenAt?: ISODateTime;
  clientVersion?: string;
  revokedAt?: ISODateTime;
  createdAt: ISODateTime;
  createdByName?: string;
  running: number;
}

/** Situação do escritório: se há computador conectado e a fila. A lista só para ADMIN. */
export interface OfficeStatusDTO {
  executionEnabled: boolean;
  online: boolean;
  lastSeenAt?: ISODateTime;
  queued: number;
  running: number;
  executors?: ExecutorDTO[];
}

/** O token aparece UMA vez, na criação. O banco guarda só o hash. */
export interface CreatedExecutorDTO {
  id: ID;
  name: string;
  token: string;
}
