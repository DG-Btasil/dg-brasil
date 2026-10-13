"use client";

import { useState } from "react";
import { FilePlus2, FolderPlus, Pencil } from "lucide-react";
import { Can } from "@/components/layout/guards";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Avatar, Breadcrumbs } from "@/components/ui/display";
import { CLIENT_KIND_LABEL, CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE } from "@/lib/constants/status";
import { formatEventTime } from "@/lib/formatting";
import { useDirectoryUser, useOrganizationName } from "@/features/directory/directory-context";
import { CLIENT_INACTIVATION_REASON_LABEL, type Client } from "@/types";
import { clientDisplayName, clientDocumentLabel, clientSecondaryName, clientShortName, formatClientDocument, maskClientDocument } from "../../utils";
import { DocumentAddDialog } from "./documents/document-add-dialog";
import { MaskedIdentifier } from "./masked-identifier";

export function ClientHeader({ client }: { client: Client }) {
  const responsible = useDirectoryUser(client.responsibleUserId);
  const [addOpen, setAddOpen] = useState(false);
  const secondary = clientSecondaryName(client);

  return (
    <header className="mb-5">
      <Breadcrumbs items={[{ label: "Clientes", href: "/clientes" }, { label: clientShortName(client) }]} />
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">{clientDisplayName(client)}</h1>
            <Badge tone="navy">{CLIENT_KIND_LABEL[client.kind]}</Badge>
            <StatusBadge status={client.status} labels={CLIENT_STATUS_LABEL} tones={CLIENT_STATUS_TONE} />
          </div>
          {secondary && (
            <p className="mt-0.5 text-[13px] text-muted">
              {client.kind === "INDIVIDUAL" ? "Nome social: " : "Nome fantasia: "}
              {secondary}
            </p>
          )}
          {client.status === "INACTIVE" && (
            <p className="mt-1 text-[12.5px] text-muted">
              Cadastro inativo{client.inactivation ? ` desde ${formatEventTime(client.inactivation.at)}` : ""}
              {client.inactivation?.reason ? ` · ${CLIENT_INACTIVATION_REASON_LABEL[client.inactivation.reason]}` : ""}. Histórico preservado.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]">
            <MaskedIdentifier label={clientDocumentLabel(client)} masked={maskClientDocument(client)} full={formatClientDocument(client)} />
            <span className="inline-flex items-center gap-2">
              <span className="text-subtle">Responsável</span>
              {responsible ? (
                <>
                  <Avatar name={responsible.name} size="xs" />
                  <span className="text-foreground">{responsible.name}</span>
                </>
              ) : (
                <span className="text-muted">Não definido</span>
              )}
            </span>
            <span className="text-muted">
              <span className="text-subtle">Atualizado</span> {formatEventTime(client.updatedAt)}
            </span>
            <ClientCreatedBy client={client} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Can permission="clients.edit">
            <ButtonLink href={`/clientes/${client.id}/editar`} variant="secondary" icon={<Pencil className="size-4" aria-hidden />}>
              Editar cadastro
            </ButtonLink>
          </Can>
          <Can permission="documents.manage">
            <Button variant="secondary" icon={<FilePlus2 className="size-4" aria-hidden />} onClick={() => setAddOpen(true)}>
              Adicionar documento
            </Button>
            <DocumentAddDialog clientId={client.id} open={addOpen} onOpenChange={setAddOpen} />
          </Can>
          <Can permission="cases.edit">
            <ButtonLink href={`/casos/novo?cliente=${client.id}`} icon={<FolderPlus className="size-4" aria-hidden />}>
              Novo caso
            </ButtonLink>
          </Can>
        </div>
      </div>
    </header>
  );
}

/** Origem do cliente, discreta. Histórica: não define a origem dos processos. */
function ClientCreatedBy({ client }: { client: Client }) {
  const name = useOrganizationName(client.originOfficeId);
  if (!name) return null;
  return (
    <span className="text-muted">
      <span className="text-subtle">Origem</span> {name}
    </span>
  );
}
