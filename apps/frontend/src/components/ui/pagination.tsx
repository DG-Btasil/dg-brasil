"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";

/**
 * Paginação única das listas ligadas ao backend (página 1-based, total vindo
 * do servidor). Não some quando há uma página só: informa o total.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  disabled,
  noun = { one: "registro", many: "registros" },
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  noun?: { one: string; many: string };
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[12.5px] text-muted">
      <p aria-live="polite">
        {total === 0 ? `Nenhum ${noun.one}` : `${from}–${to} de ${total} ${total === 1 ? noun.one : noun.many}`}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<ChevronLeft className="size-3.5" aria-hidden />}
            disabled={disabled || page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Anterior
          </Button>
          <span className="tabular">
            Página {page} de {pages}
          </span>
          <Button variant="secondary" size="sm" disabled={disabled || page >= pages} onClick={() => onPageChange(page + 1)}>
            Próxima
            <ChevronRight className="size-3.5" aria-hidden />
          </Button>
        </div>
      )}
    </nav>
  );
}
