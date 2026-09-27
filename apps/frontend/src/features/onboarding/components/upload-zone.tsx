"use client";

import { useId, useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/formatting";
import { Button, IconButton } from "@/components/ui/button";

export interface MockFile {
  name: string;
  sizeKb: number;
}

/**
 * Área de envio simulada: registra apenas nome e tamanho dos arquivos.
 * Nenhum conteúdo é lido ou enviado nesta demonstração.
 */
export function UploadZone({ files, onChange, title }: { files: MockFile[]; onChange: (files: MockFile[]) => void; title: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const descId = useId();

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list).map((f) => ({ name: f.name, sizeKb: Math.max(1, Math.round(f.size / 1024)) }));
    const known = new Set(files.map((f) => f.name));
    onChange([...files, ...incoming.filter((f) => !known.has(f.name))]);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center rounded-lg border border-dashed px-6 py-7 text-center transition-colors",
          dragging ? "border-navy bg-navy-50" : "border-line-strong bg-surface-muted",
        )}
      >
        <span className="mb-2.5 flex size-9 items-center justify-center rounded-full border border-line bg-surface text-navy-600">
          <Upload className="size-4" aria-hidden />
        </span>
        <p className="max-w-[440px] text-[13px] font-medium text-foreground">{title}</p>
        <p id={descId} className="mt-1 text-[12px] text-muted">
          Arraste os arquivos para esta área ou selecione no computador. Os arquivos não são enviados nesta demonstração.
        </p>
        <Button variant="secondary" size="sm" className="mt-3.5" onClick={() => inputRef.current?.click()} aria-describedby={descId}>
          Selecionar arquivos
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.odt,.txt"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {files.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-surface" aria-label="Arquivos registrados">
          {files.map((f) => (
            <li key={f.name} className="flex items-center gap-3 px-3 py-2">
              <FileText className="size-4 shrink-0 text-subtle" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{f.name}</span>
              <span className="text-[11.5px] tabular text-muted">{formatNumber(f.sizeKb)} KB</span>
              <span className="text-[11px] text-subtle">Registrado (não enviado)</span>
              <IconButton label={`Remover ${f.name}`} size="sm" onClick={() => onChange(files.filter((x) => x.name !== f.name))}>
                <X className="size-4" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
