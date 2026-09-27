"use client";

import { useCallback, useMemo } from "react";
import { INTEGRATION_STATUS_LABEL, type IntegrationStatus } from "@/lib/constants/status";
import { repositories } from "@/repositories";
import { useAppStore } from "@/store/app-store";
import { useToast } from "@/store/ui-store";
import type { AIUsage, ID, Integration } from "@/types";

export function useIntegrations(): Integration[] {
  return useAppStore((s) => s.integrations);
}

export function useAIUsage(): AIUsage {
  return useAppStore((s) => s.aiUsage);
}

/** Mapa id → nome do agente, para os gráficos de consumo. */
export function useAgentNameMap(): Map<ID, string> {
  const agents = useAppStore((s) => s.agents);
  return useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);
}

export function useIntegrationActions() {
  const toast = useToast();

  const setStatus = useCallback(
    async (integration: Integration, status: IntegrationStatus) => {
      try {
        await repositories.integrations.setStatus(integration.id, status);
        toast({ tone: "success", title: `${integration.name}: ${INTEGRATION_STATUS_LABEL[status].toLowerCase()}`, description: "Operação simulada nesta demonstração." });
      } catch {
        toast({ tone: "danger", title: "Não foi possível atualizar a integração." });
      }
    },
    [toast],
  );

  const sync = useCallback(
    async (integration: Integration) => {
      try {
        await repositories.integrations.sync(integration.id);
        toast({ tone: "success", title: "Sincronização concluída", description: `${integration.name} · simulação sem consulta externa.` });
      } catch {
        toast({ tone: "danger", title: "Não foi possível sincronizar." });
      }
    },
    [toast],
  );

  return { setStatus, sync };
}
