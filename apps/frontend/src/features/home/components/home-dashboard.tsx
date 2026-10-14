"use client";

import Link from "next/link";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Activity, AlarmClock, ArrowRight, Bot, Briefcase, BriefcaseBusiness, CalendarClock, CheckCircle2, CircleAlert, ClipboardCheck, FolderOpen, Hourglass, PieChart as PieIcon, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { now } from "@/lib/clock";
import { CLIENT_KIND_LABEL, CLIENT_STATUS_LABEL, PRIORITY_LABEL, PRIORITY_TONE, PROCESS_STATUS_LABEL, type ProcessStatus } from "@/lib/constants/status";
import { formatCurrency, formatDateLong, formatEventTime, formatNumber, formatPercent, formatWaitingTime, greeting, pluralize } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { DeadlineBadge, Stat } from "@/components/ui/display";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { TONE_BORDER_LEFT } from "@/components/ui/tone";
import type { Page } from "@/server/core/pagination";
import type { DeadlineDTO } from "@/server/domain/processes/deadlines/dto";
import { AGENT_RUN_STATUS_LABEL, AGENT_RUN_STATUS_TONE } from "@/features/agent-runs/components/agent-runs-panel";
import { ACTOR_TYPE_LABEL, actionLabel, eventDetail } from "@/features/audit/humanize";
import { useOrganizationNames } from "@/features/directory/directory-context";
import { maskCNPJ, maskCPF } from "@/lib/formatting";
import type { InternalHomeData } from "../load";

const weekdayFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });
const STATUS_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-1)", "var(--chart-2)"];
const num = (v: number | undefined) => (v === undefined ? "—" : formatNumber(v));

/**
 * Central de operação do escritório, com dados do SERVIDOR (carregados na
 * página, por permissão). Cada bloco só existe se o papel tem a permissão —
 * o que não é permitido nem é consultado no servidor.
 */
export function HomeDashboard({ data }: { data: InternalHomeData }) {
  const today = now();
  const k = data.kpis;
  return (
    <>
      <header className="mb-7">
        <h1 className="font-serif text-[30px] font-medium leading-tight tracking-[-0.01em] text-navy">
          {greeting(today)}, {data.firstName}.
        </h1>
        <p className="mt-1.5 text-[13px] text-muted">
          <span className="capitalize">{weekdayFmt.format(today)}</span>, {formatDateLong(today)}
          <span aria-hidden className="mx-2 text-subtle">
            ·
          </span>
          {data.officeName}
        </p>
      </header>

      <section aria-label="Indicadores do escritório" data-tour="home-kpis" className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <Stat label="Casos ativos" value={num(k.activeCases)} icon={FolderOpen} href="/casos" hint="Em análise, aceitos e em andamento" />
        <Stat label="Casos aguardando a equipe" value={num(k.awaitingCases)} icon={Hourglass} href="/casos" hint="Enviados ou aguardando documentos" />
        <Stat label="Processos ativos" value={num(k.activeProcesses)} icon={Briefcase} href="/processos" hint="Todos os status, exceto encerrados" />
        {k.pendingReviews !== undefined ? (
          <Stat
            label="Revisões pendentes"
            value={num(k.pendingReviews)}
            icon={ClipboardCheck}
            tone={(k.urgentReviews ?? 0) > 0 ? "danger" : "neutral"}
            href="/revisoes"
            hint={(k.urgentReviews ?? 0) > 0 ? pluralize(k.urgentReviews ?? 0, "urgente", "urgentes") : "Nenhuma marcada como urgente"}
          />
        ) : (
          <Stat label="Prazos vencidos" value={num(k.overdueDeadlines)} icon={CircleAlert} tone={(k.overdueDeadlines ?? 0) > 0 ? "danger" : "neutral"} href="/processos?prazo=vencidos" />
        )}
        <Stat
          label="Prazos em até 5 dias"
          value={num(k.dueSoonDeadlines)}
          icon={AlarmClock}
          tone={(k.overdueDeadlines ?? 0) > 0 ? "danger" : (k.dueSoonDeadlines ?? 0) > 0 ? "warning" : "neutral"}
          href="/processos?prazo=5dias"
          hint={(k.overdueDeadlines ?? 0) > 0 ? `Atenção: ${pluralize(k.overdueDeadlines ?? 0, "prazo vencido", "prazos vencidos")}` : "Em aberto, ainda no prazo"}
        />
      </section>

      {data.finance && <FinanceSnapshot finance={data.finance} />}

      <div className="mt-6 grid grid-cols-12 gap-5">
        {data.newCases && (
          <div className="col-span-12">
            <NewCases cases={data.newCases} />
          </div>
        )}
        <div className="col-span-12 xl:col-span-8">
          <AttentionPanel overdue={data.overdue} upcoming={data.upcoming} />
        </div>
        <div className="col-span-12 xl:col-span-4">
          <ProcessDistribution distribution={data.distribution} />
        </div>
        {data.reviews && (
          <div className="col-span-12 xl:col-span-7">
            <PendingReviews reviews={data.reviews} />
          </div>
        )}
        <div className={cn("col-span-12", data.reviews && "xl:col-span-5")}>
          <RecentClients clients={data.clients} />
        </div>
        {data.feed && (
          <div className={cn("col-span-12", data.runs && "xl:col-span-7")}>
            <OfficeFeed feed={data.feed} />
          </div>
        )}
        {data.runs && (
          <div className="col-span-12 xl:col-span-5">
            <AgentActivity runs={data.runs} />
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function FinanceSnapshot({ finance }: { finance: NonNullable<InternalHomeData["finance"]> }) {
  if (!finance.ok) return <ActionErrorState error={finance} title="Não foi possível carregar o financeiro." />;
  const t = finance.data.totals;
  const items = [
    { label: "Em aberto", value: formatCurrency(t.outstanding), hint: pluralize(t.openPayments, "obrigação a receber", "obrigações a receber") },
    { label: "Em atraso", value: formatCurrency(t.overdue), hint: t.overdue > 0 ? "Obrigações vencidas com saldo" : "Nenhuma obrigação vencida", alert: t.overdue > 0 },
    { label: "Recebido no mês", value: formatCurrency(finance.data.monthly.at(-1)?.amount ?? 0), hint: "Valor líquido lançado neste mês" },
  ];
  return (
    <section aria-labelledby="home-finance-title" className="mt-4 rounded-lg border border-line bg-surface shadow-hairline">
      <div className="flex items-stretch divide-x divide-line">
        <div className="flex w-[220px] shrink-0 flex-col justify-center px-5 py-4">
          <p className="eyebrow">Somente administradores</p>
          <h2 id="home-finance-title" className="mt-1 text-[14px] font-semibold text-foreground">
            Financeiro
          </h2>
          <Link href="/financeiro" className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-navy-700 hover:underline underline-offset-2">
            Abrir Financeiro <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        <dl className="grid flex-1 grid-cols-3 divide-x divide-line">
          {items.map((item) => (
            <div key={item.label} className="px-5 py-4">
              <dt className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
                {item.label}
                {item.alert && (
                  <span className="inline-flex items-center gap-1 text-danger">
                    <CircleAlert className="size-3.5" aria-hidden />
                    <span className="text-[11.5px]">requer atenção</span>
                  </span>
                )}
              </dt>
              <dd className="mt-1.5 text-[20px] font-semibold tabular text-navy">{item.value}</dd>
              <dd className="mt-0.5 text-[12px] text-muted">{item.hint}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function NewCases({ cases }: { cases: NonNullable<InternalHomeData["newCases"]> }) {
  const names = useOrganizationNames();
  return (
    <Panel>
      <PanelHeader
        title="Casos novos aguardando a equipe"
        description={cases.ok && cases.data.total ? pluralize(cases.data.total, "caso enviado", "casos enviados") : "Casos enviados (inclusive pelos escritórios parceiros)"}
        actions={
          <ButtonLink href="/casos?situacao=SUBMITTED" variant="secondary" size="sm">
            Ver casos
          </ButtonLink>
        }
      />
      {!cases.ok ? (
        <ActionErrorState error={cases} title="Não foi possível carregar os casos." />
      ) : cases.data.items.length === 0 ? (
        <EmptyState compact icon={BriefcaseBusiness} title="Nenhum caso novo" description="Quando um caso for enviado, ele aparece aqui." />
      ) : (
        <ul className="divide-y divide-line">
          {cases.data.items.map((c) => (
            <li key={c.id} className="flex items-center gap-5 px-5 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/casos/${c.id}`} className="block truncate text-[13.5px] font-semibold text-foreground hover:text-navy-700 hover:underline underline-offset-2">
                  {c.title}
                </Link>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted">
                  <span>{c.clientName || "—"}</span>
                  <span>
                    Origem: <span className="font-medium text-navy-700">{names.get(c.originOrganizationId) ?? "—"}</span>
                  </span>
                </p>
              </div>
              <span className="text-[12px] text-subtle">{c.submittedAt ? formatEventTime(c.submittedAt) : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DeadlineRow({ d, overdue }: { d: DeadlineDTO; overdue: boolean }) {
  return (
    <li className={cn("grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-4 border-l-2 py-3 pl-4 pr-5", TONE_BORDER_LEFT[overdue ? "danger" : "warning"])}>
      <span className={cn("flex size-8 items-center justify-center rounded-md border border-line bg-surface-muted", overdue ? "text-danger" : "text-orange")}>
        <CalendarClock className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[13px] font-semibold text-foreground">{d.title}</p>
          <DeadlineBadge dueDate={d.dueDateLocal} />
        </div>
        <p className="mt-0.5 truncate text-[12.5px] text-muted">{d.processId ? "Prazo de processo" : "Prazo do caso"}</p>
      </div>
      <Link
        href={d.processId ? `/processos/${d.processId}?aba=prazos` : `/casos/${d.legalCaseId}`}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[12.5px] font-medium text-navy-700 hover:bg-navy-50 hover:text-navy"
      >
        Abrir <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </li>
  );
}

/** "Precisa da sua atenção": prazos vencidos e os que vencem em até 5 dias, do servidor. */
function AttentionPanel({ overdue, upcoming }: { overdue: ActionResult<Page<DeadlineDTO>>; upcoming: ActionResult<Page<DeadlineDTO>> }) {
  const error = !overdue.ok ? overdue : !upcoming.ok ? upcoming : null;
  const late = overdue.ok ? overdue.data.items : [];
  const soon = upcoming.ok ? upcoming.data.items : [];
  return (
    <section aria-labelledby="home-attention-title" data-tour="home-attention" className="flex h-full flex-col rounded-lg border border-line bg-surface shadow-hairline">
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
        <div>
          <h2 id="home-attention-title" className="text-[14px] font-semibold text-foreground">
            Precisa da sua atenção
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">Prazos vencidos e os que vencem em até 5 dias.</p>
        </div>
        {late.length > 0 && (
          <Badge tone="danger" dot>
            {pluralize(overdue.ok ? overdue.data.total : late.length, "vencido", "vencidos")}
          </Badge>
        )}
      </div>
      {error ? (
        <ActionErrorState error={error} title="Não foi possível carregar os prazos." />
      ) : late.length + soon.length === 0 ? (
        <EmptyState compact icon={CheckCircle2} title="Nada urgente no momento" description="Nenhum prazo vencido nem vencendo nos próximos 5 dias." />
      ) : (
        <ul className="divide-y divide-line">
          {late.map((d) => (
            <DeadlineRow key={d.id} d={d} overdue />
          ))}
          {soon.map((d) => (
            <DeadlineRow key={d.id} d={d} overdue={false} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProcessDistribution({ distribution }: { distribution: InternalHomeData["distribution"] }) {
  const slices = (distribution ?? []).map((s, i) => ({ ...s, color: STATUS_COLORS[i % STATUS_COLORS.length], name: PROCESS_STATUS_LABEL[s.status as ProcessStatus] }));
  const total = slices.reduce((sum, s) => sum + s.count, 0);
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader title="Distribuição dos processos" description="Por status, contada no banco" />
      {distribution === null ? (
        <EmptyState compact icon={PieIcon} title="Não foi possível contar os processos." />
      ) : total === 0 ? (
        <EmptyState compact icon={PieIcon} title="Nenhum processo cadastrado" description="Os processos aparecerão aqui assim que forem criados ou importados." />
      ) : (
        <PanelBody className="flex flex-1 flex-col gap-5">
          <div className="relative mx-auto h-[190px] w-[190px]" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="count" nameKey="name" innerRadius={62} outerRadius={88} paddingAngle={1.5} stroke="var(--surface)" strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}>
                  {slices.map((d) => (
                    <Cell key={d.status} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [formatNumber(Number(value)), "Processos"]} contentStyle={{ borderRadius: 6, border: "1px solid var(--line)", fontSize: 12, boxShadow: "none" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-serif text-[30px] font-medium leading-none tabular text-navy">{formatNumber(total)}</span>
              <span className="mt-1 text-[11.5px] text-muted">processos</span>
            </div>
          </div>
          <ul aria-label={`Distribuição de ${total} processos por status`} className="divide-y divide-line border-t border-line">
            {slices.map((s) => (
              <li key={s.status} className="flex items-center gap-2.5 py-2 text-[12.5px]">
                <span aria-hidden className="size-2.5 shrink-0 rounded-xs" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 text-foreground">{s.name}</span>
                <span className="tabular font-medium text-foreground">{formatNumber(s.count)}</span>
                <span className="w-10 text-right tabular text-subtle">{formatPercent((s.count / total) * 100)}</span>
              </li>
            ))}
          </ul>
        </PanelBody>
      )}
    </Panel>
  );
}

function PendingReviews({ reviews }: { reviews: NonNullable<InternalHomeData["reviews"]> }) {
  return (
    <Panel data-tour="home-reviews" className="flex h-full flex-col">
      <PanelHeader
        title="Revisões pendentes"
        description={reviews.ok && reviews.data.total > 0 ? `${reviews.data.total} aguardando decisão humana — mais antigas primeiro` : "Materiais dos agentes aguardando decisão"}
        actions={
          <ButtonLink href="/revisoes" variant="secondary" size="sm">
            Ver todas
          </ButtonLink>
        }
      />
      {!reviews.ok ? (
        <ActionErrorState error={reviews} title="Não foi possível carregar as revisões." />
      ) : reviews.data.items.length === 0 ? (
        <EmptyState compact icon={ClipboardCheck} title="Nenhuma revisão pendente" description="Quando um agente concluir um material, ele aparecerá aqui para sua decisão." />
      ) : (
        <Table caption="Revisões pendentes">
          <THead>
            <tr>
              <Th>Revisão</Th>
              <Th>Cliente</Th>
              <Th>Aguardando há</Th>
              <Th>Prioridade</Th>
            </tr>
          </THead>
          <TBody>
            {reviews.data.items.map((r) => (
              <Tr key={r.id}>
                <Td className="max-w-[360px]">
                  <Link href={`/revisoes/${r.id}`} className="block truncate font-medium text-foreground hover:text-navy-700 hover:underline underline-offset-2">
                    {r.subject}
                  </Link>
                  {r.agentName && <span className="block truncate text-[11.5px] text-muted">{r.agentName}</span>}
                </Td>
                <Td className="max-w-[180px] truncate text-muted">{r.clientName ?? "—"}</Td>
                <Td className="whitespace-nowrap tabular text-muted">{formatWaitingTime(r.createdAt)}</Td>
                <Td>
                  <StatusBadge status={r.priority} labels={PRIORITY_LABEL} tones={PRIORITY_TONE} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}

function RecentClients({ clients }: { clients: InternalHomeData["clients"] }) {
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Clientes recentes"
        description="Últimos cadastros e atualizações"
        actions={
          <ButtonLink href="/clientes" variant="secondary" size="sm">
            Ver clientes
          </ButtonLink>
        }
      />
      {!clients.ok ? (
        <ActionErrorState error={clients} title="Não foi possível carregar os clientes." />
      ) : clients.data.items.length === 0 ? (
        <EmptyState compact icon={Users} title="Nenhum cliente cadastrado" description="Cadastre o primeiro cliente para iniciar documentos e análises." />
      ) : (
        <ul className="divide-y divide-line">
          {clients.data.items.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-2.5">
              <Badge tone="neutral" title={CLIENT_KIND_LABEL[c.kind]} className="w-8 justify-center">
                <span aria-hidden>{c.kind === "INDIVIDUAL" ? "PF" : "PJ"}</span>
                <span className="sr-only">{CLIENT_KIND_LABEL[c.kind]}</span>
              </Badge>
              <div className="min-w-0 flex-1">
                <Link href={`/clientes/${c.id}`} className="block truncate text-[13px] font-medium text-foreground hover:text-navy-700 hover:underline underline-offset-2">
                  {c.name}
                </Link>
                <p className="truncate text-[11.5px] text-muted">
                  {c.kind === "INDIVIDUAL" ? maskCPF(c.document) : maskCNPJ(c.document)} · atualizado {formatEventTime(c.updatedAt)}
                </p>
              </div>
              <span className="text-[12px] text-muted">{CLIENT_STATUS_LABEL[c.status] ?? c.status}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function OfficeFeed({ feed }: { feed: NonNullable<InternalHomeData["feed"]> }) {
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Atividade do escritório"
        description="Últimos registros da auditoria (somente administradores)"
        actions={
          <ButtonLink href="/configuracoes?secao=seguranca" variant="secondary" size="sm">
            Ver auditoria
          </ButtonLink>
        }
      />
      {!feed.ok ? (
        <ActionErrorState error={feed} title="Não foi possível carregar a atividade." />
      ) : feed.data.items.length === 0 ? (
        <EmptyState compact icon={Activity} title="Nenhuma atividade registrada" />
      ) : (
        <ul className="divide-y divide-line">
          {feed.data.items.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-foreground">{actionLabel(e.action)}</p>
                <p className="truncate text-[12px] text-muted">
                  {[eventDetail(e), e.actorName ?? ACTOR_TYPE_LABEL[e.actorType]].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className="shrink-0 text-[11.5px] tabular text-subtle">{formatEventTime(e.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AgentActivity({ runs }: { runs: NonNullable<InternalHomeData["runs"]> }) {
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Atividade do DG Brasil"
        description="Execuções de agente mais recentes"
        actions={
          <ButtonLink href="/dg-brasil/execucoes" variant="secondary" size="sm">
            Ver execuções
          </ButtonLink>
        }
      />
      {!runs.ok ? (
        <ActionErrorState error={runs} title="Não foi possível carregar as execuções." />
      ) : runs.data.items.length === 0 ? (
        <EmptyState compact icon={Bot} title="Nenhuma execução registrada" description="As execuções dos agentes aparecerão aqui, com status e horário." />
      ) : (
        <ul className="divide-y divide-line">
          {runs.data.items.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-foreground">{r.agentName}</p>
                <p className="mt-0.5 truncate text-[12px] text-muted">{r.operation}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StatusBadge status={r.status} labels={AGENT_RUN_STATUS_LABEL} tones={AGENT_RUN_STATUS_TONE} />
                <span className="text-[11.5px] tabular text-subtle">{formatEventTime(r.createdAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
