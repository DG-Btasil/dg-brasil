"use client";

import { Suspense, type ComponentType } from "react";
import { PageContainer } from "@/components/layout/guards";
import { PageHeader } from "@/components/ui/display";
import { Skeleton } from "@/components/feedback/states";
import { cn } from "@/lib/cn";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import { SECTION_META, useAllowedSections, type SettingsSection } from "../hooks";
import { AccountSection } from "./sections/account-section";
import { AiSection } from "./sections/ai-section";
import { FeesSection } from "./sections/fees-section";
import { GeneralSection } from "./sections/general-section";
import { IntegrationsSection } from "./sections/integrations-section";
import { NotificationsSection } from "./sections/notifications-section";
import { SecuritySection } from "./sections/security-section";
import { TeamSection } from "./sections/team-section";

const SECTION_COMPONENT: Record<SettingsSection, ComponentType> = {
  geral: GeneralSection,
  equipe: TeamSection,
  integracoes: IntegrationsSection,
  ia: AiSection,
  honorarios: FeesSection,
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

function SettingsContent() {
  const allowed = useAllowedSections();
  const [section, setSection] = useUrlTab<SettingsSection>(allowed, allowed[0] ?? "geral", "secao");
  const Section = SECTION_COMPONENT[section];

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
