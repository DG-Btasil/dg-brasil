"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { Tabs } from "@/components/ui/tabs";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { formatCNJ, formatDocument } from "@/lib/formatting";
import type { Page } from "@/server/core/pagination";
import { listImportRowsAction } from "@/server/domain/imports/actions";
import type { ImportRowDTO } from "@/server/domain/imports/dto";
import type { ROW_FILTERS } from "@/server/domain/imports/schemas";
import { ACTION_LABEL, ROW_STATUS_LABEL, ROW_STATUS_TONE } from "../labels";

export type RowFilter = (typeof ROW_FILTERS)[number];

const FILTER_LABEL: Record<RowFilter, string> = {
  problems: "Com erro ou aviso",
  all: "Todas",
  errors: "Com erro",
  warnings: "Com aviso",
  imported: "Importadas",
  skipped: "Ignoradas",
};

function Outcome({ row }: { row: ImportRowDTO }) {
  const o = row.outcome;
  if (!o || o.result === "ERROR") return null;
  return (
    <p className="mt-1 text-[12px] text-muted">
      {o.clientAction && (
        <>
          Cliente {ACTION_LABEL[o.clientAction] ?? o.clientAction}
          {o.clientId && (
            <>
              {" "}
              (
              <Link className="text-navy-700 hover:underline" href={`/clientes/${o.clientId}`}>
                abrir
              </Link>
              )
            </>
          )}
        </>
      )}
      {o.processAction && (
        <>
          {" · "}Processo {ACTION_LABEL[o.processAction] ?? o.processAction}
          {o.legalProcessId && (
            <>
              {" "}
              (
              <Link className="text-navy-700 hover:underline" href={`/processos/${o.legalProcessId}`}>
                abrir
              </Link>
              )
            </>
          )}
        </>
      )}
      {o.deadlineId && " · prazo criado"}
      {o.reason && <span className="block">{o.reason}</span>}
    </p>
  );
}

/** Linhas da importação, com filtro e paginação no servidor. `version` recarrega. */
export function RowsTable({ jobId, filters, initial, version = 0 }: { jobId: string; filters: RowFilter[]; initial: RowFilter; version?: number }) {
  const [filter, setFilter] = useState<RowFilter>(initial);
  const [page, setPage] = useState(1);
  const key = `${jobId}|${filter}|${page}|${version}`;
  const [loaded, setLoaded] = useState<{ key: string; result: ActionResult<Page<ImportRowDTO>> } | null>(null);
  const data = loaded?.key === key ? loaded.result : null;

  useEffect(() => {
    let alive = true;
    callAction(() => listImportRowsAction({ jobId, filter, page, pageSize: 50 })).then((result) => alive && setLoaded({ key, result }));
    return () => {
      alive = false;
    };
  }, [jobId, filter, page, key]);

  return (
    <div>
      <div className="px-5 pt-3">
        <Tabs
          label="Filtrar linhas"
          items={filters.map((f) => ({ key: f, label: FILTER_LABEL[f] }))}
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setPage(1);
          }}
        />
      </div>
      {!data ? (
        <div className="p-5">
          <SkeletonRows rows={5} />
        </div>
      ) : !data.ok ? (
        <ActionErrorState error={data} title="Não foi possível carregar as linhas." />
      ) : data.data.items.length === 0 ? (
        <EmptyState compact title="Nenhuma linha neste filtro" />
      ) : (
        <>
          <Table caption="Linhas da planilha">
            <THead>
              <tr>
                <Th className="w-16">Linha</Th>
                <Th>Cliente</Th>
                <Th>Processo</Th>
                <Th>Situação</Th>
                <Th>Detalhes</Th>
              </tr>
            </THead>
            <TBody>
              {data.data.items.map((r) => {
                const name = r.clientName ?? Object.values(r.raw ?? {})[0];
                return (
                  <Tr key={r.rowNumber}>
                    <Td className="align-top tabular text-muted">{r.rowNumber}</Td>
                    <Td className="max-w-[240px] align-top">
                      <span className="block truncate">{name ?? <span className="text-subtle">—</span>}</span>
                      {r.clientDocument && <span className="block text-[12px] tabular text-muted">{formatDocument(r.clientDocument)}</span>}
                    </Td>
                    <Td className="align-top text-[12px] tabular">{r.processCnj ? formatCNJ(r.processCnj) : <span className="text-subtle">—</span>}</Td>
                    <Td className="align-top">
                      <Badge tone={ROW_STATUS_TONE[r.status]} dot>
                        {ROW_STATUS_LABEL[r.status]}
                      </Badge>
                    </Td>
                    <Td className="align-top text-[12.5px]">
                      {r.errors.length === 0 && r.warnings.length === 0 && !r.outcome ? (
                        <span className="text-subtle">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {r.errors.map((x, i) => (
                            <li key={`e${i}`} className="text-danger">
                              {x}
                            </li>
                          ))}
                          {r.warnings.map((x, i) => (
                            <li key={`w${i}`} className="text-foreground">
                              {x}
                            </li>
                          ))}
                        </ul>
                      )}
                      <Outcome row={r} />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <Pagination page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPageChange={setPage} noun={{ one: "linha", many: "linhas" }} />
        </>
      )}
    </div>
  );
}
