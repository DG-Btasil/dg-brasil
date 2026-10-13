"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { AlertTriangle, Building2, CheckCircle2, FileUp, Loader2, Plus, Search, Trash2, UserRound } from "lucide-react";
import { BRAZILIAN_STATES } from "@/lib/constants/legal";
import { CLIENT_KIND_LABEL, DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, type ClientKind, type DocumentCategory } from "@/lib/constants/status";
import { formatPhone, maskCNPJ, maskCPF } from "@/lib/formatting";
import { callAction, mapFieldErrors, referenceCode } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { isCnpjFormat, isCpfFormat, isPhoneFormat, msg } from "@/lib/validation";
import { Callout } from "@/components/feedback/states";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader, Steps, type StepState } from "@/components/ui/display";
import { ChoiceCards, Field, Input, MaskedInput, Select, Textarea } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { partnerSubmitCaseAction } from "@/server/domain/cases/actions";
import type { CaseCatalogDTO, PartnerCaseSubmittedDTO } from "@/server/domain/cases/dto";
import { lookupClientDocumentAction } from "@/server/domain/clients/actions";
import type { ClientLookupDTO } from "@/server/domain/clients/dto";
import { useDefaultOrigin, useOrgDirectory, useOriginOptions } from "@/features/directory/directory-context";
import { useCatalogOptions } from "@/features/cases/components/case-dialogs";
import { FILE_ACCEPT } from "@/features/documents/constants";
import { checkFile, createAndUpload, uploadVersion, type UploadResume } from "@/features/documents/upload";
import { partnerSubmitInput, type PartnerCaseValues as Values } from "../server-input";

type StepKey = "identify" | "basic" | "documents" | "case" | "review";
const STEP_LABEL: Record<StepKey, string> = {
  identify: "CPF/CNPJ",
  basic: "Cadastro básico",
  documents: "Documentos",
  case: "Novo caso",
  review: "Revisão e envio",
};

/** Arquivo escolhido antes do envio: só vai ao servidor depois que o caso existe. */
interface DraftDocument {
  key: number;
  title: string;
  category: DocumentCategory;
  file?: File;
  problem?: string;
}

/** Envio dos arquivos para o caso criado (um a um, com retomada). */
interface UploadState {
  key: number;
  title: string;
  status: "pending" | "sending" | "done" | "failed";
  message?: string;
  resume?: UploadResume;
}

/** Cliente já cadastrado (vindo da ficha do cliente: /casos/novo?cliente=). */
export interface PresetClient {
  id: string;
  name: string;
  kind: ClientKind;
  document: string;
}

/** Cliente de destino decidido na identificação: NOVO (cadastro básico) ou EXISTENTE (canônico). */
type ClientTarget = { mode: "NEW" } | { mode: "EXISTING"; clientId?: string; name?: string };

const UF_OPTIONS = BRAZILIAN_STATES.map((uf) => ({ value: uf, label: uf }));
const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.filter((c) => c !== "PETITION" && c !== "COURT_DECISION").map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABEL[c] }));
const blank = (v: string) => (v.trim() ? v.trim() : undefined);
const SERVER_FIELD_MAP: Record<string, string> = {
  "client.document": "document",
  "client.fullName": "fullName",
  "client.legalName": "legalName",
  "client.birthDate": "birthDate",
  "client.email": "email",
  "client.phone": "phone",
  "client.address.zipCode": "zipCode",
  "client.address.state": "state",
  "case.title": "title",
  "case.area": "area",
  "case.caseTypeId": "caseTypeId",
  "case.summary": "summary",
};
const BASIC_FIELDS = new Set(["fullName", "legalName", "birthDate", "email", "phone", "zipCode", "state"]);

/**
 * Envio de caso pelo portal do parceiro (partnerSubmitCaseAction):
 * Cliente (CPF/CNPJ, duplicidade, cadastro básico) → Novo caso (com a origem
 * permitida) → documentos → revisão → envio à Bárbara Cardoso Advocacia.
 * Cliente + caso nascem numa operação atômica e idempotente (mesma chave por
 * intenção de envio). Os arquivos sobem DEPOIS, para o caso criado, pelo
 * fluxo de upload assinado — falha num arquivo não desfaz o caso.
 */
export function NewCaseWizard({ catalog, presetClient, mode = "client" }: { catalog: CaseCatalogDTO; presetClient?: PresetClient; mode?: "client" | "case" }) {
  const router = useRouter();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const { owner } = useOrgDirectory();
  // Opções da regra central: somente o próprio escritório e a Bárbara Cardoso Advocacia.
  const originOptions = useOriginOptions();
  const defaultOrigin = useDefaultOrigin();
  const [step, setStep] = useState<StepKey>(presetClient ? "case" : "identify");
  const [target, setTarget] = useState<ClientTarget | null>(presetClient ? { mode: "EXISTING", clientId: presetClient.id, name: presetClient.name } : null);
  const [lookup, setLookup] = useState<ClientLookupDTO | null>(null);
  const [lookupError, setLookupError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [documents, setDocuments] = useState<DraftDocument[]>([]);
  const nextKey = useRef(1);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PartnerCaseSubmittedDTO | null>(null);
  const [uploads, setUploads] = useState<UploadState[]>([]);

  const form = useForm<Values>({
    mode: "onTouched",
    defaultValues: {
      kind: presetClient?.kind ?? "INDIVIDUAL",
      clientOriginId: defaultOrigin,
      document: presetClient?.document ?? "",
      fullName: "",
      birthDate: "",
      legalName: "",
      tradeName: "",
      email: "",
      phone: "",
      zipCode: "",
      street: "",
      number: "",
      complement: "",
      district: "",
      city: "",
      state: "",
      title: "",
      area: "",
      caseTypeId: "",
      caseOriginId: defaultOrigin,
      opposingParty: "",
      summary: "",
      notes: "",
    },
  });
  const {
    register,
    control,
    setValue,
    setError,
    trigger,
    getValues,
    formState: { errors },
  } = form;
  const kind = useWatch({ control, name: "kind" });
  const area = useWatch({ control, name: "area" });
  const { areas, types } = useCatalogOptions(catalog, area);
  const areaName = useMemo(() => new Map(areas.map((a) => [a.value, a.label])), [areas]);

  const flow: StepKey[] = target?.mode === "EXISTING" ? ["identify", "case", "documents", "review"] : ["identify", "basic", "case", "documents", "review"];
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
    setLookupError(undefined);
    const res = await callAction(() => lookupClientDocumentAction({ document: getValues("document") }));
    setChecking(false);
    if (!res.ok) {
      // Limite de consultas por CPF/CNPJ (best-effort, no servidor): mensagem própria, sem toast genérico.
      if (res.error.code === "RATE_LIMITED") setLookupError(res.error.message);
      else failed(res, "Não foi possível verificar o CPF/CNPJ.");
      return;
    }
    setLookup(res.data);
    if (res.data.status === "NOT_FOUND") {
      setTarget({ mode: "NEW" });
      go("basic");
    } else setTarget(null);
  }

  async function validateAndNext(fields: (keyof Values)[]) {
    if (await trigger(fields)) next();
  }

  async function uploadAll(legalCaseId: string, list: DraftDocument[]) {
    for (const d of list) {
      if (!d.file) continue;
      await uploadOne(legalCaseId, d);
    }
  }

  async function uploadOne(legalCaseId: string, d: DraftDocument, resume?: UploadResume) {
    const file = d.file as File;
    const patch = (state: Partial<UploadState>) => setUploads((list) => list.map((u) => (u.key === d.key ? { ...u, ...state } : u)));
    patch({ status: "sending", message: undefined });
    const outcome =
      resume?.step === "confirm"
        ? await uploadVersion(resume.documentId, file, () => undefined, resume)
        : resume?.step === "upload"
          ? await uploadVersion(resume.documentId, file, () => undefined)
          : await createAndUpload({ legalCaseId, category: d.category, title: d.title.trim() }, file, () => undefined);
    if (outcome.ok) patch({ status: "done", resume: undefined });
    else {
      const code = referenceCode(outcome.error.requestId);
      patch({ status: "failed", message: code ? `${outcome.error.error.message} (ref. ${code})` : outcome.error.error.message, resume: outcome.resume });
    }
  }

  async function submit() {
    if (!target || sending) return;
    const payload = partnerSubmitInput(getValues(), owner.id, target.mode === "EXISTING");
    setSending(true);
    const res = await callAction(() => partnerSubmitCaseAction({ ...payload, idempotencyKey: idempotency.keyFor(payload) }));
    setSending(false);
    if (!res.ok) {
      const fields = mapFieldErrors(res.error.fieldErrors, SERVER_FIELD_MAP);
      for (const [path, message] of Object.entries(fields)) setError(path as keyof Values, { message });
      if (Object.keys(fields).length > 0) {
        // Volta para a etapa do primeiro campo recusado pelo servidor.
        const first = Object.keys(fields)[0];
        go(first === "document" ? "identify" : BASIC_FIELDS.has(first) && target.mode === "NEW" ? "basic" : "case");
      }
      failed(res, res.error.code === "RATE_LIMITED" ? "Envio temporariamente bloqueado." : "Não foi possível enviar o caso.");
      return;
    }
    idempotency.reset();
    setResult(res.data);
    const toSend = documents.filter((d) => d.file);
    setUploads(toSend.map((d) => ({ key: d.key, title: d.title, status: "pending" })));
    await uploadAll(res.data.legalCaseId, toSend);
  }

  /* ------------------------------ Enviado ------------------------------ */
  if (result) {
    const failedUploads = uploads.filter((u) => u.status === "failed");
    const busy = uploads.some((u) => u.status === "sending" || u.status === "pending");
    return (
      <Panel className="mx-auto mt-6 max-w-[640px]">
        <PanelBody className="px-8 py-10 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle2 className="size-6" aria-hidden />
          </div>
          <h1 className="font-serif text-[24px] text-navy">Enviado para Bárbara Cardoso Advocacia</h1>
          <p className="mx-auto mt-2 max-w-[440px] text-[13px] text-muted">
            O caso está com a situação <strong>Enviado</strong>. Você será notificado quando for analisado e poderá acompanhar em Casos.
            {result.clientExisted && " O cliente já tinha cadastro: o caso foi vinculado a ele, sem duplicar."}
          </p>
          {uploads.length > 0 && (
            <ul className="mx-auto mt-5 max-w-[460px] space-y-1.5 text-left" aria-live="polite">
              {uploads.map((u) => {
                const draft = documents.find((d) => d.key === u.key);
                return (
                  <li key={u.key} className="flex items-start gap-2 text-[13px]">
                    {u.status === "done" ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    ) : u.status === "failed" ? (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                    ) : (
                      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-foreground">{u.title}</p>
                      {u.status === "failed" && <p className="text-[12px] text-danger">{u.message}</p>}
                    </div>
                    {u.status === "failed" && draft && (
                      <Button size="sm" variant="secondary" onClick={() => uploadOne(result.legalCaseId, draft, u.resume)}>
                        Tentar de novo
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {failedUploads.length > 0 && !busy && (
            <p className="mx-auto mt-3 max-w-[440px] text-[12px] text-muted">O caso já foi enviado. Os arquivos que falharam também podem ser enviados depois, na aba Documentos do caso.</p>
          )}
          <div className="mt-6 flex justify-center gap-2">
            <ButtonLink href={`/clientes/${result.clientId}`} variant="secondary">
              Ver cliente
            </ButtonLink>
            <ButtonLink href={`/casos/${result.legalCaseId}`}>Acompanhar caso</ButtonLink>
          </div>
        </PanelBody>
      </Panel>
    );
  }

  const v = { ...getValues(), kind };
  const originLabel = (id: string) => originOptions.find((o) => o.value === id)?.label;
  const maskedDocument = v.document ? (kind === "INDIVIDUAL" ? maskCPF(v.document) : maskCNPJ(v.document)) : undefined;

  return (
    <>
      <PageHeader
        breadcrumbs={mode === "case" ? [{ label: "Casos", href: "/casos" }, { label: "Novo caso" }] : [{ label: "Clientes", href: "/clientes" }, { label: "Novo cliente" }]}
        title={mode === "case" ? "Novo caso" : "Novo cliente"}
        description="Identifique o cliente, descreva o caso e anexe os documentos. Revise tudo antes de enviar."
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
                setLookupError(undefined);
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
                    autoComplete="off"
                    {...p}
                    {...register("document", {
                      validate: (value) => (kind === "INDIVIDUAL" ? isCpfFormat(value) || msg.cpf : isCnpjFormat(value) || msg.cnpj),
                      onChange: () => {
                        setLookup(null);
                        setTarget(null);
                        setLookupError(undefined);
                      },
                    })}
                  />
                )}
              </Field>
              <Button onClick={verify} loading={checking} icon={<Search className="size-4" aria-hidden />}>
                Verificar
              </Button>
            </div>

            {lookupError && (
              <Callout tone="warning" title="Consulta temporariamente bloqueada">
                {lookupError}
              </Callout>
            )}
            {lookup?.status === "EXISTS" && (
              <Callout
                tone="info"
                title="Cliente já cadastrado no sistema."
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      setTarget({ mode: "EXISTING" });
                      go("case");
                    }}
                  >
                    Criar novo caso para este cliente
                  </Button>
                }
              >
                Este cliente já possui cadastro no DG Brasil. Você pode criar um novo caso para ele, sem duplicar o cadastro.
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
                        go("case");
                      }}
                    >
                      Criar novo caso para este cliente
                    </Button>
                  </div>
                }
              >
                Nada será duplicado: o novo caso ficará vinculado ao cadastro existente.
              </Callout>
            )}
          </PanelBody>
          <PanelFooter>
            <Button variant="ghost" onClick={() => router.push(mode === "case" ? "/casos" : "/clientes")}>
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
              error={errors.clientOriginId?.message}
              hint="Escritório ao qual a entrada deste cliente é atribuída."
              className="col-span-2 max-w-[420px]"
            >
              {(p) => (
                <Select {...p} options={originOptions} {...register("clientOriginId", { validate: (x) => originOptions.some((o) => o.value === x) || "Selecione a origem do cliente." })} />
              )}
            </Field>
            {kind === "INDIVIDUAL" ? (
              <>
                <Field label="Nome completo" requirement="required" error={errors.fullName?.message} className="col-span-2">
                  {(p) => <Input {...p} maxLength={200} {...register("fullName", { validate: (x) => !!x.trim() || "Informe o nome completo." })} />}
                </Field>
                <Field label="Data de nascimento" requirement="recommended" error={errors.birthDate?.message}>
                  {(p) => <Input {...p} type="date" {...register("birthDate")} />}
                </Field>
              </>
            ) : (
              <>
                <Field label="Razão social" requirement="required" error={errors.legalName?.message} className="col-span-2">
                  {(p) => <Input {...p} maxLength={200} {...register("legalName", { validate: (x) => !!x.trim() || "Informe a razão social." })} />}
                </Field>
                <Field label="Nome fantasia" requirement="optional">
                  {(p) => <Input {...p} maxLength={200} {...register("tradeName")} />}
                </Field>
              </>
            )}
            <Field label="E-mail" requirement="recommended" error={errors.email?.message}>
              {(p) => <Input {...p} type="email" {...register("email", { validate: (x) => !x || /\S+@\S+\.\S+/.test(x) || msg.email })} />}
            </Field>
            <Field label="Telefone" requirement="recommended" error={errors.phone?.message}>
              {(p) => <MaskedInput mask="phone" {...p} {...register("phone", { validate: (x) => !x || isPhoneFormat(x) || msg.phone })} />}
            </Field>
            <Field label="CEP" requirement="recommended" error={errors.zipCode?.message}>
              {(p) => <MaskedInput mask="cep" {...p} {...register("zipCode")} />}
            </Field>
            <Field label="Logradouro" requirement="recommended">
              {(p) => <Input {...p} maxLength={200} {...register("street")} />}
            </Field>
            <Field label="Número" requirement="recommended">
              {(p) => <Input {...p} maxLength={20} {...register("number")} />}
            </Field>
            <Field label="Complemento" requirement="optional">
              {(p) => <Input {...p} maxLength={100} {...register("complement")} />}
            </Field>
            <Field label="Bairro" requirement="recommended">
              {(p) => <Input {...p} maxLength={100} {...register("district")} />}
            </Field>
            <Field label="Município" requirement="recommended">
              {(p) => <Input {...p} maxLength={100} {...register("city")} />}
            </Field>
            <Field label="UF" requirement="recommended" error={errors.state?.message}>
              {(p) => <Select {...p} placeholder="—" options={UF_OPTIONS} {...register("state")} />}
            </Field>
          </PanelBody>
          <PanelFooter>
            <Button variant="ghost" onClick={back}>
              Voltar
            </Button>
            <Button onClick={() => validateAndNext(kind === "INDIVIDUAL" ? ["clientOriginId", "fullName", "email", "phone"] : ["clientOriginId", "legalName", "email", "phone"])}>Continuar</Button>
          </PanelFooter>
        </Panel>
      )}

      {/* ----------------------------- Documentos ----------------------------- */}
      {step === "documents" && (
        <Panel className="max-w-[900px]">
          <PanelHeader
            title="Documentos"
            description="Anexe os documentos que você já tem. Eles são enviados logo depois do caso. Depois do envio, não podem ser editados nem apagados — correções são enviadas como nova versão."
          />
          <PanelBody className="space-y-3">
            {documents.length === 0 && <p className="text-[12.5px] text-muted">Nenhum documento adicionado. Você também pode enviar documentos depois, na página do caso.</p>}
            {documents.map((d) => {
              const patch = (state: Partial<DraftDocument>) => setDocuments((list) => list.map((x) => (x.key === d.key ? { ...x, ...state } : x)));
              return (
                <div key={d.key} className="grid grid-cols-[1.4fr_1fr_1.2fr_auto] items-end gap-3 rounded-md border border-line px-3 py-3">
                  <Field label="Documento" requirement="required">
                    {(p) => <Input {...p} maxLength={200} value={d.title} onChange={(e) => patch({ title: e.target.value })} />}
                  </Field>
                  <Field label="Tipo" requirement="required">
                    {(p) => <Select {...p} options={CATEGORY_OPTIONS} value={d.category} onChange={(e) => patch({ category: e.target.value as DocumentCategory })} />}
                  </Field>
                  <Field label="Arquivo" requirement="required" error={d.problem} hint={d.problem ? undefined : (d.file?.name ?? "Nenhum arquivo selecionado")}>
                    {(p) => (
                      <Input
                        {...p}
                        type="file"
                        accept={FILE_ACCEPT}
                        className="py-1.5"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const problem = checkFile(file);
                          patch({ file: problem ? undefined : file, problem, title: d.title || file.name.replace(/\.[^.]+$/, "") });
                        }}
                      />
                    )}
                  </Field>
                  <Button variant="ghost" size="sm" aria-label="Remover documento" onClick={() => setDocuments((list) => list.filter((x) => x.key !== d.key))}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              );
            })}
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="size-3.5" aria-hidden />}
              onClick={() => setDocuments((list) => [...list, { key: nextKey.current++, title: "", category: "IDENTIFICATION" }])}
            >
              Adicionar documento
            </Button>
          </PanelBody>
          <PanelFooter>
            <Button variant="ghost" onClick={back}>
              Voltar
            </Button>
            <Button onClick={next} disabled={documents.some((d) => !d.title.trim() || !d.file)}>
              Revisar envio
            </Button>
          </PanelFooter>
        </Panel>
      )}

      {/* ----------------------------- Caso ----------------------------- */}
      {step === "case" && (
        <Panel className="max-w-[900px]">
          <PanelHeader title="Novo caso" description="Conte o que aconteceu. O processo judicial, quando existir, é cadastrado depois dentro do caso." />
          <PanelBody className="grid grid-cols-2 gap-x-5 gap-y-4">
            {target?.mode === "EXISTING" && (
              <p className="col-span-2 text-[12.5px] text-muted">
                Cliente: <strong className="text-foreground">{target.name ?? `${kind === "INDIVIDUAL" ? "CPF" : "CNPJ"} ${maskedDocument ?? ""}`}</strong>
              </p>
            )}
            <Field
              label="Origem do caso"
              requirement="required"
              error={errors.caseOriginId?.message}
              hint="Independe da origem do cliente. Define a parceria deste caso."
              className="col-span-2 max-w-[420px]"
            >
              {(p) => <Select {...p} options={originOptions} {...register("caseOriginId", { validate: (x) => originOptions.some((o) => o.value === x) || "Selecione a origem do caso." })} />}
            </Field>
            <Field label="Nome resumido do caso" requirement="required" error={errors.title?.message} className="col-span-2">
              {(p) => <Input {...p} maxLength={200} placeholder="Ex.: Descontos de consignado não reconhecidos" {...register("title", { validate: (x) => !!x.trim() || "Informe um nome resumido." })} />}
            </Field>
            <Field label="Área" requirement="required" error={errors.area?.message}>
              {(p) => (
                <Select
                  {...p}
                  placeholder="Selecione"
                  options={areas}
                  {...register("area", { validate: (x) => !!x || "Selecione a área.", onChange: () => setValue("caseTypeId", "") })}
                />
              )}
            </Field>
            <Field label="Tipo" requirement="optional" error={errors.caseTypeId?.message} hint={area && types.length === 0 ? "Sem tipos cadastrados para esta área." : undefined}>
              {(p) => <Select {...p} placeholder={types.length ? "Selecione" : "—"} options={types} disabled={types.length === 0} {...register("caseTypeId")} />}
            </Field>
            <Field label="Parte contrária" requirement="recommended" className="col-span-2">
              {(p) => <Input {...p} maxLength={300} {...register("opposingParty")} />}
            </Field>
            <Field label="Relato do caso" requirement="required" error={errors.summary?.message} className="col-span-2">
              {(p) => <Textarea {...p} rows={4} maxLength={10_000} {...register("summary", { validate: (x) => !!x.trim() || "Descreva o caso." })} />}
            </Field>
            <Field label="Observações" requirement="optional" hint="Visíveis para a Bárbara Cardoso Advocacia e para o seu escritório." className="col-span-2">
              {(p) => <Textarea {...p} rows={2} maxLength={5000} {...register("notes")} />}
            </Field>
          </PanelBody>
          <PanelFooter>
            <Button variant="ghost" onClick={back}>
              Voltar
            </Button>
            <Button onClick={() => validateAndNext(["caseOriginId", "title", "area", "summary"])}>Continuar</Button>
          </PanelFooter>
        </Panel>
      )}

      {/* ----------------------------- Revisão ----------------------------- */}
      {step === "review" && (
        <Panel className="max-w-[900px]">
          <PanelHeader title="Revisar envio" />
          <PanelBody className="space-y-5">
            <Callout tone="warning" title="Confira antes de enviar">
              Confirme se os dados do cliente e os documentos estão corretos antes de enviá-los para Bárbara Cardoso Advocacia. Depois do envio, documentos não podem ser
              editados nem apagados.
            </Callout>
            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-foreground">Cliente</h3>
              {target?.mode === "EXISTING" ? (
                <p className="text-[13px] text-foreground/85">
                  {target.name ?? `${kind === "INDIVIDUAL" ? "CPF" : "CNPJ"} ${maskedDocument ?? ""}`} — o novo caso será vinculado ao cadastro existente, sem duplicar o cliente.
                </p>
              ) : (
                <DefinitionGrid
                  columns={3}
                  items={[
                    { label: "Tipo", value: CLIENT_KIND_LABEL[v.kind] },
                    { label: "Origem do cliente", value: originLabel(v.clientOriginId) },
                    { label: v.kind === "INDIVIDUAL" ? "CPF" : "CNPJ", value: maskedDocument },
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
                      {d.title} <span className="text-muted">· {DOCUMENT_CATEGORY_LABEL[d.category]}</span>
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
                  { label: "Área", value: areaName.get(v.area) },
                  { label: "Tipo", value: types.find((t) => t.value === v.caseTypeId)?.label },
                  { label: "Origem do caso", value: originLabel(v.caseOriginId) },
                  { label: "Parte contrária", value: blank(v.opposingParty) },
                  { label: "Relato", value: v.summary, wide: true },
                  { label: "Observações", value: blank(v.notes), wide: true },
                ]}
              />
            </section>
          </PanelBody>
          <PanelFooter>
            <Button variant="secondary" onClick={back} disabled={sending}>
              Voltar e revisar
            </Button>
            <Button onClick={submit} loading={sending}>
              Confirmar e enviar para Bárbara Cardoso Advocacia
            </Button>
          </PanelFooter>
        </Panel>
      )}
    </>
  );
}
