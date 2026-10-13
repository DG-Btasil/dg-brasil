"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { DirectoryUser, OrgDirectory } from "@/lib/directory/types";
import { defaultClientOrigin, getAllowedClientOrigins, originOfficeName, type ClientOriginOption, type OriginContext } from "@/lib/permissions/client-origin";
import type { ID } from "@/types";
import { useClientSession } from "@/features/auth/session-context";

/**
 * Diretório REAL da organização no navegador (lido no servidor a cada
 * navegação, ver server/directory.ts). Só leitura. Telas já conectadas ao
 * backend usam estes hooks — nunca `useUser`/`useOffice` do mock.
 */

const EMPTY: OrgDirectory = { owner: { id: "", name: "" }, users: [], partners: [], complete: false };
const DirectoryContext = createContext<OrgDirectory>(EMPTY);

export function OrgDirectoryProvider({ directory, children }: { directory: OrgDirectory; children: ReactNode }) {
  return <DirectoryContext.Provider value={directory}>{children}</DirectoryContext.Provider>;
}

export function useOrgDirectory(): OrgDirectory {
  return useContext(DirectoryContext);
}

export function useDirectoryUserMap(): Map<ID, DirectoryUser> {
  const { users } = useOrgDirectory();
  return useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
}

export function useDirectoryUser(id: ID | undefined): DirectoryUser | undefined {
  const map = useDirectoryUserMap();
  return id ? map.get(id) : undefined;
}

/** Integrantes ativos que podem ser responsáveis (Select). */
export function useResponsibleUserOptions(): { value: ID; label: string }[] {
  const { users } = useOrgDirectory();
  return useMemo(() => users.map((u) => ({ value: u.id, label: u.name })), [users]);
}

/** Nome de um escritório (proprietário ou parceiro visível). */
export function useOrganizationName(id: ID | undefined): string | undefined {
  const { owner, partners } = useOrgDirectory();
  return originOfficeName(id, owner, partners);
}

export function useOrganizationNames(): Map<ID, string> {
  const { owner, partners } = useOrgDirectory();
  return useMemo(() => new Map([[owner.id, owner.name], ...partners.map((p) => [p.id, p.name] as [ID, string])]), [owner, partners]);
}

/** Contexto da regra central de origem (lib/permissions/client-origin) com dados reais. */
export function useOriginContext(): OriginContext {
  const session = useClientSession();
  const { owner, partners } = useOrgDirectory();
  return useMemo(
    () => ({
      role: session?.role,
      partnerOfficeId: session?.surface === "PARTNER" ? session.organizationId : undefined,
      owner,
      partners,
    }),
    [session, owner, partners],
  );
}

/**
 * Opções de "Origem do cliente". `current` mantém visível a origem já gravada
 * mesmo que não seja mais atribuível (ex.: parceiro inativo).
 */
export function useOriginOptions(current?: ID): ClientOriginOption[] {
  const ctx = useOriginContext();
  return useMemo(() => {
    const options = getAllowedClientOrigins(ctx);
    if (current && !options.some((o) => o.value === current)) {
      const label = originOfficeName(current, ctx.owner, ctx.partners);
      if (label) return [...options, { value: current, label }];
    }
    return options;
  }, [ctx, current]);
}

export function useDefaultOrigin(): ID {
  return defaultClientOrigin(useOriginContext());
}
