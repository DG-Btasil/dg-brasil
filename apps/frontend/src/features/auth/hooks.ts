"use client";

import { useCallback } from "react";
import { audienceOf, can, type Audience, type Permission } from "@/lib/permissions";
import { useAppStore } from "@/store/app-store";
import type { Role } from "@/types";
import { useClientSession } from "./session-context";

/** Papel REAL (servidor). Nunca o da persona nem de algo salvo no navegador. */
export function useRole(): Role | undefined {
  return useClientSession()?.role;
}

/**
 * Público do usuário: OWNER (equipe da Bárbara Cardoso Advocacia) ou
 * PARTNER (escritório parceiro). Componentes usam para escolher QUAL tela
 * montar; o que cada tela pode ver continua decidido por permissões e pelo
 * escopo de dados (store/scope.ts).
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

/**
 * Ferramentas da demonstração (dados mock). Login/logout são do Supabase Auth;
 * a introdução do produto fica no banco (features/tour/product-tour-state).
 */
export function useSessionActions() {
  const resetDemo = useAppStore((s) => s.resetDemo);
  return { resetDemo };
}
