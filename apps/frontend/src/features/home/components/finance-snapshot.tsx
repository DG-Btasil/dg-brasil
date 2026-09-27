"use client";

import Link from "next/link";
import { ArrowRight, CircleAlert } from "lucide-react";
import { formatCurrency, pluralize } from "@/lib/formatting";
import { useFinanceSnapshot } from "../hooks";

/**
 * Bloco financeiro compacto. Só deve ser montado dentro de <Can permission="finance.view">:
 * nenhum valor de honorários chega ao DOM de quem não tem a permissão.
 */
export function FinanceSnapshot() {
  const f = useFinanceSnapshot();
  const items = [
    { label: "A receber", value: formatCurrency(f.receivable), hint: "Parcelas em aberto dos contratos ativos" },
    {
      label: "Em atraso",
      value: formatCurrency(f.overdue),
      hint: f.overdueAgreements > 0 ? pluralize(f.overdueAgreements, "contrato com atraso", "contratos com atraso") : "Nenhum contrato em atraso",
      alert: f.overdue > 0,
    },
    { label: "Recebido no mês", value: formatCurrency(f.receivedThisMonth), hint: "Pagamentos registrados neste mês" },
  ];
  return (
    <section aria-labelledby="home-finance-title" className="mt-4 rounded-lg border border-line bg-surface shadow-hairline">
      <div className="flex items-stretch divide-x divide-line">
        <div className="flex w-[220px] shrink-0 flex-col justify-center px-5 py-4">
          <p className="eyebrow">Somente administradores</p>
          <h2 id="home-finance-title" className="mt-1 text-[14px] font-semibold text-foreground">
            Financeiro
          </h2>
          <Link href="/financeiro" className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-navy-700 hover:underline underline-offset-2">
            Abrir Financeiro <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        <dl className="grid flex-1 grid-cols-3 divide-x divide-line">
          {items.map((item) => (
            <div key={item.label} className="px-5 py-4">
              <dt className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
                {item.label}
                {item.alert && (
                  <span className="inline-flex items-center gap-1 text-danger">
                    <CircleAlert className="size-3.5" aria-hidden />
                    <span className="text-[11.5px]">requer atenção</span>
                  </span>
                )}
              </dt>
              <dd className="mt-1.5 text-[20px] font-semibold tabular text-navy">{item.value}</dd>
              <dd className="mt-0.5 text-[12px] text-muted">{item.hint}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
