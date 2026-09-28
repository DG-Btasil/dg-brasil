import { nowISO } from "@/lib/clock";
import {
  DOCUMENT_CATEGORY_LABEL,
  PARTNER_OFFICE_STATUS_LABEL,
  PARTNER_REQUEST_TYPE_LABEL,
  SUBMISSION_STATUS_LABEL,
} from "@/lib/constants/status";
import { isValidShare, partnershipView, snapshotAgreement } from "@/lib/domain/partnership";
import { formatCurrency, onlyDigits } from "@/lib/formatting";
import { createId } from "@/lib/ids";
import { can, ROLE_LABEL } from "@/lib/permissions";
import type {
  Client,
  ClientDocument,
  ClientOfficeRelationship,
  ID,
  Notification,
  PartnerCaseSubmission,
  PartnerOffice,
  Process,
  ProcessEvent,
} from "@/types";
import {
  actorOf,
  auditEvent,
  requireOwnerViewer,
  requirePartnerViewer,
  updateById,
  viewerOf,
  type GetState,
  type SetState,
} from "../helpers";
import type { AppState, PartnerActions, PartnerCaseDocumentInput } from "../types";
import { clientName } from "./clients-analyses";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function partnerOf(state: AppState, id: ID): PartnerOffice {
  const partner = state.partnerOffices.find((p) => p.id === id);
  if (!partner) throw new Error("Escritório parceiro não encontrado.");
  return partner;
}

function documentDigits(client: Client): string {
  return onlyDigits(client.kind === "INDIVIDUAL" ? client.cpf : client.cnpj);
}

function isRelated(state: AppState, clientId: ID, partnerOfficeId: ID): boolean {
  return state.clientRelationships.some(
    (r) => r.clientId === clientId && r.officeType === "PARTNER" && r.partnerOfficeId === partnerOfficeId && r.status === "ACTIVE",
  );
}

/** Responsável interno padrão para casos recebidos de parceiros (primeiro administrador ativo). */
function defaultResponsible(state: AppState): ID {
  return state.users.find((u) => u.role === "ADMIN" && u.status === "ACTIVE")?.id ?? state.session.currentUserId;
}

/** Notificação endereçada a um parceiro (nunca aparece na caixa interna). */
function partnerNotification(
  state: AppState,
  partnerOfficeId: ID,
  input: Pick<Notification, "type" | "severity" | "title" | "description" | "cta"> & Partial<Pick<Notification, "clientId" | "processId" | "requiredPermission">>,
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

/** Notificação para a equipe interna. */
function ownerNotification(
  state: AppState,
  input: Pick<Notification, "type" | "severity" | "title" | "description" | "cta" | "requiredPermission"> & Partial<Pick<Notification, "clientId" | "processId">>,
): Notification {
  return { id: createId("ntf"), officeId: state.office.id, at: nowISO(), read: false, ...input };
}

function systemEvent(state: AppState, processId: ID, title: string, description?: string): ProcessEvent {
  return { id: createId("mov"), officeId: state.office.id, processId, at: nowISO(), title, description, source: "SYSTEM", important: false };
}

/**
 * Tokens de correspondência de CPF/CNPJ (opacos, só em memória). O parceiro
 * nunca recebe o id do cliente de outro relacionamento; no backend, usar
 * token curto e assinado vinculado à sessão.
 */
const matchTokens = new Map<string, { clientId: ID; partnerOfficeId: ID }>();

function newDocument(
  state: AppState,
  input: PartnerCaseDocumentInput & { clientId: ID; processId?: ID },
  partnerOfficeId: ID,
  uploadedBy: ID,
  version: { groupId?: ID; number?: number } = {},
): ClientDocument {
  const at = nowISO();
  const id = createId("doc");
  return {
    id,
    officeId: state.office.id,
    clientId: input.clientId,
    processId: input.processId,
    name: input.name,
    category: input.category,
    status: "PENDING",
    verification: "UNVERIFIED",
    fileName: input.fileName ?? `${input.name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-")}.pdf`,
    sizeKb: input.sizeKb ?? 240,
    uploadedAt: at,
    uploadedBy,
    required: false,
    updatedAt: at,
    // Documento do próprio parceiro: ele continua vendo o que enviou.
    visibility: "PARTNER_VISIBLE",
    uploadedByPartnerOfficeId: partnerOfficeId,
    // Envio oficial: a partir daqui o parceiro não edita nem apaga.
    submittedAt: at,
    versionGroupId: version.groupId ?? id,
    version: version.number ?? 1,
  };
}

/**
 * Efeitos de um processo de origem PARTNER: acordo financeiro com a divisão
 * VIGENTE copiada (snapshot). Usado pelo cadastro interno e pelo portal.
 */
export function partnershipSnapshotFor(state: AppState, process: Process) {
  if (process.relationshipOrigin !== "PARTNER" || !process.originPartnerOfficeId) return null;
  const partner = partnerOf(state, process.originPartnerOfficeId);
  return snapshotAgreement(partner, process.id, createId("ppa"), nowISO());
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

    setSubmissionStatus: (submissionId, status) =>
      set((s) => {
        requireOwnerViewer(s);
        const submission = s.partnerSubmissions.find((x) => x.id === submissionId);
        if (!submission || submission.status === status) return {};
        const client = s.clients.find((c) => c.id === submission.clientId);
        const label = SUBMISSION_STATUS_LABEL[status];
        return {
          partnerSubmissions: updateById(s.partnerSubmissions, submissionId, (x) => ({ ...x, status, updatedAt: nowISO() })),
          notifications: [
            partnerNotification(s, submission.partnerOfficeId, {
              type: "CASE_UPDATE",
              severity: "info",
              title: `Caso: ${label}`,
              description: `${clientName(client)} · situação atualizada pela Bárbara Cardoso Advocacia.`,
              clientId: submission.clientId,
              processId: submission.processId,
              cta: { label: "Abrir processo", href: submission.processId ? `/processos/${submission.processId}` : "/processos" },
            }),
            ...s.notifications,
          ],
          auditEvents: [
            auditEvent(s, "SUBMISSION_STATUS_CHANGED", "submission", submissionId, `Caso de ${clientName(client)}: ${SUBMISSION_STATUS_LABEL[submission.status]} → ${label}.`, undefined, undefined, {
              partnerOfficeId: submission.partnerOfficeId,
              summary: `Caso de ${clientName(client)}: ${label}.`,
            }),
            ...s.auditEvents,
          ],
        };
      }),

    shareDocumentWithPartner: (documentId) =>
      set((s) => {
        requireOwnerViewer(s);
        const doc = s.documents.find((d) => d.id === documentId);
        const process = doc?.processId ? s.processes.find((p) => p.id === doc.processId) : undefined;
        if (!doc || !process || process.relationshipOrigin !== "PARTNER" || !process.originPartnerOfficeId) {
          throw new Error("Somente documentos de casos de parceiros podem ser disponibilizados.");
        }
        if (doc.visibility === "PARTNER_VISIBLE") return {};
        const client = s.clients.find((c) => c.id === doc.clientId);
        const pid = process.originPartnerOfficeId;
        return {
          documents: updateById(s.documents, documentId, (d) => ({ ...d, visibility: "PARTNER_VISIBLE" as const, updatedAt: nowISO() })),
          notifications: [
            partnerNotification(s, pid, {
              type: "DOCUMENT_APPROVED",
              severity: "info",
              title: "Documento aprovado",
              description: `${clientName(client)} · ${doc.name}.`,
              clientId: doc.clientId,
              processId: process.id,
              cta: { label: "Ver documento", href: `/processos/${process.id}?aba=documentos` },
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
        const process = s.processes.find((p) => p.id === agreement.processId);
        const client = process ? s.clients.find((c) => c.id === process.clientId) : undefined;
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
                    processId: agreement.processId,
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
        const process = s.processes.find((p) => p.id === agreement.processId);
        const client = process ? s.clients.find((c) => c.id === process.clientId) : undefined;
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
              processId: agreement.processId,
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

    /* ------------------------ Portal do parceiro ------------------------ */

    lookupClientDocument: (document) => {
      const s = get();
      const viewer = requirePartnerViewer(s);
      const digits = onlyDigits(document);
      const match = digits ? s.clients.find((c) => documentDigits(c) === digits) : undefined;
      if (!match) return { status: "NOT_FOUND" };
      if (isRelated(s, match.id, viewer.partnerOfficeId)) return { status: "ALREADY_RELATED", clientId: match.id };
      const token = createId("match");
      matchTokens.set(token, { clientId: match.id, partnerOfficeId: viewer.partnerOfficeId });
      // Registro INTERNO (sem resumo ao parceiro): quem consultou, sem revelar nada a ele.
      set({
        auditEvents: [
          auditEvent(s, "CLIENT_DUPLICATE_DETECTED", "client", match.id, `CPF/CNPJ já cadastrado informado por ${partnerOf(s, viewer.partnerOfficeId).name}. Nenhum dado foi revelado ao parceiro.`, undefined, undefined, {
            partnerOfficeId: viewer.partnerOfficeId,
          }),
          ...s.auditEvents,
        ],
      });
      return { status: "EXISTS", matchToken: token };
    },

    submitPartnerCase: (input) => {
      const s = get();
      const viewer = requirePartnerViewer(s);
      if (!can(viewer.role, "partnerPortal.clients.create")) throw new Error("Sem permissão para enviar casos.");
      const pid = viewer.partnerOfficeId;
      const partner = partnerOf(s, pid);
      if (partner.status !== "ACTIVE") throw new Error("A parceria não está ativa.");
      const at = nowISO();
      const actor = actorOf(s);
      const responsibleUserId = defaultResponsible(s);

      // 1. Cliente canônico: cria só se o CPF/CNPJ não existir.
      let clientId: ID;
      let newClient: Client | null = null;
      let existingClient = false;
      if (input.client.mode === "NEW") {
        const data = input.client.data;
        const digits = onlyDigits(data.kind === "INDIVIDUAL" ? data.cpf : data.cnpj);
        if (s.clients.some((c) => documentDigits(c) === digits)) throw new Error("Cliente já cadastrado no sistema.");
        clientId = createId("cli");
        const base = { id: clientId, officeId: s.office.id, status: "NEW" as const, responsibleUserId, createdByOfficeId: pid, createdAt: at, updatedAt: at };
        newClient =
          data.kind === "INDIVIDUAL"
            ? { ...base, kind: "INDIVIDUAL", fullName: data.fullName, cpf: data.cpf, birthDate: data.birthDate, contact: data.contact, address: data.address }
            : {
                ...base,
                kind: "COMPANY",
                legalName: data.legalName,
                tradeName: data.tradeName,
                cnpj: data.cnpj,
                contact: data.contact,
                address: data.address,
                representatives: data.representativeName
                  ? [{ id: createId("rep"), name: data.representativeName, cpf: "", role: "Representante", isPrimary: true }]
                  : [],
                partners: [],
              };
      } else {
        existingClient = true;
        const fromToken = input.client.matchToken ? matchTokens.get(input.client.matchToken) : undefined;
        if (fromToken && fromToken.partnerOfficeId !== pid) throw new Error("Consulta inválida.");
        const resolved = fromToken?.clientId ?? (input.client.clientId && isRelated(s, input.client.clientId, pid) ? input.client.clientId : undefined);
        if (!resolved) throw new Error("A consulta do CPF/CNPJ expirou. Refaça a verificação.");
        clientId = resolved;
        if (input.client.matchToken) matchTokens.delete(input.client.matchToken);
      }
      const clients = newClient ? [newClient, ...s.clients] : s.clients;
      const client = clients.find((c) => c.id === clientId);

      // 2. Relacionamentos (sem duplicar pessoa).
      const newRelationships: ClientOfficeRelationship[] = [];
      if (!s.clientRelationships.some((r) => r.clientId === clientId && r.officeType === "OWNER")) {
        newRelationships.push({ id: createId("rel"), officeId: s.office.id, clientId, officeType: "OWNER", status: "ACTIVE", createdAt: at, createdBy: actor.id });
      }
      const relationshipIsNew = !isRelated(s, clientId, pid);
      if (relationshipIsNew) {
        newRelationships.push({ id: createId("rel"), officeId: s.office.id, clientId, officeType: "PARTNER", partnerOfficeId: pid, status: "ACTIVE", createdAt: at, createdBy: actor.id });
      }

      // 3. Processo com origem relacional PARTNER + acordo (snapshot da divisão vigente).
      const processId = createId("prc");
      const process: Process = {
        id: processId,
        officeId: s.office.id,
        clientId,
        cnj: input.caseInfo.cnj,
        title: input.caseInfo.title,
        court: input.caseInfo.court,
        area: input.caseInfo.area,
        actionType: input.caseInfo.actionType,
        clientPole: "ACTIVE",
        opposingParty: input.caseInfo.opposingParty,
        responsibleUserId,
        caseValue: input.caseInfo.caseValue,
        status: "PRE_FILING",
        phase: "PRELIMINARY",
        origin: "MANUAL",
        relationshipOrigin: "PARTNER",
        originPartnerOfficeId: pid,
        summary: input.caseInfo.summary,
        notes: input.notes,
        createdAt: at,
        updatedAt: at,
        lastMovementAt: at,
      };
      const agreement = snapshotAgreement(partner, processId, createId("ppa"), at);

      // 4. Documentos enviados oficialmente.
      const documents = input.documents.map((d) => newDocument(s, { ...d, clientId, processId }, pid, actor.id));

      // 5. Submissão.
      const submissionId = createId("sub");
      const submission: PartnerCaseSubmission = {
        id: submissionId,
        officeId: s.office.id,
        partnerOfficeId: pid,
        clientId,
        processId,
        status: "SUBMITTED",
        area: input.caseInfo.area,
        summary: input.caseInfo.summary,
        notes: input.notes,
        documentIds: documents.map((d) => d.id),
        existingClient,
        createdAt: at,
        createdBy: actor.id,
        submittedAt: at,
        submittedBy: actor.id,
        updatedAt: at,
      };
      const name = clientName(client);
      const partnerRef = { partnerOfficeId: pid };

      set({
        clients,
        clientRelationships: [...newRelationships, ...s.clientRelationships],
        processes: [process, ...s.processes],
        processEvents: [systemEvent(s, processId, `Caso recebido da ${partner.name}`, `${documents.length} documento(s) enviados junto com o cadastro.`), ...s.processEvents],
        partnershipAgreements: [agreement, ...s.partnershipAgreements],
        documents: [...documents, ...s.documents],
        partnerSubmissions: [submission, ...s.partnerSubmissions],
        notifications: [
          ownerNotification(s, {
            type: "PARTNER_SUBMISSION",
            severity: "warning",
            title: `Novo caso enviado pela ${partner.name}`,
            description: `${name} · ${documents.length} documento(s)${existingClient ? " · cliente já cadastrado" : ""}.`,
            clientId,
            processId,
            cta: { label: "Abrir caso", href: `/processos/${processId}` },
            requiredPermission: "partners.view",
          }),
          ...s.notifications,
        ],
        auditEvents: [
          auditEvent(s, "CLIENT_SUBMITTED", "client", clientId, `Caso de ${name} enviado pela ${partner.name} (${documents.length} documentos).`, actor, undefined, {
            ...partnerRef,
            summary: `Caso de ${name} enviado com ${documents.length} documento(s).`,
          }),
          ...(documents.length
            ? [
                auditEvent(s, "DOCUMENT_ADDED", "document", documents[0]!.id, `${documents.length} documento(s) enviados pela ${partner.name}: ${documents.map((d) => DOCUMENT_CATEGORY_LABEL[d.category]).join(", ")}.`, actor, undefined, {
                  ...partnerRef,
                  summary: `${documents.length} documento(s) enviados para ${name}.`,
                }),
              ]
            : []),
          auditEvent(s, "PARTNER_PROCESS_CREATED", "process", processId, `Processo de parceiro criado: ${process.title} (divisão ${agreement.partnerPercentage}% / ${agreement.ownerPercentage}%).`, actor, undefined, {
            ...partnerRef,
            summary: `Processo criado: ${process.title}.`,
          }),
          ...(relationshipIsNew && existingClient
            ? [
                auditEvent(s, "CLIENT_RELATIONSHIP_CREATED", "client", clientId, `Vínculo da ${partner.name} com cliente já cadastrado criado para novo caso.`, actor, undefined, {
                  ...partnerRef,
                  summary: `Novo caso vinculado a ${name}.`,
                }),
              ]
            : []),
          ...(newClient ? [auditEvent(s, "CLIENT_CREATED", "client", clientId, `Cliente ${name} cadastrado pela ${partner.name}.`, actor, undefined, partnerRef)] : []),
          ...s.auditEvents,
        ],
      });
      return { clientId, processId, submissionId };
    },

    createPartnerProcess: (input) => {
      const s = get();
      const viewer = requirePartnerViewer(s);
      if (!can(viewer.role, "partnerPortal.processes.create")) throw new Error("Sem permissão para cadastrar processos.");
      const pid = viewer.partnerOfficeId;
      const partner = partnerOf(s, pid);
      if (partner.status !== "ACTIVE") throw new Error("A parceria não está ativa.");
      if (!isRelated(s, input.clientId, pid)) throw new Error("Cliente não encontrado.");
      const at = nowISO();
      const id = createId("prc");
      // A origem vem da SESSÃO: o parceiro não escolhe escritório.
      const process: Process = {
        ...input,
        id,
        officeId: s.office.id,
        responsibleUserId: defaultResponsible(s),
        status: input.cnj ? "FILED" : "PRE_FILING",
        phase: input.cnj ? "PLEADINGS" : "PRELIMINARY",
        origin: "MANUAL",
        relationshipOrigin: "PARTNER",
        originPartnerOfficeId: pid,
        createdAt: at,
        updatedAt: at,
        lastMovementAt: at,
      };
      const agreement = snapshotAgreement(partner, id, createId("ppa"), at);
      const client = s.clients.find((c) => c.id === input.clientId);
      set({
        processes: [process, ...s.processes],
        processEvents: [systemEvent(s, id, `Processo cadastrado pela ${partner.name}`), ...s.processEvents],
        partnershipAgreements: [agreement, ...s.partnershipAgreements],
        notifications: [
          ownerNotification(s, {
            type: "PARTNER_SUBMISSION",
            severity: "info",
            title: `Processo cadastrado pela ${partner.name}`,
            description: `${clientName(client)} · ${process.title}.`,
            clientId: input.clientId,
            processId: id,
            cta: { label: "Abrir processo", href: `/processos/${id}` },
            requiredPermission: "partners.view",
          }),
          ...s.notifications,
        ],
        auditEvents: [
          auditEvent(s, "PARTNER_PROCESS_CREATED", "process", id, `Processo de parceiro criado: ${process.title} (divisão ${agreement.partnerPercentage}% / ${agreement.ownerPercentage}%).`, undefined, undefined, {
            partnerOfficeId: pid,
            summary: `Processo criado: ${process.title} (${clientName(client)}).`,
          }),
          ...s.auditEvents,
        ],
      });
      return id;
    },

    updatePartnerClientBasics: (clientId, patch) =>
      set((s) => {
        const viewer = requirePartnerViewer(s);
        if (!can(viewer.role, "partnerPortal.clients.edit")) throw new Error("Sem permissão para editar clientes.");
        if (!isRelated(s, clientId, viewer.partnerOfficeId)) throw new Error("Cliente não encontrado.");
        const client = s.clients.find((c) => c.id === clientId);
        if (!client) return {};
        const details = [
          ...(patch.contact ? [{ label: "Contato", value: [patch.contact.email, patch.contact.phone].filter(Boolean).join(" · ") || "—" }] : []),
          ...(patch.address ? [{ label: "Endereço", value: `${patch.address.street}, ${patch.address.number} — ${patch.address.city}/${patch.address.state}` }] : []),
        ];
        return {
          clients: updateById(s.clients, clientId, (c) => ({ ...c, ...patch, updatedAt: nowISO() }) as Client),
          auditEvents: [
            auditEvent(s, "CLIENT_UPDATED", "client", clientId, `Dados básicos de ${clientName(client)} editados pelo parceiro.`, undefined, details, {
              partnerOfficeId: viewer.partnerOfficeId,
              summary: `Dados de contato de ${clientName(client)} atualizados.`,
            }),
            ...s.auditEvents,
          ],
        };
      }),

    submitPartnerDocument: (input) => {
      const s = get();
      const viewer = requirePartnerViewer(s);
      if (!can(viewer.role, "partnerPortal.documents.submit")) throw new Error("Sem permissão para enviar documentos.");
      const pid = viewer.partnerOfficeId;
      if (!isRelated(s, input.clientId, pid)) throw new Error("Cliente não encontrado.");
      if (input.processId) {
        const process = s.processes.find((p) => p.id === input.processId);
        if (!process || process.originPartnerOfficeId !== pid) throw new Error("Processo não encontrado.");
      }
      const partner = partnerOf(s, pid);
      const actor = actorOf(s);
      const client = s.clients.find((c) => c.id === input.clientId);
      let documents = s.documents;
      let doc: ClientDocument;
      let versionNote: string | null = null;
      if (input.replacesDocumentId) {
        const previous = s.documents.find((d) => d.id === input.replacesDocumentId);
        if (!previous || previous.uploadedByPartnerOfficeId !== pid) throw new Error("Documento não encontrado.");
        const groupId = previous.versionGroupId ?? previous.id;
        const latest = Math.max(...s.documents.filter((d) => (d.versionGroupId ?? d.id) === groupId).map((d) => d.version ?? 1));
        doc = newDocument(s, { ...input, processId: input.processId ?? previous.processId }, pid, actor.id, { groupId, number: latest + 1 });
        // A versão anterior NUNCA é sobrescrita: só é marcada como substituída.
        documents = updateById(documents, previous.id, (d) => ({ ...d, supersededAt: nowISO() }));
        versionNote = `v${latest} → v${latest + 1}`;
      } else {
        doc = newDocument(s, input, pid, actor.id);
      }
      const request = input.requestId ? s.partnerRequests.find((r) => r.id === input.requestId && r.partnerOfficeId === pid) : undefined;
      const at = nowISO();
      set({
        documents: [doc, ...documents],
        partnerRequests: request
          ? updateById(s.partnerRequests, request.id, (r) => ({
              ...r,
              status: "ANSWERED" as const,
              messages: [...r.messages, { id: createId("msg"), at, actor, side: "PARTNER" as const, message: `Documento enviado: ${doc.name}`, documentId: doc.id }],
              updatedAt: at,
            }))
          : s.partnerRequests,
        notifications: [
          ownerNotification(s, {
            type: "PARTNER_REQUEST",
            severity: "info",
            title: request ? `Solicitação respondida pela ${partner.name}` : versionNote ? `Nova versão de documento — ${partner.name}` : `Documento enviado pela ${partner.name}`,
            description: `${clientName(client)} · ${doc.name}${versionNote ? ` (${versionNote})` : ""}.`,
            clientId: input.clientId,
            processId: doc.processId,
            cta: { label: "Ver documentos", href: doc.processId ? `/processos/${doc.processId}?aba=documentos` : `/clientes/${input.clientId}?aba=documentos` },
            requiredPermission: "partners.view",
          }),
          ...s.notifications,
        ],
        auditEvents: [
          ...(request
            ? [
                auditEvent(s, "PARTNER_REQUEST_ANSWERED", "partnerRequest", request.id, `Solicitação “${request.title}” respondida com documento.`, actor, undefined, {
                  partnerOfficeId: pid,
                  summary: `Solicitação “${request.title}” respondida.`,
                }),
              ]
            : []),
          versionNote
            ? auditEvent(s, "DOCUMENT_VERSION_ADDED", "document", doc.id, `${doc.name} de ${clientName(client)}: nova versão (${versionNote}); versão anterior preservada.`, actor, undefined, {
                partnerOfficeId: pid,
                summary: `Nova versão de ${doc.name} enviada (${versionNote}).`,
              })
            : auditEvent(s, "DOCUMENT_ADDED", "document", doc.id, `${DOCUMENT_CATEGORY_LABEL[doc.category]} enviado pela ${partner.name} para ${clientName(client)}.`, actor, undefined, {
                partnerOfficeId: pid,
                summary: `Documento enviado: ${doc.name} (${clientName(client)}).`,
              }),
          ...s.auditEvents,
        ],
      });
      return doc.id;
    },

    respondPartnerRequest: (requestId, message) =>
      set((s) => {
        const viewer = requirePartnerViewer(s);
        if (!can(viewer.role, "partnerPortal.requests.respond")) throw new Error("Sem permissão para responder.");
        const request = s.partnerRequests.find((r) => r.id === requestId && r.partnerOfficeId === viewer.partnerOfficeId);
        if (!request) throw new Error("Solicitação não encontrada.");
        const actor = actorOf(s);
        const at = nowISO();
        const partner = partnerOf(s, viewer.partnerOfficeId);
        return {
          partnerRequests: updateById(s.partnerRequests, requestId, (r) => ({
            ...r,
            status: "ANSWERED" as const,
            messages: [...r.messages, { id: createId("msg"), at, actor, side: "PARTNER" as const, message }],
            updatedAt: at,
          })),
          notifications: [
            ownerNotification(s, {
              type: "PARTNER_REQUEST",
              severity: "info",
              title: `Solicitação respondida pela ${partner.name}`,
              description: `${request.title}: ${message.slice(0, 80)}${message.length > 80 ? "…" : ""}`,
              clientId: request.clientId,
              processId: request.processId,
              cta: { label: "Ver parceiro", href: `/parceiros/${partner.id}` },
              requiredPermission: "partners.view",
            }),
            ...s.notifications,
          ],
          auditEvents: [
            auditEvent(s, "PARTNER_REQUEST_ANSWERED", "partnerRequest", requestId, `Solicitação “${request.title}” respondida pela ${partner.name}.`, actor, [{ label: "Resposta", value: message }], {
              partnerOfficeId: viewer.partnerOfficeId,
              summary: `Solicitação “${request.title}” respondida.`,
            }),
            ...s.auditEvents,
          ],
        };
      }),
  };
}
