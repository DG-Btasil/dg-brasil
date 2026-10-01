"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Paperclip, Send, Trash2 } from "lucide-react";
import { LEGAL_AREA_LABEL, LEGAL_AREAS, type LegalArea } from "@/lib/constants/legal";
import { repositories } from "@/repositories";
import { Callout } from "@/components/feedback/states";
import { Button, IconButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Field, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { useClientOriginOptions, useClients, useDefaultClientOrigin } from "@/features/clients/hooks";
import { toPickedFile, type PickedFile } from "@/features/clients/components/detail/documents/document-add-dialog";
import { clientDisplayName } from "@/features/processes/utils";
import { useCaseActions, useEligibleLawyers } from "../hooks";

const areaOptions = LEGAL_AREAS.map((a) => ({ value: a, label: LEGAL_AREA_LABEL[a] }));

interface Values {
  clientId: string;
  title: string;
  area: LegalArea | "";
  caseType: string;
  originOfficeId: string;
  opposingParty: string;
  assignedLawyerId: string;
  summary: string;
}

type Errors = Partial<Record<keyof Values, string>>;

function validate(v: Values): Errors {
  return {
    clientId: v.clientId ? undefined : "Selecione o cliente.",
    title: v.title.trim() ? undefined : "Informe um título para o caso.",
    area: v.area ? undefined : "Selecione a área.",
    caseType: v.caseType.trim() ? undefined : "Informe o tipo do caso.",
    originOfficeId: v.originOfficeId ? undefined : "Selecione a origem do caso.",
    summary: v.summary.trim() ? undefined : "Descreva o caso em poucas linhas.",
  };
}

/**
 * Novo caso (equipe interna). A origem do CASO é independente da origem do
 * cliente: o mesmo cliente pode ter casos de origens diferentes.
 */
export function CaseForm({ defaultClientId }: { defaultClientId?: string }) {
  const router = useRouter();
  const actions = useCaseActions();
  const clients = useClients();
  const originOptions = useClientOriginOptions();
  const defaultOrigin = useDefaultClientOrigin();
  const lawyers = useEligibleLawyers();
  const fileRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<Values>({
    clientId: defaultClientId && clients.some((c) => c.id === defaultClientId) ? defaultClientId : "",
    title: "",
    area: "",
    caseType: "",
    originOfficeId: defaultOrigin,
    opposingParty: "",
    assignedLawyerId: "",
    summary: "",
  });
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);

  const clientOptions = useMemo(
    () => clients.filter((c) => c.status === "ACTIVE").map((c) => ({ value: c.id, label: clientDisplayName(c) })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    [clients],
  );
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function save(submit: boolean, event?: FormEvent) {
    event?.preventDefault();
    const found = validate(values);
    setErrors(found);
    if (Object.values(found).some(Boolean) || !values.area) return;
    setSaving(submit ? "submit" : "draft");
    const id = await actions.create({
      clientId: values.clientId,
      title: values.title.trim(),
      area: values.area,
      caseType: values.caseType.trim(),
      originOfficeId: values.originOfficeId,
      opposingParty: values.opposingParty.trim() || undefined,
      assignedLawyerId: values.assignedLawyerId || null,
      summary: values.summary.trim(),
      submit,
    });
    if (id) {
      for (const f of files) {
        await repositories.documents.add({ clientId: values.clientId, legalCaseId: id, name: f.fileName.replace(/\.[^.]+$/, ""), category: "OTHER", fileName: f.fileName, sizeKb: f.sizeKb });
      }
      router.push(`/casos/${id}`);
    }
    setSaving(null);
  }

  return (
    <>
      <PageHeader
        title="Novo caso"
        breadcrumbs={[{ label: "Casos", href: "/casos" }, { label: "Novo caso" }]}
        description="Um caso é uma demanda de um cliente. Ele pode existir antes do processo judicial e reunir vários processos."
      />
      <form noValidate onSubmit={(e) => save(true, e)}>
        <Panel className="max-w-[880px]">
          <PanelBody className="space-y-6">
            <FormSection title="Cliente e origem">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Cliente" requirement="required" error={errors.clientId}>
                  {(p) => <Select {...p} value={values.clientId} onChange={(e) => set("clientId", e.target.value)} options={clientOptions} placeholder="Selecione o cliente" />}
                </Field>
                <Field label="Origem do caso" requirement="required" error={errors.originOfficeId} hint="Independe da origem do cliente. Define parceria e financeiro do caso.">
                  {(p) => <Select {...p} value={values.originOfficeId} onChange={(e) => set("originOfficeId", e.target.value)} options={originOptions} />}
                </Field>
              </div>
            </FormSection>
            <FormSection title="Dados do caso">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Título" requirement="required" error={errors.title} className="col-span-2">
                  {(p) => <Input {...p} value={values.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex.: Revisional de empréstimo consignado" />}
                </Field>
                <Field label="Área" requirement="required" error={errors.area}>
                  {(p) => <Select {...p} value={values.area} onChange={(e) => set("area", e.target.value as LegalArea)} options={areaOptions} placeholder="Selecione a área" />}
                </Field>
                <Field label="Tipo" requirement="required" error={errors.caseType}>
                  {(p) => <Input {...p} value={values.caseType} onChange={(e) => set("caseType", e.target.value)} placeholder="Ex.: Revisional, Indenizatória" />}
                </Field>
                <Field label="Parte contrária" requirement="optional">
                  {(p) => <Input {...p} value={values.opposingParty} onChange={(e) => set("opposingParty", e.target.value)} />}
                </Field>
                <Field label="Advogado responsável" requirement="optional" hint="Obrigatório para aceitar o caso.">
                  {(p) => <Select {...p} value={values.assignedLawyerId} onChange={(e) => set("assignedLawyerId", e.target.value)} options={lawyers} placeholder="Definir depois" />}
                </Field>
                <Field label="Resumo" requirement="required" error={errors.summary} className="col-span-2">
                  {(p) => <Textarea {...p} rows={4} value={values.summary} onChange={(e) => set("summary", e.target.value)} />}
                </Field>
              </div>
            </FormSection>
            <FormSection title="Documentos" description="Opcional. Os arquivos ficam vinculados ao caso e entram como pendentes de verificação.">
              <div className="space-y-2">
                {files.map((f, i) => (
                  <div key={`${f.fileName}-${i}`} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-[12.5px]">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <Paperclip className="size-4 shrink-0 text-subtle" aria-hidden />
                      <span className="truncate">{f.fileName}</span>
                      <span className="text-muted">· {f.sizeKb} KB</span>
                    </span>
                    <IconButton label={`Remover ${f.fileName}`} size="sm" onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </IconButton>
                  </div>
                ))}
                <Button variant="secondary" size="sm" icon={<Paperclip className="size-4" aria-hidden />} onClick={() => fileRef.current?.click()}>
                  Adicionar arquivos
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []).map(toPickedFile);
                    setFiles((list) => [...list, ...picked]);
                    e.target.value = "";
                  }}
                />
              </div>
            </FormSection>
            <Callout tone="info">“Salvar rascunho” mantém o caso com a equipe. “Enviar para análise” coloca o caso na fila de análise.</Callout>
          </PanelBody>
          <PanelFooter>
            <Button variant="ghost" onClick={() => router.push("/casos")}>
              Cancelar
            </Button>
            <Button variant="secondary" loading={saving === "draft"} disabled={!!saving} onClick={() => save(false)}>
              Salvar rascunho
            </Button>
            <Button type="submit" loading={saving === "submit"} disabled={!!saving} icon={<Send className="size-4" aria-hidden />}>
              Enviar para análise
            </Button>
          </PanelFooter>
        </Panel>
      </form>
    </>
  );
}
