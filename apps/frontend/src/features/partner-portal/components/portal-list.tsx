"use client";

import { useState, type ReactNode } from "react";
import { SearchX, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { pluralize } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useDebouncedCallback, useServerList } from "@/lib/hooks/use-server-list";
import { PageContainer } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { SearchInput, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import type { Page } from "@/server/core/pagination";
import { DEFAULT_PORTAL_QUERY, PORTAL_PAGE_SIZE, portalQueryToSearchParams, type PortalListQuery } from "../list-query";

/**
 * Lista do portal (clientes, casos, processos): busca, situação e páginas no
 * SERVIDOR (RLS recorta ao escritório do parceiro), estado na URL sem
 * CPF/CNPJ, e os estados de carregamento, vazio e erro.
 */
export function PortalServerList<T>({
  title,
  description,
  cta,
  initialQuery,
  initialResult,
  load,
  noun,
  searchLabel,
  statusOptions,
  empty,
  errorTitle,
  children,
}: {
  title: string;
  description: string;
  cta?: ReactNode;
  initialQuery: PortalListQuery;
  initialResult: ActionResult<Page<T>>;
  load: (q: PortalListQuery) => Promise<ActionResult<Page<T>>>;
  noun: { one: string; many: string };
  searchLabel: string;
  statusOptions?: { value: string; label: string }[];
  empty: { icon: LucideIcon; title: string; description?: string };
  errorTitle: string;
  children: (rows: T[]) => ReactNode;
}) {
  const { query, setQuery, result, pending, retry } = useServerList({ initialQuery, initialResult, load, toSearch: portalQueryToSearchParams });
  const [search, setSearch] = useState(query.search);
  const commitSearch = useDebouncedCallback((text: string) => setQuery({ ...query, search: text.trim(), page: 1 }));
  const page = result.ok ? result.data : undefined;
  const filtered = !!query.search || !!query.status;

  return (
    <PageContainer>
      <PageHeader title={title} description={description} actions={cta} />
      {page && page.total === 0 && !filtered ? (
        <Panel>
          <EmptyState icon={empty.icon} title={empty.title} description={empty.description} action={cta} />
        </Panel>
      ) : (
        <Panel>
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3" role="search" aria-label={`Filtrar ${noun.many}`}>
            <SearchInput
              aria-label={searchLabel}
              placeholder={searchLabel}
              value={search}
              maxLength={120}
              onChange={(e) => {
                setSearch(e.target.value);
                commitSearch(e.target.value);
              }}
              className="w-[360px]"
            />
            {statusOptions && (
              <Select
                aria-label="Situação"
                placeholder="Todas as situações"
                options={statusOptions}
                value={query.status}
                onChange={(e) => setQuery({ ...query, status: e.target.value, page: 1 })}
                className="h-8 w-[220px] text-[12.5px]"
              />
            )}
            {page && (
              <p className="ml-auto text-[12.5px] text-muted" aria-live="polite">
                {pluralize(page.total, noun.one, noun.many)}
              </p>
            )}
          </div>
          <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
            {!result.ok ? (
              <ActionErrorState error={result} onRetry={retry} title={errorTitle} />
            ) : !page ? (
              <SkeletonRows rows={5} />
            ) : page.items.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="Nenhum resultado para os filtros."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearch("");
                      setQuery(DEFAULT_PORTAL_QUERY);
                    }}
                  >
                    Limpar filtros
                  </Button>
                }
              />
            ) : (
              <>
                {children(page.items)}
                <Pagination page={page.page} pageSize={PORTAL_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={noun} />
              </>
            )}
          </div>
        </Panel>
      )}
    </PageContainer>
  );
}
