"use client";

import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes, HTMLAttributes } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

/** Tabela densa e semântica. Linhas finas, cabeçalho discreto. */
export function Table({ children, className, caption }: { children: ReactNode; className?: string; caption?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-line bg-surface-muted">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function Th({ className, children, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn("h-9 whitespace-nowrap px-4 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted first:pl-5 last:pr-5", className)}
      {...props}
    >
      {children}
    </th>
  );
}

export type SortDirection = "asc" | "desc";

/** Cabeçalho ordenável: aria-sort + botão acessível. */
export function SortableTh<K extends string>({
  label,
  sortKey,
  currentKey,
  direction,
  onSort,
  className,
}: {
  label: string;
  sortKey: K;
  currentKey: K | null;
  direction: SortDirection;
  onSort: (key: K) => void;
  className?: string;
}) {
  const active = currentKey === sortKey;
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <Th className={className} aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 uppercase hover:text-foreground">
        {label}
        <Icon aria-hidden className={cn("size-3", active ? "text-navy" : "text-subtle")} />
      </button>
    </Th>
  );
}

export function Tr({ className, children, interactive, ...props }: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr className={cn("transition-colors", interactive && "cursor-pointer hover:bg-navy-50/60", className)} {...props}>
      {children}
    </tr>
  );
}

export function Td({ className, children, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-4 py-3 align-middle first:pl-5 last:pr-5", className)} {...props}>
      {children}
    </td>
  );
}

/** Hook-free helper de ordenação genérica. */
export function sortBy<T>(list: T[], getter: (item: T) => string | number | undefined, direction: SortDirection): T[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = getter(a);
    const vb = getter(b);
    if (va === vb) return 0;
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
    return String(va).localeCompare(String(vb), "pt-BR") * factor;
  });
}
