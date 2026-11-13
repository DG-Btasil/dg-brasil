import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogFields, LogLevel } from "./logger";

vi.mock("server-only", () => ({}));
const afterMock = vi.fn((fn: () => unknown) => void fn());
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterMock(fn) }));

const { checkEnvironment, reportEnvironment, REQUIRED_IN_PRODUCTION } = await import("./env-check");
const { createErrorWebhook, errorWebhookUrl } = await import("./error-webhook");
const { createHealthCheck } = await import("./health");
const { createLogger, setLogSink } = await import("./logger");
const { reportRequestError, resetPlatformForTests, startPlatform } = await import("./startup");

const PROD_OK = {
  DG_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  DG_WORKER_DB_URL: "postgresql://dg_worker.abcdefghijklmnop:senha@aws-1-sa-east-1.pooler.supabase.com:6543/postgres",
  CRON_SECRET: "um-segredo-bem-comprido-123",
  GOOGLE_DRIVE_CLIENT_ID: "id",
  GOOGLE_DRIVE_CLIENT_SECRET: "secret",
  GOOGLE_DRIVE_REFRESH_TOKEN: "refresh",
  GOOGLE_DRIVE_ROOT_FOLDER_ID: "pasta",
  ERROR_WEBHOOK_URL: "https://hooks.exemplo.dev/abc",
};

const quiet = () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
};

afterEach(() => {
  resetPlatformForTests();
  afterMock.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("conferência das variáveis de ambiente", () => {
  it("produção completa não tem erro nem aviso", () => {
    expect(checkEnvironment(PROD_OK)).toEqual([]);
  });

  it("em produção, cada obrigatória ausente vira um erro com o nome dela", () => {
    const issues = checkEnvironment({ DG_ENV: "production", ERROR_WEBHOOK_URL: "https://x.dev/h" });
    expect(issues.filter((i) => i.level === "error").map((i) => i.variable)).toEqual([...REQUIRED_IN_PRODUCTION]);
  });

  it("fora da produção, a mesma falta é só aviso", () => {
    const issues = checkEnvironment({ DG_ENV: "development" });
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(issues.filter((i) => i.level === "warn").map((i) => i.variable)).toEqual([...REQUIRED_IN_PRODUCTION]);
  });

  it("DG_ENV ausente: erro na Vercel de produção, aviso em outro lugar", () => {
    expect(checkEnvironment({ ...PROD_OK, DG_ENV: undefined, VERCEL_ENV: "production" }).find((i) => i.variable === "DG_ENV")?.level).toBe("error");
    expect(checkEnvironment({ ...PROD_OK, DG_ENV: undefined }).find((i) => i.variable === "DG_ENV")?.level).toBe("warn");
  });

  it("o que deve estar AUSENTE em produção: demonstração do Serpro, modo de demonstração e endereço de prévia", () => {
    const issues = checkEnvironment({ ...PROD_OK, SERPRO_CPF_TRIAL: "1", NEXT_PUBLIC_DEMO_MODE: "true", AUTH_FALLBACK_SITE_URL: "https://preview.dev" });
    expect(issues.map((i) => [i.level, i.variable])).toEqual([
      ["error", "SERPRO_CPF_TRIAL"],
      ["error", "NEXT_PUBLIC_DEMO_MODE"],
      ["warn", "AUTH_FALLBACK_SITE_URL"],
    ]);
  });

  it("conexão do servidor com outro login (postgres) ou ilegível é erro; o valor nunca aparece", () => {
    const comPostgres = checkEnvironment({ ...PROD_OK, DG_WORKER_DB_URL: "postgresql://postgres.ref:senha-secreta@host:6543/postgres" });
    expect(comPostgres).toEqual([{ level: "error", variable: "DG_WORKER_DB_URL", message: "Deve usar o login dg_worker, nunca postgres nem outro usuário." }]);
    expect(JSON.stringify(comPostgres)).not.toContain("senha-secreta");
    expect(checkEnvironment({ ...PROD_OK, DG_WORKER_DB_URL: "isto não é url" })[0]).toMatchObject({ level: "error", variable: "DG_WORKER_DB_URL" });
  });

  it("Google Drive e Serpro pela metade são erro; tela de CPF ligada sem chaves também", () => {
    const drive = checkEnvironment({ ...PROD_OK, GOOGLE_DRIVE_REFRESH_TOKEN: "" });
    expect(drive.filter((i) => i.level === "error").map((i) => i.variable)).toEqual(["GOOGLE_DRIVE_REFRESH_TOKEN"]);
    const serpro = checkEnvironment({ ...PROD_OK, SERPRO_CPF_CONSUMER_KEY: "k" });
    expect(serpro.map((i) => i.variable)).toEqual(["SERPRO_CPF_CONSUMER_SECRET"]);
    const tela = checkEnvironment({ ...PROD_OK, NEXT_PUBLIC_CPF_LOOKUP: "1" });
    expect(tela.map((i) => [i.level, i.variable])).toEqual([["error", "SERPRO_CPF_CONSUMER_KEY"]]);
  });

  it("chaves pagas do Serpro fora da produção: aviso", () => {
    const issues = checkEnvironment({ ...PROD_OK, DG_ENV: "development", SERPRO_CPF_CONSUMER_KEY: "k", SERPRO_CPF_CONSUMER_SECRET: "s" });
    expect(issues.map((i) => [i.level, i.variable])).toEqual([["warn", "SERPRO_CPF_CONSUMER_KEY"]]);
  });

  it("registra uma linha por problema, só com o nome da variável", () => {
    const events: [LogLevel, string, LogFields][] = [];
    setLogSink((level, event, fields) => events.push([level, event, fields]));
    reportEnvironment(createLogger({ area: "startup" }), { DG_ENV: "production", ERROR_WEBHOOK_URL: "https://x.dev/h" });
    expect(events.filter(([level]) => level === "error").map(([, event, f]) => [event, f.variable])).toEqual(REQUIRED_IN_PRODUCTION.map((v) => ["env.check", v]));
    expect(events.some(([, event]) => event === "env.ok")).toBe(false);
  });
});

describe("aviso de erros por webhook", () => {
  const response = (ok = true, status = 200) => ({ ok, status }) as Response;

  it("só aceita endereço http(s)", () => {
    expect(errorWebhookUrl(undefined)).toBeNull();
    expect(errorWebhookUrl("  ")).toBeNull();
    expect(errorWebhookUrl("javascript:alert(1)")).toBeNull();
    expect(errorWebhookUrl("hooks.exemplo.dev/abc")).toBeNull();
    expect(errorWebhookUrl("https://hooks.exemplo.dev/abc")).toBe("https://hooks.exemplo.dev/abc");
  });

  it("erro vira POST com os campos já sanitizados; info e warn não saem", async () => {
    const fetchFn = vi.fn(async () => response());
    const seen: string[] = [];
    const pending: Promise<void>[] = [];
    const webhook = createErrorWebhook({ url: "https://h.dev/x", environment: "production", fetchFn, next: (_, event) => seen.push(event), keepAlive: (p) => pending.push(p) });
    setLogSink(webhook.sink);
    const log = createLogger({ requestId: "r1" });
    log.info("action.ok");
    log.warn("action.failed");
    log.error("action.crashed", { error: "falha para maria@x.com cpf 123.456.789-09", cpf: "12345678909", clientId: "c1" });
    await Promise.all(pending);
    expect(seen).toEqual(["action.ok", "action.failed", "action.crashed"]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://h.dev/x");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ source: "dg-brasil", environment: "production", level: "error", event: "action.crashed", suppressed: 0 });
    expect(body.fields).toEqual({ requestId: "r1", error: "falha para [email] cpf [cpf]", cpf: "[oculto]", clientId: "c1" });
    expect(body.text).toBe("[DG Brasil · production] erro no servidor: action.crashed");
    expect(String(init.body)).not.toMatch(/maria@x\.com|123\.456\.789-09|12345678909/);
  });

  it("limite por minuto: o excesso não é enviado e aparece como suprimido no envio seguinte", async () => {
    let t = 1_000_000;
    const fetchFn = vi.fn(async () => response());
    const webhook = createErrorWebhook({ url: "https://h.dev/x", fetchFn, now: () => t, maxPerMinute: 2, next: () => undefined });
    for (let i = 0; i < 5; i++) webhook.sink("error", `e${i}`, {});
    expect(fetchFn).toHaveBeenCalledTimes(2);
    t += 61_000;
    await webhook.report("depois", {});
    expect(fetchFn).toHaveBeenCalledTimes(3);
    const body = JSON.parse(String((fetchFn.mock.calls[2] as unknown as [string, RequestInit])[1].body));
    expect([body.event, body.suppressed]).toEqual(["depois", 3]);
    expect(body.text).toContain("mais 3 não enviados por limite");
  });

  it("webhook fora do ar, recusando ou lançando: quem loga não percebe", async () => {
    const warnings: string[] = [];
    const next = (level: LogLevel, event: string) => void (level === "warn" && warnings.push(event));
    const fora = createErrorWebhook({ url: "https://h.dev/x", fetchFn: vi.fn(async () => { throw new Error("ECONNREFUSED"); }), next });
    await expect(fora.report("x", {})).resolves.toBeUndefined();
    const recusa = createErrorWebhook({ url: "https://h.dev/x", fetchFn: vi.fn(async () => response(false, 500)), next });
    await expect(recusa.report("x", {})).resolves.toBeUndefined();
    expect(warnings).toEqual(["error_webhook.failed", "error_webhook.rejected"]);
    const quebra = createErrorWebhook({
      url: "https://h.dev/x",
      fetchFn: vi.fn(async () => response()),
      next,
      keepAlive: () => { throw new Error("fora de requisição"); },
    });
    expect(() => quebra.sink("error", "x", {})).not.toThrow();
  });
});

describe("subida do servidor", () => {
  it("sem ERROR_WEBHOOK_URL nada muda no destino dos logs; com ela, os erros saem", () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    quiet();
    startPlatform({ ...PROD_OK, ERROR_WEBHOOK_URL: undefined });
    createLogger().error("sem.webhook");
    expect(fetchMock).not.toHaveBeenCalled();
    resetPlatformForTests();
    startPlatform(PROD_OK);
    createLogger().error("com.webhook");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  it("subir duas vezes na mesma instância não registra tudo de novo", () => {
    quiet();
    const info = vi.spyOn(console, "info");
    startPlatform(PROD_OK);
    startPlatform(PROD_OK);
    expect(info.mock.calls.filter(([line]) => String(line).includes("env.ok"))).toHaveLength(1);
  });

  it("durante o build não confere nem liga nada", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    startPlatform({ DG_ENV: "production", NEXT_PHASE: "phase-production-build" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("erro de requisição: vai a rota, o tipo, a classe e o código; nunca a mensagem nem o endereço", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    quiet();
    startPlatform(PROD_OK);
    const error = Object.assign(new TypeError("cliente Maria da Silva não encontrado"), { digest: "1234567890abcdef" });
    await reportRequestError(error, { path: "/clientes?busca=Maria", method: "GET" }, { routePath: "/clientes/[id]", routeType: "render" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const raw = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(JSON.parse(raw).fields).toEqual({ area: "request", routePath: "/clientes/[id]", routeType: "render", method: "GET", errorClass: "TypeError", digest: "1234567890abcdef" });
    expect(raw).not.toMatch(/Maria/);
  });
});

describe("situação do sistema (/api/health)", () => {
  it("banco responde: ok; a resposta vale por alguns segundos (a rota pública não martela o banco)", async () => {
    let t = 0;
    const ping = vi.fn(async () => undefined);
    const check = createHealthCheck({ ping, now: () => t, cacheMs: 15_000 });
    expect(await check()).toEqual({ status: "ok", database: "ok", checkedAt: new Date(0).toISOString() });
    t = 14_000;
    await check();
    await Promise.all([check(), check()]);
    expect(ping).toHaveBeenCalledTimes(1);
    t = 15_000;
    await check();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("banco não responde, demora demais ou não está configurado: degradado, sem detalhe do erro", async () => {
    const down = await createHealthCheck({ ping: async () => { throw new Error("password authentication failed for user dg_worker"); } })();
    expect(down).toMatchObject({ status: "degraded", database: "down" });
    expect(JSON.stringify(down)).not.toContain("password");
    const slow = await createHealthCheck({ ping: () => new Promise(() => undefined), timeoutMs: 10 })();
    expect(slow.database).toBe("down");
    expect((await createHealthCheck({ ping: null })()).database).toBe("not_configured");
  });
});

describe("limite contado no banco (consulta paga de CPF, migration 065)", async () => {
  const { enforceSharedLimit } = await import("./rate-limit");
  const { DomainError } = await import("./errors");
  type Ctx = Parameters<typeof enforceSharedLimit>[0];
  const ctxWith = (rpc: (fn: string, args: unknown) => unknown) => {
    const warn = vi.fn();
    const ctx = { db: { rpc: vi.fn(async (fn: string, args: unknown) => rpc(fn, args)) }, log: { warn, info: vi.fn(), error: vi.fn() } } as unknown as Ctx;
    return { ctx, warn, rpc: (ctx.db as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc };
  };

  it("permitido: chama a função do banco com o nome do limite e não usa a reserva", async () => {
    const { ctx, rpc } = ctxWith(() => ({ data: { allowed: true, retry_after_seconds: 0 }, error: null }));
    const fallback = vi.fn();
    await enforceSharedLimit(ctx, "lookup.cpf", fallback);
    expect(rpc).toHaveBeenCalledWith("consume_rate_limit", { p_scope: "lookup.cpf" });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("recusado pelo banco: RATE_LIMITED com a mensagem pedida, sem usar a reserva", async () => {
    const { ctx } = ctxWith(() => ({ data: { allowed: false, retry_after_seconds: 12 }, error: null }));
    const fallback = vi.fn();
    const error = await enforceSharedLimit(ctx, "lookup.cpf", fallback, "Aguarde um minuto.").then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect([(error as InstanceType<typeof DomainError>).code, (error as InstanceType<typeof DomainError>).publicMessage]).toEqual(["RATE_LIMITED", "Aguarde um minuto."]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("banco sem a função (065 não aplicada), com erro, resposta estranha ou lançando: vale o contador em memória", async () => {
    const cases: Array<() => unknown> = [
      () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.consume_rate_limit" } }),
      () => ({ data: null, error: null }),
      () => ({ data: { allowed: "sim" }, error: null }),
      () => { throw new Error("rede"); },
    ];
    for (const answer of cases) {
      const { ctx, warn } = ctxWith(answer);
      const fallback = vi.fn();
      await enforceSharedLimit(ctx, "lookup.cpf", fallback);
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("rate_limit.shared_unavailable", expect.objectContaining({ scope: "lookup.cpf" }));
    }
    // A reserva também bloqueia: o erro dela sobe.
    const { ctx } = ctxWith(() => ({ data: null, error: { code: "PGRST202" } }));
    await expect(enforceSharedLimit(ctx, "lookup.cpf", () => { throw new DomainError("RATE_LIMITED", "reserva"); })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
