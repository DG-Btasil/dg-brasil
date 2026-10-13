"use client";

import { useMemo } from "react";
import { daysSince } from "@/lib/clock";
import { useScopedStore } from "@/store/scope";
import type { AuditEvent, Client, ID, PartnerRequest, Process } from "@/types";
import { clientDisplayName } from "@/features/processes/utils";

/*
 * Hooks MOCK que restam do Portal do Parceiro: só o Início (Fase H) e o
 * Financeiro (Fase F) ainda os usam. Clientes, casos, processos, documentos e
 * pendências do portal já leem do servidor (Etapa 4.3, Fase D).
 */

export function usePortalClients(): Client[] {
  return useScopedStore((s) => s.clients);
}

export function usePortalProcesses(): Process[] {
  return useScopedStore((s) => s.processes);
}

export function usePortalRequests(): PartnerRequest[] {
  return useScopedStore((s) => s.partnerRequests);
}

export function usePortalClientMap(): Map<ID, Client> {
  const clients = usePortalClients();
  return useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
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
