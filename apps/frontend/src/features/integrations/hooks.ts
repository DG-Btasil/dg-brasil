"use client";

import { useCallback, useMemo } from "react";
import { INTEGRATION_STATUS_LABEL, type IntegrationStatus } from "@/lib/constants/status";
import { repositories } from "@/repositories";
import { useAppStore } from "@/store/app-store";
import { useToast } from "@/store/ui-store";
import { JUDICIAL_PROVIDERS } from "@/services/judicial-integration";
import type { JudicialSourceConfigInput } from "@/store/types";
import type { AIUsage, ID, Integration, JudicialSourceState } from "@/types";

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

/* ------------------------------------------------------------------ */
/* Integração Judicial                                                 */
/* ------------------------------------------------------------------ */

export function useJudicialSources(): JudicialSourceState[] {
  return useAppStore((s) => s.judicialSources);
}

export function useJudicialActions() {
  const toast = useToast();

  const configure = useCallback(
    async (source: JudicialSourceState, config: JudicialSourceConfigInput): Promise<boolean> => {
      try {
        await repositories.integrations.configureJudicialSource(source.id, config);
        toast({ tone: "success", title: `${JUDICIAL_PROVIDERS[source.source].name} configurado`, description: "Configuração simulada: nenhuma conexão real foi feita." });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível salvar a configuração." });
        return false;
      }
    },
    [toast],
  );

  const sync = useCallback(
    async (source: JudicialSourceState) => {
      try {
        const result = await repositories.integrations.syncJudicialSource(source.id);
        toast({
          tone: "success",
          title: `${JUDICIAL_PROVIDERS[source.source].name} sincronizado`,
          description: `${result.newItems} item(ns) novo(s) · simulação sem consulta externa.`,
        });
      } catch {
        toast({ tone: "danger", title: "Não foi possível sincronizar." });
      }
    },
    [toast],
  );

  return { configure, sync };
}
