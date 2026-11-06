import "server-only";

import { can } from "@/lib/permissions";
import { requireAppSession } from "@/server/auth/session";
import { getProcessFinanceAction } from "@/server/domain/finance/actions";

/**
 * Financeiro de um processo para a página do processo (Server Component).
 * Só ADMIN (`finance.view`): os demais recebem `undefined` e a aba nem
 * aparece. Uso:
 *
 *   const finance = await loadProcessFinance(id);
 *   {finance && <ProcessFinancePanel processId={id} initial={finance} />}
 */
export async function loadProcessFinance(processId: string) {
  const session = await requireAppSession();
  if (!can(session.role, "finance.view")) return undefined;
  return getProcessFinanceAction({ processId });
}
