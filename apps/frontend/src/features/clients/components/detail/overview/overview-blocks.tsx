"use client";

import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Can } from "@/components/layout/guards";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { ACQUISITION_CHANNEL_LABEL, GENDER_LABEL, GENDER_NOT_INFORMED, ID_DOCUMENT_TYPE_LABEL, MARITAL_STATUS_LABEL } from "@/lib/constants/legal";
import { CLIENT_KIND_LABEL, CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE } from "@/lib/constants/status";
import { formatCEP, formatDate, formatDateTime, formatPhone } from "@/lib/formatting";
import { useOrganizationName } from "@/features/directory/directory-context";
import type { Client, CompanyClient, IndividualClient } from "@/types";
import { clientDocumentLabel, countryLabel, maskClientDocument } from "../../../utils";

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
    { label: "Profissão", value: c.profession },
    ...(c.gender ? [{ label: "Gênero", value: GENDER_LABEL[c.gender] ?? GENDER_NOT_INFORMED }] : []),
  ];
}

function companyIdentification(c: CompanyClient) {
  return [
    { label: "Razão social", value: c.legalName },
    { label: "Nome fantasia", value: c.tradeName },
    { label: "CNPJ", value: <span className="tabular">{maskClientDocument(c)}</span> },
    { label: "Data de abertura", value: c.openingDate ? formatDate(c.openingDate) : undefined },
    { label: "Natureza jurídica", value: c.legalNature },
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
          { label: client.kind === "INDIVIDUAL" ? "Telefone principal" : "Telefone", value: c.phone ? <span className="tabular">{formatPhone(c.phone)}</span> : undefined },
          ...(client.kind === "INDIVIDUAL"
            ? [{ label: "Telefone secundário / WhatsApp", value: c.secondaryPhone ? <span className="tabular">{formatPhone(c.secondaryPhone)}</span> : undefined }]
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
            { label: "CEP", value: a.zipCode ? <span className="tabular">{formatCEP(a.zipCode)}</span> : undefined },
            { label: "País", value: countryLabel(a.country) },
          ]}
        />
      ) : (
        <p className="text-[13px] text-muted">Endereço não informado.</p>
      )}
    </Block>
  );
}

/** Situação e de onde o cliente veio (escritório de origem + canal). Sem "responsável": advogado responde por caso/processo. */
export function ResponsibleBlock({ client }: { client: Client }) {
  const origin = useOrganizationName(client.originOfficeId);
  return (
    <Block title="Origem e situação" clientId={client.id}>
      <DefinitionGrid
        items={[
          { label: "Situação", value: <StatusBadge status={client.status} labels={CLIENT_STATUS_LABEL} tones={CLIENT_STATUS_TONE} /> },
          { label: "Escritório de origem", value: origin },
          { label: "Canal (como chegou)", value: client.acquisitionChannel ? ACQUISITION_CHANNEL_LABEL[client.acquisitionChannel] : undefined },
          ...(client.acquisitionDetail ? [{ label: "Detalhe do canal", value: client.acquisitionDetail }] : []),
          { label: "Tipo", value: CLIENT_KIND_LABEL[client.kind] },
          { label: `Identificador (${clientDocumentLabel(client)})`, value: <span className="tabular">{maskClientDocument(client)}</span> },
          { label: "Cadastrado em", value: formatDateTime(client.createdAt) },
          { label: "Última atualização", value: formatDateTime(client.updatedAt) },
        ]}
      />
    </Block>
  );
}
