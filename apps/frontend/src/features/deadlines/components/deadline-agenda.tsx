"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { AlarmClock, ArrowUpRight, Bot, CalendarCheck, CalendarClock, CircleAlert, SearchX, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { DEADLINE_STATUS_LABEL, DEADLINE_STATUS_TONE, DEADLINE_TYPE_LABEL, DEADLINE_TYPES, DEADLINE_URGENCY_TONE } from "@/lib/constants/status";
import { deadlineUrgency, formatCNJ, formatDate, formatDateTime, formatNumber } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useServerList } from "@/lib/hooks/use-server-list";
import { Can, PageContainer } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { DeadlineBadge, PageHeader } from "@/components/ui/display";
import { Checkbox, Input, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { TONE_BORDER_LEFT } from "@/components/ui/tone";
import type { Page } from "@/server/core/pagination";
import { exportDeadlinesAction, listDeadlinesAction } from "@/server/domain/processes/deadlines/actions";
import type { DeadlineDTO } from "@/server/domain/processes/deadlines/dto";
import { usePermission } from "@/features/auth/hooks";
import { useDirectoryUserMap, useResponsibleUserOptions } from "@/features/directory/directory-context";
import { ExportButton } from "@/features/export/export-button";
import { AddDeadlineDialog } from "@/features/processes/components/add-deadline-dialog";
import { CnjText } from "@/features/processes/components/cnj-text";
import { DeadlineActionDialog, DeadlineAgentMark, deadlineHasTime, DeadlineRowActions, HearingInfo, type DeadlineActionRequest } from "@/features/processes/components/deadline-actions";
import {
  AGENDA_PAGE_SIZE,
  AGENDA_PERIOD_LABEL,
  AGENDA_PERIODS,
  AGENDA_SITUATION_LABEL,
  AGENDA_SITUATIONS,
  agendaQueryToInput,
  agendaQueryToSearchParams,
  countAgendaFilters,
  DEFAULT_AGENDA_QUERY,
  groupAgenda,
  type AgendaGroup,
  type DeadlineAgendaQuery,
} from "../list-query";

/** Contadores do escritório inteiro (não só da página), contados no servidor. `undefined` = não deu para contar. */
export interface AgendaSummary {
  overdue?: number;
  today?: number;
  next5Days?: number;
  agentUnchecked?: number;
}

const weekdayFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" });
const weekday = (date: string) => weekdayFmt.format(new Date(`${date}T12:00:00Z`));

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (v: string) => void }) {
  return <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder={label} className="h-8 text-[12.5px]" />;
}

function Counter({ icon: Icon, label, value, tone, active, onClick }: { icon: LucideIcon; label: string; value?: number; tone?: "danger" | "warning"; active?: boolean; onClick: () => void }) {
  const hot = (value ?? 0) > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-muted", active && "bg-navy-50/70")}
    >
      <Icon aria-hidden className={cn("size-4", hot && tone === "danger" ? "text-danger" : hot && tone === "warning" ? "text-orange" : "text-subtle")} />
      <div>
        <div className={cn("text-[18px] font-semibold leading-none tabular", hot && tone === "danger" ? "text-danger" : "text-navy")}>{value === undefined ? "—" : formatNumber(value)}</div>
        <div className="mt-1 text-[11.5px] text-muted">{label}</div>
      </div>
    </button>
  );
}

/**
 * Agenda de prazos do escritório (equipe interna). Filtros, ordem e páginas no
 * servidor; a página vem agrupada por dia, com os vencidos em destaque no
 * topo. As ações são as mesmas da aba Prazos do processo, e valem também para
 * prazo de caso sem processo. "Exportar planilha" (só ADMIN) leva os filtros
 * da tela, sem a página.
 */
export function DeadlineAgenda({
  initialQuery,
  initialResult,
  summary,
}: {
  initialQuery: DeadlineAgendaQuery;
  initialResult: ActionResult<Page<DeadlineDTO>>;
  summary?: AgendaSummary;
}) {
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery,
    initialResult,
    load: (q: DeadlineAgendaQuery) => listDeadlinesAction(agendaQueryToInput(q)),
    toSearch: agendaQueryToSearchParams,
  });
  const users = useDirectoryUserMap();
  const userOptions = useResponsibleUserOptions();
  const canEdit = usePermission("processes.edit");
  const [action, setAction] = useState<DeadlineActionRequest | null>(null);
  const [editing, setEditing] = useState<DeadlineDTO | null>(null);
  const set = (patch: Partial<DeadlineAgendaQuery>) => setQuery({ ...query, ...patch, page: 1 });
  const responsibleOptions = useMemo(() => [{ value: "me", label: "Os meus prazos" }, ...userOptions], [userOptions]);
  const active = countAgendaFilters(query);
  const page = result.ok ? result.data : undefined;
  const groups = useMemo(() => (page ? groupAgenda(page.items) : []), [page]);
  const only = (patch: Partial<DeadlineAgendaQuery>) => setQuery({ ...DEFAULT_AGENDA_QUERY, ...patch });
  const isOnly = (patch: Partial<DeadlineAgendaQuery>) => JSON.stringify({ ...query, page: 1 }) === JSON.stringify({ ...DEFAULT_AGENDA_QUERY, ...patch });

  return (
    <PageContainer>
      <PageHeader
        title="Prazos"
        description="Todos os prazos do escritório, por dia. Os vencidos ficam no topo até serem cumpridos, cancelados ou marcados como perdidos."
        actions={<ExportButton action={exportDeadlinesAction} input={agendaQueryToInput(query)} />}
      />
      {summary && (
        <section aria-label="Resumo dos prazos do escritório" className="mb-4 grid grid-cols-4 divide-x divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-hairline">
          <Counter icon={CircleAlert} label="Vencidos, em aberto" value={summary.overdue} tone="danger" active={isOnly({ situation: "vencidos" })} onClick={() => only({ situation: "vencidos" })} />
          <Counter icon={AlarmClock} label="Vencem hoje" value={summary.today} tone="warning" active={isOnly({ situation: "no-prazo", period: "hoje" })} onClick={() => only({ situation: "no-prazo", period: "hoje" })} />
          <Counter icon={CalendarClock} label="Vencem em até 5 dias" value={summary.next5Days} active={isOnly({ situation: "no-prazo", period: "5dias" })} onClick={() => only({ situation: "no-prazo", period: "5dias" })} />
          <Counter icon={Bot} label="Do agente, sem conferência" value={summary.agentUnchecked} tone="warning" active={isOnly({ agentUnchecked: true })} onClick={() => only({ agentUnchecked: true })} />
        </section>
      )}
      <Panel>
        <div className="border-b border-line px-5 py-3" role="search" aria-label="Filtrar prazos">
          <div className="flex min-h-8 items-center gap-3">
            {page && (
              <p className="text-[12.5px] text-muted" aria-live="polite">
                {page.total === 1 ? "1 prazo" : `${formatNumber(page.total)} prazos`}
                {active > 0 ? " com os filtros" : " em aberto"}
              </p>
            )}
            {query.caseId && <Badge tone="navy">Só os prazos de um caso</Badge>}
            {active > 0 && (
              <Button variant="ghost" size="sm" className="ml-auto" icon={<X className="size-3.5" aria-hidden />} onClick={() => setQuery(DEFAULT_AGENDA_QUERY)}>
                Limpar filtros ({active})
              </Button>
            )}
          </div>
          <div className="mt-2.5 grid grid-cols-4 gap-2">
            <FilterSelect label="Responsável" value={query.responsible} options={responsibleOptions} onChange={(v) => set({ responsible: v })} />
            <Select
              aria-label="Situação"
              value={query.situation}
              onChange={(e) => set({ situation: e.target.value as DeadlineAgendaQuery["situation"] })}
              options={AGENDA_SITUATIONS.map((s) => ({ value: s, label: AGENDA_SITUATION_LABEL[s] }))}
              className="h-8 text-[12.5px]"
            />
            <FilterSelect label="Tipo" value={query.type} options={DEADLINE_TYPES.map((t) => ({ value: t, label: DEADLINE_TYPE_LABEL[t] }))} onChange={(v) => set({ type: v as DeadlineAgendaQuery["type"] })} />
            <FilterSelect
              label="Período"
              value={query.period}
              options={AGENDA_PERIODS.map((p) => ({ value: p, label: AGENDA_PERIOD_LABEL[p] }))}
              onChange={(v) => set({ period: v as DeadlineAgendaQuery["period"], from: "", until: "" })}
            />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Checkbox label="Do agente, não conferidos" checked={query.agentUnchecked} onChange={(e) => set({ agentUnchecked: e.target.checked })} />
            {query.period === "datas" && (
              <div className="flex items-center gap-2 text-[12.5px] text-muted">
                <label className="flex items-center gap-2">
                  Vencimento de
                  <Input type="date" aria-label="Vencimento a partir de" value={query.from} max={query.until || undefined} onChange={(e) => set({ from: e.target.value })} className="h-8 w-[150px] text-[12.5px]" />
                </label>
                <label className="flex items-center gap-2">
                  até
                  <Input type="date" aria-label="Vencimento até" value={query.until} min={query.from || undefined} onChange={(e) => set({ until: e.target.value })} className="h-8 w-[150px] text-[12.5px]" />
                </label>
              </div>
            )}
          </div>
        </div>
        <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
          {!result.ok ? (
            <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar os prazos." />
          ) : !page ? (
            <SkeletonRows rows={6} />
          ) : page.items.length === 0 ? (
            active === 0 ? (
              <EmptyState icon={CalendarCheck} title="Nenhum prazo em aberto." description="Prazos adicionados nos processos pela equipe ou lançados pelos agentes aparecem aqui." />
            ) : (
              <EmptyState
                icon={SearchX}
                title="Nenhum prazo corresponde aos filtros."
                description="Ajuste os filtros ou limpe para ver todos os prazos em aberto."
                action={
                  <Button variant="secondary" onClick={() => setQuery(DEFAULT_AGENDA_QUERY)}>
                    Limpar filtros
                  </Button>
                }
              />
            )
          ) : (
            <>
              <Table caption="Prazos do escritório, agrupados por dia">
                <THead>
                  <tr>
                    <Th>Cliente e processo</Th>
                    <Th>Prazo</Th>
                    <Th>Tipo</Th>
                    <Th>Vencimento</Th>
                    <Th>Responsável</Th>
                    <Th>Situação</Th>
                    <Th className="text-right">
                      <span className="sr-only">Ações</span>
                    </Th>
                  </tr>
                </THead>
                <TBody>
                  {groups.map((group) => (
                    <Fragment key={group.key}>
                      <GroupHeader group={group} />
                      {group.items.map((d) => (
                        <AgendaRow
                          key={d.id}
                          deadline={d}
                          responsible={(d.responsibleUserId && users.get(d.responsibleUserId)?.name) || undefined}
                          canEdit={canEdit}
                          onEdit={setEditing}
                          onAction={setAction}
                        />
                      ))}
                    </Fragment>
                  ))}
                </TBody>
              </Table>
              <Pagination page={page.page} pageSize={AGENDA_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={{ one: "prazo", many: "prazos" }} />
            </>
          )}
        </div>
      </Panel>
      {action && <DeadlineActionDialog key={`${action.kind}:${action.deadline.id}`} request={action} onClose={() => setAction(null)} />}
      {editing && <AddDeadlineDialog key={editing.id} open onOpenChange={(o) => !o && setEditing(null)} deadline={editing} />}
    </PageContainer>
  );
}

function GroupHeader({ group }: { group: AgendaGroup }) {
  return (
    <tr className={group.overdue ? "bg-danger-soft" : "bg-surface-muted"}>
      <th colSpan={7} scope="colgroup" className={cn("px-5 py-2 text-left text-[12px] font-semibold", group.overdue ? "text-danger" : "text-foreground")}>
        {group.overdue ? (
          <span className="inline-flex items-center gap-1.5">
            <CircleAlert className="size-3.5" aria-hidden />
            Vencidos, ainda em aberto
            <span className="font-normal">({group.items.length} nesta página)</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <span className="capitalize">{weekday(group.date as string)}</span>
            <span className="tabular">{formatDate(group.date as string)}</span>
            <GroupBadge group={group} />
          </span>
        )}
      </th>
    </tr>
  );
}

/**
 * Selo do dia: urgência só se houver prazo em aberto nele; todos cumpridos,
 * "Cumprido"; só cancelados ou perdidos, nenhum selo (não há o que vencer).
 * Dia só de audiências: "Em N dias".
 */
function GroupBadge({ group }: { group: AgendaGroup }) {
  const open = group.items.filter((d) => d.status === "OPEN");
  if (open.length > 0) return <DeadlineBadge dueDate={group.date as string} event={open.every((d) => d.type === "HEARING")} />;
  if (group.items.every((d) => d.status === "COMPLETED")) return <DeadlineBadge dueDate={group.date as string} done />;
  return null;
}

function AgendaRow({
  deadline: d,
  responsible,
  canEdit,
  onEdit,
  onAction,
}: {
  deadline: DeadlineDTO;
  responsible?: string;
  canEdit: boolean;
  onEdit: (d: DeadlineDTO) => void;
  onAction: (request: DeadlineActionRequest) => void;
}) {
  const overdue = d.effectiveStatus === "OVERDUE";
  const tone = d.status === "OPEN" ? DEADLINE_URGENCY_TONE[deadlineUrgency(d.dueDateLocal)] : "neutral";
  // Prazo de processo abre a aba Prazos do processo; prazo só do caso abre o caso.
  const href = d.processId ? `/processos/${d.processId}?aba=prazos` : `/casos/${d.legalCaseId}`;
  const openLabel = d.processId ? "Abrir o processo" : "Abrir o caso";
  return (
    <Tr className={d.status === "OPEN" ? undefined : "text-muted"}>
      <Td className={cn("border-l-2", tone === "neutral" ? "border-l-transparent" : TONE_BORDER_LEFT[tone])}>
        <Link href={href} className="block max-w-[280px] truncate font-medium text-foreground underline-offset-2 hover:text-navy-700 hover:underline" title={openLabel}>
          {d.clientName || "Cliente não informado"}
        </Link>
        <div className="mt-0.5 max-w-[280px] truncate text-[12px] text-muted">
          {d.processId ? <CnjText cnj={d.processCnj ? formatCNJ(d.processCnj) : undefined} className="text-[12px]" /> : <span className="italic">Prazo do caso, sem processo</span>}
        </div>
        <div className="max-w-[280px] truncate text-[12px] text-muted" title={d.processTitle || d.caseTitle}>
          {d.processTitle || d.caseTitle}
        </div>
      </Td>
      <Td>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("font-medium", d.status === "OPEN" && "text-foreground")}>{d.title}</span>
          <DeadlineAgentMark deadline={d} canCheck={canEdit} />
        </div>
        {d.description && <div className="mt-0.5 max-w-[340px] truncate text-[12px] text-muted" title={d.description}>{d.description}</div>}
        <HearingInfo deadline={d} />
        {d.status !== "OPEN" && d.statusReason && <div className="mt-0.5 max-w-[340px] truncate text-[12px]" title={d.statusReason}>Motivo: {d.statusReason}</div>}
      </Td>
      <Td className="text-[12.5px] text-muted">{DEADLINE_TYPE_LABEL[d.type]}</Td>
      <Td>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="tabular">
            {formatDate(d.dueDateLocal)}
            {deadlineHasTime(d) ? ` às ${d.dueTimeLocal}` : ""}
          </span>
          {d.status === "OPEN" && <DeadlineBadge dueDate={d.dueDateLocal} event={d.type === "HEARING"} />}
        </div>
      </Td>
      <Td className="text-[12.5px]">{responsible || <span className="text-danger">Sem responsável</span>}</Td>
      <Td>
        {overdue ? (
          <Badge tone="danger" dot>
            Vencido
          </Badge>
        ) : (
          <StatusBadge status={d.status} labels={DEADLINE_STATUS_LABEL} tones={DEADLINE_STATUS_TONE} />
        )}
        {d.status !== "OPEN" && (d.completedAt ?? d.statusChangedAt) && <div className="mt-0.5 text-[12px] tabular">{formatDateTime(d.completedAt ?? d.statusChangedAt)}</div>}
      </Td>
      <Td className="text-right">
        <div className="flex items-center justify-end gap-1.5">
          <Can permission="processes.edit">
            <DeadlineRowActions deadline={d} onEdit={onEdit} onAction={onAction} />
          </Can>
          <ButtonLink href={href} variant="ghost" size="sm" className="px-2" title={openLabel} aria-label={`${openLabel}: ${d.title}`}>
            <ArrowUpRight className="size-4" aria-hidden />
          </ButtonLink>
        </div>
      </Td>
    </Tr>
  );
}
