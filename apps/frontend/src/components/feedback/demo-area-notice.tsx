"use client";

import { usePathname } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/cn";

/** Rotas de áreas que já leem o servidor, dentro de seções ainda de demonstração. */
const REAL_PREFIXES = ["/dg-brasil/execucoes"];

/**
 * Aviso de ÁREA de demonstração (QA 4.3, OBS-03): substitui o selo global
 * "Demonstração" do cabeçalho, que aparecia sobre telas já ligadas ao banco.
 * Só as áreas que ainda guardam dados no navegador mostram este aviso.
 */
export function DemoAreaNotice({ className, area = "Esta área" }: { className?: string; area?: string }) {
  const pathname = usePathname();
  if (REAL_PREFIXES.some((p) => pathname?.startsWith(p))) return null;
  return (
    <div role="note" className={cn("mb-5 flex items-start gap-2.5 rounded-md border border-dashed border-gold/50 bg-gold-50 px-3.5 py-2.5 text-[12.5px] text-muted", className)}>
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-gold-600" aria-hidden />
      <span>
        <strong className="font-semibold text-foreground">Demonstração.</strong> {area} ainda não está ligada ao servidor: o que for alterado aqui fica só neste
        navegador e não afeta clientes, casos, processos nem os demais dados reais.
      </span>
    </div>
  );
}
