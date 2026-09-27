import type { ReactNode } from "react";

/** Cabeçalho de cada seção das configurações. */
export function SectionHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-6 border-b border-line pb-4">
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
        {description && <p className="mt-1 max-w-[720px] text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
