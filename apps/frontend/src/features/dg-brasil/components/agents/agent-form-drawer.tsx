"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileUp } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { CheckboxList } from "@/components/ui/checkbox-list";
import { Drawer } from "@/components/ui/dialog";
import { Checkbox, Field, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { AGENT_LIMITS, AGENT_READ_TOOLS, AI_EFFORT_LABEL, AI_EFFORTS, AI_MODELS, DEFAULT_AI_MODEL } from "@/lib/constants/ai";
import { AGENT_STATUSES, AGENT_STATUS_LABEL } from "@/lib/constants/status";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { saveDgAgentAction } from "@/server/domain/dg/actions";
import type { AgentDetailDTO, DgCatalogDTO } from "@/server/domain/dg/dto";
import { agentConfigSchema } from "@/server/domain/dg/schemas";
import { useToast } from "@/store/ui-store";
import { nameFromSlug, parseMarkdownWithFrontmatter } from "../../import-md";
import { dgRoutes } from "../../utils";

const formSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do agente.").max(120),
  description: z.string().max(2000).optional(),
  purpose: z.string().max(2000).optional(),
  status: z.enum(AGENT_STATUSES),
  instructions: z.string().trim().min(1, "As instruções do agente são obrigatórias.").max(200_000),
  config: agentConfigSchema,
  skillIds: z.array(z.string()).max(20, "No máximo 20 skills por agente."),
  thesisIds: z.array(z.string()),
  referenceIds: z.array(z.string()),
});
type FormValues = z.input<typeof formSchema>;

const DEFAULTS: FormValues = {
  name: "",
  description: "",
  purpose: "",
  status: "DRAFT",
  instructions: "",
  config: {
    model: DEFAULT_AI_MODEL,
    effort: "high",
    codeExecution: true,
    maxTurns: AGENT_LIMITS.maxTurns.default,
    maxToolCalls: AGENT_LIMITS.maxToolCalls.default,
    maxDurationSeconds: AGENT_LIMITS.maxDurationSeconds.default,
    maxBudgetUsd: AGENT_LIMITS.maxBudgetUsd.default,
    tools: [],
  },
  skillIds: [],
  thesisIds: [],
  referenceIds: [],
};

function fromAgent(a: AgentDetailDTO): FormValues {
  return {
    name: a.name, description: a.description ?? "", purpose: a.purpose ?? "", status: a.status, instructions: a.instructions,
    config: a.config, skillIds: a.skillIds, thesisIds: a.thesisIds, referenceIds: a.referenceIds,
  };
}

/**
 * Criar ou editar agente. Mudar instruções ou configuração gera uma VERSÃO
 * nova (a anterior fica no histórico e nas execuções que a usaram); nome,
 * situação e vínculos mudam sem versão. Tudo numa transação no banco.
 */
export function AgentFormDrawer({ open, onOpenChange, agent, catalog }: { open: boolean; onOpenChange: (o: boolean) => void; agent?: AgentDetailDTO; catalog: DgCatalogDTO }) {
  const formId = useId();
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const importRef = useRef<HTMLInputElement>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const initial = agent ? fromAgent(agent) : DEFAULTS;
  const { register, control, handleSubmit, reset, setValue, getValues, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initial,
  });
  const codeExecution = useWatch({ control, name: "config.codeExecution" });

  const close = () => {
    reset(initial);
    setImportNote(null);
    onOpenChange(false);
  };

  async function importMarkdown(file: File | undefined) {
    if (!file) return;
    const md = parseMarkdownWithFrontmatter(await file.text());
    if (!getValues("name") && md.name) setValue("name", nameFromSlug(md.name));
    if (md.description) setValue("description", md.description.slice(0, 2000));
    if (md.body) setValue("instructions", md.body, { shouldValidate: true });
    setImportNote(
      `Importado de ${file.name}.` +
        (md.ignored.length ? ` Não copiados: ${md.ignored.join(", ")} — no DG Brasil as ferramentas são as do catálogo e o modelo é escolhido abaixo.` : ""),
    );
    if (importRef.current) importRef.current.value = "";
  }

  const submit = handleSubmit(async (raw) => {
    const v = formSchema.parse(raw);
    const payload = {
      ...(agent ? { id: agent.id } : {}),
      name: v.name, description: v.description || undefined, purpose: v.purpose || undefined, status: v.status,
      instructions: v.instructions, config: v.config, skillIds: v.skillIds, thesisIds: v.thesisIds, referenceIds: v.referenceIds,
    };
    const r = await callAction(() => saveDgAgentAction({ ...payload, key: idempotency.keyFor(payload) }));
    if (!r.ok) {
      failed(r, "Não foi possível salvar o agente.");
      return;
    }
    idempotency.reset();
    toast({
      tone: "success",
      title: agent ? "Agente salvo" : "Agente criado",
      description: r.data.versionCreated ? `Versão ${r.data.versionNumber} criada. Execuções novas usam esta versão.` : "Sem mudança nas instruções: a versão continua a mesma.",
    });
    onOpenChange(false);
    if (!agent) router.push(dgRoutes.agent(r.data.id));
    else router.refresh();
  });

  const options = (list: { id: string; name: string }[]) => list.map((x) => ({ value: x.id, label: x.name }));

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      width={720}
      title={agent ? `Editar ${agent.name}` : "Criar agente"}
      description="As instruções do agente são as mesmas que você usa no Claude Code. Toda ação dele passa por Revisões."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={isSubmitting}>
            {agent ? "Salvar" : "Criar agente"}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-6">
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-line px-4 py-3">
          <p className="text-[12.5px] text-muted">Já tem o agente no Claude Code? Importe o arquivo .md (nome, descrição e instruções).</p>
          <input ref={importRef} type="file" accept=".md,text/markdown" className="sr-only" onChange={(e) => importMarkdown(e.target.files?.[0])} />
          <Button type="button" size="sm" variant="secondary" icon={<FileUp className="size-4" aria-hidden />} onClick={() => importRef.current?.click()}>
            Importar .md
          </Button>
        </div>
        {importNote && <Callout tone="info">{importNote}</Callout>}

        <FormSection title="Identificação">
          <div className="space-y-4">
            <Field label="Nome" requirement="required" error={errors.name?.message}>
              {(a) => <Input {...a} {...register("name")} placeholder="Ex.: Lucas · Kit de documentos" />}
            </Field>
            <Field label="Descrição" requirement="recommended" hint="Quando usar este agente (aparece na lista).">
              {(a) => <Textarea {...a} {...register("description")} rows={2} />}
            </Field>
            <Field label="Objetivo" requirement="optional">
              {(a) => <Textarea {...a} {...register("purpose")} rows={2} />}
            </Field>
            <Field label="Situação" requirement="required" hint="Só agente Ativo recebe execuções.">
              {(a) => <Select {...a} {...register("status")} options={AGENT_STATUSES.map((s) => ({ value: s, label: AGENT_STATUS_LABEL[s] }))} />}
            </Field>
          </div>
        </FormSection>

        <FormSection title="Instruções" description="O papel, as regras e o passo a passo do agente. Mudar o texto cria uma versão nova.">
          <Field label="Instruções do agente" requirement="required" error={errors.instructions?.message}>
            {(a) => <Textarea {...a} {...register("instructions")} rows={16} className="font-mono text-[12.5px]" />}
          </Field>
        </FormSection>

        <FormSection title="Execução" description="Modelo, ambiente isolado e limites de cada execução.">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Modelo" requirement="required" hint={AI_MODELS.find((m) => m.id === getValues("config.model"))?.note}>
                {(a) => <Select {...a} {...register("config.model")} options={AI_MODELS.map((m) => ({ value: m.id, label: m.label }))} />}
              </Field>
              <Field label="Esforço" requirement="required" hint="Mais esforço = mais cuidado e mais custo.">
                {(a) => <Select {...a} {...register("config.effort")} options={AI_EFFORTS.map((e) => ({ value: e, label: AI_EFFORT_LABEL[e] }))} />}
              </Field>
            </div>
            <Checkbox
              {...register("config.codeExecution")}
              label="Ambiente isolado (executar os scripts das skills)"
              description="Contêiner do provedor, sem internet e sem acesso ao DG Brasil. Necessário para skills com scripts e para gerar arquivos (PDF, DOCX)."
            />
            {!codeExecution && <Callout tone="warning">Sem ambiente isolado, as skills entram só como texto e o agente não gera arquivos.</Callout>}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Passos (máx.)" requirement="required" error={errors.config?.maxTurns?.message}>
                {(a) => <Input {...a} type="number" min={AGENT_LIMITS.maxTurns.min} max={AGENT_LIMITS.maxTurns.max} {...register("config.maxTurns", { valueAsNumber: true })} />}
              </Field>
              <Field label="Chamadas de ferramenta" requirement="required" error={errors.config?.maxToolCalls?.message}>
                {(a) => <Input {...a} type="number" min={AGENT_LIMITS.maxToolCalls.min} max={AGENT_LIMITS.maxToolCalls.max} {...register("config.maxToolCalls", { valueAsNumber: true })} />}
              </Field>
              <Field label="Tempo máx. (s)" requirement="required" error={errors.config?.maxDurationSeconds?.message}>
                {(a) => <Input {...a} type="number" min={AGENT_LIMITS.maxDurationSeconds.min} max={AGENT_LIMITS.maxDurationSeconds.max} {...register("config.maxDurationSeconds", { valueAsNumber: true })} />}
              </Field>
              <Field label="Teto de custo (US$)" requirement="required" error={errors.config?.maxBudgetUsd?.message}>
                {(a) => <Input {...a} type="number" step="0.05" min={AGENT_LIMITS.maxBudgetUsd.min} max={AGENT_LIMITS.maxBudgetUsd.max} {...register("config.maxBudgetUsd", { valueAsNumber: true })} />}
              </Field>
            </div>
            <Controller
              control={control}
              name="config.tools"
              render={({ field }) => (
                <CheckboxList
                  legend="Restringir ferramentas de leitura"
                  hint="Nada marcado = todas. Propor, entregar minuta e entregar análise ficam sempre disponíveis (e sempre passam por revisão)."
                  options={AGENT_READ_TOOLS.map((t) => ({ value: t.id, label: t.label }))}
                  value={field.value ?? []}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
        </FormSection>

        <FormSection title="Conhecimento" description="O que o agente pode usar. Teses e referências ele consulta quando precisa.">
          <div className="space-y-4">
            <Controller control={control} name="skillIds" render={({ field }) => (
              <CheckboxList legend="Skills" hint={errors.skillIds?.message ?? "Até 20."} options={options(catalog.skills)} value={field.value} onChange={field.onChange} emptyText="Nenhuma skill cadastrada." />
            )} />
            <Controller control={control} name="thesisIds" render={({ field }) => (
              <CheckboxList legend="Teses autorizadas" hint="Só teses ativas são entregues ao agente." options={options(catalog.theses)} value={field.value} onChange={field.onChange} emptyText="Nenhuma tese cadastrada." />
            )} />
            <Controller control={control} name="referenceIds" render={({ field }) => (
              <CheckboxList legend="Referências" options={options(catalog.references)} value={field.value} onChange={field.onChange} emptyText="Nenhuma referência cadastrada." />
            )} />
          </div>
        </FormSection>
      </form>
    </Drawer>
  );
}
