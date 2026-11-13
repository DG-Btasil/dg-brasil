import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLogSink, type LogFields } from "@/server/core/logger";

vi.mock("server-only", () => ({}));
const run = vi.fn();
vi.mock("@/server/integrations/judicial/sync", () => ({ runJudicialSync: (...a: unknown[]) => run(...a) }));
vi.mock("@/server/domain/judicial/service", () => ({ judicialSyncDeps: () => ({}) }));

/** A rota que o agendador chama não pode falhar em silêncio (062). */
describe("rota agendada da busca judicial", () => {
  const events: [string, string, LogFields][] = [];
  const saved = { secret: process.env.CRON_SECRET, db: process.env.DG_WORKER_DB_URL };
  const call = async (authorization?: string) => {
    const { GET } = await import("./route");
    return GET(new Request("https://dg.invalid/api/cron/judicial-sync", { headers: authorization ? { authorization } : {} }));
  };

  beforeEach(() => {
    events.length = 0;
    run.mockReset();
    setLogSink((level, event, fields) => events.push([level, event, fields]));
    process.env.CRON_SECRET = "segredo-de-teste";
    process.env.DG_WORKER_DB_URL = "postgres://exemplo.invalid/db";
  });
  afterEach(() => {
    setLogSink(null);
    if (saved.secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved.secret;
    if (saved.db === undefined) delete process.env.DG_WORKER_DB_URL;
    else process.env.DG_WORKER_DB_URL = saved.db;
  });

  it("sem DG_WORKER_DB_URL: responde 500 e registra o erro (antes era 200 'skipped', sem rastro)", async () => {
    delete process.env.DG_WORKER_DB_URL;
    const res = await call("Bearer segredo-de-teste");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "misconfigured" });
    expect(events.map(([level, event, f]) => [level, event, f.missing])).toEqual([["error", "judicial.cron_misconfigured", "DG_WORKER_DB_URL"]]);
    expect(run).not.toHaveBeenCalled();
  });
  it("segredo errado: 401 com aviso no log, sem o segredo; servidor sem CRON_SECRET é erro de configuração", async () => {
    const res = await call("Bearer outro");
    expect(res.status).toBe(401);
    expect(events.map(([level, event]) => [level, event])).toEqual([["warn", "judicial.cron_unauthorized"]]);
    expect(JSON.stringify(events)).not.toContain("segredo-de-teste");
    expect(JSON.stringify(events)).not.toContain("outro");
    events.length = 0;
    delete process.env.CRON_SECRET;
    expect((await call("Bearer segredo-de-teste")).status).toBe(401);
    expect(events.map(([level, event, f]) => [level, event, f.missing])).toEqual([["error", "judicial.cron_misconfigured", "CRON_SECRET"]]);
    expect(run).not.toHaveBeenCalled();
  });
  it("configurada: roda a busca e responde a situação, sem detalhe de erro", async () => {
    run.mockResolvedValue({ busy: false, runId: "r1", status: "PARTIAL", stats: { oabs: 1 }, errors: ["OAB RJ 1: falha"] });
    const res = await call("Bearer segredo-de-teste");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "PARTIAL", stats: { oabs: 1 } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toEqual({ trigger: "CRON", onlyDatajud: false });
  });
});
