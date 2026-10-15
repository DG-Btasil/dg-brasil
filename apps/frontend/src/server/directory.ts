import "server-only";

import { cache } from "react";
import { loadAllPages } from "@/lib/actions/all-pages";
import type { ActionResult } from "@/lib/actions/result";
import type { Page } from "@/server/core/pagination";
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

/**
 * Lê todas as páginas: o diretório não pode cortar em 50 (quem ficasse fora
 * sumiria do "responsável" e viraria "—" nas telas). Acima do teto, parcial.
 */
async function allPages<T>(load: (page: number, pageSize: number) => Promise<ActionResult<Page<T>>>): Promise<{ ok: boolean; items: T[] }> {
  const r = await loadAllPages(load);
  return r.ok ? { ok: !r.data.hasMore, items: r.data.items } : { ok: false, items: [] };
}

export const loadOrgDirectory = cache(async (): Promise<OrgDirectory> => {
  const session = await requireAppSession();
  const partnerSurface = session.surface === "PARTNER";

  const [owner, users, partners] = await Promise.all([
    partnerSurface
      ? getOwnerOfficeAction().then((r) => (r.ok ? { id: r.data.office.id, name: r.data.office.name } : null))
      : Promise.resolve({ id: session.organizationId, name: session.organizationName }),
    allPages((page, pageSize) => listOrganizationUsersAction({ page, pageSize, sortBy: "createdAt", sortDirection: "asc" })),
    partnerSurface
      ? Promise.resolve({ ok: true, items: [{ id: session.organizationId, name: session.organizationName, status: "ACTIVE" as const }] })
      : can(session.role, "partners.view")
        ? allPages((page, pageSize) => listPartnersAction({ page, pageSize }))
        : Promise.resolve({ ok: true, items: [] }),
  ]);

  return {
    owner: owner ?? { id: "", name: "Escritório" },
    users: users.items.filter((u) => u.active).map((u) => ({ id: u.userId, name: u.name, displayName: u.displayName, role: u.role, hasOab: !!u.oab })),
    partners: partners.items.map((p) => ({ id: p.id, name: p.name, status: p.status })),
    complete: owner !== null && users.ok && partners.ok,
  };
});
