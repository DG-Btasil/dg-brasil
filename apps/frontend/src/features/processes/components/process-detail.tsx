"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarPlus, FileSearch, Link2, NotebookPen, ShieldAlert } from "lucide-react";
import { OPEN_REVIEW_STATUSES, PROCESS_PHASE_LABEL, PROCESS_STATUS_LABEL, PROCESS_STATUS_TONE } from "@/lib/constants/status";
import { daysUntil } from "@/lib/clock";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import { Can, PageContainer, RequirePermission } from "@/components/layout/guards";
import { StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Panel } from "@/components/ui/panel";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { Callout, EmptyState } from "@/components/feedback/states";
import { useCan } from "@/features/auth/hooks";
import { useUser } from "@/features/offices/hooks";
import { CaseFinancePanel } from "@/features/finance/components/case-finance-panel";
import { useLegalCase } from "@/features/cases/hooks";
import { CaseOriginTag } from "@/features/partners/components/case-partner-panel";
import { useClientById, useProcess, useProcessDeadlines, useProcessReviews } from "../hooks";
import { hasPendingClientLink, processClientLabel } from "../utils";
import { AddDeadlineDialog } from "./add-deadline-dialog";
import { AddEventDialog } from "./add-event-dialog";
import { CnjText } from "./cnj-text";
import { DeleteProcessDialog, LinkClientDialog, ProcessActionsMenu } from "./process-danger-actions";
import { ProcessOriginBadge } from "./process-origin-badge";
import { DeadlinesTab } from "./tabs/deadlines-tab";
import { DocumentsTab } from "./tabs/documents-tab";
import { EventsTab } from "./tabs/events-tab";
import { OverviewTab } from "./tabs/overview-tab";
import { ReviewsTab } from "./tabs/reviews-tab";

const TAB_KEYS = ["visao-geral", "movimentacoes", "documentos", "prazos", "revisoes", "financeiro"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export function ProcessDetail({ id }: { id: string }) {
  const process = useProcess(id);
  const client = useClientById(process?.clientId);
  const responsible = useUser(process?.responsibleUserId);
  const deadlines = useProcessDeadlines(id);
  const reviews = useProcessReviews(id);
  const can = useCan();
  const [tab, setTab] = useUrlTab<TabKey>(TAB_KEYS, "visao-geral");
  const [dialog, setDialog] = useState<"event" | "deadline" | "delete" | "link" | null>(null);

  const openDeadlines = deadlines.filter((d) => d.status === "OPEN");
  const urgent = openDeadlines.some((d) => daysUntil(d.dueDate) <= 1);
  const pendingReviews = reviews.filter((r) => OPEN_REVIEW_STATUSES.includes(r.status)).length;
  const legalCase = useLegalCase(process?.legalCaseId);

  const tabs = useMemo(() => {
    const items: TabItem<TabKey>[] = [
      { key: "visao-geral", label: "Visão geral" },
      { key: "movimentacoes", label: "Movimentações" },
      { key: "documentos", label: "Documentos" },
      { key: "prazos", label: "Prazos", count: openDeadlines.length, attention: urgent },
    ];
    if (can("reviews.view")) items.push({ key: "revisoes", label: "Revisões", count: reviews.length, attention: pendingReviews > 0 });
    if (can("finance.view")) items.push({ key: "financeiro", label: "Financeiro" });
    return items;
  }, [can, openDeadlines.length, urgent, reviews.length, pendingReviews]);

  if (!process) {
    return (
      <PageContainer>
        <Panel className="mt-6">
          <EmptyState
            icon={FileSearch}
            title="Processo não encontrado."
            description="O processo pode ter sido removido ou o endereço está incorreto."
            action={<ButtonLink href="/processos" variant="secondary">Voltar para Processos</ButtonLink>}
          />
        </Panel>
      </PageContainer>
    );
  }

  // Aba sem permissão na URL cai na visão geral.
  const active: TabKey = tabs.some((t) => t.key === tab) ? tab : "visao-geral";

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Processos", href: "/processos" }, { label: process.title }]}
        eyebrow={<CnjText cnj={process.cnj} className="normal-case tracking-normal text-[12px]" />}
        title={process.title}
        meta={
          <>
            {hasPendingClientLink(process) ? (
              <span className="inline-flex items-center gap-1 font-medium text-warning">
                <ShieldAlert className="size-3.5" aria-hidden />
                {processClientLabel(process, client)}
              </span>
            ) : (
              <Link href={`/clientes/${process.clientId}`} className="font-medium text-navy hover:underline underline-offset-2">
                {processClientLabel(process, client)}
              </Link>
            )}
            <StatusBadge status={process.status} labels={PROCESS_STATUS_LABEL} tones={PROCESS_STATUS_TONE} />
            <span>Fase {PROCESS_PHASE_LABEL[process.phase].toLowerCase()}</span>
            <span>Responsável: {responsible?.name ?? "—"}</span>
            {legalCase && (
              <span>
                Caso:{" "}
                <Link href={`/casos/${legalCase.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                  {legalCase.title}
                </Link>
              </span>
            )}
            {legalCase && <CaseOriginTag legalCase={legalCase} />}
            <span className="inline-flex items-center gap-1.5">
              Cadastro: <ProcessOriginBadge origin={process.origin} />
            </span>
          </>
        }
        actions={
          <Can permission="processes.edit">
            <Button variant="secondary" icon={<NotebookPen className="size-4" aria-hidden />} onClick={() => setDialog("event")}>
              Registrar andamento
            </Button>
            <Button icon={<CalendarPlus className="size-4" aria-hidden />} onClick={() => setDialog("deadline")}>
              Adicionar prazo
            </Button>
            <ProcessActionsMenu onDelete={() => setDialog("delete")} onLinkClient={() => setDialog("link")} />
          </Can>
        }
      />

      {hasPendingClientLink(process) && (
        <Callout
          tone="warning"
          className="mb-5"
          title="Cliente associado removido — revisão necessária"
          action={
            <Can permission="processes.edit">
              <Button size="sm" icon={<Link2 className="size-3.5" aria-hidden />} onClick={() => setDialog("link")}>
                Vincular cliente
              </Button>
            </Can>
          }
        >
          {process.removedClientName ? `O cliente ${process.removedClientName} foi excluído. ` : "Este processo está sem cliente associado. "}
          O processo foi mantido: vincule outro cliente ou resolva manualmente.
        </Callout>
      )}

      <Tabs items={tabs} value={active} onChange={setTab} label="Seções do processo" className="mb-5" />

      <TabPanel tabKey={active}>
        {active === "visao-geral" && <OverviewTab process={process} client={client} responsibleName={responsible?.name} />}
        {active === "movimentacoes" && <EventsTab processId={process.id} onAdd={() => setDialog("event")} />}
        {active === "documentos" && <DocumentsTab processId={process.id} clientId={process.clientId} />}
        {active === "prazos" && <DeadlinesTab deadlines={deadlines} onAdd={() => setDialog("deadline")} />}
        {active === "revisoes" && (
          <RequirePermission permission="reviews.view" fallback={null}>
            <ReviewsTab reviews={reviews} />
          </RequirePermission>
        )}
        {active === "financeiro" && (
          <RequirePermission permission="finance.view" fallback={null}>
            {/* O financeiro pertence ao caso e abrange todos os processos dele. */}
            <Callout tone="info" className="mb-5" title="Financeiro do caso">
              Contratos e parceria pertencem ao caso{legalCase ? ` “${legalCase.title}”` : ""} e abrangem todos os processos dele.
            </Callout>
            <CaseFinancePanel legalCaseId={process.legalCaseId} />
          </RequirePermission>
        )}
      </TabPanel>

      {dialog === "delete" && <DeleteProcessDialog process={process} clientName={processClientLabel(process, client)} onClose={() => setDialog(null)} />}
      {dialog === "link" && <LinkClientDialog process={process} onClose={() => setDialog(null)} />}
      <AddEventDialog open={dialog === "event"} onOpenChange={(o) => setDialog(o ? "event" : null)} processId={process.id} />
      <AddDeadlineDialog
        open={dialog === "deadline"}
        onOpenChange={(o) => setDialog(o ? "deadline" : null)}
        processId={process.id}
        defaultResponsibleId={process.responsibleUserId}
      />
    </PageContainer>
  );
}
