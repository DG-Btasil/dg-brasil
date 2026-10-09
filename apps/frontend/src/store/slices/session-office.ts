import { createSeedData, MOCK_PARTNER_OFFICE_IDS, MOCK_PARTNER_USER_IDS, MOCK_USER_IDS } from "@/mocks";
import { nowISO } from "@/lib/clock";
import { isPartnerRole, ROLE_LABEL } from "@/lib/permissions";
import { createId } from "@/lib/ids";
import type { Role } from "@/types";
import { auditEvent, currentUser, updateById, type GetState, type SetState } from "../helpers";
import type { AppState, OfficeActions, SessionActions } from "../types";

/**
 * PONTE TEMPORÁRIA (até a Etapa 4.3): a identidade e o papel vêm do Supabase
 * Auth, validados no servidor. Os módulos jurídicos ainda leem dados mock;
 * para recortá-los, a sessão real é associada a uma "persona" de demonstração
 * DO MESMO PAPEL. A persona nunca decide permissão (quem decide é o papel
 * real) e não é persistida no navegador.
 */
export const DEMO_USER_BY_ROLE: Record<Role, string> = {
  ADMIN: MOCK_USER_IDS.barbara,
  LAWYER: MOCK_USER_IDS.claudio,
  ASSISTANT: MOCK_USER_IDS.renata,
  PARTNER_ADMIN: MOCK_PARTNER_USER_IDS.marcos,
  PARTNER_USER: MOCK_PARTNER_USER_IDS.carla,
};

/** Escritório parceiro mock usado quando o nome real não tem correspondente. */
export const DEMO_PARTNER_OFFICE_ID = MOCK_PARTNER_OFFICE_IDS.almeida;

/** Sem sessão até o AuthProvider associar a persona do papel real. */
export function initialSession() {
  return { isAuthenticated: false, currentUserId: "" };
}

/** Persona mock para o papel real (parceiro: escritório mock de mesmo nome, se houver). */
export function demoPersonaId(state: Pick<AppState, "users" | "partnerOffices">, role: Role, organizationName?: string): string {
  if (!isPartnerRole(role)) return DEMO_USER_BY_ROLE[role];
  const name = organizationName?.trim().toLowerCase();
  const officeId = state.partnerOffices.find((p) => p.name.trim().toLowerCase() === name)?.id ?? DEMO_PARTNER_OFFICE_ID;
  const match =
    state.users.find((u) => u.partnerOfficeId === officeId && u.role === role && u.status === "ACTIVE") ??
    state.users.find((u) => u.partnerOfficeId === officeId && u.role === role);
  return match?.id ?? DEMO_USER_BY_ROLE[role];
}

export function createSessionSlice(set: SetState, get: GetState): SessionActions {
  return {
    bindDemoPersona: (userId) => set({ session: { isAuthenticated: true, currentUserId: userId } }),
    completeTour: (userId) =>
      set((s) => ({ users: updateById(s.users, userId, (u) => ({ ...u, hasCompletedTour: true })) })),
    resetDemo: () => {
      const fresh = createSeedData();
      const session = { ...initialSession(), currentUserId: get().session.currentUserId };
      set({ ...fresh, session, preferences: {} });
      set((s) => ({
        auditEvents: [auditEvent(s, "DEMO_RESET", "office", s.office.id, "Dados de demonstração restaurados."), ...s.auditEvents],
      }));
    },
  };
}

export function createOfficeSlice(set: SetState, get: GetState): OfficeActions {
  return {
    updateOffice: (patch) =>
      set((s) => ({
        office: { ...s.office, ...patch, updatedAt: nowISO() },
        auditEvents: [auditEvent(s, "OFFICE_UPDATED", "office", s.office.id, "Dados do escritório atualizados."), ...s.auditEvents],
      })),
    inviteUser: ({ name, email, role }) => {
      const s = get();
      const userId = createId("usr");
      const token = createId("convite");
      const inviter = currentUser(s);
      set({
        users: [
          ...s.users,
          {
            id: userId,
            officeId: s.office.id,
            name,
            displayName: name.split(/\s+/)[0] ?? name,
            email,
            role,
            title: "",
            status: "INVITED",
            hasCompletedTour: false,
            createdAt: nowISO(),
          },
        ],
        invitations: [
          ...s.invitations,
          { id: createId("inv"), officeId: s.office.id, token, email, name, role, invitedBy: inviter?.id ?? "", createdAt: nowISO() },
        ],
        auditEvents: [auditEvent(s, "USER_INVITED", "user", userId, `${name} convidado(a) como ${ROLE_LABEL[role]}.`), ...s.auditEvents],
      });
      return token;
    },
    acceptInvitation: (token, name) => {
      const s = get();
      const invitation = s.invitations.find((i) => i.token === token && !i.acceptedAt);
      if (!invitation) return false;
      const user = s.users.find((u) => u.email === invitation.email);
      if (!user) return false;
      set({
        invitations: updateById(s.invitations, invitation.id, (i) => ({ ...i, acceptedAt: nowISO() })),
        users: updateById(s.users, user.id, (u) => ({ ...u, name, status: "ACTIVE", lastAccessAt: nowISO() })),
        // Primeiro acesso de um parceiro com convite pendente ativa a parceria.
        partnerOffices: invitation.partnerOfficeId
          ? updateById(s.partnerOffices, invitation.partnerOfficeId, (p) =>
              p.status === "PENDING_INVITE" ? { ...p, status: "ACTIVE" as const, activatedAt: nowISO(), updatedAt: nowISO() } : p,
            )
          : s.partnerOffices,
      });
      return true;
    },
    changeUserRole: (userId, role) =>
      set((s) => {
        const user = s.users.find((u) => u.id === userId);
        return {
          users: updateById(s.users, userId, (u) => ({ ...u, role })),
          auditEvents: [auditEvent(s, "USER_ROLE_CHANGED", "user", userId, `Papel de ${user?.name ?? "usuário"} alterado.`), ...s.auditEvents],
        };
      }),
    updateUserPreferences: (userId, prefs) => set((s) => ({ preferences: { ...s.preferences, [userId]: prefs } })),
  };
}
