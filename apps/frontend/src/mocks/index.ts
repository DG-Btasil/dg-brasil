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
  CasePartnershipAgreement,
  LegalCase,
  ReferenceMaterial,
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
  PartnerOffice,
  PartnerRequest,
  Payment,
  Process,
  ProcessEvent,
  RemovedClientRecord,
  Review,
  ReviewDecision,
  Skill,
  User,
  UserSession,
} from "@/types";
import { C, CS, OFFICE_ID } from "./ids";
import { buildAnalyses } from "./seed/analyses";
import { buildAuditEvents } from "./seed/audit";
import { buildClients } from "./seed/clients";
import { buildAgentTasks, buildAgents, buildChangeHistory, buildSkills, buildTemplates, buildTheses } from "./seed/dg";
import { buildDocuments } from "./seed/documents";
import { buildAgreements, buildFeeModels, buildPayments } from "./seed/finance";
import { buildAIUsage, buildIntegrations, buildJudicialSources } from "./seed/integrations";
import { buildNotifications } from "./seed/notifications";
import { buildInvitations, buildOffice, buildSessions, buildUsers } from "./seed/office";
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
  buildPartnerUsers,
} from "./seed/partners";
import { ANALYSIS_CASE, buildLegalCases, PROCESS_CASE } from "./seed/cases";
import { buildReferences } from "./seed/references";

export { OFFICE_ID, U as MOCK_USER_IDS, PO as MOCK_PARTNER_OFFICE_IDS, PU as MOCK_PARTNER_USER_IDS } from "./ids";
export { buildSteps } from "./seed/analyses";

/**
 * Tudo o que o protótipo persiste: a base completa do escritório proprietário.
 * O que cada usuário ENXERGA é recortado por `store/scope.ts` (parceiros veem
 * apenas a própria relação). No backend, esse recorte acontece no servidor.
 */
export interface DataState {
  office: Office;
  users: User[];
  invitations: Invitation[];
  sessions: UserSession[];
  clients: Client[];
  /** Casos jurídicos: Client → LegalCase → LegalProcess. */
  legalCases: LegalCase[];
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
  partnerRequests: PartnerRequest[];
  partnershipAgreements: CasePartnershipAgreement[];
  /** Referências do DG Brasil (materiais de apoio aos agentes). */
  references: ReferenceMaterial[];
}

/** Gera um conjunto novo de dados, com datas relativas ao dia de hoje. */
export function createSeedData(): DataState {
  // Clientes próprios: origem e cadastro da Bárbara Cardoso Advocacia.
  const ownClients = buildClients().map((c) => ({ ...c, originOfficeId: OFFICE_ID, createdByOfficeId: OFFICE_ID }));
  return {
    office: buildOffice(),
    users: [...buildUsers(), ...buildPartnerUsers()],
    invitations: [...buildInvitations(), ...buildPartnerInvitations()],
    sessions: buildSessions(),
    clients: [...buildPartnerClients(), ...ownClients],
    legalCases: buildLegalCases(),
    // Documento de processo também pertence ao caso; os demais ficam no cliente.
    documents: [...buildPartnerDocuments(), ...buildDocuments()].map((d) =>
      d.legalCaseId || !d.processId ? d : { ...d, legalCaseId: PROCESS_CASE[d.processId] },
    ),
    templates: buildTemplates(),
    analyses: buildAnalyses().map((a) => ({ ...a, legalCaseId: ANALYSIS_CASE[a.id] })),
    processes: [...buildPartnerProcesses(), ...buildProcesses().map((p) => ({ ...p, legalCaseId: PROCESS_CASE[p.id] as string }))],
    processEvents: [...buildPartnerProcessEvents(), ...buildProcessEvents()],
    deadlines: buildDeadlines(),
    // Revisões ligadas ao caso (pelo processo ou pela análise); podem existir sem processo.
    reviews: [...buildPartnerReviews(), ...buildReviews()].map((r) =>
      r.legalCaseId ? r : { ...r, legalCaseId: (r.processId && PROCESS_CASE[r.processId]) || (r.analysisId && ANALYSIS_CASE[r.analysisId]) || undefined },
    ),
    reviewDecisions: buildReviewDecisions(),
    agents: buildAgents(),
    agentTasks: buildAgentTasks(),
    skills: buildSkills(),
    theses: buildTheses(),
    changeHistory: buildChangeHistory(),
    notifications: [...buildPartnerNotifications(), ...buildNotifications()].map((n) =>
      n.legalCaseId || !n.processId ? n : { ...n, legalCaseId: PROCESS_CASE[n.processId] },
    ),
    feeModels: buildFeeModels(),
    // Contrato de honorários pertence ao caso (abrange todos os processos dele).
    agreements: buildAgreements().map(({ processId, ...a }) => ({
      ...a,
      legalCaseId: (processId && PROCESS_CASE[processId]) || (a.clientId === C.transportes ? CS.transportesCobranca : "") || "",
    })),
    payments: buildPayments(),
    integrations: buildIntegrations(),
    judicialSources: buildJudicialSources(),
    removedClients: [],
    aiUsage: buildAIUsage(),
    auditEvents: [...buildPartnerAuditEvents(), ...buildAuditEvents()].sort((a, b) => b.at.localeCompare(a.at)),
    partnerOffices: buildPartnerOffices(),
    clientRelationships: buildClientRelationships(ownClients.map((c) => c.id)),
    partnerRequests: buildPartnerRequests(),
    partnershipAgreements: buildPartnershipAgreements(),
    references: buildReferences(),
  };
}
