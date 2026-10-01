"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Briefcase, FilePlus2, Pencil, Plus, SearchX, UserPlus, Users } from "lucide-react";
import { CLIENT_KIND_LABEL, DOCUMENT_CATEGORY_LABEL, PARTNER_CASE_STATUS_LABEL, PROCESS_STATUS_LABEL, PROCESS_STATUS_TONE } from "@/lib/constants/status";
import { formatDate, formatEventTime, formatPhone, pluralize } from "@/lib/formatting";
import { msg } from "@/lib/validation";
import { Can, PageContainer } from "@/components/layout/guards";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/display";
import { Field, Input, MaskedInput, SearchInput } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/states";
import { AddressFields } from "@/features/clients/components/form/address-fields";
import { addressSchema, fromAddress, toAddress } from "@/features/clients/schemas";
import { maskClientDocument } from "@/features/clients/utils";
import { clientDisplayName } from "@/features/processes/utils";
import { isPhoneFormat } from "@/lib/validation";
import type { Client } from "@/types";
import { useCurrentDocuments, usePortalActions, usePortalClientMap, usePortalClientRows, usePortalProcesses } from "../hooks";
import { useCaseMap, useCaseRows } from "@/features/cases/hooks";
import { CaseTable } from "@/features/cases/components/case-table";
import { SendDocumentDialog } from "./portal-dialogs";

function normalize(v: string) {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Clientes do escritório parceiro. */
export function PortalClientList() {
  const rows = usePortalClientRows();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = normalize(q.trim());
    return rows.filter((r) => !term || normalize(r.name).includes(term)).sort((a, b) => b.lastUpdate.localeCompare(a.lastUpdate));
  }, [rows, q]);

  const cta = (
    <Can permission="partnerPortal.clients.create">
      <ButtonLink href="/clientes/novo" icon={<UserPlus className="size-4" aria-hidden />}>
        Novo cliente
      </ButtonLink>
    </Can>
  );

  return (
    <PageContainer>
      <PageHeader title="Clientes" description="Clientes do seu escritório enviados à Bárbara Cardoso Advocacia." actions={cta} />
      {rows.length === 0 ? (
        <Panel>
          <EmptyState icon={Users} title="Nenhum cliente ainda." description="Cadastre um cliente para enviar o primeiro caso." action={cta} />
        </Panel>
      ) : (
        <Panel>
          <div className="flex items-center gap-3 border-b border-line px-5 py-3">
            <SearchInput aria-label="Buscar clientes" placeholder="Buscar por nome" value={q} onChange={(e) => setQ(e.target.value)} className="w-[320px]" />
            <span className="text-[12.5px] text-muted">{pluralize(filtered.length, "cliente", "clientes")}</span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon={SearchX} title="Nenhum cliente encontrado." />
          ) : (
            <Table caption="Clientes do escritório parceiro">
              <THead>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Tipo</Th>
                  <Th>CPF/CNPJ</Th>
                  <Th className="text-right">Processos</Th>
                  <Th>Pendências</Th>
                  <Th>Atualização</Th>
                </tr>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <Tr key={r.client.id}>
                    <Td>
                      <Link href={`/clientes/${r.client.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                        {r.name}
                      </Link>
                    </Td>
                    <Td className="text-[12.5px]">{CLIENT_KIND_LABEL[r.client.kind]}</Td>
                    <Td className="font-mono text-[12px]">{maskClientDocument(r.client)}</Td>
                    <Td className="text-right tabular">{r.activeProcesses}</Td>
                    <Td>{r.openRequests ? <Badge tone="warning">{pluralize(r.openRequests, "pendência", "pendências")}</Badge> : <span className="text-[12px] text-subtle">—</span>}</Td>
                    <Td className="text-[12px] text-muted">{formatEventTime(r.lastUpdate)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>
      )}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */

/** Ficha do cliente no portal: apenas o que o vínculo do parceiro autoriza. */
export function PortalClientDetail({ id }: { id: string }) {
  const clientMap = usePortalClientMap();
  const client = clientMap.get(id);
  const allProcesses = usePortalProcesses();
  const processes = useMemo(() => allProcesses.filter((p) => p.clientId === id), [allProcesses, id]);
  const documents = useCurrentDocuments({ clientId: id });
  const caseMap = useCaseMap();
  const allCases = useCaseRows();
  const cases = useMemo(() => allCases.filter((r) => r.legalCase.clientId === id), [allCases, id]);
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);

  // Cliente sem vínculo com o parceiro (ou inexistente): o estado recortado não o contém.
  if (!client) {
    return (
      <PageContainer>
        <Panel className="mt-6">
          <EmptyState
            icon={SearchX}
            title="Cliente não encontrado."
            description="O endereço pode estar incorreto ou este cliente não está vinculado ao seu escritório."
            action={<ButtonLink href="/clientes" variant="secondary">Voltar para Clientes</ButtonLink>}
          />
        </Panel>
      </PageContainer>
    );
  }

  const a = client.address;
  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Clientes", href: "/clientes" }, { label: clientDisplayName(client) }]}
        title={clientDisplayName(client)}
        meta={
          <>
            <Badge tone="navy">{CLIENT_KIND_LABEL[client.kind]}</Badge>
            <span className="font-mono">{maskClientDocument(client)}</span>
          </>
        }
        actions={
          <>
            <Can permission="partnerPortal.documents.submit">
              <Button variant="secondary" icon={<FilePlus2 className="size-4" aria-hidden />} onClick={() => setSending(true)}>
                Enviar documento
              </Button>
            </Can>
            <Can permission="partnerPortal.cases.create">
              <ButtonLink href={`/casos/novo?cliente=${client.id}`} icon={<Plus className="size-4" aria-hidden />}>
                Novo caso
              </ButtonLink>
            </Can>
          </>
        }
      />

      <div className="grid grid-cols-12 gap-5">
        <Panel className="col-span-12 xl:col-span-6">
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
              items={[
                { label: "E-mail", value: client.contact.email },
                { label: "Telefone", value: client.contact.phone ? formatPhone(client.contact.phone) : undefined },
                { label: "Endereço", value: a ? `${a.street}, ${a.number}${a.complement ? ` — ${a.complement}` : ""} · ${a.district} · ${a.city}/${a.state}` : undefined, wide: true },
              ]}
            />
          </PanelBody>
        </Panel>

        <Panel className="col-span-12 xl:col-span-6">
          <PanelHeader title="Documentos enviados" description="Documentos do seu escritório e documentos aprovados disponibilizados a você." />
          {documents.length === 0 ? (
            <EmptyState compact title="Nenhum documento." />
          ) : (
            <ul className="divide-y divide-line">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-foreground">{d.name}</p>
                    <p className="text-[12px] text-muted">
                      {DOCUMENT_CATEGORY_LABEL[d.category]} · {d.uploadedAt ? formatDate(d.uploadedAt) : "—"}
                      {d.version && d.version > 1 ? ` · v${d.version}` : ""}
                    </p>
                  </div>
                  {d.uploadedByPartnerOfficeId ? <Badge tone="neutral">Enviado por você</Badge> : <Badge tone="success">Documento aprovado</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="col-span-12">
          <PanelHeader title="Casos" description="Casos do seu escritório para este cliente." />
          {cases.length === 0 ? (
            <EmptyState compact icon={Briefcase} title="Nenhum caso seu para este cliente." />
          ) : (
            <CaseTable rows={cases} statusLabels={PARTNER_CASE_STATUS_LABEL} showLawyer={false} />
          )}
        </Panel>

        <Panel className="col-span-12">
          <PanelHeader title="Processos" description="Somente os processos dos casos do seu escritório para este cliente." />
          {processes.length === 0 ? (
            <EmptyState compact icon={Briefcase} title="Nenhum processo seu para este cliente." />
          ) : (
            <Table caption="Processos do cliente">
              <THead>
                <tr>
                  <Th>Processo</Th>
                  <Th>Status</Th>
                  <Th>Caso</Th>
                  <Th>Atualização</Th>
                </tr>
              </THead>
              <TBody>
                {processes.map((p) => {
                  const legalCase = caseMap.get(p.legalCaseId);
                  return (
                    <Tr key={p.id}>
                      <Td>
                        <Link href={`/processos/${p.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                          {p.title}
                        </Link>
                        <div className="text-[12px] text-muted">{p.cnj ?? "Sem número CNJ"}</div>
                      </Td>
                      <Td>
                        <StatusBadge status={p.status} labels={PROCESS_STATUS_LABEL} tones={PROCESS_STATUS_TONE} />
                      </Td>
                      <Td>
                        {legalCase ? (
                          <Link href={`/casos/${legalCase.id}`} className="text-[12.5px] text-navy hover:underline underline-offset-2">
                            {legalCase.title}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td className="text-[12px] text-muted">{formatEventTime(p.lastMovementAt ?? p.updatedAt)}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Panel>
      </div>

      {editing && <EditBasicsDrawer client={client} open onOpenChange={(o) => !o && setEditing(false)} />}
      {sending && <SendDocumentDialog clientId={client.id} open onOpenChange={(o) => !o && setSending(false)} />}
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

/** Edição de dados básicos (contato e endereço). Fica registrada na auditoria. */
function EditBasicsDrawer({ client, open, onOpenChange }: { client: Client; open: boolean; onOpenChange: (o: boolean) => void }) {
  const actions = usePortalActions();
  const form = useForm<BasicsValues>({
    resolver: zodResolver(basicsSchema),
    defaultValues: { email: client.contact.email ?? "", phone: client.contact.phone ?? "", address: fromAddress(client.address) },
  });
  const {
    register,
    formState: { errors, isSubmitting },
  } = form;
  const onSubmit = form.handleSubmit(async (v) => {
    const ok = await actions.updateClientBasics(client.id, {
      contact: { ...client.contact, email: v.email || undefined, phone: v.phone || undefined },
      address: toAddress(v.address),
    });
    if (ok !== null) onOpenChange(false);
  });
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width={680}
      title="Editar dados de contato"
      description="Alterações ficam registradas e são vistas pela Bárbara Cardoso Advocacia."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
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
