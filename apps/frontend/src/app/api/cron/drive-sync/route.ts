import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createLogger } from "@/server/core/logger";
import { syncDeps } from "@/server/domain/drive/service";
import { DriveClient, driveConfigFromEnv } from "@/server/integrations/google-drive/client";
import { runDriveSync } from "@/server/integrations/google-drive/sync";

/**
 * Rodada agendada do Google Drive (Vercel Cron — vercel.json): exporta as
 * versões aprovadas na fila e importa arquivos novos das pastas ligadas, as mais
 * antigas primeiro. Uma vez por dia (09:00 UTC) enquanto o projeto está no plano
 * Hobby; volta a cada 15 min na produção (docs/deploy/producao.md). Protegida por
 * CRON_SECRET (a Vercel manda "Authorization: Bearer <CRON_SECRET>").
 *
 * Sem Drive configurado (ou com a credencial ilegível) a rodada não acontece e
 * isso NÃO passa em silêncio: fica um erro no log (que vai para o aviso de
 * erros, se ligado) e a resposta é 503. Antes a rota respondia 200 com
 * "skipped" e ninguém percebia que os documentos tinham parado de ir para o Drive.
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
  let cfg: ReturnType<typeof driveConfigFromEnv> = null;
  let reason = "not_configured";
  try {
    cfg = driveConfigFromEnv();
  } catch {
    reason = "invalid_credentials";
  }
  if (!cfg) {
    log.error("drive.cron_not_configured", { reason });
    return NextResponse.json({ error: "drive_not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  const r = await runDriveSync(syncDeps({ log }, new DriveClient(cfg), started + 45_000));
  log.info("drive.cron", { links: r.links, imported: r.imported, failed: r.failed, exported: r.exports.exported, durationMs: Date.now() - started });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
