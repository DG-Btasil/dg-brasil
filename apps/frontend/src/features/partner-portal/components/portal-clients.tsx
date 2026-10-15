"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Briefcase, Pencil, Plus, Scale, UserPlus, Users } from "lucide-react";
import { CLIENT_KIND_LABEL, CLIENT_STATUS_LABEL, PARTNER_CASE_STATUS_LABEL } from "@/lib/constants/status";
import { formatEventTime, formatPhone, maskCNPJ, maskCPF, pluralize } from "@/lib/formatting";
import { callAction, mapFieldErrors, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { isPhoneFormat, msg } from "@/lib/validation";
import { Can, PageContainer } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/display";
import { Field, Input, MaskedInput } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { listClientsAction, updateClientBasicsAction } from "@/server/domain/clients/actions";
import type { ClientListItem, ClientPartnerDTO, PartnerClientCounts } from "@/server/domain/clients/dto";
import type { CaseListItem } from "@/server/domain/cases/dto";
import type { DocumentListItem } from "@/server/domain/documents/dto";
import type { ProcessListItem } from "@/server/domain/processes/dto";
import { useToast } from "@/store/ui-store";
import { useOrganizationNames, useOrgDirectory } from "@/features/directory/directory-context";
import { AddressFields } from "@/features/clients/components/form/address-fields";
import { addressSchema, fromAddress } from "@/features/clients/schemas";
import { addressToServer } from "@/features/clients/server-input";
import { CaseListTable } from "@/features/cases/components/case-list-table";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import { ProcessListTable } from "@/features/processes/components/process-list-table";
import { portalClientInput, type PortalListQuery } from "../list-query";
import { PortalServerList } from "./portal-list";

const maskDocument = (kind: ClientListItem["kind"], document: string) => (kind === "INDIVIDUAL" ? maskCPF(document) : maskCNPJ(document));
const partnerClientName = (c: ClientPartnerDTO) => (c.kind === "INDIVIDUAL" ? c.fullName : c.legalName);

const newClientCta = (
  <Can permission="partnerPortal.clients.create">
    <ButtonLink href="/clientes/novo" icon={<UserPlus className="size-4" aria-hidden />}>
      Novo cliente
    </ButtonLink>
  </Can>
);

/** Clientes do escritório parceiro (RLS: só relacionamentos ativos do próprio escritório). */
export function PortalClientList({ initialQuery, initialResult }: { initialQuery: PortalListQuery; initialResult: ActionResult<Page<ClientListItem>> }) {
  return (
    <PortalServerList
      title="Clientes"
      description="Clientes do seu escritório enviados à Bárbara Cardoso Advocacia."
      cta={newClientCta}
      initialQuery={initialQuery}
      initialResult={initialResult}
      load={(q) => listClientsAction(portalClientInput(q))}
      noun={{ one: "cliente", many: "clientes" }}
      searchLabel="Buscar por nome ou CPF/CNPJ"
      empty={{ icon: Users, title: "Nenhum cliente ainda.", description: "Cadastre um cliente para enviar o primeiro caso." }}
      errorTitle="Não foi possível carregar os clientes."
    >
      {(rows) => (
        <Table caption="Clientes do escritório parceiro">
          <THead>
            <tr>
              <Th>Cliente</Th>
              <Th>Tipo</Th>
              <Th>CPF/CNPJ</Th>
              <Th className="text-right">Casos</Th>
              <Th className="text-right">Processos</Th>
              <Th>Pendências</Th>
              <Th>Situação</Th>
              <Th>Atualização</Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <Link href={`/clientes/${c.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                    {c.name}
                  </Link>
                  {c.tradeName && <span className="block text-[12px] text-muted">{c.tradeName}</span>}
                </Td>
                <Td className="text-[12.5px]">{CLIENT_KIND_LABEL[c.kind]}</Td>
                <Td className="font-mono text-[12px]">{maskDocument(c.kind, c.document)}</Td>
                <Td className="text-right tabular">{c.partnerCounts?.cases ?? "—"}</Td>
                <Td className="text-right tabular">{c.partnerCounts?.processes ?? "—"}</Td>
                <Td>
                  <PendingBadge counts={c.partnerCounts} />
                </Td>
                <Td className="text-[12.5px]">{CLIENT_STATUS_LABEL[c.status] ?? c.status}</Td>
                <Td className="text-[12px] text-muted">{formatEventTime(c.updatedAt)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </PortalServerList>
  );
}

/* ------------------------------------------------------------------ */

/** Ficha do cliente no portal: só o cadastro básico que o vínculo autoriza (ClientPartnerDTO). */
export function PortalClientDetail({
  client,
  cases,
  processes,
  documents,
}: {
  client: ClientPartnerDTO;
  cases: ActionResult<Page<CaseListItem>>;
  processes: ActionResult<Page<ProcessListItem>>;
  documents: ActionResult<Page<DocumentListItem>>;
}) {
  const [editing, setEditing] = useState(false);
  const names = useOrganizationNames();
  const { owner } = useOrgDirectory();
  const name = partnerClientName(client);
  const a = client.address;

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Clientes", href: "/clientes" }, { label: name }]}
        title={name}
        meta={
          <>
            <Badge tone="navy">{CLIENT_KIND_LABEL[client.kind]}</Badge>
            <span className="font-mono">{client.kind === "INDIVIDUAL" ? maskCPF(client.cpf) : maskCNPJ(client.cnpj)}</span>
          </>
        }
        actions={
          <Can permission="partnerPortal.cases.create">
            <ButtonLink href={`/casos/novo?cliente=${client.id}`} icon={<Plus className="size-4" aria-hidden />}>
              Novo caso
            </ButtonLink>
          </Can>
        }
      />

      <div className="grid grid-cols-12 gap-5">
        <Panel className="col-span-12">
          <PanelHeader
            title="Dados de contato"
            actions={
              <Can permission="partnerPortal.clients.edit">
                <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" aria-hidden />} onClick={() => setEditing(true)}>
                  Editar
                </Button>
              </Can>
            }
          />
          <PanelBody>
            <DefinitionGrid
              columns={3}
              items={[
                { label: "E-mail", value: client.contact.email },
                { label: "Telefone", value: client.contact.phone ? formatPhone(client.contact.phone) : undefined },
                { label: "Situação", value: CLIENT_STATUS_LABEL[client.status] ?? client.status },
                {
                  label: "Endereço",
                  value: a?.street ? `${a.street}, ${a.number ?? "s/n"}${a.complement ? ` — ${a.complement}` : ""} · ${a.district ?? ""} · ${a.city ?? ""}/${a.state ?? ""}` : undefined,
                  wide: true,
                },
              ]}
            />
          </PanelBody>
        </Panel>

        <Panel className="col-span-12">
          <PanelHeader title="Casos" description="Casos do seu escritório para este cliente." />
          {!cases.ok ? (
            <ActionErrorState error={cases} title="Não foi possível carregar os casos." />
          ) : cases.data.items.length === 0 ? (
            <EmptyState compact icon={Briefcase} title="Nenhum caso seu para este cliente." />
          ) : (
            <CaseListTable
              rows={cases.data.items}
              showClient={false}
              showLawyer={false}
              statusLabels={PARTNER_CASE_STATUS_LABEL}
              lawyerName={() => undefined}
              originName={(id) => names.get(id)}
              ownerId={owner.id}
            />
          )}
        </Panel>

        <Panel className="col-span-12">
          <PanelHeader title="Processos" description="Somente os processos dos casos do seu escritório para este cliente." />
          {!processes.ok ? (
            <ActionErrorState error={processes} title="Não foi possível carregar os processos." />
          ) : processes.data.items.length === 0 ? (
            <EmptyState compact icon={Scale} title="Nenhum processo seu para este cliente." />
          ) : (
            <ProcessListTable rows={processes.data.items} showClient={false} />
          )}
        </Panel>

        <div className="col-span-12">
          <DocumentsPanel
            scope={{ clientId: client.id }}
            initial={documents}
            title="Documentos compartilhados"
            description="Documentos enviados por você e documentos que a Bárbara Cardoso Advocacia disponibilizou. Para enviar, abra o caso."
          />
        </div>
      </div>

      {editing && <EditBasicsDrawer client={client} onClose={() => setEditing(false)} />}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */

const basicsSchema = z.object({
  email: z.string().trim().refine((v) => !v || z.string().email().safeParse(v).success, msg.email),
  phone: z.string().trim().refine((v) => !v || isPhoneFormat(v), msg.phone),
  address: addressSchema,
});
type BasicsValues = z.infer<typeof basicsSchema>;

const FIELD_MAP: Record<string, string> = { "contact.email": "email", "contact.phone": "phone" };

/** Contato e endereço (updateClientBasicsAction). Fica registrado na auditoria. */
function EditBasicsDrawer({ client, onClose }: { client: ClientPartnerDTO; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const form = useForm<BasicsValues>({
    resolver: zodResolver(basicsSchema),
    defaultValues: { email: client.contact.email ?? "", phone: client.contact.phone ?? "", address: fromAddress(client.address) },
  });
  const {
    register,
    setError,
    formState: { errors, isSubmitting },
  } = form;
  const onSubmit = form.handleSubmit(async (v) => {
    // Texto vazio = apagar (o servidor converte em null); endereço vazio = remover.
    const result = await callAction(() =>
      updateClientBasicsAction({ id: client.id, contact: { email: v.email, phone: v.phone }, address: addressToServer(v.address) ?? null }),
    );
    if (!result.ok) {
      const fields = mapFieldErrors(result.error.fieldErrors, FIELD_MAP);
      for (const [path, message] of Object.entries(fields)) setError(path as keyof BasicsValues, { message });
      if (Object.keys(fields).length === 0) failed(result, "Não foi possível salvar.");
      return;
    }
    toast({ tone: "success", title: "Dados atualizados" });
    onClose();
    router.refresh();
  });
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && !isSubmitting && onClose()}
      width={680}
      title="Editar dados de contato"
      description="Alterações ficam registradas e são vistas pela Bárbara Cardoso Advocacia."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} loading={isSubmitting}>
            Salvar
          </Button>
        </>
      }
    >
      <FormProvider {...form}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label="E-mail" requirement="recommended" error={errors.email?.message}>
            {(p) => <Input {...p} type="email" {...register("email")} />}
          </Field>
          <Field label="Telefone" requirement="recommended" error={errors.phone?.message}>
            {(p) => <MaskedInput mask="phone" {...p} {...register("phone")} />}
          </Field>
          <div className="-mx-1 [&_section]:grid-cols-1 [&_section]:gap-4 [&_section]:border-b-0 [&_section]:py-2">
            <AddressFields description="Endereço do cliente." />
          </div>
        </form>
      </FormProvider>
    </Drawer>
  );
}

/** Pendências do escopo do escritório: solicitações em aberto + documentos pedidos (como no Front V1). */
function PendingBadge({ counts }: { counts?: PartnerClientCounts }) {
  const total = counts ? counts.openRequests + counts.requestedDocuments : 0;
  if (!counts || total === 0) return <span className="text-[12px] text-subtle">—</span>;
  const detail = [
    counts.openRequests ? pluralize(counts.openRequests, "solicitação aberta", "solicitações abertas") : null,
    counts.requestedDocuments ? pluralize(counts.requestedDocuments, "documento pedido", "documentos pedidos") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Badge tone="warning" title={detail}>
      {pluralize(total, "pendência", "pendências")}
    </Badge>
  );
}
