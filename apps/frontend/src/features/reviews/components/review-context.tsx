"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CheckCircle2, FileText, Info } from "lucide-react";
import { REVIEW_DECISION_LABEL } from "@/lib/constants/status";
import { formatDateTime, formatWaitingTime } from "@/lib/formatting";
import { Panel } from "@/components/ui/panel";
import { usePermission } from "@/features/auth/hooks";
import { useUserMap } from "@/features/offices/hooks";
import { clientDisplayName } from "@/features/processes/utils";
import { useClientById } from "@/features/processes/hooks";
import type { Review } from "@/types";
import { useAgentMap, useDocumentMap, useProcessMap, useReviewDecisions, useSkillMap, useThesisMap } from "../hooks";
import { isOpenReview } from "../utils";

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

      <Block title="Histórico de decisões">
        {decisions.length === 0 ? (
          <span className="text-subtle">Nenhuma decisão registrada ainda.</span>
        ) : (
          <ol className="space-y-3">
            {decisions.map((d) => (
              <li key={d.id} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium">{REVIEW_DECISION_LABEL[d.decision]}</p>
                  <p className="text-[12px] text-muted">
                    {users.get(d.userId)?.name ?? "Usuário"} · {formatDateTime(d.at)}
                  </p>
                  {d.comment && <p className="mt-1 whitespace-pre-line text-[12.5px] text-muted">“{d.comment}”</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Block>

      <p className="flex items-start gap-2 px-5 py-3 text-[11.5px] leading-relaxed text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        O DG Brasil apresenta resumo, evidências e ações propostas — não o raciocínio interno do modelo.
      </p>
    </Panel>
  );
}
