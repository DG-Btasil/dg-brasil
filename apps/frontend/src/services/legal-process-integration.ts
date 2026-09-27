/**
 * Contrato da integração processual futura.
 *
 * O fornecedor (plataforma externa consultada por OAB) ainda não foi
 * definido. Por isso a interface é genérica: "Provedor de acompanhamento
 * processual". A implementação concreta viverá no backend, que fará a
 * sincronização periódica (jobs) e gravará processos com origin = INTEGRATION.
 */
import type { ID, Process, ProcessEvent } from "@/types";

export interface LegalProcessSyncResult {
  syncedAt: string;
  processesFound: number;
  newMovements: number;
}

export interface LegalProcessIntegration {
  /** Identificador interno do provedor (definido quando o fornecedor for escolhido). */
  readonly providerKey: string;
  connect(officeId: ID, oab: string): Promise<void>;
  disconnect(officeId: ID): Promise<void>;
  sync(officeId: ID): Promise<LegalProcessSyncResult>;
  listProcesses(officeId: ID): Promise<Process[]>;
  listMovements(officeId: ID, processId: ID): Promise<ProcessEvent[]>;
}

/** Placeholder explícito: nenhum provedor real conectado nesta etapa. */
export const unconfiguredLegalProcessIntegration: LegalProcessIntegration = {
  providerKey: "unconfigured",
  connect: async () => {
    throw new Error("Provedor de acompanhamento processual ainda não definido.");
  },
  disconnect: async () => {
    throw new Error("Provedor de acompanhamento processual ainda não definido.");
  },
  sync: async () => {
    throw new Error("Provedor de acompanhamento processual ainda não definido.");
  },
  listProcesses: async () => [],
  listMovements: async () => [],
};
