import { z } from "zod";
import {
  AGENT_LIMITS,
  AGENT_READ_TOOLS,
  AI_EFFORTS,
  AI_MODEL_IDS,
  REFERENCE_FILE_MAX_BYTES,
  SKILL_FILE_MAX_BYTES,
  SKILL_FILE_PATH,
  SKILL_FILES_MAX_COUNT,
} from "@/lib/constants/ai";
import { AGENT_STATUSES, REFERENCE_MATERIAL_STATUSES, REFERENCE_MATERIAL_TYPES, SKILL_STATUSES, THESIS_STATUSES } from "@/lib/constants/status";
import { zUuid } from "@/server/core/validation";

/**
 * Entradas da área DG Brasil (só ADMIN, `dgbrasil.manage`). O banco revalida
 * tudo (039): estas regras existem para o erro aparecer no campo certo.
 */

const texto = (max: number, msg = "Campo obrigatório.") => z.string().trim().min(1, msg).max(max, `No máximo ${max} caracteres.`);
const textoOpcional = (max: number) => z.string().trim().max(max, `No máximo ${max} caracteres.`).optional().transform((v) => v || undefined);
const ids = () => z.array(zUuid()).max(200).default([]);

/** Configuração de execução (agent_versions.configuration). Mesmo contrato do banco e do worker. */
export const agentConfigSchema = z
  .object({
    model: z.enum(AI_MODEL_IDS),
    effort: z.enum(AI_EFFORTS),
    codeExecution: z.boolean(),
    maxTurns: z.coerce.number().int().min(AGENT_LIMITS.maxTurns.min).max(AGENT_LIMITS.maxTurns.max),
    maxToolCalls: z.coerce.number().int().min(AGENT_LIMITS.maxToolCalls.min).max(AGENT_LIMITS.maxToolCalls.max),
    maxDurationSeconds: z.coerce.number().int().min(AGENT_LIMITS.maxDurationSeconds.min).max(AGENT_LIMITS.maxDurationSeconds.max),
    maxBudgetUsd: z.coerce.number().min(AGENT_LIMITS.maxBudgetUsd.min).max(AGENT_LIMITS.maxBudgetUsd.max),
    /** Vazio = todas as ferramentas de leitura. */
    tools: z.array(z.enum(AGENT_READ_TOOLS.map((t) => t.id) as [string, ...string[]])).default([]),
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
  instructions: texto(200_000, "As instruções do agente são obrigatórias."),
  config: agentConfigSchema,
  skillIds: ids().refine((v) => v.length <= 20, "No máximo 20 skills por agente."),
  thesisIds: ids(),
  referenceIds: ids(),
});
export type SaveAgentInput = z.infer<typeof saveAgentSchema>;

export const setAgentStatusSchema = z.object({ id: zUuid(), status: z.enum(AGENT_STATUSES) });
export const idSchema = z.object({ id: zUuid() });

const caminhoSkill = z
  .string()
  .trim()
  .max(200, "Caminho longo demais.")
  .regex(SKILL_FILE_PATH, "Use letras, números, ponto, hífen e sublinhado, com pastas separadas por /. Sem arquivos ocultos.")
  .refine((p) => p.toLowerCase() !== "skill.md", "O SKILL.md é gerado a partir das instruções: não envie como arquivo.");

/** Pede as URLs de envio dos arquivos de uma versão nova de skill. */
export const prepareSkillFilesSchema = z.object({
  /** Skill existente; sem id, o servidor gera o da skill nova. */
  skillId: zUuid().optional(),
  files: z
    .array(z.object({ path: caminhoSkill, size: z.number().int().positive().max(SKILL_FILE_MAX_BYTES, "Arquivo maior que 10 MB.") }))
    .max(SKILL_FILES_MAX_COUNT),
});
export type PrepareSkillFilesInput = z.infer<typeof prepareSkillFilesSchema>;

export const saveSkillSchema = z.object({
  key: zUuid(),
  id: zUuid(),
  create: z.boolean(),
  /** Obrigatório quando o conteúdo muda (o servidor gerou no prepare). */
  versionId: zUuid().optional(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "Use letras minúsculas, números e hífen (2 a 63 caracteres).")
    .refine((s) => !/(anthropic|claude)/.test(s), "Não pode conter “anthropic” nem “claude” (nome reservado do provedor).")
    .optional(),
  name: texto(120, "Informe o nome da skill."),
  description: texto(1024, "Descreva quando o agente deve usar esta skill (até 1.024 caracteres)."),
  status: z.enum(SKILL_STATUSES),
  instructions: texto(200_000, "As instruções da skill são obrigatórias."),
  files: z
    .array(
      z.object({
        path: caminhoSkill,
        storageObjectName: z.string().min(1).max(400),
        mimeType: z.string().min(1).max(120),
        size: z.number().int().positive().max(SKILL_FILE_MAX_BYTES),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .max(SKILL_FILES_MAX_COUNT)
    .default([]),
  /** Arquivos da versão atual que continuam. Ausente = todos continuam. */
  keepPaths: z.array(caminhoSkill).max(SKILL_FILES_MAX_COUNT).optional(),
  agentIds: z.array(zUuid()).max(200).optional(),
});
export type SaveSkillInput = z.infer<typeof saveSkillSchema>;

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
  skillIds: z.array(zUuid()).max(200).optional(),
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
    skillIds: z.array(zUuid()).max(200).optional(),
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
export const usageSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
