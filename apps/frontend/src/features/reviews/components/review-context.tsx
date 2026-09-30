"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Bot, CheckCircle2, FilePen, FileText, Info, RotateCcw, type LucideIcon } from "lucide-react";
import { REVIEW_CONTENT_ORIGIN_LABEL, REVIEW_DECISION_LABEL, REVIEW_STATUS_LABEL } from "@/lib/constants/status";
import { formatDateTime, formatWaitingTime } from "@/lib/formatting";
import { Dialog } from "@/components/ui/dialog";
import { Panel } from "@/components/ui/panel";
import { usePermission } from "@/features/auth/hooks";
import { useUserMap } from "@/features/offices/hooks";
import { clientDisplayName } from "@/features/processes/utils";
import { useClientById } from "@/features/processes/hooks";
import type { Review, ReviewContentVersion } from "@/types";
import { useAgentMap, useDocumentMap, useProcessMap, useReviewDecisions, useSkillMap, useThesisMap } from "../hooks";
import { isOpenReview } from "../utils";
import { ReviewDocument } from "./review-document";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4 last:border-b-0">
      <h3 className="eyebrow mb-2">{title}</h3>
      <div className="text-[13px] leading-relaxed text-foreground">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-1">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="min-w-0 text-[13px]">{children ?? <span className="text-subtle">—</span>}</dd>
    </div>
  );
}

const linkCls = "text-navy hover:underline underline-offset-2";

/** Coluna de contexto: de onde veio, o que foi usado, o que acontece depois. */
export function ReviewContext({ review }: { review: Review }) {
  const client = useClientById(review.clientId);
  const processes = useProcessMap();
  const agents = useAgentMap();
  const skills = useSkillMap();
  const theses = useThesisMap();
  const documents = useDocumentMap();
  const users = useUserMap();
  const decisions = useReviewDecisions(review.id);
  const canSeeDg = usePermission("dgbrasil.view");

  const process = review.processId ? processes.get(review.processId) : undefined;
  const agent = agents.get(review.agentId);
  const thesis = review.thesisId ? theses.get(review.thesisId) : undefined;
  const dgLink = (href: string, label: string) => (canSeeDg ? <Link href={href} className={linkCls}>{label}</Link> : <span>{label}</span>);
  const [viewing, setViewing] = useState<ReviewContentVersion | null>(null);

  // Trilha completa e imutável: decisões + edições manuais + reaberturas, mais recentes primeiro.
  const trail = useMemo(() => {
    const items: { id: string; at: string; icon: LucideIcon; title: string; who: string; detail?: string; version?: ReviewContentVersion }[] = [
      ...decisions.map((d) => ({
        id: d.id,
        at: d.at,
        icon: CheckCircle2,
        title: `${REVIEW_DECISION_LABEL[d.decision]} · v${d.contentVersion ?? 1}`,
        who: users.get(d.userId)?.name ?? "Usuário",
        detail: d.comment ? `“${d.comment}”` : undefined,
      })),
      ...(review.history ?? []).map((h) => ({
        id: h.id,
        at: h.at,
        icon: h.kind === "MANUAL_EDIT" ? FilePen : h.kind === "AGENT_EDIT" ? Bot : RotateCcw,
        title:
          h.kind === "MANUAL_EDIT"
            ? `Editada manualmente · v${h.fromVersion} → v${h.toVersion}`
            : h.kind === "AGENT_EDIT"
              ? `Alteração pedida ao agente · v${h.fromVersion} → v${h.toVersion}`
              : `Reaberta${h.previousStatus ? ` (antes: ${REVIEW_STATUS_LABEL[h.previousStatus].toLowerCase()})` : ""}`,
        who: h.actor.name,
        detail:
          h.kind === "MANUAL_EDIT"
            ? `Origem: edição manual. Alterado: ${h.changedSections?.join(", ") ?? "—"}.`
            : h.kind === "AGENT_EDIT"
              ? `Instrução: “${h.instruction ?? ""}”`
              : h.reason
                ? `Motivo: “${h.reason}”`
                : undefined,
        version: h.kind !== "REOPENED" ? review.previousVersions?.find((v) => v.version === h.fromVersion) : undefined,
      })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at));
  }, [decisions, review.history, review.previousVersions, users]);

  return (
    <Panel>
      <Block title="Contexto">
        <dl>
          <Row label="Cliente">{client && <Link href={`/clientes/${client.id}`} className={linkCls}>{clientDisplayName(client)}</Link>}</Row>
          <Row label="Processo">{process && <Link href={`/processos/${process.id}`} className={linkCls}>{process.title}</Link>}</Row>
          <Row label="Agente">{agent && dgLink(`/dg-brasil/agentes/${agent.id}`, agent.name)}</Row>
          <Row label={review.skillIds.length > 1 ? "Skills utilizadas" : "Skill utilizada"}>
            {review.skillIds.length > 0 && (
              <ul className="space-y-0.5">
                {review.skillIds.map((id) => (
                  <li key={id}>{skills.get(id) ? dgLink(`/dg-brasil/skills/${id}`, skills.get(id)?.name ?? "") : "Skill não localizada"}</li>
                ))}
              </ul>
            )}
          </Row>
          <Row label="Tese">{thesis && dgLink(`/dg-brasil/teses/${thesis.id}`, thesis.name)}</Row>
          <Row label="Responsável">{review.assignedUserId ? users.get(review.assignedUserId)?.name : undefined}</Row>
          <Row label="Criada em">{formatDateTime(review.createdAt)}</Row>
          {isOpenReview(review) ? (
            <Row label="Aguardando">{formatWaitingTime(review.createdAt)}</Row>
          ) : (
            <Row label="Decidida em">{formatDateTime(review.decidedAt)}</Row>
          )}
        </dl>
      </Block>

      <Block title="Documentos consultados">
        {review.consultedDocumentIds.length === 0 ? (
          <span className="text-subtle">Nenhum documento informado.</span>
        ) : (
          <ul className="space-y-1">
            {review.consultedDocumentIds.map((id) => (
              <li key={id} className="flex items-start gap-2">
                <FileText className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
                <span>{documents.get(id)?.name ?? "Documento não localizado"}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Resumo do que foi feito">
        <p>{review.summary}</p>
      </Block>

      <Block title="Evidências">
        <ul className="list-disc space-y-1 pl-4 marker:text-subtle">
          {review.evidence.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </Block>

      <Block title="Ações propostas">
        <ul className="space-y-1">
          {review.proposedActions.map((a, i) => (
            <li key={i} className="flex items-start gap-2">
              <ArrowRight className="mt-1 size-3.5 shrink-0 text-gold-600" aria-hidden />
              <span>{a}</span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="O que acontece após a aprovação">
        <p className="first-letter:uppercase">{review.nextStepOnApproval}.</p>
      </Block>

      <Block title="Histórico">
        {trail.length === 0 ? (
          <span className="text-subtle">Nenhuma decisão ou edição registrada ainda.</span>
        ) : (
          <ol className="space-y-3">
            {trail.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id} className="flex items-start gap-2">
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
                  <div className="min-w-0">
                    <p className="font-medium">{item.title}</p>
                    <p className="text-[12px] text-muted">
                      {item.who} · {formatDateTime(item.at)}
                    </p>
                    {item.detail && <p className="mt-1 whitespace-pre-line text-[12.5px] text-muted">{item.detail}</p>}
                    {item.version && (
                      <button type="button" onClick={() => setViewing(item.version ?? null)} className="mt-1 text-[12px] font-medium text-navy hover:underline underline-offset-2">
                        Ver versão v{item.version.version}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Block>

      <Dialog
        open={viewing !== null}
        onOpenChange={(o) => !o && setViewing(null)}
        size="lg"
        title={viewing ? `Versão v${viewing.version} — ${REVIEW_CONTENT_ORIGIN_LABEL[viewing.origin]}` : "Versão anterior"}
        description={viewing ? `Substituída em ${formatDateTime(viewing.at)} por ${viewing.actor.name}. Somente leitura.` : undefined}
      >
        {viewing && <ReviewDocument content={viewing.content} />}
      </Dialog>

      <p className="flex items-start gap-2 px-5 py-3 text-[11.5px] leading-relaxed text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        O DG Brasil apresenta resumo, evidências e ações propostas — não o raciocínio interno do modelo.
      </p>
    </Panel>
  );
}
