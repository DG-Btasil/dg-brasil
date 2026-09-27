import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Superfície base. Linha fina, sombra quase imperceptível. */
export function Panel({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface shadow-hairline", className)} {...props}>
      {children}
    </div>
  );
}

interface PanelHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
  /** Nível do heading para manter hierarquia semântica. */
  as?: "h2" | "h3";
}

export function PanelHeader({ title, description, actions, eyebrow, className, as: Heading = "h2" }: PanelHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-line px-5 py-3.5", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <Heading className="text-[14px] font-semibold text-foreground">{title}</Heading>
        {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PanelBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

export function PanelFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-line px-5 py-3", className)}>{children}</div>;
}

/** Título de seção fora de painel. */
export function SectionTitle({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-4", className)}>
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Lista de definição em grade (rótulo/valor), usada nos blocos de detalhe. */
export function DefinitionGrid({ items, columns = 2, className }: { items: { label: string; value: ReactNode; wide?: boolean }[]; columns?: 2 | 3 | 4; className?: string }) {
  const cols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" }[columns];
  return (
    <dl className={cn("grid gap-x-6 gap-y-3.5", cols, className)}>
      {items.map((item) => (
        <div key={item.label} className={cn("min-w-0", item.wide && "col-span-full")}>
          <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">{item.label}</dt>
          <dd className="mt-0.5 break-words text-[13px] text-foreground">{item.value ?? <span className="text-subtle">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
