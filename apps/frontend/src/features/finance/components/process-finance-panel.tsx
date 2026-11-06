"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatCurrency } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import type { Page } from "@/server/core/pagination";
import type { AgreementListItemDTO, ExpenseDTO, ProcessFinanceDetailDTO, ProcessFinanceDTO } from "@/server/domain/finance/dto";
import { percentLabel } from "../labels";
import { DEFAULT_AGREEMENT_QUERY, DEFAULT_EXPENSE_QUERY } from "../list-query";
import { AgreementsPanel } from "./agreements-table";
import { ExpensesPanel } from "./expenses-panel";

/** Indicador compacto (a aba do processo mostra muitos; o Stat grande da visão geral não cabe). */
function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: ReactNode; tone?: "danger" | "success" | "warning" }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3 shadow-hairline">
      <span className="block text-[12px] font-medium text-muted">{label}</span>
      <span
        className={cn(
          "mt-1 block font-serif text-[20px] font-medium leading-tight tabular",
          tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-navy",
        )}
      >
        {value}
      </span>
      {hint && <span className="mt-1 block text-[11.5px] text-muted">{hint}</span>}
    </div>
  );
}

/** Resumo do processo: tudo somado no banco (view process_finance_overview). */
function ProcessFinanceSummary({ p }: { p: ProcessFinanceDTO }) {
  const partner = !!p.partnerOrganizationId;
  const fee = p.feeAmount !== undefined ? formatCurrency(p.feeAmount) : "—";
  return (
    <Panel>
      <PanelHeader
        title="Resumo financeiro do processo"
        description={
          partner
            ? `Divisão da parceria do caso: escritório ${percentLabel(p.ownerPercentage)} · parceiro ${percentLabel(p.partnerPercentage)} (congelada no aceite).`
            : "Processo sem parceria: os honorários são do escritório."
        }
      />
      <PanelBody>
        <div className="grid grid-cols-4 gap-3">
          <Tile label="Valor da causa" value={p.caseValue !== undefined ? formatCurrency(p.caseValue) : "—"} hint={p.caseValue === undefined ? "Não informado no processo" : undefined} />
          <Tile label="Honorários" value={fee} hint={p.feePercentage !== undefined ? `Êxito ${percentLabel(p.feePercentage)}` : p.feeAmount === undefined ? "Defina nos dados internos do processo" : undefined} />
          <Tile label="Parte do escritório" value={formatCurrency(p.feeOwnerShare)} hint={`${percentLabel(p.ownerPercentage)} dos honorários`} />
          <Tile label="Parte do parceiro" value={partner ? formatCurrency(p.feePartnerShare) : "—"} hint={partner ? `${percentLabel(p.partnerPercentage)} dos honorários` : "Sem parceria"} />
          <Tile label="Contratado" value={formatCurrency(p.contracted)} hint={p.agreementCount === 0 ? "Sem contrato de honorários" : `${p.agreementCount} ${p.agreementCount === 1 ? "contrato" : "contratos"}`} />
          <Tile
            label="Recebido"
            value={formatCurrency(p.received)}
            tone={p.received > 0 ? "success" : undefined}
            hint={partner ? `Escritório ${formatCurrency(p.receivedOwnerShare)} · parceiro ${formatCurrency(p.receivedPartnerShare)}` : undefined}
          />
          <Tile label="Em aberto" value={formatCurrency(p.openBalance)} />
          <Tile label="Em atraso" value={formatCurrency(p.overdue)} tone={p.overdue > 0 ? "danger" : undefined} hint={p.overdue > 0 ? "Obrigações vencidas com saldo" : "Nada vencido"} />
          <Tile label="Despesas pagas" value={formatCurrency(p.expensesPaid)} hint={p.expensesReimbursable > 0 ? `${formatCurrency(p.expensesReimbursable)} reembolsáveis pelo cliente` : undefined} />
          <Tile label="Despesas a pagar" value={formatCurrency(p.expensesOpen)} tone={p.expensesOpen > 0 ? "warning" : undefined} />
          <Tile
            label="Resultado"
            value={formatCurrency(p.netResult)}
            tone={p.netResult < 0 ? "danger" : undefined}
            hint={partner ? "Recebido − parte do parceiro − despesas pagas" : "Recebido − despesas pagas"}
          />
        </div>
      </PanelBody>
    </Panel>
  );
}

/**
 * Aba "Financeiro" do processo (ADMIN, `finance.view`): resumo, contratos de
 * honorários do processo (gaveta com obrigações e recebimentos) e despesas.
 * `initial` vem de `getProcessFinanceAction({ processId })` no Server
 * Component (ver `loadProcessFinance`). Depois de cada mudança a página
 * recarrega do servidor (router.refresh) e os totais chegam novos.
 */
export function ProcessFinancePanel({ processId, initial }: { processId: string; initial: ActionResult<ProcessFinanceDetailDTO> }) {
  // Identidade estável por resposta do servidor: useServerList recomeça quando ela muda.
  const agreements = useMemo<ActionResult<Page<AgreementListItemDTO>> | null>(
    () => (initial.ok ? { ok: true, data: initial.data.agreements, requestId: initial.requestId } : null),
    [initial],
  );
  const expenses = useMemo<ActionResult<Page<ExpenseDTO>> | null>(() => (initial.ok ? { ok: true, data: initial.data.expenses, requestId: initial.requestId } : null), [initial]);

  if (!initial.ok) {
    if (initial.error.code === "NOT_FOUND") return <EmptyState compact title="Financeiro indisponível para este processo." description="O processo pode ter sido excluído." />;
    return <ActionErrorState error={initial} title="Não foi possível carregar o financeiro do processo." />;
  }
  const p = initial.data.process;
  return (
    <div className="space-y-5">
      <ProcessFinanceSummary p={p} />
      {agreements && (
        <AgreementsPanel
          legalProcessId={processId}
          initialQuery={DEFAULT_AGREEMENT_QUERY}
          initialResult={agreements}
          title="Contratos de honorários do processo"
          description="Um contrato ativo por processo. Clique para ver as obrigações e registrar recebimentos."
        />
      )}
      {expenses && (
        <ExpensesPanel
          processId={processId}
          initialQuery={DEFAULT_EXPENSE_QUERY}
          initialResult={expenses}
          title="Despesas do processo"
          description="Custas, advogado contratado, perícia/avaliação, audiência, deslocamento e cartório."
        />
      )}
      <p className="text-[12px] text-subtle">
        Valores em reais, somados pelo banco. Contratos antigos, ligados só ao caso, aparecem na{" "}
        <Link href={`/casos/${p.legalCaseId}?aba=financeiro`} className="text-navy-700 underline underline-offset-2">
          aba Financeiro do caso
        </Link>
        .
      </p>
    </div>
  );
}
