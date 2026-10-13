import "server-only";

import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import { type Permission } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AuthorizationError, authorizeAction } from "@/server/auth/session";
import { createServiceContext, type ServiceContext } from "./context";
import { DomainError, failure, type DomainResult, type FieldErrors } from "./errors";
import { createLogger } from "./logger";

/**
 * Fronteira de TODA Server Action de domínio:
 *
 *   1. correlation ID novo (UUID, sem PII);
 *   2. sessão + onboarding completo (aal2, termos) + permissão da matriz —
 *      `authorizeAction` (o papel vem do banco, nunca do navegador);
 *   3. input validado pelo schema Zod (nada chega cru ao service);
 *   4. client Supabase com o JWT do usuário + cabeçalho `x-dg-request-id`
 *      (a migration 025 leva o ID para a auditoria do banco);
 *   5. service; erro → `DomainResult` com mensagem segura. Erro inesperado
 *      vira INTERNAL e fica só no log (sanitizado).
 *
 * Server Actions já têm proteção de origem (CSRF) do Next.js.
 */
export async function runAction<I, O>(options: {
  name: string;
  permission?: Permission;
  schema: ZodType<I>;
  input: unknown;
  handler: (ctx: ServiceContext, input: I) => Promise<O>;
}): Promise<DomainResult<O>> {
  const requestId = randomUUID();
  const started = Date.now();
  const log = createLogger({ requestId, action: options.name });

  try {
    const session = await authorizeAction(options.permission).catch((error: unknown) => {
      if (error instanceof AuthorizationError) {
        throw new DomainError(/sessão/i.test(error.message) ? "UNAUTHORIZED" : "FORBIDDEN");
      }
      throw error;
    });

    const parsed = options.schema.safeParse(options.input);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      throw new DomainError("VALIDATION", undefined, { fieldErrors });
    }

    const db = await createSupabaseServerClient({ requestId });
    const ctx = createServiceContext({ db, session, requestId, action: options.name });
    const data = await options.handler(ctx, parsed.data);
    ctx.log.info("action.ok", { durationMs: Date.now() - started });
    return { ok: true, data, requestId };
  } catch (error) {
    if (error instanceof DomainError) {
      const level = error.code === "INTERNAL" ? "error" : "warn";
      log[level]("action.failed", { code: error.code, technicalCode: error.technicalCode, durationMs: Date.now() - started });
      return failure(error, requestId);
    }
    log.error("action.crashed", { error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started });
    return failure(new DomainError("INTERNAL"), requestId);
  }
}
