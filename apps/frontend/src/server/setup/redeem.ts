import type { Logger } from "@/server/core/logger";
import { SlidingWindowLimiter } from "@/server/core/rate-limit";
import { SETUP_CODE, setupCodeHash } from "@/server/domain/account/setup";

/**
 * /api/setup/v1/baixar (072). Quem chama é o setup.ps1, no computador, com o
 * código de uso único do comando que a dona do escritório copiou. Sem
 * sessão de navegador nem token do computador: o código É a autorização, e o
 * banco (private.office_setup_redeem) o aceita uma vez só, em até 15 minutos.
 *
 * Ordem: formato do código → limite por IP → banco → URL assinada de 2
 * minutos para o pacote no bucket privado office-setup. A resposta nunca traz
 * o código nem o hash; erro do banco vira a frase fixa (sem detalhe técnico).
 */

export interface SetupRedeemDeps {
  redeem(codeHash: string): Promise<{ version: string; storage_object_name: string; size_bytes: number | string; checksum_sha256: string }>;
  sign(objectName: string, filename: string): Promise<string>;
  log: Logger;
  limiter?: SlidingWindowLimiter;
}

export interface SetupRedeemResponse {
  status: number;
  body: unknown;
}

const sharedLimiter = new SlidingWindowLimiter(60_000);
const LIMIT_PER_MINUTE = 10;
export const SETUP_URL_SECONDS = 120;

const fail = (status: number, code: string, message: string): SetupRedeemResponse => ({ status, body: { error: { code, message } } });
const EXPIRED = "Este comando venceu ou já foi usado. Copie outro em Sua conta e sessões > Setup.";

export async function handleSetupRedeem(body: unknown, ip: string, deps: SetupRedeemDeps): Promise<SetupRedeemResponse> {
  const code = typeof (body as { code?: unknown } | null)?.code === "string" ? (body as { code: string }).code.trim() : "";
  if (!SETUP_CODE.test(code)) return fail(401, "INVALID_CODE", EXPIRED);

  const rate = (deps.limiter ?? sharedLimiter).consume([{ key: `setup:${ip.slice(0, 64) || "sem-ip"}`, limit: LIMIT_PER_MINUTE }]);
  if (!rate.allowed) return fail(429, "RATE_LIMITED", "Muitas tentativas seguidas. Espere um minuto.");

  let row: Awaited<ReturnType<SetupRedeemDeps["redeem"]>>;
  try {
    row = await deps.redeem(setupCodeHash(code));
  } catch (e) {
    const dbCode = (e as { code?: string })?.code ?? null;
    if (dbCode === "42501") {
      deps.log.warn("setup_redeem", { status: 401 });
      return fail(401, "INVALID_CODE", EXPIRED);
    }
    deps.log.error("setup_redeem", { status: 500, dbCode });
    return fail(500, "INTERNAL", "Erro interno. Tente de novo em instantes.");
  }
  const url = await deps.sign(row.storage_object_name, `setup-dg-brasil-${row.version}.zip`);
  deps.log.info("setup_redeem", { status: 200, version: row.version });
  return {
    status: 200,
    body: { version: row.version, size: Number(row.size_bytes), sha256: row.checksum_sha256, url, expires_in: SETUP_URL_SECONDS },
  };
}
