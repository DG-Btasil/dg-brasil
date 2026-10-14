import { RequirePermission } from "@/components/layout/server-guards";
import { NotificationsPage } from "@/features/notifications/components/notifications-page";
import { listNotificationsAction } from "@/server/domain/notifications/actions";

/** Caixa do PRÓPRIO usuário (o destinatário vem da sessão; a RLS confere). */
async function Notifications() {
  return <NotificationsPage initialResult={await listNotificationsAction({ unreadOnly: false, page: 1, pageSize: 25 })} />;
}

export default function NotificationsRoute() {
  return (
    <RequirePermission permission="partnerPortal.view">
      <Notifications />
    </RequirePermission>
  );
}
