"use client";

import { useMemo, useState } from "react";
import { Briefcase, Plus, SearchX } from "lucide-react";
import { PageContainer, Can } from "@/components/layout/guards";
import { ButtonLink, Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/feedback/states";
import { usePermission } from "@/features/auth/hooks";
import { usePartnerMap, usePartnerOptions } from "@/features/partners/hooks";
import { useResponsibleOptions, useUserMap } from "@/features/offices/hooks";
import { useAllDeadlines, useClientMap, useProcesses } from "../hooks";
import {
  clientDisplayName,
  processClientLabel,
  EMPTY_PROCESS_FILTERS,
  filterProcessRows,
  nextOpenDeadlineByProcess,
  type ProcessFilters as Filters,
  type ProcessRow,
} from "../utils";
import { ProcessFilters } from "./process-filters";
import { ProcessSummaryStrip } from "./process-summary-strip";
import { useCaseMap } from "@/features/cases/hooks";
import { useOffice } from "@/features/offices/hooks";
import { casePartnerId } from "@/lib/domain/legal-case";
import { ProcessTable } from "./process-table";

export function ProcessList() {
  const processes = useProcesses();
  const deadlines = useAllDeadlines();
  const clientMap = useClientMap();
  const userMap = useUserMap();
  const responsibleOptions = useResponsibleOptions();
  const showCaseValue = usePermission("processes.caseValue.view");
  const canPartners = usePermission("partners.view");
  const partnerOptions = usePartnerOptions();
  const partnerMap = usePartnerMap();
  const [filters, setFilters] = useState<Filters>(EMPTY_PROCESS_FILTERS);

  const caseMap = useCaseMap();
  const office = useOffice();
  const rows = useMemo<ProcessRow[]>(() => {
    const next = nextOpenDeadlineByProcess(deadlines);
    return processes.map((process) => {
      const legalCase = caseMap.get(process.legalCaseId);
      return {
        process,
        clientName: processClientLabel(process, clientMap.get(process.clientId)),
        responsibleName: userMap.get(process.responsibleUserId)?.name ?? "—",
        nextDeadline: next.get(process.id),
        casePartnerId: legalCase ? casePartnerId(legalCase, office.id) : undefined,
        caseTitle: legalCase?.title,
      };
    });
  }, [processes, deadlines, clientMap, userMap, caseMap, office.id]);

  const filtered = useMemo(() => filterProcessRows(rows, filters), [rows, filters]);

  const clientOptions = useMemo(() => {
    const ids = [...new Set(processes.map((p) => p.clientId))];
    return ids
      .map((id) => ({ value: id, label: clientDisplayName(clientMap.get(id)) }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [processes, clientMap]);

  const cta = (
    <Can permission="processes.edit">
      <ButtonLink href="/processos/novo" icon={<Plus className="size-4" aria-hidden />}>
        Cadastrar processo
      </ButtonLink>
    </Can>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Processos"
        description="Carteira processual do escritório: prazos, fases e origem de cada processo."
        actions={cta}
      />
      {processes.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Briefcase}
            title="Nenhum processo cadastrado."
            description="Processos aparecem aqui quando são cadastrados pela equipe, importados pela integração ou criados a partir de análises aprovadas."
            action={cta}
          />
        </Panel>
      ) : (
        <>
          <ProcessSummaryStrip rows={rows} />
          <Panel>
            <ProcessFilters
              filters={filters}
              onChange={setFilters}
              clientOptions={clientOptions}
              responsibleOptions={responsibleOptions}
              resultCount={filtered.length}
              total={rows.length}
              partnerOptions={canPartners ? partnerOptions : undefined}
            />
            {filtered.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="Nenhum processo corresponde aos filtros."
                description="Ajuste a busca ou limpe os filtros para ver toda a carteira."
                action={
                  <Button variant="secondary" onClick={() => setFilters(EMPTY_PROCESS_FILTERS)}>
                    Limpar filtros
                  </Button>
                }
              />
            ) : (
              <ProcessTable rows={filtered} showCaseValue={showCaseValue} partnerMap={canPartners ? partnerMap : undefined} />
            )}
          </Panel>
        </>
      )}
    </PageContainer>
  );
}
