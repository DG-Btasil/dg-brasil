import "server-only";

import { cache } from "react";
import type { OrgDirectory } from "@/lib/directory/types";
import { can } from "@/lib/permissions";
import { requireAppSession } from "@/server/auth/session";
import { getOwnerOfficeAction, listOrganizationUsersAction, listPartnersAction } from "@/server/domain/organizations/actions";

/**
 * Diretório da organização para a área autenticada, uma vez por requisição.
 * Passa pelas mesmas Server Actions do navegador (sessão + permissão + RLS):
 * nada aqui usa service role nem confia em parâmetro de tela.
 *
 * Falha numa leitura não derruba a página: o diretório volta parcial
 * (`complete: false`) e as telas mostram "—" no lugar do nome.
 */
export const loadOrgDirectory = cache(async (): Promise<OrgDirectory> => {
  const session = await requireAppSession();
  const partnerSurface = session.surface === "PARTNER";

  const [owner, users, partners] = await Promise.all([
    partnerSurface
      ? getOwnerOfficeAction().then((r) => (r.ok ? { id: r.data.office.id, name: r.data.office.name } : null))
      : Promise.resolve({ id: session.organizationId, name: session.organizationName }),
    listOrganizationUsersAction({ pageSize: 50, sortBy: "createdAt", sortDirection: "asc" }),
    partnerSurface
      ? Promise.resolve({ ok: true as const, data: { items: [{ id: session.organizationId, name: session.organizationName, status: "ACTIVE" as const }] } })
      : can(session.role, "partners.view")
        ? listPartnersAction({ pageSize: 50 })
        : Promise.resolve({ ok: true as const, data: { items: [] } }),
  ]);

  return {
    owner: owner ?? { id: "", name: "Escritório" },
    users: users.ok
      ? users.data.items.filter((u) => u.active).map((u) => ({ id: u.userId, name: u.name, displayName: u.displayName, role: u.role }))
      : [],
    partners: partners.ok ? partners.data.items.map((p) => ({ id: p.id, name: p.name, status: p.status })) : [],
    complete: owner !== null && users.ok && partners.ok,
  };
});
