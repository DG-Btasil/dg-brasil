"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, MessageSquareWarning, RotateCcw, XCircle } from "lucide-react";
import {
  DOCUMENT_CATEGORY_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  REVIEW_DECISION_LABEL,
  REVIEW_STATUS_LABEL,
  REVIEW_STATUS_TONE,
  type DocumentCategory,
  type Priority,
  type ReviewDecisionKind,
} from "@/lib/constants/status";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { PageContainer } from "@/components/layout/guards";
import { Callout, EmptyState } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader, Timeline } from "@/components/ui/display";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { canRequestChanges } from "@/server/domain/reviews/bulk-rules";
import type { ReviewDetailDTO, ReviewTargetDTO } from "@/server/domain/reviews/dto";
import { PROPOSAL_TYPE_LABEL } from "@/server/domain/reviews/labels";
import { usePermission, useRole } from "@/features/auth/hooks";
import { useDirectoryUserMap, useLawyerOptions } from "@/features/directory/directory-context";
import { REVIEW_KIND_LABEL } from "../list-query";
import { useReviewActions } from "../use-review-actions";
import { canEditReview, isEditableMime } from "../manual-revision";
import { AttachDocumentPanel } from "./attach-document-panel";
import { DecisionDialog } from "./decision-dialog";
import { DocumentContentPanel } from "./document-content";
import { DocumentPreviewPanel } from "./document-preview-panel";
import { DownloadVersionButton } from "./download-version-button";
import { AnalysisResultView } from "@/features/analyses/components/analysis-result-view";
import { PriorityBadge } from "./priority-badge";
import { DB_STATUS_LABEL, isOpen } from "./review-table";

const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }));
const VERSION_SOURCE_LABEL: Record<string, string> = {
  AGENT: "Gerado por agente",
  MANUAL_EDIT: "Edição manual",
  UPLOAD: "Envio de arquivo",
  IMPORT: "Importação",
  EXTERNAL: "Fonte externa",
};

/**
 * Revisão humana (ADMIN/LAWYER): o CONTEÚDO vem do alvo, lido na hora no
 * servidor (análise, versão de documento ou proposta do agente). Decidir é só
 * pela RPC decide_review; a tela muda depois da resposta (sem otimismo).
 */
export function ReviewDetail({ review }: { review: ReviewDetailDTO }) {
  const canDecide = usePermission("reviews.decide");
  const isAdmin = useRole() === "ADMIN";
  const users = useDirectoryUserMap();
  const actions = useReviewActions();
  const [deciding, setDeciding] = useState<ReviewDecisionKind | null>(null);
  const [reopening, setReopening] = useState(false);
  const open = isOpen(review);
  const allowed = canDecide && (!review.requiresAdmin || isAdmin);
  const changesAllowed = canRequestChanges(review.targetKind);
  const last =[...review.decisions].reverse().find((d) => d.decision !== null);

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Revisões", href: "/revisoes" }, { label: review.subject }]}
        eyebrow={REVIEW_KIND_LABEL[review.targetKind]}
        title={review.subject}
        meta={
          <>
            <StatusBadge status={review.status} labels={REVIEW_STATUS_LABEL} tones={REVIEW_STATUS_TONE} />
            {review.status !== "URGENT" && <PriorityBadge priority={review.priority} />}
            {review.agentName && <span>Gerado por {review.agentName}</span>}
            {review.legalCaseId && (
              <Link href={`/casos/${review.legalCaseId}`} className="font-medium text-navy hover:underline underline-offset-2">
                {review.caseTitle ?? "Abrir caso"}
              </Link>
            )}
            {review.clientName && <span>{review.clientName}</span>}
          </>
        }
      />

      <div className="mb-5 space-y-3">
        {review.dbStatus === "REOPENED" &&
          (changesAllowed ? (
            <Callout tone="warning" title="Revisão reaberta">
              A decisão anterior continua no histórico. Efeitos já aplicados por ela não são desfeitos automaticamente.
            </Callout>
          ) : (
            // Proposta só volta para a fila pela correção das que estavam paradas em "alterações solicitadas" (067).
            <Callout tone="warning" title="Esta proposta voltou para a fila">
              Ela tinha recebido “alterações solicitadas”, que não vale para proposta do agente, e ficou parada. Nada foi aplicado. Aprove ou rejeite.
            </Callout>
          ))}
        {open ? (
          allowed ? (
            <Panel>
              <PanelBody className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] text-muted">
                  {changesAllowed
                    ? "Leia o material ao lado e decida. Pedir alterações e rejeitar exigem justificativa."
                    : "Leia a proposta ao lado e decida: aprovar ou rejeitar. Rejeitar exige justificativa."}
                </p>
                <div className="flex gap-2">
                  <Button variant="danger" icon={<XCircle className="size-4" aria-hidden />} onClick={() => setDeciding("REJECTED")}>
                    Rejeitar
                  </Button>
                  {/* Proposta do agente só se aprova ou rejeita (067): não há o que o agente alterar. */}
                  {changesAllowed && (
                    <Button variant="secondary" icon={<MessageSquareWarning className="size-4" aria-hidden />} onClick={() => setDeciding("CHANGES_REQUESTED")}>
                      Solicitar alterações
                    </Button>
                  )}
                  <Button icon={<CheckCircle2 className="size-4" aria-hidden />} onClick={() => setDeciding("APPROVED")}>
                    Aprovar
                  </Button>
                </div>
              </PanelBody>
            </Panel>
          ) : (
            review.requiresAdmin && (
              <Callout tone="neutral" title="Decisão do administrador">
                Esta proposta altera a configuração do DG Brasil: só um administrador pode decidir.
              </Callout>
            )
          )
        ) : (
          <Callout
            tone={review.dbStatus === "APPROVED" ? "success" : review.dbStatus === "REJECTED" ? "danger" : "warning"}
            title={`${DB_STATUS_LABEL[review.dbStatus]}${review.decidedAt ? ` em ${formatDateTime(review.decidedAt)}` : ""}`}
            action={
              allowed && review.targetKind !== "AGENT_PROPOSAL" ? (
                <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={() => setReopening(true)}>
                  Reabrir
                </Button>
              ) : undefined
            }
          >
            {last?.notes ?? "Sem justificativa registrada."}
          </Callout>
        )}
      </div>

      <div className="grid grid-cols-12 items-start gap-5">
        <div className="col-span-12 space-y-5 xl:col-span-8">
          <TargetPanel target={review.target} reviewId={review.id} reviewStatus={review.dbStatus} canEdit={allowed && canEditReview(review.dbStatus)} />
        </div>
        <aside className="col-span-12 space-y-5 xl:col-span-4" aria-label="Atribuição, documentos e histórico">
          <Assignment review={review} editable={open && allowed} />
          {/* Só para revisão ligada a um caso e para quem pode enviar documento no caso (o painel decide). */}
          <AttachDocumentPanel review={review} pending={!open ? "NONE" : allowed ? "MINE" : "OTHERS"} />
          <Panel>
            <PanelHeader title="Histórico de decisões" />
            <PanelBody>
              {review.decisions.length === 0 ? (
                <EmptyState compact title="Nenhuma decisão ainda." />
              ) : (
                <Timeline
                  items={[...review.decisions].reverse().map((d) => ({
                    id: d.id,
                    title: d.decision ? REVIEW_DECISION_LABEL[d.decision] : "Reaberta",
                    meta: `${formatDateTime(d.at)} · ${users.get(d.decidedById)?.name ?? "—"}`,
                    description: d.notes,
                  }))}
                />
              )}
            </PanelBody>
          </Panel>
        </aside>
      </div>

      {deciding && (
        <DecisionDialog
          decision={deciding}
          description={review.subject}
          onClose={() => setDeciding(null)}
          onConfirm={(comment) => actions.decide(review.id, deciding, comment)}
        />
      )}
      {reopening && <ReopenDialog review={review} onClose={() => setReopening(false)} />}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */

/** Rótulos dos campos de proposta (contrato em server/executor/contract.ts). */
const PAYLOAD_LABEL: Record<string, string> = {
  title: "Título", description: "Descrição", due_at: "Data do prazo", priority: "Prioridade", legal_process_id: "Processo",
  responsible_user_id: "Responsável", category: "Categoria", label: "Documento", required: "Obrigatório",
  message_to_partner: "Mensagem ao parceiro", summary: "Resumo", status: "Situação", cnj_number: "Número CNJ", court: "Tribunal",
  court_unit: "Vara", district: "Comarca", state: "UF", legal_class: "Classe", subject: "Assunto", client_side: "Polo do cliente",
  adverse_party_summary: "Parte contrária", case_value: "Valor da causa", skill_slug: "Skill", agent_slug: "Agente",
  instructions: "Instruções", configuration: "Configuração",
};

const show = (v: unknown): string => (v === null || v === undefined ? "—" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));

function TargetPanel({ target, reviewId, reviewStatus, canEdit }: { target: ReviewTargetDTO | null; reviewId: string; reviewStatus: string; canEdit: boolean }) {
  if (!target) {
    return (
      <Panel>
        <EmptyState compact title="O material desta revisão não está mais disponível." description="Ele pode ter sido removido ou você não tem acesso a ele." />
      </Panel>
    );
  }
  if (target.kind === "ANALYSIS") {
    return (
      <Panel>
        <PanelHeader title="Resultado da análise" description="Saída estruturada do agente. Nada segue sem a sua decisão." />
        <PanelBody className="space-y-4">
          {!target.result ? (
            <EmptyState compact title="A análise ainda não tem resultado." />
          ) : (
            <AnalysisResultView result={target.result} reviewStatus={reviewStatus} />
          )}
          {target.agentRunId && (
            <p className="text-[12.5px]">
              <Link href={`/execucoes/${target.agentRunId}`} className="font-medium text-navy hover:underline underline-offset-2">
                Ver a execução do agente
              </Link>
            </p>
          )}
        </PanelBody>
      </Panel>
    );
  }
  if (target.kind === "DOCUMENT_VERSION") {
    // O MIME vem da versão gravada (document_versions.mime_type); o nome do arquivo cobre MIME ausente ou genérico.
    const file = { mimeType: target.mimeType, filename: target.originalFilename };
    return (
      <div className="space-y-5">
        <Panel>
          <PanelHeader
            title={target.title}
            description={`Versão ${target.versionNumber} · ${DOCUMENT_CATEGORY_LABEL[target.category as DocumentCategory] ?? target.category}`}
            actions={<DownloadVersionButton documentId={target.documentId} versionId={target.documentVersionId} file={file} />}
          />
          <PanelBody>
            <DefinitionGrid
              columns={2}
              items={[
                { label: "Arquivo", value: target.originalFilename },
                { label: "Origem", value: VERSION_SOURCE_LABEL[target.source] ?? target.source },
                { label: "Visibilidade", value: target.visibility === "PARTNER_VISIBLE" ? "Compartilhado com o parceiro" : "Somente interno" },
                { label: "Enviado em", value: formatDateTime(target.createdAt) },
              ]}
            />
          </PanelBody>
        </Panel>
        {/* Minuta de texto (.md/.txt): lida e editada na tela. PDF, Word e imagem: prévia do arquivo, sem baixar. */}
        {isEditableMime(target.mimeType) ? (
          <DocumentContentPanel reviewId={reviewId} mimeType={target.mimeType} canEdit={canEdit} />
        ) : (
          <DocumentPreviewPanel documentId={target.documentId} versionId={target.documentVersionId} title={target.title} file={file} />
        )}
      </div>
    );
  }
  // Payload do worker (018/039): { summary, data }. O que será aplicado é `data`, exatamente como está.
  const summary = typeof target.payload.summary === "string" ? target.payload.summary : undefined;
  const data = target.payload.data && typeof target.payload.data === "object" && !Array.isArray(target.payload.data) ? (target.payload.data as Record<string, unknown>) : undefined;
  const entries = Object.entries(data ?? target.payload).filter(([key]) => data || key !== "summary");
  return (
    <Panel>
      <PanelHeader title={PROPOSAL_TYPE_LABEL[target.proposalType] ?? "Proposta do agente"} description={`Criada em ${formatDateTime(target.createdAt)}. Aprovar aplica a proposta automaticamente, em até um minuto.`} />
      <PanelBody className="space-y-4">
        {summary && (
          <Callout tone="warning" title="Proposta da IA — não aplicada">
            {summary}
          </Callout>
        )}
        {entries.length === 0 ? (
          <EmptyState compact title="Proposta sem conteúdo." />
        ) : (
          <>
            <p className="text-[12px] text-muted">Se aprovada, será aplicada exatamente com estes dados:</p>
            <DefinitionGrid columns={2} items={entries.map(([key, value]) => ({ label: PAYLOAD_LABEL[key] ?? key, value: show(value), wide: typeof value === "string" && value.length > 60 }))} />
          </>
        )}
        {target.agentRunId && (
          <p className="text-[12.5px]">
            <Link href={`/execucoes/${target.agentRunId}`} className="font-medium text-navy hover:underline underline-offset-2">
              Ver a execução do agente
            </Link>
          </p>
        )}
      </PanelBody>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function Assignment({ review, editable }: { review: ReviewDetailDTO; editable: boolean }) {
  const users = useDirectoryUserMap();
  const lawyers = useLawyerOptions();
  const actions = useReviewActions();
  const [editing, setEditing] = useState(false);
  const [assignee, setAssignee] = useState(review.assignedReviewerId ?? "");
  const [priority, setPriority] = useState<Priority>(review.priority);
  const [due, setDue] = useState(review.dueAt ? review.dueAt.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);
  return (
    <Panel>
      <PanelHeader
        title="Atribuição"
        actions={
          editable && !editing ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Alterar
            </Button>
          ) : undefined
        }
      />
      <PanelBody className="space-y-3">
        {!editing ? (
          <DefinitionGrid
            columns={2}
            items={[
              { label: "Responsável", value: review.assignedReviewerId ? (users.get(review.assignedReviewerId)?.name ?? "—") : "Sem responsável" },
              { label: "Prioridade", value: PRIORITY_LABEL[review.priority] },
              { label: "Prazo", value: review.dueAt ? formatDate(review.dueAt) : undefined },
              { label: "Criada em", value: formatDateTime(review.createdAt) },
            ]}
          />
        ) : (
          <>
            <Field label="Responsável" requirement="optional" hint={review.requiresAdmin ? "Proposta estrutural: só administrador." : "Advogado ou administrador."}>
              {(p) => <Select {...p} placeholder="Sem responsável" options={lawyers} value={assignee} onChange={(e) => setAssignee(e.target.value)} />}
            </Field>
            <Field label="Prioridade" requirement="required">
              {(p) => <Select {...p} options={PRIORITY_OPTIONS} value={priority} onChange={(e) => setPriority(e.target.value as Priority)} />}
            </Field>
            <Field label="Prazo" requirement="optional">
              {(p) => <Input {...p} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button
                size="sm"
                loading={saving}
                onClick={async () => {
                  setSaving(true);
                  // Prazo do dia (fim do dia em São Paulo), sem hora escolhida.
                  const ok = await actions.assign(review.id, { assignedReviewerId: assignee || null, priority, dueAt: due ? `${due}T23:59:59-03:00` : null });
                  setSaving(false);
                  if (ok) setEditing(false);
                }}
              >
                Salvar
              </Button>
            </div>
          </>
        )}
        {review.requiresAdmin && <Badge tone="gold">Decisão exclusiva de administrador</Badge>}
      </PanelBody>
    </Panel>
  );
}

/** Reabrir: volta para a fila como "Reaberta"; a decisão anterior nunca é apagada. */
function ReopenDialog({ review, onClose }: { review: ReviewDetailDTO; onClose: () => void }) {
  const actions = useReviewActions();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title="Reabrir revisão"
      description={
        <>
          A revisão volta para a fila como <strong>Reaberta</strong> e exigirá nova decisão. A decisão anterior ({DB_STATUS_LABEL[review.dbStatus].toLowerCase()}) continua
          registrada no histórico e na auditoria. Efeitos já aplicados por ela não são desfeitos automaticamente.
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            icon={<RotateCcw className="size-4" aria-hidden />}
            loading={saving}
            onClick={async () => {
              setSaving(true);
              const ok = await actions.reopen(review.id, reason.trim() || undefined);
              setSaving(false);
              if (ok) onClose();
            }}
          >
            Confirmar reabertura
          </Button>
        </>
      }
    >
      <Field label="Motivo" requirement="optional" hint="Ex.: aprovada por engano; erro percebido depois; precisa de ajuste no conteúdo.">
        {(a) => <Textarea {...a} rows={3} maxLength={5000} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
      </Field>
    </Dialog>
  );
}
