"use client";

import { useMemo } from "react";
import { useScopedStore } from "@/store/scope";
import { useToast } from "@/store/ui-store";
import type { NewDeadlineInput, NewProcessInput } from "@/store/types";
import type { Client, ClientDocument, ID, LegalThesis, Process } from "@/types";

export { useToast };
export type { NewDeadlineInput, NewProcessInput };

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export function useProcesses(): Process[] {
  return useScopedStore((s) => s.processes);
}

export function useClients(): Client[] {
  return useScopedStore((s) => s.clients);
}

export function useClientMap(): Map<ID, Client> {
  const clients = useClients();
  return useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
}

export function useClientById(id: ID | undefined): Client | undefined {
  const clients = useClients();
  return useMemo(() => clients.find((c) => c.id === id), [clients, id]);
}

/** Documentos do processo e, separadamente, os demais documentos do cliente. */
export function useProcessDocuments(processId: ID, clientId: ID | undefined): { linked: ClientDocument[]; client: ClientDocument[] } {
  const documents = useScopedStore((s) => s.documents);
  return useMemo(
    () => ({
      linked: documents.filter((d) => d.processId === processId),
      client: documents.filter((d) => d.clientId === clientId && d.processId !== processId),
    }),
    [documents, processId, clientId],
  );
}

export function useThesis(id: ID | undefined): LegalThesis | undefined {
  const theses = useScopedStore((s) => s.theses);
  return useMemo(() => theses.find((t) => t.id === id), [theses, id]);
}

/* ------------------------------------------------------------------ */
/* Escrita (via repositórios)                                          */
/* ------------------------------------------------------------------ */


