"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { inactivateClientAction, reactivateClientAction, removeClientAction } from "@/server/domain/clients/actions";
import { useScopedStore } from "@/store/scope";
import type { InactivateClientInput } from "@/store/types";
import { useToast } from "@/store/ui-store";
import type { AuditEvent, Client, ClientDocument, Deadline, ID, Process } from "@/types";
import { useCurrentPartnerOfficeId, useRole } from "@/features/auth/hooks";
import { defaultClientOrigin, getAllowedClientOrigins, originOfficeName, type ClientOriginOption, type OriginContext } from "@/lib/permissions/client-origin";

export function useClients(): Client[] {
  return useScopedStore((s) => s.clients);
}

export function useClient(id: ID | undefined): Client | undefined {
  const clients = useClients();
  return useMemo(() => clients.find((c) => c.id === id), [clients, id]);
}

export function useClientDocuments(clientId: ID | undefined): ClientDocument[] {
  const documents = useScopedStore((s) => s.documents);
  return useMemo(
    () => documents.filter((d) => d.clientId === clientId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [documents, clientId],
  );
}

export function useClientProcesses(clientId: ID): Process[] {
  const processes = useScopedStore((s) => s.processes);
  return useMemo(() => processes.filter((p) => p.clientId === clientId), [processes, clientId]);
}

/** Próximo prazo em aberto por processo do cliente. */
export function useNextDeadlineByProcess(clientId: ID): Map<ID, Deadline> {
  const deadlines = useScopedStore((s) => s.deadlines);
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
  const auditEvents = useScopedStore((s) => s.auditEvents);
  const documents = useScopedStore((s) => s.documents);
  const analyses = useScopedStore((s) => s.analyses);
  return useMemo(() => {
    const ids = new Set<ID>([clientId]);
    documents.filter((d) => d.clientId === clientId).forEach((d) => ids.add(d.id));
    analyses.filter((a) => a.clientId === clientId).forEach((a) => ids.add(a.id));
    return auditEvents.filter((e) => ids.has(e.entityId)).sort((a, b) => b.at.localeCompare(a.at));
  }, [auditEvents, documents, analyses, clientId]);
}

/**
 * Ações de ciclo de vida do cliente (inativar, reativar, excluir) no BACKEND,
 * com feedback. Banco primeiro: a tela só muda depois da resposta, recarregando
 * os dados do servidor (sem atualização otimista).
 */
export function useClientLifecycleActions() {
  const toast = useToast();
  const failed = useActionFeedback();
  const router = useRouter();

  const inactivate = useCallback(
    async (client: Client, input: InactivateClientInput): Promise<boolean> => {
      const result = await callAction(() => inactivateClientAction({ id: client.id, reason: input.reason, note: input.note ?? "" }));
      if (!result.ok) {
        failed(result, "Não foi possível inativar o cliente.");
        return false;
      }
      toast({ tone: "success", title: "Cliente inativado", description: "Continua pesquisável e com todo o histórico preservado." });
      router.refresh();
      return true;
    },
    [toast, failed, router],
  );

  const reactivate = useCallback(
    async (client: Client): Promise<boolean> => {
      const result = await callAction(() => reactivateClientAction({ id: client.id }));
      if (!result.ok) {
        failed(result, "Não foi possível reativar o cliente.");
        return false;
      }
      toast({ tone: "success", title: "Cliente reativado" });
      router.refresh();
      return true;
    },
    [toast, failed, router],
  );

  const remove = useCallback(
    async (client: Client): Promise<boolean> => {
      const result = await callAction(() => removeClientAction({ id: client.id }));
      if (!result.ok) {
        failed(result, "Não foi possível excluir o cliente.");
        return false;
      }
      const affected = result.data.affectedProcessIds.length;
      toast({
        tone: "warning",
        title: "Cliente excluído",
        description: affected
          ? `${affected === 1 ? "1 processo foi mantido" : `${affected} processos foram mantidos`} com vínculo pendente. Veja os alertas.`
          : "Nenhum processo estava vinculado.",
      });
      return true;
    },
    [toast, failed],
  );

  return { inactivate, reactivate, remove };
}

/* ------------------------------------------------------------------ */
/* Origem do cliente                                                   */
/* ------------------------------------------------------------------ */

/** Contexto da sessão para a regra central de origens (lib/permissions/client-origin). */
export function useClientOriginContext(): OriginContext {
  const role = useRole();
  const partnerOfficeId = useCurrentPartnerOfficeId();
  const office = useScopedStore((s) => s.office);
  const partners = useScopedStore((s) => s.partnerOffices);
  return useMemo(() => ({ role, partnerOfficeId, owner: office, partners }), [role, partnerOfficeId, office, partners]);
}

/**
 * Opções do Select "Origem do cliente". `current` mantém visível a origem já
 * gravada mesmo que ela não esteja mais entre as atribuíveis (ex.: parceiro inativo).
 */
export function useClientOriginOptions(current?: ID): ClientOriginOption[] {
  const ctx = useClientOriginContext();
  return useMemo(() => {
    const options = getAllowedClientOrigins(ctx);
    if (current && !options.some((o) => o.value === current)) {
      const label = originOfficeName(current, ctx.owner, ctx.partners);
      if (label) return [...options, { value: current, label }];
    }
    return options;
  }, [ctx, current]);
}

export function useDefaultClientOrigin(): ID {
  return defaultClientOrigin(useClientOriginContext());
}
