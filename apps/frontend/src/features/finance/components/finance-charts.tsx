"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { formatCurrency, formatCurrencyCompact, pluralize } from "@/lib/formatting";
import type { ReceivableAgingBucket } from "@/server/domain/finance/aging";
import type { ContractedByModelPoint, ExpenseCategoryPoint, ReceivableAgingDTO } from "@/server/domain/finance/dto";
import { EXPENSE_CATEGORY_LABEL } from "../labels";
import { CHART_AXIS_TICK, CHART_CURSOR, CHART_GRID_STROKE, CHART_LEGEND_STYLE, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_STYLE } from "./chart-theme";

const MONTH_LABEL = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
const label = (month: string) => MONTH_LABEL.format(new Date(`${month}-01T00:00:00Z`)).replace(". de ", "/").replace(".", "");

/** Recebido líquido por mês (servidor: entradas − estornos ± ajustes, fuso de São Paulo). */
export function MonthlyReceiptsChart({ data }: { data: { month: string; amount: number }[] }) {
  const points = data.map((d) => ({ label: label(d.month), amount: d.amount }));
  const summary = points.map((d) => `${d.label}: ${formatCurrency(d.amount)}`).join("; ");
  return (
    <Panel>
      <PanelHeader title="Recebido por mês" description="Valor líquido lançado no ledger nos últimos 12 meses." as="h3" />
      <PanelBody>
        <figure>
          <div className="h-[220px]" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart accessibilityLayer={false} data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} strokeDasharray="0" />
                <XAxis dataKey="label" tick={CHART_AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID_STROKE }} />
                <YAxis tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => formatCurrencyCompact(v)} />
                <Tooltip formatter={(v: unknown) => formatCurrency(Number(v))} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} cursor={CHART_CURSOR} />
                <Bar dataKey="amount" name="Recebido" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="sr-only">{summary}</figcaption>
        </figure>
      </PanelBody>
    </Panel>
  );
}

/** Contratado por modelo de honorários (4.3.1): somado no banco; obrigações não canceladas de acordos não cancelados. */
export function CompositionChart({ data }: { data: ContractedByModelPoint[] }) {
  const summary = data.map((d) => `${d.name}: ${formatCurrency(d.total)} em ${d.count} contrato(s)`).join("; ");
  return (
    <Panel>
      <PanelHeader title="Contratado por modelo" description="Total contratado (obrigações) por modelo de honorários." as="h3" />
      <PanelBody>
        {data.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted">Sem contratos ativos para compor.</p>
        ) : (
          <figure>
            <div className="h-[220px]" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart accessibilityLayer={false} data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap="30%">
                  <CartesianGrid horizontal={false} stroke={CHART_GRID_STROKE} />
                  <XAxis type="number" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCurrencyCompact(v)} />
                  <YAxis type="category" dataKey="name" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} width={150} />
                  <Tooltip formatter={(v: unknown) => formatCurrency(Number(v))} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} cursor={CHART_CURSOR} />
                  <Bar dataKey="total" name="Contratado" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <figcaption className="sr-only">{summary}</figcaption>
          </figure>
        )}
      </PanelBody>
    </Panel>
  );
}

/** Faixas do "A receber por vencimento": rótulo curto no eixo e completo no resumo/dica. */
const AGING_LABEL: Record<ReceivableAgingBucket | "UNDATED", { short: string; full: string }> = {
  OVERDUE: { short: "Em atraso", full: "Em atraso" },
  UP_TO_30: { short: "Até 30 dias", full: "Vence em até 30 dias" },
  DAYS_31_60: { short: "31 a 60", full: "Vence em 31 a 60 dias" },
  DAYS_61_90: { short: "61 a 90", full: "Vence em 61 a 90 dias" },
  OVER_90: { short: "Acima de 90", full: "Vence em mais de 90 dias" },
  UNDATED: { short: "Sem vencimento", full: "Sem data de vencimento" },
};

/**
 * A receber por vencimento (E-06): saldo em aberto dos contratos de processo
 * por faixa, somado no servidor (fuso de São Paulo). "Em atraso" no tom de
 * perigo; obrigação sem vencimento só aparece se houver.
 */
export function ReceivableAgingChart({ data }: { data: ReceivableAgingDTO }) {
  const points = [
    ...data.buckets.map((b) => ({ key: b.bucket, amount: b.amount, count: b.count })),
    ...(data.undated.count > 0 ? [{ key: "UNDATED" as const, amount: data.undated.amount, count: data.undated.count }] : []),
  ].map((p) => ({
    ...p,
    label: AGING_LABEL[p.key].short,
    full: AGING_LABEL[p.key].full,
    color: p.key === "OVERDUE" ? "var(--danger)" : p.key === "UNDATED" ? "var(--chart-6)" : "var(--chart-1)",
  }));
  const fullByLabel = new Map(points.map((p) => [p.label, p.full]));
  const summary = [
    ...points.map((p) => `${p.full}: ${formatCurrency(p.amount)} em ${pluralize(p.count, "obrigação", "obrigações")}`),
    `Total em aberto: ${formatCurrency(data.total)}`,
  ].join("; ");
  return (
    <Panel>
      <PanelHeader title="A receber por vencimento" description="Saldo em aberto pelo vencimento. Só contratos de processo, como os totais acima." as="h3" />
      <PanelBody>
        {data.total <= 0 ? (
          <p className="py-10 text-center text-[13px] text-muted">Nenhuma obrigação em aberto para receber.</p>
        ) : (
          <figure>
            <div className="h-[220px]" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart accessibilityLayer={false} data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} strokeDasharray="0" />
                  <XAxis dataKey="label" tick={CHART_AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID_STROKE }} interval={0} />
                  <YAxis tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => formatCurrencyCompact(v)} />
                  <Tooltip
                    formatter={(v: unknown) => [formatCurrency(Number(v)), "Em aberto"]}
                    labelFormatter={(label: unknown) => fullByLabel.get(String(label)) ?? String(label)}
                    contentStyle={CHART_TOOLTIP_STYLE}
                    labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                    cursor={CHART_CURSOR}
                  />
                  <Bar dataKey="amount" name="Em aberto" radius={[4, 4, 0, 0]} maxBarSize={36}>
                    {points.map((p) => (
                      <Cell key={p.key} fill={p.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <figcaption className="sr-only">{summary}</figcaption>
          </figure>
        )}
      </PanelBody>
    </Panel>
  );
}

/** Despesas por categoria (046), últimos 12 meses pela data da despesa: pagas × a pagar, empilhadas. */
export function ExpensesByCategoryChart({ data }: { data: ExpenseCategoryPoint[] }) {
  const points = data.map((d) => ({ name: EXPENSE_CATEGORY_LABEL[d.category], paid: d.paid, open: d.open }));
  const summary = data.map((d) => `${EXPENSE_CATEGORY_LABEL[d.category]}: ${formatCurrency(d.paid)} pagas e ${formatCurrency(d.open)} a pagar`).join("; ");
  return (
    <Panel>
      <PanelHeader title="Despesas por categoria" description="Últimos 12 meses, pela data da despesa. Canceladas não entram." as="h3" />
      <PanelBody>
        {data.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted">Nenhuma despesa lançada nos últimos 12 meses.</p>
        ) : (
          <figure>
            <div style={{ height: Math.max(160, points.length * 38 + 48) }} aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart accessibilityLayer={false} data={points} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap="30%">
                  <CartesianGrid horizontal={false} stroke={CHART_GRID_STROKE} />
                  <XAxis type="number" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCurrencyCompact(v)} />
                  <YAxis type="category" dataKey="name" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} width={150} />
                  <Tooltip formatter={(v: unknown) => formatCurrency(Number(v))} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} cursor={CHART_CURSOR} />
                  <Legend wrapperStyle={CHART_LEGEND_STYLE} iconType="circle" iconSize={8} />
                  <Bar dataKey="paid" name="Pagas" stackId="e" fill="var(--chart-2)" maxBarSize={16} />
                  <Bar dataKey="open" name="A pagar" stackId="e" fill="var(--chart-7)" radius={[0, 4, 4, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <figcaption className="sr-only">{summary}</figcaption>
          </figure>
        )}
      </PanelBody>
    </Panel>
  );
}

/**
 * Recebido × despesas pagas por mês (regime de caixa): recebido líquido do
 * ledger (fuso de São Paulo) e despesas pela data do pagamento. Os dois vêm
 * do servidor com os mesmos 12 meses.
 */
export function ReceivedVsExpensesChart({ received, expenses }: { received: { month: string; amount: number }[]; expenses: { month: string; amount: number }[] }) {
  const paid = new Map(expenses.map((e) => [e.month, e.amount]));
  const points = received.map((r) => ({ label: label(r.month), received: r.amount, expenses: paid.get(r.month) ?? 0 }));
  const summary = points.map((d) => `${d.label}: recebido ${formatCurrency(d.received)}, despesas ${formatCurrency(d.expenses)}`).join("; ");
  return (
    <Panel>
      <PanelHeader title="Recebido × despesas por mês" description="Recebido líquido e despesas pagas nos últimos 12 meses." as="h3" />
      <PanelBody>
        <figure>
          <div className="h-[240px]" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart accessibilityLayer={false} data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="24%" barGap={2}>
                <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} strokeDasharray="0" />
                <XAxis dataKey="label" tick={CHART_AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID_STROKE }} />
                <YAxis tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => formatCurrencyCompact(v)} />
                <Tooltip formatter={(v: unknown) => formatCurrency(Number(v))} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} cursor={CHART_CURSOR} />
                <Legend wrapperStyle={CHART_LEGEND_STYLE} iconType="circle" iconSize={8} />
                <Bar dataKey="received" name="Recebido" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={16} />
                <Bar dataKey="expenses" name="Despesas pagas" fill="var(--chart-9)" radius={[4, 4, 0, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="sr-only">{summary}</figcaption>
        </figure>
      </PanelBody>
    </Panel>
  );
}
