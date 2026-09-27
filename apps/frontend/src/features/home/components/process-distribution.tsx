"use client";

import { PieChart as PieIcon } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { EmptyState } from "@/components/feedback/states";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { PROCESS_STATUS_LABEL } from "@/lib/constants/status";
import { formatNumber, formatPercent } from "@/lib/formatting";
import { useProcessDistribution, type StatusSlice } from "../hooks";

function sliceLabel(slice: StatusSlice): string {
  if (slice.key === "OTHER") return "Outros status";
  return PROCESS_STATUS_LABEL[slice.statuses[0]!];
}

function sliceDetail(slice: StatusSlice): string | undefined {
  if (slice.key !== "OTHER") return undefined;
  return slice.statuses.map((s) => PROCESS_STATUS_LABEL[s]).join(", ");
}

/** Donut "Distribuição dos processos" com legenda acessível. */
export function ProcessDistribution() {
  const { slices, total } = useProcessDistribution();
  const data = slices.map((s) => ({ name: sliceLabel(s), value: s.count, color: s.color }));

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader title="Distribuição dos processos" description="Por status, incluindo encerrados" />
      {total === 0 ? (
        <EmptyState compact icon={PieIcon} title="Nenhum processo cadastrado" description="Os processos aparecerão aqui assim que forem criados ou importados." />
      ) : (
        <PanelBody className="flex flex-1 flex-col gap-5">
          <div className="relative mx-auto h-[190px] w-[190px]" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={88}
                  paddingAngle={1.5}
                  stroke="var(--surface)"
                  strokeWidth={2}
                  startAngle={90}
                  endAngle={-270}
                  isAnimationActive={false}
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => [formatNumber(Number(value)), "Processos"]}
                  contentStyle={{ borderRadius: 6, border: "1px solid var(--line)", fontSize: 12, boxShadow: "none" }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-serif text-[30px] font-medium leading-none tabular text-navy">{formatNumber(total)}</span>
              <span className="mt-1 text-[11.5px] text-muted">processos</span>
            </div>
          </div>
          <ul aria-label={`Distribuição de ${total} processos por status`} className="divide-y divide-line border-t border-line">
            {slices.map((s) => (
              <li key={s.key} className="flex items-center gap-2.5 py-2 text-[12.5px]">
                <span aria-hidden className="size-2.5 shrink-0 rounded-xs" style={{ background: s.color }} />
                <span className="min-w-0 flex-1">
                  <span className="text-foreground">{sliceLabel(s)}</span>
                  {sliceDetail(s) && <span className="block truncate text-[11.5px] text-subtle">{sliceDetail(s)}</span>}
                </span>
                <span className="tabular font-medium text-foreground">{formatNumber(s.count)}</span>
                <span className="w-10 text-right tabular text-subtle">{formatPercent((s.count / total) * 100)}</span>
              </li>
            ))}
          </ul>
        </PanelBody>
      )}
    </Panel>
  );
}
