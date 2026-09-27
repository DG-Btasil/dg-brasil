"use client";

import { useMemo } from "react";
import { useAppStore } from "@/store/app-store";
import type { ID, Office, Subscription, User } from "@/types";

export function useOffice(): Office {
  return useAppStore((s) => s.office);
}

export function useSubscription(): Subscription {
  return useAppStore((s) => s.subscription);
}

export function useUsers(): User[] {
  return useAppStore((s) => s.users);
}

/** Mapa id → usuário, para exibir responsáveis em listas sem buscas repetidas. */
export function useUserMap(): Map<ID, User> {
  const users = useUsers();
  return useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
}

export function useUser(id: ID | undefined): User | undefined {
  const users = useUsers();
  return useMemo(() => users.find((u) => u.id === id), [users, id]);
}

/** Usuários ativos que podem ser responsáveis por clientes e processos. */
export function useResponsibleOptions(): { value: ID; label: string }[] {
  const users = useUsers();
  return useMemo(
    () => users.filter((u) => u.status === "ACTIVE").map((u) => ({ value: u.id, label: u.name })),
    [users],
  );
}

export function useInvitations() {
  return useAppStore((s) => s.invitations);
}

export function useUserSessions() {
  return useAppStore((s) => s.sessions);
}

export function useAuditEvents() {
  return useAppStore((s) => s.auditEvents);
}

export function usePreferences() {
  return useAppStore((s) => s.preferences);
}
