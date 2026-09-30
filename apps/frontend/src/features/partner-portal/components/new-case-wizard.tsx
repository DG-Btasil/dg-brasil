"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Building2, CheckCircle2, FileUp, Plus, Search, Trash2, UserRound } from "lucide-react";
import { BRAZILIAN_STATES, COURTS, LEGAL_AREA_LABEL, LEGAL_AREAS, type LegalArea } from "@/lib/constants/legal";
import { CLIENT_KIND_LABEL, DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, type ClientKind, type DocumentCategory } from "@/lib/constants/status";
import { formatCurrency, formatPhone } from "@/lib/formatting";
import { isCnjFormat, isCnpjFormat, isCpfFormat, isPhoneFormat, msg, parseCurrencyInput } from "@/lib/validation";
import { Callout } from "@/components/feedback/states";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader, Steps, type StepState } from "@/components/ui/display";
import { ChoiceCards, Field, Input, MaskedInput, Select, Textarea } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import type { ClientLookupResult, PartnerCaseInput, PartnerCaseResult } from "@/store/types";
import type { ID } from "@/types";
import { usePortalActions, usePortalClientMap } from "../hooks";
import { clientDisplayName } from "@/features/processes/utils";
import { useClientOriginOptions, useDefaultClientOrigin } from "@/features/clients/hooks";

type StepKey = "identify" | "basic" | "documents" | "case" | "review";
const STEP_LABEL: Record<StepKey, string> = {
  identify: "CPF/CNPJ",
  basic: "Cadastro básico",
  documents: "Documentos",
  case: "Informações do caso",
  review: "Revisão e envio",
};

interface Values {
  kind: ClientKind;
  /** Origem do cliente: próprio escritório parceiro (padrão) ou Bárbara Cardoso Advocacia. */
  originOfficeId: string;
  document: string;
  fullName: string;
  birthDate: string;
  legalName: string;
  tradeName: string;
  representativeName: string;
  email: string;
  phone: string;
  zipCode: string;
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  title: string;
  area: LegalArea | "";
  actionType: string;
  opposingParty: string;
  summary: string;
  cnj: string;
  court: string;
  caseValue: string;
  notes: string;
}

interface DraftDocument {
  key: string;
  name: string;
  category: DocumentCategory;
  fileName: string;
}

/** Cliente de destino decidido na etapa de identificação. */
type ClientTarget = { mode: "NEW" } | { mode: "EXISTING"; matchToken?: string; clientId?: ID };

const UF_OPTIONS = BRAZILIAN_STATES.map((uf) => ({ value: uf, label: uf }));
const AREA_OPTIONS = LEGAL_AREAS.map((a) => ({ value: a, label: LEGAL_AREA_LABEL[a] }));
const COURT_OPTIONS = COURTS.map((c) => ({ value: c, label: c }));
const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.filter((c) => c !== "PETITION" && c !== "COURT_DECISION").map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABEL[c] }));
const blank = (v: string) => (v.trim() ? v.trim() : undefined);

/**
 * Novo Cliente (portal do parceiro):
 * PF/PJ → CPF/CNPJ → verificação de duplicidade → cadastro básico →
 * documentos → informações do caso → revisão → envio à Bárbara Cardoso Advocacia.
 *
 * Enquanto o assistente está aberto, o envio é um rascunho (DRAFT) editável;
 * na revisão fica pronto para envio (READY_TO_SUBMIT); ao confirmar, SUBMITTED.
 */
export function NewCaseWizard({ initialClientId }: { initialClientId?: ID }) {
  const router = useRouter();
  const actions = usePortalActions();
  const clientMap = usePortalClientMap();
  const presetClient = initialClientId ? clientMap.get(initialClientId) : undefined;
  const [step, setStep] = useState<StepKey>(presetClient ? "documents" : "identify");
  const [target, setTarget] = useState<ClientTarget | null>(presetClient ? { mode: "EXISTING", clientId: presetClient.id } : null);
  const [lookup, setLookup] = useState<ClientLookupResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [documents, setDocuments] = useState<DraftDocument[]>([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PartnerCaseResult | null>(null);
  // Opções vêm da regra central: somente o próprio escritório e a Bárbara Cardoso Advocacia.
  const originOptions = useClientOriginOptions();
  const defaultOrigin = useDefaultClientOrigin();

  const form = useForm<Values>({
    mode: "onTouched",
    defaultValues: {
      kind: "INDIVIDUAL",
      originOfficeId: defaultOrigin,
      document: "",
      fullName: "",
      birthDate: "",
      legalName: "",
      tradeName: "",
      representativeName: "",
      email: "",
      phone: "",
      zipCode: "",
      street: "",
      number: "",
      district: "",
      city: "",
      state: "",
      title: "",
      area: "",
      actionType: "",
      opposingParty: "",
      summary: "",
      cnj: "",
      court: "",
      caseValue: "",
      notes: "",
    },
  });
  const {
    register,
    control,
    setValue,
    trigger,
    getValues,
    formState: { errors },
  } = form;
  const kind = useWatch({ control, name: "kind" });

  const flow: StepKey[] = target?.mode === "EXISTING" ? ["identify", "documents", "case", "review"] : ["identify", "basic", "documents", "case", "review"];
  const steps = flow.map((key, i) => {
    const current = flow.indexOf(step);
    const state: StepState = i < current ? "done" : i === current ? "current" : "pending";
    return { key, label: STEP_LABEL[key], state };
  });
  const go = (key: StepKey) => {
    setStep(key);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const next = () => go(flow[Math.min(flow.indexOf(step) + 1, flow.length - 1)] as StepKey);
  const back = () => go(flow[Math.max(flow.indexOf(step) - 1, 0)] as StepKey);

  async function verify() {
    if (!(await trigger("document"))) return;
    setChecking(true);
    const res = await actions.lookupClient(getValues("document"));
    setChecking(false);
    setLookup(res);
    if (res?.status === "NOT_FOUND") {
      setTarget({ mode: "NEW" });
      go("basic");
    } else setTarget(null);
  }

  async function validateAndNext(fields: (keyof Values)[]) {
    if (await trigger(fields)) next();
  }

  async function submit() {
    const v = getValues();
    if (!target) return;
    const input: PartnerCaseInput = {
      client:
        target.mode === "NEW"
          ? {
              mode: "NEW",
              data:
                v.kind === "INDIVIDUAL"
                  ? {
                      kind: "INDIVIDUAL",
                      originOfficeId: v.originOfficeId,
                      fullName: v.fullName.trim(),
                      cpf: v.document,
                      birthDate: blank(v.birthDate),
                      contact: { email: blank(v.email), phone: blank(v.phone) },
                      address: addressOf(v),
                    }
                  : {
                      kind: "COMPANY",
                      originOfficeId: v.originOfficeId,
                      legalName: v.legalName.trim(),
                      tradeName: blank(v.tradeName),
                      cnpj: v.document,
                      contact: { email: blank(v.email), phone: blank(v.phone) },
                      address: addressOf(v),
                      representativeName: blank(v.representativeName),
                    },
            }
          : { mode: "EXISTING", matchToken: target.matchToken, clientId: target.clientId },
      documents: documents.map(({ name, category, fileName }) => ({ name, category, fileName })),
      caseInfo: {
        title: v.title.trim(),
        area: v.area as LegalArea,
        actionType: v.actionType.trim(),
        opposingParty: blank(v.opposingParty),
        summary: v.summary.trim(),
        cnj: blank(v.cnj),
        court: blank(v.court),
        caseValue: parseCurrencyInput(v.caseValue),
      },
      notes: blank(v.notes),
    };
    setSending(true);
    const res = await actions.submitCase(input);
    setSending(false);
    if (res) setResult(res);
  }

  /* ------------------------------ Enviado ------------------------------ */
  if (result) {
    return (
      <Panel className="mx-auto mt-6 max-w-[640px]">
        <PanelBody className="px-8 py-10 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle2 className="size-6" aria-hidden />
          </div>
          <h1 className="font-serif text-[24px] text-navy">Enviado para Bárbara Cardoso Advocacia</h1>
          <p className="mx-auto mt-2 max-w-[440px] text-[13px] text-muted">
            O caso está com a situação <strong>Enviado</strong>. Você será notificado quando for analisado e poderá acompanhar pelo portal.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <ButtonLink href={`/clientes/${result.clientId}`} variant="secondary">
              Ver cliente
            </ButtonLink>
            <ButtonLink href={`/processos/${result.processId}`}>Acompanhar processo</ButtonLink>
          </div>
        </PanelBody>
      </Panel>
    );
  }

  const v = { ...getValues(), kind };
  const existingClient = target?.mode === "EXISTING" && target.clientId ? clientMap.get(target.clientId) : undefined;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Clientes", href: "/clientes" }, { label: "Novo cliente" }]}
        title="Novo cliente"
        description="Cadastre o cliente, anexe os documentos e descreva o caso. Revise tudo antes de enviar."
      />
      <Steps steps={steps} className="mb-6 max-w-[900px]" />

      {/* ----------------------------- Identificação ----------------------------- */}
      {step === "identify" && (
        <Panel className="max-w-[900px]">
          <PanelHeader title="Tipo de cliente e documento" description="Verificamos se o cliente já possui cadastro no DG Brasil para não duplicar a pessoa." />
          <PanelBody className="space-y-5">
            <ChoiceCards<ClientKind>
              name="kind"
              legend="Tipo de cliente"
              value={kind}
              onChange={(k) => {
                setValue("kind", k);
                setValue("document", "");
                setLookup(null);
                setTarget(null);
              }}
              options={[
                { value: "INDIVIDUAL", label: CLIENT_KIND_LABEL.INDIVIDUAL, description: "Identificação por CPF", icon: <UserRound className="size-5" aria-hidden /> },
                { value: "COMPANY", label: CLIENT_KIND_LABEL.COMPANY, description: "Identificação por CNPJ", icon: <Building2 className="size-5" aria-hidden /> },
              ]}
            />
            <div className="flex items-end gap-3">
              <Field label={kind === "INDIVIDUAL" ? "CPF" : "CNPJ"} requirement="required" error={errors.document?.message} className="w-[320px]">
                {(p) => (
                  <MaskedInput
                    mask={kind === "INDIVIDUAL" ? "cpf" : "cnpj"}
                    placeholder={kind === "INDIVIDUAL" ? "000.000.000-00" : "00.000.000/0000-00"}
                    {...p}
                    {...register("document", {
                      validate: (value) => (kind === "INDIVIDUAL" ? isCpfFormat(value) || msg.cpf : isCnpjFormat(value) || msg.cnpj),
                      onChange: () => {
                        setLookup(null);
                        setTarget(null);
                      },
                    })}
                  />
                )}
              </Field>
              <Button onClick={verify} loading={checking} icon={<Search className="size-4" aria-hidden />}>
                Verificar
              </Button>
            </div>

            {lookup?.status === "EXISTS" && (
              <Callout
                tone="info"
                title="Cliente já cadastrado no sistema."
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      setTarget({ mode: "EXISTING", matchToken: lookup.matchToken });
                      go("documents");
                    }}
                  >
                    Vincular novo processo
                  </Button>
                }
              >
                Este cliente já possui cadastro no DG Brasil. Você pode criar um novo processo relacionado a ele.
              </Callout>
            )}
            {lookup?.status === "ALREADY_RELATED" && (
              <Callout
                tone="neutral"
                title="Este cliente já está na sua carteira."
                action={
                  <div className="flex gap-2">
                    <ButtonLink size="sm" variant="secondary" href={`/clientes/${lookup.clientId}`}>
                      Abrir cliente
                    </ButtonLink>
                    <Button
                      size="sm"
                      onClick={() => {
                        setTarget({ mode: "EXISTING", clientId: lookup.clientId });
                        go("documents");
                      }}
                    >
                      Cadastrar novo processo para este cliente
                    </Button>
                  </div>
                }
              >
                Nada será duplicado: o novo caso ficará vinculado ao cadastro existente.
              </Callout>
            )}
          </PanelBody>
          <PanelFooter>
            <Button variant="ghost" onClick={() => router.push("/clientes")}>
              Cancelar
            </Button>
          </PanelFooter>
        </Panel>
      )}

      {/* ----------------------------- Cadastro básico ----------------------------- */}
      {step === "basic" && (
        <Panel className="max-w-[900px]">
          <PanelHeader title="Cadastro básico" description="O essencial para a Bárbara Cardoso Advocacia iniciar a análise. Dados complementares podem ser enviados depois." />
          <PanelBody className="grid grid-cols-2 gap-x-5 gap-y-4">
            <Field
              label="Origem do cliente"
              requirement="required"
              error={errors.originOfficeId?.message}
              hint="Escritório ao qual a entrada deste cliente é atribuída."
              className="col-span-2 max-w-[420px]"
            >
              {(p) => (
                <Select
                  {...p}
                  options={originOptions}
                  {...register("originOfficeId", { validate: (x) => originOptions.some((o) => o.value === x) || "Selecione a origem do cliente." })}
                />
              )}
            </Field>
            {kind === "INDIVIDUAL" ? (
              <>
                <Field label="Nome completo" requirement="required" error={errors.fullName?.message} className="col-span-2">
                  {(p) => <Input {...p} {...register("fullName", { validate: (x) => !!x.trim() || "Informe o nome completo." })} />}
                </Field>
                <Field label="Data de nascimento" requirement="recommended">
                  {(p) => <Input {...p} type="date" {...register("birthDate")} />}
                </Field>
              </>
            ) : (
              <>
                <Field label="Razão social" requirement="required" error={errors.legalName?.message} className="col-span-2">
                  {(p) => <Input {...p} {...register("legalName", { validate: (x) => !!x.trim() || "Informe a razão social." })} />}
                </Field>
                <Field label="Nome fantasia" requirement="optional">
                  {(p) => <Input {...p} {...register("tradeName")} />}
                </Field>
                <Field label="Representante legal" requirement="recommended">
                  {(p) => <Input {...p} {...register("representativeName")} />}
                </Field>
              </>
            )}
            <Field label="E-mail" requirement="recommended" error={errors.email?.message}>
              {(p) => <Input {...p} type="email" {...register("email", { validate: (x) => !x || /\S+@\S+\.\S+/.test(x) || msg.email })} />}
            </Field>
            <Field label="Telefone" requirement="recommended" error={errors.phone?.message}>
              {(p) => <MaskedInput mask="phone" {...p} {...register("phone", { validate: (x) => !x || isPhoneFormat(x) || msg.phone })} />}
            </Field>
            <Field label="CEP" requirement="recommended">
              {(p) => <MaskedInput mask="cep" {...p} {...register("zipCode")} />}
            </Field>
            <Field label="Logradouro" requirement="recommended">
              {(p) => <Input {...p} {...register("street")} />}
            </Field>
            <Field label="Número" requirement="recommended">
              {(p) => <Input {...p} {...register("number")} />}
            </Field>
            <Field label="Bairro" requirement="recommended">
              {(p) => <Input {...p} {...register("district")} />}
            </Field>
            <Field label="Município" requirement="recommended">
              {(p) => <Input {...p} {...register("city")} />}
            </Field>
            <Field label="UF" requirement="recommended">
              {(p) => <Select {...p} placeholder="—" options={UF_OPTIONS} {...register("state")} />}
            </Field>
          </PanelBody>
          <PanelFooter>
            <Button variant="ghost" onClick={back}>
              Voltar
            </Button>
            <Button onClick={() => validateAndNext(kind === "INDIVIDUAL" ? ["originOfficeId", "fullName", "email", "phone"] : ["originOfficeId", "legalName", "email", "phone"])}>
              Continuar
            </Button>
          </PanelFooter>
        </Panel>
      )}

      {/* ----------------------------- Documentos ----------------------------- */}
      {step === "documents" && (
        <Panel className="max-w-[900px]">
          <PanelHeader
            title="Documentos"
            description="Anexe os documentos que você já tem. Depois do envio, eles não podem ser editados nem apagados — correções são enviadas como nova versão."
          />
          <PanelBody className="space-y-3">
            {existingClient && (
              <p className="text-[12.5px] text-muted">
                Cliente: <strong className="text-foreground">{clientDisplayName(existingClient)}</strong>
              </p>
            )}
            {documents.length === 0 && <p className="text-[12.5px] text-muted">Nenhum documento adicionado. Você também pode enviar documentos depois.</p>}
            {documents.map((d, i) => (
              <div key={d.key} className="grid grid-cols-[1.4fr_1fr_1.2fr_auto] items-end gap-3 rounded-md border border-line px-3 py-3">
                <Field label="Documento" requirement="required">
                  {(p) => <Input {...p} value={d.name} onChange={(e) => setDocuments((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />}
                </Field>
                <Field label="Tipo" requirement="required">
                  {(p) => (
                    <Select
                      {...p}
                      options={CATEGORY_OPTIONS}
                      value={d.category}
                      onChange={(e) => setDocuments((list) => list.map((x, j) => (j === i ? { ...x, category: e.target.value as DocumentCategory } : x)))}
                    />
                  )}
                </Field>
                <Field label="Arquivo" requirement="required" hint={d.fileName || "Nenhum arquivo selecionado"}>
                  {(p) => (
                    <Input
                      {...p}
                      type="file"
                      className="py-1.5"
                      onChange={(e) => {
                        const file = e.target.files?.[0]?.name ?? "";
                        setDocuments((list) => list.map((x, j) => (j === i ? { ...x, fileName: file, name: x.name || file.replace(/\.[^.]+$/, "") } : x)));
                      }}
                    />
                  )}
                </Field>
                <Button variant="ghost" size="sm" aria-label="Remover documento" onClick={() => setDocuments((list) => list.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="size-3.5" aria-hidden />}
              onClick={() => setDocuments((list) => [...list, { key: `d${Date.now()}`, name: "", category: "IDENTIFICATION", fileName: "" }])}
            >
              Adicionar documento
            </Button>
          </PanelBody>
          <PanelFooter>
            <Button variant="ghost" onClick={back}>
              Voltar
            </Button>
            <Button onClick={next} disabled={documents.some((d) => !d.name.trim() || !d.fileName)}>
              Continuar
            </Button>
          </PanelFooter>
        </Panel>
      )}

      {/* ----------------------------- Caso ----------------------------- */}
      {step === "case" && (
        <Panel className="max-w-[900px]">
          <PanelHeader title="Informações iniciais do caso" description="Conte o que aconteceu. Se o processo já existe, informe o número CNJ." />
          <PanelBody className="grid grid-cols-2 gap-x-5 gap-y-4">
            <Field label="Nome resumido do caso" requirement="required" error={errors.title?.message} className="col-span-2">
              {(p) => <Input {...p} placeholder="Ex.: Descontos de consignado não reconhecidos" {...register("title", { validate: (x) => !!x.trim() || "Informe um nome resumido." })} />}
            </Field>
            <Field label="Área" requirement="required" error={errors.area?.message}>
              {(p) => <Select {...p} placeholder="Selecione" options={AREA_OPTIONS} {...register("area", { validate: (x) => !!x || "Selecione a área." })} />}
            </Field>
            <Field label="Tipo de ação" requirement="required" error={errors.actionType?.message}>
              {(p) => <Input {...p} placeholder="Ex.: Ação declaratória" {...register("actionType", { validate: (x) => !!x.trim() || "Informe o tipo de ação." })} />}
            </Field>
            <Field label="Parte contrária" requirement="recommended">
              {(p) => <Input {...p} {...register("opposingParty")} />}
            </Field>
            <Field label="Valor da causa" requirement="optional" hint="Dado jurídico — não é honorário.">
              {(p) => <Input {...p} inputMode="decimal" placeholder="R$ 0,00" {...register("caseValue")} />}
            </Field>
            <Field label="Número CNJ" requirement="optional" error={errors.cnj?.message}>
              {(p) => <MaskedInput mask="cnj" placeholder="0000000-00.0000.0.00.0000" {...p} {...register("cnj", { validate: (x) => !x || isCnjFormat(x) || msg.cnj })} />}
            </Field>
            <Field label="Tribunal" requirement="optional">
              {(p) => <Select {...p} placeholder="Selecione" options={COURT_OPTIONS} {...register("court")} />}
            </Field>
            <Field label="Relato do caso" requirement="required" error={errors.summary?.message} className="col-span-2">
              {(p) => <Textarea {...p} rows={4} {...register("summary", { validate: (x) => !!x.trim() || "Descreva o caso." })} />}
            </Field>
            <Field label="Observações" requirement="optional" className="col-span-2">
              {(p) => <Textarea {...p} rows={2} {...register("notes")} />}
            </Field>
          </PanelBody>
          <PanelFooter>
            <Button variant="ghost" onClick={back}>
              Voltar
            </Button>
            <Button onClick={() => validateAndNext(["title", "area", "actionType", "summary", "cnj"])}>Revisar envio</Button>
          </PanelFooter>
        </Panel>
      )}

      {/* ----------------------------- Revisão ----------------------------- */}
      {step === "review" && (
        <Panel className="max-w-[900px]">
          <PanelHeader title="Revisar envio" />
          <PanelBody className="space-y-5">
            <Callout tone="warning" title="Confira antes de enviar">
              Confirme se os dados do cliente e os documentos estão corretos antes de enviá-los para Bárbara Cardoso Advocacia. Depois do envio, documentos não
              podem ser editados nem apagados.
            </Callout>
            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-foreground">Cliente</h3>
              {target?.mode === "EXISTING" ? (
                <p className="text-[13px] text-foreground/85">
                  {existingClient ? clientDisplayName(existingClient) : "Cliente já cadastrado no sistema"} — o novo caso será vinculado ao cadastro existente, sem duplicar o cliente.
                </p>
              ) : (
                <DefinitionGrid
                  columns={3}
                  items={[
                    { label: "Tipo", value: CLIENT_KIND_LABEL[v.kind] },
                    { label: "Origem do cliente", value: originOptions.find((o) => o.value === v.originOfficeId)?.label },
                    { label: v.kind === "INDIVIDUAL" ? "CPF" : "CNPJ", value: v.document },
                    { label: "Nome", value: v.kind === "INDIVIDUAL" ? v.fullName : v.legalName },
                    { label: "E-mail", value: blank(v.email) },
                    { label: "Telefone", value: v.phone ? formatPhone(v.phone) : undefined },
                    { label: "Endereço", value: v.street ? `${v.street}, ${v.number} · ${v.city}/${v.state}` : undefined },
                  ]}
                />
              )}
            </section>
            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-foreground">Documentos ({documents.length})</h3>
              {documents.length === 0 ? (
                <p className="text-[12.5px] text-muted">Nenhum documento anexado.</p>
              ) : (
                <ul className="space-y-1">
                  {documents.map((d) => (
                    <li key={d.key} className="flex items-center gap-2 text-[13px]">
                      <FileUp className="size-3.5 text-subtle" aria-hidden />
                      {d.name} <span className="text-muted">· {DOCUMENT_CATEGORY_LABEL[d.category]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-foreground">Caso</h3>
              <DefinitionGrid
                columns={3}
                items={[
                  { label: "Nome", value: v.title },
                  { label: "Área", value: v.area ? LEGAL_AREA_LABEL[v.area] : undefined },
                  { label: "Tipo de ação", value: v.actionType },
                  { label: "Parte contrária", value: blank(v.opposingParty) },
                  { label: "Processo (CNJ)", value: blank(v.cnj) ?? "Ainda não informado" },
                  { label: "Valor da causa", value: v.caseValue ? formatCurrency(parseCurrencyInput(v.caseValue)) : undefined },
                  { label: "Relato", value: v.summary, wide: true },
                  { label: "Observações", value: blank(v.notes), wide: true },
                ]}
              />
            </section>
          </PanelBody>
          <PanelFooter>
            <Button variant="secondary" onClick={back}>
              Voltar e revisar
            </Button>
            <Button onClick={submit} loading={sending}>
              Confirmar e enviar
            </Button>
          </PanelFooter>
        </Panel>
      )}
    </>
  );
}

function addressOf(v: Values) {
  if (![v.zipCode, v.street, v.number, v.district, v.city, v.state].some((x) => x.trim())) return undefined;
  return { zipCode: v.zipCode, street: v.street, number: v.number, district: v.district, city: v.city, state: v.state, country: "Brasil" };
}
