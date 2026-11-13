import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireInternal, requirePermission, requireRole, type ServiceContext } from "@/server/core/context";
import { unwrap } from "@/server/core/db-errors";
import { DomainError } from "@/server/core/errors";
import { callPrivate } from "@/server/core/worker-db";
import { DatajudClient } from "@/server/integrations/judicial/datajud";
import { DjenClient } from "@/server/integrations/judicial/djen";
import { JUDICIAL_DB_FUNCTIONS, runJudicialSync, type JudicialDbFunction, type JudicialSyncDeps } from "@/server/integrations/judicial/sync";
import type {
  CoverageDayDTO, DeadlineCountDTO, JudicialCaptureAlertDTO, JudicialOverviewDTO, JudicialPublicationDetailDTO, JudicialSyncNowDTO,
  MyJudicialMonitorsDTO, ProcessJudicialStatusDTO, PublicationPageDTO,
} from "./dto";
import type { z } from "zod";
import type {
  calendarDaySchema, coverageSchema, createDeadlineSchema, decideSchema, listPublicationsSchema, previewSchema,
  saveMonitorSchema, settingsSchema,
} from "./schemas";

/**
 * Integração judicial (043). Telas: RPCs com o JWT do usuário (o banco confere
 * papel e escopo — parceiro só vê e mexe nas OABs do próprio escritório).
 * Busca no DJEN/DataJud: servidor, login dg_worker (sync.ts).
 */

const rpc = async <T>(db: SupabaseClient, fn: string, args: Record<string, unknown> = {}) => unwrap(await db.rpc(fn, args)) as T;

/** Resposta do banco (snake_case, null) → DTO (camelCase, ausente). */
export function camel<T>(v: unknown): T {
  if (Array.isArray(v)) return v.map((x) => camel(x)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === null) continue;
      out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = camel(x);
    }
    return out as T;
  }
  return v as T;
}

/** Dependências da rodada (rota agendada e "Buscar agora"). */
export function judicialSyncDeps(log: ServiceContext["log"], deadline?: number): JudicialSyncDeps {
  return {
    db: <T>(fn: JudicialDbFunction, args: unknown[]) => callPrivate<T>(JUDICIAL_DB_FUNCTIONS, fn, args),
    djen: new DjenClient(),
    datajud: new DatajudClient(),
    log,
    deadline,
  };
}

// ─────────────────────────── visão geral e configuração ───────────────────

export async function getOverview(ctx: ServiceContext): Promise<JudicialOverviewDTO> {
  requireRole(ctx, "ADMIN", "LAWYER");
  return camel<JudicialOverviewDTO>(await rpc(ctx.db, "get_judicial_overview"));
}

/** Estado da captura do dia, para a faixa de alerta da Home (062). */
export async function getCaptureAlert(ctx: ServiceContext): Promise<JudicialCaptureAlertDTO> {
  requireRole(ctx, "ADMIN", "LAWYER");
  return camel<JudicialCaptureAlertDTO>(await rpc(ctx.db, "get_judicial_capture_alert"));
}

export async function saveSettings(ctx: ServiceContext, v: z.infer<typeof settingsSchema>) {
  requireRole(ctx, "ADMIN");
  const p: Record<string, unknown> = {};
  if (v.djenEnabled !== undefined) p.djen_enabled = v.djenEnabled;
  if (v.datajudEnabled !== undefined) p.datajud_enabled = v.datajudEnabled;
  if (v.lookbackDays !== undefined) p.lookback_days = v.lookbackDays;
  if (v.deadlineAgentId !== undefined) p.deadline_agent_id = v.deadlineAgentId;
  if (v.deadlineAutoApply !== undefined) p.deadline_auto_apply = v.deadlineAutoApply;
  if (v.deadlineAutoTask !== undefined) p.deadline_auto_task = v.deadlineAutoTask;
  if (v.agentTimeoutHours !== undefined) p.agent_timeout_hours = v.agentTimeoutHours;
  return rpc<{ ok: boolean }>(ctx.db, "save_judicial_settings", { p_settings: p });
}

export async function saveCalendarDay(ctx: ServiceContext, v: z.infer<typeof calendarDaySchema>) {
  requireRole(ctx, "ADMIN");
  return rpc<{ id: string }>(ctx.db, "save_court_calendar_day", {
    p_court: v.court || null, p_day: v.day, p_kind: v.kind, p_description: v.description,
  });
}

export async function deleteCalendarDay(ctx: ServiceContext, id: string) {
  requireRole(ctx, "ADMIN");
  return rpc<{ ok: boolean }>(ctx.db, "delete_court_calendar_day", { p_id: id });
}

// ─────────────────────────── OABs ─────────────────────────────────────────

export async function saveMonitor(ctx: ServiceContext, v: z.infer<typeof saveMonitorSchema>) {
  // ADMIN (qualquer escritório) ou administrador do parceiro (o próprio). O banco decide o escritório.
  requireRole(ctx, "ADMIN", "PARTNER_ADMIN");
  return rpc<{ id: string; created: boolean }>(ctx.db, "save_judicial_monitor", {
    p_oab_number: v.oabNumber,
    p_oab_state: v.oabState,
    p_lawyer_name: v.lawyerName || null,
    p_organization_id: ctx.session.role === "ADMIN" ? v.organizationId ?? null : null,
    p_responsible_user_id: ctx.session.role === "ADMIN" ? v.responsibleUserId ?? null : null,
  });
}

export async function setMonitorActive(ctx: ServiceContext, id: string, active: boolean) {
  requireRole(ctx, "ADMIN", "PARTNER_ADMIN");
  return rpc<{ id: string; active: boolean }>(ctx.db, "set_judicial_monitor_active", { p_id: id, p_active: active });
}

export async function getMyMonitors(ctx: ServiceContext): Promise<MyJudicialMonitorsDTO> {
  requirePermission(ctx, "partnerPortal.view");
  return camel<MyJudicialMonitorsDTO>(await rpc(ctx.db, "get_my_judicial_monitors"));
}

export async function getCoverage(ctx: ServiceContext, v: z.infer<typeof coverageSchema>): Promise<CoverageDayDTO[]> {
  return camel<CoverageDayDTO[]>(await rpc(ctx.db, "get_judicial_coverage", {
    p_oab_number: v.oabNumber, p_oab_state: v.oabState, p_from: v.from ?? null, p_to: v.to ?? null,
  }));
}

// ─────────────────────────── publicações ──────────────────────────────────

export async function listPublications(ctx: ServiceContext, v: z.infer<typeof listPublicationsSchema>): Promise<PublicationPageDTO> {
  requireInternal(ctx);
  return camel<PublicationPageDTO>(await rpc(ctx.db, "list_judicial_publications", {
    p_filter: { status: v.status ?? null, legal_process_id: v.processId ?? null, mine: v.mine ?? false, page: v.page, page_size: v.pageSize },
  }));
}

export async function getPublication(ctx: ServiceContext, id: string): Promise<JudicialPublicationDetailDTO> {
  requireInternal(ctx);
  return camel<JudicialPublicationDetailDTO>(await rpc(ctx.db, "get_judicial_publication", { p_id: id }));
}

export async function decidePublication(ctx: ServiceContext, v: z.infer<typeof decideSchema>) {
  requireRole(ctx, "ADMIN", "LAWYER");
  return rpc<{ id: string }>(ctx.db, "judicial_publication_decide", { p_id: v.id, p_action: v.action, p_notes: v.notes ?? null });
}

export async function createDeadline(ctx: ServiceContext, v: z.infer<typeof createDeadlineSchema>) {
  requireRole(ctx, "ADMIN", "LAWYER");
  return rpc<{ deadline_id: string }>(ctx.db, "create_deadline_from_publication", {
    p_id: v.id,
    p_deadline: {
      title: v.title, due_on: v.dueOn, deadline_type: v.deadlineType, priority: v.priority,
      responsible_user_id: v.responsibleUserId ?? null, description: v.description ?? null, notes: v.notes ?? null,
    },
  });
}

export async function previewDeadline(ctx: ServiceContext, v: z.infer<typeof previewSchema>): Promise<DeadlineCountDTO> {
  requireInternal(ctx);
  return camel<DeadlineCountDTO>(await rpc(ctx.db, "judicial_deadline_preview", {
    p_available_on: v.availableOn, p_court: v.court || null, p_days: v.businessDays,
  }));
}

// ─────────────────────────── processo ─────────────────────────────────────

export async function getProcessStatus(ctx: ServiceContext, processId: string): Promise<ProcessJudicialStatusDTO> {
  return camel<ProcessJudicialStatusDTO>(await rpc(ctx.db, "get_process_judicial_status", { p_process_id: processId }));
}

export async function setProcessSync(ctx: ServiceContext, processId: string, enabled: boolean) {
  requireRole(ctx, "ADMIN", "LAWYER");
  return rpc<{ sync_enabled: boolean }>(ctx.db, "set_process_judicial_sync", { p_process_id: processId, p_enabled: enabled });
}

// ─────────────────────────── buscar agora ─────────────────────────────────

/**
 * Rodada pedida na tela. Tudo: só ADMIN. Um processo: ADMIN ou advogado. O
 * banco confere de novo quem pediu (judicial_sync_begin).
 *
 * Tempo: a busca de tudo trabalha 45 s (o resto fica para os lotes). A de UM
 * processo espera o DataJud até 2 min (o CNJ leva de 30 s a mais de 1 min; com
 * 45 s o botão do processo quase sempre falhava). A página do processo declara
 * maxDuration para a função aguentar esse tempo.
 */
export async function syncNow(ctx: ServiceContext, processId?: string): Promise<JudicialSyncNowDTO> {
  if (processId) requireRole(ctx, "ADMIN", "LAWYER");
  else requireRole(ctx, "ADMIN");
  if (!process.env.DG_WORKER_DB_URL) throw new DomainError("INVALID_STATE", "Servidor sem DG_WORKER_DB_URL: a busca não pode rodar.");
  const r = await runJudicialSync(judicialSyncDeps(ctx.log, Date.now() + (processId ? 130_000 : 45_000)), {
    trigger: "MANUAL", requestedBy: ctx.session.userId, processId: processId ?? null,
  });
  if (r.busy) return { busy: true };
  if ("idle" in r && r.idle) return { busy: false, stats: {} };
  return { busy: false, status: r.status, stats: { ...r.stats }, errors: r.errors };
}
