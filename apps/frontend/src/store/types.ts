import type { DataState } from "@/mocks";
import type {
  DeadlineType,
  DocumentCategory,
  DocumentStatus,
  ExportFormat,
  IntegrationStatus,
  NotificationType,
  PartnerOfficeStatus,
  PartnerRequestType,
  ReviewDecisionKind,
  SubmissionStatus,
} from "@/lib/constants/status";
import type { LegalArea } from "@/lib/constants/legal";
import type {
  Agent,
  Client,
  ClientInactivationReason,
  CompanyClient,
  DiffLine,
  FeeModel,
  ID,
  IndividualClient,
  LegalThesis,
  Office,
  PartnerOffice,
  PartnerRole,
  Process,
  ReviewContent,
  Role,
  Skill,
} from "@/types";

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

export interface SessionState {
  isAuthenticated: boolean;
  currentUserId: ID;
}

export interface UserPreferences {
  notifications: Record<NotificationType, { inApp: boolean; email: boolean }>;
  digest: "NONE" | "DAILY" | "WEEKLY";
}

export interface AppState extends DataState {
  session: SessionState;
  preferences: Record<ID, UserPreferences>;
}

/* ------------------------------------------------------------------ */
/* Entradas das ações                                                  */
/* ------------------------------------------------------------------ */

type ClientOwnFields = "id" | "officeId" | "createdAt" | "updatedAt";
export type NewIndividualClientInput = Omit<IndividualClient, ClientOwnFields>;
export type NewCompanyClientInput = Omit<CompanyClient, ClientOwnFields>;
export type NewClientInput = NewIndividualClientInput | NewCompanyClientInput;
export type ClientPatch = Partial<NewIndividualClientInput> | Partial<NewCompanyClientInput>;

export interface CreateOfficeInput {
  officeName: string;
  adminName: string;
  adminEmail: string;
  oab?: string;
  phone?: string;
}

export interface NewDocumentInput {
  clientId: ID;
  name: string;
  category: DocumentCategory;
  fileName?: string;
  sizeKb?: number;
  processId?: ID;
  notes?: string;
}

export interface StartAnalysisInput {
  clientId: ID;
  templateId: ID;
  fields: Record<string, string>;
}

export type NewProcessInput = Omit<
  Process,
  "id" | "officeId" | "createdAt" | "updatedAt" | "origin" | "lastMovementAt" | "relationshipOrigin" | "originPartnerOfficeId"
> & {
  origin?: Process["origin"];
  /** Ausente = INTERNAL. PARTNER exige originPartnerOfficeId e gera o acordo (snapshot). */
  relationshipOrigin?: Process["relationshipOrigin"];
  originPartnerOfficeId?: ID;
  nextDeadline?: { title: string; type: DeadlineType; dueDate: string };
};

export interface NewDeadlineInput {
  processId: ID;
  title: string;
  type: DeadlineType;
  dueDate: string;
  responsibleUserId: ID;
  notes?: string;
}

export type NewFeeModelInput = Omit<FeeModel, "id" | "officeId" | "updatedAt">;

export interface NewAgreementInput {
  clientId: ID;
  processId?: ID;
  feeModelId?: ID;
  customized: boolean;
  upfrontFee: number;
  fixedFee: number;
  installments: number;
  monthlyFee?: number;
  successFeePercent?: number;
  startDate: string;
  notes?: string;
}

export interface InactivateClientInput {
  reason?: ClientInactivationReason;
  note?: string;
}

/** Resultado da exclusão de cliente: processos que ficaram com vínculo pendente. */
export interface DeleteClientResult {
  affectedProcessIds: ID[];
}

/** Recebimento de parcela. Sem `amount`, quita o saldo restante. */
export interface RegisterPaymentInput {
  amount?: number;
}

export type NewAgentInput = Pick<Agent, "name" | "role" | "description" | "status" | "autonomy" | "skillIds" | "thesisIds" | "rules"> & {
  objective?: string;
};

export type NewSkillInput = Pick<Skill, "name" | "description" | "purpose" | "status" | "instructions" | "version"> & {
  /** Agentes que passam a usar a Skill. */
  agentIds: ID[];
};

export type NewThesisInput = Pick<
  LegalThesis,
  "name" | "area" | "status" | "summary" | "foundations" | "applicationCriteria" | "nonApplicationCriteria" | "requiredDocuments" | "references" | "notes" | "skillIds"
> & {
  /** Agentes autorizados a aplicar a tese. */
  agentIds: ID[];
};

export interface JudicialSourceConfigInput {
  oabNumber?: string;
  oabState?: string;
  courts?: string[];
  responsibleUserId?: ID;
}

/* ------------------------------------------------------------------ */
/* Parcerias                                                           */
/* ------------------------------------------------------------------ */

export type NewPartnerOfficeInput = Pick<
  PartnerOffice,
  "name" | "legalName" | "cnpj" | "responsibleName" | "responsibleOab" | "oabState" | "email" | "phone" | "address" | "notes" | "partnershipPercentage" | "ownerPercentage"
>;
export type PartnerOfficePatch = Partial<Omit<NewPartnerOfficeInput, "partnershipPercentage" | "ownerPercentage">>;

/**
 * Resultado da consulta de CPF/CNPJ feita por um parceiro. Nunca revela
 * nome, escritório, processos ou qualquer dado de outro relacionamento.
 * `matchToken` é opaco (no backend: token curto e assinado, não o id).
 */
export type ClientLookupResult =
  | { status: "NOT_FOUND" }
  | { status: "ALREADY_RELATED"; clientId: ID }
  | { status: "EXISTS"; matchToken: string };

export interface PartnerCaseDocumentInput {
  name: string;
  category: DocumentCategory;
  fileName?: string;
  sizeKb?: number;
}

/** Dados básicos que o parceiro informa para um cliente NOVO. */
export type PartnerNewClientInput =
  | {
      kind: "INDIVIDUAL";
      /** Origem do cliente (próprio parceiro ou Bárbara Cardoso Advocacia). */
      originOfficeId: ID;
      fullName: string;
      cpf: string;
      birthDate?: string;
      contact: IndividualClient["contact"];
      address?: IndividualClient["address"];
    }
  | {
      kind: "COMPANY";
      originOfficeId: ID;
      legalName: string;
      tradeName?: string;
      cnpj: string;
      contact: CompanyClient["contact"];
      address?: CompanyClient["address"];
      representativeName?: string;
    };

export interface PartnerCaseInput {
  client: { mode: "NEW"; data: PartnerNewClientInput } | { mode: "EXISTING"; matchToken?: string; clientId?: ID };
  documents: PartnerCaseDocumentInput[];
  caseInfo: {
    title: string;
    area: LegalArea;
    actionType: string;
    opposingParty?: string;
    summary: string;
    cnj?: string;
    court?: string;
    caseValue?: number;
  };
  notes?: string;
}

export interface PartnerCaseResult {
  clientId: ID;
  processId: ID;
  submissionId: ID;
}

/** Processo cadastrado pelo parceiro. A origem (parceiro) é aplicada pelo sistema. */
export type PartnerProcessInput = Pick<
  Process,
  "clientId" | "cnj" | "title" | "court" | "unit" | "district" | "state" | "area" | "actionType" | "subject" | "clientPole" | "opposingParty" | "distributionDate" | "caseValue"
>;

export type PartnerClientBasicsPatch = {
  contact?: IndividualClient["contact"];
  address?: IndividualClient["address"];
};

export interface PartnerDocumentInput extends PartnerCaseDocumentInput {
  clientId: ID;
  processId?: ID;
  /** Envio em resposta a uma solicitação. */
  requestId?: ID;
  /** Nova versão de um documento já enviado (a anterior é preservada). */
  replacesDocumentId?: ID;
}

export interface NewPartnerRequestInput {
  partnerOfficeId: ID;
  type: PartnerRequestType;
  title: string;
  description: string;
  clientId?: ID;
  processId?: ID;
  dueDate?: string;
}

export interface PartnershipValuesInput {
  revenueBase?: number;
  realizedRevenue?: number;
}

/* ------------------------------------------------------------------ */
/* Importação                                                          */
/* ------------------------------------------------------------------ */

/**
 * Plano de importação já validado e com os conflitos resolvidos. Uma única
 * importação pode criar clientes, processos e os vínculos entre eles.
 * `ref` liga um processo ao cliente criado/atualizado na mesma importação.
 */
export interface ImportClientOperation {
  ref: string;
  action: "CREATE" | "UPDATE";
  existingId?: ID;
  input: NewClientInput;
}

interface ImportProcessLink {
  /** Cliente da mesma importação (ref) ou já existente (clientId). */
  clientRef?: string;
  clientId?: ID;
}

/** CREATE traz o processo completo; UPDATE traz só os campos presentes na planilha. */
export type ImportProcessOperation =
  | (ImportProcessLink & { action: "CREATE"; input: Omit<NewProcessInput, "clientId">; missingResponsible: boolean })
  | (ImportProcessLink & { action: "UPDATE"; existingId: ID; patch: Partial<Omit<NewProcessInput, "clientId" | "nextDeadline">> });

export interface ImportPlan {
  fileName: string;
  clients: ImportClientOperation[];
  processes: ImportProcessOperation[];
  /** Linhas descartadas por decisão do usuário (conflito → ignorar). */
  ignoredRows: number;
  /** Linhas com erro, que não foram importadas. */
  errorRows: number;
}

export interface ImportResult {
  clientsCreated: number;
  clientsUpdated: number;
  processesCreated: number;
  processesUpdated: number;
  linksCreated: number;
  ignoredRows: number;
  errorRows: number;
  processesWithoutResponsible: number;
}

/** Proposta do Tutor DG, aplicada somente após confirmação explícita. */
export interface SkillChangeProposal {
  skillId: ID;
  originalRequest: string;
  problem: string;
  suggestedChange: string;
  impact: string;
  affectedAgentIds: ID[];
  parameterChanges: { key: string; label: string; value: string }[];
  diff: DiffLine[];
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */

export interface SessionActions {
  login: (email: string) => boolean;
  logout: () => void;
  /** Simula um papel. Para papéis de parceiro, `partnerOfficeId` escolhe o escritório. */
  simulateRole: (role: Role, partnerOfficeId?: ID) => void;
  completeTour: (userId: ID) => void;
  resetDemo: () => void;
}

export interface OfficeActions {
  createOffice: (input: CreateOfficeInput) => void;
  updateOffice: (patch: Partial<Omit<Office, "id" | "onboarding">>) => void;
  saveOnboardingStep: (stepKey: string, answers: Record<string, unknown>, nextStep: number, skipped?: boolean) => void;
  setOnboardingStep: (step: number) => void;
  completeOnboarding: () => void;
  inviteUser: (input: { name: string; email: string; role: Role }) => string;
  acceptInvitation: (token: string, name: string) => boolean;
  changeUserRole: (userId: ID, role: Role) => void;
  updateUserPreferences: (userId: ID, prefs: UserPreferences) => void;
}

export interface ClientActions {
  createClient: (input: NewClientInput) => ID;
  updateClient: (id: ID, patch: ClientPatch) => void;
  inactivateClient: (id: ID, input: InactivateClientInput) => void;
  reactivateClient: (id: ID) => void;
  /** Exclui o cliente SEM excluir processos: eles ficam com vínculo pendente. */
  deleteClient: (id: ID) => DeleteClientResult;
  addDocument: (input: NewDocumentInput) => ID;
  updateDocumentStatus: (id: ID, status: DocumentStatus, notes?: string) => void;
}

export interface ImportActions {
  importData: (plan: ImportPlan) => ImportResult;
}

export interface AnalysisActions {
  startAnalysis: (input: StartAnalysisInput) => ID;
  sendAnalysisToAgent: (analysisId: ID) => void;
  simulateAgentResult: (analysisId: ID) => ID | null;
  interruptAnalysis: (analysisId: ID, reason: string) => void;
  resumeAnalysis: (analysisId: ID) => void;
}

export interface ProcessActions {
  createProcess: (input: NewProcessInput) => ID;
  updateProcess: (id: ID, patch: Partial<NewProcessInput>) => void;
  addProcessEvent: (processId: ID, input: { title: string; description?: string; important?: boolean }) => void;
  addDeadline: (input: NewDeadlineInput) => ID;
  completeDeadline: (id: ID) => void;
  /** Exclui o processo. Nunca exclui o cliente. */
  deleteProcess: (id: ID) => void;
  /** Vincula (ou revincula) o cliente de um processo, resolvendo vínculo pendente. */
  linkProcessClient: (processId: ID, clientId: ID) => void;
}

export interface ReviewActions {
  decideReview: (reviewId: ID, decision: ReviewDecisionKind, comment?: string) => void;
  /** Edição manual: guarda a versão anterior e registra MANUAL_EDIT. */
  editReviewContent: (reviewId: ID, content: ReviewContent) => void;
  /** Advogado comanda o agente: nova versão (AGENT_EDIT) que continua aguardando decisão. */
  requestAgentEdit: (reviewId: ID, instruction: string) => void;
  /** Registra na auditoria o download de uma versão (rascunho ou aprovada). */
  recordReviewDownload: (reviewId: ID, version: number, format: ExportFormat, draft: boolean) => void;
  /** Reabre uma revisão decidida, preservando a decisão anterior no histórico. */
  reopenReview: (reviewId: ID, reason?: string) => void;
  markNotificationRead: (id: ID) => void;
  markAllNotificationsRead: () => void;
}

export interface FinanceActions {
  createFeeModel: (input: NewFeeModelInput) => ID;
  updateFeeModel: (id: ID, patch: Partial<NewFeeModelInput>) => void;
  createAgreement: (input: NewAgreementInput) => ID;
  /** Registra recebimento (total ou parcial). O status é recalculado, não gravado. */
  registerPayment: (paymentId: ID, input?: RegisterPaymentInput) => void;
  /** Corrige o total recebido de uma parcela. */
  updatePaymentAmount: (paymentId: ID, paidAmount: number) => void;
  /** Estorna todos os recebimentos da parcela. */
  reversePayment: (paymentId: ID) => void;
  updatePaymentDueDate: (paymentId: ID, dueDate: string) => void;
}

export interface DgActions {
  createAgent: (input: NewAgentInput) => ID;
  updateAgent: (id: ID, patch: Partial<Pick<Agent, "status" | "autonomy" | "rules" | "skillIds" | "thesisIds" | "description">>) => void;
  createSkill: (input: NewSkillInput) => ID;
  createThesis: (input: NewThesisInput) => ID;
  applySkillChange: (proposal: SkillChangeProposal) => ID;
  cancelSkillChange: (proposal: SkillChangeProposal) => ID;
  updateIntegrationStatus: (id: ID, status: IntegrationStatus) => void;
  syncIntegration: (id: ID) => void;
  configureJudicialSource: (id: ID, config: JudicialSourceConfigInput) => void;
  /** Registra o resultado de uma sincronização (simulada) da fonte. */
  recordJudicialSync: (id: ID, result: { syncedAt: string; newItems: number; latestItemAt?: string }) => void;
}

export interface PartnerActions {
  /* Escritório proprietário */
  createPartnerOffice: (input: NewPartnerOfficeInput) => ID;
  updatePartnerOffice: (id: ID, patch: PartnerOfficePatch) => void;
  setPartnerOfficeStatus: (id: ID, status: PartnerOfficeStatus) => void;
  /** Muda a divisão PADRÃO. Vale só para novos casos; acordos existentes não mudam. */
  changePartnerShare: (id: ID, partnerPercentage: number, ownerPercentage: number) => void;
  setSubmissionStatus: (submissionId: ID, status: SubmissionStatus) => void;
  shareDocumentWithPartner: (documentId: ID) => void;
  createPartnerRequest: (input: NewPartnerRequestInput) => ID;
  resolvePartnerRequest: (id: ID, resolution: "RESOLVED" | "CANCELLED") => void;
  updatePartnershipValues: (agreementId: ID, input: PartnershipValuesInput) => void;
  registerPartnerPayout: (agreementId: ID, amount: number, note?: string) => void;
  /* Proprietário (qualquer parceiro) ou Partner Admin (somente o próprio escritório) */
  invitePartnerUser: (partnerOfficeId: ID, input: { name: string; email: string; role: PartnerRole }) => string;
  setPartnerUserStatus: (userId: ID, status: "ACTIVE" | "DISABLED") => void;
  changePartnerUserRole: (userId: ID, role: PartnerRole) => void;
  /* Portal do parceiro (escopo sempre da sessão) */
  lookupClientDocument: (document: string) => ClientLookupResult;
  submitPartnerCase: (input: PartnerCaseInput) => PartnerCaseResult;
  createPartnerProcess: (input: PartnerProcessInput) => ID;
  updatePartnerClientBasics: (clientId: ID, patch: PartnerClientBasicsPatch) => void;
  submitPartnerDocument: (input: PartnerDocumentInput) => ID;
  respondPartnerRequest: (requestId: ID, message: string) => void;
}

export type AppActions = SessionActions &
  OfficeActions &
  ClientActions &
  ImportActions &
  AnalysisActions &
  ProcessActions &
  ReviewActions &
  FinanceActions &
  DgActions &
  PartnerActions;

export type AppStore = AppState & AppActions;

export type { Client };
