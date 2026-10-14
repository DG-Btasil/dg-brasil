"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { inactivateClientAction, reactivateClientAction, removeClientAction } from "@/server/domain/clients/actions";
import type { InactivateClientInput } from "@/store/types";
import { useToast } from "@/store/ui-store";
import type { Client } from "@/types";

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
