import { AGENT_SCRIPTS } from "./agent-scripts";
import type { StepConfig, StepKey } from "./types";

type StepMeta = Omit<StepConfig, "agent">;

const META: StepMeta[] = [
  {
    key: "identity",
    label: "Identidade do escritório",
    title: "Identidade do escritório",
    why: "Os agentes usam estes dados em cabeçalhos de documentos e para saber em quais estados o escritório atua.",
    skippable: false,
  },
  {
    key: "team",
    label: "Equipe",
    title: "Equipe",
    why: "Define quem recebe tarefas, quem revisa o trabalho dos agentes e quem responde por cada área.",
    skippable: true,
  },
  {
    key: "practice-areas",
    label: "Áreas de atuação",
    title: "Áreas de atuação",
    why: "Delimita o escopo dos agentes: casos fora destas áreas são sinalizados para decisão humana.",
    skippable: false,
  },
  {
    key: "client-profile",
    label: "Perfil de clientes",
    title: "Perfil de clientes",
    why: "Ajusta a triagem inicial e a linguagem das comunicações ao público que o escritório atende.",
    skippable: true,
  },
  {
    key: "legal-criteria",
    label: "Critérios jurídicos",
    title: "Critérios jurídicos",
    why: "São as regras que a triagem aplica antes de recomendar qualquer caso. Nenhum agente as altera sem aprovação.",
    skippable: false,
  },
  {
    key: "writing-style",
    label: "Padrão de redação",
    title: "Padrão de redação",
    why: "Orienta as Skills de redação para que peças e mensagens reflitam o estilo do escritório.",
    skippable: true,
  },
  {
    key: "workflow",
    label: "Fluxo operacional",
    title: "Fluxo operacional",
    why: "Os agentes usam esta sequência para indicar em que ponto cada cliente está e qual é o próximo passo.",
    skippable: true,
  },
  {
    key: "approvals",
    label: "Aprovações",
    title: "Aprovações",
    why: "Estabelece o limite de autonomia dos agentes e quem confirma cada tipo de ação.",
    skippable: false,
  },
  {
    key: "communication",
    label: "Comunicação",
    title: "Comunicação com clientes",
    why: "Define tom, canais e horários usados nos rascunhos de mensagens, que sempre passam por revisão.",
    skippable: true,
  },
  {
    key: "fee-models",
    label: "Honorários",
    title: "Modelos de honorários",
    why: "Modelos prontos agilizam os acordos financeiros. Os valores ficam visíveis apenas para quem acessa o Financeiro.",
    skippable: true,
  },
  {
    key: "integrations",
    label: "Integrações",
    title: "Integrações",
    why: "Indica quais serviços o escritório pretende conectar. As conexões reais serão feitas por um backend seguro.",
    skippable: true,
  },
  {
    key: "agents-skills",
    label: "Agentes e Skills",
    title: "Agentes e Skills",
    why: "Com base nas respostas, estas serão as configurações iniciais do seu escritório.",
    skippable: false,
  },
  {
    key: "review",
    label: "Revisão final",
    title: "Revisão final",
    why: "Confira o que foi configurado antes de concluir a implantação.",
    skippable: false,
  },
];

export const ONBOARDING_STEPS: StepConfig[] = META.map((m) => ({ ...m, agent: AGENT_SCRIPTS[m.key] }));

export const TOTAL_STEPS = ONBOARDING_STEPS.length;
export const LAST_STEP_INDEX = TOTAL_STEPS - 1;

export function stepIndexOf(key: StepKey): number {
  return ONBOARDING_STEPS.findIndex((s) => s.key === key);
}

export function clampStep(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), LAST_STEP_INDEX);
}
