"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarPlus, FileSearch, NotebookPen } from "lucide-react";
import { PROCESS_PHASE_LABEL, PROCESS_STATUS_LABEL, PROCESS_STATUS_TONE } from "@/lib/constants/status";
import { daysUntil } from "@/lib/clock";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import { Can, PageContainer, RequirePermission } from "@/components/layout/guards";
import { StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Panel } from "@/components/ui/panel";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { EmptyState } from "@/components/feedback/states";
import { useCan } from "@/features/auth/hooks";
import { useUser } from "@/features/offices/hooks";
import { ProcessFinancePanel } from "@/features/finance/components/process-finance-panel";
import { useClientById, useProcess, useProcessDeadlines, useProcessReviews } from "../hooks";
import { clientDisplayName } from "../utils";
import { AddDeadlineDialog } from "./add-deadline-dialog";
import { AddEventDialog } from "./add-event-dialog";
import { CnjText } from "./cnj-text";
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
  const [dialog, setDialog] = useState<"event" | "deadline" | null>(null);

  const openDeadlines = deadlines.filter((d) => d.status === "OPEN");
  const urgent = openDeadlines.some((d) => daysUntil(d.dueDate) <= 1);
  const pendingReviews = reviews.filter((r) => r.status === "PENDING" || r.status === "URGENT").length;

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
            <Link href={`/clientes/${process.clientId}`} className="font-medium text-navy hover:underline underline-offset-2">
              {clientDisplayName(client)}
            </Link>
            <StatusBadge status={process.status} labels={PROCESS_STATUS_LABEL} tones={PROCESS_STATUS_TONE} />
            <span>Fase {PROCESS_PHASE_LABEL[process.phase].toLowerCase()}</span>
            <span>Responsável: {responsible?.name ?? "—"}</span>
            <ProcessOriginBadge origin={process.origin} />
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
          </Can>
        }
      />

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
            <ProcessFinancePanel processId={process.id} />
          </RequirePermission>
        )}
      </TabPanel>

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
