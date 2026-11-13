"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { MoreHorizontal, Plus, ReceiptText } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCNJ, formatCurrency, formatDate, pluralize } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useServerList } from "@/lib/hooks/use-server-list";
import { usePermission } from "@/features/auth/hooks";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { MenuButton } from "@/components/ui/menu";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { listExpensesAction } from "@/server/domain/finance/actions";
import type { ExpenseCategory, ExpenseDTO, ExpenseStatus } from "@/server/domain/finance/dto";
import { EXPENSE_CATEGORIES, EXPENSE_STATUSES } from "@/server/domain/finance/schemas";
import { ExportButton, type ExportAction } from "@/features/export/export-button";
import { EXPENSE_CATEGORY_LABEL, EXPENSE_STATUS_LABEL, EXPENSE_STATUS_TONE } from "../labels";
import { DEFAULT_EXPENSE_QUERY, EXPENSE_PAGE_SIZE, expenseQueryToInput, expenseQueryToSearchParams, withFinanceTab, type ExpenseListQuery, type FinanceTab } from "../list-query";
import { useFinanceActions } from "../use-finance-actions";
import { ExpenseDialog, MarkExpensePaidDialog } from "./expense-dialogs";
import { ReasonDialog } from "./finance-dialogs";
import { PeriodFilter } from "./period-filter";

const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABEL[c] }));
const STATUS_OPTIONS = EXPENSE_STATUSES.map((s) => ({ value: s, label: EXPENSE_STATUS_LABEL[s] }));

type Modal = { kind: "new" } | { kind: "edit"; expense: ExpenseDTO } | { kind: "paid"; expense: ExpenseDTO } | { kind: "cancel"; expense: ExpenseDTO };

/**
 * Despesas (ADMIN): de um processo (aba Financeiro do processo) ou todas (aba
 * Despesas do Financeiro). Categoria, situação e período (data da despesa)
 * filtrados e paginados no servidor. Despesa nunca é apagada: cancelar exige
 * motivo e ela fica no histórico.
 */
export function ExpensesPanel({
  initialQuery,
  initialResult,
  processId,
  syncUrl = false,
  urlTab,
  title = "Despesas",
  description = "Custas, advogado contratado, perícia, audiência e outras despesas dos processos.",
  exportAction,
}: {
  initialQuery: ExpenseListQuery;
  initialResult: ActionResult<Page<ExpenseDTO>>;
  /** Escopo de um processo. */
  processId?: string;
  syncUrl?: boolean;
  urlTab?: FinanceTab;
  title?: string;
  description?: string;
  /** Server Action que exporta esta lista em planilha, com os filtros da tela. Sem ela, o botão não aparece. */
  exportAction?: ExportAction;
}) {
  const canManage = usePermission("finance.manage");
  const scope = processId ? { processId } : {};
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery,
    initialResult,
    load: (q: ExpenseListQuery) => listExpensesAction(expenseQueryToInput(q, scope)),
    toSearch: syncUrl ? (q: ExpenseListQuery) => withFinanceTab(expenseQueryToSearchParams(q), urlTab) : undefined,
  });
  const [modal, setModal] = useState<Modal | null>(null);
  const close = useCallback(() => setModal(null), []);
  // Depois de cada mudança a página recarrega do servidor (router.refresh em useFinanceActions):
  // a primeira página e os totais chegam novos pelas props.
  const reload = useCallback(() => undefined, []);
  const actions = useFinanceActions();
  const page = result.ok ? result.data : undefined;
  const filtered = !!(query.category || query.status || query.from || query.to);

  // Escopo montado de novo (e não o `scope` de cima): o mesmo objeto usado depois dos hooks impede o React Compiler de otimizar o painel.
  const exportButton = exportAction ? <ExportButton action={exportAction} input={expenseQueryToInput(query, processId ? { processId } : {})} size="sm" /> : null;
  const newButton = canManage ? (
    <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setModal({ kind: "new" })}>
      Nova despesa
    </Button>
  ) : null;

  return (
    <Panel>
      <PanelHeader
        title={title}
        description={description}
        actions={
          <div className="flex items-center gap-2">
            {exportButton}
            {newButton}
          </div>
        }
      />
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-line px-5 py-3" role="search" aria-label="Filtrar despesas">
        <Select
          aria-label="Categoria da despesa"
          placeholder="Todas as categorias"
          options={CATEGORY_OPTIONS}
          value={query.category}
          onChange={(e) => setQuery({ ...query, category: e.target.value as ExpenseCategory | "", page: 1 })}
          className="w-[200px]"
        />
        <Select
          aria-label="Situação da despesa"
          placeholder="Todas as situações"
          options={STATUS_OPTIONS}
          value={query.status}
          onChange={(e) => setQuery({ ...query, status: e.target.value as ExpenseStatus | "", page: 1 })}
          className="w-[180px]"
        />
        <PeriodFilter label="Data da despesa" from={query.from} to={query.to} onChange={(from, to) => setQuery({ ...query, from, to, page: 1 })} />
        {filtered && (
          <Button variant="ghost" onClick={() => setQuery(DEFAULT_EXPENSE_QUERY)}>
            Limpar filtros
          </Button>
        )}
      </div>
      <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {!result.ok ? (
          <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar as despesas." />
        ) : !page ? (
          <SkeletonRows rows={4} />
        ) : page.items.length === 0 ? (
          filtered ? (
            <EmptyState compact title="Nenhuma despesa com estes filtros." />
          ) : (
            <EmptyState icon={ReceiptText} title="Nenhuma despesa lançada." description={processId ? "Lance as custas e demais despesas deste processo." : "Lance as despesas a partir daqui ou da aba Financeiro do processo."} action={newButton} />
          )
        ) : (
          <>
            <p className="border-b border-line px-5 py-2 text-[12px] text-muted" aria-live="polite">
              {pluralize(page.total, "despesa", "despesas")}
            </p>
            <Table caption={title}>
              <THead>
                <tr>
                  {!processId && <Th>Processo</Th>}
                  <Th>Despesa</Th>
                  <Th>Data</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Situação</Th>
                  <Th>
                    <span className="sr-only">Ações</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {page.items.map((e) => {
                  const active = e.status !== "CANCELLED";
                  const items = canManage && active
                    ? [
                        ...(e.status === "OPEN" ? [{ key: "paid", label: "Marcar como paga", onSelect: () => setModal({ kind: "paid", expense: e }) }] : []),
                        { key: "edit", label: "Corrigir despesa", onSelect: () => setModal({ kind: "edit", expense: e }) },
                        { key: "cancel", label: "Cancelar despesa", onSelect: () => setModal({ kind: "cancel", expense: e }) },
                      ]
                    : [];
                  return (
                    <Tr key={e.id} className={active ? undefined : "text-muted"}>
                      {!processId && (
                        <Td className="max-w-[240px]">
                          <Link href={`/processos/${e.legalProcessId}?aba=financeiro`} className="block truncate text-[12.5px] font-medium text-navy hover:underline underline-offset-2">
                            {e.processTitle || "Abrir processo"}
                          </Link>
                          <span className="block truncate text-[11.5px] text-muted">
                            {[e.clientName, e.cnjNumber ? formatCNJ(e.cnjNumber) : undefined].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </Td>
                      )}
                      <Td className="max-w-[320px]">
                        <span className="block text-[12px] text-muted">{EXPENSE_CATEGORY_LABEL[e.category]}</span>
                        <span className={cn("block truncate", active ? "text-foreground" : "line-through")}>{e.description}</span>
                        {(e.supplier || e.reimbursable) && (
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                            {e.supplier}
                            {e.reimbursable && <Badge tone="info">Reembolsável</Badge>}
                          </span>
                        )}
                        {e.cancellationReason && <span className="block text-[11.5px] text-muted">Cancelada: {e.cancellationReason}</span>}
                      </Td>
                      <Td className="tabular text-muted">{formatDate(e.incurredOn)}</Td>
                      <Td className="text-right tabular">{formatCurrency(e.amount)}</Td>
                      <Td>
                        <StatusBadge status={e.status} labels={EXPENSE_STATUS_LABEL} tones={EXPENSE_STATUS_TONE} />
                        {e.paidOn && e.status === "PAID" && <span className="block text-[11.5px] text-muted">em {formatDate(e.paidOn)}</span>}
                      </Td>
                      <Td className="text-right">{items.length > 0 && <MenuButton label="Ações da despesa" icon={<MoreHorizontal className="size-4" aria-hidden />} items={items} />}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page.page} pageSize={EXPENSE_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={{ one: "despesa", many: "despesas" }} />
          </>
        )}
      </div>

      {modal?.kind === "new" && <ExpenseDialog processId={processId} onClose={close} onSaved={reload} />}
      {modal?.kind === "edit" && <ExpenseDialog expense={modal.expense} onClose={close} onSaved={reload} />}
      {modal?.kind === "paid" && <MarkExpensePaidDialog expense={modal.expense} onClose={close} onSaved={reload} />}
      {modal?.kind === "cancel" && (
        <ReasonDialog
          title="Cancelar despesa"
          description="A despesa cancelada não é apagada: fica no histórico, com o motivo, e sai dos totais."
          confirmLabel="Cancelar despesa"
          onConfirm={(reason) => actions.cancelExpense(modal.expense.id, reason)}
          onClose={close}
        />
      )}
    </Panel>
  );
}
