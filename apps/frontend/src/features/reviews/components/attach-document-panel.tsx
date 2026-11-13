"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { callAction } from "@/lib/actions/result";
import { DOCUMENT_CATEGORY_LABEL, type DocumentCategory } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { UploadDialog } from "@/features/documents/components/upload-dialog";
import { useCanUploadDocuments } from "@/features/documents/use-can-upload";
import { listDocumentsAction } from "@/server/domain/documents/actions";
import type { DocumentListItem } from "@/server/domain/documents/dto";
import type { ReviewDetailDTO } from "@/server/domain/reviews/dto";
import {
  attachedDocuments,
  attachHelpText,
  caseDocumentsHref,
  recentCaseDocumentsInput,
  reviewUploadTarget,
  type ReviewDecisionPending,
  type ReviewUploadTarget,
  type SessionUpload,
} from "../attach-document";

/** Quantos documentos a lista mostra na tela da revisão; o resto fica na aba Documentos do caso. */
const MAX_LISTED = 5;
const LINK_CLASS = "font-medium text-navy hover:underline underline-offset-2";
const categoryLabel = (category: string | undefined) => (category ? (DOCUMENT_CATEGORY_LABEL[category as DocumentCategory] ?? category) : undefined);

/**
 * "Anexar documento" na revisão: quando o material pede um documento que
 * falta, quem revisa envia daqui mesmo. É o MESMO envio da aba Documentos do
 * caso (UploadDialog: categoria, validações, URL assinada) e a mesma regra de
 * quem pode enviar. Revisão sem caso ou usuário sem permissão: nada aparece.
 */
export function AttachDocumentPanel({ review, pending }: { review: ReviewDetailDTO; pending: ReviewDecisionPending }) {
  const target = reviewUploadTarget(review);
  const canUpload = useCanUploadDocuments({ legalCaseId: review.legalCaseId ?? "" });
  if (!target || !canUpload) return null;
  return <AttachDocument target={target} reviewCreatedAt={review.createdAt} pending={pending} />;
}

function AttachDocument({ target, reviewCreatedAt, pending }: { target: ReviewUploadTarget; reviewCreatedAt: string; pending: ReviewDecisionPending }) {
  const helpId = useId();
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploads, setUploads] = useState<SessionUpload[]>([]);
  const [caseDocuments, setCaseDocuments] = useState<DocumentListItem[]>([]);
  const [reload, setReload] = useState(0);
  const { legalCaseId } = target;
  const documentsHref = caseDocumentsHref(legalCaseId);

  // Arquivos enviados ao caso desde a criação da revisão (leitura existente, com a RLS de quem está na tela).
  // Falhou: a lista mostra só o que foi enviado nesta visita; nada é inventado.
  useEffect(() => {
    let alive = true;
    void callAction(() => listDocumentsAction(recentCaseDocumentsInput(legalCaseId))).then((result) => {
      if (alive && result.ok) setCaseDocuments(result.data.items);
    });
    return () => {
      alive = false;
    };
  }, [legalCaseId, reload]);

  // O diálogo não tem gatilho do Radix: ao fechar (enviado, cancelado ou ESC), o foco volta para o botão.
  useEffect(() => {
    if (wasOpen.current && !dialogOpen) buttonRef.current?.focus();
    wasOpen.current = dialogOpen;
  }, [dialogOpen]);

  const attached = attachedDocuments(uploads, caseDocuments, reviewCreatedAt);
  const last = uploads[0];
  const hidden = attached.length - MAX_LISTED;

  return (
    <Panel>
      <PanelHeader
        title="Documentos do caso"
        actions={
          <Button ref={buttonRef} size="sm" variant="secondary" icon={<Paperclip className="size-3.5" aria-hidden />} aria-haspopup="dialog" aria-describedby={helpId} onClick={() => setDialogOpen(true)}>
            Anexar documento
          </Button>
        }
      />
      <PanelBody className="space-y-3">
        <p id={helpId} className="text-[12.5px] text-muted">
          Falta algum documento? Envie por aqui. {attachHelpText(pending)}
        </p>
        <div role="status" aria-live="polite">
          {last && (
            <Callout tone="success" title={`Documento “${last.title}” anexado.`}>
              <Link href={documentsHref} className={LINK_CLASS}>
                Ver nos documentos do caso
              </Link>
            </Callout>
          )}
        </div>
        {attached.length > 0 && (
          <div>
            <h3 id={listId} className="text-[12.5px] font-semibold text-foreground">
              Documentos anexados nesta revisão
            </h3>
            <p className="text-[12px] text-muted">Arquivos enviados ao caso depois que esta revisão foi criada.</p>
            <ul aria-labelledby={listId} className="mt-2 divide-y divide-line border-y border-line">
              {attached.slice(0, MAX_LISTED).map((doc) => (
                <li key={doc.documentId} className="py-2">
                  <span className="block break-words text-[13px] font-medium text-foreground">{doc.title}</span>
                  <span className="block text-[12px] text-muted">{[categoryLabel(doc.category), formatDateTime(doc.attachedAt)].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12.5px]">
              {hidden > 0 && <span className="text-muted">{hidden === 1 ? "E mais 1 documento. " : `E mais ${hidden} documentos. `}</span>}
              <Link href={documentsHref} className={LINK_CLASS}>
                Abrir os documentos do caso
              </Link>
            </p>
          </div>
        )}
      </PanelBody>
      {dialogOpen && (
        <UploadDialog
          target={target}
          onClose={() => setDialogOpen(false)}
          onUploaded={(doc) => {
            setUploads((current) => [{ documentId: doc.documentId, title: doc.title, attachedAt: new Date().toISOString() }, ...current.filter((u) => u.documentId !== doc.documentId)]);
            setReload((n) => n + 1);
          }}
        />
      )}
    </Panel>
  );
}
