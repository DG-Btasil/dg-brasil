import { z } from "zod";
import { LEGAL_CASE_STATUSES } from "@/lib/constants/status";
import { pageInputSchema, sortSchema } from "@/server/core/pagination";
import { zCep, zCnpj, zCpf, zEmailOptional, zIsoDate, zOptionalText, zText, zUf, zUuid } from "@/server/core/validation";

/** Entrada das operações de caso (validada no servidor, sempre). */

/** Código de catálogo (área/tipo de caso), mesmo formato do banco (005_legal_catalog). */
export const zCatalogCode = () =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,63}$/, "Código inválido.");

/**
 * Área e tipo de caso: por id (uuid) ou por código (ex.: BANKING). O service
 * resolve o código para o id no catálogo (legal_areas / case_types).
 */
const catalogFields = {
  area: zCatalogCode().optional(),
  legalAreaId: zUuid().optional(),
  caseTypeCode: zCatalogCode().optional(),
  caseTypeId: zUuid().optional(),
};

type CatalogShape = { area?: string; legalAreaId?: string; caseTypeCode?: string | null; caseTypeId?: string | null };

/** Área obrigatória (exatamente uma forma) e tipo em no máximo uma forma. */
function refineCatalog(value: CatalogShape, ctx: z.RefinementCtx, areaRequired: boolean) {
  const hasArea = value.area !== undefined;
  const hasAreaId = value.legalAreaId !== undefined;
  if (hasArea && hasAreaId) ctx.addIssue({ code: "custom", path: ["area"], message: "Informe a área por código ou por id, não os dois." });
  if (areaRequired && !hasArea && !hasAreaId) ctx.addIssue({ code: "custom", path: ["area"], message: "Informe a área jurídica." });
  if (value.caseTypeCode != null && value.caseTypeId != null) {
    ctx.addIssue({ code: "custom", path: ["caseTypeCode"], message: "Informe o tipo de caso por código ou por id, não os dois." });
  }
}

/* ------------------------------------------------------------------ */
/* Listagem                                                            */
/* ------------------------------------------------------------------ */

export const CASE_SORT_FIELDS = {
  updatedAt: "updated_at",
  createdAt: "created_at",
  submittedAt: "submitted_at",
  title: "title",
  status: "status",
} as const;

const statusSchema = z.enum(LEGAL_CASE_STATUSES, { message: "Situação de caso inválida." });

export const listCasesSchema = pageInputSchema
  .extend({
    q: z.string().trim().max(120).optional(),
    /** Uma situação ou várias (ex.: todas "em análise"). */
    status: z
      .preprocess((v) => (typeof v === "string" ? [v] : v), z.array(statusSchema).min(1).max(LEGAL_CASE_STATUSES.length))
      .optional(),
    clientId: zUuid().optional(),
    assignedLawyerId: zUuid().optional(),
    /** Só equipe interna: o parceiro sempre recebe apenas os casos do próprio escritório (RLS). */
    partnerOrganizationId: zUuid().optional(),
  })
  .and(sortSchema(CASE_SORT_FIELDS, "updatedAt"));
export type ListCasesInput = z.infer<typeof listCasesSchema>;

export const caseIdSchema = z.object({ id: zUuid() });

/* ------------------------------------------------------------------ */
/* Cadastro interno                                                    */
/* ------------------------------------------------------------------ */

export const createCaseSchema = z
  .object({
    /**
     * Chave de envio (UUID) gerada pela tela UMA vez por intenção de envio;
     * nova tentativa da mesma intenção reutiliza a mesma chave (migration 027).
     */
    idempotencyKey: zUuid(),
    clientId: zUuid(),
    ...catalogFields,
    title: zText(200, "Informe o título do caso."),
    summary: zOptionalText(10_000),
    opposingParty: zOptionalText(300),
    /** Atribuição comercial (proprietário ou parceiro ativo — o banco confere). Nunca concede acesso. */
    originOrganizationId: zUuid(),
    assignedLawyerId: zUuid().optional(),
    /** Observações internas (legal_case_internal_details). */
    notes: zOptionalText(10_000),
    /** Observações compartilhadas com o parceiro vinculado. */
    partnerNotes: zOptionalText(5000),
    /** true = já envia para análise; false = rascunho. */
    submit: z.boolean().default(false),
    /**
     * Opt-in explícito: também vincular o parceiro de ORIGEM ao caso (acesso
     * operacional). Sem ele, o caso nasce interno (partner_organization_id nulo).
     */
    linkPartner: z.boolean().default(false),
  })
  .superRefine((v, ctx) => refineCatalog(v, ctx, true));
export type CreateCaseInput = z.infer<typeof createCaseSchema>;

/* ------------------------------------------------------------------ */
/* Edição (PATCH)                                                      */
/* ------------------------------------------------------------------ */

export const updateCaseSchema = z.object({
  id: zUuid(),
  patch: z
    .object({
      title: zText(200, "Informe o título do caso."),
      summary: zOptionalText(10_000).nullable(),
      opposingParty: zOptionalText(300).nullable(),
      area: zCatalogCode(),
      legalAreaId: zUuid(),
      /** null = remove o tipo do caso. */
      caseTypeCode: zCatalogCode().nullable(),
      caseTypeId: zUuid().nullable(),
      /** Observações internas. Parceiro não envia (recusado no service). */
      notes: zOptionalText(10_000).nullable(),
      partnerNotes: zOptionalText(5000).nullable(),
    })
    .partial()
    .superRefine((v, ctx) => {
      if (Object.keys(v).length === 0) ctx.addIssue({ code: "custom", message: "Nada para alterar." });
      refineCatalog(v, ctx, false);
    }),
});
export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;
export type UpdateCasePatch = UpdateCaseInput["patch"];

/* ------------------------------------------------------------------ */
/* Decisões e transições                                               */
/* ------------------------------------------------------------------ */

export const acceptCaseSchema = z.object({
  id: zUuid(),
  /** Advogado responsável. Sem ele, vale o já atribuído (o banco exige um). */
  lawyerId: zUuid().optional(),
});
export type AcceptCaseInput = z.infer<typeof acceptCaseSchema>;

export const rejectCaseSchema = z.object({
  id: zUuid(),
  /** Visível ao parceiro. Obrigatório. */
  publicReason: zText(2000, "Informe o motivo que o parceiro verá."),
  /** Nota interna. Nunca chega ao parceiro. */
  internalNote: zOptionalText(5000),
});
export type RejectCaseInput = z.infer<typeof rejectCaseSchema>;

export const assignLawyerSchema = z.object({ id: zUuid(), lawyerId: zUuid() });
export type AssignLawyerInput = z.infer<typeof assignLawyerSchema>;

export const changeOriginSchema = z.object({
  id: zUuid(),
  originOrganizationId: zUuid(),
  /** Obrigatório depois do aceite (o banco exige). */
  reason: zOptionalText(1000),
  /** Opt-in: vincular também o parceiro de origem (só para caso ainda sem parceiro). */
  linkPartner: z.boolean().default(false),
});
export type ChangeOriginInput = z.infer<typeof changeOriginSchema>;

export const overrideStatusSchema = z.object({
  id: zUuid(),
  status: statusSchema,
  reason: zText(1000, "Informe o motivo da exceção."),
});
export type OverrideStatusInput = z.infer<typeof overrideStatusSchema>;

/* ------------------------------------------------------------------ */
/* Portal do Parceiro: envio de caso                                   */
/* ------------------------------------------------------------------ */

/**
 * Origem escolhida pelo parceiro: o próprio escritório ou o escritório
 * proprietário. O id de cada um vem da sessão / do banco — nunca do navegador.
 */
export const PARTNER_ORIGINS = ["OWN_OFFICE", "OWNER"] as const;
export type PartnerOrigin = (typeof PARTNER_ORIGINS)[number];
const partnerOriginSchema = z.enum(PARTNER_ORIGINS).default("OWN_OFFICE");

const partnerAddressSchema = z.object({
  zipCode: zCep().optional(),
  street: zOptionalText(200),
  number: zOptionalText(20),
  complement: zOptionalText(100),
  district: zOptionalText(100),
  city: zOptionalText(100),
  state: zUf().optional(),
});

const partnerClientCommon = {
  /** Origem do CADASTRO do cliente (só usada se o CPF/CNPJ ainda não existe). */
  origin: partnerOriginSchema,
  email: zEmailOptional(),
  phone: zOptionalText(20),
  address: partnerAddressSchema.optional(),
};

/**
 * Cliente do envio. Se o CPF/CNPJ já existe, o banco usa o cadastro canônico
 * e ignora os demais campos (nunca sobrescreve dado de outro escritório).
 */
export const partnerClientSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("INDIVIDUAL"), document: zCpf(), fullName: zOptionalText(200), birthDate: zIsoDate().optional(), ...partnerClientCommon }),
  z.object({ kind: z.literal("COMPANY"), document: zCnpj(), legalName: zOptionalText(200), tradeName: zOptionalText(200), ...partnerClientCommon }),
]);

export const partnerSubmitCaseSchema = z.object({
  /**
   * Chave de envio (UUID) gerada pela tela UMA vez por intenção de envio;
   * nova tentativa da mesma intenção reutiliza a mesma chave (migration 027).
   */
  idempotencyKey: zUuid(),
  client: partnerClientSchema,
  case: z
    .object({
      ...catalogFields,
      title: zText(200, "Informe o título do caso."),
      summary: zOptionalText(10_000),
      opposingParty: zOptionalText(300),
      /** Origem do CASO (atribuição comercial). */
      origin: partnerOriginSchema,
      partnerNotes: zOptionalText(5000),
    })
    .superRefine((v, ctx) => refineCatalog(v, ctx, true)),
});
export type PartnerSubmitCaseInput = z.infer<typeof partnerSubmitCaseSchema>;
