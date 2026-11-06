"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, type ComponentType } from "react";
import { PageContainer } from "@/components/layout/guards";
import { PageHeader } from "@/components/ui/display";
import { Callout, Skeleton } from "@/components/feedback/states";
import { useCan } from "@/features/auth/hooks";
import { cn } from "@/lib/cn";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import { MOVED_SECTIONS, SECTION_META, useAllowedSections, type SettingsSection } from "../hooks";
import { AccountSection } from "./sections/account-section";
import { GeneralSection } from "./sections/general-section";
import { NotificationsSection } from "./sections/notifications-section";
import { SecuritySection } from "./sections/security-section";
import { TeamSection } from "./sections/team-section";

const SECTION_COMPONENT: Record<SettingsSection, ComponentType> = {
  geral: GeneralSection,
  equipe: TeamSection,
  notificacoes: NotificationsSection,
  conta: AccountSection,
  seguranca: SecuritySection,
};

export function SettingsPage() {
  return (
    <PageContainer>
      <PageHeader title="Configurações" description="Escritório, equipe, integrações e preferências. Cada seção aparece conforme o seu perfil." />
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsContent />
      </Suspense>
    </PageContainer>
  );
}

/**
 * Link antigo para uma seção que mudou de lugar (ex.: `?secao=honorarios`):
 * quem tem acesso vai para o novo lugar; os demais ficam na seção padrão.
 */
function useMovedSection() {
  const router = useRouter();
  const can = useCan();
  const raw = useSearchParams().get("secao") ?? "";
  const moved = Object.hasOwn(MOVED_SECTIONS, raw) ? MOVED_SECTIONS[raw] : undefined;
  const allowed = !!moved && can(moved.permission);
  useEffect(() => {
    if (moved && allowed) router.replace(moved.href);
  }, [moved, allowed, router]);
  return moved && allowed ? moved : undefined;
}

function SettingsContent() {
  const allowed = useAllowedSections();
  const [section, setSection] = useUrlTab<SettingsSection>(allowed, allowed[0] ?? "geral", "secao");
  const moved = useMovedSection();
  const Section = SECTION_COMPONENT[section];

  if (moved) {
    return (
      <Callout tone="info" title="Esta seção mudou de lugar.">
        Abrindo{" "}
        <Link href={moved.href} className="text-navy-700 underline underline-offset-2">
          {moved.label}
        </Link>
        …
      </Callout>
    );
  }

  return (
    <div className="grid grid-cols-[232px_minmax(0,1fr)] items-start gap-8">
      <nav aria-label="Seções das configurações" className="sticky top-[calc(var(--header-height)+24px)]">
        <ul className="space-y-0.5 border-l border-line">
          {allowed.map((key) => {
            const active = key === section;
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setSection(key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-ml-px block w-full border-l-2 py-2 pl-4 pr-2 text-left transition-colors",
                    active ? "border-gold bg-surface" : "border-transparent hover:border-line-strong hover:bg-surface-muted",
                  )}
                >
                  <span className={cn("block text-[13px]", active ? "font-semibold text-navy" : "font-medium text-foreground")}>{SECTION_META[key].label}</span>
                  <span className="block text-[11.5px] leading-snug text-muted">{SECTION_META[key].description}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <section aria-label={SECTION_META[section].label} className="min-w-0">
        <Section />
      </section>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="grid grid-cols-[232px_minmax(0,1fr)] gap-8" role="status" aria-label="Carregando configurações">
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}
