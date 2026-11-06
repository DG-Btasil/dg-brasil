"use client";

import type { ActionResult } from "@/lib/actions/result";
import { PageContainer } from "@/components/layout/guards";
import { PageHeader } from "@/components/ui/display";
import type { Page } from "@/server/core/pagination";
import type { PartnerAgreementShareDTO, PartnerFinanceDTO, TransferListItemDTO } from "@/server/domain/finance/dto";
import { PartnerShareView } from "@/features/finance/components/partner-share";
import { MetricsBoard } from "@/features/metrics/components/metrics-board";
import type { DashboardMetricsDTO } from "@/server/domain/metrics/dto";

/**
 * Financeiro do parceiro (somente PARTNER_ADMIN): participação do PRÓPRIO
 * escritório, lida do servidor com o escritório da sessão. Não mostra
 * financeiro global, receita do escritório nem outros parceiros — esses dados
 * nem chegam ao portal (DTO do parceiro).
 */
export function PortalFinance({
  summary,
  shares,
  transfers,
  metrics,
}: {
  summary: ActionResult<PartnerFinanceDTO>;
  shares: ActionResult<Page<PartnerAgreementShareDTO>>;
  transfers: ActionResult<Page<TransferListItemDTO>>;
  /** Participação por período (Roadmap 2.0): barras horizontais com filtro. */
  metrics?: ActionResult<DashboardMetricsDTO>;
}) {
  return (
    <PageContainer>
      <PageHeader title="Financeiro" description="Sua participação nos honorários dos casos enviados à Bárbara Cardoso Advocacia." />
      {metrics && <MetricsBoard variant="portal-finance" initial={metrics} initialPeriod="365" title="Participação no período" />}
      <PartnerShareView summary={summary} shares={shares} transfers={transfers} />
    </PageContainer>
  );
}
