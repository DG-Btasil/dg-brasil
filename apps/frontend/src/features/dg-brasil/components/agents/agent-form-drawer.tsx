"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileUp } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { CheckboxList } from "@/components/ui/checkbox-list";
import { Drawer } from "@/components/ui/dialog";
import { Field, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { LOCAL_AGENT_NAME } from "@/lib/constants/ai";
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
  instructions: z.string().trim().min(1, "Escreva as orientações do DG Brasil para este agente.").max(200_000),
  config: agentConfigSchema,
  thesisIds: z.array(z.string()),
  referenceIds: z.array(z.string()),
});
type FormValues = z.input<typeof formSchema>;

/** Ponto de partida das orientações: o que o DG Brasil espera receber. */
export const DEFAULT_DG_INSTRUCTIONS = [
  "Como entregar no DG Brasil:",
  "- Análise: entregue o resultado estruturado com entregar_analise.",
  "- Documentos gerados (procuração, petição, declaração): um arquivo por documento, com entregar_minuta.",
  "- Providências (prazo, pedir documento ao cliente/parceiro, atualizar o caso): propor.",
  "- Use só os documentos baixados na pasta do trabalho. Se faltar algo, diga o que falta na entrega.",
  "- Nunca escreva ao cliente nem diga que algo foi enviado ou protocolado: tudo passa por um advogado.",
].join("\n");

const DEFAULTS: FormValues = {
  name: "",
  description: "",
  purpose: "",
  status: "DRAFT",
  instructions: DEFAULT_DG_INSTRUCTIONS,
  config: { localAgent: "" },
  thesisIds: [],
  referenceIds: [],
};

function fromAgent(a: AgentDetailDTO): FormValues {
  return {
    name: a.name, description: a.description ?? "", purpose: a.purpose ?? "", status: a.status, instructions: a.instructions,
    config: a.config, thesisIds: a.thesisIds, referenceIds: a.referenceIds,
  };
}

/**
 * Criar ou editar o REGISTRO de um agente. Quem faz o trabalho é o agente com
 * o mesmo nome no Claude Code do escritório (as instruções e skills dele ficam
 * lá). Aqui: qual agente local, as orientações do DG Brasil (o que entregar) e
 * o conhecimento autorizado. Mudar orientações ou agente local gera VERSÃO
 * nova (a anterior fica no histórico e nas execuções que a usaram).
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

  const close = () => {
    reset(initial);
    setImportNote(null);
    onOpenChange(false);
  };

  /** Lê o .md do agente no Claude Code só para preencher nome, agente local e descrição. */
  async function importMarkdown(file: File | undefined) {
    if (!file) return;
    const md = parseMarkdownWithFrontmatter(await file.text());
    if (md.name && LOCAL_AGENT_NAME.test(md.name)) setValue("config.localAgent", md.name, { shouldValidate: true });
    if (!getValues("name") && md.name) setValue("name", nameFromSlug(md.name));
    if (md.description) setValue("description", md.description.slice(0, 2000));
    setImportNote(`Preenchido a partir de ${file.name}: nome do agente local e descrição. As instruções e skills do agente continuam no Claude Code do escritório.`);
    if (importRef.current) importRef.current.value = "";
  }

  const submit = handleSubmit(async (raw) => {
    const v = formSchema.parse(raw);
    const payload = {
      ...(agent ? { id: agent.id } : {}),
      name: v.name, description: v.description || undefined, purpose: v.purpose || undefined, status: v.status,
      instructions: v.instructions, config: v.config, thesisIds: v.thesisIds, referenceIds: v.referenceIds,
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
      description: r.data.versionCreated ? `Versão ${r.data.versionNumber} criada. Trabalhos novos usam esta versão.` : "Sem mudança nas orientações: a versão continua a mesma.",
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
      title={agent ? `Editar ${agent.name}` : "Cadastrar agente"}
      description="O agente trabalha no Claude Code do computador do escritório. Tudo o que ele entrega passa por Revisões."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={isSubmitting}>
            {agent ? "Salvar" : "Cadastrar agente"}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-6">
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-line px-4 py-3">
          <p className="text-[12.5px] text-muted">Tem o arquivo .md do agente no Claude Code? Importe para preencher o nome e a descrição.</p>
          <input ref={importRef} type="file" accept=".md,text/markdown" className="sr-only" onChange={(e) => importMarkdown(e.target.files?.[0])} />
          <Button type="button" size="sm" variant="secondary" icon={<FileUp className="size-4" aria-hidden />} onClick={() => importRef.current?.click()}>
            Importar .md
          </Button>
        </div>
        {importNote && <Callout tone="info">{importNote}</Callout>}

        <FormSection title="Identificação">
          <div className="space-y-4">
            <Field label="Nome" requirement="required" error={errors.name?.message}>
              {(a) => <Input {...a} {...register("name")} placeholder="Ex.: Clara · Análise do HISCON" />}
            </Field>
            <Field
              label="Agente no Claude Code"
              requirement="required"
              error={errors.config?.localAgent?.message}
              hint="O nome do agente como está no Claude Code do escritório (o name do arquivo .md), ex.: clara-hiscon."
            >
              {(a) => <Input {...a} {...register("config.localAgent")} placeholder="clara-hiscon" className="font-mono" autoComplete="off" spellCheck={false} />}
            </Field>
            <Field label="Descrição" requirement="recommended" hint="Quando usar este agente (aparece na lista).">
              {(a) => <Textarea {...a} {...register("description")} rows={2} />}
            </Field>
            <Field label="Objetivo" requirement="optional">
              {(a) => <Textarea {...a} {...register("purpose")} rows={2} />}
            </Field>
            <Field label="Situação" requirement="required" hint="Só agente Ativo recebe trabalhos.">
              {(a) => <Select {...a} {...register("status")} options={AGENT_STATUSES.map((s) => ({ value: s, label: AGENT_STATUS_LABEL[s] }))} />}
            </Field>
          </div>
        </FormSection>

        <FormSection
          title="Orientações do DG Brasil"
          description="O que este agente deve entregar ao DG Brasil e como. Vão junto com cada trabalho; as instruções do próprio agente continuam no Claude Code. Mudar o texto cria uma versão nova."
        >
          <Field label="Orientações" requirement="required" error={errors.instructions?.message}>
            {(a) => <Textarea {...a} {...register("instructions")} rows={12} className="font-mono text-[12.5px]" />}
          </Field>
        </FormSection>

        <FormSection title="Conhecimento do escritório" description="Teses e referências que o agente pode consultar pelo DG Brasil durante o trabalho.">
          <div className="space-y-4">
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
