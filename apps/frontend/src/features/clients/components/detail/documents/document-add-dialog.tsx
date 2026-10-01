"use client";

import { useRef, useState, type FormEvent } from "react";
import { Paperclip } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, type DocumentCategory } from "@/lib/constants/status";
import { repositories } from "@/repositories";
import { useToast } from "@/store/ui-store";

export interface PickedFile {
  fileName: string;
  sizeKb: number;
}

const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABEL[c] }));

export function toPickedFile(file: File): PickedFile {
  return { fileName: file.name, sizeKb: Math.max(1, Math.round(file.size / 1024)) };
}

function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
}

/**
 * Confirma nome e categoria de um documento. Registra apenas metadados:
 * nenhum arquivo é enviado na demonstração.
 */
export function DocumentAddDialog({
  clientId,
  legalCaseId,
  open,
  onOpenChange,
  initialFile,
  defaultCategory,
}: {
  clientId: string;
  /** Documento do caso (sem: documento do cliente). */
  legalCaseId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFile?: PickedFile;
  defaultCategory?: DocumentCategory;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<PickedFile | undefined>(initialFile);
  const [name, setName] = useState(initialFile ? nameFromFile(initialFile.fileName) : "");
  const [category, setCategory] = useState<DocumentCategory | "">(defaultCategory ?? "");
  const [errors, setErrors] = useState<{ name?: string; category?: string }>({});
  const [saving, setSaving] = useState(false);

  // Sincroniza quando um novo arquivo chega pela área de envio (padrão "prop anterior").
  const [prevInitial, setPrevInitial] = useState(initialFile);
  const [prevCategory, setPrevCategory] = useState(defaultCategory);
  if (initialFile !== prevInitial || defaultCategory !== prevCategory) {
    setPrevInitial(initialFile);
    setPrevCategory(defaultCategory);
    setFile(initialFile);
    if (initialFile) setName(nameFromFile(initialFile.fileName));
    setCategory(defaultCategory ?? "");
  }

  function reset() {
    setFile(undefined);
    setName("");
    setCategory("");
    setErrors({});
  }

  function close(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const nextErrors = {
      name: name.trim() ? undefined : "Informe o nome do documento.",
      category: category ? undefined : "Selecione a categoria.",
    };
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.category || !category) return;
    setSaving(true);
    await repositories.documents.add({ clientId, legalCaseId, name: name.trim(), category, fileName: file?.fileName, sizeKb: file?.sizeKb });
    setSaving(false);
    toast({ tone: "success", title: "Documento registrado", description: `${name.trim()} aguarda verificação.` });
    close(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Adicionar documento"
      description="Confirme o nome e a categoria. O documento entra como pendente de verificação."
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button onClick={() => submit()} loading={saving}>
            Registrar documento
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={submit} className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-muted px-3 py-2.5 text-[12.5px]">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Paperclip className="size-4 shrink-0 text-subtle" aria-hidden />
            {file ? (
              <span className="truncate text-foreground">
                {file.fileName} <span className="text-muted">· {file.sizeKb} KB</span>
              </span>
            ) : (
              <span className="text-muted">Nenhum arquivo selecionado (opcional)</span>
            )}
          </span>
          <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
            {file ? "Trocar arquivo" : "Selecionar arquivo"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                const picked = toPickedFile(f);
                setFile(picked);
                if (!name.trim()) setName(nameFromFile(picked.fileName));
              }
              e.target.value = "";
            }}
          />
        </div>
        <Field label="Nome do documento" requirement="required" error={errors.name}>
          {(p) => <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus {...p} />}
        </Field>
        <Field label="Categoria" requirement="required" error={errors.category}>
          {(p) => (
            <Select placeholder="Selecione" options={CATEGORY_OPTIONS} value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory | "")} {...p} />
          )}
        </Field>
        <Callout tone="neutral">Os arquivos não são enviados nesta demonstração. Apenas os metadados são registrados.</Callout>
      </form>
    </Dialog>
  );
}
