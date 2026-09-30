import type {
  AIUsage,
  Agent,
  AgentTask,
  AnalysisTemplate,
  AuditEvent,
  ChangeHistoryEntry,
  Client,
  ClientDocument,
  ClientOfficeRelationship,
  Deadline,
  FeeModel,
  FinancialAgreement,
  Integration,
  Invitation,
  JudicialSourceState,
  LegalAnalysis,
  LegalThesis,
  Notification,
  Office,
  PartnerCaseSubmission,
  PartnerOffice,
  PartnerRequest,
  Payment,
  Process,
  ProcessEvent,
  ProcessPartnershipAgreement,
  RemovedClientRecord,
  Review,
  ReviewDecision,
  Skill,
  Subscription,
  User,
  UserSession,
} from "@/types";
import { OFFICE_ID } from "./ids";
import { buildAnalyses } from "./seed/analyses";
import { buildAuditEvents } from "./seed/audit";
import { buildClients } from "./seed/clients";
import { buildAgentTasks, buildAgents, buildChangeHistory, buildSkills, buildTemplates, buildTheses } from "./seed/dg";
import { buildDocuments } from "./seed/documents";
import { buildAgreements, buildFeeModels, buildPayments } from "./seed/finance";
import { buildAIUsage, buildIntegrations, buildJudicialSources } from "./seed/integrations";
import { buildNotifications } from "./seed/notifications";
import { buildInvitations, buildOffice, buildSessions, buildSubscription, buildUsers } from "./seed/office";
import { buildDeadlines, buildProcessEvents, buildProcesses } from "./seed/processes";
import { buildReviewDecisions, buildReviews } from "./seed/reviews";
import {
  buildClientRelationships,
  buildPartnerAuditEvents,
  buildPartnerClients,
  buildPartnerDocuments,
  buildPartnerInvitations,
  buildPartnerNotifications,
  buildPartnerOffices,
  buildPartnerProcessEvents,
  buildPartnerProcesses,
  buildPartnerRequests,
  buildPartnerReviews,
  buildPartnershipAgreements,
  buildPartnerSubmissions,
  buildPartnerUsers,
} from "./seed/partners";

export { OFFICE_ID, U as MOCK_USER_IDS, PO as MOCK_PARTNER_OFFICE_IDS, PU as MOCK_PARTNER_USER_IDS } from "./ids";
export { buildSteps } from "./seed/analyses";

/**
 * Tudo o que o protótipo persiste: a base completa do escritório proprietário.
 * O que cada usuário ENXERGA é recortado por `store/scope.ts` (parceiros veem
 * apenas a própria relação). No backend, esse recorte acontece no servidor.
 */
export interface DataState {
  office: Office;
  subscription: Subscription;
  users: User[];
  invitations: Invitation[];
  sessions: UserSession[];
  clients: Client[];
  documents: ClientDocument[];
  templates: AnalysisTemplate[];
  analyses: LegalAnalysis[];
  processes: Process[];
  processEvents: ProcessEvent[];
  deadlines: Deadline[];
  reviews: Review[];
  reviewDecisions: ReviewDecision[];
  agents: Agent[];
  agentTasks: AgentTask[];
  skills: Skill[];
  theses: LegalThesis[];
  changeHistory: ChangeHistoryEntry[];
  notifications: Notification[];
  feeModels: FeeModel[];
  agreements: FinancialAgreement[];
  payments: Payment[];
  integrations: Integration[];
  judicialSources: JudicialSourceState[];
  /** Clientes excluídos (rastro para processos com vínculo pendente). */
  removedClients: RemovedClientRecord[];
  aiUsage: AIUsage;
  auditEvents: AuditEvent[];
  /* Parcerias */
  partnerOffices: PartnerOffice[];
  clientRelationships: ClientOfficeRelationship[];
  partnerSubmissions: PartnerCaseSubmission[];
  partnerRequests: PartnerRequest[];
  partnershipAgreements: ProcessPartnershipAgreement[];
}

/** Gera um conjunto novo de dados, com datas relativas ao dia de hoje. */
export function createSeedData(): DataState {
  // Clientes próprios: origem e cadastro da Bárbara Cardoso Advocacia.
  const ownClients = buildClients().map((c) => ({ ...c, originOfficeId: OFFICE_ID, createdByOfficeId: OFFICE_ID }));
  return {
    office: buildOffice(),
    subscription: buildSubscription(),
    users: [...buildUsers(), ...buildPartnerUsers()],
    invitations: [...buildInvitations(), ...buildPartnerInvitations()],
    sessions: buildSessions(),
    clients: [...buildPartnerClients(), ...ownClients],
    documents: [...buildPartnerDocuments(), ...buildDocuments()],
    templates: buildTemplates(),
    analyses: buildAnalyses(),
    processes: [...buildPartnerProcesses(), ...buildProcesses()],
    processEvents: [...buildPartnerProcessEvents(), ...buildProcessEvents()],
    deadlines: buildDeadlines(),
    reviews: [...buildPartnerReviews(), ...buildReviews()],
    reviewDecisions: buildReviewDecisions(),
    agents: buildAgents(),
    agentTasks: buildAgentTasks(),
    skills: buildSkills(),
    theses: buildTheses(),
    changeHistory: buildChangeHistory(),
    notifications: [...buildPartnerNotifications(), ...buildNotifications()],
    feeModels: buildFeeModels(),
    agreements: buildAgreements(),
    payments: buildPayments(),
    integrations: buildIntegrations(),
    judicialSources: buildJudicialSources(),
    removedClients: [],
    aiUsage: buildAIUsage(),
    auditEvents: [...buildPartnerAuditEvents(), ...buildAuditEvents()].sort((a, b) => b.at.localeCompare(a.at)),
    partnerOffices: buildPartnerOffices(),
    clientRelationships: buildClientRelationships(ownClients.map((c) => c.id)),
    partnerSubmissions: buildPartnerSubmissions(),
    partnerRequests: buildPartnerRequests(),
    partnershipAgreements: buildPartnershipAgreements(),
  };
}
