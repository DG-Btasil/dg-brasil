import { describe, expect, it } from "vitest";
import {
  organizationPatchPayload,
  ownerOfficeFromRows,
  ownerSettingsPatchPayload,
  partnerAdminFromRows,
  partnerInternalFromRow,
  partnerListItemFromRow,
  partnerOfficeOrgArg,
  partnerOfficeSettingsArg,
  partnerOwnOfficeFromRow,
  partnerSettingsPatchPayload,
  type OrganizationRow,
  type PartnerSettingsRow,
} from "./mappers";
import { fromOrganizationDbError, quoteFilter } from "./repository";
import { changePartnerShareSchema, createPartnerSchema, listOrganizationUsersSchema, listPartnersSchema, setPartnerStatusSchema, updateOwnerOfficeSchema, updatePartnerSchema } from "./schemas";

const OWNER = "00000000-0000-4000-8000-000000000001";
const PARTNER = "00000000-0000-4000-8000-00000000000a";

const orgRow = (over: Partial<OrganizationRow> = {}): OrganizationRow => ({
  id: PARTNER,
  type: "PARTNER",
  name: "Parceiro Teste",
  legal_name: "Parceiro Teste Advocacia",
  trade_name: null,
  cnpj: "99900011122233",
  email: "contato@parceiro.test",
  phone: "1133334444",
  website: null,
  address_postal_code: "01001000",
  address_street: "Rua A",
  address_number: "1",
  address_complement: null,
  address_neighborhood: "Centro",
  address_city: "São Paulo",
  address_state: "SP",
  address_country: "BR",
  status: "PENDING",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  ...over,
});

const settingsRow: PartnerSettingsRow = {
  organization_id: PARTNER,
  default_partner_percentage: "40.00",
  default_owner_percentage: 60,
  partnership_active: true,
  responsible_name: "Dra. Responsável",
  responsible_oab_number: "123456",
  responsible_oab_state: "SP",
  activated_at: null,
  notes: "nota interna sigilosa",
};

const FORBIDDEN_FOR_PARTNER = ["notes", "partnershipPercentage", "ownerPercentage", "partnershipActive", "responsibleName", "responsibleOab", "oabState", "officeId"];

describe("DTOs de parceiro por superfície", () => {
  it("ADMIN recebe divisão (número), responsável e notas", () => {
    const dto = partnerAdminFromRows(orgRow(), settingsRow, OWNER);
    expect(dto).toMatchObject({ officeId: OWNER, status: "PENDING_INVITE", partnershipPercentage: 40, ownerPercentage: 60, notes: "nota interna sigilosa", responsibleOab: "123456", oabState: "SP" });
    expect(dto.address?.district).toBe("Centro");
  });

  it("LAWYER (interno) não recebe divisão nem notas", () => {
    const dto = partnerInternalFromRow(orgRow(), OWNER);
    for (const field of ["notes", "partnershipPercentage", "ownerPercentage", "responsibleName", "partnershipActive"]) expect(dto).not.toHaveProperty(field);
  });

  it("o próprio escritório do parceiro: nenhum campo interno", () => {
    const dto = partnerOwnOfficeFromRow(orgRow({ status: "ACTIVE" }));
    expect(dto.status).toBe("ACTIVE");
    for (const field of FORBIDDEN_FOR_PARTNER) expect(dto).not.toHaveProperty(field);
    expect(JSON.stringify(dto)).not.toContain("sigilosa");
  });

  it("listagem: share só quando há configuração (ADMIN)", () => {
    expect(partnerListItemFromRow(orgRow(), undefined).share).toBeUndefined();
    expect(partnerListItemFromRow(orgRow(), settingsRow).share).toEqual({ partnershipPercentage: 40, ownerPercentage: 60, partnershipActive: true });
  });

  it("escritório proprietário: OAB estruturada, listas vazias sem configuração", () => {
    const office = ownerOfficeFromRows(orgRow({ id: OWNER, type: "OWNER", address_postal_code: null, address_street: null, address_number: null, address_neighborhood: null, address_city: null, address_state: null }), null);
    expect(office).toMatchObject({ principalLawyer: "", statesOfPractice: [], units: [] });
    expect(office.oab).toBeUndefined();
    expect(office.address).toBeUndefined();
  });
});

describe("payloads de gravação", () => {
  it("argumentos de create_partner_office: só as chaves do contrato; nada de id/type/status", () => {
    const input = createPartnerSchema.parse({
      name: "Novo",
      type: "OWNER",
      status: "ACTIVE",
      email: "X@Y.TEST",
      address: { city: "Santos", state: "sp" },
      responsibleOab: { number: "12.345", state: "rj" },
    });
    const org = partnerOfficeOrgArg(input);
    expect(Object.keys(org).sort()).toEqual(
      [
        "name", "legal_name", "trade_name", "cnpj", "email", "phone", "website",
        "address_postal_code", "address_street", "address_number", "address_complement", "address_neighborhood", "address_city", "address_state",
      ].sort(),
    );
    expect(org).toMatchObject({ name: "Novo", email: "x@y.test", address_city: "Santos", address_state: "SP" });

    const settings = partnerOfficeSettingsArg(input);
    expect(Object.keys(settings).sort()).toEqual(
      ["default_partner_percentage", "default_owner_percentage", "partnership_active", "responsible_name", "responsible_oab_number", "responsible_oab_state", "notes"].sort(),
    );
    expect(settings).toMatchObject({ default_partner_percentage: 50, default_owner_percentage: 50, partnership_active: true, responsible_oab_number: "12345", responsible_oab_state: "RJ" });
  });

  it("PATCH só leva as chaves presentes; nunca type/status", () => {
    const { patch } = updatePartnerSchema.parse({ id: PARTNER, patch: { phone: "", notes: "nova", status: "ACTIVE" } });
    expect(organizationPatchPayload(patch)).toEqual({ phone: null });
    expect(partnerSettingsPatchPayload(patch)).toEqual({ notes: "nova" });
  });

  it("OAB nula limpa número e UF juntos", () => {
    const { patch } = updatePartnerSchema.parse({ id: PARTNER, patch: { responsibleOab: null } });
    expect(partnerSettingsPatchPayload(patch)).toEqual({ responsible_oab_number: null, responsible_oab_state: null });
  });

  it("escritório proprietário: separa organização e configurações", () => {
    const patch = updateOwnerOfficeSchema.parse({ name: "Bárbara", oab: { number: "123.456", state: "sp" }, statesOfPractice: ["SP", "SP", "RJ"] });
    expect(organizationPatchPayload(patch)).toEqual({ name: "Bárbara" });
    expect(ownerSettingsPatchPayload(patch)).toEqual({ principal_oab_number: "123456", principal_oab_state: "SP", states_of_practice: ["SP", "RJ"] });
  });
});

describe("schemas", () => {
  it("divisão precisa somar 100", () => {
    expect(changePartnerShareSchema.safeParse({ id: PARTNER, partnershipPercentage: 33.33, ownerPercentage: 66.67 }).success).toBe(true);
    expect(changePartnerShareSchema.safeParse({ id: PARTNER, partnershipPercentage: 40, ownerPercentage: 50 }).success).toBe(false);
    expect(createPartnerSchema.safeParse({ name: "X", partnershipPercentage: 30 }).success).toBe(false);
  });

  it("situação: PENDING não se escolhe", () => {
    expect(setPartnerStatusSchema.safeParse({ id: PARTNER, status: "PENDING" }).success).toBe(false);
    expect(setPartnerStatusSchema.safeParse({ id: PARTNER, status: "SUSPENDED" }).success).toBe(true);
  });

  it("ordenação só por whitelist; CNPJ opcional valida tamanho", () => {
    expect(listPartnersSchema.safeParse({ sortBy: "notes" }).success).toBe(false);
    expect(listPartnersSchema.parse({})).toMatchObject({ column: "name", ascending: true, page: 1 });
    expect(createPartnerSchema.safeParse({ name: "X", cnpj: "123" }).success).toBe(false);
    expect(createPartnerSchema.parse({ name: "X", cnpj: "" }).cnpj).toBeUndefined();
    expect(listOrganizationUsersSchema.parse({})).toMatchObject({ status: "ACTIVE", column: "created_at" });
  });

  it("PATCH vazio é recusado", () => {
    expect(updatePartnerSchema.safeParse({ id: PARTNER, patch: {} }).success).toBe(false);
    expect(updateOwnerOfficeSchema.safeParse({}).success).toBe(false);
  });
});

describe("erros e filtros", () => {
  it("unicidades de organização viram CONFLICT com mensagem própria", () => {
    const cnpj = fromOrganizationDbError({ code: "23505", message: 'duplicate key value violates unique constraint "organizations_cnpj_key"' });
    expect(cnpj).toMatchObject({ code: "CONFLICT", publicMessage: "Já existe um escritório com este CNPJ." });
    const owner = fromOrganizationDbError({ code: "23505", message: 'duplicate key value violates unique constraint "organizations_single_owner"' });
    expect(owner.publicMessage).toMatch(/proprietário/);
  });

  it("guard do OWNER (23514, mensagem nossa) vira INVALID_STATE com o texto do banco", () => {
    const e = fromOrganizationDbError({ code: "23514", message: "O escritório proprietário não pode ser suspenso, inativado nem excluído" });
    expect(e).toMatchObject({ code: "INVALID_STATE" });
    expect(e.publicMessage).toMatch(/proprietário/);
  });

  it("texto do usuário no filtro or() fica entre aspas", () => {
    expect(quoteFilter('%a,b"c%')).toBe('"%a,b\\"c%"');
  });
});
