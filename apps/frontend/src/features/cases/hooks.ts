"use client";

import { useCallback, useMemo } from "react";
import { casePartnerId } from "@/lib/domain/legal-case";
import { partnershipView } from "@/lib/domain/partnership";
import { originOfficeName } from "@/lib/permissions/client-origin";
import { useScopedStore } from "@/store/scope";
import type { AuditEvent, ClientDocument, ID, LegalAnalysis, LegalCase, LegalCaseRow, PartnershipAgreementView, Process } from "@/types";
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

export function useCaseProcesses(legalCaseId: ID | undefined): Process[] {
  const processes = useScopedStore((s) => s.processes);
  return useMemo(() => processes.filter((p) => p.legalCaseId === legalCaseId), [processes, legalCaseId]);
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

/** Documentos do caso (demonstração, Portal do Parceiro até a Fase D). */
function useCaseDocuments(legalCaseId: ID | undefined): ClientDocument[] {
  const documents = useScopedStore((s) => s.documents);
  const processes = useCaseProcesses(legalCaseId);
  return useMemo(() => {
    const processIds = new Set(processes.map((p) => p.id));
    return documents.filter((d) => d.legalCaseId === legalCaseId || (!!d.processId && processIds.has(d.processId)));
  }, [documents, processes, legalCaseId]);
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


