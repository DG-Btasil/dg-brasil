import type { DeadlineStatus, DeadlineType } from "@/lib/constants/status";
import type { ID, ISODate, ISODateTime } from "@/types";
import type { DeadlineEffectiveStatus, DeadlinePriority } from "./schemas";

/**
 * Prazo (só equipe interna: parceiro não tem acesso a prazos — RLS).
 * `status` é o gravado; `effectiveStatus` vem da view `deadline_status`
 * (OVERDUE = OPEN vencido, nunca gravado).
 */
export interface DeadlineDTO {
  id: ID;
  legalCaseId: ID;
  processId?: ID;
  title: string;
  type: DeadlineType;
  description?: string;
  dueAt: ISODateTime;
  /** Data do vencimento no fuso do escritório (America/Sao_Paulo). */
  dueDateLocal: ISODate;
  priority: DeadlinePriority;
  status: DeadlineStatus;
  effectiveStatus: DeadlineEffectiveStatus;
  responsibleUserId?: ID;
  source: "MANUAL" | "AGENT" | "JUDICIAL_INTEGRATION";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  completedAt?: ISODateTime;
}
