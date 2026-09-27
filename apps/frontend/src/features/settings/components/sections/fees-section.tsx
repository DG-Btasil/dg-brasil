"use client";

import { useState } from "react";
import { Pencil, Plus, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/states";
import { FeeModelDrawer } from "@/features/finance/components/fee-model-drawer";
import { useFeeModels } from "@/features/finance/hooks";
import { BILLING_MOMENT_LABEL } from "@/lib/constants/status";
import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatting";
import type { FeeModel } from "@/types";
import { SectionHeader } from "../section-header";

function valuesSummary(m: FeeModel): string {
  const parts: string[] = [];
  if (m.upfrontFee) parts.push(`Entrada ${formatCurrency(m.upfrontFee)}`);
  if (m.fixedFee) parts.push(`Fixo ${formatCurrency(m.fixedFee)}${m.installments && m.installments > 1 ? ` em ${m.installments}x` : ""}`);
  if (m.monthlyFee) parts.push(`Mensal ${formatCurrency(m.monthlyFee)}`);
  if (m.successFeePercent) parts.push(`Êxito ${formatPercent(m.successFeePercent)}`);
  return parts.join(" · ") || "Sem valores definidos";
}

export function FeesSection() {
  const models = useFeeModels();
  const [editing, setEditing] = useState<{ open: boolean; model?: FeeModel }>({ open: false });
  const openNew = () => setEditing({ open: true, model: undefined });

  return (
    <div>
      <SectionHeader
        title="Modelos de honorários"
        description="Cada escritório define seus próprios modelos. Eles preenchem novos contratos e podem ser personalizados por cliente."
        actions={
          <Button icon={<Plus className="size-4" aria-hidden />} onClick={openNew}>
            Novo modelo
          </Button>
        }
      />
      <Panel>
        {models.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="Nenhum modelo de honorários."
            description="Crie o primeiro modelo para agilizar os contratos de honorários."
            action={
              <Button icon={<Plus className="size-4" aria-hidden />} onClick={openNew}>
                Novo modelo
              </Button>
            }
          />
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
              {models.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <p className="font-medium text-foreground">{m.name}</p>
                    {m.description && <p className="max-w-[320px] text-[12px] text-muted">{m.description}</p>}
                  </Td>
                  <Td className="text-muted">{m.area ? LEGAL_AREA_LABEL[m.area] : "Todas"}</Td>
                  <Td className="text-[12.5px] tabular">{valuesSummary(m)}</Td>
                  <Td className="text-muted">{BILLING_MOMENT_LABEL[m.billingMoment]}</Td>
                  <Td>
                    <Badge tone={m.active ? "success" : "neutral"} dot>
                      {m.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </Td>
                  <Td className="tabular text-muted">{formatDate(m.updatedAt)}</Td>
                  <Td className="text-right">
                    <IconButton label={`Editar ${m.name}`} size="sm" onClick={() => setEditing({ open: true, model: m })}>
                      <Pencil className="size-3.5" aria-hidden />
                    </IconButton>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
      <FeeModelDrawer open={editing.open} model={editing.model} onOpenChange={(open) => setEditing((e) => ({ ...e, open }))} />
    </div>
  );
}
