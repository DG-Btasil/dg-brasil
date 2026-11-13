import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contadores do menu, com a sessão e as Server Actions trocadas por dublês:
 * aqui só importa o rótulo de cada item. O item "Prazos" mostra os vencidos
 * ainda em aberto (o mesmo número do contador da agenda).
 */
vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T>(fn: T) => fn }));
vi.mock("@/server/auth/session", () => ({ requireAppSession: vi.fn() }));

const total = (n: number) => ({ ok: true as const, data: { total: n } });
const failed = { ok: false as const };

vi.mock("@/server/domain/cases/actions", () => ({ listCasesAction: vi.fn(async () => total(2)) }));
vi.mock("@/server/domain/clients/actions", () => ({ listClientsAction: vi.fn(async () => total(13)) }));
vi.mock("@/server/domain/notifications/actions", () => ({ countUnreadNotificationsAction: vi.fn(async () => ({ ok: true, data: { unread: 0 } })) }));
vi.mock("@/server/domain/organizations/actions", () => ({ listPartnersAction: vi.fn(async () => total(1)) }));
vi.mock("@/server/domain/partner-requests/actions", () => ({ listPartnerRequestsAction: vi.fn(async () => total(0)) }));
vi.mock("@/server/domain/processes/actions", () => ({ getProcessStatusCountsAction: vi.fn(async () => failed), listProcessesAction: vi.fn(async () => total(4)) }));
vi.mock("@/server/domain/processes/deadlines/actions", () => ({ listOverdueDeadlinesAction: vi.fn() }));
vi.mock("@/server/domain/reviews/actions", () => ({ listReviewsAction: vi.fn(async () => total(0)) }));

const { requireAppSession } = vi.mocked(await import("@/server/auth/session"));
const { listOverdueDeadlinesAction } = vi.mocked(await import("@/server/domain/processes/deadlines/actions"));
const { loadNavCounts } = await import("./load");

const sessionOf = (role: string, surface: "INTERNAL" | "PARTNER") => requireAppSession.mockResolvedValue({ role, surface } as never);

beforeEach(() => {
  listOverdueDeadlinesAction.mockReset();
});

describe("contador de prazos vencidos no menu", () => {
  it("equipe interna: quantos prazos estão vencidos e em aberto, no singular e no plural", async () => {
    sessionOf("LAWYER", "INTERNAL");
    listOverdueDeadlinesAction.mockResolvedValue(total(3) as never);
    expect((await loadNavCounts()).deadlines).toBe("3 vencidos");
    // Só o total interessa: uma linha por consulta.
    expect(listOverdueDeadlinesAction).toHaveBeenCalledExactlyOnceWith({ pageSize: 1 });

    listOverdueDeadlinesAction.mockResolvedValue(total(1) as never);
    expect((await loadNavCounts()).deadlines).toBe("1 vencido");
  });

  it("nenhum vencido tem rótulo próprio; falha na contagem só esconde o rótulo, sem derrubar os outros", async () => {
    sessionOf("ADMIN", "INTERNAL");
    listOverdueDeadlinesAction.mockResolvedValue(total(0) as never);
    expect((await loadNavCounts()).deadlines).toBe("Nenhum vencido");

    listOverdueDeadlinesAction.mockResolvedValue(failed as never);
    const counts = await loadNavCounts();
    expect(counts.deadlines).toBeUndefined();
    expect(counts.clients).toBe("13 clientes");
  });

  it("portal do parceiro: prazo não é dado do parceiro, então nem conta", async () => {
    sessionOf("PARTNER_ADMIN", "PARTNER");
    const counts = await loadNavCounts();
    expect(counts).not.toHaveProperty("deadlines");
    expect(listOverdueDeadlinesAction).not.toHaveBeenCalled();
  });
});
