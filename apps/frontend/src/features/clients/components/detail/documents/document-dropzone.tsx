"use client";

import { useRef, useState, type DragEvent } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { toPickedFile, type PickedFile } from "./document-add-dialog";

/** Área de arrastar e soltar. O arquivo não é enviado: apenas abre a confirmação. */
export function DocumentDropzone({ onFile }: { onFile: (file: PickedFile) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(toPickedFile(file));
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex items-center justify-between gap-6 rounded-lg border border-dashed px-5 py-4 transition-colors",
        over ? "border-navy bg-navy-50/60" : "border-line-strong bg-surface",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full border border-line bg-surface-muted text-navy-600">
          <UploadCloud className="size-[18px]" aria-hidden />
        </span>
        <div>
          <p className="text-[13px] font-medium text-foreground">Arraste um arquivo para cá ou use o botão ao lado</p>
          <p className="text-[12px] text-muted">PDF, JPG ou PNG. Os arquivos não são enviados nesta demonstração.</p>
        </div>
      </div>
      <Button variant="secondary" onClick={() => inputRef.current?.click()}>
        Enviar documento
      </Button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(toPickedFile(file));
          e.target.value = "";
        }}
      />
    </div>
  );
}
