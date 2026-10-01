import { RequirePermission } from "@/components/layout/guards";
import { DgReferencesPage } from "@/features/dg-brasil/components/shared/dg-home";

/** Referências: somente Administrador (o layout já exige "dgbrasil.view"). */
export default function DgReferencesRoute() {
  return (
    <RequirePermission permission="dgbrasil.manage">
      <DgReferencesPage />
    </RequirePermission>
  );
}
