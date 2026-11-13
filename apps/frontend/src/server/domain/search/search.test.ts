import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/lib/auth/types";
import { flatItems, isUrlSafeSearch, moveIndex, searchGroups } from "@/features/search/search-items";
import { createServiceContext } from "@/server/core/context";
import type { GlobalSearchDTO } from "./dto";
import { GLOBAL_SEARCH_GROUP_LIMIT, globalSearchSchema } from "./schemas";

// A busca global só chama as buscas das listas: aqui elas são dublês.
vi.mock("@/server/domain/clients/service", () => ({ listClients: vi.fn() }));
vi.mock("@/server/domain/cases/service", () => ({ listCases: vi.fn() }));
vi.mock("@/server/domain/processes/service", () => ({ listProcesses: vi.fn() }));

const clients = await import("@/server/domain/clients/service");
const cases = await import("@/server/domain/cases/service");
const processes = await import("@/server/domain/processes/service");
const { globalSearch } = await import("./service");

const ctxOf = (role: AppSession["role"]) =>
  createServiceContext({
    db: {} as SupabaseClient,
    requestId: "55555555-5555-4555-8555-555555555555",
    session: { userId: "u1", organizationId: "o1", role, surface: role.startsWith("PARTNER") ? "PARTNER" : "INTERNAL" } as AppSession,
  });

const pageOf = <T>(items: T[], total = items.length) => ({ items, total, page: 1, pageSize: GLOBAL_SEARCH_GROUP_LIMIT, hasMore: total > items.length });
const client = { id: "c1", kind: "INDIVIDUAL", name: "Maria Teste", document: "52998224725", status: "ACTIVE", createdAt: "", updatedAt: "" };
const legalCase = { id: "k1", clientId: "c1", clientName: "Maria Teste", title: "Consignado Maria", area: "BANKING", legalAreaId: "a", status: "IN_PROGRESS", originOrganizationId: "o1", partnerOrganizationId: null, createdAt: "", updatedAt: "" };
const process = { id: "p1", legalCaseId: "k1", clientId: "c1", clientName: "Maria Teste", caseTitle: "Consignado Maria", origin: "MANUAL", cnj: "00012345620268190001", title: "Maria x Banco", status: "ACTIVE", createdAt: "", updatedAt: "" };

beforeEach(() => {
  vi.mocked(clients.listClients).mockReset().mockResolvedValue(pageOf([client], 12) as never);
  vi.mocked(cases.listCases).mockReset().mockResolvedValue(pageOf([legalCase]) as never);
  vi.mocked(processes.listProcesses).mockReset().mockResolvedValue(pageOf([process]) as never);
});

describe("busca global — entrada", () => {
  it("pelo menos 2 caracteres (sem contar espaços nas pontas), no máximo 120", () => {
    expect(globalSearchSchema.parse({ q: "  ma  " })).toEqual({ q: "ma" });
    expect(globalSearchSchema.safeParse({ q: " m " }).success).toBe(false);
    expect(globalSearchSchema.safeParse({ q: "x".repeat(121) }).success).toBe(false);
    expect(globalSearchSchema.safeParse({}).success).toBe(false);
  });
});

describe("busca global — service", () => {
  it("equipe interna: chama as três buscas das listas com limite pequeno e devolve os grupos", async () => {
    const r = await globalSearch(ctxOf("LAWYER"), { q: "maria" });
    for (const fn of [clients.listClients, cases.listCases, processes.listProcesses]) {
      expect(vi.mocked(fn).mock.calls[0]?.[1]).toMatchObject({ q: "maria", page: 1, pageSize: GLOBAL_SEARCH_GROUP_LIMIT });
    }
    expect(r.clients).toEqual({ total: 12, items: [{ id: "c1", name: "Maria Teste", kind: "INDIVIDUAL", status: "ACTIVE", maskedDocument: "***.982.247-**" }] });
    expect(r.cases).toEqual({ total: 1, items: [{ id: "k1", title: "Consignado Maria", clientName: "Maria Teste", status: "IN_PROGRESS" }] });
    expect(r.processes).toEqual({ total: 1, items: [{ id: "p1", title: "Maria x Banco", cnj: "00012345620268190001", clientName: "Maria Teste", status: "ACTIVE" }] });
  });

  it("o CPF/CNPJ inteiro nunca volta no resultado da busca", async () => {
    const r = await globalSearch(ctxOf("ADMIN"), { q: "52998224725" });
    expect(JSON.stringify(r)).not.toContain("52998224725");
  });

  it("parceiro também busca (as listas e a RLS limitam ao próprio escritório): clientes, casos do portal e processos", async () => {
    const r = await globalSearch(ctxOf("PARTNER_USER"), { q: "maria" });
    expect(Object.keys(r).sort()).toEqual(["cases", "clients", "processes"]);
    expect(cases.listCases).toHaveBeenCalledOnce();
  });

  it("uma lista que falha derruba a busca (erro visível, nunca resultado pela metade)", async () => {
    vi.mocked(processes.listProcesses).mockRejectedValue(new Error("falhou"));
    await expect(globalSearch(ctxOf("ADMIN"), { q: "maria" })).rejects.toThrow("falhou");
  });
});

describe("busca global — tela", () => {
  const result: GlobalSearchDTO = {
    clients: { total: 12, items: [{ id: "c1", name: "Maria Teste", kind: "INDIVIDUAL", status: "INACTIVE", maskedDocument: "***.982.247-**" }] },
    cases: { total: 1, items: [{ id: "k1", title: "Consignado Maria", clientName: "Maria Teste", status: "IN_PROGRESS" }] },
    processes: { total: 1, items: [{ id: "p1", title: "Maria x Banco", cnj: "00012345620268190001", clientName: "Maria Teste", status: "ACTIVE" }] },
  };

  it("grupos na ordem Clientes, Casos, Processos, com o destino e a linha de apoio de cada item", () => {
    const groups = searchGroups(result, "maria");
    expect(groups.map((g) => [g.key, g.label, g.total])).toEqual([["clients", "Clientes", 12], ["cases", "Casos", 1], ["processes", "Processos", 1]]);
    expect(flatItems(groups).map((i) => [i.href, i.title, i.detail])).toEqual([
      ["/clientes/c1", "Maria Teste", "PF · ***.982.247-** · Inativo"],
      ["/casos/k1", "Consignado Maria", "Maria Teste · Em andamento"],
      ["/processos/p1", "Maria x Banco", "0001234-56.2026.8.19.0001 · Maria Teste · Em andamento"],
    ]);
  });

  it("\"Ver todos\" leva a busca para a lista SÓ quando não há dígitos: CPF/CNPJ e número de processo nunca vão para a URL", () => {
    expect(searchGroups(result, " Maria Silva ").map((g) => g.allHref)).toEqual(["/clientes?busca=Maria%20Silva", "/casos?busca=Maria%20Silva", "/processos?busca=Maria%20Silva"]);
    for (const text of ["529.982.247-25", "52998224725", "0001234-56.2026", "maria 123"]) {
      expect(isUrlSafeSearch(text)).toBe(false);
      expect(searchGroups(result, text).map((g) => g.allHref)).toEqual([undefined, undefined, undefined]);
    }
  });

  it("grupo que o papel não busca não aparece", () => {
    expect(searchGroups({ processes: result.processes }, "x").map((g) => g.key)).toEqual(["processes"]);
    expect(searchGroups({}, "x")).toEqual([]);
  });

  it("setas dão a volta nas pontas; sem resultado, nada fica escolhido", () => {
    expect([moveIndex(-1, 1, 3), moveIndex(-1, -1, 3), moveIndex(2, 1, 3), moveIndex(0, -1, 3), moveIndex(1, 1, 3)]).toEqual([0, 2, 0, 2, 2]);
    expect(moveIndex(0, 1, 0)).toBe(-1);
  });
});
