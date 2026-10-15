import "server-only";

import { cache } from "react";
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

/** Teto de páginas por leitura (50 × 20 = 1.000 registros); acima disso, parcial. */
const MAX_DIRECTORY_PAGES = 20;

/**
 * Lê todas as páginas de uma listagem: o diretório não pode cortar em 50
 * (quem ficasse fora sumiria do "responsável" e viraria "—" nas telas).
 */
async function allPages<T>(load: (page: number) => Promise<ActionResult<Page<T>>>): Promise<{ ok: boolean; items: T[] }> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_DIRECTORY_PAGES; page++) {
    const r = await load(page);
    if (!r.ok) return { ok: false, items };
    items.push(...r.data.items);
    if (!r.data.hasMore) return { ok: true, items };
  }
  return { ok: false, items };
}
export const loadOrgDirectory = cache(async (): Promise<OrgDirectory> => {
  const session = await requireAppSession();
  const partnerSurface = session.surface === "PARTNER";

  const [owner, users, partners] = await Promise.all([
    partnerSurface
      ? getOwnerOfficeAction().then((r) => (r.ok ? { id: r.data.office.id, name: r.data.office.name } : null))
      : Promise.resolve({ id: session.organizationId, name: session.organizationName }),
    allPages((page) => listOrganizationUsersAction({ page, pageSize: 50, sortBy: "createdAt", sortDirection: "asc" })),
    partnerSurface
      ? Promise.resolve({ ok: true, items: [{ id: session.organizationId, name: session.organizationName, status: "ACTIVE" as const }] })
      : can(session.role, "partners.view")
        ? allPages((page) => listPartnersAction({ page, pageSize: 50 }))
        : Promise.resolve({ ok: true, items: [] }),
  ]);

  return {
    owner: owner ?? { id: "", name: "Escritório" },
    users: users.items.filter((u) => u.active).map((u) => ({ id: u.userId, name: u.name, displayName: u.displayName, role: u.role, hasOab: !!u.oab })),
    partners: partners.items.map((p) => ({ id: p.id, name: p.name, status: p.status })),
    complete: owner !== null && users.ok && partners.ok,
  };
});
