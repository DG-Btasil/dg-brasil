import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_ROUTES, isPublicPath, safeNextPath } from "@/lib/auth/redirects";
import { supabasePublicConfig } from "@/lib/supabase/config";

/**
 * Proxy (o "middleware" do Next 16). PRIMEIRA barreira, não a única:
 *
 *   - renova a sessão do Supabase e regrava os cookies (SSR);
 *   - manda quem não tem sessão para /login (exceto rotas públicas);
 *   - informa ao servidor a rota pedida (x-dg-pathname), para voltar a ela
 *     depois do login — sempre saneada antes de virar redirect.
 *
 * Não decide papel, MFA nem termos: isso é do servidor (requireAppSession /
 * authorizeAction) e da RLS, a cada requisição.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const withPath = () => {
    const headers = new Headers(request.headers);
    headers.set("x-dg-pathname", `${pathname}${request.nextUrl.search}`);
    return NextResponse.next({ request: { headers } });
  };

  let response = withPath();
  const { url, anonKey } = supabasePublicConfig();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, cacheHeaders) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = withPath();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(cacheHeaders).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Valida o JWT (assinatura) e renova a sessão quando preciso.
  const { data } = await supabase.auth.getClaims();
  const authenticated = Boolean(data?.claims?.sub);

  if (!authenticated && !isPublicPath(pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = AUTH_ROUTES.login;
    login.search = "";
    const next = safeNextPath(`${pathname}${request.nextUrl.search}`, "");
    if (next) login.searchParams.set("next", next);
    const redirect = NextResponse.redirect(login);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return response;
}

export const config = {
  // Tudo, menos arquivos estáticos e imagens do Next.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
