"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import type { DocumentVisibility } from "@/lib/constants/status";
import {
  downloadDocumentAction,
  removeDocumentAction,
  setDocumentArchivedAction,
  setDocumentVisibilityAction,
  verifyDocumentVersionAction,
} from "@/server/domain/documents/actions";
import {
  approveRequirementAction,
  createRequirementAction,
  rejectRequirementAction,
  requestRequirementAction,
  satisfyRequirementAction,
} from "@/server/domain/documents/requirements/actions";
import { useToast } from "@/store/ui-store";
import type { ID } from "@/types";

type Notice = { title: string; description?: string };

/**
 * Operações de documento e de pendência no BACKEND. Banco primeiro: no
 * sucesso, aviso + recarga dos dados do servidor; erro com campos volta para
 * o diálogo, os demais viram aviso com código de referência.
 */
export function useDocumentActions() {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();

  const run = useCallback(
    async <T>(call: () => Promise<ActionResult<T>>, success: Notice | null, failure: string): Promise<ActionResult<T>> => {
      const result = await callAction(call);
      if (!result.ok) {
        if (!result.error.fieldErrors) failed(result, failure);
        return result;
      }
      if (success) toast({ tone: "success", ...success });
      router.refresh();
      return result;
    },
    [failed, toast, router],
  );

  /**
   * Download: o servidor autoriza (banco), registra o acesso (LGPD +
   * auditoria) e devolve uma URL assinada de 60 s. O navegador nunca monta
   * caminho de Storage; a URL não é guardada nem exibida.
   */
  const download = useCallback(
    async (documentId: ID, versionId?: ID): Promise<boolean> => {
      const result = await callAction(() => downloadDocumentAction({ documentId, versionId }));
      if (!result.ok) {
        failed(result, "Não foi possível baixar o arquivo.");
        return false;
      }
      const link = document.createElement("a");
      link.href = result.data.url;
      link.rel = "noopener noreferrer";
      link.click();
      return true;
    },
    [failed],
  );

  return useMemo(
    () => ({
      download,
      verify: (versionId: ID, status: "VERIFIED" | "FAILED", notes?: string) =>
        run(
          () => verifyDocumentVersionAction({ versionId, status, notes: notes ?? "" }),
          { title: status === "VERIFIED" ? "Arquivo verificado" : "Divergência registrada" },
          "Não foi possível registrar a verificação.",
        ),
      setVisibility: (id: ID, visibility: DocumentVisibility) =>
        run(
          () => setDocumentVisibilityAction({ id, visibility }),
          { title: visibility === "PARTNER_VISIBLE" ? "Documento compartilhado com o parceiro" : "Documento recolhido (somente interno)" },
          "Não foi possível alterar a visibilidade.",
        ),
      setArchived: (id: ID, archived: boolean) =>
        run(() => setDocumentArchivedAction({ id, archived }), { title: archived ? "Documento arquivado" : "Documento reativado" }, "Não foi possível atualizar o documento."),
      remove: (id: ID) => run(() => removeDocumentAction({ id }), { title: "Documento excluído", description: "As versões ficam no histórico." }, "Não foi possível excluir o documento."),
      createRequirement: (input: { legalCaseId: ID; label: string; category: string; required: boolean; requestNow: boolean }) =>
        run(() => createRequirementAction(input), { title: "Pendência registrada" }, "Não foi possível registrar a pendência."),
      requestRequirement: (id: ID) => run(() => requestRequirementAction({ id }), { title: "Documento solicitado" }, "Não foi possível solicitar o documento."),
      satisfyRequirement: (id: ID, documentVersionId: ID) =>
        run(() => satisfyRequirementAction({ id, documentVersionId }), { title: "Pendência atendida", description: "Aguardando aprovação." }, "Não foi possível atender a pendência."),
      approveRequirement: (id: ID) => run(() => approveRequirementAction({ id }), { title: "Documento aprovado" }, "Não foi possível aprovar."),
      rejectRequirement: (id: ID) => run(() => rejectRequirementAction({ id }), { title: "Documento rejeitado", description: "Solicite de novo quando precisar." }, "Não foi possível rejeitar."),
    }),
    [download, run],
  );
}
