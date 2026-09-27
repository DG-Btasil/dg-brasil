"use client";

import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { msg, parseCurrencyInput } from "@/lib/validation";
import type { AnalysisTemplate, TemplateField } from "@/types";

/** Nome do controle no DOM, usado para focar o primeiro campo inválido. */
export const fieldInputName = (key: string) => `analysis-field-${key}`;

/** Validação construída a partir do template (obrigatoriedade e formato). */
export function validateTemplateFields(fields: TemplateField[], values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.key] ?? "").trim();
    if (!v) {
      if (f.required) errors[f.key] = msg.required;
      continue;
    }
    if (f.type === "number" && !Number.isFinite(Number(v.replace(",", ".")))) errors[f.key] = "Informe um número válido.";
    if (f.type === "currency") {
      const n = parseCurrencyInput(v);
      if (n === undefined) errors[f.key] = "Informe um valor válido.";
      else if (n < 0) errors[f.key] = msg.positive;
    }
    if (f.type === "date" && Number.isNaN(Date.parse(v))) errors[f.key] = msg.date;
    if (f.type === "select" && f.options && !f.options.some((o) => o.value === v)) errors[f.key] = "Selecione uma opção válida.";
  }
  return errors;
}

type A11yProps = { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string; "aria-required"?: boolean };

function FieldControl({ field, value, onChange, a11y }: { field: TemplateField; value: string; onChange: (v: string) => void; a11y: A11yProps }) {
  const props = { ...a11y, name: fieldInputName(field.key), value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  switch (field.type) {
    case "textarea":
      return <Textarea rows={4} {...props} />;
    case "select":
      return <Select placeholder="Selecione" options={field.options ?? []} {...props} />;
    case "boolean":
      return (
        <Select
          placeholder="Selecione"
          options={[
            { value: "true", label: "Sim" },
            { value: "false", label: "Não" },
          ]}
          {...props}
        />
      );
    case "date":
      return <Input type="date" {...props} />;
    case "number":
      return <Input inputMode="decimal" placeholder="0,00" {...props} />;
    case "currency":
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-subtle" aria-hidden>
            R$
          </span>
          <Input inputMode="decimal" placeholder="0,00" className="pl-9 tabular" {...props} />
        </div>
      );
    default:
      return <Input {...props} />;
  }
}

export function StepFields({
  template,
  values,
  errors,
  onChange,
}: {
  template: AnalysisTemplate;
  values: Record<string, string>;
  errors: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">Dados específicos</h2>
        <p className="mt-0.5 text-[13px] text-muted">
          Informações da relação analisada. Ficam registradas na análise, não no cadastro do cliente.
        </p>
      </div>
      <div className="grid max-w-[900px] grid-cols-2 gap-x-5 gap-y-4 rounded-lg border border-line bg-surface p-6 shadow-hairline">
        {template.fields.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            requirement={f.required ? "required" : "optional"}
            hint={f.helpText}
            error={errors[f.key]}
            className={f.type === "textarea" ? "col-span-2" : undefined}
          >
            {(a11y) => <FieldControl field={f} value={values[f.key] ?? ""} onChange={(v) => onChange(f.key, v)} a11y={a11y} />}
          </Field>
        ))}
      </div>
    </div>
  );
}
