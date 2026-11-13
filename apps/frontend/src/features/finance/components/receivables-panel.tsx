"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CircleAlert, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCNJ, formatCurrency, formatDate, pluralize } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useDebouncedCallback, useServerList } from "@/lib/hooks/use-server-list";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, SearchInput } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { listReceivablesAction } from "@/server/domain/finance/actions";
import type { ReceivableItemDTO, ReceivablesDTO } from "@/server/domain/finance/dto";
import { PAYMENT_DB_STATUS_LABEL, PAYMENT_DB_STATUS_TONE, PAYMENT_TYPE_LABEL } from "../labels";
import {
  DEFAULT_RECEIVABLE_QUERY,
  RECEIVABLE_PAGE_SIZE,
  receivableQueryIsFiltered,
  receivableQueryToInput,
  receivableQueryToSearchParams,
  withFinanceTab,
  type ReceivableListQuery,
} from "../list-query";
import { PeriodFilter } from "./period-filter";

/** Onde a parcela é recebida: a aba Financeiro do processo (ou o caso, em contrato antigo). */
const hrefOf = (r: ReceivableItemDTO) => (r.legalProcessId ? `/processos/${r.legalProcessId}?aba=financeiro` : `/casos/${r.legalCaseId}?aba=financeiro`);

/**
 * "A receber" (ADMIN): parcelas em aberto com saldo, por vencimento, com as
 * vencidas em destaque. Busca, período e "só vencidas" filtrados no banco de
 * dados; o total do rodapé soma TODAS as páginas com os mesmos filtros (vem
 * somado de lá). O recebimento é registrado no contrato: a linha leva até ele.
 */
export function ReceivablesPanel({
  initialQuery,
  initialResult,
  exportAction,
}: {
  initialQuery: ReceivableListQuery;
  initialResult: ActionResult<ReceivablesDTO>;
  /** EXPORTAÇÃO: o botão "Exportar" desta lista entra aqui (a infraestrutura vem de outro pacote de trabalho). */
  exportAction?: ReactNode;
}) {
  const { query, setQuery, result, pending, retry } = useServerList<ReceivableListQuery, ReceivableItemDTO>({
    initialQuery,
    initialResult,
    load: (q: ReceivableListQuery) => listReceivablesAction(receivableQueryToInput(q)) as Promise<ActionResult<Page<ReceivableItemDTO>>>,
    toSearch: (q: ReceivableListQuery) => withFinanceTab(receivableQueryToSearchParams(q), "a-receber"),
  });
  const [search, setSearch] = useState(query.search);
  const commitSearch = useDebouncedCallback((text: string) => setQuery({ ...query, search: text.trim(), page: 1 }));
  // A lista devolve a página MAIS os totais de todas as páginas (ReceivablesDTO estende Page).
  const page = result.ok ? (result.data as ReceivablesDTO) : undefined;
  const filtered = receivableQueryIsFiltered(query);

  return (
    <Panel>
      <PanelHeader
        title="A receber"
        description="Parcelas em aberto, da mais antiga para a mais distante. Para registrar o recebimento, abra o contrato do processo."
        /* EXPORTAÇÃO: o botão "Exportar" desta lista entra aqui (prop exportAction). */
        actions={exportAction}
      />
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-line px-5 py-3" role="search" aria-label="Filtrar parcelas a receber">
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
        <PeriodFilter label="Vencimento" from={query.from} to={query.to} onChange={(from, to) => setQuery({ ...query, from, to, page: 1 })} />
        <Checkbox className="h-9 items-center" label="Só vencidas" checked={query.overdueOnly} onChange={(e) => setQuery({ ...query, overdueOnly: e.target.checked, page: 1 })} />
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setQuery(DEFAULT_RECEIVABLE_QUERY);
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>
      <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {!result.ok ? (
          <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar as parcelas a receber." />
        ) : !page ? (
          <SkeletonRows rows={5} />
        ) : page.items.length === 0 ? (
          filtered ? (
            <EmptyState compact title="Nenhuma parcela em aberto com estes filtros." />
          ) : (
            <EmptyState icon={Wallet} title="Nenhuma parcela em aberto." description="Quando um contrato tiver parcela a receber, ela aparece aqui pelo vencimento." />
          )
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-5 py-2.5 text-[12.5px]" aria-live="polite">
              <p className="text-muted">
                {pluralize(page.totals.count, "parcela em aberto", "parcelas em aberto")}
                {filtered ? " com estes filtros" : ""}
              </p>
              <p className="flex flex-wrap items-baseline gap-x-5">
                <span className="text-muted">
                  Total a receber <strong className="ml-1 tabular text-navy">{formatCurrency(page.totals.total)}</strong>
                </span>
                {page.totals.overdue > 0 && (
                  <span className="inline-flex items-center gap-1 text-danger">
                    <CircleAlert className="size-3.5" aria-hidden />
                    Vencido <strong className="ml-1 tabular">{formatCurrency(page.totals.overdue)}</strong>
                    <span className="text-muted">({pluralize(page.totals.overdueCount, "parcela", "parcelas")})</span>
                  </span>
                )}
              </p>
            </div>
            {page.totals.outsideTotals > 0 && (
              <p className="border-b border-line bg-surface-muted px-5 py-2 text-[12px] text-muted">
                {formatCurrency(page.totals.outsideTotals)} deste total estão em contratos antigos, ligados só ao caso, ou de processos excluídos. Esse valor não entra no “Em aberto” da visão geral.
              </p>
            )}
            <Table caption="Parcelas a receber">
              <THead>
                <tr>
                  <Th>Vencimento</Th>
                  <Th>Cliente / processo</Th>
                  <Th>Parcela</Th>
                  <Th className="text-right">Valor</Th>
                  <Th className="text-right">Recebido</Th>
                  <Th className="text-right">A receber</Th>
                  <Th>Situação</Th>
                  <Th>
                    <span className="sr-only">Abrir</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {page.items.map((r) => {
                  const overdue = r.status === "OVERDUE";
                  return (
                    <Tr key={r.paymentId} className={overdue ? "bg-danger-soft/40" : undefined}>
                      <Td className="whitespace-nowrap tabular">
                        <span className={overdue ? "font-medium text-danger" : "text-foreground"}>{r.dueDate ? formatDate(r.dueDate) : "Sem vencimento"}</span>
                        {overdue && r.daysOverdue !== undefined && <span className="block text-[11.5px] text-danger">há {pluralize(r.daysOverdue, "dia", "dias")}</span>}
                      </Td>
                      <Td className="max-w-[300px]">
                        <span className="block truncate font-medium text-foreground">{r.clientName || "—"}</span>
                        <span className="block truncate text-[12px] text-muted">{r.processTitle || r.caseTitle || "—"}</span>
                        {r.cnjNumber && <span className="block truncate font-mono text-[11.5px] tabular text-subtle">{formatCNJ(r.cnjNumber)}</span>}
                        {!r.inProcessTotals && <span className="block text-[11.5px] text-subtle">{r.legalProcessId ? "Processo excluído" : "Contrato antigo, do caso"}</span>}
                      </Td>
                      <Td className="max-w-[220px] text-[12.5px]">
                        <span className="block">{PAYMENT_TYPE_LABEL[r.paymentType]}</span>
                        {r.description && <span className="block truncate text-[12px] text-muted">{r.description}</span>}
                        {r.agreementStatus === "DRAFT" && <span className="block text-[11.5px] text-warning">Contrato em rascunho: ative para receber</span>}
                      </Td>
                      <Td className="text-right tabular">{formatCurrency(r.amount)}</Td>
                      <Td className="text-right tabular text-muted">{formatCurrency(r.receivedAmount)}</Td>
                      <Td className={cn("text-right tabular font-medium", overdue ? "text-danger" : "text-foreground")}>{formatCurrency(r.balance)}</Td>
                      <Td>
                        <StatusBadge status={r.status} labels={PAYMENT_DB_STATUS_LABEL} tones={PAYMENT_DB_STATUS_TONE} />
                      </Td>
                      <Td className="text-right">
                        <Link href={hrefOf(r)} className="text-[12.5px] font-medium text-navy-700 underline-offset-2 hover:underline" aria-label={`Abrir o contrato de ${r.clientName || r.processTitle || r.caseTitle || "honorários"}`}>
                          Abrir
                        </Link>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page.page} pageSize={RECEIVABLE_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={{ one: "parcela", many: "parcelas" }} />
          </>
        )}
      </div>
    </Panel>
  );
}
