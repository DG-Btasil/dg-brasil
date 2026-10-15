"use client";

import Link from "next/link";
import { useMemo } from "react";
import { FolderOpen, FolderPlus, Plus } from "lucide-react";
import { LEGAL_CASE_STATUS_TONE, PARTNER_CASE_STATUS_LABEL } from "@/lib/constants/status";
import { formatDateTime, formatEventTime } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import { Can, PageContainer } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import type { Page } from "@/server/core/pagination";
import { listCasesAction } from "@/server/domain/cases/actions";
import type { CaseListItem, CasePartnerDTO } from "@/server/domain/cases/dto";
import type { DocumentListItem } from "@/server/domain/documents/dto";
import type { RequirementDTO } from "@/server/domain/documents/requirements/dto";
import type { PartnerRequestListItem } from "@/server/domain/partner-requests/dto";
import type { ProcessListItem } from "@/server/domain/processes/dto";
import { useOrganizationNames, useOrgDirectory } from "@/features/directory/directory-context";
import { PortalCaseHistory } from "./portal-case-history";
import { CaseListTable } from "@/features/cases/components/case-list-table";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import { RequirementsPanel } from "@/features/documents/components/requirements-panel";
import { RequestsPanel } from "@/features/partner-requests/components/requests-panel";
import { ProcessListTable } from "@/features/processes/components/process-list-table";
import { PARTNER_STATUS_GROUPS, portalCaseInput, type PortalListQuery } from "../list-query";
import { PortalServerList } from "./portal-list";

const STATUS_OPTIONS = PARTNER_STATUS_GROUPS.map((g) => ({ value: g.label, label: g.label }));
/** Caso recusado ou arquivado não recebe mais envio de arquivo nem processo. */
const CLOSED_FOR_SUBMISSION = new Set(["REJECTED", "ARCHIVED"]);

/** Casos do escritório parceiro (RLS: só os casos do próprio escritório). */
export function PortalCaseList({ initialQuery, initialResult }: { initialQuery: PortalListQuery; initialResult: ActionResult<Page<CaseListItem>> }) {
  const names = useOrganizationNames();
  const { owner } = useOrgDirectory();
  const cta = (
    <Can permission="partnerPortal.cases.create">
      <ButtonLink href="/casos/novo" icon={<Plus className="size-4" aria-hidden />}>
        Novo caso
      </ButtonLink>
    </Can>
  );
  return (
    <PortalServerList
      title="Casos"
      description="Casos do seu escritório enviados à Bárbara Cardoso Advocacia."
      cta={cta}
      initialQuery={initialQuery}
      initialResult={initialResult}
      load={(q) => listCasesAction(portalCaseInput(q))}
      noun={{ one: "caso", many: "casos" }}
      searchLabel="Buscar por caso ou parte contrária"
      statusOptions={STATUS_OPTIONS}
      empty={{ icon: FolderOpen, title: "Nenhum caso ainda.", description: "Envie um caso para a Bárbara Cardoso Advocacia analisar." }}
      errorTitle="Não foi possível carregar os casos."
    >
      {(rows) => (
        <CaseListTable rows={rows} showLawyer={false} statusLabels={PARTNER_CASE_STATUS_LABEL} lawyerName={() => undefined} originName={(id) => names.get(id)} ownerId={owner.id} />
      )}
    </PortalServerList>
  );
}

/* ------------------------------------------------------------------ */

const TAB_KEYS = ["visao-geral", "documentos", "pendencias", "processos", "historico"] as const;
type TabKey = (typeof TAB_KEYS)[number];

/**
 * Caso no portal (CasePartnerDTO): nenhum conteúdo interno chega aqui (nota
 * interna, motivo interno de rejeição, advogado, análise, revisões). A aba
 * Histórico (4.3.1) lê eventos montados pelo servidor, nunca a auditoria.
 */
export function PortalCaseDetail({
  legalCase,
  processes,
  documents,
  requirements,
  requests,
}: {
  legalCase: CasePartnerDTO;
  processes: ActionResult<Page<ProcessListItem>>;
  documents: ActionResult<Page<DocumentListItem>>;
  requirements: ActionResult<Page<RequirementDTO>>;
  requests: ActionResult<Page<PartnerRequestListItem>>;
}) {
  const [tab, setTab] = useUrlTab<TabKey>(TAB_KEYS, "visao-geral");
  const names = useOrganizationNames();
  const open = requests.ok ? requests.data.items.filter((r) => r.status === "OPEN").length : 0;
  const tabs = useMemo<TabItem<TabKey>[]>(
    () => [
      { key: "visao-geral", label: "Visão geral" },
      { key: "documentos", label: "Documentos" },
      { key: "pendencias", label: "Pendências", count: open, attention: open > 0 },
      { key: "processos", label: "Processos", count: processes.ok ? processes.data.total : undefined },
      { key: "historico", label: "Histórico" },
    ],
    [open, processes],
  );
  const closed = CLOSED_FOR_SUBMISSION.has(legalCase.status);

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Casos", href: "/casos" }, { label: legalCase.title }]}
        title={legalCase.title}
        meta={
          <>
            {legalCase.clientName && (
              <Link href={`/clientes/${legalCase.clientId}`} className="font-medium text-navy hover:underline underline-offset-2">
                {legalCase.clientName}
              </Link>
            )}
            <StatusBadge status={legalCase.status} labels={PARTNER_CASE_STATUS_LABEL} tones={LEGAL_CASE_STATUS_TONE} />
            <span>Atualizado {formatEventTime(legalCase.updatedAt)}</span>
          </>
        }
      />
      <Tabs items={tabs} value={tab} onChange={setTab} label="Seções do caso" className="mb-5" />
      <TabPanel tabKey={tab}>
        {tab === "visao-geral" && (
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
                    { label: "Área", value: legalCase.areaName },
                    { label: "Tipo", value: legalCase.caseType || undefined },
                    { label: "Parte contrária", value: legalCase.opposingParty },
                    { label: "Origem do caso", value: names.get(legalCase.originOrganizationId) },
                    { label: "Enviado em", value: legalCase.submittedAt ? formatDateTime(legalCase.submittedAt) : undefined },
                    { label: "Aceito em", value: legalCase.acceptedAt ? formatDateTime(legalCase.acceptedAt) : undefined },
                    { label: "Relato", value: legalCase.summary || undefined, wide: true },
                    ...(legalCase.partnerNotes ? [{ label: "Suas observações", value: legalCase.partnerNotes, wide: true }] : []),
                  ]}
                />
              </PanelBody>
            </Panel>
          </div>
        )}
        {tab === "documentos" && (
          <div className="space-y-5">
            <DocumentsPanel
              scope={{ legalCaseId: legalCase.id }}
              initial={documents}
              readOnly={closed}
              title="Documentos do caso"
              description="Documentos enviados não podem ser editados nem apagados. Para corrigir, envie uma nova versão."
            />
            <RequirementsPanel legalCaseId={legalCase.id} requirements={requirements} documents={documents} />
          </div>
        )}
        {tab === "pendencias" && (
          <RequestsPanel scope={{ legalCaseId: legalCase.id }} initial={requests} title="Pendências deste caso" description="Solicitações da Bárbara Cardoso Advocacia. Responda enquanto estiverem abertas." showCase={false} />
        )}
        {tab === "processos" && <CaseProcesses legalCase={legalCase} processes={processes} closed={closed} />}
        {tab === "historico" && <PortalCaseHistory legalCaseId={legalCase.id} />}
      </TabPanel>
    </PageContainer>
  );
}

function CaseProcesses({ legalCase, processes, closed }: { legalCase: CasePartnerDTO; processes: ActionResult<Page<ProcessListItem>>; closed: boolean }) {
  const cta = closed ? undefined : (
    <Can permission="partnerPortal.processes.create">
      <ButtonLink href={`/processos/novo?caso=${legalCase.id}`} variant="secondary" size="sm" icon={<FolderPlus className="size-4" aria-hidden />}>
        Cadastrar processo
      </ButtonLink>
    </Can>
  );
  if (!processes.ok) return <ActionErrorState error={processes} title="Não foi possível carregar os processos." />;
  return (
    <Panel>
      <PanelHeader title="Processos do caso" actions={processes.data.items.length > 0 ? cta : undefined} />
      {processes.data.items.length === 0 ? (
        <EmptyState compact icon={FolderPlus} title="Este caso ainda não possui processo judicial vinculado." action={cta} />
      ) : (
        <ProcessListTable rows={processes.data.items} showClient={false} />
      )}
    </Panel>
  );
}
