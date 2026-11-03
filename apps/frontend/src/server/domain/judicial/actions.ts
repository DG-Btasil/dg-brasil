"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import {
  calendarDaySchema, coverageSchema, createDeadlineSchema, decideSchema, idSchema, listPublicationsSchema, monitorActiveSchema,
  previewSchema, processIdSchema, processSyncSchema, saveMonitorSchema, settingsSchema, syncNowSchema,
} from "./schemas";
import * as service from "./service";

/**
 * Integração judicial (043).
 *  - Visão geral: ADMIN e advogado. Configurar, calendário e "buscar tudo agora": ADMIN.
 *  - OABs: ADMIN (qualquer escritório) e administrador do parceiro (o próprio).
 *  - Publicações e prazos: equipe interna lê; ADMIN/advogado decidem.
 * O banco revalida tudo.
 */

const empty = z.object({}).default({});

export async function getJudicialOverviewAction() {
  return runAction({ name: "judicial.overview", permission: "settings.integrations.view", schema: empty, input: {}, handler: (ctx) => service.getOverview(ctx) });
}
export async function saveJudicialSettingsAction(input: unknown) {
  return runAction({ name: "judicial.settings", permission: "settings.integrations.manage", schema: settingsSchema, input, handler: (ctx, v) => service.saveSettings(ctx, v) });
}
export async function saveCourtCalendarDayAction(input: unknown) {
  return runAction({ name: "judicial.calendar_save", permission: "settings.integrations.manage", schema: calendarDaySchema, input, handler: (ctx, v) => service.saveCalendarDay(ctx, v) });
}
export async function deleteCourtCalendarDayAction(input: unknown) {
  return runAction({ name: "judicial.calendar_delete", permission: "settings.integrations.manage", schema: idSchema, input, handler: (ctx, v) => service.deleteCalendarDay(ctx, v.id) });
}
export async function saveJudicialMonitorAction(input: unknown) {
  return runAction({ name: "judicial.monitor_save", schema: saveMonitorSchema, input, handler: (ctx, v) => service.saveMonitor(ctx, v) });
}
export async function setJudicialMonitorActiveAction(input: unknown) {
  return runAction({ name: "judicial.monitor_active", schema: monitorActiveSchema, input, handler: (ctx, v) => service.setMonitorActive(ctx, v.id, v.active) });
}
export async function getMyJudicialMonitorsAction() {
  return runAction({ name: "judicial.my_monitors", permission: "partnerPortal.view", schema: empty, input: {}, handler: (ctx) => service.getMyMonitors(ctx) });
}
export async function getJudicialCoverageAction(input: unknown) {
  return runAction({ name: "judicial.coverage", schema: coverageSchema, input, handler: (ctx, v) => service.getCoverage(ctx, v) });
}
export async function listJudicialPublicationsAction(input: unknown) {
  return runAction({ name: "judicial.publications", permission: "processes.view", schema: listPublicationsSchema, input, handler: (ctx, v) => service.listPublications(ctx, v) });
}
export async function getJudicialPublicationAction(input: unknown) {
  return runAction({ name: "judicial.publication", permission: "processes.view", schema: idSchema, input, handler: (ctx, v) => service.getPublication(ctx, v.id) });
}
export async function decideJudicialPublicationAction(input: unknown) {
  return runAction({ name: "judicial.publication_decide", permission: "processes.edit", schema: decideSchema, input, handler: (ctx, v) => service.decidePublication(ctx, v) });
}
export async function createDeadlineFromPublicationAction(input: unknown) {
  return runAction({ name: "judicial.publication_deadline", permission: "processes.edit", schema: createDeadlineSchema, input, handler: (ctx, v) => service.createDeadline(ctx, v) });
}
export async function previewJudicialDeadlineAction(input: unknown) {
  return runAction({ name: "judicial.deadline_preview", permission: "processes.view", schema: previewSchema, input, handler: (ctx, v) => service.previewDeadline(ctx, v) });
}
export async function getProcessJudicialStatusAction(input: unknown) {
  return runAction({ name: "judicial.process_status", permission: "processes.view", schema: processIdSchema, input, handler: (ctx, v) => service.getProcessStatus(ctx, v.processId) });
}
export async function setProcessJudicialSyncAction(input: unknown) {
  return runAction({ name: "judicial.process_sync", permission: "processes.edit", schema: processSyncSchema, input, handler: (ctx, v) => service.setProcessSync(ctx, v.processId, v.enabled) });
}
export async function syncJudicialNowAction(input: unknown) {
  return runAction({ name: "judicial.sync_now", schema: syncNowSchema, input, handler: (ctx, v) => service.syncNow(ctx, v.processId) });
}
