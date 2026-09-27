"use client";

import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Can } from "@/components/layout/guards";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/display";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { ID_DOCUMENT_TYPE_LABEL, MARITAL_STATUS_LABEL } from "@/lib/constants/legal";
import { CLIENT_KIND_LABEL, CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE } from "@/lib/constants/status";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { useUser } from "@/features/offices/hooks";
import type { Client, CompanyClient, IndividualClient } from "@/types";
import { clientDocumentLabel, maskClientDocument } from "../../../utils";

export function Block({ title, clientId, children, editable = true }: { title: string; clientId: string; children: ReactNode; editable?: boolean }) {
  return (
    <Panel>
      <PanelHeader
        title={title}
        as="h3"
        actions={
          editable ? (
            <Can permission="clients.edit">
              <ButtonLink href={`/clientes/${clientId}/editar`} variant="ghost" size="sm" icon={<Pencil className="size-3.5" aria-hidden />} aria-label={`Editar ${title.toLowerCase()}`}>
                Editar
              </ButtonLink>
            </Can>
          ) : undefined
        }
      />
      <PanelBody>{children}</PanelBody>
    </Panel>
  );
}

function individualIdentification(c: IndividualClient) {
  const id = c.identityDocument;
  return [
    { label: "Nome completo", value: c.fullName },
    { label: "Nome social", value: c.socialName },
    { label: "CPF", value: <span className="tabular">{maskClientDocument(c)}</span> },
    {
      label: "Documento de identidade",
      value: id ? `${ID_DOCUMENT_TYPE_LABEL[id.type]} ${id.number}${id.issuer ? ` · ${id.issuer}` : ""}${id.state ? `/${id.state}` : ""}` : undefined,
    },
    { label: "Data de nascimento", value: c.birthDate ? formatDate(c.birthDate) : undefined },
    { label: "Nacionalidade", value: c.nationality },
    { label: "Naturalidade", value: c.birthplace },
    { label: "Estado civil", value: c.maritalStatus ? MARITAL_STATUS_LABEL[c.maritalStatus] : undefined },
    ...(c.maritalStatus !== "MARRIED" && c.stableUnion !== undefined ? [{ label: "União estável", value: c.stableUnion ? "Sim" : "Não" }] : []),
    { label: "Profissão", value: c.profession },
    ...(c.gender ? [{ label: "Gênero", value: c.gender }] : []),
  ];
}

function companyIdentification(c: CompanyClient) {
  return [
    { label: "Razão social", value: c.legalName },
    { label: "Nome fantasia", value: c.tradeName },
    { label: "CNPJ", value: <span className="tabular">{maskClientDocument(c)}</span> },
    { label: "Situação cadastral", value: c.registrationStatus },
    { label: "Data de abertura", value: c.openingDate ? formatDate(c.openingDate) : undefined },
    { label: "Natureza jurídica", value: c.legalNature },
    { label: "CNAE principal", value: c.mainCnae, wide: true },
    ...(c.secondaryCnaes?.length ? [{ label: "CNAEs secundários", value: c.secondaryCnaes.join(" · "), wide: true }] : []),
  ];
}

export function IdentificationBlock({ client }: { client: Client }) {
  return (
    <Block title="Identificação" clientId={client.id}>
      <DefinitionGrid items={client.kind === "INDIVIDUAL" ? individualIdentification(client) : companyIdentification(client)} />
    </Block>
  );
}

export function ContactBlock({ client }: { client: Client }) {
  const c = client.contact;
  return (
    <Block title="Contato" clientId={client.id}>
      <DefinitionGrid
        items={[
          { label: "E-mail", value: c.email },
          { label: client.kind === "INDIVIDUAL" ? "Telefone principal" : "Telefone", value: c.phone ? <span className="tabular">{c.phone}</span> : undefined },
          ...(client.kind === "INDIVIDUAL"
            ? [{ label: "Telefone secundário / WhatsApp", value: c.secondaryPhone ? <span className="tabular">{c.secondaryPhone}</span> : undefined }]
            : [{ label: "Site", value: c.website }]),
        ]}
      />
    </Block>
  );
}

export function AddressBlock({ client }: { client: Client }) {
  const a = client.address;
  return (
    <Block title="Endereço" clientId={client.id}>
      {a ? (
        <DefinitionGrid
          items={[
            { label: "Logradouro", value: `${a.street}${a.number ? `, ${a.number}` : ""}${a.complement ? ` — ${a.complement}` : ""}`, wide: true },
            { label: "Bairro", value: a.district },
            { label: "Município/UF", value: [a.city, a.state].filter(Boolean).join("/") || undefined },
            { label: "CEP", value: a.zipCode ? <span className="tabular">{a.zipCode}</span> : undefined },
            { label: "País", value: a.country },
          ]}
        />
      ) : (
        <p className="text-[13px] text-muted">Endereço não informado.</p>
      )}
    </Block>
  );
}

export function ResponsibleBlock({ client }: { client: Client }) {
  const user = useUser(client.responsibleUserId);
  return (
    <Block title="Responsável e status" clientId={client.id}>
      <DefinitionGrid
        items={[
          {
            label: "Responsável",
            value: user ? (
              <span className="inline-flex items-center gap-2">
                <Avatar name={user.name} size="xs" />
                {user.name}
              </span>
            ) : undefined,
          },
          { label: "Status", value: <StatusBadge status={client.status} labels={CLIENT_STATUS_LABEL} tones={CLIENT_STATUS_TONE} /> },
          { label: "Tipo", value: CLIENT_KIND_LABEL[client.kind] },
          { label: `Identificador (${clientDocumentLabel(client)})`, value: <span className="tabular">{maskClientDocument(client)}</span> },
          { label: "Cadastrado em", value: formatDateTime(client.createdAt) },
          { label: "Última atualização", value: formatDateTime(client.updatedAt) },
        ]}
      />
    </Block>
  );
}
