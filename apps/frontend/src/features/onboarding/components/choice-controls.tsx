"use client";

import { useId, type ReactNode, type Ref } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

interface Option<V extends string> {
  value: V;
  label: string;
  description?: string;
}

function GroupShell({
  legend,
  requirement,
  hint,
  error,
  errorId,
  children,
}: {
  legend: string;
  requirement?: "required" | "recommended" | "optional";
  hint?: string;
  error?: string;
  errorId: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="min-w-0" aria-describedby={error ? errorId : undefined}>
      <legend className="mb-1.5 flex w-full items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-medium text-foreground">
          {legend}
          {requirement === "required" && (
            <span className="ml-0.5 text-danger" aria-hidden>
              *
            </span>
          )}
          {requirement === "required" && <span className="sr-only"> (obrigatório)</span>}
        </span>
        {requirement && requirement !== "required" && (
          <span className={cn("text-[11px]", requirement === "recommended" ? "text-gold-600" : "text-subtle")}>
            {requirement === "recommended" ? "Recomendado" : "Opcional"}
          </span>
        )}
      </legend>
      {hint && <p className="mb-2 text-[11.5px] text-muted">{hint}</p>}
      {children}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-[11.5px] font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Grupo de chips alternáveis (seleção múltipla). Cada chip é um botão com aria-pressed. */
export function ToggleChips<V extends string>({
  legend,
  options,
  value,
  onChange,
  requirement,
  hint,
  error,
  inputRef,
  size = "md",
}: {
  legend: string;
  options: readonly Option<V>[];
  value: readonly V[];
  onChange: (next: V[]) => void;
  requirement?: "required" | "recommended" | "optional";
  hint?: string;
  error?: string;
  /** Recebe o foco quando o campo é inválido (React Hook Form). */
  inputRef?: Ref<HTMLButtonElement>;
  size?: "sm" | "md";
}) {
  const errorId = useId();
  const selected = new Set(value);
  const toggle = (v: V) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <GroupShell legend={legend} requirement={requirement} hint={hint} error={error} errorId={errorId}>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o, i) => {
          const on = selected.has(o.value);
          return (
            <button
              key={o.value}
              ref={i === 0 ? inputRef : undefined}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(o.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40",
                size === "sm" ? "h-7 px-2 text-[12px]" : "h-8 px-2.5 text-[12.5px]",
                on ? "border-navy bg-navy text-white" : "border-line-strong bg-surface text-foreground hover:border-navy-600/50",
                error && !on && "border-danger/60",
              )}
            >
              {on && <Check className="size-3.5" aria-hidden />}
              {o.label}
            </button>
          );
        })}
      </div>
    </GroupShell>
  );
}

/** Controle segmentado (escolha única) com rádios nativos: setas do teclado funcionam. */
export function Segmented<V extends string>({
  legend,
  options,
  value,
  onChange,
  requirement,
  hint,
  error,
  inputRef,
}: {
  legend: string;
  options: readonly Option<V>[];
  value: V | undefined;
  onChange: (next: V) => void;
  requirement?: "required" | "recommended" | "optional";
  hint?: string;
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const name = useId();
  const errorId = useId();
  return (
    <GroupShell legend={legend} requirement={requirement} hint={hint} error={error} errorId={errorId}>
      <div className="inline-flex rounded-md border border-line-strong bg-surface-muted p-0.5">
        {options.map((o, i) => {
          const on = value === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                "relative cursor-pointer rounded-[5px] px-3.5 py-1.5 text-[12.5px] font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold/40",
                on ? "bg-surface text-navy shadow-hairline" : "text-muted hover:text-foreground",
              )}
            >
              <input
                ref={i === 0 ? inputRef : undefined}
                type="radio"
                name={name}
                value={o.value}
                checked={on}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              {o.label}
            </label>
          );
        })}
      </div>
    </GroupShell>
  );
}

/** Cartões de rádio com descrição (ex.: limite de autonomia). */
export function RadioCards<V extends string>({
  legend,
  options,
  value,
  onChange,
  inputRef,
  hint,
}: {
  legend: string;
  options: readonly Option<V>[];
  value: V | undefined;
  onChange: (next: V) => void;
  inputRef?: Ref<HTMLInputElement>;
  hint?: string;
}) {
  const name = useId();
  const errorId = useId();
  return (
    <GroupShell legend={legend} requirement="required" hint={hint} errorId={errorId}>
      <div className="grid gap-2">
        {options.map((o, i) => {
          const on = value === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border bg-surface px-4 py-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold/40",
                on ? "border-navy ring-1 ring-navy" : "border-line-strong hover:border-navy-600/50",
              )}
            >
              <input
                ref={i === 0 ? inputRef : undefined}
                type="radio"
                name={name}
                value={o.value}
                checked={on}
                onChange={() => onChange(o.value)}
                className="mt-0.5 size-4 shrink-0 accent-navy"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-foreground">{o.label}</span>
                {o.description && <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{o.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </GroupShell>
  );
}
