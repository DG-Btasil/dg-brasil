import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createLogger } from "@/server/core/logger";
import { syncDeps } from "@/server/domain/drive/service";
import { DriveClient, driveConfigFromEnv } from "@/server/integrations/google-drive/client";
import { runDriveSync } from "@/server/integrations/google-drive/sync";

/**
 * Rodada agendada do Google Drive (Vercel Cron, a cada 15 min — vercel.json):
 * exporta as versões aprovadas na fila e importa arquivos novos das pastas
 * ligadas, as mais antigas primeiro. Protegida por CRON_SECRET (a Vercel manda
 * "Authorization: Bearer <CRON_SECRET>"). Sem Drive configurado: não faz nada.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = createLogger({ area: "drive-cron" });

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cfg = driveConfigFromEnv();
  if (!cfg) return NextResponse.json({ skipped: "drive não configurado" });
  const started = Date.now();
  const r = await runDriveSync(syncDeps({ log }, new DriveClient(cfg), started + 45_000));
  log.info("drive.cron", { links: r.links, imported: r.imported, failed: r.failed, exported: r.exports.exported, durationMs: Date.now() - started });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
