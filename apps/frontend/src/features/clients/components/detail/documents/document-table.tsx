"use client";

import { useState } from "react";
import { CheckCircle2, CircleX, Eye, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { DOCUMENT_CATEGORY_LABEL, DOCUMENT_STATUS_LABEL, DOCUMENT_STATUS_TONE, type DocumentStatus } from "@/lib/constants/status";
import { formatDate } from "@/lib/formatting";
import { usePermission } from "@/features/auth/hooks";
import { repositories } from "@/repositories";
import { useToast } from "@/store/ui-store";
import type { ClientDocument } from "@/types";
import { DocumentPreviewDialog } from "./document-preview-dialog";
import { DocumentRejectDialog } from "./document-reject-dialog";
import { VerificationLabel } from "./document-status-icon";

export function DocumentTable({ documents }: { documents: ClientDocument[] }) {
  const canManage = usePermission("documents.manage");
  const toast = useToast();
  const [rejecting, setRejecting] = useState<ClientDocument | null>(null);
  const [previewing, setPreviewing] = useState<ClientDocument | null>(null);

  async function change(doc: ClientDocument, status: DocumentStatus, notes?: string) {
    await repositories.documents.updateStatus(doc.id, status, notes);
    toast({ tone: "success", title: "Documento atualizado", description: `“${doc.name}”: ${DOCUMENT_STATUS_LABEL[status].toLowerCase()}.` });
  }

  return (
    <>
      <Table caption="Documentos do cliente">
        <THead>
          <tr>
            <Th>Documento</Th>
            <Th>Categoria</Th>
            <Th>Data</Th>
            <Th>Status</Th>
            <Th>Verificação</Th>
            <Th>Notas</Th>
            <Th className="w-10">
              <span className="sr-only">Visualizar</span>
            </Th>
            {canManage && <Th className="text-right">Ações</Th>}
          </tr>
        </THead>
        <TBody>
          {documents.map((doc) => (
            <Tr key={doc.id}>
              <Td className="max-w-[280px]">
                <span className="block truncate font-medium text-foreground">{doc.name}</span>
                {doc.fileName && (
                  <span className="block truncate text-[12px] text-muted">
                    {doc.fileName}
                    {doc.sizeKb ? ` · ${doc.sizeKb} KB` : ""}
                  </span>
                )}
              </Td>
              <Td className="whitespace-nowrap text-[12.5px]">{DOCUMENT_CATEGORY_LABEL[doc.category]}</Td>
              <Td className="whitespace-nowrap tabular text-[12.5px] text-muted">{formatDate(doc.uploadedAt ?? doc.updatedAt)}</Td>
              <Td>
                <StatusBadge status={doc.status} labels={DOCUMENT_STATUS_LABEL} tones={DOCUMENT_STATUS_TONE} />
              </Td>
              <Td>
                <VerificationLabel verification={doc.verification} />
              </Td>
              <Td className="max-w-[240px] text-[12.5px] text-muted">{doc.notes ?? "—"}</Td>
              <Td className="text-right">
                {doc.status !== "MISSING" && doc.fileName && (
                  <IconButton size="sm" label={`Visualizar “${doc.name}”`} onClick={() => setPreviewing(doc)}>
                    <Eye className="size-4" aria-hidden />
                  </IconButton>
                )}
              </Td>
              {canManage && (
                <Td className="whitespace-nowrap text-right">
                  <div className="inline-flex items-center gap-1">
                    {doc.status !== "RECEIVED" && doc.status !== "MISSING" && (
                      <Button variant="ghost" size="sm" icon={<CheckCircle2 className="size-3.5" aria-hidden />} onClick={() => change(doc, "RECEIVED")} aria-label={`Verificar “${doc.name}” (marcar como verificado)`}>
                        Verificar
                      </Button>
                    )}
                    {doc.status !== "NEEDS_UPDATE" && doc.status !== "MISSING" && (
                      <Button variant="ghost" size="sm" icon={<RefreshCw className="size-3.5" aria-hidden />} onClick={() => change(doc, "NEEDS_UPDATE")} aria-label={`Solicitar atualização: “${doc.name}”`}>
                        Solicitar atualização
                      </Button>
                    )}
                    {doc.status !== "REJECTED" && doc.status !== "MISSING" && (
                      <Button variant="ghost" size="sm" icon={<CircleX className="size-3.5" aria-hidden />} onClick={() => setRejecting(doc)} aria-label={`Rejeitar “${doc.name}”`}>
                        Rejeitar
                      </Button>
                    )}
                  </div>
                </Td>
              )}
            </Tr>
          ))}
        </TBody>
      </Table>
      <DocumentPreviewDialog document={previewing} onClose={() => setPreviewing(null)} />
      <DocumentRejectDialog document={rejecting} onClose={() => setRejecting(null)} onConfirm={(doc, reason) => change(doc, "REJECTED", reason)} />
    </>
  );
}
