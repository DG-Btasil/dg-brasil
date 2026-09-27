import type { DataState } from "@/mocks";
import type {
  DeadlineType,
  DocumentCategory,
  DocumentStatus,
  IntegrationStatus,
  NotificationType,
  ReviewDecisionKind,
} from "@/lib/constants/status";
import type {
  Agent,
  Client,
  CompanyClient,
  DiffLine,
  FeeModel,
  ID,
  IndividualClient,
  Office,
  Process,
  Role,
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

export type NewProcessInput = Omit<Process, "id" | "officeId" | "createdAt" | "updatedAt" | "origin" | "lastMovementAt"> & {
  origin?: Process["origin"];
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
  simulateRole: (role: Role) => void;
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
  addDocument: (input: NewDocumentInput) => ID;
  updateDocumentStatus: (id: ID, status: DocumentStatus, notes?: string) => void;
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
}

export interface ReviewActions {
  decideReview: (reviewId: ID, decision: ReviewDecisionKind, comment?: string) => void;
  markNotificationRead: (id: ID) => void;
  markAllNotificationsRead: () => void;
}

export interface FinanceActions {
  createFeeModel: (input: NewFeeModelInput) => ID;
  updateFeeModel: (id: ID, patch: Partial<NewFeeModelInput>) => void;
  createAgreement: (input: NewAgreementInput) => ID;
  registerPayment: (paymentId: ID) => void;
}

export interface DgActions {
  updateAgent: (id: ID, patch: Partial<Pick<Agent, "status" | "autonomy" | "rules" | "skillIds" | "thesisIds" | "description">>) => void;
  applySkillChange: (proposal: SkillChangeProposal) => ID;
  cancelSkillChange: (proposal: SkillChangeProposal) => ID;
  updateIntegrationStatus: (id: ID, status: IntegrationStatus) => void;
  syncIntegration: (id: ID) => void;
}

export type AppActions = SessionActions &
  OfficeActions &
  ClientActions &
  AnalysisActions &
  ProcessActions &
  ReviewActions &
  FinanceActions &
  DgActions;

export type AppStore = AppState & AppActions;

export type { Client };
