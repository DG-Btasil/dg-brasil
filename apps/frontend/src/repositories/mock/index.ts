/**
 * Implementações mock dos repositórios, apoiadas no store local.
 * Quando o backend existir, criar `repositories/api/*` com os mesmos
 * contratos e trocar a exportação em `repositories/index.ts`.
 */
import { JUDICIAL_PROVIDERS } from "@/services/judicial-integration";
import { useAppStore } from "@/store/app-store";
import type {
  AnalysisRepository,
  ClientRepository,
  DgRepository,
  DocumentRepository,
  FinanceRepository,
  ImportRepository,
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
  inactivate: async (id, input) => state().inactivateClient(id, input),
  reactivate: async (id) => state().reactivateClient(id),
  remove: async (id) => state().deleteClient(id),
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
  remove: async (id) => state().deleteProcess(id),
  linkClient: async (processId, clientId) => state().linkProcessClient(processId, clientId),
};

export const mockReviewRepository: ReviewRepository = {
  list: () => ok(state().reviews),
  get: (id) => ok(state().reviews.find((r) => r.id === id)),
  decide: async (id, decision, comment) => state().decideReview(id, decision, comment),
  editContent: async (id, content) => state().editReviewContent(id, content),
  reopen: async (id, reason) => state().reopenReview(id, reason),
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
  registerPayment: async (id, input) => state().registerPayment(id, input),
  updatePaymentAmount: async (id, paidAmount) => state().updatePaymentAmount(id, paidAmount),
  reversePayment: async (id) => state().reversePayment(id),
  updatePaymentDueDate: async (id, dueDate) => state().updatePaymentDueDate(id, dueDate),
};

export const mockDgRepository: DgRepository = {
  listAgents: () => ok(state().agents),
  createAgent: async (input) => state().createAgent(input),
  createSkill: async (input) => state().createSkill(input),
  createThesis: async (input) => state().createThesis(input),
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
  listJudicialSources: () => ok(state().judicialSources),
  configureJudicialSource: async (id, config) => state().configureJudicialSource(id, config),
  syncJudicialSource: async (id) => {
    const source = state().judicialSources.find((j) => j.id === id);
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
