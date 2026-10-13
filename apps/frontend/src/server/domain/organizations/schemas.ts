import { z } from "zod";
import { PARTNER_OFFICE_STATUSES } from "@/lib/constants/status";
import { ALL_ROLES } from "@/lib/permissions";
import { pageInputSchema, sortSchema } from "@/server/core/pagination";
import { zCep, zEmailOptional, zOptionalText, zPercentage, zText, zUf, zUuid } from "@/server/core/validation";

/**
 * Entrada das operações de organização (escritório proprietário, parceiros e
 * leitura de usuários). Nenhum schema aceita `type`, `organizationId` da
 * sessão nem papel: o tipo da organização criada é SEMPRE `PARTNER` (o banco
 * ainda impede um segundo OWNER) e o escritório do parceiro vem da sessão.
 */

const digits = (v: string) => v.replace(/\D/g, "");

/** CNPJ opcional: vazio vira undefined; preenchido precisa ter 14 dígitos. */
export const zOptionalCnpj = () =>
  z
    .string()
    .trim()
    .transform(digits)
    .refine((d) => d === "" || (d.length === 14 && !/^(\d)\1+$/.test(d)), "CNPJ deve ter 14 dígitos.")
    .transform((d) => (d ? d : undefined))
    .optional();

/** OAB: número (até 10 letras/dígitos, sem pontuação) + UF. */
export const oabSchema = z.object({
  number: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/[^0-9A-Z]/g, ""))
    .refine((v) => /^[0-9A-Z]{1,10}$/.test(v), "OAB: até 10 letras ou números."),
  state: zUf(),
});
export type OabInput = z.infer<typeof oabSchema>;

/** Endereço da sede (colunas address_* de organizations). */
export const officeAddressSchema = z.object({
  zipCode: zCep().optional(),
  street: zOptionalText(200),
  number: zOptionalText(20),
  complement: zOptionalText(100),
  district: zOptionalText(100),
  city: zOptionalText(100),
  state: zUf().optional(),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "País inválido.").optional(),
});
export type OfficeAddressInput = z.infer<typeof officeAddressSchema>;

/** Divisão soma 100 (com 2 casas, sem erro de ponto flutuante). */
const splitIs100 = (v: { partnershipPercentage: number; ownerPercentage: number }) => Math.round((v.partnershipPercentage + v.ownerPercentage) * 100) === 10_000;
const SPLIT_MESSAGE = { message: "A divisão entre parceiro e escritório precisa somar 100%.", path: ["ownerPercentage"] };

/* ------------------------------------------------------------------ */
/* Escritório proprietário                                             */
/* ------------------------------------------------------------------ */

/** Edição (PATCH) dos dados do escritório proprietário. Só ADMIN. */
export const updateOwnerOfficeSchema = z
  .object({
    name: zText(200, "Informe o nome do escritório."),
    legalName: zOptionalText(200).nullable(),
    tradeName: zOptionalText(200).nullable(),
    cnpj: zOptionalCnpj().nullable(),
    email: zEmailOptional().nullable(),
    phone: zOptionalText(20).nullable(),
    website: zOptionalText(200).nullable(),
    address: officeAddressSchema.nullable(),
    principalLawyer: zOptionalText(200).nullable(),
    oab: oabSchema.nullable(),
    statesOfPractice: z
      .array(zUf())
      .max(27)
      .transform((list) => [...new Set(list)]),
    units: z.array(zText(120)).max(50),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "Nada para alterar.");
export type UpdateOwnerOfficeInput = z.infer<typeof updateOwnerOfficeSchema>;

/* ------------------------------------------------------------------ */
/* Parceiros                                                           */
/* ------------------------------------------------------------------ */

export const PARTNER_SORT_FIELDS = { name: "name", status: "status", createdAt: "created_at", updatedAt: "updated_at" } as const;

export const listPartnersSchema = pageInputSchema
  .extend({
    q: z.string().trim().max(120).optional(),
    /** Vocabulário do front (PENDING_INVITE = PENDING no banco). */
    status: z.enum(PARTNER_OFFICE_STATUSES).optional(),
  })
  .and(sortSchema(PARTNER_SORT_FIELDS, "name", "asc"));
export type ListPartnersInput = z.infer<typeof listPartnersSchema>;

export const organizationIdSchema = z.object({ id: zUuid() });

const partnerOfficeFields = {
  name: zText(200, "Informe o nome do escritório."),
  legalName: zOptionalText(200),
  tradeName: zOptionalText(200),
  cnpj: zOptionalCnpj(),
  email: zEmailOptional(),
  phone: zOptionalText(20),
  website: zOptionalText(200),
  address: officeAddressSchema.optional(),
  /** Advogado responsável pelo parceiro (contato operacional). */
  responsibleName: zOptionalText(200),
  responsibleOab: oabSchema.optional(),
  /** Observações internas: nunca exibidas ao parceiro. */
  notes: zOptionalText(5000),
};

/**
 * Cadastro de parceiro (ADMIN). Nasce `PENDING` e é ativado pelo aceite do
 * primeiro PARTNER_ADMIN (accept_invitation) ou pelo ADMIN. Divisão padrão
 * 50/50 quando não informada.
 */
export const createPartnerSchema = z
  .object({
    ...partnerOfficeFields,
    partnershipActive: z.boolean().default(true),
    partnershipPercentage: zPercentage().default(50),
    ownerPercentage: zPercentage().default(50),
  })
  .refine(splitIs100, SPLIT_MESSAGE);
export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;

/** Edição (PATCH) do cadastro do parceiro. Divisão e situação têm operação própria. */
export const updatePartnerSchema = z.object({
  id: zUuid(),
  patch: z
    .object({
      name: partnerOfficeFields.name,
      legalName: zOptionalText(200).nullable(),
      tradeName: zOptionalText(200).nullable(),
      cnpj: zOptionalCnpj().nullable(),
      email: zEmailOptional().nullable(),
      phone: zOptionalText(20).nullable(),
      website: zOptionalText(200).nullable(),
      address: officeAddressSchema.nullable(),
      responsibleName: zOptionalText(200).nullable(),
      responsibleOab: oabSchema.nullable(),
      notes: zOptionalText(5000).nullable(),
      partnershipActive: z.boolean(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, "Nada para alterar."),
});
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;

/**
 * Situação do parceiro. `PENDING` (convite pendente) não se escolhe: é o
 * estado de nascimento. O escritório proprietário é protegido pelo banco
 * (organizations_guard): não é suspenso, inativado nem excluído.
 */
export const PARTNER_STATUS_TARGETS = ["ACTIVE", "SUSPENDED", "INACTIVE"] as const;
export const setPartnerStatusSchema = z.object({ id: zUuid(), status: z.enum(PARTNER_STATUS_TARGETS) });
export type SetPartnerStatusInput = z.infer<typeof setPartnerStatusSchema>;

/** Nova divisão PADRÃO (só novos casos; snapshots de casos aceitos não mudam). */
export const changePartnerShareSchema = z
  .object({ id: zUuid(), partnershipPercentage: zPercentage(), ownerPercentage: zPercentage() })
  .refine(splitIs100, SPLIT_MESSAGE);
export type ChangePartnerShareInput = z.infer<typeof changePartnerShareSchema>;

/* ------------------------------------------------------------------ */
/* Usuários (leitura)                                                  */
/* ------------------------------------------------------------------ */

export const MEMBER_SORT_FIELDS = { createdAt: "created_at", joinedAt: "joined_at", role: "role" } as const;

/**
 * Leitura de integrantes de uma organização. A gestão (convite, papel,
 * status, MFA) é de `src/server/auth/team-actions.ts` — aqui é só leitura.
 * `organizationId` só vale para a equipe interna; o parceiro sempre lê o
 * próprio escritório (o da sessão).
 */
export const listOrganizationUsersSchema = pageInputSchema
  .extend({
    organizationId: zUuid().optional(),
    status: z.enum(["INVITED", "ACTIVE", "SUSPENDED", "REMOVED"]).default("ACTIVE"),
    role: z.enum(ALL_ROLES).optional(),
  })
  .and(sortSchema(MEMBER_SORT_FIELDS, "createdAt", "asc"));
export type ListOrganizationUsersInput = z.infer<typeof listOrganizationUsersSchema>;
