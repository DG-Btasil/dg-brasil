"use client";

import { useState } from "react";
import { Pencil, Plus, ReceiptText } from "lucide-react";
import { BILLING_MOMENT_LABEL } from "@/lib/constants/status";
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { Can } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, EmptyState } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import type { FeeModelDTO } from "@/server/domain/finance/dto";
import { FEE_BILLING_TYPE_META, feeBillingTypeOf } from "../server-input";
import { FeeModelDrawer } from "./fee-model-drawer";

function valuesSummary(m: FeeModelDTO): string {
  const parts: string[] = [];
  if (m.upfrontFee) parts.push(`Entrada ${formatCurrency(m.upfrontFee)}`);
  if (m.fixedFee) parts.push(`${m.installments && m.installments > 1 ? "Total" : "Fixo"} ${formatCurrency(m.fixedFee)}${m.installments && m.installments > 1 ? ` em ${m.installments}x` : ""}`);
  if (m.monthlyFee) parts.push(`Mensal ${formatCurrency(m.monthlyFee)}`);
  if (m.successFeePercent) parts.push(`Êxito ${formatPercent(m.successFeePercent)}`);
  return parts.join(" · ") || "Sem valores definidos";
}

/**
 * Modelos de honorários do escritório (ADMIN) — no Financeiro (Roadmap 2.0;
 * antes em Configurações). Lidos no servidor; depois de salvar, a página
 * recarrega do servidor.
 */
export function FeeModelsPanel({ models, areas }: { models: ActionResult<Page<FeeModelDTO>>; areas: { value: string; label: string }[] }) {
  const [editing, setEditing] = useState<{ model?: FeeModelDTO } | null>(null);
  const areaName = new Map(areas.map((a) => [a.value, a.label]));
  const newButton = (
    <Can permission="finance.manage">
      <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing({})}>
        Novo modelo
      </Button>
    </Can>
  );

  return (
    <Panel>
      <PanelHeader title="Modelos de honorários" description="Cada modelo define um tipo de cobrança. Ele preenche novos contratos, que podem ser personalizados por processo." actions={newButton} />
      {!models.ok ? (
        <ActionErrorState error={models} title="Não foi possível carregar os modelos." />
      ) : models.data.items.length === 0 ? (
        <EmptyState icon={ReceiptText} title="Nenhum modelo de honorários." description="Crie o primeiro modelo para agilizar os contratos de honorários." action={newButton} />
      ) : (
        <>
          {models.data.hasMore && (
            <Callout tone="warning" className="mx-5 mt-4">
              Há mais modelos do que esta lista mostra. Desative os que não usa mais.
            </Callout>
          )}
          <Table caption="Modelos de honorários">
            <THead>
              <tr>
                <Th>Modelo</Th>
                <Th>Tipo de cobrança</Th>
                <Th>Valores</Th>
                <Th>Cobrança</Th>
                <Th>Área</Th>
                <Th>Situação</Th>
                <Th>Atualizado</Th>
                <Th>
                  <span className="sr-only">Ações</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {models.data.items.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <p className="font-medium text-foreground">{m.name}</p>
                    {m.description && <p className="max-w-[300px] text-[12px] text-muted">{m.description}</p>}
                  </Td>
                  <Td className="text-[12.5px]">{FEE_BILLING_TYPE_META[feeBillingTypeOf(m)].label}</Td>
                  <Td className="text-[12.5px] tabular">{valuesSummary(m)}</Td>
                  <Td className="text-muted">{BILLING_MOMENT_LABEL[m.billingMoment]}</Td>
                  <Td className="text-muted">{m.legalAreaId ? (areaName.get(m.legalAreaId) ?? "—") : "Todas"}</Td>
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
        </>
      )}
      {editing && <FeeModelDrawer model={editing.model} areas={areas} onClose={() => setEditing(null)} onSaved={() => undefined} />}
    </Panel>
  );
}
