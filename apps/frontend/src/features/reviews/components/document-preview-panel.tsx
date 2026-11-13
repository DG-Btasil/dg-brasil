"use client";

import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { DocxPreview } from "@/components/documents/docx-preview";
import { ImagePreview } from "@/components/documents/image-preview";
import { PdfPreview } from "@/components/documents/pdf-preview";
import { editHintOf, imageMimeOf, MAX_PREVIEW_BYTES, previewKindOf, signatureMatches, type PreviewFile, type PreviewKind } from "@/components/documents/preview-rules";
import { Callout, ErrorState, SkeletonRows } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { formatBytes } from "@/features/documents/constants";
import { referenceCode } from "@/lib/actions/result";
import type { ID } from "@/types";
import { useDocumentFile, type DocumentFileResult } from "../use-document-file";
import { DownloadVersionButton } from "./download-version-button";

const PREVIEW_LIMIT_LABEL = `${Math.round(MAX_PREVIEW_BYTES / (1024 * 1024))} MB`;

interface Props {
  documentId: ID;
  versionId: ID;
  /** Título do documento, para os rótulos de acessibilidade. */
  title: string;
  file: PreviewFile;
}

/**
 * Prévia do arquivo em revisão (PDF, Word .docx e imagem), sem baixar: a
 * primeira página aparece na tela e o restante rola dentro da área. O arquivo
 * é lido UMA vez por versão aberta (o servidor registra o acesso). PDF e Word
 * não são editados aqui: para corrigir, baixa-se e envia-se a nova versão.
 */
export function DocumentPreviewPanel({ documentId, versionId, title, file }: Props) {
  const kind = previewKindOf(file);
  const { result, retry } = useDocumentFile(documentId, versionId, kind !== "NONE");
  const download = <DownloadVersionButton documentId={documentId} versionId={versionId} file={file} />;

  return (
    <Panel>
      <PanelHeader title="Prévia do arquivo" description={kind === "PDF" || kind === "DOCX" ? "Primeira página. Role dentro da prévia para ver o restante." : undefined} />
      <PanelBody className="space-y-3">
        <PreviewBody key={versionId} kind={kind} result={result} retry={retry} title={title} file={file} download={download} />
        <p className="text-[12.5px] text-muted">{editHintOf(file)}</p>
      </PanelBody>
    </Panel>
  );
}

function PreviewBody({ kind, result, retry, title, file, download }: { kind: PreviewKind; result: DocumentFileResult | null; retry: () => void; title: string; file: PreviewFile; download: ReactNode }) {
  if (kind === "NONE") {
    return (
      <Callout tone="neutral" title="Sem prévia para este formato." action={download}>
        Baixe o arquivo para ver.
      </Callout>
    );
  }
  if (!result) return <SkeletonRows rows={8} />;
  if (result.status === "ERROR") {
    const code = referenceCode(result.requestId);
    return (
      <ErrorState
        title="Não foi possível mostrar a prévia."
        description={
          <>
            {result.message}
            {code && <span className="mt-1 block text-[12px] text-subtle">Código de referência: {code}</span>}
          </>
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={retry}>
              Tentar de novo
            </Button>
            {download}
          </div>
        }
      />
    );
  }
  if (result.status === "TOO_LARGE") {
    return (
      <Callout tone="warning" title="Arquivo grande demais para a prévia" action={download}>
        {result.sizeBytes ? `Este arquivo tem ${formatBytes(result.sizeBytes)}. ` : ""}A prévia abre arquivos de até {PREVIEW_LIMIT_LABEL}. Baixe o arquivo para ver.
      </Callout>
    );
  }

  const unreadable = (
    <Callout tone="neutral" title="Não foi possível montar a prévia deste arquivo." action={download}>
      Baixe o arquivo para ver.
    </Callout>
  );
  // O formato declarado só escolhe o caminho: os bytes têm de confirmar.
  if (!signatureMatches(file, result.head)) return unreadable;

  const label = `Prévia de ${title}`;
  if (kind === "PDF") {
    return (
      <PdfPreview
        blob={result.blob}
        title={label}
        fallback={
          <Callout tone="neutral" title="Este navegador não mostra PDF dentro da página." action={download}>
            Baixe em PDF para ver.
          </Callout>
        }
      />
    );
  }
  if (kind === "DOCX") return <DocxPreview blob={result.blob} label={label} fallback={unreadable} />;
  const imageMime = imageMimeOf(file);
  return imageMime ? <ImagePreview blob={result.blob} mimeType={imageMime} alt={label} /> : unreadable;
}
