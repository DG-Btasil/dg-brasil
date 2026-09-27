import { createSeedData, MOCK_USER_IDS } from "@/mocks";
import { nowISO } from "@/lib/clock";
import { ROLE_LABEL } from "@/lib/permissions";
import { createId } from "@/lib/ids";
import type { Role } from "@/types";
import { auditEvent, currentUser, updateById, type GetState, type SetState } from "../helpers";
import type { OfficeActions, SessionActions } from "../types";

/** Usuário de demonstração assumido em cada papel ao "simular perfil". */
export const DEMO_USER_BY_ROLE: Record<Role, string> = {
  ADMIN: MOCK_USER_IDS.marina,
  LAWYER: MOCK_USER_IDS.rafael,
  ASSISTANT: MOCK_USER_IDS.camila,
};

export function initialSession() {
  return { isAuthenticated: true, currentUserId: DEMO_USER_BY_ROLE.ADMIN };
}

export function createSessionSlice(set: SetState, get: GetState): SessionActions {
  return {
    login: (email) => {
      const user = get().users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.status === "ACTIVE");
      if (!user) return false;
      set({
        session: { isAuthenticated: true, currentUserId: user.id },
        users: updateById(get().users, user.id, (u) => ({ ...u, lastAccessAt: nowISO() })),
      });
      return true;
    },
    logout: () => set((s) => ({ session: { ...s.session, isAuthenticated: false } })),
    simulateRole: (role) =>
      set((s) => ({ session: { ...s.session, isAuthenticated: true, currentUserId: DEMO_USER_BY_ROLE[role] } })),
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
    createOffice: (input) => {
      const now = nowISO();
      const adminId = DEMO_USER_BY_ROLE.ADMIN;
      const firstName = input.adminName.trim().split(/\s+/)[0] ?? input.adminName;
      set((s) => ({
        // Identidade do escritório começa em branco; os dados operacionais de
        // demonstração (clientes, processos…) continuam associados a ele.
        office: {
          id: s.office.id,
          name: input.officeName,
          tradeName: input.officeName,
          phone: input.phone,
          email: input.adminEmail,
          principalLawyer: input.adminName,
          oab: input.oab,
          statesOfPractice: [],
          units: [],
          onboarding: { completed: false, currentStep: 0, completedSteps: [], skippedSteps: [], answers: {} },
          createdAt: now,
          updatedAt: now,
        },
        users: updateById(s.users, adminId, (u) => ({
          ...u,
          name: input.adminName,
          displayName: input.oab ? `Dr(a). ${firstName}` : firstName,
          email: input.adminEmail,
          oab: input.oab,
          hasCompletedTour: false,
        })),
        session: { isAuthenticated: true, currentUserId: adminId },
      }));
      set((s) => ({
        auditEvents: [auditEvent(s, "OFFICE_CREATED", "office", s.office.id, `Escritório ${input.officeName} criado.`), ...s.auditEvents],
      }));
    },
    updateOffice: (patch) =>
      set((s) => ({
        office: { ...s.office, ...patch, updatedAt: nowISO() },
        auditEvents: [auditEvent(s, "OFFICE_UPDATED", "office", s.office.id, "Dados do escritório atualizados."), ...s.auditEvents],
      })),
    saveOnboardingStep: (stepKey, answers, nextStep, skipped = false) =>
      set((s) => {
        const ob = s.office.onboarding;
        return {
          office: {
            ...s.office,
            onboarding: {
              ...ob,
              currentStep: nextStep,
              answers: { ...ob.answers, [stepKey]: answers },
              completedSteps: skipped ? ob.completedSteps.filter((k) => k !== stepKey) : Array.from(new Set([...ob.completedSteps, stepKey])),
              skippedSteps: skipped ? Array.from(new Set([...ob.skippedSteps, stepKey])) : ob.skippedSteps.filter((k) => k !== stepKey),
            },
          },
        };
      }),
    setOnboardingStep: (step) =>
      set((s) => ({ office: { ...s.office, onboarding: { ...s.office.onboarding, currentStep: step } } })),
    completeOnboarding: () =>
      set((s) => ({
        office: {
          ...s.office,
          onboarding: { ...s.office.onboarding, completed: true, completedAt: nowISO() },
          updatedAt: nowISO(),
        },
        subscription: { ...s.subscription, implementationStatus: "COMPLETED" },
        auditEvents: [auditEvent(s, "ONBOARDING_COMPLETED", "office", s.office.id, "Implantação do escritório concluída."), ...s.auditEvents],
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
        session: { isAuthenticated: true, currentUserId: user.id },
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
