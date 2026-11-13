import { after } from "next/server";
import { reportEnvironment } from "./env-check";
import { createErrorWebhook, errorWebhookUrl, type ErrorWebhook } from "./error-webhook";
import { consoleSink, createLogger, sanitizeFields, setLogSink } from "./logger";

/**
 * O que roda na subida do servidor (chamado por `src/instrumentation.ts`).
 * Separado do arquivo de convenção para poder ser testado.
 */

const shared = globalThis as unknown as {
  __dgStarted?: boolean;
  __dgReportError?: ErrorWebhook["report"];
};

type Env = Record<string, string | undefined>;

/** Durante `next build` não há servidor de verdade: não confere nem avisa. */
const building = (env: Env) => env.NEXT_PHASE === "phase-production-build";

/** Em serverless a função pode congelar logo depois da resposta: `after` segura até o envio terminar. */
function keepAlive(pending: Promise<void>) {
  try {
    after(() => pending);
  } catch {
    // Fora de uma requisição (subida, tarefa agendada): o envio segue sozinho.
  }
}

export function startPlatform(env: Env = process.env): void {
  if (shared.__dgStarted || building(env)) return;
  shared.__dgStarted = true;

  const url = errorWebhookUrl(env.ERROR_WEBHOOK_URL);
  if (url) {
    const webhook = createErrorWebhook({ url, environment: env.DG_ENV ?? env.VERCEL_ENV ?? env.NODE_ENV ?? "desconhecido", keepAlive });
    shared.__dgReportError = webhook.report;
    setLogSink(webhook.sink);
  }
  reportEnvironment(createLogger({ area: "startup" }), env);
}

/**
 * Erro capturado pelo Next. Vai só o que identifica ONDE quebrou: rota (o
 * arquivo, não o endereço com parâmetros), tipo, método, classe do erro e o
 * código (digest) que a tela mostra para a pessoa. A mensagem do erro não vai:
 * pode carregar dado de cliente.
 */
export async function reportRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routePath?: string; routeType?: string; routerKind?: string },
): Promise<void> {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest?: unknown }).digest).slice(0, 40) : null;
  const fields = sanitizeFields({
    area: "request",
    routePath: context.routePath ?? null,
    routeType: context.routeType ?? null,
    method: request.method ?? null,
    errorClass: error instanceof Error ? error.name : typeof error,
    digest,
  });
  // Com webhook, o envio é aguardado aqui (a convenção do Next pede) e respeita o mesmo limite por minuto.
  if (shared.__dgReportError) await shared.__dgReportError("request.error", fields);
  else consoleSink("error", "request.error", fields);
}

/** Só para testes: volta ao estado de antes da subida. */
export function resetPlatformForTests(): void {
  shared.__dgStarted = false;
  shared.__dgReportError = undefined;
  setLogSink(null);
}
