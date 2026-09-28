"use client";

import { Checkbox } from "@/components/ui/form";

/** Lista de seleção múltipla com rolagem (ex.: Skills, agentes, tribunais). */
export function CheckboxList({
  legend,
  hint,
  options,
  value,
  onChange,
  emptyText = "Nenhum item disponível.",
}: {
  legend: string;
  hint?: string;
  options: { value: string; label: string; description?: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyText?: string;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-[12.5px] font-medium text-foreground">{legend}</legend>
      {hint && <p className="-mt-1 mb-2 text-[11.5px] text-muted">{hint}</p>}
      {options.length === 0 ? (
        <p className="text-[12.5px] text-subtle">{emptyText}</p>
      ) : (
        <div className="max-h-[200px] space-y-1.5 overflow-y-auto rounded-md border border-line px-3 py-2.5">
          {options.map((o) => (
            <Checkbox
              key={o.value}
              label={o.label}
              description={o.description}
              checked={value.includes(o.value)}
              onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}
