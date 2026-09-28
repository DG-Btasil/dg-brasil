import type {
  AIUsage,
  Agent,
  AgentTask,
  AnalysisTemplate,
  AuditEvent,
  ChangeHistoryEntry,
  Client,
  ClientDocument,
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
  Payment,
  Process,
  ProcessEvent,
  RemovedClientRecord,
  Review,
  ReviewDecision,
  Skill,
  Subscription,
  User,
  UserSession,
} from "@/types";
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

export { OFFICE_ID, U as MOCK_USER_IDS } from "./ids";
export { buildSteps } from "./seed/analyses";

/** Tudo o que o protótipo persiste. Equivale ao que o backend devolverá por escritório. */
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
}

/** Gera um conjunto novo de dados, com datas relativas ao dia de hoje. */
export function createSeedData(): DataState {
  return {
    office: buildOffice(),
    subscription: buildSubscription(),
    users: buildUsers(),
    invitations: buildInvitations(),
    sessions: buildSessions(),
    clients: buildClients(),
    documents: buildDocuments(),
    templates: buildTemplates(),
    analyses: buildAnalyses(),
    processes: buildProcesses(),
    processEvents: buildProcessEvents(),
    deadlines: buildDeadlines(),
    reviews: buildReviews(),
    reviewDecisions: buildReviewDecisions(),
    agents: buildAgents(),
    agentTasks: buildAgentTasks(),
    skills: buildSkills(),
    theses: buildTheses(),
    changeHistory: buildChangeHistory(),
    notifications: buildNotifications(),
    feeModels: buildFeeModels(),
    agreements: buildAgreements(),
    payments: buildPayments(),
    integrations: buildIntegrations(),
    judicialSources: buildJudicialSources(),
    removedClients: [],
    aiUsage: buildAIUsage(),
    auditEvents: buildAuditEvents(),
  };
}
