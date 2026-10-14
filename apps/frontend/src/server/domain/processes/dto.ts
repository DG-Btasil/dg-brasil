import type { ClientPole, ProcessEventSource, ProcessOrigin, ProcessPhase, ProcessStatus } from "@/lib/constants/status";
import type { ID, ISODate, ISODateTime } from "@/types";
import type { PartyType } from "./schemas";

/**
 * DTOs de processo POR CONTEXTO. O DTO do parceiro não tem os campos internos
 * (resumo, notas, responsável interno, quem cadastrou, prazo operacional),
 * então não há como devolvê-los por engano. `caseValue` (valor da causa) só
 * existe quando o papel tem `processes.caseValue.view`.
 */

/** Caso do processo, para exibição (as duas superfícies). */
interface ProcessCaseRef {
  clientId: ID;
  /** Nome do cliente do caso (vazio se a RLS não entrega o cadastro). */
  clientName: string;
  caseTitle: string;
  /** Origem comercial do caso. */
  caseOriginOrganizationId?: ID;
  /** Parceiro com acesso operacional ao caso (nulo = caso interno). */
  casePartnerOrganizationId?: ID;
}

/** Próximo prazo em aberto (só equipe interna). */
export interface ProcessNextDeadline {
  id: ID;
  title: string;
  dueAt: ISODateTime;
  /** Data do vencimento em America/Sao_Paulo. */
  dueDateLocal: ISODate;
}

/** Linha da listagem (as duas superfícies). */
export interface ProcessListItem extends ProcessCaseRef {
  id: ID;
  legalCaseId: ID;
  actionType?: string;
  /** Origem TÉCNICA do cadastro. */
  origin: ProcessOrigin;
  /** Só interno. */
  nextDeadline?: ProcessNextDeadline;
  cnj?: string;
  title: string;
  court?: string;
  state?: string;
  status: ProcessStatus;
  /** Status como está no banco (ARCHIVED aparece em `status` como CLOSED). */
  dbStatus: ProcessStatus | "ARCHIVED";
  phase?: ProcessPhase;
  distributionDate?: ISODate;
  /** Só com `processes.caseValue.view`. */
  caseValue?: number;
  /** Só interno. */
  responsibleUserId?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Campos comuns às duas fichas. */
interface ProcessBase extends ProcessCaseRef {
  id: ID;
  legalCaseId: ID;
  cnj?: string;
  title: string;
  court?: string;
  unit?: string;
  district?: string;
  state?: string;
  /** Classe processual (coluna legal_class). */
  actionType?: string;
  subject?: string;
  clientPole?: ClientPole;
  opposingParty?: string;
  /** Valor da causa. Só com `processes.caseValue.view`. */
  caseValue?: number;
  currency: string;
  status: ProcessStatus;
  dbStatus: ProcessStatus | "ARCHIVED";
  phase?: ProcessPhase;
  /** Origem TÉCNICA do cadastro (manual, integração, agente, importação). */
  origin: ProcessOrigin;
  distributionDate?: ISODate;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Ficha completa para a equipe interna. */
export interface ProcessInternalDTO extends ProcessBase {
  responsibleUserId?: ID;
  operationalDueAt?: ISODateTime;
  createdBy?: ID;
  /** legal_process_internal_details: nunca visível a parceiros. */
  summary?: string;
  notes?: string;
}

/** Ficha do processo no Portal do Parceiro: só dados processuais. */
export type ProcessPartnerDTO = ProcessBase;

export type ProcessDetailDTO = { surface: "INTERNAL"; process: ProcessInternalDTO } | { surface: "PARTNER"; process: ProcessPartnerDTO };

export interface ProcessPartyDTO {
  id: ID;
  processId: ID;
  type: PartyType;
  name: string;
  /** CPF/CNPJ (só dígitos). */
  document?: string;
  clientId?: ID;
  createdAt: ISODateTime;
}

/**
 * Movimentação. Parceiro só recebe as oficiais (tribunal/importação) e fatos
 * do sistema — nota manual e registro de agente ficam de fora (RLS + service).
 */
export interface ProcessEventDTO {
  id: ID;
  processId: ID;
  type: string;
  title?: string;
  description: string;
  occurredAt: ISODateTime;
  source: ProcessEventSource;
  important: boolean;
  /** Só interno: provedor da integração que trouxe a movimentação. */
  externalProvider?: string;
  createdAt: ISODateTime;
}

/** Contadores da carteira de processos (equipe interna), contados no banco. */
export interface ProcessSummaryDTO {
  active: number;
  /** Processos com prazo em aberto vencendo em até 5 dias (inclui vencidos). */
  dueSoon: number;
  agent: number;
  imported: number;
}

/** Resultado da criação. `deduplicated` = repetição de um envio já concluído (mesma chave). */
export interface ProcessCreatedDTO {
  id: ID;
  deduplicated: boolean;
}
