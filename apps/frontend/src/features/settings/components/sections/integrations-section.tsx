"use client";

import { DataImportSection } from "@/features/data-import/components/data-import-section";
import { DriveSettingsPanel } from "@/features/drive/components/drive-settings-panel";
import { usePermission } from "@/features/auth/hooks";
import { IntegrationsList } from "@/features/integrations/components/integrations-list";
import { JudicialIntegrationSection } from "@/features/integrations/components/judicial-integration-section";
import { DemoAreaNotice } from "@/components/feedback/demo-area-notice";
import { SectionHeader } from "../section-header";

export function IntegrationsSection() {
  const canManage = usePermission("settings.integrations.manage");
  return (
    <div>
      <SectionHeader
        title="Integrações"
        description="Serviços conectados ao escritório. Status, última sincronização e ações disponíveis para o seu perfil."
      />
      <div className="mb-8">
        <DriveSettingsPanel />
      </div>
      <DemoAreaNotice area="Integrações e importação de dados" />
      <div className="space-y-8">
        <JudicialIntegrationSection canManage={canManage} />
        <DataImportSection canManage={canManage} />
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
