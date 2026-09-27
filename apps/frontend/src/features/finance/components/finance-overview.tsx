"use client";

import { useMemo } from "react";
import { Plus, Settings2 } from "lucide-react";
import { PageContainer } from "@/components/layout/guards";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { todayISO } from "@/lib/clock";
import { useAgreementRows, useFeeModels } from "../hooks";
import { compositionByFeeModel, monthlyReceipts } from "../utils";
import { AgreementsTable } from "./agreements-table";
import { CompositionChart, MonthlyReceiptsChart } from "./finance-charts";
import { FinanceStats, computeTotals } from "./finance-stats";

/** Financeiro jurídico: honorários ligados a clientes e processos. Não é um ERP. */
export function FinanceOverview() {
  const rows = useAgreementRows();
  const feeModels = useFeeModels();

  const { totals, monthly, composition } = useMemo(() => {
    const today = todayISO();
    const active = rows.filter((r) => r.agreement.status !== "CANCELLED");
    return {
      totals: computeTotals(rows, today),
      monthly: monthlyReceipts(active.flatMap((r) => r.payments), today),
      composition: compositionByFeeModel(rows),
    };
  }, [rows]);

  return (
    <PageContainer>
      <PageHeader
        title="Financeiro"
        description="Honorários contratados, recebimentos e valores em aberto por cliente e processo."
        actions={
          <>
            <ButtonLink href="/configuracoes?secao=honorarios" variant="secondary" icon={<Settings2 className="size-4" aria-hidden />}>
              Modelos de honorários
            </ButtonLink>
            <ButtonLink href="/financeiro/contratos/novo" icon={<Plus className="size-4" aria-hidden />}>
              Novo contrato de honorários
            </ButtonLink>
          </>
        }
      />
      <div className="space-y-5">
        <FinanceStats totals={totals} />
        {rows.length > 0 && (
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-5">
            <MonthlyReceiptsChart data={monthly} />
            <CompositionChart data={composition} />
          </div>
        )}
        <AgreementsTable rows={rows} feeModels={feeModels} />
        <p className="text-[12px] text-subtle">
          Valores de êxito são estimativas calculadas sobre o valor da causa e o percentual contratado; não representam receita garantida.
        </p>
      </div>
    </PageContainer>
  );
}
