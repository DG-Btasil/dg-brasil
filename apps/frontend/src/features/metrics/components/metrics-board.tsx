"use client";

import { Children, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { cn } from "@/lib/cn";
import { ACQUISITION_CHANNEL_LABEL, isAcquisitionChannel } from "@/lib/constants/legal";
import { LEGAL_CASE_STATUS_LABEL, LEGAL_CASE_STATUSES, PROCESS_PHASE_LABEL, PROCESS_PHASES, PROCESS_STATUS_LABEL, PROCESS_STATUSES } from "@/lib/constants/status";
import { formatCurrency, formatCurrencyCompact, formatNumber } from "@/lib/formatting";
import { getDashboardMetricsAction } from "@/server/domain/metrics/actions";
import { METRIC_PERIOD_LABEL, METRIC_PERIODS, type DashboardMetricsDTO, type Keyed, type MetricPeriod, type MetricsPoint } from "@/server/domain/metrics/dto";
import { CHART_AXIS_TICK, CHART_CURSOR, CHART_GRID_STROKE, CHART_LEGEND_STYLE, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_STYLE } from "@/features/finance/components/chart-theme";

export type MetricsVariant = "home" | "clients" | "cases" | "processes" | "partners" | "portal-home" | "portal-finance";

/**
 * Indicadores e gráficos das abas (Roadmap 2.0): números do período escolhido
 * (7/30/90 dias, 12 meses, tudo), somados no banco com a RLS de quem vê.
 * Cada aba mostra o recorte que importa para ela.
 */
export function MetricsBoard({ variant, initial, initialPeriod = "30", title }: { variant: MetricsVariant; initial: ActionResult<DashboardMetricsDTO>; initialPeriod?: MetricPeriod; title?: string }) {
  const [period, setPeriod] = useState<MetricPeriod>(initialPeriod);
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(false);

  async function choose(next: MetricPeriod) {
    if (next === period) return;
    setPeriod(next);
    setLoading(true);
    setResult(await callAction(() => getDashboardMetricsAction({ period: next })));
    setLoading(false);
  }

  return (
    <section aria-label={title ?? "Indicadores"} className={cn("mb-6 space-y-4 transition-opacity", loading && "opacity-60")} aria-busy={loading || undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-foreground">{title ?? "Indicadores"}</h2>
        <PeriodFilter value={period} onChange={choose} />
      </div>
      {!result.ok ? (
        <p className="text-[13px] text-muted">Não foi possível calcular os indicadores agora.</p>
      ) : (
        <Variant variant={variant} m={result.data} />
      )}
    </section>
  );
}

function PeriodFilter({ value, onChange }: { value: MetricPeriod; onChange: (p: MetricPeriod) => void }) {
  return (
    <div role="radiogroup" aria-label="Período" className="inline-flex rounded-md border border-line bg-surface p-0.5 shadow-hairline">
      {METRIC_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          onClick={() => onChange(p)}
          className={cn(
            "rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
            value === p ? "bg-navy text-white" : "text-muted hover:bg-surface-muted hover:text-foreground",
          )}
        >
          {METRIC_PERIOD_LABEL[p]}
        </button>
      ))}
    </div>
  );
}

function Variant({ variant, m }: { variant: MetricsVariant; m: DashboardMetricsDTO }) {
  const inPeriod = "no período";
  switch (variant) {
    case "clients":
      return (
        <>
          <Tiles
            items={[
              { label: "Clientes", value: m.clients.total },
              { label: "Ativos", value: m.clients.active },
              { label: `Novos ${inPeriod}`, value: m.clients.new, emphasis: true },
              { label: "Pessoa física / jurídica", value: `${formatNumber(m.clients.by_kind.INDIVIDUAL ?? 0)} / ${formatNumber(m.clients.by_kind.COMPANY ?? 0)}` },
            ]}
          />
          <Grid>
            <Trend title="Novos clientes" m={m} series={[{ key: "clients", label: "Clientes", color: "var(--chart-1)" }]} />
            <Categories title="Como chegaram" description="Canal de aquisição dos clientes novos do período." rows={channelRows(m.clients.by_channel)} />
            {m.clients.by_origin.length > 1 && <Categories title="Escritório de origem" description="Quem trouxe os clientes novos do período." rows={originRows(m.clients.by_origin)} />}
          </Grid>
        </>
      );
    case "cases":
      return (
        <>
          <Tiles
            items={[
              { label: "Casos", value: m.cases.total },
              { label: `Novos ${inPeriod}`, value: m.cases.new, emphasis: true },
              { label: `Aceitos ${inPeriod}`, value: m.cases.accepted },
              { label: `Recusados ${inPeriod}`, value: m.cases.rejected },
              { label: "Aguardando a equipe", value: m.cases.awaiting },
              { label: "Em análise", value: m.cases.in_analysis },
            ]}
          />
          <Grid>
            <Trend title="Casos novos × aceitos" m={m} series={[{ key: "cases", label: "Novos", color: "var(--chart-2)" }, { key: "accepted", label: "Aceitos", color: "var(--chart-3)" }]} />
            <Categories title="Situação dos casos" rows={statusRows(m.cases.by_status, LEGAL_CASE_STATUSES, LEGAL_CASE_STATUS_LABEL)} />
            <Categories title="Como chegaram" description="Canal de aquisição dos casos novos do período." rows={channelRows(m.cases.by_channel)} />
          </Grid>
          {m.cases.by_origin.length > 1 && (
            <Categories wide title="Escritório de origem" description="Casos novos do período por escritório." rows={originRows(m.cases.by_origin)} />
          )}
        </>
      );
    case "processes":
      return (
        <>
          <Tiles
            items={[
              { label: "Processos", value: m.processes.total },
              { label: "Ativos", value: m.processes.active, hint: "Tudo menos recebidos e arquivados" },
              { label: `Novos ${inPeriod}`, value: m.processes.new, emphasis: true },
              { label: `Distribuídos ${inPeriod}`, value: m.processes.distributed },
              { label: "Valor total das ações", value: formatCurrency(m.processes.case_value_total), hint: "Soma do valor da causa (menos arquivados)" },
            ]}
          />
          <Grid>
            <Categories title="Condução (status)" rows={statusRows(m.processes.by_status, PROCESS_STATUSES, PROCESS_STATUS_LABEL)} />
            <Categories title="Fase processual" rows={statusRows(m.processes.by_phase, PROCESS_PHASES, PROCESS_PHASE_LABEL, true)} />
            <Trend title="Processos cadastrados" m={m} series={[{ key: "processes", label: "Processos", color: "var(--chart-2)" }]} />
          </Grid>
        </>
      );
    case "partners":
      return (
        <Grid>
          <Categories title="Casos por escritório" description="Casos novos do período, por escritório de origem." rows={originRows(m.cases.by_origin)} />
          <Categories title="Clientes por escritório" description="Clientes novos do período, por escritório de origem." rows={originRows(m.clients.by_origin)} />
          <Trend title="Casos novos × aceitos" m={m} series={[{ key: "cases", label: "Novos", color: "var(--chart-2)" }, { key: "accepted", label: "Aceitos", color: "var(--chart-3)" }]} />
        </Grid>
      );
    case "portal-home":
      return (
        <>
          <Tiles
            items={[
              { label: `Clientes novos ${inPeriod}`, value: m.clients.new, emphasis: true },
              { label: `Casos enviados ${inPeriod}`, value: m.cases.new },
              { label: `Aceitos ${inPeriod}`, value: m.cases.accepted },
              { label: `Não aceitos ${inPeriod}`, value: m.cases.rejected },
              { label: "Processos ativos", value: m.processes.active },
            ]}
          />
          <Grid>
            <Trend title="Casos enviados × aceitos" m={m} series={[{ key: "cases", label: "Enviados", color: "var(--chart-2)" }, { key: "accepted", label: "Aceitos", color: "var(--chart-3)" }]} />
            <Trend title="Clientes novos" m={m} series={[{ key: "clients", label: "Clientes", color: "var(--chart-1)" }]} />
            <Categories title="Situação dos casos" rows={statusRows(m.cases.by_status, LEGAL_CASE_STATUSES, LEGAL_CASE_STATUS_LABEL)} />
          </Grid>
        </>
      );
    case "portal-finance":
      return (
        <>
          <Tiles items={[{ label: `Sua participação ${inPeriod}`, value: formatCurrency(m.finance.partner_share), emphasis: true }]} />
          <MoneyBars title="Participação por período" description="Sua parte dos recebimentos, por semana ou mês." m={m} />
        </>
      );
    default:
      return (
        <Grid>
          <Categories title="Casos por escritório de origem" description="Casos novos do período." rows={originRows(m.cases.by_origin)} />
          <Categories title="Como os clientes chegaram" description="Canal de aquisição dos clientes novos do período." rows={channelRows(m.clients.by_channel)} />
          <Tiles
            compact
            items={[
              { label: "Tarefas com os agentes", value: m.tasks.open },
              { label: "Tarefas para revisar", value: m.tasks.in_review },
              { label: "Revisões pendentes", value: m.reviews.pending },
              { label: `Prazos cumpridos ${inPeriod}`, value: m.deadlines.completed },
            ]}
          />
        </Grid>
      );
  }
}

/* ------------------------------------------------------------------ */

/**
 * "Entradas" (clientes, casos e processos por semana) — o gráfico que ocupa o
 * espaço embaixo da distribuição dos processos na Início (Roadmap 2.0).
 */
export function EntriesTrend({ metrics, title = "Entradas nos últimos 30 dias" }: { metrics: ActionResult<DashboardMetricsDTO>; title?: string }) {
  if (!metrics.ok) return null;
  return (
    <Trend
      title={title}
      m={metrics.data}
      series={[
        { key: "clients", label: "Clientes", color: "var(--chart-1)" },
        { key: "cases", label: "Casos", color: "var(--chart-3)" },
        { key: "processes", label: "Processos", color: "var(--chart-2)" },
      ]}
    />
  );
}

/** Altura do corpo de TODOS os painéis de indicadores (gráfico e listas), para a linha ficar alinhada. */
const BODY_HEIGHT = "h-[200px]";

/**
 * Grade dos painéis: colunas conforme a quantidade de blocos (nunca deixa
 * buraco) e todos com a mesma altura na linha (QA E-01..E-04, E-07, E-10).
 */
function Grid({ children }: { children: ReactNode }) {
  const count = Children.toArray(children).filter(Boolean).length;
  const cols = count >= 3 ? "lg:grid-cols-2 xl:grid-cols-3" : count === 2 ? "lg:grid-cols-2" : "";
  return <div className={cn("grid items-stretch gap-4", cols)}>{children}</div>;
}

function Tiles({ items, compact }: { items: { label: string; value: number | string; hint?: string; emphasis?: boolean }[]; compact?: boolean }) {
  return (
    // Compacto (ao lado de painéis): ocupa a altura toda da linha, em 2×2 (QA E-02).
    <dl className={cn("grid gap-3", compact ? "h-full grid-cols-2 auto-rows-fr" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-6")}>
      {items.map((i) => (
        <div key={i.label} className={cn("rounded-lg border border-line bg-surface px-4 py-3 shadow-hairline", compact && "flex flex-col justify-center")} title={i.hint}>
          <dt className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-subtle">{i.label}</dt>
          <dd className={cn("mt-1 text-[20px] font-semibold tabular", i.emphasis ? "text-navy" : "text-foreground")}>{typeof i.value === "number" ? formatNumber(i.value) : i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const WEEK = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
function bucketLabel(bucket: string, unit: "week" | "month") {
  const d = new Date(`${bucket}T00:00:00Z`);
  return unit === "week" ? WEEK.format(d) : MONTH.format(d).replace(". de ", "/").replace(".", "");
}

function Trend({ title, m, series }: { title: string; m: DashboardMetricsDTO; series: { key: keyof MetricsPoint; label: string; color: string }[] }) {
  const points = m.series.map((p) => ({ label: bucketLabel(p.bucket, m.period.unit), ...Object.fromEntries(series.map((s) => [s.key, Number(p[s.key])])) }));
  const summary = points.map((p) => `${p.label}: ${series.map((s) => `${s.label} ${(p as Record<string, unknown>)[s.key]}`).join(", ")}`).join("; ");
  const empty = points.every((p) => series.every((s) => !(p as unknown as Record<string, number>)[s.key]));
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader title={title} description={m.period.unit === "week" ? "Por semana" : "Por mês"} as="h3" />
      <PanelBody className="flex-1">
        {empty ? (
          <p className={cn(BODY_HEIGHT, "flex items-center justify-center text-[13px] text-muted")}>Nada no período.</p>
        ) : (
          <figure>
            <div className={BODY_HEIGHT} aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart accessibilityLayer={false} data={points} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} barCategoryGap="24%">
                  <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="label" tick={CHART_AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID_STROKE }} interval="preserveStartEnd" />
                  <YAxis tick={CHART_AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} cursor={CHART_CURSOR} />
                  {series.length > 1 && <Legend wrapperStyle={CHART_LEGEND_STYLE} iconSize={9} />}
                  {series.map((s) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={18} />
                  ))}
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

function MoneyBars({ title, description, m }: { title: string; description: string; m: DashboardMetricsDTO }) {
  const rows = m.series.map((p) => ({ label: bucketLabel(p.bucket, m.period.unit), value: Number(p.partner_share) }));
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader title={title} description={description} as="h3" />
      <PanelBody className="flex-1">
        {rows.every((r) => r.value === 0) ? (
          <p className={cn(BODY_HEIGHT, "flex items-center justify-center text-[13px] text-muted")}>Nenhum valor no período.</p>
        ) : (
          <ul className={cn(BODY_HEIGHT, "space-y-2 overflow-y-auto pr-1")} tabIndex={0} aria-label={title}>
            {rows.map((r) => (
              <li key={r.label} className="grid grid-cols-[64px_minmax(0,1fr)_96px] items-center gap-3 text-[12.5px]">
                <span className="text-muted">{r.label}</span>
                <span className="h-3 rounded-sm bg-surface-sunken">
                  <span className="block h-3 rounded-sm bg-[var(--chart-3)]" style={{ width: `${(r.value / max) * 100}%` }} />
                </span>
                <span className="text-right tabular font-medium text-foreground" title={formatCurrency(r.value)}>
                  {formatCurrencyCompact(r.value)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

type Row = { label: string; value: number };

/**
 * Lista com barras. O corpo tem a mesma altura do gráfico ao lado; com muitas
 * linhas (ex.: 260 escritórios), rola só a lista, também pelo teclado.
 * `wide`: faixa larga e baixa, com a lista em colunas (QA E-04).
 */
function Categories({ title, description, rows, wide }: { title: string; description?: string; rows: Row[]; wide?: boolean }) {
  const total = rows.reduce((t, r) => t + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const height = wide ? "max-h-[160px]" : BODY_HEIGHT;
  return (
    <Panel className={cn("flex flex-col", wide ? "mt-4" : "h-full")}>
      <PanelHeader title={title} description={description} as="h3" />
      <PanelBody className="flex-1">
        {total === 0 ? (
          <p className={cn(height, "flex items-center justify-center text-[13px] text-muted")}>Nada no período.</p>
        ) : (
          <ul
            className={cn(height, "overflow-y-auto pr-1", wide ? "grid gap-x-8 gap-y-2 md:grid-cols-2 xl:grid-cols-3" : "space-y-2")}
            tabIndex={0}
            aria-label={`${title} (lista com rolagem)`}
          >
            {rows
              .filter((r) => r.value > 0)
              .map((r) => (
                <li key={r.label} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_64px] items-center gap-3 text-[12.5px]">
                  <span className="truncate text-foreground" title={r.label}>
                    {r.label}
                  </span>
                  <span className="h-2.5 rounded-sm bg-surface-sunken">
                    <span className="block h-2.5 rounded-sm bg-[var(--chart-2)]" style={{ width: `${(r.value / max) * 100}%` }} />
                  </span>
                  <span className="text-right tabular text-muted">
                    <span className="font-medium text-foreground">{formatNumber(r.value)}</span> · {Math.round((r.value / total) * 100)}%
                  </span>
                </li>
              ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function channelRows(list: Keyed[]): Row[] {
  return list.map((k) => ({ label: isAcquisitionChannel(k.key) ? ACQUISITION_CHANNEL_LABEL[k.key] : "Não informado", value: Number(k.total) }));
}
function originRows(list: Keyed[]): Row[] {
  return list.map((k) => ({ label: k.name ?? "—", value: Number(k.total) }));
}
function statusRows<S extends string>(counts: Record<string, number>, order: readonly S[], labels: Record<S, string>, withNone = false): Row[] {
  const rows = order.map((s) => ({ label: labels[s], value: Number(counts[s] ?? 0) }));
  if (withNone && counts.NONE) rows.push({ label: "Sem fase", value: Number(counts.NONE) });
  return rows;
}
