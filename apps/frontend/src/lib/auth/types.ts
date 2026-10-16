import type { Permission, Role } from "@/lib/permissions";

/** Os cinco papéis definitivos (fonte: organization_memberships.role). */
export type AppRole = Role;
export type AppPermission = Permission;

/** Superfície da aplicação: ambiente interno ou portal do parceiro. */
export type AppSurface = "INTERNAL" | "PARTNER";

export type OrganizationType = "OWNER" | "PARTNER";
export type LegalDocumentType = "TERMS_OF_USE" | "PRIVACY_POLICY" | "CONFIDENTIALITY";

/**
 * Em que ponto a pessoa está. Derivado, nunca gravado: sai do banco
 * (perfil, vínculo, organização, termos) + nível de autenticação do Auth.
 */
export type AuthOnboardingState =
  | "ANONYMOUS"
  /** A sessão deste JWT foi encerrada (outro dispositivo saiu de todos, senha trocada) ou é anterior a um reset de MFA (038). */
  | "SESSION_REVOKED"
  | "PROFILE_MISSING"
  | "PROFILE_INACTIVE"
  | "NO_MEMBERSHIP"
  | "MEMBERSHIP_INACTIVE"
  | "ORGANIZATION_PENDING"
  | "ORGANIZATION_BLOCKED"
  | "MFA_VERIFY"
  | "LEGAL_PENDING"
  | "MFA_ENROLL"
  | "READY";

/** O que `public.get_my_session_context()` devolve (migration 022). */
export interface SessionContextRow {
  user_id: string;
  email: string | null;
  profile: { full_name: string; preferred_name: string | null; job_title: string | null; active: boolean } | null;
  membership: {
    id: string;
    role: AppRole;
    status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
    organization: { id: string; type: OrganizationType; name: string; status: string; deleted: boolean };
  } | null;
  legal_acceptances: { document_type: string; document_version: string }[];
  aal: string;
  /** 038: estado da sessão do JWT (ausente antes da 038). */
  session_state?: "VALID" | "NO_SESSION_CLAIM" | "REVOKED" | "REAUTH_REQUIRED";
}

export interface MfaStatus {
  /** Nível da sessão atual (aal1 = só senha; aal2 = senha + TOTP). */
  currentLevel: "aal1" | "aal2" | null;
  /** Já existe fator TOTP verificado para o usuário. */
  hasVerifiedFactor: boolean;
}

/**
 * Sessão normalizada da aplicação. Só o necessário para decidir acesso e
 * montar a interface. Não tem token nem segredo.
 */
export interface AppSession {
  userId: string;
  profileId: string;
  email: string;
  fullName: string;
  displayName: string;
  jobTitle: string | null;
  organizationId: string;
  organizationType: OrganizationType;
  organizationName: string;
  organizationStatus: string;
  role: AppRole;
  membershipId: string;
  membershipStatus: string;
  profileActive: boolean;
  mfaLevel: "aal1" | "aal2" | null;
  hasVerifiedMfaFactor: boolean;
  legalAcceptanceStatus: "ACCEPTED" | "PENDING";
  pendingLegalDocuments: LegalDocumentType[];
  surface: AppSurface;
}

export interface SessionResult {
  state: AuthOnboardingState;
  /** Presente quando há vínculo e organização válidos (mesmo no onboarding). */
  session?: AppSession;
  userId?: string;
  email?: string;
  fullName?: string;
  /** Estado do MFA da conta, mesmo sem vínculo (ex.: reconvite de conta com autenticador). */
  mfa?: MfaStatus;
}

/** Recorte da sessão que vai para o navegador (sem dado de controle interno). */
export type ClientSession = Pick<
  AppSession,
  | "userId"
  | "email"
  | "fullName"
  | "displayName"
  | "jobTitle"
  | "organizationId"
  | "organizationType"
  | "organizationName"
  | "role"
  | "surface"
>;
