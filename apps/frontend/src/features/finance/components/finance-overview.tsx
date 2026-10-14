"use client";

import { Settings2 } from "lucide-react";
import type { ActionResult } from "@/lib/actions/result";
import { PageContainer } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout } from "@/components/feedback/states";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import type { Page } from "@/server/core/pagination";
import type { AgreementListItemDTO, FinanceSummaryDTO } from "@/server/domain/finance/dto";
import type { AgreementListQuery } from "../list-query";
import { AgreementsPanel } from "./agreements-table";
import { MonthlyReceiptsChart } from "./finance-charts";
import { FinanceStats } from "./finance-stats";

/** Financeiro jurídico (ADMIN): honorários ligados aos casos. Totais e lista do servidor. Não é um ERP. */
export function FinanceOverview({
  summary,
  initialQuery,
  initialResult,
}: {
  summary: ActionResult<FinanceSummaryDTO>;
  initialQuery: AgreementListQuery;
  initialResult: ActionResult<Page<AgreementListItemDTO>>;
}) {
  return (
    <PageContainer>
      <PageHeader
        title="Financeiro"
        description="Honorários contratados, recebimentos e valores em aberto por caso."
        actions={
          <ButtonLink href="/configuracoes?secao=honorarios" variant="secondary" icon={<Settings2 className="size-4" aria-hidden />}>
            Modelos de honorários
          </ButtonLink>
        }
      />
      <div className="space-y-5">
        {!summary.ok ? (
          <ActionErrorState error={summary} title="Não foi possível carregar os totais." />
        ) : (
          <>
            {summary.data.truncated && (
              <Callout tone="warning" title="Totais parciais">
                O volume passou do limite de leitura da visão geral. Os contratos abaixo continuam completos.
              </Callout>
            )}
            <FinanceStats summary={summary.data} />
            <MonthlyReceiptsChart data={summary.data.monthly} />
          </>
        )}
        <AgreementsPanel initialQuery={initialQuery} initialResult={initialResult} syncUrl />
        <p className="text-[12px] text-subtle">Valores em reais. Êxito depende do resultado do processo e não representa receita garantida.</p>
      </div>
    </PageContainer>
  );
}
