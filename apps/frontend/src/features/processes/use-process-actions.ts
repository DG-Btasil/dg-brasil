"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { createProcessEventAction, removeProcessAction } from "@/server/domain/processes/actions";
import {
  cancelDeadlineAction,
  completeDeadlineAction,
  createDeadlineAction,
  markDeadlineCheckedAction,
  markDeadlineMissedAction,
  reopenDeadlineAction,
  updateDeadlineAction,
} from "@/server/domain/processes/deadlines/actions";
import { useToast } from "@/store/ui-store";
import type { ID } from "@/types";

type Notice = { title: string; description?: string };

/**
 * Operações do processo (andamentos, prazos, exclusão) no BACKEND. Banco
 * primeiro: no sucesso, aviso + recarga dos dados do servidor; erro com
 * campos volta para o diálogo, os demais viram aviso com código de referência.
 */
export function useProcessActions() {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();

  const run = useCallback(
    async <T>(call: () => Promise<ActionResult<T>>, success: Notice, failure: string, options: { refresh?: boolean } = {}): Promise<ActionResult<T>> => {
      const result = await callAction(call);
      if (!result.ok) {
        if (!result.error.fieldErrors) failed(result, failure);
        return result;
      }
      toast({ tone: "success", ...success });
      if (options.refresh !== false) router.refresh();
      return result;
    },
    [failed, toast, router],
  );

  return useMemo(
    () => ({
      addEvent: (processId: ID, input: { title: string; description?: string; important: boolean }) =>
        run(() => createProcessEventAction({ processId, ...input }), { title: "Andamento registrado", description: input.title }, "Não foi possível registrar o andamento."),
      /** `idempotencyKey`: a mesma chave em nova tentativa do mesmo envio (o servidor não duplica o prazo). */
      addDeadline: (input: { idempotencyKey: string; legalCaseId: ID; processId?: ID; title: string } & Record<string, unknown>) =>
        run(() => createDeadlineAction(input), { title: "Prazo adicionado", description: input.title }, "Não foi possível adicionar o prazo."),
      updateDeadline: (id: ID, patch: Record<string, unknown>) => run(() => updateDeadlineAction({ id, patch }), { title: "Prazo atualizado" }, "Não foi possível atualizar o prazo."),
      completeDeadline: (id: ID, title: string) =>
        run(() => completeDeadlineAction({ id }), { title: "Prazo marcado como cumprido", description: title }, "Não foi possível atualizar o prazo."),
      cancelDeadline: (id: ID, title: string, reason: string) =>
        run(() => cancelDeadlineAction({ id, reason }), { title: "Prazo cancelado", description: title }, "Não foi possível cancelar o prazo."),
      missDeadline: (id: ID, title: string, reason?: string) =>
        run(() => markDeadlineMissedAction({ id, reason }), { title: "Prazo marcado como perdido", description: title }, "Não foi possível atualizar o prazo."),
      reopenDeadline: (id: ID, title: string, reason: string) =>
        run(() => reopenDeadlineAction({ id, reason }), { title: "Prazo reaberto", description: title }, "Não foi possível reabrir o prazo."),
      markDeadlineChecked: (id: ID, title: string) =>
        run(() => markDeadlineCheckedAction({ id }), { title: "Prazo conferido", description: title }, "Não foi possível registrar a conferência."),
      removeProcess: (id: ID) =>
        run(
          () => removeProcessAction({ id }),
          { title: "Processo excluído", description: "O caso e o cliente foram mantidos. A exclusão ficou registrada na auditoria." },
          "Não foi possível excluir o processo.",
          { refresh: false },
        ),
    }),
    [run],
  );
}
