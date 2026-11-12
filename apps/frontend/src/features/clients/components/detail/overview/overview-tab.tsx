"use client";

import { CONTRACT_PAYMENT_METHOD_LABEL } from "@/lib/constants/legal";
import type { Client } from "@/types";
import { RepresentativesBlock, PartnersBlock } from "./company-tables";
import { AddressBlock, Block, ContactBlock, IdentificationBlock, ResponsibleBlock } from "./overview-blocks";

export function OverviewTab({ client }: { client: Client }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5">
      <div className="space-y-5">
        <IdentificationBlock client={client} />
        <div className="grid grid-cols-2 gap-5">
          <ContactBlock client={client} />
          <AddressBlock client={client} />
        </div>
        {client.kind === "COMPANY" && (
          <>
            <RepresentativesBlock client={client} />
            <PartnersBlock client={client} />
          </>
        )}
      </div>
      <div className="space-y-5">
        <ResponsibleBlock client={client} />
        {client.kind === "INDIVIDUAL" && (
          <Block title="Forma de pagamento do contrato" clientId={client.id}>
            <p className="text-[13px] leading-relaxed text-foreground">
              {client.contractPaymentMethod ? CONTRACT_PAYMENT_METHOD_LABEL[client.contractPaymentMethod] : <span className="text-muted">Nenhuma forma de pagamento definida.</span>}
            </p>
          </Block>
        )}
        <Block title="Resumo jurídico" clientId={client.id}>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground">
            {client.legalSummary ?? <span className="text-muted">Nenhum resumo registrado.</span>}
          </p>
        </Block>
        <Block title="Observações internas" clientId={client.id}>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground">
            {client.notes ?? <span className="text-muted">Nenhuma observação registrada.</span>}
          </p>
        </Block>
      </div>
    </div>
  );
}
