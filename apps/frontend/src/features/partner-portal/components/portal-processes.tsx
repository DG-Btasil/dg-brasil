"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Briefcase, Eye, FileClock, FileLock2, FilePlus2, History, Plus, SearchX } from "lucide-react";
import { BRAZILIAN_STATES, COURTS, LEGAL_AREA_LABEL, LEGAL_AREAS, type LegalArea } from "@/lib/constants/legal";
import {
  CLIENT_POLE_LABEL,
  CLIENT_POLES,
  DOCUMENT_CATEGORY_LABEL,
  PARTNERSHIP_STATUS_LABEL,
  PARTNERSHIP_STATUS_TONE,
  PROCESS_EVENT_SOURCE_LABEL,
  PROCESS_PHASE_LABEL,
  PROCESS_STATUS_LABEL,
  PROCESS_STATUS_TONE,
  SUBMISSION_STATUS_LABEL,
  SUBMISSION_STATUS_TONE,
  type ClientPole,
} from "@/lib/constants/status";
import { formatCurrency, formatDate, formatEventTime, pluralize } from "@/lib/formatting";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import { isCnjFormat, msg, parseCurrencyInput } from "@/lib/validation";
import { Can, PageContainer } from "@/components/layout/guards";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader, Stat, Timeline } from "@/components/ui/display";
import { Field, Input, MaskedInput, SearchInput, Select } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { EmptyState } from "@/components/feedback/states";
import { useCan } from "@/features/auth/hooks";
import { useProcessPartnership } from "@/features/partners/hooks";
import { PartnerRequestList } from "@/features/partners/components/request-list";
import { clientDisplayName } from "@/features/processes/utils";
import { useScopedStore } from "@/store/scope";
import type { ClientDocument, ID, Process } from "@/types";
import {
  useCurrentDocuments,
  useDocumentVersions,
  usePortalActions,
  usePortalClientMap,
  usePortalClients,
  usePortalProcesses,
  usePortalRequests,
  useSubmissionStatusByProcess,
} from "../hooks";
import { ApprovedDocumentDialog, RespondRequestDialog, SendDocumentDialog } from "./portal-dialogs";

function normalize(v: string) {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Processos do escritório parceiro. */
export function PortalProcessList() {
  const processes = usePortalProcesses();
  const clientMap = usePortalClientMap();
  const submission = useSubmissionStatusByProcess();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = normalize(q.trim());
    return processes
      .filter((p) => !term || normalize(`${p.title} ${p.cnj ?? ""} ${clientDisplayName(clientMap.get(p.clientId))}`).includes(term))
      .sort((a, b) => (b.lastMovementAt ?? b.updatedAt).localeCompare(a.lastMovementAt ?? a.updatedAt));
  }, [processes, q, clientMap]);

  const cta = (
    <Can permission="partnerPortal.processes.create">
      <ButtonLink href="/processos/novo" icon={<Plus className="size-4" aria-hidden />}>
        Cadastrar processo
      </ButtonLink>
    </Can>
  );

  return (
    <PageContainer>
      <PageHeader title="Processos" description="Andamento dos casos do seu escritório conduzidos pela Bárbara Cardoso Advocacia." actions={cta} />
      {processes.length === 0 ? (
        <Panel>
          <EmptyState icon={Briefcase} title="Nenhum processo ainda." description="Envie um caso em Clientes → Novo cliente, ou cadastre um processo já existente." action={cta} />
        </Panel>
      ) : (
        <Panel>
          <div className="flex items-center gap-3 border-b border-line px-5 py-3">
            <SearchInput aria-label="Buscar processos" placeholder="Buscar por cliente, título ou número CNJ" value={q} onChange={(e) => setQ(e.target.value)} className="w-[380px]" />
            <span className="text-[12.5px] text-muted">{pluralize(filtered.length, "processo", "processos")}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon={SearchX} title="Nenhum processo encontrado." />
          ) : (
            <Table caption="Processos do escritório parceiro">
              <THead>
                <tr>
                  <Th>Processo</Th>
                  <Th>Cliente</Th>
                  <Th>Área</Th>
                  <Th>Status</Th>
                  <Th>Caso</Th>
                  <Th>Atualização</Th>
                </tr>
              </THead>
              <TBody>
                {filtered.map((p) => {
                  const sub = submission.get(p.id);
                  return (
                    <Tr key={p.id}>
                      <Td>
                        <Link href={`/processos/${p.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                          {p.title}
                        </Link>
                        <div className="font-mono text-[11.5px] text-muted">{p.cnj ?? "Sem número CNJ"}</div>
                      </Td>
                      <Td className="text-[12.5px]">{clientDisplayName(clientMap.get(p.clientId))}</Td>
                      <Td className="text-[12.5px] text-muted">{LEGAL_AREA_LABEL[p.area]}</Td>
                      <Td>
                        <StatusBadge status={p.status} labels={PROCESS_STATUS_LABEL} tones={PROCESS_STATUS_TONE} />
                      </Td>
                      <Td>{sub ? <StatusBadge status={sub} labels={SUBMISSION_STATUS_LABEL} tones={SUBMISSION_STATUS_TONE} /> : <span className="text-[12px] text-subtle">—</span>}</Td>
                      <Td className="text-[12px] text-muted">{formatEventTime(p.lastMovementAt ?? p.updatedAt)}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Panel>
      )}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */

const TAB_KEYS = ["visao-geral", "movimentacoes", "documentos", "pendencias", "financeiro"] as const;
type TabKey = (typeof TAB_KEYS)[number];

/** Detalhe do processo no portal. Nenhum conteúdo interno chega aqui. */
export function PortalProcessDetail({ id }: { id: string }) {
  const processes = usePortalProcesses();
  const process = processes.find((p) => p.id === id);
  const clientMap = usePortalClientMap();
  const submission = useSubmissionStatusByProcess().get(id);
  const allRequests = usePortalRequests();
  const requests = useMemo(() => allRequests.filter((r) => r.processId === id), [allRequests, id]);
  const agreement = useProcessPartnership(id);
  const can = useCan();
  const [tab, setTab] = useUrlTab<TabKey>(TAB_KEYS, "visao-geral");

  const tabs = useMemo(() => {
    const items: TabItem<TabKey>[] = [
      { key: "visao-geral", label: "Visão geral" },
      { key: "movimentacoes", label: "Movimentações" },
      { key: "documentos", label: "Documentos" },
      { key: "pendencias", label: "Pendências", count: requests.filter((r) => r.status === "OPEN").length, attention: requests.some((r) => r.status === "OPEN") },
    ];
    if (can("partnerPortal.finance.view")) items.push({ key: "financeiro", label: "Financeiro" });
    return items;
  }, [can, requests]);

  // Processo de outro escritório (ou inexistente): não está no estado recortado.
  if (!process) {
    return (
      <PageContainer>
        <Panel className="mt-6">
          <EmptyState
            icon={SearchX}
            title="Processo não encontrado."
            description="O endereço pode estar incorreto ou este processo não pertence ao seu escritório."
            action={<ButtonLink href="/processos" variant="secondary">Voltar para Processos</ButtonLink>}
          />
        </Panel>
      </PageContainer>
    );
  }
  const client = clientMap.get(process.clientId);
  const active: TabKey = tabs.some((t) => t.key === tab) ? tab : "visao-geral";

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Processos", href: "/processos" }, { label: process.title }]}
        eyebrow={<span className="font-mono normal-case tracking-normal text-[12px]">{process.cnj ?? "Sem número CNJ"}</span>}
        title={process.title}
        meta={
          <>
            {client && (
              <Link href={`/clientes/${client.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                {clientDisplayName(client)}
              </Link>
            )}
            <StatusBadge status={process.status} labels={PROCESS_STATUS_LABEL} tones={PROCESS_STATUS_TONE} />
            {submission && (
              <span className="inline-flex items-center gap-1.5">
                Caso: <StatusBadge status={submission} labels={SUBMISSION_STATUS_LABEL} tones={SUBMISSION_STATUS_TONE} />
              </span>
            )}
          </>
        }
      />
      <Tabs items={tabs} value={active} onChange={setTab} label="Seções do processo" className="mb-5" />
      <TabPanel tabKey={active}>
        {active === "visao-geral" && <OverviewTab process={process} />}
        {active === "movimentacoes" && <EventsTab processId={process.id} />}
        {active === "documentos" && <DocumentsTab process={process} />}
        {active === "pendencias" && <RequestsTab processId={process.id} />}
        {active === "financeiro" && can("partnerPortal.finance.view") && <PartnerFinancePanel caseValue={process.caseValue} agreementStatus={agreement} />}
      </TabPanel>
    </PageContainer>
  );
}

function OverviewTab({ process }: { process: Process }) {
  const can = useCan();
  return (
    <Panel>
      <PanelHeader title="Dados do processo" />
      <PanelBody>
        <DefinitionGrid
          columns={3}
          items={[
            { label: "Área", value: LEGAL_AREA_LABEL[process.area] },
            { label: "Tipo de ação", value: process.actionType },
            { label: "Fase", value: PROCESS_PHASE_LABEL[process.phase] },
            { label: "Tribunal", value: process.court },
            { label: "Unidade", value: process.unit },
            { label: "Comarca/UF", value: [process.district, process.state].filter(Boolean).join("/") || undefined },
            { label: "Polo do cliente", value: CLIENT_POLE_LABEL[process.clientPole] },
            { label: "Parte contrária", value: process.opposingParty },
            { label: "Distribuição", value: process.distributionDate ? formatDate(process.distributionDate) : undefined },
            ...(can("processes.caseValue.view") ? [{ label: "Valor da causa", value: process.caseValue !== undefined ? formatCurrency(process.caseValue) : undefined }] : []),
            { label: "Conduzido por", value: "Bárbara Cardoso Advocacia" },
          ]}
        />
      </PanelBody>
    </Panel>
  );
}

function EventsTab({ processId }: { processId: ID }) {
  const all = useScopedStore((s) => s.processEvents);
  const events = useMemo(() => all.filter((e) => e.processId === processId).sort((a, b) => b.at.localeCompare(a.at)), [all, processId]);
  return (
    <Panel>
      <PanelHeader title="Movimentações" />
      <PanelBody>
        {events.length === 0 ? (
          <EmptyState compact title="Nenhuma movimentação registrada." />
        ) : (
          <Timeline
            items={events.map((e) => ({
              id: e.id,
              title: e.title,
              description: e.description,
              meta: `${formatEventTime(e.at)} · ${PROCESS_EVENT_SOURCE_LABEL[e.source]}`,
              highlight: e.important,
            }))}
          />
        )}
      </PanelBody>
    </Panel>
  );
}

function DocumentsTab({ process }: { process: Process }) {
  const documents = useCurrentDocuments({ processId: process.id });
  const signals = useScopedStore((s) => s.reviewSignals);
  const inReview = signals.filter((s) => s.processId === process.id);
  const [sending, setSending] = useState<{ replaces?: ClientDocument } | null>(null);
  const [viewing, setViewing] = useState<ClientDocument | null>(null);
  const [history, setHistory] = useState<ClientDocument | null>(null);
  const mine = documents.filter((d) => d.uploadedByPartnerOfficeId);
  const approved = documents.filter((d) => !d.uploadedByPartnerOfficeId);

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader title="Documentos do escritório" description="Documentos elaborados pela Bárbara Cardoso Advocacia." />
        {approved.length === 0 && inReview.length === 0 ? (
          <EmptyState compact title="Nenhum documento disponível ainda." />
        ) : (
          <ul className="divide-y divide-line">
            {inReview.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                <FileClock className="size-4 text-gold-600" aria-hidden />
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-foreground">Documento em elaboração</p>
                  <p className="text-[12px] text-muted">Desde {formatDate(s.since)}</p>
                </div>
                <Badge tone="gold">Em revisão interna</Badge>
              </li>
            ))}
            {approved.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                <FileLock2 className="size-4 text-success" aria-hidden />
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-foreground">{d.name}</p>
                  <p className="text-[12px] text-muted">{d.approvedContent ? `Aprovado em ${formatDate(d.approvedContent.approvedAt)}` : formatDate(d.updatedAt)}</p>
                </div>
                <Badge tone="success">Documento aprovado</Badge>
                <Button size="sm" variant="secondary" icon={<Eye className="size-3.5" aria-hidden />} onClick={() => setViewing(d)}>
                  Visualizar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Documentos enviados por você"
          description="Documentos enviados não podem ser editados nem apagados. Para corrigir, envie uma nova versão — a anterior fica guardada."
          actions={
            <Can permission="partnerPortal.documents.submit">
              <Button size="sm" icon={<FilePlus2 className="size-3.5" aria-hidden />} onClick={() => setSending({})}>
                Enviar documento
              </Button>
            </Can>
          }
        />
        {mine.length === 0 ? (
          <EmptyState compact title="Nenhum documento enviado neste processo." />
        ) : (
          <Table caption="Documentos enviados">
            <THead>
              <tr>
                <Th>Documento</Th>
                <Th>Tipo</Th>
                <Th>Versão</Th>
                <Th>Enviado em</Th>
                <Th>
                  <span className="sr-only">Ações</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {mine.map((d) => (
                <Tr key={d.id}>
                  <Td className="font-medium text-foreground">{d.name}</Td>
                  <Td className="text-[12.5px] text-muted">{DOCUMENT_CATEGORY_LABEL[d.category]}</Td>
                  <Td className="text-[12.5px] tabular">v{d.version ?? 1}</Td>
                  <Td className="text-[12.5px] text-muted">{d.submittedAt ? formatDate(d.submittedAt) : "—"}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {(d.version ?? 1) > 1 && (
                      <Button size="sm" variant="ghost" icon={<History className="size-3.5" aria-hidden />} onClick={() => setHistory(d)}>
                        Versões
                      </Button>
                    )}
                    <Can permission="partnerPortal.documents.submit">
                      <Button size="sm" variant="secondary" onClick={() => setSending({ replaces: d })}>
                        Enviar nova versão
                      </Button>
                    </Can>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      {sending && <SendDocumentDialog clientId={process.clientId} processId={process.id} replaces={sending.replaces} open onOpenChange={(o) => !o && setSending(null)} />}
      {viewing && <ApprovedDocumentDialog doc={viewing} open onOpenChange={(o) => !o && setViewing(null)} />}
      {history && <VersionsList doc={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function VersionsList({ doc, onClose }: { doc: ClientDocument; onClose: () => void }) {
  const versions = useDocumentVersions(doc);
  return (
    <Panel className="fixed bottom-6 right-6 z-40 w-[420px] shadow-overlay">
      <PanelHeader
        title={`Versões — ${doc.name}`}
        actions={
          <Button size="sm" variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        }
      />
      <ul className="divide-y divide-line">
        {versions.map((v) => (
          <li key={v.id} className="flex items-center justify-between px-5 py-2.5 text-[12.5px]">
            <span>
              v{v.version ?? 1} · {v.fileName}
            </span>
            <span className="text-muted">{v.supersededAt ? `substituída em ${formatDate(v.supersededAt)}` : "vigente"}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RequestsTab({ processId }: { processId: ID }) {
  const all = usePortalRequests();
  const requests = useMemo(() => all.filter((r) => r.processId === processId), [all, processId]);
  const clientMap = usePortalClientMap();
  const processes = usePortalProcesses();
  const processMap = useMemo(() => new Map(processes.map((p) => [p.id, p])), [processes]);
  const [respond, setRespond] = useState<ID | null>(null);
  const [send, setSend] = useState<ID | null>(null);
  const responding = requests.find((r) => r.id === respond);
  const sendingFor = requests.find((r) => r.id === send);
  return (
    <Panel>
      <PanelHeader title="Pendências deste processo" />
      <PartnerRequestList
        requests={requests}
        clientMap={clientMap}
        processMap={processMap}
        emptyText="Nenhuma pendência neste processo."
        actions={(r) =>
          r.status === "OPEN" && (
            <Can permission="partnerPortal.requests.respond">
              {r.type === "DOCUMENT_REQUEST" || r.type === "CORRECTION_REQUEST" ? (
                <Button size="sm" onClick={() => setSend(r.id)}>
                  Enviar documento
                </Button>
              ) : (
                <Button size="sm" onClick={() => setRespond(r.id)}>
                  Responder
                </Button>
              )}
            </Can>
          )
        }
      />
      {responding && <RespondRequestDialog request={responding} open onOpenChange={(o) => !o && setRespond(null)} />}
      {sendingFor && sendingFor.clientId && <SendDocumentDialog clientId={sendingFor.clientId} request={sendingFor} open onOpenChange={(o) => !o && setSend(null)} />}
    </Panel>
  );
}

/**
 * Financeiro do processo para o ADMINISTRADOR DO PARCEIRO: só a participação
 * do próprio parceiro. Sem custos internos, outros parceiros ou consumo.
 */
function PartnerFinancePanel({ caseValue, agreementStatus: a }: { caseValue?: number; agreementStatus?: ReturnType<typeof useProcessPartnership> }) {
  if (!a) {
    return (
      <Panel>
        <EmptyState compact title="Ainda não há valores registrados para este caso." />
      </Panel>
    );
  }
  const realized = a.realizedRevenue !== undefined;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Valor da causa" value={formatCurrency(caseValue)} hint="Dado jurídico — não é dividido" />
        {realized ? (
          <>
            <Stat label="Honorários realizados" value={formatCurrency(a.realizedRevenue)} />
            <Stat label="Sua participação" value={formatCurrency(a.realizedPartnerAmount)} hint={`Pago: ${formatCurrency(a.paidPartnerAmount)}`} />
            <Stat label="A receber" value={formatCurrency(a.pendingPartnerAmount)} tone={a.pendingPartnerAmount ? "gold" : "neutral"} />
          </>
        ) : (
          <>
            <Stat label="Honorários estimados" value={formatCurrency(a.revenueBase)} hint="Estimativa — não é garantia" />
            <Stat label="Sua participação estimada" value={formatCurrency(a.estimatedPartnerAmount)} hint="Estimativa" />
            <Stat label="Situação" value={<StatusBadge status={a.status} labels={PARTNERSHIP_STATUS_LABEL} tones={PARTNERSHIP_STATUS_TONE} />} />
          </>
        )}
      </div>
      <p className="text-[12px] text-subtle">
        Participação deste caso: {a.partnerPercentage}%, registrada em {formatDate(a.effectiveAt)}. Valores estimados podem mudar e não representam garantia de recebimento.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface ProcessValues {
  clientId: string;
  cnj: string;
  title: string;
  court: string;
  unit: string;
  district: string;
  state: string;
  area: LegalArea | "";
  actionType: string;
  clientPole: ClientPole;
  opposingParty: string;
  distributionDate: string;
  caseValue: string;
}

const opts = <T extends string>(values: readonly T[], labels?: Record<T, string>) => values.map((v) => ({ value: v, label: labels ? labels[v] : v }));
const blank = (v: string) => (v.trim() ? v.trim() : undefined);

/**
 * Cadastro de processo pelo parceiro. Não há campo de escritório: a origem
 * (parceiro da sessão) é aplicada pelo sistema, sem escolha na tela.
 */
export function PortalProcessForm() {
  const router = useRouter();
  const params = useSearchParams();
  const clients = usePortalClients();
  const actions = usePortalActions();
  const clientOptions = useMemo(() => clients.map((c) => ({ value: c.id, label: clientDisplayName(c) })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")), [clients]);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProcessValues>({
    defaultValues: {
      clientId: params.get("cliente") ?? "",
      cnj: "",
      title: "",
      court: "",
      unit: "",
      district: "",
      state: "",
      area: "",
      actionType: "",
      clientPole: "ACTIVE",
      opposingParty: "",
      distributionDate: "",
      caseValue: "",
    },
  });
  const onSubmit = handleSubmit(async (v) => {
    const id = await actions.createProcess({
      clientId: v.clientId,
      cnj: blank(v.cnj),
      title: v.title.trim(),
      court: blank(v.court),
      unit: blank(v.unit),
      district: blank(v.district),
      state: blank(v.state),
      area: v.area as LegalArea,
      actionType: v.actionType.trim(),
      clientPole: v.clientPole,
      opposingParty: blank(v.opposingParty),
      distributionDate: blank(v.distributionDate),
      caseValue: parseCurrencyInput(v.caseValue),
    });
    if (id) router.push(`/processos/${id}`);
  });

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Processos", href: "/processos" }, { label: "Cadastrar processo" }]}
        title="Cadastrar processo"
        description="Para um cliente que ainda não está no portal, use Clientes → Novo cliente."
      />
      {clients.length === 0 ? (
        <Panel>
          <EmptyState compact title="Cadastre um cliente primeiro." action={<ButtonLink href="/clientes/novo">Novo cliente</ButtonLink>} />
        </Panel>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <Panel className="max-w-[900px]">
            <PanelBody className="grid grid-cols-2 gap-x-5 gap-y-4">
              <Field label="Cliente" requirement="required" error={errors.clientId?.message}>
                {(p) => <Select {...p} placeholder="Selecione" options={clientOptions} {...register("clientId", { required: "Selecione o cliente." })} />}
              </Field>
              <Field label="Número CNJ" requirement="optional" error={errors.cnj?.message}>
                {(p) => <MaskedInput mask="cnj" placeholder="0000000-00.0000.0.00.0000" {...p} {...register("cnj", { validate: (x) => !x || isCnjFormat(x) || msg.cnj })} />}
              </Field>
              <Field label="Nome resumido" requirement="required" error={errors.title?.message} className="col-span-2">
                {(p) => <Input {...p} {...register("title", { validate: (x) => !!x.trim() || "Informe um nome resumido." })} />}
              </Field>
              <Field label="Tribunal" requirement="optional">
                {(p) => <Select {...p} placeholder="Selecione" options={opts(COURTS)} {...register("court")} />}
              </Field>
              <Field label="Unidade / vara" requirement="optional">
                {(p) => <Input {...p} {...register("unit")} />}
              </Field>
              <Field label="Comarca" requirement="optional">
                {(p) => <Input {...p} {...register("district")} />}
              </Field>
              <Field label="UF" requirement="optional">
                {(p) => <Select {...p} placeholder="Selecione" options={opts(BRAZILIAN_STATES)} {...register("state")} />}
              </Field>
              <Field label="Área" requirement="required" error={errors.area?.message}>
                {(p) => <Select {...p} placeholder="Selecione" options={opts(LEGAL_AREAS, LEGAL_AREA_LABEL)} {...register("area", { required: "Selecione a área." })} />}
              </Field>
              <Field label="Tipo de ação" requirement="required" error={errors.actionType?.message}>
                {(p) => <Input {...p} {...register("actionType", { validate: (x) => !!x.trim() || "Informe o tipo de ação." })} />}
              </Field>
              <Field label="Polo do cliente" requirement="required">
                {(p) => <Select {...p} options={opts(CLIENT_POLES, CLIENT_POLE_LABEL)} {...register("clientPole")} />}
              </Field>
              <Field label="Parte contrária" requirement="recommended">
                {(p) => <Input {...p} {...register("opposingParty")} />}
              </Field>
              <Field label="Data de distribuição" requirement="optional">
                {(p) => <Input {...p} type="date" {...register("distributionDate")} />}
              </Field>
              <Field label="Valor da causa" requirement="optional" hint="Dado jurídico — não é honorário.">
                {(p) => <Input {...p} inputMode="decimal" placeholder="R$ 0,00" {...register("caseValue")} />}
              </Field>
            </PanelBody>
            <PanelFooter>
              <Button variant="ghost" onClick={() => router.push("/processos")}>
                Cancelar
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Cadastrar processo
              </Button>
            </PanelFooter>
          </Panel>
        </form>
      )}
    </PageContainer>
  );
}
