import { RequirePermission } from "@/components/layout/guards";
import { PortalAccount } from "@/features/partner-portal/components/portal-account";

export default function AccountPage() {
  return (
    <RequirePermission permission="partnerPortal.view">
      <PortalAccount />
    </RequirePermission>
  );
}
