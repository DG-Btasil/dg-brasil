import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/server/core/logger";
import { callPrivate } from "@/server/core/worker-db";
import { readJsonBody } from "@/server/executor/body";
import { HttpError } from "@/server/executor/handler";
import { handleSetupRedeem, SETUP_URL_SECONDS } from "@/server/setup/redeem";

/**
 * Porta do setup do escritório (072). A lógica está em server/setup/redeem.ts
 * e no banco (private.office_setup_redeem). A service role assina só o caminho
 * que o banco acabou de devolver para o código, no bucket office-setup.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger({ area: "setup" });
const SETUP_FUNCTIONS = ["office_setup_redeem"] as const;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await readJsonBody(request, 2_000);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 400;
    return json(status, { error: { code: "BAD_REQUEST", message: "Pedido inválido." } });
  }
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const res = await handleSetupRedeem(body, ip, {
    redeem: (hash) => callPrivate(SETUP_FUNCTIONS, "office_setup_redeem", [hash]),
    async sign(objectName, filename) {
      const { data, error } = await createSupabaseAdminClient().storage.from("office-setup").createSignedUrl(objectName, SETUP_URL_SECONDS, { download: filename });
      if (error || !data) throw new Error("não foi possível assinar o pacote do setup");
      return data.signedUrl;
    },
    log,
  });
  return json(res.status, res.body);
}

function json(status: number, body: unknown): Response {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
