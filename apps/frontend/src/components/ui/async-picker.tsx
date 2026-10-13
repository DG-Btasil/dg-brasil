"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useDismiss } from "@/lib/hooks/use-dismiss";
import { useDebouncedCallback } from "@/lib/hooks/use-server-list";

export interface PickerOption {
  id: string;
  label: string;
  description?: string;
}

/**
 * Seletor com busca NO SERVIDOR (cliente, caso…): nada de baixar a lista
 * inteira para o navegador. Padrão combobox (ARIA): digitar busca com atraso,
 * setas navegam, Enter escolhe, Esc fecha. `search` é uma Server Action de
 * listagem paginada (já autorizada e filtrada pela RLS).
 */
export function AsyncPicker({
  id,
  value,
  onChange,
  search,
  placeholder = "Digite para buscar",
  emptyText = "Nenhum resultado.",
  disabled,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
  "aria-required": required,
}: {
  id?: string;
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
  search: (q: string) => Promise<{ ok: true; options: PickerOption[] } | { ok: false; message: string }>;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
}) {
  const listId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [active, setActive] = useState(0);
  useDismiss(ref, open, () => setOpen(false));

  const run = useCallback(
    async (q: string) => {
      const mine = ++seq.current;
      setLoading(true);
      setError(undefined);
      const result = await search(q).catch(() => ({ ok: false as const, message: "Sem conexão com o servidor." }));
      if (mine !== seq.current) return;
      setLoading(false);
      if (result.ok) {
        setOptions(result.options);
        setActive(0);
      } else {
        setOptions([]);
        setError(result.message);
      }
    },
    [search],
  );
  const runLater = useDebouncedCallback((q: string) => void run(q));

  function choose(option: PickerOption) {
    onChange(option);
    setOpen(false);
    setText("");
  }

  if (value) {
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-line-strong bg-surface px-3 text-[13px]">
        <span className="min-w-0 truncate" id={id}>
          {value.label}
          {value.description && <span className="ml-2 text-[12px] text-muted">{value.description}</span>}
        </span>
        {!disabled && (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-navy-700 hover:underline"
            onClick={() => {
              onChange(null);
              setOpen(true);
              void run("");
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            <X className="size-3.5" aria-hidden />
            Trocar
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-required={required}
        disabled={disabled}
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        className={cn(
          "h-9 w-full rounded-md border border-line-strong bg-surface pl-8 pr-8 text-[13px] placeholder:text-subtle focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-gold/25",
          invalid && "border-danger",
        )}
        onFocus={() => {
          if (!open) {
            setOpen(true);
            void run(text);
          }
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          runLater(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && options[active]) {
            e.preventDefault();
            choose(options[active]);
          }
        }}
      />
      {loading && <Loader2 aria-hidden className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-subtle" />}
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[280px] overflow-auto rounded-md border border-line bg-surface py-1 shadow-overlay"
        >
          {error ? (
            <li className="px-3 py-2 text-[12.5px] text-danger" role="alert">
              {error}
            </li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-[12.5px] text-muted">{loading ? "Buscando…" : emptyText}</li>
          ) : (
            options.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn("cursor-pointer px-3 py-2 text-[13px]", i === active ? "bg-surface-muted" : "hover:bg-surface-muted")}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
              >
                <span className="block truncate text-foreground">{o.label}</span>
                {o.description && <span className="block truncate text-[11.5px] text-muted">{o.description}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
