import type { Metadata } from "next";
import { AccessDenied } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { DeadlineAgenda, type AgendaSummary } from "@/features/deadlines/components/deadline-agenda";
import { agendaQueryFromSearchParams, agendaQueryToInput, officeToday } from "@/features/deadlines/list-query";
import { listDeadlinesAction, listOverdueDeadlinesAction, listUpcomingDeadlinesAction } from "@/server/domain/processes/deadlines/actions";

export const metadata: Metadata = { title: "Prazos" };

/**
 * Agenda de prazos do escritório. Só a equipe interna (prazo não é dado do
 * parceiro), com a mesma permissão de ver processos. A primeira página e os
 * contadores vêm do servidor, já com os filtros da URL.
 */
async function InternalAgenda({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = agendaQueryFromSearchParams(searchParams);
  const today = officeToday();
  const [result, overdue, dueToday, next5Days, agentUnchecked] = await Promise.all([
    listDeadlinesAction(agendaQueryToInput(query, today)),
    listOverdueDeadlinesAction({ pageSize: 1 }),
    listDeadlinesAction({ effectiveStatus: "OPEN", fromDate: today, untilDate: today, pageSize: 1 }),
    listUpcomingDeadlinesAction({ days: 5, pageSize: 1 }),
    listDeadlinesAction({ status: "OPEN", agentUnchecked: true, pageSize: 1 }),
  ]);
  const summary: AgendaSummary = {
    overdue: overdue.ok ? overdue.data.total : undefined,
    today: dueToday.ok ? dueToday.data.total : undefined,
    next5Days: next5Days.ok ? next5Days.data.total : undefined,
    agentUnchecked: agentUnchecked.ok ? agentUnchecked.data.total : undefined,
  };
  // Exportação da lista: quando a infraestrutura existir, o botão entra em `headerActions` (cabeçalho da página).
  return <DeadlineAgenda initialQuery={query} initialResult={result} summary={summary} />;
}

export default async function PrazosPage({ searchParams }: PageProps<"/prazos">) {
  const params = await searchParams;
  return (
    <AudienceSwitch
      partner={<AccessDenied />}
      owner={
        <RequirePermission permission="processes.view">
          <InternalAgenda searchParams={params} />
        </RequirePermission>
      }
    />
  );
}
