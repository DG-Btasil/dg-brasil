"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { formatCurrency, formatCurrencyCompact } from "@/lib/formatting";
import type { ContractedByModelPoint } from "@/server/domain/finance/dto";
import { CHART_AXIS_TICK, CHART_CURSOR, CHART_GRID_STROKE, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_STYLE } from "./chart-theme";

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
              <BarChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
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
                <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap="30%">
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
