"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { usePermission } from "@/features/auth/hooks";
import { csvBlob } from "@/features/data-import/csv-blob";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { formatNumber, pluralize } from "@/lib/formatting";
import type { ExportFileDTO } from "@/server/domain/exports/service";
import { useToast } from "@/store/ui-store";

/** Server Action de exportação de uma lista: recebe a MESMA entrada da listagem. */
export type ExportAction = (input: unknown) => Promise<ActionResult<ExportFileDTO>>;

/** Baixa o CSV no navegador, com o BOM UTF-8 que o Excel em português precisa. */
export function downloadCsv(fileName: string, content: string) {
  const url = URL.createObjectURL(csvBlob(content));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Aviso depois da exportação: quantas linhas saíram e, se o limite cortou, o que fazer. */
export function exportNotice(file: Pick<ExportFileDTO, "rowCount" | "total" | "truncated" | "limit">): { tone: "success" | "warning"; title: string; description: string } {
  if (file.truncated) {
    return {
      tone: "warning",
      title: "Planilha exportada pela metade",
      description: `Saíram as primeiras ${formatNumber(file.rowCount)} de ${formatNumber(file.total)} linhas (o limite é ${formatNumber(file.limit)} por arquivo). Use os filtros para exportar o restante em partes.`,
    };
  }
  return {
    tone: "success",
    title: "Planilha exportada",
    description: file.rowCount === 0 ? "Nenhuma linha com os filtros atuais: o arquivo saiu só com os títulos." : `${pluralize(file.rowCount, "linha", "linhas")}. A exportação ficou registrada na auditoria.`,
  };
}

/**
 * Botão "Exportar planilha" das listas. Só aparece para quem tem
 * `data.export` (ADMIN); o servidor confere de novo, aplica o limite de linhas
 * e registra a exportação na auditoria.
 *
 * `action` é a Server Action de exportação da lista e `input` é a MESMA
 * entrada da listagem (filtros e ordem da tela) — ver docs/backend.md.
 */
export function ExportButton({
  action,
  input,
  label = "Exportar planilha",
  variant = "secondary",
  size = "md",
}: {
  action: ExportAction;
  input: Record<string, unknown>;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const allowed = usePermission("data.export");
  const toast = useToast();
  const failed = useActionFeedback();
  const [busy, setBusy] = useState(false);
  if (!allowed) return null;

  async function run() {
    setBusy(true);
    const result = await callAction(() => action(input));
    setBusy(false);
    if (!result.ok) {
      failed(result, "Não foi possível exportar a planilha.");
      return;
    }
    downloadCsv(result.data.fileName, result.data.content);
    toast(exportNotice(result.data));
  }

  return (
    <Button
      variant={variant}
      size={size}
      icon={<Download className="size-4" aria-hidden />}
      loading={busy}
      onClick={run}
      title="Baixa em planilha o que os filtros mostram. A exportação fica registrada na auditoria."
    >
      {label}
    </Button>
  );
}
