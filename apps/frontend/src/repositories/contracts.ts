/**
 * Contratos da camada de dados.
 *
 * A interface não sabe de onde os dados vêm. Hoje a implementação é
 * `mock/*` (store local); amanhã será `api/*` (backend TypeScript).
 * Todos os métodos são assíncronos desde já, para que a troca não mude
 * a assinatura usada pela interface.
 *
 * O `officeId` não é parâmetro: no backend ele virá da sessão
 * autenticada (nunca do cliente), garantindo o isolamento multi-tenant.
 */
import type { DocumentStatus, IntegrationStatus, ReviewDecisionKind } from "@/lib/constants/status";
import type {
  AgentTask,
  Agent,
  AnalysisTemplate,
  ChangeHistoryEntry,
  Client,
  ClientDocument,
  Deadline,
  FeeModel,
  FinancialAgreement,
  ID,
  Integration,
  JudicialSourceState,
  LegalAnalysis,
  LegalThesis,
  Notification,
  Office,
  Payment,
  Process,
  ProcessEvent,
  Review,
  ReviewContent,
  Role,
  Skill,
  User,
} from "@/types";
import type { JudicialSyncResult } from "@/services/judicial-integration";
import type {
  ClientPatch,
  CreateOfficeInput,
  DeleteClientResult,
  ImportPlan,
  ImportResult,
  InactivateClientInput,
  JudicialSourceConfigInput,
  NewAgentInput,
  NewSkillInput,
  NewThesisInput,
  RegisterPaymentInput,
  NewAgreementInput,
  NewClientInput,
  NewDeadlineInput,
  NewDocumentInput,
  NewFeeModelInput,
  NewProcessInput,
  SkillChangeProposal,
  StartAnalysisInput,
  UserPreferences,
} from "@/store/types";

export interface OfficeRepository {
  get(): Promise<Office>;
  create(input: CreateOfficeInput): Promise<void>;
  update(patch: Partial<Omit<Office, "id" | "onboarding">>): Promise<void>;
  saveOnboardingStep(stepKey: string, answers: Record<string, unknown>, nextStep: number, skipped?: boolean): Promise<void>;
  setOnboardingStep(step: number): Promise<void>;
  completeOnboarding(): Promise<void>;
}

export interface UserRepository {
  list(): Promise<User[]>;
  invite(input: { name: string; email: string; role: Role }): Promise<string>;
  acceptInvitation(token: string, name: string): Promise<boolean>;
  changeRole(userId: ID, role: Role): Promise<void>;
  savePreferences(userId: ID, prefs: UserPreferences): Promise<void>;
}

export interface ClientRepository {
  list(): Promise<Client[]>;
  get(id: ID): Promise<Client | undefined>;
  create(input: NewClientInput): Promise<ID>;
  update(id: ID, patch: ClientPatch): Promise<void>;
  /** Preferível à exclusão: o cliente sai da operação mas continua no histórico e pesquisável. */
  inactivate(id: ID, input: InactivateClientInput): Promise<void>;
  reactivate(id: ID): Promise<void>;
  /** Não exclui processos: eles ficam com vínculo pendente e geram alerta de integridade. */
  remove(id: ID): Promise<DeleteClientResult>;
}

export interface DocumentRepository {
  listByClient(clientId: ID): Promise<ClientDocument[]>;
  /** Protótipo: registra apenas metadados. Upload real virá com storage seguro. */
  add(input: NewDocumentInput): Promise<ID>;
  updateStatus(id: ID, status: DocumentStatus, notes?: string): Promise<void>;
}

export interface AnalysisRepository {
  listTemplates(): Promise<AnalysisTemplate[]>;
  listByClient(clientId: ID): Promise<LegalAnalysis[]>;
  start(input: StartAnalysisInput): Promise<ID>;
  sendToAgent(analysisId: ID): Promise<void>;
  interrupt(analysisId: ID, reason: string): Promise<void>;
  resume(analysisId: ID): Promise<void>;
  /** Somente demonstração: simula o resultado que o agente enviaria. */
  simulateAgentResult(analysisId: ID): Promise<ID | null>;
}

export interface ProcessRepository {
  list(): Promise<Process[]>;
  get(id: ID): Promise<Process | undefined>;
  create(input: NewProcessInput): Promise<ID>;
  update(id: ID, patch: Partial<NewProcessInput>): Promise<void>;
  listEvents(processId: ID): Promise<ProcessEvent[]>;
  addEvent(processId: ID, input: { title: string; description?: string; important?: boolean }): Promise<void>;
  listDeadlines(processId?: ID): Promise<Deadline[]>;
  addDeadline(input: NewDeadlineInput): Promise<ID>;
  completeDeadline(id: ID): Promise<void>;
  /** Não exclui o cliente. */
  remove(id: ID): Promise<void>;
  linkClient(processId: ID, clientId: ID): Promise<void>;
}

export interface ReviewRepository {
  list(): Promise<Review[]>;
  get(id: ID): Promise<Review | undefined>;
  decide(reviewId: ID, decision: ReviewDecisionKind, comment?: string): Promise<void>;
  /** Edição manual (origem MANUAL_EDIT). Preserva a versão anterior. */
  editContent(reviewId: ID, content: ReviewContent): Promise<void>;
  /** Reabre revisão decidida; a decisão anterior permanece no histórico. */
  reopen(reviewId: ID, reason?: string): Promise<void>;
}

export interface NotificationRepository {
  list(): Promise<Notification[]>;
  markRead(id: ID): Promise<void>;
  markAllRead(): Promise<void>;
}

export interface FinanceRepository {
  listFeeModels(): Promise<FeeModel[]>;
  createFeeModel(input: NewFeeModelInput): Promise<ID>;
  updateFeeModel(id: ID, patch: Partial<NewFeeModelInput>): Promise<void>;
  listAgreements(): Promise<FinancialAgreement[]>;
  createAgreement(input: NewAgreementInput): Promise<ID>;
  listPayments(agreementId?: ID): Promise<Payment[]>;
  registerPayment(paymentId: ID, input?: RegisterPaymentInput): Promise<void>;
  updatePaymentAmount(paymentId: ID, paidAmount: number): Promise<void>;
  reversePayment(paymentId: ID): Promise<void>;
  updatePaymentDueDate(paymentId: ID, dueDate: string): Promise<void>;
}

export interface DgRepository {
  listAgents(): Promise<Agent[]>;
  createAgent(input: NewAgentInput): Promise<ID>;
  createSkill(input: NewSkillInput): Promise<ID>;
  createThesis(input: NewThesisInput): Promise<ID>;
  updateAgent(id: ID, patch: Partial<Pick<Agent, "status" | "autonomy" | "rules" | "skillIds" | "thesisIds" | "description">>): Promise<void>;
  listAgentTasks(agentId?: ID): Promise<AgentTask[]>;
  listSkills(): Promise<Skill[]>;
  listTheses(): Promise<LegalThesis[]>;
  listChangeHistory(): Promise<ChangeHistoryEntry[]>;
  /** Aplicada somente após confirmação explícita do usuário. */
  applySkillChange(proposal: SkillChangeProposal): Promise<ID>;
  cancelSkillChange(proposal: SkillChangeProposal): Promise<ID>;
}

export interface IntegrationRepository {
  list(): Promise<Integration[]>;
  setStatus(id: ID, status: IntegrationStatus): Promise<void>;
  sync(id: ID): Promise<void>;
  listJudicialSources(): Promise<JudicialSourceState[]>;
  configureJudicialSource(id: ID, config: JudicialSourceConfigInput): Promise<void>;
  /** Dispara a sincronização da fonte pelo provedor registrado e grava o resultado. */
  syncJudicialSource(id: ID): Promise<JudicialSyncResult>;
}

/** Migração de dados de outros sistemas/planilhas. */
export interface ImportRepository {
  /** Aplica um plano já validado (dry run feito na interface). */
  run(plan: ImportPlan): Promise<ImportResult>;
}
