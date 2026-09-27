import { z } from "zod";
import { BRAZILIAN_STATES } from "@/lib/constants/legal";
import { ROLES } from "@/lib/permissions";
import { zCepOptional, zCnpjOptional, zEmail, zEmailOptional, zPhoneOptional, zRequired } from "@/lib/validation";
import type { Office } from "@/types";

export const officeSchema = z.object({
  name: zRequired(),
  legalName: z.string().trim().optional(),
  cnpj: zCnpjOptional(),
  oab: z.string().trim().optional(),
  principalLawyer: zRequired(),
  email: zEmailOptional(),
  phone: zPhoneOptional(),
  website: z.string().trim().optional(),
  zipCode: zCepOptional(),
  street: z.string().trim().optional(),
  number: z.string().trim().optional(),
  complement: z.string().trim().optional(),
  district: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.union([z.enum(BRAZILIAN_STATES), z.literal("")]).optional(),
  statesOfPractice: z.array(z.string()),
  units: z.string().trim().optional(),
});
export type OfficeFormValues = z.input<typeof officeSchema>;
export type OfficeFormOutput = z.output<typeof officeSchema>;

export function officeToForm(office: Office): OfficeFormValues {
  const a = office.address;
  return {
    name: office.name,
    legalName: office.legalName ?? "",
    cnpj: office.cnpj ?? "",
    oab: office.oab ?? "",
    principalLawyer: office.principalLawyer,
    email: office.email ?? "",
    phone: office.phone ?? "",
    website: office.website ?? "",
    zipCode: a?.zipCode ?? "",
    street: a?.street ?? "",
    number: a?.number ?? "",
    complement: a?.complement ?? "",
    district: a?.district ?? "",
    city: a?.city ?? "",
    state: (BRAZILIAN_STATES as readonly string[]).includes(a?.state ?? "") ? (a?.state as OfficeFormValues["state"]) : "",
    statesOfPractice: office.statesOfPractice,
    units: office.units.join("\n"),
  };
}

export function formToOfficePatch(v: OfficeFormOutput): Partial<Omit<Office, "id" | "onboarding">> {
  const hasAddress = Boolean(v.street || v.city || v.zipCode);
  return {
    name: v.name.trim(),
    legalName: v.legalName || undefined,
    cnpj: v.cnpj || undefined,
    oab: v.oab || undefined,
    principalLawyer: v.principalLawyer.trim(),
    email: v.email || undefined,
    phone: v.phone || undefined,
    website: v.website || undefined,
    address: hasAddress
      ? {
          zipCode: v.zipCode ?? "",
          street: v.street ?? "",
          number: v.number ?? "",
          complement: v.complement || undefined,
          district: v.district ?? "",
          city: v.city ?? "",
          state: v.state ?? "",
          country: "Brasil",
        }
      : undefined,
    statesOfPractice: v.statesOfPractice,
    units: (v.units ?? "")
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean),
  };
}

export const inviteSchema = z.object({
  name: zRequired(),
  email: zEmail(),
  role: z.enum(ROLES),
});
export type InviteFormValues = z.infer<typeof inviteSchema>;
