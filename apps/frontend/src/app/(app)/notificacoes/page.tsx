import { RequirePermission } from "@/components/layout/server-guards";
import { PortalNotifications } from "@/features/partner-portal/components/portal-account";

export default function NotificationsPage() {
  return (
    <RequirePermission permission="partnerPortal.view">
      <PortalNotifications />
    </RequirePermission>
  );
}
