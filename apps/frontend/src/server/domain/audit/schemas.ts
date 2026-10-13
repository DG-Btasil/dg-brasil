import { z } from "zod";
import { pageInputSchema, sortSchema } from "@/server/core/pagination";
import { zIsoDateTime, zUuid } from "@/server/core/validation";

/**
 * Filtros da leitura de auditoria (só ADMIN). Não existe schema de escrita:
 * a trilha é gravada pelo banco (triggers) e é append-only.
 */

const range = <T extends { from?: string; to?: string }>(v: T) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to);
const RANGE_MESSAGE = { message: "A data inicial precisa ser anterior à final.", path: ["to"] };

export const AUDIT_SORT_FIELDS = { createdAt: "created_at" } as const;

export const listAuditEventsSchema = pageInputSchema
  .extend({
    /** Nome da tabela/entidade no banco (ex.: organizations, legal_cases). */
    entityType: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,62}$/, "Tipo de entidade inválido.")
      .optional(),
    entityId: zUuid().optional(),
    action: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]{1,63}$/, "Ação inválida.")
      .optional(),
    actorUserId: zUuid().optional(),
    actorType: z.enum(["USER", "AGENT", "SYSTEM"]).optional(),
    requestId: zUuid().optional(),
    from: zIsoDateTime().optional(),
    to: zIsoDateTime().optional(),
  })
  .refine(range, RANGE_MESSAGE)
  .and(sortSchema(AUDIT_SORT_FIELDS, "createdAt", "desc"));
export type ListAuditEventsInput = z.infer<typeof listAuditEventsSchema>;

export const ACCESS_RESOURCE_TYPES = ["CLIENT", "DOCUMENT", "DOCUMENT_VERSION", "LEGAL_CASE", "LEGAL_PROCESS", "EXPORT", "REPORT"] as const;
export const ACCESS_ACTIONS = ["VIEW_DETAIL", "DOWNLOAD", "EXPORT", "PRINT", "ADMIN_ACCESS"] as const;

export const listPersonalDataAccessSchema = pageInputSchema
  .extend({
    clientId: zUuid().optional(),
    actorUserId: zUuid().optional(),
    resourceType: z.enum(ACCESS_RESOURCE_TYPES).optional(),
    resourceId: zUuid().optional(),
    action: z.enum(ACCESS_ACTIONS).optional(),
    from: zIsoDateTime().optional(),
    to: zIsoDateTime().optional(),
  })
  .refine(range, RANGE_MESSAGE)
  .and(sortSchema(AUDIT_SORT_FIELDS, "createdAt", "desc"));
export type ListPersonalDataAccessInput = z.infer<typeof listPersonalDataAccessSchema>;
