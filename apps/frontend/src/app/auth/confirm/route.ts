import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeForLog } from "@/lib/auth/errors";
import { AUTH_ROUTES, isInviteRef } from "@/lib/auth/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Callback dos e-mails do Supabase Auth (convite e recuperação de senha).
 *
 * Os templates de e-mail (supabase/templates) apontam para cá com
 * `token_hash` + `type` — funciona mesmo abrindo o link em outro navegador.
 * O destino NUNCA vem da URL: é decidido aqui pelo tipo de fluxo, e o `ref`
 * do convite só passa se tiver o formato esperado. Nenhum token é exibido.
 */
const OTP_TYPES: readonly EmailOtpType[] = ["invite", "recovery", "signup", "email", "magiclink", "email_change"];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");
  const fluxo = params.get("fluxo");
  const ref = params.get("ref");

  const to = (path: string) => {
    const url = request.nextUrl.clone();
    const [pathname, search = ""] = path.split("?");
    url.pathname = pathname;
    url.search = search ? `?${search}` : "";
    return NextResponse.redirect(url);
  };

  const supabase = await createSupabaseServerClient();
  let error: unknown = new Error("parâmetros ausentes");
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  } else if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  }
  if (error) {
    console.warn("[auth] link de e-mail recusado", sanitizeForLog(error));
    return to(`${AUTH_ROUTES.blocked}?motivo=link-invalido`);
  }

  if (fluxo === "convite" || type === "invite") {
    if (!isInviteRef(ref)) return to(`${AUTH_ROUTES.blocked}?motivo=convite-invalido`);
    return to(`${AUTH_ROUTES.firstAccess}?ref=${ref}`);
  }
  if (fluxo === "recuperacao" || type === "recovery") return to(AUTH_ROUTES.newPassword);
  return to("/");
}
