import { RequirePermission } from "@/components/layout/server-guards";
import { PortalPending } from "@/features/partner-portal/components/portal-pending";

export default function PendingPage() {
  return (
    <RequirePermission permission="partnerPortal.view">
      <PortalPending />
    </RequirePermission>
  );
}
