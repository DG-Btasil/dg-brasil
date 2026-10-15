import type { NotificationSeverity } from "@/lib/constants/status";
import type { ID, ISODateTime } from "@/types";

/**
 * Notificação in-app do PRÓPRIO usuário (interno ou parceiro). Só o que o
 * banco guarda — `type` no vocabulário do banco (texto em MAIÚSCULAS); o
 * destino na interface (link, rótulo) é decisão da tela.
 */
export interface NotificationDTO {
  id: ID;
  type: string;
  severity: NotificationSeverity;
  title: string;
  message?: string;
  read: boolean;
  readAt?: ISODateTime;
  createdAt: ISODateTime;
  legalCaseId?: ID;
  processId?: ID;
  partnerRequestId?: ID;
  /** Destino específico (037): revisão, análise, prazo, documento, repasse ou execução. */
  relatedType?: "review" | "analysis" | "deadline" | "document" | "transfer" | "agent_run";
  relatedId?: ID;
}

export interface UnreadCountDTO {
  unread: number;
}

export interface MarkAllReadDTO {
  /** Quantas notificações passaram a lidas nesta chamada. */
  updated: number;
}
