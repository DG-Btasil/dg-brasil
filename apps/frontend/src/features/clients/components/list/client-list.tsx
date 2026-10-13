"use client";

import { useMemo } from "react";
import { SearchX, UserPlus, Users } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Can } from "@/components/layout/guards";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/actions/result";
import { useServerList } from "@/lib/hooks/use-server-list";
import type { Page } from "@/server/core/pagination";
import { listClientsAction } from "@/server/domain/clients/actions";
import type { ClientListItem } from "@/server/domain/clients/dto";
import { usePermission } from "@/features/auth/hooks";
import { useDirectoryUserMap, useOrganizationNames, useOrgDirectory, useResponsibleUserOptions } from "@/features/directory/directory-context";
import { CLIENT_PAGE_SIZE, DEFAULT_CLIENT_QUERY, clientQueryToInput, clientQueryToSearchParams, hasClientFilters, type ClientListQuery, type ClientSortField } from "../../list-query";
import { ClientFilters } from "./client-filters";
import { ClientTable } from "./client-table";

/**
 * Lista de clientes ligada ao backend (Etapa 4.3, Fase A). Busca, filtros,
 * ordem e paginação acontecem no servidor (`listClientsAction`); a RLS decide
 * o que cada papel enxerga.
 */
export function ClientList({ initialQuery, initialResult }: { initialQuery: ClientListQuery; initialResult: ActionResult<Page<ClientListItem>> }) {
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery,
    initialResult,
    load: (q: ClientListQuery) => listClientsAction(clientQueryToInput(q)),
    toSearch: clientQueryToSearchParams,
  });
  const userMap = useDirectoryUserMap();
  const responsibleOptions = useResponsibleUserOptions();
  const canPartners = usePermission("partners.view");
  const { owner, partners } = useOrgDirectory();
  const originNames = useOrganizationNames();
  const originOptions = useMemo(
    () => [{ value: owner.id, label: owner.name }, ...partners.map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))],
    [owner, partners],
  );

  function onSort(key: ClientSortField) {
    const direction = key === query.sort ? (query.direction === "asc" ? "desc" : "asc") : key === "name" ? "asc" : "desc";
    setQuery({ ...query, sort: key, direction, page: 1 });
  }

  const createCta = (label: string) => (
    <Can permission="clients.edit">
      <ButtonLink href="/clientes/novo" icon={<UserPlus className="size-4" aria-hidden />}>
        {label}
      </ButtonLink>
    </Can>
  );

  const page = result.ok ? result.data : undefined;
  const filtered = hasClientFilters(query);

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Pessoas físicas e jurídicas atendidas pelo escritório, com o responsável, a origem e a situação de cada cadastro."
        actions={createCta("Cadastrar cliente")}
      />
      {page && page.total === 0 && !filtered && query.page === 1 ? (
        <Panel>
          <EmptyState
            icon={Users}
            title="Nenhum cliente cadastrado."
            description="Cadastre o primeiro cliente para organizar documentos, abrir casos e acompanhar processos."
            action={createCta("Cadastrar primeiro cliente")}
          />
        </Panel>
      ) : (
        <Panel>
          <ClientFilters
            value={query}
            onChange={setQuery}
            responsibleOptions={responsibleOptions}
            originOptions={canPartners ? originOptions : undefined}
            total={page?.total}
          />
          <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
            {!result.ok ? (
              <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar os clientes." />
            ) : !page ? (
              <SkeletonRows rows={6} />
            ) : page.items.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="Nenhum cliente corresponde aos filtros."
                description="Revise a busca ou remova alguns filtros para ver mais resultados."
                action={
                  <Button variant="secondary" onClick={() => setQuery({ ...DEFAULT_CLIENT_QUERY, sort: query.sort, direction: query.direction })}>
                    Limpar filtros
                  </Button>
                }
              />
            ) : (
              <>
                <ClientTable rows={page.items} userMap={userMap} sortKey={query.sort} direction={query.direction} onSort={onSort} originNames={canPartners ? originNames : undefined} />
                <Pagination
                  page={page.page}
                  pageSize={CLIENT_PAGE_SIZE}
                  total={page.total}
                  disabled={pending}
                  onPageChange={(p) => setQuery({ ...query, page: p })}
                  noun={{ one: "cliente", many: "clientes" }}
                />
              </>
            )}
          </div>
        </Panel>
      )}
    </>
  );
}
