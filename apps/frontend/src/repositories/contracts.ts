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
import type { IntegrationStatus, PartnerOfficeStatus } from "@/lib/constants/status";
import type {
  AgentTask,
  Agent,
  ChangeHistoryEntry,
  Client,
  FeeModel,
  FinancialAgreement,
  ID,
  Integration,
  JudicialSourceState,
  LegalThesis,
  Notification,
  Office,
  PartnerOffice,
  PartnerRequest,
  PartnerRole,
  Payment,
  CasePartnershipAgreement,
  ReferenceMaterial,
  Role,
  Skill,
  User,
} from "@/types";
import type { JudicialSyncResult } from "@/services/judicial-integration";
import type {
  NewReferenceInput,
  NewPartnerOfficeInput,
  NewPartnerRequestInput,
  PartnerOfficePatch,
  PartnershipValuesInput,
  ImportPlan,
  ImportResult,
  JudicialSourceConfigInput,
  NewAgentInput,
  NewSkillInput,
  NewThesisInput,
  RegisterPaymentInput,
  NewAgreementInput,
  NewFeeModelInput,
  SkillChangeProposal,
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

/**
 * Clientes dos módulos de demonstração (somente leitura). Cadastro, edição,
 * inativação e exclusão são reais desde a Etapa 4.3 (server/domain/clients).
 */
export interface ClientRepository {
  list(): Promise<Client[]>;
  get(id: ID): Promise<Client | undefined>;
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
 * Casos jurídicos: Client → LegalCase → LegalProcess.
 * Regras no servidor: origem permitida pela sessão; após o aceite só
 * Administrador muda a origem; aceite exige advogado responsável e cria o
 * acordo de parceria (snapshot) quando a origem é parceiro; a nota interna
 * da rejeição nunca é devolvida a parceiros.
 */
/** Referências do DG Brasil (somente Administrador). */
export interface ReferenceRepository {
  list(): Promise<ReferenceMaterial[]>;
  create(input: NewReferenceInput): Promise<ID>;
}
