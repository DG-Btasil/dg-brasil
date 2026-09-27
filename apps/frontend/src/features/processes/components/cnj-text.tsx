import { cn } from "@/lib/cn";

/** Número CNJ em fonte tabular; "Pré-ajuizamento" quando ainda não existe. */
export function CnjText({ cnj, className }: { cnj?: string; className?: string }) {
  if (!cnj) return <span className={cn("italic text-muted", className)}>Pré-ajuizamento</span>;
  return <span className={cn("font-mono text-[12.5px] tabular tracking-tight", className)}>{cnj}</span>;
}
