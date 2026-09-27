import { z } from "zod";
import { LEGAL_AREAS, BRAZILIAN_STATES } from "@/lib/constants/legal";
import { AGENT_AUTONOMY_LEVELS, BILLING_MOMENTS, DOCUMENT_CATEGORIES, INTEGRATION_KINDS } from "@/lib/constants/status";
import { ROLES } from "@/lib/permissions";
import {
  isCepFormat,
  isCnpjFormat,
  msg,
  parseCurrencyInput,
  zEmail,
  zPhone,
  zRequired,
} from "@/lib/validation";

/**
 * Schemas por etapa. Sem `transform`/`default`: entrada e saída têm o mesmo
 * tipo, o que mantém o React Hook Form simples e as respostas serializáveis.
 */

const text = () => z.string().trim();
const maxText = (n: number) => z.string().trim().max(n, `Use no máximo ${n} caracteres.`);
const optEmail = () => text().refine((v) => !v || z.email().safeParse(v).success, msg.email);
const currency = () =>
  text().refine((v) => !v || ((parseCurrencyInput(v) ?? -1) >= 0), "Informe um valor válido (ex.: 1.500,00).");
const intText = () => text().refine((v) => !v || /^\d{1,3}$/.test(v), "Informe um número inteiro.");
const percentText = () =>
  text().refine((v) => {
    if (!v) return true;
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 100;
  }, msg.percent);

export const listItem = z.object({ value: text() });

/* 1 — Identidade --------------------------------------------------------- */
export const identitySchema = z.object({
  name: zRequired("Informe o nome do escritório."),
  legalName: text(),
  cnpj: text().refine((v) => !v || isCnpjFormat(v), msg.cnpj),
  tradeName: text(),
  zipCode: text().refine((v) => !v || isCepFormat(v), msg.cep),
  street: text(),
  number: text(),
  complement: text(),
  district: text(),
  city: zRequired("Informe a cidade."),
  state: text().refine((v) => (BRAZILIAN_STATES as readonly string[]).includes(v), "Selecione a UF."),
  phone: zPhone(),
  email: zEmail(),
  website: text(),
  principalLawyer: zRequired("Informe o responsável principal."),
  oab: zRequired("Informe a OAB do responsável."),
  statesOfPractice: z.array(z.enum(BRAZILIAN_STATES)).min(1, "Selecione ao menos um estado de atuação."),
  units: z.array(listItem),
});
export type IdentityValues = z.infer<typeof identitySchema>;

/* 2 — Equipe --------------------------------------------------------------- */
export const teamSchema = z.object({
  members: z.array(
    z.object({
      name: zRequired("Informe o nome."),
      email: zEmail(),
      role: z.enum(ROLES),
      title: text(),
      areas: z.array(z.enum(LEGAL_AREAS)),
    }),
  ),
});
export type TeamValues = z.infer<typeof teamSchema>;

/* 3 — Áreas de atuação ---------------------------------------------------- */
export const practiceAreasSchema = z
  .object({
    areas: z.array(z.enum(LEGAL_AREAS)).min(1, "Selecione ao menos uma área."),
    subareas: z.array(z.string()),
    actionTypes: z.array(z.string()),
    mainArea: text(),
    regions: maxText(400),
    courts: z.array(z.string()),
    frequentCases: maxText(2000),
  })
  .superRefine((v, ctx) => {
    if (!v.mainArea) ctx.addIssue({ code: "custom", path: ["mainArea"], message: "Indique a atuação principal." });
    else if (!v.areas.includes(v.mainArea as (typeof LEGAL_AREAS)[number]))
      ctx.addIssue({ code: "custom", path: ["mainArea"], message: "A atuação principal precisa estar entre as áreas selecionadas." });
  });
export type PracticeAreasValues = z.infer<typeof practiceAreasSchema>;

/* 4 — Perfil de clientes -------------------------------------------------- */
export const CLIENT_MIX = ["INDIVIDUAL", "COMPANY", "BOTH"] as const;
export const clientProfileSchema = z.object({
  clientMix: z.enum(CLIENT_MIX),
  targetAudience: zRequired("Descreva o público-alvo."),
  recurringTraits: maxText(1000),
  regionsServed: maxText(400),
  caseProfile: maxText(1000),
  channels: z.array(z.string()),
  notServed: maxText(1000),
});
export type ClientProfileValues = z.infer<typeof clientProfileSchema>;

/* 5 — Critérios jurídicos ------------------------------------------------- */
export const legalCriteriaSchema = z.object({
  acceptanceCriteria: zRequired("Descreva os critérios para aceitar um caso."),
  minimumDocuments: z.array(z.enum(DOCUMENT_CATEGORIES)).min(1, "Selecione ao menos um documento mínimo."),
  mainTheses: maxText(2000),
  rejectionSituations: maxText(1500),
  preferredReferences: maxText(2000),
  restrictions: maxText(1500),
  agentRules: z.array(z.string()),
});
export type LegalCriteriaValues = z.infer<typeof legalCriteriaSchema>;

/* 6 — Padrão de redação --------------------------------------------------- */
export const FORMALITY_LEVELS = ["VERY_FORMAL", "FORMAL", "MODERATE"] as const;
export const TEXT_LENGTHS = ["CONCISE", "BALANCED", "DETAILED"] as const;
export const writingStyleSchema = z.object({
  formality: z.enum(FORMALITY_LEVELS),
  length: z.enum(TEXT_LENGTHS),
  structure: maxText(1000),
  style: maxText(1000),
  vocabulary: maxText(1000),
  argumentation: maxText(1000),
  addressForms: maxText(400),
  citationPreferences: maxText(1000),
  avoid: maxText(1000),
  files: z.array(z.object({ name: z.string(), sizeKb: z.number() })),
});
export type WritingStyleValues = z.infer<typeof writingStyleSchema>;

/* 7 — Fluxo operacional --------------------------------------------------- */
export const workflowSchema = z.object({
  stages: z
    .array(z.object({ key: z.string(), defaultLabel: z.string(), label: text(), used: z.boolean() }))
    .superRefine((stages, ctx) => {
      stages.forEach((s, i) => {
        if (s.used && !s.label) ctx.addIssue({ code: "custom", path: [i, "label"], message: "Dê um nome à etapa." });
      });
      if (!stages.some((s) => s.used)) ctx.addIssue({ code: "custom", path: [], message: "Mantenha ao menos uma etapa em uso." });
    }),
  notes: maxText(1500),
});
export type WorkflowValues = z.infer<typeof workflowSchema>;

/* 8 — Aprovações ---------------------------------------------------------- */
export const APPROVAL_ITEMS = ["PETITIONS", "CLIENT_MESSAGES", "DEADLINES", "SKILL_CHANGES", "THIRD_PARTY_DOCUMENTS", "NEW_CASES"] as const;
export const approvalsSchema = z.object({
  reviewerIds: z.array(z.string()).min(1, "Indique ao menos uma pessoa revisora."),
  requiresApproval: z.array(z.enum(APPROVAL_ITEMS)),
  responsibles: maxText(600),
  changeFlow: maxText(1000),
  autonomy: z.enum(AGENT_AUTONOMY_LEVELS),
});
export type ApprovalsValues = z.infer<typeof approvalsSchema>;

/* 9 — Comunicação --------------------------------------------------------- */
export const TONES = ["FORMAL_CORDIAL", "CLOSE_OBJECTIVE", "TECHNICAL"] as const;
export const communicationSchema = z
  .object({
    clientTreatment: zRequired("Indique como tratar os clientes."),
    tone: z.enum(TONES),
    whatsappEnabled: z.enum(["YES", "NO"]),
    whatsappHours: text(),
    emailUsage: maxText(600),
    frequentMessages: z.array(z.string()),
    signature: maxText(600),
    preferredChannels: z.array(z.string()),
    contactEmail: optEmail(),
  })
  .superRefine((v, ctx) => {
    if (v.whatsappEnabled === "YES" && !v.whatsappHours)
      ctx.addIssue({ code: "custom", path: ["whatsappHours"], message: "Informe o horário de atendimento pelo WhatsApp." });
  });
export type CommunicationValues = z.infer<typeof communicationSchema>;

/* 10 — Honorários --------------------------------------------------------- */
export const feeModelsSchema = z.object({
  models: z.array(
    z.object({
      createdId: z.string(),
      name: zRequired("Dê um nome ao modelo."),
      description: maxText(400),
      upfrontFee: currency(),
      fixedFee: currency(),
      installments: intText(),
      monthlyFee: currency(),
      successFeePercent: percentText(),
      billingMoment: z.enum(BILLING_MOMENTS),
    }),
  ),
});
export type FeeModelsValues = z.infer<typeof feeModelsSchema>;

/* 11 — Integrações -------------------------------------------------------- */
export const integrationsSchema = z.object({
  connectLater: z.array(z.enum(INTEGRATION_KINDS)),
  notes: maxText(1000),
});
export type IntegrationsValues = z.infer<typeof integrationsSchema>;

/* 12 — Agentes e Skills --------------------------------------------------- */
export const agentsSkillsSchema = z.object({
  agents: z.array(
    z.object({ agentId: z.string(), name: z.string(), enabled: z.boolean(), autonomy: z.enum(AGENT_AUTONOMY_LEVELS) }),
  ),
  rules: z.array(z.string()),
});
export type AgentsSkillsValues = z.infer<typeof agentsSkillsSchema>;

/** Mescla respostas salvas sobre os padrões, só nas chaves conhecidas. */
export function withDefaults<T extends object>(defaults: T, answers: Record<string, unknown> | undefined): T {
  if (!answers) return defaults;
  const out = { ...defaults } as Record<string, unknown>;
  for (const key of Object.keys(defaults)) {
    if (answers[key] !== undefined) out[key] = answers[key];
  }
  return out as T;
}
