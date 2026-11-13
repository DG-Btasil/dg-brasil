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
  /** Das publicações da última busca, quantas são de processos do DG Brasil (das outras, nada é guardado). */
  lastMatched?: number;
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

/** Estado da captura do DJEN no dia (062). */
export interface JudicialCaptureDTO {
  /** Dia de conferir: dia útil, depois das 08:00 de Brasília, com o DJEN ligado e OAB ativa. */
  applies: boolean;
  /** Há OAB sem busca concluída hoje (desde as 05:00). */
  late: boolean;
  reason?: "NOT_RUN" | "OAB_FAILED";
  title?: string;
  message?: string;
  oabsTotal: number;
  oabsPending: number;
  lastSuccessAt?: ISODateTime;
  /** O agendador do sistema não consegue chamar a busca em lotes (texto técnico, para quem cuida do sistema). */
  configProblem?: string;
  checkedAt: ISODateTime;
}

export interface JudicialCaptureAlertDTO extends JudicialCaptureDTO {
  canManage: boolean;
}

export interface JudicialOverviewDTO {
  canManage: boolean;
  settings: {
    djenEnabled: boolean;
    datajudEnabled: boolean;
    lookbackDays: number;
    deadlineAgentId?: string;
    deadlineAgentName?: string;
    /** Prazo do agente entra direto na agenda, sem Revisões (059). Ausente em banco anterior à 059. */
    deadlineAutoApply?: boolean;
    /** Prazo do agente vira tarefa do processo para o orquestrador (061). Ausente em banco anterior à 061. */
    deadlineAutoTask?: boolean;
    /** Horas que a publicação espera o agente antes de voltar para a equipe (062). Ausente em banco anterior à 062. */
    agentTimeoutHours?: number;
    updatedAt: ISODateTime;
  };
  monitors: JudicialMonitorDTO[];
  /** As 10 últimas rodadas (de qualquer tipo). */
  runs: JudicialRunDTO[];
  /** A última busca completa (publicações e andamentos), mesmo fora das 10 últimas (062). */
  lastFullRun?: Pick<JudicialRunDTO, "id" | "trigger" | "status" | "startedAt" | "finishedAt">;
  /** Estado da captura do dia (062). Ausente em banco anterior à 062. */
  capture?: JudicialCaptureDTO;
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
  /** dueOn: data local do vencimento (Brasília), 062. */
  deadline?: { id: string; title: string; dueAt: ISODateTime; dueOn?: ISODate; status: string };
  agentRunId?: string;
  agentRunStatus?: string;
  /** Desde quando a publicação está com o agente (062). */
  agentRequestedAt?: ISODateTime;
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
  /** O agente tem como responder? (062). Ausente em banco anterior à 062. */
  agentRuntime?: { executionEnabled: boolean; executorOnline: boolean; timeoutHours: number };
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
