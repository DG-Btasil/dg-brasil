import type { ClientInactivationReason, PartnerOffice } from "@/types";

/* Formatos de entrada usados pelos formulários das features. */

export interface InactivateClientInput {
  reason?: ClientInactivationReason;
  note?: string;
}

export type NewPartnerOfficeInput = Pick<
  PartnerOffice,
  "name" | "legalName" | "cnpj" | "responsibleName" | "responsibleOab" | "oabState" | "email" | "phone" | "address" | "notes" | "partnershipPercentage" | "ownerPercentage"
>;
export type PartnerOfficePatch = Partial<Omit<NewPartnerOfficeInput, "partnershipPercentage" | "ownerPercentage">>;
