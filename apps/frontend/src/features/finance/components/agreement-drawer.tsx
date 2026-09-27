"use client";

import { StatusBadge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/dialog";
import { AGREEMENT_STATUS_LABEL, AGREEMENT_STATUS_TONE } from "@/lib/constants/status";
import type { AgreementRow } from "../utils";
import { AgreementTerms, FeeModelCell, ProcessCell } from "./agreement-summary";
import { PaymentsTable } from "./payments-table";

export function AgreementDrawer({ row, onOpenChange }: { row: AgreementRow | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Drawer
      open={row !== null}
      onOpenChange={onOpenChange}
      width={680}
      title={row ? `Contrato de honorários — ${row.clientName}` : "Contrato de honorários"}
      description="Condições contratadas e cronograma de pagamentos."
    >
      {row && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
            <StatusBadge status={row.agreement.status} labels={AGREEMENT_STATUS_LABEL} tones={AGREEMENT_STATUS_TONE} />
            <FeeModelCell row={row} />
            <span className="text-subtle" aria-hidden>
              ·
            </span>
            <ProcessCell row={row} />
          </div>
          <AgreementTerms row={row} caseValue={row.process?.caseValue} />
          <section aria-labelledby="drawer-payments">
            <h3 id="drawer-payments" className="mb-2 text-[13.5px] font-semibold text-foreground">
              Cronograma de pagamentos
            </h3>
            <div className="-mx-6 border-y border-line">
              <PaymentsTable payments={row.payments} caption={`Pagamentos do contrato de ${row.clientName}`} />
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}
