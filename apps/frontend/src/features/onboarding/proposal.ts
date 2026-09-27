import { LEGAL_AREA_LABEL, type LegalArea } from "@/lib/constants/legal";
import type { Agent, LegalThesis, Skill } from "@/types";
import { FORMALITY_LABEL, LENGTH_LABEL } from "./labels";
import type { AgentsSkillsValues, ApprovalsValues, LegalCriteriaValues, PracticeAreasValues, WritingStyleValues } from "./schemas";
import type { StepAnswers } from "./types";

/** Montagem da proposta inicial (etapa 12) a partir das respostas anteriores. Funções puras. */

export interface ProposalInputs {
  practice?: Partial<PracticeAreasValues>;
  criteria?: Partial<LegalCriteriaValues>;
  writing?: Partial<WritingStyleValues>;
  approvals?: Partial<ApprovalsValues>;
}

export function readInputs(all: Record<string, StepAnswers>): ProposalInputs {
  return {
    practice: all["practice-areas"] as Partial<PracticeAreasValues> | undefined,
    criteria: all["legal-criteria"] as Partial<LegalCriteriaValues> | undefined,
    writing: all["writing-style"] as Partial<WritingStyleValues> | undefined,
    approvals: all["approvals"] as Partial<ApprovalsValues> | undefined,
  };
}

const AUTONOMY_RANK = { SUGGEST_ONLY: 0, REVIEW_REQUIRED: 1, AUTO_LOW_RISK: 2 } as const;

const BASE_RULES = [
  "Nunca executar ação externa sem confirmação humana.",
  "Não citar jurisprudência que não esteja cadastrada pelo escritório.",
];

export function defaultProposal(agents: Agent[], inputs: ProposalInputs): AgentsSkillsValues {
  const areas = inputs.practice?.areas ?? [];
  const areaRule = areas.length
    ? [`Não recomendar ação fora das áreas cadastradas: ${areas.map((a) => LEGAL_AREA_LABEL[a]).join(", ")}.`]
    : [];
  const rules = Array.from(new Set([...BASE_RULES, ...areaRule, ...(inputs.criteria?.agentRules ?? [])]));
  // Autonomia nunca acima da escolhida na etapa de Aprovações.
  const cap = inputs.approvals?.autonomy;
  return {
    agents: agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      enabled: a.status === "ACTIVE",
      autonomy: cap && AUTONOMY_RANK[a.autonomy] > AUTONOMY_RANK[cap] ? cap : a.autonomy,
    })),
    rules,
  };
}

export interface SkillProposal {
  skill: Skill;
  note?: string;
}

export function proposedSkills(skills: Skill[], inputs: ProposalInputs): SkillProposal[] {
  const w = inputs.writing;
  const style = w?.formality && w.length ? `${FORMALITY_LABEL[w.formality]}, extensão ${LENGTH_LABEL[w.length].toLowerCase()}` : undefined;
  return skills
    .filter((s) => s.status !== "DEPRECATED")
    .map((skill) => {
      const lower = skill.name.toLowerCase();
      if (style && (lower.includes("redação") || lower.includes("petição"))) return { skill, note: `Padrão de redação aplicado: ${style}.` };
      if (w?.files?.length && lower.includes("redação")) return { skill, note: `${w.files.length} peça(s) de referência registradas.` };
      if (lower.includes("conferência") && inputs.criteria?.minimumDocuments?.length)
        return { skill, note: `${inputs.criteria.minimumDocuments.length} documento(s) mínimo(s) definidos na etapa de critérios.` };
      return { skill };
    });
}

export function proposedTheses(theses: LegalThesis[], inputs: ProposalInputs): LegalThesis[] {
  const areas = new Set<LegalArea>(inputs.practice?.areas ?? []);
  return theses.filter((t) => t.status !== "ARCHIVED" && (areas.size === 0 || areas.has(t.area)));
}
