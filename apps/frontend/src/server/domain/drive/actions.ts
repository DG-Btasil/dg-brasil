"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import { clientIdSchema, linkFolderSchema, searchFoldersSchema } from "./schemas";
import * as service from "./service";

/**
 * Google Drive (041). Ler a situação: equipe interna. Procurar, ligar,
 * desligar e sincronizar: ADMIN ou advogado (o banco revalida). Testar a
 * conexão: ADMIN.
 */

const empty = z.object({}).default({});

export async function getDriveStatusAction() {
  return runAction({ name: "drive.status", schema: empty, input: {}, handler: (ctx) => service.getDriveStatus(ctx) });
}
export async function testDriveAction() {
  return runAction({ name: "drive.test", schema: empty, input: {}, handler: (ctx) => service.testDrive(ctx) });
}
export async function searchDriveFoldersAction(input: unknown) {
  return runAction({ name: "drive.search_folders", schema: searchFoldersSchema, input, handler: (ctx, v) => service.searchFolders(ctx, v.term) });
}
export async function getClientDriveAction(input: unknown) {
  return runAction({ name: "drive.client", schema: clientIdSchema, input, handler: (ctx, v) => service.getClientDrive(ctx, v.clientId) });
}
export async function linkDriveFolderAction(input: unknown) {
  return runAction({ name: "drive.link", schema: linkFolderSchema, input, handler: (ctx, v) => service.linkFolder(ctx, v.clientId, v.folderId) });
}
export async function unlinkDriveFolderAction(input: unknown) {
  return runAction({ name: "drive.unlink", schema: clientIdSchema, input, handler: (ctx, v) => service.unlinkFolder(ctx, v.clientId) });
}
export async function syncClientDriveAction(input: unknown) {
  return runAction({ name: "drive.sync_client", schema: clientIdSchema, input, handler: (ctx, v) => service.syncClientNow(ctx, v.clientId) });
}
export async function getDriveSuggestionsAction() {
  return runAction({ name: "drive.suggestions", schema: empty, input: {}, handler: (ctx) => service.suggestions(ctx) });
}
