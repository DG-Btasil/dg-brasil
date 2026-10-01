"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Archive, Check, FilePlus2, FileSearch, FolderPlus, History, Pencil, Send, X } from "lucide-react";
import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { LEGAL_CASE_STATUS_LABEL, LEGAL_CASE_STATUS_TONE } from "@/lib/constants/status";
import { isAccepted, isDecidable } from "@/lib/domain/legal-case";
import { formatDateTime, formatEventTime } from "@/lib/formatting";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import { Can } from "@/components/layout/guards";
import { Callout, EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Avatar, Breadcrumbs, Timeline } from "@/components/ui/display";
import { MenuButton } from "@/components/ui/menu";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { AUDIT_ACTION_LABEL } from "@/types/audit";
import type { LegalCase } from "@/types";
import { usePermission } from "@/features/auth/hooks";
import { AnalysisTab } from "@/features/analyses/components/analysis-tab";
import { isActiveAnalysis } from "@/features/analyses/utils";
import { useAgentMap } from "@/features/analyses/hooks";
import { DocumentAddDialog } from "@/features/clients/components/detail/documents/document-add-dialog";
import { DocumentTable } from "@/features/clients/components/detail/documents/document-table";
import { useClientOriginOptions } from "@/features/clients/hooks";
import { CaseFinancePanel } from "@/features/finance/components/case-finance-panel";
import { useUser } from "@/features/offices/hooks";
import { CaseOriginTag, CasePartnerPanel } from "@/features/partners/components/case-partner-panel";
import { useClientMap } from "@/features/processes/hooks";
import { useProcessMap } from "@/features/reviews/hooks";
import { clientDisplayName } from "@/features/processes/utils";
import { ProcessesTab } from "@/features/clients/components/detail/processes-tab";
import { ReviewTable } from "@/features/reviews/components/review-table";
import {
  useCaseActions,
  useCaseActivity,
  useCaseAnalyses,
  useCaseDocuments,
  useCasePartnerId,
  useCasePartnership,
  useCaseProcesses,
  useCaseReviews,
  useLegalCase,
  useOfficeNames,
} from "../hooks";
import { AcceptCaseDialog, AssignLawyerDialog, ChangeOriginDialog, EditCaseDialog, RejectCaseDialog } from "./case-dialogs";
import { CaseNotFound } from "./case-not-found";

const TAB_KEYS = ["visao-geral", "documentos", "analise", "revisoes", "processos", "financeiro", "atividade"] as const;
type TabKey = (typeof TAB_KEYS)[number];
type DialogKey = "accept" | "reject" | "origin" | "lawyer" | "edit" | "document";

/** Página do caso (equipe interna). Precisa estar dentro de <Suspense> (useUrlTab). */
export function CaseDetail({ id }: { id: string }) {
  const legalCase = useLegalCase(id);
  const documents = useCaseDocuments(id);
  const analyses = useCaseAnalyses(id);
  const reviews = useCaseReviews(id);
  const processes = useCaseProcesses(id);
  const canFinance = usePermission("finance.view");
  const [tab, setTab] = useUrlTab<TabKey>(TAB_KEYS, "visao-geral");
  const [dialog, setDialog] = useState<DialogKey | null>(null);

  const items = useMemo<TabItem<TabKey>[]>(
    () => [
      { key: "visao-geral", label: "Visão geral" },
      { key: "documentos", label: "Documentos", count: documents.length, attention: documents.some((d) => d.status === "MISSING" || d.status === "PENDING") },
      { key: "analise", label: "Análise", attention: analyses[0]?.status === "WAITING_DOCUMENTS" || analyses[0]?.status === "READY" },
      { key: "revisoes", label: "Revisões", count: reviews.length },
      { key: "processos", label: "Processos", count: processes.length },
      ...(canFinance ? [{ key: "financeiro" as const, label: "Financeiro" }] : []),
      { key: "atividade", label: "Atividade" },
    ],
    [documents, analyses, reviews.length, processes.length, canFinance],
  );

  if (!legalCase) return <CaseNotFound />;
  const close = (o: boolean) => !o && setDialog(null);

  return (
    <>
      <CaseHeader legalCase={legalCase} hasActiveAnalysis={analyses.some(isActiveAnalysis)} onDialog={setDialog} />
      <Tabs items={items} value={tab} onChange={setTab} label="Seções do caso" className="mb-5" />
      <TabPanel tabKey={tab}>
        {tab === "visao-geral" && <CaseOverview legalCase={legalCase} onDialog={setDialog} />}
        {tab === "documentos" && <CaseDocumentsTab legalCase={legalCase} onAdd={() => setDialog("document")} />}
        {tab === "analise" && <AnalysisTab newHref={`/casos/${legalCase.id}/analise/nova`} analyses={analyses} onGoToDocuments={() => setTab("documentos")} />}
        {tab === "revisoes" && <CaseReviewsTab legalCase={legalCase} />}
        {tab === "processos" && <CaseProcessesTab legalCase={legalCase} />}
        {tab === "financeiro" && canFinance && <CaseFinancePanel legalCaseId={legalCase.id} />}
        {tab === "atividade" && <CaseActivityTab legalCaseId={legalCase.id} />}
      </TabPanel>
      {dialog === "accept" && <AcceptCaseDialog legalCase={legalCase} open onOpenChange={close} />}
      {dialog === "reject" && <RejectCaseDialog legalCase={legalCase} open onOpenChange={close} />}
      {dialog === "lawyer" && <AssignLawyerDialog legalCase={legalCase} open onOpenChange={close} />}
      {dialog === "edit" && <EditCaseDialog legalCase={legalCase} open onOpenChange={close} />}
      {dialog === "origin" && <OriginDialog legalCase={legalCase} onOpenChange={close} />}
      <DocumentAddDialog clientId={legalCase.clientId} legalCaseId={legalCase.id} open={dialog === "document"} onOpenChange={close} />
    </>
  );
}

function OriginDialog({ legalCase, onOpenChange }: { legalCase: LegalCase; onOpenChange: (o: boolean) => void }) {
  const allowed = useClientOriginOptions(legalCase.originOfficeId);
  return <ChangeOriginDialog legalCase={legalCase} options={allowed} open onOpenChange={onOpenChange} />;
}

/* ------------------------------------------------------------------ */
/* Cabeçalho e ações por situação                                      */
/* ------------------------------------------------------------------ */

function CaseHeader({ legalCase, hasActiveAnalysis, onDialog }: { legalCase: LegalCase; hasActiveAnalysis: boolean; onDialog: (d: DialogKey) => void }) {
  const clientMap = useClientMap();
  const lawyer = useUser(legalCase.assignedLawyerId ?? undefined);
  const actions = useCaseActions();
  const canEdit = usePermission("cases.edit");
  const canDecide = usePermission("cases.decide");
  const canStart = usePermission("analyses.start");
  const canOverride = usePermission("cases.origin.override");
  const status = legalCase.status;
  const accepted = isAccepted(status);
  const client = clientMap.get(legalCase.clientId);
  const locked = status === "ARCHIVED" || status === "REJECTED";

  const editItems = [
    ...(canEdit && !locked ? [{ key: "edit", label: "Editar dados do caso", onSelect: () => onDialog("edit") }] : []),
    ...(canEdit && !locked && (!accepted || canOverride)
      ? [{ key: "origin", label: "Alterar origem", description: accepted ? "Somente Administrador, com confirmação." : undefined, onSelect: () => onDialog("origin") }]
      : []),
    ...(canEdit && !locked ? [{ key: "lawyer", label: "Definir advogado responsável", onSelect: () => onDialog("lawyer") }] : []),
  ];

  return (
    <header className="mb-5">
      <Breadcrumbs items={[{ label: "Casos", href: "/casos" }, { label: legalCase.title }]} />
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">{legalCase.title}</h1>
            <StatusBadge status={status} labels={LEGAL_CASE_STATUS_LABEL} tones={LEGAL_CASE_STATUS_TONE} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-muted">
            <span>
              <span className="text-subtle">Cliente</span>{" "}
              <Link href={`/clientes/${legalCase.clientId}`} className="font-medium text-navy-700 hover:underline underline-offset-2">
                {clientDisplayName(client)}
              </Link>
            </span>
            <CaseOriginTag legalCase={legalCase} />
            <span className="inline-flex items-center gap-2">
              <span className="text-subtle">Responsável</span>
              {lawyer ? (
                <>
                  <Avatar name={lawyer.name} size="xs" />
                  <span className="text-foreground">{lawyer.name}</span>
                </>
              ) : (
                <span className="font-medium text-warning">Não definido</span>
              )}
            </span>
            <span>
              <span className="text-subtle">Atualizado</span> {formatEventTime(legalCase.updatedAt)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {editItems.length > 0 && <MenuButton label="Editar" icon={<Pencil className="size-4" aria-hidden />} items={editItems} size="md" />}
          {status === "DRAFT" && canEdit && (
            <Button icon={<Send className="size-4" aria-hidden />} onClick={() => void actions.submit(legalCase.id)}>
              Enviar para análise
            </Button>
          )}
          {isDecidable(status) && canStart && !hasActiveAnalysis && (
            <ButtonLink href={`/casos/${legalCase.id}/analise/nova`} variant="secondary" icon={<FileSearch className="size-4" aria-hidden />}>
              Iniciar análise
            </ButtonLink>
          )}
          {isDecidable(status) && canDecide && (
            <>
              <Button variant="secondary" icon={<X className="size-4" aria-hidden />} onClick={() => onDialog("reject")}>
                Rejeitar
              </Button>
              <Button icon={<Check className="size-4" aria-hidden />} onClick={() => onDialog("accept")}>
                Aceitar
              </Button>
            </>
          )}
          {status === "ACCEPTED" && canEdit && (
            <Button variant="secondary" onClick={() => void actions.setStatus(legalCase.id, "IN_PROGRESS")}>
              Marcar em andamento
            </Button>
          )}
          {(status === "ACCEPTED" || status === "IN_PROGRESS") && canEdit && (
            <Button variant="secondary" onClick={() => void actions.setStatus(legalCase.id, "CLOSED")}>
              Encerrar caso
            </Button>
          )}
          {(status === "DRAFT" || status === "CLOSED" || status === "REJECTED") && canEdit && (
            <Button variant="secondary" icon={<Archive className="size-4" aria-hidden />} onClick={() => void actions.setStatus(legalCase.id, "ARCHIVED")}>
              Arquivar
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Abas                                                                */
/* ------------------------------------------------------------------ */

function CaseOverview({ legalCase, onDialog }: { legalCase: LegalCase; onDialog: (d: DialogKey) => void }) {
  const officeName = useOfficeNames();
  const createdBy = useUser(legalCase.createdBy);
  const acceptedBy = useUser(legalCase.acceptedBy);
  const partnership = useCasePartnership(legalCase.id);
  const partnerId = useCasePartnerId(legalCase);
  const canPartnersFinance = usePermission("partners.finance.view");
  const canDecide = usePermission("cases.decide");
  const needsLawyer = !legalCase.assignedLawyerId && isDecidable(legalCase.status);

  return (
    <div className="grid grid-cols-12 gap-5">
      <div className="col-span-12 space-y-5 xl:col-span-8">
        {needsLawyer && (
          <Callout
            tone="warning"
            title="Advogado responsável necessário"
            action={
              canDecide ? (
                <Button size="sm" variant="secondary" onClick={() => onDialog("lawyer")}>
                  Definir responsável
                </Button>
              ) : undefined
            }
          >
            O caso só pode ser aceito com um advogado responsável definido.
          </Callout>
        )}
        {legalCase.status === "REJECTED" && (
          <Panel>
            <PanelHeader title="Rejeição" description={legalCase.rejectedAt ? `Rejeitado em ${formatDateTime(legalCase.rejectedAt)}` : undefined} />
            <PanelBody>
              <DefinitionGrid
                items={[
                  { label: "Comunicação ao parceiro", value: legalCase.rejectionReasonPublic, wide: true },
                  { label: "Nota interna (não visível ao parceiro)", value: legalCase.rejectionReasonInternal ?? "—", wide: true },
                ]}
              />
            </PanelBody>
          </Panel>
        )}
        <Panel>
          <PanelHeader title="Dados do caso" />
          <PanelBody>
            <DefinitionGrid
              items={[
                { label: "Área", value: LEGAL_AREA_LABEL[legalCase.area] },
                { label: "Tipo", value: legalCase.caseType },
                { label: "Parte contrária", value: legalCase.opposingParty ?? "—" },
                { label: "Origem do caso", value: officeName(legalCase.originOfficeId) },
                { label: "Criado por", value: `${createdBy?.name ?? "—"} · ${officeName(legalCase.createdByOfficeId)}` },
                { label: "Criado em", value: formatDateTime(legalCase.createdAt) },
                { label: "Enviado para análise", value: legalCase.submittedAt ? formatDateTime(legalCase.submittedAt) : "—" },
                { label: "Aceito", value: legalCase.acceptedAt ? `${formatDateTime(legalCase.acceptedAt)}${acceptedBy ? ` · ${acceptedBy.name}` : ""}` : "—" },
                { label: "Resumo", value: legalCase.summary, wide: true },
                ...(legalCase.partnerNotes ? [{ label: "Observações do parceiro", value: legalCase.partnerNotes, wide: true }] : []),
                ...(legalCase.notes ? [{ label: "Observações internas", value: legalCase.notes, wide: true }] : []),
              ]}
            />
          </PanelBody>
        </Panel>
      </div>
      <div className="col-span-12 space-y-5 xl:col-span-4">
        {partnerId && (
          <Panel>
            <PanelHeader title="Parceria" />
            <PanelBody className="space-y-2 text-[13px]">
              {partnership && canPartnersFinance ? (
                <>
                  <p>
                    Divisão do caso: <span className="font-semibold tabular">{partnership.partnerPercentage}% parceiro / {partnership.ownerPercentage}% escritório</span>
                  </p>
                  <p className="text-[12.5px] text-muted">Registrada no aceite em {formatDateTime(partnership.effectiveAt)} (snapshot). Mudanças futuras na divisão padrão não alteram este caso.</p>
                </>
              ) : (
                <p className="text-[12.5px] text-muted">O acordo de parceria é criado no aceite, com a divisão vigente do parceiro naquele momento.</p>
              )}
            </PanelBody>
          </Panel>
        )}
      </div>
    </div>
  );
}

function CaseDocumentsTab({ legalCase, onAdd }: { legalCase: LegalCase; onAdd: () => void }) {
  const documents = useCaseDocuments(legalCase.id);
  const partnerId = useCasePartnerId(legalCase);
  const fromPartner = !!partnerId || legalCase.createdByOfficeId !== legalCase.officeId;
  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="Documentos do caso"
          description="Documentos ligados ao caso e aos processos dele. Documentos do cadastro do cliente ficam na página do cliente."
          actions={
            <Can permission="documents.manage">
              <Button size="sm" variant="secondary" icon={<FilePlus2 className="size-4" aria-hidden />} onClick={onAdd}>
                Adicionar documento
              </Button>
            </Can>
          }
        />
        {documents.length === 0 ? <EmptyState compact icon={FilePlus2} title="Nenhum documento neste caso." /> : <DocumentTable documents={documents} />}
      </Panel>
      {fromPartner && <CasePartnerPanel legalCase={legalCase} documents={documents} />}
    </div>
  );
}

function CaseReviewsTab({ legalCase }: { legalCase: LegalCase }) {
  const reviews = useCaseReviews(legalCase.id);
  const agents = useAgentMap();
  const clients = useClientMap();
  const processes = useProcessMap();
  return (
    <Panel>
      <PanelHeader title="Revisões do caso" description="Peças e análises produzidas para este caso. Toda peça passa por revisão humana." />
      {reviews.length === 0 ? (
        <EmptyState compact icon={FileSearch} title="Nenhuma revisão neste caso." />
      ) : (
        <ReviewTable reviews={reviews} agents={agents} clients={clients} processes={processes} />
      )}
    </Panel>
  );
}

function CaseProcessesTab({ legalCase }: { legalCase: LegalCase }) {
  const processes = useCaseProcesses(legalCase.id);
  const clients = useClientMap();
  const client = clients.get(legalCase.clientId);
  if (processes.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={FolderPlus}
          title="Este caso ainda não possui processo judicial vinculado."
          description="Um caso pode existir antes do processo. Cadastre o processo quando houver distribuição."
          action={
            <Can permission="processes.edit">
              <ButtonLink href={`/processos/novo?caso=${legalCase.id}`} icon={<FolderPlus className="size-4" aria-hidden />}>
                Cadastrar processo
              </ButtonLink>
            </Can>
          }
        />
      </Panel>
    );
  }
  return client ? <ProcessesTab client={client} processes={processes} newHref={`/processos/novo?caso=${legalCase.id}`} title="Processos do caso" /> : null;
}

function CaseActivityTab({ legalCaseId }: { legalCaseId: string }) {
  const events = useCaseActivity(legalCaseId);
  return (
    <Panel className="max-w-[880px]">
      <PanelHeader title="Atividade" description="Registro de auditoria do caso, seus processos e documentos." />
      <PanelBody>
        {events.length === 0 ? (
          <EmptyState icon={History} title="Nenhuma atividade registrada." compact />
        ) : (
          <Timeline
            items={events.map((e) => ({
              id: e.id,
              title: AUDIT_ACTION_LABEL[e.action],
              description: (
                <>
                  {e.description} <span className="text-subtle">· {e.actor.name}</span>
                </>
              ),
              meta: formatDateTime(e.at),
              tone: e.actor.type === "AGENT" ? "navy" : "neutral",
            }))}
          />
        )}
      </PanelBody>
    </Panel>
  );
}
