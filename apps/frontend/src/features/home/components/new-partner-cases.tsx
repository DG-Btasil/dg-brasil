"use client";

import Link from "next/link";
import { BriefcaseBusiness } from "lucide-react";
import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { LEGAL_CASE_STATUS_LABEL, LEGAL_CASE_STATUS_TONE } from "@/lib/constants/status";
import { formatDateTime, formatSince, pluralize } from "@/lib/formatting";
import { EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { useNewPartnerCases } from "@/features/partners/hooks";

/** Casos enviados por parceiros aguardando a equipe. Montar somente com "partners.view". */
export function NewPartnerCases() {
  const { rows, total } = useNewPartnerCases();
  return (
    <Panel>
      <PanelHeader
        title="Novos casos de parceiros"
        description={total ? `${pluralize(total, "caso aguardando", "casos aguardando")} análise da equipe` : "Casos enviados pelos escritórios parceiros"}
        actions={
          <ButtonLink href="/casos" variant="secondary" size="sm">
            Ver casos
          </ButtonLink>
        }
      />
      {rows.length === 0 ? (
        <EmptyState compact icon={BriefcaseBusiness} title="Nenhum caso novo" description="Quando um parceiro enviar um caso, ele aparece aqui." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(({ legalCase, clientName, partnerName, documents }) => (
            <li key={legalCase.id} className="flex items-center gap-5 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-foreground">{clientName}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted">
                  <span>
                    Origem: <span className="font-medium text-navy-700">{partnerName}</span>
                  </span>
                  <span>Área: {LEGAL_AREA_LABEL[legalCase.area]}</span>
                  <span>{pluralize(documents, "documento", "documentos")}</span>
                  <span title={legalCase.submittedAt ? formatDateTime(legalCase.submittedAt) : undefined}>
                    Enviado {formatSince(legalCase.submittedAt ?? legalCase.createdAt)} · {formatDateTime(legalCase.submittedAt ?? legalCase.createdAt)}
                  </span>
                </p>
              </div>
              <StatusBadge status={legalCase.status} labels={LEGAL_CASE_STATUS_LABEL} tones={LEGAL_CASE_STATUS_TONE} />
              <Link href={`/casos/${legalCase.id}`} className="whitespace-nowrap text-[12.5px] font-semibold text-navy-700 hover:underline underline-offset-2">
                Abrir caso
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
