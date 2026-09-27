import type { FormEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Bloco de campos dentro de uma etapa: subtítulo discreto + grade de 2 colunas. */
export function StepSection({
  title,
  description,
  children,
  className,
  columns = 2,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  columns?: 1 | 2;
}) {
  return (
    <section className={cn("border-t border-line pt-6 first:border-t-0 first:pt-0", className)}>
      {title && <h3 className="text-[13.5px] font-semibold text-foreground">{title}</h3>}
      {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{description}</p>}
      <div className={cn("grid gap-x-5 gap-y-4", (title || description) && "mt-4", columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
        {children}
      </div>
    </section>
  );
}

/** Ocupa a linha inteira dentro da grade da seção. */
export function Wide({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("sm:col-span-2", className)}>{children}</div>;
}

/** Wrapper padrão do <form> de cada etapa. */
export function StepForm({ id, onSubmit, children }: { id: string; onSubmit: (e: FormEvent<HTMLFormElement>) => void; children: ReactNode }) {
  return (
    <form id={id} onSubmit={onSubmit} noValidate className="space-y-7">
      {children}
    </form>
  );
}
