import { cn } from "@/lib/cn";
import type { DiffLine, DiffLineType } from "@/types";

const LINE_STYLE: Record<DiffLineType, { cls: string; sign: string; label: string }> = {
  removed: { cls: "bg-danger-soft text-danger", sign: "−", label: "removido" },
  added: { cls: "bg-success-soft text-success", sign: "+", label: "adicionado" },
  context: { cls: "text-muted", sign: " ", label: "sem alteração" },
};

/** Visualização de diferenças: sinal + rótulo acessível, nunca só cor. */
export function DiffView({ lines, className }: { lines: DiffLine[]; className?: string }) {
  if (lines.length === 0) {
    return <p className="text-[13px] text-muted">Nenhuma diferença registrada para esta alteração.</p>;
  }
  return (
    <div className={cn("overflow-hidden rounded-md border border-line bg-surface font-mono text-[12.5px] leading-relaxed", className)}>
      <ul aria-label="Diferenças entre as versões" className="divide-y divide-line/60">
        {lines.map((line, i) => {
          const style = LINE_STYLE[line.type];
          return (
            <li key={`${i}-${line.text}`} className={cn("grid grid-cols-[28px_minmax(0,1fr)]", style.cls)}>
              <span aria-hidden className="select-none border-r border-line/60 text-center">
                {style.sign}
              </span>
              <span className="whitespace-pre-wrap break-words px-3 py-1">
                <span className="sr-only">{style.label}: </span>
                {line.text}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DiffLegend() {
  return (
    <div className="flex items-center gap-4 text-[11.5px] text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-flex size-4 items-center justify-center rounded-xs bg-danger-soft font-mono text-danger">
          −
        </span>
        Removido
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-flex size-4 items-center justify-center rounded-xs bg-success-soft font-mono text-success">
          +
        </span>
        Adicionado
      </span>
    </div>
  );
}
