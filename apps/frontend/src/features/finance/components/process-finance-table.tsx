"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRight, Scale } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCNJ, formatCurrency, pluralize } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useDebouncedCallback, useServerList } from "@/lib/hooks/use-server-list";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { SearchInput, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { listProcessFinanceAction } from "@/server/domain/finance/actions";
import type { ProcessFinanceDTO } from "@/server/domain/finance/dto";
import {
  PROCESS_FINANCE_FILTERS,
  PROCESS_FINANCE_FILTER_LABEL,
  PROCESS_FINANCE_PAGE_SIZE,
  PROCESS_FINANCE_SORTS,
  PROCESS_FINANCE_SORT_LABEL,
  processFinanceQueryToInput,
  processFinanceQueryToSearchParams,
  withFinanceTab,
  type ProcessFinanceFilter,
  type ProcessFinanceListQuery,
  type ProcessFinanceSort,
} from "../list-query";
import { percentLabel } from "../labels";
import { ExportButton, type ExportAction } from "@/features/export/export-button";

const FILTER_OPTIONS = PROCESS_FINANCE_FILTERS.map((f) => ({ value: f, label: PROCESS_FINANCE_FILTER_LABEL[f] }));
const SORT_OPTIONS = PROCESS_FINANCE_SORTS.map((s) => ({ value: s, label: PROCESS_FINANCE_SORT_LABEL[s] }));

const href = (p: ProcessFinanceDTO) => `/processos/${p.legalProcessId}?aba=financeiro`;

/**
 * Financeiro POR PROCESSO (046): uma linha por processo, somada no banco (view
 * process_finance_overview). Busca, filtros, ordem e página no servidor e na
 * URL (`?aba=processos`). Cada linha abre a aba Financeiro do processo.
 */
export function ProcessFinanceTable({
  initialQuery,
  initialResult,
  exportAction,
}: {
  initialQuery: ProcessFinanceListQuery;
  initialResult: ActionResult<Page<ProcessFinanceDTO>>;
  /** Server Action que exporta esta lista em planilha, com os filtros da tela. Sem ela, o botão não aparece. */
  exportAction?: ExportAction;
}) {
  const router = useRouter();
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery,
    initialResult,
    load: (q: ProcessFinanceListQuery) => listProcessFinanceAction(processFinanceQueryToInput(q)),
    toSearch: (q: ProcessFinanceListQuery) => withFinanceTab(processFinanceQueryToSearchParams(q), "processos"),
  });
  const [search, setSearch] = useState(query.search);
  const commitSearch = useDebouncedCallback((text: string) => setQuery({ ...query, search: text.trim(), page: 1 }));
  const page = result.ok ? result.data : undefined;
  const filtered = !!(query.search || query.filter);

  return (
    <Panel>
      <PanelHeader
        title="Financeiro por processo"
        description="Valor da causa, honorários (escritório × parceiro), contratado, recebido, despesas e resultado de cada processo."
        actions={exportAction && <ExportButton action={exportAction} input={processFinanceQueryToInput(query)} size="sm" />}
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3" role="search" aria-label="Filtrar processos">
        <SearchInput
          aria-label="Buscar por cliente, título ou número CNJ"
          placeholder="Buscar por cliente, título ou número CNJ"
          className="w-[340px]"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            commitSearch(e.target.value);
          }}
        />
        <Select
          aria-label="Mostrar"
          placeholder="Todos os processos"
          options={FILTER_OPTIONS}
          value={query.filter}
          onChange={(e) => setQuery({ ...query, filter: e.target.value as ProcessFinanceFilter | "", page: 1 })}
          className="w-[230px]"
        />
        <Select
          aria-label="Ordenar por"
          options={SORT_OPTIONS}
          value={query.sort}
          onChange={(e) => setQuery({ ...query, sort: e.target.value as ProcessFinanceSort, page: 1 })}
          className="w-[190px]"
        />
      </div>
      <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {!result.ok ? (
          <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar o financeiro dos processos." />
        ) : !page ? (
          <SkeletonRows rows={5} />
        ) : page.items.length === 0 ? (
          filtered ? <EmptyState compact title="Nenhum processo com estes filtros." /> : <EmptyState icon={Scale} title="Nenhum processo cadastrado." />
        ) : (
          <>
            <p className="border-b border-line px-5 py-2 text-[12px] text-muted" aria-live="polite">
              {pluralize(page.total, "processo", "processos")}
            </p>
            <Table caption="Financeiro por processo">
              <THead>
                <tr>
                  <Th>Processo</Th>
                  <Th className="text-right">Valor da causa</Th>
                  <Th className="text-right">Honorários</Th>
                  <Th className="text-right">Contratado</Th>
                  <Th className="text-right">Recebido</Th>
                  <Th className="text-right">Em aberto</Th>
                  <Th className="text-right">Despesas</Th>
                  <Th className="text-right">Resultado</Th>
                  <Th>
                    <span className="sr-only">Abrir</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {page.items.map((p) => (
                  <Tr key={p.legalProcessId} interactive onClick={() => router.push(href(p))}>
                    <Td className="max-w-[300px]">
                      <Link href={href(p)} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-foreground hover:text-navy hover:underline underline-offset-2">
                        {p.title || "Processo sem título"}
                      </Link>
                      <span className="block truncate text-[12px] text-muted">{p.clientName || "—"}</span>
                      <span className="block truncate font-mono text-[11.5px] tabular text-subtle">{p.cnjNumber ? formatCNJ(p.cnjNumber) : "Sem número CNJ"}</span>
                    </Td>
                    <Td className="text-right tabular">{p.caseValue !== undefined ? formatCurrency(p.caseValue) : <span className="text-subtle">—</span>}</Td>
                    <Td className="text-right tabular">
                      {p.feeAmount !== undefined ? formatCurrency(p.feeAmount) : <span className="text-subtle">—</span>}
                      {p.feePercentage !== undefined && <span className="block text-[11.5px] text-muted">êxito {percentLabel(p.feePercentage)}</span>}
                      {p.partnerOrganizationId && p.feeAmount !== undefined && (
                        <span className="block text-[11.5px] text-muted">
                          parceiro {percentLabel(p.partnerPercentage)} · {formatCurrency(p.feePartnerShare)}
                        </span>
                      )}
                    </Td>
                    <Td className="text-right tabular">
                      {formatCurrency(p.contracted)}
                      {p.agreementCount === 0 && <span className="block text-[11.5px] text-subtle">sem contrato</span>}
                    </Td>
                    <Td className="text-right tabular">{formatCurrency(p.received)}</Td>
                    <Td className="text-right tabular">
                      {formatCurrency(p.openBalance)}
                      {p.overdue > 0 && <span className="block text-[11.5px] text-danger">{formatCurrency(p.overdue)} em atraso</span>}
                    </Td>
                    <Td className="text-right tabular">
                      {formatCurrency(p.expensesTotal)}
                      {p.expensesOpen > 0 && <span className="block text-[11.5px] text-warning">{formatCurrency(p.expensesOpen)} a pagar</span>}
                    </Td>
                    <Td className={cn("text-right tabular font-medium", p.netResult < 0 ? "text-danger" : "text-foreground")}>{formatCurrency(p.netResult)}</Td>
                    <Td className="text-right">
                      <ChevronRight className="inline size-4 text-subtle" aria-hidden />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page.page} pageSize={PROCESS_FINANCE_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(n) => setQuery({ ...query, page: n })} noun={{ one: "processo", many: "processos" }} />
          </>
        )}
      </div>
    </Panel>
  );
}
