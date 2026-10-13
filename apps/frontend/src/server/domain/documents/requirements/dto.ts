import type { ID, ISODateTime } from "@/types";
import type { RequirementStatus } from "./schemas";

/** Pendência — visão interna. */
export interface RequirementInternalDTO {
  id: ID;
  legalCaseId: ID;
  label: string;
  category: string;
  required: boolean;
  status: RequirementStatus;
  /** Versão concreta que atende a pendência (mesmo cliente e vinculada ao caso). */
  satisfiedByDocumentVersionId?: ID;
  requestedAt?: ISODateTime;
  satisfiedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/**
 * Pendência — visão do parceiro: o que falta e a situação. Sem o id da versão
 * (pode ser de documento INTERNAL, que o parceiro não enxerga).
 */
export interface RequirementPartnerDTO {
  id: ID;
  legalCaseId: ID;
  label: string;
  category: string;
  required: boolean;
  status: RequirementStatus;
  requestedAt?: ISODateTime;
  satisfiedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type RequirementDTO = ({ surface: "INTERNAL" } & RequirementInternalDTO) | ({ surface: "PARTNER" } & RequirementPartnerDTO);
