"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FilePlus2, FolderOpen, FolderPlus, Plus, SearchX } from "lucide-react";
import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import {
  DOCUMENT_CATEGORY_LABEL,
  LEGAL_CASE_STATUS_TONE,
  LEGAL_CASE_STATUSES,
  PARTNER_CASE_STATUS_LABEL,
  PROCESS_STATUS_LABEL,
  PROCESS_STATUS_TONE,
} from "@/lib/constants/status";
import { formatDate, formatDateTime, formatEventTime, pluralize } from "@/lib/formatting";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import { Can, PageContainer } from "@/components/layout/guards";
import { Callout, EmptyState } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader, Timeline } from "@/components/ui/display";
import { SearchInput, Select } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { useCan } from "@/features/auth/hooks";
import { useCaseActivity, useCasePartnership, useCaseProcesses, useCaseRows, useLegalCase, useOfficeNames } from "@/features/cases/hooks";
import { CaseTable } from "@/features/cases/components/case-table";
import { PartnerRequestList } from "@/features/partners/components/request-list";
import { clientDisplayName } from "@/features/processes/utils";
import type { ClientDocument, ID, LegalCase } from "@/types";
import { useCurrentDocuments, usePortalClientMap, usePortalProcesses, usePortalRequests } from "../hooks";
import { ApprovedDocumentDialog, RespondRequestDialog, SendDocumentDialog } from "./portal-dialogs";
import { PartnerFinancePanel } from "./portal-processes";

function normalize(v: string) {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Situações simplificadas para o parceiro (sem duplicatas de rótulo).
const STATUS_OPTIONS = [...new Set(LEGAL_CASE_STATUSES.map((s) => PARTNER_CASE_STATUS_LABEL[s]))].map((label) => ({ value: label, label }));

/** Casos do escritório parceiro. */
export function PortalCaseList() {
  const rows = useCaseRows();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const filtered = useMemo(() => {
    const term = normalize(q.trim());
    return rows.filter(
      (r) => (!term || normalize(`${r.legalCase.title} ${r.clientName} ${r.legalCase.caseType}`).includes(term)) && (!status || PARTNER_CASE_STATUS_LABEL[r.legalCase.status] === status),
    );
  }, [rows, q, status]);

  const cta = (
    <Can permission="partnerPortal.cases.create">
      <ButtonLink href="/casos/novo" icon={<Plus className="size-4" aria-hidden />}>
        Novo caso
      </ButtonLink>
    </Can>
  );

  return (
    <PageContainer>
      <PageHeader title="Casos" description="Casos do seu escritório enviados à Bárbara Cardoso Advocacia." actions={cta} />
      {rows.length === 0 ? (
        <Panel>
          <EmptyState icon={FolderOpen} title="Nenhum caso ainda." description="Envie um caso para a Bárbara Cardoso Advocacia analisar." action={cta} />
        </Panel>
      ) : (
        <Panel>
          <div className="flex items-center gap-3 border-b border-line px-5 py-3">
            <SearchInput aria-label="Buscar casos" placeholder="Buscar por caso, cliente ou tipo" value={q} onChange={(e) => setQ(e.target.value)} className="w-[380px]" />
            <label className="w-[220px]">
              <span className="sr-only">Situação</span>
              <Select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} placeholder="Situação" className="h-8 text-[12.5px]" />
            </label>
            <span className="text-[12.5px] text-muted">{pluralize(filtered.length, "caso", "casos")}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon={SearchX} title="Nenhum caso encontrado." />
          ) : (
            <CaseTable rows={filtered} statusLabels={PARTNER_CASE_STATUS_LABEL} showLawyer={false} />
          )}
        </Panel>
      )}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */

const TAB_KEYS = ["visao-geral", "documentos", "pendencias", "processos", "financeiro", "historico"] as const;
type TabKey = (typeof TAB_KEYS)[number];

/** Caso no portal. Nenhum conteúdo interno chega aqui (nota interna, análise, revisões). */
export function PortalCaseDetail({ id }: { id: string }) {
  const legalCase = useLegalCase(id);
  const clientMap = usePortalClientMap();
  const allRequests = usePortalRequests();
  const requests = useMemo(() => allRequests.filter((r) => r.legalCaseId === id), [allRequests, id]);
  const processes = useCaseProcesses(id);
  const can = useCan();
  const [tab, setTab] = useUrlTab<TabKey>(TAB_KEYS, "visao-geral");

  const tabs = useMemo(() => {
    const items: TabItem<TabKey>[] = [
      { key: "visao-geral", label: "Visão geral" },
      { key: "documentos", label: "Documentos" },
      { key: "pendencias", label: "Pendências", count: requests.filter((r) => r.status === "OPEN").length, attention: requests.some((r) => r.status === "OPEN") },
      { key: "processos", label: "Processos", count: processes.length },
    ];
    if (can("partnerPortal.finance.view")) items.push({ key: "financeiro", label: "Financeiro" });
    items.push({ key: "historico", label: "Histórico" });
    return items;
  }, [can, requests, processes.length]);

  if (!legalCase) {
    return (
      <PageContainer>
        <Panel className="mt-6">
          <EmptyState
            icon={SearchX}
            title="Caso não encontrado."
            description="O endereço pode estar incorreto ou este caso não pertence ao seu escritório."
            action={
              <ButtonLink href="/casos" variant="secondary">
                Voltar para Casos
              </ButtonLink>
            }
          />
        </Panel>
      </PageContainer>
    );
  }
  const client = clientMap.get(legalCase.clientId);
  const active: TabKey = tabs.some((t) => t.key === tab) ? tab : "visao-geral";

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Casos", href: "/casos" }, { label: legalCase.title }]}
        title={legalCase.title}
        meta={
          <>
            {client && (
              <Link href={`/clientes/${client.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                {clientDisplayName(client)}
              </Link>
            )}
            <StatusBadge status={legalCase.status} labels={PARTNER_CASE_STATUS_LABEL} tones={LEGAL_CASE_STATUS_TONE} />
            <span>Atualizado {formatEventTime(legalCase.updatedAt)}</span>
          </>
        }
      />
      <Tabs items={tabs} value={active} onChange={setTab} label="Seções do caso" className="mb-5" />
      <TabPanel tabKey={active}>
        {active === "visao-geral" && <Overview legalCase={legalCase} />}
        {active === "documentos" && <Documents legalCase={legalCase} />}
        {active === "pendencias" && <Requests legalCaseId={legalCase.id} />}
        {active === "processos" && <Processes legalCase={legalCase} />}
        {active === "financeiro" && can("partnerPortal.finance.view") && <Finance legalCaseId={legalCase.id} />}
        {active === "historico" && <HistoryTab legalCaseId={legalCase.id} />}
      </TabPanel>
    </PageContainer>
  );
}

function Overview({ legalCase }: { legalCase: LegalCase }) {
  const officeName = useOfficeNames();
  return (
    <div className="space-y-5">
      {legalCase.status === "REJECTED" && (
        <Callout tone="neutral" title="Caso não aceito">
          {legalCase.rejectionReasonPublic ?? "A Bárbara Cardoso Advocacia não aceitou este caso."}
        </Callout>
      )}
      <Panel>
        <PanelHeader title="Dados do caso" />
        <PanelBody>
          <DefinitionGrid
            columns={3}
            items={[
              { label: "Área", value: LEGAL_AREA_LABEL[legalCase.area] },
              { label: "Tipo", value: legalCase.caseType },
              { label: "Parte contrária", value: legalCase.opposingParty },
              { label: "Origem do caso", value: officeName(legalCase.originOfficeId) },
              { label: "Enviado em", value: legalCase.submittedAt ? formatDateTime(legalCase.submittedAt) : undefined },
              { label: "Aceito em", value: legalCase.acceptedAt ? formatDateTime(legalCase.acceptedAt) : undefined },
              { label: "Relato", value: legalCase.summary, wide: true },
              ...(legalCase.partnerNotes ? [{ label: "Suas observações", value: legalCase.partnerNotes, wide: true }] : []),
            ]}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}

function Documents({ legalCase }: { legalCase: LegalCase }) {
  const documents = useCurrentDocuments({ legalCaseId: legalCase.id });
  const [sending, setSending] = useState<{ replaces?: ClientDocument } | null>(null);
  const [viewing, setViewing] = useState<ClientDocument | null>(null);
  const mine = documents.filter((d) => d.uploadedByPartnerOfficeId);
  const approved = documents.filter((d) => !d.uploadedByPartnerOfficeId);
  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader title="Documentos do escritório" description="Documentos aprovados disponibilizados pela Bárbara Cardoso Advocacia." />
        {approved.length === 0 ? (
          <EmptyState compact title="Nenhum documento disponível ainda." />
        ) : (
          <ul className="divide-y divide-line">
            {approved.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-foreground">{d.name}</p>
                  <p className="text-[12px] text-muted">{d.approvedContent ? `Aprovado em ${formatDate(d.approvedContent.approvedAt)}` : formatDate(d.updatedAt)}</p>
                </div>
                <Badge tone="success">Documento aprovado</Badge>
                <Button size="sm" variant="secondary" onClick={() => setViewing(d)}>
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
          description="Documentos enviados não podem ser editados nem apagados. Para corrigir, envie uma nova versão."
          actions={
            legalCase.status !== "REJECTED" && legalCase.status !== "ARCHIVED" ? (
              <Can permission="partnerPortal.documents.submit">
                <Button size="sm" icon={<FilePlus2 className="size-3.5" aria-hidden />} onClick={() => setSending({})}>
                  Enviar documento
                </Button>
              </Can>
            ) : undefined
          }
        />
        {mine.length === 0 ? (
          <EmptyState compact title="Nenhum documento enviado neste caso." />
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
                  <Td className="text-right">
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
      {sending && <SendDocumentDialog clientId={legalCase.clientId} legalCaseId={legalCase.id} replaces={sending.replaces} open onOpenChange={(o) => !o && setSending(null)} />}
      {viewing && <ApprovedDocumentDialog doc={viewing} open onOpenChange={(o) => !o && setViewing(null)} />}
    </div>
  );
}

function Requests({ legalCaseId }: { legalCaseId: ID }) {
  const all = usePortalRequests();
  const requests = useMemo(() => all.filter((r) => r.legalCaseId === legalCaseId), [all, legalCaseId]);
  const clientMap = usePortalClientMap();
  const processes = usePortalProcesses();
  const processMap = useMemo(() => new Map(processes.map((p) => [p.id, p])), [processes]);
  const [respond, setRespond] = useState<ID | null>(null);
  const [send, setSend] = useState<ID | null>(null);
  const responding = requests.find((r) => r.id === respond);
  const sendingFor = requests.find((r) => r.id === send);
  return (
    <Panel>
      <PanelHeader title="Pendências deste caso" />
      <PartnerRequestList
        requests={requests}
        clientMap={clientMap}
        processMap={processMap}
        emptyText="Nenhuma pendência neste caso."
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
      {sendingFor && sendingFor.clientId && (
        <SendDocumentDialog clientId={sendingFor.clientId} legalCaseId={legalCaseId} request={sendingFor} open onOpenChange={(o) => !o && setSend(null)} />
      )}
    </Panel>
  );
}

function Processes({ legalCase }: { legalCase: LegalCase }) {
  const processes = useCaseProcesses(legalCase.id);
  const canAdd = legalCase.status !== "REJECTED" && legalCase.status !== "ARCHIVED";
  const cta = canAdd ? (
    <Can permission="partnerPortal.processes.create">
      <ButtonLink href={`/processos/novo?caso=${legalCase.id}`} variant="secondary" size="sm" icon={<FolderPlus className="size-4" aria-hidden />}>
        Cadastrar processo
      </ButtonLink>
    </Can>
  ) : undefined;
  return (
    <Panel>
      <PanelHeader title="Processos do caso" actions={processes.length > 0 ? cta : undefined} />
      {processes.length === 0 ? (
        <EmptyState compact icon={FolderPlus} title="Este caso ainda não possui processo judicial vinculado." action={cta} />
      ) : (
        <Table caption="Processos do caso">
          <THead>
            <tr>
              <Th>Processo</Th>
              <Th>Status</Th>
              <Th>Atualização</Th>
            </tr>
          </THead>
          <TBody>
            {processes.map((p) => (
              <Tr key={p.id}>
                <Td>
                  <Link href={`/processos/${p.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                    {p.title}
                  </Link>
                  <div className="font-mono text-[11.5px] text-muted">{p.cnj ?? "Sem número CNJ"}</div>
                </Td>
                <Td>
                  <StatusBadge status={p.status} labels={PROCESS_STATUS_LABEL} tones={PROCESS_STATUS_TONE} />
                </Td>
                <Td className="text-[12px] text-muted">{formatEventTime(p.lastMovementAt ?? p.updatedAt)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}

function Finance({ legalCaseId }: { legalCaseId: ID }) {
  const agreement = useCasePartnership(legalCaseId);
  const processes = useCaseProcesses(legalCaseId);
  const caseValue = processes.reduce((sum, p) => sum + (p.caseValue ?? 0), 0) || undefined;
  return <PartnerFinancePanel caseValue={caseValue} agreementStatus={agreement} />;
}

function HistoryTab({ legalCaseId }: { legalCaseId: ID }) {
  const events = useCaseActivity(legalCaseId);
  return (
    <Panel className="max-w-[880px]">
      <PanelHeader title="Histórico" />
      <PanelBody>
        {events.length === 0 ? (
          <EmptyState compact title="Nenhum registro ainda." />
        ) : (
          <Timeline items={events.map((e) => ({ id: e.id, title: e.description, meta: formatDateTime(e.at), description: e.actor.name }))} />
        )}
      </PanelBody>
    </Panel>
  );
}
