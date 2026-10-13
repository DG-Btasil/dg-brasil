"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { changePartnerShareAction, createPartnerAction, setPartnerStatusAction, updatePartnerAction } from "@/server/domain/organizations/actions";
import { useToast } from "@/store/ui-store";
import type { ID } from "@/types";

type Notice = { title: string; description?: string };

/** Cadastro e gestão de escritório parceiro no BACKEND (ADMIN). Banco primeiro; depois recarrega do servidor. */
export function usePartnerOfficeActions() {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();

  const run = useCallback(
    async <T>(call: () => Promise<ActionResult<T>>, success: Notice, failure: string, refresh = true): Promise<ActionResult<T>> => {
      const result = await callAction(call);
      if (!result.ok) {
        if (!result.error.fieldErrors) failed(result, failure);
        return result;
      }
      toast({ tone: "success", ...success });
      if (refresh) router.refresh();
      return result;
    },
    [failed, toast, router],
  );

  return useMemo(
    () => ({
      create: (input: Record<string, unknown>) =>
        run(
          () => createPartnerAction(input),
          { title: "Parceiro cadastrado", description: "Convide o responsável em Configurações → Equipe, escolhendo o escritório." },
          "Não foi possível cadastrar o parceiro.",
          false,
        ),
      update: (id: ID, patch: Record<string, unknown>) => run(() => updatePartnerAction({ id, patch }), { title: "Dados do parceiro atualizados" }, "Não foi possível salvar."),
      setStatus: (id: ID, status: "ACTIVE" | "SUSPENDED" | "INACTIVE") =>
        run(() => setPartnerStatusAction({ id, status }), { title: "Situação do parceiro atualizada" }, "Não foi possível alterar a situação."),
      changeShare: (id: ID, partnershipPercentage: number, ownerPercentage: number) =>
        run(
          () => changePartnerShareAction({ id, partnershipPercentage, ownerPercentage }),
          { title: "Divisão atualizada", description: "Vale para novos casos. Casos já aceitos mantêm o acordo original." },
          "Não foi possível alterar a divisão.",
        ),
    }),
    [run],
  );
}
