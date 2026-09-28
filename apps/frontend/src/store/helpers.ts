import type { StoreApi } from "zustand";
import { nowISO } from "@/lib/clock";
import { createId } from "@/lib/ids";
import { audienceOf, type Audience, type Role } from "@/lib/permissions";
import type { ActorRef, AnalysisEvent, AuditAction, AuditEvent, ID, LegalAnalysis, Notification, User } from "@/types";
import type { AppState, AppStore } from "./types";

export type SetState = StoreApi<AppStore>["setState"];
export type GetState = StoreApi<AppStore>["getState"];

export function currentUser(state: AppState): User | undefined {
  return state.users.find((u) => u.id === state.session.currentUserId);
}

export interface Viewer {
  userId: ID;
  role: Role;
  audience: Audience;
  /** Presente quando o usuário é de escritório parceiro. */
  partnerOfficeId?: ID;
}

export function viewerOf(state: AppState): Viewer | undefined {
  const user = state.users.find((u) => u.id === state.session.currentUserId);
  if (!user) return undefined;
  const audience = audienceOf(user.role) ?? "OWNER";
  return { userId: user.id, role: user.role, audience, partnerOfficeId: audience === "PARTNER" ? user.partnerOfficeId : undefined };
}

/**
 * Garante que a ação é executada por um usuário de escritório parceiro e
 * devolve o escritório DA SESSÃO. Ações do portal nunca recebem o
 * partnerOfficeId da tela (no backend: vem do token/sessão).
 */
export function requirePartnerViewer(state: AppState): Viewer & { partnerOfficeId: ID } {
  const viewer = viewerOf(state);
  if (!viewer || viewer.audience !== "PARTNER" || !viewer.partnerOfficeId) throw new Error("Ação disponível apenas para escritórios parceiros.");
  return viewer as Viewer & { partnerOfficeId: ID };
}

/** Garante que a ação é da equipe interna (escritório proprietário). */
export function requireOwnerViewer(state: AppState): Viewer {
  const viewer = viewerOf(state);
  if (!viewer || viewer.audience !== "OWNER") throw new Error("Ação disponível apenas para a equipe interna.");
  return viewer;
}

/** Referência de autoria da ação atual (usuário logado). */
export function actorOf(state: AppState): ActorRef {
  const user = currentUser(state);
  return user
    ? { type: "USER", id: user.id, name: user.name }
    : { type: "SYSTEM", id: "system", name: "DG Brasil" };
}

export function agentActor(state: AppState, agentId: ID): ActorRef {
  const agent = state.agents.find((a) => a.id === agentId);
  return { type: "AGENT", id: agentId, name: agent?.name ?? "Agente" };
}

export const SYSTEM_ACTOR: ActorRef = { type: "SYSTEM", id: "system", name: "DG Brasil" };

/** Cria um evento de auditoria (a inserção fica a cargo de quem chama). */
export function auditEvent(
  state: AppState,
  action: AuditAction,
  entityType: string,
  entityId: ID,
  description: string,
  actor: ActorRef = actorOf(state),
  details?: AuditEvent["details"],
  partner?: { partnerOfficeId: ID; summary?: string },
): AuditEvent {
  return {
    id: createId("aud"),
    officeId: state.office.id,
    at: nowISO(),
    actor,
    action,
    entityType,
    entityId,
    description,
    ...(details && details.length > 0 ? { details } : {}),
    ...(partner ? { partnerOfficeId: partner.partnerOfficeId, ...(partner.summary ? { partnerSummary: partner.summary } : {}) } : {}),
  };
}

/**
 * Alerta DATA_INTEGRITY: dados que precisam de revisão humana (processo sem
 * cliente, importação incompleta, pagamento inconsistente…). A severidade é
 * escolhida por quem chama; nem todo alerta de integridade é crítico.
 */
export function integrityNotification(
  state: AppState,
  input: Pick<Notification, "severity" | "title" | "description" | "cta" | "requiredPermission"> & Partial<Pick<Notification, "clientId" | "processId">>,
): Notification {
  return { id: createId("ntf"), officeId: state.office.id, type: "DATA_INTEGRITY", at: nowISO(), read: false, ...input };
}

export function timelineEvent(actor: ActorRef, message: string): AnalysisEvent {
  return { id: createId("ev"), at: nowISO(), actor, message };
}

/** Atualiza um item de uma lista por id, retornando nova lista. */
export function updateById<T extends { id: ID }>(list: T[], id: ID, update: (item: T) => T): T[] {
  return list.map((item) => (item.id === id ? update(item) : item));
}

export function withStep(
  analysis: LegalAnalysis,
  statuses: Partial<Record<string, LegalAnalysis["steps"][number]["status"]>>,
): LegalAnalysis["steps"] {
  const at = nowISO();
  return analysis.steps.map((s) => {
    const next = statuses[s.key];
    if (!next || next === s.status) return s;
    return { ...s, status: next, at: next === "PENDING" ? undefined : at };
  });
}
