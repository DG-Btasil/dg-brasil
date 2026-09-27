"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader, Steps, type StepState } from "@/components/ui/display";
import { missingDocumentCategories } from "@/lib/domain/analysis";
import { repositories } from "@/repositories";
import { useToast } from "@/store/ui-store";
import { ClientNotFound } from "@/features/clients/components/detail/client-not-found";
import { useClient, useClientDocuments } from "@/features/clients/hooks";
import { clientShortName } from "@/features/clients/utils";
import { useAgentMap, useClientAnalyses, useTemplates } from "../../hooks";
import { isActiveAnalysis } from "../../utils";
import { StepConfirm } from "./step-confirm";
import { StepDocuments } from "./step-documents";
import { fieldInputName, StepFields, validateTemplateFields } from "./step-fields";
import { StepTemplate } from "./step-template";

const STEP_LABELS = ["Área e tipo", "Documentação", "Dados específicos", "Confirmação"] as const;

export function AnalysisWizard({ clientId }: { clientId: string }) {
  const router = useRouter();
  const toast = useToast();
  const client = useClient(clientId);
  const documents = useClientDocuments(clientId);
  const analyses = useClientAnalyses(clientId);
  const templates = useTemplates();
  const agents = useAgentMap();

  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState<string | undefined>(() => templates.find((t) => t.active)?.id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const template = templates.find((t) => t.id === templateId && t.active);
  const missing = useMemo(
    () => (template && client ? missingDocumentCategories(template, client, documents) : []),
    [template, client, documents],
  );

  if (!client) return <ClientNotFound />;
  const active = analyses.find(isActiveAnalysis);
  const clientHref = `/clientes/${client.id}`;
  const agentName = (template && agents.get(template.primaryAgentId)?.name) ?? "agente da área";

  function next() {
    if (step === 0 && !template) return;
    if (step === 2 && template) {
      const found = validateTemplateFields(template.fields, values);
      setErrors(found);
      const first = template.fields.find((f) => found[f.key]);
      if (first) {
        document.querySelector<HTMLElement>(`[name="${fieldInputName(first.key)}"]`)?.focus();
        return;
      }
    }
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  async function submit() {
    if (!template || !client) return;
    setSubmitting(true);
    const fields = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));
    await repositories.analyses.start({ clientId: client.id, templateId: template.id, fields });
    toast({
      tone: "success",
      title: "Análise jurídica iniciada",
      description: missing.length ? "A análise aguarda os documentos pendentes." : `${agentName} iniciou a avaliação do material.`,
    });
    router.push(`${clientHref}?aba=analise`);
  }

  const steps = STEP_LABELS.map((label, i) => ({
    key: String(i),
    label,
    state: (i < step ? "done" : i === step ? "current" : "pending") as StepState,
  }));

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Clientes", href: "/clientes" },
          { label: clientShortName(client), href: clientHref },
          { label: "Iniciar análise jurídica" },
        ]}
        title="Iniciar análise jurídica"
        description={`Cliente: ${clientShortName(client)}. A análise coleta documentação e dados da relação e envia o material ao agente da área.`}
      />
      {active && !submitting ? (
        <Callout
          tone="warning"
          title="Este cliente já possui uma análise em andamento."
          action={
            <ButtonLink href={`${clientHref}?aba=analise`} variant="secondary" size="sm">
              Ver análise
            </ButtonLink>
          }
        >
          Conclua ou interrompa a análise atual antes de iniciar outra.
        </Callout>
      ) : (
        <>
          <nav aria-label="Etapas do assistente" className="mb-6 max-w-[900px]">
            <Steps steps={steps} />
          </nav>
          <div aria-live="polite">
            {step === 0 && <StepTemplate templates={templates} value={templateId} onChange={setTemplateId} />}
            {step === 1 && template && <StepDocuments template={template} client={client} documents={documents} missing={missing} />}
            {step === 2 && template && (
              <StepFields
                template={template}
                values={values}
                errors={errors}
                onChange={(key, v) => {
                  setValues((prev) => ({ ...prev, [key]: v }));
                  if (errors[key])
                    setErrors((prev) => {
                      const rest = { ...prev };
                      delete rest[key];
                      return rest;
                    });
                }}
              />
            )}
            {step === 3 && template && <StepConfirm template={template} client={client} values={values} missing={missing} agentName={agentName} />}
          </div>
          <div className="mt-8 flex max-w-[900px] items-center justify-between border-t border-line pt-5">
            <Button variant="secondary" onClick={() => (step === 0 ? router.push(clientHref) : setStep((s) => s - 1))} icon={step === 0 ? undefined : <ArrowLeft className="size-4" aria-hidden />}>
              {step === 0 ? "Cancelar" : "Voltar"}
            </Button>
            {step < STEP_LABELS.length - 1 ? (
              <Button onClick={next} disabled={!template}>
                {step === 1 && missing.length > 0 ? "Continuar mesmo assim" : "Continuar"}
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button onClick={submit} loading={submitting}>
                Iniciar análise
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}
