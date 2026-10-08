"use client";

import { useCallback, useMemo } from "react";
import type { LegalCaseStatus } from "@/lib/constants/status";
import { casePartnerId, isEligibleLawyer } from "@/lib/domain/legal-case";
import { partnershipView } from "@/lib/domain/partnership";
import { originOfficeName } from "@/lib/permissions/client-origin";
import { repositories } from "@/repositories";
import { useScopedStore } from "@/store/scope";
import type { CaseRejectionInput, LegalCasePatch, NewLegalCaseInput } from "@/store/types";
import { useToast } from "@/store/ui-store";
import type { AuditEvent, ClientDocument, ID, LegalAnalysis, LegalCase, LegalCaseRow, PartnershipAgreementView, Process, Review } from "@/types";
import { clientDisplayName } from "@/features/processes/utils";

/*
 * Casos jurídicos. Leitura sempre pelo estado recortado: a equipe interna vê
 * todos; o parceiro vê só os casos originados ou enviados por ele.
 */

export function useLegalCases(): LegalCase[] {
  return useScopedStore((s) => s.legalCases);
}

export function useLegalCase(id: ID | undefined): LegalCase | undefined {
  const cases = useLegalCases();
  return useMemo(() => cases.find((c) => c.id === id), [cases, id]);
}

export function useCaseMap(): Map<ID, LegalCase> {
  const cases = useLegalCases();
  return useMemo(() => new Map(cases.map((c) => [c.id, c])), [cases]);
}

/** Nome do escritório de origem (Bárbara ou parceiro). */
export function useOfficeNames(): (officeId: ID | undefined) => string {
  const office = useScopedStore((s) => s.office);
  const partners = useScopedStore((s) => s.partnerOffices);
  return useCallback((officeId) => originOfficeName(officeId, office, partners) ?? "Escritório parceiro", [office, partners]);
}

/** Parceiro de origem do caso (undefined = caso próprio). */
export function useCasePartnerId(legalCase: LegalCase | undefined): ID | undefined {
  const office = useScopedStore((s) => s.office);
  return legalCase ? casePartnerId(legalCase, office.id) : undefined;
}

export function useClientCases(clientId: ID | undefined): LegalCase[] {
  const cases = useLegalCases();
  return useMemo(() => cases.filter((c) => c.clientId === clientId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [cases, clientId]);
}

export function useCaseProcesses(legalCaseId: ID | undefined): Process[] {
  const processes = useScopedStore((s) => s.processes);
  return useMemo(() => processes.filter((p) => p.legalCaseId === legalCaseId), [processes, legalCaseId]);
}

/** Documentos do caso: os ligados ao caso e os dos processos dele. */
export function useCaseDocuments(legalCaseId: ID | undefined): ClientDocument[] {
  const documents = useScopedStore((s) => s.documents);
  const processes = useCaseProcesses(legalCaseId);
  return useMemo(() => {
    const processIds = new Set(processes.map((p) => p.id));
    return documents
      .filter((d) => d.legalCaseId === legalCaseId || (!!d.processId && processIds.has(d.processId)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [documents, processes, legalCaseId]);
}

export function useCaseReviews(legalCaseId: ID | undefined): Review[] {
  const reviews = useScopedStore((s) => s.reviews);
  return useMemo(() => reviews.filter((r) => r.legalCaseId === legalCaseId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [reviews, legalCaseId]);
}

export function useCaseAnalyses(legalCaseId: ID | undefined): LegalAnalysis[] {
  const analyses = useScopedStore((s) => s.analyses);
  return useMemo(
    () => analyses.filter((a) => a.legalCaseId === legalCaseId).sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt)),
    [analyses, legalCaseId],
  );
}

/** Acordo de parceria vigente do caso (com valores derivados). */
export function useCasePartnership(legalCaseId: ID | undefined): PartnershipAgreementView | undefined {
  const agreements = useScopedStore((s) => s.partnershipAgreements);
  return useMemo(() => {
    const agreement = agreements.find((a) => a.legalCaseId === legalCaseId && !a.cancelledAt);
    return agreement ? partnershipView(agreement) : undefined;
  }, [agreements, legalCaseId]);
}

/** Linha do tempo do caso: eventos do caso, dos processos e documentos dele. */
export function useCaseActivity(legalCaseId: ID | undefined): AuditEvent[] {
  const events = useScopedStore((s) => s.auditEvents);
  const processes = useCaseProcesses(legalCaseId);
  const documents = useCaseDocuments(legalCaseId);
  return useMemo(() => {
    const ids = new Set<ID>([legalCaseId ?? "", ...processes.map((p) => p.id), ...documents.map((d) => d.id)]);
    return events.filter((e) => ids.has(e.entityId)).sort((a, b) => b.at.localeCompare(a.at));
  }, [events, processes, documents, legalCaseId]);
}

/** Advogados elegíveis para responsável: Advogados internos e Administrador inscrito na OAB. */
export function useEligibleLawyers(): { value: ID; label: string }[] {
  const users = useScopedStore((s) => s.users);
  return useMemo(() => users.filter(isEligibleLawyer).map((u) => ({ value: u.id, label: u.name })), [users]);
}

/** Linhas da listagem de casos, com os dados derivados. */
export function useCaseRows(): LegalCaseRow[] {
  const cases = useLegalCases();
  const clients = useScopedStore((s) => s.clients);
  const users = useScopedStore((s) => s.users);
  const processes = useScopedStore((s) => s.processes);
  const documents = useScopedStore((s) => s.documents);
  const office = useScopedStore((s) => s.office);
  const officeName = useOfficeNames();
  return useMemo(() => {
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const userMap = new Map(users.map((u) => [u.id, u]));
    const processCount = new Map<ID, number>();
    processes.forEach((p) => processCount.set(p.legalCaseId, (processCount.get(p.legalCaseId) ?? 0) + 1));
    const docCount = new Map<ID, number>();
    documents.forEach((d) => d.legalCaseId && docCount.set(d.legalCaseId, (docCount.get(d.legalCaseId) ?? 0) + 1));
    return cases.map((legalCase) => {
      const partnerId = casePartnerId(legalCase, office.id);
      return {
        legalCase,
        clientName: clientDisplayName(clientMap.get(legalCase.clientId)),
        originName: officeName(legalCase.originOrganizationId),
        partnerName: partnerId ? officeName(partnerId) : undefined,
        lawyerName: legalCase.assignedLawyerId ? userMap.get(legalCase.assignedLawyerId)?.name : undefined,
        processCount: processCount.get(legalCase.id) ?? 0,
        documentCount: docCount.get(legalCase.id) ?? 0,
      };
    });
  }, [cases, clients, users, processes, documents, office.id, officeName]);
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */

function message(error: unknown) {
  return error instanceof Error && error.message ? error.message : undefined;
}

export function useCaseActions() {
  const toast = useToast();
  const run = useCallback(
    async <T>(fn: () => Promise<T>, success: { title: string; description?: string }, failure: string): Promise<T | null> => {
      try {
        const result = await fn();
        toast({ tone: "success", ...success });
        return result;
      } catch (error) {
        toast({ tone: "danger", title: failure, description: message(error) });
        return null;
      }
    },
    [toast],
  );
  return {
    create: (input: NewLegalCaseInput) =>
      run(() => repositories.cases.create(input), { title: input.submit ? "Caso criado e enviado para análise" : "Rascunho do caso salvo" }, "Não foi possível criar o caso."),
    update: (id: ID, patch: LegalCasePatch) => run(() => repositories.cases.update(id, patch), { title: "Caso atualizado" }, "Não foi possível salvar o caso."),
    submit: (id: ID) => run(() => repositories.cases.submit(id), { title: "Caso enviado para análise" }, "Não foi possível enviar o caso."),
    changeOrigin: (id: ID, originOrganizationId: ID, linkPartner?: boolean) =>
      run(() => repositories.cases.changeOrigin(id, originOrganizationId, linkPartner), { title: "Origem do caso alterada", description: "A alteração ficou registrada na auditoria." }, "Não foi possível alterar a origem."),
    assignLawyer: (id: ID, lawyerId: ID) => run(() => repositories.cases.assignLawyer(id, lawyerId), { title: "Advogado responsável definido" }, "Não foi possível definir o responsável."),
    accept: (id: ID, lawyerId?: ID) =>
      run(() => repositories.cases.accept(id, lawyerId), { title: "Caso aceito", description: "Acordo de parceria criado quando a origem é parceiro." }, "Não foi possível aceitar o caso."),
    reject: (id: ID, input: CaseRejectionInput) =>
      run(() => repositories.cases.reject(id, input), { title: "Caso rejeitado", description: "Somente o motivo público é comunicado ao parceiro." }, "Não foi possível rejeitar o caso."),
    setStatus: (id: ID, status: Extract<LegalCaseStatus, "IN_PROGRESS" | "CLOSED" | "ARCHIVED">) =>
      run(() => repositories.cases.setStatus(id, status), { title: "Situação do caso atualizada" }, "Não foi possível atualizar o caso."),
  };
}
