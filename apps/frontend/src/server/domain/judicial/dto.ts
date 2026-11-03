import type { ISODate, ISODateTime } from "@/types";

/** Integração judicial (043): DJEN, DataJud, publicações e prazos. */

export interface JudicialMonitorDTO {
  id: string;
  oabNumber: string;
  oabState: string;
  lawyerName?: string;
  active: boolean;
  responsibleUserId?: string;
  organizationId: string;
  organizationName?: string;
  organizationType?: "OWNER" | "PARTNER";
  createdAt: ISODateTime;
  lastAttemptAt?: ISODateTime;
  lastSuccessAt?: ISODateTime;
  lastError?: string;
  lastFound?: number;
  lastMatched?: number;
  /** Publicações da última busca em processos que não estão no DG Brasil (só o número). */
  unmatchedCnjs: string[];
}

export interface JudicialRunDTO {
  id: string;
  trigger: "CRON" | "MANUAL";
  scope: "ALL" | "DATAJUD" | "PROCESS";
  status: "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
  startedAt: ISODateTime;
  finishedAt?: ISODateTime;
  stats: Record<string, number>;
  error?: string;
}

export interface CourtCalendarDayDTO {
  id: string;
  court?: string;
  day: ISODate;
  kind: "HOLIDAY" | "SUSPENSION";
  description: string;
}

export interface JudicialOverviewDTO {
  canManage: boolean;
  settings: {
    djenEnabled: boolean;
    datajudEnabled: boolean;
    lookbackDays: number;
    deadlineAgentId?: string;
    deadlineAgentName?: string;
    updatedAt: ISODateTime;
  };
  monitors: JudicialMonitorDTO[];
  runs: JudicialRunDTO[];
  processes: { tracked: number; paused: number; neverSynced: number; withError: number };
  publications: { pending: number; withAgent: number; doneLast30Days: number };
  agents: { id: string; name: string }[];
  calendar: CourtCalendarDayDTO[];
}

export interface MyJudicialMonitorsDTO {
  canManage: boolean;
  monitors: JudicialMonitorDTO[];
  lastRunAt?: ISODateTime;
}

export interface CoverageDayDTO {
  day: ISODate;
  checked: boolean;
  settled: boolean;
  found?: number;
  lastOkAt?: ISODateTime;
  lastError?: string;
}

export type TriageStatus = "PENDING" | "WITH_AGENT" | "DONE";

export interface JudicialPublicationDTO {
  id: string;
  externalId: string;
  legalProcessId: string;
  cnjNumber: string;
  processTitle?: string;
  legalCaseId: string;
  caseTitle?: string;
  clientName?: string;
  responsibleUserId?: string;
  court?: string;
  organ?: string;
  communicationType?: string;
  className?: string;
  availableOn: ISODate;
  foundBy: string[];
  excerpt: string;
  content?: string;
  link?: string;
  certificateUrl?: string;
  cancelledAt?: ISODateTime;
  cancelReason?: string;
  triageStatus: TriageStatus;
  triageOutcome?: "DEADLINE" | "NO_DEADLINE";
  triageNotes?: string;
  triagedBy?: string;
  triagedAt?: ISODateTime;
  deadline?: { id: string; title: string; dueAt: ISODateTime; status: string };
  agentRunId?: string;
  agentRunStatus?: string;
  agentError?: string;
  pendingReviewId?: string;
  capturedAt: ISODateTime;
}

export interface DeadlineCountDTO {
  availableOn: ISODate;
  publishedOn: ISODate;
  businessDays: number;
  dueOn: ISODate;
  skipped: { day: ISODate; reason: string }[];
  court?: string;
  note: string;
}

export interface JudicialPublicationDetailDTO extends JudicialPublicationDTO {
  suggestion: DeadlineCountDTO;
}

export interface PublicationPageDTO {
  total: number;
  items: JudicialPublicationDTO[];
}

export interface ProcessJudicialStatusDTO {
  hasCnj: boolean;
  tracked: boolean;
  syncEnabled: boolean;
  lastSyncedAt?: ISODateTime;
  baselineAt?: ISODateTime;
  courtAlias?: string;
  lastError?: string;
  lastAttemptAt?: ISODateTime;
  canManage: boolean;
  publications?: { total: number; open: number };
}

export interface JudicialSyncNowDTO {
  busy: boolean;
  status?: "COMPLETED" | "PARTIAL" | "FAILED";
  stats?: Record<string, number>;
  errors?: string[];
}
