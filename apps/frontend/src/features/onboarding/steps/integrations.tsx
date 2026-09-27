"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { Check, Cpu, FileSearch, HardDrive, Lock, Mail, MessageCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  INTEGRATION_KINDS,
  INTEGRATION_KIND_LABEL,
  INTEGRATION_STATUS_LABEL,
  INTEGRATION_STATUS_TONE,
  type IntegrationKind,
} from "@/lib/constants/status";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { NotAvailable } from "@/components/ui/tooltip";
import { StepForm, StepSection } from "../components/step-section";
import { useOnboardingIntegrations, useRegisterStepForm } from "../hooks";
import { integrationsSchema, withDefaults, type IntegrationsValues } from "../schemas";
import type { StepProps } from "../types";

const ICON: Record<IntegrationKind, LucideIcon> = {
  AI_PROVIDER: Cpu,
  LEGAL_PROCESS: FileSearch,
  STORAGE: HardDrive,
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
};

const PURPOSE: Record<IntegrationKind, string> = {
  AI_PROVIDER: "Modelos usados pelos agentes do DG Brasil.",
  LEGAL_PROCESS: "Importação de movimentações e publicações. Fornecedor ainda não definido.",
  STORAGE: "Guarda dos documentos dos clientes.",
  EMAIL: "Envio de mensagens aprovadas e recebimento de documentos.",
  WHATSAPP: "Rascunhos de mensagens aprovadas para clientes.",
};

export function IntegrationsStep({ formId, answers, onSave, registerForm }: StepProps) {
  const integrations = useOnboardingIntegrations();
  const form = useForm<IntegrationsValues>({
    resolver: zodResolver(integrationsSchema),
    defaultValues: withDefaults({ connectLater: [], notes: "" }, answers),
  });
  const { register, control, handleSubmit, formState } = form;
  const { errors } = formState;
  useRegisterStepForm(form, registerForm);

  return (
    <StepForm id={formId} onSubmit={handleSubmit((v) => onSave(v))}>
      <p className="flex items-start gap-2 rounded-md border border-navy/20 bg-navy-50 px-3.5 py-2.5 text-[12.5px] text-foreground/85">
        <Lock className="mt-0.5 size-3.5 shrink-0 text-navy-600" aria-hidden />
        Nenhuma chave de API é pedida aqui. As credenciais serão configuradas em um backend seguro durante a implantação assistida.
      </p>

      <StepSection title="Serviços" columns={1}>
        <Controller
          control={control}
          name="connectLater"
          render={({ field }) => (
            <ul className="space-y-3">
              {INTEGRATION_KINDS.map((kind, i) => {
                const Icon = ICON[kind];
                const current = integrations.find((it) => it.kind === kind);
                const later = field.value.includes(kind);
                return (
                  <li key={kind} className="flex flex-wrap items-start gap-3.5 rounded-md border border-line p-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-muted text-navy-600">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold text-foreground">{INTEGRATION_KIND_LABEL[kind]}</p>
                        {current ? (
                          <StatusBadge status={current.status} labels={INTEGRATION_STATUS_LABEL} tones={INTEGRATION_STATUS_TONE} />
                        ) : (
                          <StatusBadge status="PENDING" labels={INTEGRATION_STATUS_LABEL} tones={INTEGRATION_STATUS_TONE} />
                        )}
                        <span className="text-[11px] text-subtle">Simulado</span>
                      </div>
                      <p className="mt-0.5 text-[12px] text-muted">{PURPOSE[kind]}</p>
                      {current?.statusMessage && <p className="mt-1 text-[11.5px] text-muted">{current.statusMessage}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <NotAvailable message="Conexão real disponível em uma próxima etapa, via backend seguro">
                        <Button size="sm" variant="secondary">
                          Conectar
                        </Button>
                      </NotAvailable>
                      <button
                        ref={i === 0 ? field.ref : undefined}
                        type="button"
                        aria-pressed={later}
                        onClick={() => field.onChange(later ? field.value.filter((k) => k !== kind) : [...field.value, kind])}
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40",
                          later ? "border-navy bg-navy text-white" : "border-line-strong bg-surface text-foreground hover:border-navy-600/50",
                        )}
                      >
                        {later && <Check className="size-3.5" aria-hidden />}
                        Conectar depois
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        />
      </StepSection>

      <StepSection columns={1}>
        <Field label="Observações para a implantação" requirement="optional" hint="Ex.: o escritório já usa um provedor de e-mail corporativo." error={errors.notes?.message}>
          {(p) => <Textarea {...p} rows={3} {...register("notes")} />}
        </Field>
      </StepSection>
    </StepForm>
  );
}
