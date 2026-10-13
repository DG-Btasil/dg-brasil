import type { ClientKind, ClientStatus } from "@/lib/constants/status";
import type { Address, Client, Contact, ID, ISODateTime } from "@/types";

/**
 * DTOs de cliente POR CONTEXTO. Interno e parceiro não compartilham um objeto
 * "gigante": o DTO do parceiro simplesmente não tem os campos internos, então
 * não há como devolvê-los por engano.
 */

/** Linha da listagem (as duas superfícies). */
export interface ClientListItem {
  id: ID;
  kind: ClientKind;
  name: string;
  tradeName?: string;
  /** CPF/CNPJ (só dígitos). Parceiro só recebe clientes dos próprios relacionamentos. */
  document: string;
  status: ClientStatus;
  /** Interno: sempre. Parceiro: só quando a origem é o próprio escritório. */
  originOrganizationId?: ID;
  /** Só interno. */
  responsibleUserId?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Ficha completa para a equipe interna = tipo de domínio do front. */
export type ClientInternalDTO = Client;

/** Ficha do cliente para o Portal do Parceiro: cadastro básico, sem dado interno. */
export type ClientPartnerDTO =
  | (ClientPartnerBase & { kind: "INDIVIDUAL"; fullName: string; socialName?: string; cpf: string; birthDate?: string })
  | (ClientPartnerBase & { kind: "COMPANY"; legalName: string; tradeName?: string; cnpj: string });

interface ClientPartnerBase {
  id: ID;
  status: ClientStatus;
  contact: Contact;
  address?: Address;
  /** Só quando a origem é o próprio escritório do parceiro. */
  originOfficeId?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type ClientDetailDTO = { surface: "INTERNAL"; client: ClientInternalDTO } | { surface: "PARTNER"; client: ClientPartnerDTO };

/** Consulta de CPF/CNPJ. Para o parceiro, EXISTS não traz id, nome nem escritório. */
export type ClientLookupDTO = { status: "NOT_FOUND" } | { status: "FOUND"; clientId: ID } | { status: "ALREADY_RELATED"; clientId: ID } | { status: "EXISTS" };

/** Resultado da edição do bloco societário (só contagens). */
export interface CompanyPeopleResultDTO {
  representatives: { added: number; updated: number; removed: number };
  partners: { added: number; updated: number; removed: number };
}

export interface ClientRelationshipDTO {
  organizationId: ID;
  status: "ACTIVE" | "ENDED";
  createdAt: ISODateTime;
  endedAt?: ISODateTime;
}
