import type { DeadlineStatus, DeadlineType, HearingMode } from "@/lib/constants/status";
import type { ID, ISODate, ISODateTime } from "@/types";
import type { DeadlineEffectiveStatus, DeadlinePriority } from "./schemas";

/**
 * Prazo (só equipe interna: parceiro não tem acesso a prazos — RLS).
 * `status` é o gravado; `effectiveStatus` vem do banco (OVERDUE = OPEN
 * vencido, nunca gravado). Cliente, caso e processo vêm da view
 * `deadline_agenda` (migration 063), para a agenda e a Home.
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
  /** Hora do vencimento no fuso do escritório, "HH:MM" (23:59 = prazo de fim do dia). */
  dueTimeLocal: string;
  priority: DeadlinePriority;
  status: DeadlineStatus;
  effectiveStatus: DeadlineEffectiveStatus;
  responsibleUserId?: ID;
  source: "MANUAL" | "AGENT" | "JUDICIAL_INTEGRATION";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  completedAt?: ISODateTime;
  /** Motivo da última mudança de situação (cancelamento, reabertura, perda). */
  statusReason?: string;
  statusChangedAt?: ISODateTime;
  statusChangedByUserId?: ID;
  /** Prazo que nasceu de proposta de agente e ninguém conferiu ainda. */
  agentUnchecked: boolean;
  checkedAt?: ISODateTime;
  checkedByUserId?: ID;
  /** Audiência. */
  hearingMode?: HearingMode;
  hearingLocation?: string;
  hearingLink?: string;
  /** Contexto para listas que saem do processo (agenda, Home). */
  caseTitle?: string;
  clientId?: ID;
  clientName?: string;
  processTitle?: string;
  /** CNJ só com dígitos; a tela aplica a máscara. */
  processCnj?: string;
  processCourt?: string;
}

/** Resposta da criação: `deduplicated` = a chave de envio já tinha criado este prazo. */
export interface DeadlineCreatedDTO {
  id: ID;
  deduplicated: boolean;
}
