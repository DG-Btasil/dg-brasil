"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import { unwrap } from "@/server/core/db-errors";
import { METRIC_PERIODS, periodRange, type DashboardMetricsDTO } from "./dto";

/**
 * Indicadores do período (Roadmap 2.0, migration 049). Qualquer sessão
 * liberada: a função do banco é SECURITY INVOKER, então cada número já vem
 * recortado pela RLS de quem pede (parceiro vê só o próprio escritório,
 * LAWYER não vê dinheiro).
 */
const schema = z.object({ period: z.enum(METRIC_PERIODS).default("30") });

export async function getDashboardMetricsAction(input: unknown) {
  return runAction({
    name: "metrics.dashboard",
    schema,
    input,
    handler: async (ctx, { period }): Promise<DashboardMetricsDTO> => {
      const { from, to } = periodRange(period);
      return unwrap(await ctx.db.rpc("get_dashboard_metrics", { p_from: from, p_to: to })) as DashboardMetricsDTO;
    },
  });
}
