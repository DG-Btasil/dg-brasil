"use client";

import { Download, ExternalLink, FileText } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { NotAvailable } from "@/components/ui/tooltip";
import { DOCUMENT_CATEGORY_LABEL, DOCUMENT_STATUS_LABEL, DOCUMENT_STATUS_TONE } from "@/lib/constants/status";
import { formatDate } from "@/lib/formatting";
import type { ClientDocument } from "@/types";

/** Linhas cinzas que simulam texto na página de demonstração (sem nenhum conteúdo real). */
const PLACEHOLDER_LINES = [92, 100, 96, 88, 100, 74, 0, 100, 94, 98, 81, 0, 97, 100, 90, 62];

/**
 * Visualizador de documento. Hoje é um PDF PREVIEW SIMULADO: o protótipo guarda
 * só metadados, então a página exibida é um placeholder identificado, sem
 * dados pessoais. Com o storage do backend, o corpo passa a renderizar o
 * arquivo real a partir de uma URL temporária assinada, e "Abrir em nova aba"
 * e "Baixar" são habilitados.
 */
export function DocumentPreviewDialog({ document, onClose }: { document: ClientDocument | null; onClose: () => void }) {
  const doc = document;
  const meta = doc
    ? [
        { label: "Arquivo", value: doc.fileName ?? "—" },
        { label: "Categoria", value: DOCUMENT_CATEGORY_LABEL[doc.category] },
        { label: "Data", value: formatDate(doc.uploadedAt ?? doc.updatedAt) },
        { label: "Tamanho", value: doc.sizeKb ? `${doc.sizeKb} KB` : "—" },
      ]
    : [];

  return (
    <Dialog
      open={doc !== null}
      onOpenChange={(open) => !open && onClose()}
      size="xl"
      title={doc?.name ?? "Documento"}
      description="Pré-visualização do documento recebido."
      footer={
        <>
          <NotAvailable message="Disponível quando os arquivos estiverem no armazenamento seguro (backend)">
            <Button variant="secondary" icon={<Download className="size-4" aria-hidden />}>
              Baixar
            </Button>
          </NotAvailable>
          <NotAvailable message="Disponível quando o documento tiver uma URL real (backend)">
            <Button variant="secondary" icon={<ExternalLink className="size-4" aria-hidden />}>
              Abrir em nova aba
            </Button>
          </NotAvailable>
          <Button onClick={onClose}>Fechar</Button>
        </>
      }
    >
      {doc && (
        <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-5">
          <dl className="space-y-3 text-[13px]">
            {meta.map((m) => (
              <div key={m.label}>
                <dt className="text-[11.5px] uppercase tracking-[0.06em] text-subtle">{m.label}</dt>
                <dd className="mt-0.5 break-words text-foreground">{m.value}</dd>
              </div>
            ))}
            <div>
              <dt className="text-[11.5px] uppercase tracking-[0.06em] text-subtle">Status</dt>
              <dd className="mt-1">
                <StatusBadge status={doc.status} labels={DOCUMENT_STATUS_LABEL} tones={DOCUMENT_STATUS_TONE} />
              </dd>
            </div>
          </dl>

          <figure aria-label={`Pré-visualização simulada de ${doc.name}`} className="rounded-md border border-line bg-surface-sunken">
            <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <FileText className="size-3.5" aria-hidden />
                {doc.fileName ?? "documento.pdf"}
              </span>
              <span className="tabular">Página 1 de 1</span>
            </div>
            <div className="flex justify-center px-6 py-6">
              <div className="aspect-[1/1.414] w-full max-w-[440px] rounded-xs border border-line bg-white px-9 py-10 shadow-soft">
                <p className="rounded-xs border border-gold/40 bg-gold-50 px-2.5 py-1.5 text-center text-[11px] font-medium text-navy">
                  Documento de demonstração — pré-visualização simulada
                </p>
                <p className="mt-2 text-center text-[10.5px] text-muted">O arquivo real não é armazenado no protótipo. Nenhum dado pessoal é exibido.</p>
                <div className="mt-6 space-y-2" aria-hidden>
                  {PLACEHOLDER_LINES.map((w, i) => (w === 0 ? <div key={i} className="h-3" /> : <div key={i} className="h-2 rounded-full bg-line" style={{ width: `${w}%` }} />))}
                </div>
              </div>
            </div>
          </figure>
        </div>
      )}
    </Dialog>
  );
}
