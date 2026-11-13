import { describe, expect, it } from "vitest";
import { ACCESS_ACTIONS, ACCESS_RESOURCE_TYPES, listPersonalDataAccessSchema } from "@/server/domain/audit/schemas";
import { ACCESS_ACTION_LABEL, ACCESS_ACTION_OPTIONS, ACCESS_RESOURCE_LABEL, ACCESS_RESOURCE_OPTIONS, accessLogInput, accessSummary } from "./access-labels";

const CLIENT = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";

describe("registro de acessos a dados pessoais (LGPD)", () => {
  it("todo tipo de acesso e de dado do sistema tem rótulo em português", () => {
    for (const action of ACCESS_ACTIONS) expect(ACCESS_ACTION_LABEL[action]).toBeTruthy();
    for (const type of ACCESS_RESOURCE_TYPES) expect(ACCESS_RESOURCE_LABEL[type]).toBeTruthy();
    expect(ACCESS_ACTION_OPTIONS.map((o) => o.value)).toEqual([...ACCESS_ACTIONS]);
    expect(ACCESS_RESOURCE_OPTIONS.map((o) => o.value)).toEqual([...ACCESS_RESOURCE_TYPES]);
  });

  it("resumo do acesso nunca mostra o código", () => {
    expect(accessSummary("VIEW_DETAIL", "CLIENT")).toBe("Abriu · Ficha do cliente");
    expect(accessSummary("DOWNLOAD", "DOCUMENT_VERSION")).toBe("Baixou · Arquivo de documento");
    expect(accessSummary("ALGO_NOVO", "OUTRO_TIPO")).toBe("Acessou · Dado do cliente");
  });

  it("filtros da tela viram uma entrada que o servidor aceita", () => {
    const empty = accessLogInput({ clientId: "", action: "", resourceType: "", from: "", to: "", page: 1 });
    expect(listPersonalDataAccessSchema.parse(empty)).toMatchObject({ page: 1, pageSize: 25, column: "created_at", ascending: false });
    expect(empty.clientId).toBeUndefined();

    const filled = accessLogInput({ clientId: CLIENT, action: "VIEW_DETAIL", resourceType: "CLIENT", from: "2026-11-01", to: "2026-11-13", page: 3 });
    expect(listPersonalDataAccessSchema.parse(filled)).toMatchObject({ clientId: CLIENT, action: "VIEW_DETAIL", resourceType: "CLIENT", page: 3 });
    expect(filled.from).toBe("2026-11-01T00:00:00-03:00");
    expect(filled.to).toBe("2026-11-13T23:59:59-03:00");
  });

  it("período invertido é recusado pelo servidor", () => {
    const inverted = accessLogInput({ clientId: "", action: "", resourceType: "", from: "2026-11-13", to: "2026-11-01", page: 1 });
    expect(listPersonalDataAccessSchema.safeParse(inverted).success).toBe(false);
  });
});
