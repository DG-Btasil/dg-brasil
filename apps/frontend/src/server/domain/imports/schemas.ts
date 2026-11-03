import { z } from "zod";
import { IMPORT_FIELD_KEYS } from "@/lib/domain/import-fields";
import { pageInputSchema } from "@/server/core/pagination";
import { zUuid } from "@/server/core/validation";

export const jobIdSchema = z.object({ jobId: zUuid() });

export const startImportSchema = z.object({
  fileName: z.string().trim().min(1, "Arquivo sem nome.").max(200, "Nome de arquivo longo demais."),
  sizeBytes: z.number().int().min(1, "O arquivo está vazio."),
});
export type StartImportInput = z.infer<typeof startImportSchema>;

export const readColumnsSchema = z.object({
  jobId: zUuid(),
  sheetName: z.string().trim().min(1).max(200).optional(),
});

export const simulateSchema = z.object({
  jobId: zUuid(),
  mapping: z
    .array(z.object({ sourceColumn: z.string().min(1).max(200), targetField: z.enum(IMPORT_FIELD_KEYS) }))
    .min(1, "Escolha o campo de pelo menos uma coluna.")
    .max(200),
  options: z.object({ legalAreaId: zUuid().optional(), lawyerId: zUuid().optional() }).default({}),
});
export type SimulateInput = z.infer<typeof simulateSchema>;

export const ROW_FILTERS = ["all", "problems", "errors", "warnings", "imported", "skipped"] as const;
export const listRowsSchema = pageInputSchema.extend({
  jobId: zUuid(),
  filter: z.enum(ROW_FILTERS).default("all"),
});

export const listJobsSchema = pageInputSchema;

export const conflictsSchema = z.object({
  jobId: zUuid(),
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(500).default(100),
});

const RESOLUTIONS = ["UPDATE", "IGNORE", "CREATE_NEW"] as const;
export const CONFLICT_KINDS = ["CLIENT_DOCUMENT", "PROCESS_CNJ", "POSSIBLE_DUPLICATE"] as const;
export const resolveConflictsSchema = z.object({
  jobId: zUuid(),
  items: z
    .array(
      z.union([
        z.object({ conflictId: zUuid(), resolution: z.enum(RESOLUTIONS).nullable() }),
        z.object({ kind: z.enum(CONFLICT_KINDS), resolution: z.enum(RESOLUTIONS) }),
      ]),
    )
    .min(1)
    .max(5000),
});
export type ResolveConflictsInput = z.infer<typeof resolveConflictsSchema>;

export const reportSchema = z.object({ jobId: zUuid(), only: z.enum(["all", "problems"]).default("problems") });
