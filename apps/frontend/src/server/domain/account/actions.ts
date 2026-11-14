"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { REMEMBER_COOKIE } from "@/lib/auth/session-cookies";
import { runAction } from "@/server/core/action";
import * as oabs from "./oabs";
import * as security from "./security";
import * as setup from "./setup";

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

/* ── Setup do escritório (072): só a dona do escritório ─────────────── */

/** O botão aparece? Para quem não é a dona, só `false` (nem a razão). */
export async function canUseOfficeSetupAction(input?: unknown) {
  return runAction({ name: "account.office_setup.check", schema: noInput, input, handler: (ctx) => setup.canUseOfficeSetup(ctx) });
}

/** "Autorizar": gera o código de uso único e devolve o lançador para baixar. */
export async function issueOfficeSetupAction(input?: unknown) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto");
  return runAction({
    name: "account.office_setup.issue", schema: noInput, input,
    handler: (ctx) => setup.issueOfficeSetup(ctx, setup.setupOrigin(host, proto)),
  });
}

/* ── OABs da própria pessoa (Roadmap 2.0, 048) ───────────────────────── */

const oabSchema = z.object({
  number: z.string().trim().min(1, "Informe o número da OAB.").max(20),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Selecione a UF."),
  primary: z.boolean().default(false),
});
const oabIdSchema = z.object({ id: z.string().uuid() });

export async function listMyOabsAction(input?: unknown) {
  return runAction({ name: "account.oabs.list", schema: noInput, input, handler: (ctx) => oabs.listMyOabs(ctx) });
}

export async function addMyOabAction(input: unknown) {
  return runAction({ name: "account.oabs.add", schema: oabSchema, input, handler: oabs.addMyOab });
}

export async function removeMyOabAction(input: unknown) {
  return runAction({ name: "account.oabs.remove", schema: oabIdSchema, input, handler: oabs.removeMyOab });
}

export async function setMyPrimaryOabAction(input: unknown) {
  return runAction({ name: "account.oabs.primary", schema: oabIdSchema, input, handler: oabs.setMyPrimaryOab });
}
