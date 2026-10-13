"use client";

import { useRef, useState, type DragEvent } from "react";
import { Download, FileStack, MoreHorizontal, SearchX, UploadCloud } from "lucide-react";
import { cn } from "@/lib/cn";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, DOCUMENT_VISIBILITY_LABEL, type DocumentCategory } from "@/lib/constants/status";
import { formatDate } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useServerList } from "@/lib/hooks/use-server-list";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { MenuButton } from "@/components/ui/menu";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { listDocumentsAction } from "@/server/domain/documents/actions";
import type { DocumentListItem } from "@/server/domain/documents/dto";
import { usePermission, useRole } from "@/features/auth/hooks";
import { VerificationLabel } from "@/features/clients/components/detail/documents/document-status-icon";
import { DOCUMENT_PAGE_SIZE, documentListInput, FILE_ACCEPT, formatBytes, type DocumentQuery as Query, type DocumentScope } from "../constants";
import { useDocumentActions } from "../use-document-actions";
import { DocumentVersionsDialog } from "./document-versions-dialog";
import { UploadDialog, type UploadTarget } from "./upload-dialog";

const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABEL[c] }));
const label = (category: string) => DOCUMENT_CATEGORY_LABEL[category as DocumentCategory] ?? category;

/**
 * Documentos de um cliente, caso ou processo — lidos do servidor (RLS),
 * paginados, com envio real (URL assinada), download por URL assinada curta e
 * verificação por versão. A visibilidade para o parceiro só muda pelo
 * servidor, que confere as regras (caso de parceiro, arquivo, revisão).
 */
export function DocumentsPanel({
  scope,
  initial,
  title,
  description,
  allowSharing = false,
  readOnly = false,
}: {
  scope: DocumentScope;
  initial: ActionResult<Page<DocumentListItem>>;
  title: string;
  description?: string;
  /** Caso/processo com parceiro vinculado: oferece "compartilhar com o parceiro". */
  allowSharing?: boolean;
  /** Sem envio (ex.: caso arquivado ou recusado no portal). */
  readOnly?: boolean;
}) {
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery: { category: "", status: "ACTIVE", page: 1 } as Query,
    initialResult: initial,
    load: (q: Query) => listDocumentsAction(documentListInput(scope, q)),
  });
  const canManage = usePermission("documents.manage");
  // Parceiro envia arquivo para caso/processo do próprio escritório (o banco confere); nunca só para o cliente.
  const partnerSubmit = usePermission("partnerPortal.documents.submit") && !("clientId" in scope);
  const canUpload = !readOnly && (canManage || partnerSubmit);
  // Exclusão de documento: só ADMIN (o service exige o papel; o banco confere).
  const canDelete = useRole() === "ADMIN";
  const actions = useDocumentActions();
  const [upload, setUpload] = useState<{ target: UploadTarget; file?: File } | null>(null);
  const [versionsOf, setVersionsOf] = useState<string | null>(null);
  const [failing, setFailing] = useState<{ versionId: string; title: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const page = result.ok ? result.data : undefined;
  const newTarget: UploadTarget = { kind: "new", ...scope };

  async function act(id: string, run: () => Promise<unknown>) {
    setBusy(id);
    await run();
    setBusy(null);
  }

  return (
    <div className="space-y-5">
      {canUpload && <Dropzone onFile={(file) => setUpload({ target: newTarget, file })} />}
      <Panel>
        <PanelHeader title={title} description={description} />
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2.5 border-b border-line px-5 py-3" role="search" aria-label="Filtrar documentos">
          <Select aria-label="Categoria" placeholder="Todas as categorias" options={CATEGORY_OPTIONS} value={query.category} onChange={(e) => setQuery({ ...query, category: e.target.value as Query["category"], page: 1 })} />
          <Select
            aria-label="Situação do documento"
            options={[
              { value: "ACTIVE", label: "Ativos" },
              { value: "ARCHIVED", label: "Arquivados" },
            ]}
            value={query.status}
            onChange={(e) => setQuery({ ...query, status: e.target.value as Query["status"], page: 1 })}
          />
          {page && (
            <span className="whitespace-nowrap text-[12px] text-muted" aria-live="polite">
              {page.total === 1 ? "1 documento" : `${page.total} documentos`}
            </span>
          )}
        </div>
        <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
          {!result.ok ? (
            <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar os documentos." />
          ) : !page ? (
            <SkeletonRows rows={4} />
          ) : page.items.length === 0 ? (
            query.category || query.status !== "ACTIVE" ? (
              <EmptyState icon={SearchX} compact title="Nenhum documento corresponde aos filtros." />
            ) : (
              <EmptyState icon={FileStack} compact title="Nenhum documento registrado." description={canUpload ? "Envie o primeiro arquivo pela área acima." : undefined} />
            )
          ) : (
            <>
              <Table caption={title}>
                <THead>
                  <tr>
                    <Th>Documento</Th>
                    <Th>Categoria</Th>
                    <Th>Versão</Th>
                    <Th>Verificação</Th>
                    {canManage && <Th>Visibilidade</Th>}
                    <Th className="text-right">
                      <span className="sr-only">Ações</span>
                    </Th>
                  </tr>
                </THead>
                <TBody>
                  {page.items.map((doc) => {
                    const v = doc.currentVersion;
                    const internal = doc.surface === "INTERNAL";
                    const items = [
                      ...(canUpload && doc.status === "ACTIVE" ? [{ key: "version", label: "Enviar nova versão", onSelect: () => setUpload({ target: { kind: "version", documentId: doc.id, title: doc.title } }) }] : []),
                      ...(v ? [{ key: "history", label: "Histórico de versões", onSelect: () => setVersionsOf(doc.id) }] : []),
                      ...(canManage && v && v.verification !== "VERIFIED"
                        ? [{ key: "verify", label: "Marcar arquivo como verificado", onSelect: () => act(doc.id, () => actions.verify(v.id, "VERIFIED")) }]
                        : []),
                      ...(canManage && v && v.verification !== "FAILED" ? [{ key: "fail", label: "Registrar divergência no arquivo", onSelect: () => setFailing({ versionId: v.id, title: doc.title }) }] : []),
                      ...(canManage && internal && allowSharing
                        ? [
                            doc.visibility === "PARTNER_VISIBLE"
                              ? { key: "unshare", label: "Recolher (somente interno)", onSelect: () => act(doc.id, () => actions.setVisibility(doc.id, "INTERNAL")) }
                              : {
                                  key: "share",
                                  label: "Compartilhar com o parceiro",
                                  description: "O servidor confere: caso de parceiro, arquivo enviado e revisão.",
                                  onSelect: () => act(doc.id, () => actions.setVisibility(doc.id, "PARTNER_VISIBLE")),
                                },
                          ]
                        : []),
                      ...(canManage
                        ? [
                            doc.status === "ACTIVE"
                              ? { key: "archive", label: "Arquivar", onSelect: () => act(doc.id, () => actions.setArchived(doc.id, true)) }
                              : { key: "unarchive", label: "Reativar", onSelect: () => act(doc.id, () => actions.setArchived(doc.id, false)) },
                          ]
                        : []),
                      ...(canDelete && canManage ? [{ key: "remove", label: "Excluir documento", description: "As versões ficam no histórico.", onSelect: () => act(doc.id, () => actions.remove(doc.id)) }] : []),
                    ];
                    return (
                      <Tr key={doc.id} className={doc.status === "ARCHIVED" ? "text-muted" : undefined}>
                        <Td className="max-w-[300px]">
                          <span className="block truncate font-medium text-foreground">{doc.title}</span>
                          {v?.fileName && (
                            <span className="block truncate text-[12px] text-muted">
                              {v.fileName}
                              {v.sizeBytes ? ` · ${formatBytes(v.sizeBytes)}` : ""}
                            </span>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap text-[12.5px]">{label(doc.category)}</Td>
                        <Td className="whitespace-nowrap text-[12.5px] text-muted tabular">{v ? `v${v.versionNumber} · ${formatDate(v.createdAt)}` : "—"}</Td>
                        <Td>{v ? <VerificationLabel verification={v.verification} /> : <Badge tone="warning">Sem arquivo</Badge>}</Td>
                        {canManage && (
                          <Td>{internal ? <Badge tone={doc.visibility === "PARTNER_VISIBLE" ? "gold" : "neutral"}>{DOCUMENT_VISIBILITY_LABEL[doc.visibility]}</Badge> : null}</Td>
                        )}
                        <Td className="whitespace-nowrap text-right">
                          <div className="inline-flex items-center gap-1">
                            {v ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Download className="size-3.5" aria-hidden />}
                                loading={busy === `dl:${doc.id}`}
                                disabled={!!busy}
                                onClick={() => act(`dl:${doc.id}`, () => actions.download(doc.id))}
                              >
                                Baixar
                              </Button>
                            ) : (
                              canUpload &&
                              doc.status === "ACTIVE" && (
                                <Button size="sm" variant="secondary" icon={<UploadCloud className="size-3.5" aria-hidden />} onClick={() => setUpload({ target: { kind: "version", documentId: doc.id, title: doc.title } })}>
                                  Enviar arquivo
                                </Button>
                              )
                            )}
                            {items.length > 0 && <MenuButton label="Mais" icon={<MoreHorizontal className="size-4" aria-hidden />} items={items} disabled={!!busy} />}
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
              <Pagination page={page.page} pageSize={DOCUMENT_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={{ one: "documento", many: "documentos" }} />
            </>
          )}
        </div>
      </Panel>
      {upload && <UploadDialog target={upload.target} initialFile={upload.file} onClose={() => setUpload(null)} />}
      {versionsOf && <DocumentVersionsDialog documentId={versionsOf} onClose={() => setVersionsOf(null)} />}
      {failing && <FailVerificationDialog {...failing} onClose={() => setFailing(null)} />}
    </div>
  );
}

/** Área de arrastar e soltar (Front V1), agora com envio real. */
function Dropzone({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn("flex items-center justify-between gap-6 rounded-lg border border-dashed px-5 py-4 transition-colors", over ? "border-navy bg-navy-50/60" : "border-line-strong bg-surface")}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full border border-line bg-surface-muted text-navy-600">
          <UploadCloud className="size-[18px]" aria-hidden />
        </span>
        <div>
          <p className="text-[13px] font-medium text-foreground">Arraste um arquivo para cá ou use o botão ao lado</p>
          <p className="text-[12px] text-muted">PDF, Word, Excel, texto, CSV ou imagem, até 50 MB. Armazenamento privado do escritório.</p>
        </div>
      </div>
      <Button variant="secondary" onClick={() => inputRef.current?.click()}>
        Enviar documento
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Divergência no ARQUIVO (verificação da versão; append-only no banco). */
function FailVerificationDialog({ versionId, title, onClose }: { versionId: string; title: string; onClose: () => void }) {
  const actions = useDocumentActions();
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title="Registrar divergência no arquivo"
      description={`“${title}”, versão atual. A verificação fica registrada; uma nova versão começa como não verificada.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            loading={saving}
            onClick={async () => {
              setSaving(true);
              const r = await actions.verify(versionId, "FAILED", notes.trim());
              setSaving(false);
              if (r.ok) onClose();
            }}
          >
            Registrar divergência
          </Button>
        </>
      }
    >
      <Field label="O que está errado" requirement="optional" hint="Ex.: documento ilegível, de outra pessoa, vencido.">
        {(p) => <Textarea {...p} rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
    </Dialog>
  );
}
