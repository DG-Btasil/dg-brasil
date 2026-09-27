"use client";

import { useMemo, useState } from "react";
import { FileStack, SearchX } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { Can } from "@/components/layout/guards";
import { Button } from "@/components/ui/button";
import { SearchInput, Select } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABEL,
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_LABEL,
  type DocumentCategory,
  type DocumentStatus,
} from "@/lib/constants/status";
import { useReferenceTemplate, useTemplates } from "@/features/analyses/hooks";
import { currentAnalysis } from "@/features/analyses/utils";
import type { Client, ClientDocument, LegalAnalysis } from "@/types";
import { DocumentAddDialog, type PickedFile } from "./document-add-dialog";
import { DocumentChecklist } from "./document-checklist";
import { DocumentDropzone } from "./document-dropzone";
import { DocumentTable } from "./document-table";

const opts = <K extends string>(keys: readonly K[], labels: Record<K, string>) => keys.map((k) => ({ value: k, label: labels[k] }));

export function DocumentsTab({ client, documents, analyses }: { client: Client; documents: ClientDocument[]; analyses: LegalAnalysis[] }) {
  const templates = useTemplates();
  const referenceTemplate = useReferenceTemplate();
  const analysis = currentAnalysis(analyses);
  const template = templates.find((t) => t.id === analysis?.templateId) ?? referenceTemplate;

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<DocumentCategory | "">("");
  const [status, setStatus] = useState<DocumentStatus | "">("");
  const [dialog, setDialog] = useState<{ open: boolean; file?: PickedFile; category?: DocumentCategory }>({ open: false });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return documents.filter(
      (d) =>
        (!category || d.category === category) &&
        (!status || d.status === status) &&
        (!term || d.name.toLowerCase().includes(term) || (d.fileName ?? "").toLowerCase().includes(term)),
    );
  }, [documents, search, category, status]);
  const filtered = Boolean(search || category || status);

  return (
    <div className="space-y-5">
      {template && (
        <DocumentChecklist
          template={template}
          client={client}
          documents={documents}
          reference={!analysis}
          onAdd={(c) => setDialog({ open: true, category: c })}
        />
      )}
      <Can permission="documents.manage">
        <DocumentDropzone onFile={(file) => setDialog({ open: true, file })} />
      </Can>
      <Panel>
        <PanelHeader title="Documentos do cliente" description="Somente metadados são registrados no protótipo." />
        {documents.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title="Nenhum documento registrado."
            description="Envie os documentos do checklist para liberar a análise jurídica."
            compact
          />
        ) : (
          <>
            <div className="grid grid-cols-[minmax(220px,1.4fr)_1fr_1fr_auto] items-center gap-2.5 border-b border-line px-5 py-3" role="search" aria-label="Filtrar documentos">
              <SearchInput aria-label="Buscar documento" placeholder="Buscar por nome ou arquivo" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select aria-label="Categoria" placeholder="Todas as categorias" options={opts(DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL)} value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory | "")} />
              <Select aria-label="Status" placeholder="Todos os status" options={opts(DOCUMENT_STATUSES, DOCUMENT_STATUS_LABEL)} value={status} onChange={(e) => setStatus(e.target.value as DocumentStatus | "")} />
              <span className="whitespace-nowrap text-[12px] text-muted" aria-live="polite">
                {visible.length} de {documents.length}
              </span>
            </div>
            {visible.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="Nenhum documento corresponde aos filtros."
                compact
                action={
                  filtered && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSearch("");
                        setCategory("");
                        setStatus("");
                      }}
                    >
                      Limpar filtros
                    </Button>
                  )
                }
              />
            ) : (
              <DocumentTable documents={visible} />
            )}
          </>
        )}
      </Panel>
      <DocumentAddDialog
        clientId={client.id}
        open={dialog.open}
        initialFile={dialog.file}
        defaultCategory={dialog.category}
        onOpenChange={(open) => setDialog(open ? { ...dialog, open } : { open: false })}
      />
    </div>
  );
}
