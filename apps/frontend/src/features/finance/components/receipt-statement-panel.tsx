"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { HandCoins } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCNJ, formatCurrency, formatDate, pluralize } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useDebouncedCallback, useServerList } from "@/lib/hooks/use-server-list";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { listReceiptStatementAction } from "@/server/domain/finance/actions";
import type { ReceiptKind, ReceiptStatementDTO, ReceiptStatementItemDTO } from "@/server/domain/finance/dto";
import { RECEIPT_KINDS, RECEIPT_METHODS } from "@/server/domain/finance/schemas";
import { PAYMENT_TYPE_LABEL, RECEIPT_KIND_LABEL, RECEIPT_METHOD_LABEL } from "../labels";
import {
  RECEIPT_STATEMENT_PAGE_SIZE,
  monthStart,
  receiptStatementQueryToInput,
  receiptStatementQueryToSearchParams,
  withFinanceTab,
  type ReceiptStatementQuery,
} from "../list-query";
import { PeriodFilter } from "./period-filter";

const METHOD_OPTIONS = RECEIPT_METHODS.map((m) => ({ value: m, label: RECEIPT_METHOD_LABEL[m] }));
const KIND_OPTIONS = RECEIPT_KINDS.map((k) => ({ value: k, label: RECEIPT_KIND_LABEL[k] }));
const KIND_TONE: Record<ReceiptKind, "success" | "warning" | "danger"> = { RECEIPT: "success", ADJUSTMENT: "warning", REVERSAL: "danger" };

const hrefOf = (r: ReceiptStatementItemDTO) => (r.legalProcessId ? `/processos/${r.legalProcessId}?aba=financeiro` : `/casos/${r.legalCaseId}?aba=financeiro`);

function periodLabel(q: ReceiptStatementQuery): string {
  if (q.from && q.to) return `de ${formatDate(q.from)} a ${formatDate(q.to)}`;
  if (q.from) return `a partir de ${formatDate(q.from)}`;
  if (q.to) return `até ${formatDate(q.to)}`;
  return "todo o período";
}

/**
 * Recebimentos (ADMIN): extrato do livro de lançamentos por período, com o
 * cliente, o processo, a forma e o valor de cada um. O período é o DIA do
 * lançamento. Filtros e páginas no banco de dados; o total do período soma
 * TODAS as páginas com os mesmos filtros (vem somado de lá), com estornos e
 * ajustes para menos descontados. Abre no mês corrente.
 */
export function ReceiptStatementPanel({
  initialQuery,
  initialResult,
  today,
  exportAction,
}: {
  initialQuery: ReceiptStatementQuery;
  initialResult: ActionResult<ReceiptStatementDTO>;
  /** Hoje em São Paulo (YYYY-MM-DD), vindo do servidor: o mesmo dia na primeira pintura e no navegador. */
  today: string;
  /** EXPORTAÇÃO: o botão "Exportar" desta lista entra aqui (a infraestrutura vem de outro pacote de trabalho). */
  exportAction?: ReactNode;
}) {
  const { query, setQuery, result, pending, retry } = useServerList<ReceiptStatementQuery, ReceiptStatementItemDTO>({
    initialQuery,
    initialResult,
    load: (q: ReceiptStatementQuery) => listReceiptStatementAction(receiptStatementQueryToInput(q)) as Promise<ActionResult<Page<ReceiptStatementItemDTO>>>,
    toSearch: (q: ReceiptStatementQuery) => withFinanceTab(receiptStatementQueryToSearchParams(q), "recebimentos"),
  });
  const [search, setSearch] = useState(query.search);
  const commitSearch = useDebouncedCallback((text: string) => setQuery({ ...query, search: text.trim(), page: 1 }));
  // A lista devolve a página MAIS o total do período inteiro (ReceiptStatementDTO estende Page).
  const page = result.ok ? (result.data as ReceiptStatementDTO) : undefined;
  const thisMonth = query.from === monthStart(today) && query.to === today;
  const narrowed = !!(query.search || query.method || query.kind);

  return (
    <Panel>
      <PanelHeader
        title="Recebimentos"
        description="Extrato do que entrou, por período: recebimentos, ajustes e estornos, com cliente, processo e forma."
        /* EXPORTAÇÃO: o botão "Exportar" desta lista entra aqui (prop exportAction). */
        actions={exportAction}
      />
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-line px-5 py-3" role="search" aria-label="Filtrar recebimentos">
        <PeriodFilter label="Período" from={query.from} to={query.to} max={today} onChange={(from, to) => setQuery({ ...query, from, to, page: 1 })} />
        <SearchInput
          aria-label="Buscar por cliente, título ou número CNJ"
          placeholder="Buscar por cliente, título ou número CNJ"
          className="w-[300px]"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            commitSearch(e.target.value);
          }}
        />
        <Select
          aria-label="Forma de recebimento"
          placeholder="Todas as formas"
          options={METHOD_OPTIONS}
          value={query.method}
          onChange={(e) => setQuery({ ...query, method: e.target.value as ReceiptStatementQuery["method"], page: 1 })}
          className="w-[160px]"
        />
        <Select
          aria-label="Tipo de lançamento"
          placeholder="Todos os tipos"
          options={KIND_OPTIONS}
          value={query.kind}
          onChange={(e) => setQuery({ ...query, kind: e.target.value as ReceiptKind | "", page: 1 })}
          className="w-[160px]"
        />
        {!thisMonth && (
          <Button variant="ghost" onClick={() => setQuery({ ...query, from: monthStart(today), to: today, page: 1 })}>
            Este mês
          </Button>
        )}
        {(query.from || query.to) && (
          <Button variant="ghost" onClick={() => setQuery({ ...query, from: "", to: "", page: 1 })}>
            Todo o período
          </Button>
        )}
      </div>
      <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {!result.ok ? (
          <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar o extrato de recebimentos." />
        ) : !page ? (
          <SkeletonRows rows={5} />
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-5 py-2.5 text-[12.5px]" aria-live="polite">
              <p className="text-muted">
                {pluralize(page.totals.count, "lançamento", "lançamentos")} {periodLabel(query)}
                {narrowed ? ", com estes filtros" : ""}
              </p>
              <p className="flex flex-wrap items-baseline gap-x-5">
                {page.totals.deducted < 0 && (
                  <>
                    <span className="text-muted">
                      Entradas <span className="ml-1 tabular text-foreground">{formatCurrency(page.totals.received)}</span>
                    </span>
                    <span className="text-muted">
                      Estornos e ajustes <span className="ml-1 tabular text-danger">{formatCurrency(page.totals.deducted)}</span>
                    </span>
                  </>
                )}
                <span className="text-muted">
                  Total do período <strong className="ml-1 tabular text-navy">{formatCurrency(page.totals.net)}</strong>
                </span>
              </p>
            </div>
            {page.items.length === 0 ? (
              narrowed ? (
                <EmptyState compact title="Nenhum lançamento com estes filtros neste período." />
              ) : (
                <EmptyState icon={HandCoins} title="Nenhum recebimento neste período." description="Mude o período ou registre os recebimentos no contrato do processo." />
              )
            ) : (
              <>
                <Table caption="Extrato de recebimentos">
                  <THead>
                    <tr>
                      <Th>Data</Th>
                      <Th>Cliente / processo</Th>
                      <Th>Lançamento</Th>
                      <Th>Forma</Th>
                      <Th className="text-right">Valor</Th>
                      <Th>
                        <span className="sr-only">Abrir</span>
                      </Th>
                    </tr>
                  </THead>
                  <TBody>
                    {page.items.map((r) => (
                      <Tr key={r.receiptId}>
                        <Td className="whitespace-nowrap tabular text-muted">{formatDate(r.occurredOn)}</Td>
                        <Td className="max-w-[320px]">
                          <span className="block truncate font-medium text-foreground">{r.clientName || "—"}</span>
                          <span className="block truncate text-[12px] text-muted">{r.processTitle || r.caseTitle || "—"}</span>
                          {r.cnjNumber && <span className="block truncate font-mono text-[11.5px] tabular text-subtle">{formatCNJ(r.cnjNumber)}</span>}
                        </Td>
                        <Td className="max-w-[280px] text-[12.5px]">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={KIND_TONE[r.kind]}>{RECEIPT_KIND_LABEL[r.kind]}</Badge>
                            <span className="tabular text-subtle">#{r.sequence}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-[12px] text-muted">
                            {PAYMENT_TYPE_LABEL[r.paymentType]}
                            {r.paymentDescription ? ` · ${r.paymentDescription}` : ""}
                          </span>
                          {r.notes && <span className="block truncate text-[12px] text-muted">{r.notes}</span>}
                        </Td>
                        <Td className="text-[12.5px]">{r.method ? (RECEIPT_METHOD_LABEL[r.method as keyof typeof RECEIPT_METHOD_LABEL] ?? r.method) : <span className="text-subtle">—</span>}</Td>
                        <Td className={cn("text-right tabular font-medium", r.amount < 0 ? "text-danger" : "text-foreground")}>{formatCurrency(r.amount)}</Td>
                        <Td className="text-right">
                          <Link href={hrefOf(r)} className="text-[12.5px] font-medium text-navy-700 underline-offset-2 hover:underline" aria-label={`Abrir o contrato de ${r.clientName || r.processTitle || r.caseTitle || "honorários"}`}>
                            Abrir
                          </Link>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                <Pagination page={page.page} pageSize={RECEIPT_STATEMENT_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={{ one: "lançamento", many: "lançamentos" }} />
              </>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
