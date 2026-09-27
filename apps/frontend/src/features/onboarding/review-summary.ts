import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { AGENT_AUTONOMY_LABEL, BILLING_MOMENT_LABEL, DOCUMENT_CATEGORY_LABEL, INTEGRATION_KIND_LABEL } from "@/lib/constants/status";
import { ROLE_LABEL } from "@/lib/permissions";
import { APPROVAL_ITEM_LABEL, CLIENT_MIX_LABEL, FORMALITY_LABEL, LENGTH_LABEL, LOCKED_APPROVAL_TEXT, TONE_LABEL } from "./labels";
import type {
  AgentsSkillsValues,
  ApprovalsValues,
  ClientProfileValues,
  CommunicationValues,
  FeeModelsValues,
  IdentityValues,
  IntegrationsValues,
  LegalCriteriaValues,
  PracticeAreasValues,
  TeamValues,
  WorkflowValues,
  WritingStyleValues,
} from "./schemas";
import type { StepAnswers, StepKey } from "./types";

export interface SummaryItem {
  label: string;
  value: string;
}

const join = (list: readonly string[] | undefined, empty = "—") => (list && list.length ? list.join(", ") : empty);
const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "—");
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** Resumo legível de uma etapa para a revisão final. */
export function summarizeStep(key: StepKey, raw: StepAnswers | undefined, userName: (id: string) => string): SummaryItem[] {
  if (!raw) return [];
  switch (key) {
    case "identity": {
      const v = raw as Partial<IdentityValues>;
      return [
        { label: "Escritório", value: txt(v.name) },
        { label: "Cidade/UF", value: v.city ? `${v.city}${v.state ? `/${v.state}` : ""}` : "—" },
        { label: "Responsável", value: v.principalLawyer ? `${v.principalLawyer}${v.oab ? ` · ${v.oab}` : ""}` : "—" },
        { label: "Estados de atuação", value: join(v.statesOfPractice) },
        { label: "Unidades", value: join(v.units?.map((u) => u.value).filter(Boolean)) },
      ];
    }
    case "team": {
      const v = raw as Partial<TeamValues>;
      const m = v.members ?? [];
      return [{ label: "Convites", value: m.length ? m.map((x) => `${x.name} (${ROLE_LABEL[x.role]})`).join(", ") : "Nenhum convite nesta etapa" }];
    }
    case "practice-areas": {
      const v = raw as Partial<PracticeAreasValues>;
      return [
        { label: "Áreas", value: join(v.areas?.map((a) => LEGAL_AREA_LABEL[a])) },
        { label: "Atuação principal", value: v.mainArea ? (LEGAL_AREA_LABEL[v.mainArea as keyof typeof LEGAL_AREA_LABEL] ?? v.mainArea) : "—" },
        { label: "Subáreas", value: join(v.subareas) },
        { label: "Tribunais", value: join(v.courts) },
      ];
    }
    case "client-profile": {
      const v = raw as Partial<ClientProfileValues>;
      return [
        { label: "Tipo de cliente", value: v.clientMix ? CLIENT_MIX_LABEL[v.clientMix] : "—" },
        { label: "Público-alvo", value: txt(v.targetAudience) },
        { label: "Canais de entrada", value: join(v.channels) },
        { label: "Não atende", value: txt(v.notServed) },
      ];
    }
    case "legal-criteria": {
      const v = raw as Partial<LegalCriteriaValues>;
      return [
        { label: "Critérios de aceite", value: txt(v.acceptanceCriteria) },
        { label: "Documentos mínimos", value: join(v.minimumDocuments?.map((d) => DOCUMENT_CATEGORY_LABEL[d])) },
        { label: "Regras para agentes", value: count(v.agentRules?.length ?? 0, "regra", "regras") },
      ];
    }
    case "writing-style": {
      const v = raw as Partial<WritingStyleValues>;
      return [
        { label: "Formalidade", value: v.formality ? FORMALITY_LABEL[v.formality] : "—" },
        { label: "Extensão", value: v.length ? LENGTH_LABEL[v.length] : "—" },
        { label: "Peças de referência", value: count(v.files?.length ?? 0, "arquivo registrado", "arquivos registrados") },
      ];
    }
    case "workflow": {
      const v = raw as Partial<WorkflowValues>;
      return [{ label: "Sequência", value: join(v.stages?.filter((s) => s.used).map((s) => s.label), "—").replaceAll(", ", " → ") }];
    }
    case "approvals": {
      const v = raw as Partial<ApprovalsValues>;
      return [
        { label: "Revisores", value: join(v.reviewerIds?.map(userName)) },
        { label: "Exige aprovação", value: [LOCKED_APPROVAL_TEXT, ...(v.requiresApproval ?? []).map((i) => APPROVAL_ITEM_LABEL[i])].join("; ") },
        { label: "Autonomia padrão", value: v.autonomy ? AGENT_AUTONOMY_LABEL[v.autonomy] : "—" },
      ];
    }
    case "communication": {
      const v = raw as Partial<CommunicationValues>;
      return [
        { label: "Tratamento", value: txt(v.clientTreatment) },
        { label: "Tom", value: v.tone ? TONE_LABEL[v.tone] : "—" },
        { label: "WhatsApp", value: v.whatsappEnabled === "YES" ? `Sim · ${txt(v.whatsappHours)}` : v.whatsappEnabled === "NO" ? "Não" : "—" },
        { label: "Canais preferidos", value: join(v.preferredChannels) },
      ];
    }
    case "fee-models": {
      const v = raw as Partial<FeeModelsValues>;
      const m = v.models ?? [];
      return [{ label: "Modelos", value: m.length ? m.map((x) => `${x.name} (${BILLING_MOMENT_LABEL[x.billingMoment]})`).join(", ") : "—" }];
    }
    case "integrations": {
      const v = raw as Partial<IntegrationsValues>;
      return [{ label: "Conectar depois", value: join(v.connectLater?.map((k) => INTEGRATION_KIND_LABEL[k]), "Nenhuma marcada") }];
    }
    case "agents-skills": {
      const v = raw as Partial<AgentsSkillsValues>;
      const on = (v.agents ?? []).filter((a) => a.enabled);
      return [
        { label: "Agentes ativos", value: join(on.map((a) => `${a.name} — ${AGENT_AUTONOMY_LABEL[a.autonomy]}`), "Nenhum") },
        { label: "Regras", value: count(v.rules?.length ?? 0, "regra", "regras") },
      ];
    }
    default:
      return [];
  }
}
