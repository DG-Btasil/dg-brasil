/**
 * Implementações mock dos repositórios, apoiadas no store local.
 * Quando o backend existir, criar `repositories/api/*` com os mesmos
 * contratos e trocar a exportação em `repositories/index.ts`.
 */
import { useAppStore } from "@/store/app-store";
import type {
  AnalysisRepository,
  ClientRepository,
  DgRepository,
  DocumentRepository,
  FinanceRepository,
  IntegrationRepository,
  NotificationRepository,
  OfficeRepository,
  ProcessRepository,
  ReviewRepository,
  UserRepository,
} from "../contracts";

const state = () => useAppStore.getState();
const ok = <T>(value: T) => Promise.resolve(value);

export const mockOfficeRepository: OfficeRepository = {
  get: () => ok(state().office),
  create: async (input) => state().createOffice(input),
  update: async (patch) => state().updateOffice(patch),
  saveOnboardingStep: async (key, answers, next, skipped) => state().saveOnboardingStep(key, answers, next, skipped),
  setOnboardingStep: async (step) => state().setOnboardingStep(step),
  completeOnboarding: async () => state().completeOnboarding(),
};

export const mockUserRepository: UserRepository = {
  list: () => ok(state().users),
  invite: async (input) => state().inviteUser(input),
  acceptInvitation: async (token, name) => state().acceptInvitation(token, name),
  changeRole: async (userId, role) => state().changeUserRole(userId, role),
  savePreferences: async (userId, prefs) => state().updateUserPreferences(userId, prefs),
};

export const mockClientRepository: ClientRepository = {
  list: () => ok(state().clients),
  get: (id) => ok(state().clients.find((c) => c.id === id)),
  create: async (input) => state().createClient(input),
  update: async (id, patch) => state().updateClient(id, patch),
};

export const mockDocumentRepository: DocumentRepository = {
  listByClient: (clientId) => ok(state().documents.filter((d) => d.clientId === clientId)),
  add: async (input) => state().addDocument(input),
  updateStatus: async (id, status, notes) => state().updateDocumentStatus(id, status, notes),
};

export const mockAnalysisRepository: AnalysisRepository = {
  listTemplates: () => ok(state().templates),
  listByClient: (clientId) => ok(state().analyses.filter((a) => a.clientId === clientId)),
  start: async (input) => state().startAnalysis(input),
  sendToAgent: async (id) => state().sendAnalysisToAgent(id),
  interrupt: async (id, reason) => state().interruptAnalysis(id, reason),
  resume: async (id) => state().resumeAnalysis(id),
  simulateAgentResult: async (id) => state().simulateAgentResult(id),
};

export const mockProcessRepository: ProcessRepository = {
  list: () => ok(state().processes),
  get: (id) => ok(state().processes.find((p) => p.id === id)),
  create: async (input) => state().createProcess(input),
  update: async (id, patch) => state().updateProcess(id, patch),
  listEvents: (processId) => ok(state().processEvents.filter((e) => e.processId === processId)),
  addEvent: async (processId, input) => state().addProcessEvent(processId, input),
  listDeadlines: (processId) => ok(state().deadlines.filter((d) => !processId || d.processId === processId)),
  addDeadline: async (input) => state().addDeadline(input),
  completeDeadline: async (id) => state().completeDeadline(id),
};

export const mockReviewRepository: ReviewRepository = {
  list: () => ok(state().reviews),
  get: (id) => ok(state().reviews.find((r) => r.id === id)),
  decide: async (id, decision, comment) => state().decideReview(id, decision, comment),
};

export const mockNotificationRepository: NotificationRepository = {
  list: () => ok(state().notifications),
  markRead: async (id) => state().markNotificationRead(id),
  markAllRead: async () => state().markAllNotificationsRead(),
};

export const mockFinanceRepository: FinanceRepository = {
  listFeeModels: () => ok(state().feeModels),
  createFeeModel: async (input) => state().createFeeModel(input),
  updateFeeModel: async (id, patch) => state().updateFeeModel(id, patch),
  listAgreements: () => ok(state().agreements),
  createAgreement: async (input) => state().createAgreement(input),
  listPayments: (agreementId) => ok(state().payments.filter((p) => !agreementId || p.agreementId === agreementId)),
  registerPayment: async (id) => state().registerPayment(id),
};

export const mockDgRepository: DgRepository = {
  listAgents: () => ok(state().agents),
  updateAgent: async (id, patch) => state().updateAgent(id, patch),
  listAgentTasks: (agentId) => ok(state().agentTasks.filter((t) => !agentId || t.agentId === agentId)),
  listSkills: () => ok(state().skills),
  listTheses: () => ok(state().theses),
  listChangeHistory: () => ok(state().changeHistory),
  applySkillChange: async (proposal) => state().applySkillChange(proposal),
  cancelSkillChange: async (proposal) => state().cancelSkillChange(proposal),
};

export const mockIntegrationRepository: IntegrationRepository = {
  list: () => ok(state().integrations),
  setStatus: async (id, status) => state().updateIntegrationStatus(id, status),
  sync: async (id) => state().syncIntegration(id),
};
