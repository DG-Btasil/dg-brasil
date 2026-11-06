import { cn } from "@/lib/cn";

/**
 * Número CNJ em fonte tabular; "Sem número CNJ" quando ainda não existe. Não
 * diz "Pré-ajuizamento": isso é um status (o processo sem número pode estar,
 * por exemplo, em preparação) e o status aparece na própria coluna.
 */
export function CnjText({ cnj, className }: { cnj?: string; className?: string }) {
  if (!cnj) return <span className={cn("italic text-muted", className)}>Sem número CNJ</span>;
  return <span className={cn("font-mono text-[12.5px] tabular tracking-tight", className)}>{cnj}</span>;
}
