"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import {
  cancelPaymentAction,
  cancelTransferAction,
  changeAgreementStatusAction,
  createFeeModelAction,
  createPaymentAction,
  createTransferAction,
  markTransferPaidAction,
  registerAdjustmentAction,
  registerReceiptAction,
  registerReversalAction,
  updateAgreementAction,
  updateFeeModelAction,
  updatePaymentAction,
} from "@/server/domain/finance/actions";
import { useToast } from "@/store/ui-store";

type Notice = { title: string; description?: string };

/**
 * Mutações do financeiro, SEMPRE pelo servidor (ADMIN). Sem UI otimista: a
 * tela recarrega depois da resposta. Lançamentos do ledger são append-only
 * (corrigir = estorno ou ajuste, nunca editar). As chaves de idempotência
 * vêm de quem chama (uma por intenção de envio).
 */
export function useFinanceActions(onDone?: () => void) {
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
      onDone?.();
      router.refresh();
      return result;
    },
    [failed, toast, router, onDone],
  );

  return useMemo(
    () => ({
      changeStatus: (id: string, to: "ACTIVE" | "COMPLETED" | "CANCELLED") =>
        run(
          () => changeAgreementStatusAction({ id, to }),
          { title: to === "ACTIVE" ? "Acordo ativado" : to === "COMPLETED" ? "Acordo concluído" : "Acordo cancelado" },
          "Não foi possível mudar a situação do acordo.",
        ),
      updateAgreement: (id: string, patch: Record<string, unknown>) =>
        run(() => updateAgreementAction({ id, patch }), { title: "Termos do acordo atualizados" }, "Não foi possível salvar o acordo."),
      createPayment: (input: Record<string, unknown>) => run(() => createPaymentAction(input), { title: "Obrigação registrada" }, "Não foi possível registrar a obrigação."),
      updatePayment: (id: string, patch: Record<string, unknown>) =>
        run(() => updatePaymentAction({ id, patch }), { title: "Obrigação atualizada" }, "Não foi possível atualizar a obrigação."),
      cancelPayment: (id: string, reason: string) => run(() => cancelPaymentAction({ id, reason }), { title: "Obrigação cancelada" }, "Não foi possível cancelar a obrigação."),
      registerReceipt: (input: Record<string, unknown>) =>
        run(() => registerReceiptAction(input), { title: "Recebimento registrado", description: "A divisão com o parceiro, quando houver, foi gerada pelo banco." }, "Não foi possível registrar o recebimento."),
      registerAdjustment: (input: Record<string, unknown>) => run(() => registerAdjustmentAction(input), { title: "Ajuste registrado" }, "Não foi possível registrar o ajuste."),
      registerReversal: (input: Record<string, unknown>) => run(() => registerReversalAction(input), { title: "Estorno registrado" }, "Não foi possível registrar o estorno."),
      createFeeModel: (input: Record<string, unknown>) => run(() => createFeeModelAction(input), { title: "Modelo de honorários criado" }, "Não foi possível criar o modelo."),
      updateFeeModel: (id: string, patch: Record<string, unknown>) =>
        run(() => updateFeeModelAction({ id, patch }), { title: "Modelo de honorários atualizado" }, "Não foi possível salvar o modelo."),
      createTransfer: (input: Record<string, unknown>) =>
        run(() => createTransferAction(input), { title: "Repasse registrado", description: "Registro interno — nenhuma transferência é feita pelo sistema." }, "Não foi possível registrar o repasse."),
      markTransferPaid: (id: string, reference?: string) =>
        run(() => markTransferPaidAction({ id, reference }), { title: "Repasse marcado como pago" }, "Não foi possível marcar o repasse como pago."),
      cancelTransfer: (id: string, reason: string) => run(() => cancelTransferAction({ id, reason }), { title: "Repasse cancelado" }, "Não foi possível cancelar o repasse."),
    }),
    [run],
  );
}
