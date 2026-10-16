"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { REMEMBER_COOKIE } from "@/lib/auth/session-cookies";
import { runAction } from "@/server/core/action";
import * as security from "./security";

/**
 * Segurança da própria conta (4.3.2). Sem permissão da matriz: toda sessão
 * liberada (aal2, termos, vínculo ativo) cuida das PRÓPRIAS sessões — de
 * qualquer papel, interno ou parceiro. Nenhuma recebe `userId` nem id de
 * sessão: o usuário e a sessão atual vêm do JWT verificado.
 */

const noInput = z.object({}).optional();

export async function getAccountSecurityAction(input?: unknown) {
  return runAction({ name: "account.security", schema: noInput, input, handler: (ctx) => security.getAccountSecurity(ctx) });
}

/** "Sair de todos os outros dispositivos": esta sessão continua. */
export async function signOutOtherSessionsAction(input?: unknown) {
  return runAction({ name: "account.sign_out_others", schema: noInput, input, handler: (ctx) => security.signOutOtherSessions(ctx) });
}

/**
 * "Sair de todos os dispositivos": inclusive este. O navegador vai para o
 * login (navegação completa) quando der certo. "Lembrar de mim" é apagado.
 */
export async function signOutAllSessionsAction(input?: unknown) {
  const result = await runAction({ name: "account.sign_out_all", schema: noInput, input, handler: (ctx) => security.signOutAllSessions(ctx) });
  if (result.ok) (await cookies()).delete(REMEMBER_COOKIE);
  return result;
}
