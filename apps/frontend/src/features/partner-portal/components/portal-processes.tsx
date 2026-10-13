"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Scale } from "lucide-react";
import { BRAZILIAN_STATES, COURTS } from "@/lib/constants/legal";
import { CLIENT_POLE_LABEL, CLIENT_POLES, LEGAL_CASE_STATUSES, PROCESS_PHASE_LABEL, PROCESS_STATUS_LABEL, PROCESS_STATUS_TONE } from "@/lib/constants/status";
import { formatCurrency, formatDate } from "@/lib/formatting";
import { callAction, mapFieldErrors, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import { isCnjFormat, msg } from "@/lib/validation";
import { Can, PageContainer } from "@/components/layout/guards";
import { AsyncPicker, type PickerOption } from "@/components/ui/async-picker";
import { StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Field, Input, MaskedInput, Select } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import type { Page } from "@/server/core/pagination";
import { listCasesAction } from "@/server/domain/cases/actions";
import type { DocumentListItem } from "@/server/domain/documents/dto";
import type { PartnerRequestListItem } from "@/server/domain/partner-requests/dto";
import { createPartnerProcessAction, listProcessesAction } from "@/server/domain/processes/actions";
import type { ProcessEventDTO, ProcessListItem, ProcessPartnerDTO } from "@/server/domain/processes/dto";
import { useToast } from "@/store/ui-store";
import { usePermission } from "@/features/auth/hooks";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import { RequestsPanel } from "@/features/partner-requests/components/requests-panel";
import { CnjText } from "@/features/processes/components/cnj-text";
import { ProcessListTable } from "@/features/processes/components/process-list-table";
import { EventsTab } from "@/features/processes/components/tabs/events-tab";
import { portalProcessInput, type PortalListQuery } from "../list-query";
import { partnerProcessInput, type PartnerProcessValues } from "../server-input";
import { PortalServerList } from "./portal-list";

/** Processos dos casos do escritório parceiro (RLS). */
export function PortalProcessList({ initialQuery, initialResult }: { initialQuery: PortalListQuery; initialResult: ActionResult<Page<ProcessListItem>> }) {
  const cta = (
    <Can permission="partnerPortal.processes.create">
      <ButtonLink href="/processos/novo" variant="secondary" icon={<Scale className="size-4" aria-hidden />}>
        Cadastrar processo
      </ButtonLink>
    </Can>
  );
  return (
    <PortalServerList
      title="Processos"
      description="Processos dos casos do seu escritório, conduzidos pela Bárbara Cardoso Advocacia."
      cta={cta}
      initialQuery={initialQuery}
      initialResult={initialResult}
      load={(q) => listProcessesAction(portalProcessInput(q))}
      noun={{ one: "processo", many: "processos" }}
      searchLabel="Buscar por número CNJ ou título"
      empty={{ icon: Scale, title: "Nenhum processo ainda.", description: "Processos são cadastrados dentro de um caso do seu escritório." }}
      errorTitle="Não foi possível carregar os processos."
    >
      {(rows) => <ProcessListTable rows={rows} />}
    </PortalServerList>
  );
}

/* ------------------------------------------------------------------ */

const TAB_KEYS = ["visao-geral", "movimentacoes", "documentos", "pendencias"] as const;
type TabKey = (typeof TAB_KEYS)[number];

/**
 * Processo no portal (ProcessPartnerDTO): só dados processuais, movimentações
 * oficiais e do sistema (nota manual e registro de agente ficam de fora no
 * servidor), documentos compartilhados e as pendências do caso.
 */
export function PortalProcessDetail({
  process,
  events,
  documents,
  requests,
}: {
  process: ProcessPartnerDTO;
  events: ActionResult<Page<ProcessEventDTO>>;
  documents: ActionResult<Page<DocumentListItem>>;
  requests: ActionResult<Page<PartnerRequestListItem>>;
}) {
  const [tab, setTab] = useUrlTab<TabKey>(TAB_KEYS, "visao-geral");
  const showCaseValue = usePermission("processes.caseValue.view");
  const open = requests.ok ? requests.data.items.filter((r) => r.status === "OPEN").length : 0;
  // O financeiro pertence ao caso: fica na página do caso.
  const tabs = useMemo<TabItem<TabKey>[]>(
    () => [
      { key: "visao-geral", label: "Visão geral" },
      { key: "movimentacoes", label: "Movimentações" },
      { key: "documentos", label: "Documentos" },
      { key: "pendencias", label: "Pendências do caso", count: open, attention: open > 0 },
    ],
    [open],
  );

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Processos", href: "/processos" }, { label: process.title }]}
        eyebrow={
          <span className="font-mono normal-case tracking-normal text-[12px]">
            <CnjText cnj={process.cnj} />
          </span>
        }
        title={process.title}
        meta={
          <>
            {process.clientName && (
              <Link href={`/clientes/${process.clientId}`} className="font-medium text-navy hover:underline underline-offset-2">
                {process.clientName}
              </Link>
            )}
            <StatusBadge status={process.status} labels={PROCESS_STATUS_LABEL} tones={PROCESS_STATUS_TONE} />
            <span>
              Caso:{" "}
              <Link href={`/casos/${process.legalCaseId}`} className="font-medium text-navy hover:underline underline-offset-2">
                {process.caseTitle}
              </Link>
            </span>
          </>
        }
      />
      <Tabs items={tabs} value={tab} onChange={setTab} label="Seções do processo" className="mb-5" />
      <TabPanel tabKey={tab}>
        {tab === "visao-geral" && (
          <Panel>
            <PanelHeader title="Dados do processo" />
            <PanelBody>
              <DefinitionGrid
                columns={3}
                items={[
                  { label: "Tipo de ação", value: process.actionType },
                  { label: "Assunto", value: process.subject },
                  { label: "Fase", value: process.phase ? PROCESS_PHASE_LABEL[process.phase] : undefined },
                  { label: "Tribunal", value: process.court },
                  { label: "Unidade", value: process.unit },
                  { label: "Comarca/UF", value: [process.district, process.state].filter(Boolean).join("/") || undefined },
                  { label: "Polo do cliente", value: process.clientPole ? CLIENT_POLE_LABEL[process.clientPole] : undefined },
                  { label: "Parte contrária", value: process.opposingParty },
                  { label: "Distribuição", value: process.distributionDate ? formatDate(process.distributionDate) : undefined },
                  ...(showCaseValue ? [{ label: "Valor da causa", value: process.caseValue !== undefined ? formatCurrency(process.caseValue) : undefined }] : []),
                  { label: "Conduzido por", value: "Bárbara Cardoso Advocacia" },
                ]}
              />
            </PanelBody>
          </Panel>
        )}
        {tab === "movimentacoes" && <EventsTab processId={process.id} initial={events} onAdd={() => undefined} />}
        {tab === "documentos" && (
          <DocumentsPanel
            scope={{ legalProcessId: process.id }}
            initial={documents}
            title="Documentos do processo"
            description="Documentos enviados não podem ser editados nem apagados. Para corrigir, envie uma nova versão."
          />
        )}
        {tab === "pendencias" && (
          <RequestsPanel scope={{ legalCaseId: process.legalCaseId }} initial={requests} title="Pendências do caso" description="Solicitações da Bárbara Cardoso Advocacia sobre o caso deste processo." showCase={false} />
        )}
      </TabPanel>
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */

const opts = <T extends string>(values: readonly T[], labels?: Record<T, string>) => values.map((v) => ({ value: v, label: labels ? labels[v] : v }));
/** Processo só entra em caso enviado, em análise, aceito, em andamento ou encerrado (o banco confere). */
const CASE_STATUSES_FOR_PROCESS = LEGAL_CASE_STATUSES.filter((s) => s !== "DRAFT" && s !== "REJECTED" && s !== "ARCHIVED");
const FIELD_MAP: Record<string, string> = { legalCaseId: "legalCaseId" };

/**
 * Cadastro de processo pelo parceiro (createPartnerProcessAction): sempre
 * dentro de um caso do próprio escritório. A origem é a do caso; não há
 * escolha de escritório. Chave de idempotência por intenção de envio.
 */
export function PortalProcessForm({ initialCase }: { initialCase?: PickerOption }) {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const [legalCase, setLegalCase] = useState<PickerOption | null>(initialCase ?? null);
  const [caseError, setCaseError] = useState<string>();
  const searchCases = useCallback(async (q: string): Promise<{ ok: true; options: PickerOption[] } | { ok: false; message: string }> => {
    const r = await callAction(() => listCasesAction({ q: q.trim() || undefined, status: CASE_STATUSES_FOR_PROCESS, pageSize: 10, sortBy: "updatedAt", sortDirection: "desc" }));
    if (!r.ok) return { ok: false, message: r.error.message };
    return { ok: true, options: r.data.items.map((c) => ({ id: c.id, label: c.title, description: c.clientName })) };
  }, []);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PartnerProcessValues>({
    defaultValues: { cnj: "", title: "", court: "", unit: "", district: "", state: "", actionType: "", subject: "", clientPole: "ACTIVE", opposingParty: "", distributionDate: "", caseValue: "" },
  });
  const back = initialCase ? `/casos/${initialCase.id}?aba=processos` : "/processos";

  const onSubmit = handleSubmit(async (v) => {
    if (!legalCase) {
      setCaseError("Selecione o caso.");
      return;
    }
    const input = partnerProcessInput(legalCase.id, v);
    const result = await callAction(() => createPartnerProcessAction({ ...input, idempotencyKey: idempotency.keyFor(input) }));
    if (!result.ok) {
      const fields = mapFieldErrors(result.error.fieldErrors, FIELD_MAP);
      if (fields.legalCaseId) setCaseError(fields.legalCaseId);
      for (const [path, message] of Object.entries(fields)) if (path !== "legalCaseId") setError(path as keyof PartnerProcessValues, { message });
      if (Object.keys(fields).length === 0) failed(result, "Não foi possível cadastrar o processo.");
      return;
    }
    idempotency.reset();
    toast({ tone: "success", title: "Processo cadastrado", description: String(input.title) });
    // Recurso devolvido pelo servidor (também quando deduplicado).
    router.push(`/processos/${result.data.id}`);
  });

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Processos", href: "/processos" }, { label: "Cadastrar processo" }]}
        title="Cadastrar processo"
        description="Todo processo pertence a um caso. Para uma nova demanda, envie antes um caso em Casos → Novo caso."
      />
      <form onSubmit={onSubmit} noValidate>
        <Panel className="max-w-[900px]">
          <PanelBody className="grid grid-cols-2 gap-x-5 gap-y-4">
            <Field label="Caso relacionado" requirement="required" error={caseError} hint="Casos do seu escritório já enviados.">
              {(p) => (
                <AsyncPicker
                  {...p}
                  value={legalCase}
                  onChange={(o) => {
                    setLegalCase(o);
                    setCaseError(undefined);
                  }}
                  search={searchCases}
                  placeholder="Buscar caso pelo título"
                />
              )}
            </Field>
            <Field label="Número CNJ" requirement="optional" error={errors.cnj?.message}>
              {(p) => <MaskedInput mask="cnj" placeholder="0000000-00.0000.0.00.0000" {...p} {...register("cnj", { validate: (x) => !x || isCnjFormat(x) || msg.cnj })} />}
            </Field>
            <Field label="Nome resumido" requirement="required" error={errors.title?.message} className="col-span-2">
              {(p) => <Input {...p} maxLength={300} {...register("title", { validate: (x) => !!x.trim() || "Informe um nome resumido." })} />}
            </Field>
            <Field label="Tribunal" requirement="optional">
              {(p) => <Select {...p} placeholder="Selecione" options={opts(COURTS)} {...register("court")} />}
            </Field>
            <Field label="Unidade / vara" requirement="optional">
              {(p) => <Input {...p} maxLength={200} {...register("unit")} />}
            </Field>
            <Field label="Comarca" requirement="optional">
              {(p) => <Input {...p} maxLength={120} {...register("district")} />}
            </Field>
            <Field label="UF" requirement="optional" error={errors.state?.message}>
              {(p) => <Select {...p} placeholder="Selecione" options={opts(BRAZILIAN_STATES)} {...register("state")} />}
            </Field>
            <Field label="Tipo de ação" requirement="recommended" error={errors.actionType?.message}>
              {(p) => <Input {...p} maxLength={200} {...register("actionType")} />}
            </Field>
            <Field label="Assunto" requirement="optional">
              {(p) => <Input {...p} maxLength={300} {...register("subject")} />}
            </Field>
            <Field label="Polo do cliente" requirement="required">
              {(p) => <Select {...p} options={opts(CLIENT_POLES, CLIENT_POLE_LABEL)} {...register("clientPole")} />}
            </Field>
            <Field label="Parte contrária" requirement="recommended">
              {(p) => <Input {...p} maxLength={500} {...register("opposingParty")} />}
            </Field>
            <Field label="Data de distribuição" requirement="optional" error={errors.distributionDate?.message}>
              {(p) => <Input {...p} type="date" {...register("distributionDate")} />}
            </Field>
            <Field label="Valor da causa" requirement="optional" hint="Dado jurídico — não é honorário." error={errors.caseValue?.message}>
              {(p) => <Input {...p} inputMode="decimal" placeholder="R$ 0,00" {...register("caseValue")} />}
            </Field>
          </PanelBody>
          <PanelFooter>
            <Button variant="ghost" onClick={() => router.push(back)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Cadastrar processo
            </Button>
          </PanelFooter>
        </Panel>
      </form>
    </PageContainer>
  );
}
