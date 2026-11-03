import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createLogger } from "@/server/core/logger";
import { judicialSyncDeps } from "@/server/domain/judicial/service";
import { runJudicialSync } from "@/server/integrations/judicial/sync";

/**
 * Rodada agendada da integração judicial (Vercel Cron — vercel.json): publicações
 * do DJEN pelas OABs acompanhadas e andamentos do DataJud dos processos com CNJ.
 * Uma vez por dia, de manhã (09:30 UTC = 06:30 em Brasília, depois que o DJEN
 * libera o caderno às 03:00), enquanto o projeto está no plano Hobby. Mais
 * vezes ao dia: docs/deploy/producao.md. O DataJud também roda em lotes a cada
 * 20 min (?only=datajud), chamado pelo pg_cron do banco. Protegida por CRON_SECRET.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = createLogger({ area: "judicial-cron" });

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.DG_WORKER_DB_URL) return NextResponse.json({ skipped: "DG_WORKER_DB_URL ausente" });
  const started = Date.now();
  // ?only=datajud: lote extra do DataJud chamado pelo agendador do banco (043, seção 9).
  const onlyDatajud = new URL(request.url).searchParams.get("only") === "datajud";
  // Lote só do DataJud: mais paralelo (as consultas demoram, quase não usam CPU).
  const deps = { ...judicialSyncDeps(log, started + 50_000), datajudConcurrency: onlyDatajud ? 4 : 2 };
  const r = await runJudicialSync(deps, { trigger: "CRON", onlyDatajud });
  if (r.busy || ("idle" in r && r.idle)) {
    log.info(r.busy ? "judicial.cron_busy" : "judicial.cron_idle", { onlyDatajud });
    return NextResponse.json(r.busy ? { busy: true } : { idle: true }, { headers: { "Cache-Control": "no-store" } });
  }
  log.info("judicial.cron", { status: r.status, ...r.stats, durationMs: Date.now() - started });
  // Sem detalhes de erro na resposta (ficam no banco, na tela de Integrações).
  return NextResponse.json({ status: r.status, stats: r.stats }, { headers: { "Cache-Control": "no-store" } });
}
