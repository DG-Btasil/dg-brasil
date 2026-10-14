"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, ReceiptText } from "lucide-react";
import { BILLING_MOMENT_LABEL } from "@/lib/constants/status";
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { Can } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { getCaseCatalogAction } from "@/server/domain/cases/actions";
import { listFeeModelsAction } from "@/server/domain/finance/actions";
import type { FeeModelDTO } from "@/server/domain/finance/dto";
import { FeeModelDrawer } from "@/features/finance/components/fee-model-drawer";
import { SectionHeader } from "../section-header";

function valuesSummary(m: FeeModelDTO): string {
  const parts: string[] = [];
  if (m.upfrontFee) parts.push(`Entrada ${formatCurrency(m.upfrontFee)}`);
  if (m.fixedFee) parts.push(`Fixo ${formatCurrency(m.fixedFee)}${m.installments && m.installments > 1 ? ` em ${m.installments}x` : ""}`);
  if (m.monthlyFee) parts.push(`Mensal ${formatCurrency(m.monthlyFee)}`);
  if (m.successFeePercent) parts.push(`Êxito ${formatPercent(m.successFeePercent)}`);
  return parts.join(" · ") || "Sem valores definidos";
}

/** Modelos de honorários do escritório (ADMIN), lidos e gravados no servidor. */
export function FeesSection() {
  const [result, setResult] = useState<ActionResult<Page<FeeModelDTO>> | null>(null);
  const [areas, setAreas] = useState<{ value: string; label: string }[]>([]);
  const [editing, setEditing] = useState<{ model?: FeeModelDTO } | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    callAction(() => listFeeModelsAction({ pageSize: 100 })).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [version]);

  useEffect(() => {
    let alive = true;
    callAction(() => getCaseCatalogAction()).then((r) => alive && r.ok && setAreas(r.data.areas.map((a) => ({ value: a.id, label: a.name }))));
    return () => {
      alive = false;
    };
  }, []);

  const areaName = new Map(areas.map((a) => [a.value, a.label]));
  const newButton = (
    <Can permission="finance.manage">
      <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing({})}>
        Novo modelo
      </Button>
    </Can>
  );

  return (
    <div>
      <SectionHeader title="Modelos de honorários" description="Cada escritório define seus próprios modelos. Eles preenchem novos contratos e podem ser personalizados por caso." actions={newButton} />
      <Panel>
        {!result ? (
          <SkeletonRows rows={3} />
        ) : !result.ok ? (
          <ActionErrorState error={result} onRetry={reload} title="Não foi possível carregar os modelos." />
        ) : result.data.items.length === 0 ? (
          <EmptyState icon={ReceiptText} title="Nenhum modelo de honorários." description="Crie o primeiro modelo para agilizar os contratos de honorários." action={newButton} />
        ) : (
          <Table caption="Modelos de honorários">
            <THead>
              <tr>
                <Th>Modelo</Th>
                <Th>Área</Th>
                <Th>Valores</Th>
                <Th>Cobrança</Th>
                <Th>Situação</Th>
                <Th>Atualizado</Th>
                <Th>
                  <span className="sr-only">Ações</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {result.data.items.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <p className="font-medium text-foreground">{m.name}</p>
                    {m.description && <p className="max-w-[320px] text-[12px] text-muted">{m.description}</p>}
                  </Td>
                  <Td className="text-muted">{m.legalAreaId ? (areaName.get(m.legalAreaId) ?? "—") : "Todas"}</Td>
                  <Td className="text-[12.5px] tabular">{valuesSummary(m)}</Td>
                  <Td className="text-muted">{BILLING_MOMENT_LABEL[m.billingMoment]}</Td>
                  <Td>
                    <Badge tone={m.active ? "success" : "neutral"} dot>
                      {m.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </Td>
                  <Td className="tabular text-muted">{formatDate(m.updatedAt)}</Td>
                  <Td className="text-right">
                    <Can permission="finance.manage">
                      <IconButton label={`Editar ${m.name}`} size="sm" onClick={() => setEditing({ model: m })}>
                        <Pencil className="size-3.5" aria-hidden />
                      </IconButton>
                    </Can>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
      {editing && <FeeModelDrawer model={editing.model} areas={areas} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
