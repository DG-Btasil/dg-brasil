/**
 * Implementações mock dos repositórios, apoiadas no store local.
 * Quando o backend existir, criar `repositories/api/*` com os mesmos
 * contratos e trocar a exportação em `repositories/index.ts`.
 */
import { JUDICIAL_PROVIDERS } from "@/services/judicial-integration";
import { mockDocumentExportService } from "@/services/document-export";
import { currentVersionNumber, isApprovedVersion } from "@/lib/domain/review-versions";
import { useAppStore } from "@/store/app-store";
import { selectScoped } from "@/store/scope";
import type {
  AnalysisRepository,
  ReferenceRepository,
  ClientRepository,
  DgRepository,
  DocumentRepository,
  FinanceRepository,
  ImportRepository,
  IntegrationRepository,
  NotificationRepository,
  OfficeRepository,
  PartnerPortalRepository,
  PartnerRepository,
  ReviewRepository,
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

export const mockDocumentRepository: DocumentRepository = {
  listByClient: (clientId) => ok(data().documents.filter((d) => d.clientId === clientId)),
  add: async (input) => state().addDocument(input),
  updateStatus: async (id, status, notes) => state().updateDocumentStatus(id, status, notes),
};

export const mockAnalysisRepository: AnalysisRepository = {
  listTemplates: () => ok(data().templates),
  listByClient: (clientId) => ok(data().analyses.filter((a) => a.clientId === clientId)),
  start: async (input) => state().startAnalysis(input),
  sendToAgent: async (id) => state().sendAnalysisToAgent(id),
  interrupt: async (id, reason) => state().interruptAnalysis(id, reason),
  resume: async (id) => state().resumeAnalysis(id),
  simulateAgentResult: async (id) => state().simulateAgentResult(id),
};

export const mockReviewRepository: ReviewRepository = {
  list: () => ok(data().reviews),
  get: (id) => ok(data().reviews.find((r) => r.id === id)),
  decide: async (id, decision, comment) => state().decideReview(id, decision, comment),
  editContent: async (id, content) => state().editReviewContent(id, content),
  reopen: async (id, reason) => state().reopenReview(id, reason),
  requestAgentEdit: async (id, instruction) => state().requestAgentEdit(id, instruction),
  exportVersion: async (id, versionNumber, format) => {
    const review = data().reviews.find((r) => r.id === id);
    if (!review) throw new Error("Revisão não encontrada.");
    const content =
      versionNumber === currentVersionNumber(review) ? review.content : review.previousVersions?.find((v) => v.version === versionNumber)?.content;
    if (!content) throw new Error("Versão não encontrada.");
    const decisions = data().reviewDecisions.filter((d) => d.reviewId === id).sort((a, b) => b.at.localeCompare(a.at));
    // O rascunho é decidido aqui (servidor, no produto), nunca pela tela.
    const draft = !isApprovedVersion(review, decisions, versionNumber);
    const file = await mockDocumentExportService.exportVersion({
      title: review.title,
      content,
      versionNumber,
      draft,
      format,
      footer: `${data().office.name} · ${review.title} · versão ${versionNumber}${draft ? " · rascunho" : " · aprovada"}`,
    });
    state().recordReviewDownload(id, versionNumber, format, draft);
    return file;
  },
};

export const mockNotificationRepository: NotificationRepository = {
  list: () => ok(data().notifications),
  markRead: async (id) => state().markNotificationRead(id),
  markAllRead: async () => state().markAllNotificationsRead(),
};

export const mockFinanceRepository: FinanceRepository = {
  listFeeModels: () => ok(data().feeModels),
  createFeeModel: async (input) => state().createFeeModel(input),
  updateFeeModel: async (id, patch) => state().updateFeeModel(id, patch),
  listAgreements: () => ok(data().agreements),
  createAgreement: async (input) => state().createAgreement(input),
  listPayments: (agreementId) => ok(data().payments.filter((p) => !agreementId || p.agreementId === agreementId)),
  registerPayment: async (id, input) => state().registerPayment(id, input),
  updatePaymentAmount: async (id, paidAmount) => state().updatePaymentAmount(id, paidAmount),
  reversePayment: async (id) => state().reversePayment(id),
  updatePaymentDueDate: async (id, dueDate) => state().updatePaymentDueDate(id, dueDate),
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

export const mockPartnerRepository: PartnerRepository = {
  list: () => ok(data().partnerOffices),
  get: (id) => ok(data().partnerOffices.find((p) => p.id === id)),
  create: async (input) => state().createPartnerOffice(input),
  update: async (id, patch) => state().updatePartnerOffice(id, patch),
  setStatus: async (id, status) => state().setPartnerOfficeStatus(id, status),
  changeShare: async (id, partnerPercentage, ownerPercentage) => state().changePartnerShare(id, partnerPercentage, ownerPercentage),
  inviteUser: async (partnerOfficeId, input) => state().invitePartnerUser(partnerOfficeId, input),
  setUserStatus: async (userId, status) => state().setPartnerUserStatus(userId, status),
  changeUserRole: async (userId, role) => state().changePartnerUserRole(userId, role),
  listRequests: () => ok(data().partnerRequests),
  createRequest: async (input) => state().createPartnerRequest(input),
  resolveRequest: async (id, resolution) => state().resolvePartnerRequest(id, resolution),
  shareDocument: async (documentId) => state().shareDocumentWithPartner(documentId),
  listAgreements: () => ok(data().partnershipAgreements),
  updateAgreementValues: async (id, input) => state().updatePartnershipValues(id, input),
  registerPayout: async (id, amount, note) => state().registerPartnerPayout(id, amount, note),
};

export const mockPartnerPortalRepository: PartnerPortalRepository = {
  lookupClient: async (document) => state().lookupClientDocument(document),
  submitCase: async (input) => state().submitPartnerCase(input),
  createProcess: async (input) => state().createPartnerProcess(input),
  updateClientBasics: async (clientId, patch) => state().updatePartnerClientBasics(clientId, patch),
  submitDocument: async (input) => state().submitPartnerDocument(input),
  respondRequest: async (requestId, message) => state().respondPartnerRequest(requestId, message),
};

export const mockReferenceRepository: ReferenceRepository = {
  list: () => ok(data().references),
  create: async (input) => state().createReference(input),
};
