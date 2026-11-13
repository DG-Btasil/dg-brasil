"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, LayoutList, Rows3, SearchX } from "lucide-react";
import { cn } from "@/lib/cn";
import { pluralize } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useDebouncedCallback, useServerList } from "@/lib/hooks/use-server-list";
import { PageContainer } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Checkbox, SearchInput, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { Tabs } from "@/components/ui/tabs";
import type { ReviewGroupDTO, ReviewListItem, ReviewSummaryDTO } from "@/server/domain/reviews/dto";
import {
  clearReviewFilters,
  countReviewFilters,
  REVIEW_DB_STATUSES,
  REVIEW_DUE_FILTERS,
  REVIEW_DUE_LABEL,
  REVIEW_KIND_LABEL,
  REVIEW_KINDS,
  REVIEW_MODE_LABEL,
  REVIEW_MODES,
  REVIEW_PAGE_SIZE,
  REVIEW_PRIORITY_OPTIONS,
  REVIEW_SEARCH_MAX,
  REVIEW_VIEW_LABEL,
  REVIEW_VIEWS,
  reviewQueryFitsUrl,
  reviewQueryToSearchParams,
  toggleReviewCounter,
  type ReviewListQuery,
  type ReviewMode,
} from "../list-query";
import { loadReviewQueue } from "../load-queue";
import type { ReviewQueueEntry, ReviewQueuePage } from "../queue-entries";
import { ReviewGroupList } from "./review-group-list";
import { DB_STATUS_LABEL, ReviewTable } from "./review-table";
import { ReviewSummaryStrip, useReviewSummary } from "./review-summary-strip";

const KIND_OPTIONS = REVIEW_KINDS.map((k) => ({ value: k, label: REVIEW_KIND_LABEL[k] }));
const STATUS_OPTIONS = REVIEW_DB_STATUSES.map((s) => ({ value: s, label: DB_STATUS_LABEL[s] }));
const DUE_OPTIONS = REVIEW_DUE_FILTERS.map((d) => ({ value: d, label: REVIEW_DUE_LABEL[d] }));
const MODE_ICON = { grupos: Rows3, lista: LayoutList } as const;

/** Alternância entre a fila agrupada por execução e a lista item a item. */
function ModeSwitch({ value, onChange }: { value: ReviewMode; onChange: (mode: ReviewMode) => void }) {
  return (
    <div role="group" aria-label="Modo de exibição da fila" className="inline-flex rounded-md border border-line-strong bg-surface p-0.5">
      {REVIEW_MODES.map((mode) => {
        const Icon = MODE_ICON[mode];
        const active = mode === value;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={active}
            onClick={() => !active && onChange(mode)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[12.5px] font-medium transition-colors",
              active ? "bg-navy text-white" : "text-muted hover:bg-surface-sunken hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {REVIEW_MODE_LABEL[mode]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Fila de revisões humanas (ADMIN e LAWYER) lida do servidor: visões, filtros,
 * busca e páginas no banco (RLS), estado na URL. "IA executa. Humano decide."
 * Por padrão a fila vem agrupada por execução do agente (um trabalho gera
 * muitos itens); "Lista" mostra item a item, como antes. Acima das abas, os
 * indicadores da fila inteira (contados no banco), que também são atalhos de
 * filtro.
 */
export function ReviewQueue({
  initialQuery,
  initialResult,
  initialSummary,
}: {
  initialQuery: ReviewListQuery;
  initialResult: ActionResult<ReviewQueuePage>;
  /** Indicadores da fila, contados no servidor junto com a primeira página. */
  initialSummary?: ActionResult<ReviewSummaryDTO>;
}) {
  const router = useRouter();
  const { summary, refresh: refreshSummary } = useReviewSummary(initialSummary);
  const { query, setQuery, result, pending, retry } = useServerList<ReviewListQuery, ReviewQueueEntry>({
    initialQuery,
    initialResult,
    load: (q: ReviewListQuery) => {
      // A lista recarrega a cada filtro: os indicadores são recontados junto (a fila pode ter mudado).
      refreshSummary();
      return loadReviewQueue(q);
    },
    toSearch: reviewQueryToSearchParams,
  });
  const [search, setSearch] = useState(query.search);
  const commitSearch = useDebouncedCallback((text: string) => setQuery({ ...query, search: text.trim(), page: 1 }));
  const page = result.ok ? result.data : undefined;
  const filtered = countReviewFilters(query) > 0;
  const tabs = REVIEW_VIEWS.map((key) => ({ key, label: REVIEW_VIEW_LABEL[key] }));
  // A página é desenhada pelo que veio do servidor (grupos ou revisões), não pelo modo recém-escolhido.
  const groups = page?.items.flatMap((e): ReviewGroupDTO[] => (e.type === "group" ? [e.group] : [])) ?? [];
  const reviews = page?.items.flatMap((e): ReviewListItem[] => (e.type === "review" ? [e.review] : [])) ?? [];
  const grouped = page ? groups.length > 0 : query.mode === "grupos";
  const totalItems = page && "totalItems" in page && typeof page.totalItems === "number" ? page.totalItems : undefined;

  function clear(view = query.view) {
    setSearch("");
    setQuery(clearReviewFilters(query, view));
  }

  /** Depois de uma decisão em conjunto: a fila, os indicadores e os contadores do menu são lidos de novo. */
  function changed() {
    retry();
    if (reviewQueryFitsUrl(query)) router.refresh();
  }

  return (
    <PageContainer>
      <PageHeader
        title="Revisões"
        description="Tudo o que os agentes produzem passa por aqui antes de seguir. Nada vira ação externa sem a sua decisão."
      />
      {summary?.ok && (
        <ReviewSummaryStrip
          summary={summary.data}
          query={query}
          onToggle={(counter) => {
            if (counter === "open") setSearch("");
            setQuery(toggleReviewCounter(query, counter));
          }}
        />
      )}
      <Tabs items={tabs} value={query.view} onChange={(view) => clear(view)} label="Visões da fila de revisões" className="mb-4" />
      <Panel>
        <div className="border-b border-line px-5 py-3" role="search" aria-label="Filtrar revisões">
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              aria-label="Buscar revisões por cliente, caso, título ou agente"
              placeholder="Buscar por cliente, caso, título ou agente"
              value={search}
              maxLength={REVIEW_SEARCH_MAX}
              onChange={(e) => {
                setSearch(e.target.value);
                commitSearch(e.target.value);
              }}
              className="w-[380px] max-w-full"
            />
            <ModeSwitch value={query.mode} onChange={(mode) => setQuery({ ...query, mode, page: 1 })} />
            {page && (
              <p className="ml-auto text-[12.5px] text-muted" aria-live="polite">
                {grouped
                  ? `${pluralize(totalItems ?? 0, "revisão", "revisões")} em ${pluralize(page.total, "grupo", "grupos")}`
                  : pluralize(page.total, "revisão", "revisões")}
                {query.view !== "todas" && " · mais antigas primeiro"}
              </p>
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <Select
              aria-label="Prioridade"
              placeholder="Todas as prioridades"
              options={REVIEW_PRIORITY_OPTIONS}
              value={query.priority}
              onChange={(e) => setQuery({ ...query, priority: e.target.value as ReviewListQuery["priority"], page: 1 })}
              className="h-8 w-[180px] text-[12.5px]"
            />
            <Select
              aria-label="Tipo"
              placeholder="Todos os tipos"
              options={KIND_OPTIONS}
              value={query.kind}
              onChange={(e) => setQuery({ ...query, kind: e.target.value as ReviewListQuery["kind"], page: 1 })}
              className="h-8 w-[200px] text-[12.5px]"
            />
            {query.view === "todas" && (
              <Select
                aria-label="Situação"
                placeholder="Todas as situações"
                options={STATUS_OPTIONS}
                value={query.status}
                onChange={(e) => setQuery({ ...query, status: e.target.value as ReviewListQuery["status"], page: 1 })}
                className="h-8 w-[200px] text-[12.5px]"
              />
            )}
            <Select
              aria-label="Prazo"
              placeholder="Qualquer prazo"
              options={DUE_OPTIONS}
              value={query.due}
              onChange={(e) => setQuery({ ...query, due: e.target.value as ReviewListQuery["due"], page: 1 })}
              className="h-8 w-[260px] text-[12.5px]"
            />
            {query.view !== "minhas" && (
              <Checkbox label="Sem responsável" checked={query.unassigned} onChange={(e) => setQuery({ ...query, unassigned: e.target.checked, page: 1 })} className="items-center" />
            )}
          </div>
        </div>
        <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
          {!result.ok ? (
            <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar as revisões." />
          ) : !page ? (
            <SkeletonRows rows={5} />
          ) : page.items.length === 0 ? (
            filtered ? (
              <EmptyState
                icon={SearchX}
                title="Nenhuma revisão corresponde aos filtros."
                action={
                  <Button variant="secondary" onClick={() => clear()}>
                    Limpar filtros
                  </Button>
                }
              />
            ) : query.view === "todas" ? (
              <EmptyState title="Nenhuma revisão registrada." />
            ) : (
              <EmptyState
                icon={CheckCircle2}
                title="Nenhuma revisão aguardando decisão."
                description="Quando um agente concluir uma tarefa que exige confirmação, o material aparecerá aqui para você aprovar, pedir ajustes ou rejeitar."
              />
            )
          ) : (
            <>
              {groups.length > 0 ? <ReviewGroupList groups={groups} query={query} onChanged={changed} /> : <ReviewTable rows={reviews} />}
              <Pagination
                page={page.page}
                pageSize={REVIEW_PAGE_SIZE}
                total={page.total}
                disabled={pending}
                onPageChange={(p) => setQuery({ ...query, page: p })}
                noun={groups.length > 0 ? { one: "grupo", many: "grupos" } : { one: "revisão", many: "revisões" }}
              />
            </>
          )}
        </div>
      </Panel>
    </PageContainer>
  );
}
