import { describe, expect, it } from "vitest";
import { partnerCaseTimelineSchema } from "@/server/domain/cases/schemas";
import { timelineItemFromRow } from "@/server/domain/cases/partner-timeline";
import { timelineTone } from "./timeline";

const row = (over: Record<string, unknown> = {}) => ({
  event_id: "case-created:1",
  kind: "CASE",
  title: "Caso cadastrado",
  description: null,
  occurred_at: "2026-10-01T10:00:00Z",
  actor_label: "Paula",
  related_type: "case",
  related_id: "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a",
  total_count: "3",
  ...over,
});

describe("histórico do caso no portal (4.3.1, 036)", () => {
  it("o DTO tem só os campos sanitizados; nada além do que o banco montou", () => {
    const item = timelineItemFromRow(row());
    expect(Object.keys(item).sort()).toEqual(["actorLabel", "description", "id", "kind", "occurredAt", "related", "title"]);
    expect(item).toMatchObject({ id: "case-created:1", kind: "CASE", actorLabel: "Paula", related: { type: "case" } });
  });

  it("tipo desconhecido não quebra a tela; relação desconhecida não vira link", () => {
    expect(timelineItemFromRow(row({ kind: "ALGO_NOVO" })).kind).toBe("CASE");
    expect(timelineItemFromRow(row({ related_type: "audit_event" })).related).toBeUndefined();
    expect(timelineItemFromRow(row({ related_type: null, related_id: null })).related).toBeUndefined();
  });

  it("paginação limitada pelo schema; a cor só depende do tipo", () => {
    expect(partnerCaseTimelineSchema.safeParse({ legalCaseId: "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a", pageSize: 500 }).success).toBe(false);
    expect(partnerCaseTimelineSchema.parse({ legalCaseId: "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a" })).toMatchObject({ page: 1, pageSize: 25 });
    expect([timelineTone("CASE_STATUS"), timelineTone("REQUEST"), timelineTone("DOCUMENT"), timelineTone("PROCESS_EVENT"), timelineTone("CASE")]).toEqual(["gold", "warning", "info", "navy", "neutral"]);
  });
});
