"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Landmark, ShieldCheck } from "lucide-react";
import { callAction, mapFieldErrors } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { Callout } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader, Steps, type StepState } from "@/components/ui/display";
import { Checkbox, ChoiceCards, Field, Input, Select, Textarea } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { startAnalysisAction } from "@/server/domain/analyses/actions";
import type { AnalysisTemplateSetupDTO, TemplateFieldDTO } from "@/server/domain/analyses/dto";
import { useToast } from "@/store/ui-store";
import { fieldInputName, fieldsPayload, formatFieldValue, validateFields } from "../../fields";

const STEP_LABELS = ["Modelo", "Documentação", "Dados específicos", "Confirmação"] as const;

/**
 * Nova análise jurídica de um CASO (startAnalysisAction → migration 029):
 * modelo do catálogo real, checklist de documentos do caso, campos do
 * template e confirmação. "Enviar ao agente agora" cria a análise e enfileira
 * a execução NUMA transação; sem isso, a análise fica pendente e é enviada
 * depois pela aba Análise. Chave de idempotência por intenção de envio.
 * Nenhuma IA roda aqui: enviar = enfileirar.
 */
export function AnalysisWizard({
  legalCase,
  templates,
  inFlightId,
  pendingId,
}: {
  legalCase: { id: string; title: string; clientName: string };
  templates: AnalysisTemplateSetupDTO[];
  /** Análise com o agente ou aguardando revisão: não se inicia outra. */
  inFlightId?: string;
  /** Análise criada e ainda não enviada: só um aviso. */
  pendingId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState<string | undefined>(templates[0]?.id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [send, setSend] = useState(true);
  const [requestText, setRequestText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const template = templates.find((t) => t.id === templateId);
  const missing = template ? template.requirements.filter((r) => r.required && !r.satisfied) : [];
  const canSend = !!template?.hasAgent && missing.length === 0;
  const caseHref = `/casos/${legalCase.id}`;

  function next() {
    if (step === 0 && !template) return;
    if (step === 2 && template) {
      const found = validateFields(template.fields, values);
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
    if (!template || submitting) return;
    const payload = {
      legalCaseId: legalCase.id,
      templateId: template.id,
      fields: fieldsPayload(template.fields, values),
      send: send && canSend,
      requestText: send && canSend ? requestText.trim() || undefined : undefined,
    };
    setSubmitting(true);
    const result = await callAction(() => startAnalysisAction({ ...payload, idempotencyKey: idempotency.keyFor(payload) }));
    setSubmitting(false);
    if (!result.ok) {
      const keys = new Set(template.fields.map((f) => f.key));
      const fields = Object.fromEntries(Object.entries(mapFieldErrors(result.error.fieldErrors, {}, "fields.")).filter(([k]) => keys.has(k)));
      if (Object.keys(fields).length > 0) {
        setErrors(fields);
        setStep(2);
      }
      failed(result, "Não foi possível iniciar a análise.");
      return;
    }
    idempotency.reset();
    toast({
      tone: "success",
      title: result.data.agentRunId ? "Análise enviada ao agente" : "Análise criada",
      description: result.data.agentRunId ? "O resultado chegará em Revisões. Nada segue sem aprovação humana." : "Envie ao agente pela aba Análise quando estiver pronta.",
    });
    router.push(`${caseHref}?aba=analise`);
  }

  const steps = STEP_LABELS.map((label, i) => ({ key: String(i), label, state: (i < step ? "done" : i === step ? "current" : "pending") as StepState }));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Casos", href: "/casos" }, { label: legalCase.title, href: caseHref }, { label: "Iniciar análise jurídica" }]}
        title="Iniciar análise jurídica"
        description={`Caso: ${legalCase.title}${legalCase.clientName ? ` · Cliente: ${legalCase.clientName}` : ""}. A análise reúne documentação e dados da relação e envia o material ao agente da área.`}
      />
      {inFlightId ? (
        <Callout
          tone="warning"
          title="Este caso já possui uma análise em andamento."
          action={
            <ButtonLink href={`${caseHref}?aba=analise`} variant="secondary" size="sm">
              Ver análise
            </ButtonLink>
          }
        >
          Aguarde o agente concluir e a revisão humana antes de iniciar outra.
        </Callout>
      ) : templates.length === 0 ? (
        <Callout tone="neutral" title="Nenhum modelo de análise ativo para a área deste caso.">
          Os modelos são configurados pelo administrador do DG Brasil.
        </Callout>
      ) : (
        <>
          {pendingId && (
            <Callout tone="info" title="Já existe uma análise deste caso ainda não enviada ao agente." className="mb-5 max-w-[900px]">
              Você pode enviá-la pela aba Análise do caso ou criar outra aqui.
            </Callout>
          )}
          <nav aria-label="Etapas do assistente" className="mb-6 max-w-[900px]">
            <Steps steps={steps} />
          </nav>
          <div aria-live="polite">
            {step === 0 && (
              <div className="max-w-[900px] space-y-5">
                <div>
                  <h2 className="text-[15px] font-semibold text-foreground">Modelo de análise</h2>
                  <p className="mt-0.5 text-[13px] text-muted">Cada modelo define os documentos exigidos, os dados a coletar e o agente responsável.</p>
                </div>
                <ChoiceCards
                  name="analysis-template"
                  legend="Modelo de análise"
                  value={templateId}
                  onChange={setTemplateId}
                  options={templates.map((t) => ({
                    value: t.id,
                    label: t.name,
                    description: [t.description, t.hasAgent ? undefined : "Sem agente configurado: a análise pode ser criada, mas não enviada."].filter(Boolean).join(" "),
                    icon: <Landmark className="size-5" aria-hidden />,
                  }))}
                />
              </div>
            )}
            {step === 1 && template && <DocumentsStep template={template} caseHref={caseHref} />}
            {step === 2 && template && (
              <FieldsStep
                fields={template.fields}
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
            {step === 3 && template && (
              <div className="max-w-[900px] space-y-5">
                <Panel>
                  <PanelHeader title="Resumo" as="h3" />
                  <PanelBody className="space-y-5">
                    <DefinitionGrid
                      columns={3}
                      items={[
                        { label: "Cliente", value: legalCase.clientName || undefined },
                        { label: "Modelo", value: template.name },
                        { label: "Documentação", value: missing.length ? `Pendente: ${missing.map((m) => m.label).join(", ")}` : "Completa", wide: true },
                      ]}
                    />
                    {template.fields.length > 0 && (
                      <div className="border-t border-line pt-4">
                        <DefinitionGrid columns={3} items={template.fields.map((f) => ({ label: f.label, value: formatFieldValue(f, fieldsPayload([f], values)[f.key]), wide: f.type === "textarea" }))} />
                      </div>
                    )}
                  </PanelBody>
                </Panel>
                <Panel>
                  <PanelBody className="space-y-3">
                    <Checkbox
                      label="Enviar ao agente agora"
                      checked={send && canSend}
                      disabled={!canSend}
                      onChange={(e) => setSend(e.target.checked)}
                    />
                    {!template.hasAgent ? (
                      <p className="text-[12.5px] text-muted">Este modelo não tem agente configurado: a análise será criada e poderá ser enviada quando houver agente.</p>
                    ) : missing.length > 0 ? (
                      <p className="text-[12.5px] text-muted">Faltam documentos obrigatórios: a análise será criada e enviada depois, pela aba Análise.</p>
                    ) : (
                      send && (
                        <Field label="Pedido ao agente" requirement="optional" hint="Orientação para esta análise. Fica registrada na execução, nunca em log.">
                          {(p) => <Textarea {...p} rows={3} maxLength={20_000} value={requestText} onChange={(e) => setRequestText(e.target.value)} />}
                        </Field>
                      )
                    )}
                  </PanelBody>
                </Panel>
                <Callout tone="neutral" title="O que acontece a seguir">
                  <span className="inline-flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-navy-700" aria-hidden />
                    <span>
                      {send && canSend
                        ? "A análise e o pedido ao agente são registrados juntos. O resultado irá para Revisões; nenhuma ação externa será tomada sem aprovação humana."
                        : "A análise ficará pendente no caso até ser enviada ao agente."}
                    </span>
                  </span>
                </Callout>
              </div>
            )}
          </div>
          <div className="mt-8 flex max-w-[900px] items-center justify-between border-t border-line pt-5">
            <Button
              variant="secondary"
              onClick={() => (step === 0 ? router.push(caseHref) : setStep((s) => s - 1))}
              icon={step === 0 ? undefined : <ArrowLeft className="size-4" aria-hidden />}
              disabled={submitting}
            >
              {step === 0 ? "Cancelar" : "Voltar"}
            </Button>
            {step < STEP_LABELS.length - 1 ? (
              <Button onClick={next} disabled={!template}>
                {step === 1 && missing.length > 0 ? "Continuar mesmo assim" : "Continuar"}
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button onClick={submit} loading={submitting}>
                {send && canSend ? "Iniciar e enviar ao agente" : "Criar análise"}
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}

function DocumentsStep({ template, caseHref }: { template: AnalysisTemplateSetupDTO; caseHref: string }) {
  const missing = template.requirements.filter((r) => r.required && !r.satisfied);
  return (
    <div className="max-w-[900px] space-y-5">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">Verificar documentação</h2>
        <p className="mt-0.5 text-[13px] text-muted">Documentos exigidos pelo modelo, conferidos contra os documentos e pendências do caso.</p>
      </div>
      {missing.length > 0 ? (
        <Callout
          tone="warning"
          title="Para enviar ao agente, ainda são necessários os seguintes documentos."
          action={
            <ButtonLink href={`${caseHref}?aba=documentos`} variant="secondary" size="sm" icon={<ExternalLink className="size-3.5" aria-hidden />}>
              Documentos do caso
            </ButtonLink>
          }
        >
          <p>{missing.map((m) => m.label).join(", ")}.</p>
          <p className="mt-1">Você pode continuar: a análise será criada e enviada depois, quando os documentos estiverem no caso.</p>
        </Callout>
      ) : (
        <Callout tone="success" title="Documentação pronta para análise.">
          Todos os documentos obrigatórios estão no caso.
        </Callout>
      )}
      {template.requirements.length > 0 && (
        <Panel>
          <Table caption="Documentos exigidos pela análise">
            <THead>
              <tr>
                <Th>Documento</Th>
                <Th>Exigência</Th>
                <Th>Situação</Th>
              </tr>
            </THead>
            <TBody>
              {template.requirements.map((r) => (
                <Tr key={`${r.category}-${r.label}`}>
                  <Td>
                    <span className="block text-foreground">{r.label}</span>
                    {r.description && <span className="block text-[12px] text-muted">{r.description}</span>}
                  </Td>
                  <Td>
                    <Badge tone={r.required ? "navy" : "neutral"}>{r.required ? "Obrigatório" : "Recomendado"}</Badge>
                  </Td>
                  <Td>{r.satisfied ? <Badge tone="success">No caso</Badge> : <Badge tone={r.required ? "warning" : "neutral"}>Faltando</Badge>}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}

type A11yProps = { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string; "aria-required"?: boolean };

function FieldControl({ field, value, onChange, a11y }: { field: TemplateFieldDTO; value: string; onChange: (v: string) => void; a11y: A11yProps }) {
  const props = { ...a11y, name: fieldInputName(field.key), value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  switch (field.type) {
    case "textarea":
      return <Textarea rows={4} maxLength={5000} {...props} />;
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
      return <Input maxLength={5000} {...props} />;
  }
}

function FieldsStep({
  fields,
  values,
  errors,
  onChange,
}: {
  fields: TemplateFieldDTO[];
  values: Record<string, string>;
  errors: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">Dados específicos</h2>
        <p className="mt-0.5 text-[13px] text-muted">Informações da relação analisada. Ficam registradas na análise, não no cadastro do cliente.</p>
      </div>
      {fields.length === 0 ? (
        <p className="text-[13px] text-muted">Este modelo não pede dados adicionais.</p>
      ) : (
        <div className="grid max-w-[900px] grid-cols-2 gap-x-5 gap-y-4 rounded-lg border border-line bg-surface p-6 shadow-hairline">
          {fields.map((f) => (
            <Field key={f.key} label={f.label} requirement={f.required ? "required" : "optional"} hint={f.helpText} error={errors[f.key]} className={f.type === "textarea" ? "col-span-2" : undefined}>
              {(a11y) => <FieldControl field={f} value={values[f.key] ?? ""} onChange={(v) => onChange(f.key, v)} a11y={a11y} />}
            </Field>
          ))}
        </div>
      )}
    </div>
  );
}
