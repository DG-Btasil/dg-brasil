import { z } from "zod";
import { AGENT_AUTONOMY_LEVELS, AGENT_STATUSES, SKILL_STATUSES, THESIS_STATUSES } from "@/lib/constants/status";
import { LEGAL_AREAS } from "@/lib/constants/legal";
import { msg, zRequired } from "@/lib/validation";

const requiredEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values, { error: () => ({ message: msg.required }) });

/** Campos "um por linha" viram listas limpas (sem linhas vazias). */
export function linesToList(value: string | undefined): string[] {
  return (value ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export const agentFormSchema = z.object({
  name: zRequired("Informe o nome do agente."),
  role: zRequired("Informe a função do agente."),
  description: zRequired("Descreva o que o agente faz."),
  objective: z.string().optional(),
  skillIds: z.array(z.string()),
  thesisIds: z.array(z.string()),
  status: requiredEnum(AGENT_STATUSES),
  autonomy: requiredEnum(AGENT_AUTONOMY_LEVELS),
  rules: z.string().optional(),
});
export type AgentFormValues = z.infer<typeof agentFormSchema>;

export const skillFormSchema = z.object({
  name: zRequired("Informe o nome da Skill."),
  description: zRequired("Descreva a Skill em uma frase."),
  purpose: zRequired("Informe para que a Skill serve."),
  instructions: zRequired("Escreva as instruções, em linguagem simples."),
  agentIds: z.array(z.string()),
  version: z.string().trim().regex(/^[1-9]\d*$/, "Use um número inteiro a partir de 1."),
  status: requiredEnum(SKILL_STATUSES),
});
export type SkillFormValues = z.infer<typeof skillFormSchema>;

export const thesisFormSchema = z.object({
  name: zRequired("Informe o nome da tese."),
  area: requiredEnum(LEGAL_AREAS),
  summary: zRequired("Descreva a tese."),
  foundations: z.string().optional(),
  applicationCriteria: zRequired("Informe ao menos um critério de aplicação."),
  nonApplicationCriteria: z.string().optional(),
  requiredDocuments: z.string().optional(),
  references: z.string().optional(),
  notes: z.string().optional(),
  skillIds: z.array(z.string()),
  agentIds: z.array(z.string()),
  status: requiredEnum(THESIS_STATUSES),
});
export type ThesisFormValues = z.infer<typeof thesisFormSchema>;
