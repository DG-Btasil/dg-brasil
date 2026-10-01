"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Handshake, MailPlus, MessageSquarePlus, Pencil, Percent, SearchX } from "lucide-react";
import {
  CLIENT_KIND_SHORT,
  CLIENT_STATUS_LABEL,
  CLIENT_STATUS_TONE,
  PARTNER_OFFICE_STATUS_LABEL,
  PARTNER_OFFICE_STATUSES,
  PARTNER_OFFICE_STATUS_TONE,
  PROCESS_STATUS_LABEL,
  PROCESS_STATUS_TONE,
  USER_STATUS_LABEL,
  USER_STATUS_TONE,
  type PartnerOfficeStatus,
} from "@/lib/constants/status";
import { formatCurrency, formatDate, formatEventTime, formatPhone } from "@/lib/formatting";
import { PARTNER_ROLES, ROLE_LABEL, type PartnerRole } from "@/lib/permissions";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import { Can, PageContainer } from "@/components/layout/guards";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Avatar, PageHeader, Stat, Timeline } from "@/components/ui/display";
import { Select } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { EmptyState } from "@/components/feedback/states";
import { useCan, useCurrentUser } from "@/features/auth/hooks";
import { useClientMap } from "@/features/processes/hooks";
import { clientDisplayName } from "@/features/processes/utils";
import { maskClientDocument } from "@/features/clients/utils";
import {
  usePartnerActions,
  usePartnerActivity,
  usePartnerClients,
  usePartnerFinancialSummary,
  usePartnerOffice,
  usePartnerProcesses,
  usePartnerRequests,
  usePartnershipViews,
  usePartnerCases,
  usePartnerUsers,
  useProcessMap,
} from "../hooks";
import { useCaseMap, useCaseRows } from "@/features/cases/hooks";
import { CaseTable } from "@/features/cases/components/case-table";
import { PartnershipAgreementsTable } from "./agreements-table";
import { ChangeShareDialog, InvitePartnerUserDialog, NewPartnerRequestDialog } from "./partner-dialogs";
import { PartnerEditDrawer } from "./partner-form";
import { PartnerRequestList } from "./request-list";

const TAB_KEYS = ["visao-geral", "usuarios", "clientes", "casos", "processos", "financeiro", "atividade"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const STATUS_OPTIONS = PARTNER_OFFICE_STATUSES.map((s) => ({ value: s, label: PARTNER_OFFICE_STATUS_LABEL[s] }));
const ROLE_OPTIONS = PARTNER_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

/** Detalhe do escritório parceiro (ambiente interno). */
export function PartnerDetail({ id }: { id: string }) {
  const partner = usePartnerOffice(id);
  const can = useCan();
  const [tab, setTab] = useUrlTab<TabKey>(TAB_KEYS, "visao-geral");
  const [dialog, setDialog] = useState<"edit" | "share" | "invite" | "request" | null>(null);
  const users = usePartnerUsers(id);
  const clients = usePartnerClients(id);
  const processes = usePartnerProcesses(id);
  const cases = usePartnerCases(id);
  const requests = usePartnerRequests({ partnerOfficeId: id });
  const openRequests = requests.filter((r) => r.status === "OPEN");

  const tabs = useMemo(() => {
    const items: TabItem<TabKey>[] = [
      { key: "visao-geral", label: "Visão Geral" },
      { key: "usuarios", label: "Usuários", count: users.length },
      { key: "clientes", label: "Clientes", count: clients.length },
      { key: "casos", label: "Casos", count: cases.length },
      { key: "processos", label: "Processos", count: processes.length },
    ];
    if (can("partners.finance.view")) items.push({ key: "financeiro", label: "Financeiro" });
    items.push({ key: "atividade", label: "Atividade" });
    return items;
  }, [can, users.length, clients.length, cases.length, processes.length]);

  if (!partner) {
    return (
      <PageContainer>
        <Panel className="mt-6">
          <EmptyState
            icon={SearchX}
            title="Parceiro não encontrado."
            description="O endereço pode estar incorreto ou você não tem acesso a este escritório."
            action={<ButtonLink href="/parceiros" variant="secondary">Voltar para Parceiros</ButtonLink>}
          />
        </Panel>
      </PageContainer>
    );
  }

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
            <span>Responsável: {partner.responsibleName}</span>
            <span>
              OAB/{partner.oabState} {partner.responsibleOab}
            </span>
            <span>Parceria desde {formatDate(partner.activatedAt ?? partner.createdAt)}</span>
          </>
        }
        actions={
          <>
            <Can permission="partnerRequests.manage">
              <Button variant="secondary" icon={<MessageSquarePlus className="size-4" aria-hidden />} onClick={() => setDialog("request")}>
                Nova solicitação
              </Button>
            </Can>
            <Can permission="partners.manage">
              <Button variant="secondary" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setDialog("edit")}>
                Editar dados
              </Button>
            </Can>
          </>
        }
      />

      <Tabs items={tabs} value={active} onChange={setTab} label="Seções do parceiro" className="mb-5" />
      <TabPanel tabKey={active}>
        {active === "visao-geral" && (
          <OverviewTab partnerId={id} openRequests={openRequests.length} onShare={() => setDialog("share")} clientCount={clients.length} processCount={processes.length} />
        )}
        {active === "usuarios" && <PartnerUsersPanel partnerId={id} onInvite={() => setDialog("invite")} />}
        {active === "clientes" && <ClientsTab partnerId={id} />}
        {active === "casos" && <CasesTab partnerId={id} />}
        {active === "processos" && <ProcessesTab partnerId={id} />}
        {active === "financeiro" && <FinanceTab partnerId={id} />}
        {active === "atividade" && <ActivityTab partnerId={id} />}
      </TabPanel>

      {dialog === "edit" && <PartnerEditDrawer partner={partner} open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === "share" && <ChangeShareDialog partner={partner} open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === "invite" && <InvitePartnerUserDialog partnerOfficeId={id} open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === "request" && (
        <NewPartnerRequestDialog
          partnerOfficeId={id}
          clientOptions={clients.map((c) => ({ value: c.id, label: clientDisplayName(c) }))}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      )}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */

function OverviewTab({
  partnerId,
  openRequests,
  clientCount,
  processCount,
  onShare,
}: {
  partnerId: string;
  openRequests: number;
  clientCount: number;
  processCount: number;
  onShare: () => void;
}) {
  const partner = usePartnerOffice(partnerId)!;
  const actions = usePartnerActions();
  const can = useCan();
  const requests = usePartnerRequests({ partnerOfficeId: partnerId }).filter((r) => r.status === "OPEN");
  const submitted = usePartnerCases(partnerId).filter((c) => c.status === "SUBMITTED");
  const clientMap = useClientMap();
  const processMap = useProcessMap();
  const a = partner.address;

  return (
    <div className="grid grid-cols-12 gap-5">
      <div className="col-span-12 grid grid-cols-4 gap-4">
        <Stat label="Clientes relacionados" value={clientCount} icon={Handshake} />
        <Stat label="Processos" value={processCount} />
        <Stat label="Casos novos aguardando" value={submitted.length} tone={submitted.length ? "gold" : "neutral"} />
        <Stat label="Pendências em aberto" value={openRequests} tone={openRequests ? "warning" : "neutral"} />
      </div>

      <Panel className="col-span-12 xl:col-span-7">
        <PanelHeader title="Dados cadastrais" />
        <PanelBody>
          <DefinitionGrid
            items={[
              { label: "Nome", value: partner.name },
              { label: "Razão social", value: partner.legalName },
              { label: "CNPJ", value: partner.cnpj },
              { label: "Responsável", value: `${partner.responsibleName} · OAB/${partner.oabState} ${partner.responsibleOab}` },
              { label: "E-mail", value: partner.email },
              { label: "Telefone", value: formatPhone(partner.phone) },
              { label: "Endereço", value: a ? `${a.street}, ${a.number}${a.complement ? ` — ${a.complement}` : ""} · ${a.district} · ${a.city}/${a.state}` : undefined, wide: true },
              { label: "Observações internas", value: partner.notes, wide: true },
            ]}
          />
        </PanelBody>
      </Panel>

      <div className="col-span-12 space-y-5 xl:col-span-5">
        <Panel>
          <PanelHeader
            title="Divisão atual da parceria"
            description="Padrão para novos casos. Cada caso guarda a própria divisão."
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
              <p className="mt-1 font-serif text-[26px] text-navy tabular">{partner.partnershipPercentage}%</p>
            </div>
            <div>
              <p className="text-[12px] text-muted">Participação Bárbara Cardoso Advocacia</p>
              <p className="mt-1 font-serif text-[26px] text-navy tabular">{partner.ownerPercentage}%</p>
            </div>
          </PanelBody>
        </Panel>
        {can("partners.manage") && (
          <Panel>
            <PanelHeader title="Situação da parceria" />
            <PanelBody className="flex items-center gap-3">
              <Select
                aria-label="Situação da parceria"
                value={partner.status}
                options={STATUS_OPTIONS}
                onChange={(e) => void actions.setStatus(partner.id, e.target.value as PartnerOfficeStatus)}
                className="w-[220px]"
              />
              <p className="text-[12px] text-muted">Parceiros inativos ou suspensos não acessam o portal.</p>
            </PanelBody>
          </Panel>
        )}
      </div>

      <Panel className="col-span-12">
        <PanelHeader title="Pendências com o parceiro" description="Solicitações em aberto enviadas pela equipe." />
        <PartnerRequestList
          requests={requests}
          clientMap={clientMap}
          processMap={processMap}
          emptyText="Nenhuma pendência em aberto com este parceiro."
          actions={(r) =>
            can("partnerRequests.manage") && (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => void actions.resolveRequest(r.id, "CANCELLED")}>
                  Cancelar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void actions.resolveRequest(r.id, "RESOLVED")}>
                  Marcar resolvida
                </Button>
              </div>
            )
          }
        />
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Usuários de um escritório parceiro (interno e "Minha Conta" do Partner Admin). */
export function PartnerUsersPanel({ partnerId, onInvite }: { partnerId: string; onInvite: () => void }) {
  const users = usePartnerUsers(partnerId);
  const actions = usePartnerActions();
  const can = useCan();
  const me = useCurrentUser();
  const manage = can("partners.manage") || can("partnerPortal.users.manage");
  return (
    <Panel>
      <PanelHeader
        title="Usuários do parceiro"
        description="Administrador do parceiro vê a participação financeira; usuário do parceiro não."
        actions={
          manage && (
            <Button size="sm" icon={<MailPlus className="size-3.5" aria-hidden />} onClick={onInvite}>
              Convidar
            </Button>
          )
        }
      />
      {users.length === 0 ? (
        <EmptyState compact title="Nenhum usuário." />
      ) : (
        <Table caption="Usuários do parceiro">
          <THead>
            <tr>
              <Th>Usuário</Th>
              <Th>Papel</Th>
              <Th>Situação</Th>
              <Th>Último acesso</Th>
              <Th>
                <span className="sr-only">Ações</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {users.map((u) => {
              const self = u.id === me?.id;
              return (
                <Tr key={u.id}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.name} size="sm" tone="neutral" />
                      <div>
                        <div className="font-medium text-foreground">{u.name}</div>
                        <div className="text-[12px] text-muted">{u.email}</div>
                      </div>
                    </div>
                  </Td>
                  <Td className="w-[240px]">
                    {manage && !self ? (
                      <Select
                        aria-label={`Papel de ${u.name}`}
                        value={u.role}
                        options={ROLE_OPTIONS}
                        onChange={(e) => void actions.changeUserRole(u.id, e.target.value as PartnerRole)}
                        className="h-8 text-[12.5px]"
                      />
                    ) : (
                      <span className="text-[12.5px]">{ROLE_LABEL[u.role]}</span>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge status={u.status} labels={USER_STATUS_LABEL} tones={USER_STATUS_TONE} />
                  </Td>
                  <Td className="text-[12px] text-muted">{u.lastAccessAt ? formatEventTime(u.lastAccessAt) : "—"}</Td>
                  <Td className="text-right">
                    {manage && !self && u.status !== "INVITED" && (
                      <Button size="sm" variant={u.status === "DISABLED" ? "secondary" : "ghost"} onClick={() => void actions.setUserStatus(u.id, u.status === "DISABLED" ? "ACTIVE" : "DISABLED")}>
                        {u.status === "DISABLED" ? "Reativar" : "Inativar"}
                      </Button>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function ClientsTab({ partnerId }: { partnerId: string }) {
  const clients = usePartnerClients(partnerId);
  return (
    <Panel>
      <PanelHeader title="Clientes relacionados" description="Somente clientes com vínculo autorizado com este parceiro." />
      {clients.length === 0 ? (
        <EmptyState compact title="Nenhum cliente relacionado." />
      ) : (
        <Table caption="Clientes do parceiro">
          <THead>
            <tr>
              <Th>Cliente</Th>
              <Th>Tipo</Th>
              <Th>CPF/CNPJ</Th>
              <Th>Situação</Th>
              <Th>Cadastro criado por</Th>
            </tr>
          </THead>
          <TBody>
            {clients.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <Link href={`/clientes/${c.id}`} className="font-medium text-navy hover:underline underline-offset-2">
                    {clientDisplayName(c)}
                  </Link>
                </Td>
                <Td className="text-[12.5px]">{CLIENT_KIND_SHORT[c.kind]}</Td>
                <Td className="font-mono text-[12px]">{maskClientDocument(c)}</Td>
                <Td>
                  <StatusBadge status={c.status} labels={CLIENT_STATUS_LABEL} tones={CLIENT_STATUS_TONE} />
                </Td>
                <Td className="text-[12.5px] text-muted">{c.createdByOfficeId === partnerId ? "Este parceiro" : "Outro escritório"}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}

function CasesTab({ partnerId }: { partnerId: string }) {
  const all = useCaseRows();
  const rows = useMemo(() => all.filter((r) => r.legalCase.originOfficeId === partnerId || r.legalCase.createdByOfficeId === partnerId), [all, partnerId]);
  return (
    <Panel>
      <PanelHeader title="Casos do parceiro" description="Casos com origem neste parceiro ou enviados por ele." />
      {rows.length === 0 ? <EmptyState compact title="Nenhum caso deste parceiro." /> : <CaseTable rows={rows} />}
    </Panel>
  );
}

function ProcessesTab({ partnerId }: { partnerId: string }) {
  const processes = usePartnerProcesses(partnerId);
  const clientMap = useClientMap();
  const caseMap = useCaseMap();
  const showValue = useCan()("processes.caseValue.view");
  return (
    <Panel>
      <PanelHeader title="Processos dos casos do parceiro" description="A origem é do caso — independe de quem cadastrou o cliente." />
      {processes.length === 0 ? (
        <EmptyState compact title="Nenhum processo originado por este parceiro." />
      ) : (
        <Table caption="Processos do parceiro">
          <THead>
            <tr>
              <Th>Processo</Th>
              <Th>Cliente</Th>
              <Th>Status</Th>
              <Th>Caso</Th>
              {showValue && <Th className="text-right">Valor da causa</Th>}
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
                  <Td className="text-[12.5px]">{clientDisplayName(clientMap.get(p.clientId))}</Td>
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
                  {showValue && <Td className="text-right tabular">{formatCurrency(p.caseValue)}</Td>}
                  <Td className="text-[12px] text-muted">{formatEventTime(p.lastMovementAt ?? p.updatedAt)}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}

function FinanceTab({ partnerId }: { partnerId: string }) {
  const summary = usePartnerFinancialSummary(partnerId);
  const views = usePartnershipViews().filter((v) => v.partnerOfficeId === partnerId);
  const clientMap = useClientMap();
  return (
    <div className="space-y-5">
      <p className="text-[12.5px] text-muted">Somente a relação financeira entre a Bárbara Cardoso Advocacia e este parceiro.</p>
      {summary && (
        <div className="grid grid-cols-4 gap-4">
          <Stat label="Participação acumulada" value={formatCurrency(summary.accumulatedShare)} hint="Sobre honorários realizados" />
          <Stat label="Repassado" value={formatCurrency(summary.received)} />
          <Stat label="A repassar" value={formatCurrency(summary.toReceive)} tone={summary.toReceive ? "gold" : "neutral"} />
          <Stat label="Participação estimada" value={formatCurrency(summary.estimatedShare)} hint="Estimativa — casos sem honorários realizados" />
        </div>
      )}
      <Panel>
        <PanelHeader title="Casos com acordo de parceria" />
        <PartnershipAgreementsTable agreements={views} clientMap={clientMap} />
      </Panel>
    </div>
  );
}

function ActivityTab({ partnerId }: { partnerId: string }) {
  const events = usePartnerActivity(partnerId);
  return (
    <Panel>
      <PanelHeader title="Atividade" description="Registro das ações relacionadas a este parceiro." />
      <PanelBody>
        {events.length === 0 ? (
          <EmptyState compact title="Nenhuma atividade registrada." />
        ) : (
          <Timeline
            items={events.map((e) => ({
              id: e.id,
              title: e.description,
              meta: formatEventTime(e.at),
              description: (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{e.actor.name}</Badge>
                  {e.details?.map((d) => (
                    <span key={d.label} className="text-[12px]">
                      {d.label}: {d.value}
                    </span>
                  ))}
                </span>
              ),
            }))}
          />
        )}
      </PanelBody>
    </Panel>
  );
}
