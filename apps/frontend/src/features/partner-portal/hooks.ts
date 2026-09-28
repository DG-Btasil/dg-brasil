"use client";

import { useCallback, useMemo } from "react";
import { daysSince } from "@/lib/clock";
import type { SubmissionStatus } from "@/lib/constants/status";
import { repositories } from "@/repositories";
import { useScopedStore } from "@/store/scope";
import type { PartnerCaseInput, PartnerClientBasicsPatch, PartnerDocumentInput, PartnerProcessInput } from "@/store/types";
import { useToast } from "@/store/ui-store";
import type { AuditEvent, Client, ClientDocument, ID, PartnerRequest, Process } from "@/types";
import { clientDisplayName } from "@/features/processes/utils";

/*
 * Hooks do Portal do Parceiro. Tudo vem do estado recortado para a sessão
 * (store/scope.ts): não há filtro por escritório aqui porque os dados de
 * outros escritórios simplesmente não chegam.
 */

export function usePortalClients(): Client[] {
  return useScopedStore((s) => s.clients);
}

export function usePortalProcesses(): Process[] {
  return useScopedStore((s) => s.processes);
}

export function usePortalDocuments(): ClientDocument[] {
  return useScopedStore((s) => s.documents);
}

export function usePortalRequests(): PartnerRequest[] {
  return useScopedStore((s) => s.partnerRequests);
}

export function usePortalClientMap(): Map<ID, Client> {
  const clients = usePortalClients();
  return useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
}

/** Situação mais recente do caso enviado para cada processo. */
export function useSubmissionStatusByProcess(): Map<ID, SubmissionStatus> {
  const submissions = useScopedStore((s) => s.partnerSubmissions);
  return useMemo(() => new Map(submissions.filter((s) => s.processId).map((s) => [s.processId as ID, s.status])), [submissions]);
}

export interface PortalClientRow {
  client: Client;
  name: string;
  processes: number;
  activeProcesses: number;
  openRequests: number;
  lastUpdate: string;
}

export function usePortalClientRows(): PortalClientRow[] {
  const clients = usePortalClients();
  const processes = usePortalProcesses();
  const requests = usePortalRequests();
  return useMemo(
    () =>
      clients.map((client) => {
        const own = processes.filter((p) => p.clientId === client.id);
        return {
          client,
          name: clientDisplayName(client),
          processes: own.length,
          activeProcesses: own.filter((p) => p.status !== "CLOSED").length,
          openRequests: requests.filter((r) => r.clientId === client.id && r.status === "OPEN").length,
          lastUpdate: [client.updatedAt, ...own.map((p) => p.lastMovementAt ?? p.updatedAt)].sort().reverse()[0] ?? client.updatedAt,
        };
      }),
    [clients, processes, requests],
  );
}

/** Documentos em versão vigente (as substituídas ficam no histórico). */
export function useCurrentDocuments(filter: { clientId?: ID; processId?: ID } = {}): ClientDocument[] {
  const documents = usePortalDocuments();
  const { clientId, processId } = filter;
  return useMemo(
    () =>
      documents
        .filter((d) => !d.supersededAt && (!clientId || d.clientId === clientId) && (!processId || d.processId === processId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [documents, clientId, processId],
  );
}

/** Versões anteriores de um documento (mesma família). */
export function useDocumentVersions(doc: ClientDocument): ClientDocument[] {
  const documents = usePortalDocuments();
  return useMemo(() => {
    const group = doc.versionGroupId ?? doc.id;
    return documents.filter((d) => (d.versionGroupId ?? d.id) === group).sort((a, b) => (b.version ?? 1) - (a.version ?? 1));
  }, [documents, doc]);
}

/* ------------------------------------------------------------------ */
/* Início                                                              */
/* ------------------------------------------------------------------ */

export interface PortalAttentionItem {
  id: string;
  title: string;
  context: string;
  href: string;
  cta: string;
  tone: "warning" | "info" | "orange";
}

/** "Precisa da sua atenção": pendências, cadastros incompletos e movimentações recentes. */
export function usePortalAttention(): PortalAttentionItem[] {
  const requests = usePortalRequests();
  const clients = usePortalClients();
  const clientMap = usePortalClientMap();
  const events = useScopedStore((s) => s.processEvents);
  const processes = usePortalProcesses();
  return useMemo(() => {
    const items: PortalAttentionItem[] = [];
    for (const r of requests) {
      if (r.status !== "OPEN") continue;
      const client = r.clientId ? clientMap.get(r.clientId) : undefined;
      items.push({
        id: `req-${r.id}`,
        title: r.type === "DOCUMENT_REQUEST" ? `Documento solicitado${client ? ` para ${clientDisplayName(client)}` : ""}.` : `Bárbara Cardoso Advocacia solicitou: ${r.title}.`,
        context: r.title,
        href: "/pendencias",
        cta: r.type === "DOCUMENT_REQUEST" ? "Enviar documento" : "Responder",
        tone: "warning",
      });
    }
    for (const c of clients) {
      const missing = !c.contact.phone || !c.contact.email || !c.address;
      if (missing) {
        items.push({
          id: `cad-${c.id}`,
          title: "Informação cadastral incompleta.",
          context: `${clientDisplayName(c)} · ${[!c.contact.phone && "telefone", !c.contact.email && "e-mail", !c.address && "endereço"].filter(Boolean).join(", ")}`,
          href: `/clientes/${c.id}`,
          cta: "Completar",
          tone: "orange",
        });
      }
    }
    const processMap = new Map(processes.map((p) => [p.id, p]));
    for (const e of events) {
      if (!e.important || daysSince(e.at) > 7) continue;
      const p = processMap.get(e.processId);
      if (!p) continue;
      items.push({
        id: `mov-${e.id}`,
        title: "Processo recebeu nova movimentação.",
        context: `${clientDisplayName(clientMap.get(p.clientId))} · ${e.title}`,
        href: `/processos/${p.id}?aba=movimentacoes`,
        cta: "Ver processo",
        tone: "info",
      });
    }
    return items;
  }, [requests, clients, clientMap, events, processes]);
}

/** Atualizações recentes: somente eventos com resumo seguro para o parceiro. */
export function usePortalUpdates(limit = 10): AuditEvent[] {
  const events = useScopedStore((s) => s.auditEvents);
  return useMemo(() => [...events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit), [events, limit]);
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */

function message(error: unknown) {
  return error instanceof Error && error.message ? error.message : undefined;
}

export function usePortalActions() {
  const toast = useToast();

  const run = useCallback(
    async <T>(fn: () => Promise<T>, success: { title: string; description?: string } | null, failure: string): Promise<T | null> => {
      try {
        const result = await fn();
        if (success) toast({ tone: "success", ...success });
        return result;
      } catch (error) {
        toast({ tone: "danger", title: failure, description: message(error) });
        return null;
      }
    },
    [toast],
  );

  return {
    lookupClient: (document: string) => run(() => repositories.partnerPortal.lookupClient(document), null, "Não foi possível verificar o CPF/CNPJ."),
    submitCase: (input: PartnerCaseInput) =>
      run(() => repositories.partnerPortal.submitCase(input), { title: "Enviado para Bárbara Cardoso Advocacia", description: "Você será notificado sobre o andamento." }, "Não foi possível enviar."),
    createProcess: (input: PartnerProcessInput) =>
      run(() => repositories.partnerPortal.createProcess(input), { title: "Processo cadastrado", description: input.title }, "Não foi possível cadastrar o processo."),
    updateClientBasics: (clientId: ID, patch: PartnerClientBasicsPatch) =>
      run(() => repositories.partnerPortal.updateClientBasics(clientId, patch), { title: "Dados atualizados" }, "Não foi possível salvar."),
    submitDocument: (input: PartnerDocumentInput) =>
      run(
        () => repositories.partnerPortal.submitDocument(input),
        { title: input.replacesDocumentId ? "Nova versão enviada" : "Documento enviado", description: input.replacesDocumentId ? "A versão anterior foi preservada." : input.name },
        "Não foi possível enviar o documento.",
      ),
    respondRequest: (requestId: ID, text: string) =>
      run(() => repositories.partnerPortal.respondRequest(requestId, text), { title: "Resposta enviada" }, "Não foi possível enviar a resposta."),
  };
}
