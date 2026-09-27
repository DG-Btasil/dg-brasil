"use client";

import { useState } from "react";
import { FileSignature, Info, Plus } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/feedback/states";
import { usePermission } from "@/features/auth/hooks";
import { AGREEMENT_STATUS_LABEL, AGREEMENT_STATUS_TONE } from "@/lib/constants/status";
import { formatCurrency } from "@/lib/formatting";
import { useProcessFinance } from "../hooks";
import type { AgreementRow } from "../utils";
import { AgreementForm } from "./agreement-form";
import { AgreementTerms, FeeModelCell } from "./agreement-summary";
import { PaymentsTable } from "./payments-table";

/**
 * Aba Financeiro da página do processo (somente quem tem "finance.view").
 * Mostra contratos ligados ao processo ou ao cliente como um todo.
 */
export function ProcessFinancePanel({ processId }: { processId: string }) {
  const allowed = usePermission("finance.view");
  if (!allowed) return null;
  return <ProcessFinanceContent processId={processId} />;
}

function ProcessFinanceContent({ processId }: { processId: string }) {
  const { process, clientName, rows } = useProcessFinance(processId);
  const [creating, setCreating] = useState(false);

  if (!process) {
    return <EmptyState compact title="Processo não encontrado." />;
  }

  const newForm = (
    <Panel>
      <PanelHeader title="Associar modelo de honorários" description={`Contrato para ${clientName}, vinculado a este processo.`} />
      <PanelBody className="px-6 py-5">
        <AgreementForm
          fixedClientId={process.clientId}
          fixedProcessId={process.id}
          onCreated={() => setCreating(false)}
          onCancel={rows.length > 0 ? () => setCreating(false) : undefined}
        />
      </PanelBody>
    </Panel>
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <Panel>
          <EmptyState
            icon={FileSignature}
            title="Nenhum contrato de honorários para este processo."
            description="Associe um modelo de honorários do escritório. Os valores podem ser personalizados para este cliente."
            action={
              !creating && (
                <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
                  Associar modelo de honorários
                </Button>
              )
            }
          />
        </Panel>
        {creating && newForm}
        <InternalNote />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <AgreementBlock key={row.agreement.id} row={row} caseValue={process.caseValue} />
      ))}
      {creating ? (
        newForm
      ) : (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
            Novo contrato para este processo
          </Button>
        </div>
      )}
      <InternalNote />
    </div>
  );
}

function AgreementBlock({ row, caseValue }: { row: AgreementRow; caseValue?: number }) {
  const a = row.agreement;
  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Contrato de honorários <StatusBadge status={a.status} labels={AGREEMENT_STATUS_LABEL} tones={AGREEMENT_STATUS_TONE} />
          </span>
        }
        description={!a.processId ? "Contrato abrange todos os processos do cliente." : undefined}
        actions={<FeeModelCell row={row} />}
      />
      <div className="grid grid-cols-4 divide-x divide-line border-b border-line">
        <Figure label="Contratado" value={formatCurrency(a.totalContracted)} />
        <Figure label="Recebido" value={formatCurrency(row.received)} />
        <Figure label="Pendente" value={formatCurrency(row.outstandingBalance)} note={row.overdueAmount > 0 ? `${formatCurrency(row.overdueAmount)} em atraso` : undefined} danger />
        <Figure
          label="Êxito estimado"
          value={a.estimatedSuccessFee ? formatCurrency(a.estimatedSuccessFee) : "—"}
          note={caseValue ? `Valor da causa: ${formatCurrency(caseValue)}` : "Sem valor da causa informado"}
        />
      </div>
      <PanelBody>
        <AgreementTerms row={row} />
      </PanelBody>
      <div className="border-t border-line">
        <PaymentsTable payments={row.payments} caption="Pagamentos do contrato" />
      </div>
    </Panel>
  );
}

function Figure({ label, value, note, danger }: { label: string; value: string; note?: string; danger?: boolean }) {
  return (
    <div className="px-5 py-3.5">
      <p className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">{label}</p>
      <p className="mt-1 font-serif text-[20px] leading-none tabular text-navy">{value}</p>
      {note && <p className={danger ? "mt-1 text-[11.5px] text-danger" : "mt-1 text-[11.5px] text-muted"}>{note}</p>}
    </div>
  );
}

function InternalNote() {
  return (
    <p className="flex items-center gap-1.5 text-[12px] text-subtle">
      <Info className="size-3.5" aria-hidden />
      Informação financeira interna, visível apenas para administradores. O valor da causa é dado jurídico; honorários não.
    </p>
  );
}
