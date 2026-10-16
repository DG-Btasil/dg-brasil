"use server";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { passwordErrorMessage, sanitizeForLog } from "@/lib/auth/errors";
import { acceptedInviteMetadata, normalizePersonName, personNameProblem } from "@/lib/auth/invite-metadata";
import { LEGAL_DOCUMENTS } from "@/lib/auth/legal-documents";
import { passwordProblem } from "@/lib/auth/password-policy";
import { AUTH_ROUTES, isInviteRef } from "@/lib/auth/redirects";
import { REMEMBER_COOKIE } from "@/lib/auth/session-cookies";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentSession } from "./session";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Logout ("Sair" / "Sair deste dispositivo"): revoga SÓ esta sessão no
 * Supabase (scope "local" — os outros dispositivos continuam) e apaga os
 * cookies. "Lembrar de mim" também é apagado: o próximo login começa do zero —
 * senha + TOTP. Com a sessão liberada, registra SESSION_CURRENT_REVOKED antes
 * (o JWT ainda vale); se não estiver (bloqueio, sessão já encerrada), só sai.
 */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if ((await getCurrentSession()).state === "READY") {
    const { error } = await supabase.rpc("record_account_security_event", { p_action: "SESSION_CURRENT_REVOKED" });
    if (error) console.error("[auth] auditoria do logout", sanitizeForLog(error));
  }
  await supabase.auth.signOut({ scope: "local" });
  (await cookies()).delete(REMEMBER_COOKIE);
  redirect(`${AUTH_ROUTES.login}?aviso=saiu`);
}

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  // inet do Postgres: só aceita IP válido; qualquer outra coisa vira nulo.
  const valid = ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
  return { ip: valid, userAgent: h.get("user-agent")?.slice(0, 500) ?? null };
}

/**
 * Aceite das versões VIGENTES dos documentos legais pendentes. Append-only:
 * cada aceite é uma linha nova (user_legal_acceptances), com IP e navegador.
 * Vale antes do MFA (faz parte do primeiro acesso).
 */
export async function acceptLegalTerms(): Promise<ActionResult> {
  const result = await getCurrentSession();
  if (!result.session) return { ok: false, error: "Sua sessão não permite este passo. Entre novamente." };
  const pending = result.session.pendingLegalDocuments;
  if (!pending.length) return { ok: true };

  const { ip, userAgent } = await requestMeta();
  const supabase = await createSupabaseServerClient();
  const rows = LEGAL_DOCUMENTS.filter((d) => pending.includes(d.type)).map((d) => ({
    user_id: result.session!.userId,
    document_type: d.type,
    document_version: d.version,
    ip_address: ip,
    user_agent: userAgent,
  }));
  const { error } = await supabase.from("user_legal_acceptances").insert(rows);
  if (error) {
    console.error("[auth] aceite de termos", sanitizeForLog(error));
    return { ok: false, error: "Não foi possível registrar o aceite. Tente novamente." };
  }
  return { ok: true };
}

/**
 * Primeiro acesso por convite: o link do Supabase Auth já provou o e-mail e
 * abriu uma sessão. Aqui o convite é aceito (vínculo criado uma única vez, no
 * banco — accept_invitation é idempotente) e a pessoa define a senha.
 */
export async function completeInvitation(input: { ref: string; fullName: string; password: string }): Promise<ActionResult> {
  const result = await getCurrentSession();
  if (result.state === "ANONYMOUS") return { ok: false, error: "Sua sessão expirou. Abra o link do convite novamente." };
  if (!isInviteRef(input.ref)) redirect(`${AUTH_ROUTES.blocked}?motivo=convite-invalido`);

  const fullName = normalizePersonName(input.fullName);
  const nameProblem = personNameProblem(fullName);
  if (nameProblem) return { ok: false, error: nameProblem };
  const problem = passwordProblem(input.password, { email: result.email, name: fullName });
  if (problem) return { ok: false, error: problem };

  const supabase = await createSupabaseServerClient();
  const tokenHash = createHash("sha256").update(input.ref).digest("hex");
  const { data, error } = await supabase.rpc("accept_invitation", { p_token_hash: tokenHash });
  if (error) {
    console.error("[auth] aceite de convite", sanitizeForLog(error));
    return { ok: false, error: "Não foi possível aceitar o convite agora. Tente novamente." };
  }
  const status = (data as { status?: string } | null)?.status;
  const reason: Record<string, string> = {
    INVALID: "convite-invalido",
    REVOKED: "convite-revogado",
    EXPIRED: "convite-expirado",
    CONFLICT: "conflito-de-vinculo",
  };
  if (status && reason[status]) redirect(`${AUTH_ROUTES.blocked}?motivo=${reason[status]}`);

  await supabase.from("profiles").update({ full_name: fullName }).eq("id", result.userId!);
  // Senha + limpeza dos dados de e-mail do convite (papel, escritório, marca de
  // reconvite): depois do aceite a conta não carrega "papel do convite" no token.
  const { error: pwError } = await supabase.auth.updateUser({ password: input.password, data: acceptedInviteMetadata(fullName) });
  if (pwError) return { ok: false, error: passwordErrorMessage(pwError) };
  return { ok: true };
}

/**
 * Nova senha (recuperação ou troca). Exige sessão; com MFA, sessão aal2.
 * Depois da troca: auditoria PASSWORD_CHANGED (o banco avisa a pessoa) e as
 * OUTRAS sessões são encerradas — quem tinha a senha antiga sai; esta continua.
 */
export async function updatePassword(input: { password: string }): Promise<ActionResult> {
  const result = await getCurrentSession();
  if (result.state === "ANONYMOUS") return { ok: false, error: "O link expirou. Peça uma nova recuperação de senha." };
  const problem = passwordProblem(input.password, { email: result.email, name: result.session?.fullName });
  if (problem) return { ok: false, error: problem };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) return { ok: false, error: passwordErrorMessage(error) };

  if (result.state === "READY") {
    const { error: auditError } = await supabase.rpc("record_account_security_event", { p_action: "PASSWORD_CHANGED" });
    if (auditError) console.error("[auth] auditoria da troca de senha", sanitizeForLog(auditError));
  }
  const { error: othersError } = await supabase.auth.signOut({ scope: "others" });
  if (othersError) console.error("[auth] encerrar outras sessões após troca de senha", sanitizeForLog(othersError));
  return { ok: true };
}
