import type {
  ClientLinkStatus,
  ClientPole,
  DeadlineStatus,
  DeadlineType,
  ProcessEventSource,
  ProcessOrigin,
  ProcessPhase,
  ProcessStatus,
} from "@/lib/constants/status";
import type { LegalArea } from "@/lib/constants/legal";
import type { ID, ISODate, ISODateTime, OfficeScoped, Timestamps } from "./common";

export interface Process extends OfficeScoped, Timestamps {
  clientId: ID;
  /** Número CNJ. Nos mocks, sempre fictício. Vazio em processos pré-ajuizamento. */
  cnj?: string;
  title: string;
  court?: string;
  unit?: string;
  district?: string;
  state?: string;
  area: LegalArea;
  actionType: string;
  subject?: string;
  clientPole: ClientPole;
  opposingParty?: string;
  responsibleUserId: ID;
  distributionDate?: ISODate;
  /** Valor da causa: dado jurídico, visível para advogados. Não é financeiro interno. */
  caseValue?: number;
  status: ProcessStatus;
  phase: ProcessPhase;
  origin: ProcessOrigin;
  integrationId?: ID;
  thesisId?: ID;
  analysisId?: ID;
  summary?: string;
  notes?: string;
  lastMovementAt?: ISODateTime;
  /**
   * Situação do vínculo com o cliente. Ausente = vinculado. "PENDING_LINK"
   * quando o cliente associado foi removido: o processo continua existindo
   * e aguarda a equipe vincular outro cliente ou resolver manualmente.
   */
  clientLinkStatus?: ClientLinkStatus;
  /** Nome do cliente removido, para exibição enquanto o vínculo está pendente. */
  removedClientName?: string;
}

export interface ProcessEvent extends OfficeScoped {
  processId: ID;
  at: ISODateTime;
  title: string;
  description?: string;
  source: ProcessEventSource;
  important: boolean;
}

export interface Deadline extends OfficeScoped {
  processId: ID;
  clientId: ID;
  title: string;
  type: DeadlineType;
  dueDate: ISODate;
  responsibleUserId: ID;
  status: DeadlineStatus;
  notes?: string;
  createdAt: ISODateTime;
  completedAt?: ISODateTime;
}
