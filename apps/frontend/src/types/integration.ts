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
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AIUsageByAgent {
  agentId: ID;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AIUsageByModel {
  model: string;
  tokens: number;
  costUsd: number;
}

export interface AIUsage {
  officeId: ID;
  month: string;
  organization: string;
  primaryModel: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  daily: AIUsageDaily[];
  byAgent: AIUsageByAgent[];
  byModel: AIUsageByModel[];
  lastSyncAt: ISODateTime;
}
