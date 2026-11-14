import { formatCurrency } from "@/lib/formatting";
import type { FinanceTotals } from "@/server/domain/finance/dto";

/**
 * Fora dos totais por processo: contrato antigo, ligado só ao caso, ou de
 * processo excluído. Os números vêm somados do servidor (finance_summary,
 * 064). A Home e o Financeiro usam ESTAS duas funções: o aviso é o mesmo, com
 * os mesmos valores, nos dois lugares.
 */
export function hasOutsideTotals(outside: FinanceTotals): boolean {
  return outside.received !== 0 || outside.outstanding !== 0 || outside.contracted !== 0;
}

/** Parcelas de contratos em rascunho (071): fora do "Em aberto" até o contrato ser ativado. Mesma frase na Home e no Financeiro. */
export function hasDraftTotals(draft: FinanceTotals | undefined): draft is FinanceTotals {
  return !!draft && (draft.outstanding !== 0 || draft.openPayments !== 0);
}

export function draftTotalsNotice(draft: FinanceTotals): string {
  const parcelas = draft.openPayments === 1 ? "1 parcela" : `${draft.openPayments} parcelas`;
  return `Em contratos em rascunho: ${formatCurrency(draft.outstanding)} (${parcelas}). Esse valor fica fora do “Em aberto” e do “Em atraso” até o contrato ser ativado.`;
}

export function outsideTotalsNotice(outside: FinanceTotals): string {
  return `${formatCurrency(outside.received)} recebidos e ${formatCurrency(outside.outstanding)} em aberto estão em contratos antigos, ligados só ao caso, ou de processos excluídos. Esses valores não entram nos totais.`;
}
