import { Suspense } from "react";
import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { SkeletonRows } from "@/components/feedback/states";
import { CaseDetail } from "@/features/cases/components/case-detail";
import { CaseNotFound } from "@/features/cases/components/case-not-found";
import { PortalCaseDetail } from "@/features/partner-portal/components/portal-cases";
import { getCaseAction, getCaseCatalogAction } from "@/server/domain/cases/actions";
import { listCaseProcessesAction } from "@/server/domain/processes/actions";
import { listDocumentsAction } from "@/server/domain/documents/actions";
import { listRequirementsAction } from "@/server/domain/documents/requirements/actions";
import { documentListInput } from "@/features/documents/constants";
import { requestListInput } from "@/features/partner-requests/query";
import { listPartnerRequestsAction } from "@/server/domain/partner-requests/actions";
import { IN_FLIGHT_STATUSES } from "@/features/analyses/fields";
import { can } from "@/lib/permissions";
import { requireAppSession } from "@/server/auth/session";
import { getAnalysisAction, getAnalysisSetupAction, listAnalysesAction } from "@/server/domain/analyses/actions";
import { listReviewsAction } from "@/server/domain/reviews/actions";
import { DEFAULT_AGENT_RUN_QUERY, agentRunQueryToInput } from "@/features/agent-runs/list-query";
import { listAgentRunsAction } from "@/server/domain/agents/actions";
import { auditTimelineInput } from "@/features/audit/query";
import { listAuditEventsAction } from "@/server/domain/audit/actions";
import { DEFAULT_AGREEMENT_QUERY, agreementQueryToInput } from "@/features/finance/list-query";
import { listAgreementRowsAction, listCasePartnershipsAction } from "@/server/domain/finance/actions";

/**
 * Ficha do caso, lida no servidor a cada acesso (rota direta, nova aba e
 * recarregar funcionam). Sem acesso, id inexistente ou malformado → "não
 * encontrado": nunca revela se o caso existe para outro escritório.
 */
async function InternalCase({ id }: { id: string }) {
  const result = await getCaseAction({ id });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND" || result.error.code === "VALIDATION") return <CaseNotFound />;
    return <ActionErrorState error={result} title="Não foi possível abrir o caso." />;
  }
  if (result.data.surface !== "INTERNAL") return <CaseNotFound />;
  const withPartner = !!result.data.legalCase.partnerOrganizationId;
  const session = await requireAppSession();
  // Análises e revisões: só ADMIN/LAWYER (ASSISTANT não tem as abas nem a leitura).
  const canAnalyses = can(session.role, "analyses.start");
  const canReviews = can(session.role, "reviews.view");
  const canFinance = can(session.role, "finance.view");
  const canAudit = can(session.role, "audit.view");
  const [catalog, processes, documents, requirements, partnerRequests, analyses, reviews, finance, activity] = await Promise.all([
    getCaseCatalogAction(),
    listCaseProcessesAction({ caseId: id, pageSize: 50 }),
    listDocumentsAction(documentListInput({ legalCaseId: id })),
    listRequirementsAction({ legalCaseId: id, pageSize: 50 }),
    withPartner ? listPartnerRequestsAction(requestListInput({ legalCaseId: id })) : Promise.resolve(undefined),
    canAnalyses ? listAnalysesAction({ legalCaseId: id, pageSize: 50 }) : Promise.resolve(undefined),
    canReviews ? listReviewsAction({ legalCaseId: id, pageSize: 50 }) : Promise.resolve(undefined),
    canFinance
      ? Promise.all([listAgreementRowsAction(agreementQueryToInput(DEFAULT_AGREEMENT_QUERY, { legalCaseId: id })), listCasePartnershipsAction({ legalCaseId: id })])
      : Promise.resolve(undefined),
    canAudit ? listAuditEventsAction(auditTimelineInput(id)) : Promise.resolve(undefined),
  ]);
  if (!catalog.ok) return <ActionErrorState error={catalog} title="Não foi possível abrir o caso." />;
  // Análise atual: a em curso, ou a mais recente; com os rótulos dos campos do modelo.
  const latest = analyses?.ok ? (analyses.data.items.find((a) => IN_FLIGHT_STATUSES.includes(a.dbStatus)) ?? analyses.data.items[0]) : undefined;
  const [current, setup] = latest ? await Promise.all([getAnalysisAction({ id: latest.id }), getAnalysisSetupAction({ legalCaseId: id })]) : [undefined, undefined];
  const runs = canAnalyses ? await listAgentRunsAction(agentRunQueryToInput(DEFAULT_AGENT_RUN_QUERY, { legalCaseId: id })) : undefined;
  const fieldDefs = (latest && setup?.ok && setup.data.templates.find((t) => t.id === latest.templateId)?.fields) || [];
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <CaseDetail
        legalCase={result.data.legalCase}
        catalog={catalog.data}
        processes={processes}
        documents={documents}
        requirements={requirements}
        partnerRequests={partnerRequests}
        analysis={analyses && runs ? { list: analyses, current, fieldDefs, runs } : undefined}
        reviews={reviews}
        finance={finance ? { agreements: finance[0], partnerships: finance[1] } : undefined}
        activity={activity}
      />
    </Suspense>
  );
}

/** Portal: CasePartnerDTO + processos, documentos compartilhados, pendências documentais e solicitações. */
async function PartnerCase({ id }: { id: string }) {
  const result = await getCaseAction({ id });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND" || result.error.code === "VALIDATION") return <CaseNotFound />;
    return <ActionErrorState error={result} title="Não foi possível abrir o caso." />;
  }
  if (result.data.surface !== "PARTNER") return <CaseNotFound />;
  const [processes, documents, requirements, requests] = await Promise.all([
    listCaseProcessesAction({ caseId: id, pageSize: 50 }),
    listDocumentsAction(documentListInput({ legalCaseId: id })),
    listRequirementsAction({ legalCaseId: id, pageSize: 50 }),
    listPartnerRequestsAction(requestListInput({ legalCaseId: id })),
  ]);
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <PortalCaseDetail legalCase={result.data.legalCase} processes={processes} documents={documents} requirements={requirements} requests={requests} />
    </Suspense>
  );
}

export default async function CasePage({ params }: PageProps<"/casos/[id]">) {
  const { id } = await params;
  // Parceiro: caso de outro escritório não existe no estado recortado e aparece como "não encontrado".
  return (
    <AudienceSwitch
      owner={
        <PageContainer>
          <RequirePermission permission="cases.view">
            <InternalCase id={id} />
          </RequirePermission>
        </PageContainer>
      }
      partner={
        <RequirePermission permission="partnerPortal.view">
          <PageContainer>
            <PartnerCase id={id} />
          </PageContainer>
        </RequirePermission>
      }
    />
  );
}
