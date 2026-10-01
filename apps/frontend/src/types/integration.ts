import type { IntegrationKind, IntegrationStatus } from "@/lib/constants/status";
import type { ID, ISODate, ISODateTime, OfficeScoped } from "./common";

export interface Integration extends OfficeScoped {
  kind: IntegrationKind;
  /** Nome exibido. Para acompanhamento processual, o fornecedor ainda não foi definido. */
  name: string;
  status: IntegrationStatus;
  lastSyncAt?: ISODateTime;
  /** Pares rótulo/valor exibíveis. Nunca contém segredo. */
  details: { label: string; value: string }[];
  statusMessage?: string;
}

export interface AIUsageDaily {
  date: ISODate;
  /** Execuções de agentes no dia (métrica exibida na interface). */
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AIUsageByAgent {
  agentId: ID;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AIUsageByModel {
  model: string;
  runs: number;
  tokens: number;
  costUsd: number;
}

export interface AIUsage {
  officeId: ID;
  month: string;
  organization: string;
  primaryModel: string;
  /** Execuções no mês e limite operacional configurado no backend. A interface não exibe tokens nem custo. */
  runs: number;
  runLimit: number;
  /** Dados técnicos do provedor, mantidos para o backend (não exibidos). */
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  daily: AIUsageDaily[];
  byAgent: AIUsageByAgent[];
  byModel: AIUsageByModel[];
  lastSyncAt: ISODateTime;
}
