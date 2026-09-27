import type { SkillChangeProposal } from "@/store/types";
import type { Agent, DiffLine, Skill } from "@/types";
import { dgRoutes } from "../utils";
import type { TutorMessage, TutorProposal } from "./tutor-store";

/**
 * Cenários pré-definidos do Tutor DG (demonstração).
 * Correspondência determinística por palavras-chave; a proposta é montada a
 * partir do valor ATUAL do parâmetro no store, para que versões e diferenças
 * reflitam aplicações anteriores.
 */

export interface TutorScenario {
  id: string;
  /** Pedido sugerido exibido como atalho. */
  prompt: string;
  /** Radicais normalizados (minúsculas, sem acento). */
  keywords: string[];
  /** A Skill é localizada pelo parâmetro que controla o comportamento. */
  parameterKey: string;
  targetValue: string;
  problemDetail: string;
  impact: string;
}

export const TUTOR_SCENARIOS: TutorScenario[] = [
  {
    id: "introducao",
    prompt: "Meu agente de petições está fazendo introduções muito longas.",
    keywords: ["introduc", "abertura", "prolix", "texto longo", "muito longa"],
    parameterKey: "extensao_introducao",
    targetValue: "Até 2 parágrafos, com contexto do cliente em uma frase",
    problemDetail: "Hoje o parâmetro “Extensão da introdução” permite textos mais longos do que o necessário.",
    impact: "As próximas minutas terão introduções mais curtas. Minutas já enviadas para Revisões não mudam.",
  },
  {
    id: "comprovante",
    prompt: "O agente está aceitando comprovantes de residência antigos demais.",
    keywords: ["comprovante", "residencia", "endereco", "antigo"],
    parameterKey: "validade_comprovante",
    targetValue: "60 dias, contados da data de emissão",
    problemDetail: "A validade aceita para o comprovante de residência está mais longa do que o critério desejado.",
    impact: "Comprovantes emitidos há mais de 60 dias passarão a ser apontados como pendência na conferência.",
  },
  {
    id: "prazos",
    prompt: "Quero ser avisado dos prazos com mais antecedência.",
    keywords: ["prazo", "alerta", "antecedencia", "aviso", "avisad", "lembrete"],
    parameterKey: "alerta",
    targetValue: "10 dias úteis, com lembrete adicional 2 dias úteis antes",
    problemDetail: "A antecedência atual do alerta de prazo é curta para a rotina do escritório.",
    impact: "Os alertas de prazo passarão a aparecer mais cedo nas notificações e na Home.",
  },
  {
    id: "comunicacao",
    prompt: "As mensagens para os clientes estão formais demais.",
    keywords: ["formal", "mensage", "tratamento", "cliente", "whatsapp", "rebuscad"],
    parameterKey: "tratamento",
    targetValue: "Primeiro nome, em tom cordial e direto",
    problemDetail: "A forma de tratamento definida deixa as mensagens distantes para o perfil dos clientes.",
    impact: "As próximas mensagens preparadas para clientes usarão tratamento mais próximo. Todas continuam passando por Revisões.",
  },
];

export const FALLBACK_TEXT =
  "Para recomendar um ajuste preciso, preciso de um pouco mais de detalhe: qual agente, em que tipo de tarefa e o que deveria acontecer no lugar. Nesta demonstração, estes são os cenários que consigo tratar:";

export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function matchScenario(text: string): TutorScenario | undefined {
  const input = normalize(text);
  let best: { scenario: TutorScenario; score: number } | undefined;
  for (const scenario of TUTOR_SCENARIOS) {
    const score = scenario.keywords.filter((k) => input.includes(k)).length;
    if (score > 0 && (!best || score > best.score)) best = { scenario, score };
  }
  return best?.scenario;
}

export function scenarioForSkill(skill: Skill): TutorScenario | undefined {
  return TUTOR_SCENARIOS.find((s) => skill.parameters.some((p) => p.key === s.parameterKey));
}

function buildDiff(skill: Skill, key: string, toValue: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const p of skill.parameters) {
    if (p.key === key) {
      lines.push({ type: "removed", text: `${p.label}: ${p.value}` });
      lines.push({ type: "added", text: `${p.label}: ${toValue}` });
    } else {
      lines.push({ type: "context", text: `${p.label}: ${p.value}` });
    }
  }
  return lines;
}

/** Resposta do Tutor para um pedido. Pura: não altera nada. */
export function respond(text: string, skills: Skill[], agents: Agent[]): Omit<TutorMessage, "id"> {
  const scenario = matchScenario(text);
  if (!scenario) {
    return { role: "tutor", text: FALLBACK_TEXT, suggestions: TUTOR_SCENARIOS.map((s) => s.prompt) };
  }
  const skill = skills.find((s) => s.parameters.some((p) => p.key === scenario.parameterKey));
  const param = skill?.parameters.find((p) => p.key === scenario.parameterKey);
  if (!skill || !param) {
    return { role: "tutor", text: "Não encontrei a Skill responsável por esse comportamento na configuração atual do escritório." };
  }
  if (param.value === scenario.targetValue) {
    return {
      role: "tutor",
      text: `Esse ajuste já está aplicado: na Skill “${skill.name}” (v${skill.version}), “${param.label}” já está definida como “${param.value}”. Se o comportamento persistir, descreva um exemplo concreto.`,
      links: [{ label: `Abrir Skill ${skill.name}`, href: dgRoutes.skill(skill.id) }],
    };
  }
  const affected = agents.filter((a) => a.skillIds.includes(skill.id));
  const proposal: SkillChangeProposal = {
    skillId: skill.id,
    originalRequest: text,
    problem: `Identifiquei que a Skill “${skill.name}” controla essa estrutura. ${scenario.problemDetail}`,
    suggestedChange: `Recomendo alterar ${param.label.toLowerCase()} de “${param.value}” para “${scenario.targetValue}”.`,
    impact: scenario.impact,
    affectedAgentIds: affected.map((a) => a.id),
    parameterChanges: [{ key: param.key, label: param.label, value: scenario.targetValue }],
    diff: buildDiff(skill, param.key, scenario.targetValue),
  };
  const tutorProposal: TutorProposal = {
    proposal,
    skillName: skill.name,
    parameterLabel: param.label,
    fromValue: param.value,
    toValue: scenario.targetValue,
    agentNames: affected.map((a) => a.name),
    state: "open",
  };
  return { role: "tutor", text: "Analisei a configuração atual e preparei uma proposta. Nada será alterado sem a sua confirmação.", proposal: tutorProposal };
}
