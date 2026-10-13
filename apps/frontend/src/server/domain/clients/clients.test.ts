import { describe, expect, it } from "vitest";
import {
  basicsPayload,
  createPayload,
  internalClientFromRows,
  listItemFromRow,
  partnerClientFromRow,
  updatePayload,
  type ClientDetailRow,
  type ClientDirectoryRow,
} from "./mappers";
import { likePattern } from "./repository";
import { createClientSchema, listClientsSchema, updateClientBasicsSchema, updateClientSchema } from "./schemas";

const OWNER = "00000000-0000-4000-8000-000000000001";
const PARTNER_A = "00000000-0000-4000-8000-00000000000a";

const detailRow = (over: Partial<ClientDetailRow> = {}): ClientDetailRow => ({
  id: "c1",
  kind: "INDIVIDUAL",
  cpf: "99900011122",
  cnpj: null,
  status: "ACTIVE",
  origin_organization_id: OWNER,
  responsible_user_id: "u1",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  individual_client_details: {
    full_name: "Maria Teste",
    social_name: null,
    birth_date: "1950-01-01",
    gender: "FEMALE",
    nationality: null,
    birthplace: null,
    marital_status: "WIDOWED",
    stable_union: null,
    profession: null,
    identity_document_type: "RG",
    identity_document_number: "123",
    identity_document_issuer: null,
    identity_document_state: "SP",
  },
  company_client_details: null,
  client_contacts: [
    { type: "EMAIL", value: "maria@dgbrasil.test", is_primary: true },
    { type: "PHONE", value: "11999990000", is_primary: true },
    { type: "PHONE", value: "1133334444", is_primary: false },
  ],
  client_addresses: [
    { postal_code: "01001000", street: "Rua A", number: "1", complement: null, neighborhood: "Centro", city: "São Paulo", state: "SP", country: "BR", is_primary: true },
  ],
  ...over,
});

describe("mapeamento banco → domínio", () => {
  it("ficha interna monta o Client do front com dados internos", () => {
    const c = internalClientFromRows(
      detailRow(),
      { notes: "nota", legal_summary: null, inactivation_reason: null, inactivation_note: null, inactivated_at: null, inactivated_by: null },
      OWNER,
    );
    expect(c).toMatchObject({
      id: "c1",
      officeId: OWNER,
      kind: "INDIVIDUAL",
      fullName: "Maria Teste",
      cpf: "99900011122",
      notes: "nota",
      contact: { email: "maria@dgbrasil.test", phone: "11999990000", secondaryPhone: "1133334444" },
      address: { zipCode: "01001000", district: "Centro" },
      identityDocument: { type: "RG", number: "123", state: "SP" },
    });
  });

  it("ficha do parceiro não tem NENHUM campo interno", () => {
    const p = partnerClientFromRow(detailRow(), PARTNER_A);
    for (const field of ["notes", "legalSummary", "inactivation", "responsibleUserId", "officeId", "representatives", "partners", "identityDocument"]) {
      expect(p).not.toHaveProperty(field);
    }
    expect(p.originOfficeId).toBeUndefined(); // origem é do proprietário, não do parceiro
    expect(partnerClientFromRow(detailRow({ origin_organization_id: PARTNER_A }), PARTNER_A).originOfficeId).toBe(PARTNER_A);
  });

  it("listagem: parceiro não recebe responsável nem origem de outro escritório", () => {
    const row: ClientDirectoryRow = {
      id: "c1",
      kind: "COMPANY",
      display_name: "Empresa X",
      trade_name: null,
      cpf: null,
      cnpj: "99900011122233",
      status: "ARCHIVED",
      origin_organization_id: OWNER,
      responsible_user_id: "u1",
      created_at: "a",
      updated_at: "b",
    };
    expect(listItemFromRow(row, { surface: "INTERNAL", organizationId: OWNER })).toMatchObject({ responsibleUserId: "u1", originOrganizationId: OWNER, status: "INACTIVE" });
    const p = listItemFromRow(row, { surface: "PARTNER", organizationId: PARTNER_A });
    expect(p.responsibleUserId).toBeUndefined();
    expect(p.originOrganizationId).toBeUndefined();
  });
});

describe("payload de gravação (PATCH)", () => {
  it("criação PF leva só chaves conhecidas, em snake_case", () => {
    const input = createClientSchema.parse({
      kind: "INDIVIDUAL",
      cpf: "999.000.111-22",
      fullName: "Maria",
      originOfficeId: OWNER,
      contact: { email: "M@X.com" },
      address: { zipCode: "01001-000", district: "Centro", state: "sp" },
    });
    const p = createPayload(input);
    expect(p).toMatchObject({ kind: "INDIVIDUAL", document: "99900011122", full_name: "Maria", origin_organization_id: OWNER, contact: { email: "m@x.com" } });
    expect(p.address).toMatchObject({ postal_code: "01001000", neighborhood: "Centro", state: "SP" });
  });
  it("edição só envia o que mudou; null limpa", () => {
    const { patch } = updateClientSchema.parse({ id: OWNER, patch: { profession: "Aposentada", address: null } });
    expect(updatePayload(patch)).toEqual({ profession: "Aposentada", address: null });
  });
  it("parceiro: payload só com contato e endereço", () => {
    const input = updateClientBasicsSchema.parse({ id: OWNER, contact: { phone: "1199" }, fullName: "ignorado" } as unknown);
    expect(Object.keys(basicsPayload(input)).sort()).toEqual(["contact"]);
  });
  it("edição vazia é recusada", () => {
    expect(updateClientSchema.safeParse({ id: OWNER, patch: {} }).success).toBe(false);
  });
});

describe("busca", () => {
  it("curingas do usuário viram literais", () => {
    expect(likePattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });
  it("filtros e ordenação validados", () => {
    expect(listClientsSchema.parse({ q: "maria", sortBy: "name", sortDirection: "asc" })).toMatchObject({ q: "maria", column: "display_name", ascending: true, page: 1 });
    expect(listClientsSchema.safeParse({ sortBy: "cpf" }).success).toBe(false);
    expect(listClientsSchema.safeParse({ originOrganizationId: "x" }).success).toBe(false);
  });
});
