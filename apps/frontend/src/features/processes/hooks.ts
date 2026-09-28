"use client";

import { useCallback, useMemo } from "react";
import { can } from "@/lib/permissions";
import { repositories } from "@/repositories";
import { useScopedStore } from "@/store/scope";
import { useToast } from "@/store/ui-store";
import type { NewDeadlineInput, NewProcessInput } from "@/store/types";
import type { Client, ClientDocument, Deadline, ID, LegalAnalysis, LegalThesis, Process, ProcessEvent, Review } from "@/types";

export { useToast };
export type { NewDeadlineInput, NewProcessInput };

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export function useProcesses(): Process[] {
  return useScopedStore((s) => s.processes);
}

export function useProcess(id: ID): Process | undefined {
  const processes = useProcesses();
  return useMemo(() => processes.find((p) => p.id === id), [processes, id]);
}

export function useAllDeadlines(): Deadline[] {
  return useScopedStore((s) => s.deadlines);
}

export function useProcessDeadlines(processId: ID): Deadline[] {
  const deadlines = useAllDeadlines();
  return useMemo(() => deadlines.filter((d) => d.processId === processId), [deadlines, processId]);
}

export function useProcessEvents(processId: ID): ProcessEvent[] {
  const events = useScopedStore((s) => s.processEvents);
  return useMemo(
    () => events.filter((e) => e.processId === processId).sort((a, b) => b.at.localeCompare(a.at)),
    [events, processId],
  );
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

export function useProcessReviews(processId: ID): Review[] {
  const reviews = useScopedStore((s) => s.reviews);
  return useMemo(
    () => reviews.filter((r) => r.processId === processId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [reviews, processId],
  );
}

export function useThesis(id: ID | undefined): LegalThesis | undefined {
  const theses = useScopedStore((s) => s.theses);
  return useMemo(() => theses.find((t) => t.id === id), [theses, id]);
}

export function useAnalysis(id: ID | undefined): LegalAnalysis | undefined {
  const analyses = useScopedStore((s) => s.analyses);
  return useMemo(() => analyses.find((a) => a.id === id), [analyses, id]);
}

/** Usuários ativos que podem conduzir processos (advogados e administradores). */
export function useLawyerOptions(): { value: ID; label: string }[] {
  const users = useScopedStore((s) => s.users);
  return useMemo(
    () => users.filter((u) => u.status === "ACTIVE" && can(u.role, "processes.edit")).map((u) => ({ value: u.id, label: u.name })),
    [users],
  );
}

/* ------------------------------------------------------------------ */
/* Escrita (via repositórios)                                          */
/* ------------------------------------------------------------------ */

export function useProcessActions() {
  const toast = useToast();

  const createProcess = useCallback(
    async (input: NewProcessInput): Promise<ID | null> => {
      try {
        const id = await repositories.processes.create({ ...input, origin: "MANUAL" });
        toast({ tone: "success", title: "Processo cadastrado", description: input.title });
        return id;
      } catch {
        toast({ tone: "danger", title: "Não foi possível cadastrar o processo." });
        return null;
      }
    },
    [toast],
  );

  const addEvent = useCallback(
    async (processId: ID, input: { title: string; description?: string; important?: boolean }): Promise<boolean> => {
      try {
        await repositories.processes.addEvent(processId, input);
        toast({ tone: "success", title: "Andamento registrado", description: input.title });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível registrar o andamento." });
        return false;
      }
    },
    [toast],
  );

  const addDeadline = useCallback(
    async (input: NewDeadlineInput): Promise<boolean> => {
      try {
        await repositories.processes.addDeadline(input);
        toast({ tone: "success", title: "Prazo adicionado", description: input.title });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível adicionar o prazo." });
        return false;
      }
    },
    [toast],
  );

  const completeDeadline = useCallback(
    async (deadline: Deadline): Promise<void> => {
      try {
        await repositories.processes.completeDeadline(deadline.id);
        toast({ tone: "success", title: "Prazo marcado como cumprido", description: deadline.title });
      } catch {
        toast({ tone: "danger", title: "Não foi possível atualizar o prazo." });
      }
    },
    [toast],
  );

  const deleteProcess = useCallback(
    async (process: Process): Promise<boolean> => {
      try {
        await repositories.processes.remove(process.id);
        toast({ tone: "success", title: "Processo excluído", description: "O cliente foi mantido. A exclusão ficou registrada na auditoria." });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível excluir o processo." });
        return false;
      }
    },
    [toast],
  );

  const linkClient = useCallback(
    async (processId: ID, clientId: ID): Promise<boolean> => {
      try {
        await repositories.processes.linkClient(processId, clientId);
        toast({ tone: "success", title: "Cliente vinculado", description: "O alerta de integridade foi resolvido." });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível vincular o cliente." });
        return false;
      }
    },
    [toast],
  );

  return { createProcess, addEvent, addDeadline, completeDeadline, deleteProcess, linkClient };
}

export interface ProcessDeletionImpact {
  reviews: number;
  openDeadlines: number;
  documents: number;
  /** Só é contado para quem pode ver o financeiro. */
  agreements: number;
}

/** O que existe associado ao processo, para avisar antes da exclusão. */
export function useProcessDeletionImpact(processId: ID, includeFinance: boolean): ProcessDeletionImpact {
  const reviews = useScopedStore((s) => s.reviews);
  const deadlines = useScopedStore((s) => s.deadlines);
  const documents = useScopedStore((s) => s.documents);
  const agreements = useScopedStore((s) => s.agreements);
  return useMemo(
    () => ({
      reviews: reviews.filter((r) => r.processId === processId).length,
      openDeadlines: deadlines.filter((d) => d.processId === processId && d.status === "OPEN").length,
      documents: documents.filter((d) => d.processId === processId).length,
      agreements: includeFinance ? agreements.filter((a) => a.processId === processId).length : 0,
    }),
    [reviews, deadlines, documents, agreements, processId, includeFinance],
  );
}
