"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { INPUT_MASKS, type InputMaskName } from "@/lib/formatting/masks";

const control =
  "w-full rounded-md border border-line-strong bg-surface px-3 text-[13px] text-foreground placeholder:text-subtle " +
  "transition-colors hover:border-navy-600/40 focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-gold/25 " +
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-muted aria-invalid:border-danger aria-invalid:focus:ring-danger/15";

export type FieldRequirement = "required" | "recommended" | "optional";

const REQUIREMENT_LABEL: Record<FieldRequirement, string> = {
  required: "Obrigatório",
  recommended: "Recomendado",
  optional: "Opcional",
};

interface FieldProps {
  label: string;
  /** Deixa explícito se é obrigatório, recomendado ou opcional (minimização de dados). */
  requirement?: FieldRequirement;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string; "aria-required"?: boolean }) => ReactNode;
}

/** Envolve um controle com rótulo, marcador de exigência, dica e erro acessíveis. */
export function Field({ label, requirement, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[12.5px] font-medium text-foreground">
          {label}
          {requirement === "required" && (
            <span className="ml-0.5 text-danger" aria-hidden>
              *
            </span>
          )}
        </label>
        {requirement && requirement !== "required" && (
          <span className={cn("text-[11px]", requirement === "recommended" ? "text-[#7a5f0e]" : "text-subtle")}>
            {REQUIREMENT_LABEL[requirement]}
          </span>
        )}
      </div>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy, "aria-required": requirement === "required" || undefined })}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-[11.5px] text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-[11.5px] font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(control, "h-9", className)} {...props} />;
});

interface MaskedInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  mask: InputMaskName;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Input com máscara aplicada na digitação. Compatível com `register` do
 * React Hook Form (o valor mascarado é propagado no onChange).
 */
export const MaskedInput = forwardRef<HTMLInputElement, MaskedInputProps>(function MaskedInput({ mask, onChange, className, ...props }, ref) {
  return (
    <input
      ref={ref}
      inputMode={mask === "oab" ? "text" : "numeric"}
      className={cn(control, "h-9 tabular", className)}
      onChange={(event) => {
        event.target.value = INPUT_MASKS[mask](event.target.value);
        onChange?.(event);
      }}
      {...props}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 4, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(control, "py-2 leading-relaxed", className)} {...props} />;
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: readonly { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ options, placeholder, className, ...props }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(control, "h-9 cursor-pointer appearance-none pr-8", className)} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
    </div>
  );
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }>(
  function Checkbox({ label, description, className, id, ...props }, ref) {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <label htmlFor={inputId} className={cn("flex cursor-pointer items-start gap-2.5", className)}>
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-xs border-line-strong accent-navy"
          {...props}
        />
        <span>
          <span className="block text-[13px] text-foreground">{label}</span>
          {description && <span className="block text-[12px] text-muted">{description}</span>}
        </span>
      </label>
    );
  },
);

/** Busca com ícone, usada nos filtros das listagens. */
export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn("relative", className)}>
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input type="search" className={cn(control, "h-9 pl-8")} {...props} />
    </div>
  );
}

interface ChoiceCardOption<V extends string> {
  value: V;
  label: string;
  description?: string;
  icon?: ReactNode;
}

/** Grupo de escolha em cartões (ex.: Pessoa Física / Pessoa Jurídica). */
export function ChoiceCards<V extends string>({
  name,
  value,
  onChange,
  options,
  className,
  legend,
}: {
  name: string;
  value: V | undefined;
  onChange: (value: V) => void;
  options: ChoiceCardOption<V>[];
  className?: string;
  legend: string;
}) {
  return (
    <fieldset className={className}>
      <legend className="sr-only">{legend}</legend>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-4 transition-colors",
                checked ? "border-navy ring-1 ring-navy" : "border-line-strong hover:border-navy-600/50",
              )}
            >
              <input type="radio" name={name} value={o.value} checked={checked} onChange={() => onChange(o.value)} className="sr-only" />
              {o.icon && <span className={cn("mt-0.5", checked ? "text-navy" : "text-subtle")}>{o.icon}</span>}
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-foreground">{o.label}</span>
                {o.description && <span className="mt-0.5 block text-[12px] text-muted">{o.description}</span>}
              </span>
              <span
                aria-hidden
                className={cn(
                  "ml-auto mt-0.5 size-4 shrink-0 rounded-full border",
                  checked ? "border-[5px] border-navy" : "border-line-strong",
                )}
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Agrupamento semântico de campos em formulários longos. */
export function FormSection({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid grid-cols-[240px_minmax(0,1fr)] gap-8 border-b border-line py-7 last:border-b-0", className)}>
      <div>
        <h3 className="text-[13.5px] font-semibold text-foreground">{title}</h3>
        {description && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{description}</p>}
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">{children}</div>
    </section>
  );
}
