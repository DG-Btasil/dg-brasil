import { RequirePermission } from "@/components/layout/server-guards";
import { PortalPending } from "@/features/partner-portal/components/portal-pending";
import { requestListInput } from "@/features/partner-requests/query";
import { listPartnerRequestsAction } from "@/server/domain/partner-requests/actions";

/** Solicitações do próprio escritório (escopo vazio: a RLS recorta ao parceiro da sessão). */
async function Pending() {
  return <PortalPending initial={await listPartnerRequestsAction(requestListInput({}))} />;
}

export default function PendingPage() {
  return (
    <RequirePermission permission="partnerPortal.view">
      <Pending />
    </RequirePermission>
  );
}
