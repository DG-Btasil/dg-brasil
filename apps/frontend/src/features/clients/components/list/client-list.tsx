"use client";

import { useMemo, useState } from "react";
import { SearchX, UserPlus, Users } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { Can } from "@/components/layout/guards";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Panel } from "@/components/ui/panel";
import { sortBy, type SortDirection } from "@/components/ui/table";
import { CLIENT_STATUSES } from "@/lib/constants/status";
import { useResponsibleOptions, useUserMap } from "@/features/offices/hooks";
import { usePermission } from "@/features/auth/hooks";
import { usePartnerOptions } from "@/features/partners/hooks";
import { useClientRows } from "../../hooks";
import { clientDisplayName } from "../../utils";
import { applyClientFilters, ClientFilters, EMPTY_FILTERS, type ClientFilterState } from "./client-filters";
import { ClientTable, type ClientSortKey } from "./client-table";

export function ClientList() {
  const rows = useClientRows();
  const userMap = useUserMap();
  const responsibleOptions = useResponsibleOptions();
  const canPartners = usePermission("partners.view");
  const partnerOptions = usePartnerOptions();
  const [filters, setFilters] = useState<ClientFilterState>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<ClientSortKey | null>("updated");
  const [direction, setDirection] = useState<SortDirection>("desc");

  const visible = useMemo(() => {
    const filtered = applyClientFilters(rows, filters);
    if (!sortKey) return filtered;
    const getters: Record<ClientSortKey, (r: (typeof filtered)[number]) => string | number> = {
      name: (r) => clientDisplayName(r.client),
      status: (r) => CLIENT_STATUSES.indexOf(r.client.status),
      updated: (r) => r.client.updatedAt,
      processes: (r) => r.activeProcesses,
    };
    return sortBy(filtered, getters[sortKey], direction);
  }, [rows, filters, sortKey, direction]);

  function onSort(key: ClientSortKey) {
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection(key === "name" ? "asc" : "desc");
    }
  }

  const createCta = (label: string) => (
    <Can permission="clients.edit">
      <ButtonLink href="/clientes/novo" icon={<UserPlus className="size-4" aria-hidden />}>
        {label}
      </ButtonLink>
    </Can>
  );

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Pessoas físicas e jurídicas atendidas pelo escritório, com a situação documental, a análise jurídica e os processos de cada uma."
        actions={createCta("Cadastrar cliente")}
      />
      {rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Users}
            title="Você ainda não cadastrou clientes."
            description="Cadastre o primeiro cliente para organizar documentos, iniciar análises jurídicas e acompanhar processos."
            action={createCta("Cadastrar primeiro cliente")}
          />
        </Panel>
      ) : (
        <Panel>
          <ClientFilters value={filters} onChange={setFilters} responsibleOptions={responsibleOptions} resultCount={visible.length} partnerOptions={canPartners ? partnerOptions : undefined} />
          {visible.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Nenhum cliente corresponde aos filtros."
              description="Revise a busca ou remova alguns filtros para ver mais resultados."
              action={
                <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <ClientTable rows={visible} userMap={userMap} sortKey={sortKey} direction={direction} onSort={onSort} />
          )}
        </Panel>
      )}
    </>
  );
}
