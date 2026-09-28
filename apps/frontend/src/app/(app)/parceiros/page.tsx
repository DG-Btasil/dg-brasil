import { RequirePermission } from "@/components/layout/guards";
import { PartnerList } from "@/features/partners/components/partner-list";

export default function PartnersPage() {
  return (
    <RequirePermission permission="partners.view">
      <PartnerList />
    </RequirePermission>
  );
}
