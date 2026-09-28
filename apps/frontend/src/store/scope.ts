"use client";

/**
 * Recorte do estado por público (escopo de dados).
 *
 * TODO dado lido pela interface passa por `selectScoped` (via
 * `useScopedStore` nos hooks das features e pelos repositórios mock):
 *
 * - Equipe interna (OWNER): enxerga a base inteira, exceto notificações
 *   endereçadas a parceiros.
 * - Parceiro (PARTNER): recebe apenas os registros da própria relação, já
 *   sem campos internos (regras em `lib/permissions/partner-scope.ts`).
 *   Revisões, agentes, Skills, teses, financeiro global, integrações,
 *   consumo de IA e auditoria interna simplesmente NÃO existem no estado
 *   que ele recebe — não são escondidos por CSS.
 *
 * O `partnerOfficeId` vem do usuário da sessão, nunca de parâmetro de tela.
 * No backend, este mesmo recorte acontece no servidor.
 */
import type { DataState } from "@/mocks";
import { can } from "@/lib/permissions";
import {
  partnerCanSeeAuditEvent,
  partnerCanSeeDocument,
  partnerCanSeeNotification,
  partnerCanSeeProcess,
  partnerCanSeeProcessEvent,
  partnerRelatedClientIds,
  redactAuditEventForPartner,
  redactClientForPartner,
  redactDocumentForPartner,
  redactProcessForPartner,
} from "@/lib/permissions/partner-scope";
import { OPEN_REVIEW_STATUSES, type ReviewType } from "@/lib/constants/status";
import type { AIUsage, ID, ISODateTime } from "@/types";
import { useAppStore } from "./app-store";
import { viewerOf, type Viewer } from "./helpers";
import type { AppState } from "./types";

export { viewerOf, type Viewer };

/**
 * Sinal genérico de "documento em revisão interna" para o parceiro: diz
 * apenas QUE existe algo em revisão, sem conteúdo, comentários ou autoria.
 */
export interface InternalReviewSignal {
  id: ID;
  processId: ID;
  type: ReviewType;
  since: ISODateTime;
}

export type ScopedData = DataState & { reviewSignals: InternalReviewSignal[] };

/* ------------------------------------------------------------------ */
/* Memoização por campo: mantém referências estáveis entre renders      */
/* ------------------------------------------------------------------ */

const fieldCache = new Map<string, { deps: readonly unknown[]; value: unknown }>();

function memo<T>(key: string, deps: readonly unknown[], compute: () => T): T {
  const hit = fieldCache.get(key);
  if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => Object.is(d, deps[i]))) return hit.value as T;
  const value = compute();
  fieldCache.set(key, { deps, value });
  return value;
}

const EMPTY: never[] = [];

const EMPTY_AI_USAGE: AIUsage = {
  officeId: "",
  month: "",
  organization: "",
  primaryModel: "",
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  daily: [],
  byAgent: [],
  byModel: [],
  lastSyncAt: "",
};

function ownerScope(state: AppState): ScopedData {
  return {
    ...pickData(state),
    // Notificações endereçadas a parceiros não pertencem à caixa interna.
    notifications: memo("owner.notifications", [state.notifications], () => state.notifications.filter((n) => !n.partnerOfficeId)),
    reviewSignals: EMPTY,
  };
}

function partnerScope(state: AppState, viewer: Viewer): ScopedData {
  const pid = viewer.partnerOfficeId;
  const vk = `${viewer.userId}|${viewer.role}|${pid ?? "none"}`;
  const k = (name: string) => `partner.${name}`;
  // Parceiro sem escritório definido não recebe nada.
  const partnerId = pid ?? "__none__";

  const processes = memo(k("processes"), [vk, state.processes], () =>
    state.processes.filter((p) => partnerCanSeeProcess(p, partnerId)).map(redactProcessForPartner),
  );
  const processIds = memo(k("processIds"), [processes], () => new Set(processes.map((p) => p.id)));
  const relatedClientIds = memo(k("relatedClientIds"), [vk, state.clientRelationships], () =>
    partnerRelatedClientIds(state.clientRelationships, partnerId),
  );
  const partnerUserIds = memo(k("partnerUserIds"), [vk, state.users], () =>
    new Set(state.users.filter((u) => u.partnerOfficeId === partnerId).map((u) => u.id)),
  );
  const canFinance = can(viewer.role, "partnerPortal.finance.view");

  return {
    office: memo(k("office"), [state.office], () => ({
      ...state.office,
      onboarding: { ...state.office.onboarding, answers: {} },
    })),
    subscription: memo(k("subscription"), [state.subscription], () => ({ ...state.subscription, planName: "", seats: 0, supportContact: "" })),
    users: memo(k("users"), [vk, state.users], () => state.users.filter((u) => u.partnerOfficeId === partnerId)),
    invitations: memo(k("invitations"), [vk, state.invitations], () => state.invitations.filter((i) => i.partnerOfficeId === partnerId)),
    sessions: memo(k("sessions"), [vk, state.sessions], () => state.sessions.filter((s) => s.userId === viewer.userId)),
    clients: memo(k("clients"), [state.clients, relatedClientIds], () =>
      state.clients.filter((c) => relatedClientIds.has(c.id)).map(redactClientForPartner),
    ),
    documents: memo(k("documents"), [vk, state.documents, processIds], () =>
      state.documents.filter((d) => partnerCanSeeDocument(d, partnerId, processIds)).map(redactDocumentForPartner),
    ),
    templates: EMPTY,
    analyses: EMPTY,
    processes,
    processEvents: memo(k("processEvents"), [state.processEvents, processIds], () =>
      state.processEvents.filter((e) => partnerCanSeeProcessEvent(e, processIds)),
    ),
    deadlines: EMPTY,
    reviews: EMPTY,
    reviewDecisions: EMPTY,
    agents: EMPTY,
    agentTasks: EMPTY,
    skills: EMPTY,
    theses: EMPTY,
    changeHistory: EMPTY,
    notifications: memo(k("notifications"), [vk, state.notifications], () =>
      state.notifications.filter((n) => partnerCanSeeNotification(n, partnerId) && can(viewer.role, n.requiredPermission)),
    ),
    feeModels: EMPTY,
    agreements: EMPTY,
    payments: EMPTY,
    integrations: EMPTY,
    judicialSources: EMPTY,
    removedClients: EMPTY,
    aiUsage: EMPTY_AI_USAGE,
    auditEvents: memo(k("auditEvents"), [vk, state.auditEvents, state.office.name, partnerUserIds], () =>
      state.auditEvents
        .filter((e) => partnerCanSeeAuditEvent(e, partnerId))
        .map((e) => redactAuditEventForPartner(e, state.office.name, partnerUserIds)),
    ),
    partnerOffices: memo(k("partnerOffices"), [vk, state.partnerOffices], () =>
      state.partnerOffices
        .filter((p) => p.id === partnerId)
        // Observações internas sobre o parceiro não são dele.
        .map(({ notes: _notes, ...rest }) => {
          void _notes;
          return rest;
        }),
    ),
    clientRelationships: memo(k("clientRelationships"), [vk, state.clientRelationships], () =>
      state.clientRelationships.filter((r) => r.partnerOfficeId === partnerId),
    ),
    partnerSubmissions: memo(k("partnerSubmissions"), [vk, state.partnerSubmissions], () =>
      state.partnerSubmissions.filter((s) => s.partnerOfficeId === partnerId),
    ),
    partnerRequests: memo(k("partnerRequests"), [vk, state.partnerRequests], () =>
      state.partnerRequests.filter((r) => r.partnerOfficeId === partnerId),
    ),
    // Valores da parceria só para quem tem permissão financeira do portal.
    partnershipAgreements: canFinance
      ? memo(k("partnershipAgreements"), [vk, state.partnershipAgreements], () =>
          state.partnershipAgreements.filter((a) => a.partnerOfficeId === partnerId),
        )
      : EMPTY,
    reviewSignals: memo(k("reviewSignals"), [state.reviews, processIds], () =>
      state.reviews
        .filter((r) => r.processId && processIds.has(r.processId) && OPEN_REVIEW_STATUSES.includes(r.status))
        .map((r) => ({ id: `sig_${r.id}`, processId: r.processId as ID, type: r.type, since: r.createdAt })),
    ),
  };
}

/** Somente os campos de dados (sem sessão, preferências nem ações). */
function pickData(state: AppState): DataState {
  return {
    office: state.office,
    subscription: state.subscription,
    users: state.users,
    invitations: state.invitations,
    sessions: state.sessions,
    clients: state.clients,
    documents: state.documents,
    templates: state.templates,
    analyses: state.analyses,
    processes: state.processes,
    processEvents: state.processEvents,
    deadlines: state.deadlines,
    reviews: state.reviews,
    reviewDecisions: state.reviewDecisions,
    agents: state.agents,
    agentTasks: state.agentTasks,
    skills: state.skills,
    theses: state.theses,
    changeHistory: state.changeHistory,
    notifications: state.notifications,
    feeModels: state.feeModels,
    agreements: state.agreements,
    payments: state.payments,
    integrations: state.integrations,
    judicialSources: state.judicialSources,
    removedClients: state.removedClients,
    aiUsage: state.aiUsage,
    auditEvents: state.auditEvents,
    partnerOffices: state.partnerOffices,
    clientRelationships: state.clientRelationships,
    partnerSubmissions: state.partnerSubmissions,
    partnerRequests: state.partnerRequests,
    partnershipAgreements: state.partnershipAgreements,
  };
}

const scopedByState = new WeakMap<AppState, ScopedData>();

/** Estado já recortado para o usuário da sessão. Mesmo estado → mesmo objeto. */
export function selectScoped(state: AppState): ScopedData {
  const cached = scopedByState.get(state);
  if (cached) return cached;
  const viewer = viewerOf(state);
  // Sem usuário identificado, nega por padrão (escopo vazio de parceiro).
  const scoped = !viewer
    ? partnerScope(state, { userId: "", role: "PARTNER_USER", audience: "PARTNER" })
    : viewer.audience === "PARTNER"
      ? partnerScope(state, viewer)
      : ownerScope(state);
  scopedByState.set(state, scoped);
  return scoped;
}

/**
 * Leitura reativa do estado RECORTADO. É o que os hooks das features usam
 * para ler dados. O selector deve devolver um campo (referência estável),
 * nunca um array novo.
 */
export function useScopedStore<T>(selector: (data: ScopedData) => T): T {
  return useAppStore((s) => selector(selectScoped(s)));
}
