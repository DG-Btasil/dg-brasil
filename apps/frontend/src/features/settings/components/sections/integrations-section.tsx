"use client";

import { DataImportSection } from "@/features/data-import/components/data-import-section";
import { DriveSettingsPanel } from "@/features/drive/components/drive-settings-panel";
import { usePermission } from "@/features/auth/hooks";
import { JudicialSettingsPanel } from "@/features/judicial/components/judicial-settings-panel";
import { SectionHeader } from "../section-header";

export function IntegrationsSection() {
  const canSeeJudicial = usePermission("settings.integrations.view");
  return (
    <div>
      <SectionHeader
        title="Integrações"
        description="Serviços conectados ao escritório. Situação, última sincronização e ações disponíveis para o seu perfil."
      />
      <div className="space-y-8">
        {canSeeJudicial && <JudicialSettingsPanel />}
        <DriveSettingsPanel />
        <DataImportSection />
      </div>
    </div>
  );
}
