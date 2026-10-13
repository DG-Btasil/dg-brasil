"use client";

import { CheckCircle2, SearchX } from "lucide-react";
import { cn } from "@/lib/cn";
import { PRIORITIES, PRIORITY_LABEL, type Priority } from "@/lib/constants/status";
import { pluralize } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useServerList } from "@/lib/hooks/use-server-list";
import { PageContainer } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Checkbox, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { Tabs } from "@/components/ui/tabs";
import type { Page } from "@/server/core/pagination";
import { listReviewsAction } from "@/server/domain/reviews/actions";
import type { ReviewListItem } from "@/server/domain/reviews/dto";
import {
  DEFAULT_REVIEW_QUERY,
  REVIEW_DB_STATUSES,
  REVIEW_KIND_LABEL,
  REVIEW_KINDS,
  REVIEW_PAGE_SIZE,
  REVIEW_VIEW_LABEL,
  REVIEW_VIEWS,
  reviewQueryToInput,
  reviewQueryToSearchParams,
  type ReviewListQuery,
} from "../list-query";
import { DB_STATUS_LABEL, ReviewTable } from "./review-table";

const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }));
const KIND_OPTIONS = REVIEW_KINDS.map((k) => ({ value: k, label: REVIEW_KIND_LABEL[k] }));
const STATUS_OPTIONS = REVIEW_DB_STATUSES.map((s) => ({ value: s, label: DB_STATUS_LABEL[s] }));

/**
 * Fila de revisões humanas (ADMIN e LAWYER) lida do servidor: visões, filtros
 * e páginas no banco (RLS), estado na URL. "IA executa. Humano decide."
 */
export function ReviewQueue({ initialQuery, initialResult }: { initialQuery: ReviewListQuery; initialResult: ActionResult<Page<ReviewListItem>> }) {
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery,
    initialResult,
    load: (q: ReviewListQuery) => listReviewsAction(reviewQueryToInput(q)),
    toSearch: reviewQueryToSearchParams,
  });
  const page = result.ok ? result.data : undefined;
  const filtered = !!query.priority || !!query.kind || !!query.status || query.unassigned;
  const tabs = REVIEW_VIEWS.map((key) => ({ key, label: REVIEW_VIEW_LABEL[key] }));

  return (
    <PageContainer>
      <PageHeader
        title="Revisões"
        description="Tudo o que os agentes produzem passa por aqui antes de seguir. Nada vira ação externa sem a sua decisão."
      />
      <Tabs items={tabs} value={query.view} onChange={(view) => setQuery({ ...DEFAULT_REVIEW_QUERY, view })} label="Visões da fila de revisões" className="mb-4" />
      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3" role="search" aria-label="Filtrar revisões">
          <Select
            aria-label="Prioridade"
            placeholder="Todas as prioridades"
            options={PRIORITY_OPTIONS}
            value={query.priority}
            onChange={(e) => setQuery({ ...query, priority: e.target.value as Priority | "", page: 1 })}
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
          {query.view !== "minhas" && (
            <Checkbox label="Sem responsável" checked={query.unassigned} onChange={(e) => setQuery({ ...query, unassigned: e.target.checked, page: 1 })} className="items-center" />
          )}
          {page && (
            <p className="ml-auto text-[12.5px] text-muted" aria-live="polite">
              {pluralize(page.total, "revisão", "revisões")}
              {query.view !== "todas" && " · mais antigas primeiro"}
            </p>
          )}
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
                  <Button variant="secondary" onClick={() => setQuery({ ...DEFAULT_REVIEW_QUERY, view: query.view })}>
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
              <ReviewTable rows={page.items} />
              <Pagination page={page.page} pageSize={REVIEW_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={{ one: "revisão", many: "revisões" }} />
            </>
          )}
        </div>
      </Panel>
    </PageContainer>
  );
}
