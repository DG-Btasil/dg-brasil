import type { Priority, ReviewContentOrigin, ReviewDecisionKind, ReviewStatus, ReviewType } from "@/lib/constants/status";
import type { ActorRef, ID, ISODateTime, OfficeScoped } from "./common";

export interface ReviewContentSection {
  heading: string;
  body: string;
}

/** Material gerado pelo agente, exibido no painel esquerdo da revisão. */
export interface ReviewContent {
  title: string;
  sections: ReviewContentSection[];
  disclaimer: string;
}

/**
 * Versão anterior do conteúdo. Nada é sobrescrito: cada edição manual
 * guarda a versão que existia antes, com autoria e origem.
 */
export interface ReviewContentVersion {
  version: number;
  content: ReviewContent;
  origin: ReviewContentOrigin;
  at: ISODateTime;
  actor: ActorRef;
}

export interface ReviewDecision extends OfficeScoped {
  reviewId: ID;
  decision: ReviewDecisionKind;
  comment?: string;
  userId: ID;
  at: ISODateTime;
  /** Versão do conteúdo sobre a qual a decisão foi tomada. Aprovação só vale para ela. */
  contentVersion?: number;
}

export const REVIEW_HISTORY_KINDS = ["MANUAL_EDIT", "REOPENED"] as const;
export type ReviewHistoryKind = (typeof REVIEW_HISTORY_KINDS)[number];

/** Eventos da trilha da revisão que não são decisões (estas ficam em ReviewDecision). */
export interface ReviewHistoryEvent {
  id: ID;
  kind: ReviewHistoryKind;
  at: ISODateTime;
  actor: ActorRef;
  /** MANUAL_EDIT: versões envolvidas e seções alteradas. */
  fromVersion?: number;
  toVersion?: number;
  changedSections?: string[];
  /** REOPENED: decisão que foi reaberta e motivo informado. */
  previousStatus?: ReviewStatus;
  reason?: string;
}

/**
 * Item da fila humana. Explicabilidade = resumo, evidências e ações propostas.
 * Nunca armazenar nem exibir raciocínio interno do modelo.
 */
export interface Review extends OfficeScoped {
  title: string;
  type: ReviewType;
  status: ReviewStatus;
  priority: Priority;
  clientId?: ID;
  processId?: ID;
  analysisId?: ID;
  agentId: ID;
  skillIds: ID[];
  thesisId?: ID;
  consultedDocumentIds: ID[];
  summary: string;
  evidence: string[];
  proposedActions: string[];
  /** Texto exibido no modal: "Após esta aprovação, o fluxo seguirá para …". */
  nextStepOnApproval: string;
  content: ReviewContent;
  /** Versão atual do conteúdo (começa em 1). */
  contentVersion?: number;
  /** Versões anteriores, da mais antiga para a mais recente. */
  previousVersions?: ReviewContentVersion[];
  /** Trilha de edições manuais e reaberturas. */
  history?: ReviewHistoryEvent[];
  assignedUserId?: ID;
  createdAt: ISODateTime;
  dueAt?: ISODateTime;
  decidedAt?: ISODateTime;
}
