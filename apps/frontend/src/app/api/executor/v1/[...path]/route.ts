import { NextResponse } from "next/server";
import { createLogger } from "@/server/core/logger";
import { pgExecutorDb } from "@/server/executor/db";
import { handleExecutorRequest } from "@/server/executor/handler";
import { signedExecutorStorage } from "@/server/executor/storage";

/**
 * Porta HTTP do computador do escritório (MCP local do DG Brasil). A lógica e
 * a segurança estão em server/executor/handler.ts e no banco
 * (private.executor_*). Aqui só: ler o corpo com limite e responder JSON sem
 * cache.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;
const log = createLogger({ area: "executor" });

type Context = { params: Promise<{ path: string[] }> };

async function serve(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  let body: unknown = undefined;
  if (request.method === "POST") {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: { code: "TOO_LARGE", message: "Corpo da requisição grande demais." } });
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, { error: { code: "BAD_JSON", message: "JSON inválido." } });
      }
    }
  }
  const res = await handleExecutorRequest(
    { method: request.method, segments: path, headers: request.headers, query: new URL(request.url).searchParams, body },
    { db: pgExecutorDb(), storage: signedExecutorStorage(), log },
  );
  return json(res.status, res.body);
}

function json(status: number, body: unknown): Response {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const GET = serve;
export const POST = serve;
