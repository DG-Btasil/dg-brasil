/**
 * Contrato do provedor de IA (Claude Platform / Claude Agent SDK).
 *
 * IMPORTANTE — segurança:
 * - Nenhuma chamada ao provedor sai do navegador. Todas passarão pelo
 *   backend TypeScript, que guarda a credencial do escritório criptografada.
 * - O navegador nunca recebe, armazena ou envia API key.
 * - A interface exibe apenas metadados (status, organização, consumo).
 */
import type { AIUsage, ID } from "@/types";

export interface AIConnectionStatus {
  connected: boolean;
  organization?: string;
  primaryModel?: string;
  lastSyncAt?: string;
}

export interface AIProviderService {
  getConnectionStatus(officeId: ID): Promise<AIConnectionStatus>;
  getUsage(officeId: ID, month: string): Promise<AIUsage>;
  /** Abre o fluxo de conexão no backend (ex.: formulário seguro servidor-a-servidor). */
  startConnectionFlow(officeId: ID): Promise<{ redirectUrl: string }>;
  disconnect(officeId: ID): Promise<void>;
}

/** Implementação de demonstração: lê os dados mockados já carregados. */
export function createMockAIProviderService(getUsage: () => AIUsage): AIProviderService {
  return {
    getConnectionStatus: async () => {
      const usage = getUsage();
      return { connected: true, organization: usage.organization, primaryModel: usage.primaryModel, lastSyncAt: usage.lastSyncAt };
    },
    getUsage: async () => getUsage(),
    startConnectionFlow: async () => {
      throw new Error("Conexão com a Claude Platform disponível em uma próxima etapa (backend).");
    },
    disconnect: async () => {
      throw new Error("Disponível em uma próxima etapa (backend).");
    },
  };
}
