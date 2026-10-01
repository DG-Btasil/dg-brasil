import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DefinitionGrid } from "@/components/ui/panel";
import { BILLING_MOMENT_LABEL } from "@/lib/constants/status";
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatting";
import type { AgreementRow } from "../utils";

/** Badge "personalizado" para contratos com valores ajustados ao cliente. */
export function CustomizedBadge() {
  return (
    <Badge tone="gold" title="Valores ajustados para este cliente">
      Personalizado
    </Badge>
  );
}

export function FeeModelCell({ row }: { row: AgreementRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-foreground">{row.feeModel?.name ?? "Sem modelo"}</span>
      {row.agreement.customized && <CustomizedBadge />}
    </div>
  );
}

/** Caso do contrato (o contrato abrange todos os processos do caso). */
export function CaseCell({ row }: { row: AgreementRow }) {
  if (!row.legalCase) return <span className="text-subtle">Caso não encontrado</span>;
  return (
    <Link href={`/casos/${row.legalCase.id}?aba=financeiro`} className="text-navy-700 underline-offset-2 hover:underline">
      {row.legalCase.title}
    </Link>
  );
}

/** Condições contratadas + consolidado financeiro. */
export function AgreementTerms({ row, caseValue }: { row: AgreementRow; caseValue?: number }) {
  const a = row.agreement;
  return (
    <DefinitionGrid
      columns={3}
      items={[
        { label: "Total contratado", value: <span className="tabular">{formatCurrency(a.totalContracted)}</span> },
        { label: "Recebido", value: <span className="tabular">{formatCurrency(row.received)}</span> },
        { label: "Pendente", value: <span className="tabular">{formatCurrency(row.outstandingBalance)}</span> },
        { label: "Entrada", value: a.upfrontFee ? formatCurrency(a.upfrontFee) : null },
        { label: "Valor fixo", value: a.fixedFee ? `${formatCurrency(a.fixedFee)}${a.installments > 1 ? ` em ${a.installments}x` : ""}` : null },
        { label: "Mensalidade", value: a.monthlyFee ? formatCurrency(a.monthlyFee) : null },
        { label: "Êxito", value: a.successFeePercent ? formatPercent(a.successFeePercent) : null },
        {
          label: "Êxito estimado",
          value: a.estimatedSuccessFee ? (
            <span className="tabular">
              {formatCurrency(a.estimatedSuccessFee)} <span className="text-[11.5px] text-muted">(estimativa)</span>
            </span>
          ) : null,
        },
        ...(caseValue !== undefined ? [{ label: "Valor da causa", value: <span className="tabular">{formatCurrency(caseValue)}</span> }] : []),
        { label: "Início", value: formatDate(a.startDate) },
        { label: "Cobrança do modelo", value: row.feeModel ? BILLING_MOMENT_LABEL[row.feeModel.billingMoment] : null },
        ...(a.notes ? [{ label: "Observações", value: a.notes, wide: true }] : []),
      ]}
    />
  );
}
