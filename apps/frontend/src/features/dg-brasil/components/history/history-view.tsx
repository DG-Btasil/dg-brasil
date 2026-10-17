import Link from "next/link";
import { History } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { ActionResult } from "@/lib/actions/result";
import { formatDateTime } from "@/lib/formatting";
import type { HistoryEntryDTO } from "@/server/domain/dg/dto";
import { dgRoutes, formatVersion } from "../../utils";
import { DiffView } from "../shared/diff-view";

const ENTITY_LABEL: Record<HistoryEntryDTO["entityType"], string> = { AGENT: "Agente", SKILL: "Skill", THESIS: "Tese", REFERENCE: "Referência" };

function href(e: HistoryEntryDTO): string | undefined {
  if (e.entityType === "AGENT") return dgRoutes.agent(e.entityId);
  if (e.entityType === "SKILL") return dgRoutes.skill(e.entityId);
  if (e.entityType === "THESIS") return dgRoutes.thesis(e.entityId);
  return undefined;
}

/** Histórico real: cada versão criada (append-only), com a diferença para a anterior. */
export function HistoryView({ result }: { result: ActionResult<HistoryEntryDTO[]> }) {
  if (!result.ok) return <ActionErrorState error={result} title="Não foi possível carregar o histórico." />;
  const entries = result.data;
  return (
    <Panel>
      <PanelHeader title="Histórico de alterações" description="Toda versão nova de agente, skill, tese ou referência. Execuções antigas continuam ligadas à versão que usaram." />
      {entries.length === 0 ? (
        <EmptyState icon={History} title="Nenhuma alteração registrada." />
      ) : (
        <ol className="divide-y divide-line">
          {entries.map((e) => {
            const link = href(e);
            return (
              <li key={e.id} className="px-5 py-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
                  <Badge tone={e.action === "CREATED" ? "success" : "info"}>{e.action === "CREATED" ? "Criação" : "Alteração"}</Badge>
                  <span className="text-subtle">{ENTITY_LABEL[e.entityType]}</span>
                  {link ? (
                    <Link href={link} className="font-medium text-navy hover:underline underline-offset-2">
                      {e.entityName}
                    </Link>
                  ) : (
                    <span className="font-medium text-foreground">{e.entityName}</span>
                  )}
                  <span className="tabular text-muted">{formatVersion(e.version)}</span>
                  <span className="ml-auto text-[12px] text-muted">
                    {formatDateTime(e.at)}
                    {e.authorName ? ` · ${e.authorName}` : ""}
                  </span>
                </div>
                <details>
                  <summary className="cursor-pointer text-[12.5px] font-medium text-navy">Ver diferenças</summary>
                  <DiffView lines={e.diff} className="mt-2" />
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
