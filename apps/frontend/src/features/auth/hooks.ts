"use client";

import { useCallback, useMemo } from "react";
import { audienceOf, can, type Audience, type Permission } from "@/lib/permissions";
import { useAppStore } from "@/store/app-store";
import { useScopedStore } from "@/store/scope";
import type { ID, PartnerOffice, Role, User } from "@/types";
import { useClientSession } from "./session-context";

/**
 * Usuário logado. Identidade (nome, e-mail, papel) vem da sessão REAL
 * validada no servidor; o `id` ainda é o da persona mock do mesmo papel,
 * para os módulos jurídicos de demonstração (até a Etapa 4.3).
 */
export function useCurrentUser(): User | undefined {
  const session = useClientSession();
  const users = useScopedStore((s) => s.users);
  const currentUserId = useAppStore((s) => s.session.currentUserId);
  return useMemo(() => {
    const persona = users.find((u) => u.id === currentUserId);
    if (!persona || !session) return undefined;
    return {
      ...persona,
      name: session.fullName,
      displayName: session.displayName,
      email: session.email,
      role: session.role,
      title: session.jobTitle ?? persona.title,
    };
  }, [users, currentUserId, session]);
}

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

/** Escritório parceiro (mock) da sessão, para o recorte dos dados de demonstração. */
export function useCurrentPartnerOfficeId(): ID | undefined {
  const user = useCurrentUser();
  return audienceOf(user?.role) === "PARTNER" ? user?.partnerOfficeId : undefined;
}

/** Dados do escritório parceiro da sessão (já recortados pelo escopo). */
export function useCurrentPartnerOffice(): PartnerOffice | undefined {
  const id = useCurrentPartnerOfficeId();
  const offices = useScopedStore((s) => s.partnerOffices);
  return useMemo(() => (id ? offices.find((o) => o.id === id) : undefined), [offices, id]);
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

/** Ferramentas da demonstração (dados mock). Login/logout são do Supabase Auth. */
export function useSessionActions() {
  const resetDemo = useAppStore((s) => s.resetDemo);
  const completeTour = useAppStore((s) => s.completeTour);
  return { resetDemo, completeTour };
}
