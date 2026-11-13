"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { FileSignature, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCNJ, formatCurrency, formatDate, pluralize } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useDebouncedCallback, useServerList } from "@/lib/hooks/use-server-list";
import { Can } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { SearchInput, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { listAgreementRowsAction } from "@/server/domain/finance/actions";
import type { AgreementListItemDTO } from "@/server/domain/finance/dto";
import { AGREEMENT_DB_STATUSES } from "@/server/domain/finance/schemas";
import { AGREEMENT_DB_STATUS_LABEL, AGREEMENT_DB_STATUS_TONE } from "../labels";
import {
  AGREEMENT_PAGE_SIZE,
  DEFAULT_AGREEMENT_QUERY,
  agreementQueryIsFiltered,
  agreementQueryToInput,
  agreementQueryToSearchParams,
  withFinanceTab,
  type AgreementListQuery,
  type FinanceTab,
} from "../list-query";
import { AgreementDrawer } from "./agreement-drawer";
import { PeriodFilter } from "./period-filter";

const STATUS_OPTIONS = AGREEMENT_DB_STATUSES.map((s) => ({ value: s, label: AGREEMENT_DB_STATUS_LABEL[s] }));

/** Processo do contrato (046) com link para a aba Financeiro dele; contrato antigo = do caso. */
function ProcessCell({ row }: { row: AgreementListItemDTO }) {
  if (!row.legalProcessId) return <span className="text-[12px] text-subtle">Contrato do caso (anterior ao financeiro por processo). Fora dos totais por processo.</span>;
  return (
    <>
      <Link
        href={`/processos/${row.legalProcessId}?aba=financeiro`}
        onClick={(e) => e.stopPropagation()}
        className="block truncate text-[12.5px] font-medium text-navy hover:underline underline-offset-2"
      >
        {row.processTitle || "Abrir processo"}
      </Link>
      <span className="block truncate font-mono text-[11.5px] tabular text-muted">{row.cnjNumber ? formatCNJ(row.cnjNumber) : "Sem número CNJ"}</span>
      {!row.inProcessTotals && <span className="block text-[11.5px] text-subtle">Processo excluído. Fora dos totais por processo.</span>}
    </>
  );
}

/**
 * Contratos de honorários (ADMIN) lidos do servidor. Busca por cliente,
 * situação, período (data do contrato) e vencimento (próximo em aberto): tudo
 * filtrado e paginado no banco de dados; contratado, recebido e em aberto vêm
 * somados de lá. "Abrir" (ou o clique na linha) mostra a gaveta com parcelas e
 * lançamentos. Escopo: tudo (Financeiro), um caso ou um processo (046: o
 * contrato é do processo); nos dois últimos, só o filtro de situação.
 */
export function AgreementsPanel({
  initialQuery,
  initialResult,
  legalCaseId,
  legalProcessId,
  syncUrl = false,
  urlTab,
  title = "Contratos de honorários",
  description = "Abra um contrato para ver as parcelas e registrar recebimentos.",
  exportAction,
}: {
  initialQuery: AgreementListQuery;
  initialResult: ActionResult<Page<AgreementListItemDTO>>;
  /** Escopo de um caso (aba Financeiro do caso). */
  legalCaseId?: string;
  /** Escopo de um processo (aba Financeiro do processo). */
  legalProcessId?: string;
  syncUrl?: boolean;
  /** Aba do Financeiro que fica na URL junto com a lista (`?aba=`). */
  urlTab?: FinanceTab;
  title?: string;
  description?: string;
  /** EXPORTAÇÃO: o botão "Exportar" desta lista entra aqui (a infraestrutura vem de outro pacote de trabalho). */
  exportAction?: ReactNode;
}) {
  const scope = legalProcessId ? { legalProcessId } : legalCaseId ? { legalCaseId } : {};
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery,
    initialResult,
    load: (q: AgreementListQuery) => listAgreementRowsAction(agreementQueryToInput(q, scope)),
    toSearch: syncUrl ? (q: AgreementListQuery) => withFinanceTab(agreementQueryToSearchParams(q), urlTab) : undefined,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState(query.search);
  const commitSearch = useDebouncedCallback((text: string) => setQuery({ ...query, search: text.trim(), page: 1 }));
  const page = result.ok ? result.data : undefined;
  // Sempre a linha ATUAL da página (recarregada do servidor depois de cada mudança).
  const selected = page?.items.find((r) => r.id === selectedId) ?? null;
  const newHref = legalProcessId
    ? `/financeiro/contratos/novo?processo=${legalProcessId}`
    : legalCaseId
      ? `/financeiro/contratos/novo?caso=${legalCaseId}`
      : "/financeiro/contratos/novo";
  const showCase = !legalCaseId && !legalProcessId;
  const showProcess = !legalProcessId;
  const fullFilters = showCase;
  const filtered = agreementQueryIsFiltered(query);
  const cta = (
    <Can permission="finance.manage">
      <ButtonLink href={newHref} size="sm" icon={<Plus className="size-4" aria-hidden />}>
        Novo contrato de honorários
      </ButtonLink>
    </Can>
  );
  const statusSelect = (
    <Select
      aria-label="Situação do contrato"
      placeholder="Todas as situações"
      options={STATUS_OPTIONS}
      value={query.status}
      onChange={(e) => setQuery({ ...query, status: e.target.value as AgreementListQuery["status"], page: 1 })}
      className={fullFilters ? "w-[190px]" : "h-8 w-[180px] text-[12.5px]"}
    />
  );

  return (
    <Panel>
      <PanelHeader
        title={title}
        description={description}
        actions={
          <div className="flex items-center gap-2">
            {!fullFilters && statusSelect}
            {/* EXPORTAÇÃO: o botão "Exportar" desta lista entra aqui (prop exportAction). */}
            {exportAction}
            {cta}
          </div>
        }
      />
      {fullFilters && (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-line px-5 py-3" role="search" aria-label="Filtrar contratos">
          <SearchInput
            aria-label="Buscar por cliente, título ou número CNJ"
            placeholder="Buscar por cliente, título ou número CNJ"
            className="w-[320px]"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              commitSearch(e.target.value);
            }}
          />
          {statusSelect}
          <PeriodFilter
            label="Data do contrato"
            from={query.periodFrom}
            to={query.periodTo}
            onChange={(from, to) => setQuery({ ...query, periodFrom: from, periodTo: to, page: 1 })}
          />
          <PeriodFilter
            label="Próximo vencimento"
            from={query.dueFrom}
            to={query.dueTo}
            onChange={(from, to) => setQuery({ ...query, dueFrom: from, dueTo: to, page: 1 })}
          />
          {filtered && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch("");
                setQuery(DEFAULT_AGREEMENT_QUERY);
              }}
            >
              Limpar filtros
            </Button>
          )}
        </div>
      )}
      <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {!result.ok ? (
          <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar os contratos." />
        ) : !page ? (
          <SkeletonRows rows={4} />
        ) : page.items.length === 0 ? (
          filtered ? (
            <EmptyState compact title="Nenhum contrato com estes filtros." />
          ) : (
            <EmptyState
              icon={FileSignature}
              title="Nenhum contrato de honorários registrado."
              description={legalProcessId ? "Crie o contrato deste processo e registre as parcelas." : "Crie o contrato do processo e registre as parcelas."}
              action={cta}
            />
          )
        ) : (
          <>
            <p className="border-b border-line px-5 py-2 text-[12px] text-muted" aria-live="polite">
              {pluralize(page.total, "contrato", "contratos")}
            </p>
            <Table caption={title}>
              <THead>
                <tr>
                  {showCase && <Th>Cliente / caso</Th>}
                  {showProcess && <Th>Processo</Th>}
                  <Th>Modelo</Th>
                  <Th className="text-right">Contratado</Th>
                  <Th className="text-right">Recebido</Th>
                  <Th className="text-right">Em aberto</Th>
                  <Th>Próx. vencimento</Th>
                  <Th>Situação</Th>
                  <Th>
                    <span className="sr-only">Abrir</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {page.items.map((r) => (
                  <Tr key={r.id} interactive onClick={() => setSelectedId(r.id)}>
                    {showCase && (
                      <Td className="max-w-[240px]">
                        <span className="block truncate font-medium text-foreground">{r.clientName || "—"}</span>
                        <Link href={`/casos/${r.legalCaseId}`} onClick={(e) => e.stopPropagation()} className="block truncate text-[12px] text-navy hover:underline underline-offset-2">
                          {r.caseTitle || "Abrir caso"}
                        </Link>
                      </Td>
                    )}
                    {showProcess && (
                      <Td className="max-w-[240px]">
                        <ProcessCell row={r} />
                      </Td>
                    )}
                    <Td className="text-[12.5px]">{r.feeModelName ?? <span className="text-subtle">Valores próprios</span>}</Td>
                    <Td className="text-right tabular">{formatCurrency(r.totals.contracted)}</Td>
                    <Td className="text-right tabular">{formatCurrency(r.totals.received)}</Td>
                    <Td className="text-right tabular">
                      {formatCurrency(r.totals.outstanding)}
                      {r.totals.overdue > 0 && <span className="block text-[11.5px] text-danger">{formatCurrency(r.totals.overdue)} em atraso</span>}
                    </Td>
                    <Td className="tabular text-muted">{r.nextDueDate ? formatDate(r.nextDueDate) : "—"}</Td>
                    <Td>
                      <StatusBadge status={r.status} labels={AGREEMENT_DB_STATUS_LABEL} tones={AGREEMENT_DB_STATUS_TONE} />
                    </Td>
                    <Td className="text-right">
                      {/* Botão de verdade: a linha clicável sozinha não abria pelo teclado nem por leitor de tela. */}
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Abrir contrato de ${r.clientName || r.processTitle || r.caseTitle || "honorários"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(r.id);
                        }}
                      >
                        Abrir
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page.page} pageSize={AGREEMENT_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={{ one: "contrato", many: "contratos" }} />
          </>
        )}
      </div>
      {selected && <AgreementDrawer agreement={selected} onClose={() => setSelectedId(null)} />}
    </Panel>
  );
}
