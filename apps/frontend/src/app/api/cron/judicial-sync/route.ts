import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createLogger } from "@/server/core/logger";
import { judicialSyncDeps } from "@/server/domain/judicial/service";
import { runJudicialSync } from "@/server/integrations/judicial/sync";

/**
 * Rodada agendada da integração judicial (Vercel Cron — vercel.json): publicações
 * do DJEN pelas OABs acompanhadas e andamentos do DataJud dos processos com CNJ.
 *
 * Quem chama:
 *  - o pg_cron do banco (043, seção 9), em lotes a cada 5 min: a partir das
 *    05:00 (o DJEN libera o caderno às 03:00), enquanto houver OAB não conferida
 *    no dia, sem parâmetro; depois, ?only=datajud. O DJEN aceita 20 consultas
 *    por minuto: com muitas OABs, são vários lotes;
 *  - a Vercel Cron às 06:30 (09:30 UTC), como reserva.
 * Protegida por CRON_SECRET.
 *
 * Tempo da rodada (13/11/2026): a função pode rodar até 5 min (Fluid Compute da
 * Vercel) e trabalha 4. Com o limite antigo de 60 s o DataJud não cabia: o CNJ
 * leva de 30 s a mais de 1 min por consulta. Quem chama (pg_net, 60 s) desiste
 * antes; a função segue até o fim e grava o resultado no banco.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
/** Tempo de trabalho da rodada; o resto fica para gravar o fim (JUD-06). */
const WORK_MS = 240_000;

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
  // ?only=datajud: lote só do DataJud (agendador do banco, sem OAB pendente no dia).
  const onlyDatajud = new URL(request.url).searchParams.get("only") === "datajud";
  // Lote só do DataJud: mais paralelo (as consultas demoram, quase não usam CPU).
  const deps = { ...judicialSyncDeps(log, started + WORK_MS), datajudConcurrency: onlyDatajud ? 4 : 2 };
  const r = await runJudicialSync(deps, { trigger: "CRON", onlyDatajud });
  if (r.busy || ("idle" in r && r.idle)) {
    log.info(r.busy ? "judicial.cron_busy" : "judicial.cron_idle", { onlyDatajud });
    return NextResponse.json(r.busy ? { busy: true } : { idle: true }, { headers: { "Cache-Control": "no-store" } });
  }
  log.info("judicial.cron", { status: r.status, ...r.stats, durationMs: Date.now() - started });
  // Sem detalhes de erro na resposta (ficam no banco, na tela de Integrações).
  return NextResponse.json({ status: r.status, stats: r.stats }, { headers: { "Cache-Control": "no-store" } });
}
