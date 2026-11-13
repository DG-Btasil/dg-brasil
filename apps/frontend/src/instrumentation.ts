import type { Instrumentation } from "next";

/**
 * Subida do servidor (convenção do Next: roda uma vez por instância, antes da
 * primeira requisição). Faz duas coisas, as duas em `server/core/startup.ts`:
 *
 *   1. liga o aviso de erros por webhook, se `ERROR_WEBHOOK_URL` existir;
 *   2. confere as variáveis de ambiente e registra o que falta.
 *
 * Nada aqui pode derrubar o servidor nem o build: falha vira log.
 *
 * Sentry (ou outro serviço de erros), quando o escritório contratar: o lugar é
 * este arquivo. `register` chama o `init` do SDK e `onRequestError` repassa o
 * erro (com o SDK do Sentry: `export const onRequestError = Sentry.captureRequestError`).
 * Passo a passo em docs/deploy/producao.md, "Monitoramento".
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startPlatform } = await import("@/server/core/startup");
    startPlatform();
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "startup.failed", reason: error instanceof Error ? error.name : "unknown" }));
  }
}

/** Erro que o Next capturou numa página, rota ou Server Action: vai para o log (e para o webhook). */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { reportRequestError } = await import("@/server/core/startup");
    await reportRequestError(error, request, context);
  } catch {
    // Relatar o erro nunca pode gerar outro.
  }
};
