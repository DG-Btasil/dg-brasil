"use client";

import { useCallback } from "react";
import { can, type Permission } from "@/lib/permissions";
import { useAppStore } from "@/store/app-store";
import type { Role, User } from "@/types";

/** Usuário logado (simulado). */
export function useCurrentUser(): User | undefined {
  const users = useAppStore((s) => s.users);
  const currentUserId = useAppStore((s) => s.session.currentUserId);
  return users.find((u) => u.id === currentUserId);
}

export function useRole(): Role | undefined {
  return useCurrentUser()?.role;
}

export function usePermission(permission: Permission): boolean {
  return can(useRole(), permission);
}

/** Retorna uma função `can(permission)` ligada ao papel atual. */
export function useCan(): (permission: Permission) => boolean {
  const role = useRole();
  return useCallback((permission: Permission) => can(role, permission), [role]);
}

export function useIsAuthenticated(): boolean {
  return useAppStore((s) => s.session.isAuthenticated);
}

/** Ações de sessão e ferramentas de demonstração. */
export function useSessionActions() {
  const login = useAppStore((s) => s.login);
  const logout = useAppStore((s) => s.logout);
  const simulateRole = useAppStore((s) => s.simulateRole);
  const resetDemo = useAppStore((s) => s.resetDemo);
  const completeTour = useAppStore((s) => s.completeTour);
  return { login, logout, simulateRole, resetDemo, completeTour };
}
