import { audienceOf } from "@/lib/permissions";
import { pendingLegalDocuments } from "./legal-documents";
import { surfaceForRole } from "./surface";
import type { AppSession, MfaStatus, SessionContextRow, SessionResult } from "./types";

/**
 * Decide o estado da sessão a partir do que o banco e o Auth dizem AGORA.
 * Função pura (sem I/O): o servidor chama com dados frescos a cada requisição,
 * por isso mudança de papel, inativação e suspensão valem na hora.
 *
 * Ordem: conta válida (perfil → vínculo → organização) → MFA de quem já tem
 * fator → termos → cadastro do MFA → liberado.
 */
export function evaluateSession(ctx: SessionContextRow | null, mfa: MfaStatus): SessionResult {
  if (!ctx) return { state: "ANONYMOUS" };
  const base = { userId: ctx.user_id, email: ctx.email ?? undefined, fullName: ctx.profile?.full_name ?? undefined };

  if (!ctx.profile) return { ...base, state: "PROFILE_MISSING" };
  if (!ctx.profile.active) return { ...base, state: "PROFILE_INACTIVE" };

  const m = ctx.membership;
  if (!m) return { ...base, state: "NO_MEMBERSHIP" };
  if (m.status !== "ACTIVE") return { ...base, state: "MEMBERSHIP_INACTIVE" };

  const org = m.organization;
  if (org.deleted || org.status === "SUSPENDED" || org.status === "INACTIVE") {
    return { ...base, state: "ORGANIZATION_BLOCKED" };
  }
  if (org.status === "PENDING") return { ...base, state: "ORGANIZATION_PENDING" };
  if (org.status !== "ACTIVE") return { ...base, state: "ORGANIZATION_BLOCKED" };

  // Papel precisa combinar com o tipo da organização (o banco já garante; aqui
  // é defesa contra dado inconsistente).
  const expected = org.type === "OWNER" ? "OWNER" : "PARTNER";
  if (audienceOf(m.role) !== expected) return { ...base, state: "MEMBERSHIP_INACTIVE" };

  const pending = pendingLegalDocuments(ctx.legal_acceptances);
  const fullName = ctx.profile.full_name;
  const session: AppSession = {
    userId: ctx.user_id,
    profileId: ctx.user_id,
    email: ctx.email ?? "",
    fullName,
    displayName: ctx.profile.preferred_name?.trim() || fullName.split(/\s+/)[0] || fullName,
    jobTitle: ctx.profile.job_title,
    organizationId: org.id,
    organizationType: org.type,
    organizationName: org.name,
    organizationStatus: org.status,
    role: m.role,
    membershipId: m.id,
    membershipStatus: m.status,
    profileActive: ctx.profile.active,
    mfaLevel: mfa.currentLevel,
    hasVerifiedMfaFactor: mfa.hasVerifiedFactor,
    legalAcceptanceStatus: pending.length ? "PENDING" : "ACCEPTED",
    pendingLegalDocuments: pending,
    surface: surfaceForRole(m.role),
  };

  if (mfa.hasVerifiedFactor && mfa.currentLevel !== "aal2") return { ...base, state: "MFA_VERIFY", session };
  if (pending.length) return { ...base, state: "LEGAL_PENDING", session };
  if (!mfa.hasVerifiedFactor) return { ...base, state: "MFA_ENROLL", session };
  if (mfa.currentLevel !== "aal2") return { ...base, state: "MFA_VERIFY", session };
  return { ...base, state: "READY", session };
}
