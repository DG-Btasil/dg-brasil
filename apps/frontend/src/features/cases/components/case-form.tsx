"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { callAction, mapFieldErrors } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { Callout } from "@/components/feedback/states";
import { AsyncPicker, type PickerOption } from "@/components/ui/async-picker";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Checkbox, Field, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { createCaseAction } from "@/server/domain/cases/actions";
import type { CaseCatalogDTO } from "@/server/domain/cases/dto";
import { useToast } from "@/store/ui-store";
import { searchActiveClients } from "@/features/clients/picker";
import { useDefaultOrigin, useLawyerOptions, useOrgDirectory, useOriginOptions } from "@/features/directory/directory-context";
import { LINK_PARTNER_LABEL } from "../utils";
import { useCatalogOptions } from "./case-dialogs";

interface Values {
  title: string;
  area: string;
  caseTypeId: string;
  originOrganizationId: string;
  opposingParty: string;
  assignedLawyerId: string;
  summary: string;
}

type Errors = Partial<Record<keyof Values | "clientId", string>>;

function validate(v: Values, client: PickerOption | null): Errors {
  return {
    clientId: client ? undefined : "Selecione o cliente.",
    title: v.title.trim() ? undefined : "Informe um título para o caso.",
    area: v.area ? undefined : "Selecione a área.",
    originOrganizationId: v.originOrganizationId ? undefined : "Selecione a origem do caso.",
    summary: v.summary.trim() ? undefined : "Descreva o caso em poucas linhas.",
  };
}

/**
 * Novo caso (equipe interna), gravado pelo createCaseAction com chave de
 * idempotência por intenção de envio: clique duplo ou nova tentativa com os
 * mesmos dados devolve o MESMO caso (`deduplicated`), tratado como sucesso.
 * A origem do CASO é independente da origem do cliente e nunca concede
 * acesso: o vínculo operacional do parceiro é opt-in explícito.
 */
export function CaseForm({ catalog, defaultClient }: { catalog: CaseCatalogDTO; defaultClient?: PickerOption }) {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const originOptions = useOriginOptions();
  const defaultOrigin = useDefaultOrigin();
  const lawyers = useLawyerOptions();
  const { owner } = useOrgDirectory();
  const [client, setClient] = useState<PickerOption | null>(defaultClient ?? null);
  const [values, setValues] = useState<Values>({
    title: "",
    area: "",
    caseTypeId: "",
    originOrganizationId: defaultOrigin,
    opposingParty: "",
    assignedLawyerId: "",
    summary: "",
  });
  const [linkPartner, setLinkPartner] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const { areas, types } = useCatalogOptions(catalog, values.area);
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));
  const partnerOrigin = !!values.originOrganizationId && values.originOrganizationId !== owner.id;

  async function save(submit: boolean, event?: FormEvent) {
    event?.preventDefault();
    if (saving) return;
    const found = validate(values, client);
    setErrors(found);
    if (Object.values(found).some(Boolean) || !client) return;
    const payload = {
      clientId: client.id,
      title: values.title.trim(),
      area: values.area,
      caseTypeId: values.caseTypeId || undefined,
      originOrganizationId: values.originOrganizationId,
      opposingParty: values.opposingParty.trim(),
      assignedLawyerId: values.assignedLawyerId || undefined,
      summary: values.summary.trim(),
      submit,
      linkPartner: partnerOrigin && linkPartner,
    };
    setSaving(submit ? "submit" : "draft");
    const result = await callAction(() => createCaseAction({ ...payload, idempotencyKey: idempotency.keyFor(payload) }));
    setSaving(null);
    if (!result.ok) {
      setErrors(mapFieldErrors(result.error.fieldErrors) as Errors);
      failed(result, "Não foi possível criar o caso.");
      return;
    }
    idempotency.reset();
    toast({ tone: "success", title: submit ? "Caso criado e enviado para análise" : "Rascunho do caso salvo" });
    // Navega para o recurso devolvido pelo servidor (também quando deduplicado).
    router.push(`/casos/${result.data.id}`);
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
                <Field label="Cliente" requirement="required" error={errors.clientId} hint="Clientes ativos. Digite o nome ou o CPF/CNPJ.">
                  {(p) => <AsyncPicker {...p} value={client} onChange={setClient} search={searchActiveClients} placeholder="Buscar cliente" />}
                </Field>
                <Field label="Origem do caso" requirement="required" error={errors.originOrganizationId} hint="Independe da origem do cliente. Define parceria e financeiro do caso.">
                  {(p) => (
                    <Select
                      {...p}
                      value={values.originOrganizationId}
                      onChange={(e) => {
                        set("originOrganizationId", e.target.value);
                        setLinkPartner(false);
                      }}
                      options={originOptions}
                    />
                  )}
                </Field>
              </div>
              {partnerOrigin && <Checkbox label={LINK_PARTNER_LABEL} checked={linkPartner} onChange={(e) => setLinkPartner(e.target.checked)} />}
            </FormSection>
            <FormSection title="Dados do caso">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Título" requirement="required" error={errors.title} className="col-span-2">
                  {(p) => <Input {...p} value={values.title} maxLength={200} onChange={(e) => set("title", e.target.value)} placeholder="Ex.: Revisional de empréstimo consignado" />}
                </Field>
                <Field label="Área" requirement="required" error={errors.area}>
                  {(p) => (
                    <Select
                      {...p}
                      value={values.area}
                      onChange={(e) => setValues((v) => ({ ...v, area: e.target.value, caseTypeId: "" }))}
                      options={areas}
                      placeholder="Selecione a área"
                    />
                  )}
                </Field>
                <Field label="Tipo" requirement="optional" error={errors.caseTypeId} hint={values.area && !types.length ? "Nenhum tipo cadastrado para esta área." : undefined}>
                  {(p) => <Select {...p} value={values.caseTypeId} onChange={(e) => set("caseTypeId", e.target.value)} options={types} placeholder="Sem tipo" disabled={!types.length} />}
                </Field>
                <Field label="Parte contrária" requirement="optional" error={errors.opposingParty}>
                  {(p) => <Input {...p} value={values.opposingParty} maxLength={300} onChange={(e) => set("opposingParty", e.target.value)} />}
                </Field>
                <Field label="Advogado responsável" requirement="optional" hint="Obrigatório para aceitar o caso." error={errors.assignedLawyerId}>
                  {(p) => <Select {...p} value={values.assignedLawyerId} onChange={(e) => set("assignedLawyerId", e.target.value)} options={lawyers} placeholder="Definir depois" />}
                </Field>
                <Field label="Resumo" requirement="required" error={errors.summary} className="col-span-2">
                  {(p) => <Textarea {...p} rows={4} value={values.summary} onChange={(e) => set("summary", e.target.value)} />}
                </Field>
              </div>
            </FormSection>
            <Callout tone="info">
              “Salvar rascunho” mantém o caso com a equipe. “Enviar para análise” coloca o caso na fila de análise. Documentos são anexados na página do caso.
            </Callout>
          </PanelBody>
          <PanelFooter>
            <Button variant="ghost" onClick={() => router.push("/casos")} disabled={!!saving}>
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
