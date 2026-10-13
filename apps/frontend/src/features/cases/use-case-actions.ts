"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import {
  acceptCaseAction,
  archiveCaseAction,
  assignCaseLawyerAction,
  changeCaseOriginAction,
  closeCaseAction,
  rejectCaseAction,
  startCaseAction,
  submitCaseAction,
  updateCaseAction,
} from "@/server/domain/cases/actions";
import { useToast } from "@/store/ui-store";
import type { ID } from "@/types";

type Notice = { title: string; description?: string };

/**
 * Operações do caso no BACKEND. Banco primeiro: nada muda na tela antes da
 * resposta; no sucesso, aviso + recarga dos dados do servidor (sem
 * atualização otimista — aceite/rejeição/origem são operações críticas).
 * Erro com campos (ex.: advogado obrigatório) volta para o diálogo mostrar
 * no campo; os demais viram aviso com código de referência.
 */
export function useCaseActions() {
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
      submit: (id: ID) => run(() => submitCaseAction({ id }), { title: "Caso enviado para análise" }, "Não foi possível enviar o caso."),
      accept: (id: ID, lawyerId?: ID) =>
        run(() => acceptCaseAction({ id, lawyerId }), { title: "Caso aceito", description: "Acordo de parceria criado quando a origem é parceiro." }, "Não foi possível aceitar o caso."),
      reject: (id: ID, input: { publicReason: string; internalNote?: string }) =>
        run(
          () => rejectCaseAction({ id, ...input }),
          { title: "Caso rejeitado", description: "Somente o motivo público é comunicado ao parceiro." },
          "Não foi possível rejeitar o caso.",
        ),
      start: (id: ID) => run(() => startCaseAction({ id }), { title: "Caso em andamento" }, "Não foi possível atualizar o caso."),
      close: (id: ID) => run(() => closeCaseAction({ id }), { title: "Caso encerrado" }, "Não foi possível encerrar o caso."),
      archive: (id: ID) => run(() => archiveCaseAction({ id }), { title: "Caso arquivado" }, "Não foi possível arquivar o caso."),
      assignLawyer: (id: ID, lawyerId: ID) => run(() => assignCaseLawyerAction({ id, lawyerId }), { title: "Advogado responsável definido" }, "Não foi possível definir o responsável."),
      changeOrigin: (id: ID, input: { originOrganizationId: ID; reason?: string; linkPartner: boolean }) =>
        run(
          () => changeCaseOriginAction({ id, ...input }),
          { title: "Origem do caso alterada", description: "A alteração ficou registrada na auditoria." },
          "Não foi possível alterar a origem.",
        ),
      update: (id: ID, patch: Record<string, unknown>) => run(() => updateCaseAction({ id, patch }), { title: "Caso atualizado" }, "Não foi possível salvar o caso."),
    }),
    [run],
  );
}
