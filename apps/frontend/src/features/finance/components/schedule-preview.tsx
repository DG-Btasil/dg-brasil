import { StatusBadge } from "@/components/ui/badge";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from "@/lib/constants/status";
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatting";
import { MONTHLY_PREVIEW_COUNT, contractedTotal, estimateSuccessFee, previewSchedule, type FeeValues } from "../utils";

/** Prévia do cronograma que será gerado ao salvar o contrato. */
export function SchedulePreview({ values, startDate, caseValue }: { values: FeeValues; startDate: string; caseValue?: number }) {
  const items = previewSchedule(values, startDate);
  const total = contractedTotal(values);
  const success = estimateSuccessFee(values.successFeePercent, caseValue);

  return (
    <section aria-labelledby="schedule-preview-title" className="rounded-md border border-line bg-surface-muted">
      <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3">
        <h3 id="schedule-preview-title" className="text-[13px] font-semibold text-foreground">
          Prévia do cronograma
        </h3>
        <p className="text-[12.5px] text-muted">
          Total contratado <span className="ml-1 font-semibold tabular text-navy">{formatCurrency(total)}</span>
        </p>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-[12.5px] text-muted">
          {values.successFeePercent
            ? "Sem parcelas programadas: os honorários deste contrato dependem do êxito."
            : "Informe valores e a data de início para visualizar as parcelas."}
        </p>
      ) : (
        <ol className="max-h-[240px] divide-y divide-line overflow-y-auto">
          {items.map((item) => (
            <li key={item.key} className="grid grid-cols-[minmax(0,1fr)_100px_110px_110px] items-center gap-3 px-4 py-2 text-[12.5px]">
              <span className="text-foreground">{item.description}</span>
              <span className="tabular text-muted">{formatDate(item.dueDate)}</span>
              <span className="text-right tabular">{formatCurrency(item.amount)}</span>
              <span className="text-right">
                <StatusBadge status={item.status} labels={PAYMENT_STATUS_LABEL} tones={PAYMENT_STATUS_TONE} />
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="space-y-1 border-t border-line px-4 py-2.5 text-[12px] text-muted">
        {values.successFeePercent ? (
          <p>
            Êxito de {formatPercent(values.successFeePercent)}
            {success ? (
              <>
                {" "}
                — estimativa de <span className="tabular text-foreground">{formatCurrency(success)}</span> sobre o valor da causa de{" "}
                <span className="tabular">{formatCurrency(caseValue)}</span>.
              </>
            ) : (
              " — estimativa disponível quando o contrato estiver vinculado a um processo com valor da causa."
            )}
          </p>
        ) : null}
        {values.monthlyFee ? <p>Mensalidades: o cronograma inicial lança {MONTHLY_PREVIEW_COUNT} competências; as seguintes serão geradas pelo backend.</p> : null}
        <p>Prévia com base nos valores informados. O cronograma definitivo é gerado ao salvar.</p>
      </div>
    </section>
  );
}
