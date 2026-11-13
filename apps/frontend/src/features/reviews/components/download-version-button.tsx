"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { downloadLabelOf, type PreviewFile } from "@/components/documents/preview-rules";
import { Button } from "@/components/ui/button";
import { useDocumentActions } from "@/features/documents/use-document-actions";
import type { ID } from "@/types";

/**
 * Baixar a versão em revisão. O rótulo diz o formato real do arquivo ("Baixar
 * em Word", "Baixar em PDF", "Baixar arquivo (XLSX)"); não há conversão.
 * O download passa pelo servidor, que autoriza e registra o acesso.
 */
export function DownloadVersionButton({ documentId, versionId, file }: { documentId: ID; versionId: ID; file: PreviewFile }) {
  const docs = useDocumentActions();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={<Download className="size-3.5" aria-hidden />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await docs.download(documentId, versionId);
        setBusy(false);
      }}
    >
      {downloadLabelOf(file)}
    </Button>
  );
}
