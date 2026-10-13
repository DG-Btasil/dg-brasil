"use client";

import { useCallback } from "react";
import { useToast } from "@/store/ui-store";
import { referenceCode, type ActionError } from "./result";

/**
 * Aviso de falha de uma operação real: a mensagem segura do servidor e o
 * código de referência (requestId) para o suporte. Nunca detalhe técnico.
 */
export function useActionFeedback() {
  const toast = useToast();
  return useCallback(
    (result: ActionError, title = "Não foi possível concluir a operação.") => {
      const code = referenceCode(result.requestId);
      toast({ tone: "danger", title, description: code ? `${result.error.message} (ref. ${code})` : result.error.message });
    },
    [toast],
  );
}
