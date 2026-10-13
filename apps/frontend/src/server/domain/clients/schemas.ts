import { z } from "zod";
import { CLIENT_INACTIVATION_REASONS } from "@/types/client";
import { pageInputSchema, sortSchema } from "@/server/core/pagination";
import {
  zCep,
  zCnpj,
  zCpf,
  zEmailOptional,
  zIsoDate,
  zOptionalText,
  zPercentage,
  zTaxId,
  zText,
  zUf,
  zUuid,
} from "@/server/core/validation";

/** Entrada das operações de cliente (validada no servidor, sempre). */

export const CLIENT_SORT_FIELDS = { name: "display_name", createdAt: "created_at", updatedAt: "updated_at" } as const;

export const listClientsSchema = pageInputSchema
  .extend({
    q: z.string().trim().max(120).optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
    kind: z.enum(["INDIVIDUAL", "COMPANY"]).optional(),
    /** Só equipe interna: parceiro sempre recebe apenas os próprios relacionamentos (RLS). */
    originOrganizationId: zUuid().optional(),
    responsibleUserId: zUuid().optional(),
  })
  .and(sortSchema(CLIENT_SORT_FIELDS, "updatedAt"));
export type ListClientsInput = z.infer<typeof listClientsSchema>;

export const clientIdSchema = z.object({ id: zUuid() });

const contactSchema = z
  .object({
    email: zEmailOptional(),
    phone: zOptionalText(20),
    secondaryPhone: zOptionalText(20),
    website: zOptionalText(200),
  })
  .partial();

export const addressSchema = z.object({
  zipCode: zCep().optional(),
  street: zOptionalText(200),
  number: zOptionalText(20),
  complement: zOptionalText(100),
  district: zOptionalText(100),
  city: zOptionalText(100),
  state: zUf().optional(),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
});

const identitySchema = z.object({
  type: z.enum(["RG", "CNH", "PASSPORT", "RNM", "OTHER"]),
  number: zText(40),
  issuer: zOptionalText(40),
  state: zUf().optional(),
});

const individualFields = {
  fullName: zText(200, "Informe o nome completo."),
  socialName: zOptionalText(200),
  birthDate: zIsoDate().optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  nationality: zOptionalText(80),
  birthplace: zOptionalText(120),
  maritalStatus: z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED"]).optional(),
  stableUnion: z.boolean().optional(),
  profession: zOptionalText(120),
  identityDocument: identitySchema.optional(),
};

const companyFields = {
  legalName: zText(200, "Informe a razão social."),
  tradeName: zOptionalText(200),
  registrationStatus: zOptionalText(80),
  openingDate: zIsoDate().optional(),
  legalNature: zOptionalText(120),
  mainCnae: z.string().regex(/^\d{7}$/, "CNAE com 7 dígitos.").optional(),
  secondaryCnaes: z.array(z.string().regex(/^\d{7}$/, "CNAE com 7 dígitos.")).max(50).optional(),
};

const commonFields = {
  originOfficeId: zUuid(),
  responsibleUserId: zUuid().optional(),
  contact: contactSchema.default({}),
  address: addressSchema.optional(),
  notes: zOptionalText(5000),
  legalSummary: zOptionalText(5000),
};

const representativeSchema = z.object({
  name: zText(200),
  cpf: zCpf().optional(),
  role: zOptionalText(80),
  email: zEmailOptional(),
  phone: zOptionalText(20),
  isPrimary: z.boolean().default(false),
});

const shareholderSchema = z.object({
  name: zText(200),
  document: z.string().trim().transform((v) => v.replace(/\D/g, "")).refine((d) => d === "" || d.length === 11 || d.length === 14, "CPF ou CNPJ.").optional(),
  qualification: zOptionalText(120),
  sharePercent: zPercentage().optional(),
});

export const createClientSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("INDIVIDUAL"), cpf: zCpf(), ...individualFields, ...commonFields }),
  z.object({
    kind: z.literal("COMPANY"),
    cnpj: zCnpj(),
    ...companyFields,
    ...commonFields,
    representatives: z.array(representativeSchema).max(20).default([]),
    partners: z.array(shareholderSchema).max(50).default([]),
  }),
]);
export type CreateClientInput = z.infer<typeof createClientSchema>;

/** Edição interna (PATCH). CPF/CNPJ só ADMIN (o banco confere). */
export const updateClientSchema = z.object({
  id: zUuid(),
  patch: z
    .object({
      document: zTaxId(),
      ...individualFields,
      ...companyFields,
      originOfficeId: zUuid(),
      responsibleUserId: zUuid().nullable(),
      contact: contactSchema,
      address: addressSchema.nullable(),
      notes: zOptionalText(5000).nullable(),
      legalSummary: zOptionalText(5000).nullable(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, "Nada para alterar."),
});
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

/** Parceiro: só contato e endereço de cliente que acessa. */
export const updateClientBasicsSchema = z.object({
  id: zUuid(),
  contact: contactSchema.optional(),
  address: addressSchema.nullable().optional(),
});
export type UpdateClientBasicsInput = z.infer<typeof updateClientBasicsSchema>;

export const inactivateClientSchema = z.object({
  id: zUuid(),
  reason: z.enum(CLIENT_INACTIVATION_REASONS).optional(),
  note: zOptionalText(1000),
});

export const lookupClientSchema = z.object({ document: zTaxId() });

/**
 * Bloco societário de PJ (028): ESTADO FINAL das duas listas. Item com `id` =
 * linha existente do cliente (o banco confere que é dele); sem `id` = nova.
 * Nada de CRUD linha a linha: a coleção inteira vai numa operação atômica.
 */
export const replaceCompanyPeopleSchema = z.object({
  clientId: zUuid(),
  representatives: z
    .array(representativeSchema.extend({ id: zUuid().optional() }))
    .max(20, "No máximo 20 representantes.")
    .refine((list) => list.length === 0 || list.filter((r) => r.isPrimary).length === 1, "Marque exatamente um representante como principal."),
  partners: z.array(shareholderSchema.extend({ id: zUuid().optional() })).max(50, "No máximo 50 sócios."),
});
export type ReplaceCompanyPeopleInput = z.infer<typeof replaceCompanyPeopleSchema>;
