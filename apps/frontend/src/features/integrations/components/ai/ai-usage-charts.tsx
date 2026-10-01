"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import {
  CHART_AXIS_TICK,
  CHART_CURSOR,
  CHART_GRID_STROKE,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from "@/features/finance/components/chart-theme";
import { formatDateShort, formatNumber, formatPercent } from "@/lib/formatting";
import type { AIUsage } from "@/types";

export interface AgentUsagePoint {
  name: string;
  runs: number;
}

const runsLabel = (v: unknown) => `${formatNumber(Number(v))} execuções`;

/** Execuções de agentes por dia (sem tokens nem custo). */
export function DailyUsageChart({ daily }: { daily: AIUsage["daily"] }) {
  const data = daily.map((d) => ({ label: formatDateShort(d.date), runs: d.runs }));
  const total = daily.reduce((s, d) => s + d.runs, 0);
  const peak = daily.reduce((m, d) => (d.runs > m.runs ? d : m), daily[0]);
  return (
    <Panel>
      <PanelHeader title="Execuções por dia" description="Execuções dos agentes nos últimos 30 dias." as="h3" />
      <PanelBody>
        <figure>
          <div className="h-[220px]" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} />
                <XAxis dataKey="label" tick={CHART_AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID_STROKE }} interval={6} />
                <YAxis tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => formatNumber(v)} />
                <Tooltip formatter={runsLabel} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} />
                <Area type="monotone" dataKey="runs" name="Execuções" stroke="var(--chart-1)" strokeWidth={2} fill="var(--chart-1)" fillOpacity={0.08} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="sr-only">
            Nos últimos 30 dias: {formatNumber(total)} execuções.
            {peak ? ` Pico em ${formatDateShort(peak.date)}.` : ""}
          </figcaption>
        </figure>
      </PanelBody>
    </Panel>
  );
}

/** Execuções por agente no mês. */
export function RunsByAgentChart({ data }: { data: AgentUsagePoint[] }) {
  const summary = data.map((d) => `${d.name}: ${formatNumber(d.runs)}`).join("; ");
  return (
    <Panel>
      <PanelHeader title="Execuções por agente" description="No mês corrente." as="h3" />
      <PanelBody>
        <figure>
          <div className="h-[200px]" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap="30%">
                <CartesianGrid horizontal={false} stroke={CHART_GRID_STROKE} />
                <XAxis type="number" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatNumber(v)} />
                <YAxis type="category" dataKey="name" tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} width={150} />
                <Tooltip formatter={runsLabel} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} cursor={CHART_CURSOR} />
                <Bar dataKey="runs" name="Execuções" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="sr-only">{summary}</figcaption>
        </figure>
      </PanelBody>
    </Panel>
  );
}

export function UsageByModelTable({ byModel }: { byModel: AIUsage["byModel"] }) {
  const total = byModel.reduce((s, m) => s + m.runs, 0) || 1;
  return (
    <Panel>
      <PanelHeader title="Uso por modelo" description="Distribuição das execuções entre os modelos configurados." as="h3" />
      <Table caption="Uso por modelo">
        <THead>
          <tr>
            <Th>Modelo</Th>
            <Th className="text-right">Execuções</Th>
            <Th className="text-right">Participação</Th>
          </tr>
        </THead>
        <TBody>
          {byModel.map((m) => {
            const share = (m.runs / total) * 100;
            return (
              <Tr key={m.model}>
                <Td>
                  <code className="text-[12.5px] text-foreground">{m.model}</code>
                </Td>
                <Td className="text-right tabular">{formatNumber(m.runs)}</Td>
                <Td className="text-right">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-sunken">
                      <span className="block h-full rounded-full bg-navy-700" style={{ width: `${share}%` }} />
                    </span>
                    <span className="w-10 tabular">{formatPercent(share)}</span>
                  </span>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </Panel>
  );
}
