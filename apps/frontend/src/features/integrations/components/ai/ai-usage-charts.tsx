"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import {
  CHART_AXIS_TICK,
  CHART_CURSOR,
  CHART_GRID_STROKE,
  CHART_LEGEND_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from "@/features/finance/components/chart-theme";
import { formatCompact, formatDateShort, formatNumber, formatPercent, formatUsd } from "@/lib/formatting";
import type { AIUsage } from "@/types";

export interface AgentUsagePoint {
  name: string;
  tokens: number;
  costUsd: number;
}

const tokens = (v: unknown) => `${formatNumber(Number(v))} tokens`;

export function DailyUsageChart({ daily }: { daily: AIUsage["daily"] }) {
  const data = daily.map((d) => ({ label: formatDateShort(d.date), input: d.inputTokens, output: d.outputTokens }));
  const totalIn = daily.reduce((s, d) => s + d.inputTokens, 0);
  const totalOut = daily.reduce((s, d) => s + d.outputTokens, 0);
  const peak = daily.reduce((m, d) => (d.inputTokens + d.outputTokens > m.inputTokens + m.outputTokens ? d : m), daily[0]);
  return (
    <Panel>
      <PanelHeader title="Uso por dia" description="Tokens de entrada e de saída nos últimos 30 dias." as="h3" />
      <PanelBody>
        <figure>
          <div className="h-[220px]" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} />
                <XAxis dataKey="label" tick={CHART_AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID_STROKE }} interval={6} />
                <YAxis tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatCompact(v)} />
                <Tooltip formatter={tokens} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} />
                <Legend wrapperStyle={CHART_LEGEND_STYLE} iconType="square" iconSize={9} />
                <Area type="monotone" dataKey="input" name="Entrada" stroke="var(--chart-1)" strokeWidth={2} fill="var(--chart-1)" fillOpacity={0.08} />
                <Area type="monotone" dataKey="output" name="Saída" stroke="var(--chart-3)" strokeWidth={2} fill="var(--chart-3)" fillOpacity={0.12} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="sr-only">
            Nos últimos 30 dias: {formatNumber(totalIn)} tokens de entrada e {formatNumber(totalOut)} de saída.
            {peak ? ` Pico em ${formatDateShort(peak.date)}.` : ""}
          </figcaption>
        </figure>
      </PanelBody>
    </Panel>
  );
}

function HorizontalBars({ title, description, data, dataKey, format }: { title: string; description: string; data: AgentUsagePoint[]; dataKey: "tokens" | "costUsd"; format: (v: number) => string }) {
  const summary = data.map((d) => `${d.name}: ${format(d[dataKey])}`).join("; ");
  return (
    <Panel>
      <PanelHeader title={title} description={description} as="h3" />
      <PanelBody>
        <figure>
          <div className="h-[200px]" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap="30%">
                <CartesianGrid horizontal={false} stroke={CHART_GRID_STROKE} />
                <XAxis type="number" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={format} />
                <YAxis type="category" dataKey="name" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} width={150} />
                <Tooltip formatter={(v) => format(Number(v))} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} cursor={CHART_CURSOR} />
                <Bar dataKey={dataKey} name={title} fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="sr-only">{summary}</figcaption>
        </figure>
      </PanelBody>
    </Panel>
  );
}

export function TokensByAgentChart({ data }: { data: AgentUsagePoint[] }) {
  return <HorizontalBars title="Tokens por agente" description="Entrada e saída somadas, no mês." data={data} dataKey="tokens" format={formatCompact} />;
}

export function CostByAgentChart({ data }: { data: AgentUsagePoint[] }) {
  return <HorizontalBars title="Custo por agente" description="Custo estimado em dólares, no mês." data={data} dataKey="costUsd" format={formatUsd} />;
}

export function UsageByModelTable({ byModel }: { byModel: AIUsage["byModel"] }) {
  const total = byModel.reduce((s, m) => s + m.tokens, 0) || 1;
  return (
    <Panel>
      <PanelHeader title="Uso por modelo" description="Distribuição de tokens e custo estimado." as="h3" />
      <Table caption="Uso por modelo">
        <THead>
          <tr>
            <Th>Modelo</Th>
            <Th className="text-right">Tokens</Th>
            <Th className="text-right">Participação</Th>
            <Th className="text-right">Custo estimado</Th>
          </tr>
        </THead>
        <TBody>
          {byModel.map((m) => {
            const share = (m.tokens / total) * 100;
            return (
              <Tr key={m.model}>
                <Td>
                  <code className="text-[12.5px] text-foreground">{m.model}</code>
                </Td>
                <Td className="text-right tabular">{formatCompact(m.tokens)}</Td>
                <Td className="text-right">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-sunken">
                      <span className="block h-full rounded-full bg-navy-700" style={{ width: `${share}%` }} />
                    </span>
                    <span className="w-10 tabular">{formatPercent(share)}</span>
                  </span>
                </Td>
                <Td className="text-right tabular">{formatUsd(m.costUsd)}</Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </Panel>
  );
}
