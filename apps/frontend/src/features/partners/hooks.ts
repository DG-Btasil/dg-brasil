"use client";

import { useCallback, useMemo } from "react";
import { OPEN_REVIEW_STATUSES, type PartnerOfficeStatus, type SubmissionStatus } from "@/lib/constants/status";
import { partnershipView, summarizePartnerFinance } from "@/lib/domain/partnership";
import { repositories } from "@/repositories";
import { useScopedStore } from "@/store/scope";
import type { NewPartnerOfficeInput, NewPartnerRequestInput, PartnerOfficePatch, PartnershipValuesInput } from "@/store/types";
import { useToast } from "@/store/ui-store";
import type {
  AuditEvent,
  Client,
  ID,
  PartnerCaseSubmission,
  PartnerFinancialSummary,
  PartnerOffice,
  PartnerRequest,
  PartnerRole,
  PartnershipAgreementView,
  Process,
  User,
} from "@/types";
import { clientDisplayName } from "@/features/processes/utils";

/*
 * Hooks de parceria. Leem SEMPRE o estado recortado (useScopedStore): a
 * mesma chamada devolve tudo para a equipe interna e apenas a relação do
 * próprio escritório para um usuário parceiro.
 */

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export function usePartnerOffices(): PartnerOffice[] {
  return useScopedStore((s) => s.partnerOffices);
}

export function usePartnerOffice(id: ID | undefined): PartnerOffice | undefined {
  const offices = usePartnerOffices();
  return useMemo(() => offices.find((p) => p.id === id), [offices, id]);
}

export function usePartnerMap(): Map<ID, PartnerOffice> {
  const offices = usePartnerOffices();
  return useMemo(() => new Map(offices.map((p) => [p.id, p])), [offices]);
}

/** Opções para filtros "Escritório parceiro". */
export function usePartnerOptions(): { value: ID; label: string }[] {
  const offices = usePartnerOffices();
  return useMemo(() => offices.map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")), [offices]);
}

export function useProcessMap(): Map<ID, Process> {
  const processes = useScopedStore((s) => s.processes);
  return useMemo(() => new Map(processes.map((p) => [p.id, p])), [processes]);
}

export function usePartnerRequests(filter?: { partnerOfficeId?: ID; processId?: ID; clientId?: ID }): PartnerRequest[] {
  const requests = useScopedStore((s) => s.partnerRequests);
  const { partnerOfficeId, processId, clientId } = filter ?? {};
  return useMemo(
    () =>
      requests
        .filter((r) => (!partnerOfficeId || r.partnerOfficeId === partnerOfficeId) && (!processId || r.processId === processId) && (!clientId || r.clientId === clientId))
        .sort((a, b) => (a.status === "OPEN" ? 0 : 1) - (b.status === "OPEN" ? 0 : 1) || b.createdAt.localeCompare(a.createdAt)),
    [requests, partnerOfficeId, processId, clientId],
  );
}

export function usePartnerSubmissions(): PartnerCaseSubmission[] {
  return useScopedStore((s) => s.partnerSubmissions);
}

export function useSubmissionByProcess(processId: ID | undefined): PartnerCaseSubmission | undefined {
  const submissions = usePartnerSubmissions();
  return useMemo(() => submissions.find((s) => s.processId === processId), [submissions, processId]);
}

/** Acordos com valores derivados (estimado, realizado, repassado, pendente). */
export function usePartnershipViews(): PartnershipAgreementView[] {
  const agreements = useScopedStore((s) => s.partnershipAgreements);
  return useMemo(() => agreements.map(partnershipView), [agreements]);
}

export function useProcessPartnership(processId: ID | undefined): PartnershipAgreementView | undefined {
  const views = usePartnershipViews();
  return useMemo(() => views.find((v) => v.processId === processId), [views, processId]);
}

export function usePartnerFinancialSummary(partnerOfficeId: ID | undefined): PartnerFinancialSummary | undefined {
  const agreements = useScopedStore((s) => s.partnershipAgreements);
  return useMemo(() => (partnerOfficeId ? summarizePartnerFinance(partnerOfficeId, agreements) : undefined), [agreements, partnerOfficeId]);
}

export function usePartnerUsers(partnerOfficeId: ID | undefined): User[] {
  const users = useScopedStore((s) => s.users);
  return useMemo(() => users.filter((u) => !!partnerOfficeId && u.partnerOfficeId === partnerOfficeId), [users, partnerOfficeId]);
}

/** Clientes com relacionamento ativo com o parceiro (somente os autorizados). */
export function usePartnerClients(partnerOfficeId: ID | undefined): Client[] {
  const clients = useScopedStore((s) => s.clients);
  const relationships = useScopedStore((s) => s.clientRelationships);
  return useMemo(() => {
    const ids = new Set(relationships.filter((r) => r.officeType === "PARTNER" && r.partnerOfficeId === partnerOfficeId && r.status === "ACTIVE").map((r) => r.clientId));
    return clients.filter((c) => ids.has(c.id));
  }, [clients, relationships, partnerOfficeId]);
}

/** Processos cuja origem relacional é o parceiro. */
export function usePartnerProcesses(partnerOfficeId: ID | undefined): Process[] {
  const processes = useScopedStore((s) => s.processes);
  return useMemo(
    () => processes.filter((p) => p.relationshipOrigin === "PARTNER" && p.originPartnerOfficeId === partnerOfficeId),
    [processes, partnerOfficeId],
  );
}

export function usePartnerActivity(partnerOfficeId: ID | undefined): AuditEvent[] {
  const events = useScopedStore((s) => s.auditEvents);
  return useMemo(
    () => events.filter((e) => e.partnerOfficeId === partnerOfficeId).sort((a, b) => b.at.localeCompare(a.at)),
    [events, partnerOfficeId],
  );
}

export interface PartnerRow {
  partner: PartnerOffice;
  clients: number;
  activeProcesses: number;
  openRequests: number;
  newCases: number;
  lastActivityAt?: string;
}

/** Linhas da listagem de parceiros. */
export function usePartnerRows(): PartnerRow[] {
  const partners = usePartnerOffices();
  const relationships = useScopedStore((s) => s.clientRelationships);
  const processes = useScopedStore((s) => s.processes);
  const requests = useScopedStore((s) => s.partnerRequests);
  const submissions = useScopedStore((s) => s.partnerSubmissions);
  const events = useScopedStore((s) => s.auditEvents);
  return useMemo(
    () =>
      partners.map((partner) => {
        const last = events.filter((e) => e.partnerOfficeId === partner.id).reduce<string | undefined>((max, e) => (!max || e.at > max ? e.at : max), undefined);
        return {
          partner,
          clients: relationships.filter((r) => r.officeType === "PARTNER" && r.partnerOfficeId === partner.id && r.status === "ACTIVE").length,
          activeProcesses: processes.filter((p) => p.originPartnerOfficeId === partner.id && p.status !== "CLOSED").length,
          openRequests: requests.filter((r) => r.partnerOfficeId === partner.id && r.status === "OPEN").length,
          newCases: submissions.filter((s) => s.partnerOfficeId === partner.id && s.status === "SUBMITTED").length,
          lastActivityAt: last,
        };
      }),
    [partners, relationships, processes, requests, submissions, events],
  );
}

export interface NewPartnerCaseRow {
  submission: PartnerCaseSubmission;
  clientName: string;
  partnerName: string;
  documents: number;
}

/** Casos enviados por parceiros que ainda aguardam a equipe (Home interna). */
export function useNewPartnerCases(limit = 5): { rows: NewPartnerCaseRow[]; total: number } {
  const submissions = usePartnerSubmissions();
  const clients = useScopedStore((s) => s.clients);
  const partners = usePartnerMap();
  return useMemo(() => {
    const pending = submissions
      .filter((s) => s.status === "SUBMITTED" || s.status === "UNDER_ANALYSIS")
      .sort((a, b) => (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt));
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    return {
      total: pending.length,
      rows: pending.slice(0, limit).map((submission) => ({
        submission,
        clientName: clientDisplayName(clientMap.get(submission.clientId)),
        partnerName: partners.get(submission.partnerOfficeId)?.name ?? "Parceiro",
        documents: submission.documentIds.length,
      })),
    };
  }, [submissions, clients, partners, limit]);
}

/** Existe revisão interna em aberto neste processo? (interno: revisões; parceiro: sinais genéricos). */
export function useOpenInternalReviews(processId: ID): number {
  const reviews = useScopedStore((s) => s.reviews);
  const signals = useScopedStore((s) => s.reviewSignals);
  return useMemo(
    () => reviews.filter((r) => r.processId === processId && OPEN_REVIEW_STATUSES.includes(r.status)).length + signals.filter((s) => s.processId === processId).length,
    [reviews, signals, processId],
  );
}

/* ------------------------------------------------------------------ */
/* Ações (escritório proprietário)                                     */
/* ------------------------------------------------------------------ */

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function usePartnerActions() {
  const toast = useToast();

  const run = useCallback(
    async <T>(fn: () => Promise<T>, success: { title: string; description?: string }, failure: string): Promise<T | null> => {
      try {
        const result = await fn();
        toast({ tone: "success", ...success });
        return result;
      } catch (error) {
        toast({ tone: "danger", title: failure, description: errorMessage(error, "") || undefined });
        return null;
      }
    },
    [toast],
  );

  return {
    create: (input: NewPartnerOfficeInput) =>
      run(() => repositories.partners.create(input), { title: "Parceiro cadastrado", description: "Convite enviado ao responsável (simulado)." }, "Não foi possível cadastrar o parceiro."),
    update: (id: ID, patch: PartnerOfficePatch) => run(() => repositories.partners.update(id, patch), { title: "Dados do parceiro atualizados" }, "Não foi possível salvar."),
    setStatus: (id: ID, status: PartnerOfficeStatus) => run(() => repositories.partners.setStatus(id, status), { title: "Situação do parceiro atualizada" }, "Não foi possível alterar a situação."),
    changeShare: (id: ID, partner: number, owner: number) =>
      run(() => repositories.partners.changeShare(id, partner, owner), { title: "Divisão atualizada", description: "Vale para novos casos. Casos existentes mantêm o acordo original." }, "Não foi possível alterar a divisão."),
    inviteUser: (partnerOfficeId: ID, input: { name: string; email: string; role: PartnerRole }) =>
      run(() => repositories.partners.inviteUser(partnerOfficeId, input), { title: "Convite enviado", description: `${input.name} (${input.email}) — envio simulado.` }, "Não foi possível convidar."),
    setUserStatus: (userId: ID, status: "ACTIVE" | "DISABLED") =>
      run(() => repositories.partners.setUserStatus(userId, status), { title: status === "DISABLED" ? "Usuário inativado" : "Usuário reativado" }, "Não foi possível alterar o usuário."),
    changeUserRole: (userId: ID, role: PartnerRole) => run(() => repositories.partners.changeUserRole(userId, role), { title: "Papel alterado" }, "Não foi possível alterar o papel."),
    createRequest: (input: NewPartnerRequestInput) =>
      run(() => repositories.partners.createRequest(input), { title: "Solicitação enviada ao parceiro", description: input.title }, "Não foi possível criar a solicitação."),
    resolveRequest: (id: ID, resolution: "RESOLVED" | "CANCELLED") =>
      run(() => repositories.partners.resolveRequest(id, resolution), { title: resolution === "RESOLVED" ? "Solicitação resolvida" : "Solicitação cancelada" }, "Não foi possível atualizar a solicitação."),
    setSubmissionStatus: (id: ID, status: SubmissionStatus) =>
      run(() => repositories.partners.setSubmissionStatus(id, status), { title: "Situação do caso atualizada", description: "O parceiro foi notificado." }, "Não foi possível atualizar o caso."),
    shareDocument: (documentId: ID) =>
      run(() => repositories.partners.shareDocument(documentId), { title: "Documento disponibilizado ao parceiro" }, "Não foi possível disponibilizar o documento."),
    updateValues: (agreementId: ID, input: PartnershipValuesInput) =>
      run(() => repositories.partners.updateAgreementValues(agreementId, input), { title: "Valores da parceria atualizados" }, "Não foi possível salvar os valores."),
    registerPayout: (agreementId: ID, amount: number, note?: string) =>
      run(() => repositories.partners.registerPayout(agreementId, amount, note), { title: "Repasse registrado", description: "Registro interno — nenhuma transferência é feita pelo sistema." }, "Não foi possível registrar o repasse."),
  };
}
