/**
 * Implementações mock dos repositórios, apoiadas no store local.
 * Quando o backend existir, criar `repositories/api/*` com os mesmos
 * contratos e trocar a exportação em `repositories/index.ts`.
 */
import { JUDICIAL_PROVIDERS } from "@/services/judicial-integration";
import { useAppStore } from "@/store/app-store";
import { selectScoped } from "@/store/scope";
import type {
  ReferenceRepository,
  ClientRepository,
  DgRepository,
  ImportRepository,
  IntegrationRepository,
  NotificationRepository,
  OfficeRepository,
  UserRepository,
} from "../contracts";

const state = () => useAppStore.getState();
/** Leituras sempre pelo estado RECORTADO para o usuário da sessão (como o backend fará). */
const data = () => selectScoped(useAppStore.getState());
const ok = <T>(value: T) => Promise.resolve(value);

export const mockOfficeRepository: OfficeRepository = {
  get: () => ok(data().office),
  update: async (patch) => state().updateOffice(patch),
};

export const mockUserRepository: UserRepository = {
  list: () => ok(data().users),
  invite: async (input) => state().inviteUser(input),
  acceptInvitation: async (token, name) => state().acceptInvitation(token, name),
  changeRole: async (userId, role) => state().changeUserRole(userId, role),
  savePreferences: async (userId, prefs) => state().updateUserPreferences(userId, prefs),
};

export const mockClientRepository: ClientRepository = {
  list: () => ok(data().clients),
  get: (id) => ok(data().clients.find((c) => c.id === id)),
};

export const mockNotificationRepository: NotificationRepository = {
  list: () => ok(data().notifications),
  markRead: async (id) => state().markNotificationRead(id),
  markAllRead: async () => state().markAllNotificationsRead(),
};

export const mockDgRepository: DgRepository = {
  listAgents: () => ok(data().agents),
  createAgent: async (input) => state().createAgent(input),
  createSkill: async (input) => state().createSkill(input),
  createThesis: async (input) => state().createThesis(input),
  updateAgent: async (id, patch) => state().updateAgent(id, patch),
  listAgentTasks: (agentId) => ok(data().agentTasks.filter((t) => !agentId || t.agentId === agentId)),
  listSkills: () => ok(data().skills),
  listTheses: () => ok(data().theses),
  listChangeHistory: () => ok(data().changeHistory),
  applySkillChange: async (proposal) => state().applySkillChange(proposal),
  cancelSkillChange: async (proposal) => state().cancelSkillChange(proposal),
};

export const mockIntegrationRepository: IntegrationRepository = {
  list: () => ok(data().integrations),
  setStatus: async (id, status) => state().updateIntegrationStatus(id, status),
  sync: async (id) => state().syncIntegration(id),
  listJudicialSources: () => ok(data().judicialSources),
  configureJudicialSource: async (id, config) => state().configureJudicialSource(id, config),
  syncJudicialSource: async (id) => {
    const source = data().judicialSources.find((j) => j.id === id);
    if (!source) throw new Error("Fonte da Integração Judicial não encontrada.");
    // O provedor é mock: nenhuma consulta externa é feita no protótipo.
    const result = await JUDICIAL_PROVIDERS[source.source].sync(source);
    state().recordJudicialSync(id, result);
    return result;
  },
};

export const mockImportRepository: ImportRepository = {
  run: async (plan) => state().importData(plan),
};

export const mockReferenceRepository: ReferenceRepository = {
  list: () => ok(data().references),
  create: async (input) => state().createReference(input),
};
