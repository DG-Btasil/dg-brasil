import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema, listClientsSchema } from "@/server/domain/clients/schemas";
import * as processes from "@/server/domain/processes/service";
import { createProcessSchema, listProcessesSchema } from "@/server/domain/processes/schemas";
import * as search from "@/server/domain/search/service";
import * as trash from "@/server/domain/trash/service";
import { ctxFor, expectDomainError, fakeCnj, fakeCpf, serviceDb, world } from "./support/world";
import { validPfClient } from "./support/fixtures";

/**
 * Lixeira, número CNJ de processo excluído, exportação e busca global no
 * Supabase DEV real (migration 066 aplicada). Só ADMIN restaura e exporta;
 * a restauração e a exportação ficam na auditoria.
 */

async function clientWithCase(name: string): Promise<{ clientId: string; caseId: string; cpf: string }> {
  const lawyer = await ctxFor("LAWYER");
  const cpf = fakeCpf();
  const { id: clientId } = await clients.createClient(lawyer, createClientSchema.parse(validPfClient(cpf, { fullName: name })));
  const caseId = randomUUID();
  const { error } = await lawyer.db.from("legal_cases").insert({
    id: caseId,
    client_id: clientId,
    legal_area_id: world.bankingAreaId,
    title: `Caso Lixeira ${world.run}`,
    origin_organization_id: world.owner,
    status: "DRAFT",
  });
  expect(error).toBeNull();
  return { clientId, caseId, cpf };
}

const newProcess = (legalCaseId: string, cnj: string, title: string) => createProcessSchema.parse({ idempotencyKey: randomUUID(), legalCaseId, title, cnj });
const listed = async (kind: "CLIENT" | "PROCESS" | "DOCUMENT", q: string) => (await trash.listTrash(await ctxFor("ADMIN"), { kind, q, page: 1, pageSize: 25 })).items;

describe("Lixeira — cliente", () => {
  it("excluído aparece na Lixeira com quem excluiu; o CPF pede para restaurar; só ADMIN restaura; restaurado volta à lista", async () => {
    const admin = await ctxFor("ADMIN");
    const lawyer = await ctxFor("LAWYER");
    const name = `Cliente Lixeira ${world.run} ${randomUUID().slice(0, 6)}`;
    const { clientId, cpf } = await clientWithCase(name);
    await clients.removeClient(admin, clientId);

    const row = (await listed("CLIENT", name)).find((i) => i.id === clientId);
    expect(row).toMatchObject({ kind: "CLIENT", title: name, document: cpf });
    expect(row?.deletedByName).toBeTruthy();

    await expectDomainError(clients.createClient(lawyer, createClientSchema.parse(validPfClient(cpf, { fullName: "Outro Nome" }))), "CONFLICT", /cliente excluído/);
    expect(await clients.lookupClientDocument(lawyer, cpf)).toEqual({ status: "DELETED" });
    await expectDomainError(trash.listTrash(lawyer, { kind: "CLIENT", page: 1, pageSize: 25 }), "FORBIDDEN");
    await expectDomainError(trash.restoreFromTrash(lawyer, { kind: "CLIENT", id: clientId }), "FORBIDDEN");

    const restored = await trash.restoreFromTrash(admin, { kind: "CLIENT", id: clientId });
    expect(restored).toMatchObject({ kind: "CLIENT", id: clientId, cases: 1 });
    expect((await clients.getClient(lawyer, clientId)).surface).toBe("INTERNAL");
    expect((await listed("CLIENT", name)).map((i) => i.id)).not.toContain(clientId);
    await expectDomainError(trash.restoreFromTrash(admin, { kind: "CLIENT", id: clientId }), "INVALID_STATE", /não está excluído/);

    const { data } = await serviceDb().from("audit_events").select("action").eq("entity_type", "clients").eq("entity_id", clientId).in("action", ["CLIENT_DELETED", "CLIENT_RESTORED"]);
    expect((data ?? []).map((e) => e.action).sort()).toEqual(["CLIENT_DELETED", "CLIENT_RESTORED"]);
  });
});

describe("Lixeira — processo e número CNJ", () => {
  it("processo excluído pode ser cadastrado de novo com o mesmo CNJ; o antigo só volta quando o novo sai", async () => {
    const admin = await ctxFor("ADMIN");
    const lawyer = await ctxFor("LAWYER");
    const wrong = await clientWithCase(`Cliente CNJ ${world.run} A`);
    const right = await clientWithCase(`Cliente CNJ ${world.run} B`);
    const cnj = fakeCnj();

    const { id: first } = await processes.createProcess(lawyer, newProcess(wrong.caseId, cnj, `Processo caso errado ${world.run}`));
    await processes.removeProcess(admin, first);
    // Antes da 066 isto falhava com "Já existe um processo com este número CNJ".
    const { id: second } = await processes.createProcess(lawyer, newProcess(right.caseId, cnj, `Processo caso certo ${world.run}`));
    expect(second).not.toBe(first);

    const inTrash = (await listed("PROCESS", cnj)).find((i) => i.id === first);
    expect(inTrash).toMatchObject({ kind: "PROCESS", cnj, cnjReleased: true, blocked: "CNJ_IN_USE" });
    await expectDomainError(trash.restoreFromTrash(admin, { kind: "PROCESS", id: first }), "CONFLICT", /outro processo ativo com este número CNJ/);

    await processes.removeProcess(admin, second);
    const restored = await trash.restoreFromTrash(admin, { kind: "PROCESS", id: first });
    expect(restored).toMatchObject({ kind: "PROCESS", id: first, legalCaseId: wrong.caseId, cnjReturned: true });
    expect((await processes.getProcess(lawyer, first)).process.cnj).toBe(cnj);

    const { data: refs } = await serviceDb().from("process_external_refs").select("legal_process_id").eq("provider", "DATAJUD").eq("external_id", cnj);
    expect((refs ?? []).map((r) => r.legal_process_id)).toEqual([first]);
    const { data: audit } = await serviceDb().from("audit_events").select("action").eq("entity_type", "legal_processes").eq("entity_id", first).in("action", ["PROCESS_CNJ_RELEASED", "PROCESS_RESTORED"]);
    expect((audit ?? []).map((e) => e.action).sort()).toEqual(["PROCESS_CNJ_RELEASED", "PROCESS_RESTORED"]);
  });

  it("busca de processo pelo número casa por qualquer trecho, com máscara, na lista e na busca global", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { caseId } = await clientWithCase(`Cliente Busca ${world.run}`);
    const cnj = fakeCnj();
    const { id } = await processes.createProcess(lawyer, newProcess(caseId, cnj, `Processo busca ${world.run}`));
    // Meio do número (dígito verificador + ano), como a pessoa copia de um papel.
    const middle = `${cnj.slice(2, 7)}-${cnj.slice(7, 9)}.${cnj.slice(9, 13)}`;
    expect((await processes.listProcesses(lawyer, listProcessesSchema.parse({ q: middle }))).items.map((p) => p.id)).toContain(id);
    expect((await processes.listProcesses(lawyer, listProcessesSchema.parse({ q: cnj.slice(12) }))).items.map((p) => p.id)).toContain(id);
    const found = await search.globalSearch(lawyer, { q: cnj.slice(4, 16) });
    expect(found.processes?.items.map((p) => p.id)).toContain(id);
    expect(found.clients).toBeDefined();
    expect(found.cases).toBeDefined();
  });
});

describe("exportação", () => {
  it("só ADMIN exporta; o arquivo respeita o filtro e a exportação fica na auditoria sem o texto da busca", async () => {
    const admin = await ctxFor("ADMIN");
    const lawyer = await ctxFor("LAWYER");
    const name = `Cliente Planilha ${world.run} ${randomUUID().slice(0, 6)}`;
    const { clientId } = await clientWithCase(name);
    const input = listClientsSchema.parse({ q: name });

    await expectDomainError(clients.exportClients(lawyer, input), "FORBIDDEN");
    const file = await clients.exportClients(admin, input);
    expect([file.rowCount, file.truncated]).toEqual([1, false]);
    expect(file.fileName).toMatch(/^clientes-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = file.content.split("\r\n");
    expect(lines[0]?.startsWith("Nome;Nome fantasia;Tipo;CPF/CNPJ;Situação")).toBe(true);
    expect(lines[1]?.startsWith(`${name};`)).toBe(true);

    const { data } = await serviceDb()
      .from("audit_events")
      .select("metadata, actor_user_id")
      .eq("action", "DATA_EXPORTED")
      .eq("request_id", admin.requestId)
      .order("created_at", { ascending: false })
      .limit(1);
    expect(data?.[0]?.metadata).toMatchObject({ kind: "clients", total_rows: 1, truncated: false, filters: { search: true } });
    expect(JSON.stringify(data?.[0]?.metadata)).not.toContain(name);
    expect(clientId).toBeTruthy();

    const processFile = await processes.exportProcesses(admin, listProcessesSchema.parse({ q: `nenhum processo ${randomUUID()}` }));
    expect([processFile.rowCount, processFile.content.split("\r\n")[0]?.startsWith("Número CNJ;Processo;Cliente")]).toEqual([0, true]);
  });
});
