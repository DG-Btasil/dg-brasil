import type { LegalCaseStatus } from "@/lib/constants/status";
import type { ID, ISODateTime, LegalCase } from "@/types";

/**
 * DTOs de caso POR CONTEXTO. Interno e parceiro não compartilham um objeto
 * "gigante": o DTO do parceiro simplesmente não tem os campos internos
 * (notas internas, motivo interno de rejeição, quem aceitou, quem criou,
 * advogado responsável), então não há como devolvê-los por engano.
 */

/** Linha da listagem (as duas superfícies). */
export interface CaseListItem {
  id: ID;
  clientId: ID;
  /** Nome do cliente (vazio se o parceiro não enxerga mais o cadastro). */
  clientName: string;
  title: string;
  /** Código da área (ex.: BANKING). */
  area: string;
  legalAreaId: ID;
  caseTypeId?: ID;
  caseTypeName?: string;
  status: LegalCaseStatus;
  originOrganizationId: ID;
  partnerOrganizationId: ID | null;
  /** Só interno. */
  assignedLawyerId?: ID;
  submittedAt?: ISODateTime;
  acceptedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Ficha completa para a equipe interna = tipo de domínio do front + ids do catálogo. */
export type CaseInternalDTO = LegalCase & {
  legalAreaId: ID;
  areaName: string;
  caseTypeId?: ID;
  caseTypeCode?: string;
};

/** Ficha do caso para o Portal do Parceiro. Só o motivo PÚBLICO de rejeição. */
export interface CasePartnerDTO {
  id: ID;
  clientId: ID;
  title: string;
  area: string;
  areaName: string;
  legalAreaId: ID;
  caseTypeId?: ID;
  caseTypeCode?: string;
  /** Nome do tipo de caso. */
  caseType: string;
  summary: string;
  opposingParty?: string;
  status: LegalCaseStatus;
  originOrganizationId: ID;
  partnerOrganizationId: ID;
  partnerNotes?: string;
  submittedAt?: ISODateTime;
  acceptedAt?: ISODateTime;
  rejectedAt?: ISODateTime;
  rejectionReasonPublic?: string;
  closedAt?: ISODateTime;
  archivedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type CaseDetailDTO = { surface: "INTERNAL"; legalCase: CaseInternalDTO } | { surface: "PARTNER"; legalCase: CasePartnerDTO };

export interface CaseCreatedDTO {
  id: ID;
}

/** Envio do parceiro: cliente usado (novo ou canônico existente) + caso criado. */
export interface PartnerCaseSubmittedDTO {
  clientId: ID;
  legalCaseId: ID;
  /** true = o CPF/CNPJ já existia; o cadastro canônico foi usado sem alteração. */
  clientExisted: boolean;
}

/** Aceite/rejeição idempotentes: o segundo clique não muda nada. */
export interface CaseAcceptedDTO {
  alreadyAccepted: boolean;
}
export interface CaseRejectedDTO {
  alreadyRejected: boolean;
}

export interface CaseOriginChangedDTO {
  /** true = o parceiro de origem também foi vinculado ao caso (opt-in). */
  partnerLinked: boolean;
}
