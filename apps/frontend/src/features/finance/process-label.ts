import type { PickerOption } from "@/components/ui/async-picker";
import { formatCNJ } from "@/lib/formatting";
import type { ProcessFinanceDTO } from "@/server/domain/finance/dto";

/** Rótulo do processo nos seletores do financeiro: título + cliente + CNJ (formatado). Puro (servidor e navegador). */
export function processPickerOption(p: Pick<ProcessFinanceDTO, "legalProcessId" | "title" | "clientName" | "cnjNumber">): PickerOption {
  return {
    id: p.legalProcessId,
    label: p.title || "Processo sem título",
    description: [p.clientName, p.cnjNumber ? formatCNJ(p.cnjNumber) : "Sem número CNJ"].filter(Boolean).join(" · "),
  };
}
