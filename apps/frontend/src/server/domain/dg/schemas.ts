import { z } from "zod";
import { LOCAL_AGENT_NAME, REFERENCE_FILE_MAX_BYTES } from "@/lib/constants/ai";
import { AGENT_STATUSES, REFERENCE_MATERIAL_STATUSES, REFERENCE_MATERIAL_TYPES, THESIS_STATUSES } from "@/lib/constants/status";
import { zUuid } from "@/server/core/validation";

/**
 * Entradas da área DG Brasil (só ADMIN, `dgbrasil.manage`). O banco revalida
 * tudo (039): estas regras existem para o erro aparecer no campo certo.
 */

const texto = (max: number, msg = "Campo obrigatório.") => z.string().trim().min(1, msg).max(max, `No máximo ${max} caracteres.`);
const textoOpcional = (max: number) => z.string().trim().max(max, `No máximo ${max} caracteres.`).optional().transform((v) => v || undefined);
const ids = () => z.array(zUuid()).max(200).default([]);

/** Configuração do agente (agent_versions.configuration): o agente local do Claude Code que faz o trabalho. */
export const agentConfigSchema = z
  .object({
    localAgent: z
      .string()
      .trim()
      .regex(LOCAL_AGENT_NAME, "Use o nome do agente no Claude Code: letras minúsculas, números e hífen (ex.: clara-hiscon)."),
  })
  .strict();
export type AgentConfigInput = z.infer<typeof agentConfigSchema>;

export const saveAgentSchema = z.object({
  key: zUuid(),
  id: zUuid().optional(),
  name: texto(120, "Informe o nome do agente."),
  description: textoOpcional(2000),
  purpose: textoOpcional(2000),
  status: z.enum(AGENT_STATUSES),
  instructions: texto(200_000, "Escreva as orientações do DG Brasil para este agente (o que entregar e como)."),
  config: agentConfigSchema,
  thesisIds: ids(),
  referenceIds: ids(),
});
export type SaveAgentInput = z.infer<typeof saveAgentSchema>;

export const setAgentStatusSchema = z.object({ id: zUuid(), status: z.enum(AGENT_STATUSES) });
export const idSchema = z.object({ id: zUuid() });

export const saveThesisSchema = z.object({
  key: zUuid(),
  id: zUuid().optional(),
  title: texto(200, "Informe o título da tese."),
  description: textoOpcional(2000),
  legalAreaId: zUuid(),
  status: z.enum(THESIS_STATUSES),
  foundations: textoOpcional(50_000),
  applicationCriteria: textoOpcional(50_000),
  exclusionCriteria: textoOpcional(50_000),
  notes: textoOpcional(20_000),
  agentIds: z.array(zUuid()).max(200).optional(),
  referenceIds: z.array(zUuid()).max(200).optional(),
});
export type SaveThesisInput = z.infer<typeof saveThesisSchema>;

export const prepareReferenceFileSchema = z.object({
  referenceId: zUuid().optional(),
  fileName: z.string().trim().min(1).max(200),
  size: z.number().int().positive().max(REFERENCE_FILE_MAX_BYTES, "Arquivo maior que 50 MB."),
});
export type PrepareReferenceFileInput = z.infer<typeof prepareReferenceFileSchema>;

export const saveReferenceSchema = z
  .object({
    key: zUuid(),
    id: zUuid(),
    create: z.boolean(),
    versionId: zUuid().optional(),
    type: z.enum(REFERENCE_MATERIAL_TYPES),
    title: texto(200, "Informe o título."),
    description: textoOpcional(2000),
    legalAreaId: zUuid().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
    status: z.enum(REFERENCE_MATERIAL_STATUSES),
    contentText: textoOpcional(500_000),
    file: z
      .object({ storageObjectName: z.string().min(1).max(400), originalFilename: z.string().min(1).max(200), mimeType: z.string().min(1).max(120), size: z.number().int().positive() })
      .optional(),
    agentIds: z.array(zUuid()).max(200).optional(),
    thesisIds: z.array(zUuid()).max(200).optional(),
  })
  .refine((v) => !v.create || v.contentText || v.file, { message: "Informe o texto ou envie um arquivo.", path: ["contentText"] })
  .refine((v) => !(v.contentText || v.file) || v.versionId, { message: "Versão ausente.", path: ["versionId"] });
export type SaveReferenceInput = z.infer<typeof saveReferenceSchema>;

export const setTemplateAgentSchema = z.object({ templateId: zUuid(), agentId: zUuid().nullable() });

export const historySchema = z.object({
  entityType: z.enum(["AGENT", "SKILL", "THESIS", "REFERENCE"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export type HistoryInput = z.infer<typeof historySchema>;

export const setAiEnabledSchema = z.object({ enabled: z.boolean(), reason: textoOpcional(500) });

/** Computador do escritório (Configurações → Computador do escritório). */
export const createExecutorSchema = z.object({ name: texto(80, "Dê um nome ao computador (ex.: Computador da recepção).") });
export const revokeExecutorSchema = z.object({ id: zUuid() });
