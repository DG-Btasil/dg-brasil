"use client";

import { useMemo, useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { Can, PageContainer } from "@/components/layout/guards";
import { Select } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ORIGIN_FILTER_LABEL, ORIGIN_FILTERS, type OriginFilter } from "@/lib/constants/status";
import { usePermission } from "@/features/auth/hooks";
import { useClientMap } from "@/features/processes/hooks";
import { PartnershipAgreementsTable } from "@/features/partners/components/agreements-table";
import { usePartnerMap, usePartnerOptions, usePartnershipViews, useProcessMap } from "@/features/partners/hooks";
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
  const allRows = useAgreementRows();
  const feeModels = useFeeModels();
  const canPartners = usePermission("partners.finance.view");
  const partnerOptions = usePartnerOptions();
  const partnerMap = usePartnerMap();
  const partnerNames = useMemo(() => new Map([...partnerMap].map(([id, p]) => [id, p.name])), [partnerMap]);
  const processMap = useProcessMap();
  const clientMap = useClientMap();
  const partnershipViews = usePartnershipViews();
  const [origin, setOrigin] = useState<OriginFilter>("ALL");
  const [partnerOfficeId, setPartnerOfficeId] = useState("");

  // Filtro de origem do CASO (o contrato segue o processo; contrato sem processo = próprio).
  const rows = useMemo(
    () =>
      allRows.filter((r) => {
        const p = r.process;
        const isPartner = p?.relationshipOrigin === "PARTNER";
        if (origin === "INTERNAL" && isPartner) return false;
        if (origin === "PARTNER" && !isPartner) return false;
        if (partnerOfficeId && p?.originPartnerOfficeId !== partnerOfficeId) return false;
        return true;
      }),
    [allRows, origin, partnerOfficeId],
  );
  const partnerships = useMemo(
    () => (origin === "INTERNAL" ? [] : partnershipViews.filter((v) => !partnerOfficeId || v.partnerOfficeId === partnerOfficeId)),
    [partnershipViews, origin, partnerOfficeId],
  );

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
        {canPartners && (
          <div className="flex items-center gap-2" role="search" aria-label="Filtrar por origem">
            <span className="text-[12.5px] text-muted">Origem</span>
            <div role="group" aria-label="Origem do caso" className="flex rounded-md border border-line bg-surface p-0.5">
              {ORIGIN_FILTERS.map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={origin === o}
                  onClick={() => {
                    setOrigin(o);
                    if (o === "INTERNAL") setPartnerOfficeId("");
                  }}
                  className={origin === o ? "rounded-sm bg-navy px-2.5 py-1 text-[12.5px] text-white" : "rounded-sm px-2.5 py-1 text-[12.5px] text-muted hover:text-foreground"}
                >
                  {ORIGIN_FILTER_LABEL[o]}
                </button>
              ))}
            </div>
            <Select
              aria-label="Escritório parceiro"
              placeholder="Todos os parceiros"
              options={partnerOptions}
              value={partnerOfficeId}
              onChange={(e) => {
                setPartnerOfficeId(e.target.value);
                if (e.target.value) setOrigin("PARTNER");
              }}
              className="h-8 w-[220px] text-[12.5px]"
            />
          </div>
        )}
        <FinanceStats totals={totals} />
        {rows.length > 0 && (
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-5">
            <MonthlyReceiptsChart data={monthly} />
            <CompositionChart data={composition} />
          </div>
        )}
        <AgreementsTable rows={rows} feeModels={feeModels} />
        <Can permission="partners.finance.view">
          {origin !== "INTERNAL" && (
            <Panel>
              <PanelHeader
                title="Parcerias"
                description="Divisão dos honorários com escritórios parceiros, por caso. Cada caso mantém a divisão registrada quando o acordo foi criado."
              />
              <PartnershipAgreementsTable agreements={partnerships} processMap={processMap} clientMap={clientMap} partnerNames={partnerNames} />
            </Panel>
          )}
        </Can>
        <p className="text-[12px] text-subtle">
          Valores de êxito são estimativas calculadas sobre o valor da causa e o percentual contratado; não representam receita garantida.
        </p>
      </div>
    </PageContainer>
  );
}
