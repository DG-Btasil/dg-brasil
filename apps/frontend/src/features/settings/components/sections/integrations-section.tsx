"use client";

import { DataImportSection } from "@/features/data-import/components/data-import-section";
import { DriveSettingsPanel } from "@/features/drive/components/drive-settings-panel";
import { usePermission } from "@/features/auth/hooks";
import { IntegrationsList } from "@/features/integrations/components/integrations-list";
import { JudicialSettingsPanel } from "@/features/judicial/components/judicial-settings-panel";
import { DemoAreaNotice } from "@/components/feedback/demo-area-notice";
import { SectionHeader } from "../section-header";

export function IntegrationsSection() {
  const canSeeJudicial = usePermission("settings.integrations.view");
  return (
    <div>
      <SectionHeader
        title="Integrações"
        description="Serviços conectados ao escritório. Status, última sincronização e ações disponíveis para o seu perfil."
      />
      <div className="mb-8 space-y-8">
        {canSeeJudicial && <JudicialSettingsPanel />}
        <DriveSettingsPanel />
        <DataImportSection />
      </div>
      {/* Integração judicial, Google Drive e importação, acima, já são reais; o aviso vale só para o que vem abaixo. */}
      <DemoAreaNotice area="A parte abaixo (outros serviços)" />
      <div className="space-y-8">
        <section aria-labelledby="other-integrations-title" className="space-y-3">
          <h3 id="other-integrations-title" className="text-[15px] font-semibold text-foreground">
            Outros serviços
          </h3>
          <IntegrationsList />
        </section>
      </div>
    </div>
  );
}
