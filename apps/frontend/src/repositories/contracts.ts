/**
 * Contratos da camada de dados.
 *
 * A interface não sabe de onde os dados vêm. Hoje a implementação é
 * `mock/*` (store local); amanhã será `api/*` (backend TypeScript).
 * Todos os métodos são assíncronos desde já, para que a troca não mude
 * a assinatura usada pela interface.
 *
 * O `officeId` e o `partnerOfficeId` não são parâmetros de leitura: no
 * backend virão da sessão autenticada (nunca do cliente). Um usuário de
 * parceiro recebe apenas os registros da própria relação (ver
 * `lib/permissions/partner-scope.ts` e docs/BACKEND_HANDOFF.md).
 */
import type { DocumentStatus, ExportFormat, IntegrationStatus, LegalCaseStatus, PartnerOfficeStatus, ReviewDecisionKind } from "@/lib/constants/status";
import type {
  AgentTask,
  Agent,
  AnalysisTemplate,
  ChangeHistoryEntry,
  Client,
  ClientDocument,
  Deadline,
  ExportedDocument,
  FeeModel,
  FinancialAgreement,
  ID,
  Integration,
  JudicialSourceState,
  LegalAnalysis,
  LegalThesis,
  Notification,
  Office,
  PartnerOffice,
  PartnerRequest,
  PartnerRole,
  Payment,
  Process,
  ProcessEvent,
  CasePartnershipAgreement,
  LegalCase,
  ReferenceMaterial,
  Review,
  ReviewContent,
  Role,
  Skill,
  User,
} from "@/types";
import type { JudicialSyncResult } from "@/services/judicial-integration";
import type {
  CaseRejectionInput,
  LegalCasePatch,
  NewLegalCaseInput,
  NewReferenceInput,
  ClientLookupResult,
  ClientPatch,
  NewPartnerOfficeInput,
  NewPartnerRequestInput,
  PartnerCaseInput,
  PartnerCaseResult,
  PartnerClientBasicsPatch,
  PartnerDocumentInput,
  PartnerOfficePatch,
  PartnerProcessInput,
  PartnershipValuesInput,
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

/** Escritório proprietário único (Bárbara Cardoso Advocacia). Não há criação de escritórios. */
export interface OfficeRepository {
  get(): Promise<Office>;
  update(patch: Partial<Omit<Office, "id">>): Promise<void>;
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
  /** "Editar com agente": nova versão (AGENT_EDIT) a partir da instrução do advogado. */
  requestAgentEdit(reviewId: ID, instruction: string): Promise<void>;
  /**
   * Exporta UMA versão específica. Versão não aprovada sai como rascunho
   * (marca "RASCUNHO — NÃO APROVADO"). Backend: gera/obtém o arquivo, registra
   * o download e devolve URL temporária ou stream autorizado.
   */
  exportVersion(reviewId: ID, versionNumber: number, format: ExportFormat): Promise<ExportedDocument>;
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

/** Escritórios parceiros, vista do escritório proprietário (e leitura própria do parceiro). */
export interface PartnerRepository {
  list(): Promise<PartnerOffice[]>;
  get(id: ID): Promise<PartnerOffice | undefined>;
  create(input: NewPartnerOfficeInput): Promise<ID>;
  update(id: ID, patch: PartnerOfficePatch): Promise<void>;
  setStatus(id: ID, status: PartnerOfficeStatus): Promise<void>;
  /** Altera a divisão PADRÃO. Acordos de casos existentes não mudam (snapshot). */
  changeShare(id: ID, partnerPercentage: number, ownerPercentage: number): Promise<void>;
  inviteUser(partnerOfficeId: ID, input: { name: string; email: string; role: PartnerRole }): Promise<string>;
  setUserStatus(userId: ID, status: "ACTIVE" | "DISABLED"): Promise<void>;
  changeUserRole(userId: ID, role: PartnerRole): Promise<void>;
  listRequests(): Promise<PartnerRequest[]>;
  createRequest(input: NewPartnerRequestInput): Promise<ID>;
  resolveRequest(id: ID, resolution: "RESOLVED" | "CANCELLED"): Promise<void>;
  /** Torna PARTNER_VISIBLE um documento (já aprovado) de caso de parceiro. */
  shareDocument(documentId: ID): Promise<void>;
  listAgreements(): Promise<CasePartnershipAgreement[]>;
  updateAgreementValues(id: ID, input: PartnershipValuesInput): Promise<void>;
  registerPayout(id: ID, amount: number, note?: string): Promise<void>;
}

/**
 * Operações do Portal do Parceiro. Nenhum método recebe `partnerOfficeId`:
 * o escritório é sempre o da sessão.
 */
export interface PartnerPortalRepository {
  /** Consulta CPF/CNPJ sem revelar dados de outros relacionamentos. */
  lookupClient(document: string): Promise<ClientLookupResult>;
  submitCase(input: PartnerCaseInput): Promise<PartnerCaseResult>;
  createProcess(input: PartnerProcessInput): Promise<ID>;
  updateClientBasics(clientId: ID, patch: PartnerClientBasicsPatch): Promise<void>;
  /** Envio oficial. Com `replacesDocumentId`, cria nova versão e preserva a anterior. */
  submitDocument(input: PartnerDocumentInput): Promise<ID>;
  respondRequest(requestId: ID, message: string): Promise<void>;
}

/**
 * Casos jurídicos: Client → LegalCase → LegalProcess.
 * Regras no servidor: origem permitida pela sessão; após o aceite só
 * Administrador muda a origem; aceite exige advogado responsável e cria o
 * acordo de parceria (snapshot) quando a origem é parceiro; a nota interna
 * da rejeição nunca é devolvida a parceiros.
 */
export interface CaseRepository {
  list(): Promise<LegalCase[]>;
  get(id: ID): Promise<LegalCase | undefined>;
  create(input: NewLegalCaseInput): Promise<ID>;
  update(id: ID, patch: LegalCasePatch): Promise<void>;
  submit(id: ID): Promise<void>;
  changeOrigin(id: ID, originOfficeId: ID): Promise<void>;
  assignLawyer(id: ID, lawyerId: ID): Promise<void>;
  accept(id: ID, lawyerId?: ID): Promise<void>;
  reject(id: ID, input: CaseRejectionInput): Promise<void>;
  setStatus(id: ID, status: Extract<LegalCaseStatus, "IN_PROGRESS" | "CLOSED" | "ARCHIVED">): Promise<void>;
}

/** Referências do DG Brasil (somente Administrador). */
export interface ReferenceRepository {
  list(): Promise<ReferenceMaterial[]>;
  create(input: NewReferenceInput): Promise<ID>;
}
