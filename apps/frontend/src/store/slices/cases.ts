import { nowISO } from "@/lib/clock";
import { LEGAL_CASE_STATUS_LABEL } from "@/lib/constants/status";
import { casePartnerId, explicitPartnerLink, isAccepted, isDecidable, isEligibleLawyer } from "@/lib/domain/legal-case";
import { snapshotAgreement } from "@/lib/domain/partnership";
import { createId } from "@/lib/ids";
import { can } from "@/lib/permissions";
import { isAllowedClientOrigin } from "@/lib/permissions/client-origin";
import type { ID, LegalCase, Notification } from "@/types";
import { auditEvent, officeNameOf, originContextOf, requireOwnerViewer, updateById, viewerOf, withPartnerRelationship, type GetState, type SetState } from "../helpers";
import type { AppState, CaseActions } from "../types";
import { clientName } from "./clients-analyses";

const PETITION_AGENT = "agt_peticoes";

function caseOf(state: AppState, id: ID): LegalCase {
  const legalCase = state.legalCases.find((c) => c.id === id);
  if (!legalCase) throw new Error("Caso não encontrado.");
  return legalCase;
}

/** Notificação ao parceiro com acesso operacional ao caso (nunca com dados internos). */
function partnerNotice(state: AppState, legalCase: LegalCase, input: Pick<Notification, "type" | "severity" | "title" | "description">): Notification[] {
  const partnerId = legalCase.partnerOrganizationId;
  if (!partnerId) return [];
  return [
    {
      id: createId("ntf"),
      officeId: state.office.id,
      partnerOfficeId: partnerId,
      at: nowISO(),
      read: false,
      clientId: legalCase.clientId,
      legalCaseId: legalCase.id,
      cta: { label: "Abrir caso", href: `/casos/${legalCase.id}` },
      requiredPermission: "partnerPortal.view",
      ...input,
    },
  ];
}

/** Parceiro com acesso operacional ao caso, para a linha do tempo do parceiro. */
function partnerRef(legalCase: LegalCase, summary?: string) {
  const partnerId = legalCase.partnerOrganizationId;
  return partnerId ? { partnerOfficeId: partnerId, summary } : undefined;
}

export function createCaseSlice(set: SetState, get: GetState): CaseActions {
  return {
    createCase: (input) => {
      const s = get();
      const viewer = requireOwnerViewer(s);
      if (!can(viewer.role, "cases.edit")) throw new Error("Sem permissão para cadastrar casos.");
      if (!s.clients.some((c) => c.id === input.clientId)) throw new Error("Selecione um cliente existente.");
      // Origem do caso validada pela regra central (a mesma das origens de cliente).
      if (!isAllowedClientOrigin(originContextOf(s), input.originOrganizationId)) throw new Error("Origem do caso inválida.");
      const at = nowISO();
      const id = createId("cas");
      const legalCase: LegalCase = {
        id,
        officeId: s.office.id,
        clientId: input.clientId,
        title: input.title,
        area: input.area,
        caseType: input.caseType,
        originOrganizationId: input.originOrganizationId,
        createdByOrganizationId: s.office.id,
        // Caso interno por padrão. A origem parceira NÃO concede acesso operacional:
        // o parceiro só opera o caso com o vínculo explícito (linkPartner).
        partnerOrganizationId: explicitPartnerLink(input.originOrganizationId, s.office.id, input.linkPartner),
        createdBy: viewer.userId,
        assignedLawyerId: input.assignedLawyerId ?? null,
        summary: input.summary,
        opposingParty: input.opposingParty,
        notes: input.notes,
        status: input.submit ? "SUBMITTED" : "DRAFT",
        submittedAt: input.submit ? at : undefined,
        createdAt: at,
        updatedAt: at,
      };
      const client = s.clients.find((c) => c.id === input.clientId);
      const partnerId = legalCase.partnerOrganizationId;
      set({
        legalCases: [legalCase, ...s.legalCases],
        // Caso operado por parceiro: o parceiro passa a enxergar o cliente deste caso.
        clientRelationships: partnerId ? withPartnerRelationship(s, input.clientId, partnerId, viewer.userId, at) : s.clientRelationships,
        auditEvents: [
          ...(input.submit ? [auditEvent(s, "CASE_SUBMITTED", "legalCase", id, `Caso “${legalCase.title}” enviado para análise.`)] : []),
          auditEvent(s, "CASE_CREATED", "legalCase", id, `Caso “${legalCase.title}” criado para ${clientName(client)} (origem: ${officeNameOf(s, input.originOrganizationId)}${partnerId ? `; parceiro vinculado: ${officeNameOf(s, partnerId)}` : ""}).`),
          ...s.auditEvents,
        ],
      });
      return id;
    },

    updateCase: (id, patch) =>
      set((s) => {
        const legalCase = caseOf(s, id);
        return {
          legalCases: updateById(s.legalCases, id, (c) => ({ ...c, ...patch, updatedAt: nowISO() })),
          auditEvents: [auditEvent(s, "CASE_UPDATED", "legalCase", id, `Caso “${legalCase.title}” editado.`), ...s.auditEvents],
        };
      }),

    submitCase: (id) =>
      set((s) => {
        const legalCase = caseOf(s, id);
        if (legalCase.status !== "DRAFT") return {};
        const at = nowISO();
        return {
          legalCases: updateById(s.legalCases, id, (c) => ({ ...c, status: "SUBMITTED" as const, submittedAt: at, updatedAt: at })),
          auditEvents: [auditEvent(s, "CASE_SUBMITTED", "legalCase", id, `Caso “${legalCase.title}” enviado para análise.`, undefined, undefined, partnerRef(legalCase)), ...s.auditEvents],
        };
      }),

    changeCaseOrigin: (id, originOrganizationId, linkPartner) => {
      const s = get();
      const legalCase = caseOf(s, id);
      if (legalCase.originOrganizationId === originOrganizationId) return;
      const viewer = viewerOf(s);
      if (!viewer) throw new Error("Sessão inválida.");
      const accepted = isAccepted(legalCase.status);
      if (accepted) {
        // Depois do aceite, só Administrador interno (afeta parceria e financeiro).
        if (viewer.audience !== "OWNER" || !can(viewer.role, "cases.origin.override")) throw new Error("Somente um Administrador pode alterar a origem de um caso aceito.");
        if (originOrganizationId !== s.office.id && !s.partnerOffices.some((p) => p.id === originOrganizationId)) throw new Error("Origem do caso inválida.");
      } else {
        if (legalCase.status === "REJECTED") throw new Error("Caso rejeitado não tem a origem alterada.");
        if (!isAllowedClientOrigin(originContextOf(s), originOrganizationId)) throw new Error("Origem do caso inválida.");
        if (viewer.audience === "PARTNER" && legalCase.partnerOrganizationId !== viewer.partnerOfficeId) throw new Error("Caso não encontrado.");
      }
      const at = nowISO();
      // Caso aceito: o acordo de parceria acompanha a nova origem (o anterior é encerrado, não apagado).
      let partnershipAgreements = s.partnershipAgreements;
      const extraAudit = [];
      if (accepted) {
        partnershipAgreements = partnershipAgreements.map((a) => (a.legalCaseId === id && !a.cancelledAt ? { ...a, cancelledAt: at, updatedAt: at } : a));
        const newPartner = s.partnerOffices.find((p) => p.id === originOrganizationId);
        if (newPartner) {
          const snapshot = snapshotAgreement(newPartner, id, createId("ppa"), at);
          partnershipAgreements = [snapshot, ...partnershipAgreements];
          extraAudit.push(
            auditEvent(s, "PARTNERSHIP_SNAPSHOT_CREATED", "legalCase", id, `Acordo de parceria criado: ${snapshot.partnerPercentage}% ${newPartner.name} / ${snapshot.ownerPercentage}% ${s.office.name}.`, undefined, undefined, {
              partnerOfficeId: newPartner.id,
            }),
          );
        }
      }
      // A origem (comercial) nunca altera o acesso operacional. Só a equipe interna, com
      // opt-in explícito (linkPartner), vincula o parceiro de origem a um caso interno.
      const newPartnerId =
        !legalCase.partnerOrganizationId && viewer.audience === "OWNER" ? (explicitPartnerLink(originOrganizationId, s.office.id, linkPartner) ?? undefined) : undefined;
      const partnerOrganizationId = newPartnerId ?? legalCase.partnerOrganizationId;
      set({
        legalCases: updateById(s.legalCases, id, (c) => ({ ...c, originOrganizationId, partnerOrganizationId, updatedAt: at })),
        clientRelationships: newPartnerId ? withPartnerRelationship(s, legalCase.clientId, newPartnerId, viewer.userId, at) : s.clientRelationships,
        partnershipAgreements,
        auditEvents: [
          ...extraAudit,
          auditEvent(s, "CASE_ORIGIN_CHANGED", "legalCase", id, `Origem do caso “${legalCase.title}” alterada${accepted ? " após o aceite" : ""}.`, undefined, [
            { label: "Antes", value: officeNameOf(s, legalCase.originOrganizationId) },
            { label: "Depois", value: officeNameOf(s, originOrganizationId) },
            ...(accepted ? [{ label: "Atenção", value: "Alteração após o aceite: parceria e financeiro revistos." }] : []),
            ...(newPartnerId ? [{ label: "Acesso operacional", value: `${officeNameOf(s, newPartnerId)} vinculado ao caso (ação explícita).` }] : []),
          ]),
          ...s.auditEvents,
        ],
      });
    },

    assignCaseLawyer: (id, lawyerId) =>
      set((s) => {
        const viewer = requireOwnerViewer(s);
        if (!can(viewer.role, "cases.edit")) throw new Error("Sem permissão.");
        const legalCase = caseOf(s, id);
        const lawyer = s.users.find((u) => u.id === lawyerId);
        if (!lawyer || !isEligibleLawyer(lawyer)) throw new Error("Selecione um advogado interno ativo.");
        if (legalCase.assignedLawyerId === lawyerId) return {};
        return {
          legalCases: updateById(s.legalCases, id, (c) => ({ ...c, assignedLawyerId: lawyerId, updatedAt: nowISO() })),
          notifications: s.notifications.map((n) => (n.type === "CASE_LAWYER_REQUIRED" && n.legalCaseId === id ? { ...n, read: true } : n)),
          auditEvents: [
            auditEvent(s, "CASE_LAWYER_ASSIGNED", "legalCase", id, `Advogado responsável do caso “${legalCase.title}”: ${lawyer.name}.`, undefined, [
              { label: "Antes", value: legalCase.assignedLawyerId ? (s.users.find((u) => u.id === legalCase.assignedLawyerId)?.name ?? "—") : "Não definido" },
              { label: "Depois", value: lawyer.name },
            ]),
            ...s.auditEvents,
          ],
        };
      }),

    acceptCase: (id, lawyerId) => {
      const s = get();
      const viewer = requireOwnerViewer(s);
      if (!can(viewer.role, "cases.decide")) throw new Error("Sem permissão para aceitar casos.");
      const legalCase = caseOf(s, id);
      if (!isDecidable(legalCase.status)) throw new Error("Este caso não pode ser aceito na situação atual.");
      const responsible = lawyerId ?? legalCase.assignedLawyerId;
      const lawyer = responsible ? s.users.find((u) => u.id === responsible) : undefined;
      // Regra: aceitar exige advogado responsável.
      if (!lawyer || !isEligibleLawyer(lawyer)) throw new Error("Defina o advogado responsável antes de aceitar o caso.");
      const at = nowISO();
      const partnerId = casePartnerId(legalCase, s.office.id);
      const partner = partnerId ? s.partnerOffices.find((p) => p.id === partnerId) : undefined;
      // A parceria nasce no ACEITE, com a divisão VIGENTE do parceiro copiada (snapshot).
      const snapshot = partner ? snapshotAgreement(partner, id, createId("ppa"), at) : null;
      const client = s.clients.find((c) => c.id === legalCase.clientId);
      set({
        legalCases: updateById(s.legalCases, id, (c) => ({ ...c, status: "ACCEPTED" as const, assignedLawyerId: lawyer.id, acceptedAt: at, acceptedBy: viewer.userId, updatedAt: at })),
        partnershipAgreements: snapshot ? [snapshot, ...s.partnershipAgreements] : s.partnershipAgreements,
        // Próximo passo do fluxo: o agente prepara a peça, que volta para Revisões.
        agentTasks: [
          { id: createId("tsk"), officeId: s.office.id, agentId: PETITION_AGENT, title: `Preparar minuta — ${legalCase.title}`, status: "RUNNING" as const, clientId: legalCase.clientId, at },
          ...s.agentTasks,
        ],
        notifications: [
          ...partnerNotice(s, legalCase, { type: "CASE_ACCEPTED", severity: "info", title: "Caso aceito", description: `${clientName(client)} · ${legalCase.title}.` }),
          ...s.notifications.map((n) => (n.legalCaseId === id && (n.type === "CASE_SUBMITTED" || n.type === "CASE_LAWYER_REQUIRED") ? { ...n, read: true } : n)),
        ],
        auditEvents: [
          ...(snapshot && partner
            ? [
                auditEvent(s, "PARTNERSHIP_SNAPSHOT_CREATED", "legalCase", id, `Acordo de parceria criado no aceite: ${snapshot.partnerPercentage}% ${partner.name} / ${snapshot.ownerPercentage}% ${s.office.name}.`, undefined, [
                  { label: "Divisão congelada (snapshot)", value: `${snapshot.partnerPercentage}% / ${snapshot.ownerPercentage}%` },
                ], { partnerOfficeId: partner.id }),
              ]
            : []),
          ...(legalCase.assignedLawyerId !== lawyer.id
            ? [auditEvent(s, "CASE_LAWYER_ASSIGNED", "legalCase", id, `Advogado responsável do caso “${legalCase.title}”: ${lawyer.name}.`)]
            : []),
          auditEvent(s, "CASE_ACCEPTED", "legalCase", id, `Caso “${legalCase.title}” aceito. Responsável: ${lawyer.name}.`, undefined, undefined, partnerRef(legalCase, `Caso de ${clientName(client)} aceito.`)),
          ...s.auditEvents,
        ],
      });
    },

    rejectCase: (id, { publicReason, internalNote }) => {
      const s = get();
      const viewer = requireOwnerViewer(s);
      if (!can(viewer.role, "cases.decide")) throw new Error("Sem permissão para rejeitar casos.");
      const legalCase = caseOf(s, id);
      if (!isDecidable(legalCase.status)) throw new Error("Este caso não pode ser rejeitado na situação atual.");
      const reason = publicReason.trim();
      if (!reason) throw new Error("Informe o motivo que será comunicado ao parceiro.");
      const note = internalNote?.trim() || undefined;
      const at = nowISO();
      const client = s.clients.find((c) => c.id === legalCase.clientId);
      const ref = partnerRef(legalCase);
      set({
        legalCases: updateById(s.legalCases, id, (c) => ({
          ...c,
          status: "REJECTED" as const,
          rejectedAt: at,
          rejectionReasonPublic: reason,
          rejectionReasonInternal: note,
          updatedAt: at,
        })),
        // O parceiro recebe SOMENTE o motivo público.
        notifications: [
          ...partnerNotice(s, legalCase, { type: "CASE_REJECTED", severity: "info", title: "Caso não aceito", description: `${clientName(client)} · ${reason}` }),
          ...s.notifications.map((n) => (n.legalCaseId === id && (n.type === "CASE_SUBMITTED" || n.type === "CASE_LAWYER_REQUIRED") ? { ...n, read: true } : n)),
        ],
        auditEvents: [
          ...(note ? [auditEvent(s, "CASE_REJECTION_INTERNAL_NOTE", "legalCase", id, "Nota interna registrada na rejeição (não visível ao parceiro).", undefined, [{ label: "Nota interna", value: note }], ref ? { partnerOfficeId: ref.partnerOfficeId } : undefined)] : []),
          auditEvent(s, "CASE_REJECTION_PUBLIC", "legalCase", id, "Motivo público da rejeição registrado.", undefined, [{ label: "Comunicação ao parceiro", value: reason }], ref ? { partnerOfficeId: ref.partnerOfficeId } : undefined),
          auditEvent(s, "CASE_REJECTED", "legalCase", id, `Caso “${legalCase.title}” rejeitado.`, undefined, undefined, ref ? { partnerOfficeId: ref.partnerOfficeId, summary: `Caso de ${clientName(client)} não aceito: ${reason}` } : undefined),
          ...s.auditEvents,
        ],
      });
    },

    setCaseStatus: (id, status) =>
      set((s) => {
        const viewer = requireOwnerViewer(s);
        if (!can(viewer.role, "cases.edit")) throw new Error("Sem permissão.");
        const legalCase = caseOf(s, id);
        const allowed =
          (status === "IN_PROGRESS" && legalCase.status === "ACCEPTED") ||
          (status === "CLOSED" && (legalCase.status === "ACCEPTED" || legalCase.status === "IN_PROGRESS")) ||
          (status === "ARCHIVED" && (legalCase.status === "CLOSED" || legalCase.status === "REJECTED" || legalCase.status === "DRAFT"));
        if (!allowed) throw new Error("Transição não permitida.");
        const at = nowISO();
        const client = s.clients.find((c) => c.id === legalCase.clientId);
        return {
          legalCases: updateById(s.legalCases, id, (c) => ({
            ...c,
            status,
            ...(status === "CLOSED" ? { closedAt: at } : {}),
            ...(status === "ARCHIVED" ? { archivedAt: at } : {}),
            updatedAt: at,
          })),
          notifications:
            status === "CLOSED"
              ? [...partnerNotice(s, legalCase, { type: "CASE_UPDATE", severity: "info", title: "Caso concluído", description: `${clientName(client)} · ${legalCase.title}.` }), ...s.notifications]
              : s.notifications,
          auditEvents: [
            auditEvent(s, "CASE_STATUS_CHANGED", "legalCase", id, `Caso “${legalCase.title}”: ${LEGAL_CASE_STATUS_LABEL[legalCase.status]} → ${LEGAL_CASE_STATUS_LABEL[status]}.`, undefined, undefined, partnerRef(legalCase, status === "CLOSED" ? `Caso de ${clientName(client)} concluído.` : undefined)),
            ...s.auditEvents,
          ],
        };
      }),
  };
}
