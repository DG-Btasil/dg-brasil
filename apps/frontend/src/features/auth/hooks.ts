"use client";

import { useCallback, useMemo } from "react";
import { audienceOf, can, type Audience, type Permission } from "@/lib/permissions";
import { useAppStore } from "@/store/app-store";
import { useScopedStore } from "@/store/scope";
import type { ID, Invitation, PartnerOffice, Role, User } from "@/types";

/** Usuário logado (simulado). */
export function useCurrentUser(): User | undefined {
  const users = useScopedStore((s) => s.users);
  const currentUserId = useAppStore((s) => s.session.currentUserId);
  return users.find((u) => u.id === currentUserId);
}

export function useRole(): Role | undefined {
  return useCurrentUser()?.role;
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

/** Escritório parceiro da sessão (currentPartnerOfficeId). Ausente para a equipe interna. */
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

/* ------------------------------------------------------------------ */
/* Telas públicas (antes do login)                                     */
/* ------------------------------------------------------------------ */

/**
 * Contas de demonstração exibidas na tela de login. Ferramenta do
 * protótipo: lê a base sem recorte, pois ainda não há sessão.
 */
export function useDemoAccounts(): User[] {
  const users = useAppStore((s) => s.users);
  const partners = useAppStore((s) => s.partnerOffices);
  return useMemo(() => {
    const active = new Set(partners.filter((p) => p.status === "ACTIVE").map((p) => p.id));
    return users.filter((u) => u.status === "ACTIVE" && (!u.partnerOfficeId || active.has(u.partnerOfficeId)));
  }, [users, partners]);
}

export type InvitationLookup =
  | { state: "valid"; invitation: Invitation; officeName: string; inviterName: string; partnerOfficeName?: string }
  | { state: "used"; invitation: Invitation }
  | { state: "invalid" };

/**
 * Localiza um convite pelo token. Equivale a um endpoint público que
 * responde só pelo token (não depende de sessão), por isso lê sem recorte.
 */
export function useInvitationLookup(token: string): InvitationLookup {
  const invitations = useAppStore((s) => s.invitations);
  const users = useAppStore((s) => s.users);
  const office = useAppStore((s) => s.office);
  const partners = useAppStore((s) => s.partnerOffices);
  return useMemo(() => {
    const invitation = invitations.find((i) => i.token === token);
    if (!invitation) return { state: "invalid" };
    if (invitation.acceptedAt) return { state: "used", invitation };
    const inviter = users.find((u) => u.id === invitation.invitedBy);
    const partner = invitation.partnerOfficeId ? partners.find((p) => p.id === invitation.partnerOfficeId) : undefined;
    return {
      state: "valid",
      invitation,
      officeName: office.name,
      inviterName: inviter?.name ?? "A administração do escritório",
      partnerOfficeName: partner?.name,
    };
  }, [invitations, users, office.name, partners, token]);
}
