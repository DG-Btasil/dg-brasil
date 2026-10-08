"use client";

import Link from "next/link";
import { useState } from "react";
import { FileLock2, FileText, Handshake, MessageSquarePlus, Share2 } from "lucide-react";
import { DOCUMENT_CATEGORY_LABEL, DOCUMENT_VISIBILITY_LABEL } from "@/lib/constants/status";
import { casePartnerId } from "@/lib/domain/legal-case";
import { formatDate } from "@/lib/formatting";
import { Can } from "@/components/layout/guards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/states";
import { useCan } from "@/features/auth/hooks";
import { useClientMap } from "@/features/processes/hooks";
import { useOffice } from "@/features/offices/hooks";
import type { ClientDocument, LegalCase } from "@/types";
import { usePartnerActions, usePartnerOffice, usePartnerRequests, useProcessMap } from "../hooks";
import { NewPartnerRequestDialog } from "./partner-dialogs";
import { PartnerRequestList } from "./request-list";

/**
 * Parceria no caso (ambiente interno): solicitações ao parceiro e documentos
 * com visibilidade. Documentos internos nunca chegam ao parceiro.
 */
export function CasePartnerPanel({ legalCase, documents }: { legalCase: LegalCase; documents: ClientDocument[] }) {
  // Solicitações e documentos vão ao parceiro com acesso operacional ao caso.
  const partner = usePartnerOffice(legalCase.partnerOrganizationId ?? undefined);
  const requests = usePartnerRequests({ legalCaseId: legalCase.id });
  const clientMap = useClientMap();
  const processMap = useProcessMap();
  const actions = usePartnerActions();
  const can = useCan();
  const [dialog, setDialog] = useState<"request" | null>(null);
  const [sharing, setSharing] = useState<ClientDocument | null>(null);

  if (!partner) return null;

  return (
    <>
      <Panel>
        <PanelHeader
          title="Solicitações ao parceiro"
          description={`Pedidos de documentos e informações para ${partner.name}.`}
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

      <Panel>
        <PanelHeader title="Visibilidade para o parceiro" description="Documentos internos nunca chegam ao parceiro. Disponibilize apenas versões aprovadas." />
        {documents.length === 0 ? (
          <EmptyState compact icon={FileText} title="Nenhum documento neste caso." />
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

      {dialog === "request" && (
        <NewPartnerRequestDialog partnerOfficeId={partner.id} clientId={legalCase.clientId} legalCaseId={legalCase.id} open onOpenChange={(o) => !o && setDialog(null)} />
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
    </>
  );
}

/** "Origem do caso" (interno): Bárbara Cardoso Advocacia ou o parceiro, com link. */
export function CaseOriginTag({ legalCase }: { legalCase: LegalCase }) {
  const office = useOffice();
  const partner = usePartnerOffice(casePartnerId(legalCase, office.id));
  if (!partner) return <span>Origem do caso: {office.name}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Handshake className="size-3.5 text-gold-600" aria-hidden />
      Origem do caso:{" "}
      <Link href={`/parceiros/${partner.id}`} className="font-medium text-navy hover:underline underline-offset-2">
        {partner.name}
      </Link>
    </span>
  );
}
