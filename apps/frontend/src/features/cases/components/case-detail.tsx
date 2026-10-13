"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Archive, Check, FolderPlus, Handshake, Pencil, Send, X } from "lucide-react";
import { LEGAL_AREA_LABEL, type LegalArea } from "@/lib/constants/legal";
import { LEGAL_CASE_STATUS_LABEL, LEGAL_CASE_STATUS_TONE } from "@/lib/constants/status";
import { isAccepted, isDecidable } from "@/lib/domain/legal-case";
import { formatDateTime, formatEventTime } from "@/lib/formatting";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import type { ActionResult } from "@/lib/actions/result";
import { Can } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { PendingIntegration } from "@/components/feedback/pending-integration";
import { Callout, EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Avatar, Breadcrumbs } from "@/components/ui/display";
import { MenuButton } from "@/components/ui/menu";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import type { Page } from "@/server/core/pagination";
import type { CaseCatalogDTO, CaseInternalDTO } from "@/server/domain/cases/dto";
import type { DocumentListItem } from "@/server/domain/documents/dto";
import type { RequirementDTO } from "@/server/domain/documents/requirements/dto";
import type { ProcessListItem } from "@/server/domain/processes/dto";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import { RequirementsPanel } from "@/features/documents/components/requirements-panel";
import { RequestsPanel } from "@/features/partner-requests/components/requests-panel";
import type { PartnerRequestListItem } from "@/server/domain/partner-requests/dto";
import { usePermission } from "@/features/auth/hooks";
import { useDirectoryUser, useOrganizationName, useOrgDirectory, useOriginOptions } from "@/features/directory/directory-context";
import { ProcessListTable } from "@/features/processes/components/process-list-table";
import { useCaseActions } from "../use-case-actions";
import { AcceptCaseDialog, AssignLawyerDialog, ChangeOriginDialog, EditCaseDialog, RejectCaseDialog } from "./case-dialogs";

const TAB_KEYS = ["visao-geral", "documentos", "analise", "revisoes", "processos", "financeiro", "atividade"] as const;
type TabKey = (typeof TAB_KEYS)[number];
type DialogKey = "accept" | "reject" | "origin" | "lawyer" | "edit";

/**
 * Página do caso (equipe interna), com dados do servidor (getCaseAction):
 * visão geral, documentos/pendências e processos. Análise, revisões,
 * financeiro e atividade são conectados nas próximas fases; até lá, a aba diz
 * isso (nada de dado de demonstração).
 * Precisa estar dentro de <Suspense> (useUrlTab).
 */
export function CaseDetail({
  legalCase,
  catalog,
  processes,
  documents,
  requirements,
  partnerRequests,
}: {
  legalCase: CaseInternalDTO;
  catalog: CaseCatalogDTO;
  processes: ActionResult<Page<ProcessListItem>>;
  documents: ActionResult<Page<DocumentListItem>>;
  requirements: ActionResult<Page<RequirementDTO>>;
  /** Só quando o caso tem parceiro vinculado. */
  partnerRequests?: ActionResult<Page<PartnerRequestListItem>>;
}) {
  const canFinance = usePermission("finance.view");
  const [tab, setTab] = useUrlTab<TabKey>(TAB_KEYS, "visao-geral");
  const [dialog, setDialog] = useState<DialogKey | null>(null);
  const processCount = processes.ok ? processes.data.total : undefined;

  const items = useMemo<TabItem<TabKey>[]>(
    () => [
      { key: "visao-geral", label: "Visão geral" },
      {
        key: "documentos",
        label: "Documentos",
        count: documents.ok ? documents.data.total : undefined,
        attention: requirements.ok && requirements.data.items.some((r) => r.required && (r.status === "MISSING" || r.status === "REQUESTED" || r.status === "REJECTED")),
      },
      { key: "analise", label: "Análise" },
      { key: "revisoes", label: "Revisões" },
      { key: "processos", label: "Processos", count: processCount },
      ...(canFinance ? [{ key: "financeiro" as const, label: "Financeiro" }] : []),
      { key: "atividade", label: "Atividade" },
    ],
    [processCount, canFinance, documents, requirements],
  );
  const close = (o: boolean) => !o && setDialog(null);

  return (
    <>
      <CaseHeader legalCase={legalCase} onDialog={setDialog} />
      <Tabs items={items} value={tab} onChange={setTab} label="Seções do caso" className="mb-5" />
      <TabPanel tabKey={tab}>
        {tab === "visao-geral" && <CaseOverview legalCase={legalCase} onDialog={setDialog} />}
        {tab === "documentos" && (
          <div className="space-y-5">
            <RequirementsPanel legalCaseId={legalCase.id} requirements={requirements} documents={documents} />
            <DocumentsPanel
              scope={{ legalCaseId: legalCase.id }}
              initial={documents}
              title="Documentos do caso"
              description="Documentos ligados ao caso e aos processos dele. Documentos só do cadastro do cliente ficam na página do cliente."
              allowSharing={!!legalCase.partnerOrganizationId}
            />
            {partnerRequests && (
              <RequestsPanel
                scope={{ legalCaseId: legalCase.id }}
                initial={partnerRequests}
                title="Solicitações ao parceiro"
                description="Pendências deste caso enviadas ao escritório parceiro, com a conversa."
                newRequest={{ legalCaseId: legalCase.id }}
                showCase={false}
              />
            )}
          </div>
        )}
        {tab === "analise" && <PendingIntegration description="A análise jurídica do caso será conectada depois que o início da análise for atômico (análise + execução do agente)." />}
        {tab === "revisoes" && <PendingIntegration description="As revisões do caso serão conectadas em uma próxima fase." />}
        {tab === "processos" && <CaseProcessesTab legalCase={legalCase} processes={processes} />}
        {tab === "financeiro" && canFinance && <PendingIntegration description="O financeiro do caso será conectado depois da revisão do ciclo de vida do acordo financeiro." />}
        {tab === "atividade" && <PendingIntegration description="A linha do tempo de auditoria será conectada em uma próxima fase." />}
      </TabPanel>
      {dialog === "accept" && <AcceptCaseDialog legalCase={legalCase} open onOpenChange={close} />}
      {dialog === "reject" && <RejectCaseDialog legalCase={legalCase} open onOpenChange={close} />}
      {dialog === "lawyer" && <AssignLawyerDialog legalCase={legalCase} open onOpenChange={close} />}
      {dialog === "edit" && <EditCaseDialog legalCase={legalCase} catalog={catalog} open onOpenChange={close} />}
      {dialog === "origin" && <OriginDialog legalCase={legalCase} onOpenChange={close} />}
    </>
  );
}

function OriginDialog({ legalCase, onOpenChange }: { legalCase: CaseInternalDTO; onOpenChange: (o: boolean) => void }) {
  const allowed = useOriginOptions(legalCase.originOrganizationId);
  return <ChangeOriginDialog legalCase={legalCase} options={allowed} open onOpenChange={onOpenChange} />;
}

/* ------------------------------------------------------------------ */
/* Cabeçalho e ações por situação                                      */
/* ------------------------------------------------------------------ */

/** Origem do caso, com destaque quando é um parceiro. */
export function CaseOriginLabel({ originOrganizationId }: { originOrganizationId: string }) {
  const { owner } = useOrgDirectory();
  const name = useOrganizationName(originOrganizationId);
  if (originOrganizationId === owner.id) return <span>Origem do caso: {owner.name}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Handshake className="size-3.5 text-gold-600" aria-hidden />
      Origem do caso:{" "}
      <Can permission="partners.view">
        <Link href={`/parceiros/${originOrganizationId}`} className="font-medium text-navy hover:underline underline-offset-2">
          {name ?? "Escritório parceiro"}
        </Link>
      </Can>
    </span>
  );
}

function CaseHeader({ legalCase, onDialog }: { legalCase: CaseInternalDTO; onDialog: (d: DialogKey) => void }) {
  const lawyer = useDirectoryUser(legalCase.assignedLawyerId ?? undefined);
  const actions = useCaseActions();
  const canEdit = usePermission("cases.edit");
  const canDecide = usePermission("cases.decide");
  const canOverride = usePermission("cases.origin.override");
  const [busy, setBusy] = useState<string | null>(null);
  const status = legalCase.status;
  const accepted = isAccepted(status);
  const locked = status === "ARCHIVED" || status === "REJECTED";

  async function act(key: string, run: () => Promise<unknown>) {
    setBusy(key);
    await run();
    setBusy(null);
  }

  const editItems = [
    ...(canEdit && !locked ? [{ key: "edit", label: "Editar dados do caso", onSelect: () => onDialog("edit") }] : []),
    ...(canEdit && !locked && (!accepted || canOverride)
      ? [{ key: "origin", label: "Alterar origem", description: accepted ? "Somente Administrador, com motivo e confirmação." : undefined, onSelect: () => onDialog("origin") }]
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
                {legalCase.clientName || "Cliente"}
              </Link>
            </span>
            <CaseOriginLabel originOrganizationId={legalCase.originOrganizationId} />
            <span className="inline-flex items-center gap-2">
              <span className="text-subtle">Responsável</span>
              {lawyer ? (
                <>
                  <Avatar name={lawyer.name} size="xs" />
                  <span className="text-foreground">{lawyer.name}</span>
                </>
              ) : (
                <span className="font-medium text-warning">{legalCase.assignedLawyerId ? "—" : "Não definido"}</span>
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
            <Button icon={<Send className="size-4" aria-hidden />} loading={busy === "submit"} disabled={!!busy} onClick={() => act("submit", () => actions.submit(legalCase.id))}>
              Enviar para análise
            </Button>
          )}
          {isDecidable(status) && canDecide && (
            <>
              <Button variant="secondary" icon={<X className="size-4" aria-hidden />} disabled={!!busy} onClick={() => onDialog("reject")}>
                Rejeitar
              </Button>
              <Button icon={<Check className="size-4" aria-hidden />} disabled={!!busy} onClick={() => onDialog("accept")}>
                Aceitar
              </Button>
            </>
          )}
          {status === "ACCEPTED" && canDecide && (
            <Button variant="secondary" loading={busy === "start"} disabled={!!busy} onClick={() => act("start", () => actions.start(legalCase.id))}>
              Marcar em andamento
            </Button>
          )}
          {(status === "ACCEPTED" || status === "IN_PROGRESS") && canDecide && (
            <Button variant="secondary" loading={busy === "close"} disabled={!!busy} onClick={() => act("close", () => actions.close(legalCase.id))}>
              Encerrar caso
            </Button>
          )}
          {(status === "DRAFT" || status === "CLOSED" || status === "REJECTED") && canDecide && (
            <Button
              variant="secondary"
              icon={<Archive className="size-4" aria-hidden />}
              loading={busy === "archive"}
              disabled={!!busy}
              onClick={() => act("archive", () => actions.archive(legalCase.id))}
            >
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

function CaseOverview({ legalCase, onDialog }: { legalCase: CaseInternalDTO; onDialog: (d: DialogKey) => void }) {
  const { owner } = useOrgDirectory();
  const originName = useOrganizationName(legalCase.originOrganizationId);
  const createdByOrg = useOrganizationName(legalCase.createdByOrganizationId);
  const createdBy = useDirectoryUser(legalCase.createdBy || undefined);
  const acceptedBy = useDirectoryUser(legalCase.acceptedBy);
  const canDecide = usePermission("cases.decide");
  const partnerOrigin = legalCase.originOrganizationId !== owner.id;
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
                { label: "Área", value: LEGAL_AREA_LABEL[legalCase.area as LegalArea] ?? legalCase.areaName },
                { label: "Tipo", value: legalCase.caseType || "—" },
                { label: "Parte contrária", value: legalCase.opposingParty ?? "—" },
                { label: "Origem do caso", value: originName ?? "—" },
                { label: "Criado por", value: `${createdBy?.name ?? "—"} · ${createdByOrg ?? "—"}` },
                { label: "Criado em", value: formatDateTime(legalCase.createdAt) },
                { label: "Enviado para análise", value: legalCase.submittedAt ? formatDateTime(legalCase.submittedAt) : "—" },
                { label: "Aceito", value: legalCase.acceptedAt ? `${formatDateTime(legalCase.acceptedAt)}${acceptedBy ? ` · ${acceptedBy.name}` : ""}` : "—" },
                { label: "Resumo", value: legalCase.summary || "—", wide: true },
                ...(legalCase.partnerNotes ? [{ label: "Observações do parceiro", value: legalCase.partnerNotes, wide: true }] : []),
                ...(legalCase.notes ? [{ label: "Observações internas", value: legalCase.notes, wide: true }] : []),
              ]}
            />
          </PanelBody>
        </Panel>
      </div>
      <div className="col-span-12 space-y-5 xl:col-span-4">
        {partnerOrigin && (
          <Panel>
            <PanelHeader title="Parceria" />
            <PanelBody className="space-y-2 text-[13px]">
              <p className="text-[12.5px] text-muted">
                {isAccepted(legalCase.status)
                  ? "O acordo de parceria foi registrado no aceite, com a divisão vigente do parceiro naquele momento (snapshot). Os valores aparecem no Financeiro."
                  : "O acordo de parceria é criado no aceite, com a divisão vigente do parceiro naquele momento."}
              </p>
              <p className="text-[12.5px] text-muted">
                {legalCase.partnerOrganizationId ? "O parceiro tem acesso operacional a este caso." : "O parceiro de origem não tem acesso operacional a este caso (vínculo não habilitado)."}
              </p>
            </PanelBody>
          </Panel>
        )}
      </div>
    </div>
  );
}

function CaseProcessesTab({ legalCase, processes }: { legalCase: CaseInternalDTO; processes: ActionResult<Page<ProcessListItem>> }) {
  const newHref = `/processos/novo?caso=${legalCase.id}`;
  if (!processes.ok) return <ActionErrorState error={processes} title="Não foi possível carregar os processos do caso." />;
  if (processes.data.items.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={FolderPlus}
          title="Este caso ainda não possui processo judicial vinculado."
          description="Um caso pode existir antes do processo. Cadastre o processo quando houver distribuição."
          action={
            <Can permission="processes.edit">
              <ButtonLink href={newHref} icon={<FolderPlus className="size-4" aria-hidden />}>
                Cadastrar processo
              </ButtonLink>
            </Can>
          }
        />
      </Panel>
    );
  }
  return (
    <Panel>
      <PanelHeader
        title="Processos do caso"
        description={processes.data.total > processes.data.items.length ? `Mostrando ${processes.data.items.length} de ${processes.data.total}. Veja todos em Processos.` : undefined}
        actions={
          <Can permission="processes.edit">
            <ButtonLink href={newHref} variant="secondary" size="sm" icon={<FolderPlus className="size-4" aria-hidden />}>
              Cadastrar processo
            </ButtonLink>
          </Can>
        }
      />
      <ProcessListTable rows={processes.data.items} showClient={false} />
    </Panel>
  );
}
