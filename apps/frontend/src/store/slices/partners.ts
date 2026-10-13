import { nowISO } from "@/lib/clock";
import { PARTNER_OFFICE_STATUS_LABEL, PARTNER_REQUEST_TYPE_LABEL } from "@/lib/constants/status";
import { isValidShare, partnershipView } from "@/lib/domain/partnership";
import { formatCurrency } from "@/lib/formatting";
import { createId } from "@/lib/ids";
import { can, ROLE_LABEL } from "@/lib/permissions";
import type { ID, Notification, PartnerOffice } from "@/types";
import {
  actorOf,
  auditEvent,
  requireOwnerViewer,
  updateById,
  viewerOf,
  type GetState,
  type SetState,
} from "../helpers";
import type { AppState, PartnerActions } from "../types";
import { clientName } from "./clients-analyses";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function partnerOf(state: AppState, id: ID): PartnerOffice {
  const partner = state.partnerOffices.find((p) => p.id === id);
  if (!partner) throw new Error("Escritório parceiro não encontrado.");
  return partner;
}

/** Parceiro com acesso operacional ao caso (ausente = caso interno). */
function casePartnerOf(state: AppState, legalCaseId: ID | undefined): ID | undefined {
  const legalCase = legalCaseId ? state.legalCases.find((c) => c.id === legalCaseId) : undefined;
  return legalCase?.partnerOrganizationId ?? undefined;
}

/** Notificação endereçada a um parceiro (nunca aparece na caixa interna). */
function partnerNotification(
  state: AppState,
  partnerOfficeId: ID,
  input: Pick<Notification, "type" | "severity" | "title" | "description" | "cta"> & Partial<Pick<Notification, "clientId" | "legalCaseId" | "processId" | "requiredPermission">>,
): Notification {
  return {
    id: createId("ntf"),
    officeId: state.office.id,
    partnerOfficeId,
    at: nowISO(),
    read: false,
    requiredPermission: "partnerPortal.view",
    ...input,
  };
}

/* ------------------------------------------------------------------ */
/* Slice                                                               */
/* ------------------------------------------------------------------ */

export function createPartnerSlice(set: SetState, get: GetState): PartnerActions {
  /** Autoriza gestão de usuários do parceiro: proprietário com partners.manage ou Partner Admin do mesmo escritório. */
  function assertCanManagePartnerUsers(state: AppState, partnerOfficeId: ID) {
    const viewer = viewerOf(state);
    if (!viewer) throw new Error("Sessão inválida.");
    if (viewer.audience === "OWNER" && can(viewer.role, "partners.manage")) return viewer;
    if (viewer.audience === "PARTNER" && viewer.partnerOfficeId === partnerOfficeId && can(viewer.role, "partnerPortal.users.manage")) return viewer;
    throw new Error("Sem permissão para administrar usuários deste escritório.");
  }

  return {
    /* -------------------------- Proprietário -------------------------- */

    createPartnerOffice: (input) => {
      const s = get();
      requireOwnerViewer(s);
      if (!isValidShare(input.partnershipPercentage, input.ownerPercentage)) throw new Error("A divisão precisa somar 100%.");
      const at = nowISO();
      const id = createId("pof");
      const partner: PartnerOffice = { ...input, id, officeId: s.office.id, status: "PENDING_INVITE", createdAt: at, updatedAt: at };
      const userId = createId("usr");
      const token = createId("convite");
      set({
        partnerOffices: [partner, ...s.partnerOffices],
        users: [
          ...s.users,
          {
            id: userId,
            officeId: s.office.id,
            partnerOfficeId: id,
            name: input.responsibleName,
            displayName: input.responsibleName.split(/\s+/)[0] ?? input.responsibleName,
            email: input.email,
            role: "PARTNER_ADMIN",
            title: "Responsável pela parceria",
            oab: `OAB/${input.oabState} ${input.responsibleOab}`,
            status: "INVITED",
            hasCompletedTour: true,
            createdAt: at,
          },
        ],
        invitations: [
          ...s.invitations,
          { id: createId("inv"), officeId: s.office.id, token, email: input.email, name: input.responsibleName, role: "PARTNER_ADMIN", partnerOfficeId: id, invitedBy: actorOf(s).id, createdAt: at },
        ],
        auditEvents: [
          auditEvent(s, "PARTNER_USER_INVITED", "user", userId, `${input.responsibleName} convidado(a) como ${ROLE_LABEL.PARTNER_ADMIN} (${input.name}).`, undefined, undefined, {
            partnerOfficeId: id,
            summary: `${input.responsibleName} foi convidado(a) para o portal.`,
          }),
          auditEvent(
            s,
            "PARTNER_CREATED",
            "partnerOffice",
            id,
            `Parceiro ${input.name} cadastrado (divisão ${input.partnershipPercentage}% / ${input.ownerPercentage}%).`,
            undefined,
            [
              { label: "Participação do parceiro", value: `${input.partnershipPercentage}%` },
              { label: "Participação Bárbara Cardoso Advocacia", value: `${input.ownerPercentage}%` },
            ],
            { partnerOfficeId: id, summary: "Parceria com Bárbara Cardoso Advocacia iniciada." },
          ),
          ...s.auditEvents,
        ],
      });
      return id;
    },

    updatePartnerOffice: (id, patch) =>
      set((s) => {
        requireOwnerViewer(s);
        const before = partnerOf(s, id);
        const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => JSON.stringify(patch[k] ?? null) !== JSON.stringify(before[k] ?? null));
        return {
          partnerOffices: updateById(s.partnerOffices, id, (p) => ({ ...p, ...patch, updatedAt: nowISO() })),
          auditEvents: [
            auditEvent(s, "PARTNER_UPDATED", "partnerOffice", id, `Dados do parceiro ${before.name} editados.`, undefined, [
              { label: "Campos alterados", value: changed.length ? changed.join(", ") : "Nenhum" },
            ], { partnerOfficeId: id }),
            ...s.auditEvents,
          ],
        };
      }),

    setPartnerOfficeStatus: (id, status) =>
      set((s) => {
        requireOwnerViewer(s);
        const before = partnerOf(s, id);
        if (before.status === status) return {};
        const at = nowISO();
        return {
          partnerOffices: updateById(s.partnerOffices, id, (p) => ({ ...p, status, updatedAt: at, ...(status === "ACTIVE" && !p.activatedAt ? { activatedAt: at } : {}) })),
          auditEvents: [
            auditEvent(s, "PARTNER_STATUS_CHANGED", "partnerOffice", id, `Situação de ${before.name}: ${PARTNER_OFFICE_STATUS_LABEL[before.status]} → ${PARTNER_OFFICE_STATUS_LABEL[status]}.`, undefined, undefined, { partnerOfficeId: id }),
            ...s.auditEvents,
          ],
        };
      }),

    changePartnerShare: (id, partnerPercentage, ownerPercentage) =>
      set((s) => {
        requireOwnerViewer(s);
        if (!isValidShare(partnerPercentage, ownerPercentage)) throw new Error("A divisão precisa somar 100%.");
        const before = partnerOf(s, id);
        const preserved = s.partnershipAgreements.filter((a) => a.partnerOfficeId === id).length;
        return {
          partnerOffices: updateById(s.partnerOffices, id, (p) => ({ ...p, partnershipPercentage: partnerPercentage, ownerPercentage, updatedAt: nowISO() })),
          auditEvents: [
            auditEvent(s, "PARTNER_SHARE_CHANGED", "partnerOffice", id, `Divisão padrão de ${before.name} alterada. Vale apenas para novos casos.`, undefined, [
              { label: "Antes", value: `${before.partnershipPercentage}% parceiro / ${before.ownerPercentage}% Bárbara` },
              { label: "Depois", value: `${partnerPercentage}% parceiro / ${ownerPercentage}% Bárbara` },
              { label: "Acordos existentes preservados", value: String(preserved) },
            ], { partnerOfficeId: id }),
            ...s.auditEvents,
          ],
        };
      }),

    shareDocumentWithPartner: (documentId) =>
      set((s) => {
        requireOwnerViewer(s);
        const doc = s.documents.find((d) => d.id === documentId);
        const legalCaseId = doc?.legalCaseId ?? s.processes.find((p) => p.id === doc?.processId)?.legalCaseId;
        const pid = casePartnerOf(s, legalCaseId);
        if (!doc || !legalCaseId || !pid) throw new Error("Somente documentos de casos de parceiros podem ser disponibilizados.");
        if (doc.visibility === "PARTNER_VISIBLE") return {};
        const client = s.clients.find((c) => c.id === doc.clientId);
        return {
          documents: updateById(s.documents, documentId, (d) => ({ ...d, visibility: "PARTNER_VISIBLE" as const, updatedAt: nowISO() })),
          notifications: [
            partnerNotification(s, pid, {
              type: "DOCUMENT_APPROVED",
              severity: "info",
              title: "Documento aprovado",
              description: `${clientName(client)} · ${doc.name}.`,
              clientId: doc.clientId,
              legalCaseId,
              cta: { label: "Ver documento", href: `/casos/${legalCaseId}?aba=documentos` },
            }),
            ...s.notifications,
          ],
          auditEvents: [
            auditEvent(s, "DOCUMENT_SHARED_WITH_PARTNER", "document", documentId, `“${doc.name}” disponibilizado ao parceiro.`, undefined, undefined, {
              partnerOfficeId: pid,
              summary: `Documento aprovado disponível: ${doc.name} (${clientName(client)}).`,
            }),
            ...s.auditEvents,
          ],
        };
      }),

    createPartnerRequest: (input) => {
      const s = get();
      const viewer = requireOwnerViewer(s);
      if (!can(viewer.role, "partnerRequests.manage")) throw new Error("Sem permissão para criar solicitações.");
      const partner = partnerOf(s, input.partnerOfficeId);
      const id = createId("prq");
      const at = nowISO();
      const client = input.clientId ? s.clients.find((c) => c.id === input.clientId) : undefined;
      set({
        partnerRequests: [
          { ...input, id, officeId: s.office.id, status: "OPEN", createdBy: actorOf(s), createdAt: at, messages: [], updatedAt: at },
          ...s.partnerRequests,
        ],
        notifications: [
          partnerNotification(s, partner.id, {
            type: "PARTNER_REQUEST",
            severity: "warning",
            title: `${PARTNER_REQUEST_TYPE_LABEL[input.type]}: ${input.title}`,
            description: `${client ? `${clientName(client)} · ` : ""}Bárbara Cardoso Advocacia enviou uma nova solicitação.`,
            clientId: input.clientId,
            legalCaseId: input.legalCaseId,
            processId: input.processId,
            cta: { label: input.type === "DOCUMENT_REQUEST" ? "Enviar documento" : "Responder", href: "/pendencias" },
          }),
          ...s.notifications,
        ],
        auditEvents: [
          auditEvent(s, "PARTNER_REQUEST_CREATED", "partnerRequest", id, `Solicitação a ${partner.name}: ${input.title}.`, undefined, undefined, {
            partnerOfficeId: partner.id,
            summary: `Bárbara Cardoso Advocacia solicitou: ${input.title}${client ? ` (${clientName(client)})` : ""}.`,
          }),
          ...s.auditEvents,
        ],
      });
      return id;
    },

    resolvePartnerRequest: (id, resolution) =>
      set((s) => {
        requireOwnerViewer(s);
        const request = s.partnerRequests.find((r) => r.id === id);
        if (!request) return {};
        const at = nowISO();
        return {
          partnerRequests: updateById(s.partnerRequests, id, (r) => ({ ...r, status: resolution, resolvedAt: at, updatedAt: at })),
          auditEvents: [
            auditEvent(s, "PARTNER_REQUEST_RESOLVED", "partnerRequest", id, `Solicitação “${request.title}” ${resolution === "RESOLVED" ? "resolvida" : "cancelada"}.`, undefined, undefined, {
              partnerOfficeId: request.partnerOfficeId,
              summary: `Solicitação “${request.title}” ${resolution === "RESOLVED" ? "resolvida" : "cancelada"}.`,
            }),
            ...s.auditEvents,
          ],
        };
      }),

    updatePartnershipValues: (agreementId, input) =>
      set((s) => {
        const viewer = requireOwnerViewer(s);
        if (!can(viewer.role, "partners.finance.view")) throw new Error("Sem permissão financeira.");
        const agreement = s.partnershipAgreements.find((a) => a.id === agreementId);
        if (!agreement) return {};
        const legalCase = s.legalCases.find((c) => c.id === agreement.legalCaseId);
        const client = legalCase ? s.clients.find((c) => c.id === legalCase.clientId) : undefined;
        const details = [
          ...(input.revenueBase !== undefined ? [{ label: "Honorários estimados", value: `${formatCurrency(agreement.revenueBase)} → ${formatCurrency(input.revenueBase)}` }] : []),
          ...(input.realizedRevenue !== undefined ? [{ label: "Honorários realizados", value: `${formatCurrency(agreement.realizedRevenue)} → ${formatCurrency(input.realizedRevenue)}` }] : []),
          { label: "Divisão aplicada (snapshot do caso)", value: `${agreement.partnerPercentage}% / ${agreement.ownerPercentage}%` },
        ];
        return {
          partnershipAgreements: updateById(s.partnershipAgreements, agreementId, (a) => ({ ...a, ...input, updatedAt: nowISO() })),
          notifications:
            input.realizedRevenue !== undefined
              ? [
                  partnerNotification(s, agreement.partnerOfficeId, {
                    type: "PAYOUT_UPDATE",
                    severity: "info",
                    title: "Valores do caso atualizados",
                    description: `${clientName(client)} · honorários realizados registrados.`,
                    legalCaseId: agreement.legalCaseId,
                    cta: { label: "Abrir Financeiro", href: "/financeiro" },
                    requiredPermission: "partnerPortal.finance.view",
                  }),
                  ...s.notifications,
                ]
              : s.notifications,
          auditEvents: [
            auditEvent(s, "PARTNERSHIP_VALUE_UPDATED", "partnershipAgreement", agreementId, `Valores da parceria atualizados — ${clientName(client)}.`, undefined, details, {
              partnerOfficeId: agreement.partnerOfficeId,
              summary: `Valores registrados no caso de ${clientName(client)}.`,
            }),
            ...s.auditEvents,
          ],
        };
      }),

    registerPartnerPayout: (agreementId, amount, note) =>
      set((s) => {
        const viewer = requireOwnerViewer(s);
        if (!can(viewer.role, "partners.finance.view")) throw new Error("Sem permissão financeira.");
        const agreement = s.partnershipAgreements.find((a) => a.id === agreementId);
        if (!agreement) return {};
        const pending = partnershipView(agreement).pendingPartnerAmount;
        if (!(amount > 0) || amount > pending + 0.001) throw new Error("Valor do repasse inválido.");
        const legalCase = s.legalCases.find((c) => c.id === agreement.legalCaseId);
        const client = legalCase ? s.clients.find((c) => c.id === legalCase.clientId) : undefined;
        const at = nowISO();
        return {
          partnershipAgreements: updateById(s.partnershipAgreements, agreementId, (a) => ({
            ...a,
            payouts: [...a.payouts, { id: createId("pay"), at, amount, note, registeredBy: viewer.userId }],
            updatedAt: at,
          })),
          notifications: [
            partnerNotification(s, agreement.partnerOfficeId, {
              type: "PAYOUT_UPDATE",
              severity: "info",
              title: "Repasse registrado",
              description: `${clientName(client)} · repasse de ${formatCurrency(amount)} registrado.`,
              legalCaseId: agreement.legalCaseId,
              cta: { label: "Abrir Financeiro", href: "/financeiro" },
              requiredPermission: "partnerPortal.finance.view",
            }),
            ...s.notifications,
          ],
          auditEvents: [
            auditEvent(s, "PARTNER_PAYOUT_REGISTERED", "partnershipAgreement", agreementId, `Repasse de ${formatCurrency(amount)} registrado — ${clientName(client)}.`, undefined, note ? [{ label: "Observação", value: note }] : undefined, {
              partnerOfficeId: agreement.partnerOfficeId,
              summary: `Repasse registrado no caso de ${clientName(client)}.`,
            }),
            ...s.auditEvents,
          ],
        };
      }),

    /* ---------------------- Usuários do parceiro ---------------------- */

    invitePartnerUser: (partnerOfficeId, { name, email, role }) => {
      const s = get();
      assertCanManagePartnerUsers(s, partnerOfficeId);
      const partner = partnerOf(s, partnerOfficeId);
      if (s.users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) throw new Error("Já existe um usuário com este e-mail.");
      const userId = createId("usr");
      const token = createId("convite");
      const at = nowISO();
      set({
        users: [
          ...s.users,
          { id: userId, officeId: s.office.id, partnerOfficeId, name, displayName: name.split(/\s+/)[0] ?? name, email, role, title: "", status: "INVITED", hasCompletedTour: true, createdAt: at },
        ],
        invitations: [...s.invitations, { id: createId("inv"), officeId: s.office.id, token, email, name, role, partnerOfficeId, invitedBy: actorOf(s).id, createdAt: at }],
        auditEvents: [
          auditEvent(s, "PARTNER_USER_INVITED", "user", userId, `${name} convidado(a) como ${ROLE_LABEL[role]} (${partner.name}).`, undefined, undefined, {
            partnerOfficeId,
            summary: `${name} foi convidado(a) para o portal.`,
          }),
          ...s.auditEvents,
        ],
      });
      return token;
    },

    setPartnerUserStatus: (userId, status) =>
      set((s) => {
        const user = s.users.find((u) => u.id === userId);
        if (!user?.partnerOfficeId) return {};
        const viewer = assertCanManagePartnerUsers(s, user.partnerOfficeId);
        if (viewer.userId === userId) throw new Error("Você não pode alterar o próprio acesso.");
        return {
          users: updateById(s.users, userId, (u) => ({ ...u, status })),
          auditEvents: [
            auditEvent(s, "PARTNER_USER_UPDATED", "user", userId, `${user.name} ${status === "DISABLED" ? "inativado(a)" : "reativado(a)"}.`, undefined, undefined, {
              partnerOfficeId: user.partnerOfficeId,
              summary: `Acesso de ${user.name} ${status === "DISABLED" ? "inativado" : "reativado"}.`,
            }),
            ...s.auditEvents,
          ],
        };
      }),

    changePartnerUserRole: (userId, role) =>
      set((s) => {
        const user = s.users.find((u) => u.id === userId);
        if (!user?.partnerOfficeId) return {};
        const viewer = assertCanManagePartnerUsers(s, user.partnerOfficeId);
        if (viewer.userId === userId) throw new Error("Você não pode alterar o próprio papel.");
        return {
          users: updateById(s.users, userId, (u) => ({ ...u, role })),
          auditEvents: [
            auditEvent(s, "PARTNER_USER_UPDATED", "user", userId, `Papel de ${user.name}: ${ROLE_LABEL[user.role]} → ${ROLE_LABEL[role]}.`, undefined, undefined, {
              partnerOfficeId: user.partnerOfficeId,
              summary: `Papel de ${user.name} alterado para ${ROLE_LABEL[role]}.`,
            }),
            ...s.auditEvents,
          ],
        };
      }),
  };
}
