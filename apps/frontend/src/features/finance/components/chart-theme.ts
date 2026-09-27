import type { CSSProperties } from "react";

/** Estilo comum dos gráficos (tokens do design system, sem hex). */
export const CHART_AXIS_TICK = { fill: "var(--muted)", fontSize: 11.5 } as const;
export const CHART_GRID_STROKE = "var(--line)";
export const CHART_TOOLTIP_STYLE: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--foreground)",
  boxShadow: "0 4px 16px rgb(11 31 51 / 0.08)",
};
export const CHART_TOOLTIP_LABEL_STYLE: CSSProperties = { color: "var(--foreground)", fontWeight: 600, marginBottom: 2 };
export const CHART_LEGEND_STYLE: CSSProperties = { fontSize: 12, color: "var(--muted)" };
export const CHART_CURSOR = { fill: "var(--surface-sunken)", opacity: 0.6 } as const;
