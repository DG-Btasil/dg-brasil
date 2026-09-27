import type { Priority, ReviewDecisionKind, ReviewStatus, ReviewType } from "@/lib/constants/status";
import type { ID, ISODateTime, OfficeScoped } from "./common";

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

export interface ReviewDecision extends OfficeScoped {
  reviewId: ID;
  decision: ReviewDecisionKind;
  comment?: string;
  userId: ID;
  at: ISODateTime;
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
  assignedUserId?: ID;
  createdAt: ISODateTime;
  dueAt?: ISODateTime;
  decidedAt?: ISODateTime;
}
