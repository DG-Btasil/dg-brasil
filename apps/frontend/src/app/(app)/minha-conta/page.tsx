import { RequirePermission } from "@/components/layout/server-guards";
import { PortalAccount } from "@/features/partner-portal/components/portal-account";
import { can } from "@/lib/permissions";
import { requireAppSession } from "@/server/auth/session";
import { getMyPartnerOfficeAction, getMyPartnerSettingsAction } from "@/server/domain/organizations/actions";

/** Escritório da SESSÃO (nunca da URL); a divisão só para quem tem partnerPortal.finance.view (PARTNER_ADMIN). */
async function Account() {
  const session = await requireAppSession();
  const [office, settings] = await Promise.all([
    getMyPartnerOfficeAction(),
    can(session.role, "partnerPortal.finance.view") ? getMyPartnerSettingsAction() : Promise.resolve(undefined),
  ]);
  return <PortalAccount office={office} settings={settings} />;
}

export default function AccountPage() {
  return (
    <RequirePermission permission="partnerPortal.view">
      <Account />
    </RequirePermission>
  );
}
