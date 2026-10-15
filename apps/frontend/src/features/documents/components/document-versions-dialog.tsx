"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { formatDateTime } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getDocumentAction } from "@/server/domain/documents/actions";
import type { DocumentApprovalStatus, DocumentDetailDTO, DocumentVersionInternalDTO } from "@/server/domain/documents/dto";
import { VerificationLabel } from "@/features/clients/components/detail/documents/document-status-icon";
import { formatBytes } from "../constants";
import { useDocumentActions } from "../use-document-actions";

const APPROVAL_LABEL: Record<DocumentApprovalStatus, { label: string; tone: "success" | "danger" | "neutral" | "info" }> = {
  APPROVED: { label: "Aprovada em revisão", tone: "success" },
  REJECTED: { label: "Rejeitada em revisão", tone: "danger" },
  SUPERSEDED: { label: "Substituída", tone: "neutral" },
  PENDING: { label: "Sem decisão", tone: "info" },
};

/**
 * Histórico de versões (imutáveis) de um documento, lido do servidor ao
 * abrir. Cada versão tem a própria verificação: versão nova nasce "não
 * verificada" e nunca herda o resultado da anterior.
 */
export function DocumentVersionsDialog({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const actions = useDocumentActions();
  const [detail, setDetail] = useState<ActionResult<DocumentDetailDTO> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void callAction(() => getDocumentAction({ id: documentId })).then((r) => alive && setDetail(r));
    return () => {
      alive = false;
    };
  }, [documentId]);

  const doc = detail?.ok ? detail.data.document : undefined;
  const versions = doc ? [...doc.versions].sort((a, b) => b.versionNumber - a.versionNumber) : [];
  const internal = detail?.ok && detail.data.surface === "INTERNAL";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="xl" title={doc ? `Versões de “${doc.title}”` : "Versões do documento"} description="Arquivos imutáveis: cada envio cria uma versão nova.">
      {!detail ? (
        <SkeletonRows rows={3} />
      ) : !detail.ok ? (
        <ActionErrorState error={detail} title="Não foi possível carregar as versões." />
      ) : versions.length === 0 ? (
        <p className="text-[13px] text-muted">Nenhum arquivo enviado ainda.</p>
      ) : (
        <div className="-mx-6">
          <Table caption="Versões do documento">
            <THead>
              <tr>
                <Th>Versão</Th>
                <Th>Arquivo</Th>
                <Th>Enviada em</Th>
                <Th>Verificação</Th>
                {internal && <Th>Revisão</Th>}
                <Th className="text-right">
                  <span className="sr-only">Baixar</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {versions.map((v, i) => (
                <Tr key={v.id}>
                  <Td className="tabular">
                    v{v.versionNumber}
                    {i === 0 && (
                      <Badge tone="navy" className="ml-2">
                        Atual
                      </Badge>
                    )}
                  </Td>
                  <Td className="max-w-[260px]">
                    <span className="block truncate">{v.fileName ?? "—"}</span>
                    {v.sizeBytes ? <span className="text-[12px] text-muted">{formatBytes(v.sizeBytes)}</span> : null}
                    {internal && (v as DocumentVersionInternalDTO).source === "MANUAL_EDIT" && <span className="ml-1.5 text-[12px] text-muted">· edição manual</span>}
                    {internal && (v as DocumentVersionInternalDTO).source === "AGENT" && <span className="ml-1.5 text-[12px] text-muted">· gerada por agente</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-[12.5px] text-muted">{formatDateTime(v.createdAt)}</Td>
                  <Td>
                    <VerificationLabel verification={v.verification} />
                  </Td>
                  {internal && (
                    <Td>
                      <ApprovalBadge approval={(v as DocumentVersionInternalDTO).approval} />
                    </Td>
                  )}
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Download className="size-3.5" aria-hidden />}
                      loading={busy === v.id}
                      disabled={!!busy}
                      onClick={async () => {
                        setBusy(v.id);
                        await actions.download(documentId, v.id);
                        setBusy(null);
                      }}
                    >
                      Baixar
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}

function ApprovalBadge({ approval }: { approval: DocumentApprovalStatus }) {
  const a = APPROVAL_LABEL[approval];
  return <Badge tone={a.tone}>{a.label}</Badge>;
}
