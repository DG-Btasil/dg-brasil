"use client";

import { AlarmClock, Briefcase, ClipboardCheck, FolderOpen, Hourglass, History } from "lucide-react";
import { Stat } from "@/components/ui/display";
import { pluralize } from "@/lib/formatting";
import { useCan } from "@/features/auth/hooks";
import { useHomeKpis } from "../hooks";

/**
 * Linha de indicadores: casos, processos, revisões e prazos. O conteúdo varia
 * por PERMISSÃO: quem não tem "reviews.view" vê um indicador operacional no lugar.
 */
export function HomeKpis() {
  const k = useHomeKpis();
  const can = useCan();
  const canReviews = can("reviews.view");

  return (
    <section aria-label="Indicadores do escritório" data-tour="home-kpis" className="grid grid-cols-2 gap-4 xl:grid-cols-5">
      <Stat label="Casos ativos" value={k.activeCases} icon={FolderOpen} href="/casos" hint="Em análise, aceitos e em andamento" />
      <Stat
        label="Casos aguardando análise"
        value={k.casesAwaitingAnalysis}
        icon={Hourglass}
        tone={k.casesWithoutLawyer > 0 ? "warning" : "neutral"}
        href="/casos"
        hint={k.casesWithoutLawyer > 0 ? `${pluralize(k.casesWithoutLawyer, "sem advogado responsável", "sem advogado responsável")}` : "Aguardando decisão da equipe"}
      />
      <Stat label="Processos ativos" value={k.activeProcesses} icon={Briefcase} href="/processos" hint="Todos os status, exceto encerrados" />
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
        <Stat label="Processos com atualização recente" value={k.recentlyUpdatedProcesses} icon={History} href="/processos" hint="Movimentados nos últimos 7 dias" />
      )}
      <Stat
        label="Prazos urgentes"
        value={k.urgentDeadlines}
        icon={AlarmClock}
        tone={k.overdueDeadlines > 0 ? "danger" : k.urgentDeadlines > 0 ? "warning" : "neutral"}
        href="/processos"
        hint={k.overdueDeadlines > 0 ? `Atenção: ${pluralize(k.overdueDeadlines, "prazo vencido", "prazos vencidos")}` : "Vencidos ou em até 3 dias"}
      />
    </section>
  );
}
