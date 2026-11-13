import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/lib/auth/types";
import { RESTORE_EXPLANATION, TRASH_BLOCK_LABEL, TRASH_KIND_LABEL, restoreNotice } from "@/features/trash/labels";
import { createServiceContext } from "@/server/core/context";
import { restoreResultFromRow, trashItemFromRow, type TrashRow } from "./mappers";
import { TRASH_KINDS, listTrashSchema, restoreTrashSchema } from "./schemas";
import { listTrash, restoreFromTrash } from "./service";

const ID = "11111111-1111-4111-8111-111111111111";
const USER = "66666666-6666-4666-8666-666666666666";

const ctxOf = (role: AppSession["role"], rpc: ReturnType<typeof vi.fn>) =>
  createServiceContext({
    db: { rpc } as unknown as SupabaseClient,
    requestId: "55555555-5555-4555-8555-555555555555",
    session: { userId: USER, organizationId: "o1", role, surface: role.startsWith("PARTNER") ? "PARTNER" : "INTERNAL" } as AppSession,
  });

const base = { id: ID, deleted_at: "2026-11-13T12:00:00Z", deleted_by: USER, deleted_by_name: "Bárbara Cardoso", blocked: null };

describe("Lixeira — entrada", () => {
  it("só os três tipos; página padrão de 25 e no máximo 50; busca até 120 caracteres", () => {
    expect([...TRASH_KINDS]).toEqual(["CLIENT", "PROCESS", "DOCUMENT"]);
    expect(listTrashSchema.parse({ kind: "CLIENT" })).toEqual({ kind: "CLIENT", page: 1, pageSize: 25 });
    expect(listTrashSchema.parse({ kind: "PROCESS", q: "  0001234-56  " }).q).toBe("0001234-56");
    expect(listTrashSchema.safeParse({ kind: "CASE" }).success).toBe(false);
    expect(listTrashSchema.safeParse({ kind: "CLIENT", pageSize: 500 }).success).toBe(false);
    expect(listTrashSchema.safeParse({ kind: "CLIENT", q: "x".repeat(121) }).success).toBe(false);
    expect(restoreTrashSchema.safeParse({ kind: "CLIENT", id: "não é id" }).success).toBe(false);
    expect(restoreTrashSchema.parse({ kind: "DOCUMENT", id: ID })).toEqual({ kind: "DOCUMENT", id: ID });
  });
});

describe("Lixeira — banco → tela", () => {
  it("cliente: nome, documento, tipo, quem excluiu e quando", () => {
    const row: TrashRow = { ...base, kind: "CLIENT", title: "Maria Teste", document: "99900011122", client_kind: "INDIVIDUAL" };
    expect(trashItemFromRow(row)).toEqual({ id: ID, kind: "CLIENT", title: "Maria Teste", deletedAt: base.deleted_at, deletedByName: "Bárbara Cardoso", document: "99900011122", clientKind: "INDIVIDUAL" });
  });

  it("processo: número que tinha, se já foi usado em outro cadastro, caso, cliente e o motivo do bloqueio", () => {
    const row: TrashRow = { ...base, kind: "PROCESS", title: "Maria x Banco", cnj: "00012345620268190001", cnj_released: true, case_title: "Consignado", client_name: "Maria Teste", blocked: "CNJ_IN_USE" };
    expect(trashItemFromRow(row)).toMatchObject({ kind: "PROCESS", cnj: "00012345620268190001", cnjReleased: true, caseTitle: "Consignado", clientName: "Maria Teste", blocked: "CNJ_IN_USE" });
  });

  it("documento: categoria e cliente; exclusão sem pessoa (sistema) não inventa nome; motivo desconhecido não passa", () => {
    const row: TrashRow = { ...base, kind: "DOCUMENT", title: "  ", category_label: "Outros", client_name: "Maria Teste", deleted_by: null, deleted_by_name: null, blocked: "ALGO_NOVO" };
    const item = trashItemFromRow(row);
    expect(item).toEqual({ id: ID, kind: "DOCUMENT", title: "(sem nome)", deletedAt: base.deleted_at, deletedByName: undefined, clientName: "Maria Teste", categoryLabel: "Outros" });
    expect("blocked" in item).toBe(false);
  });

  it("retorno da restauração por tipo (contagens sempre numéricas)", () => {
    expect(restoreResultFromRow("CLIENT", { id: ID, cases: 2, processes: "3", documents: 1, trashed_processes: 1, trashed_documents: 0 })).toEqual({
      kind: "CLIENT",
      id: ID,
      cases: 2,
      processes: 3,
      documents: 1,
      trashedProcesses: 1,
      trashedDocuments: 0,
    });
    expect(restoreResultFromRow("PROCESS", { id: ID, legal_case_id: "c1", cnj_returned: true, open_deadlines: 2 })).toEqual({ kind: "PROCESS", id: ID, legalCaseId: "c1", cnjReturned: true, openDeadlines: 2 });
    expect(restoreResultFromRow("DOCUMENT", { id: ID, client_id: "cl1" })).toEqual({ kind: "DOCUMENT", id: ID, clientId: "cl1" });
  });
});

describe("Lixeira — service", () => {
  it("ADMIN lista: chama trash_list com o tipo, a busca e o deslocamento da página", async () => {
    const rpc = vi.fn(async () => ({ data: { total: 30, items: [{ ...base, kind: "CLIENT", title: "Maria Teste", document: "99900011122", client_kind: "INDIVIDUAL" }] }, error: null }));
    const page = await listTrash(ctxOf("ADMIN", rpc), { kind: "CLIENT", q: "maria", page: 2, pageSize: 25 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("trash_list", { p_kind: "CLIENT", p_search: "maria", p_limit: 25, p_offset: 25 });
    expect([page.total, page.page, page.items.length, page.hasMore, page.items[0]?.title]).toEqual([30, 2, 1, false, "Maria Teste"]);
  });

  it("ADMIN restaura: cada tipo chama a sua função do banco", async () => {
    for (const [kind, fn] of [["CLIENT", "restore_client"], ["PROCESS", "restore_process"], ["DOCUMENT", "restore_document"]] as const) {
      const rpc = vi.fn(async () => ({ data: { id: ID }, error: null }));
      const r = await restoreFromTrash(ctxOf("ADMIN", rpc), { kind, id: ID });
      expect(rpc).toHaveBeenCalledExactlyOnceWith(fn, { p_id: ID });
      expect([r.kind, r.id]).toEqual([kind, ID]);
    }
  });

  it("quem não é ADMIN não lista nem restaura, e o banco nem é chamado", async () => {
    for (const role of ["LAWYER", "ASSISTANT", "PARTNER_ADMIN", "PARTNER_USER"] as const) {
      const rpc = vi.fn();
      await expect(listTrash(ctxOf(role, rpc), { kind: "CLIENT", page: 1, pageSize: 25 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(restoreFromTrash(ctxOf(role, rpc), { kind: "CLIENT", id: ID })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("a recusa do banco chega com a frase escrita por nós (outro registro ativo com o mesmo número)", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "23505", message: "Já existe outro processo ativo com este número CNJ. Use o processo ativo." } }));
    await expect(restoreFromTrash(ctxOf("ADMIN", rpc), { kind: "PROCESS", id: ID })).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage: "Já existe outro processo ativo com este número CNJ. Use o processo ativo.",
    });
    const state = vi.fn(async () => ({ data: null, error: { code: "P0001", message: "O cliente deste documento está na Lixeira. Restaure primeiro o cliente." } }));
    await expect(restoreFromTrash(ctxOf("ADMIN", state), { kind: "DOCUMENT", id: ID })).rejects.toMatchObject({
      code: "INVALID_STATE",
      publicMessage: "O cliente deste documento está na Lixeira. Restaure primeiro o cliente.",
    });
  });
});

describe("Lixeira — textos da tela", () => {
  it("todo tipo tem rótulos, explicação do que volta e todo bloqueio tem frase", () => {
    for (const kind of TRASH_KINDS) {
      expect(TRASH_KIND_LABEL[kind].tab).toBeTruthy();
      expect(RESTORE_EXPLANATION[kind].body.length).toBeGreaterThan(0);
    }
    expect(Object.keys(TRASH_BLOCK_LABEL).sort()).toEqual(["CASE_DELETED", "CLIENT_DELETED", "CNJ_IN_USE"]);
    // O que não dá para desfazer é dito antes de confirmar.
    expect(RESTORE_EXPLANATION.PROCESS.body.join(" ")).toMatch(/enquanto o processo esteve excluído não foi capturado/);
  });

  it("aviso depois de restaurar: o que voltou e o que ainda está na Lixeira", () => {
    expect(restoreNotice({ kind: "CLIENT", id: ID, cases: 1, processes: 2, documents: 0, trashedProcesses: 1, trashedDocuments: 2 })).toEqual({
      title: "Cliente restaurado",
      description: "Com ele: 1 caso, 2 processos, 0 documentos. Ainda na Lixeira: 1 processo e 2 documentos.",
    });
    expect(restoreNotice({ kind: "CLIENT", id: ID, cases: 0, processes: 0, documents: 0, trashedProcesses: 0, trashedDocuments: 0 }).description).toBe("Com ele: 0 casos, 0 processos, 0 documentos.");
    expect(restoreNotice({ kind: "PROCESS", id: ID, legalCaseId: "c1", cnjReturned: true, openDeadlines: 1 }).description).toBe(
      "O número CNJ voltou para este processo. 1 prazo em aberto voltou para a agenda. Confira no tribunal o que saiu enquanto ele esteve excluído.",
    );
    expect(restoreNotice({ kind: "PROCESS", id: ID, legalCaseId: "c1", cnjReturned: false, openDeadlines: 0 }).description).toBe("Confira no tribunal o que saiu enquanto ele esteve excluído.");
    expect(restoreNotice({ kind: "DOCUMENT", id: ID, clientId: "cl1" }).title).toBe("Documento restaurado");
  });
});
