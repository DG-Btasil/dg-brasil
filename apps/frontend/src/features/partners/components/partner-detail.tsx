"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Handshake, Pencil, Percent } from "lucide-react";
import { CLIENT_KIND_SHORT, CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE, PARTNER_OFFICE_STATUS_LABEL, PARTNER_OFFICE_STATUS_TONE } from "@/lib/constants/status";
import { formatCNPJ, formatDate, formatPhone, maskCNPJ, maskCPF } from "@/lib/formatting";
import { ROLE_LABEL } from "@/lib/permissions";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import type { PartnerAgreementShareDTO, PartnerFinanceDTO, TransferListItemDTO } from "@/server/domain/finance/dto";
import { PartnerShareView } from "@/features/finance/components/partner-share";
import type { ActionResult } from "@/lib/actions/result";
import { Can, PageContainer } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { PendingIntegration } from "@/components/feedback/pending-integration";
import { Callout, EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, PageHeader, Stat } from "@/components/ui/display";
import { Select } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import type { Page } from "@/server/core/pagination";
import type { CaseListItem } from "@/server/domain/cases/dto";
import type { ClientListItem } from "@/server/domain/clients/dto";
import type { OrganizationUserDTO, PartnerDetailDTO, PartnerStatsDTO } from "@/server/domain/organizations/dto";
import type { PartnerRequestListItem } from "@/server/domain/partner-requests/dto";
import type { ProcessListItem } from "@/server/domain/processes/dto";
import { useCan } from "@/features/auth/hooks";
import { CaseListTable } from "@/features/cases/components/case-list-table";
import { useDirectoryUserMap, useOrganizationNames, useOrgDirectory } from "@/features/directory/directory-context";
import { RequestsPanel } from "@/features/partner-requests/components/requests-panel";
import { ProcessListTable } from "@/features/processes/components/process-list-table";
import { usePartnerOfficeActions } from "../use-partner-office-actions";
import { ChangeShareDialog } from "./partner-dialogs";
import { PartnerEditDrawer } from "./partner-form";

const TAB_KEYS = ["visao-geral", "usuarios", "clientes", "casos", "processos", "financeiro", "atividade"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const STATUS_TARGETS = [
  { value: "ACTIVE", label: PARTNER_OFFICE_STATUS_LABEL.ACTIVE },
  { value: "SUSPENDED", label: PARTNER_OFFICE_STATUS_LABEL.SUSPENDED },
  { value: "INACTIVE", label: PARTNER_OFFICE_STATUS_LABEL.INACTIVE },
] as const;

type PageResult<T> = ActionResult<Page<T>>;

/**
 * Ficha do escritório parceiro (equipe interna), com dados do servidor.
 * ADMIN vê divisão, responsável e notas internas; LAWYER, só o cadastro.
 * Financeiro (ADMIN) lido do servidor; atividade entra na fase H.
 */
export function PartnerDetail({
  detail,
  stats,
  users,
  clients,
  cases,
  processes,
  requests,
  finance,
}: {
  detail: PartnerDetailDTO;
  stats: ActionResult<PartnerStatsDTO>;
  users: PageResult<OrganizationUserDTO>;
  clients: PageResult<ClientListItem>;
  cases: PageResult<CaseListItem>;
  processes: PageResult<ProcessListItem>;
  requests: PageResult<PartnerRequestListItem>;
  /** Só ADMIN (partners.finance.view + finance.view). */
  finance?: {
    summary: ActionResult<PartnerFinanceDTO>;
    shares: ActionResult<Page<PartnerAgreementShareDTO>>;
    transfers: ActionResult<Page<TransferListItemDTO>>;
  };
}) {
  const can = useCan();
  const [tab, setTab] = useUrlTab<TabKey>(TAB_KEYS, "visao-geral");
  const [dialog, setDialog] = useState<"edit" | "share" | null>(null);
  const partner = detail.partner;
  const admin = detail.access === "ADMIN" ? detail.partner : undefined;
  const total = <T,>(r: PageResult<T>) => (r.ok ? r.data.total : undefined);

  const tabs = useMemo(() => {
    const items: TabItem<TabKey>[] = [
      { key: "visao-geral", label: "Visão Geral" },
      { key: "usuarios", label: "Usuários", count: total(users) },
      { key: "clientes", label: "Clientes", count: total(clients) },
      { key: "casos", label: "Casos", count: total(cases) },
      { key: "processos", label: "Processos", count: total(processes) },
    ];
    if (can("partners.finance.view")) items.push({ key: "financeiro", label: "Financeiro" });
    items.push({ key: "atividade", label: "Atividade" });
    return items;
  }, [can, users, clients, cases, processes]);
  const active: TabKey = tabs.some((t) => t.key === tab) ? tab : "visao-geral";

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Parceiros", href: "/parceiros" }, { label: partner.name }]}
        eyebrow="Escritório parceiro"
        title={partner.name}
        meta={
          <>
            <StatusBadge status={partner.status} labels={PARTNER_OFFICE_STATUS_LABEL} tones={PARTNER_OFFICE_STATUS_TONE} />
            {admin?.responsibleName && <span>Responsável: {admin.responsibleName}</span>}
            {admin?.responsibleOab && (
              <span>
                OAB/{admin.oabState} {admin.responsibleOab}
              </span>
            )}
            <span>{admin?.activatedAt ? `Parceria desde ${formatDate(admin.activatedAt)}` : `Cadastrado em ${formatDate(partner.createdAt)}`}</span>
          </>
        }
        actions={
          admin && (
            <Can permission="partners.manage">
              <Button variant="secondary" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setDialog("edit")}>
                Editar dados
              </Button>
            </Can>
          )
        }
      />

      <Tabs items={tabs} value={active} onChange={setTab} label="Seções do parceiro" className="mb-5" />
      <TabPanel tabKey={active}>
        {active === "visao-geral" && <OverviewTab detail={detail} stats={stats} requests={requests} onShare={() => setDialog("share")} />}
        {active === "usuarios" && <UsersTab users={users} />}
        {active === "clientes" && <ClientsTab clients={clients} partnerId={partner.id} />}
        {active === "casos" && <CasesTab cases={cases} />}
        {active === "processos" && <ProcessesTab processes={processes} />}
        {active === "financeiro" && finance && (
          <PartnerShareView
            summary={finance.summary}
            shares={finance.shares}
            transfers={finance.transfers}
            manage={can("finance.manage") ? { partnerOrganizationId: partner.id } : undefined}
          />
        )}
        {active === "atividade" && <PendingIntegration description="A linha do tempo de auditoria do parceiro será conectada em uma próxima fase." />}
      </TabPanel>

      {admin && dialog === "edit" && <PartnerEditDrawer partner={admin} open onOpenChange={(o) => !o && setDialog(null)} />}
      {admin && dialog === "share" && <ChangeShareDialog partner={admin} open onOpenChange={(o) => !o && setDialog(null)} />}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */

function OverviewTab({
  detail,
  stats,
  requests,
  onShare,
}: {
  detail: PartnerDetailDTO;
  stats: ActionResult<PartnerStatsDTO>;
  requests: PageResult<PartnerRequestListItem>;
  onShare: () => void;
}) {
  const actions = usePartnerOfficeActions();
  const { owner } = useOrgDirectory();
  const can = useCan();
  const [saving, setSaving] = useState(false);
  const partner = detail.partner;
  const admin = detail.access === "ADMIN" ? detail.partner : undefined;
  const a = partner.address;
  const s = stats.ok ? stats.data : undefined;

  return (
    <div className="grid grid-cols-12 gap-5">
      <div className="col-span-12 grid grid-cols-4 gap-4">
        <Stat label="Clientes relacionados" value={s?.clients ?? "—"} icon={Handshake} />
        <Stat label="Casos ativos" value={s?.activeCases ?? "—"} />
        <Stat label="Casos novos aguardando" value={s?.newCases ?? "—"} tone={s?.newCases ? "gold" : "neutral"} />
        <Stat label="Pendências em aberto" value={s?.openRequests ?? "—"} tone={s?.openRequests ? "warning" : "neutral"} />
      </div>

      <Panel className="col-span-12 xl:col-span-7">
        <PanelHeader title="Dados cadastrais" />
        <PanelBody>
          <DefinitionGrid
            items={[
              { label: "Nome", value: partner.name },
              { label: "Razão social", value: partner.legalName },
              { label: "CNPJ", value: partner.cnpj ? formatCNPJ(partner.cnpj) : undefined },
              ...(admin ? [{ label: "Responsável", value: admin.responsibleName ? `${admin.responsibleName}${admin.responsibleOab ? ` · OAB/${admin.oabState} ${admin.responsibleOab}` : ""}` : undefined }] : []),
              { label: "E-mail", value: partner.email },
              { label: "Telefone", value: partner.phone ? formatPhone(partner.phone) : undefined },
              {
                label: "Endereço",
                value: a ? [`${a.street}${a.number ? `, ${a.number}` : ""}${a.complement ? ` — ${a.complement}` : ""}`, a.district, [a.city, a.state].filter(Boolean).join("/")].filter(Boolean).join(" · ") : undefined,
                wide: true,
              },
              ...(admin ? [{ label: "Observações internas", value: admin.notes, wide: true }] : []),
            ]}
          />
        </PanelBody>
      </Panel>

      <div className="col-span-12 space-y-5 xl:col-span-5">
        {admin ? (
          <Panel>
            <PanelHeader
              title="Divisão atual da parceria"
              description="Padrão para novos casos. Cada caso aceito guarda a própria divisão."
              actions={
                <Can permission="partners.manage">
                  <Button size="sm" variant="secondary" icon={<Percent className="size-3.5" aria-hidden />} onClick={onShare}>
                    Alterar
                  </Button>
                </Can>
              }
            />
            <PanelBody className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[12px] text-muted">Participação do parceiro</p>
                <p className="mt-1 font-serif text-[26px] text-navy tabular">{admin.partnershipPercentage}%</p>
              </div>
              <div>
                <p className="text-[12px] text-muted">Participação {owner.name}</p>
                <p className="mt-1 font-serif text-[26px] text-navy tabular">{admin.ownerPercentage}%</p>
              </div>
            </PanelBody>
          </Panel>
        ) : (
          <Callout tone="neutral">A divisão da parceria é visível apenas ao Administrador.</Callout>
        )}
        {can("partners.manage") && partner.status !== "PENDING_INVITE" && (
          <Panel>
            <PanelHeader title="Situação da parceria" />
            <PanelBody className="flex items-center gap-3">
              <Select
                aria-label="Situação da parceria"
                value={partner.status}
                disabled={saving}
                options={STATUS_TARGETS}
                onChange={async (e) => {
                  setSaving(true);
                  await actions.setStatus(partner.id, e.target.value as (typeof STATUS_TARGETS)[number]["value"]);
                  setSaving(false);
                }}
                className="w-[220px]"
              />
              <p className="text-[12px] text-muted">Parceiros inativos ou suspensos não acessam o portal.</p>
            </PanelBody>
          </Panel>
        )}
        {partner.status === "PENDING_INVITE" && (
          <Callout tone="info" title="Aguardando o primeiro acesso">
            A parceria é ativada quando o administrador do parceiro aceita o convite (Configurações → Equipe).
          </Callout>
        )}
      </div>

      <div className="col-span-12">
        <RequestsPanel
          scope={{ partnerOrganizationId: partner.id }}
          initial={requests}
          title="Solicitações ao parceiro"
          description="Pendências enviadas pela equipe, por caso. O parceiro responde pelo portal."
          newRequest={{ partnerOrganizationId: partner.id }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Integrantes REAIS do escritório parceiro (leitura). A gestão fica em Configurações → Equipe. */
function UsersTab({ users }: { users: PageResult<OrganizationUserDTO> }) {
  if (!users.ok) return <ActionErrorState error={users} title="Não foi possível carregar os usuários." />;
  return (
    <Panel>
      <PanelHeader title="Usuários do parceiro" description="Convites, papéis e bloqueios são feitos em Configurações → Equipe, escolhendo o escritório." />
      {users.data.items.length === 0 ? (
        <EmptyState compact title="Nenhum usuário ativo." />
      ) : (
        <Table caption="Usuários do parceiro">
          <THead>
            <tr>
              <Th>Usuário</Th>
              <Th>Papel</Th>
              <Th>Desde</Th>
            </tr>
          </THead>
          <TBody>
            {users.data.items.map((u) => (
              <Tr key={u.membershipId}>
                <Td>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={u.name} size="sm" tone="neutral" />
                    <div>
                      <div className="font-medium text-foreground">{u.name}</div>
                      {u.jobTitle && <div className="text-[12px] text-muted">{u.jobTitle}</div>}
                    </div>
                  </div>
                </Td>
                <Td className="text-[12.5px]">{ROLE_LABEL[u.role]}</Td>
                <Td className="text-[12px] text-muted">{u.joinedAt ? formatDate(u.joinedAt) : "—"}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}

function ClientsTab({ clients, partnerId }: { clients: PageResult<ClientListItem>; partnerId: string }) {
  if (!clients.ok) return <ActionErrorState error={clients} title="Não foi possível carregar os clientes." />;
  const { items, total } = clients.data;
  return (
    <Panel>
      <PanelHeader title="Clientes relacionados" description={total > items.length ? `Mostrando ${items.length} de ${total}.` : "Clientes com vínculo ativo com este parceiro."} />
      {items.length === 0 ? (
        <EmptyState compact title="Nenhum cliente relacionado." />
      ) : (
        <Table caption="Clientes do parceiro">
          <THead>
            <tr>
              <Th>Cliente</Th>
              <Th>Tipo</Th>
              <Th>CPF/CNPJ</Th>
              <Th>Situação</Th>
              <Th>Origem do cadastro</Th>
            </tr>
          </THead>
          <TBody>
            {items.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <Link href={`/clientes/${c.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                    {c.name}
                  </Link>
                </Td>
                <Td className="text-[12.5px]">{CLIENT_KIND_SHORT[c.kind]}</Td>
                <Td className="font-mono text-[12px]">{c.kind === "INDIVIDUAL" ? maskCPF(c.document) : maskCNPJ(c.document)}</Td>
                <Td>
                  <StatusBadge status={c.status} labels={CLIENT_STATUS_LABEL} tones={CLIENT_STATUS_TONE} />
                </Td>
                <Td className="text-[12.5px] text-muted">{c.originOrganizationId === partnerId ? "Este parceiro" : "Outro escritório"}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}

function CasesTab({ cases }: { cases: PageResult<CaseListItem> }) {
  const users = useDirectoryUserMap();
  const names = useOrganizationNames();
  const { owner } = useOrgDirectory();
  if (!cases.ok) return <ActionErrorState error={cases} title="Não foi possível carregar os casos." />;
  const { items, total } = cases.data;
  return (
    <Panel>
      <PanelHeader title="Casos do parceiro" description={total > items.length ? `Mostrando ${items.length} de ${total}. Veja todos em Casos.` : "Casos com origem neste parceiro ou operados por ele."} />
      {items.length === 0 ? (
        <EmptyState compact title="Nenhum caso deste parceiro." />
      ) : (
        <CaseListTable rows={items} lawyerName={(id) => (id ? users.get(id)?.name : undefined)} originName={(id) => names.get(id)} ownerId={owner.id} />
      )}
    </Panel>
  );
}

function ProcessesTab({ processes }: { processes: PageResult<ProcessListItem> }) {
  if (!processes.ok) return <ActionErrorState error={processes} title="Não foi possível carregar os processos." />;
  const { items, total } = processes.data;
  return (
    <Panel>
      <PanelHeader title="Processos dos casos do parceiro" description={total > items.length ? `Mostrando ${items.length} de ${total}.` : "A origem é do caso — independe de quem cadastrou o cliente."} />
      {items.length === 0 ? <EmptyState compact title="Nenhum processo originado por este parceiro." /> : <ProcessListTable rows={items} />}
    </Panel>
  );
}
