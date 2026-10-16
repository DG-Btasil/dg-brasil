import { RequirePermission } from "@/components/layout/server-guards";
import { SettingsPage } from "@/features/settings/components/settings-page";

export default function ConfiguracoesPage() {
  return (
    // Quem só edita as próprias notificações (ASSISTANT) entra e vê só essa seção.
    <RequirePermission permission={["settings.view", "settings.notifications.edit"]}>
      <SettingsPage />
    </RequirePermission>
  );
}
