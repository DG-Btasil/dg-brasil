import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/server-guards";
import { SettingsPage } from "@/features/settings/components/settings-page";

/** "Ligar todas" e "Sincronizar tudo agora" do Google Drive rodam como Server Action desta rota, em lotes de 40 s. */
export const maxDuration = 60;
export const metadata: Metadata = { title: "Configurações" };

export default function ConfiguracoesPage() {
  return (
    // Quem só edita as próprias notificações (ASSISTANT) entra e vê só essa seção.
    <RequirePermission permission={["settings.view", "settings.notifications.edit"]}>
      <SettingsPage />
    </RequirePermission>
  );
}
