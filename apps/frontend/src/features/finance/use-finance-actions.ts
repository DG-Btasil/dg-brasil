"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import {
  cancelExpenseAction,
  cancelPaymentAction,
  cancelTransferAction,
  changeAgreementStatusAction,
  createExpenseAction,
  createFeeModelAction,
  createPaymentAction,
  createPaymentScheduleAction,
  createTransferAction,
  markTransferPaidAction,
  registerAdjustmentAction,
  registerReceiptAction,
  registerReversalAction,
  reopenAgreementAction,
  updateAgreementAction,
  updateExpenseAction,
  updateFeeModelAction,
  updatePaymentAction,
} from "@/server/domain/finance/actions";
import { useToast } from "@/store/ui-store";

type Notice = { title: string; description?: string };

/**
 * Mutações do financeiro, SEMPRE pelo servidor (ADMIN). Sem UI otimista: a
 * tela recarrega depois da resposta. Lançamentos do ledger são append-only
 * (corrigir = estorno ou ajuste, nunca editar). As chaves de idempotência
 * vêm de quem chama (uma por intenção de envio). Os textos usam "contrato" e
 * "parcela" (o que a pessoa lê), mesmo com `agreement`/`payment` no código.
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
          { title: to === "ACTIVE" ? "Contrato ativado" : to === "COMPLETED" ? "Contrato concluído" : "Contrato cancelado" },
          "Não foi possível mudar a situação do contrato.",
        ),
      reopenAgreement: (id: string, reason: string) =>
        run(
          () => reopenAgreementAction({ id, reason }),
          { title: "Contrato reaberto", description: "Ele voltou a ficar ativo. Quando terminar a correção, conclua de novo." },
          "Não foi possível reabrir o contrato.",
        ),
      updateAgreement: (id: string, patch: Record<string, unknown>) =>
        run(() => updateAgreementAction({ id, patch }), { title: "Valores do contrato atualizados" }, "Não foi possível salvar o contrato."),
      createPayment: (input: Record<string, unknown>) => run(() => createPaymentAction(input), { title: "Parcela registrada" }, "Não foi possível registrar a parcela."),
      createSchedule: (input: Record<string, unknown>) =>
        run(
          () => createPaymentScheduleAction(input),
          { title: "Cronograma gerado", description: "As parcelas foram criadas juntas, com centavos exatos. Recebimentos continuam sendo registrados um a um." },
          "Não foi possível gerar o cronograma.",
        ),
      updatePayment: (id: string, patch: Record<string, unknown>) =>
        run(() => updatePaymentAction({ id, patch }), { title: "Parcela atualizada" }, "Não foi possível atualizar a parcela."),
      cancelPayment: (id: string, reason: string) => run(() => cancelPaymentAction({ id, reason }), { title: "Parcela cancelada" }, "Não foi possível cancelar a parcela."),
      registerReceipt: (input: Record<string, unknown>) =>
        run(() => registerReceiptAction(input), { title: "Recebimento registrado", description: "A divisão com o parceiro, quando houver, foi calculada pelo sistema." }, "Não foi possível registrar o recebimento."),
      registerAdjustment: (input: Record<string, unknown>) => run(() => registerAdjustmentAction(input), { title: "Ajuste registrado" }, "Não foi possível registrar o ajuste."),
      registerReversal: (input: Record<string, unknown>) => run(() => registerReversalAction(input), { title: "Estorno registrado" }, "Não foi possível registrar o estorno."),
      createFeeModel: (input: Record<string, unknown>) => run(() => createFeeModelAction(input), { title: "Modelo de honorários criado" }, "Não foi possível criar o modelo."),
      updateFeeModel: (id: string, patch: Record<string, unknown>) =>
        run(() => updateFeeModelAction({ id, patch }), { title: "Modelo de honorários atualizado" }, "Não foi possível salvar o modelo."),
      createTransfer: (input: Record<string, unknown>) =>
        run(() => createTransferAction(input), { title: "Repasse registrado", description: "É só um registro: o sistema não faz a transferência." }, "Não foi possível registrar o repasse."),
      markTransferPaid: (id: string, reference?: string) =>
        run(
          () => markTransferPaidAction({ id, reference }),
          { title: "Repasse marcado como pago", description: "O valor saiu de “em repasse” e entrou em “repassado”." },
          "Não foi possível marcar o repasse como pago.",
        ),
      cancelTransfer: (id: string, reason: string) => run(() => cancelTransferAction({ id, reason }), { title: "Repasse cancelado" }, "Não foi possível cancelar o repasse."),
      createExpense: (input: Record<string, unknown>) => run(() => createExpenseAction(input), { title: "Despesa lançada" }, "Não foi possível lançar a despesa."),
      updateExpense: (id: string, patch: Record<string, unknown>) => run(() => updateExpenseAction({ id, patch }), { title: "Despesa atualizada" }, "Não foi possível salvar a despesa."),
      markExpensePaid: (id: string, paidOn: string) =>
        run(() => updateExpenseAction({ id, patch: { paidOn } }), { title: "Despesa marcada como paga" }, "Não foi possível marcar a despesa como paga."),
      cancelExpense: (id: string, reason: string) =>
        run(() => cancelExpenseAction({ id, reason }), { title: "Despesa cancelada", description: "Ela continua no histórico, com o motivo." }, "Não foi possível cancelar a despesa."),
    }),
    [run],
  );
}
