import { z } from "zod";
import { PARTNER_REQUEST_TYPES } from "@/lib/constants/status";
import { PARTNER_ROLES } from "@/lib/permissions";
import { msg, zCnpjOptional, zEmail, zPhone, zRequired } from "@/lib/validation";
import type { NewPartnerOfficeInput, PartnerOfficePatch } from "@/store/types";
import type { PartnerOffice } from "@/types";
import { addressSchema, EMPTY_ADDRESS, fromAddress, toAddress } from "@/features/clients/schemas";

const text = () => z.string().trim();
const opt = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/** Percentual digitado ("50", "37,5") → número. */
export function parsePercent(value: string): number {
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

const percent = () =>
  text()
    .min(1, msg.required)
    .refine((v) => {
      const n = parsePercent(v);
      return n >= 0 && n <= 100;
    }, msg.percent);

/** Divisão da parceria: cada parte 0–100 e soma obrigatoriamente 100%. */
export const shareSchema = z
  .object({ partnerPercentage: percent(), ownerPercentage: percent() })
  .refine((v) => Math.round((parsePercent(v.partnerPercentage) + parsePercent(v.ownerPercentage)) * 100) / 100 === 100, {
    path: ["ownerPercentage"],
    message: "A soma das participações precisa ser exatamente 100%.",
  });
export type ShareFormValues = z.infer<typeof shareSchema>;

const partnerDataShape = {
  name: zRequired("Informe o nome do escritório."),
  legalName: text(),
  cnpj: zCnpjOptional(),
  responsibleName: zRequired("Informe o responsável principal."),
  responsibleOab: zRequired("Informe o número da OAB."),
  oabState: zRequired("Informe a UF da OAB."),
  email: zEmail(),
  phone: zPhone(),
  address: addressSchema,
  notes: text(),
};

export const partnerDataSchema = z.object(partnerDataShape);
export type PartnerDataValues = z.infer<typeof partnerDataSchema>;

export const partnerCreateSchema = z
  .object({ ...partnerDataShape, partnershipPercentage: percent(), ownerPercentage: percent() })
  .refine((v) => Math.round((parsePercent(v.partnershipPercentage) + parsePercent(v.ownerPercentage)) * 100) / 100 === 100, {
    path: ["ownerPercentage"],
    message: "A soma das participações precisa ser exatamente 100%.",
  });
export type PartnerCreateValues = z.infer<typeof partnerCreateSchema>;

export const EMPTY_PARTNER_VALUES: PartnerCreateValues = {
  name: "",
  legalName: "",
  cnpj: "",
  responsibleName: "",
  responsibleOab: "",
  oabState: "",
  email: "",
  phone: "",
  address: EMPTY_ADDRESS,
  notes: "",
  partnershipPercentage: "",
  ownerPercentage: "",
};

export function partnerDataToPatch(v: PartnerDataValues): PartnerOfficePatch {
  return {
    name: v.name,
    legalName: opt(v.legalName),
    cnpj: opt(v.cnpj),
    responsibleName: v.responsibleName,
    responsibleOab: v.responsibleOab,
    oabState: v.oabState,
    email: v.email,
    phone: v.phone,
    address: toAddress(v.address),
    notes: opt(v.notes),
  };
}

export function partnerCreateToInput(v: PartnerCreateValues): NewPartnerOfficeInput {
  return {
    name: v.name,
    legalName: opt(v.legalName),
    cnpj: opt(v.cnpj),
    responsibleName: v.responsibleName,
    responsibleOab: v.responsibleOab,
    oabState: v.oabState,
    email: v.email,
    phone: v.phone,
    address: toAddress(v.address),
    notes: opt(v.notes),
    partnershipPercentage: parsePercent(v.partnershipPercentage),
    ownerPercentage: parsePercent(v.ownerPercentage),
  };
}

export function partnerToDataValues(p: PartnerOffice): PartnerDataValues {
  return {
    name: p.name,
    legalName: p.legalName ?? "",
    cnpj: p.cnpj ?? "",
    responsibleName: p.responsibleName,
    responsibleOab: p.responsibleOab,
    oabState: p.oabState,
    email: p.email,
    phone: p.phone,
    address: fromAddress(p.address),
    notes: p.notes ?? "",
  };
}

export const partnerInviteSchema = z.object({
  name: zRequired("Informe o nome."),
  email: zEmail(),
  role: z.enum(PARTNER_ROLES),
});
export type PartnerInviteValues = z.infer<typeof partnerInviteSchema>;

export const partnerRequestSchema = z.object({
  type: z.enum(PARTNER_REQUEST_TYPES),
  title: zRequired("Informe um título curto."),
  description: zRequired("Descreva o que é necessário."),
  dueDate: text(),
});
export type PartnerRequestValues = z.infer<typeof partnerRequestSchema>;
