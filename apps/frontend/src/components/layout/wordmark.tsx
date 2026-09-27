import { cn } from "@/lib/cn";

/** Wordmark tipográfico: serifada + filete dourado. Sem ícones clichês. */
export function Wordmark({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span aria-hidden className={cn("flex size-7 items-center justify-center rounded-sm border", tone === "light" ? "border-gold/60" : "border-gold")}>
        <span className={cn("font-serif text-[13px] font-semibold tracking-tight", tone === "light" ? "text-gold-300" : "text-gold-600")}>DG</span>
      </span>
      <span className={cn("font-serif text-[17px] font-medium tracking-[0.14em]", tone === "light" ? "text-white" : "text-navy")}>
        DG&nbsp;BRASIL
      </span>
    </span>
  );
}
