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

/**
 * Processo judicial. Pertence SEMPRE a um Caso (`legalCaseId`); `clientId`
 * é mantido por conveniência e é sempre o cliente do caso. A origem do caso
 * (e a parceria) vem do Caso, não do processo.
 */
export interface Process extends OfficeScoped, Timestamps {
  legalCaseId: ID;
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
  /** Origem TÉCNICA do cadastro (manual, integração, DG Brasil, importação). Não é a origem do caso. */
  origin: ProcessOrigin;
  /** Resultado econômico estimado. Sempre estimativa, nunca garantia. */
  economicEstimate?: number;
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

/** Nome do domínio: processo judicial (mesmo tipo de `Process`). */
export type LegalProcess = Process;
