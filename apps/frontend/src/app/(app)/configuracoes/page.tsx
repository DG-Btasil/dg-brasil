import { RequirePermission } from "@/components/layout/guards";
import { SettingsPage } from "@/features/settings/components/settings-page";

export default function ConfiguracoesPage() {
  return (
    <RequirePermission permission="settings.view">
      <SettingsPage />
    </RequirePermission>
  );
}
