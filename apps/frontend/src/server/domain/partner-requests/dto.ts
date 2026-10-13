import type { PartnerRequestStatus, PartnerRequestType } from "@/lib/constants/status";
import type { ID, ISODate, ISODateTime } from "@/types";

/**
 * DTOs de solicitação a parceiro POR SUPERFÍCIE. O do parceiro não tem quem
 * criou (usuário interno), nem o id de autor das mensagens da equipe interna,
 * nem documento que ele não pode abrir — os campos simplesmente não existem.
 */

/** Linha da listagem (as duas superfícies). Campos "só interno" ficam AUSENTES para o parceiro. */
export interface PartnerRequestListItem {
  id: ID;
  legalCaseId: ID;
  /** Título do caso (quando visível a quem pergunta). */
  caseTitle?: string;
  processId?: ID;
  type: PartnerRequestType;
  title: string;
  description?: string;
  status: PartnerRequestStatus;
  /** Prazo recomendado (instante) e a data civil correspondente em São Paulo. */
  dueAt?: ISODateTime;
  dueDate?: ISODate;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  answeredAt?: ISODateTime;
  resolvedAt?: ISODateTime;
  /** Só interno. */
  partnerOrganizationId?: ID;
  /** Só interno. */
  createdById?: ID;
}

/** Mensagem vista pela equipe interna: autor identificado. */
export interface PartnerRequestMessageInternalDTO {
  id: ID;
  at: ISODateTime;
  /** OWNER = equipe interna; PARTNER = escritório parceiro. */
  side: "OWNER" | "PARTNER";
  author: { id: ID; name: string };
  message: string;
  documentId?: ID;
}

/** Mensagem vista pelo parceiro: autor interno aparece só como "equipe do escritório". */
export interface PartnerRequestMessagePartnerDTO {
  id: ID;
  at: ISODateTime;
  side: "OWNER" | "PARTNER";
  authorName: string;
  message: string;
  /** Só quando o parceiro pode abrir o documento. */
  documentId?: ID;
}

export type PartnerRequestInternalDTO = Required<Pick<PartnerRequestListItem, "partnerOrganizationId">> &
  Omit<PartnerRequestListItem, "partnerOrganizationId"> & { messages: PartnerRequestMessageInternalDTO[] };

export type PartnerRequestPartnerDTO = Omit<PartnerRequestListItem, "partnerOrganizationId" | "createdById"> & {
  messages: PartnerRequestMessagePartnerDTO[];
};

export type PartnerRequestDetailDTO =
  | { surface: "INTERNAL"; request: PartnerRequestInternalDTO }
  | { surface: "PARTNER"; request: PartnerRequestPartnerDTO };
