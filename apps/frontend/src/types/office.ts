import type { Address, ID, Timestamps } from "./common";

/**
 * O escritório proprietário (OwnerOffice): Bárbara Cardoso Advocacia.
 * Existe exatamente um. Outras organizações são PartnerOffice.
 */
export interface Office extends Timestamps {
  id: ID;
  name: string;
  legalName?: string;
  tradeName?: string;
  cnpj?: string;
  address?: Address;
  phone?: string;
  email?: string;
  website?: string;
  principalLawyer: string;
  oab?: string;
  statesOfPractice: string[];
  units: string[];
}
