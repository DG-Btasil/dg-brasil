import type { Tone } from "@/lib/constants/status";
import type { PartnerTimelineKind } from "@/server/domain/cases/partner-timeline";

/** Cor do ponto no histórico do portal, por tipo de evento (só apresentação). */
export function timelineTone(kind: PartnerTimelineKind): Tone {
  switch (kind) {
    case "CASE_STATUS":
      return "gold";
    case "REQUEST":
    case "REQUEST_MESSAGE":
    case "REQUIREMENT":
      return "warning";
    case "DOCUMENT":
      return "info";
    case "PROCESS":
    case "PROCESS_EVENT":
      return "navy";
    default:
      return "neutral";
  }
}
