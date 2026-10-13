"use client";

import { useMemo, useState } from "react";
import { FolderOpen, Plus, SearchX, X } from "lucide-react";
import { LEGAL_AREA_LABEL, LEGAL_AREAS } from "@/lib/constants/legal";
import { LEGAL_CASE_STATUS_LABEL, LEGAL_CASE_STATUSES } from "@/lib/constants/status";
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
import { listCasesAction } from "@/server/domain/cases/actions";
import type { CaseListItem } from "@/server/domain/cases/dto";
import { usePermission } from "@/features/auth/hooks";
import { searchActiveClients } from "@/features/clients/picker";
import { useDirectoryUserMap, useLawyerOptions, useOrganizationNames, useOrgDirectory } from "@/features/directory/directory-context";
import { CASE_PAGE_SIZE, CASE_PERIODS, caseQueryToInput, caseQueryToSearchParams, countCaseFilters, DEFAULT_CASE_QUERY, type CaseListQuery, type CaseSortField } from "../list-query";
import { CaseListTable } from "./case-list-table";

const statusOptions = LEGAL_CASE_STATUSES.map((s) => ({ value: s, label: LEGAL_CASE_STATUS_LABEL[s] }));
const areaOptions = LEGAL_AREAS.map((a) => ({ value: a, label: LEGAL_AREA_LABEL[a] }));
const PERIOD_LABEL: Record<(typeof CASE_PERIODS)[number], string> = { "7": "Últimos 7 dias", "30": "Últimos 30 dias", "90": "Últimos 90 dias" };
const periodOptions = CASE_PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }));

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (v: string) => void }) {
  return <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder={label} className="h-8 text-[12.5px]" />;
}

/** Casos jurídicos (equipe interna), ligados ao backend: Cliente → Caso → Processo(s). */
export function CaseList({
  initialQuery,
  initialResult,
  initialClientLabel,
}: {
  initialQuery: CaseListQuery;
  initialResult: ActionResult<Page<CaseListItem>>;
  initialClientLabel?: string;
}) {
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery,
    initialResult,
    load: (q: CaseListQuery) => listCasesAction(caseQueryToInput(q)),
    toSearch: caseQueryToSearchParams,
  });
  const lawyers = useLawyerOptions();
  const users = useDirectoryUserMap();
  const names = useOrganizationNames();
  const { owner, partners } = useOrgDirectory();
  const canPartners = usePermission("partners.view");
  const [search, setSearch] = useState(query.search);
  const [client, setClient] = useState<PickerOption | null>(query.clientId ? { id: query.clientId, label: initialClientLabel ?? "Cliente selecionado" } : null);
  const commitSearch = useDebouncedCallback((text: string) => setQuery({ ...query, search: text.trim(), page: 1 }));
  const set = <K extends keyof CaseListQuery>(key: K, value: CaseListQuery[K]) => setQuery({ ...query, [key]: value, page: 1 });
  const originOptions = useMemo(
    () => [{ value: owner.id, label: owner.name }, ...partners.map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))],
    [owner, partners],
  );
  const active = countCaseFilters(query);
  const page = result.ok ? result.data : undefined;

  function clear() {
    setSearch("");
    setClient(null);
    setQuery({ ...DEFAULT_CASE_QUERY, sort: query.sort, direction: query.direction });
  }

  function onSort(key: CaseSortField) {
    const direction = key === query.sort ? (query.direction === "asc" ? "desc" : "asc") : key === "title" ? "asc" : "desc";
    setQuery({ ...query, sort: key, direction, page: 1 });
  }

  const cta = (
    <Can permission="cases.edit">
      <ButtonLink href="/casos/novo" icon={<Plus className="size-4" aria-hidden />}>
        Novo caso
      </ButtonLink>
    </Can>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Casos"
        description="Cada caso reúne o cliente, a origem, a análise, as revisões, os processos judiciais e o financeiro de uma demanda."
        actions={cta}
      />
      {page && page.total === 0 && active === 0 && query.page === 1 ? (
        <Panel>
          <EmptyState icon={FolderOpen} title="Nenhum caso cadastrado." description="Crie um caso a partir de um cliente ou receba casos enviados pelos parceiros." action={cta} />
        </Panel>
      ) : (
        <Panel>
          <div className="border-b border-line px-5 py-3" role="search" aria-label="Filtrar casos">
            <div className="flex items-center gap-3">
              <SearchInput
                aria-label="Buscar casos por título ou parte contrária"
                placeholder="Buscar por título do caso ou parte contrária"
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
                  {page.total === 1 ? "1 caso" : `${page.total} casos`}
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
              <FilterSelect label="Situação" value={query.status} options={statusOptions} onChange={(v) => set("status", v as CaseListQuery["status"])} />
              <FilterSelect label="Área" value={query.area} options={areaOptions} onChange={(v) => set("area", v as CaseListQuery["area"])} />
              <FilterSelect label="Responsável" value={query.lawyer} options={lawyers} onChange={(v) => set("lawyer", v)} />
              <AsyncPicker
                value={client}
                search={searchActiveClients}
                placeholder="Cliente"
                onChange={(o) => {
                  setClient(o);
                  set("clientId", o?.id ?? "");
                }}
              />
              {canPartners && <FilterSelect label="Origem: todas" value={query.origin} options={originOptions} onChange={(v) => set("origin", v)} />}
              <FilterSelect label="Data de criação" value={query.period} options={periodOptions} onChange={(v) => set("period", v as CaseListQuery["period"])} />
            </div>
          </div>
          <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
            {!result.ok ? (
              <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar os casos." />
            ) : !page ? (
              <SkeletonRows rows={6} />
            ) : page.items.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="Nenhum caso corresponde aos filtros."
                description="Ajuste a busca ou limpe os filtros."
                action={
                  <Button variant="secondary" onClick={clear}>
                    Limpar filtros
                  </Button>
                }
              />
            ) : (
              <>
                <CaseListTable
                  rows={page.items}
                  sortKey={query.sort}
                  direction={query.direction}
                  onSort={onSort}
                  lawyerName={(id) => (id ? users.get(id)?.name : undefined)}
                  originName={(id) => names.get(id)}
                  ownerId={owner.id}
                />
                <Pagination page={page.page} pageSize={CASE_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={{ one: "caso", many: "casos" }} />
              </>
            )}
          </div>
        </Panel>
      )}
    </PageContainer>
  );
}
