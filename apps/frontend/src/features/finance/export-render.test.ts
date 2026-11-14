import { createElement, type FunctionComponent, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ClientSession } from "@/lib/auth/types";
import type { Role } from "@/lib/permissions";
import type { ExportAction } from "@/features/export/export-button";

/**
 * "Exportar planilha" nas cinco listas do Financeiro, renderizadas no servidor
 * (sem navegador, sem banco): o botão aparece para o ADMIN só onde a página
 * passa a Server Action de exportação. As Server Actions e o roteador do Next
 * são trocados por dublês (aqui só importa o HTML).
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => "/financeiro", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/server/domain/finance/actions", () => {
  const ok = async () => ({ ok: true, data: undefined, requestId: "r" });
  const names = [
    "cancelExpenseAction",
    "cancelPaymentAction",
    "changeAgreementStatusAction",
    "createExpenseAction",
    "createPaymentAction",
    "createPaymentScheduleAction",
    "listAgreementRowsAction",
    "listExpensesAction",
    "listPaymentsAction",
    "listProcessFinanceAction",
    "listReceiptStatementAction",
    "listReceiptsAction",
    "listReceivablesAction",
    "registerAdjustmentAction",
    "registerReceiptAction",
    "registerReversalAction",
    "reopenAgreementAction",
    "updateAgreementAction",
    "updateExpenseAction",
    "updatePaymentAction",
  ];
  return Object.fromEntries(names.map((name) => [name, ok]));
});

const { AuthProvider } = await import("@/features/auth/session-context");
const { AgreementsPanel } = await import("./components/agreements-table");
const { ExpensesPanel } = await import("./components/expenses-panel");
const { ProcessFinanceTable } = await import("./components/process-finance-table");
const { ReceiptStatementPanel } = await import("./components/receipt-statement-panel");
const { ReceivablesPanel } = await import("./components/receivables-panel");
const { DEFAULT_AGREEMENT_QUERY, DEFAULT_EXPENSE_QUERY, DEFAULT_PROCESS_FINANCE_QUERY, DEFAULT_RECEIVABLE_QUERY } = await import("./list-query");

function html(role: Role, node: ReactElement): string {
  const session = { userId: "u1", role, surface: "INTERNAL" } as unknown as ClientSession;
  const Auth = AuthProvider as FunctionComponent<{ session: ClientSession }>;
  return renderToStaticMarkup(createElement(Auth, { session }, node));
}

const exportAction: ExportAction = async () => ({ ok: true, data: { fileName: "x.csv", content: "", rowCount: 0, total: 0, truncated: false, limit: 5000 }, requestId: "r" });
const empty = { ok: true as const, data: { items: [], page: 1, pageSize: 25, total: 0, hasMore: false }, requestId: "r" };
const receivables = { ...empty, data: { ...empty.data, totals: { count: 0, total: 0, overdue: 0, overdueCount: 0, outsideTotals: 0, draftTotal: 0, draftCount: 0 } } };
const statement = { ...empty, data: { ...empty.data, totals: { count: 0, received: 0, deducted: 0, net: 0 } } };
const statementQuery = { search: "", from: "2026-11-01", to: "2026-11-13", method: "" as const, kind: "" as const, page: 1 };

const panels = (action?: ExportAction): Record<string, ReactElement> => ({
  "por processo": createElement(ProcessFinanceTable, { initialQuery: DEFAULT_PROCESS_FINANCE_QUERY, initialResult: empty, exportAction: action }),
  contratos: createElement(AgreementsPanel, { initialQuery: DEFAULT_AGREEMENT_QUERY, initialResult: empty, exportAction: action }),
  "a receber": createElement(ReceivablesPanel, { initialQuery: DEFAULT_RECEIVABLE_QUERY, initialResult: receivables, exportAction: action }),
  recebimentos: createElement(ReceiptStatementPanel, { today: "2026-11-13", initialQuery: statementQuery, initialResult: statement, exportAction: action }),
  despesas: createElement(ExpensesPanel, { initialQuery: DEFAULT_EXPENSE_QUERY, initialResult: empty, exportAction: action }),
});

describe("Exportar planilha nas listas do Financeiro", () => {
  it("ADMIN vê o botão nas cinco listas quando a página passa a exportação", () => {
    for (const [name, panel] of Object.entries(panels(exportAction))) expect(html("ADMIN", panel), name).toContain("Exportar planilha");
  });

  it("sem a exportação (listas dentro do caso e do processo), o botão não aparece", () => {
    for (const [name, panel] of Object.entries(panels())) expect(html("ADMIN", panel), name).not.toContain("Exportar planilha");
  });

  it("quem não é ADMIN não vê o botão, mesmo com a exportação ligada", () => {
    for (const role of ["LAWYER", "ASSISTANT"] as const) {
      for (const [name, panel] of Object.entries(panels(exportAction))) expect(html(role, panel), `${role}: ${name}`).not.toContain("Exportar planilha");
    }
  });
});
