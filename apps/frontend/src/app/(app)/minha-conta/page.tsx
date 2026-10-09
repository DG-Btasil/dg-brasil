import { RequirePermission } from "@/components/layout/server-guards";
import { PortalAccount } from "@/features/partner-portal/components/portal-account";

export default function AccountPage() {
  return (
    <RequirePermission permission="partnerPortal.view">
      <PortalAccount />
    </RequirePermission>
  );
}
