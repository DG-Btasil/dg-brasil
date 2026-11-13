import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/lib/auth/types";
import { createServiceContext } from "@/server/core/context";
import { buildCsv } from "@/server/domain/exports/csv";
import { CLIENT_EXPORT_COLUMNS, exportExtrasById } from "./export";
import type { ClientDirectoryRow } from "./mappers";

// O service nunca chega ao banco neste teste.
vi.mock("./repository", () => ({
  findIdByDocument: vi.fn(),
  save: vi.fn(),
  listDirectory: vi.fn(),
  listExportExtras: vi.fn(),
  listOrganizationNames: vi.fn(),
}));

const repo = await import("./repository");
const service = await import("./service");

const OWNER = "00000000-0000-4000-8000-000000000001";
const rpc = vi.fn(async () => ({ data: "audit-id", error: null }));
const ctxOf = (role: AppSession["role"]) =>
  createServiceContext({
    db: { rpc } as unknown as SupabaseClient,
    requestId: "55555555-5555-4555-8555-555555555555",
    session: { userId: "u1", organizationId: OWNER, role, surface: role.startsWith("PARTNER") ? "PARTNER" : "INTERNAL" } as AppSession,
  });

const row = (over: Partial<ClientDirectoryRow> = {}): ClientDirectoryRow => ({
  id: "c1",
  kind: "INDIVIDUAL",
  display_name: "Maria Teste",
  trade_name: null,
  cpf: "01234567890",
  cnpj: null,
  status: "ACTIVE",
  origin_organization_id: OWNER,
  acquisition_channel: "GOOGLE_ADS",
  created_at: "2026-10-01T15:00:00Z",
  updated_at: "2026-11-13T15:00:00Z",
  ...over,
});

const createInput = {
  kind: "INDIVIDUAL",
  cpf: "01234567890",
  fullName: "Maria Teste",
  nationality: "brasileira",
  maritalStatus: "SINGLE",
  profession: "aposentada",
  originOfficeId: OWNER,
  contact: { email: "maria@dgbrasil.test" },
  address: { zipCode: "01001000", street: "Rua A", number: "1", district: "Centro", city: "São Paulo", state: "SP" },
} as never;

beforeEach(() => {
  vi.mocked(repo.findIdByDocument).mockReset();
  vi.mocked(repo.save).mockReset().mockResolvedValue("novo-id");
  vi.mocked(repo.listDirectory).mockReset();
  vi.mocked(repo.listExportExtras).mockReset().mockResolvedValue([]);
  vi.mocked(repo.listOrganizationNames).mockReset().mockResolvedValue(new Map([[OWNER, "Barbara Cardoso Advocacia"]]));
  rpc.mockClear();
});

describe("CPF/CNPJ de cliente que está na Lixeira", () => {
  it("cadastrar de novo é recusado com o caminho certo (restaurar), e nada é gravado", async () => {
    vi.mocked(repo.findIdByDocument).mockResolvedValue({ id: "c1", deleted: true });
    await expect(service.createClient(ctxOf("LAWYER"), createInput)).rejects.toMatchObject({ code: "CONFLICT", publicMessage: service.DELETED_CLIENT_MESSAGE });
    expect(service.DELETED_CLIENT_MESSAGE).toMatch(/cliente excluído.*restaurar.*Lixeira/);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("cliente ativo com o mesmo documento continua sendo 'já cadastrado'; documento livre cadastra", async () => {
    vi.mocked(repo.findIdByDocument).mockResolvedValue({ id: "c1", deleted: false });
    await expect(service.createClient(ctxOf("LAWYER"), createInput)).rejects.toMatchObject({ code: "DUPLICATE_CLIENT" });
    vi.mocked(repo.findIdByDocument).mockResolvedValue(null);
    expect(await service.createClient(ctxOf("LAWYER"), createInput)).toEqual({ id: "novo-id" });
  });

  it("consulta interna de CPF/CNPJ: excluído não devolve ficha para abrir", async () => {
    vi.mocked(repo.findIdByDocument).mockResolvedValue({ id: "c1", deleted: true });
    expect(await service.lookupClientDocument(ctxOf("ASSISTANT"), "01234567890")).toEqual({ status: "DELETED" });
    vi.mocked(repo.findIdByDocument).mockResolvedValue({ id: "c1", deleted: false });
    expect(await service.lookupClientDocument(ctxOf("ASSISTANT"), "01234567890")).toEqual({ status: "FOUND", clientId: "c1" });
  });
});

describe("planilha de clientes", () => {
  it("contato e endereço PRINCIPAIS por cliente", () => {
    const extras = exportExtrasById([
      {
        id: "c1",
        client_contacts: [
          { type: "EMAIL", value: "outro@x.test", is_primary: false },
          { type: "EMAIL", value: "maria@dgbrasil.test", is_primary: true },
          { type: "PHONE", value: "11999990000", is_primary: true },
        ],
        client_addresses: [
          { city: "Campinas", state: "SP", is_primary: false },
          { city: "Petrópolis", state: "RJ", is_primary: true },
        ],
      },
      { id: "c2", client_contacts: null, client_addresses: null },
    ]);
    expect(extras.get("c1")).toEqual({ email: "maria@dgbrasil.test", phone: "11999990000", city: "Petrópolis", state: "RJ" });
    expect(extras.get("c2")).toEqual({ email: undefined, phone: undefined, city: undefined, state: undefined });
  });

  it("ADMIN: mesmos filtros e ordem da lista; CPF completo e com máscara no arquivo; auditoria sem o texto da busca", async () => {
    vi.mocked(repo.listDirectory).mockResolvedValue({ rows: [row(), row({ id: "c2", kind: "COMPANY", display_name: "Empresa; Ltda", trade_name: "Fantasia", cpf: null, cnpj: "11222333000181", status: "INACTIVE", acquisition_channel: null })], total: 2 });
    vi.mocked(repo.listExportExtras).mockResolvedValue([{ id: "c1", client_contacts: [{ type: "PHONE", value: "24999990000", is_primary: true }], client_addresses: [{ city: "Petrópolis", state: "RJ", is_primary: true }] }]);
    const file = await service.exportClients(ctxOf("ADMIN"), { q: "012.345", status: "ACTIVE", page: 1, pageSize: 25, column: "display_name", ascending: true });

    expect(vi.mocked(repo.listDirectory).mock.calls[0]?.slice(1)).toEqual([
      { q: "012.345", status: "ACTIVE", kind: undefined, originOrganizationId: undefined, acquisitionChannel: undefined },
      { page: 1, pageSize: 500 },
      { column: "display_name", ascending: true },
    ]);
    const lines = file.content.split("\r\n");
    expect(lines[0]).toBe("Nome;Nome fantasia;Tipo;CPF/CNPJ;Situação;E-mail;Telefone;Município;UF;Origem;Como chegou;Cadastrado em;Atualizado em");
    expect(lines[1]).toBe("Maria Teste;;Pessoa Física;012.345.678-90;Ativo;;(24) 99999-0000;Petrópolis;RJ;Barbara Cardoso Advocacia;Google Ads;01/10/2026;13/11/2026");
    expect(lines[2]).toBe('"Empresa; Ltda";Fantasia;Pessoa Jurídica;11.222.333/0001-81;Inativo;;;;;Barbara Cardoso Advocacia;;01/10/2026;13/11/2026');
    expect([file.rowCount, file.total, file.truncated, file.fileName.startsWith("clientes-")]).toEqual([2, 2, false, true]);

    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_data_export", { p_kind: "clients", p_filters: { search: true, status: "ACTIVE" }, p_row_count: 2, p_truncated: false });
    // Nem o texto da busca nem CPF/CNPJ vão para a auditoria.
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/012|11222333/);
  });

  it("quem não é ADMIN não exporta, e a lista nem é lida", async () => {
    for (const role of ["LAWYER", "ASSISTANT", "PARTNER_ADMIN"] as const) {
      await expect(service.exportClients(ctxOf(role), { page: 1, pageSize: 25, column: "updated_at", ascending: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(repo.listDirectory).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("colunas: nome começando com sinal de fórmula não vira fórmula na planilha", () => {
    const csv = buildCsv(CLIENT_EXPORT_COLUMNS, [{ id: "c1", kind: "INDIVIDUAL", name: "=cmd|' /C calc'!A0", document: "01234567890", status: "ACTIVE", createdAt: "2026-10-01", updatedAt: "2026-10-01" }]);
    expect(csv.split("\r\n")[1]?.startsWith("'=cmd")).toBe(true);
  });
});
