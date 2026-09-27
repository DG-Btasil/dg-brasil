"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { formatCurrency, formatCurrencyCompact } from "@/lib/formatting";
import type { CompositionPoint, MonthlyPoint } from "../utils";
import { CHART_AXIS_TICK, CHART_CURSOR, CHART_GRID_STROKE, CHART_LEGEND_STYLE, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_STYLE } from "./chart-theme";

const money = (v: unknown) => formatCurrency(Number(v));

export function MonthlyReceiptsChart({ data }: { data: MonthlyPoint[] }) {
  const summary = data.map((d) => `${d.label}: recebido ${formatCurrency(d.received)}, em aberto ${formatCurrency(d.open)}`).join("; ");
  return (
    <Panel>
      <PanelHeader title="Recebimentos por mês" description="Pagamentos recebidos e valores em aberto por mês de vencimento." as="h3" />
      <PanelBody>
        <figure>
          <div className="h-[220px]" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} strokeDasharray="0" />
                <XAxis dataKey="label" tick={CHART_AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID_STROKE }} />
                <YAxis tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => formatCurrencyCompact(v)} />
                <Tooltip formatter={money} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} cursor={CHART_CURSOR} />
                <Legend wrapperStyle={CHART_LEGEND_STYLE} iconType="square" iconSize={9} />
                <Bar dataKey="received" name="Recebido" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="open" name="Em aberto" fill="var(--chart-3)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="sr-only">{summary}</figcaption>
        </figure>
      </PanelBody>
    </Panel>
  );
}

export function CompositionChart({ data }: { data: CompositionPoint[] }) {
  const summary = data.map((d) => `${d.name}: ${formatCurrency(d.total)} em ${d.count} contrato(s)`).join("; ");
  return (
    <Panel>
      <PanelHeader title="Contratado por modelo" description="Total contratado por modelo de honorários." as="h3" />
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
                  <Tooltip formatter={money} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} cursor={CHART_CURSOR} />
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
