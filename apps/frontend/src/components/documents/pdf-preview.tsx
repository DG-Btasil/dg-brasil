"use client";

import { useCallback, type ReactNode } from "react";

/**
 * Primeira página de um PDF, no leitor de PDF do próprio navegador, a partir
 * dos bytes já carregados (URL de objeto local: nada é baixado de novo e
 * nenhum download é disparado). Role dentro da área para ver as outras páginas.
 *
 * Sem `sandbox` no iframe: o leitor de PDF do Chrome não abre em iframe
 * isolado. O conteúdo é sempre tratado como PDF (tipo fixado aqui e
 * assinatura conferida antes), nunca como HTML.
 */
export function PdfPreview({ blob, title, fallback }: { blob: Blob; title: string; fallback: ReactNode }) {
  // A URL nasce quando o iframe entra na tela e é revogada quando ele sai.
  const attach = useCallback(
    (frame: HTMLIFrameElement | null) => {
      if (!frame) return;
      const url = URL.createObjectURL(blob.slice(0, blob.size, "application/pdf"));
      frame.src = `${url}#page=1&view=FitH&toolbar=0&navpanes=0`;
      return () => {
        frame.removeAttribute("src");
        URL.revokeObjectURL(url);
      };
    },
    [blob],
  );

  // Navegador sem leitor de PDF embutido (ou configurado para baixar PDFs): abrir o iframe dispararia um download.
  if (typeof navigator !== "undefined" && navigator.pdfViewerEnabled === false) return <>{fallback}</>;

  return <iframe ref={attach} title={title} referrerPolicy="no-referrer" className="block aspect-[210/297] max-h-[80vh] min-h-[420px] w-full rounded-sm border border-line bg-surface-sunken" />;
}
