"use client";

import { useFormContext, useWatch } from "react-hook-form";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { Field, Input } from "@/components/ui/form";
import { parsePercent } from "../schemas";

/**
 * Campos da divisão da parceria. Os dois lados são editáveis; ao digitar um
 * lado, o outro é sugerido como complemento. A soma precisa dar 100% —
 * validação no schema, com indicação visual imediata aqui.
 */
export function ShareFields({ partnerField, ownerField }: { partnerField: string; ownerField: string }) {
  const { register, setValue, control, formState } = useFormContext<Record<string, string>>();
  const [partnerRaw, ownerRaw] = useWatch({ control, name: [partnerField, ownerField] }) as [string, string];
  const partner = parsePercent(partnerRaw ?? "");
  const owner = parsePercent(ownerRaw ?? "");
  const sum = Math.round(((Number.isNaN(partner) ? 0 : partner) + (Number.isNaN(owner) ? 0 : owner)) * 100) / 100;
  const filled = !!partnerRaw && !!ownerRaw;
  const ok = filled && sum === 100;
  const errors = formState.errors as Record<string, { message?: string } | undefined>;

  function complement(value: string, target: string) {
    const n = parsePercent(value);
    if (!Number.isNaN(n) && n >= 0 && n <= 100) setValue(target, String(Math.round((100 - n) * 100) / 100), { shouldValidate: formState.isSubmitted });
  }

  return (
    <>
      <Field label="Participação do parceiro" requirement="required" error={errors[partnerField]?.message} hint="Percentual dos honorários de cada novo caso.">
        {(p) => (
          <div className="relative">
            <Input
              {...p}
              inputMode="decimal"
              placeholder="50"
              className="pr-8 tabular"
              {...register(partnerField, { onChange: (e) => complement(e.target.value, ownerField) })}
            />
            <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-subtle">
              %
            </span>
          </div>
        )}
      </Field>
      <Field label="Participação Bárbara Cardoso Advocacia" requirement="required" error={errors[ownerField]?.message}>
        {(p) => (
          <div className="relative">
            <Input
              {...p}
              inputMode="decimal"
              placeholder="50"
              className="pr-8 tabular"
              {...register(ownerField, { onChange: (e) => complement(e.target.value, partnerField) })}
            />
            <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-subtle">
              %
            </span>
          </div>
        )}
      </Field>
      <p className={cn("col-span-full -mt-1 flex items-center gap-1.5 text-[12px]", !filled ? "text-muted" : ok ? "text-success" : "text-danger")} aria-live="polite">
        {filled && (ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <CircleAlert className="size-3.5" aria-hidden />)}
        {!filled ? "A soma das duas participações deve ser 100%." : ok ? "Divisão válida: soma de 100%." : `Soma atual: ${sum}%. Ajuste para totalizar 100%.`}
      </p>
    </>
  );
}
