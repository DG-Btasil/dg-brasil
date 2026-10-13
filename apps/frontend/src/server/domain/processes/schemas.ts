import { z } from "zod";
import { CLIENT_POLES, DEADLINE_TYPES, PROCESS_ORIGINS, PROCESS_PHASES, PROCESS_STATUSES } from "@/lib/constants/status";
import { pageInputSchema, sortSchema } from "@/server/core/pagination";
import { zCnj, zIsoDate, zIsoDateTime, zMoney, zOptionalText, zTaxId, zText, zUf, zUuid } from "@/server/core/validation";

/**
 * Entrada das operações de Processo, Partes e Movimentações (validada no
 * servidor, sempre). Vocabulário = o do banco (canônico).
 */

/** Status gravados no banco: os do front + ARCHIVED (exibido como "Encerrado"). */
export const DB_PROCESS_STATUSES = [...PROCESS_STATUSES, "ARCHIVED"] as const;
export const PARTY_TYPES = ["PLAINTIFF", "DEFENDANT", "INTERESTED", "OTHER"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

/** Texto vazio ("" ou só espaços) vira ausente — formulários mandam "" em campo opcional. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
/** Mesmo, mas para PATCH: "" significa "limpar" (null). */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const optionalCnj = () => z.preprocess(blankToUndefined, zCnj().optional());
const optionalTaxId = () => z.preprocess(blankToUndefined, zTaxId().optional());

/* ------------------------------------------------------------------ */
/* Listagem                                                            */
/* ------------------------------------------------------------------ */

export const PROCESS_SORT_FIELDS = {
  updatedAt: "updated_at",
  createdAt: "created_at",
  title: "title",
  cnj: "cnj_number",
  distributionDate: "distribution_date",
} as const;

export const listProcessesSchema = pageInputSchema
  .extend({
    /** CNJ (só dígitos, prefixo, com ou sem máscara) ou trecho do título. */
    q: z.string().trim().max(120).optional(),
    status: z.enum(DB_PROCESS_STATUSES).optional(),
    clientId: zUuid().optional(),
    caseId: zUuid().optional(),
    /** Só equipe interna (parceiro não filtra por responsável interno). */
    responsibleUserId: zUuid().optional(),
    phase: z.enum(PROCESS_PHASES).optional(),
    /** Tribunal (texto exato da lista de tribunais). */
    court: z.string().trim().min(1).max(200).optional(),
    /** Origem técnica do cadastro. */
    technicalOrigin: z.enum(PROCESS_ORIGINS).optional(),
    /** Origem comercial do CASO do processo. Só equipe interna. */
    caseOriginOrganizationId: zUuid().optional(),
  })
  .and(sortSchema(PROCESS_SORT_FIELDS, "updatedAt"));
export type ListProcessesInput = z.infer<typeof listProcessesSchema>;

/** Processos de um caso (aba do caso): mais antigos primeiro. */
export const listCaseProcessesSchema = pageInputSchema.extend({ caseId: zUuid() });
export type ListCaseProcessesInput = z.infer<typeof listCaseProcessesSchema>;

export const processIdSchema = z.object({ id: zUuid() });

/* ------------------------------------------------------------------ */
/* Cadastro e edição                                                   */
/* ------------------------------------------------------------------ */

/** Campos que interno e parceiro informam. */
const sharedFields = {
  title: zText(300, "Informe o título do processo."),
  cnj: optionalCnj(),
  court: zOptionalText(200),
  unit: zOptionalText(200),
  district: zOptionalText(120),
  state: z.preprocess(blankToUndefined, zUf().optional()),
  /** Classe processual (ex.: "Procedimento Comum Cível") — coluna legal_class. */
  actionType: zOptionalText(200),
  subject: zOptionalText(300),
  clientPole: z.enum(CLIENT_POLES).optional(),
  /** Resumo da parte contrária. As partes em si ficam em process_parties. */
  opposingParty: zOptionalText(500),
  distributionDate: z.preprocess(blankToUndefined, zIsoDate().optional()),
  /** Valor da causa (dado jurídico, nunca base financeira). */
  caseValue: zMoney().optional(),
};

/** Só equipe interna. */
const internalFields = {
  status: z.enum(DB_PROCESS_STATUSES).optional(),
  phase: z.enum(PROCESS_PHASES).optional(),
  responsibleUserId: zUuid().optional(),
  operationalDueAt: zIsoDateTime().optional(),
  summary: zOptionalText(5000),
  notes: zOptionalText(5000),
};

const nextDeadlineSchema = z.object({
  title: zText(300, "Informe o título do prazo."),
  type: z.enum(DEADLINE_TYPES).default("INTERNAL"),
  dueDate: zIsoDate(),
});

/** Cadastro interno (ADMIN/LAWYER). Processo SEMPRE pertence a um caso. */
export const createProcessSchema = z.object({
  /**
   * Chave de envio (UUID) gerada pela tela UMA vez por intenção de envio;
   * nova tentativa da mesma intenção reutiliza a mesma chave (migration 027).
   */
  idempotencyKey: zUuid(),
  legalCaseId: zUuid(),
  ...sharedFields,
  ...internalFields,
  /** Prazo inicial opcional (mesmo formulário do front). */
  nextDeadline: nextDeadlineSchema.optional(),
});
export type CreateProcessInput = z.infer<typeof createProcessSchema>;

/** Portal do Parceiro: processo para um caso do próprio escritório. Sem campo interno. */
export const createPartnerProcessSchema = z.object({
  /** Chave de envio (UUID) — uma por intenção de envio; retry reutiliza (migration 027). */
  idempotencyKey: zUuid(),
  legalCaseId: zUuid(),
  ...sharedFields,
});
export type CreatePartnerProcessInput = z.infer<typeof createPartnerProcessSchema>;

/** Edição interna (PATCH): chave ausente = não mexe; null/"" = limpa. O caso não muda. */
export const updateProcessSchema = z.object({
  id: zUuid(),
  patch: z
    .object({
      title: sharedFields.title,
      cnj: z.preprocess(blankToNull, zCnj().nullable()),
      court: zOptionalText(200).nullable(),
      unit: zOptionalText(200).nullable(),
      district: zOptionalText(120).nullable(),
      state: z.preprocess(blankToNull, zUf().nullable()),
      actionType: zOptionalText(200).nullable(),
      subject: zOptionalText(300).nullable(),
      clientPole: z.enum(CLIENT_POLES).nullable(),
      opposingParty: zOptionalText(500).nullable(),
      distributionDate: z.preprocess(blankToNull, zIsoDate().nullable()),
      caseValue: zMoney().nullable(),
      status: z.enum(DB_PROCESS_STATUSES),
      phase: z.enum(PROCESS_PHASES).nullable(),
      responsibleUserId: zUuid().nullable(),
      operationalDueAt: zIsoDateTime().nullable(),
      summary: zOptionalText(5000).nullable(),
      notes: zOptionalText(5000).nullable(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, "Nada para alterar."),
});
export type UpdateProcessInput = z.infer<typeof updateProcessSchema>;

/* ------------------------------------------------------------------ */
/* Partes                                                              */
/* ------------------------------------------------------------------ */

export const listPartiesSchema = pageInputSchema.extend({ processId: zUuid() });
export type ListPartiesInput = z.infer<typeof listPartiesSchema>;

export const addPartySchema = z.object({
  processId: zUuid(),
  type: z.enum(PARTY_TYPES),
  name: zText(300, "Informe o nome da parte."),
  /** CPF ou CNPJ (só dígitos no banco). */
  document: optionalTaxId(),
  /** Cliente do sistema que é esta parte (precisa ser um cliente que o usuário acessa). */
  clientId: zUuid().optional(),
});
export type AddPartyInput = z.infer<typeof addPartySchema>;

export const updatePartySchema = z.object({
  id: zUuid(),
  patch: z
    .object({
      type: z.enum(PARTY_TYPES),
      name: zText(300, "Informe o nome da parte."),
      document: z.preprocess(blankToNull, zTaxId().nullable()),
      clientId: zUuid().nullable(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, "Nada para alterar."),
});
export type UpdatePartyInput = z.infer<typeof updatePartySchema>;

/* ------------------------------------------------------------------ */
/* Movimentações                                                       */
/* ------------------------------------------------------------------ */

export const listEventsSchema = pageInputSchema.extend({ processId: zUuid() });
export type ListEventsInput = z.infer<typeof listEventsSchema>;

/**
 * Movimentação MANUAL (nota da equipe). Não há campo de origem: o servidor
 * grava sempre `source = MANUAL` — movimentação oficial (tribunal, diário,
 * importação) só entra pela integração/importação, nunca digitada.
 */
export const createEventSchema = z.object({
  processId: zUuid(),
  title: zText(300, "Informe o título da movimentação."),
  description: zOptionalText(10_000),
  occurredAt: zIsoDateTime().optional(),
  important: z.boolean().default(false),
  /** Código do tipo (ex.: MANUAL_NOTE, CLIENT_CONTACT). Nunca texto livre. */
  eventType: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,59}$/, "Tipo de movimentação inválido.")
    .default("MANUAL_NOTE"),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;
