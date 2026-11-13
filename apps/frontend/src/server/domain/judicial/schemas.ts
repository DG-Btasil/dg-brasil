import { z } from "zod";
import { zUuid } from "@/server/core/validation";

/** Entradas da integração judicial (043). O banco revalida papel, escopo e formato. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const uf = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Selecione a UF.");

export const saveMonitorSchema = z.object({
  oabNumber: z.string().trim().min(1, "Informe o número da OAB.").max(20),
  oabState: uf,
  lawyerName: z.string().trim().max(200).optional(),
  organizationId: zUuid().optional(),
  responsibleUserId: zUuid().optional(),
});

export const monitorActiveSchema = z.object({ id: zUuid(), active: z.boolean() });

export const coverageSchema = z.object({
  oabNumber: z.string().trim().min(1).max(20),
  oabState: uf,
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const settingsSchema = z.object({
  djenEnabled: z.boolean().optional(),
  datajudEnabled: z.boolean().optional(),
  lookbackDays: z.number().int().min(1).max(7).optional(),
  deadlineAgentId: zUuid().nullable().optional(),
  deadlineAutoApply: z.boolean().optional(),
  deadlineAutoTask: z.boolean().optional(),
});

export const calendarDaySchema = z.object({
  court: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,15}$/, "Sigla do tribunal inválida (ex.: TJSP).").optional().or(z.literal("")),
  day: isoDate,
  kind: z.enum(["HOLIDAY", "SUSPENSION"]),
  description: z.string().trim().min(1, "Descreva o dia.").max(200),
});

export const idSchema = z.object({ id: zUuid() });
export const processIdSchema = z.object({ processId: zUuid() });
export const processSyncSchema = z.object({ processId: zUuid(), enabled: z.boolean() });

export const listPublicationsSchema = z.object({
  status: z.enum(["OPEN", "PENDING", "WITH_AGENT", "DONE"]).optional(),
  processId: zUuid().optional(),
  mine: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(25),
});

export const decideSchema = z.object({
  id: zUuid(),
  action: z.enum(["NO_DEADLINE", "REOPEN"]),
  notes: z.string().trim().max(2000).optional(),
});

export const DEADLINE_TYPES = ["MANIFESTATION", "REPLY", "APPEAL", "HEARING", "DOCUMENT_DELIVERY", "FILING", "INTERNAL"] as const;

export const createDeadlineSchema = z.object({
  id: zUuid(),
  title: z.string().trim().min(1, "Informe o título do prazo.").max(200),
  dueOn: isoDate,
  deadlineType: z.enum(DEADLINE_TYPES).default("MANIFESTATION"),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("HIGH"),
  responsibleUserId: zUuid().optional(),
  description: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const previewSchema = z.object({
  availableOn: isoDate,
  court: z.string().trim().max(15).optional(),
  businessDays: z.number().int().min(1).max(120),
});

export const syncNowSchema = z.object({ processId: zUuid().optional() });
