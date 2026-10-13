import type { PartnerOfficeStatus } from "@/lib/constants/status";
import type { Role } from "@/lib/permissions";
import type { Address, ID, ISODateTime, Office, PartnerOffice } from "@/types";

/**
 * DTOs de organização POR CONTEXTO. Cada leitor recebe um tipo que só tem os
 * campos que ele pode ver — não há como devolver nota interna ou percentual
 * ao parceiro por engano, porque o tipo dele não tem onde pôr.
 *
 *   ADMIN      cadastro + divisão padrão + responsável + notas internas
 *              (partner_office_settings: RLS só ADMIN);
 *   INTERNAL   LAWYER: cadastro da organização (sem divisão, notas nem responsável);
 *   PARTNER    o PRÓPRIO escritório: dados cadastrais básicos.
 */

export interface OabDTO {
  number: string;
  state: string;
}

/* ------------------------------------------------------------------ */
/* Escritório proprietário                                             */
/* ------------------------------------------------------------------ */

/** Ficha do escritório proprietário (equipe interna) = `Office` do front, OAB estruturada. */
export type OwnerOfficeDTO = Omit<Office, "oab"> & { oab?: OabDTO };

/** O que o Portal do Parceiro vê do escritório proprietário: só a identificação. */
export interface OwnerOfficePublicDTO {
  id: ID;
  name: string;
  tradeName?: string;
}

export type OwnerOfficeDetailDTO = { surface: "INTERNAL"; office: OwnerOfficeDTO } | { surface: "PARTNER"; office: OwnerOfficePublicDTO };

/* ------------------------------------------------------------------ */
/* Parceiros                                                           */
/* ------------------------------------------------------------------ */

/** Ficha completa (ADMIN) = `PartnerOffice` do front + campos que o banco tem a mais. */
export type PartnerOfficeAdminDTO = Omit<PartnerOffice, "metadata"> & {
  tradeName?: string;
  website?: string;
  /** Falso: casos aceitos com esta origem não geram snapshot de parceria. */
  partnershipActive: boolean;
};

/** Ficha para a equipe interna sem acesso à parceria (LAWYER). */
export type PartnerOfficeInternalDTO = Omit<
  PartnerOfficeAdminDTO,
  "partnershipPercentage" | "ownerPercentage" | "notes" | "responsibleName" | "responsibleOab" | "oabState" | "activatedAt" | "partnershipActive"
>;

/** O próprio escritório, visto pelo Portal do Parceiro. Sem nota interna nem divisão. */
export interface PartnerOwnOfficeDTO {
  id: ID;
  name: string;
  legalName?: string;
  tradeName?: string;
  cnpj?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: Address;
  status: PartnerOfficeStatus;
  createdAt: ISODateTime;
}

export type PartnerDetailDTO =
  | { access: "ADMIN"; partner: PartnerOfficeAdminDTO }
  | { access: "INTERNAL"; partner: PartnerOfficeInternalDTO }
  | { access: "PARTNER"; partner: PartnerOwnOfficeDTO };

/** Divisão padrão vigente (só ADMIN). */
export interface PartnerShareDTO {
  partnershipPercentage: number;
  ownerPercentage: number;
  partnershipActive: boolean;
}

/** Contadores operacionais do parceiro (derivados, nunca gravados). */
export interface PartnerStatsDTO {
  /** Clientes com relacionamento ativo com o parceiro. */
  clients: number;
  /** Casos aguardando a equipe (enviados, aguardando documentos, prontos para análise). */
  newCases: number;
  /** Casos aceitos ou em andamento. */
  activeCases: number;
  /** Solicitações em aberto ou respondidas aguardando a equipe. */
  openRequests: number;
}

/** Linha da listagem de parceiros (equipe interna). `share` só para ADMIN. */
export interface PartnerListItem {
  id: ID;
  name: string;
  tradeName?: string;
  cnpj?: string;
  email?: string;
  status: PartnerOfficeStatus;
  share?: PartnerShareDTO;
  stats?: PartnerStatsDTO;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* Usuários (leitura)                                                  */
/* ------------------------------------------------------------------ */

/**
 * Integrante de uma organização, para listas e seletores (ex.: advogado
 * responsável). Sem e-mail, telefone nem dado de MFA: a visão administrativa
 * completa da equipe é `getTeamData` (src/server/auth/team-actions.ts).
 */
export interface OrganizationUserDTO {
  membershipId: ID;
  userId: ID;
  organizationId: ID;
  name: string;
  displayName: string;
  jobTitle?: string;
  oab?: OabDTO;
  role: Role;
  membershipStatus: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
  /** Conta ativa (profiles.active). */
  active: boolean;
  joinedAt?: ISODateTime;
}

/**
 * Divisão padrão do PRÓPRIO escritório, para o administrador do parceiro
 * (public.get_my_partner_settings, 027). Só estes campos: nada de notas,
 * responsável interno, configuração técnica ou dado de outro parceiro.
 */
export interface MyPartnerSettingsDTO {
  organizationId: string;
  organizationName: string;
  partnerPercentage: number;
  ownerPercentage: number;
  activatedAt: string | null;
}
