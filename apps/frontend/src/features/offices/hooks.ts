"use client";

import { useMemo } from "react";
import { useAppStore } from "@/store/app-store";
import { useScopedStore } from "@/store/scope";
import type { ID, Office, User } from "@/types";

export function useOffice(): Office {
  return useScopedStore((s) => s.office);
}

/** Todos os usuários visíveis na sessão (equipe interna e, para a equipe interna, também os de parceiros). */
export function useAllUsers(): User[] {
  return useScopedStore((s) => s.users);
}

/** Equipe do escritório do usuário: interna (sem parceiros) ou, no portal, o próprio escritório parceiro. */
export function useUsers(): User[] {
  const users = useAllUsers();
  const currentUserId = useAppStore((s) => s.session.currentUserId);
  return useMemo(() => {
    const me = users.find((u) => u.id === currentUserId);
    return users.filter((u) => (u.partnerOfficeId ?? null) === (me?.partnerOfficeId ?? null));
  }, [users, currentUserId]);
}

/** Mapa id → usuário, para exibir responsáveis em listas sem buscas repetidas. */
export function useUserMap(): Map<ID, User> {
  const users = useAllUsers();
  return useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
}

export function useUser(id: ID | undefined): User | undefined {
  const users = useAllUsers();
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

export function usePreferences() {
  return useAppStore((s) => s.preferences);
}
