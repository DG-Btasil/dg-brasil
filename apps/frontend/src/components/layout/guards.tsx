"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import type { Permission } from "@/lib/permissions";
import { useIsAuthenticated, useIsPartner, usePermission } from "@/features/auth/hooks";
import { useOffice } from "@/features/offices/hooks";
import { useHydrated, useRehydrateOnMount } from "@/store/hydration";
import { Skeleton } from "@/components/feedback/states";
import { buttonClasses } from "@/components/ui/button";

/** Tela neutra enquanto o estado local é carregado. */
export function ShellSkeleton() {
  return (
    <div className="min-h-screen bg-background" role="status" aria-label="Carregando o DG Brasil">
      <div className="h-[var(--header-height)] bg-navy" />
      <div className="mx-auto max-w-[1600px] space-y-4 px-8 py-8">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96" />
        <div className="grid grid-cols-4 gap-4 pt-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

/** Aguarda a hidratação do localStorage antes de renderizar a aplicação. */
export function HydrationGate({ children, fallback = <ShellSkeleton /> }: { children: ReactNode; fallback?: ReactNode }) {
  useRehydrateOnMount();
  const hydrated = useHydrated();
  return hydrated ? <>{children}</> : <>{fallback}</>;
}

/**
 * Guard da área autenticada (simulado). Sem sessão → /login;
 * implantação não concluída → /onboarding.
 */
export function AuthGuard({ children, requireOnboarding = true }: { children: ReactNode; requireOnboarding?: boolean }) {
  const router = useRouter();
  const isAuthenticated = useIsAuthenticated();
  const office = useOffice();
  const needsOnboarding = requireOnboarding && !office.onboarding.completed;

  useEffect(() => {
    if (!isAuthenticated) router.replace("/login");
    else if (needsOnboarding) router.replace("/onboarding");
  }, [isAuthenticated, needsOnboarding, router]);

  if (!isAuthenticated || needsOnboarding) return <ShellSkeleton />;
  return <>{children}</>;
}

/**
 * Autorização de rota/trecho. Sem permissão, o conteúdo protegido NÃO é
 * renderizado (não é escondido por CSS). No backend, a mesma regra valerá
 * no servidor.
 */
export function RequirePermission({ permission, children, fallback }: { permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  const allowed = usePermission(permission);
  if (!allowed) return <>{fallback ?? <AccessDenied />}</>;
  return <>{children}</>;
}

/**
 * Escolhe a tela conforme o público: ambiente interno (Bárbara Cardoso
 * Advocacia) ou portal do parceiro. As duas árvores nunca são montadas
 * juntas, e cada uma lê apenas o estado já recortado para a sessão.
 */
export function AudienceSwitch({ owner, partner }: { owner: ReactNode; partner: ReactNode }) {
  return <>{useIsPartner() ? partner : owner}</>;
}

/** Renderiza os filhos somente com permissão; sem fallback visual. */
export function Can({ permission, children }: { permission: Permission; children: ReactNode }) {
  return usePermission(permission) ? <>{children}</> : null;
}

export function AccessDenied() {
  return (
    <div className="mx-auto mt-10 max-w-[520px] rounded-lg border border-line bg-surface px-8 py-10 text-center shadow-hairline">
      <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-navy-50 text-navy-700">
        <ShieldAlert className="size-5" aria-hidden />
      </div>
      <h1 className="text-[16px] font-semibold text-foreground">Acesso restrito</h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        Seu perfil não tem permissão para acessar esta área. Se precisar dela, fale com o administrador do seu escritório.
      </p>
      <Link href="/home" className={buttonClasses("secondary", "md", "mt-5")}>
        Voltar para a Home
      </Link>
    </div>
  );
}

export function PageContainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1600px] px-8 pb-16 pt-7 ${className}`}>{children}</div>;
}
