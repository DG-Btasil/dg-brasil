"use client";

import { Briefcase, CalendarClock, ClipboardCheck, FileClock, FileSearch, History } from "lucide-react";
import { Stat } from "@/components/ui/display";
import { pluralize } from "@/lib/formatting";
import { useCan } from "@/features/auth/hooks";
import { useHomeKpis } from "../hooks";

/**
 * Linha de indicadores. O conteúdo varia por PERMISSÃO:
 * quem não tem "reviews.view" vê indicadores operacionais no lugar.
 */
export function HomeKpis() {
  const k = useHomeKpis();
  const can = useCan();
  const canReviews = can("reviews.view");
  const canAnalyses = can("analyses.start");

  return (
    <section aria-label="Indicadores do escritório" data-tour="home-kpis" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <Stat
        label="Processos ativos"
        value={k.activeProcesses}
        icon={Briefcase}
        href="/processos"
        hint="Todos os status, exceto encerrados"
      />
      {canAnalyses ? (
        <Stat
          label="Análises em andamento"
          value={k.analysesInProgress}
          icon={FileSearch}
          href="/clientes"
          hint={k.analysesWaitingDocs > 0 ? `${pluralize(k.analysesWaitingDocs, "aguarda", "aguardam")} documentos` : "Nenhuma bloqueada por documentos"}
        />
      ) : (
        <Stat
          label="Clientes aguardando documentos"
          value={k.clientsWaitingDocs}
          icon={FileClock}
          tone={k.clientsWaitingDocs > 0 ? "warning" : "neutral"}
          href="/clientes"
          hint="Pendências de documentação"
        />
      )}
      <Stat
        label="Prazos nos próximos 7 dias"
        value={k.upcomingDeadlines}
        icon={CalendarClock}
        tone={k.overdueDeadlines > 0 ? "danger" : "neutral"}
        href="/processos"
        hint={k.overdueDeadlines > 0 ? `Atenção: ${pluralize(k.overdueDeadlines, "prazo vencido", "prazos vencidos")}` : "Somente prazos em aberto"}
      />
      {canReviews ? (
        <Stat
          label="Revisões pendentes"
          value={k.pendingReviews}
          icon={ClipboardCheck}
          tone={k.urgentReviews > 0 ? "danger" : "neutral"}
          href="/revisoes"
          hint={k.urgentReviews > 0 ? `${pluralize(k.urgentReviews, "urgente", "urgentes")}` : "Nenhuma marcada como urgente"}
        />
      ) : (
        <Stat
          label="Processos com atualização recente"
          value={k.recentlyUpdatedProcesses}
          icon={History}
          href="/processos"
          hint="Movimentados nos últimos 7 dias"
        />
      )}
    </section>
  );
}
