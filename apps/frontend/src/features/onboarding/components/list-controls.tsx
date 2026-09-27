"use client";

import { useState, type Ref } from "react";
import { Plus, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, type FieldRequirement } from "@/components/ui/form";

/** Tags de texto livre (ex.: subáreas). Enter ou "Adicionar" inclui a tag. */
export function TagInput({
  label,
  value,
  onChange,
  requirement = "optional",
  hint,
  placeholder,
  inputRef,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  requirement?: FieldRequirement;
  hint?: string;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    if (!value.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setDraft("");
  };
  return (
    <Field label={label} requirement={requirement} hint={hint ?? "Pressione Enter para adicionar cada item."}>
      {(props) => (
        <div>
          <div className="flex gap-2">
            <Input
              {...props}
              ref={inputRef}
              value={draft}
              placeholder={placeholder}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button variant="secondary" onClick={add} icon={<Plus className="size-4" aria-hidden />}>
              Adicionar
            </Button>
          </div>
          {value.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`${label} adicionados`}>
              {value.map((tag) => (
                <li key={tag} className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-surface-muted pl-2.5 pr-1 text-[12.5px] text-foreground">
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remover ${tag}`}
                    onClick={() => onChange(value.filter((v) => v !== tag))}
                    className="rounded p-0.5 text-subtle hover:bg-surface-sunken hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}

/** Lista editável de frases (regras, mensagens frequentes). */
export function EditableList({
  legend,
  value,
  onChange,
  itemLabel,
  addLabel,
  placeholder,
  hint,
  requirement = "optional",
}: {
  legend: string;
  value: string[];
  onChange: (next: string[]) => void;
  itemLabel: string;
  addLabel: string;
  placeholder?: string;
  hint?: string;
  requirement?: FieldRequirement;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 flex w-full items-baseline justify-between">
        <span className="text-[12.5px] font-medium text-foreground">{legend}</span>
        <span className="text-[11px] text-subtle">{requirement === "recommended" ? "Recomendado" : "Opcional"}</span>
      </legend>
      {hint && <p className="mb-2 text-[11.5px] text-muted">{hint}</p>}
      <ol className="space-y-2">
        {value.map((item, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-[11.5px] tabular text-subtle" aria-hidden>
              {i + 1}.
            </span>
            <Input
              aria-label={`${itemLabel} ${i + 1}`}
              value={item}
              placeholder={placeholder}
              onChange={(e) => onChange(value.map((v, j) => (j === i ? e.target.value : v)))}
            />
            <IconButton label={`Remover ${itemLabel.toLowerCase()} ${i + 1}`} size="sm" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <X className="size-4" aria-hidden />
            </IconButton>
          </li>
        ))}
      </ol>
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => onChange([...value, ""])} icon={<Plus className="size-4" aria-hidden />}>
        {addLabel}
      </Button>
    </fieldset>
  );
}

/** Remove itens vazios e espaços antes de salvar. */
export function cleanList(list: string[]): string[] {
  return list.map((v) => v.trim()).filter(Boolean);
}
