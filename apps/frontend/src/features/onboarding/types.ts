import type { ComponentType } from "react";

export type StepAnswers = Record<string, unknown>;

/** API mínima que cada etapa expõe ao assistente (aplicar sugestões). */
export interface StepFormApi {
  apply: (values: StepAnswers) => void;
}

export interface StepProps {
  /** id do <form>; os botões do rodapé do wizard usam `form={formId}`. */
  formId: string;
  answers: StepAnswers | undefined;
  onSave: (answers: StepAnswers) => Promise<void>;
  registerForm: (api: StepFormApi | null) => void;
  goToStep: (index: number) => void;
}

export type StepComponent = ComponentType<StepProps>;

export interface AgentQuestion {
  question: string;
  answer: string;
}

export interface AgentSuggestion {
  title: string;
  description: string;
  /** Valores aplicados ao formulário somente quando o usuário clica. */
  values: StepAnswers;
}

export interface AgentScript {
  intro: string;
  questions: AgentQuestion[];
  suggestion?: AgentSuggestion;
}

export type StepKey =
  | "identity"
  | "team"
  | "practice-areas"
  | "client-profile"
  | "legal-criteria"
  | "writing-style"
  | "workflow"
  | "approvals"
  | "communication"
  | "fee-models"
  | "integrations"
  | "agents-skills"
  | "review";

export interface StepConfig {
  key: StepKey;
  /** Rótulo curto do índice lateral. */
  label: string;
  /** Título serifado da etapa. */
  title: string;
  /** Por que a resposta importa para os agentes. */
  why: string;
  skippable: boolean;
  agent: AgentScript;
}
