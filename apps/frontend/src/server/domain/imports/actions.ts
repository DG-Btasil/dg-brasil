"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import {
  conflictsSchema,
  jobIdSchema,
  listJobsSchema,
  listRowsSchema,
  readColumnsSchema,
  reportSchema,
  resolveConflictsSchema,
  simulateSchema,
  startImportSchema,
} from "./schemas";
import * as service from "./service";

/** Importação de planilhas (Etapa 7, 042): só ADMIN (`imports.manage`); o banco confere de novo. */

const P = "imports.manage" as const;

export async function startImportAction(input: unknown) {
  return runAction({ name: "imports.start", permission: P, schema: startImportSchema, input, handler: (ctx, v) => service.startImport(ctx, v) });
}
export async function readImportColumnsAction(input: unknown) {
  return runAction({ name: "imports.columns", permission: P, schema: readColumnsSchema, input, handler: (ctx, v) => service.readColumns(ctx, v) });
}
export async function previewImportColumnsAction(input: unknown) {
  return runAction({ name: "imports.preview", permission: P, schema: jobIdSchema, input, handler: (ctx, v) => service.previewColumns(ctx, v.jobId) });
}
export async function getImportReferenceAction() {
  return runAction({ name: "imports.reference", permission: P, schema: z.object({}).default({}), input: {}, handler: (ctx) => service.getReferenceData(ctx) });
}
export async function simulateImportAction(input: unknown) {
  return runAction({ name: "imports.simulate", permission: P, schema: simulateSchema, input, handler: (ctx, v) => service.simulate(ctx, v) });
}
export async function getImportJobAction(input: unknown) {
  return runAction({ name: "imports.get", permission: P, schema: jobIdSchema, input, handler: (ctx, v) => service.getJob(ctx, v.jobId) });
}
export async function listImportJobsAction(input: unknown = {}) {
  return runAction({ name: "imports.list", permission: P, schema: listJobsSchema, input, handler: (ctx, v) => service.listJobs(ctx, v) });
}
export async function listImportRowsAction(input: unknown) {
  return runAction({ name: "imports.rows", permission: P, schema: listRowsSchema, input, handler: (ctx, v) => service.listRows(ctx, v) });
}
export async function getImportConflictsAction(input: unknown) {
  return runAction({ name: "imports.conflicts", permission: P, schema: conflictsSchema, input, handler: (ctx, v) => service.getConflicts(ctx, v) });
}
export async function resolveImportConflictsAction(input: unknown) {
  return runAction({ name: "imports.resolve", permission: P, schema: resolveConflictsSchema, input, handler: (ctx, v) => service.resolveConflicts(ctx, v) });
}
export async function confirmImportAction(input: unknown) {
  return runAction({ name: "imports.confirm", permission: P, schema: jobIdSchema, input, handler: (ctx, v) => service.confirmImport(ctx, v.jobId) });
}
export async function processImportBatchAction(input: unknown) {
  return runAction({ name: "imports.process", permission: P, schema: jobIdSchema, input, handler: (ctx, v) => service.processBatch(ctx, v.jobId) });
}
export async function cancelImportAction(input: unknown) {
  return runAction({ name: "imports.cancel", permission: P, schema: jobIdSchema, input, handler: (ctx, v) => service.cancelImport(ctx, v.jobId) });
}
export async function importReportAction(input: unknown) {
  return runAction({ name: "imports.report", permission: P, schema: reportSchema, input, handler: (ctx, v) => service.buildReport(ctx, v) });
}
