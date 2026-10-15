import type { SupabaseClient } from "@supabase/supabase-js";
import { isPartner, requirePermission, type ServiceContext } from "@/server/core/context";
import { unwrap } from "@/server/core/db-errors";
import { forbidden } from "@/server/core/errors";
import { toPage, toRange, type Page } from "@/server/core/pagination";
import type { ID, ISODateTime } from "@/types";

/**
 * Histórico do caso no Portal do Parceiro (4.3.1, migration 036). O banco
 * monta cada item a partir das fontes que o parceiro pode conhecer (caso,
 * processos, movimentações oficiais, documentos compartilhados, pendências,
 * solicitações) — NUNCA devolve linha de auditoria, nota/motivo interno,
 * revisão, análise ou execução de agente. Este módulo só pagina e tipa.
 */

export const PARTNER_TIMELINE_KINDS = ["CASE", "CASE_STATUS", "PROCESS", "PROCESS_EVENT", "DOCUMENT", "REQUIREMENT", "REQUEST", "REQUEST_MESSAGE"] as const;
export type PartnerTimelineKind = (typeof PARTNER_TIMELINE_KINDS)[number];

export interface PartnerTimelineItemDTO {
  id: string;
  kind: PartnerTimelineKind;
  title: string;
  description?: string;
  occurredAt: ISODateTime;
  /** "Fulano" (do próprio escritório) ou o nome do escritório responsável. */
  actorLabel?: string;
  related?: { type: "case" | "process" | "document" | "request"; id: ID };
}

interface TimelineRow {
  event_id: string;
  kind: string;
  title: string;
  description: string | null;
  occurred_at: string;
  actor_label: string | null;
  related_type: string | null;
  related_id: string | null;
  total_count: number | string;
}

const RELATED = new Set(["case", "process", "document", "request"]);

export function timelineItemFromRow(r: TimelineRow): PartnerTimelineItemDTO {
  return {
    id: r.event_id,
    kind: (PARTNER_TIMELINE_KINDS as readonly string[]).includes(r.kind) ? (r.kind as PartnerTimelineKind) : "CASE",
    title: r.title,
    description: r.description ?? undefined,
    occurredAt: r.occurred_at,
    actorLabel: r.actor_label ?? undefined,
    related: r.related_type && r.related_id && RELATED.has(r.related_type) ? { type: r.related_type as "case", id: r.related_id } : undefined,
  };
}

async function fetchTimeline(db: SupabaseClient, legalCaseId: string, offset: number, limit: number): Promise<{ rows: TimelineRow[]; total: number }> {
  const rows = (unwrap(await db.rpc("get_partner_case_timeline", { p_legal_case_id: legalCaseId, p_offset: offset, p_limit: limit })) ?? []) as TimelineRow[];
  return { rows, total: rows.length ? Number(rows[0].total_count) : 0 };
}

/** Só parceiro (o histórico interno é a auditoria, para ADMIN). */
export async function getPartnerCaseTimeline(ctx: ServiceContext, input: { legalCaseId: string; page: number; pageSize: number }): Promise<Page<PartnerTimelineItemDTO>> {
  if (!isPartner(ctx)) throw forbidden("O histórico do portal é do escritório parceiro.");
  requirePermission(ctx, "partnerPortal.view");
  const { from } = toRange(input);
  const { rows, total } = await fetchTimeline(ctx.db, input.legalCaseId, from, input.pageSize);
  return toPage(rows.map(timelineItemFromRow), total, input);
}
