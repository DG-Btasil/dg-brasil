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
import { useClientMap } from "@/features/processes/hooks";
import { useCasePartnership } from "@/features/cases/hooks";
import { PartnershipAgreementsTable } from "@/features/partners/components/agreements-table";
import { useCaseFinance } from "../hooks";
import type { AgreementRow } from "../utils";
import { AgreementForm } from "./agreement-form";
import { AgreementTerms, FeeModelCell } from "./agreement-summary";
import { PaymentsTable } from "./payments-table";

/**
 * Financeiro do CASO (somente quem tem "finance.view"): contrato de honorários
 * (abrange todos os processos do caso) e, se a origem for parceiro, o acordo
 * de parceria criado no aceite.
 */
export function CaseFinancePanel({ legalCaseId }: { legalCaseId: string }) {
  const allowed = usePermission("finance.view");
  if (!allowed) return null;
  return (
    <div className="space-y-5">
      <CasePartnershipFinance legalCaseId={legalCaseId} />
      <CaseFinanceContent legalCaseId={legalCaseId} />
    </div>
  );
}

/** Caso originado por parceiro: divisão dos honorários registrada no aceite (snapshot). */
function CasePartnershipFinance({ legalCaseId }: { legalCaseId: string }) {
  const agreement = useCasePartnership(legalCaseId);
  const clientMap = useClientMap();
  const canPartners = usePermission("partners.finance.view");
  if (!agreement || !canPartners) return null;
  return (
    <Panel>
      <PanelHeader title="Acordo de parceria" description="Criado no aceite do caso, com a divisão do parceiro vigente naquele momento (snapshot)." />
      <PartnershipAgreementsTable agreements={[agreement]} clientMap={clientMap} />
    </Panel>
  );
}

function CaseFinanceContent({ legalCaseId }: { legalCaseId: string }) {
  const { legalCase, clientName, rows } = useCaseFinance(legalCaseId);
  const [creating, setCreating] = useState(false);

  if (!legalCase) {
    return <EmptyState compact title="Caso não encontrado." />;
  }

  const newForm = (
    <Panel>
      <PanelHeader title="Associar modelo de honorários" description={`Contrato para ${clientName}, vinculado a este caso (abrange todos os processos dele).`} />
      <PanelBody className="px-6 py-5">
        <AgreementForm
          fixedClientId={legalCase.clientId}
          fixedCaseId={legalCase.id}
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
            title="Nenhum contrato de honorários para este caso."
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
        <AgreementBlock key={row.agreement.id} row={row} caseValue={row.caseValue} />
      ))}
      {creating ? (
        newForm
      ) : (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
            Novo contrato para este caso
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
        description="Contrato do caso: abrange todos os processos dele."
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
