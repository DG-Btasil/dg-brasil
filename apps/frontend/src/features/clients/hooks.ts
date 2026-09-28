"use client";

import { useCallback, useMemo } from "react";
import type { AnalysisStatus } from "@/lib/constants/status";
import { repositories } from "@/repositories";
import { useAppStore } from "@/store/app-store";
import type { InactivateClientInput } from "@/store/types";
import { useToast } from "@/store/ui-store";
import type { AuditEvent, Client, ClientDocument, Deadline, ID, Process } from "@/types";
import { sortAnalysesByRecent } from "@/features/analyses/utils";
import { documentProgress, type DocumentProgress } from "./utils";

export function useClients(): Client[] {
  return useAppStore((s) => s.clients);
}

export function useClient(id: ID): Client | undefined {
  const clients = useClients();
  return useMemo(() => clients.find((c) => c.id === id), [clients, id]);
}

export function useClientDocuments(clientId: ID): ClientDocument[] {
  const documents = useAppStore((s) => s.documents);
  return useMemo(
    () => documents.filter((d) => d.clientId === clientId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [documents, clientId],
  );
}

export function useClientProcesses(clientId: ID): Process[] {
  const processes = useAppStore((s) => s.processes);
  return useMemo(() => processes.filter((p) => p.clientId === clientId), [processes, clientId]);
}

/** Próximo prazo em aberto por processo do cliente. */
export function useNextDeadlineByProcess(clientId: ID): Map<ID, Deadline> {
  const deadlines = useAppStore((s) => s.deadlines);
  return useMemo(() => {
    const map = new Map<ID, Deadline>();
    deadlines
      .filter((d) => d.clientId === clientId && d.status === "OPEN")
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .forEach((d) => {
        if (!map.has(d.processId)) map.set(d.processId, d);
      });
    return map;
  }, [deadlines, clientId]);
}

/** Eventos de auditoria do cliente, de seus documentos e análises. */
export function useClientActivity(clientId: ID): AuditEvent[] {
  const auditEvents = useAppStore((s) => s.auditEvents);
  const documents = useAppStore((s) => s.documents);
  const analyses = useAppStore((s) => s.analyses);
  return useMemo(() => {
    const ids = new Set<ID>([clientId]);
    documents.filter((d) => d.clientId === clientId).forEach((d) => ids.add(d.id));
    analyses.filter((a) => a.clientId === clientId).forEach((a) => ids.add(a.id));
    return auditEvents.filter((e) => ids.has(e.entityId)).sort((a, b) => b.at.localeCompare(a.at));
  }, [auditEvents, documents, analyses, clientId]);
}

/** Ações de ciclo de vida do cliente (inativar, reativar, excluir), com feedback. */
export function useClientLifecycleActions() {
  const toast = useToast();

  const inactivate = useCallback(
    async (client: Client, input: InactivateClientInput): Promise<boolean> => {
      try {
        await repositories.clients.inactivate(client.id, input);
        toast({ tone: "success", title: "Cliente inativado", description: "Continua pesquisável e com todo o histórico preservado." });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível inativar o cliente." });
        return false;
      }
    },
    [toast],
  );

  const reactivate = useCallback(
    async (client: Client): Promise<boolean> => {
      try {
        await repositories.clients.reactivate(client.id);
        toast({ tone: "success", title: "Cliente reativado" });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível reativar o cliente." });
        return false;
      }
    },
    [toast],
  );

  const remove = useCallback(
    async (client: Client): Promise<boolean> => {
      try {
        const { affectedProcessIds } = await repositories.clients.remove(client.id);
        toast({
          tone: "warning",
          title: "Cliente excluído",
          description: affectedProcessIds.length
            ? `${affectedProcessIds.length === 1 ? "1 processo foi mantido" : `${affectedProcessIds.length} processos foram mantidos`} com vínculo pendente. Veja os alertas.`
            : "Nenhum processo estava vinculado.",
        });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível excluir o cliente." });
        return false;
      }
    },
    [toast],
  );

  return { inactivate, reactivate, remove };
}

export interface ClientRow {
  client: Client;
  analysisStatus: AnalysisStatus | undefined;
  activeProcesses: number;
  documents: DocumentProgress;
}

/** Linhas da listagem de clientes, com os agregados de cada um. */
export function useClientRows(): ClientRow[] {
  const clients = useClients();
  const documents = useAppStore((s) => s.documents);
  const analyses = useAppStore((s) => s.analyses);
  const processes = useAppStore((s) => s.processes);
  return useMemo(() => {
    const docsBy = new Map<ID, ClientDocument[]>();
    documents.forEach((d) => docsBy.set(d.clientId, [...(docsBy.get(d.clientId) ?? []), d]));
    const latest = new Map<ID, AnalysisStatus>();
    sortAnalysesByRecent(analyses).forEach((a) => {
      if (!latest.has(a.clientId)) latest.set(a.clientId, a.status);
    });
    const activeCount = new Map<ID, number>();
    processes
      .filter((p) => p.status !== "CLOSED")
      .forEach((p) => activeCount.set(p.clientId, (activeCount.get(p.clientId) ?? 0) + 1));
    return clients.map((client) => ({
      client,
      analysisStatus: latest.get(client.id),
      activeProcesses: activeCount.get(client.id) ?? 0,
      documents: documentProgress(docsBy.get(client.id) ?? []),
    }));
  }, [clients, documents, analyses, processes]);
}
