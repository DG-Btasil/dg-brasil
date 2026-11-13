import { describe, expect, it } from "vitest";
import type { ProcessPartyDTO } from "@/server/domain/processes/dto";
import { addPartySchema, PARTY_TYPES, updatePartySchema } from "@/server/domain/processes/schemas";
import { EMPTY_PARTY, PARTY_TYPE_LABEL, partyAddInput, partyFormErrors, partyFormFrom, partyUpdateInput } from "./party-input";

const PROCESS = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";
const PARTY: ProcessPartyDTO = { id: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", processId: PROCESS, type: "DEFENDANT", name: "Banco Exemplo S.A.", document: "11222333000181", createdAt: "2026-11-01T12:00:00Z" };

describe("partes do processo: formulário", () => {
  it("toda qualificação do sistema tem rótulo", () => {
    for (const type of PARTY_TYPES) expect(PARTY_TYPE_LABEL[type]).toBeTruthy();
  });

  it("nome é obrigatório; documento é opcional, mas se vier tem 11 ou 14 dígitos", () => {
    expect(partyFormErrors(EMPTY_PARTY)).toEqual({ name: "Informe o nome da parte.", document: undefined });
    expect(partyFormErrors({ type: "DEFENDANT", name: "Banco", document: "123" }).document).toMatch(/CPF/);
    expect(partyFormErrors({ type: "DEFENDANT", name: "Banco", document: "11.222.333/0001-81" })).toEqual({ name: undefined, document: undefined });
    expect(partyFormErrors({ type: "PLAINTIFF", name: "Maria", document: "390.533.447-05" })).toEqual({ name: undefined, document: undefined });
  });

  it("cadastro: entrada aceita pelo schema real, documento só com dígitos, vazio não vai", () => {
    const withDoc = partyAddInput(PROCESS, { type: "DEFENDANT", name: "  Banco Exemplo S.A. ", document: "11.222.333/0001-81" });
    expect(withDoc).toEqual({ processId: PROCESS, type: "DEFENDANT", name: "Banco Exemplo S.A.", document: "11222333000181" });
    expect(addPartySchema.parse(withDoc)).toMatchObject({ document: "11222333000181" });
    const noDoc = partyAddInput(PROCESS, { type: "INTERESTED", name: "Fulano", document: "" });
    expect(noDoc).not.toHaveProperty("document");
    expect(addPartySchema.safeParse(noDoc).success).toBe(true);
  });

  it("edição: o documento atual não volta para o campo (só a máscara aparece na tela)", () => {
    expect(partyFormFrom(PARTY)).toEqual({ type: "DEFENDANT", name: "Banco Exemplo S.A.", document: "" });
  });

  it("edição: só o que mudou vai; documento vazio mantém o atual", () => {
    expect(partyUpdateInput(PARTY, partyFormFrom(PARTY))).toBeUndefined();
    const renamed = partyUpdateInput(PARTY, { type: "DEFENDANT", name: "Banco Exemplo Brasil S.A.", document: "" });
    expect(renamed).toEqual({ id: PARTY.id, patch: { name: "Banco Exemplo Brasil S.A." } });
    expect(updatePartySchema.safeParse(renamed).success).toBe(true);
    expect(partyUpdateInput(PARTY, { type: "OTHER", name: PARTY.name, document: "11.222.333/0001-81" })).toEqual({ id: PARTY.id, patch: { type: "OTHER" } });
    const newDoc = partyUpdateInput(PARTY, { type: "DEFENDANT", name: PARTY.name, document: "60.701.190/0001-04" });
    expect(newDoc).toEqual({ id: PARTY.id, patch: { document: "60701190000104" } });
    expect(updatePartySchema.safeParse(newDoc).success).toBe(true);
  });
});
