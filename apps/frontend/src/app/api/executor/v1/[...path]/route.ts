import { NextResponse } from "next/server";
import { createLogger } from "@/server/core/logger";
import { readJsonBody } from "@/server/executor/body";
import { pgExecutorDb } from "@/server/executor/db";
import { handleExecutorRequest } from "@/server/executor/handler";
import { signedExecutorStorage } from "@/server/executor/storage";

/**
 * Porta HTTP do computador do escritório (MCP local do DG Brasil). A lógica e
 * a segurança estão em server/executor/handler.ts e no banco
 * (private.executor_*). Aqui só: entregar ao handler um leitor do corpo com
 * limite (ele só lê depois de conferir o token, o limite de taxa e a versão do
 * conector) e responder JSON sem cache.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;
const log = createLogger({ area: "executor" });

type Context = { params: Promise<{ path: string[] }> };

async function serve(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  const res = await handleExecutorRequest(
    {
      method: request.method,
      segments: path,
      headers: request.headers,
      query: new URL(request.url).searchParams,
      readBody: () => readJsonBody(request, MAX_BODY_BYTES),
    },
    { db: pgExecutorDb(), storage: signedExecutorStorage(), log },
  );
  return json(res.status, res.body);
}

function json(status: number, body: unknown): Response {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const GET = serve;
export const POST = serve;
