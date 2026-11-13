"use client";

import { useCallback } from "react";
import { audienceOf, can, type Audience, type Permission } from "@/lib/permissions";
import type { Role } from "@/types";
import { useClientSession } from "./session-context";

/** Papel REAL (servidor). Nunca o da persona nem de algo salvo no navegador. */
export function useRole(): Role | undefined {
  return useClientSession()?.role;
}

/**
 * Público do usuário: OWNER (equipe da Barbara Cardoso Advocacia) ou
 * PARTNER (escritório parceiro). Componentes usam para escolher QUAL tela
 * montar; o que cada tela pode ver continua decidido por permissões e pelo
 * servidor.
 */
export function useAudience(): Audience | undefined {
  return audienceOf(useRole());
}

export function useIsPartner(): boolean {
  return useAudience() === "PARTNER";
}

/** Só decide o que RENDERIZAR. A autorização de verdade é do servidor e da RLS. */
export function usePermission(permission: Permission): boolean {
  return can(useRole(), permission);
}

/** Retorna uma função `can(permission)` ligada ao papel atual. */
export function useCan(): (permission: Permission) => boolean {
  const role = useRole();
  return useCallback((permission: Permission) => can(role, permission), [role]);
}
