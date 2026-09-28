/** Identificador opaco. No backend futuro: UUID. */
export type ID = string;

/** Data/hora em ISO 8601 (UTC). Datas puras usam "YYYY-MM-DD". */
export type ISODateTime = string;
export type ISODate = string;

/**
 * Todo objeto de negócio pertence ao escritório proprietário (OwnerOffice:
 * Bárbara Cardoso Advocacia). Não há multi-tenant: escritórios parceiros
 * são entidades DENTRO do escritório proprietário, com acesso recortado.
 */
export interface OfficeScoped {
  id: ID;
  officeId: ID;
}

export interface Timestamps {
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Address {
  zipCode: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
  city: string;
  state: string;
  country: string;
}

export interface Contact {
  email?: string;
  phone?: string;
  secondaryPhone?: string;
  website?: string;
}

/** Quem executou uma ação: pessoa, agente ou o próprio sistema. */
export type ActorType = "USER" | "AGENT" | "SYSTEM";
export interface ActorRef {
  type: ActorType;
  id: ID;
  name: string;
}
