import { NextResponse } from "next/server";
import { createHealthCheck } from "@/server/core/health";
import { pingDatabase } from "@/server/core/worker-db";

/**
 * Situação do sistema para um monitor externo (UptimeRobot, Better Stack…).
 * Pública de propósito: sem segredo e sem dado. Responde 200 quando o site e o
 * banco respondem, 503 quando o banco não responde ou a conexão do servidor
 * (DG_WORKER_DB_URL) não está configurada. Como ligar o monitor:
 * docs/deploy/producao.md, "Monitoramento".
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const check = createHealthCheck({ ping: process.env.DG_WORKER_DB_URL ? pingDatabase : null });

export async function GET() {
  const report = await check();
  return NextResponse.json(report, { status: report.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
