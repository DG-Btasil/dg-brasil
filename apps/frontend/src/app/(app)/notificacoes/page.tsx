import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/server-guards";
import { NotificationsPage } from "@/features/notifications/components/notifications-page";
import { listNotificationsAction } from "@/server/domain/notifications/actions";

export const metadata: Metadata = { title: "Notificações" };

/** Caixa do PRÓPRIO usuário (o destinatário vem da sessão; a RLS confere). */
async function Notifications() {
  return <NotificationsPage initialResult={await listNotificationsAction({ unreadOnly: false, page: 1, pageSize: 25 })} />;
}

export default function NotificationsRoute() {
  return (
    // Caixa do próprio usuário: parceiros e toda a equipe interna (quem recebe avisos tem a permissão das preferências).
    <RequirePermission permission={["partnerPortal.view", "settings.notifications.edit"]}>
      <Notifications />
    </RequirePermission>
  );
}
