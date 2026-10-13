"use client";

import { useMemo, useState } from "react";
import { Briefcase, Plus, SearchX, X } from "lucide-react";
import { COURTS } from "@/lib/constants/legal";
import { PROCESS_ORIGIN_LABEL, PROCESS_ORIGINS, PROCESS_PHASE_LABEL, PROCESS_PHASES, PROCESS_STATUS_LABEL, PROCESS_STATUSES } from "@/lib/constants/status";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/actions/result";
import { useDebouncedCallback, useServerList } from "@/lib/hooks/use-server-list";
import { Can, PageContainer } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { AsyncPicker, type PickerOption } from "@/components/ui/async-picker";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { SearchInput, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import type { Page } from "@/server/core/pagination";
import { listProcessesAction } from "@/server/domain/processes/actions";
import type { ProcessListItem } from "@/server/domain/processes/dto";
import { usePermission } from "@/features/auth/hooks";
import { searchActiveClients } from "@/features/clients/picker";
import { useLawyerOptions, useOrgDirectory } from "@/features/directory/directory-context";
import { countProcessFilters, DEFAULT_PROCESS_QUERY, PROCESS_PAGE_SIZE, processQueryToInput, processQueryToSearchParams, type ProcessListQuery } from "../list-query";
import { ProcessListTable, type ProcessSortField } from "./process-list-table";

const opts = <T extends string>(values: readonly T[], labels?: Record<T, string>) => values.map((v) => ({ value: v, label: labels ? labels[v] : v }));

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (v: string) => void }) {
  return <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder={label} className="h-8 text-[12.5px]" />;
}

/** Carteira processual (equipe interna), com busca, filtros, ordem e páginas no servidor. */
export function ProcessList({
  initialQuery,
  initialResult,
  initialClientLabel,
}: {
  initialQuery: ProcessListQuery;
  initialResult: ActionResult<Page<ProcessListItem>>;
  initialClientLabel?: string;
}) {
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery,
    initialResult,
    load: (q: ProcessListQuery) => listProcessesAction(processQueryToInput(q)),
    toSearch: processQueryToSearchParams,
  });
  const lawyers = useLawyerOptions();
  const canPartners = usePermission("partners.view");
  const { owner, partners } = useOrgDirectory();
  const [search, setSearch] = useState(query.search);
  const [client, setClient] = useState<PickerOption | null>(query.clientId ? { id: query.clientId, label: initialClientLabel ?? "Cliente selecionado" } : null);
  const commitSearch = useDebouncedCallback((text: string) => setQuery({ ...query, search: text.trim(), page: 1 }));
  const set = <K extends keyof ProcessListQuery>(key: K, value: ProcessListQuery[K]) => setQuery({ ...query, [key]: value, page: 1 });
  const caseOriginOptions = useMemo(
    () => [{ value: owner.id, label: owner.name }, ...partners.map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))],
    [owner, partners],
  );
  const active = countProcessFilters(query);
  const page = result.ok ? result.data : undefined;

  function clear() {
    setSearch("");
    setClient(null);
    setQuery({ ...DEFAULT_PROCESS_QUERY, sort: query.sort, direction: query.direction });
  }
  function onSort(key: ProcessSortField) {
    const direction = key === query.sort ? (query.direction === "asc" ? "desc" : "asc") : key === "title" || key === "cnj" ? "asc" : "desc";
    setQuery({ ...query, sort: key, direction, page: 1 });
  }

  const cta = (
    <Can permission="processes.edit">
      <ButtonLink href="/processos/novo" icon={<Plus className="size-4" aria-hidden />}>
        Cadastrar processo
      </ButtonLink>
    </Can>
  );

  return (
    <PageContainer>
      <PageHeader title="Processos" description="Carteira processual do escritório: prazos, fases e origem de cada processo." actions={cta} />
      {page && page.total === 0 && active === 0 && query.page === 1 ? (
        <Panel>
          <EmptyState
            icon={Briefcase}
            title="Nenhum processo cadastrado."
            description="Processos aparecem aqui quando são cadastrados pela equipe, importados pela integração ou criados a partir de análises aprovadas."
            action={cta}
          />
        </Panel>
      ) : (
        <Panel>
          <div className="border-b border-line px-5 py-3" role="search" aria-label="Filtrar processos">
            <div className="flex items-center gap-3">
              <SearchInput
                aria-label="Buscar processos por número CNJ ou título"
                placeholder="Buscar por número CNJ ou título do processo"
                value={search}
                maxLength={120}
                onChange={(e) => {
                  setSearch(e.target.value);
                  commitSearch(e.target.value);
                }}
                className="w-[420px]"
              />
              {page && (
                <p className="text-[12.5px] text-muted" aria-live="polite">
                  {page.total === 1 ? "1 processo" : `${page.total} processos`}
                  {active > 0 ? " com os filtros" : ""}
                </p>
              )}
              {active > 0 && (
                <Button variant="ghost" size="sm" className="ml-auto" icon={<X className="size-3.5" aria-hidden />} onClick={clear}>
                  Limpar filtros ({active})
                </Button>
              )}
            </div>
            <div className="mt-2.5 grid grid-cols-4 gap-2">
              <AsyncPicker
                value={client}
                search={searchActiveClients}
                placeholder="Cliente"
                onChange={(o) => {
                  setClient(o);
                  set("clientId", o?.id ?? "");
                }}
              />
              <FilterSelect label="Responsável" value={query.responsible} options={lawyers} onChange={(v) => set("responsible", v)} />
              <FilterSelect label="Tribunal" value={query.court} options={opts(COURTS)} onChange={(v) => set("court", v)} />
              <FilterSelect label="Status" value={query.status} options={opts(PROCESS_STATUSES, PROCESS_STATUS_LABEL)} onChange={(v) => set("status", v as ProcessListQuery["status"])} />
              <FilterSelect label="Fase" value={query.phase} options={opts(PROCESS_PHASES, PROCESS_PHASE_LABEL)} onChange={(v) => set("phase", v as ProcessListQuery["phase"])} />
              <FilterSelect label="Origem do cadastro" value={query.origin} options={opts(PROCESS_ORIGINS, PROCESS_ORIGIN_LABEL)} onChange={(v) => set("origin", v as ProcessListQuery["origin"])} />
              {canPartners && <FilterSelect label="Origem do caso: todas" value={query.caseOrigin} options={caseOriginOptions} onChange={(v) => set("caseOrigin", v)} />}
            </div>
          </div>
          <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
            {!result.ok ? (
              <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar os processos." />
            ) : !page ? (
              <SkeletonRows rows={6} />
            ) : page.items.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="Nenhum processo corresponde aos filtros."
                description="Ajuste a busca ou limpe os filtros para ver toda a carteira."
                action={
                  <Button variant="secondary" onClick={clear}>
                    Limpar filtros
                  </Button>
                }
              />
            ) : (
              <>
                <ProcessListTable rows={page.items} sortKey={query.sort} direction={query.direction} onSort={onSort} />
                <Pagination
                  page={page.page}
                  pageSize={PROCESS_PAGE_SIZE}
                  total={page.total}
                  disabled={pending}
                  onPageChange={(p) => setQuery({ ...query, page: p })}
                  noun={{ one: "processo", many: "processos" }}
                />
              </>
            )}
          </div>
        </Panel>
      )}
    </PageContainer>
  );
}
