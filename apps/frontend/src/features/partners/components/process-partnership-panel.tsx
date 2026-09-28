"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FileLock2, FileText, Handshake, MessageSquarePlus, Share2 } from "lucide-react";
import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import {
  DOCUMENT_CATEGORY_LABEL,
  DOCUMENT_VISIBILITY_LABEL,
  OWNER_SUBMISSION_TRANSITIONS,
  PROCESS_ORIGIN_LABEL,
  SUBMISSION_STATUS_LABEL,
  SUBMISSION_STATUS_TONE,
  type SubmissionStatus,
} from "@/lib/constants/status";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { Can } from "@/components/layout/guards";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/states";
import { useCan } from "@/features/auth/hooks";
import { useClientMap } from "@/features/processes/hooks";
import type { ClientDocument, Process } from "@/types";
import { useScopedStore } from "@/store/scope";
import { usePartnerActions, usePartnerOffice, usePartnerRequests, useProcessMap, useProcessPartnership, useSubmissionByProcess } from "../hooks";
import { PartnershipAgreementsTable } from "./agreements-table";
import { NewPartnerRequestDialog } from "./partner-dialogs";
import { PartnerRequestList } from "./request-list";

const TRANSITION_OPTIONS = OWNER_SUBMISSION_TRANSITIONS.map((s) => ({ value: s, label: SUBMISSION_STATUS_LABEL[s] }));

/**
 * Aba "Parceria" do processo (ambiente interno): origem do caso, situação
 * do envio, solicitações, documentos visíveis ao parceiro e acordo financeiro.
 */
export function ProcessPartnershipPanel({ process }: { process: Process }) {
  const partner = usePartnerOffice(process.originPartnerOfficeId);
  const submission = useSubmissionByProcess(process.id);
  const agreement = useProcessPartnership(process.id);
  const requests = usePartnerRequests({ processId: process.id });
  const clientMap = useClientMap();
  const processMap = useProcessMap();
  const actions = usePartnerActions();
  const can = useCan();
  const allDocuments = useScopedStore((s) => s.documents);
  const documents = useMemo(() => allDocuments.filter((d) => d.processId === process.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [allDocuments, process.id]);
  const [dialog, setDialog] = useState<"request" | null>(null);
  const [sharing, setSharing] = useState<ClientDocument | null>(null);

  if (!partner) return <EmptyState compact icon={Handshake} title="Parceiro não encontrado." />;

  return (
    <div className="grid grid-cols-12 gap-5">
      <Panel className="col-span-12 xl:col-span-7">
        <PanelHeader title="Origem" />
        <PanelBody>
          <DefinitionGrid
            items={[
              {
                label: "Origem do caso",
                value: (
                  <Link href={`/parceiros/${partner.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                    {partner.name}
                  </Link>
                ),
              },
              { label: "Origem do cadastro processual", value: PROCESS_ORIGIN_LABEL[process.origin] },
              { label: "Caso enviado em", value: submission?.submittedAt ? formatDateTime(submission.submittedAt) : "Cadastro direto do processo" },
              { label: "Área", value: submission ? LEGAL_AREA_LABEL[submission.area] : LEGAL_AREA_LABEL[process.area] },
              { label: "Relato do parceiro", value: submission?.summary, wide: true },
              { label: "Observações do parceiro", value: submission?.notes, wide: true },
            ]}
          />
        </PanelBody>
      </Panel>

      <Panel className="col-span-12 xl:col-span-5">
        <PanelHeader title="Situação do caso enviado" description="O parceiro vê esta situação e é notificado a cada mudança." />
        <PanelBody className="space-y-3">
          {submission ? (
            <>
              <StatusBadge status={submission.status} labels={SUBMISSION_STATUS_LABEL} tones={SUBMISSION_STATUS_TONE} />
              <Can permission="partners.view">
                <Select
                  aria-label="Alterar situação do caso"
                  placeholder="Alterar situação…"
                  value=""
                  options={TRANSITION_OPTIONS.filter((o) => o.value !== submission.status)}
                  onChange={(e) => e.target.value && void actions.setSubmissionStatus(submission.id, e.target.value as SubmissionStatus)}
                />
              </Can>
            </>
          ) : (
            <p className="text-[12.5px] text-muted">Processo cadastrado diretamente, sem envio de caso.</p>
          )}
        </PanelBody>
      </Panel>

      <Panel className="col-span-12">
        <PanelHeader
          title="Solicitações ao parceiro"
          actions={
            <Can permission="partnerRequests.manage">
              <Button size="sm" variant="secondary" icon={<MessageSquarePlus className="size-3.5" aria-hidden />} onClick={() => setDialog("request")}>
                Nova solicitação
              </Button>
            </Can>
          }
        />
        <PartnerRequestList
          requests={requests}
          clientMap={clientMap}
          processMap={processMap}
          emptyText="Nenhuma solicitação neste caso."
          actions={(r) =>
            r.status !== "RESOLVED" &&
            r.status !== "CANCELLED" &&
            can("partnerRequests.manage") && (
              <Button size="sm" variant="secondary" onClick={() => void actions.resolveRequest(r.id, "RESOLVED")}>
                Marcar resolvida
              </Button>
            )
          }
        />
      </Panel>

      <Panel className="col-span-12">
        <PanelHeader title="Documentos e visibilidade" description="Documentos internos nunca chegam ao parceiro. Disponibilize apenas versões aprovadas." />
        {documents.length === 0 ? (
          <EmptyState compact icon={FileText} title="Nenhum documento neste processo." />
        ) : (
          <Table caption="Documentos do caso e visibilidade">
            <THead>
              <tr>
                <Th>Documento</Th>
                <Th>Enviado por</Th>
                <Th>Versão</Th>
                <Th>Visibilidade</Th>
                <Th>
                  <span className="sr-only">Ações</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {documents.map((d) => (
                <Tr key={d.id} className={d.supersededAt ? "opacity-60" : undefined}>
                  <Td>
                    <div className="font-medium text-foreground">{d.name}</div>
                    <div className="text-[12px] text-muted">
                      {DOCUMENT_CATEGORY_LABEL[d.category]}
                      {d.uploadedAt && ` · ${formatDate(d.uploadedAt)}`}
                    </div>
                  </Td>
                  <Td className="text-[12.5px]">{d.uploadedByPartnerOfficeId ? partner.name : "Equipe interna"}</Td>
                  <Td className="text-[12.5px] tabular">
                    {d.version ? `v${d.version}` : "—"}
                    {d.supersededAt && <span className="ml-1 text-muted">(substituída)</span>}
                  </Td>
                  <Td>
                    <Badge tone={d.visibility === "INTERNAL" ? "neutral" : "info"} icon={d.visibility === "INTERNAL" ? <FileLock2 className="size-3" aria-hidden /> : undefined}>
                      {DOCUMENT_VISIBILITY_LABEL[d.visibility]}
                    </Badge>
                    {d.sourceReviewId && <span className="ml-2 text-[11.5px] text-success">Versão aprovada</span>}
                  </Td>
                  <Td className="text-right">
                    {d.visibility === "INTERNAL" && !d.uploadedByPartnerOfficeId && (
                      <Can permission="documents.manage">
                        <Button size="sm" variant="secondary" icon={<Share2 className="size-3.5" aria-hidden />} onClick={() => setSharing(d)}>
                          Disponibilizar ao parceiro
                        </Button>
                      </Can>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      {agreement && (
        <Can permission="partners.finance.view">
          <Panel className="col-span-12">
            <PanelHeader title="Financeiro da parceria" description="Divisão registrada neste caso (snapshot). Não muda se a divisão padrão do parceiro for alterada." />
            <PartnershipAgreementsTable agreements={[agreement]} clientMap={clientMap} processMap={processMap} />
          </Panel>
        </Can>
      )}

      {dialog === "request" && (
        <NewPartnerRequestDialog partnerOfficeId={partner.id} clientId={process.clientId} processId={process.id} open onOpenChange={(o) => !o && setDialog(null)} />
      )}
      <Dialog
        open={!!sharing}
        onOpenChange={(o) => !o && setSharing(null)}
        size="sm"
        title="Disponibilizar ao parceiro?"
        description={
          sharing?.sourceReviewId
            ? `“${sharing?.name}” foi aprovado em revisão. ${partner.name} poderá visualizar esta versão aprovada.`
            : `${partner.name} passará a visualizar “${sharing?.name}”. Confirme que o documento está aprovado e pode ser compartilhado.`
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setSharing(null)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (sharing) await actions.shareDocument(sharing.id);
                setSharing(null);
              }}
            >
              Disponibilizar
            </Button>
          </>
        }
      />
    </div>
  );
}

/** "Origem do caso" no cabeçalho do processo (interno). */
export function CaseOriginTag({ process }: { process: Process }) {
  const partner = usePartnerOffice(process.originPartnerOfficeId);
  if (process.relationshipOrigin !== "PARTNER") return <span>Origem do caso: Próprio</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Handshake className="size-3.5 text-gold-600" aria-hidden />
      Origem do caso:{" "}
      {partner ? (
        <Link href={`/parceiros/${partner.id}`} className="font-medium text-navy hover:underline underline-offset-2">
          {partner.name}
        </Link>
      ) : (
        "Parceiro"
      )}
    </span>
  );
}
