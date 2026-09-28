"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, type DocumentCategory } from "@/lib/constants/status";
import { DEMO_LEGAL_DISCLAIMER } from "@/lib/constants/legal";
import { formatDateTime } from "@/lib/formatting";
import { zRequired } from "@/lib/validation";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DemoContentNotice } from "@/components/ui/display";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { ClientDocument, ID, PartnerRequest } from "@/types";
import { usePortalActions } from "../hooks";

const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.filter((c) => c !== "PETITION" && c !== "COURT_DECISION").map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABEL[c] }));

const docSchema = z.object({
  name: zRequired("Informe o nome do documento."),
  category: z.enum(DOCUMENT_CATEGORIES),
  fileName: zRequired("Selecione o arquivo."),
});
type DocValues = z.infer<typeof docSchema>;

/**
 * Envio oficial de documento à Bárbara Cardoso Advocacia. Upload simulado:
 * só o nome do arquivo é registrado. Com `replaces`, cria nova versão e
 * preserva a anterior — nunca sobrescreve.
 */
export function SendDocumentDialog({
  clientId,
  processId,
  request,
  replaces,
  open,
  onOpenChange,
}: {
  clientId: ID;
  processId?: ID;
  request?: PartnerRequest;
  replaces?: ClientDocument;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const actions = usePortalActions();
  const form = useForm<DocValues>({
    resolver: zodResolver(docSchema),
    defaultValues: { name: replaces?.name ?? request?.title ?? "", category: (replaces?.category ?? (request ? "BANK_STATEMENT" : "OTHER")) as DocumentCategory, fileName: "" },
  });
  const {
    register,
    setValue,
    formState: { errors, isSubmitting },
  } = form;
  const onSubmit = form.handleSubmit(async (v) => {
    const id = await actions.submitDocument({
      clientId,
      processId: processId ?? request?.processId,
      requestId: request?.id,
      replacesDocumentId: replaces?.id,
      name: v.name,
      category: v.category,
      fileName: v.fileName,
    });
    if (id) onOpenChange(false);
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={replaces ? `Enviar nova versão — ${replaces.name}` : request ? "Enviar documento solicitado" : "Enviar documento"}
      description={
        replaces
          ? `A versão atual (v${replaces.version ?? 1}) continuará guardada. A nova versão será a v${(replaces.version ?? 1) + 1}.`
          : "Depois de enviado, o documento não pode ser editado nem apagado. Se precisar corrigir, envie uma nova versão."
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} loading={isSubmitting}>
            Enviar
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {request && (
          <Callout tone="info" title={request.title}>
            {request.description}
          </Callout>
        )}
        <Field label="Nome do documento" requirement="required" error={errors.name?.message}>
          {(p) => <Input {...p} {...register("name")} disabled={!!replaces} />}
        </Field>
        <Field label="Tipo" requirement="required">
          {(p) => <Select {...p} options={CATEGORY_OPTIONS} {...register("category")} disabled={!!replaces} />}
        </Field>
        <Field label="Arquivo" requirement="required" error={errors.fileName?.message} hint="Protótipo: o arquivo não é enviado; apenas o nome é registrado.">
          {(p) => (
            <Input
              {...p}
              type="file"
              className="py-1.5"
              onChange={(e) => setValue("fileName", e.target.files?.[0]?.name ?? "", { shouldValidate: true })}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/** Resposta em texto a uma solicitação. */
export function RespondRequestDialog({ request, open, onOpenChange }: { request: PartnerRequest; open: boolean; onOpenChange: (o: boolean) => void }) {
  const actions = usePortalActions();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  async function submit() {
    if (!text.trim()) {
      setError("Escreva a resposta.");
      return;
    }
    setSending(true);
    const ok = await actions.respondRequest(request.id, text.trim());
    setSending(false);
    if (ok !== null) onOpenChange(false);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Responder solicitação"
      description={request.title}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={sending}>
            Enviar resposta
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-muted">{request.description}</p>
        <Field label="Resposta" requirement="required" error={error ?? undefined}>
          {(p) => (
            <Textarea
              {...p}
              rows={4}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Visualização de documento aprovado disponibilizado pelo escritório. */
export function ApprovedDocumentDialog({ doc, open, onOpenChange }: { doc: ClientDocument; open: boolean; onOpenChange: (o: boolean) => void }) {
  const content = doc.approvedContent;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={doc.name} description={content ? `Documento aprovado em ${formatDateTime(content.approvedAt)}.` : undefined}>
      {content ? (
        <article className="space-y-4">
          <h3 className="font-serif text-[20px] text-navy">{content.title}</h3>
          {content.sections.map((s) => (
            <section key={s.heading}>
              <h4 className="text-[13px] font-semibold text-foreground">{s.heading}</h4>
              <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-foreground/85">{s.body}</p>
            </section>
          ))}
          <DemoContentNotice>{DEMO_LEGAL_DISCLAIMER}</DemoContentNotice>
        </article>
      ) : (
        <p className="text-[13px] text-muted">Pré-visualização indisponível no protótipo. Arquivo: {doc.fileName ?? doc.name}.</p>
      )}
    </Dialog>
  );
}
