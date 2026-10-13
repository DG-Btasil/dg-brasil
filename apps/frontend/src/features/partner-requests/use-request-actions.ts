"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { addPartnerRequestMessageAction, closePartnerRequestAction, createPartnerRequestAction } from "@/server/domain/partner-requests/actions";
import { useToast } from "@/store/ui-store";
import type { ID } from "@/types";

type Notice = { title: string; description?: string };

/**
 * Solicitações ao parceiro no BACKEND (as duas superfícies). Banco primeiro:
 * a conversa só muda depois da resposta; erro com campos volta ao formulário.
 */
export function useRequestActions() {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();

  const run = useCallback(
    async <T>(call: () => Promise<ActionResult<T>>, success: Notice, failure: string): Promise<ActionResult<T>> => {
      const result = await callAction(call);
      if (!result.ok) {
        if (!result.error.fieldErrors) failed(result, failure);
        return result;
      }
      toast({ tone: "success", ...success });
      router.refresh();
      return result;
    },
    [failed, toast, router],
  );

  return useMemo(
    () => ({
      create: (input: { legalCaseId: ID; type: string; title: string; description?: string; dueDate?: string }) =>
        run(() => createPartnerRequestAction(input), { title: "Solicitação enviada ao parceiro", description: input.title }, "Não foi possível criar a solicitação."),
      message: (requestId: ID, message: string, reopen = false) =>
        run(
          () => addPartnerRequestMessageAction({ requestId, message, reopen }),
          { title: reopen ? "Nova resposta pedida ao parceiro" : "Mensagem enviada" },
          "Não foi possível enviar a mensagem.",
        ),
      close: (id: ID, resolution: "RESOLVED" | "CANCELLED") =>
        run(() => closePartnerRequestAction({ id, resolution }), { title: resolution === "RESOLVED" ? "Solicitação resolvida" : "Solicitação cancelada" }, "Não foi possível encerrar a solicitação."),
    }),
    [run],
  );
}
