"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarPlus, NotebookPen } from "lucide-react";
import { PROCESS_PHASE_LABEL, PROCESS_STATUS_LABEL, PROCESS_STATUS_TONE } from "@/lib/constants/status";
import { deadlineUrgency } from "@/lib/formatting";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import type { ActionResult } from "@/lib/actions/result";
import { Can, PageContainer } from "@/components/layout/guards";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import type { Page } from "@/server/core/pagination";
import type { DeadlineDTO } from "@/server/domain/processes/deadlines/dto";
import type { DocumentListItem } from "@/server/domain/documents/dto";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { AgreementsPanel } from "@/features/finance/components/agreements-table";
import { DEFAULT_AGREEMENT_QUERY } from "@/features/finance/list-query";
import { ReviewTable } from "@/features/reviews/components/review-table";
import type { AgreementListItemDTO } from "@/server/domain/finance/dto";
import type { ReviewListItem } from "@/server/domain/reviews/dto";
import type { ProcessEventDTO, ProcessInternalDTO, ProcessPartyDTO } from "@/server/domain/processes/dto";
import { useCan } from "@/features/auth/hooks";
import { CaseOriginLabel } from "@/features/cases/components/case-detail";
import { useDirectoryUser } from "@/features/directory/directory-context";
import { AddDeadlineDialog } from "./add-deadline-dialog";
import { AddEventDialog } from "./add-event-dialog";
import { CnjText } from "./cnj-text";
import { DeleteProcessDialog, ProcessActionsMenu } from "./process-danger-actions";
import { ProcessOriginBadge } from "./process-origin-badge";
import { DeadlinesTab } from "./tabs/deadlines-tab";
import { EventsTab } from "./tabs/events-tab";
import { OverviewTab } from "./tabs/overview-tab";

const TAB_KEYS = ["visao-geral", "movimentacoes", "documentos", "prazos", "revisoes", "financeiro"] as const;
type TabKey = (typeof TAB_KEYS)[number];
type DialogState = { kind: "event" } | { kind: "deadline"; deadline?: DeadlineDTO } | { kind: "delete" } | null;

/**
 * Página do processo (equipe interna), com dados do servidor: ficha,
 * partes, movimentações e prazos. Documentos, revisões e financeiro entram
 * nas próximas fases. Precisa estar dentro de <Suspense> (useUrlTab).
 */
export function ProcessDetail({
  process,
  parties,
  events,
  deadlines,
  documents,
  reviews,
  agreements,
}: {
  process: ProcessInternalDTO;
  parties: ActionResult<Page<ProcessPartyDTO>>;
  events: ActionResult<Page<ProcessEventDTO>>;
  deadlines: ActionResult<Page<DeadlineDTO>>;
  documents: ActionResult<Page<DocumentListItem>>;
  /** Só ADMIN/LAWYER (reviews.view). */
  reviews?: ActionResult<Page<ReviewListItem>>;
  /** Só ADMIN (finance.view): contratos do CASO do processo. */
  agreements?: ActionResult<Page<AgreementListItemDTO>>;
}) {
  const responsible = useDirectoryUser(process.responsibleUserId);
  const can = useCan();
  const [tab, setTab] = useUrlTab<TabKey>(TAB_KEYS, "visao-geral");
  const [dialog, setDialog] = useState<DialogState>(null);

  const openDeadlines = useMemo(() => (deadlines.ok ? deadlines.data.items.filter((d) => d.status === "OPEN") : []), [deadlines]);
  const urgent = openDeadlines.some((d) => d.effectiveStatus === "OVERDUE" || ["TODAY", "TOMORROW"].includes(deadlineUrgency(d.dueDateLocal)));
  const lastMovementAt = events.ok ? events.data.items[0]?.occurredAt : undefined;

  const tabs = useMemo(() => {
    const items: TabItem<TabKey>[] = [
      { key: "visao-geral", label: "Visão geral" },
      { key: "movimentacoes", label: "Movimentações", count: events.ok ? events.data.total : undefined },
      { key: "documentos", label: "Documentos", count: documents.ok ? documents.data.total : undefined },
      { key: "prazos", label: "Prazos", count: openDeadlines.length, attention: urgent },
    ];
    if (can("reviews.view")) items.push({ key: "revisoes", label: "Revisões" });
    if (can("finance.view")) items.push({ key: "financeiro", label: "Financeiro" });
    return items;
  }, [can, events, openDeadlines.length, urgent, documents]);

  // Aba sem permissão na URL cai na visão geral.
  const active: TabKey = tabs.some((t) => t.key === tab) ? tab : "visao-geral";
  const close = () => setDialog(null);

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Processos", href: "/processos" }, { label: process.title }]}
        eyebrow={<CnjText cnj={process.cnj} className="normal-case tracking-normal text-[12px]" />}
        title={process.title}
        meta={
          <>
            {process.clientName ? (
              <Link href={`/clientes/${process.clientId}`} className="font-medium text-navy hover:underline underline-offset-2">
                {process.clientName}
              </Link>
            ) : (
              <span className="text-muted">Cliente não disponível</span>
            )}
            <StatusBadge status={process.status} labels={PROCESS_STATUS_LABEL} tones={PROCESS_STATUS_TONE} />
            {process.phase && <span>Fase {PROCESS_PHASE_LABEL[process.phase].toLowerCase()}</span>}
            <span>Responsável: {responsible?.name ?? "—"}</span>
            <span>
              Caso:{" "}
              <Link href={`/casos/${process.legalCaseId}`} className="font-medium text-navy hover:underline underline-offset-2">
                {process.caseTitle || "Abrir caso"}
              </Link>
            </span>
            {process.caseOriginOrganizationId && <CaseOriginLabel originOrganizationId={process.caseOriginOrganizationId} />}
            <span className="inline-flex items-center gap-1.5">
              Cadastro: <ProcessOriginBadge origin={process.origin} />
            </span>
          </>
        }
        actions={
          <Can permission="processes.edit">
            <Button variant="secondary" icon={<NotebookPen className="size-4" aria-hidden />} onClick={() => setDialog({ kind: "event" })}>
              Registrar andamento
            </Button>
            <Button icon={<CalendarPlus className="size-4" aria-hidden />} onClick={() => setDialog({ kind: "deadline" })}>
              Adicionar prazo
            </Button>
            <ProcessActionsMenu processId={process.id} onDelete={() => setDialog({ kind: "delete" })} />
          </Can>
        }
      />

      <Tabs items={tabs} value={active} onChange={setTab} label="Seções do processo" className="mb-5" />

      <TabPanel tabKey={active}>
        {active === "visao-geral" && <OverviewTab process={process} parties={parties} responsibleName={responsible?.name} lastMovementAt={lastMovementAt} />}
        {active === "movimentacoes" && <EventsTab processId={process.id} initial={events} onAdd={() => setDialog({ kind: "event" })} />}
        {active === "documentos" && (
          <DocumentsPanel
            scope={{ legalProcessId: process.id }}
            initial={documents}
            title="Documentos do processo"
            description="Peças, decisões e arquivos ligados a este processo (também aparecem no caso)."
            allowSharing={!!process.casePartnerOrganizationId}
          />
        )}
        {active === "prazos" && <DeadlinesTab deadlines={deadlines} onAdd={() => setDialog({ kind: "deadline" })} onEdit={(deadline) => setDialog({ kind: "deadline", deadline })} />}
        {active === "revisoes" && reviews && (
          <Panel>
            <PanelHeader title="Revisões do processo" description="Material dos agentes e documentos deste processo aguardando ou com decisão humana." />
            {!reviews.ok ? (
              <ActionErrorState error={reviews} title="Não foi possível carregar as revisões." />
            ) : reviews.data.items.length === 0 ? (
              <EmptyState compact title="Nenhuma revisão neste processo." />
            ) : (
              <ReviewTable rows={reviews.data.items} />
            )}
          </Panel>
        )}
        {active === "financeiro" && agreements && (
          <AgreementsPanel
            legalCaseId={process.legalCaseId}
            initialQuery={DEFAULT_AGREEMENT_QUERY}
            initialResult={agreements}
            title="Contratos de honorários do caso"
            description="O financeiro pertence ao caso: estes contratos abrangem todos os processos dele."
          />
        )}
      </TabPanel>

      {dialog?.kind === "delete" && <DeleteProcessDialog process={process} openDeadlines={openDeadlines.length} onClose={close} />}
      <AddEventDialog open={dialog?.kind === "event"} onOpenChange={(o) => (o ? setDialog({ kind: "event" }) : close())} processId={process.id} />
      {dialog?.kind === "deadline" && (
        <AddDeadlineDialog
          key={dialog.deadline?.id ?? "new"}
          open
          onOpenChange={(o) => !o && close()}
          processId={process.id}
          legalCaseId={process.legalCaseId}
          defaultResponsibleId={process.responsibleUserId}
          deadline={dialog.deadline}
        />
      )}
    </PageContainer>
  );
}
