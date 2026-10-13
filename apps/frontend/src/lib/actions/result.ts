import type { DomainErrorCode, DomainResult, FieldErrors } from "@/server/core/errors";

/**
 * Lado do NAVEGADOR das Server Actions de domínio (Etapa 4.3). Toda action
 * devolve `DomainResult` (nunca lança); aqui ficam as conversões para a UI:
 * falha de rede vira um resultado de erro recuperável, e os erros de campo
 * do Zod do servidor viram mensagens nos campos do formulário.
 */

export type ActionResult<T> = DomainResult<T>;
export type ActionError = Extract<DomainResult<never>, { ok: false }>;
export type { DomainErrorCode, FieldErrors };

export const NETWORK_ERROR_MESSAGE = "Sem conexão com o servidor. Verifique a internet e tente novamente.";

/**
 * Chama a action e transforma exceção (rede caiu, deploy novo, servidor fora)
 * em `{ ok: false }`. A tela trata um único formato de erro.
 */
export async function callAction<T>(run: () => Promise<DomainResult<T>>): Promise<DomainResult<T>> {
  try {
    return await run();
  } catch {
    return { ok: false, error: { code: "INTERNAL", message: NETWORK_ERROR_MESSAGE }, requestId: "" };
  }
}

/** Código curto para o usuário informar ao suporte (relaciona com o log do servidor). */
export function referenceCode(requestId: string | undefined): string | undefined {
  return requestId ? requestId.slice(0, 8).toUpperCase() : undefined;
}

/**
 * Leva os erros de campo do servidor (caminhos do schema da action, ex.:
 * "patch.contact.email") para os nomes do formulário. `map` traduz caminhos
 * que diferem; o prefixo `strip` (ex.: "patch.") é removido antes.
 */
export function mapFieldErrors(fieldErrors: FieldErrors | undefined, map: Record<string, string> = {}, strip?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawPath, messages] of Object.entries(fieldErrors ?? {})) {
    const path = strip && rawPath.startsWith(strip) ? rawPath.slice(strip.length) : rawPath;
    const target = map[path] ?? Object.entries(map).find(([prefix]) => prefix.endsWith(".*") && path.startsWith(prefix.slice(0, -1)))?.[1] ?? path;
    if (!(target in out) && messages[0]) out[target] = messages[0];
  }
  return out;
}
