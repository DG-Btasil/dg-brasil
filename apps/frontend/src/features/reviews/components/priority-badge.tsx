import { ArrowDown, ArrowUp, ChevronsUp, Minus } from "lucide-react";
import { PRIORITY_LABEL, PRIORITY_TONE, type Priority } from "@/lib/constants/status";
import { Badge } from "@/components/ui/badge";

const ICON = { LOW: ArrowDown, NORMAL: Minus, HIGH: ArrowUp, URGENT: ChevronsUp } as const;

/** Prioridade com ícone + texto (nunca só cor). */
export function PriorityBadge({ priority }: { priority: Priority }) {
  const Icon = ICON[priority];
  return (
    <Badge tone={PRIORITY_TONE[priority]} icon={<Icon className="size-3" aria-hidden />}>
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}
